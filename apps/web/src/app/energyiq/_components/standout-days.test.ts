import { describe, expect, it } from "vitest";
import {
  behindSentence, behindTheDay, buildSiteReport, daySentence, dayKindOf, explainDays, findAnomalies, meterGroupPlaces, scopeDays, sharedMeterNames, standoutDays, standoutMeters, standoutReport, standoutRule,
  usualDayBaselines, type AnalysisData, type AnalysisDay,
} from "@datafoundry/site-report";
import { DAILY, DATA, DATES, GAP_DAY, IDS, meter, series, site, THURSDAY } from "./standout-days.test-fixture";

const days = scopeDays(site, DATA.holidays);
const explained = explainDays({ days, meters: standoutMeters([site]), lighting: true, places: meterGroupPlaces(DATA.groups) });
const on = (date: string) => explained.find(item => item.date === date)!;

describe("why a day was different", () => {
  it("calls out a clear difference and names the meters behind most of it", () => {
    const thursday = on(THURSDAY);
    expect(thursday).toMatchObject({ status: "standout", kind: "any", lead: "most", samples: 13 });
    expect(thursday.usualKwh).toBeCloseTo(46.1, 6);
    expect(thursday.deltaKwh).toBeCloseTo(2.3, 6);
    // The lift lobby's +0.2 kWh is under a tenth of the difference, so it is not named.
    expect(thursday.contributors.map(item => [item.name, Number(item.deltaKwh.toFixed(2))])).toEqual([["Estate entrance", 1.5], ["Pavilion lights & fan", 0.6]]);
    expect(daySentence(thursday)).toBe("Thu 5 Nov used 48.4 kWh, 2.3 kWh more than a usual day (46.1 kWh). Most of the extra: Estate entrance +1.5 kWh and Pavilion lights & fan +0.6 kWh.");
    expect(standoutDays(explained).map(item => item.date)).toEqual([THURSDAY]);
  });

  it("adds the named meters and everything else up to the whole difference", () => {
    for (const item of explained.filter(entry => entry.status === "standout")) {
      expect(item.contributors.reduce((sum, contributor) => sum + contributor.deltaKwh, 0) + item.otherKwh).toBeCloseTo(item.deltaKwh!, 9);
    }
    // Every meter's own change on Thursday adds up to the site's change, because each meter's usual day is its own median.
    const thursday = on(THURSDAY);
    expect(thursday.otherKwh).toBeCloseTo(0.2, 6);
  });

  it("leaves ordinary wobbles alone: under the minimum share, or inside the normal day-to-day spread", () => {
    expect(on("2026-11-03")).toMatchObject({ status: "usual" });
    expect(daySentence(on("2026-11-03"))).toBe("Tue 3 Nov used 46.0 kWh, close to a usual day (46.1 kWh).");
    // A noisy site: the last day is 12% above usual, but its days normally swing by more than that.
    const noisy = [100, 90, 110, 95, 105, 100, 92, 108, 106, 112].map((totalKwh, index): AnalysisDay => ({ date: DATES[index]!, dayType: "weekday", complete: true, totalKwh, byCategory: {} }));
    const [, , , , , , , , , last] = explainDays({ days: noisy });
    expect(last).toMatchObject({ status: "usual", usualKwh: 102.5 });
    expect(last!.spreadKwh! * 2).toBeGreaterThan(Math.abs(last!.deltaKwh!));
    // A day 3% or less from usual is never called out, however steady the site.
    const steady = [50, 50, 50, 50, 50, 51.4].map((totalKwh, index): AnalysisDay => ({ date: DATES[index]!, dayType: "weekday", complete: true, totalKwh, byCategory: {} }));
    expect(explainDays({ days: steady }).at(-1)).toMatchObject({ status: "usual", spreadKwh: 0 });
    expect(explainDays({ days: steady.map((day, index) => index === 5 ? { ...day, totalKwh: 51.6 } : day) }).at(-1)).toMatchObject({ status: "standout", lead: null });
  });

  it("never blames meters for a day with missing readings", () => {
    const gap = on(GAP_DAY);
    expect(gap).toMatchObject({ status: "missing", contributors: [], deltaKwh: null, lead: null });
    expect(daySentence(gap)).toBe("Readings were missing on this day, so it is not compared with a usual day.");
    // A meter that missed readings on a standout day is left out of the named meters; its share stays in "everything else".
    const thursdayGap = { ...site, meters: site.meters.map(item => item.id === "bow" ? { ...item, series: { ...item.series!, cells: item.series!.cells.map(cell => cell[0] === THURSDAY && cell[1] === 3 ? [cell[0], cell[1], cell[2], 0, 1] as typeof cell : cell) } } : item) };
    const thursday = explainDays({ days, meters: standoutMeters([thursdayGap]), lighting: true }).find(item => item.date === THURSDAY)!;
    expect(thursday.contributors.map(item => item.name)).toEqual(["Pavilion lights & fan"]);
    expect(thursday.otherKwh).toBeCloseTo(1.7, 6);
  });

  it("treats every day of a lights-on site as one kind, and splits weekdays from weekends otherwise", () => {
    expect(new Set(explained.map(item => item.kind))).toEqual(new Set(["any"]));
    expect(dayKindOf({ dayType: "weekend" }, true)).toBe("any");
    expect(dayKindOf({ dayType: "weekend" }, false)).toBe("weekend");
    // Read as opening hours, the four weekend days are too few to say what a usual weekend is.
    const split = explainDays({ days, meters: standoutMeters([site]) });
    expect(split.find(item => item.date === "2026-11-07")).toMatchObject({ kind: "weekend", status: "few-days", samples: 4 });
    expect(daySentence(split.find(item => item.date === "2026-11-07")!)).toBe("Too few complete weekend days in these dates to say what is usual.");
    expect(split.find(item => item.date === THURSDAY)).toMatchObject({ kind: "weekday", status: "standout" });
    // The chart's usual-day line for a lights-on site is one value for every day type.
    expect(usualDayBaselines(days, true).map(item => [item.dayType, Number(item.expectedKwh!.toFixed(6)), item.samples])).toEqual([["weekday", 46.1, 13], ["weekend", 46.1, 13], ["public_holiday", 46.1, 13]]);
  });

  it("splits a difference only between real circuits, not the totals above them", () => {
    const main = { ...meter("bow"), id: "main", name: "Main incomer", category: "overall" as const };
    const board = { ...meter("pavilion"), id: "board", name: "DB1", location: "Plant room" };
    const sub = { ...meter("lobby-e"), id: "sub", official: false, location: "Plant room" };
    expect(standoutMeters([{ ...site, meters: [main, board, sub, meter("lobby-f")] }]).map(item => item.id)).toEqual(["sub", "lobby-f"]);
    expect([...sharedMeterNames(site.meters)]).toEqual(["Lift lobby lights"]);
  });

  it("names meters as everywhere else: the short name when one is set, and the group they serve", () => {
    const thursday = on(THURSDAY);
    expect(thursday.contributors.map(item => [item.name, item.place])).toEqual([["Estate entrance", "Common area"], ["Pavilion lights & fan", "Common area › Pavilion"]]);
    // Readings saved before groups existed still show where the meter is.
    const ungrouped = explainDays({ days, meters: standoutMeters([site]), lighting: true }).find(item => item.date === THURSDAY)!;
    expect(ungrouped.contributors.map(item => item.place)).toEqual(["Outdoor", "Outdoor"]);
    // A short name is the name readers see; the installer's full label stays behind it.
    const short = { ...site, meters: site.meters.map(item => item.id === "bow" ? { ...item, name: "Entrance", fullName: "Estate entrance" } : item) };
    const renamed = explainDays({ days, meters: standoutMeters([short]), lighting: true, places: meterGroupPlaces(DATA.groups) }).find(item => item.date === THURSDAY)!;
    expect(renamed.contributors[0]).toMatchObject({ name: "Entrance", fullName: "Estate entrance", place: "Common area" });
    expect(daySentence(renamed)).toContain("Most of the extra: Entrance +1.5 kWh and Pavilion lights & fan +0.6 kWh.");
  });

  it("is the one usual day the chart line and its unusually-high check use", () => {
    // Read as opening hours: weekdays have a usual day, the four weekend days are too few.
    const baselines = usualDayBaselines(days);
    expect(baselines.map(item => [item.dayType, item.expectedKwh === null ? null : Number(item.expectedKwh.toFixed(6)), item.samples])).toEqual([["weekday", 46.1, 9], ["weekend", null, 4], ["public_holiday", null, 0]]);
    expect(explainDays({ days }).find(item => item.date === THURSDAY)!.usualKwh).toBeCloseTo(baselines[0]!.expectedKwh!, 9);
    // Thursday is 5% above the usual day: explained, but well under the 15% "unusually high" mark.
    expect(findAnomalies(days, baselines)).toEqual([]);
    const spike = days.map(day => day.date === THURSDAY ? { ...day, totalKwh: 55 } : day);
    expect(findAnomalies(spike, usualDayBaselines(spike))).toEqual([{ date: THURSDAY, dayType: "weekday", totalKwh: 55, expectedKwh: baselines[0]!.expectedKwh, deltaPct: (55 / baselines[0]!.expectedKwh! - 1) * 100 }]);
  });

  it("writes the report block with the standout days, missing days and the rule", () => {
    const block = standoutReport(DATA);
    expect(block.title).toBe("Days that stood out");
    // One short sentence about what is behind the day: here a meter filed straight in Common area, beside its Pavilion group.
    expect(block.items).toEqual([{ date: THURSDAY, text: "On 5 Nov Estate entrance used 7.5 kWh; it usually uses 6 kWh." }]);
    expect(block.note).toBe("Readings were missing on 10 Nov, so that day is not compared.");
    expect(block.rule).toBe(standoutRule("en", true));
    expect(block.rule).toContain("more than 3%");
    expect(buildSiteReport(DATA, null, "2026-11-16T00:00:00Z").standout).toEqual(block);
    // A steady site says so instead of listing nothing.
    const steady = standoutReport({ ...DATA, current: { project: { ...site, total: series("__scope__", () => 46.1), meters: [] }, spaces: [] } });
    expect(steady.items).toEqual([]);
    expect(steady.note).toBe("No day stood out from a usual day. Readings were missing on 10 Nov, so that day is not compared.");
  });

  it("words the block in Chinese and Malay, and adds the place when two meters share a name", () => {
    const zh = standoutReport(DATA, "zh-Hans");
    expect(zh.title).toBe("与平常不同的日子");
    expect(zh.items[0]!.text).toBe("11月5日，Estate entrance用电 7.5 kWh，平时约 6 kWh。");
    expect(zh.note).toBe("11月10日读数缺失，因此这一天不作比较。");
    const ms = standoutReport(DATA, "ms");
    expect(ms.items[0]!.text).toBe("Pada 5 Nov, Estate entrance menggunakan 7.5 kWh; biasanya 6 kWh.");
    // Both lift lobbies rise on Friday; their shared name gets the block in brackets.
    const friday = "2026-11-06";
    const lobbies = { ...site, total: series("__scope__", date => IDS.reduce((sum, id) => sum + DAILY[id]!(date), 0) + (date === friday ? 3 : 0)),
      meters: site.meters.map(item => item.id.startsWith("lobby") ? { ...item, series: series(item.id, date => DAILY[item.id]!(date) + (date === friday ? 1.5 : 0)) } : item) };
    // With groups, the groups behind the day are named; a name with a number in it stays as it is. Both blocks moved
    // about the same, so both are named rather than one blamed for what two did.
    expect(standoutReport({ ...DATA, current: { project: lobbies, spaces: [] } }).items.find(item => item.date === friday)!.text)
      .toBe("On 6 Nov Block 1A used 19.5 kWh; it usually uses 18 kWh. Block 1B used 19.5 kWh; it usually uses 18.1 kWh.");
    // Without groups (readings saved before groups existed), the meters are named, with their place when they share a name.
    const text = standoutReport({ ...DATA, groups: undefined, current: { project: lobbies, spaces: [] } }).items.find(item => item.date === friday)!.text;
    expect(text).toBe("On 6 Nov Lift lobby lights (Block 1A) used 19.5 kWh; they usually use 18 kWh. Lift lobby lights (Block 1B) used 19.5 kWh; they usually use 18.1 kWh.");
    expect(standoutReport({ ...DATA, current: { project: lobbies, spaces: [] } }, "zh-Hans").items.find(item => item.date === friday)!.text)
      .toBe("11月6日，Block 1A用电 19.5 kWh，平时约 18 kWh。Block 1B用电 19.5 kWh，平时约 18.1 kWh。");
  });

  it("adds a group up from the meters that sent readings, so a silent meter never hides what its group did", () => {
    // On Friday the Pavilion lights & fan use 2 kWh more and the estate entrance 0.3 kWh more. The Pavilion group also
    // holds a walkway light that is marked not in use and sends nothing.
    const friday = "2026-11-06";
    const extra: Record<string, number> = { pavilion: 2, bow: 0.3 };
    const project = { ...site, total: series("__scope__", date => IDS.reduce((sum, id) => sum + DAILY[id]!(date) + (date === friday ? extra[id] ?? 0 : 0), 0)),
      meters: site.meters.map(item => extra[item.id] ? { ...item, series: series(item.id, date => DAILY[item.id]!(date) + (date === friday ? extra[item.id]! : 0)) } : item) };
    const groups = { ...DATA.groups!, meters: [...DATA.groups!.meters, { id: "walkway", name: "Walkway light", groupId: "pavilion-area", kwh: 0 }] };
    const data: AnalysisData = { ...DATA, groups, notInUse: [{ id: "walkway", name: "Walkway light", reason: "Not wired up yet" }], current: { project, spaces: [] } };
    const text = (input: AnalysisData) => standoutReport(input).items.find(item => item.date === friday)!.text;
    // The Pavilion is behind the day, as the same readings without groups say too; the estate entrance is too small to name.
    expect(text(data)).toBe("On 6 Nov Pavilion lights & fan used 6 kWh; it usually uses 4 kWh.");
    expect(text({ ...data, groups: undefined })).toBe("On 6 Nov Pavilion lights & fan used 6 kWh; it usually uses 4 kWh.");
    // With two meters sending in the group, the group is named from those two; the silent one adds nothing.
    const fan = { ...site.meters.find(item => item.id === "pavilion")!, id: "pavilion-2", name: "Pavilion fan", series: series("pavilion-2", date => 1 + (date === friday ? 1 : 0)) };
    const both = { ...data, groups: { ...groups, meters: [...groups.meters, { id: "pavilion-2", name: "Pavilion fan", groupId: "pavilion-area", kwh: 14 }] },
      current: { project: { ...project, meters: [...project.meters, fan], total: series("__scope__", date => IDS.reduce((sum, id) => sum + DAILY[id]!(date) + (date === friday ? extra[id] ?? 0 : 0), 0) + 1 + (date === friday ? 1 : 0)) }, spaces: [] } };
    expect(text(both)).toBe("On 6 Nov the pavilion used 8 kWh; it usually uses 5 kWh.");
  });

  it("says other meters moved too when what is named explains less than half of the day", () => {
    const thursday = on(THURSDAY);
    const lamp = { kind: "meter" as const, id: "lamp", name: "Driveway lamp", kwh: 2, usualKwh: 1.2, place: "Common area" };
    const context = { locale: "en" as const, groups: DATA.groups, shared: new Set<string>() };
    // 0.8 kWh of a 2.3 kWh rise.
    expect(behindSentence(thursday, [lamp], context)).toBe("On 5 Nov Driveway lamp used 2 kWh; it usually uses 1.2 kWh. Other meters used a little more too.");
    expect(behindSentence(thursday, [lamp], { ...context, locale: "ms" })).toBe("Pada 5 Nov, Driveway lamp menggunakan 2 kWh; biasanya 1.2 kWh. Meter lain juga menggunakan sedikit lebih banyak.");
    expect(behindSentence(thursday, [{ ...lamp, kwh: 3 }], context)).toBe("On 5 Nov Driveway lamp used 3 kWh; it usually uses 1.2 kWh.");
    // Nothing to name: the whole-site sentence is used instead.
    expect(behindTheDay(on("2026-11-03"), DATA.groups)).toEqual([]);
  });
});
