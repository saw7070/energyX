import { createHash } from "node:crypto";
import type {
  EnergyIqLiveConnectorBinding,
  EnergyIqLiveConnectorRecord,
  EnergyIqProjectSetupDocument,
  MetadataStore,
  UserRecord,
} from "@datafoundry/metadata";

import {
  ENERGYIQ_LIVE_SECRET_OWNER_KIND,
  isEnvironmentTuyaProject,
  readLiveConnectionCredentials,
  resolveEnergyTuyaProjectConnector,
} from "./energy-tuya-connector.js";
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
};

export type LiveConnectionReadModel = {
  projectId: string;
  provider: "tuya";
  /** The server's own settings connect this Project; the app shows it but does not change it. */
  managedByServer: boolean;
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
};

export type LiveConnectionCheck = {
  ok: boolean;
  message?: string;
  meters: Array<{ meterPointId: string; ok: boolean; reason?: string }>;
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
  const managedByServer = isEnvironmentTuyaProject(projectId, env);
  const connection = managedByServer ? undefined : metadataStore.energyIq.liveConnectors.find(projectId);
  const rows = publishedMeterRows(metadataStore, projectId);
  const serverBindings = managedByServer ? environmentBindings(dependencies, projectId) : new Map<string, string>();
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
    };
  });
  const matchedCount = meters.filter((meter) => meter.device).length;
  const state = metadataStore.energyIq.sourceSync.findState({ project_id: projectId, source_kind: "tuya" });
  const envLocalHour = Number(env.ENERGYIQ_TUYA_SYNC_LOCAL_HOUR ?? 2);
  return {
    projectId,
    provider: "tuya",
    managedByServer,
    connected: managedByServer || Boolean(connection),
    ...(connection ? { accountHint: connection.access_id_hint } : {}),
    publishedSetup: rows !== undefined,
    meters,
    matchedCount,
    ready: meters.length > 0 && matchedCount === meters.length
      && (managedByServer || Object.keys(connection?.bindings ?? {}).length === meters.length),
    schedule: managedByServer
      ? {
        enabled: env.ENERGYIQ_TUYA_SYNC_ENABLED?.trim().toLocaleLowerCase() === "true",
        localHour: Number.isInteger(envLocalHour) && envLocalHour >= 0 && envLocalHour <= 23 ? envLocalHour : 2,
        timezone: "Asia/Singapore",
      }
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
  input: { projectId: string; user: UserRecord; accessId: unknown; accessSecret: unknown },
): Promise<{ connection: LiveConnectionReadModel; deviceCount: number }> => {
  const { metadataStore } = dependencies;
  const project = metadataStore.energyIq.getProject(input.projectId);
  requireAppManaged(dependencies, input.projectId);
  const accessId = typeof input.accessId === "string" ? input.accessId.trim() : "";
  const accessSecret = typeof input.accessSecret === "string" ? input.accessSecret.trim() : "";
  if (!CREDENTIAL_PATTERN.test(accessId)) throw new Error("ENERGYIQ_LIVE_ACCESS_ID_INVALID");
  if (!CREDENTIAL_PATTERN.test(accessSecret)) throw new Error("ENERGYIQ_LIVE_ACCESS_SECRET_INVALID");
  const credentials = { accessId, accessSecret };
  const devices = await listWith(dependencies, credentials);
  const existing = metadataStore.energyIq.liveConnectors.find(input.projectId);
  const secretUserId = existing?.secret_user_id ?? input.user.id;
  let secretRef: string;
  try {
    secretRef = metadataStore.secrets.put({
      workspace_id: SECRET_SCOPE_WORKSPACE_ID,
      user_id: secretUserId,
      owner_kind: ENERGYIQ_LIVE_SECRET_OWNER_KIND,
      owner_id: input.projectId,
      value: credentials,
      ...(existing ? { secret_ref: existing.secret_ref } : {}),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "SECRET_MASTER_KEY_REQUIRED") {
      throw new Error("ENERGYIQ_LIVE_SERVER_KEY_REQUIRED");
    }
    throw error;
  }
  const hint = accessIdHint(accessId);
  metadataStore.energyIq.liveConnectors.saveAccount({
    project_id: input.projectId,
    workspace_id: project.workspace_id,
    secret_ref: secretRef,
    secret_workspace_id: SECRET_SCOPE_WORKSPACE_ID,
    secret_user_id: secretUserId,
    access_id_hint: hint,
    actor_user_id: input.user.id,
    checked_at: nowIso(dependencies),
    // Another account sees other devices, so the earlier matches no longer point anywhere.
    reset_bindings: Boolean(existing && existing.access_id_hint !== hint),
  });
  return { connection: readLiveConnection(dependencies, input.projectId), deviceCount: devices.length };
};

export const listLiveConnectionDevices = async (
  dependencies: LiveConnectionDependencies,
  projectId: string,
): Promise<LiveConnectionDevice[]> => {
  let devices: TuyaDeviceSummary[];
  let matchedBy: Map<string, string>;
  if (isEnvironmentTuyaProject(projectId, dependencies.env ?? process.env)) {
    dependencies.metadataStore.energyIq.getProject(projectId);
    devices = await listWithClient(() => environmentClient(dependencies));
    matchedBy = new Map([...environmentBindings(dependencies, projectId)].map(([meterPointId, deviceId]) => [deviceId, meterPointId]));
  } else {
    const connection = requireConnection(dependencies, projectId);
    devices = await listWith(dependencies, readLiveConnectionCredentials(dependencies.metadataStore, connection));
    matchedBy = new Map(Object.entries(connection.bindings).map(([meterPointId, binding]) => [binding.device_id, meterPointId]));
  }
  return devices
    .map((device) => ({
      ref: liveDeviceRef(projectId, device.id),
      name: device.name,
      ...(device.productName ? { productName: device.productName } : {}),
      ...(device.category ? { category: device.category } : {}),
      online: device.online,
      ...(matchedBy.has(device.id) ? { matchedTo: matchedBy.get(device.id)! } : {}),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));
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
  // A daily update cannot run with a meter missing, so switch it off rather than let it fail every night.
  if (connection.sync_enabled && Object.keys(bindings).length !== rows.length) {
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

/** Sign in, then ask Tuya whether each matched device reports the readings a daily update needs. */
export const checkLiveConnection = async (
  dependencies: LiveConnectionDependencies,
  projectId: string,
): Promise<LiveConnectionCheck> => {
  const { metadataStore } = dependencies;
  const managedByServer = isEnvironmentTuyaProject(projectId, dependencies.env ?? process.env);
  const connection = managedByServer ? undefined : requireConnection(dependencies, projectId);
  const bindings = connection
    ? Object.entries(connection.bindings).map(([meterPointId, binding]) => [meterPointId, binding.device_id] as const)
    : [...environmentBindings(dependencies, projectId)];
  const checkedAt = nowIso(dependencies);
  let result: LiveConnectionCheck;
  try {
    const client = connection
      ? dependencies.createClient(readLiveConnectionCredentials(metadataStore, connection))
      : environmentClient(dependencies);
    await client.listDevices();
    const meters: LiveConnectionCheck["meters"] = [];
    for (const [meterPointId, deviceId] of bindings) {
      const check = await client.checkEnergyDevice(deviceId);
      meters.push(check.ok ? { meterPointId, ok: true } : { meterPointId, ok: false, reason: check.reason });
    }
    const failed = meters.filter((meter) => !meter.ok).length;
    result = failed === 0
      ? { ok: true, meters }
      : { ok: false, message: "ENERGYIQ_LIVE_DEVICES_UNSUITABLE", meters };
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
      ...(dependencies.env ? { env: dependencies.env } : {}),
    });
    return new Map(connector.meterPoints.map((meterPoint, index) => [meterPoint.meterPointId, connector.devices[index]!.deviceId]));
  } catch {
    return new Map();
  }
};

const requireAppManaged = (dependencies: LiveConnectionDependencies, projectId: string): void => {
  if (isEnvironmentTuyaProject(projectId, dependencies.env ?? process.env)) {
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
