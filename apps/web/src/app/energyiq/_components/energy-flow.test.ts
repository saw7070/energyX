import { expect, it } from "vitest";
import type { ScopeData } from "./analysis-data";
import { energyFlowData } from "./energy-flow";

const scope = (name: string, usageKwh: number, typeTotals: ScopeData["typeTotals"]): ScopeData => ({
  id: name, name, dates: [], timezone: "Asia/Singapore", total: null, types: {}, meters: [],
  usageKwh, peakKw: null, peakAt: null, cost: null, typeTotals, coverage: null,
});
const words = { site: "Whole site", unsplit: "Not measured by space", type: (category: string) => category };

it("splits the site into spaces and types, with the unmeasured remainder as its own band", () => {
  const project = scope("Admin building", 1000, { aircon: 520, light: 200, load: 230 });
  const flow = energyFlowData(project, [
    scope("Level 1", 300, { aircon: 120, light: 80, load: 100 }),
    scope("Level 2", 600, { aircon: 360, light: 100, load: 100 }),
  ], words)!;

  expect(flow.nodes.map(node => node.name)).toEqual(["Whole site", "Level 2", "light", "load", "aircon", "other", "Level 1", "Not measured by space"]);
  const out = (index: number) => flow.links.filter(link => link.source === index).reduce((sum, link) => sum + link.value, 0);
  const into = (index: number) => flow.links.filter(link => link.target === index).reduce((sum, link) => sum + link.value, 0);
  // Every space passes on all it receives, and the site sends out exactly its total.
  expect(out(0)).toBeCloseTo(1000, 6);
  for (const index of [1, 6, 7]) expect(out(index)).toBeCloseTo(into(index), 6);
  // Level 2's 40 kWh without a type goes to "other"; the remaining 100 kWh is split by what the spaces did not cover.
  expect(flow.links).toContainEqual({ source: 1, target: 5, value: 40 });
  expect(into(7)).toBeCloseTo(100, 6);
  expect(flow.links.filter(link => link.source === 7)).toEqual([
    { source: 7, target: 2, value: 20 },
    { source: 7, target: 3, value: 30 },
    { source: 7, target: 4, value: 40 },
    { source: 7, target: 5, value: 10 },
  ]);
});

it("has nothing to draw without a measured space", () => {
  expect(energyFlowData(scope("Site", 500, {}), [], words)).toBeNull();
  expect(energyFlowData(scope("Site", 0, {}), [scope("A", 10, {})], words)).toBeNull();
});

it("sums up the flow in one sentence: the biggest space and the biggest use", async () => {
  const { energyFlowSummary } = await import("./energy-flow");
  const flow = energyFlowData(scope("Site", 1000, { aircon: 600, light: 400 }), [
    scope("Level 1", 300, { aircon: 100, light: 200 }),
    scope("Level 2", 700, { aircon: 500, light: 200 }),
  ], words)!;
  expect(energyFlowSummary(flow)).toEqual({ space: { name: "Level 2", share: 70 }, type: { category: "aircon", share: 60 } });
});
