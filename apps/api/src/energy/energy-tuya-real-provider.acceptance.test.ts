import { LocalDataGateway } from "@datafoundry/data-gateway";
import { LocalFileAssetService } from "@datafoundry/files";
import { createMetadataStore } from "@datafoundry/metadata";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { ConfigApiContext } from "../routes/types.js";
import { ensureEnergyIqBootstrap } from "./energy-bootstrap.js";
import { resolveEnergyTuyaProjectConnector } from "./energy-tuya-connector.js";
import { createEnergyTuyaSyncRunner } from "./energy-tuya-sync-runner.js";
import { materializeCurrentProjectOverviewProjection } from "./project-analysis-resolver.js";
import { createTuyaOpenApiClientFromEnv } from "./tuya-openapi-client.js";
import { TUYA_OFFICE_PROJECT_ID, TUYA_OFFICE_WORKSPACE_ID } from "./tuya-office-project.js";

const REQUIRED_ENV = [
  "ENERGYIQ_TUYA_ACCESS_ID",
  "ENERGYIQ_TUYA_ACCESS_SECRET",
  "ENERGYIQ_TUYA_CONNECTOR_PROJECT_ID",
  "ENERGYIQ_TUYA_CONNECTOR_WORKSPACE_ID",
  "ENERGYIQ_TUYA_DEVICE_BINDINGS_JSON",
] as const;

const realProviderConfigured = REQUIRED_ENV.every((key) => Boolean(process.env[key]?.trim()));

describe.skipIf(!realProviderConfigured)("Tuya Singapore real Provider acceptance", () => {
  it("materializes one protected Tuya window into an isolated current Snapshot", async () => {
    const retainedRoot = process.env.ENERGYIQ_TUYA_ACCEPTANCE_STORAGE_ROOT?.trim();
    const root = retainedRoot ?? mkdtempSync(join(tmpdir(), "energy-tuya-real-provider-"));
    if (retainedRoot) mkdirSync(root, { recursive: true });
    const previousDuckDbPath = process.env.ENERGYIQ_DUCKDB_PATH;
    process.env.ENERGYIQ_DUCKDB_PATH = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const files = new LocalFileAssetService(metadata, { storageRoot: join(root, "files") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const connector = resolveEnergyTuyaProjectConnector({
        metadataStore: metadata,
        projectId: TUYA_OFFICE_PROJECT_ID,
      });
      const context = {
        metadataStore: metadata,
        dataGateway: new LocalDataGateway(metadata),
        fileAssetService: files,
        userId: "dev-user",
        workspaceId: TUYA_OFFICE_WORKSPACE_ID,
      } as unknown as Required<ConfigApiContext>;
      const client = createTuyaOpenApiClientFromEnv();
      const result = await createEnergyTuyaSyncRunner({
        context,
        syncTuyaEnergyReadings: (input) => client.syncEnergyReadings(input),
        afterMaterialization: async (_materialized, beforePublish) => {
          const projection = await materializeCurrentProjectOverviewProjection({
            metadataStore: metadata,
            dataGateway: context.dataGateway,
            user: metadata.users.getById({ user_id: "dev-user" }),
            workspaceId: TUYA_OFFICE_WORKSPACE_ID,
            projectId: TUYA_OFFICE_PROJECT_ID,
            beforePublish,
          });
          return { projectionRef: projection.contextPackage.projectionRef };
        },
      }).run({
        connector,
        actorUserId: "dev-user",
        trigger: "backfill",
        window: {
          startTime: Date.parse("2026-08-18T16:00:00.000Z"),
          endTime: Date.parse("2026-08-19T16:00:00.000Z"),
        },
      });

      const audit = JSON.parse(result.snapshot.audit_json) as { intervalFactCount?: number };
      expect(result.duplicate).toBe(false);
      expect(result.run.status).toBe("succeeded");
      expect(result.batch).toMatchObject({ project_id: TUYA_OFFICE_PROJECT_ID, source_kind: "tuya" });
      expect(result.snapshot.project_id).toBe(TUYA_OFFICE_PROJECT_ID);
      expect(result.activeSourceSha256).toContain(result.batch.source_sha256);
      expect(audit.intervalFactCount).toBeGreaterThan(0);
    } finally {
      if (previousDuckDbPath === undefined) delete process.env.ENERGYIQ_DUCKDB_PATH;
      else process.env.ENERGYIQ_DUCKDB_PATH = previousDuckDbPath;
      metadata.close();
      if (!retainedRoot) {
        try {
          rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        } catch (error) {
          if (process.platform !== "win32" || !(error instanceof Error) || !("code" in error)
            || (error.code !== "EPERM" && error.code !== "EBUSY")) throw error;
        }
      }
    }
  }, 240_000);
});
