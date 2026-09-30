import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type * as DuckDbModule from "duckdb";
import type { EnergyIqSnapshotFactScope } from "@datafoundry/metadata";

import { getDuckDbDatabase } from "./duckdb-database-cache.js";
import { energyCanonicalIntervalIntegritySql } from "./energy-snapshot-guard.js";

export type EnergyRawReadingWrite = {
  workspaceId: string;
  projectId: string;
  importBatchId: string;
  resource: "electricity" | "water";
  sourceLabel: string;
  meterPointId?: string;
  scopeId?: string;
  eventTime?: string;
  activeEnergyKwh?: number;
  sourceFile: string;
  sourceSha256: string;
  sourceRowNumber: number;
  isValid: boolean;
  validationError?: string;
  isOverlapConflict: boolean;
};

export type EnergyNormalizedReadingWrite = {
  workspaceId: string;
  projectId: string;
  importBatchId: string;
  resource: "electricity" | "water";
  meterPointId: string;
  scopeId: string;
  parentNodeId?: string;
  sourceLabel: string;
  category: string;
  meterRole: string;
  eventTime: string;
  activeEnergyKwh: number;
  sourceFile: string;
  sourceSha256: string;
  sourceRowNumber: number;
  sourceReadingKind: "cumulative_energy" | "cumulative_energy_event" | "interval_usage";
};

export type EnergyIntervalFactWrite = {
  workspaceId: string;
  projectId: string;
  importBatchId: string;
  resource: "electricity" | "water";
  meterPointId: string;
  scopeId: string;
  parentNodeId?: string;
  sourceLabel: string;
  category: string;
  meterRole: string;
  intervalStart: string;
  intervalEnd: string;
  elapsedMinutes: number;
  activeEnergyKwh: number;
  previousActiveEnergyKwh: number;
  rawDeltaKwh: number;
  usageKwh?: number;
  averageKw?: number;
  qualityStatus: string;
  localDate: string;
  localHour: number;
  dayType: string;
  isOperating?: boolean;
  sourceFile: string;
  sourceSha256: string;
  sourceReadingKind: "cumulative_energy" | "cumulative_energy_event" | "interval_usage";
};

export type EnergyQualityEventWrite = {
  workspaceId: string;
  projectId: string;
  importBatchId: string;
  meterPointId?: string;
  sourceLabel?: string;
  eventTime?: string;
  code: string;
  severity: "warning" | "error";
  details: unknown;
  sourceReadingKind: "cumulative_energy" | "cumulative_energy_event" | "interval_usage";
};

export type EnergyFactMaterializationBatchWrite = {
  importBatchId: string;
  sourceSha256: string;
  /** Reuse source rows already committed for this exact Batch/SHA; only canonical facts are rebuilt. */
  preserveExisting?: true;
  rawReadings: EnergyRawReadingWrite[];
  normalizedReadings: EnergyNormalizedReadingWrite[];
  intervalFacts: EnergyIntervalFactWrite[];
  qualityEvents: EnergyQualityEventWrite[];
};

type EnergyFactScopedBatchWrite = EnergyFactMaterializationBatchWrite & {
  projectId: string;
  snapshotFactScope: EnergyIqSnapshotFactScope;
};

export type EnergyFactMaterializationStats = {
  rawRows: number;
  normalizedRows: number;
  intervalFacts: number;
  qualityEvents: number;
};

export type EnergyFactProjectAudit = {
  rawRowCount: number;
  invalidRawRowCount: number;
  unmappedRawRowCount: number;
  rawOverlapConflictCount: number;
  normalizedReadingCount: number;
  intervalFactCount: number;
  duplicateNormalizedReadingCount: number;
  duplicateIntervalFactCount: number;
  invalidIntervalDurationCount: number;
  cadenceGapIntervalCount: number;
  negativeDeltaIntervalCount: number;
  legacyRawRowCount: number;
  legacyNormalizedReadingCount: number;
  legacyIntervalFactCount: number;
  legacyCanonicalRowCount: number;
  canonicalMeterSeriesCount: number;
  adjacentReadingPairCount: number;
  missingAdjacentIntervalCount: number;
  orphanIntervalFactCount: number;
};

export const ENERGY_FACT_WRITER_CONTRACT_VERSION = "energy-fact-writer-snapshot-manifest-v4" as const;
export const ENERGY_FACT_WRITER_HISTORICAL_CONTRACT_VERSIONS = [
  "energy-fact-writer-snapshot-manifest-v3",
] as const;

export type EnergyFactProjectMaterializationWrite = {
  databasePath: string;
  projectId: string;
  timezone: string;
  expectedPreviousDataSnapshotId: string;
  snapshotFactScope: EnergyIqSnapshotFactScope;
  batches: EnergyFactMaterializationBatchWrite[];
};

export type EnergyFactProjectMaterializationResult = {
  batchStats: Record<string, EnergyFactMaterializationStats>;
  projectAudit: EnergyFactProjectAudit;
  timings: EnergyFactProjectMaterializationTimings;
};

export type EnergyFactProjectMaterializationTimings = {
  sourceWriteByBatch: Array<{
    importBatchId: string;
    deleteExistingMs: number;
    historicalMappingMs: number;
    rawWriteMs: number;
    normalizedWriteMs: number;
    intervalWriteMs: number;
    qualityWriteMs: number;
    totalMs: number;
  }>;
  sourceWriteMs: number;
  canonicalRebuildMs: number;
  integrityAndCheckpointMs: number;
  totalMs: number;
};

export type EnergyFactProjectState = EnergyIqSnapshotFactScope & {
  factWriterContractVersion: string;
  canonicalIntervalCount: number;
  canonicalIntervalDigest: string;
};

export const resetEnergyFactProjectMaterialization = async (input: {
  databasePath: string;
  projectId: string;
  expectedDataSnapshotId: string;
}): Promise<void> => {
  const databasePath = input.databasePath === ":memory:" ? input.databasePath : resolve(input.databasePath);
  if (databasePath !== ":memory:" && !existsSync(databasePath)) return;
  const database = await getDuckDbDatabase(databasePath);
  const connection = database.connect();
  try {
    await ensureFactSchema(connection);
    await duckDbRun(connection, "BEGIN TRANSACTION");
    const state = await duckDbGet(connection, `
      SELECT data_snapshot_id FROM energy_project_fact_state WHERE project_id = ?
    `, [input.projectId]);
    if (state.data_snapshot_id !== input.expectedDataSnapshotId) {
      throw new Error(`ENERGYIQ_SNAPSHOT_STALE:${String(state.data_snapshot_id ?? "<missing>")}`);
    }
    for (const table of ["normalized_meter_readings", "energy_interval_facts", "energy_quality_events"]) {
      await duckDbRun(connection, `DELETE FROM ${table} WHERE project_id = ?`, [input.projectId]);
    }
    await duckDbRun(connection, "DELETE FROM energy_project_fact_state WHERE project_id = ?", [input.projectId]);
    await duckDbRun(connection, "COMMIT");
    await duckDbRun(connection, "CHECKPOINT");
  } catch (error) {
    await duckDbRun(connection, "ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await duckDbClose(connection).catch(ignoreAlreadyClosed);
  }
};

export const writeEnergyFactProjectMaterialization = async (
  input: EnergyFactProjectMaterializationWrite,
): Promise<EnergyFactProjectMaterializationResult> => {
  const totalStartedAt = performance.now();
  const databasePath = input.databasePath === ":memory:" ? input.databasePath : resolve(input.databasePath);
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
  validateProjectMaterializationInput(input);
  const database = await getDuckDbDatabase(databasePath);
  const connection = database.connect();
  const bulkRoot = mkdtempSync(join(tmpdir(), "energy-fact-bulk-"));
  let bulkFileSequence = 0;
  try {
    await ensureFactSchema(connection);
    await duckDbRun(connection, "BEGIN TRANSACTION");
    await assertExpectedPreviousFactState(connection, input);
    const sourceWriteStartedAt = performance.now();
    const sourceWriteByBatch: EnergyFactProjectMaterializationTimings["sourceWriteByBatch"] = [];
    for (const batch of input.batches) {
      const batchStartedAt = performance.now();
      const write: EnergyFactScopedBatchWrite = {
        projectId: input.projectId,
        snapshotFactScope: input.snapshotFactScope,
        ...batch,
      };
      let deleteExistingMs = 0;
      let historicalMappingMs = 0;
      let rawWriteMs = 0;
      let normalizedWriteMs = 0;
      let intervalWriteMs = 0;
      let qualityWriteMs = 0;
      if (write.preserveExisting) {
        await assertExistingBatchSourceRows(connection, write);
      } else {
        const deleteExistingStartedAt = performance.now();
        await deleteExistingBatch(connection, write);
        deleteExistingMs = elapsedMs(deleteExistingStartedAt);
        const historicalMappingStartedAt = performance.now();
        await updateHistoricalMappings(connection, write.normalizedReadings);
        historicalMappingMs = elapsedMs(historicalMappingStartedAt);
        const rawWriteStartedAt = performance.now();
        await insertRows(connection, "raw_meter_readings", RAW_COLUMNS, write.rawReadings.map(rawValues),
          join(bulkRoot, `${++bulkFileSequence}-raw.csv`));
        rawWriteMs = elapsedMs(rawWriteStartedAt);
        const normalizedWriteStartedAt = performance.now();
        await insertRows(connection, "energy_source_normalized_readings", NORMALIZED_COLUMNS, write.normalizedReadings.map(normalizedValues),
          join(bulkRoot, `${++bulkFileSequence}-normalized.csv`));
        normalizedWriteMs = elapsedMs(normalizedWriteStartedAt);
        const intervalWriteStartedAt = performance.now();
        await insertRows(connection, "energy_source_interval_facts", FACT_COLUMNS, write.intervalFacts.map(factValues),
          join(bulkRoot, `${++bulkFileSequence}-intervals.csv`));
        intervalWriteMs = elapsedMs(intervalWriteStartedAt);
        const qualityWriteStartedAt = performance.now();
        await insertRows(connection, "energy_source_quality_events", QUALITY_COLUMNS, write.qualityEvents.map((event) => qualityValues(event, write.sourceSha256)),
          join(bulkRoot, `${++bulkFileSequence}-quality.csv`));
        qualityWriteMs = elapsedMs(qualityWriteStartedAt);
      }
      sourceWriteByBatch.push({
        importBatchId: batch.importBatchId,
        deleteExistingMs,
        historicalMappingMs,
        rawWriteMs,
        normalizedWriteMs,
        intervalWriteMs,
        qualityWriteMs,
        totalMs: elapsedMs(batchStartedAt),
      });
    }
    const sourceWriteMs = elapsedMs(sourceWriteStartedAt);
    const canonicalRebuildMs = await publishCanonicalProjectFacts(
      connection,
      input.projectId,
      input.timezone,
      input.snapshotFactScope,
    );
    const integrityStartedAt = performance.now();
    const batchStats: Record<string, EnergyFactMaterializationStats> = {};
    for (const batch of input.batches) {
      batchStats[batch.importBatchId] = await readMaterializationStats(connection, batch.importBatchId);
    }
    const projectAudit = await readProjectAudit(connection, input.projectId, input.snapshotFactScope.sourceSha256);
    await duckDbRun(connection, "COMMIT");
    await duckDbRun(connection, "CHECKPOINT");
    const integrityAndCheckpointMs = elapsedMs(integrityStartedAt);
    return {
      batchStats,
      projectAudit,
      timings: {
        sourceWriteByBatch,
        sourceWriteMs,
        canonicalRebuildMs,
        integrityAndCheckpointMs,
        totalMs: elapsedMs(totalStartedAt),
      },
    };
  } catch (error) {
    await duckDbRun(connection, "ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    try {
      await duckDbClose(connection).catch(ignoreAlreadyClosed);
    } finally {
      cleanupBulkRoot(bulkRoot);
    }
  }
};

export const readEnergyFactProjectState = async (input: {
  databasePath: string;
  projectId: string;
}): Promise<EnergyFactProjectState | null> => {
  const databasePath = input.databasePath === ":memory:" ? input.databasePath : resolve(input.databasePath);
  if (databasePath !== ":memory:" && !existsSync(databasePath)) return null;
  const database = await getDuckDbDatabase(databasePath);
  const connection = database.connect();
  try {
    await assertFactReadSchema(connection);
    const row = await duckDbGet(connection, `
      SELECT workspace_id, project_id, data_snapshot_id, manifest_fingerprint,
        source_sha256_json, fact_writer_contract_version,
        canonical_interval_count, canonical_interval_digest
      FROM energy_project_fact_state
      WHERE project_id = ?
    `, [input.projectId]);
    if (typeof row.project_id !== "string") return null;
    const sourceSha256 = JSON.parse(String(row.source_sha256_json)) as unknown;
    if (!Array.isArray(sourceSha256) || !sourceSha256.every((value) => typeof value === "string")) {
      throw new Error("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
    }
    return {
      workspaceId: String(row.workspace_id),
      projectId: String(row.project_id),
      dataSnapshotId: String(row.data_snapshot_id),
      manifestFingerprint: String(row.manifest_fingerprint),
      sourceSha256,
      factWriterContractVersion: String(row.fact_writer_contract_version),
      canonicalIntervalCount: requiredNonNegativeInteger(row.canonical_interval_count),
      canonicalIntervalDigest: requiredSha256(row.canonical_interval_digest),
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE")) {
      throw error;
    }
    throw new Error("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
  } finally {
    await duckDbClose(connection).catch(ignoreAlreadyClosed);
  }
};

/** Materialization-only probe: legacy databases without the v3 state table are uninitialized. */
export const probeEnergyFactProjectStateForMaterialization = async (input: {
  databasePath: string;
  projectId: string;
}): Promise<EnergyFactProjectState | null> => {
  const databasePath = input.databasePath === ":memory:" ? input.databasePath : resolve(input.databasePath);
  if (databasePath !== ":memory:" && !existsSync(databasePath)) return null;
  const database = await getDuckDbDatabase(databasePath);
  const connection = database.connect();
  let hasCurrentStateSchema = false;
  try {
    const row = await duckDbGet(connection, `
      SELECT COUNT(DISTINCT column_name) AS column_count
      FROM information_schema.columns
      WHERE table_schema = 'main'
        AND table_name = 'energy_project_fact_state'
        AND column_name IN (
          'project_id',
          'workspace_id',
          'data_snapshot_id',
          'manifest_fingerprint',
          'source_sha256_json',
          'fact_writer_contract_version',
          'canonical_interval_count',
          'canonical_interval_digest'
        )
    `);
    hasCurrentStateSchema = Number(row.column_count ?? 0) === 8;
  } finally {
    await duckDbClose(connection).catch(ignoreAlreadyClosed);
  }
  if (!hasCurrentStateSchema) return null;
  return readEnergyFactProjectState({ databasePath, projectId: input.projectId });
};

export const readEnergyFactProjectAudit = async (input: {
  databasePath: string;
  projectId: string;
}): Promise<EnergyFactProjectAudit> => {
  const databasePath = input.databasePath === ":memory:" ? input.databasePath : resolve(input.databasePath);
  const database = await getDuckDbDatabase(databasePath);
  const connection = database.connect();
  try {
    await assertFactReadSchema(connection);
    return await readProjectAudit(connection, input.projectId);
  } finally {
    await duckDbClose(connection).catch(ignoreAlreadyClosed);
  }
};

const updateHistoricalMappings = async (
  connection: DuckDbModule.Connection,
  readings: EnergyNormalizedReadingWrite[],
): Promise<void> => {
  const mappingByLabel = new Map<string, EnergyNormalizedReadingWrite>();
  for (const reading of readings) mappingByLabel.set(reading.sourceLabel, reading);
  for (const mapped of mappingByLabel.values()) {
    await duckDbRun(connection, `
      UPDATE raw_meter_readings
      SET meter_node_id = ?, scope_id = ?
      WHERE project_id = ? AND device_name = ?
    `, [mapped.meterPointId, mapped.scopeId, mapped.projectId, mapped.sourceLabel]);
    await duckDbRun(connection, `
      UPDATE energy_source_normalized_readings
      SET meter_node_id = ?, scope_id = ?, level_node_id = ?, category = ?, meter_role = ?
      WHERE project_id = ? AND device_name = ?
    `, [
      mapped.meterPointId,
      mapped.scopeId,
      mapped.parentNodeId ?? null,
      mapped.category,
      mapped.meterRole,
      mapped.projectId,
      mapped.sourceLabel,
    ]);
    await duckDbRun(connection, `
      UPDATE energy_source_interval_facts
      SET meter_node_id = ?, scope_id = ?, parent_node_id = ?, level_node_id = ?,
          appliance = ?, circuit_name = device_name, category = ?, meter_role = ?
      WHERE project_id = ? AND device_name = ?
    `, [
      mapped.meterPointId,
      mapped.scopeId,
      mapped.parentNodeId ?? null,
      mapped.parentNodeId ?? null,
      mapped.category,
      mapped.category,
      mapped.meterRole,
      mapped.projectId,
      mapped.sourceLabel,
    ]);
  }
};

export const readEnergyFactMaterializationStats = async (input: {
  databasePath: string;
  importBatchId: string;
}): Promise<EnergyFactMaterializationStats> => {
  const databasePath = input.databasePath === ":memory:" ? input.databasePath : resolve(input.databasePath);
  const database = await getDuckDbDatabase(databasePath);
  const connection = database.connect();
  try {
    return await readMaterializationStats(connection, input.importBatchId);
  } finally {
    await duckDbClose(connection).catch(ignoreAlreadyClosed);
  }
};

const readMaterializationStats = async (
  connection: DuckDbModule.Connection,
  importBatchId: string,
): Promise<EnergyFactMaterializationStats> => {
  const row = await duckDbGet(connection, `
    SELECT
      (SELECT COUNT(*) FROM raw_meter_readings WHERE import_batch_id = ?) AS raw_rows,
      (SELECT COUNT(*) FROM normalized_meter_readings WHERE import_batch_id = ?) AS normalized_rows,
      (SELECT COUNT(*) FROM energy_interval_facts WHERE import_batch_id = ?) AS interval_facts,
      (SELECT COUNT(*) FROM energy_quality_events WHERE import_batch_id = ?) AS quality_events
  `, [importBatchId, importBatchId, importBatchId, importBatchId]);
  return {
    rawRows: Number(row.raw_rows ?? 0),
    normalizedRows: Number(row.normalized_rows ?? 0),
    intervalFacts: Number(row.interval_facts ?? 0),
    qualityEvents: Number(row.quality_events ?? 0),
  };
};

const readProjectAudit = async (
  connection: DuckDbModule.Connection,
  projectId: string,
  sourceSha256?: readonly string[],
): Promise<EnergyFactProjectAudit> => {
  const normalizedSources = sourceSha256?.map((value) => value.toLocaleLowerCase());
  const rawManifestClause = normalizedSources && normalizedSources.length > 0
    ? ` AND lower(source_sha256) IN (${normalizedSources.map(() => "?").join(", ")})`
    : "";
  const rawParameters = (): string[] => [projectId, ...(normalizedSources ?? [])];
  const row = await duckDbGet(connection, `
    SELECT
      (SELECT COUNT(*) FROM raw_meter_readings WHERE project_id = ?${rawManifestClause}) AS raw_rows,
      (SELECT COUNT(*) FROM raw_meter_readings WHERE project_id = ?${rawManifestClause} AND is_valid IS NOT TRUE) AS invalid_raw_rows,
      (SELECT COUNT(*) FROM raw_meter_readings WHERE project_id = ?${rawManifestClause} AND is_valid AND meter_node_id IS NULL) AS unmapped_raw_rows,
      (SELECT COUNT(*) FROM raw_meter_readings WHERE project_id = ?${rawManifestClause} AND is_overlap_conflict) AS raw_overlap_conflicts,
      (SELECT COUNT(*) FROM normalized_meter_readings WHERE project_id = ?) AS normalized_rows,
      (SELECT COUNT(*) FROM energy_interval_facts WHERE project_id = ?) AS interval_facts,
      (SELECT COALESCE(SUM(row_count - 1), 0) FROM (
        SELECT COUNT(*) AS row_count
        FROM normalized_meter_readings
        WHERE project_id = ?
        GROUP BY meter_node_id, event_time
        HAVING COUNT(*) > 1
      )) AS duplicate_normalized_rows,
      (SELECT COALESCE(SUM(row_count - 1), 0) FROM (
        SELECT COUNT(*) AS row_count
        FROM energy_interval_facts
        WHERE project_id = ?
        GROUP BY meter_node_id, interval_start
        HAVING COUNT(*) > 1
      )) AS duplicate_interval_facts,
      (SELECT COUNT(*) FROM (
        SELECT elapsed_minutes, quality_status, median(elapsed_minutes) OVER (
          PARTITION BY resource, meter_node_id
        ) AS typical_elapsed_minutes
        FROM energy_interval_facts
        WHERE project_id = ?
      ) durations
        WHERE elapsed_minutes <= 0
          OR quality_status = 'irregular_interval'
      ) AS invalid_interval_durations,
      (SELECT COUNT(*) FROM energy_interval_facts
        WHERE project_id = ? AND quality_status = 'gap') AS cadence_gap_intervals,
      (SELECT COUNT(*) FROM energy_interval_facts
        WHERE project_id = ? AND quality_status = 'negative_delta') AS negative_delta_intervals,
      (SELECT COUNT(*) FROM raw_meter_readings
        WHERE project_id = ?${rawManifestClause} AND (
          import_batch_id IS NULL OR import_batch_id = '' OR import_batch_id = '<legacy>'
          OR source_sha256 IS NULL OR source_sha256 = '' OR source_sha256 = '<legacy>'
          OR source_file IS NULL OR source_file = '' OR source_file = '<legacy>'
          OR LOWER(source_file) LIKE '%synthetic%'
        )) AS legacy_raw_rows,
      (SELECT COUNT(*) FROM normalized_meter_readings
        WHERE project_id = ? AND (
          import_batch_id IS NULL OR import_batch_id = '' OR import_batch_id = '<legacy>'
          OR source_sha256 IS NULL OR source_sha256 = '' OR source_sha256 = '<legacy>'
          OR source_file IS NULL OR source_file = '' OR source_file = '<legacy>'
          OR LOWER(source_file) LIKE '%synthetic%'
        )) AS legacy_normalized_rows,
      (SELECT COUNT(*) FROM energy_interval_facts
        WHERE project_id = ? AND (
          import_batch_id IS NULL OR import_batch_id = '' OR import_batch_id = '<legacy>'
          OR source_sha256 IS NULL OR source_sha256 = '' OR source_sha256 = '<legacy>'
          OR source_file IS NULL OR source_file = '' OR source_file = '<legacy>'
          OR LOWER(source_file) LIKE '%synthetic%'
        )) AS legacy_interval_facts
  `, [
    ...rawParameters(),
    ...rawParameters(),
    ...rawParameters(),
    ...rawParameters(),
    ...Array.from({ length: 7 }, () => projectId),
    ...rawParameters(),
    projectId,
    projectId,
  ]);
  const completeness = await duckDbGet(connection, `
    WITH ordered_readings AS (
      SELECT
        project_id, resource, meter_node_id, event_time AS interval_end,
        LAG(event_time) OVER (
          PARTITION BY project_id, resource, meter_node_id
          ORDER BY event_time
        ) AS interval_start
      FROM normalized_meter_readings
      WHERE project_id = ? AND source_reading_kind = 'cumulative_energy'
    ), adjacent_pairs AS (
      SELECT project_id, resource, meter_node_id, interval_start, interval_end
      FROM ordered_readings
      WHERE interval_start IS NOT NULL
    )
    SELECT
      (SELECT COUNT(*) FROM (
        SELECT resource, meter_node_id
        FROM normalized_meter_readings
        WHERE project_id = ? AND source_reading_kind = 'cumulative_energy'
        GROUP BY resource, meter_node_id
      )) AS canonical_meter_series,
      (SELECT COUNT(*) FROM adjacent_pairs) AS adjacent_reading_pairs,
      (SELECT COUNT(*) FROM adjacent_pairs pair
        WHERE NOT EXISTS (
          SELECT 1 FROM energy_interval_facts fact
          WHERE fact.project_id = pair.project_id
            AND fact.resource = pair.resource
            AND fact.meter_node_id = pair.meter_node_id
            AND fact.source_reading_kind = 'cumulative_energy'
            AND fact.interval_start = pair.interval_start
            AND fact.interval_end = pair.interval_end
        )) AS missing_adjacent_intervals,
      (SELECT COUNT(*) FROM energy_interval_facts fact
        WHERE fact.project_id = ?
          AND fact.source_reading_kind = 'cumulative_energy'
          AND NOT EXISTS (
            SELECT 1 FROM adjacent_pairs pair
            WHERE pair.project_id = fact.project_id
              AND pair.resource = fact.resource
              AND pair.meter_node_id = fact.meter_node_id
              AND pair.interval_start = fact.interval_start
              AND pair.interval_end = fact.interval_end
          )) AS orphan_interval_facts
  `, [projectId, projectId, projectId]);
  const legacyNormalizedReadingCount = Number(row.legacy_normalized_rows ?? 0);
  const legacyIntervalFactCount = Number(row.legacy_interval_facts ?? 0);
  return {
    rawRowCount: Number(row.raw_rows ?? 0),
    invalidRawRowCount: Number(row.invalid_raw_rows ?? 0),
    unmappedRawRowCount: Number(row.unmapped_raw_rows ?? 0),
    rawOverlapConflictCount: Number(row.raw_overlap_conflicts ?? 0),
    normalizedReadingCount: Number(row.normalized_rows ?? 0),
    intervalFactCount: Number(row.interval_facts ?? 0),
    duplicateNormalizedReadingCount: Number(row.duplicate_normalized_rows ?? 0),
    duplicateIntervalFactCount: Number(row.duplicate_interval_facts ?? 0),
    invalidIntervalDurationCount: Number(row.invalid_interval_durations ?? 0),
    cadenceGapIntervalCount: Number(row.cadence_gap_intervals ?? 0),
    negativeDeltaIntervalCount: Number(row.negative_delta_intervals ?? 0),
    legacyRawRowCount: Number(row.legacy_raw_rows ?? 0),
    legacyNormalizedReadingCount,
    legacyIntervalFactCount,
    legacyCanonicalRowCount: legacyNormalizedReadingCount + legacyIntervalFactCount,
    canonicalMeterSeriesCount: Number(completeness.canonical_meter_series ?? 0),
    adjacentReadingPairCount: Number(completeness.adjacent_reading_pairs ?? 0),
    missingAdjacentIntervalCount: Number(completeness.missing_adjacent_intervals ?? 0),
    orphanIntervalFactCount: Number(completeness.orphan_interval_facts ?? 0),
  };
};

const ensureFactSchema = async (connection: DuckDbModule.Connection): Promise<void> => {
  await duckDbRun(connection, `
    CREATE TABLE IF NOT EXISTS raw_meter_readings (
      workspace_id VARCHAR, project_id VARCHAR, resource VARCHAR, device_name VARCHAR,
      event_time TIMESTAMPTZ, active_energy_kwh DOUBLE, source_file VARCHAR,
      source_sha256 VARCHAR, source_row_number INTEGER, is_valid BOOLEAN,
      validation_error VARCHAR, is_overlap_conflict BOOLEAN
    );
    CREATE TABLE IF NOT EXISTS normalized_meter_readings (
      workspace_id VARCHAR, project_id VARCHAR, resource VARCHAR, meter_node_id VARCHAR,
      level_node_id VARCHAR, device_name VARCHAR, category VARCHAR, meter_role VARCHAR,
      event_time TIMESTAMPTZ, active_energy_kwh DOUBLE, source_file VARCHAR,
      source_sha256 VARCHAR, source_row_number INTEGER
    );
    CREATE TABLE IF NOT EXISTS energy_source_normalized_readings (
      workspace_id VARCHAR, project_id VARCHAR, import_batch_id VARCHAR, resource VARCHAR,
      meter_node_id VARCHAR, scope_id VARCHAR, level_node_id VARCHAR, device_name VARCHAR,
      category VARCHAR, meter_role VARCHAR, event_time TIMESTAMPTZ, active_energy_kwh DOUBLE,
      source_file VARCHAR, source_sha256 VARCHAR, source_row_number INTEGER,
      source_reading_kind VARCHAR
    );
    CREATE TABLE IF NOT EXISTS energy_interval_facts (
      workspace_id VARCHAR, project_id VARCHAR, resource VARCHAR, meter_node_id VARCHAR,
      parent_node_id VARCHAR, level_node_id VARCHAR, device_name VARCHAR, appliance VARCHAR,
      circuit_name VARCHAR, category VARCHAR, meter_role VARCHAR, source_reading_kind VARCHAR,
      interval_start TIMESTAMPTZ, interval_end TIMESTAMPTZ, elapsed_minutes DOUBLE,
      active_energy_kwh DOUBLE, previous_active_energy_kwh DOUBLE, raw_delta_kwh DOUBLE,
      usage_kwh DOUBLE, average_kw DOUBLE, quality_status VARCHAR, local_date DATE,
      local_hour INTEGER, day_type VARCHAR, is_operating BOOLEAN, source_file VARCHAR,
      source_sha256 VARCHAR
    );
    CREATE TABLE IF NOT EXISTS energy_quality_events (
      workspace_id VARCHAR NOT NULL,
      project_id VARCHAR NOT NULL,
      import_batch_id VARCHAR NOT NULL,
      meter_node_id VARCHAR,
      source_label VARCHAR,
      event_time TIMESTAMPTZ,
      code VARCHAR NOT NULL,
      severity VARCHAR NOT NULL,
      details_json JSON NOT NULL,
      source_reading_kind VARCHAR,
      source_sha256 VARCHAR
    );
    CREATE TABLE IF NOT EXISTS energy_source_quality_events (
      workspace_id VARCHAR NOT NULL, project_id VARCHAR NOT NULL,
      import_batch_id VARCHAR NOT NULL, meter_node_id VARCHAR, source_label VARCHAR,
      event_time TIMESTAMPTZ, code VARCHAR NOT NULL, severity VARCHAR NOT NULL,
      details_json JSON NOT NULL, source_reading_kind VARCHAR, source_sha256 VARCHAR
    );
    CREATE TABLE IF NOT EXISTS energy_source_interval_facts (
      workspace_id VARCHAR, project_id VARCHAR, import_batch_id VARCHAR, resource VARCHAR,
      meter_node_id VARCHAR, scope_id VARCHAR, parent_node_id VARCHAR, level_node_id VARCHAR,
      device_name VARCHAR, appliance VARCHAR, circuit_name VARCHAR, category VARCHAR,
      meter_role VARCHAR, source_reading_kind VARCHAR, interval_start TIMESTAMPTZ,
      interval_end TIMESTAMPTZ, elapsed_minutes DOUBLE, active_energy_kwh DOUBLE,
      previous_active_energy_kwh DOUBLE, raw_delta_kwh DOUBLE, usage_kwh DOUBLE,
      average_kw DOUBLE, quality_status VARCHAR, local_date DATE, local_hour INTEGER,
      day_type VARCHAR, is_operating BOOLEAN, source_file VARCHAR, source_sha256 VARCHAR
    );
    CREATE TABLE IF NOT EXISTS energy_project_fact_state (
      project_id VARCHAR PRIMARY KEY,
      workspace_id VARCHAR NOT NULL,
      data_snapshot_id VARCHAR NOT NULL,
      manifest_fingerprint VARCHAR NOT NULL,
      source_sha256_json JSON NOT NULL,
      fact_writer_contract_version VARCHAR NOT NULL,
      canonical_interval_count UBIGINT,
      canonical_interval_digest VARCHAR,
      updated_at TIMESTAMPTZ NOT NULL
    );
  `);
  await duckDbRun(connection, `
    ALTER TABLE raw_meter_readings ADD COLUMN IF NOT EXISTS import_batch_id VARCHAR;
    ALTER TABLE raw_meter_readings ADD COLUMN IF NOT EXISTS meter_node_id VARCHAR;
    ALTER TABLE raw_meter_readings ADD COLUMN IF NOT EXISTS scope_id VARCHAR;
    ALTER TABLE normalized_meter_readings ADD COLUMN IF NOT EXISTS import_batch_id VARCHAR;
    ALTER TABLE normalized_meter_readings ADD COLUMN IF NOT EXISTS scope_id VARCHAR;
    ALTER TABLE normalized_meter_readings ADD COLUMN IF NOT EXISTS source_reading_kind VARCHAR;
    ALTER TABLE energy_interval_facts ADD COLUMN IF NOT EXISTS import_batch_id VARCHAR;
    ALTER TABLE energy_interval_facts ADD COLUMN IF NOT EXISTS scope_id VARCHAR;
    ALTER TABLE energy_interval_facts ADD COLUMN IF NOT EXISTS source_reading_kind VARCHAR;
    ALTER TABLE energy_quality_events ADD COLUMN IF NOT EXISTS source_reading_kind VARCHAR;
    ALTER TABLE energy_quality_events ADD COLUMN IF NOT EXISTS source_sha256 VARCHAR;
    ALTER TABLE energy_project_fact_state ADD COLUMN IF NOT EXISTS canonical_interval_count UBIGINT;
    ALTER TABLE energy_project_fact_state ADD COLUMN IF NOT EXISTS canonical_interval_digest VARCHAR;
  `);
  await duckDbRun(connection, `
    UPDATE normalized_meter_readings SET scope_id = meter_node_id WHERE scope_id IS NULL;
    UPDATE normalized_meter_readings
    SET source_reading_kind = 'cumulative_energy'
    WHERE source_reading_kind IS NULL OR source_reading_kind = '';
    UPDATE energy_interval_facts SET scope_id = meter_node_id WHERE scope_id IS NULL;
    UPDATE energy_interval_facts
    SET source_reading_kind = 'cumulative_energy'
    WHERE source_reading_kind IS NULL OR source_reading_kind = '';
    UPDATE energy_quality_events
    SET source_reading_kind = 'cumulative_energy'
    WHERE source_reading_kind IS NULL OR source_reading_kind = '';
    CREATE OR REPLACE VIEW energy_daily_facts AS
    SELECT
      workspace_id, project_id, resource, meter_node_id, scope_id,
      parent_node_id, level_node_id, device_name, appliance, circuit_name,
      category, meter_role, local_date,
      SUM(usage_kwh) FILTER (WHERE quality_status IN ('ok', 'gap')) AS usage_kwh,
      MAX(average_kw) FILTER (WHERE quality_status = 'ok') AS peak_average_kw,
      COUNT(*) FILTER (WHERE quality_status = 'ok') AS valid_interval_count,
      COUNT(*) FILTER (WHERE quality_status <> 'ok') AS quality_event_count
    FROM energy_interval_facts
    GROUP BY ALL;
  `);
};

const assertFactReadSchema = async (connection: DuckDbModule.Connection): Promise<void> => {
  const row = await duckDbGet(connection, `
    SELECT COUNT(DISTINCT table_name) AS table_count
    FROM information_schema.tables
    WHERE table_schema = 'main'
      AND table_type = 'BASE TABLE'
      AND table_name IN (
        'energy_project_fact_state',
        'normalized_meter_readings',
        'energy_interval_facts',
        'energy_quality_events'
      )
  `);
  if (Number(row.table_count ?? 0) !== 4) {
    throw new Error("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
  }
};

const validateSnapshotFactScope = (input: EnergyFactScopedBatchWrite): void => {
  const scope = input.snapshotFactScope!;
  const rows = [
    ...input.rawReadings,
    ...input.normalizedReadings,
    ...input.intervalFacts,
    ...input.qualityEvents,
  ];
  const sourcedRows = [
    ...input.rawReadings,
    ...input.normalizedReadings,
    ...input.intervalFacts,
  ];
  if (scope.projectId !== input.projectId || rows.some((row) =>
    row.workspaceId !== scope.workspaceId
    || row.projectId !== input.projectId
    || row.importBatchId !== input.importBatchId)
    || sourcedRows.some((row) =>
      row.sourceSha256.toLocaleLowerCase() !== input.sourceSha256.toLocaleLowerCase())) {
    throw new Error("ENERGYIQ_SNAPSHOT_FACT_SCOPE_MISMATCH");
  }
  const manifestSources = new Set(scope.sourceSha256.map((value) => value.toLocaleLowerCase()));
  if (manifestSources.size === 0 || [...manifestSources].some((value) => value.trim().length === 0)) {
    throw new Error("ENERGYIQ_SNAPSHOT_FACT_SCOPE_EMPTY");
  }
  if (!manifestSources.has(input.sourceSha256.toLocaleLowerCase())) {
    throw new Error(`ENERGYIQ_IMPORT_BATCH_NOT_PINNED:${input.importBatchId}`);
  }
  if (input.preserveExisting && rows.length > 0) {
    throw new Error(`ENERGYIQ_IMPORT_BATCH_PRESERVE_INVALID:${input.importBatchId}`);
  }
};

const assertExistingBatchSourceRows = async (
  connection: DuckDbModule.Connection,
  input: EnergyFactScopedBatchWrite,
): Promise<void> => {
  const row = await duckDbGet(connection, `
    SELECT (
      (SELECT COUNT(*) FROM raw_meter_readings WHERE project_id = ? AND import_batch_id = ? AND LOWER(source_sha256) = LOWER(?))
      + (SELECT COUNT(*) FROM energy_source_normalized_readings WHERE project_id = ? AND import_batch_id = ? AND LOWER(source_sha256) = LOWER(?))
      + (SELECT COUNT(*) FROM energy_source_interval_facts WHERE project_id = ? AND import_batch_id = ? AND LOWER(source_sha256) = LOWER(?))
      + (SELECT COUNT(*) FROM energy_source_quality_events WHERE project_id = ? AND import_batch_id = ? AND LOWER(source_sha256) = LOWER(?))
    ) AS row_count
  `, [
    input.projectId, input.importBatchId, input.sourceSha256,
    input.projectId, input.importBatchId, input.sourceSha256,
    input.projectId, input.importBatchId, input.sourceSha256,
    input.projectId, input.importBatchId, input.sourceSha256,
  ]);
  if (Number(row.row_count ?? 0) <= 0) {
    throw new Error(`ENERGYIQ_IMPORT_BATCH_SOURCE_ROWS_UNAVAILABLE:${input.importBatchId}`);
  }
};

const validateProjectMaterializationInput = (input: EnergyFactProjectMaterializationWrite): void => {
  const snapshotSources = input.snapshotFactScope.sourceSha256.map((value) => value.toLocaleLowerCase());
  const batchSources = input.batches.map((batch) => batch.sourceSha256.toLocaleLowerCase());
  const expectedSources = [...new Set(snapshotSources)]
    .sort((left, right) => left.localeCompare(right));
  const providedSources = [...new Set(batchSources)]
    .sort((left, right) => left.localeCompare(right));
  if (input.snapshotFactScope.projectId !== input.projectId
    || snapshotSources.length === 0
    || expectedSources.length !== snapshotSources.length
    || providedSources.length !== batchSources.length
    || expectedSources.length !== input.batches.length
    || JSON.stringify(providedSources) !== JSON.stringify(expectedSources)) {
    throw new Error("ENERGYIQ_SNAPSHOT_MANIFEST_MATERIALIZATION_INCOMPLETE");
  }
  for (const batch of input.batches) {
    validateSnapshotFactScope({
      projectId: input.projectId,
      snapshotFactScope: input.snapshotFactScope,
      ...batch,
    });
  }
};

const publishCanonicalProjectFacts = async (
  connection: DuckDbModule.Connection,
  projectId: string,
  timezone: string,
  snapshotFactScope: EnergyIqSnapshotFactScope,
): Promise<number> => {
  const canonicalRebuildStartedAt = performance.now();
  await rebuildCanonicalNormalizedReadings(connection, projectId, snapshotFactScope.sourceSha256);
  await rebuildCanonicalSourceIntervals(connection, projectId, snapshotFactScope.sourceSha256);
  await rebuildCanonicalSourceQualityEvents(connection, projectId, snapshotFactScope.sourceSha256);
  await markRawOverlapConflicts(connection, projectId, snapshotFactScope.sourceSha256);
  await assertNoAmbiguousOverlapConflicts(connection, projectId);
  await deduplicateCanonicalRows(connection, projectId);
  await rebuildProjectCumulativeIntervals(connection, projectId, timezone);
  await rebuildProjectEventCumulativeIntervals(connection, projectId, timezone);
  await rebuildProjectCumulativeQualityEvents(connection, projectId);
  await rebuildProjectEventCumulativeQualityEvents(connection, projectId);
  await writeProjectFactState(connection, snapshotFactScope);
  return elapsedMs(canonicalRebuildStartedAt);
};

const assertExpectedPreviousFactState = async (
  connection: DuckDbModule.Connection,
  input: EnergyFactProjectMaterializationWrite,
): Promise<void> => {
  const row = await duckDbGet(connection, `
    SELECT data_snapshot_id
    FROM energy_project_fact_state
    WHERE project_id = ?
  `, [input.projectId]);
  if (typeof row.data_snapshot_id !== "string") return;
  if (row.data_snapshot_id !== input.expectedPreviousDataSnapshotId
    && row.data_snapshot_id !== input.snapshotFactScope.dataSnapshotId) {
    throw new Error(`ENERGYIQ_SNAPSHOT_STALE:${row.data_snapshot_id}`);
  }
};

const rebuildCanonicalNormalizedReadings = async (
  connection: DuckDbModule.Connection,
  projectId: string,
  sourceSha256: readonly string[],
): Promise<void> => {
  const placeholders = sourceSha256.map(() => "?").join(", ");
  await duckDbRun(connection, "DELETE FROM normalized_meter_readings WHERE project_id = ?", [projectId]);
  await duckDbRun(connection, `
    INSERT INTO normalized_meter_readings (${NORMALIZED_COLUMNS.join(", ")})
    SELECT ${NORMALIZED_COLUMNS.join(", ")}
    FROM energy_source_normalized_readings
    WHERE project_id = ? AND lower(source_sha256) IN (${placeholders})
  `, [projectId, ...sourceSha256.map((value) => value.toLocaleLowerCase())]);
};

const rebuildCanonicalSourceQualityEvents = async (
  connection: DuckDbModule.Connection,
  projectId: string,
  sourceSha256: readonly string[],
): Promise<void> => {
  const placeholders = sourceSha256.map(() => "?").join(", ");
  await duckDbRun(connection, "DELETE FROM energy_quality_events WHERE project_id = ?", [projectId]);
  await duckDbRun(connection, `
    INSERT INTO energy_quality_events (${QUALITY_COLUMNS.join(", ")})
    SELECT ${QUALITY_COLUMNS.join(", ")}
    FROM energy_source_quality_events
    WHERE project_id = ? AND lower(source_sha256) IN (${placeholders})
  `, [projectId, ...sourceSha256.map((value) => value.toLocaleLowerCase())]);
};

const rebuildCanonicalSourceIntervals = async (
  connection: DuckDbModule.Connection,
  projectId: string,
  sourceSha256: readonly string[],
): Promise<void> => {
  const placeholders = sourceSha256.map(() => "?").join(", ");
  await duckDbRun(connection, "DELETE FROM energy_interval_facts WHERE project_id = ?", [projectId]);
  await duckDbRun(connection, `
    INSERT INTO energy_interval_facts (${FACT_COLUMNS.join(", ")})
    SELECT ${FACT_COLUMNS.join(", ")}
    FROM energy_source_interval_facts
    WHERE project_id = ? AND lower(source_sha256) IN (${placeholders})
  `, [projectId, ...sourceSha256.map((value) => value.toLocaleLowerCase())]);
};

const writeProjectFactState = async (
  connection: DuckDbModule.Connection,
  scope: EnergyIqSnapshotFactScope,
): Promise<void> => {
  const integrity = await duckDbGet(connection, energyCanonicalIntervalIntegritySql(scope));
  const canonicalIntervalCount = requiredNonNegativeInteger(integrity.canonical_interval_count);
  const canonicalIntervalDigest = requiredSha256(integrity.canonical_interval_digest);
  await duckDbRun(connection, `
    INSERT INTO energy_project_fact_state (
      project_id, workspace_id, data_snapshot_id, manifest_fingerprint,
      source_sha256_json, fact_writer_contract_version,
      canonical_interval_count, canonical_interval_digest, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, current_timestamp)
    ON CONFLICT (project_id) DO UPDATE SET
      workspace_id = excluded.workspace_id,
      data_snapshot_id = excluded.data_snapshot_id,
      manifest_fingerprint = excluded.manifest_fingerprint,
      source_sha256_json = excluded.source_sha256_json,
      fact_writer_contract_version = excluded.fact_writer_contract_version,
      canonical_interval_count = excluded.canonical_interval_count,
      canonical_interval_digest = excluded.canonical_interval_digest,
      updated_at = excluded.updated_at
  `, [
    scope.projectId,
    scope.workspaceId,
    scope.dataSnapshotId,
    scope.manifestFingerprint,
    JSON.stringify(scope.sourceSha256.map((value) => value.toLocaleLowerCase())),
    ENERGY_FACT_WRITER_CONTRACT_VERSION,
    canonicalIntervalCount,
    canonicalIntervalDigest,
  ]);
};

const requiredNonNegativeInteger = (value: unknown): number => {
  const numeric = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    throw new Error("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
  }
  return numeric;
};

const requiredSha256 = (value: unknown): string => {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
  }
  return value;
};

const deleteExistingBatch = async (
  connection: DuckDbModule.Connection,
  input: EnergyFactScopedBatchWrite,
): Promise<void> => {
  for (const table of [
    "raw_meter_readings",
    "energy_source_normalized_readings",
    "normalized_meter_readings",
    "energy_source_interval_facts",
    "energy_interval_facts",
  ]) {
    await duckDbRun(connection, `DELETE FROM ${table} WHERE project_id = ? AND (import_batch_id = ? OR source_sha256 = ?)`, [
      input.projectId,
      input.importBatchId,
      input.sourceSha256,
    ]);
  }
  for (const table of ["energy_source_quality_events", "energy_quality_events"]) {
    await duckDbRun(connection, `DELETE FROM ${table} WHERE project_id = ? AND import_batch_id = ?`, [
      input.projectId,
      input.importBatchId,
    ]);
  }
};

const markRawOverlapConflicts = async (
  connection: DuckDbModule.Connection,
  projectId: string,
  sourceSha256: readonly string[],
): Promise<void> => {
  const normalizedSources = sourceSha256.map((value) => value.toLocaleLowerCase());
  const manifestPlaceholders = normalizedSources.map(() => "?").join(", ");
  await duckDbRun(connection, `
    UPDATE raw_meter_readings
    SET is_overlap_conflict = FALSE
    WHERE project_id = ?
  `, [projectId]);
  await duckDbRun(connection, `
    UPDATE raw_meter_readings target
    SET is_overlap_conflict = TRUE
    WHERE target.project_id = ?
      AND lower(target.source_sha256) IN (${manifestPlaceholders})
      AND target.event_time IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM raw_meter_readings candidate
        WHERE candidate.project_id = target.project_id
          AND lower(candidate.source_sha256) IN (${manifestPlaceholders})
          AND candidate.meter_node_id = target.meter_node_id
          AND candidate.event_time = target.event_time
          AND candidate.active_energy_kwh <> target.active_energy_kwh
      )
  `, [projectId, ...normalizedSources, ...normalizedSources]);
};

const assertNoAmbiguousOverlapConflicts = async (
  connection: DuckDbModule.Connection,
  projectId: string,
): Promise<void> => {
  const normalized = await duckDbGet(connection, `
    WITH sourced AS (
      SELECT *, MAX(event_time) OVER (
        PARTITION BY project_id, meter_node_id, source_sha256
      ) AS source_coverage_end
      FROM normalized_meter_readings
      WHERE project_id = ?
    )
    SELECT COUNT(*) AS ambiguous_count
    FROM sourced left_source
    JOIN sourced right_source
      ON right_source.project_id = left_source.project_id
      AND right_source.meter_node_id = left_source.meter_node_id
      AND right_source.event_time = left_source.event_time
      AND right_source.source_sha256 > left_source.source_sha256
      AND right_source.source_coverage_end = left_source.source_coverage_end
      AND right_source.active_energy_kwh IS DISTINCT FROM left_source.active_energy_kwh
  `, [projectId]);
  const intervals = await duckDbGet(connection, `
    WITH sourced AS (
      SELECT *, MAX(interval_end) OVER (
        PARTITION BY project_id, meter_node_id, source_sha256
      ) AS source_coverage_end
      FROM energy_interval_facts
      WHERE project_id = ?
    )
    SELECT COUNT(*) AS ambiguous_count
    FROM sourced left_source
    JOIN sourced right_source
      ON right_source.project_id = left_source.project_id
      AND right_source.meter_node_id = left_source.meter_node_id
      AND right_source.interval_start = left_source.interval_start
      AND right_source.source_sha256 > left_source.source_sha256
      AND right_source.source_coverage_end = left_source.source_coverage_end
      AND (
        right_source.interval_end IS DISTINCT FROM left_source.interval_end
        OR right_source.usage_kwh IS DISTINCT FROM left_source.usage_kwh
        OR right_source.quality_status IS DISTINCT FROM left_source.quality_status
      )
  `, [projectId]);
  if (Number(normalized.ambiguous_count ?? 0) > 0
    || Number(intervals.ambiguous_count ?? 0) > 0) {
    throw new Error("ENERGYIQ_OVERLAP_CONFLICT_AMBIGUOUS");
  }
};

const deduplicateCanonicalRows = async (
  connection: DuckDbModule.Connection,
  projectId: string,
): Promise<void> => {
  await replaceProjectRowsWithPreferredSource(connection, {
    table: "normalized_meter_readings",
    columns: NORMALIZED_COLUMNS,
    projectId,
    timestampColumn: "event_time",
  });
  await replaceProjectRowsWithPreferredSource(connection, {
    table: "energy_interval_facts",
    columns: FACT_COLUMNS,
    projectId,
    timestampColumn: "interval_start",
    coverageColumn: "interval_end",
  });
};

const rebuildProjectCumulativeIntervals = async (
  connection: DuckDbModule.Connection,
  projectId: string,
  timezone: string,
): Promise<void> => {
  await duckDbRun(connection, `
    CREATE OR REPLACE TEMP TABLE canonical_cumulative_pairs AS
    WITH ordered_readings AS (
      SELECT *,
        LAG(event_time) OVER series_order AS previous_event_time,
        LAG(active_energy_kwh) OVER series_order AS previous_active_energy_kwh
      FROM normalized_meter_readings
      WHERE project_id = ? AND source_reading_kind = 'cumulative_energy'
      WINDOW series_order AS (
        PARTITION BY project_id, resource, meter_node_id
        ORDER BY event_time
      )
    ), adjacent_pairs_unclassified AS (
      SELECT *,
        date_diff('millisecond', previous_event_time, event_time) / 60000.0 AS elapsed_minutes,
        active_energy_kwh - previous_active_energy_kwh AS raw_delta_kwh
      FROM ordered_readings
      WHERE previous_event_time IS NOT NULL
    ), adjacent_pairs AS (
      SELECT *, median(elapsed_minutes) OVER (
        PARTITION BY project_id, resource, meter_node_id
      ) AS typical_elapsed_minutes
      FROM adjacent_pairs_unclassified
    )
    SELECT *, CASE
      WHEN raw_delta_kwh < 0 THEN 'negative_delta'
      WHEN elapsed_minutes > typical_elapsed_minutes + greatest(0.1, typical_elapsed_minutes * 0.01) THEN 'gap'
      WHEN elapsed_minutes < typical_elapsed_minutes - greatest(0.1, typical_elapsed_minutes * 0.01) THEN 'irregular_interval'
      ELSE 'ok'
    END AS quality_status
    FROM adjacent_pairs
  `, [projectId]);

  await duckDbRun(connection, `
    DELETE FROM energy_interval_facts
    WHERE project_id = ? AND source_reading_kind = 'cumulative_energy'
  `, [projectId]);
  await duckDbRun(connection, `
    INSERT INTO energy_interval_facts (${FACT_COLUMNS.join(", ")})
    SELECT
      workspace_id, project_id, import_batch_id, resource, meter_node_id, scope_id,
      level_node_id AS parent_node_id, level_node_id, device_name,
      category AS appliance, device_name AS circuit_name, category, meter_role,
      'cumulative_energy' AS source_reading_kind,
      previous_event_time AS interval_start, event_time AS interval_end, elapsed_minutes,
      active_energy_kwh, previous_active_energy_kwh, raw_delta_kwh,
      CASE WHEN quality_status IN ('ok', 'gap') THEN raw_delta_kwh ELSE NULL END AS usage_kwh,
      CASE WHEN quality_status IN ('ok', 'gap') THEN raw_delta_kwh / (elapsed_minutes / 60.0) ELSE NULL END AS average_kw,
      quality_status,
      CAST(timezone(?, previous_event_time) AS DATE) AS local_date,
      CAST(date_part('hour', timezone(?, previous_event_time)) AS INTEGER) AS local_hour,
      CASE WHEN date_part('isodow', timezone(?, previous_event_time)) IN (6, 7)
        THEN 'weekend' ELSE 'weekday' END AS day_type,
      NULL AS is_operating,
      source_file, source_sha256
    FROM canonical_cumulative_pairs
  `, [timezone, timezone, timezone]);
};

const rebuildProjectCumulativeQualityEvents = async (
  connection: DuckDbModule.Connection,
  projectId: string,
): Promise<void> => {
  await duckDbRun(connection, `
    DELETE FROM energy_quality_events
    WHERE project_id = ?
      AND source_reading_kind = 'cumulative_energy'
      AND code IN ('boundary', 'gap', 'irregular_interval', 'negative_delta')
  `, [projectId]);
  await duckDbRun(connection, `
    INSERT INTO energy_quality_events (${QUALITY_COLUMNS.join(", ")})
    WITH ranked_readings AS (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY project_id, resource, meter_node_id
        ORDER BY event_time
      ) AS reading_rank
      FROM normalized_meter_readings
      WHERE project_id = ? AND source_reading_kind = 'cumulative_energy'
    )
    SELECT
      workspace_id, project_id, import_batch_id, meter_node_id, device_name, event_time,
      'boundary' AS code, 'warning' AS severity,
      json_object('reason', 'No previous canonical cumulative reading exists in this Project.') AS details_json,
      'cumulative_energy' AS source_reading_kind,
      source_sha256
    FROM ranked_readings
    WHERE reading_rank = 1
  `, [projectId]);
  await duckDbRun(connection, `
    INSERT INTO energy_quality_events (${QUALITY_COLUMNS.join(", ")})
    SELECT
      workspace_id, project_id, import_batch_id, meter_node_id, device_name, event_time,
      quality_status AS code,
      CASE WHEN quality_status = 'negative_delta' THEN 'error' ELSE 'warning' END AS severity,
      json_object('elapsedMinutes', elapsed_minutes, 'rawDeltaKwh', raw_delta_kwh) AS details_json,
      'cumulative_energy' AS source_reading_kind,
      source_sha256
    FROM canonical_cumulative_pairs
    WHERE quality_status <> 'ok'
  `);
  await duckDbRun(connection, "DROP TABLE canonical_cumulative_pairs");
};

const rebuildProjectEventCumulativeIntervals = async (
  connection: DuckDbModule.Connection,
  projectId: string,
  timezone: string,
): Promise<void> => {
  await duckDbRun(connection, `
    CREATE OR REPLACE TEMP TABLE canonical_event_pairs AS
    WITH ordered_readings AS (
      SELECT *,
        LAG(event_time) OVER series_order AS previous_event_time,
        LAG(active_energy_kwh) OVER series_order AS previous_active_energy_kwh
      FROM normalized_meter_readings
      WHERE project_id = ? AND source_reading_kind = 'cumulative_energy_event'
      WINDOW series_order AS (
        PARTITION BY project_id, resource, meter_node_id
        ORDER BY event_time
      )
    )
    SELECT *,
      date_diff('millisecond', previous_event_time, event_time) AS elapsed_milliseconds,
      active_energy_kwh - previous_active_energy_kwh AS raw_delta_kwh
    FROM ordered_readings
    WHERE previous_event_time IS NOT NULL
  `, [projectId]);

  await duckDbRun(connection, `
    CREATE OR REPLACE TEMP TABLE canonical_event_interval_contributions AS
    SELECT
      pairs.*,
      grid.interval_start,
      grid.interval_start + INTERVAL '15 minutes' AS interval_end,
      greatest(pairs.previous_event_time, grid.interval_start) AS overlap_start,
      least(pairs.event_time, grid.interval_start + INTERVAL '15 minutes') AS overlap_end,
      date_diff(
        'millisecond',
        greatest(pairs.previous_event_time, grid.interval_start),
        least(pairs.event_time, grid.interval_start + INTERVAL '15 minutes')
      ) AS overlap_milliseconds
    FROM canonical_event_pairs pairs
    CROSS JOIN LATERAL generate_series(
      time_bucket(INTERVAL '15 minutes', pairs.previous_event_time),
      time_bucket(INTERVAL '15 minutes', pairs.event_time - INTERVAL '1 microsecond'),
      INTERVAL '15 minutes'
    ) AS grid(interval_start)
    WHERE pairs.elapsed_milliseconds > 0
  `);

  await duckDbRun(connection, `
    DELETE FROM energy_interval_facts facts
    WHERE facts.project_id = ?
      AND EXISTS (
        SELECT 1
        FROM normalized_meter_readings readings
        WHERE readings.project_id = facts.project_id
          AND readings.import_batch_id = facts.import_batch_id
          AND readings.source_reading_kind = 'cumulative_energy_event'
      )
  `, [projectId]);
  await duckDbRun(connection, `
    INSERT INTO energy_interval_facts (${FACT_COLUMNS.join(", ")})
    WITH aggregated AS (
      SELECT
        project_id, resource, meter_node_id, interval_start,
        interval_start + INTERVAL '15 minutes' AS interval_end,
        SUM(overlap_milliseconds) AS covered_milliseconds,
        COUNT(*) FILTER (WHERE raw_delta_kwh < 0) AS negative_pair_count,
        ARG_MAX(workspace_id, event_time) AS workspace_id,
        ARG_MAX(import_batch_id, event_time) AS import_batch_id,
        ARG_MAX(scope_id, event_time) AS scope_id,
        ARG_MAX(level_node_id, event_time) AS level_node_id,
        ARG_MAX(device_name, event_time) AS device_name,
        ARG_MAX(category, event_time) AS category,
        ARG_MAX(meter_role, event_time) AS meter_role,
        ARG_MAX(source_file, event_time) AS source_file,
        ARG_MAX(source_sha256, event_time) AS source_sha256,
        ARG_MIN(
          previous_active_energy_kwh + raw_delta_kwh * (
            date_diff('millisecond', previous_event_time, overlap_start)::DOUBLE
            / elapsed_milliseconds
          ),
          overlap_start
        ) AS previous_active_energy_kwh,
        SUM(raw_delta_kwh * (overlap_milliseconds::DOUBLE / elapsed_milliseconds)) AS usage_kwh
      FROM canonical_event_interval_contributions
      GROUP BY project_id, resource, meter_node_id, interval_start
    )
    SELECT
      workspace_id, project_id, import_batch_id, resource, meter_node_id, scope_id,
      level_node_id AS parent_node_id, level_node_id, device_name,
      category AS appliance, device_name AS circuit_name, category, meter_role,
      'interval_usage' AS source_reading_kind,
      interval_start, interval_end, 15.0 AS elapsed_minutes,
      previous_active_energy_kwh + usage_kwh AS active_energy_kwh,
      previous_active_energy_kwh,
      usage_kwh AS raw_delta_kwh,
      usage_kwh,
      usage_kwh * 4.0 AS average_kw,
      'ok' AS quality_status,
      CAST(timezone(?, interval_start) AS DATE) AS local_date,
      CAST(date_part('hour', timezone(?, interval_start)) AS INTEGER) AS local_hour,
      CASE WHEN date_part('isodow', timezone(?, interval_start)) IN (6, 7)
        THEN 'weekend' ELSE 'weekday' END AS day_type,
      NULL AS is_operating,
      source_file, source_sha256
    FROM aggregated
    WHERE abs(covered_milliseconds - 900000) <= 1
      AND negative_pair_count = 0
      AND usage_kwh >= -0.000000001
  `, [timezone, timezone, timezone]);
};

const rebuildProjectEventCumulativeQualityEvents = async (
  connection: DuckDbModule.Connection,
  projectId: string,
): Promise<void> => {
  await duckDbRun(connection, `
    DELETE FROM energy_quality_events
    WHERE project_id = ?
      AND source_reading_kind = 'cumulative_energy_event'
      AND code IN ('boundary', 'negative_delta', 'tuya_event_readings_resampled')
  `, [projectId]);
  await duckDbRun(connection, `
    INSERT INTO energy_quality_events (${QUALITY_COLUMNS.join(", ")})
    WITH ranked_readings AS (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY project_id, resource, meter_node_id
        ORDER BY event_time
      ) AS reading_rank
      FROM normalized_meter_readings
      WHERE project_id = ? AND source_reading_kind = 'cumulative_energy_event'
    )
    SELECT
      workspace_id, project_id, import_batch_id, meter_node_id, device_name, event_time,
      'boundary' AS code, 'warning' AS severity,
      json_object('reason', 'No earlier canonical Tuya cumulative event exists in this Project.') AS details_json,
      'cumulative_energy_event' AS source_reading_kind,
      source_sha256
    FROM ranked_readings
    WHERE reading_rank = 1
  `, [projectId]);
  await duckDbRun(connection, `
    INSERT INTO energy_quality_events (${QUALITY_COLUMNS.join(", ")})
    SELECT
      workspace_id, project_id, import_batch_id, meter_node_id, device_name, event_time,
      'negative_delta' AS code, 'error' AS severity,
      json_object(
        'intervalStart', previous_event_time,
        'intervalEnd', event_time,
        'rawDeltaKwh', raw_delta_kwh
      ) AS details_json,
      'cumulative_energy_event' AS source_reading_kind,
      source_sha256
    FROM canonical_event_pairs
    WHERE raw_delta_kwh < 0
  `);
  await duckDbRun(connection, `
    INSERT INTO energy_quality_events (${QUALITY_COLUMNS.join(", ")})
    WITH meter_summary AS (
      SELECT
        readings.workspace_id,
        readings.project_id,
        ARG_MAX(readings.import_batch_id, readings.event_time) AS import_batch_id,
        readings.meter_node_id,
        ARG_MAX(readings.device_name, readings.event_time) AS device_name,
        MAX(readings.event_time) AS event_time,
        COUNT(*) AS source_reading_count,
        COUNT(DISTINCT readings.import_batch_id) AS source_batch_count,
        MIN(readings.event_time) AS source_coverage_from,
        MAX(readings.event_time) AS source_coverage_to,
        ARG_MAX(readings.source_sha256, readings.event_time) AS source_sha256,
        (
          SELECT COUNT(*)
          FROM energy_interval_facts facts
          WHERE facts.project_id = readings.project_id
            AND facts.meter_node_id = readings.meter_node_id
            AND facts.source_reading_kind = 'interval_usage'
        ) AS emitted_interval_count
      FROM normalized_meter_readings readings
      WHERE readings.project_id = ?
        AND readings.source_reading_kind = 'cumulative_energy_event'
      GROUP BY readings.workspace_id, readings.project_id, readings.meter_node_id
    )
    SELECT
      workspace_id, project_id, import_batch_id, meter_node_id, device_name, event_time,
      'tuya_event_readings_resampled' AS code, 'warning' AS severity,
      json_object(
        'method', 'piecewise_linear_cumulative_interpolation',
        'targetIntervalMinutes', 15,
        'sourceReadingCount', source_reading_count,
        'sourceBatchCount', source_batch_count,
        'emittedIntervalCount', emitted_interval_count,
        'sourceCoverageFrom', source_coverage_from,
        'sourceCoverageTo', source_coverage_to,
        'partialBoundaryIntervalsExcluded', true
      ) AS details_json,
      'cumulative_energy_event' AS source_reading_kind,
      source_sha256
    FROM meter_summary
  `, [projectId]);
  await duckDbRun(connection, "DROP TABLE canonical_event_interval_contributions");
  await duckDbRun(connection, "DROP TABLE canonical_event_pairs");
};

const replaceProjectRowsWithPreferredSource = async (
  connection: DuckDbModule.Connection,
  input: {
    table: string;
    columns: readonly string[];
    projectId: string;
    timestampColumn: string;
    coverageColumn?: string;
  },
): Promise<void> => {
  const tempTable = `preferred_${input.table}`;
  const coverageColumn = input.coverageColumn ?? input.timestampColumn;
  await duckDbRun(connection, `
    CREATE OR REPLACE TEMP TABLE ${tempTable} AS
    WITH ranked_sources AS (
      SELECT *,
        MAX(${coverageColumn}) OVER (
          PARTITION BY project_id, meter_node_id, source_sha256
        ) AS source_coverage_end
      FROM ${input.table}
      WHERE project_id = ?
    ), ranked_rows AS (
      SELECT *, ROW_NUMBER() OVER (
        PARTITION BY project_id, meter_node_id, ${input.timestampColumn}
        ORDER BY source_coverage_end DESC, source_file DESC, COALESCE(import_batch_id, '') DESC
      ) AS source_rank
      FROM ranked_sources
    )
    SELECT ${input.columns.join(", ")}
    FROM ranked_rows
    WHERE source_rank = 1
  `, [input.projectId]);
  await duckDbRun(connection, `DELETE FROM ${input.table} WHERE project_id = ?`, [input.projectId]);
  await duckDbRun(connection, `
    INSERT INTO ${input.table} (${input.columns.join(", ")})
    SELECT ${input.columns.join(", ")} FROM ${tempTable}
  `);
  await duckDbRun(connection, `DROP TABLE ${tempTable}`);
};

const RAW_COLUMNS = [
  "workspace_id", "project_id", "import_batch_id", "resource", "device_name", "meter_node_id", "scope_id",
  "event_time", "active_energy_kwh", "source_file", "source_sha256", "source_row_number",
  "is_valid", "validation_error", "is_overlap_conflict",
] as const;
const NORMALIZED_COLUMNS = [
  "workspace_id", "project_id", "import_batch_id", "resource", "meter_node_id", "scope_id", "level_node_id",
  "device_name", "category", "meter_role", "event_time", "active_energy_kwh", "source_file", "source_sha256", "source_row_number",
  "source_reading_kind",
] as const;
const FACT_COLUMNS = [
  "workspace_id", "project_id", "import_batch_id", "resource", "meter_node_id", "scope_id", "parent_node_id", "level_node_id",
  "device_name", "appliance", "circuit_name", "category", "meter_role", "source_reading_kind",
  "interval_start", "interval_end", "elapsed_minutes", "active_energy_kwh", "previous_active_energy_kwh",
  "raw_delta_kwh", "usage_kwh", "average_kw", "quality_status", "local_date", "local_hour", "day_type",
  "is_operating", "source_file", "source_sha256",
] as const;
const QUALITY_COLUMNS = [
  "workspace_id", "project_id", "import_batch_id", "meter_node_id", "source_label", "event_time", "code", "severity", "details_json",
  "source_reading_kind", "source_sha256",
] as const;

const rawValues = (row: EnergyRawReadingWrite): unknown[] => [
  row.workspaceId, row.projectId, row.importBatchId, row.resource, row.sourceLabel,
  row.meterPointId ?? null, row.scopeId ?? null, row.eventTime ?? null,
  row.activeEnergyKwh ?? null, row.sourceFile, row.sourceSha256, row.sourceRowNumber,
  row.isValid, row.validationError ?? null, row.isOverlapConflict,
];
const normalizedValues = (row: EnergyNormalizedReadingWrite): unknown[] => [
  row.workspaceId, row.projectId, row.importBatchId, row.resource, row.meterPointId,
  row.scopeId, row.parentNodeId ?? null, row.sourceLabel, row.category, row.meterRole,
  row.eventTime, row.activeEnergyKwh, row.sourceFile, row.sourceSha256, row.sourceRowNumber,
  row.sourceReadingKind,
];
const factValues = (row: EnergyIntervalFactWrite): unknown[] => [
  row.workspaceId, row.projectId, row.importBatchId, row.resource, row.meterPointId, row.scopeId,
  row.parentNodeId ?? null, row.parentNodeId ?? null, row.sourceLabel, row.category, row.sourceLabel,
  row.category, row.meterRole, row.sourceReadingKind, row.intervalStart, row.intervalEnd,
  row.elapsedMinutes, row.activeEnergyKwh, row.previousActiveEnergyKwh, row.rawDeltaKwh,
  row.usageKwh ?? null, row.averageKw ?? null, row.qualityStatus, row.localDate, row.localHour,
  row.dayType, row.isOperating ?? null, row.sourceFile, row.sourceSha256,
];
const qualityValues = (row: EnergyQualityEventWrite, sourceSha256: string): unknown[] => [
  row.workspaceId, row.projectId, row.importBatchId, row.meterPointId ?? null,
  row.sourceLabel ?? null, row.eventTime ?? null, row.code, row.severity, JSON.stringify(row.details),
  row.sourceReadingKind, sourceSha256,
];

const insertRows = async (
  connection: DuckDbModule.Connection,
  table: string,
  columns: readonly string[],
  rows: unknown[][],
  csvPath: string,
): Promise<void> => {
  if (rows.length === 0) return;
  requireSqlIdentifier(table);
  for (const column of columns) requireSqlIdentifier(column);
  const file = openSync(csvPath, "wx", 0o600);
  try {
    let buffered = "";
    for (const row of rows) {
      if (row.length !== columns.length) throw new Error("ENERGYIQ_FACT_BULK_ROW_WIDTH_INVALID");
      buffered += `${row.map(serializeCsvValue).join(",")}\n`;
      if (buffered.length >= 1_048_576) {
        writeSync(file, buffered, undefined, "utf8");
        buffered = "";
      }
    }
    if (buffered.length > 0) writeSync(file, buffered, undefined, "utf8");
  } finally {
    closeSync(file);
  }
  await duckDbRunFinalized(connection, `
    COPY ${table} (${columns.join(",")})
    FROM '${sqlStringLiteral(normalizeDuckDbFilePath(csvPath))}'
    (FORMAT CSV, HEADER FALSE, DELIMITER ',', QUOTE '"', ESCAPE '"',
     NULL '${ENERGY_FACT_CSV_NULL}', ALLOW_QUOTED_NULLS FALSE)
  `);
};

const duckDbRunFinalized = async (
  connection: DuckDbModule.Connection,
  sql: string,
): Promise<void> => await new Promise((resolvePromise, reject) => {
  let statement: DuckDbModule.Statement;
  statement = connection.run(sql, (runError) => {
    statement.finalize((finalizeError) => {
      if (runError) reject(runError);
      else if (finalizeError) reject(finalizeError);
      else resolvePromise();
    });
  });
});

const ENERGY_FACT_CSV_NULL = "__ENERGYIQ_NULL_99C82A35F37C4EA0__";

const serializeCsvValue = (value: unknown): string => {
  if (value === null) return ENERGY_FACT_CSV_NULL;
  if (typeof value === "string") {
    if (value.includes("\0")) throw new Error("ENERGYIQ_FACT_BULK_STRING_INVALID");
    return `"${value.replaceAll('"', '""')}"`;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("ENERGYIQ_FACT_BULK_NUMBER_INVALID");
    return String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  throw new Error("ENERGYIQ_FACT_BULK_VALUE_INVALID");
};

const requireSqlIdentifier = (value: string): void => {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error("ENERGYIQ_FACT_BULK_IDENTIFIER_INVALID");
};

const normalizeDuckDbFilePath = (value: string): string => resolve(value).replaceAll("\\", "/");
const sqlStringLiteral = (value: string): string => value.replaceAll("'", "''");

const cleanupBulkRoot = (root: string): void => {
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (process.platform !== "win32" || (code !== "EPERM" && code !== "EBUSY")) throw error;
    const retry = setTimeout(() => {
      try {
        rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
      } catch {
        // DuckDB's cached Windows Database handle can release COPY files after this request returns.
      }
    }, 1_000);
    retry.unref();
  }
};

const duckDbRun = async (
  connection: DuckDbModule.Connection,
  sql: string,
  params: unknown[] = [],
): Promise<void> => await new Promise((resolvePromise, reject) => {
  connection.run(sql, ...params, (error) => error ? reject(error) : resolvePromise());
});

const duckDbClose = async (connection: DuckDbModule.Connection): Promise<void> =>
  await new Promise((resolvePromise, reject) => {
    connection.close((error) => error ? reject(error) : resolvePromise());
  });

const duckDbGet = async (
  connection: DuckDbModule.Connection,
  sql: string,
  params: unknown[] = [],
): Promise<Record<string, unknown>> => await new Promise((resolvePromise, reject) => {
  connection.all(sql, ...params, (error: DuckDbModule.DuckDbError | null, rows: DuckDbModule.TableData) => error
    ? reject(error)
    : resolvePromise((rows[0] ?? {}) as Record<string, unknown>));
});

const ignoreAlreadyClosed = (error: unknown): void => {
  if (error instanceof Error && error.message.includes("already closed")) return;
  throw error;
};

const elapsedMs = (startedAt: number): number => roundedMs(performance.now() - startedAt);
const roundedMs = (durationMs: number): number => Math.round(durationMs * 1_000) / 1_000;
