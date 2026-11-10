import { LocalDataGateway } from "@datafoundry/data-gateway";
import { LocalFileAssetService } from "@datafoundry/files";
import {
  createEnergyIqSourceManifest,
  createMetadataStore,
  resolveEnergyIqSnapshotFactScope,
  validateProjectSetupDocument,
  type EnergyIqProjectSetupDocument,
} from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import type { ConfigApiContext } from "../routes/types.js";
import { ensureEnergyIqBootstrap } from "./energy-bootstrap.js";
import { handleEnergyApiRequest } from "./energy-api.js";
import { addLiveConnectionMeters, liveDeviceRef, withNewLiveMeters, type LiveConnectionDependencies } from "./energy-live-connection.js";
import { resolveEnergyTuyaProjectConnector } from "./energy-tuya-connector.js";
import { createEnergyTuyaSyncRunner } from "./energy-tuya-sync-runner.js";
import {
  TUYA_REPORT_LOG_ARTIFACT_VERSION,
  TUYA_SINGAPORE_ENDPOINT,
  type TuyaDeviceSummary,
  type TuyaEnergySyncInput,
  type TuyaOpenApiClient,
  type TuyaReportLogArtifact,
} from "./tuya-openapi-client.js";
import { TUYA_OFFICE_WORKSPACE_ID } from "./tuya-office-project.js";

const ACCESS_ID = "abcd1234efgh5678ijkl";
const ACCESS_SECRET = "secretsecretsecretsecret12345678";
const SITE = "live-site";
const HOUR_MS = 3_600_000;
const ref = (deviceId: string) => liveDeviceRef(SITE, deviceId);

/** Two boards, each with one circuit and its meter, as Start from Tuya and Smart setup build a site. */
const DEVICES: TuyaDeviceSummary[] = [
  { id: "pantrymeter0001a", name: "Pantry", productName: "Smart meter", online: true },
  { id: "lightsmeter0002b", name: "Lights L1", productName: "Din rail meter", online: true },
  { id: "airconmeter0003c", name: "Aircon L2", productName: "Smart meter", online: true },
  { id: "serverroom0004dd", name: "Server room", productName: "Din rail meter", online: false },
  { id: "othersite00005ee", name: "Other site meter", productName: "Smart meter", online: true },
  { id: "zigbeegateway06f", name: "Zigbee hub", productName: "Zigbee Gateway", category: "wg2", online: true },
];

describe("Add new meters to a live site", () => {
  it("lists only the Tuya devices no meter here reads, marking another site's, without sending device ids", async () => {
    await withLiveSite(async ({ call }) => {
      const listed = await call("GET", ["new-devices"]);
      expect(listed.status, JSON.stringify(listed.body)).toBe(200);
      const text = JSON.stringify(listed.body);
      for (const device of DEVICES) expect(text).not.toContain(device.id);
      const devices = listed.body.data.devices as Array<{ ref: string; name: string; usedBy?: unknown; suggestedLocationId?: string }>;
      expect(devices.map((device) => device.name)).toEqual(["Aircon L2", "Other site meter", "Server room"]);
      expect(devices.find((device) => device.name === "Other site meter")).toMatchObject({ usedBy: { siteName: "Other site" } });
      // Meters on the same product sit on the same board: the Smart meter goes with the Pantry, the Din rail one with the lights.
      expect(devices.find((device) => device.name === "Aircon L2")).toMatchObject({ ref: ref("airconmeter0003c"), suggestedLocationId: `${SITE}-board-a` });
      expect(devices.find((device) => device.name === "Server room")).toMatchObject({ suggestedLocationId: `${SITE}-board-b` });
      expect(listed.body.data.locations).toEqual([
        { id: `${SITE}-board-a`, name: "Board A", depth: 0 },
        { id: `${SITE}-circuit-pantry`, name: "Pantry", depth: 1 },
        { id: `${SITE}-board-b`, name: "Board B", depth: 0 },
        { id: `${SITE}-circuit-lights`, name: "Lights L1", depth: 1 },
      ]);
    });
  });

  it("creates the meters where chosen, matches them, and the next daily update reads them", async () => {
    await withLiveSite(async ({ metadata, call, syncs, sync }) => {
      const before = metadata.energyIq.sourceSync.findState({ project_id: SITE, source_kind: "tuya" })!;
      const added = await call("POST", ["new-meters"], {
        meters: [
          { deviceRef: ref("airconmeter0003c"), name: "Aircon L2", locationId: `${SITE}-board-a`, category: "aircon" },
          // A bottom-level location takes the meter directly; the name already used here gets a number.
          { deviceRef: ref("serverroom0004dd"), name: "lights l1", locationId: `${SITE}-circuit-lights`, offWithLights: true },
        ],
      });
      expect(added.status, JSON.stringify(added.body)).toBe(201);
      for (const device of DEVICES) expect(JSON.stringify(added.body)).not.toContain(device.id);
      expect(added.body.data.added).toBe(2);
      const connection = added.body.data.connection;
      expect(connection).toMatchObject({ matchedCount: 4, ready: true });
      expect(connection.meters).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "Aircon L2", device: expect.objectContaining({ ref: ref("airconmeter0003c") }) }),
        expect.objectContaining({ name: "lights l1 (2)", offWithLights: true, device: expect.objectContaining({ ref: ref("serverroom0004dd") }) }),
      ]));

      // Published as a new version of the site's setup, with the meters where they were put.
      const project = metadata.energyIq.getProject(SITE);
      const published = JSON.parse(metadata.energyIq.projectSetup.listHierarchyRevisions(SITE)
        .find((revision) => revision.id === project.hierarchy_revision_id)!.snapshot_json) as EnergyIqProjectSetupDocument;
      const aircon = published.meter_mapping!.rows.find((row) => row.source_label === "Aircon L2")!;
      expect(published.nodes.find((node) => node.id === aircon.scope_id)).toMatchObject({ name: "Aircon L2", parent_id: `${SITE}-board-a` });
      expect(aircon).toMatchObject({ category: "aircon", aggregation_usage: "official" });
      expect(published.meter_mapping!.rows.find((row) => row.source_label === "lights l1 (2)"))
        .toMatchObject({ scope_id: `${SITE}-circuit-lights`, presentation: { off_with_lights: "yes" } });
      expect(validateProjectSetupDocument(published).blocking).toBe(false);

      // Their readings joined the site's; the next daily update still starts where it would have.
      const after = metadata.energyIq.sourceSync.findState({ project_id: SITE, source_kind: "tuya" })!;
      expect(after.watermark_ms).toBe(before.watermark_ms);
      expect(after.active_source_sha256).toHaveLength(before.active_source_sha256.length + 1);
      expect(resolveEnergyIqSnapshotFactScope(metadata.energyIq.findCurrentDataSnapshot(SITE)!).sourceSha256).toEqual(after.active_source_sha256);

      const next = await sync(before.watermark_ms! - HOUR_MS, before.watermark_ms! + HOUR_MS);
      expect(next.run.status).toBe("succeeded");
      expect(syncs.at(-1)!.devices.map((device) => device.deviceId).sort())
        .toEqual(["airconmeter0003c", "lightsmeter0002b", "pantrymeter0001a", "serverroom0004dd"]);
    });
  }, 60_000);

  it("refuses in plain codes and changes nothing: another site's device, one already here, gone, a gateway, an expired account", async () => {
    await withLiveSite(async ({ metadata, call, failures }) => {
      const revision = metadata.energyIq.getProject(SITE).hierarchy_revision_id;
      const add = (deviceRef: string, locationId = `${SITE}-board-a`) =>
        call("POST", ["new-meters"], { meters: [{ deviceRef, name: "New meter", locationId }] });
      expect((await add(ref("othersite00005ee"))).body.error.message).toBe("ENERGYIQ_LIVE_DEVICE_USED_ELSEWHERE");
      expect((await add(ref("pantrymeter0001a"))).body.error.message).toBe("ENERGYIQ_LIVE_DEVICE_ALREADY_MATCHED");
      expect((await add("not-a-device")).body.error.message).toBe("ENERGYIQ_LIVE_DEVICE_NOT_FOUND");
      expect((await add(ref("zigbeegateway06f"))).body.error.message).toBe("ENERGYIQ_LIVE_DEVICE_GATEWAY");
      expect((await add(ref("airconmeter0003c"), "nowhere")).body.error.message).toBe("ENERGYIQ_LIVE_LOCATION_UNKNOWN");
      expect((await call("POST", ["new-meters"], { meters: [] })).body.error.message).toBe("ENERGYIQ_LIVE_NEW_METERS_INVALID");
      failures.list = new Error("ENERGYIQ_TUYA_API_ERROR:1010:token_invalid");
      expect((await add(ref("airconmeter0003c"))).body.error.message).toBe("ENERGYIQ_LIVE_ACCOUNT_REJECTED:ENERGYIQ_TUYA_API_ERROR:1010:token_invalid");
      expect((await call("GET", ["new-devices"])).body.error.message).toMatch(/^ENERGYIQ_LIVE_ACCOUNT_REJECTED/u);
      expect(metadata.energyIq.getProject(SITE).hierarchy_revision_id).toBe(revision);
      expect(Object.keys(metadata.energyIq.liveConnectors.find(SITE)!.bindings)).toHaveLength(2);
    });
  }, 60_000);

  it("lets only people who can change the site's setup list or add meters", async () => {
    await withLiveSite(async ({ metadata, call }) => {
      metadata.energyIq.roles.create({
        id: "installer-live-only",
        name: "Live connection only",
        permissions: { reports: "read", facility: "read", hours_rate: "none", notes: "none", live_connection: "write", people: "none" },
      });
      metadata.users.createPasswordUser({ id: "installer", email: "installer@energyx.test" });
      metadata.workspaceMemberships.upsert({ workspace_id: TUYA_OFFICE_WORKSPACE_ID, user_id: "installer", role: "member", role_id: "installer-live-only" });
      const listed = await call("GET", ["new-devices"], undefined, "installer");
      expect(listed.body.error.message).toBe("ENERGYIQ_PROJECT_FORBIDDEN");
      const added = await call("POST", ["new-meters"], {
        meters: [{ deviceRef: ref("airconmeter0003c"), name: "Aircon L2", locationId: `${SITE}-board-a` }],
      }, "installer");
      expect(added.body.error.message).toBe("ENERGYIQ_PROJECT_FORBIDDEN");

      // Changing the setup is not enough on its own: adding makes it live, which takes an administrator, as Facility saves do.
      metadata.energyIq.roles.create({
        id: "facility-editor",
        name: "Facility editor",
        permissions: { reports: "read", facility: "write", hours_rate: "none", notes: "none", live_connection: "write", people: "none" },
      });
      metadata.users.createPasswordUser({ id: "editor", email: "editor@energyx.test" });
      metadata.workspaceMemberships.upsert({ workspace_id: TUYA_OFFICE_WORKSPACE_ID, user_id: "editor", role: "member", role_id: "facility-editor" });
      expect((await call("GET", ["new-devices"], undefined, "editor")).status).toBe(200);
      const edited = await call("POST", ["new-meters"], {
        meters: [{ deviceRef: ref("airconmeter0003c"), name: "Aircon L2", locationId: `${SITE}-board-a` }],
      }, "editor");
      expect(edited.body.error.message).toBe("ENERGYIQ_ADMIN_REQUIRED");
      expect(Object.keys(metadata.energyIq.liveConnectors.find(SITE)!.bindings)).toHaveLength(2);
    });
  }, 60_000);

  it("puts the site back as it was when reading the new readings in fails", async () => {
    await withLiveSite(async ({ metadata, live }) => {
      const project = metadata.energyIq.getProject(SITE);
      const before = metadata.energyIq.projectSetup.getDraft({ project_id: SITE, user_id: "dev-user" }).document;
      const user = metadata.users.getById({ user_id: "dev-user" });
      const applyChanges = vi.fn(async () => undefined);
      await expect(addLiveConnectionMeters(live, {
        projectId: SITE,
        user,
        meters: [{ deviceRef: ref("airconmeter0003c"), name: "Aircon L2", locationId: `${SITE}-board-a` }],
        pipeline: {
          blockingReasons: async () => [],
          registerReadings: async (file) => metadata.energyIq.createImportBatch({
            id: "energy-import-new-meters-test",
            workspace_id: project.workspace_id,
            project_id: SITE,
            source_kind: "tuya",
            source_sha256: "f".repeat(64),
            filename: file.filename,
            status: "inspected",
            inspection: {},
            created_by: "dev-user",
          }),
          materialize: async () => { throw new Error("ENERGYIQ_IMPORT_MATERIALIZATION_NOT_READY:TEST"); },
          applyChanges,
        },
      })).rejects.toThrow("ENERGYIQ_IMPORT_MATERIALIZATION_NOT_READY:TEST");
      expect(applyChanges).not.toHaveBeenCalled();
      expect(metadata.energyIq.projectSetup.getDraft({ project_id: SITE, user_id: "dev-user" }).document.meter_mapping)
        .toEqual(before.meter_mapping);
      expect(metadata.energyIq.getProject(SITE).hierarchy_revision_id).toBe(project.hierarchy_revision_id);
      expect(Object.keys(metadata.energyIq.liveConnectors.find(SITE)!.bindings)).toHaveLength(2);
      const runs = metadata.energyIq.sourceSync.listRuns({ project_id: SITE, source_kind: "tuya" });
      expect(runs[0]).toMatchObject({ status: "failed" });
      // A failed read leaves the next daily update where it was.
      expect(metadata.energyIq.sourceSync.findState({ project_id: SITE, source_kind: "tuya" })!.last_error_code).toBe("ENERGYIQ_IMPORT_MATERIALIZATION_NOT_READY:TEST");
    });
  }, 60_000);

  it("adds meters to a site that has not had a daily update yet", async () => {
    await withLiveSite(async ({ metadata, call }) => {
      expect(metadata.energyIq.sourceSync.findState({ project_id: SITE, source_kind: "tuya" })).toBeUndefined();
      const added = await call("POST", ["new-meters"], {
        meters: [{ deviceRef: ref("airconmeter0003c"), name: "Aircon L2", locationId: `${SITE}-board-a`, category: "aircon" }],
      });
      expect(added.status, JSON.stringify(added.body)).toBe(201);
      expect(added.body.data.connection).toMatchObject({ matchedCount: 3, ready: true });
      expect(metadata.energyIq.sourceSync.findState({ project_id: SITE, source_kind: "tuya" })).toBeUndefined();
    }, { synced: false });
  }, 60_000);
});

describe("Placing new meters in the setup", () => {
  it("counts a new meter in its location and above, but not where a whole-site meter already measures it", () => {
    const document = siteDocument();
    const withTotal: EnergyIqProjectSetupDocument = {
      ...document,
      meter_mapping: {
        ...document.meter_mapping!,
        rows: [...document.meter_mapping!.rows, {
          id: "mapping-incoming", source_label: "Incoming", scope_id: `${SITE}-board-a`, navigation_scope_id: `${SITE}-board-a`,
          display_name: "Incoming", resource: "electricity", category: "overall", coverage: "whole", meter_role: "total", aggregation_usage: "excluded",
        }],
        official_aggregation_routes: [
          ...document.meter_mapping!.official_aggregation_routes!.filter((route) => route.scope_id !== "project"),
          { scope_id: "project", resource: "electricity", category: "overall", meter_point_ids: ["mapping-incoming"] },
        ],
      },
    };
    expect(validateProjectSetupDocument(withTotal).blocking).toBe(false);
    const { document: next, rows } = withNewLiveMeters(withTotal, SITE, [{ name: "Aircon L2", locationId: `${SITE}-board-a`, offWithLights: false, category: "aircon" }]);
    expect(validateProjectSetupDocument(next).issues.filter((issue) => issue.severity === "error")).toEqual([]);
    const routes = next.meter_mapping!.official_aggregation_routes!.filter((route) => route.meter_point_ids.includes(rows[0]!.id));
    expect(routes.map((route) => `${route.scope_id}:${route.category}`).sort()).toEqual([`${SITE}-board-a:aircon`, `${rows[0]!.scope_id}:aircon`].sort());
    // Existing routes are left as they were.
    expect(next.meter_mapping!.official_aggregation_routes!.find((route) => route.scope_id === "project")).toEqual({ scope_id: "project", resource: "electricity", category: "overall", meter_point_ids: ["mapping-incoming"] });
    expect(() => withNewLiveMeters(withTotal, SITE, [{ name: "X", locationId: "missing", offWithLights: false, category: "other" }]))
      .toThrow("ENERGYIQ_LIVE_LOCATION_UNKNOWN");
  });
});

type Harness = {
  metadata: ReturnType<typeof createMetadataStore>;
  failures: { list?: Error };
  syncs: TuyaEnergySyncInput[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  call: (method: string, path: string[], body?: unknown, userId?: string) => Promise<{ status: number; body: any }>;
  sync: (startTime: number, endTime: number) => ReturnType<ReturnType<typeof createEnergyTuyaSyncRunner>["run"]>;
  /** The live-connection dependencies the routes use, for calling the module directly. */
  live: LiveConnectionDependencies;
};

/** Cumulative kWh that only depends on the device and the hour, so overlapping reads always agree. */
const artifactFor = (input: TuyaEnergySyncInput): TuyaReportLogArtifact => {
  const lastHour = Math.floor(input.endTime / HOUR_MS) * HOUR_MS;
  return {
    schemaVersion: TUYA_REPORT_LOG_ARTIFACT_VERSION,
    provider: "tuya",
    region: "sg",
    endpoint: TUYA_SINGAPORE_ENDPOINT,
    createdAt: new Date(input.endTime).toISOString(),
    request: { startTime: input.startTime, endTime: input.endTime, codes: ["total_forward_energy"], deviceCount: input.devices.length },
    devices: input.devices.map((device) => {
      const index = DEVICES.findIndex((candidate) => candidate.id === device.deviceId);
      return {
        sourceLabel: device.sourceLabel,
        properties: { totalForwardEnergy: { code: "total_forward_energy", scale: 2, unit: "kWh" } },
        logs: [3, 2, 1, 0].map((back) => lastHour - back * HOUR_MS).filter((time) => time >= input.startTime && time <= input.endTime).map((eventTime) => ({
          code: "total_forward_energy",
          eventTime,
          value: String(100_000 * (index + 1) + (eventTime / HOUR_MS - 490_000) * 150),
        })),
      };
    }),
  };
};

/** The published setup Start from Tuya would give two devices on two boards. */
const siteDocument = (base?: EnergyIqProjectSetupDocument): EnergyIqProjectSetupDocument => ({
  ...(base ?? { project: { name: "Live site", timezone: "Asia/Singapore" } } as EnergyIqProjectSetupDocument),
  tier_structure_locked: true,
  tiers: [
    { id: `${SITE}-tier-board`, ordinal: 2, alias: "Board" },
    { id: `${SITE}-tier-circuit`, ordinal: 1, alias: "Circuit" },
  ],
  nodes: [
    { id: `${SITE}-board-a`, tier_definition_id: `${SITE}-tier-board`, name: "Board A", sort_order: 0, metadata_status: "provisional" },
    { id: `${SITE}-board-b`, tier_definition_id: `${SITE}-tier-board`, name: "Board B", sort_order: 1, metadata_status: "provisional" },
    { id: `${SITE}-circuit-pantry`, tier_definition_id: `${SITE}-tier-circuit`, parent_id: `${SITE}-board-a`, name: "Pantry", sort_order: 0, metadata_status: "provisional" },
    { id: `${SITE}-circuit-lights`, tier_definition_id: `${SITE}-tier-circuit`, parent_id: `${SITE}-board-b`, name: "Lights L1", sort_order: 0, metadata_status: "provisional" },
  ],
  meter_mapping: {
    schema_version: 2,
    source_kind: "excel",
    rows: [
      { id: "mapping-pantry-1", source_label: "Pantry", scope_id: `${SITE}-circuit-pantry`, navigation_scope_id: `${SITE}-circuit-pantry`, display_name: "Pantry", resource: "electricity", category: "kitchen", coverage: "partial", meter_role: "component", aggregation_usage: "official" },
      { id: "mapping-lights-l1-2", source_label: "Lights L1", scope_id: `${SITE}-circuit-lights`, navigation_scope_id: `${SITE}-circuit-lights`, display_name: "Lights L1", resource: "electricity", category: "light", coverage: "partial", meter_role: "component", aggregation_usage: "official" },
    ],
    official_aggregation_routes: [
      { scope_id: `${SITE}-circuit-pantry`, resource: "electricity", category: "kitchen", meter_point_ids: ["mapping-pantry-1"] },
      { scope_id: `${SITE}-board-a`, resource: "electricity", category: "kitchen", meter_point_ids: ["mapping-pantry-1"] },
      { scope_id: `${SITE}-circuit-lights`, resource: "electricity", category: "light", meter_point_ids: ["mapping-lights-l1-2"] },
      { scope_id: `${SITE}-board-b`, resource: "electricity", category: "light", meter_point_ids: ["mapping-lights-l1-2"] },
      { scope_id: "project", resource: "electricity", category: "kitchen", meter_point_ids: ["mapping-pantry-1"] },
      { scope_id: "project", resource: "electricity", category: "light", meter_point_ids: ["mapping-lights-l1-2"] },
    ],
    confirmed: true,
  },
});

/**
 * A live site as Start from Tuya leaves it: two meters published from the starter readings, matched to their devices,
 * and one daily update since. Another site of the same client reads one more device in the same Tuya project.
 */
const withLiveSite = async (run: (harness: Harness) => Promise<void>, options: { synced?: boolean } = {}): Promise<void> => {
  const root = mkdtempSync(join(tmpdir(), "energy-live-new-meters-"));
  const previousDuckDbPath = process.env.ENERGYIQ_DUCKDB_PATH;
  process.env.ENERGYIQ_DUCKDB_PATH = join(root, "energy.duckdb");
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite"), secret_master_key: "test-master-key-for-new-meters" });
  const files = new LocalFileAssetService(metadata, { storageRoot: join(root, "files") });
  try {
    ensureEnergyIqBootstrap(metadata);
    metadata.energyIq.upsertProject({ id: SITE, workspace_id: TUYA_OFFICE_WORKSPACE_ID, name: "Live site", status: "draft", timezone: "Asia/Singapore" });
    const failures: Harness["failures"] = {};
    const syncs: TuyaEnergySyncInput[] = [];
    const syncReadings = async (input: TuyaEnergySyncInput) => {
      syncs.push(input);
      return artifactFor(input);
    };
    const client: TuyaOpenApiClient = {
      listDevices: async () => {
        if (failures.list) throw failures.list;
        return DEVICES;
      },
      checkEnergyDevice: async () => ({ ok: true, phases: 1 }),
      readLatestEnergy: async () => { throw new Error("NOT_USED"); },
      syncEnergyReadings: syncReadings,
    };
    const dependencies: NonNullable<Parameters<typeof handleEnergyApiRequest>[3]> = {
      selectCurrentOverviewPeriod: async () => { throw new Error("NOT_USED"); },
      createTuyaClient: () => client,
      createTuyaEnvironmentClient: () => client,
      liveConnectionScheduler: () => ({ requestSync: vi.fn(() => "started" as const), isRunning: () => false }),
      prewarmAnalysisContextPackage: (async () => ({ status: "not_ready", reason: "TEST" })) as never,
    };
    const contextFor = (userId: string) => ({
      metadataStore: metadata,
      dataGateway: new LocalDataGateway(metadata),
      fileAssetService: files,
      userId,
      workspaceId: TUYA_OFFICE_WORKSPACE_ID,
    } as unknown as Required<ConfigApiContext>);
    const handle = async (method: string, segments: string[], body?: unknown, userId = "dev-user") => {
      const response = await handleEnergyApiRequest(request(method, body), segments, contextFor(userId), dependencies);
      return { status: response.status, body: response.body as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
    };
    const call: Harness["call"] = (method, path, body, userId) => handle(method, ["projects", SITE, "live-connection", ...path], body, userId);
    const sync: Harness["sync"] = (startTime, endTime) => createEnergyTuyaSyncRunner({
      context: contextFor("dev-user"),
      syncTuyaEnergyReadings: syncReadings,
    }).run({
      connector: resolveEnergyTuyaProjectConnector({ metadataStore: metadata, projectId: SITE, env: {} }),
      actorUserId: "dev-user",
      trigger: "manual",
      window: { startTime, endTime },
    });

    expect((await call("PUT", ["account"], { accessId: ACCESS_ID, accessSecret: ACCESS_SECRET })).status).toBe(200);
    const starter = await call("POST", ["starter"], { deviceRefs: [ref("pantrymeter0001a"), ref("lightsmeter0002b")] });
    expect(starter.status, JSON.stringify(starter.body)).toBe(201);
    const batch = metadata.energyIq.listImportBatches(SITE).find((candidate) => candidate.id === starter.body.data.batch.id)!;
    const draft = metadata.energyIq.projectSetup.getDraft({ project_id: SITE, user_id: "dev-user" });
    metadata.energyIq.projectSetup.saveDraft({
      project_id: SITE,
      expected_revision: draft.revision,
      user_id: "dev-user",
      document: { ...siteDocument(draft.document), source_manifest: createEnergyIqSourceManifest([batch.source_sha256], true) },
    });
    const materialized = await handle("POST", ["projects", SITE, "imports", batch.id, "materialize"], {});
    expect(materialized.status, JSON.stringify(materialized.body)).toBe(200);
    const applied = await handle("POST", ["projects", SITE, "setup", "apply"], {});
    expect(applied.status, JSON.stringify(applied.body)).toBe(200);
    const meters = (await call("GET", [])).body.data.connection.meters as Array<{ meterPointId: string; sourceLabel: string }>;
    const matched = await call("PUT", ["matches"], {
      matches: Object.fromEntries(meters.map((meter) => [meter.meterPointId, ref(meter.sourceLabel === "Pantry" ? "pantrymeter0001a" : "lightsmeter0002b")])),
    });
    expect(matched.body.data.connection).toMatchObject({ matchedCount: 2, ready: true });
    const dayEnd = Math.floor(Date.now() / HOUR_MS) * HOUR_MS;
    if (options.synced !== false) expect((await sync(dayEnd - 24 * HOUR_MS, dayEnd)).run.status).toBe("succeeded");

    // Another site of the same client already reads one device in this Tuya project.
    metadata.energyIq.upsertProject({ id: "other-site", workspace_id: TUYA_OFFICE_WORKSPACE_ID, name: "Other site", status: "published" });
    const secretRef = metadata.secrets.put({
      workspace_id: "energyiq-live-connectors",
      user_id: "dev-user",
      owner_kind: "energyiq-live-connector",
      owner_id: "other-site",
      value: { accessId: ACCESS_ID, accessSecret: ACCESS_SECRET },
    });
    metadata.energyIq.liveConnectors.saveAccount({
      project_id: "other-site",
      workspace_id: TUYA_OFFICE_WORKSPACE_ID,
      secret_ref: secretRef,
      secret_workspace_id: "energyiq-live-connectors",
      secret_user_id: "dev-user",
      access_id_hint: "abcd…ijkl",
      actor_user_id: "dev-user",
      checked_at: new Date().toISOString(),
      reset_bindings: false,
    });
    metadata.energyIq.liveConnectors.saveBindings({
      project_id: "other-site",
      bindings: { "other-meter": { device_id: "othersite00005ee", device_name: "Other site meter" } },
      actor_user_id: "dev-user",
      updated_at: new Date().toISOString(),
    });

    await run({ metadata, failures, syncs, call, sync, live: { metadataStore: metadata, createClient: () => client, env: {} } });
  } finally {
    if (previousDuckDbPath === undefined) delete process.env.ENERGYIQ_DUCKDB_PATH;
    else process.env.ENERGYIQ_DUCKDB_PATH = previousDuckDbPath;
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
