import { LocalDataGateway, readEnergyFactProjectState } from "@datafoundry/data-gateway";
import { LocalFileAssetService } from "@datafoundry/files";
import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { ConfigApiContext } from "../routes/types.js";
import { ensureEnergyIqBootstrap } from "./energy-bootstrap.js";
import { createEnergyTuyaDailyScheduler, resolveNextSingaporeLocalHour } from "./energy-tuya-scheduler.js";
import { resolveEnergyTuyaProjectConnector } from "./energy-tuya-connector.js";
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

describe("Tuya daily scheduler", () => {
  it("schedules the next 01:00 in Singapore", () => {
    expect(resolveNextSingaporeLocalHour(Date.parse("2026-08-20T16:30:00.000Z"), 1))
      .toBe(Date.parse("2026-08-20T17:00:00.000Z"));
    expect(resolveNextSingaporeLocalHour(Date.parse("2026-08-20T18:00:00.000Z"), 1))
      .toBe(Date.parse("2026-08-21T17:00:00.000Z"));
  });

  it("contains a dynamic Connector resolution failure instead of rejecting the process task", async () => {
    const sync = vi.fn();
    const scheduler = createEnergyTuyaDailyScheduler({
      enabled: true,
      localHour: 1,
      actorUserId: "dev-user",
      context: {} as Required<ConfigApiContext>,
      resolveConnector: () => { throw new Error("ENERGYIQ_TUYA_CONNECTOR_REVISION_MISMATCH"); },
      syncTuyaEnergyReadings: sync,
      now: () => Date.parse("2026-08-21T18:00:00.000Z"),
    });

    await expect(scheduler.runIfDue()).resolves.toBe("failed");
    expect(sync).not.toHaveBeenCalled();
  });

  it("steps aside while an administrator has taken the Project over in the app", async () => {
    const sync = vi.fn();
    const resolveConnector = vi.fn();
    const scheduler = createEnergyTuyaDailyScheduler({
      enabled: true,
      localHour: 1,
      actorUserId: "dev-user",
      context: {} as Required<ConfigApiContext>,
      resolveConnector,
      syncTuyaEnergyReadings: sync,
      skip: () => true,
      now: () => Date.parse("2026-08-21T18:00:00.000Z"),
    });

    await expect(scheduler.runIfDue()).resolves.toBe("disabled");
    expect(resolveConnector).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
  });

  it("aborts and drains an in-flight sync before shutdown completes", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-tuya-scheduler-stop-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const files = new LocalFileAssetService(metadata, { storageRoot: join(root, "files") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const project = metadata.energyIq.getProject(TUYA_OFFICE_PROJECT_ID);
      const revision = metadata.energyIq.projectSetup.listHierarchyRevisions(project.id)
        .find((candidate) => candidate.id === project.hierarchy_revision_id)!;
      let observedSignal: AbortSignal | undefined;
      const sync = vi.fn((input) => new Promise<never>((_resolve, reject) => {
        observedSignal = input.signal;
        input.signal?.addEventListener("abort", () => reject(new Error("ENERGYIQ_TUYA_REQUEST_ABORTED")), { once: true });
      }));
      const scheduler = createEnergyTuyaDailyScheduler({
        enabled: true,
        localHour: 1,
        actorUserId: "dev-user",
        context: {
          metadataStore: metadata,
          dataGateway: new LocalDataGateway(metadata),
          fileAssetService: files,
          userId: "dev-user",
          workspaceId: TUYA_OFFICE_WORKSPACE_ID,
        } as unknown as Required<ConfigApiContext>,
        resolveConnector: () => ({
          projectId: TUYA_OFFICE_PROJECT_ID,
          workspaceId: TUYA_OFFICE_WORKSPACE_ID,
          hierarchyRevisionId: revision.id,
          hierarchySequence: revision.sequence,
          publishedDocument: JSON.parse(revision.snapshot_json),
          connectorFingerprint: "c".repeat(64),
          devices: [{ deviceId: "exampledevice001", sourceLabel: "Meter 01" }],
          meterPoints: [{ meterPointId: "meter-01", sourceLabel: "Meter 01" }],
        }),
        syncTuyaEnergyReadings: sync,
        now: () => Date.parse("2026-08-21T18:00:00.000Z"),
      });

      const running = scheduler.runIfDue();
      await vi.waitFor(() => expect(sync).toHaveBeenCalledTimes(1));
      await scheduler.stop();
      expect(observedSignal?.aborted).toBe(true);
      await expect(running).resolves.toBe("failed");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("requires an Overview receipt before publishing a scheduled Snapshot", async () => {
    const fixture = schedulerFixture("missing-projection");
    try {
      const projectBefore = fixture.metadata.energyIq.getProject(TUYA_OFFICE_PROJECT_ID);
      const missingProjection = createEnergyTuyaDailyScheduler({
        enabled: true,
        localHour: 1,
        actorUserId: "dev-user",
        context: fixture.context,
        resolveConnector: () => fixture.connector,
        syncTuyaEnergyReadings: async (input) => schedulerArtifact(input.startTime, input.endTime),
        afterMaterialization: async () => undefined,
        now: () => Date.parse("2026-08-21T03:00:00.000Z"),
      });

      await expect(missingProjection.runIfDue()).resolves.toBe("failed");
      expect(fixture.metadata.energyIq.getProject(TUYA_OFFICE_PROJECT_ID).data_snapshot_id)
        .toBe(projectBefore.data_snapshot_id);
      await expect(readEnergyFactProjectState({
        databasePath: fixture.databasePath,
        projectId: TUYA_OFFICE_PROJECT_ID,
      }))
        .resolves.toBeNull();
    } finally {
      fixture.cleanup();
    }
  });

  it("closes a backlog in capped passes so one run cannot outgrow its maintenance window", async () => {
    const fixture = schedulerFixture("backlog-catch-up");
    try {
      const windows: Array<{ startTime: number; endTime: number }> = [];
      const catchUp = createEnergyTuyaDailyScheduler({
        enabled: true,
        localHour: 1,
        actorUserId: "dev-user",
        context: fixture.context,
        resolveConnector: () => fixture.connector,
        syncTuyaEnergyReadings: async (input) => {
          windows.push({ startTime: input.startTime, endTime: input.endTime });
          return schedulerArtifact(input.startTime, input.endTime);
        },
        afterMaterialization: async ({ snapshot }, beforePublish) => {
          await beforePublish({
            persistentDirectory: fixture.root,
            pointerKey: `current:${TUYA_OFFICE_PROJECT_ID}`,
            previousProjectionKey: null,
            candidateProjectionKey: `overview:${snapshot.id}`,
          });
          return { projectionRef: `overview:${snapshot.id}` };
        },
        maxWindowMs: 28 * 3600000,
        catchUpOverlapMs: 4 * 3600000,
        maxCatchUpRuns: 2,
        now: () => Date.parse("2026-08-21T03:00:00.000Z"),
      });

      await expect(catchUp.runIfDue()).resolves.toBe("succeeded");

      // Without the cap this month-long backlog is one request; each pass now stays inside the cap, and the
      // watermark it commits is where the next pass starts, so an interrupted catch-up keeps its earlier passes.
      expect(windows).toHaveLength(2);
      // Each pass stays at the size node-b's container survives, and still moves a day forward.
      for (const window of windows) expect(window.endTime - window.startTime).toBeLessThanOrEqual(28 * 3600000);
      // Every pass moves forward by most of a day — the first by a little less, because the initial window does
      // not start on a day boundary — so a backlog always closes rather than handing back the same window.
      expect(windows[1]!.startTime - windows[0]!.startTime).toBeGreaterThanOrEqual(20 * 3600000);
      expect(windows[1]!.endTime - windows[0]!.endTime).toBeGreaterThanOrEqual(20 * 3600000);
      expect(fixture.metadata.energyIq.sourceSync.findState({
        project_id: TUYA_OFFICE_PROJECT_ID,
        source_kind: "tuya",
      })!.watermark_ms).toBe(windows[1]!.endTime);
    } finally {
      fixture.cleanup();
    }
  });

  it("abandons a run that outlives its deadline instead of holding the source lock", async () => {
    const fixture = schedulerFixture("run-deadline");
    try {
      let observed: AbortSignal | undefined;
      const hung = createEnergyTuyaDailyScheduler({
        enabled: true,
        localHour: 1,
        actorUserId: "dev-user",
        context: fixture.context,
        resolveConnector: () => fixture.connector,
        // A request that never answers: the deadline, not the caller, has to end this.
        syncTuyaEnergyReadings: (input) => new Promise((_resolve, reject) => {
          observed = input.signal;
          input.signal?.addEventListener(
            "abort",
            () => reject(new Error("ENERGYIQ_TUYA_REQUEST_ABORTED")),
            { once: true },
          );
        }),
        runDeadlineMs: 50,
        now: () => Date.parse("2026-08-21T03:00:00.000Z"),
      });

      await expect(hung.runIfDue()).resolves.toBe("failed");
      expect(observed?.aborted).toBe(true);
      // The run is closed out, so the next sync, the backup preflight and a deploy are not blocked behind it.
      expect(fixture.metadata.energyIq.sourceSync.listRuns({
        project_id: TUYA_OFFICE_PROJECT_ID,
        source_kind: "tuya",
        limit: 5,
      }).filter((run) => run.status === "running")).toEqual([]);
    } finally {
      fixture.cleanup();
    }
  });

  it("never rolls back a published Snapshot for post-publication prewarm failure", async () => {
    const fixture = schedulerFixture("prewarm-failure");
    try {
      const afterPublication = vi.fn(async () => {
        throw new Error("ENERGYIQ_AI_PREWARM_FAILED");
      });
      const published = createEnergyTuyaDailyScheduler({
        enabled: true,
        localHour: 1,
        actorUserId: "dev-user",
        context: fixture.context,
        resolveConnector: () => fixture.connector,
        syncTuyaEnergyReadings: async (input) => schedulerArtifact(input.startTime, input.endTime),
        afterMaterialization: async ({ snapshot }, beforePublish) => {
          await beforePublish({
            persistentDirectory: fixture.root,
            pointerKey: `current:${TUYA_OFFICE_PROJECT_ID}`,
            previousProjectionKey: null,
            candidateProjectionKey: `overview:${snapshot.id}`,
          });
          return { projectionRef: `overview:${snapshot.id}` };
        },
        afterPublication,
        // One pass: this case is about the prewarm failure, not about closing the backlog behind it.
        maxCatchUpRuns: 1,
        now: () => Date.parse("2026-08-21T03:00:00.000Z"),
      });

      await expect(published.runIfDue()).resolves.toBe("succeeded");
      const currentSnapshot = fixture.metadata.energyIq.findCurrentDataSnapshot(TUYA_OFFICE_PROJECT_ID);
      expect(currentSnapshot).toBeDefined();
      await expect(readEnergyFactProjectState({
        databasePath: fixture.databasePath,
        projectId: TUYA_OFFICE_PROJECT_ID,
      }))
        .resolves.toMatchObject({ dataSnapshotId: currentSnapshot!.id });
      expect(afterPublication).toHaveBeenCalledTimes(1);
      expect(fixture.metadata.energyIq.sourceSync.findState({
        project_id: TUYA_OFFICE_PROJECT_ID,
        source_kind: "tuya",
      })).toMatchObject({ last_data_snapshot_id: currentSnapshot!.id });
    } finally {
      fixture.cleanup();
    }
  });
});

const schedulerFixture = (name: string) => {
  const root = mkdtempSync(join(tmpdir(), `energy-tuya-scheduler-${name}-`));
  const previousDuckDbPath = process.env.ENERGYIQ_DUCKDB_PATH;
  const databasePath = join(root, "energy.duckdb");
  process.env.ENERGYIQ_DUCKDB_PATH = databasePath;
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  const files = new LocalFileAssetService(metadata, { storageRoot: join(root, "files") });
  ensureEnergyIqBootstrap(metadata);
  const context = {
    metadataStore: metadata,
    dataGateway: new LocalDataGateway(metadata),
    fileAssetService: files,
    userId: "dev-user",
    workspaceId: TUYA_OFFICE_WORKSPACE_ID,
  } as unknown as Required<ConfigApiContext>;
  return {
    root,
    databasePath,
    metadata,
    context,
    connector: schedulerConnector(metadata),
    cleanup: () => {
      if (previousDuckDbPath === undefined) delete process.env.ENERGYIQ_DUCKDB_PATH;
      else process.env.ENERGYIQ_DUCKDB_PATH = previousDuckDbPath;
      metadata.close();
      try {
        rmSync(root, { recursive: true, force: true });
      } catch (error) {
        if (process.platform !== "win32" || !(error instanceof Error) || !("code" in error)
          || (error.code !== "EPERM" && error.code !== "EBUSY")) throw error;
      }
    },
  };
};

const schedulerConnector = (metadata: ReturnType<typeof createMetadataStore>) => {
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

const schedulerArtifact = (startTime: number, endTime: number): TuyaReportLogArtifact => ({
  schemaVersion: TUYA_REPORT_LOG_ARTIFACT_VERSION,
  provider: "tuya",
  region: "sg",
  endpoint: TUYA_SINGAPORE_ENDPOINT,
  createdAt: "2026-08-21T03:00:00.000Z",
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
    logs: [
      { code: "total_forward_energy" as const, eventTime: startTime, value: 10_000 + index * 100 },
      { code: "total_forward_energy" as const, eventTime: endTime, value: 10_100 + index * 100 },
    ],
  })),
});
