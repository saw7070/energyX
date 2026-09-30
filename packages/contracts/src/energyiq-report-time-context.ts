export const ENERGYIQ_REPORT_TIME_CONTEXT_REVISION = "energyiq-report-time-context@1" as const;

export type ReportTimeBinding = {
  workspaceId: string;
  projectId: string;
  scopeId: string;
  resource: string;
  dataSnapshotId: string;
  projectReleaseId: string;
};

export type ReportWindowStrategy =
  | { kind: "rolling_complete_days"; days: number }
  | { kind: "calendar_month_to_date" }
  | { kind: "completed_calendar_months"; months: number }
  | { kind: "prior_equivalent_progress"; months: number; sourceWindowId: string }
  | { kind: "next_complete_calendar_month" }
  | { kind: "same_day_type_baseline"; lookbackDays: number; sourceWindowId: string };

export type ReportWindowPolicy = {
  windowId: string;
  role: string;
  label: string;
  strategy: ReportWindowStrategy;
};

export type ReportTimePolicyRevision = {
  policyId: string;
  revision: string;
  windows: ReportWindowPolicy[];
};

export type ResolvedReportWindow = {
  windowId: string;
  role: string;
  label: string;
  strategy: ReportWindowStrategy;
  phase: "complete" | "partial" | "forecast";
  from: string;
  toExclusive: string;
  completeDayCount: number;
  segments: Array<{ from: string; toExclusive: string }>;
  comparisonCompatibilityKey: string;
};

export type ReportTimeContext = {
  contractRevision: typeof ENERGYIQ_REPORT_TIME_CONTEXT_REVISION;
  binding: ReportTimeBinding;
  timezone: string;
  asOf: string;
  acceptedDataEndExclusive: string;
  dataThroughLocalDate: string;
  lastRefreshedAt: string;
  policyId: string;
  policyRevision: string;
  windows: ResolvedReportWindow[];
};

/**
 * Immutable report-time provenance persisted beside a Saved or generated AI
 * result. Volatile resolution timestamps are deliberately excluded.
 */
export type ReportTimeBasis = {
  contractRevision: typeof ENERGYIQ_REPORT_TIME_CONTEXT_REVISION;
  timezone: string;
  acceptedDataEndExclusive: string;
  dataThroughLocalDate: string;
  policyId: string;
  policyRevision: string;
  windows: Array<Pick<ResolvedReportWindow,
    "windowId" | "role" | "label" | "strategy" | "phase" | "from" | "toExclusive"
    | "completeDayCount" | "segments" | "comparisonCompatibilityKey">>;
};

export const reportTimeBasisFromContext = (context: ReportTimeContext): ReportTimeBasis => ({
  contractRevision: context.contractRevision,
  timezone: context.timezone,
  acceptedDataEndExclusive: context.acceptedDataEndExclusive,
  dataThroughLocalDate: context.dataThroughLocalDate,
  policyId: context.policyId,
  policyRevision: context.policyRevision,
  windows: context.windows.map((window) => ({
    windowId: window.windowId,
    role: window.role,
    label: window.label,
    strategy: window.strategy,
    phase: window.phase,
    from: window.from,
    toExclusive: window.toExclusive,
    completeDayCount: window.completeDayCount,
    segments: window.segments.map((segment) => ({ ...segment })),
    comparisonCompatibilityKey: window.comparisonCompatibilityKey,
  })),
});

