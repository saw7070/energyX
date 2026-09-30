import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createMetadataStore } from "./index.js";

describe("EnergyIqSourceSyncStore", () => {
  it("claims one Project sync, reuses an exact successful window, and preserves the success watermark after failure", () => {
    const root = mkdtempSync(join(tmpdir(), "energy-source-sync-store-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.workspaces.upsert({
        id: "default",
        owner_user_id: "dev-user",
        name: "Default",
        kind: "customer",
      });
      metadata.energyIq.upsertProject({
        id: "tuya-sync-project",
        workspace_id: "default",
        name: "Tuya Sync Project",
        status: "draft",
      });
      expect(() => metadata.energyIq.sourceSync.claim({
        id: "sync-run-cross-workspace",
        workspace_id: "wrong-workspace",
        project_id: "tuya-sync-project",
        source_kind: "tuya",
        connector_fingerprint: "c".repeat(64),
        trigger: "manual",
        window_start_ms: 1_699_913_600_000,
        window_end_ms: 1_700_000_000_000,
        actor_user_id: "dev-user",
      })).toThrow("ENERGYIQ_SOURCE_SYNC_PROJECT_SCOPE_MISMATCH");
      const first = metadata.energyIq.sourceSync.claim({
        id: "sync-run-1",
        workspace_id: "default",
        project_id: "tuya-sync-project",
        source_kind: "tuya",
        connector_fingerprint: "c".repeat(64),
        trigger: "scheduled",
        window_start_ms: 1_700_000_000_000,
        window_end_ms: 1_700_086_400_000,
        actor_user_id: "dev-user",
        started_at: "2026-08-20T17:00:00.000Z",
      });
      expect(first).toMatchObject({ reused: false, run: { status: "running" } });
      expect(() => metadata.energyIq.sourceSync.claim({
        id: "sync-run-concurrent",
        workspace_id: "default",
        project_id: "tuya-sync-project",
        source_kind: "tuya",
        connector_fingerprint: "c".repeat(64),
        trigger: "manual",
        window_start_ms: 1_700_086_400_000,
        window_end_ms: 1_700_172_800_000,
        actor_user_id: "dev-user",
      })).toThrow("ENERGYIQ_SOURCE_SYNC_IN_PROGRESS:sync-run-1");

      createBatch(metadata, "sync-batch-1", "a".repeat(64));
      const snapshotId = createSnapshot(metadata, "a".repeat(64));
      metadata.energyIq.upsertProject({
        id: "other-project",
        workspace_id: "default",
        name: "Other Project",
        status: "draft",
      });
      metadata.energyIq.createImportBatch({
        id: "cross-project-batch",
        workspace_id: "default",
        project_id: "other-project",
        source_kind: "tuya",
        source_sha256: "b".repeat(64),
        filename: "cross-project-batch.json",
        status: "inspected",
        inspection: {},
        created_by: "dev-user",
      });
      expect(() => metadata.energyIq.sourceSync.completeSuccess({
        run_id: first.run.id,
        import_batch_id: "cross-project-batch",
        data_snapshot_id: snapshotId,
        active_source_sha256: ["a".repeat(64)],
      })).toThrow("ENERGYIQ_SOURCE_SYNC_RESULT_SCOPE_MISMATCH");
      metadata.energyIq.sourceSync.completeSuccess({
        run_id: first.run.id,
        import_batch_id: "sync-batch-1",
        data_snapshot_id: snapshotId,
        active_source_sha256: ["a".repeat(64)],
        completed_at: "2026-08-20T17:01:00.000Z",
      });
      expect(metadata.energyIq.sourceSync.findState({
        project_id: "tuya-sync-project",
        source_kind: "tuya",
      })).toMatchObject({
        watermark_ms: 1_700_086_400_000,
        active_source_sha256: ["a".repeat(64)],
        last_run_id: "sync-run-1",
        last_success_at: "2026-08-20T17:01:00.000Z",
        last_import_batch_id: "sync-batch-1",
        last_data_snapshot_id: snapshotId,
      });

      const olderBackfill = metadata.energyIq.sourceSync.claim({
        id: "sync-run-older-backfill",
        workspace_id: "default",
        project_id: "tuya-sync-project",
        source_kind: "tuya",
        connector_fingerprint: "c".repeat(64),
        trigger: "backfill",
        window_start_ms: 1_699_827_200_000,
        window_end_ms: 1_699_913_600_000,
        actor_user_id: "dev-user",
        started_at: "2026-08-20T18:00:00.000Z",
      });
      metadata.energyIq.sourceSync.completeSuccess({
        run_id: olderBackfill.run.id,
        import_batch_id: "sync-batch-1",
        data_snapshot_id: snapshotId,
        active_source_sha256: ["a".repeat(64)],
        completed_at: "2026-08-20T17:01:00.000Z",
      });
      expect(metadata.energyIq.sourceSync.findState({
        project_id: "tuya-sync-project",
        source_kind: "tuya",
      })?.watermark_ms).toBe(1_700_086_400_000);

      const reused = metadata.energyIq.sourceSync.claim({
        id: "sync-run-duplicate",
        workspace_id: "default",
        project_id: "tuya-sync-project",
        source_kind: "tuya",
        connector_fingerprint: "c".repeat(64),
        trigger: "manual",
        window_start_ms: 1_700_000_000_000,
        window_end_ms: 1_700_086_400_000,
        actor_user_id: "dev-user",
      });
      expect(reused).toMatchObject({ reused: true, run: { id: "sync-run-1", status: "succeeded" } });

      const rotatedConnector = metadata.energyIq.sourceSync.claim({
        id: "sync-run-rotated-connector",
        workspace_id: "default",
        project_id: "tuya-sync-project",
        source_kind: "tuya",
        connector_fingerprint: "d".repeat(64),
        trigger: "manual",
        window_start_ms: 1_700_000_000_000,
        window_end_ms: 1_700_086_400_000,
        actor_user_id: "dev-user",
        started_at: "2026-08-21T16:00:00.000Z",
      });
      expect(rotatedConnector).toMatchObject({ reused: false, run: { status: "running" } });
      metadata.energyIq.sourceSync.completeFailure({
        run_id: rotatedConnector.run.id,
        error_code: "TEST_CONNECTOR_ROTATION",
        completed_at: "2026-08-21T16:01:00.000Z",
      });

      const second = metadata.energyIq.sourceSync.claim({
        id: "sync-run-2",
        workspace_id: "default",
        project_id: "tuya-sync-project",
        source_kind: "tuya",
        connector_fingerprint: "c".repeat(64),
        trigger: "scheduled",
        window_start_ms: 1_700_086_400_000,
        window_end_ms: 1_700_172_800_000,
        actor_user_id: "dev-user",
        started_at: "2026-08-21T17:00:00.000Z",
      });
      metadata.energyIq.sourceSync.completeFailure({
        run_id: second.run.id,
        error_code: "TUYA_UPSTREAM_TIMEOUT",
        completed_at: "2026-08-21T17:02:00.000Z",
      });
      expect(metadata.energyIq.sourceSync.findState({
        project_id: "tuya-sync-project",
        source_kind: "tuya",
      })).toMatchObject({
        watermark_ms: 1_700_086_400_000,
        active_source_sha256: ["a".repeat(64)],
        last_run_id: "sync-run-2",
        last_success_at: "2026-08-20T17:01:00.000Z",
        last_failure_at: "2026-08-21T17:02:00.000Z",
        last_error_code: "TUYA_UPSTREAM_TIMEOUT",
      });
      expect(metadata.energyIq.sourceSync.listRuns({
        project_id: "tuya-sync-project",
        source_kind: "tuya",
      }).map((run) => [run.id, run.status])).toEqual([
        ["sync-run-2", "failed"],
        ["sync-run-rotated-connector", "failed"],
        ["sync-run-older-backfill", "succeeded"],
        ["sync-run-1", "succeeded"],
      ]);

      const interrupted = metadata.energyIq.sourceSync.claim({
        id: "sync-run-interrupted",
        workspace_id: "default",
        project_id: "tuya-sync-project",
        source_kind: "tuya",
        connector_fingerprint: "c".repeat(64),
        trigger: "scheduled",
        window_start_ms: 1_700_172_800_000,
        window_end_ms: 1_700_259_200_000,
        actor_user_id: "dev-user",
        started_at: "2026-08-21T18:00:00.000Z",
      });
      const recovered = metadata.energyIq.sourceSync.claim({
        id: "sync-run-recovered",
        workspace_id: "default",
        project_id: "tuya-sync-project",
        source_kind: "tuya",
        connector_fingerprint: "c".repeat(64),
        trigger: "scheduled",
        window_start_ms: 1_700_172_800_000,
        window_end_ms: 1_700_259_200_000,
        actor_user_id: "dev-user",
        started_at: "2026-08-22T02:00:00.000Z",
        stale_before: "2026-08-22T00:00:00.000Z",
      });
      expect(metadata.energyIq.sourceSync.getRun(interrupted.run.id)).toMatchObject({
        status: "failed",
        error_code: "SOURCE_SYNC_PROCESS_INTERRUPTED",
      });
      expect(recovered).toMatchObject({ reused: false, run: { status: "running" } });
      expect(metadata.energyIq.sourceSync.findState({
        project_id: "tuya-sync-project",
        source_kind: "tuya",
      })).toMatchObject({
        watermark_ms: 1_700_086_400_000,
        last_error_code: "SOURCE_SYNC_PROCESS_INTERRUPTED",
      });
      metadata.energyIq.sourceSync.completeFailure({
        run_id: recovered.run.id,
        error_code: "TEST_RECOVERY_RELEASE",
      });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

const createBatch = (
  metadata: ReturnType<typeof createMetadataStore>,
  id: string,
  sourceSha256: string,
): string => metadata.energyIq.createImportBatch({
  id,
  workspace_id: "default",
  project_id: "tuya-sync-project",
  source_kind: "tuya",
  source_sha256: sourceSha256,
  filename: `${id}.json`,
  status: "inspected",
  inspection: {},
  created_by: "dev-user",
}).id;

const createSnapshot = (
  metadata: ReturnType<typeof createMetadataStore>,
  sourceSha256: string,
): string => {
  const batch = metadata.energyIq.getImportBatch("sync-batch-1");
  const prepared = metadata.energyIq.prepareProjectManifestMaterialization({
    project_id: "tuya-sync-project",
    materializations: [{ batch_id: batch.id, summary: materializationSummary() }],
    source_manifest_sha256: [sourceSha256],
  });
  return metadata.energyIq.completeProjectManifestMaterialization({
    project_id: "tuya-sync-project",
    materializations: [{ batch_id: batch.id, summary: materializationSummary() }],
    project_audit: projectAudit(),
    source_manifest_sha256: [sourceSha256],
    expected_snapshot_id: prepared.expected_snapshot_id,
    expected_previous_snapshot_id: prepared.expected_previous_snapshot_id,
  }).snapshot.id;
};

const materializationSummary = () => ({
  mappingFingerprint: "mapping",
  timezone: "Asia/Singapore",
  materializerContractVersion: "test",
  factWriterContractVersion: "test",
});

const projectAudit = () => ({
  rawRowCount: 1,
  invalidRawRowCount: 0,
  unmappedRawRowCount: 0,
  rawOverlapConflictCount: 0,
  normalizedReadingCount: 1,
  intervalFactCount: 1,
  duplicateNormalizedReadingCount: 0,
  duplicateIntervalFactCount: 0,
  invalidIntervalDurationCount: 0,
  negativeDeltaIntervalCount: 0,
  legacyRawRowCount: 0,
  legacyNormalizedReadingCount: 0,
  legacyIntervalFactCount: 0,
  legacyCanonicalRowCount: 0,
  canonicalMeterSeriesCount: 1,
  adjacentReadingPairCount: 1,
  missingAdjacentIntervalCount: 0,
  orphanIntervalFactCount: 0,
});
