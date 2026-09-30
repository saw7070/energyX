import type {
  EnergyIqOverviewAiArtifactIdentity,
  UserRecord,
} from "@datafoundry/metadata";

import type { ProjectRendererKey } from "./project-analysis-resolver.js";

export type ProjectOverviewAiSectionDefinition = {
  id: string;
  regionId?: string;
  label: string;
  slotId?: string;
  order?: number;
  generation?: ProjectOverviewAiUnitGenerationDefinition;
};

export type ProjectOverviewAiUnitGenerationDefinition = {
  revision: string;
  role: string;
  skillId: string;
  skillRevision: string;
  methodId: string;
  methodRevision: string;
  contextRevision: string;
  toolPolicyRevision: string;
  outputContractRevision: string;
  validatorRevision: string;
  presentationReferenceRevision: string;
};

export type ProjectOverviewAiSurfaceUnitDefinition = {
  slotId: string;
  regionId: string;
  label: string;
  order: number;
  generation?: ProjectOverviewAiUnitGenerationDefinition;
};

export type ProjectOverviewAiSurfaceDefinition = {
  overviewDefinitionRevision: string;
  keyFindings?: ProjectOverviewAiSurfaceUnitDefinition;
  sections: readonly ProjectOverviewAiSectionDefinition[];
  additionalInsights?: ProjectOverviewAiSurfaceUnitDefinition;
};

export type ProjectOverviewAiUnitStatus =
  | { status: "missing" }
  | { status: "queued" | "running"; artifactId?: string }
  | { status: "available"; artifactId: string; completedAt?: string; result: unknown }
  | { status: "empty"; artifactId: string; runId?: string; completedAt?: string }
  | { status: "failed"; reason: string; artifactId: string; completedAt?: string }
  | { status: "unavailable"; reason: string; artifactId?: string; completedAt?: string };

export type ProjectOverviewAiReadModel = {
  contract: "energyiq-project-overview-ai-read-model@1";
  rendererKey: ProjectRendererKey;
  surface?: ProjectOverviewAiSurfaceDefinition;
  binding: {
    workspaceId: string;
    projectId: string;
    scopeId: string;
    dataSnapshotId: string;
    projectReleaseId: string;
    analysisPeriod: { from: string; to: string };
    modelProfileId: string;
    modelProfileRevision: number;
    generation: {
      rendererVersion: string;
      analysisPackId: string;
      analysisPackRevision: string;
      outputContractRevision: string;
      validatorRevision: string;
      workflowRevision: string;
      investigatorPromptRevision: string;
      editorPromptRevision: string;
      methodSkillId: string;
      methodSkillRevision: string;
      identityContractRevision?: string;
      capabilityRevision?: string;
      publicationRevision?: string;
      canvasRevision?: string;
      methodSetId?: string;
      methodSetRevision?: string;
      methodSetFingerprint?: string;
      reportTimePolicyId?: string;
      reportTimePolicyRevision?: string;
      reportTimeContextFingerprint?: string;
      units?: {
        keyFindings: Record<string, unknown>;
        sections: Record<string, Record<string, unknown>>;
        additionalInsights: Record<string, unknown>;
      };
    };
  };
  keyFindings: ProjectOverviewAiUnitStatus;
  sections: Record<string, ProjectOverviewAiUnitStatus>;
  additionalInsights: ProjectOverviewAiUnitStatus;
};

export type ProjectOverviewAiAdapter = {
  rendererKey: ProjectRendererKey;
  projectId: string;
  keyFindings: boolean;
  sections: readonly ProjectOverviewAiSectionDefinition[];
  additionalInsights: boolean;
  resolveSurface?: (identity: EnergyIqOverviewAiArtifactIdentity) => ProjectOverviewAiSurfaceDefinition;
  resolveIdentity(input: {
    projectId: string;
    scopeId: string;
    user: UserRecord;
    request: {
      kind: "current";
    } | {
      kind: "pinned";
      pin: { from: string; to: string; dataSnapshotId: string; projectReleaseId: string };
    };
  }): Promise<EnergyIqOverviewAiArtifactIdentity>;
  readExact(input: {
    identity: EnergyIqOverviewAiArtifactIdentity;
    user: UserRecord;
  }): Promise<ProjectOverviewAiReadModel | null>;
  generateMissing(input: {
    identity: EnergyIqOverviewAiArtifactIdentity;
    user: UserRecord;
    retryTarget?: string;
  }): Promise<ProjectOverviewAiReadModel>;
};

export const findProjectOverviewAiAdapter = (
  adapters: readonly ProjectOverviewAiAdapter[] | undefined,
  rendererKey: ProjectRendererKey | null,
  projectId: string,
): ProjectOverviewAiAdapter | null => {
  if (!rendererKey) return null;
  const matches = adapters?.filter((adapter) => (
    adapter.rendererKey === rendererKey && adapter.projectId === projectId
  )) ?? [];
  if (matches.length > 1) {
    throw new Error("ENERGYIQ_PROJECT_OVERVIEW_AI_ADAPTER_DUPLICATE");
  }
  return matches[0] ?? null;
};

export const projectOverviewAiReadModelMatchesIdentity = (
  readModel: ProjectOverviewAiReadModel,
  identity: EnergyIqOverviewAiArtifactIdentity,
  expectedSurface?: ProjectOverviewAiSurfaceDefinition,
): boolean => readModel.rendererKey === identity.rendererKey
  && (expectedSurface === undefined
    || readModel.surface?.overviewDefinitionRevision === expectedSurface.overviewDefinitionRevision)
  && readModel.binding.workspaceId === identity.workspaceId
  && readModel.binding.projectId === identity.projectId
  && readModel.binding.scopeId === identity.scopeId
  && readModel.binding.dataSnapshotId === identity.dataSnapshotId
  && readModel.binding.projectReleaseId === identity.projectReleaseId
  && readModel.binding.analysisPeriod.from === identity.analysisPeriodFrom
  && readModel.binding.analysisPeriod.to === identity.analysisPeriodTo
  && readModel.binding.modelProfileId === identity.modelProfileId
  && readModel.binding.modelProfileRevision === identity.modelProfileRevision
  && readModel.binding.generation.rendererVersion === identity.rendererVersion
  && readModel.binding.generation.analysisPackId === identity.analysisPackId
  && readModel.binding.generation.analysisPackRevision === identity.analysisPackRevision
  && readModel.binding.generation.outputContractRevision === identity.outputContractRevision
  && readModel.binding.generation.validatorRevision === identity.validatorRevision
  && readModel.binding.generation.workflowRevision === identity.workflowRevision
  && readModel.binding.generation.investigatorPromptRevision === identity.investigatorPromptRevision
  && readModel.binding.generation.editorPromptRevision === identity.editorPromptRevision
  && readModel.binding.generation.methodSkillId === identity.methodSkillId
  && readModel.binding.generation.methodSkillRevision === identity.methodSkillRevision
  && readModel.binding.generation.identityContractRevision === identity.identityContractRevision
  && readModel.binding.generation.capabilityRevision === identity.capabilityRevision
  && readModel.binding.generation.publicationRevision === identity.publicationRevision
  && readModel.binding.generation.canvasRevision === identity.canvasRevision
  && readModel.binding.generation.methodSetId === identity.methodSetId
  && readModel.binding.generation.methodSetRevision === identity.methodSetRevision
  && readModel.binding.generation.methodSetFingerprint === identity.methodSetFingerprint
  && readModel.binding.generation.reportTimePolicyId === identity.reportTimePolicyId
  && readModel.binding.generation.reportTimePolicyRevision === identity.reportTimePolicyRevision
  && readModel.binding.generation.reportTimeContextFingerprint === identity.reportTimeContextFingerprint;

export const projectOverviewAiGenerationBinding = (
  identity: EnergyIqOverviewAiArtifactIdentity,
): ProjectOverviewAiReadModel["binding"]["generation"] => ({
  rendererVersion: identity.rendererVersion,
  analysisPackId: identity.analysisPackId,
  analysisPackRevision: identity.analysisPackRevision,
  outputContractRevision: identity.outputContractRevision,
  validatorRevision: identity.validatorRevision,
  workflowRevision: identity.workflowRevision,
  investigatorPromptRevision: identity.investigatorPromptRevision,
  editorPromptRevision: identity.editorPromptRevision,
  methodSkillId: identity.methodSkillId,
  methodSkillRevision: identity.methodSkillRevision,
  ...(identity.identityContractRevision
    ? { identityContractRevision: identity.identityContractRevision }
    : {}),
  ...(identity.capabilityRevision ? { capabilityRevision: identity.capabilityRevision } : {}),
  ...(identity.publicationRevision ? { publicationRevision: identity.publicationRevision } : {}),
  ...(identity.canvasRevision ? { canvasRevision: identity.canvasRevision } : {}),
  ...(identity.methodSetId ? { methodSetId: identity.methodSetId } : {}),
  ...(identity.methodSetRevision ? { methodSetRevision: identity.methodSetRevision } : {}),
  ...(identity.methodSetFingerprint ? { methodSetFingerprint: identity.methodSetFingerprint } : {}),
  ...(identity.reportTimePolicyId ? { reportTimePolicyId: identity.reportTimePolicyId } : {}),
  ...(identity.reportTimePolicyRevision
    ? { reportTimePolicyRevision: identity.reportTimePolicyRevision }
    : {}),
  ...(identity.reportTimeContextFingerprint
    ? { reportTimeContextFingerprint: identity.reportTimeContextFingerprint }
    : {}),
});
