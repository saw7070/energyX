import { expect, it } from "vitest";
import { buildTuyaArchiveReplay, type ArchiveReading } from "../energy/energy-tuya-archive-replay.js";
import { buildTuyaOfficeSetup } from "../energy/tuya-office-project.js";
import { readEnergyTuyaArtifact } from "../energy/energy-tuya-import.js";
const row: ArchiveReading = { project_id: "tuya-office", import_batch_id: "original-batch", source_sha256: "a".repeat(64), source_row_number: 2, meter_node_id: "panel-a-total", device_name: "Panel A Total", event_time: "2026-09-05T15:30:00Z", active_energy_kwh: 1234.56, is_valid: true, is_overlap_conflict: false };
it("replays actual cumulative values and timestamps while preserving original provenance separately", () => {
  const inputs = [{ ...row }, { ...row, source_row_number: 3, event_time: "2026-09-05T15:45:00Z", active_energy_kwh: 1234.78 }];
  const replay = buildTuyaArchiveReplay(inputs, "b".repeat(64), buildTuyaOfficeSetup())[0]!;
  expect(replay.sha256).not.toBe(row.source_sha256);
  expect(readEnergyTuyaArtifact(replay.content).rows).toMatchObject([{ activeEnergyKwh: 1234.56, eventTime: "2026-09-05T15:30:00.000Z" }, { activeEnergyKwh: 1234.78, eventTime: "2026-09-05T15:45:00.000Z" }]);
  expect(JSON.parse(replay.content.toString()).replay).toMatchObject({ originalBatchId: "original-batch", originalSourceSha256: row.source_sha256, archiveSha256: "b".repeat(64) });
  expect(buildTuyaArchiveReplay(inputs.reverse(), "b".repeat(64), buildTuyaOfficeSetup())[0]!.sha256).toBe(replay.sha256);
});
it.each([{ is_valid: false }, { is_overlap_conflict: true }, { project_id: "other" }, { meter_node_id: "unknown" }, { device_name: "guessed business label" }, { active_energy_kwh: -1 }, { event_time: "bad" }])("rejects invalid or unmapped archive rows rather than dropping or relabeling them", (override) => {
  expect(() => buildTuyaArchiveReplay([{ ...row, ...override }], "b".repeat(64), buildTuyaOfficeSetup())).toThrow("TUYA_REPLAY_ROW_INVALID");
});


it.skipIf(!process.env.S1_TUYA_ARCHIVE)("replays the real archive through the existing manifest materializer in isolated storage", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os"); const { join } = await import("node:path");
  const { createMetadataStore } = await import("@datafoundry/metadata");
  const { LocalFileAssetService } = await import("@datafoundry/files");
  const { ensureEnergyIqBootstrap } = await import("../energy/energy-bootstrap.js");
  const { materializeEnergyProjectManifest } = await import("../energy/energy-project-materialization.js");
  const { readTuyaArchive, registerTuyaArchiveReplay } = await import("../energy/energy-tuya-archive-replay.js");
  const { readEnergyAnalysisEligibleCoverage } = await import("@datafoundry/data-gateway");
  const { resolveEnergyPublishedMeterRoute } = await import("../energy/energy-query-context.js");
  const root = mkdtempSync(join(tmpdir(), "tuya-archive-replay-"));
  const previousPath = process.env.ENERGYIQ_DUCKDB_PATH; process.env.ENERGYIQ_DUCKDB_PATH = join(root, "facts.duckdb");
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  const files = new LocalFileAssetService(metadata, { storageRoot: join(root, "files") });
  try {
    ensureEnergyIqBootstrap(metadata);
    const archive = await readTuyaArchive(process.env.S1_TUYA_ARCHIVE!);
    const draft = metadata.energyIq.projectSetup.getDraft({ project_id: "tuya-office", user_id: "dev-user" });
    const artifacts = buildTuyaArchiveReplay(archive.rows, archive.archiveSha256, draft.document);
    const { batchIds } = registerTuyaArchiveReplay(metadata, files, "dev-user", artifacts);
    const context = { metadataStore: metadata, fileAssetService: files } as unknown as Required<import("../routes/types.js").ConfigApiContext>;
    const result = await materializeEnergyProjectManifest({ context, userId: "dev-user", projectId: "tuya-office", requestedBatchId: batchIds[0]!, databasePath: join(root, "facts.duckdb") });
    expect(result.snapshot.id).not.toBe("unavailable");
    const project = metadata.energyIq.getProject("tuya-office");
    const route = resolveEnergyPublishedMeterRoute({ metadataStore: metadata, projectId: project.id, hierarchyRevisionId: project.hierarchy_revision_id, scopeId: project.root_scope_id, resource: "electricity" });
    expect(route.attachments).toHaveLength(20);
    const coverage = await readEnergyAnalysisEligibleCoverage({ metadataStore: metadata, workspaceId: project.workspace_id, projectId: project.id, dataSnapshotId: result.snapshot.id, resource: "electricity", meterAttachments: route.attachments, databasePath: join(root, "facts.duckdb") });
    const { getDuckDbDatabase } = await import("../../../../packages/data-gateway/src/duckdb-database-cache.js");
    const db = await getDuckDbDatabase(join(root, "facts.duckdb"));
    const actualIntervals = await new Promise<unknown[]>((resolve, reject) => db.all("SELECT meter_node_id, epoch_ms(interval_start) AS start_ms, epoch_ms(interval_end) AS end_ms, round(usage_kwh, 9) AS usage, round(average_kw, 9) AS power, quality_status FROM energy_interval_facts WHERE project_id='tuya-office' ORDER BY meter_node_id,interval_start", (error, rows) => error ? reject(error) : resolve(rows)));
    expect(actualIntervals).toEqual(archive.intervals);
    const { resolveEnergyQueryContext } = await import("../energy/energy-query-context.js");
    const { executeEnergyScopeAnalysisWithLatestAvailable } = await import("../energy/energy-analysis.js");
    const { LocalDataGateway, ensureEnergyScopedDataSource, exportEnergyScopedCsv } = await import("@datafoundry/data-gateway");
    const queryContext = resolveEnergyQueryContext({ metadataStore: metadata, user: metadata.users.getById({ user_id: "dev-user" }), workspaceId: project.workspace_id, request: { projectId: project.id, scopeId: project.root_scope_id, resource: "electricity", period: "Custom", from: "2026-09-02", to: "2026-09-02" } });
    const analysis = await executeEnergyScopeAnalysisWithLatestAvailable({ metadataStore: metadata, dataGateway: new LocalDataGateway(metadata), userId: "dev-user", context: queryContext, profile: "explorer" });
    expect(analysis.summary.validIntervalCount).toBeGreaterThan(0);
    // Independently summed from the archived CSV: four main meters + three DB3 meters.
    expect(analysis.summary.usageKwh).toBeCloseTo(102.5110151114, 3);
    expect(analysis.summary.usageKwh).toBeLessThan(146.411763914); // summing all subcircuits would double count
    const scoped = await ensureEnergyScopedDataSource({ metadataStore: metadata, userId: "dev-user", context: { ...queryContext, meterAttachments: route.attachments } });
    await exportEnergyScopedCsv(scoped, join(root, "pi-period.csv"));
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(join(root, "pi-period.csv"), "utf8").trim().split("\n")).toHaveLength(1633);
    expect(coverage).toMatchObject({ intervalCount: 32511, from: "2026-08-16T08:45:00.000Z", to: "2026-09-05T15:45:00.000Z" });
  } finally {
    if (previousPath === undefined) delete process.env.ENERGYIQ_DUCKDB_PATH; else process.env.ENERGYIQ_DUCKDB_PATH = previousPath;
    metadata.close();
    const { getDuckDbDatabase } = await import("../../../../packages/data-gateway/src/duckdb-database-cache.js");
    const db = await getDuckDbDatabase(join(root, "facts.duckdb"));
    await new Promise<void>((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
    try { rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EPERM" && (error as NodeJS.ErrnoException).code !== "EBUSY") throw error; console.warn("Temporary replay evidence retained for cleanup:", root); }
  }
}, 120000);
