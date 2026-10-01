import { createHash } from "node:crypto";
import type { EnergyIqLiveConnectorRecord, EnergyIqProjectSetupDocument, MetadataStore } from "@datafoundry/metadata";

import type { TuyaCredentials, TuyaDeviceBinding } from "./tuya-openapi-client.js";

export type EnergyTuyaProjectConnector = {
  projectId: string;
  workspaceId: string;
  hierarchyRevisionId: string;
  hierarchySequence: number;
  publishedDocument: EnergyIqProjectSetupDocument;
  connectorFingerprint: string;
  devices: TuyaDeviceBinding[];
  meterPoints: Array<{ meterPointId: string; sourceLabel: string }>;
  /** "environment": the server's ENERGYIQ_TUYA_* settings. "app": connected by an administrator in EnergyIQ. */
  managedBy?: "environment" | "app";
  /** The Project's own account, present only for an app connection. Never serialise a connector to a response. */
  credentials?: TuyaCredentials;
  /** The app connection's own daily update; an environment connection follows ENERGYIQ_TUYA_SYNC_*. */
  schedule?: { enabled: boolean; localHour: number };
};

export const ENERGYIQ_LIVE_SECRET_OWNER_KIND = "energyiq-live-connector";

export const resolveEnergyTuyaProjectConnector = (input: {
  metadataStore: MetadataStore;
  projectId: string;
  env?: NodeJS.ProcessEnv;
  /**
   * "auto" (default): an app connection when the Project has one, the server settings otherwise. An administrator
   * can take over the server-configured Project in the app, and from then on the app connection is the one in use.
   * "environment": the server settings only, for the server's own start-up checks and scheduler.
   */
  source?: "auto" | "environment";
}): EnergyTuyaProjectConnector => {
  const env = input.env ?? process.env;
  const configuredProjectId = env.ENERGYIQ_TUYA_CONNECTOR_PROJECT_ID?.trim();
  const configuredWorkspaceId = env.ENERGYIQ_TUYA_CONNECTOR_WORKSPACE_ID?.trim();
  const encodedBindings = env.ENERGYIQ_TUYA_DEVICE_BINDINGS_JSON?.trim();
  const environmentConfigured = Boolean(configuredProjectId && configuredWorkspaceId && encodedBindings);
  const connection = input.source === "environment"
    ? undefined
    : input.metadataStore.energyIq.liveConnectors.find(input.projectId);
  if (!connection && environmentConfigured && input.projectId === configuredProjectId) {
    const project = input.metadataStore.energyIq.getProject(input.projectId);
    if (project.workspace_id !== configuredWorkspaceId) {
      throw new Error("ENERGYIQ_TUYA_WORKSPACE_MISMATCH");
    }
    return {
      ...buildConnector({
        metadataStore: input.metadataStore,
        projectId: input.projectId,
        workspaceId: configuredWorkspaceId!,
        bindings: parseBindings(encodedBindings!),
        requireTuyaMapping: true,
      }),
      managedBy: "environment",
    };
  }
  if (connection) {
    const project = input.metadataStore.energyIq.getProject(input.projectId);
    if (project.workspace_id !== connection.workspace_id) {
      throw new Error("ENERGYIQ_TUYA_WORKSPACE_MISMATCH");
    }
    const bindings = Object.fromEntries(Object.entries(connection.bindings)
      .map(([meterPointId, binding]) => [meterPointId, binding.device_id]));
    if (Object.keys(bindings).length === 0) throw new Error("ENERGYIQ_TUYA_DEVICE_BINDINGS_MISMATCH");
    const connector = buildConnector({
      metadataStore: input.metadataStore,
      projectId: input.projectId,
      workspaceId: project.workspace_id,
      bindings,
      // A site set up from uploaded files keeps its mapping when it goes live: the readings land on the same
      // meters by the same source labels, so the mapping's original source does not matter here.
      requireTuyaMapping: false,
      account: connection.access_id_hint,
    });
    return {
      ...connector,
      managedBy: "app",
      credentials: readLiveConnectionCredentials(input.metadataStore, connection),
      schedule: { enabled: connection.sync_enabled, localHour: connection.sync_local_hour },
    };
  }
  if (!environmentConfigured) throw new Error("ENERGYIQ_TUYA_CONNECTOR_NOT_CONFIGURED");
  throw new Error("ENERGYIQ_TUYA_PROJECT_UNSUPPORTED");
};

/** Whether the server environment owns this Project's connection, so the app must not offer to change it. */
export const isEnvironmentTuyaProject = (projectId: string, env: NodeJS.ProcessEnv = process.env): boolean =>
  Boolean(env.ENERGYIQ_TUYA_CONNECTOR_PROJECT_ID?.trim()) && env.ENERGYIQ_TUYA_CONNECTOR_PROJECT_ID?.trim() === projectId;

export const readLiveConnectionCredentials = (
  metadataStore: MetadataStore,
  connection: EnergyIqLiveConnectorRecord,
): TuyaCredentials => {
  let value: Record<string, unknown>;
  try {
    value = metadataStore.secrets.get({
      ref: connection.secret_ref,
      workspace_id: connection.secret_workspace_id,
      user_id: connection.secret_user_id,
    });
  } catch {
    // A backup restored on another server cannot open this server's sealed key: ask for it again.
    throw new Error("ENERGYIQ_LIVE_CREDENTIALS_UNREADABLE");
  }
  if (typeof value.accessId !== "string" || typeof value.accessSecret !== "string") {
    throw new Error("ENERGYIQ_LIVE_CREDENTIALS_UNREADABLE");
  }
  return { accessId: value.accessId, accessSecret: value.accessSecret };
};

const buildConnector = (input: {
  metadataStore: MetadataStore;
  projectId: string;
  workspaceId: string;
  bindings: Record<string, string>;
  requireTuyaMapping: boolean;
  account?: string;
}): EnergyTuyaProjectConnector => {
  const project = input.metadataStore.energyIq.getProject(input.projectId);
  const publishedRevision = input.metadataStore.energyIq.projectSetup
    .listHierarchyRevisions(project.id)
    .find((candidate) => candidate.id === project.hierarchy_revision_id);
  if (!publishedRevision) {
    throw new Error("ENERGYIQ_TUYA_PUBLISHED_SETUP_REQUIRED");
  }
  const publishedDocument = parsePublishedDocument(publishedRevision.snapshot_json);
  const mapping = publishedDocument.meter_mapping;
  if (!mapping?.confirmed || !Array.isArray(mapping.rows)
    || (input.requireTuyaMapping && mapping.source_kind !== "tuya")) {
    throw new Error("ENERGYIQ_TUYA_PUBLISHED_MAPPING_REQUIRED");
  }

  const bindings = input.bindings;
  const publishedIds = new Set(mapping.rows.map((row) => row.id));
  const configuredIds = Object.keys(bindings);
  if (
    configuredIds.length !== publishedIds.size
    || configuredIds.some((meterPointId) => !publishedIds.has(meterPointId))
  ) {
    throw new Error("ENERGYIQ_TUYA_DEVICE_BINDINGS_MISMATCH");
  }

  const seenDeviceIds = new Set<string>();
  const devices: TuyaDeviceBinding[] = [];
  const meterPoints: EnergyTuyaProjectConnector["meterPoints"] = [];
  for (const row of mapping.rows) {
    const deviceId = bindings[row.id];
    if (!deviceId || !/^[A-Za-z0-9]{8,64}$/u.test(deviceId) || seenDeviceIds.has(deviceId)) {
      throw new Error("ENERGYIQ_TUYA_DEVICE_BINDINGS_MISMATCH");
    }
    const sourceLabel = row.source_label.trim();
    if (!sourceLabel) throw new Error("ENERGYIQ_TUYA_PUBLISHED_MAPPING_REQUIRED");
    seenDeviceIds.add(deviceId);
    devices.push({ deviceId, sourceLabel });
    meterPoints.push({ meterPointId: row.id, sourceLabel });
  }

  const connectorFingerprint = createHash("sha256").update(JSON.stringify({
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    hierarchyRevisionId: publishedRevision.id,
    hierarchySequence: publishedRevision.sequence,
    bindings: Object.entries(bindings).sort(([left], [right]) => left.localeCompare(right)),
    ...(input.account ? { account: input.account } : {}),
  })).digest("hex");

  return {
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    hierarchyRevisionId: publishedRevision.id,
    hierarchySequence: publishedRevision.sequence,
    publishedDocument,
    connectorFingerprint,
    devices,
    meterPoints,
  };
};

const parseBindings = (value: string): Record<string, string> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error("ENERGYIQ_TUYA_DEVICE_BINDINGS_INVALID");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("ENERGYIQ_TUYA_DEVICE_BINDINGS_INVALID");
  }
  const result: Record<string, string> = {};
  for (const [meterPointId, deviceId] of Object.entries(parsed)) {
    if (!meterPointId.trim() || typeof deviceId !== "string" || !deviceId.trim()) {
      throw new Error("ENERGYIQ_TUYA_DEVICE_BINDINGS_INVALID");
    }
    result[meterPointId.trim()] = deviceId.trim();
  }
  if (Object.keys(result).length === 0) throw new Error("ENERGYIQ_TUYA_DEVICE_BINDINGS_INVALID");
  return result;
};

const parsePublishedDocument = (value: string): EnergyIqProjectSetupDocument => {
  try {
    const parsed = JSON.parse(value) as EnergyIqProjectSetupDocument;
    if (!parsed || typeof parsed !== "object") throw new Error("invalid");
    return parsed;
  } catch {
    throw new Error("ENERGYIQ_TUYA_PUBLISHED_SETUP_REQUIRED");
  }
};
