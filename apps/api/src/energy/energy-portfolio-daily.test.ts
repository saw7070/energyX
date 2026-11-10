import { describe, expect, it } from "vitest";
import type { EnergyIqAnalysisInterval } from "@datafoundry/metadata";
import { siteDailyFigures } from "./energy-portfolio-daily.js";

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
