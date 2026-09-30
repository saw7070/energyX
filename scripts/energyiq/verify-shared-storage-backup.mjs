#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import {
  chmodSync,
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const execFile = promisify(execFileCallback);
export const TOOL_ID = "energyiq-shared-storage-backup";
export const MANAGED_MARKER_CONTENT = `${TOOL_ID}:v1`;
export const REQUIRED_ENERGY_TABLES = [
  "energy_project_fact_state",
  "normalized_meter_readings",
  "energy_interval_facts",
  "energy_quality_events",
];
export const REQUIRED_METADATA_TABLES = [
  "users",
  "workspaces",
  "energyiq_projects",
  "energyiq_data_snapshots",
  "file_assets",
  "artifacts",
  "energyiq_overview_ai_artifacts",
];

export const validateArchiveEntries = (listing) => {
  const entries = listing.split(/\r?\n/u).filter(Boolean);
  if (entries.length === 0) throw new Error("Backup archive is empty.");
  for (const entry of entries) {
    if (entry.includes("\\") || entry.startsWith("/") || entry.includes("\0")) {
      throw new Error(`Unsafe archive entry: ${entry}`);
    }
    const normalized = path.posix.normalize(entry.replace(/^\.\//u, ""));
    if (normalized !== "storage" && !normalized.startsWith("storage/")) {
      throw new Error(`Archive entry is outside storage/: ${entry}`);
    }
    if (normalized.split("/").includes("..")) throw new Error(`Archive traversal entry: ${entry}`);
  }
  return entries;
};

export const parseSha256Manifest = (content) => {
  const entries = new Map();
  for (const line of content.split(/\r?\n/u).filter(Boolean)) {
    const match = /^([a-f0-9]{64}) {2}(.+)$/u.exec(line);
    if (!match) throw new Error(`Malformed SHA-256 manifest line: ${line}`);
    const relativePath = match[2];
    validateArchiveEntries(relativePath);
    if (entries.has(relativePath)) throw new Error(`Duplicate manifest path: ${relativePath}`);
    entries.set(relativePath, match[1]);
  }
  if (entries.size === 0) throw new Error("SHA-256 manifest is empty.");
  return entries;
};

export const parseNamedSha256 = (content, expectedName) => {
  const lines = content.split(/\r?\n/u).filter(Boolean);
  if (lines.length !== 1) throw new Error(`Expected one SHA-256 line for ${expectedName}.`);
  const match = /^([a-f0-9]{64}) {2}([^/\\]+)$/u.exec(lines[0]);
  if (!match || match[2] !== expectedName) throw new Error(`Malformed SHA-256 line for ${expectedName}.`);
  return match[1];
};

const hashFile = (filePath) => new Promise((resolve, reject) => {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath);
  stream.on("data", (chunk) => hash.update(chunk));
  stream.on("error", reject);
  stream.on("end", () => resolve(hash.digest("hex")));
});

const walkFiles = (root) => {
  const files = [];
  const visit = (directory) => {
    for (const name of readdirSync(directory)) {
      const candidate = path.join(directory, name);
      const stat = lstatSync(candidate);
      if (stat.isSymbolicLink()) throw new Error(`Restore contains a symlink: ${candidate}`);
      if (stat.isDirectory()) visit(candidate);
      else if (stat.isFile()) files.push(candidate);
      else throw new Error(`Restore contains an unsupported entry: ${candidate}`);
    }
  };
  visit(root);
  return files.sort();
};

const isWithin = (parent, candidate) => candidate === parent || candidate.startsWith(`${parent}${path.sep}`);

const realDirectory = (input, label) => {
  if (!path.isAbsolute(input)) throw new Error(`${label} must be absolute.`);
  const stat = lstatSync(input);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} must be a real directory.`);
  return realpathSync(input);
};

const resolveDirectoryBeforeCreate = (input) => {
  if (!path.isAbsolute(input)) throw new Error("restore-parent must be absolute.");
  let existing = input;
  const missingSegments = [];
  while (!existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) throw new Error("restore-parent has no existing ancestor.");
    missingSegments.unshift(path.basename(existing));
    existing = parent;
  }
  const existingReal = realDirectory(existing, "restore-parent ancestor");
  return path.join(existingReal, ...missingSegments);
};

const openDuckDb = (duckdb, filePath) => new Promise((resolve, reject) => {
  const database = new duckdb.Database(filePath, (error) => error ? reject(error) : resolve(database));
});

const duckDbAll = (database, sql) => new Promise((resolve, reject) => {
  database.all(sql, (error, rows) => error ? reject(error) : resolve(rows));
});

const closeDuckDb = (database) => new Promise((resolve, reject) => {
  database.close((error) => error ? reject(error) : resolve());
});

const systemdServiceIdentity = async (service) => {
  if (!/^[A-Za-z0-9_.@-]+\.service$/u.test(service)) throw new Error("api-service is invalid.");
  const propertyValue = async (property) => {
    const { stdout } = await execFile("systemctl", [
      "show",
      service,
      `--property=${property}`,
      "--value",
    ]);
    return stdout.trim();
  };
  const user = await propertyValue("User");
  if (!user || user === "root" || !/^[A-Za-z_][A-Za-z0-9_-]*$/u.test(user)) {
    throw new Error(`API service must declare a non-root named User: ${service}`);
  }
  let group = await propertyValue("Group");
  if (!group) {
    const { stdout } = await execFile("id", ["--group", "--name", user]);
    group = stdout.trim();
  }
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/u.test(group)) {
    throw new Error(`API service Group is invalid: ${service}`);
  }
  const [{ stdout: uidOutput }, { stdout: groupEntry }] = await Promise.all([
    execFile("id", ["--user", user]),
    execFile("getent", ["group", group]),
  ]);
  const uid = Number(uidOutput.trim());
  const gid = Number(groupEntry.split(":")[2]);
  if (!Number.isSafeInteger(uid) || uid < 1 || !Number.isSafeInteger(gid) || gid < 1) {
    throw new Error(`API service numeric identity is invalid: ${service}`);
  }
  return { service, user, group, uid, gid };
};

const proveServiceTreeAccess = async (storageDir, identity) => {
  const probe = `
    set -Eeuo pipefail
    root="."
    unreadable="$(find "$root" -type f ! -readable -print -quit)"
    [[ -z "$unreadable" ]] || { printf 'unreadable restored file: %s\\n' "$unreadable" >&2; exit 1; }
    while IFS= read -r -d '' directory; do
      probe="$directory/.energyiq-restore-write-probe-$$"
      : > "$probe"
      rm -f -- "$probe"
    done < <(find "$root" -type d -print0)
  `;
  const dropPrivileges = `
    set -Eeuo pipefail
    cd -- "$1"
    exec setpriv --reuid="$2" --regid="$3" --clear-groups \
      bash -c "$4" energyiq-restore-access-probe
  `;
  await execFile("bash", [
    "-c", dropPrivileges, "energyiq-restore-access-wrapper",
    storageDir, String(identity.uid), String(identity.gid), probe,
  ], { maxBuffer: 64 * 1024 * 1024 });
};

export const verifyBackup = async (input) => {
  if (typeof process.getuid !== "function" || process.getuid() !== 0) {
    throw new Error("Backup restore verification must run as root.");
  }
  if (!path.isAbsolute(input.backupDir)) throw new Error("backup-dir must be absolute.");
  const backupStat = lstatSync(input.backupDir);
  if (!backupStat.isDirectory() || backupStat.isSymbolicLink()) {
    throw new Error("backup-dir must be a real directory.");
  }
  const backupDir = realpathSync(input.backupDir);
  const markerPath = path.join(backupDir, ".energyiq-managed-backup");
  if (readFileSync(markerPath, "utf8").trim() !== MANAGED_MARKER_CONTENT) {
    throw new Error("Backup is not managed by this tool.");
  }
  const metadata = JSON.parse(readFileSync(path.join(backupDir, "metadata.json"), "utf8"));
  if (metadata.tool !== TOOL_ID || metadata.schemaVersion !== 1) {
    throw new Error("Backup metadata identity is invalid.");
  }
  if (!Number.isSafeInteger(metadata.fileCount) || metadata.fileCount < 1) {
    throw new Error("Backup metadata fileCount is invalid.");
  }

  const archivePath = path.join(backupDir, "storage.tar.zst");
  const archiveChecksum = parseNamedSha256(
    readFileSync(path.join(backupDir, "archive.sha256"), "utf8"),
    "storage.tar.zst",
  );
  if (await hashFile(archivePath) !== archiveChecksum || metadata.archiveSha256 !== archiveChecksum) {
    throw new Error("Backup archive SHA-256 does not match metadata.");
  }

  const { stdout: archiveListing } = await execFile("tar", ["--zstd", "-tf", archivePath], {
    maxBuffer: 64 * 1024 * 1024,
  });
  validateArchiveEntries(archiveListing);
  const { stdout: verboseListing } = await execFile("tar", ["--zstd", "-tvf", archivePath], {
    maxBuffer: 64 * 1024 * 1024,
  });
  for (const line of verboseListing.split(/\r?\n/u).filter(Boolean)) {
    if (line[0] !== "-" && line[0] !== "d") throw new Error(`Archive contains a link or special entry: ${line}`);
  }

  const appRoot = realDirectory(input.appRoot, "app-root");
  const storageRoot = realDirectory(input.storageRoot, "storage-root");
  if (storageRoot !== path.join(appRoot, "shared", "storage")) {
    throw new Error("storage-root must be the app-root Shared Storage path.");
  }
  const restoreCandidate = resolveDirectoryBeforeCreate(input.restoreParent);
  const forbiddenRoots = [appRoot, storageRoot, backupDir];
  for (const forbiddenInput of input.forbidRoots ?? []) {
    forbiddenRoots.push(realDirectory(forbiddenInput, "forbid-root"));
  }
  for (const forbidden of new Set(forbiddenRoots)) {
    if (isWithin(forbidden, restoreCandidate) || isWithin(restoreCandidate, forbidden)) {
      throw new Error(`restore-parent overlaps forbidden root: ${forbidden}`);
    }
  }
  const serviceIdentity = await systemdServiceIdentity(input.apiService);
  mkdirSync(restoreCandidate, { recursive: true, mode: 0o700 });
  const restoreParent = realpathSync(restoreCandidate);

  const restoreDir = mkdtempSync(path.join(restoreParent, "energyiq-restore-verify-"));
  chmodSync(restoreDir, 0o700);
  let result;
  try {
    await execFile("tar", ["--zstd", "--same-owner", "-xf", archivePath, "-C", restoreDir], {
      maxBuffer: 64 * 1024 * 1024,
    });
    const storageDir = realpathSync(path.join(restoreDir, "storage"));
    if (!isWithin(realpathSync(restoreDir), storageDir)) throw new Error("Restored storage escaped isolation root.");

    const manifest = parseSha256Manifest(readFileSync(path.join(backupDir, "manifest.sha256"), "utf8"));
    const restoredFiles = walkFiles(storageDir);
    if (restoredFiles.length !== manifest.size || restoredFiles.length !== metadata.fileCount) {
      throw new Error(
        `Restored file count mismatch: files=${restoredFiles.length} manifest=${manifest.size} metadata=${metadata.fileCount}`,
      );
    }
    for (const filePath of restoredFiles) {
      const relative = path.relative(restoreDir, filePath).split(path.sep).join("/");
      const expected = manifest.get(relative);
      if (!expected || await hashFile(filePath) !== expected) {
        throw new Error(`Restored SHA-256 mismatch: ${relative}`);
      }
    }

    const sqliteResults = [];
    for (const filePath of restoredFiles.filter((candidate) => candidate.endsWith(".sqlite"))) {
      const database = new DatabaseSync(filePath);
      try {
        const integrityRows = database.prepare("PRAGMA integrity_check").all();
        if (integrityRows.length !== 1 || integrityRows[0].integrity_check !== "ok") {
          throw new Error(`SQLite integrity_check failed: ${filePath}`);
        }
        const tables = database.prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
        ).all().map((row) => row.name);
        const relative = path.relative(restoreDir, filePath).split(path.sep).join("/");
        if (relative === "storage/metadata/workbench.sqlite") {
          const missing = REQUIRED_METADATA_TABLES.filter((table) => !tables.includes(table));
          if (missing.length > 0) throw new Error(`Metadata tables missing: ${missing.join(", ")}`);
        }
        sqliteResults.push({ path: relative, integrityCheck: "ok", tableCount: tables.length });
      } finally {
        database.close();
      }
    }
    if (!sqliteResults.some(({ path: relative }) => relative === "storage/metadata/workbench.sqlite")) {
      throw new Error("Canonical Metadata SQLite is missing from the restored backup.");
    }

    const requireFromRoot = createRequire(path.join(input.duckdbModuleRoot, "package.json"));
    const duckdb = requireFromRoot("duckdb");
    const duckdbResults = [];
    for (const filePath of restoredFiles.filter((candidate) => candidate.endsWith(".duckdb"))) {
      const database = await openDuckDb(duckdb, filePath);
      try {
        const rows = await duckDbAll(database,
          "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' AND table_type = 'BASE TABLE' ORDER BY table_name",
        );
        const tables = rows.map((row) => row.table_name);
        const relative = path.relative(restoreDir, filePath).split(path.sep).join("/");
        const isProjectFactStore = /storage\/energy\/[^/]+\/energy\.duckdb$/u.test(relative);
        if (isProjectFactStore) {
          const missing = REQUIRED_ENERGY_TABLES.filter((table) => !tables.includes(table));
          if (missing.length > 0) throw new Error(`Energy Fact tables missing in ${relative}: ${missing.join(", ")}`);
        }
        duckdbResults.push({ path: relative, tableCount: tables.length, requiredEnergyTables: isProjectFactStore });
      } finally {
        await closeDuckDb(database);
      }
    }
    if (!duckdbResults.some(({ requiredEnergyTables }) => requiredEnergyTables)) {
      throw new Error("No canonical Energy fact store was restored and verified.");
    }
    for (const storeId of input.expectedEnergyStores) {
      const expectedPath = `storage/energy/${storeId}/energy.duckdb`;
      if (!duckdbResults.some(({ path: relative, requiredEnergyTables }) => (
        relative === expectedPath && requiredEnergyTables
      ))) {
        throw new Error(`Expected Energy fact store is missing or invalid: ${expectedPath}`);
      }
    }

    const fileAssetsDir = path.join(storageDir, "files");
    const fileAssetCount = existsSync(fileAssetsDir) ? walkFiles(fileAssetsDir).length : 0;
    await proveServiceTreeAccess(storageDir, serviceIdentity);
    result = {
      backupId: metadata.backupId,
      archiveSha256: archiveChecksum,
      restoredPath: restoreDir,
      fileCount: restoredFiles.length,
      fileAssetCount,
      sqlite: sqliteResults,
      duckdb: duckdbResults,
      checksumVerification: "passed",
      serviceAccess: {
        ...serviceIdentity,
        readable: "passed",
        writable: "passed",
      },
      cleanupRequested: input.cleanup,
    };
  } finally {
    if (input.cleanup) {
      const resolvedParent = realpathSync(restoreParent);
      const resolvedRestore = existsSync(restoreDir) ? realpathSync(restoreDir) : restoreDir;
      if (!isWithin(resolvedParent, resolvedRestore)
        || !path.basename(resolvedRestore).startsWith("energyiq-restore-verify-")) {
        throw new Error("Refusing to clean an unverified restore path.");
      }
      rmSync(resolvedRestore, { recursive: true, force: false });
    }
  }
  return result;
};

const parseCli = (args) => {
  const values = { forbidRoots: [], expectedEnergyStores: [], cleanup: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--cleanup") values.cleanup = true;
    else if (arg === "--forbid-root") values.forbidRoots.push(args[++index]);
    else if (arg === "--backup-dir") values.backupDir = args[++index];
    else if (arg === "--restore-parent") values.restoreParent = args[++index];
    else if (arg === "--duckdb-module-root") values.duckdbModuleRoot = args[++index];
    else if (arg === "--app-root") values.appRoot = args[++index];
    else if (arg === "--storage-root") values.storageRoot = args[++index];
    else if (arg === "--expected-energy-store") values.expectedEnergyStores.push(args[++index]);
    else if (arg === "--api-service") values.apiService = args[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  for (const required of ["backupDir", "restoreParent", "duckdbModuleRoot", "appRoot", "storageRoot"]) {
    if (!values[required] || !path.isAbsolute(values[required])) throw new Error(`Missing absolute --${required.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}.`);
  }
  if (!values.apiService || !/^[A-Za-z0-9_.@-]+\.service$/u.test(values.apiService)) {
    throw new Error("Missing or invalid --api-service.");
  }
  if (values.expectedEnergyStores.length === 0) {
    throw new Error("At least one --expected-energy-store is required.");
  }
  const uniqueStores = new Set();
  for (const storeId of values.expectedEnergyStores) {
    if (!storeId || !/^[A-Za-z0-9._-]+$/u.test(storeId) || storeId === "." || storeId === "..") {
      throw new Error(`Invalid --expected-energy-store: ${storeId ?? "missing"}`);
    }
    if (uniqueStores.has(storeId)) throw new Error(`Duplicate --expected-energy-store: ${storeId}`);
    uniqueStores.add(storeId);
  }
  return values;
};

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const input = parseCli(process.argv.slice(2));
  verifyBackup(input).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
