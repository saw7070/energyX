/**
 * Lights-off time is not missing data. A Tuya meter reports its running total only when it moves, so a lighting
 * circuit's meter is quiet all day. These tests take Tuya readings through the fact writer and check what the site
 * then sees: Data availability, and the complete-day test behind the weekday/weekend and always-on figures.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { alwaysOnKw, scopeDays, type ScopeData } from "@datafoundry/site-report";

import { getDuckDbDatabase } from "../../../../packages/data-gateway/src/duckdb-database-cache.js";
import {
  ENERGY_FACT_WRITER_CONTRACT_VERSION,
  writeEnergyFactProjectMaterialization,
} from "../../../../packages/data-gateway/src/energy-fact-writer.js";
import { localDayStarts, summariseDataAvailability } from "./energy-data-availability.js";
import { decodeExplorerTrends, explorerTrendSql } from "./explorer-trends.js";

const TIMEZONE = "Asia/Singapore";
const HOUR = 3_600_000;
const root = mkdtempSync(join(tmpdir(), "energy-lights-off-"));
const databasePath = join(root, "facts.duckdb");
afterAll(async () => {
  const database = await getDuckDbDatabase(databasePath);
  await new Promise<void>((resolve) => database.close(() => resolve()));
  rmSync(root, { recursive: true, force: true });
});

const query = async (sql: string): Promise<Record<string, unknown>[]> => {
  const connection = (await getDuckDbDatabase(databasePath)).connect();
  try {
    return await new Promise((resolve, reject) => connection.all(sql, (error, rows) => error ? reject(error) : resolve(rows as Record<string, unknown>[])));
  } finally {
    await new Promise<void>((resolve) => connection.close(() => resolve()));
  }
};

type Reading = [time: string, kwh: number];
const at = (ms: number) => new Date(ms).toISOString();
/** Tuya totals are whole hundredths of a kWh. */
const kwh = (value: number) => Math.round(value * 100) / 100;

/** One meter's readings through the fact writer, then what Data availability and the site report make of them. */
const materialize = async (input: {
  projectId: string;
  readings: Reading[];
  dates: string[];
  kind?: "cumulative_energy_event" | "cumulative_energy";
}) => {
  const { projectId } = input;
  const sha = `${projectId}-sha`;
  await writeEnergyFactProjectMaterialization({
    databasePath,
    projectId,
    timezone: TIMEZONE,
    expectedPreviousDataSnapshotId: "unavailable",
    snapshotFactScope: {
      workspaceId: "workspace-1", projectId, dataSnapshotId: `${projectId}-snapshot`, manifestFingerprint: `${projectId}-fingerprint`,
      sourceSha256: [sha], factWriterContractVersion: ENERGY_FACT_WRITER_CONTRACT_VERSION,
    },
    batches: [{
      importBatchId: `${projectId}-batch`, sourceSha256: sha, rawReadings: [], intervalFacts: [], qualityEvents: [],
      normalizedReadings: input.readings.map(([eventTime, activeEnergyKwh], index) => ({
        workspaceId: "workspace-1", projectId, importBatchId: `${projectId}-batch`, resource: "electricity" as const,
        meterPointId: "lights", scopeId: "lights", sourceLabel: "264F Common Area Lighting", category: "light", meterRole: "total",
        eventTime, activeEnergyKwh, sourceFile: "tuya-report-logs.json", sourceSha256: sha, sourceRowNumber: index + 2,
        sourceReadingKind: input.kind ?? "cumulative_energy_event",
      })),
    }],
  });
  const facts = await query(`
    SELECT epoch_ms(interval_start) AS start_ms, epoch_ms(interval_end) AS end_ms, quality_status, usage_kwh
    FROM energy_interval_facts WHERE project_id = '${projectId}' ORDER BY interval_start
  `);
  const gapEvents = await query(`SELECT 1 FROM energy_quality_events WHERE project_id = '${projectId}' AND code = 'gap'`);
  const dayStarts = localDayStarts(input.dates[0]!, input.dates.at(-1)!, TIMEZONE);
  const fromMs = dayStarts[0]!, toMs = dayStarts.at(-1)! + 24 * HOUR;
  const intervals = facts.map((fact) => ({
    meterPointId: "lights",
    startMs: Number(fact.start_ms),
    endMs: Number(fact.end_ms),
    qualityStatus: String(fact.quality_status),
    usageKwh: fact.usage_kwh == null ? null : Number(fact.usage_kwh),
  }));
  const availability = summariseDataAvailability({
    fromMs, toMs, dayStartsMs: dayStarts,
    meters: [{ meterPointId: "lights", name: "264F Common Area Lighting" }],
    intervals,
    lastReadingAt: new Map(intervals.length ? [["lights", at(Math.max(...intervals.map((interval) => interval.endMs)))]] : []),
  }).meters[0]!;
  // The hourly series the site report reads, built by the same query the Energy consumption engine runs.
  await query(`CREATE OR REPLACE VIEW "${projectId}_facts" AS SELECT * FROM energy_interval_facts WHERE project_id = '${projectId}'`);
  const routes = [{ id: "site", meters: ["lights"] }];
  const series = decodeExplorerTrends(await query(explorerTrendSql(`${projectId}_facts`, routes)!), routes)[0]!;
  const scope: ScopeData = {
    id: projectId, name: "SKTC", dates: input.dates, timezone: TIMEZONE, total: series, types: {}, meters: [],
    usageKwh: null, peakKw: null, peakAt: null, cost: null, typeTotals: {}, coverage: null,
  };
  return { facts: intervals, gapEventCount: gapEvents.length, availability, days: scopeDays(scope, new Map()), alwaysOnKw: alwaysOnKw(scope) };
};

/** Usage between two instants. */
const usageBetween = (facts: Array<{ startMs: number; usageKwh: number | null }>, from: string, to: string) =>
  facts.filter((fact) => fact.startMs >= Date.parse(from) && fact.startMs < Date.parse(to)).reduce((sum, fact) => sum + (fact.usageKwh ?? 0), 0);

/**
 * A lighting circuit on 0.3 kW from 19:00 to 07:00 Singapore time (11:00 to 23:00 UTC), reporting on the hour while
 * its total moves. `quiet` decides what the meter sends by day.
 */
const lightingMeter = (input: { from: string; to: string; quiet: "nothing" | "same_total_at_09_utc" }): Reading[] => {
  const readings: Reading[] = [];
  let total = 120;
  for (let ms = Date.parse(input.from); ms <= Date.parse(input.to); ms += HOUR) {
    const utcHour = new Date(ms).getUTCHours();
    // The hour ending now was lit: 11:00-12:00 UTC is the first, 22:00-23:00 UTC the last.
    const litHourBefore = utcHour >= 12;
    if (litHourBefore) total = kwh(total + 0.3);
    if (litHourBefore || ms === Date.parse(input.from)) readings.push([at(ms), total]);
    else if (input.quiet === "same_total_at_09_utc" && utcHour === 9) readings.push([at(ms), total]);
  }
  return readings;
};

describe("lights-off time is not missing data", () => {
  it("counts ten hours in which a meter's total did not move as received, and the day as complete", async () => {
    // Lights off at 23:00 UTC; the same total is reported again at 09:00 UTC, ten hours later.
    const readings = lightingMeter({ from: "2026-11-02T16:00:00.000Z", to: "2026-11-07T16:00:00.000Z", quiet: "same_total_at_09_utc" });
    expect(readings).toContainEqual(["2026-11-04T23:00:00.000Z", readings.find(([time]) => time === "2026-11-05T09:00:00.000Z")![1]]);
    const result = await materialize({ projectId: "lights-off-unchanged", readings, dates: ["2026-11-04", "2026-11-05", "2026-11-06"] });

    // The quiet ten hours are real readings of no use, not an estimate and not a gap.
    const quiet = result.facts.filter((fact) => fact.startMs >= Date.parse("2026-11-04T23:00:00.000Z") && fact.startMs < Date.parse("2026-11-05T09:00:00.000Z"));
    expect(quiet).toHaveLength(40);
    expect(quiet.every((fact) => fact.qualityStatus === "ok" && fact.usageKwh === 0)).toBe(true);
    expect(result.facts.every((fact) => fact.qualityStatus === "ok")).toBe(true);
    expect(result.gapEventCount).toBe(0);

    expect(result.availability).toMatchObject({ status: "ok", availabilityPct: 100, estimatedHours: 0, missingHours: 0, longestOutageHours: 0, days: ["all", "all", "all"] });
    expect(result.days.map((day) => day.complete)).toEqual([true, true, true]);
    // Twelve lit hours a day at 0.3 kW, and the night hours give the always-on figure.
    expect(result.days.every((day) => Math.abs(day.totalKwh - 3.6) < 1e-6)).toBe(true);
    expect(result.alwaysOnKw).toBeCloseTo(0.3, 6);
  });

  it("reads the same day as complete when the meter sends nothing at all while the lights are off", async () => {
    const readings = lightingMeter({ from: "2026-11-02T16:00:00.000Z", to: "2026-11-07T16:00:00.000Z", quiet: "nothing" });
    const result = await materialize({ projectId: "lights-off-silent", readings, dates: ["2026-11-04", "2026-11-05", "2026-11-06"] });

    expect(result.facts.every((fact) => fact.qualityStatus === "ok")).toBe(true);
    expect(result.availability).toMatchObject({ availabilityPct: 100, days: ["all", "all", "all"] });
    expect(result.days.map((day) => day.complete)).toEqual([true, true, true]);
    // The lights' first evening hour lands in that hour, not spread over the quiet day.
    expect(usageBetween(result.facts, "2026-11-05T00:00:00.000Z", "2026-11-05T11:00:00.000Z")).toBeCloseTo(0, 6);
    expect(usageBetween(result.facts, "2026-11-05T11:00:00.000Z", "2026-11-05T12:00:00.000Z")).toBeCloseTo(0.3, 6);
  });

  it("keeps use after an unchanged total where it was read, and a large catch-up after silence as an estimate", async () => {
    const readings: Reading[] = [
      ["2026-11-04T16:00:00.000Z", 50],
      ["2026-11-04T17:00:00.000Z", 50.3],
      ["2026-11-04T18:00:00.000Z", 50.6],
      // The total does not move for ten hours, then the meter reports it again.
      ["2026-11-05T04:00:00.000Z", 50.6],
      // Use straight after: an hour at 0.3 kW, then one at 0.25 kW.
      ["2026-11-05T05:00:00.000Z", 50.9],
      ["2026-11-05T06:00:00.000Z", 51.15],
      // Silent for six hours, then back with far more than any hour holds: offline, so that energy is an estimate.
      ["2026-11-05T12:00:00.000Z", 53.15],
      ["2026-11-05T13:00:00.000Z", 53.45],
      ["2026-11-05T16:00:00.000Z", 53.45],
    ];
    const result = await materialize({ projectId: "lights-off-then-use", readings, dates: ["2026-11-05"] });
    const statusAt = (iso: string) => result.facts.find((fact) => fact.startMs === Date.parse(iso))?.qualityStatus;

    expect(statusAt("2026-11-04T18:00:00.000Z")).toBe("ok");
    expect(statusAt("2026-11-05T03:45:00.000Z")).toBe("ok");
    expect(usageBetween(result.facts, "2026-11-04T18:00:00.000Z", "2026-11-05T04:00:00.000Z")).toBeCloseTo(0, 6);
    expect(usageBetween(result.facts, "2026-11-05T04:00:00.000Z", "2026-11-05T05:00:00.000Z")).toBeCloseTo(0.3, 6);
    expect(usageBetween(result.facts, "2026-11-05T05:00:00.000Z", "2026-11-05T06:00:00.000Z")).toBeCloseTo(0.25, 6);
    // The six silent hours with 2 kWh in them stay estimated, as before.
    expect(statusAt("2026-11-05T06:00:00.000Z")).toBe("gap");
    expect(statusAt("2026-11-05T11:45:00.000Z")).toBe("gap");
    expect(statusAt("2026-11-05T12:00:00.000Z")).toBe("ok");
    expect(result.gapEventCount).toBe(1);
    expect(result.availability).toMatchObject({ estimatedHours: 6, estimatedKwh: 2, missingHours: 0 });
    expect(result.availability.availabilityPct).toBeCloseTo(75, 1);
    expect(result.days.map((day) => day.complete)).toEqual([false]);
  });

  it("still counts the time after a meter's last reading as missing", async () => {
    const readings = lightingMeter({ from: "2026-11-02T16:00:00.000Z", to: "2026-11-05T10:00:00.000Z", quiet: "same_total_at_09_utc" });
    // The meter's last reading is the unchanged total at 09:00 UTC on 5 Nov (17:00 in Singapore); nothing after it.
    expect(readings.at(-1)![0]).toBe("2026-11-05T09:00:00.000Z");
    const result = await materialize({ projectId: "lights-off-stopped", readings, dates: ["2026-11-04", "2026-11-05", "2026-11-06"] });

    expect(result.availability).toMatchObject({ status: "stopped", missingHours: 31, days: ["all", "some", "none"] });
    expect(result.availability.availabilityPct).toBeCloseTo((72 - 31) / 72 * 100, 1);
    expect(result.days.map((day) => day.complete)).toEqual([true, false, false]);
  });

  it("leaves a spreadsheet meter's long unchanged stretch marked as a gap, as before", async () => {
    // A regular 15-minute export that skips ten hours with the same total either side.
    const readings: Reading[] = [];
    for (let ms = Date.parse("2026-11-04T16:00:00.000Z"); ms <= Date.parse("2026-11-05T16:00:00.000Z"); ms += HOUR / 4) {
      if (ms > Date.parse("2026-11-04T23:00:00.000Z") && ms < Date.parse("2026-11-05T09:00:00.000Z")) continue;
      readings.push([at(ms), kwh(10 + (Math.min(ms, Date.parse("2026-11-04T23:00:00.000Z")) - Date.parse("2026-11-04T16:00:00.000Z")) / HOUR * 0.2)]);
    }
    const result = await materialize({ projectId: "spreadsheet-unchanged", readings, dates: ["2026-11-05"], kind: "cumulative_energy" });

    expect(result.facts.filter((fact) => fact.qualityStatus === "gap")).toEqual([
      expect.objectContaining({ startMs: Date.parse("2026-11-04T23:00:00.000Z"), endMs: Date.parse("2026-11-05T09:00:00.000Z"), usageKwh: 0 }),
    ]);
    expect(result.availability).toMatchObject({ estimatedHours: 10 });
    expect(result.days.map((day) => day.complete)).toEqual([false]);
  });
});
