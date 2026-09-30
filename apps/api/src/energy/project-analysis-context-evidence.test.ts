import { describe, expect, it } from "vitest";

import { createProjectAnalysisContextEvidenceCatalog } from "./project-analysis-context-evidence.js";
import type { ProjectAnalysisSnapshot } from "./project-analysis-resolver.js";

describe("ProjectAnalysisSnapshot Context Evidence catalog", () => {
  it("projects released values and exact current Snapshot pins without recalculating them", () => {
    const catalog = createProjectAnalysisContextEvidenceCatalog(snapshot());

    expect(catalog).toMatchObject({
      contract: "analysis-context-evidence@1",
      sourceId: "project-analysis-snapshot:preschool-demo:snapshot-current",
      pins: {
        workspaceId: "preschool-demo-org",
        projectId: "preschool-demo",
        scopeId: "preschool-project",
        dataSnapshotId: "snapshot-current",
        dataCutoff: "2026-05-31T16:00:00.000Z",
        projectReleaseId: "release-current",
        metricVersion: "metrics-current",
      },
    });
    expect(catalog.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "analysis.summary.usage_kwh",
        value: 24_921.8123,
        unit: "kWh",
        evidenceRefs: ["evidence-current"],
      }),
      expect.objectContaining({
        id: "analysis.comparison.change_pct",
        dimensions: expect.objectContaining({
          comparison: "previous-period",
          comparedMetricId: "energy.total_usage_kwh",
          scopeId: "preschool-project",
        }),
      }),
      expect.objectContaining({
        id: "analysis.child_scopes.centre-a.usage_kwh",
        dimensions: expect.objectContaining({
          scopeId: "centre-a",
          centreCode: "A",
        }),
      }),
      expect.objectContaining({
        id: "preschool.benchmark.centres.centre-a.annualised_eui",
        value: 13.62,
        unit: "kWh/m2/year",
        status: "provisional",
      }),
      expect.objectContaining({
        id: "preschool.benchmark.cohorts.senior%20care%20center.eui.p75",
        value: 9.2,
        dimensions: expect.objectContaining({ cohort: "Senior Care Center", percentile: "p75" }),
      }),
      expect.objectContaining({
        id: "analysis.off_hours.usage_kwh",
        value: 120,
        dimensions: { calendarVersion: "calendar-current" },
      }),
      expect.objectContaining({
        id: "analysis.hourly_profile.07.usage_kwh",
        metricId: "energy.hourly_usage_kwh",
        value: 80,
        dimensions: expect.objectContaining({ localHour: "7" }),
      }),
      expect.objectContaining({
        id: "analysis.hourly_profile.07.peak_kw",
        metricId: "energy.hourly_peak_kw",
        value: 16,
        dimensions: expect.objectContaining({ localHour: "7" }),
      }),
      expect.objectContaining({
        id: "analysis.hourly_profile.23.peak_kw",
        dimensions: expect.objectContaining({ observationCount: "31" }),
      }),
      expect.objectContaining({
        id: "preschool.operational.closed_hour_spikes.count",
        value: 4,
      }),
      expect.objectContaining({
        id: "preschool.operational.closed_hour_spikes.centre-l.top.impact_kwh",
        value: 26.2,
        dimensions: expect.objectContaining({ localHour: "22", centreCode: "L" }),
      }),
      expect.objectContaining({
        id: "preschool.decision_signals.after-hours.after-hours-share",
        metricId: "energy.off_hours_share_pct",
        value: 12.5,
        unit: "%",
        evidenceRefs: ["evidence-current", "operational-query", "preschool-hour-slot-spike-v1"],
        dimensions: expect.objectContaining({
          signalId: "after-hours",
          sectionId: "operating-behaviour",
          centreCodes: "L,E",
        }),
      }),
    ]));
  });

  it("does not grant Evidence identity when the Snapshot has no Evidence refs", () => {
    const input = snapshot();
    input.evidence = [];

    expect(createProjectAnalysisContextEvidenceCatalog(input).facts).toEqual([]);
  });

  it("preserves partial data status and fails closed for an unavailable current Snapshot", () => {
    const partial = snapshot();
    partial.dataQuality = { status: "partial" } as never;
    expect(createProjectAnalysisContextEvidenceCatalog(partial).facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "analysis.summary.usage_kwh", status: "partial" }),
      expect.objectContaining({ id: "preschool.benchmark.centres.centre-a.annualised_eui", status: "partial" }),
    ]));

    const unavailable = snapshot();
    unavailable.dataQuality = { status: "unavailable" } as never;
    expect(createProjectAnalysisContextEvidenceCatalog(unavailable).facts).toEqual([]);
  });
});

const snapshot = (): ProjectAnalysisSnapshot => ({
  context: {
    userId: "user-1",
    workspaceId: "preschool-demo-org",
    projectId: "preschool-demo",
    projectName: "Preschool Portfolio",
    scopeId: "preschool-project",
    scopeName: "Preschool Portfolio",
    scopeType: "project",
    resource: "electricity",
    timezone: "Asia/Singapore",
    from: "2026-04-30T16:00:00.000Z",
    to: "2026-05-31T16:00:00.000Z",
    endExclusive: true,
    period: "Custom",
    hierarchyRevisionId: "hierarchy-current",
    meterMappingRevisionId: "mapping-current",
    meterFormulaRevisionId: "formula-current",
    dataSnapshotId: "snapshot-current",
    metricVersion: "metrics-current",
    businessCalendarVersion: "calendar-current",
    tariffScheduleVersion: "tariff-current",
    resolvedAt: "2026-06-01T01:00:00.000Z",
    primaryPeriod: {
      start: "2026-04-30T16:00:00.000Z",
      endExclusive: "2026-05-31T16:00:00.000Z",
    },
    projectReleaseId: "release-current",
  },
  projectRelease: {
    id: "release-current",
    source: "template-revision",
    projectId: "preschool-demo",
    templateRevisionId: "template-1",
    templateRevisionSequence: 1,
    reportTimePolicyRevisionId: "preschool-report-time@2",
    recipe: { id: "energy-scope-analysis", version: "1" },
    renderer: { key: "preschool-overview", version: "1", contractVersion: "project-analysis-snapshot@1" },
    hierarchyRevisionId: "hierarchy-current",
    meterMappingRevisionId: "mapping-current",
    meterFormulaRevisionId: "formula-current",
    metricRevisionIds: ["energy.total_usage_kwh@1"],
    ruleRevisionIds: [],
    businessCalendarVersion: "calendar-current",
    tariffScheduleVersion: "tariff-current",
    publishedAt: "2026-06-01T00:00:00.000Z",
    document: {} as never,
    catalog: [],
  },
  recipe: { id: "energy-scope-analysis", version: "1" },
  renderer: { key: "preschool-overview", version: "1", contractVersion: "project-analysis-snapshot@1" },
  dataQuality: { status: "complete" } as never,
  evidence: [{ id: "evidence-current", metricId: "energy.total_usage_kwh@1", queryIds: ["scope_summary_v1"] }],
  findings: [],
  dataSnapshot: { id: "snapshot-current", importBatchIds: ["batch-current"], lastSeenAt: "2026-06-01T00:00:00.000Z" },
  metadata: {
    status: "provisional",
    hierarchyRevisionId: "hierarchy-current",
    timezone: "Asia/Singapore",
    period: { start: "2026-04-30T16:00:00.000Z", endExclusive: "2026-05-31T16:00:00.000Z" },
    selectedScope: { status: "missing" },
    comparisonScopes: [],
    evidence: [],
  } as never,
  analysis: {
    summary: { usageKwh: 24_921.8123, peakKw: 1_000 },
    hourlyProfile: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      usageKwh: hour === 7 ? 80 : hour === 8 ? 120 : 40 + hour,
      averageKw: hour === 7 ? 10 : hour === 8 ? 15 : 5,
      peakKw: hour === 7 ? 16 : hour === 8 ? 22 : 5 + hour,
      observationCount: 31,
    })),
    comparison: { usageKwh: 24_000, changeKwh: 921.8123, changePct: 3.84 },
    categories: [],
    childScopes: [{
      nodeId: "centre-a",
      name: "Centre A",
      nodeType: "centre",
      usageKwh: 843.1,
      sharePct: 3.38,
      comparison: { usageKwh: 800, changeKwh: 43.1, changePct: 5.39 },
      dataHealth: { status: "complete" },
      kwhPerSqm: 1.135,
      kwhPerPerson: 14.5,
      metadata: { status: "provisional" },
    }],
    topCircuits: [],
    offHours: { status: "available", usageKwh: 120, sharePct: 0.48 },
  } as never,
  preschoolOperational: {
    status: "available",
    evidence: {
      projectReleaseId: "release-current",
      dataSnapshotId: "snapshot-current",
      hierarchyRevisionId: "hierarchy-current",
      meterMappingRevisionId: "mapping-current",
      metricRevisionIds: [],
      businessCalendarVersion: "calendar-current",
      sourceQueryIds: [],
      projectionQueryId: "preschool_centre_hour_appliance_cells_v2",
      projectionRecipeIds: [
        "preschool-hour-slot-spike-v1",
        "preschool-after-hours-sop-signal-v1",
        "preschool-operating-state-appliance-v1",
      ],
      baseline: "same-centre same-hour-slot mean within operating state",
    },
    spikes: {
      standby: {
        count: 4,
        centreCount: 1,
        centres: [{
          scopeId: "centre-l",
          centreCode: "L",
          name: "Centre L",
          centreType: "Preschool",
          spikeCount: 4,
          worstSpike: {
            localDate: "2026-05-19",
            localHour: 22,
            dayType: "weekday",
            usageKwh: 30.8,
            baselineKwh: 4.6,
            impactKwh: 26.2,
            variancePct: 569.6,
            leadingCircuitName: "Heater",
            leadingCircuitKwh: 18.4,
            leadingCircuitSharePct: 59.7,
          },
          events: [],
        }],
      },
      operating: { count: 0, centreCount: 0, centres: [] },
    },
  } as never,
  preschoolBenchmark: {
    status: "provisional",
    contract: { id: "preschool-may-2026-benchmark", version: "1", annualisationFactor: 12 },
    period: { start: "2026-04-30T16:00:00.000Z", endExclusive: "2026-05-31T16:00:00.000Z", timezone: "Asia/Singapore" },
    sampleSize: 30,
    portfolio: {
      eui: { p50: 6.8, p75: 10.5, unit: "kWh/m2/year" },
      perPax: { p50: 18.1, p75: 20.7, unit: "kWh/person/month" },
    },
    cohorts: [{
      name: "Senior Care Center",
      sampleSize: 14,
      eui: { p50: 6.76, p75: 9.2, unit: "kWh/m2/year" },
      perPax: { p50: 18.5, p75: 20.7, unit: "kWh/person/month" },
    }],
    centres: [{
      scopeId: "centre-a",
      centreCode: "A",
      name: "Centre A",
      cohort: "Senior Care Center",
      usageKwh: 843.1,
      annualisedEuiKwhPerSqmYear: 13.62,
      mayKwhPerPerson: 14.5,
      quadrant: "eui-intensive",
      priority: false,
    }],
    priorityCentreCodes: [],
    evidence: {} as never,
  },
  preschoolDecisionSignals: {
    contract: { id: "preschool-decision-signals", version: "1" },
    context: {
      projectReleaseId: "release-current",
      dataSnapshotId: "snapshot-current",
      period: {
        start: "2026-04-30T16:00:00.000Z",
        endExclusive: "2026-05-31T16:00:00.000Z",
        timezone: "Asia/Singapore",
      },
    },
    status: "available",
    items: [{
      id: "after-hours",
      kind: "after-hours-energy",
      sectionId: "operating-behaviour",
      priority: 1,
      severity: "attention",
      label: "Energy used after closing",
      metrics: [{
        id: "after-hours-share",
        label: "Share used after closing",
        metricId: "energy.off_hours_share_pct",
        value: 12.5,
        unit: "%",
        role: "primary",
        precision: 1,
        dimensions: { operatingState: "closed" },
      }],
      entities: [
        { kind: "centre", scopeId: "centre-l", code: "L", name: "Centre L" },
        { kind: "centre", scopeId: "centre-e", code: "E", name: "Centre E" },
      ],
      evidenceRefs: ["operational-query", "preschool-hour-slot-spike-v1"],
      limitations: [{
        code: "CAUSE_NOT_OBSERVED",
        label: "Meter data shows when energy was used, not why equipment was running.",
      }],
    }],
  },
});
