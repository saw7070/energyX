import {
  TUYA_OFFICE_AI_SECTION_TARGET_IDS,
  type TuyaOfficeAiSectionTargetId,
} from "@datafoundry/contracts";
import type { ProjectAnalysisSnapshot } from "./project-analysis-resolver.js";
import { TUYA_OFFICE_PROJECT_ID } from "./tuya-office-project.js";

export const TUYA_OFFICE_SECTION_IDS = TUYA_OFFICE_AI_SECTION_TARGET_IDS;

export type TuyaOfficeSectionId = typeof TUYA_OFFICE_SECTION_IDS[number];

type TuyaOfficeSectionPackBinding = {
  workspaceId: string;
  projectId: typeof TUYA_OFFICE_PROJECT_ID;
  scopeId: string;
  dataSnapshotId: string;
  projectReleaseId: string;
  analysisPeriod: { from: string; to: string };
  rendererKey: "tuya-office-overview";
};

type TuyaOfficeSectionPackReportTime = {
  timezone: string;
  policyId: string;
  policyRevision: string;
  window: {
    windowId: string;
    role: string;
    label: string;
    phase: "complete" | "partial" | "forecast";
    from: string;
    toExclusive: string;
    fromLocalDate: string;
    toExclusiveLocalDate: string;
    inclusiveToLocalDate: string;
    displayLabel: string;
  };
};

type TuyaOfficeDecisionSummary = Omit<
  ProjectAnalysisSnapshot["analysis"]["summary"],
  "averageDailyUsageKwh"
> & {
  averageDailyUsage:
    | {
        status: "available";
        valueKwh: number;
        basis: "complete-report-period";
      }
    | {
        status: "unavailable";
        reason: "PARTIAL_PERIOD_COVERAGE";
        coveragePct: number;
      };
};

type TuyaOfficeSectionPackFacts = {
  "data-readiness": {
    dataQuality: ProjectAnalysisSnapshot["dataQuality"];
    meterDataHealth: ProjectAnalysisSnapshot["meterDataHealth"];
    dataSnapshot: ProjectAnalysisSnapshot["dataSnapshot"];
    metadata: ProjectAnalysisSnapshot["metadata"];
    attention: ProjectAnalysisSnapshot["analysis"]["attention"];
  };
  "consumption-and-demand": {
    summary: TuyaOfficeDecisionSummary;
    comparison: ProjectAnalysisSnapshot["analysis"]["comparison"];
    dailyTotals: ProjectAnalysisSnapshot["analysis"]["dailyTotals"];
    calendarTotals: ProjectAnalysisSnapshot["analysis"]["calendarTotals"];
    dailyUsageAnomalies: ProjectAnalysisSnapshot["analysis"]["dailyUsageAnomalies"];
    peakBreakdown: ProjectAnalysisSnapshot["analysis"]["peakBreakdown"];
    cost: ProjectAnalysisSnapshot["analysis"]["cost"];
  };
  "meter-contribution-and-operations": {
    categories: ProjectAnalysisSnapshot["analysis"]["categories"];
    componentCategoryBreakdown: ProjectAnalysisSnapshot["analysis"]["componentCategoryBreakdown"];
    childScopes: ProjectAnalysisSnapshot["analysis"]["childScopes"];
    circuits: ProjectAnalysisSnapshot["analysis"]["circuits"];
    topCircuits: ProjectAnalysisSnapshot["analysis"]["topCircuits"];
    designatedTotals: ProjectAnalysisSnapshot["analysis"]["designatedTotals"];
    componentReconciliation: ProjectAnalysisSnapshot["analysis"]["componentReconciliation"];
    virtualMeters: ProjectAnalysisSnapshot["analysis"]["virtualMeters"];
    virtualMeterTraces: ProjectAnalysisSnapshot["analysis"]["virtualMeterTraces"];
    hourlyProfile: ProjectAnalysisSnapshot["analysis"]["hourlyProfile"];
    timeBehaviour: ProjectAnalysisSnapshot["analysis"]["timeBehaviour"];
    componentHourlyProfiles: ProjectAnalysisSnapshot["analysis"]["componentHourlyProfiles"];
    offHours: ProjectAnalysisSnapshot["analysis"]["offHours"];
  };
};

export type TuyaOfficeSectionPack<SectionId extends TuyaOfficeSectionId = TuyaOfficeSectionId> = {
  contract: {
    id: "tuya-office-section-pack";
    revision: "tuya-office-section-pack-v4";
  };
  sectionId: SectionId;
  audience: "office facilities and energy managers";
  analysisGoal: string;
  binding: TuyaOfficeSectionPackBinding;
  reportTime: TuyaOfficeSectionPackReportTime;
  evidence: ProjectAnalysisSnapshot["evidence"];
  facts: TuyaOfficeSectionPackFacts[SectionId];
  limitations: string[];
  missingEvidence: string[];
  capabilities: {
    revision: "pack-only-v1";
    mode: "pack-only";
    tools: [];
  };
};

export type TuyaOfficeSectionPacks = {
  [SectionId in TuyaOfficeSectionId]: TuyaOfficeSectionPack<SectionId>;
};

const ANALYSIS_GOALS: Record<TuyaOfficeSectionId, string> = {
  "data-readiness": "Explain whether the current office Snapshot is sufficiently complete and current for operational decisions, without hiding missing or weak Meter evidence.",
  "consumption-and-demand": "Identify decision-relevant changes in total use, daily demand, peak demand, unusual days and cost without assuming their cause.",
  "meter-contribution-and-operations": "Identify where and when office energy use is concentrated across Spaces, Distribution Boards, categories and component Meters, while keeping official totals, components and virtual Meters distinct.",
};

export const assembleTuyaOfficeSectionPacks = (
  snapshot: ProjectAnalysisSnapshot,
): TuyaOfficeSectionPacks => {
  if (snapshot.context.projectId !== TUYA_OFFICE_PROJECT_ID
    || snapshot.renderer.key !== "tuya-office-overview") {
    throw new Error("ENERGYIQ_TUYA_OFFICE_SECTION_PACK_PROJECT_REQUIRED");
  }
  const binding: TuyaOfficeSectionPackBinding = {
    workspaceId: snapshot.context.workspaceId,
    projectId: TUYA_OFFICE_PROJECT_ID,
    scopeId: snapshot.context.scopeId,
    dataSnapshotId: snapshot.dataSnapshot.id,
    projectReleaseId: snapshot.projectRelease.id,
    analysisPeriod: {
      from: snapshot.context.primaryPeriod.start,
      to: snapshot.context.primaryPeriod.endExclusive,
    },
    rendererKey: "tuya-office-overview",
  };
  const reportTime = resolvePackReportTime(snapshot);
  const common = <SectionId extends TuyaOfficeSectionId>(
    sectionId: SectionId,
  ): Omit<TuyaOfficeSectionPack<SectionId>, "facts"> => ({
    contract: {
      id: "tuya-office-section-pack",
      revision: "tuya-office-section-pack-v4",
    },
    sectionId,
    audience: "office facilities and energy managers",
    analysisGoal: ANALYSIS_GOALS[sectionId],
    binding: { ...binding, analysisPeriod: { ...binding.analysisPeriod } },
    reportTime: {
      timezone: reportTime.timezone,
      policyId: reportTime.policyId,
      policyRevision: reportTime.policyRevision,
      window: { ...reportTime.window },
    },
    evidence: snapshot.evidence.map((item) => ({ ...item, queryIds: [...item.queryIds] })),
    limitations: limitations(snapshot, sectionId),
    missingEvidence: missingEvidence(snapshot, sectionId),
    capabilities: { revision: "pack-only-v1", mode: "pack-only", tools: [] },
  });

  return {
    "data-readiness": {
      ...common("data-readiness"),
      facts: {
        dataQuality: snapshot.dataQuality,
        meterDataHealth: snapshot.meterDataHealth,
        dataSnapshot: snapshot.dataSnapshot,
        metadata: snapshot.metadata,
        attention: snapshot.analysis.attention,
      },
    },
    "consumption-and-demand": {
      ...common("consumption-and-demand"),
      facts: {
        summary: decisionSummary(snapshot),
        comparison: snapshot.analysis.comparison,
        dailyTotals: snapshot.analysis.dailyTotals,
        calendarTotals: snapshot.analysis.calendarTotals,
        dailyUsageAnomalies: snapshot.analysis.dailyUsageAnomalies,
        peakBreakdown: snapshot.analysis.peakBreakdown,
        cost: snapshot.analysis.cost,
      },
    },
    "meter-contribution-and-operations": {
      ...common("meter-contribution-and-operations"),
      facts: {
        categories: snapshot.analysis.categories,
        componentCategoryBreakdown: snapshot.analysis.componentCategoryBreakdown,
        childScopes: snapshot.analysis.childScopes,
        circuits: snapshot.analysis.circuits,
        topCircuits: snapshot.analysis.topCircuits,
        designatedTotals: snapshot.analysis.designatedTotals,
        componentReconciliation: snapshot.analysis.componentReconciliation,
        virtualMeters: snapshot.analysis.virtualMeters,
        virtualMeterTraces: snapshot.analysis.virtualMeterTraces,
        hourlyProfile: snapshot.analysis.hourlyProfile,
        timeBehaviour: snapshot.analysis.timeBehaviour,
        componentHourlyProfiles: snapshot.analysis.componentHourlyProfiles,
        offHours: snapshot.analysis.offHours,
      },
    },
  };
};

const decisionSummary = (
  snapshot: ProjectAnalysisSnapshot,
): TuyaOfficeDecisionSummary => {
  const { averageDailyUsageKwh, ...summary } = snapshot.analysis.summary;
  return {
    ...summary,
    averageDailyUsage: snapshot.dataQuality.status === "complete"
      ? {
          status: "available",
          valueKwh: averageDailyUsageKwh,
          basis: "complete-report-period",
        }
      : {
          status: "unavailable",
          reason: "PARTIAL_PERIOD_COVERAGE",
          coveragePct: snapshot.dataQuality.coveragePct,
        },
  };
};

const resolvePackReportTime = (
  snapshot: ProjectAnalysisSnapshot,
): TuyaOfficeSectionPackReportTime => {
  const timezone = snapshot.reportTimeContext?.timezone ?? snapshot.context.timezone;
  if (!timezone) throw new Error("ENERGYIQ_TUYA_OFFICE_SECTION_PACK_TIMEZONE_REQUIRED");
  const reportTimeContext = snapshot.reportTimeContext;
  const window = reportTimeContext?.windows.find(({ windowId }) => windowId === "current-overview");
  if (!reportTimeContext || !window) {
    throw new Error("ENERGYIQ_TUYA_OFFICE_SECTION_PACK_REPORT_WINDOW_REQUIRED");
  }
  const fromLocalDate = localDate(window.from, timezone);
  const toExclusiveLocalDate = localDate(window.toExclusive, timezone);
  const inclusiveToLocalDate = previousDate(toExclusiveLocalDate);
  return {
    timezone,
    policyId: reportTimeContext.policyId,
    policyRevision: reportTimeContext.policyRevision,
    window: {
      windowId: window.windowId,
      role: window.role,
      label: window.label,
      phase: window.phase,
      from: window.from,
      toExclusive: window.toExclusive,
      fromLocalDate,
      toExclusiveLocalDate,
      inclusiveToLocalDate,
      displayLabel: `${displayDate(fromLocalDate)}–${displayDate(inclusiveToLocalDate)}`,
    },
  };
};

const limitations = (
  snapshot: ProjectAnalysisSnapshot,
  sectionId: TuyaOfficeSectionId,
): string[] => {
  const result: string[] = [];
  if (snapshot.dataQuality.status !== "complete") {
    result.push(`Published interval coverage is ${snapshot.dataQuality.coveragePct}%.`);
  }
  if (sectionId === "data-readiness" && snapshot.meterDataHealth) {
    const { insufficientHistory, noReadings } = snapshot.meterDataHealth.summary;
    if (insufficientHistory > 0) {
      result.push(`${insufficientHistory} published Meter${insufficientHistory === 1 ? " has" : "s have"} insufficient history.`);
    }
    if (noReadings > 0) {
      result.push(`${noReadings} published Meter${noReadings === 1 ? " has" : "s have"} no readings.`);
    }
  }
  if (sectionId === "meter-contribution-and-operations") {
    const ratio = snapshot.analysis.componentReconciliation.ratioPct;
    if (ratio !== null && ratio !== 100) {
      result.push("Published component Meters do not exactly reconcile to the official project total and must not be added to it as another total.");
    }
    if (snapshot.analysis.offHours.status === "unavailable") {
      result.push(snapshot.analysis.offHours.reason.message);
    }
  }
  return result;
};

const missingEvidence = (
  snapshot: ProjectAnalysisSnapshot,
  sectionId: TuyaOfficeSectionId,
): string[] => {
  const result: string[] = [];
  if (sectionId === "data-readiness") {
    if (!snapshot.dataSnapshot.sourceCoverage) result.push("Source coverage dates are unavailable.");
    if (!snapshot.meterDataHealth) result.push("Per-Meter data health is unavailable.");
  }
  if (sectionId === "consumption-and-demand") {
    if (!snapshot.analysis.dailyTotals) result.push("Daily usage evidence is unavailable.");
    if (!snapshot.analysis.dailyUsageAnomalies
      || snapshot.analysis.dailyUsageAnomalies.status === "unavailable") {
      result.push("Comparable-day anomaly evidence is unavailable.");
    }
    if (!snapshot.analysis.peakBreakdown
      || snapshot.analysis.peakBreakdown.status === "unavailable") {
      result.push("Peak-interval contributor evidence is unavailable.");
    }
  }
  if (sectionId === "meter-contribution-and-operations") {
    if (!snapshot.analysis.timeBehaviour) result.push("Hourly time-behaviour evidence is unavailable.");
    if (!snapshot.analysis.componentHourlyProfiles) {
      result.push("Component Meter hourly profiles are unavailable.");
    }
    if (snapshot.analysis.offHours.status === "unavailable") {
      result.push("Operating-hours classification is unavailable.");
    }
  }
  return result;
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
    throw new Error("ENERGYIQ_TUYA_OFFICE_SECTION_PACK_REPORT_TIME_INVALID");
  }
  return result;
};

const previousDate = (value: string): string => {
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp)) {
    throw new Error("ENERGYIQ_TUYA_OFFICE_SECTION_PACK_REPORT_TIME_INVALID");
  }
  return new Date(timestamp - 86_400_000).toISOString().slice(0, 10);
};

const displayDate = (value: string): string => new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
  year: "numeric",
}).format(new Date(`${value}T00:00:00.000Z`));
