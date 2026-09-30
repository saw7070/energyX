import { describe, expect, it } from "vitest";

import {
  PRESCHOOL_AI_ACCEPTED_CONTRACT_REVISION,
  PRESCHOOL_AI_EDITOR_PROMPT_REVISION,
  PRESCHOOL_AI_INVESTIGATOR_PROMPT_REVISION,
  PRESCHOOL_AI_METHOD_SKILL_ID,
  PRESCHOOL_AI_METHOD_SKILL_REVISION,
  PRESCHOOL_AI_WORKFLOW_REVISION,
  selectPreschoolAiSectionInterpretation,
  type PreschoolAiAcceptedArtifact,
  type PreschoolAiArtifactBinding,
} from "./preschool-ai-artifact";

describe("Preschool accepted AI Artifact Section interface", () => {
  it("reads Benchmark placement from the exact same accepted Artifact", () => {
    const artifact = acceptedArtifact();

    const selected = selectPreschoolAiSectionInterpretation(
      artifact,
      artifact.binding,
      "preschool.benchmark",
    );

    expect(selected).toMatchObject({
      status: "available",
      target: "preschool.benchmark",
      binding: artifact.binding,
      findings: [{
        id: "benchmark-insight",
        epistemicLevel: "hypothesis",
        action: "Review the priority centres after verifying their metadata.",
        expectedIfAct: "The next review should isolate the operating driver.",
        ifIgnored: "The unresolved priority may persist into the next review.",
        possibleExplanation: "Operating schedules or equipment mix may differ.",
      }],
    });
  });

  it("rejects an old Snapshot interpretation instead of falling back beside current facts", () => {
    const artifact = acceptedArtifact();
    const current: PreschoolAiArtifactBinding = {
      ...artifact.binding,
      dataSnapshotId: "snapshot-current",
      dataCutoff: "2026-07-01T00:00:00.000Z",
    };

    expect(selectPreschoolAiSectionInterpretation(
      artifact,
      current,
      "preschool.benchmark",
    )).toEqual({
      status: "unavailable",
      reason: "AI interpretation does not match the current Project, Scope, Snapshot, cutoff, or contract.",
    });
  });

  it("returns preparing when the exact identity has no accepted Artifact yet", () => {
    expect(selectPreschoolAiSectionInterpretation(
      null,
      acceptedArtifact().binding,
      "preschool.benchmark",
    )).toEqual({ status: "preparing" });
  });

  it("rejects a pre-two-stage contract even when its Snapshot id matches", () => {
    const artifact = acceptedArtifact() as unknown as Record<string, unknown>;
    (artifact.contract as Record<string, unknown>).revision = "v12";

    expect(selectPreschoolAiSectionInterpretation(
      artifact,
      acceptedArtifact().binding,
      "preschool.benchmark",
    )).toMatchObject({ status: "unavailable" });
  });

  it("rejects a finding whose Evidence period is not the Artifact binding", () => {
    const artifact = acceptedArtifact();
    artifact.findings[0]!.evidence.period = {
      ...artifact.findings[0]!.evidence.period,
      to: "2026-06-02T00:00:00.000Z",
    };

    expect(selectPreschoolAiSectionInterpretation(
      artifact,
      artifact.binding,
      "preschool.benchmark",
    )).toMatchObject({ status: "unavailable" });
  });

  it("rejects a hypothesis that exposes neither uncertainty nor verification", () => {
    const artifact = acceptedArtifact();
    delete artifact.findings[0]!.uncertainty;
    delete artifact.findings[0]!.verification;

    expect(selectPreschoolAiSectionInterpretation(
      artifact,
      artifact.binding,
      "preschool.benchmark",
    )).toMatchObject({ status: "unavailable" });
  });

  it("rejects a separate possibleExplanation when the accepted Finding has no next-check verification", () => {
    const artifact = acceptedArtifact();
    artifact.findings[0]!.epistemicLevel = "verified";
    delete artifact.findings[0]!.verification;

    expect(selectPreschoolAiSectionInterpretation(
      artifact,
      artifact.binding,
      "preschool.benchmark",
    )).toMatchObject({ status: "unavailable" });
  });

  it("allows an exact Benchmark placement to be empty without template filler", () => {
    const artifact = acceptedArtifact();
    artifact.findings = [];

    expect(selectPreschoolAiSectionInterpretation(
      artifact,
      artifact.binding,
      "preschool.benchmark",
    )).toMatchObject({ status: "available", findings: [] });
  });
});

function acceptedArtifact(): PreschoolAiAcceptedArtifact {
  const binding: PreschoolAiArtifactBinding = {
    projectId: "preschool-demo",
    scopeId: "preschool-project",
    dataSnapshotId: "snapshot-old",
    projectReleaseId: "release-1",
    dataCutoff: "2026-06-01T00:00:00.000Z",
    analysisPeriod: { from: "2026-05-01T00:00:00.000Z", to: "2026-06-01T00:00:00.000Z" },
    outputContractRevision: PRESCHOOL_AI_ACCEPTED_CONTRACT_REVISION,
  };
  return {
    status: "available",
    providerProfileId: "profile-1",
    runId: "editor-run",
    packId: "preschool-analysis-pack",
    packRevision: "v1",
    contract: { id: "preschool-ai-accepted-artifact", revision: PRESCHOOL_AI_ACCEPTED_CONTRACT_REVISION },
    binding,
    workflow: {
      id: "preschool-two-stage",
      revision: PRESCHOOL_AI_WORKFLOW_REVISION,
      methodSkill: { id: PRESCHOOL_AI_METHOD_SKILL_ID, revision: PRESCHOOL_AI_METHOD_SKILL_REVISION },
      stages: {
        investigator: { runId: "investigator-run", promptRevision: PRESCHOOL_AI_INVESTIGATOR_PROMPT_REVISION },
        editor: { runId: "editor-run", promptRevision: PRESCHOOL_AI_EDITOR_PROMPT_REVISION },
      },
    },
    findings: [{
      id: "benchmark-insight",
      binding,
      placementTargets: ["preschool.benchmark"],
      epistemicLevel: "hypothesis",
      relationship: "independent",
      signalRefs: ["efficiency"],
      title: "Benchmark gap needs an operating explanation",
      takeaway: "The same centres remain high after both floor-area and headcount normalisation.",
      action: "Review the priority centres after verifying their metadata.",
      expectedIfAct: "The next review should isolate the operating driver.",
      ifIgnored: "The unresolved priority may persist into the next review.",
      possibleExplanation: "Operating schedules or equipment mix may differ.",
      verification: "Compare schedules and major circuit loads for the priority centres.",
      uncertainty: "The Snapshot does not include occupancy schedules or equipment state.",
      evidence: {
        snapshotId: binding.dataSnapshotId,
        period: binding.analysisPeriod,
        deterministic: [],
        tools: [],
      },
    }],
  };
}
