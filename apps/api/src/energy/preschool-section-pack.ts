import type { EnergyIqOverviewAiArtifactIdentity } from "@datafoundry/metadata";

import type { ProjectAnalysisSnapshot } from "./project-analysis-resolver.js";
import {
  PRESCHOOL_SECTION_IDS,
  preschoolOverviewAiBindingFromIdentity,
  type PreschoolSectionId,
  type PreschoolSectionPack,
  type PreschoolSectionPackEvidence,
} from "./preschool-overview-ai-contracts.js";

const DECISION_QUESTIONS: Record<PreschoolSectionId, string> = {
  "centre-benchmark": "Which Centres stand out after fair portfolio normalisation, and what should the manager review next?",
  "standby-wastage": "Where is energy still being used while Centres are closed, and what should be checked first?",
  "operating-behaviour": "What operating-hour energy pattern deserves attention without assuming an unverified cause?",
  "planning-outlook": "How is the current natural month tracking against the saved plan, and what should the manager monitor next?",
};

const NEXT_CHECKS: Record<PreschoolSectionId, string[]> = {
  "centre-benchmark": ["Review the named priority Centres against comparable peers before assigning a cause."],
  "standby-wastage": ["Confirm closing schedules and equipment state at the named Centres."],
  "operating-behaviour": ["Compare operating schedules and leading appliance groups at the named Centres."],
  "planning-outlook": ["Monitor the current month against the saved plan as complete days arrive."],
};

/**
 * @deprecated Legacy Pack v1 seam for the current Section Interpreter and Page Workflow.
 * New discovery work must call assemblePreschoolSectionPacksV2 from preschool-section-pack-v2.ts.
 */
export const assemblePreschoolSectionPacks = (input: {
  identity: EnergyIqOverviewAiArtifactIdentity;
  snapshot: ProjectAnalysisSnapshot;
}): PreschoolSectionPack[] => {
  requireSnapshotIdentity(input.identity, input.snapshot);
  const binding = preschoolOverviewAiBindingFromIdentity(input.identity);
  const evidenceBySection: Record<PreschoolSectionId, PreschoolSectionPackEvidence[]> = {
    "centre-benchmark": benchmarkEvidence(input.snapshot),
    "standby-wastage": operationalEvidence(input.snapshot, "standby"),
    "operating-behaviour": operationalEvidence(input.snapshot, "operating"),
    "planning-outlook": planningEvidence(input.snapshot),
  };
  return PRESCHOOL_SECTION_IDS.map((sectionId) => {
    const evidence = evidenceBySection[sectionId];
    return {
      sectionId,
      audience: "non-technical energy manager",
      decisionQuestion: DECISION_QUESTIONS[sectionId],
      binding,
      evidence,
      dataQuality: { status: input.snapshot.dataQuality.status },
      limitations: evidence.length > 0 ? evidence.flatMap(evidenceLimitations) : [],
      missingEvidence: evidence.length > 0 ? [] : [`Verified ${sectionId} Evidence is unavailable for this Snapshot.`],
      pageCoverage: evidence.map(({ label }) => label),
      allowedNextChecks: NEXT_CHECKS[sectionId],
    };
  });
};

const benchmarkEvidence = (snapshot: ProjectAnalysisSnapshot): PreschoolSectionPackEvidence[] => {
  const benchmark = snapshot.preschoolBenchmark;
  if (!benchmark
    || benchmark.status !== "provisional"
    || benchmark.evidence.dataSnapshotId !== snapshot.dataSnapshot.id
    || benchmark.evidence.projectReleaseId !== snapshot.projectRelease.id) return [];
  const baseId = `preschool:${snapshot.dataSnapshot.id}:section-2-benchmark`;
  const sourceRefs = benchmark.evidence.sourceQueryIds.map((queryId) => `query:${queryId}`);
  const portfolioId = `${baseId}:portfolio`;
  const priorityCentres = benchmark.centres.filter(({ priority }) => priority).slice(0, 8);
  return [{
    id: portfolioId,
    label: "Portfolio benchmark",
    value: {
      sampleSize: benchmark.sampleSize,
      portfolio: benchmark.portfolio,
      metadataStatus: benchmark.evidence.metadataStatus,
    },
    unit: "kWh/m2/year, kWh/person/month",
    entityRefs: [],
    evidenceRefs: [portfolioId, ...sourceRefs],
  }, ...priorityCentres.map(({
    scopeId,
    centreCode,
    name,
    cohort,
    usageKwh,
    annualisedEuiKwhPerSqmYear,
    mayKwhPerPerson,
    quadrant,
  }) => {
    const id = `${baseId}:centre:${evidenceIdSegment(centreCode)}`;
    return {
      id,
      label: `${name} benchmark`,
      value: {
        centreCode,
        name,
        cohort,
        usageKwh,
        annualisedEuiKwhPerSqmYear,
        mayKwhPerPerson,
        quadrant,
      },
      unit: "kWh, kWh/m2/year, kWh/person/month",
      entityRefs: [scopeId],
      evidenceRefs: [id, ...sourceRefs],
    };
  })];
};

const operationalEvidence = (
  snapshot: ProjectAnalysisSnapshot,
  state: "standby" | "operating",
): PreschoolSectionPackEvidence[] => {
  const operational = snapshot.preschoolOperational;
  if (!operational
    || operational.status !== "available"
    || operational.evidence.dataSnapshotId !== snapshot.dataSnapshot.id
    || operational.evidence.projectReleaseId !== snapshot.projectRelease.id) return [];
  const isStandby = state === "standby";
  const spikes = operational.spikes[state];
  const appliances = isStandby ? operational.standbyAppliances : operational.operatingAppliances;
  const baseId = `preschool:${snapshot.dataSnapshot.id}:section-${isStandby ? "3-standby" : "4-operating"}`;
  const sourceRefs = operational.evidence.sourceQueryIds.map((queryId) => `query:${queryId}`);
  const summaryId = `${baseId}:summary`;
  const centreLimit = isStandby ? 3 : 5;
  const centreEvidence: PreschoolSectionPackEvidence[] = spikes.centres.slice(0, centreLimit).map(({
    scopeId,
    centreCode,
    name,
    spikeCount,
    worstSpike,
  }) => {
    const id = `${baseId}:centre:${evidenceIdSegment(centreCode)}`;
    return {
      id,
      label: `${name} ${isStandby ? "closed-hour" : "operating-hour"} spike`,
      value: { centreCode, name, spikeCount, worstSpike },
      unit: "kWh, %",
      entityRefs: [scopeId],
      evidenceRefs: [id, ...sourceRefs],
      claimRelations: [{
        subject: name,
        predicate: "leading-circuit",
        object: worstSpike.leadingCircuitName,
      }],
    };
  });
  const applianceEvidence: PreschoolSectionPackEvidence[] = appliances.appliances.slice(0, 3).map(({
    name,
    applianceGroup,
    usageKwh,
    sharePct,
    centreCount,
  }, index) => {
    const id = `${baseId}:appliance:${index + 1}`;
    return {
      id,
      label: `${name} ${isStandby ? "closed-hour" : "operating-hour"} contribution`,
      value: { name, applianceGroup, usageKwh, sharePct, centreCount },
      unit: "kWh, %",
      entityRefs: [],
      evidenceRefs: [id, ...sourceRefs],
    };
  });
  const summary: PreschoolSectionPackEvidence = {
    id: summaryId,
    label: isStandby ? "Closed-hour energy summary" : "Operating-hour energy summary",
    value: isStandby ? {
      closedHoursKwh: operational.energy.standbyKwh,
      closedHoursSharePct: operational.energy.standbySharePct,
      provisionalClosedHoursCostBeforeGstSgd: operational.energy.provisionalStandbyCostBeforeGstSgd,
      spikeCount: spikes.count,
      centreCount: spikes.centreCount,
    } : {
      operatingHoursKwh: operational.energy.operatingKwh,
      operatingHoursSharePct: operational.energy.operatingSharePct,
      provisionalOperatingHoursCostBeforeGstSgd: operational.energy.provisionalOperatingCostBeforeGstSgd,
      spikeCount: spikes.count,
      centreCount: spikes.centreCount,
    },
    unit: "kWh, %, SGD before GST",
    entityRefs: [],
    evidenceRefs: [summaryId, ...sourceRefs],
  };
  const sopEvidence: PreschoolSectionPackEvidence[] = isStandby
    ? [{
        id: `${baseId}:sop`,
        label: "Closed-hour SOP review Centres",
        value: { breachingCentreCodes: operational.sop.breachingCentreCodes },
        entityRefs: [],
        evidenceRefs: [`${baseId}:sop`, ...sourceRefs],
      }]
    : [];
  return [summary, ...centreEvidence, ...applianceEvidence, ...sopEvidence];
};

const planningEvidence = (snapshot: ProjectAnalysisSnapshot): PreschoolSectionPackEvidence[] => {
  const planning = snapshot.preschoolPlanningLifecycle;
  if (!planning
    || planning.status !== "available"
    || planning.actualProvenance.dataSnapshotId !== snapshot.dataSnapshot.id
    || planning.actualProvenance.projectReleaseId !== snapshot.projectRelease.id) return [];
  const portfolioForecast = planning.forecast?.scopes.find(({ scopeRole }) => scopeRole === "portfolio");
  const id = `preschool:${snapshot.dataSnapshot.id}:section-5-planning-outlook`;
  return [{
    id,
    label: "Saved plan, current actual and monthly outlook",
    value: {
      targetPeriod: planning.targetPeriod,
      plan: {
        usageEstimate: planning.plan.usageEstimate,
        costEstimate: planning.plan.costEstimate,
      },
      limitations: planning.plan.limitations,
      actual: planning.actual,
      forecast: planning.forecast ? {
        status: planning.forecast.status,
        tariffAssumption: planning.forecast.tariffAssumption,
        portfolio: portfolioForecast ? {
          estimatedKwh: portfolioForecast.estimatedKwh,
          estimatedCostBeforeGstSgd: portfolioForecast.estimatedCostBeforeGstSgd,
          expectedFullMonthKwh: portfolioForecast.expectedFullMonthKwh,
          expectedFullMonthCostBeforeGstSgd: portfolioForecast.expectedFullMonthCostBeforeGstSgd,
          actualKwh: portfolioForecast.actualKwh,
          actualCostBeforeGstSgd: portfolioForecast.actualCostBeforeGstSgd,
          actualThroughLocalDate: portfolioForecast.actualThroughLocalDate,
          pacePct: portfolioForecast.pacePct,
          outcome: portfolioForecast.outcome,
        } : null,
      } : null,
      planDataSnapshotId: planning.planProvenance.dataSnapshotId,
      actualDataSnapshotId: planning.actualProvenance.dataSnapshotId,
    },
    unit: "kWh, %, SGD before GST",
    entityRefs: portfolioForecast ? [portfolioForecast.scopeId] : [],
    evidenceRefs: [
      id,
      `query:${planning.planProvenance.queryId}`,
      `query:${planning.actualProvenance.queryId}`,
    ],
  }];
};

const evidenceLimitations = (item: PreschoolSectionPackEvidence): string[] => {
  if (!isRecord(item.value)) return [];
  const limitations = item.value.limitations;
  return Array.isArray(limitations)
    ? limitations.filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    : [];
};

const requireSnapshotIdentity = (
  identity: EnergyIqOverviewAiArtifactIdentity,
  snapshot: ProjectAnalysisSnapshot,
): void => {
  if (identity.projectId !== "preschool-demo"
    || snapshot.context.workspaceId !== identity.workspaceId
    || snapshot.context.projectId !== identity.projectId
    || snapshot.context.scopeId !== identity.scopeId
    || snapshot.dataSnapshot.id !== identity.dataSnapshotId
    || snapshot.projectRelease.id !== identity.projectReleaseId
    || snapshot.context.primaryPeriod.start !== identity.analysisPeriodFrom
    || snapshot.context.primaryPeriod.endExclusive !== identity.analysisPeriodTo) {
    throw new Error("PRESCHOOL_SECTION_PACK_IDENTITY_MISMATCH");
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const evidenceIdSegment = (value: string): string => value
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/gu, "-")
  .replace(/^-|-$/gu, "") || "unknown";
