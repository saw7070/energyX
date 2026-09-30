import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createMetadataStore } from "./index.js";

describe("EnergyIqSavedAnalysisStore", () => {
  it("appends reruns without overwriting the original result", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-saved-analysis-"));
    try {
      const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      metadata.workspaces.upsert({ id: "saved-workspace", owner_user_id: "dev-user", name: "Saved", kind: "customer" });
      metadata.energyIq.upsertProject({ id: "saved-project", workspace_id: "saved-workspace", name: "Saved", status: "published" });

      const first = metadata.energyIq.savedAnalyses.create({
        id: "analysis-v1",
        series_id: "analysis-series",
        project_id: "saved-project",
        workspace_id: "saved-workspace",
        scope_id: "project",
        scope_name: "Saved",
        resource: "electricity",
        title: "Last 7 days",
        query_json: JSON.stringify({ period: "Last 7 days" }),
        analysis_json: JSON.stringify({ summary: { usageKwh: 100 } }),
        snapshot_json: JSON.stringify({ dataSnapshot: { id: "snapshot-v1" } }),
        view_state_json: JSON.stringify({ grain: "day", comparison: "overlay", category: "all" }),
        ai_result_json: JSON.stringify({ snapshotId: "snapshot-v1", runId: "run-v1" }),
        template_revision_id: "template-v1",
        data_snapshot_id: "snapshot-v1",
        created_by: "dev-user",
        created_at: "2026-08-03T00:00:00.000Z",
      });
      const rerun = metadata.energyIq.savedAnalyses.create({
        id: "analysis-v2",
        series_id: first.series_id,
        project_id: first.project_id,
        workspace_id: first.workspace_id,
        scope_id: first.scope_id,
        scope_name: first.scope_name,
        resource: first.resource,
        title: first.title,
        query_json: first.query_json,
        analysis_json: JSON.stringify({ summary: { usageKwh: 120 } }),
        snapshot_json: JSON.stringify({ dataSnapshot: { id: "snapshot-v2" } }),
        view_state_json: first.view_state_json!,
        template_revision_id: "template-v2",
        data_snapshot_id: "snapshot-v2",
        rerun_of_id: first.id,
        created_by: "dev-user",
        created_at: "2026-08-03T01:00:00.000Z",
      });

      expect(first.sequence).toBe(1);
      expect(rerun.sequence).toBe(2);
      expect(rerun.rerun_of_id).toBe(first.id);
      expect(metadata.energyIq.savedAnalyses.get(first.id)).toMatchObject({
        analysis_json: first.analysis_json,
        snapshot_json: first.snapshot_json,
        view_state_json: first.view_state_json,
        ai_result_json: first.ai_result_json,
      });
      expect(JSON.parse(metadata.energyIq.savedAnalyses.get(first.id).analysis_json)).toMatchObject({ summary: { usageKwh: 100 } });
      expect(metadata.energyIq.savedAnalyses.listProject("saved-project").map((item) => item.id)).toEqual(["analysis-v2", "analysis-v1"]);

      const finalizedRerun = metadata.energyIq.savedAnalyses.attachAiResult({
        id: rerun.id,
        ai_result_json: JSON.stringify({ snapshotId: "snapshot-v2", runId: "run-v2" }),
      });
      expect(finalizedRerun.ai_result_json).toContain("run-v2");
      expect(() => metadata.energyIq.savedAnalyses.attachAiResult({
        id: rerun.id,
        ai_result_json: JSON.stringify({ snapshotId: "snapshot-v2", runId: "different-run" }),
      })).toThrow("ENERGYIQ_SAVED_ANALYSIS_AI_RESULT_IMMUTABLE");
      metadata.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
