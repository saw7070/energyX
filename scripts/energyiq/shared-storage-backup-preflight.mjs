#!/usr/bin/env node

import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const args = process.argv.slice(2);
const valueOf = (name) => {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) throw new Error(`Missing ${name}.`);
  return args[index + 1];
};

const storageRootInput = valueOf("--storage-root");
if (!path.isAbsolute(storageRootInput)) throw new Error("storage-root must be absolute.");
const storageRootStat = lstatSync(storageRootInput);
if (!storageRootStat.isDirectory() || storageRootStat.isSymbolicLink()) {
  throw new Error("storage-root must be a real directory.");
}
const storageRoot = realpathSync(storageRootInput);
const metadataPath = path.join(storageRoot, "metadata", "workbench.sqlite");
const metadataStat = lstatSync(metadataPath);
if (!metadataStat.isFile() || metadataStat.isSymbolicLink()) {
  throw new Error("Metadata SQLite is missing or unsafe.");
}

const database = new DatabaseSync(metadataPath, { readOnly: true });
try {
  const quickCheck = database.prepare("PRAGMA quick_check").all();
  if (quickCheck.length !== 1 || quickCheck[0].quick_check !== "ok") {
    throw new Error("Metadata SQLite quick_check failed before backup.");
  }

  const requiredTables = ["energyiq_source_sync_runs", "runs"];
  const existingTables = new Set(database.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (?, ?)",
  ).all(...requiredTables).map((row) => row.name));
  const missingTables = requiredTables.filter((table) => !existingTables.has(table));
  if (missingTables.length > 0) {
    throw new Error(`Backup preflight tables missing: ${missingTables.join(", ")}`);
  }

  const runningSourceSyncs = Number(database.prepare(
    "SELECT COUNT(*) AS count FROM energyiq_source_sync_runs WHERE status = 'running'",
  ).get().count);
  const runningAgentRuns = Number(database.prepare(
    "SELECT COUNT(*) AS count FROM runs WHERE status = 'running'",
  ).get().count);
  if (runningSourceSyncs > 0 || runningAgentRuns > 0) {
    throw new Error(
      `Shared Storage has active writers: sourceSyncs=${runningSourceSyncs} agentRuns=${runningAgentRuns}`,
    );
  }

  process.stdout.write(`${JSON.stringify({
    metadataQuickCheck: "ok",
    runningSourceSyncs,
    runningAgentRuns,
  })}\n`);
} finally {
  database.close();
}
