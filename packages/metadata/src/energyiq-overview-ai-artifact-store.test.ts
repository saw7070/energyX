import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  ADDITIONAL_AI_INSIGHTS_SCOPED_READ_ONLY_TOOLS_V1,
  CURRENT_ADDITIONAL_AI_INSIGHT_METHOD_SET_ID,
  CURRENT_ADDITIONAL_AI_INSIGHT_METHOD_SET_REVISION,
  canonicalInsightMethodSetJson,
  resolveCurrentAdditionalAiInsightMethodSet,
  type AdditionalAiInsightsArtifact,
  type AdditionalAiInsightsArtifactV1V2,
} from "@datafoundry/contracts";

import { createMetadataStore } from "./index.js";
import type {
  EnergyIqOverviewAiArtifactIdentity,
  EnergyIqOverviewAiArtifactRecord,
} from "./energyiq-overview-ai-artifact-store.js";

const identity = (
  dataSnapshotId: string,
): EnergyIqOverviewAiArtifactIdentity => ({
  workspaceId: "artifact-workspace",
  projectId: "artifact-project",
  scopeId: "artifact-project-scope",
  resource: "electricity",
  dataSnapshotId,
  projectReleaseId: "release-v1",
  analysisPeriodFrom: "2026-05-01T00:00:00.000Z",
  analysisPeriodTo: "2026-06-01T00:00:00.000Z",
  rendererKey: "preschool-overview",
  rendererVersion: "v1",
  analysisPackId: "preschool-analysis-pack",
  analysisPackRevision: "v1",
  modelProfileId: "deepseek-v4-flash",
  modelProfileRevision: 3,
  outputContractRevision: "v13",
  validatorRevision: "preschool-ai-two-stage-fact-boundary-v1",
  workflowRevision: "preschool-two-stage-v1",
  investigatorPromptRevision: "preschool-investigator-v1",
  editorPromptRevision: "preschool-insight-editor-v1",
  methodSkillId: "energy-insight-investigation",
  methodSkillRevision: "1.0.0",
});

type SectionV4Identity = EnergyIqOverviewAiArtifactIdentity & {
  identityContractRevision: string;
  capabilityRevision: string;
  publicationRevision: string;
};

describe("EnergyIqOverviewAiArtifactStore", () => {
  it("single-flights one exact identity and keeps Snapshot A immutable when B is queued", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-overview-artifact-"));
    let metadata: ReturnType<typeof createMetadataStore> | undefined;
    try {
      const store = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      metadata = store;
      store.workspaces.upsert({
        id: "artifact-workspace",
        owner_user_id: "dev-user",
        name: "Artifact",
        kind: "customer",
      });
      store.energyIq.upsertProject({
        id: "artifact-project",
        workspace_id: "artifact-workspace",
        name: "Artifact",
        status: "published",
      });

      const queuedA = store.energyIq.overviewAiArtifacts.queue({
        identity: identity("snapshot-a"),
        triggeredBy: "dev-user",
        now: "2026-08-08T12:00:00.000Z",
      });
      const duplicateA = store.energyIq.overviewAiArtifacts.queue({
        identity: identity("snapshot-a"),
        triggeredBy: "dev-user",
        now: "2026-08-08T12:00:01.000Z",
      });

      expect(duplicateA).toEqual(queuedA);
      expect(JSON.parse(queuedA.identity_json)).toMatchObject({
        workflowRevision: "preschool-two-stage-v1",
        investigatorPromptRevision: "preschool-investigator-v1",
        editorPromptRevision: "preschool-insight-editor-v1",
        methodSkillId: "energy-insight-investigation",
        methodSkillRevision: "1.0.0",
      });
      const firstClaim = store.energyIq.overviewAiArtifacts.claim({
        identity: identity("snapshot-a"),
        workerId: "api-1",
        leaseMs: 60_000,
        now: "2026-08-08T12:00:02.000Z",
      });
      const competingClaim = store.energyIq.overviewAiArtifacts.claim({
        identity: identity("snapshot-a"),
        workerId: "api-2",
        leaseMs: 60_000,
        now: "2026-08-08T12:00:03.000Z",
      });

      expect(firstClaim.claimed).toBe(true);
      expect(firstClaim.artifact).toMatchObject({ status: "running", attempt_count: 1 });
      expect(competingClaim.claimed).toBe(false);

      const resultA = JSON.stringify(acceptedResult(identity("snapshot-a"), "run-a"));
      const completedA = store.energyIq.overviewAiArtifacts.complete({
        identity: identity("snapshot-a"),
        workerId: "api-1",
        runId: "run-a",
        sessionId: "session-a",
        resultJson: resultA,
        now: "2026-08-08T12:00:04.000Z",
      });
      expect(completedA).toMatchObject({
        status: "available",
        data_snapshot_id: "snapshot-a",
        run_id: "run-a",
        result_json: resultA,
      });
      expect(store.energyIq.overviewAiArtifacts.complete({
        identity: identity("snapshot-a"),
        workerId: "api-1",
        runId: "run-a",
        sessionId: "session-a",
        resultJson: resultA,
        now: "2026-08-08T12:00:05.000Z",
      })).toEqual(completedA);
      expect(() => store.energyIq.overviewAiArtifacts.complete({
        identity: identity("snapshot-a"),
        workerId: "api-1",
        runId: "run-other",
        sessionId: "session-a",
        resultJson: JSON.stringify(acceptedResult(identity("snapshot-a"), "run-other")),
        now: "2026-08-08T12:00:06.000Z",
      })).toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_IMMUTABLE");

      const queuedB = store.energyIq.overviewAiArtifacts.queue({
        identity: identity("snapshot-b"),
        triggeredBy: "dev-user",
        now: "2026-08-08T12:00:07.000Z",
      });
      expect(queuedB).toMatchObject({ status: "queued", data_snapshot_id: "snapshot-b" });
      expect(queuedB.id).not.toBe(completedA.id);
      expect(store.energyIq.overviewAiArtifacts.get(identity("snapshot-a"))).toEqual(completedA);
      expect(store.energyIq.overviewAiArtifacts.claim({
        identity: identity("snapshot-b"),
        workerId: "api-1",
        leaseMs: 60_000,
        now: "2026-08-08T12:00:08.000Z",
      }).claimed).toBe(true);
      const invalidResultB = acceptedResult(identity("snapshot-b"), "run-b");
      invalidResultB.findings[0]!.epistemicLevel = "hypothesis";
      invalidResultB.findings[0]!.evidence.deterministic = [];
      expect(() => store.energyIq.overviewAiArtifacts.complete({
        identity: identity("snapshot-b"),
        workerId: "api-1",
        runId: "run-b",
        sessionId: "session-b",
        resultJson: JSON.stringify(invalidResultB),
        now: "2026-08-08T12:00:09.000Z",
      })).toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");
      const revisedEditor = store.energyIq.overviewAiArtifacts.queue({
        identity: { ...identity("snapshot-a"), editorPromptRevision: "preschool-insight-editor-v2" },
        triggeredBy: "dev-user",
        now: "2026-08-08T12:00:10.000Z",
      });
      expect(revisedEditor.id).not.toBe(completedA.id);
    } finally {
      metadata?.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("hashes new value units independently while keeping a legacy identity canonical", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-overview-artifact-kind-"));
    let metadata: ReturnType<typeof createMetadataStore> | undefined;
    try {
      const store = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      metadata = store;
      store.workspaces.upsert({
        id: "artifact-workspace",
        owner_user_id: "dev-user",
        name: "Artifact",
        kind: "customer",
      });
      store.energyIq.upsertProject({
        id: "artifact-project",
        workspace_id: "artifact-workspace",
        name: "Artifact",
        status: "published",
      });

      const legacy = store.energyIq.overviewAiArtifacts.queue({
        identity: identity("snapshot-kind"),
        triggeredBy: "dev-user",
      });
      const benchmarkIdentity: EnergyIqOverviewAiArtifactIdentity = {
        ...identity("snapshot-kind"),
        artifactKind: "section-interpretation",
        targetId: "centre-benchmark",
      };
      const standbyIdentity: EnergyIqOverviewAiArtifactIdentity = {
        ...benchmarkIdentity,
        targetId: "standby-wastage",
      };
      const executiveIdentity: EnergyIqOverviewAiArtifactIdentity = {
        ...identity("snapshot-kind"),
        artifactKind: "executive-synthesis",
        targetId: "sections:none",
      };
      const benchmark = store.energyIq.overviewAiArtifacts.queue({
        identity: benchmarkIdentity,
        triggeredBy: "dev-user",
      });
      const standby = store.energyIq.overviewAiArtifacts.queue({
        identity: standbyIdentity,
        triggeredBy: "dev-user",
      });
      const executive = store.energyIq.overviewAiArtifacts.queue({
        identity: executiveIdentity,
        triggeredBy: "dev-user",
      });

      expect(new Set([legacy.id, benchmark.id, standby.id, executive.id]).size).toBe(4);
      expect(JSON.parse(legacy.identity_json)).not.toHaveProperty("artifactKind");
      expect(JSON.parse(benchmark.identity_json)).toMatchObject({
        artifactKind: "section-interpretation",
        targetId: "centre-benchmark",
      });
      expect(store.energyIq.overviewAiArtifacts.find({
        ...benchmarkIdentity,
        dataSnapshotId: "snapshot-other",
      })).toBeUndefined();
      expect(() => store.energyIq.overviewAiArtifacts.queue({
        identity: { ...identity("snapshot-kind"), artifactKind: "section-interpretation" },
        triggeredBy: "dev-user",
      })).toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_TARGET_REQUIRED");
    } finally {
      metadata?.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("preserves the released v3 Section identity hash exactly", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-overview-artifact-v3-hash-"));
    let metadata: ReturnType<typeof createMetadataStore> | undefined;
    try {
      const store = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      metadata = store;
      seedArtifactProject(store);

      const queued = store.energyIq.overviewAiArtifacts.queue({
        identity: sectionV3Identity("snapshot-v3-stable"),
        triggeredBy: "dev-user",
      });

      expect(queued.identity_hash).toBe("3fcf78c2da58d021f29f489ed87c64ddcb0ee531a9cbc1395ca1107d6321fde5");
      expect(queued.id).toBe("overview-ai-artifact-3fcf78c2da58d021f29f489e");
    } finally {
      metadata?.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("canonicalizes every v4 contract revision and rotates on any revision, Snapshot, Release, model, or period change", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-overview-artifact-v4-identity-"));
    let metadata: ReturnType<typeof createMetadataStore> | undefined;
    try {
      const store = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      metadata = store;
      seedArtifactProject(store);
      const current = sectionV4Identity("snapshot-v4-current");
      const mutations: EnergyIqOverviewAiArtifactIdentity[] = [
        { ...current, identityContractRevision: "v5" } as SectionV4Identity,
        { ...current, analysisPackRevision: "v3" },
        { ...current, outputContractRevision: "preschool-section-interpretation-v5" },
        { ...current, validatorRevision: "acceptance-validator-v3" },
        { ...current, workflowRevision: "discover-tools-accept-publish-v1" },
        { ...current, investigatorPromptRevision: "discovery-prompt-v2" },
        { ...current, capabilityRevision: "scoped-read-only-v2" } as SectionV4Identity,
        { ...current, publicationRevision: "v2" } as SectionV4Identity,
        { ...current, dataSnapshotId: "snapshot-v4-next" },
        { ...current, projectReleaseId: "release-v2" },
        { ...current, modelProfileRevision: 4 },
        { ...current, analysisPeriodTo: "2026-06-02T00:00:00.000Z" },
      ];
      const records = [current, ...mutations].map((artifactIdentity) =>
        store.energyIq.overviewAiArtifacts.queue({ identity: artifactIdentity, triggeredBy: "dev-user" }));

      expect(JSON.parse(records[0]!.identity_json)).toEqual(current);
      expect(new Set(records.map((record) => record.id)).size).toBe(records.length);
    } finally {
      metadata?.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("stores valid v4 available-with-zero-insights and empty results, but rejects missing summary, contract, or capability", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-overview-artifact-v4-result-"));
    let metadata: ReturnType<typeof createMetadataStore> | undefined;
    try {
      const store = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      metadata = store;
      seedArtifactProject(store);

      const availableIdentity = sectionV4Identity("snapshot-v4-available", "centre-benchmark");
      const availableResult = sectionV4Result(availableIdentity, "available");
      availableResult.summary = {
        text: "S".repeat(416),
        evidenceRefs: ["evidence:summary"],
      };
      expect(completeSectionV4(store, availableIdentity, availableResult))
        .toMatchObject({ status: "available", result_json: expect.any(String) });

      const emptyIdentity = sectionV4Identity("snapshot-v4-empty", "planning-outlook");
      expect(completeSectionV4(store, emptyIdentity, sectionV4Result(emptyIdentity, "empty")))
        .toMatchObject({ status: "available", result_json: expect.any(String) });

      const missingSummaryIdentity = sectionV4Identity("snapshot-v4-missing-summary");
      const { summary: _summary, ...withoutSummary } = sectionV4Result(missingSummaryIdentity, "available");
      expect(() => completeSectionV4(store, missingSummaryIdentity, withoutSummary))
        .toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");

      const missingContractIdentity = sectionV4Identity("snapshot-v4-missing-contract");
      const { contract: _contract, ...withoutContract } = sectionV4Result(missingContractIdentity, "available");
      expect(() => completeSectionV4(store, missingContractIdentity, withoutContract))
        .toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");

      const missingCapabilityIdentity = sectionV4Identity("snapshot-v4-missing-capability");
      const { capability: _capability, ...withoutCapability } = sectionV4Result(missingCapabilityIdentity, "available");
      expect(() => completeSectionV4(store, missingCapabilityIdentity, withoutCapability))
        .toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");

      const missingBindingIdentity = sectionV4Identity("snapshot-v4-missing-binding");
      const { binding: _binding, ...withoutBinding } = sectionV4Result(missingBindingIdentity, "available");
      expect(() => completeSectionV4(store, missingBindingIdentity, withoutBinding))
        .toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");

      const missingPublicationIdentity = sectionV4Identity("snapshot-v4-missing-publication");
      const { publication: _publication, ...withoutPublication } = sectionV4Result(missingPublicationIdentity, "available");
      expect(() => completeSectionV4(store, missingPublicationIdentity, withoutPublication))
        .toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");

      const mismatchedIdentity = sectionV4Identity("snapshot-v4-mismatched-identity");
      const mismatchedResult = sectionV4Result(mismatchedIdentity, "available");
      expect(() => completeSectionV4(store, mismatchedIdentity, {
        ...mismatchedResult,
        capability: { revision: "scoped-read-only-v2" },
      })).toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");
    } finally {
      metadata?.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("stores only exact Ngee Ann section results and keeps an empty section terminal", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-overview-artifact-ngee-section-"));
    let metadata: ReturnType<typeof createMetadataStore> | undefined;
    try {
      const store = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      metadata = store;
      seedArtifactProject(store);

      const availableIdentity = ngeeAnnSectionIdentity("snapshot-ngee-available", "time-behaviour");
      expect(completeSectionV4(store, availableIdentity, ngeeAnnSectionResult(availableIdentity, "available")))
        .toMatchObject({ status: "available", result_json: expect.any(String) });

      const emptyIdentity = ngeeAnnSectionIdentity("snapshot-ngee-empty", "decision-priorities");
      expect(completeSectionV4(store, emptyIdentity, ngeeAnnSectionResult(emptyIdentity, "empty")))
        .toMatchObject({ status: "available", result_json: expect.any(String) });

      const holidayIdentity = ngeeAnnSectionIdentity(
        "snapshot-ngee-holiday",
        "school-holiday-comparison",
      );
      expect(completeSectionV4(
        store,
        holidayIdentity,
        ngeeAnnSectionResult(holidayIdentity, "available"),
      )).toMatchObject({ status: "available", result_json: expect.any(String) });

      const historicalIdentity = {
        ...ngeeAnnSectionIdentity("snapshot-ngee-historical", "trend-and-demand"),
        identityContractRevision: "ngee-ann-section-v1",
        analysisPackRevision: "v1",
        validatorRevision: "energyiq-project-section-acceptance-v1",
        investigatorPromptRevision: "energyiq-project-section-discovery-v1",
      };
      expect(completeSectionV4(store, historicalIdentity, {
        ...ngeeAnnSectionResult(historicalIdentity, "available"),
        packRevision: "v1",
      }))
        .toMatchObject({ status: "available", result_json: expect.any(String) });

      const previousIdentity = {
        ...ngeeAnnSectionIdentity("snapshot-ngee-previous", "time-behaviour"),
        identityContractRevision: "ngee-ann-section-v2",
        analysisPackRevision: "v1",
        validatorRevision: "energyiq-project-section-acceptance-v1",
        investigatorPromptRevision: "energyiq-project-section-discovery-v2",
      };
      expect(completeSectionV4(store, previousIdentity, {
        ...ngeeAnnSectionResult(previousIdentity, "available"),
        packRevision: "v1",
      }))
        .toMatchObject({ status: "available", result_json: expect.any(String) });

      const priorCalibrationIdentity = {
        ...ngeeAnnSectionIdentity("snapshot-ngee-prior-calibration", "trend-and-demand"),
        identityContractRevision: "ngee-ann-section-v4",
        analysisPackRevision: "v1",
        validatorRevision: "energyiq-project-section-acceptance-v3",
        investigatorPromptRevision: "energyiq-project-section-discovery-v2",
      };
      const priorCalibrationArtifact = completeSectionV4(
        store,
        priorCalibrationIdentity,
        { ...ngeeAnnSectionResult(priorCalibrationIdentity, "available"), packRevision: "v1" },
      );
      expect(store.energyIq.overviewAiArtifacts.get(priorCalibrationIdentity))
        .toMatchObject({ id: priorCalibrationArtifact.id, status: "available" });

      const priorInferenceIdentity = {
        ...ngeeAnnSectionIdentity("snapshot-ngee-prior-inference", "decision-priorities"),
        identityContractRevision: "ngee-ann-section-v5",
        analysisPackRevision: "v1",
        validatorRevision: "energyiq-project-section-acceptance-v4",
        investigatorPromptRevision: "energyiq-project-section-discovery-v2",
      };
      const priorInferenceArtifact = completeSectionV4(
        store,
        priorInferenceIdentity,
        { ...ngeeAnnSectionResult(priorInferenceIdentity, "available"), packRevision: "v1" },
      );
      expect(store.energyIq.overviewAiArtifacts.get(priorInferenceIdentity))
        .toMatchObject({ id: priorInferenceArtifact.id, status: "available" });

      const priorActionCalibrationIdentity = {
        ...ngeeAnnSectionIdentity("snapshot-ngee-prior-action-calibration", "time-behaviour"),
        identityContractRevision: "ngee-ann-section-v6",
        analysisPackRevision: "v1",
        validatorRevision: "energyiq-project-section-acceptance-v5",
        investigatorPromptRevision: "energyiq-project-section-discovery-v3",
      };
      const priorActionCalibrationArtifact = completeSectionV4(
        store,
        priorActionCalibrationIdentity,
        { ...ngeeAnnSectionResult(priorActionCalibrationIdentity, "available"), packRevision: "v1" },
      );
      expect(store.energyIq.overviewAiArtifacts.get(priorActionCalibrationIdentity))
        .toMatchObject({ id: priorActionCalibrationArtifact.id, status: "available" });

      const priorTimezoneIdentity = {
        ...ngeeAnnSectionIdentity("snapshot-ngee-prior-timezone", "time-behaviour"),
        identityContractRevision: "ngee-ann-section-v7",
        validatorRevision: "energyiq-project-section-acceptance-v5",
        investigatorPromptRevision: "energyiq-project-section-discovery-v4",
      };
      const priorTimezoneArtifact = completeSectionV4(
        store,
        priorTimezoneIdentity,
        ngeeAnnSectionResult(priorTimezoneIdentity, "available"),
      );
      expect(store.energyIq.overviewAiArtifacts.get(priorTimezoneIdentity))
        .toMatchObject({ id: priorTimezoneArtifact.id, status: "available" });

      const priorEnvelopeIdentity = {
        ...ngeeAnnSectionIdentity("snapshot-ngee-prior-envelope", "trend-and-demand"),
        identityContractRevision: "ngee-ann-section-v8",
        validatorRevision: "energyiq-project-section-acceptance-v6",
        investigatorPromptRevision: "energyiq-project-section-discovery-v5",
      };
      const priorEnvelopeArtifact = completeSectionV4(
        store,
        priorEnvelopeIdentity,
        ngeeAnnSectionResult(priorEnvelopeIdentity, "available"),
      );
      expect(store.energyIq.overviewAiArtifacts.get(priorEnvelopeIdentity))
        .toMatchObject({ id: priorEnvelopeArtifact.id, status: "available" });

      const priorSummaryRecoveryIdentity = {
        ...ngeeAnnSectionIdentity("snapshot-ngee-prior-summary-recovery", "circuit-concentration"),
        identityContractRevision: "ngee-ann-section-v9",
        validatorRevision: "energyiq-project-section-acceptance-v7",
        investigatorPromptRevision: "energyiq-project-section-discovery-v5",
      };
      const priorSummaryRecoveryArtifact = completeSectionV4(
        store,
        priorSummaryRecoveryIdentity,
        ngeeAnnSectionResult(priorSummaryRecoveryIdentity, "available"),
      );
      expect(store.energyIq.overviewAiArtifacts.get(priorSummaryRecoveryIdentity))
        .toMatchObject({ id: priorSummaryRecoveryArtifact.id, status: "available" });

      const priorUnitSemanticsIdentity = {
        ...ngeeAnnSectionIdentity("snapshot-ngee-prior-unit-semantics", "time-behaviour"),
        identityContractRevision: "ngee-ann-section-v10",
        validatorRevision: "energyiq-project-section-acceptance-v8",
        investigatorPromptRevision: "energyiq-project-section-discovery-v5",
      };
      const priorUnitSemanticsArtifact = completeSectionV4(
        store,
        priorUnitSemanticsIdentity,
        ngeeAnnSectionResult(priorUnitSemanticsIdentity, "available"),
      );
      expect(store.energyIq.overviewAiArtifacts.get(priorUnitSemanticsIdentity))
        .toMatchObject({ id: priorUnitSemanticsArtifact.id, status: "available" });

      const priorDayTypeGuardIdentity = {
        ...ngeeAnnSectionIdentity("snapshot-ngee-prior-day-type-guard", "time-behaviour"),
        identityContractRevision: "ngee-ann-section-v11",
        validatorRevision: "energyiq-project-section-acceptance-v9",
        investigatorPromptRevision: "energyiq-project-section-discovery-v5",
      };
      const priorDayTypeGuardArtifact = completeSectionV4(
        store,
        priorDayTypeGuardIdentity,
        ngeeAnnSectionResult(priorDayTypeGuardIdentity, "available"),
      );
      expect(store.energyIq.overviewAiArtifacts.get(priorDayTypeGuardIdentity))
        .toMatchObject({ id: priorDayTypeGuardArtifact.id, status: "available" });

      const priorSemanticBindingIdentity = {
        ...ngeeAnnSectionIdentity("snapshot-ngee-prior-semantic-binding", "decision-priorities"),
        identityContractRevision: "ngee-ann-section-v12",
        validatorRevision: "energyiq-project-section-acceptance-v10",
        investigatorPromptRevision: "energyiq-project-section-discovery-v6",
      };
      const priorSemanticBindingArtifact = completeSectionV4(
        store,
        priorSemanticBindingIdentity,
        ngeeAnnSectionResult(priorSemanticBindingIdentity, "available"),
      );
      expect(store.energyIq.overviewAiArtifacts.get(priorSemanticBindingIdentity))
        .toMatchObject({ id: priorSemanticBindingArtifact.id, status: "available" });

      const priorSignedMagnitudeIdentity = {
        ...ngeeAnnSectionIdentity("snapshot-ngee-prior-signed-magnitude", "trend-and-demand"),
        identityContractRevision: "ngee-ann-section-v13",
        validatorRevision: "energyiq-project-section-acceptance-v11",
        investigatorPromptRevision: "energyiq-project-section-discovery-v7",
      };
      const priorSignedMagnitudeArtifact = completeSectionV4(
        store,
        priorSignedMagnitudeIdentity,
        ngeeAnnSectionResult(priorSignedMagnitudeIdentity, "available"),
      );
      expect(store.energyIq.overviewAiArtifacts.get(priorSignedMagnitudeIdentity))
        .toMatchObject({ id: priorSignedMagnitudeArtifact.id, status: "available" });

      const priorClauseBoundaryIdentity = {
        ...ngeeAnnSectionIdentity("snapshot-ngee-prior-clause-boundary", "decision-priorities"),
        identityContractRevision: "ngee-ann-section-v14",
        validatorRevision: "energyiq-project-section-acceptance-v12",
        investigatorPromptRevision: "energyiq-project-section-discovery-v7",
      };
      const priorClauseBoundaryArtifact = completeSectionV4(
        store,
        priorClauseBoundaryIdentity,
        ngeeAnnSectionResult(priorClauseBoundaryIdentity, "available"),
      );
      expect(store.energyIq.overviewAiArtifacts.get(priorClauseBoundaryIdentity))
        .toMatchObject({ id: priorClauseBoundaryArtifact.id, status: "available" });

      const priorTemporalEntityIdentity = {
        ...ngeeAnnSectionIdentity("snapshot-ngee-prior-temporal-entity", "circuit-concentration"),
        identityContractRevision: "ngee-ann-section-v15",
        validatorRevision: "energyiq-project-section-acceptance-v13",
        investigatorPromptRevision: "energyiq-project-section-discovery-v7",
      };
      const priorTemporalEntityArtifact = completeSectionV4(
        store,
        priorTemporalEntityIdentity,
        ngeeAnnSectionResult(priorTemporalEntityIdentity, "available"),
      );
      expect(store.energyIq.overviewAiArtifacts.get(priorTemporalEntityIdentity))
        .toMatchObject({ id: priorTemporalEntityArtifact.id, status: "available" });

      const readableIdentity = ngeeAnnSectionIdentity("snapshot-ngee-readable", "time-behaviour");
      const readableBase = ngeeAnnSectionResult(readableIdentity, "available");
      const readableResult = {
        ...readableBase,
        summary: {
          text: `A supported Ngee Ann Section conclusion. ${"The current analysis remains readable and evidence-linked. ".repeat(9)}`,
          evidenceRefs: ["evidence:ngee:summary"],
        },
        insights: [{
          id: "insight:readable",
          title: "A readable operational conclusion remains available",
          text: `The accepted Section supports this management angle. ${"The detail remains bounded without deleting the whole card. ".repeat(9)}`,
          epistemicStatus: "inferred",
          evidenceRefs: ["evidence:ngee:summary"],
        }],
        publication: {
          ...readableBase.publication,
          discoveredCount: 1,
          acceptedCount: 1,
          publishedCount: 1,
        },
      };
      expect(completeSectionV4(store, readableIdentity, readableResult))
        .toMatchObject({ status: "available", result_json: expect.any(String) });

      const mismatchedIdentity = ngeeAnnSectionIdentity("snapshot-ngee-mismatch", "trend-and-demand");
      expect(() => completeSectionV4(store, mismatchedIdentity, {
        ...ngeeAnnSectionResult(mismatchedIdentity, "available"),
        sectionId: "circuit-concentration",
      })).toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");

      const missingEvidenceIdentity = ngeeAnnSectionIdentity("snapshot-ngee-missing-evidence", "circuit-concentration");
      const malformed = {
        ...ngeeAnnSectionResult(missingEvidenceIdentity, "available"),
        insights: [{
          id: "insight:unsupported",
          title: "Unsupported angle",
          text: "This has no cited Evidence.",
          epistemicStatus: "inferred",
          evidenceRefs: [],
        }],
      };
      expect(() => completeSectionV4(store, missingEvidenceIdentity, malformed))
        .toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");
    } finally {
      metadata?.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("stores only exact Ngee Ann Executive findings with declared Section and Evidence lineage", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-overview-artifact-ngee-executive-"));
    let metadata: ReturnType<typeof createMetadataStore> | undefined;
    try {
      const store = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      metadata = store;
      seedArtifactProject(store);

      const availableIdentity = ngeeAnnExecutiveIdentity("snapshot-ngee-executive");
      expect(completeSectionV4(store, availableIdentity, ngeeAnnExecutiveResult(availableIdentity)))
        .toMatchObject({ status: "available" });

      const historicalIdentity = {
        ...ngeeAnnExecutiveIdentity("snapshot-ngee-executive-historical"),
        identityContractRevision: "ngee-ann-executive-v1",
        validatorRevision: "energyiq-project-executive-acceptance-v1",
        workflowRevision: "energyiq-project-executive-synthesis-v1",
        investigatorPromptRevision: "energyiq-project-executive-prompt-v1",
      };
      expect(completeSectionV4(store, historicalIdentity, ngeeAnnExecutiveResult(historicalIdentity)))
        .toMatchObject({ status: "available" });

      const priorSummaryRecoveryIdentity = {
        ...ngeeAnnExecutiveIdentity("snapshot-ngee-executive-prior-summary-recovery"),
        identityContractRevision: "ngee-ann-executive-v5",
        validatorRevision: "energyiq-project-executive-acceptance-v4",
        investigatorPromptRevision: "energyiq-project-executive-prompt-v1",
      };
      const priorSummaryRecoveryArtifact = completeSectionV4(
        store,
        priorSummaryRecoveryIdentity,
        ngeeAnnExecutiveResult(priorSummaryRecoveryIdentity),
      );
      expect(store.energyIq.overviewAiArtifacts.get(priorSummaryRecoveryIdentity))
        .toMatchObject({ id: priorSummaryRecoveryArtifact.id, status: "available" });

      const readableIdentity = ngeeAnnExecutiveIdentity("snapshot-ngee-executive-readable");
      const readableResult = ngeeAnnExecutiveResult(readableIdentity);
      readableResult.summary.text = (`The accepted Sections support a current management conclusion. ${"The reasoning remains visible, specific, and linked to exact source Evidence. ".repeat(12)}`).slice(0, 656);
      readableResult.findings[0]!.title = "Peak demand and hourly concentration support one coordinated operational management question";
      readableResult.findings[0]!.text = `The accepted Sections support this cross-Section conclusion. ${"The explanation remains bounded without deleting a useful finding. ".repeat(8)}`;
      expect(readableResult.summary.text.length).toBeGreaterThan(600);
      expect(readableResult.summary.text.length).toBeLessThanOrEqual(720);
      expect(completeSectionV4(store, readableIdentity, readableResult))
        .toMatchObject({ status: "available" });

      const mismatchedIdentity = ngeeAnnExecutiveIdentity("snapshot-ngee-executive-mismatch");
      const malformed = ngeeAnnExecutiveResult(mismatchedIdentity);
      malformed.findings[0]!.sectionIds = ["centre-benchmark"];
      expect(() => completeSectionV4(store, mismatchedIdentity, malformed))
        .toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");
    } finally {
      metadata?.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps the immediately previous Section v12 and Executive v10 identities writable for historical completion", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-overview-artifact-previous-current-"));
    let metadata: ReturnType<typeof createMetadataStore> | undefined;
    try {
      const store = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      metadata = store;
      seedArtifactProject(store);

      const previousSectionIdentity: SectionV4Identity = {
        ...sectionV4Identity("snapshot-section-v12-history", "planning-outlook"),
        validatorRevision: "acceptance-validator-v12",
        workflowRevision: "discover-tools-accept-publish-v2",
        investigatorPromptRevision: "discovery-prompt-v11",
      };
      expect(completeSectionV4(
        store,
        previousSectionIdentity,
        sectionV4Result(previousSectionIdentity, "empty"),
      )).toMatchObject({ status: "available" });

      const previousExecutiveIdentity: EnergyIqOverviewAiArtifactIdentity = {
        ...identity("snapshot-executive-v10-history"),
        artifactKind: "executive-synthesis",
        targetId: "sections:history-v10",
        identityContractRevision: "v4",
        analysisPackId: "preschool-executive-section-artifacts",
        analysisPackRevision: "section-interpretation-v4",
        outputContractRevision: "preschool-executive-synthesis-v4",
        validatorRevision: "preschool-executive-synthesis-validator-v19",
        workflowRevision: "preschool-executive-synthesis-v10",
        investigatorPromptRevision: "preschool-executive-synthesis-prompt-v11",
        editorPromptRevision: "not-applicable-v1",
        methodSkillId: "none",
        methodSkillRevision: "not-applicable-v1",
        capabilityRevision: "section-artifacts-and-overview-evidence-v2",
        publicationRevision: "key-findings-v2",
      };
      store.energyIq.overviewAiArtifacts.queue({ identity: previousExecutiveIdentity, triggeredBy: "dev-user" });
      store.energyIq.overviewAiArtifacts.claim({
        identity: previousExecutiveIdentity,
        workerId: "worker:executive:v10",
        leaseMs: 60_000,
      });
      expect(store.energyIq.overviewAiArtifacts.complete({
        identity: previousExecutiveIdentity,
        workerId: "worker:executive:v10",
        sessionId: "session:executive:v10",
        runId: "run:executive:v10",
        resultJson: JSON.stringify({
          artifactKind: "executive-synthesis",
          status: "empty",
          providerProfileId: previousExecutiveIdentity.modelProfileId,
          runId: "run:executive:v10",
          contract: {
            id: "preschool-executive-synthesis",
            revision: "preschool-executive-synthesis-v4",
          },
          binding: {
            workspaceId: previousExecutiveIdentity.workspaceId,
            projectId: previousExecutiveIdentity.projectId,
            scopeId: previousExecutiveIdentity.scopeId,
            dataSnapshotId: previousExecutiveIdentity.dataSnapshotId,
            projectReleaseId: previousExecutiveIdentity.projectReleaseId,
            analysisPeriod: {
              from: previousExecutiveIdentity.analysisPeriodFrom,
              to: previousExecutiveIdentity.analysisPeriodTo,
            },
            modelProfileId: previousExecutiveIdentity.modelProfileId,
            modelProfileRevision: previousExecutiveIdentity.modelProfileRevision,
          },
          sourceSectionArtifactIds: [],
          findings: [],
        }),
      })).toMatchObject({ status: "available" });
    } finally {
      metadata?.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects malformed v4 capability, Evidence, insight budget, and publication accounting", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-overview-artifact-v4-strict-"));
    let metadata: ReturnType<typeof createMetadataStore> | undefined;
    try {
      const store = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      metadata = store;
      seedArtifactProject(store);
      const reject = (suffix: string, mutate: (result: ReturnType<typeof sectionV4Result>) => unknown) => {
        const artifactIdentity = sectionV4Identity(`snapshot-v4-strict-${suffix}`);
        expect(() => completeSectionV4(store, artifactIdentity, mutate(sectionV4Result(artifactIdentity, "available"))))
          .toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");
      };

      const readableIdentity = sectionV4Identity("snapshot-v4-readable-copy");
      const readableResult = {
        ...sectionV4Result(readableIdentity, "available"),
        summary: {
          text: "Evidence-backed summary. ".repeat(20),
          evidenceRefs: ["evidence:summary"],
        },
        limitation: "Evidence limitation. ".repeat(20),
        insights: [{
          ...sectionV4Insight("insight-readable", ["evidence:1"]),
          title: "T".repeat(97),
          label: "L".repeat(49),
          text: "Evidence-backed insight. ".repeat(30),
        }],
        publication: publication({ discovered: 1, accepted: 1, published: 1 }),
      };
      expect(completeSectionV4(store, readableIdentity, readableResult)).toMatchObject({ status: "available" });

      reject("capability-mode", (result) => ({
        ...result,
        capability: { revision: "scoped-read-only-v1", mode: "pack-only", tools: [] },
      }));
      reject("capability-tools", (result) => ({
        ...result,
        capability: { revision: "scoped-read-only-v1", mode: "scoped-read-only", tools: ["compare_centres"] },
      }));
      reject("summary-empty-evidence", (result) => ({
        ...result,
        summary: { text: "Unsupported summary.", evidenceRefs: [] },
      }));
      reject("summary-duplicate-evidence", (result) => ({
        ...result,
        summary: { text: "Duplicated Evidence.", evidenceRefs: ["evidence:summary", "evidence:summary"] },
      }));
      reject("summary-over-safety-budget", (result) => ({
        ...result,
        summary: { text: "S".repeat(4_097), evidenceRefs: ["evidence:summary"] },
      }));
      reject("limitation-over-safety-budget", (result) => ({
        ...result,
        limitation: "L".repeat(4_097),
      }));
      reject("insight-empty-evidence", (result) => ({
        ...result,
        insights: [sectionV4Insight("insight-1", [])],
        publication: publication({ discovered: 1, accepted: 1, published: 1 }),
      }));
      reject("insight-duplicate-evidence", (result) => ({
        ...result,
        insights: [sectionV4Insight("insight-1", ["evidence:1", "evidence:1"])],
        publication: publication({ discovered: 1, accepted: 1, published: 1 }),
      }));
      reject("insight-over-safety-budget", (result) => ({
        ...result,
        insights: [{
          ...sectionV4Insight("insight-1", ["evidence:1"]),
          text: "I".repeat(8_193),
        }],
        publication: publication({ discovered: 1, accepted: 1, published: 1 }),
      }));
      reject("insight-title-over-safety-budget", (result) => ({
        ...result,
        insights: [{
          ...sectionV4Insight("insight-1", ["evidence:1"]),
          title: "T".repeat(513),
        }],
        publication: publication({ discovered: 1, accepted: 1, published: 1 }),
      }));
      reject("four-insights", (result) => ({
        ...result,
        insights: [1, 2, 3, 4].map((index) => sectionV4Insight(`insight-${index}`, [`evidence:${index}`])),
        publication: publication({ discovered: 4, accepted: 4, published: 4 }),
      }));
      reject("publication-count", (result) => ({
        ...result,
        insights: [sectionV4Insight("insight-1", ["evidence:1"])],
        publication: publication({ discovered: 2, accepted: 1, rejected: 0, published: 1 }),
      }));
      reject("suppression-count", (result) => ({
        ...result,
        insights: [sectionV4Insight("insight-1", ["evidence:1"])],
        publication: publication({ discovered: 2, accepted: 2, published: 1, suppressed: [] }),
      }));
      reject("suppression-duplicate", (result) => ({
        ...result,
        insights: [sectionV4Insight("insight-1", ["evidence:1"])],
        publication: publication({
          discovered: 3,
          accepted: 3,
          published: 1,
          suppressed: ["candidate-2", "candidate-2"],
        }),
      }));
    } finally {
      metadata?.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("allows an expired running lease to be reclaimed without creating another artifact", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-overview-artifact-reclaim-"));
    let metadata: ReturnType<typeof createMetadataStore> | undefined;
    try {
      const store = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      metadata = store;
      store.workspaces.upsert({
        id: "artifact-workspace",
        owner_user_id: "dev-user",
        name: "Artifact",
        kind: "customer",
      });
      store.energyIq.upsertProject({
        id: "artifact-project",
        workspace_id: "artifact-workspace",
        name: "Artifact",
        status: "published",
      });
      store.energyIq.overviewAiArtifacts.queue({
        identity: identity("snapshot-a"),
        triggeredBy: "dev-user",
        now: "2026-08-08T12:00:00.000Z",
      });
      store.energyIq.overviewAiArtifacts.claim({
        identity: identity("snapshot-a"),
        workerId: "dead-api",
        leaseMs: 1_000,
        now: "2026-08-08T12:00:01.000Z",
      });

      const reclaimed = store.energyIq.overviewAiArtifacts.claim({
        identity: identity("snapshot-a"),
        workerId: "api-2",
        leaseMs: 60_000,
        now: "2026-08-08T12:00:03.000Z",
      });
      expect(reclaimed).toMatchObject({
        claimed: true,
        artifact: { status: "running", attempt_count: 2, lease_owner: "api-2" },
      });
      expect(store.energyIq.overviewAiArtifacts.claim({
        identity: identity("snapshot-a"),
        workerId: "api-3",
        leaseMs: 60_000,
        now: "2026-08-08T12:02:00.000Z",
      })).toMatchObject({
        claimed: true,
        artifact: { status: "running", attempt_count: 3, lease_owner: "api-3" },
      });
      expect(store.energyIq.overviewAiArtifacts.claim({
        identity: identity("snapshot-a"),
        workerId: "api-4",
        leaseMs: 60_000,
        now: "2026-08-08T12:04:00.000Z",
      })).toMatchObject({
        claimed: false,
        artifact: { status: "failed", attempt_count: 3, error_code: "ATTEMPT_LIMIT_EXCEEDED" },
      });
    } finally {
      metadata?.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("retries a failed exact identity twice, fences stale leases, and keeps available immutable", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-overview-artifact-retry-"));
    let metadata: ReturnType<typeof createMetadataStore> | undefined;
    try {
      const store = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
      metadata = store;
      store.workspaces.upsert({
        id: "artifact-workspace",
        owner_user_id: "dev-user",
        name: "Artifact",
        kind: "customer",
      });
      store.energyIq.upsertProject({
        id: "artifact-project",
        workspace_id: "artifact-workspace",
        name: "Artifact",
        status: "published",
      });
      store.energyIq.overviewAiArtifacts.queue({
        identity: identity("snapshot-retry"),
        triggeredBy: "dev-user",
        now: "2026-08-08T12:00:00.000Z",
      });
      store.energyIq.overviewAiArtifacts.claim({
        identity: identity("snapshot-retry"),
        workerId: "api-1",
        leaseMs: 60_000,
        now: "2026-08-08T12:00:01.000Z",
      });

      expect(() => store.energyIq.overviewAiArtifacts.fail({
        identity: identity("snapshot-retry"),
        workerId: "wrong-owner",
        errorCode: "PROVIDER_TEMPORARY",
        now: "2026-08-08T12:00:02.000Z",
      })).toThrow();
      const failed = store.energyIq.overviewAiArtifacts.fail({
        identity: identity("snapshot-retry"),
        workerId: "api-1",
        errorCode: "PROVIDER_TEMPORARY",
        now: "2026-08-08T12:00:03.000Z",
      });
      expect(failed).toMatchObject({ status: "failed", attempt_count: 1 });

      const retryOwner = store.energyIq.overviewAiArtifacts.claim({
        identity: identity("snapshot-retry"),
        workerId: "api-2",
        leaseMs: 60_000,
        now: "2026-08-08T12:00:04.000Z",
      });
      const competingRetry = store.energyIq.overviewAiArtifacts.claim({
        identity: identity("snapshot-retry"),
        workerId: "api-3",
        leaseMs: 60_000,
        now: "2026-08-08T12:00:04.000Z",
      });
      expect(retryOwner).toMatchObject({
        claimed: true,
        artifact: { status: "running", attempt_count: 2, lease_owner: "api-2" },
      });
      expect(competingRetry).toMatchObject({
        claimed: false,
        artifact: { status: "running", attempt_count: 2, lease_owner: "api-2" },
      });

      const result = JSON.stringify(acceptedResult(identity("snapshot-retry"), "run-retry"));
      expect(() => store.energyIq.overviewAiArtifacts.complete({
        identity: identity("snapshot-retry"),
        workerId: "api-1",
        runId: "run-retry",
        sessionId: "session-retry",
        resultJson: result,
        now: "2026-08-08T12:00:05.000Z",
      })).toThrow();
      expect(() => store.energyIq.overviewAiArtifacts.fail({
        identity: identity("snapshot-retry"),
        workerId: "api-1",
        errorCode: "STALE_OWNER",
        now: "2026-08-08T12:00:05.000Z",
      })).toThrow();
      const completed = store.energyIq.overviewAiArtifacts.complete({
        identity: identity("snapshot-retry"),
        workerId: "api-2",
        runId: "run-retry",
        sessionId: "session-retry",
        resultJson: result,
        now: "2026-08-08T12:00:06.000Z",
      });
      expect(completed).toMatchObject({ status: "available", attempt_count: 2 });
      expect(store.energyIq.overviewAiArtifacts.claim({
        identity: identity("snapshot-retry"),
        workerId: "api-4",
        leaseMs: 60_000,
        now: "2026-08-08T12:00:07.000Z",
      })).toMatchObject({
        claimed: false,
        artifact: { status: "available", attempt_count: 2 },
      });

      store.energyIq.overviewAiArtifacts.queue({
        identity: identity("snapshot-exhausted"),
        triggeredBy: "dev-user",
        now: "2026-08-08T12:01:00.000Z",
      });
      store.energyIq.overviewAiArtifacts.claim({
        identity: identity("snapshot-exhausted"),
        workerId: "api-1",
        leaseMs: 60_000,
        now: "2026-08-08T12:01:01.000Z",
      });
      store.energyIq.overviewAiArtifacts.fail({
        identity: identity("snapshot-exhausted"),
        workerId: "api-1",
        errorCode: "PROVIDER_TEMPORARY",
        now: "2026-08-08T12:01:02.000Z",
      });
      store.energyIq.overviewAiArtifacts.claim({
        identity: identity("snapshot-exhausted"),
        workerId: "api-2",
        leaseMs: 60_000,
        now: "2026-08-08T12:01:03.000Z",
      });
      store.energyIq.overviewAiArtifacts.fail({
        identity: identity("snapshot-exhausted"),
        workerId: "api-2",
        errorCode: "PROVIDER_TEMPORARY",
        now: "2026-08-08T12:01:04.000Z",
      });
      expect(store.energyIq.overviewAiArtifacts.claim({
        identity: identity("snapshot-exhausted"),
        workerId: "api-3",
        leaseMs: 60_000,
        now: "2026-08-08T12:01:05.000Z",
      })).toMatchObject({
        claimed: true,
        artifact: { status: "running", attempt_count: 3, lease_owner: "api-3" },
      });
      store.energyIq.overviewAiArtifacts.fail({
        identity: identity("snapshot-exhausted"),
        workerId: "api-3",
        errorCode: "PROVIDER_TEMPORARY",
        now: "2026-08-08T12:01:06.000Z",
      });
      expect(store.energyIq.overviewAiArtifacts.claim({
        identity: identity("snapshot-exhausted"),
        workerId: "api-4",
        leaseMs: 60_000,
        now: "2026-08-08T12:01:07.000Z",
      })).toMatchObject({
        claimed: false,
        artifact: { status: "failed", attempt_count: 3, error_code: "PROVIDER_TEMPORARY" },
      });
    } finally {
      metadata?.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

const acceptedResult = (artifactIdentity: EnergyIqOverviewAiArtifactIdentity, runId: string) => {
  const binding = {
    projectId: artifactIdentity.projectId,
    scopeId: artifactIdentity.scopeId,
    dataSnapshotId: artifactIdentity.dataSnapshotId,
    projectReleaseId: artifactIdentity.projectReleaseId,
    dataCutoff: "2026-06-01T00:00:00.000Z",
    analysisPeriod: { from: "2026-05-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" },
    outputContractRevision: artifactIdentity.outputContractRevision,
  };
  return {
    status: "available",
    providerProfileId: artifactIdentity.modelProfileId,
    runId,
    packId: artifactIdentity.analysisPackId,
    packRevision: artifactIdentity.analysisPackRevision,
    contract: { id: "preschool-ai-accepted-artifact", revision: artifactIdentity.outputContractRevision },
    binding,
    workflow: {
      id: "preschool-two-stage",
      revision: artifactIdentity.workflowRevision,
      methodSkill: { id: artifactIdentity.methodSkillId, revision: artifactIdentity.methodSkillRevision },
      stages: {
        investigator: { runId: "investigator-run", promptRevision: artifactIdentity.investigatorPromptRevision },
        editor: { runId, promptRevision: artifactIdentity.editorPromptRevision },
      },
    },
    findings: [{
      id: "benchmark-finding",
      binding,
      placementTargets: ["preschool.benchmark"],
      epistemicLevel: "verified",
      relationship: "supports",
      signalRefs: ["efficiency"],
      title: "Benchmark gap persists across normalisations",
      takeaway: "The current Snapshot supports a focused operating review.",
      evidence: {
        snapshotId: artifactIdentity.dataSnapshotId,
        period: binding.analysisPeriod,
        deterministic: [{
          id: "benchmark:portfolio",
          kind: "benchmark",
          label: "Portfolio benchmark",
          unit: "kWh/m2/year",
          values: { actual: 120 },
          queryIds: ["benchmark-query"],
          limitation: null,
        }],
        tools: [],
      },
    }],
  };
};

const seedArtifactProject = (store: ReturnType<typeof createMetadataStore>) => {
  store.workspaces.upsert({
    id: "artifact-workspace",
    owner_user_id: "dev-user",
    name: "Artifact",
    kind: "customer",
  });
  store.energyIq.upsertProject({
    id: "artifact-project",
    workspace_id: "artifact-workspace",
    name: "Artifact",
    status: "published",
  });
};

const sectionV3Identity = (
  dataSnapshotId: string,
  targetId = "centre-benchmark",
): EnergyIqOverviewAiArtifactIdentity => ({
  ...identity(dataSnapshotId),
  analysisPackId: "preschool-analysis-pack",
  analysisPackRevision: "v1",
  outputContractRevision: "preschool-section-interpretation-v3",
  validatorRevision: "preschool-section-interpreter-validator-v12",
  workflowRevision: "preschool-section-interpreter-v14",
  investigatorPromptRevision: "preschool-section-interpreter-prompt-v14",
  editorPromptRevision: "not-applicable-v1",
  methodSkillId: "none",
  methodSkillRevision: "not-applicable-v1",
  artifactKind: "section-interpretation",
  targetId,
});

const sectionV4Identity = (
  dataSnapshotId: string,
  targetId = "centre-benchmark",
): SectionV4Identity => ({
  ...sectionV3Identity(dataSnapshotId, targetId),
  identityContractRevision: "v4",
  analysisPackId: "preschool-section-pack",
  analysisPackRevision: "v2",
  outputContractRevision: "preschool-section-interpretation-v4",
  validatorRevision: "acceptance-validator-v18",
  workflowRevision: "discover-tools-accept-publish-v4",
  investigatorPromptRevision: "discovery-prompt-v14",
  capabilityRevision: "scoped-read-only-v1",
  publicationRevision: "v1",
});

const ngeeAnnSectionIdentity = (
  dataSnapshotId: string,
  targetId: string,
): SectionV4Identity => ({
  ...sectionV3Identity(dataSnapshotId, targetId),
  rendererKey: "ngee-ann-overview",
  identityContractRevision: "ngee-ann-section-v16",
  analysisPackId: "ngee-ann-section-pack",
  analysisPackRevision: "v2",
  outputContractRevision: "energyiq-project-section-interpretation-v1",
  validatorRevision: "energyiq-project-section-acceptance-v14",
  workflowRevision: "energyiq-project-section-discover-publish-v1",
  investigatorPromptRevision: "energyiq-project-section-discovery-v8",
  capabilityRevision: "pack-only-v1",
  publicationRevision: "energyiq-project-section-publication-v1",
});

const ngeeAnnSectionResult = (
  artifactIdentity: SectionV4Identity,
  status: "available" | "empty",
) => ({
  artifactKind: "section-interpretation" as const,
  status,
  providerProfileId: artifactIdentity.modelProfileId,
  runId: `run:${artifactIdentity.dataSnapshotId}`,
  contract: {
    id: "energyiq-project-section-interpretation",
    revision: "energyiq-project-section-interpretation-v1",
  },
  binding: {
    workspaceId: artifactIdentity.workspaceId,
    projectId: artifactIdentity.projectId,
    scopeId: artifactIdentity.scopeId,
    dataSnapshotId: artifactIdentity.dataSnapshotId,
    projectReleaseId: artifactIdentity.projectReleaseId,
    analysisPeriod: {
      from: artifactIdentity.analysisPeriodFrom,
      to: artifactIdentity.analysisPeriodTo,
    },
    modelProfileId: artifactIdentity.modelProfileId,
    modelProfileRevision: artifactIdentity.modelProfileRevision,
  },
  sectionId: artifactIdentity.targetId,
  packRevision: "v2",
  capability: {
    revision: "pack-only-v1",
    mode: "pack-only",
    tools: [],
  },
  ...(status === "available"
    ? { summary: { text: "A concise Ngee Ann Section summary.", evidenceRefs: ["evidence:ngee:summary"] } }
    : {}),
  insights: [],
  publication: {
    policyId: "energyiq-project-section-publication",
    policyRevision: "energyiq-project-section-publication-v1",
    discoveredCount: 0,
    acceptedCount: 0,
    rejectedCount: 0,
    publishedCount: 0,
    suppressedCandidateIds: [],
  },
});

const ngeeAnnExecutiveIdentity = (
  dataSnapshotId: string,
): SectionV4Identity => ({
  ...sectionV3Identity(dataSnapshotId, "sections:test-v1"),
  rendererKey: "ngee-ann-overview",
  artifactKind: "executive-synthesis",
  identityContractRevision: "ngee-ann-executive-v7",
  analysisPackId: "ngee-ann-section-artifacts",
  analysisPackRevision: "v1",
  outputContractRevision: "energyiq-project-executive-synthesis-v1",
  validatorRevision: "energyiq-project-executive-acceptance-v6",
  workflowRevision: "energyiq-project-executive-synthesis-v2",
  investigatorPromptRevision: "energyiq-project-executive-prompt-v2",
  capabilityRevision: "section-artifacts-v1",
  publicationRevision: "energyiq-project-key-findings-v1",
});

const ngeeAnnExecutiveResult = (identity: SectionV4Identity) => ({
  artifactKind: "executive-synthesis" as const,
  status: "available" as const,
  providerProfileId: identity.modelProfileId,
  runId: `run:${identity.dataSnapshotId}`,
  contract: {
    id: "energyiq-project-executive-synthesis",
    revision: "energyiq-project-executive-synthesis-v1",
  },
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
  sourceSectionArtifactIds: ["artifact:trend", "artifact:time"],
  summary: { text: "Two Ngee Ann Sections support a cross-Section reading.", evidenceRefs: ["evidence:trend"] },
  findings: [{
    id: "finding:ngee",
    title: "A cross-Section management angle",
    text: "The accepted Sections point to a shared line of inquiry.",
    epistemicStatus: "inferred",
    sectionIds: ["trend-and-demand", "time-behaviour"],
    sourceInsightIds: ["insight:trend", "insight:time"],
    evidenceRefs: ["evidence:trend", "evidence:time"],
  }],
});

const sectionV4Result = (
  artifactIdentity: SectionV4Identity,
  status: "available" | "empty",
) => ({
  artifactKind: "section-interpretation" as const,
  status,
  providerProfileId: artifactIdentity.modelProfileId,
  runId: `run:${artifactIdentity.dataSnapshotId}`,
  contract: {
    id: "preschool-section-interpretation",
    revision: "preschool-section-interpretation-v4",
  },
  binding: {
    workspaceId: artifactIdentity.workspaceId,
    projectId: artifactIdentity.projectId,
    scopeId: artifactIdentity.scopeId,
    dataSnapshotId: artifactIdentity.dataSnapshotId,
    projectReleaseId: artifactIdentity.projectReleaseId,
    analysisPeriod: {
      from: artifactIdentity.analysisPeriodFrom,
      to: artifactIdentity.analysisPeriodTo,
    },
    modelProfileId: artifactIdentity.modelProfileId,
    modelProfileRevision: artifactIdentity.modelProfileRevision,
  },
  sectionId: artifactIdentity.targetId,
  packRevision: "v2",
  capability: {
    revision: "scoped-read-only-v1",
    mode: "scoped-read-only",
    tools: sectionV4Tools(artifactIdentity.targetId ?? ""),
  },
  toolAudits: [],
  ...(status === "available"
    ? { summary: { text: "The Section has a concise evidence-backed summary.", evidenceRefs: ["evidence:summary"] } }
    : {}),
  insights: [],
  publication: {
    policyId: "preschool-section-publication",
    policyRevision: "v1",
    discoveredCount: 0,
    acceptedCount: 0,
    rejectedCount: 0,
    publishedCount: 0,
    suppressedCandidateIds: [],
  },
});

const sectionV4Tools = (sectionId: string) => {
  switch (sectionId) {
    case "centre-benchmark":
      return ["compare_centres", "inspect_related_section_signals"];
    case "standby-wastage":
    case "operating-behaviour":
      return ["inspect_time_pattern", "inspect_load_composition", "inspect_related_section_signals"];
    case "planning-outlook":
      return ["inspect_related_section_signals"];
    default:
      return [];
  }
};

const sectionV4Insight = (id: string, evidenceRefs: string[]) => ({
  id,
  title: "A concise supported angle",
  epistemicStatus: "inferred",
  text: "The supplied Evidence supports this relationship.",
  evidenceRefs,
});

const publication = (input: {
  discovered: number;
  accepted: number;
  rejected?: number;
  published: number;
  suppressed?: string[];
}) => ({
  policyId: "preschool-section-publication",
  policyRevision: "v1",
  discoveredCount: input.discovered,
  acceptedCount: input.accepted,
  rejectedCount: input.rejected ?? input.discovered - input.accepted,
  publishedCount: input.published,
  suppressedCandidateIds: input.suppressed ?? [],
});

const completeSectionV4 = (
  store: ReturnType<typeof createMetadataStore>,
  artifactIdentity: SectionV4Identity,
  result: unknown,
) => {
  store.energyIq.overviewAiArtifacts.queue({ identity: artifactIdentity, triggeredBy: "dev-user" });
  const workerId = `worker:${artifactIdentity.dataSnapshotId}`;
  store.energyIq.overviewAiArtifacts.claim({ identity: artifactIdentity, workerId, leaseMs: 60_000 });
  return store.energyIq.overviewAiArtifacts.complete({
    identity: artifactIdentity,
    workerId,
    sessionId: `session:${artifactIdentity.dataSnapshotId}`,
    runId: `run:${artifactIdentity.dataSnapshotId}`,
    resultJson: JSON.stringify(result),
  });
};

describe("EnergyIqOverviewAiArtifactStore current Additional AI Insights", () => {
  it("persists only an exact shared Method-set Artifact and keeps empty as a valid terminal result", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-additional-insights-artifact-"));
    const databasePath = join(root, "metadata.sqlite");
    const metadata = createMetadataStore({ database_path: databasePath });
    try {
      metadata.workspaces.upsert({
        id: "artifact-workspace",
        owner_user_id: "dev-user",
        name: "Artifact",
        kind: "customer",
      });
      metadata.energyIq.upsertProject({
        id: "artifact-project",
        workspace_id: "artifact-workspace",
        name: "Artifact",
        status: "published",
      });
      const availableIdentity = additionalIdentity("snapshot-additional-available");
      const availableArtifact = completeAdditional(
        metadata,
        availableIdentity,
        additionalResult(availableIdentity, "available"),
      );
      expect(availableArtifact).toMatchObject({ status: "available" });

      const ngeeAnnIdentity: EnergyIqOverviewAiArtifactIdentity = {
        ...additionalIdentity("snapshot-additional-ngee-ann"),
        rendererKey: "ngee-ann-overview",
        identityContractRevision: "ngee-ann-additional-insights-v4",
        analysisPackId: "ngee-ann-additional-insights-pack",
        validatorRevision: "additional-insights-acceptance-v18",
        workflowRevision: "additional-insights-discover-accept-publish-v21",
        investigatorPromptRevision: "additional-insights-discovery-v11",
      };
      expect(metadata.energyIq.overviewAiArtifacts.queue({
        identity: ngeeAnnIdentity,
        triggeredBy: "dev-user",
      })).toMatchObject({ status: "queued" });
      const ngeeAnnArtifact = completeAdditional(
        metadata,
        ngeeAnnIdentity as AdditionalIdentity,
        additionalResult(ngeeAnnIdentity as AdditionalIdentity, "available"),
      );
      const historicalNgeeAnnV3 = {
        ...ngeeAnnIdentity,
        identityContractRevision: "ngee-ann-additional-insights-v3",
        validatorRevision: "additional-insights-acceptance-v17",
        workflowRevision: "additional-insights-discover-accept-publish-v20",
      };
      seedHistoricalTerminalArtifact({
        databasePath,
        source: ngeeAnnArtifact,
        identity: historicalNgeeAnnV3,
      });
      expect(metadata.energyIq.overviewAiArtifacts.get(historicalNgeeAnnV3))
        .toMatchObject({ status: "available", result_json: expect.any(String) });
      expect(() => metadata.energyIq.overviewAiArtifacts.queue({
        identity: {
          ...historicalNgeeAnnV3,
        },
        triggeredBy: "dev-user",
      })).toThrow("ENERGYIQ_ADDITIONAL_INSIGHT_CURRENT_IDENTITY_REQUIRED");

      const historicalV3Identity = historicalAdditionalIdentityV3(availableIdentity);
      expect(() => metadata.energyIq.overviewAiArtifacts.queue({
        identity: historicalV3Identity,
        triggeredBy: "dev-user",
      })).toThrow("ENERGYIQ_ADDITIONAL_INSIGHT_CURRENT_IDENTITY_REQUIRED");

      expect(() => metadata.energyIq.overviewAiArtifacts.queue({
        identity: historicalAdditionalIdentityV21(availableIdentity),
        triggeredBy: "dev-user",
      })).toThrow("ENERGYIQ_ADDITIONAL_INSIGHT_CURRENT_IDENTITY_REQUIRED");

      const sameOutputHistoricalIdentity = historicalAdditionalIdentityV2(availableIdentity);
      expect(sameOutputHistoricalIdentity.outputContractRevision)
        .toBe(availableIdentity.outputContractRevision);
      expect(() => metadata.energyIq.overviewAiArtifacts.queue({
        identity: sameOutputHistoricalIdentity,
        triggeredBy: "dev-user",
      })).toThrow("ENERGYIQ_ADDITIONAL_INSIGHT_CURRENT_IDENTITY_REQUIRED");

      const emptyIdentity = additionalIdentity("snapshot-additional-empty");
      expect(completeAdditional(metadata, emptyIdentity, additionalResult(emptyIdentity, "empty")))
        .toMatchObject({ status: "available" });

      const historicalBase = additionalIdentity("snapshot-additional-historical-v1");
      const historicalIdentity = historicalAdditionalIdentity(historicalBase);
      expect(() => metadata.energyIq.overviewAiArtifacts.queue({
        identity: historicalIdentity,
        triggeredBy: "dev-user",
      })).toThrow("ENERGYIQ_ADDITIONAL_INSIGHT_CURRENT_IDENTITY_REQUIRED");

      const driftIdentity = additionalIdentity("snapshot-additional-drift");
      const drift = additionalResult(driftIdentity, "available");
      drift.methodExecution.loadedMethods[0] = {
        ...drift.methodExecution.loadedMethods[0]!,
        contentSha256: "f".repeat(64),
      };
      expect(() => completeAdditional(metadata, driftIdentity, drift))
        .toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");

      const selfApprovedIdentity = additionalIdentity("snapshot-additional-self-approved");
      const selfApproved = additionalResult(selfApprovedIdentity, "available");
      Object.assign(selfApproved.methodExecution, {
        approvedMethods: [{
          ...selfApproved.methodExecution.loadedMethods[0]!,
          skillId: "artifact-self-approved",
          resourceId: "skill:artifact-self-approved",
        }],
      });
      expect(() => completeAdditional(metadata, selfApprovedIdentity, selfApproved))
        .toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");

      expect(() => metadata.energyIq.overviewAiArtifacts.queue({
        identity: { ...availableIdentity, methodSetFingerprint: `sha256:${"f".repeat(64)}` },
        triggeredBy: "dev-user",
      })).toThrow("ENERGYIQ_ADDITIONAL_INSIGHT_METHOD_SET_IDENTITY_INVALID");

      expect(() => metadata.energyIq.overviewAiArtifacts.queue({
        identity: { ...availableIdentity, targetId: "method-set:forbidden" },
        triggeredBy: "dev-user",
      })).toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_TARGET_FORBIDDEN");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps historical terminal lookup independent from the current published Method registry", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-additional-history-method-rotation-"));
    const databasePath = join(root, "metadata.sqlite");
    const metadata = createMetadataStore({ database_path: databasePath });
    try {
      for (const [id, email] of [
        ["admin-reviewer", "reviewer@example.test"],
        ["admin-publisher", "publisher@example.test"],
      ] as const) {
        metadata.users.upsertDevUser({
          id,
          email,
          display_name: id,
          dev_token: `${id}-token`,
        });
      }
      seedArtifactProject(metadata);
      const currentIdentity = additionalIdentity("snapshot-additional-before-method");
      const currentArtifact = completeAdditional(
        metadata,
        currentIdentity,
        additionalResult(currentIdentity, "available"),
      );
      const historicalIdentity = historicalAdditionalIdentityV3(currentIdentity);
      const historicalV4Identity = historicalAdditionalIdentityV4(currentIdentity);
      const historicalV5Identity = historicalAdditionalIdentityV5(currentIdentity);
      const historicalV6Identity = historicalAdditionalIdentityV6(currentIdentity);
      const historicalV7Identity = historicalAdditionalIdentityV7(currentIdentity);
      const historicalV8Identity = historicalAdditionalIdentityV8(currentIdentity);
      const historicalV9Identity = historicalAdditionalIdentityV9(currentIdentity);
      const historicalV10Identity = historicalAdditionalIdentityV10(currentIdentity);
      const historicalV11Identity = historicalAdditionalIdentityV11(currentIdentity);
      const historicalV12Identity = historicalAdditionalIdentityV12(currentIdentity);
      const historicalV13Identity = historicalAdditionalIdentityV13(currentIdentity);
      const historicalV14Identity = historicalAdditionalIdentityV14(currentIdentity);
      const historicalV15Identity = historicalAdditionalIdentityV15(currentIdentity);
      const historicalV16Identity = historicalAdditionalIdentityV16(currentIdentity);
      const historicalV17Identity = historicalAdditionalIdentityV17(currentIdentity);
      const historicalV18Identity = historicalAdditionalIdentityV18(currentIdentity);
      const historicalV19Identity = historicalAdditionalIdentityV19(currentIdentity);
      const historicalV20Identity = historicalAdditionalIdentityV20(currentIdentity);
      const historicalV21Identity = historicalAdditionalIdentityV21(currentIdentity);
      const historicalV22Identity = historicalAdditionalIdentityV22(currentIdentity);
      const historicalV23Identity = historicalAdditionalIdentityV23(currentIdentity);
      seedHistoricalTerminalArtifact({
        databasePath,
        source: currentArtifact,
        identity: historicalIdentity,
      });
      seedHistoricalTerminalArtifact({
        databasePath,
        source: currentArtifact,
        identity: historicalV4Identity,
      });
      seedHistoricalTerminalArtifact({
        databasePath,
        source: currentArtifact,
        identity: historicalV5Identity,
      });
      seedHistoricalTerminalArtifact({
        databasePath,
        source: currentArtifact,
        identity: historicalV6Identity,
      });
      seedHistoricalTerminalArtifact({
        databasePath,
        source: currentArtifact,
        identity: historicalV7Identity,
      });
      seedHistoricalTerminalArtifact({
        databasePath,
        source: currentArtifact,
        identity: historicalV8Identity,
      });
      seedHistoricalTerminalArtifact({
        databasePath,
        source: currentArtifact,
        identity: historicalV9Identity,
      });
      seedHistoricalTerminalArtifact({
        databasePath,
        source: currentArtifact,
        identity: historicalV10Identity,
      });
      seedHistoricalTerminalArtifact({
        databasePath,
        source: currentArtifact,
        identity: historicalV11Identity,
      });
      seedHistoricalTerminalArtifact({
        databasePath,
        source: currentArtifact,
        identity: historicalV12Identity,
      });
      seedHistoricalTerminalArtifact({
        databasePath,
        source: currentArtifact,
        identity: historicalV13Identity,
      });
      seedHistoricalTerminalArtifact({
        databasePath,
        source: currentArtifact,
        identity: historicalV14Identity,
      });
      seedHistoricalTerminalArtifact({
        databasePath,
        source: currentArtifact,
        identity: historicalV15Identity,
      });
      seedHistoricalTerminalArtifact({
        databasePath,
        source: currentArtifact,
        identity: historicalV16Identity,
      });
      seedHistoricalTerminalArtifact({
        databasePath,
        source: currentArtifact,
        identity: historicalV17Identity,
      });
      seedHistoricalTerminalArtifact({
        databasePath,
        source: currentArtifact,
        identity: historicalV18Identity,
      });
      seedHistoricalTerminalArtifact({
        databasePath,
        source: currentArtifact,
        identity: historicalV19Identity,
      });
      seedHistoricalTerminalArtifact({
        databasePath,
        source: currentArtifact,
        identity: historicalV20Identity,
      });
      seedHistoricalTerminalArtifact({
        databasePath,
        source: currentArtifact,
        identity: historicalV21Identity,
      });
      seedHistoricalTerminalArtifact({
        databasePath,
        source: currentArtifact,
        identity: historicalV22Identity,
      });
      seedHistoricalTerminalArtifact({
        databasePath,
        source: currentArtifact,
        identity: historicalV23Identity,
      });
      const historicalArtifact = metadata.energyIq.overviewAiArtifacts.get(historicalIdentity);
      const historicalV4Artifact = metadata.energyIq.overviewAiArtifacts.get(historicalV4Identity);
      const historicalV5Artifact = metadata.energyIq.overviewAiArtifacts.get(historicalV5Identity);
      const historicalV6Artifact = metadata.energyIq.overviewAiArtifacts.get(historicalV6Identity);
      const historicalV7Artifact = metadata.energyIq.overviewAiArtifacts.get(historicalV7Identity);
      const historicalV8Artifact = metadata.energyIq.overviewAiArtifacts.get(historicalV8Identity);
      const historicalV9Artifact = metadata.energyIq.overviewAiArtifacts.get(historicalV9Identity);
      const historicalV10Artifact = metadata.energyIq.overviewAiArtifacts.get(historicalV10Identity);
      const historicalV11Artifact = metadata.energyIq.overviewAiArtifacts.get(historicalV11Identity);
      const historicalV12Artifact = metadata.energyIq.overviewAiArtifacts.get(historicalV12Identity);
      const historicalV13Artifact = metadata.energyIq.overviewAiArtifacts.get(historicalV13Identity);
      const historicalV14Artifact = metadata.energyIq.overviewAiArtifacts.get(historicalV14Identity);
      const historicalV15Artifact = metadata.energyIq.overviewAiArtifacts.get(historicalV15Identity);
      const historicalV16Artifact = metadata.energyIq.overviewAiArtifacts.get(historicalV16Identity);
      const historicalV17Artifact = metadata.energyIq.overviewAiArtifacts.get(historicalV17Identity);
      const historicalV18Artifact = metadata.energyIq.overviewAiArtifacts.get(historicalV18Identity);
      const historicalV19Artifact = metadata.energyIq.overviewAiArtifacts.get(historicalV19Identity);
      const historicalV20Artifact = metadata.energyIq.overviewAiArtifacts.get(historicalV20Identity);
      const historicalV21Artifact = metadata.energyIq.overviewAiArtifacts.get(historicalV21Identity);
      const historicalV22Artifact = metadata.energyIq.overviewAiArtifacts.get(historicalV22Identity);
      const historicalV23Artifact = metadata.energyIq.overviewAiArtifacts.get(historicalV23Identity);
      const proposal = metadata.energyIq.insightMethodGovernance.createProposal({
        expectedWorkspaceId: "artifact-workspace",
        expectedProjectId: "artifact-project",
        artifactId: currentArtifact.id,
        findingId: "additional-insight-1",
        actorId: "dev-user",
        idempotencyKey: "proposal:historical-artifact-read",
        title: "Check repeated off-hours event shapes",
        guidance: "Compare repeated event shape and timing before treating an isolated spike as reusable.",
      });
      const inReview = metadata.energyIq.insightMethodGovernance.submitProposal({
        workspaceId: "artifact-workspace",
        projectId: "artifact-project",
        proposalId: proposal.id,
        actorId: "dev-user",
        expectedRevision: proposal.revision,
      });
      const approved = metadata.energyIq.insightMethodGovernance.approveProposal({
        workspaceId: "artifact-workspace",
        projectId: "artifact-project",
        proposalId: proposal.id,
        actorId: "admin-reviewer",
        expectedRevision: inReview.revision,
      });
      metadata.energyIq.insightMethodGovernance.publishProposal({
        workspaceId: "artifact-workspace",
        projectId: "artifact-project",
        proposalId: proposal.id,
        actorId: "admin-publisher",
        expectedRevision: approved.revision,
      });

      expect(metadata.energyIq.overviewAiArtifacts.find(historicalIdentity)).toEqual(historicalArtifact);
      expect(metadata.energyIq.overviewAiArtifacts.get(historicalIdentity)).toEqual(historicalArtifact);
      expect(metadata.energyIq.overviewAiArtifacts.find(historicalV4Identity)).toEqual(historicalV4Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.get(historicalV4Identity)).toEqual(historicalV4Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.find(historicalV5Identity)).toEqual(historicalV5Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.get(historicalV5Identity)).toEqual(historicalV5Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.find(historicalV6Identity)).toEqual(historicalV6Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.get(historicalV6Identity)).toEqual(historicalV6Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.find(historicalV7Identity)).toEqual(historicalV7Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.get(historicalV7Identity)).toEqual(historicalV7Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.find(historicalV8Identity)).toEqual(historicalV8Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.get(historicalV8Identity)).toEqual(historicalV8Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.find(historicalV9Identity)).toEqual(historicalV9Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.get(historicalV9Identity)).toEqual(historicalV9Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.find(historicalV10Identity)).toEqual(historicalV10Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.get(historicalV10Identity)).toEqual(historicalV10Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.find(historicalV11Identity)).toEqual(historicalV11Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.get(historicalV11Identity)).toEqual(historicalV11Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.find(historicalV12Identity)).toEqual(historicalV12Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.get(historicalV12Identity)).toEqual(historicalV12Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.find(historicalV13Identity)).toEqual(historicalV13Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.get(historicalV13Identity)).toEqual(historicalV13Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.find(historicalV14Identity)).toEqual(historicalV14Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.get(historicalV14Identity)).toEqual(historicalV14Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.find(historicalV15Identity)).toEqual(historicalV15Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.get(historicalV15Identity)).toEqual(historicalV15Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.find(historicalV16Identity)).toEqual(historicalV16Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.get(historicalV16Identity)).toEqual(historicalV16Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.find(historicalV17Identity)).toEqual(historicalV17Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.get(historicalV17Identity)).toEqual(historicalV17Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.find(historicalV18Identity)).toEqual(historicalV18Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.get(historicalV18Identity)).toEqual(historicalV18Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.find(historicalV19Identity)).toEqual(historicalV19Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.get(historicalV19Identity)).toEqual(historicalV19Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.find(historicalV20Identity)).toEqual(historicalV20Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.get(historicalV20Identity)).toEqual(historicalV20Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.find(historicalV21Identity)).toEqual(historicalV21Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.get(historicalV21Identity)).toEqual(historicalV21Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.find(historicalV22Identity)).toEqual(historicalV22Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.get(historicalV22Identity)).toEqual(historicalV22Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.find(historicalV23Identity)).toEqual(historicalV23Artifact);
      expect(metadata.energyIq.overviewAiArtifacts.get(historicalV23Identity)).toEqual(historicalV23Artifact);
      expect(() => metadata.energyIq.overviewAiArtifacts.queue({
        identity: historicalV23Identity,
        triggeredBy: "dev-user",
      })).toThrow("ENERGYIQ_ADDITIONAL_INSIGHT_CURRENT_IDENTITY_REQUIRED");
      expect(() => metadata.energyIq.overviewAiArtifacts.queue({
        identity: historicalV22Identity,
        triggeredBy: "dev-user",
      })).toThrow("ENERGYIQ_ADDITIONAL_INSIGHT_CURRENT_IDENTITY_REQUIRED");
      expect(() => metadata.energyIq.overviewAiArtifacts.queue({
        identity: historicalV21Identity,
        triggeredBy: "dev-user",
      })).toThrow("ENERGYIQ_ADDITIONAL_INSIGHT_CURRENT_IDENTITY_REQUIRED");
      expect(() => metadata.energyIq.overviewAiArtifacts.queue({
        identity: historicalV20Identity,
        triggeredBy: "dev-user",
      })).toThrow("ENERGYIQ_ADDITIONAL_INSIGHT_CURRENT_IDENTITY_REQUIRED");
      metadata.db.prepare(`
        UPDATE energyiq_overview_ai_artifacts
        SET status = 'running', result_json = NULL, completed_at = NULL,
            lease_owner = 'historical-v6-worker', lease_expires_at = '2099-01-01T00:00:00.000Z'
        WHERE id = ?
      `).run(historicalV6Artifact.id);
      expect(() => metadata.energyIq.overviewAiArtifacts.claim({
        identity: historicalV6Identity,
        workerId: "historical-v6-worker-2",
        leaseMs: 60_000,
      })).toThrow("ENERGYIQ_ADDITIONAL_INSIGHT_CURRENT_IDENTITY_REQUIRED");
      expect(() => metadata.energyIq.overviewAiArtifacts.fail({
        identity: historicalV6Identity,
        workerId: "historical-v6-worker",
        errorCode: "HISTORICAL_RUN_FAILED",
      })).toThrow("ENERGYIQ_ADDITIONAL_INSIGHT_CURRENT_IDENTITY_REQUIRED");
      expect(() => metadata.energyIq.overviewAiArtifacts.queue({
        identity: historicalV6Identity,
        triggeredBy: "dev-user",
      })).toThrow("ENERGYIQ_ADDITIONAL_INSIGHT_CURRENT_IDENTITY_REQUIRED");
      metadata.db.prepare(`
        UPDATE energyiq_overview_ai_artifacts
        SET status = 'running', result_json = NULL, completed_at = NULL,
            lease_owner = 'historical-v7-worker', lease_expires_at = '2099-01-01T00:00:00.000Z'
        WHERE id = ?
      `).run(historicalV7Artifact.id);
      expect(() => metadata.energyIq.overviewAiArtifacts.claim({
        identity: historicalV7Identity,
        workerId: "historical-v7-worker-2",
        leaseMs: 60_000,
      })).toThrow("ENERGYIQ_ADDITIONAL_INSIGHT_CURRENT_IDENTITY_REQUIRED");
      expect(() => metadata.energyIq.overviewAiArtifacts.fail({
        identity: historicalV7Identity,
        workerId: "historical-v7-worker",
        errorCode: "HISTORICAL_RUN_FAILED",
      })).toThrow("ENERGYIQ_ADDITIONAL_INSIGHT_CURRENT_IDENTITY_REQUIRED");
      expect(() => metadata.energyIq.overviewAiArtifacts.queue({
        identity: historicalV7Identity,
        triggeredBy: "dev-user",
      })).toThrow("ENERGYIQ_ADDITIONAL_INSIGHT_CURRENT_IDENTITY_REQUIRED");
      expect(() => metadata.energyIq.overviewAiArtifacts.queue({
        identity: historicalV8Identity,
        triggeredBy: "dev-user",
      })).toThrow("ENERGYIQ_ADDITIONAL_INSIGHT_CURRENT_IDENTITY_REQUIRED");
      expect(() => metadata.energyIq.overviewAiArtifacts.queue({
        identity: historicalV9Identity,
        triggeredBy: "dev-user",
      })).toThrow("ENERGYIQ_ADDITIONAL_INSIGHT_CURRENT_IDENTITY_REQUIRED");
      expect(() => metadata.energyIq.overviewAiArtifacts.queue({
        identity: historicalV10Identity,
        triggeredBy: "dev-user",
      })).toThrow("ENERGYIQ_ADDITIONAL_INSIGHT_CURRENT_IDENTITY_REQUIRED");
      expect(() => metadata.energyIq.overviewAiArtifacts.claim({
        identity: historicalIdentity,
        workerId: "historical-worker",
        leaseMs: 60_000,
      })).toThrow("ENERGYIQ_ADDITIONAL_INSIGHT_CURRENT_IDENTITY_REQUIRED");
      expect(() => metadata.energyIq.overviewAiArtifacts.complete({
        identity: historicalIdentity,
        workerId: "historical-worker",
        sessionId: "historical-session",
        runId: "historical-run",
        resultJson: historicalArtifact.result_json!,
      })).toThrow("ENERGYIQ_ADDITIONAL_INSIGHT_CURRENT_IDENTITY_REQUIRED");
      const publishedMethods = metadata.energyIq.insightMethodGovernance
        .listPublishedWorkspaceMethodResources({ workspaceId: "artifact-workspace" });
      const rotatedIdentity = additionalIdentity("snapshot-additional-rotated-methods", publishedMethods);
      expect(metadata.energyIq.overviewAiArtifacts.queue({
        identity: rotatedIdentity,
        triggeredBy: "dev-user",
      }).identity_json).toContain(rotatedIdentity.methodSetFingerprint);
      expect(() => metadata.energyIq.overviewAiArtifacts.queue({
        identity: { ...currentIdentity, dataSnapshotId: "snapshot-additional-stale-methods" },
        triggeredBy: "dev-user",
      })).toThrow("ENERGYIQ_ADDITIONAL_INSIGHT_METHOD_SET_IDENTITY_INVALID");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("persists only ordered server-accepted Canvas blocks bound to authoritative Evidence", () => {
    const root = mkdtempSync(join(tmpdir(), "energyiq-additional-canvas-artifact-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      metadata.workspaces.upsert({
        id: "artifact-workspace",
        owner_user_id: "dev-user",
        name: "Artifact",
        kind: "customer",
      });
      metadata.energyIq.upsertProject({
        id: "artifact-project",
        workspace_id: "artifact-workspace",
        name: "Artifact",
        status: "published",
      });

      const acceptedIdentity = additionalIdentity("snapshot-additional-canvas");
      const accepted = additionalResult(acceptedIdentity, "available");
      attachAcceptedCanvas(accepted);
      const acceptedCanvas = accepted.findings[0]!.canvas;
      if (acceptedCanvas?.contractRevision !== "energyiq-insight-canvas-v2") throw new Error("current Canvas fixture missing");
      acceptedCanvas.rejections = [{
        code: "PRESENTATION_BUDGET_EXCEEDED",
        subjectId: "canvas-block:suppressed-4",
      }];
      expect(completeAdditional(metadata, acceptedIdentity, accepted)).toMatchObject({ status: "available" });

      const unknownRejectionIdentity = additionalIdentity("snapshot-additional-canvas-unknown-rejection");
      const unknownRejection = additionalResult(unknownRejectionIdentity, "available");
      attachAcceptedCanvas(unknownRejection);
      const unknownRejectionCanvas = unknownRejection.findings[0]!.canvas;
      if (unknownRejectionCanvas?.contractRevision !== "energyiq-insight-canvas-v2") throw new Error("current Canvas fixture missing");
      unknownRejectionCanvas.rejections = [{
        code: "UNKNOWN_REJECTION" as "PRESENTATION_BUDGET_EXCEEDED",
        subjectId: "canvas-block:unknown",
      }];
      expect(() => completeAdditional(metadata, unknownRejectionIdentity, unknownRejection))
        .toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");

      const idDriftIdentity = additionalIdentity("snapshot-additional-canvas-id-drift");
      const idDrift = additionalResult(idDriftIdentity, "available");
      attachAcceptedCanvas(idDrift);
      idDrift.findings[0]!.canvas!.acceptedBlockIds = ["canvas-block:forged"];
      expect(() => completeAdditional(metadata, idDriftIdentity, idDrift))
        .toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");

      const bindingDriftIdentity = additionalIdentity("snapshot-additional-canvas-binding-drift");
      const bindingDrift = additionalResult(bindingDriftIdentity, "available");
      attachAcceptedCanvas(bindingDrift);
      if (bindingDrift.findings[0]!.canvas?.contractRevision !== "energyiq-insight-canvas-v2") {
        throw new Error("current Canvas fixture missing");
      }
      bindingDrift.findings[0]!.canvas.acceptedBlocks[0]!.bindings[0]!.value = 999;
      expect(() => completeAdditional(metadata, bindingDriftIdentity, bindingDrift))
        .toThrow("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RESULT_INVALID");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

const attachAcceptedCanvas = (artifact: AdditionalAiInsightsArtifact): void => {
  if (artifact.status !== "available") throw new Error("available Additional fixture required");
  Object.assign(artifact.evidenceLineage.facts[0]!, {
    label: "Additional Evidence",
    metricId: "energy.additional",
    value: 1,
    unit: "kWh",
    dimensions: { scopeId: artifact.binding.scopeId },
  });
  artifact.findings[0]!.canvas = {
    contractRevision: "energyiq-insight-canvas-v2",
    planId: "canvas-plan:additional-insight-1",
    acceptedBlockIds: ["canvas-block:additional-1"],
    acceptedBlocks: [{
      id: "canvas-block:additional-1",
      kind: "quantitative",
      visualization: "metric",
      title: "Additional Evidence",
      bindings: [{
        evidenceRef: "evidence:additional:1",
        entityId: artifact.binding.scopeId,
        metricId: "energy.additional",
        value: 1,
        unit: "kWh",
      }],
    }],
    rejections: [],
    gaps: [],
  };
};

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

const additionalIdentity = (
  dataSnapshotId: string,
  workspaceMethodResources: Parameters<typeof resolveCurrentAdditionalAiInsightMethodSet>[1] = [],
): AdditionalIdentity => {
  const methodSet = resolveCurrentAdditionalAiInsightMethodSet("artifact-workspace", workspaceMethodResources);
  const canonical = canonicalInsightMethodSetJson(methodSet.methods);
  if (!canonical) throw new Error("test Method set must be canonical");
  return {
    ...identity(dataSnapshotId),
    artifactKind: "autonomous-insights",
    identityContractRevision: "additional-insights-v24",
    analysisPackId: "preschool-additional-insights-pack",
    analysisPackRevision: "v1",
    outputContractRevision: "energyiq-additional-ai-insights-v2",
    validatorRevision: "additional-insights-acceptance-v17",
    workflowRevision: "additional-insights-discover-accept-publish-v21",
    investigatorPromptRevision: "additional-insights-discovery-v12",
    editorPromptRevision: "additional-insights-publication-v2",
    methodSkillId: "energyiq-open-discovery",
    methodSkillRevision: "1.0.0",
    methodSetId: CURRENT_ADDITIONAL_AI_INSIGHT_METHOD_SET_ID,
    methodSetRevision: CURRENT_ADDITIONAL_AI_INSIGHT_METHOD_SET_REVISION,
    methodSetFingerprint: `sha256:${createHash("sha256").update(canonical).digest("hex")}`,
    capabilityRevision: "scoped-read-only-v1",
    publicationRevision: "additional-insights-v2",
    canvasRevision: "energyiq-insight-canvas-v2",
  };
};

const historicalAdditionalIdentityV2 = (
  current: AdditionalIdentity,
): EnergyIqOverviewAiArtifactIdentity => ({
  ...current,
  identityContractRevision: "additional-insights-v2",
  validatorRevision: "additional-insights-acceptance-v2",
  workflowRevision: "additional-insights-discover-accept-publish-v2",
  investigatorPromptRevision: "additional-insights-discovery-v2",
});

const historicalAdditionalIdentityV3 = (
  current: AdditionalIdentity,
): EnergyIqOverviewAiArtifactIdentity => ({
  ...current,
  identityContractRevision: "additional-insights-v3",
  workflowRevision: "additional-insights-discover-accept-publish-v3",
  investigatorPromptRevision: "additional-insights-discovery-v3",
});

const historicalAdditionalIdentityV4 = (
  current: AdditionalIdentity,
): EnergyIqOverviewAiArtifactIdentity => ({
  ...current,
  identityContractRevision: "additional-insights-v4",
  workflowRevision: "additional-insights-discover-accept-publish-v4",
  investigatorPromptRevision: "additional-insights-discovery-v4",
});

const historicalAdditionalIdentityV5 = (
  current: AdditionalIdentity,
): EnergyIqOverviewAiArtifactIdentity => ({
  ...current,
  identityContractRevision: "additional-insights-v5",
  validatorRevision: "additional-insights-acceptance-v3",
  workflowRevision: "additional-insights-discover-accept-publish-v5",
  investigatorPromptRevision: "additional-insights-discovery-v5",
});

const historicalAdditionalIdentityV6 = (
  current: AdditionalIdentity,
): EnergyIqOverviewAiArtifactIdentity => ({
  ...current,
  identityContractRevision: "additional-insights-v6",
  validatorRevision: "additional-insights-acceptance-v4",
  workflowRevision: "additional-insights-discover-accept-publish-v6",
  investigatorPromptRevision: "additional-insights-discovery-v6",
});

const historicalAdditionalIdentityV7 = (
  current: AdditionalIdentity,
): EnergyIqOverviewAiArtifactIdentity => ({
  ...current,
  identityContractRevision: "additional-insights-v7",
  validatorRevision: "additional-insights-acceptance-v5",
  workflowRevision: "additional-insights-discover-accept-publish-v7",
  investigatorPromptRevision: "additional-insights-discovery-v7",
});

const historicalAdditionalIdentityV8 = (
  current: AdditionalIdentity,
): EnergyIqOverviewAiArtifactIdentity => ({
  ...current,
  identityContractRevision: "additional-insights-v8",
  validatorRevision: "additional-insights-acceptance-v6",
  workflowRevision: "additional-insights-discover-accept-publish-v8",
  investigatorPromptRevision: "additional-insights-discovery-v7",
});

const historicalAdditionalIdentityV9 = (
  current: AdditionalIdentity,
): EnergyIqOverviewAiArtifactIdentity => ({
  ...current,
  identityContractRevision: "additional-insights-v9",
  validatorRevision: "additional-insights-acceptance-v6",
  workflowRevision: "additional-insights-discover-accept-publish-v9",
  investigatorPromptRevision: "additional-insights-discovery-v7",
});

const historicalAdditionalIdentityV10 = (
  current: AdditionalIdentity,
): EnergyIqOverviewAiArtifactIdentity => ({
  ...current,
  identityContractRevision: "additional-insights-v10",
  validatorRevision: "additional-insights-acceptance-v7",
  workflowRevision: "additional-insights-discover-accept-publish-v10",
  investigatorPromptRevision: "additional-insights-discovery-v8",
});

const historicalAdditionalIdentityV11 = (
  current: AdditionalIdentity,
): EnergyIqOverviewAiArtifactIdentity => ({
  ...current,
  identityContractRevision: "additional-insights-v11",
  validatorRevision: "additional-insights-acceptance-v8",
  workflowRevision: "additional-insights-discover-accept-publish-v11",
  investigatorPromptRevision: "additional-insights-discovery-v9",
});

const historicalAdditionalIdentityV12 = (
  current: AdditionalIdentity,
): EnergyIqOverviewAiArtifactIdentity => ({
  ...current,
  identityContractRevision: "additional-insights-v12",
  validatorRevision: "additional-insights-acceptance-v9",
  workflowRevision: "additional-insights-discover-accept-publish-v12",
  investigatorPromptRevision: "additional-insights-discovery-v10",
});

const historicalAdditionalIdentityV13 = (
  current: AdditionalIdentity,
): EnergyIqOverviewAiArtifactIdentity => ({
  ...current,
  identityContractRevision: "additional-insights-v13",
  validatorRevision: "additional-insights-acceptance-v10",
  workflowRevision: "additional-insights-discover-accept-publish-v13",
  investigatorPromptRevision: "additional-insights-discovery-v10",
});

const historicalAdditionalIdentityV14 = (
  current: AdditionalIdentity,
): EnergyIqOverviewAiArtifactIdentity => ({
  ...current,
  identityContractRevision: "additional-insights-v14",
  validatorRevision: "additional-insights-acceptance-v11",
  workflowRevision: "additional-insights-discover-accept-publish-v14",
  investigatorPromptRevision: "additional-insights-discovery-v10",
});

const historicalAdditionalIdentityV15 = (
  current: AdditionalIdentity,
): EnergyIqOverviewAiArtifactIdentity => ({
  ...current,
  identityContractRevision: "additional-insights-v15",
  validatorRevision: "additional-insights-acceptance-v12",
  workflowRevision: "additional-insights-discover-accept-publish-v15",
  investigatorPromptRevision: "additional-insights-discovery-v10",
});

const historicalAdditionalIdentityV16 = (
  current: AdditionalIdentity,
): EnergyIqOverviewAiArtifactIdentity => ({
  ...current,
  identityContractRevision: "additional-insights-v16",
  validatorRevision: "additional-insights-acceptance-v13",
  workflowRevision: "additional-insights-discover-accept-publish-v16",
  investigatorPromptRevision: "additional-insights-discovery-v10",
});

const historicalAdditionalIdentityV17 = (
  current: AdditionalIdentity,
): EnergyIqOverviewAiArtifactIdentity => ({
  ...current,
  identityContractRevision: "additional-insights-v17",
  validatorRevision: "additional-insights-acceptance-v14",
  workflowRevision: "additional-insights-discover-accept-publish-v17",
  investigatorPromptRevision: "additional-insights-discovery-v10",
});

const historicalAdditionalIdentityV18 = (
  current: AdditionalIdentity,
): EnergyIqOverviewAiArtifactIdentity => ({
  ...current,
  identityContractRevision: "additional-insights-v18",
  validatorRevision: "additional-insights-acceptance-v15",
  workflowRevision: "additional-insights-discover-accept-publish-v18",
  investigatorPromptRevision: "additional-insights-discovery-v10",
});

const historicalAdditionalIdentityV19 = (
  current: AdditionalIdentity,
): EnergyIqOverviewAiArtifactIdentity => ({
  ...current,
  identityContractRevision: "additional-insights-v19",
  validatorRevision: "additional-insights-acceptance-v16",
  workflowRevision: "additional-insights-discover-accept-publish-v19",
  investigatorPromptRevision: "additional-insights-discovery-v10",
});

const historicalAdditionalIdentityV20 = (
  current: AdditionalIdentity,
): EnergyIqOverviewAiArtifactIdentity => ({
  ...current,
  identityContractRevision: "additional-insights-v20",
  validatorRevision: "additional-insights-acceptance-v16",
});

const historicalAdditionalIdentityV21 = (
  current: AdditionalIdentity,
): EnergyIqOverviewAiArtifactIdentity => ({
  ...current,
  identityContractRevision: "additional-insights-v21",
  workflowRevision: "additional-insights-discover-accept-publish-v20",
  investigatorPromptRevision: "additional-insights-discovery-v10",
});

const historicalAdditionalIdentityV22 = (
  current: AdditionalIdentity,
): EnergyIqOverviewAiArtifactIdentity => ({
  ...current,
  identityContractRevision: "additional-insights-v22",
  investigatorPromptRevision: "additional-insights-discovery-v11",
});

const historicalAdditionalIdentityV23 = (
  current: AdditionalIdentity,
): EnergyIqOverviewAiArtifactIdentity => ({
  ...current,
  identityContractRevision: "additional-insights-v23",
});

const historicalAdditionalIdentity = (
  current: AdditionalIdentity,
): EnergyIqOverviewAiArtifactIdentity => {
  const historical: EnergyIqOverviewAiArtifactIdentity = {
    ...current,
    identityContractRevision: "additional-insights-v1",
    outputContractRevision: "energyiq-additional-ai-insights-v1",
    validatorRevision: "additional-insights-acceptance-v1",
    workflowRevision: "additional-insights-discover-accept-publish-v1",
    investigatorPromptRevision: "additional-insights-discovery-v1",
    editorPromptRevision: "additional-insights-publication-v1",
    publicationRevision: "additional-insights-v1",
  };
  delete historical.canvasRevision;
  return historical;
};

const additionalResult = (
  artifactIdentity: AdditionalIdentity,
  status: "available" | "empty",
): AdditionalAiInsightsArtifactV1V2 => {
  const methodSet = resolveCurrentAdditionalAiInsightMethodSet(artifactIdentity.workspaceId);
  const base: Omit<AdditionalAiInsightsArtifactV1V2, "status" | "findings"> = {
  artifactKind: "autonomous-insights",
  providerProfileId: artifactIdentity.modelProfileId,
  runId: `run:${artifactIdentity.dataSnapshotId}`,
  contract: {
    id: "energyiq-additional-ai-insights",
    revision: artifactIdentity.outputContractRevision === "energyiq-additional-ai-insights-v1"
      ? "energyiq-additional-ai-insights-v1"
      : "energyiq-additional-ai-insights-v2",
  },
  binding: {
    workspaceId: artifactIdentity.workspaceId,
    projectId: artifactIdentity.projectId,
    scopeId: artifactIdentity.scopeId,
    dataSnapshotId: artifactIdentity.dataSnapshotId,
    projectReleaseId: artifactIdentity.projectReleaseId,
    analysisPeriod: {
      from: artifactIdentity.analysisPeriodFrom,
      to: artifactIdentity.analysisPeriodTo,
    },
    modelProfileId: artifactIdentity.modelProfileId,
    modelProfileRevision: artifactIdentity.modelProfileRevision,
  },
  methodExecution: {
    methodSetId: artifactIdentity.methodSetId,
    methodSetRevision: artifactIdentity.methodSetRevision,
    methodSetFingerprint: artifactIdentity.methodSetFingerprint,
    loadedMethods: [...methodSet.methods],
  },
  capability: {
    revision: artifactIdentity.capabilityRevision,
    mode: "scoped-read-only",
    allowedTools: [...ADDITIONAL_AI_INSIGHTS_SCOPED_READ_ONLY_TOOLS_V1],
    usedTools: [],
  },
  toolAudits: [],
  evidenceLineage: {
    catalogContract: "analysis-context-evidence@1",
    sourceId: `project-analysis-snapshot:${artifactIdentity.projectId}:${artifactIdentity.dataSnapshotId}`,
    pins: {
      workspaceId: artifactIdentity.workspaceId,
      projectId: artifactIdentity.projectId,
      scopeId: artifactIdentity.scopeId,
      dataSnapshotId: artifactIdentity.dataSnapshotId,
      dataCutoff: "2026-05-31T16:00:00.000Z",
      projectReleaseId: artifactIdentity.projectReleaseId,
      metricVersion: "energy-metrics-v1",
    },
    facts: status === "available" ? [{
      id: "evidence:additional:1",
      label: "Additional Evidence",
      metricId: "energy.additional",
      value: 1,
      unit: "kWh",
      status: "confirmed",
      evidenceRefs: ["snapshot-evidence:additional:1"],
      dimensions: { scopeId: artifactIdentity.scopeId },
    }] : [],
  },
  publication: {
    policyId: "energyiq-additional-ai-insights",
    policyRevision: artifactIdentity.publicationRevision,
    discoveredCount: status === "available" ? 1 : 0,
    acceptedCount: status === "available" ? 1 : 0,
    rejectedCount: 0,
    publishedCount: status === "available" ? 1 : 0,
    sourceOrderCandidateIds: status === "available" ? ["candidate-1"] : [],
    acceptedCandidateIds: status === "available" ? ["candidate-1"] : [],
    rejectedCandidateIds: [],
    publishedCandidateIds: status === "available" ? ["candidate-1"] : [],
    suppressedCandidateIds: [],
  },
  };
  if (status === "empty") {
    return { ...base, status, findings: [] };
  }
  return {
    ...base,
    status,
    findings: [{
      id: "additional-insight-1",
      title: "An incremental angle",
      text: "Current Snapshot Evidence supports this additional angle.",
      epistemicStatus: "inferred",
      origin: {
        kind: "ai-discovery",
        coreMethod: methodSet.methods[0]!,
        directionMethods: [],
      },
      evidenceRefs: ["evidence:additional:1"],
      toolAuditIds: [],
    }],
  };
};

const completeAdditional = (
  metadata: ReturnType<typeof createMetadataStore>,
  artifactIdentity: EnergyIqOverviewAiArtifactIdentity,
  result: AdditionalAiInsightsArtifact,
) => {
  metadata.energyIq.overviewAiArtifacts.queue({ identity: artifactIdentity, triggeredBy: "dev-user" });
  const workerId = `worker:${artifactIdentity.dataSnapshotId}`;
  metadata.energyIq.overviewAiArtifacts.claim({ identity: artifactIdentity, workerId, leaseMs: 60_000 });
  return metadata.energyIq.overviewAiArtifacts.complete({
    identity: artifactIdentity,
    workerId,
    sessionId: `session:${artifactIdentity.dataSnapshotId}`,
    runId: `run:${artifactIdentity.dataSnapshotId}`,
    resultJson: JSON.stringify(result),
  });
};

/** Seeds a released historical row without reopening the production mutation surface. */
const seedHistoricalTerminalArtifact = (input: {
  databasePath: string;
  source: EnergyIqOverviewAiArtifactRecord;
  identity: EnergyIqOverviewAiArtifactIdentity;
}): void => {
  const canonical = JSON.parse(input.source.identity_json) as Record<string, unknown>;
  for (const key of Object.keys(canonical)) {
    const value = input.identity[key as keyof EnergyIqOverviewAiArtifactIdentity];
    if (value === undefined) delete canonical[key];
    else canonical[key] = value;
  }
  const identityJson = JSON.stringify(canonical);
  const identityHash = createHash("sha256").update(identityJson).digest("hex");
  const db = new DatabaseSync(input.databasePath);
  try {
    db.prepare(`
      INSERT INTO energyiq_overview_ai_artifacts (
        id, identity_hash, identity_json, workspace_id, project_id, scope_id,
        resource, data_snapshot_id, project_release_id, renderer_key,
        renderer_version, analysis_pack_id, analysis_pack_revision,
        model_profile_id, model_profile_revision, output_contract_revision,
        validator_revision, status, attempt_count, triggered_by,
        session_id, run_id, result_json, created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', 1, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `overview-ai-artifact-${identityHash.slice(0, 24)}`,
      identityHash,
      identityJson,
      input.identity.workspaceId,
      input.identity.projectId,
      input.identity.scopeId,
      input.identity.resource,
      input.identity.dataSnapshotId,
      input.identity.projectReleaseId,
      input.identity.rendererKey,
      input.identity.rendererVersion,
      input.identity.analysisPackId,
      input.identity.analysisPackRevision,
      input.identity.modelProfileId,
      input.identity.modelProfileRevision,
      input.identity.outputContractRevision,
      input.identity.validatorRevision,
      input.source.triggered_by,
      input.source.session_id ?? null,
      input.source.run_id ?? null,
      input.source.result_json ?? null,
      input.source.created_at,
      input.source.updated_at,
      input.source.completed_at ?? null,
    );
  } finally {
    db.close();
  }
};
