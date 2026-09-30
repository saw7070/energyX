import type { DatabaseSync } from "node:sqlite";

export type EnergyIqSavedAnalysisRecord = {
  id: string;
  series_id: string;
  sequence: number;
  project_id: string;
  workspace_id: string;
  scope_id: string;
  scope_name: string;
  resource: "electricity";
  title: string;
  query_json: string;
  analysis_json: string;
  snapshot_json?: string;
  view_state_json?: string;
  ai_result_json?: string;
  template_revision_id: string;
  data_snapshot_id: string;
  rerun_of_id?: string;
  created_by: string;
  created_at: string;
};

export const initializeEnergyIqSavedAnalysisSchema = (db: DatabaseSync): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS energyiq_saved_analyses (
      id TEXT PRIMARY KEY,
      series_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      project_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      scope_name TEXT NOT NULL,
      resource TEXT NOT NULL CHECK (resource = 'electricity'),
      title TEXT NOT NULL,
      query_json TEXT NOT NULL,
      analysis_json TEXT NOT NULL,
      snapshot_json TEXT,
      view_state_json TEXT,
      ai_result_json TEXT,
      template_revision_id TEXT NOT NULL,
      data_snapshot_id TEXT NOT NULL,
      rerun_of_id TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (series_id, sequence),
      FOREIGN KEY (project_id) REFERENCES energyiq_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (rerun_of_id) REFERENCES energyiq_saved_analyses(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_energyiq_saved_analyses_project
      ON energyiq_saved_analyses(project_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_energyiq_saved_analyses_series
      ON energyiq_saved_analyses(series_id, sequence DESC);
  `);
  ensureColumn(db, "energyiq_saved_analyses", "snapshot_json", "TEXT");
  ensureColumn(db, "energyiq_saved_analyses", "view_state_json", "TEXT");
  ensureColumn(db, "energyiq_saved_analyses", "ai_result_json", "TEXT");
};

export class EnergyIqSavedAnalysisStore {
  constructor(private readonly db: DatabaseSync) {}

  create(input: {
    id: string;
    series_id: string;
    project_id: string;
    workspace_id: string;
    scope_id: string;
    scope_name: string;
    resource: "electricity";
    title: string;
    query_json: string;
    analysis_json: string;
    snapshot_json?: string;
    view_state_json?: string;
    ai_result_json?: string;
    template_revision_id: string;
    data_snapshot_id: string;
    rerun_of_id?: string;
    created_by: string;
    created_at?: string;
  }): EnergyIqSavedAnalysisRecord {
    const createdAt = input.created_at ?? new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const sequenceRow = this.db.prepare(`
        SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
        FROM energyiq_saved_analyses
        WHERE series_id = ?
      `).get(input.series_id);
      const sequence = numberField(sequenceRow, "next_sequence");
      this.db.prepare(`
        INSERT INTO energyiq_saved_analyses (
          id, series_id, sequence, project_id, workspace_id, scope_id,
          scope_name, resource, title, query_json, analysis_json,
          snapshot_json, view_state_json, ai_result_json, template_revision_id,
          data_snapshot_id, rerun_of_id, created_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.id,
        input.series_id,
        sequence,
        input.project_id,
        input.workspace_id,
        input.scope_id,
        input.scope_name,
        input.resource,
        input.title,
        input.query_json,
        input.analysis_json,
        input.snapshot_json ?? null,
        input.view_state_json ?? null,
        input.ai_result_json ?? null,
        input.template_revision_id,
        input.data_snapshot_id,
        input.rerun_of_id ?? null,
        input.created_by,
        createdAt,
      );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.get(input.id);
  }

  get(id: string): EnergyIqSavedAnalysisRecord {
    const row = this.db.prepare("SELECT * FROM energyiq_saved_analyses WHERE id = ?").get(id);
    if (!isRecord(row)) throw new Error(`ENERGYIQ_SAVED_ANALYSIS_NOT_FOUND:${id}`);
    return mapSavedAnalysis(row);
  }

  listProject(projectId: string): EnergyIqSavedAnalysisRecord[] {
    return this.db.prepare(`
      SELECT * FROM energyiq_saved_analyses
      WHERE project_id = ?
      ORDER BY created_at DESC, sequence DESC
    `).all(projectId).map(mapSavedAnalysis);
  }

  attachAiResult(input: { id: string; ai_result_json: string }): EnergyIqSavedAnalysisRecord {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.get(input.id);
      if (current.ai_result_json) {
        if (current.ai_result_json !== input.ai_result_json) {
          throw new Error("ENERGYIQ_SAVED_ANALYSIS_AI_RESULT_IMMUTABLE");
        }
        this.db.exec("COMMIT");
        return current;
      }
      this.db.prepare(`
        UPDATE energyiq_saved_analyses
        SET ai_result_json = ?
        WHERE id = ? AND ai_result_json IS NULL
      `).run(input.ai_result_json, input.id);
      const updated = this.get(input.id);
      this.db.exec("COMMIT");
      return updated;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

const mapSavedAnalysis = (value: unknown): EnergyIqSavedAnalysisRecord => {
  if (!isRecord(value)) throw new Error("ENERGYIQ_SAVED_ANALYSIS_ROW_INVALID");
  const resource = stringField(value, "resource");
  if (resource !== "electricity") throw new Error("ENERGYIQ_SAVED_ANALYSIS_RESOURCE_INVALID");
  const rerunOfId = optionalStringField(value, "rerun_of_id");
  const snapshotJson = optionalStringField(value, "snapshot_json");
  const viewStateJson = optionalStringField(value, "view_state_json");
  const aiResultJson = optionalStringField(value, "ai_result_json");
  return {
    id: stringField(value, "id"),
    series_id: stringField(value, "series_id"),
    sequence: numberField(value, "sequence"),
    project_id: stringField(value, "project_id"),
    workspace_id: stringField(value, "workspace_id"),
    scope_id: stringField(value, "scope_id"),
    scope_name: stringField(value, "scope_name"),
    resource,
    title: stringField(value, "title"),
    query_json: stringField(value, "query_json"),
    analysis_json: stringField(value, "analysis_json"),
    ...(snapshotJson ? { snapshot_json: snapshotJson } : {}),
    ...(viewStateJson ? { view_state_json: viewStateJson } : {}),
    ...(aiResultJson ? { ai_result_json: aiResultJson } : {}),
    template_revision_id: stringField(value, "template_revision_id"),
    data_snapshot_id: stringField(value, "data_snapshot_id"),
    ...(rerunOfId ? { rerun_of_id: rerunOfId } : {}),
    created_by: stringField(value, "created_by"),
    created_at: stringField(value, "created_at"),
  };
};

const ensureColumn = (
  db: DatabaseSync,
  table: string,
  column: string,
  definition: string,
): void => {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((candidate) => isRecord(candidate) && candidate.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringField = (value: unknown, key: string): string => {
  if (!isRecord(value) || typeof value[key] !== "string") {
    throw new Error(`ENERGYIQ_SAVED_ANALYSIS_FIELD_INVALID:${key}`);
  }
  return value[key];
};

const optionalStringField = (value: unknown, key: string): string | undefined => {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === "string" && field ? field : undefined;
};

const numberField = (value: unknown, key: string): number => {
  if (!isRecord(value) || typeof value[key] !== "number") {
    throw new Error(`ENERGYIQ_SAVED_ANALYSIS_FIELD_INVALID:${key}`);
  }
  return value[key];
};
