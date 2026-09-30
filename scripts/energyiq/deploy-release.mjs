#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
  extractVerifiedReleaseArtifact,
  verifyReleaseArtifact,
} from "./build-release-artifact.mjs";

const RELEASE_SHA_PATTERN = /^[0-9a-f]{40}$/;
const NODE_VERSION_PATTERN = /^v\d+\.\d+\.\d+(?:[-+].+)?$/;
const TRANSITIONAL_DEPENDENCY_INSTALL = "transitional-npm-ci";
const TRANSITIONAL_NPM_ARGS = ["ci", "--omit=dev"];
const RUNTIME_DEPENDENCY_PROBE = 'require("duckdb");require("sharp");';
// Complete npm install/ci root lifecycle; dependency package lifecycles stay enabled.
const ROOT_INSTALL_LIFECYCLE_SCRIPTS = [
  "preinstall",
  "install",
  "postinstall",
  "prepublish",
  "preprepare",
  "prepare",
  "postprepare",
];

const pathExists = async (value) => {
  try {
    await lstat(value);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
};

const defaultRun = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", reject);
  child.on("close", (code) => {
    if (code === 0) resolve({ stdout, stderr });
    else reject(new Error(`${command} ${args.join(" ")} failed (${code}): ${stderr.trim()}`));
  });
});

const defaultCheckHttp = async (url) => {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Smoke check failed (${response.status}): ${url}`);
};

const requireAbsoluteDirectory = async (label, value) => {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new Error(`${label} must be an absolute path.`);
  }
  const details = await lstat(value);
  if (!details.isDirectory() && !details.isSymbolicLink()) {
    throw new Error(`${label} must be a directory.`);
  }
};

const requireAbsolutePhysicalFile = async (label, value) => {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new Error(`${label} must be an absolute path.`);
  }
  const details = await lstat(value);
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error(`${label} must be a physical file.`);
  }
};

const resolveReleaseHostRuntime = async (nodeExecPath) => {
  if (typeof nodeExecPath !== "string" || !path.isAbsolute(nodeExecPath)) {
    throw new Error("Release Host Node executable must be an absolute path.");
  }
  const physicalNodeExecPath = await realpath(nodeExecPath);
  await requireAbsolutePhysicalFile("Release Host Node executable", physicalNodeExecPath);

  const nodeDirectory = path.dirname(physicalNodeExecPath);
  const npmCliCandidates = [
    path.join(nodeDirectory, "node_modules", "npm", "bin", "npm-cli.js"),
    path.resolve(nodeDirectory, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    path.resolve(nodeDirectory, "..", "share", "nodejs", "npm", "bin", "npm-cli.js"),
  ];
  for (const candidate of npmCliCandidates) {
    if (!await pathExists(candidate)) continue;
    const physicalNpmCliPath = await realpath(candidate);
    await requireAbsolutePhysicalFile("Release Host npm CLI", physicalNpmCliPath);
    if (path.basename(physicalNpmCliPath) !== "npm-cli.js") {
      throw new Error("Release Host npm CLI must resolve to the physical npm-cli.js file.");
    }
    return { physicalNodeExecPath, physicalNpmCliPath };
  }

  throw new Error(`Release Host npm CLI was not found in the Node distribution anchored at ${physicalNodeExecPath}.`);
};

const requireIndependentBackup = async (appRoot, backupPath) => {
  if (typeof backupPath !== "string" || !path.isAbsolute(backupPath)) {
    throw new Error("metadataBackupPath must be an absolute path.");
  }
  await lstat(backupPath);
  const [resolvedAppRoot, resolvedBackupPath] = await Promise.all([
    realpath(appRoot),
    realpath(backupPath),
  ]);
  const relative = path.relative(resolvedAppRoot, resolvedBackupPath);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error("Metadata backup must be outside the application root.");
  }
};

const acquireDeployLock = async (appRoot, releaseSha) => {
  const lockPath = path.join(appRoot, ".deploy.lock");
  let handle;
  try {
    handle = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(`Deploy lock already exists; inspect the active or interrupted release: ${lockPath}`);
    }
    throw error;
  }
  try {
    await handle.writeFile(`${JSON.stringify({
      releaseSha,
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
    })}\n`, "utf8");
    await handle.sync();
  } catch (error) {
    await handle.close();
    await unlink(lockPath).catch(() => {});
    throw error;
  }
  return { handle, lockPath };
};

const releaseDeployLock = async (lock, retain) => {
  await lock.handle.close();
  if (!retain) await unlink(lock.lockPath);
};

const replaceCurrentLink = async (currentLink, nextLink, previousLink) => {
  if (process.platform !== "win32") {
    await rename(nextLink, currentLink);
    return;
  }
  // Windows cannot atomically replace an existing directory junction. This
  // branch exists for local rehearsal only; production Linux uses rename(2).
  await rename(currentLink, previousLink);
  try {
    await rename(nextLink, currentLink);
  } catch (error) {
    await rename(previousLink, currentLink);
    throw error;
  }
  await unlink(previousLink);
};

const createReleaseLink = async (target, linkPath) => {
  await symlink(target, linkPath, process.platform === "win32" ? "junction" : "dir");
};

const smoke = async (urls, checkHttp) => {
  for (const url of urls) await checkHttp(url);
};

const defaultSleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs));

const waitForSmoke = async (urls, checkHttp, options = {}) => {
  const attempts = options.attempts ?? 60;
  const delayMs = options.delayMs ?? 1_000;
  const sleep = options.sleep ?? defaultSleep;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await smoke(urls, checkHttp);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(delayMs);
    }
  }
  throw lastError;
};

const requireReleaseIdentityMarkers = async (releaseDir, releaseSha) => {
  const expected = `${releaseSha}\n`;
  const [dotMarker, envMarker] = await Promise.all([
    readFile(path.join(releaseDir, ".release-sha"), "utf8"),
    readFile(path.join(releaseDir, "RELEASE_SHA"), "utf8"),
  ]);
  if (dotMarker !== expected || envMarker !== expected) {
    throw new Error("Release identity markers do not match the intended Git SHA.");
  }
};

const requireUnchangedPackageLock = async (releaseDir, expectedHash) => {
  const body = await readFile(path.join(releaseDir, "package-lock.json"));
  const actualHash = createHash("sha256").update(body).digest("hex");
  if (actualHash !== expectedHash) {
    throw new Error("Transitional dependency install modified or replaced package-lock.json.");
  }
};

const runTransitionalDependencyInstall = async (releaseDir, releaseHostRuntime, run) => {
  const packageJsonPath = path.join(releaseDir, "package.json");
  const originalPackageJson = await readFile(packageJsonPath);
  const installManifest = JSON.parse(originalPackageJson.toString("utf8"));
  if (installManifest.scripts && typeof installManifest.scripts === "object") {
    installManifest.scripts = { ...installManifest.scripts };
    for (const scriptName of ROOT_INSTALL_LIFECYCLE_SCRIPTS) {
      delete installManifest.scripts[scriptName];
    }
  }

  await writeFile(packageJsonPath, `${JSON.stringify(installManifest, null, 2)}\n`, "utf8");
  try {
    await run(
      releaseHostRuntime.physicalNodeExecPath,
      [releaseHostRuntime.physicalNpmCliPath, ...TRANSITIONAL_NPM_ARGS],
      { cwd: releaseDir },
    );
  } finally {
    await writeFile(packageJsonPath, originalPackageJson);
  }

  const restoredPackageJson = await readFile(packageJsonPath);
  if (!restoredPackageJson.equals(originalPackageJson)) {
    throw new Error("Transitional dependency install did not restore the verified root package.json.");
  }
};

const requirePhysicalCurrentRelease = async (appRoot, releasesRoot) => {
  const currentLink = path.join(appRoot, "current");
  const currentDetails = await lstat(currentLink);
  if (!currentDetails.isSymbolicLink()) throw new Error("current must be a symlink to a physical release directory.");
  const previousRelease = await realpath(currentLink);
  const previousRelative = path.relative(releasesRoot, previousRelease);
  if (previousRelative.startsWith("..") || path.isAbsolute(previousRelative)) {
    throw new Error("current resolves outside the releases directory.");
  }
  const previousDetails = await lstat(previousRelease);
  if (!previousDetails.isDirectory() || previousDetails.isSymbolicLink()) {
    throw new Error("current must resolve to a physical release directory, not another symlink.");
  }
  return { currentLink, previousRelease };
};

export async function deployEnergyIqRelease(input, dependencies = {}) {
  const run = dependencies.run ?? defaultRun;
  const checkHttp = dependencies.checkHttp ?? defaultCheckHttp;
  const verifyArtifact = dependencies.verifyArtifact ?? verifyReleaseArtifact;
  const extractArtifact = dependencies.extractArtifact ?? extractVerifiedReleaseArtifact;
  const smokeAttempts = dependencies.smokeAttempts ?? 60;
  const sleep = dependencies.sleep ?? defaultSleep;
  const releaseHostNodeVersion = dependencies.nodeVersion ?? process.version;
  const releaseHostNodeExecPath = dependencies.nodeExecPath ?? process.execPath;
  const releaseSha = input.releaseSha?.trim();

  if (!RELEASE_SHA_PATTERN.test(releaseSha ?? "")) {
    throw new Error("releaseSha must be a lowercase 40-character Git SHA.");
  }
  if (!NODE_VERSION_PATTERN.test(releaseHostNodeVersion)) {
    throw new Error("Release Host Node version is invalid.");
  }
  if (input.dependencyInstall !== TRANSITIONAL_DEPENDENCY_INSTALL) {
    throw new Error(`dependencyInstall must explicitly be ${TRANSITIONAL_DEPENDENCY_INSTALL} until DPL-03 is implemented.`);
  }
  await Promise.all([
    requireAbsoluteDirectory("appRoot", input.appRoot),
    requireAbsolutePhysicalFile("artifactPath", input.artifactPath),
    requireAbsolutePhysicalFile("manifestPath", input.manifestPath),
    requireAbsolutePhysicalFile("checksumPath", input.checksumPath),
    requireIndependentBackup(input.appRoot, input.metadataBackupPath),
  ]);
  if (!Array.isArray(input.smokeUrls) || input.smokeUrls.length < 3) {
    throw new Error("At least API health, Web login and exact Overview smoke URLs are required.");
  }
  if (!input.apiService || !input.webService) {
    throw new Error("Both API and Web service names are required.");
  }
  const releaseHostRuntime = await resolveReleaseHostRuntime(releaseHostNodeExecPath);

  const appRoot = await realpath(input.appRoot);
  const releasesRoot = path.join(appRoot, "releases");
  const nextLink = path.join(appRoot, ".current-next");
  const previousLink = path.join(appRoot, ".current-previous");
  const stagingDir = path.join(releasesRoot, `.staging-${releaseSha}`);
  const finalRelease = path.join(releasesRoot, releaseSha);
  await mkdir(releasesRoot, { recursive: true });

  const lock = await acquireDeployLock(appRoot, releaseSha);
  let retainLock = false;
  try {
    if (await pathExists(stagingDir)) throw new Error(`Staging path already exists: ${stagingDir}`);
    if (await pathExists(finalRelease)) throw new Error(`Release path already exists: ${finalRelease}`);
    if (await pathExists(nextLink) || await pathExists(previousLink)) {
      throw new Error("A previous release-link operation is incomplete; inspect it before retrying.");
    }
    const { currentLink, previousRelease } = await requirePhysicalCurrentRelease(appRoot, releasesRoot);

    // No extraction, dependency install, current switch or restart is allowed
    // before the exact Artifact/Manifest/checksum/Node/SHA contract passes.
    const verifiedArtifact = await verifyArtifact({
      artifactPath: input.artifactPath,
      manifestPath: input.manifestPath,
      checksumPath: input.checksumPath,
      expectedGitSha: releaseSha,
      expectedNodeVersion: releaseHostNodeVersion,
      includeEntries: true,
    });
    if (verifiedArtifact?.manifest?.gitSha !== releaseSha) {
      throw new Error("Verified Artifact gitSha does not match releaseSha.");
    }
    if (verifiedArtifact?.manifest?.nodeVersion !== releaseHostNodeVersion) {
      throw new Error("Verified Artifact Node version does not match the Release Host.");
    }

    await smoke(input.smokeUrls, checkHttp);
    await mkdir(stagingDir);
    await extractArtifact(verifiedArtifact, stagingDir);
    await writeFile(
      path.join(stagingDir, "release-manifest.json"),
      `${JSON.stringify(verifiedArtifact.manifest, null, 2)}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o644 },
    );

    // DPL-03 has not selected a dependency artifact/layer. This explicit seam
    // installs into this staging release only, never reuses or mutates another
    // release's node_modules. Dependency lifecycle scripts remain enabled so
    // native DuckDB and Sharp bindings are installed for this exact Node. Root
    // install lifecycles are suppressed temporarily because this repository's
    // postinstall is a development full build; the verified manifest is restored.
    await runTransitionalDependencyInstall(stagingDir, releaseHostRuntime, run);
    await requireUnchangedPackageLock(stagingDir, verifiedArtifact.manifest.packageLockHash);
    try {
      await run(
        releaseHostRuntime.physicalNodeExecPath,
        ["-e", RUNTIME_DEPENDENCY_PROBE],
        { cwd: stagingDir },
      );
    } catch (error) {
      throw new Error("Runtime dependency probe failed before current switch.", { cause: error });
    }
    await requireReleaseIdentityMarkers(stagingDir, releaseSha);
    await rename(stagingDir, finalRelease);

    const finalDetails = await lstat(finalRelease);
    if (!finalDetails.isDirectory() || finalDetails.isSymbolicLink()) {
      throw new Error("Final release must be a physical directory.");
    }

    await createReleaseLink(finalRelease, nextLink);
    await replaceCurrentLink(currentLink, nextLink, previousLink);
    try {
      await run("systemctl", ["restart", input.apiService, input.webService]);
      await waitForSmoke(input.smokeUrls, checkHttp, { attempts: smokeAttempts, sleep });
    } catch (deployError) {
      try {
        if (await pathExists(nextLink)) {
          throw new Error("Rollback refused because the next link still exists.");
        }
        await createReleaseLink(previousRelease, nextLink);
        await replaceCurrentLink(currentLink, nextLink, previousLink);
        await run("systemctl", ["restart", input.apiService, input.webService]);
        await waitForSmoke(input.smokeUrls, checkHttp, { attempts: smokeAttempts, sleep });
      } catch (rollbackError) {
        retainLock = true;
        throw new Error("New release failed and rollback verification also failed; deploy lock retained.", {
          cause: new AggregateError([deployError, rollbackError]),
        });
      }
      throw deployError;
    }

    return {
      releaseSha,
      previousRelease,
      finalRelease,
      dependencyInstall: TRANSITIONAL_DEPENDENCY_INSTALL,
      releaseHostNodeVersion,
    };
  } finally {
    await releaseDeployLock(lock, retainLock);
  }
}

const parseCli = () => {
  const { values } = parseArgs({
    options: {
      "app-root": { type: "string" },
      artifact: { type: "string" },
      manifest: { type: "string" },
      checksum: { type: "string" },
      "release-sha": { type: "string" },
      "metadata-backup": { type: "string" },
      "dependency-install": { type: "string" },
      "api-service": { type: "string" },
      "web-service": { type: "string" },
      "smoke-url": { type: "string", multiple: true },
    },
  });
  return {
    appRoot: values["app-root"],
    artifactPath: values.artifact,
    manifestPath: values.manifest,
    checksumPath: values.checksum,
    releaseSha: values["release-sha"],
    metadataBackupPath: values["metadata-backup"],
    dependencyInstall: values["dependency-install"],
    apiService: values["api-service"],
    webService: values["web-service"],
    smokeUrls: values["smoke-url"] ?? [],
  };
};

const isDirectCliInvocation = (moduleUrl, argvEntry) => Boolean(argvEntry)
  && realpathSync(fileURLToPath(moduleUrl)) === realpathSync(path.resolve(argvEntry));

if (isDirectCliInvocation(import.meta.url, process.argv[1])) {
  deployEnergyIqRelease(parseCli())
    .then(({ releaseSha, dependencyInstall }) => {
      process.stdout.write(`Released ${releaseSha} with explicit ${dependencyInstall} dependency seam\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}
