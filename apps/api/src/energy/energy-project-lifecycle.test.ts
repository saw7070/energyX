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

describe("renaming projects and clients", () => {
  const auditOf = (metadata: ReturnType<typeof setup>["metadata"], type: string) =>
    (metadata.db.prepare("SELECT metadata_json FROM auth_audit_events WHERE event_type = ?").all(type) as Array<{ metadata_json: string }>)
      .map((row) => JSON.parse(row.metadata_json) as Record<string, unknown>);

  it("renames a project, tidies the spaces, and records who changed it from what", () => {
    const { metadata, service, org } = setup();
    const { organisations } = service.renameProject({ actorUserId: "dev-user", projectId: "site-1", name: "  Seng Kang   Block 101 " });
    expect(metadata.energyIq.getProject("site-1").name).toBe("Seng Kang Block 101");
    expect(organisations.find((organisation) => organisation.id === org.id)?.projects[0]?.name).toBe("Seng Kang Block 101");
    // The setup draft carries the new name too, so publishing setup later does not bring the old one back.
    expect(metadata.energyIq.projectSetup.getDraft({ project_id: "site-1", user_id: "dev-user" }).document.project.name).toBe("Seng Kang Block 101");
    expect(auditOf(metadata, "energyiq.project_renamed")).toEqual([
      { projectId: "site-1", workspaceId: org.id, previousName: "Site One", name: "Seng Kang Block 101" },
    ]);
    // The same name again changes nothing and records nothing.
    service.renameProject({ actorUserId: "dev-user", projectId: "site-1", name: "Seng Kang Block 101" });
    expect(auditOf(metadata, "energyiq.project_renamed")).toHaveLength(1);
  });

  it("refuses an empty or over-long project name, and a project that does not exist", () => {
    const { metadata, service } = setup();
    expect(() => service.renameProject({ actorUserId: "dev-user", projectId: "site-1", name: "   " })).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => service.renameProject({ actorUserId: "dev-user", projectId: "site-1", name: "x".repeat(201) })).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => service.renameProject({ actorUserId: "dev-user", projectId: "missing", name: "Anything" })).toThrow(expect.objectContaining({ status: 404 }));
    expect(metadata.energyIq.getProject("site-1").name).toBe("Site One");
    service.renameProject({ actorUserId: "dev-user", projectId: "site-1", name: "x".repeat(200) });
    expect(metadata.energyIq.getProject("site-1").name).toHaveLength(200);
  });

  it("renames a client without changing whether it is enabled", () => {
    const { metadata, service, org } = setup();
    const renamed = service.updateOrganisation({ actorUserId: "dev-user", id: org.id, name: "Seng Kang Town Council" });
    expect(renamed).toMatchObject({ name: "Seng Kang Town Council", status: "active" });
    expect(auditOf(metadata, "energyiq.organisation_updated").at(-1)).toMatchObject({ organisationId: org.id, name: "Seng Kang Town Council", previousName: "Acme", disabled: false });

    service.updateOrganisation({ actorUserId: "dev-user", id: org.id, name: "Seng Kang Town Council", disabled: true });
    expect(service.updateOrganisation({ actorUserId: "dev-user", id: org.id, name: "SKTC" })).toMatchObject({ name: "SKTC", status: "disabled" });
    expect(() => service.updateOrganisation({ actorUserId: "dev-user", id: org.id, name: "  " })).toThrow(expect.objectContaining({ status: 400 }));
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
