/**
 * Before and after a change made on site (packages/site-report before-after.ts): like for like (the same hours, the
 * same kinds of day, complete days only), what it is worth in money and carbon, and the split by group.
 */
import { describe, expect, it } from "vitest";
import {
  assembleAnalysisData, beforeAfter, beforeAfterBaseline, beforeAfterBasis, beforeAfterChanges, beforeAfterMessages, beforeAfterStatusNote, beforeAfterTakeaway, siteChanges,
  shiftScopeDate, type AnalysisData, type ScopeData, type ScopeMeter, type SiteChange, type TrendCell, type TrendSeries,
} from "@datafoundry/site-report";

const datesFrom = (first: string, count: number) => Array.from({ length: count }, (_, index) => shiftScopeDate(first, index));
const CURRENT = datesFrom("2026-11-03", 28); // Tue 3 Nov – Mon 30 Nov
const PREVIOUS = datesFrom("2026-10-06", 28); // Tue 6 Oct – Mon 2 Nov
const isNight = (hour: number) => hour < 7 || hour >= 19;
const weekend = (date: string) => [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());

type HourKwh = (date: string, hour: number) => number;
/** One hourly series; `problem` marks an hour read late (energy sent after an outage), `missing` an hour with no reading. */
function series(id: string, dates: string[], kwh: HourKwh, options: { missing?: (date: string, hour: number) => boolean; late?: (date: string, hour: number) => number } = {}): TrendSeries {
  return { id, expectedMinutesPerHour: 60, cells: dates.flatMap(date => Array.from({ length: 24 }, (_, hour): TrendCell[] => {
    if (options.missing?.(date, hour)) return [];
    const late = options.late?.(date, hour) ?? 0;
    return [late ? [date, hour, 0, 0, 4, late] : [date, hour, kwh(date, hour), 60, 0, 0]];
  }).flat()) };
}
function scope(id: string, name: string, dates: string[], total: TrendSeries | null, meters: ScopeMeter[] = [], cost: ScopeData["cost"] = null): ScopeData {
  const usage = total?.cells.reduce((sum, cell) => sum + (cell[2] ?? 0) + (cell[5] ?? 0), 0) ?? null;
  return { id, name, dates, timezone: "Asia/Singapore", total, types: {}, meters, usageKwh: usage, peakKw: null, peakAt: null, cost: cost && usage ? { ...cost, amount: usage * (cost.rates?.[0] ?? 0) } : cost, typeTotals: {}, coverage: 100 };
}
const meter = (id: string, name: string, s: TrendSeries): ScopeMeter => ({ id, name, location: "", category: "light", official: true, series: s });
const LIGHTS = { from: "19:00", to: "07:00" };
const EVERY_NIGHT = Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map(day => [day, [LIGHTS]]));
const RATE = { amount: 0, currency: "SGD", note: "0.3 SGD/kWh before tax", rates: [0.3], basis: "tax_exclusive" };

/**
 * A lit estate like SKTC: two blocks of lights, each half of about 47 kWh a night (12 lights-on hours) and a trickle
 * in the daytime. `blockA`/`blockB` give each block's kWh in an hour.
 */
function estate(blockA: HourKwh, blockB: HourKwh, options: { missing?: (date: string, hour: number) => boolean; late?: (date: string, hour: number) => number; previous?: boolean } = {}): AnalysisData {
  const period = (dates: string[]) => {
    const a = series("a", dates, blockA, options), b = series("b", dates, blockB, options);
    // Energy sent late by both blocks' meters adds up in the site's total.
    const total = series("__scope__", dates, (date, hour) => blockA(date, hour) + blockB(date, hour), { ...options, ...(options.late ? { late: (date: string, hour: number) => options.late!(date, hour) * 2 } : {}) });
    return { project: scope("project", "SKTC", dates, total, [], RATE), spaces: [scope("block-a", "Block A", dates, null, [meter("a", "Block A lights", a)]), scope("block-b", "Block B", dates, null, [meter("b", "Block B lights", b)])] };
  };
  return {
    projectId: "sktc", projectName: "SKTC", timezone: "Asia/Singapore", snapshotId: null,
    current: period(CURRENT), previous: options.previous === false ? null : period(PREVIOUS), history: null, circuits: [],
    holidays: new Map(), openingHours: EVERY_NIGHT, hoursMeaning: "lights_on", actions: [],
    groups: { list: [{ id: "ga", name: "Block A", parentId: null }, { id: "ga-l2", name: "Level 2", parentId: "ga" }, { id: "gb", name: "Block B", parentId: null }],
      meters: [{ id: "a", name: "Block A lights", groupId: "ga-l2", kwh: 0 }, { id: "b", name: "Block B lights", groupId: "gb", kwh: 0 }] },
    tariffTax: { name: "GST", ratePct: 9 }, carbon: { kgCo2ePerKwh: 0.402, year: 2024, source: "EMA" },
  };
}
const NIGHT_HOUR = 47 / 12 / 2; // each block's share of a lights-on hour
/** Lights at full power until `from`, then dimmed by `cut` (0.3 for 30%); 0.05 kWh an hour in the daytime. */
const dimmed = (from: string, cut: number, day = 0.05): HourKwh => (date, hour) => isNight(hour) ? NIGHT_HOUR * (date >= from ? 1 - cut : 1) : day;
const steady: HourKwh = (_date, hour) => isNight(hour) ? NIGHT_HOUR : 0.05;
const CHANGE: SiteChange = { id: "dim", title: "Smart lighting: 30% night dimming", date: "2026-11-17", meterIds: [] };

describe("before and after a change", () => {
  it("compares the lights-on hours only, so daytime use moving the other way does not blur the saving", () => {
    // Dimming starts the night of 17 Nov; daytime use doubles from the same day, and the change day itself is odd.
    const odd: HourKwh = (date, hour) => date === "2026-11-17" ? 50 : dimmed("2026-11-17", 0.3, date >= "2026-11-17" ? 0.1 : 0.05)(date, hour);
    const result = beforeAfter(estate(odd, odd), CHANGE);
    expect(result).toMatchObject({ measure: "lights_on", scope: "site", status: "reliable", beforeDays: 28, afterDays: 13, unmatchedAfterDays: 0 });
    // 28 complete days before 17 Nov (half from the period before the chosen dates), every day after it to 30 Nov.
    expect([result.beforeFrom, result.beforeTo, result.afterFrom, result.afterTo]).toEqual(["2026-10-20", "2026-11-16", "2026-11-18", "2026-11-30"]);
    const figures = result.figures!;
    expect(figures.beforeKwh).toBeCloseTo(47, 6);
    expect(figures.afterKwh).toBeCloseTo(47 * 0.7, 6);
    expect(figures.changePct).toBeCloseTo(-30, 6);
    expect(figures.changeKwh).toBeCloseTo(-14.1, 6);
    // The change day is drawn, marked, but never counted; the chart runs from the first day compared to the last chosen date.
    expect(result.days[0]!.date).toBe("2026-10-20");
    expect(result.days.at(-1)!.date).toBe("2026-11-30");
    expect(result.days.find(day => day.date === "2026-11-17")).toMatchObject({ side: "change", counted: false });
    expect(result.days.filter(day => day.counted)).toHaveLength(41);
    expect(beforeAfterTakeaway(result)).toBe("Since 17 Nov, night use is 30% lower: about 14 kWh a day, S$138 a month.");
    expect(beforeAfterStatusNote(result)).toBe("Reliable: 13 complete days since the change, against 28 before it.");
    expect(beforeAfterBasis(result)).toBe("Compared like for like: only the lights-on hours (19:00 → 07:00 next day), on the same kinds of day (weekdays, weekends, public holidays), complete days only. The day of the change is left out.");
  });

  it("prices the change at the site's rate with GST added to a rate published before tax, and its carbon at the grid factor", () => {
    const result = beforeAfter(estate(dimmed("2026-11-17", 0.3), dimmed("2026-11-17", 0.3)), CHANGE);
    const figures = result.figures!;
    expect(result.rate).toBeCloseTo(0.3 * 1.09, 9);
    expect(result).toMatchObject({ currency: "SGD", taxIncluded: true, taxName: "GST", carbonFactor: 0.402 });
    expect(figures.month.change.kwh).toBeCloseTo(-14.1 * 30, 6);
    expect(figures.month.change.cost).toBeCloseTo(-14.1 * 30 * 0.3 * 1.09, 6);
    expect(figures.year.change.kwh).toBeCloseTo(-14.1 * 365, 6);
    expect(figures.year.change.cost).toBeCloseTo(-14.1 * 365 * 0.327, 6);
    expect(figures.year.change.co2Kg).toBeCloseTo(-14.1 * 365 * 0.402, 6);
    expect(figures.day.before.cost).toBeCloseTo(47 * 0.327, 6);
    // Without a rate the money is left out and the takeaway says the kWh a month instead.
    const noRate = estate(dimmed("2026-11-17", 0.3), dimmed("2026-11-17", 0.3));
    noRate.current.project = { ...noRate.current.project, cost: null };
    noRate.previous!.project = { ...noRate.previous!.project, cost: null };
    const unpriced = beforeAfter(noRate, CHANGE);
    expect(unpriced.figures!.month.change.cost).toBeNull();
    expect(beforeAfterTakeaway(unpriced)).toBe("Since 17 Nov, night use is 30% lower: about 14 kWh a day, 423 kWh a month.");
  });

  it("compares the days after with the same kinds of day before, so a run of weekdays is not set against a weekend-heavy average", () => {
    // An office: 100 kWh on a weekday and 40 at the weekend before; weekdays 20% lower from Thu 26 Nov. Three weekdays
    // after (Fri 27, Mon 30, and a public holiday on Tue 1 Dec compared with weekends) — the figure before is weekday-only.
    const dates = datesFrom("2026-11-03", 29);
    const office = (from: string, days = dates): AnalysisData => ({
      projectId: "office", projectName: "Office", timezone: "Asia/Singapore", snapshotId: null,
      current: { project: scope("project", "Office", days, series("__scope__", days, date => (weekend(date) || date === "2026-12-01" ? 40 : date >= from ? 80 : 100) / 24)), spaces: [] },
      previous: null, history: null, circuits: [], holidays: new Map([["2026-12-01", "Test holiday"]]), openingHours: null, actions: [],
    });
    const result = beforeAfter(office("2026-11-27"), { id: "led", title: "LED fittings", date: "2026-11-26", meterIds: [] });
    expect(result.measure).toBe("whole_day");
    // Fri 27 and Mon 30 are weekdays; Sat 28 and Sun 29 weekend days; the holiday is compared with weekends.
    expect(result.afterDays).toBe(5);
    expect(result.figures!.afterKwh).toBeCloseTo((80 + 40 + 40 + 80 + 40) / 5, 6);
    expect(result.figures!.beforeKwh).toBeCloseTo((100 * 2 + 40 * 3) / 5, 6);
    expect(result.status).toBe("early");
    expect(beforeAfterStatusNote(result)).toBe("Early figure: 5 complete days since the change. It is called reliable from 7 days.");
    // Weekdays only after (Tue 24 – Fri 27): compared with weekdays only, 100 → 80.
    const weekdays = beforeAfter(office("2026-11-24", dates.slice(0, 25)), { id: "led", title: "LED fittings", date: "2026-11-23", meterIds: [] });
    expect(weekdays.afterDays).toBe(4);
    expect(weekdays.figures!.beforeKwh).toBeCloseTo(100, 6);
    expect(weekdays.figures!.afterKwh).toBeCloseTo(80, 6);
    expect(beforeAfterTakeaway(weekdays)).toBe("Since 23 Nov, use is 20% lower: about 20 kWh a day, 600 kWh a month.");
  });

  it("leaves out incomplete days, counting energy sent late in the day's total but never in a comparison", () => {
    const missing = (date: string, hour: number) => date === "2026-11-20" && hour === 3;
    const late = (date: string, hour: number) => date === "2026-11-24" && isNight(hour) ? NIGHT_HOUR * 0.7 : 0;
    const result = beforeAfter(estate(dimmed("2026-11-17", 0.3), dimmed("2026-11-17", 0.3), { missing, late }), CHANGE);
    expect(result.afterDays).toBe(11);
    const sent = result.days.find(day => day.date === "2026-11-24")!;
    expect(sent).toMatchObject({ complete: false, counted: false });
    expect(sent.kwh).toBeCloseTo(47 * 0.7, 6);
    expect(result.days.find(day => day.date === "2026-11-20")).toMatchObject({ complete: false, counted: false });
    expect(result.figures!.changePct).toBeCloseTo(-30, 6);
  });

  it("waits for three complete days after the change, and says so before any arrive", () => {
    const data = estate(dimmed("2026-11-29", 0.3), dimmed("2026-11-29", 0.3));
    const soon = beforeAfter(data, { ...CHANGE, date: "2026-11-29" });
    expect(soon).toMatchObject({ status: "waiting", afterDays: 1, figures: null });
    expect(beforeAfterTakeaway(soon)).toBe("Recorded: Smart lighting: 30% night dimming starts 29 Nov. The comparison appears after 3 complete days (1 so far).");
    const ahead = beforeAfter(estate(steady, steady), { ...CHANGE, title: "Smart lighting", date: "2026-12-01" });
    expect(ahead).toMatchObject({ status: "upcoming", afterDays: 0, beforeDays: 28, figures: null });
    expect(beforeAfterTakeaway(ahead)).toBe("Recorded: Smart lighting starts 1 Dec. The comparison appears after 3 complete days.");
    expect(ahead.baselineKwh).toBeCloseTo(47, 6);
    expect(beforeAfterBaseline(ahead)).toBe("Before the change, night use averaged 47 kWh a day over 28 complete days.");
    expect(beforeAfterStatusNote(ahead)).toBe("");
    // A change at the very start of the readings has nothing before it to compare with.
    const first = beforeAfter(estate(steady, steady, { previous: false }), { ...CHANGE, date: "2026-11-04" });
    // The one day before is a Tuesday, so the weekend days after it have nothing to compare with.
    expect(first).toMatchObject({ status: "no-before", beforeDays: 1, afterDays: 18, unmatchedAfterDays: 8, figures: null });
    expect(beforeAfterTakeaway(first)).toBe("Since 4 Nov there are 18 complete days to compare, but too few complete days before the change: 1 of the 3 needed.");
  });

  it("finds the days before a change made before the chosen dates in the period before them", () => {
    const result = beforeAfter(estate(dimmed("2026-10-27", 0.3), dimmed("2026-10-27", 0.3)), { ...CHANGE, date: "2026-10-27" });
    expect([result.beforeFrom, result.beforeTo, result.afterFrom, result.afterTo]).toEqual(["2026-10-06", "2026-10-26", "2026-10-28", "2026-11-30"]);
    expect(result).toMatchObject({ status: "reliable", beforeDays: 21, afterDays: 34 });
    expect(result.figures!.changePct).toBeCloseTo(-30, 6);
  });

  it("splits a whole-site change by top-level group, and compares only the meters a change lists", () => {
    const data = estate(dimmed("2026-11-17", 0.3), steady);
    const site = beforeAfter(data, CHANGE);
    expect(site.figures!.changePct).toBeCloseTo(-15, 6);
    // Block A's meter is filed under Block A › Level 2; it counts in Block A.
    expect(site.groups.map(group => [group.name, group.meterIds, Math.round(group.figures!.changePct!)])).toEqual([["Block A", ["a"], -30], ["Block B", ["b"], 0]]);
    expect(site.groups[0]!.figures!.beforeKwh).toBeCloseTo(23.5, 6);
    const blockA = beforeAfter(data, { ...CHANGE, meterIds: ["a"] });
    expect(blockA).toMatchObject({ scope: "meters", meters: [{ id: "a", name: "Block A lights" }], groups: [] });
    expect(blockA.figures!.changePct).toBeCloseTo(-30, 6);
    expect(beforeAfterTakeaway(blockA)).toBe("Since 17 Nov, night use on Block A lights is 30% lower: about 7.1 kWh a day, S$69 a month.");
    // One meter of the two missing an hour makes the day incomplete for both together.
    const gap = beforeAfter(estate(dimmed("2026-11-17", 0.3), steady, { missing: (date, hour) => date === "2026-11-25" && hour === 12 }), { ...CHANGE, meterIds: ["a", "b"] });
    expect(gap.afterDays).toBe(12);
    expect(beforeAfterTakeaway(gap)).toContain("night use on the 2 meters it affects is 15% lower");
  });

  it("shows changes in or before the chosen dates, and upcoming ones only while the dates run to the latest readings", () => {
    const changes: SiteChange[] = [{ id: "c", title: "Later", date: "2026-12-01", meterIds: [] }, { id: "b", title: "In", date: "2026-11-17", meterIds: [] }, { id: "a", title: "Before", date: "2026-09-01", meterIds: [] }];
    const data = estate(steady, steady);
    expect(beforeAfterChanges({ ...data, changes }).map(change => change.id)).toEqual(["c", "b", "a"]);
    const history = scope("project", "SKTC", datesFrom("2026-06-01", 200), null);
    expect(beforeAfterChanges({ ...data, changes, history }).map(change => change.id)).toEqual(["b", "a"]);
    expect(beforeAfterChanges({ ...data })).toEqual([]);
  });

  it("reads the changes from the project information, newest first, dropping any without a title or a real date", () => {
    expect(siteChanges({ calendar: null, changes: [
      { id: "a", title: " Timer moved ", date: "2026-10-01", meterIds: ["m1", "m1", " "] },
      { id: "b", title: "Smart lighting", date: "2026-12-01", note: "Charles installs", meterIds: [] },
      { id: "c", title: "", date: "2026-10-02" }, { id: "d", title: "Bad date", date: "2026-13-45" }, { id: "", title: "No id", date: "2026-10-03" },
    ] })).toEqual([
      { id: "b", title: "Smart lighting", date: "2026-12-01", note: "Charles installs", meterIds: [] },
      { id: "a", title: "Timer moved", date: "2026-10-01", meterIds: ["m1"] },
    ]);
    expect(siteChanges(null)).toEqual([]);
    const source = { context: { scopeId: "project", scopeName: "SKTC", timezone: "Asia/Singapore", from: "2026-11-03T00:00:00+08:00", to: "2026-11-05T00:00:00+08:00" }, summary: { usageKwh: 0, peakKw: 0, validIntervalCount: 0 }, categories: [], childScopes: [], circuits: [], cost: { status: "unavailable" as const } };
    const assembled = assembleAnalysisData({ projectId: "sktc", project: source, spaces: [], spaceCurrent: [], previousProject: null, spacePrevious: [], history: null, actions: [],
      information: { name: "SKTC", calendar: null, changes: [{ id: "b", title: "Smart lighting", date: "2026-12-01" }] } });
    expect(assembled.changes).toEqual([{ id: "b", title: "Smart lighting", date: "2026-12-01", meterIds: [] }]);
    expect("changes" in assembleAnalysisData({ projectId: "sktc", project: source, spaces: [], spaceCurrent: [], previousProject: null, spacePrevious: [], history: null, actions: [], information: { name: "SKTC", calendar: null } })).toBe(false);
  });

  it("words the takeaway in Chinese and Malay, with every sentence in every language", () => {
    const result = beforeAfter(estate(dimmed("2026-11-17", 0.3), dimmed("2026-11-17", 0.3)), CHANGE);
    expect(beforeAfterTakeaway(result, "zh-Hans")).toBe("自11月17日起，夜间用电降低了 30%：每天约少 14 kWh，每月约省 S$138。");
    expect(beforeAfterTakeaway(result, "ms")).toBe("Sejak 17 Nov, penggunaan waktu malam 30% lebih rendah: kira-kira 14 kWh sehari, S$138 sebulan.");
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    const keys = Object.keys(beforeAfterMessages.en).sort();
    for (const locale of ["zh-Hans", "ms"] as const) {
      expect(Object.keys(beforeAfterMessages[locale]).sort()).toEqual(keys);
      for (const key of keys) {
        const text = beforeAfterMessages[locale][key as keyof typeof beforeAfterMessages.en];
        expect(text.trim(), `${key} (${locale})`).toBeTruthy();
        expect(placeholders(text), `${key} (${locale})`).toEqual(placeholders(beforeAfterMessages.en[key as keyof typeof beforeAfterMessages.en]));
      }
    }
  });
});
