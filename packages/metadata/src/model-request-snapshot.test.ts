import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createMetadataStore } from "./index.js";

describe("ModelRequestSnapshotRepository", () => {
  it("stores one tenant-scoped immutable request fingerprint without retaining the raw payload", () => {
    const root = mkdtempSync(join(tmpdir(), "model-request-snapshot-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.sessions.create({ user_id: "dev-user", id: "session-1", title: "Request audit" });
      metadata.runs.create({
        user_id: "dev-user",
        id: "run-1",
        session_id: "session-1",
        user_input: "private input",
        status: "running",
      });
      metadata.contextPackageSnapshots.create({
        user_id: "dev-user",
        session_id: "session-1",
        run_id: "run-1",
        package_id: "context-package-1",
        revision: 2,
        payload: { version: 2, packageId: "context-package-1", revision: 2 },
      });

      const created = metadata.modelRequestSnapshots.create({
        user_id: "dev-user",
        session_id: "session-1",
        run_id: "run-1",
        step_number: 1,
        retry_count: 0,
        context_package_id: "context-package-1",
        context_package_revision: 2,
        payload: {
          schema_version: 1,
          prompt: [{ role: "user", content: [{ type: "text", text: "private prompt" }] }],
          tool_set: [{ name: "inspect_schema", input_schema: { type: "object" } }],
        },
      });

      expect(created).toMatchObject({
        id: "model-request:run-1:1:0",
        user_id: "dev-user",
        run_id: "run-1",
        step_number: 1,
        retry_count: 0,
        context_package_id: "context-package-1",
        context_package_revision: 2,
      });
      expect(created.content_sha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
      expect(created.payload_availability).toBe("not-retained");
      expect(created.payload_json).toBe(JSON.stringify({ retention: "hash-only" }));
      expect(created.payload_json).not.toContain("private prompt");
      expect(metadata.modelRequestSnapshots.find({
        user_id: "other-user",
        id: created.id,
      })).toBeUndefined();

      const replay = metadata.modelRequestSnapshots.create({
        user_id: "dev-user",
        session_id: "session-1",
        run_id: "run-1",
        step_number: 1,
        retry_count: 0,
        context_package_id: "context-package-1",
        context_package_revision: 2,
        payload: {
          tool_set: [{ input_schema: { type: "object" }, name: "inspect_schema" }],
          prompt: [{ content: [{ text: "private prompt", type: "text" }], role: "user" }],
          schema_version: 1,
        },
      });
      expect(replay.content_sha256).toBe(created.content_sha256);

      expect(() => metadata.modelRequestSnapshots.create({
        user_id: "dev-user",
        session_id: "session-1",
        run_id: "run-1",
        step_number: 1,
        retry_count: 0,
        context_package_id: "context-package-1",
        context_package_revision: 2,
        payload: { schema_version: 1, prompt: [{ role: "user", content: "mutated" }] },
      })).toThrow("MODEL_REQUEST_SNAPSHOT_IMMUTABLE");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects actor-, Run-, Session-, and Context-mismatched snapshot identities independently", () => {
    const root = mkdtempSync(join(tmpdir(), "model-request-snapshot-identity-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.sessions.create({ user_id: "dev-user", id: "session-1", title: "Run one" });
      metadata.runs.create({
        user_id: "dev-user",
        id: "run-1",
        session_id: "session-1",
        user_input: "run one",
        status: "running",
      });
      metadata.contextPackageSnapshots.create({
        user_id: "dev-user",
        session_id: "session-1",
        run_id: "run-1",
        package_id: "context-package-1",
        revision: 1,
        payload: { version: 2, packageId: "context-package-1", revision: 1 },
      });
      metadata.sessions.create({ user_id: "dev-user", id: "session-2", title: "Run two" });
      metadata.runs.create({
        user_id: "dev-user",
        id: "run-2",
        session_id: "session-2",
        user_input: "run two",
        status: "running",
      });
      metadata.contextPackageSnapshots.create({
        user_id: "dev-user",
        session_id: "session-2",
        run_id: "run-2",
        package_id: "context-package-2",
        revision: 1,
        payload: { version: 2, packageId: "context-package-2", revision: 1 },
      });

      expect(() => metadata.modelRequestSnapshots.create({
        user_id: "different-actor",
        session_id: "session-1",
        run_id: "run-1",
        step_number: 1,
        retry_count: 0,
        context_package_id: "context-package-1",
        context_package_revision: 1,
        payload: { schemaVersion: 1, prompt: [] },
      })).toThrow("MODEL_REQUEST_SNAPSHOT_IDENTITY_MISMATCH:run_id");

      expect(() => metadata.modelRequestSnapshots.create({
        user_id: "dev-user",
        session_id: "session-1",
        run_id: "missing-run",
        step_number: 1,
        retry_count: 0,
        context_package_id: "context-package-1",
        context_package_revision: 1,
        payload: { schemaVersion: 1, prompt: [] },
      })).toThrow("MODEL_REQUEST_SNAPSHOT_IDENTITY_MISMATCH:run_id");

      expect(() => metadata.modelRequestSnapshots.create({
        user_id: "dev-user",
        session_id: "session-2",
        run_id: "run-1",
        step_number: 1,
        retry_count: 0,
        context_package_id: "context-package-2",
        context_package_revision: 1,
        payload: { schemaVersion: 1, prompt: [] },
      })).toThrow("MODEL_REQUEST_SNAPSHOT_IDENTITY_MISMATCH:session_id");

      expect(() => metadata.modelRequestSnapshots.create({
        user_id: "dev-user",
        session_id: "session-1",
        run_id: "run-1",
        step_number: 1,
        retry_count: 0,
        context_package_id: "context-package-2",
        context_package_revision: 1,
        payload: { schemaVersion: 1, prompt: [] },
      })).toThrow("MODEL_REQUEST_SNAPSHOT_IDENTITY_MISMATCH:context_package");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("applies the one-time logical retention migration once and preserves later retained rows on reopen", () => {
    const root = mkdtempSync(join(tmpdir(), "model-request-snapshot-migration-"));
    const databasePath = join(root, "metadata.sqlite");
    let metadata = createMetadataStore({ database_path: databasePath });
    try {
      metadata.sessions.create({ user_id: "dev-user", id: "session-legacy", title: "Legacy" });
      metadata.runs.create({
        user_id: "dev-user",
        id: "run-legacy",
        session_id: "session-legacy",
        user_input: "private input",
        status: "running",
      });
      metadata.contextPackageSnapshots.create({
        user_id: "dev-user",
        session_id: "session-legacy",
        run_id: "run-legacy",
        package_id: "context-package-legacy",
        revision: 1,
        payload: { version: 2, packageId: "context-package-legacy", revision: 1 },
      });
      const snapshot = metadata.modelRequestSnapshots.create({
        user_id: "dev-user",
        session_id: "session-legacy",
        run_id: "run-legacy",
        step_number: 1,
        retry_count: 0,
        context_package_id: "context-package-legacy",
        context_package_revision: 1,
        payload: { prompt: [{ role: "user", content: "legacy private prompt" }] },
      });
      metadata.db.prepare(`
        UPDATE model_request_snapshots
        SET payload_json = ?, payload_availability = 'retained'
        WHERE user_id = ? AND id = ?
      `).run(JSON.stringify({ prompt: "legacy private prompt" }), "dev-user", snapshot.id);
      metadata.db.prepare("DELETE FROM schema_migrations WHERE id = '0040_model_request_payload_retention'").run();
      metadata.close();

      metadata = createMetadataStore({ database_path: databasePath });
      const migrated = metadata.modelRequestSnapshots.get({ user_id: "dev-user", id: snapshot.id });
      expect(migrated.payload_availability).toBe("not-retained");
      expect(migrated.payload_json).toBe(JSON.stringify({ retention: "hash-only" }));
      expect(migrated.payload_json).not.toContain("legacy private prompt");
      expect(migrated.content_sha256).toBe(snapshot.content_sha256);

      const postMigrationSentinel = JSON.stringify({ protectedRef: "vault:model-request:sentinel" });
      metadata.db.prepare(`
        UPDATE model_request_snapshots
        SET payload_json = ?, payload_availability = 'retained'
        WHERE user_id = ? AND id = ?
      `).run(postMigrationSentinel, "dev-user", snapshot.id);
      metadata.close();

      metadata = createMetadataStore({ database_path: databasePath });
      const reopened = metadata.modelRequestSnapshots.get({ user_id: "dev-user", id: snapshot.id });
      expect(reopened.payload_availability).toBe("retained");
      expect(reopened.payload_json).toBe(postMigrationSentinel);
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("serializes concurrent 0040 initialization across two database connections", async () => {
    const root = mkdtempSync(join(tmpdir(), "model-request-snapshot-concurrent-migration-"));
    const databasePath = join(root, "metadata.sqlite");
    let metadata = createMetadataStore({ database_path: databasePath });
    let metadataOpen = true;
    try {
      metadata.sessions.create({ user_id: "dev-user", id: "session-legacy", title: "Legacy" });
      metadata.runs.create({
        user_id: "dev-user",
        id: "run-legacy",
        session_id: "session-legacy",
        user_input: "private input",
        status: "running",
      });
      metadata.contextPackageSnapshots.create({
        user_id: "dev-user",
        session_id: "session-legacy",
        run_id: "run-legacy",
        package_id: "context-package-legacy",
        revision: 1,
        payload: { version: 2, packageId: "context-package-legacy", revision: 1 },
      });
      const snapshot = metadata.modelRequestSnapshots.create({
        user_id: "dev-user",
        session_id: "session-legacy",
        run_id: "run-legacy",
        step_number: 1,
        retry_count: 0,
        context_package_id: "context-package-legacy",
        context_package_revision: 1,
        payload: { prompt: [{ role: "user", content: "legacy private prompt" }] },
      });
      metadata.db.prepare(`
        UPDATE model_request_snapshots
        SET payload_json = ?, payload_availability = 'retained'
        WHERE user_id = ? AND id = ?
      `).run(JSON.stringify({ prompt: "legacy private prompt" }), "dev-user", snapshot.id);
      metadata.db.exec(`
        CREATE TABLE migration_0040_update_audit (snapshot_id TEXT NOT NULL);
        CREATE TRIGGER audit_migration_0040_update
        BEFORE UPDATE OF payload_json, payload_availability ON model_request_snapshots
        WHEN NEW.payload_json = '{"retention":"hash-only"}'
        BEGIN
          INSERT INTO migration_0040_update_audit (snapshot_id) VALUES (NEW.id);
        END;
        DELETE FROM schema_migrations WHERE id = '0040_model_request_payload_retention';
      `);
      metadata.close();
      metadataOpen = false;

      const moduleUrl = new URL("./schema-migration.ts", import.meta.url).href;
      const outcomes = await openMetadataStoresConcurrently(moduleUrl, databasePath);
      expect(outcomes).toEqual(["opened", "opened"]);

      metadata = createMetadataStore({ database_path: databasePath });
      metadataOpen = true;
      const audit = metadata.db.prepare(`
        SELECT COUNT(*) AS count, COUNT(DISTINCT snapshot_id) AS distinct_count
        FROM migration_0040_update_audit
      `).get();
      expect(audit).toMatchObject({ count: 1, distinct_count: 1 });
      expect(metadata.db.prepare(`
        SELECT COUNT(*) AS count FROM schema_migrations
        WHERE id = '0040_model_request_payload_retention'
      `).get()).toMatchObject({ count: 1 });
    } finally {
      if (metadataOpen) metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }, 30_000);

  it("rejects a migration child that exits cleanly before reporting opened", async () => {
    const root = mkdtempSync(join(tmpdir(), "model-request-snapshot-migration-protocol-"));
    try {
      await expect(openMetadataStoresConcurrently(
        new URL("./schema-migration.ts", import.meta.url).href,
        join(root, "metadata.sqlite"),
        { mode: "exit-before-open", deadlineMs: 5_000 },
      )).rejects.toThrow(/exited before opened/u);
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

const openMetadataStoresConcurrently = (
  moduleUrl: string,
  databasePath: string,
  options: {
    mode?: "migrate" | "exit-before-open";
    deadlineMs?: number;
  } = {},
): Promise<["opened", "opened"]> => new Promise((resolve, reject) => {
  const childSource = `
      (async () => {
        const { DatabaseSync } = await import("node:sqlite");
        const { runSchemaMigration } = await import(process.argv[1]);
        const send = (message) => new Promise((resolveMessage, rejectMessage) => {
          if (!process.send) return rejectMessage(new Error("migration child IPC unavailable"));
          process.send(message, (error) => error ? rejectMessage(error) : resolveMessage());
        });
        await send({ type: "ready" });
        await new Promise((start, rejectStart) => process.once("message", (message) => {
          if (message?.type !== "start") {
            rejectStart(new Error("migration child start protocol invalid"));
            return;
          }
          start();
        }));
        if (process.argv[3] === "exit-before-open") {
          process.disconnect();
          return;
        }
        const db = new DatabaseSync(process.argv[2]);
        db.exec("PRAGMA journal_mode = WAL");
        db.exec("PRAGMA busy_timeout = 5000");
        runSchemaMigration(
          db,
          "0040_model_request_payload_retention",
          "Record model request payload retention state",
          () => {
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
            db.prepare(\`
              UPDATE model_request_snapshots
              SET payload_json = ?, payload_availability = 'not-retained'
            \`).run(JSON.stringify({ retention: "hash-only" }));
          },
          { atomic: true },
        );
        db.close();
        await send({ type: "opened" });
        process.disconnect();
      })().catch((error) => {
        process.stderr.write(String(error?.stack ?? error));
        process.exitCode = 1;
        if (process.connected) process.disconnect();
      });
    `;
  const workers = [0, 1].map(() => spawn(
    process.execPath,
    ["-e", childSource, moduleUrl, databasePath, options.mode ?? "migrate"],
    { stdio: ["ignore", "ignore", "pipe", "ipc"] },
  ));
  const states = ["starting", "starting"] as Array<"starting" | "ready" | "opened" | "exited">;
  const stderr = ["", ""];
  let startSent = false;
  let settled = false;
  const deadline = setTimeout(() => {
    fail(new Error(`migration child deadline exceeded: ${states.map((state, index) => (
      `${index}=${state}${stderr[index] ? ` stderr=${stderr[index]}` : ""}`
    )).join("; ")}`));
  }, options.deadlineMs ?? 15_000);
  const fail = (error: unknown) => {
    if (settled) return;
    settled = true;
    clearTimeout(deadline);
    workers.forEach((worker) => worker.kill());
    reject(error instanceof Error ? error : new Error(String(error)));
  };
  workers.forEach((worker, index) => {
    const errorStream = worker.stderr;
    if (!errorStream) {
      fail(new Error(`migration child ${index} stderr pipe unavailable`));
      return;
    }
    errorStream.setEncoding("utf8");
    errorStream.on("data", (chunk: string) => { stderr[index] += chunk; });
    worker.on("message", (message: unknown) => {
      if (isChildMessage(message, "ready")) {
        states[index] = "ready";
        if (!startSent && states.every((state) => state === "ready")) {
          startSent = true;
          workers.forEach((readyWorker) => readyWorker.send({ type: "start" }));
        }
        return;
      }
      if (isChildMessage(message, "opened")) {
        states[index] = "opened";
      }
    });
    worker.on("error", fail);
    worker.on("exit", (code, signal) => {
      if (settled) return;
      if (code !== 0) {
        fail(new Error(stderr[index] || `migration child ${index} exited ${code ?? signal ?? "unknown"}`));
        return;
      }
      if (states[index] !== "opened") {
        fail(new Error(`migration child ${index} exited before opened (phase=${states[index]})`));
        return;
      }
      states[index] = "exited";
      if (states.every((state) => state === "exited")) {
        settled = true;
        clearTimeout(deadline);
        resolve(["opened", "opened"]);
      }
    });
  });
});

const isChildMessage = (value: unknown, type: "ready" | "opened"): boolean => (
  typeof value === "object" && value !== null && "type" in value && value.type === type
);
