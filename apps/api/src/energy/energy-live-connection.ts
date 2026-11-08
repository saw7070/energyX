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
import { readEnergyTuyaArtifact } from "./energy-tuya-import.js";
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
  const project = metadataStore.energyIq.getProject(input.projectId);
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
  // The file holds the site's own wall-clock time, exactly like an export from the meter app.
  const wallClock = siteWallClock(project.timezone);
  const lines = [
    "Device Name,Time,Active Energy",
    ...readings.map((row) => `${csvCell(row.sourceLabel)},${wallClock(row.eventTime!)},${row.activeEnergyKwh}`),
  ];
  return {
    filename: `tuya-start-${new Date(endTime).toISOString().slice(0, 10)}.csv`,
    content: Buffer.from(`${lines.join("\r\n")}\r\n`, "utf8"),
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

const csvCell = (value: string): string => /[",\r\n]/u.test(value) ? `"${value.replace(/"/gu, '""')}"` : value;

const siteWallClock = (timezone: string): ((iso: string) => string) => {
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone || "Asia/Singapore",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  return (iso) => {
    const parts = Object.fromEntries(format.formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
  };
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
