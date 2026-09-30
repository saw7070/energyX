import type { EnergyProjectAnalysisSnapshotDto } from "../../../lib/config-api";
import { buildPreschoolDiscoveryEvidenceBundle } from "./preschool-ai-discovery-evidence";
import type { PreschoolAiArtifactBinding, PreschoolAiPlacementTarget } from "./preschool-ai-artifact";
import { PRESCHOOL_AI_ACCEPTED_CONTRACT_REVISION } from "./preschool-ai-artifact";

export type PreschoolOverviewCoverageV1 = {
  contract: { id: "preschool-overview-coverage"; revision: "v1" };
  binding: PreschoolAiArtifactBinding;
  sections: Array<{
    target: PreschoolAiPlacementTarget;
    decisionQuestion: string;
    visibleSignalRefs: string[];
    visibleEvidenceRefs: string[];
    visibleVisuals: Array<{
      id: string;
      type: "kpi" | "ranking" | "distribution" | "chart" | "table";
      topic: string;
      claimRefs: string[];
      evidenceRefs: string[];
    }>;
    visibleClaims: Array<{
      id: string;
      label: string;
      metrics: Array<{ id: string; metricId: string; value: number; unit: string }>;
      limitations: string[];
    }>;
  }>;
};

const SECTION_DEFINITIONS: ReadonlyArray<{
  target: PreschoolAiPlacementTarget;
  decisionQuestion: string;
}> = [
  { target: "preschool.overall-key-findings", decisionQuestion: "What changes the Portfolio priority or next management decision?" },
  { target: "preschool.benchmark", decisionQuestion: "What explains or changes the priority implied by the peer benchmark?" },
  { target: "preschool.standby", decisionQuestion: "Where is closed-hour energy persistent enough to investigate or act on?" },
  { target: "preschool.operating-hours", decisionQuestion: "What operating-hour relationship needs attention beyond the visible spike counts?" },
  { target: "preschool.forecast", decisionQuestion: "What decision-relevant uncertainty or planning implication is supported by this Snapshot?" },
  { target: "cross-section", decisionQuestion: "What relationship across sections changes the order of action?" },
];

export function buildPreschoolOverviewCoverage(
  snapshot: EnergyProjectAnalysisSnapshotDto,
): PreschoolOverviewCoverageV1 | null {
  const bundle = buildPreschoolDiscoveryEvidenceBundle(snapshot);
  const signals = snapshot.preschoolDecisionSignals;
  if (!bundle || !signals || signals.status !== "available"
    || signals.context.dataSnapshotId !== snapshot.dataSnapshot.id
    || signals.context.projectReleaseId !== snapshot.projectRelease.id) return null;
  const binding: PreschoolAiArtifactBinding = {
    projectId: "preschool-demo",
    scopeId: snapshot.context.scopeId,
    dataSnapshotId: snapshot.dataSnapshot.id,
    projectReleaseId: snapshot.projectRelease.id,
    dataCutoff: snapshot.context.primaryPeriod.endExclusive,
    analysisPeriod: {
      from: snapshot.context.primaryPeriod.start,
      to: snapshot.context.primaryPeriod.endExclusive,
    },
    outputContractRevision: PRESCHOOL_AI_ACCEPTED_CONTRACT_REVISION,
  };
  return {
    contract: { id: "preschool-overview-coverage", revision: "v1" },
    binding,
    sections: SECTION_DEFINITIONS.map((definition) => {
      const wholePage = definition.target === "preschool.overall-key-findings" || definition.target === "cross-section";
      const visibleSignals = wholePage
        ? signals.items
        : signals.items.filter((signal) => placementForSignal(signal.id) === definition.target);
      const visibleEvidence = bundle.items.filter((item) => evidenceVisibleAt(item.id, definition.target));
      return {
        ...definition,
        visibleSignalRefs: visibleSignals.map((signal) => signal.id),
        visibleEvidenceRefs: visibleEvidence.map((item) => item.id),
        visibleVisuals: visibleVisuals(snapshot, definition.target),
        visibleClaims: [
          ...visibleSignals.map((signal) => ({
            id: signal.id,
            label: signal.label,
            metrics: signal.metrics.map((metric) => ({
              id: metric.id,
              metricId: metric.metricId,
              value: metric.value,
              unit: metric.unit,
            })),
            limitations: signal.limitations.map((limitation) => limitation.label),
          })),
          ...visibleEvidence.map((item) => ({
            id: `visible-evidence:${item.id}`,
            label: item.label,
            metrics: Object.entries(item.values).flatMap(([key, value]) => typeof value === "number"
              ? [{ id: `${item.id}:${key}`, metricId: key, value, unit: item.unit ?? "value" }]
              : []),
            limitations: item.limitation ? [item.limitation] : [],
          })),
        ],
      };
    }),
  };
}

function visibleVisuals(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  target: PreschoolAiPlacementTarget,
): PreschoolOverviewCoverageV1["sections"][number]["visibleVisuals"] {
  const overview = [{
    id: "preschool.overall:portfolio-kpis",
    type: "kpi" as const,
    topic: "Portfolio consumption, average daily consumption, Centre count, and data quality",
    claimRefs: [
      "analysis.summary.usageKwh",
      "analysis.summary.averageDailyUsageKwh",
      "analysis.childScopes.length",
      "dataQuality",
    ],
    evidenceRefs: ["portfolio:window", "quality:window"],
  }];
  const benchmark = [{
    id: "preschool.benchmark:normalised-centre-ranking",
    type: "ranking" as const,
    topic: "Centre ranking and quadrant under floor-area and headcount normalisation",
    claimRefs: [
      "preschoolBenchmark.priorityCentreCodes",
      "preschoolBenchmark.centres[*].annualisedEuiKwhPerSqmYear",
      "preschoolBenchmark.centres[*].mayKwhPerPerson",
      "preschoolBenchmark.centres[*].quadrant",
    ],
    evidenceRefs: ["benchmark:portfolio-p75", "benchmark:priority-centre:*"],
  }];
  const operationalAvailable = snapshot.preschoolOperational?.status === "available";
  const standby = operationalAvailable ? [
    {
      id: "preschool.standby:calendar-energy-split",
      type: "chart" as const,
      topic: "Operating versus standby energy split",
      claimRefs: [
        "preschoolOperational.energy.standbyKwh",
        "preschoolOperational.energy.standbySharePct",
        "preschoolOperational.energy.operatingKwh",
      ],
      evidenceRefs: ["operating:portfolio"],
    },
    {
      id: "preschool.standby:spike-distribution",
      type: "distribution" as const,
      topic: "Standby Spike counts and affected Centres",
      claimRefs: ["preschoolOperational.spikes.standby.centres[*]"],
      evidenceRefs: ["spike:standby-summary", "circuit:standby:*"],
    },
  ] : [];
  const operating = operationalAvailable ? [{
    id: "preschool.operating-hours:spike-and-sop-table",
    type: "table" as const,
    topic: "Operating-hour Spikes and provisional SOP signal by Centre",
    claimRefs: [
      "preschoolOperational.spikes.operating.centres[*]",
      "preschoolOperational.sop.centres[*]",
    ],
    evidenceRefs: ["spike:operating-summary", "operating:sop-signal"],
  }] : [];
  const forecast = snapshot.preschoolAppliances?.status === "available" ? [{
    id: "preschool.forecast:appliance-contribution",
    type: "ranking" as const,
    topic: "Published Appliance contribution and planning projection",
    claimRefs: [
      "preschoolAppliances.appliances[*].usageKwh",
      "preschoolAppliances.appliances[*].sharePct",
      "preschoolAppliances.appliances[*].centreCount",
    ],
    evidenceRefs: ["circuit:appliance:*"],
  }] : [];
  if (target === "preschool.benchmark") return benchmark;
  if (target === "preschool.standby") return standby;
  if (target === "preschool.operating-hours") return operating;
  if (target === "preschool.forecast") return forecast;
  return [...overview, ...benchmark, ...standby, ...operating, ...forecast];
}

function placementForSignal(signalId: string): PreschoolAiPlacementTarget | null {
  if (signalId === "efficiency") return "preschool.benchmark";
  if (signalId === "after-hours") return "preschool.standby";
  if (signalId === "operating") return "preschool.operating-hours";
  return null;
}

function evidenceVisibleAt(id: string, target: PreschoolAiPlacementTarget): boolean {
  if (target === "preschool.overall-key-findings" || target === "cross-section") return true;
  if (target === "preschool.benchmark") return id.startsWith("benchmark:");
  if (target === "preschool.standby") return id === "operating:portfolio"
    || id.includes("standby")
    || id === "operating:sop-signal";
  if (target === "preschool.operating-hours") return id === "operating:portfolio"
    || id === "operating:sop-signal"
    || id.includes("operating") && !id.includes("standby");
  if (target === "preschool.forecast") return id.startsWith("circuit:appliance:");
  return false;
}
