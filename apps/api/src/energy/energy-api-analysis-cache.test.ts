import { LocalDataGateway } from "@datafoundry/data-gateway";
import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConfigApiContext } from "../routes/types.js";
import { ensureEnergyIqBootstrap } from "./energy-bootstrap.js";

const resolveProjectAnalysis = vi.hoisted(() => vi.fn(async (_input: unknown) => ({
  status: "configuration-required" as const,
})));
const readCurrentProjectOverviewProjection = vi.hoisted(() => vi.fn());
const readCurrentProjectOverviewLifecycle = vi.hoisted(() => vi.fn());
const materializeCurrentProjectOverviewProjection = vi.hoisted(() => vi.fn());
const resolveCurrentProjectOverviewIdentity = vi.hoisted(() => vi.fn());
const projectOverviewMinimumFromMaterializedProjection = vi.hoisted(() => vi.fn());
const prewarmProjectAnalysisContextPackage = vi.hoisted(() => vi.fn());
const prewarmPublishedProjectOverviewProjections = vi.hoisted(() => vi.fn());
const toSafeProjectAnalysisIdentity = vi.hoisted(() => vi.fn((identity: Record<string, unknown>) => {
  const { databasePath: _databasePath, ...safe } = identity;
  return { ...safe, fingerprint: "safe-fingerprint" };
}));

vi.mock("./project-analysis-resolver.js", () => ({
  resolveProjectAnalysis,
  readCurrentProjectOverviewProjection,
  readCurrentProjectOverviewLifecycle,
  materializeCurrentProjectOverviewProjection,
  resolveCurrentProjectOverviewIdentity,
  resolveProjectOverviewProfile: () => ({ projectId: "configured" }),
  prewarmProjectAnalysisContextPackage,
  prewarmPublishedProjectOverviewProjections,
  toSafeProjectAnalysisIdentity,
}));
vi.mock("./project-overview-minimum.js", () => ({
  projectOverviewMinimumFromMaterializedProjection,
}));

import { handleEnergyApiRequest } from "./energy-api.js";

describe("Energy analysis resolve cache control", () => {
  afterEach(() => {
    resolveProjectAnalysis.mockClear();
    readCurrentProjectOverviewProjection.mockReset();
    readCurrentProjectOverviewLifecycle.mockReset();
    materializeCurrentProjectOverviewProjection.mockReset();
    resolveCurrentProjectOverviewIdentity.mockReset();
    projectOverviewMinimumFromMaterializedProjection.mockReset();
    prewarmPublishedProjectOverviewProjections.mockReset();
  });

  it("passes refresh bypass separately from the authoritative query request", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-analysis-cache-"));
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
          bypassCache: true,
        }),
        ["analysis", "resolve"],
        {
          metadataStore: metadata,
          dataGateway: new LocalDataGateway(metadata),
          userId: "dev-user",
          workspaceId: "default",
        } as Required<ConfigApiContext>,
      );

      expect(response.status).toBe(200);
      expect(resolveProjectAnalysis).toHaveBeenCalledTimes(1);
      const resolverInput = resolveProjectAnalysis.mock.calls[0]?.[0];
      expect(resolverInput).toMatchObject({
        bypassCache: true,
        request: {
          projectId: "ngee-ann-polytechnic",
          scopeId: "project",
          resource: "electricity",
          period: "Custom",
          from: "2026-06-10",
          to: "2026-06-16",
        },
      });
      expect((resolverInput as { request: unknown }).request).not.toHaveProperty("bypassCache");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("serves only the canonical member current Overview from the projection without compute, Provider, or mutation", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-current-overview-bypass-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      metadata.users.upsertDevUser({
        id: "overview-member",
        email: "overview-member@example.test",
        display_name: "Overview Member",
        dev_token: "overview-member-token",
      });
      metadata.workspaceMemberships.upsert({
        workspace_id: "default",
        user_id: "overview-member",
        role: "member",
      });
      metadata.energyIq.upsertUserRole({ user_id: "overview-member", role: "user" });
      metadata.energyIq.upsertProjectAccess({
        project_id: "ngee-ann-polytechnic",
        user_id: "overview-member",
        role: "viewer",
      });
      const authoritative = readyDailyAnomalyResolution();
      readCurrentProjectOverviewProjection.mockResolvedValue({
        resolution: authoritative,
        contextPackage: {
          contract: "energyiq-overview-context-package@1",
          projectionRef: "sha256:projection-current",
          identity: {
            dataSnapshotId: "snapshot-current",
            projectReleaseId: "release-current",
          },
          snapshot: authoritative.snapshot,
          evidenceRefs: ["evidence-current"],
        },
      });
      const providerExecute = vi.fn();
      const context = {
        metadataStore: metadata,
        dataGateway: new LocalDataGateway(metadata),
        overviewAiWorkflow: { execute: providerExecute },
        userId: "overview-member",
        workspaceId: "default",
      } as unknown as Required<ConfigApiContext>;
      const changesBefore = (metadata.db.prepare("SELECT total_changes() AS value").get() as {
        value: number;
      }).value;

      const response = await handleEnergyApiRequest(
        jsonPost({
          projectId: "ngee-ann-polytechnic",
          scopeId: "project",
          resource: "electricity",
          analysisWindow: "current-project-overview",
          from: "2026-08-01T00:00:00.000Z",
          to: "2026-09-01T00:00:00.000Z",
          expectedDataSnapshotId: "snapshot-current",
          expectedProjectReleaseId: "release-current",
          bypassCache: true,
        }),
        ["analysis", "resolve"],
        context,
      );

      expect(response).toMatchObject({
        status: 200,
        body: { success: true, data: {
          status: "ready",
          overviewContext: {
            contract: "energyiq-overview-context-reference@1",
            projectionRef: "sha256:projection-current",
          },
        } },
      });
      expect(readCurrentProjectOverviewProjection).toHaveBeenCalledWith(expect.objectContaining({
        projectId: "ngee-ann-polytechnic",
        expectedDataSnapshotId: "snapshot-current",
        expectedProjectReleaseId: "release-current",
        expectedFrom: "2026-08-01T00:00:00.000Z",
        expectedTo: "2026-09-01T00:00:00.000Z",
      }));
      for (const noncanonicalIdentity of [
        { scopeId: "level-1", resource: "electricity" },
        { scopeId: "project", resource: "water" },
      ] as const) {
        const rejected = await handleEnergyApiRequest(
          jsonPost({
            projectId: "ngee-ann-polytechnic",
            ...noncanonicalIdentity,
            analysisWindow: "current-project-overview",
            from: "2026-08-01T00:00:00.000Z",
            to: "2026-09-01T00:00:00.000Z",
            expectedDataSnapshotId: "snapshot-current",
            expectedProjectReleaseId: "release-current",
            bypassCache: true,
          }),
          ["analysis", "resolve"],
          context,
        );

        expect(rejected).toMatchObject({
          status: 400,
          body: {
            success: false,
            error: {
              code: "BAD_REQUEST",
              message: "ENERGYIQ_CURRENT_PROJECT_OVERVIEW_CONTEXT_INVALID",
            },
          },
        });
      }
      expect(readCurrentProjectOverviewProjection).toHaveBeenCalledTimes(1);
      expect(resolveProjectAnalysis).not.toHaveBeenCalled();
      expect(providerExecute).not.toHaveBeenCalled();
      expect((metadata.db.prepare("SELECT total_changes() AS value").get() as {
        value: number;
      }).value).toBe(changesBefore);
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("returns compact Overview rows and exact pinned detail through the public routes", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-overview-read-model-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const authoritative = readyDailyAnomalyResolution();
      resolveProjectAnalysis
        .mockResolvedValueOnce(authoritative as never)
        .mockResolvedValueOnce(authoritative as never);
      const context = {
        metadataStore: metadata,
        dataGateway: new LocalDataGateway(metadata),
        userId: "dev-user",
        workspaceId: "default",
      } as Required<ConfigApiContext>;
      const query = {
        projectId: "ngee-ann-polytechnic",
        scopeId: "project",
        resource: "electricity",
        analysisWindow: "current-month-to-date",
        expectedDataSnapshotId: "snapshot-current",
        expectedProjectReleaseId: "release-current",
      };

      const overview = await handleEnergyApiRequest(
        jsonPost(query),
        ["analysis", "resolve"],
        context,
      );
      expect(overview).toMatchObject({
        status: 200,
        body: { success: true, data: {
          status: "ready",
          snapshot: { analysis: { dailyUsageAnomalies: {
            scopes: [{ rows: [{ incidentId: "incident-current", detailSeries: [] }] }],
          } } },
        } },
      });

      const detail = await handleEnergyApiRequest(
        jsonPost({
          ...query,
          bundleId: "bundle-current",
          incidentId: "incident-current",
        }),
        ["analysis", "daily-usage-anomaly-detail"],
        context,
      );
      expect(detail).toMatchObject({
        status: 200,
        body: { success: true, data: {
          contract: "energyiq-daily-usage-anomaly-detail@1",
          binding: {
            dataSnapshotId: "snapshot-current",
            projectReleaseId: "release-current",
            bundleId: "bundle-current",
            incidentId: "incident-current",
          },
          evidencePins: {
            dataSnapshotId: "snapshot-current",
            projectReleaseId: "release-current",
          },
          detailSeries: [{ seriesId: "series-current" }],
        } },
      });
      expect(resolveProjectAnalysis).toHaveBeenCalledTimes(2);
      expect(resolveProjectAnalysis.mock.calls[1]?.[0]).not.toHaveProperty("bypassCache");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("serves the current Managed Overview from its read-only projection route", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-overview-projection-read-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const authoritative = readyDailyAnomalyResolution();
      readCurrentProjectOverviewProjection.mockResolvedValueOnce({
        resolution: authoritative,
        contextPackage: {
          contract: "energyiq-overview-context-package@1",
          identity: {
            dataSnapshotId: "snapshot-current",
            projectReleaseId: "release-current",
          },
          snapshot: authoritative.snapshot,
          evidenceRefs: ["evidence-current"],
        },
      });
      const response = await handleEnergyApiRequest(
        getRequest(
          "/api/v1/energy/projects/ngee-ann-polytechnic/overview-projection"
          + "?expectedDataSnapshotId=snapshot-current&expectedProjectReleaseId=release-current"
          + "&expectedFrom=2026-08-01T00%3A00%3A00.000Z&expectedTo=2026-09-01T00%3A00%3A00.000Z",
        ),
        ["projects", "ngee-ann-polytechnic", "overview-projection"],
        {
          metadataStore: metadata,
          dataGateway: new LocalDataGateway(metadata),
          userId: "dev-user",
          workspaceId: "default",
        } as Required<ConfigApiContext>,
      );

      expect(response).toMatchObject({
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
        body: { success: true, data: {
          status: "ready",
          overviewContext: {
            contract: "energyiq-overview-context-reference@1",
            evidenceRefs: ["evidence-current"],
          },
        } },
      });
      expect(JSON.stringify(response).match(/incident-current/gu)).toHaveLength(1);
      expect(readCurrentProjectOverviewProjection).toHaveBeenCalledWith(expect.objectContaining({
        projectId: "ngee-ann-polytechnic",
        expectedDataSnapshotId: "snapshot-current",
        expectedProjectReleaseId: "release-current",
        expectedFrom: "2026-08-01T00:00:00.000Z",
        expectedTo: "2026-09-01T00:00:00.000Z",
      }));
      expect(resolveProjectAnalysis).not.toHaveBeenCalled();
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("serves mutable lifecycle only through an exact projection-ref route", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-overview-lifecycle-read-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      readCurrentProjectOverviewLifecycle.mockResolvedValueOnce({
        contract: "energyiq-overview-lifecycle@1",
        projectionRef: "sha256:projection-current",
        observedAt: "2026-08-27T00:00:00.000Z",
        inputFingerprint: "fingerprint-current",
        decisionLifecycle: { status: "unavailable" },
      });
      const response = await handleEnergyApiRequest(
        getRequest(
          "/api/v1/energy/projects/ngee-ann-polytechnic/overview-lifecycle"
          + "?expectedProjectionRef=sha256%3Aprojection-current",
        ),
        ["projects", "ngee-ann-polytechnic", "overview-lifecycle"],
        {
          metadataStore: metadata,
          dataGateway: new LocalDataGateway(metadata),
          userId: "dev-user",
          workspaceId: "default",
        } as Required<ConfigApiContext>,
      );

      expect(response).toMatchObject({
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
        body: { success: true, data: {
          contract: "energyiq-overview-lifecycle@1",
          projectionRef: "sha256:projection-current",
        } },
      });
      expect(readCurrentProjectOverviewLifecycle).toHaveBeenCalledWith(expect.objectContaining({
        projectId: "ngee-ann-polytechnic",
        expectedProjectionRef: "sha256:projection-current",
      }));
      expect(readCurrentProjectOverviewProjection).not.toHaveBeenCalled();
      expect(resolveProjectAnalysis).not.toHaveBeenCalled();
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("derives the minimum response from the same immutable current projection", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-overview-minimum-projection-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const authoritative = readyDailyAnomalyResolution();
      readCurrentProjectOverviewProjection.mockResolvedValueOnce({
        resolution: authoritative,
        contextPackage: {
          contract: "energyiq-overview-context-package@1",
          identity: { dataSnapshotId: "snapshot-current", projectReleaseId: "release-current" },
          snapshot: authoritative.snapshot,
          evidenceRefs: ["evidence-current"],
        },
      });
      projectOverviewMinimumFromMaterializedProjection.mockReturnValueOnce({
        status: "ready",
        contract: "energyiq-current-overview-minimum@2",
        binding: { currentPin: {
          dataSnapshotId: "snapshot-current",
          projectReleaseId: "release-current",
        } },
      });

      const response = await handleEnergyApiRequest(
        getRequest("/api/v1/energy/projects/ngee-ann-polytechnic/overview-minimum"),
        ["projects", "ngee-ann-polytechnic", "overview-minimum"],
        {
          metadataStore: metadata,
          dataGateway: new LocalDataGateway(metadata),
          userId: "dev-user",
          workspaceId: "default",
        } as Required<ConfigApiContext>,
      );

      expect(response).toMatchObject({
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
        body: { success: true, data: {
          status: "ready",
          binding: { currentPin: {
            dataSnapshotId: "snapshot-current",
            projectReleaseId: "release-current",
          } },
        } },
      });
      expect(readCurrentProjectOverviewProjection).toHaveBeenCalledWith(expect.objectContaining({
        projectId: "ngee-ann-polytechnic",
      }));
      expect(projectOverviewMinimumFromMaterializedProjection).toHaveBeenCalledWith({
        metadataStore: metadata,
        resolution: authoritative,
      });
      expect(resolveProjectAnalysis).not.toHaveBeenCalled();
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("materializes a configured Managed Overview through the admin prewarm route", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-overview-projection-prewarm-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      materializeCurrentProjectOverviewProjection.mockResolvedValueOnce({
        changed: true,
        resolution: readyDailyAnomalyResolution(),
        contextPackage: {
          contract: "energyiq-overview-context-package@1",
          identity: {
            dataSnapshotId: "snapshot-current",
            projectReleaseId: "release-current",
          },
          snapshot: readyDailyAnomalyResolution().snapshot,
          evidenceRefs: ["evidence-current"],
        },
      });
      const response = await handleEnergyApiRequest(
        jsonPost({}),
        ["projects", "ngee-ann-polytechnic", "overview-projection"],
        {
          metadataStore: metadata,
          dataGateway: new LocalDataGateway(metadata),
          userId: "dev-user",
          workspaceId: "default",
        } as Required<ConfigApiContext>,
      );

      expect(response.status, JSON.stringify(response)).toBe(201);
      expect(response).toMatchObject({
        status: 201,
        headers: { "Cache-Control": "private, no-store" },
        body: { success: true, data: {
          changed: true,
          identity: {
            dataSnapshotId: "snapshot-current",
            projectReleaseId: "release-current",
          },
          evidenceRefs: ["evidence-current"],
        } },
      });
      expect(materializeCurrentProjectOverviewProjection).toHaveBeenCalledWith(expect.objectContaining({
        projectId: "ngee-ann-polytechnic",
        workspaceId: "default",
        forceRecompute: true,
      }));
      expect(resolveProjectAnalysis).not.toHaveBeenCalled();
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("recovers an interrupted Project publication before an admin Overview repair writes a pointer", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-overview-projection-recovery-"));
    const previousDuckDbPath = process.env.ENERGYIQ_DUCKDB_PATH;
    process.env.ENERGYIQ_DUCKDB_PATH = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const project = metadata.energyIq.getProject("ngee-ann-polytechnic");
      metadata.energyIq.beginProjectDataPublication({
        project_id: project.id,
        expected_previous_snapshot_id: project.data_snapshot_id,
      });
      materializeCurrentProjectOverviewProjection.mockImplementationOnce(async () => {
        expect(metadata.energyIq.findProjectDataPublication(project.id)).toBeUndefined();
        return {
          changed: true,
          resolution: readyDailyAnomalyResolution(),
          contextPackage: {
            contract: "energyiq-overview-context-package@1",
            identity: { dataSnapshotId: "snapshot-current", projectReleaseId: "release-current" },
            snapshot: readyDailyAnomalyResolution().snapshot,
            evidenceRefs: ["evidence-current"],
          },
        };
      });

      const response = await handleEnergyApiRequest(
        jsonPost({}),
        ["projects", project.id, "overview-projection"],
        {
          metadataStore: metadata,
          dataGateway: new LocalDataGateway(metadata),
          userId: "dev-user",
          workspaceId: "default",
        } as Required<ConfigApiContext>,
      );

      expect(response.status, JSON.stringify(response)).toBe(201);
      expect(materializeCurrentProjectOverviewProjection).toHaveBeenCalledTimes(1);
    } finally {
      if (previousDuckDbPath === undefined) delete process.env.ENERGYIQ_DUCKDB_PATH;
      else process.env.ENERGYIQ_DUCKDB_PATH = previousDuckDbPath;
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("rejects a non-admin before the release prewarm can inspect published Projects", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-published-overview-prewarm-auth-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      metadata.users.upsertDevUser({
        id: "overview-member",
        email: "overview-member@example.test",
        display_name: "Overview Member",
        dev_token: "overview-member-token",
      });
      metadata.workspaceMemberships.upsert({
        workspace_id: "default",
        user_id: "overview-member",
        role: "member",
      });
      metadata.energyIq.upsertUserRole({ user_id: "overview-member", role: "user" });
      const response = await handleEnergyApiRequest(
        jsonPost({}),
        ["admin", "overview-projections", "prewarm"],
        {
          metadataStore: metadata,
          dataGateway: new LocalDataGateway(metadata),
          userId: "overview-member",
          workspaceId: "default",
        } as Required<ConfigApiContext>,
      );

      expect(response).toMatchObject({
        status: 403,
        body: {
          success: false,
          error: { code: "FORBIDDEN", message: "ENERGYIQ_ADMIN_REQUIRED" },
        },
      });
      expect(prewarmPublishedProjectOverviewProjections).not.toHaveBeenCalled();
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("fails the explicit Workspace release prewarm when any configured published Project is not ready", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-published-overview-prewarm-readiness-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      prewarmPublishedProjectOverviewProjections.mockResolvedValueOnce([{
        workspaceId: "default",
        projectId: "ngee-ann-polytechnic",
        status: "materialized",
        changed: true,
        dataSnapshotId: "ngee-snapshot",
        projectReleaseId: "ngee-release",
      }, {
        workspaceId: "default",
        projectId: "ngee-ann-secondary",
        status: "not_ready",
      }]);
      const response = await handleEnergyApiRequest(
        jsonPost({}),
        ["admin", "overview-projections", "prewarm"],
        {
          metadataStore: metadata,
          dataGateway: new LocalDataGateway(metadata),
          userId: "dev-user",
          workspaceId: "default",
        } as Required<ConfigApiContext>,
      );

      expect(response).toMatchObject({
        status: 409,
        headers: { "Cache-Control": "private, no-store" },
        body: {
          success: false,
          error: {
            code: "CONFLICT",
            message: "ENERGYIQ_PUBLISHED_OVERVIEW_PREWARM_NOT_READY",
            details: {
              outcomes: expect.arrayContaining([
                expect.objectContaining({ projectId: "ngee-ann-polytechnic", status: "materialized" }),
                expect.objectContaining({ projectId: "ngee-ann-secondary", status: "not_ready" }),
              ]),
            },
          },
        },
      });
      expect(prewarmPublishedProjectOverviewProjections).toHaveBeenCalledWith(expect.objectContaining({
        workspaceId: "default",
        user: metadata.users.getById({ user_id: "dev-user" }),
      }));
      expect(materializeCurrentProjectOverviewProjection).not.toHaveBeenCalled();
      expect(resolveProjectAnalysis).not.toHaveBeenCalled();
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("returns ready only after every configured published Project in the selected Workspace has an exact immutable projection", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-published-overview-prewarm-ready-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      metadata.db.prepare("DELETE FROM energyiq_user_roles WHERE user_id = ?").run("dev-user");
      const metadataChangesBefore = (metadata.db.prepare("SELECT total_changes() AS value").get() as {
        value: number;
      }).value;
      prewarmPublishedProjectOverviewProjections.mockResolvedValueOnce([{
        workspaceId: "default",
        projectId: "ngee-ann-polytechnic",
        status: "materialized",
        changed: true,
        dataSnapshotId: "ngee-snapshot",
        projectReleaseId: "ngee-release",
      }, {
        workspaceId: "default",
        projectId: "ngee-ann-secondary",
        status: "unchanged",
        changed: false,
        dataSnapshotId: "preschool-snapshot",
        projectReleaseId: "preschool-release",
      }]);
      const response = await handleEnergyApiRequest(
        jsonPost({}),
        ["admin", "overview-projections", "prewarm"],
        {
          metadataStore: metadata,
          dataGateway: new LocalDataGateway(metadata),
          userId: "dev-user",
          workspaceId: "default",
        } as Required<ConfigApiContext>,
      );

      expect(response).toMatchObject({
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
        body: { success: true, data: {
          contract: "energyiq-published-overview-release-prewarm@1",
          status: "ready",
          outcomes: [
            expect.objectContaining({ projectId: "ngee-ann-polytechnic", status: "materialized" }),
            expect.objectContaining({ projectId: "ngee-ann-secondary", status: "unchanged" }),
          ],
        } },
      });
      expect(materializeCurrentProjectOverviewProjection).not.toHaveBeenCalled();
      expect(resolveProjectAnalysis).not.toHaveBeenCalled();
      expect((metadata.db.prepare("SELECT total_changes() AS value").get() as {
        value: number;
      }).value).toBe(metadataChangesBefore);
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("idempotently backfills the exact current Analysis Context Package through an admin operation", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-analysis-context-prewarm-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const prewarm = vi.fn()
        .mockResolvedValueOnce({
          status: "materialized",
          contextPackage: {
            projectionRef: "sha256:analysis-context-current",
            identity: {
              resolverRevision: "project-analysis-resolver@1",
              workspaceId: "default",
              projectId: "ngee-ann-polytechnic",
              scopeId: "project",
              resource: "electricity",
              analysisWindow: "all-available",
              period: "Custom",
              timezone: "Asia/Singapore",
              from: "2026-01-01T00:00:00.000Z",
              to: "2026-02-01T00:00:00.000Z",
              databasePath: "C:\\secret\\energy.duckdb",
              dataSnapshotId: "snapshot-current",
              projectReleaseId: "release-current",
              reportTimePolicyRevisionId: "report-time-current",
              hierarchyRevisionId: "hierarchy-current",
              meterMappingRevisionId: "mapping-current",
              meterFormulaRevisionId: "formula-current",
              metricVersion: "metric-current",
              businessCalendarVersion: "calendar-current",
              tariffScheduleVersion: "tariff-current",
              overviewDefinitionRevisionId: "overview-current",
              rendererKey: "ngee-ann-overview",
              rendererVersion: "1",
              rendererContractVersion: "project-analysis-snapshot@1",
              recipeId: "energy-scope-analysis",
              recipeVersion: "1",
              metricRevisionIds: ["metric-current"],
              ruleRevisionIds: ["rule-current"],
            },
          },
        })
        .mockResolvedValueOnce({
          status: "unchanged",
          contextPackage: {
            projectionRef: "sha256:analysis-context-current",
            identity: {
              resolverRevision: "project-analysis-resolver@1",
              workspaceId: "default",
              projectId: "ngee-ann-polytechnic",
              scopeId: "project",
              resource: "electricity",
              analysisWindow: "all-available",
              period: "Custom",
              timezone: "Asia/Singapore",
              from: "2026-01-01T00:00:00.000Z",
              to: "2026-02-01T00:00:00.000Z",
              databasePath: "C:\\secret\\energy.duckdb",
              dataSnapshotId: "snapshot-current",
              projectReleaseId: "release-current",
              hierarchyRevisionId: "hierarchy-current",
              meterMappingRevisionId: "mapping-current",
              meterFormulaRevisionId: "formula-current",
              reportTimePolicyRevisionId: "report-time-current",
              metricVersion: "metric-current",
              businessCalendarVersion: "calendar-current",
              tariffScheduleVersion: "tariff-current",
              overviewDefinitionRevisionId: "overview-current",
              rendererKey: "ngee-ann-overview",
              rendererVersion: "1",
              rendererContractVersion: "project-analysis-snapshot@1",
              recipeId: "energy-scope-analysis",
              recipeVersion: "1",
              metricRevisionIds: ["metric-current"],
              ruleRevisionIds: ["rule-current"],
            },
          },
        })
        .mockResolvedValueOnce({
          status: "not_ready",
          reason: "ENERGYIQ_ANALYSIS_WINDOW_DATA_UNAVAILABLE",
          attempt: {
            contract: "energyiq-analysis-context-prewarm-attempt@1",
            outcome: "not_ready",
            identity: null,
            target: {
              pointer: "default:ngee-ann-polytechnic:project:electricity",
              workspaceId: "default",
              projectId: "ngee-ann-polytechnic",
              scopeId: "project",
              resource: "electricity",
            },
            priorReady: null,
          },
        });
      const context = {
        metadataStore: metadata,
        dataGateway: new LocalDataGateway(metadata),
        userId: "dev-user",
        workspaceId: "default",
      } as Required<ConfigApiContext>;
      const path = ["projects", "ngee-ann-polytechnic", "analysis-context-package", "prewarm"];
      const dependencies = {
        selectCurrentOverviewPeriod: async () => { throw new Error("NOT_USED"); },
        prewarmAnalysisContextPackage: prewarm as never,
      };

      const materialized = await handleEnergyApiRequest(jsonPost({}), path, context, dependencies);
      const unchanged = await handleEnergyApiRequest(jsonPost({}), path, context, dependencies);
      const notReady = await handleEnergyApiRequest(jsonPost({}), path, context, dependencies);

      expect(materialized).toMatchObject({
        status: 201,
        headers: { "Cache-Control": "private, no-store" },
        body: { success: true, data: {
          status: "materialized",
          projectionRef: "sha256:analysis-context-current",
          identity: {
            projectId: "ngee-ann-polytechnic",
            dataSnapshotId: "snapshot-current",
            projectReleaseId: "release-current",
          },
        } },
      });
      expect(unchanged).toMatchObject({
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
        body: { success: true, data: {
          status: "unchanged",
          projectionRef: "sha256:analysis-context-current",
        } },
      });
      expect(notReady).toMatchObject({
        status: 409,
        headers: { "Cache-Control": "private, no-store" },
        body: {
          success: false,
          error: {
            code: "CONFLICT",
            message: "ENERGYIQ_ANALYSIS_WINDOW_DATA_UNAVAILABLE",
            details: {
              attempt: {
                contract: "energyiq-analysis-context-prewarm-attempt@1",
                outcome: "not_ready",
                identity: null,
                target: {
                  pointer: "default:ngee-ann-polytechnic:project:electricity",
                  workspaceId: "default",
                  projectId: "ngee-ann-polytechnic",
                  scopeId: "project",
                  resource: "electricity",
                },
                priorReady: null,
              },
            },
          },
        },
      });
      expect(JSON.stringify(notReady)).not.toMatch(
        /databasePath|energy\.duckdb|prompt|sql|evidence|secret/iu,
      );
      expect(JSON.stringify(materialized)).not.toMatch(
        /databasePath|energy\.duckdb|prompt|sql|evidence|secret/iu,
      );
      expect(JSON.stringify(unchanged)).not.toMatch(
        /databasePath|energy\.duckdb|prompt|sql|evidence|secret/iu,
      );
      expect(prewarm).toHaveBeenCalledTimes(3);
      expect(prewarm).toHaveBeenNthCalledWith(1, expect.objectContaining({
        projectId: "ngee-ann-polytechnic",
        scopeId: "project",
        resource: "electricity",
        workspaceId: "default",
      }));
      expect(prewarm).toHaveBeenNthCalledWith(2, expect.objectContaining({
        projectId: "ngee-ann-polytechnic",
      }));
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("reports an honest conflict when no current Managed Overview has been published", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-api-overview-projection-missing-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      readCurrentProjectOverviewProjection.mockRejectedValueOnce(
        new Error("ENERGYIQ_OVERVIEW_PROJECTION_NOT_MATERIALIZED"),
      );
      const response = await handleEnergyApiRequest(
        getRequest("/api/v1/energy/projects/ngee-ann-polytechnic/overview-projection"),
        ["projects", "ngee-ann-polytechnic", "overview-projection"],
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
          error: { code: "CONFLICT", message: "ENERGYIQ_OVERVIEW_PROJECTION_NOT_MATERIALIZED" },
        },
      });
      expect(resolveProjectAnalysis).not.toHaveBeenCalled();
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

const jsonPost = (body: unknown): IncomingMessage => {
  const request = new PassThrough() as PassThrough & IncomingMessage;
  request.method = "POST";
  request.headers = { "content-type": "application/json" };
  request.end(JSON.stringify(body));
  return request;
};

const getRequest = (url: string): IncomingMessage => {
  const request = new PassThrough() as PassThrough & IncomingMessage;
  request.method = "GET";
  request.url = url;
  request.headers = {};
  request.end();
  return request;
};

const readyDailyAnomalyResolution = () => ({
  status: "ready" as const,
  snapshot: {
    context: {
      workspaceId: "default",
      projectId: "ngee-ann-polytechnic",
      scopeId: "project",
      dataSnapshotId: "snapshot-current",
      projectReleaseId: "release-current",
    },
    projectRelease: { id: "release-current" },
    dataSnapshot: { id: "snapshot-current" },
    analysis: {
      dailyUsageAnomalies: {
        status: "available" as const,
        bundleId: "bundle-current",
        evidencePins: {
          dataSnapshotId: "snapshot-current",
          projectReleaseId: "release-current",
        },
        scopes: [{
          scopeId: "project",
          scopeName: "Ngee Ann Polytechnic",
          scopeType: "project",
          rows: [{
            incidentId: "incident-current",
            outcome: "within_threshold" as const,
            detailSeries: [{ seriesId: "series-current" }],
          }],
        }],
      },
    },
  },
});
