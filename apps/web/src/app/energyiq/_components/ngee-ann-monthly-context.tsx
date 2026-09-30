import React from "react";

import type {
  NgeeAnnMonthlyContextSegmentViewModel,
  NgeeAnnMonthlyContextViewModel,
} from "./ngee-ann-overview-view-model";

export function NgeeAnnMonthlyContext({
  view,
}: {
  view: NgeeAnnMonthlyContextViewModel;
}) {
  const comparableRows = view.sameProgress.rows.filter((row) => row.usageKwhValue !== null);
  const completedRows = view.completedMonths.rows;
  const sameProgressScaleMax = Math.max(
    view.current.usageKwhValue ?? 0,
    ...comparableRows.map((row) => row.usageKwhValue ?? 0),
  );
  const completedMonthScaleMax = Math.max(
    0,
    ...completedRows.map((row) => row.usageKwhValue ?? 0),
  );

  return (
    <section
      id="ngee-ann-monthly-context"
      data-overview-section="true"
      data-overview-navigation-label="Monthly context"
      aria-labelledby="ngee-ann-monthly-context-title"
      tabIndex={-1}
      className="scroll-mt-28 border-b border-border bg-surface px-5 py-7 lg:px-7 lg:py-8"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div>
          <h3 id="ngee-ann-monthly-context-title" className="text-lg font-semibold tracking-[-0.015em] text-foreground">
            Monthly context
          </h3>
          <p className="mt-1.5 max-w-3xl text-sm leading-6 text-muted">
            Current month progress is compared only with the same number of complete days. Full-month history stays separate.
          </p>
        </div>
        <span className={`rounded-md px-2.5 py-1.5 text-xs font-semibold ${
          view.current.phase === "complete"
            ? "bg-step-success/10 text-step-success"
            : "bg-step-warning/10 text-step-warning"
        }`}>
          {view.current.phase === "complete" ? "Complete month" : "Month in progress"}
        </span>
      </div>

      <div className="mt-6 grid gap-7 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-0">
        <div className="min-w-0 lg:pr-7">
          <h4 className="text-sm font-semibold text-foreground">Fair month-to-date comparison</h4>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{view.sameProgress.headline}</p>
          {view.status === "available" ? (
            <dl className="mt-5 grid gap-4 border-y border-border py-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium text-muted">{view.current.label} · first {view.current.completeDayCount} days</dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums tracking-[-0.02em] text-foreground">
                  {view.current.usageKwh} <span className="text-xs font-medium tracking-normal text-muted">kWh</span>
                </dd>
                <dd className="mt-1 text-xs text-muted">{view.current.averageDailyUsageKwh} kWh/day · {view.current.range}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted">Change from comparable history</dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums tracking-[-0.02em] text-foreground">
                  {view.sameProgress.deltaPct ?? "Unavailable"}
                </dd>
                <dd className="mt-1 text-xs text-muted">
                  {view.sameProgress.deltaKwh && view.sameProgress.referenceLabel
                    ? `${view.sameProgress.deltaKwh} kWh absolute difference · ${view.sameProgress.referenceLabel}`
                    : "No complete same-progress reference is available."}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="mt-4 border-y border-border py-4 text-sm text-muted">
              Current-month usage is unavailable for this exact Snapshot and report window.
            </p>
          )}
          <div className="mt-5 space-y-3">
            {comparableRows.length > 0 ? comparableRows.map((row) => (
              <MonthlyUsageRow key={`${row.label}:${row.range}`} row={row} scaleMax={sameProgressScaleMax} />
            )) : (
              <p className="text-xs leading-5 text-muted">No complete prior month reaches the same progress point yet.</p>
            )}
          </div>
        </div>

        <div className="min-w-0 border-t border-border pt-7 lg:border-l lg:border-t-0 lg:pl-7 lg:pt-0">
          <h4 className="text-sm font-semibold text-foreground">Completed months</h4>
          <p className="mt-2 text-sm leading-6 text-muted">
            Only rows marked Complete publish a full-month total. Partial coverage is shown but never compared as a full month.
          </p>
          <div className="mt-5 space-y-4">
            {completedRows.length > 0 ? completedRows.map((row) => (
              <MonthlyUsageRow key={`${row.label}:${row.range}`} row={row} scaleMax={completedMonthScaleMax} />
            )) : (
              <p className="text-xs leading-5 text-muted">No completed calendar-month history is available for this Snapshot.</p>
            )}
          </div>
        </div>
      </div>

      <MonthlyContextEvidence rows={[...view.sameProgress.rows, ...completedRows]} />
    </section>
  );
}

function MonthlyUsageRow({
  row,
  scaleMax,
}: {
  row: NgeeAnnMonthlyContextSegmentViewModel;
  scaleMax: number;
}) {
  const width = row.usageKwhValue === null || scaleMax === 0 ? 0 : Math.max(3, row.usageKwhValue / scaleMax * 100);
  const status = row.dataStatus === "complete"
    ? `${row.usageKwh} kWh · ${row.averageDailyUsageKwh} kWh/day`
    : row.dataStatus === "partial"
      ? `Partial · ${row.completeDayCount} of ${row.expectedDayCount} complete days`
      : "Unavailable · no complete days";

  return (
    <div
      role="img"
      aria-label={`${row.label}. ${status}. ${row.range}.`}
      className="grid gap-2 sm:grid-cols-[7rem_minmax(0,1fr)_minmax(10rem,auto)] sm:items-center sm:gap-4"
    >
      <div>
        <p className="text-sm font-semibold text-foreground">{row.label}</p>
        <p className="mt-0.5 text-xs text-muted">{row.completeDayCount}/{row.expectedDayCount} days</p>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-subtle" aria-hidden="true">
        <div
          className={`h-full rounded-full ${row.dataStatus === "complete" ? "bg-primary/70" : "bg-muted/30"}`}
          style={{ width: `${width}%` }}
        />
      </div>
      <p className="text-xs leading-5 text-muted sm:text-right">{status}</p>
    </div>
  );
}

function MonthlyContextEvidence({
  rows,
}: {
  rows: readonly NgeeAnnMonthlyContextSegmentViewModel[];
}) {
  const sources = [...new Map(rows.map((row) => [
    `${row.evidence.dataSnapshotId}:${row.evidence.queryId}`,
    row.evidence,
  ])).values()];
  if (sources.length === 0) return null;
  return (
    <details className="mt-6 border-t border-border pt-4 text-xs text-muted">
      <summary className="cursor-pointer font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
        Monthly comparison evidence
      </summary>
      <ul className="mt-3 space-y-1.5">
        {sources.map((source) => (
          <li key={`${source.dataSnapshotId}:${source.queryId}`} className="break-all">
            Snapshot <span className="font-mono text-foreground">{source.dataSnapshotId}</span> · query {source.queryId}
          </li>
        ))}
      </ul>
    </details>
  );
}
