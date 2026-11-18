/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnalysisData, ScopeData, TrendCell } from "./analysis-data";

// The Analysis page is one flowing story: the short version, then each numbered step with its own figures under it.
// These tests check that nothing the old "Detailed analysis" block showed was lost, that nothing is shown twice, and
// that every link into the page still lands on a section.
const mock = vi.hoisted(() => ({ load: vi.fn(), params: "", noReport: false }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(mock.params) }));
vi.mock("./analysis-data", async importOriginal => ({ ...(await importOriginal<typeof import("./analysis-data")>()), loadAnalysis: mock.load }));
// Without the site report the story has no "Days that stood out" step; one test takes the report away.
vi.mock("@datafoundry/site-report", async importOriginal => {
  const actual = await importOriginal<typeof import("@datafoundry/site-report")>();
  return { ...actual, buildSiteReport: (...args: Parameters<typeof actual.buildSiteReport>) => { if (mock.noReport) throw new Error("no report"); return actual.buildSiteReport(...args); } };
});

import { AnalysisView, analysisLinkTarget } from "./analysis-view";
import { analysisHref } from "./key-points";
import { DATA as ESTATE } from "./standout-days.test-fixture";

// One week (Mon 10 – Sun 16 Aug): 2 kW always on, 6 kW while open 09:00–18:00, and a 1 kW TV left on day and night.
const dates = ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15", "2026-08-16"];
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() % 6 !== 0;
const series = (id: string, kwhAt: (date: string, hour: number) => number) => ({ id, expectedMinutesPerHour: 60, cells: dates.flatMap(date => Array.from({ length: 24 }, (_, hour) => [date, hour, kwhAt(date, hour), 60, 0] as TrendCell)) });
const siteKwh = (date: string, hour: number) => weekday(date) && hour >= 9 && hour < 18 ? 6 : 2;
const scope = (id: string, name: string, extra: Partial<ScopeData> = {}): ScopeData => ({
  id, name, dates, timezone: "Asia/Singapore", total: series("__scope__", siteKwh), types: { load: series("__category__:load", siteKwh) }, meters: [],
  usageKwh: 0, peakKw: 6, peakAt: null, cost: null, typeTotals: { load: 0 }, coverage: 100, ...extra,
});
const usage = 516; // 5 weekdays × (9 h × 6 + 15 h × 2) + 2 weekend days × 24 h × 2
const project = scope("project", "Office", { usageKwh: usage, typeTotals: { load: usage }, cost: { amount: usage * 0.3, currency: "SGD", note: "0.3 SGD/kWh" } });
const space = scope("l1", "Level 1", { usageKwh: usage, typeTotals: { load: usage }, meters: [
  { id: "db", name: "DB1 Power", location: "Level 1", category: "load", official: true, series: series("db", siteKwh) },
  { id: "tv", name: "Lobby TV", location: "Level 1", category: "load", official: false, series: series("tv", () => 1) },
] });
const hours = { from: "09:00", to: "18:00" };
const data: AnalysisData = {
  projectId: "office", projectName: "Office", timezone: "Asia/Singapore", snapshotId: "snap", current: { project, spaces: [space] }, previous: null, history: null,
  circuits: [
    { id: "db", name: "DB1 Power", location: "Level 1", category: "load", kwh: 400, previousKwh: null },
    { id: "tv", name: "Lobby TV", location: "Level 1", category: "load", kwh: 168, previousKwh: null },
  ],
  holidays: new Map(), openingHours: { monday: [hours], tuesday: [hours], wednesday: [hours], thursday: [hours], friday: [hours] }, actions: [],
};

// Two locations, and Wednesday 12 Aug at twice a normal weekday: one unusual weekday.
const SPIKE = "2026-08-12";
const spiked = (date: string, hour: number) => siteKwh(date, hour) * (date === SPIKE ? 2 : 1);
const spikedUsage = usage + 84;
const twoLevels: AnalysisData = {
  ...data, circuits: [],
  current: {
    project: scope("project", "Office", { total: series("__scope__", spiked), types: { load: series("__category__:load", spiked) }, usageKwh: spikedUsage, typeTotals: { load: spikedUsage }, cost: { amount: spikedUsage * 0.3, currency: "SGD", note: "0.3 SGD/kWh" } }),
    spaces: [scope("l1", "Level 1", { usageKwh: 360, typeTotals: { load: 360 } }), scope("l2", "Level 2", { usageKwh: 240, typeTotals: { load: 240 } })],
  },
};

afterEach(() => { mock.params = ""; mock.noReport = false; mock.load.mockReset(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function render(input: AnalysisData = data) {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // Charts have no size in this test DOM; the forecast's policies are not served, so its step stays on "working out".
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mock.load.mockResolvedValue(input);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<AnalysisView projectId="office" />));
  await act(async () => { await Promise.resolve(); });
  const click = async (element: Element | null | undefined) => { expect(element).toBeTruthy(); await act(async () => (element as HTMLElement).click()); };
  const button = (label: string) => [...host.querySelectorAll("button")].find(item => item.textContent === label);
  return { host, click, button, text: () => (host.textContent ?? "").replace(/\s+/g, " "), unmount: async () => { await act(async () => root.unmount()); host.remove(); } };
}
/** How many charts or tables carry this title (the "How this is calculated" titles, or a plain heading). */
const titled = (host: HTMLElement, title: string) => [...host.querySelectorAll('button[title="How this is calculated"], h3')].filter(item => item.textContent === title && !item.querySelector('button[title="How this is calculated"]')).length;
const STEPS = ["story-money", "story-on", "story-when", "story-days", "story-plan", "story-health", "story-ahead"];

describe("Analysis as one flowing page", () => {
  it("has no separate detailed analysis: each step's figures sit under it, closed until asked for", async () => {
    const page = await render();
    expect([...page.host.querySelectorAll("section[id^='story-']")].map(item => item.id)).toEqual([...STEPS, "story-about"]);
    expect(page.host.querySelector("#details")).toBeNull();
    expect(page.text()).not.toMatch(/Detailed analysis|The figures behind the summary|Executive Summary|Summary of Findings|Expand All Sections/);
    // Steps 1, 3 and 4 have figures; each toggle starts closed, with its region empty.
    const toggles = [...page.host.querySelectorAll<HTMLButtonElement>("button[aria-controls$='-figures']")];
    expect(toggles.map(item => item.getAttribute("aria-controls"))).toEqual(["story-money-figures", "story-when-figures", "story-days-figures"]);
    for (const toggle of toggles) {
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(toggle.textContent).toBe("Show the figures");
      const region = page.host.querySelector<HTMLElement>(`#${toggle.getAttribute("aria-controls")}`)!;
      expect(region.hidden).toBe(true);
      expect(region.childElementCount).toBe(0);
      // The region belongs to its own step.
      expect(region.closest("section[id^='story-']")?.id).toBe(toggle.getAttribute("aria-controls")!.replace("-figures", ""));
    }
    // Each toggle names what it holds, so the reader knows before opening it.
    expect(toggles[0]!.parentElement!.textContent).toContain("Key Highlights, Daily use breakdown, Share of the energy, Energy flow: site → spaces → uses, Top 10 circuits");

    // One step opens on its own and closes again.
    await page.click(toggles[1]);
    expect(toggles[1]!.getAttribute("aria-expanded")).toBe("true");
    expect(toggles[1]!.textContent).toBe("Hide the figures");
    expect(page.host.querySelector<HTMLElement>("#story-when-figures")!.hidden).toBe(false);
    expect(titled(page.host, "A typical day, hour by hour")).toBe(1);
    expect(toggles[0]!.getAttribute("aria-expanded")).toBe("false");
    await page.click(toggles[1]);
    expect(page.host.querySelector("#story-when-figures")!.childElementCount).toBe(0);
    await page.unmount();
  });

  it("keeps every chart, table and figure the detailed analysis had, each shown once", async () => {
    const page = await render();
    await page.click(page.button("Show all figures"));
    expect(page.button("Hide all figures")).toBeTruthy();
    const inStep = (id: string, title: string) => [...page.host.querySelectorAll(`#${id}-figures :is(button[title="How this is calculated"], h3)`)].some(item => item.textContent === title);
    // Step 1: totals and cost, the daily split, the split by type, the flow from site to spaces, the biggest circuits.
    for (const title of ["Key Highlights", "Daily use breakdown", "Share of the energy", "Top 10 circuits"]) expect(inStep("story-money", title), title).toBe(true);
    expect(inStep("story-money", "Energy flow: site → spaces → uses")).toBe(true);
    for (const card of ["Total use", "Daily Average", "Busiest hour", "Estimated Cost"]) expect(page.host.querySelector("#story-money-figures")!.textContent).toContain(card);
    expect([...page.host.querySelectorAll("#story-money-figures table th")].map(cell => cell.textContent)).toContain("vs top 10 average");
    // Step 3: each kind of day hour by hour, by location, and use in and out of hours.
    for (const title of ["A typical day, hour by hour", "Hour-by-hour use by location", "Daily use at a glance"]) expect(inStep("story-when", title), title).toBe(true);
    // Step 4: every day against a usual day, the unusual days, and the busiest day the old written summary named.
    for (const title of ["Daily Total Trend", "Unusual days"]) expect(inStep("story-days", title), title).toBe(true);
    // No day stood out here: step 4 says so once, and the chart's day-by-day list stays away rather than say it again.
    expect(page.host.querySelector("#story-days")!.textContent!.match(/No day stood out/g)).toHaveLength(1);
    expect(inStep("story-days", "Each day, meter by meter")).toBe(false);
    expect(page.host.querySelector("#story-days-figures")!.textContent).toContain("Busiest day: Mon 10 Aug, 84 kWh.");
    // About these figures: where the numbers come from, and the full report.
    const about = page.host.querySelector("#story-about")!;
    expect(about.textContent).toContain("Based on the latest readings for Office · Level 1");
    expect(about.textContent).toContain("100.0% of readings received");
    expect(about.querySelector("a[href*='/energyiq/reports?']")?.textContent).toBe("Generate Full Report");

    // Nothing appears twice.
    for (const title of ["Key Highlights", "Daily use breakdown", "Share of the energy", "Energy flow: site → spaces → uses", "Top 10 circuits", "A typical day, hour by hour", "Hour-by-hour use by location", "Daily use at a glance", "Daily Total Trend", "Unusual days"]) expect(titled(page.host, title), title).toBe(1);
    // The averages per kind of day are in Daily patterns once, not again in "Daily use at a glance".
    expect(page.text().match(/Weekday average/g)?.length).toBe(2); // Daily patterns' tile and step 3's chart button
    expect(page.text()).not.toContain("Weekday daily average");
    // The flow chart keeps its takeaway: here it names a space and a share step 1 does not give.
    expect(page.host.querySelector("#story-money")!.textContent).toContain("DB1 Power accounts for 70% of the bill, and power load is the largest type of use.");
    expect(page.text().match(/Level 1 uses 100% of the site's electricity\. Across the site, Power Load is the biggest use \(100%\)\./g)).toHaveLength(1);
    // The same charts as before: the daily chart, the daily split, the split by type, the flow, a typical day and step 3's hours.
    expect(page.host.querySelectorAll(".recharts-responsive-container").length).toBe(6);

    await page.click(page.button("Hide all figures"));
    for (const id of ["story-money", "story-when", "story-days"]) expect(page.host.querySelector(`#${id}-figures`)!.childElementCount).toBe(0);
    await page.unmount();
  });

  it("keeps the week of the best night-time level that the old written summary gave", async () => {
    // Two weeks of readings give a best week to compare with.
    const page = await render(ESTATE);
    await page.click(page.host.querySelector("button[aria-controls='story-when-figures']"));
    expect(page.host.querySelector("#story-when-figures")!.textContent).toMatch(/Night-time use: this week vs your best week[\d.]+ kW vs [\d.]+ kW \(week to \d{1,2} Nov\)/);
    await page.unmount();
  });

  it("keeps the facts the old written summary gave: biggest location against the next, the flow's takeaway once, and unusual days by kind", async () => {
    const page = await render(twoLevels);
    await page.click(page.button("Show all figures"));
    const money = page.host.querySelector<HTMLElement>("#story-money")!;
    // Level 1 used 360 of 600 kWh, 1.5 times Level 2's 240.
    expect(money.querySelector("#story-money-figures")!.textContent).toContain("Biggest location: Level 1, 360 kWh (60% of total), about 1.5 times Level 2 (240 kWh).");
    // Step 1 already says Level 1 accounts for 60%; the flow chart says only what it adds, the type's share.
    expect(money.textContent).toContain("Level 1 accounts for 60% of the bill");
    expect(money.textContent).not.toContain("Level 1 uses 60% of the site's electricity.");
    expect(money.textContent).toContain("Across the site, Power Load is the biggest use (100%).");
    // The unusual-day line gives every kind of day at the chosen location, whichever kind the chart shows.
    const days = page.host.querySelector<HTMLElement>("#story-days-figures")!;
    expect(days.textContent).toContain("Unusual days: 1 of 5 complete weekday days · all kinds of day: 1 weekday, 0 weekend");
    await page.click([...days.querySelectorAll('[role="group"][aria-label="Kind of day"] button')].find(item => item.textContent === "Weekend"));
    expect(days.textContent).toContain("Unusual days: 0 of 2 complete weekend days · all kinds of day: 1 weekday, 0 weekend");
    await page.unmount();
  });

  it("moves the daily chart to About these figures when there is no step for the days that stood out", async () => {
    mock.noReport = true;
    const page = await render();
    expect(page.host.querySelector("#story-days")).toBeNull();
    expect([...page.host.querySelectorAll("nav button")].map(item => item.textContent)).not.toContain("4 · Days that stood out");
    // Nothing to open for it in the steps; the chart is shown at the end, with the list's own heading and rule.
    expect(page.host.querySelector("button[aria-controls='story-days-figures']")).toBeNull();
    const about = page.host.querySelector<HTMLElement>("#story-about")!;
    expect([...about.querySelectorAll('button[title="How this is calculated"]')].map(item => item.textContent)).toEqual(expect.arrayContaining(["Daily Total Trend", "Unusual days"]));
    expect([...about.querySelectorAll("h3")].map(item => item.textContent)).toContain("Days that stood out");
    expect(about.textContent).toContain("A day is called out when");
    await page.unmount();
  });
});

describe("links into the Analysis page", () => {
  it("lands every Overview link and every 'On this page' button on a section that is there", async () => {
    // The Overview's headline opens step 2 or the short version; the forecast line opens step 7.
    const fromOverview = [
      analysisHref("office", null, "About S$655 of the monthly bill pays for equipment that stays on around the clock."),
      analysisHref("office", null, "Energy use rose 12% this month."),
      analysisHref("office", null, "", "daytime"),
      `/energyiq/analysis?${new URLSearchParams({ projectId: "office", section: "story-ahead" })}`,
    ].map(href => analysisLinkTarget(new URL(href, "http://x").searchParams).section);
    expect(fromOverview).toEqual(["story-on", "story-title", "story-on", "story-ahead"]);
    expect(analysisLinkTarget(new URLSearchParams("section=story-about")).section).toBe("story-about");

    const page = await render();
    for (const id of fromOverview) expect(page.host.querySelector(`#${id}`), String(id)).not.toBeNull();
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView ??= function scrollIntoView() { /* not in this test DOM */ };
    vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (this: Element) { scrolled.push(this.id); });
    const nav = [...page.host.querySelectorAll<HTMLButtonElement>("nav button")];
    expect(nav.map(item => item.textContent)).toEqual(["1 · Where the money goes", "2 · What stays on", "3 · When it is used", "4 · Days that stood out", "5 · Savings plan", "6 · Health check", "7 · Next month's forecast", "About these figures"]);
    for (const item of nav) await page.click(item);
    expect(scrolled).toEqual([...STEPS, "story-about"]);
    // The show-all control is not one of the page's places.
    expect(nav.map(item => item.textContent)).not.toContain("Show all figures");
    await page.unmount();
  });

  it("scrolls a link's section into view once the page has loaded", async () => {
    mock.params = "section=story-on";
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView ??= function scrollIntoView() { /* not in this test DOM */ };
    vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (this: Element) { scrolled.push(this.id); });
    const page = await render();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(scrolled).toContain("story-on");
    await page.unmount();
  });
});
