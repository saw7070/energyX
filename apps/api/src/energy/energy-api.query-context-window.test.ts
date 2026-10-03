import {
  LocalDataGateway,
  readEnergyAnalysisEligibleCoverage,
} from "@datafoundry/data-gateway";
import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConfigApiContext } from "../routes/types.js";
import { handleConfigApiRequest } from "../config-api.js";
import { RunCancelRegistry } from "../run-cancel-registry.js";
import { selectEnergyCurrentOverviewPeriod } from "./energy-analysis.js";
import { ensureEnergyIqBootstrap, PRESCHOOL_WORKSPACE_ID } from "./energy-bootstrap.js";
import { handleEnergyApiRequest } from "./energy-api.js";
import { materializeTestProjectSnapshot } from "./energy-test-materialization.js";
import { resolveEnergyPublishedMeterRoute } from "./energy-query-context.js";
import { resolvePublishedEnergyQueryContext } from "./project-analysis-resolver.js";
import { buildTuyaOfficeSetup } from "./tuya-office-project.js";

const energyAnalysisModuleMock = vi.hoisted(() => ({
  executeEnergyScopeAnalysisWithLatestAvailable: vi.fn(),
}));

vi.mock("./energy-analysis.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./energy-analysis.js")>();
  return {
    ...actual,
    executeEnergyScopeAnalysisWithLatestAvailable:
      energyAnalysisModuleMock.executeEnergyScopeAnalysisWithLatestAvailable,
  };
});

describe("Energy AI query-context analysis windows", () => {
  const previousDatabasePath = process.env.ENERGYIQ_DUCKDB_PATH;

  afterEach(() => {
    energyAnalysisModuleMock.executeEnergyScopeAnalysisWithLatestAvailable.mockReset();
    if (previousDatabasePath === undefined) delete process.env.ENERGYIQ_DUCKDB_PATH;
    else process.env.ENERGYIQ_DUCKDB_PATH = previousDatabasePath;
  });

  it("resolves all-available to the exact validated Project Snapshot coverage", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-all-available-"));
    const databasePath = join(root, "energy.duckdb");
    process.env.ENERGYIQ_DUCKDB_PATH = databasePath;
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const sourceSha256 = "a".repeat(64);
      await materializeTestProjectSnapshot({
        metadataStore: metadata,
        databasePath,
        workspaceId: "default",
        projectId: "ngee-ann-polytechnic",
        timezone: "Asia/Singapore",
        batches: [{
          importBatchId: "all-available-fixture",
          sourceSha256,
          rawReadings: [],
          normalizedReadings: [],
          intervalFacts: [
            intervalFact("2026-04-20T16:00:00.000Z", "2026-04-20T16:15:00.000Z", sourceSha256, 1),
            intervalFact("2026-06-16T15:45:00.000Z", "2026-06-16T16:00:00.000Z", sourceSha256, 2),
          ],
          qualityEvents: [],
        }],
      });

      const response = await handleEnergyApiRequest(
        jsonPost({
          projectId: "ngee-ann-polytechnic",
          scopeId: "project",
          resource: "electricity",
          analysisWindow: "all-available",
        }),
        ["query-context", "resolve"],
        apiContext(metadata),
      );

      expect(response).toMatchObject({
        status: 200,
        body: { success: true, data: {
          projectId: "ngee-ann-polytechnic",
          resource: "electricity",
          period: "Custom",
          from: "2026-04-20T16:00:00.000Z",
          to: "2026-06-16T16:00:00.000Z",
          endExclusive: true,
        } },
      });
    } finally {
      metadata.close();
      removeTemporaryEnergyFixture(root);
    }
  });

  it("resolves Preschool top-nav all-available to the exact June data domain", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-preschool-top-nav-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const preliminary = resolvePublishedEnergyQueryContext({
        metadataStore: metadata,
        user: metadata.users.getById({ user_id: "dev-user" }),
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        request: {
          projectId: "preschool-demo",
          scopeId: "project",
          resource: "electricity",
          period: "Last 30 days",
        },
      });
      const expectedPublishedMeterRoute = resolveEnergyPublishedMeterRoute({
        metadataStore: metadata,
        projectId: preliminary.context.projectId,
        hierarchyRevisionId: preliminary.context.hierarchyRevisionId,
        scopeId: preliminary.context.scopeId,
        resource: preliminary.context.resource,
        expectedMeterMappingRevisionId: preliminary.context.meterMappingRevisionId,
      });
      const readAnalysisEligibleCoverage = vi.fn().mockResolvedValue({
        from: "2026-05-31T16:00:00.000Z",
        to: "2026-06-30T16:00:00.000Z",
        intervalCount: 2_880,
      });

      const response = await handleEnergyApiRequest(
        jsonPost({
          projectId: "preschool-demo",
          scopeId: "project",
          resource: "electricity",
          analysisWindow: "all-available",
        }),
        ["query-context", "resolve"],
        apiContext(metadata, PRESCHOOL_WORKSPACE_ID),
        {
          selectCurrentOverviewPeriod: selectEnergyCurrentOverviewPeriod,
          readAnalysisEligibleCoverage,
        },
      );

      expect(readAnalysisEligibleCoverage).toHaveBeenCalledWith({
        metadataStore: metadata,
        workspaceId: preliminary.context.workspaceId,
        projectId: preliminary.context.projectId,
        dataSnapshotId: preliminary.context.dataSnapshotId,
        resource: preliminary.context.resource,
        meterAttachments: expectedPublishedMeterRoute.attachments,
      });
      expect(response).toMatchObject({
        status: 200,
        body: { success: true, data: {
          projectId: "preschool-demo",
          period: "Custom",
          from: "2026-05-31T16:00:00.000Z",
          to: "2026-06-30T16:00:00.000Z",
          dataSnapshotId: preliminary.context.dataSnapshotId,
          projectReleaseId: preliminary.projectRelease?.id,
        } },
      });
      expect(response.body).not.toEqual(expect.objectContaining({
        data: expect.objectContaining({ period: "Last 30 days" }),
      }));
    } finally {
      metadata.close();
      removeTemporaryEnergyFixture(root);
    }
  });

  it("atomically continues an actor-owned historical Session on one server-resolved current Snapshot", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-continue-current-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const published = resolvePublishedEnergyQueryContext({
        metadataStore: metadata,
        user: metadata.users.getById({ user_id: "dev-user" }),
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        request: {
          projectId: "preschool-demo",
          scopeId: "project",
          resource: "electricity",
          period: "Last 30 days",
        },
      });
      metadata.sessions.create({
        user_id: "dev-user",
        id: "session-historical",
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        project_id: "preschool-demo",
      });
      metadata.runs.create({
        user_id: "dev-user",
        id: "run-historical",
        session_id: "session-historical",
        user_input: "Historical question",
        status: "completed",
      });
      metadata.conversationMessages.append({
        id: "run-historical:user-historical",
        user_id: "dev-user",
        session_id: "session-historical",
        run_id: "run-historical",
        role: "user",
        source: "client",
        message_id: "user-historical",
        content_text: "Historical question",
      });
      metadata.contextPackageSnapshots.create({
        user_id: "dev-user",
        session_id: "session-historical",
        run_id: "run-historical",
        package_id: "package-historical",
        revision: 1,
        payload: {
          items: [{
            sourceType: "energy-query-context",
            trust: "tool",
            metadata: {
              sourceKind: "energy-query-context",
              sourceOwner: "server",
              energyQueryContext: {
                workspaceId: PRESCHOOL_WORKSPACE_ID,
                projectId: "preschool-demo",
                projectName: published.context.projectName,
                scopeId: published.context.scopeId,
                scopeName: published.context.scopeName,
                scopeType: published.context.scopeType,
                resource: "electricity",
                timezone: published.context.timezone,
                from: "2026-04-30T16:00:00.000Z",
                to: "2026-05-31T16:00:00.000Z",
                hierarchyRevisionId: published.context.hierarchyRevisionId,
                meterMappingRevisionId: published.context.meterMappingRevisionId,
                meterFormulaRevisionId: published.context.meterFormulaRevisionId,
                projectReleaseId: published.projectRelease?.id,
                dataSnapshotId: published.context.dataSnapshotId,
              },
            },
            content: "server-authored historical context",
          }],
        },
      });
      metadata.contextPackageSnapshots.create({
        user_id: "dev-user",
        session_id: "session-historical",
        run_id: "run-historical",
        package_id: "package-historical-generic-later",
        revision: 2,
        payload: { items: [{
          sourceType: "knowledge",
          trust: "tool",
          metadata: {},
          content: "Later generic context must not mask the Energy binding",
        }] },
      });
      for (let index = 0; index < 81; index += 1) {
        const runId = `run-newer-${index}`;
        metadata.runs.create({
          user_id: "dev-user",
          id: runId,
          session_id: "session-historical",
          user_input: `Newer generic question ${index}`,
          status: "completed",
        });
        metadata.conversationMessages.append({
          id: `${runId}:user`,
          user_id: "dev-user",
          session_id: "session-historical",
          run_id: runId,
          role: "user",
          source: "client",
          message_id: `${runId}:user`,
          content_text: `Newer generic question ${index}`,
        });
      }
      const restoredHistorical = await handleConfigApiRequest(
        jsonGet("/api/v1/sessions/session-historical/conversation"),
        "/api/v1/sessions/session-historical/conversation",
        {
          ...apiContext(metadata, PRESCHOOL_WORKSPACE_ID),
          runCancelRegistry: new RunCancelRegistry(),
        } as Required<ConfigApiContext>,
      );
      expect(restoredHistorical).toMatchObject({
        status: 200,
        body: { success: true, data: { energyContext: {
          sourceRunId: "run-historical",
          from: "2026-04-30T16:00:00.000Z",
          to: "2026-05-31T16:00:00.000Z",
        } } },
      });
      const readAnalysisEligibleCoverage = vi.fn().mockResolvedValue({
        from: "2026-05-31T16:00:00.000Z",
        to: "2026-06-30T16:00:00.000Z",
        intervalCount: 2_880,
      });

      const response = await handleEnergyApiRequest(
        jsonPost({
          sourceSessionId: "session-historical",
          target: {
            projectId: "preschool-demo",
            scopeId: "project",
            resource: "electricity",
          },
        }),
        ["analysis", "sessions", "continue-current"],
        apiContext(metadata, PRESCHOOL_WORKSPACE_ID),
        {
          selectCurrentOverviewPeriod: selectEnergyCurrentOverviewPeriod,
          readAnalysisEligibleCoverage,
        },
      );

      expect(readAnalysisEligibleCoverage).toHaveBeenCalledTimes(1);
      expect(response).toMatchObject({
        status: 201,
        body: { success: true, data: {
          session: {
            workspaceId: PRESCHOOL_WORKSPACE_ID,
            projectId: "preschool-demo",
          },
          energyContext: {
            from: "2026-05-31T16:00:00.000Z",
            to: "2026-06-30T16:00:00.000Z",
            dataSnapshotId: published.context.dataSnapshotId,
            projectReleaseId: published.projectRelease?.id,
            forkedFromSessionId: "session-historical",
            forkedFromContextStatus: "available",
            forkedFromRunId: "run-historical",
            forkedFromFrom: "2026-04-30T16:00:00.000Z",
            forkedFromTo: "2026-05-31T16:00:00.000Z",
          },
        } },
      });
      const createdSessionId = (response.body as {
        data: { session: { id: string } };
      }).data.session.id;
      expect(createdSessionId).not.toBe("session-historical");
      expect(JSON.parse(metadata.sessions.get({
        user_id: "dev-user",
        session_id: createdSessionId,
      }).energy_context_json ?? "null")).toMatchObject({
        dataSnapshotId: published.context.dataSnapshotId,
        forkedFromSessionId: "session-historical",
      });
      const restored = await handleConfigApiRequest(
        jsonGet(`/api/v1/sessions/${createdSessionId}/conversation`),
        `/api/v1/sessions/${createdSessionId}/conversation`,
        {
          ...apiContext(metadata, PRESCHOOL_WORKSPACE_ID),
          runCancelRegistry: new RunCancelRegistry(),
        } as Required<ConfigApiContext>,
      );
      expect(restored).toMatchObject({
        status: 200,
        body: { success: true, data: { energyContext: {
          dataSnapshotId: published.context.dataSnapshotId,
          projectReleaseId: published.projectRelease?.id,
          forkedFromSessionId: "session-historical",
          forkedFromRunId: "run-historical",
        } } },
      });
    } finally {
      metadata.close();
      removeTemporaryEnergyFixture(root);
    }
  });

  it("continues an actor-owned contextless Session on current data with honest unavailable lineage", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-continue-current-contextless-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const published = resolvePublishedEnergyQueryContext({
        metadataStore: metadata,
        user: metadata.users.getById({ user_id: "dev-user" }),
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        request: {
          projectId: "preschool-demo",
          scopeId: "project",
          resource: "electricity",
          period: "Last 30 days",
        },
      });
      metadata.sessions.create({
        user_id: "dev-user",
        id: "session-contextless",
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        project_id: "preschool-demo",
      });
      const readAnalysisEligibleCoverage = vi.fn().mockResolvedValue({
        from: "2026-05-31T16:00:00.000Z",
        to: "2026-06-30T16:00:00.000Z",
        intervalCount: 2_880,
      });

      const response = await handleEnergyApiRequest(
        jsonPost({
          sourceSessionId: "session-contextless",
          target: {
            projectId: "preschool-demo",
            scopeId: "project",
            resource: "electricity",
          },
        }),
        ["analysis", "sessions", "continue-current"],
        apiContext(metadata, PRESCHOOL_WORKSPACE_ID),
        {
          selectCurrentOverviewPeriod: selectEnergyCurrentOverviewPeriod,
          readAnalysisEligibleCoverage,
        },
      );

      expect(response).toMatchObject({
        status: 201,
        body: { success: true, data: { energyContext: {
          projectId: "preschool-demo",
          from: "2026-05-31T16:00:00.000Z",
          to: "2026-06-30T16:00:00.000Z",
          dataSnapshotId: published.context.dataSnapshotId,
          forkedFromSessionId: "session-contextless",
          forkedFromContextStatus: "unavailable",
          forkedFromUnavailableReason: "source-run-unavailable",
        } } },
      });
      expect(metadata.sessions.get({
        user_id: "dev-user",
        session_id: "session-contextless",
      }).energy_context_json).toBeUndefined();
      expect(metadata.runs.findLatestBySession({
        user_id: "dev-user",
        session_id: "session-contextless",
      })).toBeUndefined();
    } finally {
      metadata.close();
      removeTemporaryEnergyFixture(root);
    }
  });

  it("continues actor-owned Sessions with malformed or mismatched source context as honest unavailable lineage", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-continue-current-untrusted-context-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const published = resolvePublishedEnergyQueryContext({
        metadataStore: metadata,
        user: metadata.users.getById({ user_id: "dev-user" }),
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        request: {
          projectId: "preschool-demo",
          scopeId: "project",
          resource: "electricity",
          period: "Last 30 days",
        },
      });
      for (const source of [
        {
          sessionId: "session-malformed",
          runId: "run-malformed",
          item: {
            sourceType: "energy-query-context",
            trust: "tool",
            metadata: {
              sourceKind: "energy-query-context",
              sourceOwner: "server",
              energyQueryContext: { projectId: "preschool-demo" },
            },
            content: "malformed server-authored context",
          },
        },
        {
          sessionId: "session-mismatched",
          runId: "run-mismatched",
          item: {
            sourceType: "energy-query-context",
            trust: "tool",
            metadata: {
              sourceKind: "energy-query-context",
              sourceOwner: "server",
              energyQueryContext: {
                workspaceId: PRESCHOOL_WORKSPACE_ID,
                projectId: "ngee-ann-polytechnic",
                projectName: published.context.projectName,
                scopeId: published.context.scopeId,
                scopeName: published.context.scopeName,
                scopeType: published.context.scopeType,
                resource: "electricity",
                timezone: published.context.timezone,
                from: "2026-04-30T16:00:00.000Z",
                to: "2026-05-31T16:00:00.000Z",
                hierarchyRevisionId: published.context.hierarchyRevisionId,
                meterMappingRevisionId: published.context.meterMappingRevisionId,
                meterFormulaRevisionId: published.context.meterFormulaRevisionId,
                projectReleaseId: published.projectRelease?.id,
                dataSnapshotId: published.context.dataSnapshotId,
              },
            },
            content: "mismatched server-authored context",
          },
        },
      ]) {
        metadata.sessions.create({
          user_id: "dev-user",
          id: source.sessionId,
          workspace_id: PRESCHOOL_WORKSPACE_ID,
          project_id: "preschool-demo",
        });
        metadata.runs.create({
          user_id: "dev-user",
          id: source.runId,
          session_id: source.sessionId,
          user_input: "Historical question",
          status: "completed",
        });
        metadata.contextPackageSnapshots.create({
          user_id: "dev-user",
          session_id: source.sessionId,
          run_id: source.runId,
          package_id: `package-${source.sessionId}`,
          revision: 1,
          payload: { items: [source.item] },
        });
      }
      const readAnalysisEligibleCoverage = vi.fn().mockResolvedValue({
        from: "2026-05-31T16:00:00.000Z",
        to: "2026-06-30T16:00:00.000Z",
        intervalCount: 2_880,
      });

      for (const sourceSessionId of ["session-malformed", "session-mismatched"]) {
        const response = await handleEnergyApiRequest(
          jsonPost({
            sourceSessionId,
            target: {
              projectId: "preschool-demo",
              scopeId: "project",
              resource: "electricity",
            },
          }),
          ["analysis", "sessions", "continue-current"],
          apiContext(metadata, PRESCHOOL_WORKSPACE_ID),
          {
            selectCurrentOverviewPeriod: selectEnergyCurrentOverviewPeriod,
            readAnalysisEligibleCoverage,
          },
        );

        expect(response).toMatchObject({
          status: 201,
          body: { success: true, data: { energyContext: {
            dataSnapshotId: published.context.dataSnapshotId,
            forkedFromSessionId: sourceSessionId,
            forkedFromContextStatus: "unavailable",
            forkedFromUnavailableReason: "source-context-unavailable",
          } } },
        });
      }
    } finally {
      metadata.close();
      removeTemporaryEnergyFixture(root);
    }
  });

  it("does not disclose or continue another actor's historical Session", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-continue-current-actor-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      metadata.users.upsertDevUser({
        id: "other-user",
        email: "other-user@example.test",
        display_name: "Other User",
        dev_token: "other-user-token",
      });
      metadata.sessions.create({
        user_id: "dev-user",
        id: "session-private",
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        project_id: "preschool-demo",
      });
      metadata.runs.create({
        user_id: "dev-user",
        id: "run-private",
        session_id: "session-private",
        user_input: "Private historical question",
        status: "completed",
      });
      const readAnalysisEligibleCoverage = vi.fn();

      const response = await handleEnergyApiRequest(
        jsonPost({
          sourceSessionId: "session-private",
          target: {
            projectId: "preschool-demo",
            scopeId: "project",
            resource: "electricity",
          },
        }),
        ["analysis", "sessions", "continue-current"],
        apiContext(metadata, PRESCHOOL_WORKSPACE_ID, "other-user"),
        {
          selectCurrentOverviewPeriod: selectEnergyCurrentOverviewPeriod,
          readAnalysisEligibleCoverage,
        },
      );

      expect(response).toMatchObject({
        status: 404,
        body: { success: false, error: { code: "RESOURCE_NOT_FOUND" } },
      });
      expect(readAnalysisEligibleCoverage).not.toHaveBeenCalled();
    } finally {
      metadata.close();
      removeTemporaryEnergyFixture(root);
    }
  });

  it("fails closed for a child Scope when only a sibling Scope has eligible facts", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-child-scope-empty-"));
    const databasePath = join(root, "energy.duckdb");
    process.env.ENERGYIQ_DUCKDB_PATH = databasePath;
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const sourceSha256 = "1".repeat(64);
      await materializeTestProjectSnapshot({
        metadataStore: metadata,
        databasePath,
        workspaceId: "default",
        projectId: "ngee-ann-polytechnic",
        timezone: "Asia/Singapore",
        batches: [{
          importBatchId: "all-available-fixture",
          sourceSha256,
          rawReadings: [],
          normalizedReadings: [],
          intervalFacts: [intervalFactForMeter({
            intervalStart: "2026-05-01T00:00:00.000Z",
            intervalEnd: "2026-05-01T00:15:00.000Z",
            sourceSha256,
            sourceRowNumber: 1,
            meterPointId: LEVEL_7_TOTAL_LIGHT_METER_ID,
            scopeId: "l7-total-light",
          })],
          qualityEvents: [],
        }],
      });

      const response = await handleEnergyApiRequest(
        jsonPost({
          projectId: "ngee-ann-polytechnic",
          scopeId: "level-6",
          resource: "electricity",
          analysisWindow: "all-available",
        }),
        ["query-context", "resolve"],
        apiContext(metadata),
      );

      expect(response).toMatchObject({
        status: 409,
        body: { success: false, error: {
          message: "ENERGYIQ_ANALYSIS_WINDOW_DATA_UNAVAILABLE",
        } },
      });
    } finally {
      metadata.close();
      removeTemporaryEnergyFixture(root);
    }
  });

  it("does not let an outside-Scope component widen child Scope coverage", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-child-scope-outside-component-"));
    const databasePath = join(root, "energy.duckdb");
    process.env.ENERGYIQ_DUCKDB_PATH = databasePath;
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const sourceSha256 = "2".repeat(64);
      await materializeTestProjectSnapshot({
        metadataStore: metadata,
        databasePath,
        workspaceId: "default",
        projectId: "ngee-ann-polytechnic",
        timezone: "Asia/Singapore",
        batches: [{
          importBatchId: "all-available-fixture",
          sourceSha256,
          rawReadings: [],
          normalizedReadings: [],
          intervalFacts: [
            intervalFactForMeter({
              intervalStart: "2026-04-01T00:00:00.000Z",
              intervalEnd: "2026-04-01T00:15:00.000Z",
              sourceSha256,
              sourceRowNumber: 1,
              meterPointId: LEVEL_7_COMPONENT_LIGHT_METER_ID,
              scopeId: "l7-back-light",
            }),
            intervalFactForMeter({
              intervalStart: "2026-05-01T00:00:00.000Z",
              intervalEnd: "2026-05-01T00:15:00.000Z",
              sourceSha256,
              sourceRowNumber: 2,
              meterPointId: LEVEL_6_TOTAL_LIGHT_METER_ID,
              scopeId: "l6-total-light",
            }),
          ],
          qualityEvents: [],
        }],
      });

      const response = await handleEnergyApiRequest(
        jsonPost({
          projectId: "ngee-ann-polytechnic",
          scopeId: "level-6",
          resource: "electricity",
          analysisWindow: "all-available",
        }),
        ["query-context", "resolve"],
        apiContext(metadata),
      );

      expect(response).toMatchObject({
        status: 200,
        body: { success: true, data: {
          from: "2026-05-01T00:00:00.000Z",
          to: "2026-05-01T00:15:00.000Z",
        } },
      });
    } finally {
      metadata.close();
      removeTemporaryEnergyFixture(root);
    }
  });

  it("does not let an unattached meter widen current Scope coverage", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-child-scope-unattached-meter-"));
    const databasePath = join(root, "energy.duckdb");
    process.env.ENERGYIQ_DUCKDB_PATH = databasePath;
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const sourceSha256 = "8".repeat(64);
      await materializeTestProjectSnapshot({
        metadataStore: metadata,
        databasePath,
        workspaceId: "default",
        projectId: "ngee-ann-polytechnic",
        timezone: "Asia/Singapore",
        batches: [{
          importBatchId: "all-available-fixture",
          sourceSha256,
          rawReadings: [],
          normalizedReadings: [],
          intervalFacts: [
            intervalFactForMeter({
              intervalStart: "2026-04-01T00:00:00.000Z",
              intervalEnd: "2026-04-01T00:15:00.000Z",
              sourceSha256,
              sourceRowNumber: 1,
              meterPointId: "unattached-meter",
              scopeId: "level-6",
            }),
            intervalFactForMeter({
              intervalStart: "2026-05-01T00:00:00.000Z",
              intervalEnd: "2026-05-01T00:15:00.000Z",
              sourceSha256,
              sourceRowNumber: 2,
              meterPointId: LEVEL_6_TOTAL_LIGHT_METER_ID,
              scopeId: "l6-total-light",
            }),
          ],
          qualityEvents: [],
        }],
      });

      const response = await handleEnergyApiRequest(
        jsonPost({
          projectId: "ngee-ann-polytechnic",
          scopeId: "level-6",
          resource: "electricity",
          analysisWindow: "all-available",
        }),
        ["query-context", "resolve"],
        apiContext(metadata),
      );

      expect(response).toMatchObject({
        status: 200,
        body: { success: true, data: {
          from: "2026-05-01T00:00:00.000Z",
          to: "2026-05-01T00:15:00.000Z",
        } },
      });
    } finally {
      metadata.close();
      removeTemporaryEnergyFixture(root);
    }
  });

  it("lets an attached inside-Scope component extend the queryable analysis window", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-child-scope-inside-component-"));
    const databasePath = join(root, "energy.duckdb");
    process.env.ENERGYIQ_DUCKDB_PATH = databasePath;
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const sourceSha256 = "3".repeat(64);
      await materializeTestProjectSnapshot({
        metadataStore: metadata,
        databasePath,
        workspaceId: "default",
        projectId: "ngee-ann-polytechnic",
        timezone: "Asia/Singapore",
        batches: [{
          importBatchId: "all-available-fixture",
          sourceSha256,
          rawReadings: [],
          normalizedReadings: [],
          intervalFacts: [
            intervalFactForMeter({
              intervalStart: "2026-05-01T00:00:00.000Z",
              intervalEnd: "2026-05-01T00:15:00.000Z",
              sourceSha256,
              sourceRowNumber: 1,
              meterPointId: LEVEL_6_TOTAL_LIGHT_METER_ID,
              scopeId: "l6-total-light",
            }),
            intervalFactForMeter({
              intervalStart: "2026-06-01T00:00:00.000Z",
              intervalEnd: "2026-06-01T00:15:00.000Z",
              sourceSha256,
              sourceRowNumber: 2,
              meterPointId: LEVEL_6_COMPONENT_LIGHT_METER_ID,
              scopeId: "l6-light-left",
            }),
          ],
          qualityEvents: [],
        }],
      });

      const response = await handleEnergyApiRequest(
        jsonPost({
          projectId: "ngee-ann-polytechnic",
          scopeId: "level-6",
          resource: "electricity",
          analysisWindow: "all-available",
        }),
        ["query-context", "resolve"],
        apiContext(metadata),
      );

      expect(response).toMatchObject({
        status: 200,
        body: { success: true, data: {
          from: "2026-05-01T00:00:00.000Z",
          to: "2026-06-01T00:15:00.000Z",
        } },
      });
    } finally {
      metadata.close();
      removeTemporaryEnergyFixture(root);
    }
  });

  it("fails closed when all-available has no validated intervals", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-all-available-empty-"));
    const databasePath = join(root, "energy.duckdb");
    process.env.ENERGYIQ_DUCKDB_PATH = databasePath;
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      await materializeTestProjectSnapshot({
        metadataStore: metadata,
        databasePath,
        workspaceId: "default",
        projectId: "ngee-ann-polytechnic",
        timezone: "Asia/Singapore",
        batches: [{
          importBatchId: "all-available-empty",
          sourceSha256: "b".repeat(64),
          rawReadings: [],
          normalizedReadings: [],
          intervalFacts: [],
          qualityEvents: [],
        }],
      });

      const response = await handleEnergyApiRequest(
        jsonPost({ projectId: "ngee-ann-polytechnic", analysisWindow: "all-available" }),
        ["query-context", "resolve"],
        apiContext(metadata),
      );

      expect(response).toMatchObject({
        status: 409,
        body: { success: false, error: {
          code: "CONFLICT",
          message: "ENERGYIQ_ANALYSIS_WINDOW_DATA_UNAVAILABLE",
        } },
      });
    } finally {
      metadata.close();
      removeTemporaryEnergyFixture(root);
    }
  });

  it("fails closed when all-available contains facts but none are analysis eligible", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-all-available-ineligible-"));
    const databasePath = join(root, "energy.duckdb");
    process.env.ENERGYIQ_DUCKDB_PATH = databasePath;
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const sourceSha256 = "c".repeat(64);
      await materializeTestProjectSnapshot({
        metadataStore: metadata,
        databasePath,
        workspaceId: "default",
        projectId: "ngee-ann-polytechnic",
        timezone: "Asia/Singapore",
        batches: [{
          importBatchId: "all-available-fixture",
          sourceSha256,
          rawReadings: [],
          normalizedReadings: [],
          intervalFacts: [
            intervalFact("2026-04-20T16:00:00.000Z", "2026-04-20T16:15:00.000Z", sourceSha256, 1, "negative_delta"),
            intervalFact("2026-06-16T15:45:00.000Z", "2026-06-16T16:00:00.000Z", sourceSha256, 2, "rejected"),
          ],
          qualityEvents: [],
        }],
      });

      const response = await handleEnergyApiRequest(
        jsonPost({ projectId: "ngee-ann-polytechnic", analysisWindow: "all-available" }),
        ["query-context", "resolve"],
        apiContext(metadata),
      );

      expect(response).toMatchObject({
        status: 409,
        body: { success: false, error: {
          code: "CONFLICT",
          message: "ENERGYIQ_ANALYSIS_WINDOW_DATA_UNAVAILABLE",
        } },
      });
    } finally {
      metadata.close();
      removeTemporaryEnergyFixture(root);
    }
  });

  it("executes all-available through the same exact server-owned coverage resolver", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-all-available-execute-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const preliminary = resolvePublishedEnergyQueryContext({
        metadataStore: metadata,
        user: metadata.users.getById({ user_id: "dev-user" }),
        workspaceId: "default",
        request: {
          projectId: "ngee-ann-polytechnic",
          scopeId: "project",
          resource: "electricity",
          period: "Last 30 days",
        },
      });
      const expectedPublishedMeterRoute = resolveEnergyPublishedMeterRoute({
        metadataStore: metadata,
        projectId: preliminary.context.projectId,
        hierarchyRevisionId: preliminary.context.hierarchyRevisionId,
        scopeId: preliminary.context.scopeId,
        resource: preliminary.context.resource,
        expectedMeterMappingRevisionId: preliminary.context.meterMappingRevisionId,
      });
      const readAnalysisEligibleCoverage = vi.fn().mockResolvedValue({
        from: "2026-04-20T16:00:00.000Z",
        to: "2026-06-16T16:00:00.000Z",
        intervalCount: 2,
      });
      energyAnalysisModuleMock.executeEnergyScopeAnalysisWithLatestAvailable.mockImplementation(
        async (input: { context: unknown }) => ({ context: input.context }),
      );

      const response = await handleEnergyApiRequest(
        jsonPost({
          projectId: "ngee-ann-polytechnic",
          scopeId: "project",
          resource: "electricity",
          analysisWindow: "all-available",
        }),
        ["analysis", "execute"],
        apiContext(metadata),
        {
          selectCurrentOverviewPeriod: selectEnergyCurrentOverviewPeriod,
          readAnalysisEligibleCoverage,
        },
      );

      expect(readAnalysisEligibleCoverage).toHaveBeenCalledOnce();
      expect(readAnalysisEligibleCoverage).toHaveBeenCalledWith({
        metadataStore: metadata,
        workspaceId: preliminary.context.workspaceId,
        projectId: preliminary.context.projectId,
        dataSnapshotId: preliminary.context.dataSnapshotId,
        resource: preliminary.context.resource,
        meterAttachments: expectedPublishedMeterRoute.attachments,
      });
      expect(energyAnalysisModuleMock.executeEnergyScopeAnalysisWithLatestAvailable)
        .toHaveBeenCalledOnce();
      expect(energyAnalysisModuleMock.executeEnergyScopeAnalysisWithLatestAvailable)
        .toHaveBeenCalledWith(expect.objectContaining({
          metadataStore: metadata,
          userId: "dev-user",
          context: expect.objectContaining({
            workspaceId: preliminary.context.workspaceId,
            projectId: preliminary.context.projectId,
            scopeId: preliminary.context.scopeId,
            period: "Custom",
            from: "2026-04-20T16:00:00.000Z",
            to: "2026-06-16T16:00:00.000Z",
            dataSnapshotId: preliminary.context.dataSnapshotId,
            hierarchyRevisionId: preliminary.context.hierarchyRevisionId,
            meterMappingRevisionId: preliminary.context.meterMappingRevisionId,
            meterFormulaRevisionId: preliminary.context.meterFormulaRevisionId,
          }),
        }));
      expect(response).toMatchObject({
        status: 200,
        body: { success: true, data: { context: {
          period: "Custom",
          from: "2026-04-20T16:00:00.000Z",
          to: "2026-06-16T16:00:00.000Z",
        } } },
      });
    } finally {
      metadata.close();
      removeTemporaryEnergyFixture(root);
    }
  });

  it("fails closed when current Snapshot advances between coverage and final context resolution", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-all-available-snapshot-race-"));
    const databasePath = join(root, "energy.duckdb");
    process.env.ENERGYIQ_DUCKDB_PATH = databasePath;
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const firstSourceSha256 = "e".repeat(64);
      await materializeTestProjectSnapshot({
        metadataStore: metadata,
        databasePath,
        workspaceId: "default",
        projectId: "ngee-ann-polytechnic",
        timezone: "Asia/Singapore",
        batches: [{
          importBatchId: "all-available-fixture",
          sourceSha256: firstSourceSha256,
          rawReadings: [],
          normalizedReadings: [],
          intervalFacts: [
            intervalFact("2026-05-01T00:00:00.000Z", "2026-05-01T00:15:00.000Z", firstSourceSha256, 1),
          ],
          qualityEvents: [],
        }],
      });

      const response = await handleEnergyApiRequest(
        jsonPost({ projectId: "ngee-ann-polytechnic", analysisWindow: "all-available" }),
        ["query-context", "resolve"],
        apiContext(metadata),
        {
          selectCurrentOverviewPeriod: selectEnergyCurrentOverviewPeriod,
          readAnalysisEligibleCoverage: async (input) => {
            const coverage = await readEnergyAnalysisEligibleCoverage(input);
            metadata.energyIq.upsertProject({
              ...metadata.energyIq.getProject("ngee-ann-polytechnic"),
              data_snapshot_id: "advanced-after-coverage-snapshot",
            });
            return coverage;
          },
        },
      );

      expect(response).toMatchObject({
        status: 409,
        body: { success: false, error: {
          code: "CONFLICT",
          message: "ENERGYIQ_DATA_SNAPSHOT_MISMATCH",
        } },
      });
    } finally {
      metadata.close();
      removeTemporaryEnergyFixture(root);
    }
  });

  it("fails closed instead of using Last 30 days when analysis resolve requests all-available", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-analysis-resolve-all-available-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const readAnalysisEligibleCoverage = vi.fn().mockResolvedValue(null);
    try {
      ensureEnergyIqBootstrap(metadata);

      const response = await handleEnergyApiRequest(
        jsonPost({
          projectId: "ngee-ann-polytechnic",
          scopeId: "project",
          resource: "electricity",
          analysisWindow: "all-available",
        }),
        ["analysis", "resolve"],
        apiContext(metadata),
        {
          selectCurrentOverviewPeriod: selectEnergyCurrentOverviewPeriod,
          readAnalysisEligibleCoverage,
        },
      );

      expect(readAnalysisEligibleCoverage).toHaveBeenCalledTimes(1);
      expect(response).toMatchObject({
        status: 409,
        body: { success: false, error: {
          code: "CONFLICT",
          message: "ENERGYIQ_ANALYSIS_WINDOW_DATA_UNAVAILABLE",
        } },
      });
    } finally {
      metadata.close();
      removeTemporaryEnergyFixture(root);
    }
  });

  it("fails closed when the published context identity changes without a Project Release", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-all-available-context-race-"));
    const databasePath = join(root, "energy.duckdb");
    process.env.ENERGYIQ_DUCKDB_PATH = databasePath;
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.energyIq.upsertUserRole({ user_id: "dev-user", role: "admin" });
      metadata.workspaces.upsert({
        id: "default",
        owner_user_id: "dev-user",
        name: "Context race",
        kind: "customer",
      });
      metadata.workspaceMemberships.upsert({
        workspace_id: "default",
        user_id: "dev-user",
        role: "owner",
      });
      metadata.energyIq.projectSetup.bootstrapPublished({
        project: {
          id: "context-race-project",
          workspace_id: "default",
          name: "Context race project",
          timezone: "Asia/Singapore",
          hierarchy_revision_id: "context-race-hierarchy-v1",
          meter_formula_revision_id: "context-race-formula-v1",
          root_scope_id: "project",
        },
        document: buildTuyaOfficeSetup(),
        published_by: "dev-user",
      });
      metadata.energyIq.upsertProjectAccess({
        project_id: "context-race-project",
        user_id: "dev-user",
        role: "editor",
      });
      const sourceSha256 = "9".repeat(64);
      await materializeTestProjectSnapshot({
        metadataStore: metadata,
        databasePath,
        workspaceId: "default",
        projectId: "context-race-project",
        timezone: "Asia/Singapore",
        batches: [{
          importBatchId: "context-race-batch",
          sourceSha256,
          rawReadings: [],
          normalizedReadings: [],
          intervalFacts: [{
            ...intervalFactForMeter({
              intervalStart: "2026-05-01T00:00:00.000Z",
              intervalEnd: "2026-05-01T00:15:00.000Z",
              sourceSha256,
              sourceRowNumber: 1,
              meterPointId: "panel-a-total",
              scopeId: "tuya-office-db1",
            }),
            projectId: "context-race-project",
            importBatchId: "context-race-batch",
          }],
          qualityEvents: [],
        }],
      });
      expect(metadata.energyIq.templates.getLatestProjectRevision("context-race-project"))
        .toBeNull();

      const response = await handleEnergyApiRequest(
        jsonPost({ projectId: "context-race-project", analysisWindow: "all-available" }),
        ["query-context", "resolve"],
        apiContext(metadata),
        {
          selectCurrentOverviewPeriod: selectEnergyCurrentOverviewPeriod,
          readAnalysisEligibleCoverage: async (input) => {
            const coverage = await readEnergyAnalysisEligibleCoverage(input);
            metadata.energyIq.upsertProject({
              ...metadata.energyIq.getProject("context-race-project"),
              meter_formula_revision_id: "context-race-formula-v2",
            });
            return coverage;
          },
        },
      );

      expect(response).toMatchObject({
        status: 409,
        body: { success: false, error: {
          code: "CONFLICT",
          message: expect.stringContaining(
            "ENERGYIQ_PUBLISHED_CONTEXT_CONFLICT:meterFormulaRevisionId",
          ),
        } },
      });
    } finally {
      metadata.close();
      removeTemporaryEnergyFixture(root);
    }
  });

  it("fails closed when a Project Release is published after all-available coverage is read", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-all-available-release-appearance-race-"));
    const databasePath = join(root, "energy.duckdb");
    process.env.ENERGYIQ_DUCKDB_PATH = databasePath;
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      metadata.energyIq.upsertUserRole({ user_id: "dev-user", role: "admin" });
      metadata.workspaces.upsert({
        id: "default",
        owner_user_id: "dev-user",
        name: "Release appearance race",
        kind: "customer",
      });
      metadata.workspaceMemberships.upsert({
        workspace_id: "default",
        user_id: "dev-user",
        role: "owner",
      });
      metadata.energyIq.projectSetup.bootstrapPublished({
        project: {
          id: "release-appearance-project",
          workspace_id: "default",
          name: "Release appearance project",
          timezone: "Asia/Singapore",
          hierarchy_revision_id: "release-appearance-hierarchy-v1",
          meter_formula_revision_id: "release-appearance-formula-v1",
          root_scope_id: "release-appearance-root",
        },
        document: {
          project: { name: "Release appearance project", timezone: "Asia/Singapore" },
          tier_structure_locked: true,
          tiers: [{ id: "release-appearance-tier", ordinal: 1, alias: "Area" }],
          nodes: [{
            id: "release-appearance-area",
            tier_definition_id: "release-appearance-tier",
            name: "Release appearance area",
            sort_order: 1,
            metadata_status: "confirmed",
          }],
          meter_mapping: {
            schema_version: 2,
            source_kind: "tuya",
            confirmed: true,
            rows: [{
              id: "release-appearance-meter",
              source_label: "Release appearance meter",
              scope_id: "release-appearance-area",
              navigation_scope_id: "release-appearance-area",
              display_name: "Release appearance meter",
              resource: "electricity",
              category: "load",
              coverage: "whole",
              meter_role: "total",
              aggregation_usage: "official",
            }],
            official_aggregation_routes: [
              {
                scope_id: "release-appearance-area",
                resource: "electricity",
                category: "load",
                meter_point_ids: ["release-appearance-meter"],
              },
              {
                scope_id: "project",
                resource: "electricity",
                category: "load",
                meter_point_ids: ["release-appearance-meter"],
              },
            ],
            virtual_meters: [],
          },
        },
        published_by: "dev-user",
      });
      metadata.energyIq.upsertProjectAccess({
        project_id: "release-appearance-project",
        user_id: "dev-user",
        role: "editor",
      });
      const sourceSha256 = "8".repeat(64);
      await materializeTestProjectSnapshot({
        metadataStore: metadata,
        databasePath,
        workspaceId: "default",
        projectId: "release-appearance-project",
        timezone: "Asia/Singapore",
        batches: [{
          importBatchId: "release-appearance-batch",
          sourceSha256,
          rawReadings: [],
          normalizedReadings: [],
          intervalFacts: [{
            ...intervalFactForMeter({
              intervalStart: "2026-05-01T00:00:00.000Z",
              intervalEnd: "2026-05-01T00:15:00.000Z",
              sourceSha256,
              sourceRowNumber: 1,
              meterPointId: "release-appearance-meter",
              scopeId: "release-appearance-area",
            }),
            projectId: "release-appearance-project",
            importBatchId: "release-appearance-batch",
          }],
          qualityEvents: [],
        }],
      });
      const beforePublication = resolvePublishedEnergyQueryContext({
        metadataStore: metadata,
        user: metadata.users.getById({ user_id: "dev-user" }),
        workspaceId: "default",
        request: { projectId: "release-appearance-project", period: "Last 30 days" },
      });
      expect(beforePublication.projectRelease).toBeNull();

      const response = await handleEnergyApiRequest(
        jsonPost({ projectId: "release-appearance-project", analysisWindow: "all-available" }),
        ["query-context", "resolve"],
        apiContext(metadata),
        {
          selectCurrentOverviewPeriod: selectEnergyCurrentOverviewPeriod,
          readAnalysisEligibleCoverage: async (input) => {
            const coverage = await readEnergyAnalysisEligibleCoverage(input);
            const published = metadata.energyIq.templates.publishProjectRevisionWithinTransaction({
              project_id: "release-appearance-project",
              tier_definition_ids: ["release-appearance-tier"],
              hierarchy_revision_id: beforePublication.context.hierarchyRevisionId,
              meter_mapping_revision_id: beforePublication.context.meterMappingRevisionId,
              published_by: "dev-user",
              published_at: "2026-08-25T00:00:00.000Z",
            });
            const reportTimePolicy = {
              policyId: "release-appearance-policy",
              revision: "1",
              windows: [{
                windowId: "recent-28d",
                role: "recent_operations" as const,
                label: "Recent 28 complete days",
                strategy: { kind: "rolling_complete_days" as const, days: 28 },
              }],
            };
            metadata.energyIq.reportTimePolicies.publish({
              project_id: "release-appearance-project",
              policy: reportTimePolicy,
              published_by: "dev-user",
              published_at: "2026-08-25T00:00:01.000Z",
            });
            metadata.energyIq.overviewDefinitions.attachMigrationRecord({
              project_id: "release-appearance-project",
              template_revision_id: published.revision_id,
              renderer_key: "energy-template-overview",
              definition: {
                contractRevision: "energyiq-overview-definition@1",
                timePolicyRevisionId: "release-appearance-policy@1",
                sections: [{
                  key: "performance",
                  title: "Current performance",
                  managementQuestion: "Where is energy use changing enough to require attention?",
                  primaryWindowId: "recent-28d",
                  blocks: [{
                    key: "consumption",
                    capabilityRevisionId: "overview.consumption@1",
                    emphasis: "primary",
                  }],
                }],
              },
              report_time_policy: reportTimePolicy,
            });
            return coverage;
          },
        },
      );

      expect(response).toMatchObject({
        status: 409,
        body: { success: false, error: {
          code: "CONFLICT",
          message: "ENERGYIQ_PROJECT_RELEASE_MISMATCH",
        } },
      });
    } finally {
      metadata.close();
      removeTemporaryEnergyFixture(root);
    }
  });

  it("reads all available history for a project with a published template but no Overview release", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-all-available-no-release-"));
    const databasePath = join(root, "energy.duckdb");
    process.env.ENERGYIQ_DUCKDB_PATH = databasePath;
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      metadata.energyIq.upsertUserRole({ user_id: "dev-user", role: "admin" });
      metadata.workspaces.upsert({
        id: "default",
        owner_user_id: "dev-user",
        name: "Release appearance race",
        kind: "customer",
      });
      metadata.workspaceMemberships.upsert({
        workspace_id: "default",
        user_id: "dev-user",
        role: "owner",
      });
      metadata.energyIq.projectSetup.bootstrapPublished({
        project: {
          id: "release-appearance-project",
          workspace_id: "default",
          name: "Release appearance project",
          timezone: "Asia/Singapore",
          hierarchy_revision_id: "release-appearance-hierarchy-v1",
          meter_formula_revision_id: "release-appearance-formula-v1",
          root_scope_id: "release-appearance-root",
        },
        document: {
          project: { name: "Release appearance project", timezone: "Asia/Singapore" },
          tier_structure_locked: true,
          tiers: [{ id: "release-appearance-tier", ordinal: 1, alias: "Area" }],
          nodes: [{
            id: "release-appearance-area",
            tier_definition_id: "release-appearance-tier",
            name: "Release appearance area",
            sort_order: 1,
            metadata_status: "confirmed",
          }],
          meter_mapping: {
            schema_version: 2,
            source_kind: "tuya",
            confirmed: true,
            rows: [{
              id: "release-appearance-meter",
              source_label: "Release appearance meter",
              scope_id: "release-appearance-area",
              navigation_scope_id: "release-appearance-area",
              display_name: "Release appearance meter",
              resource: "electricity",
              category: "load",
              coverage: "whole",
              meter_role: "total",
              aggregation_usage: "official",
            }],
            official_aggregation_routes: [
              {
                scope_id: "release-appearance-area",
                resource: "electricity",
                category: "load",
                meter_point_ids: ["release-appearance-meter"],
              },
              {
                scope_id: "project",
                resource: "electricity",
                category: "load",
                meter_point_ids: ["release-appearance-meter"],
              },
            ],
            virtual_meters: [],
          },
        },
        published_by: "dev-user",
      });
      metadata.energyIq.upsertProjectAccess({
        project_id: "release-appearance-project",
        user_id: "dev-user",
        role: "editor",
      });
      const sourceSha256 = "8".repeat(64);
      await materializeTestProjectSnapshot({
        metadataStore: metadata,
        databasePath,
        workspaceId: "default",
        projectId: "release-appearance-project",
        timezone: "Asia/Singapore",
        batches: [{
          importBatchId: "release-appearance-batch",
          sourceSha256,
          rawReadings: [],
          normalizedReadings: [],
          intervalFacts: [{
            ...intervalFactForMeter({
              intervalStart: "2026-05-01T00:00:00.000Z",
              intervalEnd: "2026-05-01T00:15:00.000Z",
              sourceSha256,
              sourceRowNumber: 1,
              meterPointId: "release-appearance-meter",
              scopeId: "release-appearance-area",
            }),
            projectId: "release-appearance-project",
            importBatchId: "release-appearance-batch",
          }],
          qualityEvents: [],
        }],
      });
      // As a site with a published setup but no Overview page reads: a template revision and no Project Release.
      metadata.energyIq.templates.publishProjectRevisionWithinTransaction({
        project_id: "release-appearance-project",
        tier_definition_ids: ["release-appearance-tier"],
        hierarchy_revision_id: "release-appearance-hierarchy-v1",
        meter_mapping_revision_id: resolvePublishedEnergyQueryContext({
          metadataStore: metadata,
          user: metadata.users.getById({ user_id: "dev-user" }),
          workspaceId: "default",
          request: { projectId: "release-appearance-project", period: "Last 30 days" },
        }).context.meterMappingRevisionId,
        published_by: "dev-user",
        published_at: "2026-08-25T00:00:00.000Z",
      });

      const response = await handleEnergyApiRequest(
        jsonPost({ projectId: "release-appearance-project", analysisWindow: "all-available" }),
        ["query-context", "resolve"],
        apiContext(metadata),
        { selectCurrentOverviewPeriod: selectEnergyCurrentOverviewPeriod },
      );

      expect(response).toMatchObject({ status: 200, body: { success: true } });
    } finally {
      metadata.close();
      removeTemporaryEnergyFixture(root);
    }
  });

  it("keeps an explicit Custom range exact instead of widening it to available coverage", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-explicit-window-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const response = await handleEnergyApiRequest(
        jsonPost({
          projectId: "ngee-ann-polytechnic",
          scopeId: "project",
          resource: "electricity",
          period: "Custom",
          from: "2026-05-01T00:00:00.000Z",
          to: "2026-05-08T00:00:00.000Z",
        }),
        ["query-context", "resolve"],
        apiContext(metadata),
      );

      expect(response).toMatchObject({
        status: 200,
        body: { success: true, data: {
          period: "Custom",
          from: "2026-05-01T00:00:00.000Z",
          to: "2026-05-08T00:00:00.000Z",
          projectReleaseId: expect.any(String),
        } },
      });
    } finally {
      metadata.close();
      removeTemporaryEnergyFixture(root);
    }
  });

  it("resolves a restricted user's current-month-to-date through the exact Overview identity instead of Last 30 days", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-current-month-overview-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      metadata.users.upsertDevUser({
        id: "ngee-restricted-user",
        email: "ngee-restricted@example.test",
        display_name: "Ngee Restricted User",
        dev_token: "ngee-restricted-token",
      });
      metadata.workspaceMemberships.upsert({
        workspace_id: "default",
        user_id: "ngee-restricted-user",
        role: "member",
      });
      metadata.energyIq.upsertUserRole({ user_id: "ngee-restricted-user", role: "user" });
      metadata.energyIq.upsertProjectAccess({
        project_id: "ngee-ann-polytechnic",
        user_id: "ngee-restricted-user",
        role: "viewer",
      });
      const user = metadata.users.getById({ user_id: "ngee-restricted-user" });
      const exactOverview = resolvePublishedEnergyQueryContext({
        metadataStore: metadata,
        user,
        workspaceId: "default",
        request: {
          projectId: "ngee-ann-polytechnic",
          scopeId: "project",
          resource: "electricity",
          period: "Custom",
          from: "2026-08-01",
          to: "2026-08-19",
        },
      });
      const resolveCurrentProjectOverviewIdentity = vi.fn().mockResolvedValue(exactOverview);
      const dependencies = {
        selectCurrentOverviewPeriod: selectEnergyCurrentOverviewPeriod,
        readAnalysisEligibleCoverage: readEnergyAnalysisEligibleCoverage,
        resolveCurrentProjectOverviewIdentity,
      } as Parameters<typeof handleEnergyApiRequest>[3];

      const response = await handleEnergyApiRequest(
        jsonPost({
          projectId: "ngee-ann-polytechnic",
          scopeId: "project",
          resource: "electricity",
          analysisWindow: "current-month-to-date",
        }),
        ["query-context", "resolve"],
        { ...apiContext(metadata), userId: "ngee-restricted-user" },
        dependencies,
      );

      expect(resolveCurrentProjectOverviewIdentity).toHaveBeenCalledTimes(1);
      expect(response).toMatchObject({
        status: 200,
        body: { success: true, data: {
          period: "Custom",
          from: "2026-07-31T16:00:00.000Z",
          to: "2026-08-19T16:00:00.000Z",
          dataSnapshotId: exactOverview.context.dataSnapshotId,
          projectReleaseId: exactOverview.projectRelease?.id,
        } },
      });
      expect(response.body).not.toEqual(expect.objectContaining({
        data: expect.objectContaining({
          period: "Last 30 days",
          from: "2026-07-25T16:00:00.000Z",
          to: "2026-08-24T16:00:00.000Z",
        }),
      }));
    } finally {
      metadata.close();
      removeTemporaryEnergyFixture(root);
    }
  });

  it("rejects an ambiguous all-available request that also supplies an explicit Custom range", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-ambiguous-window-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const response = await handleEnergyApiRequest(
        jsonPost({
          projectId: "ngee-ann-polytechnic",
          analysisWindow: "all-available",
          period: "Custom",
          from: "2026-05-01T00:00:00.000Z",
          to: "2026-05-08T00:00:00.000Z",
        }),
        ["query-context", "resolve"],
        apiContext(metadata),
      );

      expect(response).toMatchObject({
        status: 400,
        body: { success: false, error: {
          code: "BAD_REQUEST",
          message: "ENERGYIQ_ANALYSIS_WINDOW_AMBIGUOUS",
        } },
      });
    } finally {
      metadata.close();
      removeTemporaryEnergyFixture(root);
    }
  });

  it.each([
    ["expectedProjectReleaseId", 42],
    ["expectedHierarchyRevisionId", ""],
  ])("rejects a present-invalid HTTP identity pin %s", async (field, value) => {
    const root = mkdtempSync(join(tmpdir(), "energy-invalid-identity-pin-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const response = await handleEnergyApiRequest(
        jsonPost({
          projectId: "ngee-ann-polytechnic",
          period: "Custom",
          from: "2026-05-01",
          to: "2026-05-08",
          [field]: value,
        }),
        ["query-context", "resolve"],
        apiContext(metadata),
      );

      expect(response).toMatchObject({
        status: 400,
        body: { success: false, error: {
          code: "BAD_REQUEST",
          message: expect.stringContaining("ENERGYIQ_EXPECTED_IDENTITY_INVALID"),
        } },
      });
    } finally {
      metadata.close();
      removeTemporaryEnergyFixture(root);
    }
  });

  it("fails closed on a stale Project Release pin before reading all-available coverage", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-all-available-release-pin-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const response = await handleEnergyApiRequest(
        jsonPost({
          projectId: "ngee-ann-polytechnic",
          analysisWindow: "all-available",
          expectedProjectReleaseId: "stale-release",
        }),
        ["query-context", "resolve"],
        apiContext(metadata),
      );

      expect(response).toMatchObject({
        status: 409,
        body: { success: false, error: {
          code: "CONFLICT",
          message: "ENERGYIQ_PROJECT_RELEASE_MISMATCH",
        } },
      });
    } finally {
      metadata.close();
      removeTemporaryEnergyFixture(root);
    }
  });

  it("fails closed on a stale Project Release pin for an explicit historical Custom restore", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-historical-release-pin-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const response = await handleEnergyApiRequest(
        jsonPost({
          projectId: "ngee-ann-polytechnic",
          scopeId: "project",
          resource: "electricity",
          period: "Custom",
          from: "2026-06-01",
          to: "2026-06-08",
          expectedDataSnapshotId: metadata.energyIq.getProject("ngee-ann-polytechnic").data_snapshot_id,
          expectedProjectReleaseId: "stale-release",
        }),
        ["query-context", "resolve"],
        apiContext(metadata),
      );

      expect(response).toMatchObject({
        status: 409,
        body: { success: false, error: {
          code: "CONFLICT",
          message: "ENERGYIQ_PROJECT_RELEASE_MISMATCH",
        } },
      });
    } finally {
      metadata.close();
      removeTemporaryEnergyFixture(root);
    }
  });

  it("restores an exact immutable Project Release after a newer Release is published", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-historical-release-exact-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const user = metadata.users.getById({ user_id: "dev-user" });
      const historical = resolvePublishedEnergyQueryContext({
        metadataStore: metadata,
        user,
        workspaceId: "tuya-office",
        request: {
          projectId: "tuya-office",
          scopeId: "project",
          resource: "electricity",
          period: "Custom",
          from: "2026-08-01",
          to: "2026-08-21",
        },
      });
      const historicalRevision = metadata.energyIq.templates
        .getLatestProjectRevision("tuya-office")!;
      const newerRevision = metadata.energyIq.templates.publishDocumentFromRevisionWithinTransaction({
        project_id: "tuya-office",
        expected_base_revision_id: historicalRevision.revision_id,
        document: historicalRevision.document,
        published_by: "dev-user",
        published_at: "2026-08-28T00:00:00.000Z",
      });
      expect(newerRevision.revision_id).not.toBe(historicalRevision.revision_id);

      const response = await handleEnergyApiRequest(
        jsonPost({
          projectId: "tuya-office",
          scopeId: "project",
          resource: "electricity",
          period: "Custom",
          from: "2026-08-01",
          to: "2026-08-21",
          expectedDataSnapshotId: historical.context.dataSnapshotId,
          expectedProjectReleaseId: historical.projectRelease?.id,
          expectedHierarchyRevisionId: historical.context.hierarchyRevisionId,
          expectedMeterMappingRevisionId: historical.context.meterMappingRevisionId,
          expectedMeterFormulaRevisionId: historical.context.meterFormulaRevisionId,
        }),
        ["query-context", "resolve"],
        apiContext(metadata, "tuya-office"),
      );

      expect(response).toMatchObject({
        status: 200,
        body: { success: true, data: {
          projectReleaseId: historical.projectRelease?.id,
          hierarchyRevisionId: historical.context.hierarchyRevisionId,
          meterMappingRevisionId: historical.context.meterMappingRevisionId,
          meterFormulaRevisionId: historical.context.meterFormulaRevisionId,
        } },
      });
    } finally {
      metadata.close();
      removeTemporaryEnergyFixture(root);
    }
  });
});

const apiContext = (
  metadataStore: ReturnType<typeof createMetadataStore>,
  workspaceId = "default",
  userId = "dev-user",
) => ({
  metadataStore,
  dataGateway: new LocalDataGateway(metadataStore),
  userId,
  workspaceId,
}) as Required<ConfigApiContext>;

const jsonPost = (body: unknown): IncomingMessage => {
  const request = new PassThrough() as PassThrough & IncomingMessage;
  request.method = "POST";
  request.headers = { "content-type": "application/json" };
  request.end(JSON.stringify(body));
  return request;
};

const jsonGet = (url: string): IncomingMessage => {
  const request = new PassThrough() as PassThrough & IncomingMessage;
  request.method = "GET";
  request.url = url;
  request.headers = {};
  request.end();
  return request;
};

const intervalFact = (
  intervalStart: string,
  intervalEnd: string,
  sourceSha256: string,
  sourceRowNumber: number,
  qualityStatus = "ok",
) => ({
  workspaceId: "default",
  projectId: "ngee-ann-polytechnic",
  importBatchId: "all-available-fixture",
  resource: "electricity" as const,
  meterPointId: LEVEL_6_TOTAL_LIGHT_METER_ID,
  scopeId: "l6-total-light",
  sourceLabel: "Meter 1",
  category: "load",
  meterRole: "total",
  intervalStart,
  intervalEnd,
  elapsedMinutes: 15,
  activeEnergyKwh: sourceRowNumber,
  previousActiveEnergyKwh: sourceRowNumber - 1,
  rawDeltaKwh: 1,
  usageKwh: 1,
  averageKw: 4,
  qualityStatus,
  localDate: intervalStart.slice(0, 10),
  localHour: 0,
  dayType: "weekday",
  sourceFile: "fixture.xlsx",
  sourceSha256,
  sourceReadingKind: "interval_usage" as const,
});

const intervalFactForMeter = (input: {
  intervalStart: string;
  intervalEnd: string;
  sourceSha256: string;
  sourceRowNumber: number;
  meterPointId: string;
  scopeId: string;
}) => ({
  ...intervalFact(
    input.intervalStart,
    input.intervalEnd,
    input.sourceSha256,
    input.sourceRowNumber,
  ),
  meterPointId: input.meterPointId,
  scopeId: input.scopeId,
});

const LEVEL_6_TOTAL_LIGHT_METER_ID = "mapping-lvl-6-total-office-light-8";
const LEVEL_7_TOTAL_LIGHT_METER_ID = "mapping-lvl-7-total-office-light-17";
const LEVEL_6_COMPONENT_LIGHT_METER_ID = "mapping-lvl-6-office-light-left-external-1";
const LEVEL_7_COMPONENT_LIGHT_METER_ID = "mapping-lvl-7-back-row-office-light-10";

const removeTemporaryEnergyFixture = (root: string): void => {
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    if (
      process.platform === "win32"
      && error instanceof Error
      && "code" in error
      && (error.code === "EPERM" || error.code === "EBUSY")
    ) return;
    throw error;
  }
};
