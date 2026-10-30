import { randomUUID } from "node:crypto";
import type {
  AuthSessionRecord,
  MetadataStore,
  UserRecord,
  WorkspaceRecord
} from "@datafoundry/metadata";

import { DEFAULT_SESSION_IDLE_MINUTES, type PasswordAuthConfig } from "./config.js";
import { AuthError } from "./errors.js";
import { AuthMailer } from "./mailer.js";
import { createSecretToken, hashPassword, hashToken, verifyPassword } from "./crypto.js";
import { passwordPolicyProblem } from "./password-policy.js";
import { TwoStepVerification, type TwoStepPrompt } from "./two-step.js";

export { AuthError } from "./errors.js";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
/** Sign-ins without "Remember me" end when the browser closes, or after this at the latest. */
const SHORT_SESSION_TTL_SECONDS = 60 * 60 * 12;
const ACCOUNT_INVITATION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const PASSWORD_RESET_TTL_MS = 1000 * 60 * 30;
/** Wrong passwords for one account within the window below that pause its password sign-in. */
const LOCKOUT_FAILURE_LIMIT = 10;
const LOCKOUT_WINDOW_SECONDS = 15 * 60;
const LOCKOUT_SECONDS = 15 * 60;
const ACCOUNT_LOCKED_MESSAGE =
  "Too many wrong passwords. Sign-in to this account is paused for 15 minutes. Try again later, or reset your password.";
/** Reading pages refreshes a session's last activity at most this often, so a read is not a database write each time. */
const SESSION_ACTIVITY_INTERVAL_MS = 5 * 60_000;

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

/** A sign-in that is finished: the session to set as cookies, and who it belongs to. */
export type AuthSignedIn = {
  csrfToken: string;
  maxAgeSeconds: number;
  persistent: boolean;
  sessionToken: string;
  user: AuthUserDto;
  workspace: AuthWorkspaceDto;
};

/** A correct password that still needs a two-step verification code, or setting it up, before a session exists. */
export type AuthTwoStepPending = { twoStep: TwoStepPrompt };

export class AuthService {
  private readonly mailer: AuthMailer;
  readonly twoStep: TwoStepVerification;
  private readonly sessionIdleMs: number;

  constructor(
    private readonly metadataStore: MetadataStore,
    private readonly config: PasswordAuthConfig
  ) {
    this.mailer = new AuthMailer(config);
    this.sessionIdleMs = (config.sessionIdleMinutes ?? DEFAULT_SESSION_IDLE_MINUTES) * 60_000;
    this.twoStep = new TwoStepVerification(metadataStore, {
      sessionSecret: config.sessionSecret,
      requireForPlatformAdmins: config.requireTwoStepForPlatformAdmins !== false,
      audit: (eventType, input) => this.audit(eventType, input),
      checkRateLimit: (bucket, limit, windowSeconds) => this.checkRateLimit(bucket, limit, windowSeconds)
    });
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
  }): Promise<AuthSignedIn | AuthTwoStepPending> {
    const token = this.requireToken("account_invitation", input.token);
    let user = this.metadataStore.users.getById({ user_id: token.user_id });
    assertPassword(input.password, user.email);
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
    // An Organisation that requires two-step verification has its new people set it up before their first session.
    const twoStep = this.twoStep.promptAfterPassword(user, { persistent: true, ...requestMeta(input) });
    if (twoStep) return { twoStep };
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
  }): Promise<AuthSignedIn | AuthTwoStepPending> {
    const email = normalizeEmail(input.email);
    this.checkRateLimit(`login:email:${email}`, 5, 60);
    this.checkRateLimit(`login:ip:${input.ipAddress ?? "unknown"}`, 20, 60);
    this.assertNotLockedOut(email, input);
    const user = this.metadataStore.users.findByEmail({ email });
    if (!user || user.disabled_at) {
      this.audit("auth.login_failed", { email, ipAddress: input.ipAddress, userAgent: input.userAgent });
      this.recordFailedSignIn(email, input);
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
      this.recordFailedSignIn(email, input, user.id);
      throw new AuthError(401, "UNAUTHORIZED", "Invalid email or password.");
    }
    this.clearFailedSignIns(email);
    // "Remember me" is opt-in: without it the session ends when the browser closes.
    const persistent = input.rememberMe === true;
    const twoStep = this.twoStep.promptAfterPassword(user, { persistent, ...requestMeta(input) });
    if (twoStep) return { twoStep };
    this.audit("auth.login_succeeded", {
      email,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      userId: user.id
    });
    return this.createAuthenticatedSession({ user, persistent, ...requestMeta(input) });
  }

  /** Starts authenticator setup for a sign-in whose Organisation (or platform role) requires it. */
  beginTwoStepSignInSetup(input: { challenge: string; ipAddress?: string | undefined }): { secret: string; otpauthUri: string } {
    this.checkRateLimit(`two-step:ip:${input.ipAddress ?? "unknown"}`, 20, 60);
    return this.twoStep.beginChallengeSetup(input.challenge);
  }

  /** Finishes a sign-in that was waiting for a two-step verification code (or a recovery code). */
  completeTwoStepSignIn(input: {
    challenge: string;
    code?: string | undefined;
    ipAddress?: string | undefined;
    recoveryCode?: string | undefined;
    userAgent?: string | undefined;
  }): AuthSignedIn & { recoveryCodes?: string[] } {
    this.checkRateLimit(`two-step:ip:${input.ipAddress ?? "unknown"}`, 20, 60);
    const outcome = this.twoStep.completeChallenge({
      token: input.challenge,
      code: input.code,
      recoveryCode: input.recoveryCode,
      ...requestMeta(input)
    });
    this.audit("auth.login_succeeded", {
      email: outcome.user.email,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      userId: outcome.user.id,
      metadata: { twoStep: outcome.method }
    });
    const session = this.createAuthenticatedSession({ user: outcome.user, persistent: outcome.persistent, ...requestMeta(input) });
    return { ...session, ...(outcome.recoveryCodes ? { recoveryCodes: outcome.recoveryCodes } : {}) };
  }

  async forgotPassword(input: {
    email: string;
    ipAddress?: string | undefined;
    userAgent?: string | undefined;
  }): Promise<{ ok: boolean }> {
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
    // Never hand the reset link back to whoever asked: anyone can type someone else's email address. With email in
    // test mode the link goes to the server log instead, for whoever runs the server.
    if (mail.testUrl) console.log(`[auth] password-reset link (email test mode) user=${user.id}: ${mail.testUrl}`);
    return { ok: true };
  }

  async resetPassword(input: {
    ipAddress?: string | undefined;
    password: string;
    token: string;
    userAgent?: string | undefined;
  }): Promise<{ ok: boolean }> {
    const token = this.requireToken("password_reset", input.token);
    assertPassword(input.password, this.metadataStore.users.getById({ user_id: token.user_id }).email);
    const password = await hashPassword(input.password);
    this.metadataStore.userPasswordCredentials.set({
      user_id: token.user_id,
      password_hash: password.hash,
      password_hash_params: password.params
    });
    const user = this.metadataStore.users.touchPasswordUpdated({ user_id: token.user_id });
    this.metadataStore.authTokens.consume({ id: token.id });
    this.metadataStore.authSessions.revokeByUser({ user_id: token.user_id });
    // Proving control of the mailbox lifts a pause caused by someone else guessing at the password.
    if (user.email) this.clearLockout(normalizeEmail(user.email));
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
    assertPassword(input.newPassword, input.identity.user.email);
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
    const now = Date.now();
    const lastSeenMs = Date.parse(session.last_seen_at);
    if (now - lastSeenMs > this.sessionIdleMs) {
      // Unused for too long: the session ends here, however long its cookie would otherwise last.
      this.metadataStore.authSessions.revoke({ id: session.id });
      this.audit("auth.session_idle_timeout", {
        email: user.email,
        metadata: { sessionId: session.id, lastSeenAt: session.last_seen_at },
        userId: user.id
      });
      throw new AuthError(401, "UNAUTHORIZED", "Authentication required.");
    }
    const accessMode = options.accessMode ?? "mutating";
    // Changes always count as activity. Reading pages counts too, but is recorded at most every few minutes.
    const activityInterval = Math.min(SESSION_ACTIVITY_INTERVAL_MS, this.sessionIdleMs / 4);
    if (accessMode === "mutating" || !(now - lastSeenMs < activityInterval)) {
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
  }): AuthSignedIn {
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

  /** Refuses password sign-in to an account paused by too many wrong passwords. */
  private assertNotLockedOut(email: string, meta: { ipAddress?: string | undefined; userAgent?: string | undefined }): void {
    const lock = this.metadataStore.db.prepare(`
      SELECT bucket, count, reset_at FROM auth_rate_limits WHERE bucket = ?
    `).get(`login:locked:${email}`);
    if (isRateLimitRow(lock) && new Date(String(lock.reset_at)).getTime() > Date.now()) {
      this.audit("auth.login_locked", { email, ipAddress: meta.ipAddress, userAgent: meta.userAgent });
      throw new AuthError(429, "RATE_LIMITED", ACCOUNT_LOCKED_MESSAGE);
    }
  }

  /**
   * Counts one wrong password against the account, and pauses its password sign-in once there are too many. Counted
   * by email whether or not the account exists, so the pause looks the same either way and reveals nobody's account.
   */
  private recordFailedSignIn(
    email: string,
    meta: { ipAddress?: string | undefined; userAgent?: string | undefined },
    userId?: string
  ): void {
    const now = new Date();
    const bucket = `login:failures:${email}`;
    const current = this.metadataStore.db.prepare(`
      SELECT bucket, count, reset_at FROM auth_rate_limits WHERE bucket = ?
    `).get(bucket);
    const windowOpen = isRateLimitRow(current) && new Date(String(current.reset_at)).getTime() > now.getTime();
    const failures = windowOpen ? Number(current.count) + 1 : 1;
    if (failures < LOCKOUT_FAILURE_LIMIT) {
      const resetAt = windowOpen
        ? String(current.reset_at)
        : new Date(now.getTime() + LOCKOUT_WINDOW_SECONDS * 1000).toISOString();
      this.metadataStore.db.prepare(`
        INSERT INTO auth_rate_limits (bucket, count, reset_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(bucket) DO UPDATE SET count = excluded.count, reset_at = excluded.reset_at, updated_at = excluded.updated_at
      `).run(bucket, failures, resetAt, now.toISOString());
      return;
    }
    this.metadataStore.db.prepare(`
      INSERT INTO auth_rate_limits (bucket, count, reset_at, updated_at)
      VALUES (?, 1, ?, ?)
      ON CONFLICT(bucket) DO UPDATE SET count = 1, reset_at = excluded.reset_at, updated_at = excluded.updated_at
    `).run(`login:locked:${email}`, new Date(now.getTime() + LOCKOUT_SECONDS * 1000).toISOString(), now.toISOString());
    this.clearFailedSignIns(email);
    this.audit("auth.account_locked", {
      email,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      metadata: { failures, lockedForMinutes: LOCKOUT_SECONDS / 60 },
      ...(userId ? { userId } : {})
    });
  }

  private clearFailedSignIns(email: string): void {
    this.metadataStore.db.prepare("DELETE FROM auth_rate_limits WHERE bucket = ?").run(`login:failures:${email}`);
  }

  private clearLockout(email: string): void {
    this.clearFailedSignIns(email);
    this.metadataStore.db.prepare("DELETE FROM auth_rate_limits WHERE bucket = ?").run(`login:locked:${email}`);
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

function assertPassword(password: string, email?: string): void {
  const problem = passwordPolicyProblem(password, { email });
  if (problem) {
    throw new AuthError(400, "BAD_REQUEST", problem);
  }
}

function requestMeta(input: { ipAddress?: string | undefined; userAgent?: string | undefined }): { ipAddress?: string; userAgent?: string } {
  return {
    ...(input.ipAddress ? { ipAddress: input.ipAddress } : {}),
    ...(input.userAgent ? { userAgent: input.userAgent } : {})
  };
}

function isRateLimitRow(value: unknown): value is { count: number; reset_at: string } {
  return typeof value === "object" && value !== null && "count" in value && "reset_at" in value;
}
