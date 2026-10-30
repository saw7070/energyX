import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

/**
 * Two-step verification for password sign-in: an authenticator-app factor per person, their one-time recovery codes,
 * the short-lived challenges that sit between a correct password and a session, and the Organisation setting that
 * requires it. The authenticator secret itself lives in `encrypted_secrets` (AES-GCM under SECRET_MASTER_KEY); this
 * store keeps only a reference to it. Recovery codes and challenges are stored as keyed hashes, never as text.
 */

export type AuthTwoStepFactorRecord = {
  user_id: string;
  secret_ref: string;
  /** Set once the person has entered a first code. Until then setup is unfinished and the factor is not used. */
  confirmed_at?: string;
  /** The last 30-second time step a code was accepted for, so no code is accepted twice. */
  last_used_step?: number;
  created_at: string;
  updated_at: string;
};

/** "verify": enter a code to finish signing in. "enroll": set up an authenticator first, because it is required. */
export type AuthTwoStepChallengePurpose = "verify" | "enroll";

export type AuthTwoStepChallengeRecord = {
  id: string;
  user_id: string;
  purpose: AuthTwoStepChallengePurpose;
  /** Whether the session issued at the end should outlive the browser ("Remember me"). */
  persistent: boolean;
  attempts: number;
  ip_address?: string;
  user_agent?: string;
  expires_at: string;
  consumed_at?: string;
  created_at: string;
};

export const initializeAuthTwoStepSchema = (db: DatabaseSync): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_two_step_factors (
      user_id TEXT PRIMARY KEY,
      secret_ref TEXT NOT NULL,
      confirmed_at TEXT,
      last_used_step INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS auth_two_step_recovery_codes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_auth_two_step_recovery_codes_user
      ON auth_two_step_recovery_codes(user_id, code_hash);

    CREATE TABLE IF NOT EXISTS auth_two_step_challenges (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      purpose TEXT NOT NULL CHECK (purpose IN ('verify', 'enroll')),
      persistent INTEGER NOT NULL CHECK (persistent IN (0, 1)),
      attempts INTEGER NOT NULL DEFAULT 0,
      ip_address TEXT,
      user_agent TEXT,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_auth_two_step_challenges_user
      ON auth_two_step_challenges(user_id, consumed_at);

    CREATE TABLE IF NOT EXISTS workspace_two_step_requirements (
      workspace_id TEXT PRIMARY KEY,
      required INTEGER NOT NULL CHECK (required IN (0, 1)),
      updated_by TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    );
  `);
};

export class AuthTwoStepStore {
  constructor(private readonly db: DatabaseSync) {}

  findFactor(userId: string): AuthTwoStepFactorRecord | undefined {
    return mapFactor(this.db.prepare("SELECT * FROM auth_two_step_factors WHERE user_id = ?").get(userId));
  }

  /** True once the person has finished setting up an authenticator app. */
  isEnabled(userId: string): boolean {
    return Boolean(this.findFactor(userId)?.confirmed_at);
  }

  /** Starts setup with a new secret. Any earlier factor is replaced, and its recovery codes go with it. */
  savePendingFactor(input: { user_id: string; secret_ref: string }): AuthTwoStepFactorRecord {
    const now = new Date().toISOString();
    this.db.prepare("DELETE FROM auth_two_step_recovery_codes WHERE user_id = ?").run(input.user_id);
    this.db.prepare(`
      INSERT INTO auth_two_step_factors (user_id, secret_ref, confirmed_at, last_used_step, created_at, updated_at)
      VALUES (?, ?, NULL, NULL, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        secret_ref = excluded.secret_ref,
        confirmed_at = NULL,
        last_used_step = NULL,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `).run(input.user_id, input.secret_ref, now, now);
    return this.findFactor(input.user_id)!;
  }

  /** Finishes setup with the time step of the first accepted code. False if setup was already finished. */
  confirmFactor(input: { user_id: string; step: number }): boolean {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE auth_two_step_factors SET confirmed_at = ?, last_used_step = ?, updated_at = ?
      WHERE user_id = ? AND confirmed_at IS NULL
    `).run(now, input.step, now, input.user_id);
    return Number(result.changes) === 1;
  }

  /**
   * Records that a code for `step` was accepted. False when that step, or a later one, was already used: the code is
   * being replayed. Done as one conditional update so two requests racing with the same code cannot both succeed.
   */
  claimStep(input: { user_id: string; step: number }): boolean {
    const result = this.db.prepare(`
      UPDATE auth_two_step_factors SET last_used_step = ?, updated_at = ?
      WHERE user_id = ? AND confirmed_at IS NOT NULL AND (last_used_step IS NULL OR last_used_step < ?)
    `).run(input.step, new Date().toISOString(), input.user_id, input.step);
    return Number(result.changes) === 1;
  }

  /** Removes the factor and its recovery codes. The caller removes the encrypted secret. */
  deleteFactor(userId: string): void {
    this.db.prepare("DELETE FROM auth_two_step_recovery_codes WHERE user_id = ?").run(userId);
    this.db.prepare("DELETE FROM auth_two_step_factors WHERE user_id = ?").run(userId);
  }

  replaceRecoveryCodes(input: { user_id: string; code_hashes: string[] }): void {
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM auth_two_step_recovery_codes WHERE user_id = ?").run(input.user_id);
      const insert = this.db.prepare(`
        INSERT INTO auth_two_step_recovery_codes (id, user_id, code_hash, used_at, created_at) VALUES (?, ?, ?, NULL, ?)
      `);
      for (const codeHash of input.code_hashes) insert.run(randomUUID(), input.user_id, codeHash, now);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /** Uses up one recovery code. False when it does not exist or was already used. */
  consumeRecoveryCode(input: { user_id: string; code_hash: string }): boolean {
    const result = this.db.prepare(`
      UPDATE auth_two_step_recovery_codes SET used_at = ?
      WHERE id = (
        SELECT id FROM auth_two_step_recovery_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL LIMIT 1
      )
    `).run(new Date().toISOString(), input.user_id, input.code_hash);
    return Number(result.changes) === 1;
  }

  countUnusedRecoveryCodes(userId: string): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS n FROM auth_two_step_recovery_codes WHERE user_id = ? AND used_at IS NULL
    `).get(userId) as { n?: number } | undefined;
    return Number(row?.n ?? 0);
  }

  createChallenge(input: {
    id: string;
    user_id: string;
    token_hash: string;
    purpose: AuthTwoStepChallengePurpose;
    persistent: boolean;
    expires_at: string;
    ip_address?: string;
    user_agent?: string;
  }): AuthTwoStepChallengeRecord {
    this.db.prepare(`
      INSERT INTO auth_two_step_challenges (
        id, user_id, token_hash, purpose, persistent, attempts, ip_address, user_agent, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
    `).run(
      input.id,
      input.user_id,
      input.token_hash,
      input.purpose,
      input.persistent ? 1 : 0,
      input.ip_address ?? null,
      input.user_agent ?? null,
      input.expires_at,
      new Date().toISOString(),
    );
    return mapChallenge(this.db.prepare("SELECT * FROM auth_two_step_challenges WHERE id = ?").get(input.id))!;
  }

  /** An unexpired, unused challenge, or undefined. */
  findValidChallenge(input: { token_hash: string; now?: string }): AuthTwoStepChallengeRecord | undefined {
    return mapChallenge(this.db.prepare(`
      SELECT * FROM auth_two_step_challenges WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?
    `).get(input.token_hash, input.now ?? new Date().toISOString()));
  }

  /** Counts one wrong code against the challenge and returns the new total. */
  recordChallengeAttempt(id: string): number {
    this.db.prepare("UPDATE auth_two_step_challenges SET attempts = attempts + 1 WHERE id = ?").run(id);
    const row = this.db.prepare("SELECT attempts FROM auth_two_step_challenges WHERE id = ?").get(id) as { attempts?: number } | undefined;
    return Number(row?.attempts ?? 0);
  }

  /** Uses the challenge up. False when it was already used, so it can only ever produce one session. */
  consumeChallenge(id: string): boolean {
    const result = this.db.prepare(`
      UPDATE auth_two_step_challenges SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL
    `).run(new Date().toISOString(), id);
    return Number(result.changes) === 1;
  }

  consumeChallengesByUser(userId: string): void {
    this.db.prepare(`
      UPDATE auth_two_step_challenges SET consumed_at = ? WHERE user_id = ? AND consumed_at IS NULL
    `).run(new Date().toISOString(), userId);
  }

  isRequiredByOrganisation(workspaceId: string): boolean {
    const row = this.db.prepare("SELECT required FROM workspace_two_step_requirements WHERE workspace_id = ?")
      .get(workspaceId) as { required?: number } | undefined;
    return Number(row?.required ?? 0) === 1;
  }

  setRequiredByOrganisation(input: { workspace_id: string; required: boolean; updated_by: string }): void {
    this.db.prepare(`
      INSERT INTO workspace_two_step_requirements (workspace_id, required, updated_by, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(workspace_id) DO UPDATE SET
        required = excluded.required,
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at
    `).run(input.workspace_id, input.required ? 1 : 0, input.updated_by, new Date().toISOString());
  }

  /** The active Organisations this person belongs to that require two-step verification. */
  requiringOrganisationIds(userId: string): string[] {
    return this.db.prepare(`
      SELECT m.workspace_id AS id
      FROM workspace_memberships m
      JOIN workspace_two_step_requirements r ON r.workspace_id = m.workspace_id AND r.required = 1
      JOIN workspaces w ON w.id = m.workspace_id AND w.disabled_at IS NULL
      WHERE m.user_id = ?
      ORDER BY m.workspace_id
    `).all(userId).map((row) => String((row as { id: unknown }).id));
  }

  /** How many enabled members of an Organisation have not finished setting up two-step verification. */
  countMembersWithoutTwoStep(workspaceId: string): number {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS n
      FROM workspace_memberships m
      JOIN users u ON u.id = m.user_id AND u.disabled_at IS NULL
      LEFT JOIN auth_two_step_factors f ON f.user_id = m.user_id AND f.confirmed_at IS NOT NULL
      WHERE m.workspace_id = ? AND m.role <> 'owner' AND f.user_id IS NULL
    `).get(workspaceId) as { n?: number } | undefined;
    return Number(row?.n ?? 0);
  }
}

const mapFactor = (row: unknown): AuthTwoStepFactorRecord | undefined => {
  if (!row || typeof row !== "object") return undefined;
  const value = row as Record<string, unknown>;
  return {
    user_id: String(value.user_id),
    secret_ref: String(value.secret_ref),
    ...(typeof value.confirmed_at === "string" ? { confirmed_at: value.confirmed_at } : {}),
    ...(value.last_used_step !== null && value.last_used_step !== undefined ? { last_used_step: Number(value.last_used_step) } : {}),
    created_at: String(value.created_at),
    updated_at: String(value.updated_at),
  };
};

const mapChallenge = (row: unknown): AuthTwoStepChallengeRecord | undefined => {
  if (!row || typeof row !== "object") return undefined;
  const value = row as Record<string, unknown>;
  return {
    id: String(value.id),
    user_id: String(value.user_id),
    purpose: value.purpose === "enroll" ? "enroll" : "verify",
    persistent: Number(value.persistent) === 1,
    attempts: Number(value.attempts ?? 0),
    ...(typeof value.ip_address === "string" ? { ip_address: value.ip_address } : {}),
    ...(typeof value.user_agent === "string" ? { user_agent: value.user_agent } : {}),
    expires_at: String(value.expires_at),
    ...(typeof value.consumed_at === "string" ? { consumed_at: value.consumed_at } : {}),
    created_at: String(value.created_at),
  };
};
