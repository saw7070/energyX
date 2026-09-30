import { describe, expect, it } from "vitest";

import { createOverviewAiArtifactIdentity } from "./overview-ai-artifact.js";
import type { ProjectAnalysisSnapshot } from "./project-analysis-resolver.js";
import { assemblePreschoolSectionPacks } from "./preschool-section-pack.js";
import { assemblePreschoolSectionPacksV2 } from "./preschool-section-pack-v2.js";

describe("assemblePreschoolSectionPacks", () => {
  it("keeps the legacy v1 Pack seam compatible for the current Interpreter", () => {
    const packs = assemblePreschoolSectionPacks({ identity: identity(), snapshot: snapshot() });

    expect(packs).toHaveLength(4);
    expect(packs.every((pack) => (
      pack.decisionQuestion.length > 0
      && pack.pageCoverage.length === pack.evidence.length
      && pack.allowedNextChecks.length > 0
      && !Object.hasOwn(pack, "analysisGoal")
      && !Object.hasOwn(pack, "capabilities")
    ))).toBe(true);
    expect(packs.find(({ sectionId }) => sectionId === "centre-benchmark")!.evidence).toHaveLength(4);
    expect(packs.find(({ sectionId }) => sectionId === "planning-outlook")!.evidence[0]!.value).toMatchObject({
      planDataSnapshotId: "snapshot-plan",
      actualDataSnapshotId: "snapshot-current",
      forecast: { portfolio: { estimatedKwh: 1100 } },
    });
  });

  it("exposes a neutral Pack v2 discovery contract without prescriptive next checks", () => {
    const packs = assemblePreschoolSectionPacksV2({ identity: identity(), snapshot: snapshot() });

    expect(packs).toHaveLength(4);
    expect(packs.every((pack) => (
      pack.contract.id === "preschool-section-pack"
      && pack.contract.revision === "preschool-section-pack-v2"
      && pack.analysisGoal.length > 0
      && pack.capabilities.revision === "scoped-read-only-v1"
      && pack.capabilities.mode === "scoped-read-only"
      && pack.capabilities.tools.includes("inspect_related_section_signals")
    ))).toBe(true);
    expect(packs.every((pack) => pack.alreadyPresentedFacts.every((fact) => (
      fact.id.length > 0
      && fact.label.length > 0
      && fact.evidenceRefs.length > 0
    )))).toBe(true);
    expect(packs.every((pack) => Array.isArray(pack.crossSectionIndex))).toBe(true);
    expect(packs.every((pack) => pack.dataQuality.coveragePct === 100)).toBe(true);
    expect(packs.every((pack) => !Object.hasOwn(pack, "decisionQuestion"))).toBe(true);
    expect(packs.every((pack) => !Object.hasOwn(pack, "allowedNextChecks"))).toBe(true);
    expect(packs.every((pack) => !Object.hasOwn(pack, "pageCoverage"))).toBe(true);
  });

  it("uses the pinned Snapshot projections for four bounded Section Packs", () => {
    const packs = assemblePreschoolSectionPacks({ identity: identity(), snapshot: snapshot() });

    expect(packs.map(({ sectionId }) => sectionId)).toEqual([
      "centre-benchmark",
      "standby-wastage",
      "operating-behaviour",
      "planning-outlook",
    ]);
    expect(packs.every(({ binding }) => binding.dataSnapshotId === "snapshot-current")).toBe(true);
    expect(packs.find(({ sectionId }) => sectionId === "centre-benchmark")).toMatchObject({
      evidence: expect.arrayContaining([
        expect.objectContaining({
          id: "preschool:snapshot-current:section-2-benchmark:portfolio",
          unit: "kWh/m2/year, kWh/person/month",
        }),
        expect.objectContaining({
          id: "preschool:snapshot-current:section-2-benchmark:centre:a28",
          entityRefs: ["centre-a28"],
          unit: "kWh, kWh/m2/year, kWh/person/month",
        }),
      ]),
    });
    expect(packs.find(({ sectionId }) => sectionId === "operating-behaviour")).toMatchObject({
      evidence: expect.arrayContaining([
        expect.objectContaining({
          value: expect.objectContaining({
            operatingHoursKwh: 800,
            operatingHoursSharePct: 80,
          }),
        }),
        expect.objectContaining({
          id: "preschool:snapshot-current:section-4-operating:centre:n",
          claimRelations: [{ subject: "Centre N", predicate: "leading-circuit", object: "Kitchen Plug Load" }],
        }),
        expect.objectContaining({
          id: "preschool:snapshot-current:section-4-operating:centre:l",
          claimRelations: [{ subject: "Centre L", predicate: "leading-circuit", object: "Heater" }],
        }),
      ]),
    });
    expect(packs.find(({ sectionId }) => sectionId === "standby-wastage")!.evidence[0]!.value).toEqual({
      closedHoursKwh: 200,
      closedHoursSharePct: 20,
      provisionalClosedHoursCostBeforeGstSgd: 60,
      spikeCount: 3,
      centreCount: 1,
    });
    expect(packs.find(({ sectionId }) => sectionId === "planning-outlook")).toMatchObject({
      limitations: expect.arrayContaining(["The estimate uses a simple weekly baseline."]),
      evidence: [{
        value: {
          planDataSnapshotId: "snapshot-plan",
          actualDataSnapshotId: "snapshot-current",
        },
      }],
    });
    expect(JSON.stringify(packs)).not.toContain("schema");
  });

  it("gives Section 2 the complete 30-Centre peer matrix with ranks, metadata quality and cross-Section flags", () => {
    const pack = assemblePreschoolSectionPacksV2({ identity: identity(), snapshot: snapshot() })
      .find(({ sectionId }) => sectionId === "centre-benchmark")!;
    const centreRows = pack.evidence.filter(({ id }) => id.includes(":centre:"));

    expect(centreRows).toHaveLength(30);
    expect(centreRows.map(({ value }) => (value as { centreCode: string }).centreCode)).toEqual(
      Array.from({ length: 30 }, (_, index) => `A${index + 1}`),
    );
    expect(centreRows.at(-1)).toMatchObject({
      id: "preschool:snapshot-current:section-2-benchmark:centre:a30",
      value: {
        centreCode: "A30",
        metrics: {
          absoluteUsage: {
            value: 400,
            unit: "kWh",
            rank: { position: 1, outOf: 30 },
            percentileRankPct: 100,
          },
          floorAreaNormalised: {
            value: 120,
            unit: "kWh/m2/year",
            rank: { position: 1, outOf: 30 },
            percentileRankPct: 100,
          },
          peopleNormalised: {
            value: 40,
            unit: "kWh/person/month",
            rank: { position: 1, outOf: 30 },
            percentileRankPct: 100,
          },
        },
        metadataQuality: {
          status: "provisional",
          floorArea: "available",
          representativeHeadcount: "available",
        },
        crossSectionFlags: [{
          signalId: "operating",
          relatedSectionId: "operating-behaviour",
          kind: "operating-hour-spikes",
          label: "Unusual peaks during opening hours",
        }],
      },
    });
    expect(pack.crossSectionIndex).toContainEqual(expect.objectContaining({
      signalId: "operating",
      relatedSectionId: "operating-behaviour",
      entityRefs: ["centre-a30"],
    }));
    expect(JSON.stringify(pack)).not.toContain("Centre G");
    expect(JSON.stringify(pack)).not.toContain("Centre J");
    expect(JSON.stringify(pack)).not.toContain("Centre M");
  });

  it("gives Section 5 the complete plan identity and Portfolio/Centre forecast series with explicit basis boundaries", () => {
    const pack = assemblePreschoolSectionPacksV2({ identity: identity(), snapshot: snapshot() })
      .find(({ sectionId }) => sectionId === "planning-outlook")!;
    const lifecycle = pack.evidence[0]!.value;

    expect(lifecycle).toMatchObject({
      planIdentity: {
        lifecycleContract: { id: "preschool-saved-plan-current-actual", version: "2" },
        planningContract: {
          id: "preschool-monthly-naive-weekly-baseline",
          version: "2",
          method: "mean of four complete Monday-Sunday weeks",
        },
        savedAnalysisId: "saved-plan",
        dataSnapshotId: "snapshot-plan",
        projectReleaseId: "release-current",
        templateRevisionId: "template-current",
        queryId: "daily_totals_v1",
        recipeId: "preschool-naive-weekly-planning-baseline-v1",
      },
      actual: {
        status: "partial",
        usageKwh: 400,
        completeDayCount: 10,
        targetDayCount: 30,
        provenance: {
          dataSnapshotId: "snapshot-current",
          projectReleaseId: "release-current",
          queryId: "daily_totals_v1",
        },
      },
      planBasis: {
        sourceWeeks: [{ start: "2026-05-04", endInclusive: "2026-05-10", usageKwh: 256.67 }],
        weeklyBaseline: { averageKwh: 256.67, minimumKwh: 250, maximumKwh: 260 },
        limitations: ["The estimate uses a simple weekly baseline."],
      },
      forecast: {
        status: "partial",
        contract: {
          id: "preschool-monthly-energy-outlook",
          version: "2",
          method: "same-weekday mean from four complete May weeks, scaled to the Saved Plan total",
        },
        tariffBoundary: {
          status: "effective",
          beforeGstSgdPerKwh: 0.3,
          beforeGst: true,
          notBill: true,
        },
        scopes: [
          expect.objectContaining({
            scopeId: "preschool-project",
            scopeRole: "portfolio",
            actualCompleteDayCount: 10,
            actualTargetDayCount: 30,
            currentOutlookVsPlan: {
              status: "available",
              varianceKwh: 100,
              variancePct: 9.09,
            },
            buckets: {
              daily: [expect.objectContaining({ start: "2026-06-01", estimatedKwh: 36.67 })],
              weekly: [expect.objectContaining({ start: "2026-06-01", estimatedKwh: 256.67 })],
              monthly: [expect.objectContaining({ start: "2026-06-01", estimatedKwh: 1100 })],
            },
          }),
          expect.objectContaining({ scopeId: "centre-a1", scopeRole: "centre" }),
          expect.objectContaining({ scopeId: "centre-a2", scopeRole: "centre" }),
        ],
      },
    });
    expect((lifecycle as { forecast: { scopes: unknown[] } }).forecast.scopes).toHaveLength(3);
    expect(pack.evidence[0]!.entityRefs).toEqual(["preschool-project", "centre-a1", "centre-a2"]);
  });

  it("separates structured page facts from rich Evidence and names missing Pack inputs explicitly", () => {
    const incompletePeerSnapshot = snapshot();
    incompletePeerSnapshot.preschoolBenchmark!.centres = incompletePeerSnapshot.preschoolBenchmark!.centres.slice(0, 29);
    const section2 = assemblePreschoolSectionPacksV2({
      identity: identity(),
      snapshot: incompletePeerSnapshot,
    }).find(({ sectionId }) => sectionId === "centre-benchmark")!;

    expect(section2.alreadyPresentedFacts.map(({ id }) => id)).toEqual([
      "page:centre-benchmark:portfolio-reference",
      "page:centre-benchmark:priority-centres",
    ]);
    expect(section2.alreadyPresentedFacts).toHaveLength(2);
    expect(section2.evidence.length).toBeGreaterThan(section2.alreadyPresentedFacts.length);
    expect(section2.limitations).toContain(
      "Floor area and representative headcount metadata are provisional.",
    );
    expect(section2.missingEvidence).toContain(
      "Peer matrix contains 29 of the declared 30 Centres.",
    );

    const noForecastSnapshot = snapshot();
    const planningLifecycle = noForecastSnapshot.preschoolPlanningLifecycle;
    if (!planningLifecycle || planningLifecycle.status !== "available") {
      throw new Error("Expected available planning lifecycle fixture");
    }
    delete planningLifecycle.forecast;
    const section5 = assemblePreschoolSectionPacksV2({
      identity: identity(),
      snapshot: noForecastSnapshot,
    }).find(({ sectionId }) => sectionId === "planning-outlook")!;

    expect(section5.alreadyPresentedFacts.map(({ id }) => id)).toEqual([
      "page:planning-outlook:plan",
      "page:planning-outlook:actual",
    ]);
    expect(section5.missingEvidence).toContain(
      "Portfolio and Centre forecast Evidence is unavailable for this Snapshot.",
    );
  });

  it("rejects a stale Snapshot before building any Pack", () => {
    expect(() => assemblePreschoolSectionPacks({
      identity: identity(),
      snapshot: snapshot("snapshot-stale"),
    })).toThrow("PRESCHOOL_SECTION_PACK_IDENTITY_MISMATCH");
  });
});

const identity = () => createOverviewAiArtifactIdentity({
  workspaceId: "preschool-workspace",
  projectId: "preschool-demo",
  scopeId: "preschool-project",
  dataSnapshotId: "snapshot-current",
  projectReleaseId: "release-current",
  analysisPeriodFrom: "2026-05-01T00:00:00.000Z",
  analysisPeriodTo: "2026-06-01T00:00:00.000Z",
  rendererKey: "preschool-overview",
  rendererVersion: "1",
  modelProfileId: "workspace-default-model-profile",
  modelProfileRevision: 1,
});

const snapshot = (dataSnapshotId = "snapshot-current"): ProjectAnalysisSnapshot => ({
  context: {
    workspaceId: "preschool-workspace",
    projectId: "preschool-demo",
    scopeId: "preschool-project",
    primaryPeriod: {
      start: "2026-05-01T00:00:00.000Z",
      endExclusive: "2026-06-01T00:00:00.000Z",
    },
  },
  projectRelease: { id: "release-current" },
  dataSnapshot: { id: dataSnapshotId },
  dataQuality: {
    status: "complete",
    coveragePct: 100,
    expectedMeterIntervalCount: 1,
    validIntervalCount: 1,
    qualityEventCount: 0,
    cumulativeDeltaMismatchCount: 0,
    averageKwMismatchCount: 0,
    invalidIntervalDurationCount: 0,
    importBatchIds: ["batch-current"],
  },
  preschoolBenchmark: {
    status: "provisional",
    sampleSize: 30,
    portfolio: {
      eui: { p50: 80, p75: 100, unit: "kWh/m2/year" },
      perPax: { p50: 20, p75: 25, unit: "kWh/person/month" },
    },
    cohorts: [
      {
        name: "Childcare",
        sampleSize: 30,
        eui: { p50: 90, p75: 105, unit: "kWh/m2/year" },
        perPax: { p50: 25, p75: 33, unit: "kWh/person/month" },
      },
    ],
    centres: Array.from({ length: 30 }, (_, index) => {
      const ordinal = index + 1;
      return {
        scopeId: `centre-a${ordinal}`,
        centreCode: `A${ordinal}`,
        name: `Centre A${ordinal}`,
        cohort: "Childcare",
        usageKwh: 100 + (ordinal * 10),
        annualisedEuiKwhPerSqmYear: 60 + (ordinal * 2),
        mayKwhPerPerson: 10 + ordinal,
        quadrant: ordinal >= 28 ? "priority" : "lower-intensity",
        priority: ordinal >= 28,
      };
    }),
    priorityCentreCodes: ["A28", "A29", "A30"],
    evidence: {
      dataSnapshotId,
      projectReleaseId: "release-current",
      hierarchyRevisionId: "hierarchy-current",
      meterMappingRevisionId: "mapping-current",
      metricRevisionIds: ["energy.total_usage_kwh@1"],
      metadataRevisionIds: ["metadata-current"],
      metadataStatus: "provisional",
      sourceQueryIds: ["benchmark-query"],
      projectionRecipeIds: [
        "preschool-eui-benchmark-v1",
        "preschool-per-pax-benchmark-v1",
        "preschool-quadrant-v1",
      ],
      cohortSource: "published-hierarchy-node-metadata",
      normalisation: {
        eui: "May usage kWh * 12 / published comparison area m2",
        perPax: "May usage kWh / published representative headcount",
      },
    },
  },
  preschoolOperational: {
    status: "available",
    energy: {
      totalKwh: 1000,
      standbyKwh: 200,
      standbySharePct: 20,
      operatingKwh: 800,
      operatingSharePct: 80,
      provisionalStandbyCostBeforeGstSgd: 60,
      provisionalOperatingCostBeforeGstSgd: 240,
    },
    standbyAppliances: { appliances: [] },
    operatingAppliances: { appliances: [{ name: "Heater", applianceGroup: "Heating", usageKwh: 45, sharePct: 5.625, centreCount: 1 }] },
    spikes: {
      standby: { count: 3, centreCount: 1, centres: [] },
      operating: {
        count: 2,
        centreCount: 2,
        centres: [
          {
            scopeId: "centre-n",
            centreCode: "N",
            name: "Centre N",
            spikeCount: 1,
            worstSpike: { leadingCircuitName: "Kitchen Plug Load", usageKwh: 20 },
          },
          {
            scopeId: "centre-l",
            centreCode: "L",
            name: "Centre L",
            spikeCount: 1,
            worstSpike: { leadingCircuitName: "Heater", usageKwh: 15 },
          },
        ],
      },
    },
    sop: { breachingCentreCodes: ["A1"] },
    evidence: {
      dataSnapshotId,
      projectReleaseId: "release-current",
      sourceQueryIds: ["operational-query"],
    },
  },
  preschoolPlanningLifecycle: {
    status: "available",
    contract: { id: "preschool-saved-plan-current-actual", version: "2" },
    targetPeriod: { start: "2026-06-01", endExclusive: "2026-07-01", timezone: "Asia/Singapore", targetDayCount: 30 },
    plan: {
      contract: {
        id: "preschool-monthly-naive-weekly-baseline",
        version: "2",
        method: "mean of four complete Monday-Sunday weeks",
      },
      targetPeriod: {
        start: "2026-06-01",
        endInclusive: "2026-06-30",
        endExclusive: "2026-07-01",
        timezone: "Asia/Singapore",
        days: 30,
      },
      sourceWeeks: [{ start: "2026-05-04", endInclusive: "2026-05-10", usageKwh: 256.67 }],
      weeklyBaseline: { averageKwh: 256.67, minimumKwh: 250, maximumKwh: 260 },
      usageEstimate: { projectedKwh: 1100, lowerKwh: 1000, upperKwh: 1200 },
      costEstimate: {
        currency: "SGD",
        currentPeriodBeforeGstSgd: 300,
        projectedBeforeGstSgd: 330,
        lowerBeforeGstSgd: 300,
        upperBeforeGstSgd: 360,
      },
      tariffReference: {
        sourceName: "Published planning tariff",
        sourceUrl: "https://example.invalid/tariff",
        appendixUrl: "https://example.invalid/tariff-appendix",
        supplyClass: "Low tension, non-domestic",
        appliesFrom: "2026-04-01",
        appliesTo: "2026-06-30",
        beforeGstSgdPerKwh: 0.3,
        withGstSgdPerKwh: 0.327,
      },
      evidence: {
        dataSnapshotId: "snapshot-plan",
        queryId: "daily_totals_v1",
        recipeId: "preschool-naive-weekly-planning-baseline-v1",
      },
      limitations: ["The estimate uses a simple weekly baseline."],
    },
    actual: { status: "partial", usageKwh: 400, completeDayCount: 10, targetDayCount: 30, varianceKwh: 20, variancePct: 5 },
    forecast: {
      status: "partial",
      contract: {
        id: "preschool-monthly-energy-outlook",
        version: "2",
        method: "same-weekday mean from four complete May weeks, scaled to the Saved Plan total",
      },
      targetPeriod: { start: "2026-06-01", endExclusive: "2026-07-01", timezone: "Asia/Singapore", targetDayCount: 30 },
      tariffAssumption: {
        status: "effective",
        beforeGstSgdPerKwh: 0.3,
        sourceName: "Published planning tariff",
        sourceUrl: "https://example.invalid/tariff",
        supplyClass: "Low tension, non-domestic",
        appliesFrom: "2026-04-01",
        appliesTo: "2026-06-30",
        beforeGst: true,
        notBill: true,
      },
      scopes: [
        forecastScope({
          scopeId: "preschool-project",
          scopeName: "All centres",
          scopeType: "project",
          scopeRole: "portfolio",
          estimatedKwh: 1100,
          expectedFullMonthKwh: 1200,
          actualKwh: 400,
        }),
        forecastScope({
          scopeId: "centre-a1",
          scopeName: "Centre A1",
          scopeType: "centre",
          scopeRole: "centre",
          estimatedKwh: 600,
          expectedFullMonthKwh: 660,
          actualKwh: 220,
        }),
        forecastScope({
          scopeId: "centre-a2",
          scopeName: "Centre A2",
          scopeType: "centre",
          scopeRole: "centre",
          estimatedKwh: 500,
          expectedFullMonthKwh: 540,
          actualKwh: 180,
        }),
      ],
      evidence: {
        planDataSnapshotId: "snapshot-plan",
        actualDataSnapshotId: "snapshot-current",
        planQueryId: "daily_totals_v1",
        actualQueryId: "daily_totals_v1",
        recipeId: "preschool-weekday-mean-series-v1",
      },
    },
    planProvenance: {
      savedAnalysisId: "saved-plan",
      dataSnapshotId: "snapshot-plan",
      projectReleaseId: "release-current",
      templateRevisionId: "template-current",
      queryId: "daily_totals_v1",
      recipeId: "preschool-naive-weekly-planning-baseline-v1",
    },
    actualProvenance: {
      dataSnapshotId,
      projectReleaseId: "release-current",
      queryId: "daily_totals_v1",
      period: { start: "2026-06-01", endExclusive: "2026-06-11", timezone: "Asia/Singapore" },
    },
  },
  preschoolDecisionSignals: {
    contract: { id: "preschool-decision-signals", version: "1" },
    context: {
      projectReleaseId: "release-current",
      dataSnapshotId,
      period: {
        start: "2026-05-01T00:00:00.000Z",
        endExclusive: "2026-06-01T00:00:00.000Z",
        timezone: "Asia/Singapore",
      },
    },
    status: "available",
    items: [{
      id: "operating",
      kind: "operating-hour-spikes",
      sectionId: "operating-behaviour",
      priority: 1,
      severity: "attention",
      label: "Unusual peaks during opening hours",
      metrics: [{
        id: "operating-spike-centres",
        label: "Centres with unusual opening-hour peaks",
        metricId: "preschool.operating.centre_count",
        value: 1,
        unit: "count",
        role: "primary",
        precision: 0,
        dimensions: { operatingState: "open" },
      }],
      entities: [{
        kind: "centre",
        scopeId: "centre-a30",
        code: "A30",
        name: "Centre A30",
      }],
      evidenceRefs: ["operational-query"],
      limitations: [{
        code: "ACTIVITY_NOT_OBSERVED",
        label: "Meter data cannot distinguish planned activity, manual override and equipment faults.",
      }],
    }],
  },
} as unknown as ProjectAnalysisSnapshot);

const forecastScope = (input: {
  scopeId: string;
  scopeName: string;
  scopeType: string;
  scopeRole: "portfolio" | "centre";
  estimatedKwh: number;
  expectedFullMonthKwh: number;
  actualKwh: number;
}) => ({
  ...input,
  estimatedCostBeforeGstSgd: input.estimatedKwh * 0.3,
  expectedFullMonthCostBeforeGstSgd: input.expectedFullMonthKwh * 0.3,
  actualCostBeforeGstSgd: input.actualKwh * 0.3,
  actualCompleteDayCount: 10,
  actualTargetDayCount: 30,
  actualThroughLocalDate: "2026-06-10",
  pacePct: (input.expectedFullMonthKwh / input.estimatedKwh) * 100,
  outcome: "above_plan",
  originalEstimateIdentity: `estimate:${input.scopeId}`,
  actualIdentity: `actual:${input.scopeId}`,
  currentOutlookIdentity: `outlook:${input.scopeId}`,
  buckets: {
    daily: [forecastBucket("2026-06-01", "2026-06-02", input.estimatedKwh / 30)],
    weekly: [forecastBucket("2026-06-01", "2026-06-08", input.estimatedKwh * 7 / 30)],
    monthly: [forecastBucket("2026-06-01", "2026-07-01", input.estimatedKwh)],
  },
});

const forecastBucket = (start: string, endExclusive: string, estimatedKwh: number) => ({
  start,
  endExclusive,
  estimatedKwh: Math.round(estimatedKwh * 100) / 100,
  originalEstimateKwh: Math.round(estimatedKwh * 100) / 100,
  actualKwh: null,
  currentOutlookKwh: null,
  futureOutlookKwh: null,
  actualCompleteDayCount: 0,
  actualTargetDayCount: 1,
  actualStatus: "waiting",
});
