/** @vitest-environment happy-dom */
/**
 * The energy review: the site report written around the questions the site asked at installation, each section named
 * by its topic and never by a number. An estate
 * with two alike blocks and a common area, lights on 19:00–07:00, two weeks of readings. One common-area meter stops
 * reporting, one is powered with its lights, and the pavilion fan is used on a single evening. All names are made up.
 */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { assembleAnalysisData, buildEnergyReview, sampleSiteAnalysisData, type AnalysisData, type AnalysisSource, type ProjectInformationSource, type ScopeMeter, type TrendSeries } from "@datafoundry/site-report";
import { EnergyReviewDocument, renderEnergyReviewHtml, renderEnergyReviewMarkup } from "@datafoundry/site-report/energy-review-document";
import { renderStyledSiteReportHtml } from "@datafoundry/site-report/management-review-document";

const DATES = Array.from({ length: 14 }, (_, index) => new Date(Date.parse("2026-11-02T00:00:00Z") + index * 86_400_000).toISOString().slice(0, 10));
const night = (hour: number) => hour >= 19 || hour < 7;
type Profile = (date: string, hour: number) => number;
const lit = (perDay: number, day = 0): Profile => (_date, hour) => night(hour) ? perDay / 12 : day;
type Meter = { name: string; group: string; kwh: Profile; category?: "light" | "load"; stopAfter?: string; nightOnly?: boolean };
const METERS: Record<string, Meter> = {
  "a-lobby": { name: "Block A lift lobby", group: "a-gf", kwh: lit(3.6) },
  "a-gate": { name: "Riverside gate lighting", group: "a-gf", kwh: lit(4.2) },
  "a-high": { name: "Block A L7-L12 corridors", group: "a-lighting", kwh: lit(8) },
  "a-low": { name: "Block A L1-L6 corridors", group: "a-lighting", kwh: lit(3.4, 0.01) },
  "a-emergency": { name: "Block A emergency lights", group: "a-emergency", kwh: () => 0.1 },
  "b-lobby": { name: "Block B lift lobby", group: "b-gf", kwh: lit(3.2) },
  "b-high": { name: "Block B L7-L12 corridors", group: "b-lighting", kwh: lit(8.2) },
  "b-low": { name: "Block B L1-L6 corridors", group: "b-lighting", kwh: lit(3.3) },
  "b-emergency": { name: "Block B emergency lights", group: "b-emergency", kwh: () => 0.1 },
  driveway: { name: "Driveway lamp", group: "common", kwh: lit(4) },
  linkway: { name: "Linkway lights", group: "common", kwh: lit(1.8), stopAfter: "2026-11-04T18" },
  shelter: { name: "Shelter lights", group: "common", kwh: lit(0.3), nightOnly: true },
  playground: { name: "Playground lights", group: "common", kwh: lit(0.2) },
  fan: { name: "Pavilion fan", group: "common", category: "load", kwh: (date, hour) => date === "2026-11-05" && hour >= 19 && hour < 23 ? 0.2 : 0 },
};
const GROUPS = [
  { id: "a", name: "Block A", parentId: null, order: 10 },
  { id: "a-gf", name: "Ground floor", parentId: "a", order: 10 }, { id: "a-lighting", name: "Block lighting", parentId: "a", order: 20 }, { id: "a-emergency", name: "Emergency lights", parentId: "a", order: 30 },
  { id: "b", name: "Block B", parentId: null, order: 20 },
  { id: "b-gf", name: "Ground floor", parentId: "b", order: 10 }, { id: "b-lighting", name: "Block lighting", parentId: "b", order: 20 }, { id: "b-emergency", name: "Emergency lights", parentId: "b", order: 30 },
  { id: "common", name: "Common area", parentId: null, order: 30 },
];
const NIGHTS = Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map(day => [day, [{ from: "19:00", to: "07:00" }]]));
const ids = Object.keys(METERS);
const cellOf = (id: string, date: string, hour: number, meters: Record<string, Meter> = METERS): TrendSeries["cells"][number] => {
  const meter = meters[id]!;
  if (meter.stopAfter && `${date}T${String(hour).padStart(2, "0")}` > meter.stopAfter) return [date, hour, null, 0, 0];
  if (meter.nightOnly && !night(hour)) return [date, hour, null, 0, 0];
  return [date, hour, meter.kwh(date, hour), 60, 0];
};
const series = (id: string, meters: Record<string, Meter> = METERS): TrendSeries => ({ id, expectedMinutesPerHour: 60, cells: DATES.flatMap(date => Array.from({ length: 24 }, (_, hour) => cellOf(id, date, hour, meters))) });
const periodKwh = (id: string, meters: Record<string, Meter> = METERS) => series(id, meters).cells.reduce((sum, cell) => sum + (cell[2] ?? 0), 0);
const TOTAL = ids.reduce((sum, id) => sum + periodKwh(id), 0);
const TOP_OF: Record<string, string> = { a: "Block A", b: "Block B", common: "Common area" };

/**
 * `byArea`: as on a live site, each meter's hour-by-hour readings come with the area it belongs to (data.current.spaces)
 * and the site's own meter list names the meters without readings. `groups` and `nights`: another estate's groups and
 * lights-on hours.
 */
function estate(extra: Partial<AnalysisData> = {}, options: { meters?: Record<string, Meter>; byArea?: boolean; groups?: typeof GROUPS; nights?: typeof NIGHTS } = {}): AnalysisData {
  const table = options.meters ?? METERS;
  const keys = Object.keys(table);
  const meterOf = (id: string, withSeries: boolean): ScopeMeter => ({ id, name: table[id]!.name, location: table[id]!.group, category: table[id]!.category ?? "light", official: true, series: withSeries ? series(id, table) : null });
  const meters = keys.map(id => meterOf(id, !options.byArea));
  const total: TrendSeries = { id: "__scope__", expectedMinutesPerHour: keys.length * 60, cells: DATES.flatMap(date => Array.from({ length: 24 }, (_, hour) => {
    const cells = keys.map(id => cellOf(id, date, hour, table));
    return [date, hour, cells.reduce((sum, cell) => sum + (cell[2] ?? 0), 0), cells.reduce((sum, cell) => sum + cell[3], 0), 0] as TrendSeries["cells"][number];
  })) };
  const totalKwh = keys.reduce((sum, id) => sum + periodKwh(id, table), 0);
  const spaces = options.byArea ? Object.entries(TOP_OF).map(([prefix, name]) => ({
    id: prefix, name, dates: DATES, timezone: "Asia/Singapore", total: null, types: {}, typeTotals: {}, coverage: null, usageKwh: null, peakKw: null, peakAt: null, cost: null,
    meters: keys.filter(id => (prefix === "common" ? table[id]!.group === "common" : table[id]!.group.startsWith(`${prefix}-`))).map(id => meterOf(id, true)),
  })) : [];
  return {
    projectId: "estate", projectName: "Riverside", timezone: "Asia/Singapore", snapshotId: null,
    current: { project: { id: "estate", name: "Riverside", dates: DATES, timezone: "Asia/Singapore", total, types: {}, meters, usageKwh: totalKwh, peakKw: null, peakAt: null,
      cost: { amount: totalKwh * 0.3, currency: "SGD", note: "0.3 SGD/kWh before tax", rates: [0.3], basis: "tax_exclusive" }, typeTotals: {}, coverage: 95 }, spaces },
    previous: null, history: null, circuits: [], holidays: new Map(), openingHours: options.nights ?? NIGHTS, actions: [], hoursMeaning: "lights_on",
    groups: { list: options.groups ?? GROUPS, meters: keys.map(id => ({ id, name: table[id]!.name, groupId: table[id]!.group, kwh: periodKwh(id, table) })) },
    alwaysOnByDesign: [{ id: "a-emergency", name: "Block A emergency lights" }, { id: "b-emergency", name: "Block B emergency lights" }],
    lightCounts: [{ id: "playground", name: "Playground lights", count: 4 }],
    tariffTax: { name: "GST", ratePct: 9 },
    carbon: { kgCo2ePerKwh: 0.402, year: 2024, source: "Energy Market Authority" },
    ...extra,
  };
}
const GENERATED = "2026-11-17T02:00:00Z";
const review = buildEnergyReview(estate(), null, GENERATED);
const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

describe("the energy review answers the site's questions in order", () => {
  it("asks all eight questions and answers each at a glance", () => {
    expect(review.style).toBe("review");
    expect(review.questions).toEqual(["total", "groups", "largest", "comparison", "profile", "littleUse", "perLight", "savings"]);
    expect(review.summary.answers.map(answer => answer.question)).toEqual([
      "Total energy and cost", "Block A, Block B and Common area", "What uses the most in each group", "Block A against Block B",
      "24-hour profile", "Pavilion fan", "Energy per lighting point", "Saving potential",
    ]);
    for (const answer of review.summary.answers) expect(answer.answer).not.toMatch(/undefined|NaN|\{\w+\}/);
    expect(review.cover).toMatchObject({ title: "Riverside energy review", preparedFor: ["Riverside"] });
    expect(review.cover.period[0]).toBe("2–15 Nov 2026");
  });

  it("quotes costs including GST and carbon from the site's emission factor", () => {
    const typical = review.total!.projection[0]!;
    expect(review.rate).toBeCloseTo(0.3 * 1.09, 9);
    expect(typical.cost).toBeCloseTo(typical.kwh * 0.3 * 1.09, 9);
    expect(typical.co2Kg).toBeCloseTo(typical.kwh * 0.402, 9);
    expect(review.costBasis).toBe("incl. GST");
    expect(review.summary.figures.map(figure => figure.label)).toEqual(["Typical day", "Projected month (30 days)", "Projected monthly bill, incl. GST", "Projected per year"]);
    expect(review.summary.note).toBe("Monthly and yearly figures are projections from 14 days. Costs use S$0.3000 per kWh before 9% GST, and include the GST.");
    expect(review.method.assumptions.map(row => [row.label, row.value])).toEqual(expect.arrayContaining([["GST", "9%"], ["Grid emission factor, 2024", "0.402 kg CO₂ per kWh"]]));
  });

  it("uses the price as published, and leaves carbon out, when the site has neither tax nor factor", () => {
    const bare = buildEnergyReview(estate({ tariffTax: undefined, carbon: undefined }), null, GENERATED);
    expect(bare.rate).toBeCloseTo(0.3, 9);
    expect(bare.costBasis).toBe("");
    expect(bare.carbonFactor).toBeNull();
    expect(bare.summary.figures.map(figure => figure.label)).not.toContain("Projected per year");
    expect(plain(renderEnergyReviewMarkup(bare))).not.toMatch(/CO₂|incl\. GST/);
  });

  it("splits the site by top-level group with whole percentages that add up to 100", () => {
    const slices = review.groups!.slices;
    expect(slices.map(slice => slice.name)).toEqual(["Block A", "Block B", "Common area"]);
    expect(slices.reduce((sum, slice) => sum + Math.round(slice.share * 100), 0)).toBe(100);
  });

  it("names what uses the most inside each group, by the groups inside it rather than single circuits", () => {
    // Block lighting is both corridor circuits together; ground floor and emergency lights follow, largest first.
    expect(review.largest!.blocks.map(block => [block.name, block.slices.map(slice => slice.name)])).toEqual([
      ["Block A", ["Block lighting", "Ground floor", "Emergency lights"]], ["Block B", ["Block lighting", "Ground floor", "Emergency lights"]],
      ["Common area", expect.arrayContaining(["Driveway lamp"])],
    ]);
    expect(review.largest!.blocks[0]!.slices[0]!.value).toBeCloseTo(8 + 3.4 + 0.01 * 12, 1);
    expect(review.summary.answers[2]!.answer).toMatch(/^Block lighting \(\d+% of Block A and \d+% of Block B\) and Driveway lamp \(\d+% of Common area\)\.$/);
  });

  it("compares the blocks part for part, with each block's whole day, and says where the gap comes from", () => {
    const comparison = review.comparison!;
    expect(comparison.heading).toBe("Block A against Block B");
    expect(comparison.rows.map(row => row.name)).toEqual(["Block lighting", "Ground floor", "Emergency lights"]);
    expect(comparison.total!.name).toBe("Whole block");
    expect(comparison.total!.perDay[0]).toBeGreaterThan(comparison.total!.perDay[1]!);
    expect(comparison.intro).toMatch(/^Block A uses \d+% more than Block B: [\d.]+ kWh against [\d.]+ kWh a day\. Part for part they are close, except: Block A uses [\d.]+ times as much on ground floor as Block B\.$/);
    expect(comparison.callout).toContain("Most of the gap in ground floor is Riverside gate lighting (4.2 kWh a day), which only Block A has.");
    expect(review.summary.answers[3]!.answer).toMatch(/^Block A uses \d+% more than Block B\.$/);
  });

  it("stacks the average day by kind, the always-on emergency lights at the bottom, and says when the lights run", () => {
    const profile = review.profile!;
    expect(profile.layers[0]!.name).toBe("Emergency lights");
    expect(profile.layers.map(layer => layer.name)).toEqual(expect.arrayContaining(["Block lighting", "Ground floor", "Common area"]));
    expect(profile.intro).toContain("Lights switch on at about 7 pm and off at about 7 am.");
    // What stays on in the day is only the emergency lighting, ticked always on by design: the lights are off as planned.
    expect(profile.intro).toMatch(/ During the day the lights are off as planned, apart from emergency lights \(on by design, about [\d.]+ kW\)\.$/);
    // The point to check is a key finding of its own, so the profile's finding says only when the lights run.
    expect(review.summary.answers[4]!.answer).toMatch(/^Lights on from about 7 pm to 7 am, peaking near \d\.\d kW\.$/);
    // The night in words: when the lights come on, the step down, when they go off, and what stays on in the day.
    expect(profile.timeline.map(moment => moment.time)).toEqual(expect.arrayContaining(["7 pm", "7 am"]));
    expect(profile.timeline.find(moment => moment.time === "7 pm")!.text).toMatch(/^First lights on: /);
    expect(profile.timeline.at(-1)).toMatchObject({ time: "7 am to 7 pm", kind: "day", text: expect.stringMatching(/^Daytime: off as planned, apart from emergency lights \(on by design\), about [\d.]+ kW\.$/) });
  });

  it("lists what to check on site: a meter that stopped, not one wired to report only while its lights are on", () => {
    expect(review.checks.map(check => check.title)).toEqual(["Linkway lights has stopped reporting."]);
    expect(review.checks[0]!.text).toContain("No readings since 4 Nov, 6 pm");
    expect(review.total!.intro).toContain("From 4 Nov the total is lower because Linkway lights stopped reporting");
  });

  it("names the one meter that was barely used as its own question", () => {
    expect(review.littleUse!.heading).toBe("Pavilion fan");
    expect(review.littleUse!.text).toBe("Very little use. The meter recorded 0.80 kWh in total, on 1 of 14 days, last until about 5 Nov, 11 pm. It is mostly not used.");
    expect(review.summary.answers[5]!.answer).toBe("Very little use: 0.80 kWh in total, none since 5 Nov.");
  });

  it("gives energy per light where a count is known and asks for the rest", () => {
    expect(review.perLight!.text).toContain("Playground lights (4 lights): **0.050 kWh per light per day**");
    expect(review.perLight!.text).toContain("For the other circuits we need the number of fittings");
  });

  it("costs the lighting measures and sets out next steps", () => {
    const titles = review.savings!.rows.map(row => row.title);
    expect(titles[0]).toBe("Motion-sensor dimming on block lighting, or start the night step-down earlier");
    expect(titles).toContain("Shorten the light timers a little");
    const dimming = review.savings!.rows[0]!;
    expect(dimming.basis).toBe("About 30% of block lighting");
    expect(dimming.costYear).toBeCloseTo(dimming.kwhYear * 0.3 * 1.09, 9);
    expect(review.savings!.intro).toMatch(/worth about \*\*S\$[\d,]+\*\* a year incl\. GST and [\d.]+ tonnes of CO₂\./);
    expect(review.nextSteps.map(step => step.action)).toEqual([
      "Check Linkway lights: breaker, meter power, gateway pairing and fittings",
      "Send the number of light fittings per circuit",
      `Trial: ${titles[0]}`,
      "Review the next full month of readings and confirm the projections",
    ]);
    expect(review.nextSteps[1]!.who).toBe("Riverside");
  });

  it("gives every key finding a headline figure and a tone, as data rather than read out of its sentence", () => {
    expect(review.summary.answers.map(answer => [answer.id, answer.headline])).toEqual([
      ["total", { value: review.summary.figures[0]!.value, unit: "kWh a day", tone: "info" }],
      ["groups", { value: "50%", unit: "in Block A", tone: "info" }],
      ["largest", { value: "53%", unit: "on block lighting", tone: "info" }],
      // Block A uses more, and the gap is worth a look at the fittings.
      ["comparison", { value: "+27%", unit: "Block A over Block B", tone: "watch" }],
      ["profile", { value: "7 pm – 7 am", unit: "lights on", tone: "info" }],
      ["littleUse", { value: "Pavilion fan", unit: "", tone: "info" }],
      ["perLight", { value: "0.050", unit: "kWh per light a day", tone: "info" }],
      ["savings", { value: expect.stringMatching(/^S\$[\d,]+$/), unit: "a year", tone: "good" }],
    ]);
    // Each headline is a figure from its own sentence, except energy and cost, whose sentence goes on from the
    // headline (the month ahead) rather than repeating it right under it.
    for (const answer of review.summary.answers.filter(item => /\d/.test(item.headline.value) && item.id !== "comparison" && item.id !== "total")) expect(answer.answer).toContain(answer.headline.value.replace(/ – .*/, ""));
    const total = review.summary.answers.find(answer => answer.id === "total")!;
    expect(total.answer).not.toContain(total.headline.value);
    expect(total.answer).toMatch(/projected for a 30-day month\.$/);
    expect(review.summary.answers.find(answer => answer.id === "savings")!.answer).toContain(review.summary.answers.find(answer => answer.id === "savings")!.headline.value);
    // Two blocks within 5% of each other are about the same, which is good news; every meter in use is too.
    const even: Record<string, Meter> = { ...METERS, "a-gate": { ...METERS["a-gate"]!, group: "common" }, "b-lobby": { ...METERS["b-lobby"]!, kwh: lit(3.6) }, "b-high": { ...METERS["b-high"]!, kwh: lit(8) }, "b-low": { ...METERS["b-low"]!, kwh: lit(3.4, 0.01) } };
    const same = buildEnergyReview(estate({}, { meters: even }), null, GENERATED);
    expect(same.summary.answers.find(answer => answer.id === "comparison")!.headline).toEqual({ value: "About the same", unit: "", tone: "good" });
    // The key figures carry a line of context each.
    expect(review.summary.figures.map(figure => figure.detail)).toEqual(["From 14 days of readings", expect.stringMatching(/^About [\d,]+ kWh a year$/), expect.stringMatching(/^About S\$\d+ a day$/), "At 0.402 kg CO₂ per kWh"]);
    for (const locale of ["zh-Hans", "ms"] as const) {
      const built = buildEnergyReview(estate(), null, GENERATED, locale);
      expect(built.summary.answers.map(answer => answer.headline.tone)).toEqual(review.summary.answers.map(answer => answer.headline.tone));
      for (const answer of built.summary.answers) expect(`${answer.headline.value} ${answer.headline.unit}`).not.toMatch(/undefined|NaN|\{\w+\}/);
    }
  });

  it("lists every meter's typical day in the appendix, by group in the saved order", () => {
    const groups = review.method.meters.map(meter => meter.group);
    expect(groups.indexOf("Block B")).toBeGreaterThan(groups.lastIndexOf("Block A"));
    expect(groups.indexOf("Common area")).toBeGreaterThan(groups.lastIndexOf("Block B"));
    expect(review.method.meters.find(meter => meter.name === "Shelter lights")!.basis).toBe("Reports only while its lights are on");
  });
});

describe("the energy review as a page", () => {
  it("renders every section in every language with no gaps", () => {
    for (const locale of ["en", "zh-Hans", "ms"] as const) {
      const html = renderEnergyReviewHtml(buildEnergyReview(estate(), null, GENERATED, locale));
      expect(plain(html)).not.toMatch(/undefined|NaN|\{\w+\}/);
      for (const id of ["summary", "q-total", "q-groups", "q-largest", "q-comparison", "q-profile", "checks", "q-littleUse", "q-perLight", "q-savings", "method"]) {
        expect(html).toContain(`id="er-${id}"`);
        expect(html).toContain(`href="#er-${id}"`);
      }
    }
    const page = plain(renderEnergyReviewHtml(review));
    expect(page).toContain("Riverside Energy Review · 2–15 Nov 2026");
    expect(page).toContain("Findings and recommendations from 14 days of meter readings.");
    // Each section is named by its topic, never numbered as a question.
    expect(page).toContain("Energy and cost Total energy, by day, and the cost");
    expect(page).toContain("Savings Energy-saving projection");
    expect(page).toContain("Recommended next steps");
    for (const locale of ["en", "zh-Hans", "ms"] as const) {
      const text = plain(renderEnergyReviewHtml(buildEnergyReview(estate(), null, GENERATED, locale)));
      expect(text).not.toMatch(/Question \d|questions raised|问题 \d|安装时提出的问题|Soalan \d|soalan yang dibangkitkan|section \d\)/);
    }
  });

  it("is what the server saves for the energy review style, except a one-day report, which stays the management review", () => {
    expect(plain(renderStyledSiteReportHtml("review", estate(), null, GENERATED))).toContain("Key findings");
    const day = DATES[5]!;
    const oneDay = estate();
    oneDay.current.project.dates = [day];
    for (const item of [oneDay.current.project.total!, ...oneDay.current.project.meters.map(meter => meter.series!)]) item.cells = item.cells.filter(cell => cell[0] === day);
    const page = plain(renderStyledSiteReportHtml("review", oneDay, null, GENERATED));
    expect(page).not.toContain("Key findings");
    expect(page).toContain("Riverside Energy Review");
  });

  it("leaves out what an opening-hours site with no groups cannot answer", () => {
    const office = estate({ hoursMeaning: undefined, groups: undefined, lightCounts: undefined, openingHours: Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday"].map(day => [day, [{ from: "09:00", to: "18:00" }]])) });
    const built = buildEnergyReview(office, null, GENERATED);
    expect(built.questions).not.toContain("groups");
    expect(built.questions).not.toContain("comparison");
    expect(built.questions).not.toContain("perLight");
    expect(plain(renderEnergyReviewMarkup(built))).not.toMatch(/undefined|NaN|\{\w+\}/);
  });
});

describe("the energy review on a live site's readings", () => {
  it("reads each meter's hours from its area when the site's own list has none", () => {
    const live = buildEnergyReview(estate({}, { byArea: true }), null, GENERATED);
    // The same answers as when the site's list carries the readings: the layers, the checks, little use and the dimming.
    expect(live.profile!.layers.map(layer => layer.name)).toEqual(review.profile!.layers.map(layer => layer.name));
    expect(live.checks.map(check => check.title)).toEqual(["Linkway lights has stopped reporting."]);
    expect(live.littleUse!.heading).toBe("Pavilion fan");
    expect(live.savings!.rows[0]!.title).toBe("Motion-sensor dimming on block lighting, or start the night step-down earlier");
    expect(live.summary.intro).toContain("Block lighting is the largest single load");
    expect(live.perLight!.text).toContain("For the other circuits we need the number of fittings");
  });

  it("says two groups that use the same are about the same, and a part twice another's is twice", () => {
    const even: Record<string, Meter> = { ...METERS, "a-gate": { ...METERS["a-gate"]!, group: "common" },
      "b-lobby": { ...METERS["b-lobby"]!, kwh: lit(3.6) }, "b-high": { ...METERS["b-high"]!, kwh: lit(8) }, "b-low": { ...METERS["b-low"]!, kwh: lit(3.4, 0.01) },
      "b-deco": { name: "Block B decorative light", group: "b-gf", kwh: lit(0.15) }, "a-deco": { name: "Block A decorative light", group: "a-gf", kwh: lit(0.3) } };
    const built = buildEnergyReview(estate({}, { meters: even }), null, GENERATED);
    expect(built.groups!.intro).toMatch(/^Block A and Block B use about the same, \d+% of the energy each\. Then Common area \d+%\.$/);
    expect(built.comparison!.intro).toMatch(/^Block A uses about the same energy as Block B: /);
    const halved = buildEnergyReview(estate({}, { meters: { ...even, "b-emergency": { ...METERS["b-emergency"]!, kwh: () => 0.05 } } }), null, GENERATED);
    expect(halved.comparison!.intro).toContain("Block A uses twice as much on emergency lights as Block B");
  });

  it("calls a meter set aside as not in use offline once it has gone quiet, even one that reported only at night", () => {
    const built = buildEnergyReview(estate({ notInUse: [
      { id: "linkway", name: "Linkway lights", reason: "Offline since 4 Nov, waiting for a site check" },
      { id: "shelter", name: "Shelter lights", reason: "Daytime readings missing (loses power with its lights)" },
    ] }), null, GENERATED);
    // The linkway reported every night until 4 Nov, then nothing: offline. The shelter still reports every night: by design.
    expect(built.checks.map(check => check.title)).toEqual(["Linkway lights is offline."]);
    expect(built.checks[0]!.text).toContain("No readings since 4 Nov, 6 pm");
    expect(built.checks[0]!.text).toContain("Note on file: Offline since 4 Nov, waiting for a site check.");
    expect(built.nextSteps[0]!.action).toBe("Check Linkway lights: breaker, meter power, gateway pairing and fittings");
  });

  it("names daytime use on lighting only when it is worth a visit (about 100 kWh a year)", () => {
    const withDay = (kwh: number) => buildEnergyReview(estate({}, { meters: { ...METERS, "a-high": { ...METERS["a-high"]!, kwh: lit(8, kwh) } } }), null, GENERATED);
    // 0.02 kWh an hour for 12 daytime hours is under 90 kWh a year: not a point to check, not a saving.
    const small = withDay(0.02);
    expect(small.checks.map(check => check.title)).not.toContain("Daytime use on lighting circuits.");
    expect(small.savings!.rows.map(row => row.title)).not.toContain("Find and fix the daytime standby");
    // 0.2 kWh an hour is about 880 kWh a year: named, costed and sent to the contractor.
    const large = withDay(0.2);
    expect(large.checks.map(check => check.title)).toContain("Daytime use on lighting circuits.");
    expect(large.savings!.rows.map(row => row.title)).toContain("Find and fix the daytime standby");
    expect(large.nextSteps.some(step => step.action.startsWith("Find the source of the daytime use"))).toBe(true);
  });

  it("trials only the dimming, never the daytime standby or the timers", () => {
    const trials = review.nextSteps.filter(step => step.action.startsWith("Trial:"));
    expect(trials.map(step => step.action)).toEqual(["Trial: Motion-sensor dimming on block lighting, or start the night step-down earlier"]);
    // No alike blocks, so nothing to dim: no trial at all.
    const single = buildEnergyReview(estate({ groups: { list: GROUPS.filter(group => !group.id.startsWith("b")), meters: [] } }), null, GENERATED);
    expect(single.nextSteps.some(step => step.action.startsWith("Trial:"))).toBe(false);
  });
});

describe("the energy review as a working page", () => {
  it("gives a saved copy a title block and the bar of sections, but nothing that moves", () => {
    const html = renderEnergyReviewHtml(review);
    expect(html).toContain("<h1>Riverside energy review</h1>");
    expect(plain(html)).toContain("Prepared for Riverside");
    expect(html).toContain('aria-label="Sections of the review"');
    expect(html).not.toMatch(/<button|<input|<script/);
    // On paper every figure the charts give on hover is still there: the costs under the bars and the full meter list.
    expect(plain(html)).toContain("Second line: cost incl. GST.");
    expect(html.match(/<tbody>/g)!.length).toBeGreaterThanOrEqual(3);
    for (const meter of review.method.meters) expect(plain(html)).toContain(meter.name);
  });

  it("opens on its summary under the bar of sections, and its switches, layers, measures and meter list respond", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("React", React);
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const click = async (element: Element | null | undefined) => { expect(element).toBeTruthy(); await act(async () => (element as HTMLElement).click()); };
    const button = (text: string) => [...host.querySelectorAll("button")].find(item => item.textContent?.trim() === text);
    try {
      await act(async () => root.render(<EnergyReviewDocument review={review} />));
      // No cover on the page: the panel around it already names the site and the dates.
      expect(host.querySelector("h1")).toBeNull();
      const nav = [...host.querySelectorAll('nav[aria-label="Sections of the review"] a')].map(link => link.textContent);
      expect(nav).toEqual(["Summary", "Total use", "By group", "Inside each group", "Like for like", "24 hours", "Checks", "Little use", "Per light", "Savings", "Method"]);

      // The key findings: one card per topic, with the point to check as its own card after the 24 hours.
      const cards = [...host.querySelectorAll<HTMLAnchorElement>("#er-summary .er-finds a")];
      expect(cards.map(card => card.getAttribute("href"))).toEqual(["#er-q-total", "#er-q-groups", "#er-q-largest", "#er-q-comparison", "#er-q-profile", "#er-checks", "#er-q-littleUse", "#er-q-perLight", "#er-q-savings"]);
      expect(cards.map(card => card.querySelector(".er-find-topic")!.textContent)).toEqual(["Energy and cost", "Where it goes", "Biggest users", "Like for like", "Daily rhythm", "Checks", "Low use", "Lighting efficiency", "Savings"]);
      const check = cards[5]!;
      expect(check.className).toContain("er-tone-watch");
      expect(check.querySelector(".er-find-figure")!.textContent).toBe("1to check");
      expect(check.getAttribute("aria-label")).toBe("Checks (Needs a check): 1 to check. Linkway lights has stopped reporting.");
      expect(cards[3]!.querySelector(".er-chip")!.textContent).toBe("Worth a look");
      expect(cards[0]!.querySelector(".er-chip")).toBeNull();
      expect(cards[0]!.getAttribute("aria-label")).toMatch(/^Energy and cost: \d+\.\d kWh a day\. [\d,]+ kWh .*projected for a 30-day month\.$/);
      expect(host.querySelector("#er-q-total .er-kicker")!.textContent).toBe("Energy and cost");

      // A figure and a key finding each take the reader to their section, without changing the address.
      await click(host.querySelector('.er-finds a[href="#er-q-savings"]'));
      expect(scrolled).toHaveBeenCalledTimes(1);
      expect((scrolled.mock.contexts[0] as Element).id).toBe("er-q-savings");
      expect(host.querySelector('a.er-fig-tile[href="#er-q-total"]')).not.toBeNull();

      // Energy or cost, each day.
      expect(host.querySelector("#er-q-total .er-fig-title")?.textContent).toBe("Energy used each day, kWh");
      await click(button("Cost"));
      expect(host.querySelector("#er-q-total .er-fig-title")?.textContent).toBe("Cost of each day, S$");
      expect(host.querySelector("#er-q-total .er-typ")?.textContent).toMatch(/^Typical day S\$\d+\.\d\d$/);

      // A layer of the 24 hours can be hidden, and everything shown again.
      const layer = review.profile!.layers[0]!.name;
      await click(button(layer));
      expect(button(layer)!.getAttribute("aria-pressed")).toBe("false");
      await click(button("Show all"));
      expect(button(layer)!.getAttribute("aria-pressed")).toBe("true");
      expect(button("Show all")).toBeUndefined();

      // Leaving a measure out takes it off the saving total.
      expect(review.savings!.rows.length).toBeGreaterThan(1);
      const total = () => host.querySelector("table.er-sav tr.er-total")!.textContent!;
      expect(total()).toContain("Total");
      await click(host.querySelector(`input[aria-label="Include ${review.savings!.rows[0]!.title} in the total"]`));
      expect(total()).toContain(`1 of ${review.savings!.rows.length} measures`);
      expect(total()).toContain(review.savings!.rows.slice(1).reduce((sum, row) => sum + row.kwhYear, 0).toLocaleString("en-SG", { maximumFractionDigits: 0 }));

      // The meter list starts short, opens in full, and sorts by use.
      const rows = () => [...host.querySelectorAll("#er-method tbody tr")];
      expect(rows()).toHaveLength(8);
      await click(button(`Show all ${review.method.meters.length} meters`));
      expect(rows()).toHaveLength(review.method.meters.length);
      await click(host.querySelector('#er-method th button[title="Sort by kWh / day"]'));
      const largest = Math.max(...review.method.meters.map(meter => meter.perDay ?? 0));
      expect(rows()[0]!.textContent).toContain(largest.toFixed(2));
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  });
});

describe("the 24-hour chart marks when the lights switch", () => {
  // Two alike blocks and a common area on 10-minute timers, the block lighting stepped down after midnight, the
  // emergency lights always on by design and lights-on hours of 18:00–08:00. The names are made up.
  /** A circuit on a timer: on at `on`, off at `off`, and down to each later level at its time (hours: 18.5 is 6:30 pm). */
  const timer = (kw: number, on: number, off: number, ...steps: Array<[at: number, kw: number]>): Profile => (_date, hour) => {
    let sum = 0;
    for (let minute = 0; minute < 60; minute += 1) {
      const time = hour + (minute + 0.5) / 60;
      if (time >= on) sum += kw;
      else if (time < off) sum += steps.filter(([at]) => time >= at).at(-1)?.[1] ?? kw;
    }
    return sum / 60;
  };
  const BLOCKS: Record<string, Meter> = {
    "a-l1": { name: "31A L1–L6", group: "a-lighting", kwh: timer(0.8, 18.5, 7 + 1 / 6, [1, 0.55]) },
    "a-l2": { name: "31A L7–L17", group: "a-lighting", kwh: timer(0.5, 18.5, 7 + 1 / 6, [0.5, 0.32]) },
    "a-lobby": { name: "31A lift lobby", group: "a-gf", kwh: timer(0.2, 18.5, 6.5) },
    "a-deco": { name: "31A decorative light", group: "a-gf", kwh: timer(0.23, 18 + 2 / 3, 6.5) },
    "a-emergency": { name: "31A emergency lights", group: "a-emergency", kwh: () => 0.2 },
    "b-l1": { name: "31B L1–L6", group: "b-lighting", kwh: timer(0.5, 18.5, 7 + 1 / 3, [0.5, 0.32]) },
    "b-l2": { name: "31B L7–L17", group: "b-lighting", kwh: timer(0.5, 18.5, 7 + 1 / 3, [0.5, 0.32]) },
    "b-lobby": { name: "31B lift lobby", group: "b-gf", kwh: timer(0.2, 18.5, 6.5) },
    "b-deco": { name: "31B decorative light", group: "b-gf", kwh: timer(0.23, 18 + 2 / 3, 6.5) },
    "b-emergency": { name: "31B emergency lights", group: "b-emergency", kwh: () => 0.2 },
    driveway: { name: "Driveway lamp", group: "common", kwh: timer(0.2, 18 + 1 / 3, 6.5) },
    carpark: { name: "Carpark lights", group: "common", kwh: timer(0.15, 18.5, 6.5) },
    playground: { name: "Playground lights", group: "common", kwh: timer(0.19, 18 + 2 / 3, 6.5) },
  };
  const LONG_NIGHTS = Object.fromEntries(Object.keys(NIGHTS).map(day => [day, [{ from: "18:00", to: "08:00" }]]));
  const blocks = (extra: Partial<AnalysisData> = {}, meters = BLOCKS, locale: "en" | "zh-Hans" | "ms" = "en") => buildEnergyReview(estate(extra, { meters, nights: LONG_NIGHTS }), null, GENERATED, locale);
  const built = blocks();

  it("marks each moment at its minute, and gives the site's level just after a step from the minutes, not the next hour", () => {
    const timeline = built.profile!.timeline;
    expect(timeline.map(moment => [moment.time, moment.kind, moment.at])).toEqual([
      ["6:20 pm", "on", 1100], ["6:30 pm", "on", 1110], ["6:40 pm", "on", 1120], ["7 pm", "on", 1140],
      ["12:30 am", "step", 30], ["1 am", "step", 60],
      ["6:30 am", "off", 390], ["7:10 am", "off", 430], ["7:20 am", "off", 440],
      ["7:20 am to 6:20 pm", "day", undefined],
    ]);
    // Three circuits step down at 12:30 and the fourth at 1 am: in between the site is still above its 1 am level.
    // Both used to read the hour after (3.3 kW).
    expect(timeline[4]!.text).toBe("31A L7–L17, 31B L1–L6 and 31B L7–L17 step down; the site drops to about 3.6 kW.");
    expect(timeline[5]!.text).toBe("31A L1–L6 step down; the site drops to about 3.3 kW.");
  });

  it("leaves the level out rather than guess it when a circuit is still dimming after its step", () => {
    const dimming = blocks({}, { ...BLOCKS, "a-l1": { ...BLOCKS["a-l1"]!, kwh: timer(0.8, 18.5, 7 + 1 / 6, [1, 0.55], [2.5, 0.4]) } });
    const steps = dimming.profile!.timeline.filter(moment => moment.kind === "step");
    expect(steps.find(moment => moment.text.startsWith("31A L1–L6 "))!.text).toBe("31A L1–L6 step down.");
    expect(steps.find(moment => moment.time === "12:30 am")!.text).toMatch(/ step down; the site drops to about 3\.6 kW\.$/);
  });

  it("shades the daytime, off as planned when only the meters ticked always on by design stay on", () => {
    expect(built.profile!.daytime).toEqual({ from: 440, to: 1100, kw: expect.closeTo(0.4, 6), planned: true, title: "Off as planned", detail: "only emergency lights, about 0.4 kW" });
    expect(built.profile!.intro).toMatch(/ During the day the lights are off as planned, apart from emergency lights \(on by design, about 0\.4 kW\)\.$/);
    expect(built.profile!.timeline.at(-1)!.text).toBe("Daytime: off as planned, apart from emergency lights (on by design), about 0.4 kW.");
  });

  it("calls what stays on daytime use when it is not by design, going by the tick and never by a meter's name", () => {
    // The same emergency lights without the tick, and a lift lobby left on all day.
    const unticked = blocks({ alwaysOnByDesign: undefined });
    expect(unticked.profile!.daytime).toMatchObject({ planned: false, title: "Daytime", detail: "about 0.4 kW still on" });
    expect(unticked.profile!.intro).toMatch(/ During the day about 0\.4 kW remains, mostly emergency lights\.$/);
    const leftOn = blocks({}, { ...BLOCKS, "a-lobby": { ...BLOCKS["a-lobby"]!, kwh: () => 0.2 } });
    expect(leftOn.profile!.daytime).toMatchObject({ planned: false, title: "Daytime", detail: "about 0.6 kW still on" });
    expect(leftOn.profile!.intro).not.toContain("off as planned");
  });

  it("says what stays on at midday, from the whole hours between the last light off and the first on, not the switching either side", () => {
    // As at the first site: lights-on hours 18:30–07:10, so the scheduled daytime (7 am–7 pm) holds the block lighting
    // going off until 7:20 and the 6 pm switching on, about 0.4 kW on average. At midday only the emergency lights
    // (0.1 kW in each block, ticked always on by design) and the pavilion (0.02 kW) are on.
    const SKTC_NIGHTS = Object.fromEntries(Object.keys(NIGHTS).map(day => [day, [{ from: "18:30", to: "07:10" }]]));
    const meters: Record<string, Meter> = { ...BLOCKS, "a-emergency": { ...BLOCKS["a-emergency"]!, kwh: () => 0.1 }, "b-emergency": { ...BLOCKS["b-emergency"]!, kwh: () => 0.1 },
      pavilion: { name: "Pavilion lights", group: "common", kwh: () => 0.02 } };
    const site = buildEnergyReview(estate({}, { meters, nights: SKTC_NIGHTS }), null, GENERATED);
    const profile = site.profile!;
    const scheduled = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].reduce((sum, hour) => sum + profile.layers.reduce((total, layer) => total + layer.hours[hour]!, 0), 0) / 12;
    expect(scheduled).toBeCloseTo(0.4, 1);
    expect(profile.daytime).toEqual({ from: 440, to: 1100, kw: expect.closeTo(0.22, 6), planned: true, title: "Off as planned", detail: "only emergency lights, about 0.2 kW" });
    expect(profile.intro).toMatch(/ During the day the lights are off as planned, apart from emergency lights \(on by design, about 0\.2 kW\)\.$/);
    expect(profile.timeline.at(-1)).toEqual({ time: "7:20 am to 6:20 pm", kind: "day", text: "Daytime: off as planned, apart from emergency lights (on by design), about 0.2 kW." });
    // The scheduled daytime figure stays where it was used before: the timer saving still counts from it.
    const trim = site.savings!.rows.find(row => row.title === "Shorten the light timers a little")!;
    const night = [19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5, 6].reduce((sum, hour) => sum + profile.layers.reduce((total, layer) => total + layer.hours[hour]!, 0), 0) / 12;
    expect(trim.kwhYear).toBeCloseTo((night - scheduled) * 0.5 * 365, 6);
  });

  it("gives the day's total as the typical day, which the average hours add up to", () => {
    const typical = built.summary.figures[0]!.value;
    expect(built.profile!.dayTotal).toBe(`About ${typical} kWh a day`);
    expect(built.profile!.layers.reduce((sum, layer) => sum + layer.hours.reduce((total, value) => total + value, 0), 0)).toBeCloseTo(Number(typical), 0);
    expect(built.profile!.description).toBe(`Average power for each hour of the day, the groups stacked, peaking at about 4.1 kW. Dashed lines numbered 1 to 9 mark the switching times in the list below the chart. The shaded part, 7:20 am to 6:20 pm, is the daytime. Off as planned: only emergency lights, about 0.4 kW. About ${typical} kWh a day.`);
  });

  it("draws the marks in a saved copy too, numbered like the list and on the same scale as the hours", () => {
    const host = document.createElement("div");
    host.innerHTML = renderEnergyReviewMarkup(built);
    const profile = host.querySelector("#er-q-profile")!;
    const marks = [...profile.querySelectorAll("svg .er-mk")];
    const mark = (n: string) => marks.find(item => item.querySelector(".er-mk-n")!.textContent === n)!;
    expect(marks.map(item => item.querySelector(".er-mk-n")!.textContent).sort((a, b) => Number(a) - Number(b))).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    expect([...profile.querySelectorAll(".er-timeline li")].map(row => row.querySelector(".er-badge")!.textContent)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", ""]);
    // A saved copy is 780 wide: hours from x 50 to 768, so 12:30 am is half an hour in and 6:20 pm at 18 h 20 min.
    const x = (minutes: number) => 50 + 718 * minutes / 1440;
    expect(Number(mark("5").querySelector(".er-mk-line")!.getAttribute("x1"))).toBeCloseTo(x(30), 3);
    expect(Number(mark("1").querySelector(".er-mk-line")!.getAttribute("x1"))).toBeCloseTo(x(1100), 3);
    const band = profile.querySelector("svg .er-day rect")!;
    expect(Number(band.getAttribute("x"))).toBeCloseTo(x(440), 3);
    expect(Number(band.getAttribute("width"))).toBeCloseTo(x(1100) - x(440), 3);
    // Moments minutes apart share the room above them, their times named together.
    expect([...profile.querySelectorAll("svg text.er-mk-time")].map(item => item.textContent)).toEqual(["12:30 am – 1 am", "6:30 am – 7:20 am", "6:20 pm – 7 pm"]);
    expect([...profile.querySelectorAll("svg text.er-day-text")].map(item => item.textContent)).toEqual(["Off as planned", "only emergency lights, about 0.4 kW"]);
    expect(profile.querySelector("svg desc")!.textContent).toBe(built.profile!.description);
    expect(profile.querySelector(".er-daytotal")!.textContent).toBe(built.profile!.dayTotal);
    expect(profile.querySelector(".er-mkey")!.textContent).toBe("Lights onStep downLights offDaytimeNumbers match the list below.");
    // Nothing in it moves.
    expect(profile.querySelector("[tabindex], button")).toBeNull();
    // A review saved before the chart marked its moments shows its list as it did, with nothing marked.
    const saved = { ...built, profile: { ...built.profile!, timeline: built.profile!.timeline.map(({ time, text }) => ({ time, text })), daytime: undefined, dayTotal: undefined, description: undefined } };
    host.innerHTML = renderEnergyReviewMarkup(saved);
    expect(host.querySelector("#er-q-profile svg .er-mk, #er-q-profile svg .er-day, #er-q-profile .er-badge, #er-q-profile .er-mkey, #er-q-profile .er-daytotal")).toBeNull();
    expect(host.querySelectorAll("#er-q-profile .er-timeline:not(.er-marked) li")).toHaveLength(10);
  });

  it("picks out a moment's mark when its row is pointed at or focused, and its row when the mark is pointed at", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("React", React);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<EnergyReviewDocument review={built} />));
      const rows = [...host.querySelectorAll<HTMLLIElement>("#er-q-profile .er-timeline li")];
      const mark = (n: string) => [...host.querySelectorAll("#er-q-profile svg .er-mk")].find(item => item.querySelector(".er-mk-n")!.textContent === n)!;
      const picked = () => [rows.findIndex(row => row.classList.contains("er-on")), [...host.querySelectorAll("#er-q-profile svg .er-mk.er-on .er-mk-n")].map(item => item.textContent)];
      expect(rows.every(row => row.tabIndex === 0)).toBe(true);
      await act(async () => { rows[4]!.dispatchEvent(new PointerEvent("pointerover", { bubbles: true })); });
      expect(picked()).toEqual([4, ["5"]]);
      expect(host.querySelector("#er-q-profile svg .er-mks")!.classList.contains("er-focus")).toBe(true);
      await act(async () => { rows[4]!.dispatchEvent(new PointerEvent("pointerout", { bubbles: true })); });
      expect(picked()).toEqual([-1, []]);
      await act(async () => { mark("8").querySelector(".er-mk-hit")!.dispatchEvent(new PointerEvent("pointerover", { bubbles: true })); });
      expect(picked()).toEqual([7, ["8"]]);
      await act(async () => { mark("8").querySelector(".er-mk-hit")!.dispatchEvent(new PointerEvent("pointerout", { bubbles: true })); });
      // The daytime row picks out the shaded band.
      await act(async () => rows[9]!.focus());
      expect(host.querySelector("#er-q-profile svg .er-day")!.classList.contains("er-on")).toBe(true);
      await act(async () => rows[9]!.blur());
      expect(host.querySelector("#er-q-profile svg .er-day")!.classList.contains("er-on")).toBe(false);
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  });

  it("words the marks, the daytime and the day's total in every language with no gaps", () => {
    for (const [locale, planned, total] of [["zh-Hans", "按计划关灯", "每天约"], ["ms", "Padam seperti dirancang", "Kira-kira"]] as const) {
      const review = blocks({}, BLOCKS, locale);
      const html = renderEnergyReviewHtml(review);
      expect(plain(html)).not.toMatch(/undefined|NaN|\{\w+\}/);
      expect(review.profile!.daytime!.title).toBe(planned);
      expect(review.profile!.dayTotal).toContain(total);
      expect(review.profile!.timeline.filter(moment => moment.kind === "step").map(moment => moment.text.match(/[\d.]+ kW/)?.[0])).toEqual(["3.6 kW", "3.3 kW"]);
      for (const text of [review.profile!.intro, review.profile!.description!, ...review.profile!.timeline.map(moment => moment.text)]) expect(text).not.toMatch(/undefined|NaN|\{\w+\}/);
    }
  });
});

describe("feedback on the report reaches the energy review", () => {
  // A site whose meters all report every day, with the driveway lamp left on all of one day: a day that stands out.
  const without = (meter: Meter, key: "stopAfter" | "nightOnly"): Meter => { const copy = { ...meter }; delete copy[key]; return copy; };
  const linkway = without(METERS.linkway!, "stopAfter"), shelter = without(METERS.shelter!, "nightOnly");
  const SPIKE = "2026-11-10";
  const STEADY: Record<string, Meter> = { ...METERS, linkway, shelter, driveway: { ...METERS.driveway!, kwh: (date, hour) => date === SPIKE ? 1.5 : lit(4)(date, hour) },
    carpark: { name: "Carpark lights", group: "common", kwh: () => 0 } };
  const FOLLOW_UPS: NonNullable<AnalysisData["followUps"]> = [
    { text: "The pavilion fan must never run at night.", status: "done", createdAt: "2026-11-03T02:00:00Z" },
    { text: "See whether Block A ground floor drops after the timer change.", status: "open", createdAt: "2026-11-05T02:00:00Z",
      lastCheck: { at: "2026-11-16T02:00:00Z", verdict: "resolved", evidence: "Ground floor fell from 7.8 to 6.1 kWh a night after 9 Nov." } },
    { text: "Watch the linkway lights after the repair.", status: "open", createdAt: "2026-11-06T02:00:00Z",
      lastCheck: { at: "2026-11-16T02:00:00Z", verdict: "ongoing", evidence: "Still no readings since 4 Nov." } },
    { text: "Check the playground lights after the new fittings.", status: "open", createdAt: "2026-11-07T02:00:00Z" },
    { text: "Shelter lights rewiring.", status: "dropped", createdAt: "2026-11-02T02:00:00Z" },
  ];
  const MEMORY: NonNullable<AnalysisData["feedbackMemory"]> = [
    { text: "Pavilion 2 loses power by day; that is normal.", date: "2026-11-04" },
    { text: "The lights go off at 7:10 am, not 6:45 am.", date: "2026-11-12" },
  ];
  const withFeedback = (locale: "en" | "zh-Hans" | "ms" = "en") => buildEnergyReview(estate({ followUps: FOLLOW_UPS, feedbackMemory: MEMORY }), null, GENERATED, locale);

  it("gives every point to check a stable key, the same in every language and every build", () => {
    expect(review.checks.map(check => check.key)).toEqual(["stopped:linkway"]);
    const offline = (locale: "en" | "zh-Hans" | "ms") => buildEnergyReview(estate({ notInUse: [{ id: "linkway", name: "Linkway lights", reason: "Waiting for a site check" }] }), null, GENERATED, locale).checks.map(check => check.key);
    expect(offline("en")).toEqual(["offline:linkway"]);
    expect(offline("zh-Hans")).toEqual(offline("en"));
    expect(offline("ms")).toEqual(offline("en"));
    // A day that stood out, a lighting meter that used nothing, and daytime use worth a visit.
    const steady = buildEnergyReview(estate({}, { meters: { ...STEADY, "a-high": { ...METERS["a-high"]!, kwh: lit(8, 0.2) } } }), null, GENERATED);
    const keys = steady.checks.map(check => check.key);
    expect(keys).toEqual(expect.arrayContaining([`standout:${SPIKE}`, "daytime", "noUse:carpark"]));
    expect(buildEnergyReview(estate({}, { meters: { ...STEADY, "a-high": { ...METERS["a-high"]!, kwh: lit(8, 0.2) } } }), null, GENERATED).checks.map(check => check.key)).toEqual(keys);
    // A meter set aside as not in use that still reports, on an opening-hours site.
    const office = buildEnergyReview(estate({ hoursMeaning: undefined, notInUse: [{ id: "fan", name: "Pavilion fan", reason: "Spare circuit" }],
      openingHours: Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday"].map(day => [day, [{ from: "09:00", to: "18:00" }]])) }), null, GENERATED);
    expect(office.checks.find(check => check.key === "notInUse:fan")?.title).toBe("Pavilion fan is marked not in use.");
    for (const check of [...review.checks, ...steady.checks, ...office.checks]) expect(check.key).toMatch(/^(stopped|offline|notInUse|noUse):[\w-]+$|^standout:\d{4}-\d\d-\d\d$|^daytime$/);
  });

  it("leaves out a point an admin set aside, with its next step, and says so in the appendix", () => {
    const quiet = buildEnergyReview(estate({ dismissedChecks: [{ key: "stopped:linkway", title: "Linkway lights has stopped reporting.", reason: "Taken out for the renovation." }] }), null, GENERATED);
    expect(quiet.checks).toEqual([]);
    expect(quiet.nextSteps.map(step => step.action)).not.toContain("Check Linkway lights: breaker, meter power, gateway pairing and fittings");
    expect(quiet.summary.answers.find(answer => answer.id === "profile")!.answer).toMatch(/ Nothing needs checking\.$/);
    expect(quiet.method.setAside).toEqual([{ title: "Linkway lights has stopped reporting.", reason: "Taken out for the renovation." }]);
    const page = renderEnergyReviewHtml(quiet);
    expect(page).not.toContain('id="er-checks"');
    expect(plain(page)).toContain("Points to check left out");
    expect(plain(page)).toContain("Linkway lights has stopped reporting. Taken out for the renovation.");
    // A key that matches nothing changes nothing.
    const other = buildEnergyReview(estate({ dismissedChecks: [{ key: "stopped:driveway", title: "Driveway lamp has stopped reporting.", reason: "" }] }), null, GENERATED);
    expect(other.checks.map(check => check.key)).toEqual(["stopped:linkway"]);
    expect(other.method.setAside).toEqual([]);
    expect(review.method.setAside).toEqual([]);
    // A day set aside makes room for the next one; daytime use set aside drops its step too.
    const daytime = buildEnergyReview(estate({ dismissedChecks: [{ key: "daytime", title: "Daytime use on lighting circuits.", reason: "Cleaning crew" }] }, { meters: { ...METERS, "a-high": { ...METERS["a-high"]!, kwh: lit(8, 0.2) } } }), null, GENERATED);
    expect(daytime.checks.map(check => check.key)).not.toContain("daytime");
    expect(daytime.nextSteps.some(step => step.action.startsWith("Find the source of the daytime use"))).toBe(false);
    expect(daytime.method.setAside.map(item => item.title)).toEqual(["Daytime use on lighting circuits."]);
    const spike = buildEnergyReview(estate({ dismissedChecks: [{ key: `standout:${SPIKE}`, title: "", reason: "Fair on the driveway" }] }, { meters: STEADY }), null, GENERATED);
    expect(spike.checks.map(check => check.key)).not.toContain(`standout:${SPIKE}`);
    expect(spike.method.setAside).toEqual([{ title: expect.stringContaining("10 Nov"), reason: "Fair on the driveway" }]);
  });

  it("carries follow-ups, open ones first, and what the AI remembers, newest first", () => {
    const built = withFeedback();
    expect(built.followUps.map(item => [item.status, item.verdict])).toEqual([
      ["open", "resolved"], ["open", "ongoing"], ["open", null], ["done", null], ["dropped", null],
    ]);
    expect(built.followUps[0]).toEqual({ text: "See whether Block A ground floor drops after the timer change.", status: "open", verdict: "resolved", evidence: "Ground floor fell from 7.8 to 6.1 kWh a night after 9 Nov." });
    expect(built.followUps[2]!.evidence).toBeNull();
    expect(built.memory).toEqual(["The lights go off at 7:10 am, not 6:45 am.", "Pavilion 2 loses power by day; that is normal."]);
    expect(review.followUps).toEqual([]);
    expect(review.memory).toEqual([]);
    // At most ten remembered facts, each quoted at a readable length.
    const many = buildEnergyReview(estate({ feedbackMemory: Array.from({ length: 14 }, (_, index) => ({ text: `Fact ${index} ${"x".repeat(index === 13 ? 900 : 5)}`, date: `2026-11-${String(index + 1).padStart(2, "0")}` })) }), null, GENERATED);
    expect(many.memory).toHaveLength(10);
    expect(many.memory[0]!.startsWith("Fact 13")).toBe(true);
    expect(many.memory[0]!.length).toBeLessThanOrEqual(300);
    expect(many.memory[0]!.endsWith("…")).toBe(true);
  });

  it("shows the follow-ups after the points to check and the remembered facts in the appendix, in a saved copy too", () => {
    const html = renderEnergyReviewHtml(withFeedback());
    const text = plain(html);
    expect(html).toContain('id="er-followups"');
    expect(html).toContain('href="#er-followups"');
    expect(html.indexOf('id="er-followups"')).toBeGreaterThan(html.indexOf('id="er-checks"'));
    expect(html.indexOf('id="er-followups"')).toBeLessThan(html.indexOf('id="er-method"'));
    expect(text).toContain("Follow-ups from your feedback");
    for (const chip of ["Looks resolved", "Still open", "Open", "Done", "Dropped"]) expect(html).toContain(`>${chip}</span>`);
    expect(text).toContain("Last check: Ground floor fell from 7.8 to 6.1 kWh a night after 9 Nov.");
    expect(text).toContain("What we know about the site (from your feedback)");
    expect(text).toContain("The lights go off at 7:10 am, not 6:45 am.");
    expect(html).not.toMatch(/<button|<input|<script/);
    // Without feedback there is no such section, nav item or list.
    const bare = renderEnergyReviewHtml(review);
    expect(bare).not.toContain("er-followups");
    expect(plain(bare)).not.toContain("What we know about the site");
  });

  it("words follow-ups, remembered facts and set-aside points in every language with no gaps", () => {
    for (const locale of ["en", "zh-Hans", "ms"] as const) {
      const built = buildEnergyReview(estate({ followUps: FOLLOW_UPS, feedbackMemory: MEMORY, dismissedChecks: [{ key: "stopped:linkway", title: "Linkway lights has stopped reporting.", reason: "Taken out." }] }), null, GENERATED, locale);
      const html = renderEnergyReviewHtml(built);
      expect(plain(html)).not.toMatch(/undefined|NaN|\{\w+\}/);
      expect(html).toContain('id="er-followups"');
      expect(built.method.setAside).toHaveLength(1);
      expect(html).toContain({ en: ">Looks resolved<", "zh-Hans": ">似乎已解决<", ms: ">Nampaknya selesai<" }[locale]);
      expect(plain(renderEnergyReviewMarkup(built))).not.toMatch(/undefined|NaN|\{\w+\}/);
    }
  });

  it("offers \"Tell the AI about this\" on each point to check only on the live page, and only when the page asks for feedback", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("React", React);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onCheckFeedback = vi.fn();
    const built = withFeedback();
    try {
      await act(async () => root.render(<EnergyReviewDocument review={built} onCheckFeedback={onCheckFeedback} />));
      const asks = [...host.querySelectorAll<HTMLButtonElement>("#er-checks button.er-ask")];
      expect(asks).toHaveLength(built.checks.length);
      expect(asks[0]!.textContent).toBe("Tell the AI about this");
      expect(asks[0]!.getAttribute("aria-label")).toBe("Tell the AI about this: Linkway lights has stopped reporting.");
      await act(async () => asks[0]!.click());
      expect(onCheckFeedback).toHaveBeenCalledWith({ key: "stopped:linkway", title: "Linkway lights has stopped reporting." });
      // The follow-ups are live too, with their place in the bar of sections.
      const nav = [...host.querySelectorAll('nav[aria-label="Sections of the review"] a')].map(link => link.textContent);
      expect(nav.slice(nav.indexOf("Checks"), nav.indexOf("Checks") + 2)).toEqual(["Checks", "Follow-ups"]);
      expect(host.querySelectorAll("#er-followups li")).toHaveLength(FOLLOW_UPS.length);
      expect([...host.querySelectorAll("#er-method .er-known li")].map(item => item.textContent)).toEqual(built.memory);

      // Without the prop, no button.
      await act(async () => root.render(<EnergyReviewDocument review={built} />));
      expect(host.querySelector(".er-ask")).toBeNull();
      // A saved copy never has one, even with the prop.
      await act(async () => root.render(<EnergyReviewDocument review={built} standalone onCheckFeedback={onCheckFeedback} />));
      expect(host.querySelector(".er-ask")).toBeNull();
      expect(host.querySelector("#er-followups")).not.toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  });

  it("travels from the project information into the readings, dropping anything it cannot read", () => {
    const source: AnalysisSource = {
      context: { projectName: "Riverside", scopeId: "estate", scopeName: "Riverside", timezone: "Asia/Singapore", from: "2026-11-01T16:00:00.000Z", to: "2026-11-03T16:00:00.000Z" },
      summary: { usageKwh: 10, peakKw: 1, validIntervalCount: 96 }, categories: [], childScopes: [], circuits: [], cost: { status: "unavailable" },
    };
    const assemble = (information: ProjectInformationSource) => assembleAnalysisData({ projectId: "estate", project: source, spaces: [], spaceCurrent: [], previousProject: null, spacePrevious: [], history: null, information, actions: [] });
    const data = assemble({
      name: "Riverside", calendar: null,
      feedbackMemory: [{ text: "  The pavilion fan must never run. ", date: "2026-11-12" }, { text: "   ", date: "2026-11-12" }],
      followUps: [
        { text: "Watch the linkway.", status: "open", createdAt: "2026-11-06T02:00:00Z", lastCheck: { at: "2026-11-16T02:00:00Z", verdict: "ongoing", evidence: "No readings." } },
        { text: "Odd status", status: "paused" as "open", createdAt: "2026-11-06T02:00:00Z" },
        { text: "Odd verdict", status: "done", createdAt: "2026-11-06T02:00:00Z", lastCheck: { at: "2026-11-16T02:00:00Z", verdict: "maybe" as "unclear", evidence: "?" } },
      ],
      dismissedChecks: [{ key: "stopped:linkway", title: "Linkway lights has stopped reporting.", reason: "Renovation" }, { key: "", title: "Nothing", reason: "" }],
    });
    expect(data.feedbackMemory).toEqual([{ text: "The pavilion fan must never run.", date: "2026-11-12" }]);
    expect(data.followUps).toEqual([
      { text: "Watch the linkway.", status: "open", createdAt: "2026-11-06T02:00:00Z", lastCheck: { at: "2026-11-16T02:00:00Z", verdict: "ongoing", evidence: "No readings." } },
      { text: "Odd verdict", status: "done", createdAt: "2026-11-06T02:00:00Z" },
    ]);
    expect(data.dismissedChecks).toEqual([{ key: "stopped:linkway", title: "Linkway lights has stopped reporting.", reason: "Renovation" }]);
    // Older servers send none of it, and the readings then carry none of it.
    const older = assemble({ name: "Riverside", calendar: null });
    expect("feedbackMemory" in older || "followUps" in older || "dismissedChecks" in older).toBe(false);
  });
});

// "Show the readings": the chart behind each point to check that names a meter or a day.
describe("the readings behind each point to check", () => {
  const stoppedCheck = () => review.checks.find(check => check.key === "stopped:linkway")!;

  it("carries the named meter's readings day by day and hour by hour, with no readings once it stopped", () => {
    const readings = stoppedCheck().readings!;
    expect(readings.name).toBe("Linkway lights");
    expect(readings.focus).toBeNull();
    expect(readings.band).toEqual({ from: 19, to: 7 });
    expect(readings.days.map(day => day.date)).toEqual(DATES);
    expect(readings.days[0]).toMatchObject({ date: "2026-11-02", label: "Mon 2 Nov" });
    expect(readings.days[0]!.kwh).toBeCloseTo(1.8, 6);
    // It stopped on the evening of 4 Nov: nothing at all from the 5th.
    expect(readings.days.filter(day => day.date >= "2026-11-05").every(day => day.kwh === null)).toBe(true);
    expect(readings.hours["2026-11-03"]).toHaveLength(24);
    expect(readings.hours["2026-11-03"]![20]).toBeCloseTo(0.15, 6);
    expect(readings.hours["2026-11-05"]!.every(value => value === null)).toBe(true);
    expect(readings.usualKwh).toBeCloseTo(1.8, 6);
  });

  it("charts a day that stood out from the meter behind it, with that day picked out", () => {
    const now = new Date("2026-11-26T04:00:00Z");
    const sample = buildEnergyReview(sampleSiteAnalysisData(now), null, now.toISOString());
    const standout = sample.checks.find(check => check.key === "standout:2026-11-16")!;
    expect(standout.readings).toMatchObject({ name: "Block 102 L7–L12 corridors", focus: "2026-11-16" });
    const day = standout.readings!.days.find(item => item.date === "2026-11-16")!;
    expect(day.kwh!).toBeGreaterThan(standout.readings!.usualKwh! * 1.3);
    // The chart's usual day is the one the sentence gives.
    expect(standout.text).toContain(`usually use ${standout.readings!.usualKwh!.toFixed(2)} kWh`);
    // Points that name no meter carry none.
    for (const check of [...sample.checks, ...review.checks]) if (check.key === "daytime") expect(check.readings).toBeUndefined();
  });

  it("opens in the card on the live page: figures, a readout on pointing, and a click opens the day hour by hour", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("React", React);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<EnergyReviewDocument review={review} />));
      const card = () => host.querySelectorAll("#er-checks .er-checks > li")[review.checks.indexOf(stoppedCheck())] as HTMLElement;
      expect(card().querySelector(".er-rd")).toBeNull();
      const toggle = card().querySelector<HTMLButtonElement>("button.er-rd-toggle")!;
      expect(toggle.textContent).toBe("Show the readings");
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      await act(async () => toggle.click());
      expect(card().classList.contains("er-open")).toBe(true);
      expect(toggle.textContent).toBe("Hide the readings");
      const chart = card().querySelector(".er-rd")!;
      expect(chart.querySelector(".er-fig-title")!.textContent).toBe("Linkway lights");
      expect([...chart.querySelectorAll(".er-rd-figs small")].map(item => item.textContent)).toEqual(["Total", "Cost (incl. GST)", "Usual day", "Days in use"]);
      expect(chart.querySelector('svg[aria-label="Energy each day for Linkway lights"]')).not.toBeNull();
      // The days after it stopped show as having no readings.
      expect(chart.querySelectorAll("svg circle").length).toBe(DATES.filter(date => date >= "2026-11-05").length);

      const bars = () => [...chart.querySelectorAll<SVGRectElement>("svg rect.er-hit")];
      expect(bars()).toHaveLength(DATES.length);
      await act(async () => { bars()[1]!.dispatchEvent(new PointerEvent("pointerover", { bubbles: true })); });
      const tip = chart.querySelector(".er-tip")!;
      expect(tip.querySelector("b")!.textContent).toBe("Tue 3 Nov");
      expect(tip.textContent).toContain("1.80 kWh");
      expect(tip.textContent).toContain("In use7 pm – 7 am");
      expect(tip.textContent).toContain("Click for the day hour by hour");
      await act(async () => { bars()[5]!.dispatchEvent(new PointerEvent("pointerover", { bubbles: true })); });
      expect(chart.querySelector(".er-tip")!.textContent).toContain("No readings");

      await act(async () => bars()[1]!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
      expect(chart.querySelector('svg[aria-label="Energy each hour for Linkway lights on Tue 3 Nov"]')).not.toBeNull();
      expect(bars()).toHaveLength(24);
      expect(chart.querySelectorAll("svg rect.er-rd-band")).toHaveLength(12);
      expect([...chart.querySelectorAll(".er-rd-figs small")].map(item => item.textContent)).toEqual(["Total", "Cost (incl. GST)", "Busiest hour", "In use"]);
      expect(chart.textContent).toContain("Lights-on hours (7 pm – 7 am)");
      await act(async () => { bars()[21]!.dispatchEvent(new PointerEvent("pointerover", { bubbles: true })); });
      expect(chart.querySelector(".er-tip")!.textContent).toContain("Lights-on hoursYes");
      await act(async () => [...chart.querySelectorAll<HTMLButtonElement>("button.er-rd-back")][0]!.click());
      expect(chart.querySelector('svg[aria-label="Energy each day for Linkway lights"]')).not.toBeNull();

      await act(async () => toggle.click());
      expect(card().querySelector(".er-rd")).toBeNull();
      expect(card().classList.contains("er-open")).toBe(false);
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  });

  it("prints open in a saved copy, month view, with each bar's figures and no moving parts", () => {
    const html = renderEnergyReviewMarkup(review);
    expect(html).toContain('class="er-rd"');
    expect(html).toContain('aria-label="Energy each day for Linkway lights"');
    expect(html).toContain("<title>Tue 3 Nov · 1.80 kWh</title>");
    expect(html).not.toContain("Show the readings");
    expect(html).not.toContain("er-hit");
    expect(plain(html)).not.toMatch(/undefined|NaN|\{\w+\}/);
  });

  it("reads in Chinese and Malay, lights-on wording included", async () => {
    for (const locale of ["zh-Hans", "ms"] as const) {
      const html = renderEnergyReviewMarkup(buildEnergyReview(estate(), null, GENERATED, locale));
      expect(html).toContain('class="er-rd"');
      expect(plain(html)).not.toMatch(/undefined|NaN|\{\w+\}|readings\./);
    }
  });
});

