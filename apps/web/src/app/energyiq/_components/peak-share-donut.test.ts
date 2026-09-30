import { describe, expect, it } from "vitest";
import { circuitSlices, ringPath } from "./peak-share-donut";

const circuit = (id: string, kwh: number, periodKwh: number) => ({ id, name: id, kwh, periodKwh });

describe("circuitSlices", () => {
  it("names the four biggest circuits of the period, groups the rest and shows the part no circuit meter covers", () => {
    const slices = circuitSlices([circuit("Conow", 0.8, 500), circuit("NetZero", 0.58, 400), circuit("TV 2", 0.21, 150), circuit("Fridge", 0.12, 120), circuit("TV 1", 0.09, 60), circuit("Meeting TV", 0.02, 30)], 4.46);
    expect(slices.map(slice => [slice.name, slice.colour])).toEqual([
      ["Conow", "var(--share-1)"], ["NetZero", "var(--share-2)"], ["TV 2", "var(--share-3)"], ["Fridge", "var(--share-4)"],
      ["Other circuits (2)", "var(--share-other)"], ["Not split by circuit", "var(--share-rest)"],
    ]);
    expect(slices[4]!.kwh).toBeCloseTo(0.11, 6);
    expect(slices[4]!.detail).toBe("TV 1, Meeting TV");
    expect(slices[5]!.kwh).toBeCloseTo(2.64, 6);
  });
  it("keeps each circuit's colour when another hour ranks them differently", () => {
    const slices = circuitSlices([circuit("Conow", 0.1, 500), circuit("NetZero", 0.9, 400)], 1);
    expect(slices.map(slice => [slice.name, slice.colour])).toEqual([["Conow", "var(--share-1)"], ["NetZero", "var(--share-2)"]]);
  });
  it("skips circuits that used nothing and leaves out a negligible remainder", () => {
    expect(circuitSlices([circuit("A", 0, 10), circuit("B", 1, 5)], 1.001).map(slice => slice.name)).toEqual(["B"]);
  });
});

describe("ringPath", () => {
  it("draws a closed ring segment and uses the large arc past half a turn", () => {
    expect(ringPath(50, 50, 40, 20, 0, Math.PI / 2)).toBe("M50.00,10.00 A40,40 0 0 1 90.00,50.00 L70.00,50.00 A20,20 0 0 0 50.00,30.00 Z");
    expect(ringPath(50, 50, 40, 20, 0, Math.PI * 1.5)).toContain("A40,40 0 1 1");
  });
});
