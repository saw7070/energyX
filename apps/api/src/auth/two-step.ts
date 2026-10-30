import { randomInt, randomUUID } from "node:crypto";
import type { AuthTwoStepChallengeRecord, MetadataStore, UserRecord } from "@datafoundry/metadata";

import { resolveEnergyIqUserRole } from "../energy/energy-user-role.js";
import { createSecretToken, hashToken } from "./crypto.js";
import { AuthError } from "./errors.js";
import { createTotpSecret, matchTotpStep, totpUri } from "./totp.js";

const ISSUER = "EnergyX";
const VERIFY_CHALLENGE_TTL_MS = 5 * 60_000;
/** Longer than a code check, because installing and setting up an authenticator app takes a while. */
const ENROLL_CHALLENGE_TTL_MS = 15 * 60_000;
/** Wrong codes allowed on one sign-in before the password has to be entered again. */
const MAX_CHALLENGE_ATTEMPTS = 5;
/** Code checks allowed per person in the window below, across every sign-in and settings change. */
const CODE_ATTEMPT_LIMIT = 10;
const CODE_ATTEMPT_WINDOW_SECONDS = 15 * 60;
const RECOVERY_CODE_COUNT = 10;
/** No 0/o or 1/l/i, so a code copied onto paper reads back without guessing. */
const RECOVERY_CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
/** Authenticator secrets are encrypted like stored credentials, but kept apart from every Organisation's. */
const SECRET_SCOPE = "auth-two-step";
const SECRET_OWNER_KIND = "auth_two_step";

const WRONG_CODE = "That code didn't work. Check your authenticator app and try again.";
const WRONG_RECOVERY_CODE = "That recovery code didn't work. Check it and try again.";
const SIGN_IN_EXPIRED = "This sign-in has expired. Sign in again.";

export type TwoStepRequirement = "organisation" | "platform";

/** What sign-in needs next after a correct password. The challenge stands in for the password until it is used up. */
export type TwoStepPrompt = {
  mode: "verify" | "enroll";
  challenge: string;
  expiresAt: string;
  requiredBy?: TwoStepRequirement;
};

export type TwoStepStatus = {
  enabled: boolean;
  /** Whether the person may not turn it off: an Organisation they belong to requires it, or they are a platform admin. */
  required: boolean;
  requiredBy?: TwoStepRequirement;
  recoveryCodesLeft: number;
  /** False when the server cannot keep authenticator secrets (no SECRET_MASTER_KEY), so it cannot be turned on. */
  available: boolean;
};

export type TwoStepSetup = { secret: string; otpauthUri: string };

export type TwoStepOrganisationSetting = { required: boolean; membersWithoutTwoStep: number };

type AuditInput = {
  email?: string | undefined;
  ipAddress?: string | undefined;
  metadata?: unknown;
  userAgent?: string | undefined;
  userId?: string | undefined;
};

type RequestMeta = { ipAddress?: string | undefined; userAgent?: string | undefined };

/**
 * Two-step verification with an authenticator app (RFC 6238 codes) for password sign-in: setting it up, checking codes
 * at sign-in, one-time recovery codes, turning it off, the Organisation setting that requires it, and a platform
 * admin's reset for someone who lost their phone. Sessions themselves are issued by AuthService.
 */
export class TwoStepVerification {
  constructor(
    private readonly metadataStore: MetadataStore,
    private readonly options: {
      sessionSecret: string;
      requireForPlatformAdmins: boolean;
      audit: (eventType: string, input: AuditInput) => void;
      checkRateLimit: (bucket: string, limit: number, windowSeconds: number) => void;
    }
  ) {}

  /** Whether the server can keep authenticator secrets at all. */
  available(): boolean {
    return this.metadataStore.secrets.isConfigured();
  }

  isEnabled(userId: string): boolean {
    return this.metadataStore.authTwoStep.isEnabled(userId);
  }

  /** Why this person must use two-step verification, or undefined when it is their own choice. */
  requirement(user: UserRecord): TwoStepRequirement | undefined {
    if (this.metadataStore.authTwoStep.requiringOrganisationIds(user.id).length > 0) return "organisation";
    if (this.options.requireForPlatformAdmins && resolveEnergyIqUserRole(this.metadataStore, user) === "admin") return "platform";
    return undefined;
  }

  status(user: UserRecord): TwoStepStatus {
    const enabled = this.isEnabled(user.id);
    const requiredBy = this.requirement(user);
    return {
      enabled,
      required: requiredBy !== undefined,
      ...(requiredBy ? { requiredBy } : {}),
      recoveryCodesLeft: enabled ? this.metadataStore.authTwoStep.countUnusedRecoveryCodes(user.id) : 0,
      available: this.available()
    };
  }

  /**
   * What has to happen after a correct password before a session is issued: a code when the person has two-step
   * verification on, or setting it up when it is required and they have not yet. Undefined means sign straight in.
   */
  promptAfterPassword(user: UserRecord, input: RequestMeta & { persistent: boolean }): TwoStepPrompt | undefined {
    if (this.isEnabled(user.id)) return this.issueChallenge(user, "verify", input);
    const requiredBy = this.requirement(user);
    if (!requiredBy) return undefined;
    if (!this.available()) {
      // Without SECRET_MASTER_KEY nobody can set up an authenticator. Refusing would lock everyone out, so sign-in goes
      // ahead and the gap is recorded; the server also warns about it at startup.
      this.options.audit("auth.two_step_requirement_skipped", {
        email: user.email,
        userId: user.id,
        metadata: { requiredBy, reason: "secret_master_key_missing" }
      });
      return undefined;
    }
    return { ...this.issueChallenge(user, "enroll", input), requiredBy };
  }

  /** Starts authenticator setup for a sign-in that requires it. Asking again shows the same unfinished setup. */
  beginChallengeSetup(token: string): TwoStepSetup {
    const challenge = this.requireChallenge(token);
    const user = this.activeUser(challenge.user_id);
    if (challenge.purpose !== "enroll" || this.isEnabled(user.id)) {
      throw new AuthError(409, "CONFLICT", "Two-step verification is already on for this account. Sign in again.");
    }
    return this.pendingOrNewSetup(user);
  }

  /**
   * Checks the code entered for a waiting sign-in: the authenticator code (which also finishes setup when setup was
   * required) or a recovery code. Returns who signed in and how; the caller issues the session. A challenge is used up
   * by its first success, or by too many wrong codes.
   */
  completeChallenge(input: { token: string; code?: string | undefined; recoveryCode?: string | undefined } & RequestMeta): {
    method: "code" | "recovery_code";
    persistent: boolean;
    recoveryCodes?: string[];
    user: UserRecord;
  } {
    const challenge = this.requireChallenge(input.token);
    const user = this.activeUser(challenge.user_id);
    this.options.checkRateLimit(`two-step:user:${user.id}`, CODE_ATTEMPT_LIMIT, CODE_ATTEMPT_WINDOW_SECONDS);
    const code = input.code?.trim() ?? "";
    const recoveryCode = input.recoveryCode?.trim() ?? "";
    if (!code && !recoveryCode) {
      throw new AuthError(400, "BAD_REQUEST", "Enter the 6-digit code from your authenticator app.");
    }
    let method: "code" | "recovery_code" | undefined;
    let recoveryCodes: string[] | undefined;
    if (challenge.purpose === "enroll") {
      recoveryCodes = this.confirmPendingSetup(user, code, input);
      if (recoveryCodes) method = "code";
    } else {
      method = this.acceptCodeOrRecoveryCode(user, recoveryCode || code);
    }
    if (!method) {
      const attempts = this.metadataStore.authTwoStep.recordChallengeAttempt(challenge.id);
      this.options.audit("auth.two_step_failed", {
        email: user.email,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        userId: user.id,
        metadata: { attempts }
      });
      if (attempts >= MAX_CHALLENGE_ATTEMPTS) {
        this.metadataStore.authTwoStep.consumeChallenge(challenge.id);
        throw new AuthError(401, "UNAUTHORIZED", "Too many wrong codes. Sign in again to try once more.");
      }
      const triedRecoveryCode = challenge.purpose === "verify" && (recoveryCode !== "" || !isAuthenticatorCode(code));
      throw new AuthError(401, "UNAUTHORIZED", triedRecoveryCode ? WRONG_RECOVERY_CODE : WRONG_CODE);
    }
    if (!this.metadataStore.authTwoStep.consumeChallenge(challenge.id)) {
      throw new AuthError(401, "UNAUTHORIZED", SIGN_IN_EXPIRED);
    }
    return { method, persistent: challenge.persistent, user, ...(recoveryCodes ? { recoveryCodes } : {}) };
  }

  /** Self-service: the secret and link to add to an authenticator app. Nothing changes until a code confirms it. */
  beginSetup(user: UserRecord): TwoStepSetup {
    if (this.isEnabled(user.id)) throw new AuthError(409, "CONFLICT", "Two-step verification is already on.");
    return this.pendingOrNewSetup(user);
  }

  /** Self-service: turns two-step verification on once the first code checks out. The recovery codes are shown once. */
  confirmSetup(user: UserRecord, code: string, meta: RequestMeta = {}): { recoveryCodes: string[]; status: TwoStepStatus } {
    this.options.checkRateLimit(`two-step:user:${user.id}`, CODE_ATTEMPT_LIMIT, CODE_ATTEMPT_WINDOW_SECONDS);
    const factor = this.metadataStore.authTwoStep.findFactor(user.id);
    if (!factor || factor.confirmed_at) {
      throw new AuthError(409, "CONFLICT", factor ? "Two-step verification is already on." : "Start setting up two-step verification first.");
    }
    const recoveryCodes = this.confirmPendingSetup(user, code, meta);
    if (!recoveryCodes) throw new AuthError(400, "BAD_REQUEST", WRONG_CODE);
    return { recoveryCodes, status: this.status(user) };
  }

  /** Self-service: a fresh set of recovery codes; the old ones stop working. Needs a current code. */
  regenerateRecoveryCodes(user: UserRecord, code: string, meta: RequestMeta = {}): { recoveryCodes: string[]; status: TwoStepStatus } {
    this.requireEnabled(user);
    this.options.checkRateLimit(`two-step:user:${user.id}`, CODE_ATTEMPT_LIMIT, CODE_ATTEMPT_WINDOW_SECONDS);
    if (!this.acceptAuthenticatorCode(user, code)) throw new AuthError(400, "BAD_REQUEST", WRONG_CODE);
    const recoveryCodes = this.issueRecoveryCodes(user.id);
    this.options.audit("auth.two_step_recovery_codes_regenerated", { email: user.email, userId: user.id, ...meta });
    return { recoveryCodes, status: this.status(user) };
  }

  /** Self-service: turns it off with a current code (or a recovery code). Refused while it is required. */
  disable(user: UserRecord, code: string, meta: RequestMeta = {}): TwoStepStatus {
    this.requireEnabled(user);
    const requiredBy = this.requirement(user);
    if (requiredBy) {
      throw new AuthError(409, "CONFLICT", requiredBy === "organisation"
        ? "Your organisation requires two-step verification, so it can't be turned off."
        : "Platform administrators must use two-step verification, so it can't be turned off.");
    }
    this.options.checkRateLimit(`two-step:user:${user.id}`, CODE_ATTEMPT_LIMIT, CODE_ATTEMPT_WINDOW_SECONDS);
    if (!this.acceptCodeOrRecoveryCode(user, code)) {
      throw new AuthError(400, "BAD_REQUEST", isAuthenticatorCode(code) ? WRONG_CODE : WRONG_RECOVERY_CODE);
    }
    this.removeFactor(user.id);
    this.options.audit("auth.two_step_disabled", { email: user.email, userId: user.id, ...meta });
    return this.status(user);
  }

  /**
   * A platform admin's reset for someone who lost their authenticator: their two-step verification and recovery codes
   * are removed and they are signed out everywhere. If it is required, they set it up again at their next sign-in.
   */
  adminReset(input: { actor: UserRecord; userId: string }): void {
    if (resolveEnergyIqUserRole(this.metadataStore, input.actor) !== "admin") {
      throw new AuthError(403, "FORBIDDEN", "Only a platform administrator can reset two-step verification.");
    }
    let target: UserRecord;
    try {
      target = this.metadataStore.users.getById({ user_id: input.userId });
    } catch {
      throw new AuthError(404, "RESOURCE_NOT_FOUND", "User not found.");
    }
    const hadTwoStep = this.isEnabled(target.id);
    this.removeFactor(target.id);
    this.metadataStore.authTwoStep.consumeChallengesByUser(target.id);
    this.metadataStore.authSessions.revokeByUser({ user_id: target.id });
    this.options.audit("auth.two_step_reset", {
      email: input.actor.email,
      userId: input.actor.id,
      metadata: { targetUserId: target.id, hadTwoStep }
    });
  }

  organisationSetting(workspaceId: string): TwoStepOrganisationSetting {
    return {
      required: this.metadataStore.authTwoStep.isRequiredByOrganisation(workspaceId),
      membersWithoutTwoStep: this.metadataStore.authTwoStep.countMembersWithoutTwoStep(workspaceId)
    };
  }

  /** The caller has already checked the actor may manage this Organisation's people. */
  setOrganisationRequirement(input: { actor: UserRecord; workspaceId: string; required: boolean }): TwoStepOrganisationSetting {
    const before = this.metadataStore.authTwoStep.isRequiredByOrganisation(input.workspaceId);
    this.metadataStore.authTwoStep.setRequiredByOrganisation({
      workspace_id: input.workspaceId,
      required: input.required,
      updated_by: input.actor.id
    });
    if (before !== input.required) {
      this.options.audit("energyiq.organisation_two_step_changed", {
        email: input.actor.email,
        userId: input.actor.id,
        metadata: { organisationId: input.workspaceId, required: input.required }
      });
    }
    return this.organisationSetting(input.workspaceId);
  }

  private issueChallenge(user: UserRecord, purpose: "verify" | "enroll", input: RequestMeta & { persistent: boolean }): TwoStepPrompt {
    // Starting a new sign-in ends any earlier one still waiting for a code.
    this.metadataStore.authTwoStep.consumeChallengesByUser(user.id);
    const token = createSecretToken();
    const expiresAt = new Date(Date.now() + (purpose === "enroll" ? ENROLL_CHALLENGE_TTL_MS : VERIFY_CHALLENGE_TTL_MS)).toISOString();
    this.metadataStore.authTwoStep.createChallenge({
      id: randomUUID(),
      user_id: user.id,
      token_hash: hashToken(token, this.options.sessionSecret),
      purpose,
      persistent: input.persistent,
      expires_at: expiresAt,
      ...(input.ipAddress ? { ip_address: input.ipAddress } : {}),
      ...(input.userAgent ? { user_agent: input.userAgent } : {})
    });
    this.options.audit(purpose === "enroll" ? "auth.two_step_setup_requested" : "auth.two_step_code_requested", {
      email: user.email,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      userId: user.id
    });
    return { mode: purpose, challenge: token, expiresAt };
  }

  private requireChallenge(token: string): AuthTwoStepChallengeRecord {
    const challenge = token
      ? this.metadataStore.authTwoStep.findValidChallenge({ token_hash: hashToken(token, this.options.sessionSecret) })
      : undefined;
    if (!challenge) throw new AuthError(401, "UNAUTHORIZED", SIGN_IN_EXPIRED);
    return challenge;
  }

  private activeUser(userId: string): UserRecord {
    const user = this.metadataStore.users.getById({ user_id: userId });
    if (user.disabled_at) throw new AuthError(401, "UNAUTHORIZED", SIGN_IN_EXPIRED);
    return user;
  }

  private requireEnabled(user: UserRecord): void {
    if (!this.isEnabled(user.id)) throw new AuthError(409, "CONFLICT", "Two-step verification is not on.");
  }

  private pendingOrNewSetup(user: UserRecord): TwoStepSetup {
    if (!this.available()) {
      throw new AuthError(503, "NOT_ENABLED", "Two-step verification can't be set up on this server yet. Ask your EnergyX administrator.");
    }
    const pending = this.metadataStore.authTwoStep.findFactor(user.id);
    // Reloading the page, or starting again, shows the same unfinished setup so an app that already added it keeps working.
    if (pending && !pending.confirmed_at) return this.setupFor(user, this.readSecret(user.id, pending.secret_ref));
    const secret = createTotpSecret();
    const ref = this.metadataStore.secrets.put({
      workspace_id: SECRET_SCOPE,
      user_id: user.id,
      owner_kind: SECRET_OWNER_KIND,
      owner_id: user.id,
      value: { secret }
    });
    this.metadataStore.authTwoStep.savePendingFactor({ user_id: user.id, secret_ref: ref });
    if (pending) this.deleteSecret(user.id, pending.secret_ref);
    return this.setupFor(user, secret);
  }

  /** Finishes an unfinished setup with its first code. The new recovery codes, or undefined for a wrong code. */
  private confirmPendingSetup(user: UserRecord, code: string, meta: RequestMeta): string[] | undefined {
    const factor = this.metadataStore.authTwoStep.findFactor(user.id);
    if (!factor || factor.confirmed_at) return undefined;
    const step = matchTotpStep(this.readSecret(user.id, factor.secret_ref), code);
    if (step === undefined || !this.metadataStore.authTwoStep.confirmFactor({ user_id: user.id, step })) return undefined;
    const recoveryCodes = this.issueRecoveryCodes(user.id);
    this.options.audit("auth.two_step_enabled", { email: user.email, userId: user.id, ...meta });
    return recoveryCodes;
  }

  /** A current authenticator code that has not been used before. Each one is accepted once only. */
  private acceptAuthenticatorCode(user: UserRecord, code: string): boolean {
    const factor = this.metadataStore.authTwoStep.findFactor(user.id);
    if (!factor?.confirmed_at) return false;
    const step = matchTotpStep(this.readSecret(user.id, factor.secret_ref), code);
    return step !== undefined && this.metadataStore.authTwoStep.claimStep({ user_id: user.id, step });
  }

  /** Six digits are an authenticator code; anything else is tried as a recovery code, which is then used up. */
  private acceptCodeOrRecoveryCode(user: UserRecord, value: string): "code" | "recovery_code" | undefined {
    if (isAuthenticatorCode(value)) return this.acceptAuthenticatorCode(user, value) ? "code" : undefined;
    const normalized = normalizeRecoveryCode(value);
    if (!normalized) return undefined;
    const used = this.metadataStore.authTwoStep.consumeRecoveryCode({ user_id: user.id, code_hash: this.hashRecoveryCode(normalized) });
    if (!used) return undefined;
    this.options.audit("auth.two_step_recovery_code_used", {
      email: user.email,
      userId: user.id,
      metadata: { recoveryCodesLeft: this.metadataStore.authTwoStep.countUnusedRecoveryCodes(user.id) }
    });
    return "recovery_code";
  }

  private issueRecoveryCodes(userId: string): string[] {
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, createRecoveryCode);
    this.metadataStore.authTwoStep.replaceRecoveryCodes({
      user_id: userId,
      code_hashes: codes.map((code) => this.hashRecoveryCode(normalizeRecoveryCode(code)))
    });
    return codes;
  }

  private hashRecoveryCode(normalized: string): string {
    return hashToken(`two-step-recovery:${normalized}`, this.options.sessionSecret);
  }

  private removeFactor(userId: string): void {
    const factor = this.metadataStore.authTwoStep.findFactor(userId);
    this.metadataStore.authTwoStep.deleteFactor(userId);
    if (factor) this.deleteSecret(userId, factor.secret_ref);
  }

  private readSecret(userId: string, ref: string): string {
    let value: Record<string, unknown>;
    try {
      value = this.metadataStore.secrets.get({ ref, workspace_id: SECRET_SCOPE, user_id: userId });
    } catch {
      throw new AuthError(503, "NOT_ENABLED", "Two-step verification isn't working on this server right now. Use a recovery code, or ask your EnergyX administrator.");
    }
    if (typeof value.secret !== "string") throw new Error("TWO_STEP_SECRET_INVALID");
    return value.secret;
  }

  private deleteSecret(userId: string, ref: string): void {
    this.metadataStore.secrets.delete({ ref, workspace_id: SECRET_SCOPE, user_id: userId });
  }

  private setupFor(user: UserRecord, secret: string): TwoStepSetup {
    return { secret, otpauthUri: totpUri({ secret, accountName: user.email ?? user.id, issuer: ISSUER }) };
  }
}

const isAuthenticatorCode = (value: string): boolean => /^\d{6}$/u.test(value.replace(/\s+/gu, ""));

const normalizeRecoveryCode = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/gu, "");

/** Ten characters shown as two groups of five, for example "k7m2p-q9xtr": about 49 bits of randomness. */
const createRecoveryCode = (): string => {
  const characters = Array.from({ length: 10 }, () => RECOVERY_CODE_ALPHABET[randomInt(RECOVERY_CODE_ALPHABET.length)]).join("");
  return `${characters.slice(0, 5)}-${characters.slice(5)}`;
};
