import { describe, expect, it } from "vitest";
import { assembleAnalysisData, MIN_PREVIOUS_COVERAGE, type AnalysisSource } from "@datafoundry/site-report";

/** A whole-site reading of `days` local dates from `start`, every hour read for `readMinutes` of its 60 minutes. */
const source = (start: string, days: number, readMinutes: number, kwhPerHour = 2): AnalysisSource => {
  const dates = Array.from({ length: days }, (_, index) => new Date(Date.parse(`${start}T00:00:00Z`) + index * 86_400_000).toISOString().slice(0, 10));
  const cells = dates.flatMap(date => Array.from({ length: 24 }, (_, hour) => [date, hour, readMinutes ? kwhPerHour : null, readMinutes, 0] as [string, number, number | null, number, number]));
  const from = new Date(Date.parse(`${start}T00:00:00+08:00`)).toISOString();
  const to = new Date(Date.parse(`${start}T00:00:00+08:00`) + days * 86_400_000).toISOString();
  const usageKwh = readMinutes ? kwhPerHour * 24 * days : 0;
  return {
    context: { projectName: "Riverside", scopeId: "estate", scopeName: "Riverside", timezone: "Asia/Singapore", from, to },
    summary: { usageKwh, peakKw: kwhPerHour, validIntervalCount: readMinutes ? days * 96 : 0 },
    categories: [], childScopes: [], circuits: [], cost: { status: "unavailable" },
    explorerTrends: [{ id: "__scope__", expectedMinutesPerHour: 60, cells }],
  } as AnalysisSource;
};

const assemble = (previousProject: AnalysisSource | null) => assembleAnalysisData({
  projectId: "estate", project: source("2026-11-04", 15, 60), spaces: [], spaceCurrent: [], previousProject, spacePrevious: [],
  history: null, information: { name: "Riverside", calendar: null }, actions: [],
});

describe("Comparing with the period before", () => {
  it("compares when most of the earlier readings came in", () => {
    const data = assemble(source("2026-10-20", 15, 60, 1.5));
    expect(data.previous?.project.usageKwh).toBe(540);
    expect(data.previousTooFew).toBeUndefined();
  });

  it("does not compare with days before the meters were installed, and says why", () => {
    // Only the last day before installation has readings: about 7% of the expected readings.
    const sparse = source("2026-10-20", 15, 60, 0.1);
    const cells = sparse.explorerTrends![0]!.cells.map(cell => cell[0] === "2026-11-03" ? cell : [cell[0], cell[1], null, 0, 0] as typeof cell);
    const data = assemble({ ...sparse, summary: { ...sparse.summary, usageKwh: 2.4, validIntervalCount: 96 }, explorerTrends: [{ id: "__scope__", expectedMinutesPerHour: 60, cells }] });
    expect(data.previous).toBeNull();
    expect(data.previousTooFew?.coverage).toBeCloseTo(100 / 15, 5);
    expect(data.previousTooFew!.coverage).toBeLessThan(MIN_PREVIOUS_COVERAGE);
  });

  it("stays quiet when there was no earlier period at all", () => {
    expect(assemble(null).previousTooFew).toBeUndefined();
    expect(assemble(source("2026-10-20", 15, 0)).previousTooFew).toBeUndefined();
  });
});
