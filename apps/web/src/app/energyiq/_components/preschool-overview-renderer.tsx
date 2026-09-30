import React from "react";
import { reportTimeBasisFromContext } from "@datafoundry/contracts";

import type {
  EnergyProjectAnalysisSnapshotDto,
  EnergySavedAnalysisAiArtifactDto,
  EnergySavedAnalysisAiArtifactInputDto,
} from "../../../lib/config-api";
import { EnergyIcon } from "./icons";
import { AiFindingPresentationView } from "./ai-finding-presentation-view";
import { projectExplorerHrefForScope } from "./overview-explorer-handoff";
import { OverviewWindowLabel } from "./overview-report-time";
import { PreschoolEvidenceLink } from "./preschool-evidence-link";
import {
  isPreschoolOverviewAiReadModelRenderable,
  isPreschoolSavedAiArtifactIdentityMatch,
  PreschoolAiSlot,
} from "./preschool-ai-slot";
import type { PreschoolAiRunResult } from "./preschool-ai-run";
import { PreschoolForecastPanel } from "./preschool-forecast-panel";
import {
  PreschoolHtmlAiSlotPresentation,
  type PreschoolHtmlAiSlotRenderSet,
} from "./preschool-html-ai-slot-presentation";
import { buildPreschoolOverviewCoverage } from "./preschool-ai-coverage";
import {
  adaptPreschoolAiArtifactToSectionInterpretation,
  type PreschoolSectionInterpretationView,
} from "./preschool-section-interpretation-adapter";
import {
  buildPreschoolOverviewViewModel,
  type PreschoolDecisionSummaryItem,
  type PreschoolOverviewCentre,
  type PreschoolOverviewViewModel,
  type PreschoolOperationalCentre,
} from "./preschool-overview-view-model";

export type PreschoolOverviewRendererState =
  | {
    status: "loading" | "empty" | "unsupported" | "error";
    title: string;
    detail: string;
  }
  | {
    status: "ready";
    snapshot: EnergyProjectAnalysisSnapshotDto;
  };

export type PreschoolBenchmarkInterpretation = PreschoolSectionInterpretationView;

export type PreschoolStandbyInterpretation = PreschoolBenchmarkInterpretation;
export type PreschoolOperatingInterpretation = PreschoolBenchmarkInterpretation;

export function PreschoolOverviewRenderer({
  state,
  onRetry,
  projectExplorerHref,
  aiAnalystHref,
  showContextHeader = true,
  aiSlotMode = "live",
  savedAiArtifact,
  onAiArtifactChange,
  benchmarkInterpretation,
  standbyInterpretation,
  operatingInterpretation,
  aiPresentationMode = "structured",
  htmlAiSlots,
}: {
  state: PreschoolOverviewRendererState;
  onRetry?: () => void;
  projectExplorerHref?: string;
  aiAnalystHref?: string;
  showContextHeader?: boolean;
  aiSlotMode?: "live" | "saved";
  savedAiArtifact?: EnergySavedAnalysisAiArtifactDto;
  onAiArtifactChange?: (artifact: EnergySavedAnalysisAiArtifactInputDto | null) => void;
  benchmarkInterpretation?: PreschoolBenchmarkInterpretation;
  standbyInterpretation?: PreschoolStandbyInterpretation;
  operatingInterpretation?: PreschoolOperatingInterpretation;
  aiPresentationMode?: "structured" | "html";
  htmlAiSlots?: PreschoolHtmlAiSlotRenderSet;
}) {
  const [liveAiState, setLiveAiState] = React.useState<{
    snapshotIdentity: string;
    result: PreschoolAiRunResult;
  }>();
  const readySnapshotIdentity = state.status === "ready"
    ? [
        state.snapshot.dataSnapshot.id,
        state.snapshot.projectRelease.id,
        state.snapshot.context.primaryPeriod.start,
        state.snapshot.context.primaryPeriod.endExclusive,
      ].join("|")
    : state.status;
  const liveAiResult = liveAiState?.snapshotIdentity === readySnapshotIdentity
    ? liveAiState.result
    : undefined;
  const acceptLiveAiResult = React.useCallback((result: PreschoolAiRunResult) => {
    setLiveAiState({ snapshotIdentity: readySnapshotIdentity, result });
  }, [readySnapshotIdentity]);

  if (state.status !== "ready") {
    const meta = {
      loading: { label: "Loading", icon: "analysis" as const, tone: "text-muted", surface: "border-border bg-surface" },
      empty: { label: "No data", icon: "info" as const, tone: "text-muted", surface: "border-border bg-surface" },
      unsupported: { label: "Unsupported", icon: "info" as const, tone: "text-step-warning", surface: "border-step-warning/25 bg-step-warning/5" },
      error: { label: "Unavailable", icon: "alert" as const, tone: "text-step-error", surface: "border-step-error/25 bg-step-error/5" },
    }[state.status];
    return (
      <section
        className={`rounded-xl border px-5 py-8 ${meta.surface}`}
        role={state.status === "error" ? "alert" : "status"}
        aria-live={state.status === "loading" ? "polite" : undefined}
        data-renderer-state={state.status}
      >
        <div className="mx-auto flex max-w-xl items-start gap-3">
          <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background ${meta.tone}`}>
            <EnergyIcon name={meta.icon} className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className={`text-ui-label font-semibold uppercase tracking-[0.08em] ${meta.tone}`}>{meta.label}</p>
            <h2 className="mt-1 text-ui-body font-semibold text-foreground">{state.title}</h2>
            <p className="mt-1 text-ui-support leading-5 text-muted">{state.detail}</p>
            {state.status === "error" && onRetry ? (
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

  const view = buildPreschoolOverviewViewModel(state.snapshot);
  const savedAiResult = savedAiArtifact?.rendererKey === "preschool-overview"
    && isPreschoolSavedAiArtifactIdentityMatch(savedAiArtifact, state.snapshot)
    ? savedAiArtifact.result as unknown as Extract<import("./preschool-ai-run").PreschoolAiRunResult, { status: "available" }>
    : undefined;
  const coverage = buildPreschoolOverviewCoverage(state.snapshot);
  const sectionAiResult = aiSlotMode === "saved" ? savedAiResult : liveAiResult;
  const sectionedAiResult = isPreschoolOverviewAiReadModelRenderable(sectionAiResult, state.snapshot, aiSlotMode);
  const aiSlotSharedProps = aiSlotMode === "saved"
    ? (savedAiResult ? { savedResult: savedAiResult } : {})
    : { liveResult: liveAiResult, onResult: acceptLiveAiResult };
  const adaptedBenchmarkInterpretation = sectionedAiResult ? undefined : adaptPreschoolAiArtifactToSectionInterpretation({
    candidate: sectionAiResult,
    expected: coverage?.binding ?? null,
    target: "preschool.benchmark",
    mode: aiSlotMode,
  });
  const adaptedStandbyInterpretation = sectionedAiResult ? undefined : adaptPreschoolAiArtifactToSectionInterpretation({
    candidate: sectionAiResult,
    expected: coverage?.binding ?? null,
    target: "preschool.standby",
    mode: aiSlotMode,
  });
  const showLegacySectionInterpretations = aiPresentationMode !== "html";
  const statusClass = view.dataStatus.status === "complete"
    ? "border-step-success/30 bg-step-success-soft text-step-success"
    : view.dataStatus.status === "partial"
      ? "border-step-warning/30 bg-step-warning-soft text-step-warning"
      : "border-step-error/30 bg-step-error-soft text-step-error";
  const dataStatus = (
    <div className={`rounded-lg border px-4 py-3 ${statusClass}`} role="status">
      <p className="text-sm font-semibold">{view.dataStatus.label}</p>
      <p className="mt-1 text-xs text-muted">{view.dataStatus.coverage}</p>
      <details className="mt-1">
        <summary className="cursor-pointer text-xs font-medium text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">Data details</summary>
        <p className="mt-1 text-xs leading-5 text-muted">{view.dataStatus.intervals} · {view.dataStatus.qualityEvents}</p>
      </details>
    </div>
  );
  const demoBadge = (
    <span className="inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
      Demo data
    </span>
  );

  return (
    <section
      aria-label="Preschool published portfolio energy analysis"
      data-preschool-overview="true"
      data-data-status={view.dataStatus.status}
      className="overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-card)]"
    >
      {showContextHeader ? (
        <header className="grid gap-5 border-b border-border px-5 py-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start lg:px-7">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-foreground">{view.context.projectName}</p>
              {demoBadge}
            </div>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.025em] text-foreground">Energy Review</h2>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
              <span className="inline-flex items-center gap-1.5"><EnergyIcon name="calendar" className="h-3.5 w-3.5 text-muted-light" />{view.context.period}</span>
              <span>{view.context.timezone}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs" aria-label="Overview data domains">
              <span className="rounded-full border border-border bg-surface-subtle px-3 py-1.5 text-muted">
                <strong className="font-semibold text-foreground">Sections 1–4</strong> · {view.context.analysisWindowLabel}
              </span>
              <span className="rounded-full border border-border bg-surface-subtle px-3 py-1.5 text-muted">
                <strong className="font-semibold text-foreground">Section 5</strong> · {view.forecast.status === "unavailable"
                  ? "Monthly plan / actual / outlook"
                  : `${view.forecast.targetMonth} plan / actual / outlook`}
              </span>
            </div>
          </div>
          {dataStatus}
        </header>
      ) : (
        <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-5 py-3 text-sm ${statusClass}`} role="status">
          {demoBadge}
          <span className="font-semibold">{view.dataStatus.label}</span>
          <span className="text-xs text-muted">{view.dataStatus.coverage}</span>
          <details className="text-xs text-muted">
            <summary className="cursor-pointer font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">Data details</summary>
            <p className="mt-1 leading-5">{view.dataStatus.intervals} · {view.dataStatus.qualityEvents}</p>
          </details>
        </div>
      )}

      <section
        id="preschool-overall-summary"
        aria-labelledby="preschool-overall-summary-heading"
        data-overview-section="1"
        data-overview-navigation-label="Overview"
        tabIndex={-1}
        className="scroll-mt-28 border-b border-border px-5 py-7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 lg:px-7 lg:py-8"
      >
        <SectionHeader
          id="preschool-overall-summary-heading"
          title="Overall metrics"
          description={`Energy use and estimated cost across ${view.overallSummary.total.centreCount} Centres.`}
          meta={<OverviewWindowLabel context={state.snapshot.reportTimeContext} windowIds={["current-overview"]} />}
        />

        <div className="mt-4 grid overflow-hidden rounded-xl bg-[linear-gradient(125deg,var(--color-foreground),color-mix(in_srgb,var(--color-primary)_58%,var(--color-foreground)))] text-background sm:grid-cols-3">
          {view.overallSummary.metrics.map((metric) => (
            <div
              key={metric.id}
              data-overall-summary-metric={metric.id}
              className="min-w-0 border-white/15 px-5 py-5 first:border-0 sm:border-l lg:px-6"
            >
              <p className="text-sm font-semibold text-white/75">{metric.label}</p>
              <p className={`mt-2 text-2xl font-semibold tabular-nums tracking-[-0.02em] lg:text-3xl ${metric.available ? "text-white" : "text-white/60"}`}>
                {metric.value}
              </p>
            </div>
          ))}
        </div>

        {view.overallSummary.monthComparison ? (
          <div
            data-month-comparison="true"
            className="mt-4 rounded-xl border border-border bg-surface-subtle px-4 py-4 lg:px-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Month-on-month</p>
                <h4 className="mt-1 text-base font-semibold text-foreground">
                  {view.overallSummary.monthComparison.currentLabel} vs {view.overallSummary.monthComparison.referenceLabel}
                </h4>
              </div>
              <span className="rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-semibold text-foreground">
                {view.overallSummary.monthComparison.totalChangePct} total
              </span>
            </div>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <ComparisonFact
                label={view.overallSummary.monthComparison.currentLabel}
                value={view.overallSummary.monthComparison.currentEnergy}
              />
              <ComparisonFact
                label={view.overallSummary.monthComparison.referenceLabel}
                value={view.overallSummary.monthComparison.referenceEnergy}
              />
              <ComparisonFact label="Total change" value={view.overallSummary.monthComparison.totalChange} />
              <ComparisonFact label="Daily average" value={view.overallSummary.monthComparison.averageDailyChangePct} />
            </dl>
            <details className="mt-3 text-xs text-muted">
              <summary className="cursor-pointer font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
                Comparison evidence
              </summary>
              <p className="mt-1 leading-5">
                Snapshot {view.overallSummary.monthComparison.evidence.dataSnapshotId} · {view.overallSummary.monthComparison.evidence.queryId}
              </p>
            </details>
          </div>
        ) : null}

        <div className="mt-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="text-base font-semibold text-foreground">Energy &amp; cost by centre type</h4>
            <span className="text-sm text-muted">{view.overallSummary.periodLabel}</span>
          </div>
          <div className="mt-3 overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[680px] border-collapse text-left text-sm">
              <thead className="bg-surface-subtle text-xs font-semibold text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3">Centre type</th>
                  <th scope="col" className="px-4 py-3 text-right">Outlets</th>
                  <th scope="col" className="px-4 py-3 text-right">Energy</th>
                  <th scope="col" className="px-4 py-3 text-right">Estimated cost</th>
                  <th scope="col" className="px-4 py-3 text-right">Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {view.overallSummary.centreTypes.map((row) => (
                  <tr key={row.centreType}>
                    <th scope="row" className="px-4 py-3 font-semibold text-foreground">{row.centreType}</th>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground">{row.centreCount}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground">{row.energy}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground">{row.estimatedCost}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground">{row.share}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-border bg-surface-subtle font-semibold text-foreground">
                <tr>
                  <th scope="row" className="px-4 py-3">All centres</th>
                  <td className="px-4 py-3 text-right tabular-nums">{view.overallSummary.total.centreCount}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{view.overallSummary.total.energy}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{view.overallSummary.total.estimatedCost}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{view.overallSummary.total.share}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {view.overallSummary.costAssumption ? (
            <p className="mt-3 rounded-lg border border-step-warning/30 bg-step-warning-soft px-4 py-3 text-sm leading-6 text-foreground">
              <strong className="font-semibold">Cost estimate:</strong>{" "}
              {view.overallSummary.costAssumption.rate} using the{" "}
              {view.overallSummary.costAssumption.sourceUrl ? (
                <a
                  href={view.overallSummary.costAssumption.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold underline decoration-border underline-offset-2 hover:decoration-foreground"
                >
                  {view.overallSummary.costAssumption.label}
                </a>
              ) : (
                <strong className="font-semibold">
                  {view.overallSummary.costAssumption.label}
                </strong>
              )}
              . This is a planning estimate, not the customer bill.
            </p>
          ) : null}
        </div>

        <div
          id="preschool-decision-summary"
          data-overview-module="true"
          data-overview-navigation-label="At a glance"
          aria-labelledby="preschool-decision-summary-heading"
          tabIndex={-1}
          className="mt-8 scroll-mt-28 border-t border-border pt-7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
        >
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h4 id="preschool-decision-summary-heading" className="text-lg font-semibold tracking-[-0.015em] text-foreground">At a glance</h4>
                <span className="inline-flex items-center gap-1 rounded-full bg-step-success-soft px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-step-success">
                  <EnergyIcon name="check" className="h-3 w-3" />
                  Snapshot facts
                </span>
              </div>
              <p className="mt-1.5 text-sm leading-6 text-muted">A deterministic fallback and navigation list from Sections 2–5. These points are not AI-generated.</p>
            </div>
            <span className="text-xs font-semibold text-muted">Select a finding to open its section</span>
          </div>
          {view.decisionSummary.items.length > 0 ? (
            <div
              className="mt-4 grid gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-2"
              data-at-a-glance-grid="true"
              role="list"
            >
              {view.decisionSummary.items.map((item) => (
                <DecisionSummaryCard key={item.id} item={item} />
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-lg border border-border bg-surface-subtle p-4" role="status">
              <p className="text-sm font-semibold text-muted">Verified highlights unavailable</p>
              <p className="mt-2 text-sm leading-6 text-muted">{view.decisionSummary.detail}</p>
            </div>
          )}
          {view.decisionSummary.items.length > 0 ? (
            <p className="mt-3 text-xs leading-5 text-muted">
              Snapshot facts for Sections 2–5. Key Findings appear below, while Section interpretations stay beside their supporting analysis.
            </p>
          ) : null}
        </div>

        <div
          id="preschool-ai-analysis"
          data-overview-section="true"
          data-overview-navigation-label="AI interpretation"
          tabIndex={-1}
          className="mt-8 scroll-mt-28 border-t border-border pt-7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
        >
          <PreschoolHtmlAiSlotPresentation mode={aiPresentationMode} slotId="executive-summary" htmlSlot={htmlAiSlots?.["executive-summary"]}>
            <PreschoolAiSlot
              snapshot={state.snapshot}
              sectionId="page-synthesis"
              mode={aiSlotMode}
              {...aiSlotSharedProps}
              {...(onAiArtifactChange ? {
                onCompletedResult: (result: Extract<import("./preschool-ai-run").PreschoolAiRunResult, { status: "available" }>) =>
                  onAiArtifactChange(toSavedPreschoolAiArtifact(state.snapshot, result)),
              } : {})}
              {...(aiAnalystHref ? { aiAnalystHref } : {})}
            />
          </PreschoolHtmlAiSlotPresentation>
        </div>

      </section>

      <section id="preschool-benchmark-analysis" aria-labelledby="preschool-benchmark-analysis-heading" data-overview-section="2" data-overview-navigation-label="Benchmarks" tabIndex={-1} className="scroll-mt-28 border-b border-border px-5 py-7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 lg:px-7 lg:py-8">
        <SectionHeader
          id="preschool-benchmark-analysis-heading"
          title="Benchmark Analysis"
          description="Compare Centres after normalising for floor area and people served, then identify who should be reviewed first."
          meta={<OverviewWindowLabel context={state.snapshot.reportTimeContext} windowIds={["current-overview"]} />}
        />
        {showLegacySectionInterpretations && (!sectionedAiResult || benchmarkInterpretation) ? (
          <BenchmarkInterpretationSlot
            snapshot={state.snapshot}
            interpretation={benchmarkInterpretation ?? adaptedBenchmarkInterpretation}
          />
        ) : null}
        <PreschoolHtmlAiSlotPresentation mode={aiPresentationMode} slotId="centre-benchmark" htmlSlot={htmlAiSlots?.["centre-benchmark"]}>
          <PreschoolAiSlot
            snapshot={state.snapshot}
            sectionId="centre-benchmark"
            mode={aiSlotMode}
            {...aiSlotSharedProps}
            {...(aiAnalystHref ? { aiAnalystHref } : {})}
          />
        </PreschoolHtmlAiSlotPresentation>
        {view.benchmark.status === "provisional" ? (
          <>
            <div
              id="preschool-centre-efficiency-metrics"
              data-overview-module="true"
              data-overview-navigation-label="Centre efficiency metrics"
              aria-labelledby="preschool-centre-efficiency-metrics-heading"
              tabIndex={-1}
              className="mt-7 scroll-mt-28 border-t border-border pt-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
            >
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 id="preschool-centre-efficiency-metrics-heading" className="text-base font-semibold text-foreground">Centre Efficiency Metrics</h4>
                    <span className="rounded-full border border-step-warning/30 bg-step-warning-soft px-2.5 py-1 text-xs font-semibold text-step-warning">Provisional</span>
                  </div>
                  <p className="mt-1.5 text-sm leading-6 text-muted">Which Centres are high for both floor-area intensity and energy used per person?</p>
                </div>
                <p className="text-xs font-semibold text-muted">All-centre cohort · n={view.benchmark.sampleSize}</p>
              </div>
              <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                <div className="min-w-0">
                  <BenchmarkScatterPlot benchmark={view.benchmark} />
                  <div className="mt-3 grid overflow-hidden rounded-lg border border-border sm:grid-cols-2 xl:grid-cols-4">
                    {view.benchmark.quadrants.map((quadrant) => (
                      <div key={quadrant.id} className={`min-h-24 border-border p-3 sm:[&:nth-child(odd)]:border-r sm:[&:nth-child(-n+2)]:border-b xl:border-b-0 xl:[&:not(:last-child)]:border-r ${quadrant.id === "priority" ? "bg-step-error-soft" : "bg-surface-subtle"}`}>
                        <div className="flex items-center justify-between gap-3">
                          <p className={`text-[11px] font-semibold ${quadrant.id === "priority" ? "text-step-error" : "text-foreground"}`}>{quadrant.label}</p>
                          <span className="text-[10px] tabular-nums text-muted">{quadrant.centreCodes.length}</span>
                        </div>
                        <p className="mt-2 text-xs font-semibold tracking-wide text-foreground">{quadrant.centreCodes.join(" · ") || "None"}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <aside className="rounded-lg border border-border bg-surface-subtle p-4" aria-label="Benchmark action priority">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-step-error">Review first · action priority</p>
                  <ol className="mt-3 divide-y divide-border">
                    {view.benchmark.priorityCentres.map((centre) => (
                      <li key={centre.centreCode} data-benchmark-priority-centre={centre.centreCode} className="py-3 first:pt-0 last:pb-0">
                        <div className="flex items-start gap-3">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-step-error text-xs font-semibold text-white">{centre.rank}</span>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-foreground">{centre.name}</p>
                            <p className="mt-0.5 text-xs text-muted">{centre.cohort}</p>
                            <p className="mt-1 text-xs tabular-nums text-step-error">{centre.eui} · {centre.perPax}</p>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                  <dl className="mt-4 space-y-2 border-t border-border pt-4 text-xs">
                    <ReadinessRow label="All-centre EUI P50 / P75" value={`${view.benchmark.eui.p50} / ${view.benchmark.eui.p75}`} />
                    <ReadinessRow label="All-centre per-pax P50 / P75" value={`${view.benchmark.perPax.p50} / ${view.benchmark.perPax.p75}`} />
                  </dl>
                  <details className="mt-4 border-t border-border pt-3">
                    <summary className="cursor-pointer text-xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">Benchmark method</summary>
                    <p className="mt-2 text-xs leading-5 text-muted">{view.benchmark.detail}</p>
                  </details>
                </aside>
              </div>
            </div>

            {view.benchmark.distributions.map((distribution) => (
              <BenchmarkMetricSection
                key={distribution.id}
                distribution={distribution}
              />
            ))}
          </>
        ) : (
          <div role="status">
            <h4 className="mt-5 text-base font-semibold text-foreground">Benchmark unavailable</h4>
            <p className="mt-1.5 text-sm leading-6 text-muted">This Snapshot does not yet support a reliable peer comparison.</p>
            <p className="mt-3 text-sm leading-6 text-muted">{view.benchmark.detail}</p>
          </div>
        )}
      </section>

      <section id="preschool-standby-wastage" aria-labelledby="preschool-standby-wastage-heading" data-overview-section="3" data-overview-navigation-label="Standby wastage" tabIndex={-1} className="scroll-mt-28 border-b border-border px-5 py-7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 lg:px-7 lg:py-8">
        <SectionHeader
          id="preschool-standby-wastage-heading"
          title="Standby Energy Wastage — Post Operating Hours"
          description="How much energy remains after closing, what stays powered, and which Centres and hours need an after-hours review?"
          meta={<OverviewWindowLabel context={state.snapshot.reportTimeContext} windowIds={["current-overview", "day-type-reference"]} />}
        />
        {showLegacySectionInterpretations && (!sectionedAiResult || standbyInterpretation) ? (
          <StandbyInterpretationSlot
            snapshot={state.snapshot}
            interpretation={standbyInterpretation ?? adaptedStandbyInterpretation}
          />
        ) : null}
        <PreschoolHtmlAiSlotPresentation mode={aiPresentationMode} slotId="standby-wastage" htmlSlot={htmlAiSlots?.["standby-wastage"]}>
          <PreschoolAiSlot
            snapshot={state.snapshot}
            sectionId="standby-wastage"
            mode={aiSlotMode}
            {...aiSlotSharedProps}
            {...(aiAnalystHref ? { aiAnalystHref } : {})}
          />
        </PreschoolHtmlAiSlotPresentation>
        {view.operational.status === "available" ? (
          <>
            <StandbyKpiStrip standby={view.operational.standby} />

            <section id="preschool-standby-appliances" data-overview-module="true" data-overview-navigation-label="Standby energy by appliance" tabIndex={-1} className="mt-8 scroll-mt-28 border-t border-border pt-7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20" aria-labelledby="preschool-standby-appliances-heading">
              <h4 id="preschool-standby-appliances-heading" className="text-base font-semibold text-foreground">Standby Energy by Appliance</h4>
              <p className="mt-1.5 max-w-3xl text-sm leading-6 text-muted">Which published Appliance aliases continue to consume energy while the Calendar marks Centres as closed?</p>
              <StandbyApplianceComposition standby={view.operational.standby} />
            </section>

            <section id="preschool-standby-spikes" data-overview-module="true" data-overview-navigation-label="Non-operating hours spikes" tabIndex={-1} className="mt-8 scroll-mt-28 border-t border-border pt-7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20" aria-labelledby="preschool-standby-spikes-heading">
              <h4 id="preschool-standby-spikes-heading" className="text-base font-semibold text-foreground">Non-operating Hours Spike Analysis</h4>
              <p className="mt-1.5 max-w-3xl text-sm leading-6 text-muted">Start with the Centres that have repeated closed-hour exceptions. Expand a row to inspect every event for that Centre.</p>
              <StandbySpikeTable centres={view.operational.standby.centres} />
            </section>

            <section id="preschool-after-hours-review" data-overview-module="true" data-overview-navigation-label={view.operational.sop.label} tabIndex={-1} className="mt-8 scroll-mt-28 border-t border-border pt-7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20" aria-labelledby="preschool-after-hours-review-heading">
              <h4 id="preschool-after-hours-review-heading" className="text-base font-semibold text-foreground">{view.operational.sop.label}</h4>
              <p className="mt-1.5 max-w-3xl text-sm leading-6 text-muted">Use this provisional score to order an investigation, not to certify SOP compliance.</p>
              <AfterHoursReviewPriority sop={view.operational.sop} />
            </section>

            <details className="mt-7 rounded-lg border border-border bg-surface-subtle/40 px-4 py-3">
              <summary className="cursor-pointer text-xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">Method, tariff and evidence</summary>
              <dl className="mt-3 grid gap-2 text-xs leading-5 sm:grid-cols-2">
                <ReadinessRow label="Calendar" value={view.operational.calendarVersion} />
                <ReadinessRow label="Coverage" value={view.operational.coverage} />
                <ReadinessRow label="Spike rule" value={view.operational.threshold} />
                <ReadinessRow label="Tariff" value={view.operational.standby.provisionalCostNote} />
                <ReadinessRow label="Reconciliation" value={view.operational.standby.reconciliation} />
              </dl>
              <p className="mt-3 text-xs leading-5 text-muted">Leading contributors identify the largest observed Circuit within an event; they are not confirmed root causes. Spike excess is investigation evidence, not guaranteed savings.</p>
              <div className="mt-3"><PreschoolEvidenceLink label="View supporting evidence" /></div>
            </details>
          </>
        ) : (
          <div className="mt-5 rounded-lg border border-border bg-surface-subtle p-4" role="status">
            <p className="text-xs font-semibold text-muted">Standby analysis unavailable</p>
            <p className="mt-2 text-[11px] leading-5 text-muted">{view.operational.detail}</p>
          </div>
        )}
      </section>

      <section id="preschool-operating-hours" aria-labelledby="preschool-operating-hours-heading" data-overview-section="4" data-overview-navigation-label="Operating hours" tabIndex={-1} className="scroll-mt-28 border-b border-border px-5 py-7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 lg:px-7 lg:py-8">
        <SectionHeader
          id="preschool-operating-hours-heading"
          title="Operating Hours Analysis"
          description="How much energy is used while Centres are open, which Appliances account for it, and which Centres and hours need an operating review?"
          meta={<OverviewWindowLabel context={state.snapshot.reportTimeContext} windowIds={["current-overview"]} />}
        />
        {showLegacySectionInterpretations && (!sectionedAiResult || operatingInterpretation) ? (
          <OperatingInterpretationSlot
            snapshot={state.snapshot}
            interpretation={operatingInterpretation}
          />
        ) : null}
        <PreschoolHtmlAiSlotPresentation mode={aiPresentationMode} slotId="operating-behaviour" htmlSlot={htmlAiSlots?.["operating-behaviour"]}>
          <PreschoolAiSlot
            snapshot={state.snapshot}
            sectionId="operating-behaviour"
            mode={aiSlotMode}
            {...aiSlotSharedProps}
            {...(aiAnalystHref ? { aiAnalystHref } : {})}
          />
        </PreschoolHtmlAiSlotPresentation>
        {view.operational.status === "available" ? (
          <>
            <OperatingKpiStrip operating={view.operational.operating} />

            <section id="preschool-operating-appliances" data-overview-module="true" data-overview-navigation-label="Operating energy by appliance" tabIndex={-1} className="mt-8 scroll-mt-28 border-t border-border pt-7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20" aria-labelledby="preschool-operating-appliances-heading">
              <h4 id="preschool-operating-appliances-heading" className="text-base font-semibold text-foreground">Operating Energy by Appliance</h4>
              <p className="mt-1.5 max-w-3xl text-sm leading-6 text-muted">Which observed published Appliance aliases account for energy while the Calendar marks Centres as open?</p>
              <OperatingApplianceComposition operating={view.operational.operating} />
            </section>

            <section id="preschool-operating-spikes" data-overview-module="true" data-overview-navigation-label="Operating hours spikes" tabIndex={-1} className="mt-8 scroll-mt-28 border-t border-border pt-7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20" aria-labelledby="preschool-operating-spikes-heading">
              <h4 id="preschool-operating-spikes-heading" className="text-base font-semibold text-foreground">Operating Hours Spike Analysis</h4>
              <p className="mt-1.5 max-w-3xl text-sm leading-6 text-muted">Contact Centres with repeated opening-hour exceptions first. Expand a row to inspect every event recorded for that Centre.</p>
              <OperatingSpikeTable centres={view.operational.operating.centres} />
            </section>

            <AllHoursApplianceContext appliances={view.appliances} />

            <details className="mt-7 rounded-lg border border-border bg-surface-subtle/40 px-4 py-3">
              <summary className="cursor-pointer text-xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">Method, tariff and evidence</summary>
              <dl className="mt-3 grid gap-2 text-xs leading-5 sm:grid-cols-2">
                <ReadinessRow label="Calendar" value={view.operational.calendarVersion} />
                <ReadinessRow label="Coverage" value={view.operational.coverage} />
                <ReadinessRow label="Spike rule" value={view.operational.threshold} />
                <ReadinessRow label="Tariff" value={view.operational.operating.provisionalCostNote} />
                <ReadinessRow label="Reconciliation" value={view.operational.operating.reconciliation} />
              </dl>
              <p className="mt-3 text-xs leading-5 text-muted">The composition and Spike events come from the same Snapshot-scoped Centre-hour × Circuit query. Observed leading contributors are not confirmed root causes, and no saving estimate is presented.</p>
              <div className="mt-3"><PreschoolEvidenceLink label="View supporting evidence" /></div>
            </details>

          </>
        ) : (
          <div className="mt-5 rounded-lg border border-border bg-surface-subtle p-4" role="status">
            <p className="text-xs font-semibold text-muted">Operating-hours analysis unavailable</p>
            <p className="mt-2 text-[11px] leading-5 text-muted">{view.operational.detail}</p>
          </div>
        )}
      </section>

      <section id="preschool-monthly-outlook" aria-labelledby="preschool-monthly-outlook-heading" data-overview-section="5" data-overview-navigation-label="Monthly outlook" tabIndex={-1} className="scroll-mt-28 border-b border-border bg-surface-subtle/35 px-5 py-7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 lg:px-7 lg:py-8">
        <SectionHeader
          id="preschool-monthly-outlook-heading"
          title="Monthly Energy Outlook"
          description={view.forecast.status === "unavailable"
            ? "A transparent next-month energy view with Plan and Actual kept as separate, Snapshot-bound facts."
            : `${view.forecast.targetMonth} · ${view.forecast.targetPeriod} · Plan and Actual remain separately pinned.`}
          meta={<OverviewWindowLabel context={state.snapshot.reportTimeContext} windowIds={["current-month-progress", "next-month-outlook"]} />}
        />
        <PreschoolForecastPanel forecast={view.forecast} />
        <PlanningForecastEvidence planning={view.planningOutlook} forecast={view.forecast} />
        <PreschoolHtmlAiSlotPresentation mode={aiPresentationMode} slotId="planning-outlook" htmlSlot={htmlAiSlots?.["planning-outlook"]}>
          <PreschoolAiSlot
            snapshot={state.snapshot}
            sectionId="planning-outlook"
            mode={aiSlotMode}
            {...aiSlotSharedProps}
            {...(aiAnalystHref ? { aiAnalystHref } : {})}
          />
        </PreschoolHtmlAiSlotPresentation>
      </section>

      <PreschoolHtmlAiSlotPresentation mode={aiPresentationMode} slotId="additional-insight" htmlSlot={htmlAiSlots?.["additional-insight"]}>
        <PreschoolAiSlot
          snapshot={state.snapshot}
          sectionId="overall-summary"
          mode={aiSlotMode}
          {...aiSlotSharedProps}
          {...(aiAnalystHref ? { aiAnalystHref } : {})}
        />
      </PreschoolHtmlAiSlotPresentation>

      <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_320px]">
        <aside id="preschool-centre-ranking" aria-labelledby="preschool-centre-ranking-heading" data-overview-section="true" data-overview-navigation-label="Centre detail" tabIndex={-1} className="min-w-0 scroll-mt-28 px-5 py-7 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 lg:px-7 lg:py-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 id="preschool-centre-ranking-heading" className="text-lg font-semibold tracking-[-0.015em] text-foreground">Centre detail</h3>
              <p className="mt-1.5 text-sm leading-6 text-muted">Start with the five largest contributors; open the remaining Centres only when you need them.</p>
            </div>
            <span className="text-xs text-muted">Top 5 of {view.centres.length} Centres</span>
          </div>
          <div className="mt-4 grid gap-3" role="list" aria-label="Top five Centres by all-centre energy contribution">
            {view.centres.slice(0, 5).map((centre) => (
              <CentreContributionRow
                key={centre.id}
                centre={centre}
                maximumUsageKwh={view.centres[0]?.usageKwhValue ?? 1}
                projectExplorerHref={projectExplorerHref}
              />
            ))}
          </div>
          <details className="mt-5 rounded-lg border border-border bg-surface-subtle/40">
            <summary className="cursor-pointer px-4 py-3 text-xs font-semibold text-foreground">View all {view.centres.length} Centres and normalised metrics</summary>
            <div className="overflow-x-auto border-t border-border">
              <table className="min-w-[1020px] w-full border-collapse text-left text-xs">
              <thead className="bg-surface-subtle text-[10px] uppercase tracking-[0.07em] text-muted-light">
                <tr>
                  <th className="px-3 py-2.5 font-semibold">Rank</th>
                  <th className="px-3 py-2.5 font-semibold">Centre</th>
                  <th className="px-3 py-2.5 font-semibold">Cohort</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Energy</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Share</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Annualised EUI</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Energy per person</th>
                  <th className="px-3 py-2.5 font-semibold">Quadrant</th>
                  <th className="px-3 py-2.5 font-semibold">Leading appliance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {view.centres.map((centre) => <CentreRow key={centre.id} centre={centre} />)}
              </tbody>
              </table>
            </div>
          </details>
        </aside>

        <aside className="border-t border-border bg-surface-subtle px-5 py-5 xl:border-l xl:border-t-0 lg:px-7 lg:py-6">
          <h3 className="text-base font-semibold text-foreground">Data confidence</h3>
          <p className="mt-1.5 text-sm leading-6 text-muted">The decisions use the same published Snapshot. Technical IDs stay available when you need to audit them.</p>
          <details id="preschool-evidence" data-overview-section="true" data-overview-navigation-label="Supporting evidence" tabIndex={-1} className="mt-5 scroll-mt-28 border-t border-border pt-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
            <summary className="cursor-pointer text-sm font-semibold text-foreground">View normalisation and evidence</summary>
            <dl className="mt-4 space-y-3 text-xs">
              <ReadinessRow label="EUI coverage" value={`${view.normalisation.euiAvailableCount} / ${view.normalisation.totalCentreCount} Centres`} />
              <ReadinessRow label="Per-pax coverage" value={`${view.normalisation.perPaxAvailableCount} / ${view.normalisation.totalCentreCount} Centres`} />
              <ReadinessRow label="Metadata" value={titleCase(view.normalisation.status)} />
              <ReadinessRow label="Period" value={view.context.period} />
              <ReadinessRow label="Snapshot" value={view.evidence.snapshotId} mono />
              <ReadinessRow label="Release" value={view.evidence.projectReleaseId} mono />
              <ReadinessRow label="References" value={String(view.evidence.referenceCount)} />
              <ReadinessRow label="Import batches" value={String(view.evidence.importBatchCount)} />
              <ReadinessRow label="Queries" value={view.evidence.queryIds.join(", ") || "Unavailable"} mono />
              <ReadinessRow label="Benchmark" value={view.evidence.benchmarkRecipeIds.join(", ") || "Unavailable"} mono />
              <ReadinessRow label="Appliances" value={view.evidence.applianceRecipeIds.join(", ") || "Unavailable"} mono />
              <ReadinessRow label="Appliance source" value="Published Circuit aliases" />
              <ReadinessRow label="Operations" value={view.evidence.operationalRecipeIds.join(", ") || "Unavailable"} mono />
              <ReadinessRow label="Planning" value={view.evidence.planningRecipeIds.join(", ") || "Unavailable"} mono />
            </dl>
          </details>
        </aside>
      </div>
    </section>
  );
}

const toSavedPreschoolAiArtifact = (
  snapshot: EnergyProjectAnalysisSnapshotDto,
  result: Extract<PreschoolAiRunResult, { status: "available" }>,
): EnergySavedAnalysisAiArtifactInputDto => {
  if (isPreschoolOverviewAiReadModelRenderable(result, snapshot, "live")) {
    return {
      contract: "energyiq-saved-ai-result@2",
      rendererKey: "preschool-overview",
      snapshotId: snapshot.dataSnapshot.id,
      projectReleaseId: snapshot.projectRelease.id,
      ...(snapshot.reportTimeContext
        ? { reportTimeBasis: reportTimeBasisFromContext(snapshot.reportTimeContext) }
        : {}),
      result,
    };
  }
  return {
    contract: "energyiq-saved-ai-result@1",
    rendererKey: "preschool-overview",
    snapshotId: snapshot.dataSnapshot.id,
    projectReleaseId: snapshot.projectRelease.id,
    ...(snapshot.reportTimeContext
      ? { reportTimeBasis: reportTimeBasisFromContext(snapshot.reportTimeContext) }
      : {}),
    result,
  };
};

function SectionHeader({
  id,
  title,
  description,
  meta,
}: {
  id: string;
  title: string;
  description: string;
  meta?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 max-w-4xl">
        <h3 id={id} className="text-xl font-semibold tracking-[-0.02em] text-foreground">{title}</h3>
        <p className="mt-2 max-w-[72ch] text-sm leading-6 text-muted">{description}</p>
      </div>
      {meta ? <div className="shrink-0 tabular-nums">{meta}</div> : null}
    </div>
  );
}

function ComparisonFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-3">
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="mt-1 text-sm font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

function DecisionSummaryCard({ item }: { item: PreschoolDecisionSummaryItem }) {
  const badgeClass = item.sectionNumber === 2
    ? "bg-foreground text-background"
    : item.sectionNumber === 3
      ? "bg-step-warning text-white"
      : item.sectionNumber === 4
        ? "bg-step-inspect text-white"
        : "bg-step-success text-white";
  return (
    <article className="min-w-0 bg-surface transition-colors hover:bg-surface-subtle/60" data-decision-priority={item.id} role="listitem">
      <a
        href={`#${item.targetId}`}
        className="grid min-h-20 gap-3 px-4 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30 sm:grid-cols-[44px_minmax(0,1fr)_auto] sm:items-center lg:px-5"
        data-key-finding-target={item.targetId}
      >
        <span className={`inline-flex h-8 w-10 items-center justify-center rounded-md text-xs font-semibold ${badgeClass}`}>
          §{item.sectionNumber}
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-foreground">{item.label}</span>
          <span className="mt-1 block text-sm leading-6 text-muted">
            <strong className="font-semibold tabular-nums text-foreground">{item.primaryMetric.valueLabel}</strong>
            {` · ${item.primaryMetric.label}`}
            {item.centreCodes.length > 0 ? (
              <> · Centres <strong className="font-semibold text-foreground">{compactCentreCodes(item.centreCodes)}</strong></>
            ) : null}
          </span>
          {item.supportingMetrics.length > 0 ? (
            <span className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
              {item.supportingMetrics.slice(0, 2).map((metric) => (
                <span key={metric.label}>{metric.label}: <strong className="font-semibold tabular-nums text-foreground">{metric.valueLabel}</strong></span>
              ))}
            </span>
          ) : null}
        </span>
        <span className="inline-flex min-h-10 items-center gap-2 justify-self-start rounded-md px-2 text-xs font-semibold text-primary sm:justify-self-end">
          View section
          <EnergyIcon name="arrow" className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      </a>
      <details className="mx-4 border-t border-border/70 pb-3 pt-2 sm:ml-[71px] lg:mx-5 lg:ml-[79px]">
        <summary className="cursor-pointer text-xs font-semibold text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
          Limitation and evidence
        </summary>
        <p className="mt-2 text-xs leading-5 text-muted">{item.limitation}</p>
        <PreschoolEvidenceLink label="View supporting evidence" />
      </details>
    </article>
  );
}

type BenchmarkView = Extract<PreschoolOverviewViewModel["benchmark"], { status: "provisional" }>;

function BenchmarkInterpretationSlot({
  snapshot,
  interpretation,
}: {
  snapshot: EnergyProjectAnalysisSnapshotDto;
  interpretation: PreschoolBenchmarkInterpretation | undefined;
}) {
  return (
    <SnapshotInterpretationSlot
      snapshot={snapshot}
      interpretation={interpretation}
      slot="benchmark"
      title="Key recommendation / AI interpretation"
    />
  );
}

function StandbyInterpretationSlot({
  snapshot,
  interpretation,
}: {
  snapshot: EnergyProjectAnalysisSnapshotDto;
  interpretation: PreschoolStandbyInterpretation | undefined;
}) {
  return (
    <SnapshotInterpretationSlot
      snapshot={snapshot}
      interpretation={interpretation}
      slot="standby"
      title="Next step / AI interpretation"
    />
  );
}

function OperatingInterpretationSlot({
  snapshot,
  interpretation,
}: {
  snapshot: EnergyProjectAnalysisSnapshotDto;
  interpretation: PreschoolOperatingInterpretation | undefined;
}) {
  return (
    <SnapshotInterpretationSlot
      snapshot={snapshot}
      interpretation={interpretation}
      slot="operating"
      title="Key focus / AI interpretation"
    />
  );
}

function SnapshotInterpretationSlot({
  snapshot,
  interpretation,
  slot,
  title,
}: {
  snapshot: EnergyProjectAnalysisSnapshotDto;
  interpretation: PreschoolBenchmarkInterpretation | PreschoolStandbyInterpretation | PreschoolOperatingInterpretation | undefined;
  slot: "benchmark" | "standby" | "operating";
  title: string;
}) {
  const matchesSnapshot = interpretation?.status === "available" || interpretation?.status === "pending"
    ? interpretation.dataSnapshotId === snapshot.dataSnapshot.id
      && interpretation.projectReleaseId === snapshot.projectRelease.id
      && interpretation.period.start === snapshot.context.primaryPeriod.start
      && interpretation.period.endExclusive === snapshot.context.primaryPeriod.endExclusive
    : false;
  const status = interpretation?.status === "available" && matchesSnapshot
    ? "available"
    : interpretation?.status === "pending" && matchesSnapshot
      ? "pending"
      : "unavailable";
  const statusData = { [`data-${slot}-interpretation-status`]: status };
  const contentData = { [`data-${slot}-interpretation-content`]: "true" };

  return (
    <aside
      {...statusData}
      className="mt-5 rounded-lg border border-primary/20 bg-primary-soft/35 p-4"
      aria-live={status === "pending" ? "polite" : undefined}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface text-primary">
          <EnergyIcon name="spark" className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-foreground">{title}</h4>
            <span className="flex flex-wrap items-center justify-end gap-2">
              {status === "available" && interpretation?.status === "available" && interpretation.epistemicLevel ? (
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${sectionInterpretationLevelClass(interpretation.epistemicLevel)}`}>
                  {sectionInterpretationLevelLabel(interpretation.epistemicLevel)}
                </span>
              ) : null}
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-light">Snapshot-bound</span>
            </span>
          </div>
          {status === "available" && interpretation?.status === "available" ? (
            <div className="mt-3 space-y-4" {...contentData}>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-primary">Key takeaway</p>
                <p className="mt-1 text-base font-semibold leading-6 text-foreground">{interpretation.headline}</p>
                <p className="mt-1.5 text-sm leading-6 text-muted">{interpretation.takeaway}</p>
                {interpretation.whyItMatters ? (
                  <p className="mt-2 text-sm leading-6 text-muted"><strong className="font-semibold text-foreground">Why it matters:</strong> {interpretation.whyItMatters}</p>
                ) : null}
              </div>

              <AiFindingPresentationView presentation={interpretation.presentation} />

              {interpretation.possibleExplanation ? (
                <div className="rounded-lg border border-step-warning/20 bg-step-warning-soft/45 px-3 py-2.5 text-sm leading-6 text-muted">
                  <strong className="font-semibold text-foreground">What may explain it:</strong> {interpretation.possibleExplanation}
                </div>
              ) : null}

              <div className="rounded-lg bg-foreground px-4 py-3 text-background">
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-background/65">Recommended next step</p>
                <p className="mt-1 text-sm font-semibold leading-6">{interpretation.action}</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-step-success/20 bg-step-success-soft/45 px-3 py-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-step-success">If acted on</p>
                  <p className="mt-1 text-sm leading-6 text-muted">{interpretation.expectedIfAct}</p>
                </div>
                <div className="rounded-lg border border-step-warning/20 bg-step-warning-soft/45 px-3 py-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-step-warning">If ignored</p>
                  <p className="mt-1 text-sm leading-6 text-muted">{interpretation.ifIgnored}</p>
                </div>
              </div>

              <details className="rounded-lg border border-border bg-surface px-3 py-2.5">
                <summary className="cursor-pointer text-sm font-semibold text-foreground">Verification and limitations</summary>
                <div className="mt-2 space-y-2 text-sm leading-6 text-muted">
                  {interpretation.verification ? <p><strong className="font-semibold text-foreground">How to verify:</strong> {interpretation.verification}</p> : null}
                  <p><strong className="font-semibold text-foreground">What this cannot prove:</strong> {interpretation.limitation}</p>
                </div>
              </details>
            </div>
          ) : status === "pending" ? (
            <p className="mt-2 text-sm leading-6 text-muted">AI interpretation pending for this Snapshot.</p>
          ) : (
            <p className="mt-2 text-sm leading-6 text-muted">
              {interpretation?.status === "unavailable" && interpretation.detail
                ? interpretation.detail
                : "No matching AI interpretation is available for this Snapshot."}
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}

function sectionInterpretationLevelLabel(level: NonNullable<Extract<PreschoolBenchmarkInterpretation, { status: "available" }>["epistemicLevel"]>): string {
  if (level === "verified") return "Verified";
  if (level === "hypothesis") return "Hypothesis";
  return "Explore";
}

function sectionInterpretationLevelClass(level: NonNullable<Extract<PreschoolBenchmarkInterpretation, { status: "available" }>["epistemicLevel"]>): string {
  if (level === "verified") return "bg-step-success-soft text-step-success";
  if (level === "hypothesis") return "bg-step-warning-soft text-step-warning";
  return "bg-primary/10 text-primary";
}

type BenchmarkDistributionView = BenchmarkView["distributions"][number];

function BenchmarkMetricSection({
  distribution,
}: {
  distribution: BenchmarkDistributionView;
}) {
  const metricTitle = distribution.id === "eui" ? "EUI Benchmark" : "Per-pax Energy Benchmark";
  const rowGridClass = "grid min-w-[760px] grid-cols-[minmax(180px,1.15fr)_56px_78px_78px_minmax(240px,1.8fr)_40px] items-center gap-3";
  return (
    <section
      id={`preschool-${distribution.id}-benchmark`}
      data-overview-module="true"
      data-overview-navigation-label={metricTitle}
      tabIndex={-1}
      className="mt-7 scroll-mt-28 border-t border-border pt-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
      aria-labelledby={`preschool-${distribution.id}-benchmark-heading`}
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h4 id={`preschool-${distribution.id}-benchmark-heading`} className="text-base font-semibold text-foreground">{metricTitle}</h4>
          <p className="mt-1.5 text-sm leading-6 text-muted">{distribution.question}</p>
        </div>
        <span className="text-xs text-muted">P50 = midpoint · P75 = review threshold</span>
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-border" data-benchmark-summary={distribution.id}>
        <div className={`${rowGridClass} bg-surface-subtle px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-light`} aria-hidden="true">
          <span>Centre type</span>
          <span data-benchmark-summary-header="outlets">Outlets</span>
          <span data-benchmark-summary-header="p50">P50</span>
          <span data-benchmark-summary-header="p75">P75</span>
          <span>Outlets above P75</span>
          <span className="text-right">Detail</span>
        </div>
        <div className="min-w-[760px] divide-y divide-border bg-surface">
          {distribution.cohorts.map((cohort, cohortIndex) => {
            const aboveP75 = cohort.points.filter((point) => point.aboveP75);
            const visual = benchmarkCohortVisual(cohort.name);
            return (
              <details
                key={cohort.name}
                data-benchmark-detail={`${distribution.id}:${cohort.name}`}
                className="group"
              >
                <summary
                  data-benchmark-summary-cohort={`${distribution.id}:${cohort.name}`}
                  tabIndex={0}
                  aria-label={`${cohort.name}: ${cohort.sampleSize} Outlets, P50 ${cohort.p50}, P75 ${cohort.p75}, ${aboveP75.length} above P75. View detail.`}
                  className={`${rowGridClass} cursor-pointer list-none px-4 py-3 text-xs transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30 [&::-webkit-details-marker]:hidden`}
                >
                  <span className="flex min-w-0 items-center gap-2.5 font-semibold text-foreground">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] text-white">{cohortIndex + 1}</span>
                    <svg viewBox="0 0 16 16" aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 ${visual.className}`}>
                      <BenchmarkMarker shape={visual.shape} cx={8} cy={8} radius={4} />
                    </svg>
                    <span className="truncate">{cohort.name}</span>
                  </span>
                  <span data-benchmark-summary-value="outlets" className="tabular-nums text-muted">{cohort.sampleSize}</span>
                  <span data-benchmark-summary-value="p50" className="tabular-nums font-semibold text-primary">{cohort.p50}</span>
                  <span data-benchmark-summary-value="p75" className="tabular-nums font-semibold text-step-warning">{cohort.p75}</span>
                  <span>
                    {aboveP75.length > 0 ? (
                      <span className="flex flex-wrap gap-1.5">
                        {aboveP75.map((point) => (
                          <span key={point.centreCode} data-benchmark-above-p75={`${distribution.id}:${point.centreCode}`} className="inline-flex items-center gap-1 rounded-full border border-step-error/25 bg-step-error-soft px-2 py-1 text-[11px] text-step-error">
                            <strong className="font-semibold">{point.name}</strong>
                            <span className="tabular-nums">{point.valueLabel}</span>
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="text-muted">None</span>
                    )}
                  </span>
                  <span className="flex justify-end text-primary">
                    <EnergyIcon name="arrow" className="h-4 w-4 transition-transform group-open:rotate-90" aria-hidden="true" />
                  </span>
                </summary>
                <div className="border-t border-border bg-surface-subtle/35 p-4">
                  <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
                    <div className="min-w-0">
                      <h5 className="text-sm font-semibold text-foreground">Observed distribution — {cohort.name}</h5>
                      <p className="mt-1 text-xs leading-5 text-muted">Observed Centres only. Bars show sample frequency; markers show each Centre. No fitted curve is used.</p>
                      <div className="mt-3">
                        <BenchmarkCohortDistributionPlot distribution={distribution} cohort={cohort} />
                      </div>
                    </div>
                    <BenchmarkCohortRanking distribution={distribution} cohort={cohort} />
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      </div>
      <p className="mt-2 text-xs text-muted">Values shown in {distribution.unit}. Open Detail on a Centre Type to see only its distribution and Centre ranking.</p>
    </section>
  );
}

function BenchmarkScatterPlot({ benchmark }: { benchmark: BenchmarkView }) {
  const width = 760;
  const height = 360;
  const margin = { top: 28, right: 30, bottom: 54, left: 66 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const euiValues = benchmark.scatter.points.map((point) => point.eui);
  const perPaxValues = benchmark.scatter.points.map((point) => point.perPax);
  const euiRange = Math.max(...euiValues) - Math.min(...euiValues);
  const perPaxRange = Math.max(...perPaxValues) - Math.min(...perPaxValues);
  const euiMin = Math.max(0, Math.min(...euiValues) - Math.max(0.5, euiRange * 0.08));
  const euiMax = Math.max(...euiValues) + Math.max(0.5, euiRange * 0.08);
  const perPaxMin = Math.max(0, Math.min(...perPaxValues) - Math.max(0.5, perPaxRange * 0.08));
  const perPaxMax = Math.max(...perPaxValues) + Math.max(0.5, perPaxRange * 0.08);
  const x = (value: number) => roundSvg(margin.left + ((value - euiMin) / (euiMax - euiMin)) * plotWidth);
  const y = (value: number) => roundSvg(margin.top + (1 - ((value - perPaxMin) / (perPaxMax - perPaxMin))) * plotHeight);
  const euiP75X = x(benchmark.scatter.euiP75);
  const perPaxP75Y = y(benchmark.scatter.perPaxP75);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface-subtle p-3">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby="preschool-benchmark-scatter-title preschool-benchmark-scatter-description"
        data-benchmark-plot="eui-x-per-pax-y"
        className="h-auto w-full"
      >
        <title id="preschool-benchmark-scatter-title">Centre energy intensity and energy-per-person comparison</title>
        <desc id="preschool-benchmark-scatter-description">Thirty Centres plotted with annualised energy intensity increasing to the right and energy per person increasing upward. Dashed all-centre P75 lines identify the Centres to review first.</desc>
        <rect x={margin.left} y={margin.top} width={plotWidth} height={plotHeight} rx="8" className="fill-surface" />
        <rect x={margin.left} y={margin.top} width={euiP75X - margin.left} height={perPaxP75Y - margin.top} className="fill-step-warning" opacity="0.04" />
        <rect x={euiP75X} y={margin.top} width={margin.left + plotWidth - euiP75X} height={perPaxP75Y - margin.top} className="fill-step-error" opacity="0.08" />
        <rect x={margin.left} y={perPaxP75Y} width={euiP75X - margin.left} height={margin.top + plotHeight - perPaxP75Y} className="fill-muted" opacity="0.025" />
        <rect x={euiP75X} y={perPaxP75Y} width={margin.left + plotWidth - euiP75X} height={margin.top + plotHeight - perPaxP75Y} className="fill-primary" opacity="0.04" />
        <line x1={margin.left} y1={margin.top + plotHeight} x2={margin.left + plotWidth} y2={margin.top + plotHeight} stroke="currentColor" className="text-border" />
        <line x1={margin.left} y1={margin.top} x2={margin.left} y2={margin.top + plotHeight} stroke="currentColor" className="text-border" />
        <line
          data-benchmark-p75-axis="eui"
          x1={euiP75X}
          y1={margin.top}
          x2={euiP75X}
          y2={margin.top + plotHeight}
          stroke="currentColor"
          strokeDasharray="6 5"
          className="text-step-warning"
        />
        <line
          data-benchmark-p75-axis="per-pax"
          x1={margin.left}
          y1={perPaxP75Y}
          x2={margin.left + plotWidth}
          y2={perPaxP75Y}
          stroke="currentColor"
          strokeDasharray="6 5"
          className="text-step-warning"
        />
        <text x={euiP75X + 5} y={margin.top + 13} className="fill-step-warning text-[10px] font-semibold">EUI P75 {benchmark.eui.p75}</text>
        <text x={margin.left + plotWidth - 6} y={perPaxP75Y - 6} textAnchor="end" className="fill-step-warning text-[10px] font-semibold">Per-pax P75 {benchmark.perPax.p75}</text>
        <text x={margin.left + 8} y={margin.top + 14} className="fill-step-warning text-[9px] font-semibold">HIGH PER-PAX</text>
        <text x={margin.left + plotWidth - 8} y={margin.top + 14} textAnchor="end" className="fill-step-error text-[9px] font-semibold">PRIORITY</text>
        <text x={margin.left + 8} y={margin.top + plotHeight - 10} className="fill-muted text-[9px] font-semibold">LOWER INTENSITY</text>
        <text x={margin.left + plotWidth - 8} y={margin.top + plotHeight - 10} textAnchor="end" className="fill-primary text-[9px] font-semibold">HIGH EUI</text>
        {benchmark.scatter.points.map((point) => {
          const cx = x(point.eui);
          const cy = y(point.perPax);
          const visual = benchmarkCohortVisual(point.cohort);
          const alignRight = cx > margin.left + plotWidth - 120;
          const labelY = cy < margin.top + 28 || point.actionRank === 2 ? cy + 17 : cy - 9;
          return (
            <g
              key={point.centreCode}
              data-benchmark-centre={point.centreCode}
              data-marker-shape={visual.shape}
              className={visual.className}
            >
              <title>{`${point.name} (${point.cohort}): ${point.eui.toFixed(2)} kWh/m²/yr, ${point.perPax.toFixed(1)} kWh/person/month, ${benchmarkQuadrantLabel(point.quadrant)}`}</title>
              <BenchmarkMarker shape={visual.shape} cx={cx} cy={cy} radius={4.5} />
              {point.priority ? (
                <circle cx={cx} cy={cy} r={7.5} fill="none" stroke="currentColor" strokeWidth={1.8} className="text-step-error" />
              ) : null}
              {point.priority ? (
                <text
                  data-benchmark-priority-label={point.centreCode}
                  x={alignRight ? cx - 9 : cx + 9}
                  y={labelY}
                  textAnchor={alignRight ? "end" : "start"}
                  className="fill-step-error text-[11px] font-bold"
                >
                  {point.actionRank}. {point.name}
                </text>
              ) : null}
            </g>
          );
        })}
        <text x={margin.left} y={margin.top + plotHeight + 18} className="fill-muted-light text-[9px]">{euiMin.toFixed(1)}</text>
        <text x={margin.left + plotWidth} y={margin.top + plotHeight + 18} textAnchor="end" className="fill-muted-light text-[9px]">{euiMax.toFixed(1)}</text>
        <text x={margin.left - 8} y={margin.top + plotHeight} textAnchor="end" className="fill-muted-light text-[9px]">{perPaxMin.toFixed(1)}</text>
        <text x={margin.left - 8} y={margin.top + 4} textAnchor="end" className="fill-muted-light text-[9px]">{perPaxMax.toFixed(1)}</text>
        <text x={margin.left + plotWidth / 2} y={height - 10} textAnchor="middle" className="fill-muted text-[11px] font-semibold">Annualised EUI (kWh/m²/yr) →</text>
        <text x={16} y={margin.top + plotHeight / 2} textAnchor="middle" transform={`rotate(-90 16 ${margin.top + plotHeight / 2})`} className="fill-muted text-[11px] font-semibold">↑ Energy per person (kWh/person/month)</text>
      </svg>
      <BenchmarkCohortLegend />
    </div>
  );
}

type BenchmarkMarkerShape = "circle" | "triangle" | "diamond";

const BENCHMARK_COHORT_VISUALS: Record<string, { shape: BenchmarkMarkerShape; className: string }> = {
  "Senior Care Center": { shape: "circle", className: "text-primary" },
  "Active Aging Center": { shape: "triangle", className: "text-step-success" },
  Preschool: { shape: "diamond", className: "text-step-warning" },
};

function benchmarkCohortVisual(cohort: string) {
  return BENCHMARK_COHORT_VISUALS[cohort] ?? { shape: "circle" as const, className: "text-muted" };
}

function BenchmarkMarker({
  shape,
  cx,
  cy,
  radius,
}: {
  shape: BenchmarkMarkerShape;
  cx: number;
  cy: number;
  radius: number;
}) {
  const markerProps = {
    fill: "currentColor",
    stroke: "white",
    strokeWidth: 1.2,
  };
  if (shape === "triangle") {
    return <path d={`M ${cx} ${cy - radius} L ${cx + radius} ${cy + radius} L ${cx - radius} ${cy + radius} Z`} {...markerProps} />;
  }
  if (shape === "diamond") {
    return <rect x={cx - radius * 0.75} y={cy - radius * 0.75} width={radius * 1.5} height={radius * 1.5} transform={`rotate(45 ${cx} ${cy})`} {...markerProps} />;
  }
  return <circle cx={cx} cy={cy} r={radius} {...markerProps} />;
}

function BenchmarkCohortLegend() {
  return (
    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-3 text-[10px] text-muted">
      {Object.entries(BENCHMARK_COHORT_VISUALS).map(([cohort, visual]) => (
        <span key={cohort} className={`inline-flex items-center gap-1.5 ${visual.className}`}>
          <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5">
            <BenchmarkMarker shape={visual.shape} cx={8} cy={8} radius={4} />
          </svg>
          <span className="text-muted">{cohort} · {visual.shape}</span>
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5 text-step-error">
        <span aria-hidden="true" className="h-3 w-3 rounded-full border-2 border-current" />
        <span className="text-muted">Action priority · ring + Centre name</span>
      </span>
      <span className="inline-flex items-center gap-1.5 text-step-warning">
        <span aria-hidden="true" className="w-4 border-t border-dashed border-current" />
        <span className="text-muted">All-centre P75 review threshold</span>
      </span>
    </div>
  );
}

type BenchmarkCohortView = BenchmarkDistributionView["cohorts"][number];

function BenchmarkCohortDistributionPlot({
  distribution,
  cohort,
}: {
  distribution: BenchmarkDistributionView;
  cohort: BenchmarkCohortView;
}) {
  const width = 700;
  const height = 270;
  const margin = { top: 42, right: 24, bottom: 44, left: 42 };
  const plotWidth = width - margin.left - margin.right;
  const baselineY = height - margin.bottom - 24;
  const histogramHeight = baselineY - margin.top;
  const binCount = 8;
  const axisSpan = distribution.axis.max - distribution.axis.min;
  const binSpan = axisSpan / binCount;
  const bins = Array.from({ length: binCount }, (_, index) => ({
    start: distribution.axis.min + index * binSpan,
    count: 0,
  }));
  cohort.points.forEach((point) => {
    const binIndex = Math.min(binCount - 1, Math.max(0, Math.floor((point.value - distribution.axis.min) / binSpan)));
    bins[binIndex]!.count += 1;
  });
  const maximumBinCount = Math.max(1, ...bins.map((bin) => bin.count));
  const x = (value: number) => roundSvg(
    margin.left + ((value - distribution.axis.min) / axisSpan) * plotWidth,
  );
  const barSlotWidth = plotWidth / binCount;
  const visual = benchmarkCohortVisual(cohort.name);
  const rugOffsets = [0, -7, 7];

  return (
    <div className="overflow-hidden border-y border-border bg-surface py-3" data-benchmark-distribution={`${distribution.id}:${cohort.name}`}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${cohort.name} observed ${distribution.label} distribution`}
        data-shared-axis={distribution.id}
        className="h-auto w-full"
      >
        <line x1={margin.left} y1={baselineY} x2={width - margin.right} y2={baselineY} stroke="currentColor" className="text-border" />
        <text x={margin.left} y={margin.top - 12} className="fill-muted text-[10px]">Observed Centre count · max {maximumBinCount}</text>
        {bins.map((bin, index) => {
          const barHeight = roundSvg((bin.count / maximumBinCount) * histogramHeight);
          const barX = roundSvg(margin.left + index * barSlotWidth + 3);
          return (
            <rect
              key={bin.start}
              x={barX}
              y={baselineY - barHeight}
              width={Math.max(2, barSlotWidth - 6)}
              height={barHeight}
              rx="2"
              className="fill-primary"
              opacity={bin.count > 0 ? 0.16 : 0.035}
            >
              <title>{`${bin.count} Centre${bin.count === 1 ? "" : "s"} in this observed range`}</title>
            </rect>
          );
        })}
        <line x1={x(cohort.p50Value)} y1={margin.top} x2={x(cohort.p50Value)} y2={baselineY + 24} stroke="currentColor" strokeWidth={1.8} className="text-primary" />
        <line x1={x(cohort.p75Value)} y1={margin.top} x2={x(cohort.p75Value)} y2={baselineY + 24} stroke="currentColor" strokeWidth={1.8} strokeDasharray="5 4" className="text-step-warning" />
        <text x={x(cohort.p50Value)} y={margin.top - 8} textAnchor="middle" className="fill-primary text-[11px] font-semibold">P50 {cohort.p50}</text>
        <text x={x(cohort.p75Value)} y={margin.top + 10} textAnchor="middle" className="fill-step-warning text-[11px] font-semibold">P75 {cohort.p75}</text>
        {cohort.points.map((point, pointIndex) => {
          const cx = x(point.value);
          const cy = baselineY + 16 + rugOffsets[pointIndex % rugOffsets.length]!;
          return (
            <g
              key={point.centreCode}
              data-distribution-centre={`${distribution.id}:${cohort.name}:${point.centreCode}`}
              className={point.aboveP75 ? "text-step-error" : visual.className}
            >
              <title>{`${point.name}: ${point.valueLabel} ${distribution.unit}${point.aboveP75 ? ", above cohort P75" : ""}`}</title>
              <BenchmarkMarker shape={visual.shape} cx={cx} cy={cy} radius={4} />
            </g>
          );
        })}
        <text x={margin.left} y={height - 10} className="fill-muted text-[10px]">{distribution.axis.min}</text>
        <text x={width - margin.right} y={height - 10} textAnchor="end" className="fill-muted text-[10px]">{distribution.axis.max} {distribution.unit}</text>
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-2 text-[10px] text-muted">
        <span><strong className="font-semibold text-primary">P50</strong> · solid line</span>
        <span><strong className="font-semibold text-step-warning">P75</strong> · dashed line</span>
        <span><strong className="font-semibold text-step-error">Above P75</strong> · red marker</span>
      </div>
    </div>
  );
}

function BenchmarkCohortRanking({
  distribution,
  cohort,
}: {
  distribution: BenchmarkDistributionView;
  cohort: BenchmarkCohortView;
}) {
  const maximumValue = Math.max(1, ...cohort.points.map((point) => point.value));
  return (
    <aside className="min-w-0 xl:border-l xl:border-border xl:pl-5" data-benchmark-ranking={`${distribution.id}:${cohort.name}`}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h5 className="text-sm font-semibold text-foreground">Centre ranking</h5>
          <p className="mt-1 text-xs text-muted">Above-P75 Centres first, then highest observed value.</p>
        </div>
        <span className="text-xs tabular-nums text-muted">n={cohort.sampleSize}</span>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-3 border-y border-border py-3 text-xs">
        <div><dt className="text-muted">P50</dt><dd className="mt-1 font-semibold tabular-nums text-primary">{cohort.p50}</dd></div>
        <div><dt className="text-muted">P75</dt><dd className="mt-1 font-semibold tabular-nums text-step-warning">{cohort.p75}</dd></div>
        <div><dt className="text-muted">Above</dt><dd className="mt-1 font-semibold tabular-nums text-step-error">{cohort.points.filter((point) => point.aboveP75).length}</dd></div>
      </dl>
      <div
        data-benchmark-ranking-scroll={`${distribution.id}:${cohort.name}`}
        role="region"
        tabIndex={0}
        aria-label={`${cohort.name} ${distribution.label} Centre ranking, all ${cohort.sampleSize} Centres`}
        className="mt-3 max-h-64 touch-pan-y overflow-y-auto overscroll-contain rounded-sm pr-2 scroll-py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30"
      >
        <ol className="divide-y divide-border">
          {cohort.points.map((point, index) => (
            <li
              key={point.centreCode}
              data-benchmark-ranking-row={`${distribution.id}:${cohort.name}:${point.centreCode}`}
              className="grid grid-cols-[24px_minmax(96px,auto)_minmax(80px,1fr)_64px] items-center gap-2 py-2 text-xs"
            >
              <span className="text-right tabular-nums text-muted">{index + 1}</span>
              <span className={`truncate font-semibold ${point.aboveP75 ? "text-step-error" : "text-foreground"}`}>{point.name}</span>
              <span className="h-1.5 overflow-hidden rounded-full bg-border" aria-hidden="true">
                <span className={`block h-full rounded-full ${point.aboveP75 ? "bg-step-error" : "bg-primary"}`} style={{ width: `${Math.max(3, (point.value / maximumValue) * 100)}%` }} />
              </span>
              <span className={`text-right tabular-nums font-semibold ${point.aboveP75 ? "text-step-error" : "text-foreground"}`}>{point.valueLabel}</span>
            </li>
          ))}
        </ol>
      </div>
      <p className="mt-3 text-[10px] leading-4 text-muted">Values in {distribution.unit}. Ranking is scoped to {cohort.name} only.</p>
    </aside>
  );
}

function benchmarkQuadrantLabel(quadrant: BenchmarkView["scatter"]["points"][number]["quadrant"]): string {
  if (quadrant === "priority") return "Priority";
  if (quadrant === "eui-intensive") return "High EUI";
  if (quadrant === "people-intensive") return "High per-pax";
  return "Lower intensity";
}

function roundSvg(value: number): number {
  return Math.round(value * 100) / 100;
}

type OperationalView = Extract<PreschoolOverviewViewModel["operational"], { status: "available" }>;
type StandbyView = OperationalView["standby"];
type OperatingView = OperationalView["operating"];

function StandbyKpiStrip({ standby }: { standby: StandbyView }) {
  const metrics = [
    { label: "Energy used after closing", value: standby.energy, detail: "Calendar-classified closed hours" },
    { label: "Provisional standby cost", value: standby.provisionalCost, detail: "Before GST reference · not a bill" },
    { label: "Share of total", value: standby.share, detail: "Of energy in the current accepted window" },
    { label: "Unusual closed-hour Spikes", value: String(standby.spikeCount), detail: "Above the same-hour baseline" },
    { label: "Centres to review", value: String(standby.centreCount), detail: "Named below in action order" },
  ];
  return (
    <dl
      data-standby-kpis="five-decision-metrics"
      className="mt-6 grid overflow-hidden rounded-lg border border-border bg-surface sm:grid-cols-2 xl:grid-cols-5"
    >
      {metrics.map((metric) => (
        <div key={metric.label} className="border-b border-border px-4 py-4 last:border-b-0 sm:border-r xl:border-b-0 xl:last:border-r-0">
          <dt className="text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-light">{metric.label}</dt>
          <dd className="mt-2 text-xl font-semibold tabular-nums text-foreground">{metric.value}</dd>
          <p className="mt-1.5 text-[10px] leading-4 text-muted">{metric.detail}</p>
        </div>
      ))}
    </dl>
  );
}

function OperatingKpiStrip({ operating }: { operating: OperatingView }) {
  const metrics = [
    { label: "Total operating energy", value: operating.energy, detail: "Calendar-classified opening hours" },
    { label: "Provisional operating cost", value: operating.provisionalCost, detail: "Before GST reference · not a bill" },
    { label: "Share of total", value: operating.share, detail: "Of energy in the current accepted window" },
    { label: "Unusual operating-hour Spikes", value: String(operating.spikeCount), detail: "Above the same-hour baseline" },
    { label: "Centres to review", value: String(operating.centreCount), detail: "Named below in action order" },
  ];
  return (
    <dl
      data-operating-kpis="five-decision-metrics"
      className="mt-6 grid overflow-hidden rounded-lg border border-border bg-surface sm:grid-cols-2 xl:grid-cols-5"
    >
      {metrics.map((metric) => (
        <div key={metric.label} className="border-b border-border px-4 py-4 last:border-b-0 sm:border-r xl:border-b-0 xl:last:border-r-0">
          <dt className="text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-light">{metric.label}</dt>
          <dd className="mt-2 text-xl font-semibold tabular-nums text-foreground">{metric.value}</dd>
          <p className="mt-1.5 text-[10px] leading-4 text-muted">{metric.detail}</p>
        </div>
      ))}
    </dl>
  );
}

function StandbyApplianceComposition({ standby }: { standby: StandbyView }) {
  return <OperatingStateApplianceComposition state="standby" stateView={standby} />;
}

function OperatingApplianceComposition({ operating }: { operating: OperatingView }) {
  return <OperatingStateApplianceComposition state="operating" stateView={operating} />;
}

function OperatingStateApplianceComposition({
  state,
  stateView,
}: {
  state: "standby" | "operating";
  stateView: StandbyView | OperatingView;
}) {
  const isStandby = state === "standby";
  const stateLabel = isStandby ? "Closed-hour" : "Operating-hour";
  const compositionData = isStandby
    ? { "data-standby-appliance-composition": "closed-state" }
    : { "data-operating-appliance-composition": "operating-state" };
  let cumulativeOffset = 0;
  const arcs = stateView.appliances.map((appliance, index) => {
    const arc = { ...appliance, index, offset: cumulativeOffset };
    cumulativeOffset += appliance.sharePct;
    return arc;
  });
  return (
    <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(360px,0.82fr)_minmax(0,1.18fr)]" {...compositionData}>
      <article className="border-y border-border py-5">
        <div className="mx-auto max-w-xl">
          <svg viewBox="0 0 300 300" role="img" aria-labelledby={`${state}-composition-title ${state}-composition-description`} className="mx-auto h-auto w-full max-w-[340px] overflow-visible">
            <title id={`${state}-composition-title`}>{`${stateLabel} energy share by published Appliance alias`}</title>
            <desc id={`${state}-composition-description`}>{`${stateView.appliances.length} published Circuit aliases shown as individual sectors. Focus a sector for its alias, energy and share; the full values remain available in the ranking.`}</desc>
            <circle cx="150" cy="150" r="100" pathLength="100" fill="none" stroke="currentColor" strokeWidth="46" className="text-surface-subtle" />
            <text x="150" y="145" textAnchor="middle" className="fill-muted text-[12px] font-semibold" data-operating-state-appliance-total-label={state}>{stateLabel}</text>
            <text x="150" y="169" textAnchor="middle" className="fill-foreground text-[17px] font-semibold" data-operating-state-appliance-total={state}>{stateView.energy}</text>
            {arcs.map((appliance) => (
              <g key={appliance.name} className="group/segment">
                <circle
                  cx="150"
                  cy="150"
                  r="100"
                  pathLength="100"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="46"
                  strokeDasharray={`${appliance.sharePct} ${100 - appliance.sharePct}`}
                  strokeDashoffset={-appliance.offset}
                  strokeLinecap="butt"
                  transform="rotate(-90 150 150)"
                  tabIndex={0}
                  role="img"
                  aria-label={`${appliance.name}: ${appliance.energy}, ${appliance.share}`}
                  className={`${applianceSeriesStrokeClass(appliance.index)} cursor-pointer focus-visible:outline-none focus-visible:opacity-80`}
                  data-operating-state-appliance-segment={`${state}:${appliance.name}`}
                  {...(isStandby
                    ? { "data-standby-appliance-segment": appliance.name }
                    : { "data-operating-appliance-segment": appliance.name })}
                >
                  <title>{`${appliance.name}: ${appliance.energy}, ${appliance.share}`}</title>
                </circle>
                <g
                  aria-hidden="true"
                  className="pointer-events-none opacity-0 transition-opacity group-hover/segment:opacity-100 group-focus-within/segment:opacity-100"
                  data-operating-state-appliance-tooltip={`${state}:${appliance.name}`}
                >
                  <rect x="80" y="120" width="140" height="60" rx="8" className="fill-foreground" />
                  <text x="150" y="141" textAnchor="middle" className="fill-white text-[10px] font-semibold">
                    <tspan x="150">{appliance.name}</tspan>
                    <tspan x="150" dy="19" className="font-normal">{appliance.energy} · {appliance.share}</tspan>
                  </text>
                </g>
              </g>
            ))}
          </svg>
          <p className="mt-3 text-center text-[10px] leading-4 text-muted">Hover or focus a sector for its alias and value. Full details are listed in the ranking.</p>
        </div>
      </article>

      <article className="border-y border-border py-5" aria-labelledby={`${state}-appliance-ranking-heading`}>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h5 id={`${state}-appliance-ranking-heading`} className="text-sm font-semibold text-foreground">Appliance ranking</h5>
            <p className="mt-1 text-xs leading-5 text-muted">Observed published Circuit aliases, highest {stateLabel.toLowerCase()} consumer first.</p>
          </div>
          <span className="text-[10px] text-muted">Energy · provisional cost · share</span>
        </div>
        <ol
          className="mt-4 divide-y divide-border"
          data-operating-state-appliance-ranking={state}
          {...(isStandby
            ? { "data-standby-appliance-ranking": "true" }
            : { "data-operating-appliance-ranking": "true" })}
        >
          {stateView.appliances.map((appliance, index) => (
            <li
              key={appliance.name}
              className="grid gap-2 py-2.5 text-xs sm:grid-cols-[24px_minmax(150px,0.8fr)_minmax(120px,1fr)_92px_72px] sm:items-center"
              data-appliance-series-index={index + 1}
              data-operating-state-appliance={`${state}:${appliance.name}`}
              {...(isStandby
                ? { "data-standby-appliance": appliance.name }
                : { "data-operating-appliance": appliance.name })}
            >
              <span className="text-right tabular-nums text-muted">{index + 1}</span>
              <span className="min-w-0"><strong className="flex items-center gap-2 break-words font-semibold text-foreground"><span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${applianceSeriesBarClass(index)}`} aria-hidden="true" />{appliance.name}</strong><span className="mt-0.5 block text-[10px] text-muted">Published alias · {appliance.centreCount} Centres</span></span>
              <span className="h-2 overflow-hidden rounded-full bg-surface-subtle" aria-hidden="true"><span className={`block h-full min-w-[2px] rounded-full ${applianceSeriesBarClass(index)}`} style={{ width: `${appliance.sharePct}%` }} /></span>
              <span className="text-right font-semibold tabular-nums text-foreground">{appliance.energy}</span>
              <span className="text-right tabular-nums text-muted"><strong className="block font-semibold text-foreground">{appliance.share}</strong>{appliance.provisionalCost}</span>
            </li>
          ))}
        </ol>
      </article>
    </div>
  );
}

function StandbySpikeTable({ centres }: { centres: PreschoolOperationalCentre[] }) {
  return <OperatingStateSpikeTable state="standby" centres={centres} />;
}

function OperatingSpikeTable({ centres }: { centres: PreschoolOperationalCentre[] }) {
  return <OperatingStateSpikeTable state="operating" centres={centres} />;
}

function OperatingStateSpikeTable({
  state,
  centres,
}: {
  state: "standby" | "operating";
  centres: PreschoolOperationalCentre[];
}) {
  const isStandby = state === "standby";
  const stateLabel = isStandby ? "closed-hour" : "operating-hour";
  const summaryGrid = "grid grid-cols-2 gap-x-4 gap-y-3 xl:grid-cols-[minmax(110px,1fr)_minmax(105px,0.9fr)_42px_minmax(110px,0.95fr)_minmax(70px,0.7fr)_minmax(80px,0.75fr)_minmax(70px,0.65fr)_minmax(120px,1fr)_44px] xl:items-center xl:gap-3";
  const eventGrid = "grid grid-cols-2 gap-x-4 gap-y-3 xl:grid-cols-[36px_minmax(112px,1fr)_minmax(72px,0.7fr)_minmax(80px,0.75fr)_minmax(78px,0.7fr)_minmax(70px,0.65fr)_minmax(130px,1fr)] xl:items-center xl:gap-3";
  return (
    <div
      className="mt-5 overflow-hidden rounded-lg border border-border bg-surface"
      data-operating-state-spike-table={`${state}:action-sorted`}
      {...(isStandby
        ? { "data-standby-spike-table": "action-sorted" }
        : { "data-operating-spike-table": "action-sorted" })}
    >
      <div className="hidden bg-surface-subtle px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-light xl:grid xl:grid-cols-[minmax(110px,1fr)_minmax(105px,0.9fr)_42px_minmax(110px,0.95fr)_minmax(70px,0.7fr)_minmax(80px,0.75fr)_minmax(70px,0.65fr)_minmax(120px,1fr)_44px] xl:items-center xl:gap-3" aria-hidden="true">
        <span>Centre</span><span>Centre type</span><span>Spikes</span><span>Worst date / hour</span><span className="text-right">Actual</span><span className="text-right">Baseline</span><span className="text-right">Variance</span><span>Observed leading contributor</span><span className="text-right">Detail</span>
      </div>
      <div className="divide-y divide-border">
        {centres.map((centre) => (
          <details
            key={centre.centreCode}
            data-operating-state-spike-centre={`${state}:${centre.centreCode}`}
            {...(isStandby
              ? { "data-standby-spike-centre": centre.centreCode }
              : { "data-operating-spike-centre": centre.centreCode })}
            className="group"
          >
            <summary
              tabIndex={0}
              aria-label={`View all ${centre.spikeCount} ${stateLabel} Spike events for ${centre.name}.`}
              className={`${summaryGrid} cursor-pointer list-none px-4 py-3 text-xs text-foreground hover:bg-surface-subtle/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/25 [&::-webkit-details-marker]:hidden`}
            >
              <span className="col-span-2 min-w-0 xl:col-span-1"><ResponsiveCellLabel>Centre</ResponsiveCellLabel><strong className="block break-words font-semibold">{centre.name}</strong><span className="mt-0.5 block text-[10px] text-muted">Centre {centre.centreCode}</span></span>
              <span className="min-w-0 break-words text-muted"><ResponsiveCellLabel>Centre type</ResponsiveCellLabel>{centre.centreType ?? "Unavailable"}</span>
              <span className="font-semibold tabular-nums text-step-error"><ResponsiveCellLabel>Spikes</ResponsiveCellLabel>{centre.spikeCount}</span>
              <span className="min-w-0 break-words tabular-nums text-muted"><ResponsiveCellLabel>Worst date / hour</ResponsiveCellLabel>{centre.worst.when}</span>
              <span className="font-semibold tabular-nums xl:text-right"><ResponsiveCellLabel>Actual</ResponsiveCellLabel>{centre.worst.usage}</span>
              <span className="min-w-0 break-words tabular-nums text-muted xl:text-right"><ResponsiveCellLabel>Baseline</ResponsiveCellLabel>{centre.worst.baseline}</span>
              <span className="font-semibold tabular-nums text-step-error xl:text-right"><ResponsiveCellLabel>Variance</ResponsiveCellLabel>{centre.worst.variance}</span>
              <span className="col-span-2 min-w-0 break-words text-muted xl:col-span-1"><ResponsiveCellLabel>Observed leading contributor</ResponsiveCellLabel>{centre.worst.leadingCircuit}</span>
              <span className="col-span-2 font-semibold text-primary xl:col-span-1 xl:text-right"><ResponsiveCellLabel>Detail</ResponsiveCellLabel><span className="group-open:hidden">Open</span><span className="hidden group-open:inline">Close</span></span>
            </summary>
            <div className="border-t border-border bg-surface-subtle/35 px-4 py-4">
              <p className="text-xs font-semibold text-foreground">All {centre.events.length} {stateLabel} event{centre.events.length === 1 ? "" : "s"} for {centre.name}</p>
              <div className="mt-3 hidden border-b border-border pb-2 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-light xl:grid xl:grid-cols-[36px_minmax(112px,1fr)_minmax(72px,0.7fr)_minmax(80px,0.75fr)_minmax(78px,0.7fr)_minmax(70px,0.65fr)_minmax(130px,1fr)] xl:items-center xl:gap-3" aria-hidden="true">
                <span>#</span><span>When</span><span className="text-right">Actual</span><span className="text-right">Baseline</span><span className="text-right">Excess</span><span className="text-right">Variance</span><span>Observed leading contributor</span>
              </div>
              <ol className="divide-y divide-border" aria-label={`${centre.name} ${stateLabel} Spike events`}>
                {centre.events.map((event, index) => (
                  <li
                    key={`${event.when}:${index}`}
                    className={`${eventGrid} py-3 text-xs`}
                    data-operating-state-spike-event={`${state}:${centre.centreCode}:${index + 1}`}
                    {...(isStandby
                      ? { "data-standby-spike-event": `${centre.centreCode}:${index + 1}` }
                      : { "data-operating-spike-event": `${centre.centreCode}:${index + 1}` })}
                  >
                    <span className="tabular-nums text-muted"><ResponsiveCellLabel>Event</ResponsiveCellLabel>{index + 1}</span>
                    <span className="min-w-0 break-words"><ResponsiveCellLabel>When</ResponsiveCellLabel>{event.when}<span className="mt-0.5 block text-[10px] text-muted">{event.dayType}</span></span>
                    <span className="font-semibold tabular-nums xl:text-right"><ResponsiveCellLabel>Actual</ResponsiveCellLabel>{event.usage}</span>
                    <span className="tabular-nums text-muted xl:text-right"><ResponsiveCellLabel>Baseline</ResponsiveCellLabel>{event.baseline}</span>
                    <span className="tabular-nums text-muted xl:text-right"><ResponsiveCellLabel>Excess</ResponsiveCellLabel>{event.impact}</span>
                    <span className="font-semibold tabular-nums text-step-error xl:text-right"><ResponsiveCellLabel>Variance</ResponsiveCellLabel>{event.variance}</span>
                    <span className="col-span-2 min-w-0 break-words text-muted xl:col-span-1"><ResponsiveCellLabel>Observed leading contributor</ResponsiveCellLabel>{event.leadingCircuit}</span>
                  </li>
                ))}
              </ol>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

function ResponsiveCellLabel({ children }: { children: React.ReactNode }) {
  return <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-light xl:hidden">{children}</span>;
}

function AfterHoursReviewPriority({ sop }: { sop: OperationalView["sop"] }) {
  return (
    <div className="mt-5 border-y border-border" data-after-hours-review-priority="provisional">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-step-warning-soft/35 px-4 py-3 text-xs">
        <p className="font-semibold text-foreground">Centres with recorded Spikes appear first: {sop.breachingCentreCodes.join(" · ") || "none"}</p>
        <p className="text-muted">Lower provisional score = more closed-hour Spikes</p>
      </div>
      <ol className="divide-y divide-border">
        {sop.centres.map((centre, index) => (
          <li key={centre.centreCode} className="grid gap-4 px-4 py-4 text-xs sm:grid-cols-2 xl:grid-cols-[36px_minmax(140px,0.9fr)_minmax(78px,0.55fr)_minmax(110px,0.8fr)_minmax(120px,0.8fr)_minmax(78px,0.55fr)_minmax(170px,1fr)] xl:items-center xl:gap-3" data-review-priority-centre={centre.centreCode}>
            <span className="text-lg font-semibold tabular-nums text-step-warning">{index + 1}</span>
            <span className="min-w-0"><strong className="block break-words text-sm font-semibold text-foreground">{centre.name}</strong><span className="mt-0.5 block break-words text-muted">Centre {centre.centreCode} · {centre.centreType ?? "Type unavailable"}</span></span>
            <span className="min-w-0"><strong className="block font-semibold tabular-nums text-step-error">{centre.standbySpikeCount}</strong><span className="text-[10px] text-muted">closed-hour Spikes</span></span>
            <span className="min-w-0"><strong className="block break-words font-semibold tabular-nums text-foreground">{centre.worstWhen}</strong><span className="text-[10px] text-muted">worst event · {centre.worstVariance}</span></span>
            <span className="min-w-0"><strong className="block break-words font-semibold text-foreground">{centre.leadingContributor}</strong><span className="text-[10px] text-muted">observed leading contributor</span></span>
            <span className="min-w-0"><strong className="block text-lg font-semibold tabular-nums text-step-warning">{centre.score}</strong><span className="text-[10px] text-muted">provisional score</span></span>
            <span className="min-w-0 break-words leading-5 text-muted sm:col-span-2 xl:col-span-1"><strong className="font-semibold text-foreground">Next check:</strong> confirm the Calendar, operating SOP and equipment state with the Centre.</span>
          </li>
        ))}
      </ol>
      <p className="px-4 py-3 text-[11px] leading-5 text-muted">{sop.detail}</p>
    </div>
  );
}

type PlanningOutlookView = Extract<PreschoolOverviewViewModel["planningOutlook"], { status: "provisional" }>;

function PlanningForecastEvidence({
  planning,
  forecast,
}: {
  planning: PreschoolOverviewViewModel["planningOutlook"];
  forecast: PreschoolOverviewViewModel["forecast"];
}) {
  return (
    <details className="mt-4 rounded-lg border border-border bg-surface px-4 py-3" data-forecast-method-evidence>
      <summary className="cursor-pointer text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
        Method, tariff and evidence
      </summary>
      {planning.status === "provisional" ? (
        <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)]">
          <PlanningBaselineChart outlook={planning} />
          <div className="rounded-lg border border-border bg-surface-subtle p-4 text-xs leading-5 text-muted">
            <p className="font-semibold text-foreground">Transparent planning method</p>
            <p className="mt-2">{planning.method}</p>
            <p className="mt-3"><strong className="font-semibold text-foreground">Rate:</strong> {planning.tariffRate}</p>
            <p className="mt-1">{planning.tariffLabel}</p>
            {planning.tariffSourceUrl ? (
              <a className="mt-2 inline-flex font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30" href={planning.tariffSourceUrl} target="_blank" rel="noreferrer">View official SP tariff source</a>
            ) : null}
            {forecast.status === "unavailable" ? (
              <p className="mt-3 rounded-md border border-step-warning/25 bg-step-warning-soft/40 px-3 py-2">{forecast.detail}</p>
            ) : (
              <div className="mt-3 border-t border-border pt-3">
                <p className="break-all font-mono">{forecast.planEvidence}</p>
                <p className="mt-1 break-all font-mono">{forecast.actualEvidence}</p>
              </div>
            )}
            <ul className="mt-3 list-disc space-y-1 pl-4">
              {planning.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
            </ul>
            <div className="mt-3"><PreschoolEvidenceLink label="View supporting evidence" /></div>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-xs leading-5 text-muted">{planning.detail}</p>
      )}
    </details>
  );
}

function PlanningBaselineChart({ outlook }: { outlook: PlanningOutlookView }) {
  const maximum = Math.max(1, ...outlook.sourceWeeks.map((week) => week.usageKwh));
  return (
    <article className="rounded-lg border border-border bg-surface-subtle p-4" data-planning-baseline="naive-weekly-average">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-foreground">Four complete source weeks</h4>
          <p className="mt-1 text-[11px] leading-5 text-muted">{outlook.method}</p>
        </div>
        <p className="text-xs tabular-nums text-foreground"><strong className="font-semibold">{outlook.weeklyAverage}</strong> average</p>
      </div>
      <div className="mt-5 space-y-3" role="img" aria-label={`Four complete May week totals with an average of ${outlook.weeklyAverage}`}>
        {outlook.sourceWeeks.map((week) => (
          <div key={week.label} className="grid grid-cols-[100px_minmax(0,1fr)_92px] items-center gap-3 text-[11px]">
            <span className="text-muted">{week.label}</span>
            <span className="h-3 overflow-hidden rounded-full bg-surface" aria-hidden="true">
              <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(4, (week.usageKwh / maximum) * 100)}%` }} />
            </span>
            <span className="text-right font-semibold tabular-nums text-foreground">{week.usage}</span>
          </div>
        ))}
      </div>
      <p className="mt-5 border-t border-border pt-3 text-[11px] leading-5 text-muted">Supporting method evidence only. These source-week bars are not target-month Actual. No trend, weather or occupancy adjustment is applied.</p>
    </article>
  );
}

function AllHoursApplianceContext({
  appliances,
}: {
  appliances: PreschoolOverviewViewModel["appliances"];
}) {
  return (
    <details id="preschool-appliance-ranking" className="mt-5 scroll-mt-28 border-t border-border pt-4" data-all-hours-appliance-context="supporting-only">
      <summary className="cursor-pointer text-xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
        Supporting Evidence · all-hours Appliance context across all Centres
      </summary>
      <p className="mt-2 max-w-3xl text-xs leading-5 text-muted">All-hours totals only. This evidence is kept separate from the operating-state composition above.</p>
      {appliances.status === "available" ? (
        <div className="mt-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h4 id="preschool-appliance-ranking-heading" className="text-sm font-semibold text-foreground">All-centre Appliance ranking</h4>
            <p className="text-xs font-semibold tabular-nums text-foreground">{appliances.totalEnergy} · {appliances.rows.length} Appliances</p>
          </div>
          <div className="mt-3 divide-y divide-border border-y border-border" role="list" aria-label="All-hours Appliance energy ranking across all Centres">
            {appliances.rows.map((appliance, index) => (
              <div key={appliance.name} className="grid gap-2 py-3 sm:grid-cols-[minmax(150px,0.8fr)_minmax(220px,1.5fr)_170px] sm:items-center sm:gap-4" role="listitem">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{index + 1}. {appliance.name}</p>
                  <p className="mt-0.5 text-xs text-muted">{appliance.applianceGroup} · {appliance.centreCount} Centres</p>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-surface-subtle" aria-hidden="true">
                  <div
                    className={`h-full rounded-full ${applianceBarClass(appliance.applianceGroup)}`}
                    style={{ width: `${Math.max(2, appliance.relativeToTopPct)}%` }}
                  />
                </div>
                <div className="flex items-baseline justify-between gap-3 tabular-nums sm:justify-end">
                  <span className="text-sm font-semibold text-foreground">{appliance.energy}</span>
                  <span className="w-14 text-right text-xs text-muted">{appliance.share}</span>
                </div>
              </div>
            ))}
          </div>
          <details className="mt-4 border-t border-border pt-3">
            <summary className="cursor-pointer text-xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">All-hours calculation note</summary>
            <p className="mt-2 text-xs leading-5 text-muted">{appliances.detail}</p>
          </details>
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-border bg-surface-subtle p-4" role="status">
          <p className="text-xs font-semibold text-muted">All-hours Appliance ranking unavailable</p>
          <p className="mt-2 text-[11px] leading-5 text-muted">{appliances.detail}</p>
        </div>
      )}
    </details>
  );
}

function CentreContributionRow({
  centre,
  maximumUsageKwh,
  projectExplorerHref,
}: {
  centre: PreschoolOverviewCentre;
  maximumUsageKwh: number;
  projectExplorerHref?: string;
}) {
  const explorerHref = projectExplorerHrefForScope(projectExplorerHref, centre.id);
  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(180px,0.7fr)_minmax(220px,1.5fr)_160px] sm:items-center sm:gap-4" role="listitem">
      <div className="min-w-0">
        {explorerHref ? (
          <a
            href={explorerHref}
            data-centre-explorer-link={centre.id}
            className="block truncate text-xs font-semibold text-foreground hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
          >
            {centre.rank}. {centre.name}
          </a>
        ) : (
          <p className="truncate text-xs font-semibold text-foreground">{centre.rank}. {centre.name}</p>
        )}
        <p className="mt-0.5 text-[11px] text-muted">{centre.cohort ?? "Cohort unavailable"} · {centre.topCircuit ?? "Leading appliance unavailable"}</p>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-surface-subtle" aria-hidden="true">
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(4, (centre.usageKwhValue / maximumUsageKwh) * 100)}%` }} />
      </div>
      <p className="text-right text-xs tabular-nums text-foreground"><strong className="font-semibold">{centre.usageKwh} kWh</strong> · {centre.sharePct}</p>
    </div>
  );
}

function CentreRow({ centre }: { centre: PreschoolOverviewCentre }) {
  return (
    <tr className="bg-surface text-foreground" data-centre-row={centre.id}>
      <td className="px-3 py-3 tabular-nums text-muted">{centre.rank}</td>
      <td className="px-3 py-3 font-semibold">{centre.name}</td>
      <td className="px-3 py-3 text-muted">{centre.cohort ?? "Unavailable"}</td>
      <td className="px-3 py-3 text-right tabular-nums">{centre.usageKwh} kWh</td>
      <td className="px-3 py-3 text-right tabular-nums text-muted">{centre.sharePct}</td>
      <td className="px-3 py-3 text-right tabular-nums text-muted">{centre.eui ?? "Unavailable"}</td>
      <td className="px-3 py-3 text-right tabular-nums text-muted">{centre.perPax ?? "Unavailable"}</td>
      <td className="px-3 py-3"><QuadrantBadge quadrant={centre.quadrant} /></td>
      <td className="px-3 py-3 text-muted">{centre.topCircuit ?? "Unavailable"}</td>
    </tr>
  );
}

function QuadrantBadge({ quadrant }: { quadrant: PreschoolOverviewCentre["quadrant"] }) {
  if (!quadrant) return <span className="text-muted">Unavailable</span>;
  const label = quadrant === "priority"
    ? "Priority"
    : quadrant === "eui-intensive"
      ? "High EUI"
      : quadrant === "people-intensive"
        ? "High per-pax"
        : "Lower intensity";
  return (
    <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-semibold ${quadrant === "priority" ? "border-step-error/30 bg-step-error-soft text-step-error" : "border-border bg-surface-subtle text-muted"}`}>
      {label}
    </span>
  );
}

function ReadinessRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[82px_minmax(0,1fr)] gap-2">
      <dt className="text-muted-light">{label}</dt>
      <dd className={`${mono ? "break-all font-mono" : "break-words"} text-foreground`}>{value}</dd>
    </div>
  );
}

function applianceBarClass(applianceGroup: string): string {
  if (applianceGroup === "Aircon") return "bg-primary";
  if (applianceGroup === "Lighting") return "bg-step-inspect";
  if (applianceGroup === "Plugload") return "bg-step-warning";
  return "bg-step-success";
}

function applianceStrokeClass(applianceGroup: string): string {
  if (applianceGroup === "Aircon") return "text-primary";
  if (applianceGroup === "Lighting") return "text-step-inspect";
  if (applianceGroup === "Plugload") return "text-step-warning";
  return "text-step-success";
}

function applianceSeriesBarClass(index: number): string {
  return [
    "bg-step-warning",
    "bg-primary",
    "bg-step-inspect",
    "bg-step-success",
    "bg-step-query",
    "bg-step-fetch",
    "bg-step-visualize",
    "bg-step-transform",
    "bg-step-knowledge",
  ][index % 9]!;
}

function applianceSeriesStrokeClass(index: number): string {
  return [
    "text-step-warning",
    "text-primary",
    "text-step-inspect",
    "text-step-success",
    "text-step-query",
    "text-step-fetch",
    "text-step-visualize",
    "text-step-transform",
    "text-step-knowledge",
  ][index % 9]!;
}

function titleCase(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function compactCentreCodes(codes: string[]): string {
  const visible = codes.slice(0, 5).join(" · ");
  return codes.length > 5 ? `${visible} · +${codes.length - 5} more` : visible;
}
