/** @vitest-environment happy-dom */
/**
 * The energy review: the site report written as answers to the questions the site asked at installation. An estate
 * with two alike blocks and a common area, lights on 19:00–07:00, two weeks of readings. One common-area meter stops
 * reporting, one is powered with its lights, and the pavilion fan is used on a single evening. All names are made up.
 */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { buildEnergyReview, type AnalysisData, type ScopeMeter, type TrendSeries } from "@datafoundry/site-report";
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
 * and the site's own meter list names the meters without readings.
 */
function estate(extra: Partial<AnalysisData> = {}, options: { meters?: Record<string, Meter>; byArea?: boolean } = {}): AnalysisData {
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
    previous: null, history: null, circuits: [], holidays: new Map(), openingHours: NIGHTS, actions: [], hoursMeaning: "lights_on",
    groups: { list: GROUPS, meters: keys.map(id => ({ id, name: table[id]!.name, groupId: table[id]!.group, kwh: periodKwh(id, table) })) },
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
      "Total energy and cost", "Block A, Block B and Common area", "Largest circuit in each group", "Block A against Block B",
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

  it("names the largest circuit in each group, once for a circuit that leads in both blocks", () => {
    expect(review.largest!.blocks.map(block => [block.name, block.slices[0]!.name])).toEqual([["Block A", "L7-L12 corridors"], ["Block B", "L7-L12 corridors"], ["Common area", "Driveway lamp"]]);
    expect(review.summary.answers[2]!.answer).toMatch(/^L7-L12 corridors \(\d+% of Block A and \d+% of Block B\) and Driveway lamp \(\d+% of Common area\)\.$/);
  });

  it("compares the blocks circuit for circuit and says what only the larger one has", () => {
    const comparison = review.comparison!;
    expect(comparison.heading).toBe("Block A against Block B");
    expect(comparison.rows.map(row => row.name)).toEqual(["L7-L12 corridors", "lift lobby", "L1-L6 corridors", "emergency lights"].map(name => expect.stringMatching(new RegExp(name, "i"))));
    expect(comparison.callout).toContain("Block A's larger total comes mainly from Riverside gate lighting");
    expect(review.summary.answers[3]!.answer).toContain("Block A is higher overall because of Riverside gate lighting.");
  });

  it("stacks the average day by kind, the always-on emergency lights at the bottom, and says when the lights run", () => {
    const profile = review.profile!;
    expect(profile.layers[0]!.name).toBe("Emergency lights");
    expect(profile.layers.map(layer => layer.name)).toEqual(expect.arrayContaining(["Block lighting", "Ground floor", "Common area"]));
    expect(profile.intro).toContain("Lights switch on at about 7 pm and off at about 7 am.");
    expect(profile.intro).toContain("mostly emergency lights");
    expect(review.summary.answers[4]!.answer).toMatch(/^Lights on from about 7 pm to 7 am, peaking near \d\.\d kW\. 2 items need checking \(section 5\)\.$/);
  });

  it("lists what to check on site: a meter that stopped and one powered with its lights", () => {
    expect(review.checks.map(check => check.title)).toEqual(["Linkway lights has stopped reporting.", "Shelter lights is powered with its lights."]);
    expect(review.checks[0]!.text).toContain("No readings since 4 Nov, 6 pm");
    expect(review.checks[1]!.text).toContain("It reports from about 7 pm to 7 am");
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
    expect(titles).toContain("Fine-tune light timers and photocells");
    const dimming = review.savings!.rows[0]!;
    expect(dimming.basis).toBe("About 30% of block lighting");
    expect(dimming.costYear).toBeCloseTo(dimming.kwhYear * 0.3 * 1.09, 9);
    expect(review.savings!.intro).toMatch(/worth about \*\*S\$[\d,]+\*\* a year incl\. GST and [\d.]+ tonnes of CO₂\./);
    expect(review.nextSteps.map(step => step.action)).toEqual([
      "Check Linkway lights: breaker, meter power, gateway pairing and fittings",
      "Give Shelter lights an always-on supply",
      "Send the number of light fittings per circuit",
      `Trial: ${titles[0]}`,
      "Review the next full month of readings and confirm the projections",
    ]);
    expect(review.nextSteps[2]!.who).toBe("Riverside");
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
    expect(page).toContain("Question 8 Energy-saving projection");
    expect(page).toContain("Recommended next steps");
  });

  it("is what the server saves for the energy review style, except a one-day report, which stays the management review", () => {
    expect(plain(renderStyledSiteReportHtml("review", estate(), null, GENERATED))).toContain("Answers at a glance");
    const day = DATES[5]!;
    const oneDay = estate();
    oneDay.current.project.dates = [day];
    for (const item of [oneDay.current.project.total!, ...oneDay.current.project.meters.map(meter => meter.series!)]) item.cells = item.cells.filter(cell => cell[0] === day);
    const page = plain(renderStyledSiteReportHtml("review", oneDay, null, GENERATED));
    expect(page).not.toContain("Answers at a glance");
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
    expect(live.checks.map(check => check.title)).toEqual(["Linkway lights has stopped reporting.", "Shelter lights is powered with its lights."]);
    expect(live.littleUse!.heading).toBe("Pavilion fan");
    expect(live.savings!.rows[0]!.title).toBe("Motion-sensor dimming on block lighting, or start the night step-down earlier");
    expect(live.summary.intro).toContain("Block lighting is the largest single load");
    expect(live.perLight!.text).toContain("For the other circuits we need the number of fittings");
  });

  it("says two groups that use the same are about the same, and a circuit twice another's is twice", () => {
    const even: Record<string, Meter> = { ...METERS, "a-gate": { ...METERS["a-gate"]!, group: "common" },
      "b-lobby": { ...METERS["b-lobby"]!, kwh: lit(3.6) }, "b-high": { ...METERS["b-high"]!, kwh: lit(8) }, "b-low": { ...METERS["b-low"]!, kwh: lit(3.4, 0.01) },
      "b-deco": { name: "Block B decorative light", group: "b-gf", kwh: lit(0.15) }, "a-deco": { name: "Block A decorative light", group: "a-gf", kwh: lit(0.3) } };
    const built = buildEnergyReview(estate({}, { meters: even }), null, GENERATED);
    expect(built.groups!.intro).toMatch(/^Block A and Block B use about the same, \d+% of the energy each\. Then Common area \d+%\.$/);
    expect(built.comparison!.intro).toContain("Block A's decorative light uses twice as much as Block B's");
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
      expect(nav).toEqual(["Summary", "1Total use", "2By group", "3Largest circuits", "4Like for like", "5" + "24 hours", "Checks", "6Little use", "7Per light", "8Savings", "Method"]);

      // A figure and an answer at a glance each take the reader to their section, without changing the address.
      await click(host.querySelector('.er-glance a[href="#er-q-savings"]'));
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
