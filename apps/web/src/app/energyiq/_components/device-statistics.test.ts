import { describe, expect, it } from "vitest";
import type { EnergyOperatingCalendarEntryDto } from "../../../lib/config-api";
import { deviceStatistics, hourlyByDay, isOpenDay, openingHoursLabel, operatingMinutes, periodDates, type HourCell } from "./device-statistics";

const weekday = [{ from: "09:00", to: "18:00" }];
const calendar = [{
  id: "hours", owner: { kind: "project" }, effective_from: "2026-07-01", effective_to: "2027-01-01",
  weekly: { monday: weekday, tuesday: weekday, wednesday: weekday, thursday: weekday, friday: weekday, saturday: [], sunday: [] },
  exceptions: [{ date: "2026-08-10", operating: [], label: "National Day (observed)", classification: "public_holiday" }],
}] as unknown as EnergyOperatingCalendarEntryDto[];

describe("operatingMinutes", () => {
  it("counts partial hours, weekends and holidays from the calendar in force", () => {
    expect(operatingMinutes(calendar, "2026-08-11", 9)).toBe(60); // Tuesday
    expect(operatingMinutes(calendar, "2026-08-11", 8)).toBe(0);
    expect(operatingMinutes(calendar, "2026-08-11", 17)).toBe(60);
    expect(operatingMinutes(calendar, "2026-08-11", 18)).toBe(0);
    expect(operatingMinutes(calendar, "2026-08-15", 10)).toBe(0); // Saturday
    expect(operatingMinutes(calendar, "2026-08-10", 10)).toBe(0); // public holiday
    expect(operatingMinutes(calendar, "2027-02-01", 10)).toBe(0); // no calendar in force
    expect(isOpenDay(calendar, "2026-08-10")).toBe(false);
    expect(isOpenDay(calendar, "2026-08-11")).toBe(true);
  });
});

describe("periodDates", () => {
  it("lists local dates of an end-exclusive window", () => {
    const dates = periodDates("2026-08-13T16:00:00.000Z", "2026-09-10T16:00:00.000Z", "Asia/Singapore");
    expect(dates[0]).toBe("2026-08-14");
    expect(dates[dates.length - 1]).toBe("2026-09-10");
    expect(dates).toHaveLength(28);
  });
});

describe("deviceStatistics", () => {
  const day = (date: string, kwh: (hour: number) => number): HourCell[] => Array.from({ length: 24 }, (_, hour) => [date, hour, kwh(hour), 60, 0]);
  const cells = [...day("2026-08-11", hour => hour >= 9 && hour < 18 ? 2 : 0.5), ...day("2026-08-15", () => 0.5)];
  const stats = deviceStatistics(cells, ["2026-08-11", "2026-08-15"], calendar);

  it("splits energy into opening and out-of-hours using the calendar", () => {
    // Tuesday: 9 open hours × 2 kWh + 15 closed hours × 0.5; Saturday: 24 × 0.5, all closed.
    expect(stats.outOfHoursKwh).toBeCloseTo(15 * 0.5 + 24 * 0.5);
    expect(stats.outOfHoursPct).toBeCloseTo((19.5 / (18 + 19.5)) * 100);
  });

  it("reports the always-on draw, daily averages and an hourly profile", () => {
    expect(stats.alwaysOnKw).toBe(0.5);
    expect(stats.openDayAverageKwh).toBeCloseTo(25.5);
    expect(stats.closedDayAverageKwh).toBeCloseTo(12);
    expect(stats.profileKw[10]).toBeCloseTo(1.25);
    expect(stats.daily.map(item => item.open)).toEqual([true, false]);
    expect(stats.receivedPct).toBe(100);
  });

  it("splits the typical day into open and closed days", () => {
    expect(stats.openProfileKw[10]).toBe(2);
    expect(stats.closedProfileKw[10]).toBe(0.5);
    expect([stats.openDays, stats.closedDays]).toEqual([1, 1]);
  });

  it("judges completeness against the number of meters in a whole-site series", () => {
    const twoMeters = cells.map(([date, hour, kwh, , quality]) => [date, hour, kwh, 120, quality] as HourCell);
    const site = deviceStatistics(twoMeters, ["2026-08-11", "2026-08-15"], calendar, 120);
    expect(site.receivedPct).toBe(100);
    expect(site.openDayAverageKwh).toBeCloseTo(25.5);
    expect(deviceStatistics(twoMeters.map(cell => [cell[0], cell[1], cell[2], 60, 0] as HourCell), ["2026-08-11"], calendar, 120).openDayAverageKwh).toBeNull();
  });

  it("leaves out-of-hours empty without a calendar rather than guessing", () => {
    expect(deviceStatistics(cells, ["2026-08-11"], null).outOfHoursKwh).toBeNull();
  });
});

describe("openingHoursLabel", () => {
  it("groups consecutive days with the same hours", () => {
    expect(openingHoursLabel(calendar)).toBe("Mon–Fri 09:00–18:00");
    expect(openingHoursLabel(null)).toBeNull();
  });
});

describe("hourlyByDay", () => {
  it("gives average kW for each hour of each day, scaling partly received hours and leaving gaps empty", () => {
    const byDay = hourlyByDay([["2026-09-01", 9, 2, 60, 0], ["2026-09-01", 10, 1, 30, 0], ["2026-09-01", 11, null, 0, 0], ["2026-09-09", 1, 5, 60, 0]], ["2026-09-01", "2026-09-02"]);
    expect([...byDay.keys()]).toEqual(["2026-09-01", "2026-09-02"]);
    expect(byDay.get("2026-09-01")!.slice(8, 12)).toEqual([null, 2, 2, null]);
    expect(byDay.get("2026-09-02")!.every(value => value === null)).toBe(true);
  });
});
