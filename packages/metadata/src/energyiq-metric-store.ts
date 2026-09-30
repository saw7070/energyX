import type { DatabaseSync } from "node:sqlite";

import { markEnergyIqProjectConfigurationChanged } from "./energyiq-project-change-tracker.js";

export type EnergyIqMetricFamily = "aggregate" | "time" | "normalised" | "quality";
export type EnergyIqMetricRequirement = "always" | "area" | "people";

export type EnergyIqMetricRevisionRecord = {
  revision_id: string;
  metric_id: string;
  version: number;
  display_name: string;
  description: string;
  family: EnergyIqMetricFamily;
  unit: string;
  value_type: "number";
  calculation_key: string;
  requirement: EnergyIqMetricRequirement;
  created_at: string;
};

export type EnergyIqProjectMetricConfigRecord = {
  project_id: string;
  revision: number;
  selected_metric_revision_ids: string[];
  updated_by?: string;
  created_at?: string;
  updated_at?: string;
};

const BUILT_IN_METRICS: readonly Omit<EnergyIqMetricRevisionRecord, "created_at">[] = [
  {
    revision_id: "energy.total_usage_kwh@1",
    metric_id: "energy.total_usage_kwh",
    version: 1,
    display_name: "Total energy use",
    description: "Interval energy consumed inside the selected scope and time range.",
    family: "aggregate",
    unit: "kWh",
    value_type: "number",
    calculation_key: "summary.usageKwh",
    requirement: "always",
  },
  {
    revision_id: "energy.average_daily_usage_kwh@1",
    metric_id: "energy.average_daily_usage_kwh",
    version: 1,
    display_name: "Average daily energy use",
    description: "Total energy use divided by the number of calendar days in the analysis period.",
    family: "aggregate",
    unit: "kWh/day",
    value_type: "number",
    calculation_key: "summary.averageDailyUsageKwh",
    requirement: "always",
  },
  {
    revision_id: "energy.peak_demand_kw@1",
    metric_id: "energy.peak_demand_kw",
    version: 1,
    display_name: "Peak demand",
    description: "Highest interval-average demand observed in the selected period.",
    family: "time",
    unit: "kW",
    value_type: "number",
    calculation_key: "summary.peakKw",
    requirement: "always",
  },
  {
    revision_id: "energy.off_hours_usage_kwh@1",
    metric_id: "energy.off_hours_usage_kwh",
    version: 1,
    display_name: "Off-hours energy use",
    description: "Energy consumed outside the configured operating hours.",
    family: "time",
    unit: "kWh",
    value_type: "number",
    calculation_key: "summary.nonOperatingKwh",
    requirement: "always",
  },
  {
    revision_id: "energy.off_hours_share_pct@1",
    metric_id: "energy.off_hours_share_pct",
    version: 1,
    display_name: "Off-hours share",
    description: "Off-hours energy use as a percentage of total energy use.",
    family: "time",
    unit: "%",
    value_type: "number",
    calculation_key: "summary.nonOperatingSharePct",
    requirement: "always",
  },
  {
    revision_id: "energy.usage_per_sqm@1",
    metric_id: "energy.usage_per_sqm",
    version: 1,
    display_name: "Energy use per square metre",
    description: "Total energy use normalised by the effective floor area of the selected scope.",
    family: "normalised",
    unit: "kWh/m2",
    value_type: "number",
    calculation_key: "summary.kwhPerSqm",
    requirement: "area",
  },
  {
    revision_id: "energy.usage_per_person@1",
    metric_id: "energy.usage_per_person",
    version: 1,
    display_name: "Energy use per person",
    description: "Total energy use normalised by the effective 24-hour occupant count.",
    family: "normalised",
    unit: "kWh/person",
    value_type: "number",
    calculation_key: "summary.kwhPerPerson",
    requirement: "people",
  },
  {
    revision_id: "data.valid_interval_count@1",
    metric_id: "data.valid_interval_count",
    version: 1,
    display_name: "Valid interval count",
    description: "Number of usable interval facts included in the analysis.",
    family: "quality",
    unit: "intervals",
    value_type: "number",
    calculation_key: "summary.validIntervalCount",
    requirement: "always",
  },
  {
    revision_id: "data.quality_event_count@1",
    metric_id: "data.quality_event_count",
    version: 1,
    display_name: "Data quality events",
    description: "Number of quality flags attached to the included interval facts.",
    family: "quality",
    unit: "events",
    value_type: "number",
    calculation_key: "summary.qualityEventCount",
    requirement: "always",
  },
];

export const initializeEnergyIqMetricSchema = (db: DatabaseSync): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS energyiq_metric_revisions (
      revision_id TEXT PRIMARY KEY,
      metric_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      display_name TEXT NOT NULL,
      description TEXT NOT NULL,
      family TEXT NOT NULL CHECK (family IN ('aggregate', 'time', 'normalised', 'quality')),
      unit TEXT NOT NULL,
      value_type TEXT NOT NULL CHECK (value_type = 'number'),
      calculation_key TEXT NOT NULL,
      requirement TEXT NOT NULL CHECK (requirement IN ('always', 'area', 'people')),
      created_at TEXT NOT NULL,
      UNIQUE (metric_id, version)
    );

    CREATE TABLE IF NOT EXISTS energyiq_project_metric_configs (
      project_id TEXT PRIMARY KEY,
      revision INTEGER NOT NULL,
      selected_metric_revision_ids_json TEXT NOT NULL,
      updated_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES energyiq_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (updated_by) REFERENCES users(id)
    );
  `);

  const insert = db.prepare(`
    INSERT OR IGNORE INTO energyiq_metric_revisions (
      revision_id, metric_id, version, display_name, description, family,
      unit, value_type, calculation_key, requirement, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const createdAt = "2026-08-01T00:00:00.000Z";
  for (const metric of BUILT_IN_METRICS) {
    insert.run(
      metric.revision_id,
      metric.metric_id,
      metric.version,
      metric.display_name,
      metric.description,
      metric.family,
      metric.unit,
      metric.value_type,
      metric.calculation_key,
      metric.requirement,
      createdAt,
    );
  }
};

export class EnergyIqMetricStore {
  constructor(private readonly db: DatabaseSync) {}

  listRevisions(): EnergyIqMetricRevisionRecord[] {
    return this.db.prepare(`
      SELECT * FROM energyiq_metric_revisions
      ORDER BY
        CASE family WHEN 'aggregate' THEN 1 WHEN 'time' THEN 2 WHEN 'normalised' THEN 3 ELSE 4 END,
        display_name ASC
    `).all().map(mapMetricRevision);
  }

  getProjectConfig(projectId: string): EnergyIqProjectMetricConfigRecord {
    const row = this.db.prepare(`
      SELECT * FROM energyiq_project_metric_configs WHERE project_id = ?
    `).get(projectId);
    if (isRecord(row)) return mapProjectMetricConfig(row);
    return {
      project_id: projectId,
      revision: 0,
      selected_metric_revision_ids: this.listRevisions().map((metric) => metric.revision_id),
    };
  }

  saveProjectConfig(input: {
    project_id: string;
    expected_revision: number;
    selected_metric_revision_ids: string[];
    updated_by: string;
  }): EnergyIqProjectMetricConfigRecord {
    const catalog = this.listRevisions();
    const allowedIds = new Set(catalog.map((metric) => metric.revision_id));
    const requestedIds = new Set(input.selected_metric_revision_ids);
    if ([...requestedIds].some((id) => !allowedIds.has(id))) {
      throw new Error("ENERGYIQ_METRIC_REVISION_NOT_FOUND");
    }
    const selectedIds = catalog
      .map((metric) => metric.revision_id)
      .filter((id) => requestedIds.has(id));

    const current = this.getProjectConfig(input.project_id);
    if (current.revision !== input.expected_revision) {
      throw new Error("ENERGYIQ_METRIC_CONFIG_REVISION_CONFLICT");
    }

    const now = new Date().toISOString();
    const nextRevision = current.revision + 1;
    this.db.prepare(`
      INSERT INTO energyiq_project_metric_configs (
        project_id, revision, selected_metric_revision_ids_json, updated_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        revision = excluded.revision,
        selected_metric_revision_ids_json = excluded.selected_metric_revision_ids_json,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    `).run(
      input.project_id,
      nextRevision,
      JSON.stringify(selectedIds),
      input.updated_by,
      current.created_at ?? now,
      now,
    );
    markEnergyIqProjectConfigurationChanged(this.db, input.project_id, now);
    return this.getProjectConfig(input.project_id);
  }
}

const mapMetricRevision = (row: unknown): EnergyIqMetricRevisionRecord => {
  if (!isRecord(row)) throw new Error("Invalid EnergyIQ metric revision row");
  return {
    revision_id: requiredString(row, "revision_id"),
    metric_id: requiredString(row, "metric_id"),
    version: requiredNumber(row, "version"),
    display_name: requiredString(row, "display_name"),
    description: requiredString(row, "description"),
    family: requiredString(row, "family") as EnergyIqMetricFamily,
    unit: requiredString(row, "unit"),
    value_type: "number",
    calculation_key: requiredString(row, "calculation_key"),
    requirement: requiredString(row, "requirement") as EnergyIqMetricRequirement,
    created_at: requiredString(row, "created_at"),
  };
};

const mapProjectMetricConfig = (row: Record<string, unknown>): EnergyIqProjectMetricConfigRecord => {
  const updatedBy = optionalString(row.updated_by);
  const createdAt = optionalString(row.created_at);
  const updatedAt = optionalString(row.updated_at);
  return {
    project_id: requiredString(row, "project_id"),
    revision: requiredNumber(row, "revision"),
    selected_metric_revision_ids: parseStringArray(requiredString(row, "selected_metric_revision_ids_json")),
    ...(updatedBy ? { updated_by: updatedBy } : {}),
    ...(createdAt ? { created_at: createdAt } : {}),
    ...(updatedAt ? { updated_at: updatedAt } : {}),
  };
};

const parseStringArray = (value: string): string[] => {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error("Invalid EnergyIQ metric configuration");
  }
  return parsed;
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
