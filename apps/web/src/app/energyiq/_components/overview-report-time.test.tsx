import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { EnergyProjectAnalysisSnapshotDto } from "../../../lib/config-api";
import {
  formatReportDataThrough,
  formatSourceDataCoverage,
  OverviewWindowLabel,
} from "./overview-report-time";

describe("Overview report time presentation", () => {
  it("renders exact Section windows and distinguishes partial facts from forecast", () => {
    const context = reportTimeContext();
    const markup = renderToStaticMarkup(
      <OverviewWindowLabel
        context={context}
        windowIds={["current-month-progress", "next-month-outlook"]}
      />,
    );
    expect(markup).toContain("Current month to date");
    expect(markup).toContain("1 Jun 2026–16 Jun 2026");
    expect(markup).toContain("In progress");
    expect(markup).toContain("Next complete calendar month");
    expect(markup).toContain("1 Jul 2026–31 Jul 2026");
    expect(markup).toContain("Forecast");
  });

  it("uses the immutable ReportTimeContext for Data through", () => {
    const snapshot = {
      context: { to: "2099-01-01T00:00:00.000Z", timezone: "Asia/Singapore" },
      reportTimeContext: reportTimeContext(),
    } as EnergyProjectAnalysisSnapshotDto;
    expect(formatReportDataThrough(snapshot)).toBe("16 Jun 2026");
  });

  it("shows the immutable Snapshot source history separately from the report window", () => {
    const snapshot = {
      context: { to: "2026-08-20T16:00:00.000Z", timezone: "Asia/Singapore" },
      dataSnapshot: {
        id: "snapshot-b",
        importBatchIds: ["batch-l6", "batch-l7"],
        lastSeenAt: "2026-08-20T15:45:00.000Z",
        sourceCoverage: {
          fromLocalDate: "2026-04-21",
          throughLocalDate: "2026-08-20",
        },
      },
    } as EnergyProjectAnalysisSnapshotDto;

    expect(formatSourceDataCoverage(snapshot)).toBe("21 Apr 2026–20 Aug 2026");
  });
});

function reportTimeContext(): NonNullable<EnergyProjectAnalysisSnapshotDto["reportTimeContext"]> {
  return {
    contractRevision: "energyiq-report-time-context@1",
    binding: {
      workspaceId: "default",
      projectId: "ngee-ann-polytechnic",
      scopeId: "project",
      resource: "electricity",
      dataSnapshotId: "snapshot-b",
      projectReleaseId: "release-b",
    },
    timezone: "Asia/Singapore",
    asOf: "2026-06-17T01:00:00.000Z",
    acceptedDataEndExclusive: "2026-06-16T16:00:00.000Z",
    dataThroughLocalDate: "2026-06-16",
    lastRefreshedAt: "2026-06-17T01:00:00.000Z",
    policyId: "ngee-ann-report-time",
    policyRevision: "1",
    windows: [
      {
        windowId: "current-month-progress",
        role: "current_progress",
        label: "Current month to date",
        strategy: { kind: "calendar_month_to_date" },
        phase: "partial",
        from: "2026-05-31T16:00:00.000Z",
        toExclusive: "2026-06-16T16:00:00.000Z",
        completeDayCount: 16,
        segments: [{ from: "2026-05-31T16:00:00.000Z", toExclusive: "2026-06-16T16:00:00.000Z" }],
        comparisonCompatibilityKey: "current",
      },
      {
        windowId: "next-month-outlook",
        role: "forecast",
        label: "Next complete calendar month",
        strategy: { kind: "next_complete_calendar_month" },
        phase: "forecast",
        from: "2026-06-30T16:00:00.000Z",
        toExclusive: "2026-07-31T16:00:00.000Z",
        completeDayCount: 31,
        segments: [{ from: "2026-06-30T16:00:00.000Z", toExclusive: "2026-07-31T16:00:00.000Z" }],
        comparisonCompatibilityKey: "forecast",
      },
    ],
  };
}
