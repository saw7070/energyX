import type { EnergyIqSavedAnalysisRecord } from "@datafoundry/metadata";
import { describe, expect, it } from "vitest";

import { recoverPreschoolPlanningOutlookFromCompleteWeeks } from "./preschool-operational-projection.js";

import {
  buildPreschoolMonthlyActualContext,
  buildPreschoolPlanningLifecycle,
  loadPreschoolPlanningLifecycleFromSavedAnalyses,
  resolvePreschoolMonthlyTargetPeriod,
} from "./preschool-planning-lifecycle.js";

describe("resolvePreschoolMonthlyTargetPeriod", () => {
  it.each([
    ["2026-01-31", "2026-02-01", "2026-03-01", 28],
    ["2028-01-31", "2028-02-01", "2028-03-01", 29],
    ["2026-03-31", "2026-04-01", "2026-05-01", 30],
    ["2026-06-30", "2026-07-01", "2026-08-01", 31],
    ["2026-12-31", "2027-01-01", "2027-02-01", 31],
  ])(
    "derives the natural target month after latest complete local day %s",
    (latestCompleteLocalDay, start, endExclusive, targetDayCount) => {
      expect(resolvePreschoolMonthlyTargetPeriod(
        latestCompleteLocalDay,
        "Asia/Singapore",
      )).toEqual({
        start,
        endExclusive,
        timezone: "Asia/Singapore",
        targetDayCount,
      });
    },
  );
});

describe("buildPreschoolPlanningLifecycle", () => {
  it.each(["2", "3"] as const)(
    "recovers a legacy v%s Saved A plan without mutating it and withholds Day 7 variance",
    (operationalVersion) => {
      const compatible = savedAnalysis({ operationalVersion });
      const incompatible = {
        ...savedAnalysis({ operationalVersion }),
        id: "saved-newer-incompatible",
        scope_id: "centre-01",
        created_at: "2026-08-10T02:00:00.000Z",
      };
      const savedBytes = {
        analysis: compatible.analysis_json,
        snapshot: compatible.snapshot_json,
      };

      const result = buildPreschoolPlanningLifecycle({
        projectId: "preschool-demo",
        workspaceId: "workspace-preschool",
        scopeId: "project",
        resource: "electricity",
        templateRevisionId: "template-v1",
        projectReleaseId: "release-v1",
        currentDataSnapshotId: "snapshot-b",
        latestCompleteLocalDay: "2026-06-07",
        targetPeriod: juneTargetPeriod(),
        savedAnalyses: [incompatible, compatible],
        actualAnalysis: juneActualAnalysis(7),
      });

      expect(result).toMatchObject({
        status: "available",
        contract: {
          id: "preschool-saved-plan-current-actual",
          version: "2",
        },
        targetPeriod: {
          start: "2026-06-01",
          endExclusive: "2026-07-01",
          timezone: "Asia/Singapore",
          targetDayCount: 30,
        },
        plan: {
          status: "provisional",
          usageEstimate: { projectedKwh: 3525 },
          evidence: {
            dataSnapshotId: "snapshot-a",
            queryId: "daily_totals_v1",
            recipeId: "preschool-naive-weekly-planning-baseline-v1",
          },
        },
        actual: {
          status: "partial",
          usageKwh: 1400,
          completeDayCount: 7,
          targetDayCount: 30,
          varianceKwh: null,
          variancePct: null,
        },
        planProvenance: {
          savedAnalysisId: "saved-a",
          dataSnapshotId: "snapshot-a",
          projectReleaseId: "release-v1",
          templateRevisionId: "template-v1",
        },
        actualProvenance: {
          dataSnapshotId: "snapshot-b",
          projectReleaseId: "release-v1",
          queryId: "daily_totals_v1",
        },
      });
      expect(compatible.analysis_json).toBe(savedBytes.analysis);
      expect(compatible.snapshot_json).toBe(savedBytes.snapshot);
    },
  );

  it("recovers the formal current-overview Saved A from four complete May 4-31 weeks", () => {
    const compatible = savedAnalysis({
      operationalVersion: "3",
      firstMayDay: 4,
    });

    const result = buildPreschoolPlanningLifecycle({
      projectId: "preschool-demo",
      workspaceId: "workspace-preschool",
      scopeId: "project",
      resource: "electricity",
      templateRevisionId: "template-v1",
      projectReleaseId: "release-v1",
      currentDataSnapshotId: "snapshot-b",
      latestCompleteLocalDay: "2026-06-07",
      targetPeriod: juneTargetPeriod(),
      savedAnalyses: [compatible],
      actualAnalysis: juneActualAnalysis(7),
    });

    expect(result).toMatchObject({
      status: "available",
      plan: {
        status: "provisional",
        sourceWeeks: [
          { start: "2026-05-04", endInclusive: "2026-05-10", usageKwh: 749 },
          { start: "2026-05-11", endInclusive: "2026-05-17", usageKwh: 798 },
          { start: "2026-05-18", endInclusive: "2026-05-24", usageKwh: 847 },
          { start: "2026-05-25", endInclusive: "2026-05-31", usageKwh: 896 },
        ],
        usageEstimate: { projectedKwh: 3525 },
        costEstimate: { currentPeriodBeforeGstSgd: 897.183 },
        limitations: expect.arrayContaining([
          expect.stringContaining("May 4-31 source window"),
        ]),
      },
      actual: {
        status: "partial",
        completeDayCount: 7,
        varianceKwh: null,
        variancePct: null,
      },
    });
  });

  it("keeps Day 1 actual partial and withholds variance", () => {
    const result = buildLifecycle(juneActualAnalysis(1));

    expect(result).toMatchObject({
      status: "available",
      actual: {
        status: "partial",
        usageKwh: 200,
        completeDayCount: 1,
        targetDayCount: 30,
        varianceKwh: null,
        variancePct: null,
      },
    });
  });

  it("publishes waiting Portfolio and Centre forecast series without inventing June actual", () => {
    const result = buildLifecycle(juneActualAnalysis(0));

    expect(result).toMatchObject({
      status: "available",
      forecast: {
        status: "waiting",
        scopes: [
          {
            scopeId: "project",
            scopeName: "Preschool Portfolio",
            scopeRole: "portfolio",
            estimatedKwh: 3525,
            actualKwh: null,
            pacePct: null,
          },
          {
            scopeId: "centre-a",
            scopeName: "Centre A",
            scopeRole: "centre",
            estimatedKwh: 2115,
            actualKwh: null,
            pacePct: null,
          },
          {
            scopeId: "centre-b",
            scopeName: "Centre B",
            scopeRole: "centre",
            estimatedKwh: 1410,
            actualKwh: null,
            pacePct: null,
          },
        ],
      },
    });
    if (result.status !== "available") throw new Error(result.reason.message);
    const forecast = Reflect.get(result, "forecast") as {
      scopes: Array<{
        scopeId: string;
        buckets: Record<"daily" | "weekly" | "monthly", Array<{
          estimatedKwh: number;
          actualKwh: number | null;
          actualStatus: "waiting" | "partial" | "complete";
        }>>;
      }>;
    };
    expect(forecast.scopes[0]?.buckets.daily).toHaveLength(30);
    expect(forecast.scopes[0]?.buckets.weekly).toHaveLength(5);
    expect(forecast.scopes[0]?.buckets.monthly).toHaveLength(1);
    expect(forecast.scopes[0]?.buckets.daily.reduce((total, bucket) => total + bucket.estimatedKwh, 0)).toBeCloseTo(3525, 2);
    expect(forecast.scopes[0]?.buckets.daily.every((bucket) => (
      bucket.actualKwh === null && bucket.actualStatus === "waiting"
    ))).toBe(true);
  });

  it("keeps partial actual series isolated by scope and calculates pace against like-for-like dates", () => {
    const result = buildLifecycle(juneActualAnalysis(7));

    expect(result).toMatchObject({
      status: "available",
      forecast: {
        status: "partial",
        scopes: [
          {
            scopeId: "project",
            actualKwh: 1400,
            actualCompleteDayCount: 7,
            pacePct: expect.any(Number),
          },
          {
            scopeId: "centre-a",
            actualKwh: 840,
            actualCompleteDayCount: 7,
            pacePct: expect.any(Number),
          },
          {
            scopeId: "centre-b",
            actualKwh: 560,
            actualCompleteDayCount: 7,
            pacePct: expect.any(Number),
          },
        ],
      },
    });
    if (result.status !== "available") throw new Error(result.reason.message);
    const forecast = Reflect.get(result, "forecast") as {
      scopes: Array<{
        scopeId: string;
        buckets: Record<"daily" | "weekly" | "monthly", Array<{
          actualKwh: number | null;
          actualStatus: "waiting" | "partial" | "complete";
        }>>;
      }>;
    };
    expect(forecast.scopes[0]?.buckets.daily.slice(0, 7).every((bucket) => bucket.actualStatus === "complete")).toBe(true);
    expect(forecast.scopes[0]?.buckets.daily.slice(7).every((bucket) => bucket.actualKwh === null)).toBe(true);
    expect(forecast.scopes[0]?.buckets.weekly[0]).toMatchObject({ actualKwh: 1400, actualStatus: "complete" });
    expect(forecast.scopes[0]?.buckets.weekly[1]).toMatchObject({ actualKwh: null, actualStatus: "waiting" });
  });

  it("builds a July natural-month outlook with frozen Original, Actual and Current Outlook series", () => {
    const result = buildJulyLifecycle(monthlyActualAnalysis({
      start: "2026-07-01",
      targetDayCount: 31,
      completeDayCount: 14,
    }));

    expect(result).toMatchObject({
      status: "available",
      targetPeriod: {
        start: "2026-07-01",
        endExclusive: "2026-08-01",
        timezone: "Asia/Singapore",
        targetDayCount: 31,
      },
      forecast: {
        status: "partial",
        tariffAssumption: {
          status: "provisional",
          beforeGstSgdPerKwh: 0.2727,
          appliesFrom: "2026-04-01",
          appliesTo: "2026-06-30",
        },
      },
    });
    if (result.status !== "available" || !result.forecast) throw new Error("Expected July outlook");
    const portfolio = result.forecast.scopes[0]!;
    expect(portfolio).toMatchObject({
      scopeId: "project",
      actualKwh: 2800,
      actualCompleteDayCount: 14,
      actualTargetDayCount: 31,
      expectedFullMonthKwh: expect.any(Number),
      expectedFullMonthCostBeforeGstSgd: expect.any(Number),
      actualCostBeforeGstSgd: 763.56,
      actualThroughLocalDate: "2026-07-14",
      originalEstimateIdentity: expect.stringContaining("saved-a:2026-07-01"),
    });
    expect(portfolio.buckets.daily).toHaveLength(31);
    expect(portfolio.buckets.daily.slice(0, 14).every((bucket) => (
      bucket.actualKwh !== null
      && bucket.currentOutlookKwh === bucket.actualKwh
      && bucket.futureOutlookKwh === null
    ))).toBe(true);
    expect(portfolio.buckets.daily.slice(14).every((bucket) => (
      bucket.actualKwh === null
      && bucket.currentOutlookKwh === bucket.originalEstimateKwh
      && bucket.futureOutlookKwh === bucket.originalEstimateKwh
    ))).toBe(true);
    expect(portfolio.expectedFullMonthKwh).toBeCloseTo(
      portfolio.buckets.daily.reduce((total, bucket) => total + (bucket.currentOutlookKwh ?? 0), 0),
      2,
    );
  });

  it("shows a complete July Original Estimate while waiting for the first July complete day", () => {
    const result = buildJulyLifecycle(monthlyActualAnalysis({
      start: "2026-07-01",
      targetDayCount: 31,
      completeDayCount: 0,
    }), savedAnalysisForJuly(), { latestCompleteLocalDay: "2026-06-30" });

    if (result.status !== "available" || !result.forecast) throw new Error("Expected waiting July outlook");
    expect(result.forecast.status).toBe("waiting");
    expect(result.forecast.scopes[0]).toMatchObject({
      actualKwh: null,
      actualCompleteDayCount: 0,
      actualThroughLocalDate: null,
      expectedFullMonthKwh: expect.any(Number),
    });
    expect(result.forecast.scopes[0]!.buckets.daily).toHaveLength(31);
    expect(result.forecast.scopes[0]!.buckets.daily.every((bucket) => (
      bucket.actualStatus === "waiting"
      && bucket.actualKwh === null
      && bucket.currentOutlookKwh === bucket.originalEstimateKwh
      && bucket.futureOutlookKwh === bucket.originalEstimateKwh
    ))).toBe(true);
  });

  it("renders a frozen complete-July lifecycle with Current Outlook equal to final Actual across all 31 days", () => {
    const result = buildJulyLifecycle(monthlyActualAnalysis({
      start: "2026-07-01",
      targetDayCount: 31,
      completeDayCount: 31,
    }), savedAnalysisForJuly(), { latestCompleteLocalDay: "2026-07-31" });

    if (result.status !== "available" || !result.forecast) throw new Error("Expected complete July outlook");
    expect(result.forecast.status).toBe("complete");
    expect(result.forecast.scopes[0]).toMatchObject({
      actualKwh: 6_200,
      actualCompleteDayCount: 31,
      actualThroughLocalDate: "2026-07-31",
      expectedFullMonthKwh: 6_200,
      outcome: "above_plan",
    });
    expect(result.forecast.scopes[0]!.buckets.daily.every((bucket) => (
      bucket.actualStatus === "complete"
      && bucket.currentOutlookKwh === bucket.actualKwh
      && bucket.futureOutlookKwh === null
    ))).toBe(true);
  });

  it("keeps a Centre with missing past Actual visible while withholding only its Current Outlook KPI", () => {
    const actual = monthlyActualAnalysis({
      start: "2026-07-01",
      targetDayCount: 31,
      completeDayCount: 14,
    });
    actual.dailyTotals.scopes = actual.dailyTotals.scopes.filter((scope) => scope.scopeId !== "centre-b");

    const result = buildJulyLifecycle(actual);

    if (result.status !== "available" || !result.forecast) throw new Error("Expected July outlook");
    expect(result.forecast.scopes.find((scope) => scope.scopeId === "centre-b")).toMatchObject({
      actualKwh: null,
      actualCompleteDayCount: 0,
      actualThroughLocalDate: null,
      expectedFullMonthKwh: null,
      expectedFullMonthCostBeforeGstSgd: null,
    });
  });

  it("keeps Energy available but withholds only Cost when no tariff reference exists", () => {
    const result = buildJulyLifecycle(monthlyActualAnalysis({
      start: "2026-07-01",
      targetDayCount: 31,
      completeDayCount: 14,
    }), savedAnalysisForJuly({ omitTariff: true }));

    if (result.status !== "available" || !result.forecast) throw new Error("Expected July outlook");
    expect(result.forecast.tariffAssumption).toEqual({
      status: "unavailable",
      reason: "No accepted tariff reference is available for this target month.",
    });
    expect(result.forecast.scopes[0]).toMatchObject({
      expectedFullMonthKwh: expect.any(Number),
      expectedFullMonthCostBeforeGstSgd: null,
      actualCostBeforeGstSgd: null,
    });
  });

  it("keeps Saved A and Original Estimate immutable when Current B is replaced by a newer current Snapshot", () => {
    const saved = savedAnalysisForJuly();
    const savedBytes = saved.snapshot_json;
    const actualB = monthlyActualAnalysis({
      start: "2026-07-01",
      targetDayCount: 31,
      completeDayCount: 14,
      dataSnapshotId: "snapshot-b",
      portfolioDailyKwh: 200,
    });
    const actualC = monthlyActualAnalysis({
      start: "2026-07-01",
      targetDayCount: 31,
      completeDayCount: 14,
      dataSnapshotId: "snapshot-c",
      portfolioDailyKwh: 240,
    });

    const resultB = buildJulyLifecycle(actualB, saved);
    const resultC = buildJulyLifecycle(actualC, saved);
    if (
      resultB.status !== "available" || !resultB.forecast
      || resultC.status !== "available" || !resultC.forecast
    ) throw new Error("Expected both current outlooks");
    const scopeB = resultB.forecast.scopes.find((scope) => scope.scopeRole === "portfolio")!;
    const scopeC = resultC.forecast.scopes.find((scope) => scope.scopeRole === "portfolio")!;

    expect(saved.snapshot_json).toBe(savedBytes);
    expect(resultB.planProvenance).toEqual(resultC.planProvenance);
    expect(scopeB.originalEstimateIdentity).toBe(scopeC.originalEstimateIdentity);
    expect(scopeB.estimatedKwh).toBe(scopeC.estimatedKwh);
    expect(scopeB.actualIdentity).not.toBe(scopeC.actualIdentity);
    expect(scopeB.actualKwh).not.toBe(scopeC.actualKwh);
    expect(scopeB.expectedFullMonthKwh).not.toBe(scopeC.expectedFullMonthKwh);
  });

  it("shows plan-versus-actual delta only after all 30 June days are complete", () => {
    const result = buildLifecycle(juneActualAnalysis(30));

    expect(result).toMatchObject({
      status: "available",
      actual: {
        status: "complete",
        usageKwh: 6000,
        completeDayCount: 30,
        targetDayCount: 30,
        varianceKwh: 2475,
        variancePct: 70.21,
      },
      forecast: {
        status: "complete",
        scopes: [
          {
            scopeId: "project",
            actualKwh: 6000,
            actualCompleteDayCount: 30,
            pacePct: 170.21,
            outcome: "above_plan",
          },
          {
            scopeId: "centre-a",
            actualKwh: 3600,
            actualCompleteDayCount: 30,
            pacePct: 170.21,
            outcome: "above_plan",
          },
          {
            scopeId: "centre-b",
            actualKwh: 2400,
            actualCompleteDayCount: 30,
            pacePct: 170.21,
            outcome: "above_plan",
          },
        ],
      },
    });
  });

  it("fails closed when actual Evidence is not the current B Snapshot or fixed June window", () => {
    const wrongSnapshot = juneActualAnalysis(7);
    wrongSnapshot.provenance.dataSnapshotId = "snapshot-c";
    const rollingWindow = juneActualAnalysis(7);
    rollingWindow.context.from = "2026-06-03T16:00:00.000Z";

    expect(buildLifecycle(wrongSnapshot)).toMatchObject({
      status: "unavailable",
      reason: { code: "CURRENT_ACTUAL_UNAVAILABLE" },
    });
    expect(buildLifecycle(rollingWindow)).toMatchObject({
      status: "unavailable",
      reason: { code: "CURRENT_ACTUAL_UNAVAILABLE" },
    });
  });
});

describe("buildPreschoolMonthlyActualContext", () => {
  it("pins the existing current B Snapshot and release inputs to the natural target month", () => {
    const context = buildPreschoolMonthlyActualContext({
      userId: "user-admin",
      workspaceId: "workspace-preschool",
      projectId: "preschool-demo",
      projectName: "Preschool Portfolio",
      scopeId: "project",
      scopeName: "Preschool Portfolio",
      scopeType: "project",
      resource: "electricity",
      timezone: "Asia/Singapore",
      from: "2026-06-02T16:00:00.000Z",
      to: "2026-06-30T16:00:00.000Z",
      endExclusive: true,
      period: "Custom",
      hierarchyRevisionId: "hierarchy-v1",
      meterMappingRevisionId: "mapping-v1",
      meterFormulaRevisionId: "formula-v1",
      dataSnapshotId: "snapshot-b",
      metricVersion: "energy.total_usage_kwh@1",
      businessCalendarVersion: "calendar-v1",
      tariffScheduleVersion: "tariff-v1",
      resolvedAt: "2026-08-10T00:00:00.000Z",
    }, resolvePreschoolMonthlyTargetPeriod("2026-06-30", "Asia/Singapore"));

    expect(context).toMatchObject({
      from: "2026-06-30T16:00:00.000Z",
      to: "2026-07-31T16:00:00.000Z",
      period: "Custom",
      timezone: "Asia/Singapore",
      dataSnapshotId: "snapshot-b",
      hierarchyRevisionId: "hierarchy-v1",
      meterMappingRevisionId: "mapping-v1",
      meterFormulaRevisionId: "formula-v1",
    });
  });
});

describe("loadPreschoolPlanningLifecycleFromSavedAnalyses", () => {
  it("does not invoke the June Kernel callback without a compatible older Saved A", async () => {
    let actualLoadCount = 0;

    const result = await loadPreschoolPlanningLifecycleFromSavedAnalyses({
      projectId: "preschool-demo",
      workspaceId: "workspace-preschool",
      scopeId: "project",
      resource: "electricity",
      templateRevisionId: "template-v1",
      projectReleaseId: "release-v1",
      currentDataSnapshotId: "snapshot-b",
      latestCompleteLocalDay: "2026-05-31",
      savedAnalyses: [],
      loadActualAnalysis: async () => {
        actualLoadCount += 1;
        return juneActualAnalysis(30);
      },
    });

    expect(result).toMatchObject({
      status: "unavailable",
      reason: { code: "NO_COMPATIBLE_SAVED_ANALYSIS" },
    });
    expect(actualLoadCount).toBe(0);
  });
});

const buildLifecycle = (actualAnalysis: ReturnType<typeof juneActualAnalysis>) => (
  buildPreschoolPlanningLifecycle({
    projectId: "preschool-demo",
    workspaceId: "workspace-preschool",
    scopeId: "project",
    resource: "electricity",
    templateRevisionId: "template-v1",
    projectReleaseId: "release-v1",
    currentDataSnapshotId: "snapshot-b",
    latestCompleteLocalDay: actualAnalysis.dailyTotals.scopes[0]!.rows
      .filter((row) => row.dataHealth.status === "complete")
      .at(-1)?.localDate ?? "2026-05-31",
    targetPeriod: juneTargetPeriod(),
    savedAnalyses: [savedAnalysis({ operationalVersion: "3" })],
    actualAnalysis,
  })
);

const savedAnalysis = (input: {
  operationalVersion: "2" | "3";
  firstMayDay?: number;
}): EnergyIqSavedAnalysisRecord => {
  const analysis = mayAnalysis(input.firstMayDay ?? 1);
  return {
    id: "saved-a",
    series_id: "series-a",
    sequence: 1,
    project_id: "preschool-demo",
    workspace_id: "workspace-preschool",
    scope_id: "project",
    scope_name: "Preschool Portfolio",
    resource: "electricity",
    title: "Saved May Overview",
    query_json: JSON.stringify({
      projectId: "preschool-demo",
      scopeId: "project-alias",
      resource: "electricity",
      period: "Custom",
      from: "2026-05-01",
      to: "2026-05-31",
    }),
    analysis_json: JSON.stringify(analysis),
    snapshot_json: JSON.stringify({
      context: {
        projectId: "preschool-demo",
        workspaceId: "workspace-preschool",
        scopeId: "project",
        resource: "electricity",
        dataSnapshotId: "snapshot-a",
      },
      projectRelease: {
        id: "release-v1",
        templateRevisionId: "template-v1",
      },
      renderer: { key: "preschool-overview" },
      dataSnapshot: { id: "snapshot-a" },
      preschoolOperational: {
        status: "available",
        contract: {
          id: "preschool-may-2026-operational-behaviour",
          version: input.operationalVersion,
        },
      },
      analysis,
    }),
    template_revision_id: "template-v1",
    data_snapshot_id: "snapshot-a",
    created_by: "user-admin",
    created_at: "2026-08-10T01:00:00.000Z",
  };
};

const mayAnalysis = (firstMayDay: number) => ({
  context: { scopeId: "project" },
  offHours: {
    status: "available",
    operatingKwh: 1,
    standbyKwh: 1,
    usageKwh: 2,
    sharePct: 50,
    timezone: "Asia/Singapore",
    businessCalendarVersion: "calendar-v1",
  },
  provenance: {
    dataSnapshotId: "snapshot-a",
    hierarchyRevisionId: "hierarchy-v1",
    meterMappingRevisionId: "mapping-v1",
    meterFormulaRevisionId: "formula-v1",
    metricVersion: "energy.total_usage_kwh@1",
    ruleRevisionIds: [],
    aggregationRule: "designated_total",
    sourceView: "energy_interval_facts",
    queryIds: ["daily_totals_v1"],
  },
  dailyTotals: {
    metricId: "energy.total_usage_kwh@1",
    grain: "day",
    timezone: "Asia/Singapore",
    scopes: planningScopes(firstMayDay),
  },
});

const juneActualAnalysis = (completeDayCount: number) => ({
  context: {
    scopeId: "project",
    from: "2026-05-31T16:00:00.000Z",
    to: "2026-06-30T16:00:00.000Z",
    timezone: "Asia/Singapore",
  },
  provenance: {
    dataSnapshotId: "snapshot-b",
    queryIds: ["daily_totals_v1"],
  },
  dailyTotals: {
    timezone: "Asia/Singapore",
    scopes: actualScopes(completeDayCount),
  },
});

const planningScopes = (firstMayDay: number) => ([
  { scopeId: "project", scopeName: "Preschool Portfolio", scopeType: "project", share: 1 },
  { scopeId: "centre-a", scopeName: "Centre A", scopeType: "centre", share: 0.6 },
  { scopeId: "centre-b", scopeName: "Centre B", scopeType: "centre", share: 0.4 },
].map((scope) => ({
  scopeId: scope.scopeId,
  scopeName: scope.scopeName,
  scopeType: scope.scopeType,
  rows: Array.from({ length: 32 - firstMayDay }, (_, offset) => dailyRow({
    localDate: `2026-05-${String(offset + firstMayDay).padStart(2, "0")}`,
    usageKwh: (100 + firstMayDay + offset) * scope.share,
    status: "complete",
  })),
})));

const actualScopes = (completeDayCount: number) => ([
  { scopeId: "project", scopeName: "Preschool Portfolio", scopeType: "project", usageKwh: 200 },
  { scopeId: "centre-a", scopeName: "Centre A", scopeType: "centre", usageKwh: 120 },
  { scopeId: "centre-b", scopeName: "Centre B", scopeType: "centre", usageKwh: 80 },
].map((scope) => ({
  scopeId: scope.scopeId,
  scopeName: scope.scopeName,
  scopeType: scope.scopeType,
  rows: Array.from({ length: 30 }, (_, offset) => dailyRow({
    localDate: `2026-06-${String(offset + 1).padStart(2, "0")}`,
    usageKwh: offset < completeDayCount ? scope.usageKwh : null,
    status: offset < completeDayCount ? "complete" : "unavailable",
  })),
})));

const juneTargetPeriod = () => ({
  start: "2026-06-01",
  endExclusive: "2026-07-01",
  timezone: "Asia/Singapore",
  targetDayCount: 30,
});

const savedAnalysisForJuly = (input: { omitTariff?: boolean } = {}): EnergyIqSavedAnalysisRecord => {
  const record = savedAnalysis({ operationalVersion: "3" });
  const snapshot = JSON.parse(record.snapshot_json!) as Record<string, unknown>;
  const analysis = mayAnalysis(1);
  const planningOutlook = recoverPreschoolPlanningOutlookFromCompleteWeeks(analysis);
  if (planningOutlook.status !== "provisional") throw new Error("Expected recoverable May plan");
  if (!planningOutlook.tariffReference || !planningOutlook.costEstimate) {
    throw new Error("Expected recoverable May tariff and cost plan");
  }
  const projectedKwh = planningOutlook.weeklyBaseline.averageKwh * (31 / 7);
  const rate = planningOutlook.tariffReference.beforeGstSgdPerKwh;
  Reflect.set(planningOutlook, "targetPeriod", {
    start: "2026-07-01",
    endInclusive: "2026-07-31",
    endExclusive: "2026-08-01",
    timezone: "Asia/Singapore",
    days: 31,
  });
  Reflect.set(planningOutlook.usageEstimate, "projectedKwh", projectedKwh);
  Reflect.set(planningOutlook.costEstimate, "projectedBeforeGstSgd", projectedKwh * rate);
  Reflect.deleteProperty(planningOutlook, "estimateSeries");
  if (input.omitTariff) Reflect.deleteProperty(planningOutlook, "tariffReference");
  Reflect.set(snapshot, "preschoolOperational", {
    status: "available",
    contract: {
      id: "preschool-may-2026-operational-behaviour",
      version: "3",
    },
    planningOutlook,
  });
  return {
    ...record,
    snapshot_json: JSON.stringify(snapshot),
  };
};

const buildJulyLifecycle = (
  actualAnalysis: ReturnType<typeof monthlyActualAnalysis>,
  saved = savedAnalysisForJuly(),
  options: { latestCompleteLocalDay?: string } = {},
) => buildPreschoolPlanningLifecycle({
  projectId: "preschool-demo",
  workspaceId: "workspace-preschool",
  scopeId: "project",
  resource: "electricity",
  templateRevisionId: "template-v1",
  projectReleaseId: "release-v1",
  currentDataSnapshotId: actualAnalysis.provenance.dataSnapshotId,
  latestCompleteLocalDay: options.latestCompleteLocalDay ?? "2026-07-14",
  targetPeriod: {
    start: actualAnalysis.targetPeriod.start,
    endExclusive: actualAnalysis.targetPeriod.endExclusive,
    timezone: "Asia/Singapore",
    targetDayCount: actualAnalysis.dailyTotals.scopes[0]?.rows.length ?? 0,
  },
  savedAnalyses: [saved],
  actualAnalysis,
});

const monthlyActualAnalysis = (input: {
  start: string;
  targetDayCount: number;
  completeDayCount: number;
  dataSnapshotId?: string;
  portfolioDailyKwh?: number;
}) => {
  const endExclusive = shiftFixtureDate(input.start, input.targetDayCount);
  return {
    context: {
      scopeId: "project",
      from: "2026-06-30T16:00:00.000Z",
      to: "2026-07-31T16:00:00.000Z",
      timezone: "Asia/Singapore",
    },
    provenance: {
      dataSnapshotId: input.dataSnapshotId ?? "snapshot-b",
      queryIds: ["daily_totals_v1"],
    },
    dailyTotals: {
      timezone: "Asia/Singapore",
      scopes: [
        { scopeId: "project", scopeName: "Preschool Portfolio", scopeType: "project", usageKwh: input.portfolioDailyKwh ?? 200 },
        { scopeId: "centre-a", scopeName: "Centre A", scopeType: "centre", usageKwh: (input.portfolioDailyKwh ?? 200) * 0.6 },
        { scopeId: "centre-b", scopeName: "Centre B", scopeType: "centre", usageKwh: (input.portfolioDailyKwh ?? 200) * 0.4 },
      ].map((scope) => ({
        scopeId: scope.scopeId,
        scopeName: scope.scopeName,
        scopeType: scope.scopeType,
        rows: Array.from({ length: input.targetDayCount }, (_, offset) => dailyRow({
          localDate: shiftFixtureDate(input.start, offset),
          usageKwh: offset < input.completeDayCount ? scope.usageKwh : null,
          status: offset < input.completeDayCount ? "complete" : "unavailable",
        })),
      })),
    },
    targetPeriod: { start: input.start, endExclusive },
  };
};

const shiftFixtureDate = (localDate: string, days: number): string => {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const dailyRow = (input: {
  localDate: string;
  usageKwh: number | null;
  status: "complete" | "partial" | "unavailable";
}) => ({
  localDate: input.localDate,
  from: `${input.localDate}T00:00:00.000Z`,
  to: `${input.localDate}T23:59:59.999Z`,
  usageKwh: input.usageKwh,
  dataHealth: {
    status: input.status,
    coveragePct: input.status === "complete" ? 100 : 0,
    expectedMeterIntervalCount: 48,
    validIntervalCount: input.status === "complete" ? 48 : 0,
    qualityEventCount: 0,
  },
});
