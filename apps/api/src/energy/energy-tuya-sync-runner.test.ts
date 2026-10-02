import { LocalDataGateway, readEnergyFactProjectState } from "@datafoundry/data-gateway";
import { LocalFileAssetService } from "@datafoundry/files";
import { createEnergyIqSourceManifest, createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { ConfigApiContext } from "../routes/types.js";
import { ensureEnergyIqBootstrap } from "./energy-bootstrap.js";
import {
  materializeEnergyProjectManifest,
  publishEnergyProjectManifestAtomically,
  recoverInterruptedEnergyProjectPublication,
} from "./energy-project-materialization.js";
import { resolveEnergyTuyaProjectConnector } from "./energy-tuya-connector.js";
import {
  createProjectAnalysisResultCache,
  createProjectOverviewProjectionKey,
  createProjectOverviewProjectionRef,
  type ProjectOverviewProjectionIdentity,
} from "./project-analysis-result-cache.js";
import { resolveProjectOverviewReleaseId } from "./project-analysis-resolver.js";
import {
  createEnergyTuyaSyncRunner,
  persistTuyaImportArtifact,
  resolveLatestCompleteSingaporeDayEnd,
  resolveScheduledTuyaSyncWindow,
  sourceSyncErrorCode,
  sourceSyncErrorDetail,
} from "./energy-tuya-sync-runner.js";
import {
  TUYA_REPORT_LOG_ARTIFACT_VERSION,
  TUYA_SINGAPORE_ENDPOINT,
  type TuyaReportLogArtifact,
} from "./tuya-openapi-client.js";
import {
  TUYA_OFFICE_EXAMPLE_DEVICE_BINDINGS,
  TUYA_OFFICE_PROJECT_ID,
  TUYA_OFFICE_WORKSPACE_ID,
} from "./tuya-office-project.js";

let crashFixture: {
  root: string;
  databasePath: string;
  projectionDirectory: string;
  metadata: ReturnType<typeof createMetadataStore>;
  context: Required<ConfigApiContext>;
  pointerKey: string;
  cache: ReturnType<typeof createProjectAnalysisResultCache<{ snapshotId: string }>>;
  first: Awaited<ReturnType<ReturnType<typeof createEnergyTuyaSyncRunner>["run"]>>;
  firstReleaseId: string;
} | undefined;

let crashRetryFixture: {
  candidateBatch: ReturnType<typeof persistTuyaImportArtifact>;
  rotatedConnector: ReturnType<typeof connectorFor>;
  candidateIdentity: ProjectOverviewProjectionIdentity;
} | undefined;

let stitchFixture: {
  root: string;
  databasePath: string;
  metadata: ReturnType<typeof createMetadataStore>;
  connector: ReturnType<typeof connectorFor>;
  runner: ReturnType<typeof createEnergyTuyaSyncRunner>;
  firstWindow: { startTime: number; endTime: number };
  first: Awaited<ReturnType<ReturnType<typeof createEnergyTuyaSyncRunner>["run"]>>;
  draftBefore: ReturnType<ReturnType<typeof createMetadataStore>["energyIq"]["projectSetup"]["getDraft"]>;
  readRefCalls: () => number;
  state: { providerCalls: number; artifactIndex: number; materializedOverviewSnapshots: string[] };
} | undefined;

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), "energy-tuya-crash-fixture-"));
  const previousDuckDbPath = process.env.ENERGYIQ_DUCKDB_PATH;
  const databasePath = join(root, "energy.duckdb");
  const projectionDirectory = join(root, "project-analysis-cache");
  process.env.ENERGYIQ_DUCKDB_PATH = databasePath;
  const metadata = createMetadataStore({
    database_path: join(root, "metadata.sqlite"),
  });
  const files = new LocalFileAssetService(metadata, {
    storageRoot: join(root, "files"),
  });
  try {
    ensureEnergyIqBootstrap(metadata);
    const context = {
      metadataStore: metadata,
      dataGateway: new LocalDataGateway(metadata),
      fileAssetService: files,
      userId: "dev-user",
      workspaceId: TUYA_OFFICE_WORKSPACE_ID,
    } as unknown as Required<ConfigApiContext>;
    const pointerKey = `current:${TUYA_OFFICE_PROJECT_ID}`;
    const cache = createProjectAnalysisResultCache<{ snapshotId: string }>({
      capacity: 4,
      ttlMs: 60_000,
    });
    const firstReleaseId = resolveProjectOverviewReleaseId(metadata, TUYA_OFFICE_PROJECT_ID)!;
    const first = await createEnergyTuyaSyncRunner({
      context,
      now: () => Date.parse("2026-08-21T03:00:00.000Z"),
      id: () => "crash-fixture-first",
      syncTuyaEnergyReadings: async (input) => artifact(input.startTime, input.endTime, 1),
      afterMaterialization: async ({ snapshot }, beforePublish) => {
        const identity = overviewIdentityFor(
          snapshot.id,
          firstReleaseId,
          metadata.energyIq.getProject(TUYA_OFFICE_PROJECT_ID).hierarchy_revision_id,
          databasePath,
        );
        const projectionKey = createProjectOverviewProjectionKey(identity);
        await cache.materializeCurrent({
          pointerKey,
          projectionKey,
          identity,
          persistentDirectory: projectionDirectory,
          compute: async () => ({ snapshotId: snapshot.id }),
          validate: (value, candidateIdentity) => value.snapshotId === candidateIdentity.dataSnapshotId,
          beforePublish: async (publication) => beforePublish({
            persistentDirectory: projectionDirectory,
            pointerKey,
            ...publication,
          }),
        });
        return { projectionRef: createProjectOverviewProjectionRef(projectionKey) };
      },
    }).run({
      connector: connectorFor(metadata),
      actorUserId: "dev-user",
      trigger: "manual",
      window: {
        startTime: Date.parse("2026-08-19T00:00:00.000Z"),
        endTime: Date.parse("2026-08-19T00:30:00.000Z"),
      },
    });
    crashFixture = {
      root,
      databasePath,
      projectionDirectory,
      metadata,
      context,
      pointerKey,
      cache,
      first,
      firstReleaseId,
    };
  } finally {
    if (previousDuckDbPath === undefined) delete process.env.ENERGYIQ_DUCKDB_PATH;
    else process.env.ENERGYIQ_DUCKDB_PATH = previousDuckDbPath;
  }
});

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), "energy-tuya-stitch-fixture-"));
  const previousDuckDbPath = process.env.ENERGYIQ_DUCKDB_PATH;
  const databasePath = join(root, "energy.duckdb");
  process.env.ENERGYIQ_DUCKDB_PATH = databasePath;
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  const files = new LocalFileAssetService(metadata, { storageRoot: join(root, "files") });
  try {
    ensureEnergyIqBootstrap(metadata);
    const connector = connectorFor(metadata);
    const context = {
      metadataStore: metadata,
      dataGateway: new LocalDataGateway(metadata),
      fileAssetService: files,
      userId: "dev-user",
      workspaceId: TUYA_OFFICE_WORKSPACE_ID,
    } as unknown as Required<ConfigApiContext>;
    const readRef = vi.spyOn(files, "readRef");
    const initialDraft = metadata.energyIq.projectSetup.getDraft({
      project_id: TUYA_OFFICE_PROJECT_ID,
      user_id: "dev-user",
    });
    metadata.energyIq.projectSetup.saveDraft({
      project_id: TUYA_OFFICE_PROJECT_ID,
      expected_revision: initialDraft.revision,
      user_id: "dev-user",
      document: {
        ...initialDraft.document,
        source_manifest: createEnergyIqSourceManifest(["f".repeat(64)], true),
        meter_mapping: {
          ...initialDraft.document.meter_mapping!,
          rows: initialDraft.document.meter_mapping!.rows.map((row, index) => index === 0
            ? { ...row, source_label: "Draft-only source label" }
            : row),
        },
      },
    });
    const draftBefore = metadata.energyIq.projectSetup.getDraft({
      project_id: TUYA_OFFICE_PROJECT_ID,
      user_id: "dev-user",
    });
    const state = { providerCalls: 0, artifactIndex: 0, materializedOverviewSnapshots: [] as string[] };
    const runner = createEnergyTuyaSyncRunner({
      context,
      now: () => Date.parse("2026-08-21T03:00:00.000Z"),
      id: () => `test-${++state.artifactIndex}`,
      syncTuyaEnergyReadings: async (input) => {
        state.providerCalls += 1;
        return artifact(input.startTime, input.endTime, state.providerCalls);
      },
      afterMaterialization: async ({ snapshot }, beforePublish) => {
        state.materializedOverviewSnapshots.push(snapshot.id);
        await beforePublish({
          persistentDirectory: root,
          pointerKey: `current:${TUYA_OFFICE_PROJECT_ID}`,
          previousProjectionKey: state.materializedOverviewSnapshots.at(-2) ?? null,
          candidateProjectionKey: snapshot.id,
        });
        return { projectionRef: `overview:${snapshot.id}` };
      },
    });
    const firstWindow = {
      startTime: Date.parse("2026-08-19T00:00:00.000Z"),
      endTime: Date.parse("2026-08-19T00:30:00.000Z"),
    };
    const first = await runner.run({
      connector,
      actorUserId: "dev-user",
      trigger: "backfill",
      window: firstWindow,
    });
    stitchFixture = {
      root,
      databasePath,
      metadata,
      connector,
      runner,
      firstWindow,
      first,
      draftBefore,
      readRefCalls: () => readRef.mock.calls.length,
      state,
    };
  } finally {
    if (previousDuckDbPath === undefined) delete process.env.ENERGYIQ_DUCKDB_PATH;
    else process.env.ENERGYIQ_DUCKDB_PATH = previousDuckDbPath;
  }
});

afterAll(() => {
  if (crashFixture) {
    crashFixture.metadata.close();
    try {
      rmSync(crashFixture.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (error) {
      if (process.platform !== "win32" || !(error instanceof Error) || !("code" in error)
        || (error.code !== "EPERM" && error.code !== "EBUSY")) throw error;
    }
  }
  if (stitchFixture) {
    stitchFixture.metadata.close();
    try {
      rmSync(stitchFixture.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (error) {
      if (process.platform !== "win32" || !(error instanceof Error) || !("code" in error)
        || (error.code !== "EPERM" && error.code !== "EBUSY")) throw error;
    }
  }
});

describe("Energy Tuya sync runner", () => {
  it("uses Singapore complete-day windows with a one-day overlap", () => {
    const now = Date.parse("2026-08-21T03:00:00.000Z");
    const completeDayEnd = Date.parse("2026-08-20T16:00:00.000Z");
    expect(resolveLatestCompleteSingaporeDayEnd(now)).toBe(completeDayEnd);
    expect(resolveScheduledTuyaSyncWindow({ nowMs: completeDayEnd + 3600000 })).toBeUndefined();
    expect(resolveScheduledTuyaSyncWindow({ nowMs: now, watermarkMs: completeDayEnd })).toEqual({startTime: completeDayEnd - 86400000, endTime: completeDayEnd + 7200000});
    expect(resolveScheduledTuyaSyncWindow({ nowMs: now })).toEqual({
      startTime: Date.parse("2026-07-31T16:00:00.000Z"),
      endTime: completeDayEnd + 7200000,
    });
    expect(resolveScheduledTuyaSyncWindow({
      nowMs: now,
      watermarkMs: Date.parse("2026-08-19T16:00:00.000Z"),
    })).toEqual({
      startTime: Date.parse("2026-08-18T16:00:00.000Z"),
      endTime: completeDayEnd + 7200000,
    });
    expect(resolveScheduledTuyaSyncWindow({ nowMs: now, watermarkMs: completeDayEnd + 7200000 })).toBeUndefined();
    // A backlog is fetched in capped passes: an uncapped window grows by a day for every night it is not closed,
    // until a run outlives the nightly maintenance window and is interrupted, which widens it again.
    const monthLong = resolveScheduledTuyaSyncWindow({ nowMs: now })!;
    expect(monthLong.endTime - monthLong.startTime).toBeGreaterThan(36 * 3600000);
    expect(resolveScheduledTuyaSyncWindow({ nowMs: now, maxWindowMs: 36 * 3600000 })).toEqual({
      startTime: monthLong.startTime,
      endTime: monthLong.startTime + 36 * 3600000,
    });
    // A window already inside the cap is untouched.
    expect(resolveScheduledTuyaSyncWindow({
      nowMs: now,
      watermarkMs: completeDayEnd,
      maxWindowMs: 36 * 3600000,
    })).toEqual({ startTime: completeDayEnd - 86400000, endTime: completeDayEnd + 7200000 });
    expect(() => resolveScheduledTuyaSyncWindow({ nowMs: now, maxWindowMs: 0 }))
      .toThrow("ENERGYIQ_SOURCE_SYNC_WINDOW_INVALID");
  });

  it("accepts an exact duplicate after Snapshot and Overview commit before source-run completion", async () => {
    if (!crashFixture) throw new Error("ENERGYIQ_TEST_CRASH_FIXTURE_REQUIRED");
    const {
      databasePath,
      projectionDirectory,
      metadata,
      context,
      pointerKey,
      cache,
      first,
    } = crashFixture;
    const previousDuckDbPath = process.env.ENERGYIQ_DUCKDB_PATH;
    process.env.ENERGYIQ_DUCKDB_PATH = databasePath;
    try {
      const connector = connectorFor(metadata);
      const currentOverview = await cache.readCurrent({
        pointerKey,
        persistentDirectory: projectionDirectory,
        validate: (value, identity) => value.snapshotId === identity.dataSnapshotId,
      });
      if (!currentOverview) throw new Error("ENERGYIQ_TEST_CURRENT_OVERVIEW_REQUIRED");
      const duplicated = await publishEnergyProjectManifestAtomically({
        materialization: {
          context,
          userId: "dev-user",
          projectId: TUYA_OFFICE_PROJECT_ID,
          requestedBatchId: first.batch.id,
          appendSourceSha256: first.batch.source_sha256,
          publishedSetupPin: {
            hierarchyRevisionId: connector.hierarchyRevisionId,
            hierarchySequence: connector.hierarchySequence,
            document: connector.publishedDocument,
          },
        },
        // The durable Overview pointer already committed before the source-run receipt crashed.
        // An exact duplicate therefore has no new pointer publication receipt to record.
        publishProjection: async () => ({
          projectionRef: createProjectOverviewProjectionRef(
            createProjectOverviewProjectionKey(currentOverview.identity),
          ),
        }),
      });

      expect(duplicated).toMatchObject({ duplicate: true, snapshot: { id: first.snapshot.id } });
      expect(metadata.energyIq.getProject(TUYA_OFFICE_PROJECT_ID).data_snapshot_id).toBe(first.snapshot.id);
      await expect(readEnergyFactProjectState({
        databasePath,
        projectId: TUYA_OFFICE_PROJECT_ID,
      })).resolves.toMatchObject({ dataSnapshotId: first.snapshot.id });
      expect(metadata.energyIq.findProjectDataPublication(TUYA_OFFICE_PROJECT_ID)).toBeUndefined();
    } finally {
      if (previousDuckDbPath === undefined) delete process.env.ENERGYIQ_DUCKDB_PATH;
      else process.env.ENERGYIQ_DUCKDB_PATH = previousDuckDbPath;
    }
  });

  it("recovers Snapshot, facts, and the previous Overview after a committed candidate pointer crashes", assertCrashRecovery);

  it("allows the next legal publication after crash recovery", async () => {
    if (!crashFixture || !crashRetryFixture) {
      throw new Error("ENERGYIQ_TEST_CRASH_RETRY_FIXTURE_REQUIRED");
    }
    const {
      databasePath,
      projectionDirectory,
      metadata,
      context,
      pointerKey,
      cache,
    } = crashFixture;
    const { candidateBatch, rotatedConnector, candidateIdentity } = crashRetryFixture;
    const previousDuckDbPath = process.env.ENERGYIQ_DUCKDB_PATH;
    process.env.ENERGYIQ_DUCKDB_PATH = databasePath;
    try {
      const retried = await publishEnergyProjectManifestAtomically({
        materialization: {
          context,
          userId: "dev-user",
          projectId: TUYA_OFFICE_PROJECT_ID,
          requestedBatchId: candidateBatch.id,
          appendSourceSha256: candidateBatch.source_sha256,
          publishedSetupPin: {
            hierarchyRevisionId: rotatedConnector.hierarchyRevisionId,
            hierarchySequence: rotatedConnector.hierarchySequence,
            document: rotatedConnector.publishedDocument,
          },
        },
        publishProjection: async ({ snapshot }, beforePublish) => {
          expect(snapshot.id).toBe(candidateIdentity.dataSnapshotId);
          const projectionKey = createProjectOverviewProjectionKey(candidateIdentity);
          await cache.materializeCurrent({
            pointerKey,
            projectionKey,
            identity: candidateIdentity,
            persistentDirectory: projectionDirectory,
            compute: async () => ({ snapshotId: snapshot.id }),
            validate: (value, identity) => value.snapshotId === identity.dataSnapshotId,
            beforePublish: async (publication) => beforePublish({
              persistentDirectory: projectionDirectory,
              pointerKey,
              ...publication,
            }),
          });
          return { projectionRef: createProjectOverviewProjectionRef(projectionKey) };
        },
      });

      expect(retried.snapshot.id).toBe(candidateIdentity.dataSnapshotId);
      expect(metadata.energyIq.getProject(TUYA_OFFICE_PROJECT_ID).data_snapshot_id)
        .toBe(candidateIdentity.dataSnapshotId);
      await expect(readEnergyFactProjectState({
        databasePath,
        projectId: TUYA_OFFICE_PROJECT_ID,
      })).resolves.toMatchObject({ dataSnapshotId: candidateIdentity.dataSnapshotId });
      await expect(cache.readCurrent({
        pointerKey,
        persistentDirectory: projectionDirectory,
        validate: (value, identity) => value.snapshotId === identity.dataSnapshotId,
      })).resolves.toMatchObject({
        identity: { dataSnapshotId: candidateIdentity.dataSnapshotId },
        value: { snapshotId: candidateIdentity.dataSnapshotId },
      });
      expect(metadata.energyIq.findProjectDataPublication(TUYA_OFFICE_PROJECT_ID)).toBeUndefined();
    } finally {
      if (previousDuckDbPath === undefined) delete process.env.ENERGYIQ_DUCKDB_PATH;
      else process.env.ENERGYIQ_DUCKDB_PATH = previousDuckDbPath;
    }
  });

  it("reuses exact windows, stitches event readings across batches, and never dirties Project Setup", async () => {
    if (!stitchFixture) throw new Error("ENERGYIQ_TEST_STITCH_FIXTURE_REQUIRED");
    const {
      databasePath,
      metadata,
      connector,
      runner,
      firstWindow,
      first,
      draftBefore,
      readRefCalls,
      state,
    } = stitchFixture;
    const previousDuckDbPath = process.env.ENERGYIQ_DUCKDB_PATH;
    process.env.ENERGYIQ_DUCKDB_PATH = databasePath;
    try {
      const repeated = await runner.run({
        connector,
        actorUserId: "dev-user",
        trigger: "manual",
        window: firstWindow,
      });
      expect(first.duplicate).toBe(false);
      expect(repeated).toMatchObject({ duplicate: true, run: { id: first.run.id } });
      expect(state.providerCalls).toBe(1);
      expect(readRefCalls()).toBe(1);
      expect(state.materializedOverviewSnapshots).toEqual([first.snapshot.id]);

      const second = await runner.run({
        connector,
        actorUserId: "dev-user",
        trigger: "scheduled",
        window: {
          startTime: Date.parse("2026-08-19T00:30:00.000Z"),
          endTime: Date.parse("2026-08-19T01:00:00.000Z"),
        },
      });
      expect(state.providerCalls).toBe(2);
      expect(readRefCalls()).toBe(2);
      expect(second.activeSourceSha256).toHaveLength(2);
      expect(JSON.parse(second.snapshot.audit_json)).toMatchObject({ intervalFactCount: 2 });
      expect(state.materializedOverviewSnapshots).toEqual([first.snapshot.id, second.snapshot.id]);
      const repeatedAfterSecond = await runner.run({
        connector,
        actorUserId: "dev-user",
        trigger: "manual",
        window: firstWindow,
      });
      expect(repeatedAfterSecond.activeSourceSha256).toEqual(first.activeSourceSha256);
      expect(repeatedAfterSecond.activeSourceSha256).toHaveLength(1);
      expect(state.providerCalls).toBe(2);
      const draftAfter = metadata.energyIq.projectSetup.getDraft({
        project_id: TUYA_OFFICE_PROJECT_ID,
        user_id: "dev-user",
      });
      expect(draftAfter).toEqual(draftBefore);
      expect(metadata.energyIq.sourceSync.findState({
        project_id: TUYA_OFFICE_PROJECT_ID,
        source_kind: "tuya",
      })).toMatchObject({
        watermark_ms: Date.parse("2026-08-19T01:00:00.000Z"),
        last_import_batch_id: second.batch.id,
        last_data_snapshot_id: second.snapshot.id,
      });
    } finally {
      if (previousDuckDbPath === undefined) delete process.env.ENERGYIQ_DUCKDB_PATH;
      else process.env.ENERGYIQ_DUCKDB_PATH = previousDuckDbPath;
    }
  });

  it("bounds Provider failures and rejects a hierarchy rotation before materialization", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-tuya-provider-boundary-"));
    const previousDuckDbPath = process.env.ENERGYIQ_DUCKDB_PATH;
    process.env.ENERGYIQ_DUCKDB_PATH = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const files = new LocalFileAssetService(metadata, { storageRoot: join(root, "files") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const connector = connectorFor(metadata);
      const context = {
        metadataStore: metadata,
        dataGateway: new LocalDataGateway(metadata),
        fileAssetService: files,
        userId: "dev-user",
        workspaceId: TUYA_OFFICE_WORKSPACE_ID,
      } as unknown as Required<ConfigApiContext>;
      const failing = createEnergyTuyaSyncRunner({
        context,
        id: () => "bounded-provider-failure",
        syncTuyaEnergyReadings: async () => {
          throw new Error("ENERGYIQ_TUYA_HTTP_ERROR:503 upstream body with secret-shaped text");
        },
      });
      await expect(failing.run({
        connector,
        actorUserId: "dev-user",
        trigger: "scheduled",
        window: {
          startTime: Date.parse("2026-08-19T01:00:00.000Z"),
          endTime: Date.parse("2026-08-19T01:30:00.000Z"),
        },
      })).rejects.toThrow("ENERGYIQ_TUYA_HTTP_ERROR:503");
      expect(JSON.stringify(metadata.energyIq.sourceSync.findState({
        project_id: TUYA_OFFICE_PROJECT_ID,
        source_kind: "tuya",
      }))).not.toContain("upstream body");

      let providerEntered!: () => void;
      const entered = new Promise<void>((resolve) => { providerEntered = resolve; });
      let releaseProvider!: () => void;
      const release = new Promise<void>((resolve) => { releaseProvider = resolve; });
      const waiting = createEnergyTuyaSyncRunner({
        context,
        id: () => "provider-wait-rotation",
        syncTuyaEnergyReadings: async (input) => {
          providerEntered();
          await release;
          return artifact(input.startTime, input.endTime, 1);
        },
      }).run({
        connector,
        actorUserId: "dev-user",
        trigger: "manual",
        window: {
          startTime: Date.parse("2026-08-19T01:30:00.000Z"),
          endTime: Date.parse("2026-08-19T02:00:00.000Z"),
        },
      });
      await entered;
      const currentProject = metadata.energyIq.getProject(TUYA_OFFICE_PROJECT_ID);
      metadata.energyIq.upsertProject({
        ...currentProject,
        hierarchy_revision_id: "published-mapping-rotated",
      });
      releaseProvider();
      await expect(waiting).rejects.toThrow("ENERGYIQ_PUBLISHED_SETUP_PIN_MISMATCH");
      expect(metadata.energyIq.getProject(TUYA_OFFICE_PROJECT_ID).data_snapshot_id)
        .toBe(currentProject.data_snapshot_id);
    } finally {
      if (previousDuckDbPath === undefined) delete process.env.ENERGYIQ_DUCKDB_PATH;
      else process.env.ENERGYIQ_DUCKDB_PATH = previousDuckDbPath;
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("does not publish a first Snapshot when Overview publication returns no receipt", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-tuya-first-publication-"));
    const previousDuckDbPath = process.env.ENERGYIQ_DUCKDB_PATH;
    const databasePath = join(root, "energy.duckdb");
    process.env.ENERGYIQ_DUCKDB_PATH = databasePath;
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const files = new LocalFileAssetService(metadata, { storageRoot: join(root, "files") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const context = {
        metadataStore: metadata,
        dataGateway: new LocalDataGateway(metadata),
        fileAssetService: files,
        userId: "dev-user",
        workspaceId: TUYA_OFFICE_WORKSPACE_ID,
      } as unknown as Required<ConfigApiContext>;
      const projectBefore = metadata.energyIq.getProject(TUYA_OFFICE_PROJECT_ID);
      const runner = createEnergyTuyaSyncRunner({
        context,
        now: () => Date.parse("2026-08-21T03:00:00.000Z"),
        id: () => "missing-overview-receipt",
        syncTuyaEnergyReadings: async (input) => artifact(input.startTime, input.endTime, 1),
        afterMaterialization: async () => undefined,
      });

      await expect(runner.run({
        connector: connectorFor(metadata),
        actorUserId: "dev-user",
        trigger: "scheduled",
        window: {
          startTime: Date.parse("2026-08-19T00:00:00.000Z"),
          endTime: Date.parse("2026-08-19T00:30:00.000Z"),
        },
      })).rejects.toThrow("ENERGYIQ_OVERVIEW_PROJECTION_NOT_READY");

      expect(metadata.energyIq.getProject(TUYA_OFFICE_PROJECT_ID).data_snapshot_id)
        .toBe(projectBefore.data_snapshot_id);
      expect(metadata.energyIq.findCurrentDataSnapshot(TUYA_OFFICE_PROJECT_ID)).toBeUndefined();
      await expect(readEnergyFactProjectState({
        databasePath,
        projectId: TUYA_OFFICE_PROJECT_ID,
      })).resolves.toBeNull();
      expect(metadata.energyIq.findProjectDataPublication(TUYA_OFFICE_PROJECT_ID)).toBeUndefined();
    } finally {
      if (previousDuckDbPath === undefined) delete process.env.ENERGYIQ_DUCKDB_PATH;
      else process.env.ENERGYIQ_DUCKDB_PATH = previousDuckDbPath;
      metadata.close();
      try {
        rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch (error) {
        if (process.platform !== "win32" || !(error instanceof Error) || !("code" in error)
          || (error.code !== "EPERM" && error.code !== "EBUSY")) throw error;
      }
    }
  });

  async function assertCrashRecovery() {
    if (!crashFixture) throw new Error("ENERGYIQ_TEST_CRASH_FIXTURE_REQUIRED");
    const {
      databasePath,
      projectionDirectory,
      metadata,
      context,
      pointerKey,
      cache,
      first,
      firstReleaseId,
    } = crashFixture;
    const previousDuckDbPath = process.env.ENERGYIQ_DUCKDB_PATH;
    process.env.ENERGYIQ_DUCKDB_PATH = databasePath;
    try {
      const draft = metadata.energyIq.projectSetup.getDraft({
        project_id: TUYA_OFFICE_PROJECT_ID,
        user_id: "dev-user",
      });
      const rotatedDraft = metadata.energyIq.projectSetup.saveDraft({
        project_id: TUYA_OFFICE_PROJECT_ID,
        expected_revision: draft.revision,
        user_id: "dev-user",
        document: {
          ...draft.document,
          meter_mapping: {
            ...draft.document.meter_mapping!,
            rows: draft.document.meter_mapping!.rows.map((row, index) => index === 0
              ? { ...row, display_name: `${row.display_name} rotated` }
              : row),
          },
        },
      });
      const rotatedRelease = metadata.energyIq.projectSetup.publishDraft({
        project_id: TUYA_OFFICE_PROJECT_ID,
        expected_revision: rotatedDraft.revision,
        user_id: "dev-user",
      });
      const rotatedConnector = connectorFor(metadata);
      const currentOverviewReleaseId = `test-release:${rotatedRelease.hierarchy_revision_id}`;
      const candidateWindow = {
        startTime: Date.parse("2026-08-19T01:00:00.000Z"),
        endTime: Date.parse("2026-08-19T01:30:00.000Z"),
      };
      const candidateBatch = persistTuyaImportArtifact({
        context,
        actorUserId: "dev-user",
        projectId: TUYA_OFFICE_PROJECT_ID,
        workspaceId: TUYA_OFFICE_WORKSPACE_ID,
        artifact: artifact(candidateWindow.startTime, candidateWindow.endTime, 9),
        createId: () => "pointer-crash-candidate",
      });
      const candidate = await materializeEnergyProjectManifest({
        context,
        userId: "dev-user",
        projectId: TUYA_OFFICE_PROJECT_ID,
        requestedBatchId: candidateBatch.id,
        appendSourceSha256: candidateBatch.source_sha256,
        publishedSetupPin: {
          hierarchyRevisionId: rotatedConnector.hierarchyRevisionId,
          hierarchySequence: rotatedConnector.hierarchySequence,
          document: rotatedConnector.publishedDocument,
        },
      });
      const candidateProject = metadata.energyIq.getProject(TUYA_OFFICE_PROJECT_ID);
      metadata.energyIq.upsertProject({ ...candidateProject, data_snapshot_id: first.snapshot.id });
      metadata.energyIq.beginProjectDataPublication({
        project_id: TUYA_OFFICE_PROJECT_ID,
        expected_previous_snapshot_id: first.snapshot.id,
      });
      metadata.energyIq.upsertProject({
        ...candidateProject,
        data_snapshot_id: candidate.snapshot.id,
      });
      metadata.energyIq.markProjectDataPublicationCandidate({
        project_id: TUYA_OFFICE_PROJECT_ID,
        expected_previous_snapshot_id: first.snapshot.id,
        candidate_snapshot_id: candidate.snapshot.id,
      });
      const candidateIdentity = overviewIdentityFor(
        candidate.snapshot.id,
        currentOverviewReleaseId,
        rotatedRelease.hierarchy_revision_id,
        databasePath,
      );
      const candidateProjectionKey = createProjectOverviewProjectionKey(candidateIdentity);
      await cache.materializeCurrent({
        pointerKey,
        projectionKey: candidateProjectionKey,
        identity: candidateIdentity,
        persistentDirectory: projectionDirectory,
        compute: async () => ({ snapshotId: candidate.snapshot.id }),
        validate: (value, identity) => value.snapshotId === identity.dataSnapshotId,
        beforePublish: async (publication) => {
          metadata.energyIq.markProjectOverviewPublicationCandidate({
            project_id: TUYA_OFFICE_PROJECT_ID,
            expected_previous_snapshot_id: first.snapshot.id,
            candidate_snapshot_id: candidate.snapshot.id,
            overview_persistent_directory: projectionDirectory,
            overview_pointer_key: pointerKey,
            previous_overview_projection_key: publication.previousProjectionKey,
            candidate_overview_projection_key: publication.candidateProjectionKey,
          });
        },
      });
      await recoverInterruptedEnergyProjectPublication({
        context,
        userId: "dev-user",
        projectId: TUYA_OFFICE_PROJECT_ID,
        requestedBatchId: candidateBatch.id,
        publishedSetupPin: {
          hierarchyRevisionId: rotatedConnector.hierarchyRevisionId,
          hierarchySequence: rotatedConnector.hierarchySequence,
          document: rotatedConnector.publishedDocument,
        },
      });

      expect(metadata.energyIq.getProject(TUYA_OFFICE_PROJECT_ID)).toMatchObject({
        data_snapshot_id: first.snapshot.id,
        hierarchy_revision_id: rotatedRelease.hierarchy_revision_id,
      });
      await expect(readEnergyFactProjectState({
        databasePath,
        projectId: TUYA_OFFICE_PROJECT_ID,
      })).resolves.toMatchObject({ dataSnapshotId: first.snapshot.id });
      await expect(cache.readCurrent({
        pointerKey,
        persistentDirectory: projectionDirectory,
        validate: (value, identity) => value.snapshotId === identity.dataSnapshotId,
      })).resolves.toMatchObject({
        identity: {
          dataSnapshotId: first.snapshot.id,
          projectReleaseId: firstReleaseId,
        },
        value: { snapshotId: first.snapshot.id },
      });
      crashRetryFixture = { candidateBatch, rotatedConnector, candidateIdentity };
    } finally {
      if (previousDuckDbPath === undefined) delete process.env.ENERGYIQ_DUCKDB_PATH;
      else process.env.ENERGYIQ_DUCKDB_PATH = previousDuckDbPath;
    }
  }

  it("reduces arbitrary failures to a bounded code", () => {
    expect(sourceSyncErrorCode(new Error("provider leaked many words"))).toBe("ENERGYIQ_SOURCE_SYNC_FAILED");
  });

  it("keeps a provider's code and its first words, and logs the whole reason for operators", () => {
    const refused = new Error("ENERGYIQ_TUYA_API_ERROR:1114:your_ip(203.0.113.9)_don't_have_access_to_this_API");
    expect(sourceSyncErrorCode(refused)).toBe("ENERGYIQ_TUYA_API_ERROR:1114:YOUR_IP");
    expect(sourceSyncErrorDetail(refused)).toBe("Error: ENERGYIQ_TUYA_API_ERROR:1114:your_ip(203.0.113.9)_don't_have_access_to_this_API");
    const offline = new TypeError("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) });
    expect(sourceSyncErrorCode(offline)).toBe("ENERGYIQ_SOURCE_SYNC_FAILED");
    expect(sourceSyncErrorDetail(offline)).toBe("TypeError: fetch failed <- ECONNREFUSED <- Error: connect ECONNREFUSED");
  });
});

const connectorFor = (metadata: ReturnType<typeof createMetadataStore>) => {
  const project = metadata.energyIq.getProject(TUYA_OFFICE_PROJECT_ID);
  const revision = metadata.energyIq.projectSetup.listHierarchyRevisions(project.id)
    .find((candidate) => candidate.id === project.hierarchy_revision_id)!;
  const document = JSON.parse(revision.snapshot_json) as {
    meter_mapping?: { rows?: Array<{ id: string }> };
  };
  return resolveEnergyTuyaProjectConnector({
    metadataStore: metadata,
    projectId: TUYA_OFFICE_PROJECT_ID,
    env: {
      ENERGYIQ_TUYA_CONNECTOR_PROJECT_ID: TUYA_OFFICE_PROJECT_ID,
      ENERGYIQ_TUYA_CONNECTOR_WORKSPACE_ID: TUYA_OFFICE_WORKSPACE_ID,
      ENERGYIQ_TUYA_DEVICE_BINDINGS_JSON: JSON.stringify(Object.fromEntries(
        (document.meter_mapping?.rows ?? []).map((row, index) => [
          row.id,
          `exampledevice${String(index + 1).padStart(3, "0")}`,
        ]),
      )),
    },
  });
};

const overviewIdentityFor = (
  dataSnapshotId: string,
  projectReleaseId: string,
  hierarchyRevisionId: string,
  databasePath: string,
): ProjectOverviewProjectionIdentity => ({
  resolverRevision: "test-resolver-v1",
  workspaceId: TUYA_OFFICE_WORKSPACE_ID,
  projectId: TUYA_OFFICE_PROJECT_ID,
  scopeId: "project",
  resource: "electricity",
  analysisWindow: "current-project-overview",
  period: "Custom",
  timezone: "Asia/Singapore",
  from: "2026-08-19T00:00:00.000Z",
  to: "2026-08-20T00:00:00.000Z",
  dataSnapshotId,
  projectReleaseId,
  reportTimePolicyRevisionId: "report-time-test-v1",
  hierarchyRevisionId,
  meterMappingRevisionId: hierarchyRevisionId,
  meterFormulaRevisionId: "meter-formula-test-v1",
  metricVersion: "metric-test-v1",
  businessCalendarVersion: "calendar-test-v1",
  tariffScheduleVersion: "tariff-test-v1",
  overviewDefinitionRevisionId: "overview-definition-test-v1",
  rendererKey: "energy-template-overview",
  rendererVersion: "renderer-test-v1",
  rendererContractVersion: "renderer-contract-test-v1",
  recipeId: "recipe-test",
  recipeVersion: "recipe-test-v1",
  metricRevisionIds: ["metric-revision-test-v1"],
  ruleRevisionIds: ["rule-revision-test-v1"],
  databasePath,
});

const artifact = (startTime: number, endTime: number, sequence: number): TuyaReportLogArtifact => ({
  schemaVersion: TUYA_REPORT_LOG_ARTIFACT_VERSION,
  provider: "tuya",
  region: "sg",
  endpoint: TUYA_SINGAPORE_ENDPOINT,
  createdAt: `2026-08-21T03:00:0${sequence}.000Z`,
  request: {
    startTime,
    endTime,
    codes: ["cur_power", "total_forward_energy"],
    deviceCount: TUYA_OFFICE_EXAMPLE_DEVICE_BINDINGS.length,
  },
  devices: TUYA_OFFICE_EXAMPLE_DEVICE_BINDINGS.map((binding, index) => ({
    sourceLabel: binding.sourceLabel,
    properties: {
      totalForwardEnergy: { code: "total_forward_energy", scale: 2, unit: "kw.h" },
      currentPower: { code: "cur_power", scale: 3, unit: "kW" },
    },
    logs: index === 0
      ? sequence === 1
        ? [
          { code: "total_forward_energy", eventTime: Date.parse("2026-08-19T00:05:00.000Z"), value: 10_000 },
          { code: "total_forward_energy", eventTime: Date.parse("2026-08-19T00:20:00.000Z"), value: 10_030 },
        ]
        : [
          { code: "total_forward_energy", eventTime: Date.parse("2026-08-19T00:35:00.000Z"), value: 10_090 },
          { code: "total_forward_energy", eventTime: Date.parse("2026-08-19T00:50:00.000Z"), value: 10_150 },
        ]
      : [],
  })),
});
