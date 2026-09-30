import { describe, expect, it } from "vitest";

import type {
  EnergyComponentRevisionDto,
  EnergyImportBatchDto,
  EnergyProjectSetupDocumentDto,
  EnergyTemplateDefinitionDto,
} from "../../../lib/config-api";
import {
  buildTemplatePreviewPlan,
  buildTemplatePreviewRequest,
  resolveEnergyPreviewRange,
  resolveLatestImportedPreviewRange,
} from "./template-draft-preview-model";

const document: EnergyProjectSetupDocumentDto = {
  project: { name: "Ngee Ann", timezone: "Asia/Singapore" },
  tier_structure_locked: true,
  tiers: [
    { id: "circuit", ordinal: 1, alias: "Circuit" },
    { id: "level", ordinal: 2, alias: "Level" },
  ],
  nodes: [
    { id: "level-7", tier_definition_id: "level", name: "Level 7", sort_order: 2, metadata_status: "confirmed" },
    { id: "level-6", tier_definition_id: "level", name: "Level 6", sort_order: 1, metadata_status: "confirmed" },
  ],
};

const catalog: EnergyComponentRevisionDto[] = [
  {
    revision_id: "overview.consumption@1",
    component_id: "overview.consumption",
    version: 1,
    display_name: "Consumption overview",
    description: "Overview",
    family: "overview",
    view_key: "consumption_overview_v1",
    target: "both",
    metric_revision_ids: [],
    rule_revision_ids: [],
    query_ids: ["scope_summary_v1"],
    requirement: "always",
    created_at: "2026-08-02T00:00:00.000Z",
  },
  {
    revision_id: "quality.data_coverage@1",
    component_id: "quality.data_coverage",
    version: 1,
    display_name: "Data quality",
    description: "Quality",
    family: "quality",
    view_key: "data_quality_summary_v1",
    target: "both",
    metric_revision_ids: [],
    rule_revision_ids: [],
    query_ids: ["scope_summary_v1"],
    requirement: "always",
    created_at: "2026-08-02T00:00:00.000Z",
  },
];

describe("buildTemplatePreviewPlan", () => {
  it("uses the whole Project for a Project Template and keeps enabled component order", () => {
    const template: EnergyTemplateDefinitionDto = {
      template_id: "project",
      target_kind: "project",
      components: [
        { component_revision_id: "quality.data_coverage@1", enabled: true },
        { component_revision_id: "overview.consumption@1", enabled: false },
      ],
    };
    const plan = buildTemplatePreviewPlan({
      template,
      document,
      catalog,
      selectedMetricRevisionIds: new Set(),
      selectedRuleRevisionIds: new Set(),
      businessCalendarVersion: "sg-calendar-v1",
    });
    expect(plan.scopes).toEqual([{
      id: "project",
      name: "Ngee Ann",
      detail: "Whole Project · No meter mapping",
      factsMapped: false,
    }]);
    expect(plan.modules.map((module) => module.component.revision_id)).toEqual(["quality.data_coverage@1"]);
  });

  it("offers every real node of the selected Tier in configured order", () => {
    const template: EnergyTemplateDefinitionDto = {
      template_id: "tier:level",
      target_kind: "tier",
      tier_definition_id: "level",
      components: [{ component_revision_id: "overview.consumption@1", enabled: true }],
    };
    const plan = buildTemplatePreviewPlan({
      template,
      document,
      catalog,
      selectedMetricRevisionIds: new Set(),
      selectedRuleRevisionIds: new Set(),
      businessCalendarVersion: "sg-calendar-v1",
    });
    expect(plan.label).toBe("Level Template");
    expect(plan.scopes.map((scope) => scope.id)).toEqual(["level-6", "level-7"]);
    expect(plan.recommendedScopeId).toBe("level-6");
  });

  it("recommends the first Tier scope with a meter mapped inside its branch", () => {
    const template: EnergyTemplateDefinitionDto = {
      template_id: "tier:level",
      target_kind: "tier",
      tier_definition_id: "level",
      components: [{ component_revision_id: "overview.consumption@1", enabled: true }],
    };
    const plan = buildTemplatePreviewPlan({
      template,
      document: {
        ...document,
        nodes: [...document.nodes, { id: "circuit-7", tier_definition_id: "circuit", parent_id: "level-7", name: "Circuit 7", sort_order: 1, metadata_status: "confirmed" }],
        meter_mapping: {
          source_kind: "excel",
          confirmed: true,
          rows: [{ id: "meter-7", source_label: "Meter 7", scope_id: "circuit-7", display_name: "Meter 7", resource: "electricity", category: "load", coverage: "partial", meter_role: "component", aggregation_usage: "official" }],
        },
      },
      catalog,
      selectedMetricRevisionIds: new Set(),
      selectedRuleRevisionIds: new Set(),
      businessCalendarVersion: "sg-calendar-v1",
    });
    expect(plan.recommendedScopeId).toBe("level-7");
    expect(plan.scopes.map((scope) => [scope.id, scope.factsMapped])).toEqual([["level-6", false], ["level-7", true]]);
  });
});

describe("resolveLatestImportedPreviewRange", () => {
  it("uses the newest materialized batch and includes its final interval", () => {
    const batch = (input: Partial<EnergyImportBatchDto>): EnergyImportBatchDto => ({
      id: "batch-old",
      projectId: "project",
      sourceKind: "excel",
      sourceSha256: "sha",
      filename: "old.xlsx",
      status: "materialized",
      inspection: {
        sheetName: "Sheet1",
        columns: [], sourceLabels: [], rowCount: 2, validRowCount: 2, invalidRowCount: 0,
        duplicateReadingCount: 0, negativeReadingCount: 0, readingKind: "cumulative", qualityStatus: "ready", issues: [],
        coverageFrom: "2026-05-01T00:00:00.000Z", coverageTo: "2026-05-01T00:15:00.000Z", typicalIntervalMinutes: 15,
      },
      createdAt: "2026-05-01T00:00:00.000Z",
      ...input,
    });
    const range = resolveLatestImportedPreviewRange([
      batch({}),
      batch({ id: "batch-new", filename: "new.xlsx", createdAt: "2026-06-01T00:00:00.000Z", inspection: {
        sheetName: "Sheet1",
        ...batch({}).inspection,
        coverageFrom: "2026-06-01T00:00:00.000Z",
        coverageTo: "2026-06-30T23:45:00.000Z",
      } }),
    ]);
    expect(range).toMatchObject({
      batchId: "batch-new",
      from: "2026-06-01T00:00:00.000Z",
      to: "2026-07-01T00:00:00.000Z",
      fromDate: "2026-06-01",
      toDate: "2026-07-01",
    });
  });
});

describe("buildTemplatePreviewRequest", () => {
  it("uses exact imported timestamps and keeps custom dates inclusive through the query-context contract", () => {
    const previewRange = {
      from: "2026-06-01T00:00:00.000Z",
      to: "2026-07-01T00:00:00.000Z",
      fromDate: "2026-06-01",
      toDate: "2026-06-30",
      label: "June",
      batchId: "batch",
    };
    expect(buildTemplatePreviewRequest({
      projectId: "project", scopeId: "level-6", period: "Available facts", previewRange, customFrom: "", customTo: "",
    })).toMatchObject({ period: "Custom", from: previewRange.from, to: previewRange.to });
    expect(buildTemplatePreviewRequest({
      projectId: "project", scopeId: "level-6", period: "Custom", previewRange, customFrom: "2026-06-01", customTo: "2026-06-30",
    })).toMatchObject({ period: "Custom", from: "2026-06-01", to: "2026-06-30" });
  });

  it("uses canonical fact coverage even when no Import Batch exists", () => {
    expect(resolveEnergyPreviewRange({
      coverage: { from: "2026-05-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z", intervalCount: 100 },
      batches: [],
      timezone: "Asia/Singapore",
    })).toMatchObject({
      from: "2026-05-01T00:00:00.000Z",
      to: "2026-06-01T00:00:00.000Z",
      fromDate: "2026-05-01",
      toDate: "2026-06-01",
      label: "1 May 2026–1 Jun 2026 · 100 intervals",
      batchId: "fact-store",
    });
  });

  it("pins an approved proposal preview to its immutable Snapshot and base Release", () => {
    expect(buildTemplatePreviewRequest({
      projectId: "project",
      scopeId: "project-root",
      period: "Last 30 days",
      previewRange: null,
      customFrom: "",
      customTo: "",
      fixedIdentity: {
        dataSnapshotId: "snapshot-7",
        projectReleaseId: "project-template-v3",
      },
    })).toMatchObject({
      expectedDataSnapshotId: "snapshot-7",
      expectedProjectReleaseId: "project-template-v3",
    });
  });
});
