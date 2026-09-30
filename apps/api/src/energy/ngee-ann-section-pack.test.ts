import { describe, expect, it } from "vitest";

import type { ProjectAnalysisSnapshot } from "./project-analysis-resolver.js";
import {
  NGEE_ANN_CORE_AI_SECTION_IDS,
  NGEE_ANN_SECTION_IDS,
  assembleNgeeAnnSectionPacks,
} from "./ngee-ann-section-pack.js";

describe("assembleNgeeAnnSectionPacks", () => {
  it("projects the five Release-owned Ngee Ann domains without Preschool sections or prewritten conclusions", () => {
    const packs = assembleNgeeAnnSectionPacks(snapshot("snapshot-a", 9_736.42, 138.8));

    expect(Object.keys(packs)).toEqual(NGEE_ANN_SECTION_IDS);
    expect(Object.keys(packs)).toEqual([
      "trend-and-demand",
      "time-behaviour",
      "circuit-concentration",
      "decision-priorities",
      "school-holiday-comparison",
    ]);
    expect(JSON.stringify(packs)).not.toMatch(/centre-benchmark|standby-wastage|operating-behaviour|planning-outlook/u);
    expect(Object.values(packs).every((pack) => (
      pack.binding.dataSnapshotId === "snapshot-a"
      && pack.binding.projectReleaseId === "release-a"
      && pack.contract.revision === "ngee-ann-section-pack-v2"
      && pack.capabilities.tools.length === 0
    ))).toBe(true);
    expect(packs["trend-and-demand"].facts.summary).toMatchObject({ usageKwh: 9_736.42, peakKw: 138.8 });
    expect(packs["time-behaviour"].facts.timeBehaviour).toMatchObject({ metricId: "energy.total_usage_kwh@1" });
    expect(packs["circuit-concentration"].facts.circuits).toHaveLength(6);
    expect(packs["decision-priorities"].facts.decisionPriorities).toMatchObject({ status: "available" });
    expect(packs["school-holiday-comparison"].facts.schoolHolidayComparison).toMatchObject({
      status: "unavailable",
      reason: { code: "FACT_COVERAGE_INCOMPLETE" },
    });
    expect(packs["trend-and-demand"].reportTime).toEqual({
      timezone: "Asia/Singapore",
      analysisWindow: {
        fromLocalDate: "2026-05-20",
        toExclusiveLocalDate: "2026-06-17",
        inclusiveToLocalDate: "2026-06-16",
        displayLabel: "20 May 2026–16 Jun 2026",
      },
    });
    expect(packs["trend-and-demand"].binding.analysisPeriod).toEqual({
      from: "2026-05-19T16:00:00.000Z",
      to: "2026-06-16T16:00:00.000Z",
    });
    expect(packs["school-holiday-comparison"].binding.analysisPeriod).toEqual({
      from: "2026-05-19T16:00:00.000Z",
      to: "2026-06-16T16:00:00.000Z",
    });
    expect(packs["school-holiday-comparison"].reportTime.analysisWindow).toEqual({
      fromLocalDate: "2026-05-20",
      toExclusiveLocalDate: "2026-06-17",
      inclusiveToLocalDate: "2026-06-16",
      displayLabel: "20 May 2026–16 Jun 2026",
    });
    expect(packs["school-holiday-comparison"].facts.schoolHolidayComparison).toMatchObject({
      identity: { period: { from: "2026-02-17", toExclusive: "2026-06-17" } },
    });
    expect(JSON.stringify(packs)).not.toContain("Centre G");
    expect(JSON.stringify(packs)).not.toContain("check the heater first");
  });

  it("rebuilds every pack from Snapshot B instead of retaining Snapshot A facts", () => {
    const packA = assembleNgeeAnnSectionPacks(snapshot("snapshot-a", 9_736.42, 138.8));
    const packB = assembleNgeeAnnSectionPacks(snapshot("snapshot-b", 10_812.5, 151.2));

    expect(packB["trend-and-demand"].binding.dataSnapshotId).toBe("snapshot-b");
    expect(packB["trend-and-demand"].facts.summary).toMatchObject({ usageKwh: 10_812.5, peakKw: 151.2 });
    expect(JSON.stringify(packB)).not.toContain("snapshot-a");
    expect(JSON.stringify(packB)).not.toContain("9736.42");
    expect(packA["trend-and-demand"].facts.summary?.usageKwh).toBe(9_736.42);
  });

  it("keeps complete Level and Circuit evidence instead of applying a hidden Top-N cut", () => {
    const source = snapshot("snapshot-many", 12_000, 160);
    source.analysis.childScopes = Array.from({ length: 14 }, (_, index) => ({
      nodeId: `level-${index + 1}`,
      name: `Level ${index + 1}`,
      nodeType: "level",
      usageKwh: 500 + index,
      sharePct: 5,
      comparison: { usageKwh: 450, changeKwh: 50 + index, changePct: 10 },
      dataHealth: { coveragePct: 100, expectedMeterIntervalCount: 1, validIntervalCount: 1, qualityEventCount: 0 },
      metadata: {} as never,
    }));
    source.analysis.circuits = Array.from({ length: 48 }, (_, index) => circuit(index));
    source.analysis.topCircuits = source.analysis.circuits.slice(0, 5);

    const pack = assembleNgeeAnnSectionPacks(source)["circuit-concentration"];

    expect(pack.facts.levels).toHaveLength(14);
    expect(pack.facts.circuits).toHaveLength(48);
    expect(pack.facts.topCircuits).toHaveLength(5);
  });

  it("fails closed for a Snapshot owned by another renderer", () => {
    const source = snapshot("snapshot-wrong-renderer", 12_000, 160);
    source.renderer = { ...source.renderer, key: "preschool-overview" };

    expect(() => assembleNgeeAnnSectionPacks(source))
      .toThrow("ENERGYIQ_NGEE_ANN_SECTION_PACK_RENDERER_REQUIRED");
  });

  it("constructs only the exact historical four-section Release without requiring Holiday facts", () => {
    const source = snapshot("snapshot-history", 12_000, 160);
    source.reportTimeContext = {
      ...source.reportTimeContext!,
      windows: source.reportTimeContext!.windows.filter(({ windowId }) => (
        windowId !== "school-holiday-comparison"
      )),
    };

    const packs = assembleNgeeAnnSectionPacks(source, NGEE_ANN_CORE_AI_SECTION_IDS);

    expect(Object.keys(packs)).toEqual(NGEE_ANN_CORE_AI_SECTION_IDS);
    expect(packs).not.toHaveProperty("school-holiday-comparison");
  });

  it("distinguishes an honest empty priority set from unavailable Evidence", () => {
    const source = snapshot("snapshot-statuses", 12_000, 160);
    source.decisionPriorities = {
      status: "empty",
      limitation: null,
      evidencePins: {} as never,
      items: [],
    };
    source.analysis.peakBreakdown = {
      status: "unavailable",
      reason: { code: "PEAK_INTERVAL_FACTS_UNAVAILABLE", message: "Peak facts unavailable." },
    };

    const packs = assembleNgeeAnnSectionPacks(source);

    expect(packs["decision-priorities"].limitations)
      .not.toContain("The deterministic decision-priority projection is unavailable for this Snapshot.");
    expect(packs["trend-and-demand"].missingEvidence)
      .toContain("Peak-interval contributor evidence is unavailable.");
  });
});

const snapshot = (
  dataSnapshotId: string,
  usageKwh: number,
  peakKw: number,
): ProjectAnalysisSnapshot => ({
  context: {
    workspaceId: "workspace-ngee",
    projectId: "ngee-ann-polytechnic",
    scopeId: "ngee-ann-polytechnic",
    primaryPeriod: { start: "2026-05-19T16:00:00.000Z", endExclusive: "2026-06-16T16:00:00.000Z" },
    timezone: "Asia/Singapore",
  } as ProjectAnalysisSnapshot["context"],
  projectRelease: { id: "release-a" } as ProjectAnalysisSnapshot["projectRelease"],
  recipe: { id: "energy-scope-analysis", version: "1" },
  renderer: { key: "ngee-ann-overview", version: "1", contractVersion: "project-analysis-snapshot@1" },
  dataQuality: { status: "complete", coveragePct: 100, expectedMeterIntervalCount: 100, validIntervalCount: 100, qualityEventCount: 0, cumulativeDeltaMismatchCount: 0, averageKwMismatchCount: 0, invalidIntervalDurationCount: 0, importBatchIds: ["batch-a"] },
  evidence: [
    { id: `evidence:${dataSnapshotId}:summary`, metricId: "energy.total_usage_kwh@1", queryIds: ["scope_summary_v1"] },
    { id: `evidence:${dataSnapshotId}:time`, metricId: "energy.total_usage_kwh@1", queryIds: ["time_bucket_grid_v1"] },
    { id: `evidence:${dataSnapshotId}:circuits`, metricId: "energy.total_usage_kwh@1", queryIds: ["meter_breakdown_v1"] },
  ],
  findings: [],
  schoolHolidayComparison: {
    status: "unavailable",
    contract: "energyiq-school-holiday-comparison@1",
    identity: {
      projectId: "ngee-ann-polytechnic",
      scopeId: "ngee-ann-polytechnic",
      dataSnapshotId,
      projectReleaseId: "release-a",
      comparisonWindowId: "school-holiday-comparison",
      reportTimePolicyRevision: "ngee-ann-report-time@2",
      period: { from: "2026-02-17", toExclusive: "2026-06-17" },
      businessCalendarVersion: "sg-calendar-holiday-v2",
      ruleRevision: "comparison.school_holiday_context@1",
    },
    reason: { code: "FACT_COVERAGE_INCOMPLETE", message: "Holiday facts are incomplete." },
  },
  decisionPriorities: {
    status: "available",
    limitation: null,
    evidencePins: {} as never,
    items: [],
  },
  dataSnapshot: { id: dataSnapshotId, importBatchIds: ["batch-a"], lastSeenAt: "2026-06-16T15:30:00.000Z" },
  reportTimeContext: {
    contractRevision: "energyiq-report-time-context@1",
    binding: {
      workspaceId: "workspace-ngee",
      projectId: "ngee-ann-polytechnic",
      scopeId: "ngee-ann-polytechnic",
      resource: "electricity",
      dataSnapshotId,
      projectReleaseId: "release-a",
    },
    timezone: "Asia/Singapore",
    asOf: "2026-06-16T16:00:00.000Z",
    acceptedDataEndExclusive: "2026-06-16T16:00:00.000Z",
    dataThroughLocalDate: "2026-06-16",
    lastRefreshedAt: "2026-06-16T16:00:00.000Z",
    policyId: "ngee-ann-report-time",
    policyRevision: "2",
    windows: [{
      windowId: "current-month-progress",
      role: "primary",
      label: "Current month",
      strategy: { kind: "calendar_month_to_date" },
      phase: "partial",
      from: "2026-05-31T16:00:00.000Z",
      toExclusive: "2026-06-16T16:00:00.000Z",
      completeDayCount: 16,
      segments: [{ from: "2026-05-31T16:00:00.000Z", toExclusive: "2026-06-16T16:00:00.000Z" }],
      comparisonCompatibilityKey: "current-month-progress",
    }, {
      windowId: "school-holiday-comparison",
      role: "comparison",
      label: "School Holiday comparison",
      strategy: { kind: "rolling_complete_days", days: 120 },
      phase: "complete",
      from: "2026-02-16T16:00:00.000Z",
      toExclusive: "2026-06-16T16:00:00.000Z",
      completeDayCount: 120,
      segments: [{ from: "2026-02-16T16:00:00.000Z", toExclusive: "2026-06-16T16:00:00.000Z" }],
      comparisonCompatibilityKey: "school-holiday-comparison",
    }],
  },
  metadata: {
    status: "missing",
    hierarchyRevisionId: "hierarchy-a",
    timezone: "Asia/Singapore",
    period: { start: "2026-05-19T16:00:00.000Z", endExclusive: "2026-06-16T16:00:00.000Z" },
  } as ProjectAnalysisSnapshot["metadata"],
  analysis: {
    context: {} as never,
    latestAcceptedReading: { status: "not_applicable", queryId: "latest_accepted_reading_v1", reason: { code: "INTERVAL_USAGE_SOURCE", message: "Interval source" } },
    summary: {
      usageKwh,
      averageDailyUsageKwh: usageKwh / 28,
      peakKw,
      peakAt: "2026-06-05T06:15:00.000Z",
      validIntervalCount: 100,
      qualityEventCount: 0,
    },
    hourlyProfile: [{ hour: 9, usageKwh: 100, averageKw: 12, peakKw: 18, observationCount: 28 }],
    dailyTotals: { metricId: "energy.total_usage_kwh@1", grain: "day", timezone: "Asia/Singapore", scopes: [] },
    timeBehaviour: { metricId: "energy.total_usage_kwh@1", grain: "hour", unit: "kWh", timezone: "Asia/Singapore", queryId: "time_bucket_grid_v1", scopes: [], dayProfiles: [] },
    componentHourlyProfiles: { metricId: "energy.total_usage_kwh@1", queryId: "component_hourly_profiles_v1", accountingBasis: "published_component_circuits", grain: "hour", unit: "kWh", timezone: "Asia/Singapore", scopes: [] },
    comparison: { from: "2026-04-21T16:00:00.000Z", to: "2026-05-19T16:00:00.000Z", usageKwh: usageKwh - 500, changeKwh: 500, changePct: 5 },
    categories: [],
    childScopes: [],
    circuits: Array.from({ length: 6 }, (_, index) => circuit(index)),
    topCircuits: [],
    designatedTotals: [],
    componentReconciliation: { officialUsageKwh: usageKwh, componentUsageKwh: usageKwh - 100, gapKwh: 100, ratioPct: 98.97, officialMeterNodeIds: ["official"], componentMeterNodeIds: ["circuit-1"] },
    virtualMeters: [],
    offHours: { status: "unavailable", reason: { code: "OPERATING_CALENDAR_VERSION_MISSING", message: "Calendar unavailable" } },
    cost: { status: "unavailable", reason: { code: "TARIFF_VERSION_MISSING", message: "Tariff unavailable" } },
    dataHealth: { status: "complete", coveragePct: 100, expectedMeterIntervalCount: 100, validIntervalCount: 100, qualityEventCount: 0, cumulativeDeltaMismatchCount: 0, averageKwMismatchCount: 0, invalidIntervalDurationCount: 0, importBatchIds: ["batch-a"] },
    units: { usage: "kWh", demand: "kW", intervalMinutes: 30, timezone: "Asia/Singapore" },
    attention: [],
    provenance: { dataSnapshotId, hierarchyRevisionId: "hierarchy-a", meterMappingRevisionId: "mapping-a", meterFormulaRevisionId: "formula-a", metricVersion: "metrics-a", ruleRevisionIds: [], aggregationRule: "designated_total", sourceView: "facts", queryIds: ["scope_summary_v1", "time_bucket_grid_v1", "meter_breakdown_v1"] },
    metadata: {} as never,
  },
});

const circuit = (index: number) => ({
  meterNodeId: `circuit-${index + 1}`,
  scopeId: `level-${(index % 4) + 1}`,
  name: `Circuit ${index + 1}`,
  appliance: "Load",
  category: "Load",
  meterRole: "component",
  includedInOfficialTotal: false,
  usageKwh: 100 + index,
  sharePct: 1,
  comparison: { usageKwh: 90, changeKwh: 10 + index, changePct: 10 },
  dataHealth: { coveragePct: 100, expectedMeterIntervalCount: 1, validIntervalCount: 1, qualityEventCount: 0 },
  peakKw: 10,
  qualityEventCount: 0,
});
