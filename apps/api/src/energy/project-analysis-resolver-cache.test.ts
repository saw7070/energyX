import { LocalDataGateway } from "@datafoundry/data-gateway";
import { createMetadataStore, energyIqPublishedMeterRoutingRevisionId } from "@datafoundry/metadata";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  ensureEnergyIqBootstrap,
  PRESCHOOL_WORKSPACE_ID,
} from "./energy-bootstrap.js";
import { materializePreschoolGoldenFixture } from "./preschool-golden.fixture.js";
import {
  managedProjectionRuleRevisionIdsMatchIdentity,
  materializeCurrentProjectOverviewProjection,
  materializeProjectAnalysisContextPackage,
  prewarmProjectAnalysisContextPackage,
  readProjectAnalysisContextPrewarmOutcome,
  readProjectAnalysisContextPackage,
  readCurrentProjectOverviewLifecycle,
  readCurrentProjectOverviewProjection,
  readCurrentProjectOverviewSnapshotWithLifecycle,
  resolveProjectAnalysis,
  type ProjectAnalysisRequestDiagnostics,
} from "./project-analysis-resolver.js";
import { projectOverviewMinimumFromMaterializedProjection } from "./project-overview-minimum.js";

describe("ProjectAnalysisResolver deterministic result reuse", () => {
  it("treats Rule Revision identity as an exact unordered set", () => {
    const released = [
      "comparison.area_intensity_outlier@1",
      "comparison.highest_child_usage@1",
      "quality.no_valid_data@1",
    ];

    expect(managedProjectionRuleRevisionIdsMatchIdentity([
      "quality.no_valid_data@1",
      "comparison.highest_child_usage@1",
      "comparison.area_intensity_outlier@1",
    ], released)).toBe(true);
    expect(managedProjectionRuleRevisionIdsMatchIdentity(
      released.slice(0, 2),
      released,
    )).toBe(false);
    expect(managedProjectionRuleRevisionIdsMatchIdentity(
      [...released, "time.high_off_hours_share@1"],
      released,
    )).toBe(false);
    expect(managedProjectionRuleRevisionIdsMatchIdentity([
      released[0]!,
      released[0]!,
      released[2]!,
    ], released)).toBe(false);
  });

  it("publishes the current Overview when the exact six released Rule Revisions are permuted", async () => {
    const root = mkdtempSync(join(tmpdir(), "project-overview-rule-order-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      await materializePreschoolGoldenFixture(databasePath, metadata);
      const catalogRuleRevisionIds = metadata.energyIq.rules.listRevisions()
        .map(({ revision_id }) => revision_id);
      expect(catalogRuleRevisionIds).toHaveLength(6);
      const releasedRuleRevisionIds = [...catalogRuleRevisionIds].reverse();
      const initialRuleConfig = metadata.energyIq.rules.getProjectConfig("preschool-demo");
      metadata.energyIq.rules.saveProjectConfig({
        project_id: "preschool-demo",
        expected_revision: initialRuleConfig.revision,
        selected_rule_revision_ids: catalogRuleRevisionIds,
        updated_by: "dev-user",
      });
      metadata.db.prepare(`
        UPDATE energyiq_project_rule_configs
        SET selected_rule_revision_ids_json = ?
        WHERE project_id = ?
      `).run(JSON.stringify(releasedRuleRevisionIds), "preschool-demo");

      const materialized = await materializeCurrentProjectOverviewProjection({
        metadataStore: metadata,
        dataGateway: gateway,
        user: metadata.users.getById({ user_id: "dev-user" }),
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        projectId: "preschool-demo",
        databasePath,
        now: new Date("2026-07-01T00:00:00.000Z"),
      });

      const analysisRuleRevisionIds = materialized.resolution.snapshot.analysis
        .provenance.ruleRevisionIds;
      expect(materialized.resolution.snapshot.projectRelease.ruleRevisionIds)
        .toEqual(releasedRuleRevisionIds);
      expect(analysisRuleRevisionIds).not.toEqual(releasedRuleRevisionIds);
      expect(new Set(analysisRuleRevisionIds)).toEqual(new Set(releasedRuleRevisionIds));
      const projectionFiles = readdirSync(join(root, "project-analysis-cache"));
      expect(projectionFiles.filter((name) => name.startsWith("managed-"))).toHaveLength(1);
      expect(projectionFiles.filter((name) => name.startsWith("current-"))).toHaveLength(1);
    } finally {
      vi.restoreAllMocks();
      metadata.close();
      removeTemporaryFixture(root);
    }
  }, 30_000);

  it("prewarms one exact all-available package and leaves an unchanged identity calculation-free", async () => {
    const root = mkdtempSync(join(tmpdir(), "project-analysis-context-prewarm-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      await materializePreschoolGoldenFixture(databasePath, metadata);
      const user = metadata.users.getById({ user_id: "dev-user" });
      const runSqlReadonly = vi.spyOn(gateway, "runSqlReadonly");
      const resolveAnalysis = vi.fn(resolveProjectAnalysis);
      const operationalEvents: unknown[] = [];
      const input = {
        metadataStore: metadata,
        dataGateway: gateway,
        user,
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        projectId: "preschool-demo",
        scopeId: "project",
        resource: "electricity" as const,
        databasePath,
        now: new Date("2026-07-01T00:00:00.000Z"),
        resolveAnalysis,
        operationalLog: (event: unknown) => operationalEvents.push(event),
      };

      const concurrent = await Promise.all([
        prewarmProjectAnalysisContextPackage(input),
        prewarmProjectAnalysisContextPackage(input),
      ]);
      expect(concurrent.map((result) => result.status)).toEqual([
        "materialized",
        "materialized",
      ]);
      const ready = concurrent[0];
      if (ready.status === "not_ready") throw new Error(ready.reason);
      expect(ready).toMatchObject({
        contextPackage: {
          contract: "energyiq-analysis-context-package@1",
          identity: {
            analysisWindow: "all-available",
            dataSnapshotId: expect.stringMatching(/^energy-snapshot-/u),
            projectReleaseId: "legacy-profile:preschool-demo:2",
          },
        },
      });
      const sqlAfterMaterialization = runSqlReadonly.mock.calls.length;
      expect(sqlAfterMaterialization).toBeGreaterThan(1);
      expect(resolveAnalysis).toHaveBeenCalledOnce();
      const cacheDirectory = join(root, "project-analysis-cache");
      const beforeUnchanged = cacheDirectoryFingerprint(cacheDirectory);

      const unchanged = await prewarmProjectAnalysisContextPackage(input);
      if (unchanged.status === "not_ready") throw new Error(unchanged.reason);
      expect(unchanged.status).toBe("unchanged");
      expect(unchanged.contextPackage.projectionRef).toBe(ready.contextPackage.projectionRef);
      expect(runSqlReadonly.mock.calls.length).toBe(sqlAfterMaterialization);
      expect(resolveAnalysis).toHaveBeenCalledOnce();
      expect(cacheDirectoryFingerprint(cacheDirectory)).toEqual(beforeUnchanged);

      const currentFileName = readdirSync(cacheDirectory).find((name) =>
        name.startsWith("current-"),
      );
      expect(currentFileName).toBeTruthy();
      const currentPath = join(cacheDirectory, currentFileName!);
      const originalCurrent = readFileSync(currentPath, "utf8");
      const failedOperationalEvents: unknown[] = [];
      await expect(prewarmProjectAnalysisContextPackage({
        ...input,
        dataGateway: new LocalDataGateway(metadata),
        resolvePublishedIdentity: vi.fn(async () => {
          throw new Error("UNEXPECTED_PREWARM_TEST");
        }),
        operationalLog: (event: unknown) => failedOperationalEvents.push(event),
      })).rejects.toThrow("UNEXPECTED_PREWARM_TEST");
      expect(readFileSync(currentPath, "utf8")).toBe(originalCurrent);
      expect(failedOperationalEvents).toEqual([
        expect.objectContaining({
          contract: "energyiq-analysis-context-prewarm-operation@1",
          outcome: "failed",
          reasonCode: "UNEXPECTED_ERROR",
          priorReady: expect.objectContaining({
            projectionRef: ready.contextPackage.projectionRef,
            identity: expect.not.objectContaining({ databasePath: expect.anything() }),
          }),
        }),
      ]);
      expect(JSON.stringify(failedOperationalEvents)).not.toMatch(
        /databasePath|energy\.duckdb|prompt|sql|evidence|secret/iu,
      );
      await expect(readProjectAnalysisContextPrewarmOutcome({
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        projectId: "preschool-demo",
        scopeId: "project",
        resource: "electricity",
        databasePath,
      })).resolves.toMatchObject({
        outcome: "failed",
        reasonCode: "UNEXPECTED_ERROR",
        priorReady: { projectionRef: ready.contextPackage.projectionRef },
      });

      metadata.energyIq.upsertProject({
        ...metadata.energyIq.getProject("preschool-demo"),
        data_snapshot_id: "candidate-snapshot-without-ready-facts",
      });
      await expect(prewarmProjectAnalysisContextPackage(input)).resolves.toMatchObject({
        status: "not_ready",
        reason: expect.stringMatching(
          /^ENERGYIQ_(?:ANALYSIS_WINDOW_DATA_UNAVAILABLE|SNAPSHOT_FACTS_UNAVAILABLE)/u,
        ),
        attempt: {
          contract: "energyiq-analysis-context-prewarm-attempt@1",
          outcome: "not_ready",
          identity: null,
          target: {
            pointer: `${PRESCHOOL_WORKSPACE_ID}:preschool-demo:project:electricity`,
            workspaceId: PRESCHOOL_WORKSPACE_ID,
            projectId: "preschool-demo",
            scopeId: "project",
            resource: "electricity",
          },
          priorReady: expect.objectContaining({
            projectionRef: expect.stringMatching(/^sha256:/u),
            identity: expect.not.objectContaining({ databasePath: expect.anything() }),
          }),
        },
      });
      const preserved = await readProjectAnalysisContextPackage({
        metadataStore: metadata,
        dataGateway: gateway,
        user,
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        context: ready.resolution.snapshot.context,
        projectRelease: ready.resolution.snapshot.projectRelease,
        analysisWindow: "all-available",
        databasePath,
      });
      expect(preserved?.contextPackage.projectionRef).toBe(ready.contextPackage.projectionRef);
      expect(resolveAnalysis).toHaveBeenCalledOnce();
      expect(operationalEvents).toHaveLength(4);
      expect(operationalEvents.at(-1)).toMatchObject({
        contract: "energyiq-analysis-context-prewarm-operation@1",
        outcome: "not_ready",
        reasonCode: expect.stringMatching(/^ENERGYIQ_/u),
        target: {
          workspaceId: PRESCHOOL_WORKSPACE_ID,
          projectId: "preschool-demo",
          scopeId: "project",
          resource: "electricity",
        },
        priorReady: { projectionRef: expect.stringMatching(/^sha256:/u) },
      });
      expect(JSON.stringify(operationalEvents)).not.toMatch(
        /databasePath|energy\.duckdb|prompt|sql|evidence|secret/iu,
      );
      await expect(readProjectAnalysisContextPrewarmOutcome({
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        projectId: "preschool-demo",
        scopeId: "project",
        resource: "electricity",
        databasePath,
      })).resolves.toMatchObject({
        outcome: "not_ready",
        priorReady: { projectionRef: ready.contextPackage.projectionRef },
      });

      const packageFiles = readdirSync(join(root, "project-analysis-cache"));
      expect(packageFiles.filter((name) => name.startsWith("managed-"))).toHaveLength(1);
      expect(packageFiles.filter((name) => name.startsWith("current-"))).toHaveLength(2);
      expect(packageFiles.filter((name) => name.startsWith("prewarm-"))).toHaveLength(1);
    } finally {
      vi.restoreAllMocks();
      metadata.close();
      removeTemporaryFixture(root);
    }
  }, 30_000);

  it("persists and reuses only the exact immutable AI analysis window", async () => {
    const root = mkdtempSync(join(tmpdir(), "project-analysis-context-package-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      await materializePreschoolGoldenFixture(databasePath, metadata);
      metadata.users.upsertDevUser({
        id: "analysis-package-viewer",
        email: "analysis-package-viewer@example.com",
        display_name: "Analysis Package Viewer",
        dev_token: "analysis-package-viewer-token",
      });
      metadata.workspaceMemberships.upsert({
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        user_id: "analysis-package-viewer",
        role: "member",
      });
      metadata.energyIq.upsertProjectAccess({
        project_id: "preschool-demo",
        user_id: "analysis-package-viewer",
        role: "viewer",
      });
      metadata.users.upsertDevUser({
        id: "analysis-package-foreign-viewer",
        email: "analysis-package-foreign-viewer@example.com",
        display_name: "Analysis Package Foreign Viewer",
        dev_token: "analysis-package-foreign-viewer-token",
      });
      const user = metadata.users.getById({ user_id: "analysis-package-viewer" });
      const runSqlReadonly = vi.spyOn(gateway, "runSqlReadonly");
      const resolution = await resolveProjectAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        user,
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        request: {
          projectId: "preschool-demo",
          scopeId: "project",
          resource: "electricity",
          period: "Custom",
          from: "2026-05-01",
          to: "2026-06-30",
        },
        databasePath,
        now: new Date("2026-07-01T00:00:00.000Z"),
        includeMutableLifecycle: false,
      });
      if (resolution.status !== "ready") throw new Error("Expected ready ProjectAnalysis");
      const executionSqlCount = runSqlReadonly.mock.calls.length;

      const materialized = await materializeProjectAnalysisContextPackage({
        metadataStore: metadata,
        dataGateway: gateway,
        context: resolution.snapshot.context,
        projectRelease: resolution.snapshot.projectRelease,
        analysisWindow: "all-available",
        resolution,
        databasePath,
      });
      expect(materialized).toMatchObject({
        changed: true,
        contextPackage: {
          contract: "energyiq-analysis-context-package@1",
          identity: {
            analysisWindow: "all-available",
            from: resolution.snapshot.context.from,
            to: resolution.snapshot.context.to,
            dataSnapshotId: resolution.snapshot.dataSnapshot.id,
            projectReleaseId: resolution.snapshot.projectRelease.id,
          },
        },
      });
      const unchanged = await materializeProjectAnalysisContextPackage({
        metadataStore: metadata,
        dataGateway: gateway,
        context: resolution.snapshot.context,
        projectRelease: resolution.snapshot.projectRelease,
        analysisWindow: "all-available",
        resolution,
        databasePath,
      });
      expect(unchanged.changed).toBe(false);
      expect(runSqlReadonly).toHaveBeenCalledTimes(executionSqlCount);
      const cacheDirectory = join(root, "project-analysis-cache");
      const beforePermutation = cacheDirectoryFingerprint(cacheDirectory);
      const permutedIdentity = await materializeProjectAnalysisContextPackage({
        metadataStore: metadata,
        dataGateway: gateway,
        context: resolution.snapshot.context,
        projectRelease: {
          ...resolution.snapshot.projectRelease,
          metricRevisionIds: [...resolution.snapshot.projectRelease.metricRevisionIds].reverse(),
          ruleRevisionIds: [...resolution.snapshot.projectRelease.ruleRevisionIds].reverse(),
        },
        analysisWindow: "all-available",
        resolution,
        databasePath,
      });
      expect(permutedIdentity.changed).toBe(false);
      expect(cacheDirectoryFingerprint(cacheDirectory)).toEqual(beforePermutation);
      expect(runSqlReadonly).toHaveBeenCalledTimes(executionSqlCount);

      const alternateWindow = await materializeProjectAnalysisContextPackage({
        metadataStore: metadata,
        dataGateway: gateway,
        context: resolution.snapshot.context,
        projectRelease: resolution.snapshot.projectRelease,
        analysisWindow: "current-month-to-date",
        resolution,
        databasePath,
      });
      expect(alternateWindow.contextPackage.projectionRef)
        .not.toBe(materialized.contextPackage.projectionRef);
      const restored = await readProjectAnalysisContextPackage({
        metadataStore: metadata,
        dataGateway: gateway,
        user,
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        context: resolution.snapshot.context,
        projectRelease: resolution.snapshot.projectRelease,
        analysisWindow: "all-available",
        databasePath,
      });
      expect(restored?.resolution.snapshot.context.userId).toBe("analysis-package-viewer");
      expect(restored?.contextPackage.projectionRef).toBe(materialized.contextPackage.projectionRef);
      expect(runSqlReadonly).toHaveBeenCalledTimes(executionSqlCount);
      const restoredAlternateWindow = await readProjectAnalysisContextPackage({
        metadataStore: metadata,
        dataGateway: gateway,
        user,
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        context: resolution.snapshot.context,
        projectRelease: resolution.snapshot.projectRelease,
        analysisWindow: "current-month-to-date",
        databasePath,
      });
      expect(restoredAlternateWindow?.contextPackage.projectionRef)
        .toBe(alternateWindow.contextPackage.projectionRef);
      expect(runSqlReadonly).toHaveBeenCalledTimes(executionSqlCount);
      await expect(readProjectAnalysisContextPackage({
        metadataStore: metadata,
        dataGateway: gateway,
        user,
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        context: {
          ...resolution.snapshot.context,
          from: "2026-05-31T16:00:00.000Z",
        },
        projectRelease: resolution.snapshot.projectRelease,
        analysisWindow: "all-available",
        databasePath,
      })).resolves.toBeUndefined();
      await expect(readProjectAnalysisContextPackage({
        metadataStore: metadata,
        dataGateway: gateway,
        user: metadata.users.getById({ user_id: "analysis-package-foreign-viewer" }),
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        context: resolution.snapshot.context,
        projectRelease: resolution.snapshot.projectRelease,
        analysisWindow: "all-available",
        databasePath,
      })).rejects.toThrow("ENERGYIQ_PROJECT_FORBIDDEN");
      expect(runSqlReadonly).toHaveBeenCalledTimes(executionSqlCount);

      const childResolution = await resolveProjectAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        user,
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        request: {
          projectId: "preschool-demo",
          scopeId: "preschool-centre-a",
          resource: "electricity",
          period: "Custom",
          from: "2026-05-01",
          to: "2026-06-30",
        },
        databasePath,
        now: new Date("2026-07-01T00:00:00.000Z"),
        includeMutableLifecycle: false,
      });
      if (childResolution.status !== "ready") throw new Error("Expected ready child analysis");
      const childScope = await materializeProjectAnalysisContextPackage({
        metadataStore: metadata,
        dataGateway: gateway,
        context: childResolution.snapshot.context,
        projectRelease: childResolution.snapshot.projectRelease,
        analysisWindow: "all-available",
        resolution: childResolution,
        databasePath,
      });
      const restoredChildScope = await readProjectAnalysisContextPackage({
        metadataStore: metadata,
        dataGateway: gateway,
        user,
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        context: childResolution.snapshot.context,
        projectRelease: childResolution.snapshot.projectRelease,
        analysisWindow: "all-available",
        databasePath,
      });
      expect(childScope.contextPackage.projectionRef)
        .not.toBe(materialized.contextPackage.projectionRef);
      expect(restoredChildScope?.contextPackage.projectionRef)
        .toBe(childScope.contextPackage.projectionRef);
      const restoredRootAfterChild = await readProjectAnalysisContextPackage({
        metadataStore: metadata,
        dataGateway: gateway,
        user,
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        context: resolution.snapshot.context,
        projectRelease: resolution.snapshot.projectRelease,
        analysisWindow: "all-available",
        databasePath,
      });
      expect(restoredRootAfterChild?.contextPackage.projectionRef)
        .toBe(materialized.contextPackage.projectionRef);
    } finally {
      vi.restoreAllMocks();
      metadata.close();
      removeTemporaryFixture(root);
    }
  }, 30_000);

  it("shares one authorized immutable Overview projection across actors after restart", async () => {
    const root = mkdtempSync(join(tmpdir(), "project-overview-managed-cross-actor-"));
    const databasePath = join(root, "energy.duckdb");
    const metadataPath = join(root, "metadata.sqlite");
    let metadata: ReturnType<typeof createMetadataStore> | undefined;
    let restarted: ReturnType<typeof createMetadataStore> | undefined;
    try {
      metadata = createMetadataStore({ database_path: metadataPath });
      const gateway = new LocalDataGateway(metadata);
      ensureEnergyIqBootstrap(metadata);
      await materializePreschoolGoldenFixture(databasePath, metadata);
      for (const userId of ["materializer-viewer", "charles-viewer"] as const) {
        metadata.users.upsertDevUser({
          id: userId,
          email: `${userId}@example.com`,
          display_name: userId,
          dev_token: `${userId}-token`,
        });
        metadata.workspaceMemberships.upsert({
          workspace_id: PRESCHOOL_WORKSPACE_ID,
          user_id: userId,
          role: "member",
        });
        metadata.energyIq.upsertProjectAccess({
          project_id: "preschool-demo",
          user_id: userId,
          role: "viewer",
        });
      }
      metadata.users.upsertDevUser({
        id: "foreign-viewer",
        email: "foreign-viewer@example.com",
        display_name: "Foreign Viewer",
        dev_token: "foreign-viewer-token",
      });
      const materializerSql = vi.spyOn(gateway, "runSqlReadonly");
      const materialized = await materializeCurrentProjectOverviewProjection({
        metadataStore: metadata,
        dataGateway: gateway,
        user: metadata.users.getById({ user_id: "materializer-viewer" }),
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        projectId: "preschool-demo",
        databasePath,
        now: new Date("2026-07-01T00:00:00.000Z"),
      });
      expect(materialized.changed).toBe(true);
      expect(materialized.contextPackage).toMatchObject({
        contract: "energyiq-overview-context-package@1",
        identity: { dataSnapshotId: materialized.resolution.snapshot.dataSnapshot.id },
      });
      expect(materialized.resolution.snapshot.context.userId).toBe("energyiq-system");
      expect(materialized.resolution.snapshot.analysis.context.userId).toBe("energyiq-system");
      const materializationSqlCount = materializerSql.mock.calls.length;
      expect(materializationSqlCount).toBeGreaterThan(0);
      const unchanged = await materializeCurrentProjectOverviewProjection({
        metadataStore: metadata,
        dataGateway: gateway,
        user: metadata.users.getById({ user_id: "materializer-viewer" }),
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        projectId: "preschool-demo",
        databasePath,
        now: new Date("2026-07-01T00:00:00.000Z"),
      });
      expect(unchanged.changed).toBe(false);
      expect(materializerSql).toHaveBeenCalledTimes(materializationSqlCount);
      const recomputed = await materializeCurrentProjectOverviewProjection({
        metadataStore: metadata,
        dataGateway: gateway,
        user: metadata.users.getById({ user_id: "charles-viewer" }),
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        projectId: "preschool-demo",
        databasePath,
        now: new Date("2026-07-01T01:00:00.000Z"),
        forceRecompute: true,
      });
      expect(recomputed.changed).toBe(false);
      expect(recomputed.resolution).toEqual(materialized.resolution);
      expect(recomputed.resolution.snapshot.context.userId).toBe("energyiq-system");
      expect(recomputed.resolution.snapshot.analysis.context.userId).toBe("energyiq-system");
      expect(materializerSql.mock.calls.length).toBeGreaterThan(materializationSqlCount);

      metadata.close();
      metadata = undefined;
      restarted = createMetadataStore({ database_path: metadataPath });
      const restartedGateway = new LocalDataGateway(restarted);
      const runSqlReadonly = vi.spyOn(restartedGateway, "runSqlReadonly");
      restarted.energyIq.upsertProject({
        ...restarted.energyIq.getProject("preschool-demo"),
        data_snapshot_id: "candidate-snapshot-b-that-failed-materialization",
      });
      const materializedFrom = localDateAt(
        materialized.resolution.snapshot.context.from,
        materialized.resolution.snapshot.context.timezone,
      );
      const materializedTo = localDateAt(
        new Date(Date.parse(materialized.resolution.snapshot.context.to) - 1).toISOString(),
        materialized.resolution.snapshot.context.timezone,
      );
      restarted.db.prepare("DELETE FROM energyiq_user_roles WHERE user_id = ?").run("charles-viewer");
      const metadataChangesBeforeRead = (restarted.db
        .prepare("SELECT total_changes() AS value")
        .get() as { value: number }).value;
      const restored = await readCurrentProjectOverviewProjection({
        metadataStore: restarted,
        dataGateway: restartedGateway,
        user: restarted.users.getById({ user_id: "charles-viewer" }),
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        projectId: "preschool-demo",
        expectedFrom: materializedFrom,
        expectedTo: materializedTo,
        databasePath,
      });
      expect(restored.resolution.snapshot.context.userId).toBe("charles-viewer");
      expect(restored.resolution.snapshot.analysis.context.userId).toBe("charles-viewer");
      expect(materialized.resolution.snapshot.context.userId).toBe("energyiq-system");
      expect(restored.resolution.snapshot.dataSnapshot).toEqual(materialized.resolution.snapshot.dataSnapshot);
      expect(restored.contextPackage.evidenceRefs.length).toBeGreaterThan(0);
      expect(runSqlReadonly).not.toHaveBeenCalled();
      expect(restarted.energyIq.findUserRole("charles-viewer")).toBeUndefined();
      expect((restarted.db.prepare("SELECT total_changes() AS value").get() as {
        value: number;
      }).value).toBe(metadataChangesBeforeRead);

      const minimumForA = projectOverviewMinimumFromMaterializedProjection({
        metadataStore: restarted,
        resolution: restored.resolution,
      });
      expect(restored.resolution.snapshot.projectRelease.templateRevisionId).toBeNull();
      const candidateProject = restarted.energyIq.getProject("preschool-demo");
      const candidateMapping = restarted.energyIq.projectSetup.getDraft({
        project_id: candidateProject.id,
        user_id: "dev-user",
      }).document.meter_mapping;
      if (!candidateMapping) throw new Error("Expected the published Meter Mapping for candidate B");
      const candidateRevision = restarted.energyIq.templates.publishProjectRevisionWithinTransaction({
        project_id: candidateProject.id,
        tier_definition_ids: restarted.energyIq.listTierDefinitions(candidateProject.id).map((tier) => tier.id),
        hierarchy_revision_id: candidateProject.hierarchy_revision_id,
        meter_mapping_revision_id: energyIqPublishedMeterRoutingRevisionId(candidateMapping),
        published_by: "dev-user",
        published_at: "2026-07-01T02:00:00.000Z",
      });
      const candidatePolicy = restarted.energyIq.reportTimePolicies.publish({
        project_id: "preschool-demo",
        policy: {
          policyId: "preschool-candidate-b",
          revision: "1",
          windows: [
            {
              windowId: "candidate-b-7d",
              role: "recent_operations",
              label: "Candidate B recent week",
              strategy: { kind: "rolling_complete_days", days: 7 },
            },
          ],
        },
        published_by: "dev-user",
        published_at: "2026-07-01T02:01:00.000Z",
      });
      restarted.energyIq.overviewDefinitions.attachMigrationRecord({
        project_id: "preschool-demo",
        template_revision_id: candidateRevision.revision_id,
        renderer_key: "preschool-overview",
        definition: {
          contractRevision: "energyiq-overview-definition@1",
          timePolicyRevisionId: candidatePolicy.revision_id,
          sections: [{
            key: "candidate-b",
            title: "Candidate B",
            managementQuestion: "Should failed candidate B replace readable release A?",
            primaryWindowId: "candidate-b-7d",
            blocks: [{
              key: "candidate-b-consumption",
              capabilityRevisionId: "overview.consumption@1",
              emphasis: "primary",
            }],
          }],
        },
        report_time_policy: candidatePolicy.policy,
      });
      const minimumAfterFailedB = projectOverviewMinimumFromMaterializedProjection({
        metadataStore: restarted,
        resolution: restored.resolution,
      });
      expect(minimumAfterFailedB).toEqual(minimumForA);
      expect(minimumAfterFailedB.binding.currentPin.projectReleaseId)
        .toBe(restored.resolution.snapshot.projectRelease.id);

      await expect(readCurrentProjectOverviewLifecycle({
        metadataStore: restarted,
        dataGateway: restartedGateway,
        user: restarted.users.getById({ user_id: "charles-viewer" }),
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        projectId: "preschool-demo",
        expectedProjectionRef: "sha256:not-the-current-projection",
        databasePath,
      })).rejects.toThrow("ENERGYIQ_OVERVIEW_PROJECTION_REF_MISMATCH");
      expect(runSqlReadonly).not.toHaveBeenCalled();

      const listProject = restarted.energyIq.savedAnalyses.listProject
        .bind(restarted.energyIq.savedAnalyses);
      let authoritativeReadCount = 0;
      const listProjectSpy = vi.spyOn(restarted.energyIq.savedAnalyses, "listProject")
        .mockImplementation((projectId) => {
          const savedAnalyses = listProject(projectId);
          authoritativeReadCount += 1;
          if (authoritativeReadCount === 1) {
            restarted!.energyIq.savedAnalyses.create({
              id: "concurrent-lifecycle-saved-analysis",
              series_id: "concurrent-lifecycle-saved-analysis",
              project_id: "preschool-demo",
              workspace_id: PRESCHOOL_WORKSPACE_ID,
              scope_id: "preschool-project",
              scope_name: "Preschool Portfolio",
              resource: "electricity",
              title: "Inserted after the authoritative lifecycle read",
              query_json: "{}",
              analysis_json: "{}",
              template_revision_id: "concurrent-template-revision",
              data_snapshot_id: "concurrent-data-snapshot",
              created_by: "dev-user",
              created_at: "2026-07-01T03:00:00.000Z",
            });
          }
          return savedAnalyses;
        });
      const lifecycle = await readCurrentProjectOverviewLifecycle({
        metadataStore: restarted,
        dataGateway: restartedGateway,
        user: restarted.users.getById({ user_id: "charles-viewer" }),
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        projectId: "preschool-demo",
        expectedProjectionRef: restored.contextPackage.projectionRef,
        databasePath,
      });
      expect(lifecycle).toMatchObject({
        contract: "energyiq-overview-lifecycle@1",
        projectionRef: restored.contextPackage.projectionRef,
        preschoolPlanningLifecycle: { status: "unavailable" },
      });
      expect(listProjectSpy).toHaveBeenCalledTimes(1);
      expect(lifecycle.inputFingerprint).toBe(createHash("sha256")
        .update(JSON.stringify({
          projectionRef: restored.contextPackage.projectionRef,
          savedAnalyses: [],
        }))
        .digest("hex"));
      listProjectSpy.mockRestore();
      await expect(readCurrentProjectOverviewSnapshotWithLifecycle({
        metadataStore: restarted,
        dataGateway: restartedGateway,
        user: restarted.users.getById({ user_id: "charles-viewer" }),
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        projectId: "preschool-demo",
        expectedFrom: materializedFrom,
        expectedTo: materializedTo,
        expectedDataSnapshotId: materialized.resolution.snapshot.dataSnapshot.id,
        expectedProjectReleaseId: materialized.resolution.snapshot.projectRelease.id,
        databasePath,
      })).resolves.toMatchObject({
        preschoolPlanningLifecycle: { status: "unavailable" },
      });

      await expect(readCurrentProjectOverviewProjection({
        metadataStore: restarted,
        dataGateway: restartedGateway,
        user: restarted.users.getById({ user_id: "foreign-viewer" }),
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        projectId: "preschool-demo",
        databasePath,
      })).rejects.toThrow("ENERGYIQ_PROJECT_FORBIDDEN");
      const sqlCountAfterLifecycle = runSqlReadonly.mock.calls.length;

      const projectionDirectory = join(root, "project-analysis-cache");
      const projectionFile = readdirSync(projectionDirectory)
        .find((name) => /^managed-[a-f0-9]{64}\.json$/u.test(name));
      if (!projectionFile) throw new Error("Expected one managed projection file");
      const projectionPath = join(projectionDirectory, projectionFile);
      const pristineStored = JSON.parse(readFileSync(projectionPath, "utf8")) as {
        value: { snapshot: Record<string, any> };
        valueSha256: string;
      };
      expect(pristineStored.value.snapshot.context.userId).toBe("energyiq-system");
      expect(pristineStored.value.snapshot.analysis.context.userId).toBe("energyiq-system");
      const evidencePinFields = [
        "projectReleaseId",
        "dataSnapshotId",
        "hierarchyRevisionId",
        "meterMappingRevisionId",
        "meterFormulaRevisionId",
        "metricVersion",
        "businessCalendarVersion",
      ] as const;
      const includeAnomalyQueryInProvenance = (snapshot: Record<string, any>) => {
        if (!snapshot.analysis.provenance.queryIds.includes("time_slot_anomaly_v1")) {
          snapshot.analysis.provenance.queryIds.push("time_slot_anomaly_v1");
        }
      };
      const exactEvidencePins = (snapshot: Record<string, any>) => {
        includeAnomalyQueryInProvenance(snapshot);
        return {
          projectReleaseId: snapshot.projectRelease.id,
          dataSnapshotId: snapshot.dataSnapshot.id,
          hierarchyRevisionId: snapshot.analysis.provenance.hierarchyRevisionId,
          meterMappingRevisionId: snapshot.analysis.provenance.meterMappingRevisionId,
          meterFormulaRevisionId: snapshot.analysis.provenance.meterFormulaRevisionId,
          metricVersion: snapshot.analysis.provenance.metricVersion,
          businessCalendarVersion: snapshot.context.businessCalendarVersion,
          queryIds: ["time_slot_anomaly_v1"],
        };
      };
      const availableDailyUsageAnomalies = (snapshot: Record<string, any>) => ({
        status: "available",
        bundleId: "daily-usage-anomalies:test",
        metricId: "energy.total_usage_kwh@1",
        queryId: "time_slot_anomaly_v1",
        ruleRevisionId: "comparison.daily_usage_above_baseline@1",
        timezone: snapshot.context.timezone,
        baselineCutoff: "2026-06-01",
        rule: {
          relativeThresholdPct: 20,
          absoluteImpactKwh: 10,
          minimumCoveragePct: 100,
          minimumSampleCount: 3,
          maximumQualityEventCount: 0,
          maximumLookbackDays: 28,
          direction: "above",
          baselineMethod: "mean_of_complete_comparable_days_by_local_hour",
        },
        evidencePins: exactEvidencePins(snapshot),
        scopes: [],
      });
      const exactPinnedStored = structuredClone(pristineStored);
      exactPinnedStored.value.snapshot.analysis.dailyUsageAnomalies = availableDailyUsageAnomalies(
        exactPinnedStored.value.snapshot,
      );
      exactPinnedStored.value.snapshot.decisionPriorities = {
        status: "empty",
        limitation: null,
        evidencePins: exactEvidencePins(exactPinnedStored.value.snapshot),
        items: [],
      };
      exactPinnedStored.valueSha256 = createHash("sha256")
        .update(JSON.stringify(exactPinnedStored.value))
        .digest("hex");
      writeFileSync(projectionPath, JSON.stringify(exactPinnedStored), "utf8");
      await expect(readCurrentProjectOverviewProjection({
        metadataStore: restarted,
        dataGateway: restartedGateway,
        user: restarted.users.getById({ user_id: "charles-viewer" }),
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        projectId: "preschool-demo",
        databasePath,
      })).resolves.toMatchObject({
        resolution: { status: "ready" },
      });
      expect(runSqlReadonly).toHaveBeenCalledTimes(sqlCountAfterLifecycle);
      const corruptions: Array<{
        label: string;
        mutate: (snapshot: Record<string, any>) => void;
      }> = [
        {
          label: "null finding",
          mutate: (snapshot) => { snapshot.findings = [null]; },
        },
        {
          label: "empty metadata",
          mutate: (snapshot) => { snapshot.metadata = {}; },
        },
        {
          label: "empty data quality",
          mutate: (snapshot) => { snapshot.dataQuality = {}; },
        },
        {
          label: "missing analysis cost",
          mutate: (snapshot) => { delete snapshot.analysis.cost; },
        },
        {
          label: "wrong ReportTime contract revision",
          mutate: (snapshot) => { snapshot.reportTimeContext.contractRevision = "wrong"; },
        },
        {
          label: "missing ReportTime data-through date",
          mutate: (snapshot) => { delete snapshot.reportTimeContext.dataThroughLocalDate; },
        },
        {
          label: "missing ReportTime window identity",
          mutate: (snapshot) => { delete snapshot.reportTimeContext.windows[0].windowId; },
        },
        {
          label: "missing ReportTime window label",
          mutate: (snapshot) => { delete snapshot.reportTimeContext.windows[0].label; },
        },
        {
          label: "invalid ReportTime window phase",
          mutate: (snapshot) => { snapshot.reportTimeContext.windows[0].phase = "wrong"; },
        },
        {
          label: "missing ReportTime window start",
          mutate: (snapshot) => { delete snapshot.reportTimeContext.windows[0].from; },
        },
        {
          label: "missing ReportTime window end",
          mutate: (snapshot) => { delete snapshot.reportTimeContext.windows[0].toExclusive; },
        },
        {
          label: "malformed ReportTime window segments",
          mutate: (snapshot) => { snapshot.reportTimeContext.windows[0].segments = [null]; },
        },
        {
          label: "ReportTime window policy label drift",
          mutate: (snapshot) => { snapshot.reportTimeContext.windows[0].label += " (forged)"; },
        },
        {
          label: "ReportTime window policy strategy drift",
          mutate: (snapshot) => {
            snapshot.reportTimeContext.windows[0].strategy = { kind: "next_complete_calendar_month" };
          },
        },
        {
          label: "ReportTime resolved window segment drift",
          mutate: (snapshot) => {
            const segment = snapshot.reportTimeContext.windows[0].segments[0];
            segment.from = segment.toExclusive;
          },
        },
        {
          label: "empty Project Release document",
          mutate: (snapshot) => { snapshot.projectRelease.document = {}; },
        },
        {
          label: "malformed Project Release template",
          mutate: (snapshot) => { snapshot.projectRelease.document.templates = [{}]; },
        },
        {
          label: "malformed Project Release catalog",
          mutate: (snapshot) => { snapshot.projectRelease.catalog = [{}]; },
        },
        {
          label: "valid-shape Project Release document drift",
          mutate: (snapshot) => {
            snapshot.projectRelease.document.templates[0].sections[0].title += " (forged)";
          },
        },
        {
          label: "malformed report-window analysis",
          mutate: (snapshot) => { snapshot.reportWindowAnalyses = [{}]; },
        },
        {
          label: "malformed report-window segment summary",
          mutate: (snapshot) => { snapshot.reportWindowSegmentSummaries = [{}]; },
        },
        {
          label: "empty meter health",
          mutate: (snapshot) => { snapshot.meterDataHealth = {}; },
        },
        {
          label: "empty decision priorities",
          mutate: (snapshot) => { snapshot.decisionPriorities = {}; },
        },
        ...evidencePinFields.map((field) => ({
          label: `daily anomaly ${field} Evidence pin drift`,
          mutate: (snapshot: Record<string, any>) => {
            snapshot.analysis.dailyUsageAnomalies = availableDailyUsageAnomalies(snapshot);
            snapshot.analysis.dailyUsageAnomalies.evidencePins[field] = `mismatched-${field}`;
          },
        })),
        {
          label: "daily anomaly query Evidence pin drift",
          mutate: (snapshot) => {
            snapshot.analysis.dailyUsageAnomalies = availableDailyUsageAnomalies(snapshot);
            snapshot.analysis.dailyUsageAnomalies.evidencePins.queryIds = ["forged_query_v1"];
          },
        },
        ...evidencePinFields.map((field) => ({
          label: `decision priority ${field} Evidence pin drift`,
          mutate: (snapshot: Record<string, any>) => {
            includeAnomalyQueryInProvenance(snapshot);
            snapshot.decisionPriorities = {
              status: "empty",
              limitation: null,
              evidencePins: {
                ...exactEvidencePins(snapshot),
                [field]: `mismatched-${field}`,
              },
              items: [],
            };
          },
        })),
        {
          label: "decision priority query Evidence pin drift",
          mutate: (snapshot) => {
            includeAnomalyQueryInProvenance(snapshot);
            snapshot.decisionPriorities = {
              status: "empty",
              limitation: null,
              evidencePins: {
                ...exactEvidencePins(snapshot),
                queryIds: ["forged_query_v1"],
              },
              items: [],
            };
          },
        },
        {
          label: "malformed nested decision priority consumer payload",
          mutate: (snapshot) => {
            snapshot.decisionPriorities = {
              status: "available",
              limitation: null,
              evidencePins: {
                projectReleaseId: snapshot.projectRelease.id,
                dataSnapshotId: snapshot.dataSnapshot.id,
                hierarchyRevisionId: snapshot.analysis.provenance.hierarchyRevisionId,
                meterMappingRevisionId: snapshot.analysis.provenance.meterMappingRevisionId,
                meterFormulaRevisionId: snapshot.analysis.provenance.meterFormulaRevisionId,
                metricVersion: snapshot.analysis.provenance.metricVersion,
                businessCalendarVersion: snapshot.context.businessCalendarVersion,
                queryIds: [],
              },
              items: [{
                priorityId: "priority-1",
                source: "daily_usage_anomaly",
                rank: 1,
                finding: {
                  code: "DAILY_USAGE_ABOVE_BASELINE",
                  title: "Daily usage above baseline",
                  actualKwh: 150,
                  baselineKwh: 100,
                  relativePct: 50,
                },
                sourceOccurrenceIds: ["incident-1"],
                recurrenceDayCount: 1,
                horizons: [],
                driver: { status: "unavailable", limitation: "No driver Evidence." },
                evidence: {
                  bundleId: "bundle-1",
                  metricId: "energy.total_usage_kwh@1",
                  ruleRevisionId: "comparison.daily_usage_above_baseline@1",
                  primaryIncidentId: "incident-1",
                  queryIds: ["time_slot_anomaly_v1"],
                  supportingIncidentIds: [],
                },
                impact: { energy: {}, cost: {} },
                action: {
                  code: "INSPECT_DAILY_USAGE_DRIVERS",
                  label: "Inspect",
                  targetIncidentId: "incident-1",
                  nextCheck: "Next complete day",
                },
                confidence: { status: "complete", limitation: null },
              }],
            };
          },
        },
        {
          label: "mutable decision lifecycle embedded in immutable projection",
          mutate: (snapshot) => {
            snapshot.decisionLifecycle = {
              status: "unavailable",
              reference: null,
              currentDataSnapshotId: snapshot.dataSnapshot.id,
              items: [],
              limitation: {
                code: "NO_COMPATIBLE_SAVED_ANALYSIS",
                message: "Mutable lifecycle must not be persisted.",
              },
            };
          },
        },
        {
          label: "empty Preschool benchmark",
          mutate: (snapshot) => { snapshot.preschoolBenchmark = {}; },
        },
        {
          label: "empty Preschool appliances",
          mutate: (snapshot) => { snapshot.preschoolAppliances = {}; },
        },
        {
          label: "empty Preschool operational projection",
          mutate: (snapshot) => { snapshot.preschoolOperational = {}; },
        },
        {
          label: "malformed Preschool operational unavailable reason",
          mutate: (snapshot) => { snapshot.preschoolOperational.reason = {}; },
        },
        {
          label: "malformed Preschool operational unavailable evidence",
          mutate: (snapshot) => { snapshot.preschoolOperational.evidence = {}; },
        },
        {
          label: "mutable Preschool planning lifecycle embedded in immutable projection",
          mutate: (snapshot) => {
            snapshot.preschoolPlanningLifecycle = {
              status: "unavailable",
              reason: {
                code: "NO_COMPATIBLE_SAVED_ANALYSIS",
                message: "Mutable lifecycle must not be persisted.",
              },
            };
          },
        },
        {
          label: "empty Preschool decision signals",
          mutate: (snapshot) => { snapshot.preschoolDecisionSignals = {}; },
        },
        ...[
          "dailyTotals",
          "componentCategoryBreakdown",
          "calendarTotals",
          "timeBehaviour",
          "componentHourlyProfiles",
          "dailyUsageAnomalies",
          "peakBreakdown",
        ].map((field) => ({
          label: `empty analysis ${field}`,
          mutate: (snapshot: Record<string, any>) => { snapshot.analysis[field] = {}; },
        })),
        {
          label: "malformed virtual meter trace",
          mutate: (snapshot) => { snapshot.analysis.virtualMeterTraces = [{}]; },
        },
        {
          label: "malformed latest available period",
          mutate: (snapshot) => { snapshot.latestAvailablePeriod = {}; },
        },
        {
          label: "malformed latest complete local day",
          mutate: (snapshot) => { snapshot.context.latestCompleteLocalDay = {}; },
        },
        {
          label: "malformed monthly outlook target period",
          mutate: (snapshot) => { snapshot.context.monthlyOutlookTargetPeriod = {}; },
        },
        ...[
          "hierarchyRevisionId",
          "meterMappingRevisionId",
          "meterFormulaRevisionId",
          "businessCalendarVersion",
          "tariffScheduleVersion",
        ].map((field) => ({
          label: `snapshot context ${field} identity drift`,
          mutate: (snapshot: Record<string, any>) => {
            snapshot.context[field] = `mismatched-${field}`;
          },
        })),
        {
          label: "Project Release project identity drift",
          mutate: (snapshot) => { snapshot.projectRelease.projectId = "different-project"; },
        },
        ...[
          "workspaceId",
          "projectId",
          "scopeId",
          "resource",
          "period",
          "timezone",
          "from",
          "to",
          "dataSnapshotId",
          "hierarchyRevisionId",
          "meterMappingRevisionId",
          "meterFormulaRevisionId",
          "metricVersion",
          "businessCalendarVersion",
          "tariffScheduleVersion",
        ].map((field) => ({
          label: `analysis context ${field} identity drift`,
          mutate: (snapshot: Record<string, any>) => {
            snapshot.analysis.context[field] = `mismatched-${field}`;
          },
        })),
      ];
      for (const corruption of corruptions) {
        const stored = structuredClone(pristineStored);
        corruption.mutate(stored.value.snapshot);
        stored.valueSha256 = createHash("sha256")
          .update(JSON.stringify(stored.value))
          .digest("hex");
        writeFileSync(projectionPath, JSON.stringify(stored), "utf8");

        await readCurrentProjectOverviewProjection({
          metadataStore: restarted,
          dataGateway: restartedGateway,
          user: restarted.users.getById({ user_id: "charles-viewer" }),
          workspaceId: PRESCHOOL_WORKSPACE_ID,
          projectId: "preschool-demo",
          databasePath,
        }).then(
          () => { throw new Error(`Malformed managed projection was accepted: ${corruption.label}`); },
          (error: unknown) => expect(error).toMatchObject({
            message: "ENERGYIQ_OVERVIEW_PROJECTION_NOT_MATERIALIZED",
          }),
        );
        expect(runSqlReadonly, corruption.label).toHaveBeenCalledTimes(sqlCountAfterLifecycle);
      }
    } finally {
      vi.restoreAllMocks();
      metadata?.close();
      restarted?.close();
      removeTemporaryFixture(root);
    }
  }, 30_000);

  it("restores the exact authorised Snapshot projection after recreating the API stores", async () => {
    const root = mkdtempSync(join(tmpdir(), "project-analysis-process-restart-cache-"));
    const databasePath = join(root, "energy.duckdb");
    const metadataPath = join(root, "metadata.sqlite");
    let firstMetadata: ReturnType<typeof createMetadataStore> | undefined;
    let restartedMetadata: ReturnType<typeof createMetadataStore> | undefined;
    try {
      firstMetadata = createMetadataStore({ database_path: metadataPath });
      const firstGateway = new LocalDataGateway(firstMetadata);
      ensureEnergyIqBootstrap(firstMetadata);
      await materializePreschoolGoldenFixture(databasePath, firstMetadata);
      firstMetadata.users.upsertDevUser({
        id: "process-restart-cache-viewer",
        email: "process-restart-cache-viewer@example.com",
        display_name: "Process Restart Cache Viewer",
        dev_token: "process-restart-cache-viewer-token",
      });
      firstMetadata.workspaceMemberships.upsert({
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        user_id: "process-restart-cache-viewer",
        role: "member",
      });
      firstMetadata.energyIq.upsertProjectAccess({
        project_id: "preschool-demo",
        user_id: "process-restart-cache-viewer",
        role: "viewer",
      });
      const request = {
        projectId: "preschool-demo",
        scopeId: "project",
        resource: "electricity" as const,
        period: "Custom" as const,
        from: "2026-05-01",
        to: "2026-05-31",
      };
      let firstDiagnostics: ProjectAnalysisRequestDiagnostics | undefined;
      const first = await resolveProjectAnalysis({
        metadataStore: firstMetadata,
        dataGateway: firstGateway,
        user: firstMetadata.users.getById({ user_id: "process-restart-cache-viewer" }),
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        request,
        databasePath,
        now: new Date("2026-06-01T00:00:00.000Z"),
        onDiagnostics: (diagnostics) => {
          firstDiagnostics = diagnostics;
        },
      });
      expect(first).toMatchObject({ status: "ready" });
      expect(firstDiagnostics).toMatchObject({ cacheStatus: "computed" });
      firstMetadata.close();
      firstMetadata = undefined;

      restartedMetadata = createMetadataStore({ database_path: metadataPath });
      const restartedGateway = new LocalDataGateway(restartedMetadata);
      const restartedSql = vi.spyOn(restartedGateway, "runSqlReadonly");
      let restoredDiagnostics: ProjectAnalysisRequestDiagnostics | undefined;
      const restored = await resolveProjectAnalysis({
        metadataStore: restartedMetadata,
        dataGateway: restartedGateway,
        user: restartedMetadata.users.getById({ user_id: "process-restart-cache-viewer" }),
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        request,
        databasePath,
        now: new Date("2026-06-01T00:00:00.000Z"),
        onDiagnostics: (diagnostics) => {
          restoredDiagnostics = diagnostics;
        },
      });
      expect(restored).toMatchObject({
        status: "ready",
        snapshot: first.status === "ready" ? first.snapshot : undefined,
      });
      expect(restoredDiagnostics).toEqual({
        cacheStatus: "reused",
        evidenceQueryCount: firstDiagnostics?.evidenceQueryCount,
      });
      expect(restartedSql).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
      firstMetadata?.close();
      restartedMetadata?.close();
      removeTemporaryFixture(root);
    }
  }, 30_000);

  it("reuses one authorized success until an explicit refresh bypasses it", async () => {
    const root = mkdtempSync(join(tmpdir(), "project-analysis-cache-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      await materializePreschoolGoldenFixture(databasePath, metadata);
      metadata.users.upsertDevUser({
        id: "preschool-cache-viewer",
        email: "preschool-cache-viewer@example.com",
        display_name: "Preschool Cache Viewer",
        dev_token: "preschool-cache-viewer-token",
      });
      metadata.workspaceMemberships.upsert({
        workspace_id: PRESCHOOL_WORKSPACE_ID,
        user_id: "preschool-cache-viewer",
        role: "member",
      });
      metadata.energyIq.upsertProjectAccess({
        project_id: "preschool-demo",
        user_id: "preschool-cache-viewer",
        role: "viewer",
      });
      const runSqlReadonly = vi.spyOn(gateway, "runSqlReadonly");
      const diagnostics: ProjectAnalysisRequestDiagnostics[] = [];
      const baseInput = {
        metadataStore: metadata,
        dataGateway: gateway,
        user: metadata.users.getById({ user_id: "preschool-cache-viewer" }),
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        request: {
          projectId: "preschool-demo",
          scopeId: "project",
          resource: "electricity" as const,
          period: "Custom" as const,
          from: "2026-05-01",
          to: "2026-05-31",
        },
        databasePath,
        now: new Date("2026-06-01T00:00:00.000Z"),
        onDiagnostics: (value: ProjectAnalysisRequestDiagnostics) => {
          diagnostics.push(value);
        },
      };

      const firstStartedAt = performance.now();
      const first = await resolveProjectAnalysis(baseInput);
      const firstDurationMs = performance.now() - firstStartedAt;
      const firstExecutionSqlCount = runSqlReadonly.mock.calls.length;
      expect(first).toMatchObject({ status: "ready" });
      expect(diagnostics.at(-1)).toEqual({
        cacheStatus: "computed",
        evidenceQueryCount: expect.any(Number),
      });
      expect(firstExecutionSqlCount).toBeGreaterThan(0);

      const repeatedStartedAt = performance.now();
      const repeated = await resolveProjectAnalysis(baseInput);
      const repeatedDurationMs = performance.now() - repeatedStartedAt;
      expect(repeated).toEqual(first);
      expect(diagnostics.at(-1)).toEqual({
        cacheStatus: "reused",
        evidenceQueryCount: diagnostics[0]?.evidenceQueryCount,
      });
      expect(runSqlReadonly).toHaveBeenCalledTimes(firstExecutionSqlCount);
      expect(repeatedDurationMs).toBeLessThan(firstDurationMs / 5);

      const publishedProject = metadata.energyIq.getProject("preschool-demo");
      const setProjectStatus = (status: "draft" | "published") => metadata.energyIq.upsertProject({
        id: publishedProject.id,
        workspace_id: publishedProject.workspace_id,
        name: publishedProject.name,
        status,
        timezone: publishedProject.timezone,
        hierarchy_revision_id: publishedProject.hierarchy_revision_id,
        meter_formula_revision_id: publishedProject.meter_formula_revision_id,
        data_snapshot_id: publishedProject.data_snapshot_id,
        metric_version: publishedProject.metric_version,
        business_calendar_version: publishedProject.business_calendar_version,
        tariff_schedule_version: publishedProject.tariff_schedule_version,
        delivery_stage: publishedProject.delivery_stage,
        root_scope_id: publishedProject.root_scope_id,
        has_unpublished_changes: publishedProject.has_unpublished_changes,
      });
      setProjectStatus("draft");
      await expect(resolveProjectAnalysis(baseInput)).rejects.toThrow("ENERGYIQ_PROJECT_FORBIDDEN");
      expect(runSqlReadonly).toHaveBeenCalledTimes(firstExecutionSqlCount);
      setProjectStatus("published");
      await expect(resolveProjectAnalysis(baseInput)).resolves.toEqual(first);
      expect(diagnostics.at(-1)?.cacheStatus).toBe("reused");
      expect(runSqlReadonly).toHaveBeenCalledTimes(firstExecutionSqlCount);

      const refreshStartedAt = performance.now();
      const refreshed = await resolveProjectAnalysis({ ...baseInput, bypassCache: true });
      const refreshDurationMs = performance.now() - refreshStartedAt;
      expect(refreshed).toMatchObject({
        status: "ready",
        snapshot: {
          context: {
            dataSnapshotId: first.status === "ready" ? first.snapshot.context.dataSnapshotId : undefined,
            projectReleaseId: first.status === "ready" ? first.snapshot.context.projectReleaseId : undefined,
          },
        },
      });
      expect(runSqlReadonly.mock.calls.length).toBeGreaterThan(firstExecutionSqlCount);
      expect(refreshDurationMs).toBeGreaterThan(repeatedDurationMs * 5);
      expect(diagnostics.at(-1)?.cacheStatus).toBe("computed");

      const overviewInput = {
        ...baseInput,
        request: {
          projectId: "preschool-demo",
          scopeId: "project",
          resource: "electricity" as const,
          analysisWindow: "current-overview-28d" as const,
        },
      };
      const overview = await resolveProjectAnalysis(overviewInput);
      expect(overview).toMatchObject({
        status: "ready",
        snapshot: {
          preschoolPlanningLifecycle: {
            status: "unavailable",
            reason: { code: "NO_COMPATIBLE_SAVED_ANALYSIS" },
          },
        },
      });
      const overviewExecutionSqlCount = runSqlReadonly.mock.calls.length;
      const repeatedOverview = await resolveProjectAnalysis(overviewInput);
      expect(repeatedOverview).toEqual(overview);
      expect(diagnostics.at(-1)?.cacheStatus).toBe("reused");
      // Current-window selection uses the direct bounded fact-store reader outside this gateway spy.
      // The repeated Overview must add no further Kernel runSqlReadonly work.
      expect(runSqlReadonly).toHaveBeenCalledTimes(overviewExecutionSqlCount);
    } finally {
      vi.restoreAllMocks();
      metadata.close();
      removeTemporaryFixture(root);
    }
  }, 30_000);

  it("reuses a compatible Saved Plan lifecycle for the same immutable Snapshot and Release", async () => {
    const root = mkdtempSync(join(tmpdir(), "project-planning-lifecycle-cache-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      await materializePreschoolGoldenFixture(databasePath, metadata);
      const project = metadata.energyIq.getProject("preschool-demo");
      const tierDefinitionIds = metadata.energyIq.listTierDefinitions(project.id).map((tier) => tier.id);
      const mapping = metadata.energyIq.projectSetup.getDraft({
        project_id: project.id,
        user_id: "dev-user",
      }).document.meter_mapping;
      if (!mapping) throw new Error("Expected a published meter mapping");
      metadata.energyIq.templates.publishProjectRevisionWithinTransaction({
        project_id: project.id,
        tier_definition_ids: tierDefinitionIds,
        hierarchy_revision_id: project.hierarchy_revision_id,
        meter_mapping_revision_id: energyIqPublishedMeterRoutingRevisionId(mapping),
        published_by: "dev-user",
        published_at: "2026-06-01T00:00:00.000Z",
      });
      const baseInput = {
        metadataStore: metadata,
        dataGateway: gateway,
        user: metadata.users.getById({ user_id: "dev-user" }),
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        request: {
          projectId: "preschool-demo",
          scopeId: "project",
          resource: "electricity" as const,
          period: "Custom" as const,
          from: "2026-05-01",
          to: "2026-05-31",
        },
        databasePath,
        now: new Date("2026-06-01T00:00:00.000Z"),
      };
      const first = await resolveProjectAnalysis(baseInput);
      if (first.status !== "ready") throw new Error("Expected a ready Preschool analysis");

      const savedSnapshot = structuredClone(first.snapshot);
      const previousSnapshotId = "preschool-cache-saved-plan-snapshot";
      const planningTarget = first.snapshot.context.monthlyOutlookTargetPeriod;
      if (!planningTarget) throw new Error("Expected a Preschool planning target");
      const planningEndInclusive = new Date(`${planningTarget.endExclusive}T00:00:00.000Z`);
      planningEndInclusive.setUTCDate(planningEndInclusive.getUTCDate() - 1);
      savedSnapshot.context.dataSnapshotId = previousSnapshotId;
      savedSnapshot.dataSnapshot.id = previousSnapshotId;
      savedSnapshot.analysis.provenance.dataSnapshotId = previousSnapshotId;
      (savedSnapshot as unknown as { preschoolOperational: unknown }).preschoolOperational = {
        planningOutlook: {
          status: "provisional",
          contract: { id: "preschool-monthly-naive-weekly-baseline", version: "2" },
          targetPeriod: {
            start: planningTarget.start,
            endInclusive: planningEndInclusive.toISOString().slice(0, 10),
            endExclusive: planningTarget.endExclusive,
            timezone: planningTarget.timezone,
            days: planningTarget.targetDayCount,
          },
          sourceWeeks: [],
          weeklyBaseline: { averageKwh: 7_000, minimumKwh: 6_500, maximumKwh: 7_500 },
          usageEstimate: { projectedKwh: 30_000, lowerKwh: 28_000, upperKwh: 32_000 },
          costEstimate: {
            currency: "SGD",
            currentPeriodBeforeGstSgd: 7_500,
            projectedBeforeGstSgd: 8_000,
            lowerBeforeGstSgd: 7_500,
            upperBeforeGstSgd: 8_500,
          },
          evidence: {
            dataSnapshotId: previousSnapshotId,
            queryId: "daily_totals_v1",
            recipeId: "preschool-naive-weekly-planning-baseline-v1",
          },
          limitations: [],
        },
      };
      metadata.energyIq.savedAnalyses.create({
        id: "preschool-cache-saved-plan",
        series_id: "preschool-cache-saved-plan",
        project_id: first.snapshot.context.projectId,
        workspace_id: first.snapshot.context.workspaceId,
        scope_id: first.snapshot.context.scopeId,
        scope_name: "Preschool Portfolio",
        resource: "electricity",
        title: "Saved plan used by the cache regression",
        query_json: JSON.stringify(baseInput.request),
        analysis_json: JSON.stringify(savedSnapshot.analysis),
        snapshot_json: JSON.stringify(savedSnapshot),
        template_revision_id: first.snapshot.projectRelease.templateRevisionId!,
        data_snapshot_id: previousSnapshotId,
        created_by: "dev-user",
        created_at: "2026-06-01T00:00:00.000Z",
      });

      const runSqlReadonly = vi.spyOn(gateway, "runSqlReadonly");
      const lifecycle = await resolveProjectAnalysis(baseInput);
      expect(lifecycle).toMatchObject({
        status: "ready",
        snapshot: { preschoolPlanningLifecycle: { status: "available" } },
      });
      const lifecycleSqlCount = runSqlReadonly.mock.calls.length;
      expect(lifecycleSqlCount).toBeGreaterThan(0);
      const repeatedLifecycle = await resolveProjectAnalysis(baseInput);
      expect(repeatedLifecycle).toEqual(lifecycle);
      expect(runSqlReadonly).toHaveBeenCalledTimes(lifecycleSqlCount);
    } finally {
      vi.restoreAllMocks();
      metadata.close();
      removeTemporaryFixture(root);
    }
  }, 30_000);
});

function localDateAt(timestamp: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

const cacheDirectoryFingerprint = (directory: string) => readdirSync(directory)
  .sort((left, right) => left.localeCompare(right))
  .map((name) => {
    const path = join(directory, name);
    return {
      name,
      sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
      mtimeMs: statSync(path).mtimeMs,
    };
  });

const removeTemporaryFixture = (root: string): void => {
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
