import { describe, expect, it } from "vitest";

import { ngeeAnnGoldenSnapshot, ngeeAnnSingleDaySnapshot } from "./ngee-ann-overview.test-fixture";
import { buildNgeeAnnOverviewViewModel } from "./ngee-ann-overview-view-model";

type GoldenSnapshot = ReturnType<typeof ngeeAnnGoldenSnapshot>;
type AvailableDailyAnomalies = Extract<
  NonNullable<GoldenSnapshot["analysis"]["dailyUsageAnomalies"]>,
  { status: "available" }
>;

function dailyAnomalyBundle(snapshot: GoldenSnapshot): AvailableDailyAnomalies {
  const bundle = snapshot.analysis.dailyUsageAnomalies;
  if (bundle?.status !== "available") throw new Error("Expected the Golden daily anomaly bundle.");
  return bundle;
}

type DailyAnomalyRow = AvailableDailyAnomalies["scopes"][number]["rows"][number];

function makeWithinThreshold(row: DailyAnomalyRow): void {
  if (row.outcome !== "triggered" || row.actualKwh === null) return;
  row.outcome = "within_threshold";
  row.baselineKwh = row.actualKwh;
  row.impactKwh = 0;
  row.relativePct = 0;
}

const rollingBoundaryTamperCases: Array<{
  name: string;
  mutate: (snapshot: GoldenSnapshot) => void;
}> = [
  {
    name: "rolling_7d cutoff",
    mutate: (snapshot) => {
      const comparison = dailyAnomalyBundle(snapshot).scopes[0]!.rollingComparisons[0]!;
      comparison.cutoffLocalDate = "2026-06-15";
    },
  },
  {
    name: "rolling_7d current period",
    mutate: (snapshot) => {
      const comparison = dailyAnomalyBundle(snapshot).scopes[0]!.rollingComparisons[0]!;
      comparison.current.fromLocalDate = "2026-06-09";
      snapshot.decisionPriorities!.items[0]!.horizons[1]!.period.fromLocalDate = "2026-06-09";
    },
  },
  {
    name: "rolling_7d baseline period",
    mutate: (snapshot) => {
      const comparison = dailyAnomalyBundle(snapshot).scopes[0]!.rollingComparisons[0]!;
      comparison.baseline.toLocalDate = "2026-06-08";
    },
  },
  {
    name: "rolling_28d cutoff",
    mutate: (snapshot) => {
      const comparison = dailyAnomalyBundle(snapshot).scopes[0]!.rollingComparisons[1]!;
      comparison.cutoffLocalDate = "2026-06-15";
    },
  },
  {
    name: "rolling_28d current period",
    mutate: (snapshot) => {
      const comparison = dailyAnomalyBundle(snapshot).scopes[0]!.rollingComparisons[1]!;
      comparison.current.fromLocalDate = "2026-05-19";
      snapshot.decisionPriorities!.items[0]!.horizons[2]!.period.fromLocalDate = "2026-05-19";
    },
  },
  {
    name: "rolling_28d baseline period",
    mutate: (snapshot) => {
      const comparison = dailyAnomalyBundle(snapshot).scopes[0]!.rollingComparisons[1]!;
      comparison.baseline.toLocalDate = "2026-05-18";
    },
  },
];

const peakEvidencePinMismatchCases: Array<{
  name: string;
  mutate: (snapshot: GoldenSnapshot) => void;
}> = [
  {
    name: "Context Release",
    mutate: (snapshot) => { snapshot.context.projectReleaseId = "release-mismatch"; },
  },
  {
    name: "Context Project",
    mutate: (snapshot) => { snapshot.context.projectId = "project-mismatch"; },
  },
  {
    name: "Analysis Context Project",
    mutate: (snapshot) => { snapshot.analysis.context.projectId = "project-mismatch"; },
  },
  {
    name: "provenance Snapshot",
    mutate: (snapshot) => { snapshot.analysis.provenance.dataSnapshotId = "snapshot-mismatch"; },
  },
  {
    name: "Context Snapshot",
    mutate: (snapshot) => { snapshot.context.dataSnapshotId = "snapshot-mismatch"; },
  },
  {
    name: "Analysis Context Snapshot",
    mutate: (snapshot) => { snapshot.analysis.context.dataSnapshotId = "snapshot-mismatch"; },
  },
  {
    name: "provenance Hierarchy",
    mutate: (snapshot) => { snapshot.analysis.provenance.hierarchyRevisionId = "hierarchy-mismatch"; },
  },
  {
    name: "Context Hierarchy",
    mutate: (snapshot) => { snapshot.context.hierarchyRevisionId = "hierarchy-mismatch"; },
  },
  {
    name: "Analysis Context Hierarchy",
    mutate: (snapshot) => { snapshot.analysis.context.hierarchyRevisionId = "hierarchy-mismatch"; },
  },
  {
    name: "provenance Mapping",
    mutate: (snapshot) => { snapshot.analysis.provenance.meterMappingRevisionId = "mapping-mismatch"; },
  },
  {
    name: "Context Mapping",
    mutate: (snapshot) => { snapshot.context.meterMappingRevisionId = "mapping-mismatch"; },
  },
  {
    name: "Analysis Context Mapping",
    mutate: (snapshot) => { snapshot.analysis.context.meterMappingRevisionId = "mapping-mismatch"; },
  },
  {
    name: "provenance Formula",
    mutate: (snapshot) => { snapshot.analysis.provenance.meterFormulaRevisionId = "formula-mismatch"; },
  },
  {
    name: "Context Formula",
    mutate: (snapshot) => { snapshot.context.meterFormulaRevisionId = "formula-mismatch"; },
  },
  {
    name: "Analysis Context Formula",
    mutate: (snapshot) => { snapshot.analysis.context.meterFormulaRevisionId = "formula-mismatch"; },
  },
  {
    name: "Release Peak Metric",
    mutate: (snapshot) => {
      snapshot.projectRelease.metricRevisionIds = snapshot.projectRelease.metricRevisionIds
        .filter((metricId) => metricId !== "energy.peak_demand_kw@1");
    },
  },
  {
    name: "Peak Evidence Metric",
    mutate: (snapshot) => {
      snapshot.evidence = snapshot.evidence
        .filter((reference) => reference.metricId !== "energy.peak_demand_kw@1");
    },
  },
  {
    name: "Peak Evidence Query",
    mutate: (snapshot) => {
      const reference = snapshot.evidence
        .find((candidate) => candidate.metricId === "energy.peak_demand_kw@1")!;
      reference.queryIds = reference.queryIds.filter((queryId) => queryId !== "peak_breakdown_v1");
    },
  },
];

const timeEvidencePinMismatchCases: Array<{
  name: string;
  mutate: (snapshot: GoldenSnapshot) => void;
}> = [
  ...peakEvidencePinMismatchCases.slice(0, 15),
  {
    name: "Release ID",
    mutate: (snapshot) => { snapshot.projectRelease.id = "release-mismatch"; },
  },
  {
    name: "Release Usage Metric",
    mutate: (snapshot) => {
      snapshot.projectRelease.metricRevisionIds = snapshot.projectRelease.metricRevisionIds
        .filter((metricId) => metricId !== "energy.total_usage_kwh@1");
    },
  },
  {
    name: "Usage Evidence Metric",
    mutate: (snapshot) => {
      snapshot.evidence = snapshot.evidence
        .filter((reference) => reference.metricId !== "energy.total_usage_kwh@1");
    },
  },
  {
    name: "Usage Evidence Query",
    mutate: (snapshot) => {
      const reference = snapshot.evidence
        .find((candidate) => candidate.metricId === "energy.total_usage_kwh@1")!;
      reference.queryIds = reference.queryIds.filter((queryId) => queryId !== "time_bucket_grid_v1");
    },
  },
];

const anomalyEvidencePinMismatchCases: Array<{
  name: string;
  mutate: (snapshot: GoldenSnapshot) => void;
}> = [
  ...peakEvidencePinMismatchCases.slice(0, 15),
  {
    name: "Bundle Snapshot",
    mutate: (snapshot) => { dailyAnomalyBundle(snapshot).evidencePins.dataSnapshotId = "snapshot-mismatch"; },
  },
  {
    name: "Bundle Project Release",
    mutate: (snapshot) => { dailyAnomalyBundle(snapshot).evidencePins.projectReleaseId = "release-mismatch"; },
  },
  {
    name: "Bundle Hierarchy",
    mutate: (snapshot) => { dailyAnomalyBundle(snapshot).evidencePins.hierarchyRevisionId = "hierarchy-mismatch"; },
  },
  {
    name: "Bundle Mapping",
    mutate: (snapshot) => { dailyAnomalyBundle(snapshot).evidencePins.meterMappingRevisionId = "mapping-mismatch"; },
  },
  {
    name: "Bundle Formula",
    mutate: (snapshot) => { dailyAnomalyBundle(snapshot).evidencePins.meterFormulaRevisionId = "formula-mismatch"; },
  },
  {
    name: "Bundle Metric Version",
    mutate: (snapshot) => { dailyAnomalyBundle(snapshot).evidencePins.metricVersion = "metric-mismatch"; },
  },
  {
    name: "Context Metric Version",
    mutate: (snapshot) => { snapshot.context.metricVersion = "metric-mismatch"; },
  },
  {
    name: "Analysis Context Metric Version",
    mutate: (snapshot) => { snapshot.analysis.context.metricVersion = "metric-mismatch"; },
  },
  {
    name: "Release Usage Metric",
    mutate: (snapshot) => {
      snapshot.projectRelease.metricRevisionIds = snapshot.projectRelease.metricRevisionIds
        .filter((metricId) => metricId !== "energy.total_usage_kwh@1");
    },
  },
  {
    name: "Release Rule",
    mutate: (snapshot) => {
      snapshot.projectRelease.ruleRevisionIds = snapshot.projectRelease.ruleRevisionIds
        .filter((ruleId) => ruleId !== dailyAnomalyBundle(snapshot).ruleRevisionId);
    },
  },
  {
    name: "Analysis Rule",
    mutate: (snapshot) => {
      snapshot.analysis.provenance.ruleRevisionIds = snapshot.analysis.provenance.ruleRevisionIds
        .filter((ruleId) => ruleId !== dailyAnomalyBundle(snapshot).ruleRevisionId);
    },
  },
  {
    name: "Bundle Query",
    mutate: (snapshot) => {
      dailyAnomalyBundle(snapshot).evidencePins.queryIds = ["wrong-query" as "time_slot_anomaly_v1"];
    },
  },
  {
    name: "Analysis Query",
    mutate: (snapshot) => {
      snapshot.analysis.provenance.queryIds = snapshot.analysis.provenance.queryIds
        .filter((queryId) => queryId !== "time_slot_anomaly_v1");
    },
  },
  {
    name: "Usage Evidence Query",
    mutate: (snapshot) => {
      const reference = snapshot.evidence
        .find((candidate) => candidate.metricId === "energy.total_usage_kwh@1")!;
      reference.queryIds = reference.queryIds.filter((queryId) => queryId !== "time_slot_anomaly_v1");
    },
  },
  {
    name: "Snapshot Context Calendar",
    mutate: (snapshot) => { snapshot.context.businessCalendarVersion = "calendar-mismatch"; },
  },
  {
    name: "Analysis Context Calendar",
    mutate: (snapshot) => { snapshot.analysis.context.businessCalendarVersion = "calendar-mismatch"; },
  },
  {
    name: "Release Calendar",
    mutate: (snapshot) => { snapshot.projectRelease.businessCalendarVersion = "calendar-mismatch"; },
  },
  {
    name: "Bundle Calendar",
    mutate: (snapshot) => { dailyAnomalyBundle(snapshot).evidencePins.businessCalendarVersion = "calendar-mismatch"; },
  },
];

const anomalyStrictRuleMismatchCases: Array<{
  name: string;
  mutate: (bundle: AvailableDailyAnomalies) => void;
}> = [
  {
    name: "Rule Revision",
    mutate: (bundle) => { bundle.ruleRevisionId = "comparison.daily_usage_above_baseline@2"; },
  },
  {
    name: "20 percent relative threshold",
    mutate: (bundle) => { bundle.rule.relativeThresholdPct = 21; },
  },
  {
    name: "20 kWh absolute impact",
    mutate: (bundle) => { bundle.rule.absoluteImpactKwh = 21; },
  },
  {
    name: "95 percent coverage",
    mutate: (bundle) => { bundle.rule.minimumCoveragePct = 94; },
  },
  {
    name: "4 comparable samples",
    mutate: (bundle) => { bundle.rule.minimumSampleCount = 3; },
  },
  {
    name: "zero quality events",
    mutate: (bundle) => { bundle.rule.maximumQualityEventCount = 1; },
  },
  {
    name: "60-day lookback",
    mutate: (bundle) => { bundle.rule.maximumLookbackDays = 61; },
  },
  {
    name: "above direction",
    mutate: (bundle) => { (bundle.rule as { direction: string }).direction = "below"; },
  },
  {
    name: "hourly comparable-day baseline method",
    mutate: (bundle) => {
      (bundle.rule as { baselineMethod: string }).baselineMethod = "median_of_days";
    },
  },
  {
    name: "Primary Period local-date cutoff",
    mutate: (bundle) => { bundle.baselineCutoff = "2026-06-09"; },
  },
];

describe("Ngee Ann Overview ViewModel", () => {
  it("separates the current month, fair same-progress comparison and completed-month context", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    snapshot.context.primaryPeriod = {
      start: "2026-05-31T16:00:00.000Z",
      endExclusive: "2026-06-16T16:00:00.000Z",
    };
    snapshot.context.from = snapshot.context.primaryPeriod.start;
    snapshot.context.to = snapshot.context.primaryPeriod.endExclusive;
    snapshot.analysis.summary.usageKwh = 480;
    snapshot.analysis.summary.averageDailyUsageKwh = 30;
    snapshot.reportTimeContext = {
      contractRevision: "energyiq-report-time-context@1",
      binding: {
        workspaceId: snapshot.context.workspaceId,
        projectId: snapshot.context.projectId,
        scopeId: snapshot.context.scopeId,
        resource: "electricity",
        dataSnapshotId: snapshot.dataSnapshot.id,
        projectReleaseId: snapshot.projectRelease.id,
      },
      timezone: "Asia/Singapore",
      asOf: "2026-06-17T01:00:00.000Z",
      acceptedDataEndExclusive: snapshot.context.primaryPeriod.endExclusive,
      dataThroughLocalDate: "2026-06-16",
      lastRefreshedAt: "2026-06-17T01:00:00.000Z",
      policyId: "ngee-ann-report-time",
      policyRevision: "1",
      windows: [{
        windowId: "current-month-progress",
        role: "current_progress",
        label: "Current month to date",
        strategy: { kind: "calendar_month_to_date" },
        phase: "partial",
        from: snapshot.context.primaryPeriod.start,
        toExclusive: snapshot.context.primaryPeriod.endExclusive,
        completeDayCount: 16,
        segments: [{
          from: snapshot.context.primaryPeriod.start,
          toExclusive: snapshot.context.primaryPeriod.endExclusive,
        }],
        comparisonCompatibilityKey: "current-month-progress",
      }],
    };
    snapshot.reportWindowSegmentSummaries = [{
      windowId: "completed-month-trend",
      status: "ready",
      segments: [{
        period: { start: "2026-02-28T16:00:00.000Z", endExclusive: "2026-03-31T16:00:00.000Z" },
        dataStatus: "unavailable",
        expectedDayCount: 31,
        completeDayCount: 0,
        summary: null,
        evidence: { dataSnapshotId: snapshot.dataSnapshot.id, queryId: "daily_totals_v1" },
      }, {
        period: { start: "2026-03-31T16:00:00.000Z", endExclusive: "2026-04-30T16:00:00.000Z" },
        dataStatus: "partial",
        expectedDayCount: 30,
        completeDayCount: 10,
        summary: null,
        evidence: { dataSnapshotId: snapshot.dataSnapshot.id, queryId: "daily_totals_v1" },
      }, {
        period: { start: "2026-04-30T16:00:00.000Z", endExclusive: "2026-05-31T16:00:00.000Z" },
        dataStatus: "complete",
        expectedDayCount: 31,
        completeDayCount: 31,
        summary: { usageKwh: 900, averageDailyUsageKwh: 29.0323 },
        evidence: { dataSnapshotId: snapshot.dataSnapshot.id, queryId: "daily_totals_v1" },
      }],
    }, {
      windowId: "same-progress-comparison",
      status: "ready",
      segments: [{
        period: { start: "2026-03-31T16:00:00.000Z", endExclusive: "2026-04-16T16:00:00.000Z" },
        dataStatus: "partial",
        expectedDayCount: 16,
        completeDayCount: 10,
        summary: null,
        evidence: { dataSnapshotId: snapshot.dataSnapshot.id, queryId: "daily_totals_v1" },
      }, {
        period: { start: "2026-04-30T16:00:00.000Z", endExclusive: "2026-05-16T16:00:00.000Z" },
        dataStatus: "complete",
        expectedDayCount: 16,
        completeDayCount: 16,
        summary: { usageKwh: 400, averageDailyUsageKwh: 25 },
        evidence: { dataSnapshotId: snapshot.dataSnapshot.id, queryId: "daily_totals_v1" },
      }],
    }];

    const view = buildNgeeAnnOverviewViewModel(snapshot);

    expect(view.monthlyContext.current).toMatchObject({
      label: "Jun 2026",
      phase: "partial",
      completeDayCount: 16,
      usageKwh: "480",
      averageDailyUsageKwh: "30",
    });
    expect(view.monthlyContext.sameProgress).toMatchObject({
      status: "available",
      referenceLabel: "May 2026 · first 16 days",
      deltaKwh: "80",
      deltaPct: "+20%",
    });
    expect(view.monthlyContext.sameProgress.headline).toContain("20% more than May 2026 at the same 16-day progress");
    expect(view.monthlyContext.completedMonths.rows).toEqual([
      expect.objectContaining({ label: "Mar 2026", dataStatus: "unavailable", usageKwh: null }),
      expect.objectContaining({ label: "Apr 2026", dataStatus: "partial", usageKwh: null }),
      expect.objectContaining({ label: "May 2026", dataStatus: "complete", usageKwh: "900" }),
    ]);
  });

  it("does not relabel a shorter primary analysis as current-month usage when the month projection is missing", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    snapshot.reportTimeContext = {
      contractRevision: "energyiq-report-time-context@1",
      binding: {
        workspaceId: snapshot.context.workspaceId,
        projectId: snapshot.context.projectId,
        scopeId: snapshot.context.scopeId,
        resource: "electricity",
        dataSnapshotId: snapshot.dataSnapshot.id,
        projectReleaseId: snapshot.projectRelease.id,
      },
      timezone: snapshot.context.timezone,
      asOf: "2026-06-17T01:00:00.000Z",
      acceptedDataEndExclusive: snapshot.context.primaryPeriod.endExclusive,
      dataThroughLocalDate: "2026-06-16",
      lastRefreshedAt: "2026-06-17T01:00:00.000Z",
      policyId: "ngee-ann-report-time",
      policyRevision: "1",
      windows: [{
        windowId: "current-month-progress",
        role: "current_progress",
        label: "Current month to date",
        strategy: { kind: "calendar_month_to_date" },
        phase: "partial",
        from: "2026-05-31T16:00:00.000Z",
        toExclusive: snapshot.context.primaryPeriod.endExclusive,
        completeDayCount: 16,
        segments: [{
          from: "2026-05-31T16:00:00.000Z",
          toExclusive: snapshot.context.primaryPeriod.endExclusive,
        }],
        comparisonCompatibilityKey: "current-month-progress",
      }],
    };

    const view = buildNgeeAnnOverviewViewModel(snapshot);

    expect(view.monthlyContext.status).toBe("unavailable");
    expect(view.monthlyContext.current.usageKwh).toBeNull();
    expect(view.monthlyContext.sameProgress.status).toBe("unavailable");
  });

  it("uses the bounded recent-operations window for operational time and Circuit blocks", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    const recentDailyTotals = structuredClone(snapshot.analysis.dailyTotals!);
    for (const scope of recentDailyTotals.scopes) {
      scope.rows = scope.rows.slice(-3);
    }
    const recentTimeBehaviour = structuredClone(snapshot.analysis.timeBehaviour!);
    for (const scope of recentTimeBehaviour.scopes) {
      scope.cells = scope.cells.slice(-72);
    }
    const recentProjectWeekday = recentTimeBehaviour.dayProfiles.find((profile) => (
      profile.scopeId === snapshot.context.scopeId
      && profile.dayType === "weekday"
      && profile.status === "available"
    ));
    if (!recentProjectWeekday || recentProjectWeekday.status !== "available") {
      throw new Error("Expected the recent Project weekday profile.");
    }
    recentProjectWeekday.values[0]!.usageKwh = 99;
    const referenceTimeBehaviour = structuredClone(recentTimeBehaviour);
    for (const scope of referenceTimeBehaviour.scopes) scope.cells = [];
    const referenceProjectHoliday = referenceTimeBehaviour.dayProfiles.find((profile) => (
      profile.scopeId === snapshot.context.scopeId
      && profile.dayType === "public_holiday"
    ));
    if (!referenceProjectHoliday) throw new Error("Expected the reference Project holiday profile.");
    Object.assign(referenceProjectHoliday, {
      status: "available" as const,
      sampleDayCount: 2,
      values: recentProjectWeekday.values.map((value) => ({ ...value, usageKwh: value.usageKwh + 5 })),
    });
    const recentUsageKwh = recentDailyTotals.scopes[0]!.rows
      .reduce((sum, row) => sum + (row.usageKwh ?? 0), 0);
    const recentStandbyKwh = 80;
    const recentComposition = {
      provenance: structuredClone(snapshot.analysis.provenance),
      comparison: structuredClone(snapshot.analysis.comparison),
      categories: structuredClone(snapshot.analysis.categories),
      childScopes: structuredClone(snapshot.analysis.childScopes),
      circuits: structuredClone(snapshot.analysis.circuits),
      designatedTotals: structuredClone(snapshot.analysis.designatedTotals),
      componentReconciliation: structuredClone(snapshot.analysis.componentReconciliation),
      virtualMeterTraces: structuredClone(snapshot.analysis.virtualMeterTraces),
    };
    const recentCircuit = recentComposition.circuits.find((circuit) => (
      circuit.includedInOfficialTotal === false
    ));
    if (!recentCircuit) throw new Error("Expected a recent component Circuit.");
    recentCircuit.usageKwh = 432.1;
    recentCircuit.sharePct = 12.3;
    snapshot.reportWindowAnalyses = [{
      windowId: "recent-operations",
      period: {
        start: "2026-06-13T16:00:00.000Z",
        endExclusive: "2026-06-16T16:00:00.000Z",
      },
      status: "ready",
      analysis: Object.assign({ dailyTotals: recentDailyTotals }, {
        summary: { ...snapshot.analysis.summary, usageKwh: recentUsageKwh },
        offHours: {
          status: "available" as const,
          operatingKwh: recentUsageKwh - recentStandbyKwh,
          standbyKwh: recentStandbyKwh,
          usageKwh: recentStandbyKwh,
          sharePct: recentStandbyKwh / recentUsageKwh * 100,
          timezone: snapshot.context.timezone,
          businessCalendarVersion: snapshot.context.businessCalendarVersion,
        },
        timeBehaviour: recentTimeBehaviour,
        componentHourlyProfiles: structuredClone(snapshot.analysis.componentHourlyProfiles!),
        composition: recentComposition,
      }),
    }, {
      windowId: "day-type-reference",
      period: {
        start: "2026-03-23T16:00:00.000Z",
        endExclusive: "2026-06-21T16:00:00.000Z",
      },
      status: "ready",
      analysis: {
        summary: structuredClone(snapshot.analysis.summary),
        offHours: structuredClone(snapshot.analysis.offHours),
        timeBehaviour: referenceTimeBehaviour,
        componentHourlyProfiles: structuredClone(snapshot.analysis.componentHourlyProfiles!),
      },
    }];

    const view = buildNgeeAnnOverviewViewModel(snapshot);

    expect(view.energyTrend).toMatchObject({
      status: "available",
      evidence: {
        period: "[2026-06-13T16:00:00.000Z, 2026-06-16T16:00:00.000Z)",
      },
    });
    expect(view.energyTrend.scopes[0]?.points.map((point) => point.localDate))
      .toEqual(["2026-06-14", "2026-06-15", "2026-06-16"]);
    expect(view.energyTrend.baselineOverlay).toMatchObject({
      status: "unavailable",
      reason: expect.stringMatching(/does not include the authoritative daily anomaly contract/i),
    });
    expect(view.dayProfile).toMatchObject({
      status: "available",
      evidence: {
        period: "[2026-03-23T16:00:00.000Z, 2026-06-21T16:00:00.000Z)",
      },
    });
    expect(view.dayProfile.profiles.find((profile) => (
      profile.scopeId === snapshot.context.scopeId && profile.dayType === "public_holiday"
    ))).toMatchObject({ status: "available", sampleDayCount: 2 });
    expect(view.usageHeatmap).toMatchObject({
      status: "available",
      dates: [
        { id: "2026-06-14" },
        { id: "2026-06-15" },
        { id: "2026-06-16" },
      ],
      evidence: {
        period: "[2026-06-13T16:00:00.000Z, 2026-06-16T16:00:00.000Z)",
      },
    });
    expect(view.usageHeatmap.scopes[0]?.cells).toHaveLength(72);
    expect(view.dailyAnomalies.status).toBe("unavailable");
    expect(view.decisionPriorities.status).toBe("available");
    expect(view.changeOverTime).toEqual({
      headline: "Recent accepted daily energy is available",
      detail: "The 28-day curve uses accepted daily energy. Comparable-day exception markers are unavailable for this bounded window, so no alert is borrowed from the Report Edition.",
    });
    expect(view.energyComposition.evidence.period)
      .toBe("[2026-06-13T16:00:00.000Z, 2026-06-16T16:00:00.000Z)");
    expect(view.energyComposition.circuits.rows.find((row) => (
      row.meterNodeId === recentCircuit.meterNodeId
    ))).toMatchObject({
      currentUsageKwh: "432.1",
      projectShare: "12.3%",
    });
    expect(view.highlights.find((item) => item.id === "total")?.value).toBe("1,531.17");
    expect(view.context.periodRange).toBe("10 Jun 2026 - 16 Jun 2026");
  });

  it("fails the operational trend closed when a materialized recent window has no daily totals", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    snapshot.reportWindowAnalyses = [{
      windowId: "recent-operations",
      period: {
        start: "2026-05-19T16:00:00.000Z",
        endExclusive: "2026-06-16T16:00:00.000Z",
      },
      status: "ready",
      analysis: {},
    }];

    const view = buildNgeeAnnOverviewViewModel(snapshot);

    expect(view.energyTrend).toMatchObject({
      status: "unavailable",
      reason: "This published Snapshot does not include the authoritative daily totals contract.",
      evidence: {
        period: "[2026-05-19T16:00:00.000Z, 2026-06-16T16:00:00.000Z)",
      },
      scopes: [],
    });
    expect(view.energyComposition.circuits.status).toBe("unavailable");
    expect(view.dailyAnomalies.status).toBe("unavailable");
    expect(view.decisionPriorities.status).toBe("available");
    expect(view.highlights.find((item) => item.id === "total")?.value).toBe("1,531.17");
  });

  it("explains the published tax-inclusive Tariff with its derived ex-tax reference rate", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    if (snapshot.analysis.cost.status !== "available") throw new Error("Expected cost Evidence.");
    snapshot.analysis.cost.amount = 455.063226;
    Object.assign(snapshot.analysis.cost.allocations[0]!, {
      ratePerKwh: 0.2972,
      rateBasis: "tax_inclusive",
      tax: { name: "GST", ratePct: 9 },
      taxInclusiveRatePerKwh: 0.2972,
      taxExclusiveRatePerKwh: 0.272661,
      cost: 455.063226,
    });

    const view = buildNgeeAnnOverviewViewModel(snapshot);

    expect(view.highlights.find((item) => item.id === "cost")?.detail)
      .toBe("29.72¢/kWh incl. GST (27.27¢/kWh ex GST)");
    expect(view.evidence.cost).toMatchObject({
      status: "available",
      allocations: [{
        ratePerKwh: "0.2972",
        rateBasis: "tax_inclusive",
        tax: { name: "GST", ratePct: "9" },
        taxInclusiveRatePerKwh: "0.2972",
        taxExclusiveRatePerKwh: "0.272661",
      }],
    });
  });

  it("projects the fixed Custom Golden Snapshot without creating a second formula stack", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    const view = buildNgeeAnnOverviewViewModel(snapshot);

    expect(view.context).toMatchObject({
      projectName: "Ngee Ann Polytechnic",
      scopeName: "Ngee Ann Polytechnic",
      scopeType: "project",
      period: "Custom",
      timezone: "Asia/Singapore",
    });
    expect(view.dataStatus).toMatchObject({
      status: "ready",
      label: "Ready",
      coverage: "100% coverage",
      intervals: "2,688 / 2,688 valid intervals",
      qualityEvents: "0 quality events",
    });
    expect(Object.fromEntries(view.highlights.map((item) => [item.id, item.value]))).toEqual({
      total: "1,531.17",
      daily: "218.74",
      peak: "20.67",
      cost: "S$489.97",
    });
    expect(view.highlights.find((item) => item.id === "total")?.detail)
      .toBe("Previous period: 1,211.68 kWh");
    expect(view.highlights.find((item) => item.id === "total")?.comparison)
      .toEqual({ label: "+26.4% vs previous", direction: "increase" });
    expect(view.highlights.find((item) => item.id === "daily")?.detail)
      .toBe("Average electricity used per day in this Overview window");
    expect(view.highlights.find((item) => item.id === "cost")?.detail)
      .toBe("Based on the active tariff for this period");
    expect(view.metadataLimitation).toContain("Area and headcount metadata are missing");
    expect(view.metadataLimitation).toContain("does not affect Total energy, Daily average, Peak interval-average power, Comparison or Cost");
    expect(view.componentCategoryBreakdown).toMatchObject({
      status: "available",
      reason: null,
      categories: [
        { id: "load", label: "Load" },
        { id: "light", label: "Light" },
      ],
      evidence: {
        snapshotId: "snapshot-ngee-ann-golden",
        projectReleaseId: "release-ngee-ann-golden",
        queryId: "daily_component_categories_v1",
        accountingBasis: "published_component_circuits",
      },
    });
    expect(view.componentCategoryBreakdown.scopes).toHaveLength(3);
    expect(view.componentCategoryBreakdown.scopes[0]).toMatchObject({
      id: "project",
      period: {
        officialUsageKwh: "1,531.2",
        componentUsageKwh: "1,519",
        ratioPct: "99.2%",
      },
    });
    expect(view.componentCategoryBreakdown.scopes[0]?.rows).toHaveLength(7);
    expect(view.componentCategoryBreakdown.rankings.find((ranking) => (
      ranking.scopeId === "project" && ranking.categoryId === "load"
    ))?.rows[0]).toMatchObject({
      rank: 1,
      name: "Office Load 4 Fan ISOL 1/2",
      levelName: "Level 7",
      usageKwh: "439.1",
    });
    expect(view.levelComparison).toMatchObject({
      status: "available",
      decisionQuestion: "Where is current energy concentrated by Level, and which Level changed most?",
      rows: [
        {
          id: "level-7",
          currentUsageKwh: "1054.18",
          projectShare: "68.8%",
          previousUsageKwh: "734.63",
          changeKwh: "+319.56 kWh",
          changePct: "+43.5%",
          coverage: "100% coverage",
          intervals: "1,344 / 1,344",
          qualityEvents: "0 quality events",
          exact: {
            currentUsageKwh: "1054.1845",
            projectShare: "68.8484%",
            previousUsageKwh: "734.6257",
            changeKwh: "+319.5588 kWh",
            changePct: "+43.4995%",
          },
        },
        {
          id: "level-6",
          currentUsageKwh: "476.98",
          projectShare: "31.2%",
          previousUsageKwh: "477.05",
          changeKwh: "-0.07 kWh",
          changePct: "0%",
          exact: {
            currentUsageKwh: "476.9838",
            projectShare: "31.1516%",
            previousUsageKwh: "477.0516",
            changeKwh: "-0.0678 kWh",
            changePct: "-0.0142%",
          },
        },
      ],
      evidence: {
        snapshotId: "snapshot-ngee-ann-golden",
        projectReleaseId: "release-ngee-ann-golden",
        meterMappingRevisionId: "mapping-v1",
      },
    });
    expect(view.energyComposition).toMatchObject({
      decisionQuestion: "What explains the official Project total?",
      categories: {
        status: "available",
        rows: [
          {
            id: "load",
            currentUsageKwh: "1239.42",
            projectShare: "80.9%",
            previousUsageKwh: "887.22",
            changeKwh: "+352.21 kWh",
            changePct: "+39.7%",
            quality: { coverage: "100% coverage", intervals: "1,344 / 1,344" },
          },
          {
            id: "light",
            currentUsageKwh: "291.74",
            projectShare: "19.1%",
            previousUsageKwh: "324.46",
            changeKwh: "-32.72 kWh",
            changePct: "-10.1%",
          },
        ],
      },
      circuits: {
        status: "available",
        rows: expect.arrayContaining([
          expect.objectContaining({
            rank: 1,
            meterNodeId: "mapping-lvl-7-office-load-4-l1p22-l3p25-fan-isol1-2-16",
            scopeId: "l7-load-4",
            parentScopeId: "level-7",
            levelId: "level-7",
            levelName: "Level 7",
            categoryId: "load",
            category: "Load",
            currentUsageKwh: "439.1",
            projectShare: "28.7%",
            previousUsageKwh: "247.98",
            changeKwh: "+191.12 kWh",
            changePct: "+77.1%",
            includedInOfficialTotal: false,
          }),
          expect.objectContaining({
            rank: 2,
            scopeId: "l7-load-3",
            currentUsageKwh: "337.9",
            previousUsageKwh: "166.72",
            changeKwh: "+171.18 kWh",
            changePct: "+102.7%",
          }),
          expect.objectContaining({
            rank: 3,
            scopeId: "l6-load-4",
            currentUsageKwh: "255.15",
            previousUsageKwh: "262.74",
            changeKwh: "-7.58 kWh",
            changePct: "-2.9%",
          }),
          expect.objectContaining({
            rank: 4,
            scopeId: "l7-front-light",
            currentUsageKwh: "107.02",
            previousUsageKwh: "124.28",
            changeKwh: "-17.26 kWh",
            changePct: "-13.9%",
          }),
          expect.objectContaining({
            rank: 5,
            scopeId: "l6-light-right",
            currentUsageKwh: "70.69",
            previousUsageKwh: "76.97",
            changeKwh: "-6.29 kWh",
            changePct: "-8.2%",
          }),
        ]),
      },
      accounting: {
        status: "available",
        designatedTotals: expect.arrayContaining([
          expect.objectContaining({ scopeId: "l7-total-load", includedInOfficialTotal: true }),
          expect.objectContaining({ scopeId: "l6-total-load", includedInOfficialTotal: true }),
          expect.objectContaining({ scopeId: "l7-total-light", includedInOfficialTotal: true }),
          expect.objectContaining({ scopeId: "l6-total-light", includedInOfficialTotal: true }),
        ]),
        reconciliation: {
          officialUsageKwh: "1531.1683",
          componentUsageKwh: "1518.9965",
          gapKwh: "12.1718",
          ratioPct: "99.2051%",
          officialMeterCount: 4,
          componentMeterCount: 14,
        },
      },
      derivedMeterTrace: {
        status: "available",
        reason: null,
        meterNodeId: "ngee-ann-load-12-v1",
        name: "Load 12",
        scopeId: "level-6",
        scopeName: "Level 6",
        meterKind: "Derived",
        resultUsageKwh: "49.0218",
        includedInOfficialTotal: false,
        terms: [
          {
            meterNodeId: "mapping-lvl-6-office-load-1-l1p1-l3p6-3",
            name: "Lvl 6 Office Load 1: L1P1-L3P6",
            coefficient: "+1",
            inputUsageKwh: "11.5379",
            contributionKwh: "11.5379",
            quality: {
              coverage: "100% coverage",
              intervals: "672 / 672",
              qualityEvents: "0 quality events",
            },
          },
          {
            meterNodeId: "mapping-lvl-6-office-load-2-l1p7-l3p12-4",
            name: "Lvl 6 Office Load 2: L1P7-L3P12",
            coefficient: "+1",
            inputUsageKwh: "37.4839",
            contributionKwh: "37.4839",
          },
        ],
        impactedInputs: [],
      },
      evidence: {
        snapshotId: "snapshot-ngee-ann-golden",
        projectReleaseId: "release-ngee-ann-golden",
        meterMappingRevisionId: "mapping-v1",
        meterFormulaRevisionId: "formula-v1",
        period: "[2026-06-09T16:00:00.000Z, 2026-06-16T16:00:00.000Z)",
        unit: "kWh",
      },
    });
    const componentMeterIds = new Set(
      snapshot.analysis.componentReconciliation!.componentMeterNodeIds,
    );
    expect(view.energyComposition.circuits.rows).toHaveLength(14);
    expect(view.energyComposition.circuits.rows.map((row) => row.meterNodeId)).toEqual(
      snapshot.analysis.circuits
        .filter((circuit) => componentMeterIds.has(circuit.meterNodeId))
        .map((circuit) => circuit.meterNodeId),
    );
    expect(view.evidence).toMatchObject({
      snapshotId: "snapshot-ngee-ann-golden",
      projectReleaseId: "release-ngee-ann-golden",
      importBatchCount: 4,
    });
    expect(view.evidence.queryIds).toEqual(snapshot.analysis.provenance.queryIds);
    expect(view.evidence.references).toEqual([
      expect.objectContaining({
        id: "evidence:ngee-ann-golden:energy.total_usage_kwh@1",
        metricId: "energy.total_usage_kwh@1",
        queryReceiptId: "receipt-ngee-ann-golden",
      }),
      expect.objectContaining({
        id: "evidence:ngee-ann-golden:energy.peak_demand_kw@1",
        metricId: "energy.peak_demand_kw@1",
        queryIds: ["peak_breakdown_v1"],
        queryReceiptId: "receipt-ngee-ann-golden-peak",
      }),
    ]);
    expect(view.evidence.comparison).toEqual({
      status: "available",
      from: "2026-06-02T16:00:00.000Z",
      to: "2026-06-09T16:00:00.000Z",
      range: "[03 Jun 2026, 00:00, 10 Jun 2026, 00:00)",
      currentUsageKwh: "1531.1683",
      previousUsageKwh: "1211.6773",
      changeKwh: "+319.4911",
      changePct: "+26.3677%",
      queryIds: snapshot.analysis.provenance.queryIds,
      referenceIds: ["evidence:ngee-ann-golden:energy.total_usage_kwh@1"],
    });
    expect(view.evidence.cost).toEqual({
      status: "available",
      amount: "489.973864",
      currency: "SGD",
      tariffScheduleVersion: "tariff-v1",
      allocations: [{
        from: "2026-06-09T16:00:00.000Z",
        to: "2026-06-16T16:00:00.000Z",
        range: "[10 Jun 2026, 00:00, 17 Jun 2026, 00:00)",
        ratePerKwh: "0.32",
        usageKwh: "1531.168324",
        cost: "489.973864",
      }],
      queryIds: snapshot.analysis.provenance.queryIds,
      referenceIds: [],
    });
  });

  it("projects the authoritative seven-day Project and Level trend without aggregating in Web", () => {
    const view = buildNgeeAnnOverviewViewModel(ngeeAnnGoldenSnapshot());

    expect(view.energyTrend).toMatchObject({
      status: "available",
      decisionQuestion: "When did accepted energy use change inside the selected Period?",
      scopes: [
        { id: "project", name: "Project", limitation: null },
        { id: "level-7", name: "Level 7", limitation: null },
        { id: "level-6", name: "Level 6", limitation: null },
      ],
      evidence: {
        snapshotId: "snapshot-ngee-ann-golden",
        projectReleaseId: "release-ngee-ann-golden",
        meterMappingRevisionId: "mapping-v1",
        meterFormulaRevisionId: "formula-v1",
        metricId: "energy.total_usage_kwh@1",
        timezone: "Asia/Singapore",
        unit: "kWh",
        queryIds: ["daily_totals_v1"],
      },
    });
    expect(view.energyTrend.scopes[0]!.points).toHaveLength(7);
    expect(view.energyTrend.scopes[0]!.points.map((point) => ({
      localDate: point.localDate,
      dayType: point.dayType,
      usageKwh: point.usageKwh,
      status: point.status,
    }))).toEqual([
      { localDate: "2026-06-10", dayType: "weekday", usageKwh: "253.7018", status: "complete" },
      { localDate: "2026-06-11", dayType: "weekday", usageKwh: "268.399", status: "complete" },
      { localDate: "2026-06-12", dayType: "weekday", usageKwh: "260.0659", status: "complete" },
      { localDate: "2026-06-13", dayType: "weekend", usageKwh: "168.9645", status: "complete" },
      { localDate: "2026-06-14", dayType: "weekend", usageKwh: "127.9387", status: "complete" },
      { localDate: "2026-06-15", dayType: "weekday", usageKwh: "230.1002", status: "complete" },
      { localDate: "2026-06-16", dayType: "weekday", usageKwh: "221.9982", status: "complete" },
    ]);
  });

  it("maps each governed daily baseline and outcome onto the matching trend Scope-date point", () => {
    const trend = buildNgeeAnnOverviewViewModel(ngeeAnnGoldenSnapshot()).energyTrend;

    expect(trend.baselineOverlay).toEqual({
      status: "available",
      reason: null,
      ruleRevisionId: "comparison.daily_usage_above_baseline@1",
    });
    expect(trend.scopes[0]!.points[0]!.baseline).toEqual({
      outcome: "within_threshold",
      outcomeLabel: "Within rule threshold",
      baselineKwh: 218.885,
      baselineUsageKwh: "218.88",
      deltaUsageKwh: "+34.82",
      relativePctLabel: "+15.9%",
      incidentId: null,
      limitation: null,
    });
    expect(trend.scopes[0]!.points[1]!.baseline).toMatchObject({
      outcome: "triggered",
      outcomeLabel: "Above-baseline rule triggered",
      baselineKwh: 218.885,
      deltaUsageKwh: "+49.51",
      relativePctLabel: "+22.6%",
      incidentId: "incident:project:2026-06-11",
    });
    expect(trend.scopes[1]!.points[0]!.baseline).toMatchObject({
      outcome: "within_threshold",
      baselineKwh: 138.8777,
      deltaUsageKwh: "+18.25",
    });
    expect(trend.evidence.baseline).toEqual({
      bundleId: "anomaly-bundle-ngee-ann-golden",
      queryId: "time_slot_anomaly_v1",
      ruleRevisionId: "comparison.daily_usage_above_baseline@1",
      baselineCutoff: "2026-06-10",
      baselineMethod: "mean_of_complete_comparable_days_by_local_hour",
    });
  });

  it.each([
    {
      name: "Snapshot identity",
      mutate: (snapshot: GoldenSnapshot) => {
        dailyAnomalyBundle(snapshot).evidencePins.dataSnapshotId = "snapshot-mismatch";
      },
    },
    {
      name: "Release identity",
      mutate: (snapshot: GoldenSnapshot) => {
        dailyAnomalyBundle(snapshot).evidencePins.projectReleaseId = "release-mismatch";
      },
    },
    {
      name: "Scope identity",
      mutate: (snapshot: GoldenSnapshot) => {
        dailyAnomalyBundle(snapshot).scopes[1]!.scopeId = "level-mismatch";
      },
    },
    {
      name: "local date",
      mutate: (snapshot: GoldenSnapshot) => {
        dailyAnomalyBundle(snapshot).scopes[0]!.rows[0]!.localDate = "2026-06-09";
      },
    },
    {
      name: "accepted actual",
      mutate: (snapshot: GoldenSnapshot) => {
        dailyAnomalyBundle(snapshot).scopes[0]!.rows[0]!.actualKwh = 999;
      },
    },
    {
      name: "derived impact",
      mutate: (snapshot: GoldenSnapshot) => {
        dailyAnomalyBundle(snapshot).scopes[0]!.rows[0]!.impactKwh! += 1;
      },
    },
    {
      name: "derived percentage",
      mutate: (snapshot: GoldenSnapshot) => {
        dailyAnomalyBundle(snapshot).scopes[0]!.rows[0]!.relativePct! += 1;
      },
    },
    {
      name: "rule outcome",
      mutate: (snapshot: GoldenSnapshot) => {
        dailyAnomalyBundle(snapshot).scopes[0]!.rows[0]!.outcome = "triggered";
      },
    },
  ])("hides only the daily baseline overlay for a mismatched $name", ({ mutate }) => {
    const snapshot = ngeeAnnGoldenSnapshot();
    mutate(snapshot);

    const trend = buildNgeeAnnOverviewViewModel(snapshot).energyTrend;

    expect(trend).toMatchObject({
      status: "available",
      grain: "day",
      baselineOverlay: {
        status: "unavailable",
        reason: expect.stringMatching(/baseline overlay|anomaly/i),
        ruleRevisionId: null,
      },
    });
    expect(trend.scopes).toHaveLength(3);
    expect(trend.scopes[0]!.points[0]).toMatchObject({
      acceptedUsageKwh: 253.7018,
      usageKwh: "253.7018",
      baseline: null,
    });
  });

  it("accepts harmless four-decimal serialization drift in derived anomaly values", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    const row = dailyAnomalyBundle(snapshot).scopes[0]!.rows[0]!;
    const expectedImpact = row.actualKwh! - row.baselineKwh!;
    const expectedRelativePct = (expectedImpact / row.baselineKwh!) * 100;
    row.impactKwh = Number((expectedImpact + 0.00015).toFixed(4));
    row.relativePct = Number((expectedRelativePct + 0.0005).toFixed(4));

    const trend = buildNgeeAnnOverviewViewModel(snapshot).energyTrend;

    expect(trend.status).toBe("available");
    expect(trend.baselineOverlay.status).toBe("available");
    expect(trend.scopes[0]!.points[0]!.baseline).not.toBeNull();
  });

  it("keeps a high-ratio anomaly available when four-decimal inputs explain the serialized percentage", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    const row = dailyAnomalyBundle(snapshot).scopes[1]!.rows[4]!;
    expect(row.actualKwh).toBe(115.1763);
    expect(row.outcome).toBe("triggered");
    row.baselineKwh = 20.1134;
    row.impactKwh = 95.063;
    row.relativePct = 472.6361;

    const trend = buildNgeeAnnOverviewViewModel(snapshot).energyTrend;

    expect(trend.status).toBe("available");
    expect(trend.baselineOverlay.status).toBe("available");
  });

  it("uses the authoritative 24-hour grid for a single local day without depending on dailyTotals", () => {
    const snapshot = ngeeAnnSingleDaySnapshot({ includeDailyTotals: false });

    const view = buildNgeeAnnOverviewViewModel(snapshot);

    expect(view.energyTrend).toMatchObject({
      status: "available",
      grain: "hour",
      decisionQuestion: "Which accepted local hours drove energy use on the selected day?",
      baselineOverlay: { status: "not_applicable", reason: null, ruleRevisionId: null },
      evidence: { queryIds: ["time_bucket_grid_v1"] },
    });
    expect(view.energyTrend.scopes[0]!.points).toHaveLength(24);
    expect(view.energyTrend.scopes[0]!.points[0]).toMatchObject({
      localDate: "2026-06-16",
      localHour: 0,
      dateLabel: "00:00",
      acceptedUsageKwh: 5.3565,
      usageKwh: "5.3565",
      baseline: null,
      status: "complete",
      intervals: "16 / 16 valid intervals",
    });
  });

  it("projects only the seven server-triggered daily incidents in frozen Scope and date order", () => {
    const dailyAnomalies = buildNgeeAnnOverviewViewModel(ngeeAnnGoldenSnapshot()).dailyAnomalies;

    expect(dailyAnomalies).toMatchObject({
      status: "available",
      allSuppressed: false,
      outcomeSummary: {
        triggered: 7,
        withinThreshold: 14,
        suppressed: 0,
      },
      rule: {
        ruleRevisionId: "comparison.daily_usage_above_baseline@1",
        baselineCutoff: "2026-06-10",
        baselineMethod: "mean_of_complete_comparable_days_by_local_hour",
        relativeThresholdPct: "20%",
        absoluteImpactKwh: "20 kWh",
        minimumCoveragePct: "95%",
        minimumSampleCount: 4,
      },
      evidence: {
        bundleId: "anomaly-bundle-ngee-ann-golden",
        snapshotId: "snapshot-ngee-ann-golden",
        projectReleaseId: "release-ngee-ann-golden",
        hierarchyRevisionId: "hierarchy-v6",
        meterMappingRevisionId: "mapping-v1",
        meterFormulaRevisionId: "formula-v1",
        metricVersion: "metric-v1",
        businessCalendarVersion: "calendar-v1",
        queryIds: ["time_slot_anomaly_v1"],
      },
    });
    expect(dailyAnomalies.incidents.map((incident) => [incident.scopeId, incident.localDate])).toEqual([
      ["project", "2026-06-11"],
      ["project", "2026-06-13"],
      ["project", "2026-06-14"],
      ["level-7", "2026-06-11"],
      ["level-7", "2026-06-12"],
      ["level-7", "2026-06-13"],
      ["level-7", "2026-06-14"],
    ]);
    expect(dailyAnomalies.incidents.some((incident) => incident.scopeId === "level-6")).toBe(false);
    expect(dailyAnomalies.incidents[0]).toMatchObject({
      scopeName: "Project",
      actualKwh: "268.399",
      baselineKwh: "218.885",
      thresholdKwh: "262.662",
      impactKwh: "+49.514",
      baselineDates: ["2026-06-04", "2026-06-05", "2026-06-08", "2026-06-09"],
      relatedLevelTotals: [
        expect.objectContaining({ scopeName: "Level 7" }),
        expect.objectContaining({ scopeName: "Level 6" }),
      ],
    });
    expect(dailyAnomalies.incidents[0]!.hourlyComparison).toHaveLength(24);
    expect(dailyAnomalies.incidents[0]!.series.map((series) => series.scopeId)).toEqual([
      "project",
      "level-7",
      "level-6",
    ]);
    expect(dailyAnomalies.incidents[3]!.series.map((series) => ({
      scopeId: series.scopeId,
      category: series.category,
      includedInOfficialTotal: series.includedInOfficialTotal,
    }))).toEqual([
      { scopeId: "level-7", category: null, includedInOfficialTotal: true },
      { scopeId: "l7-anomaly-load", category: "load", includedInOfficialTotal: false },
      { scopeId: "l7-anomaly-light", category: "light", includedInOfficialTotal: false },
    ]);
  });

  it.each(anomalyEvidencePinMismatchCases)(
    "fails daily anomalies closed for a mismatched $name pin",
    ({ mutate }) => {
      const snapshot = ngeeAnnGoldenSnapshot();
      mutate(snapshot);

      const view = buildNgeeAnnOverviewViewModel(snapshot);

      expect(view.dailyAnomalies).toMatchObject({ status: "unavailable", incidents: [] });
    },
  );

  it.each(anomalyStrictRuleMismatchCases)(
    "fails daily anomalies closed for a non-canonical $name",
    ({ mutate }) => {
      const snapshot = ngeeAnnGoldenSnapshot();
      mutate(dailyAnomalyBundle(snapshot));

      const view = buildNgeeAnnOverviewViewModel(snapshot);

      expect(view.dailyAnomalies).toMatchObject({ status: "unavailable", incidents: [] });
      expect(view.energyTrend.status).toBe("available");
    },
  );

  it("requires exactly the latest four eligible baseline samples for triggered and within-threshold rows", () => {
    const tooFew = ngeeAnnGoldenSnapshot();
    const triggered = dailyAnomalyBundle(tooFew).scopes[0]!.rows[1]!;
    triggered.baselineDates.pop();
    triggered.baselineSamples.pop();
    triggered.baselineSampleCount = 3;

    const tooMany = ngeeAnnGoldenSnapshot();
    const withinThreshold = dailyAnomalyBundle(tooMany).scopes[0]!.rows[0]!;
    withinThreshold.baselineDates.unshift("2026-06-03");
    withinThreshold.baselineSamples.unshift({
      ...withinThreshold.baselineSamples[0]!,
      localDate: "2026-06-03",
    });
    withinThreshold.baselineSampleCount = 5;

    for (const snapshot of [tooFew, tooMany]) {
      const view = buildNgeeAnnOverviewViewModel(snapshot);
      expect(view.dailyAnomalies).toMatchObject({ status: "unavailable", incidents: [] });
      expect(view.energyTrend.status).toBe("available");
    }
  });

  it("rejects an eligible baseline sample unless it is complete, 100% covered and quality-clean", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    const sample = dailyAnomalyBundle(snapshot).scopes[0]!.rows[1]!.baselineSamples[0]!;
    sample.coveragePct = 99.7396;
    sample.validIntervalCount = sample.expectedMeterIntervalCount - 1;

    const view = buildNgeeAnnOverviewViewModel(snapshot);

    expect(view.dailyAnomalies).toMatchObject({ status: "unavailable", incidents: [] });
    expect(view.energyTrend.status).toBe("available");
  });

  it("rejects triggered or within-threshold rows that violate pinned coverage or quality gates", () => {
    const lowCoverage = ngeeAnnGoldenSnapshot();
    dailyAnomalyBundle(lowCoverage).scopes[0]!.rows[1]!.coveragePct = 94;
    const qualityEvent = ngeeAnnGoldenSnapshot();
    dailyAnomalyBundle(qualityEvent).scopes[0]!.rows[0]!.qualityEventCount = 1;

    for (const snapshot of [lowCoverage, qualityEvent]) {
      const view = buildNgeeAnnOverviewViewModel(snapshot);
      expect(view.dailyAnomalies).toMatchObject({ status: "unavailable", incidents: [] });
      expect(view.energyTrend.status).toBe("available");
    }
  });

  it("fails daily anomalies locally when a triggered Project detail omits or reorders an immediate Level", () => {
    const missingChild = ngeeAnnGoldenSnapshot();
    dailyAnomalyBundle(missingChild).scopes[0]!.rows[1]!.detailSeries.splice(2, 1);
    const reorderedChildren = ngeeAnnGoldenSnapshot();
    const series = dailyAnomalyBundle(reorderedChildren).scopes[0]!.rows[1]!.detailSeries;
    [series[1], series[2]] = [series[2]!, series[1]!];

    for (const snapshot of [missingChild, reorderedChildren]) {
      const view = buildNgeeAnnOverviewViewModel(snapshot);
      expect(view.dailyAnomalies).toMatchObject({ status: "unavailable", incidents: [] });
      expect(view.energyTrend.status).toBe("available");
      expect(view.dayProfile.status).toBe("available");
      expect(view.levelComparison.status).toBe("available");
    }
  });

  it("uses the stable anomaly Scope order instead of usage-ranked childScopes for Project detail", () => {
    const liveOrder = ngeeAnnGoldenSnapshot();
    const liveBundle = dailyAnomalyBundle(liveOrder);
    [liveBundle.scopes[1], liveBundle.scopes[2]] = [liveBundle.scopes[2]!, liveBundle.scopes[1]!];
    for (const row of liveBundle.scopes[0]!.rows) {
      if (row.outcome === "triggered") {
        [row.detailSeries[1], row.detailSeries[2]] = [row.detailSeries[2]!, row.detailSeries[1]!];
      }
    }

    expect(liveOrder.analysis.childScopes.map((scope) => scope.nodeId)).toEqual(["level-7", "level-6"]);
    expect(liveBundle.scopes.map((scope) => scope.scopeId)).toEqual(["project", "level-6", "level-7"]);
    expect(buildNgeeAnnOverviewViewModel(liveOrder).dailyAnomalies.status).toBe("available");

    const mismatchedProjectDetail = ngeeAnnGoldenSnapshot();
    const mismatchedBundle = dailyAnomalyBundle(mismatchedProjectDetail);
    [mismatchedBundle.scopes[1], mismatchedBundle.scopes[2]] = [
      mismatchedBundle.scopes[2]!,
      mismatchedBundle.scopes[1]!,
    ];

    expect(buildNgeeAnnOverviewViewModel(mismatchedProjectDetail).dailyAnomalies).toMatchObject({
      status: "unavailable",
      incidents: [],
    });
  });

  it.each([
    {
      name: "duplicate bundled Level",
      mutate: (snapshot: GoldenSnapshot) => {
        const scopes = dailyAnomalyBundle(snapshot).scopes;
        scopes[2]!.scopeId = scopes[1]!.scopeId;
        scopes[2]!.scopeName = scopes[1]!.scopeName;
      },
    },
    {
      name: "Level outside the immediate hierarchy",
      mutate: (snapshot: GoldenSnapshot) => {
        const level = dailyAnomalyBundle(snapshot).scopes[1]!;
        level.scopeId = "level-8";
        level.scopeName = "Level 8";
      },
    },
    {
      name: "missing immediate hierarchy Level",
      mutate: (snapshot: GoldenSnapshot) => {
        snapshot.analysis.childScopes.pop();
      },
    },
  ])("fails the daily anomaly Scope set closed for a $name", ({ mutate }) => {
    const snapshot = ngeeAnnGoldenSnapshot();
    mutate(snapshot);

    expect(buildNgeeAnnOverviewViewModel(snapshot).dailyAnomalies).toMatchObject({
      status: "unavailable",
      incidents: [],
    });
  });

  it("summarises triggered, within-threshold and suppressed rows without treating suppressed as normal", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    const suppressed = dailyAnomalyBundle(snapshot).scopes[0]!.rows[0]!;
    suppressed.outcome = "suppressed";
    suppressed.suppressionReason = {
      code: "CALENDAR_EXCEPTION_DATE",
      message: "The date is excluded by the pinned Calendar.",
    };

    const dailyAnomalies = buildNgeeAnnOverviewViewModel(snapshot).dailyAnomalies;

    expect(dailyAnomalies).toMatchObject({
      status: "available",
      allSuppressed: false,
      outcomeSummary: {
        triggered: 7,
        withinThreshold: 13,
        suppressed: 1,
      },
    });
    expect(dailyAnomalies.incidents).toHaveLength(7);
  });

  it("fails only daily anomalies closed for absent, unavailable or invalid optional payloads", () => {
    const absent = ngeeAnnGoldenSnapshot();
    delete absent.analysis.dailyUsageAnomalies;
    const unavailable = ngeeAnnGoldenSnapshot();
    unavailable.analysis.dailyUsageAnomalies = {
      status: "unavailable",
      ruleRevisionId: "comparison.daily_usage_above_baseline@1",
      reason: {
        code: "BUSINESS_CALENDAR_VERSION_NOT_FOUND",
        message: "The pinned business Calendar is unavailable.",
      },
    };
    const invalid = ngeeAnnGoldenSnapshot();
    dailyAnomalyBundle(invalid).scopes[0]!.rows[1]!.hourlyComparison.pop();

    expect(buildNgeeAnnOverviewViewModel(absent).dailyAnomalies).toMatchObject({
      status: "unavailable",
      reason: expect.stringContaining("does not include"),
    });
    expect(buildNgeeAnnOverviewViewModel(unavailable).dailyAnomalies).toMatchObject({
      status: "unavailable",
      reason: "The pinned business Calendar is unavailable.",
    });
    const invalidView = buildNgeeAnnOverviewViewModel(invalid);
    expect(invalidView.dailyAnomalies).toMatchObject({ status: "unavailable", incidents: [] });
    expect(invalidView.energyTrend.status).toBe("available");
  });

  it("keeps an all-suppressed bundle and partial detail series honest without inventing incidents or zeroes", () => {
    const suppressed = ngeeAnnGoldenSnapshot();
    for (const scope of dailyAnomalyBundle(suppressed).scopes) {
      for (const row of scope.rows) {
        row.outcome = "suppressed";
        row.suppressionReason = {
          code: "CALENDAR_EXCEPTION_DATE",
          message: "The date is excluded by the pinned Calendar.",
        };
      }
    }
    expect(buildNgeeAnnOverviewViewModel(suppressed).dailyAnomalies).toMatchObject({
      status: "available",
      allSuppressed: true,
      outcomeSummary: {
        triggered: 0,
        withinThreshold: 0,
        suppressed: 21,
      },
      incidents: [],
    });

    const partial = ngeeAnnGoldenSnapshot();
    const component = dailyAnomalyBundle(partial).scopes[1]!.rows[1]!.detailSeries[1]!;
    component.status = "partial";
    component.selectedTotalKwh = null;
    component.points[0]!.selectedKwh = null;
    component.points[0]!.impactKwh = null;
    const partialSeries = buildNgeeAnnOverviewViewModel(partial).dailyAnomalies.incidents
      .find((incident) => incident.scopeId === "level-7" && incident.localDate === "2026-06-11")!
      .series.find((series) => series.scopeId === "l7-anomaly-load")!;
    expect(partialSeries).toMatchObject({
      status: "partial",
      statusLabel: "Partial",
      selectedTotalKwh: null,
    });
    expect(partialSeries.points).toHaveLength(24);
    expect(partialSeries.points[0]).toMatchObject({ localHour: 0, selectedKwh: null, impactKwh: null });
  });

  it("projects server Day Profiles and the direct hourly heatmap grid", () => {
    const view = buildNgeeAnnOverviewViewModel(ngeeAnnGoldenSnapshot());

    expect(view.dayProfile).toMatchObject({
      status: "available",
      scopes: [
        { id: "project", name: "Project" },
        { id: "level-7", name: "Level 7" },
        { id: "level-6", name: "Level 6" },
      ],
      operatingPolicy: {
        status: "available",
        operatingUsageKwh: 1200,
        operatingUsage: "1,200.0",
        standbyUsageKwh: 331.168324,
        standbyUsage: "331.2",
        standbySharePct: 21.63,
        standbyShare: "21.6%",
        timezone: "Asia/Singapore",
        businessCalendarVersion: "calendar-v1",
      },
      evidence: { queryIds: ["time_bucket_grid_v1"] },
    });
    expect(view.dayProfile.profiles).toHaveLength(9);
    expect(view.dayProfile.profiles.find((profile) => profile.id === "project:weekday")).toMatchObject({
      status: "available",
      sampleDayCount: 5,
      summary: {
        status: "available",
        dailyUsageKwh: 246.8528,
        dailyUsage: "246.9",
      },
      values: expect.any(Array),
      componentStack: {
        status: "available",
        sampleDayCount: 5,
        categories: [
          expect.objectContaining({ category: "load", categoryLabel: "Load", values: expect.any(Array) }),
          expect.objectContaining({ category: "light", categoryLabel: "Light", values: expect.any(Array) }),
        ],
      },
    });
    expect(view.dayProfile.profiles.find((profile) => profile.id === "project:weekend")).toMatchObject({
      status: "available",
      sampleDayCount: 2,
    });
    expect(view.dayProfile.profiles.find((profile) => profile.id === "project:public_holiday")).toMatchObject({
      status: "unavailable",
      reason: "Public Holiday profile requires an authoritative release-pinned Calendar classification.",
      values: [],
    });
    expect(view.dayProfile.profiles.find((profile) => profile.id === "project:weekday")?.values).toHaveLength(24);
    const weekdayComponentStack = view.dayProfile.profiles
      .find((profile) => profile.id === "project:weekday")?.componentStack;
    expect(weekdayComponentStack?.status).toBe("available");
    if (weekdayComponentStack?.status === "available") {
      expect(weekdayComponentStack.categories.every((category) => category.values.length === 24)).toBe(true);
    }

    expect(view.usageHeatmap).toMatchObject({
      status: "available",
      defaultView: "level-hour",
      evidence: { queryIds: ["time_bucket_grid_v1"] },
    });
    expect(view.usageHeatmap.averageProfiles).toHaveLength(6);
    expect(view.usageHeatmap.averageProfiles.find((profile) => profile.id === "project:weekday")).toMatchObject({
      dayTypeLabel: "Weekday",
      scopeName: "Project",
      sampleDayCount: 5,
      dailyUsageKwh: 246.8528,
      dailyUsage: "246.9",
      peakHourLabel: "14:00",
      peakUsage: "16.0703",
      values: expect.any(Array),
    });
    expect(view.usageHeatmap.averageProfiles.find((profile) => profile.id === "project:weekday")?.values).toHaveLength(24);
    expect(view.usageHeatmap.circuitProfiles).toEqual([
      expect.objectContaining({
        id: "level-7:weekday",
        levelScopeId: "level-7",
        levelScopeName: "Level 7",
        dayType: "weekday",
        sampleDayCount: 5,
        circuits: expect.any(Array),
      }),
      expect.objectContaining({ id: "level-7:weekend", levelScopeId: "level-7", dayType: "weekend" }),
      expect.objectContaining({ id: "level-6:weekday", levelScopeId: "level-6", dayType: "weekday" }),
      expect.objectContaining({ id: "level-6:weekend", levelScopeId: "level-6", dayType: "weekend" }),
    ]);
    expect(view.usageHeatmap.circuitProfiles[0]!.circuits.length).toBeGreaterThan(0);
    expect(view.usageHeatmap.circuitProfiles[0]!.circuits.every((circuit) => circuit.values.length === 24)).toBe(true);
    expect(view.usageHeatmap.dates).toHaveLength(7);
    expect(view.usageHeatmap.scopes).toHaveLength(3);
    expect(view.usageHeatmap.scopes[0]!.cells).toHaveLength(168);
    expect(view.usageHeatmap.scopes[0]!.cells[0]).toMatchObject({
      scopeId: "project",
      localDate: "2026-06-10",
      localHour: 0,
      quality: { status: "complete", coverage: "100% coverage" },
    });
  });

  it("turns an elevated Public Holiday profile into an observed, small-sample investigation angle", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    const profiles = snapshot.analysis.timeBehaviour!.dayProfiles;
    const weekend = profiles.find((profile) => (
      profile.scopeId === "project" && profile.dayType === "weekend" && profile.status === "available"
    ));
    const holidayIndex = profiles.findIndex((profile) => (
      profile.scopeId === "project" && profile.dayType === "public_holiday"
    ));
    if (!weekend || holidayIndex < 0) throw new Error("Expected Project Day Type profiles.");
    const weekendTotal = weekend.values.reduce((sum, value) => sum + value.usageKwh, 0);
    weekend.values = weekend.values.map((value) => ({
      ...value,
      usageKwh: value.usageKwh * 82.371 / weekendTotal,
    }));
    profiles[holidayIndex] = {
      dayType: "public_holiday",
      scopeId: "project",
      scopeName: "Ngee Ann Polytechnic",
      status: "available",
      sampleDayCount: 2,
      values: weekend.values.map((value) => ({
        ...value,
        usageKwh: value.usageKwh * 137.174 / 82.371,
      })),
    };

    expect(buildNgeeAnnOverviewViewModel(snapshot).dayProfile.holidayInsight).toEqual({
      status: "available",
      headline: "Public Holiday use stayed above Weekend levels",
      detail: "Public Holidays averaged 137.2 kWh/day, 66.5% above the Weekend average of 82.4 kWh/day.",
      angle: "A useful follow-up is whether lighting, office loads or scheduled ventilation kept a weekday-like pattern.",
      caveat: "Observed across 2 complete Public Holidays and 2 complete Weekend days. Treat this as a small-sample signal, not a proven cause.",
    });
  });

  it("keeps invalid Day Profile and hourly grid failures inside their owning modules", () => {
    const invalidProfile = ngeeAnnGoldenSnapshot();
    const weekday = invalidProfile.analysis.timeBehaviour!.dayProfiles.find((profile) => (
      profile.status === "available" && profile.scopeId === "project" && profile.dayType === "weekday"
    ));
    if (weekday?.status === "available") weekday.values.pop();
    const invalidGrid = ngeeAnnGoldenSnapshot();
    invalidGrid.analysis.timeBehaviour!.scopes[1]!.cells[4]!.localHour = 8;

    const profileView = buildNgeeAnnOverviewViewModel(invalidProfile);
    expect(profileView.dayProfile).toMatchObject({ status: "unavailable", profiles: [] });
    expect(profileView.usageHeatmap.status).toBe("available");
    expect(profileView.energyTrend.status).toBe("available");

    const gridView = buildNgeeAnnOverviewViewModel(invalidGrid);
    expect(gridView.usageHeatmap).toMatchObject({ status: "unavailable", scopes: [] });
    expect(gridView.dayProfile).toMatchObject({ status: "available" });
    expect(gridView.dayProfile.profiles).toHaveLength(9);
    expect(gridView.energyTrend).toMatchObject({ status: "available", grain: "day" });
    expect(gridView.levelComparison.status).toBe("available");
  });

  it("fails only component hourly projections closed when their authoritative rows are invalid", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    const projection = snapshot.analysis.componentHourlyProfiles!;
    const projectWeekday = projection.scopes[0]!.profiles.find((profile) => (
      profile.dayType === "weekday" && profile.status === "available"
    ));
    if (!projectWeekday || projectWeekday.status !== "available") {
      throw new Error("Expected an available Project weekday component profile.");
    }
    projectWeekday.categories[0]!.values.pop();

    const view = buildNgeeAnnOverviewViewModel(snapshot);
    const projectProfile = view.dayProfile.profiles.find((profile) => profile.id === "project:weekday")!;

    expect(view.dayProfile.status).toBe("available");
    expect(projectProfile.componentStack).toMatchObject({
      status: "unavailable",
      reason: expect.stringMatching(/component hourly/i),
    });
    expect(view.usageHeatmap.status).toBe("available");
    expect(view.usageHeatmap.circuitProfiles).toEqual([]);
    expect(view.usageHeatmap.scopes).toHaveLength(3);
  });

  it.each(timeEvidencePinMismatchCases)(
    "fails only hourly-grid modules closed for a mismatched $name pin",
    ({ mutate }) => {
      const snapshot = ngeeAnnGoldenSnapshot();
      mutate(snapshot);

      const view = buildNgeeAnnOverviewViewModel(snapshot);

      expect(view.dayProfile).toMatchObject({ status: "unavailable", profiles: [] });
      expect(view.usageHeatmap).toMatchObject({ status: "unavailable", scopes: [] });
      expect(view.energyTrend).toMatchObject({ status: "available", grain: "day" });
      expect(view.levelComparison.status).toBe("available");
      expect(view.energyComposition.categories.status).toBe("available");
    },
  );

  it("keeps partial and unavailable heatmap cells explicit without suppressing the module", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    const cells = snapshot.analysis.timeBehaviour!.scopes[0]!.cells;
    cells[0]!.dataHealth = {
      status: "partial",
      coveragePct: 75,
      expectedMeterIntervalCount: 16,
      validIntervalCount: 12,
      qualityEventCount: 1,
    };
    cells[1]!.usageKwh = null;
    cells[1]!.dataHealth = {
      status: "unavailable",
      coveragePct: 0,
      expectedMeterIntervalCount: 16,
      validIntervalCount: 0,
      qualityEventCount: 2,
    };

    const heatmap = buildNgeeAnnOverviewViewModel(snapshot).usageHeatmap;

    expect(heatmap.status).toBe("available");
    expect(heatmap.scopes[0]!.cells[0]).toMatchObject({
      usageKwh: expect.any(String),
      quality: {
        status: "partial",
        coverage: "75% coverage",
        intervals: "12 / 16 valid intervals",
        qualityEvents: "1 quality events",
      },
    });
    expect(heatmap.scopes[0]!.cells[1]).toMatchObject({
      acceptedUsageKwh: null,
      usageKwh: null,
      quality: { status: "unavailable", coverage: "0% coverage" },
    });
  });

  it("projects the authoritative same-interval Peak breakdown without reordering server rows", () => {
    const view = buildNgeeAnnOverviewViewModel(ngeeAnnGoldenSnapshot());

    expect(view.peakBreakdown).toMatchObject({
      status: "available",
      periodStatus: "complete",
      periodCoverage: "100% coverage",
      peakLabel: "Highest accepted interval",
      peakAt: "11 Jun 2026, 14:00",
      peakInterval: "[11 Jun 2026, 14:00, 11 Jun 2026, 14:15)",
      averageKw: "20.6731",
      levels: [
        {
          scopeId: "level-7",
          scopeName: "Level 7",
          averageKw: "12.0637",
          sharePct: "58.3545%",
        },
        {
          scopeId: "level-6",
          scopeName: "Level 6",
          averageKw: "8.6094",
          sharePct: "41.6455%",
        },
      ],
      evidence: {
        snapshotId: "snapshot-ngee-ann-golden",
        projectReleaseId: "release-ngee-ann-golden",
        meterMappingRevisionId: "mapping-v1",
        meterFormulaRevisionId: "formula-v1",
        metricId: "energy.peak_demand_kw@1",
        period: "[2026-06-09T16:00:00.000Z, 2026-06-16T16:00:00.000Z)",
        timezone: "Asia/Singapore",
        unit: "kW",
        queryIds: ["peak_breakdown_v1"],
      },
    });
    expect(view.peakBreakdown.levels[0]!.circuits.map((row) => row.meterNodeId)).toEqual([
      "mapping-lvl-7-office-load-4-l1p22-l3p25-fan-isol1-2-16",
      "mapping-lvl-7-office-load-3-l1p16-l3p21-15",
      "mapping-lvl-7-front-row-office-light-11",
      "mapping-lvl-7-back-row-office-light-10",
      "mapping-lvl-7-office-load-2-l1p7-l3p15-14",
      "mapping-lvl-7-middle-row-office-light-12",
      "mapping-lvl-7-office-load-1-l1p1-l3p6-13",
    ]);
  });

  it("keeps an accepted Peak available while labeling an incomplete Period", () => {
    const snapshot = ngeeAnnGoldenSnapshot({
      dataStatus: "partial",
      coveragePct: 75,
      validIntervalCount: 2_016,
    });
    const view = buildNgeeAnnOverviewViewModel(snapshot);

    expect(view.peakBreakdown).toMatchObject({
      status: "available",
      periodStatus: "partial",
      periodCoverage: "75% coverage",
      peakLabel: "Highest complete observed interval",
      averageKw: "20.6731",
    });
  });

  it("matches Peak Levels by identity while preserving server Peak order", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    if (snapshot.analysis.peakBreakdown?.status === "available") {
      snapshot.analysis.peakBreakdown.levels.reverse();
    }

    const peak = buildNgeeAnnOverviewViewModel(snapshot).peakBreakdown;

    expect(peak.status).toBe("available");
    expect(peak.levels.map((level) => level.scopeId)).toEqual(["level-6", "level-7"]);
  });

  it.each(peakEvidencePinMismatchCases)(
    "fails only Peak breakdown closed for a mismatched $name pin",
    ({ mutate }) => {
      const snapshot = ngeeAnnGoldenSnapshot();
      mutate(snapshot);

      const view = buildNgeeAnnOverviewViewModel(snapshot);

      expect(view.peakBreakdown).toMatchObject({
        status: "unavailable",
        reason: "The Peak Snapshot, Release or revision evidence pins are inconsistent.",
        levels: [],
      });
      expect(view.highlights.find((highlight) => highlight.id === "peak")).toMatchObject({
        value: "20.67",
        unit: "kW",
        available: true,
      });
      expect(view.energyTrend.status).toBe("available");
    },
  );

  it("fails Peak breakdown closed for impossible interval-health counts", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    if (snapshot.analysis.peakBreakdown?.status === "available") {
      const circuit = snapshot.analysis.peakBreakdown.levels[0]!.circuits[0]!;
      circuit.averageKw = null;
      circuit.sharePct = null;
      circuit.dataHealth = {
        status: "unavailable",
        coveragePct: 0,
        expectedMeterIntervalCount: 1,
        validIntervalCount: 2,
        qualityEventCount: 1,
      };
    }

    const view = buildNgeeAnnOverviewViewModel(snapshot);

    expect(view.peakBreakdown).toMatchObject({ status: "unavailable", levels: [] });
    expect(view.highlights.find((highlight) => highlight.id === "peak")?.value).toBe("20.67");
    expect(view.energyTrend.status).toBe("available");
  });

  it("fails only Peak breakdown closed for absent, unavailable or invalid optional payloads", () => {
    const absent = ngeeAnnGoldenSnapshot();
    delete absent.analysis.peakBreakdown;
    const unavailable = ngeeAnnGoldenSnapshot();
    unavailable.analysis.peakBreakdown = {
      status: "unavailable",
      reason: {
        code: "PEAK_INTERVAL_FACTS_REJECTED",
        message: "The Project Peak interval contains rejected official inputs.",
      },
    };
    const wrongQuery = ngeeAnnGoldenSnapshot();
    wrongQuery.analysis.provenance.queryIds = wrongQuery.analysis.provenance.queryIds
      .filter((queryId) => queryId !== "peak_breakdown_v1");
    const mismatchedPeak = ngeeAnnGoldenSnapshot();
    if (mismatchedPeak.analysis.peakBreakdown?.status === "available") {
      mismatchedPeak.analysis.peakBreakdown.peak.averageKw = 21;
    }
    const invalidCircuit = ngeeAnnGoldenSnapshot();
    if (invalidCircuit.analysis.peakBreakdown?.status === "available") {
      invalidCircuit.analysis.peakBreakdown.levels[0]!.circuits[0]!.sharePct = null;
    }

    for (const snapshot of [absent, unavailable, wrongQuery, mismatchedPeak, invalidCircuit]) {
      const view = buildNgeeAnnOverviewViewModel(snapshot);
      expect(view.peakBreakdown).toMatchObject({ status: "unavailable", levels: [] });
      expect(view.highlights.find((highlight) => highlight.id === "peak")).toMatchObject({
        value: "20.67",
        unit: "kW",
        available: true,
      });
      expect(view.energyTrend.status).toBe("available");
    }
  });

  it("keeps partial accepted usage and an unavailable day on the authoritative date spine", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    const rows = snapshot.analysis.dailyTotals!.scopes[0]!.rows;
    rows[1]!.dataHealth = {
      status: "partial",
      coveragePct: 75,
      expectedMeterIntervalCount: 384,
      validIntervalCount: 288,
      qualityEventCount: 2,
    };
    rows[2]!.usageKwh = null;
    rows[2]!.dataHealth = {
      status: "unavailable",
      coveragePct: 0,
      expectedMeterIntervalCount: 384,
      validIntervalCount: 0,
      qualityEventCount: 1,
    };

    const trend = buildNgeeAnnOverviewViewModel(snapshot).energyTrend;

    expect(trend.status).toBe("available");
    expect(trend.scopes[0]!.limitation).toContain("not zero-filled");
    expect(trend.baselineOverlay).toMatchObject({
      status: "unavailable",
      reason: expect.stringMatching(/baseline overlay|daily totals/i),
    });
    expect(trend.scopes[0]!.points[1]).toMatchObject({
      usageKwh: "268.399",
      status: "partial",
      statusLabel: "Partial",
      coverage: "75% coverage",
      intervals: "288 / 384 valid intervals",
      qualityEvents: "2 quality events",
      baseline: null,
    });
    expect(trend.scopes[0]!.points[2]).toMatchObject({
      localDate: "2026-06-12",
      acceptedUsageKwh: null,
      usageKwh: null,
      status: "unavailable",
      statusLabel: "Unavailable",
      baseline: null,
    });
  });

  it("fails only Energy trend closed for absent or invalid optional daily totals", () => {
    const absent = ngeeAnnGoldenSnapshot();
    delete absent.analysis.dailyTotals;
    const wrongQuery = ngeeAnnGoldenSnapshot();
    wrongQuery.analysis.provenance.queryIds = wrongQuery.analysis.provenance.queryIds
      .filter((queryId) => queryId !== "daily_totals_v1");
    const brokenSpine = ngeeAnnGoldenSnapshot();
    brokenSpine.analysis.dailyTotals!.scopes[1]!.rows[2]!.localDate = "2026-06-20";
    const zeroFilledMissing = ngeeAnnGoldenSnapshot();
    zeroFilledMissing.analysis.dailyTotals!.scopes[0]!.rows[2]!.dataHealth.status = "unavailable";
    zeroFilledMissing.analysis.dailyTotals!.scopes[0]!.rows[2]!.usageKwh = 0;

    for (const snapshot of [absent, wrongQuery, brokenSpine, zeroFilledMissing]) {
      const view = buildNgeeAnnOverviewViewModel(snapshot);
      expect(view.energyTrend).toMatchObject({ status: "unavailable", scopes: [] });
      expect(view.levelComparison.status).toBe("available");
      expect(view.energyComposition.categories.status).toBe("available");
    }
  });

  it("fails the Level module closed for a legacy Snapshot without comparison facts", () => {
    const view = buildNgeeAnnOverviewViewModel(ngeeAnnGoldenSnapshot({
      levelFactsAvailable: false,
    }));

    expect(view.levelComparison).toMatchObject({
      status: "unavailable",
      reason: "This published Snapshot does not include the Level comparison and quality contract.",
      rows: [],
      evidence: {
        snapshotId: "snapshot-ngee-ann-golden",
        meterMappingRevisionId: "mapping-v1",
      },
    });
  });

  it("keeps official Categories available while Circuit and accounting contracts fail closed", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    delete snapshot.analysis.topCircuits[0]!.parentScopeId;
    delete snapshot.analysis.designatedTotals![0]!.includedInOfficialTotal;
    delete snapshot.analysis.componentReconciliation;

    const view = buildNgeeAnnOverviewViewModel(snapshot);

    expect(view.energyComposition.categories).toMatchObject({
      status: "available",
      rows: [
        { id: "load", currentUsageKwh: "1239.42" },
        { id: "light", currentUsageKwh: "291.74" },
      ],
    });
    expect(view.energyComposition.circuits).toMatchObject({
      status: "unavailable",
      rows: [],
    });
    expect(view.energyComposition.accounting).toMatchObject({
      status: "unavailable",
      designatedTotals: [],
      reconciliation: null,
    });
  });

  it("rejects an accounting contract that would count one meter as official and component", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    const reconciliation = snapshot.analysis.componentReconciliation!;
    reconciliation.componentMeterNodeIds.push(reconciliation.officialMeterNodeIds[0]!);

    const view = buildNgeeAnnOverviewViewModel(snapshot);

    expect(view.energyComposition.categories.status).toBe("available");
    expect(view.energyComposition.circuits.status).toBe("unavailable");
    expect(view.energyComposition.accounting).toMatchObject({
      status: "unavailable",
      reason: expect.stringContaining("non-overlapping"),
      reconciliation: null,
    });
  });

  it("rejects reconciliation meter sets with extra or missing identities", () => {
    const extraOfficialSnapshot = ngeeAnnGoldenSnapshot();
    extraOfficialSnapshot.analysis.componentReconciliation!.officialMeterNodeIds.push("unexpected-official-meter");
    const missingComponentSnapshot = ngeeAnnGoldenSnapshot();
    missingComponentSnapshot.analysis.componentReconciliation!.componentMeterNodeIds.pop();

    expect(buildNgeeAnnOverviewViewModel(extraOfficialSnapshot).energyComposition.accounting.status)
      .toBe("unavailable");
    expect(buildNgeeAnnOverviewViewModel(missingComponentSnapshot).energyComposition.accounting.status)
      .toBe("unavailable");
  });

  it("formats the authoritative reconciliation without recomputing it from displayed rows", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    snapshot.analysis.componentReconciliation = {
      ...snapshot.analysis.componentReconciliation!,
      officialUsageKwh: 2_000,
      componentUsageKwh: 1_500,
      gapKwh: 500,
      ratioPct: 75,
    };

    const view = buildNgeeAnnOverviewViewModel(snapshot);

    expect(view.energyComposition.accounting.reconciliation).toMatchObject({
      officialUsageKwh: "2000",
      componentUsageKwh: "1500",
      gapKwh: "500",
      ratioPct: "75%",
    });
  });

  it("fails only the Derived meter trace closed for a legacy Snapshot without the optional trace", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    delete snapshot.analysis.virtualMeterTraces;

    const view = buildNgeeAnnOverviewViewModel(snapshot);

    expect(view.energyComposition.categories.status).toBe("available");
    expect(view.energyComposition.circuits.status).toBe("available");
    expect(view.energyComposition.accounting.status).toBe("available");
    expect(view.energyComposition.derivedMeterTrace).toMatchObject({
      status: "unavailable",
      reason: "This published Snapshot does not include the server-derived meter trace contract.",
      resultUsageKwh: null,
      terms: [],
      impactedInputs: [],
    });
  });

  it("shows only affected input identities for a partial Derived meter trace", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    const trace = snapshot.analysis.virtualMeterTraces![0]!;
    const affectedTerm = trace.terms[0]!;
    trace.status = "partial";
    trace.usageKwh = null;
    trace.missingTermMeterNodeIds = [affectedTerm.meterNodeId];
    affectedTerm.inputUsageKwh = null;
    affectedTerm.contributionKwh = null;
    affectedTerm.dataHealth = null;

    const view = buildNgeeAnnOverviewViewModel(snapshot);

    expect(view.energyComposition.derivedMeterTrace).toEqual({
      status: "partial",
      reason: "Derived result unavailable because required inputs are missing.",
      meterNodeId: "ngee-ann-load-12-v1",
      name: "Load 12",
      scopeId: "level-6",
      scopeName: "Level 6",
      meterKind: "Derived",
      resultUsageKwh: null,
      includedInOfficialTotal: false,
      terms: [],
      impactedInputs: [{
        meterNodeId: "mapping-lvl-6-office-load-1-l1p1-l3p6-3",
        name: "Lvl 6 Office Load 1: L1P1-L3P6",
      }],
    });
  });

  it("rejects duplicate or missing term identities, a missing result and a wrong total marker", () => {
    const invalidSnapshots = [
      (() => {
        const snapshot = ngeeAnnGoldenSnapshot();
        snapshot.analysis.virtualMeterTraces![0]!.terms[1]!.meterNodeId =
          snapshot.analysis.virtualMeterTraces![0]!.terms[0]!.meterNodeId;
        return snapshot;
      })(),
      (() => {
        const snapshot = ngeeAnnGoldenSnapshot();
        snapshot.analysis.virtualMeterTraces![0]!.terms[0]!.meterNodeId = "";
        return snapshot;
      })(),
      (() => {
        const snapshot = ngeeAnnGoldenSnapshot();
        snapshot.analysis.virtualMeterTraces![0]!.usageKwh = null;
        return snapshot;
      })(),
      (() => {
        const snapshot = ngeeAnnGoldenSnapshot();
        const trace = snapshot.analysis.virtualMeterTraces![0]! as { includedInOfficialTotal: boolean };
        trace.includedInOfficialTotal = true;
        return snapshot;
      })(),
      (() => {
        const snapshot = ngeeAnnGoldenSnapshot();
        const term = snapshot.analysis.virtualMeterTraces![0]!.terms[0]! as { coefficient: number };
        term.coefficient = 2;
        return snapshot;
      })(),
    ];

    for (const snapshot of invalidSnapshots) {
      const view = buildNgeeAnnOverviewViewModel(snapshot);
      expect(view.energyComposition.categories.status).toBe("available");
      expect(view.energyComposition.circuits.status).toBe("available");
      expect(view.energyComposition.accounting.status).toBe("available");
      expect(view.energyComposition.derivedMeterTrace).toMatchObject({
        status: "unavailable",
        resultUsageKwh: null,
        terms: [],
      });
    }
  });

  it("rejects partial traces that retain a result or non-null facts for an affected input", () => {
    const resultRetainedSnapshot = ngeeAnnGoldenSnapshot();
    const resultRetainedTrace = resultRetainedSnapshot.analysis.virtualMeterTraces![0]!;
    const resultRetainedTerm = resultRetainedTrace.terms[0]!;
    resultRetainedTrace.status = "partial";
    resultRetainedTrace.missingTermMeterNodeIds = [resultRetainedTerm.meterNodeId];
    resultRetainedTerm.inputUsageKwh = null;
    resultRetainedTerm.contributionKwh = null;
    resultRetainedTerm.dataHealth = null;

    const affectedFactsRetainedSnapshot = ngeeAnnGoldenSnapshot();
    const affectedFactsRetainedTrace = affectedFactsRetainedSnapshot.analysis.virtualMeterTraces![0]!;
    const affectedFactsRetainedTerm = affectedFactsRetainedTrace.terms[0]!;
    affectedFactsRetainedTrace.status = "partial";
    affectedFactsRetainedTrace.usageKwh = null;
    affectedFactsRetainedTrace.missingTermMeterNodeIds = [affectedFactsRetainedTerm.meterNodeId];

    for (const snapshot of [resultRetainedSnapshot, affectedFactsRetainedSnapshot]) {
      expect(buildNgeeAnnOverviewViewModel(snapshot).energyComposition.derivedMeterTrace)
        .toMatchObject({ status: "unavailable", resultUsageKwh: null, terms: [] });
    }
  });

  it("formats server-provided Derived values without recomputing the formula result", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    const trace = snapshot.analysis.virtualMeterTraces![0]!;
    trace.usageKwh = 88;
    trace.terms[0]!.contributionKwh = 7;
    trace.terms[1]!.contributionKwh = 9;

    const derived = buildNgeeAnnOverviewViewModel(snapshot).energyComposition.derivedMeterTrace;

    expect(derived).toMatchObject({
      status: "available",
      resultUsageKwh: "88",
      terms: [
        { inputUsageKwh: "11.5379", contributionKwh: "7" },
        { inputUsageKwh: "37.4839", contributionKwh: "9" },
      ],
    });
  });

  it("matches only canonical comparison Metric IDs and their strict revisions", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    const reference = snapshot.evidence[0]!;
    snapshot.evidence = [
      {
        ...reference,
        id: "evidence:comparison-logical",
        metricId: "energy.comparison_change_kwh",
      },
      {
        ...reference,
        id: "evidence:usage-revision",
        metricId: "energy.total_usage_kwh@2",
      },
      {
        ...reference,
        id: "evidence:nearby-metric",
        metricId: "energy.total_usage_kwh_daily@1",
      },
      {
        ...reference,
        id: "evidence:malformed-revision",
        metricId: "energy.total_usage_kwh@1@shadow",
      },
    ];

    const view = buildNgeeAnnOverviewViewModel(snapshot);

    expect(view.evidence.comparison.referenceIds).toEqual([
      "evidence:comparison-logical",
      "evidence:usage-revision",
    ]);
    expect(view.evidence.cost.referenceIds).toEqual([]);
  });

  it("keeps accepted partial values visible with an actionable incomplete-data status", () => {
    const view = buildNgeeAnnOverviewViewModel(ngeeAnnGoldenSnapshot({
      dataStatus: "partial",
      coveragePct: 50,
      validIntervalCount: 1_344,
    }));

    expect(view.dataStatus).toMatchObject({
      status: "partial",
      label: "Partial data",
      coverage: "50% coverage",
      intervals: "1,344 / 2,688 valid intervals",
    });
    expect(view.dataStatus.recovery).toContain("Restore the missing source intervals");
    expect(view.highlights.find((item) => item.id === "total")).toMatchObject({
      value: "1,531.17",
      available: true,
    });
  });

  it("fails closed when no trusted interval is available and exposes only an explicit CTA hint", () => {
    const view = buildNgeeAnnOverviewViewModel(
      ngeeAnnGoldenSnapshot({
        dataStatus: "unavailable",
        coveragePct: 0,
        validIntervalCount: 0,
        lastSeenAt: null,
      }),
      {
        latestAvailableRange: { from: "2026-06-10", to: "2026-06-16" },
      },
    );

    expect(view.dataStatus).toMatchObject({
      status: "unavailable",
      label: "Unavailable",
      coverage: "0% coverage",
      intervals: "0 / 2,688 valid intervals",
    });
    expect(view.highlights.every((item) => !item.available)).toBe(true);
    expect(view.highlights.map((item) => item.value)).toEqual([
      "Unavailable",
      "Unavailable",
      "Unavailable",
      "Unavailable",
    ]);
    expect(view.componentCategoryBreakdown.status).toBe("unavailable");
    expect(view.latestAvailableRange).toEqual({ from: "2026-06-10", to: "2026-06-16" });
    expect(view.evidence.comparison.status).toBe("unavailable");
    expect(view.evidence.cost).toMatchObject({
      status: "unavailable",
      reason: "No trusted intervals support a Cost for this Period.",
      allocations: [],
      referenceIds: [],
    });
  });

  it("fails only the operating-policy split closed when its Snapshot pins do not match", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    if (snapshot.analysis.offHours.status !== "available") throw new Error("Expected available off-hours facts.");
    snapshot.analysis.offHours.businessCalendarVersion = "stale-calendar";

    const dayProfile = buildNgeeAnnOverviewViewModel(snapshot).dayProfile;

    expect(dayProfile.status).toBe("available");
    expect(dayProfile.profiles).toHaveLength(9);
    expect(dayProfile.operatingPolicy).toMatchObject({
      status: "unavailable",
      reason: expect.stringContaining("operating-policy"),
    });
  });

  it("accepts the API off-hours contract where usageKwh is the non-operating subtotal", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    if (snapshot.analysis.offHours.status !== "available") throw new Error("Expected available off-hours facts.");
    snapshot.analysis.offHours.operatingKwh = 1_200;
    snapshot.analysis.offHours.standbyKwh = 331.168324;
    snapshot.analysis.offHours.usageKwh = 331.168324;
    snapshot.analysis.offHours.sharePct = 21.63;
    snapshot.analysis.summary.usageKwh = 1_531.168324;

    expect(buildNgeeAnnOverviewViewModel(snapshot).dayProfile.operatingPolicy).toMatchObject({
      status: "available",
      operatingUsageKwh: 1_200,
      standbyUsageKwh: 331.168324,
      standbySharePct: 21.63,
    });
  });

  it("fails the component Category presentation closed when the server projection is absent", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    delete snapshot.analysis.componentCategoryBreakdown;

    const view = buildNgeeAnnOverviewViewModel(snapshot);

    expect(view.componentCategoryBreakdown).toMatchObject({
      status: "unavailable",
      scopes: [],
      rankings: [],
    });
    expect(view.componentCategoryBreakdown.reason).toContain("component Category");
  });

  it("keeps an incomplete component Category period partial without publishing incomplete totals", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    const project = snapshot.analysis.componentCategoryBreakdown!.scopes[0]!;
    const incompleteDay = project.rows[0]!;
    incompleteDay.categories[0]!.usageKwh = null;
    incompleteDay.categories[0]!.sharePct = null;
    incompleteDay.componentUsageKwh = null;
    incompleteDay.dataHealth = {
      ...incompleteDay.dataHealth,
      status: "partial",
      coveragePct: 75,
      validIntervalCount: Math.floor(incompleteDay.dataHealth.expectedMeterIntervalCount * 0.75),
    };
    Object.assign(project.period, {
      status: "partial",
      reason: "At least one daily component Category is incomplete.",
      officialUsageKwh: null,
      componentUsageKwh: null,
      gapKwh: null,
      ratioPct: null,
      categories: project.period.categories.map((category) => ({
        ...category,
        usageKwh: null,
        sharePct: null,
      })),
    });

    const view = buildNgeeAnnOverviewViewModel(snapshot);
    const period = view.componentCategoryBreakdown.scopes[0]?.period as unknown as {
      status?: string;
      officialUsageKwh?: string;
      componentUsageKwh?: string;
    };

    expect(view.componentCategoryBreakdown.status).toBe("partial");
    expect(view.componentCategoryBreakdown.reason).toContain("incomplete");
    expect(period).toMatchObject({
      status: "partial",
      officialUsageKwh: "Unavailable",
      componentUsageKwh: "Unavailable",
    });
    expect(view.componentCategoryBreakdown.scopes[0]?.rows[0]).toMatchObject({
      dataStatus: "partial",
      componentUsageKwh: "Unavailable",
    });
  });

  it.each([
    {
      name: "Scope name",
      mutate: (snapshot: GoldenSnapshot) => {
        snapshot.analysis.componentCategoryBreakdown!.scopes[0]!.scopeName = "Wrong Project";
      },
    },
    {
      name: "Scope type",
      mutate: (snapshot: GoldenSnapshot) => {
        snapshot.analysis.componentCategoryBreakdown!.scopes[0]!.scopeType = "site";
      },
    },
    {
      name: "row start",
      mutate: (snapshot: GoldenSnapshot) => {
        snapshot.analysis.componentCategoryBreakdown!.scopes[0]!.rows[0]!.from = "2026-06-09T16:30:00.000Z";
      },
    },
    {
      name: "row end",
      mutate: (snapshot: GoldenSnapshot) => {
        snapshot.analysis.componentCategoryBreakdown!.scopes[0]!.rows[0]!.to = "2026-06-10T15:30:00.000Z";
      },
    },
  ])("fails the component Category contract closed for a mismatched $name", ({ mutate }) => {
    const snapshot = ngeeAnnGoldenSnapshot();
    mutate(snapshot);

    expect(buildNgeeAnnOverviewViewModel(snapshot).componentCategoryBreakdown).toMatchObject({
      status: "unavailable",
      scopes: [],
      rankings: [],
    });
  });

  it("shows Cost as Unavailable when the Snapshot has no effective Tariff", () => {
    const view = buildNgeeAnnOverviewViewModel(ngeeAnnGoldenSnapshot({ costAvailable: false }));

    expect(view.highlights.find((item) => item.id === "cost")).toEqual(expect.objectContaining({
      value: "Unavailable",
      available: false,
      detail: "No effective Tariff covers the selected period.",
    }));
    expect(view.evidence.cost).toEqual({
      status: "unavailable",
      reason: "No effective Tariff covers the selected period.",
      tariffScheduleVersion: "tariff-v1",
      allocations: [],
      queryIds: view.evidence.queryIds,
      referenceIds: [],
    });
  });

  it("uses the approved day grain for a single local day when the authoritative daily total is present", () => {
    const view = buildNgeeAnnOverviewViewModel(
      ngeeAnnSingleDaySnapshot(),
      { trendGrain: "day" },
    );

    expect(view.energyTrend).toMatchObject({
      status: "available",
      grain: "day",
      decisionQuestion: "When did accepted energy use change inside the selected Period?",
      evidence: { queryIds: ["daily_totals_v1"] },
    });
    expect(view.energyTrend.scopes[0]!.points).toHaveLength(1);
    expect(view.energyTrend.scopes[0]!.points[0]).toMatchObject({
      localDate: "2026-06-16",
      localHour: null,
      usageKwh: "221.9982",
    });
  });

  it("formats one grouped recurrence theme with three deterministic Evidence horizons", () => {
    const view = buildNgeeAnnOverviewViewModel(ngeeAnnGoldenSnapshot());

    expect(view.decisionPriorities).toMatchObject({
      status: "available",
      limitation: null,
      items: [
        {
          rank: 1,
          finding: "Ngee Ann Polytechnic recorded 3 distinct daily usage exceptions in this Snapshot.",
          evidence: "Project / 13 Jun / 168.96 kWh vs 63.34 kWh baseline (+166.8%)",
          impact: "105.6 kWh above comparable days. Cost impact is not available yet.",
          targetIncidentId: "incident:project:2026-06-13",
          explorerScopeId: "level-7",
          explorerScopeName: "Level 7",
          confidence: "Complete Evidence",
          sourceOccurrenceCount: 7,
          recurrenceDayCount: 3,
          horizons: [
            {
              label: "Latest complete day",
              actualKwh: 221.9982,
              baselineKwh: 218.885,
              deltaKwh: 3.1132,
              relativePct: 1.4223,
              comparison: "222 kWh vs 218.88 kWh (+1.4%)",
            },
            {
              label: "Rolling 7 days",
              actualKwh: 1531.1683,
              baselineKwh: 1211.6773,
              deltaKwh: 319.491,
              relativePct: 26.3677,
              comparison: "1531.17 kWh vs 1211.68 kWh (+26.4%)",
            },
            {
              label: "Rolling 28 days",
              status: "available",
              actualKwh: 4904.8659,
              baselineKwh: 4831.5555,
              deltaKwh: 73.3104,
              relativePct: 1.5173,
              comparison: "4904.87 kWh vs 4831.56 kWh (+1.5%)",
            },
          ],
          driver: "Level 7 contributed +88.1 kWh to the selected exception. Meter data locates the issue; it does not confirm the operational cause.",
        },
      ],
    });
  });

  it("keeps current Level, Category and Circuit concentration visible when comparisons are absent", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    for (const level of snapshot.analysis.childScopes.filter((scope) => scope.nodeType === "level")) {
      delete level.comparison;
    }
    for (const category of snapshot.analysis.categories) delete category.comparison;
    for (const circuit of snapshot.analysis.circuits) delete circuit.comparison;

    const view = buildNgeeAnnOverviewViewModel(snapshot);

    expect(view.levelComparison).toMatchObject({
      status: "available",
      summary: {
        currentConcentration: {
          status: "available",
          name: "Level 7",
          currentUsageKwh: "1054.18",
          projectShare: "68.8%",
        },
        measuredChange: {
          status: "unavailable",
          reason: expect.stringContaining("comparison"),
        },
      },
      rows: expect.arrayContaining([
        expect.objectContaining({
          name: "Level 7",
          currentUsageKwh: "1054.18",
          projectShare: "68.8%",
          movement: { status: "unavailable", reason: expect.stringContaining("comparison") },
        }),
      ]),
    });
    expect(view.energyComposition.categories).toMatchObject({
      status: "available",
      summary: {
        currentConcentration: {
          status: "available",
          name: "Load",
          currentUsageKwh: "1239.42",
          projectShare: "80.9%",
        },
        measuredChange: { status: "unavailable", reason: expect.stringContaining("comparison") },
      },
      rows: expect.arrayContaining([
        expect.objectContaining({
          name: "Load",
          currentUsageKwh: "1239.42",
          projectShare: "80.9%",
          movement: { status: "unavailable", reason: expect.stringContaining("comparison") },
        }),
      ]),
    });
    expect(view.energyComposition.circuits).toMatchObject({
      status: "available",
      rows: expect.arrayContaining([
        expect.objectContaining({
          rank: 1,
          currentUsageKwh: "439.1",
          movement: { status: "unavailable", reason: expect.stringContaining("comparison") },
        }),
      ]),
    });
  });

  it("withholds movement when the previous baseline is zero but keeps current contributor facts", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    const level = snapshot.analysis.childScopes.find((scope) => scope.nodeType === "level");
    const category = snapshot.analysis.categories[0];
    const circuit = snapshot.analysis.circuits.find((row) => row.includedInOfficialTotal === false);
    if (!level?.comparison || !category?.comparison || !circuit?.comparison) {
      throw new Error("Expected contributor comparison fixtures.");
    }
    level.comparison.usageKwh = 0;
    level.comparison.changePct = null;
    category.comparison.usageKwh = 0;
    category.comparison.changePct = null;
    circuit.comparison.usageKwh = 0;
    circuit.comparison.changePct = null;

    const view = buildNgeeAnnOverviewViewModel(snapshot);

    expect(view.levelComparison.rows.find((row) => row.id === level.nodeId)?.movement.status).toBe("unavailable");
    expect(view.energyComposition.categories.rows.find((row) => row.id === category.category)?.movement.status).toBe("unavailable");
    expect(view.energyComposition.circuits.rows.find((row) => row.meterNodeId === circuit.meterNodeId)?.movement.status).toBe("unavailable");
    expect(view.levelComparison.summary.currentConcentration.status).toBe("available");
    expect(view.levelComparison.summary.measuredChange.status).toBe("unavailable");
  });

  it.each(rollingBoundaryTamperCases)(
    "fails decision priorities closed for tampered $name boundaries",
    ({ mutate }) => {
      const snapshot = ngeeAnnGoldenSnapshot();
      mutate(snapshot);

      const view = buildNgeeAnnOverviewViewModel(snapshot);

      expect(view.dailyAnomalies.status).toBe("available");
      expect(view.decisionPriorities).toMatchObject({
        status: "unavailable",
        items: [],
      });
    },
  );

  it("accepts empty priorities only when the anomaly bundle has no triggered or suppressed outcomes", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    for (const scope of dailyAnomalyBundle(snapshot).scopes) {
      for (const row of scope.rows) {
        makeWithinThreshold(row);
      }
    }
    snapshot.decisionPriorities = {
      ...snapshot.decisionPriorities!,
      status: "empty",
      limitation: null,
      items: [],
    };

    expect(buildNgeeAnnOverviewViewModel(snapshot).decisionPriorities).toMatchObject({
      status: "empty",
      limitation: null,
      items: [],
    });
  });

  it("accepts partial priorities only when the anomaly bundle contains suppressed outcomes", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    const suppressed = dailyAnomalyBundle(snapshot).scopes[0]!.rows[0]!;
    suppressed.outcome = "suppressed";
    suppressed.suppressionReason = {
      code: "CALENDAR_EXCEPTION_DATE",
      message: "The date is excluded by the pinned Calendar.",
    };
    snapshot.decisionPriorities = {
      ...snapshot.decisionPriorities!,
      status: "partial",
      limitation: {
        code: "SOME_CANDIDATE_DATES_SUPPRESSED",
        message: "Some candidate dates were suppressed.",
      },
    };

    expect(buildNgeeAnnOverviewViewModel(snapshot).decisionPriorities).toMatchObject({
      status: "partial",
      limitation: "Some candidate dates were suppressed.",
      items: [{ rank: 1 }],
    });
  });

  it("accepts suppressed priorities only when the anomaly bundle has suppressed but no triggered outcomes", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    for (const scope of dailyAnomalyBundle(snapshot).scopes) {
      for (const row of scope.rows) {
        row.outcome = "suppressed";
        row.suppressionReason = {
          code: "CALENDAR_EXCEPTION_DATE",
          message: "The date is excluded by the pinned Calendar.",
        };
      }
    }
    snapshot.decisionPriorities = {
      ...snapshot.decisionPriorities!,
      status: "suppressed",
      limitation: {
        code: "ALL_CANDIDATE_DATES_SUPPRESSED",
        message: "All candidate dates were suppressed.",
      },
      items: [],
    };

    expect(buildNgeeAnnOverviewViewModel(snapshot).decisionPriorities).toMatchObject({
      status: "suppressed",
      limitation: "All candidate dates were suppressed.",
      items: [],
    });
  });

  it.each(["empty", "suppressed", "partial"] as const)(
    "fails a forged zero-item %s state closed when the anomaly bundle has triggered outcomes",
    (status) => {
      const snapshot = ngeeAnnGoldenSnapshot();
      snapshot.decisionPriorities = {
        ...snapshot.decisionPriorities!,
        status,
        limitation: status === "empty" ? null : {
          code: status === "suppressed"
            ? "ALL_CANDIDATE_DATES_SUPPRESSED"
            : "SOME_CANDIDATE_DATES_SUPPRESSED",
          message: "Forged priority status.",
        },
        items: [],
      };

      expect(buildNgeeAnnOverviewViewModel(snapshot).decisionPriorities).toMatchObject({
        status: "unavailable",
        items: [],
      });
    },
  );

  it("fails priorities closed when supporting incident IDs omit an exact same-date sibling", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    snapshot.decisionPriorities!.items[0]!.evidence.supportingIncidentIds.pop();

    expect(buildNgeeAnnOverviewViewModel(snapshot).decisionPriorities).toMatchObject({
      status: "unavailable",
      items: [],
    });
  });

  it("fails a suppressed priority state closed when anomaly outcomes are mixed", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    for (const scope of dailyAnomalyBundle(snapshot).scopes) {
      for (const row of scope.rows) {
        makeWithinThreshold(row);
      }
    }
    const mixedSuppressed = dailyAnomalyBundle(snapshot).scopes[0]!.rows[0]!;
    mixedSuppressed.outcome = "suppressed";
    mixedSuppressed.suppressionReason = {
      code: "CALENDAR_EXCEPTION_DATE",
      message: "The date is excluded by the pinned Calendar.",
    };
    snapshot.decisionPriorities = {
      ...snapshot.decisionPriorities!,
      status: "suppressed",
      limitation: {
        code: "ALL_CANDIDATE_DATES_SUPPRESSED",
        message: "All candidate dates were suppressed.",
      },
      items: [],
    };

    expect(buildNgeeAnnOverviewViewModel(snapshot).decisionPriorities.status).toBe("unavailable");
  });

  it("fails SOME_CANDIDATE_DATES_SUPPRESSED closed for all-suppressed rows or items without a trigger", () => {
    const allSuppressed = ngeeAnnGoldenSnapshot();
    for (const scope of dailyAnomalyBundle(allSuppressed).scopes) {
      for (const row of scope.rows) {
        row.outcome = "suppressed";
        row.suppressionReason = {
          code: "CALENDAR_EXCEPTION_DATE",
          message: "The date is excluded by the pinned Calendar.",
        };
      }
    }
    allSuppressed.decisionPriorities = {
      ...allSuppressed.decisionPriorities!,
      status: "partial",
      limitation: {
        code: "SOME_CANDIDATE_DATES_SUPPRESSED",
        message: "Some candidate dates were suppressed.",
      },
      items: [],
    };

    const noTriggerWithItems = ngeeAnnGoldenSnapshot();
    for (const scope of dailyAnomalyBundle(noTriggerWithItems).scopes) {
      for (const row of scope.rows) {
        makeWithinThreshold(row);
      }
    }
    const suppressed = dailyAnomalyBundle(noTriggerWithItems).scopes[0]!.rows[0]!;
    suppressed.outcome = "suppressed";
    suppressed.suppressionReason = {
      code: "CALENDAR_EXCEPTION_DATE",
      message: "The date is excluded by the pinned Calendar.",
    };
    noTriggerWithItems.decisionPriorities!.status = "partial";
    noTriggerWithItems.decisionPriorities!.limitation = {
      code: "SOME_CANDIDATE_DATES_SUPPRESSED",
      message: "Some candidate dates were suppressed.",
    };

    for (const snapshot of [allSuppressed, noTriggerWithItems]) {
      expect(buildNgeeAnnOverviewViewModel(snapshot).decisionPriorities.status).toBe("unavailable");
    }
  });

  it("fails available and SUPPORTING_EVIDENCE_PARTIAL states closed when confidence or suppression outcomes disagree", () => {
    const availablePartialConfidence = ngeeAnnGoldenSnapshot();
    const confidenceLimitation = {
      code: "SUPPORTING_EVIDENCE_PARTIAL" as const,
      message: "Supporting Evidence is partial.",
    };
    availablePartialConfidence.decisionPriorities!.items[0]!.confidence = {
      status: "partial",
      limitation: confidenceLimitation,
    };

    const availableWithSuppression = ngeeAnnGoldenSnapshot();
    const availableSuppressedRow = dailyAnomalyBundle(availableWithSuppression).scopes[0]!.rows[0]!;
    availableSuppressedRow.outcome = "suppressed";
    availableSuppressedRow.suppressionReason = {
      code: "CALENDAR_EXCEPTION_DATE",
      message: "The date is excluded by the pinned Calendar.",
    };

    const partialWithSuppression = ngeeAnnGoldenSnapshot();
    partialWithSuppression.decisionPriorities!.status = "partial";
    partialWithSuppression.decisionPriorities!.limitation = confidenceLimitation;
    partialWithSuppression.decisionPriorities!.items[0]!.confidence = {
      status: "partial",
      limitation: confidenceLimitation,
    };
    const suppressed = dailyAnomalyBundle(partialWithSuppression).scopes[0]!.rows[0]!;
    suppressed.outcome = "suppressed";
    suppressed.suppressionReason = {
      code: "CALENDAR_EXCEPTION_DATE",
      message: "The date is excluded by the pinned Calendar.",
    };

    const partialWithoutPartialConfidence = ngeeAnnGoldenSnapshot();
    partialWithoutPartialConfidence.decisionPriorities!.status = "partial";
    partialWithoutPartialConfidence.decisionPriorities!.limitation = confidenceLimitation;

    for (const snapshot of [
      availablePartialConfidence,
      availableWithSuppression,
      partialWithSuppression,
      partialWithoutPartialConfidence,
    ]) {
      expect(buildNgeeAnnOverviewViewModel(snapshot).decisionPriorities.status).toBe("unavailable");
    }
  });

  it("withholds only priorities when their order or anomaly Evidence contract is invalid", () => {
    const invalidRank = ngeeAnnGoldenSnapshot();
    invalidRank.decisionPriorities!.items[0]!.rank = 2;
    const invalidPins = ngeeAnnGoldenSnapshot();
    invalidPins.decisionPriorities!.evidencePins.dataSnapshotId = "snapshot-other";
    const invalidHorizon = ngeeAnnGoldenSnapshot();
    invalidHorizon.decisionPriorities!.items[0]!.horizons[1]!.actualKwh = 1;
    const invalidEmptySource = ngeeAnnGoldenSnapshot();
    invalidEmptySource.decisionPriorities = {
      ...invalidEmptySource.decisionPriorities!,
      status: "empty",
      limitation: null,
      items: [],
    };
    invalidEmptySource.analysis.dailyUsageAnomalies!.ruleRevisionId = "rule-other";

    for (const snapshot of [invalidRank, invalidPins, invalidHorizon]) {
      const view = buildNgeeAnnOverviewViewModel(snapshot);
      expect(view.decisionPriorities).toMatchObject({
        status: "unavailable",
        items: [],
      });
      expect(view.dailyAnomalies.status).toBe("available");
      expect(view.highlights.find((item) => item.id === "total")?.available).toBe(true);
    }

    const invalidEmptySourceView = buildNgeeAnnOverviewViewModel(invalidEmptySource);
    expect(invalidEmptySourceView.decisionPriorities).toMatchObject({
      status: "unavailable",
      items: [],
    });
    expect(invalidEmptySourceView.dailyAnomalies.status).toBe("unavailable");
    expect(invalidEmptySourceView.highlights.find((item) => item.id === "total")?.available).toBe(true);
  }, 10_000);
});
