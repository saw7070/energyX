import { describe, expect, it } from "vitest";
import type { EnergyOperatingCalendarEntryDto } from "../../../lib/config-api";
import { calendarPublishEntries, createEmptyCalendarEntry, isOvernightRange } from "../admin/operational-policy-model";
import type { AnalysisData, ScopeData, ScopeMeter, TrendSeries } from "./analysis-data";
import {
  bucketOf, closedUseBreakdown, isOpenHour, openingLabel, openWindowStart, quietHours, savingsPlan, scopeDays, timeBuckets, type HoursByDay,
} from "./analysis-model";
import { isOpenDay, openingHoursLabel, operatingMinutes } from "./device-statistics";
import { calendarEntryForSave, chooseHoursMeaning, defaultSiteSettings, settingsProblem } from "./new-site-settings";
import { dayBars, rangeText, weeklySummary } from "./operating-hours-view";
import { buildSiteReport } from "./site-report-model";

const WEEK = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const NIGHTS: HoursByDay = Object.fromEntries(WEEK.map(day => [day, [{ from: "19:00", to: "07:00" }]]));

describe("hours that run past midnight", () => {
  it("are open from the evening into the next morning, on the day they start", () => {
    const mondayNight: HoursByDay = { monday: [{ from: "19:00", to: "07:00" }] };
    // Monday 3 Aug 2026.
    expect(isOpenHour(mondayNight, "2026-08-03", 18)).toBe(false);
    expect(isOpenHour(mondayNight, "2026-08-03", 19)).toBe(true);
    expect(isOpenHour(mondayNight, "2026-08-03", 23)).toBe(true);
    expect(isOpenHour(mondayNight, "2026-08-04", 0)).toBe(true);
    expect(isOpenHour(mondayNight, "2026-08-04", 6)).toBe(true);
    expect(isOpenHour(mondayNight, "2026-08-04", 7)).toBe(false);
    // Sunday has no hours, so Monday's small hours are closed.
    expect(isOpenHour(mondayNight, "2026-08-03", 3)).toBe(false);
    expect(openWindowStart(mondayNight, "2026-08-04", 3)).toBe("2026-08-03");
    // Hours that stay within the day work exactly as before.
    const office: HoursByDay = { monday: [{ from: "08:00", to: "18:00" }] };
    expect([7, 8, 17, 18].map(hour => isOpenHour(office, "2026-08-03", hour))).toEqual([false, true, true, false]);
    expect(isOpenHour(office, "2026-08-04", 3)).toBe(false);
  });

  it("classify the small hours by the day the night started on", () => {
    const fridayNight: HoursByDay = { friday: [{ from: "19:00", to: "07:00" }] };
    // Saturday 8 Aug: 2 am is still Friday's night shift; 8 am is the weekend.
    expect(bucketOf(fridayNight, "2026-08-08", "weekend", 2)).toBe("open");
    expect(bucketOf(fridayNight, "2026-08-08", "weekend", 8)).toBe("weekend");
    // A public holiday on Monday 10 Aug closes the night that starts on it, small hours included.
    const mondayNight: HoursByDay = { monday: [{ from: "19:00", to: "07:00" }] };
    const dayTypeOf = (date: string) => date === "2026-08-10" ? "public_holiday" as const : "weekday" as const;
    expect(bucketOf(mondayNight, "2026-08-10", "public_holiday", 20, { dayTypeOf })).toBe("holiday");
    expect(bucketOf(mondayNight, "2026-08-11", "weekday", 2, { dayTypeOf })).toBe("holiday");
    expect(bucketOf(mondayNight, "2026-08-11", "weekday", 9, { dayTypeOf })).toBe("after_hours");
  });

  it("are written plainly", () => {
    expect(openingLabel(NIGHTS)).toBe("19:00 → 07:00 next day");
    expect(openingLabel(NIGHTS, "zh-Hans")).toBe("19:00 → 次日 07:00");
    expect(openingLabel(NIGHTS, "ms")).toBe("19:00 → 07:00 hari berikutnya");
    expect(openingLabel({ monday: [{ from: "09:00", to: "18:00" }] })).toBe("09:00–18:00");
    expect(rangeText({ from: "19:00", to: "07:00" })).toBe("19:00 → 07:00 next day");
    expect(isOvernightRange({ from: "19:00", to: "07:00" })).toBe(true);
    expect(isOvernightRange({ from: "19:00", to: "00:00" })).toBe(false);
    expect(isOvernightRange({ from: "08:00", to: "18:00" })).toBe(false);
  });

  it("count the next morning in the hours view and in device figures", () => {
    const weekly = { ...Object.fromEntries(WEEK.map(day => [day, []])), monday: [{ from: "19:00", to: "07:00" }] } as unknown as EnergyOperatingCalendarEntryDto["weekly"];
    expect(weeklySummary(weekly).hours).toBe(12);
    expect(dayBars(weekly, "monday")).toEqual([{ from: 19 * 60, to: 1440 }]);
    expect(dayBars(weekly, "tuesday")).toEqual([{ from: 0, to: 7 * 60 }]);

    const entry = (exceptions: EnergyOperatingCalendarEntryDto["exceptions"], lights = false): EnergyOperatingCalendarEntryDto[] => [{
      id: "e", owner: { kind: "project" }, effective_from: "2026-01-01", weekly: Object.fromEntries(WEEK.map(day => [day, [{ from: "19:00", to: "07:00" }]])) as EnergyOperatingCalendarEntryDto["weekly"],
      ...(exceptions ? { exceptions } : {}), ...(lights ? { hours_meaning: "lights_on" as const } : {}),
    }];
    const plain = entry(undefined);
    expect([3, 7, 12, 19, 23].map(hour => operatingMinutes(plain, "2026-08-04", hour))).toEqual([60, 0, 0, 60, 60]);
    expect(isOpenDay(plain, "2026-08-04")).toBe(true);
    // A day off closes its own night for opening hours, but lights still come on for lights-on hours.
    const holiday = [{ date: "2026-08-10", operating: [], label: "Holiday", classification: "public_holiday" as const }];
    expect(operatingMinutes(entry(holiday), "2026-08-10", 20)).toBe(0);
    expect(operatingMinutes(entry(holiday), "2026-08-11", 3)).toBe(0);
    expect(operatingMinutes(entry(holiday, true), "2026-08-10", 20)).toBe(60);
    expect(openingHoursLabel(plain)).toBe("Mon–Sun 19:00 → 07:00 next day");
  });
});

describe("saving hours that run past midnight", () => {
  it("accepts 19:00 to 07:00 and keeps rejecting a start and end that are the same", () => {
    const draft = { ...createEmptyCalendarEntry("e"), effectiveFrom: "2026-07-01", hoursMeaning: "lights_on" as const };
    const nights = { ...draft, weekly: { ...draft.weekly, monday: [{ key: "m", from: "19:00", to: "07:00" }] } };
    expect(calendarPublishEntries([nights])[0]).toMatchObject({ hoursMeaning: "lights_on", weekly: { monday: [{ from: "19:00", to: "07:00" }] } });
    // Opening hours are the default and are not sent.
    expect(calendarPublishEntries([{ ...nights, hoursMeaning: "opening" }])[0]).not.toHaveProperty("hoursMeaning");
    const empty = { ...draft, weekly: { ...draft.weekly, monday: [{ key: "m", from: "08:00", to: "08:00" }] } };
    expect(() => calendarPublishEntries([empty])).toThrowError("Calendar window 1, monday range 1 starts and ends at the same time.");
  });

  it("lets a new site start with lights-on hours that run overnight", () => {
    const office = defaultSiteSettings("SG");
    const lights = chooseHoursMeaning(office, "lights_on");
    expect(lights.hours).toEqual({ days: WEEK, from: "19:00", to: "07:00", meaning: "lights_on" });
    expect(settingsProblem(lights)).toBeNull();
    expect(calendarEntryForSave(lights)).toMatchObject({ hoursMeaning: "lights_on", weekly: { monday: [{ from: "19:00", to: "07:00" }], sunday: [{ from: "19:00", to: "07:00" }] } });
    expect(calendarEntryForSave(office)).not.toHaveProperty("hoursMeaning");
    expect(settingsProblem({ ...office, hours: { ...office.hours!, from: "18:00", to: "09:00" } })).toBeNull();
    expect(settingsProblem({ ...office, hours: { ...office.hours!, from: "09:00", to: "09:00" } })).toBe("hoursInvalid");
    expect(chooseHoursMeaning(lights, "opening").hours).toEqual(office.hours);
  });
});

// ---------- an estate whose lighting should run at night ----------
// Two weeks from Monday 3 Aug 2026, lights on 19:00–07:00 every night.
const DATES = Array.from({ length: 14 }, (_, index) => new Date(Date.parse("2026-08-03T00:00:00Z") + index * 86_400_000).toISOString().slice(0, 10));
const night = (hour: number) => hour >= 19 || hour < 7;
type Profile = (date: string, hour: number) => number;
const series = (id: string, kwh: Profile): TrendSeries => ({ id, expectedMinutesPerHour: 60, cells: DATES.flatMap(date => Array.from({ length: 24 }, (_, hour) => [date, hour, kwh(date, hour), 60, 0] as TrendSeries["cells"][number])) });
const CIRCUITS: Record<string, { space: string; board: string; category: ScopeMeter["category"]; kwh: Profile }> = {
  // Runs exactly in its hours.
  pavilion: { space: "Pavilion", board: "DB1", category: "light", kwh: (_date, hour) => night(hour) ? 1 : 0 },
  // Left on until 9 am every morning.
  playground: { space: "Playground", board: "DB1", category: "light", kwh: (_date, hour) => night(hour) || hour === 7 || hour === 8 ? 0.5 : 0 },
  // Switched on at 5 pm every evening.
  driveway: { space: "Driveway", board: "DB2", category: "light", kwh: (_date, hour) => night(hour) || hour === 17 || hour === 18 ? 0.8 : 0 },
  // A sign that never switches off.
  signboard: { space: "Entrance", board: "DB2", category: "other", kwh: () => 0.6 },
};
function scope(name: string, ids: string[]): ScopeData {
  const total = series("__scope__", (date, hour) => ids.reduce((sum, id) => sum + CIRCUITS[id]!.kwh(date, hour), 0));
  const usage = total.cells.reduce((sum, cell) => sum + cell[2]!, 0);
  const meters = ids.map((id): ScopeMeter => ({ id, name: `${CIRCUITS[id]!.space} light`, location: CIRCUITS[id]!.board, category: CIRCUITS[id]!.category, official: true, series: series(id, CIRCUITS[id]!.kwh) }));
  return { id: name, name, dates: DATES, timezone: "Asia/Singapore", total, types: {}, meters, usageKwh: usage, peakKw: null, peakAt: null,
    cost: { amount: usage * 0.3, currency: "SGD", note: "0.3 SGD/kWh before tax" }, typeTotals: {}, coverage: 100 };
}
const estate = (ids: string[]): AnalysisData => ({
  projectId: "sktc", projectName: "Sengkang Estate", timezone: "Asia/Singapore", snapshotId: null,
  current: { project: scope("Sengkang Estate", ids), spaces: ids.map(id => scope(CIRCUITS[id]!.space, [id])) },
  // National Day: a holiday does not switch the lights off.
  previous: null, history: null, circuits: [], holidays: new Map([["2026-08-10", "National Day observed"]]), openingHours: NIGHTS, actions: [], hoursMeaning: "lights_on",
});

describe("a site whose hours are lights-on hours", () => {
  const asPlanned = estate(["pavilion", "playground", "driveway"]);
  const project = asPlanned.current.project;
  const days = scopeDays(project, asPlanned.holidays);

  it("splits use into lights-on hours and daytime only, every day of the year", () => {
    const split = timeBuckets(project, days, NIGHTS, "lights_on");
    expect(split.kwh.weekend).toBe(0);
    expect(split.kwh.holiday).toBe(0);
    // Per day: 27.6 kWh at night, 2.6 kWh in the daytime (playground mornings and driveway evenings).
    expect(split.closedKwh).toBeCloseTo(2.6 * 14, 6);
    expect(split.closedShareOfHours).toBe(0.5);
    expect(bucketOf(NIGHTS, "2026-08-10", "public_holiday", 21, { meaning: "lights_on" })).toBe("open");
    expect(bucketOf(NIGHTS, "2026-08-08", "weekend", 12, { meaning: "lights_on" })).toBe("after_hours");
    // The same readings read as opening hours would call the holiday closed.
    expect(timeBuckets(project, days, NIGHTS).kwh.holiday).toBeGreaterThan(0);
  });

  it("takes its quiet level from the daytime, not from 00:00–06:00", () => {
    expect(quietHours(NIGHTS, "lights_on")).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(quietHours(NIGHTS)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("words savings as lights on by day, switched on too early or off too late", () => {
    const closedUse = closedUseBreakdown(project, asPlanned.current.spaces, asPlanned.holidays, NIGHTS, "en", "lights_on");
    expect(closedUse.map(row => row.name)).toEqual(["Driveway light", "Playground light"]);
    const plan = savingsPlan({ projectName: "Sengkang Estate", closedUse, closedHoursPerYear: 4380, rate: 0.3, currency: "SGD", aboveBenchmarkKwh: null, benchmarkKw: null, periodDays: 14, anomalies: [], actions: [], meaning: "lights_on" });
    expect(plan[0]!.title).toBe("Keep Driveway light off in the daytime");
    expect(plan[0]!.detail).toContain("switched on too early or off too late");
    expect(plan[0]!.math).toContain("daytime hours a year");
    const office = savingsPlan({ projectName: "Sengkang Estate", closedUse, closedHoursPerYear: 4380, rate: 0.3, currency: "SGD", aboveBenchmarkKwh: null, benchmarkKw: null, periodDays: 14, anomalies: [], actions: [] });
    expect(office[0]!.title).toBe("Switch off Driveway light after working hours");
  });

  it("leads with a calm headline when the lights ran at night as planned", () => {
    const report = buildSiteReport(asPlanned, null, "2026-09-22T10:00:00Z");
    expect(report.hoursMeaning).toBe("lights_on");
    expect(report.headlineTopic).toBe("night");
    expect(report.title).toEqual({ before: "The lights run ", emphasis: "at night, as planned" });
    expect(report.headline).toBe("Lights ran at night as planned: almost all the electricity was used during the lights-on hours.");
    expect(report.lede).toContain("Almost all of it was used during the lights-on hours, as planned.");
    expect(report.keyFigures[3]!.label).toMatch(/^used in the daytime/);
    expect(report.screening.intro).toContain("**lights-on hours** (7 pm – 7 am)");
    expect(report.screening.intro).toContain("**daytime**");
    expect(report.pattern?.caption).toMatch(/^Average use by hour \(kW\), from 14 complete days\. Shaded band: lights-on hours 7 pm – 7 am\./);
    expect(report.pattern?.intro).toContain("come on at about **7 pm** and go off at about **7 am**");
    const finding = (name: string) => report.circuits.find(circuit => circuit.name === name)!.finding;
    expect(finding("Playground lights")).toContain("Still lit past 7 am on **all 14 mornings**");
    expect(finding("Playground lights")).toContain("usually until 9 am");
    expect(finding("Driveway lights")).toContain("Switched on before 7 pm on **all 14 evenings**, usually from 5 pm.");
    expect(report.screening.callout).toContain("What stands out is lights on outside their hours");
    expect(report.screening.callout).toMatch(/playground lights after 7 am \(~0\.8 kWh a morning\) and driveway lights before 7 pm \(~1\.3 kWh an evening\) could go on timers or daylight sensors, worth about S\$\d+\/month if switched on and off on time/i);
    expect(report.screening.callout).not.toMatch(/working hours|opening hours|closing/);
  });

  it("warns only when daytime use is notable", () => {
    const report = buildSiteReport(estate(["pavilion", "playground", "driveway", "signboard"]), null, "2026-09-22T10:00:00Z");
    expect(report.headlineTopic).toBe("daytime");
    // Per day: 9.8 of 44.6 kWh in the daytime.
    expect(report.title).toEqual({ before: "22% of the electricity is used ", emphasis: "in the daytime" });
    expect(report.headline).toMatch(/^22% of the electricity was used in the daytime, when the lights should be off — about S\$\d+ a month\.$/);
    expect(report.screening.callout).toContain("because it stays on in the daytime too");
    expect(report.screening.callout).toContain("Switching entrance light off in the daytime alone would cut about");
  });

  it("is worded in Chinese and Malay too", () => {
    const prose = (report: ReturnType<typeof buildSiteReport>) => [report.title.before, report.title.emphasis, report.headline, report.lede, report.keyFigures[3]!.label,
      report.screening.intro, report.screening.callout, report.screening.note, report.pattern!.intro, report.pattern!.caption, ...report.circuits.map(circuit => circuit.finding)];
    // Chinese: names from the project and units stay as written; any other Latin word would be a missed translation.
    const chinese = prose(buildSiteReport(asPlanned, null, "2026-09-22T10:00:00Z", "zh-Hans"));
    expect(chinese.flatMap(text => text.match(/[A-Za-z]+/g) ?? []).filter(word => !["Pavilion", "Playground", "Driveway", "Sengkang", "Estate", "kWh", "kW", "S"].includes(word))).toEqual([]);
    // Malay is written in Latin letters too, so look for the English words of these sentences instead.
    const malay = prose(buildSiteReport(asPlanned, null, "2026-09-22T10:00:00Z", "ms")).join(" ");
    expect(malay).not.toMatch(/\b(daytime|lights-on|lights|morning|mornings|evening|evenings|night|switched|before|after|hours|used|planned|almost)\b/i);
    expect(buildSiteReport(asPlanned, null, "2026-09-22T10:00:00Z", "zh-Hans").title).toEqual({ before: "照明", emphasis: "按计划在夜间开启" });
    expect(buildSiteReport(asPlanned, null, "2026-09-22T10:00:00Z", "ms").headline).toMatch(/^Lampu menyala pada waktu malam seperti yang dirancang/);
  });
});
