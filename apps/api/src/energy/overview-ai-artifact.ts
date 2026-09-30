import type {
  EnergyIqOverviewAiArtifactIdentity,
  EnergyIqOverviewAiArtifactRecord,
  MetadataStore,
  UserRecord,
  WorkspaceDefaultModelProfileRecord,
} from "@datafoundry/metadata";
import { WORKSPACE_DEFAULT_MODEL_PROFILE_ID } from "@datafoundry/metadata";
import type { LocalDataGateway } from "@datafoundry/data-gateway";
import {
  CURRENT_ADDITIONAL_AI_INSIGHT_METHOD_SET_ID,
  CURRENT_ADDITIONAL_AI_INSIGHT_METHOD_SET_REVISION,
  canonicalInsightMethodSetJson,
  reportTimeBasisFromContext,
  resolveCurrentAdditionalAiInsightMethodSet,
  type ReportTimeBasis,
} from "@datafoundry/contracts";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID } from "../workspace-model-profile-resolver.js";

import {
  readCurrentProjectOverviewProjection,
  resolveProjectOverviewProfile,
  resolveProjectOverviewReleaseId,
  type ProjectAnalysisSnapshot,
} from "./project-analysis-resolver.js";
import { resolveEnergyAccessContext } from "./energy-query-context.js";
import type { PreschoolSectionId } from "./preschool-overview-ai-contracts.js";
import type {
  ProjectOverviewAiSectionDefinition,
  ProjectOverviewAiSurfaceUnitDefinition,
} from "./project-overview-ai-adapter.js";
import { TUYA_OFFICE_PROJECT_ID } from "./tuya-office-project.js";

type OverviewAiContract = {
  analysisPackId: string;
  analysisPackRevision: string;
  outputContractRevision: string;
  validatorRevision: string;
  workflowRevision: string;
  investigatorPromptRevision: string;
  editorPromptRevision: string;
  methodSkillId: string;
  methodSkillRevision: string;
};

export type OverviewAiArtifactIdentityV13 = EnergyIqOverviewAiArtifactIdentity & OverviewAiContract;

export type PreschoolOverviewAiValueArtifactIdentity = EnergyIqOverviewAiArtifactIdentity & {
  artifactKind: "section-interpretation" | "executive-synthesis";
  targetId: string;
};

export type ProjectAdditionalAiInsightArtifactIdentity = EnergyIqOverviewAiArtifactIdentity & {
  artifactKind: "autonomous-insights";
  methodSetId: "preschool-additional-insights-current";
  methodSetRevision: "v1";
  methodSetFingerprint: string;
  capabilityRevision: "scoped-read-only-v1";
  publicationRevision: "additional-insights-v2";
  canvasRevision: "energyiq-insight-canvas-v2";
};

export type PreschoolAdditionalAiInsightArtifactIdentity = ProjectAdditionalAiInsightArtifactIdentity & {
  identityContractRevision: "additional-insights-v24";
  outputContractRevision: "energyiq-additional-ai-insights-v2";
};

export type NgeeAnnAdditionalAiInsightArtifactIdentity = ProjectAdditionalAiInsightArtifactIdentity & {
  identityContractRevision: "ngee-ann-additional-insights-v4";
  outputContractRevision: "energyiq-additional-ai-insights-v2";
};

export type TuyaOfficeAdditionalAiInsightArtifactIdentity = ProjectAdditionalAiInsightArtifactIdentity & {
  identityContractRevision: "tuya-office-additional-insights-v2";
  outputContractRevision: "energyiq-additional-ai-insights-v3";
};

const OVERVIEW_AI_CONTRACTS: Readonly<Record<string, OverviewAiContract>> = {
  "ngee-ann-overview": {
    analysisPackId: "ngee-ann-analysis-pack",
    analysisPackRevision: "v1",
    outputContractRevision: "energyiq-project-overview-ai-v1",
    validatorRevision: "energyiq-project-overview-ai-v1",
    workflowRevision: "energyiq-project-overview-ai-v1",
    investigatorPromptRevision: "energyiq-project-overview-ai-v1",
    editorPromptRevision: "not-applicable-v1",
    methodSkillId: "none",
    methodSkillRevision: "not-applicable-v1",
  },
  "preschool-overview": {
    analysisPackId: "preschool-analysis-pack",
    analysisPackRevision: "v1",
    outputContractRevision: "v13",
    validatorRevision: "preschool-ai-two-stage-fact-boundary-v7",
    workflowRevision: "preschool-two-stage-v2",
    investigatorPromptRevision: "preschool-investigator-v15",
    editorPromptRevision: "preschool-insight-editor-v7",
    methodSkillId: "energy-insight-investigation",
    methodSkillRevision: "1.0.0",
  },
};

const TUYA_OFFICE_OVERVIEW_AI_CONTRACT: OverviewAiContract = {
  analysisPackId: "tuya-office-analysis-pack",
  analysisPackRevision: "v2",
  outputContractRevision: "energyiq-project-overview-ai-v1",
  validatorRevision: "tuya-office-overview-ai-v2",
  workflowRevision: "tuya-office-overview-ai-v2",
  investigatorPromptRevision: "tuya-office-overview-ai-v2",
  editorPromptRevision: "not-applicable-v1",
  methodSkillId: "none",
  methodSkillRevision: "not-applicable-v1",
};

const resolveOverviewAiContract = (input: {
  projectId: string;
  rendererKey: string;
}): OverviewAiContract | undefined => input.projectId === TUYA_OFFICE_PROJECT_ID
  && input.rendererKey === "tuya-office-overview"
  ? TUYA_OFFICE_OVERVIEW_AI_CONTRACT
  : OVERVIEW_AI_CONTRACTS[input.rendererKey];

export const createNgeeAnnOverviewAiSectionArtifactIdentity = (input: {
  baseIdentity: OverviewAiArtifactIdentityV13;
  targetId: string;
}): PreschoolOverviewAiValueArtifactIdentity => {
  if (input.baseIdentity.rendererKey !== "ngee-ann-overview") {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_CONTRACT_NOT_FOUND");
  }
  if (!input.targetId.trim()) {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_TARGET_REQUIRED");
  }
  return {
    ...projectOverviewAiDerivedIdentityBase(input.baseIdentity),
    artifactKind: "section-interpretation",
    targetId: input.targetId,
    identityContractRevision: "ngee-ann-section-v16",
    analysisPackId: "ngee-ann-section-pack",
    analysisPackRevision: "v2",
    outputContractRevision: "energyiq-project-section-interpretation-v1",
    validatorRevision: "energyiq-project-section-acceptance-v14",
    workflowRevision: "energyiq-project-section-discover-publish-v1",
    investigatorPromptRevision: "energyiq-project-section-discovery-v8",
    editorPromptRevision: "not-applicable-v1",
    methodSkillId: "none",
    methodSkillRevision: "not-applicable-v1",
    capabilityRevision: "pack-only-v1",
    publicationRevision: "energyiq-project-section-publication-v1",
  };
};

export const createNgeeAnnOverviewAiExecutiveArtifactIdentity = (input: {
  baseIdentity: OverviewAiArtifactIdentityV13;
  targetId: string;
}): PreschoolOverviewAiValueArtifactIdentity => {
  if (input.baseIdentity.rendererKey !== "ngee-ann-overview") {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_CONTRACT_NOT_FOUND");
  }
  if (!input.targetId.trim()) {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_TARGET_REQUIRED");
  }
  return {
    ...projectOverviewAiDerivedIdentityBase(input.baseIdentity),
    artifactKind: "executive-synthesis",
    targetId: input.targetId,
    identityContractRevision: "ngee-ann-executive-v7",
    analysisPackId: "ngee-ann-section-artifacts",
    analysisPackRevision: "v1",
    outputContractRevision: "energyiq-project-executive-synthesis-v1",
    validatorRevision: "energyiq-project-executive-acceptance-v6",
    workflowRevision: "energyiq-project-executive-synthesis-v2",
    investigatorPromptRevision: "energyiq-project-executive-prompt-v2",
    editorPromptRevision: "not-applicable-v1",
    methodSkillId: "none",
    methodSkillRevision: "not-applicable-v1",
    capabilityRevision: "section-artifacts-v1",
    publicationRevision: "energyiq-project-key-findings-v1",
  };
};

export const createTuyaOfficeOverviewAiSectionArtifactIdentity = (input: {
  baseIdentity: OverviewAiArtifactIdentityV13;
  targetId: string;
  unit: ProjectOverviewAiSectionDefinition;
}): PreschoolOverviewAiValueArtifactIdentity => {
  requireCurrentTuyaOfficeBaseIdentity(input.baseIdentity);
  if (!input.targetId.trim() || input.unit.id !== input.targetId) {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_TARGET_REQUIRED");
  }
  const generation = input.unit.generation;
  if (!generation) throw new Error("ENERGYIQ_TUYA_OFFICE_AI_SURFACE_DEFINITION_INVALID");
  return {
    ...projectOverviewAiDerivedIdentityBase(input.baseIdentity),
    artifactKind: "section-interpretation",
    targetId: input.targetId,
    identityContractRevision: "tuya-office-section-v3",
    analysisPackId: "tuya-office-section-pack",
    analysisPackRevision: "v4",
    outputContractRevision: generation.outputContractRevision,
    validatorRevision: generation.validatorRevision,
    workflowRevision: "energyiq-project-section-discover-publish-v1",
    investigatorPromptRevision: "tuya-office-section-discovery-v4",
    editorPromptRevision: "not-applicable-v1",
    methodSkillId: generation.skillId,
    methodSkillRevision: generation.skillRevision,
    capabilityRevision: generation.toolPolicyRevision,
    publicationRevision: "energyiq-project-section-publication-v1",
  };
};

export const createTuyaOfficeOverviewAiExecutiveArtifactIdentity = (input: {
  baseIdentity: OverviewAiArtifactIdentityV13;
  targetId: string;
  unit: ProjectOverviewAiSurfaceUnitDefinition;
}): PreschoolOverviewAiValueArtifactIdentity => {
  requireCurrentTuyaOfficeBaseIdentity(input.baseIdentity);
  if (!input.targetId.trim()) {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_TARGET_REQUIRED");
  }
  const generation = input.unit.generation;
  if (!generation) throw new Error("ENERGYIQ_TUYA_OFFICE_AI_SURFACE_DEFINITION_INVALID");
  return {
    ...projectOverviewAiDerivedIdentityBase(input.baseIdentity),
    artifactKind: "executive-synthesis",
    targetId: input.targetId,
    identityContractRevision: "tuya-office-executive-v1",
    analysisPackId: "tuya-office-section-artifacts",
    analysisPackRevision: "v1",
    outputContractRevision: generation.outputContractRevision,
    validatorRevision: generation.validatorRevision,
    workflowRevision: "energyiq-project-executive-synthesis-v1",
    investigatorPromptRevision: "tuya-office-executive-prompt-v1",
    editorPromptRevision: "not-applicable-v1",
    methodSkillId: generation.skillId,
    methodSkillRevision: generation.skillRevision,
    capabilityRevision: generation.toolPolicyRevision,
    publicationRevision: "energyiq-project-key-findings-v1",
  };
};

const requireTuyaOfficeIdentityBinding = (
  identity: Pick<EnergyIqOverviewAiArtifactIdentity, "projectId" | "rendererKey">,
): void => {
  if (identity.projectId !== TUYA_OFFICE_PROJECT_ID
    || identity.rendererKey !== "tuya-office-overview") {
    throw new Error("ENERGYIQ_TUYA_OFFICE_OVERVIEW_AI_IDENTITY_INVALID");
  }
};

const projectOverviewAiDerivedIdentityBase = (
  baseIdentity: OverviewAiArtifactIdentityV13,
): OverviewAiArtifactIdentityV13 => {
  const {
    artifactKind: _artifactKind,
    targetId: _targetId,
    identityContractRevision: _identityContractRevision,
    capabilityRevision: _capabilityRevision,
    publicationRevision: _publicationRevision,
    canvasRevision: _canvasRevision,
    methodSetId: _methodSetId,
    methodSetRevision: _methodSetRevision,
    methodSetFingerprint: _methodSetFingerprint,
    ...identity
  } = baseIdentity;
  return identity;
};

export const createOverviewAiArtifactIdentity = (input: {
  workspaceId: string;
  projectId: string;
  scopeId: string;
  dataSnapshotId: string;
  projectReleaseId: string;
  analysisPeriodFrom: string;
  analysisPeriodTo: string;
  rendererKey: string;
  rendererVersion: string;
  modelProfileId: string;
  modelProfileRevision: number;
  reportTimeBasis?: ReportTimeBasis;
  reportTimeIdentity?: Pick<EnergyIqOverviewAiArtifactIdentity,
    "reportTimePolicyId" | "reportTimePolicyRevision" | "reportTimeContextFingerprint">;
}): OverviewAiArtifactIdentityV13 => {
  const contract = resolveOverviewAiContract(input);
  if (!contract) throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_CONTRACT_NOT_FOUND");
  const reportTimeIdentity = input.reportTimeBasis
    ? overviewAiReportTimeIdentity(input.reportTimeBasis)
    : input.reportTimeIdentity;
  return {
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    scopeId: input.scopeId,
    resource: "electricity",
    dataSnapshotId: input.dataSnapshotId,
    projectReleaseId: input.projectReleaseId,
    analysisPeriodFrom: input.analysisPeriodFrom,
    analysisPeriodTo: input.analysisPeriodTo,
    ...(reportTimeIdentity?.reportTimePolicyId
      ? { reportTimePolicyId: reportTimeIdentity.reportTimePolicyId }
      : {}),
    ...(reportTimeIdentity?.reportTimePolicyRevision
      ? { reportTimePolicyRevision: reportTimeIdentity.reportTimePolicyRevision }
      : {}),
    ...(reportTimeIdentity?.reportTimeContextFingerprint
      ? { reportTimeContextFingerprint: reportTimeIdentity.reportTimeContextFingerprint }
      : {}),
    rendererKey: input.rendererKey,
    rendererVersion: input.rendererVersion,
    ...contract,
    modelProfileId: input.modelProfileId,
    modelProfileRevision: input.modelProfileRevision,
  };
};

export const overviewAiReportTimeIdentity = (
  basis: ReportTimeBasis,
): Required<Pick<EnergyIqOverviewAiArtifactIdentity,
  "reportTimePolicyId" | "reportTimePolicyRevision" | "reportTimeContextFingerprint">> => ({
  reportTimePolicyId: basis.policyId,
  reportTimePolicyRevision: basis.policyRevision,
  reportTimeContextFingerprint: createHash("sha256").update(JSON.stringify(basis)).digest("hex"),
});

export const requireCurrentNgeeAnnBaseIdentity = (
  identity: EnergyIqOverviewAiArtifactIdentity,
): OverviewAiArtifactIdentityV13 => {
  if (identity.rendererKey !== "ngee-ann-overview") {
    throw new Error("ENERGYIQ_NGEE_ANN_OVERVIEW_AI_IDENTITY_INVALID");
  }
  let current: OverviewAiArtifactIdentityV13;
  try {
    current = createOverviewAiArtifactIdentity({
      workspaceId: identity.workspaceId,
      projectId: identity.projectId,
      scopeId: identity.scopeId,
      dataSnapshotId: identity.dataSnapshotId,
      projectReleaseId: identity.projectReleaseId,
      analysisPeriodFrom: identity.analysisPeriodFrom,
      analysisPeriodTo: identity.analysisPeriodTo,
      rendererKey: identity.rendererKey,
      rendererVersion: identity.rendererVersion,
      modelProfileId: identity.modelProfileId,
      modelProfileRevision: identity.modelProfileRevision,
      ...(identity.reportTimePolicyId
        && identity.reportTimePolicyRevision
        && identity.reportTimeContextFingerprint ? {
          reportTimeIdentity: {
            reportTimePolicyId: identity.reportTimePolicyId,
            reportTimePolicyRevision: identity.reportTimePolicyRevision,
            reportTimeContextFingerprint: identity.reportTimeContextFingerprint,
          },
        } : {}),
    });
  } catch {
    throw new Error("ENERGYIQ_NGEE_ANN_OVERVIEW_AI_IDENTITY_INVALID");
  }
  if (!isDeepStrictEqual(current, identity)) {
    throw new Error("ENERGYIQ_NGEE_ANN_OVERVIEW_AI_IDENTITY_INVALID");
  }
  return current;
};

export const requireCurrentTuyaOfficeBaseIdentity = (
  identity: EnergyIqOverviewAiArtifactIdentity,
): OverviewAiArtifactIdentityV13 => {
  requireTuyaOfficeIdentityBinding(identity);
  if (!identity.reportTimePolicyId
    || !identity.reportTimePolicyRevision
    || !identity.reportTimeContextFingerprint) {
    throw new Error("ENERGYIQ_TUYA_OFFICE_OVERVIEW_AI_IDENTITY_INVALID");
  }
  let current: OverviewAiArtifactIdentityV13;
  try {
    current = createOverviewAiArtifactIdentity({
      workspaceId: identity.workspaceId,
      projectId: identity.projectId,
      scopeId: identity.scopeId,
      dataSnapshotId: identity.dataSnapshotId,
      projectReleaseId: identity.projectReleaseId,
      analysisPeriodFrom: identity.analysisPeriodFrom,
      analysisPeriodTo: identity.analysisPeriodTo,
      rendererKey: identity.rendererKey,
      rendererVersion: identity.rendererVersion,
      modelProfileId: identity.modelProfileId,
      modelProfileRevision: identity.modelProfileRevision,
      ...(identity.reportTimePolicyId
        && identity.reportTimePolicyRevision
        && identity.reportTimeContextFingerprint ? {
          reportTimeIdentity: {
            reportTimePolicyId: identity.reportTimePolicyId,
            reportTimePolicyRevision: identity.reportTimePolicyRevision,
            reportTimeContextFingerprint: identity.reportTimeContextFingerprint,
          },
        } : {}),
    });
  } catch {
    throw new Error("ENERGYIQ_TUYA_OFFICE_OVERVIEW_AI_IDENTITY_INVALID");
  }
  if (!isDeepStrictEqual(current, identity)) {
    throw new Error("ENERGYIQ_TUYA_OFFICE_OVERVIEW_AI_IDENTITY_INVALID");
  }
  return current;
};

export const requireOverviewAiModelRuntimeIdentity = (
  metadataStore: MetadataStore,
  identity: EnergyIqOverviewAiArtifactIdentity,
): void => {
  const modelBinding = metadataStore.workspaceDefaultModelProfiles.find(ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID);
  if (!modelBinding
    || identity.modelProfileId !== WORKSPACE_DEFAULT_MODEL_PROFILE_ID
    || modelBinding.revision !== identity.modelProfileRevision) {
    throw new Error("OVERVIEW_AI_MODEL_PROFILE_REVISION_MISMATCH");
  }
  const modelResource = metadataStore.configResources.find({
    workspace_id: ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID,
    user_id: modelBinding.profile_owner_user_id,
    kind: "model-profile",
    id: modelBinding.profile_id,
  });
  if (!modelResource || modelResource.status !== "connected" || !modelResource.default_enabled) {
    throw new Error("OVERVIEW_AI_MODEL_PROFILE_REVISION_MISMATCH");
  }
};

export const requirePreschoolHtmlAiSlotModelRuntimeIdentity = (
  metadataStore: MetadataStore,
  identity: EnergyIqOverviewAiArtifactIdentity,
): void => {
  requireOverviewAiModelRuntimeIdentity(metadataStore, identity);
  const modelBinding = metadataStore.workspaceDefaultModelProfiles.find(ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID);
  const modelResource = modelBinding
    ? metadataStore.configResources.find({
      workspace_id: ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID,
      user_id: modelBinding.profile_owner_user_id,
      kind: "model-profile",
      id: modelBinding.profile_id,
    })
    : null;
  const payload = modelResource?.payload;
  const provider = payload && typeof payload === "object" && !Array.isArray(payload)
    ? String((payload as Record<string, unknown>).provider ?? "").trim().toLowerCase()
    : "";
  const modelName = payload && typeof payload === "object" && !Array.isArray(payload)
    ? String((payload as Record<string, unknown>).modelName ?? (payload as Record<string, unknown>).model ?? "").trim().toLowerCase()
    : "";
  if (provider !== "deepseek" || modelName !== "deepseek-v4-flash") {
    throw new Error("PRESCHOOL_HTML_AI_SLOT_MODEL_PROFILE_INVALID");
  }
};

/**
 * Projects a derived Overview AI artifact identity back to the exact current
 * Layer 1/2 base identity. Derived fields must never leak into sibling
 * Section or Executive identities.
 */
export const projectCurrentOverviewAiArtifactBaseIdentity = (
  identity: EnergyIqOverviewAiArtifactIdentity,
): OverviewAiArtifactIdentityV13 => createOverviewAiArtifactIdentity({
  workspaceId: identity.workspaceId,
  projectId: identity.projectId,
  scopeId: identity.scopeId,
  dataSnapshotId: identity.dataSnapshotId,
  projectReleaseId: identity.projectReleaseId,
  analysisPeriodFrom: identity.analysisPeriodFrom,
  analysisPeriodTo: identity.analysisPeriodTo,
  rendererKey: identity.rendererKey,
  rendererVersion: identity.rendererVersion,
  modelProfileId: identity.modelProfileId,
  modelProfileRevision: identity.modelProfileRevision,
  ...(identity.reportTimePolicyId
    && identity.reportTimePolicyRevision
    && identity.reportTimeContextFingerprint ? {
      reportTimeIdentity: {
        reportTimePolicyId: identity.reportTimePolicyId,
        reportTimePolicyRevision: identity.reportTimePolicyRevision,
        reportTimeContextFingerprint: identity.reportTimeContextFingerprint,
      },
    } : {}),
});

export const createPreschoolAdditionalAiInsightArtifactIdentity = (input: {
  baseIdentity: OverviewAiArtifactIdentityV13;
  methodSet?: ReturnType<typeof resolveCurrentAdditionalAiInsightMethodSet>;
}): PreschoolAdditionalAiInsightArtifactIdentity => {
  if (input.baseIdentity.rendererKey !== "preschool-overview") {
    throw new Error("ENERGYIQ_ADDITIONAL_INSIGHT_RENDERER_INVALID");
  }
  const methodSet = input.methodSet
    ?? resolveCurrentAdditionalAiInsightMethodSet(input.baseIdentity.workspaceId);
  if (methodSet.methods.some(({ workspaceId }) => workspaceId !== input.baseIdentity.workspaceId)) {
    throw new Error("ENERGYIQ_ADDITIONAL_INSIGHT_METHOD_SET_INVALID");
  }
  const canonicalMethods = canonicalInsightMethodSetJson(methodSet.methods);
  if (canonicalMethods === null) throw new Error("ENERGYIQ_ADDITIONAL_INSIGHT_METHOD_SET_INVALID");
  return {
    ...input.baseIdentity,
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
    methodSetFingerprint: `sha256:${createHash("sha256").update(canonicalMethods).digest("hex")}`,
    capabilityRevision: "scoped-read-only-v1",
    publicationRevision: "additional-insights-v2",
    canvasRevision: "energyiq-insight-canvas-v2",
  };
};

export const createNgeeAnnAdditionalAiInsightArtifactIdentity = (input: {
  baseIdentity: OverviewAiArtifactIdentityV13;
  methodSet?: ReturnType<typeof resolveCurrentAdditionalAiInsightMethodSet>;
}): NgeeAnnAdditionalAiInsightArtifactIdentity => {
  if (input.baseIdentity.rendererKey !== "ngee-ann-overview") {
    throw new Error("ENERGYIQ_ADDITIONAL_INSIGHT_RENDERER_INVALID");
  }
  const methodSet = input.methodSet
    ?? resolveCurrentAdditionalAiInsightMethodSet(input.baseIdentity.workspaceId);
  if (methodSet.methods.some(({ workspaceId }) => workspaceId !== input.baseIdentity.workspaceId)) {
    throw new Error("ENERGYIQ_ADDITIONAL_INSIGHT_METHOD_SET_INVALID");
  }
  const canonicalMethods = canonicalInsightMethodSetJson(methodSet.methods);
  if (canonicalMethods === null) throw new Error("ENERGYIQ_ADDITIONAL_INSIGHT_METHOD_SET_INVALID");
  return {
    ...input.baseIdentity,
    artifactKind: "autonomous-insights",
    identityContractRevision: "ngee-ann-additional-insights-v4",
    analysisPackId: "ngee-ann-additional-insights-pack",
    analysisPackRevision: "v1",
    outputContractRevision: "energyiq-additional-ai-insights-v2",
    validatorRevision: "additional-insights-acceptance-v18",
    workflowRevision: "additional-insights-discover-accept-publish-v21",
    investigatorPromptRevision: "additional-insights-discovery-v11",
    editorPromptRevision: "additional-insights-publication-v2",
    methodSkillId: "energyiq-open-discovery",
    methodSkillRevision: "1.0.0",
    methodSetId: CURRENT_ADDITIONAL_AI_INSIGHT_METHOD_SET_ID,
    methodSetRevision: CURRENT_ADDITIONAL_AI_INSIGHT_METHOD_SET_REVISION,
    methodSetFingerprint: `sha256:${createHash("sha256").update(canonicalMethods).digest("hex")}`,
    capabilityRevision: "scoped-read-only-v1",
    publicationRevision: "additional-insights-v2",
    canvasRevision: "energyiq-insight-canvas-v2",
  };
};

export const createTuyaOfficeAdditionalAiInsightArtifactIdentity = (input: {
  baseIdentity: OverviewAiArtifactIdentityV13;
  methodSet?: ReturnType<typeof resolveCurrentAdditionalAiInsightMethodSet>;
  unit: ProjectOverviewAiSurfaceUnitDefinition;
}): TuyaOfficeAdditionalAiInsightArtifactIdentity => {
  requireCurrentTuyaOfficeBaseIdentity(input.baseIdentity);
  const methodSet = input.methodSet
    ?? resolveCurrentAdditionalAiInsightMethodSet(input.baseIdentity.workspaceId);
  if (methodSet.methods.some(({ workspaceId }) => workspaceId !== input.baseIdentity.workspaceId)) {
    throw new Error("ENERGYIQ_ADDITIONAL_INSIGHT_METHOD_SET_INVALID");
  }
  const canonicalMethods = canonicalInsightMethodSetJson(methodSet.methods);
  if (canonicalMethods === null) throw new Error("ENERGYIQ_ADDITIONAL_INSIGHT_METHOD_SET_INVALID");
  const generation = input.unit.generation;
  if (!generation
    || generation.toolPolicyRevision !== "scoped-read-only-v1"
    || generation.outputContractRevision !== "energyiq-additional-ai-insights-v3") {
    throw new Error("ENERGYIQ_TUYA_OFFICE_AI_SURFACE_DEFINITION_INVALID");
  }
  return {
    ...input.baseIdentity,
    artifactKind: "autonomous-insights",
    identityContractRevision: "tuya-office-additional-insights-v2",
    analysisPackId: "tuya-office-additional-insights-pack",
    analysisPackRevision: "v1",
    outputContractRevision: "energyiq-additional-ai-insights-v3",
    validatorRevision: generation.validatorRevision,
    workflowRevision: "additional-insights-discover-accept-publish-v21",
    investigatorPromptRevision: "additional-insights-discovery-v13",
    editorPromptRevision: "additional-insights-publication-v2",
    methodSkillId: generation.skillId,
    methodSkillRevision: generation.skillRevision,
    methodSetId: CURRENT_ADDITIONAL_AI_INSIGHT_METHOD_SET_ID,
    methodSetRevision: CURRENT_ADDITIONAL_AI_INSIGHT_METHOD_SET_REVISION,
    methodSetFingerprint: `sha256:${createHash("sha256").update(canonicalMethods).digest("hex")}`,
    capabilityRevision: generation.toolPolicyRevision,
    publicationRevision: "additional-insights-v2",
    canvasRevision: "energyiq-insight-canvas-v2",
  };
};

/** True only for the current server-owned Additional discovery behavior. */
export const isCurrentPreschoolAdditionalAiInsightArtifactIdentity = (
  identity: EnergyIqOverviewAiArtifactIdentity,
): identity is PreschoolAdditionalAiInsightArtifactIdentity =>
  identity.artifactKind === "autonomous-insights"
  && identity.identityContractRevision === "additional-insights-v24"
  && identity.analysisPackId === "preschool-additional-insights-pack"
  && identity.analysisPackRevision === "v1"
  && identity.outputContractRevision === "energyiq-additional-ai-insights-v2"
  && identity.validatorRevision === "additional-insights-acceptance-v17"
  && identity.workflowRevision === "additional-insights-discover-accept-publish-v21"
  && identity.investigatorPromptRevision === "additional-insights-discovery-v12"
  && identity.editorPromptRevision === "additional-insights-publication-v2"
  && identity.methodSkillId === "energyiq-open-discovery"
  && identity.methodSkillRevision === "1.0.0"
  && identity.methodSetId === CURRENT_ADDITIONAL_AI_INSIGHT_METHOD_SET_ID
  && identity.methodSetRevision === CURRENT_ADDITIONAL_AI_INSIGHT_METHOD_SET_REVISION
  && typeof identity.methodSetFingerprint === "string"
  && /^sha256:[0-9a-f]{64}$/u.test(identity.methodSetFingerprint)
  && identity.capabilityRevision === "scoped-read-only-v1"
  && identity.publicationRevision === "additional-insights-v2"
  && identity.canvasRevision === "energyiq-insight-canvas-v2";

export const isCurrentProjectAdditionalAiInsightArtifactIdentity = (
  identity: EnergyIqOverviewAiArtifactIdentity,
): identity is ProjectAdditionalAiInsightArtifactIdentity =>
  isCurrentPreschoolAdditionalAiInsightArtifactIdentity(identity)
  || (identity.rendererKey === "ngee-ann-overview"
    && identity.artifactKind === "autonomous-insights"
    && identity.identityContractRevision === "ngee-ann-additional-insights-v4"
    && identity.analysisPackId === "ngee-ann-additional-insights-pack"
    && identity.analysisPackRevision === "v1"
    && identity.outputContractRevision === "energyiq-additional-ai-insights-v2"
    && identity.validatorRevision === "additional-insights-acceptance-v18"
    && identity.workflowRevision === "additional-insights-discover-accept-publish-v21"
    && identity.investigatorPromptRevision === "additional-insights-discovery-v11"
    && identity.editorPromptRevision === "additional-insights-publication-v2"
    && identity.methodSkillId === "energyiq-open-discovery"
    && identity.methodSkillRevision === "1.0.0"
    && identity.methodSetId === CURRENT_ADDITIONAL_AI_INSIGHT_METHOD_SET_ID
    && identity.methodSetRevision === CURRENT_ADDITIONAL_AI_INSIGHT_METHOD_SET_REVISION
    && typeof identity.methodSetFingerprint === "string"
    && /^sha256:[0-9a-f]{64}$/u.test(identity.methodSetFingerprint)
    && identity.capabilityRevision === "scoped-read-only-v1"
    && identity.publicationRevision === "additional-insights-v2"
    && identity.canvasRevision === "energyiq-insight-canvas-v2")
  || (identity.projectId === TUYA_OFFICE_PROJECT_ID
    && identity.rendererKey === "tuya-office-overview"
    && identity.artifactKind === "autonomous-insights"
    && identity.identityContractRevision === "tuya-office-additional-insights-v2"
    && identity.analysisPackId === "tuya-office-additional-insights-pack"
    && identity.analysisPackRevision === "v1"
    && identity.outputContractRevision === "energyiq-additional-ai-insights-v3"
    && identity.validatorRevision === "additional-insights-acceptance-v19"
    && identity.workflowRevision === "additional-insights-discover-accept-publish-v21"
    && identity.investigatorPromptRevision === "additional-insights-discovery-v13"
    && identity.editorPromptRevision === "additional-insights-publication-v2"
    && identity.methodSkillId === "none"
    && identity.methodSkillRevision === "not-applicable-v1"
    && identity.methodSetId === CURRENT_ADDITIONAL_AI_INSIGHT_METHOD_SET_ID
    && identity.methodSetRevision === CURRENT_ADDITIONAL_AI_INSIGHT_METHOD_SET_REVISION
    && typeof identity.methodSetFingerprint === "string"
    && /^sha256:[0-9a-f]{64}$/u.test(identity.methodSetFingerprint)
    && identity.capabilityRevision === "scoped-read-only-v1"
    && identity.publicationRevision === "additional-insights-v2"
    && identity.canvasRevision === "energyiq-insight-canvas-v2"
    && typeof identity.reportTimePolicyId === "string"
    && identity.reportTimePolicyId.length > 0
    && typeof identity.reportTimePolicyRevision === "string"
    && identity.reportTimePolicyRevision.length > 0
    && typeof identity.reportTimeContextFingerprint === "string"
    && identity.reportTimeContextFingerprint.length > 0);

export const createPreschoolOverviewAiValueArtifactIdentity = (input: {
  baseIdentity: OverviewAiArtifactIdentityV13;
  artifactKind: "section-interpretation" | "executive-synthesis";
  targetId?: PreschoolSectionId | string;
}): PreschoolOverviewAiValueArtifactIdentity => {
  if (!input.targetId?.trim()) {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_TARGET_REQUIRED");
  }
  if (input.artifactKind === "section-interpretation") {
    return createPreschoolOverviewAiSectionArtifactIdentityV3({
      baseIdentity: input.baseIdentity,
      targetId: input.targetId,
    });
  }
  const {
    artifactKind: _legacyArtifactKind,
    targetId: _legacyTargetId,
    identityContractRevision: _legacyIdentityContractRevision,
    capabilityRevision: _legacyCapabilityRevision,
    publicationRevision: _legacyPublicationRevision,
    ...baseIdentity
  } = input.baseIdentity;
  return {
    ...baseIdentity,
    artifactKind: input.artifactKind,
    targetId: input.targetId,
    outputContractRevision: "preschool-executive-synthesis-v1",
    validatorRevision: "preschool-executive-synthesis-validator-v3",
    workflowRevision: "preschool-executive-synthesis-v9",
    investigatorPromptRevision: "preschool-executive-synthesis-prompt-v2",
    editorPromptRevision: "not-applicable-v1",
    methodSkillId: "none",
    methodSkillRevision: "not-applicable-v1",
  };
};

export const createPreschoolOverviewAiExecutiveArtifactIdentityV4 = (input: {
  baseIdentity: OverviewAiArtifactIdentityV13;
  targetId: string;
}): PreschoolOverviewAiValueArtifactIdentity => {
  if (!input.targetId.trim()) {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_TARGET_REQUIRED");
  }
  const {
    artifactKind: _legacyArtifactKind,
    targetId: _legacyTargetId,
    identityContractRevision: _legacyIdentityContractRevision,
    capabilityRevision: _legacyCapabilityRevision,
    publicationRevision: _legacyPublicationRevision,
    ...baseIdentity
  } = input.baseIdentity;
  return {
    ...baseIdentity,
    artifactKind: "executive-synthesis",
    targetId: input.targetId,
    identityContractRevision: "v4",
    analysisPackId: "preschool-executive-section-artifacts",
    analysisPackRevision: "section-interpretation-v4",
    outputContractRevision: "preschool-executive-synthesis-v4",
    validatorRevision: "preschool-executive-synthesis-validator-v24",
    workflowRevision: "preschool-executive-synthesis-v12",
    investigatorPromptRevision: "preschool-executive-synthesis-prompt-v15",
    editorPromptRevision: "not-applicable-v1",
    methodSkillId: "none",
    methodSkillRevision: "not-applicable-v1",
    capabilityRevision: "section-artifacts-and-overview-evidence-v2",
    publicationRevision: "key-findings-v2",
  };
};

export const createPreschoolOverviewAiSectionArtifactIdentityV3 = (input: {
  baseIdentity: OverviewAiArtifactIdentityV13;
  targetId: PreschoolSectionId | string;
}): PreschoolOverviewAiValueArtifactIdentity => {
  if (!input.targetId.trim()) {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_TARGET_REQUIRED");
  }
  const {
    artifactKind: _legacyArtifactKind,
    targetId: _legacyTargetId,
    identityContractRevision: _identityContractRevision,
    capabilityRevision: _capabilityRevision,
    publicationRevision: _publicationRevision,
    ...baseIdentity
  } = input.baseIdentity;
  return {
    ...baseIdentity,
    artifactKind: "section-interpretation",
    targetId: input.targetId,
    outputContractRevision: "preschool-section-interpretation-v3",
    validatorRevision: "preschool-section-interpreter-validator-v12",
    workflowRevision: "preschool-section-interpreter-v14",
    investigatorPromptRevision: "preschool-section-interpreter-prompt-v14",
    editorPromptRevision: "not-applicable-v1",
    methodSkillId: "none",
    methodSkillRevision: "not-applicable-v1",
  };
};

export const createPreschoolOverviewAiSectionArtifactIdentityV4 = (input: {
  baseIdentity: OverviewAiArtifactIdentityV13;
  targetId: PreschoolSectionId | string;
}): PreschoolOverviewAiValueArtifactIdentity => {
  if (!input.targetId.trim()) {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_TARGET_REQUIRED");
  }
  const {
    artifactKind: _legacyArtifactKind,
    targetId: _legacyTargetId,
    identityContractRevision: _identityContractRevision,
    capabilityRevision: _capabilityRevision,
    publicationRevision: _publicationRevision,
    ...baseIdentity
  } = input.baseIdentity;
  return {
    ...baseIdentity,
    artifactKind: "section-interpretation",
    targetId: input.targetId,
    identityContractRevision: "v4",
    analysisPackId: "preschool-section-pack",
    analysisPackRevision: "v2",
    outputContractRevision: "preschool-section-interpretation-v4",
    validatorRevision: "acceptance-validator-v18",
    workflowRevision: "discover-tools-accept-publish-v4",
    investigatorPromptRevision: "discovery-prompt-v14",
    editorPromptRevision: "not-applicable-v1",
    methodSkillId: "none",
    methodSkillRevision: "not-applicable-v1",
    capabilityRevision: "scoped-read-only-v1",
    publicationRevision: "v1",
  };
};

export const overviewAiArtifactIdentityFromSnapshot = (input: {
  snapshot: ProjectAnalysisSnapshot;
  modelBinding: WorkspaceDefaultModelProfileRecord;
}): OverviewAiArtifactIdentityV13 => createOverviewAiArtifactIdentity({
  workspaceId: input.snapshot.context.workspaceId,
  projectId: input.snapshot.context.projectId,
  scopeId: input.snapshot.context.scopeId,
  dataSnapshotId: input.snapshot.dataSnapshot.id,
  projectReleaseId: input.snapshot.projectRelease.id,
  analysisPeriodFrom: input.snapshot.context.primaryPeriod.start,
  analysisPeriodTo: input.snapshot.context.primaryPeriod.endExclusive,
  rendererKey: input.snapshot.renderer.key,
  rendererVersion: input.snapshot.renderer.version,
  modelProfileId: WORKSPACE_DEFAULT_MODEL_PROFILE_ID,
  modelProfileRevision: input.modelBinding.revision,
  ...(input.snapshot.reportTimeContext
    ? { reportTimeBasis: reportTimeBasisFromContext(input.snapshot.reportTimeContext) }
    : {}),
});

export const overviewAiArtifactPinnedLocalPeriod = (input: {
  identity: Pick<EnergyIqOverviewAiArtifactIdentity, "analysisPeriodFrom" | "analysisPeriodTo">;
  timezone: string;
}): { from: string; to: string } => {
  const from = localDateAtTimezone(input.identity.analysisPeriodFrom, input.timezone);
  const endExclusive = localDateAtTimezone(input.identity.analysisPeriodTo, input.timezone);
  const to = shiftLocalDate(endExclusive, -1);
  if (from > to) throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_PERIOD_INVALID");
  return { from, to };
};

export const queueCurrentProjectOverviewAiArtifact = async (input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  projectId: string;
  user: UserRecord;
}): Promise<EnergyIqOverviewAiArtifactRecord | null> => {
  const project = input.metadataStore.energyIq.getProject(input.projectId);
  if (project.status !== "published" || project.delivery_stage !== "published") return null;
  const modelBinding = input.metadataStore.workspaceDefaultModelProfiles.find(ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID);
  if (!modelBinding) return null;
  if (project.id !== "preschool-demo") return null;
  const projection = await readCurrentProjectOverviewProjection({
    metadataStore: input.metadataStore,
    dataGateway: input.dataGateway,
    user: input.user,
    workspaceId: project.workspace_id,
    projectId: project.id,
  });
  const resolution = projection.resolution;
  if (resolution.status !== "ready" || resolution.snapshot.dataSnapshot.id !== project.data_snapshot_id) return null;
  const identity = overviewAiArtifactIdentityFromSnapshot({ snapshot: resolution.snapshot, modelBinding });
  return input.metadataStore.energyIq.overviewAiArtifacts.queue({
    identity,
    triggeredBy: input.user.id,
  });
};

export const resolveCurrentOverviewAiArtifactIdentity = async (input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  projectId: string;
  scopeId: string;
  user: UserRecord;
  pin?: {
    from: string;
    to: string;
    dataSnapshotId: string;
    projectReleaseId: string;
  };
}): Promise<OverviewAiArtifactIdentityV13> => {
  const project = input.metadataStore.energyIq.getProject(input.projectId);
  if (input.scopeId !== project.root_scope_id) {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_PROJECT_SCOPE_REQUIRED");
  }
  const modelBinding = input.metadataStore.workspaceDefaultModelProfiles.get(ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID);
  const projection = await readCurrentProjectOverviewProjection({
    metadataStore: input.metadataStore,
    dataGateway: input.dataGateway,
    user: input.user,
    workspaceId: project.workspace_id,
    projectId: project.id,
    ...(input.pin ? {
      expectedFrom: input.pin.from,
      expectedTo: input.pin.to,
      expectedDataSnapshotId: input.pin.dataSnapshotId,
      expectedProjectReleaseId: input.pin.projectReleaseId,
    } : {}),
  });
  const resolution = projection.resolution;
  return overviewAiArtifactIdentityFromSnapshot({ snapshot: resolution.snapshot, modelBinding });
};

export const currentOverviewAiArtifactAnalysisRequest = (
  projectId: string,
  scopeId: string,
  pin?: { from: string; to: string; dataSnapshotId: string; projectReleaseId: string },
) => ({
  projectId,
  scopeId,
  resource: "electricity" as const,
  analysisWindow: "current-project-overview" as const,
  ...(pin ? {
    from: pin.from,
    to: pin.to,
    expectedDataSnapshotId: pin.dataSnapshotId,
    expectedProjectReleaseId: pin.projectReleaseId,
  } : {}),
});

export const resolvePinnedOverviewAiArtifactReadIdentity = (input: {
  metadataStore: MetadataStore;
  projectId: string;
  scopeId: string;
  user: UserRecord;
  pin: {
    from: string;
    to: string;
    dataSnapshotId: string;
    projectReleaseId: string;
  };
}): OverviewAiArtifactIdentityV13 => {
  const project = input.metadataStore.energyIq.getProject(input.projectId);
  const access = resolveEnergyAccessContext({
    metadataStore: input.metadataStore,
    user: input.user,
    requestedWorkspaceId: project.workspace_id,
  });
  const accessibleProject = access.projects.find((candidate) => candidate.id === project.id);
  if (!accessibleProject || accessibleProject.workspaceId !== access.activeWorkspaceId) {
    throw new Error("ENERGYIQ_PROJECT_FORBIDDEN");
  }
  if (accessibleProject.status !== "published" && access.role !== "admin") {
    throw new Error("ENERGYIQ_PROJECT_FORBIDDEN");
  }
  if (input.scopeId !== project.root_scope_id) {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_PROJECT_SCOPE_REQUIRED");
  }
  if (project.status !== "published") {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RELEASE_REQUIRED");
  }
  if (input.pin.dataSnapshotId !== project.data_snapshot_id) {
    throw new Error("ENERGYIQ_DATA_SNAPSHOT_MISMATCH");
  }

  const profile = resolveProjectOverviewProfile(input.metadataStore, project.id);
  if (!profile || profile.rendererKey !== "preschool-overview") {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_CONTRACT_NOT_FOUND");
  }
  const currentProjectReleaseId = resolveProjectOverviewReleaseId(input.metadataStore, project.id);
  if (!currentProjectReleaseId) {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_RELEASE_REQUIRED");
  }
  if (input.pin.projectReleaseId !== currentProjectReleaseId) {
    throw new Error("ENERGYIQ_PROJECT_RELEASE_MISMATCH");
  }

  const from = requireLocalDate(input.pin.from);
  const to = requireLocalDate(input.pin.to);
  if (from > to) throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_PERIOD_INVALID");
  const modelBinding = input.metadataStore.workspaceDefaultModelProfiles.get(ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID);
  return createOverviewAiArtifactIdentity({
    workspaceId: project.workspace_id,
    projectId: project.id,
    scopeId: project.root_scope_id,
    dataSnapshotId: project.data_snapshot_id,
    projectReleaseId: currentProjectReleaseId,
    analysisPeriodFrom: zonedStartOfLocalDate(from, project.timezone),
    analysisPeriodTo: zonedStartOfLocalDate(shiftLocalDate(to, 1), project.timezone),
    rendererKey: profile.rendererKey,
    rendererVersion: "1",
    modelProfileId: WORKSPACE_DEFAULT_MODEL_PROFILE_ID,
    modelProfileRevision: modelBinding.revision,
  });
};

const localDateAtTimezone = (value: string, timezone: string): string => {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_PERIOD_INVALID");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};

const shiftLocalDate = (value: string, days: number): string => {
  const [year, month, day] = value.split("-").map(Number);
  const shifted = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
};

const requireLocalDate = (value: string): string => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_PERIOD_INVALID");
  }
  const [year, month, day] = value.split("-").map(Number);
  const normalized = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)).toISOString().slice(0, 10);
  if (normalized !== value) throw new Error("ENERGYIQ_OVERVIEW_AI_ARTIFACT_PERIOD_INVALID");
  return value;
};

const zonedStartOfLocalDate = (date: string, timezone: string): string => {
  const [year, month, day] = date.split("-").map(Number);
  const targetUtc = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1);
  let candidate = targetUtc;
  for (let index = 0; index < 3; index += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(candidate));
    const get = (type: Intl.DateTimeFormatPartTypes): number =>
      Number(parts.find((part) => part.type === type)?.value ?? 0);
    const observedAsUtc = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second"),
    );
    candidate += targetUtc - observedAsUtc;
  }
  return new Date(candidate).toISOString();
};
