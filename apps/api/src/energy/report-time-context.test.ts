import { describe, expect, it } from "vitest";

import { resolveReportTimeContext } from "./report-time-context.js";

describe("resolveReportTimeContext", () => {
  it("resolves one trusted cutoff into reusable Singapore Overview windows", () => {
    const context = resolveReportTimeContext({
      binding: {
        workspaceId: "workspace-a",
        projectId: "project-a",
        scopeId: "project",
        resource: "electricity",
        dataSnapshotId: "snapshot-b",
        projectReleaseId: "release-3"
      },
      timezone: "Asia/Singapore",
      asOf: "2026-06-17T00:15:00.000Z",
      acceptedDataEndExclusive: "2026-06-16T16:00:00.000Z",
      lastRefreshedAt: "2026-06-17T00:10:00.000Z",
      policy: {
        policyId: "standard-energy-overview",
        revision: "report-time-policy-v1",
        windows: [
          {
            windowId: "recent-operations",
            role: "recent_operations",
            label: "Recent operations",
            strategy: { kind: "rolling_complete_days", days: 28 }
          },
          {
            windowId: "month-progress",
            role: "current_month_progress",
            label: "Month progress",
            strategy: { kind: "calendar_month_to_date" }
          }
        ]
      }
    });

    expect(context.dataThroughLocalDate).toBe("2026-06-16");
    expect(context.windows).toEqual([
      expect.objectContaining({
        windowId: "recent-operations",
        phase: "complete",
        from: "2026-05-19T16:00:00.000Z",
        toExclusive: "2026-06-16T16:00:00.000Z",
        completeDayCount: 28
      }),
      expect.objectContaining({
        windowId: "month-progress",
        phase: "partial",
        from: "2026-05-31T16:00:00.000Z",
        toExclusive: "2026-06-16T16:00:00.000Z",
        completeDayCount: 16
      })
    ]);
  });

  it("resolves complete months, same-progress history, forecast and a day-type baseline by role", () => {
    const context = resolveReportTimeContext({
      binding: {
        workspaceId: "workspace-a",
        projectId: "project-a",
        scopeId: "project",
        resource: "electricity",
        dataSnapshotId: "snapshot-b",
        projectReleaseId: "release-3"
      },
      timezone: "Asia/Singapore",
      asOf: "2026-06-17T00:15:00.000Z",
      acceptedDataEndExclusive: "2026-06-16T16:00:00.000Z",
      lastRefreshedAt: "2026-06-17T00:10:00.000Z",
      policy: {
        policyId: "standard-energy-overview",
        revision: "report-time-policy-v1",
        windows: [
          {
            windowId: "recent-operations",
            role: "recent_operations",
            label: "Recent operations",
            strategy: { kind: "rolling_complete_days", days: 28 }
          },
          {
            windowId: "month-progress",
            role: "current_month_progress",
            label: "Month progress",
            strategy: { kind: "calendar_month_to_date" }
          },
          {
            windowId: "completed-month-trend",
            role: "completed_month_trend",
            label: "Completed month trend",
            strategy: { kind: "completed_calendar_months", months: 3 }
          },
          {
            windowId: "same-progress-history",
            role: "same_progress_comparison",
            label: "Same-progress comparison",
            strategy: {
              kind: "prior_equivalent_progress",
              months: 2,
              sourceWindowId: "month-progress"
            }
          },
          {
            windowId: "next-month-outlook",
            role: "forecast_horizon",
            label: "Next full month",
            strategy: { kind: "next_complete_calendar_month" }
          },
          {
            windowId: "day-type-baseline",
            role: "day_type_reference",
            label: "Day-type baseline",
            strategy: {
              kind: "same_day_type_baseline",
              lookbackDays: 60,
              sourceWindowId: "recent-operations"
            }
          }
        ]
      }
    });

    expect(context.windows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        windowId: "completed-month-trend",
        from: "2026-02-28T16:00:00.000Z",
        toExclusive: "2026-05-31T16:00:00.000Z",
        completeDayCount: 92,
        segments: [
          { from: "2026-02-28T16:00:00.000Z", toExclusive: "2026-03-31T16:00:00.000Z" },
          { from: "2026-03-31T16:00:00.000Z", toExclusive: "2026-04-30T16:00:00.000Z" },
          { from: "2026-04-30T16:00:00.000Z", toExclusive: "2026-05-31T16:00:00.000Z" }
        ]
      }),
      expect.objectContaining({
        windowId: "same-progress-history",
        from: "2026-03-31T16:00:00.000Z",
        toExclusive: "2026-05-16T16:00:00.000Z",
        completeDayCount: 32,
        segments: [
          { from: "2026-04-30T16:00:00.000Z", toExclusive: "2026-05-16T16:00:00.000Z" },
          { from: "2026-03-31T16:00:00.000Z", toExclusive: "2026-04-16T16:00:00.000Z" }
        ]
      }),
      expect.objectContaining({
        windowId: "next-month-outlook",
        phase: "forecast",
        from: "2026-06-30T16:00:00.000Z",
        toExclusive: "2026-07-31T16:00:00.000Z",
        completeDayCount: 31
      }),
      expect.objectContaining({
        windowId: "day-type-baseline",
        from: "2026-03-20T16:00:00.000Z",
        toExclusive: "2026-05-19T16:00:00.000Z",
        completeDayCount: 60
      })
    ]));
  });

  it("counts complete local days across a daylight-saving transition instead of assuming 24-hour days", () => {
    const context = resolveReportTimeContext({
      binding: {
        workspaceId: "workspace-a",
        projectId: "project-a",
        scopeId: "project",
        resource: "electricity",
        dataSnapshotId: "snapshot-b",
        projectReleaseId: "release-3"
      },
      timezone: "America/New_York",
      asOf: "2026-03-10T12:00:00.000Z",
      acceptedDataEndExclusive: "2026-03-10T04:00:00.000Z",
      lastRefreshedAt: "2026-03-10T04:15:00.000Z",
      policy: {
        policyId: "standard-energy-overview",
        revision: "report-time-policy-v1",
        windows: [{
          windowId: "recent-operations",
          role: "recent_operations",
          label: "Recent operations",
          strategy: { kind: "rolling_complete_days", days: 3 }
        }]
      }
    });

    expect(context.windows[0]).toEqual(expect.objectContaining({
      from: "2026-03-07T05:00:00.000Z",
      toExclusive: "2026-03-10T04:00:00.000Z",
      completeDayCount: 3
    }));
    expect(Date.parse(context.windows[0]!.toExclusive) - Date.parse(context.windows[0]!.from))
      .toBe(71 * 60 * 60 * 1_000);
  });

  it("compares a complete calendar-month edition with the full previous month even when month lengths differ", () => {
    const context = resolveReportTimeContext({
      binding: {
        workspaceId: "preschool-demo-org",
        projectId: "preschool-demo",
        scopeId: "preschool-project",
        resource: "electricity",
        dataSnapshotId: "snapshot-june",
        projectReleaseId: "release-calendar-month",
      },
      timezone: "Asia/Singapore",
      asOf: "2026-07-01T00:15:00.000Z",
      acceptedDataEndExclusive: "2026-06-30T16:00:00.000Z",
      lastRefreshedAt: "2026-07-01T00:10:00.000Z",
      policy: {
        policyId: "preschool-report-time",
        revision: "2",
        windows: [
          {
            windowId: "current-overview",
            role: "current_progress",
            label: "Current calendar month Report Edition",
            strategy: { kind: "calendar_month_to_date" },
          },
          {
            windowId: "previous-month-comparison",
            role: "comparison",
            label: "Previous complete calendar month",
            strategy: {
              kind: "prior_equivalent_progress",
              months: 1,
              sourceWindowId: "current-overview",
            },
          },
        ],
      },
    });

    expect(context.windows).toEqual([
      expect.objectContaining({
        windowId: "current-overview",
        phase: "complete",
        from: "2026-05-31T16:00:00.000Z",
        toExclusive: "2026-06-30T16:00:00.000Z",
        completeDayCount: 30,
      }),
      expect.objectContaining({
        windowId: "previous-month-comparison",
        phase: "complete",
        from: "2026-04-30T16:00:00.000Z",
        toExclusive: "2026-05-31T16:00:00.000Z",
        completeDayCount: 31,
        segments: [{
          from: "2026-04-30T16:00:00.000Z",
          toExclusive: "2026-05-31T16:00:00.000Z",
        }],
      }),
    ]);
  });

  it("fails closed when the accepted data boundary is later than the trusted refresh or as-of instant", () => {
    expect(() => resolveReportTimeContext({
      binding: {
        workspaceId: "workspace-a",
        projectId: "project-a",
        scopeId: "project",
        resource: "electricity",
        dataSnapshotId: "snapshot-b",
        projectReleaseId: "release-3"
      },
      timezone: "Asia/Singapore",
      asOf: "2026-06-16T15:00:00.000Z",
      acceptedDataEndExclusive: "2026-06-16T16:00:00.000Z",
      lastRefreshedAt: "2026-06-16T15:30:00.000Z",
      policy: {
        policyId: "standard-energy-overview",
        revision: "report-time-policy-v1",
        windows: [{
          windowId: "recent-operations",
          role: "recent_operations",
          label: "Recent operations",
          strategy: { kind: "rolling_complete_days", days: 28 }
        }]
      }
    })).toThrow("ENERGYIQ_REPORT_TIME_CONTEXT_CHRONOLOGY_INVALID");
  });

  it("rejects a policy resolution that is not bound to an exact Project identity", () => {
    expect(() => resolveReportTimeContext({
      binding: {
        workspaceId: "workspace-a",
        projectId: "",
        scopeId: "project",
        resource: "electricity",
        dataSnapshotId: "snapshot-b",
        projectReleaseId: "release-3"
      },
      timezone: "Asia/Singapore",
      asOf: "2026-06-17T00:15:00.000Z",
      acceptedDataEndExclusive: "2026-06-16T16:00:00.000Z",
      lastRefreshedAt: "2026-06-17T00:10:00.000Z",
      policy: {
        policyId: "standard-energy-overview",
        revision: "report-time-policy-v1",
        windows: [{
          windowId: "recent-operations",
          role: "recent_operations",
          label: "Recent operations",
          strategy: { kind: "rolling_complete_days", days: 28 }
        }]
      }
    })).toThrow("ENERGYIQ_REPORT_TIME_CONTEXT_BINDING_INVALID");
  });
});
