import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { dueReportPeriods } from "./report-calendar.js";
import { ReportStore, type ReportSettings } from "./report-store.js";
import { withCadenceSkill } from "./report-schedule-policy.js";

describe("periodic reports with full-history exploration", () => {
  it("publishes both issues on a Monday that is also the first of a month", () => {
    expect(dueReportPeriods(new Date("2026-05-31T19:00:00Z"), "Asia/Singapore", "weekly-monthly")).toEqual([
      { cadence: "weekly", period: { from: "2026-05-25", toExclusive: "2026-06-01" } },
      { cadence: "monthly", period: { from: "2026-05-01", toExclusive: "2026-06-01" } },
    ]);
    expect(dueReportPeriods(new Date("2026-05-31T18:59:00Z"), "Asia/Singapore", "weekly-monthly")).toEqual([]);
    expect(dueReportPeriods(new Date("2026-06-01T19:00:00Z"), "Asia/Singapore", "weekly-monthly")).toEqual([]);
  });

  it("publishes a daily issue every day for the full day before, at the site's own hour and time zone", () => {
    // Tuesday 11 August 2026, 06:00 in Singapore (22:00 UTC the evening before): the 10th is complete.
    expect(dueReportPeriods(new Date("2026-08-10T22:00:00Z"), "Asia/Singapore", "daily", 6)).toEqual([
      { cadence: "daily", period: { from: "2026-08-10", toExclusive: "2026-08-11" } },
    ]);
    // An hour earlier is before the chosen hour there, although it is already the 11th.
    expect(dueReportPeriods(new Date("2026-08-10T21:00:00Z"), "Asia/Singapore", "daily", 6)).toEqual([]);
    // The same instant in London is still the 10th, so the full day before is the 9th.
    expect(dueReportPeriods(new Date("2026-08-10T22:00:00Z"), "Europe/London", "daily", 6)).toEqual([
      { cadence: "daily", period: { from: "2026-08-09", toExclusive: "2026-08-10" } },
    ]);
  });

  it("adds the daily issue to the weekly and monthly ones when all three are chosen", () => {
    // Monday 1 June 2026, 03:00 in Singapore: yesterday, last week and last month are all complete.
    expect(dueReportPeriods(new Date("2026-05-31T19:00:00Z"), "Asia/Singapore", "daily-weekly-monthly")).toEqual([
      { cadence: "daily", period: { from: "2026-05-31", toExclusive: "2026-06-01" } },
      { cadence: "weekly", period: { from: "2026-05-25", toExclusive: "2026-06-01" } },
      { cadence: "monthly", period: { from: "2026-05-01", toExclusive: "2026-06-01" } },
    ]);
    // Wednesday 3 June: only the day before.
    expect(dueReportPeriods(new Date("2026-06-02T19:00:00Z"), "Asia/Singapore", "daily-weekly-monthly")).toEqual([
      { cadence: "daily", period: { from: "2026-06-02", toExclusive: "2026-06-03" } },
    ]);
    // Weekly and monthly alone never pick up a daily issue.
    expect(dueReportPeriods(new Date("2026-06-02T19:00:00Z"), "Asia/Singapore", "weekly-monthly")).toEqual([]);
  });

  it("keeps issue continuity when every run analyses overlapping full history", () => {
    const db = new DatabaseSync(":memory:");
    try {
      const store = new ReportStore(db);
      const settings: ReportSettings = { projectId: "p", workspaceId: "w", actorUserId: "u", timezone: "Asia/Singapore", contextNotes: "", fileRefIds: [], useProjectData: true, skill: "Analyse", revision: 0, frequency: "weekly-monthly", localHour: 3, scheduledPrompt: "" };
      const input = { settings, actorUserId: "u", period: { from: "2026-01-01", toExclusive: "2026-09-21" }, reportingPeriod: { from: "2026-09-07", toExclusive: "2026-09-14" }, prompt: "Report", scheduleKey: "p:weekly:2026-09-07:2026-09-14" };
      const weekly=withCadenceSkill(settings,"weekly");
      const monthly=withCadenceSkill(weekly,"monthly");
      expect(weekly.skillRefs?.map(ref=>ref.name)).toEqual(["energy-weekly-brief"]);
      expect(monthly.skillRefs?.map(ref=>ref.name)).toEqual(["energy-monthly-review"]);
      expect(monthly.skillUsage?.at(-1)?.contentHash).toHaveLength(64);
      expect(settings.skillRefs).toBeUndefined();
      const run = store.enqueue(input);
      db.prepare("UPDATE energyiq_report_runs SET status='succeeded', document=json_set(document, '$.status', 'succeeded') WHERE id=?").run(run.id);
      expect(store.enqueue({ ...input, period: { ...input.period, toExclusive: "2026-09-22" } }).id).toBe(run.id);
      expect(store.previousPeriodReport(settings, { from: "2026-09-14", toExclusive: "2026-09-21" })?.id).toBe(run.id);
      expect(store.previousPeriodReport({ ...settings, actorUserId: "other" }, { from: "2026-09-14", toExclusive: "2026-09-21" })).toBeUndefined();
    } finally { db.close(); }
  });
});
