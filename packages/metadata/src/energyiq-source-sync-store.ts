import type { DatabaseSync } from "node:sqlite";

export type EnergyIqSourceSyncTrigger = "manual" | "scheduled" | "backfill";
export type EnergyIqSourceSyncRunStatus = "running" | "succeeded" | "failed";

export type EnergyIqSourceSyncRunRecord = {
  id: string;
  workspace_id: string;
  project_id: string;
  source_kind: "tuya";
  connector_fingerprint: string;
  trigger: EnergyIqSourceSyncTrigger;
  status: EnergyIqSourceSyncRunStatus;
  window_start_ms: number;
  window_end_ms: number;
  import_batch_id?: string;
  data_snapshot_id?: string;
  error_code?: string;
  actor_user_id: string;
  started_at: string;
  completed_at?: string;
};

export type EnergyIqSourceSyncStateRecord = {
  workspace_id: string;
  project_id: string;
  source_kind: "tuya";
  watermark_ms?: number;
  active_source_sha256: string[];
  last_run_id?: string;
  last_success_at?: string;
  last_failure_at?: string;
  last_error_code?: string;
  last_import_batch_id?: string;
  last_data_snapshot_id?: string;
  updated_at: string;
};

export type EnergyIqSourceSyncClaim = {
  run: EnergyIqSourceSyncRunRecord;
  reused: boolean;
};

export const initializeEnergyIqSourceSyncSchema = (db: DatabaseSync): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS energyiq_source_sync_runs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      source_kind TEXT NOT NULL CHECK (source_kind = 'tuya'),
      connector_fingerprint TEXT NOT NULL CHECK (
        length(connector_fingerprint) = 64
        AND connector_fingerprint NOT GLOB '*[^0-9a-f]*'
      ),
      trigger TEXT NOT NULL CHECK (trigger IN ('manual', 'scheduled', 'backfill')),
      status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
      window_start_ms INTEGER NOT NULL,
      window_end_ms INTEGER NOT NULL,
      import_batch_id TEXT,
      data_snapshot_id TEXT,
      error_code TEXT,
      actor_user_id TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (project_id) REFERENCES energyiq_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (import_batch_id) REFERENCES energyiq_import_batches(id),
      FOREIGN KEY (data_snapshot_id) REFERENCES energyiq_data_snapshots(id),
      FOREIGN KEY (actor_user_id) REFERENCES users(id),
      CHECK (window_start_ms > 0 AND window_end_ms > window_start_ms)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_energyiq_source_sync_one_running
      ON energyiq_source_sync_runs(project_id, source_kind)
      WHERE status = 'running';
    CREATE INDEX IF NOT EXISTS idx_energyiq_source_sync_runs_project
      ON energyiq_source_sync_runs(project_id, source_kind, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_energyiq_source_sync_runs_window
      ON energyiq_source_sync_runs(
        project_id, source_kind, connector_fingerprint,
        window_start_ms, window_end_ms, status
      );

    CREATE TABLE IF NOT EXISTS energyiq_source_sync_state (
      project_id TEXT NOT NULL,
      source_kind TEXT NOT NULL CHECK (source_kind = 'tuya'),
      workspace_id TEXT NOT NULL,
      watermark_ms INTEGER,
      active_source_sha256_json TEXT NOT NULL DEFAULT '[]',
      last_run_id TEXT,
      last_success_at TEXT,
      last_failure_at TEXT,
      last_error_code TEXT,
      last_import_batch_id TEXT,
      last_data_snapshot_id TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (project_id, source_kind),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (project_id) REFERENCES energyiq_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (last_run_id) REFERENCES energyiq_source_sync_runs(id),
      FOREIGN KEY (last_import_batch_id) REFERENCES energyiq_import_batches(id),
      FOREIGN KEY (last_data_snapshot_id) REFERENCES energyiq_data_snapshots(id)
    );
  `);
};

export class EnergyIqSourceSyncStore {
  constructor(private readonly db: DatabaseSync) {}

  claim(input: {
    id: string;
    workspace_id: string;
    project_id: string;
    source_kind: "tuya";
    connector_fingerprint: string;
    trigger: EnergyIqSourceSyncTrigger;
    window_start_ms: number;
    window_end_ms: number;
    actor_user_id: string;
    started_at?: string;
    stale_before?: string;
  }): EnergyIqSourceSyncClaim {
    requireWindow(input.window_start_ms, input.window_end_ms);
    const connectorFingerprint = requireSha256(input.connector_fingerprint);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.requireProjectWorkspace(input.project_id, input.workspace_id);
      if (input.stale_before) {
        const interrupted = this.db.prepare(`
          SELECT * FROM energyiq_source_sync_runs
          WHERE project_id = ? AND source_kind = ? AND status = 'running' AND started_at < ?
        `).all(input.project_id, input.source_kind, input.stale_before).filter(isRecord).map(mapRun);
        for (const run of interrupted) {
          this.db.prepare(`
            UPDATE energyiq_source_sync_runs
            SET status = 'failed', error_code = 'SOURCE_SYNC_PROCESS_INTERRUPTED', completed_at = ?
            WHERE id = ? AND status = 'running'
          `).run(input.stale_before, run.id);
          this.db.prepare(`
            UPDATE energyiq_source_sync_state
            SET last_run_id = ?, last_failure_at = ?,
                last_error_code = 'SOURCE_SYNC_PROCESS_INTERRUPTED', updated_at = ?
            WHERE project_id = ? AND source_kind = ?
          `).run(run.id, input.stale_before, input.stale_before, run.project_id, run.source_kind);
        }
      }
      const succeeded = this.db.prepare(`
        SELECT * FROM energyiq_source_sync_runs
        WHERE project_id = ? AND source_kind = ?
          AND connector_fingerprint = ?
          AND window_start_ms = ? AND window_end_ms = ? AND status = 'succeeded'
        ORDER BY completed_at DESC, started_at DESC
        LIMIT 1
      `).get(
        input.project_id,
        input.source_kind,
        connectorFingerprint,
        input.window_start_ms,
        input.window_end_ms,
      );
      if (isRecord(succeeded)) {
        this.db.exec("COMMIT");
        return { run: mapRun(succeeded), reused: true };
      }
      const running = this.db.prepare(`
        SELECT id FROM energyiq_source_sync_runs
        WHERE project_id = ? AND source_kind = ? AND status = 'running'
      `).get(input.project_id, input.source_kind);
      if (isRecord(running)) {
        throw new Error(`ENERGYIQ_SOURCE_SYNC_IN_PROGRESS:${requiredString(running, "id")}`);
      }
      const startedAt = input.started_at ?? new Date().toISOString();
      this.db.prepare(`
        INSERT INTO energyiq_source_sync_runs (
          id, workspace_id, project_id, source_kind, trigger, status,
          connector_fingerprint, window_start_ms, window_end_ms, actor_user_id, started_at
        ) VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?)
      `).run(
        input.id,
        input.workspace_id,
        input.project_id,
        input.source_kind,
        input.trigger,
        connectorFingerprint,
        input.window_start_ms,
        input.window_end_ms,
        input.actor_user_id,
        startedAt,
      );
      this.upsertStateShell({
        workspaceId: input.workspace_id,
        projectId: input.project_id,
        sourceKind: input.source_kind,
        runId: input.id,
        updatedAt: startedAt,
      });
      this.db.exec("COMMIT");
      return { run: this.getRun(input.id), reused: false };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  completeSuccess(input: {
    run_id: string;
    import_batch_id: string;
    data_snapshot_id: string;
    active_source_sha256: readonly string[];
    completed_at?: string;
  }): EnergyIqSourceSyncRunRecord {
    const activeSources = canonicalSources(input.active_source_sha256);
    if (activeSources.length === 0) throw new Error("ENERGYIQ_SOURCE_SYNC_MANIFEST_EMPTY");
    const completedAt = input.completed_at ?? new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const run = this.requireRunning(input.run_id);
      this.requireCompletionScope({
        run,
        importBatchId: input.import_batch_id,
        dataSnapshotId: input.data_snapshot_id,
        activeSources,
      });
      this.db.prepare(`
        UPDATE energyiq_source_sync_runs
        SET status = 'succeeded', import_batch_id = ?, data_snapshot_id = ?,
            error_code = NULL, completed_at = ?
        WHERE id = ? AND status = 'running'
      `).run(input.import_batch_id, input.data_snapshot_id, completedAt, input.run_id);
      this.db.prepare(`
        INSERT INTO energyiq_source_sync_state (
          project_id, source_kind, workspace_id, watermark_ms,
          active_source_sha256_json, last_run_id, last_success_at,
          last_failure_at, last_error_code, last_import_batch_id,
          last_data_snapshot_id, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)
        ON CONFLICT(project_id, source_kind) DO UPDATE SET
          workspace_id = excluded.workspace_id,
          watermark_ms = CASE
            WHEN energyiq_source_sync_state.watermark_ms IS NULL
              OR excluded.watermark_ms > energyiq_source_sync_state.watermark_ms
            THEN excluded.watermark_ms
            ELSE energyiq_source_sync_state.watermark_ms
          END,
          active_source_sha256_json = excluded.active_source_sha256_json,
          last_run_id = excluded.last_run_id,
          last_success_at = excluded.last_success_at,
          last_error_code = NULL,
          last_import_batch_id = excluded.last_import_batch_id,
          last_data_snapshot_id = excluded.last_data_snapshot_id,
          updated_at = excluded.updated_at
      `).run(
        run.project_id,
        run.source_kind,
        run.workspace_id,
        run.window_end_ms,
        JSON.stringify(activeSources),
        run.id,
        completedAt,
        input.import_batch_id,
        input.data_snapshot_id,
        completedAt,
      );
      this.db.exec("COMMIT");
      return this.getRun(input.run_id);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  completeFailure(input: {
    run_id: string;
    error_code: string;
    completed_at?: string;
  }): EnergyIqSourceSyncRunRecord {
    const errorCode = requireErrorCode(input.error_code);
    const completedAt = input.completed_at ?? new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const run = this.requireRunning(input.run_id);
      this.db.prepare(`
        UPDATE energyiq_source_sync_runs
        SET status = 'failed', error_code = ?, completed_at = ?
        WHERE id = ? AND status = 'running'
      `).run(errorCode, completedAt, input.run_id);
      this.db.prepare(`
        UPDATE energyiq_source_sync_state
        SET last_run_id = ?, last_failure_at = ?, last_error_code = ?, updated_at = ?
        WHERE project_id = ? AND source_kind = ?
      `).run(run.id, completedAt, errorCode, completedAt, run.project_id, run.source_kind);
      this.db.exec("COMMIT");
      return this.getRun(input.run_id);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getRun(runId: string): EnergyIqSourceSyncRunRecord {
    const row = this.db.prepare("SELECT * FROM energyiq_source_sync_runs WHERE id = ?").get(runId);
    if (!isRecord(row)) throw new Error(`ENERGYIQ_SOURCE_SYNC_RUN_NOT_FOUND:${runId}`);
    return mapRun(row);
  }

  findState(input: {
    project_id: string;
    source_kind: "tuya";
  }): EnergyIqSourceSyncStateRecord | undefined {
    const row = this.db.prepare(`
      SELECT * FROM energyiq_source_sync_state
      WHERE project_id = ? AND source_kind = ?
    `).get(input.project_id, input.source_kind);
    return isRecord(row) ? mapState(row) : undefined;
  }

  listRuns(input: {
    project_id: string;
    source_kind: "tuya";
    limit?: number;
  }): EnergyIqSourceSyncRunRecord[] {
    const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
    return this.db.prepare(`
      SELECT * FROM energyiq_source_sync_runs
      WHERE project_id = ? AND source_kind = ?
      ORDER BY started_at DESC, id DESC
      LIMIT ?
    `).all(input.project_id, input.source_kind, limit).filter(isRecord).map(mapRun);
  }

  private requireRunning(runId: string): EnergyIqSourceSyncRunRecord {
    const run = this.getRun(runId);
    if (run.status !== "running") throw new Error(`ENERGYIQ_SOURCE_SYNC_NOT_RUNNING:${runId}`);
    return run;
  }

  private requireProjectWorkspace(projectId: string, workspaceId: string): void {
    const row = this.db.prepare(`
      SELECT 1 AS valid
      FROM energyiq_projects
      WHERE id = ? AND workspace_id = ?
    `).get(projectId, workspaceId);
    if (!isRecord(row)) throw new Error("ENERGYIQ_SOURCE_SYNC_PROJECT_SCOPE_MISMATCH");
  }

  private requireCompletionScope(input: {
    run: EnergyIqSourceSyncRunRecord;
    importBatchId: string;
    dataSnapshotId: string;
    activeSources: readonly string[];
  }): void {
    const row = this.db.prepare(`
      SELECT
        batch.workspace_id AS batch_workspace_id,
        batch.project_id AS batch_project_id,
        batch.source_sha256 AS batch_source_sha256,
        snapshot.workspace_id AS snapshot_workspace_id,
        snapshot.project_id AS snapshot_project_id,
        snapshot.manifest_json AS snapshot_manifest_json
      FROM energyiq_import_batches batch
      JOIN energyiq_data_snapshots snapshot ON snapshot.id = ?
      WHERE batch.id = ?
    `).get(input.dataSnapshotId, input.importBatchId);
    if (!isRecord(row)
      || requiredString(row, "batch_workspace_id") !== input.run.workspace_id
      || requiredString(row, "batch_project_id") !== input.run.project_id
      || requiredString(row, "snapshot_workspace_id") !== input.run.workspace_id
      || requiredString(row, "snapshot_project_id") !== input.run.project_id) {
      throw new Error("ENERGYIQ_SOURCE_SYNC_RESULT_SCOPE_MISMATCH");
    }
    const batchSource = requireSha256(requiredString(row, "batch_source_sha256"));
    const snapshotSources = snapshotManifestSources(requiredString(row, "snapshot_manifest_json"));
    if (!input.activeSources.includes(batchSource)
      || JSON.stringify(snapshotSources) !== JSON.stringify(input.activeSources)) {
      throw new Error("ENERGYIQ_SOURCE_SYNC_RESULT_MANIFEST_MISMATCH");
    }
  }

  private upsertStateShell(input: {
    workspaceId: string;
    projectId: string;
    sourceKind: "tuya";
    runId: string;
    updatedAt: string;
  }): void {
    this.db.prepare(`
      INSERT INTO energyiq_source_sync_state (
        project_id, source_kind, workspace_id, active_source_sha256_json,
        last_run_id, updated_at
      ) VALUES (?, ?, ?, '[]', ?, ?)
      ON CONFLICT(project_id, source_kind) DO UPDATE SET
        workspace_id = excluded.workspace_id,
        last_run_id = excluded.last_run_id,
        updated_at = excluded.updated_at
    `).run(input.projectId, input.sourceKind, input.workspaceId, input.runId, input.updatedAt);
  }
}

const mapRun = (row: Record<string, unknown>): EnergyIqSourceSyncRunRecord => {
  const importBatchId = optionalString(row, "import_batch_id");
  const dataSnapshotId = optionalString(row, "data_snapshot_id");
  const errorCode = optionalString(row, "error_code");
  const completedAt = optionalString(row, "completed_at");
  return {
    id: requiredString(row, "id"),
    workspace_id: requiredString(row, "workspace_id"),
    project_id: requiredString(row, "project_id"),
    source_kind: requiredString(row, "source_kind") as "tuya",
    connector_fingerprint: requiredString(row, "connector_fingerprint"),
    trigger: requiredString(row, "trigger") as EnergyIqSourceSyncTrigger,
    status: requiredString(row, "status") as EnergyIqSourceSyncRunStatus,
    window_start_ms: requiredSafeInteger(row, "window_start_ms"),
    window_end_ms: requiredSafeInteger(row, "window_end_ms"),
    ...(importBatchId ? { import_batch_id: importBatchId } : {}),
    ...(dataSnapshotId ? { data_snapshot_id: dataSnapshotId } : {}),
    ...(errorCode ? { error_code: errorCode } : {}),
    actor_user_id: requiredString(row, "actor_user_id"),
    started_at: requiredString(row, "started_at"),
    ...(completedAt ? { completed_at: completedAt } : {}),
  };
};

const mapState = (row: Record<string, unknown>): EnergyIqSourceSyncStateRecord => {
  const watermark = optionalSafeInteger(row, "watermark_ms");
  const lastRunId = optionalString(row, "last_run_id");
  const lastSuccessAt = optionalString(row, "last_success_at");
  const lastFailureAt = optionalString(row, "last_failure_at");
  const lastErrorCode = optionalString(row, "last_error_code");
  const lastImportBatchId = optionalString(row, "last_import_batch_id");
  const lastDataSnapshotId = optionalString(row, "last_data_snapshot_id");
  return {
    workspace_id: requiredString(row, "workspace_id"),
    project_id: requiredString(row, "project_id"),
    source_kind: requiredString(row, "source_kind") as "tuya",
    ...(watermark === undefined ? {} : { watermark_ms: watermark }),
    active_source_sha256: parseSources(requiredString(row, "active_source_sha256_json")),
    ...(lastRunId ? { last_run_id: lastRunId } : {}),
    ...(lastSuccessAt ? { last_success_at: lastSuccessAt } : {}),
    ...(lastFailureAt ? { last_failure_at: lastFailureAt } : {}),
    ...(lastErrorCode ? { last_error_code: lastErrorCode } : {}),
    ...(lastImportBatchId ? { last_import_batch_id: lastImportBatchId } : {}),
    ...(lastDataSnapshotId ? { last_data_snapshot_id: lastDataSnapshotId } : {}),
    updated_at: requiredString(row, "updated_at"),
  };
};

const canonicalSources = (values: readonly string[]): string[] => [...new Set(values.map((value) => {
  const normalized = value.trim().toLocaleLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(normalized)) throw new Error("ENERGYIQ_SOURCE_SYNC_SHA_INVALID");
  return normalized;
}))].sort();

const parseSources = (value: string): string[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error("ENERGYIQ_SOURCE_SYNC_STATE_INVALID");
  }
  if (!Array.isArray(parsed) || !parsed.every((candidate) => typeof candidate === "string")) {
    throw new Error("ENERGYIQ_SOURCE_SYNC_STATE_INVALID");
  }
  return canonicalSources(parsed);
};

const requireWindow = (start: number, end: number): void => {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start <= 0 || end <= start) {
    throw new Error("ENERGYIQ_SOURCE_SYNC_WINDOW_INVALID");
  }
};

const requireErrorCode = (value: string): string => {
  const normalized = value.trim().toLocaleUpperCase();
  if (!/^[A-Z0-9_:-]{1,160}$/u.test(normalized)) throw new Error("ENERGYIQ_SOURCE_SYNC_ERROR_CODE_INVALID");
  return normalized;
};

const snapshotManifestSources = (value: string): string[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error("ENERGYIQ_SOURCE_SYNC_RESULT_MANIFEST_MISMATCH");
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.batches)) {
    throw new Error("ENERGYIQ_SOURCE_SYNC_RESULT_MANIFEST_MISMATCH");
  }
  return canonicalSources(parsed.batches.map((batch) => {
    if (!isRecord(batch) || typeof batch.sourceSha256 !== "string") {
      throw new Error("ENERGYIQ_SOURCE_SYNC_RESULT_MANIFEST_MISMATCH");
    }
    return batch.sourceSha256;
  }));
};

const requireSha256 = (value: string): string => {
  const normalized = value.trim().toLocaleLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(normalized)) {
    throw new Error("ENERGYIQ_SOURCE_SYNC_CONNECTOR_FINGERPRINT_INVALID");
  }
  return normalized;
};

const requiredString = (row: Record<string, unknown>, key: string): string => {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`ENERGYIQ_SOURCE_SYNC_ROW_INVALID:${key}`);
  return value;
};

const optionalString = (row: Record<string, unknown>, key: string): string | undefined =>
  typeof row[key] === "string" ? row[key] : undefined;

const requiredSafeInteger = (row: Record<string, unknown>, key: string): number => {
  const value = Number(row[key]);
  if (!Number.isSafeInteger(value)) throw new Error(`ENERGYIQ_SOURCE_SYNC_ROW_INVALID:${key}`);
  return value;
};

const optionalSafeInteger = (row: Record<string, unknown>, key: string): number | undefined => {
  if (row[key] === null || row[key] === undefined) return undefined;
  return requiredSafeInteger(row, key);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
