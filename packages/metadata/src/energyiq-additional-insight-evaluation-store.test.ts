import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import {
  ADDITIONAL_AI_INSIGHT_EVALUATION_MACHINE_CHECKS,
  ADDITIONAL_AI_INSIGHTS_SCOPED_READ_ONLY_TOOLS_V1,
  canonicalInsightMethodSetJson,
  resolveAdditionalAiInsightMethodSet,
  resolveCurrentAdditionalAiInsightMethodSet,
  type AdditionalAiInsightEvaluationTarget,
  type AdditionalAiInsightHumanScores,
  type AdditionalAiInsightMethodResource,
  type AdditionalAiInsightsArtifact,
  type AdditionalAiInsightsArtifactV1V2,
} from "@datafoundry/contracts";

import {
  ensureEnergyIqAdditionalInsightEvaluationHardeningSchema,
  initializeEnergyIqAdditionalInsightEvaluationSchema,
} from "./energyiq-additional-insight-evaluation-store.js";
import { createMetadataStore } from "./index.js";

describe("EnergyIqAdditionalInsightEvaluationStore", () => {
  it("records an idempotent publication audit only for the approved source attempt", () => {
    const harness = createHarness();
    try {
      reserveAndComplete(harness);
      reviewAllPassing(harness);
      const passed = harness.store.getEvaluation({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      });
      const selected = passed.attempts.find((attempt) => (
        attempt.status === "completed" && attempt.humanReview?.passed
      ))!;
      const reviewToken = passed.reviewAudit.find(({ attemptId }) => attemptId === selected.attemptId)!.reviewToken;
      harness.store.approveEvaluationCandidate({
        evaluationId: passed.evaluationId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        reviewToken,
        actorId: "admin-1",
        expectedRevision: 0,
      });

      expect(() => harness.store.recordApprovedCandidatePublication({
        evaluationId: passed.evaluationId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        sourceAttemptId: "attempt-other",
        artifactId: "overview-ai-artifact-current",
        artifactIdentityHash: passed.target.artifactIdentityHash,
        actorId: "admin-1",
        expectedRevision: 0,
      })).toThrow("ENERGYIQ_ADDITIONAL_EVALUATION_PUBLICATION_SOURCE_INVALID");

      expect(() => harness.store.recordApprovedCandidatePublication({
        evaluationId: passed.evaluationId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        sourceAttemptId: selected.attemptId,
        artifactId: "overview-ai-artifact-current",
        artifactIdentityHash: passed.target.artifactIdentityHash,
        actorId: "admin-1",
        expectedRevision: 0,
      })).toThrow("ENERGYIQ_ADDITIONAL_EVALUATION_PUBLICATION_ARTIFACT_INVALID");
    } finally {
      harness.close();
    }
  });

  it("lists only the requested Project evaluations and transitions for an admin workbench", () => {
    const harness = createHarness();
    try {
      reserveAndComplete(harness);
      reviewAllPassing(harness);
      const passed = harness.store.getEvaluation({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      });
      const selected = passed.attempts.find((attempt) => (
        attempt.status === "completed" && attempt.humanReview?.passed
      ))!;
      harness.store.approveEvaluationCandidate({
        evaluationId: passed.evaluationId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        reviewToken: passed.reviewAudit.find(({ attemptId }) => attemptId === selected.attemptId)!.reviewToken,
        actorId: "admin-1",
        expectedRevision: 0,
      });
      harness.store.reserveTransition({
        transitionId: "transition-1",
        idempotencyKey: "transition-1",
        requestedBy: "admin-1",
        previousEvaluationId: passed.evaluationId,
        previousAttemptId: selected.attemptId,
        currentTarget: evaluationTarget("snapshot-b", "release-b"),
        generationProviderRunId: "transition-generation",
        generationProviderSessionId: "transition-generation-session",
        comparisonProviderRunId: "transition-comparison",
        comparisonProviderSessionId: "transition-comparison-session",
      });

      expect(harness.store.listEvaluations({
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      })).toEqual([
        expect.objectContaining({ evaluationId: "evaluation-1", status: "approved-candidate" }),
      ]);
      expect(harness.store.listTransitions({
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      })).toEqual([
        expect.objectContaining({ transitionId: "transition-1", status: "running" }),
      ]);
      expect(harness.store.listEvaluations({
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-other",
      })).toEqual([]);
    } finally {
      harness.close();
    }
  });

  it("keeps a historical v7 running evaluation readable but never leases its attempts", () => {
    const harness = createHarness();
    try {
      const target = evaluationTarget("snapshot-v7", "release-v7");
      const evaluationId = "evaluation-historical-v7-running";
      harness.store.reserveEvaluation({
        evaluationId,
        idempotencyKey: evaluationId,
        requestedBy: "admin-1",
        target,
        attempts: attemptReservations("-v7"),
      });
      rewriteEvaluationTargetForTest(harness, evaluationId, historicalV7Target(target));

      expect(harness.store.getEvaluation({
        evaluationId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      })).toMatchObject({
        status: "running",
        target: { artifactIdentityRevision: "additional-insights-v7" },
      });
      expect(() => harness.store.claimEvaluationAttempt({
        evaluationId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        attemptId: "attempt-1-v7",
      })).toThrow("ENERGYIQ_ADDITIONAL_EVALUATION_TARGET_BEHAVIOR_NOT_CURRENT");
    } finally {
      harness.close();
    }
  });

  it("keeps a terminal historical v7 evaluation readable but immutable", () => {
    const harness = createHarness();
    try {
      reserveAndComplete(harness);
      reviewAllPassing(harness);
      const current = harness.store.getEvaluation({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      });
      const historical = rewriteEvaluationTargetForTest(
        harness,
        current.evaluationId,
        historicalV7Target(current.target),
      );
      expect(historical).toMatchObject({
        status: "passed",
        target: { artifactIdentityRevision: "additional-insights-v7" },
      });
      expect(() => harness.store.approveEvaluationCandidate({
        evaluationId: historical.evaluationId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        reviewToken: historical.reviewPack.entries[0]!.reviewToken,
        actorId: "admin-1",
        expectedRevision: 0,
      })).toThrow("ENERGYIQ_ADDITIONAL_EVALUATION_TARGET_BEHAVIOR_NOT_CURRENT");
      expect(harness.store.getEvaluation({
        evaluationId: historical.evaluationId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      })).toEqual(historical);
    } finally {
      harness.close();
    }
  });

  it("keeps a historical v8 running evaluation readable but never leases its attempts", () => {
    const harness = createHarness();
    try {
      const target = evaluationTarget("snapshot-v8", "release-v8");
      const evaluationId = "evaluation-historical-v8-running";
      harness.store.reserveEvaluation({
        evaluationId,
        idempotencyKey: evaluationId,
        requestedBy: "admin-1",
        target,
        attempts: attemptReservations("-v8"),
      });
      rewriteEvaluationTargetForTest(harness, evaluationId, historicalV8Target(target));

      expect(harness.store.getEvaluation({
        evaluationId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      })).toMatchObject({
        status: "running",
        target: { artifactIdentityRevision: "additional-insights-v8" },
      });
      expect(() => harness.store.claimEvaluationAttempt({
        evaluationId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        attemptId: "attempt-1-v8",
      })).toThrow("ENERGYIQ_ADDITIONAL_EVALUATION_TARGET_BEHAVIOR_NOT_CURRENT");
    } finally {
      harness.close();
    }
  });

  it("keeps an awaiting-review v20 evaluation readable but blocks every new review mutation", () => {
    const harness = createHarness();
    try {
      reserveAndComplete(harness);
      const current = harness.store.getEvaluation({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      });
      const historical = rewriteEvaluationTargetForTest(
        harness,
        current.evaluationId,
        historicalV20Target(current.target),
      );
      const entry = historical.reviewPack.entries[0]!;

      expect(harness.store.getEvaluation({
        evaluationId: historical.evaluationId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      })).toEqual(historical);
      expect(() => harness.store.recordHumanReview({
        evaluationId: historical.evaluationId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        reviewToken: entry.reviewToken,
        actorId: "reviewer-1",
        scores: PASSING_SCORES,
        contentUsefulness: contentUsefulness(historical, entry.reviewToken),
        expectedRevision: 0,
      })).toThrow("ENERGYIQ_ADDITIONAL_EVALUATION_TARGET_BEHAVIOR_NOT_CURRENT");
    } finally {
      harness.close();
    }
  });

  it("keeps a historical v9 running evaluation readable but never leases its attempts", () => {
    const harness = createHarness();
    try {
      const target = evaluationTarget("snapshot-v9", "release-v9");
      const evaluationId = "evaluation-historical-v9-running";
      harness.store.reserveEvaluation({
        evaluationId,
        idempotencyKey: evaluationId,
        requestedBy: "admin-1",
        target,
        attempts: attemptReservations("-v9"),
      });
      rewriteEvaluationTargetForTest(harness, evaluationId, historicalV9Target(target));

      expect(harness.store.getEvaluation({
        evaluationId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      })).toMatchObject({
        status: "running",
        target: { artifactIdentityRevision: "additional-insights-v9" },
      });
      expect(() => harness.store.claimEvaluationAttempt({
        evaluationId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        attemptId: "attempt-1-v9",
      })).toThrow("ENERGYIQ_ADDITIONAL_EVALUATION_TARGET_BEHAVIOR_NOT_CURRENT");
    } finally {
      harness.close();
    }
  });

  it("keeps a historical v10 running evaluation readable but never leases its attempts", () => {
    const harness = createHarness();
    try {
      const target = evaluationTarget("snapshot-v10", "release-v10");
      const evaluationId = "evaluation-historical-v10-running";
      harness.store.reserveEvaluation({
        evaluationId,
        idempotencyKey: evaluationId,
        requestedBy: "admin-1",
        target,
        attempts: attemptReservations("-v10"),
      });
      rewriteEvaluationTargetForTest(harness, evaluationId, historicalV10Target(target));

      expect(harness.store.getEvaluation({
        evaluationId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      })).toMatchObject({
        status: "running",
        target: { artifactIdentityRevision: "additional-insights-v10" },
      });
      expect(() => harness.store.claimEvaluationAttempt({
        evaluationId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        attemptId: "attempt-1-v10",
      })).toThrow("ENERGYIQ_ADDITIONAL_EVALUATION_TARGET_BEHAVIOR_NOT_CURRENT");
    } finally {
      harness.close();
    }
  });

  it("keeps a historical v6 running evaluation readable but never leases its attempts", () => {
    const harness = createHarness();
    try {
      const target = evaluationTarget("snapshot-a", "release-a");
      harness.store.reserveEvaluation({
        evaluationId: "evaluation-historical-v6-running",
        idempotencyKey: "evaluation-historical-v6-running",
        requestedBy: "admin-1",
        target,
        attempts: attemptReservations(),
      });
      const row = harness.metadata.db.prepare(`
        SELECT reservation_json, record_json FROM energyiq_additional_insight_evaluations
        WHERE id = ?
      `).get("evaluation-historical-v6-running") as { reservation_json: string; record_json: string };
      const reservation = JSON.parse(row.reservation_json) as Record<string, unknown>;
      const record = JSON.parse(row.record_json) as Record<string, unknown>;
      const historicalTarget = historicalV6Target(target);
      harness.metadata.db.prepare(`
        UPDATE energyiq_additional_insight_evaluations
        SET reservation_json = ?, record_json = ? WHERE id = ?
      `).run(
        JSON.stringify({ ...reservation, target: historicalTarget }),
        JSON.stringify({ ...record, target: historicalTarget }),
        "evaluation-historical-v6-running",
      );

      expect(harness.store.getEvaluation({
        evaluationId: "evaluation-historical-v6-running",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      })).toMatchObject({
        status: "running",
        target: { artifactIdentityRevision: "additional-insights-v6" },
      });

      expect(() => harness.store.claimEvaluationAttempt({
        evaluationId: "evaluation-historical-v6-running",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        attemptId: "attempt-1",
      })).toThrow("ENERGYIQ_ADDITIONAL_EVALUATION_TARGET_BEHAVIOR_NOT_CURRENT");
    } finally {
      harness.close();
    }
  });

  it("does not lease a historical v5 running transition", () => {
    const harness = createHarness();
    try {
      reserveAndComplete(harness);
      reviewAllPassing(harness);
      const previous = harness.store.getEvaluation({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      });
      const previousAttempt = previous.attempts.find((attempt) => attempt.status === "completed"
        && attempt.humanReview?.passed)!;
      const currentTarget = evaluationTarget("snapshot-b", "release-b");
      const transition = harness.store.reserveTransition({
        transitionId: "transition-historical-v5-running",
        idempotencyKey: "transition-historical-v5-running",
        requestedBy: "admin-1",
        previousEvaluationId: previous.evaluationId,
        previousAttemptId: previousAttempt.attemptId,
        currentTarget,
        generationProviderRunId: "transition-generation-v5",
        generationProviderSessionId: "transition-generation-session-v5",
        comparisonProviderRunId: "transition-comparison-v5",
        comparisonProviderSessionId: "transition-comparison-session-v5",
      });
      const row = harness.metadata.db.prepare(`
        SELECT reservation_json FROM energyiq_additional_insight_transitions WHERE id = ?
      `).get(transition.transitionId) as { reservation_json: string };
      const reservation = JSON.parse(row.reservation_json) as Record<string, unknown>;
      harness.metadata.db.prepare(`
        UPDATE energyiq_additional_insight_transitions SET reservation_json = ? WHERE id = ?
      `).run(
        JSON.stringify({ ...reservation, currentTarget: historicalV5Target(currentTarget) }),
        transition.transitionId,
      );

      expect(() => harness.store.claimTransition({
        transitionId: transition.transitionId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      })).toThrow("ENERGYIQ_ADDITIONAL_EVALUATION_TARGET_BEHAVIOR_NOT_CURRENT");
    } finally {
      harness.close();
    }
  });

  it("rejects renew, complete, and fail writes made with already-issued v5 evaluation claim tokens", () => {
    const harness = createHarness();
    try {
      const target = evaluationTarget("snapshot-a", "release-a");
      harness.store.reserveEvaluation({
        evaluationId: "evaluation-v5-issued-token",
        idempotencyKey: "evaluation-v5-issued-token",
        requestedBy: "admin-1",
        target,
        attempts: attemptReservations(),
      });
      const tokens = [1, 2, 3].map((ordinal) => claimAttemptToken(
        harness,
        "evaluation-v5-issued-token",
        `attempt-${ordinal}`,
      ));
      const row = harness.metadata.db.prepare(`
        SELECT reservation_json, record_json FROM energyiq_additional_insight_evaluations WHERE id = ?
      `).get("evaluation-v5-issued-token") as { reservation_json: string; record_json: string };
      const historicalTarget = historicalV5Target(target);
      harness.metadata.db.prepare(`
        UPDATE energyiq_additional_insight_evaluations SET reservation_json = ?, record_json = ? WHERE id = ?
      `).run(
        JSON.stringify({ ...JSON.parse(row.reservation_json), target: historicalTarget }),
        JSON.stringify({ ...JSON.parse(row.record_json), target: historicalTarget }),
        "evaluation-v5-issued-token",
      );

      const mutations = [
        () => harness.store.renewEvaluationAttemptClaim({
          evaluationId: "evaluation-v5-issued-token",
          expectedWorkspaceId: "workspace-1",
          expectedProjectId: "project-1",
          attemptId: "attempt-1",
          claimToken: tokens[0]!,
        }),
        () => harness.store.completeAttempt({
          evaluationId: "evaluation-v5-issued-token",
          expectedWorkspaceId: "workspace-1",
          expectedProjectId: "project-1",
          attemptId: "attempt-2",
          claimToken: tokens[1]!,
          artifact: artifact(historicalTarget, "provider-run-2", "analysis.summary.usage_kwh", "finding-v5"),
          machineGate: passingMachineGate(),
        }),
        () => harness.store.failAttempt({
          evaluationId: "evaluation-v5-issued-token",
          expectedWorkspaceId: "workspace-1",
          expectedProjectId: "project-1",
          attemptId: "attempt-3",
          claimToken: tokens[2]!,
          errorCode: "PROVIDER_FAILED",
        }),
      ];
      for (const mutate of mutations) {
        expect(mutate).toThrow("ENERGYIQ_ADDITIONAL_EVALUATION_TARGET_BEHAVIOR_NOT_CURRENT");
      }
    } finally {
      harness.close();
    }
  });

  it("rejects renew, complete, and fail writes made with already-issued v5 transition claim tokens", () => {
    const harness = createHarness();
    try {
      reserveAndComplete(harness);
      reviewAllPassing(harness);
      const previous = harness.store.getEvaluation({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      });
      const previousAttempt = previous.attempts.find((attempt) => attempt.status === "completed"
        && attempt.humanReview?.passed)!;
      const currentTarget = evaluationTarget("snapshot-b", "release-b");
      const reservations = ["renew", "complete", "fail"].map((operation) => harness.store.reserveTransition({
        transitionId: `transition-v5-token-${operation}`,
        idempotencyKey: `transition-v5-token-${operation}`,
        requestedBy: "admin-1",
        previousEvaluationId: previous.evaluationId,
        previousAttemptId: previousAttempt.attemptId,
        currentTarget,
        generationProviderRunId: `transition-v5-generation-${operation}`,
        generationProviderSessionId: `transition-v5-generation-session-${operation}`,
        comparisonProviderRunId: `transition-v5-comparison-${operation}`,
        comparisonProviderSessionId: `transition-v5-comparison-session-${operation}`,
      }));
      const tokens = reservations.map(({ transitionId }) => claimTransitionToken(harness, transitionId));
      const historicalTarget = historicalV5Target(currentTarget);
      for (const { transitionId } of reservations) {
        const row = harness.metadata.db.prepare(`
          SELECT reservation_json FROM energyiq_additional_insight_transitions WHERE id = ?
        `).get(transitionId) as { reservation_json: string };
        harness.metadata.db.prepare(`
          UPDATE energyiq_additional_insight_transitions SET reservation_json = ? WHERE id = ?
        `).run(
          JSON.stringify({ ...JSON.parse(row.reservation_json), currentTarget: historicalTarget }),
          transitionId,
        );
      }

      const mutations = [
        () => harness.store.renewTransitionClaim({
          transitionId: reservations[0]!.transitionId,
          expectedWorkspaceId: "workspace-1",
          expectedProjectId: "project-1",
          claimToken: tokens[0]!,
        }),
        () => harness.store.completeTransition({
          transitionId: reservations[1]!.transitionId,
          expectedWorkspaceId: "workspace-1",
          expectedProjectId: "project-1",
          claimToken: tokens[1]!,
          currentArtifact: artifact(
            historicalTarget,
            reservations[1]!.generationProviderRunId,
            "analysis.summary.usage_kwh",
            "finding-v5-transition",
          ),
          outcomes: [{ transition: "no-material-change" }],
        }),
        () => harness.store.failTransition({
          transitionId: reservations[2]!.transitionId,
          expectedWorkspaceId: "workspace-1",
          expectedProjectId: "project-1",
          claimToken: tokens[2]!,
          errorCode: "PROVIDER_FAILED",
          failureStage: "generation",
        }),
      ];
      for (const mutate of mutations) {
        expect(mutate).toThrow("ENERGYIQ_ADDITIONAL_EVALUATION_TARGET_BEHAVIOR_NOT_CURRENT");
      }
    } finally {
      harness.close();
    }
  });

  it("keeps a historical v5 running batch readable but refuses to finalize it", () => {
    const harness = createHarness();
    try {
      reserveAndComplete(harness);
      const historical = rewriteEvaluationTargetForTest(
        harness,
        "evaluation-1",
        historicalV5Target(evaluationTarget("snapshot-a", "release-a")),
        (record) => ({
          ...record,
          status: "running",
          reviewPack: { revision: "additional-insight-blind-review-v1", entries: [] },
          reviewAudit: [],
        }),
      );
      expect(harness.store.getEvaluation({
        evaluationId: historical.evaluationId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      })).toMatchObject({ status: "running", target: { artifactIdentityRevision: "additional-insights-v5" } });

      expect(() => harness.store.finalizeEvaluation({
        evaluationId: historical.evaluationId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      })).toThrow("ENERGYIQ_ADDITIONAL_EVALUATION_TARGET_BEHAVIOR_NOT_CURRENT");
      expect(harness.store.getEvaluation({
        evaluationId: historical.evaluationId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      })).toEqual(historical);
    } finally {
      harness.close();
    }
  });

  it("keeps a historical v5 blind review readable but refuses to record a score", () => {
    const harness = completedHarness();
    try {
      const historical = rewriteEvaluationTargetForTest(
        harness,
        "evaluation-1",
        historicalV5Target(evaluationTarget("snapshot-a", "release-a")),
      );
      const entry = historical.reviewPack.entries[0]!;

      expect(() => harness.store.recordHumanReview({
        evaluationId: historical.evaluationId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        reviewToken: entry.reviewToken,
        actorId: "reviewer-legacy-v5",
        scores: PASSING_SCORES,
        contentUsefulness: contentUsefulness(historical, entry.reviewToken),
        expectedRevision: 0,
      })).toThrow("ENERGYIQ_ADDITIONAL_EVALUATION_TARGET_BEHAVIOR_NOT_CURRENT");
      expect(harness.store.getEvaluation({
        evaluationId: historical.evaluationId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      })).toEqual(historical);
    } finally {
      harness.close();
    }
  });

  it("keeps a historical v5 passed batch readable but refuses to approve a candidate", () => {
    const harness = completedHarness();
    try {
      reviewAllPassing(harness);
      const historical = rewriteEvaluationTargetForTest(
        harness,
        "evaluation-1",
        historicalV5Target(evaluationTarget("snapshot-a", "release-a")),
      );
      expect(historical.status).toBe("passed");
      const entry = historical.reviewPack.entries[0]!;

      expect(() => harness.store.approveEvaluationCandidate({
        evaluationId: historical.evaluationId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        reviewToken: entry.reviewToken,
        actorId: "admin-1",
        expectedRevision: 0,
      })).toThrow("ENERGYIQ_ADDITIONAL_EVALUATION_TARGET_BEHAVIOR_NOT_CURRENT");
      expect(harness.store.getEvaluation({
        evaluationId: historical.evaluationId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      })).toEqual(historical);
    } finally {
      harness.close();
    }
  });

  it("reserves one pass@3 batch, persists three independent attempts, and recovers a blind pack", () => {
    const harness = createHarness();
    try {
      const target = evaluationTarget("snapshot-a", "release-a");
      const reserved = harness.store.reserveEvaluation({
        evaluationId: "evaluation-1",
        idempotencyKey: "evaluation-key-1",
        requestedBy: "admin-1",
        target,
        attempts: attemptReservations(),
        now: "2026-08-14T00:00:00.000Z",
      });
      expect(reserved.created).toBe(true);
      expect(reserved.record.attempts.map((attempt) => attempt.providerRunId)).toEqual([
        "provider-run-1", "provider-run-2", "provider-run-3",
      ]);
      expect(reserved.record.attempts.map(({ artifact }) => artifact)).toEqual([
        expect.objectContaining({ artifactIdentityRevision: "additional-insight-evaluation-artifact-v1" }),
        expect.objectContaining({ artifactIdentityRevision: "additional-insight-evaluation-artifact-v1" }),
        expect.objectContaining({ artifactIdentityRevision: "additional-insight-evaluation-artifact-v1" }),
      ]);
      expect(new Set(reserved.record.attempts.map(({ artifact }) => artifact.artifactId))).toHaveLength(3);
      expect(new Set(reserved.record.attempts.map(({ artifact }) => artifact.artifactIdentityHash))).toHaveLength(3);

      const replay = harness.store.reserveEvaluation({
        evaluationId: "evaluation-other",
        idempotencyKey: "evaluation-key-1",
        requestedBy: "admin-1",
        target,
        attempts: attemptReservations("other"),
        now: "2026-08-14T00:00:01.000Z",
      });
      expect(replay).toMatchObject({ created: false, record: { evaluationId: "evaluation-1" } });

      for (const driftedTarget of [
        { ...target, dataSnapshotId: "snapshot-drift" },
        { ...target, projectReleaseId: "release-drift" },
        { ...target, analysisPeriod: { ...target.analysisPeriod, to: "2026-07-01T00:00:00.000Z" } },
        { ...target, modelProfileRevision: target.modelProfileRevision + 1 },
      ]) {
        expect(() => harness.store.reserveEvaluation({
          evaluationId: "evaluation-drift",
          idempotencyKey: "evaluation-key-1",
          requestedBy: "admin-1",
          target: driftedTarget,
          attempts: attemptReservations("drift"),
        })).toThrow(/ENERGYIQ_ADDITIONAL_EVALUATION_IDEMPOTENCY_CONFLICT/);
      }

      for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
        const claimToken = claimAttemptToken(harness, "evaluation-1", `attempt-${ordinal}`);
        harness.store.completeAttempt({
          evaluationId: "evaluation-1",
          expectedWorkspaceId: "workspace-1",
          expectedProjectId: "project-1",
          attemptId: `attempt-${ordinal}`,
          claimToken,
          artifact: artifactWithThreeFindings(target, `provider-run-${ordinal}`, `finding-${ordinal}`),
          machineGate: passingMachineGate(),
          completedAt: `2026-08-14T00:0${ordinal}:00.000Z`,
        });
      }
      const finalized = harness.store.finalizeEvaluation({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        now: "2026-08-14T00:10:00.000Z",
      });
      expect(finalized.status).toBe("awaiting-human-review");
      expect(finalized.reviewPack.entries).toHaveLength(3);
      expect(finalized.reviewPack.entries).toEqual(finalized.reviewPack.entries.map((entry) => expect.objectContaining({
        summary: expect.objectContaining({
          reviewSummaryToken: expect.stringMatching(/^blind-summary-/),
          text: expect.stringContaining("Finding"),
        }),
      })));
      for (const entry of finalized.reviewPack.entries) {
        expect(entry.summary?.text).toMatch(/^Finding finding-\d+-primary$/u);
        expect(entry.summary?.text.length).toBeLessThanOrEqual(180);
        expect(entry.summary?.text).not.toContain(";");
      }
      expect(finalized.reviewPack.entries).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ attemptId: expect.anything(), providerRunId: expect.anything() }),
      ]));
      expect(finalized.reviewAudit.map(({ attemptId }) => attemptId).sort()).toEqual([
        "attempt-1", "attempt-2", "attempt-3",
      ]);

      const firstEntry = finalized.reviewPack.entries[0]!;
      expect(() => harness.store.recordHumanReview({
        evaluationId: finalized.evaluationId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        reviewToken: firstEntry.reviewToken,
        actorId: "reviewer-1",
        scores: PASSING_SCORES,
        contentUsefulness: {
          summary: { applicable: false },
          insights: firstEntry.findings.map(({ reviewFindingToken }) => ({ reviewFindingToken, score: 4 })),
        },
        expectedRevision: 0,
      })).toThrow(/ENERGYIQ_ADDITIONAL_EVALUATION_CONTENT_USEFULNESS_INVALID/);

      harness.reopen();
      expect(harness.store.getEvaluation({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      })).toEqual(finalized);
    } finally {
      harness.close();
    }
  });

  it("keeps human review separate, applies idempotent revision semantics, and only approves a candidate", () => {
    const harness = completedHarness();
    const peer = createMetadataStore({ database_path: harness.databasePath });
    try {
      const batch = harness.store.getEvaluation({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      });
      const tokens = batch.reviewPack.entries.map(({ reviewToken }) => reviewToken);
      const first = peer.energyIq.additionalInsightEvaluations.recordHumanReview({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        reviewToken: tokens[0]!,
        actorId: "reviewer-1",
        scores: PASSING_SCORES,
        contentUsefulness: contentUsefulness(batch, tokens[0]!),
        expectedRevision: 0,
        now: "2026-08-14T01:00:00.000Z",
      });
      const replay = harness.store.recordHumanReview({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        reviewToken: tokens[0]!,
        actorId: "reviewer-1",
        scores: PASSING_SCORES,
        contentUsefulness: contentUsefulness(batch, tokens[0]!),
        expectedRevision: 0,
        now: "2026-08-14T01:00:01.000Z",
      });
      expect(replay.attempts).toEqual(first.attempts);

      expect(() => harness.store.recordHumanReview({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        reviewToken: tokens[0]!,
        actorId: "reviewer-1",
        scores: { ...PASSING_SCORES, userValue: 1 },
        contentUsefulness: contentUsefulness(batch, tokens[0]!),
        expectedRevision: 0,
      })).toThrow(/ENERGYIQ_ADDITIONAL_EVALUATION_REVIEW_REVISION_CONFLICT/);

      for (const token of tokens.slice(1)) {
        harness.store.recordHumanReview({
          evaluationId: "evaluation-1",
          expectedWorkspaceId: "workspace-1",
          expectedProjectId: "project-1",
          reviewToken: token,
          actorId: "reviewer-1",
          scores: token === tokens[1] ? PASSING_SCORES : { ...PASSING_SCORES, userValue: 2 },
          contentUsefulness: contentUsefulness(batch, token),
          expectedRevision: 0,
        });
      }
      const reviewed = harness.store.getEvaluation({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      });
      expect(reviewed.status).toBe("passed");

      const approved = peer.energyIq.additionalInsightEvaluations.approveEvaluationCandidate({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        reviewToken: tokens[0]!,
        actorId: "admin-1",
        expectedRevision: 0,
        now: "2026-08-14T02:00:00.000Z",
      });
      expect(approved).toMatchObject({
        status: "approved-candidate",
        approval: { disposition: "publication-candidate-only", actorId: "admin-1" },
      });
      expect(() => harness.store.approveEvaluationCandidate({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        reviewToken: tokens[1]!,
        actorId: "reviewer-1",
        expectedRevision: 0,
      })).toThrow(/ENERGYIQ_ADDITIONAL_EVALUATION_APPROVAL_(?:NOT_ALLOWED|CONFLICT|REVISION_CONFLICT)/);
      expect(harness.store.getEvaluation({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      }).approval).toEqual(approved.approval);
      expect(() => harness.store.reserveTransition({
        transitionId: "transition-wrong-approved-attempt",
        idempotencyKey: "transition-wrong-approved-attempt",
        requestedBy: "admin-1",
        previousEvaluationId: "evaluation-1",
        previousAttemptId: approved.attempts.find((attempt) => attempt.status === "completed"
          && attempt.attemptId !== approved.approval!.selectedAttemptId)!.attemptId,
        currentTarget: evaluationTarget("snapshot-b", "release-b"),
        generationProviderRunId: "transition-generation-run-wrong",
        generationProviderSessionId: "transition-generation-session-wrong",
        comparisonProviderRunId: "transition-comparison-run-wrong",
        comparisonProviderSessionId: "transition-comparison-session-wrong",
      })).toThrow(/ENERGYIQ_ADDITIONAL_TRANSITION_PREVIOUS_ATTEMPT_NOT_APPROVED/);
    } finally {
      peer.close();
      harness.close();
    }
  });

  it("restores a terminal v4 blind review that historically included a machine-failed attempt", () => {
    const harness = createHarness();
    try {
      reserveAndComplete(harness, { machineFailOrdinal: 1 });
      reviewAllPassing(harness);
      const current = harness.store.getEvaluation({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      });
      const machineFailed = current.attempts.find((attempt) => attempt.status === "completed"
        && attempt.machineGate.status === "failed")!;
      expect(current.reviewAudit.map(({ attemptId }) => attemptId)).not.toContain(machineFailed.attemptId);

      const completed = current.attempts.filter((attempt) => attempt.status === "completed");
      const historicalOrder = [...completed].sort((left, right) => (
        createHash("sha256").update(`${current.evaluationId}:${left.attemptId}:sort`).digest("hex")
          .localeCompare(createHash("sha256").update(`${current.evaluationId}:${right.attemptId}:sort`).digest("hex"))
      ));
      const blindToken = (attemptId: string, suffix: string): string => (
        createHash("sha256").update(`${current.evaluationId}:${attemptId}:${suffix}`).digest("hex").slice(0, 24)
      );
      const historicalEntries = historicalOrder.map((attempt, index) => {
        const findingId = `finding-${attempt.ordinal}`;
        return {
          label: (["Review A", "Review B", "Review C"] as const)[index]!,
          reviewToken: `blind-${blindToken(attempt.attemptId, "token")}`,
          summary: {
            reviewSummaryToken: `blind-summary-${blindToken(attempt.attemptId, "summary")}`,
            text: `Finding ${findingId}`,
          },
          findings: [{
            reviewFindingToken: `blind-finding-${createHash("sha256")
              .update(`${current.evaluationId}:${attempt.attemptId}:${findingId}:finding`)
              .digest("hex").slice(0, 24)}`,
            title: `Finding ${findingId}`,
            text: "An incremental Evidence-bound angle.",
            epistemicStatus: "observed" as const,
            evidenceRefs: ["analysis.summary.usage_kwh"],
            originKind: "ai-discovery" as const,
            directionMethodResourceIds: [],
          }],
        };
      });
      const historicalTarget = {
        ...current.target,
        artifactIdentityRevision: "additional-insights-v4",
        validatorRevision: "additional-insights-acceptance-v3",
        workflowRevision: "additional-insights-discover-accept-publish-v4",
        promptRevision: "additional-insights-discovery-v4",
      };
      const historical = {
        ...current,
        target: historicalTarget,
        status: "passed",
        attempts: current.attempts.map((attempt) => {
          if (attempt.status !== "completed") return attempt;
          const reviewEntry = historicalEntries[historicalOrder.findIndex(({ attemptId }) => (
            attemptId === attempt.attemptId
          ))]!;
          return {
            ...attempt,
            humanReview: {
              actorId: "reviewer-legacy-v4",
              reviewedAt: "2026-08-14T02:00:00.000Z",
              scores: PASSING_SCORES,
              contentUsefulness: {
                summary: { applicable: true as const, score: 4 },
                insights: reviewEntry.findings.map(({ reviewFindingToken }) => ({
                  reviewFindingToken,
                  score: 4,
                })),
              },
              passed: true,
              revision: 1,
            },
          };
        }),
        reviewPack: {
          ...current.reviewPack,
          entries: historicalEntries,
        },
        reviewAudit: historicalOrder.map((attempt, index) => ({
          reviewToken: historicalEntries[index]!.reviewToken,
          attemptId: attempt.attemptId,
        })),
      };
      const row = harness.metadata.db.prepare(`
        SELECT reservation_json FROM energyiq_additional_insight_evaluations WHERE id = ?
      `).get(current.evaluationId) as { reservation_json: string };
      const reservation = JSON.parse(row.reservation_json) as Record<string, unknown>;
      harness.metadata.db.prepare(`
        UPDATE energyiq_additional_insight_evaluations
        SET reservation_json = ?, record_json = ? WHERE id = ?
      `).run(
        JSON.stringify({ ...reservation, target: historicalTarget }),
        JSON.stringify(historical),
        current.evaluationId,
      );

      harness.reopen();
      expect(harness.store.getEvaluation({
        evaluationId: current.evaluationId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      })).toMatchObject({
        status: "passed",
        target: { artifactIdentityRevision: "additional-insights-v4" },
        reviewAudit: expect.arrayContaining([
          expect.objectContaining({ attemptId: machineFailed.attemptId }),
        ]),
      });
    } finally {
      harness.close();
    }
  });

  it("does not let a stale finalizer overwrite reviews committed by another Store connection", () => {
    const harness = completedHarness();
    const peer = createMetadataStore({ database_path: harness.databasePath });
    try {
      const beforeReview = harness.store.getEvaluation({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      });
      for (const entry of beforeReview.reviewPack.entries) {
        peer.energyIq.additionalInsightEvaluations.recordHumanReview({
          evaluationId: beforeReview.evaluationId,
          expectedWorkspaceId: "workspace-1",
          expectedProjectId: "project-1",
          reviewToken: entry.reviewToken,
          actorId: "reviewer-1",
          scores: PASSING_SCORES,
          contentUsefulness: contentUsefulness(beforeReview, entry.reviewToken),
          expectedRevision: 0,
        });
      }
      const passed = peer.energyIq.additionalInsightEvaluations.getEvaluation({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      });
      expect(passed.status).toBe("passed");

      expect(harness.store.finalizeEvaluation({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      })).toEqual(passed);
      expect(peer.energyIq.additionalInsightEvaluations.getEvaluation({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      })).toEqual(passed);
    } finally {
      peer.close();
      harness.close();
    }
  });

  it("rejects A-to-B transition unless the selected A attempt passed machine and human review", () => {
    const awaiting = completedHarness();
    try {
      const batch = awaiting.store.getEvaluation({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      });
      const attempt = batch.attempts.find((candidate) => candidate.status === "completed")!;
      expect(() => awaiting.store.reserveTransition({
        transitionId: "transition-awaiting",
        idempotencyKey: "transition-awaiting",
        requestedBy: "admin-1",
        previousEvaluationId: batch.evaluationId,
        previousAttemptId: attempt.attemptId,
        currentTarget: evaluationTarget("snapshot-b", "release-b"),
        generationProviderRunId: "generation-awaiting",
        generationProviderSessionId: "generation-session-awaiting",
        comparisonProviderRunId: "comparison-awaiting",
        comparisonProviderSessionId: "comparison-session-awaiting",
      })).toThrow(/ENERGYIQ_ADDITIONAL_TRANSITION_PREVIOUS_EVALUATION_NOT_PASSED/);
    } finally {
      awaiting.close();
    }

    const reviewed = completedHarness();
    try {
      const batch = reviewed.store.getEvaluation({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      });
      batch.reviewPack.entries.forEach((entry, index) => {
        reviewed.store.recordHumanReview({
          evaluationId: batch.evaluationId,
          expectedWorkspaceId: "workspace-1",
          expectedProjectId: "project-1",
          reviewToken: entry.reviewToken,
          actorId: "reviewer-1",
          scores: PASSING_SCORES,
          contentUsefulness: index === 0
            ? {
              summary: { applicable: true, score: 4 },
              insights: entry.findings.map(({ reviewFindingToken }) => ({ reviewFindingToken, score: 1 })),
            }
            : contentUsefulness(batch, entry.reviewToken),
          expectedRevision: 0,
        });
      });
      const passed = reviewed.store.getEvaluation({
        evaluationId: batch.evaluationId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      });
      expect(passed.status).toBe("passed");
      const humanFailed = passed.attempts.find((attempt) => attempt.status === "completed"
        && attempt.humanReview?.passed === false)!;
      expect(() => reviewed.store.reserveTransition({
        transitionId: "transition-human-failed",
        idempotencyKey: "transition-human-failed",
        requestedBy: "admin-1",
        previousEvaluationId: batch.evaluationId,
        previousAttemptId: humanFailed.attemptId,
        currentTarget: evaluationTarget("snapshot-b", "release-b"),
        generationProviderRunId: "generation-human-failed",
        generationProviderSessionId: "generation-session-human-failed",
        comparisonProviderRunId: "comparison-human-failed",
        comparisonProviderSessionId: "comparison-session-human-failed",
      })).toThrow(/ENERGYIQ_ADDITIONAL_TRANSITION_PREVIOUS_ATTEMPT_NOT_PASSED/);
    } finally {
      reviewed.close();
    }

    const machineFailed = createHarness();
    try {
      reserveAndComplete(machineFailed, { machineFailOrdinal: 1 });
      reviewAllPassing(machineFailed);
      const batch = machineFailed.store.getEvaluation({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      });
      expect(batch.status).toBe("passed");
      const failedAttempt = batch.attempts.find((attempt) => attempt.status === "completed"
        && attempt.machineGate.status === "failed")!;
      expect(() => machineFailed.store.reserveTransition({
        transitionId: "transition-machine-failed",
        idempotencyKey: "transition-machine-failed",
        requestedBy: "admin-1",
        previousEvaluationId: batch.evaluationId,
        previousAttemptId: failedAttempt.attemptId,
        currentTarget: evaluationTarget("snapshot-b", "release-b"),
        generationProviderRunId: "generation-machine-failed",
        generationProviderSessionId: "generation-session-machine-failed",
        comparisonProviderRunId: "comparison-machine-failed",
        comparisonProviderSessionId: "comparison-session-machine-failed",
      })).toThrow(/ENERGYIQ_ADDITIONAL_TRANSITION_PREVIOUS_ATTEMPT_NOT_PASSED/);
    } finally {
      machineFailed.close();
    }
  });

  it("persists localized attempt failures and an evidence-bound A-to-B transition without cross-Snapshot refs", () => {
    const harness = createHarness();
    try {
      reserveAndComplete(harness, { failOrdinal: 3 });
      const recovered = harness.store.getEvaluation({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      });
      expect(recovered.attempts[2]).toMatchObject({
        status: "failed",
        errorCode: "PROVIDER_FAILED",
        artifact: expect.objectContaining({ artifactIdentityRevision: "additional-insight-evaluation-artifact-v1" }),
      });
      expect(recovered.reviewPack.entries).toHaveLength(2);
      for (const entry of recovered.reviewPack.entries) {
        harness.store.recordHumanReview({
          evaluationId: "evaluation-1",
          expectedWorkspaceId: "workspace-1",
          expectedProjectId: "project-1",
          reviewToken: entry.reviewToken,
          actorId: "reviewer-1",
          scores: PASSING_SCORES,
          contentUsefulness: contentUsefulness(recovered, entry.reviewToken),
          expectedRevision: 0,
        });
      }
      expect(harness.store.getEvaluation({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      }).status).toBe("passed");

      const previousAttempt = recovered.attempts[0]!;
      if (previousAttempt.status !== "completed") throw new Error("test fixture expected completed attempt");
      const currentTarget = evaluationTarget("snapshot-b", "release-b");
      const reservation = harness.store.reserveTransition({
        transitionId: "transition-1",
        idempotencyKey: "transition-key-1",
        requestedBy: "admin-1",
        previousEvaluationId: "evaluation-1",
        previousAttemptId: previousAttempt.attemptId,
        currentTarget,
        generationProviderRunId: "transition-generation-run-1",
        generationProviderSessionId: "transition-generation-session-1",
        comparisonProviderRunId: "transition-comparison-run-1",
        comparisonProviderSessionId: "transition-comparison-session-1",
        now: "2026-08-14T03:00:00.000Z",
      });
      expect(reservation.created).toBe(true);
      const transitionClaimToken = claimTransitionToken(harness, reservation.transitionId);
      const currentArtifact = artifact(currentTarget, "transition-generation-run-1", "analysis.summary.usage_kwh", "finding-b");
      const completed = harness.store.completeTransition({
        transitionId: "transition-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        claimToken: transitionClaimToken,
        currentArtifact,
        outcomes: [{
          transition: "changed",
          previous: {
            artifactId: previousAttempt.artifact.artifactId,
            artifactIdentityHash: previousAttempt.artifact.artifactIdentityHash,
            findingId: "finding-1",
            evidenceRefs: ["analysis.summary.usage_kwh"],
          },
          current: {
            artifactId: reservation.currentArtifactId,
            artifactIdentityHash: reservation.currentArtifactIdentityHash,
            findingId: "finding-b",
            evidenceRefs: ["analysis.summary.usage_kwh"],
          },
        }],
        completedAt: "2026-08-14T03:01:00.000Z",
      });
      expect(completed.status).toBe("completed");
      expect(completed.previousTarget.artifactIdentityHash).toBe(recovered.target.artifactIdentityHash);
      expect(completed.previousArtifact.artifactIdentityHash).toBe(previousAttempt.artifact.artifactIdentityHash);
      expect(completed.previousTarget.artifactIdentityHash).not.toBe(completed.previousArtifact.artifactIdentityHash);
      expect(harness.store.getTransition({
        transitionId: completed.transitionId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      })).toEqual(completed);
      expect(() => harness.store.completeTransition({
        transitionId: completed.transitionId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        claimToken: transitionClaimToken,
        currentArtifact: artifact(currentTarget, "transition-generation-run-1", "analysis.summary.usage_kwh", "finding-other"),
        outcomes: completed.outcomes,
      })).toThrow(/ENERGYIQ_ADDITIONAL_TRANSITION_COMPLETION_CONFLICT/);

      const storedCurrent = harness.metadata.db.prepare(`
        SELECT current_artifact_json FROM energyiq_additional_insight_transitions WHERE id = ?
      `).get(completed.transitionId) as { current_artifact_json: string };
      harness.metadata.db.prepare(`
        UPDATE energyiq_additional_insight_transitions
        SET current_artifact_json = json_set(current_artifact_json, '$.findings[0].title', 'Tampered')
        WHERE id = ?
      `).run(completed.transitionId);
      expect(() => harness.store.getTransition({
        transitionId: completed.transitionId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      })).toThrow(/ENERGYIQ_ADDITIONAL_TRANSITION_CURRENT_ARTIFACT_INVALID/);
      harness.metadata.db.prepare(`
        UPDATE energyiq_additional_insight_transitions SET current_artifact_json = ? WHERE id = ?
      `).run(storedCurrent.current_artifact_json, completed.transitionId);

      const peer = createMetadataStore({ database_path: harness.databasePath });
      try {
        const replay = peer.energyIq.additionalInsightEvaluations.reserveTransition({
          transitionId: "transition-other",
          idempotencyKey: "transition-key-1",
          requestedBy: "admin-1",
          previousEvaluationId: "evaluation-1",
          previousAttemptId: previousAttempt.attemptId,
          currentTarget,
          generationProviderRunId: "transition-generation-run-other",
          generationProviderSessionId: "transition-generation-session-other",
          comparisonProviderRunId: "transition-comparison-run-other",
          comparisonProviderSessionId: "transition-comparison-session-other",
        });
        expect(replay).toMatchObject({ created: false, transitionId: "transition-1" });
        expect(harness.metadata.db.prepare(`
          SELECT COUNT(*) AS count FROM energyiq_additional_insight_transitions
          WHERE workspace_id = ? AND project_id = ? AND idempotency_key = ?
        `).get("workspace-1", "project-1", "transition-key-1")).toMatchObject({ count: 1 });
      } finally {
        peer.close();
      }

      expect(() => harness.store.completeTransition({
        transitionId: "transition-1",
        expectedWorkspaceId: "workspace-other",
        expectedProjectId: "project-1",
        claimToken: transitionClaimToken,
        currentArtifact,
        outcomes: [],
      })).toThrow(/ENERGYIQ_ADDITIONAL_TRANSITION_NOT_FOUND/);
    } finally {
      harness.close();
    }
  });

  it("persists a localized transition failure with exact Provider identities and recovers it idempotently", () => {
    const harness = createHarness();
    try {
      reserveAndComplete(harness);
      reviewAllPassing(harness);
      const previous = harness.store.getEvaluation({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      });
      const previousAttempt = previous.attempts[0]!;
      if (previousAttempt.status !== "completed") throw new Error("test fixture expected completed attempt");
      harness.store.reserveTransition({
        transitionId: "transition-failed",
        idempotencyKey: "transition-failed-key",
        requestedBy: "admin-1",
        previousEvaluationId: previous.evaluationId,
        previousAttemptId: previousAttempt.attemptId,
        currentTarget: evaluationTarget("snapshot-b", "release-b"),
        generationProviderRunId: "transition-generation-run-failed",
        generationProviderSessionId: "transition-generation-session-failed",
        comparisonProviderRunId: "transition-comparison-run-failed",
        comparisonProviderSessionId: "transition-comparison-session-failed",
      });
      const inFlightReplay = harness.store.reserveTransition({
        transitionId: "transition-other",
        idempotencyKey: "transition-failed-key",
        requestedBy: "admin-1",
        previousEvaluationId: previous.evaluationId,
        previousAttemptId: previousAttempt.attemptId,
        currentTarget: evaluationTarget("snapshot-b", "release-b"),
        generationProviderRunId: "must-not-replace-generation-run",
        generationProviderSessionId: "must-not-replace-generation-session",
        comparisonProviderRunId: "must-not-replace-comparison-run",
        comparisonProviderSessionId: "must-not-replace-comparison-session",
      });
      expect(inFlightReplay).toMatchObject({
        created: false,
        transitionId: "transition-failed",
        generationProviderRunId: "transition-generation-run-failed",
        generationProviderSessionId: "transition-generation-session-failed",
        comparisonProviderRunId: "transition-comparison-run-failed",
        comparisonProviderSessionId: "transition-comparison-session-failed",
      });
      const transitionClaimToken = claimTransitionToken(harness, "transition-failed");

      const failed = harness.store.failTransition({
        transitionId: "transition-failed",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        claimToken: transitionClaimToken,
        errorCode: "PRESCHOOL_ADDITIONAL_TRANSITION_REUSES_PREVIOUS_EVIDENCE",
        failureStage: "validation",
        completedAt: "2026-08-14T04:00:00.000Z",
      });
      expect(failed).toMatchObject({
        status: "failed",
        errorCode: "PRESCHOOL_ADDITIONAL_TRANSITION_REUSES_PREVIOUS_EVIDENCE",
        generationProviderRunId: "transition-generation-run-failed",
        comparisonProviderRunId: "transition-comparison-run-failed",
      });
      expect(harness.store.getTransition({
        transitionId: "transition-failed",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      })).toEqual(failed);
      expect(harness.store.failTransition({
        transitionId: "transition-failed",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        claimToken: transitionClaimToken,
        errorCode: "PRESCHOOL_ADDITIONAL_TRANSITION_REUSES_PREVIOUS_EVIDENCE",
        failureStage: "validation",
      })).toEqual(failed);
    } finally {
      harness.close();
    }
  });

  it("restores a terminal transition with its reserved Method resources after the current Registry drifts", () => {
    const harness = createHarness();
    try {
      reserveAndComplete(harness);
      reviewAllPassing(harness);
      const previous = harness.store.getEvaluation({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      });
      const previousAttempt = previous.attempts.find((attempt) => attempt.status === "completed")!;
      const currentTarget = evaluationTarget("snapshot-b", "release-b");
      const reservation = harness.store.reserveTransition({
        transitionId: "transition-historical-method",
        idempotencyKey: "transition-historical-method",
        requestedBy: "admin-1",
        previousEvaluationId: previous.evaluationId,
        previousAttemptId: previousAttempt.attemptId,
        currentTarget,
        generationProviderRunId: "transition-historical-generation",
        generationProviderSessionId: "transition-historical-generation-session",
        comparisonProviderRunId: "transition-historical-comparison",
        comparisonProviderSessionId: "transition-historical-comparison-session",
      });
      const currentArtifact = artifact(
        currentTarget,
        reservation.generationProviderRunId,
        "analysis.summary.usage_kwh",
        "finding-historical-method",
      );
      const completed = harness.store.completeTransition({
        transitionId: reservation.transitionId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        claimToken: claimTransitionToken(harness, reservation.transitionId),
        currentArtifact,
        outcomes: [{ transition: "no-material-change" }],
      });

      publishWorkspaceMethodForTest(harness.metadata.db, "later");

      expect(harness.store.getTransition({
        transitionId: completed.transitionId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      })).toEqual(completed);
    } finally {
      harness.close();
    }
  });

  it("fails closed on stale terminal writes, persisted Artifact tampering, and tenant probes", () => {
    const harness = createHarness();
    try {
      const claimTokens = reserveAndComplete(harness);
      const original = harness.store.getEvaluation({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      });
      const first = original.attempts[0]!;
      if (first.status !== "completed") throw new Error("test fixture expected completed attempt");
      expect(() => harness.store.completeAttempt({
        evaluationId: original.evaluationId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        attemptId: first.attemptId,
        claimToken: claimTokens.get(first.attemptId)!,
        artifact: artifact(original.target, first.providerRunId, "evidence:other", "finding-other"),
        machineGate: passingMachineGate(),
      })).toThrow(/ENERGYIQ_ADDITIONAL_EVALUATION_ATTEMPT_COMPLETION_CONFLICT/);

      expect(() => harness.store.getEvaluation({
        evaluationId: original.evaluationId,
        expectedWorkspaceId: "workspace-other",
        expectedProjectId: "project-1",
      })).toThrow(/ENERGYIQ_ADDITIONAL_EVALUATION_NOT_FOUND/);

      const stored = harness.metadata.db.prepare(`
        SELECT a.result_json, e.record_json
        FROM energyiq_additional_insight_evaluation_artifacts a
        JOIN energyiq_additional_insight_evaluations e ON e.id = a.evaluation_id
        WHERE a.evaluation_id = ? AND a.attempt_id = ?
      `).get(original.evaluationId, first.attemptId) as { result_json: string; record_json: string };
      harness.metadata.db.prepare(`
        UPDATE energyiq_additional_insight_evaluation_artifacts
        SET result_json = json_set(result_json, '$.findings[0].title', 'Tampered')
        WHERE evaluation_id = ? AND attempt_id = ?
      `).run(original.evaluationId, first.attemptId);
      expect(() => harness.store.getEvaluation({
        evaluationId: original.evaluationId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      })).toThrow(/ENERGYIQ_ADDITIONAL_EVALUATION_ARTIFACT_HASH_MISMATCH/);

      harness.metadata.db.prepare(`
        UPDATE energyiq_additional_insight_evaluation_artifacts SET result_json = ?
        WHERE evaluation_id = ? AND attempt_id = ?
      `).run(stored.result_json, original.evaluationId, first.attemptId);
      const mismatchedRecord = JSON.parse(stored.record_json) as {
        attempts: Array<{ attemptId: string; artifact: { resultHash?: string } }>;
      };
      mismatchedRecord.attempts.find(({ attemptId }) => attemptId === first.attemptId)!.artifact.resultHash = `sha256:${"f".repeat(64)}`;
      harness.metadata.db.prepare(`
        UPDATE energyiq_additional_insight_evaluations SET record_json = ? WHERE id = ?
      `).run(JSON.stringify(mismatchedRecord), original.evaluationId);
      expect(() => harness.store.getEvaluation({
        evaluationId: original.evaluationId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      })).toThrow(/ENERGYIQ_ADDITIONAL_EVALUATION_ARTIFACT_HASH_MISMATCH/);

      const crossTargetArtifact = JSON.parse(stored.result_json) as AdditionalAiInsightsArtifact;
      crossTargetArtifact.binding.dataSnapshotId = "snapshot-other";
      crossTargetArtifact.evidenceLineage.pins.dataSnapshotId = "snapshot-other";
      const crossTargetJson = JSON.stringify(crossTargetArtifact);
      const crossTargetRecord = JSON.parse(stored.record_json) as {
        attempts: Array<{ attemptId: string; artifact: { resultHash?: string } }>;
      };
      crossTargetRecord.attempts.find(({ attemptId }) => attemptId === first.attemptId)!.artifact.resultHash = `sha256:${createHash("sha256").update(crossTargetJson).digest("hex")}`;
      harness.metadata.db.prepare(`
        UPDATE energyiq_additional_insight_evaluation_artifacts SET result_json = ?
        WHERE evaluation_id = ? AND attempt_id = ?
      `).run(crossTargetJson, original.evaluationId, first.attemptId);
      harness.metadata.db.prepare(`
        UPDATE energyiq_additional_insight_evaluations SET record_json = ? WHERE id = ?
      `).run(JSON.stringify(crossTargetRecord), original.evaluationId);
      expect(() => harness.store.getEvaluation({
        evaluationId: original.evaluationId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      })).toThrow(/ENERGYIQ_ADDITIONAL_EVALUATION_ARTIFACT_INVALID/);
    } finally {
      harness.close();
    }
  });

  it("uses DB-backed expiring claims and rejects stale attempt owners", () => {
    const harness = createHarness();
    try {
      const target = evaluationTarget("snapshot-a", "release-a");
      const reserved = harness.store.reserveEvaluation({
        evaluationId: "evaluation-claim",
        idempotencyKey: "evaluation-claim-key",
        requestedBy: "admin-1",
        target,
        attempts: attemptReservations("-claim"),
      });
      const attempt = reserved.record.attempts[0]!;
      const first = harness.store.claimEvaluationAttempt({
        evaluationId: reserved.record.evaluationId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        attemptId: attempt.attemptId,
        now: "2026-08-14T00:00:00.000Z",
        leaseMs: 1_000,
      });
      expect(first.acquired).toBe(true);
      harness.store.renewEvaluationAttemptClaim({
        evaluationId: reserved.record.evaluationId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        attemptId: attempt.attemptId,
        claimToken: first.claimToken!,
        now: "2026-08-14T00:00:00.750Z",
        leaseMs: 1_000,
      });
      const concurrent = harness.store.claimEvaluationAttempt({
        evaluationId: reserved.record.evaluationId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        attemptId: attempt.attemptId,
        now: "2026-08-14T00:00:00.500Z",
        leaseMs: 1_000,
      });
      expect(concurrent.acquired).toBe(false);
      const recovered = harness.store.claimEvaluationAttempt({
        evaluationId: reserved.record.evaluationId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        attemptId: attempt.attemptId,
        now: "2026-08-14T00:00:01.500Z",
        leaseMs: 1_000,
      });
      expect(recovered).toMatchObject({ acquired: false, attempt: { artifact: attempt.artifact } });
      const reclaimed = harness.store.claimEvaluationAttempt({
        evaluationId: reserved.record.evaluationId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        attemptId: attempt.attemptId,
        now: "2026-08-14T00:00:02.000Z",
        leaseMs: 1_000,
      });
      expect(reclaimed).toMatchObject({ acquired: true, attempt: { artifact: attempt.artifact } });
      expect(reclaimed.claimToken).not.toBe(first.claimToken);
      expect(() => harness.store.completeAttempt({
        evaluationId: reserved.record.evaluationId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        attemptId: attempt.attemptId,
        claimToken: first.claimToken!,
        artifact: artifact(target, attempt.providerRunId, "evidence:stale", "finding-stale"),
        machineGate: passingMachineGate(),
      })).toThrow(/ENERGYIQ_ADDITIONAL_EVALUATION_CLAIM_CONFLICT/);
      harness.store.completeAttempt({
        evaluationId: reserved.record.evaluationId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        attemptId: attempt.attemptId,
        claimToken: reclaimed.claimToken!,
        artifact: artifact(target, attempt.providerRunId, "evidence:current", "finding-current"),
        machineGate: passingMachineGate(),
        completedAt: "2026-08-14T00:00:02.500Z",
      });
    } finally {
      harness.close();
    }
  });

  it("returns the same reservation across two Store connections instead of surfacing UNIQUE", () => {
    const harness = createHarness();
    const peer = createMetadataStore({ database_path: harness.databasePath });
    try {
      const target = evaluationTarget("snapshot-a", "release-a");
      const first = harness.store.reserveEvaluation({
        evaluationId: "evaluation-connection-a",
        idempotencyKey: "evaluation-two-connections",
        requestedBy: "admin-1",
        target,
        attempts: attemptReservations("-connection-a"),
      });
      const second = peer.energyIq.additionalInsightEvaluations.reserveEvaluation({
        evaluationId: "evaluation-connection-b",
        idempotencyKey: "evaluation-two-connections",
        requestedBy: "admin-1",
        target,
        attempts: attemptReservations("-connection-b"),
      });
      expect(first.created).toBe(true);
      expect(second).toMatchObject({ created: false, record: { evaluationId: first.record.evaluationId } });
      expect(harness.metadata.db.prepare(`
        SELECT COUNT(*) AS count FROM energyiq_additional_insight_evaluations
        WHERE workspace_id = ? AND project_id = ? AND idempotency_key = ?
      `).get("workspace-1", "project-1", "evaluation-two-connections")).toMatchObject({ count: 1 });
    } finally {
      peer.close();
      harness.close();
    }
  });

  it("enforces Project ownership, root Scope, migration identity, and Project cascade", () => {
    const harness = createHarness();
    try {
      expect(harness.metadata.db.prepare(`
        SELECT id FROM schema_migrations WHERE id = '0034_energyiq_additional_insight_evaluation_hardening'
      `).get()).toBeTruthy();
      const target = evaluationTarget("snapshot-a", "release-a");
      for (const invalidTarget of [
        { ...target, projectId: "project-missing" },
        { ...target, scopeId: "scope-not-in-project" },
      ]) {
        expect(() => harness.store.reserveEvaluation({
          evaluationId: `invalid-${invalidTarget.projectId}-${invalidTarget.scopeId}`,
          idempotencyKey: `invalid-${invalidTarget.projectId}-${invalidTarget.scopeId}`,
          requestedBy: "admin-1",
          target: invalidTarget,
          attempts: attemptReservations("-invalid"),
        })).toThrow(/ENERGYIQ_ADDITIONAL_EVALUATION_TARGET_NOT_FOUND/);
      }

      const reserved = harness.store.reserveEvaluation({
        evaluationId: "evaluation-cascade",
        idempotencyKey: "evaluation-cascade",
        requestedBy: "admin-1",
        target,
        attempts: attemptReservations("-cascade"),
      });
      const attempt = reserved.record.attempts[0]!;
      const claim = harness.store.claimEvaluationAttempt({
        evaluationId: reserved.record.evaluationId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        attemptId: attempt.attemptId,
      });
      harness.store.completeAttempt({
        evaluationId: reserved.record.evaluationId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        attemptId: attempt.attemptId,
        claimToken: claim.claimToken!,
        artifact: artifact(target, attempt.providerRunId, "analysis.summary.usage_kwh", "finding-cascade"),
        machineGate: passingMachineGate(),
      });
      const foreignKeys = harness.metadata.db.prepare(`
        PRAGMA foreign_key_list(energyiq_additional_insight_evaluations)
      `).all().map((row) => (row as { table: string }).table);
      expect(foreignKeys).toEqual(expect.arrayContaining(["workspaces", "energyiq_projects", "users"]));
      harness.metadata.workspaces.upsert({
        id: "workspace-2",
        owner_user_id: "admin-1",
        name: "Workspace 2",
        kind: "customer",
      });
      harness.metadata.energyIq.upsertProject({
        id: "project-2",
        workspace_id: "workspace-2",
        name: "Project 2",
        status: "published",
        root_scope_id: "scope-2",
      });
      expect(() => harness.metadata.db.prepare(`
        INSERT INTO energyiq_additional_insight_evaluation_artifacts (
          evaluation_id, attempt_id, workspace_id, project_id, result_json
        ) VALUES (?, ?, ?, ?, ?)
      `).run(reserved.record.evaluationId, "forged-attempt", "workspace-2", "project-2", "{}"))
        .toThrow(/FOREIGN KEY constraint failed/);
      expect(() => harness.metadata.db.prepare(`
        INSERT INTO energyiq_additional_insight_evaluation_claims (
          evaluation_id, attempt_id, workspace_id, project_id, claim_token, lease_expires_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        reserved.record.evaluationId,
        "forged-attempt",
        "workspace-2",
        "project-2",
        "forged",
        "2026-08-14T01:00:00.000Z",
        "2026-08-14T00:00:00.000Z",
      )).toThrow(/FOREIGN KEY constraint failed/);
      harness.metadata.db.prepare("DELETE FROM energyiq_projects WHERE id = ?").run("project-1");
      expect(harness.metadata.db.prepare(`
        SELECT COUNT(*) AS count FROM energyiq_additional_insight_evaluations WHERE project_id = 'project-1'
      `).get()).toMatchObject({ count: 0 });
      expect(harness.metadata.db.prepare(`
        SELECT COUNT(*) AS count FROM energyiq_additional_insight_evaluation_claims WHERE project_id = 'project-1'
      `).get()).toMatchObject({ count: 0 });
      expect(harness.metadata.db.prepare(`
        SELECT COUNT(*) AS count FROM energyiq_additional_insight_evaluation_artifacts WHERE project_id = 'project-1'
      `).get()).toMatchObject({ count: 0 });
      expect(() => harness.store.getEvaluation({
        evaluationId: reserved.record.evaluationId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      })).toThrow(/ENERGYIQ_ADDITIONAL_EVALUATION_NOT_FOUND/);
    } finally {
      harness.close();
    }
  });

  it("upgrades an existing 0033 running batch without changing its three reserved run identities", () => {
    const harness = createHarness();
    try {
      const target: AdditionalAiInsightEvaluationTarget = {
        ...evaluationTarget("snapshot-a", "release-a"),
        artifactIdentityRevision: "additional-insights-v3",
        validatorRevision: "additional-insights-acceptance-v3",
        workflowRevision: "additional-insights-discover-accept-publish-v3",
        promptRevision: "additional-insights-discovery-v3",
      };
      const oldRecord = {
        contractRevision: "energyiq-additional-insight-evaluation-v1",
        evaluationId: "evaluation-0033",
        idempotencyKey: "evaluation-0033-key",
        requestedBy: "admin-1",
        status: "running",
        target,
        attempts: attemptReservations("-0033").map((attempt) => ({
          ...attempt,
          status: "running",
          startedAt: "2026-08-14T00:00:00.000Z",
        })),
        reviewPack: { revision: "additional-insight-blind-review-v1", entries: [] },
        reviewAudit: [],
        createdAt: "2026-08-14T00:00:00.000Z",
        updatedAt: "2026-08-14T00:00:00.000Z",
      };
      harness.metadata.db.exec(`
        DROP TABLE energyiq_additional_insight_evaluation_claims;
        DROP TABLE energyiq_additional_insight_transition_claims;
        DROP TABLE energyiq_additional_insight_evaluation_artifacts;
        DROP TABLE energyiq_additional_insight_transitions;
        DROP TABLE energyiq_additional_insight_evaluations;
        CREATE TABLE energyiq_additional_insight_evaluations (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          scope_id TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          record_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(workspace_id, project_id, idempotency_key)
        );
        CREATE TABLE energyiq_additional_insight_evaluation_artifacts (
          evaluation_id TEXT NOT NULL,
          attempt_id TEXT NOT NULL,
          result_json TEXT NOT NULL,
          PRIMARY KEY(evaluation_id, attempt_id),
          FOREIGN KEY(evaluation_id) REFERENCES energyiq_additional_insight_evaluations(id) ON DELETE CASCADE
        );
        CREATE TABLE energyiq_additional_insight_transitions (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          reservation_json TEXT NOT NULL,
          record_json TEXT,
          current_artifact_json TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(workspace_id, project_id, idempotency_key)
        );
        DELETE FROM schema_migrations
        WHERE id = '0034_energyiq_additional_insight_evaluation_hardening';
      `);
      harness.metadata.db.prepare(`
        INSERT INTO energyiq_additional_insight_evaluations (
          id, workspace_id, project_id, scope_id, idempotency_key, record_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        oldRecord.evaluationId,
        target.workspaceId,
        target.projectId,
        target.scopeId,
        oldRecord.idempotencyKey,
        JSON.stringify(oldRecord),
        oldRecord.createdAt,
        oldRecord.updatedAt,
      );
      for (const faultAfterStep of ["rename", "create", "copy", "foreign-key-check"] as const) {
        expect(() => ensureEnergyIqAdditionalInsightEvaluationHardeningSchema(harness.metadata.db, {
          faultAfterStep,
        })).toThrow(/ENERGYIQ_ADDITIONAL_EVALUATION_0034_TEST_FAULT/);
        expect(harness.metadata.db.prepare(`
          SELECT COUNT(*) AS count FROM energyiq_additional_insight_evaluations
        `).get()).toMatchObject({ count: 1 });
        expect(harness.metadata.db.prepare(`
          SELECT name FROM sqlite_master WHERE type = 'table'
            AND name = 'energyiq_additional_insight_evaluations_0033'
        `).get()).toBeUndefined();
        expect(harness.metadata.db.prepare(`
          SELECT id FROM schema_migrations WHERE id = '0034_energyiq_additional_insight_evaluation_hardening'
        `).get()).toBeUndefined();
        const reopened = new DatabaseSync(harness.databasePath);
        try {
          expect(reopened.prepare(`
            SELECT id, record_json FROM energyiq_additional_insight_evaluations WHERE id = ?
          `).get(oldRecord.evaluationId)).toMatchObject({ id: oldRecord.evaluationId });
          expect(reopened.prepare(`
            SELECT name FROM sqlite_master WHERE type = 'table'
              AND name = 'energyiq_additional_insight_evaluations_0033'
          `).get()).toBeUndefined();
          expect(reopened.prepare(`
            SELECT id FROM schema_migrations WHERE id = '0034_energyiq_additional_insight_evaluation_hardening'
          `).get()).toBeUndefined();
        } finally {
          reopened.close();
        }
      }
      publishWorkspaceMethodForTest(harness.metadata.db, "migration-drift");
      const historicalTarget = targetWithWorkspaceMethod(target, "historical-before-drift");
      harness.metadata.db.prepare(`
        UPDATE energyiq_additional_insight_evaluations SET record_json = ? WHERE id = ?
      `).run(JSON.stringify({ ...oldRecord, target: historicalTarget }), oldRecord.evaluationId);
      expect(() => ensureEnergyIqAdditionalInsightEvaluationHardeningSchema(harness.metadata.db))
        .toThrow(/ENERGYIQ_ADDITIONAL_EVALUATION_0034_HISTORICAL_METHOD_RESOURCES_UNAVAILABLE/);
      expect(harness.metadata.db.prepare(`
        SELECT id FROM energyiq_additional_insight_evaluations WHERE id = ?
      `).get(oldRecord.evaluationId)).toMatchObject({ id: oldRecord.evaluationId });
      expect(harness.metadata.db.prepare(`
        SELECT id FROM schema_migrations WHERE id = '0034_energyiq_additional_insight_evaluation_hardening'
      `).get()).toBeUndefined();
      harness.metadata.db.prepare(`
        UPDATE energyiq_additional_insight_evaluations SET record_json = ? WHERE id = ?
      `).run(JSON.stringify(oldRecord), oldRecord.evaluationId);
      harness.metadata.db.prepare("DELETE FROM energyiq_insight_method_proposals WHERE id = ?")
        .run("proposal-migration-drift");
      harness.metadata.db.exec(`
        PRAGMA foreign_keys = OFF;
        ALTER TABLE energyiq_additional_insight_evaluation_artifacts
          RENAME TO energyiq_additional_insight_evaluation_artifacts_0033;
        ALTER TABLE energyiq_additional_insight_evaluations
          RENAME TO energyiq_additional_insight_evaluations_0033;
        ALTER TABLE energyiq_additional_insight_transitions
          RENAME TO energyiq_additional_insight_transitions_0033;
      `);
      initializeEnergyIqAdditionalInsightEvaluationSchema(harness.metadata.db);
      harness.metadata.db.exec("PRAGMA foreign_keys = ON");
      ensureEnergyIqAdditionalInsightEvaluationHardeningSchema(harness.metadata.db);
      const migrated = harness.store.getEvaluation({
        evaluationId: oldRecord.evaluationId,
        expectedWorkspaceId: target.workspaceId,
        expectedProjectId: target.projectId,
      });
      expect(migrated.attempts.map(({ providerRunId }) => providerRunId)).toEqual(
        oldRecord.attempts.map(({ providerRunId }) => providerRunId),
      );
      expect(new Set(migrated.attempts.map(({ artifact }) => artifact.artifactId))).toHaveLength(3);
      expect(harness.metadata.db.prepare(`
        SELECT name FROM sqlite_master WHERE type = 'table'
          AND name = 'energyiq_additional_insight_evaluations_0033'
      `).get()).toBeUndefined();
    } finally {
      harness.close();
    }
  });
});

const publishWorkspaceMethodForTest = (db: DatabaseSync, suffix: string): void => {
  const content = `Published direction ${suffix}`;
  const publishedMethod = {
    skillId: `workspace-insight-method:${suffix}`,
    semanticVersion: "1.0.0",
    resourceId: `insight-method-proposal:${suffix}`,
    resourceRevision: 1,
    contentSha256: createHash("sha256").update(content).digest("hex"),
    scope: "workspace",
    workspaceId: "workspace-1",
    userId: "admin-1",
    role: "expert-direction",
  };
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    db.prepare(`
      INSERT INTO energyiq_insight_method_proposals (
        id, workspace_id, project_id, scope_id, artifact_id, artifact_identity_hash,
        artifact_identity_revision, data_snapshot_id, project_release_id,
        analysis_period_from, analysis_period_to, finding_id, created_by,
        idempotency_key, title, guidance, status, revision,
        publication_actor_id, published_at, published_method_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', 4, ?, ?, ?, ?, ?)
    `).run(
      `proposal-${suffix}`, "workspace-1", "project-1", "scope-1", `historical-artifact-${suffix}`,
      `sha256:${"a".repeat(64)}`, "additional-insights-v3", `snapshot-${suffix}`, `release-${suffix}`,
      "2026-05-01T00:00:00.000Z", "2026-06-01T00:00:00.000Z", `finding-${suffix}`, "admin-1",
      `method-${suffix}`, `Method ${suffix}`, content, "admin-1", "2026-08-14T04:00:00.000Z",
      JSON.stringify(publishedMethod), "2026-08-14T04:00:00.000Z", "2026-08-14T04:00:00.000Z",
    );
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
};

const targetWithWorkspaceMethod = (
  target: AdditionalAiInsightEvaluationTarget,
  suffix: string,
): AdditionalAiInsightEvaluationTarget => {
  const content = `Historical direction ${suffix}`;
  const resource: AdditionalAiInsightMethodResource = {
    method: {
      skillId: `workspace-insight-method:${suffix}`,
      semanticVersion: "1.0.0",
      resourceId: `insight-method-proposal:${suffix}`,
      resourceRevision: 1,
      contentSha256: createHash("sha256").update(content).digest("hex"),
      scope: "workspace",
      workspaceId: target.workspaceId,
      userId: "admin-1",
      role: "expert-direction",
    },
    content,
  };
  const current = resolveCurrentAdditionalAiInsightMethodSet(target.workspaceId);
  const methodSet = resolveAdditionalAiInsightMethodSet({
    workspaceId: target.workspaceId,
    methodSetId: current.id,
    methodSetRevision: current.revision,
    workspaceMethodResources: [resource],
  });
  if (!methodSet) throw new Error("test fixture expected historical Method set");
  return {
    ...target,
    methodSetId: methodSet.id,
    methodSetRevision: methodSet.revision,
    methodSetFingerprint: `sha256:${createHash("sha256")
      .update(canonicalInsightMethodSetJson(methodSet.methods)!)
      .digest("hex")}`,
  };
};

const PASSING_SCORES: AdditionalAiInsightHumanScores = {
  newAngle: 4,
  relevance: 4,
  clarity: 4,
  worthExploring: 4,
  epistemicHonesty: 4,
  userValue: 4,
};

const contentUsefulness = (
  batch: ReturnType<ReturnType<typeof createHarness>["store"]["getEvaluation"]>,
  reviewToken: string,
) => {
  const entry = batch.reviewPack.entries.find((candidate) => candidate.reviewToken === reviewToken)!;
  return {
    summary: entry.summary === undefined
      ? { applicable: false as const }
      : { applicable: true as const, score: 4 },
    insights: entry.findings.map(({ reviewFindingToken }) => ({ reviewFindingToken, score: 4 })),
  };
};

const passingMachineGate = () => ({
  status: "passed" as const,
  checks: ADDITIONAL_AI_INSIGHT_EVALUATION_MACHINE_CHECKS.map((check) => ({ check, passed: true })),
});

const failingMachineGate = () => ({
  status: "failed" as const,
  checks: ADDITIONAL_AI_INSIGHT_EVALUATION_MACHINE_CHECKS.map((check, index) => index === 0
    ? { check, passed: false, code: "CONTRACT_FAILED" }
    : { check, passed: true }),
});

const attemptReservations = (suffix = ""): Array<{
  attemptId: string; ordinal: number; providerRunId: string; providerSessionId: string;
}> => [1, 2, 3].map((ordinal) => ({
  attemptId: `attempt-${ordinal}${suffix}`,
  ordinal,
  providerRunId: `provider-run-${ordinal}${suffix}`,
  providerSessionId: `provider-session-${ordinal}${suffix}`,
}));

const evaluationTarget = (
  dataSnapshotId: string,
  projectReleaseId: string,
): AdditionalAiInsightEvaluationTarget => {
  const methodSet = resolveCurrentAdditionalAiInsightMethodSet("workspace-1");
  const canonical = canonicalInsightMethodSetJson(methodSet.methods)!;
  return {
    workspaceId: "workspace-1",
    projectId: "project-1",
    scopeId: "scope-1",
    resource: "electricity",
    dataSnapshotId,
    projectReleaseId,
    analysisPeriod: { from: "2026-05-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" },
    modelProfileId: "workspace-default",
    modelProfileRevision: 7,
    artifactIdentityRevision: "additional-insights-v24",
    artifactIdentityHash: `sha256:${createHash("sha256").update(`${dataSnapshotId}:${projectReleaseId}`).digest("hex")}`,
    outputContractRevision: "energyiq-additional-ai-insights-v2",
    validatorRevision: "additional-insights-acceptance-v17",
    workflowRevision: "additional-insights-discover-accept-publish-v21",
    promptRevision: "additional-insights-discovery-v12",
    capabilityRevision: "scoped-read-only-v1",
    publicationRevision: "additional-insights-v2",
    canvasRevision: "energyiq-insight-canvas-v2",
    methodSetId: methodSet.id,
    methodSetRevision: methodSet.revision,
    methodSetFingerprint: `sha256:${createHash("sha256").update(canonical).digest("hex")}`,
  };
};

const artifact = (
  target: AdditionalAiInsightEvaluationTarget,
  runId: string,
  evidenceId: string,
  findingId: string,
): AdditionalAiInsightsArtifactV1V2 => {
  const methodSet = resolveCurrentAdditionalAiInsightMethodSet(target.workspaceId);
  const coreMethod = methodSet.methods[0]!;
  return {
    artifactKind: "autonomous-insights",
    status: "available",
    providerProfileId: target.modelProfileId,
    runId,
    contract: { id: "energyiq-additional-ai-insights", revision: "energyiq-additional-ai-insights-v2" },
    binding: {
      workspaceId: target.workspaceId,
      projectId: target.projectId,
      scopeId: target.scopeId,
      dataSnapshotId: target.dataSnapshotId,
      projectReleaseId: target.projectReleaseId,
      analysisPeriod: { ...target.analysisPeriod },
      modelProfileId: target.modelProfileId,
      modelProfileRevision: target.modelProfileRevision,
    },
    methodExecution: {
      methodSetId: target.methodSetId,
      methodSetRevision: target.methodSetRevision,
      methodSetFingerprint: target.methodSetFingerprint,
      loadedMethods: [...methodSet.methods],
    },
    capability: {
      revision: target.capabilityRevision,
      mode: "scoped-read-only",
      allowedTools: [...ADDITIONAL_AI_INSIGHTS_SCOPED_READ_ONLY_TOOLS_V1],
      usedTools: [],
    },
    toolAudits: [],
    evidenceLineage: {
      catalogContract: "analysis-context-evidence@1",
      sourceId: `catalog:${target.dataSnapshotId}`,
      pins: {
        workspaceId: target.workspaceId,
        projectId: target.projectId,
        scopeId: target.scopeId,
        dataSnapshotId: target.dataSnapshotId,
        dataCutoff: "2026-05-31T23:45:00.000Z",
        projectReleaseId: target.projectReleaseId,
        metricVersion: "metric-v1",
      },
      facts: [{
        id: evidenceId,
        label: "Evidence",
        metricId: "energy.additional",
        value: target.dataSnapshotId === "snapshot-a" ? 10 : 12,
        unit: "kWh",
        status: "confirmed",
        evidenceRefs: [`source:${evidenceId}`],
        dimensions: { scopeId: target.scopeId },
      }],
    },
    findings: [{
      id: findingId,
      title: `Finding ${findingId}`,
      text: "An incremental Evidence-bound angle.",
      epistemicStatus: "observed",
      origin: { kind: "ai-discovery", coreMethod, directionMethods: [] },
      evidenceRefs: [evidenceId],
      toolAuditIds: [],
    }],
    publication: {
      policyId: "energyiq-additional-ai-insights",
      policyRevision: target.publicationRevision,
      discoveredCount: 1,
      acceptedCount: 1,
      rejectedCount: 0,
      publishedCount: 1,
      sourceOrderCandidateIds: [findingId],
      acceptedCandidateIds: [findingId],
      rejectedCandidateIds: [],
      publishedCandidateIds: [findingId],
      suppressedCandidateIds: [],
    },
  };
};

const artifactWithThreeFindings = (
  target: AdditionalAiInsightEvaluationTarget,
  runId: string,
  prefix: string,
): AdditionalAiInsightsArtifactV1V2 => {
  const value = artifact(target, runId, "analysis.summary.usage_kwh", `${prefix}-primary`);
  if (value.status !== "available") throw new Error("available fixture required");
  const [primary] = value.findings;
  if (!primary) throw new Error("primary Finding fixture required");
  const candidateIds = [`${prefix}-primary`, `${prefix}-secondary`, `${prefix}-tertiary`];
  value.findings = candidateIds.map((candidateId, index) => ({
    ...structuredClone(primary),
    id: candidateId,
    title: `Finding ${candidateId}`,
    text: `Incremental Evidence-bound angle ${index + 1}.`,
  }));
  value.publication = {
    ...value.publication,
    discoveredCount: 3,
    acceptedCount: 3,
    publishedCount: 3,
    sourceOrderCandidateIds: candidateIds,
    acceptedCandidateIds: candidateIds,
    publishedCandidateIds: candidateIds,
  };
  return value;
};

const createHarness = () => {
  const root = mkdtempSync(join(tmpdir(), "energyiq-additional-evaluation-"));
  const databasePath = join(root, "metadata.sqlite");
  let metadata = createMetadataStore({ database_path: databasePath });
  metadata.users.upsertDevUser({
    id: "admin-1",
    email: "admin@example.test",
    display_name: "Admin",
    dev_token: "admin-token",
  });
  metadata.workspaces.upsert({
    id: "workspace-1",
    owner_user_id: "admin-1",
    name: "Workspace 1",
    kind: "customer",
  });
  metadata.energyIq.upsertProject({
    id: "project-1",
    workspace_id: "workspace-1",
    name: "Project 1",
    status: "published",
    root_scope_id: "scope-1",
  });
  const harness = {
    databasePath,
    get metadata() { return metadata; },
    get store() { return metadata.energyIq.additionalInsightEvaluations; },
    reopen() {
      metadata.close();
      metadata = createMetadataStore({ database_path: databasePath });
    },
    close() {
      try { metadata.close(); } catch { /* reopen may have failed after closing the old handle */ }
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
  return harness;
};

const historicalV5Target = (
  target: AdditionalAiInsightEvaluationTarget,
): AdditionalAiInsightEvaluationTarget => ({
  ...target,
  artifactIdentityRevision: "additional-insights-v5",
  validatorRevision: "additional-insights-acceptance-v3",
  workflowRevision: "additional-insights-discover-accept-publish-v5",
  promptRevision: "additional-insights-discovery-v5",
});

const historicalV6Target = (
  current: AdditionalAiInsightEvaluationTarget,
): AdditionalAiInsightEvaluationTarget => ({
  ...current,
  artifactIdentityRevision: "additional-insights-v6",
  validatorRevision: "additional-insights-acceptance-v4",
  workflowRevision: "additional-insights-discover-accept-publish-v6",
  promptRevision: "additional-insights-discovery-v6",
});

const historicalV7Target = (
  current: AdditionalAiInsightEvaluationTarget,
): AdditionalAiInsightEvaluationTarget => ({
  ...current,
  artifactIdentityRevision: "additional-insights-v7",
  validatorRevision: "additional-insights-acceptance-v5",
  workflowRevision: "additional-insights-discover-accept-publish-v7",
  promptRevision: "additional-insights-discovery-v7",
});

const historicalV8Target = (
  current: AdditionalAiInsightEvaluationTarget,
): AdditionalAiInsightEvaluationTarget => ({
  ...current,
  artifactIdentityRevision: "additional-insights-v8",
  validatorRevision: "additional-insights-acceptance-v6",
  workflowRevision: "additional-insights-discover-accept-publish-v8",
  promptRevision: "additional-insights-discovery-v7",
});

const historicalV9Target = (
  current: AdditionalAiInsightEvaluationTarget,
): AdditionalAiInsightEvaluationTarget => ({
  ...current,
  artifactIdentityRevision: "additional-insights-v9",
  validatorRevision: "additional-insights-acceptance-v6",
  workflowRevision: "additional-insights-discover-accept-publish-v9",
  promptRevision: "additional-insights-discovery-v7",
});

const historicalV10Target = (
  current: AdditionalAiInsightEvaluationTarget,
): AdditionalAiInsightEvaluationTarget => ({
  ...current,
  artifactIdentityRevision: "additional-insights-v10",
  validatorRevision: "additional-insights-acceptance-v7",
  workflowRevision: "additional-insights-discover-accept-publish-v10",
  promptRevision: "additional-insights-discovery-v8",
});

const historicalV16Target = (
  current: AdditionalAiInsightEvaluationTarget,
): AdditionalAiInsightEvaluationTarget => ({
  ...current,
  artifactIdentityRevision: "additional-insights-v16",
  validatorRevision: "additional-insights-acceptance-v13",
  workflowRevision: "additional-insights-discover-accept-publish-v16",
  promptRevision: "additional-insights-discovery-v10",
});

const historicalV20Target = (
  target: AdditionalAiInsightEvaluationTarget,
): AdditionalAiInsightEvaluationTarget => ({
  ...target,
  artifactIdentityRevision: "additional-insights-v20",
  validatorRevision: "additional-insights-acceptance-v16",
  workflowRevision: "additional-insights-discover-accept-publish-v20",
  promptRevision: "additional-insights-discovery-v10",
});

const rewriteEvaluationTargetForTest = (
  harness: ReturnType<typeof createHarness>,
  evaluationId: string,
  target: AdditionalAiInsightEvaluationTarget,
  updateRecord: (record: Record<string, unknown>) => Record<string, unknown> = (record) => record,
) => {
  const row = harness.metadata.db.prepare(`
    SELECT reservation_json, record_json FROM energyiq_additional_insight_evaluations WHERE id = ?
  `).get(evaluationId) as { reservation_json: string; record_json: string };
  const reservation = JSON.parse(row.reservation_json) as Record<string, unknown>;
  const record = updateRecord(JSON.parse(row.record_json) as Record<string, unknown>);
  const historicalRecord = { ...record, target };
  harness.metadata.db.prepare(`
    UPDATE energyiq_additional_insight_evaluations SET reservation_json = ?, record_json = ? WHERE id = ?
  `).run(
    JSON.stringify({ ...reservation, target }),
    JSON.stringify(historicalRecord),
    evaluationId,
  );
  return harness.store.getEvaluation({
    evaluationId,
    expectedWorkspaceId: target.workspaceId,
    expectedProjectId: target.projectId,
  });
};

const reserveAndComplete = (
  harness: ReturnType<typeof createHarness>,
  input: { failOrdinal?: number; machineFailOrdinal?: number } = {},
): Map<string, string> => {
  const claimTokens = new Map<string, string>();
  const target = evaluationTarget("snapshot-a", "release-a");
  harness.store.reserveEvaluation({
    evaluationId: "evaluation-1",
    idempotencyKey: "evaluation-key-1",
    requestedBy: "admin-1",
    target,
    attempts: attemptReservations(),
  });
  expect(harness.store.getEvaluation({
    evaluationId: "evaluation-1",
    expectedWorkspaceId: "workspace-1",
    expectedProjectId: "project-1",
  }).attempts.map(({ status }) => status)).toEqual(["running", "running", "running"]);
  for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
    const claimToken = claimAttemptToken(harness, "evaluation-1", `attempt-${ordinal}`);
    claimTokens.set(`attempt-${ordinal}`, claimToken);
    if (ordinal === input.failOrdinal) {
      expect(harness.store.getEvaluation({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      }).attempts[ordinal - 1]).toMatchObject({ status: "running" });
      harness.store.failAttempt({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        attemptId: `attempt-${ordinal}`,
        claimToken,
        errorCode: "PROVIDER_FAILED",
      });
    } else {
      harness.store.completeAttempt({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
        attemptId: `attempt-${ordinal}`,
        claimToken,
        artifact: artifact(target, `provider-run-${ordinal}`, "analysis.summary.usage_kwh", `finding-${ordinal}`),
        machineGate: ordinal === input.machineFailOrdinal ? failingMachineGate() : passingMachineGate(),
      });
      expect(harness.store.getEvaluation({
        evaluationId: "evaluation-1",
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      }).attempts.map(({ status }) => status)).toEqual(
        [1, 2, 3].map((candidate) => candidate <= ordinal ? "completed" : "running"),
      );
    }
  }
  harness.store.finalizeEvaluation({
    evaluationId: "evaluation-1",
    expectedWorkspaceId: "workspace-1",
    expectedProjectId: "project-1",
  });
  return claimTokens;
};

const completedHarness = () => {
  const harness = createHarness();
  reserveAndComplete(harness);
  return harness;
};

const reviewAllPassing = (harness: ReturnType<typeof createHarness>): void => {
  const batch = harness.store.getEvaluation({
    evaluationId: "evaluation-1",
    expectedWorkspaceId: "workspace-1",
    expectedProjectId: "project-1",
  });
  for (const entry of batch.reviewPack.entries) {
    harness.store.recordHumanReview({
      evaluationId: batch.evaluationId,
      expectedWorkspaceId: "workspace-1",
      expectedProjectId: "project-1",
      reviewToken: entry.reviewToken,
      actorId: "reviewer-1",
      scores: PASSING_SCORES,
      contentUsefulness: contentUsefulness(batch, entry.reviewToken),
      expectedRevision: 0,
    });
  }
};

const claimAttemptToken = (
  harness: ReturnType<typeof createHarness>,
  evaluationId: string,
  attemptId: string,
): string => {
  const claim = harness.store.claimEvaluationAttempt({
    evaluationId,
    expectedWorkspaceId: "workspace-1",
    expectedProjectId: "project-1",
    attemptId,
  });
  if (!claim.acquired || !claim.claimToken) throw new Error("test fixture expected claim");
  return claim.claimToken;
};

const claimTransitionToken = (
  harness: ReturnType<typeof createHarness>,
  transitionId: string,
): string => {
  const claim = harness.store.claimTransition({
    transitionId,
    expectedWorkspaceId: "workspace-1",
    expectedProjectId: "project-1",
  });
  if (!claim.acquired || !claim.claimToken) throw new Error("test fixture expected transition claim");
  return claim.claimToken;
};
