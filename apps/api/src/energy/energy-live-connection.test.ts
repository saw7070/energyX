import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import type { ConfigApiContext } from "../routes/types.js";
import { ensureEnergyIqBootstrap } from "./energy-bootstrap.js";
import { handleEnergyApiRequest } from "./energy-api.js";
import { deleteEnergyProject } from "./energy-project-lifecycle.js";
import { resolveEnergyTuyaProjectConnector } from "./energy-tuya-connector.js";
import type { TuyaCredentials, TuyaDeviceSummary, TuyaOpenApiClient } from "./tuya-openapi-client.js";
import { TUYA_OFFICE_PROJECT_ID, TUYA_OFFICE_WORKSPACE_ID } from "./tuya-office-project.js";

const ACCESS_ID = "abcd1234efgh5678ijkl";
const ACCESS_SECRET = "secretsecretsecretsecret12345678";

describe("Live connection", () => {
  it("connects a Project's meters to Tuya without sending device ids or the key to the browser", async () => {
    await withLiveApi(async ({ metadata, call, devices, scheduler, clients }) => {
      const initial = await call("GET", []);
      expect(initial.status).toBe(200);
      expect(initial.body.data.connection).toMatchObject({ connected: false, publishedSetup: true, matchedCount: 0 });
      const meters = initial.body.data.connection.meters as Array<{ meterPointId: string }>;
      expect(meters).toHaveLength(devices.length);

      expect((await call("PUT", ["account"], { accessId: "no", accessSecret: ACCESS_SECRET })).body.error.message)
        .toBe("ENERGYIQ_LIVE_ACCESS_ID_INVALID");

      const saved = await call("PUT", ["account"], { accessId: ACCESS_ID, accessSecret: ACCESS_SECRET });
      expect(saved.status).toBe(200);
      expect(saved.body.data).toMatchObject({ deviceCount: devices.length, connection: { connected: true, accountHint: "abcd…ijkl" } });
      expect(clients.at(-1)).toEqual({ accessId: ACCESS_ID, accessSecret: ACCESS_SECRET });
      const sealed = JSON.stringify(metadata.db.prepare("SELECT * FROM encrypted_secrets").all());
      expect(sealed).not.toContain(ACCESS_SECRET);

      // Testing works as soon as the account is saved, before any meter is matched.
      const early = await call("POST", ["check"]);
      expect(early.body.data.check).toEqual({ ok: true, deviceCount: devices.length, meters: [] });

      const listed = await call("GET", ["devices"]);
      const listedText = JSON.stringify(listed.body);
      for (const device of devices) expect(listedText).not.toContain(device.id);
      const refs = listed.body.data.devices as Array<{ ref: string; name: string }>;
      const refByName = new Map(refs.map((device) => [device.name, device.ref]));
      const matches = Object.fromEntries(meters.map((meter, index) => [meter.meterPointId, refByName.get(devices[index]!.name)]));

      const matched = await call("PUT", ["matches"], { matches });
      expect(matched.body.data.connection).toMatchObject({ matchedCount: meters.length, ready: true });
      expect(JSON.stringify(matched.body)).not.toContain(devices[0]!.id);

      const connector = resolveEnergyTuyaProjectConnector({ metadataStore: metadata, projectId: TUYA_OFFICE_PROJECT_ID, env: {} });
      expect(connector).toMatchObject({
        managedBy: "app",
        credentials: { accessId: ACCESS_ID, accessSecret: ACCESS_SECRET },
        schedule: { enabled: false, localHour: 2 },
      });
      expect(connector.devices[0]).toEqual({ deviceId: devices[0]!.id, sourceLabel: expect.any(String) });

      const scheduled = await call("PUT", ["schedule"], { enabled: true, localHour: 3 });
      expect(scheduled.body.data.connection.schedule).toEqual({ enabled: true, localHour: 3, timezone: "Asia/Singapore" });

      const checked = await call("POST", ["check"]);
      expect(checked.body.data.check).toMatchObject({ ok: true });
      expect(checked.body.data.connection.lastCheck).toMatchObject({ ok: true });

      const synced = await call("POST", ["sync"]);
      expect(synced.status).toBe(202);
      expect(scheduler.requestSync).toHaveBeenCalledWith(TUYA_OFFICE_PROJECT_ID);

      const partial = await call("PUT", ["matches"], { matches: { [meters[0]!.meterPointId]: matches[meters[0]!.meterPointId] } });
      expect(partial.body.data.connection).toMatchObject({ matchedCount: 1, ready: false, schedule: { enabled: false } });
      expect((await call("POST", ["sync"])).body.error.message).toBe("ENERGYIQ_LIVE_METERS_NOT_MATCHED");
      expect((await call("PUT", ["schedule"], { enabled: true })).body.error.message).toBe("ENERGYIQ_LIVE_METERS_NOT_MATCHED");

      const removed = await call("DELETE", []);
      expect(removed.body.data.connection).toMatchObject({ connected: false });
      expect(metadata.db.prepare("SELECT COUNT(*) AS count FROM encrypted_secrets").get()).toEqual({ count: 0 });
    });
  });

  it("reports devices that do not send energy readings, and a refused account", async () => {
    await withLiveApi(async ({ call, devices, failures }) => {
      failures.list = new Error("ENERGYIQ_TUYA_API_ERROR:1004:sign_invalid");
      const refused = await call("PUT", ["account"], { accessId: ACCESS_ID, accessSecret: ACCESS_SECRET });
      expect(refused.status).toBe(400);
      expect(refused.body.error.message).toBe("ENERGYIQ_LIVE_ACCOUNT_REJECTED:ENERGYIQ_TUYA_API_ERROR:1004:sign_invalid");
      delete failures.list;

      await call("PUT", ["account"], { accessId: ACCESS_ID, accessSecret: ACCESS_SECRET });
      const refs = (await call("GET", ["devices"])).body.data.devices as Array<{ ref: string; name: string }>;
      const meters = (await call("GET", [])).body.data.connection.meters as Array<{ meterPointId: string }>;
      await call("PUT", ["matches"], {
        matches: Object.fromEntries(meters.map((meter, index) => [meter.meterPointId, refs.find((ref) => ref.name === devices[index]!.name)!.ref])),
      });
      failures.unsuitable = devices[1]!.id;
      devices.push(
        { id: "gatewaydevice01", name: "Level 2 gateway A", category: "wg2", online: true },
        { id: "gatewaydevice02", name: "Level 1 gateway B", category: "wg2", online: false },
      );
      const checked = await call("POST", ["check"]);
      expect(checked.body.data.check.gateways).toEqual({ total: 2, online: 1, offline: ["Level 1 gateway B"] });
      expect(checked.body.data.check.ok).toBe(false);
      expect(checked.body.data.check.meters).toContainEqual({
        meterPointId: meters[1]!.meterPointId,
        ok: false,
        reason: "ENERGYIQ_TUYA_PROPERTY_REQUIRED:total_forward_energy",
      });
      expect(checked.body.data.connection.lastCheck).toMatchObject({ ok: false, message: "ENERGYIQ_LIVE_DEVICES_UNSUITABLE" });

      expect((await call("PUT", ["matches"], { matches: { [meters[0]!.meterPointId]: "not-a-device" } })).body.error.message)
        .toBe("ENERGYIQ_LIVE_DEVICE_NOT_FOUND");
    });
  });

  it("shows and checks a Project connected through the server settings, but leaves editing to the server", async () => {
    await withLiveApi(async ({ metadata, call, devices }) => {
      const rows = (JSON.parse(metadata.energyIq.projectSetup.listHierarchyRevisions(TUYA_OFFICE_PROJECT_ID)
        .find((revision) => revision.id === metadata.energyIq.getProject(TUYA_OFFICE_PROJECT_ID).hierarchy_revision_id)!
        .snapshot_json) as { meter_mapping: { rows: Array<{ id: string }> } }).meter_mapping.rows;
      const saved = { ...process.env };
      Object.assign(process.env, {
        ENERGYIQ_TUYA_CONNECTOR_PROJECT_ID: TUYA_OFFICE_PROJECT_ID,
        ENERGYIQ_TUYA_CONNECTOR_WORKSPACE_ID: TUYA_OFFICE_WORKSPACE_ID,
        ENERGYIQ_TUYA_DEVICE_BINDINGS_JSON: JSON.stringify(Object.fromEntries(rows.map((row, index) => [row.id, devices[index]!.id]))),
      });
      try {
        const read = await call("GET", []);
        expect(read.body.data.connection).toMatchObject({ managedByServer: true, connected: true, ready: true, matchedCount: rows.length });
        const listed = await call("GET", ["devices"]);
        expect(JSON.stringify(listed.body)).not.toContain(devices[0]!.id);
        expect(listed.body.data.devices.find((device: { name: string }) => device.name === devices[0]!.name))
          .toMatchObject({ matchedTo: rows[0]!.id, ref: read.body.data.connection.meters[0].device.ref });
        expect((await call("POST", ["check"])).body.data.check).toMatchObject({ ok: true });
        expect((await call("PUT", ["account"], { accessId: ACCESS_ID, accessSecret: ACCESS_SECRET })).body.error.message)
          .toBe("ENERGYIQ_LIVE_CONNECTION_SERVER_MANAGED");
        expect((await call("PUT", ["matches"], { matches: {} })).body.error.message)
          .toBe("ENERGYIQ_LIVE_CONNECTION_SERVER_MANAGED");
      } finally {
        for (const key of ["ENERGYIQ_TUYA_CONNECTOR_PROJECT_ID", "ENERGYIQ_TUYA_CONNECTOR_WORKSPACE_ID", "ENERGYIQ_TUYA_DEVICE_BINDINGS_JSON"]) {
          if (saved[key] === undefined) delete process.env[key];
          else process.env[key] = saved[key];
        }
      }
    });
  });

  it("lets an administrator take over the server-configured Project, keeping every device, and hand it back", async () => {
    await withLiveApi(async ({ metadata, call, devices }) => {
      const rows = (JSON.parse(metadata.energyIq.projectSetup.listHierarchyRevisions(TUYA_OFFICE_PROJECT_ID)
        .find((revision) => revision.id === metadata.energyIq.getProject(TUYA_OFFICE_PROJECT_ID).hierarchy_revision_id)!
        .snapshot_json) as { meter_mapping: { rows: Array<{ id: string }> } }).meter_mapping.rows;
      const keys = ["ENERGYIQ_TUYA_CONNECTOR_PROJECT_ID", "ENERGYIQ_TUYA_CONNECTOR_WORKSPACE_ID", "ENERGYIQ_TUYA_DEVICE_BINDINGS_JSON", "ENERGYIQ_TUYA_SYNC_ENABLED", "ENERGYIQ_TUYA_SYNC_LOCAL_HOUR"] as const;
      const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
      Object.assign(process.env, {
        ENERGYIQ_TUYA_CONNECTOR_PROJECT_ID: TUYA_OFFICE_PROJECT_ID,
        ENERGYIQ_TUYA_CONNECTOR_WORKSPACE_ID: TUYA_OFFICE_WORKSPACE_ID,
        ENERGYIQ_TUYA_DEVICE_BINDINGS_JSON: JSON.stringify(Object.fromEntries(rows.map((row, index) => [row.id, devices[index]!.id]))),
        ENERGYIQ_TUYA_SYNC_ENABLED: "true",
        ENERGYIQ_TUYA_SYNC_LOCAL_HOUR: "1",
      });
      try {
        // Without asking to take over, the account form still refuses.
        expect((await call("PUT", ["account"], { accessId: ACCESS_ID, accessSecret: ACCESS_SECRET })).body.error.message)
          .toBe("ENERGYIQ_LIVE_CONNECTION_SERVER_MANAGED");

        // An account that cannot see the site's devices is refused, and nothing changes.
        const visible = devices.splice(0, devices.length);
        devices.push(...visible.slice(2));
        expect((await call("PUT", ["account"], { accessId: ACCESS_ID, accessSecret: ACCESS_SECRET, takeOver: true })).body.error.message)
          .toBe("ENERGYIQ_LIVE_TAKEOVER_DEVICES_MISSING:2");
        expect(metadata.energyIq.liveConnectors.find(TUYA_OFFICE_PROJECT_ID)).toBeUndefined();
        devices.splice(0, devices.length, ...visible);

        const taken = await call("PUT", ["account"], { accessId: ACCESS_ID, accessSecret: ACCESS_SECRET, takeOver: true });
        expect(taken.status).toBe(200);
        expect(taken.body.data.connection).toMatchObject({
          managedByServer: false,
          environmentProject: true,
          connected: true,
          ready: true,
          matchedCount: rows.length,
          schedule: { enabled: true, localHour: 1 },
        });
        const connector = resolveEnergyTuyaProjectConnector({ metadataStore: metadata, projectId: TUYA_OFFICE_PROJECT_ID });
        expect(connector).toMatchObject({ managedBy: "app", credentials: { accessId: ACCESS_ID } });
        expect(connector.devices.map((device) => device.deviceId)).toEqual(rows.map((_, index) => devices[index]!.id));
        expect(resolveEnergyTuyaProjectConnector({ metadataStore: metadata, projectId: TUYA_OFFICE_PROJECT_ID, source: "environment" }).managedBy)
          .toBe("environment");

        // Now it is edited like any other connection: one meter can be unlinked.
        const refs = (await call("GET", ["devices"])).body.data.devices as Array<{ ref: string; matchedTo?: string }>;
        const keep = Object.fromEntries(refs.filter((device) => device.matchedTo && device.matchedTo !== rows[0]!.id).map((device) => [device.matchedTo!, device.ref]));
        expect((await call("PUT", ["matches"], { matches: keep })).body.data.connection).toMatchObject({ matchedCount: rows.length - 1 });

        const handedBack = await call("DELETE", []);
        expect(handedBack.body.data.connection).toMatchObject({ managedByServer: true, environmentProject: true, matchedCount: rows.length });
        expect(resolveEnergyTuyaProjectConnector({ metadataStore: metadata, projectId: TUYA_OFFICE_PROJECT_ID }).managedBy).toBe("environment");
      } finally {
        for (const key of keys) {
          if (saved[key] === undefined) delete process.env[key];
          else process.env[key] = saved[key];
        }
      }
    });
  });

  it("removes the sealed account when its Project is deleted", async () => {
    await withLiveApi(async ({ metadata }) => {
      metadata.energyIq.upsertProject({ id: "live-delete", workspace_id: TUYA_OFFICE_WORKSPACE_ID, name: "Live delete", status: "draft" });
      const secretRef = metadata.secrets.put({
        workspace_id: "energyiq-live-connectors",
        user_id: "dev-user",
        owner_kind: "energyiq-live-connector",
        owner_id: "live-delete",
        value: { accessId: ACCESS_ID, accessSecret: ACCESS_SECRET },
      });
      metadata.energyIq.liveConnectors.saveAccount({
        project_id: "live-delete",
        workspace_id: TUYA_OFFICE_WORKSPACE_ID,
        secret_ref: secretRef,
        secret_workspace_id: "energyiq-live-connectors",
        secret_user_id: "dev-user",
        access_id_hint: "abcd…ijkl",
        actor_user_id: "dev-user",
        checked_at: new Date().toISOString(),
        reset_bindings: false,
      });
      await deleteEnergyProject({
        metadataStore: metadata,
        projectId: "live-delete",
        confirmName: "Live delete",
        purgeFacts: async () => undefined,
      });
      expect(metadata.db.prepare("SELECT COUNT(*) AS count FROM encrypted_secrets").get()).toEqual({ count: 0 });
      expect(metadata.energyIq.liveConnectors.find("live-delete")).toBeUndefined();
    });
  });
});

type LiveHarness = {
  metadata: ReturnType<typeof createMetadataStore>;
  devices: TuyaDeviceSummary[];
  clients: TuyaCredentials[];
  failures: { list?: Error; unsuitable?: string };
  scheduler: { requestSync: ReturnType<typeof vi.fn>; isRunning: ReturnType<typeof vi.fn> };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  call: (method: string, path: string[], body?: unknown) => Promise<{ status: number; body: any }>;
};

const withLiveApi = async (run: (harness: LiveHarness) => Promise<void>): Promise<void> => {
  const root = mkdtempSync(join(tmpdir(), "energy-live-connection-"));
  const metadata = createMetadataStore({
    database_path: join(root, "metadata.sqlite"),
    secret_master_key: "test-master-key-for-live-connections",
  });
  try {
    ensureEnergyIqBootstrap(metadata);
    const meterCount = (JSON.parse(metadata.energyIq.projectSetup.listHierarchyRevisions(TUYA_OFFICE_PROJECT_ID)
      .find((revision) => revision.id === metadata.energyIq.getProject(TUYA_OFFICE_PROJECT_ID).hierarchy_revision_id)!
      .snapshot_json) as { meter_mapping: { rows: unknown[] } }).meter_mapping.rows.length;
    const devices: TuyaDeviceSummary[] = Array.from({ length: meterCount }, (_, index) => ({
      id: `livedevice${String(index + 1).padStart(4, "0")}abc`,
      name: `Meter device ${index + 1}`,
      productName: "Smart meter",
      online: true,
    }));
    const clients: TuyaCredentials[] = [];
    const failures: LiveHarness["failures"] = {};
    const client: TuyaOpenApiClient = {
      syncEnergyReadings: async () => { throw new Error("NOT_USED"); },
      readLatestEnergy: async () => { throw new Error("NOT_USED"); },
      listDevices: async () => {
        if (failures.list) throw failures.list;
        return devices;
      },
      checkEnergyDevice: async (deviceId) => deviceId === failures.unsuitable
        ? { ok: false, reason: "ENERGYIQ_TUYA_PROPERTY_REQUIRED:total_forward_energy" }
        : { ok: true, phases: 1 },
    };
    const scheduler = { requestSync: vi.fn(() => "started" as const), isRunning: vi.fn(() => false) };
    const context = {
      metadataStore: metadata,
      userId: "dev-user",
      workspaceId: TUYA_OFFICE_WORKSPACE_ID,
    } as unknown as Required<ConfigApiContext>;
    const call: LiveHarness["call"] = async (method, path, body) => {
      const response = await handleEnergyApiRequest(
        request(method, body),
        ["projects", TUYA_OFFICE_PROJECT_ID, "live-connection", ...path],
        context,
        {
          selectCurrentOverviewPeriod: async () => { throw new Error("NOT_USED"); },
          createTuyaClient: (credentials) => {
            clients.push(credentials);
            return client;
          },
          createTuyaEnvironmentClient: () => client,
          liveConnectionScheduler: () => scheduler,
        },
      );
      return { status: response.status, body: response.body };
    };
    await run({ metadata, devices, clients, failures, scheduler, call });
  } finally {
    metadata.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};

const request = (method: string, body?: unknown): IncomingMessage => {
  const stream = new PassThrough();
  Object.assign(stream, { method, headers: body === undefined ? {} : { "content-type": "application/json" } });
  stream.end(body === undefined ? undefined : JSON.stringify(body));
  return stream as unknown as IncomingMessage;
};
