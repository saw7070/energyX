import { describe, expect, it } from "vitest";

import type { EnergyDailyUsageAnomalies } from "./energy-analysis.js";
import { buildNgeeAnnDecisionPriorities } from "./ngee-ann-decision-priorities.js";

type AvailableAnomalies = Extract<EnergyDailyUsageAnomalies, { status: "available" }>;
type AnomalyRow = AvailableAnomalies["scopes"][number]["rows"][number];
type AnomalyDetailSeries = AnomalyRow["detailSeries"][number];

const evidencePins: AvailableAnomalies["evidencePins"] = {
  projectReleaseId: "release@1",
  dataSnapshotId: "snapshot@1",
  hierarchyRevisionId: "hierarchy@1",
  meterMappingRevisionId: "mapping@1",
  meterFormulaRevisionId: "formula@1",
  metricVersion: "metric-revisions:energy.total_usage_kwh@1",
  businessCalendarVersion: "calendar@1",
  queryIds: ["time_slot_anomaly_v1"],
};

const anomalyRow = (input: {
  incidentId: string;
  localDate?: string;
  impactKwh: number;
  outcome?: AnomalyRow["outcome"];
}): AnomalyRow => ({
  anomalyId: `anomaly:${input.incidentId}`,
  incidentId: input.incidentId,
  ruleRevisionId: "comparison.daily_usage_above_baseline@1",
  metricId: "energy.total_usage_kwh@1",
  queryId: "time_slot_anomaly_v1",
  localDate: input.localDate ?? "2026-06-16",
  from: `${input.localDate ?? "2026-06-16"}T00:00:00+08:00`,
  to: `${input.localDate ?? "2026-06-16"}T24:00:00+08:00`,
  dayType: "weekday",
  baselineDates: ["2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05"],
  baselineSampleCount: 4,
  baselineSamples: [],
  actualKwh: 100 + input.impactKwh,
  baselineKwh: 100,
  impactKwh: input.impactKwh,
  relativePct: input.impactKwh,
  thresholds: {
    relativeThresholdPct: 20,
    absoluteImpactKwh: 20,
    minimumCoveragePct: 95,
    maximumQualityEventCount: 0,
  },
  coveragePct: 100,
  expectedMeterIntervalCount: 96,
  validIntervalCount: 96,
  qualityEventCount: 0,
  outcome: input.outcome ?? "triggered",
  hourlyComparison: [],
  detailSeries: [],
});

const driverSeries = (impactKwh: number): AnomalyDetailSeries => ({
  seriesId: `driver:${String(impactKwh)}`,
  relationship: "immediate_level",
  kind: "official_scope",
  scopeId: "level-7",
  scopeName: "Level 7",
  includedInOfficialTotal: true,
  status: "available",
  selectedTotalKwh: 100,
  baselineTotalKwh: 100,
  impactKwh,
  relativePct: 0,
  coveragePct: 100,
  expectedMeterIntervalCount: 96,
  validIntervalCount: 96,
  qualityEventCount: 0,
  points: [],
});

const anomalies = (scopes: Array<
  Omit<AvailableAnomalies["scopes"][number], "rollingComparisons">
  & { rollingComparisons?: AvailableAnomalies["scopes"][number]["rollingComparisons"] }
>): AvailableAnomalies => ({
  status: "available",
  bundleId: "daily-usage-anomalies:snapshot@1:release@1:calendar@1",
  metricId: "energy.total_usage_kwh@1",
  queryId: "time_slot_anomaly_v1",
  ruleRevisionId: "comparison.daily_usage_above_baseline@1",
  timezone: "Asia/Singapore",
  baselineCutoff: "2026-06-10",
  rule: {
    relativeThresholdPct: 20,
    absoluteImpactKwh: 20,
    minimumCoveragePct: 95,
    minimumSampleCount: 4,
    maximumQualityEventCount: 0,
    maximumLookbackDays: 60,
    direction: "above",
    baselineMethod: "mean_of_complete_comparable_days_by_local_hour",
  },
  evidencePins,
  scopes: scopes.map((scope) => ({
    ...scope,
    rollingComparisons: scope.rollingComparisons ?? [
      {
        horizon: "rolling_7d",
        cutoffLocalDate: "2026-06-16",
        current: { fromLocalDate: "2026-06-10", toLocalDate: "2026-06-16", totalKwh: 770, completeDayCount: 7 },
        baseline: { fromLocalDate: "2026-06-03", toLocalDate: "2026-06-09", totalKwh: 700, completeDayCount: 7 },
        status: "available",
        deltaKwh: 70,
        relativePct: 10,
      },
      {
        horizon: "rolling_28d",
        cutoffLocalDate: "2026-06-16",
        current: { fromLocalDate: "2026-05-20", toLocalDate: "2026-06-16", totalKwh: 3080, completeDayCount: 28 },
        baseline: { fromLocalDate: "2026-04-22", toLocalDate: "2026-05-19", totalKwh: 2800, completeDayCount: 28 },
        status: "available",
        deltaKwh: 280,
        relativePct: 10,
      },
    ],
  })),
});

const build = (
  dailyUsageAnomalies: EnergyDailyUsageAnomalies | undefined,
  selectedScopeId = "project",
) =>
  buildNgeeAnnDecisionPriorities({
    selectedScopeId,
    primaryPeriod: {
      start: "2026-06-09T16:00:00.000Z",
      endExclusive: "2026-06-16T16:00:00.000Z",
    },
    expectedEvidencePins: evidencePins,
    dailyUsageAnomalies,
  });

describe("Ngee Ann decision priorities", () => {
  it("assembles repeated daily exceptions into one multi-horizon decision theme", () => {
    const result = build(anomalies([{
      scopeId: "project",
      scopeName: "Ngee Ann Polytechnic",
      scopeType: "project",
      rows: [
        anomalyRow({ incidentId: "project-14", localDate: "2026-06-14", impactKwh: 60 }),
        anomalyRow({ incidentId: "project-15", localDate: "2026-06-15", impactKwh: 70 }),
        anomalyRow({ incidentId: "project-16", localDate: "2026-06-16", impactKwh: 50 }),
      ],
    }]));

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      sourceOccurrenceIds: ["project-14", "project-15", "project-16"],
      recurrenceDayCount: 3,
      horizons: [
        { horizon: "latest_complete_day", label: "Latest complete day" },
        { horizon: "rolling_7d", label: "Rolling 7 days" },
        {
          horizon: "rolling_28d",
          label: "Rolling 28 days",
          status: "available",
          actualKwh: 3080,
          baselineKwh: 2800,
          deltaKwh: 280,
          relativePct: 10,
        },
      ],
      action: {
        targetRef: { kind: "daily_usage_incident", id: "project-15" },
        verificationMetricRef: { metricId: "energy.total_usage_kwh@1" },
      },
    });
  });

  it("deduplicates Project and Level occurrences on the same rule, metric and local date", () => {
    const result = build(anomalies([
      {
        scopeId: "project",
        scopeName: "Ngee Ann Polytechnic",
        scopeType: "project",
        rows: [anomalyRow({ incidentId: "project-incident", impactKwh: 50 })],
      },
      {
        scopeId: "level-6",
        scopeName: "Level 6",
        scopeType: "level",
        rows: [anomalyRow({ incidentId: "level-6-incident", impactKwh: 30 })],
      },
      {
        scopeId: "level-7",
        scopeName: "Level 7",
        scopeType: "level",
        rows: [anomalyRow({ incidentId: "level-7-incident", impactKwh: 20 })],
      },
    ]));

    expect(result).toMatchObject({
      status: "available",
      limitation: null,
      evidencePins,
      items: [{
        rank: 1,
        source: "daily_usage_anomaly",
        finding: {
          code: "DAILY_USAGE_ABOVE_BASELINE",
          actualKwh: 150,
          baselineKwh: 100,
          relativePct: 50,
        },
        evidence: {
          primaryIncidentId: "project-incident",
          supportingIncidentIds: ["level-6-incident", "level-7-incident"],
          occurrence: {
            scopeId: "project",
            localDate: "2026-06-16",
          },
        },
        impact: {
          energy: { status: "available", deltaKwh: 50 },
          cost: { status: "unavailable" },
        },
        action: {
          code: "INSPECT_DAILY_USAGE_DRIVERS",
          targetIncidentId: "project-incident",
        },
        confidence: { status: "complete", limitation: null },
      }],
    });
    expect(result.items).toHaveLength(1);
  });

  it("keeps the triggered selected Level primary when Project and Level share an incident date", () => {
    const result = build(anomalies([
      {
        scopeId: "project",
        scopeName: "Ngee Ann Polytechnic",
        scopeType: "project",
        rows: [anomalyRow({ incidentId: "project-incident", impactKwh: 80 })],
      },
      {
        scopeId: "level-7",
        scopeName: "Level 7",
        scopeType: "level",
        rows: [anomalyRow({ incidentId: "level-7-incident", impactKwh: 30 })],
      },
    ]), "level-7");

    expect(result.items[0]).toMatchObject({
      evidence: {
        primaryIncidentId: "level-7-incident",
        supportingIncidentIds: ["project-incident"],
        occurrence: { scopeId: "level-7" },
      },
      impact: { energy: { deltaKwh: 30 } },
    });
  });

  it("keeps one selected-Scope theme without summing Parent and Level impacts", () => {
    const result = build(anomalies([
      {
        scopeId: "project",
        scopeName: "Ngee Ann Polytechnic",
        scopeType: "project",
        rows: [anomalyRow({
          incidentId: "project-16",
          localDate: "2026-06-16",
          impactKwh: 50,
        })],
      },
      {
        scopeId: "level-z",
        scopeName: "Level Z",
        scopeType: "level",
        rows: [
          anomalyRow({ incidentId: "level-z-16", localDate: "2026-06-16", impactKwh: 100 }),
          anomalyRow({ incidentId: "level-z-15", localDate: "2026-06-15", impactKwh: 70 }),
          anomalyRow({ incidentId: "level-z-14", localDate: "2026-06-14", impactKwh: 60 }),
          anomalyRow({ incidentId: "level-z-13", localDate: "2026-06-13", impactKwh: 60 }),
        ],
      },
      {
        scopeId: "level-a",
        scopeName: "Level A",
        scopeType: "level",
        rows: [anomalyRow({
          incidentId: "level-a-14",
          localDate: "2026-06-14",
          impactKwh: 60,
        })],
      },
    ]));

    expect(result.status).toBe("available");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.recurrenceDayCount).toBe(1);
    expect(result.items[0]).toMatchObject({
      rank: 1,
      evidence: { primaryIncidentId: "project-16" },
      impact: { energy: { deltaKwh: 50 } },
    });
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["NaN", Number.NaN],
    ["positive infinity", Number.POSITIVE_INFINITY],
  ])("withholds a %s-impact supporting driver", (_name, impactKwh) => {
    const row = anomalyRow({ incidentId: "project-16", impactKwh: 50 });
    row.detailSeries = [driverSeries(impactKwh)];

    const result = build(anomalies([{
      scopeId: "project",
      scopeName: "Ngee Ann Polytechnic",
      scopeType: "project",
      rows: [row],
    }]));

    expect(result.items[0]?.driver).toMatchObject({
      status: "unavailable",
    });
  });

  it("selects only the strongest finite positive supporting driver", () => {
    const row = anomalyRow({ incidentId: "project-16", impactKwh: 50 });
    row.detailSeries = [
      driverSeries(Number.POSITIVE_INFINITY),
      driverSeries(0),
      driverSeries(-10),
      driverSeries(12),
      { ...driverSeries(25), seriesId: "driver:25" },
    ];

    const result = build(anomalies([{
      scopeId: "project",
      scopeName: "Ngee Ann Polytechnic",
      scopeType: "project",
      rows: [row],
    }]));

    expect(result.items[0]?.driver).toMatchObject({
      status: "available",
      scopeId: "level-7",
      impactKwh: 25,
    });
  });

  it.each([
    {
      name: "empty when every eligible occurrence is within threshold",
      rows: [
        anomalyRow({ incidentId: "within-1", impactKwh: 10, outcome: "within_threshold" }),
        anomalyRow({ incidentId: "within-2", impactKwh: 15, outcome: "within_threshold" }),
      ],
      status: "empty",
      limitationCode: undefined,
    },
    {
      name: "suppressed when every candidate occurrence is suppressed",
      rows: [
        anomalyRow({ incidentId: "suppressed-1", impactKwh: 0, outcome: "suppressed" }),
        anomalyRow({ incidentId: "suppressed-2", impactKwh: 0, outcome: "suppressed" }),
      ],
      status: "suppressed",
      limitationCode: "ALL_CANDIDATE_DATES_SUPPRESSED",
    },
    {
      name: "partial when suppressed and within-threshold occurrences are mixed",
      rows: [
        anomalyRow({ incidentId: "suppressed", impactKwh: 0, outcome: "suppressed" }),
        anomalyRow({ incidentId: "within", impactKwh: 10, outcome: "within_threshold" }),
      ],
      status: "partial",
      limitationCode: "SOME_CANDIDATE_DATES_SUPPRESSED",
    },
  ] as const)("returns $name", ({ rows, status, limitationCode }) => {
    const result = build(anomalies([{
      scopeId: "project",
      scopeName: "Ngee Ann Polytechnic",
      scopeType: "project",
      rows: [...rows],
    }]));

    expect(result.status).toBe(status);
    expect(result.items).toEqual([]);
    expect(result.limitation?.code).toBe(limitationCode);
  });

  it.each([
    {
      name: "absent anomaly bundle",
      source: undefined,
      limitationCode: "DAILY_USAGE_ANOMALIES_ABSENT",
    },
    {
      name: "unavailable anomaly bundle",
      source: {
        status: "unavailable" as const,
        ruleRevisionId: "comparison.daily_usage_above_baseline@1",
        reason: {
          code: "DAILY_USAGE_ANOMALY_FACTS_UNAVAILABLE" as const,
          message: "The optional anomaly query did not complete.",
        },
      },
      limitationCode: "DAILY_USAGE_ANOMALIES_UNAVAILABLE",
    },
    {
      name: "mismatched anomaly Evidence pins",
      source: {
        ...anomalies([]),
        evidencePins: {
          ...evidencePins,
          dataSnapshotId: "snapshot@stale",
        },
      },
      limitationCode: "EVIDENCE_PINS_MISMATCH",
    },
  ])("fails only priorities closed for $name", ({ source, limitationCode }) => {
    const result = build(source);

    expect(result).toMatchObject({
      status: "unavailable",
      limitation: { code: limitationCode },
      evidencePins,
      items: [],
    });
  });

  it("fails priorities closed when a triggered child violates the released anomaly contract", () => {
    const result = build(anomalies([{
      scopeId: "project",
      scopeName: "Ngee Ann Polytechnic",
      scopeType: "project",
      rows: [{
        ...anomalyRow({ incidentId: "invalid-triggered-child", impactKwh: 25 }),
        actualKwh: null,
      }],
    }]));

    expect(result).toMatchObject({
      status: "unavailable",
      limitation: { code: "DAILY_USAGE_ANOMALIES_CONTRACT_MISMATCH" },
      evidencePins,
      items: [],
    });
  });
});
