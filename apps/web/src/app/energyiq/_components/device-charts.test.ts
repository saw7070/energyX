import { describe, expect, it } from "vitest";
import { heatColour, loadPercent, niceMax } from "./device-charts";

describe("loadPercent", () => {
  it("expresses an hour's power as a share of the device's busiest hour", () => {
    expect(loadPercent(0.82, 0.82)).toBe(100);
    expect(loadPercent(0.41, 0.82)).toBe(50);
    expect(loadPercent(0, 0)).toBe(0);
    expect(loadPercent(null, 0.82)).toBeNull();
  });
});

describe("heatColour", () => {
  it("runs from green through yellow and orange to red", () => {
    expect(heatColour(0)).toBe("rgb(99, 190, 123)");
    expect(heatColour(0.35)).toBe("rgb(250, 215, 100)");
    expect(heatColour(0.7)).toBe("rgb(240, 140, 60)");
    expect(heatColour(1)).toBe("rgb(214, 60, 47)");
    expect(heatColour(2)).toBe("rgb(214, 60, 47)");
    expect(heatColour(null)).toBe("transparent");
  });

  it("blends between neighbouring stops", () => {
    expect(heatColour(0.175)).toBe("rgb(175, 203, 112)");
  });
});

describe("niceMax", () => {
  it("rounds axis maxima up to 1, 2 or 5 × a power of ten", () => {
    expect(niceMax(7.44)).toBe(10);
    expect(niceMax(19.2)).toBe(20);
    expect(niceMax(0.82)).toBe(1);
    expect(niceMax(0)).toBe(1);
  });
});
