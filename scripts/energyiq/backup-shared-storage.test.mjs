import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import {
  parseNamedSha256,
  parseSha256Manifest,
  REQUIRED_ENERGY_TABLES,
  REQUIRED_METADATA_TABLES,
  validateArchiveEntries,
} from "./verify-shared-storage-backup.mjs";

const root = path.resolve(import.meta.dirname, "..", "..");
const backupScript = path.join(root, "scripts", "energyiq", "backup-shared-storage.sh");
const preflightScript = path.join(root, "scripts", "energyiq", "shared-storage-backup-preflight.mjs");
const serviceUnit = path.join(root, "deploy", "systemd", "energyiq-shared-storage-backup.service");
const timerUnit = path.join(root, "deploy", "systemd", "energyiq-shared-storage-backup.timer");
const behaviorHarness = path.join(root, "scripts", "energyiq", "backup-shared-storage.behavior.test.sh");
const bashCheckoutPaths = [
  "scripts/energyiq/backup-shared-storage.behavior.test.sh",
  "scripts/energyiq/backup-shared-storage.sh",
  "scripts/energyiq/test-fixtures/bin/curl",
  "scripts/energyiq/test-fixtures/bin/df",
  "scripts/energyiq/test-fixtures/bin/sleep",
  "scripts/energyiq/test-fixtures/bin/systemctl",
];
const linuxCheckoutPaths = [
  ...bashCheckoutPaths,
  "deploy/systemd/energyiq-shared-storage-backup.service",
  "deploy/systemd/energyiq-shared-storage-backup.timer",
];

const toBashPath = (filePath) => process.platform === "win32"
  ? filePath.replace(/^([A-Za-z]):\\/u, (_, drive) => `/mnt/${drive.toLowerCase()}/`).replaceAll("\\", "/")
  : filePath;

const runBehaviorScenario = (scenario) => spawnSync("bash", [
  toBashPath(behaviorHarness),
  scenario,
  toBashPath(backupScript),
  toBashPath(preflightScript),
  toBashPath(serviceUnit),
], { encoding: "utf8" });

test("clean Git checkout keeps backup Linux payloads LF with autocrlf enabled", () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "energyiq-backup-checkout-"));
  const checkoutRoot = path.join(temporaryRoot, "checkout");
  try {
    execFileSync("git", ["clone", "--quiet", "--no-checkout", "--no-hardlinks", root, checkoutRoot]);
    execFileSync("git", ["-C", checkoutRoot, "config", "core.autocrlf", "true"]);
    execFileSync("git", ["-C", checkoutRoot, "checkout", "--quiet", "--detach", "HEAD"]);

    for (const relativePath of linuxCheckoutPaths) {
      const body = readFileSync(path.join(checkoutRoot, ...relativePath.split("/")));
      assert.equal(body.includes(0x0d), false, `${relativePath} contains CR bytes after a clean checkout`);
    }
    for (const relativePath of bashCheckoutPaths) {
      const scriptPath = path.join(checkoutRoot, ...relativePath.split("/"));
      const syntax = spawnSync("bash", ["-n", toBashPath(scriptPath)], { encoding: "utf8" });
      assert.equal(syntax.status, 0, `${relativePath} is not valid Bash:\n${syntax.stderr}`);
    }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("backup archive entries cannot escape the complete storage root", () => {
  assert.deepEqual(validateArchiveEntries("storage/\nstorage/metadata/workbench.sqlite\n"), [
    "storage/",
    "storage/metadata/workbench.sqlite",
  ]);
  assert.throws(() => validateArchiveEntries("../production/storage\n"), /outside storage/u);
  assert.throws(() => validateArchiveEntries("/opt/energyiq-datafoundry/shared/storage\n"), /Unsafe/u);
  assert.throws(() => validateArchiveEntries("storage\\metadata\\workbench.sqlite\n"), /Unsafe/u);
});

test("SHA-256 manifests are strict, unique, and bound to safe relative paths", () => {
  const digest = "a".repeat(64);
  assert.equal(parseSha256Manifest(`${digest}  storage/metadata/workbench.sqlite\n`).size, 1);
  assert.throws(
    () => parseSha256Manifest(`${digest}  storage/a\n${digest}  storage/a\n`),
    /Duplicate/u,
  );
  assert.equal(parseNamedSha256(`${digest}  storage.tar.zst\n`, "storage.tar.zst"), digest);
  assert.throws(() => parseNamedSha256(`${digest}  other.tar.zst\n`, "storage.tar.zst"), /Malformed/u);
});

test("database restore gates name the production Metadata and Energy Fact tables", () => {
  assert.deepEqual(REQUIRED_ENERGY_TABLES, [
    "energy_project_fact_state",
    "normalized_meter_readings",
    "energy_interval_facts",
    "energy_quality_events",
  ]);
  assert.ok(REQUIRED_METADATA_TABLES.includes("energyiq_projects"));
  assert.ok(REQUIRED_METADATA_TABLES.includes("energyiq_data_snapshots"));
  assert.ok(REQUIRED_METADATA_TABLES.includes("file_assets"));
  assert.ok(REQUIRED_METADATA_TABLES.includes("energyiq_overview_ai_artifacts"));
});

test("preflight passes an integral idle Metadata DB and refuses active writers", () => {
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "energyiq-backup-preflight-"));
  try {
    const metadataDirectory = path.join(temporaryRoot, "metadata");
    mkdirSync(metadataDirectory, { recursive: true });
    const databasePath = path.join(metadataDirectory, "workbench.sqlite");
    const database = new DatabaseSync(databasePath);
    database.exec(`
      CREATE TABLE energyiq_source_sync_runs (id TEXT PRIMARY KEY, status TEXT NOT NULL);
      CREATE TABLE runs (id TEXT PRIMARY KEY, status TEXT NOT NULL);
      INSERT INTO energyiq_source_sync_runs VALUES ('completed-sync', 'succeeded');
      INSERT INTO runs VALUES ('completed-run', 'completed');
    `);
    database.close();

    const idle = spawnSync(process.execPath, [preflightScript, "--storage-root", temporaryRoot], {
      encoding: "utf8",
    });
    assert.equal(idle.status, 0, idle.stderr);
    assert.deepEqual(JSON.parse(idle.stdout), {
      metadataQuickCheck: "ok",
      runningSourceSyncs: 0,
      runningAgentRuns: 0,
    });

    const activeDatabase = new DatabaseSync(databasePath);
    activeDatabase.exec("INSERT INTO energyiq_source_sync_runs VALUES ('active-sync', 'running')");
    activeDatabase.close();
    const active = spawnSync(process.execPath, [preflightScript, "--storage-root", temporaryRoot], {
      encoding: "utf8",
    });
    assert.notEqual(active.status, 0);
    assert.match(active.stderr, /active writers/u);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("create rejects a broad backup root without changing its permissions", () => {
  const result = runBehaviorScenario("reject-broad-create-root");
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("create rejects an application root inside the backup root without touching it", () => {
  const result = runBehaviorScenario("reject-create-app-inside-backup-root");
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("prune rejects a broad backup root without touching its contents", () => {
  const result = runBehaviorScenario("reject-broad-prune-root");
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("prune rejects a managed directory inside the application root", () => {
  const result = runBehaviorScenario("reject-prune-inside-app-root");
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("prune rejects an application root inside the backup root without touching it", () => {
  const result = runBehaviorScenario("reject-prune-app-inside-backup-root");
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("prune rejects filesystem app root without touching the managed tree", () => {
  const result = runBehaviorScenario("reject-prune-filesystem-app-root");
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("create and prune reject filesystem root without changing its permissions", () => {
  const result = runBehaviorScenario("reject-filesystem-root");
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("create restarts the API and rechecks readiness after a readiness failure", () => {
  const result = runBehaviorScenario("recover-after-readiness-failure");
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("persistent readiness failure is CRITICAL after restart and removes the partial backup", () => {
  const result = runBehaviorScenario("persistent-readiness-failure-is-critical");
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("create recovers the API when stop fails after making it inactive", () => {
  const result = runBehaviorScenario("recover-after-stop-failure");
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("create retries API recovery when the first start fails", () => {
  const result = runBehaviorScenario("recover-after-start-failure");
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("SIGTERM exits nonzero after restoring the API and removing the partial backup", () => {
  const result = runBehaviorScenario("signal-term-cleans-up");
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("SIGHUP exits nonzero after restoring the API and removing the partial backup", () => {
  const result = runBehaviorScenario("signal-hup-cleans-up");
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("create refuses lock contention before quiescing the API", () => {
  const result = runBehaviorScenario("lock-contention");
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("create refuses insufficient backup capacity before quiescing the API", () => {
  const result = runBehaviorScenario("insufficient-space");
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("prune retains the newest managed backups and preserves unknown directories", () => {
  const result = runBehaviorScenario("managed-retention");
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("create atomically publishes a checksum-verifiable backup", () => {
  const result = runBehaviorScenario("atomic-completion");
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("restore refuses a corrupted archive before creating a restore parent", () => {
  const result = runBehaviorScenario("restore-refuses-corrupt-archive");
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("restore refuses a traversal archive without writing outside isolation", () => {
  const result = runBehaviorScenario("restore-refuses-traversal-archive");
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("systemd service fails observably when Shared Storage is missing", () => {
  const result = runBehaviorScenario("missing-storage-unit-fails");
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("restore rejects a forbidden parent before creating it", () => {
  const result = runBehaviorScenario("restore-forbidden-before-write");
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("restore requires production app and storage roots before creating a parent", () => {
  const result = runBehaviorScenario("restore-requires-production-roots");
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("restore refuses an archive without canonical Metadata", () => {
  const result = runBehaviorScenario("restore-requires-canonical-metadata");
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("restore refuses an archive without a canonical Energy fact store", () => {
  const result = runBehaviorScenario("restore-requires-canonical-energy-store");
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("restore requires the caller-declared Energy fact store", () => {
  const result = runBehaviorScenario("restore-requires-expected-energy-store");
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("restore proves the API service identity can read and write the restored tree", () => {
  const result = runBehaviorScenario("restore-proves-api-ownership");
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("the backup workflow is valid Bash", () => {
  const source = readFileSync(backupScript, "utf8");
  execFileSync("bash", ["-n"], { input: source, stdio: ["pipe", "pipe", "pipe"] });
});

test("systemd scheduling uses the observed host timezone after the 01:00 Singapore sync", () => {
  const service = readFileSync(serviceUnit, "utf8");
  const timer = readFileSync(timerUnit, "utf8");
  assert.match(service, /energyiq-datafoundry-api\.service/u);
  assert.match(service, /--storage-root \/opt\/energyiq-datafoundry\/shared\/storage/u);
  assert.match(service, /--backup-root \/var\/backups\/energyiq\/managed-daily/u);
  assert.match(service, /UMask=0077/u);
  assert.match(service, /ProtectSystem=strict/u);
  assert.match(timer, /OnCalendar=\*-\*-\* 02:15:00 Asia\/Shanghai/u);
  assert.match(timer, /Persistent=true/u);
  assert.match(timer, /RandomizedDelaySec=0/u);
});
