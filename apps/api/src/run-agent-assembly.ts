import { MastraAgent } from "@ag-ui/mastra";
import type { RunAgentInput } from "@ag-ui/client";
import type { PublicStructuredOutputOptions } from "@mastra/core/agent";
import type { ArtifactService, SessionOutputService } from "@datafoundry/artifacts";
import {
  createDataFoundry,
  createDataFoundryRunContext,
  type AgentRunContext,
  type AgentContextItem,
  type AgUiEventEmitter,
  type AnalysisContractGrounder,
  type AnalysisContextEvidenceCatalog,
  type ContextPackage,
  type ContextPackageRecorder,
  type ModelRequestSnapshotRecorder,
  type GoalRuntimeAdapter,
  type RunProtocolBoundary,
  type ContextPackageRef,
  type ProtocolStateStore,
  type TaskStateRuntime,
  type TrustedEnergyTextQueryContract,
  type CreateDataFoundryInput,
  type WorkspaceAttachment
} from "@datafoundry/agent-runtime";
import type { DataGateway } from "@datafoundry/data-gateway";
import type { FileAssetService } from "@datafoundry/files";
import type { KnowledgeService } from "@datafoundry/knowledge";
import type { LongTermMemoryRecord } from "@datafoundry/metadata";
import type {
  LoadedSkillInstruction,
  MaterializedSkill,
  SkillRecord,
  SkillSelectionResult,
} from "@datafoundry/skills";

import type { InteractionResume } from "./interaction-runtime-adapter.js";
import { createPolicyMcpTools } from "./policy-mcp-tools.js";
import type { McpRuntime, ResolvedRunConfig } from "./run-config-resolver.js";
import type { EffectiveRunConfig } from "./run-input.js";
import type { EnergyQueryContext } from "./energy/energy-query-context.js";

export type RunAgentAssembly = {
  destroyWorkspace(): Promise<void>;
  goalRuntime?: GoalRuntimeAdapter | undefined;
  governedMessages: RunAgentInput["messages"];
  loadedSkills: LoadedSkillInstruction[];
  materializedSkills: MaterializedSkill[];
  mastraAgent: MastraAgent;
  protocol: RunProtocolBoundary;
  flushProtocolEvents(): void;
  workspace: {
    command_execution_enabled: boolean;
    isolation: "bwrap" | "none" | "seatbelt";
  };
  /** Persistent cross-session workspace root (read-only asset area). */
  workspaceDir: string;
  /** Per-session directory (agent filesystem basePath; new files default here). */
  sessionDir: string;
};

type CreateRunAgentContextInput = {
  effectiveRunConfig: EffectiveRunConfig;
  modelProvider: ResolvedRunConfig["modelProvider"];
  reasoningModel?: boolean;
  runId: string;
  selectedDatasourceId?: string;
  sessionId: string;
  userId: string;
  userInput: string;
  workspaceId: string;
  energyQueryContext?: EnergyQueryContext | TrustedEnergyTextQueryContract;
};

type CreateRunAgentAssemblyInput = {
  additionalAiInsightSubmission?: boolean;
  analysisContractGrounder?: AnalysisContractGrounder;
  analysisRequirementsMode?: "default" | "omit";
  preferEvidenceContextBeforeDataTools?: boolean;
  overviewAiCandidateSubmission?: boolean;
  contextEvidenceCatalog?: AnalysisContextEvidenceCatalog;
  abortSignal?: AbortSignal | undefined;
  artifactService: ArtifactService;
  dataGateway: DataGateway;
  effectiveRunConfig: EffectiveRunConfig;
  emitter: AgUiEventEmitter;
  excludedToolNames?: readonly string[];
  disableTools?: boolean;
  structuredOutput?: PublicStructuredOutputOptions<Record<string, unknown>>;
  trustedStageTools?: CreateDataFoundryInput["trustedStageTools"];
  trustedStageCapability?: CreateDataFoundryInput["trustedStageCapability"];
  contextPackageRecorder?: ContextPackageRecorder;
  modelRequestSnapshotRecorder?: ModelRequestSnapshotRecorder;
  contextPackageExists(reference: ContextPackageRef): boolean;
  evidenceContextItems?: AgentContextItem[] | undefined;
  fileAssetService: FileAssetService;
  goal?: EffectiveRunConfig["goal"] | undefined;
  initialContextPackage?: ContextPackage | undefined;
  interactionResume?: InteractionResume | undefined;
  knowledgeService: KnowledgeService;
  longTermMemories: LongTermMemoryRecord[];
  mcpRuntime: McpRuntime;
  messages: RunAgentInput["messages"];
  modelContextProfile?: ResolvedRunConfig["modelContextProfile"] | undefined;
  modelProvider: ResolvedRunConfig["modelProvider"];
  protocolStateStore: ProtocolStateStore;
  modelSettings?: ResolvedRunConfig["modelSettings"] | undefined;
  runContext: AgentRunContext;
  sessionOutputService: SessionOutputService;
  selectedSkills: SkillRecord[];
  skillSelection: SkillSelectionResult;
  taskStateRuntime?: TaskStateRuntime;
  userId: string;
  workspaceId: string;
  workspaceRoot: string;
};

/** Create the canonical agent run context used by Mastra tools, projections, and metadata. */
export const createRunAgentContext = (input: CreateRunAgentContextInput): AgentRunContext =>
  createDataFoundryRunContext({
    user_id: input.userId,
    workspace_id: input.workspaceId,
    session_id: input.sessionId,
    run_id: input.runId,
    user_input: input.userInput,
    chat_mode: "copilotkit",
    ...(input.effectiveRunConfig.enabledDatasourceIds.length > 0
      ? {
          enabled_datasource_ids: input.effectiveRunConfig.enabledDatasourceIds,
          ...(input.selectedDatasourceId ? { selected_datasource_id: input.selectedDatasourceId } : {})
        }
      : {}),
    ...(input.effectiveRunConfig.activeLlmProfileId
      ? { requested_llm_profile_id: input.effectiveRunConfig.activeLlmProfileId }
      : {}),
    ...(input.effectiveRunConfig.activeSkillId ? { active_skill_id: input.effectiveRunConfig.activeSkillId } : {}),
    ...(input.effectiveRunConfig.enabledKnowledgeIds.length > 0
      ? { enabled_knowledge_ids: input.effectiveRunConfig.enabledKnowledgeIds }
      : {}),
    ...(input.effectiveRunConfig.enabledMcpServerIds.length > 0
      ? { enabled_mcp_server_ids: input.effectiveRunConfig.enabledMcpServerIds }
      : {}),
    ...(input.effectiveRunConfig.mentioned
      ? {
          mentioned: {
            db: input.effectiveRunConfig.mentioned.db,
            kb: input.effectiveRunConfig.mentioned.kb,
            mcp: input.effectiveRunConfig.mentioned.mcp,
            skill: input.effectiveRunConfig.mentioned.skill
          }
        }
      : {}),
    ...((input.effectiveRunConfig.pinnedPaths?.length ?? 0) > 0
      ? { pinned_paths: input.effectiveRunConfig.pinnedPaths }
      : {}),
    ...(input.effectiveRunConfig.evidenceRefs.length > 0
      ? { evidence_refs: input.effectiveRunConfig.evidenceRefs }
      : {}),
    model_name: input.modelProvider.model_name,
    ...(input.reasoningModel !== undefined
      ? { reasoning_model: input.reasoningModel }
      : {}),
    ...(input.energyQueryContext
      ? { energy_query_context: input.energyQueryContext }
      : {})
  });

/** Assemble the Mastra-backed AG-UI agent and its run-scoped execution metadata. */
export const createRunAgentAssembly = async (
  input: CreateRunAgentAssemblyInput
): Promise<RunAgentAssembly> => {
  const mcpTools = createPolicyMcpTools(input.mcpRuntime.servers);
  const {
    agent,
    commandExecutionEnabled,
    destroyWorkspace,
    goalRuntime,
    governedMessages,
    loadedSkills,
    materializedSkills,
    flushProtocolEvents,
    isolation,
    protocol,
    workspaceDir,
    sessionDir
  } = await createDataFoundry({
    ...(input.additionalAiInsightSubmission
      ? { additionalAiInsightSubmission: true }
      : {}),
    ...(input.analysisContractGrounder
      ? { analysisContractGrounder: input.analysisContractGrounder }
      : {}),
    ...(input.analysisRequirementsMode ? { analysisRequirementsMode: input.analysisRequirementsMode } : {}),
    ...(input.preferEvidenceContextBeforeDataTools
      ? { preferEvidenceContextBeforeDataTools: true }
      : {}),
    ...(input.overviewAiCandidateSubmission
      ? { overviewAiCandidateSubmission: true }
      : {}),
    ...(input.contextEvidenceCatalog
      ? { contextEvidenceCatalog: input.contextEvidenceCatalog }
      : {}),
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    artifactService: input.artifactService,
    ...(input.contextPackageRecorder ? { contextPackageRecorder: input.contextPackageRecorder } : {}),
    ...(input.modelRequestSnapshotRecorder
      ? { modelRequestSnapshotRecorder: input.modelRequestSnapshotRecorder }
      : {}),
    contextPackageExists: input.contextPackageExists,
    dataGateway: input.dataGateway,
    fileAssetService: input.fileAssetService,
    ...(input.initialContextPackage ? { initialContextPackage: input.initialContextPackage } : {}),
    knowledgeService: input.knowledgeService,
    ...(input.mcpRuntime.toolNames.length > 0 ? { mcpToolNames: input.mcpRuntime.toolNames } : {}),
    ...(Object.keys(mcpTools).length > 0 ? { mcpTools } : {}),
    emitter: input.emitter,
    ...(input.excludedToolNames?.length ? { excludedToolNames: input.excludedToolNames } : {}),
    ...(input.disableTools ? { disableTools: true } : {}),
    ...(input.structuredOutput ? { structuredOutput: input.structuredOutput } : {}),
    ...(input.trustedStageTools ? { trustedStageTools: input.trustedStageTools } : {}),
    ...(input.trustedStageCapability
      ? { trustedStageCapability: input.trustedStageCapability }
      : {}),
    ...(input.effectiveRunConfig.protocol ? { explicitProtocol: input.effectiveRunConfig.protocol } : {}),
    messages: input.messages,
    ...(input.modelContextProfile ? { modelContextProfile: input.modelContextProfile } : {}),
    modelProvider: input.modelProvider,
    protocolStateStore: input.protocolStateStore,
    ...(input.effectiveRunConfig.resourceRevisions
      ? { resourceRevisions: input.effectiveRunConfig.resourceRevisions }
      : {}),
    ...(input.modelSettings ? { modelSettings: input.modelSettings } : {}),
    ...(input.evidenceContextItems?.length ? { evidenceContextItems: input.evidenceContextItems } : {}),
    ...(input.longTermMemories.length > 0 ? { longTermMemory: { records: input.longTermMemories } } : {}),
    runContext: input.runContext,
    sessionOutputService: input.sessionOutputService,
    selectedSkills: input.selectedSkills,
    skillSelection: input.skillSelection,
    ...(input.taskStateRuntime ? { taskStateRuntime: input.taskStateRuntime } : {}),
    ...(!input.interactionResume && input.goal ? { goal: input.goal } : {}),
    ...(input.effectiveRunConfig.fileIds.length > 0
      ? { workspaceAttachments: resolveWorkspaceAttachments(input) }
      : {}),
    workspaceRoot: input.workspaceRoot
  });
  const mastraAgent = new MastraAgent({
    agent,
    resourceId: input.userId
  });

  return {
    destroyWorkspace,
    flushProtocolEvents,
    ...(goalRuntime ? { goalRuntime } : {}),
    governedMessages,
    loadedSkills,
    materializedSkills,
    mastraAgent,
    protocol,
    workspace: {
      command_execution_enabled: commandExecutionEnabled,
      isolation
    },
    workspaceDir,
    sessionDir
  };
};

const resolveWorkspaceAttachments = (input: CreateRunAgentAssemblyInput): WorkspaceAttachment[] =>
  input.effectiveRunConfig.fileIds.map((fileId) => {
    const resolved = input.fileAssetService.getRef({
      user_id: input.userId,
      workspace_id: input.workspaceId,
      id: fileId
    });
    return {
      file_id: resolved.ref.id,
      filename: resolved.ref.filename,
      ...(resolved.ref.declared_mime_type ?? resolved.asset.detected_mime_type
        ? { mime_type: resolved.ref.declared_mime_type ?? resolved.asset.detected_mime_type }
        : {}),
      size_bytes: resolved.asset.size_bytes,
      source_path: resolved.asset.storage_path
    };
  });
