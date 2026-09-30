"use client";

import React, { useState } from "react";

import { NgeeAnnHourAxis } from "./ngee-ann-hour-axis";
import { anomalyIncidentDomId } from "./ngee-ann-overview-links";
import type { NgeeAnnEnergyTrendViewModel } from "./ngee-ann-overview-view-model";

export type NgeeAnnTrendDayType = "weekday" | "weekend" | "public_holiday";

export function NgeeAnnEnergyTrend({
  view,
  selectedScopeId: controlledScopeId,
  selectedDayType,
  onScopeChange,
  onDayTypeChange,
}: {
  view: NgeeAnnEnergyTrendViewModel;
  selectedScopeId?: string;
  selectedDayType?: NgeeAnnTrendDayType;
  onScopeChange?: (scopeId: string) => void;
  onDayTypeChange?: (dayType: NgeeAnnTrendDayType) => void;
}) {
  const [internalScopeId, setInternalScopeId] = useState(view.scopes[0]?.id ?? "");
  const [activePointId, setActivePointId] = useState<string | null>(null);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);

  if (view.status === "unavailable") {
    return (
      <section aria-labelledby="ngee-ann-energy-trend" className="border-b border-border px-5 py-5 lg:px-7 lg:py-6">
        <h3 id="ngee-ann-energy-trend" className="text-lg font-semibold tracking-[-0.015em] text-foreground">
          Daily Total Trend
        </h3>
        <p className="mt-1.5 text-sm leading-6 text-muted">{view.decisionQuestion}</p>
        <div className="mt-4 rounded-lg border border-border bg-surface-subtle px-4 py-4" role="status">
          <p className="text-xs font-semibold text-foreground">Energy trend unavailable</p>
          <p className="mt-1 text-sm leading-6 text-muted">{view.reason}</p>
        </div>
      </section>
    );
  }

  const selectedScopeId = controlledScopeId ?? internalScopeId;
  const selectedScope = view.scopes.find((scope) => scope.id === selectedScopeId) ?? view.scopes[0]!;
  const visiblePoints = selectedDayType && view.grain === "day"
    ? selectedScope.points.filter((point) => point.dayType === selectedDayType)
    : selectedScope.points;
  const selectedPoint = selectedScope.points.find((point) => point.id === selectedPointId) ?? null;
  const activePoint = selectedScope.points.find((point) => point.id === activePointId) ?? selectedPoint;
  let maximumUsageKwh = 0;
  for (const point of visiblePoints) {
    if (point.acceptedUsageKwh !== null && point.acceptedUsageKwh > maximumUsageKwh) {
      maximumUsageKwh = point.acceptedUsageKwh;
    }
    if (point.baseline?.baselineKwh !== null && point.baseline?.baselineKwh !== undefined && point.baseline.baselineKwh > maximumUsageKwh) {
      maximumUsageKwh = point.baseline.baselineKwh;
    }
  }

  return (
    <section aria-labelledby="ngee-ann-energy-trend" className="border-b border-border px-5 py-5 lg:px-7 lg:py-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h3 id="ngee-ann-energy-trend" className="text-lg font-semibold tracking-[-0.015em] text-foreground">
            Daily Total Trend
          </h3>
          <p className="mt-1.5 text-sm leading-6 text-muted">{view.decisionQuestion}</p>
        </div>
        <p className="text-xs leading-5 text-muted">
          {view.grain === "hour" ? "Hourly grid" : "Daily totals"} / {view.evidence.timezone} / {view.evidence.unit}
        </p>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {view.grain === "day" && selectedDayType && onDayTypeChange ? (
          <fieldset className="min-w-0 rounded-lg border border-border px-3 py-3">
            <legend className="px-1 text-xs font-semibold text-muted">Day Type</legend>
            <div className="flex flex-wrap gap-1.5">
              {([
                ["weekday", "Weekday"],
                ["weekend", "Weekend"],
                ["public_holiday", "Holiday"],
              ] as const).map(([dayType, label]) => {
                const available = view.scopes.some((scope) => scope.points.some((point) => point.dayType === dayType));
                const selected = dayType === selectedDayType;
                return (
                  <button
                    key={dayType}
                    type="button"
                    disabled={!available}
                    title={available ? undefined : "No release-pinned classification is available for this Day Type."}
                    className={selected
                      ? "min-h-11 rounded-lg border border-primary bg-primary px-3 py-2 text-xs font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                      : "min-h-11 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted hover:bg-surface-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-45"}
                    aria-pressed={selected}
                    aria-controls="ngee-ann-energy-trend-chart ngee-ann-detected-anomaly-list"
                    onClick={() => {
                      setActivePointId(null);
                      setSelectedPointId(null);
                      onDayTypeChange(dayType);
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ) : null}
        <fieldset className="min-w-0 rounded-lg border border-border px-3 py-3">
          <legend className="px-1 text-xs font-semibold text-muted">Energy trend Scope</legend>
          <div className="flex flex-wrap gap-1.5">
          {view.scopes.map((scope) => {
            const selected = scope.id === selectedScope.id;
            return (
              <button
                key={scope.id}
                type="button"
                className={selected
                  ? "min-h-11 rounded-lg border border-primary bg-primary/10 px-3 py-2 text-xs font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  : "min-h-11 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted hover:bg-surface-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"}
                aria-pressed={selected}
                aria-controls="ngee-ann-energy-trend-chart"
                onClick={() => {
                  setInternalScopeId(scope.id);
                  onScopeChange?.(scope.id);
                  setActivePointId(null);
                  setSelectedPointId(null);
                }}
              >
                {scope.name}
              </button>
            );
          })}
          </div>
        </fieldset>
      </div>

      {selectedScope.limitation ? (
        <p className="mt-3 rounded-lg border border-step-warning/25 bg-step-warning/5 px-3 py-2 text-xs leading-5 text-step-warning" role="status">
          {selectedScope.limitation}
        </p>
      ) : null}

      {view.grain === "day" && view.baselineOverlay.status === "unavailable" ? (
        <p className="mt-3 rounded-lg border border-border bg-surface-subtle px-3 py-2 text-xs leading-5 text-muted" role="status">
          {view.baselineOverlay.reason} Accepted usage remains available.
        </p>
      ) : null}

      <div id="ngee-ann-energy-trend-chart" className="mt-4 overflow-x-auto pb-1">
        <div className={view.grain === "hour" ? "min-w-[1100px]" : "min-w-[720px]"}>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted">
            <span>Accepted energy / kWh</span>
            <span>{visiblePoints.length} {view.grain === "hour" ? "hourly" : "daily"} buckets</span>
          </div>
          {view.grain === "day" && view.baselineOverlay.status === "available" ? (
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted" aria-label="Energy trend legend">
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-primary/70" aria-hidden="true" />Accepted usage</span>
              <span className="inline-flex items-center gap-1.5"><span className="w-4 border-t-2 border-foreground/60" aria-hidden="true" />Governed baseline</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-step-warning ring-2 ring-step-warning/15" aria-hidden="true" />Needs review</span>
            </div>
          ) : null}
          <div
            data-hour-plot={view.grain === "hour" ? "energy-trend" : undefined}
            className="grid h-56 items-end gap-2 border-b border-border px-2"
            style={{ gridTemplateColumns: `repeat(${Math.max(visiblePoints.length, 1)}, minmax(32px, 1fr))` }}
          >
            {visiblePoints.map((point) => {
              const selected = selectedPoint?.id === point.id;
              const height = point.acceptedUsageKwh === null || maximumUsageKwh <= 0
                ? 0
                : Math.max(4, (point.acceptedUsageKwh / maximumUsageKwh) * 100);
              const baselineHeight = point.baseline?.baselineKwh === null || point.baseline?.baselineKwh === undefined || maximumUsageKwh <= 0
                ? null
                : Math.max(1, (point.baseline.baselineKwh / maximumUsageKwh) * 100);
              const triggered = point.baseline?.outcome === "triggered";
              return (
                <button
                  key={point.id}
                  type="button"
                  className="group flex h-full min-w-0 flex-col justify-end rounded-t px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  aria-label={trendPointAriaLabel(point)}
                  aria-pressed={selected}
                  data-trend-point="true"
                  data-trend-outcome={point.baseline?.outcome}
                  onMouseEnter={() => setActivePointId(point.id)}
                  onMouseLeave={() => setActivePointId(null)}
                  onFocus={() => setActivePointId(point.id)}
                  onBlur={() => setActivePointId(null)}
                  onClick={() => setSelectedPointId(point.id)}
                >
                  <span className="relative flex min-h-0 flex-1 items-end justify-center">
                    {baselineHeight !== null ? (
                      <span
                        data-trend-baseline-marker="true"
                        className="absolute left-0 right-0 z-10 border-t-2 border-foreground/60"
                        style={{ bottom: `${baselineHeight}%` }}
                        aria-hidden="true"
                      />
                    ) : null}
                    {point.acceptedUsageKwh === null ? (
                      <span className="mb-1 h-2 w-full max-w-12 rounded-sm border border-dashed border-border bg-surface-subtle" aria-hidden="true" />
                    ) : (
                      <span
                        className={point.status === "partial"
                          ? "relative w-full max-w-12 rounded-t bg-step-warning/70 group-hover:bg-step-warning group-focus-visible:bg-step-warning"
                          : "relative w-full max-w-12 rounded-t bg-primary/70 group-hover:bg-primary group-focus-visible:bg-primary"}
                        style={{ height: `${height}%` }}
                        aria-hidden="true"
                      >
                        {triggered ? (
                          <span className="absolute -top-1.5 left-1/2 z-20 h-3 w-3 -translate-x-1/2 rounded-full bg-step-warning ring-4 ring-step-warning/15" />
                        ) : null}
                      </span>
                    )}
                  </span>
                  {view.grain === "day" ? (
                    <>
                      <span className="mt-2 text-[10px] font-semibold text-foreground">{point.weekday}</span>
                      <span className="pb-2 text-[10px] text-muted">{point.dateLabel}</span>
                    </>
                  ) : null}
                </button>
              );
            })}
            {visiblePoints.length === 0 ? (
              <p className="col-span-full self-center text-center text-sm text-muted" role="status">
                No accepted daily points match this Day Type and Scope.
              </p>
            ) : null}
          </div>
          {view.grain === "hour" ? (
            <NgeeAnnHourAxis
              points={selectedScope.points.map((point) => ({ localHour: point.localHour!, hourLabel: point.dateLabel }))}
              axis="energy-trend"
              gap="wide"
            />
          ) : null}
        </div>
      </div>

      <div className="mt-4 min-h-[92px] rounded-lg bg-surface-subtle px-4 py-3" aria-live="polite" aria-atomic="true">
        {activePoint ? (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-foreground">{activePoint.weekday} / {activePoint.dateLabel}</p>
                <p className="mt-1 text-[10px] text-muted">{activePoint.range}</p>
              </div>
              <p className="text-sm font-semibold tabular-nums text-foreground">
                {activePoint.usageKwh === null ? "No accepted facts" : `${activePoint.usageKwh} kWh`}
              </p>
            </div>
            <p className="mt-2 text-[11px] text-muted">
              {activePoint.statusLabel} / {activePoint.coverage} / {activePoint.intervals} / {activePoint.qualityEvents}
            </p>
            {activePoint.baseline ? (
              <div className="mt-2 border-t border-border pt-2 text-[11px] leading-5 text-muted">
                <p>
                  Governed baseline {activePoint.baseline.baselineUsageKwh === null ? "unavailable" : `${activePoint.baseline.baselineUsageKwh} kWh`}
                  {activePoint.baseline.deltaUsageKwh === null || activePoint.baseline.relativePctLabel === null
                    ? " / Delta unavailable"
                    : ` / Delta ${activePoint.baseline.deltaUsageKwh} kWh (${activePoint.baseline.relativePctLabel})`}
                </p>
                <p className={activePoint.baseline.outcome === "triggered" ? "font-semibold text-step-warning" : "text-muted"}>
                  {activePoint.baseline.outcomeLabel}{activePoint.baseline.limitation ? ` / ${activePoint.baseline.limitation}` : ""}
                </p>
                {activePoint.baseline.incidentId ? (
                  <a
                    href={`#${anomalyIncidentDomId(activePoint.baseline.incidentId)}`}
                    className="mt-1 inline-flex font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                  >
                    Open rule evidence
                  </a>
                ) : null}
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-[11px] leading-5 text-muted">
            Hover or focus {view.grain === "hour" ? "an hour" : "a day"} to inspect accepted usage and coverage. Press Enter or Space to keep its detail open.
          </p>
        )}
      </div>

      <details className="mt-4 border-t border-border pt-3 text-[10px] leading-4 text-muted">
        <summary className="cursor-pointer font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
          Trend evidence / {view.evidence.queryIds[0]}
        </summary>
        <dl className="mt-2 grid gap-x-3 gap-y-1 sm:grid-cols-[80px_minmax(0,1fr)]">
          <dt>Snapshot</dt><dd className="break-all font-mono text-foreground">{view.evidence.snapshotId}</dd>
          <dt>Release</dt><dd className="break-all font-mono text-foreground">{view.evidence.projectReleaseId}</dd>
          <dt>Mapping</dt><dd className="break-all font-mono text-foreground">{view.evidence.meterMappingRevisionId}</dd>
          <dt>Formula</dt><dd className="break-all font-mono text-foreground">{view.evidence.meterFormulaRevisionId}</dd>
          <dt>Metric</dt><dd className="break-all font-mono text-foreground">{view.evidence.metricId}</dd>
          <dt>Period</dt><dd className="break-words text-foreground">{view.evidence.period}</dd>
          <dt>Timezone</dt><dd className="text-foreground">{view.evidence.timezone}</dd>
          <dt>Unit</dt><dd className="text-foreground">{view.evidence.unit}</dd>
          <dt>Query</dt><dd className="break-all font-mono text-foreground">{view.evidence.queryIds.join(", ")}</dd>
          {view.evidence.baseline ? (
            <>
              <dt>Baseline query</dt><dd className="break-all font-mono text-foreground">{view.evidence.baseline.queryId}</dd>
              <dt>Rule</dt><dd className="break-all font-mono text-foreground">{view.evidence.baseline.ruleRevisionId}</dd>
              <dt>Bundle</dt><dd className="break-all font-mono text-foreground">{view.evidence.baseline.bundleId}</dd>
              <dt>Cutoff</dt><dd className="text-foreground">{view.evidence.baseline.baselineCutoff}</dd>
              <dt>Method</dt><dd className="break-words text-foreground">{view.evidence.baseline.baselineMethod}</dd>
            </>
          ) : null}
        </dl>
      </details>
    </section>
  );
}

type TrendPoint = NgeeAnnEnergyTrendViewModel["scopes"][number]["points"][number];

function trendPointAriaLabel(point: TrendPoint): string {
  const current = point.usageKwh === null ? "no accepted facts" : `${point.usageKwh} kWh`;
  if (!point.baseline) {
    return `${point.weekday} ${point.dateLabel}: ${current}; ${point.statusLabel}; ${point.coverage}`;
  }
  const baseline = point.baseline.baselineUsageKwh === null
    ? "unavailable"
    : `${point.baseline.baselineUsageKwh} kWh`;
  const delta = point.baseline.deltaUsageKwh === null || point.baseline.relativePctLabel === null
    ? "unavailable"
    : `${point.baseline.deltaUsageKwh} kWh (${point.baseline.relativePctLabel})`;
  return `${point.weekday} ${point.dateLabel}: current ${current}; governed baseline ${baseline}; delta ${delta}; ${point.baseline.outcomeLabel}; ${point.statusLabel}; ${point.coverage}`;
}
