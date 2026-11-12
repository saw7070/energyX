/**
 * An estate whose lights should run at night, its meters filed in groups the way a town council files them: two blocks
 * (each with Ground floor, Block lighting and Emergency lights) and a Common area (Driveway, Playground, Pavilion,
 * Entrance), saved in that order. The report leads with the average day, splits it by group in the saved order, sets
 * the blocks side by side group for group, draws the average day one line per group, names what was behind a day that
 * stood out, says plainly which meters used nothing, and shows energy per light where the number of lights is known.
 * All names are made up.
 */
import { describe, expect, it } from "vitest";
import { buildManagementReview, buildSiteReport, energyPerLight, groupProfileLines, meterSeries, metersWithNoUse, type AnalysisData, type BreakdownRow, type ScopeData, type ScopeMeter, type TrendSeries } from "@datafoundry/site-report";
import { renderSiteReportMarkup } from "@datafoundry/site-report/site-report-document";
import { renderManagementReviewMarkup } from "@datafoundry/site-report/management-review-document";

// Two weeks from Monday 2 Nov 2026; lights on 19:00–07:00 every night.
const DATES = Array.from({ length: 14 }, (_, index) => new Date(Date.parse("2026-11-02T00:00:00Z") + index * 86_400_000).toISOString().slice(0, 10));
const night = (hour: number) => hour >= 19 || hour < 7;
const BUSY_DAY = "2026-11-08";
type Profile = (date: string, hour: number) => number;
type Meter = { name: string; group: string; kwh: Profile; category?: "light" | "load" };
const lit = (kw: number): Profile => (_date, hour) => night(hour) ? kw : 0;
// Block A's block lighting runs brighter on 8 Nov: both of its meters, so the group is named rather than one meter.
const busier = (kw: number): Profile => (date, hour) => night(hour) ? kw + (date === BUSY_DAY ? 0.1 : 0) : 0;

const METERS: Record<string, Meter> = {
  "a-lobby": { name: "Block A lift lobby", group: "a-gf", kwh: lit(0.2) },
  "a-letters": { name: "Block A letter boxes", group: "a-gf", kwh: lit(0.2) },
  "a-void": { name: "Block A void deck", group: "a-gf", kwh: lit(0.2) },
  "a-low": { name: "Block A L1–L6 corridors", group: "a-lighting", kwh: busier(0.5) },
  "a-high": { name: "Block A L7–L12 corridors", group: "a-lighting", kwh: busier(0.5) },
  "a-emergency": { name: "Block A emergency lights", group: "a-emergency", kwh: () => 0.1 },
  "b-lobby": { name: "Block B lift lobby", group: "b-gf", kwh: lit(0.2) },
  "b-letters": { name: "Block B letter boxes", group: "b-gf", kwh: lit(0.2) },
  "b-void": { name: "Block B void deck", group: "b-gf", kwh: lit(0.2) },
  "b-low": { name: "Block B L1–L6 corridors", group: "b-lighting", kwh: lit(0.45) },
  "b-high": { name: "Block B L7–L12 corridors", group: "b-lighting", kwh: lit(0.45) },
  "b-emergency": { name: "Block B emergency lights", group: "b-emergency", kwh: () => 0.1 },
  driveway: { name: "Driveway lamp", group: "driveway", kwh: lit(0.15) },
  chute: { name: "Rubbish chute lamp", group: "driveway", kwh: lit(0.15) },
  playground: { name: "Playground lights", group: "playground", kwh: lit(0.1) },
  // Nobody switched the pavilion fan on: it sends readings, all of them zero. It is not a light, so it can rightly sit
  // unused even at a site with lights-on hours.
  fan: { name: "Pavilion fan", group: "pavilion", kwh: () => 0, category: "load" },
  sign: { name: "Estate signboard", group: "entrance", kwh: lit(0.05) },
};
// Listed in a different order from the one saved: the saved order wins.
const GROUPS = [
  { id: "common", name: "Common area", parentId: null, order: 30 },
  { id: "entrance", name: "Entrance", parentId: "common", order: 40 },
  { id: "pavilion", name: "Pavilion", parentId: "common", order: 30 },
  { id: "playground", name: "Playground", parentId: "common", order: 20 },
  { id: "driveway", name: "Driveway", parentId: "common", order: 10 },
  { id: "block-b", name: "Block B", parentId: null, order: 20 },
  { id: "b-emergency", name: "Emergency lights", parentId: "block-b", order: 30 },
  { id: "b-lighting", name: "Block lighting", parentId: "block-b", order: 20 },
  { id: "b-gf", name: "Ground floor", parentId: "block-b", order: 10 },
  { id: "block-a", name: "Block A", parentId: null, order: 10 },
  { id: "a-emergency", name: "Emergency lights", parentId: "block-a", order: 30 },
  { id: "a-lighting", name: "Block lighting", parentId: "block-a", order: 20 },
  { id: "a-gf", name: "Ground floor", parentId: "block-a", order: 10 },
];
const NIGHTS = Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map(day => [day, [{ from: "19:00", to: "07:00" }]]));

const series = (id: string, kwh: Profile): TrendSeries => ({ id, expectedMinutesPerHour: 60, cells: DATES.flatMap(date => Array.from({ length: 24 }, (_, hour) => [date, hour, kwh(date, hour), 60, 0] as TrendSeries["cells"][number])) });
const ids = Object.keys(METERS);
const periodKwh = (id: string) => series(id, METERS[id]!.kwh).cells.reduce((sum, cell) => sum + cell[2]!, 0);
const TOTAL = ids.reduce((sum, id) => sum + periodKwh(id), 0);
// 47.4 kWh a day, and 2.4 kWh more on 8 Nov.
const AVERAGE_DAY = TOTAL / 14;

function estate(extra: Partial<AnalysisData> = {}): AnalysisData {
  // Every meter has a short name, its panel label kept as the full name.
  const meters = ids.map((id): ScopeMeter => ({ id, name: METERS[id]!.name, fullName: `DB ${id} lighting`, location: METERS[id]!.group, category: METERS[id]!.category ?? "light", official: true, series: series(id, METERS[id]!.kwh) }));
  const total = series("__scope__", (date, hour) => ids.reduce((sum, id) => sum + METERS[id]!.kwh(date, hour), 0));
  total.expectedMinutesPerHour = ids.length * 60;
  for (const cell of total.cells) cell[3] = ids.length * 60;
  const project: ScopeData = { id: "estate", name: "Maple Estate", dates: DATES, timezone: "Asia/Singapore", total, types: {}, meters, usageKwh: TOTAL, peakKw: null, peakAt: null,
    cost: { amount: TOTAL * 0.3, currency: "SGD", note: "0.3 SGD/kWh before tax" }, typeTotals: {}, coverage: 100 };
  return {
    projectId: "estate", projectName: "Maple Estate", timezone: "Asia/Singapore", snapshotId: null,
    current: { project, spaces: [] }, previous: null, history: null, circuits: [], holidays: new Map(), openingHours: NIGHTS, actions: [], hoursMeaning: "lights_on",
    groups: { list: GROUPS, meters: ids.map(id => ({ id, name: METERS[id]!.name, groupId: METERS[id]!.group, kwh: periodKwh(id) })) },
    alwaysOnByDesign: [{ id: "a-emergency", name: "Block A emergency lights" }, { id: "b-emergency", name: "Block B emergency lights" }],
    lightCounts: [{ id: "a-low", name: "Block A L1–L6 corridors", count: 24 }, { id: "a-high", name: "Block A L7–L12 corridors", count: 24 }, { id: "driveway", name: "Driveway lamp", count: 6 }],
    ...extra,
  };
}
const GENERATED = "2026-11-16T02:00:00Z";
const report = buildSiteReport(estate(), null, GENERATED);
const names = (rows: BreakdownRow[]) => rows.map(row => row.name);

describe("the average day leads, then where it goes by group", () => {
  it("says what the site uses on an average day and what that costs", () => {
    expect(report.averageDay!.kwh).toBeCloseTo(AVERAGE_DAY, 9);
    expect(report.averageDay!.cost).toBeCloseTo(AVERAGE_DAY * 0.3, 9);
    expect(report.averageDay!.text).toBe("Uses about 48 kWh a day (about S$14)");
    expect(buildSiteReport(estate(), null, GENERATED, "zh-Hans").averageDay!.text).toBe("平均每天用电约 48 kWh（约 S$14）");
    expect(buildSiteReport(estate(), null, GENERATED, "ms").averageDay!.text).toBe("Menggunakan kira-kira 48 kWh sehari (kira-kira S$14)");
    // Without a rate, the energy alone.
    const noRate = estate();
    noRate.current.project.cost = null;
    expect(buildSiteReport(noRate, null, GENERATED).averageDay!.text).toBe("Uses about 48 kWh a day");
  });

  it("splits it by top-level group in the saved order, adding up to the whole site", () => {
    const rows = report.groups!.breakdown;
    expect(names(rows)).toEqual(["Block A", "Block B", "Common area"]);
    expect(rows.reduce((sum, row) => sum + row.share, 0)).toBeCloseTo(1, 9);
    expect(rows.reduce((sum, row) => sum + row.perDay!, 0)).toBeCloseTo(AVERAGE_DAY, 9);
    // As whole percentages too: the top-level groups add up to exactly 100%, the groups inside one to its own share.
    expect(rows.reduce((sum, row) => sum + row.pct, 0)).toBe(100);
    for (const row of rows) expect(row.rows.reduce((sum, child) => sum + child.pct, 0)).toBe(row.pct);
    // Each top-level group opens onto its own groups, each with its share of the whole site, adding up to the group's.
    const common = rows[2]!;
    expect(names(common.rows)).toEqual(["Driveway", "Playground", "Pavilion", "Entrance"]);
    expect(common.rows.reduce((sum, row) => sum + row.share, 0)).toBeCloseTo(common.share, 9);
    expect(common.rows[0]!.perDay).toBeCloseTo(3.6, 9);
    expect(common.rows[0]!.share).toBeCloseTo(3.6 * 14 / TOTAL, 9);
    expect(names(rows[0]!.rows)).toEqual(["Ground floor", "Block lighting", "Emergency lights"]);
    // The meters of a group stay inside it.
    expect(names(rows[0]!.rows[1]!.rows)).toEqual(["Block A L1–L6 corridors", "Block A L7–L12 corridors"]);
  });

  it("ranks by group, not by single circuit", () => {
    expect(report.estimate.comparison).toContain("The biggest single group is **Block lighting** in Block A, at 26% of all use.");
    expect(report.estimate.comparison).not.toContain("Of all the meters");
    expect(report.estimate.loadCaption).toBe("Each group's kWh on an average day and its share of all use. Open a group to see the groups and meters inside it.");
    // The estimate table lists the meters under their top-level group, in the saved order, with no single circuit singled out.
    const html = renderSiteReportMarkup(report);
    const heads = [...html.matchAll(/<tr class="group-head"><td colSpan="6">([^<]+)<\/td><\/tr>/gi)].map(match => match[1]);
    expect(heads).toEqual(["Block A", "Block B", "Common area"]);
    expect(html.slice(html.indexOf('id="estimate"'), html.indexOf('id="benchmark"'))).not.toContain('class="r hot"');
    expect(html.indexOf('group-head"><td colSpan="6">Common area')).toBeLessThan(html.indexOf("<td>Driveway lamp<small"));
  });

  it("prints the breakdown as groups that open, in place of a slice for every meter", () => {
    const html = renderSiteReportMarkup(report);
    expect(html).toContain("Where the energy goes, by group");
    expect(html).not.toContain("By meter — share of an estimated 30-day month");
    expect(html).toContain("By group — share of an estimated 30-day month");
    expect(html).toMatch(/<details><summary><span class="bd-row"><span class="bd-name">Block A<\/span>/);
    expect(html).toContain("Uses about 48 kWh a day (about S$14)");
    expect(html).toContain("3.6 kWh a day · 8%");
    expect(html).toContain("Meters: Driveway lamp, Rubbish chute lamp");
    // The order on the page is the saved order.
    expect(html.indexOf(">Block A</span>")).toBeLessThan(html.indexOf(">Block B</span>"));
    expect(html.indexOf(">Driveway</span>")).toBeLessThan(html.indexOf(">Entrance</span>"));
  });

  it("keeps the slice for every meter for readings saved before groups existed", () => {
    const plain = buildSiteReport(estate({ groups: undefined }), null, GENERATED);
    expect(plain.groups).toBeNull();
    expect(renderSiteReportMarkup(plain)).toContain("By meter — share of an estimated 30-day month");
  });
});

describe("block against block, group for group", () => {
  it("sets the same groups in each block side by side, never one circuit against another", () => {
    const blocks = report.blocks!;
    expect(blocks.heading).toBe("Block A against Block B");
    expect(blocks.groups.map(group => group.name)).toEqual(["Block A", "Block B"]);
    expect(blocks.rows.map(row => [row.name, row.diff])).toEqual([["Ground floor", "Close"], ["Block lighting", "Block A +13%"], ["Emergency lights", "Close"], ["Total", "Block A +7%"]]);
    expect(blocks.rows[1]!.perDay[0]).toBeCloseTo((12 * 13 + 14.4) / 14, 9);
    expect(blocks.rows[1]!.perDay[1]).toBeCloseTo(10.8, 9);
    expect(blocks.intro).toBe("The same groups in each, in kWh on an average day. The biggest difference is Block lighting: Block A uses 13% more than Block B (12.2 kWh against 10.8 kWh a day).");
    const html = renderSiteReportMarkup(report);
    expect(html).toContain("Block A against Block B");
    expect(html).toContain("<th>Group</th><th class=\"r\">Block A</th><th class=\"r\">Block B</th><th class=\"r\">Difference</th>");
  });

  it("matches the same groups in the management review", () => {
    const review = buildManagementReview(estate(), null, GENERATED);
    expect(review.comparison!.heading).toBe("Block A against Block B");
    expect(review.comparison!.parts.map(part => part.name).sort()).toEqual(["Block lighting", "Emergency lights", "Ground floor"]);
    expect(review.groups!.rows.map(row => row.name)).toEqual(["Block A", "Block B", "Common area"]);
  });

  it("says so when no two top-level groups are alike", () => {
    const unlike = estate({ groups: { ...estate().groups!, list: GROUPS.map(group => group.id === "block-b" ? { ...group, name: "Car park" } : group) } });
    expect(buildSiteReport(unlike, null, GENERATED).blocks).toBeNull();
  });
});

describe("the average day, one line per group", () => {
  it("names each line by the site's groups, the same group in both blocks added together", () => {
    const lines = report.pattern!.lines!;
    expect(lines.map(line => line.name)).toEqual(["Ground floor", "Block lighting", "Emergency lights", "Driveway", "Playground", "Pavilion", "Entrance"]);
    expect(lines[0]!.hours[22]).toBeCloseTo(6 * 0.2, 9);
    expect(lines[0]!.hours[12]).toBe(0);
    expect(lines[2]!.hours[12]).toBeCloseTo(0.2, 9);
    expect(new Set(lines.map(line => line.colour)).size).toBe(lines.length);
    expect(report.pattern!.caption).toContain("Each line is one group; the same group in Block A and Block B is added into one line.");
    const html = renderSiteReportMarkup(report);
    expect(html).toContain("Ground floor · 14.4 kWh a day");
    expect(html).toContain("one line for each group: Ground floor, Block lighting, Emergency lights, Driveway, Playground, Pavilion, Entrance");
  });

  it("adds the smallest groups into one line beyond seven", () => {
    const tree = { ...buildSiteReportTree(), children: [] };
    expect(groupProfileLines({ tree, series: new Map(), dates: DATES, otherLabel: "Other groups" })).toEqual([]);
    // The rubbish chute lamp moves to a garden group of its own: eight groups, so the two smallest share one line.
    const base = estate().groups!;
    const crowded = estate({ groups: { list: [...GROUPS, { id: "garden", name: "Garden", parentId: "common", order: 50 }], meters: base.meters.map(meter => meter.id === "chute" ? { ...meter, groupId: "garden" } : meter) } });
    const lines = buildSiteReport(crowded, null, GENERATED).pattern!.lines!;
    expect(lines).toHaveLength(7);
    expect(lines.map(line => line.name)).toEqual(["Ground floor", "Block lighting", "Emergency lights", "Driveway", "Playground", "Garden", "Other groups"]);
    expect(lines.at(-1)!.dayKwh).toBeCloseTo(0.6, 9);
    expect(lines.at(-1)!.name).toBe("Other groups");
  });

  it("draws the same lines in the management review", () => {
    const review = buildManagementReview(estate(), null, GENERATED);
    expect(review.profile!.lines!.map(line => line.name)).toEqual(report.pattern!.lines!.map(line => line.name));
    expect(renderManagementReviewMarkup(review)).toContain("Block lighting · 23 kWh a day");
  });

  it("keeps the single line for readings without groups", () => {
    expect(buildSiteReport(estate({ groups: undefined }), null, GENERATED).pattern!.lines).toBeUndefined();
  });
});

describe("days that stood out name what was behind them", () => {
  it("names the group behind the difference and what it usually uses", () => {
    expect(report.standout.items).toEqual([{ date: BUSY_DAY, text: "On 8 Nov the Block A block lighting used 14.4 kWh; it usually uses 12 kWh." }]);
    expect(buildSiteReport(estate(), null, GENERATED, "zh-Hans").standout.items[0]!.text).toBe("11月8日，Block A的Block lighting用电 14.4 kWh，平时约 12 kWh。");
    expect(buildSiteReport(estate(), null, GENERATED, "ms").standout.items[0]!.text).toBe("Pada 8 Nov, Block lighting di Block A menggunakan 14.4 kWh; biasanya 12 kWh.");
  });

  it("names the one circuit when it explains most of its group's change", () => {
    const one = { ...METERS, "a-high": { ...METERS["a-high"]!, kwh: lit(0.5) }, "a-low": { ...METERS["a-low"]!, kwh: (date: string, hour: number) => night(hour) ? 0.5 + (date === BUSY_DAY ? 0.2 : 0) : 0 } };
    const saved = { ...METERS };
    Object.assign(METERS, one);
    try {
      expect(buildSiteReport(estate(), null, GENERATED).standout.items[0]!.text).toBe("On 8 Nov Block A L1–L6 corridors used 8.4 kWh; they usually use 6 kWh.");
    } finally { Object.assign(METERS, saved); }
  });
});

describe("meters that used nothing", () => {
  it("are named plainly, with the dates, and never as a fault", () => {
    expect(report.noUse).toEqual({ heading: "No use in these dates", items: ["Pavilion fan: no use from 2–15 Nov"], note: "This is not a fault. Some things, such as a fan, are only switched on now and then." });
    expect(report.screening.rows.find(row => row.label === "Pavilion fan")!.finding).toBe("No use in these dates.");
    expect(buildSiteReport(estate(), null, GENERATED, "ms").noUse!.items).toEqual(["Pavilion fan: tiada penggunaan dari 2–15 Nov"]);
    expect(buildSiteReport(estate(), null, GENERATED, "zh-Hans").noUse!.heading).toBe("这段时间没有用电");
    expect(renderSiteReportMarkup(report)).toContain("Pavilion fan: no use from 2–15 Nov");
  });

  it("leaves out a meter that sent nothing at all, which has stopped rather than used nothing", () => {
    const meters = estate().current.project.meters;
    const silent = meters.map(meter => meter.id === "fan" ? { ...meter, series: { ...meter.series!, cells: [] } } : meter);
    expect(metersWithNoUse(silent, DATES)).toEqual([]);
    expect(metersWithNoUse(meters, DATES).map(item => item.meter.name)).toEqual(["Pavilion fan"]);
    expect(metersWithNoUse(meters, ["2026-11-04", "2026-11-06"])[0]!.dates).toEqual(["2026-11-04", "2026-11-06"]);
  });

  it("are noted in the management review's meter list and findings", () => {
    const review = buildManagementReview(estate(), null, GENERATED);
    // The same words as a meter only using nothing on Data availability, and an idle meter in this same list.
    expect(review.method.meters.find(meter => meter.name === "Pavilion fan")!.note).toBe("No use in this period");
    expect(review.noUse!.items).toEqual(["Pavilion fan: no use from 2–15 Nov"]);
    // Only worth knowing, so it comes after the five findings that matter more here.
    expect(review.summary.findings.join(" ")).not.toContain("Pavilion fan");
    expect(renderManagementReviewMarkup(review)).toContain("No use in these dates");
  });

  it("are something to check on site when they should run: lighting at a lights-on site, or a meter always on by design", () => {
    // The playground lights and Block B's emergency lights (always on by design) used nothing, as the fan did.
    const dark = (data: AnalysisData, off: string[]): AnalysisData => {
      const project = data.current.project;
      const meters = project.meters.map(meter => off.includes(meter.id) ? { ...meter, series: { ...meter.series!, cells: meter.series!.cells.map(cell => [cell[0], cell[1], 0, cell[3], cell[4]] as TrendSeries["cells"][number]) } } : meter);
      return { ...data, current: { ...data.current, project: { ...project, meters } } };
    };
    const lit = buildSiteReport(dark(estate(), ["playground", "b-emergency"]), null, GENERATED);
    expect(lit.noUse!.items).toEqual(["Block B emergency lights: no use from 2–15 Nov", "Playground lights: no use from 2–15 Nov", "Pavilion fan: no use from 2–15 Nov"]);
    expect(lit.noUse!.note).toBe("Block B emergency lights and Playground lights should come on every night or stay on, so using nothing may mean a fault: check them on site. For the others this is not a fault: some things, such as a fan, are only switched on now and then.");
    expect(buildSiteReport(dark(estate(), ["playground"]), null, GENERATED, "ms").noUse!.note).toMatch(/^Playground lights sepatutnya menyala setiap malam/);
    expect(buildSiteReport(dark(estate(), ["playground"]), null, GENERATED, "zh-Hans").noUse!.note).toMatch(/^Playground lights本应每晚亮灯/);
    // Something to check is not crowded out of the summary by what is only worth knowing.
    const review = buildManagementReview(dark(estate(), ["playground"]), null, GENERATED);
    expect(review.summary.findings).toContain("2 meters used nothing in these dates (see Method and data). Some should come on every night or stay on, so check them on site.");
    expect(review.summary.findings.join(" ")).not.toContain("That is not a fault");
    // The emergency lights alone, with the fan switched on: the finding names them and asks for a check.
    const fanOn = estate();
    fanOn.current.project.meters = fanOn.current.project.meters.map(meter => meter.id === "fan" ? { ...meter, series: { ...meter.series!, cells: meter.series!.cells.map(cell => [cell[0], cell[1], 0.01, cell[3], cell[4]] as TrendSeries["cells"][number]) } } : meter);
    expect(buildManagementReview(dark(fanOn, ["b-emergency"]), null, GENERATED).summary.findings).toContain("Block B emergency lights used nothing from 2–15 Nov. It should come on every night or stay on, so check it on site.");
    // At a site with opening hours a light may rightly sit unused; one always on by design still may not.
    const daytime = { ...dark(estate(), ["playground", "b-emergency"]), hoursMeaning: undefined };
    expect(buildSiteReport(daytime, null, GENERATED).noUse!.note).toBe("Block B emergency lights should come on every night or stay on, so using nothing may mean a fault: check it on site. For the others this is not a fault: some things, such as a fan, are only switched on now and then.");
  });
});

describe("energy per light", () => {
  it("shows kWh per light a day for meters with a number of lights, and for their group", () => {
    const perLight = report.perLight!;
    expect(perLight.heading).toBe("Energy per light");
    expect(perLight.rows.map(row => [row.kind, row.name, row.group, row.lights])).toEqual([
      ["meter", "Block A L1–L6 corridors", "Block A › Block lighting", 24],
      ["meter", "Block A L7–L12 corridors", "Block A › Block lighting", 24],
      ["group", "Block A › Block lighting, together", "Block A › Block lighting", 48],
      ["meter", "Driveway lamp", "Common area › Driveway", 6],
    ]);
    const corridor = (6 * 13 + 7.2) / 14;
    expect(perLight.rows[0]!.perDay).toBeCloseTo(corridor, 9);
    expect(perLight.rows[0]!.perLight).toBeCloseTo(corridor / 24, 9);
    expect(perLight.rows[2]!.perLight).toBeCloseTo(corridor / 24, 9);
    expect(perLight.rows[3]!.perLight).toBeCloseTo(1.8 / 6, 9);
    const html = renderSiteReportMarkup(report);
    expect(html).toContain("kWh per light a day");
    expect(html).toContain("<td>Driveway lamp</td><td>Common area › Driveway</td><td class=\"r\">6</td><td class=\"r\">1.80</td><td class=\"r\">0.30</td>");
    expect(renderManagementReviewMarkup(buildManagementReview(estate(), null, GENERATED))).toContain("Energy per light");
  });

  it("is left out when no meter has a number of lights, and skips a meter without readings", () => {
    expect(buildSiteReport(estate({ lightCounts: undefined }), null, GENERATED).perLight).toBeNull();
    const found = energyPerLight({ counts: [{ id: "nowhere", name: "Old lamp", count: 4 }], tree: null, series: meterSeries([estate().current.project]), names: new Map(), dates: DATES });
    expect(found).toEqual({ meters: [{ id: "nowhere", name: "Old lamp", group: "", groupKey: null, lights: 4, perDay: null, perLight: null }], groups: [] });
  });
});

describe("every new sentence in Chinese and Malay", () => {
  it("writes the blocks, the lines and energy per light in the reader's language", () => {
    const zh = buildSiteReport(estate(), null, GENERATED, "zh-Hans");
    expect(zh.blocks!.heading).toBe("Block A 与 Block B 对比");
    expect(zh.perLight!.heading).toBe("每盏灯的用电");
    expect(zh.pattern!.caption).toContain("每条线代表一个分组");
    const ms = buildSiteReport(estate(), null, GENERATED, "ms");
    expect(ms.blocks!.rows[1]!.diff).toBe("Block A +13%");
    expect(ms.blocks!.rows[0]!.diff).toBe("Hampir sama");
    expect(renderSiteReportMarkup(ms)).toContain("Ke mana tenaga digunakan, mengikut kumpulan");
    for (const html of [renderSiteReportMarkup(zh), renderSiteReportMarkup(ms)]) expect(html).not.toMatch(/undefined|NaN|\{\w+\}/);
  });
});

function buildSiteReportTree() {
  // The tree the report reads, for the edge case of a site with nothing to split.
  return { id: "__site__", name: "Maple Estate", kwh: 0, share: 1, meterCount: 0, singleMeter: false, meters: [], children: [], depth: 0, position: 0, unmeteredKwh: 0 };
}
