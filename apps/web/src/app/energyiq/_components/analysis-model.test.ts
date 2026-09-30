import { describe, expect, it } from "vitest";
import type { ScopeData, TrendCell } from "./analysis-data";
import {
  aboveBenchmarkWhenClosed, alwaysOnKw, categoryTotals, closedUseBreakdown, dayTypeBaselines, findAnomalies, hourlyProfile, isOpenHour,
  localDayType, lowestNightKw, meterHeatmap, openingLabel, overnightFloor, percentChange, savingsPlan, statusFor, storyProfile, timeBuckets, topHours, weekdayWindows, type AnalysisDay,
} from "./analysis-model";

const day = (date: string, dayType: AnalysisDay["dayType"], totalKwh: number, complete = true): AnalysisDay => ({ date, dayType, complete, totalKwh, byCategory: { load: totalKwh * 0.6, light: totalKwh * 0.4 } });
const cells = (dates: string[], kwhAt: (date: string, hour: number) => number): TrendCell[] => dates.flatMap(date => Array.from({ length: 24 }, (_, hour) => [date, hour, kwhAt(date, hour), 60, 0] as TrendCell));
const scope = (dates: string[], kwhAt: (date: string, hour: number) => number, extra: Partial<ScopeData> = {}): ScopeData => ({
  id: "project", name: "Campus", dates, timezone: "Asia/Singapore", total: { id: "__scope__", expectedMinutesPerHour: 60, cells: cells(dates, kwhAt) }, types: {}, meters: [],
  usageKwh: null, peakKw: null, peakAt: null, cost: null, typeTotals: {}, coverage: 100, ...extra,
});
const datesFrom = (start: string, count: number) => Array.from({ length: count }, (_, index) => new Date(Date.parse(`${start}T00:00:00Z`) + index * 86_400_000).toISOString().slice(0, 10));

describe("analysis calculations", () => {
  it("sets an expected level per day type from complete days only, and needs three samples", () => {
    const days = [day("2026-06-01", "weekday", 200), day("2026-06-02", "weekday", 220), day("2026-06-03", "weekday", 240), day("2026-06-04", "weekday", 999, false), day("2026-06-06", "weekend", 70), day("2026-06-07", "weekend", 90)];
    expect(dayTypeBaselines(days)).toEqual([
      { dayType: "weekday", samples: 3, expectedKwh: 220 },
      { dayType: "weekend", samples: 2, expectedKwh: null },
      { dayType: "public_holiday", samples: 0, expectedKwh: null },
    ]);
  });

  it("flags complete days more than 15% above their day-type level and ignores days without a level", () => {
    const baselines = [{ dayType: "weekday" as const, samples: 20, expectedKwh: 200 }, { dayType: "weekend" as const, samples: 2, expectedKwh: null }];
    const anomalies = findAnomalies([day("2026-06-11", "weekday", 240), day("2026-06-12", "weekday", 230), day("2026-06-13", "weekday", 260, false), day("2026-06-14", "weekend", 500)], baselines);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]).toMatchObject({ date: "2026-06-11", dayType: "weekday", totalKwh: 240, expectedKwh: 200 });
    expect(anomalies[0]!.deltaPct).toBeCloseTo(20);
  });

  it("splits energy by category with shares and keeps a fixed category order", () => {
    expect(categoryTotals([day("2026-06-01", "weekday", 100), { ...day("2026-06-02", "weekday", 0), byCategory: { aircon: 50 } }])).toEqual([
      { category: "light", kwh: 40, share: 40 / 150 }, { category: "load", kwh: 60, share: 0.4 }, { category: "aircon", kwh: 50, share: 50 / 150 },
    ]);
  });

  it("compares with the previous period and classifies public holidays before weekends", () => {
    expect(percentChange(110, 100)).toBeCloseTo(10);
    expect(percentChange(110, 0)).toBeNull();
    const holidays = new Map([["2026-08-09", "National Day"]]);
    expect(localDayType("2026-08-09", holidays)).toEqual({ dayType: "public_holiday", holidayName: "National Day" });
    expect(localDayType("2026-08-08", holidays)).toEqual({ dayType: "weekend" });
    expect(localDayType("2026-08-10", holidays)).toEqual({ dayType: "weekday" });
  });

  it("averages each clock hour over the chosen days and ranks the highest complete hours", () => {
    const site = scope(["2026-08-10", "2026-08-11"], (date, hour) => hour === 9 ? (date === "2026-08-10" ? 10 : 6) : 1);
    const rows = hourlyProfile(site, ["2026-08-10", "2026-08-11"]);
    expect(rows).toHaveLength(24);
    expect(rows[9]).toEqual({ hour: 9, total: 8 });
    expect(rows[0]).toEqual({ hour: 0, total: 1 });
    expect(topHours(site, 2)).toEqual([{ date: "2026-08-10", hour: 9, kwh: 10 }, { date: "2026-08-11", hour: 9, kwh: 6 }]);
  });

  it("splits weekday energy into published operating hours and 22:00–06:00", () => {
    const hours = { monday: [{ from: "09:00", to: "18:00" }] };
    expect(isOpenHour(hours, "2026-08-10", 9)).toBe(true);
    expect(isOpenHour(hours, "2026-08-10", 18)).toBe(false);
    expect(isOpenHour(hours, "2026-08-11", 9)).toBe(false);
    expect(openingLabel(hours)).toBe("09:00–18:00");
    expect(openingLabel(null)).toBe("08:00–18:00");
    const site = scope(["2026-08-10", "2026-08-15"], () => 1);
    const windows = weekdayWindows(site, [day("2026-08-10", "weekday", 24), day("2026-08-15", "weekend", 24)], hours);
    expect(windows).toMatchObject({ total: 24, open: 9, night: 8 });
    expect(windows.nightShare).toBeCloseTo(8 / 24);
  });

  it("uses sub-meters for the heatmap when a space has them, largest first", () => {
    const dates = ["2026-08-10"];
    const series = (id: string, kwh: number) => ({ id, expectedMinutesPerHour: 60, cells: cells(dates, () => kwh) });
    const space = scope(dates, () => 5, { meters: [
      { id: "total", name: "Level total", location: "L6", category: "load", official: true, series: series("total", 5) },
      { id: "fan", name: "Fan", location: "L6", category: "load", official: false, series: series("fan", 1) },
      { id: "light", name: "Lights", location: "L6", category: "light", official: false, series: series("light", 2) },
    ] });
    const heat = meterHeatmap(space, dates);
    expect(heat.map(row => row.id)).toEqual(["light", "fan"]);
    expect(heat[0]!.hours[3]).toBe(2);
  });

  it("finds the lowest overnight load already held for a week and compares it with the latest week", () => {
    const dates = datesFrom("2026-07-01", 21);
    const site = scope(dates, (date, hour) => hour < 6 ? (date < "2026-07-08" ? 2 : date >= "2026-07-15" ? 5 : 3) : 8);
    expect(overnightFloor(site)).toMatchObject({ bestKw: 2, bestFrom: "2026-07-01", bestTo: "2026-07-07", latestKw: 5, latestFrom: "2026-07-15", latestTo: "2026-07-21", nights: 21 });
    expect(overnightFloor(scope(dates.slice(0, 10), () => 1))).toBeNull();
  });

  it("splits energy into open hours, weekday evenings, weekends and public holidays, with default hours when none are published", () => {
    const days = [day("2026-08-07", "weekday", 24), day("2026-08-08", "weekend", 24), day("2026-08-10", "public_holiday", 24)];
    const site = scope(["2026-08-07", "2026-08-08", "2026-08-10"], () => 1);
    const split = timeBuckets(site, days, null);
    expect(split.kwh).toEqual({ open: 10, after_hours: 14, weekend: 24, holiday: 24 });
    expect(split).toMatchObject({ total: 72, closedKwh: 62 });
    expect(split.closedShareOfHours).toBeCloseTo(62 / 72);
    expect(timeBuckets(site, days, { friday: [{ from: "09:00", to: "12:00" }], saturday: [{ from: "09:00", to: "11:00" }] }).kwh).toEqual({ open: 5, after_hours: 21, weekend: 22, holiday: 24 });
  });

  it("finds the always-on load and the closed-hours energy above a benchmark", () => {
    const dates = ["2026-08-10", "2026-08-11", "2026-08-12"];
    const site = scope(dates, (date, hour) => hour < 6 ? (date === "2026-08-12" ? 3 : 2) : hour >= 8 && hour < 18 ? 10 : 4);
    expect(alwaysOnKw(site)).toBe(2);
    expect(alwaysOnKw(scope(dates.slice(0, 2), () => 1))).toBeNull();
    const days = dates.map(date => day(date, "weekday", 0));
    // Closed hours: 00–06 (2, 2, 3 kW) and 06–08, 18–24 at 4 kW; benchmark 2 kW.
    expect(aboveBenchmarkWhenClosed(site, days, null, 2)).toBeCloseTo(3 * 8 * 2 + 6 * 1);
  });

  it("splits an average day into always-on minimum, open-hours use and avoidable closed-hours use", () => {
    const site = scope(["2026-08-10"], (_date, hour) => hour >= 8 && hour < 18 ? 10 : 3);
    const rows = storyProfile(site, [day("2026-08-10", "weekday", 0)], null, 2);
    expect(rows[3]).toEqual({ hour: 3, closed: true, base: 2, working: 0, avoidable: 1, total: 3 });
    expect(rows[9]).toEqual({ hour: 9, closed: false, base: 2, working: 8, avoidable: 0, total: 10 });
  });

  it("lists what runs while closed per circuit, with the unmetered rest of each space and essential equipment flagged", () => {
    const dates = ["2026-08-10"];
    const series = (id: string, kwhAt: (hour: number) => number) => ({ id, expectedMinutesPerHour: 60, cells: cells(dates, (_date, hour) => kwhAt(hour)) });
    const space = scope(dates, () => 3, { id: "l2", name: "Level 2", total: series("__scope__", () => 3), meters: [
      { id: "total", name: "Level total", location: "L2", category: "load", official: true, series: series("total", () => 3) },
      { id: "tv", name: "Showroom TV", location: "L2", category: "load", official: false, series: series("tv", () => 1) },
      { id: "fridge", name: "Fridge and Water Dispenser", location: "L2", category: "load", official: false, series: series("fridge", () => 0.5) },
    ] });
    const rows = closedUseBreakdown(scope(dates, () => 3), [space], new Map(), null);
    expect(rows.map(row => [row.id, row.kind, row.essential, row.closedKwh])).toEqual([["l2:rest", "remainder", false, 21], ["tv", "circuit", false, 14], ["fridge", "circuit", true, 7]]);
    expect(rows[1]!.closedKw).toBe(1);
    const byType = closedUseBreakdown(scope(dates, () => 3, { types: { light: series("__category__:light", hour => hour >= 8 && hour < 18 ? 2 : 0.5) } }), [], new Map(), null);
    expect(byType.map(row => [row.id, row.kind, row.closedKwh])).toEqual([["type:light", "type", 7]]);
  });

  it("finds a low overnight level a meter has already reached, from at least five complete nights", () => {
    const dates = datesFrom("2026-07-01", 10);
    const night = (date: string) => Number(date.slice(8, 10));
    const site = scope(dates, (date, hour) => hour < 6 ? night(date) : 20);
    expect(lowestNightKw(site.total)).toBe(1);
    expect(lowestNightKw(scope(dates.slice(0, 4), () => 1).total)).toBeNull();
  });

  it("prices switch-off savings as kW × closed hours a year × rate and counts only non-overlapping items", () => {
    const row = (id: string, closedKw: number, essential = false, lowestKw: number | null = null, aboveLowestKwh = 0) => ({ id, name: id, space: "L2", category: "load" as const, kind: "circuit" as const, totalKwh: 100, closedKwh: 50, closedHours: 50, closedKw, essential, lowestKw, aboveLowestKwh });
    const plan = savingsPlan({ projectName: "Campus", closedUse: [row("tv", 1, false, 0.2, 28), row("fridge", 0.5, true), row("sign", 0.2), row("fan", 0.1), row("lamp", 0.1), row("heater", 0.1), row("tiny", 0.01)], closedHoursPerYear: 6000, rate: 0.3, currency: "SGD",
      aboveBenchmarkKwh: 100, benchmarkKw: 2, periodDays: 28, anomalies: [{ date: "2026-08-12", dayType: "weekday", totalKwh: 300, expectedKwh: 250, deltaPct: 20 }],
      actions: [{ id: "a1", title: "Fix fans", recommendation: "Isolate", state: "proposed", priority: { level: "high", reason: "" } }] });
    expect(plan.map(item => [item.id, item.counted])).toEqual([["off-tv", true], ["off-sign", true], ["off-fan", true], ["off-others", true], ["check-fridge", false], ["unusual-days", false], ["action-a1", false]]);
    expect(plan[0]).toMatchObject({ annualKwh: 6000, math: "1.00 kW × 6,000 hours a year after working hours × SGD 0.3000/kWh" });
    expect(plan[0]!.annualCost).toBeCloseTo(1800);
    // Proven: closed-hours energy above its quietest-night level, scaled to a year (28 kWh in 28 days → 365 kWh).
    expect(plan[0]).toMatchObject({ provenKwh: 365 });
    expect(plan[0]!.provenCost).toBeCloseTo(109.5);
    expect(plan[1]).toMatchObject({ provenKwh: null, provenCost: null });
    expect(plan[3]!.annualKwh).toBeCloseTo(1200);
    const fallback = savingsPlan({ projectName: "Campus", closedUse: [], closedHoursPerYear: 6000, rate: 0.3, currency: "SGD", aboveBenchmarkKwh: 280, benchmarkKw: 2, periodDays: 28, anomalies: [], actions: [] });
    expect(fallback).toHaveLength(1);
    const four = savingsPlan({ projectName: "Campus", closedUse: [row("a", 1), row("b", 0.5), row("c", 0.4), row("d", 0.3), { ...row("rest", 0.6), kind: "remainder" as const }], closedHoursPerYear: 6000, rate: 0.3, currency: "SGD", aboveBenchmarkKwh: null, benchmarkKw: null, periodDays: 28, anomalies: [], actions: [] });
    expect(four.map(item => [item.id, item.counted])).toEqual([["off-a", true], ["off-b", true], ["off-c", true], ["off-d", true], ["find-rest", false]]);
    expect(fallback[0]).toMatchObject({ id: "benchmark", annualKwh: 3650, provenKwh: 3650, counted: true, confidence: "High" });
    expect([statusFor(3, 5, 10), statusFor(5, 5, 10), statusFor(12, 5, 10)]).toEqual(["good", "watch", "act"]);
  });
});
