import { describe, expect, it } from "vitest";
import { rankCircuits, toScope } from "@datafoundry/site-report";

const hours = (date: string, kwh: number | null, minutes = 60) => Array.from({ length: 24 }, (_, hour) => [date, hour, kwh, minutes, 0] as [string, number, number | null, number, number]);
// As Elite IOT reads: the site total is its main meter, so the only type the engine reports is "overall".
const analysis = {
  context: { scopeId: "project", scopeName: "Elite IOT", timezone: "Asia/Singapore", from: "2026-09-02T16:00:00.000Z", to: "2026-09-03T16:00:00.000Z", dataSnapshotId: "snap" },
  summary: { usageKwh: 240, averageDailyUsageKwh: 240, peakKw: 10, peakAt: null, validIntervalCount: 24, qualityEventCount: 0 },
  cost: { status: "unavailable" },
  categories: [{ category: "overall", usageKwh: 240, sharePct: 100 }],
  explorerTrends: [
    { id: "__scope__", expectedMinutesPerHour: 60, cells: hours("2026-09-03", 10) },
    { id: "__category__:overall", expectedMinutesPerHour: 60, cells: hours("2026-09-03", 10) },
    { id: "incoming", expectedMinutesPerHour: 60, cells: hours("2026-09-03", 10) },
    { id: "b5b", expectedMinutesPerHour: 60, cells: hours("2026-09-03", 1) },
    { id: "b4b", expectedMinutesPerHour: 60, cells: hours("2026-09-03", 0.5).slice(0, 12) },
    { id: "a18p", expectedMinutesPerHour: 60, cells: hours("2026-09-03", 0.25) },
  ],
  explorerMeters: [
    { id: "incoming", name: "Incoming 3Phase", scopeId: "board", kind: "physical", category: "overall", includedInOfficialTotal: true },
    { id: "b5b", name: "B5B", scopeId: "b5b", kind: "physical", category: "it", includedInOfficialTotal: false },
    { id: "b4b", name: "B4B", scopeId: "b4b", kind: "physical", category: "it", includedInOfficialTotal: false },
    { id: "a18p", name: "A18P", scopeId: "a18p", kind: "physical", category: "kitchen", includedInOfficialTotal: false },
  ],
  circuits: [
    { meterNodeId: "incoming", name: "Incoming 3Phase", category: "overall", meterRole: "total", usageKwh: 240 },
    { meterNodeId: "b5b", name: "B5B", category: "it", meterRole: "component", usageKwh: 24 },
    { meterNodeId: "b4b", name: "B4B", category: "it", meterRole: "component", usageKwh: 6 },
    { meterNodeId: "a18p", name: "A18P", category: "kitchen", meterRole: "component", usageKwh: 6 },
  ],
  childScopes: [],
} as unknown as Parameters<typeof toScope>[0];

describe("split by type when the site total is the main meter", () => {
  it("adds up the sub-meters by type, hour by hour", () => {
    const scope = toScope(analysis, new Map());
    expect(scope.typeTotals).toEqual({ it: 24 + 6, kitchen: 6 });
    expect(scope.types.it?.cells[0]).toEqual(["2026-09-03", 0, 1.5, 60, 0]);
    // B4B stopped at noon, so the afternoon is not a complete hour for IT.
    expect(scope.types.it?.cells[12]).toEqual(["2026-09-03", 12, 1, 0, 0]);
    expect(scope.types.kitchen?.cells).toHaveLength(24);
  });

  it("still gives the totals by type when the result has no hourly readings per meter", () => {
    // As the whole-site result arrives: only the site and "overall" lines, with each sub-meter's usage listed.
    const scope = toScope({ ...analysis, explorerTrends: analysis.explorerTrends!.slice(0, 2) }, new Map());
    expect(scope.typeTotals).toEqual({ it: 30, kitchen: 6 });
    expect(scope.types).toEqual({});
  });

  it("keeps the engine's own split when it has one", () => {
    const own = { ...analysis, categories: [{ category: "light", usageKwh: 24, sharePct: 100 }],
      explorerTrends: [...(analysis.explorerTrends ?? []), { id: "__category__:light", expectedMinutesPerHour: 60, cells: hours("2026-09-03", 1) }] } as unknown as typeof analysis;
    const scope = toScope(own, new Map());
    expect(Object.keys(scope.types)).toEqual(["light"]);
    expect(scope.typeTotals).toEqual({ light: 24 });
  });
});

describe("circuits beside a main meter", () => {
  it("ranks the circuits and leaves out the main meter, though it is not in the board's sum", () => {
    // As the board reads: the main meter sits on the board, left out of the sum; every circuit is counted.
    const board = { ...analysis, circuits: analysis.circuits.map(circuit => ({ ...circuit, includedInOfficialTotal: circuit.meterNodeId !== "incoming" })) };
    const place = new Map(["incoming", "b5b", "b4b", "a18p"].map(id => [id, "Main distribution board"]));
    expect(rankCircuits([board], null, place).map(circuit => circuit.id)).toEqual(["b5b", "b4b", "a18p"]);
  });
});
