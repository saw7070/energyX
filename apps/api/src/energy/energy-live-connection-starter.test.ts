import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ensureEnergyIqBootstrap } from "./energy-bootstrap.js";
import { inspectEnergyExcelWorkbook, readEnergyExcelWorkbook } from "./energy-excel-import.js";
import {
  buildLiveConnectionStarter,
  liveDeviceRef,
  saveLiveConnectionAccount,
  type LiveConnectionDependencies,
} from "./energy-live-connection.js";
import {
  TUYA_REPORT_LOG_ARTIFACT_VERSION,
  TUYA_SINGAPORE_ENDPOINT,
  type TuyaDeviceSummary,
  type TuyaEnergySyncInput,
  type TuyaOpenApiClient,
} from "./tuya-openapi-client.js";
import { TUYA_OFFICE_PROJECT_ID, TUYA_OFFICE_WORKSPACE_ID } from "./tuya-office-project.js";

const ACCESS_ID = "abcd1234efgh5678ijkl";
const ACCESS_SECRET = "secretsecretsecretsecret12345678";
const PROJECT_ID = "new-site";
// 2026-11-06 00:00 in Singapore.
const NOW = Date.parse("2026-11-05T16:00:00.000Z");

const DEVICES: TuyaDeviceSummary[] = [
  { id: "aircon0001device", name: "Meter", productName: "Smart meter", online: true },
  { id: "lights0002device", name: "Meter", productName: "Smart meter", online: true },
  { id: "gateway003device", name: "Zigbee hub", productName: "Zigbee Gateway", category: "wg2", online: true },
  { id: "pantry0004device", name: "Pantry, kitchen", productName: "Smart meter", online: true },
];

describe("Start a site from Tuya", () => {
  it("turns the chosen devices' recent readings into a readings file with one unique meter label per device", async () => {
    await withStarter(async ({ deps, syncs }) => {
      const refs = ["aircon0001device", "lights0002device", "pantry0004device"].map((id) => liveDeviceRef(PROJECT_ID, id));
      const starter = await buildLiveConnectionStarter(deps, { projectId: PROJECT_ID, deviceRefs: refs });

      expect(syncs).toHaveLength(1);
      expect(syncs[0]).toMatchObject({ startTime: NOW - 7 * 86_400_000, endTime: NOW });
      expect(syncs[0]!.devices.map((device) => device.sourceLabel)).toEqual(["Meter", "Meter (2)", "Pantry, kitchen"]);
      expect(starter.devices).toEqual([
        { ref: refs[0], sourceLabel: "Meter", readings: 3 },
        { ref: refs[1], sourceLabel: "Meter (2)", readings: 3 },
        { ref: refs[2], sourceLabel: "Pantry, kitchen", readings: 3 },
      ]);
      // Device ids never leave the server.
      expect(JSON.stringify(starter.devices)).not.toContain("aircon0001device");

      const text = starter.content.toString("utf8");
      expect(text.split("\r\n")[0]).toBe("Device Name,Time,Active Energy");
      // Times are the site's wall clock (Singapore), names with commas are quoted.
      expect(text).toContain("\"Pantry, kitchen\",2026-11-05 08:00:00,");
      const workbook = await readEnergyExcelWorkbook(starter.content);
      expect(workbook.inspection).toMatchObject({ readingKind: "cumulative", validRowCount: 9, invalidRowCount: 0 });
      expect(workbook.inspection.sourceLabels.map((label) => label.label).sort()).toEqual(["Meter", "Meter (2)", "Pantry, kitchen"]);
      expect((await inspectEnergyExcelWorkbook(starter.content)).typicalIntervalMinutes).toBe(60);
    });
  });

  it("refuses gateways, unknown devices, bad windows, and sites that already have meters", async () => {
    await withStarter(async ({ deps }) => {
      const ref = (id: string) => liveDeviceRef(PROJECT_ID, id);
      await expect(buildLiveConnectionStarter(deps, { projectId: PROJECT_ID, deviceRefs: [ref("gateway003device")] }))
        .rejects.toThrow("ENERGYIQ_LIVE_STARTER_GATEWAY");
      await expect(buildLiveConnectionStarter(deps, { projectId: PROJECT_ID, deviceRefs: ["not-a-ref"] }))
        .rejects.toThrow("ENERGYIQ_LIVE_DEVICE_NOT_FOUND");
      await expect(buildLiveConnectionStarter(deps, { projectId: PROJECT_ID, deviceRefs: [] }))
        .rejects.toThrow("ENERGYIQ_LIVE_STARTER_DEVICES_INVALID");
      await expect(buildLiveConnectionStarter(deps, { projectId: PROJECT_ID, deviceRefs: [ref("aircon0001device")], days: 30 }))
        .rejects.toThrow("ENERGYIQ_LIVE_STARTER_DAYS_INVALID");
      await expect(buildLiveConnectionStarter(deps, { projectId: TUYA_OFFICE_PROJECT_ID, deviceRefs: [ref("aircon0001device")] }))
        .rejects.toThrow("ENERGYIQ_LIVE_STARTER_SETUP_EXISTS");
    });
  });

  it("says so when the devices sent no readings in the window", async () => {
    await withStarter(async ({ deps }) => {
      await expect(buildLiveConnectionStarter(deps, { projectId: PROJECT_ID, deviceRefs: [liveDeviceRef(PROJECT_ID, "aircon0001device")] }))
        .rejects.toThrow("ENERGYIQ_LIVE_STARTER_NO_READINGS");
    }, { silent: true });
  });
});

const withStarter = async (
  run: (harness: { deps: LiveConnectionDependencies; syncs: TuyaEnergySyncInput[] }) => Promise<void>,
  options: { silent?: boolean } = {},
): Promise<void> => {
  const root = mkdtempSync(join(tmpdir(), "energy-live-starter-"));
  const metadata = createMetadataStore({
    database_path: join(root, "metadata.sqlite"),
    secret_master_key: "test-master-key-for-live-starter",
  });
  try {
    ensureEnergyIqBootstrap(metadata);
    metadata.energyIq.upsertProject({ id: PROJECT_ID, workspace_id: TUYA_OFFICE_WORKSPACE_ID, name: "New site", status: "draft", timezone: "Asia/Singapore" });
    const syncs: TuyaEnergySyncInput[] = [];
    const client: TuyaOpenApiClient = {
      listDevices: async () => DEVICES,
      checkEnergyDevice: async () => ({ ok: true, phases: 1 }),
      readLatestEnergy: async () => { throw new Error("NOT_USED"); },
      syncEnergyReadings: async (input) => {
        syncs.push(input);
        return {
          schemaVersion: TUYA_REPORT_LOG_ARTIFACT_VERSION,
          provider: "tuya",
          region: "sg",
          endpoint: TUYA_SINGAPORE_ENDPOINT,
          createdAt: new Date(NOW).toISOString(),
          request: { startTime: input.startTime, endTime: input.endTime, codes: ["total_forward_energy"], deviceCount: input.devices.length },
          devices: input.devices.map((device, index) => ({
            sourceLabel: device.sourceLabel,
            properties: { totalForwardEnergy: { code: "total_forward_energy", scale: 2, unit: "kWh" } },
            logs: options.silent ? [] : [0, 1, 2].map((hour) => ({
              code: "total_forward_energy",
              eventTime: Date.parse("2026-11-05T00:00:00.000Z") + hour * 3_600_000,
              value: String(100_000 * (index + 1) + hour * 150),
            })),
          })),
        };
      },
    };
    const deps: LiveConnectionDependencies = { metadataStore: metadata, createClient: () => client, now: () => NOW, env: {} };
    const user = metadata.users.createPasswordUser({ id: "admin", email: "admin@energyx.test" });
    await saveLiveConnectionAccount(deps, { projectId: PROJECT_ID, user, accessId: ACCESS_ID, accessSecret: ACCESS_SECRET });
    await run({ deps, syncs });
  } finally {
    metadata.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};
