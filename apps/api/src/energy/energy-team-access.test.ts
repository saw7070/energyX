import { createMetadataStore, ENERGYIQ_ORGANISATION_ADMIN_ROLE_ID, ENERGYIQ_VIEWER_ROLE_ID } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { AuthService } from "../auth/service.js";
import { ensureEnergyIqBootstrap } from "./energy-bootstrap.js";
import { EnergyAdminAccessService } from "./energy-admin-access.js";
import { resolveEnergyProjectCapabilities } from "./energy-project-capabilities.js";
import { resolveEnergyAccessContext } from "./energy-query-context.js";
import { EnergyTeamAccessService } from "./energy-team-access.js";

const authConfig = {
  mode: "password" as const,
  publicBaseUrl: "http://127.0.0.1:3001",
  sessionSecret: "test-secret-that-is-longer-than-thirty-two-characters",
  emailDelivery: "test" as const
};

const build = async (metadata: ReturnType<typeof createMetadataStore>) => {
  ensureEnergyIqBootstrap(metadata);
  const auth = new AuthService(metadata, authConfig);
  const admin = new EnergyAdminAccessService(metadata, auth);
  const team = new EnergyTeamAccessService(metadata, auth);
  const elite = admin.createOrganisation({ actorUserId: "dev-user", name: "Elite IOT" });
  const other = admin.createOrganisation({ actorUserId: "dev-user", name: "Other Client" });
  const invite = (email: string, organisationIds: string[], organisationRoles?: Record<string, string>) => admin.inviteUser({
    actorUserId: "dev-user", email, organisationIds, role: "user", ...(organisationRoles ? { organisationRoles } : {})
  });
  const sub = await invite("sub@elite.test", [elite.id], { [elite.id]: ENERGYIQ_ORGANISATION_ADMIN_ROLE_ID });
  const user = (id: string) => metadata.users.getById({ user_id: id });
  return { metadata, auth, admin, team, elite, other, sub, user, invite };
};

const setup = async (run: (ctx: Awaited<ReturnType<typeof build>>) => Promise<void>) => {
  const root = mkdtempSync(join(tmpdir(), "energy-team-access-"));
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  try {
    await run(await build(metadata));
  } finally {
    metadata.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};

const publishProject = (metadata: ReturnType<typeof createMetadataStore>, workspaceId: string, id = "p-1") =>
  metadata.energyIq.upsertProject({ id, workspace_id: workspaceId, name: "Site", status: "published" });

describe("Team: people management confined to one Organisation", () => {
  it("lets someone with People: write invite a Viewer who sees only that Organisation", async () => {
    await setup(async ({ metadata, team, elite, other, sub, user }) => {
      const result = await team.invite({ actor: user(sub.user.id), workspaceId: elite.id, email: "Viewer@Elite.test", displayName: "Viewer" });
      expect(result.invitationUrl).toContain("/login?invite=");
      expect(result.team.members.map((member) => [member.email, member.roleName])).toEqual([
        ["sub@elite.test", "Organisation admin"],
        ["viewer@elite.test", "Viewer"]
      ]);
      const viewer = metadata.users.findByEmail({ email: "viewer@elite.test" })!;
      const viewerAccess = resolveEnergyAccessContext({ metadataStore: metadata, user: viewer, env: {} });
      expect(viewerAccess.role).toBe("user");
      expect(viewerAccess.workspaces.map((workspace) => workspace.id)).toEqual([elite.id]);
      expect(viewerAccess.workspaces.map((workspace) => workspace.id)).not.toContain(other.id);
      expect(viewerAccess.team.canManagePeople).toBe(false);
    });
  });

  it("tells the Team page which roles are in use here and what each allows", async () => {
    await setup(async ({ admin, team, elite, sub, user }) => {
      const editor = admin.createRole({ actorUserId: "dev-user", name: "Facility editor", description: "Edits the setup", permissions: { reports: "write", facility: "write" } });
      await admin.inviteUser({ actorUserId: "dev-user", email: "ed@elite.test", organisationIds: [elite.id], role: "user", organisationRoles: { [elite.id]: editor.id } });
      admin.createRole({ actorUserId: "dev-user", name: "Unused role", permissions: { reports: "read" } });
      const roles = team.list({ actor: user(sub.user.id), workspaceId: elite.id }).roles;
      expect(roles.map((role) => [role.name, role.memberCount])).toEqual([["Viewer", 0], ["Facility editor", 1], ["Organisation admin", 1]]);
      expect(roles.find((role) => role.name === "Facility editor")?.permissions.facility).toBe("write");
    });
  });

  it("reports canManagePeople only for the Organisation where the role says so", async () => {
    await setup(async ({ metadata, elite, other, sub, user, admin }) => {
      const access = resolveEnergyAccessContext({ metadataStore: metadata, user: user(sub.user.id), requestedWorkspaceId: elite.id, env: {} });
      expect(access.role).toBe("user");
      expect(access.team.canManagePeople).toBe(true);
      // Same person, a plain Viewer at the second client: no power there.
      admin.updateUser({
        actorUserId: "dev-user", userId: sub.user.id, displayName: "Sub", organisationIds: [elite.id, other.id], role: "user", disabled: false
      });
      const atOther = resolveEnergyAccessContext({ metadataStore: metadata, user: user(sub.user.id), requestedWorkspaceId: other.id, env: {} });
      expect(atOther.team.canManagePeople).toBe(false);
      expect(atOther.permissions.people).toBe("none");
    });
  });

  it("refuses an Organisation manager acting on another Organisation", async () => {
    await setup(async ({ team, other, sub, user }) => {
      const actor = user(sub.user.id);
      expect(() => team.list({ actor, workspaceId: other.id })).toThrow(/cannot manage people/);
      await expect(team.invite({ actor, workspaceId: other.id, email: "x@other.test" })).rejects.toThrow(/cannot manage people/);
      expect(() => team.remove({ actor, workspaceId: other.id, userId: "anyone" })).toThrow(/cannot manage people/);
    });
  });

  it("lets People: read see the list but not change it, and Viewers see nothing", async () => {
    await setup(async ({ admin, team, elite, user }) => {
      const reader = admin.createRole({ actorUserId: "dev-user", name: "Team reader", permissions: { reports: "write", people: "read" } });
      const readerUser = await admin.inviteUser({ actorUserId: "dev-user", email: "r@elite.test", organisationIds: [elite.id], role: "user", organisationRoles: { [elite.id]: reader.id } });
      const viewer = await admin.inviteUser({ actorUserId: "dev-user", email: "v@elite.test", organisationIds: [elite.id], role: "user" });
      expect(team.list({ actor: user(readerUser.user.id), workspaceId: elite.id }).members.length).toBeGreaterThan(0);
      await expect(team.invite({ actor: user(readerUser.user.id), workspaceId: elite.id, email: "n@elite.test" })).rejects.toThrow(/cannot manage people/);
      expect(() => team.list({ actor: user(viewer.user.id), workspaceId: elite.id })).toThrow(/cannot manage people/);
    });
  });

  it("does not let a manager remove managers or themselves, or touch platform admins", async () => {
    await setup(async ({ metadata, team, elite, sub, user, invite }) => {
      const peer = await invite("peer@elite.test", [elite.id], { [elite.id]: ENERGYIQ_ORGANISATION_ADMIN_ROLE_ID });
      const actor = user(sub.user.id);
      expect(() => team.remove({ actor, workspaceId: elite.id, userId: peer.user.id })).toThrow(/platform administrator/);
      expect(() => team.remove({ actor, workspaceId: elite.id, userId: actor.id })).toThrow(/platform administrator/);
      const platformAdmin = metadata.users.createPasswordUser({ id: "pa", email: "pa@x.test" });
      metadata.energyIq.upsertUserRole({ user_id: platformAdmin.id, role: "admin" });
      await expect(team.invite({ actor, workspaceId: elite.id, email: "pa@x.test" })).rejects.toThrow(/platform-wide/);
    });
  });

  it("does not let a manager remove someone whose role can do more than theirs", async () => {
    await setup(async ({ admin, team, elite, user }) => {
      const teamOnly = admin.createRole({ actorUserId: "dev-user", name: "Team manager", permissions: { reports: "write", people: "write" } });
      const manager = await admin.inviteUser({ actorUserId: "dev-user", email: "tm@elite.test", organisationIds: [elite.id], role: "user", organisationRoles: { [elite.id]: teamOnly.id } });
      const editor = admin.createRole({ actorUserId: "dev-user", name: "Facility manager", permissions: { reports: "write", facility: "write" } });
      const editorUser = await admin.inviteUser({ actorUserId: "dev-user", email: "ed@elite.test", organisationIds: [elite.id], role: "user", organisationRoles: { [elite.id]: editor.id } });
      expect(() => team.remove({ actor: user(manager.user.id), workspaceId: elite.id, userId: editorUser.user.id })).toThrow(/platform administrator/);
      // The Team page also tells them so up front.
      expect(team.list({ actor: user(manager.user.id), workspaceId: elite.id }).members.find((member) => member.id === editorUser.user.id)?.canChange).toBe(false);
    });
  });

  it("removes a Viewer from this Organisation only, keeping their other access", async () => {
    await setup(async ({ metadata, team, elite, other, sub, user, invite }) => {
      const shared = await invite("shared@x.test", [elite.id, other.id]);
      const result = team.remove({ actor: user(sub.user.id), workspaceId: elite.id, userId: shared.user.id });
      expect(result.team.members.map((member) => member.email)).toEqual(["sub@elite.test"]);
      expect(metadata.workspaceMemberships.find({ workspace_id: other.id, user_id: shared.user.id })).toBeDefined();
    });
  });
});

describe("Roles", () => {
  it("lets a super admin create, rename and delete a role, with Viewer protected", async () => {
    await setup(async ({ admin }) => {
      const names = () => admin.listRoles().map((role) => role.name);
      expect(names()).toEqual(expect.arrayContaining(["Viewer", "Organisation admin"]));
      const created = admin.createRole({ actorUserId: "dev-user", name: "Facility manager", description: "Edits the facility", permissions: { reports: "write", facility: "write", bogus: "write", hours_rate: "admin" } });
      // Unknown areas are dropped and invalid levels grant nothing.
      expect(created.permissions).toEqual({ reports: "write", facility: "write", hours_rate: "none", notes: "none", live_connection: "none", people: "none" });
      expect(() => admin.createRole({ actorUserId: "dev-user", name: "facility MANAGER", permissions: {} })).toThrow(/already exists/);
      expect(admin.updateRole({ actorUserId: "dev-user", id: created.id, name: "Site editor", permissions: { reports: "read" } }).name).toBe("Site editor");
      expect(() => admin.updateRole({ actorUserId: "dev-user", id: ENERGYIQ_VIEWER_ROLE_ID, name: "X", permissions: {} })).toThrow(/Built-in/);
      expect(() => admin.deleteRole({ actorUserId: "dev-user", id: ENERGYIQ_VIEWER_ROLE_ID })).toThrow(/Built-in/);
      expect(admin.deleteRole({ actorUserId: "dev-user", id: created.id }).roles.map((role) => role.id)).not.toContain(created.id);
    });
  });

  it("will not delete a role someone still holds", async () => {
    await setup(async ({ admin }) => {
      expect(() => admin.deleteRole({ actorUserId: "dev-user", id: ENERGYIQ_ORGANISATION_ADMIN_ROLE_ID })).toThrow(/still holds/);
    });
  });

  it("keeps a person's role when an admin edits them without naming one, and can change it per Organisation", async () => {
    await setup(async ({ admin, elite, other, sub }) => {
      const kept = admin.updateUser({ actorUserId: "dev-user", userId: sub.user.id, displayName: "Sub", organisationIds: [elite.id], role: "user", disabled: false });
      expect(kept.organisationRoles[elite.id]?.roleName).toBe("Organisation admin");
      const changed = admin.updateUser({
        actorUserId: "dev-user", userId: sub.user.id, displayName: "Sub", organisationIds: [elite.id, other.id], role: "user", disabled: false,
        organisationRoles: { [elite.id]: ENERGYIQ_VIEWER_ROLE_ID }
      });
      expect(changed.organisationRoles[elite.id]?.roleName).toBe("Viewer");
      expect(changed.organisationRoles[other.id]?.roleName).toBe("Viewer");
      expect(() => admin.updateUser({
        actorUserId: "dev-user", userId: sub.user.id, displayName: "Sub", organisationIds: [elite.id], role: "user", disabled: false,
        organisationRoles: { [elite.id]: "role-missing" }
      })).toThrow(/no longer exists/);
    });
  });

  it("turns a role's areas into what the person can do on a project, per Organisation", async () => {
    await setup(async ({ metadata, admin, elite, other, user, invite }) => {
      publishProject(metadata, elite.id, "elite-site");
      publishProject(metadata, other.id, "other-site");
      const editor = admin.createRole({ actorUserId: "dev-user", name: "Facility manager", permissions: { reports: "write", facility: "write", hours_rate: "read", notes: "read" } });
      const person = await invite("ed@x.test", [elite.id, other.id], { [elite.id]: editor.id });
      const at = (workspaceId: string, projectId: string) => resolveEnergyProjectCapabilities({ metadataStore: metadata, userId: person.user.id, workspaceId, projectId });
      expect(at(elite.id, "elite-site")).toMatchObject({ editFacility: true, editHoursRate: false, editNotes: false, editConfiguration: true, readProjectInformation: true, createReport: true });
      // At the other client the same person is only a Viewer.
      expect(at(other.id, "other-site")).toMatchObject({ editFacility: false, editConfiguration: false, readProjectInformation: true, createReport: true });
      // And a Viewer never gets skills, automation or publishing.
      expect(at(elite.id, "elite-site")).toMatchObject({ manageSkills: false, manageAutomation: false, publishConfiguration: false });
      expect(user(person.user.id).disabled_at).toBeUndefined();
    });
  });

  it("gives a role with no reports access no reading at all", async () => {
    await setup(async ({ metadata, admin, elite, invite }) => {
      publishProject(metadata, elite.id, "elite-site");
      const hollow = admin.createRole({ actorUserId: "dev-user", name: "Nothing", permissions: {} });
      const person = await invite("none@x.test", [elite.id], { [elite.id]: hollow.id });
      expect(resolveEnergyProjectCapabilities({ metadataStore: metadata, userId: person.user.id, workspaceId: elite.id, projectId: "elite-site" }))
        .toMatchObject({ readReports: false, readProjectInformation: false, createReport: false, editConfiguration: false });
    });
  });

  it("converts the earlier Organisation-admin flag into roles when the database is upgraded", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-role-migration-"));
    const databasePath = join(root, "metadata.sqlite");
    try {
      const first = createMetadataStore({ database_path: databasePath });
      const { elite } = await build(first);
      const flagged = first.users.createPasswordUser({ id: "flagged", email: "flagged@x.test" });
      const unflagged = first.users.createPasswordUser({ id: "unflagged", email: "unflagged@x.test" });
      first.db.exec("UPDATE workspace_memberships SET role_id = NULL");
      for (const [user, permissions] of [[flagged, '{"managePeople":true}'], [unflagged, '{"managePeople":false}']] as const) {
        first.db.prepare("INSERT INTO workspace_memberships (workspace_id, user_id, role, permissions_json, created_at) VALUES (?, ?, 'org_admin', ?, ?)")
          .run(elite.id, user.id, permissions, new Date().toISOString());
      }
      first.db.exec("DELETE FROM schema_migrations WHERE id LIKE '0048%'");
      first.close();
      const second = createMetadataStore({ database_path: databasePath });
      expect(second.workspaceMemberships.find({ workspace_id: elite.id, user_id: "flagged" })).toMatchObject({ role: "member", role_id: ENERGYIQ_ORGANISATION_ADMIN_ROLE_ID });
      const plain = second.workspaceMemberships.find({ workspace_id: elite.id, user_id: "unflagged" });
      expect(plain?.role).toBe("member");
      expect(plain?.role_id).toBeUndefined();
      second.close();
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

describe("Organisation admin runs the client", () => {
  it("can set up the facility, upload data, change hours and rate, edit notes, connect meters and manage people", async () => {
    await setup(async ({ metadata, elite, sub }) => {
      publishProject(metadata, elite.id, "elite-site");
      expect(resolveEnergyProjectCapabilities({ metadataStore: metadata, userId: sub.user.id, workspaceId: elite.id, projectId: "elite-site" })).toMatchObject({
        editFacility: true, editHoursRate: true, editNotes: true, manageLiveConnection: true, editConfiguration: true,
        // Skills, automatic reports and super-admin tools are still not theirs.
        manageSkills: false, manageAutomation: false, publishConfiguration: false
      });
    });
  });

  it("gives a Viewer no live connection", async () => {
    await setup(async ({ metadata, elite, invite }) => {
      publishProject(metadata, elite.id, "elite-site");
      const viewer = await invite("v@elite.test", [elite.id]);
      expect(resolveEnergyProjectCapabilities({ metadataStore: metadata, userId: viewer.user.id, workspaceId: elite.id, projectId: "elite-site" }))
        .toMatchObject({ manageLiveConnection: false, editFacility: false });
    });
  });

  it("upgrades an unedited first-version Organisation admin role, and leaves an edited one alone", async () => {
    for (const edited of [false, true]) {
      const root = mkdtempSync(join(tmpdir(), "energy-role-upgrade-"));
      const databasePath = join(root, "metadata.sqlite");
      try {
        const first = createMetadataStore({ database_path: databasePath });
        const firstSeed = JSON.stringify(edited
          ? { reports: "write", facility: "read", hours_rate: "read", notes: "none", people: "write" }
          : { reports: "write", facility: "read", hours_rate: "read", notes: "read", people: "write" });
        first.db.prepare("UPDATE energyiq_access_roles SET permissions_json = ? WHERE id = ?").run(firstSeed, ENERGYIQ_ORGANISATION_ADMIN_ROLE_ID);
        first.db.exec("DELETE FROM schema_migrations WHERE id LIKE '0049%'");
        first.close();
        const second = createMetadataStore({ database_path: databasePath });
        const role = second.energyIq.roles.require(ENERGYIQ_ORGANISATION_ADMIN_ROLE_ID);
        if (edited) expect(role.permissions).toMatchObject({ notes: "none", live_connection: "none" });
        else expect(role.permissions).toEqual({ reports: "write", facility: "write", hours_rate: "write", notes: "write", live_connection: "write", people: "write" });
        second.close();
      } finally {
        rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    }
  });
});
