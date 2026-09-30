"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { NgeeAnnHourAxis } from "./ngee-ann-hour-axis";
import type { NgeeAnnTrendDayType } from "./ngee-ann-energy-trend";
import type { NgeeAnnDailyAnomalyViewModel } from "./ngee-ann-overview-view-model";
import { anomalyIncidentDomId } from "./ngee-ann-overview-links";

type Incident = NgeeAnnDailyAnomalyViewModel["incidents"][number];
type Series = Incident["series"][number];
type ViewMode = "overlay" | "selected" | "average";

const ALL_SCOPES = "all-scopes";

export const NGEE_ANN_OPEN_INCIDENT_EVENT = "energyiq:ngee-ann-open-incident";

export type NgeeAnnOpenIncidentEventDetail = {
  incidentId: string;
  trigger: HTMLElement;
};

export function NgeeAnnDailyAnomalies({
  view,
  selectedScopeId: listScopeId,
  selectedDayType: listDayType,
  comparison = "overlay",
  category = "all",
  onComparisonChange,
  onCategoryChange,
}: {
  view: NgeeAnnDailyAnomalyViewModel;
  selectedScopeId?: string;
  selectedDayType?: NgeeAnnTrendDayType;
  comparison?: ViewMode;
  category?: "all" | "load" | "light";
  onComparisonChange?: (comparison: ViewMode) => void;
  onCategoryChange?: (category: "all" | "load" | "light") => void;
}) {
  const [openIncidentId, setOpenIncidentId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(comparison);
  const [selectedScopeId, setSelectedScopeId] = useState(ALL_SCOPES);
  const [selectedCategory, setSelectedCategory] = useState<"all" | "load" | "light">(category);
  const triggerRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const closeDialog = useCallback(() => {
    setOpenIncidentId(null);
    setViewMode(comparison);
    setSelectedScopeId(ALL_SCOPES);
    setSelectedCategory(category);
    triggerRef.current?.focus();
  }, [category, comparison]);

  useEffect(() => {
    if (openIncidentId) return;
    setViewMode(comparison);
    setSelectedCategory(category);
  }, [category, comparison, openIncidentId]);

  useEffect(() => {
    const openRequestedIncident = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const detail = event.detail as Partial<NgeeAnnOpenIncidentEventDetail> | null;
      if (!detail
        || typeof detail.incidentId !== "string"
        || !(detail.trigger instanceof HTMLElement)
        || !view.incidents.some((candidate) => candidate.incidentId === detail.incidentId)) return;
      event.preventDefault();
      triggerRef.current = detail.trigger;
      setOpenIncidentId(detail.incidentId);
    };
    document.addEventListener(NGEE_ANN_OPEN_INCIDENT_EVENT, openRequestedIncident);
    return () => document.removeEventListener(NGEE_ANN_OPEN_INCIDENT_EVENT, openRequestedIncident);
  }, [view.incidents]);

  useEffect(() => {
    if (!openIncidentId) return;
    closeRef.current?.focus();
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), summary, a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
      ));
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [closeDialog, openIncidentId]);

  if (view.status === "unavailable") {
    return (
      <section aria-labelledby="ngee-ann-daily-anomalies" className="border-b border-border px-5 py-7 lg:px-7 lg:py-8">
        <h3 id="ngee-ann-daily-anomalies" className="text-lg font-semibold tracking-[-0.015em] text-foreground">
          Detected Anomaly List
        </h3>
        <p className="mt-1.5 text-sm leading-6 text-muted">{view.decisionQuestion}</p>
        <div className="mt-4 rounded-lg border border-border bg-surface-subtle px-4 py-4" role="status">
          <p className="text-sm font-semibold text-foreground">Usage exception analysis unavailable</p>
          <p className="mt-1 text-sm leading-6 text-muted">{view.reason}</p>
        </div>
      </section>
    );
  }

  const incident = view.incidents.find((candidate) => candidate.incidentId === openIncidentId) ?? null;
  const visibleIncidents = view.incidents.filter((candidate) => (
    (!listScopeId || candidate.scopeId === listScopeId)
    && (!listDayType || candidate.dayType.toLowerCase() === listDayType)
  ));
  const openIncident = (incidentId: string, trigger: HTMLElement) => {
    triggerRef.current = trigger;
    setOpenIncidentId(incidentId);
  };

  return (
    <section id="ngee-ann-detected-anomaly-list" aria-labelledby="ngee-ann-daily-anomalies" className="scroll-mt-28 border-b border-border px-5 py-7 lg:px-7 lg:py-8">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <h3 id="ngee-ann-daily-anomalies" className="text-lg font-semibold tracking-[-0.015em] text-foreground">
            Detected Anomaly List
          </h3>
          <p className="mt-1.5 text-sm leading-6 text-muted">
            Open a flagged day to compare its accepted 24-hour Circuit evidence with the frozen comparable-day baseline.
          </p>
        </div>
        {visibleIncidents.length > 0 ? (
          <span className="w-fit rounded-full bg-step-warning/10 px-3 py-1.5 text-xs font-semibold text-step-warning">
            {visibleIncidents.length} detected {visibleIncidents.length === 1 ? "anomaly" : "anomalies"}
          </span>
        ) : null}
      </div>

      {visibleIncidents.length > 0 ? (
        <>
          <p className="mt-4 text-sm text-muted">
            Detected anomalies: <span className="font-semibold tabular-nums text-foreground">{visibleIncidents.length}</span>
            {listDayType ? ` / ${listDayType === "public_holiday" ? "Holiday" : `${listDayType.charAt(0).toUpperCase()}${listDayType.slice(1)}`} days` : ""}
          </p>
          <div className="mt-3 overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[860px] border-collapse text-left text-sm">
              <caption className="sr-only">Detected anomalies for the selected Day Type and Scope</caption>
              <thead className="bg-surface-subtle text-xs text-muted">
                <tr>
                  <th className="px-3 py-3 font-semibold">Date</th>
                  <th className="px-3 py-3 font-semibold">Type</th>
                  <th className="px-3 py-3 text-right font-semibold">Daily total</th>
                  <th className="px-3 py-3 text-right font-semibold">Expected</th>
                  <th className="px-3 py-3 text-right font-semibold">Threshold</th>
                  <th className="px-3 py-3 font-semibold">Level totals (kWh)</th>
                  <th className="px-3 py-3 text-right font-semibold">Delta</th>
                  <th className="px-3 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visibleIncidents.map((item) => (
                  <tr
                    key={item.incidentId}
                    tabIndex={0}
                    role="button"
                    aria-expanded={item.incidentId === openIncidentId}
                    aria-controls="ngee-ann-anomaly-dialog"
                    aria-label={`Open anomaly detail for ${item.scopeName}, ${item.weekday} ${item.dateLabel}`}
                    data-template-anomaly-trigger="true"
                    className="cursor-pointer bg-surface hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30"
                    onClick={(event) => openIncident(item.incidentId, event.currentTarget)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      openIncident(item.incidentId, event.currentTarget);
                    }}
                  >
                    <td className="whitespace-nowrap px-3 py-3 font-semibold text-foreground">{item.dateLabel} {item.weekday}</td>
                    <td className="px-3 py-3 text-muted">{item.dayType}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-foreground">{formatKwhNumber(item.actualKwhValue)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted">{formatKwhNumber(item.baselineKwhValue)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted">{formatKwhNumber(item.thresholdKwhValue)}</td>
                    <td className="px-3 py-3 text-xs tabular-nums text-muted">{levelTotalsLabel(item)}</td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums text-step-warning">{formatSignedPercent(item.relativePctValue)}</td>
                    <td className="px-3 py-3"><span className="rounded-md bg-step-warning/10 px-2 py-1 text-xs font-semibold text-step-warning">Anomaly</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <details className="mt-5 rounded-lg border border-border bg-surface-subtle/50 px-4 py-3">
            <summary className="cursor-pointer text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
              View all {view.incidents.length} flagged checks
            </summary>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              Complete audit list in the published server order. Open a row only when you need its 24-hour comparison and frozen Evidence.
            </p>
            <div className="mt-3 divide-y divide-border border-y border-border bg-surface">
              {view.incidents.map((item) => (
                <button
                  key={item.incidentId}
                  id={anomalyIncidentDomId(item.incidentId)}
                  type="button"
                  data-anomaly-trigger="true"
                  aria-expanded={item.incidentId === openIncidentId}
                  aria-controls="ngee-ann-anomaly-dialog"
                  onClick={(event) => openIncident(item.incidentId, event.currentTarget)}
                  className="grid min-h-14 w-full scroll-mt-24 gap-1 px-3 py-3 text-left hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30 sm:grid-cols-[minmax(10rem,1fr)_minmax(11rem,1fr)_auto] sm:items-center sm:gap-4"
                >
                  <span>
                    <span className="block text-sm font-semibold text-foreground">{item.scopeName}</span>
                    <span className="mt-0.5 block text-xs text-muted">{item.weekday} {item.dateLabel} · {item.dayType}</span>
                  </span>
                  <span className="text-xs tabular-nums text-muted">Actual {formatKwh(item.actualKwhValue)} · baseline {formatKwh(item.baselineKwhValue)}</span>
                  <span className="text-sm font-semibold tabular-nums text-primary">{formatSignedKwh(item.impactKwhValue)}</span>
                </button>
              ))}
            </div>
          </details>
        </>
      ) : (
        <div className="mt-4 rounded-lg border border-border bg-surface-subtle px-4 py-4" role="status">
          <p className="text-sm font-semibold text-foreground">
            {view.incidents.length > 0
              ? "No detected anomaly matches the selected Day Type and Scope"
              : view.allSuppressed
              ? "No daily check was eligible for a conclusion"
              : view.outcomeSummary.suppressed > 0
                ? "No confirmed exception; some daily checks remain inconclusive"
                : "No daily usage exception crossed the published rule"}
          </p>
          <p className="mt-1 text-sm leading-6 text-muted">
            {view.incidents.length > 0
              ? "Choose another Day Type or Scope to inspect the remaining server-triggered records."
              : view.allSuppressed
              ? "Coverage, quality, Calendar or comparable-day gates prevented a trustworthy conclusion for every check."
              : view.outcomeSummary.suppressed > 0
                ? "Checks that passed the rule stayed within threshold; suppressed checks are not being described as normal."
                : "No eligible Project or Level day crossed both the published relative and absolute thresholds."}
          </p>
        </div>
      )}

      {incident && typeof document !== "undefined" ? createPortal(
        <div className="fixed inset-0 z-50 grid items-center overflow-y-auto bg-foreground/40 p-3 backdrop-blur-[1px] sm:p-6">
          <div
            ref={dialogRef}
            id="ngee-ann-anomaly-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ngee-ann-anomaly-dialog-title"
            aria-describedby="ngee-ann-anomaly-dialog-question"
            className="mx-auto max-h-[calc(100dvh-1.5rem)] w-full max-w-6xl overflow-y-auto rounded-xl border border-primary/25 bg-surface shadow-[var(--shadow-card)] sm:max-h-[calc(100dvh-3rem)]"
          >
          <header className="flex items-start justify-between gap-4 border-b border-border bg-surface-subtle px-4 py-4 sm:px-5">
            <div>
              <h2 id="ngee-ann-anomaly-dialog-title" className="text-lg font-semibold tracking-[-0.02em] text-foreground">
                Anomaly Detail — {incident.dateLabel} {incident.weekday}
              </h2>
              <p id="ngee-ann-anomaly-dialog-question" className="mt-1 max-w-3xl text-sm leading-6 text-muted">
                {formatSignedPercent(incident.relativePctValue)} vs {incident.dayType.toLowerCase()} baseline · {incident.scopeName}
              </p>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={closeDialog}
              className="min-h-11 shrink-0 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            >
              Close
            </button>
          </header>

          <div className="space-y-5 px-4 py-5 sm:px-5">
            <div className="grid gap-4 lg:grid-cols-3">
              <fieldset>
                <legend className="mb-2 text-xs font-semibold text-muted">Comparison view</legend>
                <div className="flex flex-wrap gap-1.5">
                  {(["overlay", "selected", "average"] as const).map((mode) => (
                    <FilterButton
                      key={mode}
                      selected={viewMode === mode}
                      controls="ngee-ann-anomaly-heatmap"
                      onClick={() => {
                        setViewMode(mode);
                        onComparisonChange?.(mode);
                      }}
                    >
                      {mode === "overlay" ? "Overlay comparison" : mode === "selected" ? "Selected day" : "Comparable-day average"}
                    </FilterButton>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="mb-2 text-xs font-semibold text-muted">Scope</legend>
                <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                  <FilterButton selected={selectedScopeId === ALL_SCOPES} controls="ngee-ann-anomaly-heatmap" onClick={() => setSelectedScopeId(ALL_SCOPES)}>
                    All
                  </FilterButton>
                  {seriesScopeOptions(incident.series).map((scope) => (
                    <FilterButton key={scope.id} selected={selectedScopeId === scope.id} controls="ngee-ann-anomaly-heatmap" onClick={() => setSelectedScopeId(scope.id)}>
                      {scope.name}
                    </FilterButton>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="mb-2 text-xs font-semibold text-muted">Category</legend>
                <div className="flex flex-wrap gap-1.5">
                  {(["all", "load", "light"] as const).map((seriesCategory) => (
                    <FilterButton
                      key={seriesCategory}
                      selected={selectedCategory === seriesCategory}
                      controls="ngee-ann-anomaly-heatmap"
                      onClick={() => {
                        setSelectedCategory(seriesCategory);
                        onCategoryChange?.(seriesCategory);
                      }}
                    >
                      {seriesCategory === "all" ? "All" : seriesCategory === "load" ? "Load" : "Light"}
                    </FilterButton>
                  ))}
                </div>
              </fieldset>
            </div>

            <IncidentDeviationHeatmap
              incident={incident}
              viewMode={viewMode}
              selectedScopeId={selectedScopeId}
              selectedCategory={selectedCategory}
            />

            <details className="rounded-lg border border-border bg-surface-subtle/50 px-4 py-3">
              <summary className="cursor-pointer text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
                Hourly series evidence
              </summary>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
                Supporting bar views retain every accepted server point without adding Circuit totals in React.
              </p>
              <div className="mt-4">
                <IncidentSeries
                  incident={incident}
                  viewMode={viewMode}
                  selectedScopeId={selectedScopeId}
                  selectedCategory={selectedCategory}
                />
              </div>
            </details>

            <IncidentEvidence incident={incident} view={view} />
          </div>
          </div>
        </div>,
        document.body,
      ) : null}

      <AnomalyEvidence view={view} />
    </section>
  );
}

function IncidentSeries({
  incident,
  viewMode,
  selectedScopeId,
  selectedCategory,
}: {
  incident: Incident;
  viewMode: ViewMode;
  selectedScopeId: string;
  selectedCategory: "all" | "load" | "light";
}) {
  const visible = filterIncidentSeries(incident, selectedScopeId, selectedCategory);
  return (
    <section id="ngee-ann-anomaly-series" aria-labelledby="ngee-ann-anomaly-series-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 id="ngee-ann-anomaly-series-heading" className="text-sm font-semibold text-foreground">24-hour incident evidence</h3>
          <p className="mt-1 text-sm leading-6 text-muted">
            {viewMode === "overlay" ? "Selected and baseline" : viewMode === "selected" ? "Selected day only" : "Frozen baseline average only"}; server series remain in server order.
          </p>
        </div>
        <span className="text-xs text-muted">{visible.length} evidence series</span>
      </div>
      {visible.length > 0 ? (
        <div className="mt-4 space-y-4">
          {visible.map((series) => <SeriesChart key={series.seriesId} series={series} viewMode={viewMode} />)}
        </div>
      ) : (
        <p className="mt-4 rounded-lg border border-border bg-surface-subtle px-4 py-4 text-sm text-muted" role="status">
          No server series matches this Scope and Category selection.
        </p>
      )}
    </section>
  );
}

function SeriesChart({ series, viewMode }: { series: Series; viewMode: ViewMode }) {
  const [activeHour, setActiveHour] = useState<number | null>(null);
  let maximum = 0;
  for (const point of series.points) {
    if (viewMode !== "average" && point.selectedKwh !== null && point.selectedKwh > maximum) maximum = point.selectedKwh;
    if (viewMode !== "selected" && point.baselineKwh !== null && point.baselineKwh > maximum) maximum = point.baselineKwh;
  }
  const active = activeHour === null ? null : series.points[activeHour] ?? null;
  return (
    <article className="rounded-lg border border-border p-4" data-anomaly-series={series.seriesId}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold text-foreground">{series.scopeName}</p>
          <p className="mt-1 text-[10px] text-muted">
            {series.relationship.replaceAll("_", " ")} / {series.categoryLabel ?? "Official Scope"} / {series.statusLabel}
          </p>
          {series.kind === "component_circuit" ? (
            <p className="mt-1 text-[10px] font-semibold text-step-warning">Explanatory component · not included in the official total</p>
          ) : (
            <p className="mt-1 text-[10px] text-muted-light">Official Scope series · included in the official total</p>
          )}
        </div>
        <p className="text-[10px] text-muted">{series.coverage} / {series.intervals} / {series.qualityEvents}</p>
      </div>

      {series.status === "unavailable" ? (
        <p className="mt-3 rounded-lg border border-border bg-surface-subtle px-3 py-3 text-[11px] text-muted" role="status">
          This server series is unavailable; no chart value is inferred.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto pb-1">
          <div className="min-w-[1040px]">
            <div data-hour-plot="anomaly-series" className="grid h-44 items-end gap-1 border-b border-border px-2" style={{ gridTemplateColumns: "repeat(24, minmax(32px, 1fr))" }}>
              {series.points.map((point) => (
                <button
                  key={point.localHour}
                  type="button"
                  aria-label={seriesPointLabel(series, point, viewMode)}
                  className="group flex h-full items-end justify-center rounded-t px-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  onMouseEnter={() => setActiveHour(point.localHour)}
                  onMouseLeave={() => setActiveHour(null)}
                  onFocus={() => setActiveHour(point.localHour)}
                  onBlur={() => setActiveHour(null)}
                >
                  <span className="flex h-full min-h-0 items-end justify-center gap-px">
                    {viewMode !== "average" ? (
                      <ChartBar value={point.selectedKwh} maximum={maximum} tone="selected" />
                    ) : null}
                    {viewMode !== "selected" ? (
                      <ChartBar value={point.baselineKwh} maximum={maximum} tone="baseline" />
                    ) : null}
                  </span>
                </button>
              ))}
            </div>
            <NgeeAnnHourAxis points={series.points} axis="anomaly-series" />
          </div>
        </div>
      )}

      <div className="mt-3 min-h-14 rounded-lg bg-surface-subtle px-3 py-2" aria-live="polite" aria-atomic="true">
        {active ? (
          <p className="text-xs leading-5 text-muted">
            <span className="font-semibold text-foreground">{active.hourLabel}</span>
            {viewMode !== "average" ? ` / Selected ${formatChartValue(active.selectedKwh)}` : ""}
            {viewMode !== "selected" ? ` / Average ${formatChartValue(active.baselineKwh)}` : ""}
            {viewMode !== "overlay" || active.impactKwh === null
              ? ""
              : ` / Impact ${active.impactKwh >= 0 ? "+" : ""}${active.impactKwh.toFixed(4)} kWh`}
          </p>
        ) : (
          <p className="text-xs leading-5 text-muted">Hover or keyboard-focus an hour for the exact server points.</p>
        )}
      </div>
    </article>
  );
}

function ChartBar({ value, maximum, tone }: { value: number | null; maximum: number; tone: "selected" | "baseline" }) {
  if (value === null || maximum <= 0) return <span className="mb-1 h-1 w-2 border-b border-dashed border-border" aria-hidden="true" />;
  const height = Math.max(4, value / maximum * 100);
  return <span className={tone === "selected" ? "w-2 rounded-t bg-primary" : "w-2 rounded-t bg-step-warning/70"} style={{ height: `${height}%` }} aria-hidden="true" />;
}

function IncidentEvidence({ incident, view }: { incident: Incident; view: NgeeAnnDailyAnomalyViewModel }) {
  return (
    <details className="border-t border-border pt-4 text-[10px] leading-4 text-muted">
      <summary className="cursor-pointer font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
        Incident evidence / time_slot_anomaly_v1
      </summary>
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <dl className="grid gap-x-3 gap-y-1.5 sm:grid-cols-[92px_minmax(0,1fr)]">
          <dt>Incident</dt><dd className="break-all font-mono text-foreground">{incident.incidentId}</dd>
          <dt>Anomaly</dt><dd className="break-all font-mono text-foreground">{incident.anomalyId}</dd>
          <dt>Snapshot</dt><dd className="break-all font-mono text-foreground">{view.evidence.snapshotId}</dd>
          <dt>Bundle</dt><dd className="break-all font-mono text-foreground">{view.evidence.bundleId}</dd>
          <dt>Rule</dt><dd className="break-all font-mono text-foreground">{view.rule?.ruleRevisionId}</dd>
          <dt>Metric / Query</dt><dd className="break-all font-mono text-foreground">{view.evidence.metricId} / {view.evidence.queryIds[0]}</dd>
        </dl>
        <div>
          <p className="font-semibold text-foreground">Eligible comparable dates ({incident.baselineSamples.length})</p>
          <ul className="mt-2 space-y-1.5">
            {incident.baselineSamples.map((sample) => (
              <li key={sample.localDate} className="rounded-md bg-surface-subtle px-2 py-1.5">
                {sample.localDate} / {sample.coverage} / {sample.intervals} / {sample.qualityEvents}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </details>
  );
}

function AnomalyEvidence({ view }: { view: NgeeAnnDailyAnomalyViewModel }) {
  return (
    <details className="mt-5 border-t border-border pt-4 text-[10px] leading-4 text-muted">
      <summary className="cursor-pointer text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
        How these exceptions were selected
      </summary>
      <p className="mt-3 max-w-3xl text-xs leading-5 text-muted">
        {view.outcomeSummary.triggered} checks crossed both published thresholds; {view.outcomeSummary.withinThreshold} stayed within threshold; {view.outcomeSummary.suppressed} could not be classified. Suppressed checks are not counted as normal.
      </p>
      <dl className="mt-2 grid gap-x-3 gap-y-1 sm:grid-cols-[104px_minmax(0,1fr)]">
        <dt>Snapshot</dt><dd className="break-all font-mono text-foreground">{view.evidence.snapshotId}</dd>
        <dt>Release</dt><dd className="break-all font-mono text-foreground">{view.evidence.projectReleaseId}</dd>
        <dt>Bundle</dt><dd className="break-all font-mono text-foreground">{view.evidence.bundleId}</dd>
        <dt>Rule</dt><dd className="break-all font-mono text-foreground">{view.rule?.ruleRevisionId}</dd>
        <dt>Calendar</dt><dd className="break-all font-mono text-foreground">{view.evidence.businessCalendarVersion}</dd>
        <dt>Baseline cutoff</dt><dd className="font-mono text-foreground">{view.rule?.baselineCutoff}</dd>
        <dt>Baseline method</dt><dd className="break-all font-mono text-foreground">{view.rule?.baselineMethod}</dd>
        <dt>Thresholds</dt><dd className="text-foreground">{view.rule?.relativeThresholdPct} and {view.rule?.absoluteImpactKwh}</dd>
        <dt>Quality gates</dt><dd className="text-foreground">{view.rule?.minimumCoveragePct} minimum coverage / {view.rule?.minimumSampleCount} samples / at most {view.rule?.maximumQualityEventCount} quality events</dd>
        <dt>Period</dt><dd className="break-words text-foreground">{view.evidence.period}</dd>
        <dt>Timezone</dt><dd className="text-foreground">{view.evidence.timezone}</dd>
      </dl>
    </details>
  );
}

function FilterButton({ selected, controls, onClick, children }: {
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
        ? "min-h-11 rounded-lg border border-primary bg-primary/10 px-3 py-2 text-xs font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        : "min-h-11 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted hover:bg-surface-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"}
    >
      {children}
    </button>
  );
}

function seriesScopeOptions(series: Series[]): Array<{ id: string; name: string }> {
  const seen = new Set<string>();
  const options: Array<{ id: string; name: string }> = [];
  for (const item of series) {
    if (seen.has(item.scopeId)) continue;
    seen.add(item.scopeId);
    options.push({ id: item.scopeId, name: item.scopeName });
  }
  return options;
}

function heatmapMagnitudeClass(value: number | null, maximum: number, viewMode: ViewMode): string {
  if (value === null || maximum <= 0) return "bg-surface-subtle text-muted-light";
  const ratio = Math.abs(value) / maximum;
  if (viewMode === "overlay" && value > 0) {
    if (ratio >= 0.75) return "bg-step-warning text-white";
    if (ratio >= 0.5) return "bg-step-warning/70 text-white";
    if (ratio >= 0.25) return "bg-step-warning/35 text-foreground";
    if (ratio >= 0.1) return "bg-step-warning/15 text-foreground";
  }
  if (ratio >= 0.75) return "bg-primary text-white";
  if (ratio >= 0.5) return "bg-primary/70 text-white";
  if (ratio >= 0.25) return "bg-primary/35 text-foreground";
  if (ratio >= 0.1) return "bg-primary/15 text-foreground";
  return "bg-surface text-muted";
}

function heatmapPointLabel(series: Series, point: Series["points"][number], viewMode: ViewMode): string {
  if (viewMode === "selected") return `${series.scopeName}, ${point.hourLabel}: selected ${formatChartValue(point.selectedKwh)}`;
  if (viewMode === "average") return `${series.scopeName}, ${point.hourLabel}: comparable-day average ${formatChartValue(point.baselineKwh)}`;
  return `${series.scopeName}, ${point.hourLabel}: selected ${formatChartValue(point.selectedKwh)}; average ${formatChartValue(point.baselineKwh)}; difference ${formatChartValue(point.impactKwh)}`;
}

function formatHeatmapValue(value: number | null, signed: boolean): string {
  if (value === null) return "—";
  const rounded = new Intl.NumberFormat("en-SG", { maximumFractionDigits: 2 }).format(Math.abs(value));
  if (!signed) return rounded;
  if (value > 0) return `+${rounded}`;
  if (value < 0) return `−${rounded}`;
  return "0";
}

function seriesPointLabel(series: Series, point: Series["points"][number], viewMode: ViewMode): string {
  const selected = viewMode === "average" ? "" : `; selected ${formatChartValue(point.selectedKwh)}`;
  const average = viewMode === "selected" ? "" : `; average ${formatChartValue(point.baselineKwh)}`;
  return `${series.scopeName} ${point.hourLabel}${selected}${average}; ${series.statusLabel}`;
}

function formatChartValue(value: number | null): string {
  return value === null ? "unavailable" : `${value.toFixed(4)} kWh`;
}

function formatKwh(value: number): string {
  return `${new Intl.NumberFormat("en-SG", { maximumFractionDigits: 1 }).format(value)} kWh`;
}

function formatKwhNumber(value: number): string {
  return new Intl.NumberFormat("en-SG", { maximumFractionDigits: 1 }).format(value);
}

function IncidentDeviationHeatmap({
  incident,
  viewMode,
  selectedScopeId,
  selectedCategory,
}: {
  incident: Incident;
  viewMode: ViewMode;
  selectedScopeId: string;
  selectedCategory: "all" | "load" | "light";
}) {
  const visibleSeries = filterIncidentSeries(incident, selectedScopeId, selectedCategory)
    .filter((series) => series.status !== "unavailable");
  const pointValue = (point: Series["points"][number]) => (
    viewMode === "selected" ? point.selectedKwh : viewMode === "average" ? point.baselineKwh : point.impactKwh
  );
  const maximumValue = Math.max(
    0,
    ...visibleSeries.flatMap((series) => series.points.map((point) => Math.abs(pointValue(point) ?? 0))),
  );
  return (
    <section id="ngee-ann-anomaly-heatmap" aria-labelledby="ngee-ann-anomaly-heatmap-heading" data-anomaly-detail-heatmap="true">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 id="ngee-ann-anomaly-heatmap-heading" className="text-sm font-semibold text-foreground">
            {viewMode === "overlay" ? "24-hour deviation heatmap" : viewMode === "selected" ? "Selected-day 24-hour heatmap" : "Comparable-day average heatmap"}
          </h3>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
            {viewMode === "overlay"
              ? "Each cell is accepted selected-day kWh minus the frozen comparable-day average. Warm colour is above the reference; blue is below it."
              : viewMode === "selected"
                ? "Each cell is the accepted selected-day server value in kWh."
                : "Each cell is the frozen comparable-day average server value in kWh."} Colour supports comparison only; it does not prove cause or success.
          </p>
        </div>
        <span className="text-xs text-muted">{visibleSeries.length} server series</span>
      </div>
      {visibleSeries.length > 0 ? (
        <div className="mt-3 overflow-x-auto rounded-lg border border-border pb-1">
          <div className="min-w-[1120px]">
            <div className="grid grid-cols-[220px_repeat(24,minmax(34px,1fr))] gap-px bg-border p-px text-[10px]">
              <div className="sticky left-0 z-[2] bg-surface-subtle px-3 py-2 font-semibold text-muted">Scope / Circuit</div>
              {Array.from({ length: 24 }, (_, hour) => (
                <div key={hour} className="bg-surface-subtle px-1 py-2 text-center tabular-nums text-muted">{String(hour).padStart(2, "0")}</div>
              ))}
              {visibleSeries.flatMap((series) => [
                <div key={`${series.seriesId}:label`} className="sticky left-0 z-[1] min-w-0 bg-surface px-3 py-2">
                  <span className="block truncate font-semibold text-foreground" title={series.scopeName}>{series.scopeName}</span>
                  <span className="mt-0.5 block truncate text-muted">{series.categoryLabel ?? "Official Scope"}</span>
                </div>,
                ...series.points.map((point) => (
                  <button
                    key={`${series.seriesId}:${point.localHour}`}
                    type="button"
                    title={heatmapPointLabel(series, point, viewMode)}
                    aria-label={heatmapPointLabel(series, point, viewMode)}
                    className={`${heatmapMagnitudeClass(pointValue(point), maximumValue, viewMode)} min-h-10 px-1 text-center tabular-nums focus-visible:relative focus-visible:z-[3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40`}
                  >
                    {formatHeatmapValue(pointValue(point), viewMode === "overlay")}
                  </button>
                )),
              ])}
            </div>
          </div>
        </div>
      ) : (
        <p className="mt-3 rounded-lg border border-border bg-surface-subtle px-4 py-3 text-sm text-muted" role="status">
          No accepted hourly series is available for this incident.
        </p>
      )}
    </section>
  );
}

function filterIncidentSeries(
  incident: Incident,
  selectedScopeId: string,
  selectedCategory: "all" | "load" | "light",
): Series[] {
  return incident.series.filter((series) => (
    (selectedScopeId === ALL_SCOPES || series.scopeId === selectedScopeId)
    && (selectedCategory === "all" || series.category === selectedCategory)
  ));
}

function levelTotalsLabel(incident: Incident): string {
  if (incident.relatedLevelTotals.length === 0) return "Not applicable for this Scope";
  return incident.relatedLevelTotals
    .map((level) => `${level.scopeName}: ${level.selectedKwh === null ? "Unavailable" : level.selectedKwh}`)
    .join(" / ");
}

function formatSignedKwh(value: number): string {
  const magnitude = formatKwh(Math.abs(value));
  if (value > 0) return `+${magnitude}`;
  if (value < 0) return `-${magnitude}`;
  return magnitude;
}

function formatSignedPercent(value: number): string {
  const magnitude = new Intl.NumberFormat("en-SG", { maximumFractionDigits: 1 }).format(Math.abs(value));
  if (value > 0) return `+${magnitude}%`;
  if (value < 0) return `-${magnitude}%`;
  return `${magnitude}%`;
}
