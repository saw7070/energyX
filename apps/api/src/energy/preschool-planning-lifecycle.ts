import type { LocalDataGateway } from "@datafoundry/data-gateway";
import type { EnergyIqSavedAnalysisRecord, MetadataStore } from "@datafoundry/metadata";

import { executeEnergyScopeAnalysis } from "./energy-analysis.js";
import type { EnergyQueryContext } from "./energy-query-context.js";
import {
  buildPreschoolPlanningEstimateSeries,
  recoverPreschoolPlanningOutlookFromCompleteWeeks,
  type PreschoolOperationalProjection,
  type PreschoolPlanningAnalysisInput,
} from "./preschool-operational-projection.js";
import type { PublishedProjectRelease } from "./project-analysis-resolver.js";

const DEFAULT_JUNE_TARGET_PERIOD = {
  start: "2026-06-01",
  endExclusive: "2026-07-01",
  timezone: "Asia/Singapore",
  targetDayCount: 30,
} as const;
const DAILY_TOTALS_QUERY_ID = "daily_totals_v1" as const;
const FORECAST_SERIES_RECIPE_ID = "preschool-weekday-mean-series-v1" as const;

export type PreschoolMonthlyTargetPeriod = {
  start: string;
  endExclusive: string;
  timezone: string;
  targetDayCount: number;
};

type OperationalPlanningOutlook = Extract<
  Extract<PreschoolOperationalProjection, { status: "available" }>["planningOutlook"],
  { status: "provisional" }
>;

type PlanningOutlook = Omit<OperationalPlanningOutlook, "targetPeriod" | "tariffReference"> & {
  targetPeriod: {
    start: string;
    endInclusive: string;
    endExclusive?: string;
    timezone?: string;
    days: number;
  };
  tariffReference?: OperationalPlanningOutlook["tariffReference"];
};

export type PreschoolPlanningActualAnalysis = {
  context: {
    scopeId: string;
    from: string;
    to: string;
    timezone: string;
  };
  provenance: {
    dataSnapshotId: string;
    queryIds: readonly string[];
  };
  dailyTotals?: {
    timezone: string;
    scopes: Array<{
      scopeId: string;
      scopeName?: string;
      scopeType?: string;
      rows: Array<{
        localDate: string;
        usageKwh: number | null;
        dataHealth: { status: "complete" | "partial" | "unavailable" };
      }>;
    }>;
  };
};

type PreschoolPlanningForecastBucket = {
  start: string;
  endExclusive: string;
  estimatedKwh: number;
  originalEstimateKwh: number;
  actualKwh: number | null;
  currentOutlookKwh: number | null;
  futureOutlookKwh: number | null;
  actualCompleteDayCount: number;
  actualTargetDayCount: number;
  actualStatus: "waiting" | "partial" | "complete";
};

export type PreschoolPlanningForecast = {
  status: "waiting" | "partial" | "complete";
  contract: {
    id: "preschool-monthly-energy-outlook";
    version: "2";
    method: "same-weekday mean from four complete May weeks, scaled to the Saved Plan total";
  };
  targetPeriod: PreschoolMonthlyTargetPeriod;
  tariffAssumption: {
    status: "effective" | "provisional";
    beforeGstSgdPerKwh: number;
    sourceName: string;
    sourceUrl: string;
    supplyClass: string;
    appliesFrom: string;
    appliesTo: string;
    beforeGst: true;
    notBill: true;
  } | {
    status: "unavailable";
    reason: string;
  };
  scopes: Array<{
    scopeId: string;
    scopeName: string;
    scopeType: string;
    scopeRole: "portfolio" | "centre";
    estimatedKwh: number;
    estimatedCostBeforeGstSgd: number | null;
    expectedFullMonthKwh: number | null;
    expectedFullMonthCostBeforeGstSgd: number | null;
    actualKwh: number | null;
    actualCostBeforeGstSgd: number | null;
    actualCompleteDayCount: number;
    actualTargetDayCount: number;
    actualThroughLocalDate: string | null;
    pacePct: number | null;
    outcome: "on_plan" | "above_plan" | "below_plan" | null;
    originalEstimateIdentity: string;
    actualIdentity: string;
    currentOutlookIdentity: string;
    buckets: Record<"daily" | "weekly" | "monthly", PreschoolPlanningForecastBucket[]>;
  }>;
  evidence: {
    planDataSnapshotId: string;
    actualDataSnapshotId: string;
    planQueryId: "daily_totals_v1";
    actualQueryId: "daily_totals_v1";
    recipeId: typeof FORECAST_SERIES_RECIPE_ID;
  };
};

export type PreschoolPlanningLifecycle = {
  status: "available";
  contract: {
    id: "preschool-saved-plan-current-actual";
    version: "2";
  };
  targetPeriod: PreschoolMonthlyTargetPeriod;
  plan: PlanningOutlook;
  actual: {
    status: "partial" | "complete";
    usageKwh: number | null;
    completeDayCount: number;
    targetDayCount: number;
    varianceKwh: number | null;
    variancePct: number | null;
  };
  forecast?: PreschoolPlanningForecast;
  planProvenance: {
    savedAnalysisId: string;
    dataSnapshotId: string;
    projectReleaseId: string;
    templateRevisionId: string;
    queryId: "daily_totals_v1";
    recipeId: "preschool-naive-weekly-planning-baseline-v1";
  };
  actualProvenance: {
    dataSnapshotId: string;
    projectReleaseId: string;
    queryId: "daily_totals_v1";
    period: {
      start: string;
      endExclusive: string;
      timezone: string;
    };
  };
} | {
  status: "unavailable";
  reason: {
    code: "NO_COMPATIBLE_SAVED_ANALYSIS" | "CURRENT_ACTUAL_UNAVAILABLE";
    message: string;
  };
};

type PreschoolPlanningIdentityInput = {
  projectId: string;
  workspaceId: string;
  scopeId: string;
  resource: "electricity";
  templateRevisionId: string;
  projectReleaseId: string;
  currentDataSnapshotId: string;
  latestCompleteLocalDay?: string;
  targetPeriod?: PreschoolMonthlyTargetPeriod;
  savedAnalyses: readonly EnergyIqSavedAnalysisRecord[];
};

export const resolvePreschoolMonthlyTargetPeriod = (
  latestCompleteLocalDay: string,
  timezone: string,
): PreschoolMonthlyTargetPeriod => {
  const nextLocalDay = shiftLocalDate(latestCompleteLocalDay, 1);
  const [year, month] = nextLocalDay.split("-").map(Number);
  if (!year || !month) throw new Error("PRESCHOOL_MONTHLY_TARGET_DATE_INVALID");
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextMonth = new Date(Date.UTC(year, month, 1));
  const endExclusive = nextMonth.toISOString().slice(0, 10);
  return {
    start,
    endExclusive,
    timezone,
    targetDayCount: localDateDistance(start, endExclusive),
  };
};

export const buildPreschoolMonthlyActualContext = (
  context: EnergyQueryContext,
  targetPeriod: PreschoolMonthlyTargetPeriod = DEFAULT_JUNE_TARGET_PERIOD,
): EnergyQueryContext => ({
  ...context,
  from: zonedStartOfLocalDate(targetPeriod.start, targetPeriod.timezone),
  to: zonedStartOfLocalDate(targetPeriod.endExclusive, targetPeriod.timezone),
  period: "Custom",
});

export const buildPreschoolJuneActualContext = buildPreschoolMonthlyActualContext;

export const loadPreschoolPlanningLifecycle = async (input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  userId: string;
  context: EnergyQueryContext;
  projectRelease: PublishedProjectRelease;
  latestCompleteLocalDay: string;
  savedAnalyses?: readonly EnergyIqSavedAnalysisRecord[];
  databasePath?: string;
}): Promise<PreschoolPlanningLifecycle> => {
  if (
    input.context.resource !== "electricity"
    || input.projectRelease.templateRevisionId === null
  ) {
    return {
      status: "unavailable",
      reason: {
        code: "NO_COMPATIBLE_SAVED_ANALYSIS",
        message: "A compatible older Saved Analysis with a recoverable target-month plan is unavailable. The current deterministic Planning Baseline may still be shown separately.",
      },
    };
  }
  const targetPeriod = resolvePreschoolMonthlyTargetPeriod(
    input.latestCompleteLocalDay,
    input.context.timezone,
  );
  return loadPreschoolPlanningLifecycleFromSavedAnalyses({
    projectId: input.context.projectId,
    workspaceId: input.context.workspaceId,
    scopeId: input.context.scopeId,
    resource: "electricity",
    templateRevisionId: input.projectRelease.templateRevisionId,
    projectReleaseId: input.projectRelease.id,
    currentDataSnapshotId: input.context.dataSnapshotId,
    latestCompleteLocalDay: input.latestCompleteLocalDay,
    targetPeriod,
    savedAnalyses: input.savedAnalyses
      ?? input.metadataStore.energyIq.savedAnalyses.listProject(input.context.projectId),
    loadActualAnalysis: () => executeEnergyScopeAnalysis({
      metadataStore: input.metadataStore,
      dataGateway: input.dataGateway,
      userId: input.userId,
      context: buildPreschoolMonthlyActualContext(input.context, targetPeriod),
      projectReleaseId: input.projectRelease.id,
      ruleRevisions: [],
      includeTimeBehaviour: false,
      includeMeterOperationalBreakdown: false,
      includeImmediateChildDailyTotals: true,
      profile: "explorer",
      ...(input.databasePath ? { databasePath: input.databasePath } : {}),
    }),
  });
};

export const loadPreschoolPlanningLifecycleFromSavedAnalyses = async (
  input: PreschoolPlanningIdentityInput & {
    loadActualAnalysis: () => Promise<PreschoolPlanningActualAnalysis>;
  },
): Promise<PreschoolPlanningLifecycle> => {
  const reference = findSavedPlanReference(input);
  if (!reference) return noCompatibleSavedAnalysis();
  const actualAnalysis = await input.loadActualAnalysis();
  return buildPreschoolPlanningLifecycle({
    ...input,
    savedAnalyses: [reference.savedAnalysis],
    actualAnalysis,
  });
};

export const buildPreschoolPlanningLifecycle = (input: PreschoolPlanningIdentityInput & {
  actualAnalysis: PreschoolPlanningActualAnalysis;
}): PreschoolPlanningLifecycle => {
  const targetPeriod = lifecycleTargetPeriod(input);
  const reference = findSavedPlanReference(input);
  if (!reference) return noCompatibleSavedAnalysis();

  const actual = buildActual({
    analysis: input.actualAnalysis,
    plan: reference.planningOutlook,
    currentDataSnapshotId: input.currentDataSnapshotId,
    targetPeriod,
  });
  if (!actual) {
    return {
      status: "unavailable",
      reason: {
        code: "CURRENT_ACTUAL_UNAVAILABLE",
        message: "Current target-month daily-total Evidence does not match the active Snapshot.",
      },
    };
  }
  const forecast = reference.planAnalysis
    ? buildForecast({
        planAnalysis: reference.planAnalysis,
        actualAnalysis: input.actualAnalysis,
        plan: reference.planningOutlook,
        currentDataSnapshotId: input.currentDataSnapshotId,
        latestCompleteLocalDay: input.latestCompleteLocalDay ?? shiftLocalDate(targetPeriod.start, -1),
        targetPeriod,
        savedAnalysisId: reference.savedAnalysis.id,
      })
    : null;

  return {
    status: "available",
    contract: {
      id: "preschool-saved-plan-current-actual",
      version: "2",
    },
    targetPeriod,
    plan: reference.planningOutlook,
    actual,
    ...(forecast ? { forecast } : {}),
    planProvenance: {
      savedAnalysisId: reference.savedAnalysis.id,
      dataSnapshotId: reference.savedAnalysis.data_snapshot_id,
      projectReleaseId: input.projectReleaseId,
      templateRevisionId: input.templateRevisionId,
      queryId: DAILY_TOTALS_QUERY_ID,
      recipeId: "preschool-naive-weekly-planning-baseline-v1",
    },
    actualProvenance: {
      dataSnapshotId: input.currentDataSnapshotId,
      projectReleaseId: input.projectReleaseId,
      queryId: DAILY_TOTALS_QUERY_ID,
      period: {
        start: targetPeriod.start,
        endExclusive: targetPeriod.endExclusive,
        timezone: targetPeriod.timezone,
      },
    },
  };
};

const findSavedPlanReference = (input: PreschoolPlanningIdentityInput) => {
  const targetPeriod = lifecycleTargetPeriod(input);
  return [...input.savedAnalyses]
    .sort((left, right) => (
      right.created_at.localeCompare(left.created_at)
      || right.sequence - left.sequence
    ))
    .flatMap((savedAnalysis) => {
      const snapshot = compatibleSavedSnapshot(input, savedAnalysis);
      if (!snapshot) return [];
      const planningOutlook = savedPlanningOutlook(
        snapshot,
        savedAnalysis.data_snapshot_id,
        targetPeriod,
      );
      const planAnalysis = planningAnalysisInput(recordField(snapshot, "analysis"));
      return planningOutlook ? [{ savedAnalysis, planningOutlook, planAnalysis }] : [];
    })[0]
  ?? null;
};

const noCompatibleSavedAnalysis = (): PreschoolPlanningLifecycle => ({
  status: "unavailable",
  reason: {
    code: "NO_COMPATIBLE_SAVED_ANALYSIS",
    message: "A compatible frozen Saved Plan for this target month is unavailable. The deterministic Planning Baseline remains available when the current Snapshot can support it.",
  },
});

const compatibleSavedSnapshot = (
  input: PreschoolPlanningIdentityInput,
  savedAnalysis: EnergyIqSavedAnalysisRecord,
): Record<string, unknown> | null => {
  if (
    savedAnalysis.project_id !== input.projectId
    || savedAnalysis.workspace_id !== input.workspaceId
    || savedAnalysis.scope_id !== input.scopeId
    || savedAnalysis.resource !== input.resource
    || savedAnalysis.template_revision_id !== input.templateRevisionId
    || savedAnalysis.data_snapshot_id === input.currentDataSnapshotId
    || !savedAnalysis.snapshot_json
  ) return null;
  const query = parseRecord(savedAnalysis.query_json);
  if (!query) return null;
  const snapshot = parseRecord(savedAnalysis.snapshot_json);
  if (!snapshot) return null;
  const context = recordField(snapshot, "context");
  const projectRelease = recordField(snapshot, "projectRelease");
  const renderer = recordField(snapshot, "renderer");
  const dataSnapshot = recordField(snapshot, "dataSnapshot");
  const analysis = recordField(snapshot, "analysis");
  const provenance = analysis ? recordField(analysis, "provenance") : null;
  if (
    !context
    || context.projectId !== input.projectId
    || context.workspaceId !== input.workspaceId
    || context.scopeId !== input.scopeId
    || context.resource !== input.resource
    || context.dataSnapshotId !== savedAnalysis.data_snapshot_id
    || !projectRelease
    || projectRelease.id !== input.projectReleaseId
    || projectRelease.templateRevisionId !== input.templateRevisionId
    || !renderer
    || renderer.key !== "preschool-overview"
    || !dataSnapshot
    || dataSnapshot.id !== savedAnalysis.data_snapshot_id
    || !provenance
    || provenance.dataSnapshotId !== savedAnalysis.data_snapshot_id
  ) return null;
  return snapshot;
};

const savedPlanningOutlook = (
  snapshot: Record<string, unknown>,
  dataSnapshotId: string,
  targetPeriod: PreschoolMonthlyTargetPeriod,
): PlanningOutlook | null => {
  const operational = recordField(snapshot, "preschoolOperational");
  const candidate = operational?.planningOutlook;
  if (candidate !== undefined) {
    return isPlanningOutlook(candidate, dataSnapshotId, targetPeriod) ? candidate : null;
  }
  const analysis = planningAnalysisInput(recordField(snapshot, "analysis"));
  if (!analysis) return null;
  const derived = recoverPreschoolPlanningOutlookFromCompleteWeeks(analysis);
  return derived.status === "provisional"
    && derived.evidence.dataSnapshotId === dataSnapshotId
    && planningTargetMatches(derived.targetPeriod, targetPeriod)
    ? derived as PlanningOutlook
    : null;
};

const planningAnalysisInput = (
  analysis: Record<string, unknown> | null,
): PreschoolPlanningAnalysisInput | null => {
  const context = analysis ? recordField(analysis, "context") : null;
  const offHours = analysis ? recordField(analysis, "offHours") : null;
  const provenance = analysis ? recordField(analysis, "provenance") : null;
  const dailyTotals = analysis ? recordField(analysis, "dailyTotals") : null;
  const scopes = dailyTotals?.scopes;
  if (
    !context
    || typeof context.scopeId !== "string"
    || !offHours
    || typeof offHours.status !== "string"
    || !provenance
    || typeof provenance.dataSnapshotId !== "string"
    || !isStringArray(provenance.queryIds)
    || !dailyTotals
    || typeof dailyTotals.timezone !== "string"
    || !Array.isArray(scopes)
  ) return null;
    const parsedScopes = scopes.flatMap((scope) => {
    if (!isRecord(scope) || typeof scope.scopeId !== "string" || !Array.isArray(scope.rows)) return [];
    const rows = scope.rows.flatMap((row) => {
      const dataHealth = isRecord(row) ? recordField(row, "dataHealth") : null;
      if (
        !isRecord(row)
        || typeof row.localDate !== "string"
        || !(typeof row.usageKwh === "number" || row.usageKwh === null)
        || !dataHealth
        || !isDailyStatus(dataHealth.status)
      ) return [];
      return [{
        localDate: row.localDate,
        usageKwh: row.usageKwh,
        dataHealth: { status: dataHealth.status },
      }];
    });
    if (rows.length !== scope.rows.length) return [];
    return [{
      scopeId: scope.scopeId,
      ...(typeof scope.scopeName === "string" ? { scopeName: scope.scopeName } : {}),
      ...(typeof scope.scopeType === "string" ? { scopeType: scope.scopeType } : {}),
      rows,
    }];
  });
  if (parsedScopes.length !== scopes.length) return null;
  return {
    context: { scopeId: context.scopeId },
    offHours: { status: offHours.status },
    provenance: {
      dataSnapshotId: provenance.dataSnapshotId,
      queryIds: provenance.queryIds,
    },
    dailyTotals: {
      timezone: dailyTotals.timezone,
      scopes: parsedScopes,
    },
  };
};

const buildForecast = (input: {
  planAnalysis: PreschoolPlanningAnalysisInput;
  actualAnalysis: PreschoolPlanningActualAnalysis;
  plan: PlanningOutlook;
  currentDataSnapshotId: string;
  latestCompleteLocalDay: string;
  targetPeriod: PreschoolMonthlyTargetPeriod;
  savedAnalysisId: string;
}): PreschoolPlanningForecast | null => {
  if (
    input.planAnalysis.provenance.dataSnapshotId !== input.plan.evidence.dataSnapshotId
    || input.actualAnalysis.provenance.dataSnapshotId !== input.currentDataSnapshotId
    || input.planAnalysis.dailyTotals?.timezone !== input.targetPeriod.timezone
    || input.actualAnalysis.dailyTotals?.timezone !== input.targetPeriod.timezone
    || input.actualAnalysis.context.from !== zonedStartOfLocalDate(input.targetPeriod.start, input.targetPeriod.timezone)
    || input.actualAnalysis.context.to !== zonedStartOfLocalDate(input.targetPeriod.endExclusive, input.targetPeriod.timezone)
    || !planningTargetMatches(input.plan.targetPeriod, input.targetPeriod)
  ) return null;
  const estimateSeries = buildPreschoolPlanningEstimateSeries(
    input.planAnalysis,
    input.plan.usageEstimate.projectedKwh,
    input.targetPeriod,
  );
  if (!estimateSeries) return null;
  const actualScopesById = new Map(input.actualAnalysis.dailyTotals.scopes.map((scope) => [scope.scopeId, scope]));
  const portfolioScopeId = input.planAnalysis.context?.scopeId;
  if (!portfolioScopeId) return null;
  if (!actualScopesById.has(portfolioScopeId)) return null;
  const tariffAssumption = buildTariffAssumption(input.plan, input.targetPeriod);
  const tariffRate = tariffAssumption.status === "unavailable"
    ? null
    : tariffAssumption.beforeGstSgdPerKwh;
  const originalEstimateIdentity = [
    input.savedAnalysisId,
    input.targetPeriod.start,
    input.plan.evidence.dataSnapshotId,
    FORECAST_SERIES_RECIPE_ID,
  ].join(":");
  const scopes = estimateSeries.scopes.map((estimateScope) => {
    const actualScope = actualScopesById.get(estimateScope.scopeId);
    const actualRowsByDate = new Map((actualScope?.rows ?? []).map((row) => [row.localDate, row]));
    const daily = estimateScope.buckets.daily.map((estimate) => {
      const actual = actualRowsByDate.get(estimate.start);
      const withinCutoff = estimate.start <= input.latestCompleteLocalDay;
      const complete = withinCutoff
        && actual?.dataHealth.status === "complete"
        && typeof actual.usageKwh === "number";
      const actualKwh = complete ? round(actual.usageKwh!) : null;
      const currentOutlookKwh = complete
        ? actualKwh
        : withinCutoff
          ? null
          : round(estimate.estimatedKwh);
      const futureOutlookKwh = withinCutoff ? null : round(estimate.estimatedKwh);
      return {
        start: estimate.start,
        endExclusive: estimate.endExclusive,
        estimatedKwh: round(estimate.estimatedKwh),
        originalEstimateKwh: round(estimate.estimatedKwh),
        actualKwh,
        currentOutlookKwh,
        futureOutlookKwh,
        actualCompleteDayCount: complete ? 1 : 0,
        actualTargetDayCount: 1,
        actualStatus: complete
          ? "complete" as const
          : withinCutoff
            ? "partial" as const
            : "waiting" as const,
      };
    });
    const actualCompleteDayCount = daily.reduce((total, bucket) => total + bucket.actualCompleteDayCount, 0);
    const actualThroughLocalDate = consecutiveActualThroughLocalDate(daily);
    const actualKwh = actualCompleteDayCount === 0
      ? null
      : round(sum(daily.flatMap((bucket) => bucket.actualKwh === null ? [] : [bucket.actualKwh])));
    const estimatedToDateKwh = actualCompleteDayCount === input.targetPeriod.targetDayCount
      ? estimateScope.estimatedKwh
      : sum(daily
        .filter((bucket) => bucket.actualCompleteDayCount === 1)
        .map((bucket) => bucket.estimatedKwh));
    const pacePct = actualKwh === null || estimatedToDateKwh <= 0
      ? null
      : round((actualKwh / estimatedToDateKwh) * 100);
    const complete = actualCompleteDayCount === input.targetPeriod.targetDayCount;
    const outcome = complete && actualKwh !== null
      ? actualKwh > estimateScope.estimatedKwh
        ? "above_plan" as const
        : actualKwh < estimateScope.estimatedKwh
          ? "below_plan" as const
          : "on_plan" as const
      : null;
    const expectedFullMonthKwh = daily.every((bucket) => bucket.currentOutlookKwh !== null)
      ? round(sum(daily.map((bucket) => bucket.currentOutlookKwh!)))
      : null;
    const actualIdentity = `${input.currentDataSnapshotId}:${input.targetPeriod.start}:${input.latestCompleteLocalDay}`;
    return {
      scopeId: estimateScope.scopeId,
      scopeName: estimateScope.scopeName ?? actualScope?.scopeName ?? estimateScope.scopeId,
      scopeType: estimateScope.scopeType ?? actualScope?.scopeType ?? (estimateScope.scopeId === portfolioScopeId ? "project" : "centre"),
      scopeRole: estimateScope.scopeRole,
      estimatedKwh: round(estimateScope.estimatedKwh),
      estimatedCostBeforeGstSgd: tariffRate === null
        ? null
        : round(estimateScope.estimatedKwh * tariffRate),
      expectedFullMonthKwh,
      expectedFullMonthCostBeforeGstSgd: expectedFullMonthKwh === null || tariffRate === null
        ? null
        : round(expectedFullMonthKwh * tariffRate),
      actualKwh,
      actualCostBeforeGstSgd: actualKwh === null || tariffRate === null
        ? null
        : round(actualKwh * tariffRate),
      actualCompleteDayCount,
      actualTargetDayCount: input.targetPeriod.targetDayCount,
      actualThroughLocalDate,
      pacePct,
      outcome,
      originalEstimateIdentity,
      actualIdentity,
      currentOutlookIdentity: `${originalEstimateIdentity}:${actualIdentity}`,
      buckets: {
        daily,
        weekly: aggregateForecastBuckets(daily, 7),
        monthly: aggregateForecastBuckets(daily, input.targetPeriod.targetDayCount),
      },
    };
  });
  const portfolio = scopes.find((scope) => scope.scopeRole === "portfolio");
  if (!portfolio) return null;
  return {
    status: portfolio.actualCompleteDayCount === 0
      ? "waiting"
      : portfolio.actualCompleteDayCount === input.targetPeriod.targetDayCount
        ? "complete"
        : "partial",
    contract: {
      id: "preschool-monthly-energy-outlook",
      version: "2",
      method: "same-weekday mean from four complete May weeks, scaled to the Saved Plan total",
    },
    targetPeriod: input.targetPeriod,
    tariffAssumption,
    scopes,
    evidence: {
      planDataSnapshotId: input.plan.evidence.dataSnapshotId,
      actualDataSnapshotId: input.currentDataSnapshotId,
      planQueryId: DAILY_TOTALS_QUERY_ID,
      actualQueryId: DAILY_TOTALS_QUERY_ID,
      recipeId: FORECAST_SERIES_RECIPE_ID,
    },
  };
};

const aggregateForecastBuckets = (
  daily: PreschoolPlanningForecastBucket[],
  size: number,
): PreschoolPlanningForecastBucket[] => {
  const buckets: PreschoolPlanningForecastBucket[] = [];
  for (let offset = 0; offset < daily.length; offset += size) {
    const rows = daily.slice(offset, offset + size);
    const actualRows = rows.filter((row) => row.actualKwh !== null);
    const currentOutlookRows = rows.filter((row) => row.currentOutlookKwh !== null);
    const futureOutlookRows = rows.filter((row) => row.futureOutlookKwh !== null);
    const actualCompleteDayCount = sum(rows.map((row) => row.actualCompleteDayCount));
    const actualTargetDayCount = sum(rows.map((row) => row.actualTargetDayCount));
    buckets.push({
      start: rows[0]!.start,
      endExclusive: rows.at(-1)!.endExclusive,
      estimatedKwh: round(sum(rows.map((row) => row.estimatedKwh))),
      originalEstimateKwh: round(sum(rows.map((row) => row.originalEstimateKwh))),
      actualKwh: actualRows.length === 0 ? null : round(sum(actualRows.map((row) => row.actualKwh!))),
      currentOutlookKwh: currentOutlookRows.length === rows.length
        ? round(sum(currentOutlookRows.map((row) => row.currentOutlookKwh!)))
        : null,
      futureOutlookKwh: futureOutlookRows.length === 0
        ? null
        : round(sum(futureOutlookRows.map((row) => row.futureOutlookKwh!))),
      actualCompleteDayCount,
      actualTargetDayCount,
      actualStatus: rows.every((row) => row.actualStatus === "waiting")
        ? "waiting"
        : actualCompleteDayCount === actualTargetDayCount
          ? "complete"
          : "partial",
    });
  }
  return buckets;
};

const consecutiveActualThroughLocalDate = (
  daily: PreschoolPlanningForecastBucket[],
): string | null => {
  let through: string | null = null;
  for (const bucket of daily) {
    if (bucket.actualCompleteDayCount !== 1 || bucket.actualKwh === null) break;
    through = bucket.start;
  }
  return through;
};

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

const buildActual = (
  input: {
    analysis: PreschoolPlanningActualAnalysis;
    plan: PlanningOutlook;
    currentDataSnapshotId: string;
    targetPeriod: PreschoolMonthlyTargetPeriod;
  },
): Extract<PreschoolPlanningLifecycle, { status: "available" }>["actual"] | null => {
  const { analysis, plan } = input;
  if (
    analysis.context.from !== zonedStartOfLocalDate(input.targetPeriod.start, input.targetPeriod.timezone)
    || analysis.context.to !== zonedStartOfLocalDate(input.targetPeriod.endExclusive, input.targetPeriod.timezone)
    || analysis.context.timezone !== input.targetPeriod.timezone
    || analysis.provenance.dataSnapshotId !== input.currentDataSnapshotId
    || analysis.dailyTotals?.timezone !== input.targetPeriod.timezone
    || !analysis.provenance.queryIds.includes(DAILY_TOTALS_QUERY_ID)
  ) return null;
  const scope = analysis.dailyTotals.scopes.find((candidate) => (
    candidate.scopeId === analysis.context.scopeId
  ));
  if (!scope) return null;
  const rowsByDate = new Map(scope.rows.map((row) => [row.localDate, row]));
  const targetRows = Array.from({ length: input.targetPeriod.targetDayCount }, (_, offset) => (
    rowsByDate.get(shiftLocalDate(input.targetPeriod.start, offset))
  ));
  const completeRows = targetRows.flatMap((row) => (
    row?.dataHealth.status === "complete" && typeof row.usageKwh === "number"
      ? [row]
      : []
  ));
  const usageKwh = completeRows.length === 0
    ? null
    : round(completeRows.reduce((total, row) => total + (row.usageKwh ?? 0), 0));
  const complete = completeRows.length === input.targetPeriod.targetDayCount;
  const varianceKwh = complete && usageKwh !== null
    ? round(usageKwh - plan.usageEstimate.projectedKwh)
    : null;
  return {
    status: complete ? "complete" : "partial",
    usageKwh,
    completeDayCount: completeRows.length,
    targetDayCount: input.targetPeriod.targetDayCount,
    varianceKwh,
    variancePct: varianceKwh !== null && plan.usageEstimate.projectedKwh > 0
      ? round((varianceKwh / plan.usageEstimate.projectedKwh) * 100)
      : null,
  };
};

const lifecycleTargetPeriod = (
  input: Pick<PreschoolPlanningIdentityInput, "latestCompleteLocalDay" | "targetPeriod">,
): PreschoolMonthlyTargetPeriod => input.targetPeriod ?? resolvePreschoolMonthlyTargetPeriod(
  input.latestCompleteLocalDay ?? "2026-05-31",
  DEFAULT_JUNE_TARGET_PERIOD.timezone,
);

const planningTargetMatches = (
  value: PlanningOutlook["targetPeriod"],
  targetPeriod: PreschoolMonthlyTargetPeriod,
): boolean => value.start === targetPeriod.start
  && value.endInclusive === shiftLocalDate(targetPeriod.endExclusive, -1)
  && value.days === targetPeriod.targetDayCount
  && (value.endExclusive === undefined || value.endExclusive === targetPeriod.endExclusive)
  && (value.timezone === undefined || value.timezone === targetPeriod.timezone);

const buildTariffAssumption = (
  plan: PlanningOutlook,
  targetPeriod: PreschoolMonthlyTargetPeriod,
): PreschoolPlanningForecast["tariffAssumption"] => {
  const tariff = plan.tariffReference;
  if (!tariff) {
    return {
      status: "unavailable",
      reason: "No accepted tariff reference is available for this target month.",
    };
  }
  const targetEndInclusive = shiftLocalDate(targetPeriod.endExclusive, -1);
  return {
    status: tariff.appliesFrom <= targetPeriod.start && tariff.appliesTo >= targetEndInclusive
      ? "effective"
      : "provisional",
    beforeGstSgdPerKwh: tariff.beforeGstSgdPerKwh,
    sourceName: tariff.sourceName,
    sourceUrl: tariff.sourceUrl,
    supplyClass: tariff.supplyClass,
    appliesFrom: tariff.appliesFrom,
    appliesTo: tariff.appliesTo,
    beforeGst: true,
    notBill: true,
  };
};

const isPlanningOutlook = (
  value: unknown,
  dataSnapshotId: string,
  expectedTargetPeriod: PreschoolMonthlyTargetPeriod,
): value is PlanningOutlook => {
  if (!isRecord(value)) return false;
  const contract = recordField(value, "contract");
  const targetPeriod = recordField(value, "targetPeriod");
  const usageEstimate = recordField(value, "usageEstimate");
  const evidence = recordField(value, "evidence");
  const supportedContract = (
    contract?.id === "preschool-june-2026-naive-weekly-baseline"
    && contract.version === "1"
  ) || (
    contract?.id === "preschool-monthly-naive-weekly-baseline"
    && contract.version === "2"
  );
  return value.status === "provisional"
    && supportedContract
    && typeof targetPeriod?.start === "string"
    && typeof targetPeriod.endInclusive === "string"
    && typeof targetPeriod.days === "number"
    && planningTargetMatches(targetPeriod as PlanningOutlook["targetPeriod"], expectedTargetPeriod)
    && typeof usageEstimate?.projectedKwh === "number"
    && typeof usageEstimate.lowerKwh === "number"
    && typeof usageEstimate.upperKwh === "number"
    && evidence?.dataSnapshotId === dataSnapshotId
    && evidence.queryId === DAILY_TOTALS_QUERY_ID
    && evidence.recipeId === "preschool-naive-weekly-planning-baseline-v1"
    && Array.isArray(value.sourceWeeks)
    && isRecord(value.weeklyBaseline)
    && isRecord(value.costEstimate)
    && Array.isArray(value.limitations);
};

const parseRecord = (json: string): Record<string, unknown> | null => {
  try {
    const value: unknown = JSON.parse(json);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
};

const recordField = (
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null => isRecord(value[key]) ? value[key] : null;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

const isStringArray = (value: unknown): value is string[] => (
  Array.isArray(value) && value.every((item) => typeof item === "string")
);

const isDailyStatus = (value: unknown): value is "complete" | "partial" | "unavailable" => (
  value === "complete" || value === "partial" || value === "unavailable"
);

const shiftLocalDate = (localDate: string, days: number): string => {
  const value = new Date(`${localDate}T00:00:00.000Z`);
  if (Number.isNaN(value.valueOf())) throw new Error("PRESCHOOL_MONTHLY_TARGET_DATE_INVALID");
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

const localDateDistance = (start: string, endExclusive: string): number => {
  const startMs = Date.parse(`${start}T00:00:00.000Z`);
  const endMs = Date.parse(`${endExclusive}T00:00:00.000Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new Error("PRESCHOOL_MONTHLY_TARGET_DATE_INVALID");
  }
  return Math.round((endMs - startMs) / 86_400_000);
};

const zonedStartOfLocalDate = (localDate: string, timezone: string): string => {
  const [year, month, day] = localDate.split("-").map(Number);
  if (!year || !month || !day) throw new Error("PRESCHOOL_MONTHLY_TARGET_DATE_INVALID");
  const localAsUtc = Date.UTC(year, month - 1, day);
  let guess = localAsUtc;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(guess));
    const valueOf = (type: Intl.DateTimeFormatPartTypes): number => Number(
      parts.find((part) => part.type === type)?.value ?? Number.NaN,
    );
    const zonedAsUtc = Date.UTC(
      valueOf("year"),
      valueOf("month") - 1,
      valueOf("day"),
      valueOf("hour"),
      valueOf("minute"),
      valueOf("second"),
    );
    guess = localAsUtc - (zonedAsUtc - guess);
  }
  return new Date(guess).toISOString();
};

const round = (value: number): number => Math.round(value * 100) / 100;
