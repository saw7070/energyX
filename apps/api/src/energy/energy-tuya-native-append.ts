import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createEnergyIqSourceManifest, resolveEnergyIqSnapshotFactScope, type EnergyIqProjectSetupDocument, type MetadataStore } from "@datafoundry/metadata";
import type { FileAssetService } from "@datafoundry/files";
import { inspectEnergyTuyaArtifact } from "./energy-tuya-import.js";
import { normaliseTuyaUnit, TUYA_ENERGY_CODES, TUYA_REPORT_LOG_ARTIFACT_VERSION, TUYA_SINGAPORE_ENDPOINT } from "./tuya-openapi-client.js";

const record = (value: unknown): value is Record<string, any> => typeof value === "object" && value !== null && !Array.isArray(value);
export function readTuyaNativeBundle(directory: string, document: EnergyIqProjectSetupDocument) {
  const root = resolve(directory);
  for (const path of [root, join(root, "sources")]) if (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()) throw Error("TUYA_BUNDLE_PATH_INVALID");
  const indexPath = join(root, "index.json");
  if (!lstatSync(indexPath).isFile() || lstatSync(indexPath).isSymbolicLink() || lstatSync(indexPath).size > 1024 * 1024) throw Error("TUYA_BUNDLE_INDEX_INVALID");
  const index: unknown = JSON.parse(readFileSync(indexPath, "utf8"));
  if (!record(index) || (index.projectId !== undefined && index.projectId !== "tuya-office") || !Array.isArray(index.sources) || !index.sources.length || index.sources.length > 100) throw Error("TUYA_BUNDLE_INDEX_INVALID");
  if (!document.meter_mapping?.confirmed || document.meter_mapping.source_kind !== "tuya") throw Error("TUYA_BUNDLE_MAPPING_REQUIRED");
  const labels = new Set(document.meter_mapping.rows.map(row => row.source_label));
  const seen = new Set<string>(); let totalBytes = 0;
  return index.sources.map((source: unknown) => {
    if (!record(source) || typeof source.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(source.sha256) || typeof source.filename !== "string" || basename(source.filename) !== source.filename || !source.filename.endsWith(".json") || seen.has(source.sha256)) throw Error("TUYA_BUNDLE_SOURCE_INVALID");
    if (source.path !== undefined && source.path !== `sources/${source.sha256}.json`) throw Error("TUYA_BUNDLE_PATH_INVALID");
    seen.add(source.sha256);
    const path = join(root, "sources", `${source.sha256}.json`); const stat = lstatSync(path);
    totalBytes += stat.size;
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 50 * 1024 * 1024 || totalBytes > 200 * 1024 * 1024) throw Error("TUYA_BUNDLE_SOURCE_INVALID");
    const content = readFileSync(path);
    if (createHash("sha256").update(content).digest("hex") !== source.sha256) throw Error("TUYA_BUNDLE_SHA_MISMATCH");
    const artifact: unknown = JSON.parse(content.toString("utf8"));
    if (!record(artifact) || artifact.schemaVersion !== TUYA_REPORT_LOG_ARTIFACT_VERSION || artifact.provider !== "tuya" || artifact.region !== "sg" || artifact.endpoint !== TUYA_SINGAPORE_ENDPOINT || artifact.replay !== undefined || !record(artifact.request) || !Number.isSafeInteger(artifact.request.startTime) || !Number.isSafeInteger(artifact.request.endTime) || artifact.request.startTime <= 0 || artifact.request.endTime <= artifact.request.startTime || !Array.isArray(artifact.devices) || artifact.request.deviceCount !== artifact.devices.length || !artifact.devices.length) throw Error("TUYA_BUNDLE_ARTIFACT_INVALID");
    const deviceLabels = new Set<string>();
    for (const device of artifact.devices) {
      if (!record(device) || typeof device.sourceLabel !== "string" || !labels.has(device.sourceLabel) || deviceLabels.has(device.sourceLabel) || !record(device.properties) || !record(device.properties.totalForwardEnergy) || !Number.isInteger(device.properties.totalForwardEnergy.scale) || device.properties.totalForwardEnergy.scale < 0 || device.properties.totalForwardEnergy.scale > 12 || !Array.isArray(device.logs)) throw Error("TUYA_BUNDLE_ARTIFACT_INVALID");
      const energyProperty = device.properties.totalForwardEnergy;
      if (typeof energyProperty.code !== "string" || !(TUYA_ENERGY_CODES as readonly string[]).includes(energyProperty.code) || typeof energyProperty.unit !== "string" || normaliseTuyaUnit(energyProperty.unit) !== "kwh") throw Error("TUYA_BUNDLE_ARTIFACT_INVALID");
      deviceLabels.add(device.sourceLabel);
    }
    const inspection = inspectEnergyTuyaArtifact(content);
    if (inspection.invalidRowCount || !inspection.validRowCount) throw Error("TUYA_BUNDLE_INVALID_READINGS");
    return { sha256: source.sha256, filename: source.filename, content, inspection };
  });
}
export function appendTuyaNativeBundle(metadata: MetadataStore, files: FileAssetService, userId: string, sources: ReturnType<typeof readTuyaNativeBundle>) {
  const projectId = "tuya-office"; const project = metadata.energyIq.getProject(projectId);
  const draft = metadata.energyIq.projectSetup.getDraft({ project_id: projectId, user_id: userId });
  const snapshot = metadata.energyIq.findCurrentDataSnapshot(projectId);
  const preserved = [...(draft.document.source_manifest?.source_sha256 ?? []), ...(snapshot ? resolveEnergyIqSnapshotFactScope(snapshot).sourceSha256 : [])];
  const sourceHashes = [...new Set([...preserved, ...sources.map(source => source.sha256)])];
  const batchIds = sources.map(source => {
    const existing = metadata.energyIq.findImportBatchBySha({ project_id: projectId, source_sha256: source.sha256 });
    if (existing) return existing.id;
    const file = files.createRef({ user_id: userId, workspace_id: project.workspace_id, filename: source.filename, content: source.content, declared_mime_type: "application/json", source: "artifact", metadata: { purpose: "energyiq_import", projectId, provider: "tuya", nativeSourceSha256: source.sha256 } });
    return metadata.energyIq.createImportBatch({ id: `energy-native-${source.sha256}`, project_id: projectId, workspace_id: project.workspace_id, source_kind: "tuya", source_sha256: source.sha256, filename: source.filename, file_asset_ref_id: file.ref.id, status: "inspected", inspection: source.inspection, created_by: userId }).id;
  });
  metadata.energyIq.projectSetup.saveDraft({ project_id: projectId, user_id: userId, expected_revision: draft.revision, document: { ...draft.document, source_manifest: createEnergyIqSourceManifest(sourceHashes, true) } });
  return { batchIds, workspaceId: project.workspace_id, preservedSourceCount: new Set(preserved).size, totalSourceCount: sourceHashes.length };
}
