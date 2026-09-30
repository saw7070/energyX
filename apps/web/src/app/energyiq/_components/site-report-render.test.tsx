/** @vitest-environment happy-dom */
/**
 * The report on the page and the report in the saved file must be the same document. The page renders it with React;
 * the saved file is rendered from the report alone (so the server can save one on a schedule, with no browser). This
 * test renders both from one report and compares them, in every language.
 *
 * The two differ only in how they spell an inline style: the browser's own serialiser writes `background: #FF4E16;`
 * where React writes `background:#FF4E16`. Both parse to the same style, so the comparison canonicalises that one
 * spelling and nothing else — every element, attribute and character otherwise has to match exactly.
 */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { ProjectSpatialReference } from "@datafoundry/contracts";
import type { AnalysisData, ScopeData, ScopeMeter, TrendSeries } from "./analysis-data";
import type { EnergyIqLocale } from "./energyiq-messages";
import { buildSiteReport } from "./site-report-model";
import { renderSiteReportHtml, siteReportFileName, SiteReportDocument } from "./site-report";

// The Tuya Office fixture of site-report-model.test.ts: two weeks from Monday 3 Aug 2026, open Monday–Friday 09:00–18:00.
const DATES = Array.from({ length: 14 }, (_, index) => new Date(Date.parse("2026-08-03T00:00:00Z") + index * 86_400_000).toISOString().slice(0, 10));
const weekend = (date: string) => [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
const open = (date: string, hour: number) => !weekend(date) && hour >= 9 && hour < 18;
type Profile = (date: string, hour: number) => number;
const series = (id: string, kwh: Profile): TrendSeries => ({ id, expectedMinutesPerHour: 60, cells: DATES.flatMap(date => Array.from({ length: 24 }, (_, hour) => [date, hour, kwh(date, hour), 60, 0] as TrendSeries["cells"][number])) });
const PROFILES: Record<string, { name: string; board: string; category: ScopeMeter["category"]; kwh: Profile }> = {
  "db1-light": { name: "DB1 L1 Light", board: "DB1", category: "light", kwh: (date, hour) => open(date, hour) ? (hour === 12 || hour === 13 ? 1.4 : 2) : !weekend(date) && (hour === 18 || hour === 19) ? 1.2 : 0.05 },
  "db1-power": { name: "DB1 L1 Power", board: "DB1", category: "load", kwh: (date, hour) => open(date, hour) ? 0.4 : 0.3 },
  "db2-power": { name: "DB2 L2 Power", board: "DB2", category: "load", kwh: (date, hour) => open(date, hour) ? 1.95 : 1.9 },
  "led-1": { name: "LED Display 1", board: "DB3", category: "other", kwh: () => 0.19 },
  "led-2": { name: "LED Display 2", board: "DB3", category: "other", kwh: () => 0.19 },
  "led-3": { name: "LED Display 3", board: "DB3", category: "other", kwh: () => 0.19 },
};
const meter = (id: string): ScopeMeter => ({ id, name: PROFILES[id]!.name, location: PROFILES[id]!.board, category: PROFILES[id]!.category, official: true, series: series(id, PROFILES[id]!.kwh) });
function scope(name: string, ids: string[]): ScopeData {
  const total = series("__scope__", (date, hour) => ids.reduce((sum, id) => sum + PROFILES[id]!.kwh(date, hour), 0));
  const usage = total.cells.reduce((sum, cell) => sum + cell[2]!, 0);
  return { id: name, name, dates: DATES, timezone: "Asia/Singapore", total, types: {}, meters: ids.map(meter), usageKwh: usage, peakKw: null, peakAt: null,
    cost: { amount: usage * 0.3, currency: "SGD", note: "0.3 SGD/kWh before tax" }, typeTotals: {}, coverage: 100 };
}
const IDS = Object.keys(PROFILES);
const DATA: AnalysisData = {
  projectId: "tuya-office", projectName: "Tuya Office", timezone: "Asia/Singapore", snapshotId: null,
  current: { project: scope("Tuya Office", IDS), spaces: [scope("Space 1 - Office Area", ["db1-light", "db1-power"]), scope("Space 2 - Shared Area", ["db2-power", "led-1", "led-2", "led-3"])] },
  previous: null, history: null, circuits: [], holidays: new Map(), openingHours: Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday"].map(day => [day, [{ from: "09:00", to: "18:00" }]])), actions: [],
};
const REFERENCE = {
  schemaVersion: 1, projectId: "tuya-office", provenance: { file: "reference.html", status: "reference-derived" },
  property: { address: "6 Battery Road, Singapore", level: 27, occupancyExtent: "half floor", approximateAreaM2: 700 },
  layout: {
    viewBox: [0, 0, 860, 508], entrance: { label: "Main entrance gate", referenceBoard: "DB1", position: [430, 420] }, boardMarkers: { DB1: [478, 330], DB2: [86, 238], DB3: [32, 238] },
    zones: [
      { id: "A", referenceBoard: "DB1", directionFromEntrance: "right", rooms: ["Open office", "Director room"], rect: [470, 20, 366, 396] },
      { id: "B", referenceBoard: "DB2", directionFromEntrance: "left", rooms: ["Showroom", "Pantry"], rect: [24, 20, 366, 396] },
      { id: "C", referenceBoard: "DB3", independentSpace: false, physicalParentRoom: "Showroom", equipment: "Three large LED panels" },
    ],
    rooms: [{ name: "Showroom", zone: "B", rect: [32, 70, 210, 150] }, { name: "Pantry", zone: "B", rect: [250, 70, 132, 70] }, { name: "Open office", zone: "A", rect: [478, 70, 166, 240] }, { name: "Director room", zone: "A", rect: [652, 218, 176, 92] }],
  },
} as unknown as ProjectSpatialReference;
const GENERATED = "2026-09-22T10:00:00Z";

/** `background: #FF4E16;` (the browser's spelling) and `background:#FF4E16` (React's) are the same style. */
const canonicalStyles = (html: string) => html.replace(/style="([^"]*)"/g, (_match, value: string) =>
  `style="${value.split(";").map(part => part.trim()).filter(Boolean).map(part => part.replace(/:\s+/, ":")).join(";")}"`);

/** The document out of the saved file, without the page around it. */
function articleOf(file: string) {
  const start = file.indexOf("<body>\n") + "<body>\n".length;
  return file.slice(start, file.indexOf("\n</body>"));
}

async function onThePage(report: ReturnType<typeof buildSiteReport>) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("React", React);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<SiteReportDocument report={report} />));
  const html = host.querySelector("article")!.outerHTML;
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  return html;
}

/** The saved file's document, read back as the browser would read it, so both sides are serialised the same way. */
function asParsed(markup: string) {
  const host = document.createElement("div");
  host.innerHTML = markup;
  return host.firstElementChild!.outerHTML;
}

describe("the saved report and the report on the page", () => {
  for (const locale of ["en", "zh-Hans", "ms"] as EnergyIqLocale[]) {
    it(`are the same document in ${locale}`, async () => {
      const report = buildSiteReport(DATA, REFERENCE, GENERATED, locale);
      const file = renderSiteReportHtml(report);
      expect(canonicalStyles(asParsed(articleOf(file)))).toBe(canonicalStyles(await onThePage(report)));
    });
  }

  it("wraps the document in a standalone page with no scripts, no hover readouts and the report's own styles", () => {
    const report = buildSiteReport(DATA, REFERENCE, GENERATED, "en");
    const file = renderSiteReportHtml(report);
    expect(file).toMatch(/^<!DOCTYPE html>/);
    expect(file).toContain('<html lang="en">');
    expect(file).toContain("<title>Tuya Office Energy Report · 3–16 Aug 2026</title>");
    expect(file).toContain(".eiq-report{");
    expect(file).not.toContain('class="tip"');
    expect(file).not.toMatch(/<script|https?:\/\/(?!www\.w3\.org)/);
    expect(siteReportFileName(report)).toBe("tuya-office-energy-report-2026-08-03-to-2026-08-16.html");
  });

  it("says a split cannot be worked out rather than printing it as zero", () => {
    // Tuya Office, 20 Sep 2026: the meters were renamed to friendly locations while
    // the floor plan kept DB1/DB2/DB3, so no circuit matched a zone. Every zone kept
    // its shape on the plan and held nothing, and the figure read "0 kWh" — which a
    // reader takes as a site that drew no electricity.
    const report = buildSiteReport(DATA, REFERENCE, GENERATED, "en");
    const emptied = { ...report, zones: report.zones.map(zone => ({ ...zone, monthKwh: 0, circuitKeys: [] })) };
    const file = renderSiteReportHtml(emptied);

    expect(file).toContain("Not enough readings to split this up");
    // The by-load figure is built from the circuits and is unaffected, so the
    // report still carries the numbers it does know.
    expect(file).toContain("By load — estimated 30-day share");
    expect(renderSiteReportHtml(report)).not.toContain("Not enough readings to split this up");
  });

  it("needs nothing but the report: the same report always renders the same file", () => {
    const report = buildSiteReport(DATA, REFERENCE, GENERATED, "en");
    expect(renderSiteReportHtml(report)).toBe(renderSiteReportHtml(buildSiteReport(DATA, REFERENCE, GENERATED, "en")));
  });
});
