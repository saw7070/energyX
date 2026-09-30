import {
  ADDITIONAL_AI_INSIGHTS_SCOPED_READ_ONLY_TOOLS_V1,
  autonomousInsightOriginIsValid,
  insightMethodRevisionRefIsValid,
  resolveCurrentAdditionalAiInsightMethodSet,
  type AdditionalAiInsightMethodResource,
  type AdditionalAiInsightsArtifact,
  type InsightMethodRevisionRef,
} from "@datafoundry/contracts";
import type { EnergyIqInsightMethodProposalRecord } from "@datafoundry/metadata";

import type { PreschoolOverviewAiReadModel } from "./preschool-overview-ai-contracts.js";

export type ProjectAiMethodTrace = {
  skillId: string;
  semanticVersion: string;
  resourceId: string;
  resourceRevision: number;
  scope: "builtin" | "user" | "workspace";
  role: "core-method" | "expert-direction";
  usage: "actually-loaded" | "finding-attributed";
  technical: {
    contentSha256: string;
    workspaceId: string;
    ownerId: string;
  };
};

export type ProjectAiExplainabilityState = {
  status: "available" | "unavailable";
  detail: string;
  declared: {
    status: "available" | "partially-unavailable" | "unavailable";
    detail: string;
    skills: Array<{
      id: string;
      revision: string;
      availability: "declared-available";
    }>;
    methods: Array<{
      skillId: string;
      semanticVersion: string;
      resourceId: string;
      resourceRevision: number;
      scope: "builtin" | "workspace";
      lifecycle: "published";
      availability: "declared-available";
      technical: {
        contentSha256: string;
        workspaceId: string;
        ownerId: string;
        role: "core-method" | "expert-direction";
      };
    }>;
    tools: Array<{
      id: string;
      availability: "declared-available";
    }>;
  };
  governance: {
    status: "available" | "unavailable";
    detail: string;
    proposals: Array<{
      id: string;
      title: string;
      lifecycle: EnergyIqInsightMethodProposalRecord["status"];
      revision: number;
      visibility: "project";
      projectId: string;
      findingId: string;
      sourceArtifactId: string;
    }>;
  };
  currentArtifact: ProjectAiCurrentArtifactTrace | null;
};

export type ProjectAiCurrentArtifactTrace = {
  status: "available" | "unavailable";
  artifactId: string;
  readOnly: true;
  historical: false;
  detail: string;
  technical?: {
    runId: string;
    outputContractRevision: string;
    methodSetId: string;
    methodSetRevision: string;
    methodSetFingerprint: string;
    capabilityRevision: string;
  };
  loadedMethods?: ProjectAiMethodTrace[];
  findings?: Array<{
    id: string;
    title: string;
    status: "available" | "unavailable";
    detail: string;
    evidenceSignal?: string;
    aiAngle?: string;
    origin?: "ai-discovery" | "expert-sop" | "hybrid";
    novelContribution?: string;
    evidenceRefs?: string[];
    attributedMethods?: ProjectAiMethodTrace[];
    successfulTools?: Array<{
      auditId: string;
      toolName: string;
      evidenceRefs: string[];
      usage: "tool-succeeded";
    }>;
  }>;
};

export const projectAiExplainabilityState = (input: {
  workspaceId: string;
  readModel: PreschoolOverviewAiReadModel | null;
  publishedWorkspaceMethods?: readonly AdditionalAiInsightMethodResource[];
  proposals?: readonly EnergyIqInsightMethodProposalRecord[];
  declaredUnavailableDetail?: string;
  governanceUnavailableDetail?: string;
}): ProjectAiExplainabilityState => {
  const methodSet = resolveCurrentAdditionalAiInsightMethodSet(
    input.workspaceId,
    input.publishedWorkspaceMethods ?? [],
  );
  const declaredMethods = methodSet.methods.map((method) => ({
    skillId: method.skillId,
    semanticVersion: method.semanticVersion,
    resourceId: method.resourceId,
    resourceRevision: method.resourceRevision,
    scope: method.scope as "builtin" | "workspace",
    lifecycle: "published" as const,
    availability: "declared-available" as const,
    technical: {
      contentSha256: method.contentSha256,
      workspaceId: method.workspaceId,
      ownerId: method.userId,
      role: method.role,
    },
  }));
  const declared = {
    status: input.declaredUnavailableDetail ? "partially-unavailable" as const : "available" as const,
    detail: input.declaredUnavailableDetail
      ?? "Published built-in and Workspace Methods, Skills, and scoped read-only Tools declared for the Project.",
    skills: [...new Map(methodSet.methods.map((method) => [
      `${method.skillId}\u0000${method.semanticVersion}`,
      {
        id: method.skillId,
        revision: method.semanticVersion,
        availability: "declared-available" as const,
      },
    ])).values()],
    methods: declaredMethods,
    tools: ADDITIONAL_AI_INSIGHTS_SCOPED_READ_ONLY_TOOLS_V1.map((id) => ({
      id,
      availability: "declared-available" as const,
    })),
  };
  const governance = {
    status: input.governanceUnavailableDetail ? "unavailable" as const : "available" as const,
    detail: input.governanceUnavailableDetail
      ?? "Project Method Proposals and their explicit review lifecycle.",
    proposals: (input.proposals ?? []).map((proposal) => ({
      id: proposal.id,
      title: proposal.title,
      lifecycle: proposal.status,
      revision: proposal.revision,
      visibility: "project" as const,
      projectId: proposal.projectId,
      findingId: proposal.findingId,
      sourceArtifactId: proposal.artifactId,
    })),
  };
  const readModel = input.readModel;
  const additional = readModel?.additional;
  if (!readModel || !additional || (additional.status !== "available" && additional.status !== "empty")) {
    const unavailableArtifactId = additional && "artifactId" in additional
      ? additional.artifactId
      : undefined;
    return {
      status: "available",
      detail: "Declared Skills, Methods, and Tools are available; no current Additional Insight trace is available.",
      declared,
      governance,
      currentArtifact: unavailableArtifactId
        ? unavailableArtifact(unavailableArtifactId, "The current Additional Insight trace is unavailable.")
        : null,
    };
  }
  return {
    status: "available",
    detail: "Declared capabilities and the exact saved Additional Insight trace are available.",
    declared,
    governance,
    currentArtifact: safelyTraceArtifact(additional.artifactId, additional.result, readModel),
  };
};

export const unavailableProjectAiExplainabilityState = (
  detail: string,
): ProjectAiExplainabilityState => ({
  status: "unavailable",
  detail,
  declared: { status: "unavailable", detail, skills: [], methods: [], tools: [] },
  governance: { status: "unavailable", detail, proposals: [] },
  currentArtifact: null,
});

const traceArtifact = (
  artifactId: string,
  artifact: AdditionalAiInsightsArtifact,
  readModel: PreschoolOverviewAiReadModel,
): ProjectAiCurrentArtifactTrace => {
  if (!sameBinding(artifact, readModel)
    || artifact.methodExecution.loadedMethods.some((method) => (
      !insightMethodRevisionRefIsValid(method) || method.workspaceId !== readModel.binding.workspaceId
    ))) {
    return unavailableArtifact(
      artifactId,
      "The saved Artifact failed exact Workspace, Project, Snapshot, Release, period, model, or Method identity validation.",
    );
  }
  const loadedMethods = artifact.methodExecution.loadedMethods.map((method) => methodTrace(method, "actually-loaded"));
  const successfulAudits = new Map(artifact.toolAudits
    .filter((audit) => audit.status === "succeeded")
    .map((audit) => [audit.auditId, audit]));
  return {
    status: "available",
    artifactId,
    readOnly: true,
    historical: false,
    detail: artifact.status === "empty"
      ? "The exact current Artifact completed with no publishable new Finding."
      : "This is an immutable trace of the exact current saved Artifact.",
    technical: {
      runId: artifact.runId,
      outputContractRevision: artifact.contract.revision,
      methodSetId: artifact.methodExecution.methodSetId,
      methodSetRevision: artifact.methodExecution.methodSetRevision,
      methodSetFingerprint: artifact.methodExecution.methodSetFingerprint,
      capabilityRevision: artifact.capability.revision,
    },
    loadedMethods,
    findings: artifact.findings.map((finding) => {
      const presentation = splitFindingPresentation(finding.text);
      const originValid = autonomousInsightOriginIsValid({
        origin: finding.origin,
        approvedMethods: artifact.methodExecution.loadedMethods,
        loadedMethods: artifact.methodExecution.loadedMethods,
      });
      if (!presentation || !originValid) {
        return {
          id: finding.id,
          title: finding.title,
          status: "unavailable" as const,
          detail: "This Finding's presentation or Method attribution failed validation; sibling traces remain available.",
        };
      }
      return {
        id: finding.id,
        title: finding.title,
        status: "available" as const,
        detail: "Exact Finding attribution and successful Tool audits from the saved Artifact.",
        evidenceSignal: presentation.evidenceSignal,
        aiAngle: presentation.aiAngle,
        origin: finding.origin.kind,
        ...(finding.origin.kind === "hybrid" ? { novelContribution: finding.origin.novelContribution } : {}),
        evidenceRefs: [...finding.evidenceRefs],
        attributedMethods: [finding.origin.coreMethod, ...finding.origin.directionMethods]
          .map((method) => methodTrace(method, "finding-attributed")),
        successfulTools: finding.toolAuditIds.flatMap((auditId) => {
          const audit = successfulAudits.get(auditId);
          return audit
            ? [{
                auditId: audit.auditId,
                toolName: audit.toolName,
                evidenceRefs: [...audit.evidenceRefs],
                usage: "tool-succeeded" as const,
              }]
            : [];
        }),
      };
    }),
  };
};

const safelyTraceArtifact = (
  artifactId: string,
  artifact: AdditionalAiInsightsArtifact,
  readModel: PreschoolOverviewAiReadModel,
): ProjectAiCurrentArtifactTrace => {
  try {
    return traceArtifact(artifactId, artifact, readModel);
  } catch {
    return unavailableArtifact(
      artifactId,
      "The saved Additional Insight trace is locally unavailable; sibling readiness and declared capabilities remain visible.",
    );
  }
};

const unavailableArtifact = (artifactId: string, detail: string): ProjectAiCurrentArtifactTrace => ({
  status: "unavailable",
  artifactId,
  readOnly: true,
  historical: false,
  detail,
});

const methodTrace = (
  method: InsightMethodRevisionRef,
  usage: ProjectAiMethodTrace["usage"],
): ProjectAiMethodTrace => ({
  skillId: method.skillId,
  semanticVersion: method.semanticVersion,
  resourceId: method.resourceId,
  resourceRevision: method.resourceRevision,
  scope: method.scope,
  role: method.role,
  usage,
  technical: {
    contentSha256: method.contentSha256,
    workspaceId: method.workspaceId,
    ownerId: method.userId,
  },
});

const splitFindingPresentation = (text: string): { evidenceSignal: string; aiAngle: string } | null => {
  const match = /^\*\*Evidence signal:\*\*\s+([^\r\n]+)\r?\n\r?\n\*\*AI angle:\*\*\s+([^\r\n]+)$/u.exec(text.trim());
  const evidenceSignal = match?.[1]?.trim();
  const aiAngle = match?.[2]?.trim();
  return evidenceSignal && aiAngle ? { evidenceSignal, aiAngle } : null;
};

const sameBinding = (
  artifact: AdditionalAiInsightsArtifact,
  readModel: PreschoolOverviewAiReadModel,
): boolean => artifact.binding.workspaceId === readModel.binding.workspaceId
  && artifact.binding.projectId === readModel.binding.projectId
  && artifact.binding.scopeId === readModel.binding.scopeId
  && artifact.binding.dataSnapshotId === readModel.binding.dataSnapshotId
  && artifact.binding.projectReleaseId === readModel.binding.projectReleaseId
  && artifact.binding.analysisPeriod.from === readModel.binding.analysisPeriod.from
  && artifact.binding.analysisPeriod.to === readModel.binding.analysisPeriod.to
  && artifact.binding.modelProfileId === readModel.binding.modelProfileId
  && artifact.binding.modelProfileRevision === readModel.binding.modelProfileRevision;
