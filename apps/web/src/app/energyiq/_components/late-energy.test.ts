/**
 * Energy a meter counted while offline and sent when it came back (the sixth entry of an hour) must survive every
 * step that rebuilds a site's hours: taking a not-in-use meter's minutes out of the count, and adding meters up by
 * type. Otherwise a day after an outage reads short on the Overview while the readings have the energy.
 */
import { describe, expect, it } from "vitest";
import { inUseTotal, lateMetersByDay, silentByDesignIds, worthSaying } from "@datafoundry/site-report";
import { scopeDays, type ScopeData, type TrendSeries } from "@datafoundry/site-report";

const series = (id: string, expected: number, cells: TrendSeries["cells"]): TrendSeries => ({ id, expectedMinutesPerHour: expected, cells });
const scope = (total: TrendSeries, meters: ScopeData["meters"]): ScopeData => ({
  id: "site", name: "Site", dates: ["2026-11-16"], timezone: "Asia/Singapore", total, types: {}, meters, usageKwh: null, peakKw: null, peakAt: null, cost: null, typeTotals: {}, coverage: null,
});

describe("energy sent late after an outage", () => {
  it("stays in the site's hours when a meter set aside as not in use is taken out of the count", () => {
    // Two meters; the pavilion is not in use. In hour 19 the block meter was offline and sent 2 kWh late.
    const total = series("__scope__", 120, [["2026-11-16", 19, 0.1, 60, 4, 2], ["2026-11-16", 20, 1, 120, 0, 0]]);
    const pavilion = series("pav", 60, [["2026-11-16", 19, 0.1, 60, 0], ["2026-11-16", 20, 0, 60, 0]]);
    const site = scope(total, [{ id: "pav", name: "Pavilion", location: "", category: "light", official: true, series: pavilion }]);
    const adjusted = inUseTotal(site, new Set(["pav"]))!;
    expect(adjusted.expectedMinutesPerHour).toBe(60);
    expect(adjusted.cells[0]).toEqual(["2026-11-16", 19, 0.1, 0, 4, 2]);
    const [day] = scopeDays({ ...site, total: adjusted }, new Map());
    expect(day!.totalKwh).toBeCloseTo(3.1, 9);
    expect(day!.recoveredKwh).toBeCloseTo(2, 9);
    expect(day!.complete).toBe(false);
  });

  it("is said on a day only when it matters: half a kWh and 2% of the day", () => {
    expect(worthSaying(12, 48)).toBe(true);
    expect(worthSaying(0.3, 47)).toBe(false);
    expect(worthSaying(0.8, 47)).toBe(false);
    expect(worthSaying(1, 47)).toBe(true);
  });

  it("names the meters that sent it, largest first, counting only meters in the official total", () => {
    const total = series("__scope__", 180, []);
    const meter = (id: string, name: string, official: boolean, cells: TrendSeries["cells"]) => ({ id, name, location: "", category: "light" as const, official, series: series(id, 60, cells) });
    const site = scope(total, [
      meter("pav", "Pavilion 2", true, [["2026-11-16", 19, 0, 0, 4, 2.5], ["2026-11-16", 20, 0, 0, 4, 1.4], ["2026-11-17", 19, 0, 0, 4, 0.02]]),
      meter("drive", "Driveway", true, [["2026-11-16", 21, 0, 0, 4, 0.6], ["2026-11-17", 3, 0, 0, 4, 1.2]]),
      meter("main", "Main incomer", false, [["2026-11-16", 19, 0, 0, 4, 9]]),
    ]);
    const late = lateMetersByDay(site);
    expect(late.get("2026-11-16")!.map(item => item.name)).toEqual(["Pavilion 2", "Driveway"]);
    expect(late.get("2026-11-16")![0]!.kwh).toBeCloseTo(3.9, 9);
    // 0.02 kWh is rounding, not an outage worth naming.
    expect(late.get("2026-11-17")).toEqual([{ name: "Driveway", kwh: 1.2, id: "drive" }]);
  });

  it("finds a meter placed in a block, whose hours come with the block's readings, not the site's", () => {
    const meter = (series: TrendSeries | null) => ({ id: "pav", name: "Pavilion linkway 2", location: "", category: "light" as const, official: true, series });
    const site = scope(series("__scope__", 60, []), [meter(null)]);
    const block = { ...scope(series("__scope__", 60, []), [meter(series("pav", 60, [["2026-11-17", 2, 0, 0, 4, 10.2]]))]), id: "block", name: "Common area" };
    expect(lateMetersByDay(site).size).toBe(0);
    expect(lateMetersByDay([site, block]).get("2026-11-17")).toEqual([{ name: "Pavilion linkway 2", kwh: 10.2, id: "pav" }]);
  });

  it("leaves out meters used only now and then: what they send after a quiet spell is ordinary use", () => {
    const meter = (id: string, name: string, cells: TrendSeries["cells"]) => ({ id, name, location: "", category: "light" as const, official: true, series: series(id, 60, cells) });
    const site = scope(series("__scope__", 120, []), [meter("lobby", "Lift lobby 1", [["2026-11-16", 9, 0, 0, 4, 2.2]]), meter("l2", "264F L2–L17", [["2026-11-16", 9, 0, 0, 4, 3.9]])]);
    expect(lateMetersByDay(site, new Set(["lobby"])).get("2026-11-16")).toEqual([{ name: "264F L2–L17", kwh: 3.9, id: "l2" }]);
    // Its silence never makes a day incomplete, like a meter marked not in use.
    expect([...silentByDesignIds({ occasionalUse: ["lobby"] })]).toEqual(["lobby"]);
  });
});
