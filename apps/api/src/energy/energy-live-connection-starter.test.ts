import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ensureEnergyIqBootstrap } from "./energy-bootstrap.js";
import { inspectEnergyTuyaArtifact } from "./energy-tuya-import.js";
import {
  buildLiveConnectionStarter,
  liveDeviceRef,
  resolveLiveConnectionDeviceList,
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
  it("keeps the chosen devices' recent readings as Tuya report logs with one unique meter label per device", async () => {
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

      // Tuya's own report logs, imported like the daily update's, so uneven Tuya timing is resampled, not rejected.
      expect(starter.filename).toMatch(/^tuya-start-\d{4}-\d{2}-\d{2}\.json$/u);
      expect(JSON.parse(starter.content.toString("utf8"))).toMatchObject({ schemaVersion: TUYA_REPORT_LOG_ARTIFACT_VERSION, provider: "tuya" });
      const inspection = inspectEnergyTuyaArtifact(starter.content);
      expect(inspection).toMatchObject({ readingKind: "cumulative", validRowCount: 9, invalidRowCount: 0 });
      expect(inspection.sourceLabels.map((label) => label.label).sort()).toEqual(["Meter", "Meter (2)", "Pantry, kitchen"]);
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

  it("names the meters from the site's own device list when labels are given", async () => {
    await withStarter(async ({ deps, syncs }) => {
      const refs = ["aircon0001device", "lights0002device", "pantry0004device"].map((id) => liveDeviceRef(PROJECT_ID, id));
      const starter = await buildLiveConnectionStarter(deps, {
        projectId: PROJECT_ID,
        deviceRefs: refs,
        labels: ["264E Lighting L1", " 264E  Lighting L1 ", "Pantry"],
      });
      expect(syncs[0]!.devices.map((device) => device.sourceLabel)).toEqual(["264E Lighting L1", "264E Lighting L1 (2)", "Pantry"]);
      expect(starter.devices.map((device) => device.sourceLabel)).toEqual(["264E Lighting L1", "264E Lighting L1 (2)", "Pantry"]);
      expect(inspectEnergyTuyaArtifact(starter.content).sourceLabels.map((label) => label.label).sort())
        .toEqual(["264E Lighting L1", "264E Lighting L1 (2)", "Pantry"]);

      for (const labels of [["Only one"], [1, 2, 3], ["A", "", "C"], "A,B,C", ["A", "B", "x".repeat(121)]]) {
        await expect(buildLiveConnectionStarter(deps, { projectId: PROJECT_ID, deviceRefs: refs, labels }))
          .rejects.toThrow("ENERGYIQ_LIVE_STARTER_LABELS_INVALID");
      }
    });
  });

  it("checks a pasted device list against the account: found, not found, gateway, listed twice and invalid rows", async () => {
    await withStarter(async ({ deps }) => {
      const result = await resolveLiveConnectionDeviceList(deps, {
        projectId: PROJECT_ID,
        rows: [
          { name: " 264E  Lighting L1 ", deviceId: " aircon0001device ", area: "264E", equipment: "Corridor lights" },
          { name: "264F Lighting L1", deviceId: "missing0009device", area: "264F" },
          { name: "Hub", deviceId: "gateway003device" },
          { name: "Again", deviceId: "aircon0001device" },
          { name: "Bad id", deviceId: "x" },
          { name: "", deviceId: "lights0002device" },
          { name: "Pantry", deviceId: "pantry0004device", area: 7 },
        ],
      });
      expect(result.found).toBe(2);
      expect(result.rows).toEqual([
        { line: 1, name: "264E Lighting L1", area: "264E", equipment: "Corridor lights", status: "found", ref: liveDeviceRef(PROJECT_ID, "aircon0001device"), tuyaName: "Meter", online: true },
        { line: 2, name: "264F Lighting L1", area: "264F", status: "not_found" },
        { line: 3, name: "Hub", status: "gateway", tuyaName: "Zigbee hub", online: true },
        { line: 4, name: "Again", status: "duplicate" },
        { line: 5, name: "Bad id", status: "invalid" },
        { line: 6, name: "", status: "invalid" },
        { line: 7, name: "Pantry", status: "found", ref: liveDeviceRef(PROJECT_ID, "pantry0004device"), tuyaName: "Pantry, kitchen", online: true },
      ]);
      // Device ids are not sent back.
      expect(JSON.stringify(result)).not.toContain("pantry0004device");

      for (const rows of [[], "rows", [null], Array.from({ length: 201 }, () => ({ name: "A", deviceId: "aircon0001device" }))]) {
        await expect(resolveLiveConnectionDeviceList(deps, { projectId: PROJECT_ID, rows }))
          .rejects.toThrow("ENERGYIQ_LIVE_DEVICE_LIST_INVALID");
      }
      await expect(resolveLiveConnectionDeviceList(deps, { projectId: TUYA_OFFICE_PROJECT_ID, rows: [{ name: "A", deviceId: "aircon0001device" }] }))
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
