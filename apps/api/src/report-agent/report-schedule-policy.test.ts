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
