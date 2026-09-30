import { describe, expect, it } from "vitest";
import { nextReportRun } from "./report-schedule";

const sgt = "Asia/Singapore";
const at = (iso: string) => new Date(iso);

describe("when the next automatic report is due", () => {
  it("waits for the chosen hour on the day itself, then moves to the next one", () => {
    // Monday 21 Sep 2026, 01:00 SGT: the weekly run at 03:00 has not happened yet.
    expect(nextReportRun(at("2026-09-20T17:00:00Z"), sgt, "weekly", 3)).toEqual({ date: "2026-09-21", hour: 3 });
    // Same Monday at 04:00 SGT: it has run, so the next one is the following Monday.
    expect(nextReportRun(at("2026-09-20T20:00:00Z"), sgt, "weekly", 3)).toEqual({ date: "2026-09-28", hour: 3 });
  });

  it("runs monthly reports on the first of the month", () => {
    expect(nextReportRun(at("2026-09-23T08:00:00Z"), sgt, "monthly", 3)).toEqual({ date: "2026-10-01", hour: 3 });
    // 1 Dec before the hour: due today; after it: the first of January.
    expect(nextReportRun(at("2026-11-30T17:00:00Z"), sgt, "monthly", 3)).toEqual({ date: "2026-12-01", hour: 3 });
    expect(nextReportRun(at("2026-11-30T20:00:00Z"), sgt, "monthly", 3)).toEqual({ date: "2027-01-01", hour: 3 });
  });

  it("gives the sooner of the two when both cadences are on, and nothing when they are off", () => {
    expect(nextReportRun(at("2026-09-23T08:00:00Z"), sgt, "weekly-monthly", 3)).toEqual({ date: "2026-09-28", hour: 3 });
    expect(nextReportRun(at("2026-09-23T08:00:00Z"), sgt, "daily", 3)).toEqual({ date: "2026-09-24", hour: 3 });
    expect(nextReportRun(at("2026-09-23T08:00:00Z"), sgt, "off", 3)).toBeNull();
  });

  it("reads the date in the project's timezone, not the reader's", () => {
    // 30 Sep 23:00 UTC is already 07:00 on 1 Oct in Singapore, so that month's run has been and gone.
    expect(nextReportRun(at("2026-09-30T23:00:00Z"), sgt, "monthly", 3)).toEqual({ date: "2026-11-01", hour: 3 });
    // The same instant is still 30 Sep in UTC, where the run is yet to come.
    expect(nextReportRun(at("2026-09-30T23:00:00Z"), "UTC", "monthly", 3)).toEqual({ date: "2026-10-01", hour: 3 });
  });
});
