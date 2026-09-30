import type { AdditionalAiInsightEpistemicStatus } from "./energyiq-additional-ai-insights.js";

export const ADDITIONAL_AI_INSIGHT_EVALUATION_MACHINE_CHECKS = [
  "contract-boundary",
  "fact-boundary",
  "provenance",
  "duplicate",
  "expression-length",
  "restore-completeness",
] as const;

export type AdditionalAiInsightEvaluationMachineCheck =
  typeof ADDITIONAL_AI_INSIGHT_EVALUATION_MACHINE_CHECKS[number];

export type AdditionalAiInsightEvaluationTarget = {
  workspaceId: string;
  projectId: string;
  scopeId: string;
  resource: "electricity";
  dataSnapshotId: string;
  projectReleaseId: string;
  analysisPeriod: { from: string; to: string };
  modelProfileId: string;
  modelProfileRevision: number;
  artifactIdentityRevision: string;
  artifactIdentityHash: string;
  outputContractRevision: string;
  validatorRevision: string;
  workflowRevision: string;
  promptRevision: string;
  capabilityRevision: string;
  publicationRevision: string;
  canvasRevision: string;
  methodSetId: string;
  methodSetRevision: string;
  methodSetFingerprint: string;
};

export type AdditionalAiInsightHumanScores = {
  newAngle: number;
  relevance: number;
  clarity: number;
  worthExploring: number;
  epistemicHonesty: number;
  userValue: number;
};

export type AdditionalAiInsightEvaluationHumanReview = {
  actorId: string;
  reviewedAt: string;
  scores: AdditionalAiInsightHumanScores;
  contentUsefulness: {
    summary: { applicable: false } | { applicable: true; score: number };
    insights: Array<{ reviewFindingToken: string; score: number }>;
  };
  passed: boolean;
  revision: number;
};

export type AdditionalAiInsightEvaluationArtifactIdentity = {
  artifactId: string;
  artifactIdentityHash: string;
  artifactIdentityRevision: "additional-insight-evaluation-artifact-v1";
};

export type AdditionalAiInsightEvaluationAttempt = {
  attemptId: string;
  ordinal: number;
  status: "completed";
  providerRunId: string;
  providerSessionId: string;
  artifact: AdditionalAiInsightEvaluationArtifactIdentity & {
    resultHash: string;
    resultStatus: "available" | "empty";
  };
  statistics: {
    discoveredCount: number;
    acceptedCount: number;
    rejectedCount: number;
    publishedCount: number;
  };
  evidenceRefs: string[];
  methodResourceIds: string[];
  toolAuditIds: string[];
  machineGate: {
    status: "passed" | "failed";
    checks: Array<{ check: AdditionalAiInsightEvaluationMachineCheck; passed: boolean; code?: string }>;
  };
  humanReview?: AdditionalAiInsightEvaluationHumanReview;
  startedAt: string;
  completedAt: string;
};

export type AdditionalAiInsightEvaluationFailedAttempt = {
  attemptId: string;
  ordinal: number;
  status: "failed";
  providerRunId: string;
  providerSessionId: string;
  artifact: AdditionalAiInsightEvaluationArtifactIdentity;
  errorCode: string;
  failureStage: "provider" | "structured-output" | "machine-gate";
  startedAt: string;
  completedAt: string;
};

export type AdditionalAiInsightEvaluationRunningAttempt = {
  attemptId: string;
  ordinal: number;
  status: "running";
  providerRunId: string;
  providerSessionId: string;
  artifact: AdditionalAiInsightEvaluationArtifactIdentity;
  startedAt: string;
};

export type AdditionalAiInsightBlindedReviewEntry = {
  label: "Review A" | "Review B" | "Review C";
  reviewToken: string;
  summary?: { reviewSummaryToken: string; text: string };
  findings: Array<{
    reviewFindingToken: string;
    title: string;
    text: string;
    epistemicStatus: AdditionalAiInsightEpistemicStatus;
    evidenceRefs: string[];
    originKind: "ai-discovery" | "expert-sop" | "hybrid";
    directionMethodResourceIds: string[];
    alert?: { severity: "attention" | "urgent"; certainty: "confirmed" | "anomaly" | "possible" };
  }>;
};

export type AdditionalAiInsightEvaluationApproval = {
  selectedAttemptId: string;
  actorId: string;
  approvedAt: string;
  revision: number;
  disposition: "publication-candidate-only";
};

export type AdditionalAiInsightEvaluationPublication = {
  sourceAttemptId: string;
  artifactId: string;
  artifactIdentityHash: string;
  actorId: string;
  publishedAt: string;
  revision: number;
};

export type AdditionalAiInsightEvaluationBatch = {
  contractRevision: "energyiq-additional-insight-evaluation-v1";
  evaluationId: string;
  idempotencyKey: string;
  requestedBy: string;
  status: "running" | "awaiting-human-review" | "failed" | "passed" | "approved-candidate";
  target: AdditionalAiInsightEvaluationTarget;
  attempts: Array<
    AdditionalAiInsightEvaluationAttempt
    | AdditionalAiInsightEvaluationFailedAttempt
    | AdditionalAiInsightEvaluationRunningAttempt
  >;
  reviewPack: {
    revision: "additional-insight-blind-review-v1";
    entries: AdditionalAiInsightBlindedReviewEntry[];
  };
  reviewAudit: Array<{ reviewToken: string; attemptId: string }>;
  approval?: AdditionalAiInsightEvaluationApproval;
  publication?: AdditionalAiInsightEvaluationPublication;
  createdAt: string;
  updatedAt: string;
};

export type AdditionalAiInsightPassAt3Result = "pending-human-review" | "passed" | "failed";

export type AdditionalAiInsightTransitionFindingRef = {
  artifactId: string;
  artifactIdentityHash: string;
  findingId: string;
  evidenceRefs: string[];
};

export type AdditionalAiInsightTransitionOutcome = {
  transition: "new";
  current: AdditionalAiInsightTransitionFindingRef;
} | {
  transition: "changed" | "still-supported";
  previous: AdditionalAiInsightTransitionFindingRef;
  current: AdditionalAiInsightTransitionFindingRef;
} | {
  transition: "resolved";
  previous: AdditionalAiInsightTransitionFindingRef;
} | {
  transition: "no-material-change";
};

export type AdditionalAiInsightTransitionArtifactAudit = {
  artifactId: string;
  artifactIdentityHash: string;
  resultHash: string;
  findingEvidence: Record<string, string[]>;
  evidenceRefs: string[];
};

export type AdditionalAiInsightTransitionRecord = {
  contractRevision: "energyiq-additional-insight-transition-v1";
  transitionId: string;
  idempotencyKey: string;
  requestedBy: string;
  status: "completed";
  previousTarget: AdditionalAiInsightEvaluationTarget;
  currentTarget: AdditionalAiInsightEvaluationTarget;
  previousArtifact: AdditionalAiInsightTransitionArtifactAudit;
  currentArtifact: AdditionalAiInsightTransitionArtifactAudit;
  generationProviderRunId: string;
  generationProviderSessionId: string;
  comparisonProviderRunId: string;
  comparisonProviderSessionId: string;
  outcomes: AdditionalAiInsightTransitionOutcome[];
  createdAt: string;
  completedAt: string;
};

export type AdditionalAiInsightFailedTransitionRecord = {
  contractRevision: "energyiq-additional-insight-transition-v1";
  transitionId: string;
  idempotencyKey: string;
  requestedBy: string;
  status: "failed";
  previousTarget: AdditionalAiInsightEvaluationTarget;
  currentTarget: AdditionalAiInsightEvaluationTarget;
  previousArtifact: AdditionalAiInsightTransitionArtifactAudit;
  generationProviderRunId: string;
  generationProviderSessionId: string;
  comparisonProviderRunId: string;
  comparisonProviderSessionId: string;
  errorCode: string;
  failureStage: "generation" | "validation" | "comparison";
  createdAt: string;
  completedAt: string;
};

export type AdditionalAiInsightRunningTransitionRecord = {
  contractRevision: "energyiq-additional-insight-transition-v1";
  transitionId: string;
  idempotencyKey: string;
  requestedBy: string;
  status: "running";
  previousTarget: AdditionalAiInsightEvaluationTarget;
  currentTarget: AdditionalAiInsightEvaluationTarget;
  previousArtifact: AdditionalAiInsightTransitionArtifactAudit;
  generationProviderRunId: string;
  generationProviderSessionId: string;
  comparisonProviderRunId: string;
  comparisonProviderSessionId: string;
  createdAt: string;
};

export type AdditionalAiInsightTransitionEvaluationRecord =
  | AdditionalAiInsightTransitionRecord
  | AdditionalAiInsightFailedTransitionRecord
  | AdditionalAiInsightRunningTransitionRecord;

export const evaluateAdditionalAiInsightPassAt3 = (
  batch: AdditionalAiInsightEvaluationBatch,
): AdditionalAiInsightPassAt3Result => {
  if (!evaluationBatchIsValid(batch, false)) return "failed";
  const completed = batch.attempts.filter(isCompletedAttempt);
  const reviewable = completed.filter(({ machineGate }) => machineGate.status === "passed");
  if (batch.attempts.some(({ status }) => status === "running")) return "pending-human-review";
  if (reviewable.length < 2) return "failed";
  if (reviewable.some(({ humanReview }) => !humanReview)) return "pending-human-review";
  const passing = reviewable.filter(({ humanReview }) => (
    additionalAiInsightHumanReviewIsPassing(humanReview!)
  )).length;
  return passing >= 2 ? "passed" : "failed";
};

const evaluationBatchIsValid = (
  value: unknown,
  validateLifecycleStatus: boolean,
): value is AdditionalAiInsightEvaluationBatch => {
  if (!isRecord(value)
    || value.contractRevision !== "energyiq-additional-insight-evaluation-v1"
    || !nonEmptyString(value.evaluationId)
    || !nonEmptyString(value.idempotencyKey)
    || !nonEmptyString(value.requestedBy)
    || !EVALUATION_STATUSES.has(value.status as string)
    || !evaluationTargetIsValid(value.target)
    || !Array.isArray(value.attempts)
    || value.attempts.length !== 3
    || !Array.isArray(value.reviewAudit)
    || !reviewPackIsValid(value.reviewPack)
    || !nonEmptyString(value.createdAt)
    || !nonEmptyString(value.updatedAt)) return false;

  const attempts = value.attempts;
  if (!attempts.every(evaluationAttemptIsValid)
    || !sameNumbers(attempts.map(({ ordinal }) => ordinal), [1, 2, 3])
    || !unique(attempts.map(({ attemptId }) => attemptId))) return false;
  const completed = attempts.filter(isCompletedAttempt);
  const reviewable = completed.filter(({ machineGate }) => machineGate.status === "passed");
  const legacyV4TerminalReview = isLegacyV4TerminalEvaluation(value.status, value.target);
  const blindReviewAttempts = legacyV4TerminalReview ? completed : reviewable;
  if (!unique(attempts.map(({ providerRunId }) => providerRunId))
    || !unique(attempts.map(({ providerSessionId }) => providerSessionId))
    || !unique(attempts.map(({ artifact }) => artifact.artifactId))
    || !unique(attempts.map(({ artifact }) => artifact.artifactIdentityHash))) return false;

  const reviewAudit = value.reviewAudit;
  if (!reviewAudit.every((entry) => isRecord(entry)
    && onlyKeys(entry, ["reviewToken", "attemptId"])
    && nonEmptyString(entry.reviewToken)
    && nonEmptyString(entry.attemptId))
    || !unique(reviewAudit.map(({ reviewToken }) => reviewToken))
    || !unique(reviewAudit.map(({ attemptId }) => attemptId))) return false;
  const entries = value.reviewPack.entries;
  const pendingFinalization = value.status === "running" && reviewAudit.length === 0 && entries.length === 0;
  if (!pendingFinalization
    && (!sameStrings(reviewAudit.map(({ reviewToken }) => reviewToken), entries.map(({ reviewToken }) => reviewToken))
      || !sameStrings(reviewAudit.map(({ attemptId }) => attemptId), blindReviewAttempts.map(({ attemptId }) => attemptId)))) return false;

  if (value.approval !== undefined) {
    if (!approvalIsValid(value.approval)
      || !completed.some(({ attemptId, humanReview, machineGate }) => (
        attemptId === value.approval.selectedAttemptId
        && machineGate.status === "passed"
        && humanReview !== undefined
        && additionalAiInsightHumanReviewIsPassing(humanReview)
      ))) return false;
  }
  if (value.publication !== undefined) {
    if (!publicationIsValid(value.publication)
      || value.approval === undefined
      || value.publication.sourceAttemptId !== value.approval.selectedAttemptId
      || value.publication.artifactIdentityHash !== value.target.artifactIdentityHash) return false;
  }
  for (const attempt of completed) {
    if (!attempt.humanReview) continue;
    const mapping = reviewAudit.find(({ attemptId }) => attemptId === attempt.attemptId);
    const entry = mapping ? entries.find(({ reviewToken }) => reviewToken === mapping.reviewToken) : undefined;
    if (!entry || !contentUsefulnessMatchesEntry(attempt.humanReview.contentUsefulness, entry)) return false;
  }
  if (!validateLifecycleStatus) return true;
  const hasRunning = attempts.some(({ status }) => status === "running");
  const allBlindReviewAttemptsReviewed = blindReviewAttempts.every(({ humanReview }) => humanReview !== undefined);
  const passingCompleted = reviewable.filter(({ humanReview }) => (
    humanReview !== undefined
      && additionalAiInsightHumanReviewIsPassing(humanReview)
  )).length;
  if (value.status === "running") {
    return value.approval === undefined
      && value.publication === undefined
      && entries.length === 0
      && reviewAudit.length === 0
      && completed.every(({ humanReview }) => humanReview === undefined);
  }
  if (hasRunning || value.status === "awaiting-human-review") {
    return !hasRunning
      && value.status === "awaiting-human-review"
      && value.approval === undefined
      && value.publication === undefined
      && blindReviewAttempts.length > 0
      && !allBlindReviewAttemptsReviewed;
  }
  if (value.status === "failed") {
    return value.approval === undefined
      && value.publication === undefined
      && (blindReviewAttempts.length === 0 || (allBlindReviewAttemptsReviewed && passingCompleted < 2));
  }
  if (value.status === "passed") {
    return value.approval === undefined
      && value.publication === undefined
      && allBlindReviewAttemptsReviewed
      && passingCompleted >= 2;
  }
  return value.status === "approved-candidate"
    && value.approval !== undefined
    && allBlindReviewAttemptsReviewed
    && passingCompleted >= 2;
};

const isLegacyV4TerminalEvaluation = (
  status: unknown,
  target: AdditionalAiInsightEvaluationTarget,
): boolean => (
  (status === "failed" || status === "passed" || status === "approved-candidate")
  && target.artifactIdentityRevision === "additional-insights-v4"
  && target.workflowRevision === "additional-insights-discover-accept-publish-v4"
  && target.promptRevision === "additional-insights-discovery-v4"
);

export const additionalAiInsightEvaluationBatchIsValid = (
  value: unknown,
): value is AdditionalAiInsightEvaluationBatch => evaluationBatchIsValid(value, true);

export const additionalAiInsightTransitionIsValid = (
  value: unknown,
): value is AdditionalAiInsightTransitionRecord => {
  if (!isRecord(value)
    || value.contractRevision !== "energyiq-additional-insight-transition-v1"
    || value.status !== "completed"
    || !nonEmptyString(value.transitionId)
    || !nonEmptyString(value.idempotencyKey)
    || !nonEmptyString(value.requestedBy)
    || !evaluationTargetIsValid(value.previousTarget)
    || !evaluationTargetIsValid(value.currentTarget)
    || !additionalAiInsightEvaluationTargetsCanTransition(value.previousTarget, value.currentTarget)
    || !transitionArtifactIsValid(value.previousArtifact)
    || !transitionArtifactIsValid(value.currentArtifact)
    || !nonEmptyString(value.generationProviderRunId)
    || !nonEmptyString(value.generationProviderSessionId)
    || !nonEmptyString(value.comparisonProviderRunId)
    || !nonEmptyString(value.comparisonProviderSessionId)
    || value.generationProviderRunId === value.comparisonProviderRunId
    || value.generationProviderSessionId === value.comparisonProviderSessionId
    || !Array.isArray(value.outcomes)
    || value.outcomes.length === 0
    || !nonEmptyString(value.createdAt)
    || !nonEmptyString(value.completedAt)) return false;
  if (value.outcomes.some((outcome) => !transitionOutcomeIsValid(
    outcome,
    value.previousArtifact,
    value.currentArtifact,
  ))) return false;
  const previousFindingIds = value.outcomes.flatMap((outcome) => isRecord(outcome)
      && isRecord(outcome.previous)
      && nonEmptyString(outcome.previous.findingId)
    ? [outcome.previous.findingId]
    : []);
  const currentFindingIds = value.outcomes.flatMap((outcome) => isRecord(outcome)
      && isRecord(outcome.current)
      && nonEmptyString(outcome.current.findingId)
    ? [outcome.current.findingId]
    : []);
  if (!unique(previousFindingIds) || !unique(currentFindingIds)) return false;
  const canonical = value.outcomes.map((outcome) => JSON.stringify(outcome));
  return new Set(canonical).size === canonical.length
    && (value.outcomes.some(({ transition }) => transition === "no-material-change")
      ? value.outcomes.length === 1
      : true);
};

export const additionalAiInsightTransitionRecordIsValid = (
  value: unknown,
): value is AdditionalAiInsightTransitionEvaluationRecord => {
  if (additionalAiInsightTransitionIsValid(value)) return true;
  if (isRecord(value)
    && value.contractRevision === "energyiq-additional-insight-transition-v1"
    && value.status === "running"
    && nonEmptyString(value.transitionId)
    && nonEmptyString(value.idempotencyKey)
    && nonEmptyString(value.requestedBy)
    && evaluationTargetIsValid(value.previousTarget)
    && evaluationTargetIsValid(value.currentTarget)
    && additionalAiInsightEvaluationTargetsCanTransition(value.previousTarget, value.currentTarget)
    && transitionArtifactIsValid(value.previousArtifact)
    && nonEmptyString(value.generationProviderRunId)
    && nonEmptyString(value.generationProviderSessionId)
    && nonEmptyString(value.comparisonProviderRunId)
    && nonEmptyString(value.comparisonProviderSessionId)
    && value.generationProviderRunId !== value.comparisonProviderRunId
    && value.generationProviderSessionId !== value.comparisonProviderSessionId
    && nonEmptyString(value.createdAt)) return true;
  return isRecord(value)
    && value.contractRevision === "energyiq-additional-insight-transition-v1"
    && value.status === "failed"
    && nonEmptyString(value.transitionId)
    && nonEmptyString(value.idempotencyKey)
    && nonEmptyString(value.requestedBy)
    && evaluationTargetIsValid(value.previousTarget)
    && evaluationTargetIsValid(value.currentTarget)
    && additionalAiInsightEvaluationTargetsCanTransition(value.previousTarget, value.currentTarget)
    && transitionArtifactIsValid(value.previousArtifact)
    && nonEmptyString(value.generationProviderRunId)
    && nonEmptyString(value.generationProviderSessionId)
    && nonEmptyString(value.comparisonProviderRunId)
    && nonEmptyString(value.comparisonProviderSessionId)
    && value.generationProviderRunId !== value.comparisonProviderRunId
    && value.generationProviderSessionId !== value.comparisonProviderSessionId
    && nonEmptyString(value.errorCode)
    && (value.failureStage === "generation"
      || value.failureStage === "validation"
      || value.failureStage === "comparison")
    && nonEmptyString(value.createdAt)
    && nonEmptyString(value.completedAt);
};

const evaluationAttemptIsValid = (
  value: unknown,
): value is AdditionalAiInsightEvaluationAttempt
  | AdditionalAiInsightEvaluationFailedAttempt
  | AdditionalAiInsightEvaluationRunningAttempt => {
  if (!isRecord(value)
    || !nonEmptyString(value.attemptId)
    || !positiveInteger(value.ordinal)
    || !nonEmptyString(value.providerRunId)
    || !nonEmptyString(value.providerSessionId)
    || !artifactIdentityIsValid(value.artifact)
    || !nonEmptyString(value.startedAt)
  ) return false;
  if (value.status === "running") return value.completedAt === undefined;
  if (!nonEmptyString(value.completedAt)) return false;
  if (value.status === "failed") return nonEmptyString(value.errorCode)
    && (value.failureStage === "provider" || value.failureStage === "structured-output" || value.failureStage === "machine-gate");
  if (value.status !== "completed"
    || !artifactAuditIsValid(value.artifact)
    || !statisticsAreValid(value.statistics)
    || !uniqueNonEmptyStrings(value.evidenceRefs)
    || !uniqueNonEmptyStrings(value.methodResourceIds)
    || value.methodResourceIds.length === 0
    || !uniqueNonEmptyStrings(value.toolAuditIds)
    || !machineGateIsValid(value.machineGate)) return false;
  const artifact = value.artifact;
  if (artifact.resultStatus === "available" && value.evidenceRefs.length === 0) return false;
  if (value.humanReview !== undefined && !humanReviewIsValid(value.humanReview)) return false;
  return true;
};

const artifactIdentityIsValid = (value: unknown): value is AdditionalAiInsightEvaluationArtifactIdentity => (
  isRecord(value)
  && nonEmptyString(value.artifactId)
  && hashIsValid(value.artifactIdentityHash)
  && value.artifactIdentityRevision === "additional-insight-evaluation-artifact-v1"
);

const artifactAuditIsValid = (value: unknown): value is AdditionalAiInsightEvaluationAttempt["artifact"] => (
  isRecord(value)
  && artifactIdentityIsValid(value)
  && hashIsValid((value as Record<string, unknown>).resultHash)
  && ((value as Record<string, unknown>).resultStatus === "available"
    || (value as Record<string, unknown>).resultStatus === "empty")
);

const statisticsAreValid = (value: unknown): boolean => isRecord(value)
  && nonNegativeInteger(value.discoveredCount)
  && nonNegativeInteger(value.acceptedCount)
  && nonNegativeInteger(value.rejectedCount)
  && nonNegativeInteger(value.publishedCount)
  && value.discoveredCount === (value.acceptedCount as number) + (value.rejectedCount as number)
  && (value.publishedCount as number) <= (value.acceptedCount as number)
  && (value.publishedCount as number) <= 3;

const machineGateIsValid = (value: unknown): boolean => {
  if (!isRecord(value)
    || (value.status !== "passed" && value.status !== "failed")
    || !Array.isArray(value.checks)
    || value.checks.length !== ADDITIONAL_AI_INSIGHT_EVALUATION_MACHINE_CHECKS.length) return false;
  const checks = value.checks;
  if (!checks.every((entry) => isRecord(entry)
    && typeof entry.passed === "boolean"
    && typeof entry.check === "string"
    && ADDITIONAL_AI_INSIGHT_EVALUATION_MACHINE_CHECKS.includes(entry.check as AdditionalAiInsightEvaluationMachineCheck)
    && (entry.code === undefined || nonEmptyString(entry.code)))) return false;
  if (!sameStrings(checks.map(({ check }) => check as string), [...ADDITIONAL_AI_INSIGHT_EVALUATION_MACHINE_CHECKS])) return false;
  return value.status === (checks.every(({ passed }) => passed) ? "passed" : "failed");
};

const humanReviewIsValid = (value: unknown): value is AdditionalAiInsightEvaluationHumanReview => (
  isRecord(value)
  && nonEmptyString(value.actorId)
  && nonEmptyString(value.reviewedAt)
  && positiveInteger(value.revision)
  && humanScoresAreValid(value.scores)
  && contentUsefulnessIsValid(value.contentUsefulness)
  && value.passed === additionalAiInsightHumanReviewIsPassing(value as AdditionalAiInsightEvaluationHumanReview)
);

export const additionalAiInsightHumanReviewIsPassing = (
  value: AdditionalAiInsightEvaluationHumanReview,
): boolean => Object.values(value.scores).every((score) => score >= 3)
  && (!value.contentUsefulness.summary.applicable || value.contentUsefulness.summary.score >= 3)
  && value.contentUsefulness.insights.every(({ score }) => score >= 3);

const humanScoresAreValid = (value: unknown): value is AdditionalAiInsightHumanScores => isRecord(value)
  && onlyKeys(value, ["newAngle", "relevance", "clarity", "worthExploring", "epistemicHonesty", "userValue"])
  && Object.values(value).every((score) => Number.isSafeInteger(score) && (score as number) >= 1 && (score as number) <= 5);

const reviewPackIsValid = (value: unknown): value is AdditionalAiInsightEvaluationBatch["reviewPack"] => isRecord(value)
  && onlyKeys(value, ["revision", "entries"])
  && value.revision === "additional-insight-blind-review-v1"
  && Array.isArray(value.entries)
  && value.entries.length <= 3
  && value.entries.every((entry, index) => isRecord(entry)
    && onlyKeys(entry, ["label", "reviewToken", "summary", "findings"])
    && entry.label === (["Review A", "Review B", "Review C"] as const)[index]
    && nonEmptyString(entry.reviewToken)
    && (entry.summary === undefined || (isRecord(entry.summary)
      && onlyKeys(entry.summary, ["reviewSummaryToken", "text"])
      && nonEmptyString(entry.summary.reviewSummaryToken)
      && nonEmptyString(entry.summary.text)))
    && Array.isArray(entry.findings)
    && entry.findings.length <= 3
    && entry.findings.every((finding) => isRecord(finding)
      && onlyKeys(finding, [
        "reviewFindingToken", "title", "text", "epistemicStatus", "evidenceRefs",
        "originKind", "directionMethodResourceIds", "alert",
      ])
      && nonEmptyString(finding.reviewFindingToken)
      && nonEmptyString(finding.title)
      && nonEmptyString(finding.text)
      && (finding.epistemicStatus === "observed"
        || finding.epistemicStatus === "inferred"
        || finding.epistemicStatus === "speculative")
      && uniqueNonEmptyStrings(finding.evidenceRefs)
      && finding.evidenceRefs.length > 0
      && (finding.originKind === "ai-discovery" || finding.originKind === "expert-sop" || finding.originKind === "hybrid")
      && uniqueNonEmptyStrings(finding.directionMethodResourceIds)
      && (finding.alert === undefined || (isRecord(finding.alert)
        && onlyKeys(finding.alert, ["severity", "certainty"])
        && (finding.alert.severity === "attention" || finding.alert.severity === "urgent")
        && (finding.alert.certainty === "confirmed"
          || finding.alert.certainty === "anomaly"
          || finding.alert.certainty === "possible")))))
  && unique(value.entries.map(({ reviewToken }) => reviewToken))
  && unique((value.entries as AdditionalAiInsightBlindedReviewEntry[])
    .flatMap(({ summary }) => summary ? [summary.reviewSummaryToken] : []))
  && unique((value.entries as AdditionalAiInsightBlindedReviewEntry[])
    .flatMap(({ findings }) => findings.map(({ reviewFindingToken }) => reviewFindingToken)));

const contentUsefulnessIsValid = (
  value: unknown,
): value is AdditionalAiInsightEvaluationHumanReview["contentUsefulness"] => {
  if (!isRecord(value)
    || !isRecord(value.summary)
    || !Array.isArray(value.insights)
    || !value.insights.every((entry) => isRecord(entry)
      && onlyKeys(entry, ["reviewFindingToken", "score"])
      && nonEmptyString(entry.reviewFindingToken)
      && scoreIsValid(entry.score))
    || !unique(value.insights.map(({ reviewFindingToken }) => reviewFindingToken))) return false;
  return value.summary.applicable === false
    ? onlyKeys(value.summary, ["applicable"])
    : value.summary.applicable === true
      && onlyKeys(value.summary, ["applicable", "score"])
      && scoreIsValid(value.summary.score);
};

const contentUsefulnessMatchesEntry = (
  value: AdditionalAiInsightEvaluationHumanReview["contentUsefulness"],
  entry: AdditionalAiInsightBlindedReviewEntry,
): boolean => (entry.summary === undefined ? value.summary.applicable === false : value.summary.applicable === true)
  && sameStrings(
    value.insights.map(({ reviewFindingToken }) => reviewFindingToken),
    entry.findings.map(({ reviewFindingToken }) => reviewFindingToken),
  );

const approvalIsValid = (value: unknown): value is AdditionalAiInsightEvaluationApproval => isRecord(value)
  && nonEmptyString(value.selectedAttemptId)
  && nonEmptyString(value.actorId)
  && nonEmptyString(value.approvedAt)
  && positiveInteger(value.revision)
  && value.disposition === "publication-candidate-only";

const publicationIsValid = (value: unknown): value is AdditionalAiInsightEvaluationPublication => isRecord(value)
  && onlyKeys(value, [
    "sourceAttemptId", "artifactId", "artifactIdentityHash", "actorId", "publishedAt", "revision",
  ])
  && nonEmptyString(value.sourceAttemptId)
  && nonEmptyString(value.artifactId)
  && hashIsValid(value.artifactIdentityHash)
  && nonEmptyString(value.actorId)
  && nonEmptyString(value.publishedAt)
  && positiveInteger(value.revision);

const evaluationTargetIsValid = (value: unknown): value is AdditionalAiInsightEvaluationTarget => isRecord(value)
  && onlyKeys(value, [
    "workspaceId", "projectId", "scopeId", "resource", "dataSnapshotId", "projectReleaseId", "analysisPeriod",
    "modelProfileId", "modelProfileRevision", "artifactIdentityRevision", "artifactIdentityHash", "outputContractRevision",
    "validatorRevision", "workflowRevision", "promptRevision", "capabilityRevision", "publicationRevision", "canvasRevision",
    "methodSetId", "methodSetRevision", "methodSetFingerprint",
  ])
  && nonEmptyString(value.workspaceId)
  && nonEmptyString(value.projectId)
  && nonEmptyString(value.scopeId)
  && value.resource === "electricity"
  && nonEmptyString(value.dataSnapshotId)
  && nonEmptyString(value.projectReleaseId)
  && isRecord(value.analysisPeriod)
  && onlyKeys(value.analysisPeriod, ["from", "to"])
  && nonEmptyString(value.analysisPeriod.from)
  && nonEmptyString(value.analysisPeriod.to)
  && value.analysisPeriod.from !== value.analysisPeriod.to
  && nonEmptyString(value.modelProfileId)
  && positiveInteger(value.modelProfileRevision)
  && nonEmptyString(value.artifactIdentityRevision)
  && hashIsValid(value.artifactIdentityHash)
  && nonEmptyString(value.outputContractRevision)
  && nonEmptyString(value.validatorRevision)
  && nonEmptyString(value.workflowRevision)
  && nonEmptyString(value.promptRevision)
  && nonEmptyString(value.capabilityRevision)
  && nonEmptyString(value.publicationRevision)
  && nonEmptyString(value.canvasRevision)
  && nonEmptyString(value.methodSetId)
  && nonEmptyString(value.methodSetRevision)
  && hashIsValid(value.methodSetFingerprint);

export const additionalAiInsightEvaluationTargetsCanTransition = (
  previous: AdditionalAiInsightEvaluationTarget,
  current: AdditionalAiInsightEvaluationTarget,
): boolean => previous.workspaceId === current.workspaceId
  && previous.projectId === current.projectId
  && previous.scopeId === current.scopeId
  && previous.resource === current.resource
  && previous.modelProfileId === current.modelProfileId
  && previous.modelProfileRevision === current.modelProfileRevision
  && previous.artifactIdentityRevision === current.artifactIdentityRevision
  && previous.outputContractRevision === current.outputContractRevision
  && previous.validatorRevision === current.validatorRevision
  && previous.workflowRevision === current.workflowRevision
  && previous.promptRevision === current.promptRevision
  && previous.capabilityRevision === current.capabilityRevision
  && previous.publicationRevision === current.publicationRevision
  && previous.canvasRevision === current.canvasRevision
  && previous.methodSetId === current.methodSetId
  && previous.methodSetRevision === current.methodSetRevision
  && previous.methodSetFingerprint === current.methodSetFingerprint
  && previous.dataSnapshotId !== current.dataSnapshotId
  && previous.artifactIdentityHash !== current.artifactIdentityHash;

const transitionArtifactIsValid = (value: unknown): value is AdditionalAiInsightTransitionArtifactAudit => {
  if (!isRecord(value)
    || !nonEmptyString(value.artifactId)
    || !hashIsValid(value.artifactIdentityHash)
    || !hashIsValid(value.resultHash)
    || !isRecord(value.findingEvidence)
    || !uniqueNonEmptyStrings(value.evidenceRefs)) return false;
  const allEvidence = new Set(value.evidenceRefs);
  return Object.entries(value.findingEvidence).every(([findingId, refs]) => nonEmptyString(findingId)
    && uniqueNonEmptyStrings(refs)
    && refs.length > 0
    && refs.every((ref) => allEvidence.has(ref)));
};

const transitionOutcomeIsValid = (
  value: unknown,
  previousArtifact: AdditionalAiInsightTransitionArtifactAudit,
  currentArtifact: AdditionalAiInsightTransitionArtifactAudit,
): boolean => {
  if (!isRecord(value) || typeof value.transition !== "string") return false;
  if (value.transition === "no-material-change") return onlyKeys(value, ["transition"]);
  if (value.transition === "new") {
    return onlyKeys(value, ["transition", "current"])
      && transitionFindingRefIsValid(value.current, currentArtifact);
  }
  if (value.transition === "changed" || value.transition === "still-supported") {
    return onlyKeys(value, ["transition", "previous", "current"])
      && transitionFindingRefIsValid(value.previous, previousArtifact)
      && transitionFindingRefIsValid(value.current, currentArtifact);
  }
  if (value.transition === "resolved") {
    return onlyKeys(value, ["transition", "previous"])
      && transitionFindingRefIsValid(value.previous, previousArtifact);
  }
  return false;
};

const transitionFindingRefIsValid = (
  value: unknown,
  artifact: AdditionalAiInsightTransitionArtifactAudit,
): value is AdditionalAiInsightTransitionFindingRef => isRecord(value)
  && onlyKeys(value, ["artifactId", "artifactIdentityHash", "findingId", "evidenceRefs"])
  && value.artifactId === artifact.artifactId
  && value.artifactIdentityHash === artifact.artifactIdentityHash
  && nonEmptyString(value.findingId)
  && uniqueNonEmptyStrings(value.evidenceRefs)
  && value.evidenceRefs.length > 0
  && sameStrings(value.evidenceRefs, artifact.findingEvidence[value.findingId] ?? []);

const isCompletedAttempt = (
  value: AdditionalAiInsightEvaluationAttempt | AdditionalAiInsightEvaluationFailedAttempt | AdditionalAiInsightEvaluationRunningAttempt,
): value is AdditionalAiInsightEvaluationAttempt => value.status === "completed";

const EVALUATION_STATUSES = new Set(["running", "awaiting-human-review", "failed", "passed", "approved-candidate"]);
const HASH = /^sha256:[0-9a-f]{64}$/u;
const hashIsValid = (value: unknown): value is string => typeof value === "string" && HASH.test(value);
const nonEmptyString = (value: unknown): value is string => typeof value === "string" && /\S/u.test(value);
const positiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const nonNegativeInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const scoreIsValid = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 5;
const uniqueNonEmptyStrings = (value: unknown): value is string[] => Array.isArray(value)
  && value.every(nonEmptyString)
  && unique(value);
const unique = (value: readonly unknown[]): boolean => new Set(value).size === value.length;
const sameStrings = (left: readonly string[], right: readonly string[]): boolean => left.length === right.length
  && left.every((entry) => right.includes(entry));
const sameNumbers = (left: readonly number[], right: readonly number[]): boolean => left.length === right.length
  && left.every((entry) => right.includes(entry));
const isRecord = (value: unknown): value is Record<string, any> => typeof value === "object"
  && value !== null
  && !Array.isArray(value);
const onlyKeys = (value: Record<string, unknown>, allowed: readonly string[]): boolean => {
  const keys = new Set(allowed);
  return Object.keys(value).every((key) => keys.has(key));
};
