import type { EnergyIqSavedAnalysisRecord } from "@datafoundry/metadata";

import type { EnergyDailyUsageAnomalies } from "./energy-analysis.js";
import type { NgeeAnnDecisionPriorities } from "./ngee-ann-decision-priorities.js";

export type NgeeAnnDecisionLifecycleKind =
  | "new"
  | "newly_supported"
  | "recurring"
  | "resolved"
  | "no_longer_supported";

export type NgeeAnnDecisionLifecycle = {
  status: "available" | "unavailable";
  reference: {
    savedAnalysisId: string;
    dataSnapshotId: string;
    createdAt: string;
    evidenceStatus: "available" | "incomplete" | "unavailable";
  } | null;
  currentDataSnapshotId: string;
  items: Array<{
    themeKey: string;
    kind: NgeeAnnDecisionLifecycleKind;
    currentPriorityId: string | null;
    currentBundleId: string | null;
    previousBundleId: string | null;
  }>;
  limitation: {
    code: "NO_COMPATIBLE_SAVED_ANALYSIS" | "CURRENT_THEME_EVIDENCE_INCOMPLETE";
    message: string;
  } | null;
};

type DailyThemeState = {
  evidenceStatus: "available" | "incomplete" | "unavailable";
  active: boolean;
  bundleId: string | null;
};

type CompatibleSavedAnalysis = {
  record: EnergyIqSavedAnalysisRecord;
  dailyUsageAnomalies: EnergyDailyUsageAnomalies;
};

const DAILY_USAGE_RULE_REVISION_ID = "comparison.daily_usage_above_baseline@1" as const;
const DAILY_USAGE_METRIC_ID = "energy.total_usage_kwh@1" as const;

export const ngeeAnnDecisionThemeKey = (scopeId: string): string => [
  "decision-theme",
  "daily_usage_anomaly",
  DAILY_USAGE_RULE_REVISION_ID,
  DAILY_USAGE_METRIC_ID,
  scopeId,
].join(":");

export const buildNgeeAnnDecisionLifecycle = (input: {
  projectId: string;
  workspaceId: string;
  scopeId: string;
  resource: "electricity";
  templateRevisionId: string | null;
  currentDataSnapshotId: string;
  currentPriorities: NgeeAnnDecisionPriorities;
  currentDailyUsageAnomalies: EnergyDailyUsageAnomalies | undefined;
  savedAnalyses: readonly EnergyIqSavedAnalysisRecord[];
}): NgeeAnnDecisionLifecycle => {
  const unavailable = (
    code: NonNullable<NgeeAnnDecisionLifecycle["limitation"]>["code"],
    message: string,
  ): NgeeAnnDecisionLifecycle => ({
    status: "unavailable",
    reference: null,
    currentDataSnapshotId: input.currentDataSnapshotId,
    items: [],
    limitation: { code, message },
  });
  if (!input.templateRevisionId) {
    return unavailable(
      "NO_COMPATIBLE_SAVED_ANALYSIS",
      "A previous result cannot be compared because this Release has no pinned Template Revision.",
    );
  }
  const previous = input.savedAnalyses
    .filter((record) => record.project_id === input.projectId
      && record.workspace_id === input.workspaceId
      && record.scope_id === input.scopeId
      && record.resource === input.resource
      && record.template_revision_id === input.templateRevisionId
      && record.data_snapshot_id !== input.currentDataSnapshotId)
    .map(parseCompatibleSavedAnalysis)
    .find((candidate): candidate is CompatibleSavedAnalysis => candidate !== null);
  if (!previous) {
    return unavailable(
      "NO_COMPATIBLE_SAVED_ANALYSIS",
      "Save one governed Overview result before the next data update to compare decision themes across Snapshots.",
    );
  }

  const current = dailyThemeState(input.currentDailyUsageAnomalies);
  const prior = dailyThemeState(previous.dailyUsageAnomalies);
  const reference: NonNullable<NgeeAnnDecisionLifecycle["reference"]> = {
    savedAnalysisId: previous.record.id,
    dataSnapshotId: previous.record.data_snapshot_id,
    createdAt: previous.record.created_at,
    evidenceStatus: prior.evidenceStatus,
  };
  const currentPriority = input.currentPriorities.items[0] ?? null;
  const themeKey = ngeeAnnDecisionThemeKey(input.scopeId);

  if (current.active && currentPriority) {
    const kind: NgeeAnnDecisionLifecycleKind = prior.active
      ? "recurring"
      : prior.evidenceStatus === "available"
        ? "new"
        : "newly_supported";
    return {
      status: "available",
      reference,
      currentDataSnapshotId: input.currentDataSnapshotId,
      items: [{
        themeKey,
        kind,
        currentPriorityId: currentPriority.priorityId,
        currentBundleId: current.bundleId,
        previousBundleId: prior.bundleId,
      }],
      limitation: null,
    };
  }

  if (!current.active && prior.active) {
    const currentComplete = current.evidenceStatus === "available"
      && input.currentPriorities.status === "empty";
    return {
      status: "available",
      reference,
      currentDataSnapshotId: input.currentDataSnapshotId,
      items: [{
        themeKey,
        kind: currentComplete ? "resolved" : "no_longer_supported",
        currentPriorityId: null,
        currentBundleId: current.bundleId,
        previousBundleId: prior.bundleId,
      }],
      limitation: currentComplete
        ? null
        : {
            code: "CURRENT_THEME_EVIDENCE_INCOMPLETE",
            message: "The previous theme is not shown as resolved because the current Calendar, coverage, quality or baseline Evidence is incomplete.",
          },
    };
  }

  return {
    status: "available",
    reference,
    currentDataSnapshotId: input.currentDataSnapshotId,
    items: [],
    limitation: current.evidenceStatus === "available"
      ? null
      : {
          code: "CURRENT_THEME_EVIDENCE_INCOMPLETE",
          message: "No cross-Snapshot theme conclusion is shown because the current Calendar, coverage, quality or baseline Evidence is incomplete.",
        },
  };
};

const parseCompatibleSavedAnalysis = (
  record: EnergyIqSavedAnalysisRecord,
): CompatibleSavedAnalysis | null => {
  try {
    const query = JSON.parse(record.query_json) as unknown;
    const analysis = JSON.parse(record.analysis_json) as unknown;
    if (!isRecord(query)
      || query.analysisWindow !== "current-month-to-date"
      || !isRecord(analysis)
      || !isRecord(analysis.provenance)
      || analysis.provenance.dataSnapshotId !== record.data_snapshot_id
      || !isDailyUsageAnomalies(analysis.dailyUsageAnomalies, record.data_snapshot_id)) return null;
    return { record, dailyUsageAnomalies: analysis.dailyUsageAnomalies };
  } catch {
    return null;
  }
};

const dailyThemeState = (
  source: EnergyDailyUsageAnomalies | undefined,
): DailyThemeState => {
  if (!source || source.status === "unavailable") {
    return { evidenceStatus: "unavailable", active: false, bundleId: null };
  }
  const rows = source.scopes.flatMap((scope) => scope.rows);
  const active = rows.some((row) => row.outcome === "triggered");
  const incomplete = rows.some((row) => row.outcome === "suppressed");
  return {
    evidenceStatus: incomplete ? "incomplete" : "available",
    active,
    bundleId: source.bundleId,
  };
};

const isDailyUsageAnomalies = (
  value: unknown,
  expectedDataSnapshotId: string,
): value is EnergyDailyUsageAnomalies => {
  if (!isRecord(value)
    || (value.status !== "available" && value.status !== "unavailable")
    || value.ruleRevisionId !== DAILY_USAGE_RULE_REVISION_ID) return false;
  if (value.status === "unavailable") {
    return isRecord(value.reason)
      && typeof value.reason.code === "string"
      && typeof value.reason.message === "string";
  }
  return value.metricId === DAILY_USAGE_METRIC_ID
    && value.queryId === "time_slot_anomaly_v1"
    && typeof value.bundleId === "string"
    && isRecord(value.evidencePins)
    && value.evidencePins.dataSnapshotId === expectedDataSnapshotId
    && Array.isArray(value.scopes)
    && value.scopes.every((scope) => isRecord(scope)
      && Array.isArray(scope.rows)
      && scope.rows.every((row) => isRecord(row)
        && ["triggered", "within_threshold", "suppressed"].includes(String(row.outcome))));
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
