import { randomUUID } from "node:crypto";
import type {
  AuthSessionRecord,
  MetadataStore,
  UserRecord,
  WorkspaceRecord
} from "@datafoundry/metadata";

import type { PasswordAuthConfig } from "./config.js";
import { AuthMailer } from "./mailer.js";
import { createSecretToken, hashPassword, hashToken, verifyPassword } from "./crypto.js";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
/** Sign-ins without "Remember me" end when the browser closes, or after this at the latest. */
const SHORT_SESSION_TTL_SECONDS = 60 * 60 * 12;
const ACCOUNT_INVITATION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const PASSWORD_RESET_TTL_MS = 1000 * 60 * 30;

export type AuthUserDto = {
  id: string;
  email?: string;
  displayName?: string;
  avatarUrl?: string;
};

export type AuthWorkspaceDto = {
  id: string;
  name?: string;
};

export type AuthIdentity = {
  session?: AuthSessionRecord;
  user: UserRecord;
  workspace: WorkspaceRecord;
};

export class AuthError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export class AuthService {
  private readonly mailer: AuthMailer;

  constructor(
    private readonly metadataStore: MetadataStore,
    private readonly config: PasswordAuthConfig
  ) {
    this.mailer = new AuthMailer(config);
  }

  async register(input: {
    displayName?: string | undefined;
    email: string;
    ipAddress?: string | undefined;
    password: string;
    userAgent?: string | undefined;
  }): Promise<{ user: AuthUserDto; workspace: AuthWorkspaceDto; verificationToken?: string }> {
    void input;
    throw new AuthError(403, "FORBIDDEN", "Public registration is closed. Ask an administrator for an invitation.");
  }

  async inviteUser(input: {
    displayName?: string | undefined;
    email: string;
    inviterUserId: string;
  }): Promise<{
    active: boolean;
    invitationUrl?: string;
    user: AuthUserDto;
  }> {
    const email = normalizeEmail(input.email);
    const existing = this.metadataStore.users.findByEmail({ email });
    if (existing?.disabled_at) {
      throw new AuthError(409, "CONFLICT", "The account is disabled. Enable it before adding access.");
    }
    if (existing?.email_verified_at && existing.password_updated_at) {
      return { active: true, user: userDto(existing) };
    }
    this.mailer.assertDeliveryConfigured();
    const user = existing ?? this.metadataStore.users.createPasswordUser({
      id: randomUUID(),
      email,
      ...(input.displayName ? { display_name: normalizeDisplayName(input.displayName) } : {})
    });
    if (input.displayName && existing) {
      this.metadataStore.users.updateDisplayName({
        user_id: user.id,
        display_name: normalizeDisplayName(input.displayName)
      });
    }
    this.metadataStore.authTokens.consumeOpenByUser({
      user_id: user.id,
      purpose: "account_invitation"
    });
    const invitationToken = createSecretToken();
    this.metadataStore.authTokens.create({
      id: randomUUID(),
      user_id: user.id,
      purpose: "account_invitation",
      token_hash: hashToken(invitationToken, this.config.sessionSecret),
      expires_at: new Date(Date.now() + ACCOUNT_INVITATION_TTL_MS).toISOString()
    });
    const mail = await this.mailer.sendInvitation({ email, token: invitationToken });
    this.audit(existing ? "auth.invitation_resent" : "auth.invitation_created", {
      email,
      metadata: { invitedUserId: user.id, inviterUserId: input.inviterUserId },
      userId: input.inviterUserId
    });
    return {
      active: false,
      user: userDto(this.metadataStore.users.getById({ user_id: user.id })),
      ...(mail.testUrl ? { invitationUrl: mail.testUrl } : {})
    };
  }

  async acceptInvitation(input: {
    displayName?: string | undefined;
    ipAddress?: string | undefined;
    password: string;
    token: string;
    userAgent?: string | undefined;
  }): Promise<{
    csrfToken: string;
    maxAgeSeconds: number;
    sessionToken: string;
    user: AuthUserDto;
    workspace: AuthWorkspaceDto;
  }> {
    assertPassword(input.password);
    const token = this.requireToken("account_invitation", input.token);
    let user = this.metadataStore.users.getById({ user_id: token.user_id });
    if (user.disabled_at) {
      throw new AuthError(403, "FORBIDDEN", "This account is disabled.");
    }
    if (input.displayName) {
      user = this.metadataStore.users.updateDisplayName({
        user_id: user.id,
        display_name: normalizeDisplayName(input.displayName)
      });
    }
    const password = await hashPassword(input.password);
    this.metadataStore.userPasswordCredentials.set({
      user_id: user.id,
      password_hash: password.hash,
      password_hash_params: password.params
    });
    this.metadataStore.users.touchPasswordUpdated({ user_id: user.id });
    user = this.metadataStore.users.markEmailVerified({ user_id: user.id });
    this.metadataStore.authTokens.consume({ id: token.id });
    this.audit("auth.invitation_accepted", {
      email: user.email,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      userId: user.id
    });
    return this.createAuthenticatedSession({
      user,
      ...(input.ipAddress ? { ipAddress: input.ipAddress } : {}),
      ...(input.userAgent ? { userAgent: input.userAgent } : {})
    });
  }

  async verifyEmail(input: {
    token: string;
    ipAddress?: string | undefined;
    userAgent?: string | undefined;
  }): Promise<{ user: AuthUserDto }> {
    const token = this.requireToken("email_verification", input.token);
    const user = this.metadataStore.users.markEmailVerified({ user_id: token.user_id });
    this.metadataStore.authTokens.consume({ id: token.id });
    this.audit("auth.email_verified", {
      email: user.email,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      userId: user.id
    });
    return { user: userDto(user) };
  }

  async login(input: {
    email: string;
    ipAddress?: string | undefined;
    password: string;
    rememberMe?: boolean | undefined;
    userAgent?: string | undefined;
  }): Promise<{
    csrfToken: string;
    maxAgeSeconds: number;
    persistent: boolean;
    sessionToken: string;
    user: AuthUserDto;
    workspace: AuthWorkspaceDto;
  }> {
    const email = normalizeEmail(input.email);
    this.checkRateLimit(`login:email:${email}`, 5, 60);
    this.checkRateLimit(`login:ip:${input.ipAddress ?? "unknown"}`, 20, 60);
    const user = this.metadataStore.users.findByEmail({ email });
    if (!user || user.disabled_at) {
      this.audit("auth.login_failed", { email, ipAddress: input.ipAddress, userAgent: input.userAgent });
      throw new AuthError(401, "UNAUTHORIZED", "Invalid email or password.");
    }
    if (!user.email_verified_at) {
      this.audit("auth.login_unverified", {
        email,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        userId: user.id
      });
      throw new AuthError(403, "EMAIL_NOT_VERIFIED", "Email verification is required before login.");
    }
    const credential = this.metadataStore.userPasswordCredentials.find({ user_id: user.id });
    if (!credential || !(await verifyPassword(credential.password_hash, input.password))) {
      this.audit("auth.login_failed", {
        email,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        userId: user.id
      });
      throw new AuthError(401, "UNAUTHORIZED", "Invalid email or password.");
    }
    this.audit("auth.login_succeeded", {
      email,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      userId: user.id
    });
    return this.createAuthenticatedSession({
      user,
      persistent: input.rememberMe !== false,
      ...(input.ipAddress ? { ipAddress: input.ipAddress } : {}),
      ...(input.userAgent ? { userAgent: input.userAgent } : {})
    });
  }

  async forgotPassword(input: {
    email: string;
    ipAddress?: string | undefined;
    userAgent?: string | undefined;
  }): Promise<{ resetToken?: string; ok: boolean }> {
    const email = normalizeEmail(input.email);
    this.checkRateLimit(`password-reset:email:${email}`, 3, 60 * 60);
    const user = this.metadataStore.users.findByEmail({ email });
    if (!user || !user.email_verified_at || user.disabled_at) {
      this.audit("auth.password_reset_requested_unknown", {
        email,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent
      });
      return { ok: true };
    }
    const resetToken = createSecretToken();
    this.metadataStore.authTokens.create({
      id: randomUUID(),
      user_id: user.id,
      purpose: "password_reset",
      token_hash: hashToken(resetToken, this.config.sessionSecret),
      expires_at: new Date(Date.now() + PASSWORD_RESET_TTL_MS).toISOString()
    });
    const mail = await this.mailer.sendPasswordReset({ email, token: resetToken });
    this.audit("auth.password_reset_requested", {
      email,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      userId: user.id
    });
    return { ok: true, ...(mail.testToken ? { resetToken: mail.testToken } : {}) };
  }

  async resetPassword(input: {
    ipAddress?: string | undefined;
    password: string;
    token: string;
    userAgent?: string | undefined;
  }): Promise<{ ok: boolean }> {
    assertPassword(input.password);
    const token = this.requireToken("password_reset", input.token);
    const password = await hashPassword(input.password);
    this.metadataStore.userPasswordCredentials.set({
      user_id: token.user_id,
      password_hash: password.hash,
      password_hash_params: password.params
    });
    const user = this.metadataStore.users.touchPasswordUpdated({ user_id: token.user_id });
    this.metadataStore.authTokens.consume({ id: token.id });
    this.metadataStore.authSessions.revokeByUser({ user_id: token.user_id });
    this.audit("auth.password_reset_completed", {
      email: user.email,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      userId: user.id
    });
    return { ok: true };
  }

  async changePassword(input: {
    currentPassword: string;
    identity: AuthIdentity;
    ipAddress?: string | undefined;
    newPassword: string;
    userAgent?: string | undefined;
  }): Promise<{ ok: boolean }> {
    assertPassword(input.newPassword);
    const credential = this.metadataStore.userPasswordCredentials.get({ user_id: input.identity.user.id });
    if (!(await verifyPassword(credential.password_hash, input.currentPassword))) {
      throw new AuthError(401, "UNAUTHORIZED", "Current password is invalid.");
    }
    const password = await hashPassword(input.newPassword);
    this.metadataStore.userPasswordCredentials.set({
      user_id: input.identity.user.id,
      password_hash: password.hash,
      password_hash_params: password.params
    });
    this.metadataStore.users.touchPasswordUpdated({ user_id: input.identity.user.id });
    this.metadataStore.authSessions.revokeByUser({
      user_id: input.identity.user.id,
      ...(input.identity.session ? { except_session_id: input.identity.session.id } : {})
    });
    this.audit("auth.password_changed", {
      email: input.identity.user.email,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      userId: input.identity.user.id
    });
    return { ok: true };
  }

  authenticateSession(
    sessionToken: string | undefined,
    options: { accessMode?: "read-only" | "mutating" } = {},
  ): AuthIdentity {
    if (!sessionToken) {
      throw new AuthError(401, "UNAUTHORIZED", "Authentication required.");
    }
    const session = this.metadataStore.authSessions.findByTokenHash({
      token_hash: hashToken(sessionToken, this.config.sessionSecret)
    });
    if (!session) {
      throw new AuthError(401, "UNAUTHORIZED", "Authentication required.");
    }
    const user = this.metadataStore.users.getById({ user_id: session.user_id });
    if (user.disabled_at) {
      throw new AuthError(401, "UNAUTHORIZED", "Authentication required.");
    }
    const accessMode = options.accessMode ?? "mutating";
    if (accessMode === "mutating") {
      this.metadataStore.authSessions.touch({ id: session.id });
    }
    return {
      session,
      user,
      workspace: accessMode === "read-only"
        ? this.requireExistingPersonalWorkspace(user)
        : this.ensurePersonalWorkspace(user)
    };
  }

  validateCsrf(identity: AuthIdentity, csrfToken: string | undefined): void {
    if (!identity.session || !csrfToken) {
      throw new AuthError(403, "FORBIDDEN", "CSRF token is required.");
    }
    const tokenHash = hashToken(csrfToken, this.config.sessionSecret);
    if (tokenHash !== identity.session.csrf_token_hash) {
      throw new AuthError(403, "FORBIDDEN", "CSRF token is invalid.");
    }
  }

  logout(identity: AuthIdentity): { ok: boolean } {
    if (identity.session) {
      this.metadataStore.authSessions.revoke({ id: identity.session.id });
      this.audit("auth.logout", { email: identity.user.email, userId: identity.user.id });
    }
    return { ok: true };
  }

  logoutAll(identity: AuthIdentity): { ok: boolean } {
    this.metadataStore.authSessions.revokeByUser({ user_id: identity.user.id });
    this.audit("auth.logout_all", { email: identity.user.email, userId: identity.user.id });
    return { ok: true };
  }

  listSessions(identity: AuthIdentity): { sessions: Array<Record<string, unknown>> } {
    return {
      sessions: this.metadataStore.authSessions.listByUser({ user_id: identity.user.id }).map((session) => ({
        id: session.id,
        createdAt: session.created_at,
        expiresAt: session.expires_at,
        lastSeenAt: session.last_seen_at,
        userAgent: session.user_agent
      }))
    };
  }

  revokeSession(identity: AuthIdentity, id: string): { revoked: boolean } {
    const sessions = this.metadataStore.authSessions.listByUser({ user_id: identity.user.id });
    if (!sessions.some((session) => session.id === id)) {
      throw new AuthError(404, "RESOURCE_NOT_FOUND", "Session not found.");
    }
    this.metadataStore.authSessions.revoke({ id });
    return { revoked: true };
  }

  private requireToken(purpose: "account_invitation" | "email_verification" | "password_reset", token: string) {
    const record = this.metadataStore.authTokens.findValid({
      purpose,
      token_hash: hashToken(token, this.config.sessionSecret)
    });
    if (!record) {
      throw new AuthError(400, "BAD_REQUEST", "Token is invalid or expired.");
    }
    return record;
  }

  private createAuthenticatedSession(input: {
    user: UserRecord;
    persistent?: boolean;
    ipAddress?: string;
    userAgent?: string;
  }): {
    csrfToken: string;
    maxAgeSeconds: number;
    persistent: boolean;
    sessionToken: string;
    user: AuthUserDto;
    workspace: AuthWorkspaceDto;
  } {
    const persistent = input.persistent !== false;
    const ttlSeconds = persistent ? SESSION_TTL_SECONDS : SHORT_SESSION_TTL_SECONDS;
    const sessionToken = createSecretToken();
    const csrfToken = createSecretToken();
    const session = this.metadataStore.authSessions.create({
      id: randomUUID(),
      user_id: input.user.id,
      token_hash: hashToken(sessionToken, this.config.sessionSecret),
      csrf_token_hash: hashToken(csrfToken, this.config.sessionSecret),
      expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
      ...(input.ipAddress ? { ip_address: input.ipAddress } : {}),
      ...(input.userAgent ? { user_agent: input.userAgent } : {})
    });
    const workspace = this.ensurePersonalWorkspace(input.user);
    this.audit("auth.session_created", {
      email: input.user.email,
      metadata: { sessionId: session.id, persistent },
      userId: input.user.id
    });
    return {
      csrfToken,
      maxAgeSeconds: ttlSeconds,
      persistent,
      sessionToken,
      user: userDto(input.user),
      workspace: workspaceDto(workspace)
    };
  }

  private ensurePersonalWorkspace(user: UserRecord): WorkspaceRecord {
    const existing = this.metadataStore.workspaces.findPersonalByUser({ user_id: user.id });
    if (existing) {
      this.metadataStore.workspaceMemberships.upsertOwner({ workspace_id: existing.id, user_id: user.id });
      return existing;
    }
    const workspace = this.metadataStore.workspaces.createPersonal({
      id: `personal-${user.id}`,
      owner_user_id: user.id,
      name: user.display_name ? `${user.display_name}'s workspace` : "Personal workspace"
    });
    this.metadataStore.workspaceMemberships.upsertOwner({ workspace_id: workspace.id, user_id: user.id });
    return workspace;
  }

  private requireExistingPersonalWorkspace(user: UserRecord): WorkspaceRecord {
    const workspace = this.metadataStore.workspaces.findPersonalByUser({ user_id: user.id });
    const membership = workspace
      ? this.metadataStore.workspaceMemberships.find({ workspace_id: workspace.id, user_id: user.id })
      : undefined;
    if (!workspace || membership?.role !== "owner") {
      throw new AuthError(401, "UNAUTHORIZED", "Authentication required.");
    }
    return workspace;
  }

  private checkRateLimit(bucket: string, limit: number, windowSeconds: number): void {
    const now = new Date();
    const current = this.metadataStore.db.prepare(`
      SELECT bucket, count, reset_at FROM auth_rate_limits WHERE bucket = ?
    `).get(bucket);
    if (isRateLimitRow(current) && new Date(String(current.reset_at)).getTime() > now.getTime()) {
      if (Number(current.count) >= limit) {
        throw new AuthError(429, "RATE_LIMITED", "Too many requests. Try again later.");
      }
      this.metadataStore.db.prepare(`
        UPDATE auth_rate_limits SET count = count + 1, updated_at = ? WHERE bucket = ?
      `).run(now.toISOString(), bucket);
      return;
    }
    this.metadataStore.db.prepare(`
      INSERT INTO auth_rate_limits (bucket, count, reset_at, updated_at)
      VALUES (?, 1, ?, ?)
      ON CONFLICT(bucket) DO UPDATE SET count = 1, reset_at = excluded.reset_at, updated_at = excluded.updated_at
    `).run(bucket, new Date(now.getTime() + windowSeconds * 1000).toISOString(), now.toISOString());
  }

  private audit(
    eventType: string,
    input: {
      email?: string | undefined;
      ipAddress?: string | undefined;
      metadata?: unknown;
      userAgent?: string | undefined;
      userId?: string | undefined;
    }
  ): void {
    this.metadataStore.authAuditEvents.append({
      id: randomUUID(),
      event_type: eventType,
      ...(input.email ? { email: input.email } : {}),
      ...(input.ipAddress ? { ip_address: input.ipAddress } : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
      ...(input.userAgent ? { user_agent: input.userAgent } : {}),
      ...(input.userId ? { user_id: input.userId } : {})
    });
  }
}

export function userDto(user: UserRecord): AuthUserDto {
  return {
    id: user.id,
    ...(user.email ? { email: user.email } : {}),
    ...(user.display_name ? { displayName: user.display_name } : {}),
    ...(user.avatar_url ? { avatarUrl: user.avatar_url } : {})
  };
}

export function workspaceDto(workspace: WorkspaceRecord): AuthWorkspaceDto {
  return {
    id: workspace.id,
    name: workspace.name
  };
}

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(normalized)) {
    throw new AuthError(400, "BAD_REQUEST", "A valid email address is required.");
  }
  return normalized;
}

function normalizeDisplayName(value: string): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.slice(0, 80);
}

function assertPassword(password: string): void {
  if (password.length < 8) {
    throw new AuthError(400, "BAD_REQUEST", "Password must be at least 8 characters.");
  }
}

function isRateLimitRow(value: unknown): value is { count: number; reset_at: string } {
  return typeof value === "object" && value !== null && "count" in value && "reset_at" in value;
}
