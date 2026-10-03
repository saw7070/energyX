import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createMetadataStore } from "@datafoundry/metadata";
import { LocalDataGateway } from "./index.js";
import { DuckDbAdapter } from "./adapters/local-sql-adapters.js";
import { getDuckDbDatabase } from "./duckdb-database-cache.js";
import {
  ENERGY_FACT_WRITER_CONTRACT_VERSION,
  writeEnergyFactProjectMaterialization,
  type EnergyFactMaterializationBatchWrite,
} from "./energy-fact-writer.js";
import {
  ensureEnergyScopedDataSource,
  exportEnergyScopedCsv,
  readEnergyScopedActionIntervals,
  readEnergyAnalysisEligibleCoverage,
  readEnergyMeterIntervalCoverage,
  readEnergyCurrentOverviewPeriod,
  readEnergyFactCoverage,
  readEnergyReportingCoverage,
  readEnergyOverviewHeadline,
  resolveEnergyFactStorePath,
} from "./energy-scoped-datasource.js";

describe("Energy scoped datasource Snapshot guard", () => {
  it("resolves each Workspace fact store beneath the configured shared storage root", () => {
    const storageRoot = join(tmpdir(), "energyiq-shared-storage");
    expect(resolveEnergyFactStorePath("workspace-a", undefined, storageRoot)).toBe(
      join(storageRoot, "energy", "workspace-a", "energy.duckdb"),
    );
    expect(resolveEnergyFactStorePath("workspace-a", join(storageRoot, "explicit.duckdb"), storageRoot)).toBe(
      join(storageRoot, "explicit.duckdb"),
    );
  });

  it("preserves the DuckDB :memory: sentinel instead of resolving it as a filesystem path", async () => {
    const adapter = new DuckDbAdapter({ path: ":memory:" });
    await expect(adapter.runSqlReadonly({
      sql: "SELECT 1 AS sentinel_value",
      limit: 10,
    })).resolves.toMatchObject({ rows: [[1]] });
  });

  it("returns no analysis-eligible coverage when a Snapshot contains only rejected facts", async () => {
    const fixture = await createCoverageFixture([
      { start: "2026-05-01T00:00:00.000Z", qualityStatus: "negative_delta" },
      { start: "2026-05-01T00:15:00.000Z", qualityStatus: "rejected" },
    ]);
    try {
      await expect(readEnergyAnalysisEligibleCoverage(fixture.input)).resolves.toBeNull();
    } finally {
      fixture.close();
    }
  });

  it("does not let rejected facts at either edge widen analysis-eligible coverage", async () => {
    const fixture = await createCoverageFixture([
      { start: "2026-05-01T00:00:00.000Z", qualityStatus: "negative_delta" },
      { start: "2026-05-01T00:15:00.000Z", qualityStatus: "ok" },
      { start: "2026-05-01T00:30:00.000Z", qualityStatus: "ok" },
      { start: "2026-05-01T00:45:00.000Z", qualityStatus: "rejected" },
    ]);
    try {
      await expect(readEnergyAnalysisEligibleCoverage(fixture.input)).resolves.toEqual({
        from: "2026-05-01T00:15:00.000Z",
        to: "2026-05-01T00:45:00.000Z",
        intervalCount: 2,
      });
    } finally {
      fixture.close();
    }
  });

  it("reads each meter's real and estimated intervals inside a period, and nothing outside it", async () => {
    const fixture = await createCoverageFixture([
      { start: "2026-05-01T00:00:00.000Z", qualityStatus: "ok" },
      { start: "2026-05-01T00:15:00.000Z", qualityStatus: "gap" },
      { start: "2026-05-01T00:30:00.000Z", qualityStatus: "ok" },
      { start: "2026-05-01T01:00:00.000Z", qualityStatus: "ok" },
    ]);
    try {
      const rows = await readEnergyMeterIntervalCoverage({
        ...fixture.input,
        meterPointIds: ["meter-a"],
        fromMs: Date.parse("2026-05-01T00:10:00.000Z"),
        toMs: Date.parse("2026-05-01T00:45:00.000Z"),
      });
      expect(rows.map((row) => [new Date(row.startMs).toISOString(), row.qualityStatus])).toEqual([
        ["2026-05-01T00:00:00.000Z", "ok"],
        ["2026-05-01T00:15:00.000Z", "gap"],
        ["2026-05-01T00:30:00.000Z", "ok"],
      ]);
      await expect(readEnergyMeterIntervalCoverage({ ...fixture.input, meterPointIds: [], fromMs: 0, toMs: 1 })).resolves.toEqual([]);
    } finally {
      fixture.close();
    }
  });

  it("derives analysis-eligible coverage only from valid facts when quality events coexist", async () => {
    const fixture = await createCoverageFixture(
      [
        { start: "2026-05-01T00:15:00.000Z", qualityStatus: "ok" },
        { start: "2026-05-01T00:30:00.000Z", qualityStatus: "ok" },
      ],
      [{
        workspaceId: "workspace-1",
        projectId: "project-1",
        importBatchId: "batch-a",
        meterPointId: "meter-a",
        sourceLabel: "Meter A",
        eventTime: "2026-05-02T00:00:00.000Z",
        code: "boundary",
        severity: "warning",
        details: {},
        sourceReadingKind: "interval_usage",
      }],
    );
    try {
      await expect(readEnergyAnalysisEligibleCoverage(fixture.input)).resolves.toEqual({
        from: "2026-05-01T00:15:00.000Z",
        to: "2026-05-01T00:45:00.000Z",
        intervalCount: 2,
      });
    } finally {
      fixture.close();
    }
  });

  it("returns a DuckDB timeout promptly and releases its connection after background settlement", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-duckdb-timeout-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.workspaces.upsert({ id: "workspace-timeout", owner_user_id: "dev-user", name: "Timeout", kind: "customer" });
      metadata.dataSources.create({
        user_id: "dev-user",
        id: "duckdb-timeout",
        name: "DuckDB timeout",
        type: "duckdb",
        config: { path: join(root, "timeout.duckdb") },
      });
      const gateway = new LocalDataGateway(metadata);
      const timeoutStartedAt = performance.now();
      await expect(gateway.runSqlReadonly({
        user_id: "dev-user",
        workspace_id: "workspace-timeout",
        datasource_id: "duckdb-timeout",
        sql: "SELECT SUM(i) AS total FROM range(100000000) values(i)",
        timeout_ms: 20,
      })).rejects.toThrow("SQL_TIMEOUT");
      // The timeout must return before the background DuckDB query settles, while
      // allowing bounded event-loop scheduling jitter on shared CI runners.
      expect(performance.now() - timeoutStartedAt).toBeLessThan(500);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
      await expect(gateway.runSqlReadonly({
        user_id: "dev-user",
        workspace_id: "workspace-timeout",
        datasource_id: "duckdb-timeout",
        sql: "SELECT 1 AS released",
        timeout_ms: 1_000,
      })).resolves.toMatchObject({ rows: [[1]] });
    } finally {
      metadata.close();
      try {
        rmSync(root, { recursive: true, force: true });
      } catch (error) {
        if (!(process.platform === "win32" && error instanceof Error && "code" in error
          && (error.code === "EPERM" || error.code === "EBUSY"))) throw error;
      }
    }
  });

  it("fails closed with the stable facts-unavailable code when the fact store is missing", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-scoped-missing-store-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      await expect(ensureEnergyScopedDataSource({
        metadataStore: metadata,
        userId: "dev-user",
        databasePath: join(root, "missing.duckdb"),
        context: {
          workspaceId: "workspace-1",
          projectId: "project-1",
          scopeId: "scope-a",
          meterAttachments: [],
          resource: "electricity",
          from: "2026-05-01T00:00:00.000Z",
          to: "2026-05-02T00:00:00.000Z",
          timezone: "Asia/Singapore",
          hierarchyRevisionId: "hierarchy-v1",
          meterMappingRevisionId: "mapping-v1",
          meterFormulaRevisionId: "formula-v1",
          dataSnapshotId: "snapshot-a",
          metricVersion: "metrics-v1",
        },
      })).rejects.toThrow("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("selects a complete day from the latest 14-day probe without aggregating long-history candidates", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-current-overview-recent-probe-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.workspaces.upsert({ id: "workspace-1", owner_user_id: "dev-user", name: "Workspace", kind: "customer" });
      metadata.energyIq.upsertProject({ id: "project-1", workspace_id: "workspace-1", name: "Project", status: "draft" });
      createBatch(metadata, "batch-a", "sha-a");
      const materializations = [{ batch_id: "batch-a", summary: summary("sha-a") }];
      const prepared = metadata.energyIq.prepareProjectManifestMaterialization({
        project_id: "project-1",
        materializations,
        source_manifest_sha256: ["sha-a"],
      });
      const oldIncompleteFacts = Array.from({ length: 730 }, (_, dayIndex) =>
        periodFact(new Date(Date.parse("2024-06-01T00:00:00.000Z") + dayIndex * 86_400_000).toISOString()));
      const latestCompleteFacts = Array.from({ length: 96 }, (_, intervalIndex) =>
        periodFact(new Date(Date.parse("2026-06-30T00:00:00.000Z") + intervalIndex * 900_000).toISOString()));
      const persisted = await writeEnergyFactProjectMaterialization({
        databasePath,
        projectId: "project-1",
        timezone: "UTC",
        expectedPreviousDataSnapshotId: prepared.expected_previous_snapshot_id,
        snapshotFactScope: prepared.fact_scope,
        batches: [projectBatch({
          importBatchId: "batch-a",
          sourceSha256: "sha-a",
          rawReadings: [],
          normalizedReadings: [],
          intervalFacts: [...oldIncompleteFacts, ...latestCompleteFacts],
          qualityEvents: [],
        })],
      });
      metadata.energyIq.completeProjectManifestMaterialization({
        project_id: "project-1",
        materializations,
        project_audit: persisted.projectAudit,
        source_manifest_sha256: ["sha-a"],
        expected_snapshot_id: prepared.expected_snapshot_id,
        expected_previous_snapshot_id: prepared.expected_previous_snapshot_id,
      });
      const changesBefore = metadata.db.prepare("SELECT total_changes() AS value").get() as { value: number };

      await expect(readEnergyCurrentOverviewPeriod({
        metadataStore: metadata,
        databasePath,
        workspaceId: "workspace-1",
        projectId: "project-1",
        dataSnapshotId: prepared.expected_snapshot_id,
        resource: "electricity",
        meterPointIds: ["meter-a"],
        timezone: "UTC",
        periodBasis: "rolling_7_days",
      })).resolves.toMatchObject({
        localFrom: "2026-06-24",
        localToExclusive: "2026-07-01",
        periodDays: 7,
      });
      expect(metadata.db.prepare("SELECT total_changes() AS value").get()).toEqual(changesBefore);
    } finally {
      metadata.close();
      try {
        rmSync(root, { recursive: true, force: true });
      } catch (error) {
        if (!(process.platform === "win32" && error instanceof Error && "code" in error
          && (error.code === "EPERM" || error.code === "EBUSY"))) throw error;
      }
    }
  });

  it("falls back to full Snapshot coverage only when the latest 14-day probe has no complete day", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-current-overview-probe-fallback-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.workspaces.upsert({ id: "workspace-1", owner_user_id: "dev-user", name: "Workspace", kind: "customer" });
      metadata.energyIq.upsertProject({ id: "project-1", workspace_id: "workspace-1", name: "Project", status: "draft" });
      createBatch(metadata, "batch-a", "sha-a");
      const materializations = [{ batch_id: "batch-a", summary: summary("sha-a") }];
      const prepared = metadata.energyIq.prepareProjectManifestMaterialization({
        project_id: "project-1",
        materializations,
        source_manifest_sha256: ["sha-a"],
      });
      const oldCompleteFacts = Array.from({ length: 96 }, (_, intervalIndex) =>
        periodFact(new Date(Date.parse("2026-05-31T00:00:00.000Z") + intervalIndex * 900_000).toISOString()));
      const recentIncompleteFacts = Array.from({ length: 14 }, (_, dayIndex) =>
        periodFact(new Date(Date.parse("2026-06-17T00:00:00.000Z") + dayIndex * 86_400_000).toISOString()));
      const persisted = await writeEnergyFactProjectMaterialization({
        databasePath,
        projectId: "project-1",
        timezone: "UTC",
        expectedPreviousDataSnapshotId: prepared.expected_previous_snapshot_id,
        snapshotFactScope: prepared.fact_scope,
        batches: [projectBatch({
          importBatchId: "batch-a",
          sourceSha256: "sha-a",
          rawReadings: [],
          normalizedReadings: [],
          intervalFacts: [...oldCompleteFacts, ...recentIncompleteFacts],
          qualityEvents: [],
        })],
      });
      metadata.energyIq.completeProjectManifestMaterialization({
        project_id: "project-1",
        materializations,
        project_audit: persisted.projectAudit,
        source_manifest_sha256: ["sha-a"],
        expected_snapshot_id: prepared.expected_snapshot_id,
        expected_previous_snapshot_id: prepared.expected_previous_snapshot_id,
      });
      const changesBefore = metadata.db.prepare("SELECT total_changes() AS value").get() as { value: number };

      await expect(readEnergyCurrentOverviewPeriod({
        metadataStore: metadata,
        databasePath,
        workspaceId: "workspace-1",
        projectId: "project-1",
        dataSnapshotId: prepared.expected_snapshot_id,
        resource: "electricity",
        meterPointIds: ["meter-a"],
        timezone: "UTC",
        periodBasis: "rolling_7_days",
      })).resolves.toMatchObject({
        localFrom: "2026-05-25",
        localToExclusive: "2026-06-01",
        periodDays: 7,
      });
      expect(metadata.db.prepare("SELECT total_changes() AS value").get()).toEqual(changesBefore);
    } finally {
      metadata.close();
      try {
        rmSync(root, { recursive: true, force: true });
      } catch (error) {
        if (!(process.platform === "win32" && error instanceof Error && "code" in error
          && (error.code === "EPERM" || error.code === "EBUSY"))) throw error;
      }
    }
  });

  it("aggregates peak demand by interval start across official meters with different interval ends", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-overview-headline-peak-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.workspaces.upsert({ id: "workspace-1", owner_user_id: "dev-user", name: "Workspace", kind: "customer" });
      metadata.energyIq.upsertProject({ id: "project-1", workspace_id: "workspace-1", name: "Project", status: "draft" });
      createBatch(metadata, "batch-a", "sha-a");
      const materializations = [{ batch_id: "batch-a", summary: summary("sha-a") }];
      const prepared = metadata.energyIq.prepareProjectManifestMaterialization({
        project_id: "project-1",
        materializations,
        source_manifest_sha256: ["sha-a"],
      });
      const first = factWrite("batch-a", "sha-a", "2026-05-01T00:00:00.000Z").intervalFacts[0]!;
      const second = {
        ...first,
        meterPointId: "meter-b",
        sourceLabel: "Meter B",
        intervalEnd: "2026-05-01T00:30:00.000Z",
        elapsedMinutes: 30,
        averageKw: 1.9999999996,
      };
      const third = {
        ...first,
        intervalStart: "2026-05-01T00:15:00.000Z",
        intervalEnd: "2026-05-01T00:30:00.000Z",
      };
      const fourth = {
        ...second,
        intervalStart: "2026-05-01T00:15:00.000Z",
        averageKw: 2,
      };
      const persisted = await writeEnergyFactProjectMaterialization({
        databasePath,
        projectId: "project-1",
        timezone: "UTC",
        expectedPreviousDataSnapshotId: prepared.expected_previous_snapshot_id,
        snapshotFactScope: prepared.fact_scope,
        batches: [projectBatch({
          importBatchId: "batch-a",
          sourceSha256: "sha-a",
          rawReadings: [],
          normalizedReadings: [],
          intervalFacts: [first, second, third, fourth],
          qualityEvents: [],
        })],
      });
      metadata.energyIq.completeProjectManifestMaterialization({
        project_id: "project-1",
        materializations,
        project_audit: persisted.projectAudit,
        source_manifest_sha256: ["sha-a"],
        expected_snapshot_id: prepared.expected_snapshot_id,
        expected_previous_snapshot_id: prepared.expected_previous_snapshot_id,
      });

      await expect(readEnergyOverviewHeadline({
        metadataStore: metadata,
        databasePath,
        workspaceId: "workspace-1",
        projectId: "project-1",
        dataSnapshotId: prepared.expected_snapshot_id,
        resource: "electricity",
        meterPointIds: ["meter-a", "meter-b"],
        from: "2026-05-01T00:00:00.000Z",
        to: "2026-05-01T00:30:00.000Z",
      })).resolves.toMatchObject({
        usageKwh: 4,
        peakKw: 6,
        peakAt: "2026-05-01T00:00:00.000Z",
      });
    } finally {
      metadata.close();
      try {
        rmSync(root, { recursive: true, force: true });
      } catch (error) {
        if (!(process.platform === "win32" && error instanceof Error && "code" in error
          && (error.code === "EPERM" || error.code === "EBUSY"))) throw error;
      }
    }
  });

  it("reads a historical fact store with the writer revision pinned by its Snapshot", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-scoped-historical-writer-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.workspaces.upsert({ id: "workspace-1", owner_user_id: "dev-user", name: "Workspace", kind: "customer" });
      metadata.energyIq.upsertProject({ id: "project-1", workspace_id: "workspace-1", name: "Project", status: "draft" });
      createBatch(metadata, "batch-a", "sha-a");
      const materializations = [{
        batch_id: "batch-a",
        summary: {
          ...summary("sha-a"),
          factWriterContractVersion: "energy-fact-writer-snapshot-manifest-v3",
        },
      }];
      const prepared = metadata.energyIq.prepareProjectManifestMaterialization({
        project_id: "project-1",
        materializations,
        source_manifest_sha256: ["sha-a"],
      });
      const persisted = await writeEnergyFactProjectMaterialization({
        databasePath,
        projectId: "project-1",
        timezone: "Asia/Singapore",
        expectedPreviousDataSnapshotId: prepared.expected_previous_snapshot_id,
        snapshotFactScope: prepared.fact_scope,
        batches: [projectBatch(factWrite("batch-a", "sha-a", "2026-05-01T00:00:00.000Z"))],
      });
      await runDuckDbSql(databasePath, `
        UPDATE energy_project_fact_state
        SET fact_writer_contract_version = 'energy-fact-writer-snapshot-manifest-v3'
        WHERE project_id = 'project-1'
      `);
      metadata.energyIq.completeProjectManifestMaterialization({
        project_id: "project-1",
        materializations,
        project_audit: persisted.projectAudit,
        source_manifest_sha256: ["sha-a"],
        expected_snapshot_id: prepared.expected_snapshot_id,
        expected_previous_snapshot_id: prepared.expected_previous_snapshot_id,
      });

      const scoped = await ensureEnergyScopedDataSource({
        metadataStore: metadata,
        userId: "dev-user",
        databasePath,
        context: {
          workspaceId: "workspace-1",
          projectId: "project-1",
          scopeId: "scope-a",
          meterAttachments: [{ meterPointId: "meter-a", scopeId: "scope-a", officialAggregation: true }],
          resource: "electricity",
          from: "2026-05-01T00:00:00.000Z",
          to: "2026-05-02T00:00:00.000Z",
          timezone: "Asia/Singapore",
          hierarchyRevisionId: "hierarchy-v1",
          meterMappingRevisionId: "mapping-v1",
          meterFormulaRevisionId: "formula-v1",
          dataSnapshotId: prepared.expected_snapshot_id,
          metricVersion: "metrics-v1",
        },
      });
      const gateway = new LocalDataGateway(metadata);
      await expect(gateway.runSqlReadonly({
        user_id: "dev-user",
        workspace_id: "workspace-1",
        datasource_id: scoped.datasourceId,
        sql: `SELECT COUNT(*) AS fact_count FROM ${scoped.viewName}`,
      })).resolves.toMatchObject({ rows: [[1]] });
    } finally {
      metadata.close();
      try {
        rmSync(root, { recursive: true, force: true });
      } catch (error) {
        if (!(process.platform === "win32" && error instanceof Error && "code" in error
          && (error.code === "EPERM" || error.code === "EBUSY"))) throw error;
      }
    }
  });

  it("rejects every query from an old datasource and detaches timed-out session cleanup", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-scoped-snapshot-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.workspaces.upsert({ id: "workspace-1", owner_user_id: "dev-user", name: "Workspace", kind: "customer" });
      metadata.energyIq.upsertProject({ id: "project-1", workspace_id: "workspace-1", name: "Project", status: "draft" });
      createBatch(metadata, "batch-a", "sha-a");
      createBatch(metadata, "batch-b", "sha-b");
      const materializationsA = [{ batch_id: "batch-a", summary: summary("sha-a") }];
      const preparedA = metadata.energyIq.prepareProjectManifestMaterialization({
        project_id: "project-1",
        materializations: materializationsA,
        source_manifest_sha256: ["sha-a"],
      });
      const writeA = projectBatch(factWrite(
        "batch-a",
        "sha-a",
        "2026-05-01T00:00:00.000Z",
      ));
      const persistedA = await writeEnergyFactProjectMaterialization({
        databasePath,
        projectId: "project-1",
        timezone: "Asia/Singapore",
        expectedPreviousDataSnapshotId: preparedA.expected_previous_snapshot_id,
        snapshotFactScope: preparedA.fact_scope,
        batches: [writeA],
      });
      metadata.energyIq.completeProjectManifestMaterialization({
        project_id: "project-1",
        materializations: materializationsA,
        project_audit: persistedA.projectAudit,
        source_manifest_sha256: ["sha-a"],
        expected_snapshot_id: preparedA.expected_snapshot_id,
        expected_previous_snapshot_id: preparedA.expected_previous_snapshot_id,
      });

      const scopedA = await ensureEnergyScopedDataSource({
        metadataStore: metadata,
        userId: "dev-user",
        databasePath,
        context: {
          workspaceId: "workspace-1",
          projectId: "project-1",
          scopeId: "scope-a",
          meterAttachments: [{ meterPointId: "meter-a", scopeId: "scope-a", officialAggregation: true }],
          scopeDimensions: [{
            scopeId: "scope-a",
            parentScopeId: "project-1-project",
            scopeName: "Centre A",
            scopeType: "centre",
            tierDefinitionId: "centre-tier",
            centreCode: "A",
            facilityType: "Active Aging Center",
            areaSqm: 100,
            occupantCount: 20,
            metadataStatus: "provisional",
            hierarchyRevisionId: "hierarchy-v1",
          }],
          resource: "electricity",
          from: "2026-05-01T00:00:00.000Z",
          to: "2026-05-02T00:00:00.000Z",
          timezone: "Asia/Singapore",
          hierarchyRevisionId: "hierarchy-v1",
          meterMappingRevisionId: "mapping-v1",
          meterFormulaRevisionId: "formula-v1",
          dataSnapshotId: preparedA.expected_snapshot_id,
          metricVersion: "metrics-v1",
        },
      });
      await expect(readEnergyScopedActionIntervals(scopedA)).resolves.toEqual([expect.objectContaining({meterId:"meter-a",startMs:Date.parse("2026-05-01T00:00:00Z"),endMs:Date.parse("2026-05-01T00:15:00Z"),quality:"ok"})]);
      const exportPath = join(root, "report-input.csv");
      await expect(exportEnergyScopedCsv(scopedA, exportPath)).resolves.toMatchObject({
        rows: 1, firstIntervalStart: "2026-05-01T00:00:00.000Z", actualLastIntervalEnd: "2026-05-01T00:15:00.000Z",
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/), meters: [{ meterPointId: "meter-a", rows: 1, validRows: 1, observedMinutes: 15, validMinutes: 15, firstStart: "2026-05-01T00:00:00.000Z", lastEnd: "2026-05-01T00:15:00.000Z" }],
      });
      const originalCsv = readFileSync(exportPath, "utf8");
      expect(originalCsv).toContain("official_aggregation_eligible");
      expect(originalCsv).toContain("meter-a");
      await expect(exportEnergyScopedCsv(scopedA, exportPath)).rejects.toThrow("ENERGYIQ_EXPORT_TARGET_EXISTS");
      expect(readFileSync(exportPath, "utf8")).toBe(originalCsv);
      const namedPath = join(root, "named-report.csv");
      await exportEnergyScopedCsv(scopedA, namedPath, {"meter-a": 'Display, "East"'});
      const namedCsv = readFileSync(namedPath,"utf8");
      expect(namedCsv).toContain("source_device_name");
      expect(namedCsv).toContain('"Display, ""East"""');
      const unknownPath=join(root,"unnamed-report.csv");
      await exportEnergyScopedCsv(scopedA,unknownPath,{});
      expect(readFileSync(unknownPath,"utf8")).toContain("Device name needs confirmation");
      const scopedEmptyA = await ensureEnergyScopedDataSource({
        metadataStore: metadata,
        userId: "dev-user",
        databasePath,
        context: {
          workspaceId: "workspace-1",
          projectId: "project-1",
          scopeId: "scope-with-no-meters",
          meterAttachments: [],
          resource: "electricity",
          from: "2026-05-01T00:00:00.000Z",
          to: "2026-05-02T00:00:00.000Z",
          timezone: "Asia/Singapore",
          hierarchyRevisionId: "hierarchy-v1",
          meterMappingRevisionId: "mapping-v1",
          meterFormulaRevisionId: "formula-v1",
          dataSnapshotId: preparedA.expected_snapshot_id,
          metricVersion: "metrics-v1",
        },
      });
      const gateway = new LocalDataGateway(metadata);

      const [scopedView] = await queryDuckDbSql(databasePath, `
        SELECT sql
        FROM duckdb_views()
        WHERE view_name = '${scopedA.viewName}'
      `);
      expect(String(scopedView?.sql ?? "")).not.toContain("energy_project_fact_state");
      expect(String(scopedView?.sql ?? "")).not.toContain("canonical_interval_digest");
      expect(String(scopedView?.sql ?? "")).toContain("interval_end <=");
      const scopedRecord = metadata.dataSources.get({
        user_id: "dev-user",
        datasource_id: scopedA.datasourceId,
      });
      const scopedConfig = JSON.parse(scopedRecord.config_json) as Record<string, unknown>;
      const scopedEnergyQueryScope = scopedConfig.energyQueryScope as Record<string, unknown>;
      expect(scopedA.metadataViewName).toBeTruthy();
      expect((scopedConfig.introspection as { tableAllowlist: string[] }).tableAllowlist)
        .toEqual([scopedA.viewName, scopedA.metadataViewName]);
      await expect(gateway.runSqlReadonly({
        user_id: "dev-user",
        workspace_id: "workspace-1",
        datasource_id: scopedA.datasourceId,
        sql: `SELECT COUNT(*) AS centre_count FROM ${scopedA.metadataViewName}
          WHERE facility_type = 'Active Aging Center'`,
      })).resolves.toMatchObject({ rows: [[1]] });
      metadata.dataSources.create({
        user_id: "dev-user",
        id: "energy-scope-different-snapshot",
        name: "Different snapshot scope",
        type: "duckdb",
        config: {
          ...scopedConfig,
          energyQueryScope: {
            ...scopedEnergyQueryScope,
            dataSnapshotId: "snapshot-other",
          },
        },
      });
      let queuedSqlExecutionCount = 0;
      const timeoutDatabase = await getDuckDbDatabase(databasePath);
      timeoutDatabase.register_udf("t08a_queued_sql_probe", "INTEGER", () => {
        queuedSqlExecutionCount += 1;
        return 1;
      });
      metadata.dataSources.create({
        user_id: "dev-user",
        id: "energy-scope-timeout",
        name: "Timeout snapshot scope",
        type: "duckdb",
        config: {
          ...scopedConfig,
          introspection: { tableAllowlist: [] },
        },
      });
      await expect(gateway.withEnergySnapshotReadSession({
        user_id: "dev-user",
        workspace_id: "workspace-1",
        datasource_id: scopedA.datasourceId,
      }, async () => {
        const results = await Promise.all([
          gateway.runSqlReadonly({
            user_id: "dev-user",
            workspace_id: "workspace-1",
            datasource_id: scopedA.datasourceId,
            sql: `SELECT COUNT(*) AS interval_count FROM ${scopedA.viewName}`,
          }),
          gateway.withEnergySnapshotReadSession({
            user_id: "dev-user",
            workspace_id: "workspace-1",
            datasource_id: scopedEmptyA.datasourceId,
          }, async () => await gateway.runSqlReadonly({
            user_id: "dev-user",
            workspace_id: "workspace-1",
            datasource_id: scopedEmptyA.datasourceId,
            sql: `SELECT COUNT(*) AS interval_count FROM ${scopedEmptyA.viewName}`,
          })),
        ]);
        await expect(gateway.withEnergySnapshotReadSession({
          user_id: "dev-user",
          workspace_id: "workspace-1",
          datasource_id: "energy-scope-different-snapshot",
        }, async () => undefined)).rejects.toThrow("ENERGYIQ_SNAPSHOT_STALE:snapshot-other");
        return results;
      })).resolves.toMatchObject([
        { rows: [[1]] },
        { rows: [[0]] },
      ]);

      let timeoutCallbackCompletedAt = 0;
      await expect(gateway.withEnergySnapshotReadSession({
        user_id: "dev-user",
        workspace_id: "workspace-1",
        datasource_id: "energy-scope-timeout",
      }, async () => {
        const timeoutQueryStartedAt = performance.now();
        const executing = gateway.runSqlReadonly({
          user_id: "dev-user",
          workspace_id: "workspace-1",
          datasource_id: "energy-scope-timeout",
          sql: "SELECT SUM(sin(i)) AS total FROM range(20000000) values(i)",
          timeout_ms: 100,
        });
        let executingReturnedAt = 0;
        void executing.then(
          () => { executingReturnedAt = performance.now(); },
          () => { executingReturnedAt = performance.now(); },
        );
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
        const queued = gateway.runSqlReadonly({
          user_id: "dev-user",
          workspace_id: "workspace-1",
          datasource_id: "energy-scope-timeout",
          sql: "SELECT t08a_queued_sql_probe() AS forbidden_execution",
          timeout_ms: 20,
        });
        const cancellation = new AbortController();
        const cancelledWhileQueued = gateway.runSqlReadonly({
          user_id: "dev-user",
          workspace_id: "workspace-1",
          datasource_id: "energy-scope-timeout",
          sql: "SELECT t08a_queued_sql_probe() AS forbidden_cancelled_execution",
          signal: cancellation.signal,
        });
        cancellation.abort(new Error("RUN_CANCELLED"));
        const [executingResult, queuedResult, cancelledResult] = await Promise.allSettled([
          executing,
          queued,
          cancelledWhileQueued,
        ]);
        expect(executingResult).toMatchObject({ status: "rejected", reason: { message: "SQL_TIMEOUT" } });
        expect(queuedResult).toMatchObject({ status: "rejected", reason: { message: "SQL_TIMEOUT" } });
        expect(cancelledResult).toMatchObject({ status: "rejected", reason: { message: "RUN_CANCELLED" } });
        expect(executingReturnedAt - timeoutQueryStartedAt).toBeLessThan(150);
        timeoutCallbackCompletedAt = performance.now();
      })).resolves.toBeUndefined();
      expect(performance.now() - timeoutCallbackCompletedAt).toBeLessThan(50);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
      expect(queuedSqlExecutionCount).toBe(0);
      await expect(gateway.withEnergySnapshotReadSession({
        user_id: "dev-user",
        workspace_id: "workspace-1",
        datasource_id: scopedA.datasourceId,
      }, async () => await gateway.runSqlReadonly({
        user_id: "dev-user",
        workspace_id: "workspace-1",
        datasource_id: scopedA.datasourceId,
        sql: `SELECT COUNT(*) AS interval_count FROM ${scopedA.viewName}`,
      }))).resolves.toMatchObject({ rows: [[1]] });

      await runDuckDbSql(databasePath, `
        DELETE FROM energy_interval_facts
        WHERE project_id = 'project-1'
          AND interval_start = TIMESTAMPTZ '2026-05-01T00:00:00.000Z'
      `);
      await expect(gateway.runSqlReadonly({
        user_id: "dev-user",
        datasource_id: scopedA.datasourceId,
        sql: `SELECT COUNT(*) AS interval_count FROM ${scopedA.viewName}`,
      })).rejects.toThrow("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
      await expect(readEnergyFactCoverage({
        metadataStore: metadata,
        databasePath,
        workspaceId: "workspace-1",
        projectId: "project-1",
        dataSnapshotId: preparedA.expected_snapshot_id,
        resource: "electricity",
      })).rejects.toThrow("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");

      await writeEnergyFactProjectMaterialization({
        databasePath,
        projectId: "project-1",
        timezone: "Asia/Singapore",
        expectedPreviousDataSnapshotId: preparedA.expected_snapshot_id,
        snapshotFactScope: preparedA.fact_scope,
        batches: [writeA],
      });
      await runDuckDbSql(databasePath, `
        UPDATE energy_interval_facts
        SET usage_kwh = usage_kwh + 1
        WHERE project_id = 'project-1'
      `);
      await expect(gateway.runSqlReadonly({
        user_id: "dev-user",
        datasource_id: scopedA.datasourceId,
        sql: `SELECT SUM(usage_kwh) AS usage_kwh FROM ${scopedA.viewName}`,
      })).rejects.toThrow("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
      await expect(readEnergyFactCoverage({
        metadataStore: metadata,
        databasePath,
        workspaceId: "workspace-1",
        projectId: "project-1",
        dataSnapshotId: preparedA.expected_snapshot_id,
        resource: "electricity",
      })).rejects.toThrow("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");

      await writeEnergyFactProjectMaterialization({
        databasePath,
        projectId: "project-1",
        timezone: "Asia/Singapore",
        expectedPreviousDataSnapshotId: preparedA.expected_snapshot_id,
        snapshotFactScope: preparedA.fact_scope,
        batches: [writeA],
      });

      const materializationsB = [
        { batch_id: "batch-a", summary: summary("sha-a") },
        { batch_id: "batch-b", summary: summary("sha-b") },
      ];
      const preparedB = metadata.energyIq.prepareProjectManifestMaterialization({
        project_id: "project-1",
        materializations: materializationsB,
        source_manifest_sha256: ["sha-a", "sha-b"],
      });
      await writeEnergyFactProjectMaterialization({
        databasePath,
        projectId: "project-1",
        timezone: "Asia/Singapore",
        expectedPreviousDataSnapshotId: preparedB.expected_previous_snapshot_id,
        snapshotFactScope: preparedB.fact_scope,
        batches: [
          projectBatch(factWrite("batch-a", "sha-a", "2026-05-01T00:00:00.000Z")),
          projectBatch(factWrite("batch-b", "sha-b", "2026-05-01T00:15:00.000Z")),
        ],
      });

      await expect(gateway.runSqlReadonly({
        user_id: "dev-user",
        datasource_id: scopedA.datasourceId,
        sql: `SELECT COUNT(*) AS interval_count FROM ${scopedA.viewName}`,
      })).rejects.toThrow("ENERGYIQ_SNAPSHOT_STALE");
      await expect(gateway.withEnergySnapshotReadSession({
        user_id: "dev-user",
        workspace_id: "workspace-1",
        datasource_id: scopedA.datasourceId,
      }, async () => await gateway.runSqlReadonly({
        user_id: "dev-user",
        workspace_id: "workspace-1",
        datasource_id: scopedA.datasourceId,
        sql: `SELECT COUNT(*) AS interval_count FROM ${scopedA.viewName}`,
      }))).rejects.toThrow("ENERGYIQ_SNAPSHOT_STALE");
      await expect(readEnergyScopedActionIntervals(scopedA)).rejects.toThrow("ENERGYIQ_SNAPSHOT_STALE");
      await expect(exportEnergyScopedCsv(scopedA, join(root, "stale.csv"))).rejects.toThrow("ENERGYIQ_SNAPSHOT_STALE");
      await expect(exportEnergyScopedCsv(scopedEmptyA, join(root, "stale-empty.csv"))).rejects.toThrow("ENERGYIQ_SNAPSHOT_STALE");
      expect(existsSync(join(root, "stale.csv"))).toBe(false);
      expect(existsSync(join(root, "stale-empty.csv"))).toBe(false);
      for (const aggregate of ["COUNT(*)", "SUM(usage_kwh)"]) {
        await expect(gateway.runSqlReadonly({
          user_id: "dev-user",
          datasource_id: scopedEmptyA.datasourceId,
          sql: `SELECT ${aggregate} AS aggregate_value FROM ${scopedEmptyA.viewName}`,
        })).rejects.toThrow("ENERGYIQ_SNAPSHOT_STALE");
      }
      await runDuckDbSql(databasePath, `
        DELETE FROM energy_project_fact_state
        WHERE project_id = 'project-1'
      `);
      await expect(gateway.withEnergySnapshotReadSession({
        user_id: "dev-user",
        workspace_id: "workspace-1",
        datasource_id: scopedA.datasourceId,
      }, async () => undefined)).rejects.toThrow("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
    } finally {
      metadata.close();
      try {
        rmSync(root, { recursive: true, force: true });
      } catch (error) {
        if (!(process.platform === "win32" && error instanceof Error && "code" in error
          && (error.code === "EPERM" || error.code === "EBUSY"))) throw error;
      }
    }
  });
});

describe("Energy reporting coverage", () => {
  it("reports the last interval each Meter sent and the days that fell short", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-reporting-coverage-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.workspaces.upsert({ id: "workspace-1", owner_user_id: "dev-user", name: "Workspace", kind: "customer" });
      metadata.energyIq.upsertProject({ id: "project-1", workspace_id: "workspace-1", name: "Project", status: "draft" });
      createBatch(metadata, "batch-a", "sha-a");
      const materializations = [{ batch_id: "batch-a", summary: summary("sha-a") }];
      const prepared = metadata.energyIq.prepareProjectManifestMaterialization({
        project_id: "project-1",
        materializations,
        source_manifest_sha256: ["sha-a"],
      });

      // Two Meters over three days. On the last day the second one stops at midday,
      // which is the shape that froze the Tuya Office chart a day behind the facts.
      const meterFact = (meterPointId: string, intervalStart: string) => ({
        ...periodFact(intervalStart),
        meterPointId,
        sourceLabel: meterPointId,
      });
      const intervalsFor = (meterPointId: string, date: string, count: number) =>
        Array.from({ length: count }, (_, index) =>
          meterFact(meterPointId, new Date(Date.parse(`${date}T00:00:00.000Z`) + index * 900_000).toISOString()));
      const intervalFacts = [
        ...intervalsFor("meter-a", "2026-05-01", 96),
        ...intervalsFor("meter-b", "2026-05-01", 96),
        ...intervalsFor("meter-a", "2026-05-02", 96),
        ...intervalsFor("meter-b", "2026-05-02", 96),
        ...intervalsFor("meter-a", "2026-05-03", 96),
        ...intervalsFor("meter-b", "2026-05-03", 48),
      ];
      const persisted = await writeEnergyFactProjectMaterialization({
        databasePath,
        projectId: "project-1",
        timezone: "UTC",
        expectedPreviousDataSnapshotId: prepared.expected_previous_snapshot_id,
        snapshotFactScope: prepared.fact_scope,
        batches: [projectBatch({
          importBatchId: "batch-a",
          sourceSha256: "sha-a",
          rawReadings: [],
          normalizedReadings: [],
          intervalFacts,
          qualityEvents: [],
        })],
      });
      metadata.energyIq.completeProjectManifestMaterialization({
        project_id: "project-1",
        materializations,
        project_audit: persisted.projectAudit,
        source_manifest_sha256: ["sha-a"],
        expected_snapshot_id: prepared.expected_snapshot_id,
        expected_previous_snapshot_id: prepared.expected_previous_snapshot_id,
      });

      const coverage = await readEnergyReportingCoverage({
        metadataStore: metadata,
        databasePath,
        workspaceId: "workspace-1",
        projectId: "project-1",
        dataSnapshotId: prepared.expected_snapshot_id,
        resource: "electricity",
        timezone: "UTC",
        dayCount: 28,
      });

      expect(coverage).not.toBeNull();
      // The Meter still reporting sets the Project's latest reading.
      expect(coverage!.latestReadingAt).toBe("2026-05-04T00:00:00.000Z");
      expect(coverage!.meters).toEqual([
        { meterNodeId: "meter-a", lastReadingAt: "2026-05-04T00:00:00.000Z" },
        { meterNodeId: "meter-b", lastReadingAt: "2026-05-03T12:00:00.000Z" },
      ]);
      // Oldest first, so a caller can read the run of days straight through.
      expect(coverage!.days.map((day) => day.localDate))
        .toEqual(["2026-05-01", "2026-05-02", "2026-05-03"]);
      expect(coverage!.days.map((day) => day.observedIntervalCount)).toEqual([192, 192, 144]);
      expect(coverage!.days.at(-1)!.usageKwh).toBe(144);
    } finally {
      metadata.close();
      try {
        rmSync(root, { recursive: true, force: true });
      } catch (error) {
        if (!(process.platform === "win32" && error instanceof Error && "code" in error
          && (error.code === "EPERM" || error.code === "EBUSY"))) throw error;
      }
    }
  });

  it("returns null for a Project that has never reported", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-reporting-coverage-empty-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.workspaces.upsert({ id: "workspace-1", owner_user_id: "dev-user", name: "Workspace", kind: "customer" });
      metadata.energyIq.upsertProject({ id: "project-1", workspace_id: "workspace-1", name: "Project", status: "draft" });
      createBatch(metadata, "batch-a", "sha-a");
      const materializations = [{ batch_id: "batch-a", summary: summary("sha-a") }];
      const prepared = metadata.energyIq.prepareProjectManifestMaterialization({
        project_id: "project-1",
        materializations,
        source_manifest_sha256: ["sha-a"],
      });
      const persisted = await writeEnergyFactProjectMaterialization({
        databasePath,
        projectId: "project-1",
        timezone: "UTC",
        expectedPreviousDataSnapshotId: prepared.expected_previous_snapshot_id,
        snapshotFactScope: prepared.fact_scope,
        batches: [projectBatch({
          importBatchId: "batch-a",
          sourceSha256: "sha-a",
          rawReadings: [],
          normalizedReadings: [],
          intervalFacts: [],
          qualityEvents: [],
        })],
      });
      metadata.energyIq.completeProjectManifestMaterialization({
        project_id: "project-1",
        materializations,
        project_audit: persisted.projectAudit,
        source_manifest_sha256: ["sha-a"],
        expected_snapshot_id: prepared.expected_snapshot_id,
        expected_previous_snapshot_id: prepared.expected_previous_snapshot_id,
      });

      await expect(readEnergyReportingCoverage({
        metadataStore: metadata,
        databasePath,
        workspaceId: "workspace-1",
        projectId: "project-1",
        dataSnapshotId: prepared.expected_snapshot_id,
        resource: "electricity",
        timezone: "UTC",
        dayCount: 28,
      })).resolves.toBeNull();
    } finally {
      metadata.close();
      try {
        rmSync(root, { recursive: true, force: true });
      } catch (error) {
        if (!(process.platform === "win32" && error instanceof Error && "code" in error
          && (error.code === "EPERM" || error.code === "EBUSY"))) throw error;
      }
    }
  });
});

const createBatch = (
  metadata: ReturnType<typeof createMetadataStore>,
  batchId: string,
  sourceSha256: string,
): void => {
  metadata.energyIq.createImportBatch({
    id: batchId,
    workspace_id: "workspace-1",
    project_id: "project-1",
    source_kind: "excel",
    source_sha256: sourceSha256,
    filename: `${batchId}.xlsx`,
    status: "inspected",
    inspection: { sheetName: "Sheet1" },
    created_by: "dev-user",
  });
};

const summary = (sourceSha256: string) => ({
  sourceSheetName: "Sheet1",
  sourceCoverageFrom: "2026-05-01T00:00:00.000Z",
  sourceCoverageTo: sourceSha256 === "sha-a" ? "2026-05-01T00:15:00.000Z" : "2026-05-01T00:30:00.000Z",
  mappingFingerprint: "mapping-v1",
  timezone: "Asia/Singapore",
  materializerContractVersion: "test-materializer-v1",
  factWriterContractVersion: ENERGY_FACT_WRITER_CONTRACT_VERSION,
});

const factWrite = (
  importBatchId: string,
  sourceSha256: string,
  intervalStart: string,
): EnergyFactMaterializationBatchWrite => ({
  importBatchId,
  sourceSha256,
  rawReadings: [],
  normalizedReadings: [],
  intervalFacts: [{
    workspaceId: "workspace-1",
    projectId: "project-1",
    importBatchId,
    resource: "electricity",
    meterPointId: "meter-a",
    scopeId: "scope-a",
    sourceLabel: "Meter A",
    category: "load",
    meterRole: "total",
    intervalStart,
    intervalEnd: new Date(Date.parse(intervalStart) + 900_000).toISOString(),
    elapsedMinutes: 15,
    activeEnergyKwh: 101,
    previousActiveEnergyKwh: 100,
    rawDeltaKwh: 1,
    usageKwh: 1,
    averageKw: 4,
    qualityStatus: "ok",
    localDate: "2026-05-01",
    localHour: 8,
    dayType: "weekday",
    sourceFile: `${importBatchId}.xlsx`,
    sourceSha256,
    sourceReadingKind: "interval_usage",
  }],
  qualityEvents: [],
});

const projectBatch = (input: EnergyFactMaterializationBatchWrite): EnergyFactMaterializationBatchWrite => ({
  importBatchId: input.importBatchId,
  sourceSha256: input.sourceSha256,
  rawReadings: input.rawReadings,
  normalizedReadings: input.normalizedReadings,
  intervalFacts: input.intervalFacts,
  qualityEvents: input.qualityEvents,
});

const periodFact = (intervalStart: string) => ({
  ...factWrite("batch-a", "sha-a", intervalStart).intervalFacts[0]!,
  intervalStart,
  intervalEnd: new Date(Date.parse(intervalStart) + 900_000).toISOString(),
  localDate: intervalStart.slice(0, 10),
  localHour: new Date(intervalStart).getUTCHours(),
});

const runDuckDbSql = async (databasePath: string, sql: string): Promise<void> => {
  const database = await getDuckDbDatabase(databasePath);
  const connection = database.connect();
  try {
    await new Promise<void>((resolve, reject) => {
      connection.run(sql, (error) => error ? reject(error) : resolve());
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      connection.close((error) => error ? reject(error) : resolve());
    });
  }
};

const queryDuckDbSql = async (
  databasePath: string,
  sql: string,
): Promise<Array<Record<string, unknown>>> => {
  const database = await getDuckDbDatabase(databasePath);
  const connection = database.connect();
  try {
    return await new Promise((resolve, reject) => {
      connection.all(sql, (error, rows) => error
        ? reject(error)
        : resolve(rows as Array<Record<string, unknown>>));
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      connection.close((error) => error ? reject(error) : resolve());
    });
  }
};

const createCoverageFixture = async (
  facts: Array<{ start: string; qualityStatus: string }>,
  qualityEvents: EnergyFactMaterializationBatchWrite["qualityEvents"] = [],
) => {
  const root = mkdtempSync(join(tmpdir(), "energy-analysis-eligible-coverage-"));
  const databasePath = join(root, "energy.duckdb");
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  metadata.workspaces.upsert({ id: "workspace-1", owner_user_id: "dev-user", name: "Workspace", kind: "customer" });
  metadata.energyIq.upsertProject({ id: "project-1", workspace_id: "workspace-1", name: "Project", status: "draft" });
  createBatch(metadata, "batch-a", "sha-a");
  const materializations = [{ batch_id: "batch-a", summary: summary("sha-a") }];
  const prepared = metadata.energyIq.prepareProjectManifestMaterialization({
    project_id: "project-1",
    materializations,
    source_manifest_sha256: ["sha-a"],
  });
  const persisted = await writeEnergyFactProjectMaterialization({
    databasePath,
    projectId: "project-1",
    timezone: "Asia/Singapore",
    expectedPreviousDataSnapshotId: prepared.expected_previous_snapshot_id,
    snapshotFactScope: prepared.fact_scope,
    batches: [{
      ...projectBatch(factWrite("batch-a", "sha-a", facts[0]?.start ?? "2026-05-01T00:00:00.000Z")),
      intervalFacts: facts.map(({ start, qualityStatus }) => ({
        ...factWrite("batch-a", "sha-a", start).intervalFacts[0]!,
        qualityStatus,
      })),
      qualityEvents,
    }],
  });
  metadata.energyIq.completeProjectManifestMaterialization({
    project_id: "project-1",
    materializations,
    project_audit: persisted.projectAudit,
    source_manifest_sha256: ["sha-a"],
    expected_snapshot_id: prepared.expected_snapshot_id,
    expected_previous_snapshot_id: prepared.expected_previous_snapshot_id,
  });
  return {
    input: {
      metadataStore: metadata,
      databasePath,
      workspaceId: "workspace-1",
      projectId: "project-1",
      dataSnapshotId: prepared.expected_snapshot_id,
      resource: "electricity" as const,
      meterAttachments: [{ meterPointId: "meter-a" }],
    },
    close: () => {
      metadata.close();
      try {
        rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      } catch (error) {
        if (!(process.platform === "win32" && error instanceof Error && "code" in error
          && (error.code === "EPERM" || error.code === "EBUSY"))) throw error;
      }
    },
  };
};
