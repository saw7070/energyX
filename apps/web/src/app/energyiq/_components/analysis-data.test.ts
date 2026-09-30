import { afterEach, describe, expect, it, vi } from "vitest";
import { configApi, type EnergyScopeAnalysisDto } from "../../../lib/config-api";
import { loadAnalysis } from "./analysis-data";
import { scopeDays } from "./analysis-model";

// Two local days (Sat 8 Aug, Sun 9 Aug public holiday) with 24 complete hours each on two official meters.
const hours = (date: string, kwh: number, minutes: number) => Array.from({ length: 24 }, (_, hour) => [date, hour, kwh, minutes, 0] as [string, number, number, number, number]);
const analysis = (from: string, to: string, scale: number, extra: Partial<EnergyScopeAnalysisDto> = {}) => ({
  context: { scopeId: "project", scopeName: "Campus", timezone: "Asia/Singapore", from: `${from}T16:00:00.000Z`, to: `${to}T16:00:00.000Z`, dataSnapshotId: "snap-1" },
  summary: { usageKwh: 144 * scale, averageDailyUsageKwh: 72 * scale, peakKw: 4 * scale, peakAt: "2026-08-08T04:00:00.000Z", validIntervalCount: 192, qualityEventCount: 0 },
  cost: { status: "available", amount: 144 * scale * 0.3, currency: "SGD", tariffScheduleVersion: "t", allocations: [{ from: "", to: "", ratePerKwh: 0.3, rateBasis: "tax_exclusive", usageKwh: 144 * scale, cost: 144 * scale * 0.3 }] },
  categories: [{ category: "load", usageKwh: 96 * scale, sharePct: 66.7 }, { category: "light", usageKwh: 48 * scale, sharePct: 33.3 }],
  childScopes: [],
  explorerTrends: [
    { id: "__scope__", expectedMinutesPerHour: 120, cells: [...hours("2026-08-08", 6 * scale, 120), ...hours("2026-08-09", 6 * scale, 120)] },
    { id: "__category__:load", expectedMinutesPerHour: 60, cells: [...hours("2026-08-08", 4 * scale, 60), ...hours("2026-08-09", 4 * scale, 60)] },
    { id: "__category__:light", expectedMinutesPerHour: 60, cells: [...hours("2026-08-08", 2 * scale, 60), ...hours("2026-08-09", 2 * scale, 60)] },
  ],
  explorerMeters: [
    { id: "l6-total-load", name: "Total Office Load", scopeId: "level-6", kind: "physical", role: "component", coverage: "whole", category: "load", includedInOfficialTotal: true },
    { id: "l6-total-light", name: "Total Office Light", scopeId: "level-6", kind: "physical", role: "component", coverage: "whole", category: "light", includedInOfficialTotal: true },
    { id: "l6-fan", name: "Fan ISOL 1/2", scopeId: "l6-circuits", kind: "physical", role: "component", coverage: "partial", category: "load", includedInOfficialTotal: false },
    { id: "db3-led", name: "LED Display", scopeId: "db3", kind: "physical", role: "component", coverage: "whole", category: "other", includedInOfficialTotal: true },
    { id: "virtual-rest", name: "Other load", scopeId: "level-6", kind: "virtual", role: "derived", coverage: "partial", category: "load", includedInOfficialTotal: false },
  ],
  circuits: [
    { meterNodeId: "l6-total-load", name: "raw", category: "load", meterRole: "component", usageKwh: 96 * scale, includedInOfficialTotal: true },
    { meterNodeId: "l6-fan", name: "raw", category: "load", meterRole: "component", usageKwh: 40 * scale, includedInOfficialTotal: false },
    { meterNodeId: "db3-led", name: "raw", category: "other", meterRole: "component", usageKwh: 20 * scale, includedInOfficialTotal: true },
    { meterNodeId: "virtual-rest", name: "raw", category: "load", meterRole: "derived", usageKwh: 56 * scale, includedInOfficialTotal: false },
  ],
  ...extra,
}) as unknown as EnergyScopeAnalysisDto;
type Request = Parameters<typeof configApi.executeEnergyScopeAnalysis>[0] & { analysisWindow?: string; from?: string; to?: string; expectedDataSnapshotId?: string };
const meters = [{ id: "l6-total-load", location: "Level 6" }, { id: "l6-fan", location: "Level 6" }, { id: "db3-led", location: "DB3" }];

afterEach(() => vi.restoreAllMocks());

describe("analysis data", () => {
  it("loads the project, each space, the period before and all history on one snapshot, with holidays, hours and open actions", async () => {
    const execute = vi.spyOn(configApi, "executeEnergyScopeAnalysis").mockImplementation(async input => {
      const request = input as Request;
      if (request.analysisWindow === "all-available") return analysis("2026-08-01", "2026-08-09", 1);
      if (request.from === "2026-08-06") return analysis("2026-08-05", "2026-08-07", 0.5);
      if (request.scopeId === "level-6") return analysis("2026-08-07", "2026-08-09", 0.25, { context: { scopeId: "level-6", scopeName: "L6", timezone: "Asia/Singapore", from: "2026-08-07T16:00:00.000Z", to: "2026-08-09T16:00:00.000Z", dataSnapshotId: "snap-1" } as EnergyScopeAnalysisDto["context"] });
      return analysis("2026-08-07", "2026-08-09", 1, { childScopes: [{ nodeId: "level-6", name: "Level 6" }] as unknown as EnergyScopeAnalysisDto["childScopes"] });
    });
    const weekly = { monday: [{ from: "08:30", to: "17:30" }] };
    vi.spyOn(configApi, "getEnergyProjectInformation").mockResolvedValue({ name: "Campus", meters,
      calendar: { entries: [{ location: "Campus", from: "2026-01-01", toExclusive: null, weekly, exceptions: [{ date: "2026-08-09", label: "National Day", classification: "public_holiday" }, { date: "2026-08-08", label: "Office move", classification: "special_closure" }] }] } });
    vi.spyOn(configApi, "reportActionRequest").mockResolvedValue({ actions: [{ id: "a1", title: "Fix fans", recommendation: "Isolate", state: "proposed", priority: { level: "high", reason: "Night load" } }] });

    const data = await loadAnalysis("campus", { kind: "latest-28" });
    const requests = execute.mock.calls.map(call => call[0] as Request);
    expect(requests[0]).toMatchObject({ projectId: "campus", scopeId: "project", surface: "project-explorer", period: "Custom", analysisWindow: "current-overview-28d" });
    expect(requests).toContainEqual(expect.objectContaining({ scopeId: "level-6", from: "2026-08-08", to: "2026-08-09", expectedDataSnapshotId: "snap-1" }));
    expect(requests).toContainEqual(expect.objectContaining({ scopeId: "project", from: "2026-08-06", to: "2026-08-07", expectedDataSnapshotId: "snap-1" }));
    expect(requests).toContainEqual(expect.objectContaining({ scopeId: "level-6", from: "2026-08-06", to: "2026-08-07" }));
    expect(requests).toContainEqual(expect.objectContaining({ scopeId: "project", analysisWindow: "all-available", expectedDataSnapshotId: "snap-1" }));

    expect(data).toMatchObject({ projectName: "Campus", snapshotId: "snap-1", openingHours: weekly, actions: [{ id: "a1" }] });
    // Public holidays and special closures both count as holiday-type days; closures are labelled as such.
    expect([...data.holidays].sort()).toEqual([["2026-08-08", "Office move (planned closure)"], ["2026-08-09", "National Day"]]);
    expect(data.current.project).toMatchObject({ dates: ["2026-08-08", "2026-08-09"], usageKwh: 144, typeTotals: { load: 96, light: 48 }, coverage: 100, cost: { currency: "SGD", note: "0.3 SGD/kWh before tax" } });
    expect(data.current.project.cost!.amount).toBeCloseTo(43.2, 6);
    expect(Object.keys(data.current.project.types).sort()).toEqual(["light", "load"]);
    expect(data.current.spaces.map(space => [space.id, space.name, space.usageKwh])).toEqual([["level-6", "Level 6", 36]]);
    expect(data.previous?.project.usageKwh).toBe(72);
    expect(data.history?.dates).toEqual(["2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07", "2026-08-08", "2026-08-09"]);
    expect(scopeDays(data.current.project, data.holidays)).toEqual([
      { date: "2026-08-08", dayType: "public_holiday", holidayName: "Office move (planned closure)", complete: true, totalKwh: 144, byCategory: { light: 48, load: 96 } },
      { date: "2026-08-09", dayType: "public_holiday", holidayName: "National Day", complete: true, totalKwh: 144, byCategory: { light: 48, load: 96 } },
    ]);
  });

  it("ranks real circuits: level totals with sub-meters beneath them and virtual meters are left out; official circuits without sub-meters stay", async () => {
    vi.spyOn(configApi, "executeEnergyScopeAnalysis").mockImplementation(async input => (input as Request).analysisWindow === "current-overview-28d" ? analysis("2026-08-07", "2026-08-09", 1) : Promise.reject(new Error("no data")));
    vi.spyOn(configApi, "getEnergyProjectInformation").mockResolvedValue({ name: "Campus", meters, calendar: null });
    vi.spyOn(configApi, "reportActionRequest").mockRejectedValue(new Error("forbidden"));
    const data = await loadAnalysis("campus", { kind: "latest-28" });
    expect(data.previous).toBeNull();
    expect(data.history).toBeNull();
    expect(data.actions).toEqual([]);
    expect(data.circuits).toEqual([
      { id: "l6-fan", name: "Fan ISOL 1/2", location: "Level 6", category: "load", kwh: 40, previousKwh: null },
      { id: "db3-led", name: "LED Display", location: "DB3", category: "other", kwh: 20, previousKwh: null },
    ]);
  });

  it("keeps the daily total when the server returns no per-type series, and asks for custom dates directly", async () => {
    const base = analysis("2026-08-07", "2026-08-09", 1);
    const execute = vi.spyOn(configApi, "executeEnergyScopeAnalysis").mockImplementation(async input => (input as Request).from === "2026-08-08" && input.scopeId === "project" ? { ...base, explorerTrends: base.explorerTrends!.slice(0, 1) } : Promise.reject(new Error("none")));
    vi.spyOn(configApi, "getEnergyProjectInformation").mockRejectedValue(new Error("forbidden"));
    vi.spyOn(configApi, "reportActionRequest").mockResolvedValue({ actions: [] });
    const data = await loadAnalysis("campus", { kind: "custom", from: "2026-08-08", to: "2026-08-09" });
    expect(execute.mock.calls[0]![0]).toMatchObject({ from: "2026-08-08", to: "2026-08-09" });
    expect(data.current.project.types).toEqual({});
    expect(data.current.project.typeTotals).toEqual({ load: 96, light: 48 });
    expect(data.openingHours).toBeNull();
    expect(scopeDays(data.current.project, data.holidays).map(day => [day.dayType, day.totalKwh, day.byCategory])).toEqual([["weekend", 144, {}], ["weekend", 144, {}]]);
  });
});
