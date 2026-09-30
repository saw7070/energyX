import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import {
  additionalAiInsightEvaluationBatchIsValid,
  additionalAiInsightEvaluationTargetsCanTransition,
  additionalAiInsightHumanReviewIsPassing,
  additionalAiInsightTransitionRecordIsValid,
  additionalAiInsightTransitionIsValid,
  additionalAiInsightsArtifactIsValid,
  canonicalInsightMethodSetJson,
  evaluateAdditionalAiInsightPassAt3,
  resolveAdditionalAiInsightMethodSet,
  resolveCurrentAdditionalAiInsightMethodSet,
  type AdditionalAiInsightMethodResource,
  type AdditionalAiInsightEvaluationAttempt,
  type AdditionalAiInsightEvaluationBatch,
  type AdditionalAiInsightEvaluationHumanReview,
  type AdditionalAiInsightEvaluationTarget,
  type AdditionalAiInsightFailedTransitionRecord,
  type AdditionalAiInsightHumanScores,
  type AdditionalAiInsightTransitionArtifactAudit,
  type AdditionalAiInsightTransitionOutcome,
  type AdditionalAiInsightTransitionEvaluationRecord,
  type AdditionalAiInsightTransitionRecord,
  type AdditionalAiInsightsArtifact,
} from "@datafoundry/contracts";

import { EnergyIqInsightMethodGovernanceStore } from "./energyiq-insight-method-governance-store.js";
import type { ConfigResourceRecord } from "./config-store.js";
import {
  acquireEvaluationAttemptClaimPersistence,
  acquireTransitionClaimPersistence,
  ensureAdditionalInsightEvaluationPersistence,
  initializeAdditionalInsightEvaluationPersistence,
  renewEvaluationAttemptClaimPersistence,
  renewTransitionClaimPersistence,
  requireEvaluationAttemptClaimPersistence,
  requireTransitionClaimPersistence,
  type EvaluationSchemaMigrationFault,
} from "./energyiq-additional-insight-evaluation-persistence.js";

export type EnergyIqAdditionalInsightModelProfileSnapshot = {
  bindingRevision: number;
  profiles: Array<{
    exposedId: string;
    ownerWorkspaceId: string;
    ownerUserId: string;
    resource: ConfigResourceRecord;
  }>;
};

export const initializeEnergyIqAdditionalInsightEvaluationSchema =
  initializeAdditionalInsightEvaluationPersistence;

export const ensureEnergyIqAdditionalInsightEvaluationHardeningSchema = (
  db: DatabaseSync,
  options: { faultAfterStep?: EvaluationSchemaMigrationFault } = {},
): void => ensureAdditionalInsightEvaluationPersistence({
  db,
  copyLegacyRows: () => copyLegacyEvaluationRows(db),
  ...(options.faultAfterStep ? { faultAfterStep: options.faultAfterStep } : {}),
});

const copyLegacyEvaluationRows = (db: DatabaseSync): void => {
  const evaluationParents = new Map<string, { workspaceId: string; projectId: string }>();
  for (const rowValue of db.prepare("SELECT * FROM energyiq_additional_insight_evaluations_0033").all()) {
    const row = requireLegacyRow(rowValue, "ENERGYIQ_ADDITIONAL_EVALUATION_0033_RECORD_INVALID");
    const record = parseLegacyEvaluationRecord(row.record_json, String(row.id));
    const resources = requireLegacyTargetResources(record.target, db);
    requireActor(record.requestedBy, db);
    const reservation: EvaluationReservation = {
      target: clone(record.target),
      methodResources: clone(resources),
    };
    requireEvaluationReservation(reservation);
    db.prepare(`
      INSERT INTO energyiq_additional_insight_evaluations (
        id, workspace_id, project_id, scope_id, requested_by, idempotency_key,
        reservation_json, record_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.evaluationId,
      record.target.workspaceId,
      record.target.projectId,
      record.target.scopeId,
      record.requestedBy,
      record.idempotencyKey,
      JSON.stringify(reservation),
      JSON.stringify(record),
      String(row.created_at),
      String(row.updated_at),
    );
    evaluationParents.set(record.evaluationId, {
      workspaceId: record.target.workspaceId,
      projectId: record.target.projectId,
    });
  }

  for (const rowValue of db.prepare("SELECT * FROM energyiq_additional_insight_evaluation_artifacts_0033").all()) {
    const row = requireLegacyRow(rowValue, "ENERGYIQ_ADDITIONAL_EVALUATION_0033_ARTIFACT_INVALID");
    const parent = evaluationParents.get(String(row.evaluation_id));
    if (!parent) throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_0033_ARTIFACT_INVALID");
    db.prepare(`
      INSERT INTO energyiq_additional_insight_evaluation_artifacts (
        evaluation_id, attempt_id, workspace_id, project_id, result_json
      ) VALUES (?, ?, ?, ?, ?)
    `).run(
      String(row.evaluation_id),
      String(row.attempt_id),
      parent.workspaceId,
      parent.projectId,
      String(row.result_json),
    );
  }

  for (const rowValue of db.prepare("SELECT * FROM energyiq_additional_insight_transitions_0033").all()) {
    const row = requireLegacyRow(rowValue, "ENERGYIQ_ADDITIONAL_TRANSITION_0033_RECORD_INVALID");
    let raw: unknown;
    try { raw = JSON.parse(String(row.reservation_json)); } catch {
      throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_0033_RECORD_INVALID");
    }
    if (!isRecord(raw) || !isRecord(raw.currentTarget) || !nonEmpty(raw.requestedBy)) {
      throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_0033_RECORD_INVALID");
    }
    const currentTarget = raw.currentTarget as AdditionalAiInsightEvaluationTarget;
    const resources = Array.isArray(raw.methodResources)
      ? requireTarget(currentTarget, db, raw.methodResources as AdditionalAiInsightMethodResource[])
      : requireLegacyTargetResources(currentTarget, db);
    requireActor(raw.requestedBy, db);
    const reservation = {
      ...raw,
      methodResources: clone(resources),
    } as TransitionReservation;
    requireTransitionReservation(reservation);
    db.prepare(`
      INSERT INTO energyiq_additional_insight_transitions (
        id, workspace_id, project_id, scope_id, requested_by, idempotency_key,
        reservation_json, record_json, current_artifact_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      String(row.id),
      currentTarget.workspaceId,
      currentTarget.projectId,
      currentTarget.scopeId,
      raw.requestedBy,
      String(row.idempotency_key),
      JSON.stringify(reservation),
      typeof row.record_json === "string" ? row.record_json : null,
      typeof row.current_artifact_json === "string" ? row.current_artifact_json : null,
      String(row.created_at),
      String(row.updated_at),
    );
  }
};

const requireLegacyRow = (value: unknown, code: string): Record<string, unknown> => {
  if (!isRecord(value)) throw new Error(code);
  return value;
};

const requireLegacyTargetResources = (
  target: AdditionalAiInsightEvaluationTarget,
  db: DatabaseSync,
): AdditionalAiInsightMethodResource[] => {
  const builtinMethodSet = resolveCurrentAdditionalAiInsightMethodSet(target.workspaceId, []);
  try {
    return requireTarget(target, db, builtinMethodSet.resources);
  } catch (error) {
    if (error instanceof Error && error.message === "ENERGYIQ_ADDITIONAL_EVALUATION_TARGET_INVALID") {
      throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_0034_HISTORICAL_METHOD_RESOURCES_UNAVAILABLE");
    }
    throw error;
  }
};

const parseLegacyEvaluationRecord = (value: unknown, evaluationId: string): AdditionalAiInsightEvaluationBatch => {
  let record: unknown;
  try { record = typeof value === "string" ? JSON.parse(value) : value; } catch {
    throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_0033_RECORD_INVALID");
  }
  if (!isRecord(record) || !isRecord(record.target) || !Array.isArray(record.attempts)) {
    throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_0033_RECORD_INVALID");
  }
  for (const attempt of record.attempts) {
    if (!isRecord(attempt) || !nonEmpty(attempt.attemptId)) {
      throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_0033_RECORD_INVALID");
    }
    if (!isRecord(attempt.artifact)) {
      attempt.artifact = evaluationArtifactIdentity(
        record.target as AdditionalAiInsightEvaluationTarget,
        evaluationId,
        attempt.attemptId,
      );
    }
  }
  if (!additionalAiInsightEvaluationBatchIsValid(record)) {
    throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_0033_RECORD_INVALID");
  }
  return record;
};

type AttemptReservation = {
  attemptId: string;
  ordinal: number;
  providerRunId: string;
  providerSessionId: string;
};

type EvaluationReservation = {
  target: AdditionalAiInsightEvaluationTarget;
  runtimeIdentity?: Record<string, unknown>;
  methodResources: AdditionalAiInsightMethodResource[];
  modelProfileSnapshot?: EnergyIqAdditionalInsightModelProfileSnapshot;
};

type TransitionReservation = {
  transitionId: string;
  idempotencyKey: string;
  requestedBy: string;
  previousEvaluationId: string;
  previousAttemptId: string;
  previousArtifactId: string;
  previousArtifactIdentityHash: string;
  previousTarget: AdditionalAiInsightEvaluationTarget;
  currentTarget: AdditionalAiInsightEvaluationTarget;
  runtimeIdentity?: Record<string, unknown>;
  methodResources: AdditionalAiInsightMethodResource[];
  modelProfileSnapshot?: EnergyIqAdditionalInsightModelProfileSnapshot;
  currentArtifactId: string;
  currentArtifactIdentityHash: string;
  generationProviderRunId: string;
  generationProviderSessionId: string;
  comparisonProviderRunId: string;
  comparisonProviderSessionId: string;
  createdAt: string;
};

export class EnergyIqAdditionalInsightEvaluationStore {
  constructor(private readonly db: DatabaseSync) {}

  listEvaluations(input: {
    expectedWorkspaceId: string;
    expectedProjectId: string;
  }): AdditionalAiInsightEvaluationBatch[] {
    const rows = this.db.prepare(`
      SELECT id FROM energyiq_additional_insight_evaluations
      WHERE workspace_id = ? AND project_id = ?
      ORDER BY updated_at DESC, id DESC
      LIMIT 50
    `).all(input.expectedWorkspaceId, input.expectedProjectId);
    return rows.map((row) => {
      if (!isRecord(row) || typeof row.id !== "string") {
        throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_RECORD_INVALID");
      }
      return this.getEvaluation({
        evaluationId: row.id,
        expectedWorkspaceId: input.expectedWorkspaceId,
        expectedProjectId: input.expectedProjectId,
      });
    });
  }

  listTransitions(input: {
    expectedWorkspaceId: string;
    expectedProjectId: string;
  }): AdditionalAiInsightTransitionEvaluationRecord[] {
    const rows = this.db.prepare(`
      SELECT id FROM energyiq_additional_insight_transitions
      WHERE workspace_id = ? AND project_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 50
    `).all(input.expectedWorkspaceId, input.expectedProjectId);
    return rows.map((row) => {
      if (!isRecord(row) || typeof row.id !== "string") {
        throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_RECORD_INVALID");
      }
      return this.getTransition({
        transitionId: row.id,
        expectedWorkspaceId: input.expectedWorkspaceId,
        expectedProjectId: input.expectedProjectId,
      });
    });
  }

  reserveEvaluation(input: {
    evaluationId: string;
    idempotencyKey: string;
    requestedBy: string;
    target: AdditionalAiInsightEvaluationTarget;
    attempts: readonly AttemptReservation[];
    runtimeIdentity?: Record<string, unknown>;
    methodResources?: readonly AdditionalAiInsightMethodResource[];
    modelProfileSnapshot?: EnergyIqAdditionalInsightModelProfileSnapshot;
    now?: string;
  }): { created: boolean; record: AdditionalAiInsightEvaluationBatch } {
    requireCurrentTargetIdentity(input.target);
    const methodResources = requireTarget(input.target, this.db, input.methodResources);
    requireNonEmpty(input.evaluationId, "ENERGYIQ_ADDITIONAL_EVALUATION_ID_REQUIRED");
    requireNonEmpty(input.idempotencyKey, "ENERGYIQ_ADDITIONAL_EVALUATION_IDEMPOTENCY_KEY_REQUIRED");
    requireNonEmpty(input.requestedBy, "ENERGYIQ_ADDITIONAL_EVALUATION_ACTOR_REQUIRED");
    requireActor(input.requestedBy, this.db);
    const existing = this.db.prepare(`
      SELECT reservation_json, record_json FROM energyiq_additional_insight_evaluations
      WHERE workspace_id = ? AND project_id = ? AND idempotency_key = ?
    `).get(input.target.workspaceId, input.target.projectId, input.idempotencyKey);
    if (isRecord(existing)) {
      const record = parseEvaluation(existing.record_json);
      if (JSON.stringify(record.target) !== JSON.stringify(input.target)) {
        throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_IDEMPOTENCY_CONFLICT");
      }
      return { created: false, record };
    }
    if (input.attempts.length !== 3
      || !sameNumbers(input.attempts.map(({ ordinal }) => ordinal), [1, 2, 3])
      || !unique(input.attempts.map(({ attemptId }) => attemptId))
      || !unique(input.attempts.map(({ providerRunId }) => providerRunId))
      || !unique(input.attempts.map(({ providerSessionId }) => providerSessionId))
      || input.attempts.some((attempt) => !attemptReservationIsValid(attempt))) {
      throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_ATTEMPTS_INVALID");
    }
    const now = input.now ?? new Date().toISOString();
    const record: AdditionalAiInsightEvaluationBatch = {
      contractRevision: "energyiq-additional-insight-evaluation-v1",
      evaluationId: input.evaluationId,
      idempotencyKey: input.idempotencyKey,
      requestedBy: input.requestedBy,
      status: "running",
      target: clone(input.target),
      attempts: input.attempts.map((attempt) => ({
        ...attempt,
        artifact: evaluationArtifactIdentity(input.target, input.evaluationId, attempt.attemptId),
        status: "running" as const,
        startedAt: now,
      })),
      reviewPack: { revision: "additional-insight-blind-review-v1", entries: [] },
      reviewAudit: [],
      createdAt: now,
      updatedAt: now,
    };
    requireEvaluation(record);
    const reservation: EvaluationReservation = {
      target: clone(input.target),
      methodResources: clone(methodResources),
      ...(input.runtimeIdentity ? { runtimeIdentity: clone(input.runtimeIdentity) } : {}),
      ...(input.modelProfileSnapshot ? { modelProfileSnapshot: clone(input.modelProfileSnapshot) } : {}),
    };
    requireEvaluationReservation(reservation);
    const inserted = this.db.prepare(`
      INSERT INTO energyiq_additional_insight_evaluations (
        id, workspace_id, project_id, scope_id, requested_by, idempotency_key,
        reservation_json, record_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, project_id, idempotency_key) DO NOTHING
    `).run(
      record.evaluationId,
      record.target.workspaceId,
      record.target.projectId,
      record.target.scopeId,
      record.requestedBy,
      record.idempotencyKey,
      JSON.stringify(reservation),
      JSON.stringify(record),
      now,
      now,
    );
    if (inserted.changes === 0) {
      const winner = this.findEvaluationReservationByIdempotencyKey({
        expectedWorkspaceId: input.target.workspaceId,
        expectedProjectId: input.target.projectId,
        idempotencyKey: input.idempotencyKey,
      });
      if (!winner || JSON.stringify(winner.record.target) !== JSON.stringify(input.target)) {
        throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_IDEMPOTENCY_CONFLICT");
      }
      return { created: false, record: winner.record };
    }
    return { created: true, record };
  }

  findEvaluationReservationByIdempotencyKey(input: {
    expectedWorkspaceId: string;
    expectedProjectId: string;
    idempotencyKey: string;
  }): { record: AdditionalAiInsightEvaluationBatch; reservation: EvaluationReservation } | undefined {
    const row = this.db.prepare(`
      SELECT reservation_json, record_json FROM energyiq_additional_insight_evaluations
      WHERE workspace_id = ? AND project_id = ? AND idempotency_key = ?
    `).get(input.expectedWorkspaceId, input.expectedProjectId, input.idempotencyKey);
    if (!isRecord(row)) return undefined;
    const record = parseEvaluation(row.record_json);
    const reservation = parseEvaluationReservation(row.reservation_json);
    if (JSON.stringify(record.target) !== JSON.stringify(reservation.target)) {
      throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_RESERVATION_INVALID");
    }
    requireTarget(record.target, this.db, reservation.methodResources);
    return { record, reservation };
  }

  claimEvaluationAttempt(input: {
    evaluationId: string;
    expectedWorkspaceId: string;
    expectedProjectId: string;
    attemptId: string;
    now?: string;
    leaseMs?: number;
  }): {
    acquired: boolean;
    claimToken?: string;
    attempt: AdditionalAiInsightEvaluationBatch["attempts"][number];
    record: AdditionalAiInsightEvaluationBatch;
  } {
    return immediateTransaction(this.db, () => {
      const record = this.getEvaluation(input);
      const attempt = record.attempts.find(({ attemptId }) => attemptId === input.attemptId);
      if (!attempt) throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_ATTEMPT_NOT_FOUND");
      if (attempt.status !== "running") return { acquired: false, attempt, record };
      requireCurrentTargetIdentity(record.target);
      const now = input.now ?? new Date().toISOString();
      const claimToken = acquireEvaluationAttemptClaimPersistence(this.db, {
        evaluationId: record.evaluationId,
        attemptId: attempt.attemptId,
        workspaceId: record.target.workspaceId,
        projectId: record.target.projectId,
        now,
        ...(input.leaseMs !== undefined ? { leaseMs: input.leaseMs } : {}),
      });
      if (!claimToken) return { acquired: false, attempt, record };
      return { acquired: true, claimToken, attempt, record };
    });
  }

  renewEvaluationAttemptClaim(input: {
    evaluationId: string;
    expectedWorkspaceId: string;
    expectedProjectId: string;
    attemptId: string;
    claimToken: string;
    now?: string;
    leaseMs?: number;
  }): void {
    const record = this.getEvaluation({
      evaluationId: input.evaluationId,
      expectedWorkspaceId: input.expectedWorkspaceId,
      expectedProjectId: input.expectedProjectId,
    });
    requireCurrentTargetIdentity(record.target);
    const now = input.now ?? new Date().toISOString();
    renewEvaluationAttemptClaimPersistence(this.db, {
      evaluationId: input.evaluationId,
      attemptId: input.attemptId,
      workspaceId: input.expectedWorkspaceId,
      projectId: input.expectedProjectId,
      claimToken: input.claimToken,
      now,
      ...(input.leaseMs !== undefined ? { leaseMs: input.leaseMs } : {}),
    });
  }

  completeAttempt(input: {
    evaluationId: string;
    expectedWorkspaceId: string;
    expectedProjectId: string;
    attemptId: string;
    claimToken: string;
    artifact: AdditionalAiInsightsArtifact;
    machineGate: AdditionalAiInsightEvaluationAttempt["machineGate"];
    completedAt?: string;
  }): AdditionalAiInsightEvaluationBatch {
    return immediateTransaction(this.db, () => {
      const record = this.getEvaluation({
      evaluationId: input.evaluationId,
      expectedWorkspaceId: input.expectedWorkspaceId,
      expectedProjectId: input.expectedProjectId,
      });
      requireCurrentTargetIdentity(record.target);
      const index = record.attempts.findIndex(({ attemptId }) => attemptId === input.attemptId);
      const reserved = record.attempts[index];
      if (!reserved) throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_ATTEMPT_NOT_FOUND");
      const completedAt = input.completedAt ?? new Date().toISOString();
      requireEvaluationAttemptClaimPersistence(this.db, {
        evaluationId: record.evaluationId,
        attemptId: reserved.attemptId,
        workspaceId: record.target.workspaceId,
        projectId: record.target.projectId,
        claimToken: input.claimToken,
        completedAt,
      });
      const resultJson = JSON.stringify(input.artifact);
      if (reserved.status === "completed") {
        if (reserved.artifact.resultHash !== sha256(resultJson)
          || reserved.providerRunId !== input.artifact.runId
          || JSON.stringify(reserved.machineGate) !== JSON.stringify(input.machineGate)) {
          throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_ATTEMPT_COMPLETION_CONFLICT");
        }
        return record;
      }
      if (reserved.status !== "running") throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_ATTEMPT_TERMINAL");
      if (input.artifact.runId !== reserved.providerRunId) {
        throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_PROVIDER_RUN_MISMATCH");
      }
      const reservation = this.readEvaluationReservation(record);
      requireArtifactMatchesTarget(input.artifact, record.target, this.db, reservation.methodResources);
      const evidenceRefs = uniqueStrings(input.artifact.findings.flatMap(({ evidenceRefs }) => evidenceRefs));
      const completed: AdditionalAiInsightEvaluationAttempt = {
      attemptId: reserved.attemptId,
      ordinal: reserved.ordinal,
      status: "completed",
      providerRunId: reserved.providerRunId,
      providerSessionId: reserved.providerSessionId,
      artifact: {
        ...reserved.artifact,
        resultHash: sha256(resultJson),
        resultStatus: input.artifact.status,
      },
      statistics: {
        discoveredCount: input.artifact.publication.discoveredCount,
        acceptedCount: input.artifact.publication.acceptedCount,
        rejectedCount: input.artifact.publication.rejectedCount,
        publishedCount: input.artifact.publication.publishedCount,
      },
      evidenceRefs,
      methodResourceIds: input.artifact.methodExecution.loadedMethods.map(({ resourceId }) => resourceId),
      toolAuditIds: input.artifact.toolAudits.map(({ auditId }) => auditId),
      machineGate: clone(input.machineGate),
      startedAt: reserved.startedAt,
      completedAt,
      };
      record.attempts[index] = completed;
      record.updatedAt = completed.completedAt;
      record.status = "running";
      requireEvaluation(record);
      this.db.prepare(`
        INSERT INTO energyiq_additional_insight_evaluation_artifacts (
          evaluation_id, attempt_id, workspace_id, project_id, result_json
        ) VALUES (?, ?, ?, ?, ?)
      `).run(
        record.evaluationId,
        completed.attemptId,
        record.target.workspaceId,
        record.target.projectId,
        resultJson,
      );
      this.writeEvaluation(record);
      return clone(record);
    });
  }

  failAttempt(input: {
    evaluationId: string;
    expectedWorkspaceId: string;
    expectedProjectId: string;
    attemptId: string;
    claimToken: string;
    errorCode: string;
    failureStage?: "provider" | "structured-output" | "machine-gate";
    completedAt?: string;
  }): AdditionalAiInsightEvaluationBatch {
    return immediateTransaction(this.db, () => {
      const record = this.getEvaluation(input);
      requireCurrentTargetIdentity(record.target);
      const index = record.attempts.findIndex(({ attemptId }) => attemptId === input.attemptId);
      const reserved = record.attempts[index];
      if (!reserved) throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_ATTEMPT_NOT_FOUND");
      const completedAt = input.completedAt ?? new Date().toISOString();
      requireEvaluationAttemptClaimPersistence(this.db, {
        evaluationId: record.evaluationId,
        attemptId: reserved.attemptId,
        workspaceId: record.target.workspaceId,
        projectId: record.target.projectId,
        claimToken: input.claimToken,
        completedAt,
      });
      const errorCode = boundedCode(input.errorCode);
      const failureStage = input.failureStage ?? "provider";
      if (reserved.status === "failed") {
        if (reserved.errorCode !== errorCode || reserved.failureStage !== failureStage) {
          throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_ATTEMPT_FAILURE_CONFLICT");
        }
        return record;
      }
      if (reserved.status !== "running") throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_ATTEMPT_TERMINAL");
      record.attempts[index] = {
      attemptId: reserved.attemptId,
      ordinal: reserved.ordinal,
      status: "failed",
      providerRunId: reserved.providerRunId,
      providerSessionId: reserved.providerSessionId,
      artifact: reserved.artifact,
      errorCode,
      failureStage,
      startedAt: reserved.startedAt,
      completedAt,
      };
      record.updatedAt = completedAt;
      requireEvaluation(record);
      this.writeEvaluation(record);
      return clone(record);
    });
  }

  finalizeEvaluation(input: {
    evaluationId: string;
    expectedWorkspaceId: string;
    expectedProjectId: string;
    now?: string;
  }): AdditionalAiInsightEvaluationBatch {
    return immediateTransaction(this.db, () => {
    const row = this.db.prepare(`
      SELECT record_json FROM energyiq_additional_insight_evaluations
      WHERE id = ? AND workspace_id = ? AND project_id = ?
    `).get(input.evaluationId, input.expectedWorkspaceId, input.expectedProjectId);
    if (!isRecord(row) || typeof row.record_json !== "string") {
      throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_NOT_FOUND");
    }
    const expectedRecordJson = row.record_json;
    const record = this.getEvaluation(input);
    requireCurrentTargetIdentity(record.target);
    if (record.status !== "running") return record;
    if (record.attempts.some(({ status }) => status === "running")) {
      throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_ATTEMPTS_NOT_TERMINAL");
    }
    const completed = record.attempts.filter((attempt): attempt is AdditionalAiInsightEvaluationAttempt => (
      attempt.status === "completed"
    ));
    const reviewable = completed.filter(({ machineGate }) => machineGate.status === "passed");
    const shuffled = [...reviewable].sort((left, right) => blindSortKey(record.evaluationId, left.attemptId)
      .localeCompare(blindSortKey(record.evaluationId, right.attemptId)));
    record.reviewPack = {
      revision: "additional-insight-blind-review-v1",
      entries: shuffled.map((attempt, index) => {
        const artifact = this.readAttemptArtifact(record, attempt.attemptId);
        return {
          label: (["Review A", "Review B", "Review C"] as const)[index]!,
          reviewToken: blindToken(record.evaluationId, attempt.attemptId),
          ...(artifact.status === "available" && artifact.findings.length > 0
            ? {
              summary: {
                reviewSummaryToken: blindSummaryToken(record.evaluationId, attempt.attemptId),
                text: artifact.findings[0]!.title,
              },
            }
            : {}),
          findings: artifact.findings.map((finding) => ({
            reviewFindingToken: blindFindingToken(record.evaluationId, attempt.attemptId, finding.id),
            title: finding.title,
            text: finding.text,
            epistemicStatus: finding.epistemicStatus,
            evidenceRefs: [...finding.evidenceRefs],
            originKind: finding.origin.kind,
            directionMethodResourceIds: finding.origin.directionMethods.map(({ resourceId }) => resourceId),
            ...(finding.alert
              ? { alert: { severity: finding.alert.severity, certainty: finding.alert.certainty } }
              : {}),
          })),
        };
      }),
    };
    record.reviewAudit = shuffled.map((attempt) => ({
      reviewToken: blindToken(record.evaluationId, attempt.attemptId),
      attemptId: attempt.attemptId,
    }));
    record.status = reviewable.length > 0 ? "awaiting-human-review" : "failed";
    record.updatedAt = input.now ?? new Date().toISOString();
    requireEvaluation(record);
    const updated = this.db.prepare(`
      UPDATE energyiq_additional_insight_evaluations
      SET record_json = ?, updated_at = ?
      WHERE id = ? AND workspace_id = ? AND project_id = ? AND record_json = ?
    `).run(
      JSON.stringify(record),
      record.updatedAt,
      record.evaluationId,
      record.target.workspaceId,
      record.target.projectId,
      expectedRecordJson,
    );
    if (updated.changes !== 1) {
      throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_FINALIZE_REVISION_CONFLICT");
    }
    return clone(record);
    });
  }

  recordHumanReview(input: {
    evaluationId: string;
    expectedWorkspaceId: string;
    expectedProjectId: string;
    reviewToken: string;
    actorId: string;
    scores: AdditionalAiInsightHumanScores;
    contentUsefulness: AdditionalAiInsightEvaluationHumanReview["contentUsefulness"];
    expectedRevision: number;
    now?: string;
  }): AdditionalAiInsightEvaluationBatch {
    return immediateTransaction(this.db, () => {
    const record = this.getEvaluation(input);
    requireCurrentTargetIdentity(record.target);
    const audit = record.reviewAudit.find(({ reviewToken }) => reviewToken === input.reviewToken);
    if (!audit) throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_REVIEW_TOKEN_INVALID");
    const attempt = record.attempts.find((candidate): candidate is AdditionalAiInsightEvaluationAttempt => (
      candidate.attemptId === audit.attemptId && candidate.status === "completed"
    ));
    if (!attempt) throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_REVIEW_ATTEMPT_INVALID");
    const current = attempt.humanReview;
    if (current
      && current.actorId === input.actorId
      && JSON.stringify(current.scores) === JSON.stringify(input.scores)
      && JSON.stringify(current.contentUsefulness) === JSON.stringify(input.contentUsefulness)) {
      return record;
    }
    const currentRevision = current?.revision ?? 0;
    if (input.expectedRevision !== currentRevision) {
      throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_REVIEW_REVISION_CONFLICT");
    }
    requireScores(input.scores);
    const packEntry = record.reviewPack.entries.find(({ reviewToken }) => reviewToken === input.reviewToken)!;
    requireContentUsefulness(input.contentUsefulness, packEntry);
    requireNonEmpty(input.actorId, "ENERGYIQ_ADDITIONAL_EVALUATION_REVIEW_ACTOR_REQUIRED");
    const reviewedAt = input.now ?? new Date().toISOString();
    const humanReview: AdditionalAiInsightEvaluationHumanReview = {
      actorId: input.actorId,
      reviewedAt,
      scores: clone(input.scores),
      contentUsefulness: clone(input.contentUsefulness),
      passed: false,
      revision: currentRevision + 1,
    };
    humanReview.passed = additionalAiInsightHumanReviewIsPassing(humanReview);
    attempt.humanReview = humanReview;
    record.updatedAt = reviewedAt;
    const completed = record.attempts.filter((candidate): candidate is AdditionalAiInsightEvaluationAttempt => (
      candidate.status === "completed"
    ));
    const reviewable = completed.filter(({ machineGate }) => machineGate.status === "passed");
    if (record.attempts.every(({ status }) => status !== "running")
      && reviewable.every(({ humanReview: review }) => review !== undefined)) {
      record.status = evaluateAdditionalAiInsightPassAt3(record) === "passed" ? "passed" : "failed";
    } else {
      record.status = "awaiting-human-review";
    }
    requireEvaluation(record);
    const result = this.db.prepare(`
      UPDATE energyiq_additional_insight_evaluations
      SET record_json = ?, updated_at = ?
      WHERE id = ? AND workspace_id = ? AND project_id = ?
        AND COALESCE((
          SELECT json_extract(value, '$.humanReview.revision')
          FROM json_each(energyiq_additional_insight_evaluations.record_json, '$.attempts')
          WHERE json_extract(value, '$.attemptId') = ?
        ), 0) = ?
    `).run(
      JSON.stringify(record),
      record.updatedAt,
      record.evaluationId,
      record.target.workspaceId,
      record.target.projectId,
      attempt.attemptId,
      input.expectedRevision,
    );
    if (result.changes !== 1) throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_REVIEW_REVISION_CONFLICT");
    return clone(record);
    });
  }

  approveEvaluationCandidate(input: {
    evaluationId: string;
    expectedWorkspaceId: string;
    expectedProjectId: string;
    reviewToken: string;
    actorId: string;
    expectedRevision: number;
    now?: string;
  }): AdditionalAiInsightEvaluationBatch {
    return immediateTransaction(this.db, () => {
    const record = this.getEvaluation(input);
    requireCurrentTargetIdentity(record.target);
    const audit = record.reviewAudit.find(({ reviewToken }) => reviewToken === input.reviewToken);
    if (!audit) throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_REVIEW_TOKEN_INVALID");
    const selected = record.attempts.find((attempt): attempt is AdditionalAiInsightEvaluationAttempt => (
      attempt.attemptId === audit.attemptId && attempt.status === "completed"
    ));
    if (record.status !== "passed"
      || !selected
      || selected.machineGate.status !== "passed"
      || !selected.humanReview?.passed) {
      throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_APPROVAL_NOT_ALLOWED");
    }
    if (record.approval) {
      if (record.approval.selectedAttemptId === selected.attemptId && record.approval.actorId === input.actorId) return record;
      throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_APPROVAL_CONFLICT");
    }
    if (input.expectedRevision !== 0) throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_APPROVAL_REVISION_CONFLICT");
    const approvedAt = input.now ?? new Date().toISOString();
    record.approval = {
      selectedAttemptId: selected.attemptId,
      actorId: input.actorId,
      approvedAt,
      revision: 1,
      disposition: "publication-candidate-only",
    };
    record.status = "approved-candidate";
    record.updatedAt = approvedAt;
    requireEvaluation(record);
    const result = this.db.prepare(`
      UPDATE energyiq_additional_insight_evaluations
      SET record_json = ?, updated_at = ?
      WHERE id = ? AND workspace_id = ? AND project_id = ?
        AND COALESCE(json_extract(record_json, '$.approval.revision'), 0) = ?
    `).run(
      JSON.stringify(record),
      record.updatedAt,
      record.evaluationId,
      record.target.workspaceId,
      record.target.projectId,
      input.expectedRevision,
    );
    if (result.changes !== 1) throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_APPROVAL_REVISION_CONFLICT");
    return clone(record);
    });
  }

  recordApprovedCandidatePublication(input: {
    evaluationId: string;
    expectedWorkspaceId: string;
    expectedProjectId: string;
    sourceAttemptId: string;
    artifactId: string;
    artifactIdentityHash: string;
    actorId: string;
    expectedRevision: number;
    now?: string;
  }): AdditionalAiInsightEvaluationBatch {
    return immediateTransaction(this.db, () => {
      const record = this.getEvaluation(input);
      requireCurrentTargetIdentity(record.target);
      if (record.status !== "approved-candidate"
        || !record.approval
        || record.approval.selectedAttemptId !== input.sourceAttemptId) {
        throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_PUBLICATION_SOURCE_INVALID");
      }
      const selected = record.attempts.find((attempt): attempt is AdditionalAiInsightEvaluationAttempt => (
        attempt.attemptId === input.sourceAttemptId && attempt.status === "completed"
      ));
      if (!selected) throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_PUBLICATION_SOURCE_INVALID");
      if (input.artifactIdentityHash !== record.target.artifactIdentityHash) {
        throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_PUBLICATION_IDENTITY_INVALID");
      }
      requireNonEmpty(input.artifactId, "ENERGYIQ_ADDITIONAL_EVALUATION_PUBLICATION_ARTIFACT_REQUIRED");
      requireNonEmpty(input.actorId, "ENERGYIQ_ADDITIONAL_EVALUATION_PUBLICATION_ACTOR_REQUIRED");
      const artifact = this.db.prepare(`
        SELECT identity_json, status, run_id, session_id, result_json FROM energyiq_overview_ai_artifacts
        WHERE id = ? AND workspace_id = ? AND project_id = ?
      `).get(input.artifactId, record.target.workspaceId, record.target.projectId);
      if (!isRecord(artifact)
        || artifact.status !== "available"
        || artifact.run_id !== selected.providerRunId
        || artifact.session_id !== selected.providerSessionId
        || typeof artifact.result_json !== "string"
        || sha256(artifact.result_json) !== selected.artifact.resultHash
        || !overviewArtifactIdentityMatchesEvaluationTarget(artifact.identity_json, record.target)) {
        throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_PUBLICATION_ARTIFACT_INVALID");
      }
      if (record.publication) {
        if (record.publication.sourceAttemptId === input.sourceAttemptId
          && record.publication.artifactId === input.artifactId
          && record.publication.artifactIdentityHash === input.artifactIdentityHash) return record;
        throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_PUBLICATION_CONFLICT");
      }
      if (input.expectedRevision !== 0) {
        throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_PUBLICATION_REVISION_CONFLICT");
      }
      const publishedAt = input.now ?? new Date().toISOString();
      record.publication = {
        sourceAttemptId: input.sourceAttemptId,
        artifactId: input.artifactId,
        artifactIdentityHash: input.artifactIdentityHash,
        actorId: input.actorId,
        publishedAt,
        revision: 1,
      };
      record.updatedAt = publishedAt;
      requireEvaluation(record);
      const result = this.db.prepare(`
        UPDATE energyiq_additional_insight_evaluations
        SET record_json = ?, updated_at = ?
        WHERE id = ? AND workspace_id = ? AND project_id = ?
          AND COALESCE(json_extract(record_json, '$.publication.revision'), 0) = ?
      `).run(
        JSON.stringify(record),
        record.updatedAt,
        record.evaluationId,
        record.target.workspaceId,
        record.target.projectId,
        input.expectedRevision,
      );
      if (result.changes !== 1) {
        throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_PUBLICATION_REVISION_CONFLICT");
      }
      return clone(record);
    });
  }

  getEvaluation(input: {
    evaluationId: string;
    expectedWorkspaceId: string;
    expectedProjectId: string;
  }): AdditionalAiInsightEvaluationBatch {
    const row = this.db.prepare(`
      SELECT reservation_json, record_json FROM energyiq_additional_insight_evaluations
      WHERE id = ? AND workspace_id = ? AND project_id = ?
    `).get(input.evaluationId, input.expectedWorkspaceId, input.expectedProjectId);
    if (!isRecord(row)) throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_NOT_FOUND");
    const record = parseEvaluation(row.record_json);
    const reservation = parseEvaluationReservation(row.reservation_json);
    if (JSON.stringify(record.target) !== JSON.stringify(reservation.target)) {
      throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_RESERVATION_INVALID");
    }
    requireTarget(record.target, this.db, reservation.methodResources);
    for (const attempt of record.attempts) {
      if (attempt.status === "completed") this.readAttemptArtifact(record, attempt.attemptId);
    }
    return record;
  }

  reserveTransition(input: {
    transitionId: string;
    idempotencyKey: string;
    requestedBy: string;
    previousEvaluationId: string;
    previousAttemptId: string;
    currentTarget: AdditionalAiInsightEvaluationTarget;
    generationProviderRunId: string;
    generationProviderSessionId: string;
    comparisonProviderRunId: string;
    comparisonProviderSessionId: string;
    runtimeIdentity?: Record<string, unknown>;
    methodResources?: readonly AdditionalAiInsightMethodResource[];
    modelProfileSnapshot?: EnergyIqAdditionalInsightModelProfileSnapshot;
    now?: string;
  }): {
    created: boolean;
    transitionId: string;
    currentArtifactId: string;
    currentArtifactIdentityHash: string;
    generationProviderRunId: string;
    generationProviderSessionId: string;
    comparisonProviderRunId: string;
    comparisonProviderSessionId: string;
    record?: AdditionalAiInsightTransitionEvaluationRecord;
  } {
    requireCurrentTargetIdentity(input.currentTarget);
    const methodResources = requireTarget(input.currentTarget, this.db, input.methodResources);
    requireActor(input.requestedBy, this.db);
    const existing = this.db.prepare(`
      SELECT id, reservation_json, record_json FROM energyiq_additional_insight_transitions
      WHERE workspace_id = ? AND project_id = ? AND idempotency_key = ?
    `).get(input.currentTarget.workspaceId, input.currentTarget.projectId, input.idempotencyKey);
    if (isRecord(existing)) {
      const reservation = parseTransitionReservation(existing.reservation_json);
      if (reservation.previousEvaluationId !== input.previousEvaluationId
        || reservation.previousAttemptId !== input.previousAttemptId
        || JSON.stringify(reservation.currentTarget) !== JSON.stringify(input.currentTarget)) {
        throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_IDEMPOTENCY_CONFLICT");
      }
      return {
        created: false,
        transitionId: reservation.transitionId,
        currentArtifactId: reservation.currentArtifactId,
        currentArtifactIdentityHash: reservation.currentArtifactIdentityHash,
        generationProviderRunId: reservation.generationProviderRunId,
        generationProviderSessionId: reservation.generationProviderSessionId,
        comparisonProviderRunId: reservation.comparisonProviderRunId,
        comparisonProviderSessionId: reservation.comparisonProviderSessionId,
        ...(typeof existing.record_json === "string"
          ? { record: this.getTransition({
            transitionId: reservation.transitionId,
            expectedWorkspaceId: input.currentTarget.workspaceId,
            expectedProjectId: input.currentTarget.projectId,
          }) }
          : {}),
      };
    }
    const previous = this.getEvaluation({
      evaluationId: input.previousEvaluationId,
      expectedWorkspaceId: input.currentTarget.workspaceId,
      expectedProjectId: input.currentTarget.projectId,
    });
    const previousAttempt = previous.attempts.find((attempt): attempt is AdditionalAiInsightEvaluationAttempt => (
      attempt.attemptId === input.previousAttemptId && attempt.status === "completed"
    ));
    if (!previousAttempt) throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_PREVIOUS_ATTEMPT_INVALID");
    if (previous.status !== "passed" && previous.status !== "approved-candidate") {
      throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_PREVIOUS_EVALUATION_NOT_PASSED");
    }
    if (previousAttempt.machineGate.status !== "passed" || previousAttempt.humanReview?.passed !== true) {
      throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_PREVIOUS_ATTEMPT_NOT_PASSED");
    }
    if (previous.status === "approved-candidate"
      && previous.approval?.selectedAttemptId !== previousAttempt.attemptId) {
      throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_PREVIOUS_ATTEMPT_NOT_APPROVED");
    }
    if (!additionalAiInsightEvaluationTargetsCanTransition(previous.target, input.currentTarget)) {
      throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_TARGET_INVALID");
    }
    const currentArtifactIdentityHash = sha256(JSON.stringify({
      contractRevision: "additional-insight-transition-artifact-v1",
      target: input.currentTarget,
      transitionId: input.transitionId,
    }));
    const now = input.now ?? new Date().toISOString();
    const reservation: TransitionReservation = {
      transitionId: input.transitionId,
      idempotencyKey: input.idempotencyKey,
      requestedBy: input.requestedBy,
      previousEvaluationId: input.previousEvaluationId,
      previousAttemptId: input.previousAttemptId,
      previousArtifactId: previousAttempt.artifact.artifactId,
      previousArtifactIdentityHash: previousAttempt.artifact.artifactIdentityHash,
      previousTarget: previous.target,
      currentTarget: clone(input.currentTarget),
      methodResources: clone(methodResources),
      ...(input.runtimeIdentity ? { runtimeIdentity: clone(input.runtimeIdentity) } : {}),
      ...(input.modelProfileSnapshot ? { modelProfileSnapshot: clone(input.modelProfileSnapshot) } : {}),
      currentArtifactId: `additional-transition-artifact-${currentArtifactIdentityHash.slice(7, 31)}`,
      currentArtifactIdentityHash,
      generationProviderRunId: input.generationProviderRunId,
      generationProviderSessionId: input.generationProviderSessionId,
      comparisonProviderRunId: input.comparisonProviderRunId,
      comparisonProviderSessionId: input.comparisonProviderSessionId,
      createdAt: now,
    };
    requireTransitionReservation(reservation);
    const inserted = this.db.prepare(`
      INSERT INTO energyiq_additional_insight_transitions (
        id, workspace_id, project_id, scope_id, requested_by, idempotency_key, reservation_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, project_id, idempotency_key) DO NOTHING
    `).run(
      input.transitionId,
      input.currentTarget.workspaceId,
      input.currentTarget.projectId,
      input.currentTarget.scopeId,
      input.requestedBy,
      input.idempotencyKey,
      JSON.stringify(reservation),
      now,
      now,
    );
    if (inserted.changes === 0) {
      const winner = this.findTransitionReservationByIdempotencyKey({
        expectedWorkspaceId: input.currentTarget.workspaceId,
        expectedProjectId: input.currentTarget.projectId,
        idempotencyKey: input.idempotencyKey,
      });
      if (!winner
        || winner.previousEvaluationId !== input.previousEvaluationId
        || winner.previousAttemptId !== input.previousAttemptId
        || JSON.stringify(winner.currentTarget) !== JSON.stringify(input.currentTarget)) {
        throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_IDEMPOTENCY_CONFLICT");
      }
      return {
        created: false,
        transitionId: winner.transitionId,
        currentArtifactId: winner.currentArtifactId,
        currentArtifactIdentityHash: winner.currentArtifactIdentityHash,
        generationProviderRunId: winner.generationProviderRunId,
        generationProviderSessionId: winner.generationProviderSessionId,
        comparisonProviderRunId: winner.comparisonProviderRunId,
        comparisonProviderSessionId: winner.comparisonProviderSessionId,
      };
    }
    return {
      created: true,
      transitionId: reservation.transitionId,
      currentArtifactId: reservation.currentArtifactId,
      currentArtifactIdentityHash,
      generationProviderRunId: reservation.generationProviderRunId,
      generationProviderSessionId: reservation.generationProviderSessionId,
      comparisonProviderRunId: reservation.comparisonProviderRunId,
      comparisonProviderSessionId: reservation.comparisonProviderSessionId,
    };
  }

  findTransitionReservationByIdempotencyKey(input: {
    expectedWorkspaceId: string;
    expectedProjectId: string;
    idempotencyKey: string;
  }): TransitionReservation | undefined {
    const row = this.db.prepare(`
      SELECT reservation_json FROM energyiq_additional_insight_transitions
      WHERE workspace_id = ? AND project_id = ? AND idempotency_key = ?
    `).get(input.expectedWorkspaceId, input.expectedProjectId, input.idempotencyKey);
    if (!isRecord(row)) return undefined;
    const reservation = parseTransitionReservation(row.reservation_json);
    requireTarget(reservation.currentTarget, this.db, reservation.methodResources);
    return reservation;
  }

  claimTransition(input: {
    transitionId: string;
    expectedWorkspaceId: string;
    expectedProjectId: string;
    now?: string;
    leaseMs?: number;
  }): { acquired: boolean; claimToken?: string } {
    return immediateTransaction(this.db, () => {
      const row = this.db.prepare(`
        SELECT reservation_json, record_json FROM energyiq_additional_insight_transitions
        WHERE id = ? AND workspace_id = ? AND project_id = ?
      `).get(input.transitionId, input.expectedWorkspaceId, input.expectedProjectId);
      if (!isRecord(row)) throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_NOT_FOUND");
      if (typeof row.record_json === "string") return { acquired: false };
      const reservation = parseTransitionReservation(row.reservation_json);
      requireCurrentTargetIdentity(reservation.currentTarget);
      const now = input.now ?? new Date().toISOString();
      const claimToken = acquireTransitionClaimPersistence(this.db, {
        transitionId: input.transitionId,
        workspaceId: input.expectedWorkspaceId,
        projectId: input.expectedProjectId,
        now,
        ...(input.leaseMs !== undefined ? { leaseMs: input.leaseMs } : {}),
      });
      if (!claimToken) return { acquired: false };
      return { acquired: true, claimToken };
    });
  }

  renewTransitionClaim(input: {
    transitionId: string;
    expectedWorkspaceId: string;
    expectedProjectId: string;
    claimToken: string;
    now?: string;
    leaseMs?: number;
  }): void {
    const row = this.db.prepare(`
      SELECT reservation_json FROM energyiq_additional_insight_transitions
      WHERE id = ? AND workspace_id = ? AND project_id = ?
    `).get(input.transitionId, input.expectedWorkspaceId, input.expectedProjectId);
    if (!isRecord(row)) throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_NOT_FOUND");
    requireCurrentTargetIdentity(parseTransitionReservation(row.reservation_json).currentTarget);
    const now = input.now ?? new Date().toISOString();
    renewTransitionClaimPersistence(this.db, {
      transitionId: input.transitionId,
      workspaceId: input.expectedWorkspaceId,
      projectId: input.expectedProjectId,
      claimToken: input.claimToken,
      now,
      ...(input.leaseMs !== undefined ? { leaseMs: input.leaseMs } : {}),
    });
  }

  completeTransition(input: {
    transitionId: string;
    expectedWorkspaceId: string;
    expectedProjectId: string;
    claimToken: string;
    currentArtifact: AdditionalAiInsightsArtifact;
    outcomes: AdditionalAiInsightTransitionOutcome[];
    completedAt?: string;
  }): AdditionalAiInsightTransitionRecord {
    return immediateTransaction(this.db, () => {
      const row = this.db.prepare(`
      SELECT reservation_json, record_json, current_artifact_json
      FROM energyiq_additional_insight_transitions
      WHERE id = ? AND workspace_id = ? AND project_id = ?
    `).get(input.transitionId, input.expectedWorkspaceId, input.expectedProjectId);
      if (!isRecord(row)) throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_NOT_FOUND");
      const reservation = parseTransitionReservation(row.reservation_json);
      requireCurrentTargetIdentity(reservation.currentTarget);
      const completedAt = input.completedAt ?? new Date().toISOString();
      requireTransitionClaimPersistence(this.db, {
        transitionId: input.transitionId,
        workspaceId: input.expectedWorkspaceId,
        projectId: input.expectedProjectId,
        claimToken: input.claimToken,
        completedAt,
      });
      if (typeof row.record_json === "string") {
        const existing = parseTransition(row.record_json);
        if (existing.status !== "completed") throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_ALREADY_FAILED");
        if (typeof row.current_artifact_json !== "string"
          || sha256(row.current_artifact_json) !== sha256(JSON.stringify(input.currentArtifact))
          || JSON.stringify(existing.outcomes) !== JSON.stringify(input.outcomes)) {
          throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_COMPLETION_CONFLICT");
        }
        return existing;
      }
      if (input.currentArtifact.runId !== reservation.generationProviderRunId) {
        throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_PROVIDER_RUN_MISMATCH");
      }
      requireArtifactMatchesTarget(
        input.currentArtifact,
        reservation.currentTarget,
        this.db,
        reservation.methodResources,
      );
      const previousArtifact = this.getAttemptArtifact({
      evaluationId: reservation.previousEvaluationId,
      attemptId: reservation.previousAttemptId,
      expectedWorkspaceId: reservation.previousTarget.workspaceId,
      expectedProjectId: reservation.previousTarget.projectId,
    });
      const record: AdditionalAiInsightTransitionRecord = {
      contractRevision: "energyiq-additional-insight-transition-v1",
      transitionId: reservation.transitionId,
      idempotencyKey: reservation.idempotencyKey,
      requestedBy: reservation.requestedBy,
      status: "completed",
      previousTarget: clone(reservation.previousTarget),
      currentTarget: clone(reservation.currentTarget),
      previousArtifact: transitionArtifactAudit(
        previousArtifact,
        reservation.previousArtifactId,
        reservation.previousArtifactIdentityHash,
      ),
      currentArtifact: transitionArtifactAudit(
        input.currentArtifact,
        reservation.currentArtifactId,
        reservation.currentArtifactIdentityHash,
      ),
      generationProviderRunId: reservation.generationProviderRunId,
      generationProviderSessionId: reservation.generationProviderSessionId,
      comparisonProviderRunId: reservation.comparisonProviderRunId,
      comparisonProviderSessionId: reservation.comparisonProviderSessionId,
      outcomes: clone(input.outcomes),
      createdAt: reservation.createdAt,
        completedAt,
      };
      if (!additionalAiInsightTransitionIsValid(record)) {
        throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_INVALID");
      }
      this.db.prepare(`
        UPDATE energyiq_additional_insight_transitions
        SET record_json = ?, current_artifact_json = ?, updated_at = ?
        WHERE id = ? AND workspace_id = ? AND project_id = ?
      `).run(
        JSON.stringify(record),
        JSON.stringify(input.currentArtifact),
        record.completedAt,
        record.transitionId,
        record.currentTarget.workspaceId,
        record.currentTarget.projectId,
      );
      return clone(record);
    });
  }

  failTransition(input: {
    transitionId: string;
    expectedWorkspaceId: string;
    expectedProjectId: string;
    claimToken: string;
    errorCode: string;
    failureStage: "generation" | "validation" | "comparison";
    completedAt?: string;
  }): AdditionalAiInsightFailedTransitionRecord {
    return immediateTransaction(this.db, () => {
      const row = this.db.prepare(`
      SELECT reservation_json, record_json FROM energyiq_additional_insight_transitions
      WHERE id = ? AND workspace_id = ? AND project_id = ?
      `).get(input.transitionId, input.expectedWorkspaceId, input.expectedProjectId);
      if (!isRecord(row)) throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_NOT_FOUND");
      const reservation = parseTransitionReservation(row.reservation_json);
      requireCurrentTargetIdentity(reservation.currentTarget);
      const completedAt = input.completedAt ?? new Date().toISOString();
      requireTransitionClaimPersistence(this.db, {
        transitionId: input.transitionId,
        workspaceId: input.expectedWorkspaceId,
        projectId: input.expectedProjectId,
        claimToken: input.claimToken,
        completedAt,
      });
      if (typeof row.record_json === "string") {
        const existing = parseTransition(row.record_json);
        if (existing.status !== "failed") throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_ALREADY_COMPLETED");
        if (existing.errorCode !== boundedCode(input.errorCode)
          || existing.failureStage !== input.failureStage) {
          throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_FAILURE_CONFLICT");
        }
        return existing;
      }
      const previousArtifact = this.getAttemptArtifact({
      evaluationId: reservation.previousEvaluationId,
      attemptId: reservation.previousAttemptId,
      expectedWorkspaceId: reservation.previousTarget.workspaceId,
      expectedProjectId: reservation.previousTarget.projectId,
    });
      const record: AdditionalAiInsightFailedTransitionRecord = {
      contractRevision: "energyiq-additional-insight-transition-v1",
      transitionId: reservation.transitionId,
      idempotencyKey: reservation.idempotencyKey,
      requestedBy: reservation.requestedBy,
      status: "failed",
      previousTarget: clone(reservation.previousTarget),
      currentTarget: clone(reservation.currentTarget),
      previousArtifact: transitionArtifactAudit(
        previousArtifact,
        reservation.previousArtifactId,
        reservation.previousArtifactIdentityHash,
      ),
      generationProviderRunId: reservation.generationProviderRunId,
      generationProviderSessionId: reservation.generationProviderSessionId,
      comparisonProviderRunId: reservation.comparisonProviderRunId,
      comparisonProviderSessionId: reservation.comparisonProviderSessionId,
      errorCode: boundedCode(input.errorCode),
      failureStage: input.failureStage,
      createdAt: reservation.createdAt,
        completedAt,
      };
      if (!additionalAiInsightTransitionRecordIsValid(record)) {
        throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_RECORD_INVALID");
      }
      this.db.prepare(`
        UPDATE energyiq_additional_insight_transitions
        SET record_json = ?, updated_at = ?
        WHERE id = ? AND workspace_id = ? AND project_id = ?
      `).run(
        JSON.stringify(record),
        record.completedAt,
        record.transitionId,
        record.currentTarget.workspaceId,
        record.currentTarget.projectId,
      );
      return clone(record);
    });
  }

  getTransition(input: {
    transitionId: string;
    expectedWorkspaceId: string;
    expectedProjectId: string;
  }): AdditionalAiInsightTransitionEvaluationRecord {
    const row = this.db.prepare(`
      SELECT reservation_json, record_json, current_artifact_json FROM energyiq_additional_insight_transitions
      WHERE id = ? AND workspace_id = ? AND project_id = ?
    `).get(input.transitionId, input.expectedWorkspaceId, input.expectedProjectId);
    if (!isRecord(row)) {
      throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_NOT_FOUND");
    }
    const reservation = parseTransitionReservation(row.reservation_json);
    if (typeof row.record_json === "string") {
      const record = parseTransition(row.record_json);
      const previousArtifact = this.getAttemptArtifact({
        evaluationId: reservation.previousEvaluationId,
        attemptId: reservation.previousAttemptId,
        expectedWorkspaceId: record.previousTarget.workspaceId,
        expectedProjectId: record.previousTarget.projectId,
      });
      const expectedPreviousAudit = transitionArtifactAudit(
        previousArtifact,
        record.previousArtifact.artifactId,
        record.previousArtifact.artifactIdentityHash,
      );
      if (JSON.stringify(expectedPreviousAudit) !== JSON.stringify(record.previousArtifact)) {
        throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_PREVIOUS_ARTIFACT_INVALID");
      }
      if (record.status === "completed") {
        if (typeof row.current_artifact_json !== "string") {
          throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_CURRENT_ARTIFACT_INVALID");
        }
        let parsedCurrent: unknown;
        try { parsedCurrent = JSON.parse(row.current_artifact_json); } catch {
          throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_CURRENT_ARTIFACT_INVALID");
        }
        const currentArtifact = parsedCurrent as AdditionalAiInsightsArtifact;
        requireArtifactMatchesTarget(
          currentArtifact,
          record.currentTarget,
          this.db,
          reservation.methodResources,
        );
        if (currentArtifact.runId !== record.generationProviderRunId
          || JSON.stringify(transitionArtifactAudit(
            currentArtifact,
            record.currentArtifact.artifactId,
            record.currentArtifact.artifactIdentityHash,
          )) !== JSON.stringify(record.currentArtifact)) {
          throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_CURRENT_ARTIFACT_INVALID");
        }
      }
      return record;
    }
    const previousArtifact = this.getAttemptArtifact({
      evaluationId: reservation.previousEvaluationId,
      attemptId: reservation.previousAttemptId,
      expectedWorkspaceId: reservation.previousTarget.workspaceId,
      expectedProjectId: reservation.previousTarget.projectId,
    });
    const running: AdditionalAiInsightTransitionEvaluationRecord = {
      contractRevision: "energyiq-additional-insight-transition-v1",
      transitionId: reservation.transitionId,
      idempotencyKey: reservation.idempotencyKey,
      requestedBy: reservation.requestedBy,
      status: "running",
      previousTarget: clone(reservation.previousTarget),
      currentTarget: clone(reservation.currentTarget),
      previousArtifact: transitionArtifactAudit(
        previousArtifact,
        reservation.previousArtifactId,
        reservation.previousArtifactIdentityHash,
      ),
      generationProviderRunId: reservation.generationProviderRunId,
      generationProviderSessionId: reservation.generationProviderSessionId,
      comparisonProviderRunId: reservation.comparisonProviderRunId,
      comparisonProviderSessionId: reservation.comparisonProviderSessionId,
      createdAt: reservation.createdAt,
    };
    if (!additionalAiInsightTransitionRecordIsValid(running)) {
      throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_RECORD_INVALID");
    }
    return running;
  }

  getAttemptArtifact(input: {
    evaluationId: string;
    attemptId: string;
    expectedWorkspaceId: string;
    expectedProjectId: string;
  }): AdditionalAiInsightsArtifact {
    const record = this.getEvaluation(input);
    return this.readAttemptArtifact(record, input.attemptId);
  }

  private readAttemptArtifact(
    record: AdditionalAiInsightEvaluationBatch,
    attemptId: string,
  ): AdditionalAiInsightsArtifact {
    const attempt = record.attempts.find((candidate): candidate is AdditionalAiInsightEvaluationAttempt => (
      candidate.attemptId === attemptId && candidate.status === "completed"
    ));
    if (!attempt) throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_ARTIFACT_NOT_FOUND");
    const row = this.db.prepare(`
      SELECT result_json FROM energyiq_additional_insight_evaluation_artifacts
      WHERE evaluation_id = ? AND attempt_id = ? AND workspace_id = ? AND project_id = ?
    `).get(record.evaluationId, attemptId, record.target.workspaceId, record.target.projectId);
    if (!isRecord(row) || typeof row.result_json !== "string") {
      throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_ARTIFACT_NOT_FOUND");
    }
    if (sha256(row.result_json) !== attempt.artifact.resultHash) {
      throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_ARTIFACT_HASH_MISMATCH");
    }
    let value: unknown;
    try {
      value = JSON.parse(row.result_json);
    } catch {
      throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_ARTIFACT_INVALID");
    }
    if (!isRecord(value) || value.artifactKind !== "autonomous-insights") {
      throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_ARTIFACT_INVALID");
    }
    const artifact = value as AdditionalAiInsightsArtifact;
    const reservation = this.readEvaluationReservation(record);
    requireArtifactMatchesTarget(artifact, record.target, this.db, reservation.methodResources);
    if (artifact.runId !== attempt.providerRunId || artifact.status !== attempt.artifact.resultStatus) {
      throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_ARTIFACT_IDENTITY_MISMATCH");
    }
    return artifact;
  }

  private readEvaluationReservation(record: AdditionalAiInsightEvaluationBatch): EvaluationReservation {
    const row = this.db.prepare(`
      SELECT reservation_json FROM energyiq_additional_insight_evaluations
      WHERE id = ? AND workspace_id = ? AND project_id = ?
    `).get(record.evaluationId, record.target.workspaceId, record.target.projectId);
    if (!isRecord(row)) throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_NOT_FOUND");
    const reservation = parseEvaluationReservation(row.reservation_json);
    if (JSON.stringify(record.target) !== JSON.stringify(reservation.target)) {
      throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_RESERVATION_INVALID");
    }
    return reservation;
  }

  private writeEvaluation(record: AdditionalAiInsightEvaluationBatch): void {
    const result = this.db.prepare(`
      UPDATE energyiq_additional_insight_evaluations
      SET record_json = ?, updated_at = ?
      WHERE id = ? AND workspace_id = ? AND project_id = ?
    `).run(
      JSON.stringify(record),
      record.updatedAt,
      record.evaluationId,
      record.target.workspaceId,
      record.target.projectId,
    );
    if (result.changes !== 1) throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_NOT_FOUND");
  }
}

const requireTarget = (
  target: AdditionalAiInsightEvaluationTarget,
  db: DatabaseSync,
  reservedResources?: readonly AdditionalAiInsightMethodResource[],
): AdditionalAiInsightMethodResource[] => {
  const project = db.prepare(`
    SELECT root_scope_id FROM energyiq_projects WHERE id = ? AND workspace_id = ?
  `).get(target.projectId, target.workspaceId);
  if (!isRecord(project)
    || !nonEmpty(project.root_scope_id)
    || (target.scopeId !== project.root_scope_id
      && !isRecord(db.prepare(`
        SELECT id FROM energyiq_project_nodes WHERE project_id = ? AND id = ?
      `).get(target.projectId, target.scopeId)))) {
    throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_TARGET_NOT_FOUND");
  }
  const methodSet = reservedResources
    ? resolveReservedMethodSet(target, reservedResources)
    : resolveCurrentAdditionalAiInsightMethodSet(
      target.workspaceId,
      new EnergyIqInsightMethodGovernanceStore(db).listPublishedWorkspaceMethodResources({
        workspaceId: target.workspaceId,
      }),
    );
  const canonical = canonicalInsightMethodSetJson(methodSet.methods);
  if (!canonical
    || target.methodSetId !== methodSet.id
    || target.methodSetRevision !== methodSet.revision
    || target.methodSetFingerprint !== sha256(canonical)
    || !supportedTargetIdentity(target)
    || target.outputContractRevision !== "energyiq-additional-ai-insights-v2"
    || target.capabilityRevision !== "scoped-read-only-v1"
    || target.publicationRevision !== "additional-insights-v2"
    || target.canvasRevision !== "energyiq-insight-canvas-v2") {
    throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_TARGET_INVALID");
  }
  return methodSet.resources.map((resource) => clone(resource));
};

const supportedTargetIdentity = (target: AdditionalAiInsightEvaluationTarget): boolean => (
  (target.artifactIdentityRevision === "additional-insights-v3"
    && target.validatorRevision === "additional-insights-acceptance-v3"
    && target.workflowRevision === "additional-insights-discover-accept-publish-v3"
    && target.promptRevision === "additional-insights-discovery-v3")
  || (target.artifactIdentityRevision === "additional-insights-v4"
    && target.validatorRevision === "additional-insights-acceptance-v3"
    && target.workflowRevision === "additional-insights-discover-accept-publish-v4"
    && target.promptRevision === "additional-insights-discovery-v4")
  || (target.artifactIdentityRevision === "additional-insights-v5"
    && target.validatorRevision === "additional-insights-acceptance-v3"
    && target.workflowRevision === "additional-insights-discover-accept-publish-v5"
    && target.promptRevision === "additional-insights-discovery-v5")
  || (target.artifactIdentityRevision === "additional-insights-v6"
    && target.validatorRevision === "additional-insights-acceptance-v4"
    && target.workflowRevision === "additional-insights-discover-accept-publish-v6"
    && target.promptRevision === "additional-insights-discovery-v6")
  || (target.artifactIdentityRevision === "additional-insights-v7"
    && target.validatorRevision === "additional-insights-acceptance-v5"
    && target.workflowRevision === "additional-insights-discover-accept-publish-v7"
    && target.promptRevision === "additional-insights-discovery-v7")
  || (target.artifactIdentityRevision === "additional-insights-v8"
    && target.validatorRevision === "additional-insights-acceptance-v6"
    && target.workflowRevision === "additional-insights-discover-accept-publish-v8"
    && target.promptRevision === "additional-insights-discovery-v7")
  || (target.artifactIdentityRevision === "additional-insights-v9"
    && target.validatorRevision === "additional-insights-acceptance-v6"
    && target.workflowRevision === "additional-insights-discover-accept-publish-v9"
    && target.promptRevision === "additional-insights-discovery-v7")
  || (target.artifactIdentityRevision === "additional-insights-v10"
    && target.validatorRevision === "additional-insights-acceptance-v7"
    && target.workflowRevision === "additional-insights-discover-accept-publish-v10"
    && target.promptRevision === "additional-insights-discovery-v8")
  || (target.artifactIdentityRevision === "additional-insights-v11"
    && target.validatorRevision === "additional-insights-acceptance-v8"
    && target.workflowRevision === "additional-insights-discover-accept-publish-v11"
    && target.promptRevision === "additional-insights-discovery-v9")
  || (target.artifactIdentityRevision === "additional-insights-v12"
    && target.validatorRevision === "additional-insights-acceptance-v9"
    && target.workflowRevision === "additional-insights-discover-accept-publish-v12"
    && target.promptRevision === "additional-insights-discovery-v10")
  || (target.artifactIdentityRevision === "additional-insights-v13"
    && target.validatorRevision === "additional-insights-acceptance-v10"
    && target.workflowRevision === "additional-insights-discover-accept-publish-v13"
    && target.promptRevision === "additional-insights-discovery-v10")
  || (target.artifactIdentityRevision === "additional-insights-v14"
    && target.validatorRevision === "additional-insights-acceptance-v11"
    && target.workflowRevision === "additional-insights-discover-accept-publish-v14"
    && target.promptRevision === "additional-insights-discovery-v10")
  || (target.artifactIdentityRevision === "additional-insights-v15"
    && target.validatorRevision === "additional-insights-acceptance-v12"
    && target.workflowRevision === "additional-insights-discover-accept-publish-v15"
    && target.promptRevision === "additional-insights-discovery-v10")
  || (target.artifactIdentityRevision === "additional-insights-v16"
    && target.validatorRevision === "additional-insights-acceptance-v13"
    && target.workflowRevision === "additional-insights-discover-accept-publish-v16"
    && target.promptRevision === "additional-insights-discovery-v10")
  || (target.artifactIdentityRevision === "additional-insights-v17"
    && target.validatorRevision === "additional-insights-acceptance-v14"
    && target.workflowRevision === "additional-insights-discover-accept-publish-v17"
    && target.promptRevision === "additional-insights-discovery-v10")
  || (target.artifactIdentityRevision === "additional-insights-v18"
    && target.validatorRevision === "additional-insights-acceptance-v15"
    && target.workflowRevision === "additional-insights-discover-accept-publish-v18"
    && target.promptRevision === "additional-insights-discovery-v10")
  || (target.artifactIdentityRevision === "additional-insights-v19"
    && target.validatorRevision === "additional-insights-acceptance-v16"
    && target.workflowRevision === "additional-insights-discover-accept-publish-v19"
    && target.promptRevision === "additional-insights-discovery-v10")
  || (target.artifactIdentityRevision === "additional-insights-v20"
    && target.validatorRevision === "additional-insights-acceptance-v16"
    && target.workflowRevision === "additional-insights-discover-accept-publish-v20"
    && target.promptRevision === "additional-insights-discovery-v10")
  || (target.artifactIdentityRevision === "additional-insights-v21"
    && target.validatorRevision === "additional-insights-acceptance-v17"
    && target.workflowRevision === "additional-insights-discover-accept-publish-v20"
    && target.promptRevision === "additional-insights-discovery-v10")
  || (target.artifactIdentityRevision === "additional-insights-v22"
    && target.validatorRevision === "additional-insights-acceptance-v17"
    && target.workflowRevision === "additional-insights-discover-accept-publish-v21"
    && target.promptRevision === "additional-insights-discovery-v11")
  || (target.artifactIdentityRevision === "additional-insights-v23"
    && target.validatorRevision === "additional-insights-acceptance-v17"
    && target.workflowRevision === "additional-insights-discover-accept-publish-v21"
    && target.promptRevision === "additional-insights-discovery-v12")
  || (target.artifactIdentityRevision === "additional-insights-v24"
    && target.validatorRevision === "additional-insights-acceptance-v17"
    && target.workflowRevision === "additional-insights-discover-accept-publish-v21"
    && target.promptRevision === "additional-insights-discovery-v12")
);

const overviewArtifactIdentityMatchesEvaluationTarget = (
  value: unknown,
  target: AdditionalAiInsightEvaluationTarget,
): boolean => {
  let identity: unknown;
  try { identity = typeof value === "string" ? JSON.parse(value) : value; } catch { return false; }
  return isRecord(identity)
    && identity.artifactKind === "autonomous-insights"
    && identity.workspaceId === target.workspaceId
    && identity.projectId === target.projectId
    && identity.scopeId === target.scopeId
    && identity.resource === target.resource
    && identity.dataSnapshotId === target.dataSnapshotId
    && identity.projectReleaseId === target.projectReleaseId
    && identity.analysisPeriodFrom === target.analysisPeriod.from
    && identity.analysisPeriodTo === target.analysisPeriod.to
    && identity.modelProfileId === target.modelProfileId
    && identity.modelProfileRevision === target.modelProfileRevision
    && identity.identityContractRevision === target.artifactIdentityRevision
    && identity.outputContractRevision === target.outputContractRevision
    && identity.validatorRevision === target.validatorRevision
    && identity.workflowRevision === target.workflowRevision
    && identity.investigatorPromptRevision === target.promptRevision
    && identity.capabilityRevision === target.capabilityRevision
    && identity.publicationRevision === target.publicationRevision
    && identity.canvasRevision === target.canvasRevision
    && identity.methodSetId === target.methodSetId
    && identity.methodSetRevision === target.methodSetRevision
    && identity.methodSetFingerprint === target.methodSetFingerprint;
};

const requireCurrentTargetIdentity = (target: AdditionalAiInsightEvaluationTarget): void => {
  if (target.artifactIdentityRevision !== "additional-insights-v24"
    || target.validatorRevision !== "additional-insights-acceptance-v17"
    || target.workflowRevision !== "additional-insights-discover-accept-publish-v21"
    || target.promptRevision !== "additional-insights-discovery-v12") {
    throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_TARGET_BEHAVIOR_NOT_CURRENT");
  }
};

const requireActor = (actorId: string, db: DatabaseSync): void => {
  if (!isRecord(db.prepare("SELECT id FROM users WHERE id = ?").get(actorId))) {
    throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_ACTOR_NOT_FOUND");
  }
};

const requireArtifactMatchesTarget = (
  artifact: AdditionalAiInsightsArtifact,
  target: AdditionalAiInsightEvaluationTarget,
  db: DatabaseSync,
  reservedResources?: readonly AdditionalAiInsightMethodResource[],
): void => {
  const resources = requireTarget(target, db, reservedResources);
  const methodSet = resolveReservedMethodSet(target, resources);
  if (!additionalAiInsightsArtifactIsValid({
    value: artifact,
    expectedMethods: methodSet.methods,
    expected: {
      workspaceId: target.workspaceId,
      projectId: target.projectId,
      scopeId: target.scopeId,
      dataSnapshotId: target.dataSnapshotId,
      projectReleaseId: target.projectReleaseId,
      analysisPeriod: target.analysisPeriod,
      modelProfileId: target.modelProfileId,
      modelProfileRevision: target.modelProfileRevision,
      methodSetId: target.methodSetId,
      methodSetRevision: target.methodSetRevision,
      methodSetFingerprint: target.methodSetFingerprint,
      outputContractRevision: target.outputContractRevision,
      capabilityRevision: target.capabilityRevision,
      publicationRevision: target.publicationRevision,
      canvasRevision: target.canvasRevision,
    },
  })) throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_ARTIFACT_INVALID");
};

const transitionArtifactAudit = (
  artifact: AdditionalAiInsightsArtifact,
  artifactId: string,
  artifactIdentityHash: string,
): AdditionalAiInsightTransitionArtifactAudit => {
  const findingEvidence = Object.fromEntries(artifact.findings.map(({ id, evidenceRefs }) => [id, [...evidenceRefs]]));
  return {
    artifactId,
    artifactIdentityHash,
    resultHash: sha256(JSON.stringify(artifact)),
    findingEvidence,
    evidenceRefs: uniqueStrings(artifact.findings.flatMap(({ evidenceRefs }) => evidenceRefs)),
  };
};

const parseEvaluation = (value: unknown): AdditionalAiInsightEvaluationBatch => {
  const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
  if (!additionalAiInsightEvaluationBatchIsValid(parsed)) {
    throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_RECORD_INVALID");
  }
  return clone(parsed);
};

const parseEvaluationReservation = (value: unknown): EvaluationReservation => {
  const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
  if (!isRecord(parsed)) throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_RESERVATION_INVALID");
  requireEvaluationReservation(parsed as EvaluationReservation);
  return clone(parsed as EvaluationReservation);
};

const parseTransition = (value: unknown): AdditionalAiInsightTransitionEvaluationRecord => {
  const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
  if (!additionalAiInsightTransitionRecordIsValid(parsed)) {
    throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_RECORD_INVALID");
  }
  return clone(parsed);
};

const parseTransitionReservation = (value: unknown): TransitionReservation => {
  const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
  if (!isRecord(parsed)
    || !nonEmpty(parsed.transitionId)
    || !nonEmpty(parsed.previousEvaluationId)
    || !nonEmpty(parsed.previousAttemptId)
    || !nonEmpty(parsed.currentArtifactId)
    || !hashValid(parsed.currentArtifactIdentityHash)
    || !Array.isArray(parsed.methodResources)) {
    throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_RESERVATION_INVALID");
  }
  requireTransitionReservation(parsed as TransitionReservation);
  return parsed as TransitionReservation;
};

const requireEvaluationReservation = (value: EvaluationReservation): void => {
  if (!isRecord(value.target)
    || !Array.isArray(value.methodResources)
    || (value.modelProfileSnapshot !== undefined && !modelProfileSnapshotIsValid(
      value.modelProfileSnapshot,
      value.target.modelProfileRevision,
    ))
    || (value.runtimeIdentity !== undefined && (!isRecord(value.runtimeIdentity)
      || sha256(JSON.stringify(value.runtimeIdentity)) !== value.target.artifactIdentityHash))) {
    throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_RESERVATION_INVALID");
  }
};

const requireTransitionReservation = (value: TransitionReservation): void => {
  if (!Array.isArray(value.methodResources)
    || (value.modelProfileSnapshot !== undefined && !modelProfileSnapshotIsValid(
      value.modelProfileSnapshot,
      value.currentTarget.modelProfileRevision,
    ))
    || (value.runtimeIdentity !== undefined && (!isRecord(value.runtimeIdentity)
      || sha256(JSON.stringify(value.runtimeIdentity)) !== value.currentTarget.artifactIdentityHash))) {
    throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_RESERVATION_INVALID");
  }
};

const modelProfileSnapshotIsValid = (
  value: unknown,
  expectedRevision: number,
): value is EnergyIqAdditionalInsightModelProfileSnapshot => isRecord(value)
  && value.bindingRevision === expectedRevision
  && Array.isArray(value.profiles)
  && value.profiles.length === 1
  && value.profiles.every((entry) => isRecord(entry)
    && nonEmpty(entry.exposedId)
    && nonEmpty(entry.ownerWorkspaceId)
    && nonEmpty(entry.ownerUserId)
    && isRecord(entry.resource)
    && entry.resource.kind === "model-profile"
    && entry.resource.default_enabled === true
    && entry.resource.status === "connected"
    && Number.isSafeInteger(entry.resource.revision)
    && isRecord(entry.resource.payload));

const resolveReservedMethodSet = (
  target: AdditionalAiInsightEvaluationTarget,
  resources: readonly AdditionalAiInsightMethodResource[],
) => {
  const workspaceResources = resources.filter(({ method }) => method.scope === "workspace");
  const methodSet = resolveAdditionalAiInsightMethodSet({
    workspaceId: target.workspaceId,
    methodSetId: target.methodSetId,
    methodSetRevision: target.methodSetRevision,
    workspaceMethodResources: workspaceResources,
  });
  if (!methodSet || JSON.stringify(methodSet.resources) !== JSON.stringify(resources)) {
    throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_TARGET_INVALID");
  }
  return methodSet;
};

const requireEvaluation = (record: AdditionalAiInsightEvaluationBatch): void => {
  if (!additionalAiInsightEvaluationBatchIsValid(record)) {
    throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_RECORD_INVALID");
  }
};

const attemptReservationIsValid = (value: AttemptReservation): boolean => nonEmpty(value.attemptId)
  && Number.isSafeInteger(value.ordinal)
  && value.ordinal > 0
  && nonEmpty(value.providerRunId)
  && nonEmpty(value.providerSessionId);

const evaluationArtifactIdentity = (
  target: AdditionalAiInsightEvaluationTarget,
  evaluationId: string,
  attemptId: string,
) => {
  const artifactIdentityHash = sha256(JSON.stringify({
    contractRevision: "additional-insight-evaluation-artifact-v1",
    target,
    evaluationId,
    attemptId,
  }));
  return {
    artifactId: `additional-evaluation-artifact-${artifactIdentityHash.slice(7, 31)}`,
    artifactIdentityHash,
    artifactIdentityRevision: "additional-insight-evaluation-artifact-v1" as const,
  };
};

const immediateTransaction = <T>(db: DatabaseSync, action: () => T): T => {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = action();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
};

const requireScores = (scores: AdditionalAiInsightHumanScores): void => {
  if (Object.values(scores).length !== 6
    || Object.values(scores).some((score) => !Number.isSafeInteger(score) || score < 1 || score > 5)) {
    throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_REVIEW_SCORES_INVALID");
  }
};

const requireContentUsefulness = (
  value: AdditionalAiInsightEvaluationHumanReview["contentUsefulness"],
  entry: AdditionalAiInsightEvaluationBatch["reviewPack"]["entries"][number],
): void => {
  const summaryMatches = entry.summary === undefined ? value.summary.applicable === false : value.summary.applicable === true;
  const expectedTokens = entry.findings.map(({ reviewFindingToken }) => reviewFindingToken);
  const actualTokens = value.insights.map(({ reviewFindingToken }) => reviewFindingToken);
  if (!summaryMatches
    || !sameStrings(actualTokens, expectedTokens)
    || value.insights.some(({ score }) => !Number.isSafeInteger(score) || score < 1 || score > 5)
    || (value.summary.applicable && (!Number.isSafeInteger(value.summary.score) || value.summary.score < 1 || value.summary.score > 5))) {
    throw new Error("ENERGYIQ_ADDITIONAL_EVALUATION_CONTENT_USEFULNESS_INVALID");
  }
};

const blindSortKey = (evaluationId: string, attemptId: string): string => sha256(`${evaluationId}:${attemptId}:sort`);
const blindToken = (evaluationId: string, attemptId: string): string => `blind-${sha256(`${evaluationId}:${attemptId}:token`).slice(7, 31)}`;
const blindSummaryToken = (evaluationId: string, attemptId: string): string => (
  `blind-summary-${sha256(`${evaluationId}:${attemptId}:summary`).slice(7, 31)}`
);
const blindFindingToken = (evaluationId: string, attemptId: string, findingId: string): string => (
  `blind-finding-${sha256(`${evaluationId}:${attemptId}:${findingId}:finding`).slice(7, 31)}`
);
const sha256 = (value: string): string => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const hashValid = (value: unknown): boolean => typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
const nonEmpty = (value: unknown): value is string => typeof value === "string" && /\S/u.test(value);
const requireNonEmpty = (value: unknown, code: string): void => { if (!nonEmpty(value)) throw new Error(code); };
const boundedCode = (value: string): string => nonEmpty(value) ? value.trim().slice(0, 160) : "UNKNOWN";
const unique = (values: readonly unknown[]): boolean => new Set(values).size === values.length;
const uniqueStrings = (values: readonly string[]): string[] => [...new Set(values)];
const sameNumbers = (left: readonly number[], right: readonly number[]): boolean => left.length === right.length
  && left.every((entry) => right.includes(entry));
const sameStrings = (left: readonly string[], right: readonly string[]): boolean => left.length === right.length
  && left.every((entry) => right.includes(entry));
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object"
  && value !== null
  && !Array.isArray(value);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
