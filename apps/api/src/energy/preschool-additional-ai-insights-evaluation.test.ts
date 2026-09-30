import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";

import {
  ADDITIONAL_AI_INSIGHTS_SCOPED_READ_ONLY_TOOLS_V1,
  resolveCurrentAdditionalAiInsightMethodSet,
  type AdditionalAiInsightEvaluationTarget,
  type AdditionalAiInsightsArtifact,
  type AdditionalAiInsightsArtifactV1V2,
} from "@datafoundry/contracts";
import { createMetadataStore, type UserRecord } from "@datafoundry/metadata";

import {
  createOverviewAiArtifactIdentity,
  createPreschoolAdditionalAiInsightArtifactIdentity,
  type OverviewAiArtifactIdentityV13,
  type PreschoolAdditionalAiInsightArtifactIdentity,
} from "./overview-ai-artifact.js";
import {
  createPreschoolAdditionalAiInsightsEvaluationWorkflow,
  PRESCHOOL_ADDITIONAL_AI_STRUCTURED_OUTPUT_ROOT_INVALID,
  PRESCHOOL_ADDITIONAL_AI_STRUCTURED_OUTPUT_SCHEMA_INVALID,
} from "./preschool-additional-ai-insights-evaluation.js";
import { resolveWorkspaceDefaultModelProfileSnapshot } from "../workspace-model-profile-resolver.js";

describe("Preschool Additional AI Insights evaluation workflow", () => {
  it("promotes only the exact approved attempt into the current Overview without another Provider run", async () => {
    const harness = createHarness();
    try {
      const runAttempt = vi.fn(async ({ identity, runId }: {
        identity: PreschoolAdditionalAiInsightArtifactIdentity;
        runId: string;
      }) => artifact(identity, runId, `evidence:${runId}`, `finding-${runId}`));
      const workflow = createPreschoolAdditionalAiInsightsEvaluationWorkflow({
        metadataStore: harness.metadata,
        runAttempt,
        runTransition: vi.fn(),
      });
      const passed = reviewAllPassing(harness, await workflow.executePassAt3({
        baseIdentity: harness.baseIdentity,
        user: harness.user,
        idempotencyKey: "publish-approved-candidate",
      }));
      const selected = passed.attempts.find((attempt) => (
        attempt.status === "completed" && attempt.humanReview?.passed
      ))!;
      const reviewToken = passed.reviewAudit.find(({ attemptId }) => attemptId === selected.attemptId)!.reviewToken;
      harness.metadata.energyIq.additionalInsightEvaluations.approveEvaluationCandidate({
        evaluationId: passed.evaluationId,
        expectedWorkspaceId: passed.target.workspaceId,
        expectedProjectId: passed.target.projectId,
        reviewToken,
        actorId: harness.user.id,
        expectedRevision: 0,
      });
      const selectedArtifact = harness.metadata.energyIq.additionalInsightEvaluations.getAttemptArtifact({
        evaluationId: passed.evaluationId,
        attemptId: selected.attemptId,
        expectedWorkspaceId: passed.target.workspaceId,
        expectedProjectId: passed.target.projectId,
      });

      const published = await workflow.publishApprovedCandidate({
        baseIdentity: harness.baseIdentity,
        evaluationId: passed.evaluationId,
        user: harness.user,
      });

      expect(runAttempt).toHaveBeenCalledTimes(3);
      expect(published.publication).toMatchObject({
        sourceAttemptId: selected.attemptId,
        actorId: harness.user.id,
        revision: 1,
      });
      const currentIdentity = createPreschoolAdditionalAiInsightArtifactIdentity({ baseIdentity: harness.baseIdentity });
      const currentArtifact = harness.metadata.energyIq.overviewAiArtifacts.get(currentIdentity);
      expect(currentArtifact).toMatchObject({ status: "available", run_id: selected.providerRunId });
      expect(JSON.parse(currentArtifact.result_json!)).toEqual(selectedArtifact);

      const replay = await workflow.publishApprovedCandidate({
        baseIdentity: harness.baseIdentity,
        evaluationId: passed.evaluationId,
        user: harness.user,
      });
      expect(replay).toEqual(published);
      expect(runAttempt).toHaveBeenCalledTimes(3);

      await expect(workflow.publishApprovedCandidate({
        baseIdentity: createBaseIdentity("snapshot-b", "release-b"),
        evaluationId: passed.evaluationId,
        user: harness.user,
      })).rejects.toThrow(/PRESCHOOL_ADDITIONAL_EVALUATION_PUBLICATION_TARGET_STALE/);
      expect(runAttempt).toHaveBeenCalledTimes(3);
    } finally {
      harness.close();
    }
  });

  it("runs pass@3 with three independent Provider identities, no current Artifact reuse, and idempotent replay", async () => {
    const harness = createHarness();
    try {
      const calls: Array<{ runId: string; sessionId: string }> = [];
      const runAttempt = vi.fn(async ({ identity, runId, sessionId }) => {
        const persisted = harness.metadata.db.prepare(`
          SELECT record_json FROM energyiq_additional_insight_evaluations
          WHERE workspace_id = ? AND project_id = ? AND idempotency_key = ?
        `).get(identity.workspaceId, identity.projectId, "pass-at-3-key") as { record_json: string };
        const reserved = JSON.parse(persisted.record_json) as { attempts: Array<{ artifact?: unknown }> };
        expect(reserved.attempts.every(({ artifact }) => artifact !== undefined)).toBe(true);
        calls.push({ runId, sessionId });
        return artifact(identity, runId, `evidence:${calls.length}`, `finding-${calls.length}`);
      });
      const workflow = createPreschoolAdditionalAiInsightsEvaluationWorkflow({
        metadataStore: harness.metadata,
        runAttempt,
        runTransition: vi.fn(),
      });

      const first = await workflow.executePassAt3({
        baseIdentity: harness.baseIdentity,
        user: harness.user,
        idempotencyKey: "pass-at-3-key",
      });
      expect(first.status).toBe("awaiting-human-review");
      expect(runAttempt).toHaveBeenCalledTimes(3);
      expect(new Set(calls.map(({ runId }) => runId))).toHaveLength(3);
      expect(new Set(calls.map(({ sessionId }) => sessionId))).toHaveLength(3);
      expect(first.attempts.map(({ ordinal }) => ordinal)).toEqual([1, 2, 3]);
      expect(new Set(first.attempts.map(({ artifact }) => artifact.artifactId))).toHaveLength(3);
      expect(first.reviewPack.entries).toHaveLength(3);
      expect(harness.metadata.energyIq.overviewAiArtifacts.find(
        createPreschoolAdditionalAiInsightArtifactIdentity({ baseIdentity: harness.baseIdentity }),
      )).toBeUndefined();

      const replay = await workflow.executePassAt3({
        baseIdentity: harness.baseIdentity,
        user: harness.user,
        idempotencyKey: "pass-at-3-key",
      });
      expect(replay).toEqual(first);
      expect(runAttempt).toHaveBeenCalledTimes(3);
      for (const driftedBaseIdentity of [
        createBaseIdentity("snapshot-b", "release-a"),
        createBaseIdentity("snapshot-a", "release-b"),
      ]) {
        await expect(workflow.executePassAt3({
          baseIdentity: driftedBaseIdentity,
          user: harness.user,
          idempotencyKey: "pass-at-3-key",
        })).rejects.toThrow(/PRESCHOOL_ADDITIONAL_EVALUATION_IDEMPOTENCY_CONFLICT/);
      }
      expect(runAttempt).toHaveBeenCalledTimes(3);
    } finally {
      harness.close();
    }
  });

  it("keeps honest zero-discovery empty reviewable but excludes all-rejected discovery from the machine-passed review pack", async () => {
    const harness = createHarness();
    try {
      let invocation = 0;
      const runAttempt = vi.fn(async ({ identity, runId }: {
        identity: PreschoolAdditionalAiInsightArtifactIdentity;
        runId: string;
      }) => {
        invocation += 1;
        if (invocation === 1) return emptyArtifact(identity, runId, 4);
        if (invocation === 2) return emptyArtifact(identity, runId, 0);
        return artifact(identity, runId, `evidence:${runId}`, `finding-${runId}`);
      });
      const workflow = createPreschoolAdditionalAiInsightsEvaluationWorkflow({
        metadataStore: harness.metadata,
        runAttempt,
        runTransition: vi.fn(),
      });

      const result = await workflow.executePassAt3({
        baseIdentity: harness.baseIdentity,
        user: harness.user,
        idempotencyKey: "honest-empty-vs-all-rejected",
      });
      const allRejected = result.attempts.find(({ ordinal }) => ordinal === 1)!;
      const honestEmpty = result.attempts.find(({ ordinal }) => ordinal === 2)!;

      expect(allRejected).toMatchObject({ status: "completed", machineGate: { status: "failed" } });
      expect(honestEmpty).toMatchObject({ status: "completed", machineGate: { status: "passed" } });
      expect(result.reviewAudit.map(({ attemptId }) => attemptId)).not.toContain(allRejected.attemptId);
      expect(result.reviewAudit.map(({ attemptId }) => attemptId)).toContain(honestEmpty.attemptId);
      expect(result.reviewPack.entries).toHaveLength(2);
      expect(result.reviewPack.entries).toEqual(expect.arrayContaining([
        expect.objectContaining({ findings: [] }),
      ]));
    } finally {
      harness.close();
    }
  });

  it("persists one undefined structured-output root locally without retrying or collapsing sibling attempts", async () => {
    const harness = createHarness();
    try {
      let invocation = 0;
      const runAttempt = vi.fn(async ({ identity, runId }: {
        identity: PreschoolAdditionalAiInsightArtifactIdentity;
        runId: string;
      }) => {
        invocation += 1;
        if (invocation === 2) throw new Error(PRESCHOOL_ADDITIONAL_AI_STRUCTURED_OUTPUT_ROOT_INVALID);
        return artifact(identity, runId, `evidence:${invocation}`, `finding-${invocation}`);
      });
      const workflow = createPreschoolAdditionalAiInsightsEvaluationWorkflow({
        metadataStore: harness.metadata,
        runAttempt,
        runTransition: vi.fn(),
      });
      const result = await workflow.executePassAt3({
        baseIdentity: harness.baseIdentity,
        user: harness.user,
        idempotencyKey: "failure-key",
      });
      expect(runAttempt).toHaveBeenCalledTimes(3);
      expect(result.attempts).toEqual([
        expect.objectContaining({ ordinal: 1, status: "completed" }),
        expect.objectContaining({
          ordinal: 2,
          status: "failed",
          failureStage: "structured-output",
          errorCode: PRESCHOOL_ADDITIONAL_AI_STRUCTURED_OUTPUT_ROOT_INVALID,
        }),
        expect.objectContaining({ ordinal: 3, status: "completed" }),
      ]);
      expect(result.attempts[1]).toMatchObject({
        artifact: expect.objectContaining({ artifactIdentityRevision: "additional-insight-evaluation-artifact-v1" }),
      });
      expect(result.reviewPack.entries).toHaveLength(2);
    } finally {
      harness.close();
    }
  });

  it("resumes the same three reserved attempt identities after interruption without creating a fourth attempt", async () => {
    const harness = createHarness();
    try {
      const identity = createPreschoolAdditionalAiInsightArtifactIdentity({ baseIdentity: harness.baseIdentity });
      const attempts = [1, 2, 3].map((ordinal) => ({
        attemptId: `reserved-attempt-${ordinal}`,
        ordinal,
        providerRunId: `reserved-run-${ordinal}`,
        providerSessionId: `reserved-session-${ordinal}`,
      }));
      const interrupted = harness.metadata.energyIq.additionalInsightEvaluations.reserveEvaluation({
        evaluationId: "interrupted-evaluation",
        idempotencyKey: "interrupted-key",
        requestedBy: harness.user.id,
        target: evaluationTarget(identity),
        attempts,
        modelProfileSnapshot: resolveWorkspaceDefaultModelProfileSnapshot(harness.metadata),
      });
      const reservedArtifactIds = interrupted.record.attempts.map(({ artifact }) => artifact.artifactId);
      const runAttempt = vi.fn(async ({ identity, runId }: {
        identity: PreschoolAdditionalAiInsightArtifactIdentity;
        runId: string;
      }) => artifact(identity, runId, `evidence:${runId}`, `finding-${runId}`));
      const workflow = createPreschoolAdditionalAiInsightsEvaluationWorkflow({
        metadataStore: harness.metadata,
        runAttempt,
        runTransition: vi.fn(),
      });

      const recovered = await workflow.executePassAt3({
        baseIdentity: harness.baseIdentity,
        user: harness.user,
        idempotencyKey: "interrupted-key",
      });
      expect(runAttempt.mock.calls.map(([call]) => call.runId)).toEqual([
        "reserved-run-1", "reserved-run-2", "reserved-run-3",
      ]);
      expect(recovered.attempts.map(({ attemptId }) => attemptId)).toEqual([
        "reserved-attempt-1", "reserved-attempt-2", "reserved-attempt-3",
      ]);
      expect(recovered.attempts.map(({ artifact }) => artifact.artifactId)).toEqual(reservedArtifactIds);
      expect(recovered.status).toBe("awaiting-human-review");
    } finally {
      harness.close();
    }
  });

  it("restores the exact reserved Method/Profile identity before resolving current rotations", async () => {
    const harness = createHarness();
    try {
      const originalIdentity = createPreschoolAdditionalAiInsightArtifactIdentity({ baseIdentity: harness.baseIdentity });
      const originalMethodSet = resolveCurrentAdditionalAiInsightMethodSet(harness.baseIdentity.workspaceId);
      const attempts = [1, 2, 3].map((ordinal) => ({
        attemptId: `rotation-attempt-${ordinal}`,
        ordinal,
        providerRunId: `rotation-run-${ordinal}`,
        providerSessionId: `rotation-session-${ordinal}`,
      }));
      const reserved = harness.metadata.energyIq.additionalInsightEvaluations.reserveEvaluation({
        evaluationId: "rotation-evaluation",
        idempotencyKey: "rotation-key",
        requestedBy: harness.user.id,
        target: evaluationTarget(originalIdentity),
        attempts,
        runtimeIdentity: originalIdentity,
        methodResources: originalMethodSet.resources,
        modelProfileSnapshot: resolveWorkspaceDefaultModelProfileSnapshot(harness.metadata),
      });
      const originalArtifactIds = reserved.record.attempts.map(({ artifact }) => artifact.artifactId);
      const runAttempt = vi.fn(async ({ identity, runId, methodResources, modelProfileSnapshot }) => {
        expect(identity.modelProfileRevision).toBe(originalIdentity.modelProfileRevision);
        expect(identity.methodSetFingerprint).toBe(originalIdentity.methodSetFingerprint);
        expect(methodResources).toEqual(originalMethodSet.resources);
        expect(modelProfileSnapshot).toMatchObject({
          bindingRevision: originalIdentity.modelProfileRevision,
          profiles: [{ resource: { id: "profile-a", payload: { modelName: "model-a" } } }],
        });
        return artifact(identity, runId, `evidence:${runId}`, `finding-${runId}`);
      });
      const workflow = createPreschoolAdditionalAiInsightsEvaluationWorkflow({
        metadataStore: harness.metadata,
        runAttempt,
        runTransition: vi.fn(),
      });
      harness.metadata.configResources.upsert({
        id: "profile-b",
        workspace_id: "default",
        user_id: harness.user.id,
        kind: "model-profile",
        name: "Profile B",
        payload: { provider: "openai-compatible", modelName: "model-b", baseUrl: "https://profile-b.test/v1" },
        default_enabled: true,
        status: "connected",
      });
      harness.metadata.workspaceDefaultModelProfiles.set({
        workspace_id: "default",
        profile_id: "profile-b",
        profile_owner_user_id: harness.user.id,
        configured_by_user_id: harness.user.id,
        expected_revision: originalIdentity.modelProfileRevision,
      });
      const rotatedBaseIdentity = {
        ...harness.baseIdentity,
        modelProfileRevision: harness.baseIdentity.modelProfileRevision + 1,
      };
      const recovered = await workflow.executePassAt3({
        baseIdentity: rotatedBaseIdentity,
        user: harness.user,
        idempotencyKey: "rotation-key",
      });
      expect(runAttempt).toHaveBeenCalledTimes(3);
      expect(recovered.status).toBe("awaiting-human-review");
      expect(recovered.target).toEqual(evaluationTarget(originalIdentity));
      expect(recovered.attempts.map(({ artifact }) => artifact.artifactId)).toEqual(originalArtifactIds);
    } finally {
      harness.close();
    }
  });

  it("fails closed a migrated running evaluation when its historical Model Profile snapshot is unavailable", async () => {
    const harness = createHarness();
    try {
      const identity = createPreschoolAdditionalAiInsightArtifactIdentity({ baseIdentity: harness.baseIdentity });
      const methodSet = resolveCurrentAdditionalAiInsightMethodSet(harness.baseIdentity.workspaceId);
      harness.metadata.energyIq.additionalInsightEvaluations.reserveEvaluation({
        evaluationId: "legacy-running-evaluation",
        idempotencyKey: "legacy-running-evaluation-key",
        requestedBy: harness.user.id,
        target: evaluationTarget(identity),
        attempts: [1, 2, 3].map((ordinal) => ({
          attemptId: `legacy-running-attempt-${ordinal}`,
          ordinal,
          providerRunId: `legacy-running-run-${ordinal}`,
          providerSessionId: `legacy-running-session-${ordinal}`,
        })),
        runtimeIdentity: identity,
        methodResources: methodSet.resources,
      });
      const profile = harness.metadata.configResources.get({
        id: "profile-a",
        workspace_id: "default",
        user_id: harness.user.id,
        kind: "model-profile",
      });
      harness.metadata.configResources.upsert({
        id: profile.id,
        workspace_id: profile.workspace_id,
        user_id: profile.user_id,
        kind: profile.kind,
        name: profile.name,
        payload: { provider: "openai-compatible", modelName: "model-after-migration", baseUrl: "https://changed-profile.test/v1" },
        default_enabled: true,
        status: "connected",
        expected_revision: profile.revision,
      });
      expect(resolveWorkspaceDefaultModelProfileSnapshot(harness.metadata)).toMatchObject({
        bindingRevision: identity.modelProfileRevision,
        profiles: [{ resource: { revision: profile.revision + 1, payload: { modelName: "model-after-migration" } } }],
      });
      const runAttempt = vi.fn(async ({ runId }: { runId: string }) => artifact(
        identity,
        runId,
        `evidence:${runId}`,
        `finding-${runId}`,
      ));
      const workflow = createPreschoolAdditionalAiInsightsEvaluationWorkflow({
        metadataStore: harness.metadata,
        runAttempt,
        runTransition: vi.fn(),
      });

      await expect(workflow.executePassAt3({
        baseIdentity: harness.baseIdentity,
        user: harness.user,
        idempotencyKey: "legacy-running-evaluation-key",
      })).rejects.toThrow(/PRESCHOOL_ADDITIONAL_EVALUATION_RESERVED_MODEL_PROFILE_UNAVAILABLE/);
      expect(runAttempt).not.toHaveBeenCalled();
    } finally {
      harness.close();
    }
  });

  it("resumes an interrupted transition with its reserved identity after Method/Profile rotation", async () => {
    const harness = createHarness();
    try {
      const runAttempt = vi.fn(async ({ identity, runId }: {
        identity: PreschoolAdditionalAiInsightArtifactIdentity;
        runId: string;
      }) => artifact(identity, runId, `evidence:${identity.dataSnapshotId}`, `finding-${identity.dataSnapshotId}`));
      const runTransition = vi.fn(async ({ runId, sessionId }: { runId: string; sessionId: string }) => ({
        answer: changedTransitionAnswer(
          "finding-snapshot-a",
          "evidence:snapshot-a",
          "finding-snapshot-b",
          "evidence:snapshot-b",
        ),
        runId,
        sessionId,
      }));
      let generatedId = 0;
      const workflow = createPreschoolAdditionalAiInsightsEvaluationWorkflow({
        metadataStore: harness.metadata,
        runAttempt,
        runTransition,
        createId: () => `new-request-id-${generatedId += 1}`,
      });
      const previous = reviewAllPassing(harness, await workflow.executePassAt3({
        baseIdentity: harness.baseIdentity,
        user: harness.user,
        idempotencyKey: "transition-rotation-previous",
      }));
      const previousAttempt = previous.attempts.find((attempt) => attempt.status === "completed")!;
      const currentBaseIdentity = createBaseIdentity("snapshot-b", "release-b");
      const currentIdentity = createPreschoolAdditionalAiInsightArtifactIdentity({ baseIdentity: currentBaseIdentity });
      const methodSet = resolveCurrentAdditionalAiInsightMethodSet(currentBaseIdentity.workspaceId);
      harness.metadata.energyIq.additionalInsightEvaluations.reserveTransition({
        transitionId: "reserved-transition-id",
        idempotencyKey: "transition-rotation-key",
        requestedBy: harness.user.id,
        previousEvaluationId: previous.evaluationId,
        previousAttemptId: previousAttempt.attemptId,
        currentTarget: evaluationTarget(currentIdentity),
        generationProviderRunId: "reserved-transition-generation-run",
        generationProviderSessionId: "reserved-transition-generation-session",
        comparisonProviderRunId: "reserved-transition-comparison-run",
        comparisonProviderSessionId: "reserved-transition-comparison-session",
        runtimeIdentity: currentIdentity,
        methodResources: methodSet.resources,
        modelProfileSnapshot: resolveWorkspaceDefaultModelProfileSnapshot(harness.metadata),
      });
      runAttempt.mockClear();
      runTransition.mockClear();

      const recovered = await workflow.executeTransition({
        baseIdentity: { ...currentBaseIdentity, modelProfileRevision: currentBaseIdentity.modelProfileRevision + 1 },
        user: harness.user,
        idempotencyKey: "transition-rotation-key",
        previousEvaluationId: previous.evaluationId,
        previousAttemptId: previousAttempt.attemptId,
      });

      expect(recovered).toMatchObject({ status: "completed", transitionId: "reserved-transition-id" });
      expect(runAttempt).toHaveBeenCalledTimes(1);
      expect(runAttempt.mock.calls[0]![0]).toMatchObject({
        identity: currentIdentity,
        runId: "reserved-transition-generation-run",
        sessionId: "reserved-transition-generation-session",
        methodResources: methodSet.resources,
      });
      expect(runTransition).toHaveBeenCalledWith(expect.objectContaining({
        runId: "reserved-transition-comparison-run",
        sessionId: "reserved-transition-comparison-session",
      }));
    } finally {
      harness.close();
    }
  });

  it("fails closed a migrated running transition when its historical Model Profile snapshot is unavailable", async () => {
    const harness = createHarness();
    try {
      const runAttempt = vi.fn(async ({ identity, runId }: {
        identity: PreschoolAdditionalAiInsightArtifactIdentity;
        runId: string;
      }) => artifact(identity, runId, `evidence:${identity.dataSnapshotId}`, `finding-${identity.dataSnapshotId}`));
      const runTransition = vi.fn(async ({ runId, sessionId }: { runId: string; sessionId: string }) => ({
        answer: JSON.stringify({ outcomes: [{ transition: "no-material-change" }] }),
        runId,
        sessionId,
      }));
      const workflow = createPreschoolAdditionalAiInsightsEvaluationWorkflow({
        metadataStore: harness.metadata,
        runAttempt,
        runTransition,
      });
      const previous = reviewAllPassing(harness, await workflow.executePassAt3({
        baseIdentity: harness.baseIdentity,
        user: harness.user,
        idempotencyKey: "legacy-transition-previous",
      }));
      const previousAttempt = previous.attempts.find((attempt) => attempt.status === "completed")!;
      const currentBaseIdentity = createBaseIdentity("snapshot-b", "release-b");
      const currentIdentity = createPreschoolAdditionalAiInsightArtifactIdentity({ baseIdentity: currentBaseIdentity });
      const methodSet = resolveCurrentAdditionalAiInsightMethodSet(currentBaseIdentity.workspaceId);
      harness.metadata.energyIq.additionalInsightEvaluations.reserveTransition({
        transitionId: "legacy-running-transition",
        idempotencyKey: "legacy-running-transition-key",
        requestedBy: harness.user.id,
        previousEvaluationId: previous.evaluationId,
        previousAttemptId: previousAttempt.attemptId,
        currentTarget: evaluationTarget(currentIdentity),
        generationProviderRunId: "legacy-transition-generation-run",
        generationProviderSessionId: "legacy-transition-generation-session",
        comparisonProviderRunId: "legacy-transition-comparison-run",
        comparisonProviderSessionId: "legacy-transition-comparison-session",
        runtimeIdentity: currentIdentity,
        methodResources: methodSet.resources,
      });
      const profile = harness.metadata.configResources.get({
        id: "profile-a",
        workspace_id: "default",
        user_id: harness.user.id,
        kind: "model-profile",
      });
      harness.metadata.configResources.upsert({
        id: profile.id,
        workspace_id: profile.workspace_id,
        user_id: profile.user_id,
        kind: profile.kind,
        name: profile.name,
        payload: { provider: "openai-compatible", modelName: "model-after-transition-migration", baseUrl: "https://changed-transition-profile.test/v1" },
        default_enabled: true,
        status: "connected",
        expected_revision: profile.revision,
      });
      expect(resolveWorkspaceDefaultModelProfileSnapshot(harness.metadata)).toMatchObject({
        bindingRevision: currentIdentity.modelProfileRevision,
        profiles: [{ resource: { revision: profile.revision + 1, payload: { modelName: "model-after-transition-migration" } } }],
      });
      runAttempt.mockClear();
      runTransition.mockClear();

      await expect(workflow.executeTransition({
        baseIdentity: currentBaseIdentity,
        user: harness.user,
        idempotencyKey: "legacy-running-transition-key",
        previousEvaluationId: previous.evaluationId,
        previousAttemptId: previousAttempt.attemptId,
      })).rejects.toThrow(/PRESCHOOL_ADDITIONAL_EVALUATION_RESERVED_MODEL_PROFILE_UNAVAILABLE/);
      expect(runAttempt).not.toHaveBeenCalled();
      expect(runTransition).not.toHaveBeenCalled();
    } finally {
      harness.close();
    }
  });

  it("classifies a stable local schema validation failure without collapsing sibling attempts", async () => {
    const harness = createHarness();
    try {
      let invocation = 0;
      const runAttempt = vi.fn(async ({ identity, runId }: {
        identity: PreschoolAdditionalAiInsightArtifactIdentity;
        runId: string;
      }) => {
        invocation += 1;
        if (invocation === 1) throw new Error(PRESCHOOL_ADDITIONAL_AI_STRUCTURED_OUTPUT_SCHEMA_INVALID);
        return artifact(identity, runId, `evidence:${invocation}`, `finding-${invocation}`);
      });
      const workflow = createPreschoolAdditionalAiInsightsEvaluationWorkflow({
        metadataStore: harness.metadata,
        runAttempt,
        runTransition: vi.fn(),
      });

      const result = await workflow.executePassAt3({
        baseIdentity: harness.baseIdentity,
        user: harness.user,
        idempotencyKey: "schema-failure-key",
      });

      expect(runAttempt).toHaveBeenCalledTimes(3);
      expect(result.attempts).toEqual([
        expect.objectContaining({
          ordinal: 1,
          status: "failed",
          failureStage: "structured-output",
          errorCode: PRESCHOOL_ADDITIONAL_AI_STRUCTURED_OUTPUT_SCHEMA_INVALID,
        }),
        expect.objectContaining({ ordinal: 2, status: "completed" }),
        expect.objectContaining({ ordinal: 3, status: "completed" }),
      ]);
      expect(result.reviewPack.entries).toHaveLength(2);
    } finally {
      harness.close();
    }
  });

  it("normalizes a wrapped known local schema code before classifying the failed attempt", async () => {
    const harness = createHarness();
    try {
      let invocation = 0;
      const workflow = createPreschoolAdditionalAiInsightsEvaluationWorkflow({
        metadataStore: harness.metadata,
        runAttempt: vi.fn(async ({ identity, runId }) => {
          invocation += 1;
          if (invocation === 1) {
            throw new Error(`Error: ${PRESCHOOL_ADDITIONAL_AI_STRUCTURED_OUTPUT_SCHEMA_INVALID}`);
          }
          return artifact(identity, runId, `evidence:${invocation}`, `finding-${invocation}`);
        }),
        runTransition: vi.fn(),
      });

      const result = await workflow.executePassAt3({
        baseIdentity: harness.baseIdentity,
        user: harness.user,
        idempotencyKey: "wrapped-schema-failure-key",
      });

      expect(result.attempts[0]).toMatchObject({
        status: "failed",
        failureStage: "structured-output",
        errorCode: PRESCHOOL_ADDITIONAL_AI_STRUCTURED_OUTPUT_SCHEMA_INVALID,
      });
      expect(result.attempts.slice(1)).toEqual([
        expect.objectContaining({ status: "completed" }),
        expect.objectContaining({ status: "completed" }),
      ]);
    } finally {
      harness.close();
    }
  });

  it("keeps Provider structured-output capability failures classified as Provider failures", async () => {
    const harness = createHarness();
    try {
      let invocation = 0;
      const runAttempt = vi.fn(async ({ identity, runId }: {
        identity: PreschoolAdditionalAiInsightArtifactIdentity;
        runId: string;
      }) => {
        invocation += 1;
        if (invocation === 2) {
          throw new Error("Provider does not support structured_output for this model");
        }
        return artifact(identity, runId, `evidence:${runId}`, `finding:${runId}`);
      });
      const workflow = createPreschoolAdditionalAiInsightsEvaluationWorkflow({
        metadataStore: harness.metadata,
        runAttempt,
        runTransition: vi.fn(),
      });
      const result = await workflow.executePassAt3({
        baseIdentity: harness.baseIdentity,
        user: harness.user,
        idempotencyKey: "provider-structured-output-capability-key",
      });
      expect(result.attempts.find(({ ordinal }) => ordinal === 2)).toMatchObject({
        status: "failed",
        failureStage: "provider",
        errorCode: "Provider does not support structured_output for this model",
      });
    } finally {
      harness.close();
    }
  });

  it("fails closed running v5 discovery and transition reservations instead of resuming them with v6 behavior", async () => {
    const harness = createHarness();
    try {
      const runAttempt = vi.fn(async ({ identity, runId }: {
        identity: PreschoolAdditionalAiInsightArtifactIdentity;
        runId: string;
      }) => artifact(identity, runId, `evidence:${identity.dataSnapshotId}`, `finding-${identity.dataSnapshotId}`));
      const runTransition = vi.fn(async ({ runId, sessionId }: { runId: string; sessionId: string }) => ({
        answer: JSON.stringify({ outcomes: [{ transition: "no-material-change" }] }),
        runId,
        sessionId,
      }));
      const workflow = createPreschoolAdditionalAiInsightsEvaluationWorkflow({
        metadataStore: harness.metadata,
        runAttempt,
        runTransition,
      });
      const previous = reviewAllPassing(harness, await workflow.executePassAt3({
        baseIdentity: harness.baseIdentity,
        user: harness.user,
        idempotencyKey: "v3-reservation-previous",
      }));
      const previousAttempt = previous.attempts.find((attempt) => attempt.status === "completed")!;
      const currentIdentity = createPreschoolAdditionalAiInsightArtifactIdentity({ baseIdentity: harness.baseIdentity });
      const methodSet = resolveCurrentAdditionalAiInsightMethodSet(harness.baseIdentity.workspaceId);
      const modelProfileSnapshot = resolveWorkspaceDefaultModelProfileSnapshot(harness.metadata);
      harness.metadata.energyIq.additionalInsightEvaluations.reserveEvaluation({
        evaluationId: "running-v3-evaluation",
        idempotencyKey: "running-v3-evaluation-key",
        requestedBy: harness.user.id,
        target: evaluationTarget(currentIdentity),
        attempts: [1, 2, 3].map((ordinal) => ({
          attemptId: `running-v3-attempt-${ordinal}`,
          ordinal,
          providerRunId: `running-v3-run-${ordinal}`,
          providerSessionId: `running-v3-session-${ordinal}`,
        })),
        runtimeIdentity: currentIdentity,
        methodResources: methodSet.resources,
        modelProfileSnapshot,
      });
      downgradeEvaluationReservationToV5(harness.metadata.db, "running-v3-evaluation");

      const transitionBase = createBaseIdentity("snapshot-b", "release-b");
      const transitionIdentity = createPreschoolAdditionalAiInsightArtifactIdentity({ baseIdentity: transitionBase });
      harness.metadata.energyIq.additionalInsightEvaluations.reserveTransition({
        transitionId: "running-v3-transition",
        idempotencyKey: "running-v3-transition-key",
        requestedBy: harness.user.id,
        previousEvaluationId: previous.evaluationId,
        previousAttemptId: previousAttempt.attemptId,
        currentTarget: evaluationTarget(transitionIdentity),
        generationProviderRunId: "running-v3-transition-generation",
        generationProviderSessionId: "running-v3-transition-generation-session",
        comparisonProviderRunId: "running-v3-transition-comparison",
        comparisonProviderSessionId: "running-v3-transition-comparison-session",
        runtimeIdentity: transitionIdentity,
        methodResources: methodSet.resources,
        modelProfileSnapshot,
      });
      downgradeEvaluationReservationToV5(harness.metadata.db, previous.evaluationId);
      downgradeTransitionReservationToV5(harness.metadata.db, "running-v3-transition");
      runAttempt.mockClear();
      runTransition.mockClear();

      await expect(workflow.executePassAt3({
        baseIdentity: harness.baseIdentity,
        user: harness.user,
        idempotencyKey: "running-v3-evaluation-key",
      })).rejects.toThrow(/ENERGYIQ_ADDITIONAL_EVALUATION_TARGET_BEHAVIOR_NOT_CURRENT/);
      await expect(workflow.executeTransition({
        baseIdentity: transitionBase,
        user: harness.user,
        idempotencyKey: "running-v3-transition-key",
        previousEvaluationId: previous.evaluationId,
        previousAttemptId: previousAttempt.attemptId,
      })).rejects.toThrow(/ENERGYIQ_ADDITIONAL_EVALUATION_TARGET_BEHAVIOR_NOT_CURRENT/);
      expect(runAttempt).not.toHaveBeenCalled();
      expect(runTransition).not.toHaveBeenCalled();
    } finally {
      harness.close();
    }
  });

  it("keeps terminal historical evaluation and transition records readable without a Model Profile snapshot", async () => {
    const harness = createHarness();
    try {
      const runAttempt = vi.fn(async ({ identity, runId }: {
        identity: PreschoolAdditionalAiInsightArtifactIdentity;
        runId: string;
      }) => artifact(identity, runId, `evidence:${identity.dataSnapshotId}`, `finding-${identity.dataSnapshotId}`));
      const runTransition = vi.fn(async ({ runId, sessionId }: { runId: string; sessionId: string }) => ({
        answer: changedTransitionAnswer(
          "finding-snapshot-a",
          "evidence:snapshot-a",
          "finding-snapshot-b",
          "evidence:snapshot-b",
        ),
        runId,
        sessionId,
      }));
      const workflow = createPreschoolAdditionalAiInsightsEvaluationWorkflow({
        metadataStore: harness.metadata,
        runAttempt,
        runTransition,
      });
      const previous = reviewAllPassing(harness, await workflow.executePassAt3({
        baseIdentity: harness.baseIdentity,
        user: harness.user,
        idempotencyKey: "terminal-historical-evaluation",
      }));
      const previousAttempt = previous.attempts.find((attempt) => attempt.status === "completed")!;
      const currentBaseIdentity = createBaseIdentity("snapshot-b", "release-b");
      const transition = await workflow.executeTransition({
        baseIdentity: currentBaseIdentity,
        user: harness.user,
        idempotencyKey: "terminal-historical-transition",
        previousEvaluationId: previous.evaluationId,
        previousAttemptId: previousAttempt.attemptId,
      });
      const removeSnapshot = (table: string, id: string): void => {
        const row = harness.metadata.db.prepare(`SELECT reservation_json FROM ${table} WHERE id = ?`).get(id) as {
          reservation_json: string;
        };
        const reservation = JSON.parse(row.reservation_json) as Record<string, unknown>;
        delete reservation.modelProfileSnapshot;
        harness.metadata.db.prepare(`UPDATE ${table} SET reservation_json = ? WHERE id = ?`)
          .run(JSON.stringify(reservation), id);
      };
      removeSnapshot("energyiq_additional_insight_evaluations", previous.evaluationId);
      removeSnapshot("energyiq_additional_insight_transitions", transition.transitionId);
      const profile = harness.metadata.configResources.get({
        id: "profile-a",
        workspace_id: "default",
        user_id: harness.user.id,
        kind: "model-profile",
      });
      harness.metadata.configResources.upsert({
        id: profile.id,
        workspace_id: profile.workspace_id,
        user_id: profile.user_id,
        kind: profile.kind,
        name: profile.name,
        payload: { provider: "openai-compatible", modelName: "model-after-terminal", baseUrl: "https://changed-terminal-profile.test/v1" },
        default_enabled: true,
        status: "connected",
        expected_revision: profile.revision,
      });
      runAttempt.mockClear();
      runTransition.mockClear();

      expect(await workflow.executePassAt3({
        baseIdentity: harness.baseIdentity,
        user: harness.user,
        idempotencyKey: "terminal-historical-evaluation",
      })).toEqual(previous);
      await expect(workflow.executeTransition({
        baseIdentity: currentBaseIdentity,
        user: harness.user,
        idempotencyKey: "terminal-historical-transition",
        previousEvaluationId: previous.evaluationId,
        previousAttemptId: "different-previous-attempt",
      })).rejects.toThrow(/ENERGYIQ_ADDITIONAL_TRANSITION_IDEMPOTENCY_CONFLICT/);
      expect(await workflow.executeTransition({
        baseIdentity: currentBaseIdentity,
        user: harness.user,
        idempotencyKey: "terminal-historical-transition",
        previousEvaluationId: previous.evaluationId,
        previousAttemptId: previousAttempt.attemptId,
      })).toEqual(transition);
      expect(runAttempt).not.toHaveBeenCalled();
      expect(runTransition).not.toHaveBeenCalled();
    } finally {
      harness.close();
    }
  });

  it("rejects No material change when A and B both contain Findings instead of silently dropping changes", async () => {
    const harness = createHarness();
    try {
      const runAttempt = vi.fn(async ({ identity, runId }: {
        identity: PreschoolAdditionalAiInsightArtifactIdentity;
        runId: string;
      }) => artifact(
        identity,
        runId,
        identity.dataSnapshotId === "snapshot-a" ? "evidence:a:1" : "evidence:b:1",
        identity.dataSnapshotId === "snapshot-a" ? "finding-a" : "finding-b",
      ));
      const runTransition = vi.fn(async ({ runId, sessionId }: { runId: string; sessionId: string }) => ({
        answer: JSON.stringify({ outcomes: [{ transition: "no-material-change" }] }),
        runId,
        sessionId,
      }));
      const workflow = createPreschoolAdditionalAiInsightsEvaluationWorkflow({
        metadataStore: harness.metadata,
        runAttempt,
        runTransition,
      });
      const previous = await workflow.executePassAt3({
        baseIdentity: harness.baseIdentity,
        user: harness.user,
        idempotencyKey: "snapshot-a-evaluation",
      });
      const reviewedPrevious = reviewAllPassing(harness, previous);
      const previousAttempt = reviewedPrevious.attempts[0]!;
      if (previousAttempt.status !== "completed") throw new Error("test fixture expected completed attempt");

      const currentBaseIdentity = createBaseIdentity("snapshot-b", "release-b");
      const transition = await workflow.executeTransition({
        baseIdentity: currentBaseIdentity,
        user: harness.user,
        idempotencyKey: "snapshot-a-to-b",
        previousEvaluationId: reviewedPrevious.evaluationId,
        previousAttemptId: previousAttempt.attemptId,
      });
      expect(transition).toMatchObject({
        status: "failed",
        previousTarget: { dataSnapshotId: "snapshot-a" },
        currentTarget: { dataSnapshotId: "snapshot-b" },
        failureStage: "validation",
        errorCode: "PRESCHOOL_ADDITIONAL_TRANSITION_RESULT_INCOMPLETE",
      });
      expect(runAttempt).toHaveBeenCalledTimes(4);
      expect(runTransition).toHaveBeenCalledTimes(1);
      const transitionInput = runTransition.mock.calls[0]![0] as { prompt: string; runId: string; sessionId: string };
      expect(transitionInput.prompt).toContain("evidence:a:1");
      expect(transitionInput.prompt).toContain("evidence:b:1");
      expect(transitionInput.prompt).toContain("Evidence-bound");
      expect(transitionInput.prompt).toContain("every Snapshot A Finding and every Snapshot B Finding exactly once");
      expect(transitionInput.prompt).toContain("only when both Snapshots contain zero Findings");
      expect(transitionInput.prompt).not.toMatch(/What-Why-Action|fixed lens/i);
      expect(transition.generationProviderRunId).not.toBe(transition.comparisonProviderRunId);
      expect(await workflow.executeTransition({
        baseIdentity: currentBaseIdentity,
        user: harness.user,
        idempotencyKey: "snapshot-a-to-b",
        previousEvaluationId: reviewedPrevious.evaluationId,
        previousAttemptId: previousAttempt.attemptId,
      })).toEqual(transition);
      for (const driftedBaseIdentity of [
        createBaseIdentity("snapshot-c", "release-b"),
        createBaseIdentity("snapshot-b", "release-c"),
      ]) {
        await expect(workflow.executeTransition({
          baseIdentity: driftedBaseIdentity,
          user: harness.user,
          idempotencyKey: "snapshot-a-to-b",
          previousEvaluationId: reviewedPrevious.evaluationId,
          previousAttemptId: previousAttempt.attemptId,
        })).rejects.toThrow(/ENERGYIQ_ADDITIONAL_TRANSITION_IDEMPOTENCY_CONFLICT/);
      }
      expect(runAttempt).toHaveBeenCalledTimes(4);
      expect(runTransition).toHaveBeenCalledTimes(1);
    } finally {
      harness.close();
    }
  });

  it("accepts No material change only when both Snapshot artifacts contain no Findings", async () => {
    const harness = createHarness();
    try {
      const runAttempt = vi.fn(async ({ identity, runId }: {
        identity: PreschoolAdditionalAiInsightArtifactIdentity;
        runId: string;
      }) => emptyArtifact(identity, runId, 0));
      const workflow = createPreschoolAdditionalAiInsightsEvaluationWorkflow({
        metadataStore: harness.metadata,
        runAttempt,
        runTransition: vi.fn(async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ outcomes: [{ transition: "no-material-change" }] }),
          runId,
          sessionId,
        })),
      });
      const previous = reviewAllPassing(harness, await workflow.executePassAt3({
        baseIdentity: harness.baseIdentity,
        user: harness.user,
        idempotencyKey: "empty-a-evaluation",
      }));
      const previousAttempt = previous.attempts.find((attempt) => attempt.status === "completed")!;

      await expect(workflow.executeTransition({
        baseIdentity: createBaseIdentity("snapshot-b", "release-b"),
        user: harness.user,
        idempotencyKey: "empty-a-to-empty-b",
        previousEvaluationId: previous.evaluationId,
        previousAttemptId: previousAttempt.attemptId,
      })).resolves.toMatchObject({
        status: "completed",
        outcomes: [{ transition: "no-material-change" }],
      });
    } finally {
      harness.close();
    }
  });

  it("rejects duplicate transition coverage that omits another A and B Finding", async () => {
    const harness = createHarness();
    try {
      const runAttempt = vi.fn(async ({ identity, runId }: {
        identity: PreschoolAdditionalAiInsightArtifactIdentity;
        runId: string;
      }) => artifactWithTwoFindings(identity, runId, identity.dataSnapshotId));
      const workflow = createPreschoolAdditionalAiInsightsEvaluationWorkflow({
        metadataStore: harness.metadata,
        runAttempt,
        runTransition: vi.fn(async ({ runId, sessionId }) => ({
          answer: JSON.stringify({
            outcomes: [1, 2].map(() => ({
              transition: "changed",
              previousFindingId: "snapshot-a:finding:1",
              previousEvidenceRefs: ["snapshot-a:evidence:1"],
              currentFindingId: "snapshot-b:finding:1",
              currentEvidenceRefs: ["snapshot-b:evidence:1"],
            })),
          }),
          runId,
          sessionId,
        })),
      });
      const previous = reviewAllPassing(harness, await workflow.executePassAt3({
        baseIdentity: harness.baseIdentity,
        user: harness.user,
        idempotencyKey: "duplicate-coverage-a",
      }));
      const previousAttempt = previous.attempts.find((attempt) => attempt.status === "completed")!;

      await expect(workflow.executeTransition({
        baseIdentity: createBaseIdentity("snapshot-b", "release-b"),
        user: harness.user,
        idempotencyKey: "duplicate-coverage-a-b",
        previousEvaluationId: previous.evaluationId,
        previousAttemptId: previousAttempt.attemptId,
      })).resolves.toMatchObject({
        status: "failed",
        failureStage: "validation",
        errorCode: "PRESCHOOL_ADDITIONAL_TRANSITION_RESULT_INCOMPLETE",
      });
    } finally {
      harness.close();
    }
  });

  it("rejects duplicate Evidence refs that omit another cited Evidence item", async () => {
    const harness = createHarness();
    try {
      const runAttempt = vi.fn(async ({ identity, runId }: {
        identity: PreschoolAdditionalAiInsightArtifactIdentity;
        runId: string;
      }) => artifactWithTwoEvidenceRefs(identity, runId, identity.dataSnapshotId));
      const workflow = createPreschoolAdditionalAiInsightsEvaluationWorkflow({
        metadataStore: harness.metadata,
        runAttempt,
        runTransition: vi.fn(async ({ runId, sessionId }) => ({
          answer: JSON.stringify({
            outcomes: [{
              transition: "changed",
              previousFindingId: "snapshot-a:finding",
              previousEvidenceRefs: ["snapshot-a:evidence:1", "snapshot-a:evidence:1"],
              currentFindingId: "snapshot-b:finding",
              currentEvidenceRefs: ["snapshot-b:evidence:1", "snapshot-b:evidence:2"],
            }],
          }),
          runId,
          sessionId,
        })),
      });
      const previous = reviewAllPassing(harness, await workflow.executePassAt3({
        baseIdentity: harness.baseIdentity,
        user: harness.user,
        idempotencyKey: "duplicate-evidence-a",
      }));
      const previousAttempt = previous.attempts.find((attempt) => attempt.status === "completed")!;

      await expect(workflow.executeTransition({
        baseIdentity: createBaseIdentity("snapshot-b", "release-b"),
        user: harness.user,
        idempotencyKey: "duplicate-evidence-a-b",
        previousEvaluationId: previous.evaluationId,
        previousAttemptId: previousAttempt.attemptId,
      })).resolves.toMatchObject({
        status: "failed",
        failureStage: "validation",
        errorCode: "PRESCHOOL_ADDITIONAL_TRANSITION_RESULT_INVALID",
      });
    } finally {
      harness.close();
    }
  });

  it("allows stable Snapshot-bound fact IDs and rejects unsupported A numbers in B", async () => {
    const harness = createHarness();
    try {
      const runAttempt = vi.fn(async ({ identity, runId }: {
        identity: PreschoolAdditionalAiInsightArtifactIdentity;
        runId: string;
      }) => artifact(identity, runId, "analysis.summary.usage_kwh", identity.dataSnapshotId === "snapshot-a" ? "finding-a" : "finding-b"));
      const runTransition = vi.fn(async ({ runId, sessionId }: { runId: string; sessionId: string }) => ({
        answer: JSON.stringify({
          outcomes: [{
            transition: "changed",
            previousFindingId: "finding-a",
            previousEvidenceRefs: ["analysis.summary.usage_kwh"],
            currentFindingId: "finding-b",
            currentEvidenceRefs: ["analysis.summary.usage_kwh"],
          }],
        }),
        runId,
        sessionId,
      }));
      const workflow = createPreschoolAdditionalAiInsightsEvaluationWorkflow({
        metadataStore: harness.metadata,
        runAttempt,
        runTransition,
      });
      const previous = await workflow.executePassAt3({
        baseIdentity: harness.baseIdentity,
        user: harness.user,
        idempotencyKey: "snapshot-a-evaluation",
      });
      const reviewedPrevious = reviewAllPassing(harness, previous);
      const previousAttempt = reviewedPrevious.attempts[0]!;
      if (previousAttempt.status !== "completed") throw new Error("test fixture expected completed attempt");
      const request = {
        baseIdentity: createBaseIdentity("snapshot-b", "release-b"),
        user: harness.user,
        idempotencyKey: "snapshot-a-to-b-invalid",
        previousEvaluationId: reviewedPrevious.evaluationId,
        previousAttemptId: previousAttempt.attemptId,
      };
      const changed = await workflow.executeTransition(request);
      expect(changed).toMatchObject({
        status: "completed",
        outcomes: [{ transition: "changed" }],
      });
      expect(runTransition).toHaveBeenCalledTimes(1);
      expect(runAttempt).toHaveBeenCalledTimes(4);

      const replay = await workflow.executeTransition(request);
      expect(replay).toEqual(changed);
      expect(runAttempt).toHaveBeenCalledTimes(4);
      expect(runTransition).toHaveBeenCalledTimes(1);
    } finally {
      harness.close();
    }
  });

  it("uses DB claims so concurrent idempotent requests execute each Provider stage once", async () => {
    const harness = createHarness();
    try {
      const runAttempt = vi.fn(async ({ identity, runId }: {
        identity: PreschoolAdditionalAiInsightArtifactIdentity;
        runId: string;
      }) => {
        await Promise.resolve();
        return artifact(identity, runId, "analysis.summary.usage_kwh", `finding-${identity.dataSnapshotId}`);
      });
      const runTransition = vi.fn(async ({ runId, sessionId }: { runId: string; sessionId: string }) => {
        await Promise.resolve();
        return {
          answer: changedTransitionAnswer(
            "finding-snapshot-a",
            "analysis.summary.usage_kwh",
            "finding-snapshot-b",
            "analysis.summary.usage_kwh",
          ),
          runId,
          sessionId,
        };
      });
      const workflow = createPreschoolAdditionalAiInsightsEvaluationWorkflow({
        metadataStore: harness.metadata,
        runAttempt,
        runTransition,
      });
      const evaluationInput = {
        baseIdentity: harness.baseIdentity,
        user: harness.user,
        idempotencyKey: "concurrent-pass-at-3",
      };
      const evaluations = await Promise.all([
        workflow.executePassAt3(evaluationInput),
        workflow.executePassAt3(evaluationInput),
      ]);
      expect(runAttempt).toHaveBeenCalledTimes(3);
      expect(new Set(evaluations.map(({ evaluationId }) => evaluationId))).toHaveLength(1);
      const reviewed = reviewAllPassing(harness, harness.metadata.energyIq.additionalInsightEvaluations.getEvaluation({
        evaluationId: evaluations[0]!.evaluationId,
        expectedWorkspaceId: "workspace-1",
        expectedProjectId: "project-1",
      }));
      const previousAttempt = reviewed.attempts.find((attempt) => attempt.status === "completed")!;
      const transitionInput = {
        baseIdentity: createBaseIdentity("snapshot-b", "release-b"),
        user: harness.user,
        idempotencyKey: "concurrent-transition",
        previousEvaluationId: reviewed.evaluationId,
        previousAttemptId: previousAttempt.attemptId,
      };
      const transitions = await Promise.all([
        workflow.executeTransition(transitionInput),
        workflow.executeTransition(transitionInput),
      ]);
      expect(transitions[0]).toMatchObject({ status: "completed", outcomes: [{ transition: "changed" }] });
      expect(runAttempt).toHaveBeenCalledTimes(4);
      expect(runTransition).toHaveBeenCalledTimes(1);
      expect(new Set(transitions.map(({ transitionId }) => transitionId))).toHaveLength(1);
    } finally {
      harness.close();
    }
  });

  it("heartbeats long Provider claims so Promise.all replays do not duplicate attempts or transition stages", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-14T00:00:00.000Z"));
    const harness = createHarness();
    try {
      const pendingAttempts = new Map<string, () => void>();
      const runAttempt = vi.fn(({ identity, runId }: {
        identity: PreschoolAdditionalAiInsightArtifactIdentity;
        runId: string;
      }) => new Promise<AdditionalAiInsightsArtifact>((resolve) => {
        pendingAttempts.set(runId, () => {
          pendingAttempts.delete(runId);
          resolve(artifact(identity, runId, "analysis.summary.usage_kwh", `finding-${identity.dataSnapshotId}`));
        });
      }));
      let resolveComparison: (() => void) | undefined;
      const runTransition = vi.fn(({ runId, sessionId }: { runId: string; sessionId: string }) => (
        new Promise<{ answer: string; runId: string; sessionId: string }>((resolve) => {
          resolveComparison = () => resolve({
            answer: changedTransitionAnswer(
              "finding-snapshot-a",
              "analysis.summary.usage_kwh",
              "finding-snapshot-b",
              "analysis.summary.usage_kwh",
            ),
            runId,
            sessionId,
          });
        })
      ));
      const workflow = createPreschoolAdditionalAiInsightsEvaluationWorkflow({
        metadataStore: harness.metadata,
        runAttempt,
        runTransition,
      });
      const evaluationInput = {
        baseIdentity: harness.baseIdentity,
        user: harness.user,
        idempotencyKey: "long-running-evaluation",
      };
      const firstEvaluation = workflow.executePassAt3(evaluationInput);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(6 * 60_000);
      const secondEvaluation = workflow.executePassAt3(evaluationInput);
      await vi.advanceTimersByTimeAsync(0);
      expect(runAttempt.mock.calls.map(([call]) => call.runId)).toEqual([
        expect.any(String),
        expect.any(String),
      ]);
      expect(new Set(runAttempt.mock.calls.map(([call]) => call.runId))).toHaveLength(2);
      for (const release of [...pendingAttempts.values()]) release();
      await vi.advanceTimersByTimeAsync(0);
      for (const release of [...pendingAttempts.values()]) release();
      await vi.advanceTimersByTimeAsync(0);
      const evaluations = await Promise.all([firstEvaluation, secondEvaluation]);
      expect(runAttempt).toHaveBeenCalledTimes(3);
      expect(new Set(runAttempt.mock.calls.map(([call]) => call.runId))).toHaveLength(3);

      const reviewed = reviewAllPassing(harness, evaluations.find(({ status }) => status === "awaiting-human-review")!);
      const previousAttempt = reviewed.attempts.find((attempt) => attempt.status === "completed")!;
      const transitionInput = {
        baseIdentity: createBaseIdentity("snapshot-b", "release-b"),
        user: harness.user,
        idempotencyKey: "long-running-transition",
        previousEvaluationId: reviewed.evaluationId,
        previousAttemptId: previousAttempt.attemptId,
      };
      const firstTransition = workflow.executeTransition(transitionInput);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(6 * 60_000);
      const transitionReplayDuringGeneration = workflow.executeTransition(transitionInput);
      await vi.advanceTimersByTimeAsync(0);
      expect(runAttempt).toHaveBeenCalledTimes(4);
      for (const release of [...pendingAttempts.values()]) release();
      await vi.advanceTimersByTimeAsync(0);
      expect(runTransition).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(6 * 60_000);
      const transitionReplayDuringComparison = workflow.executeTransition(transitionInput);
      await vi.advanceTimersByTimeAsync(0);
      expect(runTransition).toHaveBeenCalledTimes(1);
      resolveComparison?.();
      await vi.advanceTimersByTimeAsync(0);
      const transitions = await Promise.all([
        firstTransition,
        transitionReplayDuringGeneration,
        transitionReplayDuringComparison,
      ]);
      expect(transitions[0]).toMatchObject({ status: "completed" });
      expect(runAttempt).toHaveBeenCalledTimes(4);
      expect(runTransition).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
      harness.close();
    }
  });

  it("waits on a persisted active Provider run after lease takeover and resumes the same run identity", async () => {
    const harness = createHarness();
    try {
      const identity = createPreschoolAdditionalAiInsightArtifactIdentity({ baseIdentity: harness.baseIdentity });
      const methodSet = resolveCurrentAdditionalAiInsightMethodSet(harness.baseIdentity.workspaceId);
      const attempts = [1, 2, 3].map((ordinal) => ({
        attemptId: `fenced-attempt-${ordinal}`,
        ordinal,
        providerRunId: `fenced-run-${ordinal}`,
        providerSessionId: `fenced-session-${ordinal}`,
      }));
      harness.metadata.energyIq.additionalInsightEvaluations.reserveEvaluation({
        evaluationId: "fenced-evaluation",
        idempotencyKey: "fenced-evaluation-key",
        requestedBy: harness.user.id,
        target: evaluationTarget(identity),
        attempts,
        runtimeIdentity: identity,
        methodResources: methodSet.resources,
        modelProfileSnapshot: resolveWorkspaceDefaultModelProfileSnapshot(harness.metadata),
      });
      harness.metadata.sessions.create({
        user_id: harness.user.id,
        id: attempts[0]!.providerSessionId,
        workspace_id: identity.workspaceId,
        project_id: identity.projectId,
      });
      harness.metadata.runs.create({
        user_id: harness.user.id,
        id: attempts[0]!.providerRunId,
        session_id: attempts[0]!.providerSessionId,
        request_fingerprint: "server-owned-fingerprint",
        user_input: "reserved evaluation attempt",
        status: "running",
        model_name: "model-a",
      });
      const runAttempt = vi.fn(async ({ identity: attemptIdentity, runId }) => (
        artifact(
          attemptIdentity,
          runId,
          `evidence:${attemptIdentity.dataSnapshotId}`,
          `finding-${attemptIdentity.dataSnapshotId}`,
        )
      ));
      const runTransition = vi.fn(async ({ runId, sessionId }) => ({
        answer: changedTransitionAnswer(
          "finding-snapshot-a",
          "evidence:snapshot-a",
          "finding-snapshot-b",
          "evidence:snapshot-b",
        ),
        runId,
        sessionId,
      }));
      const workflow = createPreschoolAdditionalAiInsightsEvaluationWorkflow({
        metadataStore: harness.metadata,
        runAttempt,
        runTransition,
      });
      const request = {
        baseIdentity: harness.baseIdentity,
        user: harness.user,
        idempotencyKey: "fenced-evaluation-key",
      };
      const waiting = await workflow.executePassAt3(request);
      expect(waiting.status).toBe("running");
      expect(runAttempt.mock.calls.map(([call]) => call.runId)).toEqual(["fenced-run-2", "fenced-run-3"]);

      harness.metadata.runs.updateStatus({
        user_id: harness.user.id,
        run_id: "fenced-run-1",
        status: "completed",
      });
      harness.metadata.db.prepare(`
        DELETE FROM energyiq_additional_insight_evaluation_claims
        WHERE evaluation_id = ? AND attempt_id = ?
      `).run("fenced-evaluation", "fenced-attempt-1");
      const recovered = await workflow.executePassAt3(request);
      expect(recovered.status).toBe("awaiting-human-review");
      expect(runAttempt.mock.calls.map(([call]) => call.runId)).toEqual([
        "fenced-run-2", "fenced-run-3", "fenced-run-1",
      ]);
      expect(new Set(recovered.attempts.map(({ providerRunId }) => providerRunId))).toHaveLength(3);

      const previous = reviewAllPassing(harness, recovered);
      const previousAttempt = previous.attempts.find((attempt) => attempt.status === "completed")!;
      const nextBaseIdentity = createBaseIdentity("snapshot-b", "release-b");
      const nextIdentity = createPreschoolAdditionalAiInsightArtifactIdentity({ baseIdentity: nextBaseIdentity });
      harness.metadata.energyIq.additionalInsightEvaluations.reserveTransition({
        transitionId: "fenced-transition",
        idempotencyKey: "fenced-transition-key",
        requestedBy: harness.user.id,
        previousEvaluationId: previous.evaluationId,
        previousAttemptId: previousAttempt.attemptId,
        currentTarget: evaluationTarget(nextIdentity),
        generationProviderRunId: "fenced-transition-generation",
        generationProviderSessionId: "fenced-transition-generation-session",
        comparisonProviderRunId: "fenced-transition-comparison",
        comparisonProviderSessionId: "fenced-transition-comparison-session",
        runtimeIdentity: nextIdentity,
        methodResources: methodSet.resources,
        modelProfileSnapshot: resolveWorkspaceDefaultModelProfileSnapshot(harness.metadata),
      });
      harness.metadata.sessions.create({
        user_id: harness.user.id,
        id: "fenced-transition-generation-session",
        workspace_id: nextIdentity.workspaceId,
        project_id: nextIdentity.projectId,
      });
      harness.metadata.runs.create({
        user_id: harness.user.id,
        id: "fenced-transition-generation",
        session_id: "fenced-transition-generation-session",
        request_fingerprint: "server-owned-transition-fingerprint",
        user_input: "reserved transition generation",
        status: "running",
        model_name: "model-a",
      });
      runAttempt.mockClear();
      const transitionRequest = {
        baseIdentity: nextBaseIdentity,
        user: harness.user,
        idempotencyKey: "fenced-transition-key",
        previousEvaluationId: previous.evaluationId,
        previousAttemptId: previousAttempt.attemptId,
      };
      expect(await workflow.executeTransition(transitionRequest)).toMatchObject({ status: "running" });
      expect(runAttempt).not.toHaveBeenCalled();
      expect(runTransition).not.toHaveBeenCalled();

      harness.metadata.runs.updateStatus({
        user_id: harness.user.id,
        run_id: "fenced-transition-generation",
        status: "completed",
      });
      harness.metadata.db.prepare(`
        DELETE FROM energyiq_additional_insight_transition_claims WHERE transition_id = ?
      `).run("fenced-transition");
      expect(await workflow.executeTransition(transitionRequest)).toMatchObject({ status: "completed" });
      expect(runAttempt).toHaveBeenCalledTimes(1);
      expect(runTransition).toHaveBeenCalledTimes(1);
    } finally {
      harness.close();
    }
  });

  it("rejects unsupported A numbers and malformed B lineage before comparison", async () => {
    const harness = createHarness();
    try {
      let invalidCurrentLineage = false;
      const runAttempt = vi.fn(async ({ identity, runId }: {
        identity: PreschoolAdditionalAiInsightArtifactIdentity;
        runId: string;
      }) => {
        const value = artifact(identity, runId, "analysis.summary.usage_kwh", identity.dataSnapshotId === "snapshot-a"
          ? "finding-a"
          : "finding-b");
        if (identity.dataSnapshotId === "snapshot-b") {
          if (invalidCurrentLineage) value.findings[0]!.evidenceRefs = ["analysis.summary.forged"];
          else value.findings[0]!.text = "The old 10 kWh value still applies.";
        }
        return value;
      });
      const runTransition = vi.fn();
      const workflow = createPreschoolAdditionalAiInsightsEvaluationWorkflow({
        metadataStore: harness.metadata,
        runAttempt,
        runTransition,
      });
      const previous = reviewAllPassing(harness, await workflow.executePassAt3({
        baseIdentity: harness.baseIdentity,
        user: harness.user,
        idempotencyKey: "snapshot-a-number-evaluation",
      }));
      const previousAttempt = previous.attempts.find((attempt) => attempt.status === "completed")!;
      const leakedNumber = await workflow.executeTransition({
        baseIdentity: createBaseIdentity("snapshot-b", "release-b"),
        user: harness.user,
        idempotencyKey: "snapshot-number-leak",
        previousEvaluationId: previous.evaluationId,
        previousAttemptId: previousAttempt.attemptId,
      });
      expect(leakedNumber).toMatchObject({
        status: "failed",
        failureStage: "validation",
        errorCode: "PRESCHOOL_ADDITIONAL_TRANSITION_REUSES_PREVIOUS_NUMBER",
      });
      expect(runTransition).not.toHaveBeenCalled();

      invalidCurrentLineage = true;
      const forged = await workflow.executeTransition({
        baseIdentity: createBaseIdentity("snapshot-b", "release-b"),
        user: harness.user,
        idempotencyKey: "snapshot-forged-lineage",
        previousEvaluationId: previous.evaluationId,
        previousAttemptId: previousAttempt.attemptId,
      });
      expect(forged).toMatchObject({
        status: "failed",
        failureStage: "validation",
        errorCode: "PRESCHOOL_ADDITIONAL_TRANSITION_CURRENT_ARTIFACT_INVALID",
      });
      expect(runTransition).not.toHaveBeenCalled();
    } finally {
      harness.close();
    }
  });

  it("normalizes lineage-bound numbers, scans all Finding fields, and allows unrelated B facts", async () => {
    const harness = createHarness();
    try {
      let mode: "supported" | "unrelated" = "supported";
      const runAttempt = vi.fn(async ({ identity, runId }: {
        identity: PreschoolAdditionalAiInsightArtifactIdentity;
        runId: string;
      }) => {
        const value = artifact(identity, runId, "analysis.summary.usage_kwh", identity.dataSnapshotId === "snapshot-a"
          ? "finding-a"
          : "finding-b");
        const primaryFact = value.evidenceLineage.facts[0]!;
        if (!("value" in primaryFact)) throw new Error("test fixture expected value fact");
        primaryFact.value = identity.dataSnapshotId === "snapshot-a" ? 1000 : mode === "supported" ? 1000 : 1200;
        if (identity.dataSnapshotId === "snapshot-b") {
          value.evidenceLineage.facts.push({
            ...value.evidenceLineage.facts[0]!,
            id: "analysis.unrelated.same_number",
            value: 1000,
          });
          value.findings[0]!.title = "1,000.0 kWh remains material";
          value.findings[0]!.text = "The supported value is 1 000e0 kWh.";
          value.findings[0]!.deepDiveQuestion = "Should we verify 1\u202f000.00 kWh again?";
        }
        return value;
      });
      const workflow = createPreschoolAdditionalAiInsightsEvaluationWorkflow({
        metadataStore: harness.metadata,
        runAttempt,
        runTransition: vi.fn(async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ outcomes: [{ transition: "still-supported", previousFindingId: "finding-a", previousEvidenceRefs: ["analysis.summary.usage_kwh"], currentFindingId: "finding-b", currentEvidenceRefs: ["analysis.summary.usage_kwh"] }] }),
          runId,
          sessionId,
        })),
      });
      const previous = reviewAllPassing(harness, await workflow.executePassAt3({
        baseIdentity: harness.baseIdentity,
        user: harness.user,
        idempotencyKey: "numeric-lineage-a",
      }));
      const previousAttempt = previous.attempts.find((attempt) => attempt.status === "completed")!;
      const supported = await workflow.executeTransition({
        baseIdentity: createBaseIdentity("snapshot-b", "release-b"),
        user: harness.user,
        idempotencyKey: "numeric-lineage-supported",
        previousEvaluationId: previous.evaluationId,
        previousAttemptId: previousAttempt.attemptId,
      });
      expect(supported.status).toBe("completed");

      mode = "unrelated";
      const unrelated = await workflow.executeTransition({
        baseIdentity: createBaseIdentity("snapshot-b", "release-b"),
        user: harness.user,
        idempotencyKey: "numeric-lineage-unrelated",
        previousEvaluationId: previous.evaluationId,
        previousAttemptId: previousAttempt.attemptId,
      });
      expect(unrelated).toMatchObject({
        status: "failed",
        errorCode: "PRESCHOOL_ADDITIONAL_TRANSITION_REUSES_PREVIOUS_NUMBER",
      });
    } finally {
      harness.close();
    }
  });

  it("rejects a partial Resolved outcome that leaves a current B Finding unclassified", async () => {
    const harness = createHarness();
    try {
      const runAttempt = vi.fn(async ({ identity, runId }: { identity: PreschoolAdditionalAiInsightArtifactIdentity; runId: string }) => (
        artifact(identity, runId, identity.dataSnapshotId === "snapshot-a" ? "evidence:a" : "evidence:b", identity.dataSnapshotId === "snapshot-a" ? "finding-a" : "finding-b")
      ));
      const workflow = createPreschoolAdditionalAiInsightsEvaluationWorkflow({
        metadataStore: harness.metadata,
        runAttempt,
        runTransition: vi.fn(async ({ runId, sessionId }) => ({
          answer: JSON.stringify({ outcomes: [{ transition: "resolved", previousFindingId: "finding-a", previousEvidenceRefs: ["evidence:a"] }] }),
          runId,
          sessionId,
        })),
      });
      const previous = reviewAllPassing(harness, await workflow.executePassAt3({
        baseIdentity: harness.baseIdentity,
        user: harness.user,
        idempotencyKey: "resolved-a",
      }));
      const previousAttempt = previous.attempts.find((attempt) => attempt.status === "completed")!;
      const resolved = await workflow.executeTransition({
        baseIdentity: createBaseIdentity("snapshot-b", "release-b"),
        user: harness.user,
        idempotencyKey: "resolved-a-b",
        previousEvaluationId: previous.evaluationId,
        previousAttemptId: previousAttempt.attemptId,
      });
      expect(resolved).toMatchObject({
        status: "failed",
        failureStage: "validation",
        errorCode: "PRESCHOOL_ADDITIONAL_TRANSITION_RESULT_INCOMPLETE",
      });
    } finally {
      harness.close();
    }
  });

  it("accepts Resolved when the disappeared A Finding exhausts the comparison and B is empty", async () => {
    const harness = createHarness();
    try {
      const runAttempt = vi.fn(async ({ identity, runId }: {
        identity: PreschoolAdditionalAiInsightArtifactIdentity;
        runId: string;
      }) => identity.dataSnapshotId === "snapshot-a"
        ? artifact(identity, runId, "evidence:a", "finding-a")
        : emptyArtifact(identity, runId, 0));
      const workflow = createPreschoolAdditionalAiInsightsEvaluationWorkflow({
        metadataStore: harness.metadata,
        runAttempt,
        runTransition: vi.fn(async ({ runId, sessionId }) => ({
          answer: JSON.stringify({
            outcomes: [{
              transition: "resolved",
              previousFindingId: "finding-a",
              previousEvidenceRefs: ["evidence:a"],
            }],
          }),
          runId,
          sessionId,
        })),
      });
      const previous = reviewAllPassing(harness, await workflow.executePassAt3({
        baseIdentity: harness.baseIdentity,
        user: harness.user,
        idempotencyKey: "resolved-empty-b-a",
      }));
      const previousAttempt = previous.attempts.find((attempt) => attempt.status === "completed")!;
      const resolved = await workflow.executeTransition({
        baseIdentity: createBaseIdentity("snapshot-b", "release-b"),
        user: harness.user,
        idempotencyKey: "resolved-empty-b-a-b",
        previousEvaluationId: previous.evaluationId,
        previousAttemptId: previousAttempt.attemptId,
      });
      expect(resolved).toMatchObject({
        status: "completed",
        outcomes: [{ transition: "resolved", previous: { findingId: "finding-a" } }],
      });
    } finally {
      harness.close();
    }
  });
});

const createHarness = () => {
  const root = mkdtempSync(join(tmpdir(), "preschool-additional-evaluation-"));
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  metadata.users.upsertDevUser({
    id: "admin-1",
    email: "admin@example.test",
    display_name: "Admin",
    dev_token: "admin-token",
  });
  const user = metadata.users.getById({ user_id: "admin-1" }) as UserRecord;
  metadata.workspaces.upsert({
    id: "default",
    owner_user_id: user.id,
    name: "System",
    kind: "personal",
  });
  metadata.workspaces.upsert({
    id: "workspace-1",
    owner_user_id: user.id,
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
  metadata.configResources.upsert({
    id: "profile-a",
    workspace_id: "default",
    user_id: user.id,
    kind: "model-profile",
    name: "Profile A",
    payload: { provider: "openai-compatible", modelName: "model-a", baseUrl: "https://profile-a.test/v1" },
    default_enabled: true,
    status: "connected",
  });
  for (let revision = 1; revision <= 7; revision += 1) {
    metadata.workspaceDefaultModelProfiles.set({
      workspace_id: "default",
      profile_id: "profile-a",
      profile_owner_user_id: user.id,
      configured_by_user_id: user.id,
      ...(revision > 1 ? { expected_revision: revision - 1 } : {}),
    });
  }
  return {
    metadata,
    user,
    baseIdentity: createBaseIdentity("snapshot-a", "release-a"),
    close: () => {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
};

const reviewAllPassing = (
  harness: ReturnType<typeof createHarness>,
  batch: Awaited<ReturnType<ReturnType<typeof createPreschoolAdditionalAiInsightsEvaluationWorkflow>["executePassAt3"]>>,
) => {
  let current = batch;
  for (const entry of batch.reviewPack.entries) {
    current = harness.metadata.energyIq.additionalInsightEvaluations.recordHumanReview({
      evaluationId: batch.evaluationId,
      expectedWorkspaceId: batch.target.workspaceId,
      expectedProjectId: batch.target.projectId,
      reviewToken: entry.reviewToken,
      actorId: harness.user.id,
      scores: {
        newAngle: 4,
        relevance: 4,
        clarity: 4,
        worthExploring: 4,
        epistemicHonesty: 4,
        userValue: 4,
      },
      contentUsefulness: {
        summary: entry.summary === undefined
          ? { applicable: false }
          : { applicable: true, score: 4 },
        insights: entry.findings.map(({ reviewFindingToken }) => ({ reviewFindingToken, score: 4 })),
      },
      expectedRevision: 0,
    });
  }
  return current;
};

const createBaseIdentity = (
  dataSnapshotId: string,
  projectReleaseId: string,
): OverviewAiArtifactIdentityV13 => createOverviewAiArtifactIdentity({
  workspaceId: "workspace-1",
  projectId: "project-1",
  scopeId: "scope-1",
  dataSnapshotId,
  projectReleaseId,
  analysisPeriodFrom: "2026-05-01T00:00:00.000Z",
  analysisPeriodTo: "2026-06-01T00:00:00.000Z",
  rendererKey: "preschool-overview",
  rendererVersion: "1",
  modelProfileId: "workspace-default",
  modelProfileRevision: 7,
});

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
  artifactIdentityHash: `sha256:${createHash("sha256").update(JSON.stringify(identity)).digest("hex")}`,
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

const v5RuntimeIdentity = (
  identity: Record<string, unknown>,
): Record<string, unknown> => ({
  ...identity,
  identityContractRevision: "additional-insights-v5",
  validatorRevision: "additional-insights-acceptance-v3",
  workflowRevision: "additional-insights-discover-accept-publish-v5",
  investigatorPromptRevision: "additional-insights-discovery-v5",
});

const v5EvaluationTarget = (
  target: AdditionalAiInsightEvaluationTarget,
  identity: Record<string, unknown>,
): AdditionalAiInsightEvaluationTarget => ({
  ...target,
  artifactIdentityRevision: "additional-insights-v5",
  artifactIdentityHash: `sha256:${createHash("sha256").update(JSON.stringify(identity)).digest("hex")}`,
  validatorRevision: "additional-insights-acceptance-v3",
  workflowRevision: "additional-insights-discover-accept-publish-v5",
  promptRevision: "additional-insights-discovery-v5",
});

const downgradeEvaluationReservationToV5 = (
  db: DatabaseSync,
  evaluationId: string,
): void => {
  const row = db.prepare("SELECT reservation_json, record_json FROM energyiq_additional_insight_evaluations WHERE id = ?")
    .get(evaluationId) as { reservation_json: string; record_json: string };
  const reservation = JSON.parse(row.reservation_json) as {
    target: AdditionalAiInsightEvaluationTarget;
    runtimeIdentity: Record<string, unknown>;
  };
  const record = JSON.parse(row.record_json) as { target: AdditionalAiInsightEvaluationTarget };
  reservation.runtimeIdentity = v5RuntimeIdentity(reservation.runtimeIdentity);
  reservation.target = v5EvaluationTarget(reservation.target, reservation.runtimeIdentity);
  record.target = reservation.target;
  db.prepare("UPDATE energyiq_additional_insight_evaluations SET reservation_json = ?, record_json = ? WHERE id = ?")
    .run(JSON.stringify(reservation), JSON.stringify(record), evaluationId);
};

const downgradeTransitionReservationToV5 = (
  db: DatabaseSync,
  transitionId: string,
): void => {
  const row = db.prepare("SELECT reservation_json FROM energyiq_additional_insight_transitions WHERE id = ?")
    .get(transitionId) as { reservation_json: string };
  const reservation = JSON.parse(row.reservation_json) as {
    transitionId: string;
    previousEvaluationId: string;
    previousTarget: AdditionalAiInsightEvaluationTarget;
    currentTarget: AdditionalAiInsightEvaluationTarget;
    runtimeIdentity: Record<string, unknown>;
    currentArtifactId: string;
    currentArtifactIdentityHash: string;
  };
  const previousRow = db.prepare("SELECT record_json FROM energyiq_additional_insight_evaluations WHERE id = ?")
    .get(reservation.previousEvaluationId) as { record_json: string };
  reservation.previousTarget = (JSON.parse(previousRow.record_json) as {
    target: AdditionalAiInsightEvaluationTarget;
  }).target;
  reservation.runtimeIdentity = v5RuntimeIdentity(reservation.runtimeIdentity);
  reservation.currentTarget = v5EvaluationTarget(reservation.currentTarget, reservation.runtimeIdentity);
  reservation.currentArtifactIdentityHash = `sha256:${createHash("sha256").update(JSON.stringify({
    contractRevision: "additional-insight-transition-artifact-v1",
    target: reservation.currentTarget,
    transitionId: reservation.transitionId,
  })).digest("hex")}`;
  reservation.currentArtifactId = `additional-transition-artifact-${reservation.currentArtifactIdentityHash.slice(7, 31)}`;
  db.prepare("UPDATE energyiq_additional_insight_transitions SET reservation_json = ? WHERE id = ?")
    .run(JSON.stringify(reservation), transitionId);
};

const artifact = (
  identity: PreschoolAdditionalAiInsightArtifactIdentity,
  runId: string,
  evidenceId: string,
  findingId: string,
): Extract<AdditionalAiInsightsArtifactV1V2, { status: "available" }> => {
  const methodSet = resolveCurrentAdditionalAiInsightMethodSet(identity.workspaceId);
  return {
    artifactKind: "autonomous-insights",
    status: "available",
    providerProfileId: identity.modelProfileId,
    runId,
    contract: { id: "energyiq-additional-ai-insights", revision: identity.outputContractRevision },
    binding: {
      workspaceId: identity.workspaceId,
      projectId: identity.projectId,
      scopeId: identity.scopeId,
      dataSnapshotId: identity.dataSnapshotId,
      projectReleaseId: identity.projectReleaseId,
      analysisPeriod: { from: identity.analysisPeriodFrom, to: identity.analysisPeriodTo },
      modelProfileId: identity.modelProfileId,
      modelProfileRevision: identity.modelProfileRevision,
    },
    methodExecution: {
      methodSetId: identity.methodSetId,
      methodSetRevision: identity.methodSetRevision,
      methodSetFingerprint: identity.methodSetFingerprint,
      loadedMethods: [...methodSet.methods],
    },
    capability: {
      revision: identity.capabilityRevision,
      mode: "scoped-read-only",
      allowedTools: [...ADDITIONAL_AI_INSIGHTS_SCOPED_READ_ONLY_TOOLS_V1],
      usedTools: [],
    },
    toolAudits: [],
    evidenceLineage: {
      catalogContract: "analysis-context-evidence@1",
      sourceId: `catalog:${identity.dataSnapshotId}`,
      pins: {
        workspaceId: identity.workspaceId,
        projectId: identity.projectId,
        scopeId: identity.scopeId,
        dataSnapshotId: identity.dataSnapshotId,
        dataCutoff: "2026-05-31T23:45:00.000Z",
        projectReleaseId: identity.projectReleaseId,
        metricVersion: "metric-v1",
      },
      facts: [{
        id: evidenceId,
        label: "Evidence",
        metricId: "energy.additional",
        value: identity.dataSnapshotId === "snapshot-a" ? 10 : 12,
        unit: "kWh",
        status: "confirmed",
        evidenceRefs: [`source:${evidenceId}`],
        dimensions: { scopeId: identity.scopeId },
      }],
    },
    findings: [{
      id: findingId,
      title: `Finding ${findingId}`,
      text: "An incremental Evidence-bound angle.",
      epistemicStatus: "observed",
      origin: { kind: "ai-discovery", coreMethod: methodSet.methods[0]!, directionMethods: [] },
      evidenceRefs: [evidenceId],
      toolAuditIds: [],
    }],
    publication: {
      policyId: "energyiq-additional-ai-insights",
      policyRevision: identity.publicationRevision,
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

const changedTransitionAnswer = (
  previousFindingId: string,
  previousEvidenceRef: string,
  currentFindingId: string,
  currentEvidenceRef: string,
): string => JSON.stringify({
  outcomes: [{
    transition: "changed",
    previousFindingId,
    previousEvidenceRefs: [previousEvidenceRef],
    currentFindingId,
    currentEvidenceRefs: [currentEvidenceRef],
  }],
});

const artifactWithTwoFindings = (
  identity: PreschoolAdditionalAiInsightArtifactIdentity,
  runId: string,
  prefix: string,
): AdditionalAiInsightsArtifactV1V2 => {
  const first = artifact(identity, runId, `${prefix}:evidence:1`, `${prefix}:finding:1`);
  const firstFact = first.evidenceLineage.facts[0]!;
  const firstFinding = first.findings[0]!;
  const secondEvidenceId = `${prefix}:evidence:2`;
  const secondFindingId = `${prefix}:finding:2`;
  return {
    ...first,
    evidenceLineage: {
      ...first.evidenceLineage,
      facts: [
        firstFact,
        { ...firstFact, id: secondEvidenceId, evidenceRefs: [`source:${secondEvidenceId}`] },
      ],
    },
    findings: [
      firstFinding,
      {
        ...firstFinding,
        id: secondFindingId,
        title: `Finding ${secondFindingId}`,
        evidenceRefs: [secondEvidenceId],
      },
    ],
    publication: {
      ...first.publication,
      discoveredCount: 2,
      acceptedCount: 2,
      publishedCount: 2,
      sourceOrderCandidateIds: [`${prefix}:finding:1`, secondFindingId],
      acceptedCandidateIds: [`${prefix}:finding:1`, secondFindingId],
      publishedCandidateIds: [`${prefix}:finding:1`, secondFindingId],
    },
  };
};

const artifactWithTwoEvidenceRefs = (
  identity: PreschoolAdditionalAiInsightArtifactIdentity,
  runId: string,
  prefix: string,
): AdditionalAiInsightsArtifactV1V2 => {
  const firstEvidenceId = `${prefix}:evidence:1`;
  const secondEvidenceId = `${prefix}:evidence:2`;
  const findingId = `${prefix}:finding`;
  const base = artifact(identity, runId, firstEvidenceId, findingId);
  const firstFact = base.evidenceLineage.facts[0]!;
  return {
    ...base,
    evidenceLineage: {
      ...base.evidenceLineage,
      facts: [
        firstFact,
        { ...firstFact, id: secondEvidenceId, evidenceRefs: [`source:${secondEvidenceId}`] },
      ],
    },
    findings: [{ ...base.findings[0]!, evidenceRefs: [firstEvidenceId, secondEvidenceId] }],
  };
};

const emptyArtifact = (
  identity: PreschoolAdditionalAiInsightArtifactIdentity,
  runId: string,
  discoveredCount: number,
): AdditionalAiInsightsArtifactV1V2 => {
  const rejectedCandidateIds = Array.from({ length: discoveredCount }, (_, index) => `rejected-${index + 1}`);
  const base = artifact(identity, runId, "unused-evidence", "unused-finding");
  return {
    ...base,
    status: "empty",
    findings: [],
    publication: {
      ...base.publication,
      discoveredCount,
      acceptedCount: 0,
      rejectedCount: discoveredCount,
      publishedCount: 0,
      sourceOrderCandidateIds: [...rejectedCandidateIds],
      acceptedCandidateIds: [],
      rejectedCandidateIds,
      publishedCandidateIds: [],
      suppressedCandidateIds: [],
    },
  };
};
