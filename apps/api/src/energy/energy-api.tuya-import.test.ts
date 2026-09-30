import { LocalDataGateway } from "@datafoundry/data-gateway";
import { LocalFileAssetService } from "@datafoundry/files";
import { createEnergyIqSourceManifest, createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import type { ConfigApiContext } from "../routes/types.js";
import { ensureEnergyIqBootstrap } from "./energy-bootstrap.js";
import { handleEnergyApiRequest } from "./energy-api.js";
import { withEnergyProjectMaterializationLock } from "./energy-project-materialization.js";
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

describe("Tuya Energy API import", () => {
  it("syncs the Office profile into an immutable Import Batch and materializes it through the shared Fact pipeline", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-tuya-import-"));
    const previousDuckDbPath = process.env.ENERGYIQ_DUCKDB_PATH;
    process.env.ENERGYIQ_DUCKDB_PATH = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const files = new LocalFileAssetService(metadata, { storageRoot: join(root, "files") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const connector = testConnector(metadata);
      const context = {
        metadataStore: metadata,
        dataGateway: new LocalDataGateway(metadata),
        fileAssetService: files,
        userId: "dev-user",
        workspaceId: TUYA_OFFICE_WORKSPACE_ID,
      } as unknown as Required<ConfigApiContext>;
      const response = await handleEnergyApiRequest(
        jsonRequest({ startTime: "2024-03-09T16:00:00.000Z", endTime: "2024-03-09T16:15:00.000Z" }),
        ["projects", TUYA_OFFICE_PROJECT_ID, "imports", "tuya"],
        context,
        {
          selectCurrentOverviewPeriod: async () => { throw new Error("NOT_USED"); },
          resolveTuyaProjectConnector: () => connector,
          syncTuyaEnergyReadings: async (input) => {
            expect(input.devices).toHaveLength(20);
            return artifact();
          },
        },
      );
      expect(response).toMatchObject({
        status: 201,
        body: {
          success: true,
          data: {
            duplicate: false,
            batch: {
              sourceKind: "tuya",
              status: "inspected",
              inspection: {
                sourceLabels: expect.arrayContaining([{ label: "Panel A Total", rowCount: 2 }]),
              },
            },
          },
        },
      });
      const batch = metadata.energyIq.listImportBatches(TUYA_OFFICE_PROJECT_ID)[0]!;
      const stored = files.readRef({
        user_id: "dev-user",
        workspace_id: TUYA_OFFICE_WORKSPACE_ID,
        id: batch.file_asset_ref_id!,
      });
      expect(stored.body.toString("utf8")).not.toContain("access_token");
      expect(stored.body.toString("utf8")).not.toContain("accessSecret");

      const draft = metadata.energyIq.projectSetup.getDraft({
        project_id: TUYA_OFFICE_PROJECT_ID,
        user_id: "dev-user",
      });
      metadata.energyIq.projectSetup.saveDraft({
        project_id: TUYA_OFFICE_PROJECT_ID,
        expected_revision: draft.revision,
        user_id: "dev-user",
        document: {
          ...draft.document,
          source_manifest: createEnergyIqSourceManifest([batch.source_sha256], true),
        },
      });
      const prewarmAnalysis = vi.fn()
        .mockResolvedValueOnce({
          status: "materialized",
          contextPackage: {
            projectionRef: "analysis-context:tuya:first",
            identity: {
              projectId: TUYA_OFFICE_PROJECT_ID,
              metricRevisionIds: [],
              ruleRevisionIds: [],
            },
          },
        })
        .mockResolvedValueOnce({
          status: "unchanged",
          contextPackage: {
            projectionRef: "analysis-context:tuya:first",
            identity: {
              projectId: TUYA_OFFICE_PROJECT_ID,
              metricRevisionIds: [],
              ruleRevisionIds: [],
            },
          },
        });
      const beforeFailedMaterialization = metadata.energyIq.getProject(TUYA_OFFICE_PROJECT_ID);
      const failedMaterialization = await handleEnergyApiRequest(
        jsonRequest({}),
        ["projects", TUYA_OFFICE_PROJECT_ID, "imports", batch.id, "materialize"],
        context,
        {
          selectCurrentOverviewPeriod: async () => { throw new Error("NOT_USED"); },
          materializeCurrentOverviewProjection: async () => {
            throw new Error("ENERGYIQ_OVERVIEW_PROJECTION_VALIDATION_FAILED");
          },
          prewarmAnalysisContextPackage: prewarmAnalysis as never,
        },
      );
      expect(failedMaterialization).toMatchObject({
        body: {
          success: false,
          error: { message: "ENERGYIQ_OVERVIEW_PROJECTION_VALIDATION_FAILED" },
        },
      });
      expect(metadata.energyIq.getProject(TUYA_OFFICE_PROJECT_ID).data_snapshot_id)
        .toBe(beforeFailedMaterialization.data_snapshot_id);
      expect(metadata.energyIq.findCurrentDataSnapshot(TUYA_OFFICE_PROJECT_ID)).toBeUndefined();
      expect(metadata.energyIq.findProjectDataPublication(TUYA_OFFICE_PROJECT_ID)).toBeUndefined();

      const materialized = await handleEnergyApiRequest(
        jsonRequest({}),
        ["projects", TUYA_OFFICE_PROJECT_ID, "imports", batch.id, "materialize"],
        context,
        {
          selectCurrentOverviewPeriod: async () => { throw new Error("NOT_USED"); },
          materializeCurrentOverviewProjection: (async (input: {
            beforePublish?: (publication: {
              persistentDirectory: string;
              pointerKey: string;
              previousProjectionKey: string | null;
              candidateProjectionKey: string;
            }) => Promise<void>;
          }) => {
            await input.beforePublish?.({
              persistentDirectory: root,
              pointerKey: `current:${TUYA_OFFICE_PROJECT_ID}`,
              previousProjectionKey: null,
              candidateProjectionKey: "tuya-overview-projection:materialize",
            });
            return {
              changed: true,
              resolution: {},
              contextPackage: {
                projectionRef: "tuya-overview-projection:materialize",
                identity: {},
                evidenceRefs: [],
                snapshot: {},
              },
            };
          }) as never,
          prewarmAnalysisContextPackage: prewarmAnalysis as never,
        },
      );
      expect(materialized.status, JSON.stringify(materialized)).toBe(200);
      expect(materialized).toMatchObject({
        status: 200,
        body: {
          success: true,
          data: {
            batch: {
              sourceKind: "tuya",
              status: "materialized",
              materialization: {
                materializerContractVersion: "energy-tuya-event-resampled-15m-v2",
                intervalFactCount: 1,
              },
            },
            dataSnapshot: { projectId: TUYA_OFFICE_PROJECT_ID },
            analysisContextPrewarm: {
              status: "materialized",
              projectionRef: "analysis-context:tuya:first",
            },
          },
        },
      });

      const synced = await handleEnergyApiRequest(
        jsonRequest({ startTime: "2024-03-09T16:00:00.000Z", endTime: "2024-03-09T16:15:00.000Z" }),
        ["projects", TUYA_OFFICE_PROJECT_ID, "imports", "tuya", "sync"],
        context,
        {
          selectCurrentOverviewPeriod: async () => { throw new Error("NOT_USED"); },
          resolveTuyaProjectConnector: () => connector,
          syncTuyaEnergyReadings: async () => artifact(),
          materializeCurrentOverviewProjection: (async (input: {
            beforePublish?: (publication: {
              persistentDirectory: string;
              pointerKey: string;
              previousProjectionKey: string | null;
              candidateProjectionKey: string;
            }) => Promise<void>;
          }) => {
            expect(input.beforePublish).toBeTypeOf("function");
            return {
              changed: false,
              resolution: {},
              contextPackage: {
                projectionRef: "tuya-overview-projection:test",
                identity: {},
                evidenceRefs: [],
                snapshot: {},
              },
            };
          }) as never,
          prewarmAnalysisContextPackage: prewarmAnalysis as never,
        },
      );
      expect(synced).toMatchObject({
        status: 201,
        body: {
          success: true,
          data: {
            duplicate: false,
            materializationDuplicate: true,
            run: { status: "succeeded" },
            readiness: { ready: true },
            analysisContextPrewarm: {
              status: "unchanged",
              projectionRef: "analysis-context:tuya:first",
            },
          },
        },
      });
      expect(prewarmAnalysis).toHaveBeenCalledTimes(2);
      const status = await handleEnergyApiRequest(
        getRequest(),
        ["projects", TUYA_OFFICE_PROJECT_ID, "imports", "tuya", "status"],
        context,
        {
          selectCurrentOverviewPeriod: async () => { throw new Error("NOT_USED"); },
          resolveTuyaProjectConnector: () => connector,
        },
      );
      expect(status, JSON.stringify(status)).toMatchObject({
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
        body: {
          success: true,
          data: {
            connectivityStatus: "unknown",
            activeSourceCount: 1,
            meterDataHealthSummary: {
              total: 20,
              usable: 1,
              insufficientHistory: 1,
              noReadings: 18,
            },
            silentSourceLabels: expect.arrayContaining([
              "Panel A Meter 03",
            ]),
            insufficientHistorySourceLabels: [
              "Panel A Lighting",
            ],
            meterDataHealth: expect.arrayContaining([
              expect.objectContaining({
                meterPointId: "panel-a-total",
                sourceLabel: "Panel A Total",
                status: "usable",
                cumulativeReadingCount: 2,
                intervalFactCount: 1,
              }),
              expect.objectContaining({
                meterPointId: "panel-a-lighting",
                sourceLabel: "Panel A Lighting",
                status: "insufficient_history",
                cumulativeReadingCount: 1,
                intervalFactCount: 0,
              }),
              expect.objectContaining({
                meterPointId: "panel-a-meter-03",
                sourceLabel: "Panel A Meter 03",
                status: "no_readings",
                cumulativeReadingCount: 0,
                intervalFactCount: 0,
              }),
            ]),
            recentRuns: [{ status: "succeeded" }],
          },
        },
      });
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
  }, 30_000);

  it("rejects another Project and browser-managed device bindings before calling Tuya", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-tuya-boundary-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const files = new LocalFileAssetService(metadata, { storageRoot: join(root, "files") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const project = metadata.energyIq.getProject(TUYA_OFFICE_PROJECT_ID);
      const revision = metadata.energyIq.projectSetup.listHierarchyRevisions(project.id)
        .find((candidate) => candidate.id === project.hierarchy_revision_id)!;
      const document = JSON.parse(revision.snapshot_json) as {
        meter_mapping?: { rows?: Array<{ id: string }> };
      };
      const env = {
        ENERGYIQ_TUYA_CONNECTOR_PROJECT_ID: TUYA_OFFICE_PROJECT_ID,
        ENERGYIQ_TUYA_CONNECTOR_WORKSPACE_ID: TUYA_OFFICE_WORKSPACE_ID,
        ENERGYIQ_TUYA_DEVICE_BINDINGS_JSON: JSON.stringify(Object.fromEntries(
          (document.meter_mapping?.rows ?? []).map((row, index) => [
            row.id,
            `exampledevice${String(index + 1).padStart(3, "0")}`,
          ]),
        )),
      };
      const sync = vi.fn(async () => artifact());
      const dependencies = {
        selectCurrentOverviewPeriod: async () => { throw new Error("NOT_USED"); },
        resolveTuyaProjectConnector: (input: Parameters<typeof resolveEnergyTuyaProjectConnector>[0]) =>
          resolveEnergyTuyaProjectConnector({ ...input, env }),
        syncTuyaEnergyReadings: sync,
      };
      const context = {
        metadataStore: metadata,
        dataGateway: new LocalDataGateway(metadata),
        fileAssetService: files,
        userId: "dev-user",
        workspaceId: "default",
      } as unknown as Required<ConfigApiContext>;

      const wrongProject = await handleEnergyApiRequest(
        getRequest(),
        ["projects", "ngee-ann-polytechnic", "imports", "tuya", "status"],
        context,
        dependencies,
      );
      expect(wrongProject).toMatchObject({
        status: 400,
        body: { success: false, error: { message: "ENERGYIQ_TUYA_PROJECT_UNSUPPORTED" } },
      });

      const browserBindings = await handleEnergyApiRequest(
        jsonRequest({
          startTime: "2026-08-01T00:00:00.000Z",
          endTime: "2026-08-02T00:00:00.000Z",
          devices: [{ deviceId: "attackerdevice001", sourceLabel: "Injected" }],
        }),
        ["projects", TUYA_OFFICE_PROJECT_ID, "imports", "tuya"],
        { ...context, workspaceId: TUYA_OFFICE_WORKSPACE_ID },
        dependencies,
      );
      expect(browserBindings).toMatchObject({
        status: 400,
        body: { success: false, error: { message: "ENERGYIQ_TUYA_DEVICE_BINDINGS_SERVER_MANAGED" } },
      });
      expect(sync).not.toHaveBeenCalled();
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("fails current imports and Tuya status reads closed while a Project publication journal is unresolved", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-tuya-publication-read-gate-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const files = new LocalFileAssetService(metadata, { storageRoot: join(root, "files") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const provider = vi.fn();
      const context = {
        metadataStore: metadata,
        dataGateway: new LocalDataGateway(metadata),
        fileAssetService: files,
        userId: "dev-user",
        workspaceId: TUYA_OFFICE_WORKSPACE_ID,
      } as unknown as Required<ConfigApiContext>;
      const project = metadata.energyIq.getProject(TUYA_OFFICE_PROJECT_ID);
      metadata.energyIq.beginProjectDataPublication({
        project_id: TUYA_OFFICE_PROJECT_ID,
        expected_previous_snapshot_id: project.data_snapshot_id,
      });
      const changesBefore = (metadata.db.prepare("SELECT total_changes() AS value").get() as {
        value: number;
      }).value;
      const dependencies = {
        selectCurrentOverviewPeriod: async () => { throw new Error("NOT_USED"); },
        resolveTuyaProjectConnector: () => testConnector(metadata),
        syncTuyaEnergyReadings: provider,
      };

      const imports = await handleEnergyApiRequest(
        getRequest(),
        ["projects", TUYA_OFFICE_PROJECT_ID, "imports"],
        context,
        dependencies,
      );
      const status = await handleEnergyApiRequest(
        getRequest(),
        ["projects", TUYA_OFFICE_PROJECT_ID, "imports", "tuya", "status"],
        context,
        dependencies,
      );
      const coverage = await handleEnergyApiRequest(
        getRequest(),
        ["projects", TUYA_OFFICE_PROJECT_ID, "data-coverage"],
        context,
        dependencies,
      );
      const setup = await handleEnergyApiRequest(
        getRequest(),
        ["projects", TUYA_OFFICE_PROJECT_ID, "setup"],
        context,
        dependencies,
      );
      const templateChange = await handleEnergyApiRequest(
        getRequest(),
        ["projects", TUYA_OFFICE_PROJECT_ID, "template-change-context"],
        context,
        dependencies,
      );
      const hierarchy = await handleEnergyApiRequest(
        getRequest(),
        ["projects", TUYA_OFFICE_PROJECT_ID, "hierarchy"],
        context,
        dependencies,
      );

      expect(imports).toMatchObject({
        status: 409,
        body: { success: false, error: { message: "ENERGYIQ_PROJECT_DATA_PUBLICATION_RECOVERY_REQUIRED" } },
      });
      expect(status).toMatchObject({
        status: 409,
        body: { success: false, error: { message: "ENERGYIQ_PROJECT_DATA_PUBLICATION_RECOVERY_REQUIRED" } },
      });
      expect(coverage).toMatchObject({
        status: 409,
        body: { success: false, error: { message: "ENERGYIQ_PROJECT_DATA_PUBLICATION_RECOVERY_REQUIRED" } },
      });
      expect(setup).toMatchObject({
        status: 409,
        body: { success: false, error: { message: "ENERGYIQ_PROJECT_DATA_PUBLICATION_RECOVERY_REQUIRED" } },
      });
      expect(templateChange).toMatchObject({
        status: 409,
        body: { success: false, error: { message: "ENERGYIQ_PROJECT_DATA_PUBLICATION_RECOVERY_REQUIRED" } },
      });
      expect(hierarchy).toMatchObject({
        status: 409,
        body: { success: false, error: { message: "ENERGYIQ_PROJECT_DATA_PUBLICATION_RECOVERY_REQUIRED" } },
      });
      expect(provider).not.toHaveBeenCalled();
      expect((metadata.db.prepare("SELECT total_changes() AS value").get() as {
        value: number;
      }).value).toBe(changesBefore);

      metadata.energyIq.abortProjectDataPublication({
        project_id: project.id,
        expected_current_snapshot_id: project.data_snapshot_id,
        previous_snapshot_id: project.data_snapshot_id,
      });
      let releaseWriter!: () => void;
      const writerGate = new Promise<void>((resolve) => { releaseWriter = resolve; });
      let writerEntered!: () => void;
      const writerStarted = new Promise<void>((resolve) => { writerEntered = resolve; });
      const writer = withEnergyProjectMaterializationLock(
        project.workspace_id,
        project.id,
        async () => {
          writerEntered();
          await writerGate;
        },
      );
      await writerStarted;
      let readSettled = false;
      const waitingRead = handleEnergyApiRequest(
        getRequest(),
        ["projects", TUYA_OFFICE_PROJECT_ID, "imports"],
        context,
        dependencies,
      ).finally(() => { readSettled = true; });
      await Promise.resolve();
      expect(readSettled).toBe(false);
      releaseWriter();
      await writer;
      await expect(waitingRead).resolves.toMatchObject({ status: 200 });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

const testConnector = (metadata: ReturnType<typeof createMetadataStore>) => {
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

const jsonRequest = (body: unknown): IncomingMessage => {
  const stream = new PassThrough();
  Object.assign(stream, { method: "POST", headers: { "content-type": "application/json" } });
  stream.end(JSON.stringify(body));
  return stream as unknown as IncomingMessage;
};

const getRequest = (): IncomingMessage => {
  const stream = new PassThrough();
  Object.assign(stream, { method: "GET", headers: {} });
  stream.end();
  return stream as unknown as IncomingMessage;
};

const artifact = (): TuyaReportLogArtifact => ({
  schemaVersion: TUYA_REPORT_LOG_ARTIFACT_VERSION,
  provider: "tuya",
  region: "sg",
  endpoint: TUYA_SINGAPORE_ENDPOINT,
  createdAt: "2024-03-09T16:20:00.000Z",
  request: {
    startTime: 1_710_000_000_000,
    endTime: 1_710_000_900_000,
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
      ? [
        { code: "total_forward_energy", eventTime: 1_710_000_000_000, value: 83036 },
        { code: "cur_power", eventTime: 1_710_000_000_000, value: 332 },
        { code: "total_forward_energy", eventTime: 1_710_000_900_000, value: 83046 },
      ]
      : index === 1
        ? [{ code: "total_forward_energy", eventTime: 1_710_000_000_000, value: 20100 }]
        : [],
  })),
});
