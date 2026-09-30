import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import { createMetadataStore } from "@datafoundry/metadata";

import type { ConfigApiContext } from "../routes/types.js";
import { ensureEnergyIqBootstrap, PRESCHOOL_WORKSPACE_ID } from "./energy-bootstrap.js";
import { handleEnergyApiRequest } from "./energy-api.js";
import { createOverviewAiArtifactIdentity } from "./overview-ai-artifact.js";

describe("Additional Insight evaluation API", () => {
  it("allows only project admins to start pass@3 and ignores browser-supplied identity drift", async () => {
    const harness = createHarness();
    try {
      const body = {
        idempotencyKey: "pass-at-3-key",
        scopeId: harness.project.root_scope_id,
        dataSnapshotId: "snapshot-current",
        projectReleaseId: "release-current",
        from: "2026-05-01T00:00:00.000Z",
        to: "2026-06-01T00:00:00.000Z",
        workspaceId: "workspace-forged",
        projectId: "project-forged",
        modelProfileId: "model-forged",
        modelProfileRevision: 999,
      };
      const member = await handleEnergyApiRequest(jsonRequest("POST", body), evaluationPath(harness), {
        ...harness.context,
        userId: "second-user",
      });
      expect(member).toMatchObject({ status: 403, body: { success: false, error: { code: "FORBIDDEN" } } });
      expect(harness.executePassAt3).not.toHaveBeenCalled();

      const admin = await handleEnergyApiRequest(jsonRequest("POST", body), evaluationPath(harness), harness.context);
      expect(admin).toMatchObject({
        status: 202,
        body: { success: true, data: { evaluationId: "evaluation-1", status: "awaiting-human-review" } },
      });
      expect(harness.resolveCurrentIdentity).toHaveBeenCalledWith(expect.objectContaining({
        projectId: harness.project.id,
        scopeId: harness.project.root_scope_id,
        pin: {
          dataSnapshotId: "snapshot-current",
          projectReleaseId: "release-current",
          from: "2026-05-01T00:00:00.000Z",
          to: "2026-06-01T00:00:00.000Z",
        },
      }));
      expect(harness.executePassAt3).toHaveBeenCalledWith(expect.objectContaining({
        baseIdentity: expect.objectContaining({
          workspaceId: PRESCHOOL_WORKSPACE_ID,
          projectId: harness.project.id,
          dataSnapshotId: "snapshot-current",
          modelProfileId: "workspace-default",
          modelProfileRevision: 7,
        }),
        idempotencyKey: "pass-at-3-key",
      }));
    } finally {
      harness.close();
    }
  });

  it("keeps the ordinary Overview GET read-only and never invokes evaluation", async () => {
    const harness = createHarness();
    try {
      const response = await handleEnergyApiRequest(getRequest(
        `?scopeId=${encodeURIComponent(harness.project.root_scope_id)}`,
      ), ["projects", harness.project.id, "overview-ai-artifact"], {
        ...harness.context,
        userId: "second-user",
      });
      expect(response.status).toBe(200);
      expect(harness.read).toHaveBeenCalledTimes(1);
      expect(harness.executePassAt3).not.toHaveBeenCalled();
      expect(harness.executeTransition).not.toHaveBeenCalled();
    } finally {
      harness.close();
    }
  });

  it("exposes the blinded pack without attempt/run mapping and keeps review/approval admin-only", async () => {
    const harness = createHarness();
    try {
      harness.seedEvaluation();
      const blindPath = [...evaluationPath(harness), "evaluation-seeded", "review-pack"];
      const member = await handleEnergyApiRequest(getRequest(), blindPath, {
        ...harness.context,
        userId: "second-user",
      });
      expect(member.status).toBe(403);

      const admin = await handleEnergyApiRequest(getRequest(), blindPath, harness.context);
      expect(admin).toMatchObject({
        status: 200,
        body: { success: true, data: {
          evaluationId: "evaluation-seeded",
          entries: expect.any(Array),
        } },
      });
      expect(JSON.stringify(admin.body)).not.toMatch(/attempt-|provider-run|provider-session|reviewAudit/);
    } finally {
      harness.close();
    }
  });

  it("accepts separate Summary and per-Insight usefulness scores without exposing audit identity", async () => {
    const harness = createHarness();
    try {
      const record = harness.seedEvaluation();
      const recordHumanReview = vi.spyOn(
        harness.metadata.energyIq.additionalInsightEvaluations,
        "recordHumanReview",
      ).mockReturnValue(record as never);
      const path = [
        ...evaluationPath(harness),
        "evaluation-seeded",
        "reviews",
        "blind-token",
      ];
      const contentUsefulness = {
        summary: { applicable: true, score: 2 },
        insights: [{ reviewFindingToken: "blind-finding-token", score: 5 }],
      };
      const response = await handleEnergyApiRequest(jsonRequest("PUT", {
        expectedRevision: 0,
        scores: {
          newAngle: 4,
          relevance: 4,
          clarity: 4,
          worthExploring: 5,
          epistemicHonesty: 4,
          userValue: 4,
        },
        contentUsefulness,
      }), path, harness.context);
      expect(response.status).toBe(200);
      expect(recordHumanReview).toHaveBeenCalledWith(expect.objectContaining({
        actorId: "dev-user",
        reviewToken: "blind-token",
        contentUsefulness,
      }));
      expect(JSON.stringify(response.body)).not.toMatch(/provider-run|provider-session|reviewAudit/);
    } finally {
      harness.close();
    }
  });

  it("keeps Snapshot transition generation admin-only and resolves B identity from server-owned pins", async () => {
    const harness = createHarness();
    try {
      const previous = harness.seedEvaluation();
      harness.executeTransition.mockResolvedValue({
        transitionId: "transition-1",
        status: "completed",
        previousTarget: previous.target,
        currentTarget: {
          ...previous.target,
          dataSnapshotId: "snapshot-b",
          projectReleaseId: "release-b",
          artifactIdentityHash: `sha256:${"c".repeat(64)}`,
        },
        outcomes: [{ transition: "no-material-change" }],
      });
      const body = {
        idempotencyKey: "snapshot-a-to-b",
        previousEvaluationId: "evaluation-seeded",
        previousAttemptId: "attempt-a",
        scopeId: harness.project.root_scope_id,
        dataSnapshotId: "snapshot-b",
        projectReleaseId: "release-b",
        from: "2026-06-01T00:00:00.000Z",
        to: "2026-07-01T00:00:00.000Z",
      };
      const path = ["projects", harness.project.id, "additional-ai-insights", "transitions"];
      const forbidden = await handleEnergyApiRequest(jsonRequest("POST", body), path, {
        ...harness.context,
        userId: "second-user",
      });
      expect(forbidden.status).toBe(403);
      expect(harness.executeTransition).not.toHaveBeenCalled();

      const accepted = await handleEnergyApiRequest(jsonRequest("POST", body), path, harness.context);
      expect(accepted).toMatchObject({
        status: 202,
        body: { success: true, data: {
          transitionId: "transition-1",
          status: "completed",
          previousSnapshotId: "snapshot-current",
          currentSnapshotId: "snapshot-b",
          outcomeCount: 1,
        } },
      });
      expect(harness.resolveCurrentIdentity).toHaveBeenLastCalledWith(expect.objectContaining({
        pin: {
          dataSnapshotId: "snapshot-b",
          projectReleaseId: "release-b",
          from: "2026-06-01T00:00:00.000Z",
          to: "2026-07-01T00:00:00.000Z",
        },
      }));
      expect(harness.executeTransition).toHaveBeenCalledWith(expect.objectContaining({
        baseIdentity: expect.objectContaining({
          dataSnapshotId: "snapshot-b",
          projectReleaseId: "release-b",
          analysisPeriodFrom: "2026-06-01T00:00:00.000Z",
          analysisPeriodTo: "2026-07-01T00:00:00.000Z",
        }),
      }));

      harness.executeTransition.mockResolvedValueOnce({
        transitionId: "transition-running",
        status: "running",
        previousTarget: previous.target,
        currentTarget: {
          ...previous.target,
          dataSnapshotId: "snapshot-b",
          projectReleaseId: "release-b",
          artifactIdentityHash: `sha256:${"d".repeat(64)}`,
        },
      });
      const inFlight = await handleEnergyApiRequest(jsonRequest("POST", {
        ...body,
        idempotencyKey: "snapshot-a-to-b-concurrent",
      }), path, harness.context);
      expect(inFlight).toMatchObject({
        status: 202,
        body: { success: true, data: {
          transitionId: "transition-running",
          status: "running",
          previousSnapshotId: "snapshot-current",
          currentSnapshotId: "snapshot-b",
        } },
      });
      expect(JSON.stringify(inFlight.body)).not.toMatch(/errorCode|failureStage/);
    } finally {
      harness.close();
    }
  });

  it("publishes an approved current candidate for admins without starting pass@3 again", async () => {
    const harness = createHarness();
    try {
      const approved = {
        ...harness.seedEvaluation(),
        status: "approved-candidate",
        approval: {
          selectedAttemptId: "attempt-approved",
          actorId: "dev-user",
          approvedAt: "2026-08-15T00:00:00.000Z",
          revision: 1,
          disposition: "publication-candidate-only",
        },
      };
      harness.metadata.energyIq.additionalInsightEvaluations.getEvaluation = vi.fn(() => approved as never);
      harness.publishApprovedCandidate.mockResolvedValue({
        ...approved,
        publication: {
          sourceAttemptId: "attempt-approved",
          artifactId: "overview-ai-artifact-current",
          artifactIdentityHash: approved.target.artifactIdentityHash,
          actorId: "dev-user",
          publishedAt: "2026-08-15T01:00:00.000Z",
          revision: 1,
        },
      });
      const path = [...evaluationPath(harness), "evaluation-seeded", "publish"];

      const member = await handleEnergyApiRequest(jsonRequest("POST", { expectedRevision: 0 }), path, {
        ...harness.context,
        userId: "second-user",
      });
      expect(member.status).toBe(403);

      const response = await handleEnergyApiRequest(
        jsonRequest("POST", { expectedRevision: 0 }),
        path,
        harness.context,
      );
      expect(response).toMatchObject({
        status: 200,
        body: { success: true, data: { publication: { sourceAttemptId: "attempt-approved" } } },
      });
      expect(harness.resolveCurrentIdentity).toHaveBeenCalledWith(expect.objectContaining({
        projectId: harness.project.id,
        scopeId: harness.project.root_scope_id,
      }));
      expect(harness.publishApprovedCandidate).toHaveBeenCalledWith(expect.objectContaining({
        evaluationId: "evaluation-seeded",
        user: expect.objectContaining({ id: "dev-user" }),
      }));
      expect(harness.executePassAt3).not.toHaveBeenCalled();
    } finally {
      harness.close();
    }
  });

  it("lists admin-scoped A baselines and A-to-B transition summaries without exposing Provider identity", async () => {
    const harness = createHarness();
    try {
      const seeded = harness.seedEvaluation();
      vi.spyOn(
        harness.metadata.energyIq.additionalInsightEvaluations,
        "listEvaluations",
      ).mockReturnValue([{
        ...seeded,
        status: "approved-candidate",
        approval: {
          selectedAttemptId: "attempt-approved-a",
          actorId: "dev-user",
          approvedAt: "2026-08-14T01:00:00.000Z",
          revision: 1,
          disposition: "publication-candidate-only",
        },
      } as never]);
      vi.spyOn(
        harness.metadata.energyIq.additionalInsightEvaluations,
        "listTransitions",
      ).mockReturnValue([{
        contractRevision: "energyiq-additional-insight-transition-v1",
        transitionId: "transition-1",
        status: "completed",
        previousTarget: seeded.target,
        currentTarget: {
          ...seeded.target,
          dataSnapshotId: "snapshot-b",
          artifactIdentityHash: `sha256:${"c".repeat(64)}`,
        },
        outcomes: [
          { transition: "new", current: {} },
          { transition: "still-supported", previous: {}, current: {} },
        ],
      } as never]);

      const forbidden = await handleEnergyApiRequest(
        getRequest(),
        evaluationPath(harness),
        { ...harness.context, userId: "second-user" },
      );
      expect(forbidden.status).toBe(403);

      const evaluations = await handleEnergyApiRequest(
        getRequest(),
        evaluationPath(harness),
        harness.context,
      );
      expect(evaluations).toMatchObject({
        status: 200,
        body: { success: true, data: { evaluations: [{
          evaluationId: "evaluation-seeded",
          status: "approved-candidate",
          target: {
            dataSnapshotId: "snapshot-current",
            analysisPeriod: { from: "2026-05-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" },
          },
          approval: { selectedAttemptId: "attempt-approved-a" },
        }] } },
      });

      const transitions = await handleEnergyApiRequest(
        getRequest(),
        ["projects", harness.project.id, "additional-ai-insights", "transitions"],
        harness.context,
      );
      expect(transitions).toMatchObject({
        status: 200,
        body: { success: true, data: { transitions: [{
          transitionId: "transition-1",
          status: "completed",
          outcomeCounts: { new: 1, "still-supported": 1 },
        }] } },
      });
      expect(JSON.stringify({ evaluations, transitions })).not.toMatch(/providerRun|providerSession/);
    } finally {
      harness.close();
    }
  });
});

const createHarness = () => {
  const root = mkdtempSync(join(tmpdir(), "energy-api-additional-evaluation-"));
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  ensureEnergyIqBootstrap(metadata);
  metadata.users.upsertDevUser({
    id: "second-user",
    email: "member@example.test",
    display_name: "Member",
    dev_token: "member-token",
  });
  metadata.workspaceMemberships.upsert({
    workspace_id: PRESCHOOL_WORKSPACE_ID,
    user_id: "second-user",
    role: "member",
  });
  const project = metadata.energyIq.getProject("preschool-demo");
  const baseIdentity = createOverviewAiArtifactIdentity({
    workspaceId: PRESCHOOL_WORKSPACE_ID,
    projectId: project.id,
    scopeId: project.root_scope_id,
    dataSnapshotId: "snapshot-current",
    projectReleaseId: "release-current",
    analysisPeriodFrom: "2026-05-01T00:00:00.000Z",
    analysisPeriodTo: "2026-06-01T00:00:00.000Z",
    rendererKey: "preschool-overview",
    rendererVersion: "1",
    modelProfileId: "workspace-default",
    modelProfileRevision: 7,
  });
  const resolveCurrentIdentity = vi.fn(async (input?: { pin?: {
    dataSnapshotId: string;
    projectReleaseId: string;
    from: string;
    to: string;
  } }) => input?.pin ? {
    ...baseIdentity,
    dataSnapshotId: input.pin.dataSnapshotId,
    projectReleaseId: input.pin.projectReleaseId,
    analysisPeriodFrom: input.pin.from,
    analysisPeriodTo: input.pin.to,
  } : baseIdentity);
  const read = vi.fn(async () => null);
  const executePassAt3 = vi.fn(async () => ({
    evaluationId: "evaluation-1",
    status: "awaiting-human-review",
    attempts: [],
    target: {
      dataSnapshotId: "snapshot-current",
      projectReleaseId: "release-current",
      analysisPeriod: { from: "2026-05-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" },
    },
    createdAt: "2026-08-14T00:00:00.000Z",
    updatedAt: "2026-08-14T00:00:00.000Z",
  }));
  const executeTransition = vi.fn();
  const publishApprovedCandidate = vi.fn();
  const context = {
    metadataStore: metadata,
    userId: "dev-user",
    workspaceId: PRESCHOOL_WORKSPACE_ID,
    overviewAiWorkflow: { resolveCurrentIdentity, read },
    additionalAiInsightsEvaluationWorkflow: { executePassAt3, executeTransition, publishApprovedCandidate },
  } as unknown as Required<ConfigApiContext>;
  return {
    metadata,
    project,
    context,
    resolveCurrentIdentity,
    read,
    executePassAt3,
    executeTransition,
    publishApprovedCandidate,
    seedEvaluation() {
      const target = {
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        projectId: project.id,
        scopeId: project.root_scope_id,
        resource: "electricity" as const,
        dataSnapshotId: "snapshot-current",
        projectReleaseId: "release-current",
        analysisPeriod: { from: "2026-05-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" },
        modelProfileId: "workspace-default",
        modelProfileRevision: 7,
        artifactIdentityRevision: "additional-insights-v24",
        artifactIdentityHash: `sha256:${"a".repeat(64)}`,
        outputContractRevision: "energyiq-additional-ai-insights-v2",
        validatorRevision: "additional-insights-acceptance-v17",
        workflowRevision: "additional-insights-discover-accept-publish-v21",
        promptRevision: "additional-insights-discovery-v12",
        capabilityRevision: "scoped-read-only-v1",
        publicationRevision: "additional-insights-v2",
        canvasRevision: "energyiq-insight-canvas-v2",
        methodSetId: "preschool-additional-insights-current",
        methodSetRevision: "v1",
        methodSetFingerprint: `sha256:${"b".repeat(64)}`,
      };
      // API behavior is under test; the Store's exact validation is covered by its focused suite.
      const record = {
        contractRevision: "energyiq-additional-insight-evaluation-v1",
        evaluationId: "evaluation-seeded",
        idempotencyKey: "seeded",
        requestedBy: "dev-user",
        status: "awaiting-human-review",
        target,
        attempts: [],
        reviewPack: {
          revision: "additional-insight-blind-review-v1",
          entries: [{
            label: "Review A",
            reviewToken: "blind-token",
            summary: { text: "A limitation-only Summary to score separately." },
            findings: [{
              reviewFindingToken: "blind-finding-token",
              title: "Blinded finding",
              text: "Blinded review text.",
              epistemicStatus: "observed",
              evidenceRefs: ["evidence:1"],
              originKind: "ai-discovery",
              directionMethodResourceIds: [],
            }],
          }],
        },
        reviewAudit: [],
        createdAt: "2026-08-14T00:00:00.000Z",
        updatedAt: "2026-08-14T00:00:00.000Z",
      };
      metadata.energyIq.additionalInsightEvaluations.getEvaluation = vi.fn(() => record as never);
      return record;
    },
    close() {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
};

const evaluationPath = (harness: ReturnType<typeof createHarness>): string[] => [
  "projects", harness.project.id, "additional-ai-insights", "evaluations",
];

const jsonRequest = (method: "POST" | "PUT", body: unknown): IncomingMessage => {
  const request = new PassThrough();
  Object.assign(request, { method, headers: { "content-type": "application/json" }, url: "/api/v1/energy" });
  request.end(JSON.stringify(body));
  return request as unknown as IncomingMessage;
};

const getRequest = (search = ""): IncomingMessage => {
  const request = new PassThrough();
  Object.assign(request, { method: "GET", headers: {}, url: `/api/v1/energy${search}` });
  request.end();
  return request as unknown as IncomingMessage;
};
