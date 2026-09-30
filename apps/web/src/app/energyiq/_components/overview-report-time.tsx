import React from "react";

import type { EnergyProjectAnalysisSnapshotDto } from "../../../lib/config-api";

type ReportTimeContext = NonNullable<EnergyProjectAnalysisSnapshotDto["reportTimeContext"]>;

export function OverviewWindowLabel({
  context,
  windowIds,
}: {
  context?: ReportTimeContext;
  windowIds: readonly string[];
}) {
  if (!context) return null;
  const windows = windowIds.flatMap((windowId) => {
    const window = context.windows.find((candidate) => candidate.windowId === windowId);
    return window ? [window] : [];
  });
  if (windows.length === 0) return null;
  return (
    <div className="flex max-w-xl flex-wrap justify-end gap-x-3 gap-y-1 text-xs text-muted" aria-label="Section report window">
      {windows.map((window) => (
        <span key={window.windowId} data-report-window={window.windowId}>
          <strong className="font-semibold text-foreground">{window.label}</strong>
          {" · "}{formatWindowRange(window, context.timezone)}
          {window.phase === "forecast" ? " · Forecast" : window.phase === "partial" ? " · In progress" : ""}
        </span>
      ))}
    </div>
  );
}

export function formatReportDataThrough(snapshot: EnergyProjectAnalysisSnapshotDto): string {
  const localDate = snapshot.reportTimeContext?.dataThroughLocalDate;
  if (!localDate) {
    return formatInstant(new Date(Date.parse(snapshot.context.to) - 1).toISOString(), snapshot.context.timezone);
  }
  return formatLocalDate(localDate, snapshot.reportTimeContext!.timezone);
}

export function formatSourceDataCoverage(snapshot: EnergyProjectAnalysisSnapshotDto): string | null {
  const coverage = snapshot.dataSnapshot.sourceCoverage;
  if (!coverage) return null;
  const from = formatLocalDate(coverage.fromLocalDate, snapshot.context.timezone);
  const through = formatLocalDate(coverage.throughLocalDate, snapshot.context.timezone);
  return from === through ? from : `${from}–${through}`;
}

function formatWindowRange(
  window: ReportTimeContext["windows"][number],
  timezone: string,
): string {
  const from = formatInstant(window.from, timezone);
  const through = formatInstant(
    new Date(Date.parse(window.toExclusive) - 1).toISOString(),
    timezone,
  );
  return from === through ? from : `${from}–${through}`;
}

function formatLocalDate(localDate: string, timezone: string): string {
  const [year, month, day] = localDate.split("-").map(Number);
  return new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: timezone,
  }).format(new Date(Date.UTC(year!, month! - 1, day!, 12)));
}

function formatInstant(value: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: timezone,
  }).format(new Date(value));
}
