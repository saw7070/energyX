import { LocalDataGateway, readEnergyFactProjectOldestReading, readEnergyFactProjectState, resolveEnergyFactStorePath } from "@datafoundry/data-gateway";
import { LocalFileAssetService } from "@datafoundry/files";
import { createMetadataStore, ENERGYIQ_ORGANISATION_ADMIN_ROLE_ID } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";

import { AuthService } from "../auth/service.js";
import type { ConfigApiContext } from "../routes/types.js";
import { EnergyAdminAccessService } from "./energy-admin-access.js";
import { handleEnergyApiRequest } from "./energy-api.js";
import { ensureEnergyIqBootstrap } from "./energy-bootstrap.js";
import { createEnergyLiveConnectionScheduler } from "./energy-live-connection-scheduler.js";
import { createEnergyReadingRetentionJob, readingRetentionCutoff } from "./energy-reading-retention.js";
import type { EnergyTuyaPostMaterialization } from "./energy-tuya-sync-runner.js";
import {
  TUYA_REPORT_LOG_ARTIFACT_VERSION,
  TUYA_SINGAPORE_ENDPOINT,
  type TuyaEnergySyncInput,
  type TuyaReportLogArtifact,
} from "./tuya-openapi-client.js";
import { TUYA_OFFICE_PROJECT_ID, TUYA_OFFICE_WORKSPACE_ID } from "./tuya-office-project.js";

describe("Reading retention cutoff", () => {
  it("keeps from local midnight the same day N months ago, in the site's time zone", () => {
    // 18 Nov 2026, 18:00 in Singapore.
    expect(readingRetentionCutoff(3, "Asia/Singapore", Date.parse("2026-11-18T10:00:00.000Z"))).toBe("2026-08-17T16:00:00.000Z");
    // Just after midnight on 1 Jan in Singapore is still 31 Dec in UTC: the site's own date decides.
    expect(readingRetentionCutoff(3, "Asia/Singapore", Date.parse("2025-12-31T16:30:00.000Z"))).toBe("2025-09-30T16:00:00.000Z");
    expect(readingRetentionCutoff(12, "Asia/Kuala_Lumpur", Date.parse("2026-11-18T10:00:00.000Z"))).toBe("2025-11-17T16:00:00.000Z");
    // 31 May less three months is the last day of February.
    expect(readingRetentionCutoff(3, "Asia/Singapore", Date.parse("2026-05-31T04:00:00.000Z"))).toBe("2026-02-27T16:00:00.000Z");
    expect(() => readingRetentionCutoff(0, "Asia/Singapore", Date.now())).toThrow("ENERGYIQ_READING_RETENTION_INVALID");
  });
});

describe("Keep meter readings for (Team API)", () => {
  it("shows the setting to the client's admins but lets only platform administrators change it", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-retention-routes-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite"), secret_master_key: "retention-routes-master-key" });
    try {
      ensureEnergyIqBootstrap(metadata);
      const auth = new AuthService(metadata, {
        mode: "password",
        publicBaseUrl: "http://127.0.0.1:3001",
        sessionSecret: "test-secret-that-is-longer-than-thirty-two-characters",
        emailDelivery: "test",
      });
      const admin = new EnergyAdminAccessService(metadata, auth);
      const organisation = admin.createOrganisation({ actorUserId: "dev-user", name: "Sengkang Town Council" });
      const invited = await admin.inviteUser({
        actorUserId: "dev-user",
        email: "owner@sktc.test",
        organisationIds: [organisation.id],
        role: "user",
        organisationRoles: { [organisation.id]: ENERGYIQ_ORGANISATION_ADMIN_ROLE_ID },
      });
      const context = { metadataStore: metadata, authService: auth, userId: "dev-user", workspaceId: organisation.id } as Required<ConfigApiContext>;
      const clientAdmin = { ...context, userId: invited.user.id };
      const request = (method: string, body?: unknown): IncomingMessage => {
        const stream = new PassThrough();
        Object.assign(stream, { method, url: "/api/v1/energy/team/retention", headers: { "content-type": "application/json" } });
        stream.end(body === undefined ? undefined : JSON.stringify(body));
        return stream as unknown as IncomingMessage;
      };
      const call = (ctx: Required<ConfigApiContext>, method: string, body?: unknown) =>
        handleEnergyApiRequest(request(method, body), ["team", "retention"], ctx);

      expect(await call(clientAdmin, "GET")).toMatchObject({ status: 200, body: { data: { months: null, canChange: false } } });
      expect((await call(clientAdmin, "PUT", { months: 3 })).status).toBe(403);
      expect(metadata.energyIq.readingRetention.get(organisation.id)).toBeUndefined();

      expect(await call(context, "GET")).toMatchObject({ status: 200, body: { data: { months: null, canChange: true } } });
      expect((await call(context, "PUT", { months: 6 })).status).toBe(400);
      expect((await call(context, "PUT", {})).status).toBe(400);
      expect(await call(context, "PUT", { months: 3 })).toMatchObject({ status: 200, body: { data: { months: 3, canChange: true } } });
      expect(metadata.energyIq.readingRetention.get(organisation.id)).toBe(3);
      expect(await call(clientAdmin, "GET")).toMatchObject({ status: 200, body: { data: { months: 3, canChange: false } } });
      const audit = metadata.db.prepare("SELECT metadata_json FROM auth_audit_events WHERE event_type = 'energyiq.reading_retention_changed'").all();
      expect(audit.map((row) => JSON.parse(String((row as { metadata_json: string }).metadata_json)))).toEqual([
        { organisationId: organisation.id, previousMonths: null, months: 3 },
      ]);

      expect(await call(context, "PUT", { months: null })).toMatchObject({ status: 200, body: { data: { months: null } } });
      expect(metadata.energyIq.readingRetention.get(organisation.id)).toBeUndefined();
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

const HOUR_MS = 3_600_000;
/** Cumulative readings grow one unit an hour from here, so every pass continues the last. */
const READING_BASE_MS = Date.parse("2026-08-01T00:00:00.000Z");

describe("Nightly reading retention", () => {
  it("trims a 3-month client's site, leaves clients without a limit alone, and the next daily update still publishes", { timeout: 120_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-retention-job-"));
    const previousDuckDbPath = process.env.ENERGYIQ_DUCKDB_PATH;
    process.env.ENERGYIQ_DUCKDB_PATH = join(root, "energy.duckdb");
    const metadata = createMetadataStore({
      database_path: join(root, "metadata.sqlite"),
      secret_master_key: "test-master-key-for-live-connections",
    });
    try {
      ensureEnergyIqBootstrap(metadata);
      const context = {
        metadataStore: metadata,
        dataGateway: new LocalDataGateway(metadata),
        fileAssetService: new LocalFileAssetService(metadata, { storageRoot: join(root, "files") }),
        userId: "dev-user",
        workspaceId: TUYA_OFFICE_WORKSPACE_ID,
      } as unknown as Required<ConfigApiContext>;
      const rows = publishedRows(metadata);
      connect(metadata, rows, 9);
      const publish = (projectId: string): EnergyTuyaPostMaterialization => async ({ snapshot }, beforePublish) => {
        await beforePublish({
          persistentDirectory: root,
          pointerKey: `current:${projectId}`,
          previousProjectionKey: null,
          candidateProjectionKey: `overview:${snapshot.id}`,
        });
        return { projectionRef: `overview:${snapshot.id}` };
      };
      let now = Date.parse("2026-08-21T01:30:00.000Z");
      const scheduler = createEnergyLiveConnectionScheduler({
        context,
        env: {},
        now: () => now,
        syncTuyaEnergyReadings: async (input: TuyaEnergySyncInput) => artifact(rows, input.startTime, input.endTime),
        afterMaterialization: (projectId) => publish(projectId),
      });
      const job = createEnergyReadingRetentionJob({
        context,
        fallbackActorUserId: "dev-user",
        afterMaterialization: (projectId) => publish(projectId),
        now: () => now,
      });
      const databasePath = resolveEnergyFactStorePath(TUYA_OFFICE_WORKSPACE_ID);
      const oldest = () => readEnergyFactProjectOldestReading({ databasePath, projectId: TUYA_OFFICE_PROJECT_ID });

      // A week of readings from 13 August.
      await scheduler.runDue();
      const firstReading = await oldest();
      expect(firstReading).toBe("2026-08-13T16:00:00.000Z");

      // Three months on, a client without a limit keeps everything.
      now = Date.parse("2026-11-17T20:30:00.000Z");
      expect(await job.runOnce()).toEqual({ trimmed: [], current: [], failed: [] });
      expect(await oldest()).toBe(firstReading);

      // With a 3-month limit the site keeps readings from 18 August (Singapore) and is republished without the rest.
      metadata.energyIq.readingRetention.set({ workspace_id: TUYA_OFFICE_WORKSPACE_ID, months: 3, updated_by: "dev-user" });
      const before = metadata.energyIq.getProject(TUYA_OFFICE_PROJECT_ID).data_snapshot_id;
      expect(await job.runOnce()).toEqual({ trimmed: [TUYA_OFFICE_PROJECT_ID], current: [], failed: [] });
      const cutoff = "2026-08-17T16:00:00.000Z";
      expect((await oldest())! >= cutoff).toBe(true);
      const project = metadata.energyIq.getProject(TUYA_OFFICE_PROJECT_ID);
      expect(project.data_snapshot_id).not.toBe(before);
      const state = await readEnergyFactProjectState({ databasePath, projectId: TUYA_OFFICE_PROJECT_ID });
      expect(state?.dataSnapshotId).toBe(project.data_snapshot_id);
      expect(state!.canonicalIntervalCount).toBeGreaterThan(0);
      // Nothing older is left, so the next night has nothing to do.
      expect(await job.runOnce()).toEqual({ trimmed: [], current: [TUYA_OFFICE_PROJECT_ID], failed: [] });

      // The next daily update publishes over files the limit has emptied, and trims as it goes.
      now = Date.parse("2026-11-18T01:30:00.000Z");
      await scheduler.runDue();
      const sync = metadata.energyIq.sourceSync.findState({ project_id: TUYA_OFFICE_PROJECT_ID, source_kind: "tuya" });
      expect(sync?.last_error_code).toBeUndefined();
      expect(sync?.watermark_ms).toBe(Date.parse("2026-11-17T16:00:00.000Z") + 2 * HOUR_MS);
      const after = metadata.energyIq.getProject(TUYA_OFFICE_PROJECT_ID);
      expect((await readEnergyFactProjectState({ databasePath, projectId: TUYA_OFFICE_PROJECT_ID }))?.dataSnapshotId).toBe(after.data_snapshot_id);
      expect((await oldest())! >= "2026-08-17T16:00:00.000Z").toBe(true);
    } finally {
      if (previousDuckDbPath === undefined) delete process.env.ENERGYIQ_DUCKDB_PATH;
      else process.env.ENERGYIQ_DUCKDB_PATH = previousDuckDbPath;
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

type Row = { id: string; source_label: string };

const publishedRows = (metadata: ReturnType<typeof createMetadataStore>): Row[] => {
  const project = metadata.energyIq.getProject(TUYA_OFFICE_PROJECT_ID);
  const revision = metadata.energyIq.projectSetup.listHierarchyRevisions(project.id)
    .find((candidate) => candidate.id === project.hierarchy_revision_id)!;
  return (JSON.parse(revision.snapshot_json) as { meter_mapping: { rows: Row[] } }).meter_mapping.rows;
};

const connect = (metadata: ReturnType<typeof createMetadataStore>, rows: Row[], localHour: number): void => {
  const secretRef = metadata.secrets.put({
    workspace_id: "energyiq-live-connectors",
    user_id: "dev-user",
    owner_kind: "energyiq-live-connector",
    owner_id: TUYA_OFFICE_PROJECT_ID,
    value: { accessId: "abcd1234efgh5678ijkl", accessSecret: "secretsecretsecretsecret12345678" },
  });
  const at = "2026-08-21T00:00:00.000Z";
  metadata.energyIq.liveConnectors.saveAccount({
    project_id: TUYA_OFFICE_PROJECT_ID,
    workspace_id: TUYA_OFFICE_WORKSPACE_ID,
    secret_ref: secretRef,
    secret_workspace_id: "energyiq-live-connectors",
    secret_user_id: "dev-user",
    access_id_hint: "abcd…ijkl",
    actor_user_id: "dev-user",
    checked_at: at,
    reset_bindings: false,
  });
  metadata.energyIq.liveConnectors.saveBindings({
    project_id: TUYA_OFFICE_PROJECT_ID,
    bindings: Object.fromEntries(rows.map((row, index) => [row.id, {
      device_id: `livedevice${String(index + 1).padStart(4, "0")}`,
      device_name: `Device ${index + 1}`,
    }])),
    actor_user_id: "dev-user",
    updated_at: at,
  });
  metadata.energyIq.liveConnectors.saveSchedule({
    project_id: TUYA_OFFICE_PROJECT_ID,
    sync_enabled: true,
    sync_local_hour: localHour,
    actor_user_id: "dev-user",
    updated_at: at,
  });
};

const artifact = (rows: Row[], startTime: number, endTime: number): TuyaReportLogArtifact => ({
  schemaVersion: TUYA_REPORT_LOG_ARTIFACT_VERSION,
  provider: "tuya",
  region: "sg",
  endpoint: TUYA_SINGAPORE_ENDPOINT,
  createdAt: new Date(endTime).toISOString(),
  request: { startTime, endTime, codes: ["cur_power", "total_forward_energy"], deviceCount: rows.length },
  devices: rows.map((row, index) => ({
    sourceLabel: row.source_label,
    properties: {
      totalForwardEnergy: { code: "total_forward_energy", scale: 2, unit: "kw.h" },
      currentPower: { code: "cur_power", scale: 3, unit: "kW" },
    },
    logs: [
      { code: "total_forward_energy" as const, eventTime: startTime, value: 10_000 + index * 100 + Math.floor((startTime - READING_BASE_MS) / HOUR_MS) },
      { code: "total_forward_energy" as const, eventTime: endTime, value: 10_000 + index * 100 + Math.floor((endTime - READING_BASE_MS) / HOUR_MS) },
    ],
  })),
});
