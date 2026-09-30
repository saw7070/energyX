import { describe, expect, it } from "vitest";

import {
  ADDITIONAL_AI_INSIGHT_EVALUATION_MACHINE_CHECKS,
  additionalAiInsightEvaluationBatchIsValid,
  additionalAiInsightTransitionIsValid,
  evaluateAdditionalAiInsightPassAt3,
  type AdditionalAiInsightEvaluationAttempt,
  type AdditionalAiInsightEvaluationBatch,
  type AdditionalAiInsightTransitionRecord,
} from "./energyiq-additional-ai-insight-evaluation.js";

describe("Additional AI Insight pass@3 evaluation contract", () => {
  it("requires three independent attempts and keeps machine and human gates distinct", () => {
    const batch = validBatch();
    expect(additionalAiInsightEvaluationBatchIsValid(batch)).toBe(true);
    expect(evaluateAdditionalAiInsightPassAt3(batch)).toBe("passed");

    const oneOfThree = validBatch();
    completedAttempt(oneOfThree, 1).humanReview!.scores.userValue = 2;
    completedAttempt(oneOfThree, 1).humanReview!.passed = false;
    completedAttempt(oneOfThree, 2).humanReview!.scores.userValue = 2;
    completedAttempt(oneOfThree, 2).humanReview!.passed = false;
    oneOfThree.status = "failed";
    expect(evaluateAdditionalAiInsightPassAt3(oneOfThree)).toBe("failed");

    const zeroOfThree = validBatch();
    zeroOfThree.attempts.forEach((_attempt, index) => {
      completedAttempt(zeroOfThree, index).humanReview!.scores.userValue = 1;
      completedAttempt(zeroOfThree, index).humanReview!.passed = false;
    });
    zeroOfThree.status = "failed";
    expect(evaluateAdditionalAiInsightPassAt3(zeroOfThree)).toBe("failed");

    const pending = validBatch();
    delete completedAttempt(pending, 2).humanReview;
    pending.status = "awaiting-human-review";
    expect(evaluateAdditionalAiInsightPassAt3(pending)).toBe("pending-human-review");

    const machineOnly = validBatch();
    machineOnly.attempts.forEach((_attempt, index) => { delete completedAttempt(machineOnly, index).humanReview; });
    machineOnly.status = "awaiting-human-review";
    expect(evaluateAdditionalAiInsightPassAt3(machineOnly)).toBe("pending-human-review");

    const twoOfThreeAfterTransientFailure = validBatch();
    twoOfThreeAfterTransientFailure.attempts[2] = {
      attemptId: "attempt-3",
      ordinal: 3,
      status: "failed",
      providerRunId: "provider-run-3",
      providerSessionId: "provider-session-3",
      artifact: reservedArtifactIdentity(3),
      errorCode: "TRANSIENT_PROVIDER_FAILURE",
      failureStage: "provider",
      startedAt: "2026-08-14T00:00:00.000Z",
      completedAt: "2026-08-14T00:01:00.000Z",
    };
    twoOfThreeAfterTransientFailure.reviewAudit = twoOfThreeAfterTransientFailure.reviewAudit
      .filter(({ attemptId }) => attemptId !== "attempt-3");
    twoOfThreeAfterTransientFailure.reviewPack.entries = twoOfThreeAfterTransientFailure.reviewPack.entries
      .filter(({ reviewToken }) => reviewToken !== "blind-c")
      .map((entry, index) => ({ ...entry, label: (["Review A", "Review B"] as const)[index]! }));
    twoOfThreeAfterTransientFailure.status = "passed";
    expect(additionalAiInsightEvaluationBatchIsValid(twoOfThreeAfterTransientFailure)).toBe(true);
    expect(evaluateAdditionalAiInsightPassAt3(twoOfThreeAfterTransientFailure)).toBe("passed");
  });

  it("rejects reused attempt, Provider run/session, artifact, or incomplete audit identities", () => {
    for (const mutate of [
      (batch: AdditionalAiInsightEvaluationBatch) => { batch.attempts[1]!.attemptId = batch.attempts[0]!.attemptId; },
      (batch: AdditionalAiInsightEvaluationBatch) => { batch.attempts[1]!.providerRunId = batch.attempts[0]!.providerRunId; },
      (batch: AdditionalAiInsightEvaluationBatch) => { batch.attempts[1]!.providerSessionId = batch.attempts[0]!.providerSessionId; },
      (batch: AdditionalAiInsightEvaluationBatch) => { completedAttempt(batch, 1).artifact.artifactId = completedAttempt(batch, 0).artifact.artifactId; },
      (batch: AdditionalAiInsightEvaluationBatch) => { completedAttempt(batch, 1).artifact.resultHash = "bad"; },
      (batch: AdditionalAiInsightEvaluationBatch) => { completedAttempt(batch, 1).statistics.acceptedCount = 4; },
      (batch: AdditionalAiInsightEvaluationBatch) => { completedAttempt(batch, 1).evidenceRefs = []; },
      (batch: AdditionalAiInsightEvaluationBatch) => { completedAttempt(batch, 1).methodResourceIds = []; },
    ]) {
      const batch = validBatch();
      mutate(batch);
      expect(additionalAiInsightEvaluationBatchIsValid(batch)).toBe(false);
    }

    const falsePass = validBatch();
    delete completedAttempt(falsePass, 0).humanReview;
    expect(additionalAiInsightEvaluationBatchIsValid(falsePass)).toBe(false);
  });

  it("locks the machine gate to contract and provenance checks without fixed lenses", () => {
    expect(ADDITIONAL_AI_INSIGHT_EVALUATION_MACHINE_CHECKS).toEqual([
      "contract-boundary",
      "fact-boundary",
      "provenance",
      "duplicate",
      "expression-length",
      "restore-completeness",
    ]);
    expect(ADDITIONAL_AI_INSIGHT_EVALUATION_MACHINE_CHECKS.join(" ")).not.toMatch(/what|why|how|lens/i);

    const drift = validBatch();
    completedAttempt(drift, 0).machineGate.checks.pop();
    expect(additionalAiInsightEvaluationBatchIsValid(drift)).toBe(false);
  });

  it("requires a blind pack that hides run order while retaining a private exact mapping", () => {
    const batch = validBatch();
    expect(batch.reviewPack.entries.map((entry) => entry.label)).toEqual(["Review A", "Review B", "Review C"]);
    expect(batch.reviewPack.entries.map((entry) => entry.reviewToken)).not.toEqual([
      "attempt-1", "attempt-2", "attempt-3",
    ]);
    expect(batch.reviewPack.entries).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ attemptId: expect.anything() }),
    ]));
    expect(new Set(batch.reviewAudit.map((entry) => entry.attemptId))).toEqual(new Set([
      "attempt-1", "attempt-2", "attempt-3",
    ]));
    expect(additionalAiInsightEvaluationBatchIsValid(batch)).toBe(true);

    const leaked = validBatch();
    Object.assign(leaked.reviewPack.entries[0]!, { providerRunId: "provider-run-1" });
    expect(additionalAiInsightEvaluationBatchIsValid(leaked)).toBe(false);

    const malformedFinding = validBatch();
    Object.assign(malformedFinding.reviewPack.entries[0]!.findings[0]!, {
      providerSessionId: "provider-session-1",
    });
    expect(additionalAiInsightEvaluationBatchIsValid(malformedFinding)).toBe(false);
  });

  it("keeps terminal v4 blind packs readable when the historical review included a machine-failed attempt", () => {
    const historical = validBatch();
    historical.target.artifactIdentityRevision = "additional-insights-v4";
    historical.target.workflowRevision = "additional-insights-discover-accept-publish-v4";
    historical.target.promptRevision = "additional-insights-discovery-v4";
    completedAttempt(historical, 0).machineGate = {
      status: "failed",
      checks: ADDITIONAL_AI_INSIGHT_EVALUATION_MACHINE_CHECKS.map((check, index) => index === 0
        ? { check, passed: false, code: "CONTRACT_FAILED" }
        : { check, passed: true }),
    };

    expect(additionalAiInsightEvaluationBatchIsValid(historical)).toBe(true);
    expect(evaluateAdditionalAiInsightPassAt3(historical)).toBe("passed");

    const current = structuredClone(historical);
    current.target.artifactIdentityRevision = "additional-insights-v5";
    current.target.workflowRevision = "additional-insights-discover-accept-publish-v5";
    current.target.promptRevision = "additional-insights-discovery-v5";
    expect(additionalAiInsightEvaluationBatchIsValid(current)).toBe(false);
  });

  it("requires Summary and every blinded Insight usefulness to pass without averaging", () => {
    const batch = validBatch();
    const entry = batch.reviewPack.entries.find(({ reviewToken }) => reviewToken === "blind-a")!;
    entry.summary = { reviewSummaryToken: "blind-summary-a", text: "A low-value limitation-only Summary." };
    const attempt = completedAttempt(batch, 0);
    attempt.humanReview!.contentUsefulness = {
      summary: { applicable: true, score: 2 },
      insights: [{ reviewFindingToken: "blind-finding-1", score: 5 }],
    };
    attempt.humanReview!.passed = false;
    expect(additionalAiInsightEvaluationBatchIsValid(batch)).toBe(true);
    expect(evaluateAdditionalAiInsightPassAt3(batch)).toBe("passed");

    const lowSingleInsight = validBatch();
    completedAttempt(lowSingleInsight, 0).humanReview!.contentUsefulness.insights[0]!.score = 2;
    completedAttempt(lowSingleInsight, 0).humanReview!.passed = false;
    expect(additionalAiInsightEvaluationBatchIsValid(lowSingleInsight)).toBe(true);

    const onlyOneContentPassing = validBatch();
    for (const index of [0, 1]) {
      completedAttempt(onlyOneContentPassing, index).humanReview!.contentUsefulness.insights[0]!.score = 1;
      completedAttempt(onlyOneContentPassing, index).humanReview!.passed = false;
    }
    onlyOneContentPassing.status = "failed";
    expect(evaluateAdditionalAiInsightPassAt3(onlyOneContentPassing)).toBe("failed");
  });

  it("requires independent Artifact identities to be reserved for running and failed attempts", () => {
    const batch = validBatch();
    batch.status = "running";
    batch.reviewPack.entries = [];
    batch.reviewAudit = [];
    delete completedAttempt(batch, 0).humanReview;
    batch.attempts[1] = {
      attemptId: "attempt-2",
      ordinal: 2,
      status: "running",
      providerRunId: "provider-run-2",
      providerSessionId: "provider-session-2",
      artifact: reservedArtifactIdentity(2),
      startedAt: "2026-08-14T00:00:00.000Z",
    } as unknown as AdditionalAiInsightEvaluationBatch["attempts"][number];
    batch.attempts[2] = {
      attemptId: "attempt-3",
      ordinal: 3,
      status: "failed",
      providerRunId: "provider-run-3",
      providerSessionId: "provider-session-3",
      artifact: reservedArtifactIdentity(3),
      errorCode: "TRANSIENT_PROVIDER_FAILURE",
      failureStage: "provider",
      startedAt: "2026-08-14T00:00:00.000Z",
      completedAt: "2026-08-14T00:01:00.000Z",
    } as unknown as AdditionalAiInsightEvaluationBatch["attempts"][number];
    expect(additionalAiInsightEvaluationBatchIsValid(batch)).toBe(true);

    Object.assign(batch.attempts[2]!.artifact!, reservedArtifactIdentity(2));
    expect(additionalAiInsightEvaluationBatchIsValid(batch)).toBe(false);
  });
});

describe("Additional AI Insight Snapshot A-to-B contract", () => {
  it("accepts evidence-bound New, Changed, Still supported, Resolved, and honest No material change", () => {
    for (const transition of ["new", "changed", "still-supported", "resolved"] as const) {
      expect(additionalAiInsightTransitionIsValid(validTransition(transition))).toBe(true);
    }
    expect(additionalAiInsightTransitionIsValid(validNoMaterialChange())).toBe(true);
  });

  it("allows Snapshot-bound stable fact IDs while rejecting identity drift, forged lineage, and text-only pairings", () => {
    const releaseDrift = validTransition("changed");
    releaseDrift.currentTarget.workspaceId = "workspace-other";
    expect(additionalAiInsightTransitionIsValid(releaseDrift)).toBe(false);

    const methodDrift = validTransition("changed");
    methodDrift.currentTarget.methodSetFingerprint = `sha256:${"f".repeat(64)}`;
    expect(additionalAiInsightTransitionIsValid(methodDrift)).toBe(false);

    const workflowDrift = validTransition("changed");
    workflowDrift.currentTarget.workflowRevision = "different-workflow";
    expect(additionalAiInsightTransitionIsValid(workflowDrift)).toBe(false);

    const stableFactId = validTransition("still-supported");
    expect(pairedOutcome(stableFactId).previous.evidenceRefs).toEqual(["analysis.summary.usage_kwh"]);
    expect(pairedOutcome(stableFactId).current.evidenceRefs).toEqual(["analysis.summary.usage_kwh"]);
    expect(additionalAiInsightTransitionIsValid(stableFactId)).toBe(true);

    const forged = validTransition("still-supported");
    pairedOutcome(forged).current!.evidenceRefs = ["evidence:b:forged"];
    expect(additionalAiInsightTransitionIsValid(forged)).toBe(false);

    const resolved = validTransition("resolved");
    expect(resolved.outcomes[0]).not.toHaveProperty("current");
    expect(additionalAiInsightTransitionIsValid(resolved)).toBe(true);

    const contradictory = validTransition("changed");
    contradictory.outcomes.push({
      transition: "new",
      current: structuredClone(pairedOutcome(contradictory).current),
    });
    expect(additionalAiInsightTransitionIsValid(contradictory)).toBe(false);
  });
});

const TARGET_BASE = {
  workspaceId: "workspace-1",
  projectId: "project-1",
  scopeId: "scope-1",
  resource: "electricity" as const,
  dataSnapshotId: "snapshot-a",
  projectReleaseId: "release-a",
  analysisPeriod: { from: "2026-05-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" },
  modelProfileId: "workspace-default",
  modelProfileRevision: 7,
  artifactIdentityRevision: "additional-insights-v3",
  artifactIdentityHash: `sha256:${"a".repeat(64)}`,
  outputContractRevision: "energyiq-additional-ai-insights-v2",
  validatorRevision: "additional-insights-acceptance-v3",
  workflowRevision: "additional-insights-discover-accept-publish-v3",
  promptRevision: "additional-insights-discovery-v3",
  capabilityRevision: "scoped-read-only-v1",
  publicationRevision: "additional-insights-v2",
  canvasRevision: "energyiq-insight-canvas-v2",
  methodSetId: "preschool-additional-insights-current",
  methodSetRevision: "v1",
  methodSetFingerprint: `sha256:${"b".repeat(64)}`,
};

const validBatch = (): AdditionalAiInsightEvaluationBatch => ({
  contractRevision: "energyiq-additional-insight-evaluation-v1",
  evaluationId: "evaluation-1",
  idempotencyKey: "idempotency-1",
  requestedBy: "admin-1",
  status: "passed",
  target: structuredClone(TARGET_BASE),
  attempts: [1, 2, 3].map((ordinal) => ({
    attemptId: `attempt-${ordinal}`,
    ordinal,
    status: "completed" as const,
    providerRunId: `provider-run-${ordinal}`,
    providerSessionId: `provider-session-${ordinal}`,
    artifact: {
      ...reservedArtifactIdentity(ordinal),
      resultHash: `sha256:${String(ordinal + 3).repeat(64)}`,
      resultStatus: "available" as const,
    },
    statistics: {
      discoveredCount: 4,
      acceptedCount: 3,
      rejectedCount: 1,
      publishedCount: 3,
    },
    evidenceRefs: [`evidence:a:${ordinal}`],
    methodResourceIds: ["builtin:energyiq-open-discovery"],
    toolAuditIds: [],
    machineGate: {
      status: "passed" as const,
      checks: ADDITIONAL_AI_INSIGHT_EVALUATION_MACHINE_CHECKS.map((check) => ({ check, passed: true })),
    },
    humanReview: {
      actorId: "reviewer-1",
      reviewedAt: "2026-08-14T01:00:00.000Z",
      scores: {
        newAngle: 4,
        relevance: 4,
        clarity: 4,
        worthExploring: 4,
        epistemicHonesty: 4,
        userValue: 4,
      },
      contentUsefulness: {
        summary: { applicable: false },
        insights: [{ reviewFindingToken: `blind-finding-${ordinal}`, score: 4 }],
      },
      passed: true,
      revision: 1,
    },
    startedAt: "2026-08-14T00:00:00.000Z",
    completedAt: "2026-08-14T00:01:00.000Z",
  })),
  reviewPack: {
    revision: "additional-insight-blind-review-v1",
    entries: [
      { label: "Review A", reviewToken: "blind-c", findings: [{ reviewFindingToken: "blind-finding-3", title: "C", text: "C", epistemicStatus: "observed", evidenceRefs: ["evidence:a:3"], originKind: "ai-discovery", directionMethodResourceIds: [] }] },
      { label: "Review B", reviewToken: "blind-a", findings: [{ reviewFindingToken: "blind-finding-1", title: "A", text: "A", epistemicStatus: "inferred", evidenceRefs: ["evidence:a:1"], originKind: "ai-discovery", directionMethodResourceIds: [] }] },
      { label: "Review C", reviewToken: "blind-b", findings: [{ reviewFindingToken: "blind-finding-2", title: "B", text: "B", epistemicStatus: "speculative", evidenceRefs: ["evidence:a:2"], originKind: "ai-discovery", directionMethodResourceIds: [] }] },
    ],
  },
  reviewAudit: [
    { reviewToken: "blind-a", attemptId: "attempt-1" },
    { reviewToken: "blind-b", attemptId: "attempt-2" },
    { reviewToken: "blind-c", attemptId: "attempt-3" },
  ],
  createdAt: "2026-08-14T00:00:00.000Z",
  updatedAt: "2026-08-14T01:00:00.000Z",
});

const validTransition = (
  transition: "new" | "changed" | "still-supported" | "resolved",
): AdditionalAiInsightTransitionRecord => {
  const previous = {
    artifactId: "artifact-a",
    artifactIdentityHash: `sha256:${"c".repeat(64)}`,
    findingId: "finding-a",
    evidenceRefs: ["analysis.summary.usage_kwh"],
  };
  const current = {
    artifactId: "artifact-b",
    artifactIdentityHash: `sha256:${"d".repeat(64)}`,
    findingId: "finding-b",
    evidenceRefs: ["analysis.summary.usage_kwh"],
  };
  const outcome = transition === "new"
    ? { transition, current }
    : transition === "resolved"
      ? { transition, previous }
      : { transition, previous, current };
  return {
    contractRevision: "energyiq-additional-insight-transition-v1",
    transitionId: "transition-1",
    idempotencyKey: "transition-key-1",
    requestedBy: "admin-1",
    status: "completed",
    previousTarget: {
      ...structuredClone(TARGET_BASE),
    },
    currentTarget: {
      ...structuredClone(TARGET_BASE),
      dataSnapshotId: "snapshot-b",
      projectReleaseId: "release-b",
      artifactIdentityHash: `sha256:${"e".repeat(64)}`,
    },
    previousArtifact: {
      artifactId: "artifact-a",
      artifactIdentityHash: previous.artifactIdentityHash,
      resultHash: `sha256:${"1".repeat(64)}`,
      findingEvidence: { "finding-a": ["analysis.summary.usage_kwh"] },
      evidenceRefs: ["analysis.summary.usage_kwh"],
    },
    currentArtifact: {
      artifactId: "artifact-b",
      artifactIdentityHash: current.artifactIdentityHash,
      resultHash: `sha256:${"2".repeat(64)}`,
      findingEvidence: { "finding-b": ["analysis.summary.usage_kwh"] },
      evidenceRefs: ["analysis.summary.usage_kwh"],
    },
    generationProviderRunId: "transition-generation-run",
    generationProviderSessionId: "transition-generation-session",
    comparisonProviderRunId: "transition-comparison-run",
    comparisonProviderSessionId: "transition-comparison-session",
    outcomes: [outcome],
    createdAt: "2026-08-14T02:00:00.000Z",
    completedAt: "2026-08-14T02:01:00.000Z",
  };
};

const validNoMaterialChange = (): AdditionalAiInsightTransitionRecord => {
  const value = validTransition("changed");
  value.outcomes = [{ transition: "no-material-change" }];
  return value;
};

const completedAttempt = (
  batch: AdditionalAiInsightEvaluationBatch,
  index: number,
): AdditionalAiInsightEvaluationAttempt => {
  const attempt = batch.attempts[index];
  if (!attempt || attempt.status !== "completed") throw new Error("test fixture expected completed attempt");
  return attempt;
};

const reservedArtifactIdentity = (ordinal: number) => ({
  artifactId: `evaluation-artifact-${ordinal}`,
  artifactIdentityHash: `sha256:${String(ordinal).repeat(64)}`,
  artifactIdentityRevision: "additional-insight-evaluation-artifact-v1" as const,
});

const pairedOutcome = (
  record: AdditionalAiInsightTransitionRecord,
): Extract<AdditionalAiInsightTransitionRecord["outcomes"][number], { transition: "changed" | "still-supported" }> => {
  const outcome = record.outcomes[0];
  if (!outcome || (outcome.transition !== "changed" && outcome.transition !== "still-supported")) {
    throw new Error("test fixture expected paired outcome");
  }
  return outcome;
};
