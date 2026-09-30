import {
  ensureEnergyScopedDataSource,
  LocalDataGateway,
  writeEnergyFactProjectMaterialization,
} from "@datafoundry/data-gateway";
import {
  createMetadataStore,
  createEnergyIqSourceManifest,
  resolveEnergyIqSnapshotFactScope,
  type EnergyIqImportBatchRecord,
  type EnergyIqProjectSetupDocument,
} from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import type { ConfigApiContext } from "../routes/types.js";
import { ensureEnergyIqBootstrap } from "./energy-bootstrap.js";
import { materializeTestProjectSnapshot } from "./energy-test-materialization.js";
import {
  handleEnergyApiRequest,
  requireEnergyImportMaterializationPreconditions,
  toEnergyApiErrorResponse,
} from "./energy-api.js";

describe("Energy API business error mapping", () => {
  it.each([
    {
      period: "Previous week",
      from: "2026-07-26T16:00:00.000Z",
      to: "2026-08-02T16:00:00.000Z",
    },
    {
      period: "Previous month",
      from: "2026-06-30T16:00:00.000Z",
      to: "2026-07-31T16:00:00.000Z",
    },
  ])("accepts canonical $period through the public query-context HTTP API", async ({ period, from, to }) => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-period-success-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T16:30:00.000Z"));
    try {
      ensureEnergyIqBootstrap(metadata);
      const response = await handleEnergyApiRequest(
        jsonPost({
          projectId: "ngee-ann-polytechnic",
          scopeId: "project",
          resource: "electricity",
          period,
        }),
        ["query-context", "resolve"],
        {
          metadataStore: metadata,
          dataGateway: new LocalDataGateway(metadata),
          userId: "dev-user",
          workspaceId: "default",
        } as Required<ConfigApiContext>,
      );

      expect(response).toMatchObject({
        status: 200,
        body: {
          success: true,
          data: {
            period,
            timezone: "Asia/Singapore",
            from,
            to,
            endExclusive: true,
          },
        },
      });
    } finally {
      vi.useRealTimers();
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("resolves Previous month as a ready zero-coverage Ngee Ann analysis through the public HTTP API", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-previous-month-ready-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const previousDatabasePath = process.env.ENERGYIQ_DUCKDB_PATH;
    process.env.ENERGYIQ_DUCKDB_PATH = databasePath;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T16:30:00.000Z"));
    try {
      ensureEnergyIqBootstrap(metadata);
      await materializeTestProjectSnapshot({
        metadataStore: metadata,
        databasePath,
        workspaceId: "default",
        projectId: "ngee-ann-polytechnic",
        timezone: "Asia/Singapore",
        batches: [{
          importBatchId: "ngee-ann-empty-previous-month",
          sourceSha256: "0".repeat(64),
          rawReadings: [],
          normalizedReadings: [],
          intervalFacts: [],
          qualityEvents: [],
        }],
      });

      const response = await handleEnergyApiRequest(
        jsonPost({
          projectId: "ngee-ann-polytechnic",
          scopeId: "project",
          resource: "electricity",
          period: "Previous month",
        }),
        ["analysis", "resolve"],
        {
          metadataStore: metadata,
          dataGateway: new LocalDataGateway(metadata),
          userId: "dev-user",
          workspaceId: "default",
        } as Required<ConfigApiContext>,
      );

      expect(response).toMatchObject({
        status: 200,
        body: {
          success: true,
          data: {
            status: "ready",
            snapshot: {
              context: {
                period: "Previous month",
                timezone: "Asia/Singapore",
                from: "2026-06-30T16:00:00.000Z",
                to: "2026-07-31T16:00:00.000Z",
                endExclusive: true,
              },
              dataQuality: {
                coveragePct: 0,
                validIntervalCount: 0,
              },
              analysis: {
                dataHealth: {
                  coveragePct: 0,
                  validIntervalCount: 0,
                },
              },
            },
          },
        },
      });
    } finally {
      vi.useRealTimers();
      if (previousDatabasePath === undefined) delete process.env.ENERGYIQ_DUCKDB_PATH;
      else process.env.ENERGYIQ_DUCKDB_PATH = previousDatabasePath;
      metadata.close();
      removeTemporaryEnergyFixture(root);
    }
  });

  it("rejects an explicitly unknown Period instead of silently using Last 30 days", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-period-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const response = await handleEnergyApiRequest(
        jsonPost({
          projectId: "ngee-ann-polytechnic",
          scopeId: "project",
          resource: "electricity",
          period: "Previous fortnight",
        }),
        ["analysis", "resolve"],
        {
          metadataStore: metadata,
          dataGateway: new LocalDataGateway(metadata),
          userId: "dev-user",
          workspaceId: "default",
        } as Required<ConfigApiContext>,
      );

      expect(response).toMatchObject({
        status: 400,
        body: {
          success: false,
          error: {
            code: "BAD_REQUEST",
            message: "ENERGYIQ_PERIOD_INVALID",
          },
        },
      });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("fails an Explorer analysis link closed when its published Project Release is stale", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-stale-release-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const response = await handleEnergyApiRequest(
        jsonPost({
          projectId: "ngee-ann-polytechnic",
          scopeId: "project",
          resource: "electricity",
          period: "Custom",
          from: "2026-06-10",
          to: "2026-06-16",
          expectedProjectReleaseId: "stale-overview-release",
        }),
        ["analysis", "execute"],
        {
          metadataStore: metadata,
          dataGateway: new LocalDataGateway(metadata),
          userId: "dev-user",
          workspaceId: "default",
        } as Required<ConfigApiContext>,
      );

      expect(response).toMatchObject({
        status: 409,
        body: {
          success: false,
          error: {
            code: "CONFLICT",
            message: "ENERGYIQ_PROJECT_RELEASE_MISMATCH",
          },
        },
      });
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("executes an ordinary published analysis without requiring an explicit Release pin", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-current-release-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const previousDatabasePath = process.env.ENERGYIQ_DUCKDB_PATH;
    process.env.ENERGYIQ_DUCKDB_PATH = databasePath;
    try {
      ensureEnergyIqBootstrap(metadata);
      const snapshot = await materializeTestProjectSnapshot({
        metadataStore: metadata,
        databasePath,
        workspaceId: "default",
        projectId: "ngee-ann-polytechnic",
        timezone: "Asia/Singapore",
        batches: [{
          importBatchId: "ngee-ann-current-release-fixture",
          sourceSha256: "2".repeat(64),
          rawReadings: [],
          normalizedReadings: [],
          intervalFacts: [],
          qualityEvents: [],
        }],
      });
      const publishedProject = metadata.energyIq.getProject("ngee-ann-polytechnic");

      const response = await handleEnergyApiRequest(
        jsonPost({
          projectId: "ngee-ann-polytechnic",
          scopeId: "project",
          resource: "electricity",
          period: "Custom",
          from: "2026-05-01",
          to: "2026-05-02",
        }),
        ["analysis", "execute"],
        {
          metadataStore: metadata,
          dataGateway: new LocalDataGateway(metadata),
          userId: "dev-user",
          workspaceId: "default",
        } as Required<ConfigApiContext>,
      );

      expect(response).toMatchObject({
        status: 200,
        body: {
          success: true,
          data: {
            context: {
              hierarchyRevisionId: publishedProject.hierarchy_revision_id,
              dataSnapshotId: snapshot.id,
            },
          },
        },
      });
    } finally {
      if (previousDatabasePath === undefined) delete process.env.ENERGYIQ_DUCKDB_PATH;
      else process.env.ENERGYIQ_DUCKDB_PATH = previousDatabasePath;
      metadata.close();
      removeTemporaryEnergyFixture(root);
    }
  });

  it("returns a diagnosable 409 when Project publication is blocked by data readiness", () => {
    expect(toEnergyApiErrorResponse(new Error(
      "ENERGYIQ_PROJECT_DATA_NOT_READY:IMPORT_BATCH_NOT_MATERIALIZED,SNAPSHOT_MAPPING_MISMATCH",
    ))).toEqual({
      status: 409,
      body: {
        success: false,
        error: {
          code: "CONFLICT",
          message: "ENERGYIQ_PROJECT_DATA_NOT_READY:IMPORT_BATCH_NOT_MATERIALIZED,SNAPSHOT_MAPPING_MISMATCH",
        },
      },
    });
  });

  it.each([
    "ENERGYIQ_SOURCE_MANIFEST_NOT_CONFIRMED",
    "ENERGYIQ_SOURCE_MANIFEST_MISMATCH",
    "ENERGYIQ_IMPORT_BATCH_NOT_PINNED",
    "ENERGYIQ_IMPORT_BATCH_NOT_PINNED:batch-1",
    "ENERGYIQ_SNAPSHOT_STALE",
    "ENERGYIQ_SNAPSHOT_STALE:energy-snapshot-b",
    "ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE",
    "ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE:energy-snapshot-a",
    "ENERGYIQ_DATA_SNAPSHOT_IMMUTABLE_CONFLICT:energy-snapshot-test",
    "ENERGYIQ_DATA_SNAPSHOT_MISMATCH",
    "ENERGYIQ_PROJECT_RELEASE_MISMATCH",
    "ENERGYIQ_SESSION_FORK_WORKSPACE_MISMATCH",
    "ENERGYIQ_SESSION_FORK_PROJECT_MISMATCH",
    "ENERGYIQ_SESSION_FORK_RUN_MISMATCH",
    "ENERGYIQ_SESSION_FORK_SOURCE_CONTEXT_MISMATCH",
    "ENERGYIQ_SOURCE_SYNC_IN_PROGRESS:sync-run-1",
    "ENERGYIQ_SOURCE_SYNC_NOT_RUNNING:sync-run-1",
  ])("returns a diagnosable 409 for materialization precondition %s", (message) => {
    expect(toEnergyApiErrorResponse(new Error(message))).toMatchObject({
      status: 409,
      body: { success: false, error: { code: "CONFLICT", message } },
    });
  });

  it("extracts a stable Snapshot conflict from a DuckDB error prefix", () => {
    expect(toEnergyApiErrorResponse(new Error(
      "Invalid Input Error: ENERGYIQ_SNAPSHOT_STALE\nLINE 1: SELECT ...",
    ))).toMatchObject({
      status: 409,
      body: {
        success: false,
        error: { code: "CONFLICT", message: "ENERGYIQ_SNAPSHOT_STALE" },
      },
    });
  });

  it("returns the exact unavailable Snapshot code as HTTP 409 from data coverage", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-unavailable-snapshot-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const previousDatabasePath = process.env.ENERGYIQ_DUCKDB_PATH;
    process.env.ENERGYIQ_DUCKDB_PATH = join(root, "missing.duckdb");
    try {
      ensureEnergyIqBootstrap(metadata);
      const response = await handleEnergyApiRequest(
        requestWithMethod("GET"),
        ["projects", "ngee-ann-polytechnic", "data-coverage"],
        {
          metadataStore: metadata,
          dataGateway: new LocalDataGateway(metadata),
          userId: "dev-user",
          workspaceId: "default",
        } as Required<ConfigApiContext>,
      );
      expect(response).toMatchObject({
        status: 409,
        body: {
          success: false,
          error: { code: "CONFLICT", message: "ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE" },
        },
      });
    } finally {
      if (previousDatabasePath === undefined) delete process.env.ENERGYIQ_DUCKDB_PATH;
      else process.env.ENERGYIQ_DUCKDB_PATH = previousDatabasePath;
      metadata.close();
      removeTemporaryEnergyFixture(root);
    }
  });

  it("returns the diagnostic stale Snapshot code as HTTP 409 from data coverage", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-stale-snapshot-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const previousDatabasePath = process.env.ENERGYIQ_DUCKDB_PATH;
    process.env.ENERGYIQ_DUCKDB_PATH = databasePath;
    try {
      ensureEnergyIqBootstrap(metadata);
      const sourceSha256 = "1".repeat(64);
      const snapshot = await materializeTestProjectSnapshot({
        metadataStore: metadata,
        databasePath,
        workspaceId: "default",
        projectId: "ngee-ann-polytechnic",
        timezone: "Asia/Singapore",
        batches: [{
          importBatchId: "ngee-ann-stale-fixture",
          sourceSha256,
          rawReadings: [],
          normalizedReadings: [],
          intervalFacts: [],
          qualityEvents: [],
        }],
      });
      const scope = resolveEnergyIqSnapshotFactScope(snapshot);
      const guardedGateway = new LocalDataGateway(metadata);
      const scoped = await ensureEnergyScopedDataSource({
        metadataStore: metadata,
        userId: "dev-user",
        databasePath,
        context: {
          workspaceId: "default",
          projectId: "ngee-ann-polytechnic",
          scopeId: "project",
          meterAttachments: [],
          resource: "electricity",
          from: "2026-05-01T00:00:00.000Z",
          to: "2026-05-02T00:00:00.000Z",
          timezone: "Asia/Singapore",
          hierarchyRevisionId: "hierarchy-v1",
          meterMappingRevisionId: "mapping-v1",
          meterFormulaRevisionId: "formula-v1",
          dataSnapshotId: scope.dataSnapshotId,
          metricVersion: "metrics-v1",
        },
      });
      const currentEmpty = await handleEnergyApiRequest(
        requestWithMethod("GET"),
        ["projects", "ngee-ann-polytechnic", "imports"],
        {
          metadataStore: metadata,
          dataGateway: new LocalDataGateway(metadata),
          userId: "dev-user",
          workspaceId: "default",
        } as Required<ConfigApiContext>,
      );
      expect(currentEmpty).toMatchObject({
        status: 200,
        body: {
          success: true,
          data: {
            readiness: {
              blockingReasons: expect.not.arrayContaining([
                "SNAPSHOT_FACT_STATE_STALE",
                "SNAPSHOT_FACT_STATE_UNAVAILABLE",
              ]),
            },
          },
        },
      });
      await writeEnergyFactProjectMaterialization({
        databasePath,
        projectId: "ngee-ann-polytechnic",
        timezone: "Asia/Singapore",
        expectedPreviousDataSnapshotId: snapshot.id,
        snapshotFactScope: {
          ...scope,
          dataSnapshotId: "energy-snapshot-b",
          manifestFingerprint: "fingerprint-b",
        },
        batches: [{
          importBatchId: "ngee-ann-stale-fixture",
          sourceSha256,
          rawReadings: [],
          normalizedReadings: [],
          intervalFacts: [],
          qualityEvents: [],
        }],
      });
      let gatewayError: unknown;
      try {
        await guardedGateway.runSqlReadonly({
          user_id: "dev-user",
          datasource_id: scoped.datasourceId,
          sql: `SELECT COUNT(*) AS interval_count FROM ${scoped.viewName}`,
        });
      } catch (error) {
        gatewayError = error;
      }
      expect(gatewayError).toBeInstanceOf(Error);
      expect((gatewayError as Error).message).toContain("Invalid Input Error: ENERGYIQ_SNAPSHOT_STALE");
      expect(toEnergyApiErrorResponse(gatewayError)).toMatchObject({
        status: 409,
        body: {
          success: false,
          error: { code: "CONFLICT", message: "ENERGYIQ_SNAPSHOT_STALE" },
        },
      });
      const response = await handleEnergyApiRequest(
        requestWithMethod("GET"),
        ["projects", "ngee-ann-polytechnic", "data-coverage"],
        {
          metadataStore: metadata,
          dataGateway: new LocalDataGateway(metadata),
          userId: "dev-user",
          workspaceId: "default",
        } as Required<ConfigApiContext>,
      );
      expect(response).toMatchObject({
        status: 409,
        body: {
          success: false,
          error: { code: "CONFLICT", message: `ENERGYIQ_SNAPSHOT_STALE:${snapshot.id}` },
        },
      });
      const imports = await handleEnergyApiRequest(
        requestWithMethod("GET"),
        ["projects", "ngee-ann-polytechnic", "imports"],
        {
          metadataStore: metadata,
          dataGateway: new LocalDataGateway(metadata),
          userId: "dev-user",
          workspaceId: "default",
        } as Required<ConfigApiContext>,
      );
      expect(imports).toMatchObject({
        status: 200,
        body: {
          success: true,
          data: { readiness: { blockingReasons: expect.arrayContaining(["SNAPSHOT_FACT_STATE_STALE"]) } },
        },
      });
      const publish = await handleEnergyApiRequest(
        jsonPost({}),
        ["projects", "ngee-ann-polytechnic", "setup", "publish"],
        {
          metadataStore: metadata,
          dataGateway: new LocalDataGateway(metadata),
          userId: "dev-user",
          workspaceId: "default",
        } as Required<ConfigApiContext>,
      );
      expect(publish).toMatchObject({
        status: 409,
        body: {
          success: false,
          error: {
            code: "CONFLICT",
            message: expect.stringContaining("SNAPSHOT_FACT_STATE_STALE"),
          },
        },
      });

      process.env.ENERGYIQ_DUCKDB_PATH = join(root, "missing-state.duckdb");
      const unavailableImports = await handleEnergyApiRequest(
        requestWithMethod("GET"),
        ["projects", "ngee-ann-polytechnic", "imports"],
        {
          metadataStore: metadata,
          dataGateway: new LocalDataGateway(metadata),
          userId: "dev-user",
          workspaceId: "default",
        } as Required<ConfigApiContext>,
      );
      expect(unavailableImports).toMatchObject({
        status: 200,
        body: {
          success: true,
          data: {
            readiness: { blockingReasons: expect.arrayContaining(["SNAPSHOT_FACT_STATE_UNAVAILABLE"]) },
          },
        },
      });
    } finally {
      if (previousDatabasePath === undefined) delete process.env.ENERGYIQ_DUCKDB_PATH;
      else process.env.ENERGYIQ_DUCKDB_PATH = previousDatabasePath;
      metadata.close();
      removeTemporaryEnergyFixture(root);
    }
  });

  it.each([
    "ENERGYIQ_SOURCE_MANIFEST_INVALID",
    "ENERGYIQ_SOURCE_MANIFEST_REQUIRED",
    "ENERGYIQ_SOURCE_MANIFEST_SHA_INVALID:0",
    "ENERGYIQ_TUYA_PROJECT_UNSUPPORTED",
  ])("keeps malformed Source Manifest input as a 400 for %s", (message) => {
    expect(toEnergyApiErrorResponse(new Error(message))).toMatchObject({
      status: 400,
      body: { success: false, error: { code: "BAD_REQUEST", message } },
    });
  });

  it("returns 409 before materialization when a confirmed saved Mapping covers only part of the registered labels", () => {
    let error: unknown;
    try {
      requireEnergyImportMaterializationPreconditions(importBatches(), setupDocument(["Meter A"]));
    } catch (reason) {
      error = reason;
    }
    expect(toEnergyApiErrorResponse(error)).toMatchObject({
      status: 409,
      body: {
        success: false,
        error: {
          code: "CONFLICT",
          message: "ENERGYIQ_IMPORT_MATERIALIZATION_NOT_READY:SOURCE_LABEL_UNMAPPED",
        },
      },
    });
    expect(() => requireEnergyImportMaterializationPreconditions(
      importBatches(),
      setupDocument(["Meter A", "Meter B"]),
    )).not.toThrow();
    expect(() => requireEnergyImportMaterializationPreconditions(
      importBatches(),
      setupDocument(["Meter A", "Meter B", "Inactive source"]),
    )).toThrow("ENERGYIQ_IMPORT_MATERIALIZATION_NOT_READY:MAPPING_SOURCE_INACTIVE");
    expect(() => requireEnergyImportMaterializationPreconditions(
      importBatches(),
      setupDocument(["Meter A", "Meter B", " meter a "]),
    )).toThrow("ENERGYIQ_IMPORT_MATERIALIZATION_NOT_READY:SOURCE_LABEL_DUPLICATE");
  });
});

const importBatches = (): EnergyIqImportBatchRecord[] => [
  importBatch("batch-a", "a".repeat(64), "Meter A"),
  importBatch("batch-b", "b".repeat(64), "Meter B"),
];

const jsonPost = (body: unknown): IncomingMessage => {
  const request = new PassThrough();
  Object.assign(request, {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  request.end(JSON.stringify(body));
  return request as unknown as IncomingMessage;
};

const requestWithMethod = (method: "GET"): IncomingMessage => {
  const request = new PassThrough();
  Object.assign(request, { method, headers: {} });
  request.end();
  return request as unknown as IncomingMessage;
};

const removeTemporaryEnergyFixture = (root: string): void => {
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    if (
      process.platform === "win32"
      && error instanceof Error
      && "code" in error
      && (error.code === "EPERM" || error.code === "EBUSY")
    ) {
      return;
    }
    throw error;
  }
};

const importBatch = (id: string, sha256: string, label: string): EnergyIqImportBatchRecord => ({
  id,
  workspace_id: "workspace-1",
  project_id: "project-1",
  source_kind: "excel",
  source_sha256: sha256,
  filename: `${id}.xlsx`,
  status: "inspected",
  inspection_json: JSON.stringify({ sourceLabels: [{ label, rowCount: 10 }] }),
  created_by: "dev-user",
  created_at: "2026-08-04T00:00:00.000Z",
});

const setupDocument = (mappingLabels: string[]): EnergyIqProjectSetupDocument => ({
  project: { name: "Project", timezone: "Asia/Singapore" },
  tier_structure_locked: true,
  tiers: [{ id: "circuit", ordinal: 1, alias: "Circuit" }],
  nodes: [{
    id: "scope-a",
    tier_definition_id: "circuit",
    name: "Scope A",
    sort_order: 1,
    metadata_status: "confirmed",
  }],
  source_manifest: createEnergyIqSourceManifest(importBatches().map((batch) => batch.source_sha256), true),
  meter_mapping: {
    schema_version: 2,
    source_kind: "excel",
    confirmed: true,
    rows: mappingLabels.map((label, index) => ({
      id: `mapping-${index}`,
      source_label: label,
      scope_id: "scope-a",
      display_name: label,
      resource: "electricity",
      category: "load",
      coverage: "whole",
      meter_role: "total",
      aggregation_usage: "official",
    })),
  },
});
