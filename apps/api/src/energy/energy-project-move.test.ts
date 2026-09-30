import { createMetadataStore, type MetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { AuthService } from "../auth/service.js";
import { ActionStore } from "../report-agent/action-store.js";
import { InsightStore } from "../report-agent/insight-store.js";
import { KeyPointStore } from "../report-agent/key-point-store.js";
import { ReportStore } from "../report-agent/report-store.js";
import { EnergyAdminAccessService } from "./energy-admin-access.js";
import { ensureEnergyIqBootstrap } from "./energy-bootstrap.js";
import { handleEnergyApiRequest } from "./energy-api.js";
import type { EnergyProjectMoveFactStore } from "./energy-project-move.js";
import { resolveEnergyAccessContext } from "./energy-query-context.js";

const authConfig = {
  mode: "password" as const,
  publicBaseUrl: "http://127.0.0.1:3001",
  sessionSecret: "test-secret-that-is-longer-than-thirty-two-characters",
  emailDelivery: "test" as const
};

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

type FactCall = { op: "copy" | "purge"; from?: string; to?: string; path?: string; workspaceId?: string };

const setup = async () => {
  const root = mkdtempSync(join(tmpdir(), "energy-project-move-"));
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  cleanups.push(() => {
    metadata.close();
    rmSync(root, { recursive: true, force: true });
  });
  ensureEnergyIqBootstrap(metadata);
  const calls: FactCall[] = [];
  const factStore: EnergyProjectMoveFactStore = {
    resolvePath: (workspaceId) => `/facts/${workspaceId}.duckdb`,
    copy: async (input) => {
      calls.push({ op: "copy", from: input.sourceDatabasePath, to: input.targetDatabasePath, workspaceId: input.targetWorkspaceId });
      return { raw_meter_readings: 12 } as Awaited<ReturnType<EnergyProjectMoveFactStore["copy"]>>;
    },
    purge: async (input) => {
      calls.push({ op: "purge", path: input.databasePath });
    }
  };
  const auth = new AuthService(metadata, authConfig);
  const service = new EnergyAdminAccessService(metadata, auth, factStore);
  const oldOrg = service.createOrganisation({ actorUserId: "dev-user", name: "Tuya Office Co" });
  const newOrg = service.createOrganisation({ actorUserId: "dev-user", name: "Elite IOT" });
  metadata.energyIq.upsertProject({ id: "elite-iot", workspace_id: oldOrg.id, name: "Elite IOT", status: "published" });
  const oldMember = (await service.inviteUser({ actorUserId: "dev-user", email: "old@example.test", organisationIds: [oldOrg.id], role: "user" })).user;
  const newMember = (await service.inviteUser({ actorUserId: "dev-user", email: "new@example.test", organisationIds: [newOrg.id], role: "user" })).user;
  return { metadata, service, calls, oldOrg, newOrg, oldMember, newMember };
};

const visibleProjectIds = (metadata: MetadataStore, userId: string, workspaceId: string): string[] =>
  resolveEnergyAccessContext({
    metadataStore: metadata,
    user: metadata.users.getById({ user_id: userId }),
    requestedWorkspaceId: workspaceId,
    env: {}
  }).projects.map((project) => project.id);

const seedProjectHistory = (metadata: MetadataStore, workspaceId: string) => {
  const db = metadata.db;
  new ActionStore(db);
  new InsightStore(db);
  new KeyPointStore(db);
  new ReportStore(db);
  const doc = JSON.stringify({ workspaceId, projectId: "elite-iot" });
  db.prepare("INSERT INTO energyiq_actions VALUES ('action-1', ?, 'elite-iot', 'dev-user', 1, 'k', 'h', ?)").run(workspaceId, doc);
  db.prepare("INSERT INTO energyiq_action_events VALUES ('event-1', 'action-1', 'k', 'h', ?)").run(doc);
  db.prepare("INSERT INTO energyiq_key_point_publications VALUES (?, 'elite-iot', 1, 'report-1', 'hash', '{}')").run(workspaceId);
  db.prepare("INSERT INTO energyiq_project_insights VALUES ('insight-1', ?, 'fp', ?)").run(`${workspaceId}/elite-iot`, doc);
  db.prepare("INSERT INTO energyiq_report_sessions VALUES ('session-1', 'elite-iot', 'dev-user', ?)").run(doc);
  // Composite (project_id, workspace_id) foreign key without ON UPDATE: only a deferred check lets it move.
  db.prepare(`INSERT INTO energyiq_additional_insight_evaluations
    VALUES ('evaluation-1', ?, 'elite-iot', 'scope', 'dev-user', 'idem', '{}', '{}', 'now', 'now')`).run(workspaceId);
};

describe("moving a project to another customer Organisation", () => {
  it("restamps the project and its history, moves its facts, and switches who can see it", async () => {
    const { metadata, service, calls, oldOrg, newOrg, oldMember, newMember } = await setup();
    seedProjectHistory(metadata, oldOrg.id);
    // A sibling project in the old Organisation must be left alone.
    metadata.energyIq.upsertProject({ id: "tuya-sibling", workspace_id: oldOrg.id, name: "Sibling", status: "published" });
    expect(visibleProjectIds(metadata, oldMember.id, oldOrg.id)).toContain("elite-iot");

    const { result, organisations } = await service.moveProject({ actorUserId: "dev-user", projectId: "elite-iot", organisationId: newOrg.id });

    expect(result).toMatchObject({ projectId: "elite-iot", fromWorkspaceId: oldOrg.id, toWorkspaceId: newOrg.id });
    expect(metadata.energyIq.getProject("elite-iot").workspace_id).toBe(newOrg.id);
    expect(metadata.energyIq.getProject("tuya-sibling").workspace_id).toBe(oldOrg.id);
    const db = metadata.db;
    const one = (sql: string) => db.prepare(sql).get() as Record<string, unknown>;
    expect(one("SELECT workspace_id FROM energyiq_actions").workspace_id).toBe(newOrg.id);
    expect(JSON.parse(String(one("SELECT document FROM energyiq_actions").document)).workspaceId).toBe(newOrg.id);
    expect(JSON.parse(String(one("SELECT document FROM energyiq_action_events").document)).workspaceId).toBe(newOrg.id);
    expect(one("SELECT workspace_id FROM energyiq_key_point_publications").workspace_id).toBe(newOrg.id);
    expect(one("SELECT scope FROM energyiq_project_insights").scope).toBe(`${newOrg.id}/elite-iot`);
    expect(JSON.parse(String(one("SELECT document FROM energyiq_report_sessions").document)).workspaceId).toBe(newOrg.id);
    expect(one("SELECT workspace_id FROM energyiq_additional_insight_evaluations").workspace_id).toBe(newOrg.id);

    expect(calls).toEqual([
      { op: "copy", from: `/facts/${oldOrg.id}.duckdb`, to: `/facts/${newOrg.id}.duckdb`, workspaceId: newOrg.id },
      { op: "purge", path: `/facts/${oldOrg.id}.duckdb` }
    ]);
    expect(visibleProjectIds(metadata, oldMember.id, oldOrg.id)).not.toContain("elite-iot");
    expect(visibleProjectIds(metadata, newMember.id, newOrg.id)).toEqual(["elite-iot"]);
    expect(organisations.find((organisation) => organisation.id === newOrg.id)?.projects.map((project) => project.id)).toEqual(["elite-iot"]);
    const audit = db.prepare("SELECT event_type FROM auth_audit_events WHERE event_type = 'energyiq.project_moved'").all();
    expect(audit).toHaveLength(1);
  });

  it("leaves everything in place and discards the copied facts when the metadata move fails", async () => {
    const { metadata, service, calls, oldOrg, newOrg } = await setup();
    seedProjectHistory(metadata, oldOrg.id);
    metadata.db.exec(`CREATE TRIGGER fail_move BEFORE UPDATE ON energyiq_key_point_publications
      BEGIN SELECT RAISE(ABORT, 'simulated failure'); END`);

    await expect(service.moveProject({ actorUserId: "dev-user", projectId: "elite-iot", organisationId: newOrg.id }))
      .rejects.toThrow("simulated failure");

    expect(metadata.energyIq.getProject("elite-iot").workspace_id).toBe(oldOrg.id);
    expect((metadata.db.prepare("SELECT workspace_id FROM energyiq_actions").get() as { workspace_id: string }).workspace_id).toBe(oldOrg.id);
    expect(calls).toEqual([
      { op: "copy", from: `/facts/${oldOrg.id}.duckdb`, to: `/facts/${newOrg.id}.duckdb`, workspaceId: newOrg.id },
      { op: "purge", path: `/facts/${newOrg.id}.duckdb` }
    ]);
  });

  it("refuses built-in projects, the current Organisation, personal Workspaces and unknown targets before touching data", async () => {
    const { metadata, service, calls, oldOrg } = await setup();
    const move = (projectId: string, organisationId: string) =>
      service.moveProject({ actorUserId: "dev-user", projectId, organisationId });

    await expect(move("tuya-office", oldOrg.id)).rejects.toMatchObject({ status: 409 });
    await expect(move("elite-iot", oldOrg.id)).rejects.toMatchObject({ status: 409 });
    await expect(move("elite-iot", "missing-org")).rejects.toMatchObject({ status: 404 });
    await expect(move("missing-project", oldOrg.id)).rejects.toMatchObject({ status: 404 });
    const personal = metadata.workspaces.list().find((workspace) => workspace.kind !== "customer");
    if (personal) await expect(move("elite-iot", personal.id)).rejects.toMatchObject({ status: 400 });
    expect(calls).toEqual([]);
  });

  it("is admin-only over the API", async () => {
    const { metadata, oldOrg, newOrg, oldMember } = await setup();
    const request = Object.assign(
      new (await import("node:stream")).Readable({ read() { this.push(JSON.stringify({ organisationId: newOrg.id })); this.push(null); } }),
      { method: "POST", headers: { "content-type": "application/json" } }
    );
    const response = await handleEnergyApiRequest(
      request as never,
      ["admin", "projects", "elite-iot", "move"],
      { metadataStore: metadata, userId: oldMember.id, workspaceId: oldOrg.id } as never
    );
    expect(response.status).toBe(403);
    expect(metadata.energyIq.getProject("elite-iot").workspace_id).toBe(oldOrg.id);
  });
});
