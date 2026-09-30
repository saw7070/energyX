import { expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readTuyaNativeBundle, appendTuyaNativeBundle } from "../energy/energy-tuya-native-append.js";
import { buildTuyaOfficeSetup } from "../energy/tuya-office-project.js";
it("rejects changed bytes and path escapes before registration", () => {
  const root = mkdtempSync(join(tmpdir(), "tuya-bundle-check-")); mkdirSync(join(root, "sources"));
  try {
    const content = Buffer.from("{}"); const sha256 = createHash("sha256").update(content).digest("hex");
    writeFileSync(join(root, "sources", `${sha256}.json`), "changed");
    writeFileSync(join(root, "index.json"), JSON.stringify({ sources: [{ sha256, filename: "native.json" }] }));
    expect(() => readTuyaNativeBundle(root, buildTuyaOfficeSetup())).toThrow("TUYA_BUNDLE_SHA_MISMATCH");
    writeFileSync(join(root, "index.json"), JSON.stringify({ sources: [{ sha256, filename: "native.json", path: "../outside.json" }] }));
    expect(() => readTuyaNativeBundle(root, buildTuyaOfficeSetup())).toThrow("TUYA_BUNDLE_PATH_INVALID");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
it.skipIf(!process.env.S1_TUYA_ARCHIVE || !process.env.S1_TUYA_NATIVE_BUNDLE)("appends real native sources to the replayed snapshot without duplicate intervals or settings changes", async () => {
  const { createMetadataStore } = await import("@datafoundry/metadata");
  const { LocalFileAssetService } = await import("@datafoundry/files");
  const { ensureEnergyIqBootstrap } = await import("../energy/energy-bootstrap.js");
  const { materializeEnergyProjectManifest } = await import("../energy/energy-project-materialization.js");
  const { readTuyaArchive, buildTuyaArchiveReplay, registerTuyaArchiveReplay } = await import("../energy/energy-tuya-archive-replay.js");
  const { ReportStore } = await import("./report-store.js");
  const { getDuckDbDatabase } = await import("../../../../packages/data-gateway/src/duckdb-database-cache.js");
  const root = mkdtempSync(join(tmpdir(), "tuya-native-append-")); const databasePath = join(root, "facts.duckdb");
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  const files = new LocalFileAssetService(metadata, { storageRoot: join(root, "files") });
  try {
    ensureEnergyIqBootstrap(metadata);
    const store = new ReportStore(metadata.db);
    const settings = store.saveSettings({ projectId: "tuya-office", workspaceId: "tuya-office", actorUserId: "dev-user", timezone: "Asia/Singapore", contextNotes: "preserve", fileRefIds: [], useProjectData: true, skill: "", revision: 0, frequency: "off", localHour: 1, scheduledPrompt: "" });
    const archive = await readTuyaArchive(process.env.S1_TUYA_ARCHIVE!);
    const document = metadata.energyIq.projectSetup.getDraft({ project_id: "tuya-office", user_id: "dev-user" }).document;
    const replay = registerTuyaArchiveReplay(metadata, files, "dev-user", buildTuyaArchiveReplay(archive.rows, archive.archiveSha256, document));
    const context = { metadataStore: metadata, fileAssetService: files } as unknown as Required<import("../routes/types.js").ConfigApiContext>;
    const initial = await materializeEnergyProjectManifest({ context, userId: "dev-user", projectId: "tuya-office", requestedBatchId: replay.batchIds[0]!, databasePath });
    const sources = readTuyaNativeBundle(process.env.S1_TUYA_NATIVE_BUNDLE!, document);
    expect(sources).toHaveLength(7);
    const appended = appendTuyaNativeBundle(metadata, files, "dev-user", sources);
    expect(appended).toMatchObject({ preservedSourceCount: 29, totalSourceCount: 36 });
    expect(appendTuyaNativeBundle(metadata, files, "dev-user", sources).batchIds).toEqual(appended.batchIds);
    const result = await materializeEnergyProjectManifest({ context, userId: "dev-user", projectId: "tuya-office", requestedBatchId: appended.batchIds[0]!, databasePath });
    expect(result.snapshot.id).not.toBe(initial.snapshot.id);
    expect(store.settings("tuya-office")).toEqual(settings);
    const db = await getDuckDbDatabase(databasePath);
    const rows = await new Promise<Record<string, unknown>[]>((resolve, reject) => db.all("SELECT count(*) AS n,count(DISTINCT (meter_node_id,interval_start,interval_end)) AS unique_n,max(interval_end) AS cutoff FROM energy_interval_facts WHERE project_id='tuya-office'", (error, rows) => error ? reject(error) : resolve(rows as Record<string, unknown>[])));
    expect(Number(rows[0]!.n)).toBe(42579); expect(Number(rows[0]!.unique_n)).toBe(42579);
    expect(new Date(rows[0]!.cutoff as string).toISOString()).toBe("2026-09-11T15:45:00.000Z");
    const audit = await new Promise<Record<string, unknown>[]>((resolve, reject) => db.all("SELECT (SELECT count(*) FROM normalized_meter_readings) AS normalized_count, (SELECT count(DISTINCT (meter_node_id,event_time)) FROM normalized_meter_readings) AS normalized_unique_count, (SELECT count(*) FROM raw_meter_readings) AS raw_count, (SELECT count(*) FROM raw_meter_readings WHERE NOT is_valid OR is_overlap_conflict) AS invalid_raw", (error, rows) => error ? reject(error) : resolve(rows as Record<string, unknown>[])));
    expect(Number(audit[0]!.normalized_count)).toBe(8610); expect(Number(audit[0]!.normalized_unique_count)).toBe(8610);
    expect(Number(audit[0]!.raw_count)).toBe(34607); // production 33984 + retained 623-row replay/native provenance overlap
    expect(Number(audit[0]!.invalid_raw)).toBe(0);
    const { readEnergyFactProjectState } = await import("@datafoundry/data-gateway");
    expect(await readEnergyFactProjectState({ databasePath, projectId: "tuya-office" })).toMatchObject({ dataSnapshotId: result.snapshot.id });
  } finally {
    metadata.close();
    const db = await getDuckDbDatabase(databasePath); await new Promise<void>((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
    try { rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); } catch (error) { if (!["EPERM", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; console.warn("Temporary append evidence retained:", root); }
  }
}, 120000);
