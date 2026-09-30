import { describe, expect, it } from "vitest";

import { buildEnergyOverviewHeadlineProjection } from "./energy-analysis.js";

describe("canonical Energy Overview headline projection", () => {
  it.each([
    {
      project: "Preschool",
      usageKwh: 2_880,
      previousUsageKwh: 2_400,
      peakKw: 30,
      meterPointCount: 2,
      validIntervalCount: 192,
      qualityEventCount: 0,
      expected: {
        dailyAverage: 2_880,
        changeKwh: 480,
        changePct: 20,
        coveragePct: 100,
        status: "complete",
      },
    },
    {
      project: "Ngee Ann",
      usageKwh: 1_531.1683,
      previousUsageKwh: 1_400,
      peakKw: 20.6731,
      meterPointCount: 1,
      validIntervalCount: 96,
      qualityEventCount: 0,
      expected: {
        dailyAverage: 1_531.1683,
        changeKwh: 131.1683,
        changePct: 9.3692,
        coveragePct: 100,
        status: "complete",
      },
    },
    {
      project: "Tuya Office",
      usageKwh: 720,
      previousUsageKwh: 0,
      peakKw: 12,
      meterPointCount: 1,
      validIntervalCount: 72,
      qualityEventCount: 1,
      expected: {
        dailyAverage: 720,
        changeKwh: 720,
        changePct: null,
        coveragePct: 75,
        status: "partial",
      },
    },
  ] as const)("keeps minimum and full-report facts on one $project calculation", ({
    usageKwh,
    previousUsageKwh,
    peakKw,
    meterPointCount,
    validIntervalCount,
    qualityEventCount,
    expected,
  }) => {
    const cost = {
      status: "unavailable" as const,
      reason: {
        code: "TARIFF_VERSION_MISSING" as const,
        message: "Tariff unavailable",
      },
    };
    const projection = buildEnergyOverviewHeadlineProjection({
      from: "2026-06-01T00:00:00.000Z",
      to: "2026-06-02T00:00:00.000Z",
      usageKwh,
      previousUsageKwh,
      peakKw,
      intervalMinutes: 15,
      meterPointCount,
      validIntervalCount,
      qualityEventCount,
      cumulativeDeltaMismatchCount: 0,
      averageKwMismatchCount: 0,
      invalidIntervalDurationCount: 0,
      importBatchIds: ["batch-a"],
      cost,
      immediateChildScopeCount: 3,
    });

    expect(projection).toMatchObject({
      summary: {
        usageKwh,
        averageDailyUsageKwh: expected.dailyAverage,
        peakKw,
      },
      comparison: {
        usageKwh: previousUsageKwh,
        changeKwh: expected.changeKwh,
        changePct: expected.changePct,
      },
      dataHealth: {
        status: expected.status,
        coveragePct: expected.coveragePct,
        validIntervalCount,
        qualityEventCount,
      },
      immediateChildScopeCount: 3,
    });
    expect(projection.cost).toBe(cost);
  });
});
