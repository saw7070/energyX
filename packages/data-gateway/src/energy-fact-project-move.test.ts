import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { getDuckDbDatabase } from "./duckdb-database-cache.js";
import { copyEnergyFactProjectToWorkspace, purgeEnergyFactProject } from "./energy-fact-writer.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const query = async (path: string, sql: string, params: unknown[] = []): Promise<Array<Record<string, unknown>>> => {
  const connection = (await getDuckDbDatabase(path)).connect();
  try {
    return await new Promise((resolve, reject) => {
      connection.all(sql, ...params, (error, rows) => error ? reject(error) : resolve(rows as Array<Record<string, unknown>>));
    });
  } finally {
    connection.close();
  }
};

const seedSource = async (path: string): Promise<void> => {
  mkdirSync(dirname(path), { recursive: true });
  await query(path, "SELECT 1");
  // Purging an existing store creates the full fact schema, exactly as materialization would.
  await purgeEnergyFactProject({ databasePath: path, projectId: "none" });
  for (const projectId of ["moving", "staying"]) {
    await query(path, `INSERT INTO raw_meter_readings (workspace_id, project_id, resource, event_time, active_energy_kwh)
      VALUES ('old-org', ?, 'meter-1', TIMESTAMPTZ '2026-09-01 00:00:00+08', 1.5),
             ('old-org', ?, 'meter-1', TIMESTAMPTZ '2026-09-01 00:15:00+08', 2.0)`, [projectId, projectId]);
    await query(path, `INSERT INTO energy_source_interval_facts (workspace_id, project_id, resource, usage_kwh, interval_start)
      VALUES ('old-org', ?, 'meter-1', 0.5, TIMESTAMPTZ '2026-09-01 00:00:00+08')`, [projectId]);
    await query(path, `INSERT INTO energy_project_fact_state (project_id, workspace_id, data_snapshot_id, manifest_fingerprint,
        source_sha256_json, fact_writer_contract_version, updated_at)
      VALUES (?, 'old-org', 'snapshot-1', 'fp', '[]', 'v4', now())`, [projectId]);
  }
};

describe("energy fact project move", () => {
  it("copies one project's facts into the target store restamped with the target workspace, then purges the source", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-fact-move-"));
    roots.push(root);
    const source = join(root, "old-org", "energy.duckdb");
    const target = join(root, "new-org", "energy.duckdb");
    await seedSource(source);

    const counts = await copyEnergyFactProjectToWorkspace({
      sourceDatabasePath: source,
      targetDatabasePath: target,
      projectId: "moving",
      targetWorkspaceId: "new-org",
    });
    expect(counts).toMatchObject({ raw_meter_readings: 2, energy_source_interval_facts: 1, energy_project_fact_state: 1, energy_interval_facts: 0 });

    expect(await query(target, "SELECT DISTINCT workspace_id, project_id FROM raw_meter_readings"))
      .toEqual([{ workspace_id: "new-org", project_id: "moving" }]);
    expect(await query(target, "SELECT SUM(active_energy_kwh) AS kwh FROM raw_meter_readings")).toEqual([{ kwh: 3.5 }]);
    expect(await query(target, "SELECT workspace_id FROM energy_project_fact_state WHERE project_id = 'moving'"))
      .toEqual([{ workspace_id: "new-org" }]);
    // The copy never touches the source; the caller purges only after the metadata move commits.
    expect(await query(source, "SELECT COUNT(*)::INTEGER AS n FROM raw_meter_readings WHERE project_id = 'moving'")).toEqual([{ n: 2 }]);

    await purgeEnergyFactProject({ databasePath: source, projectId: "moving" });
    expect(await query(source, "SELECT DISTINCT project_id FROM raw_meter_readings")).toEqual([{ project_id: "staying" }]);
    expect(await query(source, "SELECT project_id FROM energy_project_fact_state")).toEqual([{ project_id: "staying" }]);
  });

  it("replaces rows left in the target by an earlier interrupted copy instead of duplicating them", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-fact-move-"));
    roots.push(root);
    const source = join(root, "old-org", "energy.duckdb");
    const target = join(root, "new-org", "energy.duckdb");
    await seedSource(source);
    const input = { sourceDatabasePath: source, targetDatabasePath: target, projectId: "moving", targetWorkspaceId: "new-org" };

    await copyEnergyFactProjectToWorkspace(input);
    await copyEnergyFactProjectToWorkspace(input);

    expect(await query(target, "SELECT COUNT(*)::INTEGER AS n FROM raw_meter_readings")).toEqual([{ n: 2 }]);
  });

  it("refuses to copy a store onto itself", async () => {
    await expect(copyEnergyFactProjectToWorkspace({
      sourceDatabasePath: "/tmp/same.duckdb",
      targetDatabasePath: "/tmp/same.duckdb",
      projectId: "moving",
      targetWorkspaceId: "new-org",
    })).rejects.toThrow("ENERGYIQ_FACT_STORE_MOVE_SAME_PATH");
  });
});
