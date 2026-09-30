import type { DatabaseSync } from "node:sqlite";

import { markEnergyIqProjectConfigurationChanged } from "./energyiq-project-change-tracker.js";

export type EnergyIqRuleFamily = "data_quality" | "time" | "comparison";
export type EnergyIqRuleRequirement = "always"
  | "operating_hours"
  | "children"
  | "area_peers"
  | "people_peers"
  | "historical_baseline";

export type EnergyIqRuleRevisionRecord = {
  revision_id: string;
  rule_id: string;
  version: number;
  display_name: string;
  description: string;
  family: EnergyIqRuleFamily;
  severity: "info" | "warning";
  evaluation_key: string;
  metric_revision_ids: string[];
  parameters: Record<string, number | string>;
  requirement: EnergyIqRuleRequirement;
  created_at: string;
};

export type EnergyIqProjectRuleConfigRecord = {
  project_id: string;
  revision: number;
  selected_rule_revision_ids: string[];
  updated_by?: string;
  created_at?: string;
  updated_at?: string;
};

const BUILT_IN_RULES: readonly Omit<EnergyIqRuleRevisionRecord, "created_at">[] = [
  {
    revision_id: "quality.no_valid_data@1",
    rule_id: "quality.no_valid_data",
    version: 1,
    display_name: "No validated consumption",
    description: "Raise an informational finding when no valid interval consumption is available.",
    family: "data_quality",
    severity: "info",
    evaluation_key: "NO_DATA",
    metric_revision_ids: ["data.valid_interval_count@1"],
    parameters: { operator: "lte", threshold: 0 },
    requirement: "always",
  },
  {
    revision_id: "time.high_off_hours_share@1",
    rule_id: "time.high_off_hours_share",
    version: 1,
    display_name: "High off-hours energy share",
    description: "Flag a scope when at least 10% of its energy use occurs outside operating hours.",
    family: "time",
    severity: "warning",
    evaluation_key: "NON_OPERATING_SHARE",
    metric_revision_ids: ["energy.off_hours_share_pct@1", "energy.off_hours_usage_kwh@1"],
    parameters: { operator: "gte", threshold_pct: 10 },
    requirement: "operating_hours",
  },
  {
    revision_id: "comparison.highest_child_usage@1",
    rule_id: "comparison.highest_child_usage",
    version: 1,
    display_name: "Highest-consuming child scope",
    description: "Identify the highest-consuming child when at least two comparable child scopes exist.",
    family: "comparison",
    severity: "info",
    evaluation_key: "TOP_CHILD_SCOPE",
    metric_revision_ids: ["energy.total_usage_kwh@1"],
    parameters: { rank: 1, minimum_peers: 2 },
    requirement: "children",
  },
  {
    revision_id: "comparison.area_intensity_outlier@1",
    rule_id: "comparison.area_intensity_outlier",
    version: 1,
    display_name: "High energy use per square metre",
    description: "Flag the highest area-normalised peer when it is at least 1.2 times the sibling median.",
    family: "comparison",
    severity: "warning",
    evaluation_key: "AREA_NORMALISED_OUTLIER",
    metric_revision_ids: ["energy.usage_per_sqm@1"],
    parameters: { median_ratio: 1.2, minimum_peers: 3 },
    requirement: "area_peers",
  },
  {
    revision_id: "comparison.people_intensity_outlier@1",
    rule_id: "comparison.people_intensity_outlier",
    version: 1,
    display_name: "High energy use per person",
    description: "Flag the highest people-normalised peer when it is at least 1.2 times the sibling median.",
    family: "comparison",
    severity: "warning",
    evaluation_key: "PEOPLE_NORMALISED_OUTLIER",
    metric_revision_ids: ["energy.usage_per_person@1"],
    parameters: { median_ratio: 1.2, minimum_peers: 3 },
    requirement: "people_peers",
  },
  {
    revision_id: "comparison.daily_usage_above_baseline@1",
    rule_id: "comparison.daily_usage_above_baseline",
    version: 1,
    display_name: "Daily usage above comparable baseline",
    description: "Flag complete local days whose usage exceeds a frozen comparable-day baseline by both relative and absolute materiality thresholds.",
    family: "comparison",
    severity: "warning",
    evaluation_key: "DAILY_USAGE_ABOVE_BASELINE",
    metric_revision_ids: ["energy.total_usage_kwh@1"],
    parameters: {
      relative_threshold_pct: 20,
      absolute_impact_kwh: 20,
      minimum_coverage_pct: 95,
      minimum_sample_count: 4,
      maximum_quality_event_count: 0,
      maximum_lookback_days: 60,
      direction: "above",
      baseline_method: "mean_of_complete_comparable_days_by_local_hour",
    },
    requirement: "historical_baseline",
  },
  {
    revision_id: "comparison.school_holiday_context@1",
    rule_id: "comparison.school_holiday_context",
    version: 1,
    display_name: "School Holiday contextual comparison",
    description: "Compare complete School Holiday cohorts with adjacent Teaching cohorts and flag same-context daily anomalies.",
    family: "comparison",
    severity: "warning",
    evaluation_key: "SCHOOL_HOLIDAY_CONTEXT_COMPARISON",
    metric_revision_ids: ["energy.total_usage_kwh@1"],
    parameters: {
      anomaly_relative_threshold_pct: 20,
      anomaly_absolute_threshold_kwh: 20,
      minimum_cohort_sample_count: 2,
      minimum_anomaly_baseline_samples: 4,
      comparison_method: "complete_holiday_interval_vs_adjacent_teaching_by_day_context",
      anomaly_baseline_method: "same_academic_phase_and_day_context_leave_one_out_mean",
    },
    requirement: "historical_baseline",
  },
];

export const initializeEnergyIqRuleSchema = (db: DatabaseSync): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS energyiq_rule_revisions (
      revision_id TEXT PRIMARY KEY,
      rule_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      display_name TEXT NOT NULL,
      description TEXT NOT NULL,
      family TEXT NOT NULL CHECK (family IN ('data_quality', 'time', 'comparison')),
      severity TEXT NOT NULL CHECK (severity IN ('info', 'warning')),
      evaluation_key TEXT NOT NULL,
      metric_revision_ids_json TEXT NOT NULL,
      parameters_json TEXT NOT NULL,
      requirement TEXT NOT NULL CHECK (requirement IN ('always', 'operating_hours', 'children', 'area_peers', 'people_peers', 'historical_baseline')),
      created_at TEXT NOT NULL,
      UNIQUE (rule_id, version)
    );

    CREATE TABLE IF NOT EXISTS energyiq_project_rule_configs (
      project_id TEXT PRIMARY KEY,
      revision INTEGER NOT NULL,
      selected_rule_revision_ids_json TEXT NOT NULL,
      updated_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES energyiq_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (updated_by) REFERENCES users(id)
    );
  `);

  ensureEnergyIqHistoricalBaselineRuleRequirementSchema(db);

  ensureEnergyIqBuiltInRuleRevisions(db);
};

export const ensureEnergyIqBuiltInRuleRevisions = (db: DatabaseSync): void => {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO energyiq_rule_revisions (
      revision_id, rule_id, version, display_name, description, family, severity,
      evaluation_key, metric_revision_ids_json, parameters_json, requirement, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const createdAt = "2026-08-02T00:00:00.000Z";
  for (const rule of BUILT_IN_RULES) {
    insert.run(
      rule.revision_id,
      rule.rule_id,
      rule.version,
      rule.display_name,
      rule.description,
      rule.family,
      rule.severity,
      rule.evaluation_key,
      JSON.stringify(rule.metric_revision_ids),
      JSON.stringify(rule.parameters),
      rule.requirement,
      createdAt,
    );
  }
};

export class EnergyIqRuleStore {
  constructor(private readonly db: DatabaseSync) {}

  listRevisions(): EnergyIqRuleRevisionRecord[] {
    return this.db.prepare(`
      SELECT * FROM energyiq_rule_revisions
      ORDER BY CASE family WHEN 'data_quality' THEN 1 WHEN 'time' THEN 2 ELSE 3 END, display_name ASC
    `).all().map(mapRuleRevision);
  }

  getProjectConfig(projectId: string): EnergyIqProjectRuleConfigRecord {
    const row = this.db.prepare(`
      SELECT * FROM energyiq_project_rule_configs WHERE project_id = ?
    `).get(projectId);
    if (isRecord(row)) return mapProjectRuleConfig(row);
    const published = this.db.prepare(`
      SELECT selected_rule_revision_ids_json FROM energyiq_template_revisions
      WHERE project_id = ? ORDER BY sequence DESC LIMIT 1
    `).get(projectId);
    return {
      project_id: projectId,
      revision: 0,
      selected_rule_revision_ids: isRecord(published)
        ? JSON.parse(String(published.selected_rule_revision_ids_json)) as string[]
        : this.listRevisions()
        .filter((rule) => rule.requirement !== "historical_baseline")
        .map((rule) => rule.revision_id),
    };
  }

  saveProjectConfig(input: {
    project_id: string;
    expected_revision: number;
    selected_rule_revision_ids: string[];
    updated_by: string;
  }): EnergyIqProjectRuleConfigRecord {
    const catalog = this.listRevisions();
    const allowedIds = new Set(catalog.map((rule) => rule.revision_id));
    const requestedIds = new Set(input.selected_rule_revision_ids);
    if ([...requestedIds].some((id) => !allowedIds.has(id))) {
      throw new Error("ENERGYIQ_RULE_REVISION_NOT_FOUND");
    }
    const selectedIds = catalog
      .map((rule) => rule.revision_id)
      .filter((id) => requestedIds.has(id));
    const current = this.getProjectConfig(input.project_id);
    if (current.revision !== input.expected_revision) {
      throw new Error("ENERGYIQ_RULE_CONFIG_REVISION_CONFLICT");
    }

    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO energyiq_project_rule_configs (
        project_id, revision, selected_rule_revision_ids_json, updated_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        revision = excluded.revision,
        selected_rule_revision_ids_json = excluded.selected_rule_revision_ids_json,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    `).run(
      input.project_id,
      current.revision + 1,
      JSON.stringify(selectedIds),
      input.updated_by,
      current.created_at ?? now,
      now,
    );
    markEnergyIqProjectConfigurationChanged(this.db, input.project_id, now);
    return this.getProjectConfig(input.project_id);
  }
}

export const ensureEnergyIqHistoricalBaselineRuleRequirementSchema = (
  db: DatabaseSync,
): void => {
  const row = db.prepare(`
    SELECT sql FROM sqlite_master
    WHERE type = 'table' AND name = 'energyiq_rule_revisions'
  `).get();
  const sql = isRecord(row) && typeof row.sql === "string" ? row.sql : "";
  if (!sql || sql.includes("historical_baseline")) return;

  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      ALTER TABLE energyiq_rule_revisions
        RENAME TO energyiq_rule_revisions_legacy_requirement;

      CREATE TABLE energyiq_rule_revisions (
        revision_id TEXT PRIMARY KEY,
        rule_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        display_name TEXT NOT NULL,
        description TEXT NOT NULL,
        family TEXT NOT NULL CHECK (family IN ('data_quality', 'time', 'comparison')),
        severity TEXT NOT NULL CHECK (severity IN ('info', 'warning')),
        evaluation_key TEXT NOT NULL,
        metric_revision_ids_json TEXT NOT NULL,
        parameters_json TEXT NOT NULL,
        requirement TEXT NOT NULL CHECK (requirement IN ('always', 'operating_hours', 'children', 'area_peers', 'people_peers', 'historical_baseline')),
        created_at TEXT NOT NULL,
        UNIQUE (rule_id, version)
      );

      INSERT INTO energyiq_rule_revisions (
        revision_id, rule_id, version, display_name, description, family, severity,
        evaluation_key, metric_revision_ids_json, parameters_json, requirement, created_at
      )
      SELECT
        revision_id, rule_id, version, display_name, description, family, severity,
        evaluation_key, metric_revision_ids_json, parameters_json, requirement, created_at
      FROM energyiq_rule_revisions_legacy_requirement;

      DROP TABLE energyiq_rule_revisions_legacy_requirement;
    `);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
};

const mapRuleRevision = (row: unknown): EnergyIqRuleRevisionRecord => {
  if (!isRecord(row)) throw new Error("Invalid EnergyIQ rule revision row");
  return {
    revision_id: requiredString(row, "revision_id"),
    rule_id: requiredString(row, "rule_id"),
    version: requiredNumber(row, "version"),
    display_name: requiredString(row, "display_name"),
    description: requiredString(row, "description"),
    family: requiredString(row, "family") as EnergyIqRuleFamily,
    severity: requiredString(row, "severity") as "info" | "warning",
    evaluation_key: requiredString(row, "evaluation_key"),
    metric_revision_ids: parseStringArray(requiredString(row, "metric_revision_ids_json")),
    parameters: parseParameters(requiredString(row, "parameters_json")),
    requirement: requiredString(row, "requirement") as EnergyIqRuleRequirement,
    created_at: requiredString(row, "created_at"),
  };
};

const mapProjectRuleConfig = (row: Record<string, unknown>): EnergyIqProjectRuleConfigRecord => {
  const updatedBy = optionalString(row.updated_by);
  const createdAt = optionalString(row.created_at);
  const updatedAt = optionalString(row.updated_at);
  return {
    project_id: requiredString(row, "project_id"),
    revision: requiredNumber(row, "revision"),
    selected_rule_revision_ids: parseStringArray(requiredString(row, "selected_rule_revision_ids_json")),
    ...(updatedBy ? { updated_by: updatedBy } : {}),
    ...(createdAt ? { created_at: createdAt } : {}),
    ...(updatedAt ? { updated_at: updatedAt } : {}),
  };
};

const parseStringArray = (value: string): string[] => {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error("Invalid EnergyIQ rule configuration");
  }
  return parsed;
};

const parseParameters = (value: string): Record<string, number | string> => {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed) || Object.values(parsed).some((item) => typeof item !== "number" && typeof item !== "string")) {
    throw new Error("Invalid EnergyIQ rule parameters");
  }
  return parsed as Record<string, number | string>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const requiredString = (row: Record<string, unknown>, key: string): string => {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`Invalid ${key}`);
  return value;
};

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const requiredNumber = (row: Record<string, unknown>, key: string): number => {
  const value = row[key];
  if (typeof value !== "number") throw new Error(`Invalid ${key}`);
  return value;
};
