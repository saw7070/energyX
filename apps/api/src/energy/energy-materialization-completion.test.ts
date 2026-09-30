import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ENERGY_FACT_WRITER_CONTRACT_VERSION,
  writeEnergyFactProjectMaterialization,
  type EnergyFactMaterializationBatchWrite,
  type EnergyFactProjectMaterializationResult,
} from "@datafoundry/data-gateway";
import { createMetadataStore, type EnergyIqDataSnapshotRecord } from "@datafoundry/metadata";

import {
  ENERGY_EXCEL_MATERIALIZER_CONTRACT_VERSION,
  type EnergyImportMaterializationSummary,
} from "./energy-import-materializer.js";

describe("Energy import completion", () => {
  it("publishes one identical immutable Snapshot for either full-manifest batch order", async () => {
    const earlierFirst = await materializeManifest(["earlier", "later"]);
    const laterFirst = await materializeManifest(["later", "earlier"]);

    expect(earlierFirst.persisted.projectAudit).toEqual(laterFirst.persisted.projectAudit);
    expect(earlierFirst.persisted.batchStats).toEqual(laterFirst.persisted.batchStats);
    expect(earlierFirst.snapshot.id).toBe(laterFirst.snapshot.id);
    expect(JSON.parse(earlierFirst.snapshot.manifest_json)).toEqual(JSON.parse(laterFirst.snapshot.manifest_json));
    expect(JSON.parse(earlierFirst.snapshot.audit_json)).toEqual(JSON.parse(laterFirst.snapshot.audit_json));
  });
});

type SourceKey = "earlier" | "later";

const SOURCE_SHA = {
  earlier: "a".repeat(64),
  later: "b".repeat(64),
} as const;

const materializeManifest = async (order: SourceKey[]): Promise<{
  snapshot: EnergyIqDataSnapshotRecord;
  persisted: EnergyFactProjectMaterializationResult;
}> => {
  const root = mkdtempSync(join(tmpdir(), "energy-import-full-manifest-"));
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  try {
    metadata.workspaces.upsert({
      id: "workspace-1",
      owner_user_id: "dev-user",
      name: "Customer Workspace",
      kind: "customer",
    });
    metadata.energyIq.upsertProject({
      id: "project-order",
      workspace_id: "workspace-1",
      name: "Order-independent Project",
      status: "draft",
    });
    for (const source of ["earlier", "later"] as const) {
      metadata.energyIq.createImportBatch({
        id: `batch-${source}`,
        workspace_id: "workspace-1",
        project_id: "project-order",
        source_kind: "excel",
        source_sha256: SOURCE_SHA[source],
        filename: `${source}.xlsx`,
        status: "inspected",
        inspection: {
          sheetName: "Sheet1",
          rowCount: source === "earlier" ? 1 : 2,
          sourceLabels: [{ label: "Meter A", rowCount: source === "earlier" ? 1 : 2 }],
          coverageFrom: "2026-05-01T00:15:00.000Z",
          coverageTo: source === "earlier" ? "2026-05-01T00:15:00.000Z" : "2026-05-01T00:30:00.000Z",
        },
        created_by: "dev-user",
      });
    }
    const writes = Object.fromEntries(
      (["earlier", "later"] as const).map((source) => [source, sourceWrite("project-order", source)]),
    ) as Record<SourceKey, EnergyFactMaterializationBatchWrite>;
    const materializations = (["earlier", "later"] as const).map((source) => ({
      batch_id: `batch-${source}`,
      summary: sourceSummary(source, writes[source]),
    }));
    const prepared = metadata.energyIq.prepareProjectManifestMaterialization({
      project_id: "project-order",
      materializations,
      source_manifest_sha256: Object.values(SOURCE_SHA),
    });
    const persisted = await writeEnergyFactProjectMaterialization({
      databasePath: join(root, "energy.duckdb"),
      projectId: "project-order",
      timezone: "Asia/Singapore",
      expectedPreviousDataSnapshotId: prepared.expected_previous_snapshot_id,
      snapshotFactScope: prepared.fact_scope,
      batches: order.map((source) => writes[source]),
    });
    const completed = metadata.energyIq.completeProjectManifestMaterialization({
      project_id: "project-order",
      materializations,
      project_audit: persisted.projectAudit,
      source_manifest_sha256: Object.values(SOURCE_SHA),
      expected_snapshot_id: prepared.expected_snapshot_id,
      expected_previous_snapshot_id: prepared.expected_previous_snapshot_id,
    });
    return { snapshot: completed.snapshot, persisted };
  } finally {
    metadata.close();
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (error) {
      if (process.platform !== "win32" || !(error instanceof Error) || !("code" in error)
        || (error.code !== "EPERM" && error.code !== "EBUSY")) throw error;
    }
  }
};

const sourceWrite = (projectId: string, source: SourceKey): EnergyFactMaterializationBatchWrite => {
  const batchId = `batch-${source}`;
  const sourceSha256 = SOURCE_SHA[source];
  const sourceFile = `${source}.xlsx`;
  const points = source === "earlier"
    ? [{ time: "2026-05-01T00:15:00.000Z", value: 100.9 }]
    : [
        { time: "2026-05-01T00:15:00.000Z", value: 101 },
        { time: "2026-05-01T00:30:00.000Z", value: 102 },
      ];
  const facts = source === "earlier"
    ? [{ start: "2026-05-01T00:00:00.000Z", end: "2026-05-01T00:15:00.000Z", usage: 0.9 }]
    : [
        { start: "2026-05-01T00:00:00.000Z", end: "2026-05-01T00:15:00.000Z", usage: 1 },
        { start: "2026-05-01T00:15:00.000Z", end: "2026-05-01T00:30:00.000Z", usage: 1 },
      ];
  return {
    importBatchId: batchId,
    sourceSha256,
    rawReadings: points.map((point, index) => ({
      workspaceId: "workspace-1", projectId, importBatchId: batchId, resource: "electricity",
      sourceLabel: "Meter A", meterPointId: "meter-a", scopeId: "scope-a", eventTime: point.time,
      activeEnergyKwh: point.value, sourceFile, sourceSha256, sourceRowNumber: index + 2,
      isValid: true, isOverlapConflict: false,
    })),
    normalizedReadings: points.map((point, index) => ({
      workspaceId: "workspace-1", projectId, importBatchId: batchId, resource: "electricity",
      meterPointId: "meter-a", scopeId: "scope-a", sourceLabel: "Meter A", category: "load",
      meterRole: "total", eventTime: point.time, activeEnergyKwh: point.value, sourceFile, sourceSha256,
      sourceRowNumber: index + 2, sourceReadingKind: "cumulative_energy",
    })),
    intervalFacts: facts.map((fact) => ({
      workspaceId: "workspace-1", projectId, importBatchId: batchId, resource: "electricity",
      meterPointId: "meter-a", scopeId: "scope-a", sourceLabel: "Meter A", category: "load",
      meterRole: "total", intervalStart: fact.start, intervalEnd: fact.end, elapsedMinutes: 15,
      activeEnergyKwh: 101, previousActiveEnergyKwh: 100, rawDeltaKwh: fact.usage, usageKwh: fact.usage,
      averageKw: fact.usage * 4, qualityStatus: "ok", localDate: "2026-05-01", localHour: 8,
      dayType: "weekday", sourceFile, sourceSha256, sourceReadingKind: "cumulative_energy",
    })),
    qualityEvents: [],
  };
};

const sourceSummary = (
  source: SourceKey,
  write: EnergyFactMaterializationBatchWrite,
): EnergyImportMaterializationSummary => ({
  rawRowCount: write.rawReadings.length,
  normalizedReadingCount: write.normalizedReadings.length,
  intervalFactCount: write.intervalFacts.length,
  totalUsageKwh: write.intervalFacts.reduce((sum, fact) => sum + (fact.usageKwh ?? 0), 0),
  qualityCounts: { ok: write.intervalFacts.length },
  mappingRevision: 3,
  mappingFingerprint: "mapping-fingerprint",
  timezone: "Asia/Singapore",
  materializerContractVersion: ENERGY_EXCEL_MATERIALIZER_CONTRACT_VERSION,
  factWriterContractVersion: ENERGY_FACT_WRITER_CONTRACT_VERSION,
  sourceSheetName: "Sheet1",
  sourceRowCount: write.rawReadings.length,
  sourceLabels: ["Meter A"],
  sourceCoverageFrom: "2026-05-01T00:15:00.000Z",
  sourceCoverageTo: source === "earlier" ? "2026-05-01T00:15:00.000Z" : "2026-05-01T00:30:00.000Z",
});
