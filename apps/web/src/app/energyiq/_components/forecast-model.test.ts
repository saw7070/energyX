import { describe, expect, it } from "vitest";
import type { EnergyOperatingCalendarRevisionDto, EnergyTariffScheduleRevisionDto } from "../../../lib/config-api";
import { datesIn, dayPriceOn, forecastNextMonth, nextMonth, rateOn, typicalDays, type HistoryDay } from "./forecast-model";

const weekday = [{ from: "09:00", to: "18:00" }];
const revision = {
  version_id: "c1", project_id: "p", timezone: "Asia/Singapore", published_by: "u", published_at: "2026-07-01T00:00:00Z",
  entries: [{ id: "e1", owner: { kind: "project" as const }, effective_from: "2026-01-01", weekly: { monday: weekday, tuesday: weekday, wednesday: weekday, thursday: weekday, friday: weekday, saturday: [], sunday: [] },
    exceptions: [{ date: "2026-10-05", operating: [], label: "Company day", classification: "special_closure" as const }] }],
} as unknown as EnergyOperatingCalendarRevisionDto;
const tariff = {
  version_id: "t1", project_id: "p", published_by: "u", published_at: "2026-07-01T00:00:00Z",
  entries: [{ id: "r1", owner: { kind: "project" as const }, effective_from: "2026-06-30T16:00:00.000Z", effective_to: "2026-10-15T16:00:00.000Z", currency: "SGD", rate_per_kwh: 0.3, rate_basis: "tax_exclusive" as const, tax: { name: "GST", rate_pct: 9 } }],
} as EnergyTariffScheduleRevisionDto;
// Weekdays near 100 kWh, weekends near 60, with one incomplete day that must be ignored.
const history: HistoryDay[] = [
  ...["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"].map((date, index) => ({ date, kwh: 96 + index * 2, complete: true })),
  { date: "2026-09-12", kwh: 60, complete: true }, { date: "2026-09-13", kwh: 64, complete: true },
  { date: "2026-09-14", kwh: 12, complete: false },
];

describe("next month window", () => {
  it("takes the whole calendar month after today, rolling over the year", () => {
    expect(nextMonth("2026-09-23")).toEqual({ from: "2026-10-01", toExclusive: "2026-11-01" });
    expect(nextMonth("2026-12-02")).toEqual({ from: "2027-01-01", toExclusive: "2027-02-01" });
    expect(datesIn("2026-10-01", "2026-11-01")).toHaveLength(31);
  });
});

describe("typical days", () => {
  it("separates open days from closed days and ignores days with missing readings", () => {
    expect(typicalDays(history, revision)).toEqual({ basis: "complete", typical: [
      { kind: "open", days: 5, average: 100, low: 96, high: 104 },
      { kind: "closed", days: 2, average: 62, low: 60, high: 64 },
    ] });
  });
});

describe("rateOn", () => {
  it("uses the rate period covering that local day and nothing after it ends", () => {
    expect(rateOn("2026-10-15", tariff, "Asia/Singapore")?.rate_per_kwh).toBe(0.3);
    expect(rateOn("2026-10-16", tariff, "Asia/Singapore")).toBeNull();
  });
});

describe("forecastNextMonth", () => {
  const forecast = forecastNextMonth({ history, revision, tariff, timeZone: "Asia/Singapore", today: "2026-09-23" })!;
  it("counts October's open and closed days from the published calendar, including a closure", () => {
    expect(forecast.month).toEqual({ from: "2026-10-01", toExclusive: "2026-11-01" });
    // 22 weekdays in October 2026, minus the company closure on 5 October.
    expect([forecast.openDays, forecast.closedDays]).toEqual([21, 10]);
    expect(forecast.named).toEqual([{ date: "2026-10-05", name: "Company day" }]);
  });
  it("estimates energy and cost as a range, and stops costing when no rate is saved", () => {
    expect(forecast.kwh.mid).toBeCloseTo(21 * 100 + 10 * 62, 6);
    expect(forecast.kwh.low).toBeLessThan(forecast.kwh.mid);
    expect(forecast.kwh.high).toBeGreaterThan(forecast.kwh.mid);
    // Only 1–15 October is priced: 10 open days and 5 closed days (the 5 October closure) at SGD 0.30.
    expect(forecast.cost).toMatchObject({ currency: "SGD", beforeTax: true, taxName: "GST", taxPct: 9 });
    expect(forecast.cost!.mid).toBeCloseTo((10 * 100 + 5 * 62) * 0.3, 6);
    expect(forecast.missingRateFrom).toBe("2026-10-16");
    expect(forecast.sampleDays).toBe(7);
  });
  it("gives nothing from too few days, or when a kind of day in the month was never measured", () => {
    // One day cannot describe a normal day.
    expect(forecastNextMonth({ history: [{ date: "2026-09-14", kwh: 12, complete: false }], revision, tariff, timeZone: "Asia/Singapore", today: "2026-09-23" })).toBeNull();
    // Only weekends measured, but October has open days too.
    const weekendsOnly = ["2026-09-05", "2026-09-06", "2026-09-12"].map(date => ({ date, kwh: 60, complete: true }));
    expect(forecastNextMonth({ history: weekendsOnly, revision, tariff, timeZone: "Asia/Singapore", today: "2026-09-23" })).toBeNull();
  });
});

describe("day by day", () => {
  it("returns every day of the month so the shape can be drawn", () => {
    const forecast = forecastNextMonth({ history, revision, tariff, timeZone: "Asia/Singapore", today: "2026-09-23" })!;
    expect(forecast.days).toHaveLength(31);
    expect(forecast.days[0]).toMatchObject({ date: "2026-10-01", open: true, kwh: 100 });
    expect(forecast.days.find(day => day.date === "2026-10-03")).toMatchObject({ open: false, kwh: 62 });
    expect(forecast.days.find(day => day.date === "2026-10-05")).toMatchObject({ open: false, name: "Company day" });
    expect(forecast.days.reduce((sum, day) => sum + day.kwh, 0)).toBeCloseTo(forecast.kwh.mid, 6);
  });
  it("says what kind of day each one is, so a closure reads differently from a weekend", () => {
    const forecast = forecastNextMonth({ history, revision, tariff, timeZone: "Asia/Singapore", today: "2026-09-23" })!;
    expect(forecast.days.find(day => day.date === "2026-10-01")!.kind).toBe("open");
    expect(forecast.days.find(day => day.date === "2026-10-03")!.kind).toBe("weekend");
    expect(forecast.days.find(day => day.date === "2026-10-05")!.kind).toBe("special_closure");
  });
  it("splits the month into working-day and closed-day energy that add up to the total", () => {
    const forecast = forecastNextMonth({ history, revision, tariff, timeZone: "Asia/Singapore", today: "2026-09-23" })!;
    expect(forecast.openKwh).toBeCloseTo(21 * 100, 6);
    expect(forecast.closedKwh).toBeCloseTo(10 * 62, 6);
    expect(forecast.openKwh + forecast.closedKwh).toBeCloseTo(forecast.kwh.mid, 6);
  });
});

describe("days that open for shorter hours", () => {
  // A half-day closure on 12 October: open 09:00–13:00 instead of the usual 09:00–18:00.
  const halfDay = {
    ...revision,
    entries: [{ ...revision.entries[0]!, exceptions: [...revision.entries[0]!.exceptions!, { date: "2026-10-12", operating: [{ from: "09:00", to: "13:00" }], label: "Half day", classification: "special_operating_day" as const }] }],
  } as unknown as EnergyOperatingCalendarRevisionDto;
  const forecast = forecastNextMonth({ history, revision: halfDay, tariff, timeZone: "Asia/Singapore", today: "2026-09-23" })!;
  it("keeps the closed-day energy and only part of the working-hours energy", () => {
    const day = forecast.days.find(item => item.date === "2026-10-12")!;
    expect(forecast.normalOpenHours).toBe(9);
    expect(day).toMatchObject({ open: true, kind: "special_operating_day", shortHours: 4 });
    // 62 kWh of equipment that stays on, plus 4 of the usual 9 working hours of the 38 kWh that opening adds.
    expect(day.kwh).toBeCloseTo(62 + (100 - 62) * 4 / 9, 6);
  });
  it("leaves a half-day in the readings out of the normal working day", () => {
    // 11 September opened 09:00-13:00, so its low reading must not drag the normal working day down.
    const withHalfDay = {
      ...revision,
      entries: [{ ...revision.entries[0]!, exceptions: [...revision.entries[0]!.exceptions!, { date: "2026-09-11", operating: [{ from: "09:00", to: "13:00" }], label: "Half day", classification: "special_operating_day" as const }] }],
    } as unknown as EnergyOperatingCalendarRevisionDto;
    const sample: HistoryDay[] = [...history.slice(0, 4), { date: "2026-09-11", kwh: 70, complete: true }, ...history.slice(5)];
    // Counted together, the four full days and the half-day average 93.2; with the exception known, only the full days count.
    expect(typicalDays(sample, withHalfDay).typical.find(item => item.kind === "open")!.average).toBeCloseTo(93.2, 6);
    expect(typicalDays(sample, withHalfDay, 9).typical.find(item => item.kind === "open")).toMatchObject({ days: 4, average: 99 });
  });
  it("counts the shorter day in the month's total instead of a full working day", () => {
    const full = forecastNextMonth({ history, revision, tariff, timeZone: "Asia/Singapore", today: "2026-09-23" })!;
    expect(forecast.kwh.mid).toBeCloseTo(full.kwh.mid - (100 - (62 + (100 - 62) * 4 / 9)), 6);
    expect(forecast.days.reduce((sum, day) => sum + day.kwh, 0)).toBeCloseTo(forecast.kwh.mid, 6);
  });
});

describe("when readings are incomplete", () => {
  it("falls back to days with gaps, drops clearly partial days, and says the basis is partial", () => {
    const patchy: HistoryDay[] = [
      { date: "2026-09-07", kwh: 98, complete: false }, { date: "2026-09-08", kwh: 102, complete: false },
      { date: "2026-09-09", kwh: 100, complete: false }, { date: "2026-09-12", kwh: 60, complete: false },
      // A day cut short by a late start: well under half the median, so it must not drag the estimate down.
      { date: "2026-09-13", kwh: 9, complete: false },
    ];
    const result = typicalDays(patchy, revision);
    expect(result.basis).toBe("partial");
    expect(result.typical).toEqual([
      { kind: "open", days: 3, average: 100, low: 98, high: 102 },
      { kind: "closed", days: 1, average: 60, low: 60, high: 60 },
    ]);
    const forecast = forecastNextMonth({ history: patchy, revision, tariff, timeZone: "Asia/Singapore", today: "2026-09-23" })!;
    expect(forecast.basis).toBe("partial");
    expect(forecast.kwh.mid).toBeCloseTo(21 * 100 + 10 * 60, 6);
  });
  it("still gives nothing when no day has any readings", () => {
    expect(forecastNextMonth({ history: [{ date: "2026-09-14", kwh: null, complete: false }], revision, tariff, timeZone: "Asia/Singapore", today: "2026-09-23" })).toBeNull();
  });
});

describe("forecast price with peak and off-peak hours", () => {
  const entry = {
    id: "tou", owner: { kind: "project" as const }, effective_from: "2020-01-01T00:00:00+08:00", currency: "MYR", rate_per_kwh: 0.48,
    time_of_use: { peak_rate_per_kwh: 0.6, peak_windows: [{ days: ["monday", "tuesday", "wednesday", "thursday", "friday"] as Array<"monday" | "tuesday" | "wednesday" | "thursday" | "friday">, from: "14:00", to: "22:00" }], holidays_off_peak: true },
  };
  it("prices a weekday a third at peak, and weekends and off-peak holidays at the off-peak price", () => {
    expect(dayPriceOn(entry, "2026-11-04", false)).toBeCloseTo(0.48 + 0.12 / 3, 6);
    expect(dayPriceOn(entry, "2026-11-07", false)).toBe(0.48);
    expect(dayPriceOn(entry, "2026-11-09", true)).toBe(0.48);
    expect(dayPriceOn({ ...entry, time_of_use: undefined }, "2026-11-04", false)).toBe(0.48);
  });
});
