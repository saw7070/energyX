/**
 * An estate whose lighting should run at night: which lights were on in the daytime and when, the 20-minute allowance
 * either side of the lights-on hours, meters that are always on by design, and meters that sent only part of a day.
 * All names are made up.
 */
import { describe, expect, it } from "vitest";
import { allowedShare, buildManagementReview, daytimeUse, minutesInHours } from "@datafoundry/site-report";
import { renderSiteReportMarkup } from "@datafoundry/site-report/site-report-document";
import { renderManagementReviewMarkup } from "@datafoundry/site-report/management-review-document";
import type { AnalysisData, ScopeData, ScopeMeter, TrendSeries } from "./analysis-data";
import { closedUseBreakdown, savingsPlan, type HoursByDay } from "./analysis-model";
import { buildSiteReport } from "./site-report-model";

const WEEK = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const every = (from: string, to: string): HoursByDay => Object.fromEntries(WEEK.map(day => [day, [{ from, to }]]));
const NIGHTS = every("19:00", "07:00");
// Two weeks from Monday 3 Aug 2026.
const DATES = Array.from({ length: 14 }, (_, index) => new Date(Date.parse("2026-08-03T00:00:00Z") + index * 86_400_000).toISOString().slice(0, 10));
const night = (hour: number) => hour >= 19 || hour < 7;
/** kWh in each hour; null leaves the hour out, as when a meter sent nothing. */
type Profile = (date: string, hour: number) => number | null;
const series = (id: string, kwh: Profile): TrendSeries => ({
  id, expectedMinutesPerHour: 60,
  cells: DATES.flatMap(date => Array.from({ length: 24 }, (_, hour) => kwh(date, hour)).flatMap((value, hour) => value == null ? [] : [[date, hour, value, 60, 0] as TrendSeries["cells"][number]])),
});

/** `fullName`: a short name is set, so the meter is a line of its own in the report under `name`. */
type Meter = { name: string; fullName?: string; group: string; kwh: Profile };
function estate(meters: Record<string, Meter>, extra: Partial<AnalysisData> = {}, hours: HoursByDay = NIGHTS): AnalysisData {
  const ids = Object.keys(meters);
  const scopeMeters = ids.map((id): ScopeMeter => ({ id, name: meters[id]!.name, ...(meters[id]!.fullName ? { fullName: meters[id]!.fullName } : {}), location: meters[id]!.group, category: "light", official: true, series: series(id, meters[id]!.kwh) }));
  const total = series("__scope__", (date, hour) => ids.reduce((sum, id) => sum + (meters[id]!.kwh(date, hour) ?? 0), 0));
  const usage = total.cells.reduce((sum, cell) => sum + cell[2]!, 0);
  // The site total adds up what arrived; an hour a meter missed is short of minutes, as the engine reports it.
  for (const cell of total.cells) cell[3] = ids.filter(id => meters[id]!.kwh(cell[0], cell[1]) != null).length * 60;
  total.expectedMinutesPerHour = ids.length * 60;
  const project: ScopeData = { id: "estate", name: "Block Estate", dates: DATES, timezone: "Asia/Singapore", total, types: {}, meters: scopeMeters, usageKwh: usage, peakKw: null, peakAt: null,
    cost: { amount: usage * 0.3, currency: "SGD", note: "0.3 SGD/kWh before tax" }, typeTotals: {}, coverage: 100 };
  const groups = [...new Set(ids.map(id => meters[id]!.group))];
  const space = (group: string): ScopeData => ({ ...project, id: group, name: group, meters: scopeMeters.filter(meter => meter.location === group) });
  return {
    projectId: "estate", projectName: "Block Estate", timezone: "Asia/Singapore", snapshotId: null,
    current: { project, spaces: groups.map(space) }, previous: null, history: null, circuits: [], holidays: new Map(), openingHours: hours, actions: [], hoursMeaning: "lights_on",
    ...extra,
  };
}

// Per day: 12 lit hours at night, plus what each meter does around them.
const ESTATE: Record<string, Meter> = {
  pavilion: { name: "Pavilion lights", group: "Common area", kwh: (_date, hour) => night(hour) ? 1 : 0 },
  // Left on until 9 am on three mornings.
  driveway: { name: "Driveway lamp", group: "Common area", kwh: (date, hour) => night(hour) || (["2026-08-05", "2026-08-06", "2026-08-07"].includes(date) && (hour === 7 || hour === 8)) ? 0.5 : 0 },
  // On at 18:50 and off at 07:15: within 20 minutes of the hours, so on time.
  playground: { name: "Playground lights", group: "Common area", kwh: (_date, hour) => night(hour) ? 0.6 : hour === 18 ? 0.1 : hour === 7 ? 0.15 : 0 },
  // On at 18:00 every evening: an hour early.
  corridor: { name: "Corridor lights", group: "Block A", kwh: (_date, hour) => night(hour) || hour === 18 ? 0.6 : 0 },
  // Emergency lighting runs day and night.
  emergency: { name: "Emergency lights", group: "Block A", kwh: () => 0.4 },
};
const ALWAYS_ON = { alwaysOnByDesign: [{ id: "emergency", name: "Emergency lights" }] };
// 42.85 kWh a day, plus the driveway's three mornings.
const TOTAL = 42.85 * 14 + 3;

describe("the 20-minute allowance either side of the lights-on hours", () => {
  it("counts the minutes of each hour inside the hours, widened by 20 minutes at each end", () => {
    // Hours set on the hour: 18:00–19:00 and 07:00–08:00 may each hold 20 minutes of light, a third of an hour.
    expect([17, 18, 19, 6, 7, 8].map(hour => minutesInHours(NIGHTS, "2026-08-04", hour))).toEqual([0, 0, 60, 60, 0, 0]);
    expect([17, 18, 19, 6, 7, 8].map(hour => minutesInHours(NIGHTS, "2026-08-04", hour, 20))).toEqual([0, 20, 60, 60, 20, 0]);
    expect(allowedShare(NIGHTS, "2026-08-04", 18)).toBeCloseTo(1 / 3, 9);
    // SKTC's coming hours, 18:30–07:15: half of 18:00–19:00 is inside, and 20 more minutes are allowed before it.
    const late = every("18:30", "07:15");
    expect([17, 18, 19, 6, 7, 8].map(hour => minutesInHours(late, "2026-08-04", hour))).toEqual([0, 30, 60, 60, 15, 0]);
    expect([17, 18, 19, 6, 7, 8].map(hour => minutesInHours(late, "2026-08-04", hour, 20))).toEqual([0, 50, 60, 60, 35, 0]);
  });

  it("calls a light on time when the hour next to the set hours used no more than a third of a usual lights-on hour", () => {
    // 1.2 kWh a lit hour. On at 18:30 (0.6 in 18:00–19:00) is early; on at 18:45 (0.3) is on time.
    // Off at 07:15 (0.3 in 07:00–08:00) is on time; off at 07:30 (0.6) is late.
    const lamp = (on: number, off: number): Profile => (_date, hour) => night(hour) ? 1.2 : hour === 18 ? 1.2 * on : hour === 7 ? 1.2 * off : 0;
    const report = buildSiteReport(estate({
      a: { name: "Lamp on at half past six", group: "Block A", kwh: lamp(0.5, 0) },
      b: { name: "Lamp on at quarter to seven", group: "Block A", kwh: lamp(0.25, 0) },
      c: { name: "Lamp off at quarter past seven", group: "Block A", kwh: lamp(0, 0.25) },
      d: { name: "Lamp off at half past seven", group: "Block A", kwh: lamp(0, 0.5) },
    }), null, "2026-09-22T10:00:00Z");
    const finding = (id: string) => report.circuits.find(circuit => circuit.meterIds.includes(id))!.finding;
    expect(finding("a")).toContain("Switched on before 7 pm on **all 14 evenings**, usually from 6 pm.");
    expect(finding("d")).toContain("Still lit past 7 am on **all 14 mornings**");
    // Within the allowance: no early or late finding, and the hour is not even marked as above usual.
    expect(finding("b")).toBe("Nothing unusual — steady use.");
    expect(finding("c")).toBe("Nothing unusual — steady use.");
    expect(report.screening.callout).not.toMatch(/quarter/);
    // Only the early and the late lamp were on in the daytime, an hour at 0.6 kWh each day.
    expect(report.daytime!.items).toEqual([
      "Lamp off at half past seven: on 7–8 am on 14 days, 8.4 kWh",
      "Lamp on at half past six: on 6–7 pm on 14 days, 8.4 kWh",
    ]);
  });
});

describe("meters that are always on by design", () => {
  const plain = buildSiteReport(estate(ESTATE), null, "2026-09-22T10:00:00Z");
  const marked = buildSiteReport(estate(ESTATE, ALWAYS_ON), null, "2026-09-22T10:00:00Z");

  it("stay in every total but out of the daytime share and its warning", () => {
    // Unmarked, the emergency lighting's 12 daytime hours a day make a daytime warning.
    expect(plain.headlineTopic).toBe("daytime");
    expect(plain.title.before).toBe("13% of the electricity is used ");
    // Marked always on: only the corridor's early hour and the driveway's mornings are daytime use, 11.4 of 603 kWh.
    const use = daytimeUse(estate(ESTATE, ALWAYS_ON));
    expect(use.kwh).toBeCloseTo(8.4 + 3, 9);
    expect(use.share).toBeCloseTo(11.4 / TOTAL, 9);
    expect(marked.headlineTopic).toBe("night");
    expect(marked.title).toEqual({ before: "The lights run ", emphasis: "at night, as planned" });
    expect(marked.keyFigures[3]).toEqual({ value: "1.9%", label: "used in the daytime (11.4 kWh)" });
    // The totals do not change.
    expect(marked.lede).toContain(`used **${Math.round(TOTAL)} kWh**`);
    expect(marked.estimate.monthKwh).toBeCloseTo(plain.estimate.monthKwh, 9);
    expect(marked.circuits.find(circuit => circuit.name === "Emergency lights")!.periodKwh).toBeCloseTo(0.4 * 24 * 14, 9);
  });

  it("are described as always on by design, never as a saving or a problem", () => {
    const emergency = (report: typeof plain) => report.circuits.find(circuit => circuit.meterIds.includes("emergency"))!;
    // Unmarked, it reads as lighting that never switches off, and switching it off as the saving.
    expect(emergency(plain).finding).toContain("Ran non-stop the whole time.");
    expect(plain.screening.callout).toMatch(/Switching .+ off in the daytime alone would cut about/);
    expect(emergency(marked)).toMatchObject({ alwaysOnByDesign: true, flat: false, finding: "Always on by design: it is meant to run day and night, so this is expected." });
    expect(marked.screening.callout).toContain("Always on by design, so running day and night is expected: Emergency lights.");
    expect(marked.screening.callout).not.toMatch(/Switching .+ off|stays on in the daytime too/);
    // The Analysis savings plan offers no switch-off and no check for it.
    const data = estate(ESTATE, ALWAYS_ON);
    const plan = (ids: Set<string>) => savingsPlan({ projectName: "Block Estate", closedUse: closedUseBreakdown(data.current.project, data.current.spaces, data.holidays, NIGHTS, "en", "lights_on", ids), closedHoursPerYear: 4380, rate: 0.3, currency: "SGD", aboveBenchmarkKwh: null, benchmarkKw: null, periodDays: 14, anomalies: [], actions: [], meaning: "lights_on" });
    expect(plan(new Set()).map(item => item.title)).toContain("Check whether Emergency lights must run in the daytime");
    expect(plan(new Set(["emergency"])).map(item => item.title).join(" ")).not.toContain("Emergency lights");
    // The estate's floor is the emergency lighting: marked, that floor is not what savings must come from.
    expect(plain.benchmark.outro).toContain("what never switches off uses **288 kWh");
    expect(marked.benchmark.byDesignKw).toBeCloseTo(0.4, 9);
    expect(marked.benchmark.outro).toBe("Everything that never switches off is always on by design: 0.40 kW (about 9.6 kWh a day), meant to run day and night.");
    // The figures themselves stay as measured.
    expect(marked.benchmark.rows.find(row => row.label === "Never switches off (24/7)")).toMatchObject({ rate: "0.40 kW", perDay: "9.6 kWh" });
  });

  it("keep the management review's daytime finding calm too", () => {
    const review = buildManagementReview(estate(ESTATE, ALWAYS_ON), null, "2026-09-22T10:00:00Z");
    expect(review.summary.findings).toContain("The lights ran at night as planned: only **2%** of the energy was used in the daytime.");
    expect(review.savings.rows.map(row => row.title).join(" ")).not.toContain("Emergency lights");
    // The review lists the same lights on in the daytime as the full report.
    expect(review.daytime!.items).toEqual(["Corridor lights: on 6–7 pm on 14 days, 8.4 kWh", "Driveway lamp: on 7–9 am on 3 days, 3.0 kWh"]);
    expect(renderManagementReviewMarkup(review)).toContain("<li>Corridor lights: on 6–7 pm on 14 days, 8.4 kWh</li>");
  });

  it("change nothing for meters without the tick", () => {
    // Only the tick moves the figures: the same readings with no meter marked read as before.
    expect(buildSiteReport(estate(ESTATE, { alwaysOnByDesign: [] }), null, "2026-09-22T10:00:00Z").title).toEqual(plain.title);
    expect(plain.circuits.every(circuit => !circuit.alwaysOnByDesign)).toBe(true);
    expect(plain.daytime!.alwaysOn).toBeNull();
  });
});

describe("which lights were on in the daytime, and when", () => {
  it("lists each light with its hours, days and kWh, largest first, and names the meters left out", () => {
    const report = buildSiteReport(estate(ESTATE, ALWAYS_ON), null, "2026-09-22T10:00:00Z");
    // The playground is on time (within 20 minutes); the pavilion runs only at night; emergency lighting is left out.
    expect(report.daytime).toEqual({
      heading: "On in the daytime",
      items: ["Corridor lights: on 6–7 pm on 14 days, 8.4 kWh", "Driveway lamp: on 7–9 am on 3 days, 3.0 kWh"],
      more: null, none: null,
      alwaysOn: "Always on by design, so left out of daytime use: Emergency lights.",
      rule: "A light that comes on or goes off within 20 minutes of the lights-on hours counts as on time.",
    });
    const html = renderSiteReportMarkup(report);
    expect(html).toContain("<h3>On in the daytime</h3>");
    expect(html).toContain("<li>Driveway lamp: on 7–9 am on 3 days, 3.0 kWh</li>");
  });

  it("keeps the list short: three named, then how many more", () => {
    const lamps = Object.fromEntries([1, 2, 3, 4, 5].map(n => [`lamp-${n}`, { name: `Lamp ${n}`, group: "Block A", kwh: ((_date, hour) => night(hour) ? 1 : hour === 12 ? n / 10 : 0) as Profile }]));
    const five = buildSiteReport(estate(lamps), null, "2026-09-22T10:00:00Z").daytime!;
    expect(five.items).toEqual(["Lamp 5: on 12–1 pm on 14 days, 7.0 kWh", "Lamp 4: on 12–1 pm on 14 days, 5.6 kWh", "Lamp 3: on 12–1 pm on 14 days, 4.2 kWh"]);
    expect(five.more).toBe("and 2 more");
    // A lone fourth is named rather than counted.
    const four = buildSiteReport(estate(Object.fromEntries(Object.entries(lamps).slice(1))), null, "2026-09-22T10:00:00Z").daytime!;
    expect([four.items.length, four.more]).toEqual([4, null]);
  });

  it("says so when no light was on in the daytime", () => {
    const daytime = buildSiteReport(estate({ pavilion: ESTATE.pavilion!, playground: ESTATE.playground! }), null, "2026-09-22T10:00:00Z").daytime!;
    expect([daytime.items, daytime.none]).toEqual([[], "No light was on in the daytime."]);
  });

  it("is worded in Chinese and Malay", () => {
    const zh = buildSiteReport(estate(ESTATE, ALWAYS_ON), null, "2026-09-22T10:00:00Z", "zh-Hans").daytime!;
    expect(zh.items[0]).toMatch(/^Corridor lights：.+亮着，共 14 天，8\.4 kWh$/);
    expect(zh.alwaysOn).toBe("按设计需要一直开着，所以不计入白天用电：Emergency lights。");
    const ms = buildSiteReport(estate(ESTATE, ALWAYS_ON), null, "2026-09-22T10:00:00Z", "ms").daytime!;
    expect(ms.items[1]).toMatch(/^Driveway lamp: menyala .+ pada 3 hari, 3\.0 kWh$/);
    expect(ms.rule).toBe("Lampu yang menyala atau padam dalam masa 20 minit dari waktu lampu menyala dikira tepat pada masanya.");
  });
});

describe("a meter that sent readings for only part of a day", () => {
  // Real use is about 0.19 kWh a day: 12 lit hours at 0.016 kWh. Linkway light 1 sent two evening hours on Monday
  // 3 Aug, each holding what the light had counted since it was last read (0.08 kWh), then nothing. A usual day worked
  // out from the hours it did send would be 0.08 kWh × 24 ≈ 1.9 kWh: ten times its real use. That must never happen.
  const LINKWAY: Record<string, Meter> = {
    "linkway-1": { name: "Linkway light 1", fullName: "Pavilion walk path light 1", group: "Pavilion", kwh: (date, hour) => date === "2026-08-03" && (hour === 19 || hour === 20) ? 0.08 : null },
    // Every hour arrives, except after its last reading on the last evening, which carried a 0.08 kWh catch-up.
    "linkway-2": { name: "Linkway light 2", fullName: "Pavilion walk path light 2", group: "Pavilion", kwh: (date, hour) => date === DATES.at(-1) && hour > 19 ? null : date === DATES.at(-1) && hour === 19 ? 0.08 : night(hour) ? 0.016 : 0 },
    pavilion: ESTATE.pavilion!,
  };
  const data = estate(LINKWAY);

  it("gets no usual day and no 30-day estimate, and the report says there are not enough readings", () => {
    const report = buildSiteReport(data, null, "2026-09-22T10:00:00Z");
    const linkway = report.circuits.find(circuit => circuit.name === "Linkway light 1")!;
    expect(linkway).toMatchObject({ fullDays: 0, weekdayPerDay: null, weekendPerDay: null, monthKwh: 0 });
    expect(linkway.periodKwh).toBeCloseTo(0.16, 9);
    expect(report.estimate.note).toContain("Not enough readings for linkway light 1: it has no full day of readings in these dates, so it is not counted in the 30-day estimate.");
    expect(report.estimate.note).not.toContain("fills in the missing days for linkway light 1");
    const html = renderSiteReportMarkup(report);
    expect(html).toMatch(/Linkway light 1<small class="code">Pavilion walk path light 1<\/small><\/td><td class="r" colSpan="2">Not enough readings<\/td><td class="r">0<\/td><td class="r">—<\/td>/i);
  });

  it("takes a meter's usual day only from its full days, never from the hours of a part day", () => {
    const report = buildSiteReport(data, null, "2026-09-22T10:00:00Z");
    const linkway = report.circuits.find(circuit => circuit.name === "Linkway light 2")!;
    expect(linkway.fullDays).toBe(13);
    expect(linkway.weekdayPerDay).toBeCloseTo(0.192, 9);
    expect(linkway.weekendPerDay).toBeCloseTo(0.192, 9);
    expect(linkway.monthKwh).toBeCloseTo(0.192 * 30, 9);
    // No figure for either linkway light comes anywhere near the 1.9 kWh a day a per-hour reading would give.
    for (const circuit of report.circuits.filter(item => item.name.startsWith("Linkway"))) expect(Math.max(circuit.weekdayPerDay ?? 0, circuit.weekendPerDay ?? 0, circuit.monthKwh / 30)).toBeLessThan(0.2);
  });

  it("shows not enough readings in the management review rather than a per-day figure", () => {
    const review = buildManagementReview(data, null, "2026-09-22T10:00:00Z");
    const meter = (name: string) => review.method.meters.find(item => item.name === name)!;
    // Linkway light 1 stopped long ago, so the note says when; it still has no usual day.
    expect(meter("Linkway light 1")).toMatchObject({ perDay: null, note: "Last reading 3 Aug, 8 pm" });
    expect(meter("Linkway light 2").perDay).toBeCloseTo(0.192, 9);
    // A meter that is still sending but has no full day says so.
    const fresh = estate({ ...LINKWAY, "linkway-1": { ...LINKWAY["linkway-1"]!, kwh: (date, hour) => date === DATES.at(-1) && hour >= 19 ? 0.016 : null } });
    expect(buildManagementReview(fresh, null, "2026-09-22T10:00:00Z").method.meters.find(item => item.name === "Linkway light 1")).toMatchObject({ perDay: null, note: "Not enough readings for a usual day" });
  });
});
