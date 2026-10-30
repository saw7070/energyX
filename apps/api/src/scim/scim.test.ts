import { createMetadataStore, ENERGYIQ_ORGANISATION_ADMIN_ROLE_ID } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { AuthService } from "../auth/service.js";
import { createOrganisationIdentityRoutes } from "../auth/sso-routes.js";
import { EnergyAdminAccessService } from "../energy/energy-admin-access.js";
import { ensureEnergyIqBootstrap } from "../energy/energy-bootstrap.js";
import { resolveEnergyPermissions } from "../energy/energy-permissions.js";

const authConfig = {
  mode: "password" as const,
  publicBaseUrl: "https://energyx.example.test",
  sessionSecret: "test-secret-that-is-longer-than-thirty-two-characters",
  emailDelivery: "test" as const
};
const SCIM_JSON = "application/scim+json";

const setup = async (run: (ctx: Awaited<ReturnType<typeof build>>) => Promise<void>) => {
  const root = mkdtempSync(join(tmpdir(), "scim-"));
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  const servers: Server[] = [];
  try {
    await run(await build(metadata, servers));
  } finally {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
    metadata.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};

const build = async (metadata: ReturnType<typeof createMetadataStore>, servers: Server[]) => {
  ensureEnergyIqBootstrap(metadata);
  const auth = new AuthService(metadata, authConfig);
  const admin = new EnergyAdminAccessService(metadata, auth);
  const routes = createOrganisationIdentityRoutes({ metadataStore: metadata, authService: auth, authConfig, env: {} });
  const acme = admin.createOrganisation({ actorUserId: "dev-user", name: "Acme" });
  const beta = admin.createOrganisation({ actorUserId: "dev-user", name: "Beta" });
  const superAdmin = metadata.users.getById({ user_id: "dev-user" });
  const acmeKey = routes.sso.createProvisioningKey(superAdmin, acme.id, "Microsoft Entra ID").key;
  const betaKey = routes.sso.createProvisioningKey(superAdmin, beta.id, "Okta").key;

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    void routes.handleBeforeSessionAuth(request, response, url).then((handled) => {
      if (!handled) { response.writeHead(404); response.end(); }
    });
  });
  servers.push(server);
  const base = await new Promise<string>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/scim/v2`));
  });
  const scim = async (key: string | undefined, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": SCIM_JSON }),
        ...headers
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: (text ? JSON.parse(text) : undefined) as Record<string, any> };
  };
  const newUser = (userName: string, extra: Record<string, unknown> = {}) => ({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    userName,
    name: { givenName: "Pat", familyName: "Lee" },
    emails: [{ value: userName, type: "work", primary: true }],
    active: true,
    externalId: `ext-${userName}`,
    ...extra
  });
  const customerOrganisations = (userId: string) => metadata.workspaces.listByUser({ user_id: userId })
    .filter((workspace) => workspace.kind === "customer").map((workspace) => workspace.id).sort();
  return { metadata, auth, admin, routes, acme, beta, superAdmin, acmeKey, betaKey, scim, newUser, customerOrganisations };
};

describe("SCIM 2.0 provisioning", () => {
  it("accepts only the Organisation's provisioning key, never a session, and answers in SCIM's error format", async () => {
    await setup(async ({ metadata, auth, routes, acme, superAdmin, acmeKey, scim }) => {
      const missing = await scim(undefined, "GET", "/Users");
      expect(missing.status).toBe(401);
      expect(missing.headers.get("content-type")).toContain(SCIM_JSON);
      expect(missing.body).toEqual({
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"], status: "401", detail: "A valid provisioning key is required."
      });
      expect((await scim("exs_not-a-real-key", "GET", "/Users")).status).toBe(401);
      // A signed-in browser's cookie is not a provisioning key.
      expect((await scim(undefined, "GET", "/Users", undefined, { Cookie: "df_session=anything" })).status).toBe(401);

      const config = await scim(acmeKey, "GET", "/ServiceProviderConfig");
      expect(config.status).toBe(200);
      expect(config.body).toMatchObject({ patch: { supported: true }, filter: { supported: true }, bulk: { supported: false } });
      expect((await scim(acmeKey, "GET", "/ResourceTypes")).body.Resources[0]).toMatchObject({ id: "User", endpoint: "/Users" });
      expect((await scim(acmeKey, "GET", "/Schemas")).body.Resources[0].id).toBe("urn:ietf:params:scim:schemas:core:2.0:User");
      expect(metadata.organisationIdentity.listScimTokens(acme.id)[0]?.last_used_at).toBeTruthy();

      // The key is stored only as a keyed hash, and no other part of the API accepts it.
      expect(JSON.stringify(metadata.db.prepare("SELECT * FROM organisation_scim_tokens").all())).not.toContain(acmeKey);
      expect(() => auth.authenticateSession(acmeKey)).toThrow(/Authentication required/u);
      expect(metadata.users.getByDevToken({ dev_token: acmeKey })).toBeUndefined();

      const keyId = metadata.organisationIdentity.listScimTokens(acme.id)[0]!.id;
      routes.sso.revokeProvisioningKey(superAdmin, acme.id, keyId);
      expect((await scim(acmeKey, "GET", "/Users")).status).toBe(401);
    });
  });

  it("creates, reads, filters, pages, replaces and patches people in the key's Organisation", async () => {
    await setup(async ({ metadata, acme, acmeKey, scim, newUser, customerOrganisations }) => {
      const created = await scim(acmeKey, "POST", "/Users", newUser("pat.lee@acme.test"));
      expect(created.status).toBe(201);
      const id = created.body.id as string;
      expect(created.headers.get("location")).toBe(`https://energyx.example.test/api/v1/scim/v2/Users/${id}`);
      expect(created.body).toMatchObject({
        userName: "pat.lee@acme.test",
        externalId: "ext-pat.lee@acme.test",
        displayName: "Pat Lee",
        active: true,
        emails: [{ value: "pat.lee@acme.test", type: "work", primary: true }],
        meta: { resourceType: "User" }
      });
      // A provisioned person joins this Organisation only, as a Viewer.
      expect(customerOrganisations(id)).toEqual([acme.id]);
      expect(metadata.workspaceMemberships.get({ workspace_id: acme.id, user_id: id }).role_id).toBeUndefined();
      expect(metadata.energyIq.findUserRole(id)?.role).toBe("user");

      const duplicate = await scim(acmeKey, "POST", "/Users", newUser("Pat.Lee@acme.test"));
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.scimType).toBe("uniqueness");

      for (const name of ["alex", "bo", "cy"]) await scim(acmeKey, "POST", "/Users", newUser(`${name}@acme.test`));
      const filtered = await scim(acmeKey, "GET", `/Users?filter=${encodeURIComponent('userName eq "PAT.LEE@acme.test"')}`);
      expect(filtered.body).toMatchObject({ totalResults: 1, itemsPerPage: 1, startIndex: 1 });
      expect(filtered.body.Resources[0].id).toBe(id);
      expect((await scim(acmeKey, "GET", `/Users?filter=${encodeURIComponent('userName eq "nobody@acme.test"')}`)).body)
        .toMatchObject({ totalResults: 0, Resources: [] });
      expect((await scim(acmeKey, "GET", `/Users?filter=${encodeURIComponent('externalId eq "ext-bo@acme.test"')}`)).body.totalResults).toBe(1);
      const page = await scim(acmeKey, "GET", "/Users?startIndex=2&count=2");
      expect(page.body).toMatchObject({ totalResults: 4, startIndex: 2, itemsPerPage: 2 });
      expect((await scim(acmeKey, "GET", `/Users?filter=${encodeURIComponent('title co "x"')}`)).body.scimType).toBe("invalidFilter");

      const patched = await scim(acmeKey, "PATCH", `/Users/${id}`, {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        Operations: [
          { op: "Replace", path: "displayName", value: "Patricia Lee" },
          { op: "replace", path: "title", value: "Ignored" }
        ]
      });
      expect(patched.status).toBe(200);
      expect(patched.body.displayName).toBe("Patricia Lee");
      expect(metadata.users.getById({ user_id: id }).display_name).toBe("Patricia Lee");
      const formatted = await scim(acmeKey, "PATCH", `/Users/${id}`, {
        Operations: [{ op: "replace", value: { "name.formatted": "Pat L." } }]
      });
      expect(formatted.body.displayName).toBe("Pat L.");

      const replaced = await scim(acmeKey, "PUT", `/Users/${id}`, { ...newUser("pat.lee@acme.test"), displayName: "P. Lee", externalId: "ext-2" });
      expect(replaced.body).toMatchObject({ displayName: "P. Lee", externalId: "ext-2", active: true });
      const renamed = await scim(acmeKey, "PUT", `/Users/${id}`, newUser("someone.else@acme.test"));
      expect(renamed.status).toBe(400);
      expect(renamed.body.scimType).toBe("mutability");
      expect((await scim(acmeKey, "GET", `/Users/${id}`)).body.userName).toBe("pat.lee@acme.test");
    });
  });

  it("switches a person off and on again (Entra sends \"False\" as text), keeping the role they had", async () => {
    await setup(async ({ metadata, auth, admin, acme, beta, acmeKey, scim }) => {
      const invited = await admin.inviteUser({
        actorUserId: "dev-user", email: "lead@acme.test", organisationIds: [acme.id], role: "user",
        organisationRoles: { [acme.id]: ENERGYIQ_ORGANISATION_ADMIN_ROLE_ID }
      });
      const token = new URL(invited.invitationUrl ?? "").searchParams.get("invite") ?? "";
      const session = await auth.acceptInvitation({ token, password: "invited-password-1" });
      if (!("sessionToken" in session)) throw new Error("Expected a signed-in session");
      const id = invited.user.id;

      const off = await scim(acmeKey, "PATCH", `/Users/${id}`, { Operations: [{ op: "Replace", path: "active", value: "False" }] });
      expect(off.status).toBe(200);
      expect(off.body.active).toBe(false);
      expect(metadata.workspaceMemberships.find({ workspace_id: acme.id, user_id: id })).toBeUndefined();
      // They belonged nowhere else, so the account is switched off and signed out.
      expect(metadata.users.getById({ user_id: id }).disabled_at).toBeTruthy();
      expect(() => auth.authenticateSession(session.sessionToken)).toThrow();
      expect((await scim(acmeKey, "GET", `/Users/${id}`)).body.active).toBe(false);

      const on = await scim(acmeKey, "PATCH", `/Users/${id}`, { Operations: [{ op: "replace", value: { active: true } }] });
      expect(on.body.active).toBe(true);
      expect(metadata.users.getById({ user_id: id }).disabled_at).toBeUndefined();
      expect(metadata.workspaceMemberships.get({ workspace_id: acme.id, user_id: id }).role_id).toBe(ENERGYIQ_ORGANISATION_ADMIN_ROLE_ID);
      expect(resolveEnergyPermissions(metadata, metadata.users.getById({ user_id: id }), acme.id, {}).people).toBe("write");

      // Someone who also belongs to Beta only loses Acme; their account stays on.
      metadata.workspaceMemberships.upsert({ workspace_id: beta.id, user_id: id, role: "member" });
      await scim(acmeKey, "PATCH", `/Users/${id}`, { Operations: [{ op: "replace", path: "active", value: false }] });
      expect(metadata.users.getById({ user_id: id }).disabled_at).toBeUndefined();
      expect(metadata.workspaceMemberships.find({ workspace_id: beta.id, user_id: id })).toBeTruthy();
    });
  });

  it("deletes by removing the membership, and disables the account only when no Organisation is left", async () => {
    await setup(async ({ metadata, beta, acmeKey, scim, newUser, customerOrganisations }) => {
      const solo = (await scim(acmeKey, "POST", "/Users", newUser("solo@acme.test"))).body.id as string;
      const shared = (await scim(acmeKey, "POST", "/Users", newUser("shared@acme.test"))).body.id as string;
      metadata.workspaceMemberships.upsert({ workspace_id: beta.id, user_id: shared, role: "member" });

      const removed = await scim(acmeKey, "DELETE", `/Users/${solo}`);
      expect(removed.status).toBe(204);
      expect(customerOrganisations(solo)).toEqual([]);
      expect(metadata.users.getById({ user_id: solo }).disabled_at).toBeTruthy();
      expect((await scim(acmeKey, "GET", `/Users/${solo}`)).status).toBe(404);

      expect((await scim(acmeKey, "DELETE", `/Users/${shared}`)).status).toBe(204);
      expect(customerOrganisations(shared)).toEqual([beta.id]);
      expect(metadata.users.getById({ user_id: shared }).disabled_at).toBeUndefined();
      expect(metadata.authAuditEvents.list({ eventTypes: ["energyiq.team_member_deprovisioned"] }).events).toHaveLength(2);
    });
  });

  it("confines each key to its own Organisation", async () => {
    await setup(async ({ metadata, acme, beta, acmeKey, betaKey, scim, newUser, customerOrganisations }) => {
      const acmePerson = (await scim(acmeKey, "POST", "/Users", newUser("pat@acme.test"))).body.id as string;

      expect((await scim(betaKey, "GET", `/Users/${acmePerson}`)).status).toBe(404);
      expect((await scim(betaKey, "PATCH", `/Users/${acmePerson}`, { Operations: [{ op: "replace", path: "active", value: false }] })).status).toBe(404);
      expect((await scim(betaKey, "PUT", `/Users/${acmePerson}`, newUser("pat@acme.test"))).status).toBe(404);
      expect((await scim(betaKey, "DELETE", `/Users/${acmePerson}`)).status).toBe(404);
      expect((await scim(betaKey, "GET", "/Users")).body.totalResults).toBe(0);
      expect((await scim(betaKey, "GET", `/Users?filter=${encodeURIComponent('userName eq "pat@acme.test"')}`)).body.totalResults).toBe(0);
      expect(metadata.users.getById({ user_id: acmePerson }).disabled_at).toBeUndefined();
      expect(customerOrganisations(acmePerson)).toEqual([acme.id]);

      // Beta provisioning the same person adds Beta only; Acme's membership is untouched.
      const added = await scim(betaKey, "POST", "/Users", newUser("pat@acme.test", { displayName: "Beta's name for Pat" }));
      expect(added.status).toBe(201);
      expect(added.body.id).toBe(acmePerson);
      expect(customerOrganisations(acmePerson)).toEqual([acme.id, beta.id].sort());
      // The shared profile name is not Beta's to change.
      expect(metadata.users.getById({ user_id: acmePerson }).display_name).toBe("Pat Lee");
      expect((await scim(acmeKey, "GET", `/Users/${acmePerson}`)).body.displayName).toBe("Pat Lee");
    });
  });

  it("never shows or changes EnergyX super admins", async () => {
    await setup(async ({ metadata, acme, acmeKey, scim, newUser }) => {
      metadata.workspaceMemberships.upsert({ workspace_id: acme.id, user_id: "dev-user", role: "member" });
      expect((await scim(acmeKey, "GET", "/Users")).body.totalResults).toBe(0);
      expect((await scim(acmeKey, "GET", "/Users/dev-user")).status).toBe(404);
      expect((await scim(acmeKey, "DELETE", "/Users/dev-user")).status).toBe(404);
      const created = await scim(acmeKey, "POST", "/Users", newUser("admin@energyiq.local"));
      expect(created.status).toBe(409);
      expect(metadata.users.getById({ user_id: "dev-user" }).disabled_at).toBeUndefined();
    });
  });
});
