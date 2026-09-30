import { createHash, randomUUID } from "node:crypto";

import {
  ADDITIONAL_AI_INSIGHT_EVALUATION_MACHINE_CHECKS,
  additionalAiInsightsArtifactIsValid,
  resolveCurrentAdditionalAiInsightMethodSet,
  type AdditionalAiInsightEvaluationAttempt,
  type AdditionalAiInsightEvaluationBatch,
  type AdditionalAiInsightEvaluationTarget,
  type AdditionalAiInsightMethodResource,
  type AdditionalAiInsightTransitionFindingRef,
  type AdditionalAiInsightTransitionEvaluationRecord,
  type AdditionalAiInsightTransitionOutcome,
  type AdditionalAiInsightsArtifact,
} from "@datafoundry/contracts";
import type {
  EnergyIqAdditionalInsightModelProfileSnapshot,
  MetadataStore,
  UserRecord,
} from "@datafoundry/metadata";

import {
  createPreschoolAdditionalAiInsightArtifactIdentity,
  type OverviewAiArtifactIdentityV13,
  type PreschoolAdditionalAiInsightArtifactIdentity,
} from "./overview-ai-artifact.js";
import { resolveWorkspaceDefaultModelProfileSnapshot } from "../workspace-model-profile-resolver.js";

export const MAX_PRESCHOOL_ADDITIONAL_TRANSITION_PROMPT_CHARS = 64_000;
export const PRESCHOOL_ADDITIONAL_AI_STRUCTURED_OUTPUT_ROOT_INVALID =
  "PRESCHOOL_ADDITIONAL_AI_STRUCTURED_OUTPUT_ROOT_INVALID";
export const PRESCHOOL_ADDITIONAL_AI_STRUCTURED_OUTPUT_SCHEMA_INVALID =
  "PRESCHOOL_ADDITIONAL_AI_STRUCTURED_OUTPUT_SCHEMA_INVALID";
const EVALUATION_CLAIM_LEASE_MS = 5 * 60_000;
const EVALUATION_CLAIM_HEARTBEAT_MS = 60_000;

export type PreschoolAdditionalAiInsightEvaluationAttemptRunner = (input: {
  identity: PreschoolAdditionalAiInsightArtifactIdentity;
  runId: string;
  sessionId: string;
  user: UserRecord;
  methodResources?: readonly AdditionalAiInsightMethodResource[];
  modelProfileSnapshot?: EnergyIqAdditionalInsightModelProfileSnapshot;
}) => Promise<AdditionalAiInsightsArtifact>;

export type PreschoolAdditionalAiInsightTransitionRunner = (input: {
  identity: PreschoolAdditionalAiInsightArtifactIdentity;
  prompt: string;
  runId: string;
  sessionId: string;
  user: UserRecord;
  modelProfileSnapshot?: EnergyIqAdditionalInsightModelProfileSnapshot;
}) => Promise<{ answer: string; runId: string; sessionId: string }>;

export type PreschoolAdditionalAiInsightsEvaluationWorkflow = {
  executePassAt3(input: {
    baseIdentity: OverviewAiArtifactIdentityV13;
    user: UserRecord;
    idempotencyKey: string;
  }): Promise<AdditionalAiInsightEvaluationBatch>;
  publishApprovedCandidate(input: {
    baseIdentity: OverviewAiArtifactIdentityV13;
    evaluationId: string;
    user: UserRecord;
    expectedRevision?: number;
  }): Promise<AdditionalAiInsightEvaluationBatch>;
  executeTransition(input: {
    baseIdentity: OverviewAiArtifactIdentityV13;
    user: UserRecord;
    idempotencyKey: string;
    previousEvaluationId: string;
    previousAttemptId: string;
  }): Promise<AdditionalAiInsightTransitionEvaluationRecord>;
};

export const createPreschoolAdditionalAiInsightsEvaluationWorkflow = (input: {
  metadataStore: MetadataStore;
  runAttempt: PreschoolAdditionalAiInsightEvaluationAttemptRunner;
  runTransition: PreschoolAdditionalAiInsightTransitionRunner;
  createId?: () => string;
}): PreschoolAdditionalAiInsightsEvaluationWorkflow => {
  const createId = input.createId ?? randomUUID;
  const resolveIdentity = (baseIdentity: OverviewAiArtifactIdentityV13) => {
    const methodSet = resolveCurrentAdditionalAiInsightMethodSet(
      baseIdentity.workspaceId,
      input.metadataStore.energyIq.insightMethodGovernance.listPublishedWorkspaceMethodResources({
        workspaceId: baseIdentity.workspaceId,
      }),
    );
    const modelProfileSnapshot = resolveWorkspaceDefaultModelProfileSnapshot(input.metadataStore);
    if (modelProfileSnapshot.bindingRevision !== baseIdentity.modelProfileRevision) {
      throw new Error("PRESCHOOL_ADDITIONAL_EVALUATION_MODEL_PROFILE_SNAPSHOT_MISMATCH");
    }
    return {
      identity: createPreschoolAdditionalAiInsightArtifactIdentity({ baseIdentity, methodSet }),
      expectedMethods: methodSet.methods,
      methodResources: methodSet.resources,
      modelProfileSnapshot,
    };
  };

  return {
    async executePassAt3({ baseIdentity, user, idempotencyKey }) {
      const existing = input.metadataStore.energyIq.additionalInsightEvaluations.findEvaluationReservationByIdempotencyKey({
        expectedWorkspaceId: baseIdentity.workspaceId,
        expectedProjectId: baseIdentity.projectId,
        idempotencyKey,
      });
      if (existing && existing.record.status !== "running") {
        const requestedTarget = evaluationTarget(resolveIdentity(baseIdentity).identity);
        if (!evaluationTargetsAreExactlyEqual(requestedTarget, existing.reservation.target)) {
          throw new Error("PRESCHOOL_ADDITIONAL_EVALUATION_IDEMPOTENCY_CONFLICT");
        }
        return existing.record;
      }
      const { identity, expectedMethods, methodResources, modelProfileSnapshot } = existing
        ? restoreReservedIdentity(baseIdentity, existing.reservation)
        : resolveIdentity(baseIdentity);
      const target = evaluationTarget(identity);
      const evaluationId = `additional-evaluation-${createId()}`;
      const attempts = [1, 2, 3].map((ordinal) => ({
        attemptId: `additional-evaluation-attempt-${createId()}`,
        ordinal,
        providerRunId: `preschool-additional-evaluation-${createId()}`,
        providerSessionId: `preschool-additional-evaluation-${createId()}`,
      }));
      const reserved = input.metadataStore.energyIq.additionalInsightEvaluations.reserveEvaluation({
        evaluationId,
        idempotencyKey,
        requestedBy: user.id,
        target,
        attempts,
        runtimeIdentity: identity,
        methodResources,
        modelProfileSnapshot,
      });
      const pendingAttempts = reserved.record.attempts.filter((attempt) => attempt.status === "running");
      if (pendingAttempts.length === 0) {
        return reserved.record.status === "running"
          ? input.metadataStore.energyIq.additionalInsightEvaluations.finalizeEvaluation({
            evaluationId: reserved.record.evaluationId,
            expectedWorkspaceId: identity.workspaceId,
            expectedProjectId: identity.projectId,
          })
          : reserved.record;
      }

      for (const attempt of pendingAttempts) {
        const claim = input.metadataStore.energyIq.additionalInsightEvaluations.claimEvaluationAttempt({
          evaluationId: reserved.record.evaluationId,
          expectedWorkspaceId: identity.workspaceId,
          expectedProjectId: identity.projectId,
          attemptId: attempt.attemptId,
        });
        if (!claim.acquired || !claim.claimToken) continue;
        if (persistedProviderRunIsActive(
          input.metadataStore,
          user,
          claim.attempt.providerRunId,
          claim.attempt.providerSessionId,
        )) continue;
        const heartbeat = startClaimHeartbeat(() => {
          input.metadataStore.energyIq.additionalInsightEvaluations.renewEvaluationAttemptClaim({
            evaluationId: reserved.record.evaluationId,
            expectedWorkspaceId: identity.workspaceId,
            expectedProjectId: identity.projectId,
            attemptId: attempt.attemptId,
            claimToken: claim.claimToken!,
            leaseMs: EVALUATION_CLAIM_LEASE_MS,
          });
        });
        try {
          const artifact = await input.runAttempt({
            identity,
            runId: claim.attempt.providerRunId,
            sessionId: claim.attempt.providerSessionId,
            user,
            methodResources,
            modelProfileSnapshot,
          });
          const machineGate = evaluateMachineGate(artifact, identity, expectedMethods);
          heartbeat.assertHealthy();
          input.metadataStore.energyIq.additionalInsightEvaluations.completeAttempt({
            evaluationId: reserved.record.evaluationId,
            expectedWorkspaceId: identity.workspaceId,
            expectedProjectId: identity.projectId,
            attemptId: attempt.attemptId,
            claimToken: claim.claimToken,
            artifact,
            machineGate,
          });
        } catch (error) {
          const code = errorCode(error);
          input.metadataStore.energyIq.additionalInsightEvaluations.failAttempt({
            evaluationId: reserved.record.evaluationId,
            expectedWorkspaceId: identity.workspaceId,
            expectedProjectId: identity.projectId,
            attemptId: attempt.attemptId,
            claimToken: claim.claimToken,
            errorCode: code,
            failureStage: failureStage(code),
          });
        } finally {
          heartbeat.stop();
        }
      }
      const latest = input.metadataStore.energyIq.additionalInsightEvaluations.getEvaluation({
        evaluationId: reserved.record.evaluationId,
        expectedWorkspaceId: identity.workspaceId,
        expectedProjectId: identity.projectId,
      });
      if (latest.attempts.some(({ status }) => status === "running")) return latest;
      return input.metadataStore.energyIq.additionalInsightEvaluations.finalizeEvaluation({
        evaluationId: reserved.record.evaluationId,
        expectedWorkspaceId: identity.workspaceId,
        expectedProjectId: identity.projectId,
      });
    },

    async publishApprovedCandidate({ baseIdentity, evaluationId, user, expectedRevision = 0 }) {
      const evaluationStore = input.metadataStore.energyIq.additionalInsightEvaluations;
      const evaluation = evaluationStore.getEvaluation({
        evaluationId,
        expectedWorkspaceId: baseIdentity.workspaceId,
        expectedProjectId: baseIdentity.projectId,
      });
      const { identity } = resolveIdentity(baseIdentity);
      if (!evaluationTargetsAreExactlyEqual(evaluation.target, evaluationTarget(identity))) {
        throw new Error("PRESCHOOL_ADDITIONAL_EVALUATION_PUBLICATION_TARGET_STALE");
      }
      const selectedAttemptId = evaluation.approval?.selectedAttemptId;
      const selected = selectedAttemptId
        ? evaluation.attempts.find((attempt): attempt is AdditionalAiInsightEvaluationAttempt => (
            attempt.attemptId === selectedAttemptId
            && attempt.status === "completed"
            && attempt.machineGate.status === "passed"
            && attempt.humanReview?.passed === true
          ))
        : undefined;
      if (evaluation.status !== "approved-candidate" || !selected) {
        throw new Error("PRESCHOOL_ADDITIONAL_EVALUATION_PUBLICATION_NOT_APPROVED");
      }
      const artifact = evaluationStore.getAttemptArtifact({
        evaluationId,
        attemptId: selected.attemptId,
        expectedWorkspaceId: baseIdentity.workspaceId,
        expectedProjectId: baseIdentity.projectId,
      });
      if (artifact.status !== "available" || artifact.findings.length === 0) {
        throw new Error("PRESCHOOL_ADDITIONAL_EVALUATION_PUBLICATION_EMPTY");
      }
      const resultJson = JSON.stringify(artifact);
      const artifactStore = input.metadataStore.energyIq.overviewAiArtifacts;
      let current = artifactStore.queue({ identity, triggeredBy: user.id });
      if (current.status === "available") {
        if (current.result_json !== resultJson
          || current.run_id !== selected.providerRunId
          || current.session_id !== selected.providerSessionId) {
          throw new Error("PRESCHOOL_ADDITIONAL_EVALUATION_PUBLICATION_CONFLICT");
        }
      } else {
        const workerId = `approved-additional-publication:${evaluationId}:${selected.attemptId}`;
        const claim = artifactStore.claim({ identity, workerId, leaseMs: 60_000 });
        if (!claim.claimed) {
          throw new Error("PRESCHOOL_ADDITIONAL_EVALUATION_PUBLICATION_IN_PROGRESS");
        }
        current = artifactStore.complete({
          identity,
          workerId,
          sessionId: selected.providerSessionId,
          runId: selected.providerRunId,
          resultJson,
        });
      }
      return evaluationStore.recordApprovedCandidatePublication({
        evaluationId,
        expectedWorkspaceId: baseIdentity.workspaceId,
        expectedProjectId: baseIdentity.projectId,
        sourceAttemptId: selected.attemptId,
        artifactId: current.id,
        artifactIdentityHash: evaluation.target.artifactIdentityHash,
        actorId: user.id,
        expectedRevision,
      });
    },

    async executeTransition({ baseIdentity, user, idempotencyKey, previousEvaluationId, previousAttemptId }) {
      const existing = input.metadataStore.energyIq.additionalInsightEvaluations.findTransitionReservationByIdempotencyKey({
        expectedWorkspaceId: baseIdentity.workspaceId,
        expectedProjectId: baseIdentity.projectId,
        idempotencyKey,
      });
      if (existing) {
        if (existing.previousEvaluationId !== previousEvaluationId
          || existing.previousAttemptId !== previousAttemptId) {
          throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_IDEMPOTENCY_CONFLICT");
        }
        const stored = input.metadataStore.energyIq.additionalInsightEvaluations.getTransition({
          transitionId: existing.transitionId,
          expectedWorkspaceId: baseIdentity.workspaceId,
          expectedProjectId: baseIdentity.projectId,
        });
        if (stored.status !== "running") {
          const requestedTarget = evaluationTarget(resolveIdentity(baseIdentity).identity);
          if (!evaluationTargetsAreExactlyEqual(requestedTarget, existing.currentTarget)) {
            throw new Error("ENERGYIQ_ADDITIONAL_TRANSITION_IDEMPOTENCY_CONFLICT");
          }
          return stored;
        }
      }
      const { identity, expectedMethods, methodResources, modelProfileSnapshot } = existing
        ? restoreReservedIdentity(baseIdentity, {
          target: existing.currentTarget,
          methodResources: existing.methodResources,
          ...(existing.runtimeIdentity ? { runtimeIdentity: existing.runtimeIdentity } : {}),
          ...(existing.modelProfileSnapshot ? { modelProfileSnapshot: existing.modelProfileSnapshot } : {}),
        })
        : resolveIdentity(baseIdentity);
      const target = evaluationTarget(identity);
      const transitionId = `additional-transition-${createId()}`;
      const generationProviderRunId = `preschool-additional-transition-generation-${createId()}`;
      const generationProviderSessionId = `preschool-additional-transition-generation-${createId()}`;
      const comparisonProviderRunId = `preschool-additional-transition-comparison-${createId()}`;
      const comparisonProviderSessionId = `preschool-additional-transition-comparison-${createId()}`;
      const reservation = input.metadataStore.energyIq.additionalInsightEvaluations.reserveTransition({
        transitionId,
        idempotencyKey,
        requestedBy: user.id,
        previousEvaluationId,
        previousAttemptId,
        currentTarget: target,
        generationProviderRunId,
        generationProviderSessionId,
        comparisonProviderRunId,
        comparisonProviderSessionId,
        runtimeIdentity: identity,
        methodResources,
        modelProfileSnapshot,
      });
      if (reservation.record) return reservation.record;
      const claim = input.metadataStore.energyIq.additionalInsightEvaluations.claimTransition({
        transitionId: reservation.transitionId,
        expectedWorkspaceId: identity.workspaceId,
        expectedProjectId: identity.projectId,
      });
      if (!claim.acquired || !claim.claimToken) {
        return input.metadataStore.energyIq.additionalInsightEvaluations.getTransition({
          transitionId: reservation.transitionId,
          expectedWorkspaceId: identity.workspaceId,
          expectedProjectId: identity.projectId,
        });
      }
      const heartbeat = startClaimHeartbeat(() => {
        input.metadataStore.energyIq.additionalInsightEvaluations.renewTransitionClaim({
          transitionId: reservation.transitionId,
          expectedWorkspaceId: identity.workspaceId,
          expectedProjectId: identity.projectId,
          claimToken: claim.claimToken!,
          leaseMs: EVALUATION_CLAIM_LEASE_MS,
        });
      });
      let failureStage: "generation" | "validation" | "comparison" = "generation";
      try {
        if (persistedProviderRunIsActive(
          input.metadataStore,
          user,
          reservation.generationProviderRunId,
          reservation.generationProviderSessionId,
        )) {
          return input.metadataStore.energyIq.additionalInsightEvaluations.getTransition({
            transitionId: reservation.transitionId,
            expectedWorkspaceId: identity.workspaceId,
            expectedProjectId: identity.projectId,
          });
        }
        const previousArtifact = input.metadataStore.energyIq.additionalInsightEvaluations.getAttemptArtifact({
          evaluationId: previousEvaluationId,
          attemptId: previousAttemptId,
          expectedWorkspaceId: identity.workspaceId,
          expectedProjectId: identity.projectId,
        });
        const previousAttempt = completedAttempt(
          input.metadataStore,
          previousEvaluationId,
          previousAttemptId,
          identity.workspaceId,
          identity.projectId,
        );
        const currentArtifact = await input.runAttempt({
          identity,
          runId: reservation.generationProviderRunId,
          sessionId: reservation.generationProviderSessionId,
          user,
          methodResources,
          modelProfileSnapshot,
        });
        failureStage = "validation";
        if (evaluateMachineGate(currentArtifact, identity, expectedMethods).status !== "passed") {
          throw new Error("PRESCHOOL_ADDITIONAL_TRANSITION_CURRENT_ARTIFACT_INVALID");
        }
        rejectPreviousSnapshotLeak(previousArtifact, currentArtifact);
        const prompt = buildTransitionPrompt(previousArtifact, currentArtifact);
        if (prompt.length > MAX_PRESCHOOL_ADDITIONAL_TRANSITION_PROMPT_CHARS) {
          throw new Error("PRESCHOOL_ADDITIONAL_TRANSITION_PROMPT_TOO_LARGE");
        }
        failureStage = "comparison";
        if (persistedProviderRunIsActive(
          input.metadataStore,
          user,
          reservation.comparisonProviderRunId,
          reservation.comparisonProviderSessionId,
        )) {
          return input.metadataStore.energyIq.additionalInsightEvaluations.getTransition({
            transitionId: reservation.transitionId,
            expectedWorkspaceId: identity.workspaceId,
            expectedProjectId: identity.projectId,
          });
        }
        const compared = await input.runTransition({
          identity,
          prompt,
          runId: reservation.comparisonProviderRunId,
          sessionId: reservation.comparisonProviderSessionId,
          user,
          modelProfileSnapshot,
        });
        if (compared.runId !== reservation.comparisonProviderRunId
          || compared.sessionId !== reservation.comparisonProviderSessionId) {
          throw new Error("PRESCHOOL_ADDITIONAL_TRANSITION_PROVIDER_IDENTITY_MISMATCH");
        }
        failureStage = "validation";
        const outcomes = parseTransitionOutcomes({
          answer: compared.answer,
          previousArtifact,
          currentArtifact,
          previousArtifactId: previousAttempt.artifact.artifactId,
          previousArtifactIdentityHash: previousAttempt.artifact.artifactIdentityHash,
          currentArtifactId: reservation.currentArtifactId,
          currentArtifactIdentityHash: reservation.currentArtifactIdentityHash,
        });
        heartbeat.assertHealthy();
        failureStage = "validation";
        return input.metadataStore.energyIq.additionalInsightEvaluations.completeTransition({
          transitionId: reservation.transitionId,
          expectedWorkspaceId: identity.workspaceId,
          expectedProjectId: identity.projectId,
          claimToken: claim.claimToken,
          currentArtifact,
          outcomes,
        });
      } catch (error) {
        return input.metadataStore.energyIq.additionalInsightEvaluations.failTransition({
          transitionId: reservation.transitionId,
          expectedWorkspaceId: identity.workspaceId,
          expectedProjectId: identity.projectId,
          claimToken: claim.claimToken,
          errorCode: errorCode(error),
          failureStage,
        });
      } finally {
        heartbeat.stop();
      }
    },
  };
};

const restoreReservedIdentity = (
  baseIdentity: OverviewAiArtifactIdentityV13,
  reservation: {
    target: AdditionalAiInsightEvaluationTarget;
    runtimeIdentity?: Record<string, unknown>;
    methodResources: readonly AdditionalAiInsightMethodResource[];
    modelProfileSnapshot?: EnergyIqAdditionalInsightModelProfileSnapshot;
  },
) => {
  const expectedMethods = reservation.methodResources.map(({ method }) => method);
  let identity: PreschoolAdditionalAiInsightArtifactIdentity;
  if (reservation.runtimeIdentity
    && sha256(JSON.stringify(reservation.runtimeIdentity)) === reservation.target.artifactIdentityHash) {
    identity = reservation.runtimeIdentity as PreschoolAdditionalAiInsightArtifactIdentity;
  } else {
    const methodSet = {
      id: reservation.target.methodSetId,
      revision: reservation.target.methodSetRevision,
      methods: expectedMethods,
      resources: reservation.methodResources,
    };
    identity = createPreschoolAdditionalAiInsightArtifactIdentity({
      baseIdentity: {
        ...baseIdentity,
        workspaceId: reservation.target.workspaceId,
        projectId: reservation.target.projectId,
        scopeId: reservation.target.scopeId,
        resource: reservation.target.resource,
        dataSnapshotId: reservation.target.dataSnapshotId,
        projectReleaseId: reservation.target.projectReleaseId,
        analysisPeriodFrom: reservation.target.analysisPeriod.from,
        analysisPeriodTo: reservation.target.analysisPeriod.to,
        modelProfileId: reservation.target.modelProfileId,
        modelProfileRevision: reservation.target.modelProfileRevision,
      },
      methodSet,
    });
  }
  if (!evaluationTargetsAreExactlyEqual(evaluationTarget(identity), reservation.target)) {
    throw new Error("PRESCHOOL_ADDITIONAL_EVALUATION_RESERVED_IDENTITY_INVALID");
  }
  const modelProfileSnapshot = reservation.modelProfileSnapshot;
  if (!modelProfileSnapshot) {
    throw new Error("PRESCHOOL_ADDITIONAL_EVALUATION_RESERVED_MODEL_PROFILE_UNAVAILABLE");
  }
  if (modelProfileSnapshot.bindingRevision !== reservation.target.modelProfileRevision) {
    throw new Error("PRESCHOOL_ADDITIONAL_EVALUATION_RESERVED_MODEL_PROFILE_UNAVAILABLE");
  }
  return {
    identity,
    expectedMethods,
    methodResources: reservation.methodResources,
    modelProfileSnapshot,
  };
};

const startClaimHeartbeat = (renew: () => void): {
  assertHealthy(): void;
  stop(): void;
} => {
  let failure: unknown;
  const timer = setInterval(() => {
    try {
      renew();
    } catch (error) {
      failure = error;
    }
  }, EVALUATION_CLAIM_HEARTBEAT_MS);
  timer.unref?.();
  return {
    assertHealthy() {
      if (failure) throw failure;
    },
    stop() {
      clearInterval(timer);
    },
  };
};

const persistedProviderRunIsActive = (
  metadataStore: MetadataStore,
  user: UserRecord,
  runId: string,
  sessionId: string,
): boolean => {
  const run = metadataStore.runs.find({ user_id: user.id, run_id: runId });
  if (!run) return false;
  if (run.session_id !== sessionId) {
    throw new Error("PRESCHOOL_ADDITIONAL_EVALUATION_PROVIDER_IDENTITY_MISMATCH");
  }
  return run.status === "queued" || run.status === "running" || run.status === "suspended";
};

const evaluationTarget = (
  identity: PreschoolAdditionalAiInsightArtifactIdentity,
): AdditionalAiInsightEvaluationTarget => ({
  workspaceId: identity.workspaceId,
  projectId: identity.projectId,
  scopeId: identity.scopeId,
  resource: identity.resource,
  dataSnapshotId: identity.dataSnapshotId,
  projectReleaseId: identity.projectReleaseId,
  analysisPeriod: { from: identity.analysisPeriodFrom, to: identity.analysisPeriodTo },
  modelProfileId: identity.modelProfileId,
  modelProfileRevision: identity.modelProfileRevision,
  artifactIdentityRevision: identity.identityContractRevision,
  artifactIdentityHash: sha256(JSON.stringify(identity)),
  outputContractRevision: identity.outputContractRevision,
  validatorRevision: identity.validatorRevision,
  workflowRevision: identity.workflowRevision,
  promptRevision: identity.investigatorPromptRevision,
  capabilityRevision: identity.capabilityRevision,
  publicationRevision: identity.publicationRevision,
  canvasRevision: identity.canvasRevision,
  methodSetId: identity.methodSetId,
  methodSetRevision: identity.methodSetRevision,
  methodSetFingerprint: identity.methodSetFingerprint,
});

const canonicalEvaluationTargetJson = (target: AdditionalAiInsightEvaluationTarget): string => JSON.stringify({
  workspaceId: target.workspaceId,
  projectId: target.projectId,
  scopeId: target.scopeId,
  resource: target.resource,
  dataSnapshotId: target.dataSnapshotId,
  projectReleaseId: target.projectReleaseId,
  analysisPeriod: { from: target.analysisPeriod.from, to: target.analysisPeriod.to },
  modelProfileId: target.modelProfileId,
  modelProfileRevision: target.modelProfileRevision,
  artifactIdentityRevision: target.artifactIdentityRevision,
  artifactIdentityHash: target.artifactIdentityHash,
  outputContractRevision: target.outputContractRevision,
  validatorRevision: target.validatorRevision,
  workflowRevision: target.workflowRevision,
  promptRevision: target.promptRevision,
  capabilityRevision: target.capabilityRevision,
  publicationRevision: target.publicationRevision,
  canvasRevision: target.canvasRevision,
  methodSetId: target.methodSetId,
  methodSetRevision: target.methodSetRevision,
  methodSetFingerprint: target.methodSetFingerprint,
});

const evaluationTargetsAreExactlyEqual = (
  left: AdditionalAiInsightEvaluationTarget,
  right: AdditionalAiInsightEvaluationTarget,
): boolean => canonicalEvaluationTargetJson(left) === canonicalEvaluationTargetJson(right);

const evaluateMachineGate = (
  artifact: AdditionalAiInsightsArtifact,
  identity: PreschoolAdditionalAiInsightArtifactIdentity,
  expectedMethods: ReturnType<typeof resolveCurrentAdditionalAiInsightMethodSet>["methods"],
): AdditionalAiInsightEvaluationAttempt["machineGate"] => {
  const expected = {
    workspaceId: identity.workspaceId,
    projectId: identity.projectId,
    scopeId: identity.scopeId,
    dataSnapshotId: identity.dataSnapshotId,
    projectReleaseId: identity.projectReleaseId,
    analysisPeriod: { from: identity.analysisPeriodFrom, to: identity.analysisPeriodTo },
    modelProfileId: identity.modelProfileId,
    modelProfileRevision: identity.modelProfileRevision,
    methodSetId: identity.methodSetId,
    methodSetRevision: identity.methodSetRevision,
    methodSetFingerprint: identity.methodSetFingerprint,
    outputContractRevision: identity.outputContractRevision,
    capabilityRevision: identity.capabilityRevision,
    publicationRevision: identity.publicationRevision,
    canvasRevision: identity.canvasRevision,
  };
  const honestEmpty = artifact.status !== "empty"
    || (artifact.publication.discoveredCount === 0
      && artifact.publication.acceptedCount === 0
      && artifact.publication.rejectedCount === 0);
  const contractBoundary = honestEmpty
    && additionalAiInsightsArtifactIsValid({ value: artifact, expected, expectedMethods });
  const factIds = new Set(artifact.evidenceLineage.facts.map(({ id }) => id));
  const factBoundary = artifact.findings.every(({ evidenceRefs }) => evidenceRefs.every((ref) => factIds.has(ref)));
  const provenance = artifact.findings.every(({ origin, toolAuditIds }) => (
    origin.coreMethod.resourceId === expectedMethods[0]?.resourceId
    && origin.directionMethods.every((method) => artifact.methodExecution.loadedMethods.some(
      ({ resourceId, resourceRevision, contentSha256 }) => resourceId === method.resourceId
        && resourceRevision === method.resourceRevision
        && contentSha256 === method.contentSha256,
    ))
    && toolAuditIds.every((id) => artifact.toolAudits.some(({ auditId }) => auditId === id))
  ));
  const normalized = artifact.findings.map(({ title, text }) => `${title.trim().toLowerCase()}\n${text.trim().toLowerCase()}`);
  const duplicate = new Set(normalized).size === normalized.length;
  const expressionLength = artifact.findings.every(({ title, text }) => title.length <= 240 && text.length <= 1_200);
  let restoreCompleteness = false;
  try {
    restoreCompleteness = additionalAiInsightsArtifactIsValid({
      value: JSON.parse(JSON.stringify(artifact)) as unknown,
      expected,
      expectedMethods,
    });
  } catch {
    restoreCompleteness = false;
  }
  const results: Record<typeof ADDITIONAL_AI_INSIGHT_EVALUATION_MACHINE_CHECKS[number], boolean> = {
    "contract-boundary": contractBoundary,
    "fact-boundary": factBoundary,
    provenance,
    duplicate,
    "expression-length": expressionLength,
    "restore-completeness": restoreCompleteness,
  };
  const checks = ADDITIONAL_AI_INSIGHT_EVALUATION_MACHINE_CHECKS.map((check) => ({
    check,
    passed: results[check],
    ...(results[check] ? {} : { code: `ADDITIONAL_EVALUATION_${check.toUpperCase().replaceAll("-", "_")}_FAILED` }),
  }));
  return { status: checks.every(({ passed }) => passed) ? "passed" : "failed", checks };
};

const buildTransitionPrompt = (
  previousArtifact: AdditionalAiInsightsArtifact,
  currentArtifact: AdditionalAiInsightsArtifact,
): string => [
  "Compare Snapshot A and Snapshot B using an Evidence-bound classification.",
  "Return New, Changed, Still supported, Resolved, or No material change. Do not classify from text similarity alone.",
  "Classify every Snapshot A Finding and every Snapshot B Finding exactly once. Every paired outcome must cite exact A and B Finding IDs and each Finding's exact Evidence refs.",
  "Use No material change only when both Snapshots contain zero Findings. If non-empty A and B Findings are unrelated, return Resolved for the A Finding and New for the B Finding instead of hiding the change.",
  "Do not manufacture novelty or Alerts.",
  `Snapshot A audit: ${JSON.stringify(projectTransitionArtifact(previousArtifact))}`,
  `Snapshot B audit: ${JSON.stringify(projectTransitionArtifact(currentArtifact))}`,
].join("\n\n");

const projectTransitionArtifact = (artifact: AdditionalAiInsightsArtifact) => ({
  binding: artifact.binding,
  findings: artifact.findings.map(({ id, title, text, epistemicStatus, evidenceRefs, alert }) => ({
    id, title, text, epistemicStatus, evidenceRefs, ...(alert ? { alert } : {}),
  })),
  evidence: artifact.evidenceLineage.facts,
});

const parseTransitionOutcomes = (input: {
  answer: string;
  previousArtifact: AdditionalAiInsightsArtifact;
  currentArtifact: AdditionalAiInsightsArtifact;
  previousArtifactId: string;
  previousArtifactIdentityHash: string;
  currentArtifactId: string;
  currentArtifactIdentityHash: string;
}): AdditionalAiInsightTransitionOutcome[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.answer);
  } catch {
    throw new Error("PRESCHOOL_ADDITIONAL_TRANSITION_RESULT_INVALID");
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.outcomes) || parsed.outcomes.length === 0) {
    throw new Error("PRESCHOOL_ADDITIONAL_TRANSITION_RESULT_INVALID");
  }
  const previousFindings = new Map(input.previousArtifact.findings.map((finding) => [finding.id, finding]));
  const currentFindings = new Map(input.currentArtifact.findings.map((finding) => [finding.id, finding]));
  if (parsed.outcomes.some((value) => isRecord(value) && value.transition === "no-material-change")
    && (parsed.outcomes.length !== 1 || previousFindings.size > 0 || currentFindings.size > 0)) {
    throw new Error("PRESCHOOL_ADDITIONAL_TRANSITION_RESULT_INCOMPLETE");
  }
  const outcomes = parsed.outcomes.map((value): AdditionalAiInsightTransitionOutcome => {
    if (!isRecord(value) || typeof value.transition !== "string") {
      throw new Error("PRESCHOOL_ADDITIONAL_TRANSITION_RESULT_INVALID");
    }
    if (value.transition === "no-material-change") return { transition: "no-material-change" };
    if (value.transition === "new") {
      return {
        transition: "new",
        current: requireFindingRef(
          value,
          "current",
          currentFindings,
          input.currentArtifactId,
          input.currentArtifactIdentityHash,
        ),
      };
    }
    if (value.transition === "resolved") {
      return {
        transition: "resolved",
        previous: requireFindingRef(
          value,
          "previous",
          previousFindings,
          input.previousArtifactId,
          input.previousArtifactIdentityHash,
        ),
      };
    }
    if (value.transition === "changed" || value.transition === "still-supported") {
      return {
        transition: value.transition,
        previous: requireFindingRef(
          value,
          "previous",
          previousFindings,
          input.previousArtifactId,
          input.previousArtifactIdentityHash,
        ),
        current: requireFindingRef(
          value,
          "current",
          currentFindings,
          input.currentArtifactId,
          input.currentArtifactIdentityHash,
        ),
      };
    }
    throw new Error("PRESCHOOL_ADDITIONAL_TRANSITION_RESULT_INVALID");
  });
  const coveredPrevious = outcomes.flatMap((outcome) => (
    "previous" in outcome ? [outcome.previous.findingId] : []
  ));
  const coveredCurrent = outcomes.flatMap((outcome) => (
    "current" in outcome ? [outcome.current.findingId] : []
  ));
  if (!sameUniqueStrings(coveredPrevious, [...previousFindings.keys()])
    || !sameUniqueStrings(coveredCurrent, [...currentFindings.keys()])) {
    throw new Error("PRESCHOOL_ADDITIONAL_TRANSITION_RESULT_INCOMPLETE");
  }
  return outcomes;
};

const requireFindingRef = (
  value: Record<string, unknown>,
  prefix: "previous" | "current",
  findings: Map<string, AdditionalAiInsightsArtifact["findings"][number]>,
  artifactId: string,
  artifactIdentityHash: string,
): AdditionalAiInsightTransitionFindingRef => {
  const findingId = value[`${prefix}FindingId`];
  const evidenceRefs = value[`${prefix}EvidenceRefs`];
  if (typeof findingId !== "string") {
    throw new Error("PRESCHOOL_ADDITIONAL_TRANSITION_RESULT_INVALID");
  }
  const finding = findings.get(findingId);
  if (!finding
    || !Array.isArray(evidenceRefs)
    || evidenceRefs.some((entry) => typeof entry !== "string")
    || !sameUniqueStrings(evidenceRefs as string[], finding.evidenceRefs)) {
    throw new Error("PRESCHOOL_ADDITIONAL_TRANSITION_RESULT_INVALID");
  }
  return { artifactId, artifactIdentityHash, findingId, evidenceRefs: [...finding.evidenceRefs] };
};

const rejectPreviousSnapshotLeak = (
  previous: AdditionalAiInsightsArtifact,
  current: AdditionalAiInsightsArtifact,
): void => {
  const previousFacts = numericFactsById(previous);
  const currentFacts = numericFactsById(current);
  const previousFindingNumbers = new Set(previous.findings.flatMap(({ evidenceRefs }) => (
    evidenceRefs.flatMap((ref) => previousFacts.has(ref) ? [previousFacts.get(ref)!] : [])
  )));
  const leaked = current.findings.some((finding) => {
    const supported = new Set(finding.evidenceRefs.flatMap((ref) => (
      currentFacts.has(ref) ? [currentFacts.get(ref)!] : []
    )));
    const mentioned = numericTextValues(`${finding.title} ${finding.text} ${finding.deepDiveQuestion ?? ""}`);
    return mentioned.some((value) => previousFindingNumbers.has(value) && !supported.has(value));
  });
  if (leaked) {
    throw new Error("PRESCHOOL_ADDITIONAL_TRANSITION_REUSES_PREVIOUS_NUMBER");
  }
};

const numericFactsById = (artifact: AdditionalAiInsightsArtifact): Map<string, string> => new Map(
  artifact.evidenceLineage.facts.flatMap((fact) => "value" in fact
      && typeof fact.value === "number"
      && Number.isFinite(fact.value)
    ? [[fact.id, normalizedNumber(fact.value)]]
    : []),
);

const numericTextValues = (text: string): string[] => [...text.matchAll(
  /(?<![\p{L}\p{N}_])[-+]?(?:(?:\d{1,3}(?:[, \u202f]\d{3})+|\d+)(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?(?![\p{L}\p{N}_])/giu,
)].map(([token]) => normalizedNumber(Number(token.replace(/[, \u202f]/gu, ""))))
  .filter((value) => value !== "NaN");

const normalizedNumber = (value: number): string => Object.is(value, -0) ? "0" : String(value);

const completedAttempt = (
  metadataStore: MetadataStore,
  evaluationId: string,
  attemptId: string,
  workspaceId: string,
  projectId: string,
): AdditionalAiInsightEvaluationAttempt => {
  const row = metadataStore.energyIq.additionalInsightEvaluations.getEvaluation({
    evaluationId,
    expectedWorkspaceId: workspaceId,
    expectedProjectId: projectId,
  });
  const attempt = row.attempts.find((candidate) => candidate.attemptId === attemptId);
  if (!attempt || attempt.status !== "completed") throw new Error("PRESCHOOL_ADDITIONAL_TRANSITION_PREVIOUS_ATTEMPT_INVALID");
  return attempt;
};

const failureStage = (code: string): "provider" | "structured-output" | "machine-gate" => (
  (code === "PRESCHOOL_ADDITIONAL_AI_DISCOVERY_RESULT_INVALID"
    || code === "PRESCHOOL_ADDITIONAL_AI_PUBLICATION_INVALID"
    || code === PRESCHOOL_ADDITIONAL_AI_STRUCTURED_OUTPUT_ROOT_INVALID
    || code === PRESCHOOL_ADDITIONAL_AI_STRUCTURED_OUTPUT_SCHEMA_INVALID)
    ? "structured-output"
    : /MACHINE_GATE/u.test(code)
      ? "machine-gate"
      : "provider"
);

const LOCAL_STRUCTURED_OUTPUT_ERROR_CODES = [
  PRESCHOOL_ADDITIONAL_AI_STRUCTURED_OUTPUT_ROOT_INVALID,
  PRESCHOOL_ADDITIONAL_AI_STRUCTURED_OUTPUT_SCHEMA_INVALID,
] as const;
const errorCode = (error: unknown): string => {
  if (!(error instanceof Error) || !/\S/u.test(error.message)) {
    return "PRESCHOOL_ADDITIONAL_EVALUATION_ATTEMPT_FAILED";
  }
  const message = error.message.trim();
  const localCode = LOCAL_STRUCTURED_OUTPUT_ERROR_CODES.find((code) => (
    message === code || message === `Error: ${code}`
  ));
  return localCode ?? message.slice(0, 160);
};
const sha256 = (value: string): string => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const sameStrings = (left: readonly string[], right: readonly string[]): boolean => left.length === right.length
  && left.every((entry) => right.includes(entry));

const sameUniqueStrings = (left: readonly string[], right: readonly string[]): boolean => (
  new Set(left).size === left.length
  && new Set(right).size === right.length
  && sameStrings(left, right)
);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object"
  && value !== null
  && !Array.isArray(value);
