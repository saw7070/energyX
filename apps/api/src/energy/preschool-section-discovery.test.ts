import { describe, expect, it } from "vitest";

import type { PreschoolSectionPackV2 } from "./preschool-section-pack-v2.js";
import {
  MAX_PRESCHOOL_SECTION_MODEL_PROJECTION_CHARS,
  parsePreschoolSectionDiscoveryV4,
  projectPreschoolSectionPackV2ForModel,
} from "./preschool-section-discovery.js";

describe("Preschool Section discovery", () => {
  it("projects every peer in a rich Pack v2 without legacy steering fields or Top-N truncation", () => {
    const pack = richPack("centre-benchmark", 30);
    const projection = projectPreschoolSectionPackV2ForModel(pack);
    const serialized = JSON.stringify(projection);

    expect(projection.capabilityBoundary).toEqual({
      sourcePackRevision: "preschool-section-pack-v2",
      factAccess: "inline-complete",
      omittedEvidenceCount: 0,
      tools: ["compare_centres", "inspect_related_section_signals"],
    });
    expect(projection.evidence).toHaveLength(30);
    for (let index = 1; index <= 30; index += 1) {
      expect(serialized).toContain(`Centre ${index}`);
    }
    expect(serialized).not.toContain("decisionQuestion");
    expect(serialized).not.toContain("allowedNextChecks");
    expect(serialized).not.toContain("pageCoverage");
  });

  it("keeps a Portfolio plus 30-Centre planning outlook model-projectable without dropping management rows", () => {
    const pack = portfolioScalePlanningPack();
    const projection = projectPreschoolSectionPackV2ForModel(pack);
    const serialized = JSON.stringify(projection);
    const planningValue = projection.evidence[0]?.value as {
      forecast: {
        scopes: {
          encoding: { id: string; revision: string };
          scopeCount: number;
          bucketCounts: Record<string, number>;
          scopeTables: unknown[];
          bucketTables: unknown[];
        };
      };
    };

    expect(serialized.length).toBeLessThanOrEqual(MAX_PRESCHOOL_SECTION_MODEL_PROJECTION_CHARS);
    expect(planningValue.forecast.scopes).toMatchObject({
      encoding: { id: "energyiq-lossless-columnar-json", revision: "v1" },
      scopeCount: 31,
      bucketCounts: { daily: 930, weekly: 155, monthly: 31 },
      scopeTables: expect.any(Array),
      bucketTables: expect.any(Array),
    });
    expect(projection.capabilityBoundary).toMatchObject({
      factAccess: "inline-complete",
      omittedEvidenceCount: 0,
    });
    expect(projection.evidence[0]?.evidenceRefs).toEqual(["evidence:planning-outlook:portfolio-scale"]);
    const originalScopes = (pack.evidence[0]?.value as { forecast: { scopes: unknown[] } }).forecast.scopes;
    expect(decodePlanningScopes(planningValue.forecast.scopes)).toEqual(originalScopes);
    for (const scopeId of [
      "preschool-project",
      ...Array.from({ length: 30 }, (_, index) => `centre-${index + 1}`),
    ]) expect(serialized).toContain(JSON.stringify(scopeId));
  });

  it("assigns binding at runtime and preserves malformed candidates for local acceptance rejection", () => {
    const pack = richPack("standby-wastage", 1);
    const discovery = parsePreschoolSectionDiscoveryV4({
      answer: JSON.stringify({
        sectionId: "standby-wastage",
        status: "available",
        summary: { text: "One event is supported.", evidenceRefs: ["evidence:1"] },
        candidates: [{
          candidateId: "model-controlled",
          kind: "next-check",
          title: "Malformed candidate",
          epistemicStatus: "observed",
          text: "",
          evidenceRefs: [],
        }, {
          title: "A possible operating explanation",
          epistemicStatus: "speculative",
          text: "A manual override could be one explanation worth exploring.",
          evidenceRefs: ["evidence:1"],
        }],
      }),
      expectedSectionId: "standby-wastage",
      binding: pack.binding,
    });

    expect(discovery.binding).toEqual(pack.binding);
    expect(discovery.status).toBe("available");
    if (discovery.status !== "available") throw new Error("expected available discovery");
    expect(discovery.candidates).toHaveLength(2);
    expect(discovery.candidates[0]).toMatchObject({ title: "", text: "", evidenceRefs: [] });
    expect(discovery.candidates[0]).not.toHaveProperty("candidateId");
    expect(discovery.candidates[0]).not.toHaveProperty("kind");
    expect(discovery.candidates[1]).toMatchObject({
      title: "A possible operating explanation",
      epistemicStatus: "speculative",
    });
  });

  it("clarifies that operating summary counts describe flagged spikes rather than the whole estate", () => {
    const pack = richPack("operating-behaviour", 1);
    pack.evidence[0] = {
      id: "evidence:operating-summary",
      label: "Operating-hour energy summary",
      value: {
        operatingHoursKwh: 21_818,
        operatingHoursSharePct: 87.55,
        spikeCount: 28,
        centreCount: 14,
      },
      unit: "kWh, %",
      entityRefs: [],
      evidenceRefs: ["evidence:operating-summary"],
    };
    pack.alreadyPresentedFacts = [{
      id: "page:operating-summary",
      label: "Operating-hour energy summary",
      value: pack.evidence[0].value,
      unit: "kWh, %",
      evidenceRefs: ["evidence:operating-summary"],
    }];

    const projection = projectPreschoolSectionPackV2ForModel(pack);
    for (const projected of [projection.evidence[0]!, projection.alreadyPresentedFacts[0]!]) {
      expect(projected.value).toMatchObject({
        operatingHoursKwh: 21_818,
        flaggedSpikeCount: 28,
        centresWithFlaggedSpikes: 14,
      });
      expect(projected.value).not.toHaveProperty("spikeCount");
      expect(projected.value).not.toHaveProperty("centreCount");
    }
    expect(pack.evidence[0].value).toMatchObject({ spikeCount: 28, centreCount: 14 });
  });

  it("canonicalizes duplicate model Evidence references before acceptance", () => {
    const pack = richPack("standby-wastage", 1);
    const discovery = parsePreschoolSectionDiscoveryV4({
      answer: JSON.stringify({
        sectionId: "standby-wastage",
        status: "available",
        summary: {
          text: "One event is supported.",
          evidenceRefs: ["evidence:1", "evidence:1"],
        },
        candidates: [{
          title: "One supported event",
          epistemicStatus: "observed",
          text: "One event is supported.",
          evidenceRefs: ["evidence:1", "evidence:1"],
        }],
      }),
      expectedSectionId: "standby-wastage",
      binding: pack.binding,
    });

    expect(discovery.status).toBe("available");
    if (discovery.status !== "available") throw new Error("expected available discovery");
    expect(discovery.summary.evidenceRefs).toEqual(["evidence:1"]);
    expect(discovery.candidates[0]?.evidenceRefs).toEqual(["evidence:1"]);
  });

  it("treats only an exact empty Provider array as an honest empty Section", () => {
    const pack = richPack("planning-outlook", 1);
    const discovery = parsePreschoolSectionDiscoveryV4({
      answer: "[]",
      expectedSectionId: "planning-outlook",
      binding: pack.binding,
    });

    expect(discovery).toEqual({
      sectionId: "planning-outlook",
      binding: pack.binding,
      status: "empty",
      candidates: [],
    });
    for (const answer of ["[{}]", "No new finding.\n[]", "```json\n[]\n```"]) {
      expect(() => parsePreschoolSectionDiscoveryV4({
        answer,
        expectedSectionId: "planning-outlook",
        binding: pack.binding,
      })).toThrow();
    }
  });

  it("rejects an over-budget limitation instead of silently dropping it", () => {
    const pack = richPack("standby-wastage", 1);
    expect(() => parsePreschoolSectionDiscoveryV4({
      answer: JSON.stringify({
        sectionId: "standby-wastage",
        status: "available",
        summary: { text: "One event is supported.", evidenceRefs: ["evidence:1"] },
        candidates: [],
        limitation: "L".repeat(321),
      }),
      expectedSectionId: "standby-wastage",
      binding: pack.binding,
    })).toThrow("PRESCHOOL_SECTION_INTERPRETATION_SUMMARY_UNSUPPORTED");
  });
});

const richPack = (
  sectionId: PreschoolSectionPackV2["sectionId"],
  evidenceCount: number,
): PreschoolSectionPackV2 => ({
  contract: { id: "preschool-section-pack", revision: "preschool-section-pack-v2" },
  sectionId,
  audience: "non-technical energy manager",
  analysisGoal: "Find the most useful supported patterns and lines of inquiry.",
  binding: {
    workspaceId: "workspace-1",
    projectId: "preschool-demo",
    scopeId: "project",
    dataSnapshotId: "snapshot-1",
    projectReleaseId: "release-1",
    analysisPeriod: { from: "2026-05-01", to: "2026-05-31" },
    modelProfileId: "profile-1",
    modelProfileRevision: 1,
  },
  evidence: Array.from({ length: evidenceCount }, (_, index) => ({
    id: `evidence:${index + 1}`,
    label: `Centre ${index + 1}`,
    value: {
      centreCode: `Centre ${index + 1}`,
      absoluteUsage: { value: 100 + index, rank: { position: index + 1, outOf: evidenceCount } },
      floorAreaNormalised: { value: 10 + index / 10, percentileRankPct: 90 - index },
      peopleNormalised: { value: 20 + index / 10, percentileRankPct: 80 - index },
      metadataQuality: { status: "provisional" },
    },
    unit: "kWh, kWh/m2/year, kWh/person/month",
    entityRefs: [`centre-${index + 1}`],
    evidenceRefs: [`evidence:${index + 1}`],
  })),
  alreadyPresentedFacts: [{
    id: "page:summary",
    label: "Visible summary",
    value: { sampleSize: evidenceCount },
    evidenceRefs: ["evidence:1"],
  }],
  crossSectionIndex: [],
  dataQuality: completeDataQuality,
  limitations: [],
  missingEvidence: [],
  capabilities: {
    revision: "scoped-read-only-v1",
    mode: "scoped-read-only",
    tools: sectionId === "centre-benchmark"
      ? ["compare_centres", "inspect_related_section_signals"]
      : sectionId === "standby-wastage" || sectionId === "operating-behaviour"
        ? ["inspect_time_pattern", "inspect_load_composition", "inspect_related_section_signals"]
        : ["inspect_related_section_signals"],
  },
});

const completeDataQuality: PreschoolSectionPackV2["dataQuality"] = {
  status: "complete",
  coveragePct: 100,
  expectedMeterIntervalCount: 1,
  validIntervalCount: 1,
  qualityEventCount: 0,
  cumulativeDeltaMismatchCount: 0,
  averageKwMismatchCount: 0,
  invalidIntervalDurationCount: 0,
  importBatchIds: [],
};

const portfolioScalePlanningPack = (): PreschoolSectionPackV2 => {
  const pack = richPack("planning-outlook", 1);
  const scopes = Array.from({ length: 31 }, (_, index) => {
    const portfolio = index === 0;
    const scopeId = portfolio ? "preschool-project" : `centre-${index}`;
    const buckets = {
      daily: Array.from({ length: 30 }, (_, day) => planningBucket(index, day + 1, "day")),
      weekly: Array.from({ length: 5 }, (_, week) => planningBucket(index, week + 1, "week")),
      monthly: [planningBucket(index, 1, "month")],
    };
    return {
      scopeId,
      scopeName: portfolio ? "All centres" : `Centre ${index}`,
      scopeType: portfolio ? "project" : "centre",
      scopeRole: portfolio ? "portfolio" : "centre",
      estimatedKwh: 1_000 + index,
      estimatedCostBeforeGstSgd: 300 + index,
      expectedFullMonthKwh: 1_100 + index,
      expectedFullMonthCostBeforeGstSgd: 330 + index,
      actualKwh: 400 + index,
      actualCostBeforeGstSgd: 120 + index,
      actualCompleteDayCount: 10,
      actualTargetDayCount: 30,
      actualThroughLocalDate: "2026-06-10",
      pacePct: 110,
      outcome: "above_plan",
      originalEstimateIdentity: `estimate:${scopeId}`,
      actualIdentity: `actual:${scopeId}`,
      currentOutlookIdentity: `outlook:${scopeId}`,
      buckets,
      currentOutlookVsPlan: { status: "available", varianceKwh: 100, variancePct: 10 },
    };
  });
  pack.evidence[0] = {
    id: "evidence:planning-outlook:portfolio-scale",
    label: "Saved plan, current actual and monthly outlook",
    value: {
      targetPeriod: {
        start: "2026-06-01",
        endExclusive: "2026-07-01",
        timezone: "Asia/Singapore",
        targetDayCount: 30,
      },
      planIdentity: {
        lifecycleContract: { id: "preschool-saved-plan-current-actual", version: "2" },
        planningContract: {
          id: "preschool-monthly-naive-weekly-baseline",
          version: "2",
          method: "mean of four complete Monday-Sunday weeks",
        },
        savedAnalysisId: "saved-plan-may-2026",
        dataSnapshotId: "snapshot-plan",
        projectReleaseId: "release-1",
        templateRevisionId: "template-1",
        queryId: "daily_totals_v1",
        recipeId: "preschool-naive-weekly-planning-baseline-v1",
      },
      plan: {
        usageEstimate: { projectedKwh: 31_000, lowerKwh: 29_000, upperKwh: 33_000 },
        costEstimate: { projectedBeforeGstSgd: 9_300 },
      },
      planBasis: {
        targetPeriod: { start: "2026-06-01", endInclusive: "2026-06-30", days: 30 },
        sourceWeeks: Array.from({ length: 4 }, (_, index) => ({
          start: `2026-05-${String(4 + index * 7).padStart(2, "0")}`,
          endInclusive: `2026-05-${String(10 + index * 7).padStart(2, "0")}`,
          usageKwh: 7_123.456789012345 + index,
        })),
        weeklyBaseline: { averageKwh: 7_125.123456789012, minimumKwh: 7_100.123456789012, maximumKwh: 7_150.123456789012 },
        planningTariffReference: null,
        evidence: { dataSnapshotId: "snapshot-plan", queryId: "daily_totals_v1", recipeId: "preschool-naive-weekly-planning-baseline-v1" },
        limitations: ["The estimate uses a simple weekly baseline."],
      },
      limitations: ["The estimate uses a simple weekly baseline."],
      actual: {
        status: "partial",
        usageKwh: 12_000.123456789012,
        completeDayCount: 10,
        targetDayCount: 30,
        provenance: {
          dataSnapshotId: "snapshot-1",
          projectReleaseId: "release-1",
          queryId: "daily_totals_v1",
          period: { start: "2026-06-01", endExclusive: "2026-06-11", timezone: "Asia/Singapore" },
        },
      },
      forecast: {
        status: "partial",
        contract: { id: "preschool-monthly-energy-outlook", version: "2", method: "same-weekday mean from four complete May weeks, scaled to the Saved Plan total" },
        targetPeriod: { start: "2026-06-01", endExclusive: "2026-07-01", timezone: "Asia/Singapore", targetDayCount: 30 },
        tariffBoundary: { status: "unavailable", reason: "No published tariff covers the full target period." },
        evidence: {
          planDataSnapshotId: "snapshot-plan",
          actualDataSnapshotId: "snapshot-1",
          planQueryId: "daily_totals_v1",
          actualQueryId: "daily_totals_v1",
          recipeId: "preschool-weekday-mean-series-v1",
        },
        scopes,
      },
    },
    unit: "kWh, %, SGD before GST",
    entityRefs: scopes.map(({ scopeId }) => scopeId),
    evidenceRefs: ["evidence:planning-outlook:portfolio-scale"],
  };
  return pack;
};

const planningBucket = (
  scopeIndex: number,
  ordinal: number,
  grain: "day" | "week" | "month",
) => {
  const estimatedKwh = 100.1234567890123 + scopeIndex * 3.1234567890123 + ordinal / 7;
  const actualComplete = grain === "day" && ordinal <= 10;
  return {
    start: grain === "month"
      ? "2026-06-01"
      : `2026-06-${String(Math.min(ordinal, 30)).padStart(2, "0")}`,
    endExclusive: grain === "month"
      ? "2026-07-01"
      : `2026-06-${String(Math.min(ordinal + 1, 30)).padStart(2, "0")}`,
    estimatedKwh,
    originalEstimateKwh: estimatedKwh,
    actualKwh: actualComplete ? estimatedKwh * 1.123456789 : null,
    currentOutlookKwh: actualComplete ? estimatedKwh * 1.0617283945 : null,
    futureOutlookKwh: actualComplete ? 0 : null,
    actualCompleteDayCount: actualComplete ? 1 : 0,
    actualTargetDayCount: grain === "day" ? 1 : grain === "week" ? 7 : 30,
    actualStatus: actualComplete ? "complete" : "waiting",
  };
};

const decodePlanningScopes = (projection: {
  scopeCount: number;
  scopeTables: unknown[];
  bucketTables: unknown[];
}): unknown[] => {
  const scopes = Array.from({ length: projection.scopeCount }, () => ({ buckets: {} as Record<string, unknown[]> }));
  for (const value of projection.scopeTables) {
    const table = value as EncodedTable;
    for (const row of table.rows) {
      const [scopeIndex, ...cells] = row;
      Object.assign(scopes[Number(scopeIndex)]!, decodeTableRow(table, cells));
    }
  }
  for (const value of projection.bucketTables) {
    const table = value as EncodedTable & { grain: string };
    for (const row of table.rows) {
      const [scopeIndex, bucketIndex, ...cells] = row;
      const buckets = scopes[Number(scopeIndex)]!.buckets;
      const grainBuckets = buckets[table.grain] ?? [];
      grainBuckets[Number(bucketIndex)] = decodeTableRow(table, cells);
      buckets[table.grain] = grainBuckets;
    }
  }
  return scopes;
};

type EncodedTable = {
  columns: string[];
  constants?: Record<string, unknown>;
  rows: unknown[][];
};

const decodeTableRow = (table: EncodedTable, cells: unknown[]): Record<string, unknown> => {
  return {
    ...(table.constants ?? {}),
    ...Object.fromEntries(table.columns.map((column, index) => [column, cells[index]])),
  };
};
