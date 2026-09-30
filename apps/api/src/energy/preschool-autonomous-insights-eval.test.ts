import { describe, expect, it } from "vitest";

import {
  classifyPreschoolAutonomousInsightSnapshotTransition,
  evaluatePreschoolAutonomousInsightsPassAt3,
  type PreschoolAutonomousInsightEvalAttempt,
  type PreschoolAutonomousInsightEvalIdentity,
  type PreschoolAutonomousInsightSnapshotFinding,
} from "./preschool-autonomous-insights-eval.js";

const IDENTITY: PreschoolAutonomousInsightEvalIdentity = {
  workspaceId: "workspace-singapore-preschool",
  projectId: "preschool-demo",
  scopeId: "preschool-project",
  snapshotId: "snapshot-b",
  releaseId: "release-2026-08",
  period: {
    from: "2026-05-01T00:00:00.000+08:00",
    to: "2026-06-01T00:00:00.000+08:00",
    timezone: "Asia/Singapore",
  },
  modelProfile: {
    id: "deepseek-overview",
    revision: 9,
  },
  methodSetDigest: "sha256:method-set-fixed",
  projectOverlayRevision: "project-overlay-v3",
  canvasRevision: "production-insight-canvas-v1",
};

const attempt = (
  index: number,
  blindScore: 1 | 2 | 3 | 4 | 5 = 4,
): PreschoolAutonomousInsightEvalAttempt => ({
  attemptId: `eval-attempt-${index}`,
  runId: `eval-run-${index}`,
  artifact: {
    id: `eval-artifact-${index}`,
    source: "fresh-eval",
  },
  binding: IDENTITY,
  lineage: {
    investigator: {
      runId: `investigator-run-${index}`,
      parentRunId: `eval-run-${index}`,
    },
    editor: {
      runId: `editor-run-${index}`,
      parentRunId: `investigator-run-${index}`,
    },
  },
  methodTrace: {
    origin: {
      kind: "hybrid",
      coreMethodRevisionKey: "energy-insight-investigation@1.0.0#7:aaa",
      directionMethodRevisionKeys: ["closed-hours-sop@2.1.0#12:bbb"],
    },
    approvedMethodRevisionKeys: [
      "energy-insight-investigation@1.0.0#7:aaa",
      "closed-hours-sop@2.1.0#12:bbb",
    ],
    loadedMethodRevisionKeys: [
      "energy-insight-investigation@1.0.0#7:aaa",
      "closed-hours-sop@2.1.0#12:bbb",
    ],
    loadedMethodSetDigest: IDENTITY.methodSetDigest,
  },
  gates: {
    facts: { passed: true, detail: "All numeric claims are bound to Snapshot B Evidence." },
    safety: { passed: true, detail: "No unsupported confirmed safety fault." },
  },
  alerts: [{
    trigger: "energy-spike",
    faultType: "short-circuit",
    claimStrength: "possible-anomaly",
    evidenceRefs: [],
  }],
  safetyEvidence: [],
  incrementalValue: {
    rating: "substantial",
    comparedWith: "deterministic-overview",
    rationale: "Adds a bounded event-shape hypothesis not present in the fixed summary.",
  },
  visualDecision: {
    needed: true,
    appropriate: true,
    rationale: "A small overnight event timeline would make the pattern easier to verify.",
  },
  blindReview: {
    reviewerId: `blind-reviewer-${index}`,
    blinded: true,
    score: blindScore,
    rationale: "Useful enough to prompt deeper analysis.",
  },
});

const evaluate = (attempts: PreschoolAutonomousInsightEvalAttempt[]) => (
  evaluatePreschoolAutonomousInsightsPassAt3({
    expected: IDENTITY,
    productionArtifactIds: ["production-artifact-current"],
    attempts,
  })
);

describe("Preschool autonomous insights pass@3", () => {
  it("passes with three independent Eval runs, complete lineage and at least two blind scores of four or higher", () => {
    const report = evaluate([attempt(1, 4), attempt(2, 5), attempt(3, 3)]);

    expect(report).toMatchObject({
      status: "passed",
      passAt3: true,
      humanAcceptedCount: 2,
      allHardGatesPassed: true,
      attempts: [
        { attemptId: "eval-attempt-1", humanAccepted: true, hardGatesPassed: true },
        { attemptId: "eval-attempt-2", humanAccepted: true, hardGatesPassed: true },
        { attemptId: "eval-attempt-3", humanAccepted: false, hardGatesPassed: true },
      ],
    });
  });

  it("fails closed when attempt/run IDs collide or a production Artifact is reused", () => {
    const duplicate = attempt(2);
    duplicate.attemptId = "eval-attempt-1";
    duplicate.runId = "eval-run-1";
    duplicate.artifact = {
      id: "production-artifact-current",
      source: "production-reuse",
    };

    const report = evaluate([attempt(1), duplicate, attempt(3)]);

    expect(report.status).toBe("failed");
    expect(report.allHardGatesPassed).toBe(false);
    expect(report.attempts[1]).toMatchObject({
      uniqueExecutionIds: false,
      freshEvalArtifact: false,
      hardGatesPassed: false,
    });
  });

  it("rejects run ID collisions across root, Investigator and Editor stages", () => {
    const crossStageCollision = attempt(2);
    crossStageCollision.runId = "investigator-run-1";
    crossStageCollision.lineage.investigator.parentRunId = crossStageCollision.runId;

    const report = evaluate([attempt(1), crossStageCollision, attempt(3)]);

    expect(report.status).toBe("failed");
    expect(report.attempts[0]?.uniqueExecutionIds).toBe(false);
    expect(report.attempts[1]?.uniqueExecutionIds).toBe(false);
  });

  it("checks every fixed identity field rather than accepting a matching Snapshot alone", () => {
    const mutations: PreschoolAutonomousInsightEvalIdentity[] = [
      { ...IDENTITY, workspaceId: "workspace-other" },
      { ...IDENTITY, projectId: "other-project" },
      { ...IDENTITY, scopeId: "other-scope" },
      { ...IDENTITY, snapshotId: "snapshot-other" },
      { ...IDENTITY, releaseId: "release-other" },
      { ...IDENTITY, period: { ...IDENTITY.period, to: "2026-06-02T00:00:00.000+08:00" } },
      { ...IDENTITY, modelProfile: { ...IDENTITY.modelProfile, revision: 10 } },
      { ...IDENTITY, methodSetDigest: "sha256:method-set-other" },
      { ...IDENTITY, projectOverlayRevision: "project-overlay-v4" },
      { ...IDENTITY, canvasRevision: "production-insight-canvas-v2" },
    ];

    for (const binding of mutations) {
      const drifted = attempt(2);
      drifted.binding = binding;
      const report = evaluate([attempt(1), drifted, attempt(3)]);
      expect(report.allHardGatesPassed).toBe(false);
      expect(report.attempts[1]?.exactIdentity).toBe(false);
    }
  });

  it("requires valid Investigator→Editor lineage, loaded trace, fact and safety gates on every attempt", () => {
    const invalid = attempt(2, 5);
    invalid.lineage.editor.parentRunId = "unrelated-run";
    invalid.methodTrace.loadedMethodSetDigest = "sha256:wrong-method-set";
    invalid.gates.facts.passed = false;
    invalid.gates.safety.passed = false;

    const report = evaluate([attempt(1, 5), invalid, attempt(3, 5)]);

    expect(report.humanAcceptedCount).toBe(3);
    expect(report.passAt3).toBe(false);
    expect(report.attempts[1]).toMatchObject({
      lineageValid: false,
      methodTraceValid: false,
      factGatePassed: false,
      safetyGatePassed: false,
      hardGatesPassed: false,
    });
  });

  it("does not turn an energy spike into a confirmed leak or short circuit without corresponding Safety Evidence", () => {
    const unsupported = attempt(2, 5);
    unsupported.alerts = [{
      trigger: "energy-spike",
      faultType: "short-circuit",
      claimStrength: "confirmed-fault",
      evidenceRefs: [],
    }];

    const unsupportedReport = evaluate([attempt(1, 5), unsupported, attempt(3, 5)]);
    expect(unsupportedReport.passAt3).toBe(false);
    expect(unsupportedReport.attempts[1]?.alertGatePassed).toBe(false);

    const evidenced = attempt(2, 5);
    evidenced.safetyEvidence = [{
      id: "safety-evidence:qualified-electrical-inspection",
      kind: "short-circuit-confirmation",
    }];
    evidenced.alerts = [{
      trigger: "energy-spike",
      faultType: "short-circuit",
      claimStrength: "confirmed-fault",
      evidenceRefs: ["safety-evidence:qualified-electrical-inspection"],
    }];

    expect(evaluate([attempt(1, 5), evidenced, attempt(3, 5)]).passAt3).toBe(true);
  });
});

const finding = (
  snapshotId: string,
  overrides: Partial<PreschoolAutonomousInsightSnapshotFinding> = {},
): PreschoolAutonomousInsightSnapshotFinding => ({
  stableKey: "closed-hours:event-shape",
  snapshotId,
  contentDigest: "sha256:finding-v1",
  epistemicStatus: "inferred",
  strength: 2,
  numericEvidence: [{
    metricId: "closed-hours-share",
    value: 12.45,
    unit: "%",
    snapshotId,
  }],
  ...overrides,
});

const IDENTITY_A: PreschoolAutonomousInsightEvalIdentity = {
  ...IDENTITY,
  snapshotId: "snapshot-a",
};

describe("Preschool autonomous insights Snapshot A→B classification", () => {
  it.each([
    {
      expected: "persisted-updated",
      aFinding: finding("snapshot-a"),
      bFinding: finding("snapshot-b", { contentDigest: "sha256:finding-v2" }),
      bStatus: "available" as const,
    },
    {
      expected: "weakened",
      aFinding: finding("snapshot-a"),
      bFinding: finding("snapshot-b", { strength: 1 }),
      bStatus: "available" as const,
    },
    {
      expected: "disappeared/resolved",
      aFinding: finding("snapshot-a"),
      bFinding: null,
      bStatus: "available" as const,
    },
    {
      expected: "new",
      aFinding: null,
      bFinding: finding("snapshot-b"),
      bStatus: "available" as const,
    },
    {
      expected: "epistemic-downgraded",
      aFinding: finding("snapshot-a", { epistemicStatus: "observed" }),
      bFinding: finding("snapshot-b", { epistemicStatus: "speculative" }),
      bStatus: "available" as const,
    },
    {
      expected: "unchanged-exact-restore",
      aFinding: finding("snapshot-a"),
      bFinding: finding("snapshot-b"),
      bStatus: "available" as const,
    },
    {
      expected: "B-failed-no-carry-forward",
      aFinding: finding("snapshot-a"),
      bFinding: null,
      bStatus: "failed" as const,
    },
  ])("classifies $expected", ({ expected, aFinding, bFinding, bStatus }) => {
    expect(classifyPreschoolAutonomousInsightSnapshotTransition({
      identityA: IDENTITY_A,
      identityB: IDENTITY,
      bStatus,
      aFinding,
      bFinding,
    })).toBe(expected);
  });

  it("rejects Snapshot A numeric Evidence inside a current Snapshot B finding", () => {
    expect(() => classifyPreschoolAutonomousInsightSnapshotTransition({
      identityA: IDENTITY_A,
      identityB: IDENTITY,
      bStatus: "available",
      aFinding: finding("snapshot-a"),
      bFinding: finding("snapshot-b", {
        numericEvidence: [{
          metricId: "closed-hours-share",
          value: 12.45,
          unit: "%",
          snapshotId: "snapshot-a",
        }],
      }),
    })).toThrow("PRESCHOOL_AUTONOMOUS_INSIGHTS_B_CURRENT_NUMBERS_SNAPSHOT_MISMATCH");
  });

  it("refuses to classify findings across a different Project or evaluation baseline", () => {
    expect(() => classifyPreschoolAutonomousInsightSnapshotTransition({
      identityA: IDENTITY_A,
      identityB: { ...IDENTITY, projectId: "other-project" },
      bStatus: "available",
      aFinding: finding("snapshot-a"),
      bFinding: finding("snapshot-b"),
    })).toThrow("PRESCHOOL_AUTONOMOUS_INSIGHTS_A_B_IDENTITY_MISMATCH");

    expect(() => classifyPreschoolAutonomousInsightSnapshotTransition({
      identityA: IDENTITY_A,
      identityB: {
        ...IDENTITY,
        modelProfile: { ...IDENTITY.modelProfile, revision: 10 },
      },
      bStatus: "available",
      aFinding: finding("snapshot-a"),
      bFinding: finding("snapshot-b"),
    })).toThrow("PRESCHOOL_AUTONOMOUS_INSIGHTS_A_B_IDENTITY_MISMATCH");
  });

  it("refuses to carry an A finding forward when Snapshot B evaluation failed", () => {
    expect(() => classifyPreschoolAutonomousInsightSnapshotTransition({
      identityA: IDENTITY_A,
      identityB: IDENTITY,
      bStatus: "failed",
      aFinding: finding("snapshot-a"),
      bFinding: finding("snapshot-a"),
    })).toThrow("PRESCHOOL_AUTONOMOUS_INSIGHTS_B_FAILED_CARRY_FORWARD_FORBIDDEN");
  });
});
