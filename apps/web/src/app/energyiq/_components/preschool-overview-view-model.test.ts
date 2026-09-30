import { describe, expect, it } from "vitest";

import { preschoolGoldenSnapshot } from "./preschool-overview.test-fixture";
import { buildPreschoolOverviewViewModel } from "./preschool-overview-view-model";

describe("Preschool Overview ViewModel", () => {
  it("keeps a partially covered rolling operational window visible without inventing an out-of-period tariff", () => {
    const snapshot = preschoolGoldenSnapshot();
    if (snapshot.preschoolOperational?.status !== "available") throw new Error("Expected operational fixture");
    snapshot.preschoolOperational.contract = {
      id: "preschool-operational-behaviour",
      version: "4",
      spikeThresholdPct: 50,
    };
    snapshot.preschoolOperational.coverage = {
      status: "partial",
      expectedCellCount: 20_160,
      observedCellCount: 20_130,
      missingCellCount: 30,
      completeLocalDayCount: 27,
      partialLocalDayCount: 1,
      missingLocalHourCount: 1,
    };
    snapshot.preschoolOperational.hourlyProfile.completeDayCount = 27;
    snapshot.preschoolOperational.hourlyProfile.unit = "mean kWh per observed day";
    snapshot.preschoolOperational.energy.provisionalStandbyCostBeforeGstSgd = null;
    snapshot.preschoolOperational.energy.provisionalOperatingCostBeforeGstSgd = null;
    snapshot.preschoolOperational.standbyAppliances.provisionalCostBeforeGstSgd = null;
    snapshot.preschoolOperational.operatingAppliances.provisionalCostBeforeGstSgd = null;
    for (const composition of [
      snapshot.preschoolOperational.standbyAppliances,
      snapshot.preschoolOperational.operatingAppliances,
    ]) {
      composition.applianceGroups.forEach((row) => { row.provisionalCostBeforeGstSgd = null; });
      composition.appliances.forEach((row) => { row.provisionalCostBeforeGstSgd = null; });
    }
    delete snapshot.preschoolOperational.tariffReference;

    const view = buildPreschoolOverviewViewModel(snapshot);

    expect(view.operational).toMatchObject({
      status: "available",
      coverage: "27 complete local days · 1 partial day · 1 missing whole-portfolio hour",
      hourlyProfile: {
        completeDayCount: 27,
        unit: "mean kWh per observed day",
      },
      standby: {
        provisionalCost: "Unavailable",
        provisionalCostNote: "No Release-pinned Tariff covers the full analysis period; energy remains available and cost is withheld.",
      },
      operating: {
        provisionalCost: "Unavailable",
        provisionalCostNote: "No Release-pinned Tariff covers the full analysis period; energy remains available and cost is withheld.",
      },
    });
  });

  it("renders v5 cross-month operating-state costs from the Release-pinned Tariff instead of a demo reference", () => {
    const snapshot = preschoolGoldenSnapshot();
    if (snapshot.preschoolOperational?.status !== "available") throw new Error("Expected operational fixture");
    snapshot.preschoolOperational.contract.version = "5";
    delete snapshot.preschoolOperational.tariffReference;
    snapshot.preschoolOperational.tariffCost = {
      status: "available",
      currency: "SGD",
      tariffScheduleVersion: "preschool-tariff-cross-month-v2",
      allocations: [
        {
          from: "2026-06-09T16:00:00.000Z",
          to: "2026-06-30T16:00:00.000Z",
          ratePerKwh: 0.25,
          usageKwh: 18_000,
          cost: 4_500,
        },
        {
          from: "2026-06-30T16:00:00.000Z",
          to: "2026-07-07T16:00:00.000Z",
          ratePerKwh: 0.3,
          usageKwh: 6_921.8123,
          cost: 2_076.54369,
        },
      ],
      total: { usageKwh: 24_921.8123, amount: 6_576.54369 },
      standby: { usageKwh: 3_103.784, amount: 820.12 },
      operating: { usageKwh: 21_818.0283, amount: 5_756.42369 },
    };
    snapshot.analysis.cost = {
      status: "available",
      currency: "SGD",
      tariffScheduleVersion: "preschool-tariff-cross-month-v2",
      amount: 6_576.54369,
      allocations: snapshot.preschoolOperational.tariffCost.allocations,
    };

    const view = buildPreschoolOverviewViewModel(snapshot);

    expect(view.operational).toMatchObject({
      status: "available",
      standby: {
        provisionalCost: "S$820.12",
        provisionalCostNote: "Release-pinned Tariff preschool-tariff-cross-month-v2 · 2 effective rate periods applied · estimate only, not a bill",
      },
      operating: {
        provisionalCost: "S$5,756.42",
        provisionalCostNote: "Release-pinned Tariff preschool-tariff-cross-month-v2 · 2 effective rate periods applied · estimate only, not a bill",
      },
    });
    expect(view.overallSummary.costAssumption).toEqual({
      rate: "2 effective rate periods",
      label: "Release-pinned Tariff preschool-tariff-cross-month-v2",
      sourceUrl: null,
    });
  });

  it("renders the Monthly Outlook cost from target-period Release-pinned allocations", () => {
    const snapshot = preschoolGoldenSnapshot();
    if (snapshot.preschoolOperational?.status !== "available"
      || snapshot.preschoolOperational.planningOutlook.status !== "provisional") {
      throw new Error("Expected planning fixture");
    }
    const planning = snapshot.preschoolOperational.planningOutlook;
    delete planning.tariffReference;
    delete planning.costEstimate;
    planning.tariffCost = {
      status: "available",
      currency: "SGD",
      tariffScheduleVersion: "preschool-target-tariff-v3",
      allocations: [
        {
          from: "2026-05-31T16:00:00.000Z",
          to: "2026-06-14T16:00:00.000Z",
          ratePerKwh: 0.28,
          rateBasis: "tax_inclusive",
          usageKwh: 1_600,
          cost: 448,
        },
        {
          from: "2026-06-14T16:00:00.000Z",
          to: "2026-06-30T16:00:00.000Z",
          ratePerKwh: 0.31,
          rateBasis: "tax_inclusive",
          usageKwh: 1_925,
          cost: 596.75,
        },
      ],
      projectedAmount: 1_044.75,
      lowerAmount: 950.2,
      upperAmount: 1_138.4,
    };

    const view = buildPreschoolOverviewViewModel(snapshot);

    expect(view.planningOutlook).toMatchObject({
      status: "provisional",
      projectedCost: "S$1,045",
      projectedCostRange: "S$950–S$1,138",
      tariffRate: "2 effective rate periods",
      tariffLabel: "Release-pinned Tariff preschool-target-tariff-v3",
      tariffSourceUrl: null,
      tariffAppendixUrl: null,
    });
    expect(view.forecast).toMatchObject({
      status: "waiting",
      tariff: {
        status: "effective",
        rate: "2 effective rate periods",
        label: "Release-pinned Tariff preschool-target-tariff-v3",
        effectiveRange: "1–30 Jun 2026",
        sourceUrl: null,
        costBasisNote: "Tax-inclusive · planning estimate, not a bill",
      },
      scopes: expect.arrayContaining([
        expect.objectContaining({
          role: "portfolio",
          expectedFullMonthCost: "S$1,045",
        }),
      ]),
    });
    expect(view.decisionSummary.items.find((item) => item.id === "planning")).toMatchObject({
      supportingMetrics: expect.arrayContaining([
        { label: "Estimated June 2026 cost", valueLabel: "S$1,045" },
      ]),
    });
  });

  it("labels a rolling current window with its actual date range", () => {
    const snapshot = preschoolGoldenSnapshot();
    snapshot.context.from = "2026-05-10T16:00:00.000Z";
    snapshot.context.to = "2026-06-07T16:00:00.000Z";
    snapshot.context.primaryPeriod = {
      start: snapshot.context.from,
      endExclusive: snapshot.context.to,
    };

    const view = buildPreschoolOverviewViewModel(snapshot);

    expect(view.context.period).toBe("11 May 2026–7 Jun 2026");
    expect(view.context.analysisWindowLabel).toBe("Rolling 28-day window");
    expect(view.overallSummary.periodLabel).toBe("11 May 2026–7 Jun 2026");
    expect(view.overallSummary.metrics[1]?.label).toBe("Total energy · 11 May 2026–7 Jun 2026");
    expect(view.benchmark).toMatchObject({
      status: "provisional",
      detail: "Provisional comparison across the published 30-Centre cohort. EUI is annualised from the current window; energy per person is normalised to an average month.",
    });
  });

  it("exposes a complete June-versus-May comparison from Snapshot-pinned daily totals", () => {
    const snapshot = preschoolGoldenSnapshot();
    snapshot.context.from = "2026-05-31T16:00:00.000Z";
    snapshot.context.to = "2026-06-30T16:00:00.000Z";
    snapshot.context.primaryPeriod = {
      start: snapshot.context.from,
      endExclusive: snapshot.context.to,
    };
    snapshot.analysis.summary.usageKwh = 27_000;
    snapshot.reportTimeContext = {
      policyId: "preschool-report-time",
      policyRevision: "2",
      timezone: "Asia/Singapore",
      asOf: "2026-07-01T00:15:00.000Z",
      dataThroughLocalDate: "2026-06-30",
      lastRefreshedAt: "2026-07-01T00:10:00.000Z",
      windows: [{
        windowId: "current-overview",
        role: "current_progress",
        label: "Current calendar month Report Edition",
        strategy: { kind: "calendar_month_to_date" },
        phase: "complete",
        from: "2026-05-31T16:00:00.000Z",
        toExclusive: "2026-06-30T16:00:00.000Z",
        completeDayCount: 30,
        segments: [],
        comparisonCompatibilityKey: "calendar-month",
      }],
    };
    snapshot.reportWindowSegmentSummaries = [{
      windowId: "previous-month-comparison",
      status: "ready",
      segments: [{
        period: {
          start: "2026-04-30T16:00:00.000Z",
          endExclusive: "2026-05-31T16:00:00.000Z",
        },
        dataStatus: "complete",
        expectedDayCount: 31,
        completeDayCount: 31,
        summary: {
          usageKwh: 24_800,
          averageDailyUsageKwh: 800,
        },
        evidence: {
          dataSnapshotId: snapshot.dataSnapshot.id,
          queryId: "daily_totals_v1",
        },
      }],
    }];

    const view = buildPreschoolOverviewViewModel(snapshot);

    expect(view.overallSummary.monthComparison).toEqual({
      currentLabel: "June 2026",
      referenceLabel: "May 2026",
      currentEnergy: "27,000.00 kWh",
      referenceEnergy: "24,800.00 kWh",
      totalChange: "+2,200.00 kWh",
      totalChangePct: "+8.9%",
      averageDailyChangePct: "+12.5%",
      evidence: {
        dataSnapshotId: snapshot.dataSnapshot.id,
        queryId: "daily_totals_v1",
      },
    });

    snapshot.dataQuality.status = "partial";
    expect(buildPreschoolOverviewViewModel(snapshot).overallSummary.monthComparison).toBeNull();
  });

  it("projects the server-authoritative May Portfolio benchmark and Evidence", () => {
    const snapshot = preschoolGoldenSnapshot();
    snapshot.analysis.childScopes[0]!.topCircuitName = "preschool-centre-a:Aircon 1";
    const view = buildPreschoolOverviewViewModel(snapshot);

    expect(view.context).toMatchObject({
      projectName: "Preschool Portfolio",
      period: "1 May 2026–31 May 2026",
    });
    expect(view.overallSummary).toMatchObject({
      periodLabel: "May 2026",
      metrics: [
        { id: "centres", label: "Total centres", value: "30", available: true },
        { id: "energy", label: "Total energy · May 2026", value: "24,921.81 kWh", available: true },
        { id: "cost", label: "Estimated total cost · May 2026", value: "S$6,796.18", available: true },
      ],
      centreTypes: [
        { centreType: "Senior Care Center", centreCount: 14, energy: "11,637.00 kWh", estimatedCost: "S$3,173.41", share: "46.7%" },
        { centreType: "Active Aging Center", centreCount: 8, energy: "6,642.40 kWh", estimatedCost: "S$1,811.38", share: "26.7%" },
        { centreType: "Preschool", centreCount: 8, energy: "6,642.40 kWh", estimatedCost: "S$1,811.38", share: "26.7%" },
      ],
      total: {
        centreCount: 30,
        energy: "24,921.81 kWh",
        estimatedCost: "S$6,796.18",
        share: "100.0%",
      },
      costAssumption: {
        rate: "S$0.2727/kWh before GST",
        label: "SP Group Q2 2026 low-tension non-domestic reference",
      },
    });
    expect(view.centres).toHaveLength(30);
    expect(view.centres[0]).toMatchObject({
      rank: 1,
      name: "Centre A",
      usageKwh: "843.10",
      metadataStatus: "provisional",
      topCircuit: "Aircon 1",
      cohort: "Senior Care Center",
      quadrant: "lower-intensity",
    });
    expect(view.normalisation).toMatchObject({
      euiAvailableCount: 30,
      perPaxAvailableCount: 30,
      status: "provisional",
    });
    expect(view.benchmark).toMatchObject({
      status: "provisional",
      sampleSize: 30,
      eui: { p50: "7.03", p75: "10.53" },
      perPax: { p50: "18.4", p75: "20.8" },
      priorityCentreCodes: ["G", "M", "J"],
      scatter: {
        euiP75: 10.525439076,
        perPaxP75: 20.84584375,
      },
    });
    if (view.benchmark.status !== "provisional") throw new Error("Expected benchmark view");
    expect(view.benchmark.scatter.points).toHaveLength(30);
    expect(view.benchmark.scatter.points.find((point) => point.centreCode === "G"))
      .toMatchObject({ priority: true, quadrant: "priority", actionRank: 1 });
    expect(view.benchmark.priorityCentres.map((centre) => ({
      rank: centre.rank,
      centreCode: centre.centreCode,
      name: centre.name,
    }))).toEqual([
      { rank: 1, centreCode: "G", name: "Centre G" },
      { rank: 2, centreCode: "M", name: "Centre M" },
      { rank: 3, centreCode: "J", name: "Centre J" },
    ]);
    expect(view.benchmark.distributions.map((distribution) => ({
      id: distribution.id,
      label: distribution.label,
      question: distribution.question,
      unit: distribution.unit,
      axis: distribution.axis,
      cohorts: distribution.cohorts.map((cohort) => ({
        name: cohort.name,
        sampleSize: cohort.sampleSize,
        p50: cohort.p50,
        p75: cohort.p75,
        pointCount: cohort.points.length,
      })),
    }))).toEqual([
      {
        id: "eui",
        label: "Annualised EUI estimate",
        question: "Which Outlets use more energy than peers after adjusting for floor area?",
        unit: "kWh/m²/year",
        axis: { min: 0, max: 16 },
        cohorts: [
          { name: "Senior Care Center", sampleSize: 14, p50: "6.76", p75: "9.20", pointCount: 14 },
          { name: "Active Aging Center", sampleSize: 8, p50: "6.72", p75: "15.13", pointCount: 8 },
          { name: "Preschool", sampleSize: 8, p50: "9.00", p75: "10.95", pointCount: 8 },
        ],
      },
      {
        id: "per-pax",
        label: "Energy per person",
        question: "Which Outlets use more energy per person than peers of the same Centre type?",
        unit: "kWh/person/month",
        axis: { min: 0, max: 24 },
        cohorts: [
          { name: "Senior Care Center", sampleSize: 14, p50: "18.5", p75: "20.7", pointCount: 14 },
          { name: "Active Aging Center", sampleSize: 8, p50: "17.2", p75: "22.5", pointCount: 8 },
          { name: "Preschool", sampleSize: 8, p50: "18.1", p75: "20.1", pointCount: 8 },
        ],
      },
    ]);
    expect(view.benchmark.distributions.flatMap((distribution) => (
      distribution.cohorts.flatMap((cohort) => cohort.points)
    ))).toHaveLength(60);
    const euiDistribution = view.benchmark.distributions[0]!;
    const perPaxDistribution = view.benchmark.distributions[1]!;
    expect(euiDistribution.cohorts
      .find((cohort) => cohort.name === "Senior Care Center")?.points
      .find((point) => point.centreCode === "J"))
      .toMatchObject({ centreCode: "J", name: "Centre J", valueLabel: "12.90", aboveP75: true, priority: true });
    expect(perPaxDistribution.cohorts
      .find((cohort) => cohort.name === "Active Aging Center")?.points
      .filter((point) => point.aboveP75)
      .map((point) => point.centreCode)).toEqual(["M", "G"]);
    expect(perPaxDistribution.ranking.slice(0, 3).map((row) => ({
      rank: row.rank,
      centreCode: row.centreCode,
      aboveP75: row.aboveP75,
    }))).toEqual([
      { rank: 1, centreCode: "J", aboveP75: true },
      { rank: 2, centreCode: "M", aboveP75: true },
      { rank: 3, centreCode: "G", aboveP75: true },
    ]);
    expect(view.appliances).toMatchObject({
      status: "available",
      totalEnergy: "24,921.81 kWh",
    });
    if (view.appliances.status !== "available") throw new Error(view.appliances.detail);
    expect(view.appliances.rows).toHaveLength(9);
    expect(view.appliances.rows[0]).toMatchObject({
      name: "Aircon 1",
      applianceGroup: "Aircon",
      energy: "5,200.00 kWh",
      centreCount: 30,
      relativeToTopPct: 100,
    });
    expect(view.appliances.rows.reduce((sum, row) => sum + row.usageKwh, 0)).toBe(24_921.8123);
    expect(view.operational).toMatchObject({
      status: "available",
      hourlyProfile: {
        completeDayCount: 31,
        unit: "mean kWh per complete day",
        peakHourLabel: "11:00–12:00",
      },
      standby: {
        energy: "3,103.78 kWh",
        provisionalCost: "S$846.40",
        share: "12.5%",
        spikeCount: 7,
        centreCount: 3,
        reconciliation: "0.0000 kWh reconciliation gap",
      },
      operating: {
        energy: "21,818.03 kWh",
        provisionalCost: "S$5,949.78",
        share: "87.5%",
        spikeCount: 21,
        centreCount: 14,
        reconciliation: "0.0000 kWh reconciliation gap",
      },
      sop: {
        label: "After-hours Review Priority",
        sourceLabel: "Provisional after-hours SOP signal",
        breachingCentreCodes: ["L", "E", "N"],
        centres: [
          { centreCode: "L", standbySpikeCount: 4, score: "96" },
          { centreCode: "E", standbySpikeCount: 2, score: "98" },
          { centreCode: "N", standbySpikeCount: 1, score: "99" },
        ],
      },
    });
    if (view.operational.status !== "available") throw new Error(view.operational.detail);
    expect(view.operational.hourlyProfile.rows).toHaveLength(24);
    expect(view.operational.hourlyProfile.rows[0]).toMatchObject({
      hour: 0,
      label: "00:00–01:00",
      operatingKwh: 0,
      closedHourKwh: 13,
    });
    expect(view.operational.standby.centres[0]).toMatchObject({
      centreCode: "L",
      centreType: "Preschool",
    });
    expect(view.operational.standby.applianceGroups.map((group) => [group.name, group.share]))
      .toEqual([
        ["Plugload", "97.4%"],
        ["Aircon", "2.0%"],
        ["Lighting", "0.5%"],
        ["Heater", "0.1%"],
      ]);
    expect(view.operational.standby.appliances).toHaveLength(9);
    expect(view.operational.standby.appliances.reduce((sum, appliance) => sum + appliance.sharePct, 0)).toBe(100);
    expect(view.operational.standby.centres.map((centre) => [centre.centreCode, centre.events.length]))
      .toEqual([["L", 4], ["E", 2], ["N", 1]]);
    expect(view.operational.standby.centres[0]?.events.map((event) => event.when)).toEqual([
      "25 May · 01:00–02:00",
      "24 May · 04:00–05:00",
      "23 May · 07:00–08:00",
      "22 May · 10:00–11:00",
    ]);
    expect(view.operational.standby.centres[1]?.events[0]).toMatchObject({
      when: "4 May · 23:00–00:00",
      leadingCircuit: "Heater · 95%",
    });
    expect(view.operational.operating.centres.find((centre) => centre.centreCode === "A"))
      .toMatchObject({ centreType: "Senior Care Center" });
    expect(view.operational.operating.applianceGroups.map((group) => [group.name, group.share]))
      .toEqual([
        ["Plugload", "52.0%"],
        ["Aircon", "25.1%"],
        ["Lighting", "18.9%"],
        ["Heater", "4.0%"],
      ]);
    expect(view.operational.operating.appliances).toHaveLength(9);
    expect(view.operational.operating.appliances.reduce((sum, appliance) => sum + appliance.sharePct, 0)).toBe(100);
    expect(view.operational.operating.appliances[0]).toMatchObject({
      name: "Plug Load3",
      applianceGroup: "Plugload",
      share: "24.0%",
      centreCount: 30,
    });
    expect(view.operational.operating.centres.map((centre) => [centre.centreCode, centre.events.length]))
      .toEqual([
        ["A", 8], ["B", 1], ["C", 1], ["D", 1], ["E", 1], ["F", 1], ["G", 1],
        ["H", 1], ["I", 1], ["J", 1], ["K", 1], ["L", 1], ["M", 1], ["N", 1],
      ]);
    expect(view.operational.operating.centres[0]?.events).toHaveLength(8);
    expect(view.operational.operating.centres[1]?.events[0]).toMatchObject({
      when: "18 May · 14:00–15:00",
      leadingCircuit: "Aircon 1 · 93%",
    });
    expect(view.decisionSummary.items).toHaveLength(4);
    expect(view.decisionSummary.items.map((item) => item.id)).toEqual([
      "efficiency",
      "after-hours",
      "operating",
      "planning",
    ]);
    expect(view.decisionSummary.items[0]).toMatchObject({
      priority: 2,
      sectionNumber: 2,
      targetId: "preschool-benchmark-analysis",
      sectionId: "centre-benchmark",
      label: "High for both floor area and headcount",
      centreCodes: ["G", "M", "J"],
      primaryMetric: {
        value: 3,
        valueLabel: "3",
      },
    });
    expect(view.decisionSummary.items[1]).toMatchObject({
      priority: 1,
      sectionNumber: 3,
      targetId: "preschool-standby-wastage",
      sectionId: "operating-behaviour",
      label: "Energy used after closing",
      centreCodes: ["L", "E", "N"],
      primaryMetric: {
        label: "Share used after closing",
        value: 12.45,
        valueLabel: "12.5%",
      },
      supportingMetrics: expect.arrayContaining([
        { label: "Energy used after closing", valueLabel: "3,103.78 kWh" },
        { label: "Unusual closed-hour peaks", valueLabel: "7" },
      ]),
    });
    expect(view.decisionSummary.items[2]).toMatchObject({
      priority: 3,
      sectionNumber: 4,
      targetId: "preschool-operating-hours",
      sectionId: "operating-behaviour",
      label: "Unusual peaks during opening hours",
      primaryMetric: {
        value: 14,
        valueLabel: "14",
      },
    });
    expect(view.decisionSummary.items[3]).toMatchObject({
      priority: null,
      sectionNumber: 5,
      targetId: "preschool-monthly-outlook",
      sectionId: "planning-outlook",
      label: "June 2026 planning baseline",
      primaryMetric: {
        label: "Estimated June 2026 energy",
        value: 24_348.2143,
        valueLabel: "24,348 kWh",
      },
      supportingMetrics: expect.arrayContaining([
        { label: "Estimated June 2026 cost", valueLabel: "S$6,640" },
        { label: "Source window", valueLabel: "4 complete weeks" },
      ]),
    });
    expect(view.decisionSummary.items.every((item) => (
      item.primaryMetric.valueLabel.length > 0
      && item.limitation.length > 0
      && item.evidenceRefs.length > 0
    ))).toBe(true);
    expect(view.planningOutlook).toMatchObject({
      status: "provisional",
      targetPeriod: "1–30 Jun 2026",
      weeklyAverage: "5,681 kWh/week",
      projectedUsage: "24,348 kWh",
      projectedRange: "23,571–24,857 kWh",
      currentPeriodCost: "S$6,796",
      projectedCost: "S$6,640",
      projectedCostRange: "S$6,428–S$6,779",
      tariffRate: "27.27¢/kWh before GST",
      sourceWeeks: [
        { label: "4 May–10 May", usage: "5,500 kWh" },
        { label: "11 May–17 May", usage: "5,750 kWh" },
        { label: "18 May–24 May", usage: "5,675 kWh" },
        { label: "25 May–31 May", usage: "5,800 kWh" },
      ],
    });
    expect(view.liveForecast).toMatchObject({ status: "unavailable", label: "Unavailable" });
    expect(view.forecast).toMatchObject({
      status: "waiting",
      statusLabel: "Planning baseline ready · Frozen comparison pending",
      comparisonStatus: "planning-baseline",
      targetMonth: "June 2026",
      targetPeriod: "1–30 Jun 2026",
      defaultScopeId: "preschool-project",
      centreSelectionAvailable: true,
      planEvidence: "Current Snapshot preschool-26b85b9c0b95e090 · daily_totals_v1",
      actualEvidence: "June 2026 Actual not available yet",
      scopes: expect.arrayContaining([
        expect.objectContaining({
          scopeId: "preschool-project",
          expectedFullMonthEnergy: "24,348 kWh",
          expectedFullMonthCost: "S$6,640",
          consumedSoFar: "Awaiting first complete day",
          paceVsOriginalEstimate: "Frozen Original Estimate pending",
          coverage: "0 / 30 complete days",
        }),
        expect.objectContaining({ scopeId: "preschool-centre-1", role: "centre" }),
      ]),
    });
    if (view.forecast.status === "unavailable") throw new Error(view.forecast.detail);
    expect(view.forecast.scopes[0]?.buckets.daily).toHaveLength(30);
    expect(view.forecast.scopes[0]?.buckets.weekly).toHaveLength(5);
    expect(view.forecast.scopes[0]?.buckets.monthly).toHaveLength(1);
    expect(view.forecast.scopes[0]?.buckets.daily[0]).toMatchObject({
      actualKwh: null,
      actual: "Waiting",
      actualStatus: "waiting",
      coverage: "0 / 1 complete days",
    });
    if (view.planningOutlook.status !== "provisional") throw new Error(view.planningOutlook.detail);
    expect(view.planningOutlook.limitations.join(" ")).toContain("not the customer's contract or bill");
    expect(JSON.stringify(view.planningOutlook)).not.toMatch(/28,011|7,639|simulated actual/i);
    if (view.operational.status !== "available") throw new Error("Expected operational view");
    expect(view.operational.standby.centres[0]?.worst).toMatchObject({
      when: "25 May · 01:00–02:00",
      dayType: "Weekend",
      leadingCircuit: "Living Room Lighting · 96%",
    });
    expect(view.evidence.benchmarkRecipeIds).toEqual([
      "preschool-eui-benchmark-v1",
      "preschool-per-pax-benchmark-v1",
      "preschool-quadrant-v1",
    ]);
    expect(view.evidence.operationalRecipeIds).toEqual([
      "preschool-hour-slot-spike-v1",
      "preschool-after-hours-sop-signal-v1",
      "preschool-operating-state-appliance-v1",
    ]);
    expect(view.evidence.planningRecipeIds).toEqual(["preschool-naive-weekly-planning-baseline-v1"]);
    expect(view.evidence.applianceRecipeIds).toEqual(["preschool-appliance-ranking-v1"]);
  });

  it("uses Saved A planning with Day 7 current B actual and renders server-withheld variance", () => {
    const snapshot = preschoolGoldenSnapshot();
    attachPlanningLifecycle(snapshot, {
      status: "partial",
      usageKwh: 1_400,
      completeDayCount: 7,
      varianceKwh: null,
      variancePct: null,
    });

    const view = buildPreschoolOverviewViewModel(snapshot);

    expect(view.planningOutlook).toMatchObject({
      status: "provisional",
      actual: {
        status: "partial",
        statusLabel: "Partial actual",
        usage: "1,400 kWh",
        coverage: "7 / 30 complete days",
        variance: "withheld until 30 / 30 complete days",
        varianceStatus: "withheld",
        planEvidence: "Saved saved-a · Snapshot snapshot-a",
        actualEvidence: "Current Snapshot snapshot-b · daily_totals_v1",
      },
    });
  });

  it("formats the server-authoritative Day 30 delta without deriving it in the browser", () => {
    const snapshot = preschoolGoldenSnapshot();
    attachPlanningLifecycle(snapshot, {
      status: "complete",
      usageKwh: 25_000,
      completeDayCount: 30,
      varianceKwh: 651.79,
      variancePct: 2.68,
    });

    const view = buildPreschoolOverviewViewModel(snapshot);

    expect(view.planningOutlook).toMatchObject({
      status: "provisional",
      actual: {
        status: "complete",
        statusLabel: "Complete actual",
        usage: "25,000 kWh",
        coverage: "30 / 30 complete days",
        variance: "+651.79 kWh · +2.68% versus plan",
        varianceStatus: "available",
      },
    });
  });

  it.each([
    {
      status: "waiting" as const,
      completeDayCount: 0,
      usageKwh: null,
      pacePct: null,
      expected: {
        status: "waiting",
        statusLabel: "Awaiting first complete day",
        consumedSoFar: "Awaiting first complete day",
        paceVsOriginalEstimate: "Starts after first complete day",
        coverage: "0 / 30 complete days",
      },
    },
    {
      status: "partial" as const,
      completeDayCount: 7,
      usageKwh: 1_400,
      pacePct: 24.64,
      expected: {
        status: "partial",
        statusLabel: "Actual to date + remaining estimate",
        consumedSoFar: "1,400 kWh",
        paceVsOriginalEstimate: "24.64%",
        coverage: "7 / 30 complete days",
      },
    },
    {
      status: "complete" as const,
      completeDayCount: 30,
      usageKwh: 25_000,
      pacePct: 102.68,
      expected: {
        status: "complete",
        statusLabel: "Complete month · Above original estimate",
        consumedSoFar: "25,000 kWh",
        paceVsOriginalEstimate: "102.68%",
        coverage: "30 / 30 complete days",
      },
    },
  ])("maps the server-authoritative $status forecast without recalculating its KPIs", ({
    status,
    completeDayCount,
    usageKwh,
    pacePct,
    expected,
  }) => {
    const snapshot = preschoolGoldenSnapshot();
    attachPlanningLifecycle(snapshot, {
      status: status === "complete" ? "complete" : "partial",
      usageKwh,
      completeDayCount,
      varianceKwh: status === "complete" ? 651.79 : null,
      variancePct: status === "complete" ? 2.68 : null,
    }, { status, pacePct });

    const view = buildPreschoolOverviewViewModel(snapshot);

    expect(view.forecast).toMatchObject({
      status: expected.status,
      statusLabel: expected.statusLabel,
      targetMonth: "June 2026",
      targetPeriod: "1–30 Jun 2026",
      comparisonStatus: "frozen-original",
      defaultScopeId: snapshot.context.scopeId,
      centreSelectionAvailable: true,
      scopes: [
        {
          scopeId: snapshot.context.scopeId,
          label: snapshot.context.scopeName,
          role: "portfolio",
          expectedFullMonthEnergy: expect.stringMatching(/kWh$/),
          expectedFullMonthCost: expect.stringMatching(/^S\$/),
          consumedCostSoFar: expect.any(String),
          ...expected,
          buckets: {
            daily: expect.arrayContaining([
              expect.objectContaining({
                originalEstimateKwh: expect.any(Number),
                actualStatus: expect.any(String),
              }),
            ]),
            weekly: expect.any(Array),
            monthly: expect.any(Array),
          },
        },
        expect.objectContaining({ scopeId: "centre-a", label: "Centre A", role: "centre" }),
      ],
      planEvidence: "Saved saved-a · Snapshot snapshot-a · daily_totals_v1",
      actualEvidence: "Current Snapshot snapshot-b · daily_totals_v1",
      tariff: {
        status: "effective",
        rate: "S$0.2727/kWh before GST",
        effectiveRange: "1 Apr–30 Jun 2026",
      },
    });
    if (view.forecast.status === "unavailable") throw new Error(view.forecast.detail);
    expect(view.forecast.scopes[0]?.buckets.daily).toHaveLength(30);
    expect(view.forecast.scopes[0]?.buckets.weekly).toHaveLength(5);
    expect(view.forecast.scopes[0]?.buckets.monthly).toHaveLength(1);
  });

  it("maps a 31-day July lifecycle without retaining June labels or a 30-day assumption", () => {
    const snapshot = preschoolGoldenSnapshot();
    snapshot.context.latestCompleteLocalDay = "2026-06-30";
    snapshot.context.monthlyOutlookTargetPeriod = {
      start: "2026-07-01",
      endExclusive: "2026-08-01",
      timezone: "Asia/Singapore",
      targetDayCount: 31,
    };
    attachPlanningLifecycle(snapshot, {
      status: "partial",
      usageKwh: 2_800,
      completeDayCount: 14,
      varianceKwh: null,
      variancePct: null,
    }, { status: "partial", pacePct: 95.2 }, {
      targetStart: "2026-07-01",
      targetDayCount: 31,
    });

    const view = buildPreschoolOverviewViewModel(snapshot);

    expect(view.forecast).toMatchObject({
      status: "partial",
      targetMonth: "July 2026",
      targetPeriod: "1–31 Jul 2026",
      tariff: {
        status: "provisional",
        label: "Provisional · using latest available tariff",
      },
      scopes: expect.arrayContaining([expect.objectContaining({
        coverage: "14 / 31 complete days",
        actualThrough: "Actual through 14 Jul 2026",
      })]),
    });
    if (view.forecast.status === "unavailable") throw new Error(view.forecast.detail);
    expect(view.forecast.scopes[0]?.buckets.daily).toHaveLength(31);
    expect(view.forecast.scopes[0]?.buckets.monthly[0]).toMatchObject({
      start: "2026-07-01",
      endExclusive: "2026-08-01",
    });
    expect(view.forecast.scopes[0]?.buckets.daily[0]).toMatchObject({
      actualKwh: expect.any(Number),
      currentOutlookKwh: null,
    });
    expect(view.forecast.scopes[0]?.buckets.daily[14]).toMatchObject({
      actualKwh: null,
      currentOutlookKwh: expect.any(Number),
    });
  });

  it("rejects a lifecycle target that does not match the Snapshot-derived monthly target", () => {
    const snapshot = preschoolGoldenSnapshot();
    attachPlanningLifecycle(snapshot, {
      status: "partial",
      usageKwh: 2_800,
      completeDayCount: 14,
      varianceKwh: null,
      variancePct: null,
    }, { status: "partial", pacePct: 95.2 }, {
      targetStart: "2026-07-01",
      targetDayCount: 31,
    });

    expect(buildPreschoolOverviewViewModel(snapshot).forecast).toMatchObject({
      status: "unavailable",
      detail: expect.stringContaining("does not match"),
    });
  });

  it("fails the Forecast closed when its Plan and Actual Evidence identities do not match the lifecycle pins", () => {
    const snapshot = preschoolGoldenSnapshot();
    attachPlanningLifecycle(snapshot, {
      status: "partial",
      usageKwh: 1_400,
      completeDayCount: 7,
      varianceKwh: null,
      variancePct: null,
    }, { status: "partial", pacePct: 24.64 });
    const lifecycle = snapshot.preschoolPlanningLifecycle;
    if (!lifecycle || lifecycle.status !== "available" || !lifecycle.forecast) throw new Error("Expected forecast fixture");
    lifecycle.forecast.evidence.actualDataSnapshotId = "stale-snapshot";

    const view = buildPreschoolOverviewViewModel(snapshot);

    expect(view.forecast).toMatchObject({
      status: "unavailable",
      detail: expect.stringContaining("Snapshot-bound Forecast series"),
    });
  });

  it("keeps target-month Energy visible while withholding only Cost when the server has no tariff reference", () => {
    const snapshot = preschoolGoldenSnapshot();
    attachPlanningLifecycle(snapshot, {
      status: "partial",
      usageKwh: 1_400,
      completeDayCount: 7,
      varianceKwh: null,
      variancePct: null,
    }, { status: "partial", pacePct: 24.64 });
    const lifecycle = snapshot.preschoolPlanningLifecycle;
    if (!lifecycle || lifecycle.status !== "available" || !lifecycle.forecast) throw new Error("Expected forecast fixture");
    Reflect.deleteProperty(lifecycle.plan, "tariffReference");
    lifecycle.forecast.tariffAssumption = {
      status: "unavailable",
      reason: "No accepted tariff reference is available for this target month.",
    };
    for (const scope of lifecycle.forecast.scopes) {
      scope.estimatedCostBeforeGstSgd = null;
      scope.expectedFullMonthCostBeforeGstSgd = null;
      scope.actualCostBeforeGstSgd = null;
    }

    const view = buildPreschoolOverviewViewModel(snapshot);

    expect(view.overallSummary.costAssumption).toBeNull();
    expect(view.forecast).toMatchObject({
      status: "partial",
      tariff: {
        status: "unavailable",
        rate: "Unavailable",
      },
      scopes: expect.arrayContaining([expect.objectContaining({
        expectedFullMonthEnergy: expect.stringMatching(/kWh$/),
        expectedFullMonthCost: "Unavailable",
        consumedCostSoFar: "Unavailable",
      })]),
    });
  });

  it("retains the current planning baseline when the Saved A lifecycle is unavailable", () => {
    const snapshot = preschoolGoldenSnapshot();
    Reflect.set(snapshot, "preschoolPlanningLifecycle", {
      status: "unavailable",
      reason: {
        code: "NO_COMPATIBLE_SAVED_ANALYSIS",
        message: "No older Saved A.",
      },
    });

    const view = buildPreschoolOverviewViewModel(snapshot);

    expect(view.planningOutlook).toMatchObject({
      status: "provisional",
      projectedUsage: "24,348 kWh",
      actual: null,
    });
    expect(view.forecast).toMatchObject({
      status: "waiting",
      comparisonStatus: "planning-baseline",
      targetMonth: "June 2026",
      targetPeriod: "1–30 Jun 2026",
      scopes: expect.arrayContaining([expect.objectContaining({
        expectedFullMonthEnergy: "24,348 kWh",
        expectedFullMonthCost: "S$6,640",
        consumedSoFar: "Awaiting first complete day",
        paceVsOriginalEstimate: "Frozen Original Estimate pending",
      })]),
    });
  });

  it("presents a Calendar exception honestly without labelling it a public holiday", () => {
    const snapshot = preschoolGoldenSnapshot();
    if (snapshot.preschoolOperational?.status !== "available") throw new Error("Expected operational fixture");
    snapshot.preschoolOperational.spikes.standby.centres[0]!.worstSpike.dayType = "calendar_exception";

    const view = buildPreschoolOverviewViewModel(snapshot);
    if (view.operational.status !== "available") throw new Error("Expected operational view");
    expect(view.operational.standby.centres[0]?.worst.dayType).toBe("Calendar exception");
    expect(view.operational.standby.centres[0]?.worst.dayType).not.toBe("Public Holiday");
  });

  it("does not infer a Day Type when reading an older cached projection without the additive field", () => {
    const snapshot = preschoolGoldenSnapshot();
    if (snapshot.preschoolOperational?.status !== "available") throw new Error("Expected operational fixture");
    Reflect.deleteProperty(snapshot.preschoolOperational.spikes.standby.centres[0]!.worstSpike, "dayType");

    const view = buildPreschoolOverviewViewModel(snapshot);
    if (view.operational.status !== "available") throw new Error("Expected operational view");
    expect(view.operational.standby.centres[0]?.worst.dayType).toBe("Unavailable");
  });

  it("shows an honest operational Unavailable state without inferring Spikes or SOP", () => {
    const snapshot = preschoolGoldenSnapshot();
    snapshot.preschoolOperational = {
      status: "unavailable",
      reason: {
        code: "PRESCHOOL_OPERATING_CALENDAR_UNAVAILABLE",
        message: "No release-pinned operating Calendar is available.",
      },
      evidence: {
        projectReleaseId: snapshot.projectRelease.id,
        dataSnapshotId: snapshot.dataSnapshot.id,
        businessCalendarVersion: snapshot.projectRelease.businessCalendarVersion,
      },
    };
    snapshot.preschoolDecisionSignals!.items = snapshot.preschoolDecisionSignals!.items
      .filter((item) => item.id === "efficiency")
      .map((item) => ({ ...item, priority: 1 }));

    const view = buildPreschoolOverviewViewModel(snapshot);
    expect(view.operational).toEqual({
      status: "unavailable",
      detail: "No release-pinned operating Calendar is available.",
    });
    expect(view.planningOutlook).toMatchObject({ status: "unavailable" });
    expect(view.evidence.operationalRecipeIds).toEqual([]);
    expect(view.decisionSummary.items.map((item) => item.id)).toEqual(["efficiency"]);
    expect(view.decisionSummary.items.map((item) => item.priority)).toEqual([1]);
  });

  it("fails closed when the API runtime returns an unsupported operational contract version", () => {
    const snapshot = preschoolGoldenSnapshot();
    if (snapshot.preschoolOperational?.status !== "available") throw new Error("Expected operational fixture");
    Reflect.set(snapshot.preschoolOperational.contract, "version", "1");

    const view = buildPreschoolOverviewViewModel(snapshot);

    expect(view.operational).toEqual({
      status: "unavailable",
      detail: "The current API runtime returned a superseded operational Evidence contract. Refresh the runtime before using Standby, Operating-hours or Spike findings.",
    });
  });

  it("accepts the current-window Operational v3 contract while retaining v2 Saved Analysis compatibility", () => {
    const currentSnapshot = preschoolGoldenSnapshot();
    if (currentSnapshot.preschoolOperational?.status !== "available") {
      throw new Error("Expected operational fixture");
    }
    Reflect.set(currentSnapshot.preschoolOperational.contract, "version", "3");

    const currentView = buildPreschoolOverviewViewModel(currentSnapshot);
    const savedView = buildPreschoolOverviewViewModel(preschoolGoldenSnapshot());

    expect(currentView.operational.status).toBe("available");
    expect(savedView.operational.status).toBe("available");
  });

  it("fails closed when a pre-A4 v2 runtime omits operating-state Appliance evidence", () => {
    const snapshot = preschoolGoldenSnapshot();
    if (snapshot.preschoolOperational?.status !== "available") throw new Error("Expected operational fixture");
    Reflect.deleteProperty(snapshot.preschoolOperational, "operatingAppliances");

    const view = buildPreschoolOverviewViewModel(snapshot);

    expect(view.operational).toEqual({
      status: "unavailable",
      detail: "The current API runtime returned a superseded operational Evidence contract. Refresh the runtime before using Standby, Operating-hours or Spike findings.",
    });
  });

  it("does not calculate percentiles in the browser when the server projection is absent", () => {
    const snapshot = preschoolGoldenSnapshot();
    delete snapshot.preschoolBenchmark;
    snapshot.preschoolDecisionSignals!.items = snapshot.preschoolDecisionSignals!.items
      .filter((item) => item.id !== "efficiency")
      .map((item, index) => ({ ...item, priority: (index + 1) as 1 | 2 | 3 }));
    const view = buildPreschoolOverviewViewModel(snapshot);

    expect(view.benchmark).toMatchObject({ status: "unavailable" });
    expect(view.benchmark.detail).toContain("No client-side percentile");
    expect(view.centres.every((centre) => centre.eui === null && centre.perPax === null)).toBe(true);
    expect(view.decisionSummary.items.map((item) => item.id)).toEqual(["after-hours", "operating", "planning"]);
    expect(view.decisionSummary.items.map((item) => item.priority)).toEqual([1, 2, null]);
  });

  it("does not calculate an Appliance ranking in the browser when the server projection is absent", () => {
    const snapshot = preschoolGoldenSnapshot();
    delete snapshot.preschoolAppliances;

    const view = buildPreschoolOverviewViewModel(snapshot);

    expect(view.appliances).toMatchObject({ status: "unavailable" });
    expect(view.appliances.detail).toContain("server-authoritative Appliance ranking");
    expect(view.evidence.applianceRecipeIds).toEqual([]);
  });

  it("withholds decision priorities but retains the deterministic planning directory item when the Snapshot is partial", () => {
    const snapshot = preschoolGoldenSnapshot();
    snapshot.dataQuality.status = "partial";
    snapshot.preschoolDecisionSignals = {
      ...snapshot.preschoolDecisionSignals!,
      status: "withheld",
      reason: { code: "SNAPSHOT_INCOMPLETE", message: "Decision signals are withheld because the current Snapshot is not complete." },
      items: [],
    };

    const view = buildPreschoolOverviewViewModel(snapshot);

    expect(view.decisionSummary.items.map((item) => item.id)).toEqual(["planning"]);
    expect(view.decisionSummary.items.map((item) => item.priority)).toEqual([null]);
    expect(view.benchmark).toMatchObject({ status: "provisional" });
    expect(view.operational).toMatchObject({ status: "available" });
  });

  it("does not backfill decision priorities when both server projections are absent", () => {
    const snapshot = preschoolGoldenSnapshot();
    delete snapshot.preschoolBenchmark;
    delete snapshot.preschoolOperational;
    delete snapshot.preschoolDecisionSignals;

    const view = buildPreschoolOverviewViewModel(snapshot);

    expect(view.decisionSummary.items).toEqual([]);
    expect(view.decisionSummary.detail).toContain("unavailable");
  });

  it("fails closed when the published Renderer key does not match", () => {
    const snapshot = preschoolGoldenSnapshot();
    snapshot.renderer.key = "ngee-ann-overview";
    expect(() => buildPreschoolOverviewViewModel(snapshot))
      .toThrow("PRESCHOOL_OVERVIEW_RENDERER_MISMATCH");
  });
});

const attachPlanningLifecycle = (
  snapshot: ReturnType<typeof preschoolGoldenSnapshot>,
  actual: {
    status: "partial" | "complete";
    usageKwh: number | null;
    completeDayCount: number;
    varianceKwh: number | null;
    variancePct: number | null;
  },
  forecast?: {
    status: "waiting" | "partial" | "complete";
    pacePct: number | null;
  },
  options: {
    targetStart?: string;
    targetDayCount?: number;
  } = {},
): void => {
  if (
    snapshot.preschoolOperational?.status !== "available"
    || snapshot.preschoolOperational.planningOutlook.status !== "provisional"
  ) throw new Error("Expected planning fixture");
  const plan = structuredClone(snapshot.preschoolOperational.planningOutlook);
  plan.evidence.dataSnapshotId = "snapshot-a";
  const targetStart = options.targetStart ?? "2026-06-01";
  const targetDayCount = options.targetDayCount ?? 30;
  const targetEndExclusive = shiftFixtureDate(targetStart, targetDayCount);
  Reflect.set(plan, "targetPeriod", {
    start: targetStart,
    endInclusive: shiftFixtureDate(targetEndExclusive, -1),
    endExclusive: targetEndExclusive,
    timezone: "Asia/Singapore",
    days: targetDayCount,
  });
  const forecastScopes = forecast
    ? [
        forecastScope({
          scopeId: snapshot.context.scopeId,
          scopeName: snapshot.context.scopeName,
          role: "portfolio",
          estimatedKwh: plan.usageEstimate.projectedKwh,
          estimatedCost: plan.costEstimate.projectedBeforeGstSgd,
          actualKwh: actual.usageKwh,
          completeDayCount: actual.completeDayCount,
          pacePct: forecast.pacePct,
          targetStart,
          targetDayCount,
        }),
        forecastScope({
          scopeId: "centre-a",
          scopeName: "Centre A",
          role: "centre",
          estimatedKwh: 6_000,
          estimatedCost: 1_636.2,
          actualKwh: forecast.status === "waiting" ? null : forecast.status === "complete" ? 6_300 : 420,
          completeDayCount: actual.completeDayCount,
          pacePct: forecast.status === "waiting" ? null : forecast.status === "complete" ? 105 : 30,
          targetStart,
          targetDayCount,
        }),
      ]
    : null;
  Reflect.set(snapshot, "preschoolPlanningLifecycle", {
    status: "available",
    contract: { id: "preschool-saved-plan-current-actual", version: "2" },
    targetPeriod: {
      start: targetStart,
      endExclusive: targetEndExclusive,
      timezone: "Asia/Singapore",
      targetDayCount,
    },
    plan,
    actual: { ...actual, targetDayCount },
    ...(forecast && forecastScopes ? {
      forecast: {
        status: forecast.status,
        contract: {
          id: "preschool-monthly-energy-outlook",
          version: "2",
          method: "same-weekday mean from four complete May weeks, scaled to the Saved Plan total",
        },
        targetPeriod: {
          start: targetStart,
          endExclusive: targetEndExclusive,
          timezone: "Asia/Singapore",
          targetDayCount,
        },
        tariffAssumption: {
          status: targetStart <= "2026-06-30" ? "effective" : "provisional",
          beforeGstSgdPerKwh: 0.2727,
          sourceName: "SP Group",
          sourceUrl: "https://example.com/tariff",
          supplyClass: "Low tension, non-domestic",
          appliesFrom: "2026-04-01",
          appliesTo: "2026-06-30",
          beforeGst: true,
          notBill: true,
        },
        scopes: forecastScopes,
        evidence: {
          planDataSnapshotId: "snapshot-a",
          actualDataSnapshotId: "snapshot-b",
          planQueryId: "daily_totals_v1",
          actualQueryId: "daily_totals_v1",
          recipeId: "preschool-weekday-mean-series-v1",
        },
      },
    } : {}),
    planProvenance: {
      savedAnalysisId: "saved-a",
      dataSnapshotId: "snapshot-a",
      projectReleaseId: snapshot.projectRelease.id,
      templateRevisionId: snapshot.projectRelease.templateRevisionId,
      queryId: "daily_totals_v1",
      recipeId: "preschool-naive-weekly-planning-baseline-v1",
    },
    actualProvenance: {
      dataSnapshotId: "snapshot-b",
      projectReleaseId: snapshot.projectRelease.id,
      queryId: "daily_totals_v1",
      period: {
        start: targetStart,
        endExclusive: targetEndExclusive,
        timezone: "Asia/Singapore",
      },
    },
  });
};

const forecastScope = (input: {
  scopeId: string;
  scopeName: string;
  role: "portfolio" | "centre";
  estimatedKwh: number;
  estimatedCost: number;
  actualKwh: number | null;
  completeDayCount: number;
  pacePct: number | null;
  targetStart: string;
  targetDayCount: number;
}) => {
  const daily = Array.from({ length: input.targetDayCount }, (_, index) => ({
    start: shiftFixtureDate(input.targetStart, index),
    endExclusive: shiftFixtureDate(input.targetStart, index + 1),
    estimatedKwh: input.estimatedKwh / input.targetDayCount,
    originalEstimateKwh: input.estimatedKwh / input.targetDayCount,
    actualKwh: index < input.completeDayCount && input.actualKwh !== null
      ? input.actualKwh / input.completeDayCount
      : null,
    currentOutlookKwh: index < input.completeDayCount && input.actualKwh !== null
      ? input.actualKwh / input.completeDayCount
      : input.estimatedKwh / input.targetDayCount,
    futureOutlookKwh: index < input.completeDayCount
      ? null
      : input.estimatedKwh / input.targetDayCount,
    actualCompleteDayCount: index < input.completeDayCount ? 1 : 0,
    actualTargetDayCount: 1,
    actualStatus: index < input.completeDayCount ? "complete" as const : "waiting" as const,
  }));
  const aggregate = (size: number) => Array.from({ length: Math.ceil(input.targetDayCount / size) }, (_, bucketIndex) => {
    const rows = daily.slice(bucketIndex * size, (bucketIndex + 1) * size);
    const actualRows = rows.filter((row) => row.actualKwh !== null);
    return {
      start: rows[0]!.start,
      endExclusive: rows.at(-1)!.endExclusive,
      estimatedKwh: rows.reduce((sum, row) => sum + row.estimatedKwh, 0),
      originalEstimateKwh: rows.reduce((sum, row) => sum + row.originalEstimateKwh, 0),
      actualKwh: actualRows.length === 0 ? null : actualRows.reduce((sum, row) => sum + row.actualKwh!, 0),
      currentOutlookKwh: rows.reduce((sum, row) => sum + row.currentOutlookKwh, 0),
      futureOutlookKwh: rows.some((row) => row.futureOutlookKwh !== null)
        ? rows.reduce((sum, row) => sum + (row.futureOutlookKwh ?? 0), 0)
        : null,
      actualCompleteDayCount: actualRows.length,
      actualTargetDayCount: rows.length,
      actualStatus: actualRows.length === 0
        ? "waiting" as const
        : actualRows.length === rows.length
          ? "complete" as const
          : "partial" as const,
    };
  });
  return {
    scopeId: input.scopeId,
    scopeName: input.scopeName,
    scopeType: input.role === "portfolio" ? "project" : "centre",
    scopeRole: input.role,
    estimatedKwh: input.estimatedKwh,
    estimatedCostBeforeGstSgd: input.estimatedCost,
    expectedFullMonthKwh: daily.reduce((sum, row) => sum + row.currentOutlookKwh, 0),
    expectedFullMonthCostBeforeGstSgd: daily.reduce((sum, row) => sum + row.currentOutlookKwh, 0) * 0.2727,
    actualKwh: input.actualKwh,
    actualCostBeforeGstSgd: input.actualKwh === null ? null : input.actualKwh * 0.2727,
    actualCompleteDayCount: input.completeDayCount,
    actualTargetDayCount: input.targetDayCount,
    actualThroughLocalDate: input.completeDayCount === 0
      ? null
      : shiftFixtureDate(input.targetStart, input.completeDayCount - 1),
    pacePct: input.pacePct,
    outcome: input.completeDayCount === 30 ? "above_plan" as const : null,
    originalEstimateIdentity: `saved-a:${input.targetStart}:snapshot-a:preschool-weekday-mean-series-v1`,
    actualIdentity: `snapshot-b:${input.targetStart}:${input.completeDayCount}`,
    currentOutlookIdentity: `saved-a:snapshot-b:${input.completeDayCount}`,
    buckets: {
      daily,
      weekly: aggregate(7),
      monthly: aggregate(input.targetDayCount),
    },
  };
};

const shiftFixtureDate = (localDate: string, days: number): string => {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
