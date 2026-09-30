import { describe, expect, it } from "vitest";
import type { EnergyScopeAnalysisDto } from "../../../lib/config-api";
import type { DeviceStatistics } from "./device-statistics";
import { boardTotalNote, deviceFindings, energyBreakdown, formatPeriod, parseDevicesView, siteFindings, summariseDevices, tariffRate, withShortDays, type DeviceRow } from "./site-devices";

const health = (coveragePct: number, validIntervalCount = 100) => ({ coveragePct, expectedMeterIntervalCount: 100, validIntervalCount, qualityEventCount: 0 });
const circuit = (meterNodeId: string, usageKwh: number, coveragePct: number) => ({ meterNodeId, name: meterNodeId, appliance: "load", category: "load", meterRole: "component", usageKwh, sharePct: 0, peakKw: 0.5, qualityEventCount: 0, dataHealth: health(coveragePct) });
const meter = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, scopeId: "db1", kind: "physical" as const, role: "component", coverage: "whole", category: "load", includedInOfficialTotal: true, ...extra });

const analysis = {
  context: { from: "2026-08-13T16:00:00.000Z", to: "2026-09-10T16:00:00.000Z", timezone: "Asia/Singapore" },
  summary: { usageKwh: 2309.07 },
  circuits: [circuit("board", 218.8, 90.2), circuit("conow", 486.3, 99), circuit("tv", 8.9, 86)],
  explorerMeters: [
    meter("board", "DB1 L1 Power", { role: "total", circuitName: "DB1 L1 Power" }),
    meter("conow", "Showroom Conow", { circuitName: "L2P14" }),
    meter("tv", "TV Meeting Room 2", { category: "light" }),
    meter("director", "Director Room Power"),
    meter("other", "DB1 Other Consumption", { kind: "virtual" }),
  ],
} as unknown as EnergyScopeAnalysisDto;

describe("summariseDevices", () => {
  it("lists physical devices with plain status and keeps calculated meters out of the list", () => {
    const summary = summariseDevices(analysis);
    expect(summary.rows.map(row => row.name)).toEqual(["DB1 L1 Power", "Showroom Conow", "TV Meeting Room 2", "Director Room Power"]);
    expect(summary.calculatedCount).toBe(1);
    expect([summary.reporting, summary.gaps, summary.silent]).toEqual([1, 2, 1]);
    expect(summary.siteUsageKwh).toBe(2309.07);
  });

  it("marks a meter that went quiet as stopped, with the reading it last sent", () => {
    // The four Tuya Office circuits looked healthy inside the window while they
    // had already stopped sending, because the window ends before they did.
    const stopped = {
      ...analysis,
      reportingHealth: {
        latestReadingAt: "2026-09-24T00:45:00.000Z",
        shortDays: [],
        stoppedMeters: [{ meterNodeId: "conow", lastReadingAt: "2026-09-23T08:45:00.000Z" }],
      },
    } as unknown as EnergyScopeAnalysisDto;
    const summary = summariseDevices(stopped);
    const rows = new Map(summary.rows.map(row => [row.id, row]));

    expect(rows.get("conow")).toMatchObject({ status: "stopped", stoppedAt: "2026-09-23T08:45:00.000Z" });
    // Coverage inside the window is still full, which is exactly why it read as healthy.
    expect(rows.get("conow")?.coveragePct).toBe(99);
    expect(summary.stopped).toBe(1);
    expect(summary.reporting).toBe(0);
    // A meter with no readings at all is still silent, not stopped.
    expect(rows.get("director")?.status).toBe("silent");
  });

  it("marks board totals, shows circuit labels only when they add information and leaves missing usage empty", () => {
    const rows = new Map(summariseDevices(analysis).rows.map(row => [row.id, row]));
    expect(rows.get("board")).toMatchObject({ isBoardTotal: true, status: "gaps" });
    expect(rows.get("board")?.circuit).toBeUndefined();
    expect(rows.get("conow")).toMatchObject({ circuit: "L2P14", status: "reporting", usageKwh: 486.3 });
    expect(rows.get("tv")?.type).toBe("Lighting");
    expect(rows.get("director")).toMatchObject({ status: "silent", usageKwh: null, peakKw: null });
  });

  it("treats a usage row without accepted intervals as no readings", () => {
    const silent = { ...analysis, circuits: [{ ...circuit("conow", 0, 0), dataHealth: health(0, 0) }] } as unknown as EnergyScopeAnalysisDto;
    expect(summariseDevices(silent).rows.find(row => row.id === "conow")?.status).toBe("silent");
  });
});

describe("energyBreakdown", () => {
  it("replaces an overlapping board total with its unmetered remainder so the pieces add up", () => {
    const rows = summariseDevices(analysis).rows;
    const shares = energyBreakdown(rows, new Map([["db1", "DB1"]]));
    // DB1 L1 Power (218.8, load total) minus its load devices Showroom Conow (486.3) would be negative, so no remainder;
    // TV Meeting Room 2 is lighting and has no lighting total on this board, so it stands on its own.
    expect(shares.map(share => share.id)).toEqual(["conow", "tv"]);
    const balanced = energyBreakdown(rows.map(row => row.id === "board" ? { ...row, usageKwh: 600 } : row), new Map([["db1", "DB1"]]));
    const rest = balanced.find(share => share.unmetered);
    expect(rest).toMatchObject({ id: "board:rest", name: "Other DB1 power circuits", unmetered: true });
    expect(rest?.kwh).toBeCloseTo(600 - 486.3);
  });
});

describe("tariffRate", () => {
  it("uses the average rate actually charged and reports GST still to add", () => {
    const cost = { status: "available", amount: 736.82, currency: "SGD", tariffScheduleVersion: "t", allocations: [{ from: "", to: "", ratePerKwh: 0.3191, rateBasis: "tax_exclusive", tax: { name: "GST", ratePct: 9 }, usageKwh: 2309.07, cost: 736.82 }] };
    expect(tariffRate({ cost } as never)).toEqual({ rate: expect.closeTo(0.3191, 4), gstPct: 9 });
    expect(tariffRate({ cost: { status: "unavailable" } } as never)).toBeNull();
  });
});

describe("siteFindings", () => {
  it("names the biggest user, the after-hours runner and silent devices in plain words", () => {
    const rows = summariseDevices(analysis).rows;
    const stat = (outOfHoursPct: number, alwaysOnKw: number) => ({ outOfHoursKwh: 300, outOfHoursPct, alwaysOnKw }) as DeviceStatistics;
    const findings = siteFindings({ rows, stats: new Map([["conow", stat(70, 0.5)], ["tv", stat(10, 0.2)]]), shares: energyBreakdown(rows, new Map()), siteKwh: 2309.07, rate: 0.3191, openingHours: "Mon–Fri 09:00–18:00" });
    expect(findings.map(finding => finding.title)).toEqual([
      "Showroom Conow is the biggest single user",
      "Showroom Conow mostly runs after working hours",
      "TV Meeting Room 2 never really switches off",
      "1 device sent no readings",
    ]);
    expect(findings[1]!.detail).toContain("Worth checking");
    expect(findings[3]!.detail).toContain("Director Room Power");
  });
  it("names the meters that stopped sending and when the first one went quiet", () => {
    const rows = summariseDevices({
      ...analysis,
      reportingHealth: {
        latestReadingAt: "2026-09-24T00:45:00.000Z",
        shortDays: [],
        stoppedMeters: [
          { meterNodeId: "conow", lastReadingAt: "2026-09-23T08:45:00.000Z" },
          { meterNodeId: "tv", lastReadingAt: "2026-09-23T13:15:00.000Z" },
        ],
      },
    } as unknown as EnergyScopeAnalysisDto).rows;
    const findings = siteFindings({ rows, stats: new Map(), shares: energyBreakdown(rows, new Map()), siteKwh: 2309.07, rate: 0.3191, openingHours: null, timezone: "Asia/Singapore" });
    const stopped = findings.find(finding => finding.title.includes("stopped sending"));

    expect(stopped?.title).toBe("2 of 4 meters stopped sending");
    // The site's own clock, not UTC: 08:45Z is a quarter to five in the afternoon in Singapore.
    expect(stopped?.detail).toContain("23 Sept, 4:45 pm");
    expect(stopped?.detail).toContain("Showroom Conow");
    expect(stopped?.detail).toContain("TV Meeting Room 2");
    expect(stopped?.icon).toBe("alert");
  });
});

describe("boardTotalNote", () => {
  it("does not claim a lighting total contains the board's power devices", () => {
    expect(boardTotalNote("Lighting")).toBe("Total lighting for this board");
    expect(boardTotalNote("Power")).toContain("including the power devices");
  });
});

describe("formatPeriod", () => {
  it("shows the inclusive last day of an end-exclusive window in the project timezone", () => {
    expect(formatPeriod("2026-08-13T16:00:00.000Z", "2026-09-10T16:00:00.000Z", "Asia/Singapore")).toBe("14 Aug – 10 Sept 2026");
  });
});

describe("parseDevicesView", () => {
  const rows = [{ id: "m1", boardId: "db1" }, { id: "m2", boardId: "db2" }] as DeviceRow[];
  it("opens a board or a device from the address and falls back to the whole site", () => {
    expect(parseDevicesView("board:db2", rows)).toEqual({ kind: "board", id: "db2" });
    expect(parseDevicesView("device:m1", rows)).toEqual({ kind: "device", id: "m1" });
    expect(parseDevicesView("device:gone", rows)).toEqual({ kind: "site" });
    expect(parseDevicesView("board:db9", rows)).toEqual({ kind: "site" });
    expect(parseDevicesView(null, rows)).toEqual({ kind: "site" });
  });
});

describe("deviceFindings", () => {
  const row = { id: "m1", name: "Showroom Conow", boardId: "db2", category: "load", type: "Power", isBoardTotal: false, usageKwh: 500, peakKw: 1, coveragePct: 99, status: "reporting" } as DeviceRow;
  const base = { daily: [], profileKw: [], openProfileKw: [], closedProfileKw: [], openDays: 20, closedDays: 8, outOfHoursKwh: 100, outOfHoursPct: 20, alwaysOnKw: 0.01, dailyAverageKwh: 18, openDayAverageKwh: 20, closedDayAverageKwh: 5, receivedPct: 99 } as DeviceStatistics;
  it("says plainly when nothing stands out", () => {
    expect(deviceFindings({ row, stat: base, rate: 0.3, openingHours: "Mon–Fri 09:00–18:00" }).map(item => item.title)).toEqual(["Nothing unusual"]);
  });
  it("flags after-hours running, a constant baseline, busy closed days and missing readings", () => {
    const findings = deviceFindings({ row, stat: { ...base, outOfHoursKwh: 360, outOfHoursPct: 72, alwaysOnKw: 0.7, closedDayAverageKwh: 17, receivedPct: 90 }, rate: 0.3, openingHours: "Mon–Fri 09:00–18:00" });
    expect(findings.map(item => item.title)).toEqual(["Mostly runs after working hours", "Never really switches off", "Closed days use almost as much as open days", "Some readings are missing"]);
    expect(findings[0]!.detail).toBe("360 kWh (72% of its use) was outside Mon–Fri 09:00–18:00, about SGD 108. Worth checking whether it needs to run then.");
    expect(findings[1]!.detail).toContain("16.8 kWh a day, roughly SGD 1,840 a year");
  });
  it("gives the hour a meter stopped sending, so a reader knows what else was happening", () => {
    const findings = deviceFindings({ row: { ...row, status: "stopped", stoppedAt: "2026-09-23T08:45:00.000Z" }, stat: base, rate: 0.3, openingHours: null, timezone: "Asia/Singapore" });

    expect(findings[0]!.title).toBe("This meter stopped sending");
    expect(findings[0]!.detail).toContain("23 Sept, 4:45 pm");
    expect(findings[0]!.icon).toBe("alert");
  });

  it("explains that a board total overlaps its devices", () => {
    expect(deviceFindings({ row: { ...row, isBoardTotal: true }, stat: base, rate: null, openingHours: null })[0]!.title).toBe("This meter is a board total");
  });
});

describe("withShortDays", () => {
  const daily = [
    { date: "2026-09-21", kwh: 153.45, open: true, complete: true },
    { date: "2026-09-22", kwh: 157.8, open: true, complete: true },
  ];

  it("adds the day the window dropped, marked so no average can pick it up", () => {
    const merged = withShortDays(daily, [{ localDate: "2026-09-23", usageKwh: 136.46 }], null);

    expect(merged.map(day => day.date)).toEqual(["2026-09-21", "2026-09-22", "2026-09-23"]);
    expect(merged.at(-1)).toMatchObject({ kwh: 136.46, complete: false });
    // Every average on this page reads `complete`, so the day shows without moving a figure.
    expect(merged.filter(day => day.complete)).toHaveLength(2);
  });

  it("leaves a day the window already covers alone", () => {
    const merged = withShortDays(daily, [{ localDate: "2026-09-22", usageKwh: 100 }], null);

    expect(merged).toBe(daily);
    expect(merged.find(day => day.date === "2026-09-22")).toMatchObject({ kwh: 157.8, complete: true });
  });

  it("returns the original series when nothing fell short", () => {
    expect(withShortDays(daily, [], null)).toBe(daily);
  });
});
