import { createMetadataStore, ENERGYIQ_ORGANISATION_ADMIN_ROLE_ID } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ensureEnergyIqBootstrap } from "../energy/energy-bootstrap.js";
import { EnergyAdminAccessService } from "../energy/energy-admin-access.js";
import { EnergyTeamAccessService } from "../energy/energy-team-access.js";
import type { PasswordAuthConfig } from "./config.js";
import { AuthService, type AuthSignedIn, type AuthTwoStepPending } from "./service.js";
import { totpCode, totpStep } from "./totp.js";

const PASSWORD = "plant-room-meter-42";
const authConfig: PasswordAuthConfig = {
  mode: "password",
  publicBaseUrl: "http://127.0.0.1:3001",
  sessionSecret: "test-secret-that-is-longer-than-thirty-two-characters",
  emailDelivery: "test"
};

const build = async (root: string, options: { masterKey?: string; config?: Partial<PasswordAuthConfig> } = {}) => {
  const metadata = createMetadataStore({
    database_path: join(root, "metadata.sqlite"),
    ...(options.masterKey === "" ? {} : { secret_master_key: options.masterKey ?? "two-step-test-master-key" })
  });
  ensureEnergyIqBootstrap(metadata);
  const auth = new AuthService(metadata, { ...authConfig, ...options.config });
  const admin = new EnergyAdminAccessService(metadata, auth);
  const team = new EnergyTeamAccessService(metadata, auth);
  const elite = admin.createOrganisation({ actorUserId: "dev-user", name: "Elite IOT" });
  /** Invites someone and accepts the invitation, so they have a password. */
  const person = async (email: string, input: { role?: "user" | "admin"; organisationRole?: string } = {}) => {
    const invited = await admin.inviteUser({
      actorUserId: "dev-user",
      email,
      organisationIds: input.role === "admin" ? [] : [elite.id],
      role: input.role ?? "user",
      ...(input.organisationRole ? { organisationRoles: { [elite.id]: input.organisationRole } } : {})
    });
    const token = new URL(invited.invitationUrl ?? "").searchParams.get("invite") ?? "";
    const activated = await auth.acceptInvitation({ token, password: PASSWORD });
    return { user: metadata.users.getById({ user_id: invited.user.id }), activated };
  };
  return { metadata, auth, admin, team, elite, person };
};

const withStore = async (
  run: (ctx: Awaited<ReturnType<typeof build>>) => Promise<void>,
  options: Parameters<typeof build>[1] = {}
) => {
  const root = mkdtempSync(join(tmpdir(), "auth-two-step-"));
  const ctx = await build(root, options);
  try {
    await run(ctx);
  } finally {
    ctx.metadata.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};

const signedIn = (result: AuthSignedIn | AuthTwoStepPending): AuthSignedIn => {
  if ("twoStep" in result) throw new Error(`Expected a session, got a two-step ${result.twoStep.mode} prompt.`);
  return result;
};
const pending = (result: AuthSignedIn | AuthTwoStepPending): AuthTwoStepPending["twoStep"] => {
  if (!("twoStep" in result)) throw new Error("Expected a two-step prompt, got a session.");
  return result.twoStep;
};
/** Codes are accepted for one 30-second step either side of now; each test moves the clock on to get a fresh one. */
const code = (secret: string, offset = 0) => totpCode(secret, totpStep() + offset);
const advance = (ms: number) => vi.setSystemTime(Date.now() + ms);

afterEach(() => {
  vi.useRealTimers();
});

describe("Two-step verification: turning it on and signing in", () => {
  it("is set up from a code, then asks for a code after the password before any session exists", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await withStore(async ({ metadata, auth, person }) => {
      const { user } = await person("member@elite.test");
      expect(auth.twoStep.status(user)).toMatchObject({ enabled: false, required: false, available: true, recoveryCodesLeft: 0 });

      const setup = auth.twoStep.beginSetup(user);
      expect(setup.secret).toMatch(/^[A-Z2-7]{32}$/u);
      expect(setup.otpauthUri).toContain("otpauth://totp/EnergyX:member%40elite.test?");
      // Asking again before finishing shows the same secret, so an app that already added it keeps working.
      expect(auth.twoStep.beginSetup(user).secret).toBe(setup.secret);
      expect(() => auth.twoStep.confirmSetup(user, "000000")).toThrow("That code didn't work");

      const confirmed = auth.twoStep.confirmSetup(user, code(setup.secret));
      expect(confirmed.recoveryCodes).toHaveLength(10);
      expect(new Set(confirmed.recoveryCodes).size).toBe(10);
      expect(confirmed.recoveryCodes.every((value) => /^[a-z2-9]{5}-[a-z2-9]{5}$/u.test(value))).toBe(true);
      expect(confirmed.status).toMatchObject({ enabled: true, recoveryCodesLeft: 10 });

      // Nothing secret is stored as text: the authenticator secret is encrypted, the recovery codes are keyed hashes.
      const stored = JSON.stringify([
        metadata.db.prepare("SELECT * FROM auth_two_step_factors").all(),
        metadata.db.prepare("SELECT * FROM auth_two_step_recovery_codes").all(),
        metadata.db.prepare("SELECT * FROM encrypted_secrets").all()
      ]);
      expect(stored).not.toContain(setup.secret);
      for (const recoveryCode of confirmed.recoveryCodes) expect(stored).not.toContain(recoveryCode);

      const sessionsBefore = metadata.authSessions.listByUser({ user_id: user.id }).length;
      const prompt = pending(await auth.login({ email: "member@elite.test", password: PASSWORD, rememberMe: true }));
      expect(prompt.mode).toBe("verify");
      expect(metadata.authSessions.listByUser({ user_id: user.id })).toHaveLength(sessionsBefore);
      expect(JSON.stringify(metadata.db.prepare("SELECT * FROM auth_two_step_challenges").all())).not.toContain(prompt.challenge);

      // The code that turned it on was already used: a replayed code is refused even though it is still current.
      expect(() => auth.completeTwoStepSignIn({ challenge: prompt.challenge, code: code(setup.secret) })).toThrow("That code didn't work");
      advance(30_000);
      const session = auth.completeTwoStepSignIn({ challenge: prompt.challenge, code: code(setup.secret) });
      // "Remember me" from the password step carries through to the session.
      expect(session).toMatchObject({ persistent: true, user: { email: "member@elite.test" } });
      expect(auth.authenticateSession(session.sessionToken).user.id).toBe(user.id);
      // The challenge is used up by its first success.
      advance(30_000);
      expect(() => auth.completeTwoStepSignIn({ challenge: prompt.challenge, code: code(setup.secret) })).toThrow("This sign-in has expired");

      const events = metadata.authAuditEvents.list({ categories: ["auth.two_step", "auth.login_succeeded"] }).events.map((event) => event.event_type);
      expect(events).toEqual(expect.arrayContaining(["auth.two_step_enabled", "auth.two_step_code_requested", "auth.two_step_failed", "auth.login_succeeded"]));
    });
  });

  it("accepts each recovery code once instead of a code", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await withStore(async ({ auth, person }) => {
      const { user } = await person("member@elite.test");
      const setup = auth.twoStep.beginSetup(user);
      const { recoveryCodes } = auth.twoStep.confirmSetup(user, code(setup.secret));

      const first = pending(await auth.login({ email: "member@elite.test", password: PASSWORD }));
      // Typed with capitals and without the dash is still the same code.
      const session = auth.completeTwoStepSignIn({ challenge: first.challenge, recoveryCode: recoveryCodes[0]!.toUpperCase().replace("-", "") });
      expect(session.persistent).toBe(false);
      expect(auth.twoStep.status(user).recoveryCodesLeft).toBe(9);

      const second = pending(await auth.login({ email: "member@elite.test", password: PASSWORD }));
      expect(() => auth.completeTwoStepSignIn({ challenge: second.challenge, recoveryCode: recoveryCodes[0]! })).toThrow("That recovery code didn't work");
      // A recovery code typed into the code box works too.
      expect(auth.completeTwoStepSignIn({ challenge: second.challenge, code: recoveryCodes[1]! }).user.id).toBe(user.id);
    });
  });

  it("ends a sign-in after five wrong codes, and limits code checks per person", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await withStore(async ({ auth, person }) => {
      const { user } = await person("member@elite.test");
      const setup = auth.twoStep.beginSetup(user);
      auth.twoStep.confirmSetup(user, code(setup.secret));
      advance(60_000);

      const prompt = pending(await auth.login({ email: "member@elite.test", password: PASSWORD }));
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        expect(() => auth.completeTwoStepSignIn({ challenge: prompt.challenge, code: "000000" })).toThrow("That code didn't work");
      }
      expect(() => auth.completeTwoStepSignIn({ challenge: prompt.challenge, code: "000000" })).toThrow("Too many wrong codes");
      // Even the right code no longer finishes that sign-in.
      expect(() => auth.completeTwoStepSignIn({ challenge: prompt.challenge, code: code(setup.secret) })).toThrow("This sign-in has expired");

      // Across fresh sign-ins, code checks for one person are still capped.
      const next = pending(await auth.login({ email: "member@elite.test", password: PASSWORD }));
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        expect(() => auth.completeTwoStepSignIn({ challenge: next.challenge, code: "000000" })).toThrow("That code didn't work");
      }
      const last = pending(await auth.login({ email: "member@elite.test", password: PASSWORD }));
      expect(() => auth.completeTwoStepSignIn({ challenge: last.challenge, code: code(setup.secret) })).toThrow("Too many requests");
    });
  });

  it("turns off only with a current code, and makes new recovery codes on request", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await withStore(async ({ auth, person }) => {
      const { user } = await person("member@elite.test");
      const setup = auth.twoStep.beginSetup(user);
      const { recoveryCodes } = auth.twoStep.confirmSetup(user, code(setup.secret));

      advance(30_000);
      const fresh = auth.twoStep.regenerateRecoveryCodes(user, code(setup.secret));
      expect(fresh.recoveryCodes).toHaveLength(10);
      expect(fresh.recoveryCodes).not.toContain(recoveryCodes[0]);
      const prompt = pending(await auth.login({ email: "member@elite.test", password: PASSWORD }));
      expect(() => auth.completeTwoStepSignIn({ challenge: prompt.challenge, recoveryCode: recoveryCodes[0]! })).toThrow("recovery code didn't work");

      expect(() => auth.twoStep.disable(user, "123456")).toThrow("That code didn't work");
      advance(30_000);
      expect(auth.twoStep.disable(user, code(setup.secret))).toMatchObject({ enabled: false, recoveryCodesLeft: 0 });
      signedIn(await auth.login({ email: "member@elite.test", password: PASSWORD }));
    });
  });
});

describe("Two-step verification: when it is required", () => {
  it("lets an Organisation admin require it, and takes members through setup before their first session", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await withStore(async ({ metadata, auth, team, elite, person }) => {
      const { user: orgAdmin } = await person("lead@elite.test", { organisationRole: ENERGYIQ_ORGANISATION_ADMIN_ROLE_ID });
      const { user: member } = await person("member@elite.test");

      expect(team.security({ actor: orgAdmin, workspaceId: elite.id })).toEqual({ required: false, membersWithoutTwoStep: 2, canChange: true });
      expect(() => team.setSecurity({ actor: member, workspaceId: elite.id, requireTwoStep: true })).toThrow("cannot manage people");
      expect(team.setSecurity({ actor: orgAdmin, workspaceId: elite.id, requireTwoStep: true })).toMatchObject({ required: true });
      expect(metadata.authAuditEvents.list({ eventTypes: ["energyiq.organisation_two_step_changed"] }).events[0]?.metadata_json)
        .toContain(`"organisationId":"${elite.id}"`);

      // Not locked out: the password is accepted and leads to setup, with no session until it is finished.
      const prompt = pending(await auth.login({ email: "member@elite.test", password: PASSWORD, rememberMe: true }));
      expect(prompt).toMatchObject({ mode: "enroll", requiredBy: "organisation" });
      const setup = auth.beginTwoStepSignInSetup({ challenge: prompt.challenge });
      expect(auth.beginTwoStepSignInSetup({ challenge: prompt.challenge }).secret).toBe(setup.secret);
      expect(() => auth.completeTwoStepSignIn({ challenge: prompt.challenge, code: "000000" })).toThrow("That code didn't work");
      const session = auth.completeTwoStepSignIn({ challenge: prompt.challenge, code: code(setup.secret) });
      expect(session.recoveryCodes).toHaveLength(10);
      expect(session.persistent).toBe(true);
      expect(auth.twoStep.status(member)).toMatchObject({ enabled: true, required: true, requiredBy: "organisation" });
      expect(team.security({ actor: orgAdmin, workspaceId: elite.id }).membersWithoutTwoStep).toBe(1);

      advance(30_000);
      expect(() => auth.twoStep.disable(member, code(setup.secret))).toThrow("Your organisation requires two-step verification");
    });
  });

  it("requires it of platform admins by default, including at invitation, unless switched off", async () => {
    await withStore(async ({ auth, person }) => {
      const { user, activated } = await person("ops@energyx.test", { role: "admin" });
      expect(pending(activated)).toMatchObject({ mode: "enroll", requiredBy: "platform" });
      expect(auth.twoStep.status(user)).toMatchObject({ required: true, requiredBy: "platform" });
      expect(pending(await auth.login({ email: "ops@energyx.test", password: PASSWORD })).mode).toBe("enroll");
    });
    await withStore(async ({ auth, person }) => {
      const { activated } = await person("ops@energyx.test", { role: "admin" });
      signedIn(activated);
      signedIn(await auth.login({ email: "ops@energyx.test", password: PASSWORD }));
    }, { config: { requireTwoStepForPlatformAdmins: false } });
  });

  it("does not lock anyone out when the server cannot store secrets, and says so", async () => {
    await withStore(async ({ metadata, auth, team, elite, person }) => {
      const { user } = await person("member@elite.test");
      team.setSecurity({ actor: metadata.users.getById({ user_id: "dev-user" }), workspaceId: elite.id, requireTwoStep: true });
      expect(auth.twoStep.status(user)).toMatchObject({ available: false, required: true });
      signedIn(await auth.login({ email: "member@elite.test", password: PASSWORD }));
      expect(metadata.authAuditEvents.list({ eventTypes: ["auth.two_step_requirement_skipped"] }).events).toHaveLength(1);
      expect(() => auth.twoStep.beginSetup(user)).toThrow("can't be set up on this server yet");
    }, { masterKey: "" });
  });
});

describe("Two-step verification: platform admin reset", () => {
  it("lets a super admin reset someone's two-step verification, signing them out, and nobody else", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await withStore(async ({ metadata, auth, admin, person }) => {
      const { user: lead } = await person("lead@elite.test", { organisationRole: ENERGYIQ_ORGANISATION_ADMIN_ROLE_ID });
      const { user } = await person("member@elite.test");
      const setup = auth.twoStep.beginSetup(user);
      auth.twoStep.confirmSetup(user, code(setup.secret));
      expect(admin.listUsers().find((entry) => entry.id === user.id)?.twoStepEnabled).toBe(true);
      advance(30_000);
      const prompt = pending(await auth.login({ email: "member@elite.test", password: PASSWORD }));
      const session = auth.completeTwoStepSignIn({ challenge: prompt.challenge, code: code(setup.secret) });

      expect(() => auth.twoStep.adminReset({ actor: lead, userId: user.id })).toThrow("Only a platform administrator");
      auth.twoStep.adminReset({ actor: metadata.users.getById({ user_id: "dev-user" }), userId: user.id });

      expect(admin.listUsers().find((entry) => entry.id === user.id)?.twoStepEnabled).toBe(false);
      expect(() => auth.authenticateSession(session.sessionToken)).toThrow("Authentication required");
      expect(metadata.db.prepare("SELECT COUNT(*) AS n FROM encrypted_secrets").get()).toEqual({ n: 0 });
      signedIn(await auth.login({ email: "member@elite.test", password: PASSWORD }));
      const reset = metadata.authAuditEvents.list({ eventTypes: ["auth.two_step_reset"] }).events[0];
      expect(reset).toMatchObject({ user_id: "dev-user" });
      expect(reset?.metadata_json).toContain(`"targetUserId":"${user.id}"`);
    });
  });
});
