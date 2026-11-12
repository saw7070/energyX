/**
 * A daily report on an estate filed in groups, where the meter settings from Facility meet the report. Two blocks (each
 * with Ground floor, Block lighting and Emergency lights) and a Common area, lights on 18:30–06:45. The emergency lights
 * are ticked "always on by design" and the block lighting circuits carry a number of lights, as the meter form saves
 * them. The daily schedule reads one day; the report must read it as that one day, by group. All names are made up.
 */
import { describe, expect, it } from "vitest";
import { buildManagementReview, buildSiteReport, type AnalysisData, type ScopeData, type ScopeMeter, type TrendSeries } from "@datafoundry/site-report";
import { renderSiteReportMarkup } from "@datafoundry/site-report/site-report-document";
import { renderManagementReviewMarkup } from "@datafoundry/site-report/management-review-document";

const DAY = "2026-11-10";
// Lights on 18:30–06:45: the hours from 19:00 to 06:00 run in full, the two edge hours in part.
const share = (hour: number) => hour >= 19 || hour < 6 ? 1 : hour === 18 ? 0.5 : hour === 6 ? 0.75 : 0;
type Profile = (hour: number) => number;
type Meter = { name: string; group: string; kwh: Profile; category?: ScopeMeter["category"] };
const lit = (kw: number): Profile => hour => kw * share(hour);

const METERS: Record<string, Meter> = {
  "a-lobby": { name: "Block A lift lobby", group: "a-gf", kwh: lit(0.2) },
  "a-letters": { name: "Block A letter boxes", group: "a-gf", kwh: lit(0.1) },
  "a-void": { name: "Block A void deck", group: "a-gf", kwh: lit(0.3) },
  "a-low": { name: "Block A L1–L6 corridors", group: "a-lighting", kwh: lit(0.5) },
  "a-high": { name: "Block A L7–L12 corridors", group: "a-lighting", kwh: lit(0.5) },
  // Emergency lights run day and night: always on by design, so never daytime use.
  "a-emergency": { name: "Block A emergency lights", group: "a-emergency", kwh: () => 0.1 },
  "b-lobby": { name: "Block B lift lobby", group: "b-gf", kwh: lit(0.2) },
  "b-letters": { name: "Block B letter boxes", group: "b-gf", kwh: lit(0.1) },
  "b-void": { name: "Block B void deck", group: "b-gf", kwh: lit(0.3) },
  "b-low": { name: "Block B L1–L6 corridors", group: "b-lighting", kwh: lit(0.4) },
  "b-high": { name: "Block B L7–L12 corridors", group: "b-lighting", kwh: lit(0.4) },
  "b-emergency": { name: "Block B emergency lights", group: "b-emergency", kwh: () => 0.1 },
  // The driveway lamp was left on until 9 am: real daytime use.
  driveway: { name: "Driveway lamp", group: "driveway", kwh: hour => hour >= 7 && hour < 9 ? 0.15 : lit(0.15)(hour) },
  chute: { name: "Rubbish chute lamp", group: "driveway", kwh: lit(0.05) },
  playground: { name: "Playground lights", group: "playground", kwh: lit(0.1) },
  fan: { name: "Pavilion fan", group: "pavilion", kwh: hour => hour >= 19 && hour < 21 ? 0.05 : 0, category: "load" },
  sign: { name: "Estate signboard", group: "entrance", kwh: lit(0.05) },
};
const GROUPS = [
  { id: "block-a", name: "Block A", parentId: null, order: 10 },
  { id: "a-gf", name: "Ground floor", parentId: "block-a", order: 10 },
  { id: "a-lighting", name: "Block lighting", parentId: "block-a", order: 20 },
  { id: "a-emergency", name: "Emergency lights", parentId: "block-a", order: 30 },
  { id: "block-b", name: "Block B", parentId: null, order: 20 },
  { id: "b-gf", name: "Ground floor", parentId: "block-b", order: 10 },
  { id: "b-lighting", name: "Block lighting", parentId: "block-b", order: 20 },
  { id: "b-emergency", name: "Emergency lights", parentId: "block-b", order: 30 },
  { id: "common", name: "Common area", parentId: null, order: 30 },
  { id: "driveway", name: "Driveway", parentId: "common", order: 10 },
  { id: "playground", name: "Playground", parentId: "common", order: 20 },
  { id: "pavilion", name: "Pavilion", parentId: "common", order: 30 },
  { id: "entrance", name: "Entrance", parentId: "common", order: 40 },
];
const NIGHTS = Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map(day => [day, [{ from: "18:30", to: "06:45" }]]));
const ids = Object.keys(METERS);

/** The day's readings; `until` stops them at that hour, as when the gateway goes quiet; `quiet` meters send nothing. */
function day(options: { until?: number; quiet?: string[]; idle?: string[] } = {}): AnalysisData {
  const until = options.until ?? 24;
  const sends = (id: string) => !options.quiet?.includes(id);
  const series = (id: string): TrendSeries => ({ id, expectedMinutesPerHour: 60,
    cells: sends(id) ? Array.from({ length: until }, (_, hour) => [DAY, hour, METERS[id]!.kwh(hour), 60, 0] as TrendSeries["cells"][number]) : [] });
  const meters = ids.map((id): ScopeMeter => ({ id, name: METERS[id]!.name, location: METERS[id]!.group, category: METERS[id]!.category ?? "light", official: true, series: series(id) }));
  const live = ids.filter(sends);
  const total: TrendSeries = { id: "__scope__", expectedMinutesPerHour: ids.length * 60,
    cells: Array.from({ length: until }, (_, hour) => [DAY, hour, live.reduce((sum, id) => sum + METERS[id]!.kwh(hour), 0), live.length * 60, 0] as TrendSeries["cells"][number]) };
  const kwhOf = (id: string) => series(id).cells.reduce((sum, cell) => sum + (cell[2] ?? 0), 0);
  const usage = live.reduce((sum, id) => sum + kwhOf(id), 0);
  const project: ScopeData = { id: "estate", name: "Maple Estate", dates: [DAY], timezone: "Asia/Singapore", total, types: {}, meters, usageKwh: usage, peakKw: null, peakAt: null,
    cost: { amount: usage * 0.3, currency: "SGD", note: "0.3 SGD/kWh before tax" }, typeTotals: {}, coverage: total.cells.reduce((sum, cell) => sum + cell[3], 0) / (ids.length * 60 * 24) * 100 };
  return {
    projectId: "estate", projectName: "Maple Estate", timezone: "Asia/Singapore", snapshotId: null,
    current: { project, spaces: [] }, previous: null, history: null, circuits: [], holidays: new Map(), openingHours: NIGHTS, actions: [], hoursMeaning: "lights_on",
    groups: { list: GROUPS, meters: ids.map(id => ({ id, name: METERS[id]!.name, groupId: METERS[id]!.group, kwh: kwhOf(id) })) },
    // As the meter form saves them: "Always on by design" ticked, and a number of lights.
    alwaysOnByDesign: [{ id: "a-emergency", name: "Block A emergency lights" }, { id: "b-emergency", name: "Block B emergency lights" }],
    lightCounts: [{ id: "a-low", name: "Block A L1–L6 corridors", count: 20 }, { id: "a-high", name: "Block A L7–L12 corridors", count: 20 }, { id: "b-low", name: "Block B L1–L6 corridors", count: 16 }],
    ...(options.idle ? { idleWhenQuiet: options.idle } : {}),
  };
}
const GENERATED = "2026-11-11T01:00:00Z";
const text = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

const USAGE = ids.reduce((sum, id) => sum + Array.from({ length: 24 }, (_, hour) => METERS[id]!.kwh(hour)).reduce((acc, value) => acc + value, 0), 0);
const report = buildSiteReport(day(), null, GENERATED);
const html = renderSiteReportMarkup(report);

describe("a daily report on an estate filed in groups", () => {
  it("leads the breakdown with the day itself, then the groups in their saved order, adding up to the day", () => {
    expect(report.averageDay!.kwh).toBeCloseTo(USAGE, 9);
    expect(report.averageDay!.text).toBe("Used 46 kWh on this day (about S$14)");
    const rows = report.groups!.breakdown;
    expect(rows.map(row => row.name)).toEqual(["Block A", "Block B", "Common area"]);
    expect(rows.reduce((sum, row) => sum + row.perDay!, 0)).toBeCloseTo(USAGE, 9);
    expect(rows.reduce((sum, row) => sum + row.pct, 0)).toBe(100);
    // That day's kWh, never "a day", in the breakdown, its caption and the lines of the hour-by-hour chart.
    expect(report.estimate.loadCaption).toBe("Each group's kWh on this day and its share of all use. Open a group to see the groups and meters inside it.");
    expect(html).toContain("Block A</span>");
    expect(text(html)).not.toMatch(/kWh a day ·|kWh on an average day|· [\d.]+ kWh a day/);
    expect(text(html)).toContain("Block lighting · 22 kWh");
    expect(buildSiteReport(day(), null, GENERATED, "zh-Hans").averageDay!.text).toBe("这一天用电 46 kWh（约 S$14）");
    expect(buildSiteReport(day(), null, GENERATED, "ms").averageDay!.text).toBe("Menggunakan 46 kWh pada hari itu (kira-kira S$14)");
  });

  it("sets the two blocks side by side on that day, group for group", () => {
    expect(report.blocks!.intro).toBe("The same groups in each, in kWh on this day. The biggest difference is Block lighting: Block A used 25% more than Block B (12.2 kWh against 9.8 kWh).");
    expect(report.blocks!.rows.map(row => row.name)).toEqual(["Ground floor", "Block lighting", "Emergency lights", "Total"]);
  });

  it("leaves the meters ticked always on by design out of daytime use, and names only the light left on", () => {
    expect(report.daytime!.items).toEqual(["Driveway lamp: on 7–9 am, 0.3 kWh"]);
    expect(report.daytime!.alwaysOn).toBe("Always on by design, so left out of daytime use: Block A emergency lights and Block B emergency lights.");
    expect(report.keyFigures[3]!.value).toBe("0.6%");
    expect(report.headlineTopic).toBe("night");
    // Without the tick, the emergency lights' daytime hours count as daytime use.
    const unticked = buildSiteReport({ ...day(), alwaysOnByDesign: undefined }, null, GENERATED);
    expect(unticked.keyFigures[3]!.value).toBe("5.6%");
    expect(unticked.daytime!.items).toEqual(["Block A emergency lights: on 7 am – 7 pm, 1.2 kWh", "Block B emergency lights: on 7 am – 7 pm, 1.2 kWh", "Driveway lamp: on 7–9 am, 0.3 kWh"]);
    const review = buildManagementReview(day(), null, GENERATED);
    expect(review.summary.findings).toContain("The lights ran at night as planned: only **1%** of the energy was used in the daytime.");
    expect(review.daytime!.items).toEqual(["Driveway lamp: on 7–9 am, 0.3 kWh"]);
  });

  it("works out energy per light from the numbers of lights saved, for that day", () => {
    const perLight = report.perLight!;
    expect(perLight.intro).toBe("kWh per light on this day, for the meters with a number of lights recorded.");
    expect(perLight.rows.map(row => [row.kind, row.name, row.lights])).toEqual([
      ["meter", "Block A L1–L6 corridors", 20], ["meter", "Block A L7–L12 corridors", 20], ["group", "Block A › Block lighting, together", 40], ["meter", "Block B L1–L6 corridors", 16],
    ]);
    // 0.5 kW for the 12.25 lights-on hours of the day, over 20 lights.
    expect(perLight.rows[0]!.perDay).toBeCloseTo(0.5 * 12.25, 9);
    expect(perLight.rows[0]!.perLight).toBeCloseTo(0.5 * 12.25 / 20, 9);
    expect(text(html)).toContain("Lights kWh on the day kWh per light on the day");
    expect(text(renderManagementReviewMarkup(buildManagementReview(day(), null, GENERATED)))).toContain("kWh per light on the day");
  });

  it("on part of a day, still shares the day out by group, with no kWh a day, no blocks and no slices of a month", () => {
    const part = buildSiteReport(day({ until: 18 }), null, GENERATED);
    expect(`${part.title.before}${part.title.emphasis}`).toBe("Some readings for this day are missing");
    expect(part.averageDay).toBeNull();
    expect(part.blocks).toBeNull();
    expect(part.groups!.breakdown.every(row => row.perDay == null)).toBe(true);
    expect(part.groups!.breakdown.reduce((sum, row) => sum + row.pct, 0)).toBe(100);
    expect(part.estimate.loadCaption).toBe("Each group's share of all use. Open a group to see the groups and meters inside it.");
    const page = text(renderSiteReportMarkup(part));
    expect(page).toContain("Where the energy goes, by group Block A 48%");
    expect(page).not.toContain("share of an estimated 30-day month");
  });

  it("says a meter that was only using nothing sent no new readings for that reason, as Data availability does", () => {
    const idle = buildSiteReport(day({ until: 18, quiet: ["fan"], idle: ["fan"] }), null, GENERATED);
    expect(idle.lede).toContain("Pavilion fan used nothing, so it sent no new readings.");
    expect(idle.lede).not.toContain("sent no readings at all");
    // Without the live check saying so, a quiet meter is still named as sending nothing.
    expect(buildSiteReport(day({ until: 18, quiet: ["fan"] }), null, GENERATED).lede).toContain("Pavilion fan sent no readings at all.");
    expect(buildSiteReport(day({ until: 18, quiet: ["fan"], idle: ["fan"] }), null, GENERATED, "zh-Hans").lede).toContain("Pavilion fan当天没有用电，所以没有发送新读数。");
    expect(buildSiteReport(day({ until: 18, quiet: ["fan"], idle: ["fan"] }), null, GENERATED, "ms").lede).toContain("Pavilion fan tidak menggunakan apa-apa, jadi ia tidak menghantar bacaan baharu.");
  });

  it("writes every new sentence in Chinese and Malay, with nothing left unfilled, whole or in part", () => {
    for (const locale of ["zh-Hans", "ms"] as const) for (const data of [day(), day({ until: 18, quiet: ["fan"], idle: ["fan"] })]) {
      const full = renderSiteReportMarkup(buildSiteReport(data, null, GENERATED, locale));
      const review = renderManagementReviewMarkup(buildManagementReview(data, null, GENERATED, locale));
      for (const page of [full, review]) expect(page).not.toMatch(/undefined|NaN|\{\w+\}/);
    }
    expect(text(renderSiteReportMarkup(buildSiteReport(day(), null, GENERATED, "zh-Hans")))).toContain("当天每盏灯 kWh");
    expect(text(renderSiteReportMarkup(buildSiteReport(day(), null, GENERATED, "ms")))).toContain("kWh bagi setiap lampu pada hari itu");
  });
});
