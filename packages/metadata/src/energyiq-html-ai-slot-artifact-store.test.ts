import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createMetadataStore } from "./index.js";
import type { EnergyIqOverviewAiArtifactIdentity } from "./energyiq-overview-ai-artifact-store.js";

const identity = (): EnergyIqOverviewAiArtifactIdentity => ({
  workspaceId: "html-workspace",
  projectId: "preschool-demo",
  scopeId: "project",
  resource: "electricity",
  dataSnapshotId: "snapshot-1",
  projectReleaseId: "release-1",
  analysisPeriodFrom: "2026-06-01T00:00:00.000Z",
  analysisPeriodTo: "2026-07-01T00:00:00.000Z",
  rendererKey: "preschool-overview",
  rendererVersion: "1",
  analysisPackId: "preschool-html-ai-slot-pack",
  analysisPackRevision: "v1",
  modelProfileId: "workspace-default",
  modelProfileRevision: 4,
  outputContractRevision: "energyiq-ai-slot-html-artifact@1",
  validatorRevision: "preschool-html-ai-slot-validator@5",
  workflowRevision: "preschool-html-ai-slot-workflow@5",
  investigatorPromptRevision: "preschool-html-slot-prompt@10",
  editorPromptRevision: "not-applicable-v1",
  methodSkillId: "none",
  methodSkillRevision: "not-applicable-v1",
  artifactKind: "html-slot",
  targetId: "centre-benchmark",
  slotDefinitionRevision: "preschool-centre-benchmark-html@2",
  identityContractRevision: "html-slot-v1",
  capabilityRevision: "static-html-sandbox-v2",
  publicationRevision: "html-slot-v1",
});

const result = (overrides: Record<string, unknown> = {}) => ({
  status: "available",
  artifactKind: "html-slot",
  slotId: "centre-benchmark",
  runId: "run-1",
  sessionId: "session-1",
  evidenceRefs: ["evidence:centre:g"],
  identity: {
    workspaceId: "html-workspace",
    projectId: "preschool-demo",
    scopeId: "project",
    dataSnapshotId: "snapshot-1",
    projectReleaseId: "release-1",
    analysisPeriod: { from: "2026-06-01T00:00:00.000Z", to: "2026-07-01T00:00:00.000Z" },
    modelProfileId: "workspace-default",
    modelProfileRevision: 4,
    promptRevision: "preschool-html-slot-prompt@10",
    slotDefinitionRevision: "preschool-centre-benchmark-html@2",
  },
  artifact: {
    contract: "energyiq-ai-slot-html-artifact@1",
    slotId: "centre-benchmark",
    identity: {
      workspaceId: "html-workspace",
      projectId: "preschool-demo",
      scopeId: "project",
      dataSnapshotId: "snapshot-1",
      projectReleaseId: "release-1",
      analysisPeriod: { from: "2026-06-01T00:00:00.000Z", to: "2026-07-01T00:00:00.000Z" },
      modelProfileId: "workspace-default",
      modelProfileRevision: 4,
      promptRevision: "preschool-html-slot-prompt@10",
      slotDefinitionRevision: "preschool-centre-benchmark-html@2",
    },
    evidenceRefs: ["evidence:centre:g"],
    html: "<p>12 kWh</p>",
  },
  acceptance: { status: "accepted", droppedClaims: [] },
  generation: { latencyMs: 12, htmlSha256: createHash("sha256").update("<p>12 kWh</p>").digest("hex") },
  ...overrides,
});

describe("EnergyIqOverviewAiArtifactStore html-slot contract", () => {
  it("stores an accepted HTML Slot result and keeps it immutable", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-html-slot-store-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.workspaces.upsert({ id: "html-workspace", owner_user_id: "dev-user", name: "HTML", kind: "customer" });
      metadata.energyIq.upsertProject({ id: "preschool-demo", workspace_id: "html-workspace", name: "Preschool", status: "published" });
      const queued = metadata.energyIq.overviewAiArtifacts.queue({ identity: identity(), triggeredBy: "dev-user" });
      const claim = metadata.energyIq.overviewAiArtifacts.claim({ identity: identity(), workerId: "worker", leaseMs: 60_000 });
      const payload = JSON.stringify(result());
      const completed = metadata.energyIq.overviewAiArtifacts.complete({
        identity: identity(),
        workerId: claim.artifact.lease_owner!,
        sessionId: "session-1",
        runId: "run-1",
        resultJson: payload,
        allowedEvidenceRefs: ["evidence:centre:g"],
      });
      expect(queued.status).toBe("queued");
      expect(completed.status).toBe("available");
      expect(JSON.parse(completed.result_json!).artifact.html).toBe("<p>12 kWh</p>");
      expect(() => metadata.energyIq.overviewAiArtifacts.complete({
        identity: identity(),
        workerId: "worker",
        sessionId: "session-1",
        runId: "run-2",
        resultJson: JSON.stringify(result({ runId: "run-2" })),
        allowedEvidenceRefs: ["evidence:centre:g"],
      })).toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_IMMUTABLE");
      expect(() => metadata.energyIq.overviewAiArtifacts.complete({
        identity: identity(),
        workerId: "worker",
        sessionId: "session-1",
        runId: "run-1",
        resultJson: JSON.stringify(result({ artifact: { ...(result() as { artifact: Record<string, unknown> }).artifact, html: "<script>x</script>" } })),
        allowedEvidenceRefs: ["evidence:centre:g"],
      })).toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");
      expect(() => metadata.energyIq.overviewAiArtifacts.complete({
        identity: identity(),
        workerId: "worker",
        sessionId: "session-1",
        runId: "run-1",
        resultJson: JSON.stringify(result({ acceptance: undefined })),
        allowedEvidenceRefs: ["evidence:centre:g"],
      })).toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");
      expect(() => metadata.energyIq.overviewAiArtifacts.complete({
        identity: identity(),
        workerId: "worker",
        sessionId: "session-1",
        runId: "run-1",
        resultJson: JSON.stringify(result({ generation: { latencyMs: 12 } })),
        allowedEvidenceRefs: ["evidence:centre:g"],
      })).toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not read a pre-validator artifact through the rotated current identity", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-html-slot-stale-identity-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.workspaces.upsert({ id: "html-workspace", owner_user_id: "dev-user", name: "HTML", kind: "customer" });
      metadata.energyIq.upsertProject({ id: "preschool-demo", workspace_id: "html-workspace", name: "Preschool", status: "published" });
      const current = identity();
      expect(current.validatorRevision).toBe("preschool-html-ai-slot-validator@5");
      const legacy = {
        ...current,
        validatorRevision: "preschool-html-ai-slot-validator@3",
        investigatorPromptRevision: "preschool-html-slot-prompt@8",
        capabilityRevision: "static-html-sandbox-v1",
      } satisfies EnergyIqOverviewAiArtifactIdentity;
      const queued = metadata.energyIq.overviewAiArtifacts.queue({ identity: legacy, triggeredBy: "dev-user" });
      const claim = metadata.energyIq.overviewAiArtifacts.claim({ identity: legacy, workerId: "worker", leaseMs: 60_000 });
      const legacyPayload = result({
        identity: { ...(result() as { identity: Record<string, unknown> }).identity, promptRevision: "preschool-html-slot-prompt@8" },
        artifact: {
          ...(result() as { artifact: Record<string, unknown> }).artifact,
          identity: { ...((result() as { artifact: { identity: Record<string, unknown> } }).artifact.identity), promptRevision: "preschool-html-slot-prompt@8" },
        },
      });
      const completed = metadata.energyIq.overviewAiArtifacts.complete({
        identity: legacy,
        workerId: claim.artifact.lease_owner!,
        sessionId: "session-1",
        runId: "run-1",
        resultJson: JSON.stringify(legacyPayload),
        allowedEvidenceRefs: ["evidence:centre:g"],
      });
      expect(queued.status).toBe("queued");
      expect(completed.status).toBe("available");
      expect(metadata.energyIq.overviewAiArtifacts.find(current)).toBeUndefined();
      expect(metadata.energyIq.overviewAiArtifacts.find(legacy)?.status).toBe("available");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
