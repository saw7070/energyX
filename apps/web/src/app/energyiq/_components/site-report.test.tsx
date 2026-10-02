/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { serializeSiteReportSnapshot, type SiteReportSnapshot } from "@datafoundry/site-report";
import type { AnalysisData, ScopeData, TrendSeries } from "./analysis-data";
import { buildSiteReport } from "./site-report-model";
import { monotonePath, niceTicks, plainNames, plainTimes, Rich, SiteReportDocument, SiteReportPanel, standaloneReportHtml, useSiteReport } from "./site-report";

const mock = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("./analysis-data", async importOriginal => ({ ...(await importOriginal<typeof import("./analysis-data")>()), loadAnalysis: mock.load }));
import { configApi } from "../../../lib/config-api";

const DATES = Array.from({ length: 14 }, (_, index) => new Date(Date.parse("2026-08-03T00:00:00Z") + index * 86_400_000).toISOString().slice(0, 10));
const open = (date: string, hour: number) => ![0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay()) && hour >= 9 && hour < 18;
const series = (id: string, kwh: (date: string, hour: number) => number): TrendSeries => ({ id, expectedMinutesPerHour: 60, cells: DATES.flatMap(date => Array.from({ length: 24 }, (_, hour) => [date, hour, kwh(date, hour), 60, 0] as TrendSeries["cells"][number])) });
const light = (date: string, hour: number) => open(date, hour) ? (hour === 12 ? 1.2 : 2) : 0.05;
const power = (date: string, hour: number) => open(date, hour) ? 1.95 : 1.9;
const scope: ScopeData = {
  id: "project", name: "Harbour Office", dates: DATES, timezone: "Asia/Singapore", total: series("__scope__", (date, hour) => light(date, hour) + power(date, hour)), types: {},
  meters: [{ id: "light", name: "DB1 Light", location: "DB1", category: "light", official: true, series: series("light", light) }, { id: "power", name: "DB1 Power", location: "DB1", category: "load", official: true, series: series("power", power) }],
  usageKwh: 1000, peakKw: null, peakAt: null, cost: { amount: 300, currency: "SGD", note: "0.3 SGD/kWh before tax" }, typeTotals: {}, coverage: 100,
};
const data: AnalysisData = { projectId: "p", projectName: "Harbour Office", timezone: "Asia/Singapore", snapshotId: null, current: { project: scope, spaces: [] }, previous: null, history: null, circuits: [],
  holidays: new Map(), openingHours: Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday"].map(day => [day, [{ from: "09:00", to: "18:00" }]])), actions: [] };

describe("site report page", () => {
  it("renders the reference report's five sections with charts, tables and the callout", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("React", React);
    const report = buildSiteReport(data, null, "2026-09-22T10:00:00Z");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<SiteReportDocument report={report} />));
      const text = host.textContent ?? "";
      expect(host.querySelector("h1")?.textContent).toBe(`${report.title.before}${report.title.emphasis}`);
      expect(host.querySelector("h1 span")?.textContent).toBe(report.title.emphasis);
      expect([...host.querySelectorAll("h2")].map(heading => heading.textContent)).toEqual(["About the site and its meters", "A 30-day month: estimated use and bill", "A normal weekday, a weekend, and what never switches off", "A normal weekday, hour by hour", "Meters doing something unusual"]);
      expect(host.querySelectorAll(".keyfigs > div")).toHaveLength(4);
      expect(host.querySelectorAll("svg.donut")).toHaveLength(2);
      expect(host.querySelector('svg[aria-label^="Daily electricity use"]')).not.toBeNull();
      expect(host.querySelector('svg[aria-label^="Average weekday use by hour"]')).not.toBeNull();
      expect(text).toContain("Why use drops at lunch:");
      expect(text).toContain("What this means:");
      expect(host.querySelector("tr.total")?.textContent).toContain("Office total");
      // Without a floor layout, zones are listed in a table instead of the map.
      expect(host.querySelector("svg.plan")).toBeNull();
      expect(text).toContain("Est. kWh per 30 days");

      const html = standaloneReportHtml(host.querySelector("article")!, report);
      expect(html).toMatch(/^<!DOCTYPE html>/);
      expect(html).toContain("<title>Harbour Office Energy Report · 3–16 Aug 2026</title>");
      expect(html).toContain(".eiq-report{");
      expect(html).not.toMatch(/<script|https?:\/\/(?!www\.w3\.org)/);
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
    }
  });

  it("bolds marked phrases only", async () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("React", React);
    await act(async () => root.render(<p><Rich text="Uses **2.8 kW** at night and **75%** overall." /></p>));
    expect([...host.querySelectorAll("strong")].map(item => item.textContent)).toEqual(["2.8 kW", "75%"]);
    expect(host.textContent).toBe("Uses 2.8 kW at night and 75% overall.");
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  });
});

describe("plain wording on the Overview cards", () => {
  it("swaps panel codes for everyday names and 24-hour times for am/pm", () => {
    const report = buildSiteReport(data, null, "2026-09-22T10:00:00Z");
    const names = plainNames(report);
    expect(report.circuits.map(circuit => [circuit.code, circuit.name])).toEqual(expect.arrayContaining([["DB1 Light", "Lights"], ["DB1 Power", "Equipment & sockets"]]));
    expect(names("DB1 Light used 26.98 kWh after 20:00")).toBe("Lights used 26.98 kWh after 20:00");
    expect(names("Check a rule for DB1 Light.")).toBe("Check a rule for lights.");
    expect(plainTimes("Check a 20:00 rule for 09:00–18:00 blocks")).toBe("Check an 8 pm rule for 9 am–6 pm blocks");
    expect(plainNames(null)("DB1 Light")).toBe("DB1 Light");
  });
});

describe("chart helpers", () => {
  it("picks round axis steps that cover the maximum", () => {
    expect(niceTicks(112)).toEqual([0, 25, 50, 75, 100, 125]);
    expect(niceTicks(7.3)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(0)).toEqual([0, 1]);
  });
  it("draws a smooth line that stays flat where the data is flat", () => {
    const path = monotonePath([[0, 10], [10, 10], [20, 0], [30, 0]]);
    expect(path.startsWith("M0.0,10.0C")).toBe(true);
    // Flat segments keep flat control points, so the curve never dips below or above the readings.
    expect(path).toContain("C3.3,10.0 6.7,10.0 10.0,10.0");
    expect(path).toContain("C23.3,0.0 26.7,0.0 30.0,0.0");
  });
});

/**
 * What the Overview puts on screen. The report the server saved is the one everybody sees, so the page asks the
 * Reports library for it and rebuilds it from the readings kept with it. A site that has never had one saved still
 * gets a report, built here from the latest readings, and the page says so.
 */
describe("the report the Overview shows", () => {
  const SAVED: SiteReportSnapshot = {
    schemaVersion: 1, projectId: "p", cadence: "monthly", period: { from: DATES[0]!, toExclusive: "2026-08-17" },
    generatedAt: "2026-09-22T10:00:00Z", language: "en", reference: null, historyOmitted: true, data,
  };
  const stored = serializeSiteReportSnapshot(SAVED);
  /** The Overview's own use of the report: one headline and one document, both from whatever the hook found. */
  function Overview() {
    const site = useSiteReport("p", null);
    const report = site.state && "report" in site.state ? site.state.report : null;
    return <>
      <h1>{report ? `${report.title.before}${report.title.emphasis}` : "…"}</h1>
      <p data-saved>{site.saved ? `${site.saved.reportId} ${site.saved.cadence} ${site.saved.period.from}→${site.saved.period.toExclusive}` : "none"}</p>
      <p data-newer>{String(site.newerReadings)}</p>
      <SiteReportPanel state={site.state} onRetry={() => undefined} saved={site.saved} />
    </>;
  }
  async function overview() {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("React", React);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<Overview />));
    for (let tick = 0; tick < 4; tick += 1) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    return { host, text: () => host.textContent ?? "", unmount: async () => { await act(async () => root.unmount()); host.remove(); } };
  }
  afterEach(() => { mock.load.mockReset(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("shows the newest saved report for the project's cadence, and says when it was saved", async () => {
    const library = vi.spyOn(configApi, "reportLibraryRequest").mockImplementation(async (_projectId: string, action = "") =>
      (action ? { snapshot: stored } : {
        // Newest first, as the server lists them: the weekly one is newer, but this project's Overview is monthly.
        reports: [{ id: "advisor-1", source: "advisor" }, { id: "site-weekly", source: "site", cadence: "weekly" }, { id: "site-monthly", source: "site", cadence: "monthly" }],
        overviewCadence: "monthly",
      }) as never);
    // Readings now run past the dates the saved report covers, so the page must say so.
    const agent = vi.spyOn(configApi, "reportAgentRequest").mockResolvedValue({ periodOptions: { availablePeriod: { from: DATES[0], toExclusive: "2026-09-01" } } });
    const page = await overview();
    try {
      expect(page.host.querySelector("[data-saved]")?.textContent).toBe("site-monthly monthly 2026-08-03→2026-08-17");
      expect(page.host.querySelector("h1")?.textContent).toBe("Two-thirds of the office's electricity use never switches off");
      // The document under the heading is the same saved report, and the page says where it lives.
      expect(page.host.querySelector('section[aria-label="Energy report"] h2')?.textContent).toBe("The full report");
      expect(page.text()).toContain("3–16 Aug 2026");
      expect(page.text()).toContain("Saved on 22 Sep 2026 and kept in Reports");
      expect(page.text()).not.toContain("No report has been saved for this site yet");
      expect(page.host.querySelector("[data-newer]")?.textContent).toBe("true");
      // The readings came from the saved report, not from the engine.
      expect(mock.load).not.toHaveBeenCalled();
      expect(library).toHaveBeenCalledWith("p", "snapshot/site-monthly");
      expect(agent).toHaveBeenCalledTimes(1);
    } finally { await page.unmount(); }
  });

  it("builds the report here when nothing has been saved yet, and says it is not in Reports", async () => {
    vi.spyOn(configApi, "reportLibraryRequest").mockResolvedValue({ reports: [{ id: "advisor-1", source: "advisor" }] });
    const agent = vi.spyOn(configApi, "reportAgentRequest").mockResolvedValue({ settings: { contextNotes: "" } });
    mock.load.mockResolvedValue(data);
    const page = await overview();
    try {
      expect(page.host.querySelector("[data-saved]")?.textContent).toBe("none");
      expect(page.host.querySelector("h1")?.textContent).toBe("Two-thirds of the office's electricity use never switches off");
      expect(page.text()).toContain("No report has been saved for this site yet");
      expect(page.text()).not.toContain("kept in Reports");
      // Nothing to be newer than: the report was just built from the latest readings.
      expect(page.host.querySelector("[data-newer]")?.textContent).toBe("false");
      expect(mock.load).toHaveBeenCalledTimes(1);
      expect(agent).toHaveBeenCalledTimes(1);
    } finally { await page.unmount(); }
  });

  it("falls back to building the report when the saved one cannot be read", async () => {
    vi.spyOn(configApi, "reportLibraryRequest").mockImplementation(async (_projectId: string, action = "") => {
      if (action) throw new Error("REPORT_NOT_FOUND");
      return { reports: [{ id: "site-monthly", source: "site", cadence: "monthly" }], overviewCadence: "monthly" } as never;
    });
    vi.spyOn(configApi, "reportAgentRequest").mockResolvedValue({ settings: { contextNotes: "" } });
    mock.load.mockResolvedValue(data);
    const page = await overview();
    try {
      expect(page.host.querySelector("[data-saved]")?.textContent).toBe("none");
      expect(page.host.querySelector("h1")?.textContent).toBe("Two-thirds of the office's electricity use never switches off");
      expect(page.text()).toContain("No report has been saved for this site yet");
    } finally { await page.unmount(); }
  });
});
