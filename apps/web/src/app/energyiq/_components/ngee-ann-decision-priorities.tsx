"use client";

import React from "react";

import {
  NGEE_ANN_OPEN_INCIDENT_EVENT,
  type NgeeAnnOpenIncidentEventDetail,
} from "./ngee-ann-daily-anomalies";
import type { NgeeAnnDecisionPrioritiesViewModel } from "./ngee-ann-overview-view-model";
import { anomalyIncidentDomId } from "./ngee-ann-overview-links";
import { projectExplorerHrefForScope } from "./overview-explorer-handoff";

export function NgeeAnnDecisionPriorities({
  view,
  projectExplorerHref,
  aiAnalystHref,
}: {
  view: NgeeAnnDecisionPrioritiesViewModel;
  projectExplorerHref?: string;
  aiAnalystHref?: string;
}) {
  const stateMessage = view.status === "partial" && view.items.length > 0
    ? null
    : priorityStateMessage(view);
  return (
    <section
      id="ngee-ann-takeaways"
      aria-labelledby="ngee-ann-decision-priorities"
      className="scroll-mt-28 border-b border-border bg-surface px-5 py-7 lg:px-7 lg:py-8"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 id="ngee-ann-decision-priorities" className="text-lg font-semibold tracking-[-0.015em] text-foreground">
            Operational review recommendations
          </h3>
          <p className="mt-1.5 max-w-3xl text-sm leading-6 text-muted">
            Takeaways and next decisions from the accepted Snapshot: what changed, why it matters, and the next check to make.
          </p>
        </div>
        <span className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-muted">
          {view.items.length} decision {view.items.length === 1 ? "priority" : "priorities"}
        </span>
      </div>

      {view.lifecycle.status === "available" ? (
        <div className="mt-5 border-y border-border py-4" data-decision-lifecycle="available">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold text-foreground">{view.lifecycle.referenceLabel}</p>
              <p className="mt-1 text-sm leading-6 text-muted">{view.lifecycle.referenceDetail}</p>
            </div>
            <details className="shrink-0 text-right">
              <summary className="cursor-pointer text-xs font-semibold text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
                Comparison evidence
              </summary>
              <p className="mt-2 max-w-sm break-all text-xs leading-5 text-muted">
                Saved result {view.lifecycle.previousSavedAnalysisId}<br />
                Previous Snapshot {view.lifecycle.previousSnapshotId}
              </p>
            </details>
          </div>
        </div>
      ) : null}

      {view.lifecycle.historicalItems.length > 0 ? (
        <div className="mt-5 space-y-3">
          {view.lifecycle.historicalItems.map((item) => (
            <div
              key={item.themeKey}
              data-decision-lifecycle-kind={item.kind}
              className="border-y border-border py-4"
            >
              <p className={[
                "text-sm font-semibold",
                item.tone === "success" ? "text-step-success" : "text-step-warning",
              ].join(" ")}>{item.label}</p>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">{item.detail}</p>
            </div>
          ))}
        </div>
      ) : null}

      {stateMessage ? (
        <div
          role="status"
          className="mt-5 rounded-lg border border-border bg-surface px-4 py-3 text-sm leading-6 text-muted"
        >
          <p className="font-semibold text-foreground">{stateMessage.title}</p>
          <p className="mt-0.5">{stateMessage.detail}</p>
        </div>
      ) : null}

      {view.items.length > 0 ? (
        <div className="mt-5 space-y-4">
          {view.items.map((item) => (
            <article
              key={item.priorityId}
              data-recommendation-card
              className="min-w-0 rounded-xl border border-border bg-surface p-5 shadow-[var(--shadow-card)] lg:p-6"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-primary">Priority {item.rank}</p>
                  <h4 className="mt-1.5 max-w-4xl text-lg font-semibold leading-7 text-foreground">{decisionHeadline(item)}</h4>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  {item.lifecycle ? (
                    <span
                      data-decision-lifecycle-kind={item.lifecycle.kind}
                      className={[
                        "shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold",
                        item.lifecycle.tone === "info"
                          ? "bg-primary/10 text-primary"
                          : "bg-step-warning/10 text-step-warning",
                      ].join(" ")}
                    >
                      {item.lifecycle.label}
                    </span>
                  ) : null}
                  <span className={[
                    "shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold",
                    item.confidence === "Complete Evidence"
                      ? "bg-step-success-light text-step-success"
                      : "bg-step-warning/10 text-step-warning",
                  ].join(" ")}>
                    {item.confidence === "Complete Evidence" ? "Verified" : "Supporting data partial"}
                  </span>
                </div>
              </div>
              {item.lifecycle ? (
                <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">{item.lifecycle.detail}</p>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 rounded-lg bg-surface-subtle px-4 py-3 text-sm leading-6">
                <p><span className="font-semibold text-foreground">Affected area:</span> <span className="text-muted">{item.explorerScopeName}</span></p>
                <p className="text-muted">No saving is assumed until the recommended check is completed.</p>
              </div>
              <dl className="mt-5 grid gap-x-8 gap-y-4 text-sm leading-6 md:grid-cols-2">
                <PriorityField label="Evidence" value={item.evidence} />
                <PriorityField label="Why it matters" value={item.impact} />
                <PriorityField label="Recommended action" value={item.action} />
                <PriorityField label="Where to investigate first" value={item.driver} />
                <PriorityField label="Recommended next check" value={item.nextCheck} />
                <PriorityField label="How to confirm progress" value={item.verificationMetric} />
              </dl>
              <details className="mt-5 border-t border-border pt-4">
                <summary className="cursor-pointer text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
                  Details, evidence and limitations
                </summary>
                <HorizonComparison horizons={item.horizons} />
                <div className="mt-4 text-sm leading-6 text-muted">
                  <p><span className="font-semibold text-foreground">Rule finding.</span> {item.finding}</p>
                  <p className="mt-2">Seen on {item.recurrenceDayCount} distinct exception days. Linked Level and Circuit evidence is preserved.</p>
                  {item.confidenceLimitation ? (
                    <p className="mt-2 text-step-warning"><span className="font-semibold">Limitation.</span> {item.confidenceLimitation}</p>
                  ) : null}
                </div>
              </details>
              <div className="mt-4 flex flex-wrap gap-2">
                <a
                  href={`#${anomalyIncidentDomId(item.targetIncidentId)}`}
                  onClick={(event) => {
                    const handled = !document.dispatchEvent(new CustomEvent<NgeeAnnOpenIncidentEventDetail>(
                      NGEE_ANN_OPEN_INCIDENT_EVENT,
                      {
                        cancelable: true,
                        detail: {
                          incidentId: item.targetIncidentId,
                          trigger: event.currentTarget,
                        },
                      },
                    ));
                    if (handled) event.preventDefault();
                  }}
                  className="inline-flex min-h-10 items-center justify-center rounded-lg border border-primary/25 px-3.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
                >
                  View supporting evidence
                </a>
                <PriorityExplorerLink item={item} baseHref={projectExplorerHref} />
              </div>
            </article>
          ))}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {projectExplorerHref ? (
          <a href={projectExplorerHref} className="inline-flex min-h-9 items-center rounded-lg bg-primary px-3.5 text-xs font-semibold text-white hover:bg-primary-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25 focus-visible:ring-offset-2">
            View energy consumption
          </a>
        ) : null}
        {aiAnalystHref ? (
          <a href={aiAnalystHref} className="inline-flex min-h-9 items-center rounded-lg border border-border bg-surface px-3.5 text-xs font-semibold text-foreground hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25">
            Ask the advisor <span className="ml-1 font-normal text-muted">(optional)</span>
          </a>
        ) : null}
      </div>
    </section>
  );
}

function PriorityExplorerLink({
  item,
  baseHref,
}: {
  item: NgeeAnnDecisionPrioritiesViewModel["items"][number];
  baseHref?: string;
}) {
  const href = projectExplorerHrefForScope(baseHref, item.explorerScopeId);
  if (!href) return null;
  return (
    <a
      href={href}
      data-explorer-scope={item.explorerScopeId}
      className="inline-flex min-h-10 items-center justify-center rounded-lg border border-border bg-surface px-3.5 text-sm font-semibold text-foreground transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
    >
      Inspect {item.explorerScopeName} in Energy consumption
    </a>
  );
}

function HorizonComparison({
  horizons,
}: {
  horizons: NgeeAnnDecisionPrioritiesViewModel["items"][number]["horizons"];
}) {
  const maxMagnitude = Math.max(
    1,
    ...horizons.flatMap((horizon) => horizon.relativePct === null ? [] : [Math.abs(horizon.relativePct)]),
  );
  return (
    <div className="mt-5 border-y border-border py-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">
          How usage changed across 1 day, 7 days and 28 days
        </p>
        <div className="text-right text-xs leading-5 text-muted">
          <div className="flex justify-end gap-5 font-medium" aria-hidden="true">
            <span>Lower use</span>
            <span>Higher use</span>
          </div>
          <p>Each period is compared with the same type of previous period.</p>
        </div>
      </div>
      <div className="mt-4 space-y-4">
        {horizons.map((horizon) => (
          <HorizonComparisonRow key={horizon.label} horizon={horizon} maxMagnitude={maxMagnitude} />
        ))}
      </div>
    </div>
  );
}

function decisionHeadline(item: NgeeAnnDecisionPrioritiesViewModel["items"][number]): string {
  const preferred = item.horizons.find((horizon) => horizon.label === "Rolling 7 days" && horizon.status === "available")
    ?? item.horizons.find((horizon) => horizon.label === "Rolling 28 days" && horizon.status === "available")
    ?? item.horizons.find((horizon) => horizon.status === "available");
  if (!preferred || preferred.relativePct === null) return item.finding;

  const periodLabel = preferred.label === "Rolling 7 days"
    ? "Recent 7-day"
    : preferred.label === "Rolling 28 days"
      ? "28-day"
      : "Latest complete-day";
  const magnitude = formatNumber(Math.abs(preferred.relativePct), 1);
  const comparison = preferred.relativePct > 0
    ? `${magnitude}% above`
    : preferred.relativePct < 0
      ? `${magnitude}% below`
      : "in line with";
  return `${periodLabel} usage is ${comparison} its comparable baseline; ${item.recurrenceDayCount} daily exception${item.recurrenceDayCount === 1 ? "" : "s"} need review.`;
}

function HorizonComparisonRow({
  horizon,
  maxMagnitude,
}: {
  horizon: NgeeAnnDecisionPrioritiesViewModel["items"][number]["horizons"][number];
  maxMagnitude: number;
}) {
  const available = horizon.status === "available"
    && horizon.actualKwh !== null
    && horizon.baselineKwh !== null
    && horizon.deltaKwh !== null
    && horizon.relativePct !== null;
  const direction = !available
    ? "unavailable"
    : horizon.relativePct! > 0
      ? "increase"
      : horizon.relativePct! < 0
        ? "decrease"
        : "flat";
  const magnitude = available ? Math.min(50, Math.abs(horizon.relativePct!) / maxMagnitude * 50) : 0;
  const left = direction === "decrease" ? 50 - magnitude : 50;
  const accessibleLabel = available
    ? `${horizon.label}, ${horizon.period}: ${formatKwh(horizon.actualKwh!)} kWh versus ${formatKwh(horizon.baselineKwh!)} kWh governed baseline; ${formatSigned(horizon.deltaKwh!)} kWh, ${formatSigned(horizon.relativePct!, 1)}%`
    : `${horizon.label}, ${horizon.period}: unavailable${horizon.limitation ? `; ${horizon.limitation}` : ""}`;

  return (
    <div
      role="img"
      aria-label={accessibleLabel}
      data-horizon-label={horizon.label}
      data-direction={direction}
      className="grid gap-2 sm:grid-cols-[minmax(9.5rem,13rem)_minmax(12rem,1fr)_minmax(8rem,10rem)] sm:items-center sm:gap-4"
    >
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{horizon.label}</p>
        <p className="mt-0.5 text-xs leading-5 text-muted">{horizon.period}</p>
        {available ? (
          <p className="mt-0.5 text-xs tabular-nums text-muted">
            {formatKwh(horizon.actualKwh!)} vs {formatKwh(horizon.baselineKwh!)} kWh
          </p>
        ) : null}
      </div>
      <div className="relative h-3 overflow-hidden rounded-full bg-surface-subtle" aria-hidden="true">
        <span className="absolute inset-y-0 left-1/2 w-px bg-muted/45" />
        {available && magnitude > 0 ? (
          <span
            className="absolute inset-y-0 rounded-full bg-primary/70"
            style={{ left: `${left}%`, width: `${magnitude}%` }}
          />
        ) : null}
      </div>
      {available ? (
        <div className="text-left sm:text-right">
          <p className="text-base font-semibold tabular-nums text-foreground">
            {formatSigned(horizon.relativePct!, 1)}%
          </p>
          <p className="mt-0.5 text-xs tabular-nums text-muted">
            {formatSigned(horizon.deltaKwh!)} kWh vs baseline
          </p>
        </div>
      ) : (
        <p className="text-sm leading-5 text-step-warning sm:text-right">
          {horizon.limitation ?? "Unavailable"}
        </p>
      )}
    </div>
  );
}

function formatKwh(value: number): string {
  return formatNumber(value, 2);
}

function formatSigned(value: number, maximumFractionDigits = 2): string {
  const formatted = formatNumber(Math.abs(value), maximumFractionDigits);
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}

function formatNumber(value: number, maximumFractionDigits: number): string {
  return new Intl.NumberFormat("en-SG", {
    maximumFractionDigits,
    minimumFractionDigits: 0,
    useGrouping: true,
  }).format(value);
}

function PriorityField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-semibold text-foreground">{label}</dt>
      <dd className="mt-1 text-muted">{value}</dd>
    </div>
  );
}

function priorityStateMessage(view: NgeeAnnDecisionPrioritiesViewModel): { title: string; detail: string } | null {
  if (view.status === "available") return null;
  if (view.status === "empty") {
    return {
      title: "No deterministic theme for this Period",
      detail: "The released daily rule found no eligible exception to rank from the current Evidence.",
    };
  }
  if (view.status === "suppressed") {
    return {
      title: "Theme conclusion suppressed",
      detail: view.limitation ?? "Candidate dates did not pass the released Calendar, coverage, quality or baseline gates.",
    };
  }
  if (view.status === "partial") {
    return {
      title: view.items.length > 0 ? "Themes use partial supporting Evidence" : "No complete theme conclusion",
      detail: view.limitation ?? "Some candidate Evidence is suppressed, partial or unavailable.",
    };
  }
  return {
    title: "Decision themes unavailable",
    detail: view.limitation ?? "The server-owned priority contract is unavailable for this Snapshot.",
  };
}
