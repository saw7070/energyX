import { describe, expect, it } from "vitest";
import type { ProjectSpatialReference } from "@datafoundry/contracts";
import type { AnalysisData, ScopeData, ScopeMeter, TrendSeries } from "./analysis-data";
import { buildSiteReport, clock, dateRuns, hourRange } from "./site-report-model";

// Two weeks from Monday 3 Aug 2026, open Monday–Friday 09:00–18:00.
const DATES = Array.from({ length: 14 }, (_, index) => new Date(Date.parse("2026-08-03T00:00:00Z") + index * 86_400_000).toISOString().slice(0, 10));
const weekend = (date: string) => [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
const open = (date: string, hour: number) => !weekend(date) && hour >= 9 && hour < 18;
type Profile = (date: string, hour: number) => number;
const series = (id: string, kwh: Profile): TrendSeries => ({ id, expectedMinutesPerHour: 60, cells: DATES.flatMap(date => Array.from({ length: 24 }, (_, hour) => [date, hour, kwh(date, hour), 60, 0] as TrendSeries["cells"][number])) });

const PROFILES: Record<string, { name: string; board: string; category: ScopeMeter["category"]; kwh: Profile }> = {
  // Office lights: on in working hours with a lunch dip, and left on until 20:00 every weekday.
  "db1-light": { name: "DB1 L1 Light", board: "DB1", category: "light", kwh: (date, hour) => open(date, hour) ? (hour === 12 || hour === 13 ? 1.4 : 2) : !weekend(date) && (hour === 18 || hour === 19) ? 1.2 : 0.05 },
  "db1-power": { name: "DB1 L1 Power", board: "DB1", category: "load", kwh: (date, hour) => open(date, hour) ? 0.4 : 0.3 },
  // A power board whose floor never drops, and three display panels that never switch off.
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
const WEEKLY = Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday"].map(day => [day, [{ from: "09:00", to: "18:00" }]]));
const IDS = Object.keys(PROFILES);
const DATA: AnalysisData = {
  projectId: "tuya-office", projectName: "Tuya Office", timezone: "Asia/Singapore", snapshotId: null,
  current: { project: scope("Tuya Office", IDS), spaces: [scope("Space 1 - Office Area", ["db1-light", "db1-power"]), scope("Space 2 - Shared Area", ["db2-power", "led-1", "led-2", "led-3"])] },
  previous: null, history: null, circuits: [], holidays: new Map(), openingHours: WEEKLY, actions: [],
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

describe("site report", () => {
  const report = buildSiteReport(DATA, REFERENCE, "2026-09-22T10:00:00Z");
  const circuit = (name: string) => report.circuits.find(item => item.name === name)!;

  it("leads with the always-on story and the four key figures", () => {
    expect(report.masthead).toEqual({ site: "Tuya Office", detail: "6 Battery Road, Level 27 · Office energy report", period: "3–16 Aug 2026", periodNote: "14 days, SGT" });
    expect(report.title.emphasis).toBe("never switches off");
    expect(report.title.before).toMatch(/four-fifths of the office load $/);
    expect(report.lede).toContain("It idles at a near-constant **2.82 kW** around the clock");
    expect(report.keyFigures.map(figure => figure.label)).toEqual(["total consumption, 14 days", "avg weekday vs weekend kWh per day", expect.stringMatching(/^round-the-clock base load \(~\d+% of total energy\)$/), expect.stringMatching(/^used outside operating hours/)]);
  });

  it("groups numbered channels into one circuit and scales weekday and weekend averages to 30 days", () => {
    const leds = circuit("3 LED displays");
    expect(leds.meterIds).toEqual(["led-1", "led-2", "led-3"]);
    expect(leds.label).toBe("3 LED displays (Zone C)");
    expect(leds.code).toBe("LED Display 1–3");
    expect(leds.weekdayPerDay).toBeCloseTo(13.68, 6);
    expect(leds.monthKwh).toBeCloseTo(13.68 * 30, 6);
    expect(leds.monthCost).toBeCloseTo(13.68 * 30 * 0.3, 6);
    expect(report.estimate.monthKwh).toBeCloseTo(report.circuits.reduce((sum, item) => sum + item.monthKwh, 0), 6);
    expect(report.estimate.intro).toContain("**S$0.3000/kWh before GST**");
    expect(report.circuits[0]!).toMatchObject({ name: "Shared area equipment & sockets", code: "DB2 L2 Power" });
    // Everyday names a new user understands; panel codes stay as detail.
    expect(report.circuits.map(item => item.name).sort()).toEqual(["3 LED displays", "Office area equipment & sockets", "Office area lights", "Shared area equipment & sockets"]);
  });

  it("maps circuits to the floor-layout zones and describes each zone", () => {
    expect(report.zones.map(zone => [zone.label, zone.board, zone.subgroup])).toEqual([["Zone A", "DB1", false], ["Zone B", "DB2", false], ["Zone C", "DB3", true]]);
    expect(report.profile.intro).toContain("**half of Level 27 at 6 Battery Road — approximately 700 m²**");
    expect(report.profile.zones[0]).toEqual({ heading: "Zone A (turn right from the entrance · panel DB1)", text: "Open office and Director room. Metered as office area lights (DB1 L1 Light) and office area equipment & sockets (DB1 L1 Power)." });
    expect(report.profile.zones[2]!.text).toContain("the **three large LED panels** in the showroom, metered as 3 LED displays (LED Display 1–3). Everything on panel DB3 counts as Zone C.");
    expect(report.estimate.spaceCaption).toBe("Zone C (DB3 · Three large LED panels) is split out from Zone B (DB2), per the circuit map.");
    expect(report.reference).not.toBeNull();
  });

  it("gives the Overview one plain money sentence", () => {
    expect(report.headline).toMatch(/^About S\$\d+ of the estimated S\$\d+ monthly bill pays for equipment that stays on around the clock, even when nobody is there\.$/);
  });

  it("benchmarks weekdays, weekends and a base-load-only day", () => {
    expect(report.benchmark.baseKw).toBeCloseTo(2.82, 6);
    expect(report.benchmark.weekendAvg).toBeCloseTo(2.82 * 24, 6);
    expect(report.benchmark.closeToWeekend).toBe(true);
    expect(report.benchmark.intro).toContain("The weekend line and the base-load line are effectively the same line");
    expect(report.benchmark.rows.map(row => row.label)).toEqual(["Weekday average", "Weekend average", "Base load (24/7 idle draw)"]);
  });

  it("explains the weekday curve and which circuits cause the lunch dip", () => {
    const pattern = report.pattern!;
    expect(pattern.notes.map(note => note.text)).toEqual(expect.arrayContaining(["arrival ramp", "lunch dip"]));
    expect(pattern.intro).toContain("dips through lunch (~4.3 kW, 12–2 pm)");
    expect(pattern.cause).toContain("None of the power meters drops at lunch");
    expect(pattern.cause).toContain("**office area lights fall 30%** (2.00 → 1.40 kWh/h)");
    expect(pattern.caption).toContain("operating window 9 am – 6 pm");
  });

  it("screens each circuit against its own baselines", () => {
    expect(circuit("3 LED displays").finding).toBe("**Zero deviations in 336 hours.** All three ran continuously for the full 14 days — never dimmed, never off.");
    expect(circuit("Shared area equipment & sockets").finding).toContain("a floor that never drops: after-hours draw is **97% of operating draw**");
    expect(circuit("Office area lights").finding).toBe("Lit past 6 pm on **all 10 weekdays** (~1.2 kWh/h), usually until 8 pm.");
    expect(circuit("Office area equipment & sockets").finding).toBe("No flagged hours — steady use; after-hours draw is 75% of daytime draw.");
    expect(report.screening.rows.find(row => row.label.startsWith("3 LED"))!.open).toBe("0.19 each");
    expect(report.screening.callout).toContain("Office area lights after 6 pm (~2.1 kWh/evening) could go on a timer");
    expect(report.screening.callout).toMatch(/Switching the 3 LED displays off outside operating hours alone would cut about \*\*S\$\d+ of their S\$123\/month\*\*/);
  });

  it("keeps a zone's circuits when the meters are filed by area instead of by panel", () => {
    // Tuya Office, 20 Sep 2026: the meters were renamed to friendly locations while
    // the floor plan kept DB1/DB2/DB3. Naming both on the zone keeps the panel
    // label an electrician needs and still matches the meters.
    const renamed: AnalysisData = {
      ...DATA,
      current: {
        project: { ...DATA.current.project, meters: DATA.current.project.meters.map(meter => ({ ...meter, location: `${meter.location} Area` })) },
        spaces: DATA.current.spaces.map(space => ({ ...space, meters: space.meters.map(meter => ({ ...meter, location: `${meter.location} Area` })) })),
      },
    };
    const reference = {
      ...REFERENCE,
      layout: {
        ...REFERENCE.layout,
        zones: REFERENCE.layout.zones.map(zone => ({ ...zone, meterLocations: [`${zone.referenceBoard} Area`] })),
      },
    } as unknown as ProjectSpatialReference;

    const report = buildSiteReport(renamed, reference, "2026-09-22T10:00:00Z");

    // The plan still names the panels, and the zones hold their circuits again.
    expect(report.zones.map(zone => [zone.label, zone.board])).toEqual([["Zone A", "DB1"], ["Zone B", "DB2"], ["Zone C", "DB3"]]);
    expect(report.zones.every(zone => zone.monthKwh > 0)).toBe(true);
    expect(report.reference).not.toBeNull();
  });

  it("leaves every zone empty when the layout names boards no meter uses", () => {
    // The state that printed "0 kWh": without meterLocations nothing matches.
    const renamed: AnalysisData = {
      ...DATA,
      current: {
        project: { ...DATA.current.project, meters: DATA.current.project.meters.map(meter => ({ ...meter, location: `${meter.location} Area` })) },
        spaces: DATA.current.spaces.map(space => ({ ...space, meters: space.meters.map(meter => ({ ...meter, location: `${meter.location} Area` })) })),
      },
    };
    const report = buildSiteReport(renamed, REFERENCE as unknown as ProjectSpatialReference, "2026-09-22T10:00:00Z");

    expect(report.zones.every(zone => zone.monthKwh === 0)).toBe(true);
  });

  it("uses spaces as zones and a table instead of the map when there is no floor layout", () => {
    const plain = buildSiteReport(DATA, null, "2026-09-22T10:00:00Z");
    expect(plain.reference).toBeNull();
    expect(plain.zones.map(zone => zone.label)).toEqual(["Space 1 - Office Area", "Space 2 - Shared Area"]);
    expect(plain.profile.intro).toBe("Energy is monitored by three distribution boards (the electrical panels that feed each area), grouped into two zones:");
    expect(plain.masthead.detail).toBe("Office energy report");
  });
});

describe("report wording helpers", () => {
  it("writes times and date ranges the way people say them", () => {
    expect([hourRange(9, 18), hourRange(12, 14), hourRange(21, 22), hourRange(9, 12), hourRange(11, 13)]).toEqual(["9 am – 6 pm", "12–2 pm", "9–10 pm", "9 am – noon", "11 am – 1 pm"]);
    expect([clock(0), clock(12), clock(19), clock(24)]).toEqual(["midnight", "noon", "7 pm", "midnight"]);
    expect(dateRuns(["2026-08-18", "2026-08-19", "2026-08-27", "2026-09-01", "2026-09-02", "2026-09-03"])).toEqual(["18–19 Aug", "27 Aug", "1–3 Sep"]);
  });
});
