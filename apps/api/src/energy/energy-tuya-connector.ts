import { createHash } from "node:crypto";
import type { EnergyIqProjectSetupDocument, MetadataStore } from "@datafoundry/metadata";

import type { TuyaDeviceBinding } from "./tuya-openapi-client.js";

export type EnergyTuyaProjectConnector = {
  projectId: string;
  workspaceId: string;
  hierarchyRevisionId: string;
  hierarchySequence: number;
  publishedDocument: EnergyIqProjectSetupDocument;
  connectorFingerprint: string;
  devices: TuyaDeviceBinding[];
  meterPoints: Array<{ meterPointId: string; sourceLabel: string }>;
};

export const resolveEnergyTuyaProjectConnector = (input: {
  metadataStore: MetadataStore;
  projectId: string;
  env?: NodeJS.ProcessEnv;
}): EnergyTuyaProjectConnector => {
  const env = input.env ?? process.env;
  const configuredProjectId = env.ENERGYIQ_TUYA_CONNECTOR_PROJECT_ID?.trim();
  const configuredWorkspaceId = env.ENERGYIQ_TUYA_CONNECTOR_WORKSPACE_ID?.trim();
  const encodedBindings = env.ENERGYIQ_TUYA_DEVICE_BINDINGS_JSON?.trim();
  if (!configuredProjectId || !configuredWorkspaceId || !encodedBindings) {
    throw new Error("ENERGYIQ_TUYA_CONNECTOR_NOT_CONFIGURED");
  }
  if (input.projectId !== configuredProjectId) {
    throw new Error("ENERGYIQ_TUYA_PROJECT_UNSUPPORTED");
  }

  const project = input.metadataStore.energyIq.getProject(input.projectId);
  if (project.workspace_id !== configuredWorkspaceId) {
    throw new Error("ENERGYIQ_TUYA_WORKSPACE_MISMATCH");
  }
  const publishedRevision = input.metadataStore.energyIq.projectSetup
    .listHierarchyRevisions(project.id)
    .find((candidate) => candidate.id === project.hierarchy_revision_id);
  if (!publishedRevision) {
    throw new Error("ENERGYIQ_TUYA_PUBLISHED_SETUP_REQUIRED");
  }
  const publishedDocument = parsePublishedDocument(publishedRevision.snapshot_json);
  const mapping = publishedDocument.meter_mapping;
  if (!mapping?.confirmed || mapping.source_kind !== "tuya" || !Array.isArray(mapping.rows)) {
    throw new Error("ENERGYIQ_TUYA_PUBLISHED_MAPPING_REQUIRED");
  }

  const bindings = parseBindings(encodedBindings);
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
    workspaceId: configuredWorkspaceId,
    projectId: configuredProjectId,
    hierarchyRevisionId: publishedRevision.id,
    hierarchySequence: publishedRevision.sequence,
    bindings: Object.entries(bindings).sort(([left], [right]) => left.localeCompare(right)),
  })).digest("hex");

  return {
    projectId: configuredProjectId,
    workspaceId: configuredWorkspaceId,
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
