import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  canonicalInsightMethodSetJson,
  resolveCurrentAdditionalAiInsightMethodSet,
} from "@datafoundry/contracts";
import { describe, expect, it } from "vitest";

import { createMetadataStore } from "./index.js";
import type { EnergyIqOverviewAiArtifactIdentity } from "./energyiq-overview-ai-artifact-store.js";

describe("Tuya Overview AI Artifact isolation", () => {
  it("stores an exact governed Section result and never resolves Snapshot A as Snapshot B", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-tuya-overview-artifact-"));
    const store = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      store.workspaces.upsert({
        id: "tuya-office",
        owner_user_id: "dev-user",
        name: "Tuya Office",
        kind: "customer",
      });
      store.energyIq.upsertProject({
        id: "tuya-office",
        workspace_id: "tuya-office",
        name: "Tuya Office",
        status: "published",
      });
      const snapshotA = identity("snapshot-a", "2026-08-30T16:00:00.000Z");
      const snapshotB = identity("snapshot-b", "2026-08-31T16:00:00.000Z");

      store.energyIq.overviewAiArtifacts.queue({
        identity: snapshotA,
        triggeredBy: "dev-user",
      });
      store.energyIq.overviewAiArtifacts.claim({
        identity: snapshotA,
        workerId: "api-1",
        leaseMs: 60_000,
      });
      const mismatchedReportTime = result(snapshotA, "run-a");
      mismatchedReportTime.binding.reportTime.contextFingerprint = "sha256:different-context";
      expect(() => store.energyIq.overviewAiArtifacts.complete({
        identity: snapshotA,
        workerId: "api-1",
        runId: "run-a",
        sessionId: "session-a",
        resultJson: JSON.stringify(mismatchedReportTime),
      })).toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");
      store.energyIq.overviewAiArtifacts.complete({
        identity: snapshotA,
        workerId: "api-1",
        runId: "run-a",
        sessionId: "session-a",
        resultJson: JSON.stringify(result(snapshotA, "run-a")),
      });

      expect(store.energyIq.overviewAiArtifacts.find(snapshotA)).toMatchObject({
        status: "available",
        data_snapshot_id: "snapshot-a",
      });
      expect(store.energyIq.overviewAiArtifacts.find(snapshotB)).toBeUndefined();

      store.energyIq.overviewAiArtifacts.queue({
        identity: snapshotB,
        triggeredBy: "dev-user",
      });
      expect(store.energyIq.overviewAiArtifacts.find(snapshotB)).toMatchObject({
        status: "queued",
        data_snapshot_id: "snapshot-b",
      });
      expect(store.energyIq.overviewAiArtifacts.find(snapshotA)).toMatchObject({
        status: "available",
        data_snapshot_id: "snapshot-a",
      });
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("queues Additional Insights with the governed Method set and isolates Snapshot A from B", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-tuya-additional-artifact-"));
    const store = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      store.workspaces.upsert({
        id: "tuya-office",
        owner_user_id: "dev-user",
        name: "Tuya Office",
        kind: "customer",
      });
      store.energyIq.upsertProject({
        id: "tuya-office",
        workspace_id: "tuya-office",
        name: "Tuya Office",
        status: "published",
      });
      const methodSet = resolveCurrentAdditionalAiInsightMethodSet(
        "tuya-office",
        store.energyIq.insightMethodGovernance.listPublishedWorkspaceMethodResources({
          workspaceId: "tuya-office",
        }),
      );
      const canonicalMethods = canonicalInsightMethodSetJson(methodSet.methods)!;
      const snapshotA = additionalIdentity(
        "snapshot-a",
        `sha256:${createHash("sha256").update(canonicalMethods).digest("hex")}`,
      );
      const snapshotB = { ...snapshotA, dataSnapshotId: "snapshot-b" };

      expect(store.energyIq.overviewAiArtifacts.queue({
        identity: snapshotA,
        triggeredBy: "dev-user",
      })).toMatchObject({ status: "queued", data_snapshot_id: "snapshot-a" });
      expect(store.energyIq.overviewAiArtifacts.find(snapshotB)).toBeUndefined();
      expect(store.energyIq.overviewAiArtifacts.find(snapshotA)).toMatchObject({
        status: "queued",
        data_snapshot_id: "snapshot-a",
      });
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

const identity = (dataSnapshotId: string, analysisPeriodTo: string): EnergyIqOverviewAiArtifactIdentity => ({
  workspaceId: "tuya-office",
  projectId: "tuya-office",
  scopeId: "tuya-office-project",
  resource: "electricity",
  dataSnapshotId,
  projectReleaseId: "tuya-office-template-v1",
  analysisPeriodFrom: "2026-07-31T16:00:00.000Z",
  analysisPeriodTo,
  rendererKey: "tuya-office-overview",
  rendererVersion: "1",
  analysisPackId: "tuya-office-section-pack",
  analysisPackRevision: "v4",
  modelProfileId: "workspace-default-model-profile",
  modelProfileRevision: 8,
  reportTimePolicyId: "tuya-office-report-time",
  reportTimePolicyRevision: "2",
  reportTimeContextFingerprint: "sha256:tuya-office-current-overview",
  outputContractRevision: "energyiq-project-section-interpretation-v2",
  validatorRevision: "tuya-office-section-acceptance-v4",
  workflowRevision: "energyiq-project-section-discover-publish-v1",
  investigatorPromptRevision: "tuya-office-section-discovery-v4",
  editorPromptRevision: "not-applicable-v1",
  methodSkillId: "none",
  methodSkillRevision: "not-applicable-v1",
  artifactKind: "section-interpretation",
  targetId: "consumption-and-demand",
  identityContractRevision: "tuya-office-section-v3",
  capabilityRevision: "pack-only-v1",
  publicationRevision: "energyiq-project-section-publication-v1",
});

const result = (identityValue: EnergyIqOverviewAiArtifactIdentity, runId: string) => ({
  artifactKind: "section-interpretation",
  status: "available",
  providerProfileId: identityValue.modelProfileId,
  runId,
  contract: {
    id: "energyiq-project-section-interpretation",
    revision: "energyiq-project-section-interpretation-v2",
  },
  binding: {
    workspaceId: identityValue.workspaceId,
    projectId: identityValue.projectId,
    scopeId: identityValue.scopeId,
    dataSnapshotId: identityValue.dataSnapshotId,
    projectReleaseId: identityValue.projectReleaseId,
    analysisPeriod: {
      from: identityValue.analysisPeriodFrom,
      to: identityValue.analysisPeriodTo,
    },
    reportTime: {
      policyId: "tuya-office-report-time",
      policyRevision: "2",
      contextFingerprint: identityValue.reportTimeContextFingerprint,
      windowId: "current-overview",
      from: identityValue.analysisPeriodFrom,
      toExclusive: identityValue.analysisPeriodTo,
      phase: "partial",
    },
    modelProfileId: identityValue.modelProfileId,
    modelProfileRevision: identityValue.modelProfileRevision,
  },
  sectionId: identityValue.targetId,
  packRevision: "v4",
  capability: { revision: "pack-only-v1", mode: "pack-only", tools: [] },
  summary: {
    text: "The current period is partial, so complete-period comparisons remain withheld.",
    evidenceRefs: ["evidence:tuya:coverage"],
    claimRefs: [],
    windowId: "current-overview",
  },
  insights: [],
  publication: {
    policyId: "energyiq-project-section-publication",
    policyRevision: "energyiq-project-section-publication-v1",
    discoveredCount: 0,
    acceptedCount: 0,
    rejectedCount: 0,
    publishedCount: 0,
    suppressedCandidateIds: [],
    rejectedCandidateIds: [],
  },
});

const additionalIdentity = (
  dataSnapshotId: string,
  methodSetFingerprint: string,
): EnergyIqOverviewAiArtifactIdentity => ({
  workspaceId: "tuya-office",
  projectId: "tuya-office",
  scopeId: "tuya-office-project",
  resource: "electricity",
  dataSnapshotId,
  projectReleaseId: "tuya-office-template-v1",
  analysisPeriodFrom: "2026-07-31T16:00:00.000Z",
  analysisPeriodTo: "2026-08-31T16:00:00.000Z",
  rendererKey: "tuya-office-overview",
  rendererVersion: "1",
  analysisPackId: "tuya-office-additional-insights-pack",
  analysisPackRevision: "v1",
  modelProfileId: "workspace-default-model-profile",
  modelProfileRevision: 8,
  reportTimePolicyId: "tuya-office-report-time",
  reportTimePolicyRevision: "2",
  reportTimeContextFingerprint: "sha256:tuya-office-current-overview",
  outputContractRevision: "energyiq-additional-ai-insights-v3",
  validatorRevision: "additional-insights-acceptance-v19",
  workflowRevision: "additional-insights-discover-accept-publish-v21",
  investigatorPromptRevision: "additional-insights-discovery-v13",
  editorPromptRevision: "additional-insights-publication-v2",
  methodSkillId: "none",
  methodSkillRevision: "not-applicable-v1",
  artifactKind: "autonomous-insights",
  identityContractRevision: "tuya-office-additional-insights-v2",
  methodSetId: "preschool-additional-insights-current",
  methodSetRevision: "v1",
  methodSetFingerprint,
  capabilityRevision: "scoped-read-only-v1",
  publicationRevision: "additional-insights-v2",
  canvasRevision: "energyiq-insight-canvas-v2",
});
