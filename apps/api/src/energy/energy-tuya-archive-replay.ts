import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { EnergyIqProjectSetupDocument, MetadataStore } from "@datafoundry/metadata";
import { createEnergyIqSourceManifest } from "@datafoundry/metadata";
import type { FileAssetService } from "@datafoundry/files";
import { inspectEnergyTuyaArtifact } from "./energy-tuya-import.js";
import { TUYA_REPORT_LOG_ARTIFACT_VERSION } from "./tuya-openapi-client.js";

export type ArchiveReading = { project_id: string; import_batch_id: string; source_sha256: string; source_row_number: number; meter_node_id: string; device_name: string; event_time: Date | string; active_energy_kwh: number; is_valid: boolean; is_overlap_conflict: boolean };
export function buildTuyaArchiveReplay(rows: ArchiveReading[], archiveSha256: string, document: EnergyIqProjectSetupDocument) {
  if (!rows.length || !/^[a-f0-9]{64}$/.test(archiveSha256) || !document.meter_mapping?.confirmed || document.meter_mapping.source_kind !== "tuya") throw Error("TUYA_REPLAY_INPUT_INVALID");
  const mapping = new Map(document.meter_mapping.rows.map(row => [row.id, row]));
  const batches = new Map<string, ArchiveReading[]>();
  for (const row of rows) {
    const meter = mapping.get(row.meter_node_id);
    if (row.project_id !== "tuya-office" || !row.is_valid || row.is_overlap_conflict || !meter || meter.source_label !== row.device_name || !Number.isFinite(row.active_energy_kwh) || row.active_energy_kwh < 0 || !Number.isFinite(new Date(row.event_time).getTime()) || !/^[a-f0-9]{64}$/.test(row.source_sha256)) throw Error("TUYA_REPLAY_ROW_INVALID");
    const group = batches.get(row.import_batch_id) ?? []; group.push(row); batches.set(row.import_batch_id, group);
  }
  return [...batches.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([originalBatchId, records]) => {
    records.sort((a, b) => a.source_row_number - b.source_row_number);
    const originalSourceSha256 = records[0]!.source_sha256;
    if (records.some(row => row.source_sha256 !== originalSourceSha256)) throw Error("TUYA_REPLAY_BATCH_INVALID");
    const labels = [...new Set(records.map(row => row.device_name))].sort();
    const timestamps = records.map(row => new Date(row.event_time).getTime());
    const artifact = {
      schemaVersion: TUYA_REPORT_LOG_ARTIFACT_VERSION, provider: "tuya", region: "sg",
      createdAt: new Date(Math.max(...timestamps)).toISOString(),
      replay: { kind: "archived_normalized_cumulative_kwh", archiveSha256, originalBatchId, originalSourceSha256, note: "Recovered from stored raw_meter_readings. Values are already normalized kWh; scale 0 is a replay encoding, not original provider property evidence. No power readings recovered." },
      request: { startTime: Math.min(...timestamps), endTime: Math.max(...timestamps), codes: ["total_forward_energy"], deviceCount: labels.length },
      devices: labels.map(sourceLabel => ({ sourceLabel, properties: { totalForwardEnergy: { code: "total_forward_energy", scale: 0, unit: "kWh" } }, logs: records.filter(row => row.device_name === sourceLabel).map(row => ({ code: "total_forward_energy", eventTime: new Date(row.event_time).getTime(), value: row.active_energy_kwh, archiveSourceRowNumber: row.source_row_number })) })),
    };
    const content = Buffer.from(JSON.stringify(artifact) + "\n", "utf8");
    const sha256 = createHash("sha256").update(content).digest("hex");
    return { originalBatchId, originalSourceSha256, sha256, filename: `tuya-archive-replay-${sha256.slice(0, 16)}.json`, content, inspection: inspectEnergyTuyaArtifact(content) };
  });
}
export async function readTuyaArchive(path: string) {
  const duckdb = createRequire(import.meta.url)("duckdb");
  const db = new duckdb.Database(path, duckdb.OPEN_READONLY);
  const query = <T>(sql: string): Promise<T[]> => new Promise((resolve, reject) => db.all(sql, (error: Error | null, rows: T[]) => error ? reject(error) : resolve(rows)));
  const archiveSha256 = createHash("sha256").update(readFileSync(path)).digest("hex");
  try {
    const rows = await query<ArchiveReading>("SELECT project_id,import_batch_id,source_sha256,source_row_number,meter_node_id,device_name,event_time,active_energy_kwh,is_valid,is_overlap_conflict FROM raw_meter_readings ORDER BY import_batch_id,source_row_number");
    const coverage = await query<{ intervalCount: bigint; actualLastIntervalEnd: Date }>("SELECT count(*) AS intervalCount, max(interval_end) AS actualLastIntervalEnd FROM energy_interval_facts WHERE project_id='tuya-office'");
    const intervals = await query<Record<string, unknown>>("SELECT meter_node_id, epoch_ms(interval_start) AS start_ms, epoch_ms(interval_end) AS end_ms, round(usage_kwh, 9) AS usage, round(average_kw, 9) AS power, quality_status FROM energy_interval_facts WHERE project_id='tuya-office' ORDER BY meter_node_id,interval_start");
    if (createHash("sha256").update(readFileSync(path)).digest("hex") !== archiveSha256) throw Error("TUYA_REPLAY_ARCHIVE_CHANGED");
    return { rows, intervals, archiveSha256, coverage: { intervalCount: Number(coverage[0]!.intervalCount), actualLastIntervalEnd: new Date(coverage[0]!.actualLastIntervalEnd).toISOString() } };
  } finally { await new Promise<void>((resolve, reject) => db.close((error: Error | null) => error ? reject(error) : resolve())); }
}
/** Explicit apply only. Registers immutable source artifacts; publication uses the normal API afterwards. */
export function registerTuyaArchiveReplay(metadata: MetadataStore, files: FileAssetService, userId: string, artifacts: ReturnType<typeof buildTuyaArchiveReplay>) {
  const projectId = "tuya-office";
  const project = metadata.energyIq.getProject(projectId);
  if (metadata.energyIq.findCurrentDataSnapshot(projectId)) throw Error("TUYA_REPLAY_TARGET_ALREADY_BOUND");
  const draft = metadata.energyIq.projectSetup.getDraft({ project_id: projectId, user_id: userId });
  const allowed = new Set(artifacts.map(item => item.sha256));
  if ((draft.document.source_manifest?.source_sha256 ?? []).some(sha => !allowed.has(sha)) || metadata.energyIq.listImportBatches(projectId).some(batch => !allowed.has(batch.source_sha256))) throw Error("TUYA_REPLAY_TARGET_HAS_OTHER_SOURCES");
  const ids = artifacts.map(item => {
    const existing = metadata.energyIq.findImportBatchBySha({ project_id: projectId, source_sha256: item.sha256 });
    if (existing) return existing.id;
    const file = files.createRef({ user_id: userId, workspace_id: project.workspace_id, filename: item.filename, content: item.content, declared_mime_type: "application/json", source: "artifact", metadata: { purpose: "energyiq_import", projectId, replayOriginalBatchId: item.originalBatchId, replayOriginalSourceSha256: item.originalSourceSha256 } });
    return metadata.energyIq.createImportBatch({ id: `energy-replay-${item.sha256}`, workspace_id: project.workspace_id, project_id: projectId, source_kind: "tuya", source_sha256: item.sha256, filename: item.filename, file_asset_ref_id: file.ref.id, status: "inspected", inspection: item.inspection, created_by: userId }).id;
  });
  metadata.energyIq.projectSetup.saveDraft({ project_id: projectId, user_id: userId, expected_revision: draft.revision, document: { ...draft.document, source_manifest: createEnergyIqSourceManifest(artifacts.map(item => item.sha256), true) } });
  return { batchIds: ids, workspaceId: project.workspace_id };
}
