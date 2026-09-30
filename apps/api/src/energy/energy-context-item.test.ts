import {
  createMetadataStore,
  type ContextPackageSnapshotRecord,
} from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ensureEnergyIqBootstrap,
  NGEE_ANN_WORKSPACE_ID,
} from "./energy-bootstrap.js";
import {
  createEnergyAuthoritativeContextItems,
  createProjectAnalysisSnapshotContextItem,
  createEnergyQueryContextItem,
} from "./energy-context-item.js";
import { resolveEnergyQueryContext } from "./energy-query-context.js";
import {
  resolvePublishedEnergyQueryContext,
  resolvePublishedProjectRelease,
  type ProjectAnalysisSnapshot,
} from "./project-analysis-resolver.js";
import { sessionEnergyContextFromSnapshot } from "./session-energy-context.js";

const baseContext = {
  userId: "user-1",
  workspaceId: "workspace-1",
  projectId: "project-1",
  projectName: "Project One",
  scopeId: "level-7",
  scopeName: "Level 7",
  scopeType: "level",
  resource: "electricity" as const,
  timezone: "Asia/Singapore",
  from: "2026-07-01T16:00:00.000Z",
  to: "2026-07-08T16:00:00.000Z",
  endExclusive: true as const,
  period: "Last 7 days" as const,
  hierarchyRevisionId: "hierarchy-v1",
  meterMappingRevisionId: "meter-routing-v1",
  meterFormulaRevisionId: "formula-v1",
  dataSnapshotId: "snapshot-v1",
  metricVersion: "metrics-v1",
  businessCalendarVersion: "calendar-v1",
  tariffScheduleVersion: "tariff-v1",
  resolvedAt: "2026-07-09T00:00:00.000Z"
};

describe("createEnergyQueryContextItem", () => {
  it("pins the authoritative scope and versions in model context", () => {
    const item = createEnergyQueryContextItem(baseContext, "session-1");
    expect(item.trust).toBe("tool");
    expect(String(item.content)).toContain("to_exclusive=2026-07-08T16:00:00.000Z");
    expect(String(item.content)).toContain("meter_formula_revision_id=formula-v1");
  });

  it("records a validated current-data fork as lineage, not current Evidence", () => {
    const item = createEnergyQueryContextItem(
      baseContext,
      "session-current",
      undefined,
      "release-current",
      {
        sourceSessionId: "session-historical",
        sourceRunId: "run-historical",
        sourceFrom: "2026-05-31T16:00:00.000Z",
        sourceTo: "2026-06-30T16:00:00.000Z",
      },
    );

    expect(item.metadata).toMatchObject({
      energyQueryContext: {
        forkedFromSessionId: "session-historical",
        forkedFromRunId: "run-historical",
        forkedFromFrom: "2026-05-31T16:00:00.000Z",
        forkedFromTo: "2026-06-30T16:00:00.000Z",
      },
    });
    expect(String(item.content)).toContain("forked_from_session_id=session-historical");
    expect(String(item.content)).toContain("forked_from_run_id=run-historical");
  });

  it("preserves unavailable source lineage in the first authoritative ContextPackage", () => {
    const item = createEnergyQueryContextItem(
      baseContext,
      "session-current",
      undefined,
      "release-current",
      {
        status: "unavailable",
        sourceSessionId: "session-contextless",
        reason: "source-context-unavailable",
      },
    );
    const restored = sessionEnergyContextFromSnapshot({
      id: "context-snapshot-1",
      user_id: "user-1",
      session_id: "session-current",
      run_id: "run-current",
      package_id: "package-current",
      revision: 1,
      payload_json: JSON.stringify({ items: [item] }),
      created_at: "2026-07-09T00:00:00.000Z",
    } satisfies ContextPackageSnapshotRecord);

    expect(restored).toMatchObject({
      forkedFromSessionId: "session-contextless",
      forkedFromContextStatus: "unavailable",
      forkedFromUnavailableReason: "source-context-unavailable",
    });
    expect(restored).not.toEqual(expect.objectContaining({
      forkedFromRunId: expect.anything(),
    }));
    expect(String(item.content)).toContain("forked_from_context_status=unavailable");
    expect(String(item.content)).toContain("forked_from_unavailable_reason=source-context-unavailable");
  });

  it("adds evidence-bound Ngee Ann analysis rules without changing other projects", () => {
    const item = createEnergyQueryContextItem({
      ...baseContext,
      projectId: "ngee-ann-polytechnic",
      projectName: "Ngee Ann Polytechnic"
    }, "session-1");
    const content = String(item.content);

    expect(content).toContain("Ngee Ann analysis policy");
    expect(content).toContain("one schema inspection establishes its governed contract");
    expect(content).toContain("Released Evidence already answers the question");
    expect(content).toContain("minimum sufficient Evidence plan");
    expect(content).toContain("Batch independent aggregates");
    expect(content).toContain("Each additional query must resolve a named uncertainty");
    expect(content).toContain("Stop querying once the question is answered");
    expect(content).not.toContain("Start with list_data_sources");
    expect(content).toContain("do not filter scope_id to the UI label 'project'");
    expect(content).toContain("group by local_interval_start");
    expect(content).toContain("comparison is unavailable");
    expect(content).toContain("never create new chart values");
    expect(content).toContain("Never generate mock figures");
    expect(content).toContain("evidence-backed next investigations or actions are allowed");
    expect(content).not.toContain("Never generate mock figures, business anomalies, root causes or action priorities");

    const otherProject = createEnergyQueryContextItem(baseContext, "session-1");
    expect(String(otherProject.content)).not.toContain("Ngee Ann analysis policy");
  });

  it("adds the Preschool Centre and provisional-evidence query policy without changing other projects", () => {
    const item = createEnergyQueryContextItem({
      ...baseContext,
      workspaceId: "preschool-demo-org",
      projectId: "preschool-demo",
      projectName: "Preschool Portfolio",
      scopeId: "preschool-project",
      scopeName: "Preschool Portfolio",
      scopeType: "project",
    }, "session-preschool", {
      contract: "energyiq-analysis-semantics@1",
      relations: {
        facts: {
          relation: "energy_scope_123",
          usageColumn: "usage_kwh",
          qualityStatusColumn: "quality_status",
          officialAggregationColumn: "official_aggregation_eligible",
        },
        scopeMetadata: {
          relation: "energy_scope_123_metadata",
          scopeIdColumn: "scope_id",
          scopeTypeColumn: "scope_type",
          facilityTypeColumn: "facility_type",
          metadataStatusColumn: "metadata_status",
          publishedFacilityTypes: ["Active Aging Center", "Preschool", "Senior Care Center"],
        },
      },
      measureAuthorities: [
        { id: "energy.usage_kwh", authority: "queryable", source: "facts", unit: "kWh" },
        {
          id: "preschool.benchmark.eui",
          authority: "deterministic-evidence",
          source: "project-analysis-snapshot",
          unit: "kWh/m2/yr",
        },
      ],
    });
    const content = String(item.content);

    expect(content).toContain("Preschool analysis policy");
    expect(content).toContain("one schema inspection establishes its governed contract");
    expect(content).toContain("Released Evidence already answers the question");
    expect(content).not.toContain("Start with inspect_schema, then use run_sql_readonly");
    expect(content).toContain("parent_node_id");
    expect(content).toContain("quality_status='ok'");
    expect(content).toContain("official_aggregation_eligible=TRUE");
    expect(content).toContain("EUI and per-pax");
    expect(content).toContain("provisional");
    expect(content).toContain("available Evidence does not identify it as the primary driver");
    expect(content).toContain("not an energy-waste problem");
    expect(content).toContain("exact Centre-level closed-hours total");
    expect(content).toContain("closed-hours energy does not materially contribute");
    expect(content).toContain("not a closed-hours energy problem");
    expect(content).toContain("Forecast, tariff cost, savings, ROI");
    expect(content).toContain("current Period, Snapshot and Published Release");
    expect(content).not.toContain("May Period");
    expect(content).not.toContain("May energy data");
    expect(content).toContain("does not expose Calendar-derived operating or standby values");
    expect(content).toContain("deterministic Evidence pinned to business_calendar_version");
    expect(content).toContain('"relation":"energy_scope_123_metadata"');
    expect(content).toContain("facility_type");
    expect(content).toContain("not a business count of zero");
    expect(content).toContain('"authority":"deterministic-evidence"');
    expect(content).not.toContain("is_operating comes from the published operating schedule");

    const otherProject = createEnergyQueryContextItem(baseContext, "session-1");
    expect(String(otherProject.content)).not.toContain("Preschool analysis policy");
  });

  it("projects bounded deterministic Preschool Evidence into the full Analyst context", () => {
    const item = createProjectAnalysisSnapshotContextItem({
      snapshot: {
        context: {
          ...baseContext,
          primaryPeriod: { start: baseContext.from, endExclusive: baseContext.to },
          projectReleaseId: "preschool-release-v1",
        },
        projectRelease: {
          id: "preschool-release-v1",
          hierarchyRevisionId: "hierarchy-v1",
          meterMappingRevisionId: "meter-routing-v1",
          meterFormulaRevisionId: "formula-v1",
          metricRevisionIds: ["energy.total_usage_kwh@1"],
          ruleRevisionIds: [],
          businessCalendarVersion: "calendar-v1",
          tariffScheduleVersion: "tariff-v1",
        },
        reportTimeContext: {
          contractRevision: "energyiq-report-time-context@1",
          binding: {
            workspaceId: baseContext.workspaceId,
            projectId: baseContext.projectId,
            scopeId: baseContext.scopeId,
            resource: baseContext.resource,
            dataSnapshotId: "snapshot-v1",
            projectReleaseId: "preschool-release-v1",
          },
          timezone: baseContext.timezone,
          asOf: "2026-07-09T00:00:00.000Z",
          acceptedDataEndExclusive: baseContext.to,
          dataThroughLocalDate: "2026-07-08",
          lastRefreshedAt: "2026-07-09T00:00:00.000Z",
          policyId: "preschool-report-time",
          policyRevision: "1",
          windows: [{
            windowId: "current-overview",
            role: "recent_operations",
            label: "Recent 28 complete days",
            strategy: { kind: "rolling_complete_days", days: 28 },
            phase: "complete",
            from: "2026-06-10T16:00:00.000Z",
            toExclusive: baseContext.to,
            completeDayCount: 28,
            segments: [{ from: "2026-06-10T16:00:00.000Z", toExclusive: baseContext.to }],
            comparisonCompatibilityKey: "current",
          }],
        },
        dataSnapshot: { id: "snapshot-v1", importBatchIds: ["batch-v1"], lastSeenAt: "2026-06-01T00:00:00.000Z" },
        metadata: {
          status: "provisional",
          selectedScope: { status: "missing" },
          comparisonScopes: [],
          evidence: [],
        },
        dataQuality: { status: "complete" },
        evidence: [{ id: "preschool-benchmark", metricId: "energy.total_usage_kwh@1", queryIds: [] }],
        findings: [],
        analysis: {
          summary: { usageKwh: 24_921.8123, peakKw: 1_000 },
          comparison: { usageKwh: 0, changeKwh: 0, changePct: null },
          categories: [],
          childScopes: [{
            nodeId: "preschool-centre-e",
            name: "Centre E",
            nodeType: "centre",
            usageKwh: 870.4991,
            sharePct: 3.4929,
            comparison: { usageKwh: 0, changeKwh: 870.4991, changePct: null },
            dataHealth: { status: "complete", coveragePct: 100 },
            areaSqm: 1_621,
            occupantCount: 54,
            kwhPerSqm: 0.537,
            kwhPerPerson: 16.12,
            metadata: {
              status: "provisional",
              evidence: [{ internalPayload: "do-not-copy-complete-metadata-evidence" }],
            },
          }],
          topCircuits: [],
          offHours: { status: "unavailable", reason: { message: "not supplied" } },
        },
        preschoolBenchmark: {
          status: "provisional",
          contract: { id: "preschool-may-2026-benchmark", version: "1", annualisationFactor: 12 },
          period: { start: baseContext.from, endExclusive: baseContext.to, timezone: baseContext.timezone },
          sampleSize: 30,
          portfolio: {
            eui: { p50: 6.8, p75: 10.5, unit: "kWh/m2/year" },
            perPax: { p50: 18.1, p75: 20.7, unit: "kWh/person/month" },
          },
          cohorts: [{
            name: "Active Aging Center",
            sampleSize: 8,
            eui: { p50: 6.72, p75: 15.13, unit: "kWh/m2/year" },
            perPax: { p50: 17.2, p75: 22.5, unit: "kWh/person/month" },
          }],
          centres: [],
          priorityCentreCodes: [],
          evidence: {},
        },
        preschoolAppliances: {
          status: "available",
          appliances: [{
            name: "Kitchen Plug Load",
            applianceGroup: "Plugload",
            usageKwh: 4_819.292,
            sharePct: 19.3376,
            centreCount: 30,
            sourceCircuitIds: ["internal-source-circuit-a", "internal-source-circuit-b"],
          }],
        },
        preschoolOperational: {
          status: "available",
          standbyAppliances: {
            totalKwh: 100,
            appliances: [{
              name: "Living Area Plug Load",
              centreCount: 30,
              sourceCircuitIds: ["internal-standby-circuit-a", "internal-standby-circuit-b"],
            }],
          },
          operatingAppliances: {
            totalKwh: 200,
            appliances: [{
              name: "Living Room Lighting",
              centreCount: 30,
              sourceCircuitIds: ["internal-operating-circuit-a"],
            }],
          },
          analysisReady: {
            contract: {
              id: "preschool-operational-analysis-ready",
              version: "1",
              maximumCellCount: 22_320,
              eventCapturePolicy: "all qualifying events; no ranking or Top-N truncation",
              recurrenceGrain: "operating-state x Centre x local-hour x Circuit",
              minimumPatternComparableObservationCount: 4,
              similarCentreBasis: "same published centreType",
            },
            eventCatalog: {
              status: "complete",
              boundedCellCount: 100,
              totalEventCount: 1_000,
              capturedEventCount: 1_000,
              truncated: false,
              events: Array.from({ length: 1_000 }, (_, index) => ({
                id: `must-not-inline-operational-event-${index}`,
              })),
            },
            recurrence: {
              status: "complete",
              rows: Array.from({ length: 22_320 }, (_, index) => ({
                key: `must-not-inline-operational-recurrence-${index}`,
              })),
            },
            contextAvailability: {
              mustRunSchedule: {
                status: "unknown",
                reason: "MUST_RUN_SCHEDULE_NOT_PROVIDED_BY_CANONICAL_INPUTS",
              },
              equipmentState: {
                status: "unknown",
                reason: "EQUIPMENT_STATE_NOT_PROVIDED_BY_CANONICAL_INPUTS",
              },
            },
          },
          sop: {
            status: "provisional",
            baselineScore: 100,
            deductionPerStandbySpike: 1,
            breachingCentreCodes: ["E"],
            centres: [
              { centreCode: "E", standbySpikeCount: 2, score: 98 },
              { centreCode: "A", standbySpikeCount: 0, score: 100 },
            ],
          },
        },
      } as unknown as ProjectAnalysisSnapshot,
      sessionId: "session-preschool",
      userId: "user-1",
    });
    const content = String(item.content);

    expect(item.sourceType).toBe("project-analysis-snapshot");
    expect(content).toContain('"projectId":"project-1"');
    expect(content).toContain('"scopeId":"level-7"');
    expect(content).toContain('"dataSnapshotId":"snapshot-v1"');
    expect(content).toContain('"dataCutoff":"2026-07-08T16:00:00.000Z"');
    expect(content).toContain('"businessCalendarVersion":"calendar-v1"');
    expect(content).toContain('"reportTimeContext":{"contractRevision":"energyiq-report-time-context@1"');
    expect(content).toContain('"windowId":"current-overview"');
    expect(content).toContain("preschool.benchmark.cohorts.active%20aging%20center.eui.p50");
    expect(content).toContain('"cohort":"Active Aging Center","sampleSize":"8"');
    expect(content).toContain('"sourceCircuitCount":2');
    expect(content).toContain('"name":"Living Area Plug Load","centreCount":30,"sourceCircuitCount":2');
    expect(content).toContain('"name":"Living Room Lighting","centreCount":30,"sourceCircuitCount":1');
    expect(content).toContain('"scoredCentreCount":2');
    expect(content).toContain('"centreCode":"E","standbySpikeCount":2');
    expect(content).not.toContain("do-not-copy-complete-metadata-evidence");
    expect(content).not.toContain("internal-source-circuit-a");
    expect(content).not.toContain("internal-standby-circuit-a");
    expect(content).not.toContain("internal-operating-circuit-a");
    expect(content).not.toContain('"centreCode":"A","standbySpikeCount":0');
    expect(content).not.toContain("must-not-inline-operational-event");
    expect(content).not.toContain("must-not-inline-operational-recurrence");
    expect(content).toContain('"capturedEventCount":1000');
    expect(content).toContain('"rowCount":22320');
    expect(content).toContain("EQUIPMENT_STATE_NOT_PROVIDED_BY_CANONICAL_INPUTS");
    expect(content).not.toContain('"evidenceRefs"');
    expect(content.match(/preschool-benchmark/gu)).toHaveLength(1);
    expect(content.length).toBeLessThan(15_000);
    expect(content).toContain("Deterministic Evidence is authoritative");
  });

  it("projects only question-selected package facts into the Analyst prompt", () => {
    const item = createProjectAnalysisSnapshotContextItem({
      contextEvidenceCatalog: {
        contract: "analysis-context-evidence@1",
        sourceId: "snapshot-v1:released-evidence",
        pins: {
          workspaceId: baseContext.workspaceId,
          projectId: baseContext.projectId,
          scopeId: baseContext.scopeId,
          dataSnapshotId: "snapshot-v1",
          dataCutoff: baseContext.to,
          projectReleaseId: "preschool-release-v1",
          metricVersion: baseContext.metricVersion,
        },
        facts: [
          {
            id: "priority-centre-e",
            label: "Centre E priority",
            metricId: "preschool.benchmark.priority",
            value: true,
            status: "provisional",
            evidenceRefs: ["evidence:centre-e"],
            dimensions: { scopeId: "centre-e", centreName: "Centre E" },
          },
          {
            id: "unrelated-portfolio-total",
            label: "Portfolio total",
            metricId: "energy.total_usage_kwh",
            value: 24_921.8123,
            unit: "kWh",
            status: "confirmed",
            evidenceRefs: ["evidence:portfolio"],
            dimensions: { scopeId: baseContext.scopeId },
          },
        ],
      },
      contextEvidenceSelection: {
        mode: "supporting",
        factIds: ["priority-centre-e"],
      },
      snapshot: {
        context: {
          ...baseContext,
          primaryPeriod: { start: baseContext.from, endExclusive: baseContext.to },
          projectReleaseId: "preschool-release-v1",
        },
        dataSnapshot: { id: "snapshot-v1", importBatchIds: [], lastSeenAt: null },
        dataQuality: { status: "complete" },
        evidence: [{ id: "must-not-inline-full-evidence" }],
        findings: [{ id: "must-not-inline-full-finding" }],
        decisionPriorities: [{ id: "must-not-inline-full-priority" }],
      } as unknown as ProjectAnalysisSnapshot,
      sessionId: "session-preschool",
      userId: "user-1",
    });
    const content = String(item.content);

    expect(content).toContain('"mode":"supporting"');
    expect(content).toContain('"id":"priority-centre-e"');
    expect(content).toContain('"centreName":"Centre E"');
    expect(content).toContain('"dataSnapshotId":"snapshot-v1"');
    expect(content).toContain('"projectReleaseId":"preschool-release-v1"');
    expect(content).not.toContain("unrelated-portfolio-total");
    expect(content).not.toContain("must-not-inline-full-evidence");
    expect(content).not.toContain("must-not-inline-full-finding");
    expect(content).not.toContain("must-not-inline-full-priority");
    expect(content).not.toContain("deterministic_evidence_bundle=");
    expect(content.length).toBeLessThan(3_000);
  });

  it("assembles the authorized Ngee Ann query context and Pack for the server Context Package", () => {
    const root = mkdtempSync(join(tmpdir(), "energy-authoritative-context-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const context = resolveEnergyQueryContext({
        metadataStore: metadata,
        user: metadata.users.getById({ user_id: "dev-user" }),
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        request: {
          projectId: "ngee-ann-polytechnic",
          scopeId: "project",
          resource: "electricity",
          period: "Custom",
          from: "2026-06-10",
          to: "2026-06-16",
        },
      });
      const projectRelease = resolvePublishedProjectRelease(metadata, context);
      expect(projectRelease).not.toBeNull();

      const items = createEnergyAuthoritativeContextItems({
        context,
        projectRelease,
        sessionId: "session-ngee-ann",
        userId: context.userId,
      });

      expect(items.map((item) => item.sourceType)).toEqual([
        "energy-query-context",
        "project-analysis-pack",
      ]);
      expect(items[0]?.metadata).toMatchObject({
        energyQueryContext: {
          hierarchyRevisionId: context.hierarchyRevisionId,
          meterMappingRevisionId: context.meterMappingRevisionId,
          meterFormulaRevisionId: context.meterFormulaRevisionId,
          projectReleaseId: projectRelease?.id,
        },
      });
      expect(items[1]).toMatchObject({
        id: expect.stringContaining("ngee-ann-analysis-pack@v1"),
        groupId: "project-analysis-pack:ngee-ann-analysis-pack@v1",
        metadata: {
          analysisPackRevision: "v1",
          projectReleaseId: projectRelease?.id,
          sourceOwner: "server",
        },
      });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("resolves Scope and routing from the accepted Release before binding the server Context Package", () => {
    const root = mkdtempSync(join(tmpdir(), "energy-release-bound-context-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const context = resolveEnergyQueryContext({
        metadataStore: metadata,
        user: metadata.users.getById({ user_id: "dev-user" }),
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        request: {
          projectId: "ngee-ann-polytechnic",
          scopeId: "project",
          resource: "electricity",
          period: "Custom",
          from: "2026-06-10",
          to: "2026-06-16",
        },
      });
      const project = metadata.energyIq.getProject(context.projectId);
      const publishedRevision = metadata.energyIq.templates.publishProjectRevisionWithinTransaction({
        project_id: context.projectId,
        tier_definition_ids: metadata.energyIq.listTierDefinitions(context.projectId)
          .map((tier) => tier.id),
        hierarchy_revision_id: context.hierarchyRevisionId,
        meter_mapping_revision_id: context.meterMappingRevisionId,
        published_by: context.userId,
        published_at: "2026-08-05T00:00:00.000Z",
      });
      metadata.energyIq.upsertProject({
        ...project,
        hierarchy_revision_id: "unpublished-hierarchy-drift",
        meter_formula_revision_id: `${project.meter_formula_revision_id}-draft-drift`,
        metric_version: `${project.metric_version}-draft-drift`,
        business_calendar_version: `${project.business_calendar_version}-draft-drift`,
        tariff_schedule_version: `${project.tariff_schedule_version}-draft-drift`,
      });

      const request = {
        projectId: context.projectId,
        scopeId: "level-7",
        resource: "electricity" as const,
        period: "Custom" as const,
        from: "2026-06-10",
        to: "2026-06-16",
      };

      expect(() => resolvePublishedEnergyQueryContext({
        metadataStore: metadata,
        user: metadata.users.getById({ user_id: "dev-user" }),
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        request: {
          ...request,
          expectedProjectReleaseId: "stale-overview-release",
        },
      })).toThrow("ENERGYIQ_PROJECT_RELEASE_MISMATCH");

      const resolved = resolvePublishedEnergyQueryContext({
        metadataStore: metadata,
        user: metadata.users.getById({ user_id: "dev-user" }),
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        request: {
          ...request,
          expectedProjectReleaseId: publishedRevision.revision_id,
        },
      });
      expect(resolved.projectRelease?.id).toBe(publishedRevision.revision_id);
      expect(resolved.context).toMatchObject({
        scopeId: "level-7",
        scopeName: "Level 7",
        hierarchyRevisionId: publishedRevision.hierarchy_revision_id,
        meterMappingRevisionId: publishedRevision.meter_mapping_revision_id,
        meterFormulaRevisionId: publishedRevision.meter_formula_revision_id,
        metricVersion: `metric-revisions:${[...publishedRevision.selected_metric_revision_ids]
          .sort((left, right) => left.localeCompare(right))
          .join(",") || "none"}`,
        businessCalendarVersion: publishedRevision.business_calendar_version,
        tariffScheduleVersion: publishedRevision.tariff_schedule_version,
      });

      const items = createEnergyAuthoritativeContextItems({
        context: resolved.context,
        projectRelease: resolved.projectRelease,
        sessionId: "session-release-bound",
        userId: resolved.context.userId,
      });
      expect(String(items[0]?.content)).toContain(
        `hierarchy_revision_id=${publishedRevision.hierarchy_revision_id}`,
      );
      expect(items[1]?.metadata).toMatchObject({
        projectReleaseId: publishedRevision.revision_id,
      });

      metadata.users.upsertDevUser({
        id: "preschool-only-user",
        email: "preschool-only@example.com",
        display_name: "Preschool Only",
        dev_token: "preschool-only-token",
      });
      metadata.workspaceMemberships.upsert({
        workspace_id: "preschool-demo-org",
        user_id: "preschool-only-user",
        role: "member",
      });
      expect(() => resolvePublishedEnergyQueryContext({
        metadataStore: metadata,
        user: metadata.users.getById({ user_id: "preschool-only-user" }),
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        request: {
          ...request,
          expectedProjectReleaseId: "stale-overview-release",
        },
      })).toThrow("ENERGYIQ_WORKSPACE_FORBIDDEN");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});
