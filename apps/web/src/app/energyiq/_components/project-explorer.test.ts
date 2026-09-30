import { describe, expect, it } from "vitest";

import type { EnergyScopeAnalysisDto } from "../../../lib/config-api";

import {
  buildExplorerAnalysisRequest,
  explorerCurrentFactsUrl,
  explorerChildScopeHealth,
  explorerAnalysisErrorPresentation,
  explorerSelectedPeriodAverage,
  explorerSnapshotHealthMap,
  explorerTrendSeries,
  explorerUrlWithView,
  explorerViewStateFromSearchParams,
  formatDateInput,
  hasExplorerFacts,
  isExplorerPinnedContextMismatch,
} from "./project-explorer";

describe("Project Explorer trusted view state", () => {
  it("defaults an unpinned Explorer visit to the Project current 28-day window", () => {
    const view = explorerViewStateFromSearchParams(new URLSearchParams("projectId=preschool-demo"));

    expect(view.period).toBe("Current 28 days");
    expect(buildExplorerAnalysisRequest(view)).toMatchObject({
      projectId: "preschool-demo",
      period: "Custom",
      analysisWindow: "current-overview-28d",
      surface: "project-explorer",
    });
  });

  it("keeps long internal meter lists out of the primary error message", () => {
    const raw = "ENERGYIQ_OPERATIONAL_POLICY_METER_INTERVALS_INCOMPLETE:meter-a,meter-b,meter-c";
    expect(explorerAnalysisErrorPresentation(raw)).toEqual({
      summary: "Operating-hours details are incomplete for this Scope. No partial meter-policy result was shown.",
      technicalDetails: raw,
    });
  });

  it("uses the Project timezone for inclusive Custom dates", () => {
    expect(formatDateInput("2026-06-09T16:00:00.000Z", "Asia/Singapore")).toBe("2026-06-10");
    expect(formatDateInput("2026-06-16T15:59:59.999Z", "Asia/Singapore")).toBe("2026-06-16");
  });

  it("restores the fixed Overview handoff Project, Scope, resource, Period and evidence pins", () => {
    const view = explorerViewStateFromSearchParams(new URLSearchParams(
      "projectId=ngee-ann-polytechnic&scopeId=l7-load-4&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16&dataSnapshotId=snapshot-a&projectReleaseId=release-a&grain=day&comparison=selected&category=load",
    ));

    expect(view).toEqual({
      projectId: "ngee-ann-polytechnic",
      scopeId: "l7-load-4",
      resource: "electricity",
      period: "Custom",
      from: "2026-06-10",
      to: "2026-06-16",
      dataSnapshotId: "snapshot-a",
      projectReleaseId: "release-a",
      chartView: "daily",
    });

    expect(buildExplorerAnalysisRequest(view)).toEqual({
      projectId: "ngee-ann-polytechnic",
      scopeId: "l7-load-4",
      resource: "electricity",
      period: "Custom",
      from: "2026-06-10",
      to: "2026-06-16",
      expectedDataSnapshotId: "snapshot-a",
      expectedProjectReleaseId: "release-a",
      surface: "project-explorer",
    });
  });

  it("preserves supported Periods and rejects an invalid Custom range", () => {
    expect(explorerViewStateFromSearchParams(new URLSearchParams("period=Last+7+days"))).toMatchObject({
      period: "Last 7 days",
      from: "",
      to: "",
    });
    expect(explorerViewStateFromSearchParams(new URLSearchParams("period=Last+30+days"))).toMatchObject({
      period: "Last 30 days",
      from: "",
      to: "",
    });
    expect(explorerViewStateFromSearchParams(new URLSearchParams("period=Previous+month"))).toMatchObject({
      period: "Previous month",
      from: "",
      to: "",
    });
    expect(explorerViewStateFromSearchParams(new URLSearchParams(
      "period=Custom&from=2026-06-17&to=2026-06-16&resource=unknown",
    ))).toMatchObject({
      resource: "electricity",
      period: "Custom",
      from: "",
      to: "",
    });
  });

  it("serializes the selected Scope and Period so refresh restores the Explorer view", () => {
    expect(explorerUrlWithView({
      projectId: "preschool-demo",
      scopeId: "centre-12",
      resource: "electricity",
      period: "Previous month",
      from: "",
      to: "",
      dataSnapshotId: "snapshot-p",
      projectReleaseId: "release-p",
      chartView: "daily",
    })).toBe(
      "/energyiq/explorer?projectId=preschool-demo&scopeId=centre-12&resource=electricity&period=Previous+month&dataSnapshotId=snapshot-p&projectReleaseId=release-p",
    );
  });

  it("requires an explicit user choice before dropping stale Snapshot and Release pins", () => {
    const pinnedView = {
      projectId: "ngee-ann-polytechnic",
      scopeId: "l7-load-4",
      resource: "electricity" as const,
      period: "Custom" as const,
      from: "2026-06-10",
      to: "2026-06-16",
      dataSnapshotId: "snapshot-a",
      projectReleaseId: "release-a",
      chartView: "hourly" as const,
    };

    expect(isExplorerPinnedContextMismatch("ENERGYIQ_DATA_SNAPSHOT_MISMATCH")).toBe(true);
    expect(isExplorerPinnedContextMismatch("ENERGYIQ_PROJECT_RELEASE_MISMATCH")).toBe(true);
    expect(isExplorerPinnedContextMismatch("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE")).toBe(false);
    expect(explorerCurrentFactsUrl(pinnedView)).toBe(
      "/energyiq/explorer?projectId=ngee-ann-polytechnic&scopeId=l7-load-4&resource=electricity&period=Custom&from=2026-06-10&to=2026-06-16&view=hourly",
    );
  });

  it("restores the local 24-hour chart without changing the trusted analysis request", () => {
    const view = explorerViewStateFromSearchParams(new URLSearchParams(
      "projectId=ngee-ann-polytechnic&scopeId=level-7&period=Last+7+days&view=hourly&dataSnapshotId=snapshot-a&projectReleaseId=release-a",
    ));

    expect(view.chartView).toBe("hourly");
    expect(explorerUrlWithView(view)).toContain("view=hourly");
    expect(buildExplorerAnalysisRequest(view)).not.toHaveProperty("view");
  });

  it("round-trips server-provided Week and Month chart views without changing the analysis request", () => {
    for (const chartView of ["weekly", "monthly"] as const) {
      const view = explorerViewStateFromSearchParams(new URLSearchParams(
        `projectId=preschool-demo&scopeId=centre-e&period=Previous+month&view=${chartView}`,
      ));
      expect(view.chartView).toBe(chartView);
      expect(explorerUrlWithView(view)).toContain(`view=${chartView}`);
      expect(buildExplorerAnalysisRequest(view)).not.toHaveProperty("view");
    }
  });

  it("does not present an empty trusted response as zero consumption", () => {
    const empty = analysisFixture({
      usageKwh: 0,
      validIntervalCount: 0,
      expectedMeterIntervalCount: 672,
      coveragePct: 0,
      dailyRows: [],
    });

    expect(hasExplorerFacts(empty)).toBe(false);
    expect(explorerTrendSeries(empty)).toEqual([]);
  });

  it("uses server-provided daily totals for the selected Scope trend", () => {
    const analysis = analysisFixture({
      usageKwh: 30,
      validIntervalCount: 288,
      expectedMeterIntervalCount: 288,
      coveragePct: 100,
      dailyRows: [
        { localDate: "2026-06-14", usageKwh: 12, coveragePct: 100 },
        { localDate: "2026-06-15", usageKwh: null, coveragePct: 0 },
        { localDate: "2026-06-16", usageKwh: 18, coveragePct: 100 },
      ],
    });

    expect(explorerTrendSeries(analysis)).toEqual([
      { date: "2026-06-14", usageKwh: 12, coveragePct: 100 },
      { date: "2026-06-15", usageKwh: null, coveragePct: 0 },
      { date: "2026-06-16", usageKwh: 18, coveragePct: 100 },
    ]);

    analysis.calendarTotals = {
      metricId: "energy.total_usage_kwh@1",
      timezone: "Asia/Singapore",
      derivedFromQueryId: "daily_totals_v1",
      scopes: [{
        scopeId: "project",
        scopeName: "Ngee Ann Polytechnic",
        scopeType: "project",
        weeks: [{
          localFrom: "2026-06-14",
          localToInclusive: "2026-06-16",
          from: "2026-06-14T00:00:00.000Z",
          to: "2026-06-16T23:59:59.999Z",
          usageKwh: 30,
          isPartialCalendarPeriod: true,
          dataHealth: {
            status: "partial",
            coveragePct: 66.6667,
            expectedMeterIntervalCount: 288,
            validIntervalCount: 192,
            qualityEventCount: 0,
          },
        }],
        months: [],
      }],
    };
    expect(explorerTrendSeries(analysis, "weekly")).toEqual([{
      date: "2026-06-14",
      usageKwh: 30,
      coveragePct: 66.6667,
      isPartialCalendarPeriod: true,
    }]);
  });

  it("uses only complete selected-Scope buckets for its own average line", () => {
    expect(explorerSelectedPeriodAverage([
      { date: "2026-06-14", usageKwh: 12, coveragePct: 100 },
      { date: "2026-06-15", usageKwh: 999, coveragePct: 80 },
      { date: "2026-06-16", usageKwh: 18, coveragePct: 100 },
    ], "daily")).toBe(15);
    expect(explorerSelectedPeriodAverage([
      { date: "2026-06-01", usageKwh: 30, coveragePct: 100 },
    ], "weekly")).toBeNull();
  });

  it("summarises child Scope health without treating valid zero usage as missing", () => {
    const analysis = analysisFixture({
      usageKwh: 30,
      validIntervalCount: 288,
      expectedMeterIntervalCount: 288,
      coveragePct: 100,
      dailyRows: [],
    });
    analysis.childScopes = [
      childScope("healthy-zero", "Healthy zero", 0, 96, 100, 0),
      childScope("partial", "Partial", 12, 80, 83.33, 0),
      childScope("flagged", "Flagged", 9, 96, 100, 2),
      childScope("missing", "Missing", 0, 0, 0, 0),
    ];

    expect(explorerChildScopeHealth(analysis)).toMatchObject({
      total: 4,
      validated: 1,
      review: 2,
      unavailable: 1,
      needsAttention: 3,
      attention: [
        { nodeId: "missing", status: "unavailable" },
        { nodeId: "partial", status: "review" },
        { nodeId: "flagged", status: "review" },
      ],
    });
  });

  it("derives tree indicators from the published Snapshot result, not live connectivity", () => {
    const analysis = analysisFixture({
      usageKwh: 30,
      validIntervalCount: 288,
      expectedMeterIntervalCount: 288,
      coveragePct: 100,
      dailyRows: [],
    });
    analysis.childScopes = [
      childScope("healthy", "Healthy", 12, 96, 100, 0),
      childScope("partial", "Partial", 9, 80, 83.33, 0),
      childScope("missing", "Missing", 0, 0, 0, 0),
    ];

    expect(explorerSnapshotHealthMap(analysis)).toMatchObject({
      project: { status: "complete", label: "Complete Snapshot data" },
      healthy: { status: "complete" },
      partial: { status: "review" },
      missing: { status: "unavailable" },
    });
  });
});

function childScope(
  nodeId: string,
  name: string,
  usageKwh: number,
  validIntervalCount: number,
  coveragePct: number,
  qualityEventCount: number,
): EnergyScopeAnalysisDto["childScopes"][number] {
  return {
    nodeId,
    name,
    nodeType: "centre",
    usageKwh,
    sharePct: 0,
    dataHealth: {
      coveragePct,
      expectedMeterIntervalCount: 96,
      validIntervalCount,
      qualityEventCount,
    },
  };
}

function analysisFixture(input: {
  usageKwh: number;
  validIntervalCount: number;
  expectedMeterIntervalCount: number;
  coveragePct: number;
  dailyRows: Array<{ localDate: string; usageKwh: number | null; coveragePct: number }>;
}): EnergyScopeAnalysisDto {
  return {
    context: {
      userId: "dev-user",
      workspaceId: "default",
      projectId: "ngee-ann-polytechnic",
      projectName: "Ngee Ann Polytechnic",
      scopeId: "project",
      scopeName: "Ngee Ann Polytechnic",
      scopeType: "project",
      resource: "electricity",
      timezone: "Asia/Singapore",
      from: "2026-06-13T16:00:00.000Z",
      to: "2026-06-16T16:00:00.000Z",
      endExclusive: true,
      period: "Custom",
      hierarchyRevisionId: "hierarchy-v1",
      meterMappingRevisionId: "mapping-v1",
      meterFormulaRevisionId: "formula-v1",
      dataSnapshotId: "snapshot-v1",
      metricVersion: "metric-v1",
      businessCalendarVersion: "calendar-v1",
      tariffScheduleVersion: "tariff-v1",
      resolvedAt: "2026-06-17T00:00:00.000Z",
    },
    latestAcceptedReading: {
      status: "not_applicable",
      queryId: "latest_accepted_reading_v1",
      reason: {
        code: "LEAF_METER_REQUIRED",
        message: "Select a leaf Meter or Circuit to view its latest accepted cumulative reading.",
      },
    },
    summary: {
      usageKwh: input.usageKwh,
      averageDailyUsageKwh: input.usageKwh / Math.max(input.dailyRows.length, 1),
      peakKw: 5,
      validIntervalCount: input.validIntervalCount,
      qualityEventCount: 0,
    },
    hourlyProfile: [],
    comparison: {
      from: "2026-06-10T16:00:00.000Z",
      to: "2026-06-13T16:00:00.000Z",
      usageKwh: 20,
      changeKwh: 10,
      changePct: 50,
    },
    categories: [],
    childScopes: [],
    circuits: [],
    topCircuits: [],
    virtualMeters: [],
    dailyTotals: {
      metricId: "energy.total_usage_kwh@1",
      grain: "day",
      timezone: "Asia/Singapore",
      scopes: [{
        scopeId: "project",
        scopeName: "Ngee Ann Polytechnic",
        scopeType: "project",
        rows: input.dailyRows.map((row) => ({
          localDate: row.localDate,
          from: `${row.localDate}T00:00:00.000Z`,
          to: `${row.localDate}T23:59:59.999Z`,
          usageKwh: row.usageKwh,
          dataHealth: {
            status: row.usageKwh === null ? "unavailable" : "complete",
            coveragePct: row.coveragePct,
            expectedMeterIntervalCount: 96,
            validIntervalCount: row.usageKwh === null ? 0 : 96,
            qualityEventCount: 0,
          },
        })),
      }],
    },
    offHours: {
      status: "unavailable",
      reason: { code: "OPERATING_FACTS_UNAVAILABLE", message: "Unavailable" },
    },
    cost: {
      status: "unavailable",
      reason: { code: "COST_FACTS_UNAVAILABLE", message: "Unavailable" },
    },
    dataHealth: {
      status: input.validIntervalCount === 0 ? "unavailable" : "complete",
      coveragePct: input.coveragePct,
      expectedMeterIntervalCount: input.expectedMeterIntervalCount,
      validIntervalCount: input.validIntervalCount,
      qualityEventCount: 0,
      cumulativeDeltaMismatchCount: 0,
      averageKwMismatchCount: 0,
      invalidIntervalDurationCount: 0,
      importBatchIds: [],
    },
    units: {
      usage: "kWh",
      demand: "kW",
      intervalMinutes: 15,
      timezone: "Asia/Singapore",
    },
    attention: [],
    provenance: {
      dataSnapshotId: "snapshot-v1",
      hierarchyRevisionId: "hierarchy-v1",
      meterMappingRevisionId: "mapping-v1",
      meterFormulaRevisionId: "formula-v1",
      metricVersion: "metric-v1",
      ruleRevisionIds: [],
      aggregationRule: "designated_total",
      sourceView: "energy_facts",
      queryIds: ["scope_summary_v1", "daily_totals_v1", "hourly_profile_v1"],
    },
  };
}
