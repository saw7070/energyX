import React from "react";

import { anomalyIncidentDomId } from "./ngee-ann-overview-links";
import type { NgeeAnnOverviewViewModel } from "./ngee-ann-overview-view-model";

export function NgeeAnnSummaryFindings({ view }: { view: NgeeAnnOverviewViewModel }) {
  const total = view.highlights.find((highlight) => highlight.id === "total");
  const leadingLevel = view.levelComparison.status === "available" ? view.levelComparison.rows[0] : null;
  const projectComponents = view.componentCategoryBreakdown.status === "available"
    ? view.componentCategoryBreakdown.scopes[0]
    : null;
  const leadingComponentCategory = projectComponents?.period.categories[0] ?? null;
  const leadingCircuit = view.energyComposition.circuits.status === "available"
    ? view.energyComposition.circuits.rows[0]
    : null;
  const projectWeekday = view.dayProfile.profiles.find((profile) =>
    profile.dayType === "weekday" && profile.scopeName === view.context.scopeName,
  ) ?? view.dayProfile.profiles.find((profile) => profile.dayType === "weekday");
  const projectWeekend = view.dayProfile.profiles.find((profile) =>
    profile.dayType === "weekend" && profile.scopeName === view.context.scopeName,
  ) ?? view.dayProfile.profiles.find((profile) => profile.dayType === "weekend");
  const firstIncident = view.dailyAnomalies.incidents[0] ?? null;

  const findings = [
    {
      id: "monitoring-scope",
      title: "Monitoring scope",
      items: [
        `${view.context.periodRange}: ${total?.value ?? "Unavailable"}${total?.unit ? ` ${total.unit}` : ""} across ${view.context.scopeName}.`,
        `${view.dataStatus.label}: ${view.dataStatus.coverage}; ${view.dataStatus.intervals}.`,
      ],
      href: "#ngee-ann-evidence",
      linkLabel: "Open Evidence",
    },
    {
      id: "consumption-level",
      title: "Consumption by Level",
      items: leadingLevel ? [
        `${leadingLevel.name}: ${leadingLevel.currentUsageKwh} kWh (${leadingLevel.projectShare} of official Project energy).`,
        leadingLevel.movement.status === "available"
          ? `Validated movement: ${leadingLevel.changeKwh} (${leadingLevel.changePct}) versus the previous window.`
          : "A validated Level movement is unavailable for this Snapshot.",
      ] : [view.levelComparison.reason ?? "Level facts are unavailable."],
      href: "#ngee-ann-energy-health",
      linkLabel: "Open Level evidence",
    },
    {
      id: "category-mix",
      title: "Category mix (component Circuits)",
      items: leadingComponentCategory ? [
        `${leadingComponentCategory.label}: ${leadingComponentCategory.usageKwh} kWh (${leadingComponentCategory.sharePct} of the component subtotal).`,
        leadingCircuit
          ? `Highest published component Circuit: ${leadingCircuit.name}, ${leadingCircuit.currentUsageKwh} kWh.`
          : "Circuit ranking is unavailable for this Snapshot.",
      ] : [view.componentCategoryBreakdown.reason ?? "Component Category facts are unavailable."],
      href: "#ngee-ann-circuit-analysis",
      linkLabel: "Open Circuit evidence",
    },
    {
      id: "day-type",
      title: "Day-type & hourly behaviour",
      items: [
        profileFinding(projectWeekday, "Weekday"),
        profileFinding(projectWeekend, "Weekend"),
      ],
      href: "#ngee-ann-day-profile-analysis",
      linkLabel: "Open Day Profile",
    },
    {
      id: "peaks-anomalies",
      title: "Peaks & anomalies",
      items: [
        view.peakBreakdown.status === "available"
          ? `${view.peakBreakdown.peakLabel}: ${view.peakBreakdown.averageKw} kW at ${view.peakBreakdown.peakAt}.`
          : view.peakBreakdown.reason ?? "Peak evidence is unavailable.",
        firstIncident
          ? `First review item: ${firstIncident.scopeName} on ${firstIncident.dateLabel}, ${firstIncident.actualKwh} kWh versus ${firstIncident.baselineKwh} kWh baseline.`
          : "No triggered daily incident is available for review.",
      ],
      href: firstIncident ? `#${anomalyIncidentDomId(firstIncident.incidentId)}` : "#ngee-ann-daily-trend",
      linkLabel: "Open exception evidence",
    },
    {
      id: "anomaly-flags",
      title: "Anomaly flags",
      items: view.dailyAnomalies.status === "available" ? [
        `${view.dailyAnomalies.outcomeSummary.triggered} triggered day(s), ${view.dailyAnomalies.outcomeSummary.withinThreshold} within threshold and ${view.dailyAnomalies.outcomeSummary.suppressed} suppressed.`,
        firstIncident
          ? `${firstIncident.scopeName} · ${firstIncident.dateLabel}: ${firstIncident.impactKwh} kWh (${firstIncident.relativePct}) above its governed baseline.`
          : "No triggered daily incident is available.",
      ] : [view.dailyAnomalies.reason ?? "Daily anomaly facts are unavailable."],
      href: "#ngee-ann-daily-trend",
      linkLabel: "Open anomaly list",
    },
  ];

  return (
    <div className="grid border-b border-border md:grid-cols-2 xl:grid-cols-3">
      {findings.map((finding) => (
        <article key={finding.id} data-summary-finding={finding.id} className="min-w-0 border-b border-border px-5 py-5 md:[&:nth-child(odd)]:border-r xl:[&:nth-child(3n+1)]:border-r xl:[&:nth-child(3n+2)]:border-r xl:[&:nth-child(2n)]:border-r-0 xl:[&:nth-last-child(-n+3)]:border-b-0 lg:px-7">
          <h3 className="text-sm font-semibold text-foreground">{finding.title}</h3>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-muted">
            {finding.items.map((item, index) => <li key={`${finding.id}:${index}`} className="flex gap-2"><span aria-hidden="true" className="mt-2.5 h-1 w-1 shrink-0 rounded-full bg-muted" /><span>{item}</span></li>)}
          </ul>
          <a href={finding.href} className="mt-4 inline-flex min-h-10 items-center text-xs font-semibold text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
            {finding.linkLabel}
          </a>
        </article>
      ))}
    </div>
  );
}

function profileFinding(
  profile: NgeeAnnOverviewViewModel["dayProfile"]["profiles"][number] | undefined,
  label: string,
): string {
  if (!profile || profile.summary.status === "unavailable") {
    return `${label} profile is unavailable for this Snapshot.`;
  }
  return `${label}: peak mean ${profile.summary.peakUsage} kWh at ${profile.summary.peakHourLabel} across ${profile.summary.sampleDayCount} complete day(s).`;
}
