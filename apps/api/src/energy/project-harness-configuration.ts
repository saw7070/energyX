import {
  STATIC_AGENT_TOOL_NAMES,
} from "@datafoundry/agent-runtime";
import {
  ADDITIONAL_AI_INSIGHTS_SCOPED_READ_ONLY_TOOLS_V1,
  resolveCurrentAdditionalAiInsightMethodSet,
} from "@datafoundry/contracts";
import type {
  ConfigResourceRecord,
  EnergyIqReportTimePolicyRevisionRecord,
  MetadataStore,
  UserRecord,
} from "@datafoundry/metadata";
import { WORKSPACE_DEFAULT_MODEL_PROFILE_ID } from "@datafoundry/metadata";
import { configResourceToSkillRecord } from "@datafoundry/skills";

import {
  ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID,
  resolveModelProfileChain,
} from "../workspace-model-profile-resolver.js";
import { resolveConfiguredModelContextProfile } from "../run-config-resolver.js";
import {
  resolveProjectOverviewProfile,
  type ProjectRendererKey,
} from "./project-analysis-resolver.js";
import {
  createNgeeAnnAdditionalAiInsightArtifactIdentity,
  createNgeeAnnOverviewAiExecutiveArtifactIdentity,
  createNgeeAnnOverviewAiSectionArtifactIdentity,
  createOverviewAiArtifactIdentity,
  createPreschoolAdditionalAiInsightArtifactIdentity,
  createPreschoolOverviewAiExecutiveArtifactIdentityV4,
  createPreschoolOverviewAiSectionArtifactIdentityV4,
} from "./overview-ai-artifact.js";

export type HarnessResourceAvailability = "configured" | "unavailable";

export type ProjectHarnessConfigurationState = {
  status: "available" | "partially-unavailable";
  detail: string;
  project: {
    id: string;
    name: string;
    workspaceId: string;
    rendererKey: ProjectRendererKey | null;
  };
  resources: {
    models: HarnessModelSummary[];
    skills: HarnessSkillSummary[];
    methods: HarnessMethodSummary[];
    tools: HarnessToolSummary[];
    mcpServers: HarnessMcpServerSummary[];
  };
  managedOverview: HarnessManagedOverviewSummary;
  harnesses: HarnessSummary[];
  unavailable: Array<{ id: string; detail: string }>;
};

export type HarnessManagedOverviewSummary = {
  status: "available" | "partially-unavailable" | "unavailable";
  source: "overview-definition" | "legacy-profile" | "unavailable";
  rendererKey: ProjectHarnessConfigurationState["project"]["rendererKey"];
  definition: {
    status: "available" | "unavailable";
    templateRevisionId: string | null;
    contractRevision: string | null;
    fingerprint: string | null;
  };
  reportTimePolicy: {
    status: "available" | "unavailable";
    revisionId: string | null;
    policyId: string | null;
    revision: string | null;
    windows: Array<{
      id: string;
      role: string;
      label: string;
      strategy: string;
    }>;
  };
  sections: Array<{
    id: string;
    title: string;
    primaryWindowId: string;
    supportingWindowIds: string[];
  }>;
};

export type HarnessModelSummary = {
  id: string;
  name: string;
  source: "server-system-binding" | "current-admin-resource";
  status: string;
  revision: number;
  enabled: boolean;
  provider: string | null;
  modelName: string | null;
  planningContext: {
    capabilitySource: "conservative-fallback" | "explicit-profile" | "verified-model-default";
    contextWindow: number;
    maxOutputTokens: number;
    outputReserve: number;
    safetyMargin: number;
    inputBudget: number;
  };
};

export type HarnessSkillSummary = {
  id: string;
  name: string;
  description: string;
  version: string;
  revision: number;
  status: string;
  enabled: boolean;
  physicalOwner: "builtin" | "user";
  declaredScope: "builtin" | "user" | "workspace";
  scopeStatus: "verified" | "unverified";
  availability: HarnessResourceAvailability;
  allowedToolIds: string[];
  deniedToolIds: string[];
  contentSha256: string | null;
};

export type HarnessMethodSummary = {
  resourceId: string;
  resourceRevision: number;
  skillId: string;
  semanticVersion: string;
  role: "core-method" | "expert-direction";
  scope: "builtin" | "workspace";
  contentSha256: string;
  lifecycle: "published";
};

export type HarnessToolSummary = {
  id: string;
  source: "datafoundry-builtin" | "energyiq-server-owned";
  availability: "registered" | "declared-for-stage";
};

export type HarnessMcpServerSummary = {
  id: string;
  name: string;
  revision: number;
  status: string;
  enabled: boolean;
  physicalOwner: "user";
  availability: "configured";
  connection: "persisted-status";
  statusAsOf: string;
  toolManifest: {
    source: "persisted-last-test" | "not-tested";
    toolNames: string[];
  };
};

export type HarnessSummary = {
  id: "ai-analyst" | "key-findings" | "section-analysis" | "additional-insights";
  label: string;
  resolution: "run-dependent" | "fixed-stage-contract";
  status: "available" | "unavailable";
  detail: string;
  runtimeStageIds: string[];
  contract: HarnessStageContractSummary | null;
  modelIds: string[];
  skillIds: string[];
  methodResourceIds: string[];
  toolIds: string[];
  mcpServerIds: string[];
  context: {
    mode: "run-planned";
    sources: string[];
  };
  instructions: Array<{
    kind: "platform" | "workflow-stage" | "skill-method" | "output-contract";
    label: string;
    revision: string | null;
    revisionStatus: "resource-pinned" | "run-pinned" | "not-separately-versioned";
    visibility: "summary-only";
  }>;
};

export type HarnessStageContractSummary = {
  provenance: "code-owned-current";
  artifactIdentityRevision: string;
  workflowRevision: string;
  promptRevisions: string[];
  validatorRevision: string;
  outputContractRevision: string;
};

export type ProjectHarnessConfigurationReader = {
  readProjectHarnessConfiguration(projectId: string): ProjectHarnessConfigurationState;
};

export const createProjectHarnessConfigurationReader = (input: {
  metadataStore: MetadataStore;
  user: UserRecord;
  workspaceId: string;
}): ProjectHarnessConfigurationReader => ({
  readProjectHarnessConfiguration(projectId) {
    requireAdmin(input.metadataStore, input.user);
    const project = input.metadataStore.energyIq.getProject(projectId);
    if (project.workspace_id !== input.workspaceId) {
      throw new Error("ENERGYIQ_PROJECT_FORBIDDEN");
    }

    const unavailable: ProjectHarnessConfigurationState["unavailable"] = [];
    const models = readModels(input, unavailable);
    const skills = input.metadataStore.configResources.list({
      workspace_id: project.workspace_id,
      user_id: input.user.id,
      kind: "skill",
    }).map(skillSummary);
    const mcpServers = input.metadataStore.configResources.list({
      workspace_id: project.workspace_id,
      user_id: input.user.id,
      kind: "mcp-server",
    }).map(mcpServerSummary);
    const publishedMethods = safelyReadPublishedMethods(
      input.metadataStore,
      project.workspace_id,
      unavailable,
    );
    const methods = resolveCurrentAdditionalAiInsightMethodSet(
      project.workspace_id,
      publishedMethods,
    ).methods.map((method) => ({
      resourceId: method.resourceId,
      resourceRevision: method.resourceRevision,
      skillId: method.skillId,
      semanticVersion: method.semanticVersion,
      role: method.role,
      scope: method.scope as "builtin" | "workspace",
      contentSha256: method.contentSha256,
      lifecycle: "published" as const,
    }));
    let profile: ReturnType<typeof resolveProjectOverviewProfile> = null;
    try {
      profile = resolveProjectOverviewProfile(input.metadataStore, project.id);
    } catch {
      // Configuration remains locally readable through the exact published
      // Definition even when one of its pinned dependencies is unavailable.
      unavailable.push({
        id: "overview-runtime-profile",
        detail: "The exact Project Overview runtime profile could not be resolved from its pinned dependencies.",
      });
    }
    const managedOverview = readManagedOverview(
      input.metadataStore,
      project.id,
      profile?.source ?? null,
      unavailable,
    );
    const rendererKey = profile?.rendererKey ?? managedOverview.rendererKey;
    if (
      !profile
      && (rendererKey === "ngee-ann-overview" || rendererKey === "preschool-overview")
      && !unavailable.some(({ id }) => id === "overview-runtime-profile")
    ) {
      unavailable.push({
        id: "overview-runtime-profile",
        detail: "The exact Project Overview runtime profile is unavailable.",
      });
    }
    const systemModelIds = models
      .filter(({ source, enabled, status }) => source === "server-system-binding" && enabled && status === "connected")
      .map(({ id }) => id);
    const analystModelIds = models
      .filter(({ source, enabled, status }) => source === "current-admin-resource" && enabled && status === "connected")
      .map(({ id }) => id);
    const eligibleSkillIds = skills
      .filter(({ availability, enabled }) => availability === "configured" && enabled)
      .map(({ id }) => id);
    const configuredMcpIds = mcpServers.filter(({ enabled }) => enabled).map(({ id }) => id);
    const tools: HarnessToolSummary[] = [
      ...STATIC_AGENT_TOOL_NAMES.map((id) => ({
        id,
        source: "datafoundry-builtin" as const,
        availability: "registered" as const,
      })),
      ...ADDITIONAL_AI_INSIGHTS_SCOPED_READ_ONLY_TOOLS_V1.map((id) => ({
        id,
        source: "energyiq-server-owned" as const,
        availability: "declared-for-stage" as const,
      })),
    ];

    const harnesses: HarnessSummary[] = [
      analystHarness(analystModelIds, eligibleSkillIds, configuredMcpIds),
      ...overviewHarnesses(
        rendererKey,
        systemModelIds,
        methods.map(({ resourceId }) => resourceId),
        profile !== null,
      ),
    ];
    const hasUnavailable = unavailable.length > 0
      || skills.some(({ availability }) => availability === "unavailable")
      || harnesses.some(({ status }) => status === "unavailable");
    return {
      status: hasUnavailable ? "partially-unavailable" : "available",
      detail: hasUnavailable
        ? "Current Harness configuration is available with one or more locally unavailable resources."
        : "Current registered resources and Project Harness declarations are available.",
      project: {
        id: project.id,
        name: project.name,
        workspaceId: project.workspace_id,
        rendererKey,
      },
      resources: { models, skills, methods, tools, mcpServers },
      managedOverview,
      harnesses,
      unavailable,
    };
  },
});

const readManagedOverview = (
  metadataStore: MetadataStore,
  projectId: string,
  profileSource: "overview-definition" | "legacy-profile" | null,
  unavailable: ProjectHarnessConfigurationState["unavailable"],
): HarnessManagedOverviewSummary => {
  const unavailableSummary = (): HarnessManagedOverviewSummary => ({
    status: "unavailable",
    source: profileSource ?? "unavailable",
    rendererKey: null,
    definition: {
      status: "unavailable",
      templateRevisionId: null,
      contractRevision: null,
      fingerprint: null,
    },
    reportTimePolicy: {
      status: "unavailable",
      revisionId: null,
      policyId: null,
      revision: null,
      windows: [],
    },
    sections: [],
  });

  const revision = metadataStore.energyIq.templates.getLatestProjectRevision(projectId);
  if (!revision) {
    unavailable.push({
      id: "overview-definition",
      detail: "The Project has no published Overview Definition revision.",
    });
    return unavailableSummary();
  }

  let definitionRecord;
  try {
    definitionRecord = metadataStore.energyIq.overviewDefinitions.get(revision.revision_id);
  } catch {
    unavailable.push({
      id: "overview-definition",
      detail: "The published Overview Definition revision could not be verified.",
    });
    return unavailableSummary();
  }
  if (!definitionRecord) {
    unavailable.push({
      id: "overview-definition",
      detail: "The published Overview Definition is unavailable for the exact Project renderer.",
    });
    return unavailableSummary();
  }

  let policyRecord: EnergyIqReportTimePolicyRevisionRecord | null = null;
  try {
    policyRecord = metadataStore.energyIq.reportTimePolicies.get(
      projectId,
      definitionRecord.time_policy_revision_id,
    );
  } catch {
    unavailable.push({
      id: "report-time-policy",
      detail: "The Report Time Policy pinned by the Overview Definition could not be verified.",
    });
  }
  if (!policyRecord) {
    if (!unavailable.some(({ id }) => id === "report-time-policy")) {
      unavailable.push({
        id: "report-time-policy",
        detail: "The Report Time Policy pinned by the Overview Definition is unavailable.",
      });
    }
  }

  return {
    status: policyRecord ? "available" : "partially-unavailable",
    source: "overview-definition",
    rendererKey: definitionRecord.renderer_key,
    definition: {
      status: "available",
      templateRevisionId: definitionRecord.template_revision_id,
      contractRevision: definitionRecord.definition.contractRevision,
      fingerprint: definitionRecord.definition_fingerprint,
    },
    reportTimePolicy: policyRecord
      ? {
          status: "available",
          revisionId: policyRecord.revision_id,
          policyId: policyRecord.policy.policyId,
          revision: policyRecord.policy.revision,
          windows: policyRecord.policy.windows.map((window) => ({
            id: window.windowId,
            role: window.role,
            label: window.label,
            strategy: window.strategy.kind,
          })),
        }
      : {
          status: "unavailable",
          revisionId: definitionRecord.time_policy_revision_id,
          policyId: null,
          revision: null,
          windows: [],
        },
    sections: definitionRecord.definition.sections.map((section) => ({
      id: section.key,
      title: section.title,
      primaryWindowId: section.primaryWindowId,
      supportingWindowIds: [...section.supportingWindowIds],
    })),
  };
};

const readModels = (
  input: { metadataStore: MetadataStore; user: UserRecord; workspaceId: string },
  unavailable: ProjectHarnessConfigurationState["unavailable"],
): HarnessModelSummary[] => {
  const models: HarnessModelSummary[] = [];
  const systemBinding = input.metadataStore.workspaceDefaultModelProfiles.find(
    ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID,
  );
  if (!systemBinding) {
    unavailable.push({
      id: "server-system-model",
      detail: "The server-managed EnergyIQ model binding is not configured.",
    });
  } else {
    try {
      const resolved = resolveModelProfileChain({
        metadataStore: input.metadataStore,
        profileId: WORKSPACE_DEFAULT_MODEL_PROFILE_ID,
        userId: systemBinding.profile_owner_user_id,
        workspaceId: ENERGYIQ_SYSTEM_MODEL_WORKSPACE_ID,
      });
      models.push(...resolved.map(({ resource }) => modelSummary(resource, "server-system-binding")));
    } catch {
      unavailable.push({
        id: "server-system-model",
        detail: "The server-managed EnergyIQ model profile is locally unavailable.",
      });
    }
  }
  models.push(...input.metadataStore.configResources.list({
    workspace_id: input.workspaceId,
    user_id: input.user.id,
    kind: "model-profile",
  }).filter(({ id }) => !models.some((model) => model.id === id))
    .map((resource) => modelSummary(resource, "current-admin-resource")));
  return models;
};

const modelSummary = (
  resource: ConfigResourceRecord,
  source: HarnessModelSummary["source"],
): HarnessModelSummary => ({
  id: resource.id,
  name: resource.name,
  source,
  status: resource.status,
  revision: resource.revision,
  enabled: resource.default_enabled,
  provider: stringValue(resource.payload.provider) ?? null,
  modelName: stringValue(resource.payload.modelName ?? resource.payload.model) ?? null,
  planningContext: planningContext(resource),
});

const planningContext = (resource: ConfigResourceRecord): HarnessModelSummary["planningContext"] => {
  const modelName = stringValue(resource.payload.modelName ?? resource.payload.model);
  const profile = resolveConfiguredModelContextProfile(resource, modelName);
  return {
    capabilitySource: profile.capabilitySource,
    contextWindow: profile.contextWindow,
    maxOutputTokens: profile.maxOutputTokens,
    outputReserve: profile.outputReserve,
    safetyMargin: profile.safetyMargin,
    inputBudget: Math.max(profile.contextWindow - profile.outputReserve - profile.safetyMargin, 0),
  };
};

const skillSummary = (resource: ConfigResourceRecord): HarnessSkillSummary => {
  const skill = configResourceToSkillRecord(resource);
  const physicalOwner = resource.builtin ? "builtin" as const : "user" as const;
  const scopeStatus = (skill.scope === "builtin" && physicalOwner === "builtin")
    || (skill.scope === "user" && physicalOwner === "user")
    ? "verified" as const
    : "unverified" as const;
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    version: skill.version,
    revision: skill.revision,
    status: skill.status,
    enabled: skill.defaultEnabled,
    physicalOwner,
    declaredScope: skill.scope,
    scopeStatus,
    availability: skill.status === "valid" && scopeStatus === "verified" ? "configured" : "unavailable",
    allowedToolIds: [...skill.allowedTools],
    deniedToolIds: [...skill.deniedTools],
    contentSha256: stringValue(resource.payload.builtinContentSha256) ?? null,
  };
};

const mcpServerSummary = (resource: ConfigResourceRecord): HarnessMcpServerSummary => {
  const toolNames = Array.isArray(resource.payload.toolManifest)
    ? resource.payload.toolManifest.flatMap((tool) => {
        const name = isRecord(tool) ? stringValue(tool.name) : undefined;
        return name ? [name] : [];
      })
    : [];
  return {
    id: resource.id,
    name: resource.name,
    revision: resource.revision,
    status: resource.status,
    enabled: resource.default_enabled,
    physicalOwner: "user",
    availability: "configured",
    connection: "persisted-status",
    statusAsOf: resource.updated_at,
    toolManifest: {
      source: toolNames.length > 0 ? "persisted-last-test" : "not-tested",
      toolNames,
    },
  };
};

const analystHarness = (
  modelIds: string[],
  skillIds: string[],
  mcpServerIds: string[],
): HarnessSummary => ({
  id: "ai-analyst",
  label: "AI Analyst",
  resolution: "run-dependent",
  status: modelIds.length > 0 ? "available" : "unavailable",
  detail: "Current Admin resources are candidates; exact Skill, MCP, Tool, and model resolution occurs per Run.",
  runtimeStageIds: [],
  contract: null,
  modelIds,
  skillIds,
  methodResourceIds: [],
  toolIds: [...STATIC_AGENT_TOOL_NAMES],
  mcpServerIds,
  context: {
    mode: "run-planned",
    sources: ["conversation", "working-memory", "long-term-memory", "energy-context", "evidence", "knowledge", "attachments", "tool-observations"],
  },
  instructions: [unversionedPlatformInstructions()],
});

const overviewHarnesses = (
  rendererKey: ProjectRendererKey | null,
  modelIds: string[],
  methodResourceIds: string[],
  runtimeProfileAvailable: boolean,
): HarnessSummary[] => {
  if (rendererKey !== "ngee-ann-overview" && rendererKey !== "preschool-overview") return [];
  const isNgeeAnn = rendererKey === "ngee-ann-overview";
  const contracts = OVERVIEW_HARNESS_CONTRACTS[rendererKey];
  const common = {
    resolution: "fixed-stage-contract" as const,
    status: modelIds.length > 0 && runtimeProfileAvailable
      ? "available" as const
      : "unavailable" as const,
    modelIds,
    mcpServerIds: [] as string[],
    context: {
      mode: "run-planned" as const,
      sources: ["project-identity", "snapshot", "release", "analysis-period", "evidence-catalog"],
    },
  };
  return [{
    ...common,
    id: "key-findings",
    label: isNgeeAnn ? "Executive Synthesis" : "Key Findings",
    detail: isNgeeAnn
      ? "Ngee Ann server-owned synthesis over accepted Section interpretations; no external MCP is declared."
      : "Server-owned synthesis over accepted Section analysis; no external MCP is declared.",
    runtimeStageIds: ["executive-synthesis"],
    contract: contracts.keyFindings,
    skillIds: [],
    methodResourceIds: [],
    toolIds: [],
    instructions: [
      unversionedPlatformInstructions(),
      runPinnedInstruction("Key Findings workflow prompt", "workflow-stage", contracts.keyFindings.promptRevisions[0]),
    ],
  }, {
    ...common,
    id: "section-analysis",
    label: isNgeeAnn ? "Section Interpretation" : "Section Analysis",
    detail: isNgeeAnn
      ? "Ngee Ann Project adapter interprets each managed Overview Section against its exact evidence and time bindings."
      : "Project adapter resolves each Section Pack and its scoped read-only capabilities at Run time.",
    runtimeStageIds: ["section-interpreter"],
    contract: contracts.sectionAnalysis,
    skillIds: [],
    methodResourceIds: [],
    toolIds: [],
    instructions: [
      unversionedPlatformInstructions(),
      runPinnedInstruction("Section workflow prompt", "workflow-stage", contracts.sectionAnalysis.promptRevisions[0]),
    ],
  }, {
    ...common,
    id: "additional-insights",
    label: "Additional Insights",
    detail: isNgeeAnn
      ? "Ngee Ann server-owned Method set and scoped read-only Tools; external MCP is not declared for this Stage."
      : "Server-owned Method set and scoped read-only Tools; external MCP is not declared for this Stage.",
    runtimeStageIds: ["additional-insights-discovery"],
    contract: contracts.additionalInsights,
    skillIds: [],
    methodResourceIds,
    toolIds: [...ADDITIONAL_AI_INSIGHTS_SCOPED_READ_ONLY_TOOLS_V1],
    instructions: [
      unversionedPlatformInstructions(),
      runPinnedInstruction(
        "Additional Insights workflow prompt",
        "workflow-stage",
        contracts.additionalInsights.promptRevisions.join(" + "),
      ),
      ...methodResourceIds.map((resourceId) => ({
        kind: "skill-method" as const,
        label: resourceId,
        revision: resourceId,
        revisionStatus: "resource-pinned" as const,
        visibility: "summary-only" as const,
      })),
      runPinnedInstruction(
        "Additional Insights output contract",
        "output-contract",
        contracts.additionalInsights.outputContractRevision,
      ),
    ],
  }];
};

const unversionedPlatformInstructions = (): HarnessSummary["instructions"][number] => ({
  kind: "platform",
  label: "DataFoundry platform instructions",
  revision: null,
  revisionStatus: "not-separately-versioned",
  visibility: "summary-only",
});

const runPinnedInstruction = (
  label: string,
  kind: HarnessSummary["instructions"][number]["kind"] = "workflow-stage",
  revision: string | null = null,
): HarnessSummary["instructions"][number] => ({
  kind,
  label,
  revision,
  revisionStatus: "run-pinned",
  visibility: "summary-only",
});

const OVERVIEW_HARNESS_CONTRACTS: Readonly<Record<
  "ngee-ann-overview" | "preschool-overview",
  {
    keyFindings: HarnessStageContractSummary;
    sectionAnalysis: HarnessStageContractSummary;
    additionalInsights: HarnessStageContractSummary;
  }
>> = {
  "ngee-ann-overview": currentOverviewHarnessContracts("ngee-ann-overview"),
  "preschool-overview": currentOverviewHarnessContracts("preschool-overview"),
};

function currentOverviewHarnessContracts(
  rendererKey: "ngee-ann-overview" | "preschool-overview",
): {
  keyFindings: HarnessStageContractSummary;
  sectionAnalysis: HarnessStageContractSummary;
  additionalInsights: HarnessStageContractSummary;
} {
  const baseIdentity = createOverviewAiArtifactIdentity({
    workspaceId: `contract-registry:${rendererKey}`,
    projectId: `contract-registry:${rendererKey}`,
    scopeId: `contract-registry:${rendererKey}`,
    dataSnapshotId: "contract-registry",
    projectReleaseId: "contract-registry",
    analysisPeriodFrom: "2000-01-01",
    analysisPeriodTo: "2000-01-01",
    rendererKey,
    rendererVersion: "contract-registry",
    modelProfileId: "contract-registry",
    modelProfileRevision: 1,
  });
  if (rendererKey === "ngee-ann-overview") {
    return {
      keyFindings: harnessContractFromIdentity(createNgeeAnnOverviewAiExecutiveArtifactIdentity({
        baseIdentity,
        targetId: "contract-registry",
      })),
      sectionAnalysis: harnessContractFromIdentity(createNgeeAnnOverviewAiSectionArtifactIdentity({
        baseIdentity,
        targetId: "contract-registry",
      })),
      additionalInsights: harnessContractFromIdentity(createNgeeAnnAdditionalAiInsightArtifactIdentity({
        baseIdentity,
      })),
    };
  }
  return {
    keyFindings: harnessContractFromIdentity(createPreschoolOverviewAiExecutiveArtifactIdentityV4({
      baseIdentity,
      targetId: "contract-registry",
    })),
    sectionAnalysis: harnessContractFromIdentity(createPreschoolOverviewAiSectionArtifactIdentityV4({
      baseIdentity,
      targetId: "contract-registry",
    })),
    additionalInsights: harnessContractFromIdentity(createPreschoolAdditionalAiInsightArtifactIdentity({
      baseIdentity,
    })),
  };
}

function harnessContractFromIdentity(identity: {
  identityContractRevision?: string | undefined;
  workflowRevision: string;
  investigatorPromptRevision: string;
  editorPromptRevision: string;
  validatorRevision: string;
  outputContractRevision: string;
}): HarnessStageContractSummary {
  if (!identity.identityContractRevision) {
    throw new Error("ENERGYIQ_OVERVIEW_AI_STAGE_IDENTITY_REVISION_REQUIRED");
  }
  return {
    provenance: "code-owned-current",
    artifactIdentityRevision: identity.identityContractRevision,
    workflowRevision: identity.workflowRevision,
    promptRevisions: [identity.investigatorPromptRevision, identity.editorPromptRevision]
      .filter((revision) => revision !== "not-applicable-v1"),
    validatorRevision: identity.validatorRevision,
    outputContractRevision: identity.outputContractRevision,
  };
}

const safelyReadPublishedMethods = (
  metadataStore: MetadataStore,
  workspaceId: string,
  unavailable: ProjectHarnessConfigurationState["unavailable"],
) => {
  try {
    return metadataStore.energyIq.insightMethodGovernance.listPublishedWorkspaceMethodResources({ workspaceId });
  } catch {
    unavailable.push({
      id: "workspace-method-catalog",
      detail: "The Workspace Method catalog is locally unavailable; built-in Methods remain visible.",
    });
    return [];
  }
};

const requireAdmin = (metadataStore: MetadataStore, user: UserRecord): void => {
  if (metadataStore.energyIq.findUserRole(user.id)?.role !== "admin") {
    throw new Error("ENERGYIQ_ADMIN_REQUIRED");
  }
};

const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
