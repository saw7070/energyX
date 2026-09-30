import type { EnergyIqOverviewAiArtifactIdentity } from "@datafoundry/metadata";

import type { ProjectAnalysisSnapshot } from "./project-analysis-resolver.js";
import type {
  PreschoolOverviewAiBinding,
  PreschoolSectionId,
  PreschoolSectionInsightToolNameV4,
  PreschoolSectionPackEvidence,
} from "./preschool-overview-ai-contracts.js";
import { assemblePreschoolSectionPacks } from "./preschool-section-pack.js";

export type PreschoolSectionPackPresentedFact = {
  id: string;
  label: string;
  value: unknown;
  unit?: string;
  evidenceRefs: string[];
};

export type PreschoolSectionPackCrossSectionSignal = {
  signalId: string;
  relatedSectionId: PreschoolSectionId;
  kind: string;
  label: string;
  priority: number;
  entityRefs: string[];
  evidenceRefs: string[];
  limitations: string[];
};

export type PreschoolSectionPackV2 = {
  contract: {
    id: "preschool-section-pack";
    revision: "preschool-section-pack-v2";
  };
  sectionId: PreschoolSectionId;
  audience: "non-technical energy manager";
  analysisGoal: string;
  binding: PreschoolOverviewAiBinding;
  evidence: PreschoolSectionPackEvidence[];
  alreadyPresentedFacts: PreschoolSectionPackPresentedFact[];
  crossSectionIndex: PreschoolSectionPackCrossSectionSignal[];
  dataQuality: ProjectAnalysisSnapshot["dataQuality"];
  limitations: string[];
  missingEvidence: string[];
  capabilities: {
    revision: "scoped-read-only-v1";
    mode: "scoped-read-only";
    tools: PreschoolSectionInsightToolNameV4[];
  };
};

const SECTION_INSIGHT_TOOLS: Record<PreschoolSectionId, PreschoolSectionInsightToolNameV4[]> = {
  "centre-benchmark": ["compare_centres", "inspect_related_section_signals"],
  "standby-wastage": ["inspect_time_pattern", "inspect_load_composition", "inspect_related_section_signals"],
  "operating-behaviour": ["inspect_time_pattern", "inspect_load_composition", "inspect_related_section_signals"],
  "planning-outlook": ["inspect_related_section_signals"],
};

const ANALYSIS_GOALS: Record<PreschoolSectionId, string> = {
  "centre-benchmark": "Identify decision-relevant peer patterns, differences and cross-section relationships in Centre energy performance.",
  "standby-wastage": "Identify decision-relevant closed-hour patterns, concentration, recurrence and evidence-supported lines of inquiry.",
  "operating-behaviour": "Identify decision-relevant operating-hour patterns, shared signals, counterexamples and evidence-supported interpretations.",
  "planning-outlook": "Identify decision-relevant differences among the saved plan, current actuals and current monthly outlook, including uncertainty and basis boundaries.",
};

export const assemblePreschoolSectionPacksV2 = (input: {
  identity: EnergyIqOverviewAiArtifactIdentity;
  snapshot: ProjectAnalysisSnapshot;
}): PreschoolSectionPackV2[] => {
  // The legacy assembler remains the canonical identity guard until the v2 runtime is integrated.
  const legacyPacks = assemblePreschoolSectionPacks(input);
  const crossSectionIndex = crossSectionSignals(input.snapshot);
  return legacyPacks.map((legacyPack) => {
    const evidence = legacyPack.sectionId === "centre-benchmark"
      ? benchmarkEvidence(input.snapshot, crossSectionIndex)
      : legacyPack.sectionId === "planning-outlook"
        ? planningEvidence(input.snapshot)
        : legacyPack.evidence;
    return {
      contract: {
        id: "preschool-section-pack",
        revision: "preschool-section-pack-v2",
      },
      sectionId: legacyPack.sectionId,
      audience: legacyPack.audience,
      analysisGoal: ANALYSIS_GOALS[legacyPack.sectionId],
      binding: legacyPack.binding,
      evidence,
      alreadyPresentedFacts: presentedFacts(legacyPack.sectionId, input.snapshot, evidence),
      crossSectionIndex,
      dataQuality: { ...input.snapshot.dataQuality },
      limitations: sectionLimitations(legacyPack.sectionId, input.snapshot, evidence, crossSectionIndex),
      missingEvidence: sectionMissingEvidence(legacyPack.sectionId, input.snapshot, evidence),
      capabilities: {
        revision: "scoped-read-only-v1",
        mode: "scoped-read-only",
        tools: [...SECTION_INSIGHT_TOOLS[legacyPack.sectionId]],
      },
    };
  });
};

const benchmarkEvidence = (
  snapshot: ProjectAnalysisSnapshot,
  crossSectionIndex: PreschoolSectionPackCrossSectionSignal[],
): PreschoolSectionPackEvidence[] => {
  const benchmark = snapshot.preschoolBenchmark;
  if (!benchmark
    || benchmark.status !== "provisional"
    || benchmark.evidence.dataSnapshotId !== snapshot.dataSnapshot.id
    || benchmark.evidence.projectReleaseId !== snapshot.projectRelease.id) return [];
  const baseId = `preschool:${snapshot.dataSnapshot.id}:section-2-benchmark`;
  const sourceRefs = benchmark.evidence.sourceQueryIds.map((queryId) => `query:${queryId}`);
  const portfolioId = `${baseId}:portfolio`;
  const absoluteValues = benchmark.centres.map(({ usageKwh }) => usageKwh);
  const areaNormalisedValues = benchmark.centres.map(({ annualisedEuiKwhPerSqmYear }) => annualisedEuiKwhPerSqmYear);
  const peopleNormalisedValues = benchmark.centres.map(({ mayKwhPerPerson }) => mayKwhPerPerson);
  return [{
    id: portfolioId,
    label: "Portfolio benchmark",
    value: {
      sampleSize: benchmark.sampleSize,
      portfolio: benchmark.portfolio,
      cohorts: benchmark.cohorts,
      metadataQuality: {
        status: benchmark.evidence.metadataStatus,
        cohortSource: benchmark.evidence.cohortSource,
        metadataRevisionIds: benchmark.evidence.metadataRevisionIds,
        normalisation: benchmark.evidence.normalisation,
      },
    },
    unit: "kWh/m2/year, kWh/person/month",
    entityRefs: [],
    evidenceRefs: [portfolioId, ...sourceRefs],
  }, ...benchmark.centres.map(({
    scopeId,
    centreCode,
    name,
    cohort,
    usageKwh,
    annualisedEuiKwhPerSqmYear,
    mayKwhPerPerson,
    quadrant,
    priority,
  }) => {
    const id = `${baseId}:centre:${evidenceIdSegment(centreCode)}`;
    return {
      id,
      label: `${name} benchmark`,
      value: {
        centreCode,
        name,
        cohort,
        quadrant,
        priority,
        metrics: {
          absoluteUsage: rankedMetric(usageKwh, absoluteValues, "kWh"),
          floorAreaNormalised: rankedMetric(
            annualisedEuiKwhPerSqmYear,
            areaNormalisedValues,
            "kWh/m2/year",
          ),
          peopleNormalised: rankedMetric(
            mayKwhPerPerson,
            peopleNormalisedValues,
            "kWh/person/month",
          ),
        },
        metadataQuality: {
          status: benchmark.evidence.metadataStatus,
          floorArea: "available",
          representativeHeadcount: "available",
        },
        crossSectionFlags: crossSectionIndex
          .filter((signal) => signal.relatedSectionId !== "centre-benchmark"
            && signal.entityRefs.includes(scopeId))
          .map((signal) => ({
            signalId: signal.signalId,
            relatedSectionId: signal.relatedSectionId,
            kind: signal.kind,
            label: signal.label,
            evidenceRefs: signal.evidenceRefs,
          })),
      },
      unit: "kWh, kWh/m2/year, kWh/person/month",
      entityRefs: [scopeId],
      evidenceRefs: [id, ...sourceRefs],
    };
  })];
};

const planningEvidence = (snapshot: ProjectAnalysisSnapshot): PreschoolSectionPackEvidence[] => {
  const planning = snapshot.preschoolPlanningLifecycle;
  if (!planning
    || planning.status !== "available"
    || planning.actualProvenance.dataSnapshotId !== snapshot.dataSnapshot.id
    || planning.actualProvenance.projectReleaseId !== snapshot.projectRelease.id) return [];
  const forecastScopes = planning.forecast?.scopes ?? [];
  const id = `preschool:${snapshot.dataSnapshot.id}:section-5-planning-outlook`;
  return [{
    id,
    label: "Saved plan, current actual and monthly outlook",
    value: {
      targetPeriod: planning.targetPeriod,
      planIdentity: {
        lifecycleContract: planning.contract,
        planningContract: planning.plan.contract,
        ...planning.planProvenance,
      },
      plan: {
        usageEstimate: planning.plan.usageEstimate,
        costEstimate: planning.plan.costEstimate,
      },
      planBasis: {
        targetPeriod: planning.plan.targetPeriod,
        sourceWeeks: planning.plan.sourceWeeks,
        weeklyBaseline: planning.plan.weeklyBaseline,
        planningTariffReference: planning.plan.tariffReference ?? null,
        evidence: planning.plan.evidence,
        limitations: planning.plan.limitations,
      },
      limitations: planning.plan.limitations,
      actual: {
        ...planning.actual,
        provenance: planning.actualProvenance,
      },
      forecast: planning.forecast ? {
        status: planning.forecast.status,
        contract: planning.forecast.contract,
        targetPeriod: planning.forecast.targetPeriod,
        tariffBoundary: planning.forecast.tariffAssumption,
        evidence: planning.forecast.evidence,
        scopes: forecastScopes.map((scope) => ({
          ...scope,
          currentOutlookVsPlan: currentOutlookVsPlan(scope.estimatedKwh, scope.expectedFullMonthKwh),
        })),
      } : null,
    },
    unit: "kWh, %, SGD before GST",
    entityRefs: forecastScopes.map(({ scopeId }) => scopeId),
    evidenceRefs: uniqueStrings([
      id,
      `query:${planning.planProvenance.queryId}`,
      `query:${planning.actualProvenance.queryId}`,
      ...(planning.forecast ? [
        `query:${planning.forecast.evidence.planQueryId}`,
        `query:${planning.forecast.evidence.actualQueryId}`,
        `recipe:${planning.forecast.evidence.recipeId}`,
      ] : []),
    ]),
  }];
};

const presentedFacts = (
  sectionId: PreschoolSectionId,
  snapshot: ProjectAnalysisSnapshot,
  evidence: PreschoolSectionPackEvidence[],
): PreschoolSectionPackPresentedFact[] => {
  if (sectionId === "centre-benchmark") {
    const benchmark = snapshot.preschoolBenchmark;
    if (!benchmark || benchmark.status !== "provisional" || evidence.length === 0) return [];
    const portfolioEvidenceId = evidence[0]!.id;
    const centreEvidenceIds = new Map(evidence.slice(1).map((item) => {
      const value = isRecord(item.value) ? item.value : {};
      return [value.centreCode, item.id];
    }));
    return [{
      id: "page:centre-benchmark:portfolio-reference",
      label: "Portfolio comparison reference",
      value: {
        sampleSize: benchmark.sampleSize,
        portfolio: benchmark.portfolio,
      },
      unit: "kWh/m2/year, kWh/person/month",
      evidenceRefs: [portfolioEvidenceId],
    }, {
      id: "page:centre-benchmark:priority-centres",
      label: "Priority Centres",
      value: { centreCodes: benchmark.priorityCentreCodes },
      evidenceRefs: uniqueStrings([
        portfolioEvidenceId,
        ...benchmark.priorityCentreCodes.flatMap((centreCode) => {
          const evidenceId = centreEvidenceIds.get(centreCode);
          return typeof evidenceId === "string" ? [evidenceId] : [];
        }),
      ]),
    }];
  }
  if (sectionId === "planning-outlook") {
    const planning = snapshot.preschoolPlanningLifecycle;
    if (!planning || planning.status !== "available" || evidence.length === 0) return [];
    const evidenceRef = evidence[0]!.id;
    const facts: PreschoolSectionPackPresentedFact[] = [{
      id: "page:planning-outlook:plan",
      label: "Saved plan",
      value: {
        targetPeriod: planning.targetPeriod,
        usageEstimate: planning.plan.usageEstimate,
        costEstimate: planning.plan.costEstimate,
      },
      unit: "kWh, SGD before GST",
      evidenceRefs: [evidenceRef],
    }, {
      id: "page:planning-outlook:actual",
      label: "Current actual",
      value: planning.actual,
      unit: "kWh, %",
      evidenceRefs: [evidenceRef],
    }];
    const portfolio = planning.forecast?.scopes.find(({ scopeRole }) => scopeRole === "portfolio");
    if (portfolio) facts.push({
      id: "page:planning-outlook:portfolio-forecast",
      label: "Current Portfolio outlook",
      value: {
        expectedFullMonthKwh: portfolio.expectedFullMonthKwh,
        expectedFullMonthCostBeforeGstSgd: portfolio.expectedFullMonthCostBeforeGstSgd,
        pacePct: portfolio.pacePct,
        outcome: portfolio.outcome,
      },
      unit: "kWh, %, SGD before GST",
      evidenceRefs: [evidenceRef],
    });
    return facts;
  }
  const summary = evidence.find(({ id }) => id.endsWith(":summary"));
  return summary ? [{
    id: `page:${sectionId}:summary`,
    label: summary.label,
    value: summary.value,
    ...(summary.unit ? { unit: summary.unit } : {}),
    evidenceRefs: [summary.id],
  }] : [];
};

const sectionLimitations = (
  sectionId: PreschoolSectionId,
  snapshot: ProjectAnalysisSnapshot,
  evidence: PreschoolSectionPackEvidence[],
  crossSectionIndex: PreschoolSectionPackCrossSectionSignal[],
): string[] => {
  const limitations = evidence.flatMap(evidenceLimitations);
  if (sectionId === "centre-benchmark"
    && snapshot.preschoolBenchmark?.status === "provisional"
    && snapshot.preschoolBenchmark.evidence.metadataStatus === "provisional") {
    limitations.push("Floor area and representative headcount metadata are provisional.");
    limitations.push(...crossSectionIndex
      .filter(({ relatedSectionId }) => relatedSectionId !== "centre-benchmark")
      .flatMap(({ limitations: signalLimitations }) => signalLimitations));
  }
  if (sectionId === "planning-outlook") {
    const tariff = snapshot.preschoolPlanningLifecycle?.status === "available"
      ? snapshot.preschoolPlanningLifecycle.forecast?.tariffAssumption
      : undefined;
    if (tariff && tariff.status !== "unavailable" && tariff.notBill) {
      limitations.push("Forecast cost uses a reference tariff and is not an actual bill.");
    }
  }
  return uniqueStrings(limitations);
};

const sectionMissingEvidence = (
  sectionId: PreschoolSectionId,
  snapshot: ProjectAnalysisSnapshot,
  evidence: PreschoolSectionPackEvidence[],
): string[] => {
  const missing = evidence.length > 0
    ? []
    : [`Verified ${sectionId} Evidence is unavailable for this Snapshot.`];
  if (sectionId === "centre-benchmark") {
    const benchmark = snapshot.preschoolBenchmark;
    if (benchmark?.status === "provisional" && benchmark.centres.length !== benchmark.sampleSize) {
      missing.push(`Peer matrix contains ${benchmark.centres.length} of the declared ${benchmark.sampleSize} Centres.`);
    }
  }
  if (sectionId === "planning-outlook") {
    const planning = snapshot.preschoolPlanningLifecycle;
    if (planning?.status === "available" && !planning.forecast) {
      missing.push("Portfolio and Centre forecast Evidence is unavailable for this Snapshot.");
    } else if (planning?.status === "available" && planning.forecast) {
      if (!planning.forecast.scopes.some(({ scopeRole }) => scopeRole === "portfolio")) {
        missing.push("Portfolio forecast Evidence is unavailable for this Snapshot.");
      }
      if (!planning.forecast.scopes.some(({ scopeRole }) => scopeRole === "centre")) {
        missing.push("Centre forecast Evidence is unavailable for this Snapshot.");
      }
    }
  }
  const signals = snapshot.preschoolDecisionSignals;
  if (!signals
    || signals.context.dataSnapshotId !== snapshot.dataSnapshot.id
    || signals.context.projectReleaseId !== snapshot.projectRelease.id) {
    missing.push("Cross-section signal index is unavailable for this Snapshot.");
  } else if (signals.status === "withheld") {
    missing.push(signals.reason?.message ?? "Cross-section signal index is withheld for this Snapshot.");
  }
  return uniqueStrings(missing);
};

const crossSectionSignals = (
  snapshot: ProjectAnalysisSnapshot,
): PreschoolSectionPackCrossSectionSignal[] => {
  const signals = snapshot.preschoolDecisionSignals;
  if (!signals
    || signals.status !== "available"
    || signals.context.dataSnapshotId !== snapshot.dataSnapshot.id
    || signals.context.projectReleaseId !== snapshot.projectRelease.id) return [];
  return signals.items.map((signal) => ({
    signalId: signal.id,
    relatedSectionId: signal.id === "after-hours"
      ? "standby-wastage"
      : signal.id === "efficiency"
        ? "centre-benchmark"
        : "operating-behaviour",
    kind: signal.kind,
    label: signal.label,
    priority: signal.priority,
    entityRefs: signal.entities.map(({ scopeId }) => scopeId),
    evidenceRefs: [...signal.evidenceRefs],
    limitations: signal.limitations.map(({ label }) => label),
  }));
};

const rankedMetric = (
  value: number,
  peerValues: number[],
  unit: "kWh" | "kWh/m2/year" | "kWh/person/month",
) => {
  const position = 1 + peerValues.filter((peerValue) => peerValue > value).length;
  return {
    value,
    unit,
    rank: { position, outOf: peerValues.length },
    percentileRankPct: peerValues.length > 1
      ? roundTo(((peerValues.length - position) / (peerValues.length - 1)) * 100, 2)
      : null,
  };
};

const currentOutlookVsPlan = (
  estimatedKwh: number,
  expectedFullMonthKwh: number | null,
) => {
  if (expectedFullMonthKwh === null) {
    return {
      status: "unavailable" as const,
      reason: "Current full-month outlook is unavailable for this scope.",
    };
  }
  const varianceKwh = roundTo(expectedFullMonthKwh - estimatedKwh, 2);
  return {
    status: "available" as const,
    varianceKwh,
    variancePct: estimatedKwh === 0
      ? null
      : roundTo((varianceKwh / estimatedKwh) * 100, 2),
  };
};

const evidenceLimitations = (item: PreschoolSectionPackEvidence): string[] => {
  if (!isRecord(item.value)) return [];
  const limitations = item.value.limitations;
  return Array.isArray(limitations)
    ? limitations.filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    : [];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const evidenceIdSegment = (value: string): string => value
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/gu, "-")
  .replace(/^-|-$/gu, "") || "unknown";

const uniqueStrings = (values: string[]): string[] => [...new Set(values)];

const roundTo = (value: number, decimalPlaces: number): number => {
  const factor = 10 ** decimalPlaces;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};
