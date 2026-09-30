import {
  readEnergyAnalysisEligibleCoverage,
  readEnergyMeterDataHealth,
  resolveEnergyFactStorePath,
  type EnergyMeterDataHealth,
  type LocalDataGateway,
} from "@datafoundry/data-gateway";
import {
  createDefaultTemplateDocument,
  type EnergyIqComponentRevisionRecord,
  type EnergyIqRuleRevisionRecord,
  type EnergyIqSavedAnalysisRecord,
  type EnergyIqTemplateDraftDocument,
  type EnergyIqTemplateRevisionRecord,
  type MetadataStore,
  type UserRecord,
} from "@datafoundry/metadata";
import {
  ENERGYIQ_REPORT_TIME_CONTEXT_REVISION,
  type EnergyIqOverviewDefinition,
  type ReportTimeContext,
  type ReportTimePolicyRevision,
} from "@datafoundry/contracts";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { isDeepStrictEqual } from "node:util";

import type { ConfigApiContext } from "../routes/types.js";

import {
  executeEnergyDayProfileProjection,
  executeEnergyDailyTotalsProjection,
  executeEnergyScopeAnalysis,
  executeEnergyScopeAnalysisWithLatestAvailable,
  resolveEnergyCurrentOverviewPeriodBasis,
  selectEnergyCurrentOverviewPeriodReadOnly,
  selectEnergyLatestCompleteDay,
  selectEnergyLatestCompletePeriod,
  type EnergyScopeAnalysis,
} from "./energy-analysis.js";
import {
  projectAnalysisPayload,
  resolveProjectAnalysisMetadata,
  type ProjectAnalysisMetadataProjection,
  type ProjectAnalysisPayload,
} from "./project-analysis-metadata.js";
import {
  buildNgeeAnnDecisionPriorities,
  type NgeeAnnDecisionPriorities,
} from "./ngee-ann-decision-priorities.js";
import {
  buildNgeeAnnDecisionLifecycle,
  type NgeeAnnDecisionLifecycle,
} from "./ngee-ann-decision-lifecycle.js";
import {
  buildSchoolHolidayComparison,
  SCHOOL_HOLIDAY_COMPARISON_RULE_REVISION,
  schoolHolidayComparisonHasRequiredShape,
  schoolHolidayComparisonMatchesReportTimeContext,
  schoolHolidayComparisonUnavailable,
  type SchoolHolidayComparisonPolicy,
  type SchoolHolidayComparisonResult,
} from "./school-holiday-comparison.js";
import {
  loadSchoolHolidayFactProjection,
  schoolHolidayLocalDateInstant,
} from "./school-holiday-fact-projection.js";
import {
  NGEE_ANN_SCHOOL_HOLIDAY_SECTION_ID,
  resolveNgeeAnnSectionManifestForRelease,
  type NgeeAnnSectionManifest,
} from "./ngee-ann-section-manifest.js";
import {
  hasCompletePreschoolBenchmarkWindow,
  resolvePreschoolBenchmarkProjection,
  type PreschoolBenchmarkProjection,
} from "./preschool-benchmark-projection.js";
import {
  buildPreschoolApplianceProjection,
  type PreschoolApplianceProjection,
} from "./preschool-appliance-projection.js";
import {
  loadPreschoolOperationalProjection,
  resolvePreschoolPlanningSourcePeriod,
  type PreschoolOperationalProjection,
} from "./preschool-operational-projection.js";
import {
  buildPreschoolMonthlyActualContext,
  loadPreschoolPlanningLifecycle,
  resolvePreschoolMonthlyTargetPeriod,
  type PreschoolMonthlyTargetPeriod,
  type PreschoolPlanningLifecycle,
} from "./preschool-planning-lifecycle.js";
import {
  buildPreschoolDecisionSignals,
  type PreschoolDecisionSignals,
} from "./preschool-decision-signals.js";
import {
  resolveEnergyAccessContext,
  resolveEnergyPublishedHierarchyTimezone,
  resolveEnergyPublishedMeterRoute,
  resolveEnergyPublishedMeterPoints,
  resolveEnergyQueryContext,
  type EnergyQueryContext,
  type EnergyQueryContextRequest,
} from "./energy-query-context.js";
import {
  canonicalizeProjectAnalysisRevisionSet,
  createProjectAnalysisCacheKey,
  createProjectAnalysisResultCache,
  createProjectOverviewProjectionKey,
  createProjectOverviewProjectionRef,
  readProjectAnalysisPrewarmOutcomeSidecar,
  writeProjectAnalysisPrewarmOutcomeSidecar,
  type ProjectAnalysisResultCache,
  type ProjectOverviewPointerPublication,
  type ProjectOverviewProjectionIdentity,
} from "./project-analysis-result-cache.js";
import {
  reportTimePeriodDayCount,
  resolveReportTimeContext,
} from "./report-time-context.js";
import {
  withEnergyProjectPublicationReadLock,
  withRecoveredEnergyProjectPublicationLock,
} from "./energy-project-materialization.js";

export type ProjectRendererKey = "ngee-ann-overview" | "preschool-overview" | "tuya-office-overview" | "energy-template-overview";

export const projectRendererIncludesMeterDataHealth = (rendererKey: ProjectRendererKey): boolean => (
  rendererKey === "energy-template-overview" || rendererKey === "tuya-office-overview"
);

const PROJECT_ANALYSIS_RECIPE = {
  id: "energy-scope-analysis",
  version: "1",
} as const;

const PROJECT_RENDERER_VERSION = "1" as const;
const PROJECT_RENDERER_CONTRACT_VERSION = "project-analysis-snapshot@1" as const;

export type PublishedProjectRelease = {
  id: string;
  source: "template-revision" | "legacy-profile";
  projectId: string;
  templateRevisionId: string | null;
  templateRevisionSequence: number | null;
  reportTimePolicyRevisionId: string;
  recipe: {
    id: "energy-scope-analysis";
    version: "1";
  };
  renderer: {
    key: ProjectRendererKey;
    version: "1";
    contractVersion: "project-analysis-snapshot@1";
    aiPresentationMode?: "structured" | "html";
  };
  hierarchyRevisionId: string;
  meterMappingRevisionId: string;
  meterFormulaRevisionId: string;
  metricRevisionIds: string[];
  ruleRevisionIds: string[];
  businessCalendarVersion: string;
  tariffScheduleVersion: string;
  publishedAt: string | null;
  document: EnergyIqTemplateDraftDocument;
  catalog: EnergyIqComponentRevisionRecord[];
};

export type ProjectAnalysisSnapshot = {
  context: EnergyQueryContext & {
    primaryPeriod: {
      start: string;
      endExclusive: string;
    };
    projectReleaseId: string;
    latestCompleteLocalDay?: string | null;
    monthlyOutlookTargetPeriod?: PreschoolMonthlyTargetPeriod | null;
  };
  projectRelease: PublishedProjectRelease;
  reportTimeContext?: ReportTimeContext;
  reportWindowAnalyses?: ProjectReportWindowAnalysis[];
  reportWindowSegmentSummaries?: ProjectReportWindowSegmentSummary[];
  recipe: PublishedProjectRelease["recipe"];
  renderer: PublishedProjectRelease["renderer"];
  dataQuality: EnergyScopeAnalysis["dataHealth"];
  meterDataHealth?: {
    summary: {
      total: number;
      usable: number;
      insufficientHistory: number;
      noReadings: number;
    };
    meters: EnergyMeterDataHealth[];
  };
  evidence: Array<{
    id: string;
    metricId: string;
    queryIds: EnergyScopeAnalysis["provenance"]["queryIds"];
    queryReceiptId?: string;
  }>;
  findings: EnergyScopeAnalysis["attention"];
  sectionManifest?: NgeeAnnSectionManifest;
  schoolHolidayComparison?: SchoolHolidayComparisonResult;
  decisionPriorities?: NgeeAnnDecisionPriorities;
  decisionLifecycle?: NgeeAnnDecisionLifecycle;
  preschoolBenchmark?: PreschoolBenchmarkProjection;
  preschoolAppliances?: PreschoolApplianceProjection;
  preschoolOperational?: PreschoolOperationalProjection;
  preschoolPlanningLifecycle?: PreschoolPlanningLifecycle;
  preschoolDecisionSignals?: PreschoolDecisionSignals;
  dataSnapshot: {
    id: string;
    importBatchIds: string[];
    lastSeenAt: string | null;
    sourceCoverage?: {
      fromLocalDate: string;
      throughLocalDate: string;
    };
  };
  latestAvailablePeriod?: {
    period: "Custom";
    from: string;
    to: string;
  };
  metadata: ProjectAnalysisMetadataProjection;
  analysis: ProjectAnalysisPayload;
};

export type ProjectReportWindowAnalysis = {
  windowId: string;
  period: {
    start: string;
    endExclusive: string;
  };
  status: "ready";
  analysis: {
    summary?: ProjectAnalysisPayload["summary"];
    offHours?: ProjectAnalysisPayload["offHours"];
    dailyTotals?: NonNullable<ProjectAnalysisPayload["dailyTotals"]>;
    timeBehaviour?: NonNullable<ProjectAnalysisPayload["timeBehaviour"]>;
    componentHourlyProfiles?: NonNullable<ProjectAnalysisPayload["componentHourlyProfiles"]>;
    composition?: Pick<ProjectAnalysisPayload,
      | "provenance"
      | "comparison"
      | "categories"
      | "childScopes"
      | "circuits"
      | "designatedTotals"
      | "componentReconciliation"
      | "virtualMeterTraces"
    >;
  };
};

export type ProjectReportWindowSegmentSummary = {
  windowId: string;
  status: "ready";
  segments: Array<{
    period: {
      start: string;
      endExclusive: string;
    };
    dataStatus: "complete" | "partial" | "unavailable";
    expectedDayCount: number;
    completeDayCount: number;
    summary: {
      usageKwh: number;
      averageDailyUsageKwh: number;
    } | null;
    evidence: {
      dataSnapshotId: string;
      queryId: "daily_totals_v1";
    };
  }>;
};

export type ProjectAnalysisResolution =
  | {
    status: "ready";
    snapshot: ProjectAnalysisSnapshot;
  }
  | {
    status: "configuration-required";
    context: EnergyQueryContext;
    projectId: string;
    title: "Project analysis is not configured";
    detail: string;
  };

type ReadyProjectAnalysisResolution = Extract<ProjectAnalysisResolution, { status: "ready" }>;
export type ProjectAnalysisRequestDiagnostics = {
  cacheStatus: "computed" | "reused";
  /** Count of declared deterministic Evidence queries, not physical SQL calls. */
  evidenceQueryCount: number;
};
export type PublishedRunContext = {
  context: EnergyQueryContext;
  projectRelease: PublishedProjectRelease | null;
  validatePinnedOverviewPeriod?: () => Promise<void>;
};

const resolveDataSnapshotSourceCoverage = (input: {
  metadataStore: MetadataStore;
  workspaceId: string;
  projectId: string;
  dataSnapshotId: string;
}): ProjectAnalysisSnapshot["dataSnapshot"]["sourceCoverage"] => {
  const snapshot = input.metadataStore.energyIq.getDataSnapshot(input.dataSnapshotId);
  if (snapshot.workspace_id !== input.workspaceId || snapshot.project_id !== input.projectId) {
    throw new Error(`ENERGYIQ_DATA_SNAPSHOT_BINDING_MISMATCH:${input.dataSnapshotId}`);
  }
  const manifest = JSON.parse(snapshot.manifest_json) as unknown;
  if (!isJsonRecord(manifest) || !isJsonRecord(manifest.identity) || !Array.isArray(manifest.identity.batches)) {
    throw new Error(`ENERGYIQ_SNAPSHOT_MANIFEST_INVALID:${input.dataSnapshotId}`);
  }
  const fromDates: string[] = [];
  const throughDates: string[] = [];
  for (const batch of manifest.identity.batches) {
    if (!isJsonRecord(batch)) continue;
    const fromLocalDate = sourceCoverageLocalDate(batch.coverageFrom);
    const throughLocalDate = sourceCoverageLocalDate(batch.coverageTo);
    if (fromLocalDate) fromDates.push(fromLocalDate);
    if (throughLocalDate) throughDates.push(throughLocalDate);
  }
  if (fromDates.length === 0 || throughDates.length === 0) return undefined;
  return {
    fromLocalDate: fromDates.sort()[0]!,
    throughLocalDate: throughDates.sort().at(-1)!,
  };
};

const sourceCoverageLocalDate = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const match = /^(\d{4}-\d{2}-\d{2})(?:T|$)/.exec(value);
  return match?.[1];
};

const isJsonRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

const resolveNgeeAnnSchoolHolidayComparison = async (input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  userId: string;
  context: EnergyQueryContext;
  projectRelease: PublishedProjectRelease;
  reportWindow: ReportTimeContext["windows"][number];
  reportTimePolicyRevision: string;
  databasePath: string;
}): Promise<SchoolHolidayComparisonResult> => {
  const rule = input.metadataStore.energyIq.rules.listRevisions().find((candidate) => (
    candidate.revision_id === SCHOOL_HOLIDAY_COMPARISON_RULE_REVISION
    && input.projectRelease.ruleRevisionIds.includes(candidate.revision_id)
  ));
  const period = {
    from: localDateAtInstant(input.reportWindow.from, input.context.timezone),
    toExclusive: localDateAtInstant(input.reportWindow.toExclusive, input.context.timezone),
  };
  const identity = {
    projectId: input.context.projectId,
    scopeId: input.context.scopeId,
    dataSnapshotId: input.context.dataSnapshotId,
    projectReleaseId: input.projectRelease.id,
    comparisonWindowId: NGEE_ANN_SCHOOL_HOLIDAY_SECTION_ID,
    reportTimePolicyRevision: input.reportTimePolicyRevision,
    period,
    businessCalendarVersion: input.projectRelease.businessCalendarVersion,
    ruleRevision: SCHOOL_HOLIDAY_COMPARISON_RULE_REVISION,
  } as const;
  const policy = rule ? parseSchoolHolidayComparisonPolicy(rule) : null;
  if (!policy) {
    return schoolHolidayComparisonUnavailable({
      identity,
      code: "FACT_INVALID",
      message: "The Release-pinned School Holiday comparison Rule is invalid.",
    });
  }
  const facts = await loadSchoolHolidayFactProjection({
    metadataStore: input.metadataStore,
    dataGateway: input.dataGateway,
    userId: input.userId,
    context: input.context,
    localPeriod: period,
    databasePath: input.databasePath,
  });
  if (facts.status !== "available") {
    return schoolHolidayComparisonUnavailable({
      identity,
      code: facts.reason.code === "FACT_QUERY_FAILED"
        ? "FACT_QUERY_FAILED"
        : facts.reason.code === "FACT_ROWS_INVALID"
          ? "FACT_INVALID"
          : "FACT_COVERAGE_INCOMPLETE",
      message: facts.reason.message,
      ...(facts.quality ? {
        quality: { ...facts.quality, excludedLocalDates: [...(facts.excludedLocalDates ?? [])] },
      } : {}),
      ...("limitations" in facts && facts.limitations ? { limitations: facts.limitations } : {}),
    });
  }
  const calendarContexts = input.metadataStore.energyIq.operationalPolicy.resolveCalendarDateContexts({
    project_id: input.context.projectId,
    scope_id: input.context.scopeId,
    version_id: input.projectRelease.businessCalendarVersion,
    period: {
      from: schoolHolidayLocalDateInstant(period.from, input.context.timezone),
      to: schoolHolidayLocalDateInstant(period.toExclusive, input.context.timezone),
    },
  });
  return buildSchoolHolidayComparison({
    facts: facts.facts,
    calendarContexts,
    identity,
    comparisonPolicy: policy,
    factLimitations: facts.limitations,
    factQuality: { ...facts.quality, excludedLocalDates: [...facts.excludedLocalDates] },
  });
};

const parseSchoolHolidayComparisonPolicy = (
  rule: EnergyIqRuleRevisionRecord,
): SchoolHolidayComparisonPolicy | null => {
  const number = (key: string): number | null => {
    const value = rule.parameters[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };
  const anomalyRelativeThresholdPct = number("anomaly_relative_threshold_pct");
  const anomalyAbsoluteThresholdKwh = number("anomaly_absolute_threshold_kwh");
  const minimumCohortSampleCount = number("minimum_cohort_sample_count");
  const minimumAnomalyBaselineSamples = number("minimum_anomaly_baseline_samples");
  if (rule.revision_id !== SCHOOL_HOLIDAY_COMPARISON_RULE_REVISION
    || rule.rule_id !== "comparison.school_holiday_context"
    || rule.version !== 1
    || rule.evaluation_key !== "SCHOOL_HOLIDAY_CONTEXT_COMPARISON"
    || rule.requirement !== "historical_baseline"
    || rule.metric_revision_ids.length !== 1
    || rule.metric_revision_ids[0] !== "energy.total_usage_kwh@1"
    || anomalyRelativeThresholdPct === null
    || anomalyRelativeThresholdPct < 0
    || anomalyAbsoluteThresholdKwh === null
    || anomalyAbsoluteThresholdKwh < 0
    || minimumCohortSampleCount === null
    || !Number.isInteger(minimumCohortSampleCount)
    || minimumCohortSampleCount < 1
    || minimumAnomalyBaselineSamples === null
    || !Number.isInteger(minimumAnomalyBaselineSamples)
    || minimumAnomalyBaselineSamples < minimumCohortSampleCount
    || rule.parameters.comparison_method
      !== "complete_holiday_interval_vs_adjacent_teaching_by_day_context"
    || rule.parameters.anomaly_baseline_method
      !== "same_academic_phase_and_day_context_leave_one_out_mean") return null;
  return {
    anomalyRelativeThresholdPct,
    anomalyAbsoluteThresholdKwh,
    minimumCohortSampleCount,
    minimumAnomalyBaselineSamples,
  };
};

const localDateAtInstant = (value: string, timezone: string): string => {
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) throw new Error("ENERGYIQ_LOCAL_DATE_INSTANT_INVALID");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes): string => (
    parts.find((item) => item.type === type)?.value ?? ""
  );
  return `${part("year")}-${part("month")}-${part("day")}`;
};

const PROJECT_ANALYSIS_CACHE_CAPACITY = 6;
// Rotate this value whenever deterministic Snapshot composition semantics change.
// It prevents a new API release from restoring a projection produced by older code.
const PROJECT_ANALYSIS_RESOLVER_REVISION = "project-analysis-resolver@2026-09-01.1";
const MANAGED_OVERVIEW_SYSTEM_ACTOR_ID = "energyiq-system";
// Snapshot and Release identity are immutable cache-key inputs. Keep the hot
// result for a working day; a data or release change naturally selects a new key.
const PROJECT_ANALYSIS_CACHE_TTL_MS = 24 * 60 * 60_000;
const PROJECT_PLANNING_LIFECYCLE_CACHE_CAPACITY = 12;
const PROJECT_PLANNING_LIFECYCLE_CACHE_TTL_MS = 24 * 60 * 60_000;
const PROJECT_ANALYSIS_CACHES = new WeakMap<
  MetadataStore,
  WeakMap<LocalDataGateway, ProjectAnalysisResultCache<ReadyProjectAnalysisResolution>>
>();
const PROJECT_PLANNING_LIFECYCLE_CACHES = new WeakMap<
  MetadataStore,
  WeakMap<LocalDataGateway, ProjectAnalysisResultCache<PreschoolPlanningLifecycle>>
>();

const projectAnalysisCacheFor = (
  metadataStore: MetadataStore,
  dataGateway: LocalDataGateway,
): ProjectAnalysisResultCache<ReadyProjectAnalysisResolution> => {
  let gatewayCaches = PROJECT_ANALYSIS_CACHES.get(metadataStore);
  if (!gatewayCaches) {
    gatewayCaches = new WeakMap();
    PROJECT_ANALYSIS_CACHES.set(metadataStore, gatewayCaches);
  }
  let cache = gatewayCaches.get(dataGateway);
  if (!cache) {
    cache = createProjectAnalysisResultCache({
      capacity: PROJECT_ANALYSIS_CACHE_CAPACITY,
      ttlMs: PROJECT_ANALYSIS_CACHE_TTL_MS,
    });
    gatewayCaches.set(dataGateway, cache);
  }
  return cache;
};

const projectPlanningLifecycleCacheFor = (
  metadataStore: MetadataStore,
  dataGateway: LocalDataGateway,
): ProjectAnalysisResultCache<PreschoolPlanningLifecycle> => {
  let gatewayCaches = PROJECT_PLANNING_LIFECYCLE_CACHES.get(metadataStore);
  if (!gatewayCaches) {
    gatewayCaches = new WeakMap();
    PROJECT_PLANNING_LIFECYCLE_CACHES.set(metadataStore, gatewayCaches);
  }
  let cache = gatewayCaches.get(dataGateway);
  if (!cache) {
    cache = createProjectAnalysisResultCache({
      capacity: PROJECT_PLANNING_LIFECYCLE_CACHE_CAPACITY,
      ttlMs: PROJECT_PLANNING_LIFECYCLE_CACHE_TTL_MS,
    });
    gatewayCaches.set(dataGateway, cache);
  }
  return cache;
};

export type ProjectOverviewProfile = {
  rendererKey: ProjectRendererKey;
  rendererVersion: "1";
  contractVersion: "project-analysis-snapshot@1";
  releaseVersion: 1 | 2;
  reportTimePolicyRevisionId: string;
  primaryWindowId: string;
  currentAnalysisWindow: "current-overview-7d" | "current-overview-28d" | "current-month-to-date";
  source: "overview-definition" | "legacy-profile";
  horizons: {
    latestStatus: "latest-complete-day";
    shortTermDays: 7;
    mainDays: 7 | 28;
  };
};

const LEGACY_PROJECT_OVERVIEW_PROFILES: Readonly<Record<string, ProjectOverviewProfile>> = {
  "ngee-ann-polytechnic": {
    rendererKey: "ngee-ann-overview",
    rendererVersion: "1",
    contractVersion: "project-analysis-snapshot@1",
    releaseVersion: 1,
    reportTimePolicyRevisionId: "ngee-ann-report-time@1",
    primaryWindowId: "current-month-progress",
    currentAnalysisWindow: "current-month-to-date",
    source: "legacy-profile",
    horizons: { latestStatus: "latest-complete-day", shortTermDays: 7, mainDays: 28 },
  },
  "preschool-demo": {
    rendererKey: "preschool-overview",
    rendererVersion: "1",
    contractVersion: "project-analysis-snapshot@1",
    releaseVersion: 2,
    reportTimePolicyRevisionId: "preschool-report-time@2",
    primaryWindowId: "current-overview",
    currentAnalysisWindow: "current-month-to-date",
    source: "legacy-profile",
    horizons: { latestStatus: "latest-complete-day", shortTermDays: 7, mainDays: 28 },
  },
};

export const resolveProjectOverviewProfile = (
  metadataStore: MetadataStore,
  projectId: string,
): ProjectOverviewProfile | null => {
  const revision = metadataStore.energyIq.templates.getLatestProjectRevision(projectId);
  const definitionRecord = revision
    ? metadataStore.energyIq.overviewDefinitions.get(revision.revision_id)
    : null;
  if (definitionRecord) {
    return projectOverviewProfileFromDefinition(metadataStore, projectId, definitionRecord);
  }
  return LEGACY_PROJECT_OVERVIEW_PROFILES[projectId] ?? null;
};

type OverviewDefinitionRecord = NonNullable<
  ReturnType<MetadataStore["energyIq"]["overviewDefinitions"]["get"]>
>;

const projectOverviewProfileFromDefinition = (
  metadataStore: MetadataStore,
  projectId: string,
  definitionRecord: OverviewDefinitionRecord,
): ProjectOverviewProfile => {
  const policy = metadataStore.energyIq.reportTimePolicies.get(
    projectId,
    definitionRecord.time_policy_revision_id,
  )?.policy;
  const primaryWindowId = definitionRecord.definition.sections[0]?.primaryWindowId;
  const primaryStrategy = policy?.windows.find((window) => window.windowId === primaryWindowId)?.strategy;
  const currentAnalysisWindow = primaryStrategy?.kind === "calendar_month_to_date"
    ? "current-month-to-date" as const
    : primaryStrategy?.kind === "rolling_complete_days" && primaryStrategy.days === 7
      ? "current-overview-7d" as const
    : primaryStrategy?.kind === "rolling_complete_days" && primaryStrategy.days === 28
      ? "current-overview-28d" as const
      : null;
  if (!primaryWindowId || !currentAnalysisWindow) {
    throw new Error("ENERGYIQ_OVERVIEW_PRIMARY_WINDOW_UNSUPPORTED");
  }
  return {
    rendererKey: definitionRecord.renderer_key,
    rendererVersion: PROJECT_RENDERER_VERSION,
    contractVersion: PROJECT_RENDERER_CONTRACT_VERSION,
    releaseVersion: 1,
    reportTimePolicyRevisionId: definitionRecord.time_policy_revision_id,
    primaryWindowId,
    currentAnalysisWindow,
    source: "overview-definition",
    horizons: {
      latestStatus: "latest-complete-day",
      shortTermDays: 7,
      mainDays: currentAnalysisWindow === "current-overview-7d" ? 7 : 28,
    },
  };
};

export const resolveProjectOverviewProfileForRelease = (
  metadataStore: MetadataStore,
  projectRelease: PublishedProjectRelease,
): ProjectOverviewProfile | null => {
  if (projectRelease.templateRevisionId !== null) {
    const revision = metadataStore.energyIq.templates.getProjectRevision(projectRelease.templateRevisionId);
    const definitionRecord = metadataStore.energyIq.overviewDefinitions.get(projectRelease.templateRevisionId);
    if (projectRelease.source !== "template-revision"
      || projectRelease.id !== projectRelease.templateRevisionId
      || !revision
      || revision.project_id !== projectRelease.projectId
      || !definitionRecord
      || definitionRecord.renderer_key !== projectRelease.renderer.key
      || definitionRecord.time_policy_revision_id !== projectRelease.reportTimePolicyRevisionId) return null;
    return projectOverviewProfileFromDefinition(metadataStore, projectRelease.projectId, definitionRecord);
  }
  const legacyProfile = LEGACY_PROJECT_OVERVIEW_PROFILES[projectRelease.projectId] ?? null;
  if (!legacyProfile
    || projectRelease.source !== "legacy-profile"
    || projectRelease.id !== legacyProjectReleaseId(projectRelease.projectId, legacyProfile)
    || projectRelease.renderer.key !== legacyProfile.rendererKey
    || projectRelease.reportTimePolicyRevisionId !== legacyProfile.reportTimePolicyRevisionId) return null;
  return legacyProfile;
};

export const resolveProjectOverviewReleaseId = (
  metadataStore: MetadataStore,
  projectId: string,
): string | null => {
  const profile = resolveProjectOverviewProfile(metadataStore, projectId);
  if (!profile) return null;
  const revision = metadataStore.energyIq.templates.getLatestProjectRevision(projectId);
  return revision?.revision_id ?? legacyProjectReleaseId(projectId, profile);
};

export const resolveProjectAnalysis = async (input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  user: UserRecord;
  workspaceId: string;
  request: EnergyQueryContextRequest;
  databasePath?: string;
  bypassCache?: boolean;
  /** Internal projection seam: mutable Saved Analysis lifecycle is hydrated on read. */
  includeMutableLifecycle?: boolean;
  onDiagnostics?: (diagnostics: ProjectAnalysisRequestDiagnostics) => void;
  now?: Date;
  env?: Record<string, string | undefined>;
}): Promise<ProjectAnalysisResolution> => {
  const resolvedAt = (input.now ?? new Date()).toISOString();
  const access = resolveEnergyAccessContext({
    metadataStore: input.metadataStore,
    user: input.user,
    requestedWorkspaceId: input.workspaceId,
    ...(input.env ? { env: input.env } : {}),
  });
  const accessibleProject = access.projects.find((project) => project.id === input.request.projectId);
  if (!accessibleProject || accessibleProject.workspaceId !== access.activeWorkspaceId) {
    throw new Error("ENERGYIQ_PROJECT_FORBIDDEN");
  }
  const legacyProfile = resolveProjectOverviewProfile(input.metadataStore, input.request.projectId);
  if (!legacyProfile) {
    const context = resolveEnergyQueryContext({
      metadataStore: input.metadataStore,
      user: input.user,
      workspaceId: input.workspaceId,
      request: input.request,
      allowUnconfigured: true,
      ...(input.now ? { now: input.now } : {}),
      ...(input.env ? { env: input.env } : {}),
    });
    return {
      status: "configuration-required",
      context,
      projectId: context.projectId,
      title: "Project analysis is not configured",
      detail: "Publish a Project Template Revision and register its customer Renderer before opening the customer Overview.",
    };
  }
  const publishedRunContext: PublishedRunContext = input.request.analysisWindow === "latest-complete-day"
    || input.request.analysisWindow === "latest-complete-7d"
    || input.request.analysisWindow === "current-project-overview"
    || input.request.analysisWindow === "current-overview-28d"
    || input.request.analysisWindow === "current-month-to-date"
    ? await resolveCurrentProjectOverviewIdentity(input)
    : resolvePublishedEnergyQueryContext({
        metadataStore: input.metadataStore,
        user: input.user,
        workspaceId: input.workspaceId,
        request: input.request,
        ...(input.now ? { now: input.now } : {}),
        ...(input.env ? { env: input.env } : {}),
      });
  const releasedContext = publishedRunContext.context;
  const projectRelease = publishedRunContext.projectRelease;
  if (!projectRelease) throw new Error("ENERGYIQ_PROJECT_RELEASE_REQUIRED");
  const analysisDatabasePath = input.databasePath === ":memory:"
    ? input.databasePath
    : input.databasePath
      ? resolvePath(input.databasePath)
      : resolveEnergyFactStorePath(releasedContext.workspaceId);
  if (analysisDatabasePath !== ":memory:" && !existsSync(analysisDatabasePath)) {
    throw new Error("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
  }
  const cacheKey = createProjectAnalysisCacheKey({
    resolverRevision: PROJECT_ANALYSIS_RESOLVER_REVISION,
    userId: input.user.id,
    workspaceId: releasedContext.workspaceId,
    projectId: releasedContext.projectId,
    scopeId: releasedContext.scopeId,
    resource: releasedContext.resource,
    analysisWindow: input.request.analysisWindow ?? null,
    period: releasedContext.period,
    timezone: releasedContext.timezone,
    from: releasedContext.from,
    to: releasedContext.to,
    dataSnapshotId: releasedContext.dataSnapshotId,
    projectReleaseId: projectRelease.id,
    reportTimePolicyRevisionId: projectRelease.reportTimePolicyRevisionId,
    hierarchyRevisionId: projectRelease.hierarchyRevisionId,
    meterMappingRevisionId: projectRelease.meterMappingRevisionId,
    meterFormulaRevisionId: projectRelease.meterFormulaRevisionId,
    metricVersion: releasedContext.metricVersion,
    businessCalendarVersion: projectRelease.businessCalendarVersion,
    tariffScheduleVersion: projectRelease.tariffScheduleVersion,
    rendererKey: projectRelease.renderer.key,
    rendererVersion: projectRelease.renderer.version,
    rendererContractVersion: projectRelease.renderer.contractVersion,
    recipeId: projectRelease.recipe.id,
    recipeVersion: projectRelease.recipe.version,
    metricRevisionIds: projectRelease.metricRevisionIds,
    ruleRevisionIds: projectRelease.ruleRevisionIds,
    databasePath: analysisDatabasePath,
  });
  let computedForRequest = false;
  const resolution = await projectAnalysisCacheFor(input.metadataStore, input.dataGateway).resolve(
    cacheKey,
    async () => {
      computedForRequest = true;
      await publishedRunContext.validatePinnedOverviewPeriod?.();
      const scopeAnalysis = await executeEnergyScopeAnalysisWithLatestAvailable({
        metadataStore: input.metadataStore,
        dataGateway: input.dataGateway,
        userId: input.user.id,
        context: releasedContext,
        projectReleaseId: projectRelease.id,
        includeTimeBehaviour: projectRelease.renderer.key === "ngee-ann-overview",
        includeMeterOperationalBreakdown: projectRelease.renderer.key !== "preschool-overview",
        ruleRevisions: input.metadataStore.energyIq.rules.listRevisions()
          .filter((rule) => projectRelease.ruleRevisionIds.includes(rule.revision_id)),
        databasePath: analysisDatabasePath,
      });
      const projectRoot = releasedContext.scopeId === input.metadataStore.energyIq
        .getProject(releasedContext.projectId).root_scope_id;
      const preschoolRoot = projectRelease.renderer.key === "preschool-overview" && projectRoot;
      const preschoolLatestCompleteLocalDay = preschoolRoot
        ? await selectPreschoolLatestCompleteLocalDay({
            metadataStore: input.metadataStore,
            dataGateway: input.dataGateway,
            userId: input.user.id,
            context: releasedContext,
            databasePath: analysisDatabasePath,
          })
        : null;
      const preschoolMonthlyOutlookTargetPeriod = preschoolLatestCompleteLocalDay
        ? resolvePreschoolMonthlyTargetPeriod(
            preschoolLatestCompleteLocalDay,
            releasedContext.timezone,
          )
        : null;
      const snapshotContext: ProjectAnalysisSnapshot["context"] = {
        ...releasedContext,
        primaryPeriod: {
          start: releasedContext.from,
          endExclusive: releasedContext.to,
        },
        projectReleaseId: projectRelease.id,
        ...(preschoolRoot ? {
          latestCompleteLocalDay: preschoolLatestCompleteLocalDay,
          monthlyOutlookTargetPeriod: preschoolMonthlyOutlookTargetPeriod,
        } : {}),
      };
      const evidenceMetricIds = [...(
        projectRelease.metricRevisionIds.length > 0
          ? projectRelease.metricRevisionIds
          : [scopeAnalysis.provenance.metricVersion]
      )].sort((left, right) => left.localeCompare(right));
      const metadata = resolveProjectAnalysisMetadata({
        metadataStore: input.metadataStore,
        projectId: releasedContext.projectId,
        hierarchyRevisionId: releasedContext.hierarchyRevisionId,
        timezone: releasedContext.timezone,
        period: snapshotContext.primaryPeriod,
        analysis: scopeAnalysis,
      });
      const analysis = projectAnalysisPayload({ analysis: scopeAnalysis, metadata });
      const decisionPriorities = projectRelease.renderer.key === "ngee-ann-overview"
        ? buildNgeeAnnDecisionPriorities({
            selectedScopeId: releasedContext.scopeId,
            primaryPeriod: snapshotContext.primaryPeriod,
            expectedEvidencePins: {
              projectReleaseId: projectRelease.id,
              dataSnapshotId: analysis.provenance.dataSnapshotId,
              hierarchyRevisionId: projectRelease.hierarchyRevisionId,
              meterMappingRevisionId: projectRelease.meterMappingRevisionId,
              meterFormulaRevisionId: projectRelease.meterFormulaRevisionId,
              metricVersion: releasedContext.metricVersion,
              businessCalendarVersion: projectRelease.businessCalendarVersion,
              queryIds: ["time_slot_anomaly_v1"],
            },
            dailyUsageAnomalies: analysis.dailyUsageAnomalies,
          })
        : undefined;
      const preschoolBenchmark = preschoolRoot
        && hasCompletePreschoolBenchmarkWindow(analysis, releasedContext.scopeId)
          ? resolvePreschoolBenchmarkProjection({
              metadataStore: input.metadataStore,
              projectRelease,
              dataSnapshotId: analysis.provenance.dataSnapshotId,
              period: snapshotContext.primaryPeriod,
              timezone: releasedContext.timezone,
              analysis,
            })
          : undefined;
      const preschoolAppliances = preschoolRoot
          ? buildPreschoolApplianceProjection({
              projectRelease,
              period: snapshotContext.primaryPeriod,
              timezone: releasedContext.timezone,
              analysis,
            })
          : undefined;
      let preschoolPlanningAnalysis: ProjectAnalysisPayload | undefined;
      if (
        preschoolRoot
        && preschoolMonthlyOutlookTargetPeriod
        && analysis.offHours.status === "available"
      ) {
        try {
          const planningSourcePeriod = resolvePreschoolPlanningSourcePeriod(
            preschoolMonthlyOutlookTargetPeriod,
          );
          const planningContext = buildPreschoolMonthlyActualContext(
            releasedContext,
            planningSourcePeriod,
          );
          const planningScopeAnalysis = await executeEnergyScopeAnalysis({
            metadataStore: input.metadataStore,
            dataGateway: input.dataGateway,
            userId: input.user.id,
            context: planningContext,
            projectReleaseId: projectRelease.id,
            ruleRevisions: [],
            includeTimeBehaviour: false,
            includeMeterOperationalBreakdown: false,
            includeImmediateChildDailyTotals: true,
            profile: "explorer",
            databasePath: analysisDatabasePath,
          });
          preschoolPlanningAnalysis = projectAnalysisPayload({
            analysis: planningScopeAnalysis,
            metadata: resolveProjectAnalysisMetadata({
              metadataStore: input.metadataStore,
              projectId: planningContext.projectId,
              hierarchyRevisionId: planningContext.hierarchyRevisionId,
              timezone: planningContext.timezone,
              period: { start: planningContext.from, endExclusive: planningContext.to },
              analysis: planningScopeAnalysis,
            }),
          });
        } catch {
          // Planning is an independent deterministic projection. Missing
          // source weeks must not suppress Sections 3/4.
          preschoolPlanningAnalysis = undefined;
        }
      }
      const preschoolOperational = preschoolRoot
          ? await loadPreschoolOperationalProjection({
              metadataStore: input.metadataStore,
              dataGateway: input.dataGateway,
              userId: input.user.id,
              projectRelease,
              context: releasedContext,
              analysis,
              ...(preschoolPlanningAnalysis ? { planningAnalysis: preschoolPlanningAnalysis } : {}),
              ...(preschoolMonthlyOutlookTargetPeriod
                ? { planningTargetPeriod: preschoolMonthlyOutlookTargetPeriod }
                : {}),
              databasePath: analysisDatabasePath,
            })
          : undefined;
      const preschoolDecisionSignals = preschoolRoot
          ? buildPreschoolDecisionSignals({
              projectReleaseId: projectRelease.id,
              dataSnapshotId: analysis.provenance.dataSnapshotId,
              period: {
                ...snapshotContext.primaryPeriod,
                timezone: releasedContext.timezone,
              },
              dataQualityStatus: analysis.dataHealth.status,
              totalCentreCount: analysis.childScopes.length,
              ...(preschoolBenchmark ? { benchmark: preschoolBenchmark } : {}),
              ...(preschoolOperational ? { operational: preschoolOperational } : {}),
            })
          : undefined;
      const latestAvailablePeriod = scopeAnalysis.latestAvailablePeriod ?? null;
      const sourceCoverage = resolveDataSnapshotSourceCoverage({
        metadataStore: input.metadataStore,
        workspaceId: releasedContext.workspaceId,
        projectId: releasedContext.projectId,
        dataSnapshotId: analysis.provenance.dataSnapshotId,
      });
      const reportTimeContext = resolveSnapshotReportTimeContext({
        metadataStore: input.metadataStore,
        projectRelease,
        context: releasedContext,
        dataSnapshotId: analysis.provenance.dataSnapshotId,
        acceptedDataEndExclusive: snapshotContext.primaryPeriod.endExclusive,
        resolvedAt,
      });
      const sectionManifest = projectRelease.renderer.key === "ngee-ann-overview"
        ? resolveNgeeAnnSectionManifestForRelease(input.metadataStore, projectRelease.id)
        : undefined;
      const schoolHolidayWindow = reportTimeContext?.windows.find(
        ({ windowId }) => windowId === NGEE_ANN_SCHOOL_HOLIDAY_SECTION_ID,
      );
      const schoolHolidayComparison = sectionManifest?.enabledSectionIds
        .includes(NGEE_ANN_SCHOOL_HOLIDAY_SECTION_ID)
        && projectRoot
        && schoolHolidayWindow
        ? await resolveNgeeAnnSchoolHolidayComparison({
            metadataStore: input.metadataStore,
            dataGateway: input.dataGateway,
            userId: input.user.id,
            context: releasedContext,
            projectRelease,
            reportWindow: schoolHolidayWindow,
            reportTimePolicyRevision: `${reportTimeContext!.policyId}@${reportTimeContext!.policyRevision}`,
            databasePath: analysisDatabasePath,
          })
        : undefined;
      const reportWindowAnalyses = reportTimeContext && projectRoot
        ? await materializeReportWindowAnalyses({
            metadataStore: input.metadataStore,
            dataGateway: input.dataGateway,
            userId: input.user.id,
            projectRelease,
            releasedContext,
            primaryPeriod: snapshotContext.primaryPeriod,
            primaryAnalysis: analysis,
            reportTimeContext,
            databasePath: analysisDatabasePath,
          })
        : undefined;
      const reportWindowSegmentSummaries = reportTimeContext && projectRoot
        ? await materializeReportWindowSegmentSummaries({
            metadataStore: input.metadataStore,
            dataGateway: input.dataGateway,
            userId: input.user.id,
            projectRelease,
            releasedContext,
            reportTimeContext,
            databasePath: analysisDatabasePath,
          })
        : undefined;
      const meterDataHealth = projectRendererIncludesMeterDataHealth(projectRelease.renderer.key)
        ? await readEnergyMeterDataHealth({
          metadataStore: input.metadataStore,
          workspaceId: releasedContext.workspaceId,
          projectId: releasedContext.projectId,
          dataSnapshotId: analysis.provenance.dataSnapshotId,
          resource: releasedContext.resource,
          meterPoints: resolveEnergyPublishedMeterPoints({
            metadataStore: input.metadataStore,
            projectId: releasedContext.projectId,
            hierarchyRevisionId: projectRelease.hierarchyRevisionId,
            resource: releasedContext.resource,
          }),
          databasePath: analysisDatabasePath,
        })
        : undefined;
      const meterDataHealthSummary = meterDataHealth?.reduce((summary, meterPoint) => {
        if (meterPoint.status === "usable") summary.usable += 1;
        else if (meterPoint.status === "insufficient_history") summary.insufficientHistory += 1;
        else summary.noReadings += 1;
        return summary;
      }, {
        total: meterDataHealth.length,
        usable: 0,
        insufficientHistory: 0,
        noReadings: 0,
      });
      return {
        status: "ready",
        snapshot: {
          context: snapshotContext,
          projectRelease,
          ...(reportTimeContext ? { reportTimeContext } : {}),
          ...(reportWindowAnalyses ? { reportWindowAnalyses } : {}),
          ...(reportWindowSegmentSummaries?.length
            ? { reportWindowSegmentSummaries }
            : {}),
          recipe: projectRelease.recipe,
          renderer: projectRelease.renderer,
          dataQuality: analysis.dataHealth,
          ...(meterDataHealth && meterDataHealthSummary ? {
            meterDataHealth: { summary: meterDataHealthSummary, meters: meterDataHealth },
          } : {}),
          evidence: evidenceMetricIds.map((metricId) => ({
            id: [
              "evidence",
              analysis.provenance.dataSnapshotId,
              releasedContext.scopeId,
              releasedContext.from,
              releasedContext.to,
              metricId,
            ].join(":"),
            metricId,
            queryIds: [...analysis.provenance.queryIds],
          })),
          findings: analysis.attention,
          ...(sectionManifest ? { sectionManifest } : {}),
          ...(schoolHolidayComparison ? { schoolHolidayComparison } : {}),
          ...(decisionPriorities ? { decisionPriorities } : {}),
          ...(preschoolBenchmark ? { preschoolBenchmark } : {}),
          ...(preschoolAppliances ? { preschoolAppliances } : {}),
          ...(preschoolOperational ? { preschoolOperational } : {}),
          ...(preschoolDecisionSignals ? { preschoolDecisionSignals } : {}),
          dataSnapshot: {
            id: analysis.provenance.dataSnapshotId,
            importBatchIds: analysis.dataHealth.importBatchIds,
            lastSeenAt: analysis.dataHealth.lastSeenAt ?? null,
            ...(sourceCoverage ? { sourceCoverage } : {}),
          },
          ...(latestAvailablePeriod ? { latestAvailablePeriod } : {}),
          metadata,
          analysis,
        },
      };
    },
    {
      bypass: input.bypassCache === true || analysisDatabasePath === ":memory:",
      ...(analysisDatabasePath !== ":memory:" ? {
        persistentDirectory: join(dirname(analysisDatabasePath), "project-analysis-cache"),
      } : {}),
    },
  );
  input.onDiagnostics?.({
    cacheStatus: computedForRequest ? "computed" : "reused",
    evidenceQueryCount: resolution.snapshot.analysis.provenance.queryIds.length,
  });
  if (input.includeMutableLifecycle === false) return resolution;
  return attachMutableProjectAnalysisLifecycle({
    metadataStore: input.metadataStore,
    dataGateway: input.dataGateway,
    user: input.user,
    resolution,
    databasePath: analysisDatabasePath,
    bypassCache: input.bypassCache === true,
  });
};

const attachMutableProjectAnalysisLifecycle = async (input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  user: UserRecord;
  resolution: ReadyProjectAnalysisResolution;
  databasePath: string;
  bypassCache?: boolean;
  savedAnalyses?: readonly EnergyIqSavedAnalysisRecord[];
}): Promise<ReadyProjectAnalysisResolution> => {
  const { resolution } = input;
  const releasedContext = resolution.snapshot.context;
  const projectRelease = resolution.snapshot.projectRelease;
  if (
    resolution.snapshot.renderer.key === "preschool-overview"
    && resolution.snapshot.context.resource === "electricity"
    && resolution.snapshot.context.scopeId === input.metadataStore.energyIq
      .getProject(resolution.snapshot.context.projectId).root_scope_id
  ) {
    const latestCompleteLocalDay = resolution.snapshot.context.latestCompleteLocalDay;
    const savedAnalyses = input.savedAnalyses
      ?? input.metadataStore.energyIq.savedAnalyses.listProject(releasedContext.projectId);
    const lifecycleCacheKey = JSON.stringify({
      contract: "preschool-planning-lifecycle-cache@1",
      userId: input.user.id,
      workspaceId: releasedContext.workspaceId,
      projectId: releasedContext.projectId,
      scopeId: releasedContext.scopeId,
      dataSnapshotId: releasedContext.dataSnapshotId,
      projectReleaseId: projectRelease.id,
      templateRevisionId: projectRelease.templateRevisionId,
      latestCompleteLocalDay,
      databasePath: input.databasePath,
      savedAnalyses: savedAnalyses.map((saved) => ({
        id: saved.id,
        sequence: saved.sequence,
        dataSnapshotId: saved.data_snapshot_id,
        templateRevisionId: saved.template_revision_id,
        createdAt: saved.created_at,
      })),
    });
    const preschoolPlanningLifecycle = latestCompleteLocalDay
      ? await projectPlanningLifecycleCacheFor(input.metadataStore, input.dataGateway).resolve(
        lifecycleCacheKey,
        () => loadPreschoolPlanningLifecycle({
          metadataStore: input.metadataStore,
          dataGateway: input.dataGateway,
          userId: input.user.id,
          context: releasedContext,
          projectRelease,
          latestCompleteLocalDay,
          savedAnalyses,
          databasePath: input.databasePath,
        }),
        { bypass: input.bypassCache === true || input.databasePath === ":memory:" },
      )
      : undefined;
    return {
      ...resolution,
      snapshot: {
        ...resolution.snapshot,
        ...(preschoolPlanningLifecycle ? { preschoolPlanningLifecycle } : {}),
      },
    };
  }
  if (resolution.snapshot.renderer.key !== "ngee-ann-overview"
    || !resolution.snapshot.decisionPriorities) return resolution;
  const decisionLifecycle = buildNgeeAnnDecisionLifecycle({
    projectId: resolution.snapshot.context.projectId,
    workspaceId: resolution.snapshot.context.workspaceId,
    scopeId: resolution.snapshot.context.scopeId,
    resource: "electricity",
    templateRevisionId: resolution.snapshot.projectRelease.templateRevisionId,
    currentDataSnapshotId: resolution.snapshot.dataSnapshot.id,
    currentPriorities: resolution.snapshot.decisionPriorities,
    currentDailyUsageAnomalies: resolution.snapshot.analysis.dailyUsageAnomalies,
    savedAnalyses: input.savedAnalyses
      ?? input.metadataStore.energyIq.savedAnalyses.listProject(resolution.snapshot.context.projectId),
  });
  return {
    ...resolution,
    snapshot: {
      ...resolution.snapshot,
      decisionLifecycle,
    },
  };
};

const materializeReportWindowAnalyses = async (input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  userId: string;
  projectRelease: PublishedProjectRelease;
  releasedContext: EnergyQueryContext;
  primaryPeriod: ProjectAnalysisSnapshot["context"]["primaryPeriod"];
  primaryAnalysis: ProjectAnalysisPayload;
  reportTimeContext: ReportTimeContext;
  databasePath: string;
}): Promise<ProjectReportWindowAnalysis[]> => Promise.all(input.reportTimeContext.windows
  .filter((window) => (
    window.windowId !== NGEE_ANN_SCHOOL_HOLIDAY_SECTION_ID
    && (
      window.strategy.kind === "calendar_month_to_date"
      || window.strategy.kind === "rolling_complete_days"
      || (
        input.projectRelease.renderer.key === "ngee-ann-overview"
        && window.strategy.kind === "same_day_type_baseline"
      )
    )
  ))
  .map(async (window): Promise<ProjectReportWindowAnalysis> => {
    const period = {
      start: window.from,
      endExclusive: window.toExclusive,
    };
    if (
      period.start === input.primaryPeriod.start
      && period.endExclusive === input.primaryPeriod.endExclusive
    ) {
      return {
        windowId: window.windowId,
        period,
        status: "ready",
        analysis: reportWindowAnalysisProjection(input.primaryAnalysis, "summary"),
      };
    }
    const context: EnergyQueryContext = {
      ...input.releasedContext,
      period: "Custom",
      from: period.start,
      to: period.endExclusive,
    };
    if (window.strategy.kind === "same_day_type_baseline") {
      return {
        windowId: window.windowId,
        period,
        status: "ready",
        analysis: await executeEnergyDayProfileProjection({
          metadataStore: input.metadataStore,
          dataGateway: input.dataGateway,
          userId: input.userId,
          context,
          databasePath: input.databasePath,
        }),
      };
    }
    const scopeAnalysis = await executeEnergyScopeAnalysis({
      metadataStore: input.metadataStore,
      dataGateway: input.dataGateway,
      userId: input.userId,
      context,
      projectReleaseId: input.projectRelease.id,
      includeTimeBehaviour: input.projectRelease.renderer.key === "ngee-ann-overview",
      includeMeterOperationalBreakdown: input.projectRelease.renderer.key !== "preschool-overview",
      ruleRevisions: [],
      databasePath: input.databasePath,
    });
    const analysis = projectAnalysisPayload({
      analysis: scopeAnalysis,
      metadata: resolveProjectAnalysisMetadata({
        metadataStore: input.metadataStore,
        projectId: context.projectId,
        hierarchyRevisionId: context.hierarchyRevisionId,
        timezone: context.timezone,
        period,
        analysis: scopeAnalysis,
      }),
    });
    return {
      windowId: window.windowId,
      period,
      status: "ready",
      analysis: reportWindowAnalysisProjection(analysis, "full-hourly"),
    };
  }));

const reportWindowAnalysisProjection = (
  analysis: ProjectAnalysisPayload,
  mode: "summary" | "full-hourly",
): ProjectReportWindowAnalysis["analysis"] => ({
  summary: analysis.summary,
  offHours: analysis.offHours,
  ...(analysis.dailyTotals ? { dailyTotals: analysis.dailyTotals } : {}),
  ...(mode === "full-hourly" && analysis.timeBehaviour
    ? { timeBehaviour: analysis.timeBehaviour }
    : {}),
  ...(mode === "full-hourly" && analysis.componentHourlyProfiles
    ? { componentHourlyProfiles: analysis.componentHourlyProfiles }
    : {}),
  ...(mode === "full-hourly" ? {
    composition: {
      provenance: analysis.provenance,
      comparison: analysis.comparison,
      categories: analysis.categories,
      childScopes: analysis.childScopes,
      circuits: analysis.circuits,
      designatedTotals: analysis.designatedTotals,
      componentReconciliation: analysis.componentReconciliation,
      ...(analysis.virtualMeterTraces ? { virtualMeterTraces: analysis.virtualMeterTraces } : {}),
    },
  } : {}),
});

const materializeReportWindowSegmentSummaries = async (input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  userId: string;
  projectRelease: PublishedProjectRelease;
  releasedContext: EnergyQueryContext;
  reportTimeContext: ReportTimeContext;
  databasePath: string;
}): Promise<ProjectReportWindowSegmentSummary[]> => {
  const windows = input.reportTimeContext.windows.filter((window) => (
    window.strategy.kind === "completed_calendar_months"
    || window.strategy.kind === "prior_equivalent_progress"
  ));
  const allSegments = windows.flatMap((window) => window.segments);
  if (allSegments.length === 0) return [];

  const context: EnergyQueryContext = {
    ...input.releasedContext,
    period: "Custom",
    from: allSegments.reduce(
      (earliest, segment) => segment.from < earliest ? segment.from : earliest,
      allSegments[0]!.from,
    ),
    to: allSegments.reduce(
      (latest, segment) => segment.toExclusive > latest ? segment.toExclusive : latest,
      allSegments[0]!.toExclusive,
    ),
  };
  const projection = await executeEnergyDailyTotalsProjection({
    metadataStore: input.metadataStore,
    dataGateway: input.dataGateway,
    userId: input.userId,
    context,
    databasePath: input.databasePath,
  });
  const selectedScopeRows = projection.dailyTotals.scopes.find(
    (scope) => scope.scopeId === input.releasedContext.scopeId,
  )?.rows ?? [];

  return windows.map((window) => ({
    windowId: window.windowId,
    status: "ready" as const,
    segments: [...window.segments]
      .sort((left, right) => left.from.localeCompare(right.from))
      .map((segment) => {
        const expectedDayCount = reportTimePeriodDayCount(
          segment,
          input.reportTimeContext.timezone,
        );
        const rows = selectedScopeRows.filter((row) => (
          row.from >= segment.from && row.to <= segment.toExclusive
        ));
        const completeRows = rows.filter((row) => (
          row.dataHealth.status === "complete" || row.dataHealth.aggregateStatus === "complete"
        ));
        const availableRows = rows.filter((row) => row.usageKwh !== null);
        const dataStatus = completeRows.length === expectedDayCount
          ? "complete" as const
          : availableRows.length === 0
            ? "unavailable" as const
            : "partial" as const;
        const usageKwh = completeRows.reduce((sum, row) => sum + (row.usageKwh ?? 0), 0);
        return {
          period: {
            start: segment.from,
            endExclusive: segment.toExclusive,
          },
          dataStatus,
          expectedDayCount,
          completeDayCount: completeRows.length,
          summary: dataStatus === "complete" ? {
            usageKwh: roundReportValue(usageKwh),
            averageDailyUsageKwh: roundReportValue(usageKwh / expectedDayCount),
          } : null,
          evidence: {
            dataSnapshotId: projection.provenance.dataSnapshotId,
            queryId: projection.provenance.queryId,
          },
        };
      }),
  }));
};

const roundReportValue = (value: number): number => Math.round(value * 10_000) / 10_000;

export const resolveSnapshotReportTimePolicy = (input: {
  metadataStore: MetadataStore;
  projectRelease: PublishedProjectRelease;
}): ReportTimePolicyRevision | null => {
  const definition = input.projectRelease.templateRevisionId
    ? input.metadataStore.energyIq.overviewDefinitions.get(input.projectRelease.templateRevisionId)
    : null;
  if (definition && definition.renderer_key !== input.projectRelease.renderer.key) {
    throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_RENDERER_MISMATCH");
  }
  if (definition
    && definition.time_policy_revision_id !== input.projectRelease.reportTimePolicyRevisionId) {
    throw new Error("ENERGYIQ_REPORT_TIME_POLICY_RELEASE_MISMATCH");
  }
  const policyRecord = input.metadataStore.energyIq.reportTimePolicies.get(
    input.projectRelease.projectId,
    input.projectRelease.reportTimePolicyRevisionId,
  );
  if (!policyRecord) {
    throw new Error("ENERGYIQ_REPORT_TIME_POLICY_NOT_FOUND");
  }
  return policyRecord?.policy ?? null;
};

export const resolveSnapshotReportTimeContext = (input: {
  metadataStore: MetadataStore;
  projectRelease: PublishedProjectRelease;
  context: EnergyQueryContext;
  dataSnapshotId: string;
  acceptedDataEndExclusive: string;
  resolvedAt: string;
}): ReportTimeContext | undefined => {
  const policy = resolveSnapshotReportTimePolicy({
    metadataStore: input.metadataStore,
    projectRelease: input.projectRelease,
  });
  return policy
    ? resolveReportTimeContext({
        binding: {
          workspaceId: input.context.workspaceId,
          projectId: input.context.projectId,
          scopeId: input.context.scopeId,
          resource: input.context.resource,
          dataSnapshotId: input.dataSnapshotId,
          projectReleaseId: input.projectRelease.id,
        },
        timezone: input.context.timezone,
        asOf: input.resolvedAt,
        acceptedDataEndExclusive: input.acceptedDataEndExclusive,
        lastRefreshedAt: input.resolvedAt,
        policy,
      })
    : undefined;
};

export type OverviewContextPackage = {
  contract: "energyiq-overview-context-package@1";
  projectionRef: string;
  identity: ProjectOverviewProjectionIdentity;
  snapshot: ProjectAnalysisSnapshot;
  evidenceRefs: string[];
};

export type AnalysisContextPackage = {
  contract: "energyiq-analysis-context-package@1";
  projectionRef: string;
  identity: ProjectOverviewProjectionIdentity;
  snapshot: ProjectAnalysisSnapshot;
  evidenceRefs: string[];
};

export type ProjectAnalysisContextPackagePrewarmResult =
  | {
      status: "materialized" | "unchanged";
      resolution: ReadyProjectAnalysisResolution;
      contextPackage: AnalysisContextPackage;
    }
  | {
      status: "not_ready";
      reason: string;
      attempt: ProjectAnalysisContextPrewarmAttempt;
    };

export type ProjectAnalysisContextPrewarmAttempt = {
  contract: "energyiq-analysis-context-prewarm-attempt@1";
  outcome: "not_ready";
  identity: SafeProjectAnalysisIdentity | null;
  target: {
    pointer: string;
    workspaceId: string;
    projectId: string;
    scopeId: string;
    resource: "electricity" | "water";
    analysisWindow: "all-available";
  };
  priorReady: SafeProjectAnalysisProjectionReference | null;
};

export type SafeProjectAnalysisIdentity = Omit<ProjectOverviewProjectionIdentity, "databasePath"> & {
  fingerprint: string;
};

export type SafeProjectAnalysisProjectionReference = {
  projectionRef: string;
  identity: SafeProjectAnalysisIdentity;
};

export type ProjectAnalysisContextPrewarmOperationalEvent = {
  contract: "energyiq-analysis-context-prewarm-operation@1";
  recordedAt: string;
  trigger: "admin" | "import" | "tuya" | "publish" | "tariff" | "calendar" | "manual";
  outcome: "materialized" | "unchanged" | "not_ready" | "failed";
  reasonCode?: string;
  target: ProjectAnalysisContextPrewarmAttempt["target"];
  attemptedIdentity: SafeProjectAnalysisIdentity | null;
  priorReady: SafeProjectAnalysisProjectionReference | null;
  projectionRef?: string;
};

export type ProjectOverviewLifecycle = {
  contract: "energyiq-overview-lifecycle@1";
  projectionRef: string;
  observedAt: string;
  inputFingerprint: string;
  decisionLifecycle?: NgeeAnnDecisionLifecycle;
  preschoolPlanningLifecycle?: PreschoolPlanningLifecycle;
};

export const materializeCurrentProjectOverviewProjection = async (input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  user: UserRecord;
  workspaceId: string;
  projectId: string;
  databasePath?: string;
  now?: Date;
  env?: Record<string, string | undefined>;
  forceRecompute?: boolean;
  beforePublish?: (publication: ProjectOverviewPointerPublication) => Promise<void>;
}): Promise<{
  changed: boolean;
  resolution: ReadyProjectAnalysisResolution;
  contextPackage: OverviewContextPackage;
}> => {
  const request: EnergyQueryContextRequest = {
    projectId: input.projectId,
    scopeId: "project",
    resource: "electricity",
    analysisWindow: "current-project-overview",
  };
  const resolveCandidate = async () => {
    const publishedRun = await resolveCurrentProjectOverviewIdentity({
      metadataStore: input.metadataStore,
      dataGateway: input.dataGateway,
      user: input.user,
      workspaceId: input.workspaceId,
      request,
      ...(input.databasePath ? { databasePath: input.databasePath } : {}),
      ...(input.now ? { now: input.now } : {}),
      ...(input.env ? { env: input.env } : {}),
    });
    if (!publishedRun.projectRelease) throw new Error("ENERGYIQ_PROJECT_RELEASE_REQUIRED");
    const databasePath = resolveProjectAnalysisDatabasePath({
      workspaceId: publishedRun.context.workspaceId,
      ...(input.databasePath ? { databasePath: input.databasePath } : {}),
    });
    return {
      publishedRun,
      databasePath,
      identity: projectAnalysisProjectionIdentity({
        metadataStore: input.metadataStore,
        context: publishedRun.context,
        projectRelease: publishedRun.projectRelease,
        databasePath,
        analysisWindow: "current-project-overview",
      }),
    };
  };
  const candidate = await resolveCandidate();
  const { databasePath, identity } = candidate;
  const projectionKey = createProjectOverviewProjectionKey(identity);
  const pointerKey = currentOverviewProjectionPointerKey(identity.workspaceId, identity.projectId);
  const persistentDirectory = projectAnalysisPersistentDirectory(databasePath);
  const materialized = await projectAnalysisCacheFor(input.metadataStore, input.dataGateway)
    .materializeCurrent({
      pointerKey,
      projectionKey,
      identity,
      persistentDirectory,
      compute: async () => {
        const resolution = await resolveProjectAnalysis({
          metadataStore: input.metadataStore,
          dataGateway: input.dataGateway,
          user: input.user,
          workspaceId: input.workspaceId,
          request,
          databasePath,
          bypassCache: input.forceRecompute === true,
          includeMutableLifecycle: false,
          ...(input.now ? { now: input.now } : {}),
          ...(input.env ? { env: input.env } : {}),
        });
        if (resolution.status !== "ready") {
          throw new Error("ENERGYIQ_OVERVIEW_PROJECTION_NOT_READY");
        }
        if (resolution.snapshot.sectionManifest?.enabledSectionIds
          .includes(NGEE_ANN_SCHOOL_HOLIDAY_SECTION_ID)) {
          const holiday = resolution.snapshot.schoolHolidayComparison;
          if (!holiday || (holiday.status === "unavailable"
            && (holiday.reason.code === "FACT_QUERY_FAILED"
              || holiday.reason.code === "FACT_INVALID"))) {
            throw new Error("ENERGYIQ_SCHOOL_HOLIDAY_PROJECTION_NOT_READY");
          }
        }
        return rebindManagedProjectionActor(resolution, MANAGED_OVERVIEW_SYSTEM_ACTOR_ID);
      },
      validate: (resolution, candidateIdentity) => managedProjectionMatchesIdentity(
        input.metadataStore,
        resolution,
        candidateIdentity,
      ),
      equivalent: managedProjectionFactsEquivalent,
      forceRecompute: input.forceRecompute === true,
      validateBeforePublish: async () => {
        const latest = await resolveCandidate();
        return createProjectOverviewProjectionKey(latest.identity) === projectionKey;
      },
      ...(input.beforePublish ? {
        beforePublish: async (publication) => input.beforePublish!({
          persistentDirectory,
          pointerKey,
          ...publication,
        }),
      } : {}),
    });
  const resolution = materialized.value;
  return {
    changed: materialized.changed,
    resolution,
    contextPackage: toOverviewContextPackage(identity, resolution.snapshot),
  };
};

/**
 * Persist one immutable AI analysis package under its complete released
 * identity. The package is a projection of the existing ProjectAnalysis
 * result; this function never owns or repeats metric calculation.
 */
export const materializeProjectAnalysisContextPackage = async (input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  context: EnergyQueryContext;
  projectRelease: PublishedProjectRelease;
  analysisWindow: NonNullable<EnergyQueryContextRequest["analysisWindow"]> | null;
  resolution: ReadyProjectAnalysisResolution;
  databasePath?: string;
}): Promise<{
  changed: boolean;
  resolution: ReadyProjectAnalysisResolution;
  contextPackage: AnalysisContextPackage;
}> => {
  const databasePath = resolveProjectAnalysisDatabasePath({
    workspaceId: input.context.workspaceId,
    ...(input.databasePath ? { databasePath: input.databasePath } : {}),
  });
  const identity = projectAnalysisProjectionIdentity({
    metadataStore: input.metadataStore,
    context: input.context,
    projectRelease: input.projectRelease,
    databasePath,
    analysisWindow: input.analysisWindow,
  });
  return materializeProjectAnalysisContextPackageWithCompute({
    metadataStore: input.metadataStore,
    dataGateway: input.dataGateway,
    identity,
    projectRelease: input.projectRelease,
    databasePath,
    compute: async () => input.resolution,
  });
};

/**
 * Resolve and prewarm the current all-available AI package. The complete
 * ProjectAnalysis calculation runs inside the existing cross-process
 * materialization lock, so concurrent scheduler/import triggers compute once.
 */
export const prewarmProjectAnalysisContextPackage = async (input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  user: UserRecord;
  workspaceId: string;
  projectId: string;
  scopeId?: string;
  resource?: "electricity" | "water";
  databasePath?: string;
  now?: Date;
  env?: Record<string, string | undefined>;
  trigger?: ProjectAnalysisContextPrewarmOperationalEvent["trigger"];
  operationalNow?: () => Date;
  resolvePublishedIdentity?: typeof resolveAllAvailableProjectAnalysisIdentity;
  resolveAnalysis?: typeof resolveProjectAnalysis;
  operationalLog?: (event: ProjectAnalysisContextPrewarmOperationalEvent) => void;
}): Promise<ProjectAnalysisContextPackagePrewarmResult> => {
  const access = resolveEnergyAccessContext({
    metadataStore: input.metadataStore,
    user: input.user,
    requestedWorkspaceId: input.workspaceId,
    rolePersistence: "read-only",
    ...(input.env ? { env: input.env } : {}),
  });
  const accessibleProject = access.projects.find((candidate) => candidate.id === input.projectId);
  if (!accessibleProject || accessibleProject.workspaceId !== access.activeWorkspaceId) {
    throw new Error("ENERGYIQ_PROJECT_FORBIDDEN");
  }
  const attemptedProject = input.metadataStore.energyIq.getProject(input.projectId);
  const target = {
    pointer: [
      attemptedProject.workspace_id,
      attemptedProject.id,
      input.scopeId ?? attemptedProject.root_scope_id,
      input.resource ?? "electricity",
    ].join(":"),
    workspaceId: attemptedProject.workspace_id,
    projectId: attemptedProject.id,
    scopeId: input.scopeId ?? attemptedProject.root_scope_id,
    resource: input.resource ?? "electricity",
    analysisWindow: "all-available",
  } as const;
  const outcomePointerKey = analysisContextPrewarmOutcomePointerKey({
    workspaceId: attemptedProject.workspace_id,
    projectId: attemptedProject.id,
    scopeId: input.scopeId ?? "project",
    resource: input.resource ?? "electricity",
    analysisWindow: "all-available",
  });
  const outcomeDirectory = projectAnalysisPersistentDirectory(
    resolveProjectAnalysisDatabasePath({
      workspaceId: input.workspaceId,
      ...(input.databasePath ? { databasePath: input.databasePath } : {}),
    }),
  );
  const log = input.operationalLog ?? ((event: ProjectAnalysisContextPrewarmOperationalEvent) => {
    console.info("[energyiq] analysis_context_prewarm", JSON.stringify(event));
  });
  let priorReady: SafeProjectAnalysisProjectionReference | null = null;
  try {
    priorReady = await readSafePriorReadyProjection(input);
  } catch (error) {
    const failedEvent: ProjectAnalysisContextPrewarmOperationalEvent = {
      contract: "energyiq-analysis-context-prewarm-operation@1",
      recordedAt: (input.operationalNow?.() ?? new Date()).toISOString(),
      trigger: input.trigger ?? "manual",
      outcome: "failed",
      reasonCode: "UNEXPECTED_ERROR",
      target,
      attemptedIdentity: null,
      priorReady: null,
    };
    await writeProjectAnalysisPrewarmOutcomeSidecar({
      directory: outcomeDirectory,
      pointerKey: outcomePointerKey,
      value: failedEvent,
    });
    log(failedEvent);
    throw error;
  }
  let attemptedIdentity: ProjectOverviewProjectionIdentity | undefined;
  const attempt = (): ProjectAnalysisContextPrewarmAttempt => ({
    contract: "energyiq-analysis-context-prewarm-attempt@1",
    outcome: "not_ready",
    identity: attemptedIdentity ? toSafeProjectAnalysisIdentity(attemptedIdentity) : null,
    target,
    priorReady,
  });
  const record = async (
    outcome: ProjectAnalysisContextPrewarmOperationalEvent["outcome"],
    details: { reasonCode?: string; projectionRef?: string } = {},
  ) => {
    const event: ProjectAnalysisContextPrewarmOperationalEvent = {
      contract: "energyiq-analysis-context-prewarm-operation@1",
      recordedAt: (input.operationalNow?.() ?? new Date()).toISOString(),
      trigger: input.trigger ?? "manual",
      outcome,
      ...(details.reasonCode ? { reasonCode: details.reasonCode } : {}),
      target,
      attemptedIdentity: attemptedIdentity ? toSafeProjectAnalysisIdentity(attemptedIdentity) : null,
      priorReady,
      ...(details.projectionRef ? { projectionRef: details.projectionRef } : {}),
    };
    if (outcome !== "unchanged") {
      await writeProjectAnalysisPrewarmOutcomeSidecar({
        directory: outcomeDirectory,
        pointerKey: outcomePointerKey,
        value: event,
      });
    }
    log(event);
  };
  try {
    const publishedRun = await (input.resolvePublishedIdentity
      ?? resolveAllAvailableProjectAnalysisIdentity)({
      metadataStore: input.metadataStore,
      dataGateway: input.dataGateway,
      user: input.user,
      workspaceId: input.workspaceId,
      request: {
        projectId: input.projectId,
        scopeId: input.scopeId ?? "project",
        resource: input.resource ?? "electricity",
        analysisWindow: "all-available",
      },
      ...(input.databasePath ? { databasePath: input.databasePath } : {}),
      ...(input.now ? { now: input.now } : {}),
      ...(input.env ? { env: input.env } : {}),
      requireProjectRelease: true,
    });
    const projectRelease = publishedRun.projectRelease;
    if (!projectRelease) {
      await record("not_ready", { reasonCode: "ENERGYIQ_PROJECT_RELEASE_REQUIRED" });
      return { status: "not_ready", reason: "ENERGYIQ_PROJECT_RELEASE_REQUIRED", attempt: attempt() };
    }
    const databasePath = resolveProjectAnalysisDatabasePath({
      workspaceId: publishedRun.context.workspaceId,
      ...(input.databasePath ? { databasePath: input.databasePath } : {}),
    });
    const identity = projectAnalysisProjectionIdentity({
      metadataStore: input.metadataStore,
      context: publishedRun.context,
      projectRelease,
      databasePath,
      analysisWindow: "all-available",
    });
    attemptedIdentity = identity;
    const materialized = await materializeProjectAnalysisContextPackageWithCompute({
      metadataStore: input.metadataStore,
      dataGateway: input.dataGateway,
      identity,
      projectRelease,
      databasePath,
      latestPointerKey: analysisContextPackageLatestPointerKey({
        workspaceId: attemptedProject.workspace_id,
        projectId: attemptedProject.id,
        scopeId: input.scopeId ?? "project",
        resource: input.resource ?? "electricity",
        analysisWindow: "all-available",
      }),
      compute: async () => {
        const resolution = await (input.resolveAnalysis ?? resolveProjectAnalysis)({
          metadataStore: input.metadataStore,
          dataGateway: input.dataGateway,
          user: input.user,
          workspaceId: input.workspaceId,
          request: {
            projectId: publishedRun.context.projectId,
            scopeId: publishedRun.context.scopeId,
            resource: publishedRun.context.resource,
            period: "Custom",
            from: publishedRun.context.from,
            to: publishedRun.context.to,
            expectedDataSnapshotId: publishedRun.context.dataSnapshotId,
            expectedProjectReleaseId: projectRelease.id,
            expectedHierarchyRevisionId: publishedRun.context.hierarchyRevisionId,
            expectedMeterMappingRevisionId: publishedRun.context.meterMappingRevisionId,
            expectedMeterFormulaRevisionId: publishedRun.context.meterFormulaRevisionId,
          },
          databasePath,
          includeMutableLifecycle: false,
          ...(input.now ? { now: input.now } : {}),
          ...(input.env ? { env: input.env } : {}),
        });
        if (resolution.status !== "ready") {
          throw new Error("ENERGYIQ_ANALYSIS_CONTEXT_PACKAGE_NOT_READY");
        }
        return resolution;
      },
    });
    const result = {
      status: materialized.changed ? "materialized" : "unchanged",
      resolution: materialized.resolution,
      contextPackage: materialized.contextPackage,
    } as const;
    await record(result.status, { projectionRef: result.contextPackage.projectionRef });
    return result;
  } catch (error) {
    if (error instanceof Error && isPrewarmNotReadyError(error.message)) {
      await record("not_ready", { reasonCode: safePrewarmReasonCode(error.message) });
      return { status: "not_ready", reason: error.message, attempt: attempt() };
    }
    await record("failed", { reasonCode: "UNEXPECTED_ERROR" });
    throw error;
  }
};

export const toSafeProjectAnalysisIdentity = (
  identity: ProjectOverviewProjectionIdentity,
): SafeProjectAnalysisIdentity => {
  const { databasePath: _databasePath, ...safe } = identity;
  const canonical = {
    ...safe,
    metricRevisionIds: canonicalizeProjectAnalysisRevisionSet(safe.metricRevisionIds),
    ruleRevisionIds: canonicalizeProjectAnalysisRevisionSet(safe.ruleRevisionIds),
  };
  return {
    ...canonical,
    fingerprint: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
  };
};

export const readProjectAnalysisContextPrewarmOutcome = async (input: {
  workspaceId: string;
  projectId: string;
  scopeId?: string;
  resource?: "electricity" | "water";
  databasePath?: string;
}): Promise<ProjectAnalysisContextPrewarmOperationalEvent | undefined> => (
  readProjectAnalysisPrewarmOutcomeSidecar({
    directory: projectAnalysisPersistentDirectory(resolveProjectAnalysisDatabasePath({
      workspaceId: input.workspaceId,
      ...(input.databasePath ? { databasePath: input.databasePath } : {}),
    })),
    pointerKey: analysisContextPrewarmOutcomePointerKey({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      scopeId: input.scopeId ?? "project",
      resource: input.resource ?? "electricity",
      analysisWindow: "all-available",
    }),
    validate: isProjectAnalysisContextPrewarmOperationalEvent,
  })
);

const isProjectAnalysisContextPrewarmOperationalEvent = (
  value: unknown,
): value is ProjectAnalysisContextPrewarmOperationalEvent => {
  if (!isRecord(value)
    || value.contract !== "energyiq-analysis-context-prewarm-operation@1"
    || typeof value.recordedAt !== "string"
    || Number.isNaN(Date.parse(value.recordedAt))
    || !["admin", "import", "tuya", "publish", "tariff", "calendar", "manual"]
      .includes(value.trigger)
    || !["materialized", "unchanged", "not_ready", "failed"].includes(value.outcome)
    || !isRecord(value.target)
    || typeof value.target.pointer !== "string"
    || typeof value.target.workspaceId !== "string"
    || typeof value.target.projectId !== "string"
    || typeof value.target.scopeId !== "string"
    || !["electricity", "water"].includes(value.target.resource)
    || value.target.analysisWindow !== "all-available"
    || (value.attemptedIdentity !== null && !isSafeProjectAnalysisIdentity(value.attemptedIdentity))
    || (value.priorReady !== null && (!isRecord(value.priorReady)
      || typeof value.priorReady.projectionRef !== "string"
      || !isSafeProjectAnalysisIdentity(value.priorReady.identity)))) return false;
  return typeof value.reasonCode === "undefined" || typeof value.reasonCode === "string";
};

const isSafeProjectAnalysisIdentity = (value: unknown): value is SafeProjectAnalysisIdentity => (
  isRecord(value)
  && !("databasePath" in value)
  && typeof value.fingerprint === "string"
  && typeof value.workspaceId === "string"
  && typeof value.projectId === "string"
  && typeof value.scopeId === "string"
  && typeof value.resource === "string"
  && typeof value.from === "string"
  && typeof value.to === "string"
  && typeof value.dataSnapshotId === "string"
  && typeof value.projectReleaseId === "string"
  && Array.isArray(value.metricRevisionIds)
  && Array.isArray(value.ruleRevisionIds)
);

const safePrewarmReasonCode = (message: string): string => (
  /^ENERGYIQ_[A-Z0-9_]+/u.exec(message)?.[0] ?? "ENERGYIQ_ANALYSIS_CONTEXT_NOT_READY"
);

const readSafePriorReadyProjection = async (input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  user: UserRecord;
  workspaceId: string;
  projectId: string;
  scopeId?: string;
  resource?: "electricity" | "water";
  databasePath?: string;
  env?: Record<string, string | undefined>;
}): Promise<SafeProjectAnalysisProjectionReference | null> => {
  const project = input.metadataStore.energyIq.getProject(input.projectId);
  const databasePath = resolveProjectAnalysisDatabasePath({
    workspaceId: input.workspaceId,
    ...(input.databasePath ? { databasePath: input.databasePath } : {}),
  });
  const current = await projectAnalysisCacheFor(input.metadataStore, input.dataGateway).readCurrent({
    pointerKey: analysisContextPackageLatestPointerKey({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      scopeId: input.scopeId ?? "project",
      resource: input.resource ?? "electricity",
      analysisWindow: "all-available",
    }),
    persistentDirectory: projectAnalysisPersistentDirectory(databasePath),
    validate: (_resolution, identity) => identity.workspaceId === input.workspaceId
      && identity.projectId === input.projectId
      && identity.resource === (input.resource ?? "electricity")
      && project.workspace_id === input.workspaceId,
  });
  return current ? {
    projectionRef: createProjectOverviewProjectionRef(current.projectionKey),
    identity: toSafeProjectAnalysisIdentity(current.identity),
  } : null;
};

const materializeProjectAnalysisContextPackageWithCompute = async (input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  identity: ProjectOverviewProjectionIdentity;
  projectRelease: PublishedProjectRelease;
  databasePath: string;
  latestPointerKey?: string;
  compute: () => Promise<ReadyProjectAnalysisResolution>;
}): Promise<{
  changed: boolean;
  resolution: ReadyProjectAnalysisResolution;
  contextPackage: AnalysisContextPackage;
}> => {
  const projectionKey = createProjectOverviewProjectionKey(input.identity);
  const materialized = await projectAnalysisCacheFor(input.metadataStore, input.dataGateway)
    .materializeCurrent({
      pointerKey: analysisContextPackagePointerKey(input.identity),
      projectionKey,
      identity: input.identity,
      persistentDirectory: projectAnalysisPersistentDirectory(input.databasePath),
      compute: async () => rebindManagedProjectionActor(
        await input.compute(),
        MANAGED_OVERVIEW_SYSTEM_ACTOR_ID,
      ),
      validate: (resolution, candidateIdentity) => managedProjectionMatchesIdentity(
        input.metadataStore,
        resolution,
        candidateIdentity,
        { requireDeclaredReportWindow: false },
      ),
      equivalent: managedProjectionFactsEquivalent,
      validateBeforePublish: async () => projectReleaseMatchesAuthoritativeMetadata(
        input.metadataStore,
        input.identity.overviewDefinitionRevisionId,
        input.projectRelease,
      ),
    });
  if (input.latestPointerKey) {
    await projectAnalysisCacheFor(input.metadataStore, input.dataGateway).materializeCurrent({
      pointerKey: input.latestPointerKey,
      projectionKey,
      identity: input.identity,
      persistentDirectory: projectAnalysisPersistentDirectory(input.databasePath),
      compute: async () => materialized.value,
      validate: (resolution, candidateIdentity) => managedProjectionMatchesIdentity(
        input.metadataStore,
        resolution,
        candidateIdentity,
        { requireDeclaredReportWindow: false },
      ),
      equivalent: managedProjectionFactsEquivalent,
    });
  }
  return {
    changed: materialized.changed,
    resolution: materialized.value,
    contextPackage: toAnalysisContextPackage(input.identity, materialized.value.snapshot),
  };
};

const PREWARM_NOT_READY_ERRORS = new Set([
  "ENERGYIQ_ANALYSIS_CONTEXT_PACKAGE_NOT_READY",
  "ENERGYIQ_ANALYSIS_WINDOW_DATA_UNAVAILABLE",
  "ENERGYIQ_PROJECT_RELEASE_REQUIRED",
  "ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE",
]);

const PREWARM_NOT_READY_PREFIXES = [
  "ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE:",
  "ENERGYIQ_PUBLISHED_HIERARCHY_REVISION_REQUIRED:",
  "ENERGYIQ_PUBLISHED_MAPPING_REVISION_REQUIRED:",
  "ENERGYIQ_PUBLISHED_MAPPING_ROUTE_REQUIRED:",
  "ENERGYIQ_PUBLISHED_METER_ROUTE_REQUIRED:",
] as const;

const isPrewarmNotReadyError = (message: string): boolean =>
  PREWARM_NOT_READY_ERRORS.has(message)
  || PREWARM_NOT_READY_PREFIXES.some((prefix) => message.startsWith(prefix));

/** Read an exact immutable AI package without opening or materializing DuckDB. */
export const readProjectAnalysisContextPackage = async (input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  user: UserRecord;
  workspaceId: string;
  context: EnergyQueryContext;
  projectRelease: PublishedProjectRelease;
  analysisWindow: NonNullable<EnergyQueryContextRequest["analysisWindow"]> | null;
  databasePath?: string;
  env?: Record<string, string | undefined>;
}): Promise<{
  resolution: ReadyProjectAnalysisResolution;
  contextPackage: AnalysisContextPackage;
} | undefined> => {
  const access = resolveEnergyAccessContext({
    metadataStore: input.metadataStore,
    user: input.user,
    requestedWorkspaceId: input.workspaceId,
    rolePersistence: "read-only",
    ...(input.env ? { env: input.env } : {}),
  });
  const project = access.projects.find((candidate) => candidate.id === input.context.projectId);
  if (!project
    || project.workspaceId !== access.activeWorkspaceId
    || project.workspaceId !== input.context.workspaceId
    || input.workspaceId !== input.context.workspaceId) {
    throw new Error("ENERGYIQ_PROJECT_FORBIDDEN");
  }
  const databasePath = resolveProjectAnalysisDatabasePath({
    workspaceId: input.context.workspaceId,
    ...(input.databasePath ? { databasePath: input.databasePath } : {}),
  });
  const identity = projectAnalysisProjectionIdentity({
    metadataStore: input.metadataStore,
    context: input.context,
    projectRelease: input.projectRelease,
    databasePath,
    analysisWindow: input.analysisWindow,
  });
  const projectionKey = createProjectOverviewProjectionKey(identity);
  const materialized = await projectAnalysisCacheFor(input.metadataStore, input.dataGateway).readCurrent({
    pointerKey: analysisContextPackagePointerKey(identity),
    persistentDirectory: projectAnalysisPersistentDirectory(databasePath),
    expectedProjectionKey: projectionKey,
    validate: (resolution, candidateIdentity) => managedProjectionMatchesIdentity(
      input.metadataStore,
      resolution,
      candidateIdentity,
      { requireDeclaredReportWindow: false },
    ),
  });
  if (!materialized) return undefined;
  const resolution = rebindManagedProjectionActor(materialized.value, access.user.id);
  return {
    resolution,
    contextPackage: toAnalysisContextPackage(materialized.identity, resolution.snapshot),
  };
};

export const materializeCurrentProjectOverviewProjectionIfReady = async (
  input: Parameters<typeof materializeCurrentProjectOverviewProjection>[0],
): Promise<Awaited<ReturnType<typeof materializeCurrentProjectOverviewProjection>> | undefined> => {
  if (!resolveProjectOverviewProfile(input.metadataStore, input.projectId)) return undefined;
  try {
    return await materializeCurrentProjectOverviewProjection(input);
  } catch (error) {
    if (error instanceof Error && (
      error.message === "ENERGYIQ_CURRENT_OVERVIEW_PERIOD_NOT_FOUND"
      || error.message === "ENERGYIQ_CURRENT_OVERVIEW_COVERAGE_NOT_FOUND"
      || error.message === "ENERGYIQ_OVERVIEW_PROJECTION_NOT_READY"
      || error.message === "ENERGYIQ_SCHOOL_HOLIDAY_PROJECTION_NOT_READY"
    )) return undefined;
    throw error;
  }
};

export type PublishedProjectOverviewPrewarmOutcome = {
  workspaceId: string;
  projectId: string;
  status: "materialized" | "unchanged" | "not_ready" | "failed";
  changed?: boolean;
  dataSnapshotId?: string;
  projectReleaseId?: string;
  reason?: string;
};

const restoreCurrentProjectOverviewProjectionIfPresent = async (input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  user: UserRecord;
  workspaceId: string;
  projectId: string;
  databasePath?: string;
  env?: Record<string, string | undefined>;
}): Promise<{
  changed: boolean;
  resolution: ReadyProjectAnalysisResolution;
  contextPackage: OverviewContextPackage;
} | undefined> => {
  if (!resolveProjectOverviewProfile(input.metadataStore, input.projectId)) return undefined;
  const access = resolveEnergyAccessContext({
    metadataStore: input.metadataStore,
    user: input.user,
    requestedWorkspaceId: input.workspaceId,
    rolePersistence: "read-only",
    ...(input.env ? { env: input.env } : {}),
  });
  const authorizedProject = access.projects.find((candidate) => (
    candidate.id === input.projectId && candidate.workspaceId === access.activeWorkspaceId
  ));
  if (access.role !== "admin" || !authorizedProject) {
    throw new Error("ENERGYIQ_PROJECT_FORBIDDEN");
  }
  const project = input.metadataStore.energyIq.getProject(input.projectId);
  const projectReleaseId = resolveProjectOverviewReleaseId(input.metadataStore, input.projectId);
  if (!projectReleaseId || project.data_snapshot_id === "unavailable") return undefined;
  const databasePath = resolveProjectAnalysisDatabasePath({
    workspaceId: input.workspaceId,
    ...(input.databasePath ? { databasePath: input.databasePath } : {}),
  });
  const matchesCurrentAuthority = (
    resolution: ReadyProjectAnalysisResolution,
    identity: ProjectOverviewProjectionIdentity,
  ): boolean => {
    const authoritativeProject = input.metadataStore.energyIq.getProject(input.projectId);
    if (!(authoritativeProject.status === "published"
      && authoritativeProject.workspace_id === input.workspaceId
      && authoritativeProject.data_snapshot_id === identity.dataSnapshotId
      && identity.workspaceId === input.workspaceId
      && identity.projectId === input.projectId
      && identity.resource === "electricity"
      && identity.analysisWindow === "current-project-overview"
      && identity.dataSnapshotId === project.data_snapshot_id
      && identity.projectReleaseId === projectReleaseId
      && identity.databasePath === databasePath
      && managedProjectionMatchesIdentity(input.metadataStore, resolution, identity))) return false;
    const release = resolution.snapshot.projectRelease;
    const profile = resolveProjectOverviewProfileForRelease(input.metadataStore, release);
    const primaryWindow = profile
      ? resolution.snapshot.reportTimeContext?.windows.find(
        (window) => window.windowId === profile.primaryWindowId,
      )
      : undefined;
    if (!primaryWindow || release.id !== projectReleaseId) return false;
    const expectedContext = bindPublishedReleaseContext({
      ...resolution.snapshot.context,
      workspaceId: authoritativeProject.workspace_id,
      projectId: authoritativeProject.id,
      projectName: authoritativeProject.name,
      scopeId: authoritativeProject.root_scope_id,
      resource: "electricity",
      timezone: authoritativeProject.timezone,
      period: "Custom",
      from: primaryWindow.from,
      to: primaryWindow.toExclusive,
      dataSnapshotId: authoritativeProject.data_snapshot_id,
    }, release);
    const expectedIdentity = projectAnalysisProjectionIdentity({
      metadataStore: input.metadataStore,
      context: expectedContext,
      projectRelease: release,
      databasePath,
      analysisWindow: "current-project-overview",
    });
    return createProjectOverviewProjectionKey(identity)
      === createProjectOverviewProjectionKey(expectedIdentity);
  };
  const restored = await projectAnalysisCacheFor(input.metadataStore, input.dataGateway)
    .reconcileCurrent({
      pointerKey: currentOverviewProjectionPointerKey(input.workspaceId, input.projectId),
      persistentDirectory: projectAnalysisPersistentDirectory(databasePath),
      matches: matchesCurrentAuthority,
      validateBeforePublish: async (resolution, identity) => (
        matchesCurrentAuthority(resolution, identity)
        && resolveProjectOverviewReleaseId(input.metadataStore, input.projectId) === projectReleaseId
      ),
    });
  if (!restored) return undefined;
  const resolution = rebindManagedProjectionActor(restored.value, input.user.id);
  return {
    changed: restored.changed,
    resolution,
    contextPackage: toOverviewContextPackage(restored.identity, resolution.snapshot),
  };
};

/**
 * Explicit release/admin reconciliation for every configured published
 * Project in the caller's selected Workspace. It only republishes an already
 * validated immutable projection; missing payloads remain not_ready and never
 * trigger DuckDB analysis. Deployment invokes this gate once per explicitly
 * authorized Workspace rather than granting a browser admin cross-tenant
 * platform authority.
 */
export const prewarmPublishedProjectOverviewProjections = async (input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  fileAssetService?: Required<ConfigApiContext>["fileAssetService"];
  user: UserRecord;
  workspaceId: string;
  databasePath?: string;
  env?: Record<string, string | undefined>;
}): Promise<PublishedProjectOverviewPrewarmOutcome[]> => {
  const callerAccess = resolveEnergyAccessContext({
    metadataStore: input.metadataStore,
    user: input.user,
    requestedWorkspaceId: input.workspaceId,
    rolePersistence: "read-only",
    ...(input.env ? { env: input.env } : {}),
  });
  if (callerAccess.role !== "admin") throw new Error("ENERGYIQ_ADMIN_REQUIRED");
  const projects = callerAccess.projects
    .filter((project) => project.status === "published")
    .sort((left, right) => left.id.localeCompare(right.id));
  const outcomes: PublishedProjectOverviewPrewarmOutcome[] = [];
  for (const project of projects) {
    try {
      if (!resolveProjectOverviewProfile(input.metadataStore, project.id)) continue;
      const restored = await withRecoveredEnergyProjectPublicationLock({
        context: {
          metadataStore: input.metadataStore,
          dataGateway: input.dataGateway,
          fileAssetService: input.fileAssetService,
        } as Required<ConfigApiContext>,
        userId: input.user.id,
        projectId: project.id,
        ...(input.databasePath ? { databasePath: input.databasePath } : {}),
      }, () => restoreCurrentProjectOverviewProjectionIfPresent({
          metadataStore: input.metadataStore,
          dataGateway: input.dataGateway,
          user: input.user,
          workspaceId: project.workspaceId,
          projectId: project.id,
          ...(input.databasePath ? { databasePath: input.databasePath } : {}),
          ...(input.env ? { env: input.env } : {}),
        }));
      if (!restored) {
        outcomes.push({
          workspaceId: project.workspaceId,
          projectId: project.id,
          status: "not_ready",
        });
        continue;
      }
      outcomes.push({
        workspaceId: project.workspaceId,
        projectId: project.id,
        status: restored.changed ? "materialized" : "unchanged",
        changed: restored.changed,
        dataSnapshotId: restored.contextPackage.identity.dataSnapshotId,
        projectReleaseId: restored.contextPackage.identity.projectReleaseId,
      });
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : "ENERGYIQ_OVERVIEW_PROJECTION_PREWARM_FAILED";
      outcomes.push({
        workspaceId: project.workspaceId,
        projectId: project.id,
        status: "failed",
        reason: safePrewarmReasonCode(message),
      });
    }
  }
  return outcomes;
};

export const readCurrentProjectOverviewProjection = async (input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  user: UserRecord;
  workspaceId: string;
  projectId: string;
  expectedDataSnapshotId?: string;
  expectedProjectReleaseId?: string;
  expectedFrom?: string;
  expectedTo?: string;
  databasePath?: string;
  env?: Record<string, string | undefined>;
}): Promise<{
  resolution: ReadyProjectAnalysisResolution;
  contextPackage: OverviewContextPackage;
}> => {
  const access = resolveEnergyAccessContext({
    metadataStore: input.metadataStore,
    user: input.user,
    requestedWorkspaceId: input.workspaceId,
    rolePersistence: "read-only",
    ...(input.env ? { env: input.env } : {}),
  });
  const project = access.projects.find((candidate) => candidate.id === input.projectId);
  if (!project || project.workspaceId !== access.activeWorkspaceId) {
    throw new Error("ENERGYIQ_PROJECT_FORBIDDEN");
  }
  const projectRecord = input.metadataStore.energyIq.getProject(project.id);
  const databasePath = resolveProjectAnalysisDatabasePath({
    workspaceId: project.workspaceId,
    ...(input.databasePath ? { databasePath: input.databasePath } : {}),
  });
  const current = await withEnergyProjectPublicationReadLock({
    metadataStore: input.metadataStore,
    workspaceId: project.workspaceId,
    projectId: project.id,
  }, async () => projectAnalysisCacheFor(input.metadataStore, input.dataGateway).readCurrent({
        pointerKey: currentOverviewProjectionPointerKey(project.workspaceId, project.id),
        persistentDirectory: projectAnalysisPersistentDirectory(databasePath),
        validate: (resolution, identity) => identity.resolverRevision === PROJECT_ANALYSIS_RESOLVER_REVISION
          && identity.workspaceId === project.workspaceId
          && identity.projectId === project.id
          && identity.scopeId === projectRecord.root_scope_id
          && identity.resource === "electricity"
          && identity.analysisWindow === "current-project-overview"
          && identity.databasePath === databasePath
          && managedProjectionMatchesIdentity(input.metadataStore, resolution, identity),
      }));
  if (!current) throw new Error("ENERGYIQ_OVERVIEW_PROJECTION_NOT_MATERIALIZED");
  if (input.expectedDataSnapshotId
    && input.expectedDataSnapshotId !== current.identity.dataSnapshotId) {
    throw new Error("ENERGYIQ_DATA_SNAPSHOT_MISMATCH");
  }
  if (input.expectedProjectReleaseId
    && input.expectedProjectReleaseId !== current.identity.projectReleaseId) {
    throw new Error("ENERGYIQ_PROJECT_RELEASE_MISMATCH");
  }
  if ((input.expectedFrom && !projectionBoundaryMatches({
    expected: input.expectedFrom,
    actual: current.identity.from,
    timezone: current.identity.timezone,
    boundary: "from",
  })) || (input.expectedTo && !projectionBoundaryMatches({
    expected: input.expectedTo,
    actual: current.identity.to,
    timezone: current.identity.timezone,
    boundary: "to",
  }))) {
    throw new Error("ENERGYIQ_CURRENT_OVERVIEW_WINDOW_MISMATCH");
  }
  const resolution = rebindManagedProjectionActor(current.value, access.user.id);
  return {
    resolution,
    contextPackage: toOverviewContextPackage(current.identity, resolution.snapshot),
  };
};

export const readCurrentProjectOverviewLifecycle = async (input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  user: UserRecord;
  workspaceId: string;
  projectId: string;
  expectedProjectionRef: string;
  databasePath?: string;
  env?: Record<string, string | undefined>;
}): Promise<ProjectOverviewLifecycle> => {
  const projection = await readCurrentProjectOverviewProjection({
    metadataStore: input.metadataStore,
    dataGateway: input.dataGateway,
    user: input.user,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    ...(input.databasePath ? { databasePath: input.databasePath } : {}),
    ...(input.env ? { env: input.env } : {}),
  });
  if (projection.contextPackage.projectionRef !== input.expectedProjectionRef) {
    throw new Error("ENERGYIQ_OVERVIEW_PROJECTION_REF_MISMATCH");
  }
  const databasePath = resolveProjectAnalysisDatabasePath({
    workspaceId: projection.contextPackage.identity.workspaceId,
    ...(input.databasePath ? { databasePath: input.databasePath } : {}),
  });
  const savedAnalyses = input.metadataStore.energyIq.savedAnalyses.listProject(input.projectId);
  const savedAnalysisIdentity = savedAnalyses.map((saved) => ({
    id: saved.id,
    sequence: saved.sequence,
    dataSnapshotId: saved.data_snapshot_id,
    templateRevisionId: saved.template_revision_id,
    createdAt: saved.created_at,
  }));
  const hydrated = await attachMutableProjectAnalysisLifecycle({
    metadataStore: input.metadataStore,
    dataGateway: input.dataGateway,
    user: input.user,
    resolution: projection.resolution,
    databasePath,
    savedAnalyses,
  });
  return {
    contract: "energyiq-overview-lifecycle@1",
    projectionRef: projection.contextPackage.projectionRef,
    observedAt: new Date().toISOString(),
    inputFingerprint: createHash("sha256").update(JSON.stringify({
      projectionRef: projection.contextPackage.projectionRef,
      savedAnalyses: savedAnalysisIdentity,
    })).digest("hex"),
    ...(hydrated.snapshot.decisionLifecycle
      ? { decisionLifecycle: hydrated.snapshot.decisionLifecycle }
      : {}),
    ...(hydrated.snapshot.preschoolPlanningLifecycle
      ? { preschoolPlanningLifecycle: hydrated.snapshot.preschoolPlanningLifecycle }
      : {}),
  };
};

export const readCurrentProjectOverviewProjectionWithLifecycle = async (
  input: Parameters<typeof readCurrentProjectOverviewProjection>[0],
): Promise<Awaited<ReturnType<typeof readCurrentProjectOverviewProjection>>> => {
  const projection = await readCurrentProjectOverviewProjection(input);
  const lifecycle = await readCurrentProjectOverviewLifecycle({
    metadataStore: input.metadataStore,
    dataGateway: input.dataGateway,
    user: input.user,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    expectedProjectionRef: projection.contextPackage.projectionRef,
    ...(input.databasePath ? { databasePath: input.databasePath } : {}),
    ...(input.env ? { env: input.env } : {}),
  });
  return {
    ...projection,
    resolution: {
      ...projection.resolution,
      snapshot: {
        ...projection.resolution.snapshot,
        ...(lifecycle.decisionLifecycle
          ? { decisionLifecycle: lifecycle.decisionLifecycle }
          : {}),
        ...(lifecycle.preschoolPlanningLifecycle
          ? { preschoolPlanningLifecycle: lifecycle.preschoolPlanningLifecycle }
          : {}),
      },
    },
  };
};

export const readCurrentProjectOverviewSnapshotWithLifecycle = async (
  input: Parameters<typeof readCurrentProjectOverviewProjection>[0],
): Promise<ProjectAnalysisSnapshot> => (
  await readCurrentProjectOverviewProjectionWithLifecycle(input)
).resolution.snapshot;

const projectionBoundaryMatches = (input: {
  expected: string;
  actual: string;
  timezone: string;
  boundary: "from" | "to";
}): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(input.expected)) {
    return input.expected === input.actual;
  }
  const timestamp = input.boundary === "to"
    ? new Date(Date.parse(input.actual) - 1).toISOString()
    : input.actual;
  return localDateAt(timestamp, input.timezone) === input.expected;
};

const localDateAt = (timestamp: string, timezone: string): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const currentOverviewProjectionPointerKey = (workspaceId: string, projectId: string): string => (
  JSON.stringify({ contract: "project-current-overview-pointer@1", workspaceId, projectId })
);

const analysisContextPackagePointerKey = (identity: ProjectOverviewProjectionIdentity): string => (
  JSON.stringify({
    contract: "project-analysis-context-package-pointer@2",
    workspaceId: identity.workspaceId,
    projectId: identity.projectId,
    scopeId: identity.scopeId,
    resource: identity.resource,
    analysisWindow: identity.analysisWindow,
    bindingFingerprint: toSafeProjectAnalysisIdentity(identity).fingerprint,
  })
);

const analysisContextPackageLatestPointerKey = (identity: {
  workspaceId: string;
  projectId: string;
  scopeId: string;
  resource: string;
  analysisWindow: string | null;
}): string => JSON.stringify({
  contract: "project-analysis-context-package-latest-index@1",
  workspaceId: identity.workspaceId,
  projectId: identity.projectId,
  scopeId: identity.scopeId,
  resource: identity.resource,
  analysisWindow: identity.analysisWindow,
});

const analysisContextPrewarmOutcomePointerKey = (identity: {
  workspaceId: string;
  projectId: string;
  scopeId: string;
  resource: string;
  analysisWindow: "all-available";
}): string => JSON.stringify({
  contract: "project-analysis-context-prewarm-outcome-pointer@1",
  workspaceId: identity.workspaceId,
  projectId: identity.projectId,
  scopeId: identity.scopeId,
  resource: identity.resource,
  analysisWindow: identity.analysisWindow,
});

const projectAnalysisPersistentDirectory = (databasePath: string): string => (
  join(dirname(databasePath), "project-analysis-cache")
);

const resolveProjectAnalysisDatabasePath = (input: {
  workspaceId: string;
  databasePath?: string;
}): string => {
  if (input.databasePath === ":memory:") {
    throw new Error("ENERGYIQ_OVERVIEW_PROJECTION_PERSISTENCE_REQUIRED");
  }
  return input.databasePath
    ? resolvePath(input.databasePath)
    : resolveEnergyFactStorePath(input.workspaceId);
};

const projectAnalysisProjectionIdentity = (input: {
  metadataStore: MetadataStore;
  context: EnergyQueryContext;
  projectRelease: PublishedProjectRelease;
  databasePath: string;
  analysisWindow: NonNullable<EnergyQueryContextRequest["analysisWindow"]> | null;
}): ProjectOverviewProjectionIdentity => {
  const definition = input.projectRelease.templateRevisionId
    ? input.metadataStore.energyIq.overviewDefinitions.get(input.projectRelease.templateRevisionId)
    : null;
  const profile = resolveProjectOverviewProfile(input.metadataStore, input.context.projectId);
  return {
    resolverRevision: PROJECT_ANALYSIS_RESOLVER_REVISION,
    workspaceId: input.context.workspaceId,
    projectId: input.context.projectId,
    scopeId: input.context.scopeId,
    resource: input.context.resource,
    analysisWindow: input.analysisWindow,
    period: input.context.period,
    timezone: input.context.timezone,
    from: input.context.from,
    to: input.context.to,
    dataSnapshotId: input.context.dataSnapshotId,
    projectReleaseId: input.projectRelease.id,
    reportTimePolicyRevisionId: input.projectRelease.reportTimePolicyRevisionId,
    hierarchyRevisionId: input.projectRelease.hierarchyRevisionId,
    meterMappingRevisionId: input.projectRelease.meterMappingRevisionId,
    meterFormulaRevisionId: input.projectRelease.meterFormulaRevisionId,
    metricVersion: input.context.metricVersion,
    businessCalendarVersion: input.projectRelease.businessCalendarVersion,
    tariffScheduleVersion: input.projectRelease.tariffScheduleVersion,
    overviewDefinitionRevisionId: definition
      ? `${definition.template_revision_id}:${definition.definition_fingerprint}`
      : [
          "legacy",
          input.projectRelease.id,
          profile?.primaryWindowId ?? "unavailable",
          projectReleaseDocumentFingerprint(input.projectRelease.document),
        ].join(":"),
    rendererKey: input.projectRelease.renderer.key,
    rendererVersion: input.projectRelease.renderer.version,
    rendererContractVersion: input.projectRelease.renderer.contractVersion,
    recipeId: input.projectRelease.recipe.id,
    recipeVersion: input.projectRelease.recipe.version,
    metricRevisionIds: input.projectRelease.metricRevisionIds,
    ruleRevisionIds: input.projectRelease.ruleRevisionIds,
    databasePath: input.databasePath,
  };
};

const managedProjectionMatchesIdentity = (
  metadataStore: MetadataStore,
  resolution: ReadyProjectAnalysisResolution,
  identity: ProjectOverviewProjectionIdentity,
  options: { requireDeclaredReportWindow?: boolean } = {},
): boolean => managedProjectionPayloadHasRequiredShape(resolution)
  && identity.resolverRevision === PROJECT_ANALYSIS_RESOLVER_REVISION
  && resolution.snapshot.context.userId === MANAGED_OVERVIEW_SYSTEM_ACTOR_ID
  && resolution.snapshot.analysis.context.userId === MANAGED_OVERVIEW_SYSTEM_ACTOR_ID
  && resolution.snapshot.context.workspaceId === identity.workspaceId
  && resolution.snapshot.context.projectId === identity.projectId
  && resolution.snapshot.context.scopeId === identity.scopeId
  && resolution.snapshot.context.resource === identity.resource
  && resolution.snapshot.context.period === identity.period
  && resolution.snapshot.context.timezone === identity.timezone
  && resolution.snapshot.context.from === identity.from
  && resolution.snapshot.context.to === identity.to
  && resolution.snapshot.context.dataSnapshotId === identity.dataSnapshotId
  && resolution.snapshot.context.primaryPeriod.start === identity.from
  && resolution.snapshot.context.primaryPeriod.endExclusive === identity.to
  && resolution.snapshot.context.projectReleaseId === identity.projectReleaseId
  && resolution.snapshot.context.metricVersion === identity.metricVersion
  && resolution.snapshot.context.hierarchyRevisionId === identity.hierarchyRevisionId
  && resolution.snapshot.context.meterMappingRevisionId === identity.meterMappingRevisionId
  && resolution.snapshot.context.meterFormulaRevisionId === identity.meterFormulaRevisionId
  && resolution.snapshot.context.businessCalendarVersion === identity.businessCalendarVersion
  && resolution.snapshot.context.tariffScheduleVersion === identity.tariffScheduleVersion
  && resolution.snapshot.analysis.context.workspaceId === identity.workspaceId
  && resolution.snapshot.analysis.context.projectId === identity.projectId
  && resolution.snapshot.analysis.context.scopeId === identity.scopeId
  && resolution.snapshot.analysis.context.resource === identity.resource
  && resolution.snapshot.analysis.context.period === identity.period
  && resolution.snapshot.analysis.context.timezone === identity.timezone
  && resolution.snapshot.analysis.context.from === identity.from
  && resolution.snapshot.analysis.context.to === identity.to
  && resolution.snapshot.analysis.context.dataSnapshotId === identity.dataSnapshotId
  && resolution.snapshot.analysis.context.hierarchyRevisionId === identity.hierarchyRevisionId
  && resolution.snapshot.analysis.context.meterMappingRevisionId === identity.meterMappingRevisionId
  && resolution.snapshot.analysis.context.meterFormulaRevisionId === identity.meterFormulaRevisionId
  && resolution.snapshot.analysis.context.metricVersion === identity.metricVersion
  && resolution.snapshot.analysis.context.businessCalendarVersion === identity.businessCalendarVersion
  && resolution.snapshot.analysis.context.tariffScheduleVersion === identity.tariffScheduleVersion
  && resolution.snapshot.dataSnapshot.id === identity.dataSnapshotId
  && resolution.snapshot.projectRelease.id === identity.projectReleaseId
  && resolution.snapshot.projectRelease.projectId === identity.projectId
  && resolution.snapshot.projectRelease.reportTimePolicyRevisionId === identity.reportTimePolicyRevisionId
  && resolution.snapshot.projectRelease.hierarchyRevisionId === identity.hierarchyRevisionId
  && resolution.snapshot.projectRelease.meterMappingRevisionId === identity.meterMappingRevisionId
  && resolution.snapshot.projectRelease.meterFormulaRevisionId === identity.meterFormulaRevisionId
  && resolution.snapshot.projectRelease.businessCalendarVersion === identity.businessCalendarVersion
  && resolution.snapshot.projectRelease.tariffScheduleVersion === identity.tariffScheduleVersion
  && resolution.snapshot.projectRelease.renderer.key === identity.rendererKey
  && resolution.snapshot.projectRelease.renderer.version === identity.rendererVersion
  && resolution.snapshot.projectRelease.renderer.contractVersion === identity.rendererContractVersion
  && resolution.snapshot.projectRelease.recipe.id === identity.recipeId
  && resolution.snapshot.projectRelease.recipe.version === identity.recipeVersion
  && resolution.snapshot.renderer.key === identity.rendererKey
  && resolution.snapshot.renderer.version === identity.rendererVersion
  && resolution.snapshot.renderer.contractVersion === identity.rendererContractVersion
  && resolution.snapshot.recipe.id === identity.recipeId
  && resolution.snapshot.recipe.version === identity.recipeVersion
  && resolution.snapshot.analysis.provenance.dataSnapshotId === identity.dataSnapshotId
  && resolution.snapshot.analysis.provenance.hierarchyRevisionId === identity.hierarchyRevisionId
  && resolution.snapshot.analysis.provenance.meterMappingRevisionId === identity.meterMappingRevisionId
  && resolution.snapshot.analysis.provenance.meterFormulaRevisionId === identity.meterFormulaRevisionId
  && resolution.snapshot.analysis.provenance.metricVersion === identity.metricVersion
  && managedProjectionRuleRevisionIdsMatchIdentity(
    resolution.snapshot.analysis.provenance.ruleRevisionIds,
    identity.ruleRevisionIds,
  )
  && reportTimeContextMatchesIdentity(
    metadataStore,
    resolution.snapshot,
    identity,
    options.requireDeclaredReportWindow !== false,
  )
  && evidenceMatchesAnalysisProvenance(resolution.snapshot)
  && managedProjectionEvidencePinsMatchIdentity(resolution.snapshot, identity)
  && schoolHolidayProjectionMatchesIdentity(metadataStore, resolution.snapshot, identity)
  && sameStringSequence(resolution.snapshot.projectRelease.metricRevisionIds, identity.metricRevisionIds)
  && sameStringSequence(resolution.snapshot.projectRelease.ruleRevisionIds, identity.ruleRevisionIds)
  && projectReleaseMatchesAuthoritativeMetadata(
    metadataStore,
    identity.overviewDefinitionRevisionId,
    resolution.snapshot.projectRelease,
  );

export const managedProjectionPayloadHasRequiredShape = (
  resolution: unknown,
): resolution is ReadyProjectAnalysisResolution => {
  if (!isRecord(resolution) || resolution.status !== "ready" || !isRecord(resolution.snapshot)) {
    return false;
  }
  const snapshot = resolution.snapshot;
  return projectAnalysisContextHasRequiredShape(snapshot.context)
    && projectReleaseHasRequiredShape(snapshot.projectRelease)
    && recipeHasRequiredShape(snapshot.recipe)
    && rendererHasRequiredShape(snapshot.renderer)
    && dataHealthHasRequiredShape(snapshot.dataQuality)
    && dataSnapshotHasRequiredShape(snapshot.dataSnapshot)
    && recordArrayHasRequiredShape(snapshot.evidence, evidenceHasRequiredShape)
    && recordArrayHasRequiredShape(snapshot.findings, attentionHasRequiredShape)
    && projectAnalysisMetadataHasRequiredShape(snapshot.metadata)
    && projectAnalysisPayloadHasRequiredShape(snapshot.analysis)
    && optionalRecordHasRequiredShape(snapshot.latestAvailablePeriod, latestAvailablePeriodHasRequiredShape)
    && optionalRecordHasRequiredShape(snapshot.reportTimeContext, reportTimeContextHasRequiredShape)
    && optionalRecordArrayHasRequiredShape(snapshot.reportWindowAnalyses, reportWindowAnalysisHasRequiredShape)
    && optionalRecordArrayHasRequiredShape(snapshot.reportWindowSegmentSummaries, reportWindowSegmentSummaryHasRequiredShape)
    && optionalRecordHasRequiredShape(snapshot.meterDataHealth, meterDataHealthProjectionHasRequiredShape)
    && optionalRecordHasRequiredShape(snapshot.sectionManifest, ngeeAnnSectionManifestHasRequiredShape)
    && (snapshot.schoolHolidayComparison === undefined
      || schoolHolidayComparisonHasRequiredShape(snapshot.schoolHolidayComparison))
    && optionalRecordHasRequiredShape(snapshot.decisionPriorities, decisionPrioritiesHasRequiredShape)
    && snapshot.decisionLifecycle === undefined
    && optionalRecordHasRequiredShape(snapshot.preschoolBenchmark, preschoolBenchmarkHasRequiredShape)
    && optionalRecordHasRequiredShape(snapshot.preschoolAppliances, preschoolAppliancesHasRequiredShape)
    && optionalRecordHasRequiredShape(snapshot.preschoolOperational, preschoolOperationalHasRequiredShape)
    && snapshot.preschoolPlanningLifecycle === undefined
    && optionalRecordHasRequiredShape(snapshot.preschoolDecisionSignals, preschoolDecisionSignalsHasRequiredShape);
};

const ngeeAnnSectionManifestHasRequiredShape = (value: Record<string, any>): boolean => {
  if (value.contract !== "energyiq-ngee-ann-section-manifest@1"
    || !hasStringFields(value, ["projectReleaseId"])
    || !isStringArray(value.enabledSectionIds)
    || new Set(value.enabledSectionIds).size !== value.enabledSectionIds.length
    || !value.enabledSectionIds.every((sectionId: string) => (
      sectionId === "trend-and-demand"
      || sectionId === "time-behaviour"
      || sectionId === "circuit-concentration"
      || sectionId === "decision-priorities"
      || sectionId === NGEE_ANN_SCHOOL_HOLIDAY_SECTION_ID
    ))
    || !["trend-and-demand", "time-behaviour", "circuit-concentration", "decision-priorities"]
      .every((sectionId) => value.enabledSectionIds.includes(sectionId))
    || !recordArrayHasRequiredShape(value.disabledCapabilities, (item) => (
      item.sectionId === NGEE_ANN_SCHOOL_HOLIDAY_SECTION_ID
      && hasStringFields(item, ["reason"])
    ))) return false;
  const holidayEnabled = value.enabledSectionIds.includes(NGEE_ANN_SCHOOL_HOLIDAY_SECTION_ID);
  return holidayEnabled
    ? value.disabledCapabilities.length === 0
    : value.disabledCapabilities.length === 1;
};

const projectAnalysisContextHasRequiredShape = (value: unknown): value is Record<string, any> => (
  isRecord(value)
  && energyQueryContextHasRequiredShape(value)
  && hasStringFields(value, ["projectReleaseId"])
  && isRecord(value.primaryPeriod)
  && hasStringFields(value.primaryPeriod, ["start", "endExclusive"])
  && (value.latestCompleteLocalDay === undefined
    || value.latestCompleteLocalDay === null
    || typeof value.latestCompleteLocalDay === "string")
  && (value.monthlyOutlookTargetPeriod === undefined
    || value.monthlyOutlookTargetPeriod === null
    || monthlyTargetPeriodHasRequiredShape(value.monthlyOutlookTargetPeriod))
);

const latestAvailablePeriodHasRequiredShape = (value: Record<string, any>): boolean => (
  value.period === "Custom" && hasStringFields(value, ["from", "to"])
);

const energyQueryContextHasRequiredShape = (value: unknown): value is Record<string, any> => (
  isRecord(value)
  && hasStringFields(value, [
    "userId", "workspaceId", "projectId", "projectName", "scopeId", "scopeName", "scopeType",
    "resource", "timezone", "from", "to", "period", "hierarchyRevisionId", "meterMappingRevisionId",
    "meterFormulaRevisionId", "dataSnapshotId", "metricVersion", "businessCalendarVersion",
    "tariffScheduleVersion", "resolvedAt",
  ])
  && value.endExclusive === true
);

const projectReleaseHasRequiredShape = (value: unknown): value is Record<string, any> => (
  isRecord(value)
  && hasStringFields(value, [
    "id", "source", "projectId", "reportTimePolicyRevisionId", "hierarchyRevisionId",
    "meterMappingRevisionId", "meterFormulaRevisionId", "businessCalendarVersion",
    "tariffScheduleVersion",
  ])
  && (value.templateRevisionId === null || typeof value.templateRevisionId === "string")
  && (value.templateRevisionSequence === null || isFiniteNumber(value.templateRevisionSequence))
  && (value.publishedAt === null || typeof value.publishedAt === "string")
  && recipeHasRequiredShape(value.recipe)
  && rendererHasRequiredShape(value.renderer)
  && isStringArray(value.metricRevisionIds)
  && isStringArray(value.ruleRevisionIds)
  && templateDocumentHasRequiredShape(value.document)
  && recordArrayHasRequiredShape(value.catalog, componentRevisionHasRequiredShape)
);

const recipeHasRequiredShape = (value: unknown): value is Record<string, any> => (
  isRecord(value) && hasStringFields(value, ["id", "version"])
);

const rendererHasRequiredShape = (value: unknown): value is Record<string, any> => (
  isRecord(value) && hasStringFields(value, ["key", "version", "contractVersion"])
);

const dataSnapshotHasRequiredShape = (value: unknown): value is Record<string, any> => (
  isRecord(value)
  && hasStringFields(value, ["id"])
  && isStringArray(value.importBatchIds)
  && (value.lastSeenAt === null || typeof value.lastSeenAt === "string")
  && optionalRecordHasRequiredShape(value.sourceCoverage, (coverage) => (
    hasStringFields(coverage, ["fromLocalDate", "throughLocalDate"])
  ))
);

const dataHealthHasRequiredShape = (value: unknown): value is Record<string, any> => (
  isRecord(value)
  && hasStringFields(value, ["status"])
  && hasFiniteNumberFields(value, [
    "coveragePct", "expectedMeterIntervalCount", "validIntervalCount", "qualityEventCount",
    "cumulativeDeltaMismatchCount", "averageKwMismatchCount", "invalidIntervalDurationCount",
  ])
  && isStringArray(value.importBatchIds)
  && (value.lastSeenAt === undefined || typeof value.lastSeenAt === "string")
);

const evidenceHasRequiredShape = (value: Record<string, any>): boolean => (
  hasStringFields(value, ["id", "metricId"])
  && isStringArray(value.queryIds)
  && (value.queryReceiptId === undefined || typeof value.queryReceiptId === "string")
);

const attentionHasRequiredShape = (value: Record<string, any>): boolean => (
  hasStringFields(value, ["code", "severity", "title", "evidence", "suggestedAction"])
);

const projectAnalysisMetadataHasRequiredShape = (value: unknown): value is Record<string, any> => (
  isRecord(value)
  && hasStringFields(value, ["status", "hierarchyRevisionId", "timezone"])
  && isRecord(value.period)
  && hasStringFields(value.period, ["start", "endExclusive"])
  && projectAnalysisScopeMetadataHasRequiredShape(value.selectedScope)
  && recordArrayHasRequiredShape(value.comparisonScopes, projectAnalysisScopeMetadataHasRequiredShape)
  && recordArrayHasRequiredShape(value.evidence, metadataEvidenceHasRequiredShape)
);

const projectAnalysisScopeMetadataHasRequiredShape = (value: unknown): value is Record<string, any> => (
  isRecord(value)
  && hasStringFields(value, ["scopeId", "scopeName", "status"])
  && hasFiniteNumberFields(value, ["usageKwh"])
  && resolvedMetadataValueHasRequiredShape(value.area)
  && resolvedMetadataValueHasRequiredShape(value.headcount)
  && isRecord(value.normalisations)
  && normalisedMetricHasRequiredShape(value.normalisations.eui)
  && normalisedMetricHasRequiredShape(value.normalisations.perPax)
  && recordArrayHasRequiredShape(value.evidence, metadataEvidenceHasRequiredShape)
);

const resolvedMetadataValueHasRequiredShape = (value: unknown): value is Record<string, any> => (
  isRecord(value)
  && hasStringFields(value, ["status", "unit"])
  && (value.value === null || isFiniteNumber(value.value))
  && isStringArray(value.metadataRevisionIds)
  && isStringArray(value.hierarchyRevisionIds)
  && recordArrayHasRequiredShape(value.evidence, metadataEvidenceHasRequiredShape)
  && (value.status !== "missing"
    || (hasStringFields(value, ["reason", "guidance"]) && value.value === null))
);

const normalisedMetricHasRequiredShape = (value: unknown): value is Record<string, any> => (
  isRecord(value)
  && hasStringFields(value, ["status", "metricId", "unit"])
  && (value.value === null || isFiniteNumber(value.value))
  && isStringArray(value.metadataRevisionIds)
  && isStringArray(value.hierarchyRevisionIds)
  && recordArrayHasRequiredShape(value.evidence, metadataEvidenceHasRequiredShape)
  && (value.status !== "missing"
    || (hasStringFields(value, ["reason", "guidance"]) && value.value === null))
);

const metadataEvidenceHasRequiredShape = (value: Record<string, any>): boolean => (
  hasStringFields(value, [
    "metadataRevisionId", "hierarchyRevisionId", "dimension", "status", "timezone",
  ])
  && (value.value === null || isFiniteNumber(value.value))
  && (value.effectiveFrom === null || typeof value.effectiveFrom === "string")
  && (value.effectiveTo === null || typeof value.effectiveTo === "string")
  && (value.scopeId === undefined || typeof value.scopeId === "string")
  && (value.scopeName === undefined || typeof value.scopeName === "string")
);

const projectAnalysisPayloadHasRequiredShape = (value: unknown): value is Record<string, any> => {
  if (!isRecord(value)
    || !energyQueryContextHasRequiredShape(value.context)
    || !latestAcceptedReadingHasRequiredShape(value.latestAcceptedReading)
    || !summaryHasRequiredShape(value.summary)
    || !recordArrayHasRequiredShape(value.hourlyProfile, hourlyProfileItemHasRequiredShape)
    || !comparisonHasRequiredShape(value.comparison)
    || !recordArrayHasRequiredShape(value.categories, categoryHasRequiredShape)
    || !recordArrayHasRequiredShape(value.childScopes, childScopeHasRequiredShape)
    || !recordArrayHasRequiredShape(value.circuits, circuitHasRequiredShape)
    || !recordArrayHasRequiredShape(value.topCircuits, circuitHasRequiredShape)
    || !recordArrayHasRequiredShape(value.designatedTotals, circuitHasRequiredShape)
    || !componentReconciliationHasRequiredShape(value.componentReconciliation)
    || !recordArrayHasRequiredShape(value.virtualMeters, virtualMeterHasRequiredShape)
    || !policyProjectionHasRequiredShape(value.offHours)
    || !policyProjectionHasRequiredShape(value.cost)
    || !dataHealthHasRequiredShape(value.dataHealth)
    || !unitsHaveRequiredShape(value.units)
    || !recordArrayHasRequiredShape(value.attention, attentionHasRequiredShape)
    || !provenanceHasRequiredShape(value.provenance)
    || !projectAnalysisMetadataHasRequiredShape(value.metadata)) return false;
  return optionalRecordHasRequiredShape(value.dailyTotals, dailyTotalsHasRequiredShape)
    && optionalRecordHasRequiredShape(value.componentCategoryBreakdown, componentCategoryBreakdownHasRequiredShape)
    && optionalRecordHasRequiredShape(value.calendarTotals, calendarTotalsHasRequiredShape)
    && optionalRecordHasRequiredShape(value.timeBehaviour, timeBehaviourHasRequiredShape)
    && optionalRecordHasRequiredShape(value.componentHourlyProfiles, componentHourlyProfilesHasRequiredShape)
    && optionalRecordHasRequiredShape(value.dailyUsageAnomalies, dailyUsageAnomaliesHasRequiredShape)
    && optionalRecordHasRequiredShape(value.peakBreakdown, peakBreakdownHasRequiredShape)
    && optionalRecordArrayHasRequiredShape(value.virtualMeterTraces, virtualMeterTraceHasRequiredShape);
};

const latestAcceptedReadingHasRequiredShape = (value: unknown): value is Record<string, any> => {
  if (!isRecord(value) || !hasStringFields(value, ["status", "queryId"])) return false;
  if (value.status === "available") {
    return hasStringFields(value, ["recordedAt", "meterNodeId", "sourceFile", "sourceSha256", "sourceReadingKind"])
      && hasFiniteNumberFields(value, ["valueKwh"]);
  }
  return isRecord(value.reason) && hasStringFields(value.reason, ["code", "message"]);
};

const summaryHasRequiredShape = (value: unknown): value is Record<string, any> => (
  isRecord(value)
  && hasFiniteNumberFields(value, [
    "usageKwh", "averageDailyUsageKwh", "peakKw", "validIntervalCount", "qualityEventCount",
  ])
  && optionalFiniteNumberFieldsHaveRequiredShape(value, [
    "nonOperatingKwh", "nonOperatingSharePct", "areaSqm", "occupantCount", "kwhPerSqm", "kwhPerPerson",
  ])
  && (value.peakAt === undefined || typeof value.peakAt === "string")
);

const hourlyProfileItemHasRequiredShape = (value: Record<string, any>): boolean => (
  hasFiniteNumberFields(value, ["hour", "usageKwh", "averageKw", "peakKw", "observationCount"])
);

const comparisonHasRequiredShape = (value: unknown): value is Record<string, any> => (
  isRecord(value)
  && hasStringFields(value, ["from", "to"])
  && hasFiniteNumberFields(value, ["usageKwh", "changeKwh"])
  && isNullableFiniteNumber(value.changePct)
);

const categoryHasRequiredShape = (value: Record<string, any>): boolean => (
  hasStringFields(value, ["category"])
  && hasFiniteNumberFields(value, ["usageKwh", "sharePct"])
  && comparisonValuesHaveRequiredShape(value.comparison)
  && compactDataHealthHasRequiredShape(value.dataHealth)
);

const childScopeHasRequiredShape = (value: Record<string, any>): boolean => (
  hasStringFields(value, ["nodeId", "name", "nodeType"])
  && hasFiniteNumberFields(value, ["usageKwh", "sharePct"])
  && comparisonValuesHaveRequiredShape(value.comparison)
  && compactDataHealthHasRequiredShape(value.dataHealth)
  && projectAnalysisScopeMetadataHasRequiredShape(value.metadata)
);

const circuitHasRequiredShape = (value: Record<string, any>): boolean => (
  hasStringFields(value, ["meterNodeId", "scopeId", "name", "appliance", "category", "meterRole"])
  && typeof value.includedInOfficialTotal === "boolean"
  && hasFiniteNumberFields(value, ["usageKwh", "sharePct", "peakKw", "qualityEventCount"])
  && comparisonValuesHaveRequiredShape(value.comparison)
  && compactDataHealthHasRequiredShape(value.dataHealth)
);

const comparisonValuesHaveRequiredShape = (value: unknown): value is Record<string, any> => (
  isRecord(value)
  && hasFiniteNumberFields(value, ["usageKwh", "changeKwh"])
  && isNullableFiniteNumber(value.changePct)
);

const compactDataHealthHasRequiredShape = (value: unknown): value is Record<string, any> => (
  isRecord(value)
  && hasFiniteNumberFields(value, [
    "coveragePct", "expectedMeterIntervalCount", "validIntervalCount", "qualityEventCount",
  ])
);

const componentReconciliationHasRequiredShape = (value: unknown): value is Record<string, any> => (
  isRecord(value)
  && hasFiniteNumberFields(value, ["officialUsageKwh", "componentUsageKwh", "gapKwh"])
  && isNullableFiniteNumber(value.ratioPct)
  && isStringArray(value.officialMeterNodeIds)
  && isStringArray(value.componentMeterNodeIds)
);

const virtualMeterHasRequiredShape = (value: Record<string, any>): boolean => (
  hasStringFields(value, ["meterNodeId", "name", "scopeId"])
  && value.includedInOfficialTotal === false
  && isStringArray(value.termMeterNodeIds)
  && hasFiniteNumberFields(value, ["usageKwh"])
);

const policyProjectionHasRequiredShape = (value: unknown): value is Record<string, any> => {
  if (!isRecord(value) || !hasStringFields(value, ["status"])) return false;
  if (value.status === "unavailable") {
    return isRecord(value.reason) && hasStringFields(value.reason, ["code", "message"]);
  }
  if (value.status !== "available") return false;
  if (Array.isArray(value.allocations)) {
    return hasFiniteNumberFields(value, ["amount"])
      && hasStringFields(value, ["currency", "tariffScheduleVersion"])
      && recordArrayHasRequiredShape(value.allocations, tariffAllocationHasRequiredShape);
  }
  return hasFiniteNumberFields(value, ["operatingKwh", "standbyKwh", "usageKwh", "sharePct"])
    && hasStringFields(value, ["timezone", "businessCalendarVersion"]);
};

const unitsHaveRequiredShape = (value: unknown): value is Record<string, any> => (
  isRecord(value)
  && hasStringFields(value, ["usage", "demand", "timezone"])
  && hasFiniteNumberFields(value, ["intervalMinutes"])
);

const provenanceHasRequiredShape = (value: unknown): value is Record<string, any> => (
  isRecord(value)
  && hasStringFields(value, [
    "dataSnapshotId", "hierarchyRevisionId", "meterMappingRevisionId", "meterFormulaRevisionId",
    "metricVersion", "aggregationRule", "sourceView",
  ])
  && isStringArray(value.ruleRevisionIds)
  && isStringArray(value.queryIds)
);

const reportTimeContextHasRequiredShape = (value: Record<string, any>): boolean => (
  value.contractRevision === ENERGYIQ_REPORT_TIME_CONTEXT_REVISION
  && hasStringFields(value, [
    "policyId", "policyRevision", "timezone", "asOf", "acceptedDataEndExclusive",
    "dataThroughLocalDate", "lastRefreshedAt",
  ])
  && isRecord(value.binding)
  && hasStringFields(value.binding, [
    "workspaceId", "projectId", "scopeId", "resource", "dataSnapshotId", "projectReleaseId",
  ])
  && recordArrayHasRequiredShape(value.windows, reportWindowHasRequiredShape)
);

const reportWindowHasRequiredShape = (value: Record<string, any>): boolean => (
  hasStringFields(value, [
    "windowId", "role", "label", "phase", "from", "toExclusive", "comparisonCompatibilityKey",
  ])
  && ["complete", "partial", "forecast"].includes(value.phase)
  && isFiniteNumber(value.completeDayCount)
  && reportWindowStrategyHasRequiredShape(value.strategy)
  && recordArrayHasRequiredShape(value.segments, (segment) => (
    hasStringFields(segment, ["from", "toExclusive"])
  ))
);

const reportWindowStrategyHasRequiredShape = (value: unknown): boolean => {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  switch (value.kind) {
    case "rolling_complete_days":
      return isPositiveSafeInteger(value.days);
    case "calendar_month_to_date":
    case "next_complete_calendar_month":
      return true;
    case "completed_calendar_months":
      return isPositiveSafeInteger(value.months);
    case "prior_equivalent_progress":
      return isPositiveSafeInteger(value.months) && typeof value.sourceWindowId === "string";
    case "same_day_type_baseline":
      return isPositiveSafeInteger(value.lookbackDays) && typeof value.sourceWindowId === "string";
    default:
      return false;
  }
};

const isPositiveSafeInteger = (value: unknown): value is number => (
  Number.isSafeInteger(value) && (value as number) > 0
);

const templateDocumentHasRequiredShape = (value: unknown): value is Record<string, any> => (
  isRecord(value)
  && (value.schema_version === undefined || value.schema_version === 2)
  && recordArrayHasRequiredShape(value.templates, templateDefinitionHasRequiredShape)
);

const templateDefinitionHasRequiredShape = (value: Record<string, any>): boolean => (
  hasStringFields(value, ["template_id", "target_kind"])
  && (value.tier_definition_id === undefined || typeof value.tier_definition_id === "string")
  && optionalRecordArrayHasRequiredShape(value.sections, (section) => (
    hasStringFields(section, ["section_id", "title", "navigation_label"])
    && (section.description === undefined || typeof section.description === "string")
  ))
  && recordArrayHasRequiredShape(value.components, templateComponentHasRequiredShape)
);

const templateComponentHasRequiredShape = (value: Record<string, any>): boolean => (
  hasStringFields(value, ["component_revision_id"])
  && typeof value.enabled === "boolean"
  && (value.placement_id === undefined || typeof value.placement_id === "string")
  && (value.section_id === undefined || typeof value.section_id === "string")
  && optionalRecordHasRequiredShape(value.layout, (layout) => (
    isFiniteNumber(layout.span) && typeof layout.height === "string"
  ))
  && optionalRecordHasRequiredShape(value.presentation, (presentation) => (
    hasStringFields(presentation, ["visual_preset", "density", "tone"])
    && typeof presentation.show_legend === "boolean"
    && isFiniteNumber(presentation.limit)
    && (presentation.title === undefined || typeof presentation.title === "string")
    && (presentation.description === undefined || typeof presentation.description === "string")
  ))
);

const componentRevisionHasRequiredShape = (value: Record<string, any>): boolean => (
  hasStringFields(value, [
    "revision_id", "component_id", "display_name", "description", "family", "view_key", "target",
    "requirement", "created_at",
  ])
  && isFiniteNumber(value.version)
  && isStringArray(value.metric_revision_ids)
  && isStringArray(value.rule_revision_ids)
  && isStringArray(value.query_ids)
  && isRecord(value.allowed_presentation)
  && isRecord(value.allowed_presentation.layout)
  && Array.isArray(value.allowed_presentation.layout.spans)
  && value.allowed_presentation.layout.spans.every(isFiniteNumber)
  && isStringArray(value.allowed_presentation.layout.heights)
  && isRecord(value.allowed_presentation.visuals)
  && isStringArray(value.allowed_presentation.visuals.presets)
  && isStringArray(value.allowed_presentation.visuals.densities)
  && isStringArray(value.allowed_presentation.visuals.tones)
  && isRecord(value.allowed_presentation.visuals.legend)
  && typeof value.allowed_presentation.visuals.legend.configurable === "boolean"
  && typeof value.allowed_presentation.visuals.legend.default === "boolean"
  && isRecord(value.allowed_presentation.visuals.limit)
  && typeof value.allowed_presentation.visuals.limit.configurable === "boolean"
  && hasFiniteNumberFields(value.allowed_presentation.visuals.limit, ["min", "max", "default"])
);

const reportWindowAnalysisHasRequiredShape = (value: Record<string, any>): boolean => (
  hasStringFields(value, ["windowId", "status"])
  && value.status === "ready"
  && isRecord(value.period)
  && hasStringFields(value.period, ["start", "endExclusive"])
  && isRecord(value.analysis)
  && optionalRecordHasRequiredShape(value.analysis.summary, summaryHasRequiredShape)
  && optionalRecordHasRequiredShape(value.analysis.offHours, policyProjectionHasRequiredShape)
  && optionalRecordHasRequiredShape(value.analysis.dailyTotals, dailyTotalsHasRequiredShape)
  && optionalRecordHasRequiredShape(value.analysis.timeBehaviour, timeBehaviourHasRequiredShape)
  && optionalRecordHasRequiredShape(value.analysis.componentHourlyProfiles, componentHourlyProfilesHasRequiredShape)
  && optionalRecordHasRequiredShape(value.analysis.composition, reportWindowCompositionHasRequiredShape)
);

const reportWindowCompositionHasRequiredShape = (value: Record<string, any>): boolean => (
  provenanceHasRequiredShape(value.provenance)
  && comparisonHasRequiredShape(value.comparison)
  && recordArrayHasRequiredShape(value.categories, categoryHasRequiredShape)
  && recordArrayHasRequiredShape(value.childScopes, childScopeHasRequiredShape)
  && recordArrayHasRequiredShape(value.circuits, circuitHasRequiredShape)
  && recordArrayHasRequiredShape(value.designatedTotals, circuitHasRequiredShape)
  && componentReconciliationHasRequiredShape(value.componentReconciliation)
  && optionalRecordArrayHasRequiredShape(value.virtualMeterTraces, virtualMeterTraceHasRequiredShape)
);

const reportWindowSegmentSummaryHasRequiredShape = (value: Record<string, any>): boolean => (
  hasStringFields(value, ["windowId", "status"])
  && value.status === "ready"
  && recordArrayHasRequiredShape(value.segments, (segment) => (
    hasStringFields(segment, ["dataStatus"])
    && isRecord(segment.period)
    && hasStringFields(segment.period, ["start", "endExclusive"])
    && hasFiniteNumberFields(segment, ["expectedDayCount", "completeDayCount"])
    && (segment.summary === null || (isRecord(segment.summary)
      && hasFiniteNumberFields(segment.summary, ["usageKwh", "averageDailyUsageKwh"])))
    && isRecord(segment.evidence)
    && hasStringFields(segment.evidence, ["dataSnapshotId", "queryId"])
  ))
);

const meterDataHealthProjectionHasRequiredShape = (value: Record<string, any>): boolean => (
  isRecord(value.summary)
  && hasFiniteNumberFields(value.summary, ["total", "usable", "insufficientHistory", "noReadings"])
  && recordArrayHasRequiredShape(value.meters, (meter) => (
    hasStringFields(meter, ["meterPointId", "sourceLabel", "status"])
    && hasFiniteNumberFields(meter, ["cumulativeReadingCount", "intervalFactCount"])
    && optionalStringFieldsHaveRequiredShape(meter, ["readingFrom", "readingTo", "coverageFrom", "coverageTo"])
  ))
);

const dailyTotalsHasRequiredShape = (value: Record<string, any>): boolean => (
  hasStringFields(value, ["metricId", "grain", "timezone"])
  && recordArrayHasRequiredShape(value.scopes, (scope) => (
    hasStringFields(scope, ["scopeId", "scopeName", "scopeType"])
    && recordArrayHasRequiredShape(scope.rows, (row) => (
      hasStringFields(row, ["localDate", "from", "to"])
      && isNullableFiniteNumber(row.usageKwh)
      && timeBucketDataHealthHasRequiredShape(row.dataHealth)
    ))
  ))
);

const timeBucketDataHealthHasRequiredShape = (value: unknown): value is Record<string, any> => (
  isRecord(value)
  && (value.status === "complete" || value.status === "partial" || value.status === "unavailable")
  && hasFiniteNumberFields(value, [
    "coveragePct", "expectedMeterIntervalCount", "validIntervalCount", "qualityEventCount",
  ])
);

const componentCategoryBreakdownHasRequiredShape = (value: Record<string, any>): boolean => (
  hasStringFields(value, ["metricId", "queryId", "accountingBasis", "grain", "timezone"])
  && recordArrayHasRequiredShape(value.scopes, (scope) => (
    hasStringFields(scope, ["scopeId", "scopeName", "scopeType"])
    && isRecord(scope.period)
    && hasStringFields(scope.period, ["status"])
    && nullableStringHasRequiredShape(scope.period.reason)
    && ["officialUsageKwh", "componentUsageKwh", "gapKwh", "ratioPct"]
      .every((field) => isNullableFiniteNumber(scope.period[field]))
    && recordArrayHasRequiredShape(scope.period.categories, categoryShareHasRequiredShape)
    && recordArrayHasRequiredShape(scope.rows, (row) => (
      hasStringFields(row, ["localDate", "from", "to"])
      && (row.dayType === null || typeof row.dayType === "string")
      && isNullableFiniteNumber(row.officialUsageKwh)
      && isNullableFiniteNumber(row.componentUsageKwh)
      && recordArrayHasRequiredShape(row.categories, categoryShareHasRequiredShape)
      && estimatedCostHasRequiredShape(row.estimatedCost)
      && timeBucketDataHealthHasRequiredShape(row.dataHealth)
    ))
  ))
);

const categoryShareHasRequiredShape = (value: Record<string, any>): boolean => (
  hasStringFields(value, ["category"])
  && isNullableFiniteNumber(value.usageKwh)
  && isNullableFiniteNumber(value.sharePct)
);

const estimatedCostHasRequiredShape = (value: unknown): boolean => {
  if (!isRecord(value) || !hasStringFields(value, ["status"])) return false;
  return value.status === "available"
    ? hasStringFields(value, ["currency", "tariffScheduleVersion"])
      && hasFiniteNumberFields(value, ["amount", "ratePerKwh"])
    : value.status === "unavailable" && hasStringFields(value, ["reason"]);
};

const calendarTotalsHasRequiredShape = (value: Record<string, any>): boolean => (
  hasStringFields(value, ["metricId", "timezone", "derivedFromQueryId"])
  && recordArrayHasRequiredShape(value.scopes, (scope) => (
    hasStringFields(scope, ["scopeId", "scopeName", "scopeType"])
    && recordArrayHasRequiredShape(scope.weeks, calendarTotalRowHasRequiredShape)
    && recordArrayHasRequiredShape(scope.months, calendarTotalRowHasRequiredShape)
  ))
);

const calendarTotalRowHasRequiredShape = (value: Record<string, any>): boolean => (
  hasStringFields(value, ["localFrom", "localToInclusive", "from", "to"])
  && isNullableFiniteNumber(value.usageKwh)
  && typeof value.isPartialCalendarPeriod === "boolean"
  && timeBucketDataHealthHasRequiredShape(value.dataHealth)
);

const timeBehaviourHasRequiredShape = (value: Record<string, any>): boolean => (
  hasStringFields(value, ["metricId", "grain", "unit", "timezone", "queryId"])
  && recordArrayHasRequiredShape(value.scopes, (scope) => (
    hasStringFields(scope, ["scopeId", "scopeName", "scopeType"])
    && recordArrayHasRequiredShape(scope.cells, (cell) => (
      hasStringFields(cell, ["localDate", "from", "to"])
      && isFiniteNumber(cell.localHour)
      && isNullableFiniteNumber(cell.usageKwh)
      && timeBucketDataHealthHasRequiredShape(cell.dataHealth)
    ))
  ))
  && recordArrayHasRequiredShape(value.dayProfiles, (profile) => (
    hasStringFields(profile, ["dayType", "scopeId", "scopeName", "status"])
    && (profile.status === "available"
      ? isFiniteNumber(profile.sampleDayCount)
        && recordArrayHasRequiredShape(profile.values, (point) => (
          hasFiniteNumberFields(point, ["localHour", "usageKwh"])
        ))
      : profile.status === "unavailable"
        && isRecord(profile.reason)
        && hasStringFields(profile.reason, ["code", "message"]))
  ))
);

const componentHourlyProfilesHasRequiredShape = (value: Record<string, any>): boolean => (
  hasStringFields(value, ["metricId", "queryId", "accountingBasis", "grain", "unit", "timezone"])
  && recordArrayHasRequiredShape(value.scopes, (scope) => (
    hasStringFields(scope, ["scopeId", "scopeName", "scopeType"])
    && recordArrayHasRequiredShape(scope.profiles, (profile) => (
      hasStringFields(profile, ["dayType", "status"])
      && (profile.status === "available"
        ? isFiniteNumber(profile.sampleDayCount)
          && recordArrayHasRequiredShape(profile.categories, (category) => (
            hasStringFields(category, ["category"])
            && recordArrayHasRequiredShape(category.values, hourUsagePointHasRequiredShape)
          ))
          && recordArrayHasRequiredShape(profile.circuits, (circuit) => (
            hasStringFields(circuit, ["meterNodeId", "name", "category"])
            && recordArrayHasRequiredShape(circuit.values, hourUsagePointHasRequiredShape)
          ))
        : profile.status === "unavailable"
          && isRecord(profile.reason)
          && hasStringFields(profile.reason, ["code", "message"]))
    ))
  ))
);

const hourUsagePointHasRequiredShape = (value: Record<string, any>): boolean => (
  hasFiniteNumberFields(value, ["localHour", "usageKwh"])
);

const dailyUsageAnomaliesHasRequiredShape = (value: Record<string, any>): boolean => {
  if (!hasStringFields(value, ["status", "ruleRevisionId"])) return false;
  if (value.status === "unavailable") {
    return isRecord(value.reason) && hasStringFields(value.reason, ["code", "message"]);
  }
  return value.status === "available"
    && hasStringFields(value, ["bundleId", "metricId", "queryId", "timezone", "baselineCutoff"])
    && dailyUsageAnomalyRuleHasRequiredShape(value.rule)
    && dailyUsageAnomalyEvidencePinsHasRequiredShape(value.evidencePins)
    && recordArrayHasRequiredShape(value.scopes, (scope) => (
      hasStringFields(scope, ["scopeId", "scopeName", "scopeType"])
      && recordArrayHasRequiredShape(scope.rollingComparisons, rollingUsageComparisonHasRequiredShape)
      && recordArrayHasRequiredShape(scope.rows, dailyUsageAnomalyRowHasRequiredShape)
    ));
};

const dailyUsageAnomalyRuleHasRequiredShape = (value: unknown): boolean => (
  isRecord(value)
  && hasFiniteNumberFields(value, [
    "relativeThresholdPct", "absoluteImpactKwh", "minimumCoveragePct", "minimumSampleCount",
    "maximumQualityEventCount", "maximumLookbackDays",
  ])
  && hasStringFields(value, ["direction", "baselineMethod"])
);

const dailyUsageAnomalyEvidencePinsHasRequiredShape = (value: unknown): boolean => (
  isRecord(value)
  && hasStringFields(value, [
    "projectReleaseId", "dataSnapshotId", "hierarchyRevisionId", "meterMappingRevisionId",
    "meterFormulaRevisionId", "metricVersion", "businessCalendarVersion",
  ])
  && isStringArray(value.queryIds)
);

const rollingUsageComparisonHasRequiredShape = (value: Record<string, any>): boolean => {
  if (!hasStringFields(value, ["horizon", "cutoffLocalDate"])
    || !usageComparisonPeriodHasRequiredShape(value.current)
    || !usageComparisonPeriodHasRequiredShape(value.baseline)) return false;
  if (value.status === "available") {
    return hasFiniteNumberFields(value, ["deltaKwh", "relativePct"]);
  }
  return value.status === "unavailable"
    && isRecord(value.reason)
    && hasStringFields(value.reason, ["code", "message"]);
};

const usageComparisonPeriodHasRequiredShape = (value: unknown): boolean => (
  isRecord(value)
  && hasStringFields(value, ["fromLocalDate", "toLocalDate"])
  && isNullableFiniteNumber(value.totalKwh)
  && isFiniteNumber(value.completeDayCount)
);

const dailyUsageAnomalyRowHasRequiredShape = (value: Record<string, any>): boolean => (
  hasStringFields(value, [
    "anomalyId", "incidentId", "ruleRevisionId", "metricId", "queryId", "localDate", "from", "to", "outcome",
  ])
  && (value.dayType === null || typeof value.dayType === "string")
  && isStringArray(value.baselineDates)
  && isFiniteNumber(value.baselineSampleCount)
  && recordArrayHasRequiredShape(value.baselineSamples, anomalyBaselineSampleHasRequiredShape)
  && ["actualKwh", "baselineKwh", "impactKwh", "relativePct"].every((field) => (
    isNullableFiniteNumber(value[field])
  ))
  && anomalyHealthHasRequiredShape(value)
  && isRecord(value.thresholds)
  && hasFiniteNumberFields(value.thresholds, [
    "relativeThresholdPct", "absoluteImpactKwh", "minimumCoveragePct", "maximumQualityEventCount",
  ])
  && (value.suppressionReason === undefined || (isRecord(value.suppressionReason)
    && hasStringFields(value.suppressionReason, ["code", "message"])))
  && recordArrayHasRequiredShape(value.hourlyComparison, anomalyHourlyComparisonPointHasRequiredShape)
  && recordArrayHasRequiredShape(value.detailSeries, anomalyDetailSeriesHasRequiredShape)
);

const anomalyBaselineSampleHasRequiredShape = (value: Record<string, any>): boolean => (
  hasStringFields(value, ["localDate"])
  && value.eligible === true
  && anomalyHealthHasRequiredShape(value)
);

const anomalyHealthHasRequiredShape = (value: Record<string, any>): boolean => (
  hasFiniteNumberFields(value, [
    "coveragePct", "expectedMeterIntervalCount", "validIntervalCount", "qualityEventCount",
  ])
);

const anomalyHourlyComparisonPointHasRequiredShape = (value: Record<string, any>): boolean => (
  isFiniteNumber(value.localHour)
  && ["actualKwh", "baselineKwh", "impactKwh", "relativePct"].every((field) => (
    isNullableFiniteNumber(value[field])
  ))
);

const anomalyDetailSeriesHasRequiredShape = (value: Record<string, any>): boolean => (
  hasStringFields(value, ["seriesId", "relationship", "kind", "scopeId", "scopeName", "status"])
  && (value.meterNodeId === undefined || typeof value.meterNodeId === "string")
  && (value.category === undefined || typeof value.category === "string")
  && typeof value.includedInOfficialTotal === "boolean"
  && ["selectedTotalKwh", "baselineTotalKwh", "impactKwh", "relativePct"].every((field) => (
    isNullableFiniteNumber(value[field])
  ))
  && anomalyHealthHasRequiredShape(value)
  && recordArrayHasRequiredShape(value.points, (point) => (
    isFiniteNumber(point.localHour)
    && ["selectedKwh", "baselineKwh", "impactKwh"].every((field) => (
      isNullableFiniteNumber(point[field])
    ))
  ))
);

const peakBreakdownHasRequiredShape = (value: Record<string, any>): boolean => {
  if (!hasStringFields(value, ["status"])) return false;
  if (value.status === "unavailable") {
    return isRecord(value.reason) && hasStringFields(value.reason, ["code", "message"]);
  }
  return value.status === "available"
    && hasStringFields(value, ["metricId", "timezone", "unit", "periodStatus"])
    && hasFiniteNumberFields(value, ["intervalMinutes", "coveragePct"])
    && isRecord(value.peak)
    && hasStringFields(value.peak, ["from", "to"])
    && isFiniteNumber(value.peak.averageKw)
    && recordArrayHasRequiredShape(value.levels, (level) => (
      hasStringFields(level, ["scopeId", "scopeName"])
      && hasFiniteNumberFields(level, ["averageKw", "sharePct"])
      && recordArrayHasRequiredShape(level.circuits, (circuit) => (
        hasStringFields(circuit, ["meterNodeId", "name", "category"])
        && isNullableFiniteNumber(circuit.averageKw)
        && isNullableFiniteNumber(circuit.sharePct)
      ))
    ));
};

const virtualMeterTraceHasRequiredShape = (value: Record<string, any>): boolean => (
  hasStringFields(value, ["meterNodeId", "name", "scopeId", "status"])
  && isNullableFiniteNumber(value.usageKwh)
  && value.includedInOfficialTotal === false
  && recordArrayHasRequiredShape(value.terms, (term) => (
    hasStringFields(term, ["meterNodeId", "name"])
    && (term.coefficient === 1 || term.coefficient === -1)
    && isNullableFiniteNumber(term.inputUsageKwh)
    && isNullableFiniteNumber(term.contributionKwh)
    && timeBucketDataHealthHasRequiredShape(term.dataHealth)
  ))
  && isStringArray(value.missingTermMeterNodeIds)
);

const tariffAllocationHasRequiredShape = (value: Record<string, any>): boolean => (
  hasStringFields(value, ["from", "to"])
  && hasFiniteNumberFields(value, ["ratePerKwh", "usageKwh", "cost"])
  && (value.rateBasis === undefined || typeof value.rateBasis === "string")
  && optionalFiniteNumberFieldsHaveRequiredShape(value, ["taxInclusiveRatePerKwh", "taxExclusiveRatePerKwh"])
  && optionalRecordHasRequiredShape(value.tax, (tax) => (
    hasStringFields(tax, ["name"]) && isFiniteNumber(tax.ratePct)
  ))
);

const decisionPrioritiesHasRequiredShape = (value: Record<string, any>): boolean => (
  hasStringFields(value, ["status"])
  && ["available", "empty", "partial", "suppressed", "unavailable"].includes(value.status)
  && (value.limitation === null || (isRecord(value.limitation)
    && hasStringFields(value.limitation, ["code", "message"])))
  && isRecord(value.evidencePins)
  && hasStringFields(value.evidencePins, [
    "projectReleaseId", "dataSnapshotId", "hierarchyRevisionId", "meterMappingRevisionId",
    "meterFormulaRevisionId", "metricVersion", "businessCalendarVersion",
  ])
  && isStringArray(value.evidencePins.queryIds)
  && recordArrayHasRequiredShape(value.items, decisionPriorityHasRequiredShape)
);

const decisionPriorityHasRequiredShape = (value: Record<string, any>): boolean => (
  hasStringFields(value, ["priorityId", "source"])
  && value.source === "daily_usage_anomaly"
  && [1, 2, 3].includes(value.rank)
  && isRecord(value.finding)
  && hasStringFields(value.finding, ["code", "title"])
  && value.finding.code === "DAILY_USAGE_ABOVE_BASELINE"
  && hasFiniteNumberFields(value.finding, ["actualKwh", "baselineKwh", "relativePct"])
  && isStringArray(value.sourceOccurrenceIds)
  && isPositiveSafeInteger(value.recurrenceDayCount)
  && recordArrayHasRequiredShape(value.horizons, decisionPriorityHorizonHasRequiredShape)
  && decisionPriorityDriverHasRequiredShape(value.driver)
  && decisionPriorityEvidenceHasRequiredShape(value.evidence)
  && decisionPriorityImpactHasRequiredShape(value.impact)
  && decisionPriorityActionHasRequiredShape(value.action)
  && decisionPriorityConfidenceHasRequiredShape(value.confidence)
);

const decisionPriorityHorizonHasRequiredShape = (value: Record<string, any>): boolean => (
  hasStringFields(value, ["horizon", "label", "status"])
  && ["latest_complete_day", "rolling_7d", "rolling_28d"].includes(value.horizon)
  && ["available", "unavailable"].includes(value.status)
  && isRecord(value.period)
  && hasStringFields(value.period, ["fromLocalDate", "toLocalDate"])
  && ["actualKwh", "baselineKwh", "deltaKwh", "relativePct"]
    .every((field) => isNullableFiniteNumber(value[field]))
  && nullableStringHasRequiredShape(value.limitation)
);

const decisionPriorityDriverHasRequiredShape = (value: unknown): boolean => {
  if (!isRecord(value) || !hasStringFields(value, ["status", "limitation"])) return false;
  if (value.status === "unavailable") return true;
  return value.status === "available"
    && hasStringFields(value, ["kind", "scopeId", "label"])
    && ["official_scope", "component_circuit"].includes(value.kind)
    && isFiniteNumber(value.impactKwh);
};

const decisionPriorityEvidenceHasRequiredShape = (value: unknown): boolean => (
  isRecord(value)
  && hasStringFields(value, ["bundleId", "metricId", "ruleRevisionId", "primaryIncidentId"])
  && isStringArray(value.queryIds)
  && isRecord(value.period)
  && hasStringFields(value.period, ["from", "to"])
  && isRecord(value.occurrence)
  && hasStringFields(value.occurrence, [
    "scopeId", "scopeName", "scopeType", "localDate", "from", "to",
  ])
  && isStringArray(value.supportingIncidentIds)
);

const decisionPriorityImpactHasRequiredShape = (value: unknown): boolean => (
  isRecord(value)
  && isRecord(value.energy)
  && value.energy.status === "available"
  && isFiniteNumber(value.energy.deltaKwh)
  && isRecord(value.cost)
  && value.cost.status === "unavailable"
  && isRecord(value.cost.reason)
  && hasStringFields(value.cost.reason, ["code", "message"])
);

const decisionPriorityActionHasRequiredShape = (value: unknown): boolean => (
  isRecord(value)
  && hasStringFields(value, ["code", "label", "targetIncidentId", "nextCheck"])
  && value.code === "INSPECT_DAILY_USAGE_DRIVERS"
  && isRecord(value.targetRef)
  && value.targetRef.kind === "daily_usage_incident"
  && typeof value.targetRef.id === "string"
  && isRecord(value.verificationMetricRef)
  && hasStringFields(value.verificationMetricRef, ["metricId", "label"])
);

const decisionPriorityConfidenceHasRequiredShape = (value: unknown): boolean => (
  isRecord(value)
  && ["complete", "partial"].includes(value.status)
  && (value.limitation === null || (isRecord(value.limitation)
    && hasStringFields(value.limitation, ["code", "message"])))
);

const preschoolBenchmarkHasRequiredShape = (value: Record<string, any>): boolean => (
  value.status === "provisional"
  && isRecord(value.contract)
  && hasStringFields(value.contract, ["id", "version"])
  && isFiniteNumber(value.contract.annualisationFactor)
  && periodHasRequiredShape(value.period)
  && isFiniteNumber(value.sampleSize)
  && isRecord(value.portfolio)
  && percentilePairHasRequiredShape(value.portfolio.eui)
  && percentilePairHasRequiredShape(value.portfolio.perPax)
  && recordArrayHasRequiredShape(value.cohorts, (cohort) => (
    hasStringFields(cohort, ["name"])
    && isFiniteNumber(cohort.sampleSize)
    && percentilePairHasRequiredShape(cohort.eui)
    && percentilePairHasRequiredShape(cohort.perPax)
  ))
  && recordArrayHasRequiredShape(value.centres, (centre) => (
    hasStringFields(centre, ["scopeId", "centreCode", "name", "cohort", "quadrant"])
    && hasFiniteNumberFields(centre, ["usageKwh", "annualisedEuiKwhPerSqmYear", "mayKwhPerPerson"])
    && typeof centre.priority === "boolean"
  ))
  && isStringArray(value.priorityCentreCodes)
  && isRecord(value.evidence)
  && hasStringFields(value.evidence, [
    "projectReleaseId", "dataSnapshotId", "hierarchyRevisionId", "meterMappingRevisionId",
    "cohortSource", "metadataStatus",
  ])
  && isStringArray(value.evidence.metricRevisionIds)
  && isStringArray(value.evidence.metadataRevisionIds)
  && isStringArray(value.evidence.sourceQueryIds)
  && isStringArray(value.evidence.projectionRecipeIds)
  && isRecord(value.evidence.normalisation)
  && hasStringFields(value.evidence.normalisation, ["eui", "perPax"])
);

const percentilePairHasRequiredShape = (value: unknown): boolean => (
  isRecord(value)
  && hasFiniteNumberFields(value, ["p50", "p75"])
  && hasStringFields(value, ["unit"])
);

const preschoolAppliancesHasRequiredShape = (value: Record<string, any>): boolean => {
  if (!hasStringFields(value, ["status"]) || !isRecord(value.evidence)) return false;
  if (value.status === "unavailable") {
    return isRecord(value.reason)
      && hasStringFields(value.reason, ["code", "message"])
      && hasStringFields(value.evidence, [
        "projectReleaseId", "dataSnapshotId", "hierarchyRevisionId", "meterMappingRevisionId", "sourceKind",
      ]);
  }
  return value.status === "available"
    && isRecord(value.contract)
    && hasStringFields(value.contract, ["id", "version", "aliasContractId", "sourceKind"])
    && periodHasRequiredShape(value.period)
    && isFiniteNumber(value.totalKwh)
    && recordArrayHasRequiredShape(value.appliances, (appliance) => (
      hasStringFields(appliance, ["name", "applianceGroup"])
      && hasFiniteNumberFields(appliance, ["usageKwh", "sharePct", "centreCount"])
      && isStringArray(appliance.sourceCircuitIds)
    ))
    && hasStringFields(value.evidence, [
      "projectReleaseId", "dataSnapshotId", "hierarchyRevisionId", "meterMappingRevisionId",
      "projectionRecipeId", "sourceKind",
    ])
    && isStringArray(value.evidence.sourceQueryIds)
    && isFiniteNumber(value.evidence.reconciliationGapKwh);
};

const preschoolOperationalHasRequiredShape = (value: Record<string, any>): boolean => {
  if (!hasStringFields(value, ["status"])) return false;
  if (value.status === "unavailable") {
    return isRecord(value.reason)
      && hasStringFields(value.reason, ["code", "message"])
      && isRecord(value.evidence)
      && hasStringFields(value.evidence, ["projectReleaseId", "dataSnapshotId", "businessCalendarVersion"]);
  }
  return value.status === "available"
    && isRecord(value.contract)
    && hasStringFields(value.contract, ["id", "version"])
    && isFiniteNumber(value.contract.spikeThresholdPct)
    && periodHasRequiredShape(value.period)
    && optionalRecordHasRequiredShape(value.coverage, (coverage) => (
      hasStringFields(coverage, ["status"])
      && hasFiniteNumberFields(coverage, [
        "expectedCellCount", "observedCellCount", "missingCellCount", "completeLocalDayCount",
        "partialLocalDayCount", "missingLocalHourCount",
      ])
    ))
    && isRecord(value.energy)
    && hasFiniteNumberFields(value.energy, ["totalKwh", "standbyKwh", "standbySharePct", "operatingKwh", "operatingSharePct"])
    && isNullableFiniteNumber(value.energy.provisionalStandbyCostBeforeGstSgd)
    && isNullableFiniteNumber(value.energy.provisionalOperatingCostBeforeGstSgd)
    && optionalRecordHasRequiredShape(value.tariffCost, preschoolOperationalTariffCostHasRequiredShape)
    && optionalRecordHasRequiredShape(value.tariffReference, preschoolTariffReferenceHasRequiredShape)
    && preschoolOperationalApplianceCompositionHasRequiredShape(value.standbyAppliances)
    && preschoolOperationalApplianceCompositionHasRequiredShape(value.operatingAppliances)
    && preschoolOperationalHourlyProfileHasRequiredShape(value.hourlyProfile)
    && preschoolPlanningOutlookHasRequiredShape(value.planningOutlook)
    && isRecord(value.spikes)
    && preschoolOperationalSpikeGroupHasRequiredShape(value.spikes.standby)
    && preschoolOperationalSpikeGroupHasRequiredShape(value.spikes.operating)
    && isRecord(value.sop)
    && hasStringFields(value.sop, ["status", "label"])
    && hasFiniteNumberFields(value.sop, ["baselineScore", "deductionPerStandbySpike"])
    && isStringArray(value.sop.breachingCentreCodes)
    && recordArrayHasRequiredShape(value.sop.centres, (centre) => (
      hasStringFields(centre, ["scopeId", "centreCode", "name"])
      && (centre.centreType === null || typeof centre.centreType === "string")
      && hasFiniteNumberFields(centre, ["standbySpikeCount", "score"])
    ))
    && isRecord(value.evidence)
    && hasStringFields(value.evidence, [
      "projectReleaseId", "dataSnapshotId", "hierarchyRevisionId", "meterMappingRevisionId",
      "businessCalendarVersion", "projectionQueryId", "baseline",
    ])
    && isStringArray(value.evidence.metricRevisionIds)
    && isStringArray(value.evidence.sourceQueryIds)
    && isStringArray(value.evidence.projectionRecipeIds)
    && optionalRecordHasRequiredShape(value.analysisReady, preschoolOperationalAnalysisReadyHasRequiredShape);
};

const preschoolOperationalTariffCostHasRequiredShape = (value: Record<string, any>): boolean => {
  if (!hasStringFields(value, ["status"])) return false;
  if (value.status === "unavailable") {
    return isRecord(value.reason) && hasStringFields(value.reason, ["code", "message"]);
  }
  const subtotalHasRequiredShape = (subtotal: unknown): boolean => (
    isRecord(subtotal) && hasFiniteNumberFields(subtotal, ["usageKwh", "amount"])
  );
  return value.status === "available"
    && hasStringFields(value, ["currency", "tariffScheduleVersion"])
    && recordArrayHasRequiredShape(value.allocations, tariffAllocationHasRequiredShape)
    && subtotalHasRequiredShape(value.total)
    && subtotalHasRequiredShape(value.standby)
    && subtotalHasRequiredShape(value.operating);
};

const preschoolTariffReferenceHasRequiredShape = (value: Record<string, any>): boolean => (
  hasStringFields(value, [
    "sourceName", "sourceUrl", "appendixUrl", "supplyClass", "appliesFrom", "appliesTo",
  ])
  && hasFiniteNumberFields(value, ["beforeGstSgdPerKwh", "withGstSgdPerKwh"])
);

const preschoolOperationalAnalysisReadyHasRequiredShape = (value: Record<string, any>): boolean => (
  isRecord(value.contract)
  && hasStringFields(value.contract, [
    "id", "version", "eventCapturePolicy", "recurrenceGrain", "similarCentreBasis",
  ])
  && hasFiniteNumberFields(value.contract, ["maximumCellCount", "minimumPatternComparableObservationCount"])
  && isRecord(value.eventCatalog)
  && hasStringFields(value.eventCatalog, ["status"])
  && hasFiniteNumberFields(value.eventCatalog, ["boundedCellCount", "totalEventCount", "capturedEventCount"])
  && value.eventCatalog.truncated === false
  && recordArrayHasRequiredShape(value.eventCatalog.events, preschoolOperationalEventHasRequiredShape)
  && isRecord(value.recurrence)
  && hasStringFields(value.recurrence, ["status"])
  && recordArrayHasRequiredShape(value.recurrence.rows, preschoolOperationalRecurrenceHasRequiredShape)
  && isRecord(value.contextAvailability)
  && unavailableOperationalContextHasRequiredShape(value.contextAvailability.mustRunSchedule)
  && unavailableOperationalContextHasRequiredShape(value.contextAvailability.equipmentState)
);

const preschoolOperationalEventHasRequiredShape = (value: Record<string, any>): boolean => (
  hasStringFields(value, [
    "id", "operatingState", "scopeId", "centreCode", "centreName", "localDate", "dayType", "leadingCircuitName",
  ])
  && (value.centreType === null || typeof value.centreType === "string")
  && hasFiniteNumberFields(value, [
    "localHour", "usageKwh", "baselineKwh", "impactKwh", "variancePct", "leadingCircuitKwh", "leadingCircuitSharePct",
  ])
  && isRecord(value.boundary)
  && hasStringFields(value.boundary, ["relation", "scheduleSource"])
  && recordArrayHasRequiredShape(value.circuits, (circuit) => (
    hasStringFields(circuit, ["circuitId", "name", "category", "sourceName", "role", "centreCircuitLinkKey"])
    && hasFiniteNumberFields(circuit, ["usageKwh", "sharePct"])
  ))
);

const preschoolOperationalRecurrenceHasRequiredShape = (value: Record<string, any>): boolean => (
  hasStringFields(value, [
    "key", "centreCircuitLinkKey", "operatingState", "scopeId", "centreCode", "centreName", "circuitId", "circuitName",
  ])
  && (value.centreType === null || typeof value.centreType === "string")
  && hasFiniteNumberFields(value, [
    "localHour", "eventCount", "leadingEventCount", "comparableObservationCount", "eventRecurrencePct",
  ])
  && isRecord(value.dayTypeEventCounts)
  && hasFiniteNumberFields(value.dayTypeEventCounts, ["weekday", "weekend", "calendarException"])
  && isRecord(value.circuitPresence)
  && hasStringFields(value.circuitPresence, ["status"])
  && isRecord(value.patternEvidence)
  && hasStringFields(value.patternEvidence, ["status", "interpretationStatus"])
  && isRecord(value.counterexamples)
  && hasStringFields(value.counterexamples, ["status", "comparisonBasis"])
  && isStringArray(value.eventIds)
);

const unavailableOperationalContextHasRequiredShape = (value: unknown): boolean => (
  isRecord(value) && hasStringFields(value, ["status", "reason"])
);

const preschoolOperationalApplianceCompositionHasRequiredShape = (value: unknown): boolean => (
  isRecord(value)
  && hasFiniteNumberFields(value, ["totalKwh", "reconciliationGapKwh"])
  && isNullableFiniteNumber(value.provisionalCostBeforeGstSgd)
  && recordArrayHasRequiredShape(value.applianceGroups, (group) => (
    hasStringFields(group, ["name"])
    && hasFiniteNumberFields(group, ["usageKwh", "sharePct"])
    && isNullableFiniteNumber(group.provisionalCostBeforeGstSgd)
    && isStringArray(group.sourceAliases)
  ))
  && recordArrayHasRequiredShape(value.appliances, (appliance) => (
    hasStringFields(appliance, ["name", "applianceGroup"])
    && hasFiniteNumberFields(appliance, ["usageKwh", "sharePct", "centreCount"])
    && isNullableFiniteNumber(appliance.provisionalCostBeforeGstSgd)
    && isStringArray(appliance.sourceCircuitIds)
  ))
);

const preschoolOperationalHourlyProfileHasRequiredShape = (value: unknown): boolean => (
  isRecord(value)
  && hasStringFields(value, ["unit"])
  && isFiniteNumber(value.completeDayCount)
  && recordArrayHasRequiredShape(value.rows, (row) => (
    hasFiniteNumberFields(row, ["localHour", "operatingKwh", "closedHourKwh", "totalKwh"])
    && optionalFiniteNumberFieldsHaveRequiredShape(row, ["observedDayCount"])
  ))
);

const preschoolPlanningOutlookHasRequiredShape = (value: unknown): boolean => {
  if (!isRecord(value) || !hasStringFields(value, ["status"])) return false;
  if (value.status === "unavailable") {
    return isRecord(value.reason) && hasStringFields(value.reason, ["code", "message"]);
  }
  return value.status === "provisional"
    && isRecord(value.contract)
    && hasStringFields(value.contract, ["id", "version", "method"])
    && isRecord(value.targetPeriod)
    && hasStringFields(value.targetPeriod, ["start", "endInclusive", "endExclusive", "timezone"])
    && isFiniteNumber(value.targetPeriod.days)
    && recordArrayHasRequiredShape(value.sourceWeeks, (week) => (
      hasStringFields(week, ["start", "endInclusive"])
      && isFiniteNumber(week.usageKwh)
    ))
    && isRecord(value.weeklyBaseline)
    && hasFiniteNumberFields(value.weeklyBaseline, ["averageKwh", "minimumKwh", "maximumKwh"])
    && isRecord(value.usageEstimate)
    && hasFiniteNumberFields(value.usageEstimate, ["projectedKwh", "lowerKwh", "upperKwh"])
    && isRecord(value.evidence)
    && hasStringFields(value.evidence, ["dataSnapshotId", "queryId", "recipeId"])
    && isStringArray(value.limitations);
};

const preschoolOperationalSpikeGroupHasRequiredShape = (value: unknown): boolean => (
  isRecord(value)
  && hasFiniteNumberFields(value, ["count", "centreCount"])
  && recordArrayHasRequiredShape(value.centres, (centre) => (
    hasStringFields(centre, ["scopeId", "centreCode", "name"])
    && (centre.centreType === null || typeof centre.centreType === "string")
    && isFiniteNumber(centre.spikeCount)
    && preschoolOperationalSpikeHasRequiredShape(centre.worstSpike)
    && recordArrayHasRequiredShape(centre.events, preschoolOperationalSpikeHasRequiredShape)
  ))
);

const preschoolOperationalSpikeHasRequiredShape = (value: unknown): boolean => (
  isRecord(value)
  && hasStringFields(value, ["localDate", "dayType", "leadingCircuitName"])
  && hasFiniteNumberFields(value, [
    "localHour", "usageKwh", "baselineKwh", "impactKwh", "variancePct", "leadingCircuitKwh", "leadingCircuitSharePct",
  ])
);

const monthlyTargetPeriodHasRequiredShape = (value: unknown): boolean => (
  isRecord(value)
  && hasStringFields(value, ["start", "endExclusive", "timezone"])
  && isFiniteNumber(value.targetDayCount)
);

const preschoolDecisionSignalsHasRequiredShape = (value: Record<string, any>): boolean => (
  hasStringFields(value, ["status"])
  && isRecord(value.contract)
  && hasStringFields(value.contract, ["id", "version"])
  && isRecord(value.context)
  && hasStringFields(value.context, ["projectReleaseId", "dataSnapshotId"])
  && periodHasRequiredShape(value.context.period)
  && (value.reason === undefined || (isRecord(value.reason) && hasStringFields(value.reason, ["code", "message"])))
  && recordArrayHasRequiredShape(value.items, (item) => (
    hasStringFields(item, ["id", "kind", "sectionId", "severity", "label"])
    && isFiniteNumber(item.priority)
    && recordArrayHasRequiredShape(item.metrics, (metric) => (
      hasStringFields(metric, ["id", "label", "metricId", "unit", "role"])
      && hasFiniteNumberFields(metric, ["value", "precision"])
      && isRecord(metric.dimensions)
      && Object.values(metric.dimensions).every((dimension) => typeof dimension === "string")
    ))
    && recordArrayHasRequiredShape(item.entities, (entity) => (
      hasStringFields(entity, ["kind", "scopeId", "code", "name"])
    ))
    && isStringArray(item.evidenceRefs)
    && recordArrayHasRequiredShape(item.limitations, (limitation) => hasStringFields(limitation, ["code", "label"]))
  ))
);

const periodHasRequiredShape = (value: unknown): value is Record<string, any> => (
  isRecord(value) && hasStringFields(value, ["start", "endExclusive", "timezone"])
);

const hasStringFields = (value: Record<string, any>, fields: readonly string[]): boolean => (
  fields.every((field) => typeof value[field] === "string")
);

const hasFiniteNumberFields = (value: Record<string, any>, fields: readonly string[]): boolean => (
  fields.every((field) => isFiniteNumber(value[field]))
);

const optionalFiniteNumberFieldsHaveRequiredShape = (
  value: Record<string, any>,
  fields: readonly string[],
): boolean => fields.every((field) => value[field] === undefined || isFiniteNumber(value[field]));

const optionalStringFieldsHaveRequiredShape = (
  value: Record<string, any>,
  fields: readonly string[],
): boolean => fields.every((field) => value[field] === undefined || typeof value[field] === "string");

const isFiniteNumber = (value: unknown): value is number => (
  typeof value === "number" && Number.isFinite(value)
);

const isNullableFiniteNumber = (value: unknown): value is number | null => (
  value === null || isFiniteNumber(value)
);

const nullableStringHasRequiredShape = (value: unknown): value is string | null => (
  value === null || typeof value === "string"
);

const isStringArray = (value: unknown): value is string[] => (
  Array.isArray(value) && value.every((item) => typeof item === "string")
);

const recordArrayHasRequiredShape = (
  value: unknown,
  predicate: (item: Record<string, any>) => boolean = () => true,
): value is Array<Record<string, any>> => (
  Array.isArray(value) && value.every((item) => isRecord(item) && predicate(item))
);

const optionalRecordArrayHasRequiredShape = (
  value: unknown,
  predicate: (item: Record<string, any>) => boolean = () => true,
): boolean => (
  value === undefined || recordArrayHasRequiredShape(value, predicate)
);

const optionalRecordHasRequiredShape = (
  value: unknown,
  predicate: (item: Record<string, any>) => boolean = () => true,
): boolean => value === undefined || (isRecord(value) && predicate(value));

const isRecord = (value: unknown): value is Record<string, any> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

const sameStringSequence = (left: readonly string[], right: readonly string[]): boolean => (
  left.length === right.length && left.every((value, index) => value === right[index])
);

export const managedProjectionRuleRevisionIdsMatchIdentity = (
  actual: readonly string[],
  expected: readonly string[],
): boolean => {
  if (actual.length !== expected.length) return false;
  const actualIds = new Set(actual);
  const expectedIds = new Set(expected);
  return actualIds.size === actual.length
    && expectedIds.size === expected.length
    && actualIds.size === expectedIds.size
    && [...actualIds].every((id) => expectedIds.has(id));
};

const reportTimeContextMatchesIdentity = (
  metadataStore: MetadataStore,
  snapshot: ProjectAnalysisSnapshot,
  identity: ProjectOverviewProjectionIdentity,
  requireDeclaredReportWindow: boolean,
): boolean => {
  const context = snapshot.reportTimeContext;
  if (!context
    || `${context.policyId}@${context.policyRevision}` !== identity.reportTimePolicyRevisionId
    || context.timezone !== identity.timezone
    || context.acceptedDataEndExclusive !== identity.to
    || context.lastRefreshedAt !== context.asOf
    || context.binding.workspaceId !== identity.workspaceId
    || context.binding.projectId !== identity.projectId
    || context.binding.scopeId !== identity.scopeId
    || context.binding.resource !== identity.resource
    || context.binding.dataSnapshotId !== identity.dataSnapshotId
    || context.binding.projectReleaseId !== identity.projectReleaseId
    || (requireDeclaredReportWindow && !context.windows.some((window) => (
      window.from === identity.from && window.toExclusive === identity.to
    )))) return false;
  try {
    const policy = resolveSnapshotReportTimePolicy({
      metadataStore,
      projectRelease: snapshot.projectRelease,
    });
    if (!policy) return false;
    return isDeepStrictEqual(context, resolveReportTimeContext({
      binding: context.binding,
      timezone: context.timezone,
      asOf: context.asOf,
      acceptedDataEndExclusive: context.acceptedDataEndExclusive,
      lastRefreshedAt: context.lastRefreshedAt,
      policy,
    }));
  } catch {
    return false;
  }
};

const evidenceMatchesAnalysisProvenance = (snapshot: ProjectAnalysisSnapshot): boolean => {
  const queryIds = new Set(snapshot.analysis.provenance.queryIds);
  const evidenceIds = new Set<string>();
  return snapshot.evidence.every((evidence) => {
    if (!evidence.id || evidenceIds.has(evidence.id)) return false;
    evidenceIds.add(evidence.id);
    return evidence.queryIds.every((queryId) => queryIds.has(queryId));
  });
};

const managedProjectionEvidencePinsMatchIdentity = (
  snapshot: ProjectAnalysisSnapshot,
  identity: ProjectOverviewProjectionIdentity,
): boolean => {
  const expected = {
    projectReleaseId: identity.projectReleaseId,
    dataSnapshotId: identity.dataSnapshotId,
    hierarchyRevisionId: identity.hierarchyRevisionId,
    meterMappingRevisionId: identity.meterMappingRevisionId,
    meterFormulaRevisionId: identity.meterFormulaRevisionId,
    metricVersion: identity.metricVersion,
    businessCalendarVersion: identity.businessCalendarVersion,
    queryIds: ["time_slot_anomaly_v1"] as const,
  };
  if (snapshot.analysis.dailyUsageAnomalies?.status === "available"
    && !snapshot.analysis.provenance.queryIds.includes(expected.queryIds[0]!)) {
    return false;
  }
  const anomalyPinsMatch = snapshot.analysis.dailyUsageAnomalies?.status !== "available"
    || isDeepStrictEqual(snapshot.analysis.dailyUsageAnomalies.evidencePins, expected);
  const decisionPinsMatch = snapshot.decisionPriorities === undefined
    || isDeepStrictEqual(snapshot.decisionPriorities.evidencePins, expected);
  return anomalyPinsMatch && decisionPinsMatch;
};

const schoolHolidayProjectionMatchesIdentity = (
  metadataStore: MetadataStore,
  snapshot: ProjectAnalysisSnapshot,
  identity: ProjectOverviewProjectionIdentity,
): boolean => {
  if (snapshot.renderer.key !== "ngee-ann-overview") {
    return snapshot.sectionManifest === undefined && snapshot.schoolHolidayComparison === undefined;
  }
  let authoritativeManifest: NgeeAnnSectionManifest;
  try {
    authoritativeManifest = resolveNgeeAnnSectionManifestForRelease(metadataStore, identity.projectReleaseId);
  } catch {
    return false;
  }
  const holidayEnabled = authoritativeManifest.enabledSectionIds
    .includes(NGEE_ANN_SCHOOL_HOLIDAY_SECTION_ID);
  if (snapshot.sectionManifest === undefined) {
    if (holidayEnabled) return false;
  } else if (!isDeepStrictEqual(snapshot.sectionManifest, authoritativeManifest)) {
    return false;
  }
  const project = metadataStore.energyIq.getProject(identity.projectId);
  if (!holidayEnabled || identity.scopeId !== project.root_scope_id) {
    return snapshot.schoolHolidayComparison === undefined;
  }
  const comparison = snapshot.schoolHolidayComparison;
  return comparison !== undefined
    && comparison.identity.projectId === identity.projectId
    && comparison.identity.scopeId === identity.scopeId
    && comparison.identity.dataSnapshotId === identity.dataSnapshotId
    && comparison.identity.projectReleaseId === identity.projectReleaseId
    && comparison.identity.businessCalendarVersion === identity.businessCalendarVersion
    && comparison.identity.reportTimePolicyRevision === identity.reportTimePolicyRevisionId
    && comparison.identity.ruleRevision === SCHOOL_HOLIDAY_COMPARISON_RULE_REVISION
    && comparison.identity.comparisonWindowId === NGEE_ANN_SCHOOL_HOLIDAY_SECTION_ID
    && snapshot.reportTimeContext !== undefined
    && schoolHolidayComparisonMatchesReportTimeContext(comparison, snapshot.reportTimeContext);
};

const managedProjectionFactsEquivalent = (
  left: ReadyProjectAnalysisResolution,
  right: ReadyProjectAnalysisResolution,
): boolean => {
  const normalizedLeft = withoutVolatileReportTimeObservation(left);
  const normalizedRight = withoutVolatileReportTimeObservation(right);
  return isDeepStrictEqual(normalizedLeft, normalizedRight);
};

const rebindManagedProjectionActor = (
  resolution: ReadyProjectAnalysisResolution,
  userId: string,
): ReadyProjectAnalysisResolution => ({
  ...resolution,
  snapshot: {
    ...resolution.snapshot,
    context: {
      ...resolution.snapshot.context,
      userId,
    },
    analysis: {
      ...resolution.snapshot.analysis,
      context: {
        ...resolution.snapshot.analysis.context,
        userId,
      },
    },
  },
});

const withoutVolatileReportTimeObservation = (
  resolution: ReadyProjectAnalysisResolution,
): ReadyProjectAnalysisResolution => ({
  ...resolution,
  snapshot: {
    ...resolution.snapshot,
    context: {
      ...resolution.snapshot.context,
      resolvedAt: "",
    },
    ...(resolution.snapshot.reportTimeContext ? {
        reportTimeContext: {
          ...resolution.snapshot.reportTimeContext,
          asOf: "",
          lastRefreshedAt: "",
        },
      } : {}),
    analysis: {
      ...resolution.snapshot.analysis,
      context: {
        ...resolution.snapshot.analysis.context,
        resolvedAt: "",
      },
    },
  },
});

const projectReleaseMatchesAuthoritativeMetadata = (
  metadataStore: MetadataStore,
  overviewDefinitionRevisionId: string,
  projectRelease: PublishedProjectRelease,
): boolean => {
  const profile = resolveProjectOverviewProfileForRelease(metadataStore, projectRelease);
  if (!profile) return false;
  if (projectRelease.templateRevisionId) {
    const revision = metadataStore.energyIq.templates.getProjectRevision(
      projectRelease.templateRevisionId,
    );
    const definition = metadataStore.energyIq.overviewDefinitions.get(
      projectRelease.templateRevisionId,
    );
    return revision !== null
      && definition !== null
      && overviewDefinitionRevisionId
        === `${definition.template_revision_id}:${definition.definition_fingerprint}`
      && revision.revision_id === projectRelease.id
      && revision.project_id === projectRelease.projectId
      && revision.sequence === projectRelease.templateRevisionSequence
      && revision.hierarchy_revision_id === projectRelease.hierarchyRevisionId
      && revision.meter_mapping_revision_id === projectRelease.meterMappingRevisionId
      && revision.meter_formula_revision_id === projectRelease.meterFormulaRevisionId
      && sameStringSequence(revision.selected_metric_revision_ids, projectRelease.metricRevisionIds)
      && sameStringSequence(revision.selected_rule_revision_ids, projectRelease.ruleRevisionIds)
      && revision.business_calendar_version === projectRelease.businessCalendarVersion
      && revision.tariff_schedule_version === projectRelease.tariffScheduleVersion
      && revision.published_at === projectRelease.publishedAt
      && isDeepStrictEqual(revision.document, projectRelease.document);
  }
  return overviewDefinitionRevisionId
    === [
      "legacy",
      projectRelease.id,
      profile.primaryWindowId,
      projectReleaseDocumentFingerprint(projectRelease.document),
    ].join(":");
};

const projectReleaseDocumentFingerprint = (
  document: EnergyIqTemplateDraftDocument,
): string => createHash("sha256").update(JSON.stringify(document)).digest("hex");

const toOverviewContextPackage = (
  identity: ProjectOverviewProjectionIdentity,
  snapshot: ProjectAnalysisSnapshot,
): OverviewContextPackage => ({
  contract: "energyiq-overview-context-package@1",
  projectionRef: createProjectOverviewProjectionRef(createProjectOverviewProjectionKey(identity)),
  identity,
  snapshot,
  evidenceRefs: snapshot.evidence.map((evidence) => evidence.id),
});

const toAnalysisContextPackage = (
  identity: ProjectOverviewProjectionIdentity,
  snapshot: ProjectAnalysisSnapshot,
): AnalysisContextPackage => ({
  contract: "energyiq-analysis-context-package@1",
  projectionRef: createProjectOverviewProjectionRef(createProjectOverviewProjectionKey(identity)),
  identity,
  snapshot,
  evidenceRefs: snapshot.evidence.map((evidence) => evidence.id),
});

const selectPreschoolLatestCompleteLocalDay = async (
  input: Parameters<typeof selectEnergyLatestCompleteDay>[0],
): Promise<string | null> => {
  try {
    return (await selectEnergyLatestCompleteDay(input)).period.localFrom;
  } catch (error) {
    if (
      error instanceof Error
      && (
        error.message === "ENERGYIQ_LATEST_COMPLETE_PERIOD_COVERAGE_NOT_FOUND"
        || error.message === "ENERGYIQ_LATEST_COMPLETE_DAY_NOT_FOUND"
      )
    ) return null;
    throw error;
  }
};

/** Resolve the complete current data window once, pinned to one published identity. */
export const resolveAllAvailableProjectAnalysisIdentity = async (input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  user: UserRecord;
  workspaceId: string;
  request: EnergyQueryContextRequest;
  databasePath?: string;
  now?: Date;
  env?: Record<string, string | undefined>;
  readEligibleCoverage?: typeof readEnergyAnalysisEligibleCoverage;
  requireProjectRelease?: boolean;
}): Promise<PublishedRunContext> => {
  if (input.request.analysisWindow !== "all-available") {
    throw new Error("ENERGYIQ_ANALYSIS_WINDOW_INVALID");
  }
  const preliminary = resolvePublishedEnergyQueryContext({
    metadataStore: input.metadataStore,
    user: input.user,
    workspaceId: input.workspaceId,
    request: { ...input.request, period: "Last 30 days" },
    ...(input.now ? { now: input.now } : {}),
    ...(input.env ? { env: input.env } : {}),
  });
  if (input.requireProjectRelease && !preliminary.projectRelease) {
    throw new Error("ENERGYIQ_PROJECT_RELEASE_REQUIRED");
  }
  const publishedMeterRoute = resolveEnergyPublishedMeterRoute({
    metadataStore: input.metadataStore,
    projectId: preliminary.context.projectId,
    hierarchyRevisionId: preliminary.context.hierarchyRevisionId,
    scopeId: preliminary.context.scopeId,
    resource: preliminary.context.resource,
    expectedMeterMappingRevisionId: preliminary.context.meterMappingRevisionId,
  });
  const coverage = await (input.readEligibleCoverage ?? readEnergyAnalysisEligibleCoverage)({
    metadataStore: input.metadataStore,
    workspaceId: preliminary.context.workspaceId,
    projectId: preliminary.context.projectId,
    dataSnapshotId: preliminary.context.dataSnapshotId,
    resource: preliminary.context.resource,
    meterAttachments: publishedMeterRoute.attachments,
    ...(input.databasePath ? { databasePath: input.databasePath } : {}),
  });
  if (!coverage || coverage.intervalCount <= 0) {
    throw new Error("ENERGYIQ_ANALYSIS_WINDOW_DATA_UNAVAILABLE");
  }
  const resolved = resolvePublishedEnergyQueryContext({
    metadataStore: input.metadataStore,
    user: input.user,
    workspaceId: input.workspaceId,
    request: {
      ...input.request,
      period: "Custom",
      from: coverage.from,
      to: coverage.to,
      expectedDataSnapshotId: preliminary.context.dataSnapshotId,
      expectedProjectReleaseId: preliminary.projectRelease?.id ?? null,
      expectedHierarchyRevisionId: preliminary.context.hierarchyRevisionId,
      expectedMeterMappingRevisionId: preliminary.context.meterMappingRevisionId,
      expectedMeterFormulaRevisionId: preliminary.context.meterFormulaRevisionId,
    },
    ...(input.now ? { now: input.now } : {}),
    ...(input.env ? { env: input.env } : {}),
  });
  assertStableAllAvailableIdentity(preliminary, resolved);
  return resolved;
};

const assertStableAllAvailableIdentity = (
  preliminary: PublishedRunContext,
  resolved: PublishedRunContext,
): void => {
  for (const field of [
    "dataSnapshotId",
    "hierarchyRevisionId",
    "meterMappingRevisionId",
    "meterFormulaRevisionId",
    "metricVersion",
    "businessCalendarVersion",
    "tariffScheduleVersion",
  ] as const) {
    if (preliminary.context[field] !== resolved.context[field]) {
      throw new Error(
        `ENERGYIQ_PUBLISHED_CONTEXT_CONFLICT:${field}:${preliminary.context[field]}:${resolved.context[field]}`,
      );
    }
  }
  if ((preliminary.projectRelease?.id ?? null) !== (resolved.projectRelease?.id ?? null)) {
    throw new Error("ENERGYIQ_PROJECT_RELEASE_MISMATCH");
  }
};

export const resolveCurrentProjectOverviewIdentity = async (input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  user: UserRecord;
  workspaceId: string;
  request: EnergyQueryContextRequest;
  databasePath?: string;
  now?: Date;
  env?: Record<string, string | undefined>;
}): Promise<PublishedRunContext> => {
  const {
    analysisWindow,
    expectedDataSnapshotId,
    expectedProjectReleaseId,
    from,
    to,
    ...requestedContext
  } = input.request;
  const authorizedProjectContext = resolvePublishedEnergyQueryContext({
    metadataStore: input.metadataStore,
    user: input.user,
    workspaceId: input.workspaceId,
    request: {
      ...requestedContext,
      scopeId: "project",
      period: "Last 7 days",
    },
    ...(input.now ? { now: input.now } : {}),
    ...(input.env ? { env: input.env } : {}),
  });
  const resolvedAnalysisWindow = analysisWindow === "current-project-overview"
    ? resolveProjectOverviewProfile(input.metadataStore, input.request.projectId)?.currentAnalysisWindow
    : analysisWindow;
  if (analysisWindow === "current-project-overview" && !resolvedAnalysisWindow) {
    throw new Error("ENERGYIQ_OVERVIEW_DEFINITION_REQUIRED");
  }
  const selectOverviewPeriod = (
    selectionInput: Parameters<typeof selectEnergyLatestCompleteDay>[0],
  ) => resolvedAnalysisWindow === "latest-complete-day"
    ? selectEnergyLatestCompleteDay(selectionInput)
    : resolvedAnalysisWindow === "current-overview-7d"
      || resolvedAnalysisWindow === "current-overview-28d"
      || resolvedAnalysisWindow === "current-month-to-date"
      ? selectEnergyCurrentOverviewPeriodReadOnly({
          ...selectionInput,
          periodBasis: resolveEnergyCurrentOverviewPeriodBasis(resolvedAnalysisWindow),
        })
      : selectEnergyLatestCompletePeriod(selectionInput);
  const suppliedPinParts = [from, to, expectedDataSnapshotId, expectedProjectReleaseId]
    .filter((value) => value !== undefined).length;
  if (suppliedPinParts > 0 && suppliedPinParts < 4) {
    throw new Error("ENERGYIQ_CURRENT_OVERVIEW_PIN_INCOMPLETE");
  }
  if (suppliedPinParts === 4) {
    if (!from || !to || !expectedDataSnapshotId || !expectedProjectReleaseId) {
      throw new Error("ENERGYIQ_CURRENT_OVERVIEW_PIN_INCOMPLETE");
    }
    const pinnedProjectContext = resolvePublishedEnergyQueryContext({
      metadataStore: input.metadataStore,
      user: input.user,
      workspaceId: input.workspaceId,
      request: {
        ...requestedContext,
        scopeId: "project",
        period: "Last 7 days",
        expectedDataSnapshotId,
        expectedProjectReleaseId,
      },
      ...(input.now ? { now: input.now } : {}),
      ...(input.env ? { env: input.env } : {}),
    });
    if (!supportsCurrentOverviewWindow(pinnedProjectContext.projectRelease?.renderer.key)) {
      throw new Error("ENERGYIQ_ANALYSIS_WINDOW_UNSUPPORTED");
    }
    const releasedPinnedContext = resolvePublishedEnergyQueryContext({
      metadataStore: input.metadataStore,
      user: input.user,
      workspaceId: input.workspaceId,
      request: {
        ...requestedContext,
        period: "Custom",
        from,
        to,
        expectedDataSnapshotId,
        expectedProjectReleaseId,
      },
      ...(input.now ? { now: input.now } : {}),
      ...(input.env ? { env: input.env } : {}),
    });
    return {
      ...releasedPinnedContext,
      validatePinnedOverviewPeriod: async () => {
        const selected = await selectOverviewPeriod({
          metadataStore: input.metadataStore,
          dataGateway: input.dataGateway,
          userId: input.user.id,
          context: pinnedProjectContext.context,
          ...(input.databasePath ? { databasePath: input.databasePath } : {}),
        });
        if (from !== selected.period.localFrom
          || to !== inclusiveLocalDate(selected.period.localToExclusive)) {
          throw new Error("ENERGYIQ_CURRENT_OVERVIEW_WINDOW_MISMATCH");
        }
      },
    };
  }
  const projectContext = authorizedProjectContext;
  const projectRelease = projectContext.projectRelease;
  if (!projectRelease || !supportsCurrentOverviewWindow(projectRelease.renderer.key)) {
    throw new Error("ENERGYIQ_ANALYSIS_WINDOW_UNSUPPORTED");
  }
  const selected = await selectOverviewPeriod({
    metadataStore: input.metadataStore,
    dataGateway: input.dataGateway,
    userId: input.user.id,
    context: projectContext.context,
    ...(input.databasePath ? { databasePath: input.databasePath } : {}),
  });
  return resolvePublishedEnergyQueryContext({
    metadataStore: input.metadataStore,
    user: input.user,
    workspaceId: input.workspaceId,
    request: {
      ...requestedContext,
      period: "Custom",
      from: selected.period.localFrom,
      to: inclusiveLocalDate(selected.period.localToExclusive),
      expectedDataSnapshotId: projectContext.context.dataSnapshotId,
      expectedProjectReleaseId: projectRelease.id,
    },
    ...(input.now ? { now: input.now } : {}),
    ...(input.env ? { env: input.env } : {}),
  });
};

const supportsCurrentOverviewWindow = (rendererKey: string | undefined): boolean =>
  rendererKey === "ngee-ann-overview"
  || rendererKey === "preschool-overview"
  || rendererKey === "tuya-office-overview"
  || rendererKey === "energy-template-overview";

const inclusiveLocalDate = (localToExclusive: string): string => {
  const exclusive = new Date(`${localToExclusive}T00:00:00.000Z`);
  if (Number.isNaN(exclusive.valueOf())) {
    throw new Error("ENERGYIQ_GOLDEN_PERIOD_DATE_INVALID");
  }
  exclusive.setUTCDate(exclusive.getUTCDate() - 1);
  return exclusive.toISOString().slice(0, 10);
};

export const bindPublishedReleaseContext = (
  context: EnergyQueryContext,
  release: PublishedProjectRelease,
): EnergyQueryContext => {
  if (context.projectId !== release.projectId) {
    throw new Error("ENERGYIQ_PROJECT_RELEASE_MISMATCH");
  }
  return {
    ...context,
    hierarchyRevisionId: release.hierarchyRevisionId,
    meterMappingRevisionId: release.meterMappingRevisionId,
    meterFormulaRevisionId: release.meterFormulaRevisionId,
    metricVersion: `metric-revisions:${[...release.metricRevisionIds]
      .sort((left, right) => left.localeCompare(right))
      .join(",") || "none"}`,
    businessCalendarVersion: release.businessCalendarVersion,
    tariffScheduleVersion: release.tariffScheduleVersion,
  };
};

export const resolvePublishedProjectRelease = (
  metadataStore: MetadataStore,
  context: EnergyQueryContext,
): PublishedProjectRelease | null => {
  const catalog = metadataStore.energyIq.templates.listComponentRevisions();
  const revision = metadataStore.energyIq.templates.getLatestProjectRevision(context.projectId);
  const legacyProfile = resolveProjectOverviewProfile(metadataStore, context.projectId);
  if (!legacyProfile) return null;
  return revision
    ? releaseFromTemplateRevision(revision, legacyProfile, catalog, metadataStore.energyIq.overviewDefinitions.get(revision.revision_id)?.definition)
    : releaseFromLegacyProfile(metadataStore, context, legacyProfile, catalog);
};

export const resolvePublishedEnergyRunContext = (input: {
  metadataStore: MetadataStore;
  context: EnergyQueryContext;
  expectedProjectReleaseId?: string | null;
}): {
  context: EnergyQueryContext;
  projectRelease: PublishedProjectRelease | null;
} => {
  const latestRevisionId = input.metadataStore.energyIq.templates
    .getLatestProjectRevision(input.context.projectId)?.revision_id;
  const projectRelease = typeof input.expectedProjectReleaseId === "string"
    ? input.expectedProjectReleaseId === latestRevisionId
      ? resolvePublishedProjectRelease(input.metadataStore, input.context)
      : resolvePublishedProjectReleaseById(
          input.metadataStore,
          input.context,
          input.expectedProjectReleaseId,
        )
    : resolvePublishedProjectRelease(input.metadataStore, input.context);
  if (input.expectedProjectReleaseId !== undefined
    && input.expectedProjectReleaseId !== (projectRelease?.id ?? null)) {
    throw new Error("ENERGYIQ_PROJECT_RELEASE_MISMATCH");
  }
  return {
    context: projectRelease
      ? bindPublishedReleaseContext(input.context, projectRelease)
      : input.context,
    projectRelease,
  };
};

export const resolvePublishedEnergyQueryContext = (input: {
  metadataStore: MetadataStore;
  user: UserRecord;
  workspaceId: string;
  request: EnergyQueryContextRequest;
  now?: Date;
  env?: Record<string, string | undefined>;
}): {
  context: EnergyQueryContext;
  projectRelease: PublishedProjectRelease | null;
} => {
  const expectedReleaseId = input.request.expectedProjectReleaseId;
  const exactTemplateRevision = typeof expectedReleaseId === "string"
    ? input.metadataStore.energyIq.templates.getProjectRevision(expectedReleaseId)
    : null;
  const expectedReleaseKnownForProject = typeof expectedReleaseId !== "string"
    || exactTemplateRevision?.project_id === input.request.projectId
    || (
      !exactTemplateRevision
      && expectedReleaseId === resolveProjectOverviewReleaseId(
        input.metadataStore,
        input.request.projectId,
      )
    );
  if (!expectedReleaseKnownForProject) {
    const access = resolveEnergyAccessContext({
      metadataStore: input.metadataStore,
      user: input.user,
      requestedWorkspaceId: input.workspaceId,
      ...(input.env ? { env: input.env } : {}),
    });
    const project = access.projects.find((candidate) => candidate.id === input.request.projectId);
    if (!project
      || project.workspaceId !== access.activeWorkspaceId
      || (project.status !== "published" && access.role !== "admin")) {
      throw new Error("ENERGYIQ_PROJECT_FORBIDDEN");
    }
    throw new Error("ENERGYIQ_PROJECT_RELEASE_MISMATCH");
  }
  const templateRevision = exactTemplateRevision?.project_id === input.request.projectId
    ? exactTemplateRevision
    : expectedReleaseId === undefined
      ? input.metadataStore.energyIq.templates.getLatestProjectRevision(input.request.projectId)
      : null;
  const context = resolveEnergyQueryContext({
    metadataStore: input.metadataStore,
    user: input.user,
    workspaceId: input.workspaceId,
    request: input.request,
    ...(templateRevision ? {
      releasePins: {
        hierarchyRevisionId: templateRevision.hierarchy_revision_id,
        meterMappingRevisionId: templateRevision.meter_mapping_revision_id,
        meterFormulaRevisionId: templateRevision.meter_formula_revision_id,
        timezone: resolveEnergyPublishedHierarchyTimezone(
          input.metadataStore,
          templateRevision.project_id,
          templateRevision.hierarchy_revision_id,
        ),
        metricVersion: `metric-revisions:${[...templateRevision.selected_metric_revision_ids]
          .sort((left, right) => left.localeCompare(right))
          .join(",") || "none"}`,
        businessCalendarVersion: templateRevision.business_calendar_version,
        tariffScheduleVersion: templateRevision.tariff_schedule_version,
      },
    } : {}),
    ...(input.now ? { now: input.now } : {}),
    ...(input.env ? { env: input.env } : {}),
  });
  return resolvePublishedEnergyRunContext({
    metadataStore: input.metadataStore,
    context,
    ...(input.request.expectedProjectReleaseId !== undefined
      ? { expectedProjectReleaseId: input.request.expectedProjectReleaseId }
      : {}),
  });
};

const resolvePublishedProjectReleaseById = (
  metadataStore: MetadataStore,
  context: EnergyQueryContext,
  releaseId: string,
): PublishedProjectRelease | null => {
  const catalog = metadataStore.energyIq.templates.listComponentRevisions();
  const revision = metadataStore.energyIq.templates.getProjectRevision(releaseId);
  if (revision) {
    if (revision.project_id !== context.projectId) return null;
    const definition = metadataStore.energyIq.overviewDefinitions.get(revision.revision_id);
    if (!definition) return null;
    const profile = projectOverviewProfileFromDefinition(
      metadataStore,
      revision.project_id,
      definition,
    );
    const release = releaseFromTemplateRevision(revision, profile, catalog, definition.definition);
    return resolveProjectOverviewProfileForRelease(metadataStore, release) ? release : null;
  }
  const legacyProfile = LEGACY_PROJECT_OVERVIEW_PROFILES[context.projectId];
  if (!legacyProfile
    || metadataStore.energyIq.templates.getLatestProjectRevision(context.projectId)
    || releaseId !== legacyProjectReleaseId(context.projectId, legacyProfile)) return null;
  return releaseFromLegacyProfile(metadataStore, context, legacyProfile, catalog);
};

const releaseFromTemplateRevision = (
  revision: EnergyIqTemplateRevisionRecord,
  profile: ProjectOverviewProfile,
  catalog: EnergyIqComponentRevisionRecord[],
  definition?: EnergyIqOverviewDefinition,
): PublishedProjectRelease => buildPublishedProjectRelease({
  rendererKey: profile.rendererKey,
  ...(definition?.aiSlotPresentationMode === undefined
    ? {}
    : { aiPresentationMode: definition.aiSlotPresentationMode }),
  release: {
    id: revision.revision_id,
    source: "template-revision",
    projectId: revision.project_id,
    templateRevisionId: revision.revision_id,
    templateRevisionSequence: revision.sequence,
    reportTimePolicyRevisionId: profile.reportTimePolicyRevisionId,
    hierarchyRevisionId: revision.hierarchy_revision_id,
    meterMappingRevisionId: revision.meter_mapping_revision_id,
    meterFormulaRevisionId: revision.meter_formula_revision_id,
    metricRevisionIds: revision.selected_metric_revision_ids,
    ruleRevisionIds: revision.selected_rule_revision_ids,
    businessCalendarVersion: revision.business_calendar_version,
    tariffScheduleVersion: revision.tariff_schedule_version,
    publishedAt: revision.published_at,
    document: revision.document,
    catalog,
  },
});

const releaseFromLegacyProfile = (
  metadataStore: MetadataStore,
  context: EnergyQueryContext,
  profile: ProjectOverviewProfile,
  catalog: EnergyIqComponentRevisionRecord[],
): PublishedProjectRelease => buildPublishedProjectRelease({
  rendererKey: profile.rendererKey,
  release: {
    id: legacyProjectReleaseId(context.projectId, profile),
    source: "legacy-profile",
    projectId: context.projectId,
    templateRevisionId: null,
    templateRevisionSequence: null,
    reportTimePolicyRevisionId: profile.reportTimePolicyRevisionId,
    hierarchyRevisionId: context.hierarchyRevisionId,
    meterMappingRevisionId: context.meterMappingRevisionId,
    meterFormulaRevisionId: context.meterFormulaRevisionId,
    metricRevisionIds: metadataStore.energyIq.metrics
      .getProjectConfig(context.projectId).selected_metric_revision_ids,
    ruleRevisionIds: metadataStore.energyIq.rules
      .getProjectConfig(context.projectId).selected_rule_revision_ids,
    businessCalendarVersion: context.businessCalendarVersion,
    tariffScheduleVersion: context.tariffScheduleVersion,
    publishedAt: null,
    document: createDefaultTemplateDocument(
      catalog,
      [...metadataStore.energyIq.listTierDefinitions(context.projectId)]
        .sort((left, right) => right.ordinal - left.ordinal)
        .map((tier) => tier.id),
    ),
    catalog,
  },
});

const legacyProjectReleaseId = (
  projectId: string,
  profile: ProjectOverviewProfile,
): string => `legacy-profile:${projectId}:${profile.releaseVersion}`;

const buildPublishedProjectRelease = (input: {
  rendererKey: ProjectRendererKey;
  aiPresentationMode?: "structured" | "html";
  release: Omit<PublishedProjectRelease, "recipe" | "renderer">;
}): PublishedProjectRelease => ({
  ...input.release,
  recipe: PROJECT_ANALYSIS_RECIPE,
  renderer: {
    key: input.rendererKey,
    version: PROJECT_RENDERER_VERSION,
    contractVersion: PROJECT_RENDERER_CONTRACT_VERSION,
    ...(input.aiPresentationMode === undefined ? {} : { aiPresentationMode: input.aiPresentationMode }),
  },
});
