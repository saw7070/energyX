import { describe, expect, it } from "vitest";
import type { EnergyMeterIntervalCoverage } from "@datafoundry/data-gateway";
import { resolveDataAvailabilityPeriod, summariseDataAvailability } from "./energy-data-availability.js";

const HOUR = 3_600_000, QUARTER = 900_000;
const from = Date.parse("2026-09-01T00:00:00.000Z");
const days = (count: number) => count * 24 * HOUR;

/** 15-minute intervals for one meter from `start` for `hours`, each using `kwh` an hour unless `kwhAt` says otherwise. */
const quarterHours = (meterPointId: string, start: number, hours: number, status = "ok", kwhAt: (index: number) => number = (index) => 0.2 + (index % 7) * 0.01): EnergyMeterIntervalCoverage[] =>
  Array.from({ length: hours * 4 }, (_, index) => ({ meterPointId, startMs: start + index * QUARTER, endMs: start + (index + 1) * QUARTER, qualityStatus: status, usageKwh: kwhAt(Math.floor(index / 4)) / 4 }));

describe("data availability", () => {
  it("counts only received readings toward a meter's availability and lists each outage once", () => {
    const to = from + days(10);
    const intervals = [
      ...quarterHours("a", from, 24 * 4),
      // Offline for 6 hours; the catch-up reading's energy is spread as an estimate.
      ...quarterHours("a", from + days(4), 6, "gap", () => 0.5),
      ...quarterHours("a", from + days(4) + 6 * HOUR, 24 * 6 - 6),
    ];
    const summary = summariseDataAvailability({
      fromMs: from, toMs: to,
      meters: [{ meterPointId: "a", name: "Router", location: "B5B" }],
      intervals,
      lastReadingAt: new Map([["a", new Date(to).toISOString()]]),
    });
    const meter = summary.meters[0]!;
    expect(meter).toMatchObject({ status: "ok", estimatedHours: 6, estimatedKwh: 3, missingHours: 0, longestOutageHours: 6 });
    expect(meter.availabilityPct).toBeCloseTo((240 - 6) / 240 * 100, 1);
    expect(summary.outages).toEqual([expect.objectContaining({ meterPointId: "a", kind: "estimated", hours: 6, estimatedKwh: 3, ongoing: false })]);
  });

  it("calls a meter that went quiet before the end stopped, with its missing stretch still open", () => {
    const to = from + days(3);
    const summary = summariseDataAvailability({
      fromMs: from, toMs: to,
      meters: [{ meterPointId: "b", name: "Showroom TV" }],
      intervals: quarterHours("b", from, 48),
      lastReadingAt: new Map([["b", new Date(from + days(2)).toISOString()]]),
    });
    expect(summary.meters[0]).toMatchObject({ status: "stopped", missingHours: 24 });
    expect(summary.meters[0]!.availabilityPct).toBeCloseTo(66.7, 1);
    expect(summary.outages).toEqual([expect.objectContaining({ kind: "missing", hours: 24, ongoing: true })]);
    expect(summary.site).toMatchObject({ metersCounted: 1, metersBelowTarget: 1, outageCount: 1 });
  });

  it("flags the same reading hour after hour, and days of no use from a meter that does use energy", () => {
    const to = from + days(6);
    const stuck = quarterHours("c", from, 24 * 6, "ok", (hour) => hour < 30 ? 0.3 + (hour % 5) * 0.01 : hour < 60 ? 1.25 : 0.4 + (hour % 3) * 0.02);
    const flat = quarterHours("d", from, 24 * 6, "ok", (hour) => hour < 24 ? 0.5 + (hour % 4) * 0.01 : hour < 24 + 80 ? 0 : 0.6 + (hour % 3) * 0.02);
    const summary = summariseDataAvailability({
      fromMs: from, toMs: to,
      meters: [{ meterPointId: "c", name: "Chiller" }, { meterPointId: "d", name: "Coffee machine" }],
      intervals: [...stuck, ...flat],
      lastReadingAt: new Map([["c", new Date(to).toISOString()], ["d", new Date(to).toISOString()]]),
    });
    expect(summary.meters[0]!.checks).toEqual([expect.objectContaining({ kind: "stuck_value", hours: 30, kwhPerHour: 1.25 })]);
    expect(summary.meters[1]!.checks).toEqual([expect.objectContaining({ kind: "flat_zero", hours: 80, kwhPerHour: 0 })]);
    expect(summary.site.checkCount).toBe(2);
  });

  it("keeps a meter someone marked not in use out of the site figure and its warnings", () => {
    const to = from + days(2);
    const summary = summariseDataAvailability({
      fromMs: from, toMs: to,
      meters: [{ meterPointId: "e", name: "Desk" }, { meterPointId: "f", name: "Showroom blind", notInUse: "Nobody uses the showroom blind" }],
      intervals: quarterHours("e", from, 48),
      lastReadingAt: new Map([["e", new Date(to).toISOString()]]),
    });
    expect(summary.meters[1]).toMatchObject({ status: "not_in_use", notInUse: "Nobody uses the showroom blind", availabilityPct: 0, checks: [] });
    expect(summary.site).toMatchObject({ availabilityPct: 100, metersCounted: 1, metersBelowTarget: 0, outageCount: 0 });
  });

  it("calls a meter with nothing in the period no readings, not stopped", () => {
    const summary = summariseDataAvailability({
      fromMs: from, toMs: from + days(1),
      meters: [{ meterPointId: "g", name: "Director room power" }],
      intervals: [],
      lastReadingAt: new Map(),
    });
    expect(summary.meters[0]).toMatchObject({ status: "no_readings", availabilityPct: 0, missingHours: 24 });
  });
});

describe("data availability period", () => {
  it("reports the last 30 complete local days by default, from the site's own midnight", () => {
    // 3 Oct 2026, 01:30 in Singapore is still 2 Oct in UTC.
    const period = resolveDataAvailabilityPeriod({ nowMs: Date.parse("2026-10-02T17:30:00.000Z"), timezone: "Asia/Singapore" });
    expect(period).toMatchObject({ from: "2026-09-03", to: "2026-10-02" });
    expect(new Date(period.fromMs).toISOString()).toBe("2026-09-02T16:00:00.000Z");
    expect(new Date(period.toMs).toISOString()).toBe("2026-10-02T16:00:00.000Z");
  });

  it("takes the dates asked for and refuses ones that make no sense", () => {
    expect(resolveDataAvailabilityPeriod({ from: "2026-09-01", to: "2026-09-30", nowMs: 0, timezone: "Asia/Singapore" })).toMatchObject({ from: "2026-09-01", to: "2026-09-30" });
    expect(() => resolveDataAvailabilityPeriod({ from: "2026-09-30", to: "2026-09-01", nowMs: 0, timezone: "Asia/Singapore" })).toThrow("PERIOD_INVALID");
    expect(() => resolveDataAvailabilityPeriod({ from: "2026-01-01", to: "2026-09-01", nowMs: 0, timezone: "Asia/Singapore" })).toThrow("PERIOD_INVALID");
    expect(() => resolveDataAvailabilityPeriod({ from: "September", to: "2026-09-01", nowMs: 0, timezone: "Asia/Singapore" })).toThrow("PERIOD_INVALID");
  });
});
