import { describe, expect, it } from "vitest";

import { energyBreakdown, type DeviceRow } from "./site-devices";

const device = (id: string, boardId: string, usageKwh: number, extra: Partial<DeviceRow> = {}): DeviceRow => ({
  id, name: id, boardId, category: "other", type: "Other", isBoardTotal: false, usageKwh, peakKw: 1, coveragePct: 100, status: "reporting", ...extra,
} as DeviceRow);

describe("energy breakdown with an incoming supply meter", () => {
  // As built by Smart setup: the incoming meter on the main board, each circuit in its own location under it.
  const board = "board";
  const rows = [
    device("Incoming 3Phase", board, 3994, { isBoardTotal: true, category: "overall", type: "Overall" }),
    device("B5B", "c-b5b", 143),
    device("B3B", "c-b3b", 129),
    device("B11P", "c-b11p", 49, { category: "light", type: "Lighting" }),
  ];
  const parents = new Map([["c-b5b", board], ["c-b3b", board], ["c-b11p", board]]);
  const names = new Map([[board, "Main distribution board"]]);

  it("never lists the incoming supply as a device and shows what the circuits don't explain", () => {
    const shares = energyBreakdown(rows, names, "en", parents);
    expect(shares.map((share) => share.id)).not.toContain("Incoming 3Phase");
    expect(shares.find((share) => !share.unmetered)?.name).toBe("B5B");
    const rest = shares.find((share) => share.unmetered)!;
    expect(rest.name).toBe("Not sub-metered (Main distribution board)");
    expect(rest.kwh).toBeCloseTo(3994 - 143 - 129 - 49, 6);
    // The pieces still add up to the measured supply.
    expect(shares.reduce((sum, share) => sum + share.kwh, 0)).toBeCloseTo(3994, 6);
  });

  it("keeps the old behaviour for totals of one kind of use on their own board", () => {
    const local = [
      device("DB1 Lighting", "db1", 300, { isBoardTotal: true, category: "light", type: "Lighting" }),
      device("Lights A", "db1", 100, { category: "light", type: "Lighting" }),
      device("Sockets", "db1", 50),
    ];
    const shares = energyBreakdown(local, new Map([["db1", "DB1"]]), "en");
    expect(shares.find((share) => share.unmetered)?.kwh).toBeCloseTo(200, 6);
    expect(shares.map((share) => share.id)).toEqual(expect.arrayContaining(["Lights A", "Sockets"]));
  });
});
