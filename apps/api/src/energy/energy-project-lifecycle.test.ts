import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { AuthService } from "../auth/service.js";
import { ActionStore } from "../report-agent/action-store.js";
import { InsightStore } from "../report-agent/insight-store.js";
import { ReportStore } from "../report-agent/report-store.js";
import { EnergyAdminAccessService } from "./energy-admin-access.js";
import { ensureEnergyIqBootstrap } from "./energy-bootstrap.js";
import type { EnergyProjectMoveFactStore } from "./energy-project-move.js";

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

const setup = () => {
  const root = mkdtempSync(join(tmpdir(), "energy-project-lifecycle-"));
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  cleanups.push(() => {
    metadata.close();
    rmSync(root, { recursive: true, force: true });
  });
  ensureEnergyIqBootstrap(metadata);
  const purged: string[] = [];
  const factStore: EnergyProjectMoveFactStore = {
    resolvePath: (workspaceId) => `/facts/${workspaceId}.duckdb`,
    copy: async () => { throw new Error("not used"); },
    purge: async (input) => { purged.push(`${input.databasePath}#${input.projectId}`); }
  };
  const service = new EnergyAdminAccessService(metadata, new AuthService(metadata, authConfig), factStore);
  const org = service.createOrganisation({ actorUserId: "dev-user", name: "Acme" });
  metadata.energyIq.upsertProject({ id: "site-1", workspace_id: org.id, name: "Site One", status: "published" });
  return { metadata, service, org, purged };
};

describe("archiving projects", () => {
  it("archives a project and restores it to its previous visibility", () => {
    const { metadata, service } = setup();
    service.setProjectArchived({ actorUserId: "dev-user", projectId: "site-1", archived: true });
    expect(metadata.energyIq.getProject("site-1").status).toBe("archived");
    service.setProjectArchived({ actorUserId: "dev-user", projectId: "site-1", archived: false });
    // Never published through setup, so it comes back as a draft for the admin to finish.
    expect(metadata.energyIq.getProject("site-1").status).toBe("draft");
  });

  it("refuses built-in projects", () => {
    const { service } = setup();
    expect(() => service.setProjectArchived({ actorUserId: "dev-user", projectId: "tuya-office", archived: true }))
      .toThrow(expect.objectContaining({ status: 409 }));
  });
});

describe("deleting projects", () => {
  it("requires the exact project name, then removes the project, its history and its readings", async () => {
    const { metadata, service, org, purged } = setup();
    const db = metadata.db;
    new ActionStore(db);
    new InsightStore(db);
    new ReportStore(db);
    const doc = JSON.stringify({ workspaceId: org.id, projectId: "site-1" });
    db.prepare("INSERT INTO energyiq_actions VALUES ('action-1', ?, 'site-1', 'dev-user', 1, 'k', 'h', ?)").run(org.id, doc);
    db.prepare("INSERT INTO energyiq_action_events VALUES ('event-1', 'action-1', 'k', 'h', ?)").run(doc);
    db.prepare("INSERT INTO energyiq_project_insights VALUES ('insight-1', ?, 'fp', ?)").run(`${org.id}/site-1`, doc);
    db.prepare("INSERT INTO energyiq_report_runs VALUES ('run-1', 'site-1', 'done', NULL, ?)").run(doc);
    db.prepare("INSERT INTO energyiq_report_events (run_id, document) VALUES ('run-1', '{}')").run();
    db.prepare(`INSERT INTO energyiq_additional_insight_evaluations
      VALUES ('evaluation-1', ?, 'site-1', 'scope', 'dev-user', 'idem', '{}', '{}', 'now', 'now')`).run(org.id);

    await expect(service.deleteProject({ actorUserId: "dev-user", projectId: "site-1", confirmName: "Site" }))
      .rejects.toMatchObject({ status: 400 });
    expect(metadata.energyIq.getProject("site-1")).toBeTruthy();

    await service.deleteProject({ actorUserId: "dev-user", projectId: "site-1", confirmName: "Site One" });

    expect(() => metadata.energyIq.getProject("site-1")).toThrow();
    for (const table of ["energyiq_actions", "energyiq_action_events", "energyiq_project_insights", "energyiq_report_runs",
      "energyiq_report_events", "energyiq_additional_insight_evaluations"]) {
      expect((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n, table).toBe(0);
    }
    expect(purged).toEqual([`/facts/${org.id}.duckdb#site-1`]);
  });

  it("refuses built-in projects", async () => {
    const { service } = setup();
    await expect(service.deleteProject({ actorUserId: "dev-user", projectId: "tuya-office", confirmName: "Tuya Office" }))
      .rejects.toMatchObject({ status: 409 });
  });
});

describe("deleting customer Organisations", () => {
  it("only deletes an Organisation once it has no projects and no users", async () => {
    const { metadata, service, org } = setup();
    expect(() => service.deleteOrganisation({ actorUserId: "dev-user", id: org.id })).toThrow(expect.objectContaining({ status: 409 }));

    await service.deleteProject({ actorUserId: "dev-user", projectId: "site-1", confirmName: "Site One" });
    const member = (await service.inviteUser({ actorUserId: "dev-user", email: "m@example.test", organisationIds: [org.id], role: "user" })).user;
    expect(() => service.deleteOrganisation({ actorUserId: "dev-user", id: org.id })).toThrow(expect.objectContaining({ status: 409 }));

    service.updateUser({ actorUserId: "dev-user", userId: member.id, displayName: "M", organisationIds: [], role: "admin", disabled: false });
    const { organisations } = service.deleteOrganisation({ actorUserId: "dev-user", id: org.id });
    expect(organisations.map((organisation) => organisation.id)).not.toContain(org.id);
    expect(() => metadata.workspaces.get({ id: org.id })).toThrow();
  });

  it("refuses built-in Organisations", () => {
    const { service } = setup();
    expect(() => service.deleteOrganisation({ actorUserId: "dev-user", id: "tuya-office" })).toThrow(expect.objectContaining({ status: 409 }));
  });
});
