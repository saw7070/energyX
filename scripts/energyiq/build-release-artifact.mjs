#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const RELEASE_SHA_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ARTIFACT_FORMAT = "ustar";
const VERIFIED_ARTIFACT = Symbol("verified-release-artifact");
const WEB_BUILD_ROOT = "apps/web/.next";
const WEB_BUILD_EXCLUDES = new Set(["cache", "diagnostics", "trace", "types"]);
const RELEASE_HOST_REQUIRED_FILES = [
  "scripts/energyiq/build-release-artifact.mjs",
  "scripts/energyiq/deploy-release.mjs",
  "scripts/energyiq/backup-shared-storage.sh",
  "scripts/energyiq/shared-storage-backup-preflight.mjs",
  "scripts/energyiq/verify-shared-storage-backup.mjs",
  "deploy/systemd/energyiq-shared-storage-backup.service",
  "deploy/systemd/energyiq-shared-storage-backup.timer",
];
const API_BOOTSTRAP_RESOURCE_ROOTS = [
  "packages/skills/builtin",
];
const FORBIDDEN_SEGMENTS = new Set([
  ".git",
  "acceptance",
  "coverage",
  "node_modules",
  "outputs",
  "playwright-report",
  "screenshots",
  "storage",
  "test-results",
  "验收",
]);
const FORBIDDEN_DATABASE_EXTENSIONS = new Set([".db", ".duckdb", ".sqlite", ".sqlite3"]);
const FORBIDDEN_SECRET_EXTENSIONS = new Set([".key", ".p12", ".pem", ".pfx"]);

const sortStrings = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const sha256 = (body) => createHash("sha256").update(body).digest("hex");

const sha256File = async (filePath) => {
  const handle = await open(filePath, "r");
  const hash = createHash("sha256");
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
};

const normalizeArtifactPath = (value) => value.replaceAll("\\", "/").replace(/^\.\//, "");

const requireSafeRelativePath = (value, label = "release path") => {
  const normalized = normalizeArtifactPath(value);
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    throw new Error(`${label} must be a non-empty relative path: ${value}`);
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`${label} cannot traverse directories: ${value}`);
  }
  return normalized;
};

const forbiddenPathReason = (relativePath) => {
  const normalized = requireSafeRelativePath(relativePath);
  const segments = normalized.split("/");
  for (const segment of segments) {
    const lower = segment.toLowerCase();
    if (FORBIDDEN_SEGMENTS.has(lower)) return `forbidden ${segment} directory`;
    if (/^\.env(?:\.|$)/i.test(segment)) return "forbidden .env file";
  }
  const basename = segments.at(-1);
  const extension = path.posix.extname(basename).toLowerCase();
  if (FORBIDDEN_DATABASE_EXTENSIONS.has(extension)) return `forbidden ${extension} database`;
  if (FORBIDDEN_SECRET_EXTENSIONS.has(extension)) return `forbidden ${extension} secret material`;
  if (/^(?:credentials|passwords?|secrets?)(?:\.|$)/i.test(basename)) return "forbidden secret material";
  return undefined;
};

const requireAllowedReleasePath = (relativePath) => {
  const reason = forbiddenPathReason(relativePath);
  if (reason) throw new Error(`Release content ${relativePath} is rejected: ${reason}.`);
};

const pathExists = async (value) => {
  try {
    await lstat(value);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
};

const readJson = async (filePath, label) => {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${filePath}`, { cause: error });
  }
};

const requireDirectory = async (label, value) => {
  if (!path.isAbsolute(value)) throw new Error(`${label} must be an absolute path.`);
  const details = await lstat(value);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error(`${label} must be a physical directory.`);
  }
};

const walkFiles = async (sourceDir, relativeRoot, options = {}) => {
  const normalizedRoot = requireSafeRelativePath(relativeRoot);
  const rootPath = path.join(sourceDir, ...normalizedRoot.split("/"));
  const rootDetails = await lstat(rootPath);
  if (!rootDetails.isDirectory() || rootDetails.isSymbolicLink()) {
    throw new Error(`Release directory must be a physical directory: ${normalizedRoot}`);
  }
  const results = [];
  const visit = async (absoluteDir, relativeDir) => {
    const entries = await readdir(absoluteDir, { withFileTypes: true });
    entries.sort((left, right) => sortStrings(left.name, right.name));
    for (const entry of entries) {
      const relativePath = `${relativeDir}/${entry.name}`;
      requireAllowedReleasePath(relativePath);
      if (options.exclude?.(relativePath, entry)) continue;
      const absolutePath = path.join(absoluteDir, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Release content cannot contain symlinks: ${relativePath}`);
      }
      if (entry.isDirectory()) {
        await visit(absolutePath, relativePath);
      } else if (entry.isFile()) {
        results.push(relativePath);
      } else {
        throw new Error(`Unsupported release file type: ${relativePath}`);
      }
    }
  };
  await visit(rootPath, normalizedRoot);
  return results;
};

const discoverWorkspaces = async (sourceDir) => {
  const byName = new Map();
  const byPath = new Map();
  for (const parent of ["apps", "packages"]) {
    const parentPath = path.join(sourceDir, parent);
    for (const entry of await readdir(parentPath, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const workspacePath = `${parent}/${entry.name}`;
      const manifestPath = path.join(parentPath, entry.name, "package.json");
      if (!await pathExists(manifestPath)) continue;
      const manifest = await readJson(manifestPath, "Workspace package manifest");
      if (typeof manifest.name !== "string" || !manifest.name) {
        throw new Error(`Workspace package has no name: ${workspacePath}/package.json`);
      }
      const workspace = { path: workspacePath, manifest };
      if (byName.has(manifest.name)) throw new Error(`Duplicate workspace package name: ${manifest.name}`);
      byName.set(manifest.name, workspace);
      byPath.set(workspacePath, workspace);
    }
  }
  return { byName, byPath };
};

const startWorkspacePath = (rootManifest, scriptName) => {
  const script = rootManifest.scripts?.[scriptName];
  if (typeof script !== "string") throw new Error(`Root ${scriptName} script is required.`);
  const match = /^npm\s+--prefix\s+([^\s]+)\s+run\s+start(?:\s|$)/.exec(script.trim());
  if (!match) throw new Error(`Root ${scriptName} must use an explicit npm --prefix runtime workspace.`);
  return requireSafeRelativePath(match[1], scriptName);
};

const internalRuntimeClosure = (roots, workspaces) => {
  const selected = new Map();
  const queue = [...roots];
  while (queue.length > 0) {
    const workspace = queue.shift();
    if (selected.has(workspace.path)) continue;
    selected.set(workspace.path, workspace);
    for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      for (const dependencyName of Object.keys(workspace.manifest[field] ?? {}).sort(sortStrings)) {
        const dependencyWorkspace = workspaces.byName.get(dependencyName);
        if (dependencyWorkspace) queue.push(dependencyWorkspace);
      }
    }
  }
  return [...selected.values()].sort((left, right) => sortStrings(left.path, right.path));
};

const excludeBuildOnlyDistEntry = (relativePath, entry) => {
  const basename = path.posix.basename(normalizeArtifactPath(relativePath));
  if (entry.isDirectory()) return basename === "__tests__";
  return (
    /(?:^|\.)test\.[^.]+$/i.test(basename)
    || /(?:^|\.)spec\.[^.]+$/i.test(basename)
    || /\.d\.(?:ts|mts|cts)(?:\.map)?$/i.test(basename)
    || /\.(?:js|mjs|cjs)\.map$/i.test(basename)
  );
};

const sanitizedRequiredServerFiles = (manifest, webWorkspacePath) => {
  if (!Array.isArray(manifest.files)) {
    throw new Error("Next required-server-files.json must declare a files array.");
  }
  const relativeAppDir = normalizeArtifactPath(manifest.relativeAppDir ?? webWorkspacePath);
  if (relativeAppDir !== webWorkspacePath) {
    throw new Error(`Next build belongs to ${relativeAppDir}, not ${webWorkspacePath}.`);
  }
  const config = structuredClone(manifest.config ?? {});
  config.outputFileTracingRoot = "../..";
  if (config.turbopack && typeof config.turbopack === "object") config.turbopack.root = "../..";
  return {
    ...manifest,
    config,
    appDir: ".",
    relativeAppDir: webWorkspacePath,
    files: manifest.files.map((entry) => requireSafeRelativePath(entry, "Next required runtime file")),
  };
};

const addEntry = (entries, relativePath, sourcePath, data) => {
  const normalized = requireSafeRelativePath(relativePath);
  requireAllowedReleasePath(normalized);
  const current = entries.get(normalized);
  if (current && current.sourcePath !== sourcePath && data === undefined) {
    throw new Error(`Conflicting release entry: ${normalized}`);
  }
  entries.set(normalized, { path: normalized, sourcePath, data, mode: 0o644 });
};

const requireRegularFile = async (sourceDir, relativePath, label = "Runtime file") => {
  const normalized = requireSafeRelativePath(relativePath, label);
  const absolutePath = path.join(sourceDir, ...normalized.split("/"));
  let details;
  try {
    details = await lstat(absolutePath);
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`${label} ${normalized} is missing.`);
    throw error;
  }
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error(`${label} must be a physical file: ${normalized}`);
  }
  requireAllowedReleasePath(normalized);
  return absolutePath;
};

const planReleaseEntries = async (sourceDir, gitSha) => {
  const [rootManifest, packageLock, workspaces] = await Promise.all([
    readJson(path.join(sourceDir, "package.json"), "Root package manifest"),
    readFile(path.join(sourceDir, "package-lock.json")),
    discoverWorkspaces(sourceDir),
  ]);
  const apiPath = startWorkspacePath(rootManifest, "start:api");
  const webPath = startWorkspacePath(rootManifest, "start:web");
  const apiWorkspace = workspaces.byPath.get(apiPath);
  const webWorkspace = workspaces.byPath.get(webPath);
  if (!apiWorkspace) throw new Error(`API runtime workspace is missing: ${apiPath}`);
  if (!webWorkspace) throw new Error(`Web runtime workspace is missing: ${webPath}`);
  const closure = internalRuntimeClosure([apiWorkspace, webWorkspace], workspaces);
  const entries = new Map();

  addEntry(entries, "package.json", path.join(sourceDir, "package.json"));
  addEntry(entries, "package-lock.json", path.join(sourceDir, "package-lock.json"));
  for (const releaseHostFile of RELEASE_HOST_REQUIRED_FILES) {
    addEntry(
      entries,
      releaseHostFile,
      await requireRegularFile(sourceDir, releaseHostFile, "Release Host required file"),
    );
  }
  for (const resourceRoot of API_BOOTSTRAP_RESOURCE_ROOTS) {
    for (const releasePath of await walkFiles(sourceDir, resourceRoot)) {
      addEntry(entries, releasePath, path.join(sourceDir, ...releasePath.split("/")));
    }
  }

  for (const workspace of closure) {
    const manifestPath = `${workspace.path}/package.json`;
    addEntry(entries, manifestPath, await requireRegularFile(sourceDir, manifestPath));
    if (workspace.path === webPath) continue;
    const main = workspace.manifest.main;
    if (typeof main !== "string" || !main) {
      throw new Error(`Runtime workspace ${workspace.manifest.name} must declare main.`);
    }
    await requireRegularFile(sourceDir, `${workspace.path}/${normalizeArtifactPath(main)}`, "Runtime main");
    for (const releasePath of await walkFiles(sourceDir, `${workspace.path}/dist`, {
      exclude: excludeBuildOnlyDistEntry,
    })) {
      addEntry(entries, releasePath, path.join(sourceDir, ...releasePath.split("/")));
    }
  }

  const requiredManifestPath = `${webPath}/.next/required-server-files.json`;
  const requiredManifestAbsolute = await requireRegularFile(sourceDir, requiredManifestPath, "Next runtime manifest");
  const rawRequiredManifest = await readJson(requiredManifestAbsolute, "Next runtime manifest");
  const requiredManifest = sanitizedRequiredServerFiles(rawRequiredManifest, webPath);
  const webBuildIdPath = `${webPath}/.next/BUILD_ID`;
  const webBuildId = (await readFile(await requireRegularFile(sourceDir, webBuildIdPath, "Next BUILD_ID"), "utf8")).trim();
  if (!webBuildId || /[\r\n]/.test(webBuildId)) throw new Error("Next BUILD_ID must be a non-empty single line.");
  if (webBuildId !== gitSha) {
    throw new Error(`Next BUILD_ID ${webBuildId} does not match release gitSha ${gitSha}; rebuild Web with ENERGYIQ_RELEASE_SHA=${gitSha}.`);
  }

  const webBuildFiles = await walkFiles(sourceDir, `${webPath}/.next`, {
    exclude: (relativePath, entry) => {
      const withinBuild = normalizeArtifactPath(relativePath).slice(`${webPath}/.next/`.length);
      const firstSegment = withinBuild.split("/")[0];
      return WEB_BUILD_EXCLUDES.has(firstSegment);
    },
  });
  for (const releasePath of webBuildFiles) {
    addEntry(entries, releasePath, path.join(sourceDir, ...releasePath.split("/")));
  }

  for (const declaredPath of requiredManifest.files) {
    const releasePath = `${webPath}/${declaredPath}`;
    addEntry(entries, releasePath, await requireRegularFile(sourceDir, releasePath, "Next declared runtime file"));
  }
  const configFileName = requiredManifest.config?.configFileName;
  if (typeof configFileName === "string" && configFileName) {
    if (!/\.(?:js|mjs|cjs)$/.test(configFileName)) {
      throw new Error(
        `Next config must be production-native .js/.mjs/.cjs, not dev-only TypeScript: ${configFileName}.`,
      );
    }
    const configPath = `${webPath}/${requireSafeRelativePath(configFileName, "Next config file")}`;
    addEntry(entries, configPath, await requireRegularFile(sourceDir, configPath, "Next config file"));
  }
  const tsconfigPath = requiredManifest.config?.typescript?.tsconfigPath;
  if (typeof tsconfigPath === "string" && tsconfigPath) {
    const typescriptConfig = `${webPath}/${requireSafeRelativePath(tsconfigPath, "Next TypeScript config")}`;
    addEntry(entries, typescriptConfig, await requireRegularFile(sourceDir, typescriptConfig, "Next TypeScript config"));
  }
  const publicPath = `${webPath}/public`;
  if (await pathExists(path.join(sourceDir, ...publicPath.split("/")))) {
    for (const releasePath of await walkFiles(sourceDir, publicPath)) {
      addEntry(entries, releasePath, path.join(sourceDir, ...releasePath.split("/")));
    }
  }

  addEntry(
    entries,
    requiredManifestPath,
    undefined,
    Buffer.from(`${JSON.stringify(requiredManifest, null, 2)}\n`, "utf8"),
  );
  addEntry(entries, ".release-sha", undefined, Buffer.from(`${gitSha}\n`, "utf8"));
  addEntry(entries, "RELEASE_SHA", undefined, Buffer.from(`${gitSha}\n`, "utf8"));

  return {
    entries: [...entries.values()].sort((left, right) => sortStrings(left.path, right.path)),
    packageLockHash: sha256(packageLock),
    webBuildId,
  };
};

const inspectEntry = async (entry, sourceDir) => {
  const body = entry.data ?? await readFile(entry.sourcePath);
  const localRoots = [sourceDir, process.env.USERPROFILE, process.env.HOME]
    .filter((value) => typeof value === "string" && value)
    .flatMap((value) => [value, value.replaceAll("\\", "/")]);
  for (const localRoot of new Set(localRoots)) {
    if (body.includes(Buffer.from(localRoot))) {
      throw new Error(`Build-host path leaked into release content: ${entry.path}`);
    }
  }
  return {
    ...entry,
    body,
    manifest: {
      path: entry.path,
      sha256: sha256(body),
      size: body.length,
      mode: "0644",
    },
  };
};

const writeTarString = (buffer, offset, length, value) => {
  const body = Buffer.from(value, "utf8");
  if (body.length > length) throw new Error(`Tar field is too long: ${value}`);
  body.copy(buffer, offset);
};

const writeTarOctal = (buffer, offset, length, value) => {
  const body = value.toString(8).padStart(length - 1, "0") + "\0";
  writeTarString(buffer, offset, length, body);
};

const splitTarPath = (entryPath) => {
  const bytes = Buffer.byteLength(entryPath);
  if (bytes <= 100) return { name: entryPath, prefix: "" };
  for (let index = entryPath.lastIndexOf("/"); index > 0; index = entryPath.lastIndexOf("/", index - 1)) {
    const prefix = entryPath.slice(0, index);
    const name = entryPath.slice(index + 1);
    if (Buffer.byteLength(name) <= 100 && Buffer.byteLength(prefix) <= 155) return { name, prefix };
  }
  throw new Error(`Release path exceeds deterministic ustar limits: ${entryPath}`);
};

const tarHeader = (entry, mtime) => {
  const header = Buffer.alloc(512);
  const { name, prefix } = splitTarPath(entry.path);
  writeTarString(header, 0, 100, name);
  writeTarOctal(header, 100, 8, entry.mode);
  writeTarOctal(header, 108, 8, 0);
  writeTarOctal(header, 116, 8, 0);
  writeTarOctal(header, 124, 12, entry.body.length);
  writeTarOctal(header, 136, 12, mtime);
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  writeTarString(header, 257, 6, "ustar\0");
  writeTarString(header, 263, 2, "00");
  writeTarString(header, 265, 32, "root");
  writeTarString(header, 297, 32, "root");
  writeTarString(header, 345, 155, prefix);
  const checksum = header.reduce((sum, value) => sum + value, 0);
  writeTarString(header, 148, 8, checksum.toString(8).padStart(6, "0") + "\0 ");
  return header;
};

const writeAll = async (handle, body, position) => {
  let offset = 0;
  while (offset < body.length) {
    const { bytesWritten } = await handle.write(body, offset, body.length - offset, position + offset);
    if (bytesWritten === 0) throw new Error("Artifact write made no progress.");
    offset += bytesWritten;
  }
  return position + body.length;
};

const writeTar = async (artifactPath, entries, builtAt) => {
  const mtime = Math.floor(new Date(builtAt).getTime() / 1000);
  const handle = await open(artifactPath, "wx");
  let position = 0;
  try {
    for (const entry of entries) {
      position = await writeAll(handle, tarHeader(entry, mtime), position);
      position = await writeAll(handle, entry.body, position);
      const padding = (512 - (entry.body.length % 512)) % 512;
      if (padding) position = await writeAll(handle, Buffer.alloc(padding), position);
    }
    position = await writeAll(handle, Buffer.alloc(1024), position);
    await handle.sync();
  } finally {
    await handle.close();
  }
};

const tarString = (buffer, offset, length) => buffer.subarray(offset, offset + length).toString("utf8").replace(/\0.*$/s, "");
const tarOctal = (buffer, offset, length) => {
  const value = tarString(buffer, offset, length).trim();
  return value ? Number.parseInt(value, 8) : 0;
};

const readTar = (archive) => {
  const entries = [];
  let offset = 0;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((value) => value === 0)) {
      const terminator = archive.subarray(offset);
      if (terminator.length !== 1024 || !terminator.every((value) => value === 0)) {
        throw new Error("Artifact contains trailing data after its deterministic tar terminator.");
      }
      return entries;
    }
    const storedChecksum = tarOctal(header, 148, 8);
    const checksumHeader = Buffer.from(header);
    checksumHeader.fill(0x20, 148, 156);
    const computedChecksum = checksumHeader.reduce((sum, value) => sum + value, 0);
    if (storedChecksum !== computedChecksum) throw new Error(`Artifact tar header checksum failed at offset ${offset}.`);
    const typeFlag = header[156];
    if (typeFlag !== 0 && typeFlag !== "0".charCodeAt(0)) {
      throw new Error(`Artifact entry type must be a regular file at offset ${offset}.`);
    }
    if (tarString(header, 257, 6) !== "ustar") throw new Error(`Artifact entry is not ustar at offset ${offset}.`);
    const name = tarString(header, 0, 100);
    const prefix = tarString(header, 345, 155);
    const entryPath = requireSafeRelativePath(prefix ? `${prefix}/${name}` : name, "Artifact entry");
    requireAllowedReleasePath(entryPath);
    const size = tarOctal(header, 124, 12);
    const mode = tarOctal(header, 100, 8);
    const uid = tarOctal(header, 108, 8);
    const gid = tarOctal(header, 116, 8);
    const mtime = tarOctal(header, 136, 12);
    if (mode !== 0o644 || uid !== 0 || gid !== 0) {
      throw new Error(`Artifact entry ownership or mode is not deterministic: ${entryPath}`);
    }
    const bodyStart = offset + 512;
    const bodyEnd = bodyStart + size;
    if (bodyEnd > archive.length) throw new Error(`Artifact entry is truncated: ${entryPath}`);
    if (entries.some((entry) => entry.path === entryPath)) throw new Error(`Artifact contains duplicate entry: ${entryPath}`);
    entries.push({ path: entryPath, mode, mtime, body: archive.subarray(bodyStart, bodyEnd) });
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
  throw new Error("Artifact is missing its deterministic tar terminator.");
};

const requireManifest = (manifest, artifactPath) => {
  if (manifest.manifestVersion !== 1) throw new Error("Unsupported release manifest version.");
  if (manifest.artifactFormat !== ARTIFACT_FORMAT) throw new Error("Unsupported release artifact format.");
  if (!RELEASE_SHA_PATTERN.test(manifest.gitSha ?? "")) throw new Error("Manifest gitSha is invalid.");
  if (!SHA256_PATTERN.test(manifest.packageLockHash ?? "")) throw new Error("Manifest packageLockHash is invalid.");
  if (!SHA256_PATTERN.test(manifest.artifactSha256 ?? "")) throw new Error("Manifest artifactSha256 is invalid.");
  if (manifest.artifactFile !== path.basename(artifactPath)) throw new Error("Manifest artifactFile does not match the artifact.");
  if (typeof manifest.nodeVersion !== "string" || !/^v\d+\.\d+\.\d+/.test(manifest.nodeVersion)) {
    throw new Error("Manifest nodeVersion is invalid.");
  }
  if (typeof manifest.webBuildId !== "string" || !manifest.webBuildId) throw new Error("Manifest webBuildId is missing.");
  if (typeof manifest.metadataSchemaRevision !== "string" || !manifest.metadataSchemaRevision) {
    throw new Error("Manifest metadataSchemaRevision is missing.");
  }
  const builtAt = new Date(manifest.builtAt);
  if (!Number.isFinite(builtAt.getTime()) || builtAt.toISOString() !== manifest.builtAt) {
    throw new Error("Manifest builtAt is invalid.");
  }
  if (!Array.isArray(manifest.entries)) throw new Error("Manifest entries are missing.");
};

export async function verifyReleaseArtifact({
  artifactPath,
  manifestPath,
  checksumPath,
  expectedGitSha,
  expectedNodeVersion,
  includeEntries = false,
}) {
  const [archive, manifest] = await Promise.all([
    readFile(artifactPath),
    readJson(manifestPath, "Release manifest"),
  ]);
  requireManifest(manifest, artifactPath);
  if (expectedGitSha !== undefined && manifest.gitSha !== expectedGitSha) {
    throw new Error(`Manifest gitSha mismatch: expected ${expectedGitSha}, got ${manifest.gitSha}.`);
  }
  if (expectedNodeVersion !== undefined && manifest.nodeVersion !== expectedNodeVersion) {
    throw new Error(`Manifest nodeVersion mismatch: expected ${expectedNodeVersion}, got ${manifest.nodeVersion}.`);
  }
  const actualArtifactSha = sha256(archive);
  if (actualArtifactSha !== manifest.artifactSha256) {
    throw new Error(`Artifact SHA256 mismatch: expected ${manifest.artifactSha256}, got ${actualArtifactSha}.`);
  }
  if (checksumPath) {
    const expectedChecksum = `${actualArtifactSha}  ${path.basename(artifactPath)}\n`;
    if (await readFile(checksumPath, "utf8") !== expectedChecksum) {
      throw new Error("Artifact checksum sidecar does not match the manifest.");
    }
  }
  const archiveEntries = readTar(archive);
  const expectedMtime = Math.floor(new Date(manifest.builtAt).getTime() / 1000);
  if (archiveEntries.some((entry) => entry.mtime !== expectedMtime)) {
    throw new Error("Artifact entry mtime does not match manifest builtAt.");
  }
  const actualEntries = archiveEntries.map((entry) => ({
    path: entry.path,
    sha256: sha256(entry.body),
    size: entry.body.length,
    mode: entry.mode.toString(8).padStart(4, "0"),
  }));
  assertManifestEntries(manifest.entries, actualEntries);
  const packageLockEntry = archiveEntries.find((candidate) => candidate.path === "package-lock.json");
  if (!packageLockEntry || sha256(packageLockEntry.body) !== manifest.packageLockHash) {
    throw new Error("Manifest packageLockHash does not match the archived package-lock.json.");
  }
  const webBuildIdEntry = archiveEntries.find((candidate) => candidate.path === `${WEB_BUILD_ROOT}/BUILD_ID`);
  if (!webBuildIdEntry || webBuildIdEntry.body.toString("utf8").trim() !== manifest.webBuildId) {
    throw new Error("Manifest webBuildId does not match the archived Next BUILD_ID.");
  }
  if (manifest.webBuildId !== manifest.gitSha) {
    throw new Error("Manifest webBuildId must equal manifest gitSha.");
  }
  for (const marker of [".release-sha", "RELEASE_SHA"]) {
    const entry = archiveEntries.find((candidate) => candidate.path === marker);
    if (!entry || entry.body.toString("utf8") !== `${manifest.gitSha}\n`) {
      throw new Error(`Release identity marker ${marker} does not match manifest gitSha.`);
    }
  }
  if (includeEntries) {
    return {
      manifest,
      entries: archiveEntries,
      [VERIFIED_ARTIFACT]: true,
    };
  }
  return manifest;
}

export async function extractVerifiedReleaseArtifact(verifiedArtifact, outputDir) {
  if (!verifiedArtifact?.[VERIFIED_ARTIFACT] || !Array.isArray(verifiedArtifact.entries)) {
    throw new Error("Release extraction requires the direct result of verifyReleaseArtifact(includeEntries=true).");
  }
  await requireDirectory("outputDir", outputDir);
  if ((await readdir(outputDir)).length > 0) {
    throw new Error("Release extraction outputDir must be empty.");
  }
  for (const entry of verifiedArtifact.entries) {
    const relativePath = requireSafeRelativePath(entry.path, "Verified artifact entry");
    const targetPath = path.join(outputDir, ...relativePath.split("/"));
    const relativeTarget = path.relative(outputDir, targetPath);
    if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) {
      throw new Error(`Verified artifact entry escapes outputDir: ${relativePath}`);
    }
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, entry.body, { flag: "wx", mode: 0o644 });
  }
}

const assertManifestEntries = (expected, actual) => {
  if (expected.length !== actual.length) {
    throw new Error(`Manifest entry count mismatch: expected ${expected.length}, got ${actual.length}.`);
  }
  for (let index = 0; index < expected.length; index += 1) {
    const expectedEntry = expected[index];
    const actualEntry = actual[index];
    requireAllowedReleasePath(expectedEntry.path);
    for (const field of ["path", "sha256", "size", "mode"]) {
      if (expectedEntry[field] !== actualEntry[field]) {
        throw new Error(`Manifest entry mismatch for ${expectedEntry.path}: ${field}.`);
      }
    }
  }
};

export async function createReleaseArtifact(input) {
  await requireDirectory("sourceDir", input.sourceDir);
  if (!path.isAbsolute(input.outputDir)) throw new Error("outputDir must be an absolute path.");
  if (!RELEASE_SHA_PATTERN.test(input.gitSha ?? "")) {
    throw new Error("gitSha must be a lowercase 40-character Git SHA.");
  }
  const builtAt = new Date(input.builtAt);
  if (!Number.isFinite(builtAt.getTime()) || builtAt.toISOString() !== input.builtAt) {
    throw new Error("builtAt must be an exact UTC ISO timestamp.");
  }
  if (typeof input.nodeVersion !== "string" || !/^v\d+\.\d+\.\d+/.test(input.nodeVersion)) {
    throw new Error("nodeVersion must be an exact Node version.");
  }
  if (typeof input.metadataSchemaRevision !== "string" || !input.metadataSchemaRevision.trim()) {
    throw new Error("metadataSchemaRevision is required.");
  }

  const sourceDir = path.resolve(input.sourceDir);
  const outputDir = path.resolve(input.outputDir);
  const { entries: plannedEntries, packageLockHash, webBuildId } = await planReleaseEntries(sourceDir, input.gitSha);
  const entries = [];
  for (const entry of plannedEntries) entries.push(await inspectEntry(entry, sourceDir));

  await mkdir(outputDir, { recursive: true });
  const artifactFile = `energyiq-${input.gitSha}.tar`;
  const manifestFile = `energyiq-${input.gitSha}.manifest.json`;
  const checksumFile = `energyiq-${input.gitSha}.sha256`;
  const artifactPath = path.join(outputDir, artifactFile);
  const manifestPath = path.join(outputDir, manifestFile);
  const checksumPath = path.join(outputDir, checksumFile);
  for (const target of [artifactPath, manifestPath, checksumPath]) {
    if (await pathExists(target)) throw new Error(`Immutable release output already exists: ${target}`);
  }

  const stagingDir = await mkdtemp(path.join(outputDir, ".artifact-staging-"));
  try {
    const stagedArtifact = path.join(stagingDir, artifactFile);
    const stagedManifest = path.join(stagingDir, manifestFile);
    const stagedChecksum = path.join(stagingDir, checksumFile);
    await writeTar(stagedArtifact, entries, input.builtAt);
    const artifactSha256 = await sha256File(stagedArtifact);
    const manifest = {
      manifestVersion: 1,
      artifactFormat: ARTIFACT_FORMAT,
      artifactFile,
      gitSha: input.gitSha,
      packageLockHash,
      builtAt: input.builtAt,
      nodeVersion: input.nodeVersion,
      metadataSchemaRevision: input.metadataSchemaRevision.trim(),
      webBuildId,
      artifactSha256,
      entries: entries.map((entry) => entry.manifest),
    };
    await writeFile(stagedManifest, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await writeFile(stagedChecksum, `${artifactSha256}  ${artifactFile}\n`, { encoding: "utf8", flag: "wx" });
    await verifyReleaseArtifact({
      artifactPath: stagedArtifact,
      manifestPath: stagedManifest,
      checksumPath: stagedChecksum,
    });
    await rename(stagedArtifact, artifactPath);
    await rename(stagedManifest, manifestPath);
    await rename(stagedChecksum, checksumPath);
    return { artifactPath, manifestPath, checksumPath, manifest };
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}

const runGit = (sourceDir, args) => new Promise((resolve, reject) => {
  const child = spawn("git", ["-C", sourceDir, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", reject);
  child.on("close", (code) => {
    if (code === 0) resolve(stdout.trim());
    else reject(new Error(`git ${args.join(" ")} failed (${code}): ${stderr.trim()}`));
  });
});

const detectMetadataSchemaRevision = async (sourceDir) => {
  const source = await readFile(path.join(sourceDir, "packages", "metadata", "src", "index.ts"), "utf8");
  const revisions = [...source.matchAll(/(?:recordSchemaMigration|runSchemaMigration)\(\s*db,\s*"([^"]+)"/g)]
    .map((match) => match[1]);
  const latest = revisions.at(-1);
  if (!latest) throw new Error("Could not derive metadata schema revision from the migration sequence.");
  return latest;
};

const parseCli = () => {
  const { values } = parseArgs({
    options: {
      "source-dir": { type: "string", default: process.cwd() },
      "output-dir": { type: "string", default: path.join(process.cwd(), "artifacts", "energyiq-releases") },
      "git-sha": { type: "string" },
      verify: { type: "boolean", default: false },
      artifact: { type: "string" },
      manifest: { type: "string" },
      checksum: { type: "string" },
      "expected-git-sha": { type: "string" },
      "expected-node-version": { type: "string" },
    },
  });
  return values;
};

const runCli = async () => {
  const values = parseCli();
  if (values.verify) {
    if (!values.artifact || !values.manifest) throw new Error("--verify requires --artifact and --manifest.");
    const manifest = await verifyReleaseArtifact({
      artifactPath: path.resolve(values.artifact),
      manifestPath: path.resolve(values.manifest),
      checksumPath: values.checksum ? path.resolve(values.checksum) : undefined,
      expectedGitSha: values["expected-git-sha"],
      expectedNodeVersion: values["expected-node-version"],
    });
    process.stdout.write(`Verified ${manifest.gitSha} ${manifest.artifactSha256}\n`);
    return;
  }

  const sourceDir = path.resolve(values["source-dir"]);
  const outputDir = path.resolve(values["output-dir"]);
  const [head, statusBody] = await Promise.all([
    runGit(sourceDir, ["rev-parse", "HEAD"]),
    runGit(sourceDir, ["status", "--porcelain", "--untracked-files=all"]),
  ]);
  if (values["git-sha"] && values["git-sha"] !== head) {
    throw new Error(`Requested gitSha ${values["git-sha"]} does not match source HEAD ${head}.`);
  }
  if (statusBody) throw new Error("Source checkout must be clean before creating a release artifact.");
  const builtAt = new Date(await runGit(sourceDir, ["show", "-s", "--format=%cI", head])).toISOString();
  const metadataSchemaRevision = await detectMetadataSchemaRevision(sourceDir);
  const result = await createReleaseArtifact({
    sourceDir,
    outputDir,
    gitSha: head,
    builtAt,
    nodeVersion: process.version,
    metadataSchemaRevision,
  });
  process.stdout.write(`${JSON.stringify({
    artifactPath: result.artifactPath,
    manifestPath: result.manifestPath,
    checksumPath: result.checksumPath,
    gitSha: result.manifest.gitSha,
    artifactSha256: result.manifest.artifactSha256,
  }, null, 2)}\n`);
};

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
