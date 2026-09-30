import type {
  ReportTimePolicyRevision,
  ReportWindowPolicy,
  ReportWindowStrategy,
} from "@datafoundry/contracts";
import type { DatabaseSync } from "node:sqlite";

export type EnergyIqReportTimePolicyRevisionRecord = {
  project_id: string;
  revision_id: string;
  policy: ReportTimePolicyRevision;
  published_by: string;
  published_at: string;
};

export const initializeEnergyIqReportTimePolicySchema = (db: DatabaseSync): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS energyiq_report_time_policy_revisions (
      project_id TEXT NOT NULL,
      revision_id TEXT NOT NULL,
      policy_json TEXT NOT NULL,
      published_by TEXT NOT NULL,
      published_at TEXT NOT NULL,
      PRIMARY KEY (project_id, revision_id),
      FOREIGN KEY (project_id) REFERENCES energyiq_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (published_by) REFERENCES users(id)
    );
  `);
};

export class EnergyIqReportTimePolicyStore {
  constructor(private readonly db: DatabaseSync) {}

  publish(input: {
    project_id: string;
    policy: unknown;
    published_by: string;
    published_at: string;
  }): EnergyIqReportTimePolicyRevisionRecord {
    const policy = canonicalizePolicy(input.policy);
    const revisionId = `${policy.policyId}@${policy.revision}`;
    try {
      this.db.prepare(`
        INSERT INTO energyiq_report_time_policy_revisions (
          project_id, revision_id, policy_json, published_by, published_at
        ) VALUES (?, ?, ?, ?, ?)
      `).run(
        input.project_id,
        revisionId,
        JSON.stringify(policy),
        input.published_by,
        requireInstant(input.published_at),
      );
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed/u.test(error.message)) {
        const existing = this.get(input.project_id, revisionId);
        if (existing && JSON.stringify(existing.policy) === JSON.stringify(policy)) return existing;
        throw new Error("ENERGYIQ_REPORT_TIME_POLICY_REVISION_CONFLICT");
      }
      throw error;
    }
    return this.require(input.project_id, revisionId);
  }

  get(projectId: string, revisionId: string): EnergyIqReportTimePolicyRevisionRecord | null {
    const row = this.db.prepare(`
      SELECT project_id, revision_id, policy_json, published_by, published_at
      FROM energyiq_report_time_policy_revisions
      WHERE project_id = ? AND revision_id = ?
    `).get(projectId, revisionId);
    return isRecord(row) ? mapRecord(row) : null;
  }

  getLatest(projectId: string): EnergyIqReportTimePolicyRevisionRecord | null {
    const row = this.db.prepare(`
      SELECT project_id, revision_id, policy_json, published_by, published_at
      FROM energyiq_report_time_policy_revisions
      WHERE project_id = ?
      ORDER BY published_at DESC, revision_id DESC
      LIMIT 1
    `).get(projectId);
    return isRecord(row) ? mapRecord(row) : null;
  }

  private require(projectId: string, revisionId: string): EnergyIqReportTimePolicyRevisionRecord {
    const record = this.get(projectId, revisionId);
    if (!record) throw new Error("ENERGYIQ_REPORT_TIME_POLICY_NOT_FOUND");
    return record;
  }
}

const canonicalizePolicy = (value: unknown): ReportTimePolicyRevision => {
  const record = requireRecord(value);
  requireExactKeys(record, ["policyId", "revision", "windows"]);
  if (!Array.isArray(record.windows) || record.windows.length === 0) {
    throw new Error("ENERGYIQ_REPORT_TIME_POLICY_WINDOWS_INVALID");
  }
  const windows = record.windows.map(canonicalizeWindow);
  const ids = new Set<string>();
  for (const window of windows) {
    if (ids.has(window.windowId)) throw new Error("ENERGYIQ_REPORT_TIME_POLICY_WINDOW_DUPLICATE");
    ids.add(window.windowId);
  }
  for (const window of windows) {
    const sourceWindowId = sourceWindow(window.strategy);
    if (sourceWindowId && (!ids.has(sourceWindowId) || sourceWindowId === window.windowId)) {
      throw new Error("ENERGYIQ_REPORT_TIME_POLICY_SOURCE_WINDOW_INVALID");
    }
  }
  return {
    policyId: requireId(record.policyId),
    revision: requireId(record.revision),
    windows,
  };
};

const canonicalizeWindow = (value: unknown): ReportWindowPolicy => {
  const record = requireRecord(value);
  requireExactKeys(record, ["windowId", "role", "label", "strategy"]);
  return {
    windowId: requireId(record.windowId),
    role: requireId(record.role),
    label: requireText(record.label),
    strategy: canonicalizeStrategy(record.strategy),
  };
};

const canonicalizeStrategy = (value: unknown): ReportWindowStrategy => {
  const record = requireRecord(value);
  if (record.kind === "rolling_complete_days") {
    requireExactKeys(record, ["kind", "days"]);
    return { kind: record.kind, days: requirePositiveInteger(record.days) };
  }
  if (record.kind === "calendar_month_to_date" || record.kind === "next_complete_calendar_month") {
    requireExactKeys(record, ["kind"]);
    return { kind: record.kind };
  }
  if (record.kind === "completed_calendar_months" || record.kind === "prior_equivalent_progress") {
    requireExactKeys(
      record,
      record.kind === "prior_equivalent_progress" ? ["kind", "months", "sourceWindowId"] : ["kind", "months"],
    );
    return record.kind === "prior_equivalent_progress"
      ? { kind: record.kind, months: requirePositiveInteger(record.months), sourceWindowId: requireId(record.sourceWindowId) }
      : { kind: record.kind, months: requirePositiveInteger(record.months) };
  }
  if (record.kind === "same_day_type_baseline") {
    requireExactKeys(record, ["kind", "lookbackDays", "sourceWindowId"]);
    return {
      kind: record.kind,
      lookbackDays: requirePositiveInteger(record.lookbackDays),
      sourceWindowId: requireId(record.sourceWindowId),
    };
  }
  throw new Error("ENERGYIQ_REPORT_TIME_POLICY_STRATEGY_INVALID");
};

const sourceWindow = (strategy: ReportWindowStrategy): string | undefined =>
  strategy.kind === "prior_equivalent_progress" || strategy.kind === "same_day_type_baseline"
    ? strategy.sourceWindowId
    : undefined;

const mapRecord = (row: Record<string, unknown>): EnergyIqReportTimePolicyRevisionRecord => {
  const policyJson = requiredString(row.policy_json);
  return {
    project_id: requiredString(row.project_id),
    revision_id: requiredString(row.revision_id),
    policy: canonicalizePolicy(JSON.parse(policyJson) as unknown),
    published_by: requiredString(row.published_by),
    published_at: requireInstant(row.published_at),
  };
};

const requireRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("ENERGYIQ_REPORT_TIME_POLICY_INVALID");
  }
  return value as Record<string, unknown>;
};

const requireExactKeys = (record: Record<string, unknown>, required: readonly string[]): void => {
  const allowed = new Set(required);
  if (required.some((key) => !(key in record)) || Object.keys(record).some((key) => !allowed.has(key))) {
    throw new Error("ENERGYIQ_REPORT_TIME_POLICY_SHAPE_INVALID");
  }
};

const requireText = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim() || /[<>]/u.test(value)) {
    throw new Error("ENERGYIQ_REPORT_TIME_POLICY_TEXT_INVALID");
  }
  return value.trim();
};

const requireId = (value: unknown): string => {
  const id = requireText(value);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9:._@-]{0,159}$/u.test(id)) {
    throw new Error("ENERGYIQ_REPORT_TIME_POLICY_ID_INVALID");
  }
  return id;
};

const requirePositiveInteger = (value: unknown): number => {
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new Error("ENERGYIQ_REPORT_TIME_POLICY_STRATEGY_INVALID");
  }
  return Number(value);
};

const requireInstant = (value: unknown): string => {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error("ENERGYIQ_REPORT_TIME_POLICY_INSTANT_INVALID");
  }
  return new Date(value).toISOString();
};

const requiredString = (value: unknown): string => {
  if (typeof value !== "string" || !value) throw new Error("ENERGYIQ_REPORT_TIME_POLICY_RECORD_INVALID");
  return value;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
