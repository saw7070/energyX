import { EnergyQuerySemanticProvider } from "@datafoundry/agent-runtime";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createMetadataStore } from "@datafoundry/metadata";
import type { ProjectAnalysisSnapshot } from "./energy/project-analysis-resolver.js";
import { compileTrustedEnergyRunContract } from "./trusted-energy-run-contract.js";

describe("trusted Energy server run contract", () => {
  it("pins a released ProjectAnalysisSnapshot to the exact run-local datasource", async () => {
    const root = mkdtempSync(join(tmpdir(), "trusted-energy-run-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const contract = compileTrustedEnergyRunContract({
      intent: "period-usage-vs-previous",
      metadataStore: metadata,
      scopedDatasource: {
        datasourceId: "energy-scope-deadbeef",
        revision: 8,
        viewName: "energy_scope_deadbeef",
        databasePath: join(root, "energy.duckdb")
      },
      snapshot: snapshot()
    });

    expect(contract.pins).toMatchObject({
      project: { id: "ngee-ann-polytechnic" },
      scope: { id: "project" },
      period: {
        start: "2026-06-09T16:00:00.000Z",
        endExclusive: "2026-06-16T16:00:00.000Z",
        timezone: "Asia/Singapore"
      },
      metric: { id: "energy.total_usage_kwh", revisionId: "energy.total_usage_kwh@1" },
      dataSnapshotId: "snapshot-1",
      dataAsOf: "2026-06-16T15:45:00.000Z",
      sourcePin: { datasourceId: "energy-scope-deadbeef", datasourceRevision: "8" }
    });
    const semantic = await new EnergyQuerySemanticProvider(contract).resolve({
      userId: "normal-user",
      workspaceId: "workspace-1",
      datasourceId: "energy-scope-deadbeef",
      datasourceRevision: "8",
      query: "selected period usage",
      physicalSchema: { tables: [{ name: "energy_scope_deadbeef" }] }
    });
    expect(semantic.trust).toBe("authoritative");
    expect(semantic.capabilities).toContain("trusted-energy-text");

    metadata.db.close();
    rmSync(root, { recursive: true, force: true });
  });
});

const snapshot = (): ProjectAnalysisSnapshot => ({
  context: {
    userId: "normal-user",
    workspaceId: "workspace-1",
    projectId: "ngee-ann-polytechnic",
    projectName: "Ngee Ann Polytechnic",
    scopeId: "project",
    scopeName: "Ngee Ann Polytechnic",
    scopeType: "project",
    resource: "electricity",
    timezone: "Asia/Singapore",
    from: "2026-06-09T16:00:00.000Z",
    to: "2026-06-16T16:00:00.000Z",
    endExclusive: true,
    period: "Custom",
    hierarchyRevisionId: "hierarchy@1",
    meterMappingRevisionId: "meter-routing@1",
    meterFormulaRevisionId: "formula@1",
    dataSnapshotId: "snapshot-1",
    metricVersion: "energy.total_usage_kwh@1",
    businessCalendarVersion: "calendar@1",
    tariffScheduleVersion: "tariff@1",
    resolvedAt: "2026-06-16T16:00:00.000Z",
    primaryPeriod: {
      start: "2026-06-09T16:00:00.000Z",
      endExclusive: "2026-06-16T16:00:00.000Z"
    },
    projectReleaseId: "release@1"
  },
  projectRelease: {
    id: "release@1",
    source: "legacy-profile",
    projectId: "ngee-ann-polytechnic",
    templateRevisionId: null,
    templateRevisionSequence: null,
    reportTimePolicyRevisionId: "ngee-ann-report-time@1",
    recipe: { id: "energy-scope-analysis", version: "1" },
    renderer: { key: "ngee-ann-overview", version: "1", contractVersion: "project-analysis-snapshot@1" },
    hierarchyRevisionId: "hierarchy@1",
    meterMappingRevisionId: "meter-routing@1",
    meterFormulaRevisionId: "formula@1",
    metricRevisionIds: ["energy.total_usage_kwh@1"],
    ruleRevisionIds: [],
    businessCalendarVersion: "calendar@1",
    tariffScheduleVersion: "tariff@1",
    publishedAt: null,
    document: { schema_version: 2, templates: [] },
    catalog: []
  },
  recipe: { id: "energy-scope-analysis", version: "1" },
  renderer: { key: "ngee-ann-overview", version: "1", contractVersion: "project-analysis-snapshot@1" },
  dataQuality: {
    status: "complete", coveragePct: 100, expectedMeterIntervalCount: 672, validIntervalCount: 672,
    qualityEventCount: 0, cumulativeDeltaMismatchCount: 0, averageKwMismatchCount: 0,
    invalidIntervalDurationCount: 0, lastSeenAt: "2026-06-16T15:45:00.000Z", importBatchIds: ["batch-1"]
  },
  evidence: [{
    id: "evidence:snapshot-1:energy.total_usage_kwh@1",
    metricId: "energy.total_usage_kwh@1",
    queryIds: [
      "scope_summary_v1",
      "hourly_profile_v1",
      "daily_totals_v1",
      "time_bucket_grid_v1",
      "peak_breakdown_v1",
      "meter_breakdown_v1",
      "previous_meter_usage_v1",
      "operational_policy_scope_intervals_v1",
      "operational_policy_meter_intervals_v1",
    ]
  }],
  findings: [],
  dataSnapshot: { id: "snapshot-1", importBatchIds: ["batch-1"], lastSeenAt: "2026-06-16T15:45:00.000Z" },
  metadata: {} as never,
  analysis: {
    context: {} as never,
    latestAcceptedReading: {
      status: "not_applicable",
      queryId: "latest_accepted_reading_v1",
      reason: {
        code: "LEAF_METER_REQUIRED",
        message: "Select a leaf Meter or Circuit to view its latest accepted cumulative reading.",
      },
    },
    summary: {
      usageKwh: 1531.1, averageDailyUsageKwh: 218.7, peakKw: 85.3,
      nonOperatingKwh: 0, nonOperatingSharePct: 0, validIntervalCount: 672, qualityEventCount: 0
    },
    hourlyProfile: [],
    comparison: {
      from: "2026-06-02T16:00:00.000Z", to: "2026-06-09T16:00:00.000Z",
      usageKwh: 1450, changeKwh: 81.1, changePct: 5.59
    },
    categories: [], childScopes: [], circuits: [], topCircuits: [], designatedTotals: [],
    componentReconciliation: {
      officialUsageKwh: 1531.1,
      componentUsageKwh: 0,
      gapKwh: 1531.1,
      ratioPct: 0,
      officialMeterNodeIds: [],
      componentMeterNodeIds: [],
    },
    virtualMeters: [],
    offHours: {
      status: "unavailable",
      reason: { code: "OPERATING_CALENDAR_VERSION_NOT_FOUND", message: "Published calendar was not found." },
      businessCalendarVersion: "calendar@1",
    },
    cost: {
      status: "unavailable",
      reason: { code: "TARIFF_VERSION_NOT_FOUND", message: "Published tariff was not found." },
      tariffScheduleVersion: "tariff@1",
    },
    dataHealth: {
      status: "complete", coveragePct: 100, expectedMeterIntervalCount: 672, validIntervalCount: 672,
      qualityEventCount: 0, cumulativeDeltaMismatchCount: 0, averageKwMismatchCount: 0,
      invalidIntervalDurationCount: 0, lastSeenAt: "2026-06-16T15:45:00.000Z", importBatchIds: ["batch-1"]
    },
    units: { usage: "kWh", demand: "kW", intervalMinutes: 15, timezone: "Asia/Singapore" },
    metadata: {} as never,
    attention: [],
    provenance: {
      dataSnapshotId: "snapshot-1", hierarchyRevisionId: "hierarchy@1", meterMappingRevisionId: "meter-routing@1", meterFormulaRevisionId: "formula@1",
      metricVersion: "energy.total_usage_kwh@1", ruleRevisionIds: [], aggregationRule: "designated_total",
      sourceView: "energy_scope_deadbeef",
      queryIds: [
        "scope_summary_v1",
        "hourly_profile_v1",
        "daily_totals_v1",
        "time_bucket_grid_v1",
        "peak_breakdown_v1",
        "meter_breakdown_v1",
        "previous_meter_usage_v1",
        "operational_policy_scope_intervals_v1",
        "operational_policy_meter_intervals_v1",
      ]
    }
  }
});
