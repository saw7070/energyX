"use client";

import React, { useState } from "react";

import type { PreschoolOverviewViewModel } from "./preschool-overview-view-model";

type ForecastView = Exclude<PreschoolOverviewViewModel["forecast"], { status: "unavailable" }>;
type ForecastScope = ForecastView["scopes"][number];
type ForecastGrain = keyof ForecastScope["buckets"];
type ForecastBucket = ForecastScope["buckets"][ForecastGrain][number];

const GRAINS: Array<{ id: ForecastGrain; label: string }> = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
];

export function PreschoolForecastPanel({
  forecast,
}: {
  forecast: PreschoolOverviewViewModel["forecast"];
}) {
  if (forecast.status === "unavailable") return <ForecastUnavailable detail={forecast.detail} />;
  return <AvailableForecastPanel forecast={forecast} />;
}

function AvailableForecastPanel({ forecast }: { forecast: ForecastView }) {
  const [grain, setGrain] = useState<ForecastGrain>("daily");
  const [scopeId, setScopeId] = useState(forecast.defaultScopeId);
  const scope = forecast.scopes.find((candidate) => candidate.scopeId === scopeId)
    ?? forecast.scopes.find((candidate) => candidate.scopeId === forecast.defaultScopeId)
    ?? forecast.scopes[0]!;

  return (
    <div className="mt-5" data-forecast-status={scope.status} data-forecast-scope={scope.role}>
      <ForecastStatusStrip forecast={forecast} scope={scope} />

      <dl className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ForecastKpi
          label={`Expected ${forecast.targetMonth} Energy`}
          value={scope.expectedFullMonthEnergy}
          note="Current full-month outlook"
        />
        <ForecastKpi
          label={`Expected ${forecast.targetMonth} Cost`}
          value={scope.expectedFullMonthCost}
          note={forecast.tariff.costBasisNote}
        />
        <ForecastKpi
          label="Consumed So Far"
          value={scope.consumedSoFar}
          note={`${scope.coverage} · ${scope.consumedCostSoFar}`}
        />
        <ForecastKpi
          label="Pace vs Original Estimate"
          value={scope.paceVsOriginalEstimate}
          note={scope.paceDetail}
        />
      </dl>

      <TariffReference tariff={forecast.tariff} />

      <article className="mt-4 overflow-hidden rounded-xl border border-border bg-surface" data-forecast-grain={grain}>
        <div className="flex flex-col gap-4 border-b border-border px-4 py-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h4 className="text-base font-semibold text-foreground">
              {forecast.comparisonStatus === "frozen-original"
                ? "Original Estimate, Actual and Current Outlook"
                : "Planning Baseline and Actual availability"}
            </h4>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-muted">
              {forecast.comparisonStatus === "frozen-original"
                ? "The dashed Original Estimate stays pinned to the Saved Plan. Actual uses complete local days only; Current Outlook carries the remaining estimate forward."
                : "The current deterministic Planning Baseline remains visible. A compatible frozen Saved Plan is required before Original-versus-Current comparison can be shown."}
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="grid min-w-0 gap-1 text-xs font-semibold text-foreground">
              Scope
              <select
                aria-label="Monthly outlook scope"
                className="h-10 min-w-0 rounded-md border border-border bg-surface px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-60 sm:min-w-52"
                disabled={!forecast.centreSelectionAvailable}
                value={scope.scopeId}
                onChange={(event) => setScopeId(event.target.value)}
              >
                {forecast.scopes.map((option) => (
                  <option key={option.scopeId} value={option.scopeId}>
                    {option.role === "portfolio" ? "All centres" : option.label}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <span className="block text-xs font-semibold text-foreground">Interval</span>
              <div className="mt-1 inline-flex max-w-full rounded-md border border-border bg-surface-subtle p-1" aria-label="Monthly outlook interval">
                {GRAINS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={grain === option.id}
                    className={`min-h-8 rounded px-3 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/30 ${grain === option.id ? "bg-foreground text-surface" : "text-muted hover:bg-surface hover:text-foreground"}`}
                    onClick={() => setGrain(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <ForecastTrendChart forecast={forecast} scope={scope} grain={grain} />
      </article>
    </div>
  );
}

function ForecastStatusStrip({ forecast, scope }: { forecast: ForecastView; scope: ForecastScope }) {
  const tone = scope.status === "complete"
    ? "border-step-success/30 bg-step-success-soft/45"
    : scope.status === "partial"
      ? "border-primary/25 bg-primary/5"
      : "border-step-warning/30 bg-step-warning-soft/45";
  const dot = scope.status === "complete"
    ? "bg-step-success"
    : scope.status === "partial"
      ? "bg-primary"
      : "bg-step-warning";
  return (
    <div className={`flex flex-col gap-2 rounded-lg border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${tone}`} role="status">
      <div className="flex min-w-0 items-start gap-2.5">
        <span className={`mt-1.5 size-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{scope.statusLabel}</p>
          <p className="mt-0.5 max-w-3xl text-xs leading-5 text-muted">{scope.statusDetail}</p>
        </div>
      </div>
      <div className="shrink-0 text-xs font-semibold text-foreground sm:text-right">
        <p>{scope.role === "portfolio" ? "All centres" : scope.label} · {forecast.targetPeriod}</p>
        <p className="mt-0.5 font-medium text-muted">{scope.actualThrough}</p>
      </div>
    </div>
  );
}

function ForecastKpi({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-surface px-4 py-4" data-forecast-kpi={label}>
      <dt className="text-xs font-semibold uppercase tracking-[0.06em] text-muted">{label}</dt>
      <dd className="mt-2 break-words text-2xl font-semibold tabular-nums tracking-[-0.025em] text-foreground">{value}</dd>
      <dd className="mt-1 break-words text-[11px] leading-5 text-muted">{note}</dd>
    </div>
  );
}

function TariffReference({ tariff }: { tariff: ForecastView["tariff"] }) {
  const warning = tariff.status !== "effective";
  return (
    <div className={`mt-4 flex flex-col gap-1 rounded-lg border px-4 py-3 text-xs sm:flex-row sm:items-center sm:justify-between ${warning ? "border-step-warning/30 bg-step-warning-soft/35" : "border-border bg-surface-subtle/50"}`} data-forecast-tariff={tariff.status}>
      <div className="min-w-0">
        <p className="font-semibold text-foreground">{tariff.label}</p>
        <p className="mt-0.5 leading-5 text-muted">{tariff.rate} · effective reference {tariff.effectiveRange}</p>
      </div>
      <div className="min-w-0 text-muted sm:max-w-xl sm:text-right">
        <span>{tariff.note}</span>
        {tariff.sourceUrl ? (
          <> <a className="font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30" href={tariff.sourceUrl} target="_blank" rel="noreferrer">View source</a></>
        ) : null}
      </div>
    </div>
  );
}

function ForecastTrendChart({
  forecast,
  scope,
  grain,
}: {
  forecast: ForecastView;
  scope: ForecastScope;
  grain: ForecastGrain;
}) {
  const buckets = scope.buckets[grain];
  const width = 900;
  const height = 340;
  const inset = { top: 30, right: 34, bottom: 58, left: 70 };
  const plotWidth = width - inset.left - inset.right;
  const plotHeight = height - inset.top - inset.bottom;
  const values = buckets.flatMap((bucket) => [
    ...(bucket.originalEstimateKwh === null ? [] : [bucket.originalEstimateKwh]),
    ...(bucket.planningBaselineKwh === null ? [] : [bucket.planningBaselineKwh]),
    ...(bucket.actualKwh === null ? [] : [bucket.actualKwh]),
    ...(bucket.currentOutlookKwh === null ? [] : [bucket.currentOutlookKwh]),
  ]);
  const maximum = Math.max(1, ...values) * 1.1;
  const x = (index: number) => buckets.length === 1
    ? inset.left + plotWidth / 2
    : inset.left + (index / (buckets.length - 1)) * plotWidth;
  const y = (value: number) => inset.top + plotHeight - (value / maximum) * plotHeight;
  const originalPath = linePath(buckets, (bucket) => bucket.originalEstimateKwh, x, y);
  const baselinePath = linePath(buckets, (bucket) => bucket.planningBaselineKwh, x, y);
  const currentOutlookPath = linePath(buckets, (bucket) => bucket.currentOutlookKwh, x, y);
  const actualPath = linePath(buckets, (bucket) => bucket.actualKwh, x, y);
  const ticks = Array.from({ length: 5 }, (_, index) => (maximum / 4) * index).reverse();
  const labelStep = Math.max(1, Math.ceil(buckets.length / 6));
  const titleId = `forecast-${scope.scopeId.replace(/[^a-zA-Z0-9_-]/g, "-")}-${grain}-title`;
  const descId = `${titleId}-desc`;
  const frozen = forecast.comparisonStatus === "frozen-original";

  return (
    <div className="px-3 py-4 sm:px-4">
      {scope.status === "waiting" ? (
        <p className="mb-3 rounded-md border border-step-warning/25 bg-step-warning-soft/40 px-3 py-2 text-xs leading-5 text-muted" role="status">
          Actual is waiting for the first complete local day. {frozen ? "The frozen Original Estimate remains visible; no Actual is invented." : "The Planning Baseline remains visible; no Actual is invented."}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-1 text-xs text-muted" aria-hidden="true">
        {frozen ? (
          <>
            <span className="inline-flex items-center gap-2"><span className="w-8 border-t-2 border-dashed border-muted" />Original Estimate</span>
            <span className="inline-flex items-center gap-2"><span className="w-8 border-t-2 border-dashed border-primary/60" />Current Outlook</span>
          </>
        ) : (
          <span className="inline-flex items-center gap-2"><span className="w-8 border-t-2 border-dashed border-primary" />Planning Baseline</span>
        )}
        <span className="inline-flex items-center gap-2"><span className="w-8 border-t-2 border-foreground" />Actual</span>
        <span>{scope.label} · {scope.coverage}</span>
      </div>
      <div className="mt-3 overflow-hidden rounded-lg bg-surface-subtle/55">
        <svg className="block h-auto w-full" viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${titleId} ${descId}`}>
          <title id={titleId}>{`${scope.label} ${forecast.targetMonth} ${grain} Monthly Energy Outlook`}</title>
          <desc id={descId}>{frozen
            ? "Original Estimate is dashed for the full month. Actual is solid through the latest complete local day. Current Outlook is a lighter dashed line for future days only."
            : "The Planning Baseline is dashed. Actual is absent until matching complete-day Evidence is available."}</desc>
          {ticks.map((tick) => {
            const tickY = y(tick);
            return (
              <g key={tick}>
                <line x1={inset.left} x2={width - inset.right} y1={tickY} y2={tickY} stroke="currentColor" className="text-border" strokeWidth="1" />
                <text x={inset.left - 12} y={tickY + 4} textAnchor="end" className="fill-muted text-[11px] tabular-nums">{formatCompactKwh(tick)}</text>
              </g>
            );
          })}
          <line x1={inset.left} x2={inset.left} y1={inset.top} y2={height - inset.bottom} stroke="currentColor" className="text-border" />
          <line x1={inset.left} x2={width - inset.right} y1={height - inset.bottom} y2={height - inset.bottom} stroke="currentColor" className="text-border" />
          {frozen ? (
            <>
              <path d={originalPath} fill="none" stroke="currentColor" className="text-muted" strokeWidth="3" strokeDasharray="8 7" strokeLinejoin="round" data-series="original-estimate" />
              <path d={currentOutlookPath} fill="none" stroke="currentColor" className="text-primary/60" strokeWidth="3" strokeDasharray="4 6" strokeLinejoin="round" data-series="current-outlook" />
            </>
          ) : (
            <path d={baselinePath} fill="none" stroke="currentColor" className="text-primary" strokeWidth="3" strokeDasharray="8 7" strokeLinejoin="round" data-series="planning-baseline" />
          )}
          <path d={actualPath} fill="none" stroke="currentColor" className="text-foreground" strokeWidth="3" strokeLinejoin="round" data-series="actual" />
          {buckets.map((bucket, index) => {
            const plannedValue = frozen ? bucket.originalEstimateKwh : bucket.planningBaselineKwh;
            const plannedLabel = frozen ? bucket.originalEstimate : bucket.planningBaseline;
            return (
              <g key={`${bucket.start}-${bucket.endExclusive}`}>
                {plannedValue === null ? null : (
                  <circle cx={x(index)} cy={y(plannedValue)} r="4" fill="currentColor" className={frozen ? "text-muted" : "text-primary"}>
                    <title>{`${bucket.label}: ${frozen ? "Original Estimate" : "Planning Baseline"} ${plannedLabel}`}</title>
                  </circle>
                )}
                {frozen && bucket.currentOutlookKwh !== null ? (
                  <circle cx={x(index)} cy={y(bucket.currentOutlookKwh)} r="4" fill="currentColor" className="text-primary">
                    <title>{`${bucket.label}: Current Outlook ${bucket.currentOutlook}`}</title>
                  </circle>
                ) : null}
                {bucket.actualKwh === null ? null : (
                  <circle cx={x(index)} cy={y(bucket.actualKwh)} r="4" fill="currentColor" className="text-foreground">
                    <title>{`${bucket.label}: Actual ${bucket.actual}; ${bucket.coverage}`}</title>
                  </circle>
                )}
                {(index % labelStep === 0 || index === buckets.length - 1) ? (
                  <text x={x(index)} y={height - inset.bottom + 25} textAnchor="middle" className="fill-muted text-[10px]">{bucket.label}</text>
                ) : null}
              </g>
            );
          })}
          <text x="18" y={inset.top + plotHeight / 2} textAnchor="middle" transform={`rotate(-90 18 ${inset.top + plotHeight / 2})`} className="fill-muted text-[11px]">Energy (kWh)</text>
        </svg>
      </div>
      <details className="mt-3 border-t border-border pt-3">
        <summary className="cursor-pointer text-xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">View accessible chart values</summary>
        <div className="mt-3 max-h-64 overflow-auto overscroll-contain rounded-md border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30" tabIndex={0} aria-label={`${scope.label} ${grain} Monthly Energy Outlook values`}>
          <table className="w-full min-w-[680px] text-left text-xs">
            <thead className="sticky top-0 bg-surface-subtle text-muted">
              <tr>
                <th className="px-3 py-2 font-semibold">Period</th>
                <th className="px-3 py-2 font-semibold">{frozen ? "Original Estimate" : "Planning Baseline"}</th>
                <th className="px-3 py-2 font-semibold">Actual</th>
                {frozen ? <th className="px-3 py-2 font-semibold">Current Outlook</th> : null}
                <th className="px-3 py-2 font-semibold">Coverage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {buckets.map((bucket) => (
                <tr key={`${bucket.start}-${bucket.endExclusive}`}>
                  <td className="px-3 py-2">{bucket.label}</td>
                  <td className="px-3 py-2 tabular-nums">{frozen ? bucket.originalEstimate : bucket.planningBaseline}</td>
                  <td className="px-3 py-2 tabular-nums">{bucket.actual}</td>
                  {frozen ? <td className="px-3 py-2 tabular-nums">{bucket.currentOutlook}</td> : null}
                  <td className="px-3 py-2 text-muted">{bucket.coverage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function ForecastUnavailable({ detail }: { detail: string }) {
  return (
    <div className="mt-5" data-forecast-status="unavailable">
      <div className="rounded-lg border border-step-warning/30 bg-step-warning-soft/45 px-4 py-3" role="status">
        <p className="text-sm font-semibold text-foreground">Monthly Energy Outlook unavailable for this Snapshot</p>
        <p className="mt-1 text-xs leading-5 text-muted">{detail}</p>
      </div>
    </div>
  );
}

function linePath(
  buckets: ForecastBucket[],
  value: (bucket: ForecastBucket) => number | null,
  x: (index: number) => number,
  y: (value: number) => number,
): string {
  let drawing = false;
  return buckets.flatMap((bucket, index) => {
    const current = value(bucket);
    if (current === null) {
      drawing = false;
      return [];
    }
    const command = drawing ? "L" : "M";
    drawing = true;
    return [`${command}${x(index).toFixed(2)},${y(current).toFixed(2)}`];
  }).join(" ");
}

function formatCompactKwh(value: number): string {
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return Math.round(value).toLocaleString("en-SG");
}
