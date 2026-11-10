import { describe, expect, it } from "vitest";
import { buildManagementReview, buildSiteReport, comparableGroups, groupKind, buildMeterGroupTree, type AnalysisData, type ScopeData, type ScopeMeter, type TrendSeries } from "@datafoundry/site-report";
import { renderManagementReviewHtml, renderStyledSiteReportHtml } from "@datafoundry/site-report/management-review-document";

// One week from Monday 3 Aug 2026. Made-up estate lighting: two blocks and a common area, lights on 19:00–07:00.
const DATES = Array.from({ length: 7 }, (_, index) => new Date(Date.parse("2026-08-03T00:00:00Z") + index * 86_400_000).toISOString().slice(0, 10));
const night = (hour: number) => hour >= 19 || hour < 7;
type Profile = (date: string, hour: number) => number | null;
type Def = { name: string; group: string; category: ScopeMeter["category"]; kwh: Profile };

const LIGHTING: Record<string, Def> = {
  "a-corridor": { name: "12A corridor lights", group: "block-a", category: "light", kwh: (_d, h) => night(h) ? 0.6 : 0 },
  "a-lobby": { name: "12A lift lobby lights", group: "block-a", category: "light", kwh: (_d, h) => night(h) ? 0.3 : 0 },
  "a-emergency": { name: "12A emergency lights", group: "block-a", category: "light", kwh: () => 0.1 },
  "b-corridor": { name: "12B corridor lights", group: "block-b", category: "light", kwh: (_d, h) => night(h) ? 0.6 : 0 },
  "b-lobby": { name: "12B lift lobby lights", group: "block-b", category: "light", kwh: (_d, h) => night(h) ? 0.36 : 0 },
  "b-emergency": { name: "12B emergency lights", group: "block-b", category: "light", kwh: () => 0.1 },
  "park": { name: "Car park lamps", group: "common", category: "light", kwh: (_d, h) => night(h) ? 0.4 : 0 },
  "pavilion": { name: "Pavilion lights", group: "common", category: "light", kwh: (_d, h) => night(h) ? 0.2 : 0 },
};
const GROUPS = [{ id: "block-a", name: "Block 12A", parentId: null }, { id: "block-b", name: "Block 12B", parentId: null }, { id: "common", name: "Common area", parentId: null }];
const NIGHTLY = Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map(day => [day, [{ from: "19:00", to: "07:00" }]]));

/** A meter's hours; a profile returning null sends nothing for that hour, like a meter that has stopped. */
const series = (id: string, kwh: Profile): TrendSeries => ({
  id, expectedMinutesPerHour: 60,
  cells: DATES.flatMap(date => Array.from({ length: 24 }, (_, hour) => kwh(date, hour)).flatMap((value, hour) => value == null ? [] : [[date, hour, value, 60, 0] as TrendSeries["cells"][number]])),
});
/** The site total as the engine adds it up: the meters' energy, minutes received and problems, over every meter in it. */
function total(defs: Record<string, Def>, ids: string[]): TrendSeries {
  const cells: TrendSeries["cells"] = [];
  for (const date of DATES) for (let hour = 0; hour < 24; hour += 1) {
    const values = ids.map(id => defs[id]!.kwh(date, hour));
    if (values.every(value => value == null)) continue;
    cells.push([date, hour, values.reduce<number>((sum, value) => sum + (value ?? 0), 0), values.filter(value => value != null).length * 60, 0]);
  }
  return { id: "__scope__", expectedMinutesPerHour: ids.length * 60, cells };
}
function scope(defs: Record<string, Def>, name: string, ids: string[], rate: number | null): ScopeData {
  const sum = total(defs, ids);
  const usage = sum.cells.reduce((acc, cell) => acc + (cell[2] ?? 0), 0);
  return { id: name, name, dates: DATES, timezone: "Asia/Singapore", total: sum, types: {}, usageKwh: usage, peakKw: null, peakAt: null, typeTotals: {}, coverage: 100,
    meters: ids.map(id => ({ id, name: defs[id]!.name, location: name, category: defs[id]!.category, official: true, series: series(id, defs[id]!.kwh) })),
    cost: rate == null ? null : { amount: usage * rate, currency: "SGD", note: `${rate} SGD/kWh before tax` } };
}
function site(defs: Record<string, Def>, options: { groups?: typeof GROUPS | null; hours?: AnalysisData["openingHours"]; meaning?: "lights_on"; rate?: number | null; notInUse?: string[] } = {}): AnalysisData {
  const ids = Object.keys(defs);
  const groups = options.groups === undefined ? GROUPS : options.groups;
  const rate = options.rate === undefined ? 0.3 : options.rate;
  const kwhOf = (id: string) => series(id, defs[id]!.kwh).cells.reduce((sum, cell) => sum + (cell[2] ?? 0), 0);
  const spaceIds = groups ? groups.map(group => group.id) : [...new Set(ids.map(id => defs[id]!.group))];
  return {
    projectId: "estate", projectName: "Harbour Estate", timezone: "Asia/Singapore", snapshotId: null,
    current: { project: scope(defs, "Harbour Estate", ids, rate), spaces: spaceIds.map(group => scope(defs, groups?.find(item => item.id === group)?.name ?? group, ids.filter(id => defs[id]!.group === group), rate)) },
    previous: null, history: null, circuits: [], holidays: new Map(), openingHours: options.hours ?? NIGHTLY, actions: [],
    ...(options.meaning ? { hoursMeaning: options.meaning } : {}),
    ...(groups ? { groups: { list: groups, meters: ids.map(id => ({ id, name: defs[id]!.name, groupId: defs[id]!.group, kwh: kwhOf(id) })) } } : {}),
    ...(options.notInUse ? { notInUse: options.notInUse.map(id => ({ id, name: defs[id]!.name, reason: "reason:spare" })) } : {}),
  };
}
const GENERATED = "2026-08-10T02:00:00Z";

describe("management review: sections", () => {
  const review = buildManagementReview(site(LIGHTING, { meaning: "lights_on" }), null, GENERATED);

  it("follows the review's order and keeps every section that has something to say", () => {
    expect(review.sections).toEqual(["summary", "total", "groups", "comparison", "profile", "savings", "method"]);
    expect(review.title).toBe("What these 7 days show");
    expect(review.lede).toBe("This review covers the site's 8 meters over 7 days, organised by what the meters serve.");
    expect(review.summary.findings.length).toBeGreaterThanOrEqual(3);
    expect(review.summary.findings.length).toBeLessThanOrEqual(5);
    expect(review.summary.findings[0]).toMatch(/^The site used \*\*[\d,.]+ kWh\*\* over 7 days: about \*\*[\d,.]+ kWh a day\*\* \(about \*\*S\$[\d.]+\*\* a day\)\.$/);
  });

  it("totals each day with its cost and projects a month and a year from a typical day", () => {
    expect(review.total.days).toHaveLength(7);
    expect(review.total.days.every(day => day.complete)).toBe(true);
    const day = 12 * (0.6 + 0.3 + 0.6 + 0.36 + 0.4 + 0.2) + 24 * 0.2;
    expect(review.total.typicalKwh).toBeCloseTo(day, 6);
    expect(review.total.rows.map(row => row.label)).toEqual(["Typical day", "30-day month", "Year"]);
    expect(review.total.rows[1]!.kwh).toBeCloseTo(day * 30, 6);
    expect(review.total.rows[2]!.cost).toBeCloseTo(day * 365 * 0.3, 6);
    expect(review.keyFigures.map(figure => figure.label)).toEqual(expect.arrayContaining(["a typical day", "a 30-day month", "bill for a 30-day month"]));
  });

  it("gives each top-level group its total and share, and what uses the most inside it", () => {
    const groups = review.groups!;
    expect(groups.heading).toBe("Block 12B, Block 12A and Common area");
    expect(groups.rows.map(row => row.name)).toEqual(["Block 12B", "Block 12A", "Common area"]);
    expect(groups.rows.reduce((sum, row) => sum + row.share, 0)).toBeCloseTo(1, 6);
    expect(groups.rows[0]!.parts[0]).toMatchObject({ name: "12B corridor lights" });
    expect(groups.rows[0]!.biggest).toBe("Biggest in Block 12B: **12B corridor lights**, 52% of it.");
  });

  it("compares the two blocks side by side, part for part", () => {
    const comparison = review.comparison!;
    expect(comparison.heading).toBe("Block 12B against Block 12A");
    expect(comparison.groups.map(group => group.name)).toEqual(["Block 12B", "Block 12A"]);
    expect(comparison.parts.map(part => part.name)).toEqual(["Corridor lights", "Lift lobby lights", "Emergency lights"]);
    expect(comparison.parts[1]!.perDay[0]).toBeCloseTo(4.32, 6);
    expect(comparison.parts[1]!.perDay[1]).toBeCloseTo(3.6, 6);
    expect(comparison.intro).toContain("**Block 12B** uses **");
    expect(comparison.intro).toContain("Part for part, the biggest difference is Lift lobby lights: Block 12B uses 20% more than Block 12A.");
  });

  it("explains a gap between two blocks by what only one of them has", () => {
    const entrance: Record<string, Def> = { ...LIGHTING, "b-lobby": { ...LIGHTING["b-lobby"]!, kwh: (_d, h) => night(h) ? 0.31 : 0 }, entrance: { name: "Main entrance lighting", group: "block-a", category: "light", kwh: (_d, h) => night(h) ? 0.34 : 0 } };
    const review = buildManagementReview(site(entrance, { meaning: "lights_on" }), null, GENERATED);
    expect(review.summary.findings).toContain("**Block 12A** uses **30% more** than **Block 12B**, mainly because of Main entrance lighting, which Block 12B does not have.");
    expect(review.comparison!.intro).toContain("Like for like, the two are close: Block 12A 13.2 kWh and Block 12B 13.3 kWh a day. Block 12A is higher mainly because of Main entrance lighting (4.1 kWh a day), which Block 12B does not have.");
    expect(review.comparison!.intro).toContain("Part for part, they are within 5% of each other.");
  });

  it("leaves out group against group when no two groups are alike, and when there are no groups", () => {
    const unlike = buildManagementReview(site(LIGHTING, { meaning: "lights_on", groups: [{ id: "block-a", name: "Office tower", parentId: null }, { id: "block-b", name: "Warehouse", parentId: null }, { id: "common", name: "Common area", parentId: null }] }), null, GENERATED);
    expect(unlike.comparison).toBeNull();
    expect(unlike.sections).not.toContain("comparison");
    expect(unlike.sections).toContain("groups");
    const none = buildManagementReview(site(LIGHTING, { meaning: "lights_on", groups: null }), null, GENERATED);
    expect(none.comparison).toBeNull();
    expect(none.groups?.byCircuit).toBe(true);
    expect(none.groups?.heading).toBe("Where the energy goes");
    expect(none.lede).toBe("This review covers the site's 8 meters over 7 days.");
  });

  it("tells groups of the same kind apart from groups of different kinds", () => {
    expect(groupKind("Block 264F")).toBe("block");
    expect(groupKind("Block A")).toBe("block");
    expect(groupKind("Common area")).toBe("common area");
    const tree = buildMeterGroupTree({ name: "Site", groups: [{ id: "t1", name: "Tower 1", parentId: null }, { id: "t2", name: "Tower 2", parentId: null }, { id: "t3", name: "Tower 3", parentId: null }, { id: "c", name: "Car park", parentId: null }],
      meters: [{ id: "m1", name: "a", groupId: "t1", kwh: 3 }, { id: "m2", name: "b", groupId: "t2", kwh: 2 }, { id: "m3", name: "c", groupId: "t3", kwh: 1 }, { id: "m4", name: "d", groupId: "c", kwh: 9 }] });
    expect(comparableGroups(tree)?.map(group => group.name)).toEqual(["Tower 1", "Tower 2", "Tower 3"]);
  });
});

describe("management review: what the hours mean", () => {
  it("speaks of lights-on hours and daytime use for night lighting", () => {
    const review = buildManagementReview(site(LIGHTING, { meaning: "lights_on" }), null, GENERATED);
    expect(review.summary.findings).toContain("The lights ran at night as planned: only **7%** of the energy was used in the daytime.");
    expect(review.profile!.intro).toContain("Lights come on at about **7 pm** and go off at about **7 am**.");
    expect(review.profile!.intro).toContain("of an average day's use is inside the lights-on hours (7 pm – 7 am).");
    expect(review.profile!.caption).toBe("Average of 7 days with complete readings.");
    expect(review.method.rows.find(row => row.label === "Lights-on hours")?.value).toBe("19:00 → 07:00 next day");
    // The lights' own measure: half an hour less each night for the part that switches with the lights.
    const trim = review.savings.rows.find(row => row.title === "Fine-tune the light timers and photocells")!;
    expect(trim.kwhYear).toBeCloseTo((0.6 + 0.3 + 0.6 + 0.36 + 0.4 + 0.2) * 0.5 * 365, 6);
    expect(review.savings.checks.some(check => /emergency lights/.test(check) && /daytime/.test(check))).toBe(true);
  });

  it("speaks of opening hours for a building that is in use by day", () => {
    const officeHours = Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday"].map(day => [day, [{ from: "08:00", to: "18:00" }]]));
    const open = (date: string, hour: number) => ![0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay()) && hour >= 8 && hour < 18;
    const office: Record<string, Def> = {
      lights: { name: "Office lights", group: "office", category: "light", kwh: (d, h) => open(d, h) ? 2 : 0.1 },
      sockets: { name: "Office sockets", group: "office", category: "load", kwh: (d, h) => open(d, h) ? 1 : 0.4 },
      store: { name: "Store lights", group: "store", category: "light", kwh: (d, h) => open(d, h) ? 0.5 : 0.05 },
    };
    const review = buildManagementReview(site(office, { hours: officeHours, groups: [{ id: "office", name: "Office", parentId: null }, { id: "store", name: "Store room", parentId: null }] }), null, GENERATED);
    expect(review.hoursMeaning).toBe("opening");
    expect(review.summary.findings.some(finding => /opening hours/.test(finding))).toBe(true);
    expect(review.method.rows.find(row => row.label === "Opening hours")?.value).toBe("08:00–18:00");
    expect(review.profile!.intro).toContain("inside the opening hours (8 am – 6 pm)");
    expect(review.profile!.caption).toBe("Average of 5 weekdays with complete readings.");
    expect(JSON.stringify(review)).not.toMatch(/lights-on|daytime|light timers/);
    expect(review.comparison).toBeNull();
  });
});

describe("meters marked not in use", () => {
  // A spare circuit that has sent nothing all week: with it counted, no day is complete.
  const dead: Record<string, Def> = { ...LIGHTING, spare: { name: "Spare circuit", group: "common", category: "light", kwh: () => null } };

  it("stop blanking complete days in the full report once marked not in use", () => {
    const before = buildSiteReport(site(dead, { meaning: "lights_on" }), null, GENERATED);
    expect(before.benchmark.days.some(day => day.complete)).toBe(false);
    expect(before.benchmark.weekdayAvg).toBeNull();
    expect(before.benchmark.baseKw).toBeNull();
    const after = buildSiteReport(site(dead, { meaning: "lights_on", notInUse: ["spare"] }), null, GENERATED);
    expect(after.benchmark.days.every(day => day.complete)).toBe(true);
    expect(after.benchmark.weekdayAvg).not.toBeNull();
    expect(after.benchmark.baseKw).toBeCloseTo(0.2, 6);
    // The energy is the same either way: only the complete-day check changes.
    expect(after.benchmark.days.map(day => day.kwh)).toEqual(before.benchmark.days.map(day => day.kwh));
  });

  it("are listed in Method and data, and never reported as stopped", () => {
    const review = buildManagementReview(site(dead, { meaning: "lights_on", notInUse: ["spare"] }), null, GENERATED);
    expect(review.total.days.every(day => day.complete)).toBe(true);
    expect(review.method.rows.find(row => row.label === "Meters")?.value).toBe("9 (1 marked not in use)");
    expect(review.method.meters.find(meter => meter.name === "Spare circuit")?.note).toBe("Marked not in use (spare circuit)");
    expect(review.method.notInUseNote).toMatch(/left out of the complete-day checks/);
    expect(review.summary.findings).toContain("Spare circuit is marked not in use, so it is left out of the daily checks.");
    expect(review.summary.decisions.some(decision => /reporting again/.test(decision.title))).toBe(false);
  });

  it("a meter that stopped without being marked is named, with a decision to fix it", () => {
    const stopped: Record<string, Def> = { ...LIGHTING, pavilion: { ...LIGHTING.pavilion!, kwh: (date, hour) => date < "2026-08-05" || (date === "2026-08-05" && hour < 19) ? (night(hour) ? 0.2 : 0) : null } };
    const review = buildManagementReview(site(stopped, { meaning: "lights_on" }), null, GENERATED);
    expect(review.summary.findings).toContain("**Pavilion lights** has sent no readings since 5 Aug, 6 pm.");
    expect(review.summary.decisions.map(decision => decision.title)).toContain("Get Pavilion lights reporting again");
    expect(review.method.meters.find(meter => meter.name === "Pavilion lights")?.note).toBe("Last reading 5 Aug, 6 pm");
  });
});

describe("management review in other languages and as a document", () => {
  it("writes every sentence in Chinese or Malay", () => {
    const zh = buildManagementReview(site(LIGHTING, { meaning: "lights_on" }), null, GENERATED, "zh-Hans");
    expect(zh.title).toBe("这 7 天说明了什么");
    expect(zh.comparison!.heading).toBe("Block 12B 与 Block 12A 对比");
    expect(zh.summary.findings.join("")).not.toMatch(/ the | used | a day/);
    const ms = buildManagementReview(site(LIGHTING, { meaning: "lights_on" }), null, GENERATED, "ms");
    expect(ms.title).toBe("Apa yang ditunjukkan oleh 7 hari ini");
    expect(ms.method.rows.map(row => row.label)).toContain("Waktu lampu menyala");
  });

  it("renders a standalone page with every section and no missing values", () => {
    const html = renderManagementReviewHtml(buildManagementReview(site(LIGHTING, { meaning: "lights_on", notInUse: [] }), null, GENERATED));
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain("<title>Harbour Estate Energy Review · 3–9 Aug 2026</title>");
    for (const heading of ["Summary", "The things worth deciding", "Total energy, by day, and the cost", "Block 12B against Block 12A", "The average 24 hours", "Saving energy: what it could be worth", "Method and data"]) expect(html).toContain(heading);
    expect(html).not.toMatch(/undefined|NaN|Infinity|\{\w+\}/);
  });

  it("renders whichever style is chosen from the same readings", () => {
    const data = site(LIGHTING, { meaning: "lights_on" });
    expect(renderStyledSiteReportHtml("management", data, null, GENERATED)).toContain("Energy Review");
    expect(renderStyledSiteReportHtml("full", data, null, GENERATED)).toContain("Energy Report");
  });

  it("still writes a short review without a tariff, asking for one", () => {
    const review = buildManagementReview(site(LIGHTING, { meaning: "lights_on", rate: null }), null, GENERATED);
    expect(review.summary.decisions.map(decision => decision.title)).toContain("Add the electricity rate");
    expect(review.method.rows.find(row => row.label === "Electricity rate")?.value).toBe("Not set, so costs are not shown");
    expect(renderManagementReviewHtml(review)).not.toMatch(/undefined|NaN/);
  });
});
