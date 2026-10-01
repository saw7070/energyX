import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";

import { EnergyIqMetricStore } from "./energyiq-metric-store.js";
import { EnergyIqOperationalPolicyStore } from "./energyiq-operational-policy-store.js";
import { EnergyIqOverviewAiArtifactStore } from "./energyiq-overview-ai-artifact-store.js";
import { EnergyIqInsightMethodGovernanceStore } from "./energyiq-insight-method-governance-store.js";
import { EnergyIqAdditionalInsightEvaluationStore } from "./energyiq-additional-insight-evaluation-store.js";
import { EnergyIqRuleStore } from "./energyiq-rule-store.js";
import { EnergyIqSavedAnalysisStore } from "./energyiq-saved-analysis-store.js";
import { EnergyIqScopeMetadataResolver } from "./energyiq-scope-metadata-resolver.js";
import { EnergyIqTemplateStore } from "./energyiq-template-store.js";
import { EnergyIqTemplateChangeStore } from "./energyiq-template-change.js";
import { EnergyIqReportTimePolicyStore } from "./energyiq-report-time-policy-store.js";
import { EnergyIqOverviewDefinitionStore } from "./energyiq-overview-definition-store.js";
import { EnergyIqSourceSyncStore } from "./energyiq-source-sync-store.js";
import { EnergyIqLiveConnectorStore } from "./energyiq-live-connector-store.js";

import {
  EnergyIqProjectSetupStore,
  type EnergyIqDeliveryStage,
  type EnergyIqMetadataStatus,
  type EnergyIqTierDefinitionRecord
} from "./energyiq-project-setup-store.js";

export type EnergyIqRole = "user" | "admin";
export type EnergyIqProjectStatus = "draft" | "published" | "archived";
export type EnergyIqProjectAccessRole = "viewer" | "editor";

export type EnergyIqUserRoleRecord = {
  user_id: string;
  role: EnergyIqRole;
  created_at: string;
  updated_at: string;
};

export type EnergyIqProjectRecord = {
  id: string;
  workspace_id: string;
  name: string;
  status: EnergyIqProjectStatus;
  timezone: string;
  hierarchy_revision_id: string;
  meter_formula_revision_id: string;
  data_snapshot_id: string;
  metric_version: string;
  business_calendar_version: string;
  tariff_schedule_version: string;
  delivery_stage: EnergyIqDeliveryStage;
  root_scope_id: string;
  has_unpublished_changes: boolean;
  created_at: string;
  updated_at: string;
};

export type EnergyIqProjectNodeRecord = {
  id: string;
  project_id: string;
  parent_id?: string;
  name: string;
  node_type: string;
  tier_definition_id?: string;
  hierarchy_revision_id?: string;
  sort_order: number;
  area_sqm?: number;
  occupant_count?: number;
  metadata_json?: string;
  metadata_status: EnergyIqMetadataStatus;
  effective_from?: string;
  effective_to?: string;
  independent_reason?: string;
  created_at: string;
  updated_at: string;
};

export type EnergyIqProjectAccessRecord = {
  project_id: string;
  user_id: string;
  role: EnergyIqProjectAccessRole;
  created_at: string;
  updated_at: string;
};

export type EnergyIqImportBatchRecord = {
  id: string;
  workspace_id: string;
  project_id: string;
  source_kind: "excel" | "tuya";
  source_sha256: string;
  filename: string;
  file_asset_ref_id?: string;
  status: "inspected" | "materialized" | "failed";
  inspection_json: string;
  materialization_json?: string;
  materialized_at?: string;
  created_by: string;
  created_at: string;
};

export type EnergyIqDataSnapshotRecord = {
  id: string;
  workspace_id: string;
  project_id: string;
  manifest_json: string;
  audit_json: string;
  created_at: string;
};

export type EnergyIqProjectDataPublicationRecord = {
  project_id: string;
  workspace_id: string;
  previous_snapshot_id: string;
  candidate_snapshot_id?: string;
  overview_persistent_directory?: string;
  overview_pointer_key?: string;
  previous_overview_projection_key?: string;
  candidate_overview_projection_key?: string;
  started_at: string;
  updated_at: string;
};

export type EnergyIqSnapshotFactScope = {
  workspaceId: string;
  projectId: string;
  dataSnapshotId: string;
  manifestFingerprint: string;
  sourceSha256: string[];
  factWriterContractVersion: string;
};

export type EnergyIqProjectManifestMaterializationPreparation = {
  expected_snapshot_id: string;
  expected_previous_snapshot_id: string;
  manifest: Record<string, unknown>;
  fact_scope: EnergyIqSnapshotFactScope;
};

export type EnergyIqProjectManifestMaterialization = {
  batch_id: string;
  summary: unknown;
};

export type EnergyIqProjectManifestMaterializationCompletion = {
  batches: EnergyIqImportBatchRecord[];
  snapshot: EnergyIqDataSnapshotRecord;
};

export const resolveEnergyIqSnapshotFactScope = (
  snapshot: EnergyIqDataSnapshotRecord,
): EnergyIqSnapshotFactScope => {
  const manifest = parseJsonRecord(snapshot.manifest_json);
  if (manifest.version !== 1 || manifest.projectId !== snapshot.project_id || !Array.isArray(manifest.batches)) {
    throw new Error(`ENERGYIQ_SNAPSHOT_MANIFEST_INVALID:${snapshot.id}`);
  }
  const sourceSha256 = manifest.batches.map((candidate, index) => {
    if (!isRecord(candidate) || typeof candidate.sourceSha256 !== "string" || candidate.sourceSha256.trim().length === 0) {
      throw new Error(`ENERGYIQ_SNAPSHOT_MANIFEST_INVALID:${snapshot.id}:${index}`);
    }
    return candidate.sourceSha256.toLocaleLowerCase();
  }).sort((left, right) => left.localeCompare(right));
  const factWriterContractVersions = new Set(manifest.batches.map((candidate, index) => {
    if (!isRecord(candidate)) {
      throw new Error(`ENERGYIQ_SNAPSHOT_MANIFEST_INVALID:${snapshot.id}:${index}`);
    }
    const materialization = isRecord(candidate.materialization) ? candidate.materialization : undefined;
    const revision = candidate.factWriterContractVersion ?? materialization?.factWriterContractVersion;
    if (typeof revision !== "string" || revision.trim().length === 0) {
      throw new Error(`ENERGYIQ_SNAPSHOT_MANIFEST_INVALID:${snapshot.id}:${index}`);
    }
    return revision;
  }));
  if (factWriterContractVersions.size !== 1) {
    throw new Error(`ENERGYIQ_SNAPSHOT_MANIFEST_INVALID:${snapshot.id}:FACT_WRITER_CONTRACT_MIXED`);
  }
  return createSnapshotFactScope({
    workspaceId: snapshot.workspace_id,
    projectId: snapshot.project_id,
    snapshotId: snapshot.id,
    sourceSha256,
    factWriterContractVersion: [...factWriterContractVersions][0]!,
  });
};

export const initializeEnergyIqProjectDataPublicationSchema = (db: DatabaseSync): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS energyiq_project_data_publications (
      project_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      previous_snapshot_id TEXT NOT NULL,
      candidate_snapshot_id TEXT,
      overview_persistent_directory TEXT,
      overview_pointer_key TEXT,
      previous_overview_projection_key TEXT,
      candidate_overview_projection_key TEXT,
      started_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (project_id) REFERENCES energyiq_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (candidate_snapshot_id) REFERENCES energyiq_data_snapshots(id)
    );
  `);
  const publicationColumns = db.prepare("PRAGMA table_info(energyiq_project_data_publications)").all();
  for (const column of [
    "overview_persistent_directory",
    "overview_pointer_key",
    "previous_overview_projection_key",
    "candidate_overview_projection_key",
  ]) {
    if (!publicationColumns.some((candidate) => isRecord(candidate) && candidate.name === column)) {
      db.exec(`ALTER TABLE energyiq_project_data_publications ADD COLUMN ${column} TEXT`);
    }
  }
};

export const initializeEnergyIqSchema = (db: DatabaseSync): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS energyiq_user_roles (
      user_id TEXT PRIMARY KEY,
      role TEXT NOT NULL CHECK (role IN ('user', 'admin')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS energyiq_projects (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
      timezone TEXT NOT NULL,
      hierarchy_revision_id TEXT NOT NULL,
      meter_formula_revision_id TEXT NOT NULL,
      data_snapshot_id TEXT NOT NULL DEFAULT 'unavailable',
      metric_version TEXT NOT NULL,
      business_calendar_version TEXT NOT NULL,
      tariff_schedule_version TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
    );
    CREATE INDEX IF NOT EXISTS idx_energyiq_projects_workspace
      ON energyiq_projects(workspace_id, status, name);

    CREATE TABLE IF NOT EXISTS energyiq_project_nodes (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      parent_id TEXT,
      name TEXT NOT NULL,
      node_type TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      area_sqm REAL,
      occupant_count INTEGER,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES energyiq_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES energyiq_project_nodes(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_energyiq_project_nodes_parent
      ON energyiq_project_nodes(project_id, parent_id, sort_order, name);

    CREATE TABLE IF NOT EXISTS energyiq_project_access (
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (project_id, user_id),
      FOREIGN KEY (project_id) REFERENCES energyiq_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_energyiq_project_access_user
      ON energyiq_project_access(user_id, project_id);

    CREATE TABLE IF NOT EXISTS energyiq_import_batches (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      source_kind TEXT NOT NULL CHECK (source_kind IN ('excel', 'tuya')),
      source_sha256 TEXT NOT NULL,
      filename TEXT NOT NULL,
      file_asset_ref_id TEXT,
      status TEXT NOT NULL CHECK (status IN ('inspected', 'materialized', 'failed')),
      inspection_json TEXT NOT NULL,
      materialization_json TEXT,
      materialized_at TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (project_id, source_sha256),
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (project_id) REFERENCES energyiq_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (file_asset_ref_id) REFERENCES file_asset_refs(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_energyiq_import_batches_project
      ON energyiq_import_batches(project_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS energyiq_data_snapshots (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      manifest_json TEXT NOT NULL,
      audit_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY (project_id) REFERENCES energyiq_projects(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_energyiq_data_snapshots_project
      ON energyiq_data_snapshots(project_id, created_at DESC);

  `);
  initializeEnergyIqProjectDataPublicationSchema(db);
  const projectColumns = db.prepare("PRAGMA table_info(energyiq_projects)").all();
  if (!projectColumns.some((column) => isRecord(column) && column.name === "data_snapshot_id")) {
    db.exec("ALTER TABLE energyiq_projects ADD COLUMN data_snapshot_id TEXT NOT NULL DEFAULT 'unavailable'");
  }
  const importBatchColumns = db.prepare("PRAGMA table_info(energyiq_import_batches)").all();
  if (!importBatchColumns.some((column) => isRecord(column) && column.name === "materialization_json")) {
    db.exec("ALTER TABLE energyiq_import_batches ADD COLUMN materialization_json TEXT");
  }
  if (!importBatchColumns.some((column) => isRecord(column) && column.name === "materialized_at")) {
    db.exec("ALTER TABLE energyiq_import_batches ADD COLUMN materialized_at TEXT");
  }
};

export class EnergyIqStore {
  readonly metrics: EnergyIqMetricStore;
  readonly operationalPolicy: EnergyIqOperationalPolicyStore;
  readonly overviewAiArtifacts: EnergyIqOverviewAiArtifactStore;
  readonly insightMethodGovernance: EnergyIqInsightMethodGovernanceStore;
  readonly additionalInsightEvaluations: EnergyIqAdditionalInsightEvaluationStore;
  readonly projectSetup: EnergyIqProjectSetupStore;
  readonly rules: EnergyIqRuleStore;
  readonly savedAnalyses: EnergyIqSavedAnalysisStore;
  readonly scopeMetadata: EnergyIqScopeMetadataResolver;
  readonly templates: EnergyIqTemplateStore;
  readonly templateChanges: EnergyIqTemplateChangeStore;
  readonly overviewDefinitions: EnergyIqOverviewDefinitionStore;
  readonly reportTimePolicies: EnergyIqReportTimePolicyStore;
  readonly sourceSync: EnergyIqSourceSyncStore;
  readonly liveConnectors: EnergyIqLiveConnectorStore;

  constructor(private readonly db: DatabaseSync) {
    this.metrics = new EnergyIqMetricStore(db);
    this.operationalPolicy = new EnergyIqOperationalPolicyStore(db);
    this.overviewAiArtifacts = new EnergyIqOverviewAiArtifactStore(db);
    this.insightMethodGovernance = new EnergyIqInsightMethodGovernanceStore(db);
    this.additionalInsightEvaluations = new EnergyIqAdditionalInsightEvaluationStore(db);
    this.projectSetup = new EnergyIqProjectSetupStore(db);
    this.rules = new EnergyIqRuleStore(db);
    this.savedAnalyses = new EnergyIqSavedAnalysisStore(db);
    this.scopeMetadata = new EnergyIqScopeMetadataResolver(db);
    this.templates = new EnergyIqTemplateStore(db);
    this.templateChanges = new EnergyIqTemplateChangeStore(db);
    this.overviewDefinitions = new EnergyIqOverviewDefinitionStore(db);
    this.reportTimePolicies = new EnergyIqReportTimePolicyStore(db);
    this.sourceSync = new EnergyIqSourceSyncStore(db);
    this.liveConnectors = new EnergyIqLiveConnectorStore(db);
  }

  upsertUserRole(input: { user_id: string; role: EnergyIqRole }): EnergyIqUserRoleRecord {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO energyiq_user_roles (user_id, role, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET role = excluded.role, updated_at = excluded.updated_at
    `).run(input.user_id, input.role, now, now);
    return this.getUserRole(input.user_id);
  }

  getUserRole(userId: string): EnergyIqUserRoleRecord {
    const row = this.db.prepare(
      "SELECT * FROM energyiq_user_roles WHERE user_id = ?"
    ).get(userId);
    if (!isRecord(row)) {
      throw new Error(`ENERGYIQ_USER_ROLE_NOT_FOUND:${userId}`);
    }
    return mapUserRole(row);
  }

  findUserRole(userId: string): EnergyIqUserRoleRecord | undefined {
    const row = this.db.prepare(
      "SELECT * FROM energyiq_user_roles WHERE user_id = ?"
    ).get(userId);
    return isRecord(row) ? mapUserRole(row) : undefined;
  }

  upsertProject(input: {
    id: string;
    workspace_id: string;
    name: string;
    status: EnergyIqProjectStatus;
    timezone?: string;
    hierarchy_revision_id?: string;
    meter_formula_revision_id?: string;
    data_snapshot_id?: string;
    metric_version?: string;
    business_calendar_version?: string;
    tariff_schedule_version?: string;
    delivery_stage?: EnergyIqDeliveryStage;
    root_scope_id?: string;
    has_unpublished_changes?: boolean;
  }): EnergyIqProjectRecord {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO energyiq_projects (
        id, workspace_id, name, status, timezone, hierarchy_revision_id,
        meter_formula_revision_id, data_snapshot_id, metric_version, business_calendar_version,
        tariff_schedule_version, delivery_stage, root_scope_id,
        has_unpublished_changes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        workspace_id = excluded.workspace_id,
        name = excluded.name,
        status = excluded.status,
        timezone = excluded.timezone,
        hierarchy_revision_id = excluded.hierarchy_revision_id,
        meter_formula_revision_id = excluded.meter_formula_revision_id,
        data_snapshot_id = excluded.data_snapshot_id,
        metric_version = excluded.metric_version,
        business_calendar_version = excluded.business_calendar_version,
        tariff_schedule_version = excluded.tariff_schedule_version,
        delivery_stage = excluded.delivery_stage,
        root_scope_id = excluded.root_scope_id,
        has_unpublished_changes = excluded.has_unpublished_changes,
        updated_at = excluded.updated_at
    `).run(
      input.id,
      input.workspace_id,
      input.name,
      input.status,
      input.timezone ?? "Asia/Singapore",
      input.hierarchy_revision_id ?? "hierarchy-v1",
      input.meter_formula_revision_id ?? "meter-formula-v1",
      input.data_snapshot_id ?? "unavailable",
      input.metric_version ?? "energy-metrics-v1",
      input.business_calendar_version ?? "sg-calendar-v1",
      input.tariff_schedule_version ?? "sg-tariff-v1",
      input.delivery_stage ?? (input.status === "published" ? "published" : "draft"),
      input.root_scope_id ?? `${input.id}-project`,
      input.has_unpublished_changes ? 1 : 0,
      now,
      now
    );
    return this.getProject(input.id);
  }

  getProject(projectId: string): EnergyIqProjectRecord {
    const row = this.db.prepare("SELECT * FROM energyiq_projects WHERE id = ?").get(projectId);
    if (!isRecord(row)) {
      throw new Error(`ENERGYIQ_PROJECT_NOT_FOUND:${projectId}`);
    }
    return mapProject(row);
  }

  listProjectsByWorkspace(workspaceId: string): EnergyIqProjectRecord[] {
    return this.db.prepare(`
      SELECT * FROM energyiq_projects
      WHERE workspace_id = ?
      ORDER BY CASE status WHEN 'published' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, name
    `).all(workspaceId).filter(isRecord).map(mapProject);
  }

  listProjectsForUser(input: {
    user_id: string;
    workspace_id?: string;
    include_unpublished?: boolean;
  }): EnergyIqProjectRecord[] {
    const conditions = ["a.user_id = ?"];
    const parameters: Array<string | number | null> = [input.user_id];
    if (input.workspace_id) {
      conditions.push("p.workspace_id = ?");
      parameters.push(input.workspace_id);
    }
    if (!input.include_unpublished) {
      conditions.push("p.status = 'published'");
    }
    return this.db.prepare(`
      SELECT p.* FROM energyiq_projects p
      INNER JOIN energyiq_project_access a ON a.project_id = p.id
      WHERE ${conditions.join(" AND ")}
      ORDER BY p.name
    `).all(...parameters).filter(isRecord).map(mapProject);
  }

  listVisibleProjects(input: {
    user_id: string;
    workspace_id: string;
    is_admin: boolean;
    include_archived?: boolean;
  }): EnergyIqProjectRecord[] {
    if (!input.is_admin) {
      const membership = this.db.prepare(`
        SELECT 1 FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?
      `).get(input.workspace_id, input.user_id);
      if (!membership) return [];
    }
    const statuses = input.is_admin
      ? (input.include_archived ? ["published", "draft", "archived"] : ["published", "draft"])
      : ["published"];
    const placeholders = statuses.map(() => "?").join(", ");
    return this.db.prepare(`
      SELECT * FROM energyiq_projects
      WHERE workspace_id = ? AND status IN (${placeholders})
      ORDER BY CASE status WHEN 'published' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END, name
    `).all(input.workspace_id, ...statuses).filter(isRecord).map(mapProject);
  }

  upsertProjectNode(input: {
    id: string;
    project_id: string;
    parent_id?: string;
    name: string;
    node_type: string;
    sort_order?: number;
    area_sqm?: number;
    occupant_count?: number;
    metadata?: unknown;
    tier_definition_id?: string;
    hierarchy_revision_id?: string;
    metadata_status?: EnergyIqMetadataStatus;
    effective_from?: string;
    effective_to?: string;
    independent_reason?: string;
  }): EnergyIqProjectNodeRecord {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO energyiq_project_nodes (
        id, project_id, parent_id, name, node_type, sort_order, area_sqm,
        occupant_count, metadata_json, tier_definition_id, hierarchy_revision_id,
        metadata_status, effective_from, effective_to, independent_reason,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        project_id = excluded.project_id,
        parent_id = excluded.parent_id,
        name = excluded.name,
        node_type = excluded.node_type,
        sort_order = excluded.sort_order,
        area_sqm = excluded.area_sqm,
        occupant_count = excluded.occupant_count,
        metadata_json = excluded.metadata_json,
        tier_definition_id = excluded.tier_definition_id,
        hierarchy_revision_id = excluded.hierarchy_revision_id,
        metadata_status = excluded.metadata_status,
        effective_from = excluded.effective_from,
        effective_to = excluded.effective_to,
        independent_reason = excluded.independent_reason,
        updated_at = excluded.updated_at
    `).run(
      input.id,
      input.project_id,
      input.parent_id ?? null,
      input.name,
      input.node_type,
      input.sort_order ?? 0,
      input.area_sqm ?? null,
      input.occupant_count ?? null,
      input.metadata === undefined ? null : JSON.stringify(input.metadata),
      input.tier_definition_id ?? null,
      input.hierarchy_revision_id ?? null,
      input.metadata_status ?? "provisional",
      input.effective_from ?? null,
      input.effective_to ?? null,
      input.independent_reason ?? null,
      now,
      now
    );
    return this.getProjectNode(input.id);
  }

  getProjectNode(nodeId: string): EnergyIqProjectNodeRecord {
    const row = this.db.prepare("SELECT * FROM energyiq_project_nodes WHERE id = ?").get(nodeId);
    if (!isRecord(row)) {
      throw new Error(`ENERGYIQ_PROJECT_NODE_NOT_FOUND:${nodeId}`);
    }
    return mapProjectNode(row);
  }

  listProjectNodes(projectId: string): EnergyIqProjectNodeRecord[] {
    return this.db.prepare(`
      SELECT * FROM energyiq_project_nodes
      WHERE project_id = ?
      ORDER BY sort_order, name
    `).all(projectId).filter(isRecord).map(mapProjectNode);
  }

  listTierDefinitions(projectId: string): EnergyIqTierDefinitionRecord[] {
    return this.projectSetup.listTierDefinitions(projectId);
  }

  upsertProjectAccess(input: {
    project_id: string;
    user_id: string;
    role: EnergyIqProjectAccessRole;
  }): EnergyIqProjectAccessRecord {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO energyiq_project_access (project_id, user_id, role, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(project_id, user_id) DO UPDATE SET
        role = excluded.role,
        updated_at = excluded.updated_at
    `).run(input.project_id, input.user_id, input.role, now, now);
    return this.getProjectAccess(input);
  }

  getProjectAccess(input: {
    project_id: string;
    user_id: string;
  }): EnergyIqProjectAccessRecord {
    const row = this.db.prepare(`
      SELECT * FROM energyiq_project_access WHERE project_id = ? AND user_id = ?
    `).get(input.project_id, input.user_id);
    if (!isRecord(row)) {
      throw new Error(`ENERGYIQ_PROJECT_ACCESS_NOT_FOUND:${input.project_id}:${input.user_id}`);
    }
    return mapProjectAccess(row);
  }

  findProjectAccess(input: {
    project_id: string;
    user_id: string;
  }): EnergyIqProjectAccessRecord | undefined {
    const row = this.db.prepare(`
      SELECT * FROM energyiq_project_access WHERE project_id = ? AND user_id = ?
    `).get(input.project_id, input.user_id);
    return isRecord(row) ? mapProjectAccess(row) : undefined;
  }

  createImportBatch(input: {
    id: string;
    workspace_id: string;
    project_id: string;
    source_kind: "excel" | "tuya";
    source_sha256: string;
    filename: string;
    file_asset_ref_id?: string;
    status: "inspected" | "materialized" | "failed";
    inspection: unknown;
    created_by: string;
  }): EnergyIqImportBatchRecord {
    const createdAt = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO energyiq_import_batches (
        id, workspace_id, project_id, source_kind, source_sha256, filename,
        file_asset_ref_id, status, inspection_json, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.id,
      input.workspace_id,
      input.project_id,
      input.source_kind,
      input.source_sha256,
      input.filename,
      input.file_asset_ref_id ?? null,
      input.status,
      JSON.stringify(input.inspection),
      input.created_by,
      createdAt,
    );
    return this.getImportBatch(input.id);
  }

  getImportBatch(batchId: string): EnergyIqImportBatchRecord {
    const row = this.db.prepare(
      "SELECT * FROM energyiq_import_batches WHERE id = ?",
    ).get(batchId);
    if (!isRecord(row)) throw new Error(`ENERGYIQ_IMPORT_BATCH_NOT_FOUND:${batchId}`);
    return mapImportBatch(row);
  }

  findImportBatchBySha(input: {
    project_id: string;
    source_sha256: string;
  }): EnergyIqImportBatchRecord | undefined {
    const row = this.db.prepare(`
      SELECT * FROM energyiq_import_batches
      WHERE project_id = ? AND source_sha256 = ?
    `).get(input.project_id, input.source_sha256);
    return isRecord(row) ? mapImportBatch(row) : undefined;
  }

  listImportBatches(projectId: string): EnergyIqImportBatchRecord[] {
    return this.db.prepare(`
      SELECT * FROM energyiq_import_batches
      WHERE project_id = ?
      ORDER BY created_at DESC
    `).all(projectId).filter(isRecord).map(mapImportBatch);
  }

  prepareProjectManifestMaterialization(input: {
    project_id: string;
    materializations: readonly EnergyIqProjectManifestMaterialization[];
    source_manifest_sha256: readonly string[];
  }): EnergyIqProjectManifestMaterializationPreparation {
    const project = this.getProject(input.project_id);
    const prepared = prepareProjectManifestCandidate({
      project,
      batches: this.listImportBatches(input.project_id),
      materializations: input.materializations,
      sourceManifestSha256: input.source_manifest_sha256,
    });
    return {
      expected_snapshot_id: prepared.candidate.snapshotId,
      expected_previous_snapshot_id: project.data_snapshot_id,
      manifest: prepared.candidate.manifest,
      fact_scope: prepared.candidate.factScope,
    };
  }

  completeProjectManifestMaterialization(input: {
    project_id: string;
    materializations: readonly EnergyIqProjectManifestMaterialization[];
    project_audit: unknown;
    source_manifest_sha256: readonly string[];
    expected_snapshot_id: string;
    expected_previous_snapshot_id: string;
  }): EnergyIqProjectManifestMaterializationCompletion {
    const materializedAt = new Date().toISOString();
    const projectAudit = requireJsonRecord(input.project_audit, "ENERGYIQ_PROJECT_AUDIT_INVALID");
    requireExpectedSnapshotIdentity(input.expected_snapshot_id, input.expected_previous_snapshot_id);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const project = this.getProject(input.project_id);
      if (project.data_snapshot_id !== input.expected_previous_snapshot_id
        && project.data_snapshot_id !== input.expected_snapshot_id) {
        throw new Error(`ENERGYIQ_SNAPSHOT_STALE:${project.data_snapshot_id}`);
      }
      const prepared = prepareProjectManifestCandidate({
        project,
        batches: this.listImportBatches(input.project_id),
        materializations: input.materializations,
        sourceManifestSha256: input.source_manifest_sha256,
      });
      if (prepared.candidate.snapshotId !== input.expected_snapshot_id) {
        throw new Error(
          `ENERGYIQ_DATA_SNAPSHOT_IDENTITY_MISMATCH:${input.expected_snapshot_id}:${prepared.candidate.snapshotId}`,
        );
      }

      for (const batch of prepared.batches) {
        const result = this.db.prepare(`
          UPDATE energyiq_import_batches
          SET status = 'materialized', materialization_json = ?, materialized_at = ?
          WHERE id = ? AND project_id = ?
        `).run(requireMaterializationJson(batch), materializedAt, batch.id, input.project_id);
        if (result.changes !== 1) {
          throw new Error(`ENERGYIQ_IMPORT_BATCH_NOT_FOUND:${batch.id}`);
        }
      }

      const manifestJson = JSON.stringify(prepared.candidate.manifest);
      const auditJson = JSON.stringify(projectAudit);
      const insertResult = this.db.prepare(`
        INSERT OR IGNORE INTO energyiq_data_snapshots (
          id, workspace_id, project_id, manifest_json, audit_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        prepared.candidate.snapshotId,
        project.workspace_id,
        input.project_id,
        manifestJson,
        auditJson,
        materializedAt,
      );
      if (insertResult.changes === 0) {
        const existing = this.getDataSnapshot(prepared.candidate.snapshotId);
        if (existing.manifest_json !== manifestJson || existing.audit_json !== auditJson) {
          throw new Error(`ENERGYIQ_DATA_SNAPSHOT_IMMUTABLE_CONFLICT:${prepared.candidate.snapshotId}`);
        }
      }
      this.db.prepare(`
        UPDATE energyiq_projects
        SET data_snapshot_id = ?, updated_at = ?
        WHERE id = ?
      `).run(prepared.candidate.snapshotId, materializedAt, input.project_id);
      this.db.exec("COMMIT");
      return {
        batches: prepared.batches.map((batch) => this.getImportBatch(batch.id)),
        snapshot: this.getDataSnapshot(prepared.candidate.snapshotId),
      };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getDataSnapshot(snapshotId: string): EnergyIqDataSnapshotRecord {
    const row = this.db.prepare(
      "SELECT * FROM energyiq_data_snapshots WHERE id = ?",
    ).get(snapshotId);
    if (!isRecord(row)) throw new Error(`ENERGYIQ_DATA_SNAPSHOT_NOT_FOUND:${snapshotId}`);
    return mapDataSnapshot(row);
  }

  findCurrentDataSnapshot(projectId: string): EnergyIqDataSnapshotRecord | undefined {
    const row = this.db.prepare(`
      SELECT snapshot.*
      FROM energyiq_projects project
      JOIN energyiq_data_snapshots snapshot ON snapshot.id = project.data_snapshot_id
      WHERE project.id = ? AND snapshot.project_id = project.id
    `).get(projectId);
    return isRecord(row) ? mapDataSnapshot(row) : undefined;
  }

  beginProjectDataPublication(input: {
    project_id: string;
    expected_previous_snapshot_id: string;
  }): EnergyIqProjectDataPublicationRecord {
    const project = this.getProject(input.project_id);
    if (project.data_snapshot_id !== input.expected_previous_snapshot_id) {
      throw new Error(`ENERGYIQ_SNAPSHOT_STALE:${project.data_snapshot_id}`);
    }
    const now = new Date().toISOString();
    try {
      this.db.prepare(`
        INSERT INTO energyiq_project_data_publications (
          project_id, workspace_id, previous_snapshot_id, candidate_snapshot_id,
          overview_persistent_directory, overview_pointer_key,
          previous_overview_projection_key, candidate_overview_projection_key,
          started_at, updated_at
        ) VALUES (?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?)
      `).run(project.id, project.workspace_id, input.expected_previous_snapshot_id, now, now);
    } catch (error) {
      if (this.findProjectDataPublication(project.id)) {
        throw new Error(`ENERGYIQ_PROJECT_DATA_PUBLICATION_IN_PROGRESS:${project.id}`);
      }
      throw error;
    }
    return this.findProjectDataPublication(project.id)!;
  }

  markProjectDataPublicationCandidate(input: {
    project_id: string;
    expected_previous_snapshot_id: string;
    candidate_snapshot_id: string;
  }): EnergyIqProjectDataPublicationRecord {
    const candidate = this.getDataSnapshot(input.candidate_snapshot_id);
    if (candidate.project_id !== input.project_id) {
      throw new Error(`ENERGYIQ_DATA_SNAPSHOT_PROJECT_MISMATCH:${candidate.id}`);
    }
    const result = this.db.prepare(`
      UPDATE energyiq_project_data_publications
      SET candidate_snapshot_id = ?, updated_at = ?
      WHERE project_id = ? AND previous_snapshot_id = ? AND candidate_snapshot_id IS NULL
    `).run(
      candidate.id,
      new Date().toISOString(),
      input.project_id,
      input.expected_previous_snapshot_id,
    );
    if (result.changes !== 1) {
      const current = this.findProjectDataPublication(input.project_id);
      if (current?.previous_snapshot_id === input.expected_previous_snapshot_id
        && current.candidate_snapshot_id === input.candidate_snapshot_id) return current;
      throw new Error(`ENERGYIQ_PROJECT_DATA_PUBLICATION_STALE:${input.project_id}`);
    }
    return this.findProjectDataPublication(input.project_id)!;
  }

  markProjectOverviewPublicationCandidate(input: {
    project_id: string;
    expected_previous_snapshot_id: string;
    candidate_snapshot_id: string;
    overview_persistent_directory: string;
    overview_pointer_key: string;
    previous_overview_projection_key: string | null;
    candidate_overview_projection_key: string;
  }): EnergyIqProjectDataPublicationRecord {
    const result = this.db.prepare(`
      UPDATE energyiq_project_data_publications
      SET overview_persistent_directory = ?, overview_pointer_key = ?,
          previous_overview_projection_key = ?, candidate_overview_projection_key = ?,
          updated_at = ?
      WHERE project_id = ? AND previous_snapshot_id = ? AND candidate_snapshot_id = ?
        AND overview_persistent_directory IS NULL AND overview_pointer_key IS NULL
        AND previous_overview_projection_key IS NULL AND candidate_overview_projection_key IS NULL
    `).run(
      input.overview_persistent_directory,
      input.overview_pointer_key,
      input.previous_overview_projection_key,
      input.candidate_overview_projection_key,
      new Date().toISOString(),
      input.project_id,
      input.expected_previous_snapshot_id,
      input.candidate_snapshot_id,
    );
    if (result.changes !== 1) {
      const current = this.findProjectDataPublication(input.project_id);
      if (current?.previous_snapshot_id === input.expected_previous_snapshot_id
        && current.candidate_snapshot_id === input.candidate_snapshot_id
        && current.overview_persistent_directory === input.overview_persistent_directory
        && current.overview_pointer_key === input.overview_pointer_key
        && (current.previous_overview_projection_key ?? null) === input.previous_overview_projection_key
        && current.candidate_overview_projection_key === input.candidate_overview_projection_key) return current;
      throw new Error(`ENERGYIQ_PROJECT_DATA_PUBLICATION_STALE:${input.project_id}`);
    }
    return this.findProjectDataPublication(input.project_id)!;
  }

  /** Complete a readings-only publication, with no legacy Overview pointer involved. */
  completeProjectReadingsPublication(input: {project_id: string; expected_previous_snapshot_id: string; candidate_snapshot_id: string}): void {
    const project = this.getProject(input.project_id);
    if (project.data_snapshot_id !== input.candidate_snapshot_id) throw new Error(`ENERGYIQ_SNAPSHOT_STALE:${project.data_snapshot_id}`);
    const result = this.db.prepare(`DELETE FROM energyiq_project_data_publications
      WHERE project_id = ? AND previous_snapshot_id = ? AND candidate_snapshot_id = ?
      AND overview_persistent_directory IS NULL AND overview_pointer_key IS NULL
      AND previous_overview_projection_key IS NULL AND candidate_overview_projection_key IS NULL
    `).run(input.project_id,input.expected_previous_snapshot_id,input.candidate_snapshot_id);
    if (result.changes !== 1) throw new Error(`ENERGYIQ_PROJECT_DATA_PUBLICATION_STALE:${input.project_id}`);
  }

  completeProjectDataPublication(input: {
    project_id: string;
    expected_previous_snapshot_id: string;
    candidate_snapshot_id: string;
    candidate_overview_projection_key: string;
  }): void {
    const project = this.getProject(input.project_id);
    if (project.data_snapshot_id !== input.candidate_snapshot_id) {
      throw new Error(`ENERGYIQ_SNAPSHOT_STALE:${project.data_snapshot_id}`);
    }
    const result = this.db.prepare(`
      DELETE FROM energyiq_project_data_publications
      WHERE project_id = ? AND previous_snapshot_id = ? AND candidate_snapshot_id = ?
        AND candidate_overview_projection_key = ?
    `).run(
      input.project_id,
      input.expected_previous_snapshot_id,
      input.candidate_snapshot_id,
      input.candidate_overview_projection_key,
    );
    if (result.changes !== 1) {
      throw new Error(`ENERGYIQ_PROJECT_DATA_PUBLICATION_STALE:${input.project_id}`);
    }
  }

  findProjectDataPublication(projectId: string): EnergyIqProjectDataPublicationRecord | undefined {
    const row = this.db.prepare(`
      SELECT * FROM energyiq_project_data_publications WHERE project_id = ?
    `).get(projectId);
    return isRecord(row) ? mapProjectDataPublication(row) : undefined;
  }

  abortProjectDataPublication(input: {
    project_id: string;
    expected_current_snapshot_id: string;
    previous_snapshot_id: string;
  }): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const publication = this.findProjectDataPublication(input.project_id);
      if (!publication
        || publication.previous_snapshot_id !== input.previous_snapshot_id
        || (publication.candidate_snapshot_id !== undefined
          && publication.candidate_snapshot_id !== input.expected_current_snapshot_id)) {
        throw new Error(`ENERGYIQ_PROJECT_DATA_PUBLICATION_STALE:${input.project_id}`);
      }
      const project = this.getProject(input.project_id);
      if (project.data_snapshot_id !== input.expected_current_snapshot_id
        && project.data_snapshot_id !== input.previous_snapshot_id) {
        throw new Error(`ENERGYIQ_SNAPSHOT_STALE:${project.data_snapshot_id}`);
      }
      this.db.prepare(`
        UPDATE energyiq_projects SET data_snapshot_id = ?, updated_at = ? WHERE id = ?
      `).run(input.previous_snapshot_id, new Date().toISOString(), input.project_id);
      const deleted = this.db.prepare(`
        DELETE FROM energyiq_project_data_publications WHERE project_id = ?
      `).run(input.project_id);
      if (deleted.changes !== 1) {
        throw new Error(`ENERGYIQ_PROJECT_DATA_PUBLICATION_STALE:${input.project_id}`);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const mapProjectDataPublication = (row: Record<string, unknown>): EnergyIqProjectDataPublicationRecord => {
  const candidateSnapshotId = optionalString(row, "candidate_snapshot_id");
  const overviewPersistentDirectory = optionalString(row, "overview_persistent_directory");
  const overviewPointerKey = optionalString(row, "overview_pointer_key");
  const previousOverviewProjectionKey = optionalString(row, "previous_overview_projection_key");
  const candidateOverviewProjectionKey = optionalString(row, "candidate_overview_projection_key");
  return {
    project_id: requiredString(row, "project_id"),
    workspace_id: requiredString(row, "workspace_id"),
    previous_snapshot_id: requiredString(row, "previous_snapshot_id"),
    ...(candidateSnapshotId ? { candidate_snapshot_id: candidateSnapshotId } : {}),
    ...(overviewPersistentDirectory ? { overview_persistent_directory: overviewPersistentDirectory } : {}),
    ...(overviewPointerKey ? { overview_pointer_key: overviewPointerKey } : {}),
    ...(previousOverviewProjectionKey
      ? { previous_overview_projection_key: previousOverviewProjectionKey }
      : {}),
    ...(candidateOverviewProjectionKey
      ? { candidate_overview_projection_key: candidateOverviewProjectionKey }
      : {}),
    started_at: requiredString(row, "started_at"),
    updated_at: requiredString(row, "updated_at"),
  };
};

const requiredString = (row: Record<string, unknown>, key: string): string => {
  const value = row[key];
  if (typeof value !== "string") {
    throw new Error(`ENERGYIQ_INVALID_ROW:${key}`);
  }
  return value;
};

const optionalString = (row: Record<string, unknown>, key: string): string | undefined =>
  typeof row[key] === "string" ? row[key] : undefined;

const optionalNumber = (row: Record<string, unknown>, key: string): number | undefined =>
  typeof row[key] === "number" ? row[key] : undefined;

const mapUserRole = (row: Record<string, unknown>): EnergyIqUserRoleRecord => ({
  user_id: requiredString(row, "user_id"),
  role: requiredString(row, "role") as EnergyIqRole,
  created_at: requiredString(row, "created_at"),
  updated_at: requiredString(row, "updated_at")
});

const mapProject = (row: Record<string, unknown>): EnergyIqProjectRecord => ({
  id: requiredString(row, "id"),
  workspace_id: requiredString(row, "workspace_id"),
  name: requiredString(row, "name"),
  status: requiredString(row, "status") as EnergyIqProjectStatus,
  timezone: requiredString(row, "timezone"),
  hierarchy_revision_id: requiredString(row, "hierarchy_revision_id"),
  meter_formula_revision_id: requiredString(row, "meter_formula_revision_id"),
  data_snapshot_id: requiredString(row, "data_snapshot_id"),
  metric_version: requiredString(row, "metric_version"),
  business_calendar_version: requiredString(row, "business_calendar_version"),
  tariff_schedule_version: requiredString(row, "tariff_schedule_version"),
  delivery_stage: requiredString(row, "delivery_stage") as EnergyIqDeliveryStage,
  root_scope_id: requiredString(row, "root_scope_id"),
  has_unpublished_changes: Number(row.has_unpublished_changes) === 1,
  created_at: requiredString(row, "created_at"),
  updated_at: requiredString(row, "updated_at")
});

const mapProjectNode = (row: Record<string, unknown>): EnergyIqProjectNodeRecord => {
  const parentId = optionalString(row, "parent_id");
  const areaSqm = optionalNumber(row, "area_sqm");
  const occupantCount = optionalNumber(row, "occupant_count");
  const metadataJson = optionalString(row, "metadata_json");
  const tierDefinitionId = optionalString(row, "tier_definition_id");
  const hierarchyRevisionId = optionalString(row, "hierarchy_revision_id");
  const effectiveFrom = optionalString(row, "effective_from");
  const effectiveTo = optionalString(row, "effective_to");
  const independentReason = optionalString(row, "independent_reason");
  return {
    id: requiredString(row, "id"),
    project_id: requiredString(row, "project_id"),
    ...(parentId ? { parent_id: parentId } : {}),
    name: requiredString(row, "name"),
    node_type: requiredString(row, "node_type"),
    ...(tierDefinitionId ? { tier_definition_id: tierDefinitionId } : {}),
    ...(hierarchyRevisionId ? { hierarchy_revision_id: hierarchyRevisionId } : {}),
    sort_order: Number(row.sort_order),
    ...(areaSqm === undefined ? {} : { area_sqm: areaSqm }),
    ...(occupantCount === undefined ? {} : { occupant_count: occupantCount }),
    ...(metadataJson ? { metadata_json: metadataJson } : {}),
    metadata_status: (optionalString(row, "metadata_status") ?? "provisional") as EnergyIqMetadataStatus,
    ...(effectiveFrom ? { effective_from: effectiveFrom } : {}),
    ...(effectiveTo ? { effective_to: effectiveTo } : {}),
    ...(independentReason ? { independent_reason: independentReason } : {}),
    created_at: requiredString(row, "created_at"),
    updated_at: requiredString(row, "updated_at")
  };
};

const mapProjectAccess = (row: Record<string, unknown>): EnergyIqProjectAccessRecord => ({
  project_id: requiredString(row, "project_id"),
  user_id: requiredString(row, "user_id"),
  role: requiredString(row, "role") as EnergyIqProjectAccessRole,
  created_at: requiredString(row, "created_at"),
  updated_at: requiredString(row, "updated_at")
});

const mapImportBatch = (row: Record<string, unknown>): EnergyIqImportBatchRecord => {
  const fileAssetRefId = optionalString(row, "file_asset_ref_id");
  const materializationJson = optionalString(row, "materialization_json");
  const materializedAt = optionalString(row, "materialized_at");
  return {
    id: requiredString(row, "id"),
    workspace_id: requiredString(row, "workspace_id"),
    project_id: requiredString(row, "project_id"),
    source_kind: requiredString(row, "source_kind") as EnergyIqImportBatchRecord["source_kind"],
    source_sha256: requiredString(row, "source_sha256"),
    filename: requiredString(row, "filename"),
    ...(fileAssetRefId ? { file_asset_ref_id: fileAssetRefId } : {}),
    status: requiredString(row, "status") as EnergyIqImportBatchRecord["status"],
    inspection_json: requiredString(row, "inspection_json"),
    ...(materializationJson ? { materialization_json: materializationJson } : {}),
    ...(materializedAt ? { materialized_at: materializedAt } : {}),
    created_by: requiredString(row, "created_by"),
    created_at: requiredString(row, "created_at"),
  };
};

const mapDataSnapshot = (row: Record<string, unknown>): EnergyIqDataSnapshotRecord => ({
  id: requiredString(row, "id"),
  workspace_id: requiredString(row, "workspace_id"),
  project_id: requiredString(row, "project_id"),
  manifest_json: requiredString(row, "manifest_json"),
  audit_json: requiredString(row, "audit_json"),
  created_at: requiredString(row, "created_at"),
});

const createDataSnapshotIdentity = (
  projectId: string,
  batches: EnergyIqImportBatchRecord[],
) => ({
  version: 1,
  projectId,
  batches: batches.map((batch) => {
    const inspection = parseJsonRecord(batch.inspection_json);
    const materialization = parseJsonRecord(batch.materialization_json);
    return {
      sourceSha256: batch.source_sha256.toLocaleLowerCase(),
      sheetName: optionalJsonString(materialization.sourceSheetName)
        ?? optionalJsonString(inspection.sheetName),
      coverageFrom: optionalJsonString(materialization.sourceCoverageFrom)
        ?? optionalJsonString(inspection.coverageFrom),
      coverageTo: optionalJsonString(materialization.sourceCoverageTo)
        ?? optionalJsonString(inspection.coverageTo),
      mappingFingerprint: optionalJsonString(materialization.mappingFingerprint),
      timezone: optionalJsonString(materialization.timezone),
      materializerContractVersion: optionalJsonString(materialization.materializerContractVersion),
      factWriterContractVersion: optionalJsonString(materialization.factWriterContractVersion),
    };
  }),
});

const createDataSnapshotCandidate = (
  workspaceId: string,
  projectId: string,
  batches: EnergyIqImportBatchRecord[],
): {
  snapshotId: string;
  manifest: Record<string, unknown>;
  factScope: EnergyIqSnapshotFactScope;
} => {
  const identity = createDataSnapshotIdentity(projectId, batches);
  const snapshotId = `energy-snapshot-${createHash("sha256")
    .update(JSON.stringify(identity))
    .digest("hex")
    .slice(0, 24)}`;
  const manifest = {
    version: 1,
    projectId,
    identity,
    batches: batches.map((batch) => ({
      batchId: batch.id,
      sourceSha256: batch.source_sha256,
      filename: batch.filename,
      inspection: parseJsonRecord(batch.inspection_json),
      materialization: snapshotMaterializationSummary(parseJsonRecord(batch.materialization_json)),
    })),
  };
  const sourceSha256 = batches.map((batch) => batch.source_sha256.toLocaleLowerCase());
  const factWriterContractVersions = new Set(batches.map((batch) =>
    optionalJsonString(parseJsonRecord(batch.materialization_json).factWriterContractVersion)));
  if (factWriterContractVersions.has(null)) {
    throw new Error("ENERGYIQ_PROJECT_MANIFEST_FACT_WRITER_CONTRACT_INVALID");
  }
  const factWriterContractVersion = factWriterContractVersions.size === 1
    ? [...factWriterContractVersions][0]!
    : "<mixed>";
  const factScope = createSnapshotFactScope({
    workspaceId,
    projectId,
    snapshotId,
    sourceSha256,
    factWriterContractVersion,
  });
  return {
    snapshotId,
    manifest,
    factScope,
  };
};

const createSnapshotFactScope = (input: {
  workspaceId: string;
  projectId: string;
  snapshotId: string;
  sourceSha256: string[];
  factWriterContractVersion: string;
}): EnergyIqSnapshotFactScope => ({
  workspaceId: input.workspaceId,
  projectId: input.projectId,
  dataSnapshotId: input.snapshotId,
  manifestFingerprint: createHash("sha256")
    .update(JSON.stringify({
      version: 1,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      snapshotId: input.snapshotId,
      sourceSha256: input.sourceSha256,
    }))
    .digest("hex"),
  sourceSha256: input.sourceSha256,
  factWriterContractVersion: input.factWriterContractVersion,
});

const prepareProjectManifestCandidate = (input: {
  project: EnergyIqProjectRecord;
  batches: EnergyIqImportBatchRecord[];
  materializations: readonly EnergyIqProjectManifestMaterialization[];
  sourceManifestSha256: readonly string[];
}): {
  batches: EnergyIqImportBatchRecord[];
  candidate: ReturnType<typeof createDataSnapshotCandidate>;
} => {
  const sourceManifest = normalizedRequiredSourceManifest(input.sourceManifestSha256);
  const projectBatches = input.batches.filter((batch) =>
    sourceManifest.has(batch.source_sha256.trim().toLocaleLowerCase()));
  if (projectBatches.length !== sourceManifest.size) {
    const found = new Set(projectBatches.map((batch) => batch.source_sha256.trim().toLocaleLowerCase()));
    const missing = [...sourceManifest].find((sha) => !found.has(sha));
    throw new Error(`ENERGYIQ_IMPORT_MANIFEST_BATCH_NOT_FOUND:${missing ?? input.project.id}`);
  }

  const batchesById = new Map(projectBatches.map((batch) => [batch.id, batch]));
  const materializationByBatch = new Map<string, Record<string, unknown>>();
  for (const materialization of input.materializations) {
    if (materializationByBatch.has(materialization.batch_id)) {
      throw new Error(`ENERGYIQ_IMPORT_MATERIALIZATION_DUPLICATE:${materialization.batch_id}`);
    }
    if (!batchesById.has(materialization.batch_id)) {
      throw new Error(`ENERGYIQ_IMPORT_BATCH_NOT_PINNED:${materialization.batch_id}`);
    }
    materializationByBatch.set(
      materialization.batch_id,
      requireJsonRecord(materialization.summary, "ENERGYIQ_IMPORT_MATERIALIZATION_SUMMARY_INVALID"),
    );
  }
  if (materializationByBatch.size !== projectBatches.length) {
    const missing = projectBatches.find((batch) => !materializationByBatch.has(batch.id));
    throw new Error(`ENERGYIQ_IMPORT_MATERIALIZATION_INCOMPLETE:${missing?.id ?? input.project.id}`);
  }

  const batches = projectBatches.map((batch) => ({
    ...batch,
    status: "materialized" as const,
    materialization_json: JSON.stringify(materializationByBatch.get(batch.id)),
  })).sort((left, right) => left.source_sha256.localeCompare(right.source_sha256));
  return {
    batches,
    candidate: createDataSnapshotCandidate(input.project.workspace_id, input.project.id, batches),
  };
};

const normalizedRequiredSourceManifest = (sourceManifestSha256: readonly string[]): Set<string> => {
  const normalized = sourceManifestSha256.map((value) => value.trim().toLocaleLowerCase());
  if (normalized.some((value) => value.length === 0) || normalized.length === 0) {
    throw new Error("ENERGYIQ_IMPORT_SOURCE_MANIFEST_INVALID");
  }
  const sourceManifest = new Set(normalized);
  if (sourceManifest.size !== normalized.length) {
    throw new Error("ENERGYIQ_IMPORT_SOURCE_MANIFEST_DUPLICATE");
  }
  return sourceManifest;
};

const requireExpectedSnapshotIdentity = (
  expectedSnapshotId: string,
  expectedPreviousSnapshotId: string,
): void => {
  if (typeof expectedSnapshotId !== "string" || expectedSnapshotId.trim().length === 0
    || typeof expectedPreviousSnapshotId !== "string" || expectedPreviousSnapshotId.trim().length === 0) {
    throw new Error("ENERGYIQ_DATA_SNAPSHOT_EXPECTATION_REQUIRED");
  }
};

const requireMaterializationJson = (batch: EnergyIqImportBatchRecord): string => {
  if (typeof batch.materialization_json !== "string") {
    throw new Error(`ENERGYIQ_IMPORT_MATERIALIZATION_INCOMPLETE:${batch.id}`);
  }
  return batch.materialization_json;
};

const requireJsonRecord = (value: unknown, code: string): Record<string, unknown> => {
  if (!isRecord(value)) throw new Error(code);
  return value;
};

const parseJsonRecord = (value: string | undefined): Record<string, unknown> => {
  if (!value) return {};
  const parsed = JSON.parse(value) as unknown;
  return isRecord(parsed) ? parsed : {};
};

const snapshotMaterializationSummary = (summary: Record<string, unknown>): Record<string, unknown> => {
  const canonical = { ...summary };
  delete canonical.mappingRevision;
  return canonical;
};

const optionalJsonString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;
