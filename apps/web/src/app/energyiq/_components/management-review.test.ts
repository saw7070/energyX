import { describe, expect, it } from "vitest";
import { buildManagementReview, buildSiteReport, comparableGroups, groupKind, buildMeterGroupTree, type AnalysisData, type ScopeData, type ScopeMeter, type TrendSeries } from "@datafoundry/site-report";
import { renderManagementReviewHtml, renderStyledSiteReportHtml } from "@datafoundry/site-report/management-review-document";
import { translatorFor } from "./energyiq-messages";
import { dataAvailabilityMessages } from "./data-availability-messages";

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
function site(defs: Record<string, Def>, options: { groups?: typeof GROUPS | null; hours?: AnalysisData["openingHours"]; meaning?: "lights_on"; rate?: number | null; notInUse?: string[]; idle?: string[] } = {}): AnalysisData {
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
    ...(options.idle ? { idleWhenQuiet: options.idle } : {}),
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
    // In the order the groups were saved, as on the Overview, wherever their size puts them.
    expect(groups.heading).toBe("Block 12A, Block 12B and Common area");
    expect(groups.rows.map(row => row.name)).toEqual(["Block 12A", "Block 12B", "Common area"]);
    expect(groups.rows.reduce((sum, row) => sum + row.share, 0)).toBeCloseTo(1, 6);
    expect(groups.rows[1]!.parts[0]).toMatchObject({ name: "12B corridor lights" });
    expect(groups.rows[1]!.biggest).toBe("Biggest in Block 12B: **12B corridor lights**, 52% of it.");
  });

  it("compares the two blocks side by side, part for part", () => {
    const comparison = review.comparison!;
    // The blocks in their saved order; the finding still says which uses more.
    expect(comparison.heading).toBe("Block 12A against Block 12B");
    expect(comparison.groups.map(group => group.name)).toEqual(["Block 12A", "Block 12B"]);
    expect(comparison.parts.map(part => part.name)).toEqual(["Corridor lights", "Lift lobby lights", "Emergency lights"]);
    expect(comparison.parts[1]!.perDay[0]).toBeCloseTo(3.6, 6);
    expect(comparison.parts[1]!.perDay[1]).toBeCloseTo(4.32, 6);
    expect(comparison.intro).toContain("**Block 12B** uses **");
    expect(comparison.intro).toContain("Part for part, the biggest difference is Lift lobby lights: Block 12B uses 20% more than Block 12A.");
  });

  it("shows the days that stood out under the daily totals, with the meters behind them", () => {
    const lateMorning: Record<string, Def> = { ...LIGHTING, "a-corridor": { ...LIGHTING["a-corridor"]!, kwh: (d, h) => night(h) || (d === "2026-08-06" && h >= 7 && h < 9) ? 0.6 : 0 } };
    const review = buildManagementReview(site(lateMorning, { meaning: "lights_on" }), null, GENERATED);
    expect(review.total.standout?.title).toBe("Days that stood out");
    expect(review.total.standout?.items.map(item => item.date)).toEqual(["2026-08-06"]);
    expect(review.total.standout?.items[0]!.text).toContain("12A corridor lights");
    expect(review.summary.findings).toContain("One day stood out from a usual day: 6 Aug (see Days that stood out).");
    expect(renderManagementReviewHtml(review)).toContain("Days that stood out");
    // With nothing unusual, the block says so in one line.
    expect(buildManagementReview(site(LIGHTING, { meaning: "lights_on" }), null, GENERATED).total.standout?.note).toBe("No day stood out from a usual day.");
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
    expect(groupKind("Block 12A")).toBe("block");
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
    // One line per group: the blocks' like parts added together, and the common area on its own.
    expect(review.profile!.caption).toBe("Average of 7 days with complete readings. Each line is one group; the same group in Block 12A and Block 12B is added into one line.");
    expect(review.profile!.lines?.map(line => line.name)).toEqual(["Corridor lights", "Lift lobby lights", "Emergency lights", "Common area"]);
    expect(review.profile!.lines![0]!.dayKwh).toBeCloseTo(2 * 0.6 * 12, 6);
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
    // Days that stood out use the same rule, so the week is compared instead of skipped as missing.
    expect(before.standout.note).toMatch(/Readings were missing/);
    expect(after.standout.note).not.toMatch(/Readings were missing/);
    // The energy is the same either way: only the complete-day check changes.
    expect(after.benchmark.days.map(day => day.kwh)).toEqual(before.benchmark.days.map(day => day.kwh));
  });

  it("a meter idle when the readings were loaded (a rarely used fan) never blanks complete days either", () => {
    // Nobody switched the fan on all week, so its total never moved and it sent nothing.
    const quietFan: Record<string, Def> = { ...LIGHTING, fan: { name: "Pavilion fan", group: "common", category: "other", kwh: () => null } };
    const before = buildSiteReport(site(quietFan, { meaning: "lights_on" }), null, GENERATED);
    expect(before.benchmark.days.some(day => day.complete)).toBe(false);
    const after = buildSiteReport(site(quietFan, { meaning: "lights_on", idle: ["fan"] }), null, GENERATED);
    expect(after.benchmark.days.every(day => day.complete)).toBe(true);
    expect(after.benchmark.weekdayAvg).not.toBeNull();
    expect(after.benchmark.days.map(day => day.kwh)).toEqual(before.benchmark.days.map(day => day.kwh));
    expect(buildManagementReview(site(quietFan, { meaning: "lights_on", idle: ["fan"] }), null, GENERATED).total.days.every(day => day.complete)).toBe(true);
    // Also when the readings carry no hours at all for it: it sent nothing, and was expected for one meter's worth.
    const withoutSeries = site(quietFan, { meaning: "lights_on", idle: ["fan"] });
    const strip = (scopeData: ScopeData): ScopeData => ({ ...scopeData, meters: scopeData.meters.map(meter => meter.id === "fan" ? { ...meter, series: null } : meter) });
    const stripped: AnalysisData = { ...withoutSeries, current: { project: strip(withoutSeries.current.project), spaces: withoutSeries.current.spaces.map(strip) } };
    expect(buildSiteReport(stripped, null, GENERATED).benchmark.days.every(day => day.complete)).toBe(true);
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

  it("a meter that was only using nothing when the readings were loaded is not called stopped, nor given a fix", () => {
    // A made-up pavilion fan: used until 5 Aug, then nothing; the live check found it online and able to use nothing.
    const fan: Record<string, Def> = { ...LIGHTING, fan: { name: "Pavilion fan", group: "common", category: "load", kwh: (date, hour) => date < "2026-08-05" || (date === "2026-08-05" && hour < 19) ? (hour >= 9 && hour < 12 ? 0.3 : 0) : null } };
    const review = buildManagementReview({ ...site(fan, { meaning: "lights_on" }), idleWhenQuiet: ["fan"] }, null, GENERATED);
    expect(review.summary.findings.join(" ")).not.toContain("Pavilion fan");
    expect(review.summary.decisions.some(decision => /reporting again/.test(decision.title))).toBe(false);
    expect(review.method.meters.find(meter => meter.name === "Pavilion fan")?.note).toBe("No use since 5 Aug, 6 pm");
    // Without that answer the same silence is still a meter that stopped.
    expect(buildManagementReview(site(fan, { meaning: "lights_on" }), null, GENERATED).summary.decisions.map(decision => decision.title)).toContain("Get Pavilion fan reporting again");
    expect(buildManagementReview({ ...site(fan, { meaning: "lights_on" }), idleWhenQuiet: ["fan"] }, null, GENERATED, "ms").method.meters.find(meter => meter.name === "Pavilion fan")?.note).toMatch(/^Tiada penggunaan sejak /);
  });

  it("words a meter that used nothing as Data availability does, whether it went quiet or sent readings of nothing", () => {
    // The made-up pavilion fan went quiet, online and idle; the store-room fan sent readings, all of them zero.
    const meters: Record<string, Def> = { ...LIGHTING,
      fan: { name: "Pavilion fan", group: "common", category: "load", kwh: (date, hour) => date < "2026-08-05" || (date === "2026-08-05" && hour < 19) ? (hour >= 9 && hour < 12 ? 0.3 : 0) : null },
      store: { name: "Store room fan", group: "common", category: "load", kwh: () => 0 } };
    for (const locale of ["en", "zh-Hans", "ms"] as const) {
      const review = buildManagementReview({ ...site(meters, { meaning: "lights_on" }), idleWhenQuiet: ["fan"] }, null, GENERATED, locale);
      const note = (name: string) => review.method.meters.find(meter => meter.name === name)?.note;
      const page = translatorFor(dataAvailabilityMessages, locale);
      expect(note("Store room fan")).toBe(page("status.idle"));
      const since = page("status.idleSince", { when: "\u0000" }).split("\u0000").map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      expect(note("Pavilion fan")).toMatch(new RegExp(`^${since[0]}.+${since[1]}$`));
    }
  });
});

describe("management review in other languages and as a document", () => {
  it("writes every sentence in Chinese or Malay", () => {
    const zh = buildManagementReview(site(LIGHTING, { meaning: "lights_on" }), null, GENERATED, "zh-Hans");
    expect(zh.title).toBe("这 7 天说明了什么");
    expect(zh.comparison!.heading).toBe("Block 12A 与 Block 12B 对比");
    expect(zh.summary.findings.join("")).not.toMatch(/ the | used | a day/);
    const ms = buildManagementReview(site(LIGHTING, { meaning: "lights_on" }), null, GENERATED, "ms");
    expect(ms.title).toBe("Apa yang ditunjukkan oleh 7 hari ini");
    expect(ms.method.rows.map(row => row.label)).toContain("Waktu lampu menyala");
  });

  it("renders a standalone page with every section and no missing values", () => {
    const html = renderManagementReviewHtml(buildManagementReview(site(LIGHTING, { meaning: "lights_on", notInUse: [] }), null, GENERATED));
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain("<title>Harbour Estate Energy Review · 3–9 Aug 2026</title>");
    for (const heading of ["Summary", "The things worth deciding", "Total energy, by day, and the cost", "Block 12A against Block 12B", "The average 24 hours", "Saving energy: what it could be worth", "Method and data"]) expect(html).toContain(heading);
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

/**
 * A daily report: the same estate on one day only, as the schedule reads it each morning. Readings stop at `until`
 * o'clock when given, as when the gateway goes quiet part-way through the day; `silent` meters send nothing at all.
 */
function oneDay(data: AnalysisData, date: string, options: { until?: number; silent?: string[] } = {}): AnalysisData {
  const until = options.until ?? 24;
  const keep = (series: TrendSeries | null): TrendSeries | null => series && { ...series, cells: series.cells.filter(cell => cell[0] === date && cell[1] < until && !options.silent?.includes(series.id)) };
  const kwh = (series: TrendSeries | null) => series?.cells.reduce((sum, cell) => sum + (cell[2] ?? 0), 0) ?? 0;
  const cut = (scope: ScopeData): ScopeData => {
    const meters = scope.meters.map(meter => ({ ...meter, series: keep(meter.series) }));
    const live = meters.filter(meter => !options.silent?.includes(meter.id));
    // The engine's total for the hours left: the meters still reporting, against every meter it expects.
    const cells: TrendSeries["cells"] = (scope.total?.cells ?? []).filter(cell => cell[0] === date && cell[1] < until).map(([day, hour]) => {
      const values = live.map(meter => meter.series?.cells.find(cell => cell[1] === hour)?.[2] ?? null).filter((value): value is number => value != null);
      return [day, hour, values.reduce((sum, value) => sum + value, 0), values.length * 60, 0];
    });
    const total = scope.total && { ...scope.total, cells };
    const usage = kwh(total);
    return { ...scope, dates: [date], total, meters, usageKwh: usage, cost: scope.cost && { ...scope.cost, amount: usage * 0.3 },
      coverage: total ? cells.reduce((sum, cell) => sum + cell[3], 0) / (total.expectedMinutesPerHour * 24) * 100 : null };
  };
  const project = cut(data.current.project);
  return { ...data, current: { project, spaces: data.current.spaces.map(cut) },
    ...(data.groups ? { groups: { ...data.groups, meters: data.groups.meters.map(meter => ({ ...meter, kwh: kwh(project.meters.find(item => item.id === meter.id)?.series ?? null) })) } } : {}) };
}
const DAY = "2026-08-05";
const LIT = site(LIGHTING, { meaning: "lights_on" });
const plain = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("a daily report", () => {
  it("reads as one day in both styles: no averages of one, and no day standing out against itself", () => {
    const review = buildManagementReview(oneDay(LIT, DAY), null, GENERATED);
    expect(review.masthead.periodNote).toBe("1 day, SGT");
    expect(review.title).toBe("What this day shows");
    expect(review.lede).toBe("This review covers the site's 8 meters on this day, organised by what the meters serve.");
    expect(review.summary.findings[0]).toMatch(/^The site used \*\*[\d,.]+ kWh\*\* on this day \(about \*\*S\$[\d.]+\*\*\)\.$/);
    expect(review.keyFigures.map(figure => figure.label).slice(0, 3)).toEqual(["used on the day", "30 days like this one", "bill for 30 days like this one"]);
    expect(review.total.rows.map(row => row.label)).toEqual(["This day", "30 days like this one", "A year of days like this one"]);
    expect(review.total.standout).toBeNull();
    // The complete day is drawn one line per group, as the full report draws it.
    expect(review.profile!.caption).toBe("Use by hour on this day. Each line is one group; the same group in Block 12A and Block 12B is added into one line.");
    expect(review.savings.note).toMatch(/^Estimates from one day of readings/);

    const report = buildSiteReport(oneDay(LIT, DAY), null, GENERATED);
    expect(report.masthead.periodNote).toBe("1 day, SGT");
    expect(report.lede).toMatch(/^On this day the site used \*\*[\d,.]+ kWh\*\*, measured by 8 meters\./);
    expect(report.keyFigures[0]!.label).toBe("total use for the day");
    // The one complete day is drawn hour by hour, which is what a daily reader wants to see.
    expect(report.pattern!.caption).toMatch(/^Use by hour on this day \(kW\)\./);
    for (const style of ["full", "management"] as const) {
      const html = plain(renderStyledSiteReportHtml(style, oneDay(LIT, DAY), null, GENERATED));
      expect(html).not.toMatch(/\b1 days\b|Days that stood out|undefined|NaN/);
    }
  });

  it("says first when some readings for the day are missing, and projects nothing from part of a day", () => {
    const data = oneDay(LIT, DAY, { until: 18 });
    const report = buildSiteReport(data, null, GENERATED);
    expect(`${report.title.before}${report.title.emphasis}`).toBe("Some readings for this day are missing");
    expect(report.lede).toContain("Only **75%** of the expected readings arrived, so the figures below count only the readings received and may be lower than the real use.");
    expect(report.estimate.intro).toBe("No meter has a full day of readings on this day, so a 30-day month is not estimated.");
    expect(report.circuits.every(circuit => circuit.monthCost == null)).toBe(true);
    expect(report.pattern).toBeNull();
    const full = plain(renderStyledSiteReportHtml("full", data, null, GENERATED));
    expect(full).toContain("Some readings for this day are missing, so the hour-by-hour pattern is not drawn.");
    expect(full).not.toMatch(/S\$0 a month|S\$0\/month|at 0%/);

    const review = buildManagementReview(data, null, GENERATED);
    expect(review.summary.findings[0]).toBe("Only **75%** of the expected readings for this day arrived, so these figures count only the readings received and may be lower than the real use.");
    expect(review.keyFigures[0]!.label).toBe("measured on the day; some readings missing");
    expect(review.keyFigures.map(figure => figure.label)).not.toContain("30 days like this one");
    expect(review.total.rows).toEqual([]);
  });

  it("names a meter that sent nothing all day, rather than calling it steady", () => {
    const report = buildSiteReport(oneDay(LIT, DAY, { silent: ["a-lobby"] }), null, GENERATED);
    expect(`${report.title.before}${report.title.emphasis}`).toBe("Some readings for this day are missing");
    expect(report.lede).toContain("12A lift lobby lights sent no readings at all.");
    expect(report.circuits.find(circuit => circuit.meterIds.includes("a-lobby"))!.finding).toBe("No complete readings on this day, so it could not be checked.");
  });

  it("says so plainly when no readings arrived for the day, and shows nothing else", () => {
    const data = oneDay(LIT, DAY, { until: 0 });
    const report = buildSiteReport(data, null, GENERATED);
    expect(`${report.title.before}${report.title.emphasis}`).toBe("No readings arrived for this day");
    expect(report.lede).toBe("No readings arrived for this day, so there is nothing to report yet. Check that the meters and their gateway are online.");
    const full = plain(renderStyledSiteReportHtml("full", data, null, GENERATED));
    expect(full).not.toContain("A 30-day month");
    expect(full).not.toContain("total use for the day");
    const review = buildManagementReview(data, null, GENERATED);
    expect(review.sections).toEqual(["summary", "method"]);
    expect(review.summary.findings).toEqual(["No readings arrived for this day. Check that the meters and their gateway are online."]);
    expect(review.summary.decisions.map(decision => decision.title)).toEqual(["Get 8 meters reporting again"]);
    expect(plain(renderStyledSiteReportHtml("management", data, null, GENERATED))).not.toMatch(/Total energy, by day|undefined|NaN/);
  });

  it("on a day with no readings, says meters the live check found online used nothing, and gives no fix for them", () => {
    // A made-up office on a public holiday: both meters online all day and using nothing, so nothing new was sent.
    const office: Record<string, Def> = {
      lights: { name: "Office lights", group: "office", category: "light", kwh: (_d, h) => h >= 9 && h < 18 ? 0.5 : 0 },
      fan: { name: "Pantry fan", group: "office", category: "load", kwh: (_d, h) => h >= 9 && h < 18 ? 0.1 : 0 },
    };
    const hours = Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday"].map(day => [day, [{ from: "09:00", to: "18:00" }]]));
    const holiday = oneDay(site(office, { groups: null, hours }), DAY, { until: 0 });
    const idle = { ...holiday, idleWhenQuiet: ["fan", "lights"] };
    const review = buildManagementReview(idle, null, GENERATED);
    expect(review.summary.findings).toEqual(["No readings arrived for this day: all **2 meters** were online but used nothing, so they sent no new readings."]);
    expect(review.summary.decisions).toEqual([]);
    expect(buildSiteReport(idle, null, GENERATED).lede).toBe("No readings arrived for this day: all 2 meters were online but used nothing, so they sent no new readings.");
    // Each meter in Data availability's words, in every language.
    for (const locale of ["en", "zh-Hans", "ms"] as const) {
      const notes = buildManagementReview(idle, null, GENERATED, locale).method.meters.map(meter => meter.note);
      expect(notes).toEqual([translatorFor(dataAvailabilityMessages, locale)("status.idle"), translatorFor(dataAvailabilityMessages, locale)("status.idle")]);
      for (const page of [renderStyledSiteReportHtml("full", idle, null, GENERATED, locale), renderStyledSiteReportHtml("management", idle, null, GENERATED, locale)]) expect(plain(page)).not.toMatch(/undefined|NaN|\{\w+\}/);
    }
    // One idle, one silent: only the silent one is to get reporting again.
    const mixed = { ...holiday, idleWhenQuiet: ["fan"] };
    const mixedReview = buildManagementReview(mixed, null, GENERATED);
    expect(mixedReview.summary.findings).toEqual(["No readings arrived for this day. Check that the meters and their gateway are online.", "**Pantry fan** was online but used nothing, so it sent no new readings."]);
    expect(mixedReview.summary.decisions.map(decision => decision.title)).toEqual(["Get Office lights reporting again"]);
    expect(mixedReview.method.meters.map(meter => meter.note)).toEqual(["No readings in this period", "No use in this period"]);
    expect(buildSiteReport(mixed, null, GENERATED).lede).toBe("No readings arrived for this day, so there is nothing to report yet. Check that the meters and their gateway are online. Office lights sent no readings at all. Pantry fan used nothing, so it sent no new readings.");
    for (const locale of ["zh-Hans", "ms"] as const) for (const page of [renderStyledSiteReportHtml("full", mixed, null, GENERATED, locale), renderStyledSiteReportHtml("management", mixed, null, GENERATED, locale)]) expect(plain(page)).not.toMatch(/undefined|NaN|\{\w+\}/);
  });

  it("works out no daytime share from part of a day, where the missing evening would make night use look like daytime use", () => {
    // The whole day: the lights ran at night as planned.
    expect(buildManagementReview(oneDay(LIT, DAY), null, GENERATED).summary.findings).toContain("The lights ran at night as planned: only **7%** of the energy was used in the daytime.");
    expect(buildSiteReport(oneDay(LIT, DAY), null, GENERATED).keyFigures[3]!.value).toBe("7.0%");
    // Readings stop at 18:00. By the hours that arrived, 11% would look like daytime use: over the warning line.
    const data = oneDay(LIT, DAY, { until: 18 });
    const review = buildManagementReview(data, null, GENERATED);
    expect(review.summary.findings.join(" ")).not.toMatch(/daytime|at night/);
    expect(review.keyFigures.some(figure => figure.value.endsWith("%"))).toBe(false);
    const report = buildSiteReport(data, null, GENERATED);
    expect(report.lede).not.toMatch(/daytime|lights-on hours/);
    expect(report.keyFigures[3]!.value).toBe("—");
    expect(report.headline).toBe("Some readings for this day are missing");
    // No share of the day said to be daytime use (the breakdown by group still gives each group's share of the day).
    expect(plain(renderStyledSiteReportHtml("full", data, null, GENERATED))).not.toMatch(/when the lights should be off|\b1[01](\.\d)?% of (it|the)\b/);
    expect(plain(renderStyledSiteReportHtml("management", data, null, GENERATED))).not.toContain("when the lights should be off");
  });

  it("on a day with no readings, says why there is no cost and shows no use a day for any meter", () => {
    // The method table's fifth row is the electricity rate, in every language.
    const rate = (review: ReturnType<typeof buildManagementReview>) => review.method.rows[4]!.value;
    const empty = buildManagementReview(oneDay(LIT, DAY, { until: 0 }), null, GENERATED);
    expect(empty.method.rows[4]!.label).toBe("Electricity rate");
    expect(rate(empty)).toBe("No readings, so no cost is worked out");
    expect(empty.method.meters.map(meter => meter.perDay)).toEqual(empty.method.meters.map(() => null));
    expect(plain(renderStyledSiteReportHtml("management", oneDay(LIT, DAY, { until: 0 }), null, GENERATED))).not.toMatch(/Not set|0\.00/);
    expect(rate(buildManagementReview(oneDay(LIT, DAY, { until: 0 }), null, GENERATED, "zh-Hans"))).toBe("没有读数，所以不计算电费");
    expect(rate(buildManagementReview(oneDay(LIT, DAY, { until: 0 }), null, GENERATED, "ms"))).toBe("Tiada bacaan, jadi kos tidak dikira");
    // A day with readings keeps its rate, and a rate that is really missing still says so.
    expect(rate(buildManagementReview(oneDay(LIT, DAY), null, GENERATED))).toMatch(/^S\$0\.3000/);
    expect(rate(buildManagementReview(oneDay(site(LIGHTING, { meaning: "lights_on", rate: null }), DAY), null, GENERATED))).toBe("Not set, so costs are not shown");
  });

  it("words the full report's 30 days as days like this one, with no average of one day to compare with", () => {
    const report = buildSiteReport(oneDay(LIT, DAY), null, GENERATED);
    expect(report.estimate.intro).toMatch(/^If every day were like this one, 30 days would use about \*\*[\d,]+ kWh\*\*\. At \*\*S\$0\.3000\/kWh before GST\*\*, that is about \*\*S\$[\d,]+\*\* for 30 days like this one\.$/);
    expect(report.estimate.note).toMatch(/^How we estimate: we count 30 days as if every one were like this day\./);
    expect(report.benchmark.weekdayAvg).toBeNull();
    expect(report.benchmark.weekendAvg).toBeNull();
    expect(report.benchmark.rows.map(row => row.label)).not.toEqual(expect.arrayContaining(["Average weekday"]));
    expect(report.benchmark.intro).toBe("A single day has no weekday or weekend average to compare with. The chart shows this day's total.");
    const html = plain(renderStyledSiteReportHtml("full", oneDay(LIT, DAY), null, GENERATED));
    expect(html).toContain("30 days like this one: use and bill");
    expect(html).toContain("This day, and what never switches off");
    expect(html).not.toMatch(/Based on a normal weekday|Average weekday|Average weekend day|weekday avg|weekend avg|Weekday average|21\.4 weekdays/);
    for (const [locale, intro] of [["zh-Hans", /^如果每天都和这一天一样，30 天约用电/], ["ms", /^Jika setiap hari sama seperti hari itu, 30 hari akan menggunakan kira-kira/]] as const) {
      expect(buildSiteReport(oneDay(LIT, DAY), null, GENERATED, locale).estimate.intro).toMatch(intro);
    }
    // A longer report keeps its averages.
    expect(buildSiteReport(LIT, null, GENERATED).estimate.intro).toMatch(/^Based on a normal weekday and weekend day/);
    // The review's hour-by-hour section is about this day, not an average one.
    expect(plain(renderStyledSiteReportHtml("management", oneDay(LIT, DAY), null, GENERATED))).toContain("This day, hour by hour");
    expect(plain(renderStyledSiteReportHtml("management", LIT, null, GENERATED))).toContain("The average 24 hours");
    expect(plain(renderStyledSiteReportHtml("management", oneDay(LIT, DAY), null, GENERATED, "zh-Hans"))).toContain("当天的逐小时用电");
    expect(plain(renderStyledSiteReportHtml("management", oneDay(LIT, DAY), null, GENERATED, "ms"))).toContain("Hari itu, jam demi jam");
  });

  it("still lists every location on part of a day at a site with no groups, by what each measured", () => {
    const data = oneDay(site(LIGHTING, { meaning: "lights_on", groups: null }), DAY, { until: 18 });
    const report = buildSiteReport(data, null, GENERATED);
    expect(report.groups).toBeNull();
    expect(report.zones.map(zone => zone.label).sort()).toEqual(["block-a", "block-b", "common"]);
    expect(report.zones.reduce((sum, zone) => sum + zone.share, 0)).toBeCloseTo(1, 6);
    expect(report.profile.intro).toContain("grouped into three locations:");
    expect(report.estimate.comparison).toMatch(/uses the most, at \*\*\d+%\*\* of the energy, compared with/);
    const html = plain(renderStyledSiteReportHtml("full", data, null, GENERATED));
    expect(html).toContain("Measured on the day (kWh)");
    expect(html).not.toMatch(/no locations|Est\. kWh per 30 days|of the month's energy/);
    expect(plain(renderStyledSiteReportHtml("full", data, null, GENERATED, "zh-Hans"))).toContain("分为 3 个位置：");
    expect(plain(renderStyledSiteReportHtml("full", data, null, GENERATED, "ms"))).toContain("dikumpulkan kepada 3 lokasi:");
  });

  it("speaks Chinese and Malay for one day, and for a day with readings missing", () => {
    const zh = buildSiteReport(oneDay(LIT, DAY, { until: 18 }), null, GENERATED, "zh-Hans");
    expect(zh.masthead.periodNote).toBe("1 天，SGT");
    expect(`${zh.title.before}${zh.title.emphasis}`).toBe("当天有部分读数缺失");
    expect(zh.keyFigures[0]!.label).toBe("当天总用电量");
    expect(zh.lede).toContain("只收到预期读数的 **75%**");
    expect(buildManagementReview(oneDay(LIT, DAY), null, GENERATED, "zh-Hans").summary.findings[0]).toMatch(/^本场地当天共用电/);
    const ms = buildSiteReport(oneDay(LIT, DAY, { until: 18 }), null, GENERATED, "ms");
    expect(ms.masthead.periodNote).toBe("1 hari, SGT");
    expect(`${ms.title.before}${ms.title.emphasis}`).toBe("Sebahagian bacaan hari itu tidak diterima");
    expect(ms.keyFigures[0]!.label).toBe("jumlah penggunaan pada hari itu");
    expect(buildManagementReview(oneDay(LIT, DAY), null, GENERATED, "ms").masthead.periodNote).toBe("1 hari, SGT");
    for (const locale of ["zh-Hans", "ms"] as const) {
      expect(plain(renderStyledSiteReportHtml("full", oneDay(LIT, DAY, { until: 18 }), null, GENERATED, locale))).not.toMatch(/\{\w+\}|undefined|NaN|Some readings|No meter has/);
    }
  });
});
