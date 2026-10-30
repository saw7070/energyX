import { randomUUID } from "node:crypto";
import type { MetadataStore, OrganisationSsoConfigRecord, UserRecord, WorkspaceRecord } from "@datafoundry/metadata";

import { can, resolveEnergyPermissions } from "../energy/energy-permissions.js";
import type { PasswordAuthConfig } from "./config.js";
import { hashToken } from "./crypto.js";
import { createPkcePair, GOOGLE_ISSUER, normaliseIssuer, OidcClient, OidcError, randomUrlSafe } from "./oidc.js";
import { createGuardedHttpClient, type OutboundHttpClient } from "./safe-http.js";
import { AuthError, type AuthService } from "./service.js";
import {
  customerOrganisationIds,
  emailDomain,
  findSsoConnectionForEmail,
  isPlatformSuperAdmin,
  ssoEligibility
} from "./sso-policy.js";

/**
 * Organisation single sign-on and provisioning keys: the settings an Organisation's admins (people with
 * "People: write" there) and EnergyX super admins manage on the Team page, and the OpenID Connect sign-in itself.
 *
 * Sign-in: the person types their email, the domain leads to their Organisation's identity provider, and we send them
 * there with a fresh state, nonce and PKCE challenge, all remembered server-side for ten minutes and tied to the
 * browser by a cookie. On the way back the ID token is checked in full (see oidc.ts) and the person must be someone
 * that identity provider may sign in (see sso-policy.ts). They then get exactly the session a password sign-in gives.
 */
export type OrganisationSsoDependencies = {
  metadataStore: MetadataStore;
  authService: AuthService;
  authConfig: Pick<PasswordAuthConfig, "publicBaseUrl" | "sessionSecret">;
  http?: OutboundHttpClient;
  env?: Record<string, string | undefined>;
  now?: () => number;
};

export type OrganisationSignInSettingsDto = {
  organisation: { id: string; name: string };
  sso: {
    configured: boolean;
    enabled: boolean;
    issuer: string;
    clientId: string;
    hasClientSecret: boolean;
    domains: string[];
    requireSso: boolean;
    autoCreateAccounts: boolean;
    lastTest?: { at: string; ok: boolean; message?: string };
    /** People on these domains who also belong to another Organisation, and so keep signing in with a password. */
    keepPasswordCount: number;
  };
  /** What the identity provider must allow as the sign-in redirect (reply) address. */
  redirectUri: string;
  scim: {
    baseUrl: string;
    keys: Array<{ id: string; name: string; hint: string; createdAt: string; lastUsedAt?: string }>;
  };
};

export type SaveSsoInput = {
  enabled: boolean;
  issuer: string;
  clientId: string;
  /** A new client secret. Leave out to keep the one already saved. */
  clientSecret?: string;
  removeClientSecret?: boolean;
  domains: string[];
  requireSso: boolean;
  autoCreateAccounts: boolean;
};

export type SsoTestResult = {
  ok: boolean;
  message: string;
  issuer?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
};

/** Why a sign-in through the identity provider did not finish; `code` goes to /login?sso_error=. */
export class SsoSignInError extends Error {
  constructor(readonly code: SsoSignInErrorCode, message: string) {
    super(message);
    this.name = "SsoSignInError";
  }
}

export type SsoSignInErrorCode =
  | "expired" | "browser_mismatch" | "provider" | "not_available" | "failed" | "wrong_domain"
  | "not_member" | "disabled" | "use_password" | "rate_limited";

export const SSO_CALLBACK_PATH = "/api/v1/auth/sso/callback";
export const SCIM_BASE_PATH = "/api/v1/scim/v2";
const SSO_SECRET_OWNER_KIND = "organisation-sso";
const LOGIN_STATE_TTL_MS = 10 * 60 * 1000;
const MAX_DOMAINS = 20;
const MAX_ACTIVE_KEYS = 10;
const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u;
/** Shared mailbox providers: nobody can own these, so no Organisation may claim them. */
const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "ymail.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "gmx.net", "mail.com",
  "yandex.com", "zoho.com", "qq.com", "163.com", "126.com"
]);

export class OrganisationSsoService {
  readonly oidc: OidcClient;
  private readonly metadataStore: MetadataStore;
  private readonly authService: AuthService;
  private readonly secret: string;
  private readonly publicBaseUrl: string;
  private readonly env: Record<string, string | undefined>;
  private readonly now: () => number;

  constructor(dependencies: OrganisationSsoDependencies) {
    this.metadataStore = dependencies.metadataStore;
    this.authService = dependencies.authService;
    // Only local development runs without a session secret; keyed hashes still separate each kind of value.
    this.secret = dependencies.authConfig.sessionSecret || "datafoundry-local-development-only";
    this.publicBaseUrl = dependencies.authConfig.publicBaseUrl.replace(/\/+$/u, "");
    this.env = dependencies.env ?? process.env;
    this.now = dependencies.now ?? Date.now;
    this.oidc = new OidcClient(dependencies.http ?? createGuardedHttpClient(), this.now);
  }

  /** Keyed hash for a value of one kind, so a state can never be replayed as a nonce or a provisioning key. */
  hash(kind: "sso-state" | "sso-binding" | "sso-nonce" | "scim-key", value: string): string {
    return hashToken(`${kind}:${value}`, this.secret);
  }

  redirectUri(origin?: string): string {
    return `${this.publicBaseUrl || origin || ""}${SSO_CALLBACK_PATH}`;
  }

  // --- Settings -------------------------------------------------------------------------------------------------

  getSettings(actor: UserRecord, workspaceId: string, origin?: string): OrganisationSignInSettingsDto {
    return this.settingsDto(this.requireOrganisationAdmin(actor, workspaceId), origin);
  }

  async saveSso(actor: UserRecord, workspaceId: string, input: SaveSsoInput, origin?: string): Promise<OrganisationSignInSettingsDto> {
    const organisation = this.requireOrganisationAdmin(actor, workspaceId);
    const current = this.metadataStore.organisationIdentity.findSsoConfig(organisation.id);
    let issuer: string;
    try {
      issuer = normaliseIssuer(input.issuer);
    } catch (error) {
      throw new AuthError(400, "BAD_REQUEST", `Check the issuer URL: ${error instanceof Error ? error.message : "it is not valid."}`);
    }
    const clientId = input.clientId.trim();
    if (!clientId || clientId.length > 300) throw new AuthError(400, "BAD_REQUEST", "Enter the client ID (application ID) from your identity provider.");
    const domains = this.normaliseDomains(input.domains, organisation.id);
    if (input.requireSso && !input.enabled) {
      throw new AuthError(400, "BAD_REQUEST", "Switch single sign-on on before requiring it.");
    }
    if (input.enabled) {
      if (domains.length === 0) throw new AuthError(400, "BAD_REQUEST", "Add at least one email domain, such as example.com.");
      try {
        await this.oidc.discover(issuer, { fresh: true });
      } catch (error) {
        throw new AuthError(400, "BAD_REQUEST", `Single sign-on was not switched on. ${error instanceof Error ? error.message : ""}`.trim());
      }
    }
    const newSecret = input.clientSecret?.trim();
    let secretRef: string | null | undefined;
    let secretUserId: string | null | undefined;
    if (input.removeClientSecret && current?.client_secret_ref) {
      this.deleteClientSecret(current);
      secretRef = null;
      secretUserId = null;
    }
    if (newSecret) {
      const keep = !input.removeClientSecret && current?.client_secret_ref && current.secret_user_id;
      secretUserId = keep ? current.secret_user_id! : actor.id;
      try {
        secretRef = this.metadataStore.secrets.put({
          workspace_id: organisation.id,
          user_id: secretUserId,
          owner_kind: SSO_SECRET_OWNER_KIND,
          owner_id: organisation.id,
          value: { clientSecret: newSecret },
          ...(keep ? { secret_ref: current.client_secret_ref! } : {})
        });
      } catch (error) {
        if (error instanceof Error && error.message === "SECRET_MASTER_KEY_REQUIRED") {
          throw new AuthError(400, "BAD_REQUEST",
            "The client secret cannot be stored yet: whoever runs EnergyX needs to set SECRET_MASTER_KEY on the server.");
        }
        throw error;
      }
    }
    this.metadataStore.organisationIdentity.saveSsoConfig({
      workspace_id: organisation.id,
      enabled: input.enabled,
      issuer,
      client_id: clientId,
      ...(secretRef !== undefined ? { client_secret_ref: secretRef } : {}),
      ...(secretUserId !== undefined ? { secret_user_id: secretUserId } : {}),
      require_sso: input.requireSso,
      auto_create_accounts: input.autoCreateAccounts,
      domains,
      updated_by: actor.id
    });
    this.audit("energyiq.organisation_sso_changed", actor, {
      organisationId: organisation.id,
      enabled: input.enabled,
      issuer,
      domains,
      requireSso: input.requireSso,
      autoCreateAccounts: input.autoCreateAccounts,
      clientSecretChanged: Boolean(newSecret) || Boolean(input.removeClientSecret)
    });
    return this.settingsDto(organisation, origin);
  }

  removeSso(actor: UserRecord, workspaceId: string, origin?: string): OrganisationSignInSettingsDto {
    const organisation = this.requireOrganisationAdmin(actor, workspaceId);
    const removed = this.metadataStore.organisationIdentity.deleteSsoConfig(organisation.id);
    if (removed) {
      this.deleteClientSecret(removed);
      this.audit("energyiq.organisation_sso_removed", actor, { organisationId: organisation.id, issuer: removed.issuer });
    }
    return this.settingsDto(organisation, origin);
  }

  /** Reads the provider's discovery document, for the issuer typed on the page or the one already saved. */
  async testSso(actor: UserRecord, workspaceId: string, input: { issuer?: string }): Promise<SsoTestResult> {
    const organisation = this.requireOrganisationAdmin(actor, workspaceId);
    const saved = this.metadataStore.organisationIdentity.findSsoConfig(organisation.id);
    const typed = input.issuer?.trim();
    if (!typed && !saved) throw new AuthError(400, "BAD_REQUEST", "Enter the issuer URL to test.");
    let result: SsoTestResult;
    let issuer = typed || saved!.issuer;
    try {
      issuer = normaliseIssuer(issuer);
      const discovery = await this.oidc.discover(issuer, { fresh: true });
      result = {
        ok: true,
        message: "EnergyX reached your identity provider and read its sign-in settings.",
        issuer: discovery.issuer,
        authorizationEndpoint: discovery.authorization_endpoint,
        tokenEndpoint: discovery.token_endpoint
      };
    } catch (error) {
      result = { ok: false, message: error instanceof OidcError ? error.message : "The identity provider could not be reached." };
    }
    if (saved && saved.issuer === issuer) {
      this.metadataStore.organisationIdentity.recordSsoTest({ workspace_id: organisation.id, ok: result.ok, message: result.message });
    }
    this.audit("energyiq.organisation_sso_tested", actor, { organisationId: organisation.id, issuer, ok: result.ok });
    return result;
  }

  createProvisioningKey(actor: UserRecord, workspaceId: string, name: string, origin?: string): {
    key: string;
    settings: OrganisationSignInSettingsDto;
  } {
    const organisation = this.requireOrganisationAdmin(actor, workspaceId);
    const label = name.replace(/\s+/gu, " ").trim().slice(0, 60);
    if (!label) throw new AuthError(400, "BAD_REQUEST", "Give the key a name, such as “Microsoft Entra ID”.");
    if (this.metadataStore.organisationIdentity.listScimTokens(organisation.id).length >= MAX_ACTIVE_KEYS) {
      throw new AuthError(409, "CONFLICT", `An Organisation can have at most ${MAX_ACTIVE_KEYS} provisioning keys. Revoke one first.`);
    }
    const key = `exs_${randomUrlSafe(32)}`;
    const record = this.metadataStore.organisationIdentity.createScimToken({
      id: randomUUID(),
      workspace_id: organisation.id,
      name: label,
      token_hash: this.hash("scim-key", key),
      token_hint: key.slice(-4),
      created_by: actor.id
    });
    this.audit("energyiq.organisation_provisioning_key_created", actor, { organisationId: organisation.id, keyId: record.id, name: label });
    return { key, settings: this.settingsDto(organisation, origin) };
  }

  revokeProvisioningKey(actor: UserRecord, workspaceId: string, keyId: string, origin?: string): OrganisationSignInSettingsDto {
    const organisation = this.requireOrganisationAdmin(actor, workspaceId);
    if (!this.metadataStore.organisationIdentity.revokeScimToken({ id: keyId, workspace_id: organisation.id })) {
      throw new AuthError(404, "RESOURCE_NOT_FOUND", "That provisioning key no longer exists.");
    }
    this.audit("energyiq.organisation_provisioning_key_revoked", actor, { organisationId: organisation.id, keyId });
    return this.settingsDto(organisation, origin);
  }

  // --- Sign-in --------------------------------------------------------------------------------------------------

  async start(input: {
    email: string;
    returnTo?: string | undefined;
    rememberMe?: boolean | undefined;
    ipAddress?: string | undefined;
    userAgent?: string | undefined;
  }): Promise<{ redirectUrl: string; browserBinding: string }> {
    const email = input.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(email)) throw new AuthError(400, "BAD_REQUEST", "Enter a valid email address.");
    this.checkRateLimit(`sso-start:ip:${input.ipAddress ?? "unknown"}`, 20, 60);
    this.checkRateLimit(`sso-start:email:${email}`, 10, 60);
    const connection = findSsoConnectionForEmail(this.metadataStore, email);
    if (!connection) {
      throw new AuthError(404, "RESOURCE_NOT_FOUND",
        "Single sign-on is not set up for this email address. Sign in with your email and password instead.");
    }
    let discovery;
    try {
      discovery = await this.oidc.discover(connection.config.issuer);
    } catch {
      throw new AuthError(502, "INTERNAL_ERROR", "Your organisation’s sign-in service could not be reached. Try again in a moment.");
    }
    const state = randomUrlSafe();
    const nonce = randomUrlSafe();
    const browserBinding = randomUrlSafe();
    const pkce = createPkcePair();
    const returnTo = safeReturnTo(input.returnTo);
    this.metadataStore.organisationIdentity.createLoginState({
      state_hash: this.hash("sso-state", state),
      workspace_id: connection.organisation.id,
      binding_hash: this.hash("sso-binding", browserBinding),
      nonce_hash: this.hash("sso-nonce", nonce),
      code_verifier: pkce.verifier,
      ...(returnTo ? { return_to: returnTo } : {}),
      remember_me: input.rememberMe !== false,
      expires_at: new Date(this.now() + LOGIN_STATE_TTL_MS).toISOString(),
      now: new Date(this.now()).toISOString()
    });
    this.authAudit("auth.sso_login_started", { email, ...meta(input), metadata: { organisationId: connection.organisation.id } });
    return {
      browserBinding,
      redirectUrl: this.oidc.authorizationUrl(discovery, {
        clientId: connection.config.client_id,
        redirectUri: this.redirectUri(),
        state,
        nonce,
        codeChallenge: pkce.challenge,
        loginHint: email
      })
    };
  }

  /** Finish the sign-in the identity provider sent back. Throws SsoSignInError with a plain sentence on any failure. */
  async complete(input: {
    code?: string | undefined;
    state?: string | undefined;
    error?: string | undefined;
    browserBinding?: string | undefined;
    ipAddress?: string | undefined;
    userAgent?: string | undefined;
  }): Promise<{ session: ReturnType<AuthService["createSingleSignOnSession"]>; returnTo?: string }> {
    let organisationId: string | undefined;
    let email: string | undefined;
    const fail = (code: SsoSignInErrorCode, message: string, detail?: string): never => {
      this.authAudit("auth.sso_login_failed", {
        ...(email ? { email } : {}),
        ...meta(input),
        metadata: { reason: code, ...(organisationId ? { organisationId } : {}), ...(detail ? { detail: detail.slice(0, 200) } : {}) }
      });
      throw new SsoSignInError(code, message);
    };
    try {
      this.checkRateLimit(`sso-callback:ip:${input.ipAddress ?? "unknown"}`, 30, 60);
    } catch {
      return fail("rate_limited", "Too many sign-in attempts. Wait a minute and try again.");
    }
    const state = input.state
      ? this.metadataStore.organisationIdentity.consumeLoginState(this.hash("sso-state", input.state), new Date(this.now()).toISOString())
      : undefined;
    if (!state) return fail("expired", "This sign-in has expired. Start again from the sign-in page.");
    organisationId = state.workspace_id;
    if (!input.browserBinding || this.hash("sso-binding", input.browserBinding) !== state.binding_hash) {
      return fail("browser_mismatch", "This sign-in was started in a different browser. Start again from the sign-in page.");
    }
    if (input.error || !input.code) {
      return fail("provider", "Your organisation’s sign-in service did not let you in.", input.error ?? "no code");
    }
    const config = this.metadataStore.organisationIdentity.findSsoConfig(state.workspace_id);
    if (!config?.enabled) return fail("not_available", "Single sign-on is no longer switched on for your organisation.");
    let identity;
    let discovery;
    try {
      discovery = await this.oidc.discover(config.issuer);
      const clientSecret = this.readClientSecret(config);
      const idToken = await this.oidc.exchangeCode(discovery, {
        clientId: config.client_id,
        ...(clientSecret ? { clientSecret } : {}),
        code: input.code,
        redirectUri: this.redirectUri(),
        codeVerifier: state.code_verifier
      });
      identity = await this.oidc.verifyIdToken(discovery, idToken, {
        clientId: config.client_id,
        expectedNonceHash: state.nonce_hash,
        hashNonce: (nonce) => this.hash("sso-nonce", nonce)
      });
    } catch (error) {
      return fail("failed", "We could not confirm your sign-in with your organisation. Try again, or ask your administrator.",
        error instanceof OidcError ? error.reason : error instanceof Error ? error.message : "unknown");
    }
    email = identity.email;
    if (!config.domains.includes(emailDomain(identity.email))) {
      return fail("wrong_domain", "That account’s email address is not one your organisation signs in with here.");
    }
    // With Google, only accounts the organisation's Google Workspace manages count, never personal Google accounts.
    if (discovery.issuer === GOOGLE_ISSUER && identity.hostedDomain !== emailDomain(identity.email)) {
      return fail("wrong_domain", "Sign in with the Google Workspace account your organisation manages.", "google_hosted_domain");
    }
    let user = this.metadataStore.users.findByEmail({ email: identity.email });
    if (!user) {
      if (!config.auto_create_accounts) {
        return fail("not_member", "Your organisation has not given you access to EnergyX yet. Ask your administrator to add you.");
      }
      user = this.createAccount(config, identity.email, identity.name);
    }
    const eligibility = ssoEligibility(this.metadataStore, user, config.workspace_id, this.env);
    if (!eligibility.ok) {
      switch (eligibility.reason) {
        case "disabled_account":
          return fail("disabled", "Your EnergyX account is switched off. Ask your administrator.");
        case "not_member":
          return fail("not_member", "Your organisation has not given you access to EnergyX yet. Ask your administrator to add you.");
        case "super_admin":
        case "other_organisations":
          return fail("use_password", "Your account is not managed by this organisation’s sign-in. Sign in with your email and password.",
            eligibility.reason);
        default:
          return fail("not_available", "Single sign-on is no longer switched on for your organisation.");
      }
    }
    if (!user.email_verified_at) user = this.metadataStore.users.markEmailVerified({ user_id: user.id });
    const session = this.authService.createSingleSignOnSession({
      user,
      persistent: state.remember_me,
      ...(input.ipAddress ? { ipAddress: input.ipAddress } : {}),
      ...(input.userAgent ? { userAgent: input.userAgent } : {})
    });
    this.authAudit("auth.sso_login_succeeded", {
      email: identity.email,
      ...meta(input),
      userId: user.id,
      metadata: { organisationId: config.workspace_id, subject: identity.subject }
    });
    return { session, ...(state.return_to ? { returnTo: state.return_to } : {}) };
  }

  // --- Internals ------------------------------------------------------------------------------------------------

  private createAccount(config: OrganisationSsoConfigRecord, email: string, name: string | undefined): UserRecord {
    const user = this.metadataStore.users.createPasswordUser({ id: randomUUID(), email, ...(name ? { display_name: name } : {}) });
    this.metadataStore.energyIq.upsertUserRole({ user_id: user.id, role: "user" });
    // A new person joins this Organisation only, as a Viewer.
    this.metadataStore.workspaceMemberships.upsert({ workspace_id: config.workspace_id, user_id: user.id, role: "member", role_id: null });
    this.authAudit("auth.sso_account_created", {
      email,
      userId: user.id,
      metadata: { organisationId: config.workspace_id, targetUserId: user.id }
    });
    return user;
  }

  private readClientSecret(config: OrganisationSsoConfigRecord): string | undefined {
    if (!config.client_secret_ref || !config.secret_user_id) return undefined;
    const value = this.metadataStore.secrets.get({
      ref: config.client_secret_ref,
      workspace_id: config.workspace_id,
      user_id: config.secret_user_id
    });
    return typeof value.clientSecret === "string" ? value.clientSecret : undefined;
  }

  private deleteClientSecret(config: OrganisationSsoConfigRecord): void {
    if (!config.client_secret_ref || !config.secret_user_id) return;
    this.metadataStore.secrets.delete({ ref: config.client_secret_ref, workspace_id: config.workspace_id, user_id: config.secret_user_id });
  }

  private normaliseDomains(values: string[], workspaceId: string): string[] {
    const domains = [...new Set(values.map((value) => value.trim().toLowerCase().replace(/^@/u, "")).filter(Boolean))];
    if (domains.length > MAX_DOMAINS) throw new AuthError(400, "BAD_REQUEST", `Use at most ${MAX_DOMAINS} email domains.`);
    for (const domain of domains) {
      if (!DOMAIN_PATTERN.test(domain)) throw new AuthError(400, "BAD_REQUEST", `“${domain.slice(0, 80)}” is not an email domain, such as example.com.`);
      if (PUBLIC_EMAIL_DOMAINS.has(domain)) {
        throw new AuthError(400, "BAD_REQUEST", `${domain} is a public email service, so it cannot be used for single sign-on.`);
      }
      const owner = this.metadataStore.organisationIdentity.domainOwner(domain);
      if (owner && owner !== workspaceId) throw new AuthError(409, "CONFLICT", `${domain} is already used by another Organisation.`);
    }
    return domains;
  }

  private requireOrganisationAdmin(actor: UserRecord, workspaceId: string): WorkspaceRecord {
    let organisation: WorkspaceRecord | undefined;
    try {
      organisation = this.metadataStore.workspaces.get({ id: workspaceId });
    } catch {
      organisation = undefined;
    }
    const allowed = organisation
      && !actor.disabled_at
      && organisation.kind === "customer"
      && !organisation.disabled_at
      && can(resolveEnergyPermissions(this.metadataStore, actor, organisation.id, this.env), "people", "write");
    // Same answer for "no such Organisation" and "not yours", so a caller cannot probe other clients.
    if (!allowed || !organisation) throw new AuthError(403, "FORBIDDEN", "You cannot manage sign-in for this Organisation.");
    return organisation;
  }

  private settingsDto(organisation: WorkspaceRecord, origin?: string): OrganisationSignInSettingsDto {
    const config = this.metadataStore.organisationIdentity.findSsoConfig(organisation.id);
    const base = this.publicBaseUrl || origin || "";
    return {
      organisation: { id: organisation.id, name: organisation.name },
      sso: {
        configured: Boolean(config),
        enabled: config?.enabled ?? false,
        issuer: config?.issuer ?? "",
        clientId: config?.client_id ?? "",
        hasClientSecret: Boolean(config?.client_secret_ref),
        domains: config?.domains ?? [],
        requireSso: config?.require_sso ?? false,
        autoCreateAccounts: config?.auto_create_accounts ?? false,
        ...(config?.last_test_at ? {
          lastTest: {
            at: config.last_test_at,
            ok: config.last_test_ok === true,
            ...(config.last_test_message ? { message: config.last_test_message } : {})
          }
        } : {}),
        keepPasswordCount: config ? this.keepPasswordCount(config) : 0
      },
      redirectUri: `${base}${SSO_CALLBACK_PATH}`,
      scim: {
        baseUrl: `${base}${SCIM_BASE_PATH}`,
        keys: this.metadataStore.organisationIdentity.listScimTokens(organisation.id).map((key) => ({
          id: key.id,
          name: key.name,
          hint: key.token_hint,
          createdAt: key.created_at,
          ...(key.last_used_at ? { lastUsedAt: key.last_used_at } : {})
        }))
      }
    };
  }

  private keepPasswordCount(config: OrganisationSsoConfigRecord): number {
    let count = 0;
    for (const membership of this.metadataStore.workspaceMemberships.listByWorkspace({ workspace_id: config.workspace_id })) {
      if (membership.role !== "member") continue;
      const user = this.metadataStore.users.getById({ user_id: membership.user_id });
      if (!user.email || !config.domains.includes(emailDomain(user.email))) continue;
      if (isPlatformSuperAdmin(this.metadataStore, user, this.env)) continue;
      if (customerOrganisationIds(this.metadataStore, user.id).length > 1) count += 1;
    }
    return count;
  }

  /** Same table and shape as the password sign-in limits, with its own buckets. */
  private checkRateLimit(bucket: string, limit: number, windowSeconds: number): void {
    const now = new Date(this.now());
    const db = this.metadataStore.db;
    const current = db.prepare("SELECT count, reset_at FROM auth_rate_limits WHERE bucket = ?").get(bucket) as
      { count: number; reset_at: string } | undefined;
    if (current && new Date(String(current.reset_at)).getTime() > now.getTime()) {
      if (Number(current.count) >= limit) throw new AuthError(429, "RATE_LIMITED", "Too many requests. Try again later.");
      db.prepare("UPDATE auth_rate_limits SET count = count + 1, updated_at = ? WHERE bucket = ?").run(now.toISOString(), bucket);
      return;
    }
    db.prepare(`
      INSERT INTO auth_rate_limits (bucket, count, reset_at, updated_at) VALUES (?, 1, ?, ?)
      ON CONFLICT(bucket) DO UPDATE SET count = 1, reset_at = excluded.reset_at, updated_at = excluded.updated_at
    `).run(bucket, new Date(now.getTime() + windowSeconds * 1000).toISOString(), now.toISOString());
  }

  private audit(eventType: string, actor: UserRecord, metadata: Record<string, unknown>): void {
    this.authAudit(eventType, { ...(actor.email ? { email: actor.email } : {}), userId: actor.id, metadata });
  }

  private authAudit(eventType: string, input: {
    email?: string | undefined;
    ipAddress?: string | undefined;
    userAgent?: string | undefined;
    userId?: string | undefined;
    metadata?: Record<string, unknown>;
  }): void {
    this.metadataStore.authAuditEvents.append({
      id: randomUUID(),
      event_type: eventType,
      ...(input.email ? { email: input.email } : {}),
      ...(input.ipAddress ? { ip_address: input.ipAddress } : {}),
      ...(input.userAgent ? { user_agent: input.userAgent.slice(0, 300) } : {}),
      ...(input.userId ? { user_id: input.userId } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {})
    });
  }
}

/** Only paths inside the app are allowed back, never another site. */
export const safeReturnTo = (value: string | undefined): string | undefined =>
  value && value.startsWith("/energyiq/") && !value.startsWith("//") && !value.includes("\\") && !/[\r\n]/u.test(value)
    ? value.slice(0, 500)
    : undefined;

const meta = (input: { ipAddress?: string | undefined; userAgent?: string | undefined }) => ({
  ...(input.ipAddress ? { ipAddress: input.ipAddress } : {}),
  ...(input.userAgent ? { userAgent: input.userAgent } : {})
});
