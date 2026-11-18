import { describe, expect, it } from "vitest";
import { heatColour, loadPercent, median, niceMax, offBelow, usualByHour, usualCell, usualColour, USUAL_GRADIENT } from "./device-charts";

describe("loadPercent", () => {
  it("expresses an hour's power as a share of the device's busiest hour", () => {
    expect(loadPercent(0.82, 0.82)).toBe(100);
    expect(loadPercent(0.41, 0.82)).toBe(50);
    expect(loadPercent(0, 0)).toBe(0);
    expect(loadPercent(null, 0.82)).toBeNull();
  });

  it("reads 0% for an hour whose use shows as 0.00 kW, however small the busiest hour is", () => {
    // 0.004 kW is 1% of a 0.3 kW busiest hour, but it shows as 0.00 kW, so 1% would only puzzle the reader.
    expect(loadPercent(0.004, 0.3)).toBe(0);
    expect(loadPercent(0.004, 0.004)).toBe(0);
    expect(loadPercent(0.005, 0.3)).toBe(2);
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

describe("median", () => {
  it("takes the middle value, or the mean of the two middle values for an even count", () => {
    expect(median([0.12, 0.09, 0.09])).toBe(0.09);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("usualByHour", () => {
  const day = (kw: Array<number | null>) => ({ profileKw: Array.from({ length: 24 }, (_, hour) => kw[hour] ?? null) });

  it("takes the middle value of each hour over the days with a reading for it, so one odd day does not shift it", () => {
    const usual = usualByHour([day([0.09, 0.2, null]), day([0.09, 0.4, null]), day([0.12, null, null])]);
    // 00:00 read 0.09, 0.09 and 0.12: usual is 0.09, not the 0.10 average the one 0.12 would make it.
    expect(usual[0]).toBe(0.09);
    expect(usual[2]).toBeNull();
    expect(usual).toHaveLength(24);
  });

  it("falls back to the average when fewer than three days have a reading for that hour, leaving missing days out", () => {
    const usual = usualByHour([day([0.09, 0.2]), day([0.09, 0.4]), day([0.12, null])]);
    expect(usual[1]).toBeCloseTo(0.3);
    expect(usualByHour([day([0.5])])[0]).toBe(0.5);
  });

  it("keeps an hour usually off when the device was on there on only one night out of seven", () => {
    const nights = Array.from({ length: 7 }, (_, night) => day(Array.from({ length: 24 }, (_, hour) => hour >= 18 ? 2 : hour === 3 && night === 6 ? 2 : 0)));
    expect(usualByHour(nights)[3]).toBe(0);
  });
});

describe("offBelow", () => {
  it("is 1% of the device's average hourly use, and never under 0.001 kWh", () => {
    expect(offBelow([{ profileKw: [2, 4, null] }])).toBeCloseTo(0.03);
    expect(offBelow([{ profileKw: [0.02, 0.04] }])).toBe(0.001);
    expect(offBelow([{ profileKw: [null, null] }])).toBe(0.001);
  });
});

describe("usualCell", () => {
  it("expresses an hour's use as a share of that hour's usual use", () => {
    // Charles's emergency lights: usually 0.09 kWh an hour, so an ordinary 0.09 reads 100%, not 82% of a one-off 0.11.
    expect(usualCell(0.09, 0.09, 0.001)).toEqual({ kind: "share", percent: 100 });
    expect(usualCell(0.11, 0.09, 0.001)).toEqual({ kind: "share", percent: 122 });
    expect(usualCell(0.045, 0.09, 0.001)).toEqual({ kind: "share", percent: 50 });
  });

  it("keeps a missing hour missing", () => {
    expect(usualCell(null, 0.09, 0.001)).toEqual({ kind: "missing" });
  });

  it("reads off at an hour the device is usually off, and flags energy used then instead of printing a huge percentage", () => {
    expect(usualCell(0, 0.0004, 0.001)).toEqual({ kind: "off" });
    expect(usualCell(0.0008, 0.0004, 0.001)).toEqual({ kind: "off" });
    expect(usualCell(0.5, 0.0004, 0.001)).toEqual({ kind: "usedWhileOff" });
    expect(usualCell(0.02, 0.02, 0.03)).toEqual({ kind: "off" });
    expect(usualCell(0.04, 0.02, 0.03)).toEqual({ kind: "usedWhileOff" });
  });

  it("reads 0% for an hour whose use shows as 0.00 kWh, unless its usual use shows as 0.00 kWh too", () => {
    expect(usualCell(0.004, 0.3, 0.001)).toEqual({ kind: "share", percent: 0 });
    expect(usualCell(0.004, 0.004, 0.001)).toEqual({ kind: "share", percent: 100 });
  });
});

describe("usualColour", () => {
  it("draws 80% to 120% of usual in one calm colour, so only a real change stands out", () => {
    const usual = usualColour(100);
    expect(usualColour(80)).toBe(usual);
    expect(usualColour(92)).toBe(usual);
    expect(usualColour(120)).toBe(usual);
    expect(usualColour(79)).not.toBe(usual);
    expect(usualColour(121)).not.toBe(usual);
  });

  it("turns blue below usual and yellow, orange then red above it", () => {
    expect(usualColour(0)).toBe("rgb(45, 105, 175)");
    expect(usualColour(79)).toBe("rgb(159, 195, 231)");
    expect(usualColour(121)).toBe("rgb(250, 213, 99)");
    expect(usualColour(160)).toBe("rgb(240, 140, 60)");
    expect(usualColour(200)).toBe("rgb(214, 60, 47)");
    expect(usualColour(900)).toBe("rgb(214, 60, 47)");
  });

  it("gives the legend a bar from 0% to 200% with the usual band in the middle", () => {
    expect(USUAL_GRADIENT).toBe("linear-gradient(90deg, rgb(45, 105, 175) 0%, rgb(160, 196, 232) 40%, rgb(208, 233, 216) 40%, rgb(208, 233, 216) 60%, rgb(250, 215, 100) 60%, rgb(240, 140, 60) 80%, rgb(214, 60, 47) 100%)");
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
