import { LocalDataGateway } from "@datafoundry/data-gateway";
import { LocalFileAssetService } from "@datafoundry/files";
import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { ConfigApiContext } from "../routes/types.js";
import { ensureEnergyIqBootstrap } from "./energy-bootstrap.js";
import { createEnergyLiveConnectionScheduler } from "./energy-live-connection-scheduler.js";
import {
  TUYA_REPORT_LOG_ARTIFACT_VERSION,
  TUYA_SINGAPORE_ENDPOINT,
  type TuyaEnergySyncInput,
  type TuyaReportLogArtifact,
} from "./tuya-openapi-client.js";
import { TUYA_OFFICE_PROJECT_ID, TUYA_OFFICE_WORKSPACE_ID } from "./tuya-office-project.js";

const HOUR_MS = 3_600_000;

describe("Live connection daily updates", () => {
  it("syncs an app connection on its own Singapore hour with the Project's own account", { timeout: 60_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-live-scheduler-"));
    const previousDuckDbPath = process.env.ENERGYIQ_DUCKDB_PATH;
    process.env.ENERGYIQ_DUCKDB_PATH = join(root, "energy.duckdb");
    const metadata = createMetadataStore({
      database_path: join(root, "metadata.sqlite"),
      secret_master_key: "test-master-key-for-live-connections",
    });
    try {
      ensureEnergyIqBootstrap(metadata);
      const context = {
        metadataStore: metadata,
        dataGateway: new LocalDataGateway(metadata),
        fileAssetService: new LocalFileAssetService(metadata, { storageRoot: join(root, "files") }),
        userId: "dev-user",
        workspaceId: TUYA_OFFICE_WORKSPACE_ID,
      } as unknown as Required<ConfigApiContext>;
      const rows = publishedRows(metadata);
      connect(metadata, rows, 9);

      const calls: TuyaEnergySyncInput[] = [];
      // 09:30 in Singapore: the hour this connection asked for.
      const now = Date.parse("2026-08-21T01:30:00.000Z");
      const scheduler = createEnergyLiveConnectionScheduler({
        context,
        env: {},
        now: () => now,
        syncTuyaEnergyReadings: async (input) => {
          calls.push(input);
          return artifact(rows, input.startTime, input.endTime);
        },
        afterMaterialization: (projectId) => async ({ snapshot }, beforePublish) => {
          await beforePublish({
            persistentDirectory: root,
            pointerKey: `current:${projectId}`,
            previousProjectionKey: null,
            candidateProjectionKey: `overview:${snapshot.id}`,
          });
          return { projectionRef: `overview:${snapshot.id}` };
        },
      });

      await scheduler.runDue();

      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0]!.credentials).toEqual({ accessId: "abcd1234efgh5678ijkl", accessSecret: "secretsecretsecretsecret12345678" });
      expect(calls[0]!.devices).toHaveLength(rows.length);
      // A first sync starts a week back rather than at the start of the month.
      const latestCompleteDayEnd = Date.parse("2026-08-20T16:00:00.000Z");
      expect(calls[0]!.startTime).toBe(latestCompleteDayEnd - 7 * 24 * HOUR_MS);
      for (const call of calls) expect(call.endTime - call.startTime).toBeLessThanOrEqual(28 * HOUR_MS);
      const state = metadata.energyIq.sourceSync.findState({ project_id: TUYA_OFFICE_PROJECT_ID, source_kind: "tuya" });
      expect(state?.watermark_ms).toBe(latestCompleteDayEnd + 2 * HOUR_MS);
      expect(scheduler.isRunning(TUYA_OFFICE_PROJECT_ID)).toBe(false);

      // Another hour leaves it alone.
      calls.length = 0;
      metadata.energyIq.liveConnectors.saveSchedule({
        project_id: TUYA_OFFICE_PROJECT_ID,
        sync_enabled: true,
        sync_local_hour: 4,
        actor_user_id: "dev-user",
        updated_at: new Date(now).toISOString(),
      });
      await scheduler.runDue();
      expect(calls).toHaveLength(0);
    } finally {
      if (previousDuckDbPath === undefined) delete process.env.ENERGYIQ_DUCKDB_PATH;
      else process.env.ENERGYIQ_DUCKDB_PATH = previousDuckDbPath;
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

type Row = { id: string; source_label: string };

const publishedRows = (metadata: ReturnType<typeof createMetadataStore>): Row[] => {
  const project = metadata.energyIq.getProject(TUYA_OFFICE_PROJECT_ID);
  const revision = metadata.energyIq.projectSetup.listHierarchyRevisions(project.id)
    .find((candidate) => candidate.id === project.hierarchy_revision_id)!;
  return (JSON.parse(revision.snapshot_json) as { meter_mapping: { rows: Row[] } }).meter_mapping.rows;
};

const connect = (metadata: ReturnType<typeof createMetadataStore>, rows: Row[], localHour: number): void => {
  const secretRef = metadata.secrets.put({
    workspace_id: "energyiq-live-connectors",
    user_id: "dev-user",
    owner_kind: "energyiq-live-connector",
    owner_id: TUYA_OFFICE_PROJECT_ID,
    value: { accessId: "abcd1234efgh5678ijkl", accessSecret: "secretsecretsecretsecret12345678" },
  });
  const at = "2026-08-21T00:00:00.000Z";
  metadata.energyIq.liveConnectors.saveAccount({
    project_id: TUYA_OFFICE_PROJECT_ID,
    workspace_id: TUYA_OFFICE_WORKSPACE_ID,
    secret_ref: secretRef,
    secret_workspace_id: "energyiq-live-connectors",
    secret_user_id: "dev-user",
    access_id_hint: "abcd…ijkl",
    actor_user_id: "dev-user",
    checked_at: at,
    reset_bindings: false,
  });
  metadata.energyIq.liveConnectors.saveBindings({
    project_id: TUYA_OFFICE_PROJECT_ID,
    bindings: Object.fromEntries(rows.map((row, index) => [row.id, {
      device_id: `livedevice${String(index + 1).padStart(4, "0")}`,
      device_name: `Device ${index + 1}`,
    }])),
    actor_user_id: "dev-user",
    updated_at: at,
  });
  metadata.energyIq.liveConnectors.saveSchedule({
    project_id: TUYA_OFFICE_PROJECT_ID,
    sync_enabled: true,
    sync_local_hour: localHour,
    actor_user_id: "dev-user",
    updated_at: at,
  });
};

const artifact = (rows: Row[], startTime: number, endTime: number): TuyaReportLogArtifact => ({
  schemaVersion: TUYA_REPORT_LOG_ARTIFACT_VERSION,
  provider: "tuya",
  region: "sg",
  endpoint: TUYA_SINGAPORE_ENDPOINT,
  createdAt: new Date(endTime).toISOString(),
  request: { startTime, endTime, codes: ["cur_power", "total_forward_energy"], deviceCount: rows.length },
  devices: rows.map((row, index) => ({
    sourceLabel: row.source_label,
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
