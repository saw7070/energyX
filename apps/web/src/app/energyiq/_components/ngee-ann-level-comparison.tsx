import React from "react";

import type { NgeeAnnLevelComparisonViewModel } from "./ngee-ann-overview-view-model";

export function NgeeAnnLevelComparison({
  view,
}: {
  view: NgeeAnnLevelComparisonViewModel;
}) {
  return (
    <section aria-labelledby="ngee-ann-level-comparison" className="border-b border-border px-5 py-5 lg:px-7 lg:py-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 id="ngee-ann-level-comparison" className="text-lg font-semibold tracking-[-0.015em] text-foreground">
            Energy distribution
          </h3>
          <p className="mt-1.5 text-sm leading-6 text-muted">{view.decisionQuestion}</p>
        </div>
        <p className="max-w-md text-xs leading-5 text-muted">
          Compare each Level with the previous window.
        </p>
      </div>

      {view.status === "unavailable" ? (
        <div className="mt-4 rounded-lg border border-border bg-surface-subtle px-4 py-4" role="status">
          <p className="text-xs font-semibold text-foreground">Level comparison unavailable</p>
          <p className="mt-1 text-sm leading-6 text-muted">{view.reason}</p>
        </div>
      ) : (
        <>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-border bg-surface-subtle px-4 py-3">
            <p className="text-xs font-semibold text-foreground">Current concentration by Level</p>
            {view.summary.currentConcentration.status === "available" ? (
              <p className="mt-1 text-sm leading-6 text-muted">
                <span className="font-semibold text-foreground">{view.summary.currentConcentration.name}</span> uses {view.summary.currentConcentration.currentUsageKwh} kWh ({view.summary.currentConcentration.projectShare} of Project energy).
              </p>
            ) : <p className="mt-1 text-sm text-muted">{view.summary.currentConcentration.reason}</p>}
          </div>
          <div className="rounded-lg border border-border bg-surface-subtle px-4 py-3">
            <p className="text-xs font-semibold text-foreground">Largest measured Level movement</p>
            {view.summary.measuredChange.status === "available" ? (
              <p className="mt-1 text-sm leading-6 text-muted">
                <span className="font-semibold text-foreground">{view.summary.measuredChange.name}</span> changed {view.summary.measuredChange.changeKwh} ({view.summary.measuredChange.changePct}) versus the previous window.
              </p>
            ) : (
              <p className="mt-1 text-sm leading-6 text-muted"><span className="font-semibold text-foreground">Measured Level movement unavailable.</span> {view.summary.measuredChange.reason}</p>
            )}
          </div>
        </div>
        <div className="mt-4 divide-y divide-border border-y border-border">
          {view.rows.map((row) => (
            <article key={row.id} className="grid gap-4 py-4 lg:grid-cols-[minmax(220px,1fr)_180px_200px] lg:items-center lg:gap-7">
              <div className="min-w-0">
                <div className="flex items-center justify-between gap-4">
                  <h4 className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
                    <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${levelColour(row.id)}`} />
                    {row.name}
                  </h4>
                  <span className="text-xs font-semibold tabular-nums text-muted">{row.projectShare} of Project</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-subtle" aria-hidden="true">
                  <div className={`h-full rounded-full ${levelColour(row.id)}`} style={{ width: row.projectShareBar }} />
                </div>
              </div>
              <div>
                <p className="text-xs text-muted">Current window</p>
                <p className="mt-1 text-xl font-semibold tabular-nums tracking-[-0.02em] text-foreground">
                  {row.currentUsageKwh} <span className="text-xs font-medium tracking-normal text-muted">kWh</span>
                </p>
              </div>
              <div>
                <p className="text-xs text-muted">Versus previous window</p>
                {row.movement.status === "available" ? (
                  <>
                    <p className={`mt-1 text-base font-semibold tabular-nums ${changeTone(row.changePct)}`}>{row.changePct}</p>
                    <p className="mt-0.5 text-xs tabular-nums text-muted">{row.changeKwh}</p>
                  </>
                ) : <p className="mt-1 text-xs font-semibold text-muted">Movement unavailable</p>}
                <details className="mt-2 text-xs text-muted">
                  <summary className="cursor-pointer font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
                    Comparison details
                  </summary>
                  <dl className="mt-2 grid grid-cols-[92px_minmax(0,1fr)] gap-x-3 gap-y-1.5">
                    <dt>Previous</dt><dd className="tabular-nums text-foreground">{row.movement.status === "available" ? `${row.previousUsageKwh} kWh` : row.movement.reason}</dd>
                    <dt>Coverage</dt><dd className="text-foreground">{row.coverage}</dd>
                    <dt>Intervals</dt><dd className="text-foreground">{row.intervals} valid</dd>
                    <dt>Quality</dt><dd className="text-foreground">{row.qualityEvents}</dd>
                    <dt>Exact values</dt><dd className="tabular-nums text-foreground">Current {row.exact.currentUsageKwh} kWh · share {row.exact.projectShare}{row.movement.status === "available" ? ` · previous ${row.exact.previousUsageKwh} kWh · change ${row.exact.changeKwh} (${row.exact.changePct})` : " · movement unavailable"}</dd>
                  </dl>
                </details>
              </div>
            </article>
          ))}
        </div>
        </>
      )}

      <details className="mt-4 border-t border-border pt-3 text-[10px] leading-4 text-muted">
        <summary className="cursor-pointer text-[10px] font-semibold text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
          Level evidence · {view.evidence.queryIds.length} shared queries
        </summary>
        <div className="mt-2 space-y-1">
          <p className="break-all">Snapshot <span className="font-mono text-muted">{view.evidence.snapshotId}</span></p>
          <p className="break-all">Release <span className="font-mono text-muted">{view.evidence.projectReleaseId}</span></p>
          <p className="break-all">Mapping <span className="font-mono text-muted">{view.evidence.meterMappingRevisionId}</span></p>
          <p className="break-words">Queries {view.evidence.queryIds.join(", ")}</p>
        </div>
      </details>
    </section>
  );
}

function levelColour(levelId: string): string {
  if (levelId.toLocaleLowerCase().includes("7")) return "bg-blue-600";
  if (levelId.toLocaleLowerCase().includes("6")) return "bg-teal-700";
  return "bg-primary";
}

function changeTone(changePct: string): string {
  if (changePct.startsWith("+")) return "text-step-warning";
  if (changePct.startsWith("-")) return "text-teal-700";
  return "text-foreground";
}
