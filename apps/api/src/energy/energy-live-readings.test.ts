import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ensureEnergyIqBootstrap } from "./energy-bootstrap.js";
import { pollLiveReadings, readLiveSiteReadings, recordLiveReadings } from "./energy-live-readings.js";
import type { EnergyTuyaProjectConnector } from "./energy-tuya-connector.js";
import { TUYA_OFFICE_PROJECT_ID } from "./tuya-office-project.js";

const OFFICIAL = ["panel-a-total", "panel-b-total", "panel-a-lighting", "panel-b-lighting", "panel-c-meter-01", "panel-c-meter-02", "panel-c-meter-03"];
// 10:00 Singapore time.
const T0 = Date.parse("2026-10-02T02:00:00.000Z");
const MIN = 60_000;

describe("Live readings", () => {
  it("works out power between two readings and energy used today, summed over the site's main meters", () => {
    withMetadata((metadata) => {
      const record = (readAt: number, energy: (index: number) => number) => recordLiveReadings({
        db: metadata.db,
        projectId: TUYA_OFFICE_PROJECT_ID,
        timezone: "Asia/Singapore",
        readAt,
        readings: OFFICIAL.map((meterPointId, index) => ({ meterPointId, energyKwh: energy(index) })),
      });
      record(T0, (index) => 100 + index);
      // 15 minutes later every meter has used 0.5 kWh: 2 kW each, 14 kW for the site.
      record(T0 + 15 * MIN, (index) => 100.5 + index);

      const live = readLiveSiteReadings({ metadataStore: metadata, projectId: TUYA_OFFICE_PROJECT_ID, now: T0 + 16 * MIN });
      expect(live).toMatchObject({
        powerKw: 14,
        todayKwh: 3.5,
        officialMeterCount: 7,
        reportingMeterCount: 7,
        readAt: new Date(T0 + 15 * MIN).toISOString(),
        intervalMinutes: 15,
      });
      expect(live.meters.find((meter) => meter.meterPointId === "panel-a-total")).toMatchObject({ powerKw: 2, todayKwh: 0.5, stale: false });
    });
  });

  it("gives no site total while a main meter is missing or out of date, rather than an undercount", () => {
    withMetadata((metadata) => {
      const record = (readAt: number, meters: string[], energy: number) => recordLiveReadings({
        db: metadata.db,
        projectId: TUYA_OFFICE_PROJECT_ID,
        timezone: "Asia/Singapore",
        readAt,
        readings: meters.map((meterPointId) => ({ meterPointId, energyKwh: energy })),
      });
      record(T0, OFFICIAL, 10);
      record(T0 + 15 * MIN, OFFICIAL.slice(1), 11);

      const live = readLiveSiteReadings({ metadataStore: metadata, projectId: TUYA_OFFICE_PROJECT_ID, now: T0 + 16 * MIN });
      expect(live.powerKw).toBeUndefined();
      expect(live.reportingMeterCount).toBe(6);
      // An hour later every reading is out of date.
      expect(readLiveSiteReadings({ metadataStore: metadata, projectId: TUYA_OFFICE_PROJECT_ID, now: T0 + 75 * MIN }))
        .toMatchObject({ reportingMeterCount: 0, meters: expect.arrayContaining([expect.objectContaining({ stale: true })]) });
    });
  });

  it("starts a new day from the reading just before midnight and starts over after a meter reset", () => {
    withMetadata((metadata) => {
      const midnight = Date.parse("2026-10-02T16:00:00.000Z"); // 00:00 on 3 October in Singapore.
      const record = (readAt: number, energyKwh: number) => recordLiveReadings({
        db: metadata.db,
        projectId: TUYA_OFFICE_PROJECT_ID,
        timezone: "Asia/Singapore",
        readAt,
        readings: [{ meterPointId: "panel-a-total", energyKwh }],
      });
      record(midnight - 10 * MIN, 50);
      record(midnight + 5 * MIN, 51);
      const meter = () => readLiveSiteReadings({ metadataStore: metadata, projectId: TUYA_OFFICE_PROJECT_ID, now: midnight + 6 * MIN })
        .meters.find((candidate) => candidate.meterPointId === "panel-a-total");
      expect(meter()).toMatchObject({ todayKwh: 1, powerKw: 4 });

      record(midnight + 20 * MIN, 0.2);
      expect(readLiveSiteReadings({ metadataStore: metadata, projectId: TUYA_OFFICE_PROJECT_ID, now: midnight + 21 * MIN })
        .meters.find((candidate) => candidate.meterPointId === "panel-a-total")).toEqual(expect.objectContaining({ todayKwh: 0 }));
      expect(readLiveSiteReadings({ metadataStore: metadata, projectId: TUYA_OFFICE_PROJECT_ID, now: midnight + 21 * MIN })
        .meters.find((candidate) => candidate.meterPointId === "panel-a-total")?.powerKw).toBeUndefined();
    });
  });
});

describe("Offline meters", () => {
  it("lists a meter Tuya keeps reporting offline, by name and since when, and drops it once it is back", async () => {
    await withMetadataAsync(async (metadata) => {
      const connector = {
        projectId: TUYA_OFFICE_PROJECT_ID,
        publishedDocument: { project: { timezone: "Asia/Singapore" } },
        devices: [{ deviceId: "dev-a", sourceLabel: "A" }, { deviceId: "dev-b", sourceLabel: "B" }],
        meterPoints: [{ meterPointId: "panel-a-total", sourceLabel: "A" }, { meterPointId: "panel-b-total", sourceLabel: "B" }],
      } as unknown as EnergyTuyaProjectConnector;
      const poll = (at: number, bOnline: boolean) => pollLiveReadings({
        metadataStore: metadata,
        connector,
        readLatestEnergy: async () => [{ sourceLabel: "A", energyKwh: 10 + at / 1e12 }, { sourceLabel: "B", energyKwh: 20 }],
        listDevices: async () => [{ id: "dev-a", online: true }, { id: "dev-b", online: bOnline }, { id: "someone-else", online: false }],
        now: () => at,
      });
      await poll(T0, true);
      await poll(T0 + 15 * MIN, false);
      await poll(T0 + 30 * MIN, false);
      await poll(T0 + 45 * MIN, false);
      const live = readLiveSiteReadings({ metadataStore: metadata, projectId: TUYA_OFFICE_PROJECT_ID, now: T0 + 46 * MIN });
      expect(live.offline).toEqual([{ meterPointId: "panel-b-total", name: expect.any(String), since: new Date(T0 + 15 * MIN).toISOString() }]);
      await poll(T0 + 60 * MIN, true);
      expect(readLiveSiteReadings({ metadataStore: metadata, projectId: TUYA_OFFICE_PROJECT_ID, now: T0 + 61 * MIN }).offline).toEqual([]);
    });
  });

  it("keeps the power readings when the status check fails", async () => {
    await withMetadataAsync(async (metadata) => {
      const connector = {
        projectId: TUYA_OFFICE_PROJECT_ID,
        publishedDocument: { project: { timezone: "Asia/Singapore" } },
        devices: [{ deviceId: "dev-a", sourceLabel: "A" }],
        meterPoints: [{ meterPointId: "panel-a-total", sourceLabel: "A" }],
      } as unknown as EnergyTuyaProjectConnector;
      const result = await pollLiveReadings({
        metadataStore: metadata, connector, now: () => T0,
        readLatestEnergy: async () => [{ sourceLabel: "A", energyKwh: 10 }],
        listDevices: async () => { throw new Error("ENERGYIQ_TUYA_API_ERROR:1010"); },
      });
      expect(result).toEqual({ read: 1, failed: 0 });
      expect(readLiveSiteReadings({ metadataStore: metadata, projectId: TUYA_OFFICE_PROJECT_ID, now: T0 + MIN }).meters).toHaveLength(1);
    });
  });
});

const withMetadata = (run: (metadata: ReturnType<typeof createMetadataStore>) => void): void => {
  const root = mkdtempSync(join(tmpdir(), "energy-live-readings-"));
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  try {
    ensureEnergyIqBootstrap(metadata);
    run(metadata);
  } finally {
    metadata.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};

const withMetadataAsync = async (run: (metadata: ReturnType<typeof createMetadataStore>) => Promise<void>): Promise<void> => {
  const root = mkdtempSync(join(tmpdir(), "energy-live-readings-"));
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  try {
    ensureEnergyIqBootstrap(metadata);
    await run(metadata);
  } finally {
    metadata.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};
