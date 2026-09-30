import type { DatabaseSync } from "node:sqlite";

import { markEnergyIqProjectConfigurationChanged } from "./energyiq-project-change-tracker.js";

export type EnergyIqComponentFamily = "decision" | "overview" | "comparison" | "time" | "composition" | "quality" | "evidence";
export type EnergyIqComponentTarget = "project" | "tier" | "both";
export type EnergyIqComponentRequirement = "always" | "rules" | "operating_hours" | "children" | "area_peers" | "people_peers" | "meter_breakdown";
export type EnergyIqTemplateSpan = 4 | 6 | 8 | 12;
export type EnergyIqTemplateHeight = "compact" | "standard" | "tall";
export type EnergyIqTemplateVisualPreset = "auto" | "cards" | "bar" | "area" | "table" | "list";
export type EnergyIqTemplateDensity = "comfortable" | "compact";
export type EnergyIqTemplateTone = "default" | "highlight" | "quiet";

export type EnergyIqComponentAllowedPresentation = {
  layout: {
    spans: EnergyIqTemplateSpan[];
    heights: EnergyIqTemplateHeight[];
  };
  visuals: {
    presets: EnergyIqTemplateVisualPreset[];
    densities: EnergyIqTemplateDensity[];
    tones: EnergyIqTemplateTone[];
    legend: {
      configurable: boolean;
      default: boolean;
    };
    limit: {
      configurable: boolean;
      min: number;
      max: number;
      default: number;
    };
  };
};

export type EnergyIqComponentRevisionRecord = {
  revision_id: string;
  component_id: string;
  version: number;
  display_name: string;
  description: string;
  family: EnergyIqComponentFamily;
  view_key: string;
  target: EnergyIqComponentTarget;
  metric_revision_ids: string[];
  rule_revision_ids: string[];
  query_ids: string[];
  requirement: EnergyIqComponentRequirement;
  allowed_presentation: EnergyIqComponentAllowedPresentation;
  created_at: string;
};

export type EnergyIqTemplateComponentPlacement = {
  placement_id?: string;
  component_revision_id: string;
  enabled: boolean;
  section_id?: string;
  layout?: EnergyIqTemplateComponentLayout;
  presentation?: EnergyIqTemplateComponentPresentation;
};

export type EnergyIqTemplateSection = {
  section_id: string;
  title: string;
  navigation_label: string;
  description?: string;
};

export type EnergyIqTemplateComponentLayout = {
  span: EnergyIqTemplateSpan;
  height: EnergyIqTemplateHeight;
};

export type EnergyIqTemplateComponentPresentation = {
  visual_preset: EnergyIqTemplateVisualPreset;
  density: EnergyIqTemplateDensity;
  tone: EnergyIqTemplateTone;
  show_legend: boolean;
  limit: number;
  title?: string;
  description?: string;
};

export type EnergyIqTemplateDefinition = {
  template_id: string;
  target_kind: "project" | "tier";
  tier_definition_id?: string;
  sections?: EnergyIqTemplateSection[];
  components: EnergyIqTemplateComponentPlacement[];
};

export type EnergyIqTemplateDraftDocument = {
  schema_version?: 2;
  templates: EnergyIqTemplateDefinition[];
};

export type EnergyIqProjectTemplateDraftRecord = {
  project_id: string;
  revision: number;
  document: EnergyIqTemplateDraftDocument;
  updated_by?: string;
  created_at?: string;
  updated_at?: string;
};

export type EnergyIqTemplateRevisionRecord = {
  revision_id: string;
  project_id: string;
  sequence: number;
  source_template_draft_revision: number;
  document: EnergyIqTemplateDraftDocument;
  hierarchy_revision_id: string;
  meter_mapping_revision_id: string;
  meter_formula_revision_id: string;
  metric_config_revision: number;
  selected_metric_revision_ids: string[];
  rule_config_revision: number;
  selected_rule_revision_ids: string[];
  business_calendar_version: string;
  tariff_schedule_version: string;
  published_by: string;
  published_at: string;
};

const BUILT_IN_COMPONENTS: readonly Omit<EnergyIqComponentRevisionRecord, "created_at" | "allowed_presentation">[] = [
  {
    revision_id: "decision.executive_actions@1",
    component_id: "decision.executive_actions",
    version: 1,
    display_name: "Executive action summary",
    description: "Prioritised deterministic findings, recommended actions and evidence links.",
    family: "decision",
    view_key: "executive_action_summary_v1",
    target: "both",
    metric_revision_ids: [],
    rule_revision_ids: [],
    query_ids: [],
    requirement: "rules",
  },
  {
    revision_id: "decision.recommended_actions@1",
    component_id: "decision.recommended_actions",
    version: 1,
    display_name: "Recommended actions",
    description: "Prioritised next steps linked to the deterministic exception evidence in this analysis.",
    family: "decision",
    view_key: "recommended_actions_v1",
    target: "both",
    metric_revision_ids: [],
    rule_revision_ids: [],
    query_ids: [],
    requirement: "rules",
  },
  {
    revision_id: "overview.consumption@1",
    component_id: "overview.consumption",
    version: 1,
    display_name: "Consumption overview",
    description: "Total usage, daily average and peak demand for the selected scope and period.",
    family: "overview",
    view_key: "consumption_overview_v1",
    target: "both",
    metric_revision_ids: ["energy.total_usage_kwh@1", "energy.average_daily_usage_kwh@1", "energy.peak_demand_kw@1"],
    rule_revision_ids: [],
    query_ids: ["scope_summary_v1"],
    requirement: "always",
  },
  {
    revision_id: "comparison.child_scope_ranking@1",
    component_id: "comparison.child_scope_ranking",
    version: 1,
    display_name: "Child scope comparison",
    description: "Ranks directly comparable child scopes by total usage and share.",
    family: "comparison",
    view_key: "child_scope_ranking_v1",
    target: "both",
    metric_revision_ids: ["energy.total_usage_kwh@1"],
    rule_revision_ids: ["comparison.highest_child_usage@1"],
    query_ids: ["scope_summary_v1"],
    requirement: "children",
  },
  {
    revision_id: "comparison.area_intensity@1",
    component_id: "comparison.area_intensity",
    version: 1,
    display_name: "Area-normalised benchmark",
    description: "Compares sibling scopes using energy use per square metre when metadata is comparable.",
    family: "comparison",
    view_key: "area_intensity_comparison_v1",
    target: "both",
    metric_revision_ids: ["energy.usage_per_sqm@1"],
    rule_revision_ids: ["comparison.area_intensity_outlier@1"],
    query_ids: ["scope_summary_v1"],
    requirement: "area_peers",
  },
  {
    revision_id: "comparison.people_intensity@1",
    component_id: "comparison.people_intensity",
    version: 1,
    display_name: "People-normalised benchmark",
    description: "Compares sibling scopes using energy use per representative person.",
    family: "comparison",
    view_key: "people_intensity_comparison_v1",
    target: "both",
    metric_revision_ids: ["energy.usage_per_person@1"],
    rule_revision_ids: ["comparison.people_intensity_outlier@1"],
    query_ids: ["scope_summary_v1"],
    requirement: "people_peers",
  },
  {
    revision_id: "time.off_hours@1",
    component_id: "time.off_hours",
    version: 1,
    display_name: "Off-hours analysis",
    description: "Shows energy use and share outside the configured operating hours.",
    family: "time",
    view_key: "off_hours_analysis_v1",
    target: "both",
    metric_revision_ids: ["energy.off_hours_usage_kwh@1", "energy.off_hours_share_pct@1"],
    rule_revision_ids: ["time.high_off_hours_share@1"],
    query_ids: ["scope_summary_v1", "meter_breakdown_v1"],
    requirement: "operating_hours",
  },
  {
    revision_id: "time.operating_pattern@1",
    component_id: "time.operating_pattern",
    version: 1,
    display_name: "Operating pattern",
    description: "Hourly demand profile used to identify peak and persistent usage periods.",
    family: "time",
    view_key: "operating_pattern_v1",
    target: "both",
    metric_revision_ids: ["energy.peak_demand_kw@1"],
    rule_revision_ids: [],
    query_ids: ["hourly_profile_v1"],
    requirement: "always",
  },
  {
    revision_id: "composition.meter_breakdown@1",
    component_id: "composition.meter_breakdown",
    version: 1,
    display_name: "Meter and category breakdown",
    description: "Explains the selected scope through its trusted meters and load, light, aircon or other categories.",
    family: "composition",
    view_key: "meter_breakdown_v1",
    target: "tier",
    metric_revision_ids: ["energy.total_usage_kwh@1"],
    rule_revision_ids: [],
    query_ids: ["meter_breakdown_v1"],
    requirement: "meter_breakdown",
  },
  {
    revision_id: "composition.project_meter_breakdown@1",
    component_id: "composition.project_meter_breakdown",
    version: 1,
    display_name: "Project meter and category breakdown",
    description: "Explains either a Project or published child Scope through its trusted meters and load, light, aircon or other categories.",
    family: "composition",
    view_key: "meter_breakdown_v1",
    target: "project",
    metric_revision_ids: ["energy.total_usage_kwh@1"],
    rule_revision_ids: [],
    query_ids: ["meter_breakdown_v1"],
    requirement: "meter_breakdown",
  },
  {
    revision_id: "quality.data_coverage@1",
    component_id: "quality.data_coverage",
    version: 1,
    display_name: "Data quality and coverage",
    description: "Shows valid intervals and quality events so users can judge whether findings are trustworthy.",
    family: "quality",
    view_key: "data_quality_summary_v1",
    target: "both",
    metric_revision_ids: ["data.valid_interval_count@1", "data.quality_event_count@1"],
    rule_revision_ids: ["quality.no_valid_data@1"],
    query_ids: ["scope_summary_v1"],
    requirement: "always",
  },
  {
    revision_id: "evidence.exceptions@1",
    component_id: "evidence.exceptions",
    version: 1,
    display_name: "Exceptions and evidence",
    description: "Presents rule evidence, calculation versions and the path to further investigation.",
    family: "evidence",
    view_key: "exceptions_evidence_v1",
    target: "both",
    metric_revision_ids: [],
    rule_revision_ids: [],
    query_ids: [],
    requirement: "rules",
  },
];

export const initializeEnergyIqTemplateSchema = (db: DatabaseSync): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS energyiq_component_revisions (
      revision_id TEXT PRIMARY KEY,
      component_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      display_name TEXT NOT NULL,
      description TEXT NOT NULL,
      family TEXT NOT NULL,
      view_key TEXT NOT NULL,
      target TEXT NOT NULL CHECK (target IN ('project', 'tier', 'both')),
      metric_revision_ids_json TEXT NOT NULL,
      rule_revision_ids_json TEXT NOT NULL,
      query_ids_json TEXT NOT NULL,
      requirement TEXT NOT NULL,
      allowed_presentation_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      UNIQUE (component_id, version)
    );

    CREATE TABLE IF NOT EXISTS energyiq_project_template_drafts (
      project_id TEXT PRIMARY KEY,
      revision INTEGER NOT NULL,
      document_json TEXT NOT NULL,
      updated_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES energyiq_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (updated_by) REFERENCES users(id)
    );
  `);
  ensureColumn(
    db,
    "energyiq_component_revisions",
    "allowed_presentation_json",
    "TEXT NOT NULL DEFAULT '{}'",
  );

  const insert = db.prepare(`
    INSERT OR IGNORE INTO energyiq_component_revisions (
      revision_id, component_id, version, display_name, description, family,
      view_key, target, metric_revision_ids_json, rule_revision_ids_json,
      query_ids_json, requirement, allowed_presentation_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateAllowedPresentation = db.prepare(`
    UPDATE energyiq_component_revisions
    SET allowed_presentation_json = ?
    WHERE revision_id = ?
  `);
  const createdAt = "2026-08-02T00:00:00.000Z";
  for (const component of BUILT_IN_COMPONENTS) {
    insert.run(
      component.revision_id,
      component.component_id,
      component.version,
      component.display_name,
      component.description,
      component.family,
      component.view_key,
      component.target,
      JSON.stringify(component.metric_revision_ids),
      JSON.stringify(component.rule_revision_ids),
      JSON.stringify(component.query_ids),
      component.requirement,
      JSON.stringify(defaultAllowedPresentation(component.view_key)),
      createdAt,
    );
    updateAllowedPresentation.run(
      JSON.stringify(defaultAllowedPresentation(component.view_key)),
      component.revision_id,
    );
  }
};

export const initializeEnergyIqTemplateRevisionSchema = (db: DatabaseSync): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS energyiq_template_revisions (
      revision_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      source_template_draft_revision INTEGER NOT NULL,
      document_json TEXT NOT NULL,
      hierarchy_revision_id TEXT NOT NULL,
      meter_mapping_revision_id TEXT NOT NULL,
      meter_formula_revision_id TEXT NOT NULL,
      metric_config_revision INTEGER NOT NULL,
      selected_metric_revision_ids_json TEXT NOT NULL,
      rule_config_revision INTEGER NOT NULL,
      selected_rule_revision_ids_json TEXT NOT NULL,
      business_calendar_version TEXT NOT NULL,
      tariff_schedule_version TEXT NOT NULL,
      published_by TEXT NOT NULL,
      published_at TEXT NOT NULL,
      UNIQUE (project_id, sequence),
      FOREIGN KEY (project_id) REFERENCES energyiq_projects(id) ON DELETE CASCADE,
      FOREIGN KEY (hierarchy_revision_id) REFERENCES energyiq_hierarchy_revisions(id),
      FOREIGN KEY (published_by) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_energyiq_template_revisions_project
      ON energyiq_template_revisions(project_id, sequence DESC);
  `);
  ensureColumn(
    db,
    "energyiq_template_revisions",
    "meter_mapping_revision_id",
    "TEXT NOT NULL DEFAULT 'meter-routing-unavailable'",
  );
};

export class EnergyIqTemplateStore {
  constructor(private readonly db: DatabaseSync) {}

  listComponentRevisions(): EnergyIqComponentRevisionRecord[] {
    return this.db.prepare(`
      SELECT * FROM energyiq_component_revisions
      ORDER BY CASE family
        WHEN 'decision' THEN 1 WHEN 'overview' THEN 2 WHEN 'comparison' THEN 3
        WHEN 'time' THEN 4 WHEN 'composition' THEN 5 WHEN 'quality' THEN 6 ELSE 7 END,
        display_name ASC
    `).all().map(mapComponentRevision);
  }

  getProjectDraft(input: {
    project_id: string;
    tier_definition_ids: string[];
  }): EnergyIqProjectTemplateDraftRecord {
    const row = this.db.prepare(`
      SELECT * FROM energyiq_project_template_drafts WHERE project_id = ?
    `).get(input.project_id);
    if (isRecord(row)) {
      const saved = mapProjectTemplateDraft(row);
      return {
        ...saved,
        document: reconcileTemplateDocument(
          saved.document,
          this.listComponentRevisions(),
          input.tier_definition_ids,
        ),
      };
    }
    return {
      project_id: input.project_id,
      revision: 0,
      document: createDefaultTemplateDocument(this.listComponentRevisions(), input.tier_definition_ids),
    };
  }

  saveProjectDraft(input: {
    project_id: string;
    expected_revision: number;
    tier_definition_ids: string[];
    document: EnergyIqTemplateDraftDocument;
    updated_by: string;
  }): EnergyIqProjectTemplateDraftRecord {
    const current = this.getProjectDraft({
      project_id: input.project_id,
      tier_definition_ids: input.tier_definition_ids,
    });
    if (current.revision !== input.expected_revision) {
      throw new Error("ENERGYIQ_TEMPLATE_DRAFT_REVISION_CONFLICT");
    }
    const document = validateAndCanonicalizeTemplateDocument({
      document: input.document,
      tier_definition_ids: input.tier_definition_ids,
      catalog: this.listComponentRevisions(),
    });
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO energyiq_project_template_drafts (
        project_id, revision, document_json, updated_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        revision = excluded.revision,
        document_json = excluded.document_json,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    `).run(
      input.project_id,
      current.revision + 1,
      JSON.stringify(document),
      input.updated_by,
      current.created_at ?? now,
      now,
    );
    markEnergyIqProjectConfigurationChanged(this.db, input.project_id, now);
    return this.getProjectDraft({
      project_id: input.project_id,
      tier_definition_ids: input.tier_definition_ids,
    });
  }

  listProjectRevisions(projectId: string): EnergyIqTemplateRevisionRecord[] {
    return this.db.prepare(`
      SELECT * FROM energyiq_template_revisions
      WHERE project_id = ?
      ORDER BY sequence DESC
    `).all(projectId).map(mapTemplateRevision);
  }

  getLatestProjectRevision(projectId: string): EnergyIqTemplateRevisionRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM energyiq_template_revisions
      WHERE project_id = ?
      ORDER BY sequence DESC
      LIMIT 1
    `).get(projectId);
    return isRecord(row) ? mapTemplateRevision(row) : null;
  }

  getProjectRevision(revisionId: string): EnergyIqTemplateRevisionRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM energyiq_template_revisions WHERE revision_id = ?
    `).get(revisionId);
    return isRecord(row) ? mapTemplateRevision(row) : null;
  }

  /**
   * Publish a server-validated document as a new immutable revision while the
   * caller owns the approval transaction. All non-template release pins are
   * copied from the reviewed base revision.
   */
  publishDocumentFromRevisionWithinTransaction(input: {
    project_id: string;
    expected_base_revision_id: string;
    document: EnergyIqTemplateDraftDocument;
    published_by: string;
    published_at: string;
  }): EnergyIqTemplateRevisionRecord {
    const latest = this.getLatestProjectRevision(input.project_id);
    if (!latest || latest.revision_id !== input.expected_base_revision_id) {
      throw new Error("ENERGYIQ_TEMPLATE_CHANGE_BASE_REVISION_STALE");
    }
    const tierDefinitionIds = latest.document.templates
      .filter((template) => template.target_kind === "tier")
      .map((template) => template.tier_definition_id)
      .filter((value): value is string => Boolean(value));
    const document = validateAndCanonicalizeTemplateDocument({
      document: input.document,
      tier_definition_ids: tierDefinitionIds,
      catalog: this.listComponentRevisions(),
    });
    const sequence = latest.sequence + 1;
    const revisionId = `${input.project_id}-template-v${sequence}`;
    this.db.prepare(`
      INSERT INTO energyiq_template_revisions (
        revision_id, project_id, sequence, source_template_draft_revision,
        document_json, hierarchy_revision_id, meter_mapping_revision_id, meter_formula_revision_id,
        metric_config_revision, selected_metric_revision_ids_json,
        rule_config_revision, selected_rule_revision_ids_json,
        business_calendar_version, tariff_schedule_version, published_by, published_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      revisionId,
      input.project_id,
      sequence,
      latest.source_template_draft_revision,
      JSON.stringify(document),
      latest.hierarchy_revision_id,
      latest.meter_mapping_revision_id,
      latest.meter_formula_revision_id,
      latest.metric_config_revision,
      JSON.stringify(latest.selected_metric_revision_ids),
      latest.rule_config_revision,
      JSON.stringify(latest.selected_rule_revision_ids),
      latest.business_calendar_version,
      latest.tariff_schedule_version,
      input.published_by,
      input.published_at,
    );
    return this.requireProjectRevision(revisionId);
  }

  /**
   * Freeze the latest reviewed analysis configuration while the caller owns
   * the surrounding SQLite transaction that also publishes the hierarchy.
   */
  publishProjectRevisionWithinTransaction(input: {
    project_id: string;
    tier_definition_ids: string[];
    hierarchy_revision_id: string;
    meter_mapping_revision_id: string;
    published_by: string;
    published_at: string;
    expected_template_draft_revision?: number;
    expected_metric_config_revision?: number;
    expected_rule_config_revision?: number;
  }): EnergyIqTemplateRevisionRecord {
    const draft = this.getProjectDraft({
      project_id: input.project_id,
      tier_definition_ids: input.tier_definition_ids,
    });
    const metricConfig = readSelectedRevisionConfig(this.db, {
      projectId: input.project_id,
      configTable: "energyiq_project_metric_configs",
      catalogTable: "energyiq_metric_revisions",
      selectedColumn: "selected_metric_revision_ids_json",
    });
    const ruleConfig = readSelectedRevisionConfig(this.db, {
      projectId: input.project_id,
      configTable: "energyiq_project_rule_configs",
      catalogTable: "energyiq_rule_revisions",
      selectedColumn: "selected_rule_revision_ids_json",
    });
    assertExpectedRevision(draft.revision, input.expected_template_draft_revision, "ENERGYIQ_TEMPLATE_DRAFT_REVISION_CONFLICT");
    assertExpectedRevision(metricConfig.revision, input.expected_metric_config_revision, "ENERGYIQ_METRIC_CONFIG_REVISION_CONFLICT");
    assertExpectedRevision(ruleConfig.revision, input.expected_rule_config_revision, "ENERGYIQ_RULE_CONFIG_REVISION_CONFLICT");

    const project = this.db.prepare(`
      SELECT
        projects.meter_formula_revision_id,
        COALESCE(bindings.business_calendar_version, projects.business_calendar_version)
          AS business_calendar_version,
        COALESCE(bindings.tariff_schedule_version, projects.tariff_schedule_version)
          AS tariff_schedule_version
      FROM energyiq_projects projects
      LEFT JOIN energyiq_operational_policy_bindings bindings
        ON bindings.project_id = projects.id
      WHERE projects.id = ?
    `).get(input.project_id);
    if (!isRecord(project)) throw new Error(`ENERGYIQ_PROJECT_NOT_FOUND:${input.project_id}`);
    const sequenceRow = this.db.prepare(`
      SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
      FROM energyiq_template_revisions WHERE project_id = ?
    `).get(input.project_id);
    if (!isRecord(sequenceRow)) throw new Error("ENERGYIQ_TEMPLATE_REVISION_SEQUENCE_INVALID");
    const sequence = requiredNumber(sequenceRow, "next_sequence");
    const revisionId = `${input.project_id}-template-v${sequence}`;
    this.db.prepare(`
      INSERT INTO energyiq_template_revisions (
        revision_id, project_id, sequence, source_template_draft_revision,
        document_json, hierarchy_revision_id, meter_mapping_revision_id, meter_formula_revision_id,
        metric_config_revision, selected_metric_revision_ids_json,
        rule_config_revision, selected_rule_revision_ids_json,
        business_calendar_version, tariff_schedule_version, published_by, published_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      revisionId,
      input.project_id,
      sequence,
      draft.revision,
      JSON.stringify(draft.document),
      input.hierarchy_revision_id,
      input.meter_mapping_revision_id,
      requiredString(project, "meter_formula_revision_id"),
      metricConfig.revision,
      JSON.stringify(metricConfig.selectedRevisionIds),
      ruleConfig.revision,
      JSON.stringify(ruleConfig.selectedRevisionIds),
      requiredString(project, "business_calendar_version"),
      requiredString(project, "tariff_schedule_version"),
      input.published_by,
      input.published_at,
    );
    return this.requireProjectRevision(revisionId);
  }

  private requireProjectRevision(revisionId: string): EnergyIqTemplateRevisionRecord {
    const row = this.db.prepare(`
      SELECT * FROM energyiq_template_revisions WHERE revision_id = ?
    `).get(revisionId);
    if (!isRecord(row)) throw new Error(`ENERGYIQ_TEMPLATE_REVISION_NOT_FOUND:${revisionId}`);
    return mapTemplateRevision(row);
  }
}

export const createDefaultTemplateDocument = (
  catalog: readonly EnergyIqComponentRevisionRecord[],
  tierDefinitionIds: readonly string[],
): EnergyIqTemplateDraftDocument => ({
  schema_version: 2,
  templates: [
    createDefaultTemplateDefinition("project", "project", undefined, catalog),
    ...tierDefinitionIds.map((tierDefinitionId) => createDefaultTemplateDefinition(
      `tier:${tierDefinitionId}`,
      "tier",
      tierDefinitionId,
      catalog,
    )),
  ],
});

const DEFAULT_TEMPLATE_SECTIONS: readonly EnergyIqTemplateSection[] = [
  { section_id: "action-summary", title: "Action summary", navigation_label: "Actions", description: "Prioritised findings and the first decision to take." },
  { section_id: "data-status", title: "Data status & scope", navigation_label: "Data status", description: "Coverage and quality evidence for the selected scope and period." },
  { section_id: "energy-overview", title: "Energy overview", navigation_label: "Overview", description: "Consumption, demand and cost signals for the selected analysis context." },
  { section_id: "comparison", title: "Scope comparison", navigation_label: "Comparison", description: "Comparable child scopes using absolute and normalised measures." },
  { section_id: "time-pattern", title: "Time pattern", navigation_label: "Time pattern", description: "Operating-hour, off-hour and daily demand behaviour." },
  { section_id: "composition", title: "Meter composition", navigation_label: "Composition", description: "The meters and categories that explain the selected scope." },
  { section_id: "exceptions", title: "Exceptions & evidence", navigation_label: "Exceptions", description: "Deterministic exceptions, supporting evidence and follow-up actions." },
];

const SECTION_BY_FAMILY: Readonly<Record<EnergyIqComponentFamily, string>> = {
  decision: "action-summary",
  overview: "energy-overview",
  comparison: "comparison",
  time: "time-pattern",
  composition: "composition",
  quality: "data-status",
  evidence: "exceptions",
};

const createDefaultTemplateDefinition = (
  templateId: string,
  targetKind: "project" | "tier",
  tierDefinitionId: string | undefined,
  catalog: readonly EnergyIqComponentRevisionRecord[],
): EnergyIqTemplateDefinition => {
  const sectionOrder = new Map(DEFAULT_TEMPLATE_SECTIONS.map((section, index) => [section.section_id, index]));
  const applicable = [...catalog]
    .filter((component) => targetKind === "project"
      ? component.target === "project" || component.target === "both"
      : component.target === "tier" || component.target === "both")
    .sort((left, right) =>
      (sectionOrder.get(SECTION_BY_FAMILY[left.family]) ?? 99)
      - (sectionOrder.get(SECTION_BY_FAMILY[right.family]) ?? 99));
  return {
    template_id: templateId,
    target_kind: targetKind,
    ...(tierDefinitionId ? { tier_definition_id: tierDefinitionId } : {}),
    sections: DEFAULT_TEMPLATE_SECTIONS.map((section) => ({ ...section })),
    components: applicable.map(createDefaultPlacement),
  };
};

const createDefaultPlacement = (
  component: EnergyIqComponentRevisionRecord,
): EnergyIqTemplateComponentPlacement => {
  const defaults = defaultVisuals(component);
  return {
    placement_id: component.component_id,
    component_revision_id: component.revision_id,
    enabled: true,
    section_id: SECTION_BY_FAMILY[component.family],
    layout: defaults.layout,
    presentation: defaults.presentation,
  };
};

const defaultVisuals = (
  component: EnergyIqComponentRevisionRecord,
): { layout: EnergyIqTemplateComponentLayout; presentation: EnergyIqTemplateComponentPresentation } => {
  const allowed = component.allowed_presentation;
  const base: EnergyIqTemplateComponentPresentation = {
    visual_preset: allowed.visuals.presets[0] ?? "auto",
    density: allowed.visuals.densities[0] ?? "comfortable",
    tone: allowed.visuals.tones[0] ?? "default",
    show_legend: allowed.visuals.legend.default,
    limit: allowed.visuals.limit.default,
  };
  switch (component.view_key) {
    case "executive_action_summary_v1":
      return { layout: { span: 12, height: "standard" }, presentation: { ...base, tone: "highlight", limit: 3 } };
    case "recommended_actions_v1":
      return { layout: { span: 12, height: "standard" }, presentation: { ...base, visual_preset: "list", limit: 3 } };
    case "consumption_overview_v1":
      return { layout: { span: 12, height: "compact" }, presentation: { ...base, visual_preset: "cards" } };
    case "child_scope_ranking_v1":
      return { layout: { span: 12, height: "standard" }, presentation: { ...base, visual_preset: "bar" } };
    case "area_intensity_comparison_v1":
    case "people_intensity_comparison_v1":
      return { layout: { span: 6, height: "standard" }, presentation: { ...base, visual_preset: "table" } };
    case "off_hours_analysis_v1":
      return { layout: { span: 4, height: "standard" }, presentation: { ...base, visual_preset: "cards", limit: 6 } };
    case "operating_pattern_v1":
      return { layout: { span: 8, height: "standard" }, presentation: { ...base, visual_preset: "area" } };
    case "meter_breakdown_v1":
      return { layout: { span: 12, height: "standard" }, presentation: { ...base, visual_preset: "table" } };
    case "data_quality_summary_v1":
      return { layout: { span: 12, height: "compact" }, presentation: { ...base, visual_preset: "cards", density: "compact" } };
    case "exceptions_evidence_v1":
      return { layout: { span: 12, height: "standard" }, presentation: { ...base, visual_preset: "list", limit: 8 } };
    default:
      return { layout: { span: 12, height: "standard" }, presentation: base };
  }
};

const defaultAllowedPresentation = (
  viewKey: string,
): EnergyIqComponentAllowedPresentation => {
  const create = (input: {
    spans: EnergyIqTemplateSpan[];
    presets: EnergyIqTemplateVisualPreset[];
    legend?: boolean;
    limit?: { configurable: boolean; default: number; max?: number };
  }): EnergyIqComponentAllowedPresentation => ({
    layout: {
      spans: input.spans,
      heights: ["compact", "standard", "tall"],
    },
    visuals: {
      presets: input.presets,
      densities: ["comfortable", "compact"],
      tones: ["default", "highlight", "quiet"],
      legend: {
        configurable: input.legend === true,
        default: input.legend === true,
      },
      limit: {
        configurable: input.limit?.configurable ?? false,
        min: 1,
        max: input.limit?.max ?? 50,
        default: input.limit?.default ?? 10,
      },
    },
  });

  switch (viewKey) {
    case "executive_action_summary_v1":
      return create({ spans: [8, 12], presets: ["auto"], limit: { configurable: false, default: 3 } });
    case "recommended_actions_v1":
      return create({ spans: [8, 12], presets: ["list"], limit: { configurable: false, default: 3 } });
    case "consumption_overview_v1":
      return create({ spans: [8, 12], presets: ["cards"] });
    case "child_scope_ranking_v1":
      return create({ spans: [6, 8, 12], presets: ["bar", "list"], legend: true, limit: { configurable: true, default: 10, max: 25 } });
    case "area_intensity_comparison_v1":
    case "people_intensity_comparison_v1":
      return create({ spans: [4, 6, 8, 12], presets: ["table"], limit: { configurable: true, default: 10, max: 25 } });
    case "off_hours_analysis_v1":
      return create({ spans: [4, 6, 8, 12], presets: ["cards"], limit: { configurable: true, default: 6, max: 12 } });
    case "operating_pattern_v1":
      return create({ spans: [6, 8, 12], presets: ["area", "bar"], legend: true });
    case "meter_breakdown_v1":
      return create({ spans: [6, 8, 12], presets: ["table"], limit: { configurable: true, default: 10, max: 25 } });
    case "data_quality_summary_v1":
      return create({ spans: [6, 8, 12], presets: ["cards"] });
    case "exceptions_evidence_v1":
      return create({ spans: [6, 8, 12], presets: ["list"], limit: { configurable: true, default: 8, max: 25 } });
    default:
      return create({ spans: [12], presets: ["auto"] });
  }
};

const reconcileTemplateDocument = (
  saved: EnergyIqTemplateDraftDocument,
  catalog: readonly EnergyIqComponentRevisionRecord[],
  tierDefinitionIds: readonly string[],
): EnergyIqTemplateDraftDocument => {
  const defaults = createDefaultTemplateDocument(catalog, tierDefinitionIds);
  const savedByTemplateId = new Map(saved.templates.map((template) => [template.template_id, template]));
  const catalogById = new Map(catalog.map((component) => [component.revision_id, component]));
  return {
    schema_version: 2,
    templates: defaults.templates.map((fallback) => {
      const current = savedByTemplateId.get(fallback.template_id);
      if (!current) return fallback;
      const applicableIds = new Set(fallback.components.map((placement) => placement.component_revision_id));
      const fallbackByComponentId = new Map(fallback.components.map((placement) => [placement.component_revision_id, placement]));
      const existing = current.components
        .filter((placement) =>
          applicableIds.has(placement.component_revision_id) && catalogById.has(placement.component_revision_id)
        )
        .map((placement) => {
          const component = catalogById.get(placement.component_revision_id)!;
          const componentFallback = fallbackByComponentId.get(placement.component_revision_id)
            ?? createDefaultPlacement(component);
          return constrainPlacementToAllowedPresentation({
            ...componentFallback,
            ...placement,
            layout: {
              ...componentFallback.layout,
              ...placement.layout,
            } as EnergyIqTemplateComponentLayout,
            presentation: {
              ...componentFallback.presentation,
              ...placement.presentation,
            } as EnergyIqTemplateComponentPresentation,
          }, component, componentFallback);
        });
      const existingIds = new Set(existing.map((placement) => placement.component_revision_id));
      return {
        ...fallback,
        sections: current.sections?.length ? current.sections : fallback.sections ?? [],
        components: [
          ...existing,
          ...fallback.components.filter((placement) => !existingIds.has(placement.component_revision_id)),
        ],
      };
    }),
  };
};

export const validateAndCanonicalizeTemplateDocument = (input: {
  document: EnergyIqTemplateDraftDocument;
  tier_definition_ids: readonly string[];
  catalog: readonly EnergyIqComponentRevisionRecord[];
}): EnergyIqTemplateDraftDocument => {
  if (!Array.isArray(input.document.templates)) throw new Error("ENERGYIQ_TEMPLATE_DOCUMENT_INVALID");
  const catalogById = new Map(input.catalog.map((component) => [component.revision_id, component]));
  const expectedTemplateIds = new Set(["project", ...input.tier_definition_ids.map((id) => `tier:${id}`)]);
  const seenTemplateIds = new Set<string>();
  const canonical: EnergyIqTemplateDefinition[] = [];

  for (const template of input.document.templates) {
    if (!expectedTemplateIds.has(template.template_id) || seenTemplateIds.has(template.template_id)) {
      throw new Error("ENERGYIQ_TEMPLATE_TARGET_INVALID");
    }
    seenTemplateIds.add(template.template_id);
    const isProject = template.template_id === "project";
    if ((isProject && template.target_kind !== "project") || (!isProject && template.target_kind !== "tier")) {
      throw new Error("ENERGYIQ_TEMPLATE_TARGET_INVALID");
    }
    if (!isProject && template.tier_definition_id !== template.template_id.slice("tier:".length)) {
      throw new Error("ENERGYIQ_TEMPLATE_TARGET_INVALID");
    }
    const fallback = createDefaultTemplateDefinition(
      template.template_id,
      template.target_kind,
      template.tier_definition_id,
      input.catalog,
    );
    const sections = canonicalizeSections(template.sections ?? fallback.sections ?? []);
    const sectionIds = new Set(sections.map((section) => section.section_id));
    const fallbackByComponentId = new Map(fallback.components.map((placement) => [placement.component_revision_id, placement]));
    const seenComponents = new Set<string>();
    const seenPlacementIds = new Set<string>();
    const components = template.components.map((placement) => {
      const component = catalogById.get(placement.component_revision_id);
      if (!component || seenComponents.has(placement.component_revision_id)) {
        throw new Error("ENERGYIQ_TEMPLATE_COMPONENT_INVALID");
      }
      if ((isProject && component.target === "tier") || (!isProject && component.target === "project")) {
        throw new Error("ENERGYIQ_TEMPLATE_COMPONENT_TARGET_INVALID");
      }
      seenComponents.add(placement.component_revision_id);
      const defaults = fallbackByComponentId.get(placement.component_revision_id) ?? createDefaultPlacement(component);
      const sectionId = placement.section_id ?? defaults.section_id ?? "energy-overview";
      if (!sectionIds.has(sectionId)) throw new Error("ENERGYIQ_TEMPLATE_SECTION_REFERENCE_INVALID");
      const placementId = nonEmptyOrFallback(placement.placement_id, defaults.placement_id ?? component.component_id);
      if (seenPlacementIds.has(placementId)) throw new Error("ENERGYIQ_TEMPLATE_PLACEMENT_ID_INVALID");
      seenPlacementIds.add(placementId);
      return {
        placement_id: placementId,
        component_revision_id: placement.component_revision_id,
        enabled: placement.enabled === true,
        section_id: sectionId,
        layout: canonicalizeLayout(placement.layout ?? defaults.layout, component.allowed_presentation),
        presentation: canonicalizePresentation(placement.presentation ?? defaults.presentation, component.allowed_presentation),
      };
    });
    canonical.push({
      template_id: template.template_id,
      target_kind: template.target_kind,
      ...(!isProject ? { tier_definition_id: template.tier_definition_id } : {}),
      sections,
      components,
    });
  }
  if (seenTemplateIds.size !== expectedTemplateIds.size) throw new Error("ENERGYIQ_TEMPLATE_TARGET_REQUIRED");
  return {
    schema_version: 2,
    templates: [
      canonical.find((template) => template.template_id === "project")!,
      ...input.tier_definition_ids.map((id) => canonical.find((template) => template.template_id === `tier:${id}`)!),
    ],
  };
};

const canonicalizeSections = (
  sections: readonly EnergyIqTemplateSection[],
): EnergyIqTemplateSection[] => {
  if (sections.length === 0) throw new Error("ENERGYIQ_TEMPLATE_SECTION_REQUIRED");
  const seen = new Set<string>();
  return sections.map((section) => {
    const sectionId = section.section_id.trim();
    const title = section.title.trim();
    const navigationLabel = section.navigation_label.trim();
    if (!sectionId || !title || !navigationLabel || seen.has(sectionId)) {
      throw new Error("ENERGYIQ_TEMPLATE_SECTION_INVALID");
    }
    seen.add(sectionId);
    const description = section.description?.trim();
    return {
      section_id: sectionId,
      title,
      navigation_label: navigationLabel,
      ...(description ? { description } : {}),
    };
  });
};

const canonicalizeLayout = (
  layout: EnergyIqTemplateComponentLayout | undefined,
  allowed: EnergyIqComponentAllowedPresentation,
): EnergyIqTemplateComponentLayout => {
  const span = layout?.span;
  const height = layout?.height;
  if (span !== 4 && span !== 6 && span !== 8 && span !== 12) {
    throw new Error("ENERGYIQ_TEMPLATE_LAYOUT_SPAN_INVALID");
  }
  if (height !== "compact" && height !== "standard" && height !== "tall") {
    throw new Error("ENERGYIQ_TEMPLATE_LAYOUT_HEIGHT_INVALID");
  }
  if (!allowed.layout.spans.includes(span)) throw new Error("ENERGYIQ_TEMPLATE_COMPONENT_SPAN_NOT_ALLOWED");
  if (!allowed.layout.heights.includes(height)) throw new Error("ENERGYIQ_TEMPLATE_COMPONENT_HEIGHT_NOT_ALLOWED");
  return { span, height };
};

const canonicalizePresentation = (
  presentation: EnergyIqTemplateComponentPresentation | undefined,
  allowed: EnergyIqComponentAllowedPresentation,
): EnergyIqTemplateComponentPresentation => {
  if (!presentation) throw new Error("ENERGYIQ_TEMPLATE_PRESENTATION_INVALID");
  const visualPreset = presentation?.visual_preset;
  const density = presentation?.density;
  const tone = presentation?.tone;
  const limit = presentation?.limit;
  if (visualPreset !== "auto" && visualPreset !== "cards" && visualPreset !== "bar" && visualPreset !== "area" && visualPreset !== "table" && visualPreset !== "list") {
    throw new Error("ENERGYIQ_TEMPLATE_VISUAL_PRESET_INVALID");
  }
  if (density !== "comfortable" && density !== "compact") throw new Error("ENERGYIQ_TEMPLATE_DENSITY_INVALID");
  if (tone !== "default" && tone !== "highlight" && tone !== "quiet") throw new Error("ENERGYIQ_TEMPLATE_TONE_INVALID");
  if (!allowed.visuals.presets.includes(visualPreset)) throw new Error("ENERGYIQ_TEMPLATE_COMPONENT_VISUAL_NOT_ALLOWED");
  if (!allowed.visuals.densities.includes(density)) throw new Error("ENERGYIQ_TEMPLATE_COMPONENT_DENSITY_NOT_ALLOWED");
  if (!allowed.visuals.tones.includes(tone)) throw new Error("ENERGYIQ_TEMPLATE_COMPONENT_TONE_NOT_ALLOWED");
  if (!allowed.visuals.legend.configurable && presentation.show_legend !== allowed.visuals.legend.default) {
    throw new Error("ENERGYIQ_TEMPLATE_COMPONENT_LEGEND_NOT_ALLOWED");
  }
  if (limit === undefined || !Number.isInteger(limit)
    || limit < allowed.visuals.limit.min || limit > allowed.visuals.limit.max) {
    throw new Error("ENERGYIQ_TEMPLATE_LIMIT_INVALID");
  }
  if (!allowed.visuals.limit.configurable && limit !== allowed.visuals.limit.default) {
    throw new Error("ENERGYIQ_TEMPLATE_COMPONENT_LIMIT_NOT_ALLOWED");
  }
  const title = presentation.title?.trim();
  const description = presentation.description?.trim();
  return {
    visual_preset: visualPreset,
    density,
    tone,
    show_legend: presentation.show_legend === true,
    limit,
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
  };
};

const constrainPlacementToAllowedPresentation = (
  placement: EnergyIqTemplateComponentPlacement,
  component: EnergyIqComponentRevisionRecord,
  fallback: EnergyIqTemplateComponentPlacement,
): EnergyIqTemplateComponentPlacement => {
  const allowed = component.allowed_presentation;
  const fallbackLayout = fallback.layout!;
  const fallbackPresentation = fallback.presentation!;
  const layout = placement.layout ?? fallbackLayout;
  const presentation = placement.presentation ?? fallbackPresentation;
  const limit = Number.isInteger(presentation.limit)
    ? Math.min(allowed.visuals.limit.max, Math.max(allowed.visuals.limit.min, presentation.limit))
    : allowed.visuals.limit.default;
  return {
    ...placement,
    layout: {
      span: allowed.layout.spans.includes(layout.span) ? layout.span : fallbackLayout.span,
      height: allowed.layout.heights.includes(layout.height) ? layout.height : fallbackLayout.height,
    },
    presentation: {
      ...presentation,
      visual_preset: allowed.visuals.presets.includes(presentation.visual_preset)
        ? presentation.visual_preset
        : fallbackPresentation.visual_preset,
      density: allowed.visuals.densities.includes(presentation.density)
        ? presentation.density
        : fallbackPresentation.density,
      tone: allowed.visuals.tones.includes(presentation.tone)
        ? presentation.tone
        : fallbackPresentation.tone,
      show_legend: allowed.visuals.legend.configurable
        ? presentation.show_legend
        : allowed.visuals.legend.default,
      limit: allowed.visuals.limit.configurable ? limit : allowed.visuals.limit.default,
    },
  };
};

const nonEmptyOrFallback = (value: string | undefined, fallback: string): string => {
  const normalized = value?.trim();
  return normalized || fallback;
};

const mapComponentRevision = (row: unknown): EnergyIqComponentRevisionRecord => {
  if (!isRecord(row)) throw new Error("Invalid EnergyIQ component revision row");
  const viewKey = requiredString(row, "view_key");
  return {
    revision_id: requiredString(row, "revision_id"),
    component_id: requiredString(row, "component_id"),
    version: requiredNumber(row, "version"),
    display_name: requiredString(row, "display_name"),
    description: requiredString(row, "description"),
    family: requiredString(row, "family") as EnergyIqComponentFamily,
    view_key: viewKey,
    target: requiredString(row, "target") as EnergyIqComponentTarget,
    metric_revision_ids: parseStringArray(requiredString(row, "metric_revision_ids_json")),
    rule_revision_ids: parseStringArray(requiredString(row, "rule_revision_ids_json")),
    query_ids: parseStringArray(requiredString(row, "query_ids_json")),
    requirement: requiredString(row, "requirement") as EnergyIqComponentRequirement,
    allowed_presentation: parseAllowedPresentation(row.allowed_presentation_json, viewKey),
    created_at: requiredString(row, "created_at"),
  };
};

const parseAllowedPresentation = (
  value: unknown,
  viewKey: string,
): EnergyIqComponentAllowedPresentation => {
  if (typeof value !== "string") return defaultAllowedPresentation(viewKey);
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed) || !isRecord(parsed.layout) || !isRecord(parsed.visuals)) {
      return defaultAllowedPresentation(viewKey);
    }
    const legend = parsed.visuals.legend;
    const limit = parsed.visuals.limit;
    if (!isRecord(legend) || !isRecord(limit)
      || !Array.isArray(parsed.layout.spans) || !Array.isArray(parsed.layout.heights)
      || !Array.isArray(parsed.visuals.presets) || !Array.isArray(parsed.visuals.densities)
      || !Array.isArray(parsed.visuals.tones)) {
      return defaultAllowedPresentation(viewKey);
    }
    return parsed as EnergyIqComponentAllowedPresentation;
  } catch {
    return defaultAllowedPresentation(viewKey);
  }
};

const mapProjectTemplateDraft = (row: Record<string, unknown>): EnergyIqProjectTemplateDraftRecord => {
  const parsed: unknown = JSON.parse(requiredString(row, "document_json"));
  if (!isRecord(parsed) || !Array.isArray(parsed.templates)) {
    throw new Error("Invalid EnergyIQ template draft document");
  }
  const updatedBy = optionalString(row.updated_by);
  const createdAt = optionalString(row.created_at);
  const updatedAt = optionalString(row.updated_at);
  return {
    project_id: requiredString(row, "project_id"),
    revision: requiredNumber(row, "revision"),
    document: parsed as EnergyIqTemplateDraftDocument,
    ...(updatedBy ? { updated_by: updatedBy } : {}),
    ...(createdAt ? { created_at: createdAt } : {}),
    ...(updatedAt ? { updated_at: updatedAt } : {}),
  };
};

const mapTemplateRevision = (row: unknown): EnergyIqTemplateRevisionRecord => {
  if (!isRecord(row)) throw new Error("Invalid EnergyIQ template revision row");
  const parsedDocument: unknown = JSON.parse(requiredString(row, "document_json"));
  if (!isRecord(parsedDocument) || !Array.isArray(parsedDocument.templates)) {
    throw new Error("Invalid EnergyIQ template revision document");
  }
  return {
    revision_id: requiredString(row, "revision_id"),
    project_id: requiredString(row, "project_id"),
    sequence: requiredNumber(row, "sequence"),
    source_template_draft_revision: requiredNumber(row, "source_template_draft_revision"),
    document: parsedDocument as EnergyIqTemplateDraftDocument,
    hierarchy_revision_id: requiredString(row, "hierarchy_revision_id"),
    meter_mapping_revision_id: requiredString(row, "meter_mapping_revision_id"),
    meter_formula_revision_id: requiredString(row, "meter_formula_revision_id"),
    metric_config_revision: requiredNumber(row, "metric_config_revision"),
    selected_metric_revision_ids: parseStringArray(requiredString(row, "selected_metric_revision_ids_json")),
    rule_config_revision: requiredNumber(row, "rule_config_revision"),
    selected_rule_revision_ids: parseStringArray(requiredString(row, "selected_rule_revision_ids_json")),
    business_calendar_version: requiredString(row, "business_calendar_version"),
    tariff_schedule_version: requiredString(row, "tariff_schedule_version"),
    published_by: requiredString(row, "published_by"),
    published_at: requiredString(row, "published_at"),
  };
};

const readSelectedRevisionConfig = (
  db: DatabaseSync,
  input: {
    projectId: string;
    configTable: "energyiq_project_metric_configs" | "energyiq_project_rule_configs";
    catalogTable: "energyiq_metric_revisions" | "energyiq_rule_revisions";
    selectedColumn: "selected_metric_revision_ids_json" | "selected_rule_revision_ids_json";
  },
): { revision: number; selectedRevisionIds: string[] } => {
  const row = db.prepare(`
    SELECT revision, ${input.selectedColumn} AS selected_revision_ids_json
    FROM ${input.configTable} WHERE project_id = ?
  `).get(input.projectId);
  if (isRecord(row)) {
    return {
      revision: requiredNumber(row, "revision"),
      selectedRevisionIds: parseStringArray(requiredString(row, "selected_revision_ids_json")),
    };
  }
  return {
    revision: 0,
    selectedRevisionIds: db.prepare(`SELECT revision_id FROM ${input.catalogTable} ORDER BY revision_id`)
      .all()
      .filter(isRecord)
      .map((catalogRow) => requiredString(catalogRow, "revision_id")),
  };
};

const assertExpectedRevision = (
  actual: number,
  expected: number | undefined,
  errorCode: string,
): void => {
  if (expected !== undefined && actual !== expected) throw new Error(errorCode);
};

const ensureColumn = (
  db: DatabaseSync,
  table: string,
  column: string,
  definition: string,
): void => {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((entry) => isRecord(entry) && entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
};


const parseStringArray = (value: string): string[] => {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error("Invalid EnergyIQ component dependency list");
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
