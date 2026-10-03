import { describe, expect, it } from "vitest";

import { breakdownSpaces, holdsOnlyMainMeter, siteBreakdown } from "./site-total";
import type { ScopeData } from "./analysis-data";

const space = (id: string, usageKwh: number, categories: string[]): ScopeData => ({
  id, name: id, dates: [], timezone: "Asia/Singapore", total: null, types: {}, usageKwh, peakKw: null, peakAt: null, cost: null, typeTotals: {}, coverage: 1,
  meters: categories.map((category, index) => ({ id: `${id}-${index}`, name: `${id} ${index}`, location: id, category: category as never, official: true, series: null })),
});
const circuit = (id: string, kwh: number, category = "other") => ({ id, name: id, location: "board", category: category as never, kwh, previousKwh: null });

describe("site breakdown", () => {
  it("leaves out the area that only holds the main meter when the circuits are its neighbours", () => {
    const spaces = [space("Elite IOT Site", 3772, ["overall"]), space("B5B", 133, ["other"]), space("B3B", 121, ["other"])];
    expect(holdsOnlyMainMeter(spaces[0]!)).toBe(true);
    expect(breakdownSpaces(spaces, (item) => item).map((item) => item.id)).toEqual(["B5B", "B3B"]);
    const result = siteBreakdown({ projectKwh: 3772, spaces, circuits: [], unmeteredLabel: "Not measured by a sub-meter" });
    expect(result.rows.map((row) => [row.label, Math.round(row.kwh)])).toEqual([["Not measured by a sub-meter", 3518], ["B5B", 133], ["B3B", 121]]);
    expect(result.byCircuit).toBe(false);
  });

  it("lists the circuits of a single-area site, and what the main meter measured beyond them", () => {
    const spaces = [space("Main distribution board", 405, ["overall", "other", "light"])];
    const result = siteBreakdown({ projectKwh: 3994, spaces, circuits: [circuit("B5B", 165), circuit("B3B", 126), circuit("Incoming", 3994, "overall")], unmeteredLabel: "Rest" });
    expect(result.byCircuit).toBe(true);
    expect(result.rows.map((row) => row.label)).toEqual(["Rest", "B5B", "B3B"]);
    expect(result.unmeteredKwh).toBeCloseTo(3994 - 165 - 126, 6);
  });

  it("adds no extra line when the areas already add up to the site", () => {
    const spaces = [space("Space 1", 600, ["overall", "light"]), space("Space 2", 400, ["overall", "load"])];
    const result = siteBreakdown({ projectKwh: 1005, spaces, circuits: [], unmeteredLabel: "Rest" });
    expect(result.rows.map((row) => row.label)).toEqual(["Space 1", "Space 2"]);
    expect(result.unmeteredKwh).toBe(0);
  });
});
