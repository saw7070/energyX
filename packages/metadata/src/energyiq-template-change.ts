import {
  EnergyIqTemplateStore,
  validateAndCanonicalizeTemplateDocument,
  type EnergyIqComponentRevisionRecord,
  type EnergyIqTemplateComponentLayout,
  type EnergyIqTemplateComponentPresentation,
  type EnergyIqTemplateDraftDocument,
  type EnergyIqTemplateHeight,
  type EnergyIqTemplateSpan,
  type EnergyIqTemplateVisualPreset,
  type EnergyIqTemplateDensity,
  type EnergyIqTemplateTone,
} from "./energyiq-template-store.js";
import {
  ENERGYIQ_OVERVIEW_DEFINITION_CHANGE_REVISION,
  type EnergyIqOverviewDefinitionChangeProposal,
  type ReportTimePolicyRevision,
} from "@datafoundry/contracts";
import {
  compileEnergyIqOverviewDefinition,
  parseEnergyIqOverviewDefinition,
  type EnergyIqOverviewDefinitionDiffItem,
} from "./energyiq-overview-definition.js";
import {
  EnergyIqOverviewDefinitionStore,
  type EnergyIqOverviewDefinitionRevisionRecord,
} from "./energyiq-overview-definition-store.js";
import { EnergyIqReportTimePolicyStore } from "./energyiq-report-time-policy-store.js";
import type { DatabaseSync } from "node:sqlite";

export type EnergyIqTemplateChangeOperation =
  | {
      op: "add_placement";
      templateId: string;
      componentRevisionId: string;
      placementId?: string;
      sectionId?: string;
      beforePlacementId?: string;
    }
  | {
      op: "remove_placement";
      templateId: string;
      placementId: string;
    }
  | {
      op: "move_placement";
      templateId: string;
      placementId: string;
      beforePlacementId?: string;
    }
  | {
      op: "set_section";
      templateId: string;
      placementId: string;
      sectionId: string;
    }
  | {
      op: "update_layout";
      templateId: string;
      placementId: string;
      layout: EnergyIqTemplateComponentLayout;
    }
  | {
      op: "update_presentation";
      templateId: string;
      placementId: string;
      presentation: Partial<EnergyIqTemplateComponentPresentation>;
    };

export type EnergyIqTemplateChangeProposal = {
  title: string;
  rationale: string;
  operations: EnergyIqTemplateChangeOperation[];
};

export type EnergyIqTemplateChangeProposalValue =
  | EnergyIqTemplateChangeProposal
  | EnergyIqOverviewDefinitionChangeProposal;

export type EnergyIqTemplateChangeDiffItem = {
  kind:
    | "placement_added"
    | "placement_removed"
    | "placement_moved"
    | "section_changed"
    | "layout_updated"
    | "presentation_updated";
  template_id: string;
  placement_id: string;
  summary: string;
};

export type EnergyIqTemplateChangeDiffValue =
  | EnergyIqTemplateChangeDiffItem
  | EnergyIqOverviewDefinitionDiffItem;

export type EnergyIqTemplateChangePreview = {
  base_revision_id: string;
  proposal: EnergyIqTemplateChangeProposalValue;
  document: EnergyIqTemplateDraftDocument;
  diff: EnergyIqTemplateChangeDiffValue[];
};

export type EnergyIqTemplateChangeProposalStatus = "pending_review" | "rejected" | "published";

export type EnergyIqTemplateChangeProposalRecord = EnergyIqTemplateChangePreview & {
  id: string;
  workspace_id: string;
  project_id: string;
  data_snapshot_id: string;
  scope_id: string;
  instruction: string;
  status: EnergyIqTemplateChangeProposalStatus;
  created_by: string;
  created_at: string;
  reviewed_by?: string;
  reviewed_at?: string;
  published_revision_id?: string;
};

export const initializeEnergyIqTemplateChangeSchema = (db: DatabaseSync): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS energyiq_template_change_proposals (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      base_revision_id TEXT NOT NULL,
      data_snapshot_id TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      instruction TEXT NOT NULL,
      proposal_json TEXT NOT NULL,
      proposed_document_json TEXT NOT NULL,
      diff_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending_review', 'rejected', 'published')),
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      reviewed_by TEXT,
      reviewed_at TEXT,
      published_revision_id TEXT,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (project_id) REFERENCES energyiq_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (base_revision_id) REFERENCES energyiq_template_revisions(revision_id),
      FOREIGN KEY (created_by) REFERENCES users(id),
      FOREIGN KEY (reviewed_by) REFERENCES users(id),
      FOREIGN KEY (published_revision_id) REFERENCES energyiq_template_revisions(revision_id)
    );
    CREATE INDEX IF NOT EXISTS idx_energyiq_template_change_project_created
      ON energyiq_template_change_proposals(project_id, created_at DESC);
  `);
};

export class EnergyIqTemplateChangeStore {
  private readonly templates: EnergyIqTemplateStore;
  private readonly overviewDefinitions: EnergyIqOverviewDefinitionStore;
  private readonly reportTimePolicies: EnergyIqReportTimePolicyStore;

  constructor(private readonly db: DatabaseSync) {
    this.templates = new EnergyIqTemplateStore(db);
    this.overviewDefinitions = new EnergyIqOverviewDefinitionStore(db);
    this.reportTimePolicies = new EnergyIqReportTimePolicyStore(db);
  }

  create(input: {
    id: string;
    workspace_id: string;
    project_id: string;
    base_revision_id: string;
    data_snapshot_id: string;
    scope_id: string;
    instruction: string;
    proposal: EnergyIqTemplateChangeProposalValue;
    created_by: string;
    created_at: string;
  }): EnergyIqTemplateChangeProposalRecord {
    const project = this.db.prepare(`
      SELECT workspace_id, data_snapshot_id, root_scope_id
      FROM energyiq_projects WHERE id = ?
    `).get(input.project_id);
    if (!isObjectRecord(project)) throw new Error(`ENERGYIQ_PROJECT_NOT_FOUND:${input.project_id}`);
    if (project.workspace_id !== input.workspace_id) throw new Error("ENERGYIQ_TEMPLATE_CHANGE_WORKSPACE_MISMATCH");
    if (project.data_snapshot_id !== input.data_snapshot_id) throw new Error("ENERGYIQ_TEMPLATE_CHANGE_SNAPSHOT_STALE");
    if (!this.isProjectScope(input.project_id, input.scope_id, String(project.root_scope_id))) {
      throw new Error("ENERGYIQ_TEMPLATE_CHANGE_SCOPE_INVALID");
    }
    const base = this.templates.getProjectRevision(input.base_revision_id);
    const latest = this.templates.getLatestProjectRevision(input.project_id);
    if (!base || base.project_id !== input.project_id) throw new Error("ENERGYIQ_TEMPLATE_CHANGE_BASE_REVISION_INVALID");
    if (!latest || latest.revision_id !== base.revision_id) throw new Error("ENERGYIQ_TEMPLATE_CHANGE_BASE_REVISION_STALE");
    const preview = isOverviewDefinitionProposal(input.proposal)
      ? this.createDefinitionPreview(base.revision_id, base.document, input.project_id, input.proposal)
      : createEnergyIqTemplateChangePreview({
          base_revision_id: base.revision_id,
          document: base.document,
          catalog: this.templates.listComponentRevisions(),
          tier_definition_ids: tierDefinitionIds(base.document),
          proposal: input.proposal,
        });
    const instruction = requireSafeText(input.instruction, "ENERGYIQ_TEMPLATE_CHANGE_INSTRUCTION_INVALID", 2_000);
    this.db.prepare(`
      INSERT INTO energyiq_template_change_proposals (
        id, workspace_id, project_id, base_revision_id, data_snapshot_id, scope_id,
        instruction, proposal_json, proposed_document_json, diff_json,
        status, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_review', ?, ?)
    `).run(
      input.id,
      input.workspace_id,
      input.project_id,
      input.base_revision_id,
      input.data_snapshot_id,
      input.scope_id,
      instruction,
      JSON.stringify(preview.proposal),
      JSON.stringify(preview.document),
      JSON.stringify(preview.diff),
      input.created_by,
      input.created_at,
    );
    return this.require(input.id);
  }

  get(id: string): EnergyIqTemplateChangeProposalRecord | null {
    const row = this.db.prepare(`SELECT * FROM energyiq_template_change_proposals WHERE id = ?`).get(id);
    return isObjectRecord(row) ? mapProposalRecord(row) : null;
  }

  listProject(projectId: string): EnergyIqTemplateChangeProposalRecord[] {
    return this.db.prepare(`
      SELECT * FROM energyiq_template_change_proposals
      WHERE project_id = ? ORDER BY created_at DESC
    `).all(projectId).filter(isObjectRecord).map(mapProposalRecord);
  }

  reject(input: {
    id: string;
    project_id: string;
    rejected_by: string;
    rejected_at: string;
  }): EnergyIqTemplateChangeProposalRecord {
    const proposal = this.requireForProject(input.id, input.project_id);
    if (proposal.status !== "pending_review") throw new Error("ENERGYIQ_TEMPLATE_CHANGE_STATUS_INVALID");
    this.db.prepare(`
      UPDATE energyiq_template_change_proposals
      SET status = 'rejected', reviewed_by = ?, reviewed_at = ?
      WHERE id = ? AND status = 'pending_review'
    `).run(input.rejected_by, input.rejected_at, input.id);
    return this.require(input.id);
  }

  publish(input: {
    id: string;
    project_id: string;
    published_by: string;
    published_at: string;
  }): { proposal: EnergyIqTemplateChangeProposalRecord; revision: import("./energyiq-template-store.js").EnergyIqTemplateRevisionRecord } {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const proposal = this.requireForProject(input.id, input.project_id);
      if (proposal.status !== "pending_review") throw new Error("ENERGYIQ_TEMPLATE_CHANGE_STATUS_INVALID");
      const revision = isOverviewDefinitionProposal(proposal.proposal)
        ? this.overviewDefinitions.publishFromRevisionWithinTransaction({
            project_id: input.project_id,
            expected_base_revision_id: proposal.base_revision_id,
            definition: proposal.proposal.desiredDefinition,
            report_time_policy: this.requireReportTimePolicy(
              input.project_id,
              proposal.proposal.desiredDefinition.timePolicyRevisionId,
            ),
            renderer_key: this.requireBaseRendererKey(proposal.base_revision_id),
            published_by: input.published_by,
            published_at: input.published_at,
          }).revision
        : this.templates.publishDocumentFromRevisionWithinTransaction({
            project_id: input.project_id,
            expected_base_revision_id: proposal.base_revision_id,
            document: proposal.document,
            published_by: input.published_by,
            published_at: input.published_at,
          });
      this.db.prepare(`
        UPDATE energyiq_template_change_proposals
        SET status = 'published', reviewed_by = ?, reviewed_at = ?, published_revision_id = ?
        WHERE id = ? AND status = 'pending_review'
      `).run(input.published_by, input.published_at, revision.revision_id, input.id);
      this.db.exec("COMMIT");
      return { proposal: this.require(input.id), revision };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private require(id: string): EnergyIqTemplateChangeProposalRecord {
    const record = this.get(id);
    if (!record) throw new Error(`ENERGYIQ_TEMPLATE_CHANGE_NOT_FOUND:${id}`);
    return record;
  }

  private requireForProject(id: string, projectId: string): EnergyIqTemplateChangeProposalRecord {
    const record = this.require(id);
    if (record.project_id !== projectId) throw new Error("ENERGYIQ_TEMPLATE_CHANGE_PROJECT_MISMATCH");
    return record;
  }

  private isProjectScope(projectId: string, scopeId: string, rootScopeId: string): boolean {
    if (scopeId === "project" || scopeId === rootScopeId) return true;
    return Boolean(this.db.prepare(`
      SELECT 1 FROM energyiq_project_nodes WHERE project_id = ? AND id = ?
    `).get(projectId, scopeId));
  }

  private createDefinitionPreview(
    baseRevisionId: string,
    baseDocument: EnergyIqTemplateDraftDocument,
    projectId: string,
    proposal: EnergyIqOverviewDefinitionChangeProposal,
  ): EnergyIqTemplateChangePreview {
    const baseDefinition = this.overviewDefinitions.get(baseRevisionId)?.definition;
    if (!baseDefinition) throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_BASE_REQUIRED");
    const policy = this.requireReportTimePolicy(projectId, proposal.desiredDefinition.timePolicyRevisionId);
    const { aiSlotPresentationMode: _proposedMode, ...proposedDefinition } = proposal.desiredDefinition;
    const governedProposal = {
      ...proposal,
      desiredDefinition: {
        ...proposedDefinition,
        ...(baseDefinition.aiSlotPresentationMode === undefined
          ? {}
          : { aiSlotPresentationMode: baseDefinition.aiSlotPresentationMode }),
      },
    };
    const canonicalProposal = parseEnergyIqOverviewDefinitionChangeProposal(governedProposal, {
      baseDefinition,
      catalog: this.templates.listComponentRevisions(),
      reportTimePolicy: policy,
    });
    const compiled = compileEnergyIqOverviewDefinition({
      definition: canonicalProposal.desiredDefinition,
      baseDefinition,
      catalog: this.templates.listComponentRevisions(),
      reportTimePolicy: policy,
    });
    return {
      base_revision_id: baseRevisionId,
      proposal: canonicalProposal,
      document: {
        schema_version: 2,
        templates: [
          compiled.templateDocument.templates[0]!,
          ...baseDocument.templates.filter((template) => template.target_kind === "tier"),
        ],
      },
      diff: compiled.diff,
    };
  }

  private requireReportTimePolicy(projectId: string, revisionId: string): ReportTimePolicyRevision {
    const record = this.reportTimePolicies.get(projectId, revisionId);
    if (!record) throw new Error("ENERGYIQ_REPORT_TIME_POLICY_REQUIRED");
    return record.policy;
  }

  private requireBaseRendererKey(
    templateRevisionId: string,
  ): EnergyIqOverviewDefinitionRevisionRecord["renderer_key"] {
    const rendererKey = this.overviewDefinitions.get(templateRevisionId)?.renderer_key;
    if (!rendererKey) throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_BASE_REQUIRED");
    return rendererKey;
  }
}

export const parseEnergyIqTemplateChangeProposal = (value: unknown): EnergyIqTemplateChangeProposal => {
  const record = requireRecord(value, "ENERGYIQ_TEMPLATE_CHANGE_PROPOSAL_INVALID");
  requireExactKeys(record, ["title", "rationale", "operations"]);
  const operations = record.operations;
  if (!Array.isArray(operations) || operations.length === 0 || operations.length > 20) {
    throw new Error("ENERGYIQ_TEMPLATE_CHANGE_OPERATIONS_INVALID");
  }
  return {
    title: requireSafeText(record.title, "ENERGYIQ_TEMPLATE_CHANGE_TITLE_INVALID", 120),
    rationale: requireSafeText(record.rationale, "ENERGYIQ_TEMPLATE_CHANGE_RATIONALE_INVALID", 1_000),
    operations: operations.map(parseOperation),
  };
};

export const parseEnergyIqOverviewDefinitionChangeProposal = (
  value: unknown,
  input: {
    baseDefinition: unknown;
    catalog: readonly EnergyIqComponentRevisionRecord[];
    reportTimePolicy: ReportTimePolicyRevision;
  },
): EnergyIqOverviewDefinitionChangeProposal => {
  const record = requireRecord(value, "ENERGYIQ_OVERVIEW_DEFINITION_CHANGE_PROPOSAL_INVALID");
  requireExactKeys(record, ["contractRevision", "title", "rationale", "desiredDefinition"]);
  if (record.contractRevision !== ENERGYIQ_OVERVIEW_DEFINITION_CHANGE_REVISION) {
    throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_CHANGE_CONTRACT_INVALID");
  }
  const compiled = compileEnergyIqOverviewDefinition({
    definition: record.desiredDefinition,
    baseDefinition: input.baseDefinition,
    catalog: input.catalog,
    reportTimePolicy: input.reportTimePolicy,
  });
  return {
    contractRevision: ENERGYIQ_OVERVIEW_DEFINITION_CHANGE_REVISION,
    title: requireSafeText(record.title, "ENERGYIQ_TEMPLATE_CHANGE_TITLE_INVALID", 120),
    rationale: requireSafeText(record.rationale, "ENERGYIQ_TEMPLATE_CHANGE_RATIONALE_INVALID", 1_000),
    desiredDefinition: compiled.definition,
  };
};

export const parseEnergyIqTemplateChangeProposalValue = (value: unknown): EnergyIqTemplateChangeProposalValue => {
  const record = requireRecord(value, "ENERGYIQ_TEMPLATE_CHANGE_PROPOSAL_INVALID");
  if (record.contractRevision !== ENERGYIQ_OVERVIEW_DEFINITION_CHANGE_REVISION) {
    return parseEnergyIqTemplateChangeProposal(value);
  }
  requireExactKeys(record, ["contractRevision", "title", "rationale", "desiredDefinition"]);
  return {
    contractRevision: ENERGYIQ_OVERVIEW_DEFINITION_CHANGE_REVISION,
    title: requireSafeText(record.title, "ENERGYIQ_TEMPLATE_CHANGE_TITLE_INVALID", 120),
    rationale: requireSafeText(record.rationale, "ENERGYIQ_TEMPLATE_CHANGE_RATIONALE_INVALID", 1_000),
    desiredDefinition: parseEnergyIqOverviewDefinition(record.desiredDefinition),
  };
};

export const createEnergyIqTemplateChangePreview = (input: {
  base_revision_id: string;
  document: EnergyIqTemplateDraftDocument;
  catalog: readonly EnergyIqComponentRevisionRecord[];
  tier_definition_ids: readonly string[];
  proposal: EnergyIqTemplateChangeProposal;
}): EnergyIqTemplateChangePreview => {
  const document = cloneDocument(input.document);
  const diff: EnergyIqTemplateChangeDiffItem[] = [];

  for (const operation of input.proposal.operations) {
    const template = document.templates.find((item) => item.template_id === operation.templateId);
    if (!template) throw new Error("ENERGYIQ_TEMPLATE_CHANGE_TEMPLATE_NOT_FOUND");

    if (operation.op === "add_placement") {
      if (template.components.some((item) => item.component_revision_id === operation.componentRevisionId)) {
        throw new Error("ENERGYIQ_TEMPLATE_CHANGE_COMPONENT_ALREADY_PLACED");
      }
      const catalogItem = input.catalog.find((item) => item.revision_id === operation.componentRevisionId);
      if (!catalogItem) throw new Error("ENERGYIQ_TEMPLATE_CHANGE_COMPONENT_NOT_FOUND");
      const placementId = operation.placementId ?? catalogItem.component_id;
      const added = {
        placement_id: placementId,
        component_revision_id: catalogItem.revision_id,
        enabled: true,
        ...(operation.sectionId ? { section_id: operation.sectionId } : {}),
      };
      const insertionIndex = resolveInsertionIndex(template.components, operation.beforePlacementId);
      template.components.splice(insertionIndex, 0, added);
      diff.push({
        kind: "placement_added",
        template_id: template.template_id,
        placement_id: placementId,
        summary: `Add ${catalogItem.display_name}.`,
      });
      continue;
    }

    const placementIndex = template.components.findIndex((item) => item.placement_id === operation.placementId);
    if (placementIndex < 0) throw new Error("ENERGYIQ_TEMPLATE_CHANGE_PLACEMENT_NOT_FOUND");
    const placement = template.components[placementIndex]!;

    if (operation.op === "remove_placement") {
      template.components.splice(placementIndex, 1);
      diff.push({
        kind: "placement_removed",
        template_id: template.template_id,
        placement_id: operation.placementId,
        summary: `Remove ${displayName(input.catalog, placement.component_revision_id)}.`,
      });
      continue;
    }
    if (operation.op === "move_placement") {
      template.components.splice(placementIndex, 1);
      const insertionIndex = resolveInsertionIndex(template.components, operation.beforePlacementId);
      template.components.splice(insertionIndex, 0, placement);
      diff.push({
        kind: "placement_moved",
        template_id: template.template_id,
        placement_id: operation.placementId,
        summary: operation.beforePlacementId
          ? `Move ${displayName(input.catalog, placement.component_revision_id)} before ${operation.beforePlacementId}.`
          : `Move ${displayName(input.catalog, placement.component_revision_id)} to the end.`,
      });
      continue;
    }
    if (operation.op === "set_section") {
      placement.section_id = operation.sectionId;
      diff.push({
        kind: "section_changed",
        template_id: template.template_id,
        placement_id: operation.placementId,
        summary: `Move ${displayName(input.catalog, placement.component_revision_id)} to section ${operation.sectionId}.`,
      });
      continue;
    }
    if (operation.op === "update_layout") {
      placement.layout = { ...operation.layout };
      diff.push({
        kind: "layout_updated",
        template_id: template.template_id,
        placement_id: operation.placementId,
        summary: `Set ${displayName(input.catalog, placement.component_revision_id)} to span ${operation.layout.span} and ${operation.layout.height} height.`,
      });
      continue;
    }
    placement.presentation = {
      ...placement.presentation!,
      ...operation.presentation,
    };
    diff.push({
      kind: "presentation_updated",
      template_id: template.template_id,
      placement_id: operation.placementId,
      summary: `Update the presentation of ${displayName(input.catalog, placement.component_revision_id)}.`,
    });
  }

  return {
    base_revision_id: input.base_revision_id,
    proposal: cloneProposal(input.proposal),
    document: validateAndCanonicalizeTemplateDocument({
      document,
      tier_definition_ids: input.tier_definition_ids,
      catalog: input.catalog,
    }),
    diff,
  };
};

const parseOperation = (value: unknown): EnergyIqTemplateChangeOperation => {
  const record = requireRecord(value, "ENERGYIQ_TEMPLATE_CHANGE_OPERATION_INVALID");
  const op = record.op;
  if (op === "set_interaction") throw new Error("ENERGYIQ_TEMPLATE_CHANGE_INTERACTION_UNSUPPORTED");
  if (op === "add_placement") {
    requireExactKeys(record, ["op", "templateId", "componentRevisionId"], ["placementId", "sectionId", "beforePlacementId"]);
    return {
      op,
      templateId: requireId(record.templateId),
      componentRevisionId: requireId(record.componentRevisionId),
      ...optionalIdFields(record, ["placementId", "sectionId", "beforePlacementId"]),
    };
  }
  if (op === "remove_placement") {
    requireExactKeys(record, ["op", "templateId", "placementId"]);
    return { op, templateId: requireId(record.templateId), placementId: requireId(record.placementId) };
  }
  if (op === "move_placement") {
    requireExactKeys(record, ["op", "templateId", "placementId"], ["beforePlacementId"]);
    return {
      op,
      templateId: requireId(record.templateId),
      placementId: requireId(record.placementId),
      ...optionalIdFields(record, ["beforePlacementId"]),
    };
  }
  if (op === "set_section") {
    requireExactKeys(record, ["op", "templateId", "placementId", "sectionId"]);
    return {
      op,
      templateId: requireId(record.templateId),
      placementId: requireId(record.placementId),
      sectionId: requireId(record.sectionId),
    };
  }
  if (op === "update_layout") {
    requireExactKeys(record, ["op", "templateId", "placementId", "layout"]);
    const layout = requireRecord(record.layout, "ENERGYIQ_TEMPLATE_CHANGE_LAYOUT_INVALID");
    requireExactKeys(layout, ["span", "height"]);
    return {
      op,
      templateId: requireId(record.templateId),
      placementId: requireId(record.placementId),
      layout: {
        span: requireSpan(layout.span),
        height: requireHeight(layout.height),
      },
    };
  }
  if (op === "update_presentation") {
    requireExactKeys(record, ["op", "templateId", "placementId", "presentation"]);
    return {
      op,
      templateId: requireId(record.templateId),
      placementId: requireId(record.placementId),
      presentation: parsePresentationPatch(record.presentation),
    };
  }
  throw new Error("ENERGYIQ_TEMPLATE_CHANGE_OPERATION_UNKNOWN");
};

const parsePresentationPatch = (value: unknown): Partial<EnergyIqTemplateComponentPresentation> => {
  const record = requireRecord(value, "ENERGYIQ_TEMPLATE_CHANGE_PRESENTATION_INVALID");
  const allowed = ["visual_preset", "density", "tone", "show_legend", "limit", "title", "description"];
  requireExactKeys(record, [], allowed);
  if (Object.keys(record).length === 0) throw new Error("ENERGYIQ_TEMPLATE_CHANGE_PRESENTATION_INVALID");
  const result: Partial<EnergyIqTemplateComponentPresentation> = {};
  if ("visual_preset" in record) result.visual_preset = requireVisualPreset(record.visual_preset);
  if ("density" in record) result.density = requireDensity(record.density);
  if ("tone" in record) result.tone = requireTone(record.tone);
  if ("show_legend" in record) {
    if (typeof record.show_legend !== "boolean") throw new Error("ENERGYIQ_TEMPLATE_CHANGE_PRESENTATION_INVALID");
    result.show_legend = record.show_legend;
  }
  if ("limit" in record) {
    if (!Number.isInteger(record.limit)) throw new Error("ENERGYIQ_TEMPLATE_CHANGE_PRESENTATION_INVALID");
    result.limit = record.limit as number;
  }
  if ("title" in record) result.title = requireSafeText(record.title, "ENERGYIQ_TEMPLATE_CHANGE_PRESENTATION_INVALID", 160);
  if ("description" in record) result.description = requireSafeText(record.description, "ENERGYIQ_TEMPLATE_CHANGE_PRESENTATION_INVALID", 500);
  return result;
};

const resolveInsertionIndex = (
  placements: readonly { placement_id?: string }[],
  beforePlacementId: string | undefined,
): number => {
  if (!beforePlacementId) return placements.length;
  const index = placements.findIndex((item) => item.placement_id === beforePlacementId);
  if (index < 0) throw new Error("ENERGYIQ_TEMPLATE_CHANGE_BEFORE_PLACEMENT_NOT_FOUND");
  return index;
};

const displayName = (catalog: readonly EnergyIqComponentRevisionRecord[], revisionId: string): string =>
  catalog.find((item) => item.revision_id === revisionId)?.display_name ?? revisionId;

const requireRecord = (value: unknown, code: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
};

const requireExactKeys = (record: Record<string, unknown>, required: string[], optional: string[] = []): void => {
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !(key in record)) || Object.keys(record).some((key) => !allowed.has(key))) {
    throw new Error("ENERGYIQ_TEMPLATE_CHANGE_SHAPE_INVALID");
  }
};

const requireSafeText = (value: unknown, code: string, maxLength: number): string => {
  if (typeof value !== "string") throw new Error(code);
  const text = value.trim();
  if (!text || text.length > maxLength || /<\/?[a-z][^>]*>/i.test(text)) throw new Error(code);
  return text;
};

const requireId = (value: unknown): string => {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9:._@-]{0,159}$/.test(value)) {
    throw new Error("ENERGYIQ_TEMPLATE_CHANGE_ID_INVALID");
  }
  return value;
};

const optionalIdFields = <T extends string>(record: Record<string, unknown>, keys: readonly T[]): Partial<Record<T, string>> => {
  const output: Partial<Record<T, string>> = {};
  for (const key of keys) if (record[key] !== undefined) output[key] = requireId(record[key]);
  return output;
};

const requireSpan = (value: unknown): EnergyIqTemplateSpan => {
  if (value !== 4 && value !== 6 && value !== 8 && value !== 12) throw new Error("ENERGYIQ_TEMPLATE_CHANGE_LAYOUT_INVALID");
  return value;
};

const requireHeight = (value: unknown): EnergyIqTemplateHeight => {
  if (value !== "compact" && value !== "standard" && value !== "tall") throw new Error("ENERGYIQ_TEMPLATE_CHANGE_LAYOUT_INVALID");
  return value;
};

const requireVisualPreset = (value: unknown): EnergyIqTemplateVisualPreset => {
  if (value !== "auto" && value !== "cards" && value !== "bar" && value !== "area" && value !== "table" && value !== "list") {
    throw new Error("ENERGYIQ_TEMPLATE_CHANGE_PRESENTATION_INVALID");
  }
  return value;
};

const requireDensity = (value: unknown): EnergyIqTemplateDensity => {
  if (value !== "comfortable" && value !== "compact") throw new Error("ENERGYIQ_TEMPLATE_CHANGE_PRESENTATION_INVALID");
  return value;
};

const requireTone = (value: unknown): EnergyIqTemplateTone => {
  if (value !== "default" && value !== "highlight" && value !== "quiet") throw new Error("ENERGYIQ_TEMPLATE_CHANGE_PRESENTATION_INVALID");
  return value;
};

const cloneDocument = (document: EnergyIqTemplateDraftDocument): EnergyIqTemplateDraftDocument =>
  JSON.parse(JSON.stringify(document)) as EnergyIqTemplateDraftDocument;

const cloneProposal = <T extends EnergyIqTemplateChangeProposalValue>(proposal: T): T =>
  JSON.parse(JSON.stringify(proposal)) as T;

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const mapProposalRecord = (row: Record<string, unknown>): EnergyIqTemplateChangeProposalRecord => {
  const proposal = parseJson(row.proposal_json, "ENERGYIQ_TEMPLATE_CHANGE_PROPOSAL_INVALID");
  const document = parseJson(row.proposed_document_json, "ENERGYIQ_TEMPLATE_CHANGE_DOCUMENT_INVALID");
  const diff = parseJson(row.diff_json, "ENERGYIQ_TEMPLATE_CHANGE_DIFF_INVALID");
  if (!isObjectRecord(document) || !Array.isArray(document.templates) || !Array.isArray(diff)) {
    throw new Error("ENERGYIQ_TEMPLATE_CHANGE_RECORD_INVALID");
  }
  const status = requiredRowString(row, "status");
  if (status !== "pending_review" && status !== "rejected" && status !== "published") {
    throw new Error("ENERGYIQ_TEMPLATE_CHANGE_STATUS_INVALID");
  }
  const reviewedBy = optionalRowString(row.reviewed_by);
  const reviewedAt = optionalRowString(row.reviewed_at);
  const publishedRevisionId = optionalRowString(row.published_revision_id);
  return {
    id: requiredRowString(row, "id"),
    workspace_id: requiredRowString(row, "workspace_id"),
    project_id: requiredRowString(row, "project_id"),
    base_revision_id: requiredRowString(row, "base_revision_id"),
    data_snapshot_id: requiredRowString(row, "data_snapshot_id"),
    scope_id: requiredRowString(row, "scope_id"),
    instruction: requiredRowString(row, "instruction"),
    proposal: parseEnergyIqTemplateChangeProposalValue(proposal),
    document: document as EnergyIqTemplateDraftDocument,
    diff: diff as EnergyIqTemplateChangeDiffValue[],
    status,
    created_by: requiredRowString(row, "created_by"),
    created_at: requiredRowString(row, "created_at"),
    ...(reviewedBy ? { reviewed_by: reviewedBy } : {}),
    ...(reviewedAt ? { reviewed_at: reviewedAt } : {}),
    ...(publishedRevisionId ? { published_revision_id: publishedRevisionId } : {}),
  };
};

const parseJson = (value: unknown, code: string): unknown => {
  if (typeof value !== "string") throw new Error(code);
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(code);
  }
};

const requiredRowString = (row: Record<string, unknown>, key: string): string => {
  const value = row[key];
  if (typeof value !== "string" || !value) throw new Error("ENERGYIQ_TEMPLATE_CHANGE_RECORD_INVALID");
  return value;
};

const optionalRowString = (value: unknown): string | undefined =>
  typeof value === "string" && value ? value : undefined;

const isOverviewDefinitionProposal = (
  proposal: EnergyIqTemplateChangeProposalValue,
): proposal is EnergyIqOverviewDefinitionChangeProposal =>
  "contractRevision" in proposal
    && proposal.contractRevision === ENERGYIQ_OVERVIEW_DEFINITION_CHANGE_REVISION;

const tierDefinitionIds = (document: EnergyIqTemplateDraftDocument): string[] => document.templates
  .filter((template) => template.target_kind === "tier")
  .map((template) => template.tier_definition_id)
  .filter((value): value is string => Boolean(value));
