import { describe, expect, it } from "vitest";

import {
  BASELINE_MIN_SAMPLES,
  dayTypeResolver,
  findOfflineMeters,
  groupOfflineMeters,
  hourlyBaseline,
  hourlyCellsFromIntervals,
  median,
  medianAbsoluteDeviation,
  meterBack,
  neverUsedEpisodes,
  patternEpisodes,
  patternThreshold,
  usualReportingHours,
  type HourCell,
  type MeterAlertInputMeter,
} from "./energy-meter-alert-rules.js";

const TZ = "Asia/Singapore";
/** A Singapore wall-clock time as an instant. */
const sg = (local: string) => Date.parse(`${local}:00+08:00`);
const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Hourly cells from `from` (inclusive) to `to` (exclusive), local "YYYY-MM-DDTHH" hours; `make` gives each hour or null for none. */
function hours(from: string, to: string, make: (date: string, hour: number) => HourCell | null): HourCell[] {
  const cells: HourCell[] = [];
  for (let at = sg(`${from}:00`); at < sg(`${to}:00`); at += 3_600_000) {
    const local = new Date(at + 8 * 3_600_000).toISOString();
    const cell = make(local.slice(0, 10), Number(local.slice(11, 13)));
    if (cell) cells.push(cell);
  }
  return cells;
}
const read = (kwh: number) => (date: string, hour: number): HourCell => [date, hour, kwh, 60, 0, 0];

describe("Meter alert rules: stopped sending", () => {
  // SKTC as of 19 Nov 2026: the daily update has brought readings up to 02:00.
  const reference = sg("2026-11-19T02:00");
  const block = ["264F L2-L17", "264F L1", "264F lift lobby", "264F stairs"];
  // Block 264F's gateway was down 16 Nov 18:30 – 17 Nov 07:00; the meters sent what they counted when it came back.
  const blockCells = (): HourCell[] => hours("2026-10-28T00", "2026-11-19T02", (date, hour) => {
    const at = sg(`${date}T${String(hour).padStart(2, "0")}:00`);
    if (at === sg("2026-11-16T18:00")) return [date, hour, 0.1, 30, 1, 0.05];
    if (at > sg("2026-11-16T18:00") && at < sg("2026-11-17T07:00")) return [date, hour, null, 0, 1, 0.2];
    return read(0.2)(date, hour);
  });
  // Pavilion 2 is powered only while its lights are on: it reports 19:00–07:00, never in the day.
  const pavilion2 = hours("2026-10-28T00", "2026-11-19T02", (date, hour) => (hour >= 19 || hour < 7 ? read(0.3)(date, hour) : null));
  // Pavilion 1 stopped for good at 5 Nov 21:00.
  const pavilion1 = hours("2026-10-28T00", "2026-11-05T21", read(0.4));
  const cells = new Map<string, HourCell[]>([
    ...block.map((name) => [name, blockCells()] as const),
    ["pavilion-1", pavilion1],
    ["pavilion-2", pavilion2],
    ["spare", hours("2026-10-28T00", "2026-11-01T00", read(0.1))],
    ["idle-fan", hours("2026-10-28T00", "2026-11-10T00", read(0.1))],
    ["pavilion-fan", hours("2026-10-28T00", "2026-11-13T23", read(0))],
  ]);
  const meters: MeterAlertInputMeter[] = [
    ...block.map((name) => ({ id: name, name, location: "Block 264F", locationId: "block-264f", lastReadingAt: new Date(reference).toISOString() })),
    { id: "pavilion-1", name: "Pavilion 1", location: "Pavilions", locationId: "pavilions", lastReadingAt: new Date(sg("2026-11-05T21:00")).toISOString() },
    { id: "pavilion-2", name: "Pavilion 2", location: "Pavilions", locationId: "pavilions", lastReadingAt: new Date(reference).toISOString() },
    { id: "spare", name: "Spare", notInUse: true, lastReadingAt: new Date(sg("2026-11-01T00:00")).toISOString() },
    { id: "idle-fan", name: "Idle fan", idleWhenQuiet: true, lastReadingAt: new Date(sg("2026-11-10T00:00")).toISOString() },
    { id: "pavilion-fan", name: "Pavilion DL & fan", neverUsed: true, lastReadingAt: new Date(sg("2026-11-13T23:00")).toISOString() },
  ];

  it("learns the hours a meter usually reports in, so a meter powered only with its lights is judged on its nights", () => {
    expect([...usualReportingHours(pavilion2)].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 19, 20, 21, 22, 23]);
    expect(usualReportingHours(blockCells()).size).toBe(24);
    // Days after it stopped do not count against its usual hours.
    expect(usualReportingHours(pavilion1).size).toBe(24);
  });

  it("finds meters quiet for more than 12 hours past when they would next report, and outages already over, but never a lights-only meter's days", () => {
    const found = findOfflineMeters({ meters, cells, referenceMs: reference, timezone: TZ });
    expect(found.map((meter) => [meter.name, meter.since, meter.back ?? null])).toEqual([
      ["Pavilion 1", new Date(sg("2026-11-05T21:00")).toISOString(), null],
      ...block.slice().sort().map((name) => [name, new Date(sg("2026-11-16T18:30")).toISOString(), new Date(sg("2026-11-17T07:00")).toISOString()]),
    ]);
    // What they counted while away was sent late and filled in.
    expect(found.find((meter) => meter.name === "264F L1")?.filledLateKwh).toBeCloseTo(0.05 + 12 * 0.2, 3);
    // Pavilion 2, with readings at night only, is never quiet in its usual hours; it would be after a dark night.
    const darkNight = hours("2026-10-28T00", "2026-11-18T07", (date, hour) => (hour >= 19 || hour < 7 ? read(0.3)(date, hour) : null));
    const quiet = findOfflineMeters({
      meters: [{ id: "pavilion-2", name: "Pavilion 2", lastReadingAt: new Date(sg("2026-11-18T07:00")).toISOString() }],
      cells: new Map([["pavilion-2", darkNight]]), referenceMs: sg("2026-11-19T07:30"), timezone: TZ,
    });
    expect(quiet.map((meter) => meter.name)).toEqual(["Pavilion 2"]);
    expect(findOfflineMeters({
      meters: [{ id: "pavilion-2", name: "Pavilion 2", lastReadingAt: new Date(sg("2026-11-18T07:00")).toISOString() }],
      cells: new Map([["pavilion-2", darkNight]]), referenceMs: sg("2026-11-19T06:00"), timezone: TZ,
    })).toEqual([]);
  });

  it("keeps a 24-hour meter quiet for exactly 12 hours as fine, and an outage that ended over three days ago out", () => {
    const steady = hours("2026-11-01T00", "2026-11-18T12", read(0.2));
    const meter = { id: "m", name: "M", lastReadingAt: new Date(sg("2026-11-18T12:00")).toISOString() };
    expect(findOfflineMeters({ meters: [meter], cells: new Map([["m", steady]]), referenceMs: sg("2026-11-19T00:00"), timezone: TZ })).toEqual([]);
    expect(findOfflineMeters({ meters: [meter], cells: new Map([["m", steady]]), referenceMs: sg("2026-11-19T00:01"), timezone: TZ })).toHaveLength(1);
    const oldOutage = hours("2026-11-01T00", "2026-11-19T00", (date, hour) => (date === "2026-11-05" ? null : read(0.2)(date, hour)));
    expect(findOfflineMeters({ meters: [{ ...meter, lastReadingAt: new Date(sg("2026-11-19T00:00")).toISOString() }], cells: new Map([["m", oldOutage]]), referenceMs: sg("2026-11-19T00:00"), timezone: TZ })).toEqual([]);
  });

  it("reads meters in one area that went quiet together as one alert, likely their gateway", () => {
    const groups = groupOfflineMeters(findOfflineMeters({ meters, cells, referenceMs: reference, timezone: TZ }));
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ since: new Date(sg("2026-11-05T21:00")).toISOString(), meters: [{ name: "Pavilion 1" }] });
    expect(groups[0]!.location).toBeUndefined();
    expect(groups[1]).toMatchObject({
      location: "Block 264F", locationId: "block-264f", since: new Date(sg("2026-11-16T18:30")).toISOString(), back: new Date(sg("2026-11-17T07:00")).toISOString(),
    });
    expect(groups[1]!.meters).toHaveLength(4);
    expect(groups[1]!.filledLateKwh).toBeCloseTo(4 * (0.05 + 12 * 0.2), 3);
    // Two meters in one area that went quiet hours apart are two alerts.
    const apart = groupOfflineMeters([
      { id: "a", name: "A", locationId: "x", location: "X", since: new Date(sg("2026-11-16T18:30")).toISOString() },
      { id: "b", name: "B", locationId: "x", location: "X", since: new Date(sg("2026-11-16T21:00")).toISOString() },
    ]);
    expect(apart.map((group) => group.meters.map((meter) => meter.id))).toEqual([["a"], ["b"]]);
  });

  it("says when a quiet meter came back and what it sent late", () => {
    expect(meterBack(blockCells(), sg("2026-11-16T18:30"), TZ)).toEqual({ at: new Date(sg("2026-11-17T07:00")).toISOString(), filledLateKwh: 2.45 });
    expect(meterBack(pavilion1, sg("2026-11-05T21:00"), TZ)).toBeNull();
  });

  it("builds the Explorer's hourly cells from raw intervals, sharing one across the hours it spans", () => {
    const cells = hourlyCellsFromIntervals([
      { meterPointId: "m", startMs: sg("2026-11-16T18:00"), endMs: sg("2026-11-16T18:30"), qualityStatus: "ok", usageKwh: 0.1 },
      { meterPointId: "m", startMs: sg("2026-11-16T18:30"), endMs: sg("2026-11-16T20:30"), qualityStatus: "gap", usageKwh: 0.4 },
      { meterPointId: "m", startMs: sg("2026-11-16T20:30"), endMs: sg("2026-11-16T21:00"), qualityStatus: "ok", usageKwh: 0.05 },
    ], TZ).get("m")!;
    expect(cells.map((cell) => [cell[0], cell[1], cell[2], Math.round(cell[3]), cell[4], Math.round(cell[5] * 1000) / 1000])).toEqual([
      ["2026-11-16", 18, 0.1, 30, 1, 0.1],
      ["2026-11-16", 19, null, 0, 1, 0.2],
      ["2026-11-16", 20, 0.05, 30, 1, 0.1],
    ]);
  });
});

describe("Meter alert rules: should never use power", () => {
  it("makes one episode of consecutive hours above 0.01 kWh, with its start and total, ignoring standby crumbs", () => {
    const cells = hours("2026-11-13T18", "2026-11-14T06", (date, hour) => {
      if (date === "2026-11-13" && hour === 23) return [date, hour, 0.3, 60, 0, 0];
      if (date === "2026-11-14" && hour === 0) return [date, hour, 0.25, 60, 0, 0];
      if (date === "2026-11-14" && hour === 3) return [date, hour, 0.01, 60, 0, 0];
      return read(0)(date, hour);
    });
    expect(neverUsedEpisodes(cells)).toEqual([{
      startDate: "2026-11-13", startHour: 23, endDate: "2026-11-14", endHour: 1, hours: 2, ongoing: false, totalKwh: 0.55, peakKwh: 0.3,
    }]);
  });

  it("keeps an episode open while nothing yet says it stopped, and splits use separated by a quiet hour", () => {
    const cells: HourCell[] = [["2026-11-18", 20, 0.2, 60, 0, 0], ["2026-11-18", 21, 0, 60, 0, 0], ["2026-11-18", 22, 0.05, 60, 0, 0]];
    expect(neverUsedEpisodes(cells).map((episode) => [episode.startHour, episode.ongoing])).toEqual([[20, false], [22, true]]);
    // Energy sent late counts: it was used, even if not exactly when.
    expect(neverUsedEpisodes([["2026-11-18", 2, null, 0, 1, 0.4]])).toHaveLength(1);
  });
});

describe("Meter alert rules: unusual hourly use", () => {
  it("uses the median and the median absolute deviation", () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([5, 1, 3])).toBe(3);
    expect(medianAbsoluteDeviation([1, 2, 3, 4, 100])).toBe(1);
    expect(patternThreshold({ median: 4, mad: 0.1, samples: 21 })).toBe(2);
    expect(patternThreshold({ median: 0.04, mad: 0.001, samples: 21 })).toBe(0.05);
    expect(patternThreshold({ median: 1, mad: 0.4, samples: 21 })).toBeCloseTo(1.2, 9);
  });

  it("needs at least 7 complete samples for an hour, kept apart by day type", () => {
    const dayTypeOf = dayTypeResolver({ meaning: "opening" });
    const learn = (days: number) => {
      const dates = Array.from({ length: days }, (_, index) => shift("2026-11-02", index * 7)); // Mondays
      const cells = dates.map((date): HourCell => [date, 22, 4, 60, 0, 0]);
      return hourlyBaseline(cells, new Set(dates), dayTypeOf);
    };
    expect(learn(BASELINE_MIN_SAMPLES - 1).size).toBe(0);
    expect(learn(BASELINE_MIN_SAMPLES).get("weekday|22")).toEqual({ median: 4, mad: 0, samples: 7 });
    // An hour not read completely on time is never a sample.
    const cells: HourCell[] = Array.from({ length: 7 }, (_, index) => [shift("2026-11-02", index), 3, 1, index === 0 ? 45 : 60, 0, 0]);
    expect(hourlyBaseline(cells, new Set(cells.map((cell) => cell[0])), () => "all").size).toBe(0);
    expect(dayTypeResolver({ meaning: "lights_on" })("2026-11-15")).toBe("all");
    expect(dayTypeResolver({ meaning: "opening" })("2026-11-15")).toBe("weekend");
    expect(dayTypeResolver({ meaning: "opening", opensOn: (date) => date !== "2026-11-16" })("2026-11-16")).toBe("closed");
  });

  const baseline = new Map(Array.from({ length: 24 }, (_, hour) => [`all|${hour}`, { median: 4, mad: 0.2, samples: 21 }]));
  const judged = new Set(["2026-11-18"]);
  const all = () => "all";

  it("flags at least 2 consecutive hours that strayed, with the hour that strayed most", () => {
    const cells = hours("2026-11-18T00", "2026-11-19T00", (date, hour) => [date, hour, hour === 22 ? 6.1 : hour === 23 ? 6.5 : hour === 10 ? 9 : 4.1, 60, 0, 0]);
    expect(patternEpisodes({ cells, baseline, dates: judged, dayTypeOf: all })).toEqual([{
      startDate: "2026-11-18", startHour: 22, endDate: "2026-11-19", endHour: 0, hours: 2, ongoing: true,
      direction: "high", peakDate: "2026-11-18", peakHour: 23, kwh: 6.5, usualKwh: 4,
    }]);
  });

  it("lets one hour do when a meter always on by design drops to about nothing", () => {
    const emergency = new Map(Array.from({ length: 24 }, (_, hour) => [`all|${hour}`, { median: 0.1, mad: 0, samples: 21 }]));
    const cells = hours("2026-11-18T00", "2026-11-19T00", (date, hour) => [date, hour, hour === 15 ? 0 : 0.1, 60, 0, 0]);
    expect(patternEpisodes({ cells, baseline: emergency, dates: judged, dayTypeOf: all })).toEqual([]);
    expect(patternEpisodes({ cells, baseline: emergency, dates: judged, dayTypeOf: all, alwaysOn: true })).toEqual([{
      startDate: "2026-11-18", startHour: 15, endDate: "2026-11-18", endHour: 16, hours: 1, ongoing: false,
      direction: "zero", peakDate: "2026-11-18", peakHour: 15, kwh: 0, usualKwh: 0.1,
    }]);
  });

  it("never judges hours that were offline, not read on time or sent late: they break a run", () => {
    const cells = hours("2026-11-18T00", "2026-11-19T00", (date, hour) => {
      if (hour === 21) return [date, hour, 7, 60, 0, 0.5];
      if (hour === 20) return [date, hour, 7, 40, 1, 0];
      return [date, hour, hour === 19 || hour === 22 ? 7 : 4, 60, 0, 0];
    });
    expect(patternEpisodes({ cells, baseline, dates: judged, dayTypeOf: all })).toEqual([]);
  });

  it("keeps small changes within max(50% of usual, 3 × MAD, 0.05 kWh) quiet, and only judges the given days", () => {
    const cells = hours("2026-11-17T00", "2026-11-19T00", (date, hour) => [date, hour, date === "2026-11-17" ? 9 : 5.9, 60, 0, 0]);
    expect(patternEpisodes({ cells, baseline, dates: judged, dayTypeOf: all })).toEqual([]);
  });
});
