"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { NgeeAnnPeakBreakdownViewModel } from "./ngee-ann-overview-view-model";

const ALL_PROJECT = "all-project";

export function NgeeAnnPeakBreakdown({ view }: { view: NgeeAnnPeakBreakdownViewModel }) {
  const [open, setOpen] = useState(false);
  const [selectedScopeId, setSelectedScopeId] = useState(ALL_PROJECT);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const closeDialog = useCallback(() => {
    setOpen(false);
    setSelectedScopeId(ALL_PROJECT);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), summary, a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
      ) ?? []).filter((element) => !element.hasAttribute("disabled"));
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        dialogRef.current?.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeDialog, open]);

  if (view.status === "unavailable") {
    return (
      <p className="mt-3 text-[10px] font-semibold text-muted" role="status">
        Breakdown unavailable
      </p>
    );
  }

  const selectedLevel = view.levels.find((level) => level.scopeId === selectedScopeId) ?? null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="mt-3 min-h-11 rounded-lg border border-border px-3 py-2 text-[11px] font-semibold text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      >
        View peak breakdown
      </button>

      {open ? createPortal((
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/35 p-3 sm:p-6">
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ngee-ann-peak-breakdown-title"
            aria-describedby="ngee-ann-peak-breakdown-question"
            tabIndex={-1}
            className="max-h-[min(88vh,860px)] w-full max-w-4xl overflow-y-auto rounded-xl border border-border bg-surface shadow-[var(--shadow-card)] focus:outline-none"
          >
            <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-border bg-surface px-5 py-4 sm:px-6">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">15-minute Project Peak</p>
                <h2 id="ngee-ann-peak-breakdown-title" className="mt-1 text-lg font-semibold tracking-[-0.02em] text-foreground">
                  Peak interval breakdown
                </h2>
                <p id="ngee-ann-peak-breakdown-question" className="mt-1 max-w-2xl text-xs leading-5 text-muted">
                  {view.decisionQuestion}
                </p>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={closeDialog}
                className="min-h-11 shrink-0 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                Close
              </button>
            </header>

            <div className="space-y-5 px-5 py-5 sm:px-6">
              <section aria-labelledby="ngee-ann-peak-summary" className="rounded-lg border border-border bg-surface-subtle p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 id="ngee-ann-peak-summary" className="text-xs font-semibold text-foreground">{view.peakLabel}</h3>
                    <p className="mt-1 text-[11px] text-muted">{view.peakAt}</p>
                    <p className="mt-1 text-[10px] leading-4 text-muted-light">Interval {view.peakInterval}</p>
                  </div>
                  <p className="text-2xl font-semibold tabular-nums text-foreground">
                    {view.averageKw} <span className="text-xs font-medium text-muted">kW</span>
                  </p>
                </div>
                <p className="mt-3 text-[10px] leading-4 text-muted">
                  {view.quality?.statusLabel} / {view.quality?.coverage} / {view.quality?.intervals} / {view.quality?.qualityEvents}
                </p>
                {view.periodStatus === "partial" ? (
                  <p className="mt-3 rounded-lg border border-step-warning/25 bg-step-warning/5 px-3 py-2 text-[11px] leading-5 text-step-warning" role="status">
                    This Period is incomplete ({view.periodCoverage}). The value is the highest complete observed interval, not a complete-Period conclusion.
                  </p>
                ) : null}
              </section>

              <fieldset>
                <legend className="mb-2 text-[10px] font-semibold text-muted">Peak breakdown Scope</legend>
                <div className="flex flex-wrap gap-1.5">
                  <ScopeButton
                    selected={selectedScopeId === ALL_PROJECT}
                    controls="ngee-ann-peak-breakdown-panel"
                    onClick={() => setSelectedScopeId(ALL_PROJECT)}
                  >
                    All Project
                  </ScopeButton>
                  {view.levels.map((level) => (
                    <ScopeButton
                      key={level.scopeId}
                      selected={selectedScopeId === level.scopeId}
                      controls="ngee-ann-peak-breakdown-panel"
                      onClick={() => setSelectedScopeId(level.scopeId)}
                    >
                      {level.scopeName}
                    </ScopeButton>
                  ))}
                </div>
              </fieldset>

              <div id="ngee-ann-peak-breakdown-panel">
                {selectedLevel ? (
                  <LevelDetail level={selectedLevel} />
                ) : (
                  <AllProject levels={view.levels} />
                )}
              </div>

              <details className="border-t border-border pt-4 text-[10px] leading-4 text-muted">
                <summary className="cursor-pointer font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
                  Peak evidence / peak_breakdown_v1
                </summary>
                <dl className="mt-3 grid gap-x-3 gap-y-1.5 sm:grid-cols-[84px_minmax(0,1fr)]">
                  <dt>Snapshot</dt><dd className="break-all font-mono text-foreground">{view.evidence.snapshotId}</dd>
                  <dt>Release</dt><dd className="break-all font-mono text-foreground">{view.evidence.projectReleaseId}</dd>
                  <dt>Mapping</dt><dd className="break-all font-mono text-foreground">{view.evidence.meterMappingRevisionId}</dd>
                  <dt>Formula</dt><dd className="break-all font-mono text-foreground">{view.evidence.meterFormulaRevisionId}</dd>
                  <dt>Metric</dt><dd className="break-all font-mono text-foreground">{view.evidence.metricId}</dd>
                  <dt>Period</dt><dd className="break-words text-foreground">{view.evidence.period}</dd>
                  <dt>Timezone</dt><dd className="text-foreground">{view.evidence.timezone}</dd>
                  <dt>Unit</dt><dd className="text-foreground">{view.evidence.unit}</dd>
                  <dt>Query</dt><dd className="break-all font-mono text-foreground">{view.evidence.queryIds.join(", ")}</dd>
                </dl>
              </details>
            </div>
          </div>
        </div>
      ), document.body) : null}
    </>
  );
}

function ScopeButton({
  selected,
  controls,
  onClick,
  children,
}: {
  selected: boolean;
  controls: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-controls={controls}
      onClick={onClick}
      className={selected
        ? "min-h-11 rounded-lg border border-primary bg-primary/10 px-3 py-2 text-[11px] font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        : "min-h-11 rounded-lg border border-border px-3 py-2 text-[11px] font-semibold text-muted hover:bg-surface-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"}
    >
      {children}
    </button>
  );
}

function AllProject({ levels }: { levels: NgeeAnnPeakBreakdownViewModel["levels"] }) {
  return (
    <section aria-labelledby="ngee-ann-all-project-peak">
      <div>
        <h3 id="ngee-ann-all-project-peak" className="text-sm font-semibold text-foreground">Level contributions at the same Project Peak interval</h3>
        <p className="mt-1 text-[11px] leading-5 text-muted">Official Published Level routes reconcile to the Project Peak.</p>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {levels.map((level) => (
          <article key={level.scopeId} className="rounded-lg border border-border p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-foreground">{level.scopeName}</p>
                <p className="mt-1 text-[10px] text-muted">{level.sharePct} of Project Peak</p>
              </div>
              <p className="text-lg font-semibold tabular-nums text-foreground">
                {level.averageKw} <span className="text-[10px] font-medium text-muted">kW</span>
              </p>
            </div>
            <p className="mt-3 text-[10px] leading-4 text-muted">
              {level.quality.statusLabel} / {level.quality.coverage} / {level.quality.intervals} / {level.quality.qualityEvents}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

function LevelDetail({ level }: { level: NgeeAnnPeakBreakdownViewModel["levels"][number] }) {
  return (
    <section aria-labelledby={`ngee-ann-peak-${level.scopeId}`}>
      <div className="rounded-lg border border-border p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 id={`ngee-ann-peak-${level.scopeId}`} className="text-sm font-semibold text-foreground">{level.scopeName} official contribution</h3>
            <p className="mt-1 text-[11px] text-muted">{level.sharePct} of the Project Peak at the same interval</p>
          </div>
          <p className="text-xl font-semibold tabular-nums text-foreground">
            {level.averageKw} <span className="text-xs font-medium text-muted">kW</span>
          </p>
        </div>
        <p className="mt-3 text-[10px] leading-4 text-muted">
          {level.quality.statusLabel} / {level.quality.coverage} / {level.quality.intervals} / {level.quality.qualityEvents}
        </p>
      </div>

      <details key={level.scopeId} className="mt-4 border-t border-border pt-4">
        <summary className="cursor-pointer text-xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
          Circuit evidence ({level.circuits.length})
        </summary>
        <div className="mt-3">
          <p className="text-[11px] leading-5 text-muted">
            Same-interval server facts in server order. Explanatory only; component Circuits are not added to the official Level or Project Peak.
          </p>
          {level.circuits.length > 0 ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[680px] border-collapse text-left text-[10px]">
                <thead>
                  <tr className="border-y border-border text-muted">
                    <th className="py-2 pr-3 font-semibold">Circuit</th>
                    <th className="px-3 py-2 font-semibold">Category</th>
                    <th className="px-3 py-2 text-right font-semibold">Average</th>
                    <th className="px-3 py-2 text-right font-semibold">Level share</th>
                    <th className="py-2 pl-3 font-semibold">Interval health</th>
                  </tr>
                </thead>
                <tbody>
                  {level.circuits.map((circuit) => (
                    <tr key={circuit.meterNodeId} data-peak-circuit-row className="border-b border-border align-top">
                      <td className="py-3 pr-3">
                        <p className="font-semibold text-foreground">{circuit.name}</p>
                        <p className="mt-1 break-all font-mono text-muted-light">{circuit.meterNodeId}</p>
                      </td>
                      <td className="px-3 py-3 text-muted">{circuit.category}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-foreground">
                        {circuit.averageKw === null ? "Unavailable" : `${circuit.averageKw} kW`}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-foreground">
                        {circuit.sharePct ?? "Unavailable"}
                      </td>
                      <td className="py-3 pl-3 text-muted">
                        {circuit.quality.statusLabel} / {circuit.quality.coverage}<br />
                        {circuit.quality.intervals} / {circuit.quality.qualityEvents}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-3 rounded-lg border border-border bg-surface-subtle px-3 py-3 text-[11px] text-muted" role="status">
              Circuit evidence unavailable for this Level.
            </p>
          )}
        </div>
      </details>
    </section>
  );
}
