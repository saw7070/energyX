import { parseAiFindingPresentation, type AiFindingPresentation } from "./ai-finding-presentation";
import type { PreschoolDiscoveryEvidenceItem } from "./preschool-ai-discovery-evidence";

export const PRESCHOOL_AI_ACCEPTED_CONTRACT_REVISION = "v13" as const;
export const PRESCHOOL_AI_WORKFLOW_REVISION = "preschool-two-stage-v2" as const;
export const PRESCHOOL_AI_INVESTIGATOR_PROMPT_REVISION = "preschool-investigator-v15" as const;
export const PRESCHOOL_AI_EDITOR_PROMPT_REVISION = "preschool-insight-editor-v7" as const;
export const PRESCHOOL_AI_METHOD_SKILL_ID = "energy-insight-investigation" as const;
export const PRESCHOOL_AI_METHOD_SKILL_REVISION = "1.0.0" as const;

export type PreschoolAiPlacementTarget =
  | "preschool.overall-key-findings"
  | "preschool.benchmark"
  | "preschool.standby"
  | "preschool.operating-hours"
  | "preschool.forecast"
  | "cross-section";

export type PreschoolAiEpistemicLevel = "verified" | "hypothesis" | "exploration-idea";
export type PreschoolAiRelationship = "supports" | "challenges" | "independent";

export type PreschoolAiArtifactBinding = {
  projectId: "preschool-demo";
  scopeId: string;
  dataSnapshotId: string;
  projectReleaseId: string;
  dataCutoff: string;
  analysisPeriod: { from: string; to: string };
  outputContractRevision: typeof PRESCHOOL_AI_ACCEPTED_CONTRACT_REVISION;
};

export type PreschoolAiToolEvidence = {
  evidenceIndex: number;
  toolCallId: string;
  sql: string | null;
  rowCount: number | null;
  auditLogId: string | null;
  elapsedMs: number | null;
  resultPreview: string;
};

export type PreschoolAiAcceptedFinding = {
  id: string;
  binding: PreschoolAiArtifactBinding;
  placementTargets: PreschoolAiPlacementTarget[];
  epistemicLevel: PreschoolAiEpistemicLevel;
  relationship: PreschoolAiRelationship;
  signalRefs: string[];
  title: string;
  takeaway: string;
  interpretation?: string;
  action: string;
  expectedIfAct: string;
  ifIgnored: string;
  possibleExplanation?: string;
  verification?: string;
  uncertainty: string;
  presentation?: AiFindingPresentation;
  evidence: {
    snapshotId: string;
    period: { from: string; to: string };
    deterministic: PreschoolDiscoveryEvidenceItem[];
    tools: PreschoolAiToolEvidence[];
  };
};

export type PreschoolAiEditorTraceDecision = {
  decision: "accepted" | "rejected" | "merged";
  sourceCandidateIds: string[];
  findingId?: string;
  reason?: string;
};

export type PreschoolAiWorkflowTrace = {
  id: "preschool-two-stage";
  revision: typeof PRESCHOOL_AI_WORKFLOW_REVISION;
  methodSkill: {
    id: typeof PRESCHOOL_AI_METHOD_SKILL_ID;
    revision: typeof PRESCHOOL_AI_METHOD_SKILL_REVISION;
  };
  stages: {
    investigator: { runId: string; promptRevision: typeof PRESCHOOL_AI_INVESTIGATOR_PROMPT_REVISION };
    editor: { runId: string; promptRevision: typeof PRESCHOOL_AI_EDITOR_PROMPT_REVISION };
  };
};

export type PreschoolAiInternalWorkflowTrace = PreschoolAiWorkflowTrace & {
  editorTrace?: PreschoolAiEditorTraceDecision[];
};

export type PreschoolAiAcceptedArtifact = {
  status: "available";
  providerProfileId: string;
  runId: string;
  packId: "preschool-analysis-pack";
  packRevision: "v1";
  contract: { id: "preschool-ai-accepted-artifact"; revision: typeof PRESCHOOL_AI_ACCEPTED_CONTRACT_REVISION };
  binding: PreschoolAiArtifactBinding;
  workflow: PreschoolAiWorkflowTrace;
  findings: PreschoolAiAcceptedFinding[];
};

export type PreschoolAiAcceptedArtifactInternal = Omit<PreschoolAiAcceptedArtifact, "workflow"> & {
  workflow: PreschoolAiInternalWorkflowTrace;
};

export type PreschoolAiSectionInterpretation =
  | { status: "preparing" }
  | { status: "unavailable"; reason: string }
  | {
      status: "available";
      target: PreschoolAiPlacementTarget;
      binding: PreschoolAiArtifactBinding;
      findings: PreschoolAiAcceptedFinding[];
    };

export function selectPreschoolAiSectionInterpretation(
  candidate: unknown,
  expected: PreschoolAiArtifactBinding,
  target: PreschoolAiPlacementTarget,
): PreschoolAiSectionInterpretation {
  if (candidate === null || candidate === undefined) return { status: "preparing" };
  if (isRecord(candidate) && candidate.status === "unavailable") {
    return {
      status: "unavailable",
      reason: typeof candidate.reason === "string" && candidate.reason.trim()
        ? candidate.reason
        : "AI interpretation is unavailable for this Snapshot.",
    };
  }
  if (!isAcceptedArtifact(candidate) || !sameBinding(candidate.binding, expected)
    || candidate.findings.some((finding) => !sameBinding(finding.binding, expected)
      || finding.evidence.snapshotId !== expected.dataSnapshotId
      || finding.evidence.period.from !== expected.analysisPeriod.from
      || finding.evidence.period.to !== expected.analysisPeriod.to)) {
    return {
      status: "unavailable",
      reason: "AI interpretation does not match the current Project, Scope, Snapshot, cutoff, or contract.",
    };
  }
  return {
    status: "available",
    target,
    binding: candidate.binding,
    findings: candidate.findings.filter((finding) => finding.placementTargets.includes(target)),
  };
}

function isAcceptedArtifact(value: unknown): value is PreschoolAiAcceptedArtifact {
  if (!isRecord(value) || value.status !== "available"
    || !nonEmptyString(value.providerProfileId)
    || !nonEmptyString(value.runId)
    || value.packId !== "preschool-analysis-pack"
    || value.packRevision !== "v1"
    || !isRecord(value.contract)
    || value.contract.id !== "preschool-ai-accepted-artifact"
    || value.contract.revision !== PRESCHOOL_AI_ACCEPTED_CONTRACT_REVISION
    || !isBinding(value.binding)
    || !isRecord(value.workflow)
    || value.workflow.id !== "preschool-two-stage"
    || value.workflow.revision !== PRESCHOOL_AI_WORKFLOW_REVISION
    || !isRecord(value.workflow.methodSkill)
    || value.workflow.methodSkill.id !== PRESCHOOL_AI_METHOD_SKILL_ID
    || value.workflow.methodSkill.revision !== PRESCHOOL_AI_METHOD_SKILL_REVISION
    || !isRecord(value.workflow.stages)
    || !isRecord(value.workflow.stages.investigator)
    || !isRecord(value.workflow.stages.editor)
    || !nonEmptyString(value.workflow.stages.investigator.runId)
    || !nonEmptyString(value.workflow.stages.editor.runId)
    || value.workflow.stages.investigator.runId === value.workflow.stages.editor.runId
    || value.workflow.stages.investigator.promptRevision !== PRESCHOOL_AI_INVESTIGATOR_PROMPT_REVISION
    || value.workflow.stages.editor.promptRevision !== PRESCHOOL_AI_EDITOR_PROMPT_REVISION
    || value.workflow.stages.editor.runId !== value.runId
    || !Array.isArray(value.findings)) return false;
  const artifactBinding = value.binding;
  return value.findings.every((finding) => isAcceptedFinding(finding, artifactBinding));
}

function isAcceptedFinding(value: unknown, artifactBinding: PreschoolAiArtifactBinding): boolean {
  if (!isRecord(value)
    || !nonEmptyString(value.id)
    || !isBinding(value.binding)
    || !sameBinding(value.binding, artifactBinding)
    || !Array.isArray(value.placementTargets)
    || value.placementTargets.length === 0
    || !value.placementTargets.every(isPlacementTarget)
    || (value.epistemicLevel !== "verified"
      && value.epistemicLevel !== "hypothesis"
      && value.epistemicLevel !== "exploration-idea")
    || (value.relationship !== "supports"
      && value.relationship !== "challenges"
      && value.relationship !== "independent")
    || !stringArray(value.signalRefs)
    || !nonEmptyString(value.title)
    || !nonEmptyString(value.takeaway)
    || !optionalString(value.interpretation)
    || !nonEmptyString(value.action)
    || !nonEmptyString(value.expectedIfAct)
    || !nonEmptyString(value.ifIgnored)
    || !optionalString(value.possibleExplanation)
    || !optionalString(value.verification)
    || !nonEmptyString(value.uncertainty)
    || (nonEmptyString(value.possibleExplanation) && !nonEmptyString(value.verification))
    || (value.epistemicLevel !== "verified"
      && !nonEmptyString(value.verification)
      && !nonEmptyString(value.uncertainty))
    || !isRecord(value.evidence)
    || value.evidence.snapshotId !== artifactBinding.dataSnapshotId
    || !isRecord(value.evidence.period)
    || value.evidence.period.from !== artifactBinding.analysisPeriod.from
    || value.evidence.period.to !== artifactBinding.analysisPeriod.to
    || !Array.isArray(value.evidence.deterministic)
    || !Array.isArray(value.evidence.tools)
    || !value.evidence.deterministic.every(isDeterministicEvidence)
    || !value.evidence.tools.every(isToolEvidence)) return false;
  return value.presentation === undefined || parseAiFindingPresentation(value.presentation) !== null;
}

function isDeterministicEvidence(value: unknown): boolean {
  return isRecord(value)
    && nonEmptyString(value.id)
    && nonEmptyString(value.label)
    && isRecord(value.values)
    && Array.isArray(value.queryIds)
    && value.queryIds.every(nonEmptyString);
}

function isToolEvidence(value: unknown): boolean {
  return isRecord(value)
    && Number.isSafeInteger(value.evidenceIndex)
    && (value.evidenceIndex as number) > 0
    && nonEmptyString(value.toolCallId)
    && (value.sql === null || nonEmptyString(value.sql))
    && (value.rowCount === null || (Number.isSafeInteger(value.rowCount) && (value.rowCount as number) >= 0))
    && (value.auditLogId === null || nonEmptyString(value.auditLogId))
    && (value.elapsedMs === null || (typeof value.elapsedMs === "number" && Number.isFinite(value.elapsedMs) && value.elapsedMs >= 0))
    && typeof value.resultPreview === "string";
}

function sameBinding(left: PreschoolAiArtifactBinding, right: PreschoolAiArtifactBinding): boolean {
  return left.projectId === right.projectId
    && left.scopeId === right.scopeId
    && left.dataSnapshotId === right.dataSnapshotId
    && left.projectReleaseId === right.projectReleaseId
    && left.dataCutoff === right.dataCutoff
    && left.analysisPeriod.from === right.analysisPeriod.from
    && left.analysisPeriod.to === right.analysisPeriod.to
    && left.outputContractRevision === right.outputContractRevision;
}

function isBinding(value: unknown): value is PreschoolAiArtifactBinding {
  return isRecord(value)
    && value.projectId === "preschool-demo"
    && nonEmptyString(value.scopeId)
    && nonEmptyString(value.dataSnapshotId)
    && nonEmptyString(value.projectReleaseId)
    && nonEmptyString(value.dataCutoff)
    && value.outputContractRevision === PRESCHOOL_AI_ACCEPTED_CONTRACT_REVISION
    && isRecord(value.analysisPeriod)
    && nonEmptyString(value.analysisPeriod.from)
    && nonEmptyString(value.analysisPeriod.to);
}

function isPlacementTarget(value: unknown): value is PreschoolAiPlacementTarget {
  return value === "preschool.overall-key-findings"
    || value === "preschool.benchmark"
    || value === "preschool.standby"
    || value === "preschool.operating-hours"
    || value === "preschool.forecast"
    || value === "cross-section";
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function optionalString(value: unknown): boolean {
  return value === undefined || nonEmptyString(value);
}

function stringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every(nonEmptyString);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
