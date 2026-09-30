import type { EnergyDailyUsageAnomalies } from "./energy-analysis.js";

type AvailableDailyUsageAnomalies = Extract<
  EnergyDailyUsageAnomalies,
  { status: "available" }
>;
type DailyUsageAnomalyScope = AvailableDailyUsageAnomalies["scopes"][number];
type DailyUsageAnomalyRow = DailyUsageAnomalyScope["rows"][number];

export type NgeeAnnDecisionPriorityEvidencePins =
  AvailableDailyUsageAnomalies["evidencePins"];

export type NgeeAnnDecisionPriorityLimitation = {
  code:
    | "DAILY_USAGE_ANOMALIES_ABSENT"
    | "DAILY_USAGE_ANOMALIES_UNAVAILABLE"
    | "DAILY_USAGE_ANOMALIES_CONTRACT_MISMATCH"
    | "EVIDENCE_PINS_MISMATCH"
    | "ALL_CANDIDATE_DATES_SUPPRESSED"
    | "SOME_CANDIDATE_DATES_SUPPRESSED"
    | "SUPPORTING_EVIDENCE_PARTIAL";
  message: string;
};

export type NgeeAnnDecisionPriority = {
  priorityId: string;
  rank: 1 | 2 | 3;
  source: "daily_usage_anomaly";
  finding: {
    code: "DAILY_USAGE_ABOVE_BASELINE";
    title: string;
    actualKwh: number;
    baselineKwh: number;
    relativePct: number;
  };
  sourceOccurrenceIds: string[];
  recurrenceDayCount: number;
  horizons: Array<{
    horizon: "latest_complete_day" | "rolling_7d" | "rolling_28d";
    label: "Latest complete day" | "Rolling 7 days" | "Rolling 28 days";
    status: "available" | "unavailable";
    period: { fromLocalDate: string; toLocalDate: string };
    actualKwh: number | null;
    baselineKwh: number | null;
    deltaKwh: number | null;
    relativePct: number | null;
    limitation: string | null;
  }>;
  driver: {
    status: "available";
    kind: "official_scope" | "component_circuit";
    scopeId: string;
    label: string;
    impactKwh: number;
    limitation: "Evidence only; not a confirmed root cause.";
  } | {
    status: "unavailable";
    limitation: string;
  };
  evidence: {
    bundleId: string;
    metricId: "energy.total_usage_kwh@1";
    queryIds: ["time_slot_anomaly_v1"];
    ruleRevisionId: "comparison.daily_usage_above_baseline@1";
    period: {
      from: string;
      to: string;
    };
    occurrence: {
      scopeId: string;
      scopeName: string;
      scopeType: string;
      localDate: string;
      from: string;
      to: string;
    };
    primaryIncidentId: string;
    supportingIncidentIds: string[];
  };
  impact: {
    energy: {
      status: "available";
      deltaKwh: number;
    };
    cost: {
      status: "unavailable";
      reason: {
        code: "INCIDENT_COST_NOT_SUPPORTED_BY_CURRENT_EVIDENCE";
        message: string;
      };
    };
  };
  action: {
    code: "INSPECT_DAILY_USAGE_DRIVERS";
    label: string;
    targetIncidentId: string;
    targetRef: { kind: "daily_usage_incident"; id: string };
    nextCheck: string;
    verificationMetricRef: {
      metricId: "energy.total_usage_kwh@1";
      label: string;
    };
  };
  confidence: {
    status: "complete" | "partial";
    limitation: NgeeAnnDecisionPriorityLimitation | null;
  };
};

export type NgeeAnnDecisionPriorities = {
  status: "available" | "empty" | "partial" | "suppressed" | "unavailable";
  limitation: NgeeAnnDecisionPriorityLimitation | null;
  evidencePins: NgeeAnnDecisionPriorityEvidencePins;
  items: NgeeAnnDecisionPriority[];
};

type AnomalyOccurrence = {
  scope: Pick<DailyUsageAnomalyScope, "scopeId" | "scopeName" | "scopeType">;
  row: DailyUsageAnomalyRow;
};

type CompleteTriggeredOccurrence = AnomalyOccurrence & {
  row: DailyUsageAnomalyRow & {
    actualKwh: number;
    baselineKwh: number;
    impactKwh: number;
    relativePct: number;
  };
};

const DAILY_USAGE_RULE_REVISION_ID = "comparison.daily_usage_above_baseline@1" as const;
const DAILY_USAGE_METRIC_ID = "energy.total_usage_kwh@1" as const;
const DAILY_USAGE_QUERY_ID = "time_slot_anomaly_v1" as const;

export const buildNgeeAnnDecisionPriorities = (input: {
  selectedScopeId: string;
  primaryPeriod: {
    start: string;
    endExclusive: string;
  };
  expectedEvidencePins: NgeeAnnDecisionPriorityEvidencePins;
  dailyUsageAnomalies: EnergyDailyUsageAnomalies | undefined;
}): NgeeAnnDecisionPriorities => {
  const unavailable = (
    limitation: NgeeAnnDecisionPriorityLimitation,
  ): NgeeAnnDecisionPriorities => ({
    status: "unavailable",
    limitation,
    evidencePins: input.expectedEvidencePins,
    items: [],
  });

  const source = input.dailyUsageAnomalies;
  if (!source) {
    return unavailable({
      code: "DAILY_USAGE_ANOMALIES_ABSENT",
      message: "Decision priorities are unavailable because the trusted daily anomaly bundle is absent.",
    });
  }
  if (source.status === "unavailable") {
    return unavailable({
      code: "DAILY_USAGE_ANOMALIES_UNAVAILABLE",
      message: source.reason.message,
    });
  }
  if (!sameEvidencePins(source.evidencePins, input.expectedEvidencePins)) {
    return unavailable({
      code: "EVIDENCE_PINS_MISMATCH",
      message: "Decision priorities were withheld because the daily anomaly Evidence pins do not match this Snapshot.",
    });
  }
  if (!validSourceContract(source)) {
    return unavailable({
      code: "DAILY_USAGE_ANOMALIES_CONTRACT_MISMATCH",
      message: "Decision priorities were withheld because the daily anomaly bundle does not match the released rule contract.",
    });
  }

  const occurrences = source.scopes.flatMap<AnomalyOccurrence>((scope) => scope.rows.map((row) => ({
    scope: {
      scopeId: scope.scopeId,
      scopeName: scope.scopeName,
      scopeType: scope.scopeType,
    },
    row,
  })));
  const triggered = occurrences.filter(isCompleteTriggeredOccurrence);
  const selectedTriggered = triggered
    .filter((occurrence) => occurrence.scope.scopeId === input.selectedScopeId)
    .sort(compareOccurrenceImpact);
  const highestImpactLevels = triggered
    .filter((occurrence) => occurrence.scope.scopeType.toLocaleLowerCase() === "level")
    .sort(compareOccurrenceImpact);
  const primary = selectedTriggered[0] ?? highestImpactLevels[0];
  const items = primary ? [primary].map<NgeeAnnDecisionPriority>((themePrimary) => {
    const primaryScope = source.scopes.find((scope) => scope.scopeId === themePrimary.scope.scopeId);
    const supporting = triggered
      .filter((occurrence) => occurrence.row.incidentId !== themePrimary.row.incidentId)
      .sort((left, right) => left.row.localDate.localeCompare(right.row.localDate)
        || compareOccurrenceImpact(left, right));
    const sourceOccurrenceIds = [themePrimary, ...supporting]
      .map((occurrence) => occurrence.row.incidentId)
      .sort((left, right) => left.localeCompare(right));
    const recurrenceDayCount = new Set(
      triggered
        .filter((occurrence) => occurrence.scope.scopeId === themePrimary.scope.scopeId)
        .map((occurrence) => occurrence.row.localDate),
    ).size;
    const confidencePartial = occurrences.some((occurrence) => (
      occurrence.row.outcome === "suppressed"
      || occurrence.row.detailSeries.some((series) => series.status !== "available")
    ));
    const latest = primaryScope?.rows
      .slice()
      .sort((left, right) => right.localDate.localeCompare(left.localDate))[0];
    const rollingByHorizon = new Map(
      (primaryScope?.rollingComparisons ?? []).map((comparison) => [comparison.horizon, comparison]),
    );
    const driver = themePrimary.row.detailSeries
      .filter((series) => series.relationship !== "selected_scope"
        && series.status === "available"
        && series.impactKwh !== null
        && Number.isFinite(series.impactKwh)
        && series.impactKwh > 0)
      .sort((left, right) => (right.impactKwh ?? 0) - (left.impactKwh ?? 0)
        || left.seriesId.localeCompare(right.seriesId))[0];
    return {
      priorityId: [
        "decision-theme",
        source.bundleId,
        source.ruleRevisionId,
        source.metricId,
        themePrimary.scope.scopeId,
      ].join(":"),
      rank: 1,
      source: "daily_usage_anomaly",
      finding: {
        code: "DAILY_USAGE_ABOVE_BASELINE",
        title: `${themePrimary.scope.scopeName} recorded ${recurrenceDayCount} distinct daily usage exception${recurrenceDayCount === 1 ? "" : "s"} in this Snapshot.`,
        actualKwh: themePrimary.row.actualKwh,
        baselineKwh: themePrimary.row.baselineKwh,
        relativePct: themePrimary.row.relativePct,
      },
      sourceOccurrenceIds,
      recurrenceDayCount,
      horizons: [
        latest && latest.outcome !== "suppressed" && hasCompleteTriggeredValues(latest)
          ? {
              horizon: "latest_complete_day",
              label: "Latest complete day",
              status: "available",
              period: { fromLocalDate: latest.localDate, toLocalDate: latest.localDate },
              actualKwh: latest.actualKwh,
              baselineKwh: latest.baselineKwh,
              deltaKwh: latest.impactKwh,
              relativePct: latest.relativePct,
              limitation: null,
            }
          : {
              horizon: "latest_complete_day",
              label: "Latest complete day",
              status: "unavailable",
              period: {
                fromLocalDate: latest?.localDate ?? source.baselineCutoff,
                toLocalDate: latest?.localDate ?? source.baselineCutoff,
              },
              actualKwh: null,
              baselineKwh: null,
              deltaKwh: null,
              relativePct: null,
              limitation: latest?.suppressionReason?.message ?? "Complete latest-day Evidence is unavailable.",
            },
        ...(["rolling_7d", "rolling_28d"] as const).map((horizon) => {
          const comparison = rollingByHorizon.get(horizon);
          const label = horizon === "rolling_7d" ? "Rolling 7 days" as const : "Rolling 28 days" as const;
          if (!comparison || comparison.status === "unavailable") {
            return {
              horizon,
              label,
              status: "unavailable" as const,
              period: {
                fromLocalDate: comparison?.current.fromLocalDate ?? source.baselineCutoff,
                toLocalDate: comparison?.current.toLocalDate ?? source.baselineCutoff,
              },
              actualKwh: comparison?.current.totalKwh ?? null,
              baselineKwh: comparison?.baseline.totalKwh ?? null,
              deltaKwh: null,
              relativePct: null,
              limitation: comparison?.reason.message ?? `${label} Evidence is unavailable.`,
            };
          }
          return {
            horizon,
            label,
            status: "available" as const,
            period: {
              fromLocalDate: comparison.current.fromLocalDate,
              toLocalDate: comparison.current.toLocalDate,
            },
            actualKwh: comparison.current.totalKwh,
            baselineKwh: comparison.baseline.totalKwh,
            deltaKwh: comparison.deltaKwh,
            relativePct: comparison.relativePct,
            limitation: null,
          };
        }),
      ],
      driver: driver
        ? {
            status: "available",
            kind: driver.kind,
            scopeId: driver.scopeId,
            label: driver.scopeName,
            impactKwh: driver.impactKwh!,
            limitation: "Evidence only; not a confirmed root cause.",
          }
        : {
            status: "unavailable",
            limitation: "No complete Level or Circuit driver Evidence is available for the primary occurrence.",
          },
      evidence: {
        bundleId: source.bundleId,
        metricId: DAILY_USAGE_METRIC_ID,
        queryIds: [DAILY_USAGE_QUERY_ID],
        ruleRevisionId: DAILY_USAGE_RULE_REVISION_ID,
        period: {
          from: input.primaryPeriod.start,
          to: input.primaryPeriod.endExclusive,
        },
        occurrence: {
          scopeId: themePrimary.scope.scopeId,
          scopeName: themePrimary.scope.scopeName,
          scopeType: themePrimary.scope.scopeType,
          localDate: themePrimary.row.localDate,
          from: themePrimary.row.from,
          to: themePrimary.row.to,
        },
        primaryIncidentId: themePrimary.row.incidentId,
        supportingIncidentIds: supporting.map((occurrence) => occurrence.row.incidentId),
      },
      impact: {
        energy: {
          status: "available",
          deltaKwh: themePrimary.row.impactKwh,
        },
        cost: {
          status: "unavailable",
          reason: {
            code: "INCIDENT_COST_NOT_SUPPORTED_BY_CURRENT_EVIDENCE",
            message: "The current daily anomaly Evidence does not calculate an incident-level cost delta.",
          },
        },
      },
      action: {
        code: "INSPECT_DAILY_USAGE_DRIVERS",
        label: "Review the strongest supported Level, Circuit and hourly Evidence before changing schedules or equipment.",
        targetIncidentId: themePrimary.row.incidentId,
        targetRef: { kind: "daily_usage_incident", id: themePrimary.row.incidentId },
        nextCheck: "Open the highest-impact day, then compare its hourly pattern and largest contributing Circuits with a comparable day.",
        verificationMetricRef: {
          metricId: DAILY_USAGE_METRIC_ID,
          label: "After the check, compare daily and 7-day usage with the same baseline",
        },
      },
      confidence: confidencePartial
        ? {
            status: "partial",
            limitation: {
              code: "SUPPORTING_EVIDENCE_PARTIAL",
              message: "One or more supporting Scope or Circuit series is suppressed, partial or unavailable.",
            },
          }
        : { status: "complete", limitation: null },
    };
  }) : [];

  const suppressedCount = occurrences.filter((occurrence) => occurrence.row.outcome === "suppressed").length;
  if (items.length === 0) {
    if (occurrences.length > 0 && suppressedCount === occurrences.length) {
      return {
        status: "suppressed",
        limitation: {
          code: "ALL_CANDIDATE_DATES_SUPPRESSED",
          message: "All candidate dates were suppressed by the released Calendar, coverage, quality or baseline gates.",
        },
        evidencePins: input.expectedEvidencePins,
        items,
      };
    }
    if (suppressedCount > 0) {
      return {
        status: "partial",
        limitation: {
          code: "SOME_CANDIDATE_DATES_SUPPRESSED",
          message: "Some candidate dates were suppressed, so the absence of a priority is not a complete no-exception conclusion.",
        },
        evidencePins: input.expectedEvidencePins,
        items,
      };
    }
    return {
      status: "empty",
      limitation: null,
      evidencePins: input.expectedEvidencePins,
      items,
    };
  }

  if (suppressedCount > 0 || items.some((item) => item.confidence.status === "partial")) {
    return {
      status: "partial",
      limitation: suppressedCount > 0
        ? {
            code: "SOME_CANDIDATE_DATES_SUPPRESSED",
            message: "Some candidate dates were suppressed; available priorities remain limited to eligible Evidence.",
          }
        : {
            code: "SUPPORTING_EVIDENCE_PARTIAL",
            message: "One or more priorities has partial supporting Evidence.",
          },
      evidencePins: input.expectedEvidencePins,
      items,
    };
  }

  return {
    status: "available",
    limitation: null,
    evidencePins: input.expectedEvidencePins,
    items,
  };
};

const validSourceContract = (source: AvailableDailyUsageAnomalies): boolean => (
  source.metricId === DAILY_USAGE_METRIC_ID
  && source.queryId === DAILY_USAGE_QUERY_ID
  && source.ruleRevisionId === DAILY_USAGE_RULE_REVISION_ID
  && source.scopes.every((scope) => scope.rows.every((row) => (
    row.metricId === DAILY_USAGE_METRIC_ID
    && row.queryId === DAILY_USAGE_QUERY_ID
    && row.ruleRevisionId === DAILY_USAGE_RULE_REVISION_ID
    && (row.outcome !== "triggered" || hasCompleteTriggeredValues(row))
  )))
);

const hasCompleteTriggeredValues = (
  row: DailyUsageAnomalyRow,
): row is DailyUsageAnomalyRow & {
  actualKwh: number;
  baselineKwh: number;
  impactKwh: number;
  relativePct: number;
} => row.actualKwh !== null
  && row.baselineKwh !== null
  && row.impactKwh !== null
  && row.relativePct !== null;

const isCompleteTriggeredOccurrence = (
  occurrence: AnomalyOccurrence,
): occurrence is CompleteTriggeredOccurrence => occurrence.row.outcome === "triggered"
  && hasCompleteTriggeredValues(occurrence.row);

const compareOccurrenceImpact = (left: AnomalyOccurrence, right: AnomalyOccurrence): number => (
  (right.row.impactKwh ?? Number.NEGATIVE_INFINITY)
    - (left.row.impactKwh ?? Number.NEGATIVE_INFINITY)
  || right.row.localDate.localeCompare(left.row.localDate)
  || left.scope.scopeId.localeCompare(right.scope.scopeId)
);

const sameEvidencePins = (
  left: NgeeAnnDecisionPriorityEvidencePins,
  right: NgeeAnnDecisionPriorityEvidencePins,
): boolean => left.projectReleaseId === right.projectReleaseId
  && left.dataSnapshotId === right.dataSnapshotId
  && left.hierarchyRevisionId === right.hierarchyRevisionId
  && left.meterMappingRevisionId === right.meterMappingRevisionId
  && left.meterFormulaRevisionId === right.meterFormulaRevisionId
  && left.metricVersion === right.metricVersion
  && left.businessCalendarVersion === right.businessCalendarVersion
  && left.queryIds.length === right.queryIds.length
  && left.queryIds.every((queryId, index) => queryId === right.queryIds[index]);
