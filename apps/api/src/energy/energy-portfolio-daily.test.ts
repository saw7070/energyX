import { describe, expect, it } from "vitest";
import type { EnergyDailyMeterFacts } from "@datafoundry/data-gateway";
import type { EnergyIqAnalysisInterval } from "@datafoundry/metadata";
import { siteDailyFigures, siteFullDays } from "./energy-portfolio-daily.js";

/** 15-minute intervals in Singapore time (UTC+8) from a local start for a number of hours, at a steady kW. */
const quarterHours = (localStart: string, hours: number, kw: number): EnergyIqAnalysisInterval[] =>
  Array.from({ length: hours * 4 }, (_, index) => {
    const start = Date.parse(`${localStart}+08:00`) + index * 15 * 60_000;
    return { start: new Date(start).toISOString(), end_exclusive: new Date(start + 15 * 60_000).toISOString(), usage_kwh: kw / 4 };
  });
const SEPTEMBER = { from: "2026-09-01", to: "2026-09-30" };

describe("a site's average day on the Portfolio", () => {
  it("is the kWh per day over a whole period of readings, with each day's use", () => {
    const figures = siteDailyFigures({ intervals: quarterHours("2026-09-01T00:00:00", 30 * 24, 2), timezone: "Asia/Singapore", period: SEPTEMBER });
    expect(figures).toMatchObject({ averageDailyKwh: 48, readingDays: 30 });
    expect(figures.dailyKwh).toHaveLength(30);
    expect(new Set(figures.dailyKwh)).toEqual(new Set([48]));
  });

  it("counts a site connected part-way through the period from its first reading", () => {
    // Connected at the start of 21 September: ten days of readings in a 30-day period.
    const figures = siteDailyFigures({ intervals: quarterHours("2026-09-21T00:00:00", 10 * 24, 1), timezone: "Asia/Singapore", period: SEPTEMBER });
    expect(figures).toMatchObject({ averageDailyKwh: 24, readingDays: 10 });
    expect(figures.dailyKwh.slice(0, 20).every(value => value === null)).toBe(true);
    expect(figures.dailyKwh.slice(20)).toEqual(Array(10).fill(24));
    // Connected at noon: the first half-day counts as half a day, so the average stays a whole day's use.
    const noon = siteDailyFigures({ intervals: quarterHours("2026-09-20T12:00:00", 10 * 24 + 12, 1), timezone: "Asia/Singapore", period: SEPTEMBER });
    expect(noon).toMatchObject({ averageDailyKwh: 24, readingDays: 10.5 });
    expect(noon.dailyKwh[19]).toBe(12);
  });

  it("leaves out days lost to an outage instead of counting them as no use", () => {
    const intervals = [...quarterHours("2026-09-01T00:00:00", 10 * 24, 1), ...quarterHours("2026-09-16T00:00:00", 15 * 24, 1)];
    const figures = siteDailyFigures({ intervals, timezone: "Asia/Singapore", period: SEPTEMBER });
    expect(figures).toMatchObject({ averageDailyKwh: 24, readingDays: 25 });
    expect(figures.dailyKwh.slice(10, 15)).toEqual([null, null, null, null, null]);
  });

  it("counts lights-off hours read as 0 kWh as read time, and needs a whole day before giving an average", () => {
    // A lighting circuit: 3 kW from 7 pm to 7 am, read as 0 kWh in the daytime.
    const night = (date: string) => [...quarterHours(`${date}T00:00:00`, 7, 3), ...quarterHours(`${date}T07:00:00`, 12, 0), ...quarterHours(`${date}T19:00:00`, 5, 3)];
    const figures = siteDailyFigures({ intervals: ["2026-09-01", "2026-09-02"].flatMap(night), timezone: "Asia/Singapore", period: SEPTEMBER });
    expect(figures).toMatchObject({ averageDailyKwh: 36, readingDays: 2 });
    expect(siteDailyFigures({ intervals: quarterHours("2026-09-30T18:00:00", 6, 3), timezone: "Asia/Singapore", period: SEPTEMBER })).toMatchObject({ averageDailyKwh: 0, readingDays: 0.3 });
    expect(siteDailyFigures({ intervals: [], timezone: "Asia/Singapore", period: SEPTEMBER })).toMatchObject({ averageDailyKwh: 0, readingDays: 0 });
  });
});

/** One meter's day: kWh read on time, and by default every minute read on time with nothing wrong. */
type MeterDay = { localDate: string; meterPointId: string; usageKwh: number; recoveredKwh: number; validMinutes: number; qualityEventCount: number };
const day = (localDate: string, meterPointId: string, usageKwh: number, extra: Partial<MeterDay> = {}): MeterDay =>
  ({ localDate, meterPointId, usageKwh, recoveredKwh: 0, validMinutes: 1440, qualityEventCount: 0, ...extra });
const METERS = [{ id: "lights", category: "light" }, { id: "power", category: "load" }];
const sum = (rows: MeterDay[], key: "usageKwh" | "recoveredKwh" | "validMinutes" | "qualityEventCount") => rows.reduce((total, row) => total + row[key], 0);
/**
 * The meters' days as the daily meter facts read gives them: the official meters added up for each date with any of
 * their readings, and only the meter-days that were not a whole clean day (a meter with no row that date included).
 */
const compact = (rows: MeterDay[], meters: ReadonlyArray<{ id: string }> = METERS): EnergyDailyMeterFacts => {
  const ids = meters.map((meter) => meter.id);
  const official = rows.filter((row) => ids.includes(row.meterPointId));
  const dates = [...new Set(official.map((row) => row.localDate))].sort();
  return {
    days: dates.map((localDate) => {
      const on = official.filter((row) => row.localDate === localDate);
      return { localDate, usageKwh: sum(on, "usageKwh"), recoveredKwh: sum(on, "recoveredKwh"), validMinutes: sum(on, "validMinutes"), qualityEventCount: sum(on, "qualityEventCount") };
    }),
    meterExceptions: dates.flatMap((localDate) => ids.flatMap((meterPointId) => {
      const on = official.filter((row) => row.localDate === localDate && row.meterPointId === meterPointId);
      const validMinutes = sum(on, "validMinutes"), qualityEventCount = sum(on, "qualityEventCount");
      return validMinutes === 1440 && qualityEventCount === 0 ? [] : [{ localDate, meterPointId, validMinutes, qualityEventCount }];
    })),
  };
};
/** 1–14 September 2026 (Tuesday to Monday): ten weekdays and four weekend days. */
const TWO_WEEKS = { from: "2026-09-01", to: "2026-09-14" };
const twoWeeks = (kwh: (date: string) => number) => Array.from({ length: 14 }, (_, index) => `2026-09-${String(index + 1).padStart(2, "0")}`)
  .flatMap((date) => [day(date, "lights", kwh(date) / 2), day(date, "power", kwh(date) / 2)]);
const weekend = (date: string) => [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
const full = (rows: MeterDay[], extra: Partial<Parameters<typeof siteFullDays>[0]> = {}) =>
  siteFullDays({ period: TWO_WEEKS, timezone: "Asia/Singapore", meters: METERS, facts: compact(rows, extra.meters ?? METERS), ...extra });

describe("a site's average full day on the Portfolio, as its Overview works it out", () => {
  it("counts only days every meter read in full, as the Overview does", () => {
    const facts = twoWeeks(() => 48);
    // 3 September: the lighting meter dropped out for four hours and sent that energy late. The day's total still has
    // every kWh, but the day is not complete, so the shortfall in what was read on time cannot drag the average down.
    const dropped = facts.map((fact) => fact.localDate === "2026-09-03" && fact.meterPointId === "lights"
      ? { ...fact, usageKwh: 20, recoveredKwh: 4, validMinutes: 1200, qualityEventCount: 16 } : fact);
    expect(full(dropped)).toMatchObject({ averageDailyKwh: 48, fullDays: 13 });
    // Every minute arrived, but one reading was wrong: not complete either.
    const wrong = facts.map((fact) => fact.localDate === "2026-09-04" && fact.meterPointId === "power" ? { ...fact, usageKwh: 10, qualityEventCount: 1 } : fact);
    expect(full(wrong)).toMatchObject({ averageDailyKwh: 48, fullDays: 13 });
    // A meter that sent nothing at all on a day has no row for it.
    expect(full(facts.filter((fact) => !(fact.localDate === "2026-09-05" && fact.meterPointId === "power")))).toMatchObject({ averageDailyKwh: 48, fullDays: 13 });
  });

  it("is a week of five weekdays and two weekend days, with public holidays counted as weekend days", () => {
    const facts = twoWeeks((date) => (weekend(date) ? 20 : 50));
    // Ten weekdays at 50 kWh and four weekend days at 20: (5 × 50 + 2 × 20) / 7, not the plain mean of 41.4.
    expect(full(facts)).toMatchObject({ averageDailyKwh: 41.43, fullDays: 14 });
    // Lost weekend days do not tilt it: a weekend day still weighs two sevenths of the week.
    expect(full(facts.filter((fact) => fact.localDate !== "2026-09-06" && fact.localDate !== "2026-09-13"))).toMatchObject({ averageDailyKwh: 41.43, fullDays: 12 });
    // A public holiday (Wednesday 2 September here) is a day off: it joins the weekend days.
    const holiday = facts.map((fact) => (fact.localDate === "2026-09-02" ? { ...fact, usageKwh: 10 } : fact));
    expect(full(holiday, { holidays: new Map([["2026-09-02", "Holiday"]]) }).averageDailyKwh).toBeCloseTo((50 * 5 + 2 * ((20 * 4 + 20) / 5)) / 7, 2);
  });

  it("averages every complete day alike for lights that run every night", () => {
    const facts = twoWeeks((date) => (weekend(date) ? 20 : 50));
    expect(full(facts, { meaning: "lights_on" })).toMatchObject({ averageDailyKwh: 41.43 });
    expect(full(facts.filter((fact) => !weekend(fact.localDate)), { meaning: "lights_on" })).toMatchObject({ averageDailyKwh: 50, fullDays: 10 });
  });

  it("does not let a meter marked not in use, or idle, stop a day from being complete, and keeps its energy", () => {
    const facts = [...twoWeeks(() => 48), ...["2026-09-01", "2026-09-02"].map((date) => day(date, "spare", 1, { validMinutes: 600 }))];
    const meters = [...METERS, { id: "spare", category: "plug" }];
    // A spare circuit that sent nothing on most days would otherwise leave the site without a single full day.
    expect(full(facts, { meters })).toMatchObject({ averageDailyKwh: null, fullDays: 0 });
    const judged = full(facts, { meters, silentMeterIds: new Set(["spare"]) });
    // The two weekdays it measured something (1 and 2 September) keep that energy: 49 kWh instead of 48.
    expect(judged.fullDays).toBe(14);
    expect(judged.averageDailyKwh).toBeCloseTo(((49 * 2 + 48 * 8) / 10 * 5 + 48 * 2) / 7, 2);
    // A silent meter that did read the whole day is taken out with all its minutes, so another meter's gap still shows.
    const whole = [...twoWeeks(() => 48).map((fact) => (fact.localDate === "2026-09-03" && fact.meterPointId === "power" ? { ...fact, validMinutes: 1000 } : fact)),
      ...twoWeeks(() => 2).filter((fact) => fact.meterPointId === "lights").map((fact) => ({ ...fact, meterPointId: "spare" }))];
    expect(full(whole, { meters, silentMeterIds: new Set(["spare"]) })).toMatchObject({ fullDays: 13 });
  });

  it("has no average full day without a complete day, and names the meters short on the last day", () => {
    const facts = twoWeeks(() => 48).map((fact) => (fact.meterPointId === "power" ? { ...fact, validMinutes: 1000 } : fact));
    expect(full(facts)).toEqual({ averageDailyKwh: null, fullDays: 0, shortOnLastDay: ["power"] });
    expect(full([])).toEqual({ averageDailyKwh: null, fullDays: 0, shortOnLastDay: [] });
    expect(full(twoWeeks(() => 48)).shortOnLastDay).toEqual([]);
    // A meter that sent nothing at all on the last day is short of it too.
    expect(full(twoWeeks(() => 48).filter((fact) => !(fact.localDate === "2026-09-14" && fact.meterPointId === "lights"))).shortOnLastDay).toEqual(["lights"]);
    // A meter already expected to be silent is not a candidate for the idle check.
    expect(full(facts, { silentMeterIds: new Set(["power"]) }).shortOnLastDay).toEqual([]);
    // Days outside the period, and meters that are not official, are ignored.
    const clean = compact(twoWeeks(() => 48));
    const extra: EnergyDailyMeterFacts = {
      days: [...clean.days, { localDate: "2026-09-15", usageKwh: 500, recoveredKwh: 0, validMinutes: 0, qualityEventCount: 3 }],
      meterExceptions: [...clean.meterExceptions, { localDate: "2026-09-01", meterPointId: "elsewhere", validMinutes: 0, qualityEventCount: 9 }],
    };
    expect(siteFullDays({ period: TWO_WEEKS, timezone: "Asia/Singapore", meters: METERS, facts: extra })).toEqual({ averageDailyKwh: 48, fullDays: 14, shortOnLastDay: [] });
  });

  it("stays quick for a year of a large site, which sends a row a day rather than one per meter a day", () => {
    const meters = Array.from({ length: 200 }, (_, index) => ({ id: `meter-${index}`, category: "load" }));
    const year = { from: "2026-01-01", to: "2026-12-31" };
    const days = Array.from({ length: 365 }, (_, index) => new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10));
    // Ten meters are marked not in use and sent nothing all year; one meter read only 600 minutes on 1 June.
    const facts: EnergyDailyMeterFacts = {
      days: days.map((localDate) => ({ localDate, usageKwh: 2000, recoveredKwh: 0, validMinutes: 190 * 1440 - (localDate === "2026-06-01" ? 840 : 0), qualityEventCount: 0 })),
      meterExceptions: [
        { localDate: "2026-06-01", meterPointId: "meter-0", validMinutes: 600, qualityEventCount: 0 },
        ...days.flatMap((localDate) => Array.from({ length: 10 }, (_, index) => ({ localDate, meterPointId: `meter-${190 + index}`, validMinutes: 0, qualityEventCount: 0 }))),
      ],
    };
    const silentMeterIds = new Set(meters.slice(190).map((meter) => meter.id));
    const started = performance.now();
    const judged = siteFullDays({ period: year, timezone: "Asia/Singapore", meters, facts, silentMeterIds });
    expect(performance.now() - started).toBeLessThan(500);
    expect(judged).toMatchObject({ averageDailyKwh: 2000, fullDays: 364 });
    // Without the meters marked not in use taken out, no day is complete.
    expect(siteFullDays({ period: year, timezone: "Asia/Singapore", meters, facts })).toMatchObject({ averageDailyKwh: null, fullDays: 0 });
  });
});
