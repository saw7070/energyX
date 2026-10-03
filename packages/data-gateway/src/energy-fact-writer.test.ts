import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getDuckDbDatabase } from "./duckdb-database-cache.js";

import {
  ENERGY_FACT_WRITER_CONTRACT_VERSION,
  probeEnergyFactProjectStateForMaterialization,
  readEnergyFactMaterializationStats,
  readEnergyFactProjectState,
  writeEnergyFactProjectMaterialization,
  type EnergyFactMaterializationBatchWrite,
} from "./energy-fact-writer.js";

const readRows = async (databasePath: string, sql: string): Promise<Record<string, unknown>[]> => {
  const database = await getDuckDbDatabase(databasePath);
  const connection = database.connect();
  try {
    return await new Promise<Record<string, unknown>[]>((resolve, reject) => {
      connection.all(sql, (error, rows) => error ? reject(error) : resolve(rows as Record<string, unknown>[]));
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      connection.close((error) => error ? reject(error) : resolve());
    });
  }
};

describe("writeEnergyFactProjectMaterialization", () => {
  it("treats a pre-integrity v3 state schema as uninitialized for full rematerialization", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-legacy-rematerialization-"));
    const databasePath = join(root, "legacy.duckdb");
    const projectId = "project-legacy-rematerialization";
    try {
      const database = await getDuckDbDatabase(databasePath);
      const connection = database.connect();
      await new Promise<void>((resolve, reject) => {
        connection.run(legacyFactSchemaSql, (error) =>
          error ? reject(error) : resolve());
      });
      await new Promise<void>((resolve, reject) => {
        connection.close((error) => error ? reject(error) : resolve());
      });
      await expect(probeEnergyFactProjectStateForMaterialization({ databasePath, projectId })).resolves.toBeNull();

      const source = boundaryBatch({
        databasePath,
        projectId,
        importBatchId: "legacy-a",
        sourceSha256: "legacy-sha-a",
        readings: [["2026-05-01T00:00:00.000Z", 100], ["2026-05-01T00:15:00.000Z", 101]],
      });
      await writeEnergyFactProjectMaterialization({
        databasePath,
        projectId,
        timezone: "Asia/Singapore",
        expectedPreviousDataSnapshotId: "unavailable",
        snapshotFactScope: testFactScope(projectId, "snapshot-a", ["legacy-sha-a"]),
        batches: [projectBatch(source)],
      });
      await expect(readEnergyFactProjectState({ databasePath, projectId }))
        .resolves.toMatchObject({ dataSnapshotId: "snapshot-a" });
    } finally {
      try {
        rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch (error) {
        if (process.platform !== "win32" || !(error instanceof Error) || !("code" in error)
          || (error.code !== "EPERM" && error.code !== "EBUSY")) throw error;
      }
    }
  });

  it("keeps a regular hourly cumulative series canonical without synthetic quarter-hour facts", async () => {
    const projectId = "project-hourly-cadence";
    const source = boundaryBatch({
      databasePath: ":memory:",
      projectId,
      importBatchId: "hourly-a",
      sourceSha256: "hourly-sha-a",
      readings: [
        ["2026-05-01T00:00:00.000Z", 100],
        ["2026-05-01T01:00:00.000Z", 101.25],
        ["2026-05-01T02:00:00.000Z", 103],
      ],
    });

    const written = await writeEnergyFactProjectMaterialization({
      databasePath: ":memory:",
      projectId,
      timezone: "Asia/Singapore",
      expectedPreviousDataSnapshotId: "unavailable",
      snapshotFactScope: testFactScope(projectId, "snapshot-hourly", [source.sourceSha256]),
      batches: [projectBatch(source)],
    });

    expect(written.projectAudit).toMatchObject({
      intervalFactCount: 2,
      invalidIntervalDurationCount: 0,
      negativeDeltaIntervalCount: 0,
      adjacentReadingPairCount: 2,
      missingAdjacentIntervalCount: 0,
    });
    expect(written.timings).toEqual({
      sourceWriteByBatch: [{
        importBatchId: "hourly-a",
        deleteExistingMs: expect.any(Number),
        historicalMappingMs: expect.any(Number),
        rawWriteMs: expect.any(Number),
        normalizedWriteMs: expect.any(Number),
        intervalWriteMs: expect.any(Number),
        qualityWriteMs: expect.any(Number),
        totalMs: expect.any(Number),
      }],
      sourceWriteMs: expect.any(Number),
      canonicalRebuildMs: expect.any(Number),
      integrityAndCheckpointMs: expect.any(Number),
      totalMs: expect.any(Number),
    });
    expect(Object.values(written.timings).filter((value) => typeof value === "number")
      .every((durationMs) => Number.isFinite(durationMs) && durationMs >= 0)).toBe(true);
    await expect(readEnergyFactMaterializationStats({ databasePath: ":memory:", importBatchId: "hourly-a" }))
      .resolves.toMatchObject({ normalizedRows: 3, intervalFacts: 2, qualityEvents: 1 });
  });

  it("bulk-loads nullable and quoted source values without changing their meaning", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-bulk-value-roundtrip-"));
    const databasePath = join(root, "facts.duckdb");
    const projectId = "project-bulk-value-roundtrip";
    const source = boundaryBatch({
      databasePath,
      projectId,
      importBatchId: "quoted-a",
      sourceSha256: "quoted-sha-a",
      readings: [["2026-05-01T00:00:00.000Z", 100], ["2026-05-01T00:15:00.000Z", 101]],
    });
    const sourceLabel = "Meter, \"North\"\n__ENERGYIQ_NULL_99C82A35F37C4EA0__";
    const batch: EnergyFactMaterializationBatchWrite = {
      ...projectBatch(source),
      normalizedReadings: source.normalizedReadings.map((row) => ({ ...row, sourceLabel })),
      intervalFacts: source.intervalFacts.map((row) => ({ ...row, sourceLabel })),
      rawReadings: [{
        workspaceId: "workspace-1",
        projectId,
        importBatchId: source.importBatchId,
        resource: "electricity",
        sourceLabel,
        meterPointId: "meter-a",
        scopeId: "scope-a",
        eventTime: "2026-05-01T00:00:00.000Z",
        activeEnergyKwh: 100,
        sourceFile: "quoted,a.xlsx",
        sourceSha256: source.sourceSha256,
        sourceRowNumber: 2,
        isValid: true,
        validationError: "",
        isOverlapConflict: false,
      }],
      qualityEvents: [{
        workspaceId: "workspace-1",
        projectId,
        importBatchId: source.importBatchId,
        meterPointId: "meter-a",
        sourceLabel,
        eventTime: "2026-05-01T00:00:00.000Z",
        code: "quoted_value",
        severity: "warning",
        details: { note: "comma, quote \" and newline\nremain exact" },
        sourceReadingKind: "cumulative_energy",
      }],
    };
    try {
      await writeEnergyFactProjectMaterialization({
        databasePath,
        projectId,
        timezone: "Asia/Singapore",
        expectedPreviousDataSnapshotId: "unavailable",
        snapshotFactScope: testFactScope(projectId, "snapshot-quoted", [source.sourceSha256]),
        batches: [batch],
      });
      await expect(readRows(databasePath, `
        SELECT device_name, validation_error, source_file
        FROM raw_meter_readings WHERE project_id = '${projectId}'
      `)).resolves.toEqual([{ device_name: sourceLabel, validation_error: "", source_file: "quoted,a.xlsx" }]);
      await expect(readRows(databasePath, `
        SELECT device_name FROM energy_source_normalized_readings WHERE project_id = '${projectId}' LIMIT 1
      `)).resolves.toEqual([{ device_name: sourceLabel }]);
      await expect(readRows(databasePath, `
        SELECT source_label, details_json::VARCHAR AS details_json
        FROM energy_source_quality_events WHERE project_id = '${projectId}'
      `)).resolves.toEqual([{
        source_label: sourceLabel,
        details_json: JSON.stringify({ note: "comma, quote \" and newline\nremain exact" }),
      }]);
    } finally {
      try {
        rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch (error) {
        if (process.platform !== "win32" || !(error instanceof Error) || !("code" in error)
          || (error.code !== "EPERM" && error.code !== "EBUSY")) throw error;
      }
    }
  });

  it.each([
    { label: "empty", sourceSha256: [], batches: [] },
    {
      label: "duplicate",
      sourceSha256: ["duplicate-sha", "duplicate-sha"],
      batches: [projectBatch(boundaryBatch({
        databasePath: ":memory:",
        projectId: "project-invalid-manifest",
        importBatchId: "duplicate-a",
        sourceSha256: "duplicate-sha",
        readings: [["2026-05-01T00:00:00.000Z", 100], ["2026-05-01T00:15:00.000Z", 101]],
      }))],
    },
  ])("rejects a $label Project source manifest", async ({ sourceSha256, batches }) => {
    await expect(writeEnergyFactProjectMaterialization({
      databasePath: ":memory:",
      projectId: "project-invalid-manifest",
      timezone: "Asia/Singapore",
      expectedPreviousDataSnapshotId: "unavailable",
      snapshotFactScope: testFactScope("project-invalid-manifest", "snapshot-invalid", sourceSha256),
      batches,
    })).rejects.toThrow("ENERGYIQ_SNAPSHOT_MANIFEST_MATERIALIZATION_INCOMPLETE");
  });

  it("rejects rows whose provenance does not match the declared batch source", async () => {
    const source = boundaryBatch({
      databasePath: ":memory:",
      projectId: "project-row-provenance",
      importBatchId: "provenance-a",
      sourceSha256: "provenance-sha-a",
      readings: [["2026-05-01T00:00:00.000Z", 100], ["2026-05-01T00:15:00.000Z", 101]],
    });
    const contaminated = {
      ...source,
      normalizedReadings: source.normalizedReadings.map((row, index) => index === 0
        ? { ...row, sourceSha256: "provenance-sha-b" }
        : row),
    };
    await expect(writeEnergyFactProjectMaterialization({
      databasePath: ":memory:",
      projectId: source.projectId,
      timezone: source.timezone,
      expectedPreviousDataSnapshotId: "unavailable",
      snapshotFactScope: testFactScope(source.projectId, "snapshot-a", [source.sourceSha256]),
      batches: [projectBatch(contaminated)],
    })).rejects.toThrow("ENERGYIQ_SNAPSHOT_FACT_SCOPE_MISMATCH");
  });

  it("fails closed instead of recreating a missing canonical table on a read", async () => {
    const databasePath = ":memory:";
    const projectId = "project-damaged-canonical-table";
    const source = boundaryBatch({
      databasePath,
      projectId,
      importBatchId: "damaged-a",
      sourceSha256: "damaged-sha-a",
      readings: [["2026-05-01T00:00:00.000Z", 100], ["2026-05-01T00:15:00.000Z", 101]],
    });
    await writeEnergyFactProjectMaterialization({
      databasePath,
      projectId,
      timezone: "Asia/Singapore",
      expectedPreviousDataSnapshotId: "unavailable",
      snapshotFactScope: testFactScope(projectId, "snapshot-a", ["damaged-sha-a"]),
      batches: [projectBatch(source)],
    });
    const database = await getDuckDbDatabase(databasePath);
    const connection = database.connect();
    await new Promise<void>((resolve, reject) => {
      connection.run("DROP TABLE energy_interval_facts", (error) => error ? reject(error) : resolve());
    });
    await new Promise<void>((resolve, reject) => {
      connection.close((error) => error ? reject(error) : resolve());
    });

    await expect(readEnergyFactProjectState({ databasePath, projectId }))
      .rejects.toThrow("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
  });

  it("maps malformed persisted fact state to the stable unavailable error", async () => {
    const databasePath = ":memory:";
    const projectId = "project-malformed-fact-state";
    const source = boundaryBatch({
      databasePath,
      projectId,
      importBatchId: "malformed-a",
      sourceSha256: "malformed-sha-a",
      readings: [["2026-05-01T00:00:00.000Z", 100], ["2026-05-01T00:15:00.000Z", 101]],
    });
    await writeEnergyFactProjectMaterialization({
      databasePath,
      projectId,
      timezone: "Asia/Singapore",
      expectedPreviousDataSnapshotId: "unavailable",
      snapshotFactScope: testFactScope(projectId, "snapshot-a", ["malformed-sha-a"]),
      batches: [projectBatch(source)],
    });
    const database = await getDuckDbDatabase(databasePath);
    const connection = database.connect();
    await new Promise<void>((resolve, reject) => {
      connection.run(
        `UPDATE energy_project_fact_state SET source_sha256_json = '{"bad":true}' WHERE project_id = ?`,
        projectId,
        (error) => error ? reject(error) : resolve(),
      );
    });
    await new Promise<void>((resolve, reject) => {
      connection.close((error) => error ? reject(error) : resolve());
    });

    await expect(readEnergyFactProjectState({ databasePath, projectId }))
      .rejects.toThrow("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
  });

  it("writes a complete manifest atomically and rejects a new write over an uncompleted fact state", async () => {
    const databasePath = ":memory:";
    const projectId = "project-full-manifest";
    const sourceA = boundaryBatch({
      databasePath,
      projectId,
      importBatchId: "full-a",
      sourceSha256: "full-sha-a",
      readings: [["2026-05-01T00:00:00.000Z", 100], ["2026-05-01T00:15:00.000Z", 101]],
    });
    const sourceB = boundaryBatch({
      databasePath,
      projectId,
      importBatchId: "full-b",
      sourceSha256: "full-sha-b",
      readings: [["2026-05-01T00:30:00.000Z", 102], ["2026-05-01T00:45:00.000Z", 103]],
    });
    const snapshotB = testFactScope(projectId, "snapshot-b", ["full-sha-a", "full-sha-b"]);
    const writtenB = await writeEnergyFactProjectMaterialization({
      databasePath,
      projectId,
      timezone: "Asia/Singapore",
      expectedPreviousDataSnapshotId: "unavailable",
      snapshotFactScope: snapshotB,
      batches: [projectBatch(sourceA), projectBatch(sourceB)],
    });
    expect(writtenB.projectAudit.intervalFactCount).toBe(3);

    const sourceC = boundaryBatch({
      databasePath,
      projectId,
      importBatchId: "full-c",
      sourceSha256: "full-sha-c",
      readings: [["2026-05-01T01:00:00.000Z", 104], ["2026-05-01T01:15:00.000Z", 105]],
    });
    await expect(writeEnergyFactProjectMaterialization({
      databasePath,
      projectId,
      timezone: "Asia/Singapore",
      expectedPreviousDataSnapshotId: "snapshot-a",
      snapshotFactScope: testFactScope(projectId, "snapshot-c", ["full-sha-c"]),
      batches: [projectBatch(sourceC)],
    })).rejects.toThrow("ENERGYIQ_SNAPSHOT_STALE:snapshot-b");
    await expect(readEnergyFactProjectState({ databasePath, projectId })).resolves.toMatchObject({
      dataSnapshotId: "snapshot-b",
    });
  });

  it("canonicalizes only the prepared manifest sources and commits their Project fact state", async () => {
    const databasePath = ":memory:";
    const projectId = "project-manifest-scope";
    const sourceC = boundaryBatch({
      databasePath,
      projectId,
      importBatchId: "batch-c",
      sourceSha256: "sha-c",
      readings: [
        ["2026-05-01T01:00:00.000Z", 500],
        ["2026-05-01T01:15:00.000Z", 501],
      ],
    });
    const sourceA = boundaryBatch({
      databasePath,
      projectId,
      importBatchId: "batch-a",
      sourceSha256: "sha-a",
      readings: [
        ["2026-05-01T00:00:00.000Z", 100],
        ["2026-05-01T00:15:00.000Z", 101],
      ],
    });
    const sourceB = boundaryBatch({
      databasePath,
      projectId,
      importBatchId: "batch-b",
      sourceSha256: "sha-b",
      readings: [
        ["2026-05-01T00:30:00.000Z", 102],
        ["2026-05-01T00:45:00.000Z", 103],
      ],
    });

    await writeProjectSnapshot(sourceC, [sourceC], "snapshot-c", ["sha-c"], "unavailable");
    await writeProjectSnapshot(sourceA, [sourceA], "snapshot-a", ["sha-a"], "snapshot-c");
    const result = await writeProjectSnapshot(
      sourceB,
      [sourceA, sourceB],
      "snapshot-ab",
      ["sha-a", "sha-b"],
      "snapshot-a",
    );

    expect(result.projectAudit.intervalFactCount).toBe(3);
    await expect(readEnergyFactProjectState({ databasePath, projectId })).resolves.toMatchObject({
      workspaceId: "workspace-1",
      projectId,
      dataSnapshotId: "snapshot-ab",
      manifestFingerprint: "fingerprint-snapshot-ab",
      sourceSha256: ["sha-a", "sha-b"],
      factWriterContractVersion: ENERGY_FACT_WRITER_CONTRACT_VERSION,
      canonicalIntervalCount: 3,
      canonicalIntervalDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
  });

  it("excludes retained off-manifest raw evidence from active overlap audit", async () => {
    const databasePath = ":memory:";
    const projectId = "project-active-raw-audit";
    const withRaw = (input: ReturnType<typeof boundaryBatch>) => ({
      ...input,
      rawReadings: input.normalizedReadings.map((reading) => ({
        workspaceId: reading.workspaceId,
        projectId: reading.projectId,
        importBatchId: reading.importBatchId,
        resource: reading.resource,
        sourceLabel: reading.sourceLabel,
        meterPointId: reading.meterPointId,
        scopeId: reading.scopeId,
        eventTime: reading.eventTime,
        activeEnergyKwh: reading.activeEnergyKwh,
        sourceFile: reading.sourceFile,
        sourceSha256: reading.sourceSha256,
        sourceRowNumber: reading.sourceRowNumber,
        sourceReadingKind: reading.sourceReadingKind,
        isValid: true,
        isOverlapConflict: false,
      })),
    });
    const sourceA = withRaw(boundaryBatch({
      databasePath,
      projectId,
      importBatchId: "audit-a",
      sourceSha256: "audit-sha-a",
      readings: [["2026-05-01T00:00:00.000Z", 100], ["2026-05-01T00:15:00.000Z", 101]],
    }));
    const sourceB = withRaw(boundaryBatch({
      databasePath,
      projectId,
      importBatchId: "audit-b",
      sourceSha256: "audit-sha-b",
      readings: [["2026-05-01T00:15:00.000Z", 100.9], ["2026-05-01T00:30:00.000Z", 101.9]],
    }));

    const both = await writeEnergyFactProjectMaterialization({
      databasePath,
      projectId,
      timezone: "Asia/Singapore",
      expectedPreviousDataSnapshotId: "unavailable",
      snapshotFactScope: testFactScope(projectId, "snapshot-a-b", ["audit-sha-a", "audit-sha-b"]),
      batches: [projectBatch(sourceA), projectBatch(sourceB)],
    });
    expect(both.projectAudit.rawOverlapConflictCount).toBe(2);

    const activeA = await writeEnergyFactProjectMaterialization({
      databasePath,
      projectId,
      timezone: "Asia/Singapore",
      expectedPreviousDataSnapshotId: "snapshot-a-b",
      snapshotFactScope: testFactScope(projectId, "snapshot-a", ["audit-sha-a"]),
      batches: [projectBatch(sourceA)],
    });
    expect(activeA.projectAudit).toMatchObject({ rawRowCount: 2, rawOverlapConflictCount: 0 });
    await expect(readEnergyFactMaterializationStats({ databasePath, importBatchId: "audit-b" }))
      .resolves.toMatchObject({ rawRows: 2 });
  });

  it("restores the manifest winner after an off-manifest source previously replaced it", async () => {
    const databasePath = ":memory:";
    const projectId = "project-manifest-winner-restore";
    const sourceA = boundaryBatch({
      databasePath,
      projectId,
      importBatchId: "restore-a",
      sourceSha256: "restore-sha-a",
      readings: [
        ["2026-05-01T00:00:00.000Z", 100],
        ["2026-05-01T00:15:00.000Z", 101],
        ["2026-05-01T00:30:00.000Z", 102],
      ],
    });
    const sourceB = boundaryBatch({
      databasePath,
      projectId,
      importBatchId: "restore-b",
      sourceSha256: "restore-sha-b",
      readings: [
        ["2026-05-01T00:15:00.000Z", 100.9],
        ["2026-05-01T00:30:00.000Z", 101.9],
        ["2026-05-01T00:45:00.000Z", 102.9],
      ],
    });
    const sourceC = boundaryBatch({
      databasePath,
      projectId,
      importBatchId: "restore-c",
      sourceSha256: "restore-sha-c",
      readings: [
        ["2026-05-01T00:15:00.000Z", 100.8],
        ["2026-05-01T00:30:00.000Z", 101.8],
        ["2026-05-01T00:45:00.000Z", 102.8],
        ["2026-05-01T01:00:00.000Z", 103.8],
      ],
    });

    await writeProjectSnapshot(sourceA, [sourceA], "snapshot-a", ["restore-sha-a"], "unavailable");
    const original = await writeProjectSnapshot(
      sourceB,
      [sourceA, sourceB],
      "snapshot-ab",
      ["restore-sha-a", "restore-sha-b"],
      "snapshot-a",
    );
    await writeProjectSnapshot(
      sourceC,
      [sourceA, sourceB, sourceC],
      "snapshot-abc",
      ["restore-sha-a", "restore-sha-b", "restore-sha-c"],
      "snapshot-ab",
    );
    const restored = await writeProjectSnapshot(
      sourceA,
      [sourceA, sourceB],
      "snapshot-ab-restored",
      ["restore-sha-a", "restore-sha-b"],
      "snapshot-abc",
    );

    expect(restored.projectAudit).toEqual(original.projectAudit);
  });

  it("rebuilds the interval that crosses adjacent canonical batch boundaries", async () => {
    const databasePath = ":memory:";
    const projectId = "project-cross-batch-boundary";

    const earlier = boundaryBatch({
      databasePath,
      projectId,
      importBatchId: "batch-a",
      sourceSha256: "sha-a",
      readings: [
        ["2026-05-01T00:00:00.000Z", 100],
        ["2026-05-01T00:15:00.000Z", 101],
      ],
    });
    const later = boundaryBatch({
      databasePath,
      projectId,
      importBatchId: "batch-b",
      sourceSha256: "sha-b",
      readings: [
        ["2026-05-01T00:30:00.000Z", 102],
        ["2026-05-01T00:45:00.000Z", 103],
      ],
    });
    await writeProjectSnapshot(earlier, [earlier], "snapshot-a", ["sha-a"], "unavailable");
    const result = await writeProjectSnapshot(
      later,
      [earlier, later],
      "snapshot-ab",
      ["sha-a", "sha-b"],
      "snapshot-a",
    );

    expect(result.projectAudit).toMatchObject({
      normalizedReadingCount: 4,
      intervalFactCount: 3,
      invalidIntervalDurationCount: 0,
      negativeDeltaIntervalCount: 0,
      canonicalMeterSeriesCount: 1,
      adjacentReadingPairCount: 3,
      missingAdjacentIntervalCount: 0,
      orphanIntervalFactCount: 0,
    });
    await expect(writeProjectSnapshot(
      earlier,
      [earlier, later],
      "snapshot-ab",
      ["sha-a", "sha-b"],
      "snapshot-ab",
    )).resolves.toMatchObject({
      projectAudit: result.projectAudit,
    });

    const reverseProjectId = "project-cross-batch-boundary-reverse";
    const reverseEarlier = withProjectId(earlier, reverseProjectId);
    const reverseLater = withProjectId(later, reverseProjectId);
    await writeProjectSnapshot(reverseLater, [reverseLater], "snapshot-b", ["sha-b"], "unavailable");
    const reverse = await writeProjectSnapshot(
      reverseEarlier,
      [reverseEarlier, reverseLater],
      "snapshot-reverse-ab",
      ["sha-a", "sha-b"],
      "snapshot-b",
    );
    expect(reverse.projectAudit).toEqual(result.projectAudit);
  });

  it("resamples Tuya event-time cumulative readings across Import Batch boundaries", async () => {
    const databasePath = ":memory:";
    const projectId = "project-tuya-cross-batch";
    const earlier = eventBatch({
      databasePath,
      projectId,
      importBatchId: "tuya-event-a",
      sourceSha256: "tuya-event-sha-a",
      readings: [
        ["2026-05-01T00:05:00.000Z", 100],
        ["2026-05-01T00:20:00.000Z", 100.3],
      ],
    });
    const later = eventBatch({
      databasePath,
      projectId,
      importBatchId: "tuya-event-b",
      sourceSha256: "tuya-event-sha-b",
      readings: [
        ["2026-05-01T00:35:00.000Z", 100.9],
        ["2026-05-01T00:50:00.000Z", 101.5],
      ],
    });

    const result = await writeProjectSnapshot(
      later,
      [earlier, later],
      "snapshot-tuya-event-ab",
      [earlier.sourceSha256, later.sourceSha256],
      "unavailable",
    );

    expect(result.projectAudit).toMatchObject({
      normalizedReadingCount: 4,
      intervalFactCount: 2,
      invalidIntervalDurationCount: 0,
      negativeDeltaIntervalCount: 0,
      missingAdjacentIntervalCount: 0,
      orphanIntervalFactCount: 0,
    });
    const facts = await readCanonicalIntervals(databasePath, projectId);
    expect(facts).toEqual([
      expect.objectContaining({
        import_batch_id: "tuya-event-b",
        source_reading_kind: "interval_usage",
        interval_start: new Date("2026-05-01T00:15:00.000Z"),
        interval_end: new Date("2026-05-01T00:30:00.000Z"),
        elapsed_minutes: 15,
        usage_kwh: expect.closeTo(0.5, 8),
        average_kw: expect.closeTo(2, 8),
        quality_status: "ok",
      }),
      expect.objectContaining({
        import_batch_id: "tuya-event-b",
        source_reading_kind: "interval_usage",
        interval_start: new Date("2026-05-01T00:30:00.000Z"),
        interval_end: new Date("2026-05-01T00:45:00.000Z"),
        elapsed_minutes: 15,
        usage_kwh: expect.closeTo(0.6, 8),
        average_kw: expect.closeTo(2.4, 8),
        quality_status: "ok",
      }),
    ]);
  });

  it("keeps energy counted during a Tuya outage as an estimate, but a quiet idle spell as real readings", async () => {
    const databasePath = ":memory:";
    const projectId = "project-tuya-outage";
    const batch = eventBatch({
      databasePath,
      projectId,
      importBatchId: "tuya-outage",
      sourceSha256: "tuya-outage-sha",
      readings: [
        ["2026-05-01T00:00:00.000Z", 100],
        ["2026-05-01T01:00:00.000Z", 100.2],
        // Offline for 6 hours; the first reading back carries the 3 kWh used meanwhile.
        ["2026-05-01T07:00:00.000Z", 103.2],
        ["2026-05-01T08:00:00.000Z", 103.4],
        // Idle for 5 hours: almost nothing used, so nothing is missing.
        ["2026-05-01T13:00:00.000Z", 103.41],
      ],
    });

    await writeProjectSnapshot(batch, [batch], "snapshot-tuya-outage", [batch.sourceSha256], "unavailable");

    const facts = await readCanonicalIntervals(databasePath, projectId);
    const statusAt = (iso: string) => facts.find((fact) => (fact.interval_start as Date).toISOString() === iso)?.quality_status;
    expect(statusAt("2026-05-01T00:45:00.000Z")).toBe("ok");
    expect(statusAt("2026-05-01T01:00:00.000Z")).toBe("gap");
    expect(statusAt("2026-05-01T06:45:00.000Z")).toBe("gap");
    expect(statusAt("2026-05-01T07:00:00.000Z")).toBe("ok");
    expect(statusAt("2026-05-01T10:00:00.000Z")).toBe("ok");
    // The estimate still adds up to what the meter counted.
    const estimated = facts.filter((fact) => fact.quality_status === "gap");
    expect(estimated).toHaveLength(24);
    expect(estimated.reduce((sum, fact) => sum + Number(fact.usage_kwh), 0)).toBeCloseTo(3, 6);

    const database = await getDuckDbDatabase(databasePath);
    const connection = database.connect();
    try {
      const events = await new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
        connection.all(`SELECT code, CAST(details_json AS VARCHAR) AS details FROM energy_quality_events WHERE project_id = ? AND code = 'gap'`, projectId,
          (error, rows) => error ? reject(error) : resolve(rows as Array<Record<string, unknown>>));
      });
      expect(events).toHaveLength(1);
      expect(JSON.parse(String(events[0]!.details))).toMatchObject({ elapsedMinutes: 360, rawDeltaKwh: expect.closeTo(3, 6), reason: "offline_catch_up_estimated" });
    } finally {
      await new Promise<void>((resolve, reject) => connection.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("keeps project-wide cumulative gaps aggregate-eligible without making them cadence-eligible", async () => {
    const databasePath = ":memory:";
    const projectId = "project-cross-batch-quality";
    const sourceA = boundaryBatch({
      databasePath,
      projectId,
      importBatchId: "quality-a",
      sourceSha256: "quality-sha-a",
      readings: [
        ["2026-05-01T00:00:00.000Z", 100],
        ["2026-05-01T00:15:00.000Z", 101],
      ],
    });
    const sourceB = boundaryBatch({
      databasePath,
      projectId,
      importBatchId: "quality-b",
      sourceSha256: "quality-sha-b",
      readings: [
        ["2026-05-01T00:45:00.000Z", 102],
        ["2026-05-01T01:00:00.000Z", 90],
        ["2026-05-01T01:15:00.000Z", 91],
      ],
    });
    await writeProjectSnapshot(sourceA, [sourceA], "snapshot-quality-a", ["quality-sha-a"], "unavailable");
    const result = await writeProjectSnapshot(
      sourceB,
      [sourceA, sourceB],
      "snapshot-quality-ab",
      ["quality-sha-a", "quality-sha-b"],
      "snapshot-quality-a",
    );

    expect(result.projectAudit).toMatchObject({
      normalizedReadingCount: 5,
      intervalFactCount: 4,
      invalidIntervalDurationCount: 0,
      cadenceGapIntervalCount: 1,
      negativeDeltaIntervalCount: 1,
      canonicalMeterSeriesCount: 1,
      adjacentReadingPairCount: 4,
      missingAdjacentIntervalCount: 0,
      orphanIntervalFactCount: 0,
    });
    await expect(readEnergyFactMaterializationStats({ databasePath, importBatchId: "quality-a" }))
      .resolves.toMatchObject({ intervalFacts: 1, qualityEvents: 1 });
    await expect(readEnergyFactMaterializationStats({ databasePath, importBatchId: "quality-b" }))
      .resolves.toMatchObject({ intervalFacts: 3, qualityEvents: 2 });

    const facts = await readRows(databasePath, `
      SELECT elapsed_minutes, raw_delta_kwh, usage_kwh, average_kw, quality_status
      FROM energy_interval_facts
      WHERE project_id = '${projectId}'
      ORDER BY interval_start
    `);
    expect(facts).toEqual([
      { elapsed_minutes: 15, raw_delta_kwh: 1, usage_kwh: 1, average_kw: 4, quality_status: "ok" },
      { elapsed_minutes: 30, raw_delta_kwh: 1, usage_kwh: 1, average_kw: 2, quality_status: "gap" },
      { elapsed_minutes: 15, raw_delta_kwh: -12, usage_kwh: null, average_kw: null, quality_status: "negative_delta" },
      { elapsed_minutes: 15, raw_delta_kwh: 1, usage_kwh: 1, average_kw: 4, quality_status: "ok" },
    ]);

    const daily = await readRows(databasePath, `
      SELECT usage_kwh, peak_average_kw, valid_interval_count, quality_event_count
      FROM energy_daily_facts
      WHERE project_id = '${projectId}'
    `);
    expect(daily).toEqual([{ usage_kwh: 3, peak_average_kw: 4, valid_interval_count: 2n, quality_event_count: 2n }]);
  });

  it("rebuilds from the later-coverage canonical winner at overlapping cumulative timestamps", async () => {
    const databasePath = ":memory:";
    const projectId = "project-cumulative-overlap";
    const earlier = boundaryBatch({
      databasePath,
      projectId,
      importBatchId: "cumulative-earlier",
      sourceSha256: "cumulative-sha-earlier",
      readings: [
        ["2026-05-01T00:00:00.000Z", 100],
        ["2026-05-01T00:15:00.000Z", 101],
        ["2026-05-01T00:30:00.000Z", 102],
      ],
    });
    const later = boundaryBatch({
      databasePath,
      projectId,
      importBatchId: "cumulative-later",
      sourceSha256: "cumulative-sha-later",
      readings: [
        ["2026-05-01T00:15:00.000Z", 100.9],
        ["2026-05-01T00:30:00.000Z", 101.9],
        ["2026-05-01T00:45:00.000Z", 102.9],
      ],
    });
    await writeProjectSnapshot(later, [later], "snapshot-cumulative-later", ["cumulative-sha-later"], "unavailable");
    const result = await writeProjectSnapshot(
      earlier,
      [earlier, later],
      "snapshot-cumulative-ab",
      ["cumulative-sha-earlier", "cumulative-sha-later"],
      "snapshot-cumulative-later",
    );

    expect(result.projectAudit).toMatchObject({
      normalizedReadingCount: 4,
      intervalFactCount: 3,
      adjacentReadingPairCount: 3,
      missingAdjacentIntervalCount: 0,
      orphanIntervalFactCount: 0,
    });
    await expect(readEnergyFactMaterializationStats({ databasePath, importBatchId: "cumulative-later" }))
      .resolves.toMatchObject({ normalizedRows: 3, intervalFacts: 3 });
    await expect(readEnergyFactMaterializationStats({ databasePath, importBatchId: "cumulative-earlier" }))
      .resolves.toMatchObject({ normalizedRows: 1, intervalFacts: 0 });

    const forwardProjectId = "project-cumulative-overlap-forward";
    const forwardEarlier = withProjectId(earlier, forwardProjectId);
    const forwardLater = withProjectId(later, forwardProjectId);
    await writeProjectSnapshot(forwardEarlier, [forwardEarlier], "snapshot-cumulative-forward-a", ["cumulative-sha-earlier"], "unavailable");
    const forward = await writeProjectSnapshot(
      forwardLater,
      [forwardEarlier, forwardLater],
      "snapshot-cumulative-forward-ab",
      ["cumulative-sha-earlier", "cumulative-sha-later"],
      "snapshot-cumulative-forward-a",
    );
    expect(forward.projectAudit).toEqual(result.projectAudit);
  });

  it("writes a batch idempotently into the canonical fact tables", async () => {
    const input = {
      databasePath: ":memory:",
      projectId: "project-1",
      importBatchId: "batch-1",
      sourceSha256: "sha-1",
      timezone: "Asia/Singapore",
      rawReadings: [{
        workspaceId: "workspace-1",
        projectId: "project-1",
        importBatchId: "batch-1",
        resource: "electricity" as const,
        sourceLabel: "Meter A",
        meterPointId: "meter-a",
        scopeId: "scope-a",
        eventTime: "2026-05-01T00:00:00.000Z",
        activeEnergyKwh: 100,
        sourceFile: "meter.xlsx",
        sourceSha256: "sha-1",
        sourceRowNumber: 2,
        sourceReadingKind: "interval_usage" as const,
        isValid: true,
        isOverlapConflict: false,
      }],
      normalizedReadings: [{
        workspaceId: "workspace-1",
        projectId: "project-1",
        importBatchId: "batch-1",
        resource: "electricity" as const,
        meterPointId: "meter-a",
        scopeId: "scope-a",
        sourceLabel: "Meter A",
        category: "load",
        meterRole: "total",
        eventTime: "2026-05-01T00:00:00.000Z",
        activeEnergyKwh: 100,
        sourceFile: "meter.xlsx",
        sourceSha256: "sha-1",
        sourceReadingKind: "interval_usage" as const,
        sourceRowNumber: 2,
      }],
      intervalFacts: [{
        workspaceId: "workspace-1",
        projectId: "project-1",
        importBatchId: "batch-1",
        resource: "electricity" as const,
        meterPointId: "meter-a",
        scopeId: "scope-a",
        sourceLabel: "Meter A",
        category: "load",
        meterRole: "total",
        intervalStart: "2026-05-01T00:00:00.000Z",
        intervalEnd: "2026-05-01T00:15:00.000Z",
        elapsedMinutes: 15,
        activeEnergyKwh: 100.5,
        previousActiveEnergyKwh: 100,
        rawDeltaKwh: 0.5,
        usageKwh: 0.5,
        averageKw: 2,
        qualityStatus: "ok",
        localDate: "2026-05-01",
        localHour: 8,
        dayType: "weekday",
        sourceFile: "meter.xlsx",
        sourceSha256: "sha-1",
        sourceReadingKind: "interval_usage" as const,
      }],
      qualityEvents: [{
        workspaceId: "workspace-1",
        projectId: "project-1",
        importBatchId: "batch-1",
        meterPointId: "meter-a",
        sourceLabel: "Meter A",
        eventTime: "2026-05-01T00:00:00.000Z",
        code: "boundary",
        severity: "warning" as const,
        details: {},
        sourceReadingKind: "interval_usage" as const,
      }],
      snapshotFactScope: testFactScope("project-1", "snapshot-1", ["sha-1"]),
    };

    await writeProjectSnapshot(input, [input], "snapshot-1", ["sha-1"], "unavailable");
    await writeProjectSnapshot(input, [input], "snapshot-1", ["sha-1"], "snapshot-1");
    await expect(readEnergyFactMaterializationStats({
      databasePath: ":memory:",
      importBatchId: "batch-1",
    })).resolves.toEqual({ rawRows: 1, normalizedRows: 1, intervalFacts: 1, qualityEvents: 1 });
    const legacyProjectId = "project-legacy";
    const invalid = {
      ...input,
      projectId: legacyProjectId,
      importBatchId: "",
      sourceSha256: "",
      snapshotFactScope: testFactScope(legacyProjectId, "snapshot-legacy", [""]),
      rawReadings: input.rawReadings.map((row) => ({
        ...row,
        projectId: legacyProjectId,
        importBatchId: "",
        sourceSha256: "",
        sourceFile: "synthetic-legacy.xlsx",
        isValid: null as unknown as boolean,
      })),
      normalizedReadings: input.normalizedReadings.map((row) => ({
        ...row,
        projectId: legacyProjectId,
        importBatchId: "",
        sourceSha256: "",
        sourceFile: "synthetic-legacy.xlsx",
      })),
      intervalFacts: input.intervalFacts.map((row) => ({
        ...row,
        projectId: legacyProjectId,
        importBatchId: "",
        sourceSha256: "",
        sourceFile: "synthetic-legacy.xlsx",
        qualityStatus: "negative_delta",
      })),
      qualityEvents: [],
    };
    await expect(writeProjectSnapshot(
      invalid,
      [invalid],
      "snapshot-legacy",
      [""],
      "unavailable",
    )).rejects.toThrow("ENERGYIQ_SNAPSHOT_FACT_SCOPE_EMPTY");
  });

  it("keeps the source with the later coverage end at an overlapping timestamp", async () => {
    const databasePath = ":memory:";
    const base = {
      databasePath,
      projectId: "project-overlap",
      timezone: "Asia/Singapore",
      qualityEvents: [],
    };
    const raw = (batch: string, sha: string, time: string, value: number, projectId = "project-overlap") => ({
      workspaceId: "workspace-1",
      projectId,
      importBatchId: batch,
      resource: "electricity" as const,
      sourceLabel: "Meter A",
      meterPointId: "meter-a",
      scopeId: "scope-a",
      eventTime: time,
      activeEnergyKwh: value,
      sourceFile: `${batch}.xlsx`,
      sourceSha256: sha,
      sourceRowNumber: 2,
      sourceReadingKind: "interval_usage" as const,
      isValid: true,
      isOverlapConflict: false,
    });
    const normalized = (batch: string, sha: string, time: string, value: number, projectId = "project-overlap") => ({
      workspaceId: "workspace-1",
      projectId,
      importBatchId: batch,
      resource: "electricity" as const,
      meterPointId: "meter-a",
      scopeId: "scope-a",
      sourceLabel: "Meter A",
      category: "load",
      meterRole: "total",
      eventTime: time,
      activeEnergyKwh: value,
      sourceFile: `${batch}.xlsx`,
      sourceSha256: sha,
      sourceReadingKind: "interval_usage" as const,
      sourceRowNumber: 2,
    });
    const fact = (batch: string, sha: string, start: string, end: string, usage: number, projectId = "project-overlap") => ({
      workspaceId: "workspace-1",
      projectId,
      importBatchId: batch,
      resource: "electricity" as const,
      meterPointId: "meter-a",
      scopeId: "scope-a",
      sourceLabel: "Meter A",
      category: "load",
      meterRole: "total",
      intervalStart: start,
      intervalEnd: end,
      elapsedMinutes: 15,
      activeEnergyKwh: 101,
      previousActiveEnergyKwh: 100,
      rawDeltaKwh: usage,
      usageKwh: usage,
      averageKw: usage * 4,
      qualityStatus: "ok",
      localDate: "2026-05-01",
      localHour: 8,
      dayType: "weekday",
      sourceFile: `${batch}.xlsx`,
      sourceSha256: sha,
      sourceReadingKind: "interval_usage" as const,
    });

    const laterBatch = {
      ...base,
      importBatchId: "later",
      sourceSha256: "sha-later",
      rawReadings: [
        raw("later", "sha-later", "2026-05-01T00:15:00.000Z", 101),
        raw("later", "sha-later", "2026-05-01T00:30:00.000Z", 102),
      ],
      normalizedReadings: [
        normalized("later", "sha-later", "2026-05-01T00:15:00.000Z", 101),
        normalized("later", "sha-later", "2026-05-01T00:30:00.000Z", 102),
      ],
      intervalFacts: [
        fact("later", "sha-later", "2026-05-01T00:00:00.000Z", "2026-05-01T00:15:00.000Z", 1),
        fact("later", "sha-later", "2026-05-01T00:15:00.000Z", "2026-05-01T00:30:00.000Z", 1),
      ],
    };
    const earlierBatch = {
      ...base,
      importBatchId: "earlier",
      sourceSha256: "sha-earlier",
      rawReadings: [
        raw("earlier", "sha-earlier", "2026-05-01T00:15:00.000Z", 100.9),
      ],
      normalizedReadings: [
        normalized("earlier", "sha-earlier", "2026-05-01T00:15:00.000Z", 100.9),
      ],
      intervalFacts: [
        fact("earlier", "sha-earlier", "2026-05-01T00:00:00.000Z", "2026-05-01T00:15:00.000Z", 0.9),
      ],
    };
    await writeProjectSnapshot(laterBatch, [laterBatch], "snapshot-later", ["sha-later"], "unavailable");
    const materialized = await writeProjectSnapshot(
      earlierBatch,
      [earlierBatch, laterBatch],
      "snapshot-overlap",
      ["sha-earlier", "sha-later"],
      "snapshot-later",
    );

    await expect(readEnergyFactMaterializationStats({ databasePath, importBatchId: "later" }))
      .resolves.toMatchObject({ normalizedRows: 2, intervalFacts: 2 });
    await expect(readEnergyFactMaterializationStats({ databasePath, importBatchId: "earlier" }))
      .resolves.toMatchObject({ normalizedRows: 0, intervalFacts: 0 });
    expect(materialized.projectAudit).toEqual({
      rawRowCount: 3,
      invalidRawRowCount: 0,
      unmappedRawRowCount: 0,
      rawOverlapConflictCount: 2,
      normalizedReadingCount: 2,
      intervalFactCount: 2,
      duplicateNormalizedReadingCount: 0,
      duplicateIntervalFactCount: 0,
      invalidIntervalDurationCount: 0,
      cadenceGapIntervalCount: 0,
      negativeDeltaIntervalCount: 0,
      legacyRawRowCount: 0,
      legacyNormalizedReadingCount: 0,
      legacyIntervalFactCount: 0,
      legacyCanonicalRowCount: 0,
      canonicalMeterSeriesCount: 0,
      adjacentReadingPairCount: 0,
      missingAdjacentIntervalCount: 0,
      orphanIntervalFactCount: 0,
    });

    const reverseProjectId = "project-overlap-reverse";
    const reverseEarlierBatch = {
      ...base,
      projectId: reverseProjectId,
      importBatchId: "earlier-reverse",
      sourceSha256: "sha-earlier",
      rawReadings: [raw("earlier-reverse", "sha-earlier", "2026-05-01T00:15:00.000Z", 100.9, reverseProjectId)],
      normalizedReadings: [normalized("earlier-reverse", "sha-earlier", "2026-05-01T00:15:00.000Z", 100.9, reverseProjectId)],
      intervalFacts: [fact("earlier-reverse", "sha-earlier", "2026-05-01T00:00:00.000Z", "2026-05-01T00:15:00.000Z", 0.9, reverseProjectId)],
    };
    const reverseLaterBatch = {
      ...base,
      projectId: reverseProjectId,
      importBatchId: "later-reverse",
      sourceSha256: "sha-later",
      rawReadings: [
        raw("later-reverse", "sha-later", "2026-05-01T00:15:00.000Z", 101, reverseProjectId),
        raw("later-reverse", "sha-later", "2026-05-01T00:30:00.000Z", 102, reverseProjectId),
      ],
      normalizedReadings: [
        normalized("later-reverse", "sha-later", "2026-05-01T00:15:00.000Z", 101, reverseProjectId),
        normalized("later-reverse", "sha-later", "2026-05-01T00:30:00.000Z", 102, reverseProjectId),
      ],
      intervalFacts: [
        fact("later-reverse", "sha-later", "2026-05-01T00:00:00.000Z", "2026-05-01T00:15:00.000Z", 1, reverseProjectId),
        fact("later-reverse", "sha-later", "2026-05-01T00:15:00.000Z", "2026-05-01T00:30:00.000Z", 1, reverseProjectId),
      ],
    };
    await writeProjectSnapshot(
      reverseEarlierBatch,
      [reverseEarlierBatch],
      "snapshot-earlier-reverse",
      ["sha-earlier"],
      "unavailable",
    );
    const reverseMaterialized = await writeProjectSnapshot(
      reverseLaterBatch,
      [reverseEarlierBatch, reverseLaterBatch],
      "snapshot-overlap-reverse",
      ["sha-earlier", "sha-later"],
      "snapshot-earlier-reverse",
    );
    expect(reverseMaterialized.projectAudit).toEqual(materialized.projectAudit);
    await expect(readEnergyFactMaterializationStats({ databasePath, importBatchId: "later-reverse" }))
      .resolves.toMatchObject({ normalizedRows: 2, intervalFacts: 2 });
    await expect(readEnergyFactMaterializationStats({ databasePath, importBatchId: "earlier-reverse" }))
      .resolves.toMatchObject({ normalizedRows: 0, intervalFacts: 0 });

    const replayEarlierBatch = {
      ...base,
      importBatchId: "earlier",
      sourceSha256: "sha-earlier",
      rawReadings: [
        raw("earlier", "sha-earlier", "2026-05-01T00:15:00.000Z", 101),
      ],
      normalizedReadings: [
        normalized("earlier", "sha-earlier", "2026-05-01T00:15:00.000Z", 101),
      ],
      intervalFacts: [
        fact("earlier", "sha-earlier", "2026-05-01T00:00:00.000Z", "2026-05-01T00:15:00.000Z", 1),
      ],
    };
    const replayed = await writeProjectSnapshot(
      replayEarlierBatch,
      [replayEarlierBatch, laterBatch],
      "snapshot-overlap-replay",
      ["sha-earlier", "sha-later"],
      "snapshot-overlap",
    );
    expect(replayed.projectAudit.rawOverlapConflictCount).toBe(0);
    await expect(readEnergyFactMaterializationStats({ databasePath, importBatchId: "later" }))
      .resolves.toMatchObject({ normalizedRows: 2, intervalFacts: 2 });
    await expect(readEnergyFactMaterializationStats({ databasePath, importBatchId: "earlier" }))
      .resolves.toMatchObject({ normalizedRows: 0, intervalFacts: 0 });

    const ambiguousProjectId = "project-overlap-ambiguous";
    const ambiguousLeft = {
      ...base,
      projectId: ambiguousProjectId,
      importBatchId: "ambiguous-left",
      sourceSha256: "sha-ambiguous-left",
      rawReadings: [
        raw("ambiguous-left", "sha-ambiguous-left", "2026-05-01T00:15:00.000Z", 100.9, ambiguousProjectId),
      ],
      normalizedReadings: [
        normalized("ambiguous-left", "sha-ambiguous-left", "2026-05-01T00:15:00.000Z", 100.9, ambiguousProjectId),
      ],
      intervalFacts: [
        fact("ambiguous-left", "sha-ambiguous-left", "2026-05-01T00:00:00.000Z", "2026-05-01T00:15:00.000Z", 0.9, ambiguousProjectId),
      ],
    };
    const ambiguousRight = {
      ...base,
      projectId: ambiguousProjectId,
      importBatchId: "ambiguous-right",
      sourceSha256: "sha-ambiguous-right",
      rawReadings: [
        raw("ambiguous-right", "sha-ambiguous-right", "2026-05-01T00:15:00.000Z", 101, ambiguousProjectId),
      ],
      normalizedReadings: [
        normalized("ambiguous-right", "sha-ambiguous-right", "2026-05-01T00:15:00.000Z", 101, ambiguousProjectId),
      ],
      intervalFacts: [
        fact("ambiguous-right", "sha-ambiguous-right", "2026-05-01T00:00:00.000Z", "2026-05-01T00:15:00.000Z", 1, ambiguousProjectId),
      ],
    };
    await expect(writeProjectSnapshot(
      ambiguousRight,
      [ambiguousLeft, ambiguousRight],
      "snapshot-overlap-ambiguous",
      ["sha-ambiguous-left", "sha-ambiguous-right"],
      "unavailable",
    )).rejects.toThrow("ENERGYIQ_OVERLAP_CONFLICT_AMBIGUOUS");
  });
});

const boundaryBatch = (input: {
  databasePath: string;
  projectId: string;
  importBatchId: string;
  sourceSha256: string;
  readings: Array<[time: string, value: number]>;
}) => ({
  databasePath: input.databasePath,
  projectId: input.projectId,
  importBatchId: input.importBatchId,
  sourceSha256: input.sourceSha256,
  timezone: "Asia/Singapore",
  rawReadings: [],
  normalizedReadings: input.readings.map(([eventTime, activeEnergyKwh], index) => ({
    workspaceId: "workspace-1",
    projectId: input.projectId,
    importBatchId: input.importBatchId,
    resource: "electricity" as const,
    meterPointId: "meter-a",
    scopeId: "scope-a",
    sourceLabel: "Meter A",
    category: "load",
    meterRole: "total",
    eventTime,
    activeEnergyKwh,
    sourceFile: `${input.importBatchId}.xlsx`,
    sourceSha256: input.sourceSha256,
    sourceRowNumber: index + 2,
    sourceReadingKind: "cumulative_energy" as const,
  })),
  intervalFacts: input.readings.slice(1).map(([intervalEnd, activeEnergyKwh], index) => {
    const [intervalStart, previousActiveEnergyKwh] = input.readings[index]!;
    const rawDeltaKwh = activeEnergyKwh - previousActiveEnergyKwh;
    return {
      workspaceId: "workspace-1",
      projectId: input.projectId,
      importBatchId: input.importBatchId,
      resource: "electricity" as const,
      meterPointId: "meter-a",
      scopeId: "scope-a",
      sourceLabel: "Meter A",
      category: "load",
      meterRole: "total",
      intervalStart,
      intervalEnd,
      elapsedMinutes: 15,
      activeEnergyKwh,
      previousActiveEnergyKwh,
      rawDeltaKwh,
      usageKwh: rawDeltaKwh,
      averageKw: rawDeltaKwh * 4,
      qualityStatus: rawDeltaKwh < 0 ? "negative_delta" : "ok",
      localDate: "2026-05-01",
      localHour: 8,
      dayType: "weekday",
      sourceFile: `${input.importBatchId}.xlsx`,
      sourceSha256: input.sourceSha256,
      sourceReadingKind: "cumulative_energy" as const,
    };
  }),
  qualityEvents: [],
  snapshotFactScope: testFactScope(input.projectId, `snapshot-${input.importBatchId}`, [input.sourceSha256]),
});

const eventBatch = (input: Parameters<typeof boundaryBatch>[0]) => {
  const batch = boundaryBatch(input);
  return {
    ...batch,
    normalizedReadings: batch.normalizedReadings.map((reading) => ({
      ...reading,
      sourceReadingKind: "cumulative_energy_event" as const,
    })),
    intervalFacts: [],
  };
};

const readCanonicalIntervals = async (
  databasePath: string,
  projectId: string,
): Promise<Array<Record<string, unknown>>> => {
  const database = await getDuckDbDatabase(databasePath);
  const connection = database.connect();
  try {
    return await new Promise((resolve, reject) => {
      connection.all(`
        SELECT import_batch_id, source_reading_kind, interval_start, interval_end,
          elapsed_minutes, usage_kwh, average_kw, quality_status
        FROM energy_interval_facts
        WHERE project_id = ?
        ORDER BY interval_start
      `, projectId, (error, rows) => error
        ? reject(error)
        : resolve(rows as Array<Record<string, unknown>>));
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      connection.close((error) => error ? reject(error) : resolve());
    });
  }
};

const legacyFactSchemaSql = `
  CREATE TABLE raw_meter_readings (
    workspace_id VARCHAR, project_id VARCHAR, resource VARCHAR, device_name VARCHAR,
    event_time TIMESTAMPTZ, active_energy_kwh DOUBLE, source_file VARCHAR,
    source_sha256 VARCHAR, source_row_number INTEGER, is_valid BOOLEAN,
    validation_error VARCHAR, is_overlap_conflict BOOLEAN
  );
  CREATE TABLE normalized_meter_readings (
    workspace_id VARCHAR, project_id VARCHAR, resource VARCHAR, meter_node_id VARCHAR,
    level_node_id VARCHAR, device_name VARCHAR, category VARCHAR, meter_role VARCHAR,
    event_time TIMESTAMPTZ, active_energy_kwh DOUBLE, source_file VARCHAR,
    source_sha256 VARCHAR, source_row_number INTEGER
  );
  CREATE TABLE energy_interval_facts (
    workspace_id VARCHAR, project_id VARCHAR, resource VARCHAR, meter_node_id VARCHAR,
    parent_node_id VARCHAR, level_node_id VARCHAR, device_name VARCHAR, appliance VARCHAR,
    circuit_name VARCHAR, category VARCHAR, meter_role VARCHAR,
    interval_start TIMESTAMPTZ, interval_end TIMESTAMPTZ, elapsed_minutes DOUBLE,
    active_energy_kwh DOUBLE, previous_active_energy_kwh DOUBLE, raw_delta_kwh DOUBLE,
    usage_kwh DOUBLE, average_kw DOUBLE, quality_status VARCHAR, local_date DATE,
    local_hour INTEGER, day_type VARCHAR, is_operating BOOLEAN, source_file VARCHAR,
    source_sha256 VARCHAR
  );
  CREATE TABLE energy_quality_events (
    workspace_id VARCHAR NOT NULL, project_id VARCHAR NOT NULL,
    import_batch_id VARCHAR NOT NULL, meter_node_id VARCHAR, source_label VARCHAR,
    event_time TIMESTAMPTZ, code VARCHAR NOT NULL, severity VARCHAR NOT NULL,
    details_json JSON NOT NULL
  );
  CREATE TABLE energy_project_fact_state (
    project_id VARCHAR PRIMARY KEY,
    workspace_id VARCHAR NOT NULL,
    data_snapshot_id VARCHAR NOT NULL,
    manifest_fingerprint VARCHAR NOT NULL,
    source_sha256_json JSON NOT NULL,
    fact_writer_contract_version VARCHAR NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
  );
`;

const withProjectId = (
  input: ReturnType<typeof boundaryBatch>,
  projectId: string,
): ReturnType<typeof boundaryBatch> => ({
  ...input,
  projectId,
  snapshotFactScope: testFactScope(projectId, input.snapshotFactScope.dataSnapshotId, input.snapshotFactScope.sourceSha256),
  rawReadings: [],
  normalizedReadings: input.normalizedReadings.map((row) => ({ ...row, projectId })),
  intervalFacts: input.intervalFacts.map((row) => ({ ...row, projectId })),
  qualityEvents: [],
});

const testFactScope = (projectId: string, dataSnapshotId: string, sourceSha256: string[]) => ({
  workspaceId: "workspace-1",
  projectId,
  dataSnapshotId,
  manifestFingerprint: `fingerprint-${dataSnapshotId}`,
  sourceSha256,
  factWriterContractVersion: ENERGY_FACT_WRITER_CONTRACT_VERSION,
});

const writeProjectSnapshot = (
  context: { databasePath: string; projectId: string; timezone: string },
  batches: EnergyFactMaterializationBatchWrite[],
  dataSnapshotId: string,
  sourceSha256: string[],
  expectedPreviousDataSnapshotId: string,
) => writeEnergyFactProjectMaterialization({
  databasePath: context.databasePath,
  projectId: context.projectId,
  timezone: context.timezone,
  expectedPreviousDataSnapshotId,
  snapshotFactScope: testFactScope(context.projectId, dataSnapshotId, sourceSha256),
  batches: batches.map(projectBatch),
});

const projectBatch = (input: EnergyFactMaterializationBatchWrite): EnergyFactMaterializationBatchWrite => ({
  importBatchId: input.importBatchId,
  sourceSha256: input.sourceSha256,
  rawReadings: input.rawReadings,
  normalizedReadings: input.normalizedReadings,
  intervalFacts: input.intervalFacts,
  qualityEvents: input.qualityEvents,
});
