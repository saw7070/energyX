/**
 * The site report's floor plan draws text labels and landmarks (drawing only): text as written and turned, every entrance
 * after the main one as an arrow, and other landmarks as a small ring with their caption. A layout without them draws as
 * before.
 */
import { describe, expect, it } from "vitest";
import type { ProjectSpatialReference } from "@datafoundry/contracts";
import type { AnalysisData, ScopeData, ScopeMeter, TrendSeries } from "./analysis-data";
import { buildSiteReport } from "./site-report-model";
import { renderSiteReportHtml } from "./site-report";

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
const planOf = (file: string) => file.slice(file.indexOf('<svg class="plan"'), file.indexOf("</svg>", file.indexOf('<svg class="plan"')));
const withMarks = (layout: Record<string, unknown>) => ({ ...REFERENCE, layout: { ...REFERENCE.layout, ...layout } }) as unknown as ProjectSpatialReference;

describe("the site report's floor plan", () => {
  it("draws text labels and further entrances, and a plain ring for other landmarks", () => {
    const reference = withMarks({
      labels: [{ text: "To Raffles Place MRT", position: [430, 470], rotation: 15, bold: true }, { text: "", position: [1, 1] }],
      symbols: [{ kind: "entrance", position: [430, 420], label: "Main entrance gate" }, { kind: "entrance", position: [60, 420], rotation: 90, label: "Fire escape" }, { kind: "lift", position: [700, 60], label: "Lift lobby" }],
    });
    const plan = planOf(renderSiteReportHtml(buildSiteReport(DATA, reference, GENERATED, "en")));
    expect(plan).toContain("To Raffles Place MRT");
    expect(plan).toContain('transform="rotate(15 430 470)"');
    expect(plan).toContain("Fire escape");
    expect(plan).toContain('transform="rotate(90 60 420)"');
    expect(plan).toContain('data-symbol="other"');
    expect(plan).toContain("Lift lobby");
    // The main entrance is drawn once, by the plan's own entrance drawing.
    expect(plan.match(/Main entrance gate/g)).toHaveLength(1);
  });

  it("draws a layout without labels or landmarks exactly as before", () => {
    const before = renderSiteReportHtml(buildSiteReport(DATA, REFERENCE, GENERATED, "en"));
    const listed = renderSiteReportHtml(buildSiteReport(DATA, withMarks({ labels: [], symbols: [{ kind: "entrance", position: [430, 420], label: "Main entrance gate" }] }), GENERATED, "en"));
    expect(listed).toBe(before);
  });
});
