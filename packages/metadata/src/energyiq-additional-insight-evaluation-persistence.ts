import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type EvaluationSchemaMigrationFault = "rename" | "create" | "copy" | "foreign-key-check";

/** Internal persistence boundary for schema recovery and durable claim fencing. */
export const initializeAdditionalInsightEvaluationPersistence = (db: DatabaseSync): void => {
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_energyiq_projects_id_workspace
      ON energyiq_projects(id, workspace_id);
    CREATE TABLE IF NOT EXISTS energyiq_additional_insight_evaluations (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL,
      scope_id TEXT NOT NULL, requested_by TEXT NOT NULL, idempotency_key TEXT NOT NULL,
      reservation_json TEXT NOT NULL, record_json TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(workspace_id, project_id, idempotency_key), UNIQUE(id, workspace_id, project_id),
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY(project_id, workspace_id) REFERENCES energyiq_projects(id, workspace_id) ON DELETE CASCADE,
      FOREIGN KEY(requested_by) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_energyiq_additional_evaluations_target
      ON energyiq_additional_insight_evaluations(workspace_id, project_id, scope_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS energyiq_additional_insight_evaluation_artifacts (
      evaluation_id TEXT NOT NULL, attempt_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, result_json TEXT NOT NULL,
      PRIMARY KEY(evaluation_id, attempt_id),
      FOREIGN KEY(evaluation_id, workspace_id, project_id)
        REFERENCES energyiq_additional_insight_evaluations(id, workspace_id, project_id) ON DELETE CASCADE,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY(project_id, workspace_id) REFERENCES energyiq_projects(id, workspace_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS energyiq_additional_insight_transitions (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL,
      scope_id TEXT NOT NULL, requested_by TEXT NOT NULL, idempotency_key TEXT NOT NULL,
      reservation_json TEXT NOT NULL, record_json TEXT, current_artifact_json TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(workspace_id, project_id, idempotency_key), UNIQUE(id, workspace_id, project_id),
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY(project_id, workspace_id) REFERENCES energyiq_projects(id, workspace_id) ON DELETE CASCADE,
      FOREIGN KEY(requested_by) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS energyiq_additional_insight_evaluation_claims (
      evaluation_id TEXT NOT NULL, attempt_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL, project_id TEXT NOT NULL,
      claim_token TEXT NOT NULL, lease_expires_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(evaluation_id, attempt_id),
      FOREIGN KEY(evaluation_id, workspace_id, project_id)
        REFERENCES energyiq_additional_insight_evaluations(id, workspace_id, project_id) ON DELETE CASCADE,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY(project_id, workspace_id) REFERENCES energyiq_projects(id, workspace_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS energyiq_additional_insight_transition_claims (
      transition_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL,
      claim_token TEXT NOT NULL, lease_expires_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY(transition_id, workspace_id, project_id)
        REFERENCES energyiq_additional_insight_transitions(id, workspace_id, project_id) ON DELETE CASCADE,
      FOREIGN KEY(workspace_id) REFERENCES workspaces(id),
      FOREIGN KEY(project_id, workspace_id) REFERENCES energyiq_projects(id, workspace_id) ON DELETE CASCADE
    );
  `);
};

export const ensureAdditionalInsightEvaluationPersistence = (input: {
  db: DatabaseSync;
  copyLegacyRows(): void;
  faultAfterStep?: EvaluationSchemaMigrationFault;
}): void => {
  const { db } = input;
  const hasIntermediate = tableExists(db, "energyiq_additional_insight_evaluations_0033");
  const columns = db.prepare("PRAGMA table_info(energyiq_additional_insight_evaluations)").all();
  if (!hasIntermediate && columns.length === 0) {
    initializeAdditionalInsightEvaluationPersistence(db);
    return;
  }
  if (!hasIntermediate && schemaIsHardened(db)) {
    initializeAdditionalInsightEvaluationPersistence(db);
    return;
  }
  if (hasIntermediate) requireRecoverableIntermediateTables(db);

  db.exec("PRAGMA foreign_keys = OFF");
  db.exec("BEGIN IMMEDIATE");
  try {
    if (hasIntermediate) {
      dropEmptyHardenedTables(db);
    } else {
      db.exec(`
        ALTER TABLE energyiq_additional_insight_evaluation_artifacts
          RENAME TO energyiq_additional_insight_evaluation_artifacts_0033;
        ALTER TABLE energyiq_additional_insight_evaluations
          RENAME TO energyiq_additional_insight_evaluations_0033;
        ALTER TABLE energyiq_additional_insight_transitions
          RENAME TO energyiq_additional_insight_transitions_0033;
      `);
    }
    migrationFault(input.faultAfterStep, "rename");
    initializeAdditionalInsightEvaluationPersistence(db);
    migrationFault(input.faultAfterStep, "create");
    input.copyLegacyRows();
    migrationFault(input.faultAfterStep, "copy");
    if (db.prepare("PRAGMA foreign_key_check").all().length > 0) {
      throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_0034_FOREIGN_KEY_INVALID");
    }
    migrationFault(input.faultAfterStep, "foreign-key-check");
    db.exec(`
      DROP TABLE energyiq_additional_insight_evaluation_artifacts_0033;
      DROP TABLE energyiq_additional_insight_evaluations_0033;
      DROP TABLE energyiq_additional_insight_transitions_0033;
    `);
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* no active transaction */ }
    throw error;
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
  initializeAdditionalInsightEvaluationPersistence(db);
};

type ClaimIdentity = {
  workspaceId: string;
  projectId: string;
  now: string;
  leaseMs?: number;
};

export const acquireEvaluationAttemptClaimPersistence = (
  db: DatabaseSync,
  input: ClaimIdentity & { evaluationId: string; attemptId: string },
): string | undefined => {
  const existing = db.prepare(`
    SELECT lease_expires_at FROM energyiq_additional_insight_evaluation_claims
    WHERE evaluation_id = ? AND attempt_id = ? AND workspace_id = ? AND project_id = ?
  `).get(input.evaluationId, input.attemptId, input.workspaceId, input.projectId);
  if (isRecord(existing) && typeof existing.lease_expires_at === "string"
    && existing.lease_expires_at > input.now) return undefined;
  const token = randomUUID();
  db.prepare(`
    INSERT INTO energyiq_additional_insight_evaluation_claims (
      evaluation_id, attempt_id, workspace_id, project_id, claim_token, lease_expires_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(evaluation_id, attempt_id) DO UPDATE SET
      claim_token = excluded.claim_token, lease_expires_at = excluded.lease_expires_at,
      updated_at = excluded.updated_at
  `).run(
    input.evaluationId, input.attemptId, input.workspaceId, input.projectId,
    token, leaseExpiry(input.now, input.leaseMs), input.now,
  );
  return token;
};

export const acquireTransitionClaimPersistence = (
  db: DatabaseSync,
  input: ClaimIdentity & { transitionId: string },
): string | undefined => {
  const existing = db.prepare(`
    SELECT lease_expires_at FROM energyiq_additional_insight_transition_claims
    WHERE transition_id = ? AND workspace_id = ? AND project_id = ?
  `).get(input.transitionId, input.workspaceId, input.projectId);
  if (isRecord(existing) && typeof existing.lease_expires_at === "string"
    && existing.lease_expires_at > input.now) return undefined;
  const token = randomUUID();
  db.prepare(`
    INSERT INTO energyiq_additional_insight_transition_claims (
      transition_id, workspace_id, project_id, claim_token, lease_expires_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(transition_id) DO UPDATE SET
      claim_token = excluded.claim_token, lease_expires_at = excluded.lease_expires_at,
      updated_at = excluded.updated_at
  `).run(
    input.transitionId, input.workspaceId, input.projectId,
    token, leaseExpiry(input.now, input.leaseMs), input.now,
  );
  return token;
};

export const renewEvaluationAttemptClaimPersistence = (
  db: DatabaseSync,
  input: ClaimIdentity & { evaluationId: string; attemptId: string; claimToken: string },
): void => {
  const result = db.prepare(`
    UPDATE energyiq_additional_insight_evaluation_claims SET lease_expires_at = ?, updated_at = ?
    WHERE evaluation_id = ? AND attempt_id = ? AND workspace_id = ? AND project_id = ?
      AND claim_token = ? AND lease_expires_at > ?
  `).run(
    leaseExpiry(input.now, input.leaseMs), input.now, input.evaluationId, input.attemptId,
    input.workspaceId, input.projectId, input.claimToken, input.now,
  );
  if (result.changes !== 1) throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_CLAIM_CONFLICT");
};

export const renewTransitionClaimPersistence = (
  db: DatabaseSync,
  input: ClaimIdentity & { transitionId: string; claimToken: string },
): void => {
  const result = db.prepare(`
    UPDATE energyiq_additional_insight_transition_claims SET lease_expires_at = ?, updated_at = ?
    WHERE transition_id = ? AND workspace_id = ? AND project_id = ?
      AND claim_token = ? AND lease_expires_at > ?
  `).run(
    leaseExpiry(input.now, input.leaseMs), input.now, input.transitionId,
    input.workspaceId, input.projectId, input.claimToken, input.now,
  );
  if (result.changes !== 1) throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_CLAIM_CONFLICT");
};

export const requireEvaluationAttemptClaimPersistence = (
  db: DatabaseSync,
  input: { evaluationId: string; attemptId: string; workspaceId: string; projectId: string; claimToken: string; completedAt: string },
): void => requireClaim(db, {
  table: "energyiq_additional_insight_evaluation_claims",
  idColumns: "evaluation_id = ? AND attempt_id = ?",
  idValues: [input.evaluationId, input.attemptId],
  ...input,
  code: "ENERGYIQ_ADDITIONAL_EVALUATION_CLAIM_CONFLICT",
});

export const requireTransitionClaimPersistence = (
  db: DatabaseSync,
  input: { transitionId: string; workspaceId: string; projectId: string; claimToken: string; completedAt: string },
): void => requireClaim(db, {
  table: "energyiq_additional_insight_transition_claims",
  idColumns: "transition_id = ?",
  idValues: [input.transitionId],
  ...input,
  code: "ENERGYIQ_ADDITIONAL_TRANSITION_CLAIM_CONFLICT",
});

const requireClaim = (
  db: DatabaseSync,
  input: {
    table: string; idColumns: string; idValues: string[]; workspaceId: string; projectId: string;
    claimToken: string; completedAt: string; code: string;
  },
): void => {
  const claim = db.prepare(`
    SELECT claim_token, lease_expires_at FROM ${input.table}
    WHERE ${input.idColumns} AND workspace_id = ? AND project_id = ?
  `).get(...input.idValues, input.workspaceId, input.projectId);
  if (!isRecord(claim) || !input.claimToken.trim() || claim.claim_token !== input.claimToken
    || typeof claim.lease_expires_at !== "string" || claim.lease_expires_at <= input.completedAt) {
    throw new Error(input.code);
  }
};

const leaseExpiry = (now: string, leaseMs = 5 * 60_000): string => {
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs) || !Number.isSafeInteger(leaseMs)
    || leaseMs < 1_000 || leaseMs > 30 * 60_000) {
    throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_CLAIM_LEASE_INVALID");
  }
  return new Date(nowMs + leaseMs).toISOString();
};

const tableExists = (db: DatabaseSync, name: string): boolean => isRecord(db.prepare(`
  SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?
`).get(name));

const schemaIsHardened = (db: DatabaseSync): boolean => {
  const columns = db.prepare("PRAGMA table_info(energyiq_additional_insight_evaluations)").all();
  const foreignKeys = db.prepare("PRAGMA foreign_key_list(energyiq_additional_insight_evaluation_artifacts)").all();
  return columns.some((row) => isRecord(row) && row.name === "reservation_json")
    && foreignKeys.some((row) => isRecord(row)
      && row.table === "energyiq_additional_insight_evaluations" && row.from === "workspace_id");
};

const requireRecoverableIntermediateTables = (db: DatabaseSync): void => {
  for (const table of [
    "energyiq_additional_insight_evaluations",
    "energyiq_additional_insight_evaluation_artifacts",
    "energyiq_additional_insight_transitions",
  ]) {
    if (!tableExists(db, table)) continue;
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
    if (!isRecord(row) || row.count !== 0) {
      throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_0034_INTERMEDIATE_AMBIGUOUS");
    }
  }
};

const dropEmptyHardenedTables = (db: DatabaseSync): void => db.exec(`
  DROP TABLE IF EXISTS energyiq_additional_insight_evaluation_claims;
  DROP TABLE IF EXISTS energyiq_additional_insight_transition_claims;
  DROP TABLE IF EXISTS energyiq_additional_insight_evaluation_artifacts;
  DROP TABLE IF EXISTS energyiq_additional_insight_transitions;
  DROP TABLE IF EXISTS energyiq_additional_insight_evaluations;
`);

const migrationFault = (requested: EvaluationSchemaMigrationFault | undefined, step: EvaluationSchemaMigrationFault): void => {
  if (requested === step) throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_0034_TEST_FAULT");
};

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null
  && typeof value === "object" && !Array.isArray(value);
