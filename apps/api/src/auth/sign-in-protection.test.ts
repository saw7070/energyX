import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadPasswordAuthConfig, type PasswordAuthConfig } from "./config.js";
import { hashPassword } from "./crypto.js";
import { passwordPolicyProblem } from "./password-policy.js";
import { AuthService, type AuthSignedIn, type AuthTwoStepPending } from "./service.js";

const PASSWORD = "plant-room-meter-42";
const authConfig: PasswordAuthConfig = {
  mode: "password",
  publicBaseUrl: "http://127.0.0.1:3001",
  sessionSecret: "test-secret-that-is-longer-than-thirty-two-characters",
  emailDelivery: "test"
};

const withAuth = async (
  run: (ctx: { auth: AuthService; metadata: ReturnType<typeof createMetadataStore>; userId: string }) => Promise<void>,
  config: Partial<PasswordAuthConfig> = {}
) => {
  const root = mkdtempSync(join(tmpdir(), "auth-protection-"));
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  try {
    const auth = new AuthService(metadata, { ...authConfig, ...config });
    const invitation = await auth.inviteUser({ email: "member@example.test", inviterUserId: "dev-user" });
    const token = new URL(invitation.invitationUrl ?? "").searchParams.get("invite") ?? "";
    const activated = await auth.acceptInvitation({ token, password: PASSWORD });
    await run({ auth, metadata, userId: signedIn(activated).user.id });
  } finally {
    log.mockRestore();
    metadata.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};

const signedIn = (result: AuthSignedIn | AuthTwoStepPending): AuthSignedIn => {
  if ("twoStep" in result) throw new Error("Expected a session.");
  return result;
};
const advance = (ms: number) => vi.setSystemTime(Date.now() + ms);
const MINUTE = 60_000;

afterEach(() => {
  vi.useRealTimers();
});

/** Wrong passwords spaced out so the short per-email limit (5 a minute) never answers first. */
const failSignIns = async (auth: AuthService, email: string, count: number) => {
  for (let attempt = 1; attempt <= count; attempt += 1) {
    if (attempt > 1 && attempt % 5 === 1) advance(MINUTE + 1_000);
    await expect(auth.login({ email, password: "not-the-password-at-all" })).rejects.toThrow("Invalid email or password.");
  }
};

describe("Brute-force protection", () => {
  it("pauses password sign-in for 15 minutes after 10 wrong passwords, with a plain message", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await withAuth(async ({ auth, metadata }) => {
      await failSignIns(auth, "member@example.test", 10);
      advance(MINUTE + 1_000);
      // Even the right password is refused while the account is paused.
      await expect(auth.login({ email: "member@example.test", password: PASSWORD }))
        .rejects.toMatchObject({ status: 429, message: expect.stringContaining("Sign-in to this account is paused for 15 minutes") });
      expect(metadata.authAuditEvents.list({ eventTypes: ["auth.account_locked"] }).events).toHaveLength(1);
      expect(metadata.authAuditEvents.list({ eventTypes: ["auth.login_locked"] }).events).toHaveLength(1);

      advance(15 * MINUTE);
      signedIn(await auth.login({ email: "member@example.test", password: PASSWORD }));
    });
  });

  it("starts the count again after a successful sign-in", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await withAuth(async ({ auth }) => {
      await failSignIns(auth, "member@example.test", 9);
      advance(MINUTE + 1_000);
      signedIn(await auth.login({ email: "member@example.test", password: PASSWORD }));
      advance(MINUTE + 1_000);
      await failSignIns(auth, "member@example.test", 9);
      advance(MINUTE + 1_000);
      signedIn(await auth.login({ email: "member@example.test", password: PASSWORD }));
    });
  });

  it("pauses an unknown email the same way, so the pause reveals nobody's account", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await withAuth(async ({ auth }) => {
      await failSignIns(auth, "nobody@example.test", 10);
      advance(MINUTE + 1_000);
      await expect(auth.login({ email: "nobody@example.test", password: PASSWORD })).rejects.toThrow("paused for 15 minutes");
      // Another account is unaffected.
      signedIn(await auth.login({ email: "member@example.test", password: PASSWORD }));
    });
  });

  it("lifts the pause when the person resets their password from their email", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await withAuth(async ({ auth }) => {
      await failSignIns(auth, "member@example.test", 10);
      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
      await auth.forgotPassword({ email: "member@example.test" });
      const line = log.mock.calls.map((call) => String(call[0])).find((text) => text.includes("password-reset link"));
      const resetToken = new URL(line?.split(": ").at(-1) ?? "http://x").searchParams.get("reset") ?? "";
      await auth.resetPassword({ token: resetToken, password: "switchboard-reading-7" });
      advance(MINUTE + 1_000);
      signedIn(await auth.login({ email: "member@example.test", password: "switchboard-reading-7" }));
    });
  });
});

describe("Password rules for new and changed passwords", () => {
  it("needs 12 characters and refuses the most common passwords", () => {
    expect(passwordPolicyProblem("short-pass1")).toBe("Password must be at least 12 characters.");
    expect(passwordPolicyProblem("password1234")).toBe("This password is too easy to guess. Choose one that is less common.");
    expect(passwordPolicyProblem("Password1234")).toMatch(/too easy to guess/u);
    expect(passwordPolicyProblem("qwertyuiop123")).toMatch(/too easy to guess/u);
    expect(passwordPolicyProblem("aaaaaaaaaaaaaa")).toMatch(/too easy to guess/u);
    expect(passwordPolicyProblem("ada.lovelace@example.com", { email: "Ada.Lovelace@example.com" })).toMatch(/too easy to guess/u);
    expect(passwordPolicyProblem(PASSWORD)).toBeUndefined();
  });

  it("applies to changing and resetting a password, but existing passwords keep working", async () => {
    await withAuth(async ({ auth, metadata, userId }) => {
      const identity = auth.authenticateSession(signedIn(await auth.login({ email: "member@example.test", password: PASSWORD })).sessionToken);
      await expect(auth.changePassword({ identity, currentPassword: PASSWORD, newPassword: "short-pass1" }))
        .rejects.toMatchObject({ status: 400, message: "Password must be at least 12 characters." });
      await expect(auth.changePassword({ identity, currentPassword: PASSWORD, newPassword: "welcome12345" }))
        .rejects.toThrow("too easy to guess");

      // A password set before the rules changed still signs in.
      const legacy = await hashPassword("welcome1");
      metadata.userPasswordCredentials.set({ user_id: userId, password_hash: legacy.hash, password_hash_params: legacy.params });
      signedIn(await auth.login({ email: "member@example.test", password: "welcome1" }));
    });
  });
});

describe("Session idle timeout", () => {
  it("ends a session unused for longer than the idle limit and records why", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await withAuth(async ({ auth, metadata, userId }) => {
      const session = signedIn(await auth.login({ email: "member@example.test", password: PASSWORD, rememberMe: true }));
      advance(119 * MINUTE);
      const sessionId = auth.authenticateSession(session.sessionToken, { accessMode: "read-only" }).session!.id;
      // That read counted as use, so the clock starts again from it.
      advance(119 * MINUTE);
      expect(auth.authenticateSession(session.sessionToken, { accessMode: "read-only" }).user.id).toBe(userId);

      advance(121 * MINUTE);
      expect(() => auth.authenticateSession(session.sessionToken)).toThrow("Authentication required");
      // Revoked, not only refused, although its 30-day "Remember me" cookie had long to run.
      expect(metadata.authSessions.get({ id: sessionId }).revoked_at).toBeDefined();
      const [timedOut] = metadata.authAuditEvents.list({ eventTypes: ["auth.session_idle_timeout"] }).events;
      expect(timedOut).toMatchObject({ user_id: userId });
      expect(timedOut?.metadata_json).toContain(sessionId);
    });
  });

  it("records reading as activity at most every few minutes, and honours a configured limit", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await withAuth(async ({ auth, metadata }) => {
      const session = signedIn(await auth.login({ email: "member@example.test", password: PASSWORD }));
      const sessionId = auth.authenticateSession(session.sessionToken, { accessMode: "read-only" }).session!.id;
      const lastSeen = () => metadata.authSessions.get({ id: sessionId }).last_seen_at;
      const before = lastSeen();
      advance(2 * MINUTE);
      auth.authenticateSession(session.sessionToken, { accessMode: "read-only" });
      expect(lastSeen()).toBe(before);
      auth.authenticateSession(session.sessionToken, { accessMode: "mutating" });
      expect(lastSeen()).not.toBe(before);

      advance(31 * MINUTE);
      expect(() => auth.authenticateSession(session.sessionToken)).toThrow("Authentication required");
    }, { sessionIdleMinutes: 30 });
  });

  it("gives sessions open at upgrade a fresh idle window, because reading pages did not count before", () => {
    const root = mkdtempSync(join(tmpdir(), "auth-idle-upgrade-"));
    const path = join(root, "metadata.sqlite");
    let metadata = createMetadataStore({ database_path: path });
    try {
      metadata.users.createPasswordUser({ id: "reader", email: "reader@example.test" });
      metadata.authSessions.create({
        id: "open-session", user_id: "reader", token_hash: "token", csrf_token_hash: "csrf",
        expires_at: new Date(Date.now() + 86_400_000).toISOString()
      });
      metadata.authSessions.touch({ id: "open-session", last_seen_at: "2026-01-01T00:00:00.000Z" });
      metadata.db.prepare("DELETE FROM schema_migrations WHERE id = ?").run("0056_auth_session_idle_baseline");
      metadata.close();
      metadata = createMetadataStore({ database_path: path });
      expect(Date.parse(metadata.authSessions.get({ id: "open-session" }).last_seen_at)).toBeGreaterThan(Date.now() - MINUTE);
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("reads its settings from the environment, with safe defaults", () => {
    const passwordEnv = {
      DATAFOUNDRY_AUTH_MODE: "password",
      AUTH_SESSION_SECRET: authConfig.sessionSecret,
      AUTH_PUBLIC_BASE_URL: authConfig.publicBaseUrl,
      AUTH_EMAIL_DELIVERY: "test"
    };
    expect(loadPasswordAuthConfig(passwordEnv)).toMatchObject({ sessionIdleMinutes: 120, requireTwoStepForPlatformAdmins: true });
    expect(loadPasswordAuthConfig({ ...passwordEnv, ENERGYX_SESSION_IDLE_MINUTES: "45", ENERGYX_REQUIRE_MFA_FOR_PLATFORM_ADMINS: "false" }))
      .toMatchObject({ sessionIdleMinutes: 45, requireTwoStepForPlatformAdmins: false });
    expect(loadPasswordAuthConfig({ ...passwordEnv, ENERGYX_REQUIRE_MFA_FOR_PLATFORM_ADMINS: "TRUE" }).requireTwoStepForPlatformAdmins).toBe(true);
    expect(() => loadPasswordAuthConfig({ ...passwordEnv, ENERGYX_SESSION_IDLE_MINUTES: "never" })).toThrow("ENERGYX_SESSION_IDLE_MINUTES");
  });
});
