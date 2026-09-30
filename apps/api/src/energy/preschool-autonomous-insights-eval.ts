export type PreschoolAutonomousInsightEvalIdentity = {
  workspaceId: string;
  projectId: string;
  scopeId: string;
  snapshotId: string;
  releaseId: string;
  period: {
    from: string;
    to: string;
    timezone: string;
  };
  modelProfile: {
    id: string;
    revision: number;
  };
  methodSetDigest: string;
  projectOverlayRevision: string;
  canvasRevision: string;
};

export type PreschoolAutonomousInsightOriginTrace = {
  kind: "ai-discovery" | "expert-sop" | "hybrid";
  coreMethodRevisionKey: string;
  directionMethodRevisionKeys: string[];
};

export type PreschoolAutonomousInsightAlert = {
  trigger: "energy-spike";
  faultType: "water-leak" | "electrical-leak" | "short-circuit" | "other";
  claimStrength: "possible-anomaly" | "qualified-check-required" | "confirmed-fault";
  evidenceRefs: string[];
};

export type PreschoolAutonomousInsightSafetyEvidence = {
  id: string;
  kind:
    | "water-leak-confirmation"
    | "electrical-leak-confirmation"
    | "short-circuit-confirmation"
    | "other-qualified-safety-evidence";
};

export type PreschoolAutonomousInsightEvalAttempt = {
  attemptId: string;
  runId: string;
  artifact: {
    id: string;
    source: "fresh-eval" | "production-reuse";
  };
  binding: PreschoolAutonomousInsightEvalIdentity;
  lineage: {
    investigator: {
      runId: string;
      parentRunId: string;
    };
    editor: {
      runId: string;
      parentRunId: string;
    };
  };
  methodTrace: {
    origin: PreschoolAutonomousInsightOriginTrace;
    approvedMethodRevisionKeys: string[];
    loadedMethodRevisionKeys: string[];
    loadedMethodSetDigest: string;
  };
  gates: {
    facts: { passed: boolean; detail: string };
    safety: { passed: boolean; detail: string };
  };
  alerts: PreschoolAutonomousInsightAlert[];
  safetyEvidence: PreschoolAutonomousInsightSafetyEvidence[];
  incrementalValue: {
    rating: "none" | "some" | "substantial";
    comparedWith: "deterministic-overview";
    rationale: string;
  };
  visualDecision: {
    needed: boolean;
    appropriate: boolean;
    rationale: string;
  };
  blindReview: {
    reviewerId: string;
    blinded: boolean;
    score: 1 | 2 | 3 | 4 | 5;
    rationale: string;
  };
};

export type PreschoolAutonomousInsightsPassAt3AttemptReport = {
  attemptId: string;
  runId: string;
  humanAccepted: boolean;
  exactIdentity: boolean;
  uniqueExecutionIds: boolean;
  freshEvalArtifact: boolean;
  lineageValid: boolean;
  methodTraceValid: boolean;
  factGatePassed: boolean;
  safetyGatePassed: boolean;
  alertGatePassed: boolean;
  evaluationRecordComplete: boolean;
  hardGatesPassed: boolean;
};

export type PreschoolAutonomousInsightsPassAt3Report = {
  status: "passed" | "failed";
  passAt3: boolean;
  humanAcceptedCount: number;
  allHardGatesPassed: boolean;
  attempts: PreschoolAutonomousInsightsPassAt3AttemptReport[];
};

export type PreschoolAutonomousInsightsPassAt3Input = {
  expected: PreschoolAutonomousInsightEvalIdentity;
  productionArtifactIds: string[];
  attempts: PreschoolAutonomousInsightEvalAttempt[];
};

const nonEmpty = (value: string): boolean => /\S/.test(value);

const exactEvalIdentity = (
  actual: PreschoolAutonomousInsightEvalIdentity,
  expected: PreschoolAutonomousInsightEvalIdentity,
): boolean => actual.workspaceId === expected.workspaceId
  && actual.projectId === expected.projectId
  && actual.scopeId === expected.scopeId
  && actual.snapshotId === expected.snapshotId
  && actual.releaseId === expected.releaseId
  && actual.period.from === expected.period.from
  && actual.period.to === expected.period.to
  && actual.period.timezone === expected.period.timezone
  && actual.modelProfile.id === expected.modelProfile.id
  && actual.modelProfile.revision === expected.modelProfile.revision
  && actual.methodSetDigest === expected.methodSetDigest
  && actual.projectOverlayRevision === expected.projectOverlayRevision
  && actual.canvasRevision === expected.canvasRevision;

const count = (values: readonly string[], expected: string): number => (
  values.filter((value) => value === expected).length
);

const uniqueExecutionIds = (
  attempt: PreschoolAutonomousInsightEvalAttempt,
  attempts: readonly PreschoolAutonomousInsightEvalAttempt[],
): boolean => {
  const attemptIds = attempts.map((candidate) => candidate.attemptId);
  const artifactIds = attempts.map((candidate) => candidate.artifact.id);
  const allRunIds = attempts.flatMap((candidate) => [
    candidate.runId,
    candidate.lineage.investigator.runId,
    candidate.lineage.editor.runId,
  ]);
  const localRunIds = [
    attempt.runId,
    attempt.lineage.investigator.runId,
    attempt.lineage.editor.runId,
  ];
  return count(attemptIds, attempt.attemptId) === 1
    && count(artifactIds, attempt.artifact.id) === 1
    && localRunIds.every((runId) => count(allRunIds, runId) === 1)
    && new Set(localRunIds).size === localRunIds.length;
};

const lineageValid = (attempt: PreschoolAutonomousInsightEvalAttempt): boolean => (
  nonEmpty(attempt.lineage.investigator.runId)
  && nonEmpty(attempt.lineage.editor.runId)
  && attempt.lineage.investigator.parentRunId === attempt.runId
  && attempt.lineage.editor.parentRunId === attempt.lineage.investigator.runId
);

const uniqueNonEmpty = (values: readonly string[]): boolean => (
  values.every(nonEmpty) && new Set(values).size === values.length
);

const methodTraceValid = (
  attempt: PreschoolAutonomousInsightEvalAttempt,
  expected: PreschoolAutonomousInsightEvalIdentity,
): boolean => {
  const { origin, approvedMethodRevisionKeys, loadedMethodRevisionKeys, loadedMethodSetDigest } = attempt.methodTrace;
  const referencedMethods = [origin.coreMethodRevisionKey, ...origin.directionMethodRevisionKeys];
  const originShapeValid = origin.kind === "ai-discovery"
    ? origin.directionMethodRevisionKeys.length === 0
    : origin.directionMethodRevisionKeys.length > 0;
  return originShapeValid
    && uniqueNonEmpty(approvedMethodRevisionKeys)
    && uniqueNonEmpty(loadedMethodRevisionKeys)
    && uniqueNonEmpty(referencedMethods)
    && referencedMethods.every((method) => loadedMethodRevisionKeys.includes(method))
    && loadedMethodRevisionKeys.every((method) => approvedMethodRevisionKeys.includes(method))
    && loadedMethodSetDigest === expected.methodSetDigest;
};

const requiredSafetyEvidenceKind = (
  faultType: PreschoolAutonomousInsightAlert["faultType"],
): PreschoolAutonomousInsightSafetyEvidence["kind"] | null => {
  if (faultType === "water-leak") return "water-leak-confirmation";
  if (faultType === "electrical-leak") return "electrical-leak-confirmation";
  if (faultType === "short-circuit") return "short-circuit-confirmation";
  return null;
};

const alertGatePassed = (attempt: PreschoolAutonomousInsightEvalAttempt): boolean => (
  attempt.alerts.every((alert) => {
    if (alert.claimStrength !== "confirmed-fault") {
      return true;
    }
    const requiredKind = requiredSafetyEvidenceKind(alert.faultType);
    if (!requiredKind) {
      return true;
    }
    return alert.evidenceRefs.some((evidenceRef) => attempt.safetyEvidence.some((evidence) => (
      evidence.id === evidenceRef && evidence.kind === requiredKind
    )));
  })
);

const evaluationRecordComplete = (attempt: PreschoolAutonomousInsightEvalAttempt): boolean => (
  nonEmpty(attempt.gates.facts.detail)
  && nonEmpty(attempt.gates.safety.detail)
  && nonEmpty(attempt.incrementalValue.rationale)
  && nonEmpty(attempt.visualDecision.rationale)
  && nonEmpty(attempt.blindReview.reviewerId)
  && nonEmpty(attempt.blindReview.rationale)
  && attempt.blindReview.blinded
);

export const evaluatePreschoolAutonomousInsightsPassAt3 = (
  input: PreschoolAutonomousInsightsPassAt3Input,
): PreschoolAutonomousInsightsPassAt3Report => {
  if (input.attempts.length !== 3) {
    throw new Error("PRESCHOOL_AUTONOMOUS_INSIGHTS_PASS_AT_3_REQUIRES_THREE_ATTEMPTS");
  }
  const productionArtifactIds = new Set(input.productionArtifactIds);
  const attempts = input.attempts.map((attempt) => {
    const exactIdentity = exactEvalIdentity(attempt.binding, input.expected);
    const executionIdsAreUnique = uniqueExecutionIds(attempt, input.attempts);
    const freshEvalArtifact = attempt.artifact.source === "fresh-eval"
      && !productionArtifactIds.has(attempt.artifact.id);
    const validLineage = lineageValid(attempt);
    const validMethodTrace = methodTraceValid(attempt, input.expected);
    const factGatePassed = attempt.gates.facts.passed;
    const safetyGatePassed = attempt.gates.safety.passed;
    const alertsPassed = alertGatePassed(attempt);
    const recordComplete = evaluationRecordComplete(attempt);
    const hardGatesPassed = exactIdentity
      && executionIdsAreUnique
      && freshEvalArtifact
      && validLineage
      && validMethodTrace
      && factGatePassed
      && safetyGatePassed
      && alertsPassed
      && recordComplete;
    return {
      attemptId: attempt.attemptId,
      runId: attempt.runId,
      humanAccepted: recordComplete && attempt.blindReview.score >= 4,
      exactIdentity,
      uniqueExecutionIds: executionIdsAreUnique,
      freshEvalArtifact,
      lineageValid: validLineage,
      methodTraceValid: validMethodTrace,
      factGatePassed,
      safetyGatePassed,
      alertGatePassed: alertsPassed,
      evaluationRecordComplete: recordComplete,
      hardGatesPassed,
    };
  });
  const humanAcceptedCount = attempts.filter((attempt) => attempt.humanAccepted).length;
  const allHardGatesPassed = attempts.every((attempt) => attempt.hardGatesPassed);
  const passAt3 = humanAcceptedCount >= 2 && allHardGatesPassed;
  return {
    status: passAt3 ? "passed" : "failed",
    passAt3,
    humanAcceptedCount,
    allHardGatesPassed,
    attempts,
  };
};

export type PreschoolAutonomousInsightSnapshotFinding = {
  stableKey: string;
  snapshotId: string;
  contentDigest: string;
  epistemicStatus: "observed" | "inferred" | "speculative";
  strength: 0 | 1 | 2;
  numericEvidence: Array<{
    metricId: string;
    value: number;
    unit: string;
    snapshotId: string;
  }>;
};

export type PreschoolAutonomousInsightSnapshotTransition =
  | "persisted-updated"
  | "weakened"
  | "disappeared/resolved"
  | "new"
  | "epistemic-downgraded"
  | "unchanged-exact-restore"
  | "B-failed-no-carry-forward";

export type PreschoolAutonomousInsightSnapshotTransitionInput = {
  identityA: PreschoolAutonomousInsightEvalIdentity;
  identityB: PreschoolAutonomousInsightEvalIdentity;
  bStatus: "available" | "failed";
  aFinding: PreschoolAutonomousInsightSnapshotFinding | null;
  bFinding: PreschoolAutonomousInsightSnapshotFinding | null;
};

const assertFindingSnapshot = (
  finding: PreschoolAutonomousInsightSnapshotFinding,
  snapshotId: string,
  side: "A" | "B",
): void => {
  if (finding.snapshotId !== snapshotId
    || finding.numericEvidence.some((evidence) => evidence.snapshotId !== snapshotId)) {
    if (side === "B") {
      throw new Error("PRESCHOOL_AUTONOMOUS_INSIGHTS_B_CURRENT_NUMBERS_SNAPSHOT_MISMATCH");
    }
    throw new Error("PRESCHOOL_AUTONOMOUS_INSIGHTS_A_SNAPSHOT_MISMATCH");
  }
};

const epistemicRank: Record<PreschoolAutonomousInsightSnapshotFinding["epistemicStatus"], number> = {
  observed: 3,
  inferred: 2,
  speculative: 1,
};

const canonicalNumericEvidence = (
  finding: PreschoolAutonomousInsightSnapshotFinding,
): string => JSON.stringify(finding.numericEvidence
  .map(({ metricId, value, unit }) => ({ metricId, value, unit }))
  .sort((left, right) => left.metricId.localeCompare(right.metricId)));

const sameSnapshotComparisonBaseline = (
  identityA: PreschoolAutonomousInsightEvalIdentity,
  identityB: PreschoolAutonomousInsightEvalIdentity,
): boolean => identityA.workspaceId === identityB.workspaceId
  && identityA.projectId === identityB.projectId
  && identityA.scopeId === identityB.scopeId
  && identityA.releaseId === identityB.releaseId
  && identityA.period.timezone === identityB.period.timezone
  && identityA.modelProfile.id === identityB.modelProfile.id
  && identityA.modelProfile.revision === identityB.modelProfile.revision
  && identityA.methodSetDigest === identityB.methodSetDigest
  && identityA.projectOverlayRevision === identityB.projectOverlayRevision
  && identityA.canvasRevision === identityB.canvasRevision;

export const classifyPreschoolAutonomousInsightSnapshotTransition = (
  input: PreschoolAutonomousInsightSnapshotTransitionInput,
): PreschoolAutonomousInsightSnapshotTransition => {
  if (!sameSnapshotComparisonBaseline(input.identityA, input.identityB)) {
    throw new Error("PRESCHOOL_AUTONOMOUS_INSIGHTS_A_B_IDENTITY_MISMATCH");
  }
  if (input.aFinding) {
    assertFindingSnapshot(input.aFinding, input.identityA.snapshotId, "A");
  }

  if (input.bStatus === "failed") {
    if (input.bFinding) {
      throw new Error("PRESCHOOL_AUTONOMOUS_INSIGHTS_B_FAILED_CARRY_FORWARD_FORBIDDEN");
    }
    return "B-failed-no-carry-forward";
  }

  if (input.bFinding) {
    assertFindingSnapshot(input.bFinding, input.identityB.snapshotId, "B");
  }
  if (!input.aFinding && input.bFinding) {
    return "new";
  }
  if (input.aFinding && !input.bFinding) {
    return "disappeared/resolved";
  }
  if (!input.aFinding || !input.bFinding) {
    throw new Error("PRESCHOOL_AUTONOMOUS_INSIGHTS_TRANSITION_HAS_NO_FINDING");
  }
  if (input.aFinding.stableKey !== input.bFinding.stableKey) {
    throw new Error("PRESCHOOL_AUTONOMOUS_INSIGHTS_TRANSITION_STABLE_KEY_MISMATCH");
  }
  if (epistemicRank[input.bFinding.epistemicStatus] < epistemicRank[input.aFinding.epistemicStatus]) {
    return "epistemic-downgraded";
  }
  if (input.bFinding.strength < input.aFinding.strength) {
    return "weakened";
  }
  if (input.bFinding.contentDigest === input.aFinding.contentDigest
    && canonicalNumericEvidence(input.bFinding) === canonicalNumericEvidence(input.aFinding)) {
    return "unchanged-exact-restore";
  }
  return "persisted-updated";
};
