import React, { useState } from "react";

import type { NgeeAnnOverviewViewModel } from "./ngee-ann-overview-view-model";
import { NgeeAnnPeakBreakdown } from "./ngee-ann-peak-breakdown";

export function NgeeAnnExecutiveSummary({ view }: { view: NgeeAnnOverviewViewModel }) {
  const [collapsed, setCollapsed] = useState(false);
  const [activeHighlightId, setActiveHighlightId] = useState<
    NgeeAnnOverviewViewModel["highlights"][number]["id"] | null
  >(null);
  const activeHighlight = view.highlights.find((highlight) => highlight.id === activeHighlightId) ?? null;

  return (
    <div className="border-b border-border px-5 py-5 lg:px-7 lg:py-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm leading-6 text-muted">{view.executiveSummary.detail}</p>
          <p className="mt-1 text-xs leading-5 text-muted-light">
            {view.context.projectName} · {view.context.scopeName} · {view.context.periodRange}
          </p>
        </div>
        <button
          type="button"
          className="min-h-10 shrink-0 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
          aria-expanded={!collapsed}
          aria-controls="ngee-ann-key-highlights"
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed ? "Expand" : "Collapse"}
        </button>
      </div>

      {!collapsed ? (
        <div id="ngee-ann-key-highlights" className="mt-5">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-5">
            <div>
              <h3 className="text-lg font-semibold tracking-[-0.015em] text-foreground">Key Highlights</h3>
              <p className="mt-1 text-xs leading-5 text-muted">
                Comparison badges use the validated previous period. Open a card for its supporting breakdown.
              </p>
            </div>
            <span className="text-xs text-muted">Peak is the published interval-average value.</span>
          </div>

          <div className="mt-4 grid overflow-hidden rounded-xl border border-border bg-surface sm:grid-cols-2 xl:grid-cols-4">
            {view.highlights.map((highlight) => {
              const active = activeHighlightId === highlight.id;
              return (
                <article
                  key={highlight.id}
                  className="min-w-0 border-b border-border sm:[&:nth-last-child(-n+2)]:border-b-0 xl:border-b-0 xl:[&:not(:last-child)]:border-r"
                >
                  <button
                    type="button"
                    className="group min-h-full w-full px-4 py-4 text-left transition-colors hover:bg-surface-subtle focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30"
                    aria-expanded={active}
                    aria-controls="ngee-ann-highlight-breakdown"
                    onClick={() => setActiveHighlightId((current) => current === highlight.id ? null : highlight.id)}
                  >
                    <div className="flex min-h-6 items-start justify-between gap-3">
                      {highlight.comparison ? (
                        <span className={`rounded-md px-2 py-1 text-[11px] font-semibold tabular-nums ${comparisonTone(highlight.comparison.direction)}`}>
                          {highlight.comparison.label}
                        </span>
                      ) : <span aria-hidden="true" />}
                      <span className="text-[11px] font-semibold text-muted group-hover:text-foreground">
                        {active ? "Close" : "Details"}
                      </span>
                    </div>
                    <p className="mt-3 text-xs font-medium text-muted">{highlight.label}</p>
                    <p className={`mt-1 break-words text-2xl font-semibold tracking-[-0.025em] tabular-nums ${highlight.available ? "text-foreground" : "text-muted-light"}`}>
                      {highlight.value}
                      {highlight.unit ? <span className="ml-1 text-xs font-medium tracking-normal text-muted">{highlight.unit}</span> : null}
                    </p>
                    <p className="mt-2 text-xs leading-5 text-muted">{highlight.detail}</p>
                  </button>
                  {highlight.id === "peak" ? (
                    <div className="border-t border-border px-4 py-3">
                      <NgeeAnnPeakBreakdown view={view.peakBreakdown} />
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>

          {activeHighlight ? (
            <div id="ngee-ann-highlight-breakdown" className="mt-4 rounded-xl border border-border bg-surface-subtle px-4 py-4" aria-live="polite">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Breakdown</p>
                  <h4 className="mt-1 text-lg font-semibold text-foreground">{activeHighlight.label}</h4>
                </div>
                <button
                  type="button"
                  className="min-h-10 rounded-lg px-3 py-2 text-xs font-semibold text-muted hover:bg-surface hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
                  onClick={() => setActiveHighlightId(null)}
                >
                  Close
                </button>
              </div>
              <HighlightBreakdown view={view} id={activeHighlight.id} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function HighlightBreakdown({
  view,
  id,
}: {
  view: NgeeAnnOverviewViewModel;
  id: NgeeAnnOverviewViewModel["highlights"][number]["id"];
}) {
  if (id === "total") {
    return view.levelComparison.status === "available" ? (
      <div className="mt-4 divide-y divide-border border-y border-border">
        {view.levelComparison.rows.map((row) => (
          <div key={row.id} className="grid gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
            <div>
              <p className="text-sm font-semibold text-foreground">{row.name}</p>
              <p className="mt-1 text-xs text-muted">Official aggregate meters · {row.projectShare} of Project</p>
            </div>
            <p className="text-sm font-semibold tabular-nums text-foreground">{row.currentUsageKwh} kWh</p>
          </div>
        ))}
      </div>
    ) : <p className="mt-3 text-sm text-muted">{view.levelComparison.reason}</p>;
  }
  if (id === "daily") {
    return (
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-surface px-4 py-3">
          <p className="text-xs text-muted">Current selected window</p>
          <p className="mt-1 text-sm font-semibold text-foreground">{view.highlights.find((item) => item.id === "daily")?.value} kWh/day</p>
        </div>
        <div className="rounded-lg bg-surface px-4 py-3">
          <p className="text-xs text-muted">Validated comparison</p>
          <p className="mt-1 text-sm font-semibold text-foreground">
            {view.evidence.comparison.status === "available"
              ? `${view.evidence.comparison.changePct} · ${view.evidence.comparison.previousUsageKwh} kWh previous total`
              : "Unavailable"}
          </p>
        </div>
      </div>
    );
  }
  if (id === "peak") return (
    <p className="mt-4 text-sm leading-6 text-muted">
      Open <span className="font-semibold text-foreground">View peak breakdown</span> on the Peak card for the Level and component Circuit evidence behind this interval.
    </p>
  );
  return view.evidence.cost.status === "available" ? (
    <div className="mt-4">
      <p className="text-sm leading-6 text-muted">
        Release-pinned Tariff <span className="font-semibold text-foreground">{view.evidence.cost.tariffScheduleVersion}</span>. This is an estimated energy charge, not a customer bill.
      </p>
      <div className="mt-3 divide-y divide-border border-y border-border">
        {view.evidence.cost.allocations.map((allocation) => (
          <div key={`${allocation.from}:${allocation.to}`} className="grid gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
            <p className="text-xs leading-5 text-muted">{allocation.range} · rate {allocation.ratePerKwh}/kWh</p>
            <p className="text-sm font-semibold tabular-nums text-foreground">{allocation.cost} {view.evidence.cost.status === "available" ? view.evidence.cost.currency : ""}</p>
          </div>
        ))}
      </div>
    </div>
  ) : <p className="mt-3 text-sm text-muted">{view.evidence.cost.reason}</p>;
}

function comparisonTone(direction: "increase" | "decrease" | "flat"): string {
  if (direction === "increase") return "bg-step-warning-soft text-step-warning";
  if (direction === "decrease") return "bg-step-success-soft text-step-success";
  return "bg-surface-subtle text-muted";
}
