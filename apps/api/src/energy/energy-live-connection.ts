import { createHash, randomUUID } from "node:crypto";
import {
  createEnergyIqSourceManifest,
  resolveEnergyIqSnapshotFactScope,
  validateProjectSetupDocument,
} from "@datafoundry/metadata";
import type {
  EnergyIqImportBatchRecord,
  EnergyIqLiveConnectorBinding,
  EnergyIqLiveConnectorRecord,
  EnergyIqMeterCategory,
  EnergyIqMeterMappingRow,
  EnergyIqOfficialAggregationRoute,
  EnergyIqProjectSetupDocument,
  EnergyIqProjectSetupNode,
  MetadataStore,
  UserRecord,
} from "@datafoundry/metadata";

import {
  ENERGYIQ_LIVE_SECRET_OWNER_KIND,
  isEnvironmentTuyaProject,
  readLiveConnectionCredentials,
  resolveEnergyTuyaProjectConnector,
} from "./energy-tuya-connector.js";
import { readEnergyTuyaArtifact } from "./energy-tuya-import.js";
import { readOfflineSince } from "./energy-live-status.js";
import {
  createTuyaOpenApiClientFromEnv,
  type TuyaCredentials,
  type TuyaDeviceSummary,
  type TuyaOpenApiClient,
} from "./tuya-openapi-client.js";

/**
 * Live connection: an administrator connects a Project's meters to Tuya from the app. The browser only ever sees
 * device names and opaque references; the account key and device ids stay on the server.
 */
export type LiveConnectionDependencies = {
  metadataStore: MetadataStore;
  createClient: (credentials: TuyaCredentials) => TuyaOpenApiClient;
  /** The server settings' account, for the one Project the environment connects. */
  createEnvironmentClient?: () => TuyaOpenApiClient;
  isSyncRunning?: (projectId: string) => boolean;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
};

export type LiveConnectionMeter = {
  meterPointId: string;
  name: string;
  sourceLabel: string;
  device?: { ref: string; name: string; productName?: string };
  /** The meter is powered with the lights it measures, so being offline while they are off is expected. */
  offWithLights?: true;
  /** Since when the 15-minute live check has seen its device offline. */
  offlineSince?: string;
};

export type LiveConnectionReadModel = {
  projectId: string;
  provider: "tuya";
  /** The server's own settings connect this Project; the app shows it and can take it over, but does not edit it. */
  managedByServer: boolean;
  /** The server settings name this Project, whether or not an administrator has taken it over in the app. */
  environmentProject: boolean;
  connected: boolean;
  accountHint?: string;
  publishedSetup: boolean;
  meters: LiveConnectionMeter[];
  matchedCount: number;
  ready: boolean;
  schedule: { enabled: boolean; localHour: number; timezone: "Asia/Singapore" };
  lastCheck?: { at: string; ok: boolean; message?: string };
  sync: {
    running: boolean;
    lastSuccessAt?: string;
    lastFailureAt?: string;
    lastErrorCode?: string;
    dataUntil?: string;
  };
};

export type LiveConnectionDevice = {
  ref: string;
  name: string;
  productName?: string;
  category?: string;
  online: boolean;
  matchedTo?: string;
  /**
   * Another site already reads this device. `siteName` is given only when that site belongs to the same client,
   * so one client never learns another client's site names.
   */
  usedBy?: { siteName?: string };
};

export type LiveConnectionCheck = {
  ok: boolean;
  message?: string;
  /** Devices the account can see, when sign-in worked. */
  deviceCount?: number;
  /** Zigbee gateways among those devices and how many Tuya sees online. A gateway offline usually means its router or power is down. */
  gateways?: { total: number; online: number; offline: string[] };
  /** `phases` is set when the device was readable: 3 for a three-phase meter, 1 otherwise. */
  meters: Array<{ meterPointId: string; ok: boolean; reason?: string; phases?: 1 | 3 }>;
};

const SECRET_SCOPE_WORKSPACE_ID = "energyiq-live-connectors";
const CREDENTIAL_PATTERN = /^[A-Za-z0-9]{8,128}$/u;

export const liveDeviceRef = (projectId: string, deviceId: string): string =>
  createHash("sha256").update(`energyiq-live:${projectId}:${deviceId}`).digest("hex").slice(0, 24);

export const readLiveConnection = (
  dependencies: LiveConnectionDependencies,
  projectId: string,
): LiveConnectionReadModel => {
  const env = dependencies.env ?? process.env;
  const { metadataStore } = dependencies;
  metadataStore.energyIq.getProject(projectId);
  const environmentProject = isEnvironmentTuyaProject(projectId, env);
  const connection = metadataStore.energyIq.liveConnectors.find(projectId);
  const managedByServer = environmentProject && !connection;
  const rows = publishedMeterRows(metadataStore, projectId);
  const serverBindings = managedByServer ? environmentBindings(dependencies, projectId) : new Map<string, string>();
  const offlineSince = readOfflineSince({ db: metadataStore.db, projectId });
  const meters: LiveConnectionMeter[] = (rows ?? []).map((row) => {
    const binding = connection?.bindings[row.id];
    const serverDeviceId = serverBindings.get(row.id);
    return {
      meterPointId: row.id,
      name: row.presentation?.device_name?.trim() || row.display_name?.trim() || row.source_label,
      sourceLabel: row.source_label,
      ...(binding ? { device: toDeviceView(projectId, binding) } : {}),
      // The server settings hold only device ids; the device list supplies their names.
      ...(serverDeviceId ? { device: { ref: liveDeviceRef(projectId, serverDeviceId), name: "" } } : {}),
      ...(row.presentation?.off_with_lights ? { offWithLights: true as const } : {}),
      ...(offlineSince.has(row.id) ? { offlineSince: offlineSince.get(row.id)! } : {}),
    };
  });
  const matchedCount = meters.filter((meter) => meter.device).length;
  const state = metadataStore.energyIq.sourceSync.findState({ project_id: projectId, source_kind: "tuya" });
  const environmentSchedule = serverSchedule(env);
  return {
    projectId,
    provider: "tuya",
    managedByServer,
    environmentProject,
    connected: managedByServer || Boolean(connection),
    ...(connection ? { accountHint: connection.access_id_hint } : {}),
    publishedSetup: rows !== undefined,
    meters,
    matchedCount,
    ready: meters.length > 0 && matchedCount === meters.length
      && (managedByServer || Object.keys(connection?.bindings ?? {}).length === meters.length),
    schedule: managedByServer
      ? { ...environmentSchedule, timezone: "Asia/Singapore" }
      : {
        enabled: connection?.sync_enabled ?? false,
        localHour: connection?.sync_local_hour ?? 2,
        timezone: "Asia/Singapore",
      },
    ...(connection?.last_check_at && connection.last_check_ok !== undefined ? {
      lastCheck: {
        at: connection.last_check_at,
        ok: connection.last_check_ok,
        ...(connection.last_check_message ? { message: connection.last_check_message } : {}),
      },
    } : {}),
    sync: {
      running: dependencies.isSyncRunning?.(projectId) ?? false,
      ...(state?.last_success_at ? { lastSuccessAt: state.last_success_at } : {}),
      ...(state?.last_failure_at ? { lastFailureAt: state.last_failure_at } : {}),
      ...(state?.last_error_code ? { lastErrorCode: state.last_error_code } : {}),
      ...(state?.watermark_ms === undefined ? {} : { dataUntil: new Date(state.watermark_ms).toISOString() }),
    },
  };
};

/** Check the account can sign in and see devices, then keep it sealed for this Project. */
export const saveLiveConnectionAccount = async (
  dependencies: LiveConnectionDependencies,
  input: { projectId: string; user: UserRecord; accessId: unknown; accessSecret: unknown; takeOver?: unknown },
): Promise<{ connection: LiveConnectionReadModel; deviceCount: number }> => {
  const { metadataStore } = dependencies;
  const project = metadataStore.energyIq.getProject(input.projectId);
  const takingOver = serverOwned(dependencies, input.projectId);
  if (takingOver && input.takeOver !== true) throw new Error("ENERGYIQ_LIVE_CONNECTION_SERVER_MANAGED");
  // Taking over keeps every meter on the device the server settings chose, so the daily update carries on unchanged.
  const inherited = takingOver ? environmentBindings(dependencies, input.projectId) : new Map<string, string>();
  if (takingOver && inherited.size === 0) throw new Error("ENERGYIQ_LIVE_TAKEOVER_UNAVAILABLE");
  const accessId = typeof input.accessId === "string" ? input.accessId.trim() : "";
  const accessSecret = typeof input.accessSecret === "string" ? input.accessSecret.trim() : "";
  if (!CREDENTIAL_PATTERN.test(accessId)) throw new Error("ENERGYIQ_LIVE_ACCESS_ID_INVALID");
  if (!CREDENTIAL_PATTERN.test(accessSecret)) throw new Error("ENERGYIQ_LIVE_ACCESS_SECRET_INVALID");
  const credentials = { accessId, accessSecret };
  const devices = await listWith(dependencies, credentials);
  const visible = new Map(devices.map((device) => [device.id, device]));
  const missing = [...inherited.values()].filter((deviceId) => !visible.has(deviceId)).length;
  // Another account cannot read these devices, and the next daily update would fail for the whole site.
  if (missing > 0) throw new Error(`ENERGYIQ_LIVE_TAKEOVER_DEVICES_MISSING:${missing}`);
  const existing = metadataStore.energyIq.liveConnectors.find(input.projectId);
  const secretUserId = existing?.secret_user_id ?? input.user.id;
  const checkedAt = nowIso(dependencies);
  let secretRef: string;
  metadataStore.db.exec("BEGIN IMMEDIATE");
  try {
    secretRef = metadataStore.secrets.put({
      workspace_id: SECRET_SCOPE_WORKSPACE_ID,
      user_id: secretUserId,
      owner_kind: ENERGYIQ_LIVE_SECRET_OWNER_KIND,
      owner_id: input.projectId,
      value: credentials,
      ...(existing ? { secret_ref: existing.secret_ref } : {}),
    });
    const hint = accessIdHint(accessId);
    metadataStore.energyIq.liveConnectors.saveAccount({
      project_id: input.projectId,
      workspace_id: project.workspace_id,
      secret_ref: secretRef,
      secret_workspace_id: SECRET_SCOPE_WORKSPACE_ID,
      secret_user_id: secretUserId,
      access_id_hint: hint,
      actor_user_id: input.user.id,
      checked_at: checkedAt,
      // Another account sees other devices, so the earlier matches no longer point anywhere.
      reset_bindings: Boolean(existing && existing.access_id_hint !== hint),
    });
    if (takingOver) {
      metadataStore.energyIq.liveConnectors.saveBindings({
        project_id: input.projectId,
        bindings: Object.fromEntries([...inherited].map(([meterPointId, deviceId]) => {
          const device = visible.get(deviceId)!;
          return [meterPointId, {
            device_id: deviceId,
            device_name: device.name,
            ...(device.productName ? { product_name: device.productName } : {}),
          }];
        })),
        actor_user_id: input.user.id,
        updated_at: checkedAt,
      });
      const schedule = serverSchedule(dependencies.env ?? process.env);
      metadataStore.energyIq.liveConnectors.saveSchedule({
        project_id: input.projectId,
        sync_enabled: schedule.enabled,
        sync_local_hour: schedule.localHour,
        actor_user_id: input.user.id,
        updated_at: checkedAt,
      });
    }
    metadataStore.db.exec("COMMIT");
  } catch (error) {
    metadataStore.db.exec("ROLLBACK");
    if (error instanceof Error && error.message === "SECRET_MASTER_KEY_REQUIRED") {
      throw new Error("ENERGYIQ_LIVE_SERVER_KEY_REQUIRED");
    }
    throw error;
  }
  return { connection: readLiveConnection(dependencies, input.projectId), deviceCount: devices.length };
};

export const listLiveConnectionDevices = async (
  dependencies: LiveConnectionDependencies,
  projectId: string,
): Promise<LiveConnectionDevice[]> => {
  let devices: TuyaDeviceSummary[];
  let matchedBy: Map<string, string>;
  if (serverOwned(dependencies, projectId)) {
    dependencies.metadataStore.energyIq.getProject(projectId);
    devices = await listWithClient(() => environmentClient(dependencies));
    matchedBy = new Map([...environmentBindings(dependencies, projectId)].map(([meterPointId, deviceId]) => [deviceId, meterPointId]));
  } else {
    const connection = requireConnection(dependencies, projectId);
    devices = await listWith(dependencies, readLiveConnectionCredentials(dependencies.metadataStore, connection));
    matchedBy = new Map(Object.entries(connection.bindings).map(([meterPointId, binding]) => [binding.device_id, meterPointId]));
  }
  const usedBy = devicesUsedElsewhere(dependencies, projectId);
  return devices
    .map((device) => ({
      ref: liveDeviceRef(projectId, device.id),
      name: device.name,
      ...(device.productName ? { productName: device.productName } : {}),
      ...(device.category ? { category: device.category } : {}),
      online: device.online,
      ...(matchedBy.has(device.id) ? { matchedTo: matchedBy.get(device.id)! } : {}),
      ...(!matchedBy.has(device.id) && usedBy.has(device.id) ? { usedBy: usedBy.get(device.id)! } : {}),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));
};

export type LiveConnectionStarter = {
  filename: string;
  content: Buffer;
  devices: Array<{ ref: string; sourceLabel: string; readings: number }>;
};

const STARTER_MAX_DEVICES = 200;
const STARTER_DEFAULT_DAYS = 7;
const STARTER_MAX_DAYS = 14;
const DEVICE_LIST_NAME_MAX = 120;
const DEVICE_LIST_TEXT_MAX = 300;
const TUYA_DEVICE_ID_PATTERN = /^[A-Za-z0-9]{8,64}$/u;

export type LiveDeviceListStatus = "found" | "not_found" | "gateway" | "duplicate" | "invalid";

export type LiveDeviceListRow = {
  /** The row's position in the list sent, from 1. */
  line: number;
  name: string;
  area?: string;
  equipment?: string;
  status: LiveDeviceListStatus;
  /** Set when the device is in the account: what the starter takes. */
  ref?: string;
  tuyaName?: string;
  online?: boolean;
};

/**
 * Check a site's own device list (a name and a Tuya device ID per meter, optionally its block or area and what it
 * powers) against the devices the connected account can see, before starting the site from them. Each row says
 * whether its device was found; found rows carry the opaque ref the starter takes, so the list's names can become
 * the meter names. Only for a site with no published meters yet, like the starter.
 */
export const resolveLiveConnectionDeviceList = async (
  dependencies: LiveConnectionDependencies,
  input: { projectId: string; rows: unknown },
): Promise<{ rows: LiveDeviceListRow[]; found: number }> => {
  const { metadataStore } = dependencies;
  metadataStore.energyIq.getProject(input.projectId);
  requireAppManaged(dependencies, input.projectId);
  if (publishedMeterRows(metadataStore, input.projectId)) throw new Error("ENERGYIQ_LIVE_STARTER_SETUP_EXISTS");
  if (!Array.isArray(input.rows) || input.rows.length === 0 || input.rows.length > STARTER_MAX_DEVICES) {
    throw new Error("ENERGYIQ_LIVE_DEVICE_LIST_INVALID");
  }
  const submitted = input.rows.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("ENERGYIQ_LIVE_DEVICE_LIST_INVALID");
    const record = row as Record<string, unknown>;
    return {
      name: listText(record.name, DEVICE_LIST_NAME_MAX),
      deviceId: listText(record.deviceId, DEVICE_LIST_TEXT_MAX),
      area: listText(record.area, DEVICE_LIST_NAME_MAX),
      equipment: listText(record.equipment, DEVICE_LIST_TEXT_MAX),
    };
  });
  const credentials = readLiveConnectionCredentials(metadataStore, requireConnection(dependencies, input.projectId));
  const visible = new Map((await listWith(dependencies, credentials)).map((device) => [device.id, device]));
  const seen = new Set<string>();
  const rows = submitted.map(({ name, deviceId, area, equipment }, index): LiveDeviceListRow => {
    const base = { line: index + 1, name, ...(area ? { area } : {}), ...(equipment ? { equipment } : {}) };
    if (!name || !TUYA_DEVICE_ID_PATTERN.test(deviceId)) return { ...base, status: "invalid" };
    if (seen.has(deviceId)) return { ...base, status: "duplicate" };
    seen.add(deviceId);
    const device = visible.get(deviceId);
    if (!device) return { ...base, status: "not_found" };
    const seenInTuya = { tuyaName: device.name, online: device.online };
    return isTuyaGateway(device)
      ? { ...base, status: "gateway", ...seenInTuya }
      : { ...base, status: "found", ref: liveDeviceRef(input.projectId, device.id), ...seenInTuya };
  });
  return { rows, found: rows.filter((row) => row.status === "found").length };
};

/** A list cell as one line of trimmed text, cut to `max` characters; anything that is not text is empty. */
const listText = (value: unknown, max: number): string =>
  typeof value === "string" ? value.replace(/\s+/gu, " ").trim().slice(0, max).trim() : "";

/**
 * Start a site from its Tuya devices instead of a file. Reads the chosen devices' cumulative energy for the last few
 * days and returns it as the same readings file (Device Name, Time, Active Energy) an upload would give, so the normal
 * set-up and publish steps create one meter per device. Each meter's source label is the label returned here, which
 * is how the caller then matches the meter to the device it came from. Only for a site with no published meters yet.
 */
export const buildLiveConnectionStarter = async (
  dependencies: LiveConnectionDependencies,
  input: { projectId: string; deviceRefs: unknown; days?: unknown; labels?: unknown },
): Promise<LiveConnectionStarter> => {
  const { metadataStore } = dependencies;
  metadataStore.energyIq.getProject(input.projectId);
  requireAppManaged(dependencies, input.projectId);
  if (publishedMeterRows(metadataStore, input.projectId)) throw new Error("ENERGYIQ_LIVE_STARTER_SETUP_EXISTS");
  const rawRefs: unknown[] = Array.isArray(input.deviceRefs) ? input.deviceRefs : [];
  // Names from the site's own device list, one per device ref; without them the Tuya device names are used.
  let rawLabels: string[] | undefined;
  if (input.labels !== undefined) {
    if (!Array.isArray(input.labels) || input.labels.length !== rawRefs.length
      || !input.labels.every((label) => typeof label === "string" && label.trim().length > 0 && label.trim().length <= DEVICE_LIST_NAME_MAX)) {
      throw new Error("ENERGYIQ_LIVE_STARTER_LABELS_INVALID");
    }
    rawLabels = input.labels as string[];
  }
  const labelByRef = new Map<string, string | undefined>();
  rawRefs.forEach((ref, index) => {
    if (typeof ref === "string" && ref.length > 0 && !labelByRef.has(ref)) labelByRef.set(ref, rawLabels?.[index]?.trim());
  });
  const refs = [...labelByRef.keys()];
  if (refs.length === 0 || refs.length > STARTER_MAX_DEVICES) throw new Error("ENERGYIQ_LIVE_STARTER_DEVICES_INVALID");
  const days = input.days === undefined ? STARTER_DEFAULT_DAYS : Number(input.days);
  if (!Number.isInteger(days) || days < 1 || days > STARTER_MAX_DAYS) throw new Error("ENERGYIQ_LIVE_STARTER_DAYS_INVALID");

  const credentials = readLiveConnectionCredentials(metadataStore, requireConnection(dependencies, input.projectId));
  const visible = new Map((await listWith(dependencies, credentials)).map((device) => [liveDeviceRef(input.projectId, device.id), device]));
  const chosen = refs.map((ref) => {
    const device = visible.get(ref);
    if (!device) throw new Error("ENERGYIQ_LIVE_DEVICE_NOT_FOUND");
    if (isTuyaGateway(device)) throw new Error("ENERGYIQ_LIVE_STARTER_GATEWAY");
    return { ref, device };
  });
  const labels = uniqueLabels(chosen.map(({ ref, device }) =>
    labelByRef.get(ref) || device.name.trim() || device.productName?.trim() || "Tuya device"));

  const endTime = dependencies.now?.() ?? Date.now();
  const artifact = await dependencies.createClient(credentials).syncEnergyReadings({
    startTime: endTime - days * 86_400_000,
    endTime,
    devices: chosen.map(({ device }, index) => ({ deviceId: device.id, sourceLabel: labels[index]! })),
    credentials,
  });
  const readings = readEnergyTuyaArtifact(Buffer.from(JSON.stringify(artifact))).rows
    .filter((row) => row.eventTime && row.activeEnergyKwh !== undefined && !row.validationError);
  if (readings.length === 0) throw new Error("ENERGYIQ_LIVE_STARTER_NO_READINGS");
  const counts = new Map<string, number>();
  for (const row of readings) counts.set(row.sourceLabel, (counts.get(row.sourceLabel) ?? 0) + 1);
  // Kept as Tuya's own report logs, like the daily update imports them: Tuya meters log their running total when it
  // moves, at uneven times, and only the Tuya import spreads those readings onto a 15-minute grid. Turned into a plain
  // readings file instead, the uneven spacing failed the data check and a new site could not go live (SKTC, Nov 2026).
  return {
    filename: `tuya-start-${new Date(endTime).toISOString().slice(0, 10)}.json`,
    content: Buffer.from(JSON.stringify(artifact), "utf8"),
    devices: chosen.map(({ ref }, index) => ({ ref, sourceLabel: labels[index]!, readings: counts.get(labels[index]!) ?? 0 })),
  };
};

/** Device names become meter labels, which must be unique however they are capitalised or spaced. */
const uniqueLabels = (names: string[]): string[] => {
  const taken = new Set<string>();
  return names.map((name) => {
    const base = name.replace(/\s+/gu, " ").trim();
    let label = base;
    for (let suffix = 2; taken.has(label.toLocaleLowerCase()); suffix += 1) label = `${base} (${suffix})`;
    taken.add(label.toLocaleLowerCase());
    return label;
  });
};

/** Replace every meter's device. A meter left out, or sent as null, is not connected. */
export const saveLiveConnectionMatches = async (
  dependencies: LiveConnectionDependencies,
  input: { projectId: string; user: UserRecord; matches: unknown },
): Promise<LiveConnectionReadModel> => {
  const { metadataStore } = dependencies;
  const connection = requireConnection(dependencies, input.projectId);
  if (typeof input.matches !== "object" || input.matches === null || Array.isArray(input.matches)) {
    throw new Error("ENERGYIQ_LIVE_MATCHES_INVALID");
  }
  const rows = publishedMeterRows(metadataStore, input.projectId);
  if (!rows) throw new Error("ENERGYIQ_LIVE_PUBLISHED_SETUP_REQUIRED");
  const meterIds = new Set(rows.map((row) => row.id));
  const requested = Object.entries(input.matches as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim() !== "");
  for (const [meterPointId] of requested) {
    if (!meterIds.has(meterPointId)) throw new Error("ENERGYIQ_LIVE_METER_UNKNOWN");
  }
  const devices = requested.length === 0
    ? []
    : await listWith(dependencies, readLiveConnectionCredentials(metadataStore, connection));
  const byRef = new Map(devices.map((device) => [liveDeviceRef(input.projectId, device.id), device]));
  const bindings: Record<string, EnergyIqLiveConnectorBinding> = {};
  for (const [meterPointId, ref] of requested) {
    const device = byRef.get(ref.trim());
    if (!device) throw new Error("ENERGYIQ_LIVE_DEVICE_NOT_FOUND");
    bindings[meterPointId] = {
      device_id: device.id,
      device_name: device.name,
      ...(device.productName ? { product_name: device.productName } : {}),
    };
  }
  const updatedAt = nowIso(dependencies);
  metadataStore.energyIq.liveConnectors.saveBindings({
    project_id: input.projectId,
    bindings,
    actor_user_id: input.user.id,
    updated_at: updatedAt,
  });
  // Meters without a device are skipped by the daily update while the rest keep updating; only a site left with no
  // matched meter at all cannot run, so switch it off rather than let it fail every night.
  if (connection.sync_enabled && Object.keys(bindings).length === 0) {
    metadataStore.energyIq.liveConnectors.saveSchedule({
      project_id: input.projectId,
      sync_enabled: false,
      sync_local_hour: connection.sync_local_hour,
      actor_user_id: input.user.id,
      updated_at: updatedAt,
    });
  }
  return readLiveConnection(dependencies, input.projectId);
};

/** A place in the site's Locations tree a new meter can go, in tree order; `depth` 0 is a top-level location. */
export type LiveConnectionLocation = { id: string; name: string; depth: number };

export type LiveConnectionNewDevices = {
  /**
   * Devices in the connected Tuya project that no meter of this site reads yet (gateways left out). A device another
   * site already reads keeps `usedBy` and cannot be added here. `suggestedLocationId` is where meters with the same
   * product already sit, else where most of the site's meters sit.
   */
  devices: Array<LiveConnectionDevice & { suggestedLocationId?: string }>;
  locations: LiveConnectionLocation[];
  defaultLocationId?: string;
};

/** What adding meters needs from the rest of the app: the same steps Start from Tuya, uploads and Facility saves use. */
export type LiveNewMetersPipeline = {
  /** Why the site's current setup could not be made live now, if anything; adding meters would stop at the same place. */
  blockingReasons: (document: EnergyIqProjectSetupDocument) => Promise<string[]>;
  /** Keep the new devices' readings file as an import batch, as Start from Tuya does. */
  registerReadings: (file: { filename: string; content: Buffer }) => Promise<EnergyIqImportBatchRecord>;
  /** Read the batch into the site's data under the saved setup, with exactly these sources, as an upload does. */
  materialize: (batchId: string, sourceSha256: readonly string[]) => Promise<void>;
  /** Make the saved setup live, as saving a Facility change does. */
  applyChanges: () => Promise<void>;
};

const NEW_METERS_MAX = 50;
const NEW_METER_CATEGORIES = new Set<EnergyIqMeterCategory>(["load", "light", "aircon", "it", "kitchen", "plug", "other"]);

/**
 * The devices that could become new meters of a site that already has meters, with the places they could go. Device ids
 * stay on the server: the browser gets each device's opaque ref, as for matching.
 */
export const listLiveConnectionNewDevices = async (
  dependencies: LiveConnectionDependencies,
  input: { projectId: string; userId: string },
): Promise<LiveConnectionNewDevices> => {
  const { metadataStore } = dependencies;
  const connection = requireConnection(dependencies, input.projectId);
  if (!publishedMeterRows(metadataStore, input.projectId)) throw new Error("ENERGYIQ_LIVE_PUBLISHED_SETUP_REQUIRED");
  const devices = (await listLiveConnectionDevices(dependencies, input.projectId))
    .filter((device) => !device.matchedTo && !isTuyaGateway(device));
  const { document } = metadataStore.energyIq.projectSetup.getDraft({ project_id: input.projectId, user_id: input.userId });
  const suggest = locationSuggester(document, connection);
  return {
    devices: devices.map((device) => {
      const suggestedLocationId = suggest(device.productName);
      return { ...device, ...(suggestedLocationId ? { suggestedLocationId } : {}) };
    }),
    locations: locationTree(document),
    ...(suggest(undefined) ? { defaultLocationId: suggest(undefined)! } : {}),
  };
};

/**
 * Add meters for devices in the connected Tuya project to a site that already has meters, and match each to its device.
 * Each meter is placed where the person chose in the Locations tree and goes through the same steps as Start from Tuya:
 * its devices' last 7 days become an import batch, the setup draft gains the meters, the readings are read in, and the
 * setup is made live like any Facility change. Their next readings then come with the daily update. Everything that
 * can be checked is checked before anything changes, so a refusal leaves the site as it was.
 */
export const addLiveConnectionMeters = async (
  dependencies: LiveConnectionDependencies,
  input: { projectId: string; user: UserRecord; meters: unknown; pipeline: LiveNewMetersPipeline },
): Promise<{ connection: LiveConnectionReadModel; added: number }> => {
  const { metadataStore } = dependencies;
  const connection = requireConnection(dependencies, input.projectId);
  if (!publishedMeterRows(metadataStore, input.projectId)) throw new Error("ENERGYIQ_LIVE_PUBLISHED_SETUP_REQUIRED");
  if (dependencies.isSyncRunning?.(input.projectId)) throw new Error("ENERGYIQ_LIVE_SYNC_RUNNING");
  const requested = parseNewMeters(input.meters);

  const credentials = readLiveConnectionCredentials(metadataStore, connection);
  const visible = new Map((await listWith(dependencies, credentials)).map((device) => [liveDeviceRef(input.projectId, device.id), device]));
  const matchedHere = new Set(Object.values(connection.bindings).map((binding) => binding.device_id));
  const usedBy = devicesUsedElsewhere(dependencies, input.projectId);
  const chosen = requested.map((meter) => {
    const device = visible.get(meter.deviceRef);
    if (!device) throw new Error("ENERGYIQ_LIVE_DEVICE_NOT_FOUND");
    if (isTuyaGateway(device)) throw new Error("ENERGYIQ_LIVE_DEVICE_GATEWAY");
    if (matchedHere.has(device.id)) throw new Error("ENERGYIQ_LIVE_DEVICE_ALREADY_MATCHED");
    if (usedBy.has(device.id)) throw new Error("ENERGYIQ_LIVE_DEVICE_USED_ELSEWHERE");
    return { ...meter, device };
  });

  const draft = metadataStore.energyIq.projectSetup.getDraft({ project_id: input.projectId, user_id: input.user.id });
  const blocked = (await input.pipeline.blockingReasons(draft.document)).filter((reason) => reason !== "SNAPSHOT_MAPPING_MISMATCH");
  if (blocked.length > 0) throw new Error(`ENERGYIQ_LIVE_NEW_METERS_DATA_NOT_READY:${blocked.join(",")}`);
  const planned = withNewLiveMeters(draft.document, input.projectId, chosen);
  const invalid = validateProjectSetupDocument(planned.document).issues.filter((issue) => issue.severity === "error");
  if (invalid.length > 0) throw new Error(`ENERGYIQ_LIVE_NEW_METERS_SETUP_INVALID:${[...new Set(invalid.map((issue) => issue.code))].join(",")}`);

  const endTime = dependencies.now?.() ?? Date.now();
  const startTime = endTime - STARTER_DEFAULT_DAYS * 86_400_000;
  let artifact: Awaited<ReturnType<TuyaOpenApiClient["syncEnergyReadings"]>>;
  try {
    artifact = await dependencies.createClient(credentials).syncEnergyReadings({
      startTime,
      endTime,
      devices: chosen.map(({ device }, index) => ({ deviceId: device.id, sourceLabel: planned.rows[index]!.source_label })),
      credentials,
    });
  } catch (error) {
    throw new Error(`ENERGYIQ_LIVE_ACCOUNT_REJECTED:${providerErrorCode(error)}`, { cause: error });
  }
  const batch = await input.pipeline.registerReadings({
    filename: `tuya-new-meters-${new Date(endTime).toISOString().slice(0, 10)}.json`,
    content: Buffer.from(JSON.stringify(artifact), "utf8"),
  });

  // The site keeps every reading it already has; the new batch joins them.
  const snapshot = metadataStore.energyIq.findCurrentDataSnapshot(input.projectId);
  const sources = [...new Set([
    ...(snapshot ? resolveEnergyIqSnapshotFactScope(snapshot).sourceSha256 : draft.document.source_manifest?.source_sha256 ?? []),
    batch.source_sha256,
  ].map((sha) => sha.toLocaleLowerCase()))].sort();
  const saved = metadataStore.energyIq.projectSetup.saveDraft({
    project_id: input.projectId,
    expected_revision: draft.revision,
    user_id: input.user.id,
    document: { ...planned.document, source_manifest: createEnergyIqSourceManifest(sources, true) },
  });

  // A site that has had a daily update judges its data by the sources that update kept. Record this read as a run too,
  // so those sources include the new batch; ending it at the current watermark leaves the next daily update's start
  // where it was, so no existing meter misses a day.
  const state = metadataStore.energyIq.sourceSync.findState({ project_id: input.projectId, source_kind: "tuya" });
  const watermark = state?.active_source_sha256.length ? state.watermark_ms : undefined;
  const claim = watermark === undefined ? undefined : metadataStore.energyIq.sourceSync.claim({
    id: `energy-source-sync-${randomUUID()}`,
    workspace_id: metadataStore.energyIq.getProject(input.projectId).workspace_id,
    project_id: input.projectId,
    source_kind: "tuya",
    connector_fingerprint: createHash("sha256").update(`energyiq-live-new-meters:${input.projectId}:${batch.source_sha256}`).digest("hex"),
    trigger: "manual",
    window_start_ms: Math.min(startTime, watermark - 3_600_000),
    window_end_ms: watermark,
    actor_user_id: input.user.id,
    started_at: new Date(endTime).toISOString(),
  });
  const run = claim && !claim.reused ? claim.run : undefined;
  try {
    await input.pipeline.materialize(batch.id, sources);
    if (run) {
      const current = metadataStore.energyIq.findCurrentDataSnapshot(input.projectId);
      if (!current) throw new Error("ENERGYIQ_SNAPSHOT_REQUIRED");
      metadataStore.energyIq.sourceSync.completeSuccess({
        run_id: run.id,
        import_batch_id: batch.id,
        data_snapshot_id: current.id,
        active_source_sha256: resolveEnergyIqSnapshotFactScope(current).sourceSha256,
        completed_at: nowIso(dependencies),
      });
    }
  } catch (error) {
    if (run) {
      try {
        metadataStore.energyIq.sourceSync.completeFailure({
          run_id: run.id,
          error_code: providerErrorCode(error).replace(/[^A-Za-z0-9_:-]+/gu, "_").slice(0, 160),
          completed_at: nowIso(dependencies),
        });
      } catch {
        // The run is marked interrupted at the next start-up instead.
      }
    }
    // Put the draft back so trying again starts from the site as it was.
    try {
      metadataStore.energyIq.projectSetup.saveDraft({
        project_id: input.projectId,
        expected_revision: saved.revision,
        user_id: input.user.id,
        document: draft.document,
      });
    } catch {
      // Someone saved the draft in the meantime; theirs wins.
    }
    throw error;
  }
  await input.pipeline.applyChanges();

  const bindings: Record<string, EnergyIqLiveConnectorBinding> = { ...connection.bindings };
  chosen.forEach(({ device }, index) => {
    bindings[planned.rows[index]!.id] = {
      device_id: device.id,
      device_name: device.name,
      ...(device.productName ? { product_name: device.productName } : {}),
    };
  });
  metadataStore.energyIq.liveConnectors.saveBindings({
    project_id: input.projectId,
    bindings,
    actor_user_id: input.user.id,
    updated_at: nowIso(dependencies),
  });
  return { connection: readLiveConnection(dependencies, input.projectId), added: chosen.length };
};

type NewMeterRequest = { deviceRef: string; name: string; locationId: string; offWithLights: boolean; category: EnergyIqMeterCategory };

const parseNewMeters = (value: unknown): NewMeterRequest[] => {
  if (!Array.isArray(value) || value.length === 0 || value.length > NEW_METERS_MAX) throw new Error("ENERGYIQ_LIVE_NEW_METERS_INVALID");
  const refs = new Set<string>();
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("ENERGYIQ_LIVE_NEW_METERS_INVALID");
    const record = item as Record<string, unknown>;
    const deviceRef = typeof record.deviceRef === "string" ? record.deviceRef.trim() : "";
    const name = listText(record.name, DEVICE_LIST_NAME_MAX);
    const locationId = typeof record.locationId === "string" ? record.locationId : "";
    if (!deviceRef || refs.has(deviceRef) || !locationId) throw new Error("ENERGYIQ_LIVE_NEW_METERS_INVALID");
    if (!name) throw new Error("ENERGYIQ_LIVE_STARTER_LABELS_INVALID");
    if (record.offWithLights !== undefined && typeof record.offWithLights !== "boolean") throw new Error("ENERGYIQ_LIVE_NEW_METERS_INVALID");
    const category = record.category === undefined ? "other" : record.category;
    if (typeof category !== "string" || !NEW_METER_CATEGORIES.has(category as EnergyIqMeterCategory)) throw new Error("ENERGYIQ_LIVE_NEW_METERS_INVALID");
    refs.add(deviceRef);
    return { deviceRef, name, locationId, offWithLights: record.offWithLights === true, category: category as EnergyIqMeterCategory };
  });
};

const labelKey = (value: string): string => value.trim().replace(/\s+/gu, " ").toLocaleLowerCase();
const slugOf = (value: string): string => value.toLocaleLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "device";
const uniqueIn = (base: string, taken: Set<string>, key: (value: string) => string = (value) => value): string => {
  let candidate = base;
  for (let suffix = 2; taken.has(key(candidate)); suffix += 1) candidate = `${base} (${suffix})`;
  taken.add(key(candidate));
  return candidate;
};
const uniqueId = (base: string, taken: Set<string>): string => {
  let candidate = base;
  for (let suffix = 2; taken.has(candidate); suffix += 1) candidate = `${base}-${suffix}`;
  taken.add(candidate);
  return candidate;
};

/**
 * The setup with new meters added where the person chose. A meter placed in a location that has a level below it gets
 * its own location there, named after it, as Smart setup builds a site; in a bottom-level location it sits directly.
 * Each meter counts towards its location and every location above it, except where a whole-site or whole-location
 * meter already measures that place, so nothing is counted twice. Existing meters, locations and totals are untouched.
 */
export const withNewLiveMeters = (
  document: EnergyIqProjectSetupDocument,
  projectId: string,
  meters: Array<{ name: string; locationId: string; offWithLights: boolean; category: EnergyIqMeterCategory }>,
): { document: EnergyIqProjectSetupDocument; rows: EnergyIqMeterMappingRow[] } => {
  const mapping = document.meter_mapping;
  if (!mapping) throw new Error("ENERGYIQ_LIVE_PUBLISHED_SETUP_REQUIRED");
  const nodes: EnergyIqProjectSetupNode[] = [...document.nodes];
  const rows: EnergyIqMeterMappingRow[] = [...mapping.rows];
  const routes: EnergyIqOfficialAggregationRoute[] = (mapping.official_aggregation_routes ?? [])
    .map((route) => ({ ...route, meter_point_ids: [...route.meter_point_ids] }));
  const tiersById = new Map(document.tiers.map((tier) => [tier.id, tier]));
  const labels = new Set(rows.map((row) => labelKey(row.source_label)));
  const rowIds = new Set([...rows.map((row) => row.id), ...(mapping.virtual_meters ?? []).map((meter) => meter.id)]);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const added: EnergyIqMeterMappingRow[] = [];
  const routesHere = (scope: string) => routes.filter((route) => route.scope_id === scope && route.resource === "electricity");
  const coveredHere = (scope: string) => routesHere(scope).some((route) => route.category === "overall");
  /** The location and every location above it, then the whole site. */
  const scopesFrom = (scopeId: string): string[] => {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const scopes = [scopeId];
    let parent = byId.get(scopeId)?.parent_id;
    while (parent && !scopes.includes(parent)) {
      scopes.push(parent);
      parent = byId.get(parent)?.parent_id;
    }
    return [...scopes, "project"];
  };
  for (const meter of meters) {
    const location = nodes.find((node) => node.id === meter.locationId);
    const tier = location ? tiersById.get(location.tier_definition_id) : undefined;
    if (!location || !tier) throw new Error("ENERGYIQ_LIVE_LOCATION_UNKNOWN");
    const label = uniqueIn(meter.name.replace(/\s+/gu, " ").trim(), labels, labelKey);
    const childTier = document.tiers.find((candidate) => candidate.ordinal === tier.ordinal - 1);
    let scopeId = location.id;
    if (childTier) {
      const siblings = nodes.filter((node) => node.parent_id === location.id && node.tier_definition_id === childTier.id);
      const own: EnergyIqProjectSetupNode = {
        id: uniqueId(`${projectId}-smart-circuit-${slugOf(label)}`, nodeIds),
        tier_definition_id: childTier.id,
        parent_id: location.id,
        name: uniqueIn(label, new Set(siblings.map((node) => labelKey(node.name))), labelKey),
        sort_order: siblings.reduce((highest, node) => Math.max(highest, node.sort_order + 1), 0),
        metadata_status: "provisional",
      };
      nodes.push(own);
      scopeId = own.id;
    }
    const row: EnergyIqMeterMappingRow = {
      id: uniqueId(`mapping-${slugOf(label)}-${rows.length + 1}`, rowIds),
      source_label: label,
      scope_id: scopeId,
      navigation_scope_id: scopeId,
      display_name: label,
      resource: "electricity",
      category: meter.category,
      coverage: "partial",
      meter_role: "component",
      // A location measured by its own whole-location meter already includes this one.
      aggregation_usage: coveredHere(scopeId) ? "excluded" : "official",
      ...(meter.offWithLights ? { presentation: { off_with_lights: "yes" } } : {}),
    };
    rows.push(row);
    added.push(row);
    if (row.aggregation_usage !== "official") continue;
    for (const scope of scopesFrom(scopeId)) {
      if (coveredHere(scope)) continue;
      const route = routesHere(scope).find((candidate) => candidate.category === row.category);
      if (route) route.meter_point_ids = [...route.meter_point_ids, row.id].sort();
      else routes.push({ scope_id: scope, resource: "electricity", category: row.category, meter_point_ids: [row.id] });
    }
  }
  return {
    document: { ...document, nodes, meter_mapping: { ...mapping, rows, official_aggregation_routes: routes, confirmed: true } },
    rows: added,
  };
};

/** Every location in tree order: each top-level location, then the locations inside it. */
const locationTree = (document: EnergyIqProjectSetupDocument): LiveConnectionLocation[] => {
  const ids = new Set(document.nodes.map((node) => node.id));
  const byOrder = (left: EnergyIqProjectSetupNode, right: EnergyIqProjectSetupNode) =>
    left.sort_order - right.sort_order || left.name.localeCompare(right.name, undefined, { numeric: true });
  const result: LiveConnectionLocation[] = [];
  const seen = new Set<string>();
  const visit = (parentId: string | undefined, depth: number) => {
    for (const node of document.nodes.filter((candidate) => (candidate.parent_id && ids.has(candidate.parent_id) ? candidate.parent_id : undefined) === parentId).sort(byOrder)) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      result.push({ id: node.id, name: node.name, depth });
      visit(node.id, depth + 1);
    }
  };
  visit(undefined, 0);
  return result;
};

/**
 * Where a new meter most likely goes: where meters on the same Tuya product sit, else where most of the site's meters
 * sit, else the first top-level location. A meter alone in its own bottom-level location (as Smart setup builds a site)
 * sits in the location above it, so a new meter gets its own location there too rather than sharing another's.
 */
const locationSuggester = (
  document: EnergyIqProjectSetupDocument,
  connection: EnergyIqLiveConnectorRecord,
): (productName: string | undefined) => string | undefined => {
  const rows = document.meter_mapping?.rows ?? [];
  const nodesById = new Map(document.nodes.map((node) => [node.id, node]));
  const lowest = Math.min(...document.tiers.map((tier) => tier.ordinal));
  const ordinalOf = (node: EnergyIqProjectSetupNode) => document.tiers.find((tier) => tier.id === node.tier_definition_id)?.ordinal;
  const meterCount = new Map<string, number>();
  for (const row of rows) {
    const scope = row.navigation_scope_id ?? row.scope_id;
    meterCount.set(scope, (meterCount.get(scope) ?? 0) + 1);
  }
  const homeOf = (row: EnergyIqMeterMappingRow): string | undefined => {
    const node = nodesById.get(row.navigation_scope_id ?? row.scope_id);
    if (!node) return undefined;
    const ownLocation = document.tiers.length > 1 && node.parent_id && nodesById.has(node.parent_id)
      && ordinalOf(node) === lowest && meterCount.get(node.id) === 1
      && !document.nodes.some((candidate) => candidate.parent_id === node.id);
    return ownLocation ? node.parent_id : node.id;
  };
  const tally = (filter: (row: EnergyIqMeterMappingRow) => boolean): string | undefined => {
    const counts = new Map<string, number>();
    for (const row of rows.filter(filter)) {
      const home = homeOf(row);
      if (home) counts.set(home, (counts.get(home) ?? 0) + 1);
    }
    return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
  };
  const fallback = tally(() => true) ?? locationTree(document)[0]?.id;
  return (productName) => {
    const product = productName?.trim().toLocaleLowerCase();
    const similar = product
      ? tally((row) => connection.bindings[row.id]?.product_name?.trim().toLocaleLowerCase() === product)
      : undefined;
    return similar ?? fallback;
  };
};

/** Sign in, then ask Tuya whether each matched device reports the readings a daily update needs. */
export const checkLiveConnection = async (
  dependencies: LiveConnectionDependencies,
  projectId: string,
): Promise<LiveConnectionCheck> => {
  const { metadataStore } = dependencies;
  const connection = serverOwned(dependencies, projectId) ? undefined : requireConnection(dependencies, projectId);
  const bindings = connection
    ? Object.entries(connection.bindings).map(([meterPointId, binding]) => [meterPointId, binding.device_id] as const)
    : [...environmentBindings(dependencies, projectId)];
  const checkedAt = nowIso(dependencies);
  let result: LiveConnectionCheck;
  try {
    const client = connection
      ? dependencies.createClient(readLiveConnectionCredentials(metadataStore, connection))
      : environmentClient(dependencies);
    const devices = await client.listDevices();
    const deviceCount = devices.length;
    const gatewayDevices = devices.filter(isTuyaGateway);
    const gateways = gatewayDevices.length > 0
      ? {
        total: gatewayDevices.length,
        online: gatewayDevices.filter((device) => device.online).length,
        offline: gatewayDevices.filter((device) => !device.online).map((device) => device.name).slice(0, 20),
      }
      : undefined;
    const meters: LiveConnectionCheck["meters"] = [];
    for (const [meterPointId, deviceId] of bindings) {
      const check = await client.checkEnergyDevice(deviceId);
      meters.push(check.ok ? { meterPointId, ok: true, phases: check.phases } : { meterPointId, ok: false, reason: check.reason });
    }
    const failed = meters.filter((meter) => !meter.ok).length;
    result = failed === 0
      ? { ok: true, deviceCount, meters, ...(gateways ? { gateways } : {}) }
      : { ok: false, message: "ENERGYIQ_LIVE_DEVICES_UNSUITABLE", deviceCount, meters, ...(gateways ? { gateways } : {}) };
  } catch (error) {
    result = { ok: false, message: providerErrorCode(error), meters: [] };
  }
  metadataStore.energyIq.liveConnectors.recordCheck({
    project_id: projectId,
    ok: result.ok,
    ...(result.message ? { message: result.message } : {}),
    checked_at: checkedAt,
  });
  return result;
};

export const saveLiveConnectionSchedule = (
  dependencies: LiveConnectionDependencies,
  input: { projectId: string; user: UserRecord; enabled: unknown; localHour: unknown },
): LiveConnectionReadModel => {
  const connection = requireConnection(dependencies, input.projectId);
  if (typeof input.enabled !== "boolean") throw new Error("ENERGYIQ_LIVE_SYNC_ENABLED_INVALID");
  const localHour = input.localHour === undefined ? connection.sync_local_hour : input.localHour;
  if (typeof localHour !== "number" || !Number.isInteger(localHour) || localHour < 0 || localHour > 23) {
    throw new Error("ENERGYIQ_LIVE_SYNC_HOUR_INVALID");
  }
  if (input.enabled) requireSyncable(dependencies, input.projectId);
  dependencies.metadataStore.energyIq.liveConnectors.saveSchedule({
    project_id: input.projectId,
    sync_enabled: input.enabled,
    sync_local_hour: localHour,
    actor_user_id: input.user.id,
    updated_at: nowIso(dependencies),
  });
  return readLiveConnection(dependencies, input.projectId);
};

/** Forget the account and matches. Readings already fetched stay with the Project. */
export const disconnectLiveConnection = (
  dependencies: LiveConnectionDependencies,
  projectId: string,
): LiveConnectionReadModel => {
  requireAppManaged(dependencies, projectId);
  const removed = dependencies.metadataStore.energyIq.liveConnectors.delete(projectId);
  if (removed) {
    dependencies.metadataStore.secrets.delete({
      ref: removed.secret_ref,
      workspace_id: removed.secret_workspace_id,
      user_id: removed.secret_user_id,
    });
  }
  return readLiveConnection(dependencies, projectId);
};

/** Every meter matched against the published setup: what a sync, manual or daily, needs before it starts. */
export const requireSyncable = (dependencies: LiveConnectionDependencies, projectId: string): void => {
  try {
    resolveEnergyTuyaProjectConnector({
      metadataStore: dependencies.metadataStore,
      projectId,
      ...(dependencies.env ? { env: dependencies.env } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "ENERGYIQ_TUYA_DEVICE_BINDINGS_MISMATCH") throw new Error("ENERGYIQ_LIVE_METERS_NOT_MATCHED");
    throw error;
  }
};

export const providerErrorCode = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  const code = message.match(/ENERGYIQ_[A-Z0-9_]+(?::[^\s]*)?/u)?.[0];
  return (code ?? "ENERGYIQ_LIVE_PROVIDER_UNREACHABLE").slice(0, 200);
};

type PublishedMeterRow = NonNullable<EnergyIqProjectSetupDocument["meter_mapping"]>["rows"][number];

const publishedMeterRows = (metadataStore: MetadataStore, projectId: string): PublishedMeterRow[] | undefined => {
  const project = metadataStore.energyIq.getProject(projectId);
  const revision = metadataStore.energyIq.projectSetup
    .listHierarchyRevisions(projectId)
    .find((candidate) => candidate.id === project.hierarchy_revision_id);
  if (!revision) return undefined;
  try {
    const document = JSON.parse(revision.snapshot_json) as EnergyIqProjectSetupDocument;
    const mapping = document.meter_mapping;
    return mapping?.confirmed && Array.isArray(mapping.rows) ? mapping.rows : undefined;
  } catch {
    return undefined;
  }
};

const listWith = (
  dependencies: LiveConnectionDependencies,
  credentials: TuyaCredentials,
): Promise<TuyaDeviceSummary[]> => listWithClient(() => dependencies.createClient(credentials));

const listWithClient = async (client: () => TuyaOpenApiClient): Promise<TuyaDeviceSummary[]> => {
  try {
    return await client().listDevices();
  } catch (error) {
    throw new Error(`ENERGYIQ_LIVE_ACCOUNT_REJECTED:${providerErrorCode(error)}`);
  }
};

const environmentClient = (dependencies: LiveConnectionDependencies): TuyaOpenApiClient =>
  (dependencies.createEnvironmentClient ?? (() => createTuyaOpenApiClientFromEnv(dependencies.env ?? process.env)))();

/** Meter id -> device id from the server settings, or nothing when they no longer fit the published setup. */
const environmentBindings = (dependencies: LiveConnectionDependencies, projectId: string): Map<string, string> => {
  try {
    const connector = resolveEnergyTuyaProjectConnector({
      metadataStore: dependencies.metadataStore,
      projectId,
      source: "environment",
      ...(dependencies.env ? { env: dependencies.env } : {}),
    });
    return new Map(connector.meterPoints.map((meterPoint, index) => [meterPoint.meterPointId, connector.devices[index]!.deviceId]));
  } catch {
    return new Map();
  }
};

/** The server settings connect this Project and nobody has taken it over in the app. */
/**
 * Device id -> the other site that already reads it: devices matched in another app-managed connection, and the
 * server-managed Project's devices while the server settings still own it. One Tuya cloud project can hold several
 * sites' devices, so starting a new site must not take another site's meters by default.
 */
const devicesUsedElsewhere = (
  dependencies: LiveConnectionDependencies,
  projectId: string,
): Map<string, { siteName?: string }> => {
  const { metadataStore } = dependencies;
  const ownWorkspaceId = metadataStore.energyIq.getProject(projectId).workspace_id;
  const owners = new Map<string, string>();
  for (const connection of metadataStore.energyIq.liveConnectors.list()) {
    if (connection.project_id === projectId) continue;
    for (const binding of Object.values(connection.bindings)) owners.set(binding.device_id, connection.project_id);
  }
  const environmentProjectId = (dependencies.env ?? process.env).ENERGYIQ_TUYA_CONNECTOR_PROJECT_ID?.trim();
  if (environmentProjectId && environmentProjectId !== projectId && serverOwned(dependencies, environmentProjectId)) {
    for (const deviceId of environmentBindings(dependencies, environmentProjectId).values()) owners.set(deviceId, environmentProjectId);
  }
  const sites = new Map<string, { siteName?: string }>();
  const usedBy = new Map<string, { siteName?: string }>();
  for (const [deviceId, ownerId] of owners) {
    if (!sites.has(ownerId)) {
      let site: { siteName?: string } = {};
      try {
        const owner = metadataStore.energyIq.getProject(ownerId);
        if (owner.workspace_id === ownWorkspaceId) site = { siteName: owner.name };
      } catch {
        // A connection whose Project is gone still holds the device; name nothing.
      }
      sites.set(ownerId, site);
    }
    usedBy.set(deviceId, sites.get(ownerId)!);
  }
  return usedBy;
};

const serverOwned = (dependencies: LiveConnectionDependencies, projectId: string): boolean =>
  isEnvironmentTuyaProject(projectId, dependencies.env ?? process.env)
  && !dependencies.metadataStore.energyIq.liveConnectors.find(projectId);

const serverSchedule = (env: NodeJS.ProcessEnv): { enabled: boolean; localHour: number } => {
  const localHour = Number(env.ENERGYIQ_TUYA_SYNC_LOCAL_HOUR?.trim() || 2);
  return {
    enabled: env.ENERGYIQ_TUYA_SYNC_ENABLED?.trim().toLocaleLowerCase() === "true",
    localHour: Number.isInteger(localHour) && localHour >= 0 && localHour <= 23 ? localHour : 2,
  };
};

const requireAppManaged = (dependencies: LiveConnectionDependencies, projectId: string): void => {
  if (serverOwned(dependencies, projectId)) {
    throw new Error("ENERGYIQ_LIVE_CONNECTION_SERVER_MANAGED");
  }
};

const requireConnection = (
  dependencies: LiveConnectionDependencies,
  projectId: string,
): EnergyIqLiveConnectorRecord => {
  requireAppManaged(dependencies, projectId);
  dependencies.metadataStore.energyIq.getProject(projectId);
  const connection = dependencies.metadataStore.energyIq.liveConnectors.find(projectId);
  if (!connection) throw new Error("ENERGYIQ_LIVE_CONNECTION_REQUIRED");
  return connection;
};

const toDeviceView = (projectId: string, binding: EnergyIqLiveConnectorBinding): NonNullable<LiveConnectionMeter["device"]> => ({
  ref: liveDeviceRef(projectId, binding.device_id),
  name: binding.device_name || "Device",
  ...(binding.product_name ? { productName: binding.product_name } : {}),
});

const accessIdHint = (accessId: string): string =>
  accessId.length <= 8 ? `${accessId.slice(0, 2)}…` : `${accessId.slice(0, 4)}…${accessId.slice(-4)}`;

const nowIso = (dependencies: LiveConnectionDependencies): string =>
  new Date((dependencies.now ?? Date.now)()).toISOString();

/** Tuya's Zigbee gateway categories ("wg2" and the older "wg"), or a device whose product calls itself a gateway. */
export const isTuyaGateway = (device: { category?: string; productName?: string; name: string }): boolean =>
  device.category === "wg2" || device.category === "wg" || /gateway|网关/iu.test(device.productName ?? "");
