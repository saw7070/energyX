"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";

import {
  configApi,
  type EnergyProjectAnalysisSnapshotDto,
  type EnergySavedAnalysisAiArtifactInputDto,
  type EnergySavedOverviewComparisonCandidateDto,
} from "../../../lib/config-api";
import {
  buildOverviewChangeSummary,
  isCompatiblePreviousOverview,
  orderPreviousOverviewCandidates,
  type OverviewConclusionChange,
  type OverviewChangeMetric,
  type OverviewChangeSummary,
} from "./overview-change-summary";

export type OverviewChangeDialogClient = Pick<
  typeof configApi,
  "listEnergySavedAnalyses" | "getEnergySavedAnalysis"
> & Partial<Pick<typeof configApi, "listEnergySavedOverviewComparisonCandidates">>;

export function OverviewChangeDialog({
  projectId,
  currentSnapshot,
  currentAiArtifact,
  onClose,
  onOpenPrevious,
  returnFocusRef,
  client = configApi,
}: {
  projectId: string;
  currentSnapshot: EnergyProjectAnalysisSnapshotDto;
  currentAiArtifact: EnergySavedAnalysisAiArtifactInputDto | null;
  onClose: () => void;
  onOpenPrevious: (analysisId: string) => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
  client?: OverviewChangeDialogClient;
}) {
  const [previous, setPrevious] = useState<EnergySavedOverviewComparisonCandidateDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchLimited, setSearchLimited] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const openingElementRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    openingElementRef.current = returnFocusRef?.current
      ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = focusableElements(dialogRef.current);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!dialogRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      openingElementRef.current?.focus();
    };
  }, [returnFocusRef]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setSearchLimited(false);
    setPrevious(null);
    const lightweightRead = client.listEnergySavedOverviewComparisonCandidates;
    const readPrevious = lightweightRead
      ? lightweightRead.call(client, projectId).then(({ items }) => {
          const candidates = orderPreviousOverviewCandidates({ items, current: currentSnapshot });
          const limited = candidates.length > MAX_CLIENT_COMPARISON_CANDIDATES;
          const detail = candidates
            .slice(0, MAX_CLIENT_COMPARISON_CANDIDATES)
            .find((candidate) => isCompatiblePreviousOverview(candidate, currentSnapshot)) ?? null;
          return { detail, limited };
        })
      : client.listEnergySavedAnalyses(projectId)
      .then(async ({ items }) => {
        const candidates = orderPreviousOverviewCandidates({ items, current: currentSnapshot });
        const limited = candidates.length > MAX_CLIENT_COMPARISON_CANDIDATES;
        const detail = await findLatestCompatibleOverview({
          client,
          projectId,
          currentSnapshot,
          candidates: candidates.slice(0, MAX_CLIENT_COMPARISON_CANDIDATES),
          isActive: () => active,
        });
        return { detail, limited };
      });
    void readPrevious
      .then(({ detail, limited }) => {
        if (active) {
          setPrevious(detail);
          setSearchLimited(limited && !detail);
        }
      })
      .catch((reason) => {
        if (active) setError(messageFrom(reason, "Unable to compare saved Overviews"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, currentSnapshot, projectId]);

  const summary = useMemo(
    () => previous && isCompatiblePreviousOverview(previous, currentSnapshot)
      ? buildOverviewChangeSummary({ previous, current: currentSnapshot, currentAiArtifact })
      : null,
    [currentAiArtifact, currentSnapshot, previous],
  );

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 p-4" role="presentation">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="overview-change-title"
        className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-border bg-surface shadow-2xl"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-border bg-surface px-5 py-4 sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">Overview versions</p>
            <h2 id="overview-change-title" className="mt-1 text-xl font-semibold">What changed?</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
              A frozen previous Overview is compared with the current Snapshot. No model run is started by this comparison.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
          >
            Close
          </button>
        </header>

        <div className="p-5 sm:p-6">
          {loading ? (
            <p className="rounded-xl bg-surface-subtle px-4 py-5 text-sm text-muted" role="status">Finding the latest compatible saved Overview…</p>
          ) : error ? (
            <p className="rounded-xl border border-step-error/25 bg-step-error/5 px-4 py-5 text-sm text-step-error" role="alert">{error}</p>
          ) : !summary ? (
            <div className="rounded-xl border border-border bg-surface-subtle px-5 py-6">
              <h3 className="text-base font-semibold">
                {searchLimited ? "No compatible previous Overview was found in the recent search" : "No compatible previous Overview is saved yet"}
              </h3>
              <p className="mt-2 text-sm leading-6 text-muted">
                {searchLimited
                  ? `No compatible version was found among the ${MAX_CLIENT_COMPARISON_CANDIDATES} most recent saved Overviews. Older history was not scanned by this lightweight comparison.`
                  : "Save the current Overview after each meaningful data update. The next Snapshot can then be compared without rerunning historical AI."}
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="grid gap-3 md:grid-cols-2">
                <VersionCard label="Snapshot A · previous saved Overview" identity={summary.previous} />
                <VersionCard label="Snapshot B · current Overview" identity={summary.current} current />
              </div>

              <ProvenanceChangeNotice provenance={summary.provenance} />

              <section aria-labelledby="overview-change-metrics">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <h3 id="overview-change-metrics" className="text-base font-semibold">Decision metrics</h3>
                    <p className="mt-1 text-sm text-muted">
                      {summary.metrics.length === 0
                        ? "Metric deltas are withheld because the report-time, Template, Calendar, Tariff, mapping, metric, or Renderer basis changed between A and B."
                        : "Compared only when the report-time and deterministic metric basis are compatible. Shown as A → B."}
                    </p>
                  </div>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {summary.metrics.map((metric) => <MetricChangeCard key={metric.id} metric={metric} />)}
                </div>
              </section>

              <section className="rounded-xl border border-border p-5" aria-labelledby="overview-change-ai">
                <h3 id="overview-change-ai" className="text-base font-semibold">AI conclusions</h3>
                {summary.ai.currentStatus === "not-available" ? (
                  <p className="mt-3 rounded-lg bg-primary/5 px-4 py-3 text-sm text-muted" role="status">
                    Current AI Artifact is not available in this comparison yet. Deterministic metric changes above remain valid.
                  </p>
                ) : summary.ai.previousStatus === "not-saved" ? (
                  <p className="mt-3 rounded-lg bg-surface-subtle px-4 py-3 text-sm text-muted">
                    Snapshot A did not save an AI Artifact, so only deterministic changes can be compared.
                  </p>
                ) : (
                  <AiConclusionComparison summary={summary.ai} />
                )}
              </section>

              <div className="flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => onOpenPrevious(summary.previous.analysisId)}
                  className="rounded-lg border border-border bg-surface px-4 py-2.5 text-sm font-semibold hover:bg-surface-subtle"
                >
                  Open previous Overview
                </button>
                <button type="button" onClick={onClose} className="rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-light">
                  Back to current Overview
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function ProvenanceChangeNotice({ provenance }: { provenance: OverviewChangeSummary["provenance"] }) {
  const message = provenance.attribution === "data"
    ? "The reporting definition is unchanged. Differences below can be read as new-data effects."
    : provenance.attribution === "analysis-basis"
      ? "The data Snapshot is unchanged, but the reporting definition or Project Release changed. This is an analysis-basis change, not a new-data effect."
      : provenance.attribution === "mixed"
        ? "Both the data Snapshot and the reporting definition changed. Their effects are shown separately and are not attributed to data alone."
        : "One version predates Report Time provenance. Changes are visible, but cannot be attributed to data alone.";
  return (
    <p className="rounded-xl border border-border bg-surface-subtle px-4 py-3 text-sm leading-6 text-muted" role="status">
      {message}
    </p>
  );
}

function VersionCard({
  label,
  identity,
  current = false,
}: {
  label: string;
  identity: {
    snapshotId: string;
    projectReleaseId: string;
    period: { from: string; to: string; timezone: string };
    reportTime?: OverviewChangeSummary["current"]["reportTime"];
    sequence?: number;
  };
  current?: boolean;
}) {
  return (
    <article className={`rounded-xl border p-4 ${current ? "border-primary/30 bg-primary/5" : "border-border bg-surface-subtle"}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">{label}</p>
      <p className="mt-2 text-sm font-semibold">{formatPeriod(identity.period)}</p>
      <dl className="mt-3 grid gap-2 text-xs text-muted">
        <div><dt className="inline font-semibold">Snapshot {current ? "B" : "A"}: </dt><dd className="inline break-all font-mono">{identity.snapshotId}</dd></div>
        <div><dt className="inline font-semibold">Release: </dt><dd className="inline break-all font-mono">{identity.projectReleaseId}</dd></div>
        {identity.reportTime ? (
          <div>
            <dt className="inline font-semibold">Report policy: </dt>
            <dd className="inline">{identity.reportTime.policyId} · {identity.reportTime.policyRevision}</dd>
          </div>
        ) : null}
      </dl>
      {identity.reportTime ? (
        <ul className="mt-3 space-y-1 border-t border-border pt-3 text-xs text-muted">
          {identity.reportTime.windows.map((window) => (
            <li key={window.windowId}>
              <span className="font-semibold text-foreground">{window.label}:</span>{" "}
              {formatPeriod({ from: window.from, to: window.toExclusive, timezone: identity.period.timezone })}
              {window.phase === "partial" ? " · in progress" : window.phase === "forecast" ? " · forecast" : ""}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function MetricChangeCard({ metric }: { metric: OverviewChangeMetric }) {
  const deltaClass = metric.delta > 0 ? "text-step-warning" : metric.delta < 0 ? "text-step-success" : "text-muted";
  return (
    <article className="rounded-xl border border-border bg-surface-subtle p-4">
      <p className="text-xs font-semibold text-muted">{metric.label}</p>
      <p className="mt-2 text-base font-semibold">
        {formatValue(metric.previousValue, metric.unit)} <span className="text-muted">→</span> {formatValue(metric.currentValue, metric.unit)}
      </p>
      <p className={`mt-2 text-sm font-semibold ${deltaClass}`}>
        {formatDelta(metric.delta, metric.unit)}
        {metric.deltaPct === null || metric.unit === "%" ? null : <span className="font-normal"> · {formatSigned(metric.deltaPct)}%</span>}
      </p>
    </article>
  );
}

function AiConclusionComparison({ summary }: { summary: OverviewChangeSummary["ai"] }) {
  return (
    <div className="mt-4 space-y-4">
      {summary.generationBasisStatus === "changed" ? (
        <p className="rounded-lg bg-step-warning/10 px-4 py-3 text-sm text-muted">
          The Model Profile or AI output contract changed between A and B. Content differences are shown, but they cannot be attributed to new data alone.
        </p>
      ) : summary.generationBasisStatus === "unversioned" ? (
        <p className="rounded-lg bg-surface-subtle px-4 py-3 text-sm text-muted">
          These AI Artifacts do not record the complete Prompt and Workflow revision set. Content changes are visible, but their cause is not fully attributable to data alone.
        </p>
      ) : null}
      <p className="text-sm font-semibold">
        {summary.keyFindingsChanged ? "Key Findings changed between A and B." : "Key Findings are unchanged."}
      </p>
      {!summary.keyFindingsChanged && summary.keyFindingEvidenceChanged ? (
        <p className="text-sm text-muted">The conclusion wording is unchanged, but its supporting Evidence lineage changed.</p>
      ) : null}
      <ConclusionChangeList changes={summary.keyFindingChanges} ariaLabel="Key Finding change counts" />
      {summary.sectionChanges.length > 0 ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Section interpretation changes</p>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {summary.sectionChanges.map((item) => (
              <li key={item.sectionId} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.05em] ${CHANGE_STYLES[item.state]}`}>
                  {CHANGE_LABELS[item.state]}
                </span>
                <span className="font-semibold text-foreground">
                  {SECTION_LABELS[item.sectionId as keyof typeof SECTION_LABELS] ?? item.sectionId}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {summary.additionalChanged !== null ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Additional AI Insights</p>
          {summary.additionalFindingChanges.length > 0 ? (
            <div className="mt-2">
              <ConclusionChangeList changes={summary.additionalFindingChanges} ariaLabel="Additional Insight change counts" />
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted">
              {summary.additionalChanged ? "Published insight content changed." : "No published content change."}
            </p>
          )}
          {summary.additionalBasisChanged ? (
            <p className="mt-2 text-sm text-muted">The Method set also changed, so this is not a data-only comparison.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ConclusionChangeList({
  changes,
  ariaLabel,
}: {
  changes: OverviewConclusionChange[];
  ariaLabel: string;
}) {
  const counts = CHANGE_STATES.map((state) => ({
    state,
    count: changes.filter((change) => change.state === state).length,
  }));
  return (
    <div className="rounded-xl bg-surface-subtle p-4">
      <div className="flex flex-wrap gap-2" aria-label={ariaLabel}>
        {counts.map(({ state, count }) => (
          <span key={state} className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${CHANGE_STYLES[state]}`}>
            {CHANGE_LABELS[state]} {count}
          </span>
        ))}
      </div>
      {changes.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {changes.map((change, index) => (
            <li key={`${change.state}:${change.previousTitle ?? ""}:${change.currentTitle ?? ""}:${index}`} className="rounded-lg border border-border bg-surface px-3.5 py-3">
              <div className="flex items-start gap-3">
                <span className={`mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.06em] ${CHANGE_STYLES[change.state]}`}>
                  {CHANGE_LABELS[change.state]}
                </span>
                <p className="text-sm leading-6">
                  {change.state === "updated" && change.previousTitle !== change.currentTitle ? (
                    <><span className="text-muted line-through">{change.previousTitle}</span><span className="mx-2 text-muted">→</span><strong>{change.currentTitle}</strong></>
                  ) : change.state === "updated" ? (
                    <><strong>{change.currentTitle}</strong><span className="text-muted"> · explanation updated</span></>
                  ) : (
                    <strong>{change.currentTitle ?? change.previousTitle}</strong>
                  )}
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="mt-3 text-sm text-muted">No comparable Key Findings were saved.</p>}
    </div>
  );
}

const formatPeriod = (period: { from: string; to: string; timezone: string }): string => {
  const formatter = new Intl.DateTimeFormat("en-SG", { day: "numeric", month: "short", year: "numeric", timeZone: period.timezone });
  return `${formatter.format(new Date(period.from))} – ${formatter.format(new Date(Date.parse(period.to) - 1))}`;
};

const formatValue = (value: number, unit: OverviewChangeMetric["unit"]): string => `${formatNumber(value)} ${unit}`;
const formatDelta = (value: number, unit: OverviewChangeMetric["unit"]): string => `${formatSigned(value)} ${unit}`;
const formatSigned = (value: number): string => `${value > 0 ? "+" : ""}${formatNumber(value)}`;
const formatNumber = (value: number): string => new Intl.NumberFormat("en-SG", { maximumFractionDigits: 2 }).format(value);
const messageFrom = (reason: unknown, fallback: string): string => reason instanceof Error && reason.message ? reason.message : fallback;

const CHANGE_STATES = ["retained", "updated", "new", "removed"] as const;
const CHANGE_LABELS: Record<OverviewConclusionChange["state"], string> = {
  retained: "Retained",
  updated: "Updated",
  new: "New",
  removed: "Removed",
};
const CHANGE_STYLES: Record<OverviewConclusionChange["state"], string> = {
  retained: "border-step-success/25 bg-step-success/10 text-step-success",
  updated: "border-step-warning/30 bg-step-warning/10 text-step-warning",
  new: "border-primary/25 bg-primary/10 text-primary",
  removed: "border-border bg-surface-subtle text-muted",
};

const findLatestCompatibleOverview = async (input: {
  client: OverviewChangeDialogClient;
  projectId: string;
  currentSnapshot: EnergyProjectAnalysisSnapshotDto;
  candidates: ReturnType<typeof orderPreviousOverviewCandidates>;
  isActive: () => boolean;
}): Promise<EnergySavedOverviewComparisonCandidateDto | null> => {
  const batchSize = 4;
  for (let offset = 0; offset < input.candidates.length; offset += batchSize) {
    if (!input.isActive()) return null;
    const batch = input.candidates.slice(offset, offset + batchSize);
    const details = await Promise.allSettled(batch.map((candidate) =>
      input.client.getEnergySavedAnalysis(input.projectId, candidate.id)));
    let earlierReadFailure: unknown = null;
    for (const detail of details) {
      if (detail.status === "rejected") {
        if (isLegacySavedAiPayloadError(detail.reason)) continue;
        earlierReadFailure ??= detail.reason;
        continue;
      }
      if (isCompatiblePreviousOverview(detail.value, input.currentSnapshot)) {
        if (earlierReadFailure) throw earlierReadFailure;
        return detail.value as EnergySavedOverviewComparisonCandidateDto;
      }
    }
    if (earlierReadFailure) throw earlierReadFailure;
  }
  return null;
};

const isLegacySavedAiPayloadError = (reason: unknown): boolean => reason instanceof Error
  && reason.message === "ENERGYIQ_SAVED_ANALYSIS_AI_RESULT_INVALID";

const MAX_CLIENT_COMPARISON_CANDIDATES = 40;

const focusableElements = (root: HTMLElement | null): HTMLElement[] => root
  ? Array.from(root.querySelectorAll<HTMLElement>(
      "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
    )).filter((element) => !element.hasAttribute("hidden"))
  : [];

const SECTION_LABELS = {
  "centre-benchmark": "Centre benchmark",
  "standby-wastage": "Closed-hours use",
  "operating-behaviour": "Operating-hours behaviour",
  "planning-outlook": "Planning outlook",
} as const;
