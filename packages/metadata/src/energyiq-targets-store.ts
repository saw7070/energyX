import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { normalizeCustomEmissionFactor, type EnergyIqCarbonSetting } from "./energyiq-carbon.js";

/**
 * What a company's energy manager sets for each site and for the company as a whole: a monthly budget, the carbon
 * factor used for Scope 2 reporting, the overnight-use check, and the reports emailed on a schedule. Alerts raised
 * against these are kept so each one is shown and emailed once.
 */

export type EnergyIqBudgetCurrency = "SGD" | "MYR";

export type EnergyIqProjectBudget = {
  /** Monthly electricity budget in the site's currency. */
  monthlyAmount: number;
  currency: EnergyIqBudgetCurrency;
  /** Optional monthly energy budget, for sites that manage kWh rather than money. */
  monthlyKwh?: number;
};

export type EnergyIqOvernightCheck = {
  enabled: boolean;
  /** How far above its usual level a night's use must be before it counts as unusual, in percent. */
  thresholdPct: number;
};

export const DEFAULT_OVERNIGHT_CHECK: EnergyIqOvernightCheck = { enabled: true, thresholdPct: 30 };

/**
 * Maximum demand: the highest half-hour average power in a month, which TNB bills per kW and which SP Group compares
 * with a site's contracted capacity. With a limit, a warning goes out once demand reaches `warnPct` of it, from the
 * 15-minute live readings and from each morning's check. Without one, a new monthly high is still reported.
 */
export type EnergyIqPeakDemandCheck = {
  enabled: boolean;
  /** The site's contracted capacity or its own maximum-demand target, in kW. */
  limitKw?: number;
  /** Warn when demand reaches this share of the limit, in percent. */
  warnPct: number;
};

export const DEFAULT_PEAK_DEMAND_CHECK: EnergyIqPeakDemandCheck = { enabled: true, warnPct: 90 };

export type EnergyIqProjectTargets = {
  projectId: string;
  budget?: EnergyIqProjectBudget;
  /** A customer-entered factor; absent means the official grid factor for the site's region. */
  carbon?: EnergyIqCarbonSetting;
  overnight: EnergyIqOvernightCheck;
  peak: EnergyIqPeakDemandCheck;
  /** Who this site's alert emails go to. Absent means the people who run the site (owners and set-up editors). */
  alertEmails?: string[];
  updatedAt?: string;
  updatedBy?: string;
};

export type EnergyIqTargetsPatch = {
  budget?: EnergyIqProjectBudget | null;
  carbon?: { kgCo2ePerKwh: unknown; year?: unknown; source?: unknown } | null;
  overnight?: Partial<EnergyIqOvernightCheck>;
  /** `limitKw: null` removes the limit. */
  peak?: Partial<Omit<EnergyIqPeakDemandCheck, "limitKw">> & { limitKw?: number | null };
  /** An empty list or null returns to the default recipients. */
  alertEmails?: unknown[] | null;
};

export type EnergyIqTargetAlertKind = "budget" | "overnight" | "peak";

export type EnergyIqTargetAlertRecord = {
  projectId: string;
  key: string;
  kind: EnergyIqTargetAlertKind;
  payload: Record<string, unknown>;
  createdAt: string;
};

/**
 * A change made on site whose effect is to be proven: what was done, on which day, and to which devices (none listed
 * means the whole site). The comparison itself is worked out from the readings each time it is shown.
 */
export type EnergyIqSavingsCheckRecord = {
  id: string;
  projectId: string;
  name: string;
  /** Local date the change was made. */
  changeDate: string;
  meterIds: string[];
  note?: string;
  createdBy?: string;
  createdAt: string;
};

export type EnergyIqReportFrequency = "weekly" | "monthly";

export type EnergyIqReportScheduleRecord = {
  id: string;
  workspaceId: string;
  name: string;
  frequency: EnergyIqReportFrequency;
  /** Empty means every site the recipient can see. */
  projectIds: string[];
  recipientUserIds: string[];
  /** Local hour the email goes out on the day after the period ends. */
  localHour: number;
  timezone: string;
  enabled: boolean;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
};

export type EnergyIqReportScheduleInput = {
  name: unknown;
  frequency: unknown;
  projectIds?: unknown;
  recipientUserIds: unknown;
  localHour?: unknown;
  timezone?: unknown;
  enabled?: unknown;
};

export type EnergyIqReportDeliveryRecord = {
  scheduleId: string;
  periodKey: string;
  status: "sent" | "failed" | "skipped";
  attempts: number;
  recipientCount: number;
  lastError?: string;
  updatedAt: string;
};

export const initializeEnergyIqTargetsSchema = (db: DatabaseSync): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS energyiq_project_targets (
      project_id TEXT PRIMARY KEY,
      budget_json TEXT,
      carbon_json TEXT,
      overnight_json TEXT,
      peak_json TEXT,
      alert_emails_json TEXT,
      updated_by TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS energyiq_target_alerts (
      project_id TEXT NOT NULL,
      alert_key TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('budget', 'overnight', 'peak')),
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (project_id, alert_key)
    );
    CREATE INDEX IF NOT EXISTS idx_energyiq_target_alerts_recent
      ON energyiq_target_alerts(project_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS energyiq_report_schedules (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'monthly')),
      project_ids_json TEXT NOT NULL,
      recipient_user_ids_json TEXT NOT NULL,
      local_hour INTEGER NOT NULL CHECK (local_hour BETWEEN 0 AND 23),
      timezone TEXT NOT NULL,
      enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_energyiq_report_schedules_workspace
      ON energyiq_report_schedules(workspace_id, created_at);

    CREATE TABLE IF NOT EXISTS energyiq_report_deliveries (
      schedule_id TEXT NOT NULL,
      period_key TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'skipped')),
      attempts INTEGER NOT NULL,
      recipient_count INTEGER NOT NULL,
      last_error TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (schedule_id, period_key)
    );
  `);
};

/**
 * Migration 0057: columns for the peak demand check and each site's alert recipients, and 'peak' as an alert kind. Safe on a database whose tables
 * were created with both already (a new install), and on one that ran it before.
 */
export const migrateEnergyIqTargetsPeakDemand = (db: DatabaseSync): void => {
  const columns = (db.prepare("PRAGMA table_info(energyiq_project_targets)").all() as Array<{ name: string }>).map((column) => column.name);
  if (!columns.includes("peak_json")) db.exec("ALTER TABLE energyiq_project_targets ADD COLUMN peak_json TEXT");
  if (!columns.includes("alert_emails_json")) db.exec("ALTER TABLE energyiq_project_targets ADD COLUMN alert_emails_json TEXT");
  const alertsSql = String((db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'energyiq_target_alerts'").get() as { sql?: string } | undefined)?.sql ?? "");
  if (alertsSql.includes("'peak'")) return;
  db.exec(`
    CREATE TABLE energyiq_target_alerts_next (
      project_id TEXT NOT NULL,
      alert_key TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('budget', 'overnight', 'peak')),
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (project_id, alert_key)
    );
    INSERT INTO energyiq_target_alerts_next (project_id, alert_key, kind, payload_json, created_at)
      SELECT project_id, alert_key, kind, payload_json, created_at FROM energyiq_target_alerts;
    DROP TABLE energyiq_target_alerts;
    ALTER TABLE energyiq_target_alerts_next RENAME TO energyiq_target_alerts;
    CREATE INDEX IF NOT EXISTS idx_energyiq_target_alerts_recent
      ON energyiq_target_alerts(project_id, created_at DESC);
  `);
};

/** Migration 0058: changes recorded on site for proof of savings. */
export const initializeEnergyIqSavingsChecksSchema = (db: DatabaseSync): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS energyiq_savings_checks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      change_date TEXT NOT NULL,
      meter_ids_json TEXT NOT NULL,
      note TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_energyiq_savings_checks_project
      ON energyiq_savings_checks(project_id, change_date DESC);
  `);
};

const MAX_SAVINGS_CHECKS_PER_PROJECT = 100;

const MAX_SCHEDULES_PER_WORKSPACE = 50;
const MAX_RECIPIENTS = 100;

export class EnergyIqTargetsStore {
  constructor(private readonly db: DatabaseSync) {}

  getTargets(projectId: string): EnergyIqProjectTargets {
    const row = this.db.prepare("SELECT * FROM energyiq_project_targets WHERE project_id = ?").get(projectId) as Record<string, unknown> | undefined;
    if (!row) return { projectId, overnight: { ...DEFAULT_OVERNIGHT_CHECK }, peak: { ...DEFAULT_PEAK_DEMAND_CHECK } };
    const budget = parseJson<EnergyIqProjectBudget>(row.budget_json);
    const carbon = parseJson<EnergyIqCarbonSetting>(row.carbon_json);
    const overnight = parseJson<EnergyIqOvernightCheck>(row.overnight_json);
    const peak = parseJson<EnergyIqPeakDemandCheck>(row.peak_json);
    const alertEmails = parseJson<string[]>(row.alert_emails_json);
    return {
      projectId,
      ...(budget ? { budget } : {}),
      ...(carbon ? { carbon } : {}),
      overnight: overnight ?? { ...DEFAULT_OVERNIGHT_CHECK },
      peak: peak ?? { ...DEFAULT_PEAK_DEMAND_CHECK },
      ...(alertEmails && alertEmails.length > 0 ? { alertEmails } : {}),
      updatedAt: String(row.updated_at),
      ...(typeof row.updated_by === "string" ? { updatedBy: row.updated_by } : {}),
    };
  }

  /** Changes only the parts given; null clears a budget or returns carbon to the official grid factor. */
  setTargets(projectId: string, patch: EnergyIqTargetsPatch, userId: string, now = new Date()): EnergyIqProjectTargets {
    const current = this.getTargets(projectId);
    const budget = patch.budget === undefined ? current.budget : patch.budget === null ? undefined : normalizeBudget(patch.budget);
    const carbon = patch.carbon === undefined ? current.carbon : patch.carbon === null ? undefined : normalizeCustomEmissionFactor(patch.carbon);
    const overnight = patch.overnight === undefined ? current.overnight : normalizeOvernight({ ...current.overnight, ...patch.overnight });
    const peak = patch.peak === undefined ? current.peak : normalizePeak(current.peak, patch.peak);
    const alertEmails = patch.alertEmails === undefined ? current.alertEmails : normalizeAlertEmails(patch.alertEmails);
    this.db.prepare(`
      INSERT INTO energyiq_project_targets (project_id, budget_json, carbon_json, overnight_json, peak_json, alert_emails_json, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        budget_json = excluded.budget_json,
        carbon_json = excluded.carbon_json,
        overnight_json = excluded.overnight_json,
        peak_json = excluded.peak_json,
        alert_emails_json = excluded.alert_emails_json,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    `).run(
      projectId,
      budget ? JSON.stringify(budget) : null,
      carbon ? JSON.stringify(carbon) : null,
      JSON.stringify(overnight),
      JSON.stringify(peak),
      alertEmails && alertEmails.length > 0 ? JSON.stringify(alertEmails) : null,
      userId,
      now.toISOString(),
    );
    return this.getTargets(projectId);
  }

  /** Projects with a budget, for the daily budget check. */
  listProjectIdsWithBudget(): string[] {
    return (this.db.prepare("SELECT project_id FROM energyiq_project_targets WHERE budget_json IS NOT NULL ORDER BY project_id").all() as Array<{ project_id: string }>)
      .map((row) => row.project_id);
  }

  /** Records an alert once; returns false when the same alert was already raised. */
  recordAlert(input: { projectId: string; key: string; kind: EnergyIqTargetAlertKind; payload: Record<string, unknown>; now?: Date }): boolean {
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO energyiq_target_alerts (project_id, alert_key, kind, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(input.projectId, input.key, input.kind, JSON.stringify(input.payload), (input.now ?? new Date()).toISOString());
    return Number(result.changes) > 0;
  }

  listRecentAlerts(projectId: string, sinceIso: string, limit = 20): EnergyIqTargetAlertRecord[] {
    return (this.db.prepare(`
      SELECT * FROM energyiq_target_alerts WHERE project_id = ? AND created_at >= ? ORDER BY created_at DESC LIMIT ?
    `).all(projectId, sinceIso, limit) as Array<Record<string, unknown>>).map((row) => ({
      projectId: String(row.project_id),
      key: String(row.alert_key),
      kind: row.kind as EnergyIqTargetAlertKind,
      payload: parseJson<Record<string, unknown>>(row.payload_json) ?? {},
      createdAt: String(row.created_at),
    }));
  }

  listSavingsChecks(projectId: string): EnergyIqSavingsCheckRecord[] {
    return (this.db.prepare("SELECT * FROM energyiq_savings_checks WHERE project_id = ? ORDER BY change_date DESC, created_at DESC").all(projectId) as Array<Record<string, unknown>>)
      .map(mapSavingsCheck);
  }

  getSavingsCheck(id: string): EnergyIqSavingsCheckRecord | undefined {
    const row = this.db.prepare("SELECT * FROM energyiq_savings_checks WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? mapSavingsCheck(row) : undefined;
  }

  createSavingsCheck(projectId: string, input: { name: unknown; changeDate: unknown; meterIds?: unknown; note?: unknown }, userId: string, now = new Date()): EnergyIqSavingsCheckRecord {
    const count = Number((this.db.prepare("SELECT COUNT(*) AS count FROM energyiq_savings_checks WHERE project_id = ?").get(projectId) as { count: number }).count);
    if (count >= MAX_SAVINGS_CHECKS_PER_PROJECT) throw new Error("ENERGYIQ_SAVINGS_CHECK_LIMIT");
    const name = typeof input.name === "string" ? input.name.trim().slice(0, 120) : "";
    if (!name) throw new Error("ENERGYIQ_SAVINGS_CHECK_NAME_REQUIRED");
    const changeDate = typeof input.changeDate === "string" ? input.changeDate.trim() : "";
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(changeDate) || Number.isNaN(Date.parse(`${changeDate}T00:00:00Z`))) throw new Error("ENERGYIQ_SAVINGS_CHECK_DATE_INVALID");
    if (changeDate > now.toISOString().slice(0, 10)) throw new Error("ENERGYIQ_SAVINGS_CHECK_DATE_INVALID");
    const meterIds = stringList(input.meterIds ?? [], 200, "ENERGYIQ_SAVINGS_CHECK_METERS_INVALID");
    const note = typeof input.note === "string" && input.note.trim() ? input.note.trim().slice(0, 500) : undefined;
    const id = `savings-check-${randomUUID()}`;
    this.db.prepare(`
      INSERT INTO energyiq_savings_checks (id, project_id, name, change_date, meter_ids_json, note, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, projectId, name, changeDate, JSON.stringify(meterIds), note ?? null, userId, now.toISOString());
    return this.getSavingsCheck(id)!;
  }

  deleteSavingsCheck(id: string): boolean {
    return Number(this.db.prepare("DELETE FROM energyiq_savings_checks WHERE id = ?").run(id).changes) > 0;
  }

  listSchedules(workspaceId: string): EnergyIqReportScheduleRecord[] {
    return (this.db.prepare("SELECT * FROM energyiq_report_schedules WHERE workspace_id = ? ORDER BY created_at, id").all(workspaceId) as Array<Record<string, unknown>>)
      .map(mapSchedule);
  }

  listEnabledSchedules(): EnergyIqReportScheduleRecord[] {
    return (this.db.prepare("SELECT * FROM energyiq_report_schedules WHERE enabled = 1 ORDER BY workspace_id, id").all() as Array<Record<string, unknown>>)
      .map(mapSchedule);
  }

  getSchedule(id: string): EnergyIqReportScheduleRecord | undefined {
    const row = this.db.prepare("SELECT * FROM energyiq_report_schedules WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    return row ? mapSchedule(row) : undefined;
  }

  createSchedule(workspaceId: string, input: EnergyIqReportScheduleInput, userId: string, now = new Date()): EnergyIqReportScheduleRecord {
    const count = Number((this.db.prepare("SELECT COUNT(*) AS count FROM energyiq_report_schedules WHERE workspace_id = ?").get(workspaceId) as { count: number }).count);
    if (count >= MAX_SCHEDULES_PER_WORKSPACE) throw new Error("ENERGYIQ_REPORT_SCHEDULE_LIMIT");
    const value = normalizeSchedule(input);
    const id = `report-schedule-${randomUUID()}`;
    const at = now.toISOString();
    this.db.prepare(`
      INSERT INTO energyiq_report_schedules
        (id, workspace_id, name, frequency, project_ids_json, recipient_user_ids_json, local_hour, timezone, enabled, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, workspaceId, value.name, value.frequency, JSON.stringify(value.projectIds), JSON.stringify(value.recipientUserIds),
      value.localHour, value.timezone, value.enabled ? 1 : 0, userId, at, at);
    return this.getSchedule(id)!;
  }

  updateSchedule(id: string, input: EnergyIqReportScheduleInput, now = new Date()): EnergyIqReportScheduleRecord {
    const current = this.getSchedule(id);
    if (!current) throw new Error("ENERGYIQ_REPORT_SCHEDULE_NOT_FOUND");
    const value = normalizeSchedule({
      name: input.name ?? current.name,
      frequency: input.frequency ?? current.frequency,
      projectIds: input.projectIds ?? current.projectIds,
      recipientUserIds: input.recipientUserIds ?? current.recipientUserIds,
      localHour: input.localHour ?? current.localHour,
      timezone: input.timezone ?? current.timezone,
      enabled: input.enabled ?? current.enabled,
    });
    this.db.prepare(`
      UPDATE energyiq_report_schedules SET name = ?, frequency = ?, project_ids_json = ?, recipient_user_ids_json = ?,
        local_hour = ?, timezone = ?, enabled = ?, updated_at = ? WHERE id = ?
    `).run(value.name, value.frequency, JSON.stringify(value.projectIds), JSON.stringify(value.recipientUserIds),
      value.localHour, value.timezone, value.enabled ? 1 : 0, now.toISOString(), id);
    return this.getSchedule(id)!;
  }

  deleteSchedule(id: string): boolean {
    this.db.prepare("DELETE FROM energyiq_report_deliveries WHERE schedule_id = ?").run(id);
    return Number(this.db.prepare("DELETE FROM energyiq_report_schedules WHERE id = ?").run(id).changes) > 0;
  }

  findDelivery(scheduleId: string, periodKey: string): EnergyIqReportDeliveryRecord | undefined {
    const row = this.db.prepare("SELECT * FROM energyiq_report_deliveries WHERE schedule_id = ? AND period_key = ?").get(scheduleId, periodKey) as Record<string, unknown> | undefined;
    return row ? mapDelivery(row) : undefined;
  }

  lastDelivery(scheduleId: string): EnergyIqReportDeliveryRecord | undefined {
    const row = this.db.prepare("SELECT * FROM energyiq_report_deliveries WHERE schedule_id = ? ORDER BY updated_at DESC LIMIT 1").get(scheduleId) as Record<string, unknown> | undefined;
    return row ? mapDelivery(row) : undefined;
  }

  recordDelivery(input: { scheduleId: string; periodKey: string; status: EnergyIqReportDeliveryRecord["status"]; recipientCount: number; error?: string; now?: Date }): EnergyIqReportDeliveryRecord {
    this.db.prepare(`
      INSERT INTO energyiq_report_deliveries (schedule_id, period_key, status, attempts, recipient_count, last_error, updated_at)
      VALUES (?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(schedule_id, period_key) DO UPDATE SET
        status = excluded.status,
        attempts = energyiq_report_deliveries.attempts + 1,
        recipient_count = excluded.recipient_count,
        last_error = excluded.last_error,
        updated_at = excluded.updated_at
    `).run(input.scheduleId, input.periodKey, input.status, input.recipientCount, input.error?.slice(0, 300) ?? null, (input.now ?? new Date()).toISOString());
    return this.findDelivery(input.scheduleId, input.periodKey)!;
  }
}

const normalizeBudget = (input: EnergyIqProjectBudget): EnergyIqProjectBudget => {
  const amount = Number(input.monthlyAmount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) throw new Error("ENERGYIQ_BUDGET_AMOUNT_INVALID");
  if (input.currency !== "SGD" && input.currency !== "MYR") throw new Error("ENERGYIQ_BUDGET_CURRENCY_INVALID");
  const kwh = input.monthlyKwh === undefined || input.monthlyKwh === null || (input.monthlyKwh as unknown) === "" ? undefined : Number(input.monthlyKwh);
  if (kwh !== undefined && (!Number.isFinite(kwh) || kwh <= 0 || kwh > 10_000_000_000)) throw new Error("ENERGYIQ_BUDGET_KWH_INVALID");
  return { monthlyAmount: Math.round(amount * 100) / 100, currency: input.currency, ...(kwh === undefined ? {} : { monthlyKwh: Math.round(kwh * 100) / 100 }) };
};

const normalizeOvernight = (input: Partial<EnergyIqOvernightCheck>): EnergyIqOvernightCheck => {
  const threshold = Number(input.thresholdPct ?? DEFAULT_OVERNIGHT_CHECK.thresholdPct);
  if (!Number.isFinite(threshold) || threshold < 10 || threshold > 300) throw new Error("ENERGYIQ_OVERNIGHT_THRESHOLD_INVALID");
  return { enabled: input.enabled !== false, thresholdPct: Math.round(threshold) };
};

const normalizePeak = (current: EnergyIqPeakDemandCheck, patch: NonNullable<EnergyIqTargetsPatch["peak"]>): EnergyIqPeakDemandCheck => {
  const warnPct = Number(patch.warnPct ?? current.warnPct);
  if (!Number.isFinite(warnPct) || warnPct < 50 || warnPct > 100) throw new Error("ENERGYIQ_PEAK_WARN_PCT_INVALID");
  const rawLimit = patch.limitKw === undefined ? current.limitKw : patch.limitKw;
  const limitKw = rawLimit === null || rawLimit === undefined || (rawLimit as unknown) === "" ? undefined : Number(rawLimit);
  if (limitKw !== undefined && (!Number.isFinite(limitKw) || limitKw <= 0 || limitKw > 1_000_000)) throw new Error("ENERGYIQ_PEAK_LIMIT_INVALID");
  return {
    enabled: (patch.enabled ?? current.enabled) !== false,
    ...(limitKw === undefined ? {} : { limitKw: Math.round(limitKw * 10) / 10 }),
    warnPct: Math.round(warnPct),
  };
};

const MAX_ALERT_EMAILS = 20;
const EMAIL_PATTERN = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/u;

const normalizeAlertEmails = (value: unknown[] | null): string[] | undefined => {
  if (value === null) return undefined;
  if (!Array.isArray(value) || value.length > MAX_ALERT_EMAILS) throw new Error("ENERGYIQ_ALERT_EMAILS_INVALID");
  const emails = value.map((item) => (typeof item === "string" ? item.trim().toLowerCase() : ""));
  if (emails.some((email) => email.length > 254 || !EMAIL_PATTERN.test(email))) throw new Error("ENERGYIQ_ALERT_EMAILS_INVALID");
  const unique = [...new Set(emails)].sort();
  return unique.length > 0 ? unique : undefined;
};

const normalizeSchedule = (input: EnergyIqReportScheduleInput) => {
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 120) : "";
  if (!name) throw new Error("ENERGYIQ_REPORT_SCHEDULE_NAME_REQUIRED");
  if (input.frequency !== "weekly" && input.frequency !== "monthly") throw new Error("ENERGYIQ_REPORT_SCHEDULE_FREQUENCY_INVALID");
  const projectIds = stringList(input.projectIds ?? [], 500, "ENERGYIQ_REPORT_SCHEDULE_PROJECTS_INVALID");
  const recipientUserIds = stringList(input.recipientUserIds, MAX_RECIPIENTS, "ENERGYIQ_REPORT_SCHEDULE_RECIPIENTS_INVALID");
  if (recipientUserIds.length === 0) throw new Error("ENERGYIQ_REPORT_SCHEDULE_RECIPIENTS_REQUIRED");
  const localHour = input.localHour === undefined ? 8 : Number(input.localHour);
  if (!Number.isInteger(localHour) || localHour < 0 || localHour > 23) throw new Error("ENERGYIQ_REPORT_SCHEDULE_HOUR_INVALID");
  const timezone = typeof input.timezone === "string" && input.timezone.trim() ? input.timezone.trim() : "Asia/Singapore";
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    throw new Error("ENERGYIQ_REPORT_SCHEDULE_TIMEZONE_INVALID");
  }
  return { name, frequency: input.frequency as EnergyIqReportFrequency, projectIds, recipientUserIds, localHour, timezone, enabled: input.enabled !== false };
};

const stringList = (value: unknown, max: number, code: string): string[] => {
  if (!Array.isArray(value) || value.length > max || value.some((item) => typeof item !== "string" || !item.trim() || item.length > 200)) throw new Error(code);
  return [...new Set((value as string[]).map((item) => item.trim()))];
};

const mapSchedule = (row: Record<string, unknown>): EnergyIqReportScheduleRecord => ({
  id: String(row.id),
  workspaceId: String(row.workspace_id),
  name: String(row.name),
  frequency: row.frequency as EnergyIqReportFrequency,
  projectIds: parseJson<string[]>(row.project_ids_json) ?? [],
  recipientUserIds: parseJson<string[]>(row.recipient_user_ids_json) ?? [],
  localHour: Number(row.local_hour),
  timezone: String(row.timezone),
  enabled: Number(row.enabled) === 1,
  ...(typeof row.created_by === "string" ? { createdBy: row.created_by } : {}),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
});

const mapSavingsCheck = (row: Record<string, unknown>): EnergyIqSavingsCheckRecord => ({
  id: String(row.id),
  projectId: String(row.project_id),
  name: String(row.name),
  changeDate: String(row.change_date),
  meterIds: parseJson<string[]>(row.meter_ids_json) ?? [],
  ...(typeof row.note === "string" && row.note ? { note: row.note } : {}),
  ...(typeof row.created_by === "string" ? { createdBy: row.created_by } : {}),
  createdAt: String(row.created_at),
});

const mapDelivery = (row: Record<string, unknown>): EnergyIqReportDeliveryRecord => ({
  scheduleId: String(row.schedule_id),
  periodKey: String(row.period_key),
  status: row.status as EnergyIqReportDeliveryRecord["status"],
  attempts: Number(row.attempts),
  recipientCount: Number(row.recipient_count),
  ...(typeof row.last_error === "string" ? { lastError: row.last_error } : {}),
  updatedAt: String(row.updated_at),
});

const parseJson = <T>(value: unknown): T | undefined => {
  if (typeof value !== "string" || !value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
};
