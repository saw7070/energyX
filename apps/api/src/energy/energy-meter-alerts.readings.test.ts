import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureEnergyIqBootstrap } from "./energy-bootstrap.js";
import { MeterAlertStore } from "./energy-meter-alert-store.js";
import { evaluateMeterAlerts, readMeterAlertReadings } from "./energy-meter-alerts.js";
import { materializeTestProjectSnapshot } from "./energy-test-materialization.js";

/**
 * The meter alerts read from a real fact store: the sample office (Ngee Ann) with four meters reading every 15 minutes
 * for four weeks, one of which stopped at 10:30 the day before the newest readings.
 */
const PROJECT = "ngee-ann-polytechnic";
const METERS = [
  ["mapping-lvl-6-total-office-light-8", "l6-total-light"],
  ["mapping-lvl-7-total-office-light-17", "l7-total-light"],
  ["mapping-lvl-6-total-office-load-9", "l6-total-load"],
  ["mapping-lvl-7-total-office-load-18", "l7-total-load"],
] as const;
const STOPPED = METERS[3][0];
const SHA = "c".repeat(64);
const sg = (local: string) => Date.parse(`${local}:00+08:00`);

const facts = () => {
  const rows = [];
  let row = 0;
  for (let at = sg("2026-10-20T00:00"); at < sg("2026-11-18T02:00"); at += 15 * 60_000) {
    for (const [meterPointId, scopeId] of METERS) {
      if (meterPointId === STOPPED && at >= sg("2026-11-17T10:30")) continue;
      row += 1;
      rows.push({
        workspaceId: "default", projectId: PROJECT, importBatchId: "meter-alert-fixture", resource: "electricity" as const,
        meterPointId, scopeId, sourceLabel: meterPointId, category: "load", meterRole: "total",
        intervalStart: new Date(at).toISOString(), intervalEnd: new Date(at + 15 * 60_000).toISOString(), elapsedMinutes: 15,
        activeEnergyKwh: row, previousActiveEnergyKwh: row - 1, rawDeltaKwh: 0.25, usageKwh: 0.25, averageKw: 1,
        qualityStatus: "ok", localDate: new Date(at + 8 * 3_600_000).toISOString().slice(0, 10), localHour: new Date(at + 8 * 3_600_000).getUTCHours(),
        dayType: "weekday", sourceFile: "fixture.xlsx", sourceSha256: SHA, sourceReadingKind: "interval_usage" as const,
      });
    }
  }
  return rows;
};

describe("meter alerts from the fact store", () => {
  const previousDuckDb = process.env.ENERGYIQ_DUCKDB_PATH;
  let root: string;
  let metadata: ReturnType<typeof createMetadataStore>;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "energy-meter-alerts-readings-"));
    process.env.ENERGYIQ_DUCKDB_PATH = join(root, "energy.duckdb");
    metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    ensureEnergyIqBootstrap(metadata);
    await materializeTestProjectSnapshot({
      metadataStore: metadata, databasePath: join(root, "energy.duckdb"), workspaceId: "default", projectId: PROJECT, timezone: "Asia/Singapore",
      batches: [{ importBatchId: "meter-alert-fixture", sourceSha256: SHA, rawReadings: [], normalizedReadings: [], intervalFacts: facts(), qualityEvents: [] }],
    });
  }, 120_000);

  afterEach(() => {
    metadata.close();
    if (previousDuckDb === undefined) delete process.env.ENERGYIQ_DUCKDB_PATH;
    else process.env.ENERGYIQ_DUCKDB_PATH = previousDuckDb;
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it("reads each meter's hourly readings and last reading, and finds the one that stopped", async () => {
    const now = new Date(sg("2026-11-18T03:00"));
    const readings = await readMeterAlertReadings(metadata, PROJECT, now);
    expect(readings.timezone).toBe("Asia/Singapore");
    expect(readings.referenceMs).toBe(sg("2026-11-18T02:00"));
    expect(readings.dataSnapshotId).toBe(metadata.energyIq.findCurrentDataSnapshot(PROJECT)?.id);
    const meter = (id: string) => readings.meters.find((item) => item.id === id)!;
    expect(meter(STOPPED).lastReadingAt).toBe(new Date(sg("2026-11-17T10:30")).toISOString());
    expect(meter(METERS[0][0]).lastReadingAt).toBe(new Date(sg("2026-11-18T02:00")).toISOString());
    expect(meter(STOPPED).name).toBeTruthy();
    // An hour read in full: four 15-minute readings of 0.25 kWh.
    expect(readings.cells.get(METERS[0][0])!.find((cell) => cell[0] === "2026-11-17" && cell[1] === 9)).toEqual(["2026-11-17", 9, 1, 60, 0, 0]);
    expect(readings.cells.get(STOPPED)!.find((cell) => cell[0] === "2026-11-17" && cell[1] === 10)).toEqual(["2026-11-17", 10, 0.5, 30, 0, 0]);

    const store = new MeterAlertStore(metadata.db);
    const changes = evaluateMeterAlerts({ store, projectId: PROJECT, readings, patternAlerts: true, now });
    expect(changes.opened.filter((alert) => alert.kind === "meter_offline").map((alert) => [alert.subject, alert.payload.since]))
      .toEqual([[STOPPED, new Date(sg("2026-11-17T10:30")).toISOString()]]);
  }, 120_000);
});
