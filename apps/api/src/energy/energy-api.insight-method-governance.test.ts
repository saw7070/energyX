import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";

import {
  ADDITIONAL_AI_INSIGHTS_SCOPED_READ_ONLY_TOOLS_V1,
  canonicalInsightMethodSetJson,
  resolveCurrentAdditionalAiInsightMethodSet,
  type AdditionalAiInsightsArtifact,
} from "@datafoundry/contracts";
import { createMetadataStore } from "@datafoundry/metadata";

import type { ConfigApiContext } from "../routes/types.js";
import { ensureEnergyIqBootstrap, PRESCHOOL_WORKSPACE_ID } from "./energy-bootstrap.js";
import { handleEnergyApiRequest } from "./energy-api.js";
import {
  createOverviewAiArtifactIdentity,
  createPreschoolAdditionalAiInsightArtifactIdentity,
} from "./overview-ai-artifact.js";

describe("Additional Insight feedback API", () => {
  it("lets a project member read and change only their own exact Finding vote without trusting browser provenance", async () => {
    const harness = createHarness();
    try {
      const path = findingPath(harness, "feedback");
      const member = { ...harness.context, userId: "second-user" };
      const created = await handleEnergyApiRequest(jsonRequest("PUT", {
        rating: "useful",
        expectedRevision: 0,
        actorId: "dev-user",
        workspaceId: "workspace-forged",
        artifactIdentityHash: "sha256:forged",
        artifactIdentityRevision: "additional-insights-v999",
      }), path, member);
      expect(created).toMatchObject({
        status: 200,
        body: { success: true, data: {
          actorId: "second-user",
          workspaceId: PRESCHOOL_WORKSPACE_ID,
          projectId: harness.project.id,
          artifactId: harness.artifact.id,
          artifactIdentityRevision: "additional-insights-v24",
          findingId: "additional-insight-1",
          rating: "useful",
          revision: 1,
        } },
      });

      const replay = await handleEnergyApiRequest(jsonRequest("PUT", {
        rating: "useful",
        expectedRevision: 0,
      }), path, member);
      expect(replay).toEqual(created);

      const changed = await handleEnergyApiRequest(jsonRequest("PUT", {
        rating: "not-useful",
        expectedRevision: 1,
      }), path, member);
      expect(changed).toMatchObject({
        status: 200,
        body: { success: true, data: { rating: "not-useful", revision: 2 } },
      });

      const own = await handleEnergyApiRequest(getRequest(), path, member);
      expect(own).toMatchObject({
        status: 200,
        body: { success: true, data: { rating: "not-useful", revision: 2, actorId: "second-user" } },
      });
      const adminOwn = await handleEnergyApiRequest(getRequest(), path, harness.context);
      expect(adminOwn).toEqual({ status: 200, body: { success: true, data: null } });

      const wrongWorkspace = await handleEnergyApiRequest(getRequest(), path, {
        ...member,
        workspaceId: "default",
      });
      expect(wrongWorkspace.status).toBe(403);
    } finally {
      harness.close();
    }
  });
});

describe("Additional Insight Finding comment API", () => {
  it("lets only an admin append and read exact Finding comments without trusting browser identity", async () => {
    const harness = createHarness();
    try {
      const path = findingPath(harness, "comments");
      const created = await handleEnergyApiRequest(jsonRequest("POST", {
        idempotencyKey: "comment:admin-review",
        text: "Useful direction; verify the repeat pattern before proposing a Method revision.",
        actorId: "second-user",
        workspaceId: "workspace-forged",
        projectId: "project-forged",
      }), path, harness.context);
      expect(created).toMatchObject({
        status: 201,
        body: { success: true, data: {
          workspaceId: PRESCHOOL_WORKSPACE_ID,
          projectId: harness.project.id,
          artifactId: harness.artifact.id,
          artifactIdentityRevision: "additional-insights-v24",
          findingId: "additional-insight-1",
          actorId: "dev-user",
          text: "Useful direction; verify the repeat pattern before proposing a Method revision.",
        } },
      });
      expect(await handleEnergyApiRequest(jsonRequest("POST", {
        idempotencyKey: "comment:admin-review",
        text: "Useful direction; verify the repeat pattern before proposing a Method revision.",
      }), path, harness.context)).toEqual(created);

      const listed = await handleEnergyApiRequest(getRequest(), path, harness.context);
      expect(listed).toMatchObject({
        status: 200,
        headers: { "Cache-Control": "private, no-store" },
        body: { success: true, data: { comments: [expect.objectContaining({
          id: commentData(created).id,
          actorId: "dev-user",
          findingId: "additional-insight-1",
        })] } },
      });

      const member = { ...harness.context, userId: "second-user" };
      expect(await handleEnergyApiRequest(getRequest(), path, member)).toMatchObject({
        status: 403,
        body: { success: false, error: { code: "FORBIDDEN" } },
      });
      expect(await handleEnergyApiRequest(jsonRequest("POST", {
        idempotencyKey: "comment:member-forbidden",
        text: "This comment must not be appended.",
      }), path, member)).toMatchObject({
        status: 403,
        body: { success: false, error: { code: "FORBIDDEN" } },
      });
      expect(harness.metadata.energyIq.insightMethodGovernance.listFindingComments({
        expectedWorkspaceId: PRESCHOOL_WORKSPACE_ID,
        expectedProjectId: harness.project.id,
        artifactId: harness.artifact.id,
        findingId: "additional-insight-1",
      })).toHaveLength(1);

      expect(await handleEnergyApiRequest(getRequest(), path, {
        ...harness.context,
        workspaceId: "default",
      })).toMatchObject({ status: 403 });
    } finally {
      harness.close();
    }
  });
});

describe("Additional Insight Method Proposal API", () => {
  it("keeps create and submit with the project member while reserving approve and publish for admins", async () => {
    const harness = createHarness();
    try {
      const member = { ...harness.context, userId: "second-user" };
      const createPath = findingPath(harness, "method-proposals");
      const provisional = await handleEnergyApiRequest(jsonRequest("POST", {
        idempotencyKey: "proposal:off-hours-shape",
        title: "Check repeated off-hours event shapes",
        guidance: "Compare repeated event shape and timing before treating an isolated spike as a reusable pattern.",
      }), createPath, member);
      expect(provisional).toMatchObject({
        status: 201,
        body: { success: true, data: {
          status: "provisional",
          revision: 1,
          createdBy: "second-user",
          artifactIdentityRevision: "additional-insights-v24",
        } },
      });
      const proposalId = proposalData(provisional).id;

      const submitted = await handleEnergyApiRequest(jsonRequest("POST", { expectedRevision: 1 }), [
        "projects", harness.project.id, "additional-ai-insights", "method-proposals", proposalId, "submit",
      ], member);
      expect(submitted).toMatchObject({
        status: 200,
        body: { success: true, data: { status: "in-review", revision: 2 } },
      });

      for (const action of ["approve", "publish"]) {
        const forbidden = await handleEnergyApiRequest(jsonRequest("POST", { expectedRevision: 2 }), [
          "projects", harness.project.id, "additional-ai-insights", "method-proposals", proposalId, action,
        ], member);
        expect(forbidden).toMatchObject({ status: 403, body: { success: false, error: { code: "FORBIDDEN" } } });
      }

      const approved = await handleEnergyApiRequest(jsonRequest("POST", { expectedRevision: 2 }), [
        "projects", harness.project.id, "additional-ai-insights", "method-proposals", proposalId, "approve",
      ], harness.context);
      expect(approved).toMatchObject({ status: 200, body: { success: true, data: { status: "approved", revision: 3 } } });
      const published = await handleEnergyApiRequest(jsonRequest("POST", { expectedRevision: 3 }), [
        "projects", harness.project.id, "additional-ai-insights", "method-proposals", proposalId, "publish",
      ], harness.context);
      expect(published).toMatchObject({
        status: 200,
        body: { success: true, data: {
          status: "published",
          revision: 4,
          publication: { actorId: "dev-user", method: { scope: "workspace", workspaceId: PRESCHOOL_WORKSPACE_ID } },
        } },
      });
      const noLongerCurrent = await handleEnergyApiRequest(
        getRequest(),
        findingPath(harness, "feedback"),
        member,
      );
      expect(noLongerCurrent).toMatchObject({
        status: 409,
        body: { success: false, error: { code: "CONFLICT" } },
      });
      const historicalCommentMutation = await handleEnergyApiRequest(jsonRequest("POST", {
        idempotencyKey: "comment:historical-artifact",
        text: "Historical Artifacts must remain immutable.",
      }), findingPath(harness, "comments"), harness.context);
      expect(historicalCommentMutation).toMatchObject({
        status: 201,
        body: { success: true, data: {
          artifactId: harness.artifact.id,
          findingId: "additional-insight-1",
          text: "Historical Artifacts must remain immutable.",
        } },
      });
      expect(harness.metadata.energyIq.insightMethodGovernance.getProposal({
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        projectId: harness.project.id,
        proposalId,
      })).toMatchObject({ status: "published", revision: 4 });

      const listed = await handleEnergyApiRequest(getRequest(), [
        "projects", harness.project.id, "additional-ai-insights", "method-proposals",
      ], harness.context);
      expect(listed).toMatchObject({
        status: 200,
        body: { success: true, data: { proposals: [expect.objectContaining({ id: proposalId, status: "published" })] } },
      });
    } finally {
      harness.close();
    }
  });

  it("rejects cross-tenant, fake Finding, illegal jump, and stale revision mutations", async () => {
    const harness = createHarness();
    try {
      const member = { ...harness.context, userId: "second-user" };
      const fakeFinding = await handleEnergyApiRequest(jsonRequest("POST", {
        idempotencyKey: "proposal:fake",
        title: "Fake",
        guidance: "This source Finding does not exist.",
      }), [
        "projects", harness.project.id, "additional-ai-insights", harness.artifact.id,
        "findings", "finding-does-not-exist", "method-proposals",
      ], member);
      expect(fakeFinding.status).toBe(404);
      const fakeFeedbackRead = await handleEnergyApiRequest(getRequest(), [
        "projects", harness.project.id, "additional-ai-insights", harness.artifact.id,
        "findings", "finding-does-not-exist", "feedback",
      ], member);
      expect(fakeFeedbackRead.status).toBe(404);

      const provisional = await handleEnergyApiRequest(jsonRequest("POST", {
        idempotencyKey: "proposal:conflicts",
        title: "Conflict-safe method",
        guidance: "Review a repeated pattern only after exact Evidence confirms it.",
      }), findingPath(harness, "method-proposals"), member);
      const proposalId = proposalData(provisional).id;
      const illegal = await handleEnergyApiRequest(jsonRequest("POST", { expectedRevision: 1 }), [
        "projects", harness.project.id, "additional-ai-insights", "method-proposals", proposalId, "approve",
      ], harness.context);
      expect(illegal.status).toBe(409);

      await handleEnergyApiRequest(jsonRequest("POST", { expectedRevision: 1 }), [
        "projects", harness.project.id, "additional-ai-insights", "method-proposals", proposalId, "submit",
      ], member);
      const stale = await handleEnergyApiRequest(jsonRequest("POST", { expectedRevision: 1 }), [
        "projects", harness.project.id, "additional-ai-insights", "method-proposals", proposalId, "approve",
      ], harness.context);
      expect(stale.status).toBe(409);

      const crossTenant = await handleEnergyApiRequest(getRequest(), [
        "projects", harness.project.id, "additional-ai-insights", "method-proposals",
      ], { ...harness.context, workspaceId: "default" });
      expect(crossTenant.status).toBe(403);
    } finally {
      harness.close();
    }
  });
});

function createHarness() {
  const root = mkdtempSync(join(tmpdir(), "energy-api-insight-governance-"));
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  ensureEnergyIqBootstrap(metadata);
  metadata.users.upsertDevUser({
    id: "second-user",
    email: "second-user@example.test",
    display_name: "Second User",
    dev_token: "second-user-token",
  });
  metadata.workspaceMemberships.upsert({ workspace_id: PRESCHOOL_WORKSPACE_ID, user_id: "second-user", role: "member" });
  const project = metadata.energyIq.getProject("preschool-demo");
  const baseIdentity = createOverviewAiArtifactIdentity({
    workspaceId: PRESCHOOL_WORKSPACE_ID,
    projectId: project.id,
    scopeId: project.root_scope_id,
    dataSnapshotId: project.data_snapshot_id,
    projectReleaseId: "legacy-profile:preschool-demo:2",
    analysisPeriodFrom: "2026-04-30T16:00:00.000Z",
    analysisPeriodTo: "2026-05-31T16:00:00.000Z",
    rendererKey: "preschool-overview",
    rendererVersion: "1",
    modelProfileId: "workspace-default",
    modelProfileRevision: 1,
  });
  const identity = createPreschoolAdditionalAiInsightArtifactIdentity({ baseIdentity });
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
    project,
    context: {
      metadataStore: metadata,
      userId: "dev-user",
      workspaceId: PRESCHOOL_WORKSPACE_ID,
    } as unknown as Required<ConfigApiContext>,
    close: () => {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}

function additionalResult(identity: ReturnType<typeof createPreschoolAdditionalAiInsightArtifactIdentity>): AdditionalAiInsightsArtifact {
  const methodSet = resolveCurrentAdditionalAiInsightMethodSet(identity.workspaceId);
  const canonical = canonicalInsightMethodSetJson(methodSet.methods)!;
  expect(identity.methodSetFingerprint).toBe(`sha256:${createHash("sha256").update(canonical).digest("hex")}`);
  return {
    artifactKind: "autonomous-insights",
    status: "available",
    providerProfileId: identity.modelProfileId,
    runId: "run-feedback",
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
      sourceId: `project-analysis-snapshot:${identity.projectId}:${identity.dataSnapshotId}`,
      pins: {
        workspaceId: identity.workspaceId,
        projectId: identity.projectId,
        scopeId: identity.scopeId,
        dataSnapshotId: identity.dataSnapshotId,
        dataCutoff: "2026-05-31T15:59:59.000Z",
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

function findingPath(harness: ReturnType<typeof createHarness>, leaf: string): string[] {
  return [
    "projects", harness.project.id, "additional-ai-insights", harness.artifact.id,
    "findings", "additional-insight-1", leaf,
  ];
}

function proposalData(response: Awaited<ReturnType<typeof handleEnergyApiRequest>>): { id: string } {
  if (!("success" in response.body) || response.body.success !== true || !("data" in response.body)
    || typeof response.body.data !== "object" || response.body.data === null || !("id" in response.body.data)
    || typeof response.body.data.id !== "string") throw new Error("test proposal response missing id");
  return response.body.data as { id: string };
}

function commentData(response: Awaited<ReturnType<typeof handleEnergyApiRequest>>): { id: string } {
  if (!("success" in response.body) || response.body.success !== true || !("data" in response.body)
    || typeof response.body.data !== "object" || response.body.data === null || !("id" in response.body.data)
    || typeof response.body.data.id !== "string") throw new Error("test comment response missing id");
  return response.body.data as { id: string };
}

function jsonRequest(method: "POST" | "PUT", body: unknown): IncomingMessage {
  const request = new PassThrough();
  Object.assign(request, { method, headers: { "content-type": "application/json" }, url: "/api/v1/energy" });
  request.end(JSON.stringify(body));
  return request as unknown as IncomingMessage;
}

function getRequest(): IncomingMessage {
  const request = new PassThrough();
  Object.assign(request, { method: "GET", headers: {}, url: "/api/v1/energy" });
  request.end();
  return request as unknown as IncomingMessage;
}
