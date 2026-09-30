import type { ProjectAnalysisSnapshot } from "./project-analysis-resolver.js";

export const NGEE_ANN_CORE_AI_SECTION_IDS = [
  "trend-and-demand",
  "time-behaviour",
  "circuit-concentration",
  "decision-priorities",
] as const;

export const NGEE_ANN_SECTION_IDS = [
  ...NGEE_ANN_CORE_AI_SECTION_IDS,
  "school-holiday-comparison",
] as const;

export type NgeeAnnSectionId = typeof NGEE_ANN_SECTION_IDS[number];

type NgeeAnnSectionPackBinding = {
  workspaceId: string;
  projectId: string;
  scopeId: string;
  dataSnapshotId: string;
  projectReleaseId: string;
  analysisPeriod: { from: string; to: string };
  rendererKey: ProjectAnalysisSnapshot["renderer"]["key"];
};

type NgeeAnnSectionPackReportTime = {
  timezone: string;
  analysisWindow: {
    fromLocalDate: string;
    toExclusiveLocalDate: string;
    inclusiveToLocalDate: string;
    displayLabel: string;
  };
};

type NgeeAnnSectionPackFacts = {
  "trend-and-demand": {
    summary: ProjectAnalysisSnapshot["analysis"]["summary"];
    comparison: ProjectAnalysisSnapshot["analysis"]["comparison"];
    dailyTotals: ProjectAnalysisSnapshot["analysis"]["dailyTotals"];
    dailyUsageAnomalies: ProjectAnalysisSnapshot["analysis"]["dailyUsageAnomalies"];
    peakBreakdown: ProjectAnalysisSnapshot["analysis"]["peakBreakdown"];
  };
  "time-behaviour": {
    hourlyProfile: ProjectAnalysisSnapshot["analysis"]["hourlyProfile"];
    timeBehaviour: ProjectAnalysisSnapshot["analysis"]["timeBehaviour"];
    componentHourlyProfiles: ProjectAnalysisSnapshot["analysis"]["componentHourlyProfiles"];
    offHours: ProjectAnalysisSnapshot["analysis"]["offHours"];
  };
  "circuit-concentration": {
    categories: ProjectAnalysisSnapshot["analysis"]["categories"];
    levels: ProjectAnalysisSnapshot["analysis"]["childScopes"];
    circuits: ProjectAnalysisSnapshot["analysis"]["circuits"];
    topCircuits: ProjectAnalysisSnapshot["analysis"]["topCircuits"];
    componentReconciliation: ProjectAnalysisSnapshot["analysis"]["componentReconciliation"];
    peakBreakdown: ProjectAnalysisSnapshot["analysis"]["peakBreakdown"];
  };
  "decision-priorities": {
    decisionPriorities: ProjectAnalysisSnapshot["decisionPriorities"];
    decisionLifecycle: ProjectAnalysisSnapshot["decisionLifecycle"];
    attention: ProjectAnalysisSnapshot["analysis"]["attention"];
  };
  "school-holiday-comparison": {
    schoolHolidayComparison: ProjectAnalysisSnapshot["schoolHolidayComparison"];
  };
};

export type NgeeAnnSectionPack<SectionId extends NgeeAnnSectionId = NgeeAnnSectionId> = {
  contract: {
    id: "ngee-ann-section-pack";
    revision: "ngee-ann-section-pack-v2";
  };
  sectionId: SectionId;
  audience: "facilities and energy managers";
  analysisGoal: string;
  binding: NgeeAnnSectionPackBinding;
  reportTime: NgeeAnnSectionPackReportTime;
  evidence: ProjectAnalysisSnapshot["evidence"];
  facts: NgeeAnnSectionPackFacts[SectionId];
  dataQuality: ProjectAnalysisSnapshot["dataQuality"];
  limitations: string[];
  missingEvidence: string[];
  capabilities: {
    revision: "pack-only-v1";
    mode: "pack-only";
    tools: [];
  };
};

export type NgeeAnnSectionPacks = {
  [SectionId in NgeeAnnSectionId]: NgeeAnnSectionPack<SectionId>;
};

const ANALYSIS_GOALS: Record<NgeeAnnSectionId, string> = {
  "trend-and-demand": "Identify decision-relevant changes in total use, daily demand, peak demand and unusual days without assuming their cause.",
  "time-behaviour": "Identify decision-relevant hourly, day-type and off-hours patterns, including recurrence and counterexamples.",
  "circuit-concentration": "Identify where energy use and demand are concentrated across Levels and Circuits, including reconciliation boundaries.",
  "decision-priorities": "Identify the most decision-relevant current signals, their lifecycle and the evidence still needed before action.",
  "school-holiday-comparison": "Explain the authoritative same-context School Holiday comparison, its operational meaning and the next evidence check without recomputing any metric.",
};

export const assembleNgeeAnnSectionPacks = <SectionId extends NgeeAnnSectionId = NgeeAnnSectionId>(
  snapshot: ProjectAnalysisSnapshot,
  sectionIds: readonly SectionId[] = NGEE_ANN_SECTION_IDS as unknown as readonly SectionId[],
): Pick<NgeeAnnSectionPacks, SectionId> => {
  if (snapshot.renderer.key !== "ngee-ann-overview") {
    throw new Error("ENERGYIQ_NGEE_ANN_SECTION_PACK_RENDERER_REQUIRED");
  }
  const baseBinding: Omit<NgeeAnnSectionPackBinding, "analysisPeriod"> = {
    workspaceId: snapshot.context.workspaceId,
    projectId: snapshot.context.projectId,
    scopeId: snapshot.context.scopeId,
    dataSnapshotId: snapshot.dataSnapshot.id,
    projectReleaseId: snapshot.projectRelease.id,
    rendererKey: snapshot.renderer.key,
  };
  const common = <SectionId extends NgeeAnnSectionId>(
    sectionId: SectionId,
  ): Omit<NgeeAnnSectionPack<SectionId>, "facts"> => {
    const analysisPeriod = {
      from: snapshot.context.primaryPeriod.start,
      to: snapshot.context.primaryPeriod.endExclusive,
    };
    const reportTime = resolvePackReportTime(snapshot, analysisPeriod);
    return {
      contract: {
        id: "ngee-ann-section-pack" as const,
        revision: "ngee-ann-section-pack-v2" as const,
      },
      sectionId,
      audience: "facilities and energy managers" as const,
      analysisGoal: ANALYSIS_GOALS[sectionId],
      binding: { ...baseBinding, analysisPeriod },
      reportTime: {
        timezone: reportTime.timezone,
        analysisWindow: { ...reportTime.analysisWindow },
      },
      evidence: snapshot.evidence.map((item) => ({ ...item, queryIds: [...item.queryIds] })),
      dataQuality: { ...snapshot.dataQuality, importBatchIds: [...snapshot.dataQuality.importBatchIds] },
      limitations: limitations(snapshot, sectionId),
      missingEvidence: missingEvidence(snapshot, sectionId),
      capabilities: {
        revision: "pack-only-v1" as const,
        mode: "pack-only" as const,
        tools: [] as [],
      },
    };
  };

  const packFor = (sectionId: NgeeAnnSectionId): NgeeAnnSectionPack => {
    switch (sectionId) {
      case "trend-and-demand": return {
        ...common("trend-and-demand"),
        facts: {
          summary: snapshot.analysis.summary,
          comparison: snapshot.analysis.comparison,
          dailyTotals: snapshot.analysis.dailyTotals,
          dailyUsageAnomalies: snapshot.analysis.dailyUsageAnomalies,
          peakBreakdown: snapshot.analysis.peakBreakdown,
        },
      };
      case "time-behaviour": return {
        ...common("time-behaviour"),
        facts: {
          hourlyProfile: snapshot.analysis.hourlyProfile,
          timeBehaviour: snapshot.analysis.timeBehaviour,
          componentHourlyProfiles: snapshot.analysis.componentHourlyProfiles,
          offHours: snapshot.analysis.offHours,
        },
      };
      case "circuit-concentration": return {
        ...common("circuit-concentration"),
        facts: {
          categories: snapshot.analysis.categories,
          levels: snapshot.analysis.childScopes,
          circuits: snapshot.analysis.circuits,
          topCircuits: snapshot.analysis.topCircuits,
          componentReconciliation: snapshot.analysis.componentReconciliation,
          peakBreakdown: snapshot.analysis.peakBreakdown,
        },
      };
      case "decision-priorities": return {
        ...common("decision-priorities"),
        facts: {
          decisionPriorities: snapshot.decisionPriorities,
          decisionLifecycle: snapshot.decisionLifecycle,
          attention: snapshot.analysis.attention,
        },
      };
      case "school-holiday-comparison": return {
        ...common("school-holiday-comparison"),
        facts: { schoolHolidayComparison: snapshot.schoolHolidayComparison },
      };
    }
  };
  return Object.fromEntries(sectionIds.map((sectionId) => [sectionId, packFor(sectionId)])) as
    Pick<NgeeAnnSectionPacks, SectionId>;
};

const resolvePackReportTime = (
  snapshot: ProjectAnalysisSnapshot,
  analysisPeriod: { from: string; to: string },
): NgeeAnnSectionPackReportTime => {
  const timezone = snapshot.reportTimeContext?.timezone ?? snapshot.context.timezone;
  if (!timezone) throw new Error("ENERGYIQ_NGEE_ANN_SECTION_PACK_TIMEZONE_REQUIRED");
  const fromLocalDate = localDate(analysisPeriod.from, timezone);
  const toExclusiveLocalDate = localDate(analysisPeriod.to, timezone);
  const inclusiveToLocalDate = previousDate(toExclusiveLocalDate);
  return {
    timezone,
    analysisWindow: {
      fromLocalDate,
      toExclusiveLocalDate,
      inclusiveToLocalDate,
      displayLabel: `${displayDate(fromLocalDate)}–${displayDate(inclusiveToLocalDate)}`,
    },
  };
};

const localDate = (value: string, timezone: string): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  const result = `${part("year")}-${part("month")}-${part("day")}`;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(result)) {
    throw new Error("ENERGYIQ_NGEE_ANN_SECTION_PACK_REPORT_TIME_INVALID");
  }
  return result;
};

const previousDate = (value: string): string => {
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp)) throw new Error("ENERGYIQ_NGEE_ANN_SECTION_PACK_REPORT_TIME_INVALID");
  return new Date(timestamp - 86_400_000).toISOString().slice(0, 10);
};

const displayDate = (value: string): string => new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
  year: "numeric",
}).format(new Date(`${value}T00:00:00.000Z`));

const limitations = (
  snapshot: ProjectAnalysisSnapshot,
  sectionId: NgeeAnnSectionId,
): string[] => {
  const result: string[] = [];
  if (snapshot.dataQuality.status !== "complete") {
    result.push(`Published interval coverage is ${snapshot.dataQuality.coveragePct}%.`);
  }
  if (sectionId === "time-behaviour" && snapshot.analysis.offHours.status === "unavailable") {
    result.push(snapshot.analysis.offHours.reason.message);
  }
  if (sectionId === "circuit-concentration"
    && snapshot.analysis.componentReconciliation.ratioPct !== 100) {
    result.push("Published component Circuits do not exactly reconcile to the official project total.");
  }
  if (sectionId === "decision-priorities" && snapshot.decisionPriorities?.status === "unavailable") {
    result.push("The deterministic decision-priority projection is unavailable for this Snapshot.");
  }
  if (sectionId === "decision-priorities"
    && (snapshot.decisionPriorities?.status === "partial"
      || snapshot.decisionPriorities?.status === "suppressed")
    && snapshot.decisionPriorities.limitation) {
    result.push(snapshot.decisionPriorities.limitation.message);
  }
  if (sectionId === "school-holiday-comparison"
    && snapshot.schoolHolidayComparison?.status === "unavailable") {
    result.push(snapshot.schoolHolidayComparison.reason.message);
  }
  return result;
};

const missingEvidence = (
  snapshot: ProjectAnalysisSnapshot,
  sectionId: NgeeAnnSectionId,
): string[] => {
  const result: string[] = [];
  if (sectionId === "trend-and-demand" && (!snapshot.analysis.dailyUsageAnomalies
    || snapshot.analysis.dailyUsageAnomalies.status === "unavailable")) {
    result.push("Daily anomaly classification is unavailable.");
  }
  if (sectionId === "trend-and-demand" && (!snapshot.analysis.peakBreakdown
    || snapshot.analysis.peakBreakdown.status === "unavailable")) {
    result.push("Peak-interval contributor evidence is unavailable.");
  }
  if (sectionId === "time-behaviour" && !snapshot.analysis.timeBehaviour?.scopes.length) {
    result.push("No scoped time-behaviour series is available.");
  }
  if (sectionId === "circuit-concentration" && snapshot.analysis.circuits.length === 0) {
    result.push("No published Circuit series is available.");
  }
  if (sectionId === "decision-priorities" && !snapshot.decisionLifecycle) {
    result.push("No prior decision lifecycle is available for comparison.");
  }
  if (sectionId === "school-holiday-comparison"
    && snapshot.schoolHolidayComparison?.status !== "available") {
    result.push("No exact same-context School Holiday comparison is available for this Snapshot and Release.");
  }
  return result;
};
