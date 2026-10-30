import { createMetadataStore, ENERGYIQ_ORGANISATION_ADMIN_ROLE_ID } from "@datafoundry/metadata";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportJWK, generateKeyPair, SignJWT, type JWK, type JWTPayload } from "jose";
import { describe, expect, it } from "vitest";

import { ensureEnergyIqBootstrap } from "../energy/energy-bootstrap.js";
import { EnergyAdminAccessService } from "../energy/energy-admin-access.js";
import { OidcClient, OidcError } from "./oidc.js";
import { OrganisationSsoService, SsoSignInError } from "./organisation-sso.js";
import type { OutboundHttpClient, OutboundHttpRequest } from "./safe-http.js";
import { AuthService } from "./service.js";
import { createOrganisationIdentityRoutes, SSO_BROWSER_COOKIE } from "./sso-routes.js";

const authConfig = {
  mode: "password" as const,
  publicBaseUrl: "https://energyx.example.test",
  sessionSecret: "test-secret-that-is-longer-than-thirty-two-characters",
  emailDelivery: "test" as const
};
const DEFAULT_ISSUER = "https://idp.example.test/tenant-1";
const ISSUER = DEFAULT_ISSUER;
const CLIENT_ID = "energyx-client";
const CLIENT_SECRET = "client-secret-value-42";

type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>;

/** A small OpenID provider: discovery, keys and a token endpoint that checks PKCE and the client secret. */
const createFakeIssuer = async (ISSUER = DEFAULT_ISSUER) => {
  const signing = await generateKeyPair("RS256", { extractable: true });
  const publicJwk: JWK = { ...(await exportJWK(signing.publicKey)), kid: "key-1", alg: "RS256", use: "sig" };
  const codes = new Map<string, { nonce: string; challenge: string; email: string; claims: Partial<JWTPayload>; key?: KeyPair }>();
  const requests: OutboundHttpRequest[] = [];
  const json = (status: number, body: unknown) => ({ status, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  const signIdToken = async (claims: JWTPayload, key: KeyPair = signing, kid = "key-1") =>
    new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid }).sign(key.privateKey);

  const http: OutboundHttpClient = async (request) => {
    requests.push(request);
    if (request.url === `${ISSUER}/.well-known/openid-configuration`) {
      return json(200, {
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/token`,
        jwks_uri: `${ISSUER}/keys`,
        token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"]
      });
    }
    if (request.url === `${ISSUER}/keys`) return json(200, { keys: [publicJwk] });
    if (request.url === `${ISSUER}/token` && request.method === "POST") {
      const form = new URLSearchParams(request.body);
      const grant = codes.get(form.get("code") ?? "");
      const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
      if (!grant || request.headers?.Authorization !== `Basic ${basic}`) return json(400, { error: "invalid_client" });
      const challenge = createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
      if (challenge !== grant.challenge) return json(400, { error: "invalid_grant" });
      codes.delete(form.get("code") ?? "");
      const now = Math.floor(Date.now() / 1000);
      const idToken = await signIdToken({
        iss: ISSUER, aud: CLIENT_ID, sub: `sub-${grant.email}`, iat: now, exp: now + 300,
        nonce: grant.nonce, email: grant.email, email_verified: true, name: "Sam Signer",
        ...grant.claims
      }, grant.key);
      return json(200, { id_token: idToken, access_token: "opaque", token_type: "Bearer" });
    }
    return json(404, { error: "not_found" });
  };

  /** The person signs in at the provider, which sends the browser back with a code. */
  const authorize = (redirectUrl: string, email: string, claims: Partial<JWTPayload> = {}, key?: KeyPair) => {
    const url = new URL(redirectUrl);
    const code = `code-${codes.size}-${Math.random().toString(36).slice(2)}`;
    codes.set(code, {
      nonce: url.searchParams.get("nonce") ?? "",
      challenge: url.searchParams.get("code_challenge") ?? "",
      email,
      claims,
      ...(key ? { key } : {})
    });
    return { code, state: url.searchParams.get("state") ?? "" };
  };

  return { http, authorize, signIdToken, publicJwk, requests };
};

const setup = async (run: (ctx: Awaited<ReturnType<typeof build>>) => Promise<void>) => {
  const root = mkdtempSync(join(tmpdir(), "organisation-sso-"));
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite"), secret_master_key: "test-master-key" });
  try {
    await run(await build(metadata));
  } finally {
    metadata.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};

const build = async (metadata: ReturnType<typeof createMetadataStore>) => {
  ensureEnergyIqBootstrap(metadata);
  const issuer = await createFakeIssuer();
  const auth = new AuthService(metadata, authConfig);
  const admin = new EnergyAdminAccessService(metadata, auth);
  const sso = new OrganisationSsoService({ metadataStore: metadata, authService: auth, authConfig, http: issuer.http, env: {} });
  const acme = admin.createOrganisation({ actorUserId: "dev-user", name: "Acme" });
  const other = admin.createOrganisation({ actorUserId: "dev-user", name: "Other Client" });
  const superAdmin = metadata.users.getById({ user_id: "dev-user" });
  const addMember = async (email: string, organisationIds: string[], password?: string) => {
    const invited = await admin.inviteUser({ actorUserId: "dev-user", email, organisationIds, role: "user" });
    if (password) {
      const token = new URL(invited.invitationUrl ?? "").searchParams.get("invite") ?? "";
      await auth.acceptInvitation({ token, password });
    }
    return metadata.users.getById({ user_id: invited.user.id });
  };
  const configure = (overrides: Partial<Parameters<OrganisationSsoService["saveSso"]>[2]> = {}) =>
    sso.saveSso(superAdmin, acme.id, {
      enabled: true, issuer: ISSUER, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, domains: ["acme.test"],
      requireSso: false, autoCreateAccounts: false, ...overrides
    });
  const signIn = async (email: string, claims: Partial<JWTPayload> = {}, options: { returnTo?: string } = {}) => {
    const started = await sso.start({ email, ...(options.returnTo ? { returnTo: options.returnTo } : {}) });
    const { code, state } = issuer.authorize(started.redirectUrl, email, claims);
    return sso.complete({ code, state, browserBinding: started.browserBinding });
  };
  const events = (type: string) => metadata.authAuditEvents.list({ eventTypes: [type] }).events;
  return { metadata, issuer, auth, admin, sso, acme, other, superAdmin, addMember, configure, signIn, events };
};

const expectSignInError = async (promise: Promise<unknown>, code: string) => {
  const error = await promise.then(() => undefined, (reason: unknown) => reason);
  expect(error).toBeInstanceOf(SsoSignInError);
  expect((error as SsoSignInError).code).toBe(code);
};

describe("Organisation single sign-on (OpenID Connect)", () => {
  it("signs a member in with the authorization code flow, PKCE, state and nonce, and gives a normal session", async () => {
    await setup(async ({ metadata, auth, sso, acme, addMember, configure, issuer, events }) => {
      const member = await addMember("sam@acme.test", [acme.id]);
      await configure();

      const started = await sso.start({ email: "Sam@Acme.test", returnTo: "/energyiq/team" });
      const redirect = new URL(started.redirectUrl);
      expect(`${redirect.origin}${redirect.pathname}`).toBe(`${ISSUER}/authorize`);
      expect(Object.fromEntries(redirect.searchParams)).toMatchObject({
        response_type: "code",
        client_id: CLIENT_ID,
        redirect_uri: "https://energyx.example.test/api/v1/auth/sso/callback",
        scope: "openid email profile",
        code_challenge_method: "S256",
        login_hint: "sam@acme.test"
      });
      expect(redirect.searchParams.get("state")).toHaveLength(43);
      expect(redirect.searchParams.get("nonce")).toHaveLength(43);
      // Nothing secret is kept in the clear: the state, nonce and browser binding are stored only as hashes.
      const stored = metadata.db.prepare("SELECT * FROM organisation_sso_login_states").all() as Array<Record<string, string>>;
      expect(stored).toHaveLength(1);
      expect(JSON.stringify(stored)).not.toContain(redirect.searchParams.get("state"));
      expect(JSON.stringify(stored)).not.toContain(redirect.searchParams.get("nonce"));
      expect(JSON.stringify(stored)).not.toContain(started.browserBinding);

      const { code, state } = issuer.authorize(started.redirectUrl, "sam@acme.test");
      const result = await sso.complete({ code, state, browserBinding: started.browserBinding, ipAddress: "203.0.113.9" });

      expect(result.returnTo).toBe("/energyiq/team");
      expect(result.session.user.id).toBe(member.id);
      expect(auth.authenticateSession(result.session.sessionToken).user.id).toBe(member.id);
      expect(metadata.users.getById({ user_id: member.id }).email_verified_at).toBeTruthy();
      expect(events("auth.sso_login_succeeded")).toHaveLength(1);
      expect(events("auth.session_created").some((event) => event.user_id === member.id)).toBe(true);

      // The state works once: a replayed callback is refused.
      await expectSignInError(sso.complete({ code, state, browserBinding: started.browserBinding }), "expired");
    });
  });

  it("refuses a callback from a different browser than the one that started the sign-in", async () => {
    await setup(async ({ sso, acme, addMember, configure, issuer, events }) => {
      await addMember("sam@acme.test", [acme.id]);
      await configure();
      const started = await sso.start({ email: "sam@acme.test" });
      const { code, state } = issuer.authorize(started.redirectUrl, "sam@acme.test");
      await expectSignInError(sso.complete({ code, state, browserBinding: "someone-elses-cookie" }), "browser_mismatch");
      await expectSignInError(sso.complete({ code, state }), "expired");
      expect(events("auth.sso_login_failed").map((event) => JSON.parse(event.metadata_json ?? "{}").reason))
        .toEqual(["expired", "browser_mismatch"]);
    });
  });

  it.each([
    ["the wrong audience", { aud: "another-app" }],
    ["the wrong issuer", { iss: "https://evil.example.test" }],
    ["a nonce from another sign-in", { nonce: "not-the-nonce" }],
    ["an expired token", { exp: Math.floor(Date.now() / 1000) - 600, iat: Math.floor(Date.now() / 1000) - 900 }],
    ["an unverified email address", { email_verified: false }],
    ["no email address", { email: undefined }]
  ])("refuses an ID token with %s", async (_label, claims) => {
    await setup(async ({ metadata, acme, addMember, configure, signIn, events }) => {
      const member = await addMember("sam@acme.test", [acme.id]);
      await configure();
      await expectSignInError(signIn("sam@acme.test", claims), "failed");
      expect(metadata.authSessions.listByUser({ user_id: member.id })).toHaveLength(0);
      expect(events("auth.sso_login_failed")).toHaveLength(1);
    });
  });

  it("refuses an ID token signed with a key the provider never published", async () => {
    await setup(async ({ sso, acme, addMember, configure, issuer }) => {
      await addMember("sam@acme.test", [acme.id]);
      await configure();
      const attacker = await generateKeyPair("RS256", { extractable: true });
      const started = await sso.start({ email: "sam@acme.test" });
      const { code, state } = issuer.authorize(started.redirectUrl, "sam@acme.test", {}, attacker);
      await expectSignInError(sso.complete({ code, state, browserBinding: started.browserBinding }), "failed");
    });
  });

  it("names each ID-token failure precisely", async () => {
    const issuer = await createFakeIssuer();
    const oidc = new OidcClient(issuer.http);
    const discovery = await oidc.discover(ISSUER);
    const hashNonce = (nonce: string) => createHash("sha256").update(nonce).digest("base64url");
    const now = Math.floor(Date.now() / 1000);
    const base = { iss: ISSUER, aud: CLIENT_ID, sub: "s", iat: now, exp: now + 300, nonce: "n-1", email: "a@acme.test", email_verified: true };
    const reasonFor = async (claims: JWTPayload, options: { kid?: string } = {}) => {
      const token = await issuer.signIdToken(claims, undefined, options.kid);
      return oidc.verifyIdToken(discovery, token, { clientId: CLIENT_ID, expectedNonceHash: hashNonce("n-1"), hashNonce })
        .then(() => "ok", (error: unknown) => (error as OidcError).reason);
    };
    expect(await reasonFor(base)).toBe("ok");
    expect(await reasonFor({ ...base, aud: "other" })).toBe("wrong_audience");
    expect(await reasonFor({ ...base, aud: [CLIENT_ID, "other"] })).toBe("wrong_audience"); // several audiences need azp
    expect(await reasonFor({ ...base, aud: [CLIENT_ID, "other"], azp: CLIENT_ID })).toBe("ok");
    expect(await reasonFor({ ...base, iss: "https://idp.example.test/other" })).toBe("wrong_issuer");
    expect(await reasonFor({ ...base, nonce: "n-2" })).toBe("nonce_mismatch");
    expect(await reasonFor({ ...base, exp: now - 120 })).toBe("expired");
    expect(await reasonFor({ ...base, iat: now + 3600, exp: now + 7200 })).toBe("expired");
    expect(await reasonFor({ ...base, email_verified: false })).toBe("email_unverified");
    expect(await reasonFor({ ...base, email_verified: undefined, xms_edov: true })).toBe("ok"); // Entra ID's verified-domain claim
    expect(await reasonFor({ ...base, email: undefined })).toBe("email_missing");
    expect(await reasonFor(base, { kid: "unknown-key" })).toBe("bad_signature");
  });

  it("only signs in people who belong to that Organisation alone and are not EnergyX super admins", async () => {
    await setup(async ({ metadata, acme, other, addMember, configure, signIn }) => {
      await configure();
      await addMember("both@acme.test", [acme.id, other.id]);
      await addMember("elsewhere@acme.test", [other.id]);
      const boss = await addMember("boss@acme.test", [acme.id]);
      metadata.energyIq.upsertUserRole({ user_id: boss.id, role: "admin" });

      await expectSignInError(signIn("nobody@acme.test"), "not_member");
      await expectSignInError(signIn("elsewhere@acme.test"), "not_member");
      // Another client's data must never open through this client's identity provider.
      await expectSignInError(signIn("both@acme.test"), "use_password");
      await expectSignInError(signIn("boss@acme.test"), "use_password");
    });
  });

  it("refuses an identity provider asserting an email outside the Organisation's domains", async () => {
    await setup(async ({ sso, acme, addMember, configure, issuer }) => {
      await addMember("sam@acme.test", [acme.id]);
      await configure();
      const started = await sso.start({ email: "sam@acme.test" });
      const { code, state } = issuer.authorize(started.redirectUrl, "victim@other.test");
      await expectSignInError(sso.complete({ code, state, browserBinding: started.browserBinding }), "wrong_domain");
    });
  });

  it("creates the account on first sign-in only when the Organisation allows it, as a Viewer of that Organisation only", async () => {
    await setup(async ({ metadata, acme, configure, signIn, events }) => {
      await configure({ autoCreateAccounts: true });
      const result = await signIn("new.person@acme.test");
      const user = metadata.users.getById({ user_id: result.session.user.id });
      expect(user.email).toBe("new.person@acme.test");
      expect(user.display_name).toBe("Sam Signer");
      const memberships = metadata.workspaceMemberships.listByUser({ user_id: user.id })
        .filter((membership) => metadata.workspaces.get({ id: membership.workspace_id }).kind === "customer");
      expect(memberships.map((membership) => [membership.workspace_id, membership.role, membership.role_id ?? null]))
        .toEqual([[acme.id, "member", null]]);
      expect(metadata.energyIq.findUserRole(user.id)?.role).toBe("user");
      expect(events("auth.sso_account_created")).toHaveLength(1);
    });
  });

  it("tells people whose domain has no single sign-on to use their password", async () => {
    await setup(async ({ sso, configure }) => {
      await configure();
      await expect(sso.start({ email: "someone@unknown.test" })).rejects.toMatchObject({ status: 404 });
      await configure({ enabled: false });
      await expect(sso.start({ email: "sam@acme.test" })).rejects.toMatchObject({ status: 404 });
    });
  });
});

describe("Google Workspace", () => {
  it("accepts only accounts the organisation's Google Workspace manages, not personal Google accounts", async () => {
    await setup(async ({ metadata, auth, acme, addMember, superAdmin }) => {
      const google = await createFakeIssuer("https://accounts.google.com");
      const sso = new OrganisationSsoService({ metadataStore: metadata, authService: auth, authConfig, http: google.http, env: {} });
      await sso.saveSso(superAdmin, acme.id, {
        enabled: true, issuer: "https://accounts.google.com", clientId: CLIENT_ID, clientSecret: CLIENT_SECRET,
        domains: ["acme.test"], requireSso: false, autoCreateAccounts: false
      });
      const member = await addMember("sam@acme.test", [acme.id]);
      const signIn = async (claims: Partial<JWTPayload>) => {
        const started = await sso.start({ email: "sam@acme.test" });
        const { code, state } = google.authorize(started.redirectUrl, "sam@acme.test", claims);
        return sso.complete({ code, state, browserBinding: started.browserBinding });
      };
      await expectSignInError(signIn({}), "wrong_domain");
      await expectSignInError(signIn({ hd: "other.test" }), "wrong_domain");
      await expect(signIn({ hd: "acme.test" })).resolves.toMatchObject({ session: { user: { id: member.id } } });
    });
  });
});

describe("Require single sign-on", () => {
  it("refuses password sign-in, invitations and password resets for members, but not for super admins", async () => {
    await setup(async ({ metadata, auth, acme, other, addMember, configure, events, admin }) => {
      await addMember("sam@acme.test", [acme.id], "sam-password-1");
      await addMember("both@acme.test", [acme.id, other.id], "both-password-2");
      const boss = await addMember("boss@acme.test", [acme.id], "boss-password-3");
      metadata.energyIq.upsertUserRole({ user_id: boss.id, role: "admin" });
      const pending = await admin.inviteUser({ actorUserId: "dev-user", email: "pending@acme.test", organisationIds: [acme.id], role: "user" });
      const resetBefore = await (async () => {
        // A reset link sent before single sign-on was required must not work afterwards.
        const log: string[] = [];
        const original = console.log;
        console.log = (line: string) => { log.push(String(line)); };
        try { await auth.forgotPassword({ email: "sam@acme.test" }); } finally { console.log = original; }
        return new URL(log.find((line) => line.includes("password-reset link"))!.split(": ").at(-1)!).searchParams.get("reset")!;
      })();

      await configure({ requireSso: true });

      await expect(auth.login({ email: "sam@acme.test", password: "sam-password-1" })).rejects.toMatchObject({ status: 403, code: "SSO_REQUIRED" });
      await expect(auth.resetPassword({ token: resetBefore, password: "new-password" })).rejects.toMatchObject({ code: "SSO_REQUIRED" });
      const inviteToken = new URL(pending.invitationUrl ?? "").searchParams.get("invite") ?? "";
      await expect(auth.acceptInvitation({ token: inviteToken, password: "invited-password-9" })).rejects.toMatchObject({ code: "SSO_REQUIRED" });
      const logged: string[] = [];
      const original = console.log;
      console.log = (line: string) => { logged.push(String(line)); };
      try {
        await expect(auth.forgotPassword({ email: "sam@acme.test" })).resolves.toEqual({ ok: true });
      } finally {
        console.log = original;
      }
      expect(logged.some((line) => line.includes("password-reset link"))).toBe(false);
      expect(events("auth.password_refused_sso_required").length).toBeGreaterThanOrEqual(3);

      // Break-glass: EnergyX super admins always keep their password, though they still need two-step verification.
      await expect(auth.login({ email: "boss@acme.test", password: "boss-password-3", rememberMe: true })).resolves.toMatchObject({ twoStep: { mode: "enroll" } });
      // Someone who also belongs to another client cannot use this client's single sign-on, so keeps the password.
      await expect(auth.login({ email: "both@acme.test", password: "both-password-2", rememberMe: true })).resolves.toMatchObject({ persistent: true });

      await configure({ requireSso: false });
      await expect(auth.login({ email: "sam@acme.test", password: "sam-password-1", rememberMe: true })).resolves.toMatchObject({ persistent: true });
    });
  });
});

describe("Single sign-on settings", () => {
  it("lets the Organisation's own admins manage the settings, nobody else, and keeps the client secret encrypted", async () => {
    await setup(async ({ metadata, admin, sso, acme, other, events }) => {
      const orgAdmin = await admin.inviteUser({
        actorUserId: "dev-user", email: "it@acme.test", organisationIds: [acme.id], role: "user",
        organisationRoles: { [acme.id]: ENERGYIQ_ORGANISATION_ADMIN_ROLE_ID }
      });
      const viewer = await admin.inviteUser({ actorUserId: "dev-user", email: "viewer@acme.test", organisationIds: [acme.id], role: "user" });
      const outsider = await admin.inviteUser({
        actorUserId: "dev-user", email: "it@other.test", organisationIds: [other.id], role: "user",
        organisationRoles: { [other.id]: ENERGYIQ_ORGANISATION_ADMIN_ROLE_ID }
      });
      const user = (id: string) => metadata.users.getById({ user_id: id });
      const input = { enabled: true, issuer: `${ISSUER}/`, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, domains: ["@Acme.test"], requireSso: false, autoCreateAccounts: false };

      const saved = await sso.saveSso(user(orgAdmin.user.id), acme.id, input);
      expect(saved.sso).toMatchObject({ enabled: true, issuer: ISSUER, clientId: CLIENT_ID, hasClientSecret: true, domains: ["acme.test"] });
      expect(saved.redirectUri).toBe("https://energyx.example.test/api/v1/auth/sso/callback");
      expect(saved.scim.baseUrl).toBe("https://energyx.example.test/api/v1/scim/v2");
      expect(JSON.stringify(saved)).not.toContain(CLIENT_SECRET);
      const rows = JSON.stringify(metadata.db.prepare("SELECT * FROM encrypted_secrets").all())
        + JSON.stringify(metadata.db.prepare("SELECT * FROM organisation_sso_configs").all());
      expect(rows).not.toContain(CLIENT_SECRET);
      expect(events("energyiq.organisation_sso_changed")).toHaveLength(1);

      await expect(sso.saveSso(user(viewer.user.id), acme.id, input)).rejects.toMatchObject({ status: 403 });
      expect(() => sso.getSettings(user(outsider.user.id), acme.id)).toThrow(/cannot manage sign-in/u);
      await expect(sso.saveSso(user(outsider.user.id), other.id, { ...input, domains: ["acme.test"] }))
        .rejects.toMatchObject({ status: 409 });
      await expect(sso.saveSso(user(outsider.user.id), other.id, { ...input, domains: ["gmail.com"] }))
        .rejects.toMatchObject({ status: 400 });
      await expect(sso.saveSso(user(orgAdmin.user.id), acme.id, { ...input, enabled: false, requireSso: true }))
        .rejects.toMatchObject({ status: 400 });

      // Saving without a new secret keeps the one already stored.
      const { clientSecret: _unchanged, ...withoutSecret } = input;
      await sso.saveSso(user(orgAdmin.user.id), acme.id, { ...withoutSecret, autoCreateAccounts: true });
      expect(sso.getSettings(user(orgAdmin.user.id), acme.id).sso).toMatchObject({ hasClientSecret: true, autoCreateAccounts: true });
    });
  });

  it("tests the identity provider and refuses to switch on a connection it cannot reach", async () => {
    await setup(async ({ sso, acme, superAdmin }) => {
      await expect(sso.testSso(superAdmin, acme.id, { issuer: ISSUER })).resolves.toMatchObject({ ok: true, tokenEndpoint: `${ISSUER}/token` });
      await expect(sso.testSso(superAdmin, acme.id, { issuer: "https://idp.example.test/missing" })).resolves.toMatchObject({ ok: false });
      await expect(sso.testSso(superAdmin, acme.id, { issuer: "http://idp.example.test/tenant-1" })).resolves.toMatchObject({ ok: false });
      await expect(sso.saveSso(superAdmin, acme.id, {
        enabled: true, issuer: "https://idp.example.test/missing", clientId: CLIENT_ID, domains: ["acme.test"], requireSso: false, autoCreateAccounts: false
      })).rejects.toMatchObject({ status: 400 });
    });
  });
});

describe("Single sign-on over HTTP", () => {
  it("binds the sign-in to the browser with a cookie and ends with session cookies and a redirect into the app", async () => {
    await setup(async ({ metadata, auth, acme, addMember, issuer, superAdmin }) => {
      const member = await addMember("sam@acme.test", [acme.id]);
      const routes = createOrganisationIdentityRoutes({ metadataStore: metadata, authService: auth, authConfig, http: issuer.http, env: {} });
      await routes.sso.saveSso(superAdmin, acme.id, {
        enabled: true, issuer: ISSUER, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, domains: ["acme.test"], requireSso: false, autoCreateAccounts: false
      });
      const server = createServer((request, response) => {
        const url = new URL(request.url ?? "/", "http://localhost");
        void routes.handleBeforeSessionAuth(request, response, url).then((handled) => {
          if (!handled) { response.writeHead(404); response.end(); }
        });
      });
      const base = await listen(server);
      try {
        const started = await fetch(`${base}/api/v1/auth/sso/start`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "sam@acme.test", rememberMe: false })
        });
        expect(started.status).toBe(200);
        const bindingCookie = started.headers.getSetCookie().find((cookie) => cookie.startsWith(`${SSO_BROWSER_COOKIE}=`))!;
        expect(bindingCookie).toMatch(/HttpOnly/u);
        expect(bindingCookie).toMatch(/SameSite=Lax/u);
        expect(bindingCookie).toMatch(/Path=\/api\/v1\/auth\/sso/u);
        const { data } = await started.json() as { data: { redirectUrl: string } };
        const { code, state } = issuer.authorize(data.redirectUrl, "sam@acme.test");

        const callback = await fetch(`${base}/api/v1/auth/sso/callback?code=${code}&state=${state}`, {
          redirect: "manual", headers: { Cookie: bindingCookie.split(";")[0]! }
        });
        expect(callback.status).toBe(302);
        expect(callback.headers.get("location")).toBe("/energyiq/overview");
        const cookies = callback.headers.getSetCookie();
        const session = cookies.find((cookie) => cookie.startsWith("df_session="))!;
        expect(session).toMatch(/HttpOnly/u);
        expect(session).not.toMatch(/Max-Age/u); // "Remember me" was off: the cookie ends with the browser session
        expect(cookies.some((cookie) => cookie.startsWith("df_csrf="))).toBe(true);
        const token = decodeURIComponent(session.split(";")[0]!.slice("df_session=".length));
        expect(auth.authenticateSession(token).user.id).toBe(member.id);

        const failed = await fetch(`${base}/api/v1/auth/sso/callback?code=x&state=unknown`, { redirect: "manual" });
        expect(failed.status).toBe(302);
        expect(failed.headers.get("location")).toBe("/login?sso_error=expired");
        expect(failed.headers.getSetCookie().some((cookie) => cookie.startsWith("df_session="))).toBe(false);
      } finally {
        await new Promise((resolve) => server.close(resolve));
      }
    });
  });
});

const listen = (server: Server): Promise<string> => new Promise((resolve) => {
  server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
});
