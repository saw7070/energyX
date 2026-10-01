import type { DatabaseSync } from "node:sqlite";

/**
 * A Project's live meter connection, configured by an administrator in the app instead of server environment
 * variables. The provider credentials live in `encrypted_secrets` under `secret_ref`; this row keeps only what the
 * server needs to find them, the device chosen for each published meter, and the daily update schedule.
 */
export type EnergyIqLiveConnectorRecord = {
  project_id: string;
  workspace_id: string;
  provider: "tuya";
  secret_ref: string;
  secret_workspace_id: string;
  secret_user_id: string;
  access_id_hint: string;
  /** Published meter id -> the provider device chosen for it. Device ids never leave the server. */
  bindings: Record<string, EnergyIqLiveConnectorBinding>;
  sync_enabled: boolean;
  sync_local_hour: number;
  last_check_at?: string;
  last_check_ok?: boolean;
  last_check_message?: string;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
};

export type EnergyIqLiveConnectorBinding = {
  device_id: string;
  device_name: string;
  product_name?: string;
};

export const initializeEnergyIqLiveConnectorSchema = (db: DatabaseSync): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS energyiq_live_connectors (
      project_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      provider TEXT NOT NULL CHECK (provider = 'tuya'),
      secret_ref TEXT NOT NULL,
      secret_workspace_id TEXT NOT NULL,
      secret_user_id TEXT NOT NULL,
      access_id_hint TEXT NOT NULL,
      bindings_json TEXT NOT NULL DEFAULT '{}',
      sync_enabled INTEGER NOT NULL DEFAULT 0 CHECK (sync_enabled IN (0, 1)),
      sync_local_hour INTEGER NOT NULL DEFAULT 2 CHECK (sync_local_hour BETWEEN 0 AND 23),
      last_check_at TEXT,
      last_check_ok INTEGER,
      last_check_message TEXT,
      created_by TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_energyiq_live_connectors_sync
      ON energyiq_live_connectors(sync_enabled, sync_local_hour);
  `);
};

export class EnergyIqLiveConnectorStore {
  constructor(private readonly db: DatabaseSync) {}

  find(projectId: string): EnergyIqLiveConnectorRecord | undefined {
    const row = this.db.prepare("SELECT * FROM energyiq_live_connectors WHERE project_id = ?").get(projectId);
    return isRecord(row) ? mapConnector(row) : undefined;
  }

  /** Connected Projects whose daily update is switched on, oldest first so the order is stable. */
  listSyncEnabled(): EnergyIqLiveConnectorRecord[] {
    return this.db.prepare(`
      SELECT * FROM energyiq_live_connectors WHERE sync_enabled = 1 ORDER BY created_at, project_id
    `).all().filter(isRecord).map(mapConnector);
  }

  /** Create the connection, or replace its account while keeping the meters already matched. */
  saveAccount(input: {
    project_id: string;
    workspace_id: string;
    secret_ref: string;
    secret_workspace_id: string;
    secret_user_id: string;
    access_id_hint: string;
    actor_user_id: string;
    checked_at: string;
    reset_bindings: boolean;
  }): EnergyIqLiveConnectorRecord {
    this.db.prepare(`
      INSERT INTO energyiq_live_connectors (
        project_id, workspace_id, provider, secret_ref, secret_workspace_id, secret_user_id, access_id_hint,
        bindings_json, sync_enabled, sync_local_hour, last_check_at, last_check_ok, last_check_message,
        created_by, updated_by, created_at, updated_at
      ) VALUES (?, ?, 'tuya', ?, ?, ?, ?, '{}', 0, 2, ?, 1, NULL, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        workspace_id = excluded.workspace_id,
        secret_ref = excluded.secret_ref,
        secret_workspace_id = excluded.secret_workspace_id,
        secret_user_id = excluded.secret_user_id,
        access_id_hint = excluded.access_id_hint,
        bindings_json = CASE WHEN ? THEN '{}' ELSE energyiq_live_connectors.bindings_json END,
        sync_enabled = CASE WHEN ? THEN 0 ELSE energyiq_live_connectors.sync_enabled END,
        last_check_at = excluded.last_check_at,
        last_check_ok = 1,
        last_check_message = NULL,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    `).run(
      input.project_id,
      input.workspace_id,
      input.secret_ref,
      input.secret_workspace_id,
      input.secret_user_id,
      input.access_id_hint,
      input.checked_at,
      input.actor_user_id,
      input.actor_user_id,
      input.checked_at,
      input.checked_at,
      input.reset_bindings ? 1 : 0,
      input.reset_bindings ? 1 : 0,
    );
    return this.require(input.project_id);
  }

  saveBindings(input: {
    project_id: string;
    bindings: Record<string, EnergyIqLiveConnectorBinding>;
    actor_user_id: string;
    updated_at: string;
  }): EnergyIqLiveConnectorRecord {
    const seen = new Set<string>();
    for (const binding of Object.values(input.bindings)) {
      if (seen.has(binding.device_id)) throw new Error("ENERGYIQ_LIVE_DEVICE_USED_TWICE");
      seen.add(binding.device_id);
    }
    this.require(input.project_id);
    this.db.prepare(`
      UPDATE energyiq_live_connectors
      SET bindings_json = ?, last_check_at = NULL, last_check_ok = NULL, last_check_message = NULL,
        updated_by = ?, updated_at = ?
      WHERE project_id = ?
    `).run(JSON.stringify(input.bindings), input.actor_user_id, input.updated_at, input.project_id);
    return this.require(input.project_id);
  }

  saveSchedule(input: {
    project_id: string;
    sync_enabled: boolean;
    sync_local_hour: number;
    actor_user_id: string;
    updated_at: string;
  }): EnergyIqLiveConnectorRecord {
    if (!Number.isInteger(input.sync_local_hour) || input.sync_local_hour < 0 || input.sync_local_hour > 23) {
      throw new Error("ENERGYIQ_LIVE_SYNC_HOUR_INVALID");
    }
    this.require(input.project_id);
    this.db.prepare(`
      UPDATE energyiq_live_connectors
      SET sync_enabled = ?, sync_local_hour = ?, updated_by = ?, updated_at = ?
      WHERE project_id = ?
    `).run(input.sync_enabled ? 1 : 0, input.sync_local_hour, input.actor_user_id, input.updated_at, input.project_id);
    return this.require(input.project_id);
  }

  recordCheck(input: { project_id: string; ok: boolean; message?: string; checked_at: string }): void {
    this.db.prepare(`
      UPDATE energyiq_live_connectors
      SET last_check_at = ?, last_check_ok = ?, last_check_message = ?
      WHERE project_id = ?
    `).run(input.checked_at, input.ok ? 1 : 0, input.message ?? null, input.project_id);
  }

  delete(projectId: string): EnergyIqLiveConnectorRecord | undefined {
    const current = this.find(projectId);
    if (current) this.db.prepare("DELETE FROM energyiq_live_connectors WHERE project_id = ?").run(projectId);
    return current;
  }

  private require(projectId: string): EnergyIqLiveConnectorRecord {
    const found = this.find(projectId);
    if (!found) throw new Error(`ENERGYIQ_LIVE_CONNECTION_NOT_FOUND:${projectId}`);
    return found;
  }
}

const mapConnector = (row: Record<string, unknown>): EnergyIqLiveConnectorRecord => ({
  project_id: String(row.project_id),
  workspace_id: String(row.workspace_id),
  provider: "tuya",
  secret_ref: String(row.secret_ref),
  secret_workspace_id: String(row.secret_workspace_id),
  secret_user_id: String(row.secret_user_id),
  access_id_hint: String(row.access_id_hint),
  bindings: parseBindings(row.bindings_json),
  sync_enabled: Number(row.sync_enabled) === 1,
  sync_local_hour: Number(row.sync_local_hour),
  ...(typeof row.last_check_at === "string" ? { last_check_at: row.last_check_at } : {}),
  ...(row.last_check_ok === null || row.last_check_ok === undefined ? {} : { last_check_ok: Number(row.last_check_ok) === 1 }),
  ...(typeof row.last_check_message === "string" ? { last_check_message: row.last_check_message } : {}),
  created_by: String(row.created_by),
  updated_by: String(row.updated_by),
  created_at: String(row.created_at),
  updated_at: String(row.updated_at),
});

const parseBindings = (value: unknown): Record<string, EnergyIqLiveConnectorBinding> => {
  if (typeof value !== "string") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return {};
  }
  if (!isRecord(parsed)) return {};
  const result: Record<string, EnergyIqLiveConnectorBinding> = {};
  for (const [meterPointId, binding] of Object.entries(parsed)) {
    if (!isRecord(binding) || typeof binding.device_id !== "string") continue;
    result[meterPointId] = {
      device_id: binding.device_id,
      device_name: typeof binding.device_name === "string" ? binding.device_name : "",
      ...(typeof binding.product_name === "string" && binding.product_name ? { product_name: binding.product_name } : {}),
    };
  }
  return result;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
