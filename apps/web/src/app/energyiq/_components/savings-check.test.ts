import { describe, expect, it } from "vitest";
import { combineDays, savingsResult, type SavingsDay } from "./savings-check";

/** Consecutive days from `first`, Monday-Friday open, with kWh chosen per date. */
const days = (first: string, count: number, kwh: (date: string, open: boolean, index: number) => number | null, complete = (_date: string) => true): SavingsDay[] =>
  Array.from({ length: count }, (_, index) => {
    const value = new Date(`${first}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() + index);
    const date = value.toISOString().slice(0, 10);
    const open = value.getUTCDay() >= 1 && value.getUTCDay() <= 5;
    return { date, kwh: kwh(date, open, index), open, complete: complete(date) };
  });

describe("savings check", () => {
  it("compares the days after a change with the usual open and closed days before it", () => {
    // Before 15 Oct: 100 kWh on open days, 40 on closed days (with a little noise). After: 20% less on both.
    const series = days("2026-09-17", 56, (date, open, index) => {
      const usual = open ? 100 : 40;
      const noise = index % 2 === 0 ? 1 : -1;
      return date > "2026-10-15" ? usual * 0.8 + noise : date === "2026-10-15" ? 999 : usual + noise;
    });
    const result = savingsResult(series, "2026-10-15");
    expect(result.status).toBe("saving");
    if (result.status !== "saving") return;
    expect(result.baselineDays).toBe(28);
    expect(result.afterDays).toBe(27);
    expect(result.savedPct).toBeCloseTo(20, 0);
    expect(result.savedKwh).toBeGreaterThan(result.noiseKwh);
    // The change day itself (999 kWh) is in neither side.
    expect(result.actualKwh).toBeLessThan(27 * 100);
  });

  it("calls a difference smaller than normal day-to-day ups and downs unclear", () => {
    const series = days("2026-09-17", 40, (date, _open, index) => (index % 2 === 0 ? 130 : 70) - (date > "2026-10-15" ? 2 : 0));
    expect(savingsResult(series, "2026-10-15").status).toBe("unclear");
  });

  it("waits for enough complete days on each side, and ignores incomplete ones", () => {
    const series = days("2026-10-10", 10, () => 50, date => date !== "2026-10-17");
    expect(savingsResult(series, "2026-10-15")).toEqual({ status: "need-baseline", baselineDays: 5 });
    const later = days("2026-10-01", 18, () => 50, date => date !== "2026-10-17");
    expect(savingsResult(later, "2026-10-15")).toEqual({ status: "too-early", baselineDays: 14, afterDays: 2 });
  });

  it("adds devices together and counts a day only when every device's day is complete", () => {
    const a = days("2026-10-01", 3, () => 10);
    const b = days("2026-10-01", 3, () => 5, date => date !== "2026-10-02");
    expect(combineDays([a, b])).toEqual([
      { date: "2026-10-01", kwh: 15, open: true, complete: true },
      { date: "2026-10-02", kwh: 15, open: true, complete: false },
      { date: "2026-10-03", kwh: 15, open: false, complete: true },
    ]);
  });
});
