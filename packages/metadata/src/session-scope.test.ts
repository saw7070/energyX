import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createMetadataStore } from "./index.js";

describe("SessionRepository EnergyIQ scope", () => {
  it("lists conversations only for the selected Workspace and Project", () => {
    const root = mkdtempSync(join(tmpdir(), "session-scope-list-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.sessions.create({
        user_id: "dev-user",
        id: "ngee-session",
        workspace_id: "ngee-workspace",
        project_id: "ngee-ann-polytechnic"
      });
      metadata.sessions.create({
        user_id: "dev-user",
        id: "preschool-session",
        workspace_id: "preschool-workspace",
        project_id: "preschool-demo"
      });
      metadata.sessions.create({ user_id: "dev-user", id: "generic-session" });

      expect(metadata.sessions.list({
        user_id: "dev-user",
        workspace_id: "ngee-workspace",
        project_id: "ngee-ann-polytechnic"
      }).map((session) => session.id)).toEqual(["ngee-session"]);
      expect(metadata.sessions.list({
        user_id: "dev-user",
        workspace_id: "preschool-workspace",
        project_id: "preschool-demo"
      }).map((session) => session.id)).toEqual(["preschool-session"]);
      expect(metadata.sessions.list({ user_id: "dev-user" })).toHaveLength(3);
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects reuse of a Session in another Project", () => {
    const root = mkdtempSync(join(tmpdir(), "session-scope-mismatch-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.sessions.create({
        user_id: "dev-user",
        id: "project-session",
        workspace_id: "workspace-1",
        project_id: "project-1"
      });

      expect(() => metadata.sessions.create({
        user_id: "dev-user",
        id: "project-session",
        workspace_id: "workspace-2",
        project_id: "project-2"
      })).toThrow("ENERGYIQ_SESSION_WORKSPACE_MISMATCH");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not silently bind a legacy Session that already has Run history", () => {
    const root = mkdtempSync(join(tmpdir(), "session-scope-legacy-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.sessions.create({ user_id: "dev-user", id: "legacy-session" });
      metadata.runs.create({
        user_id: "dev-user",
        id: "legacy-run",
        session_id: "legacy-session",
        user_input: "old project question",
        status: "completed"
      });

      expect(() => metadata.sessions.create({
        user_id: "dev-user",
        id: "legacy-session",
        workspace_id: "workspace-1",
        project_id: "project-1"
      })).toThrow("ENERGYIQ_SESSION_SCOPE_REQUIRED");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("atomically persists the exact EnergyIQ context before the first Run", () => {
    const root = mkdtempSync(join(tmpdir(), "session-energy-context-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      const context = {
        workspaceId: "workspace-1",
        projectId: "project-1",
        from: "2026-05-31T16:00:00.000Z",
        to: "2026-06-30T16:00:00.000Z",
        dataSnapshotId: "snapshot-1",
      };
      const created = metadata.sessions.createWithEnergyContext({
        user_id: "dev-user",
        id: "continued-session",
        workspace_id: "workspace-1",
        project_id: "project-1",
        title: "New data task",
        title_source: "fallback",
        energy_context: context,
      });

      expect(JSON.parse(created.energy_context_json ?? "null")).toEqual(context);
      expect(metadata.sessions.get({
        user_id: "dev-user",
        session_id: "continued-session",
      })).toMatchObject({
        workspace_id: "workspace-1",
        project_id: "project-1",
        energy_context_json: JSON.stringify(context),
      });
      expect(() => metadata.sessions.createWithEnergyContext({
        user_id: "dev-user",
        id: "continued-session",
        workspace_id: "workspace-1",
        project_id: "project-1",
        energy_context: context,
      })).toThrow("Session already exists");
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      expect(() => metadata.sessions.createWithEnergyContext({
        user_id: "dev-user",
        id: "rolled-back-session",
        workspace_id: "workspace-1",
        project_id: "project-1",
        energy_context: cyclic,
      })).toThrow();
      expect(metadata.sessions.list({ user_id: "dev-user" })
        .some((session) => session.id === "rolled-back-session")).toBe(false);
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses the Session history index without sorting an actor's sibling snapshots", () => {
    const root = mkdtempSync(join(tmpdir(), "session-context-index-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      for (let index = 0; index < 40; index += 1) {
        const sessionId = index === 39 ? "target-session" : `sibling-session-${index}`;
        const runId = `run-${index}`;
        metadata.sessions.create({ user_id: "dev-user", id: sessionId });
        metadata.runs.create({
          user_id: "dev-user",
          id: runId,
          session_id: sessionId,
          user_input: `Question ${index}`,
          status: "completed",
        });
        metadata.contextPackageSnapshots.create({
          user_id: "dev-user",
          session_id: sessionId,
          run_id: runId,
          package_id: `package-${index}`,
          revision: 1,
          payload: { items: [{ sourceType: "knowledge", content: `Context ${index}` }] },
        });
      }

      expect([...metadata.contextPackageSnapshots.iterateBySession({
        user_id: "dev-user",
        session_id: "target-session",
      })].map((snapshot) => snapshot.session_id)).toEqual(["target-session"]);
      const plan = metadata.db.prepare(`
        EXPLAIN QUERY PLAN
        SELECT *
        FROM context_package_snapshots
        WHERE user_id = ? AND session_id = ?
        ORDER BY created_at DESC, revision DESC, id DESC
      `).all("dev-user", "target-session") as Array<{ detail: string }>;
      const details = plan.map((row) => row.detail).join("\n");
      expect(details).toContain("idx_context_package_snapshots_user_session_history");
      expect(details).not.toContain("USE TEMP B-TREE");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
