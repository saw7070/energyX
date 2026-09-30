import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ADDITIONAL_AI_INSIGHTS_SCOPED_READ_ONLY_TOOLS_V1,
  canonicalInsightMethodSetJson,
  resolveCurrentAdditionalAiInsightMethodSet,
  type AdditionalAiInsightsArtifact,
  type AdditionalAiInsightsArtifactV1V2,
} from "@datafoundry/contracts";

import { createMetadataStore } from "./index.js";
import type { EnergyIqOverviewAiArtifactIdentity } from "./energyiq-overview-ai-artifact-store.js";

describe("EnergyIqInsightMethodGovernanceStore", () => {
  it("appends immutable comments to one exact Finding with tenant-scoped reads", () => {
    const harness = createHarness();
    try {
      const first = harness.metadata.energyIq.insightMethodGovernance.appendFindingComment({
        expectedWorkspaceId: "artifact-workspace",
        expectedProjectId: "artifact-project",
        artifactId: harness.artifact.id,
        findingId: "additional-insight-1",
        actorId: "admin-reviewer",
        idempotencyKey: "comment:first-review",
        text: "Useful lead; verify whether the same shape repeats next week.",
        now: "2026-08-15T01:00:00.000Z",
      });
      const replay = harness.metadata.energyIq.insightMethodGovernance.appendFindingComment({
        expectedWorkspaceId: "artifact-workspace",
        expectedProjectId: "artifact-project",
        artifactId: harness.artifact.id,
        findingId: "additional-insight-1",
        actorId: "admin-reviewer",
        idempotencyKey: "comment:first-review",
        text: "Useful lead; verify whether the same shape repeats next week.",
        now: "2026-08-15T01:01:00.000Z",
      });
      const second = harness.metadata.energyIq.insightMethodGovernance.appendFindingComment({
        expectedWorkspaceId: "artifact-workspace",
        expectedProjectId: "artifact-project",
        artifactId: harness.artifact.id,
        findingId: "additional-insight-1",
        actorId: "admin-reviewer",
        idempotencyKey: "comment:second-review",
        text: "Do not publish a Method revision until the repeated pattern is reviewed.",
        now: "2026-08-15T01:02:00.000Z",
      });

      expect(replay).toEqual(first);
      expect(first).toMatchObject({
        workspaceId: "artifact-workspace",
        projectId: "artifact-project",
        scopeId: "artifact-project-scope",
        artifactId: harness.artifact.id,
        artifactIdentityHash: `sha256:${harness.artifact.identity_hash}`,
        artifactIdentityRevision: "additional-insights-v24",
        findingId: "additional-insight-1",
        actorId: "admin-reviewer",
        text: "Useful lead; verify whether the same shape repeats next week.",
        createdAt: "2026-08-15T01:00:00.000Z",
      });
      expect(second.id).not.toBe(first.id);
      expect(harness.metadata.energyIq.insightMethodGovernance.listFindingComments({
        expectedWorkspaceId: "artifact-workspace",
        expectedProjectId: "artifact-project",
        artifactId: harness.artifact.id,
        findingId: "additional-insight-1",
      })).toEqual([first, second]);
      expect(harness.metadata.energyIq.insightMethodGovernance.listFindingComments({
        expectedWorkspaceId: "workspace-other",
        expectedProjectId: "artifact-project",
        artifactId: harness.artifact.id,
        findingId: "additional-insight-1",
      })).toEqual([]);
      expect(() => harness.metadata.energyIq.insightMethodGovernance.appendFindingComment({
        expectedWorkspaceId: "artifact-workspace",
        expectedProjectId: "artifact-project",
        artifactId: harness.artifact.id,
        findingId: "finding-does-not-exist",
        actorId: "admin-reviewer",
        idempotencyKey: "comment:fake-finding",
        text: "This must not be stored.",
      })).toThrow("ENERGYIQ_ADDITIONAL_FINDING_NOT_FOUND");
    } finally {
      harness.close();
    }
  });

  it("persists one actor vote with idempotent replay, audited change, and exact Artifact/Finding identity", () => {
    const harness = createHarness();
    try {
      const first = harness.metadata.energyIq.insightMethodGovernance.recordFeedback({
        expectedWorkspaceId: "artifact-workspace",
        expectedProjectId: "artifact-project",
        artifactId: harness.artifact.id,
        findingId: "additional-insight-1",
        actorId: "dev-user",
        rating: "useful",
        expectedRevision: 0,
        now: "2026-08-14T02:00:00.000Z",
      });
      const replay = harness.metadata.energyIq.insightMethodGovernance.recordFeedback({
        expectedWorkspaceId: "artifact-workspace",
        expectedProjectId: "artifact-project",
        artifactId: harness.artifact.id,
        findingId: "additional-insight-1",
        actorId: "dev-user",
        rating: "useful",
        expectedRevision: 0,
        now: "2026-08-14T02:01:00.000Z",
      });
      const changed = harness.metadata.energyIq.insightMethodGovernance.recordFeedback({
        expectedWorkspaceId: "artifact-workspace",
        expectedProjectId: "artifact-project",
        artifactId: harness.artifact.id,
        findingId: "additional-insight-1",
        actorId: "dev-user",
        rating: "not-useful",
        expectedRevision: 1,
        now: "2026-08-14T02:02:00.000Z",
      });

      expect(replay).toEqual(first);
      expect(changed).toMatchObject({
        workspaceId: "artifact-workspace",
        projectId: "artifact-project",
        scopeId: "artifact-project-scope",
        artifactId: harness.artifact.id,
        artifactIdentityHash: `sha256:${harness.artifact.identity_hash}`,
        artifactIdentityRevision: "additional-insights-v24",
        dataSnapshotId: "snapshot-feedback",
        projectReleaseId: "release-v1",
        findingId: "additional-insight-1",
        actorId: "dev-user",
        rating: "not-useful",
        revision: 2,
      });
      expect(changed.history).toEqual([
        expect.objectContaining({ revision: 1, fromRating: null, toRating: "useful" }),
        expect.objectContaining({ revision: 2, fromRating: "useful", toRating: "not-useful" }),
      ]);
      expect(harness.metadata.energyIq.insightMethodGovernance.feedbackSummary({
        workspaceId: "artifact-workspace",
        artifactId: harness.artifact.id,
        findingId: "additional-insight-1",
      })).toEqual({ useful: 0, notUseful: 1 });
      expect(harness.metadata.energyIq.insightMethodGovernance.listProposals({
        workspaceId: "artifact-workspace",
      })).toEqual([]);

      expect(() => harness.metadata.energyIq.insightMethodGovernance.recordFeedback({
        expectedWorkspaceId: "artifact-workspace",
        expectedProjectId: "artifact-project",
        artifactId: harness.artifact.id,
        findingId: "finding-does-not-exist",
        actorId: "dev-user",
        rating: "useful",
        expectedRevision: 0,
      })).toThrow("ENERGYIQ_ADDITIONAL_FINDING_NOT_FOUND");
      expect(harness.metadata.energyIq.insightMethodGovernance.findFeedback({
        workspaceId: "workspace-other",
        projectId: "artifact-project",
        artifactId: harness.artifact.id,
        findingId: "additional-insight-1",
        actorId: "dev-user",
      })).toBeUndefined();
    } finally {
      harness.close();
    }
  });

  it("persists conflict-safe proposal transitions and exposes only published workspace Method content", () => {
    const harness = createHarness();
    try {
      const provisional = harness.metadata.energyIq.insightMethodGovernance.createProposal({
        expectedWorkspaceId: "artifact-workspace",
        expectedProjectId: "artifact-project",
        artifactId: harness.artifact.id,
        findingId: "additional-insight-1",
        actorId: "dev-user",
        idempotencyKey: "proposal:off-hours-shape",
        title: "Check repeated off-hours event shapes",
        guidance: "Compare repeated event shape and timing before treating an isolated spike as a reusable pattern.",
        now: "2026-08-14T03:00:00.000Z",
      });
      expect(harness.metadata.energyIq.insightMethodGovernance.createProposal({
        expectedWorkspaceId: "artifact-workspace",
        expectedProjectId: "artifact-project",
        artifactId: harness.artifact.id,
        findingId: "additional-insight-1",
        actorId: "dev-user",
        idempotencyKey: "proposal:off-hours-shape",
        title: provisional.title,
        guidance: provisional.guidance,
        now: "2026-08-14T03:01:00.000Z",
      })).toEqual(provisional);
      expect(provisional).toMatchObject({ status: "provisional", revision: 1, createdBy: "dev-user" });
      expect(harness.metadata.energyIq.insightMethodGovernance.listPublishedWorkspaceMethodResources({
        workspaceId: "artifact-workspace",
      })).toEqual([]);

      expect(() => harness.metadata.energyIq.insightMethodGovernance.approveProposal({
        workspaceId: "artifact-workspace",
        projectId: "artifact-project",
        proposalId: provisional.id,
        actorId: "admin-reviewer",
        expectedRevision: 1,
      })).toThrow("INSIGHT_METHOD_NOT_IN_REVIEW");

      const inReview = harness.metadata.energyIq.insightMethodGovernance.submitProposal({
        workspaceId: "artifact-workspace",
        projectId: "artifact-project",
        proposalId: provisional.id,
        actorId: "dev-user",
        expectedRevision: 1,
        now: "2026-08-14T03:02:00.000Z",
      });
      expect(() => harness.metadata.energyIq.insightMethodGovernance.submitProposal({
        workspaceId: "artifact-workspace",
        projectId: "artifact-project",
        proposalId: provisional.id,
        actorId: "dev-user",
        expectedRevision: 1,
      })).toThrow("ENERGYIQ_INSIGHT_METHOD_PROPOSAL_REVISION_CONFLICT");
      const approved = harness.metadata.energyIq.insightMethodGovernance.approveProposal({
        workspaceId: "artifact-workspace",
        projectId: "artifact-project",
        proposalId: provisional.id,
        actorId: "admin-reviewer",
        expectedRevision: inReview.revision,
        now: "2026-08-14T03:03:00.000Z",
      });
      const published = harness.metadata.energyIq.insightMethodGovernance.publishProposal({
        workspaceId: "artifact-workspace",
        projectId: "artifact-project",
        proposalId: provisional.id,
        actorId: "admin-publisher",
        expectedRevision: approved.revision,
        now: "2026-08-14T03:04:00.000Z",
      });

      expect(published).toMatchObject({ status: "published", revision: 4 });
      expect(published.audit).toEqual([
        expect.objectContaining({ revision: 1, fromStatus: null, toStatus: "provisional", actorId: "dev-user" }),
        expect.objectContaining({ revision: 2, fromStatus: "provisional", toStatus: "in-review", actorId: "dev-user" }),
        expect.objectContaining({ revision: 3, fromStatus: "in-review", toStatus: "approved", actorId: "admin-reviewer" }),
        expect.objectContaining({ revision: 4, fromStatus: "approved", toStatus: "published", actorId: "admin-publisher" }),
      ]);
      const resources = harness.metadata.energyIq.insightMethodGovernance.listPublishedWorkspaceMethodResources({
        workspaceId: "artifact-workspace",
      });
      expect(resources).toHaveLength(1);
      expect(resources[0]).toMatchObject({
        content: provisional.guidance,
        method: {
          scope: "workspace",
          workspaceId: "artifact-workspace",
          role: "expert-direction",
          resourceRevision: 1,
        },
      });
      expect(createHash("sha256").update(resources[0]!.content).digest("hex"))
        .toBe(resources[0]!.method.contentSha256);
      expect(harness.metadata.energyIq.insightMethodGovernance.listPublishedWorkspaceMethodResources({
        workspaceId: "workspace-other",
      })).toEqual([]);
      expect(() => harness.metadata.energyIq.insightMethodGovernance.recordFeedback({
        expectedWorkspaceId: "artifact-workspace",
        expectedProjectId: "artifact-project",
        artifactId: harness.artifact.id,
        findingId: "additional-insight-1",
        actorId: "dev-user",
        rating: "useful",
        expectedRevision: 0,
      })).toThrow("ENERGYIQ_ADDITIONAL_ARTIFACT_NOT_CURRENT");
    } finally {
      harness.close();
    }
  });

  it("keeps a proposal sourced from a historical v20 Artifact readable but blocks every transition", () => {
    const harness = createHarness();
    try {
      const provisional = harness.metadata.energyIq.insightMethodGovernance.createProposal({
        expectedWorkspaceId: "artifact-workspace",
        expectedProjectId: "artifact-project",
        artifactId: harness.artifact.id,
        findingId: "additional-insight-1",
        actorId: "dev-user",
        idempotencyKey: "proposal:historical-v20",
        title: "Review the historical direction",
        guidance: "Keep the historical proposal readable without allowing it to enter the current Method set.",
      });
      harness.metadata.db.prepare(`
        UPDATE energyiq_insight_method_proposals
        SET artifact_identity_revision = 'additional-insights-v20'
        WHERE id = ?
      `).run(provisional.id);

      expect(harness.metadata.energyIq.insightMethodGovernance.getProposal({
        workspaceId: "artifact-workspace",
        projectId: "artifact-project",
        proposalId: provisional.id,
      })).toMatchObject({ artifactIdentityRevision: "additional-insights-v20" });
      expect(() => harness.metadata.energyIq.insightMethodGovernance.submitProposal({
        workspaceId: "artifact-workspace",
        projectId: "artifact-project",
        proposalId: provisional.id,
        actorId: "dev-user",
        expectedRevision: provisional.revision,
      })).toThrow("ENERGYIQ_ADDITIONAL_INSIGHT_CURRENT_IDENTITY_REQUIRED");
    } finally {
      harness.close();
    }
  });
});

function createHarness() {
  const root = mkdtempSync(join(tmpdir(), "energyiq-insight-method-governance-"));
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  metadata.users.upsertDevUser({
    id: "admin-reviewer",
    email: "reviewer@example.test",
    display_name: "Review Admin",
    dev_token: "review-admin-token",
  });
  metadata.users.upsertDevUser({
    id: "admin-publisher",
    email: "publisher@example.test",
    display_name: "Publish Admin",
    dev_token: "publish-admin-token",
  });
  metadata.workspaces.upsert({
    id: "artifact-workspace",
    owner_user_id: "dev-user",
    name: "Artifact Workspace",
    kind: "customer",
  });
  metadata.energyIq.upsertProject({
    id: "artifact-project",
    workspace_id: "artifact-workspace",
    name: "Artifact Project",
    status: "published",
    root_scope_id: "artifact-project-scope",
  });
  const identity = additionalIdentity();
  metadata.energyIq.overviewAiArtifacts.queue({ identity, triggeredBy: "dev-user" });
  metadata.energyIq.overviewAiArtifacts.claim({ identity, workerId: "worker", leaseMs: 60_000 });
  const artifact = metadata.energyIq.overviewAiArtifacts.complete({
    identity,
    workerId: "worker",
    sessionId: "session-feedback",
    runId: "run-feedback",
    resultJson: JSON.stringify(additionalResult(identity)),
  });
  return {
    metadata,
    artifact,
    close: () => {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}

type AdditionalIdentity = EnergyIqOverviewAiArtifactIdentity & {
  artifactKind: "autonomous-insights";
  identityContractRevision: "additional-insights-v24";
  methodSetId: "preschool-additional-insights-current";
  methodSetRevision: "v1";
  methodSetFingerprint: string;
  capabilityRevision: "scoped-read-only-v1";
  publicationRevision: "additional-insights-v2";
  canvasRevision: "energyiq-insight-canvas-v2";
};

function additionalIdentity(): AdditionalIdentity {
  const methodSet = resolveCurrentAdditionalAiInsightMethodSet("artifact-workspace");
  const canonical = canonicalInsightMethodSetJson(methodSet.methods)!;
  return {
    workspaceId: "artifact-workspace",
    projectId: "artifact-project",
    scopeId: "artifact-project-scope",
    resource: "electricity",
    dataSnapshotId: "snapshot-feedback",
    projectReleaseId: "release-v1",
    analysisPeriodFrom: "2026-05-01T00:00:00.000Z",
    analysisPeriodTo: "2026-06-01T00:00:00.000Z",
    rendererKey: "preschool-overview",
    rendererVersion: "v1",
    analysisPackId: "preschool-additional-insights-pack",
    analysisPackRevision: "v1",
    modelProfileId: "workspace-default",
    modelProfileRevision: 1,
    outputContractRevision: "energyiq-additional-ai-insights-v2",
    validatorRevision: "additional-insights-acceptance-v17",
    workflowRevision: "additional-insights-discover-accept-publish-v21",
    investigatorPromptRevision: "additional-insights-discovery-v12",
    editorPromptRevision: "additional-insights-publication-v2",
    methodSkillId: "energyiq-open-discovery",
    methodSkillRevision: "1.0.0",
    artifactKind: "autonomous-insights",
    identityContractRevision: "additional-insights-v24",
    methodSetId: "preschool-additional-insights-current",
    methodSetRevision: "v1",
    methodSetFingerprint: `sha256:${createHash("sha256").update(canonical).digest("hex")}`,
    capabilityRevision: "scoped-read-only-v1",
    publicationRevision: "additional-insights-v2",
    canvasRevision: "energyiq-insight-canvas-v2",
  };
}

function additionalResult(identity: AdditionalIdentity): AdditionalAiInsightsArtifactV1V2 {
  const methodSet = resolveCurrentAdditionalAiInsightMethodSet(identity.workspaceId);
  return {
    artifactKind: "autonomous-insights",
    status: "available",
    providerProfileId: identity.modelProfileId,
    runId: "run-feedback",
    contract: { id: "energyiq-additional-ai-insights", revision: "energyiq-additional-ai-insights-v2" },
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
      sourceId: "project-analysis-snapshot:artifact-project:snapshot-feedback",
      pins: {
        workspaceId: identity.workspaceId,
        projectId: identity.projectId,
        scopeId: identity.scopeId,
        dataSnapshotId: identity.dataSnapshotId,
        dataCutoff: "2026-05-31T23:59:59.000Z",
        projectReleaseId: identity.projectReleaseId,
        metricVersion: "energy-metrics-v1",
      },
      facts: [{
        id: "evidence:additional:1",
        label: "Additional Evidence",
        metricId: "energy.additional",
        value: 1,
        unit: "kWh",
        status: "confirmed",
        evidenceRefs: ["snapshot-evidence:additional:1"],
        dimensions: { scopeId: identity.scopeId },
      }],
    },
    findings: [{
      id: "additional-insight-1",
      title: "An incremental angle",
      text: "Current Snapshot Evidence supports this additional angle.",
      epistemicStatus: "inferred",
      origin: { kind: "ai-discovery", coreMethod: methodSet.methods[0]!, directionMethods: [] },
      evidenceRefs: ["evidence:additional:1"],
      toolAuditIds: [],
    }],
    publication: {
      policyId: "energyiq-additional-ai-insights",
      policyRevision: identity.publicationRevision,
      discoveredCount: 1,
      acceptedCount: 1,
      rejectedCount: 0,
      publishedCount: 1,
      sourceOrderCandidateIds: ["candidate-1"],
      acceptedCandidateIds: ["candidate-1"],
      rejectedCandidateIds: [],
      publishedCandidateIds: ["candidate-1"],
      suppressedCandidateIds: [],
    },
  };
}
