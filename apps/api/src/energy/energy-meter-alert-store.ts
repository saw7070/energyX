/**
 * What the meter alerts remember, on the metadata database: each alert with when it opened and was resolved, each
 * site's meter-alert settings, and when each site was last checked. Alerts are keyed per episode, so checking the
 * same readings again (the nightly update, its hourly retries, an upload) changes nothing and never adds a second bell
 * entry. Tables are created here, like the report-agent's own stores, rather than by a numbered migration.
 */
import type { DatabaseSync } from "node:sqlite";

export type MeterAlertKind = "meter_offline" | "never_used" | "usage_pattern" | "usage_pattern_more";
/** Who hears about it: the people who look after the meters and gateways, or the people who run the site. */
export type MeterAlertAudience = "hardware" | "operators";
export type MeterAlertStatus = "open" | "resolved";

export type MeterAlertRecord = {
  projectId: string;
  key: string;
  kind: MeterAlertKind;
  audience: MeterAlertAudience;
  /** The meter, or the area for meters that went quiet together. */
  subject: string;
  status: MeterAlertStatus;
  payload: Record<string, unknown>;
  openedAt: string;
  resolvedAt?: string;
  updatedAt: string;
};

export type MeterAlertSettings = {
  projectId: string;
  /** Unusual hourly use alerts; on unless someone turned them off. */
  patternAlerts: boolean;
  /** Extra addresses that get the stopped-sending alerts, besides the people who look after the live connection. */
  hardwareEmails: string[];
  updatedAt?: string;
  updatedBy?: string;
};

export const MAX_HARDWARE_EMAILS = 5;
const EMAIL_PATTERN = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/u;
/** Resolved alerts are kept this long for the record, then cleared. */
const KEEP_RESOLVED_MS = 180 * 24 * 3_600_000;

/** Up to five addresses, each checked; duplicates and case are folded. Throws ENERGYIQ_METER_ALERT_EMAILS_INVALID. */
export const normalizeHardwareEmails = (value: unknown): string[] => {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("ENERGYIQ_METER_ALERT_EMAILS_INVALID");
  const emails = [...new Set(value.map((item) => (typeof item === "string" ? item.trim().toLowerCase() : "")))];
  if (emails.length > MAX_HARDWARE_EMAILS || emails.some((email) => email.length > 254 || !EMAIL_PATTERN.test(email))) {
    throw new Error("ENERGYIQ_METER_ALERT_EMAILS_INVALID");
  }
  return emails.sort();
};

export class MeterAlertStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS energyiq_meter_alerts (
        project_id TEXT NOT NULL,
        alert_key TEXT NOT NULL,
        kind TEXT NOT NULL,
        audience TEXT NOT NULL,
        subject TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        opened_at TEXT NOT NULL,
        resolved_at TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (project_id, alert_key)
      );
      CREATE INDEX IF NOT EXISTS idx_energyiq_meter_alerts_status ON energyiq_meter_alerts(project_id, status, kind);
      CREATE INDEX IF NOT EXISTS idx_energyiq_meter_alerts_recent ON energyiq_meter_alerts(project_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS energyiq_meter_alert_settings (
        project_id TEXT PRIMARY KEY,
        pattern_enabled INTEGER NOT NULL,
        hardware_emails_json TEXT,
        updated_by TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS energyiq_meter_alert_checks (
        project_id TEXT PRIMARY KEY,
        data_snapshot_id TEXT,
        checked_at TEXT NOT NULL
      );
    `);
  }

  list(projectId: string, filter: { status?: MeterAlertStatus; kind?: MeterAlertKind } = {}): MeterAlertRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM energyiq_meter_alerts
      WHERE project_id = ? AND (? IS NULL OR status = ?) AND (? IS NULL OR kind = ?)
      ORDER BY opened_at, alert_key
    `).all(projectId, filter.status ?? null, filter.status ?? null, filter.kind ?? null, filter.kind ?? null) as Array<Record<string, unknown>>;
    return rows.map(mapAlert);
  }

  get(projectId: string, key: string): MeterAlertRecord | undefined {
    const row = this.db.prepare("SELECT * FROM energyiq_meter_alerts WHERE project_id = ? AND alert_key = ?").get(projectId, key) as Record<string, unknown> | undefined;
    return row ? mapAlert(row) : undefined;
  }

  /**
   * Opens an alert. The same key again while it is open changes nothing ("exists"); a resolved one comes back
   * ("reopened"), keeping when it first opened.
   */
  open(input: { projectId: string; key: string; kind: MeterAlertKind; audience: MeterAlertAudience; subject: string; payload: Record<string, unknown>; now: Date }): "opened" | "reopened" | "exists" {
    const known = this.get(input.projectId, input.key);
    const at = input.now.toISOString();
    if (known?.status === "open") return "exists";
    if (known) {
      this.db.prepare(`UPDATE energyiq_meter_alerts SET status = 'open', resolved_at = NULL, payload_json = ?, updated_at = ? WHERE project_id = ? AND alert_key = ?`)
        .run(JSON.stringify(input.payload), at, input.projectId, input.key);
      return "reopened";
    }
    this.db.prepare(`
      INSERT INTO energyiq_meter_alerts (project_id, alert_key, kind, audience, subject, status, payload_json, opened_at, resolved_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'open', ?, ?, NULL, ?)
    `).run(input.projectId, input.key, input.kind, input.audience, input.subject, JSON.stringify(input.payload), at, at);
    return "opened";
  }

  /** Replaces what an alert says; returns false when nothing changed, so a re-check does not touch the row. */
  update(projectId: string, key: string, payload: Record<string, unknown>, now: Date): boolean {
    const known = this.get(projectId, key);
    if (!known || JSON.stringify(known.payload) === JSON.stringify(payload)) return false;
    this.db.prepare("UPDATE energyiq_meter_alerts SET payload_json = ?, updated_at = ? WHERE project_id = ? AND alert_key = ?")
      .run(JSON.stringify(payload), now.toISOString(), projectId, key);
    return true;
  }

  /** Resolves an open alert; returns false when it was not open. */
  resolve(projectId: string, key: string, payload: Record<string, unknown>, now: Date): boolean {
    const result = this.db.prepare(`
      UPDATE energyiq_meter_alerts SET status = 'resolved', resolved_at = ?, payload_json = ?, updated_at = ?
      WHERE project_id = ? AND alert_key = ? AND status = 'open'
    `).run(now.toISOString(), JSON.stringify(payload), now.toISOString(), projectId, key);
    return Number(result.changes) > 0;
  }

  /** Alerts for the bell: every open one, and those resolved since `sinceIso`, for the given audiences; newest first. */
  listForBell(projectId: string, audiences: readonly MeterAlertAudience[], sinceIso: string, limit = 20): MeterAlertRecord[] {
    if (!audiences.length) return [];
    const marks = audiences.map(() => "?").join(", ");
    const rows = this.db.prepare(`
      SELECT * FROM energyiq_meter_alerts
      WHERE project_id = ? AND audience IN (${marks}) AND (status = 'open' OR resolved_at >= ?)
      ORDER BY updated_at DESC, alert_key LIMIT ?
    `).all(projectId, ...audiences, sinceIso, limit) as Array<Record<string, unknown>>;
    return rows.map(mapAlert);
  }

  /** How many alerts of a kind opened in [fromIso, toIso). */
  countOpened(projectId: string, kind: MeterAlertKind, fromIso: string, toIso: string, where: (record: MeterAlertRecord) => boolean = () => true): number {
    const rows = this.db.prepare("SELECT * FROM energyiq_meter_alerts WHERE project_id = ? AND kind = ? AND opened_at >= ? AND opened_at < ?")
      .all(projectId, kind, fromIso, toIso) as Array<Record<string, unknown>>;
    return rows.map(mapAlert).filter(where).length;
  }

  getSettings(projectId: string): MeterAlertSettings {
    const row = this.db.prepare("SELECT * FROM energyiq_meter_alert_settings WHERE project_id = ?").get(projectId) as Record<string, unknown> | undefined;
    if (!row) return { projectId, patternAlerts: true, hardwareEmails: [] };
    return {
      projectId,
      patternAlerts: Number(row.pattern_enabled) !== 0,
      hardwareEmails: parseList(row.hardware_emails_json),
      updatedAt: String(row.updated_at),
      ...(typeof row.updated_by === "string" ? { updatedBy: row.updated_by } : {}),
    };
  }

  /** Changes only the parts given. */
  setSettings(projectId: string, patch: { patternAlerts?: unknown; hardwareEmails?: unknown }, userId: string, now = new Date()): MeterAlertSettings {
    const current = this.getSettings(projectId);
    if (patch.patternAlerts !== undefined && typeof patch.patternAlerts !== "boolean") throw new Error("ENERGYIQ_METER_ALERT_SETTINGS_INVALID");
    const patternAlerts = typeof patch.patternAlerts === "boolean" ? patch.patternAlerts : current.patternAlerts;
    const hardwareEmails = patch.hardwareEmails === undefined ? current.hardwareEmails : normalizeHardwareEmails(patch.hardwareEmails);
    this.db.prepare(`
      INSERT INTO energyiq_meter_alert_settings (project_id, pattern_enabled, hardware_emails_json, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        pattern_enabled = excluded.pattern_enabled,
        hardware_emails_json = excluded.hardware_emails_json,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    `).run(projectId, patternAlerts ? 1 : 0, hardwareEmails.length ? JSON.stringify(hardwareEmails) : null, userId, now.toISOString());
    return this.getSettings(projectId);
  }

  lastCheck(projectId: string): { dataSnapshotId?: string; checkedAt: string } | undefined {
    const row = this.db.prepare("SELECT * FROM energyiq_meter_alert_checks WHERE project_id = ?").get(projectId) as Record<string, unknown> | undefined;
    return row ? { ...(typeof row.data_snapshot_id === "string" ? { dataSnapshotId: row.data_snapshot_id } : {}), checkedAt: String(row.checked_at) } : undefined;
  }

  recordCheck(projectId: string, dataSnapshotId: string | null, now: Date): void {
    this.db.prepare(`
      INSERT INTO energyiq_meter_alert_checks (project_id, data_snapshot_id, checked_at) VALUES (?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET data_snapshot_id = excluded.data_snapshot_id, checked_at = excluded.checked_at
    `).run(projectId, dataSnapshotId, now.toISOString());
    this.db.prepare("DELETE FROM energyiq_meter_alerts WHERE project_id = ? AND status = 'resolved' AND resolved_at < ?")
      .run(projectId, new Date(now.getTime() - KEEP_RESOLVED_MS).toISOString());
  }
}

const mapAlert = (row: Record<string, unknown>): MeterAlertRecord => ({
  projectId: String(row.project_id),
  key: String(row.alert_key),
  kind: row.kind as MeterAlertKind,
  audience: row.audience as MeterAlertAudience,
  subject: String(row.subject),
  status: row.status === "resolved" ? "resolved" : "open",
  payload: parseObject(row.payload_json),
  openedAt: String(row.opened_at),
  ...(typeof row.resolved_at === "string" ? { resolvedAt: row.resolved_at } : {}),
  updatedAt: String(row.updated_at),
});

const parseObject = (value: unknown): Record<string, unknown> => {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) as unknown : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
};

const parseList = (value: unknown): string[] => {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) as unknown : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
};
