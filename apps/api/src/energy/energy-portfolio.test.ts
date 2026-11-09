import { describe, expect, it } from "vitest";
import type { EnergyIqAnalysisInterval } from "@datafoundry/metadata";
import { dailyUsage, evaluatePeakDemand, findUnusualNight, halfHourDemand, parsePortfolioPeriod, projectMonthEnd } from "./energy-portfolio.js";

/** Hourly intervals in Singapore time (UTC+8) for the given local dates, with kW chosen per local hour. */
const hourly = (dates: string[], kwAt: (date: string, hour: number) => number): EnergyIqAnalysisInterval[] =>
  dates.flatMap((date) => Array.from({ length: 24 }, (_, hour) => {
    const start = new Date(Date.parse(`${date}T00:00:00+08:00`) + hour * 3_600_000);
    return { start: start.toISOString(), end_exclusive: new Date(start.getTime() + 3_600_000).toISOString(), usage_kwh: kwAt(date, hour) };
  }));

const datesFrom = (first: string, count: number): string[] => Array.from({ length: count }, (_, index) => {
  const date = new Date(`${first}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + index);
  return date.toISOString().slice(0, 10);
});

describe("portfolio period", () => {
  it("accepts local dates in order and refuses anything else", () => {
    expect(parsePortfolioPeriod("2026-09-01", "2026-09-30")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(() => parsePortfolioPeriod("2026-09-30", "2026-09-01")).toThrow("ENERGYIQ_PORTFOLIO_PERIOD_INVALID");
    expect(() => parsePortfolioPeriod("yesterday", "2026-09-01")).toThrow("ENERGYIQ_PORTFOLIO_PERIOD_INVALID");
    expect(() => parsePortfolioPeriod("2024-01-01", "2026-09-01")).toThrow("ENERGYIQ_PORTFOLIO_PERIOD_TOO_LONG");
  });
});

describe("daily usage", () => {
  it("adds intervals up by the site's local day", () => {
    const days = dailyUsage(hourly(["2026-10-01", "2026-10-02"], () => 1), "Asia/Singapore");
    expect([...days.entries()]).toEqual([["2026-10-01", 24], ["2026-10-02", 24]]);
  });
});

describe("month-end budget forecast", () => {
  const budget = { monthlyAmount: 3000, currency: "SGD" as const };
  // Weekdays use 100 kWh, weekends 40 kWh.
  const history = new Map(datesFrom("2026-09-03", 28).map((date) => {
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    return [date, weekday === 0 || weekday === 6 ? 40 : 100];
  }));

  it("adds a typical same-weekday day for each day still to come and prices it at this month's average", () => {
    // October 2026: readings through the 10th (1,000 kWh, S$300), 21 days to go: 15 weekdays and 6 weekend days.
    const status = projectMonthEnd({ month: "2026-10", today: "2026-10-11", dataThrough: "2026-10-10", actualKwh: 1000, actualCost: 300, tariffCurrency: "SGD", daily: history, budget });
    expect(status).toMatchObject({ month: "2026-10", daysInMonth: 31, actualKwh: 1000, forecastKwh: 1000 + 15 * 100 + 6 * 40, actualCost: 300, status: "on-track" });
    expect(status.forecastCost).toBeCloseTo(300 + (15 * 100 + 6 * 40) * 0.3, 2);
  });

  it("warns before the budget is spent, and says so once it is", () => {
    // S$1.50 a kWh so far: S$1,500 spent, S$4,110 expected by month end.
    const atRisk = projectMonthEnd({ month: "2026-10", today: "2026-10-11", dataThrough: "2026-10-10", actualKwh: 1000, actualCost: 1500, tariffCurrency: "SGD", daily: history, budget });
    expect(atRisk.status).toBe("at-risk");
    const over = projectMonthEnd({ month: "2026-10", today: "2026-10-11", dataThrough: "2026-10-10", actualKwh: 1000, actualCost: 3100, tariffCurrency: "SGD", daily: history, budget });
    expect(over.status).toBe("over");
  });

  it("falls back to kWh when money cannot be compared", () => {
    const status = projectMonthEnd({
      month: "2026-10", today: "2026-10-11", dataThrough: "2026-10-10", actualKwh: 1000, actualCost: 300, tariffCurrency: "MYR",
      daily: history, budget: { ...budget, monthlyKwh: 2500 },
    });
    expect(status).toMatchObject({ costNote: "currency-differs", status: "at-risk" });
    expect(status.forecastCost).toBeUndefined();
    expect(projectMonthEnd({ month: "2026-10", today: "2026-10-01", actualKwh: 0, daily: new Map(), budget }).status).toBe("no-data");
  });

  it("estimates this month's cost at the recent price when the month is not priced yet", () => {
    const status = projectMonthEnd({ month: "2026-10", today: "2026-10-11", dataThrough: "2026-10-10", actualKwh: 1000, historyRate: { rate: 0.25, currency: "SGD" }, daily: history, budget });
    expect(status.actualCost).toBe(250);
  });
});

describe("unusual overnight use", () => {
  const nights = datesFrom("2026-09-10", 29);
  const lastNight = nights.at(-1)!;

  it("flags a night well above the usual overnight load", () => {
    const intervals = hourly(nights, (date, hour) => (hour < 6 ? (date === lastNight ? 3.5 : 2) : 10));
    expect(findUnusualNight({ intervals, timezone: "Asia/Singapore", thresholdPct: 30 })).toEqual({
      night: lastNight, nightKw: 3.5, usualKw: 2, abovePct: 75, extraKwh: 9, nightsCompared: 28,
    });
  });

  it("stays quiet for a normal night, a tiny site, or too little history", () => {
    expect(findUnusualNight({ intervals: hourly(nights, (_, hour) => (hour < 6 ? 2 : 10)), timezone: "Asia/Singapore", thresholdPct: 30 })).toBeUndefined();
    expect(findUnusualNight({ intervals: hourly(nights, (date, hour) => (hour < 6 ? (date === lastNight ? 0.15 : 0.05) : 1)), timezone: "Asia/Singapore", thresholdPct: 30 })).toBeUndefined();
    expect(findUnusualNight({ intervals: hourly(nights.slice(-5), (date, hour) => (hour < 6 ? (date === lastNight ? 9 : 2) : 10)), timezone: "Asia/Singapore", thresholdPct: 30 })).toBeUndefined();
  });

  it("ignores a last night with missing readings", () => {
    const intervals = hourly(nights, (date, hour) => (hour < 6 ? (date === lastNight ? 5 : 2) : 10))
      .filter((interval) => !interval.start.startsWith(new Date(Date.parse(`${lastNight}T02:00:00+08:00`)).toISOString().slice(0, 13)))
      .filter((interval) => !interval.start.startsWith(new Date(Date.parse(`${lastNight}T03:00:00+08:00`)).toISOString().slice(0, 13)));
    const finding = findUnusualNight({ intervals, timezone: "Asia/Singapore", thresholdPct: 30 });
    expect(finding?.night).not.toBe(lastNight);
  });
});

/** 15-minute intervals in Singapore time for the given local dates, with kW chosen per local hour and quarter. */
const quarterHourly = (dates: string[], kwAt: (date: string, hour: number, quarter: number) => number): EnergyIqAnalysisInterval[] =>
  dates.flatMap((date) => Array.from({ length: 96 }, (_, index) => {
    const start = new Date(Date.parse(`${date}T00:00:00+08:00`) + index * 900_000);
    return { start: start.toISOString(), end_exclusive: new Date(start.getTime() + 900_000).toISOString(), usage_kwh: kwAt(date, Math.floor(index / 4), index % 4) / 4 };
  }));

describe("peak demand", () => {
  it("averages each complete half-hour, so a single 15-minute spike counts at half its size", () => {
    const halves = halfHourDemand(quarterHourly(["2026-11-03"], (_, hour, quarter) => (hour === 19 && quarter === 0 ? 100 : 10)));
    expect(halves).toHaveLength(48);
    expect(Math.max(...halves.map((half) => half.kw))).toBeCloseTo(55, 6);
    // A half-hour missing one of its quarters is not counted.
    expect(halfHourDemand(quarterHourly(["2026-11-03"], () => 10).slice(1))).toHaveLength(47);
  });

  it("reports this month's peak, a new 30-day high, the limit and the demand charge", () => {
    const dates = datesFrom("2026-10-01", 40); // 1 Oct to 9 Nov
    const intervals = quarterHourly(dates, (date, hour) => (date === "2026-11-09" && hour === 15 ? 60 : hour === 15 ? 40 : 20));
    const status = evaluatePeakDemand({
      intervals,
      timezone: "Asia/Singapore",
      month: "2026-11",
      check: { enabled: true, limitKw: 64, warnPct: 90 },
      tariff: { id: "t", owner: { kind: "project" }, effective_from: "2026-01-01", currency: "MYR", rate_per_kwh: 0.3, fixed_charges: [
        { label: "Capacity charge (per kW of maximum demand)", amount: 29.43, unit: "per_kw_month" },
        { label: "Network charge (per kW of maximum demand)", amount: 59.84, unit: "per_kw_month" },
        { label: "Retail charge", amount: 200, unit: "per_month" },
      ] },
    })!;
    expect(status).toMatchObject({
      month: "2026-11", peakKw: 60, latestDay: "2026-11-09", latestDayPeakKw: 60, previousPeakKw: 40, newHigh: true,
      limitKw: 64, limitStatus: "near", peakHoursOnly: false,
      demandCharge: { perKwMonth: 89.27, currency: "MYR", amount: 5356.2 },
    });
    expect(new Date(status.peakAt).toISOString()).toBe("2026-11-09T07:00:00.000Z");
  });

  it("counts only the tariff's peak hours when it bills peak-hour demand", () => {
    // A weekend spike outside the 2pm-10pm weekday window does not count.
    const intervals = quarterHourly(datesFrom("2026-11-01", 9), (date, hour) => (date === "2026-11-08" && hour === 15 ? 90 : hour === 15 ? 30 : 10));
    const status = evaluatePeakDemand({
      intervals, timezone: "Asia/Singapore", month: "2026-11", check: { enabled: true, warnPct: 90 },
      tariff: { id: "t", owner: { kind: "project" }, effective_from: "2026-01-01", currency: "MYR", rate_per_kwh: 0.3,
        time_of_use: { peak_rate_per_kwh: 0.35, holidays_off_peak: true, peak_windows: [{ days: ["monday", "tuesday", "wednesday", "thursday", "friday"], from: "14:00", to: "22:00" }] },
        fixed_charges: [{ label: "Capacity charge (per kW of peak-hour maximum demand)", amount: 30.19, unit: "per_kw_month" }] },
    })!;
    expect(status.peakHoursOnly).toBe(true);
    expect(status.peakKw).toBe(30);
    expect(status.limitStatus).toBeUndefined();
    expect(status.newHigh).toBe(false);
  });
});
