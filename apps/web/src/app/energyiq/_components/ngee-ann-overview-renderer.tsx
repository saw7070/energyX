import React from "react";
import { reportTimeBasisFromContext } from "@datafoundry/contracts";

import type {
  EnergyProjectAnalysisSnapshotDto,
  EnergySavedAnalysisAiArtifactDto,
  EnergySavedAnalysisAiArtifactInputDto,
} from "../../../lib/config-api";
import { EnergyIcon } from "./icons";
import { NgeeAnnAiSlot } from "./ngee-ann-ai-slot";
import { NgeeAnnProjectAiSlots } from "./ngee-ann-project-ai-slots";
import { NgeeAnnCircuitRanking } from "./ngee-ann-circuit-ranking";
import { NgeeAnnDailyTrendSection } from "./ngee-ann-daily-trend-section";
import { NgeeAnnDayProfile } from "./ngee-ann-day-profile";
import { NgeeAnnDecisionPriorities } from "./ngee-ann-decision-priorities";
import { NgeeAnnConsumptionBreakdown } from "./ngee-ann-consumption-breakdown";
import { NgeeAnnEnergyComposition } from "./ngee-ann-energy-composition";
import { NgeeAnnEnergyDistribution } from "./ngee-ann-energy-distribution";
import { NgeeAnnEnergyHealth } from "./ngee-ann-energy-health";
import { NgeeAnnExecutiveSummary } from "./ngee-ann-executive-summary";
import { NgeeAnnLevelComparison } from "./ngee-ann-level-comparison";
import { NgeeAnnMonthlyContext } from "./ngee-ann-monthly-context";
import { NgeeAnnSchoolHolidayComparison } from "./ngee-ann-school-holiday-comparison";
import { NgeeAnnSummaryFindings } from "./ngee-ann-summary-findings";
import { NgeeAnnUsageHeatmap } from "./ngee-ann-usage-heatmap";
import { OverviewWindowLabel } from "./overview-report-time";
import {
  buildNgeeAnnOverviewViewModel,
  type NgeeAnnLatestAvailableRange,
  type NgeeAnnOverviewDataStatus,
  type NgeeAnnOverviewViewModel,
} from "./ngee-ann-overview-view-model";

export type NgeeAnnOverviewRendererState =
  | {
    status: "loading" | "empty" | "unsupported" | "error";
    title: string;
    detail: string;
  }
  | {
    status: "ready";
    snapshot: EnergyProjectAnalysisSnapshotDto;
  };

export function NgeeAnnOverviewRenderer({
  state,
  onRetry,
  onViewLatestAvailableData,
  latestAvailableRange,
  projectExplorerHref,
  aiAnalystHref,
  showContextHeader = true,
  aiSlotMode = "live",
  savedAiArtifact,
  onAiArtifactChange,
  grain,
  comparison = "overlay",
  category = "all",
  onComparisonChange,
  onCategoryChange,
}: {
  state: NgeeAnnOverviewRendererState;
  onRetry?: () => void;
  onViewLatestAvailableData?: (range: NgeeAnnLatestAvailableRange) => void;
  latestAvailableRange?: NgeeAnnLatestAvailableRange | null;
  projectExplorerHref?: string;
  aiAnalystHref?: string;
  showContextHeader?: boolean;
  aiSlotMode?: "live" | "saved";
  savedAiArtifact?: EnergySavedAnalysisAiArtifactDto;
  onAiArtifactChange?: (artifact: EnergySavedAnalysisAiArtifactInputDto | null) => void;
  grain?: "day" | "hour";
  comparison?: "overlay" | "selected" | "average";
  category?: "all" | "load" | "light";
  onComparisonChange?: (comparison: "overlay" | "selected" | "average") => void;
  onCategoryChange?: (category: "all" | "load" | "light") => void;
}) {
  if (state.status !== "ready") {
    return <NgeeAnnRendererState state={state} onRetry={onRetry} />;
  }

  const view = buildNgeeAnnOverviewViewModel(state.snapshot, {
    latestAvailableRange,
    ...(grain ? { trendGrain: grain } : {}),
  });
  const exactSectionManifest = state.snapshot.sectionManifest?.projectReleaseId
    === state.snapshot.projectRelease.id ? state.snapshot.sectionManifest : undefined;
  const schoolHolidayEnabled = exactSectionManifest?.enabledSectionIds
    .includes("school-holiday-comparison") === true;
  const schoolHolidayDisabledReason = exactSectionManifest?.disabledCapabilities
    .find(({ sectionId }) => sectionId === "school-holiday-comparison")?.reason;
  const schoolHolidayDeclared = schoolHolidayEnabled || schoolHolidayDisabledReason !== undefined;
  const schoolHolidayAi = schoolHolidayEnabled
    ? holidayAiPresentation(savedAiArtifact, state.snapshot)
    : undefined;
  const statusTone = dataStatusTone(view.dataStatus.status);
  const dataStatus = (
    <div className={`max-w-lg rounded-lg px-4 py-3 ${statusTone.surface}`} role="status">
      <div className="flex items-start gap-3">
        <EnergyIcon name={statusTone.icon} className={`mt-0.5 h-4 w-4 shrink-0 ${statusTone.text}`} />
        <div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className={`text-sm font-semibold ${statusTone.text}`}>{view.dataStatus.label}</p>
            <span className="text-xs text-muted">{view.dataStatus.coverage}</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted">{view.dataStatus.summary}</p>
          <details className="mt-1">
            <summary className="cursor-pointer text-xs font-medium text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
              Data details
            </summary>
            <p className="mt-1 text-xs leading-5 text-muted">
              {view.dataStatus.intervals} / {view.dataStatus.qualityEvents} / {view.dataStatus.lastSeen}
            </p>
            {view.metadataLimitation ? (
              <p className="mt-2 max-w-xl text-xs leading-5 text-muted">
                <span className="font-semibold text-foreground">Normalised benchmarks are not shown.</span>{" "}
                {view.metadataLimitation}
              </p>
            ) : null}
          </details>
        </div>
      </div>
    </div>
  );

  return (
    <section
      aria-label="Ngee Ann published energy analysis"
      data-ngee-ann-overview="true"
      data-data-status={view.dataStatus.status}
      className="overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-card)]"
    >
      {showContextHeader ? (
        <header className="grid gap-5 border-b border-border px-5 py-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start lg:px-7">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
              <span className="font-semibold text-foreground">{view.context.projectName}</span>
              <EnergyIcon name="chevron" className="h-3 w-3 text-muted-light" />
              <span>Scope · {view.context.scopeType === "project" ? "Whole project" : view.context.scopeName}</span>
            </div>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-foreground">
              Energy decision overview
            </h2>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
              <span className="inline-flex items-center gap-1.5">
                <EnergyIcon name="calendar" className="h-3.5 w-3.5 text-muted-light" />
                {view.context.periodRange}
              </span>
              <span>{view.context.timezone}</span>
            </div>
          </div>
          {dataStatus}
        </header>
      ) : (
        <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-5 py-3 text-sm ${statusTone.surface}`} role="status">
          <EnergyIcon name={statusTone.icon} className={`h-4 w-4 shrink-0 ${statusTone.text}`} />
          <span className={`font-semibold ${statusTone.text}`}>{view.dataStatus.label}</span>
          <span className="text-xs text-muted">{view.dataStatus.coverage}</span>
          <details className="text-xs text-muted">
            <summary className="cursor-pointer font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">Data details</summary>
            <p className="mt-1 leading-5">
              {view.dataStatus.intervals} / {view.dataStatus.qualityEvents} / {view.dataStatus.lastSeen}
            </p>
            {view.metadataLimitation ? (
              <p className="mt-2 max-w-xl leading-5">
                <span className="font-semibold text-foreground">Normalised benchmarks are not shown.</span>{" "}
                {view.metadataLimitation}
              </p>
            ) : null}
          </details>
        </div>
      )}

      {view.dataStatus.recovery ? (
        <div className="flex flex-col gap-3 border-b border-border bg-surface-subtle px-5 py-3 sm:flex-row sm:items-center sm:justify-between lg:px-7">
          <p className="max-w-3xl text-xs leading-5 text-muted">{view.dataStatus.recovery}</p>
          {view.latestAvailableRange && onViewLatestAvailableData ? (
            <button
              type="button"
              onClick={() => onViewLatestAvailableData(view.latestAvailableRange!)}
              className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-3.5 text-xs font-semibold text-white transition-colors hover:bg-primary-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-2"
            >
              View latest available data
              <EnergyIcon name="arrow" className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      ) : null}

      <OverviewSectionHeading
        id="ngee-ann-recommendations"
        title="Management themes"
        description="What changed, why it matters, and the first checks supported by this Report Edition. No saving is assumed."
        reportTimeContext={state.snapshot.reportTimeContext}
        windowIds={["current-month-progress"]}
      />

      <NgeeAnnDecisionPriorities
        view={view.decisionPriorities}
        projectExplorerHref={projectExplorerHref}
        aiAnalystHref={aiAnalystHref}
      />

      <OverviewSectionHeading
        id="ngee-ann-executive-summary"
        title="Executive Summary"
        description={view.executiveSummary.headline}
        reportTimeContext={state.snapshot.reportTimeContext}
        windowIds={["current-month-progress"]}
      />

      <NgeeAnnExecutiveSummary view={view} />

      <NgeeAnnMonthlyContext view={view.monthlyContext} />

      <NgeeAnnConsumptionBreakdown view={view.componentCategoryBreakdown} />

      <NgeeAnnEnergyDistribution view={view.componentCategoryBreakdown} />

      <div
        id="ngee-ann-ai-analysis"
        data-overview-section="true"
        data-overview-navigation-label="AI interpretation"
        tabIndex={-1}
        className="scroll-mt-28 border-b border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
      >
        {aiSlotMode === "saved" && savedAiArtifact?.contract === "energyiq-saved-ai-result@3"
          ? <NgeeAnnProjectAiSlots snapshot={state.snapshot} savedModel={savedAiArtifact.result} />
          : aiSlotMode === "saved" ? <NgeeAnnAiSlot
          snapshot={state.snapshot}
          decisionPriorities={view.decisionPriorities}
          aiAnalystHref={aiAnalystHref}
          mode={aiSlotMode}
          {...(savedAiArtifact?.rendererKey === "ngee-ann-overview"
            ? { savedResult: savedAiArtifact.result as unknown as Extract<import("./ngee-ann-ai-run").NgeeAnnAiRunResult, { status: "available" }> }
            : {})}
          {...(onAiArtifactChange ? {
            onCompletedResult: (result: Extract<import("./ngee-ann-ai-run").NgeeAnnAiRunResult, { status: "available" }>) => onAiArtifactChange({
              contract: "energyiq-saved-ai-result@1",
              rendererKey: "ngee-ann-overview",
              snapshotId: state.snapshot.dataSnapshot.id,
              projectReleaseId: state.snapshot.projectRelease.id,
              ...(state.snapshot.reportTimeContext
                ? { reportTimeBasis: reportTimeBasisFromContext(state.snapshot.reportTimeContext) }
                : {}),
              result,
            }),
          } : {})}
        /> : <NgeeAnnProjectAiSlots
          snapshot={state.snapshot}
          {...(onAiArtifactChange ? {
            onRestoredModel: (result) => onAiArtifactChange({
              contract: "energyiq-saved-ai-result@3",
              rendererKey: "ngee-ann-overview",
              snapshotId: state.snapshot.dataSnapshot.id,
              projectReleaseId: state.snapshot.projectRelease.id,
              ...(state.snapshot.reportTimeContext
                ? { reportTimeBasis: reportTimeBasisFromContext(state.snapshot.reportTimeContext) }
                : {}),
              result,
            }),
          } : {})}
        />}
      </div>

      {schoolHolidayDeclared ? <>
        <OverviewSectionHeading
          id="ngee-ann-school-holiday-comparison"
          title="School Holiday Comparison"
          description="Compare complete School Holiday and Teaching periods, then keep Rule-triggered anomalies separate from descriptive cohort changes."
          reportTimeContext={state.snapshot.reportTimeContext}
          windowIds={["school-holiday-comparison"]}
        />
        <NgeeAnnSchoolHolidayComparison
          comparison={state.snapshot.schoolHolidayComparison}
          unavailableReason={schoolHolidayDisabledReason ? holidayManifestReason(schoolHolidayDisabledReason) : undefined}
          projectExplorerHref={projectExplorerHref}
          aiAnalystHref={aiAnalystHref}
          {...(schoolHolidayAi?.headline ? { aiHeadline: schoolHolidayAi.headline } : {})}
          {...(schoolHolidayAi?.interpretation ? { aiInterpretation: schoolHolidayAi.interpretation } : {})}
        />
      </> : null}

      <div
        id="ngee-ann-daily-trend"
        data-overview-section="true"
        data-overview-navigation-label="Daily Total Trend"
        tabIndex={-1}
        className="scroll-mt-28 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
      >
        <div className="border-b border-border bg-surface-subtle/50 px-5 py-4 lg:px-7">
          <div className="mb-2 flex justify-end">
            <OverviewWindowLabel
              context={state.snapshot.reportTimeContext}
              windowIds={["recent-operations"]}
            />
          </div>
          <p className="max-w-4xl text-sm font-semibold leading-6 text-foreground">{view.changeOverTime.headline}</p>
          <p className="mt-1 max-w-4xl text-sm leading-6 text-muted">{view.changeOverTime.detail}</p>
        </div>
        <NgeeAnnDailyTrendSection
          key={[
            "daily-trend",
            view.energyTrend.evidence.period,
            view.dailyAnomalies.evidence.snapshotId,
            view.dailyAnomalies.evidence.projectReleaseId,
            view.dailyAnomalies.evidence.bundleId ?? "unavailable",
          ].join(":")}
          trend={view.energyTrend}
          anomalies={view.dailyAnomalies}
          comparison={comparison}
          category={category}
          onComparisonChange={onComparisonChange}
          onCategoryChange={onCategoryChange}
        />
      </div>

      <details
        id="ngee-ann-summary-findings"
        data-overview-section="true"
        data-overview-navigation-label="Supporting diagnostic index"
        tabIndex={-1}
        className="group scroll-mt-28 border-b border-border bg-surface"
      >
        <summary className="cursor-pointer list-none px-5 pb-4 pt-7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/20 lg:px-7 lg:pt-8 [&::-webkit-details-marker]:hidden">
          <span className="flex items-start justify-between gap-4">
            <span>
              <span data-overview-heading="true" className="block text-lg font-semibold tracking-[-0.015em] text-foreground">
                Supporting diagnostic index
              </span>
              <span className="mt-1.5 block max-w-3xl text-sm leading-6 text-muted">
                Open the six verified data checks when you need the supporting diagnostics behind the management themes.
              </span>
            </span>
            <EnergyIcon
              name="chevron"
              aria-hidden="true"
              className="mt-1 h-4 w-4 shrink-0 text-muted transition-transform group-open:rotate-180"
            />
          </span>
        </summary>
        <div className="border-t border-border">
          <div className="flex justify-end px-5 pt-4 lg:px-7">
            <OverviewWindowLabel
              context={state.snapshot.reportTimeContext}
              windowIds={["current-month-progress"]}
            />
          </div>
          <NgeeAnnSummaryFindings view={view} />
        </div>
      </details>

      <OverviewSectionHeading
        id="ngee-ann-day-profile-analysis"
        title="Day Profile Analysis"
        description="Compare the accepted 24-hour shape by Day Type and Scope."
        reportTimeContext={state.snapshot.reportTimeContext}
        windowIds={["recent-operations", "day-type-reference"]}
      />

      <NgeeAnnDayProfile key={`profile:${view.dayProfile.evidence.period}`} view={view.dayProfile} />

      <NgeeAnnUsageHeatmap key={`heatmap:${view.usageHeatmap.evidence.period}`} view={view.usageHeatmap} />

      <OverviewSectionHeading
        id="ngee-ann-energy-health"
        title="Time-based Behavioral Analysis"
        description="Review day-type averages, weekday time bands and accepted Level totals before moving into Circuit evidence."
        reportTimeContext={state.snapshot.reportTimeContext}
        windowIds={["recent-operations", "day-type-reference"]}
      />

      <NgeeAnnEnergyHealth dayProfile={view.dayProfile} levelComparison={view.levelComparison} />

      <NgeeAnnLevelComparison view={view.levelComparison} />

      <OverviewSectionHeading
        id="ngee-ann-circuit-analysis"
        title="Circuit Category Analysis"
        description="Rank the published Circuit evidence that explains the Project result."
        reportTimeContext={state.snapshot.reportTimeContext}
        windowIds={["recent-operations"]}
      />

      <NgeeAnnCircuitRanking view={view.energyComposition.circuits} />

      <NgeeAnnEnergyComposition
        view={view.energyComposition}
        category={category}
        onCategoryChange={onCategoryChange}
      />

      <div
        id="ngee-ann-evidence"
        data-overview-section="true"
        data-overview-navigation-label="Evidence and calculation details"
        tabIndex={-1}
        className="scroll-mt-28 px-5 py-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 lg:px-7 lg:py-6"
      >
        <div>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold tracking-[-0.015em] text-foreground">Evidence and calculation details</h3>
              <p className="mt-1.5 text-sm leading-6 text-muted">
                Open this section when you need to verify the Snapshot, Release or calculation route.
              </p>
            </div>
            <span className="rounded-md bg-surface-subtle px-2.5 py-1.5 text-xs font-medium text-muted">
              {view.evidence.references.length} references
            </span>
          </div>
          <p className="mt-3 text-sm text-muted">
            {view.evidence.projectRelease} · {view.evidence.importBatchCount} import batches · Metadata {view.evidence.metadataStatus}
          </p>
          <details className="mt-4 border-t border-border pt-4">
            <summary className="cursor-pointer text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
              View reproducible evidence and technical IDs
            </summary>
            <div className="mt-4 space-y-4 text-xs leading-5 text-muted">
              <dl className="space-y-2">
                <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2">
                  <dt className="text-muted">Snapshot</dt>
                  <dd className="break-all font-mono text-foreground">{view.evidence.snapshotId}</dd>
                </div>
                <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2">
                  <dt className="text-muted">Release</dt>
                  <dd className="break-all font-mono text-foreground">{view.evidence.projectReleaseId}</dd>
                </div>
              </dl>
              <div className="grid divide-y divide-border border-y border-border lg:grid-cols-2 lg:divide-x lg:divide-y-0">
                <ComparisonEvidence
                  evidence={view.evidence.comparison}
                  snapshotId={view.evidence.snapshotId}
                  projectReleaseId={view.evidence.projectReleaseId}
                />
                <CostEvidence
                  evidence={view.evidence.cost}
                  snapshotId={view.evidence.snapshotId}
                  projectReleaseId={view.evidence.projectReleaseId}
                />
              </div>
              <div className="border-t border-border pt-3">
                <p className="break-words">Shared queries: {view.evidence.queryIds.join(", ")}</p>
              </div>
              {view.evidence.references.map((reference) => (
                <div
                  key={reference.id}
                  id={evidenceReferenceDomId(reference.id)}
                  className="scroll-mt-24 border-t border-border pt-2"
                >
                  <p className="break-all font-mono text-foreground">{reference.id}</p>
                  <p>{reference.metricId} / {reference.queryIds.join(", ")}</p>
                  {reference.queryReceiptId ? <p className="break-all">Receipt: {reference.queryReceiptId}</p> : null}
                </div>
              ))}
            </div>
          </details>
        </div>
      </div>
    </section>
  );
}

export const holidayAiPresentation = (
  artifact: EnergySavedAnalysisAiArtifactDto | undefined,
  snapshot: EnergyProjectAnalysisSnapshotDto,
): { headline?: string; interpretation?: string } | undefined => {
  if (artifact?.contract !== "energyiq-saved-ai-result@3"
    || artifact.result.binding.dataSnapshotId !== snapshot.dataSnapshot.id
    || artifact.result.binding.projectReleaseId !== snapshot.projectRelease.id) return undefined;
  const unit = artifact.result.sections["school-holiday-comparison"];
  if (unit?.status !== "available") return undefined;
  const summary = unit.result.summary;
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return undefined;
  const text = (summary as Record<string, unknown>).text;
  const insights = unit.result.insights;
  const firstInsight = Array.isArray(insights) && insights.length > 0
    && typeof insights[0] === "object" && insights[0] !== null && !Array.isArray(insights[0])
    ? insights[0] as Record<string, unknown>
    : undefined;
  const title = firstInsight?.title;
  const headline = typeof title === "string" && title.trim() ? title.trim() : undefined;
  const interpretation = typeof text === "string" && text.trim() ? text.trim() : undefined;
  return headline || interpretation ? { ...(headline ? { headline } : {}), ...(interpretation ? { interpretation } : {}) } : undefined;
};

function holidayManifestReason(reason: string): string {
  const reasons: Record<string, string> = {
    SCHOOL_HOLIDAY_CALENDAR_REVISION_NOT_PINNED: "This Release does not pin the required School Holiday Calendar.",
    SCHOOL_HOLIDAY_CALENDAR_CONTRACT_INVALID: "The Release-pinned School Holiday Calendar does not satisfy the published contract.",
    SCHOOL_HOLIDAY_RULE_REVISION_NOT_PINNED: "This Release does not pin the required School Holiday comparison Rule.",
    SCHOOL_HOLIDAY_OVERVIEW_SECTION_NOT_PINNED: "This Release does not pin the School Holiday Overview Section.",
    SCHOOL_HOLIDAY_COMPARISON_WINDOW_NOT_PINNED: "This Release does not pin the School Holiday comparison window.",
    SCHOOL_HOLIDAY_COMPARISON_WINDOW_NOT_REGISTERED: "The Release-pinned School Holiday comparison window is unavailable.",
    SCHOOL_HOLIDAY_COMPARISON_WINDOW_STRATEGY_INVALID: "The Release-pinned School Holiday comparison window is invalid.",
    SCHOOL_HOLIDAY_CALENDAR_REVISION_NOT_FOUND: "The Release-pinned School Holiday Calendar is unavailable.",
    SCHOOL_HOLIDAY_ACADEMIC_PERIODS_NOT_CONFIGURED: "The Release-pinned School Holiday Calendar has no academic periods.",
    SCHOOL_HOLIDAY_RULE_REVISION_NOT_FOUND: "The Release-pinned School Holiday comparison Rule is unavailable.",
    SCHOOL_HOLIDAY_RELEASE_MANIFEST_NOT_FOUND: "The exact Project Release is unavailable.",
  };
  return reasons[reason] ?? "The exact School Holiday comparison identity is unavailable.";
}

function OverviewSectionHeading({
  id,
  title,
  description,
  reportTimeContext,
  windowIds,
}: {
  id: string;
  title: string;
  description: string;
  reportTimeContext?: NonNullable<EnergyProjectAnalysisSnapshotDto["reportTimeContext"]>;
  windowIds: readonly string[];
}) {
  return (
    <div
      id={id}
      data-overview-section="true"
      data-overview-navigation-label={title}
      aria-labelledby={`${id}-heading`}
      tabIndex={-1}
      className="scroll-mt-28 border-b border-border bg-surface px-5 pb-4 pt-7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 lg:px-7 lg:pt-8"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <h3 id={`${id}-heading`} className="text-lg font-semibold tracking-[-0.015em] text-foreground">{title}</h3>
        <OverviewWindowLabel context={reportTimeContext} windowIds={windowIds} />
      </div>
      <p className="mt-1.5 max-w-3xl text-sm leading-6 text-muted">{description}</p>
    </div>
  );
}

function ComparisonEvidence({
  evidence,
  snapshotId,
  projectReleaseId,
}: {
  evidence: NgeeAnnOverviewViewModel["evidence"]["comparison"];
  snapshotId: string;
  projectReleaseId: string;
}) {
  return (
    <section aria-labelledby="ngee-ann-comparison-evidence" className="min-w-0 py-4 lg:pr-5">
      <h4 id="ngee-ann-comparison-evidence" className="text-xs font-semibold text-foreground">
        Comparison evidence
      </h4>
      {evidence.status === "available" ? (
        <>
          <p className="mt-1 text-[11px] text-muted-light">Previous period uses [from, to): start inclusive, end exclusive.</p>
          <dl className="mt-3 grid grid-cols-[104px_minmax(0,1fr)] gap-x-3 gap-y-2">
            <dt className="text-muted-light">Previous period range</dt>
            <dd className="break-words text-foreground" title={`${evidence.from} / ${evidence.to}`}>
              {evidence.range}
            </dd>
            <dt className="text-muted-light">Current usage</dt>
            <dd className="tabular-nums text-foreground">{evidence.currentUsageKwh} kWh</dd>
            <dt className="text-muted-light">Previous usage</dt>
            <dd className="tabular-nums text-foreground">{evidence.previousUsageKwh} kWh</dd>
            <dt className="text-muted-light">Change</dt>
            <dd className="tabular-nums text-foreground">{evidence.changeKwh} kWh</dd>
            <dt className="text-muted-light">Change rate</dt>
            <dd className="tabular-nums text-foreground">{evidence.changePct}</dd>
          </dl>
        </>
      ) : (
        <p className="mt-2 text-foreground">No trusted comparison is available for this Period.</p>
      )}
      <EvidenceTrace
        snapshotId={snapshotId}
        projectReleaseId={projectReleaseId}
        queryIds={evidence.queryIds}
        referenceIds={evidence.referenceIds}
      />
    </section>
  );
}

function CostEvidence({
  evidence,
  snapshotId,
  projectReleaseId,
}: {
  evidence: NgeeAnnOverviewViewModel["evidence"]["cost"];
  snapshotId: string;
  projectReleaseId: string;
}) {
  return (
    <section aria-labelledby="ngee-ann-cost-evidence" className="min-w-0 py-4 lg:pl-5">
      <h4 id="ngee-ann-cost-evidence" className="text-xs font-semibold text-foreground">Cost evidence</h4>
      {evidence.status === "available" ? (
        <>
          <dl className="mt-3 grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-2">
            <dt className="text-muted-light">Cost total</dt>
            <dd className="tabular-nums text-foreground">{evidence.amount} {evidence.currency}</dd>
            <dt className="text-muted-light">Tariff</dt>
            <dd className="break-all text-foreground">{evidence.tariffScheduleVersion}</dd>
          </dl>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[620px] border-collapse text-left">
              <caption className="mb-2 text-left text-[11px] font-semibold text-foreground">Tariff allocations</caption>
              <thead className="border-y border-border text-muted-light">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-medium">Range [from, to)</th>
                  <th scope="col" className="px-3 py-2 font-medium">Rate</th>
                  <th scope="col" className="px-3 py-2 font-medium">Usage</th>
                  <th scope="col" className="py-2 pl-3 font-medium">Cost</th>
                </tr>
              </thead>
              <tbody>
                {evidence.allocations.map((allocation, index) => (
                  <tr key={`${allocation.from}:${allocation.to}:${index}`} className="border-b border-border last:border-b-0">
                    <td className="py-2 pr-3 text-foreground" title={`${allocation.from} / ${allocation.to}`}>{allocation.range}</td>
                    <td className="px-3 py-2 tabular-nums text-foreground">{allocation.displayRate ?? `${allocation.ratePerKwh} ${evidence.currency}/kWh`}</td>
                    <td className="px-3 py-2 tabular-nums text-foreground">{allocation.usageKwh} kWh</td>
                    <td className="py-2 pl-3 tabular-nums text-foreground">{allocation.cost} {evidence.currency}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <dl className="mt-3 grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-2">
          <dt className="text-muted-light">Status</dt>
          <dd className="font-semibold text-foreground">Unavailable</dd>
          <dt className="text-muted-light">Reason</dt>
          <dd className="text-foreground">{evidence.reason}</dd>
          <dt className="text-muted-light">Tariff</dt>
          <dd className="break-all text-foreground">{evidence.tariffScheduleVersion ?? "Unavailable"}</dd>
          <dt className="text-muted-light">Allocations</dt>
          <dd className="text-foreground">No allocation rows are available.</dd>
        </dl>
      )}
      <EvidenceTrace
        snapshotId={snapshotId}
        projectReleaseId={projectReleaseId}
        queryIds={evidence.queryIds}
        referenceIds={evidence.referenceIds}
      />
    </section>
  );
}

function EvidenceTrace({
  snapshotId,
  projectReleaseId,
  queryIds,
  referenceIds,
}: {
  snapshotId: string;
  projectReleaseId: string;
  queryIds: readonly string[];
  referenceIds: readonly string[];
}) {
  return (
    <div className="mt-3 border-t border-border pt-3">
      <p className="break-all">Snapshot: <span className="font-mono text-foreground">{snapshotId}</span></p>
      <p className="mt-1 break-all">Release: <span className="font-mono text-foreground">{projectReleaseId}</span></p>
      <p className="mt-1 break-words">Snapshot queries: {queryIds.join(", ")}</p>
      {referenceIds.length > 0 ? (
        <ul className="mt-1 space-y-1" aria-label="Evidence references">
          {referenceIds.map((referenceId) => (
            <li key={referenceId}>
              <a
                href={`#${evidenceReferenceDomId(referenceId)}`}
                className="break-all font-mono text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
              >
                {referenceId}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1">No dedicated Evidence reference is attached; use the Snapshot and query provenance above.</p>
      )}
    </div>
  );
}

function evidenceReferenceDomId(referenceId: string): string {
  return `ngee-ann-evidence-ref-${encodeURIComponent(referenceId).replaceAll("%", "_")}`;
}

function NgeeAnnRendererState({
  state,
  onRetry,
}: {
  state: Exclude<NgeeAnnOverviewRendererState, { status: "ready" }>;
  onRetry?: () => void;
}) {
  const meta = {
    loading: { label: "Loading", icon: "analysis" as const, tone: "text-muted", surface: "border-border bg-surface" },
    empty: { label: "No data", icon: "info" as const, tone: "text-muted", surface: "border-border bg-surface" },
    unsupported: { label: "Unsupported", icon: "info" as const, tone: "text-step-warning", surface: "border-step-warning/25 bg-step-warning/5" },
    error: { label: "Unavailable", icon: "alert" as const, tone: "text-step-error", surface: "border-step-error/25 bg-step-error/5" },
  }[state.status];
  const isError = state.status === "error";
  return (
    <section
      aria-label="Ngee Ann published energy analysis"
      role={isError ? "alert" : "status"}
      aria-live={state.status === "loading" ? "polite" : undefined}
      data-ngee-ann-overview="true"
      data-renderer-state={state.status}
      className={`rounded-xl border px-5 py-8 ${meta.surface}`}
    >
      <div className="mx-auto flex max-w-xl items-start gap-3">
        <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background ${meta.tone}`}>
          <EnergyIcon name={meta.icon} className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className={`text-ui-label font-semibold uppercase tracking-[0.08em] ${meta.tone}`}>{meta.label}</p>
          <h2 className="mt-1 text-ui-body font-semibold text-foreground">{state.title}</h2>
          <p className="mt-1 text-ui-support leading-5 text-muted">{state.detail}</p>
          {isError && onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="mt-4 rounded-lg border border-border bg-surface px-3 py-2 text-ui-support font-semibold text-foreground transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
            >
              Try again
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function dataStatusTone(status: NgeeAnnOverviewDataStatus): {
  surface: string;
  text: string;
  icon: "check" | "info" | "alert";
} {
  if (status === "ready") {
    return { surface: "bg-step-success/10", text: "text-step-success", icon: "check" };
  }
  if (status === "partial") {
    return { surface: "bg-step-warning/10", text: "text-step-warning", icon: "info" };
  }
  return { surface: "bg-step-error/10", text: "text-step-error", icon: "alert" };
}
