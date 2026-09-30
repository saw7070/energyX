import type {
  EnergyIqOverviewDefinition,
  ReportTimePolicyRevision,
} from "@datafoundry/contracts";
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import {
  compileEnergyIqOverviewDefinition,
  type EnergyIqOverviewDefinitionDiffItem,
} from "./energyiq-overview-definition.js";
import {
  EnergyIqTemplateStore,
  type EnergyIqTemplateRevisionRecord,
} from "./energyiq-template-store.js";

export type EnergyIqOverviewDefinitionRevisionRecord = {
  template_revision_id: string;
  renderer_key: "ngee-ann-overview" | "preschool-overview" | "tuya-office-overview" | "energy-template-overview";
  definition: EnergyIqOverviewDefinition;
  definition_fingerprint: string;
  time_policy_revision_id: string;
};

export type PublishEnergyIqOverviewDefinitionInput = {
  project_id: string;
  expected_base_revision_id: string;
  definition: unknown;
  report_time_policy: ReportTimePolicyRevision;
  renderer_key: EnergyIqOverviewDefinitionRevisionRecord["renderer_key"];
  published_by: string;
  published_at: string;
};

export const initializeEnergyIqOverviewDefinitionSchema = (db: DatabaseSync): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS energyiq_overview_definition_revisions (
      template_revision_id TEXT PRIMARY KEY,
      definition_json TEXT NOT NULL,
      definition_fingerprint TEXT NOT NULL,
      time_policy_revision_id TEXT NOT NULL,
      renderer_key TEXT NOT NULL,
      FOREIGN KEY (template_revision_id) REFERENCES energyiq_template_revisions(revision_id) ON DELETE CASCADE
    );
  `);
};

export const ensureEnergyIqOverviewDefinitionRendererSchema = (db: DatabaseSync): void => {
  const columns = db.prepare("PRAGMA table_info(energyiq_overview_definition_revisions)")
    .all()
    .filter(isRecord)
    .map((row) => row.name);
  if (!columns.includes("renderer_key")) {
    db.exec("ALTER TABLE energyiq_overview_definition_revisions ADD COLUMN renderer_key TEXT");
  }
  db.exec(`
    UPDATE energyiq_overview_definition_revisions
    SET renderer_key = CASE (
      SELECT project_id
      FROM energyiq_template_revisions
      WHERE revision_id = energyiq_overview_definition_revisions.template_revision_id
    )
      WHEN 'ngee-ann-polytechnic' THEN 'ngee-ann-overview'
      WHEN 'preschool-demo' THEN 'preschool-overview'
      ELSE renderer_key
    END
    WHERE renderer_key IS NULL OR renderer_key = '';
  `);
};

export class EnergyIqOverviewDefinitionStore {
  private readonly templates: EnergyIqTemplateStore;

  constructor(private readonly db: DatabaseSync) {
    this.templates = new EnergyIqTemplateStore(db);
  }

  get(templateRevisionId: string): EnergyIqOverviewDefinitionRevisionRecord | null {
    const row = this.db.prepare(`
      SELECT template_revision_id, definition_json, definition_fingerprint, time_policy_revision_id, renderer_key
      FROM energyiq_overview_definition_revisions
      WHERE template_revision_id = ?
    `).get(templateRevisionId);
    return isRecord(row) ? mapRecord(row) : null;
  }

  publishFromRevision(input: PublishEnergyIqOverviewDefinitionInput): {
    revision: EnergyIqTemplateRevisionRecord;
    record: EnergyIqOverviewDefinitionRevisionRecord;
    diff: EnergyIqOverviewDefinitionDiffItem[];
  } {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const published = this.publishFromRevisionWithinTransaction(input);
      this.db.exec("COMMIT");
      return published;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  publishFromRevisionWithinTransaction(input: PublishEnergyIqOverviewDefinitionInput): {
    revision: EnergyIqTemplateRevisionRecord;
    record: EnergyIqOverviewDefinitionRevisionRecord;
    diff: EnergyIqOverviewDefinitionDiffItem[];
  } {
    const latest = this.templates.getLatestProjectRevision(input.project_id);
    if (!latest || latest.revision_id !== input.expected_base_revision_id) {
      throw new Error("ENERGYIQ_TEMPLATE_CHANGE_BASE_REVISION_STALE");
    }
    const baseDefinition = this.get(latest.revision_id)?.definition;
    const compiled = compileEnergyIqOverviewDefinition({
      definition: input.definition,
      ...(baseDefinition ? { baseDefinition } : {}),
      catalog: this.templates.listComponentRevisions(),
      reportTimePolicy: input.report_time_policy,
    });
    const projectTemplate = compiled.templateDocument.templates[0]!;
    const document = {
      schema_version: 2 as const,
      templates: [
        projectTemplate,
        ...latest.document.templates.filter((template) => template.target_kind === "tier"),
      ],
    };
    const revision = this.templates.publishDocumentFromRevisionWithinTransaction({
      project_id: input.project_id,
      expected_base_revision_id: input.expected_base_revision_id,
      document,
      published_by: input.published_by,
      published_at: input.published_at,
    });
    this.db.prepare(`
      INSERT INTO energyiq_overview_definition_revisions (
        template_revision_id, definition_json, definition_fingerprint, time_policy_revision_id, renderer_key
      ) VALUES (?, ?, ?, ?, ?)
    `).run(
      revision.revision_id,
      JSON.stringify(compiled.definition),
      compiled.definitionFingerprint,
      compiled.definition.timePolicyRevisionId,
      input.renderer_key,
    );
    return {
      revision,
      record: this.require(revision.revision_id),
      diff: compiled.diff,
    };
  }

  attachMigrationRecord(input: {
    project_id: string;
    template_revision_id: string;
    renderer_key: EnergyIqOverviewDefinitionRevisionRecord["renderer_key"];
    definition: unknown;
    report_time_policy: ReportTimePolicyRevision;
  }): EnergyIqOverviewDefinitionRevisionRecord {
    const revision = this.templates.getProjectRevision(input.template_revision_id);
    if (!revision || revision.project_id !== input.project_id) {
      throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_REVISION_INVALID");
    }
    const existing = this.get(input.template_revision_id);
    if (existing) return existing;
    const compiled = compileEnergyIqOverviewDefinition({
      definition: input.definition,
      catalog: this.templates.listComponentRevisions(),
      reportTimePolicy: input.report_time_policy,
    });
    this.db.prepare(`
      INSERT INTO energyiq_overview_definition_revisions (
        template_revision_id, definition_json, definition_fingerprint, time_policy_revision_id, renderer_key
      ) VALUES (?, ?, ?, ?, ?)
    `).run(
      input.template_revision_id,
      JSON.stringify(compiled.definition),
      compiled.definitionFingerprint,
      compiled.definition.timePolicyRevisionId,
      input.renderer_key,
    );
    return this.require(input.template_revision_id);
  }

  private require(templateRevisionId: string): EnergyIqOverviewDefinitionRevisionRecord {
    const record = this.get(templateRevisionId);
    if (!record) throw new Error(`ENERGYIQ_OVERVIEW_DEFINITION_NOT_FOUND:${templateRevisionId}`);
    return record;
  }
}

const mapRecord = (row: Record<string, unknown>): EnergyIqOverviewDefinitionRevisionRecord => {
  const definitionJson = requiredString(row.definition_json);
  const definition = JSON.parse(definitionJson) as EnergyIqOverviewDefinition;
  const fingerprint = requiredString(row.definition_fingerprint);
  const actualFingerprint = createHash("sha256").update(JSON.stringify(definition)).digest("hex");
  if (actualFingerprint !== fingerprint) throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_FINGERPRINT_INVALID");
  return {
    template_revision_id: requiredString(row.template_revision_id),
    renderer_key: requireRendererKey(row.renderer_key),
    definition,
    definition_fingerprint: fingerprint,
    time_policy_revision_id: requiredString(row.time_policy_revision_id),
  };
};

const requireRendererKey = (value: unknown): EnergyIqOverviewDefinitionRevisionRecord["renderer_key"] => {
  if (value !== "ngee-ann-overview"
    && value !== "preschool-overview"
    && value !== "tuya-office-overview"
    && value !== "energy-template-overview") {
    throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_RENDERER_INVALID");
  }
  return value;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const requiredString = (value: unknown): string => {
  if (typeof value !== "string" || !value) throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_RECORD_INVALID");
  return value;
};
