import { Agent, type PublicStructuredOutputOptions } from "@mastra/core/agent";
import { toStandardSchema } from "@mastra/core/schema";
import {
  askUserTool,
  submitPlanTool,
  taskCheckTool,
  taskCompleteTool,
  taskUpdateTool,
  taskWriteTool
} from "@mastra/core/harness";
import { Mastra } from "@mastra/core/mastra";
import { WorkingMemory } from "@mastra/core/processors";
import { createSkillTools, createWorkspaceTools } from "@mastra/core/workspace";
import type { Message } from "@ag-ui/core";
import type { ArtifactService, SessionOutputService } from "@datafoundry/artifacts";
import { ADDITIONAL_AI_INSIGHTS_SCOPED_READ_ONLY_TOOLS_V1 } from "@datafoundry/contracts";
import type { DataGateway } from "@datafoundry/data-gateway";
import { type FileAssetService, fileAssetRefDto, mimeTypeForFilename } from "@datafoundry/files";
import type { KnowledgeService } from "@datafoundry/knowledge";
import {
  DATA_ANALYSIS_ACTUAL_LOAD_POLICY_V1,
  loadMaterializedSkillInstructions,
  materializeSkillPackages,
  type LoadedSkillInstruction,
  type MaterializedSkill,
  type SkillRecord,
  type SkillSelectionResult
} from "@datafoundry/skills";
import { copyFileSync, linkSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import {
  createModelProvider,
  createModelProviderFromConfig,
  createModelRuntimeProviderOptions,
  type ChatProviderConfig,
  type ModelProvider
} from "@datafoundry/providers";

import { AGENT_MAX_STEPS } from "./runtime-limits.js";
import { AGENT_RUNTIME_LIMITS } from "./config/agent-runtime-limits.js";
import { SQL_MAX_SQL_CHARS } from "./context/inventory/context-limits.js";
import { createToolObservationBoundary } from "./context/tool-observation/tool-observation-boundary.js";
import {
  createMastraContextProcessorBoundary
} from "./context/protocol/mastra/mastra-context-processor-boundary.js";
import type { ContextPackageRecorder } from "./context/protocol/mastra/mastra-context-budget-processor.js";
import type { ContextPackage } from "./context/inventory/context-package.js";
import { ToolObservationDispatcher } from "./context/tool-observation/tool-observation-dispatcher.js";
import { toolObservationModelFromPackage } from "./context/tool-observation/tool-observation-projection-items.js";
import { createAgUiContextEventSink } from "./context/protocol/ag-ui/ag-ui-context-event-sink.js";
import {
  NonEmptyMessageContentCompatProcessor,
  shouldApplyNonEmptyMessageContentCompat,
} from "./provider-compat/non-empty-message-content-compat.js";
import {
  MastraModelRequestAuditProcessor,
  type ModelRequestSnapshotRecorder,
} from "./context/protocol/mastra/mastra-model-request-audit-processor.js";
export type {
  ModelRequestAuditCaptureV1,
  ModelRequestSnapshotRecorder,
  ModelRequestSnapshotReference,
} from "./context/protocol/mastra/mastra-model-request-audit-processor.js";
import {
  type TaskStateRuntime
} from "./memory/task-state-runtime.js";
import { CONVERSATION_WORKING_MEMORY_CONFIG } from "./memory/conversation-memory-bridge.js";
import { createEvidenceFocusRuntimeSource } from "./context/source/evidence-focus-context-source.js";
import {
  createContextItem,
  type ContextItem,
  type CreateContextItemInput
} from "./context/inventory/context-item.js";
import {
  createContextSourceMetadata,
  type ContextSourceMetadata
} from "./context/inventory/context-source-metadata.js";
import { GoalRuntimeAdapter, type GoalRequest } from "./memory/goal-runtime-adapter.js";
import { createDataFoundryToolRegistry, isChartRequested } from "./tools/data-tools.js";
import { GovernedToolFactory } from "./tools/governed-tool-factory.js";
import { TrustedStageToolObservationAdapter } from "./context/tool-observation/adapters/trusted-stage-tool-observation-adapter.js";
import {
  createOverviewAiCandidateSubmissionTool,
  OVERVIEW_AI_CANDIDATE_SUBMISSION_TOOL_NAME,
} from "./tools/overview-ai-candidate-submission-tool.js";
import {
  ADDITIONAL_AI_INSIGHT_SUBMISSION_TOOL_NAME,
  createAdditionalAiInsightSubmissionTool,
} from "./tools/additional-ai-insight-submission-tool.js";
import {
  maybeIngestSessionFileOutput,
  maybeIngestSessionFileToolResult
} from "./tools/session-output-ingest.js";
import {
  createRunWorkspace,
  resolveSkillCacheDir,
  resolveWorkspaceDir
} from "./tools/workspace-factory.js";
import { createMastraStreamNormalizerHooks } from "./stream/mastra-stream-hooks.js";
import { createTokenUsageCorrelationStore } from "./stream/token-usage-correlation.js";
import { wrapAgentForAgUi } from "./stream/mastra-stream-normalizer.js";
import type { AgentRunContext, AgentRunContextInput, AgUiEventEmitter } from "./types.js";
import { createCustomEvent } from "./events.js";
import { createTool, type ToolAction } from "@mastra/core/tools";

export {
  MODEL_PROVIDER_TOOL_CONTRACT_BUNDLE_REVISION,
  probeModelProviderToolContract,
  type ModelProviderToolContractProbeDiagnostic,
  type ModelProviderToolContractProbeResult
} from "./model-provider-tool-contract-probe.js";
import { z } from "zod";
import {
  createRunProtocolBoundary,
  type RunProtocolBoundary
} from "./protocol/run-protocol-boundary.js";
import type { ProtocolClassifier, ProtocolIdentity } from "./protocol/protocol-router.js";
import { createModelProtocolClassifier } from "./protocol/model-protocol-classifier.js";
import {
  createEnergyAnalysisRequirementExtractor,
  createModelAnalysisRequirementExtractor,
  type AnalysisRequirementExtractor
} from "./protocol/model-analysis-requirement-extractor.js";
import {
  createModelAnalysisContractGrounder,
  type AnalysisContractGrounder
} from "./protocol/model-analysis-contract-grounder.js";
import type {
  AnalysisQueryEvidenceBinding,
  AnalysisRequirement,
} from "./protocol/analysis-requirements.js";
import { createAnalysisRequirementsCommitTool } from "./protocol/analysis-requirements-commit-tool.js";
import type { DataAnalysisState } from "./protocol/protocols/data-analysis.js";
import type { AnalysisContextEvidenceCatalog } from "./protocol/analysis-context-evidence.js";
import { createDefaultSemanticProvider } from "./semantic/default-semantic-provider.js";
import { EnergyQuerySemanticProvider } from "./semantic/energy-query-semantic-provider.js";
import type { TrustedEnergyTextQueryContract } from "./semantic/trusted-energy-text.js";
import type { ProtocolEvent } from "./protocol/types.js";
import type { ContextPackageRef, ProtocolStateStore } from "./protocol/types.js";
import { toolErrorObservation as createToolErrorObservation } from "./errors/tool-execution-error.js";

export type { AgentRunContext, AgentRunContextInput, AgUiEventEmitter } from "./types.js";
export {
  contextEvidenceVerifiedValues,
  evidencePinsEqual,
  resolveContextEvidenceFacts,
  type AnalysisContextEvidenceCatalog,
  type AnalysisContextEvidenceFact,
  type AnalysisEvidencePins,
} from "./protocol/analysis-context-evidence.js";
export type { ContextPackage } from "./context/inventory/context-package.js";
export type { ContextPlan } from "./context/inventory/context-plan.js";
export { ModelContextProfileRegistry } from "./context/policy/model-context-profile.js";
export type { ContextPackageRecorder } from "./context/protocol/mastra/mastra-context-budget-processor.js";
export type AgentContextItem = ContextItem;
export type AgentContextSourceMetadata = ContextSourceMetadata;
export type CreateAgentContextItemInput = CreateContextItemInput;
export type AgentModelContextProfile = {
  id: string;
  capabilitySource: "conservative-fallback" | "explicit-profile" | "verified-model-default";
  contextWindow: number;
  maxOutputTokens: number;
  outputReserve: number;
  safetyMargin: number;
  messageOverhead: number;
  modelPattern: string;
  toolSchemaOverhead: number;
};
export const createAgentContextItem = createContextItem;
export const createAgentContextSourceMetadata = createContextSourceMetadata;

export const DATA_AGENT_TOOL_NAMES = [
  "inspect_schema",
  "list_data_sources",
  "preview_table",
  "run_sql_readonly"
] as const;
/** HITL tools that suspend the run; their TOOL_CALL_RESULT is emitted on interaction resume. */
const HITL_TOOL_NAMES = ["ask_user", "submit_plan"] as const;
export const STATIC_AGENT_TOOL_NAMES = [
  "ask_user",
  "edit_file",
  "execute_command",
  "file_stat",
  "grep",
  "inspect_schema",
  "list_data_sources",
  "list_files",
  "mkdir",
  "preview_table",
  "promote_workspace_file",
  "list_workspace_files",
  "read_workspace_file",
  "read_file",
  "retrieve_knowledge",
  "run_sql_readonly",
  "skill",
  "skill_read",
  "skill_search",
  "submit_plan",
  "task_check",
  "task_complete",
  "task_update",
  "task_write",
  "write_file"
] as const;
export {
  ContextTokenCounter,
  type ContextTokenCounterOptions
} from "./context/policy/context-token-counter.js";
export { createActivityDelta, createActivitySnapshot, createCustomEvent } from "./events.js";
export {
  AGENT_MEMORY_MODES,
  createAgentMemoryRuntime,
  createTaskStateRuntime,
  parseAgentMemoryMode,
  type AgentMemoryMode,
  type AgentMemoryRuntime,
  type AgentMemoryRuntimeOptions,
  type TaskStateRuntime
} from "./memory/task-state-runtime.js";
export {
  normalizeMastraFullStream,
  wrapAgentForAgUi,
  type MastraAgentForAgUiOptions,
  type MastraStreamChunk,
  type MastraStreamNormalizerHooks
} from "./stream/mastra-stream-normalizer.js";
export { createMastraStreamNormalizerHooks, tokenUsageEventFromChunk } from "./stream/mastra-stream-hooks.js";
export {
  createTokenUsageCorrelationStore,
  type TokenUsageCorrelationPayload,
} from "./stream/token-usage-correlation.js";
export {
  resolveRunWorkspaceDir,
  resolveSkillCacheDir,
  resolveSkillCacheRoot,
  resolveSessionWorkspaceDir,
  resolveWorkspaceDir,
  resolveWorkspaceRoot
} from "./tools/workspace-factory.js";
export { resolvePythonRuntime } from "./tools/python-runtime.js";
export { createDataFoundryToolRegistry, type ToolRegistry } from "./tools/data-tools.js";
export {
  ADDITIONAL_AI_INSIGHT_SUBMISSION_TOOL_NAME,
  additionalAiInsightSubmissionSchema,
  createAdditionalAiInsightSubmissionTool,
} from "./tools/additional-ai-insight-submission-tool.js";
export {
  createOverviewAiCandidateSubmissionTool,
  overviewAiCandidateSubmissionSchema,
  OVERVIEW_AI_CANDIDATE_SUBMISSION_TOOL_NAME,
} from "./tools/overview-ai-candidate-submission-tool.js";
export {
  GoalRuntimeAdapter,
  type GoalRequest,
  type GoalSnapshot
} from "./memory/goal-runtime-adapter.js";
export {
  CONVERSATION_WORKING_MEMORY_CONFIG,
  CONVERSATION_WORKING_MEMORY_TEMPLATE,
  MastraConversationMemoryBridge,
  createMastraConversationMemoryBridge,
  formatConversationProjection,
  type ConversationMemoryBridge,
  type ConversationMemoryProjection
} from "./memory/conversation-memory-bridge.js";

export type AgentLongTermMemoryRecord = {
  confidence: number;
  content_text: string;
  datasource_id?: string;
  id: string;
  kind: string;
  scope: "datasource" | "session" | "user";
  session_id?: string;
  source?: string;
  source_run_id?: string;
};

/** Server-owned instruction capability for a narrowly governed production stage. */
export type TrustedStageCapability =
  | "energyiq-additional-insight-discovery"
  | "energyiq-additional-insight-transition";

export type CreateDataFoundryInput = {
  /** Prefer supplied immutable Evidence; keep governed data tools lazy for real gaps. */
  preferEvidenceContextBeforeDataTools?: boolean;
  /**
   * Some server-owned Overview Artifact stages omit generic user-requirement
   * extraction. Their explicit protocol and scoped tool capability remain
   * separate, server-owned inputs. Defaults preserve the normal Analyst contract.
   */
  analysisRequirementsMode?: "default" | "omit";
  /** Strict, run-local Candidate submission; enabled only for the Overview Investigator Stage. */
  overviewAiCandidateSubmission?: boolean;
  /** Gross-envelope submission for Additional Insights; candidates remain locally and independently reviewed. */
  additionalAiInsightSubmission?: boolean;
  /** Server-owned stage guard; removes named tools after normal policy selection. */
  excludedToolNames?: readonly string[];
  /** Server-owned stage guard for bounded value transforms that must never invoke tools. */
  disableTools?: boolean;
  /** Native schema for bounded value stages; omitted for ordinary agentic runs. */
  structuredOutput?: PublicStructuredOutputOptions<Record<string, unknown>>;
  abortSignal?: AbortSignal | undefined;
  artifactService?: ArtifactService;
  contextPackageRecorder?: ContextPackageRecorder;
  modelRequestSnapshotRecorder?: ModelRequestSnapshotRecorder;
  contextPackageExists?(reference: ContextPackageRef): boolean;
  dataGateway: DataGateway;
  emitter: AgUiEventEmitter;
  fileAssetService?: FileAssetService;
  initialContextPackage?: ContextPackage;
  knowledgeService?: KnowledgeService;
  modelProvider: Exclude<ModelProvider, { kind: "mock" }>;
  runContext: AgentRunContext;
  mcpTools?: Record<string, ToolAction<any, any, any, any, any>>;
  /** Server-owned stage tools. Never populate from AG-UI tools, MCP configuration, or forwarded props. */
  trustedStageTools?: Record<string, ToolAction<any, any, any, any, any>>;
  /** Server-owned stage identity. Never infer from protocol, Energy context, or the presence of tools. */
  trustedStageCapability?: TrustedStageCapability;
  sessionOutputService?: SessionOutputService;
  mcpToolNames?: string[];
  selectedSkills?: SkillRecord[];
  skillSelection?: SkillSelectionResult;
  taskStateRuntime?: TaskStateRuntime;
  longTermMemory?: {
    records: AgentLongTermMemoryRecord[];
    maxChars?: number;
  };
  evidenceContextItems?: AgentContextItem[];
  messages: Message[];
  modelSettings?: {
    frequencyPenalty?: number;
    maxOutputTokens?: number;
    presencePenalty?: number;
    temperature?: number;
    topP?: number;
  };
  modelContextProfile?: AgentModelContextProfile;
  explicitProtocol?: ProtocolIdentity;
  protocolClassifier?: ProtocolClassifier;
  analysisRequirementExtractor?: AnalysisRequirementExtractor;
  analysisContractGrounder?: AnalysisContractGrounder;
  contextEvidenceCatalog?: AnalysisContextEvidenceCatalog;
  onProtocolEvent?(event: ProtocolEvent): void;
  protocolStateStore?: ProtocolStateStore;
  resourceRevisions?: Record<string, number>;
  workspaceAttachments?: WorkspaceAttachment[];
  goal?: GoalRequest;
  /**
   * 工作区根目录（调用方注入）。未提供时回落到 WORKSPACE_ROOT，再回落到系统 temp。
   * 每个 session 在该目录下按 {user_id}/{session_id} 建立隔离子目录，跨 run 保留文件。
   * 留空即按默认策略隔离，不影响 workspace 工具的可用性。
   */
  workspaceRoot?: string | undefined;
};

export type WorkspaceAttachment = {
  file_id: string;
  filename: string;
  mime_type?: string;
  size_bytes: number;
  source_path: string;
};

const sameToolNames = (actual: readonly string[], expected: readonly string[]): boolean =>
  actual.length === expected.length && expected.every((toolName) => actual.includes(toolName));

const assertTrustedStageFinalTools = (
  capability: TrustedStageCapability | undefined,
  toolNames: readonly string[],
): void => {
  const additionalDiscoveryToolNames = [
    ...ADDITIONAL_AI_INSIGHTS_SCOPED_READ_ONLY_TOOLS_V1,
    ADDITIONAL_AI_INSIGHT_SUBMISSION_TOOL_NAME,
  ];
  if (capability === "energyiq-additional-insight-discovery"
    && !sameToolNames(toolNames, ADDITIONAL_AI_INSIGHTS_SCOPED_READ_ONLY_TOOLS_V1)
    && !sameToolNames(toolNames, additionalDiscoveryToolNames)) {
    throw new Error("TRUSTED_STAGE_CAPABILITY_INVALID");
  }
  if (capability === "energyiq-additional-insight-transition" && toolNames.length > 0) {
    throw new Error("TRUSTED_STAGE_CAPABILITY_INVALID");
  }
  if (capability === undefined
    && toolNames.some((toolName) =>
      (ADDITIONAL_AI_INSIGHTS_SCOPED_READ_ONLY_TOOLS_V1 as readonly string[]).includes(toolName)
      || toolName === ADDITIONAL_AI_INSIGHT_SUBMISSION_TOOL_NAME)) {
    throw new Error("TRUSTED_STAGE_CAPABILITY_INVALID");
  }
};

export const createDataFoundry = async (
  input: CreateDataFoundryInput
): Promise<{
  agent: Agent;
  governedMessages: Message[];
  goalRuntime?: GoalRuntimeAdapter;
  commandExecutionEnabled: boolean;
  isolation: "bwrap" | "none" | "seatbelt";
  workspaceDir: string;
  sessionDir: string;
  protocol: RunProtocolBoundary;
  flushProtocolEvents(): void;
  destroyWorkspace(): Promise<void>;
  loadedSkills: LoadedSkillInstruction[];
  materializedSkills: MaterializedSkill[];
}> => {
  const energyIqRun = Boolean(input.runContext.energy_query_context);
  const trustedStageToolNames = Object.keys(input.trustedStageTools ?? {});
  const hasAdditionalInsightTool = trustedStageToolNames.some((toolName) =>
    (ADDITIONAL_AI_INSIGHTS_SCOPED_READ_ONLY_TOOLS_V1 as readonly string[]).includes(toolName));
  const hasExactAdditionalInsightToolSet = trustedStageToolNames.length
    === ADDITIONAL_AI_INSIGHTS_SCOPED_READ_ONLY_TOOLS_V1.length
    && ADDITIONAL_AI_INSIGHTS_SCOPED_READ_ONLY_TOOLS_V1.every((toolName) =>
      trustedStageToolNames.includes(toolName));
  if (input.trustedStageTools && !energyIqRun) {
    throw new Error("TRUSTED_STAGE_TOOLS_REQUIRE_ENERGYIQ_RUN");
  }
  if (hasAdditionalInsightTool
    && (input.trustedStageCapability !== "energyiq-additional-insight-discovery"
      || !hasExactAdditionalInsightToolSet)) {
    throw new Error("TRUSTED_STAGE_CAPABILITY_INVALID");
  }
  if (input.trustedStageCapability === "energyiq-additional-insight-discovery"
    && (!energyIqRun
      || !hasExactAdditionalInsightToolSet
      || input.explicitProtocol?.protocolId !== "general-task")) {
    throw new Error("TRUSTED_STAGE_CAPABILITY_INVALID");
  }
  if (input.additionalAiInsightSubmission
    && input.trustedStageCapability !== "energyiq-additional-insight-discovery") {
    throw new Error("TRUSTED_STAGE_CAPABILITY_INVALID");
  }
  if (input.trustedStageCapability === "energyiq-additional-insight-transition"
    && (input.trustedStageTools
      || input.explicitProtocol?.protocolId !== "general-task")) {
    throw new Error("TRUSTED_STAGE_CAPABILITY_INVALID");
  }
  const maxSteps = AGENT_MAX_STEPS;
  const toolObservationBoundary = createToolObservationBoundary({
    identity: {
      resourceId: input.runContext.user_id,
      sessionId: input.runContext.session_id,
      runId: input.runContext.run_id
    },
    includeKnowledge: Boolean(input.knowledgeService),
    ...(input.trustedStageTools
      ? {
          additionalAdapters: Object.keys(input.trustedStageTools)
            .map((toolName) => new TrustedStageToolObservationAdapter(toolName)),
        }
      : {}),
    ...(input.mcpToolNames?.length ? { mcpToolNames: input.mcpToolNames } : {})
  });
  const contextRunState = toolObservationBoundary.contextRunState;
  if (input.initialContextPackage) {
    contextRunState.merge(input.initialContextPackage);
  }
  input.contextPackageRecorder?.record({ contextPackage: contextRunState.package });

  const runDir = resolveWorkspaceDir({
    runContext: input.runContext,
    workspaceRoot: input.workspaceRoot
  });
  const skillCacheDir = resolveSkillCacheDir({
    runContext: input.runContext,
    workspaceRoot: input.workspaceRoot
  });
  const skillToolsExcluded = ["skill", "skill_search", "skill_read"]
    .every((name) => input.excludedToolNames?.includes(name));
  const selectedSkills = input.selectedSkills ?? [];
  const actualLoadCandidates = selectedSkills.filter((skill) => (
    skill.id === DATA_ANALYSIS_ACTUAL_LOAD_POLICY_V1.eligibleBuiltinSkillId
    && skill.builtin
    && skill.scope === "builtin"
    && skill.owner.scope === "builtin"
  ));
  if (actualLoadCandidates.length > DATA_ANALYSIS_ACTUAL_LOAD_POLICY_V1.maxLoadedSkills) {
    throw new Error("SKILL_ACTUAL_LOAD_CANDIDATE_AMBIGUOUS:data-analysis");
  }
  const materializedSkills = selectedSkills.length
    ? await materializeSkillPackages({
      fileAssetService: requireFileAssetService(input.fileAssetService),
      runDir: skillCacheDir,
      skills: selectedSkills,
      userId: input.runContext.user_id,
      workspaceId: input.runContext.workspace_id ?? "default"
    })
    : [];
  const loadedSkills = actualLoadCandidates.length
    ? loadMaterializedSkillInstructions({
        materializedSkills,
        runDir: skillCacheDir,
        selectedSkills: actualLoadCandidates,
        userId: input.runContext.user_id,
        workspaceId: input.runContext.workspace_id ?? "default",
      })
    : [];
  mkdirSync(join(skillCacheDir, "skills"), { recursive: true });
  // 绑定到本次 session 的工作区：LocalFilesystem + LocalSandbox。
  // createDataFoundry 每次 run 都调用，直接闭包捕获 runContext，不依赖下游 requestContext 注入。
  const runWorkspace = createRunWorkspace({
    runContext: input.runContext,
    skillPaths: skillToolsExcluded ? [] : ["skills"],
    workspaceRoot: input.workspaceRoot
  });
  const workspaceAttachments = materializeWorkspaceAttachments(runWorkspace.runDir, input.workspaceAttachments ?? []);
  const evidenceRuntimeSource = createEvidenceFocusRuntimeSource(input.evidenceContextItems ?? []);

  const governedMessages = normalizeIngressMessages(input.messages);

  const tokenUsageCorrelation = createTokenUsageCorrelationStore();
  const registry = createDataFoundryToolRegistry({
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    ...(input.artifactService ? { artifactService: input.artifactService } : {}),
    dataGateway: input.dataGateway,
    emitter: input.emitter,
    runContext: input.runContext,
    tokenUsageCorrelation,
  });
  const dispatcher = new ToolObservationDispatcher(toolObservationBoundary.packager, {
    modelName: input.runContext.model_name,
    resourceId: input.runContext.user_id,
    runId: input.runContext.run_id,
    sessionId: input.runContext.session_id
  });
  const onGovernedResultWithSessionOutput: typeof registry.onGovernedResult = async (governed) => {
    await registry.onGovernedResult?.(governed);
    if (!input.sessionOutputService) {
      return;
    }
    await maybeIngestSessionFileToolResult({
      toolName: governed.toolName,
      ...(governed.toolCallId ? { toolCallId: governed.toolCallId } : {}),
      ...(governed.toolInput !== undefined ? { toolInput: governed.toolInput } : {}),
      ...(governed.rawResult !== undefined ? { rawResult: governed.rawResult } : {}),
      sessionDir: runWorkspace.sessionDir,
      sessionOutputService: input.sessionOutputService,
      runContext: input.runContext,
      emitter: input.emitter
    });
  };
  const contextEventSink = createAgUiContextEventSink(input.emitter);
  const mastraContextProcessors = createMastraContextProcessorBoundary({
    dispatcher,
    eventSink: contextEventSink,
    ...(input.contextPackageRecorder ? { contextPackageRecorder: input.contextPackageRecorder } : {}),
    ...(evidenceRuntimeSource ? { additionalRuntimeSources: [evidenceRuntimeSource] } : {}),
    ...(input.longTermMemory ? { longTermMemory: input.longTermMemory } : {}),
    ...(input.modelContextProfile ? { modelContextProfile: input.modelContextProfile } : {}),
    modelName: input.runContext.model_name,
    runScope: {
      runId: input.runContext.run_id,
      sessionId: input.runContext.session_id,
      userId: input.runContext.user_id
    },
    runState: contextRunState,
    ...(input.taskStateRuntime ? { taskStateRuntime: input.taskStateRuntime } : {})
  });
  const readOnlyWorkingMemoryProcessor = input.taskStateRuntime
    ? await createReadOnlyWorkingMemoryProcessor(input.taskStateRuntime)
    : undefined;
  const nonEmptyMessageContentCompat = new NonEmptyMessageContentCompatProcessor(
    shouldApplyNonEmptyMessageContentCompat(input.modelProvider),
  );
  const modelRequestAuditProcessor = input.modelRequestSnapshotRecorder
    ? new MastraModelRequestAuditProcessor({
        eventSink: contextEventSink,
        modelName: input.runContext.model_name,
        recorder: input.modelRequestSnapshotRecorder,
        runState: contextRunState,
      })
    : undefined;
  const taskTools = input.taskStateRuntime
    ? {
        task_check: taskCheckTool,
        task_complete: taskCompleteTool,
        task_update: taskUpdateTool,
        task_write: taskWriteTool
      }
    : {};
  const collaborationTools = input.taskStateRuntime
    ? {
        ask_user: askUserTool,
        submit_plan: submitPlanTool
      }
    : {};
  const knowledgeTools = input.knowledgeService
    ? {
        retrieve_knowledge: createTool({
          id: "retrieve_knowledge",
          description: "Retrieve relevant chunks from a knowledge base enabled for this run.",
          inputSchema: z.object({
            collection_id: z.string().min(1),
            query: z.string().min(1),
            top_k: z.number().int().min(1).max(AGENT_RUNTIME_LIMITS.knowledgeMaxTopK).optional()
          }),
          execute: async (toolInput) => {
            if (!input.runContext.enabled_knowledge_ids?.includes(toolInput.collection_id)) {
              throw new Error(`KNOWLEDGE_BASE_NOT_ENABLED:${toolInput.collection_id}`);
            }
            return {
              collection_id: toolInput.collection_id,
              chunks: await input.knowledgeService?.retrieve({
                user_id: input.runContext.user_id,
                workspace_id: input.runContext.workspace_id ?? "default",
                collection_id: toolInput.collection_id,
                query: toolInput.query,
                ...(toolInput.top_k ? { top_k: toolInput.top_k } : {})
              }) ?? []
            };
          }
        })
      }
    : {};
  const fileAssetTools = input.fileAssetService
    ? createFileAssetTools({
        ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
        fileAssetService: input.fileAssetService,
        runContext: input.runContext,
        sessionDir: runWorkspace.sessionDir,
        workspaceDir: runWorkspace.runDir
      })
    : {};
  // Workspace file tools (write_file / edit_file / execute_command, etc.) produce
  // session-scoped files. Eligible write/edit outputs are auto-ingested into Session
  // Outputs from governed tool results (and workspace.metadata when Mastra emits it);
  // drafts/scripts remain workspace-only.
  const workspaceTools = await createWorkspaceTools(runWorkspace.workspace, {
    requestContext: {},
    workspace: runWorkspace.workspace
  });
  const skillTools = runWorkspace.workspace.skills ? createSkillTools(runWorkspace.workspace.skills) : {};
  runWorkspace.workspace.setToolsConfig({ enabled: false });
  const dataToolsEnabled = (input.runContext.enabled_datasource_ids?.length ?? 0) > 0;
  const availableTools = {
    ...(dataToolsEnabled ? registry.mastraTools : {}),
    ...fileAssetTools,
    ...knowledgeTools,
    ...taskTools,
    ...collaborationTools,
    ...workspaceTools,
    ...skillTools
  };
  const mcpCapabilityCandidates = energyIqRun ? {} : (input.mcpTools ?? {});
  const selectedPolicyTools = selectToolsByPolicy(
    {
      ...availableTools,
      ...mcpCapabilityCandidates,
    },
    input.skillSelection
  );
  const harnessSelectedTools = energyIqRun
    ? Object.fromEntries(Object.entries(selectedPolicyTools).filter(([name]) =>
        name === "inspect_schema" || name === "run_sql_readonly"))
    : selectedPolicyTools;
  const selectedMcpToolNames = Object.keys(harnessSelectedTools).filter((name) =>
    Object.hasOwn(mcpCapabilityCandidates, name));
  const toolsBeforeStageExclusions = {
    ...harnessSelectedTools,
    ...(input.trustedStageTools ?? {})
  };
  const excludedToolNames = new Set(input.excludedToolNames ?? []);
  const selectedTools = input.disableTools
    ? {}
    : excludedToolNames.size === 0
      ? toolsBeforeStageExclusions
      : Object.fromEntries(Object.entries(toolsBeforeStageExclusions).filter(([name]) => !excludedToolNames.has(name)));
  const selectedDatasourceId = input.runContext.selected_datasource_id;
  const deferredProtocolEvents: ProtocolEvent[] = [];
  let protocolEventsReady = false;
  const protocol = await createRunProtocolBoundary({
    runId: input.runContext.run_id,
    userInput: input.runContext.user_input,
    authorizedProtocolIds: ["general-task", "data-analysis"],
    initialContextPackageRef: {
      packageId: contextRunState.package.packageId,
      revision: contextRunState.package.revision
    },
    tools: selectedTools,
    ...(selectedDatasourceId
      ? {
          semanticProvider: input.runContext.energy_query_context
            ? new EnergyQuerySemanticProvider(input.runContext.energy_query_context)
            : createDefaultSemanticProvider({ tools: selectedTools }),
          semanticRequest: {
            userId: input.runContext.user_id,
            workspaceId: input.runContext.workspace_id ?? "default",
            datasourceId: selectedDatasourceId,
            datasourceRevision: String(
              input.resourceRevisions?.[`datasource:${selectedDatasourceId}`] ?? "unknown"
            ),
            ...(input.runContext.energy_query_context
              && "kind" in input.runContext.energy_query_context
              && input.runContext.energy_query_context.kind === "trusted-energy-text-query"
              ? { physicalSchema: input.runContext.energy_query_context.pins.sourcePin.physicalSchema }
              : {})
          }
        }
      : {}),
    ...(input.explicitProtocol ? { explicitProtocol: input.explicitProtocol } : {}),
    classifier: input.protocolClassifier ?? createModelProtocolClassifier(input.modelProvider),
    requirementExtractor: input.analysisRequirementsMode === "omit"
      ? async () => []
      : input.analysisRequirementExtractor
        ?? (energyIqRun
          ? createEnergyAnalysisRequirementExtractor(input.contextEvidenceCatalog)
          : createModelAnalysisRequirementExtractor(input.modelProvider)),
    analysisContractGrounder: input.analysisContractGrounder
      ?? createModelAnalysisContractGrounder(input.modelProvider),
    ...(input.contextEvidenceCatalog ? { contextEvidenceCatalog: input.contextEvidenceCatalog } : {}),
    ...(input.protocolStateStore ? { stateStore: input.protocolStateStore } : {}),
    projectContext: ({ actionName, rawResult }) => {
      if (isProtocolRuntimeAction(actionName)) {
        const currentPackage = contextRunState.package;
        return {
          contextPackageRef: {
            packageId: currentPackage.packageId,
            revision: currentPackage.revision
          },
          contextPackage: currentPackage,
          observation: rawResult
        };
      }
      const contextPackage = dispatcher.dispatch(actionName, rawResult);
      const currentPackage = contextRunState.package;
      input.contextPackageRecorder?.record({ contextPackage: currentPackage });
      return {
        contextPackageRef: {
          packageId: currentPackage.packageId,
          revision: currentPackage.revision
        },
        contextPackage,
        observation: toolObservationModelFromPackage(contextPackage)
      };
    },
    runtimeOptions: {
      ...(input.contextPackageExists ? { contextPackageExists: input.contextPackageExists } : {}),
      onEvent: (event) => {
        if (!protocolEventsReady) {
          deferredProtocolEvents.push(event);
          return false;
        }
        input.onProtocolEvent?.(event);
        input.emitter.emit(createCustomEvent(event.type, event));
        return true;
      }
    }
  });
  let overviewAiSuccessfulSqlCount = 0;
  const governedToolFactory = new GovernedToolFactory(
    dispatcher,
    onGovernedResultWithSessionOutput,
    registry.onGovernanceError,
    {
      actionRouter: protocol.actionRouter,
      emitter: input.emitter,
      externallyResolvedToolNames: new Set(HITL_TOOL_NAMES),
      runId: input.runContext.run_id,
      getSegmentId: () => protocol.segmentId,
      ...(input.overviewAiCandidateSubmission
        ? {
            transformObservation: ({ observation, toolName }: { observation: unknown; toolName: string }) => {
              if (toolName !== "run_sql_readonly" || !isRecord(observation)) return observation;
              overviewAiSuccessfulSqlCount += 1;
              // Put the run-local reference first so it survives bounded/truncated tool views.
              return { evidence_index: overviewAiSuccessfulSqlCount, ...observation };
            },
          }
        : {}),
    }
  );
  const protocolState = protocol.protocolRuntime.getState(input.runContext.run_id, protocol.segmentId);
  const analysisRequirements = input.analysisRequirementsMode !== "omit" && protocolState.protocolId === "data-analysis"
    ? ((protocolState.domain as DataAnalysisState).requirements ?? []).filter((requirement) =>
        requirement.source === "user")
    : [];
  const requirementsCommitTools = analysisRequirements.length > 0
    ? {
        analysis_requirements_commit: createAnalysisRequirementsCommitTool({
          analysisRequirements,
          ...(input.contextEvidenceCatalog ? { contextEvidenceCatalog: input.contextEvidenceCatalog } : {}),
          executeAction: (action) => protocol.actionRouter.execute(action),
          getAnalysisRequirements: () => {
            const current = protocol.protocolRuntime.getState(input.runContext.run_id, protocol.segmentId);
            return current.protocolId === "data-analysis"
              ? ((current.domain as DataAnalysisState).requirements ?? []).filter((requirement) =>
                  requirement.source === "user")
              : [];
          },
          getVerifiedRequirementValues: (requirementId) => {
            const current = protocol.protocolRuntime.getState(input.runContext.run_id, protocol.segmentId);
            if (current.protocolId !== "data-analysis") return [];
            const state = current.domain as DataAnalysisState;
            const evidencedAttemptIds = new Set((state.evidenceBindings ?? []).flatMap((binding) => {
              if (binding.requirementId !== requirementId || binding.source === "context") return [];
              return [(binding as AnalysisQueryEvidenceBinding).queryAttemptId];
            }));
            return [...new Map((state.queryAttempts ?? [])
              .filter((attempt) => evidencedAttemptIds.has(attempt.id))
              .flatMap((attempt) => attempt.verifiedValues)
              .map((value) => [value.name, value])).values()];
          },
          runId: input.runContext.run_id,
          segmentId: protocol.segmentId,
          trustedEnergy: Boolean(input.runContext.energy_query_context)
        })
      }
    : {};
  const overviewAiCandidateSubmissionTools = input.overviewAiCandidateSubmission && !input.disableTools
    ? {
        [OVERVIEW_AI_CANDIDATE_SUBMISSION_TOOL_NAME]: createOverviewAiCandidateSubmissionTool(),
      }
    : {};
  const additionalAiInsightSubmissionTools = input.additionalAiInsightSubmission && !input.disableTools
    ? {
        [ADDITIONAL_AI_INSIGHT_SUBMISSION_TOOL_NAME]: createAdditionalAiInsightSubmissionTool(),
      }
    : {};
  const protocolHandoffTools = input.disableTools || excludedToolNames.has("protocol_handoff")
    ? {}
    : {
        protocol_handoff: createTool({
          id: "protocol_handoff",
          description: "Propose switching this run to another authorized protocol when the current protocol is unsuitable.",
          inputSchema: z.object({
            targetProtocolId: z.string().min(1),
            targetProtocolVersion: z.string().min(1),
            reasonCodes: z.array(z.string().min(1)).min(1),
            unresolvedGoals: z.array(z.string())
          }),
          execute: async (toolInput, options) => {
            const toolCallId = protocolToolCallId(options);
            try {
              const result = await protocol.actionRouter.execute({
                runId: input.runContext.run_id,
                segmentId: protocol.segmentId,
                actionId: toolCallId ?? `protocol-handoff:${Date.now()}`,
                actionName: "protocol.handoff.propose",
                input: toolInput,
                idempotencyKey: toolCallId ?? JSON.stringify(toolInput)
              });
              return result.observation;
            } catch (error) {
              return createToolErrorObservation(error, { toolName: "protocol_handoff" });
            }
          }
        })
      };
  const stageSelectedTools = input.overviewAiCandidateSubmission
    ? describeOverviewAiSqlEvidenceIndexes(selectedTools)
    : selectedTools;
  const governedSelectedTools = governedToolFactory.governTools(stageSelectedTools);
  const tools = {
    ...governedSelectedTools,
    ...requirementsCommitTools,
    ...overviewAiCandidateSubmissionTools,
    ...additionalAiInsightSubmissionTools,
    ...protocolHandoffTools,
  };
  assertTrustedStageFinalTools(input.trustedStageCapability, Object.keys(tools));
  const runtimeProviderOptions = createModelRuntimeProviderOptions({
    providerId: input.modelProvider.provider_id,
    ...(input.modelProvider.provider_ids ? { providerIds: input.modelProvider.provider_ids } : {}),
    ...(input.runContext.reasoning_model !== undefined
      ? { reasoningEnabled: input.runContext.reasoning_model }
      : {})
  });
  const agentConfig = {
    id: "data-foundry",
    name: "DataFoundry",
    instructions: buildAgentInstructions({
      runContext: input.runContext,
      commandExecutionEnabled: runWorkspace.commandExecutionEnabled,
      collaborationToolsEnabled: Boolean(input.taskStateRuntime),
      pythonRuntimeAvailable: Boolean(runWorkspace.pythonRuntime),
      loadedSkills,
      selectedSkills: input.selectedSkills ?? [],
      taskToolsEnabled: Boolean(input.taskStateRuntime),
      toolNames: [
        ...Object.keys(selectedTools),
        ...Object.keys(requirementsCommitTools),
        ...Object.keys(overviewAiCandidateSubmissionTools),
        ...Object.keys(additionalAiInsightSubmissionTools),
        ...Object.keys(protocolHandoffTools),
      ],
      preferEvidenceContextBeforeDataTools: input.preferEvidenceContextBeforeDataTools === true,
      mcpToolNames: selectedMcpToolNames,
      trustedStageToolNames: Object.keys(input.trustedStageTools ?? {}),
      ...(input.trustedStageCapability
        ? { trustedStageCapability: input.trustedStageCapability }
        : {}),
      protocolId: protocolState.protocolId,
      analysisRequirements,
      workspaceAttachments
    }),
    model: input.modelProvider.model as never,
    tools,
    ...(input.taskStateRuntime ? { memory: input.taskStateRuntime.memory } : {}),
    ...(input.goal ? { goal: { judge: input.modelProvider.model as never, maxRuns: input.goal.maxRuns ?? 10 } } : {}),
    // Workspace remains attached for execution context, while auto-injection is disabled above.
    // Explicitly created tools are wrapped by the same governed execution boundary as every other tool.
    workspace: runWorkspace.workspace,
    inputProcessors: [
      ...(readOnlyWorkingMemoryProcessor ? [readOnlyWorkingMemoryProcessor] : []),
      ...mastraContextProcessors.inputProcessors,
      nonEmptyMessageContentCompat,
      ...(modelRequestAuditProcessor ? [modelRequestAuditProcessor] : []),
    ],
    outputProcessors: mastraContextProcessors.outputProcessors,
  };
  const defaultOptions = {
    maxSteps,
    ...(input.modelSettings ? { modelSettings: input.modelSettings } : {}),
    ...(runtimeProviderOptions ? { providerOptions: runtimeProviderOptions } : {})
  };
  const structuredOutput = input.structuredOutput
    ? {
        ...input.structuredOutput,
        schema: toStandardSchema(input.structuredOutput.schema)
      }
    : undefined;
  // @ag-ui/mastra currently fixes its local Agent generic to TOutput=undefined.
  // The runtime object is still the same Agent; erase only that invariant type
  // parameter after Mastra has normalized the bounded structured-output schema.
  const agent = (structuredOutput
    ? new Agent<string, typeof tools, Record<string, unknown>>({
        ...agentConfig,
        defaultOptions: {
          ...defaultOptions,
          structuredOutput
        }
      })
    : new Agent({
        ...agentConfig,
        defaultOptions
      })) as unknown as Agent;
  const agentForAgUi = wrapAgentForAgUi(
    agent,
    createMastraStreamNormalizerHooks(input.emitter, input.sessionOutputService
      ? {
          onWorkspaceMetadata: (metadata) =>
            maybeIngestSessionFileOutput({
              metadata,
              emitter: input.emitter,
              runContext: input.runContext,
              sessionDir: runWorkspace.sessionDir,
              sessionOutputService: input.sessionOutputService as SessionOutputService
            })
        }
      : {}),
    { ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}) },
  );
  const mastra = input.taskStateRuntime
    ? new Mastra({
        agents: { dataFoundry: agentForAgUi },
        storage: input.taskStateRuntime.storage
      })
    : undefined;
  let goalRuntime: GoalRuntimeAdapter | undefined;
  if (input.goal && mastra) {
    goalRuntime = new GoalRuntimeAdapter(agentForAgUi, input.runContext.user_id, input.runContext.session_id);
    const snapshot = await goalRuntime.setObjective(input.goal);
    // R-016: stable goal.updated contract. `objective` is the spec key; `goal` is kept
    // as a backward-compatible alias. Mastra's "active"/"paused"/"done" maps to the
    // spec's "running"/"paused"/"done".
    const goalStatus = snapshot?.status === "active" ? "running" : snapshot?.status ?? "running";
    input.emitter.emit(createCustomEvent("goal.updated", {
      objective: snapshot?.objective ?? input.goal.objective,
      goal: snapshot?.objective ?? input.goal.objective,
      status: goalStatus,
      source: "mastra-native-goal"
    }));
  }

  return {
    agent: agentForAgUi,
    commandExecutionEnabled: runWorkspace.commandExecutionEnabled,
    destroyWorkspace: async () => {
      try {
        await protocol.dispose();
      } finally {
        await runWorkspace.destroy();
      }
    },
    governedMessages,
    ...(goalRuntime ? { goalRuntime } : {}),
    isolation: runWorkspace.isolation,
    loadedSkills,
    materializedSkills,
    protocol,
    flushProtocolEvents: () => {
      protocolEventsReady = true;
      while (deferredProtocolEvents.length > 0) {
        const event = deferredProtocolEvents.shift();
        if (!event) {
          continue;
        }
        input.onProtocolEvent?.(event);
        input.emitter.emit(createCustomEvent(event.type, event));
        protocol.acknowledgeEvent(event);
      }
    },
    workspaceDir: runWorkspace.runDir,
    sessionDir: runWorkspace.sessionDir
  };
};

export const createDataFoundryRunContext = (input: AgentRunContextInput): AgentRunContext => {
  if ((input.enabled_datasource_ids?.length ?? 0) === 0) {
    return input;
  }
  if (!input.selected_datasource_id) {
    throw new Error("DATASOURCE_REQUIRED");
  }
  if (!(input.enabled_datasource_ids ?? []).includes(input.selected_datasource_id)) {
    throw new Error("ACTIVE_DATASOURCE_NOT_ENABLED");
  }

  return input;
};

export const createModelProviderFromEnv = (env: Record<string, string | undefined>): ModelProvider =>
  createModelProvider(env);

/** Create a model provider from a resolved persisted profile. */
export const createModelProviderFromProfile = (config: ChatProviderConfig): ModelProvider =>
  createModelProviderFromConfig(config);

/** Execute a minimal real model call through the same Mastra model boundary used by production runs. */
export const probeModelProvider = async (
  provider: Exclude<ModelProvider, { kind: "mock" }>,
  timeoutMs = 30000
): Promise<{ model: string; text: string }> => {
  const agent = new Agent({
    id: "model-profile-probe",
    name: "Model Profile Probe",
    instructions: "Reply with OK only.",
    model: provider.model as never
  });
  const output = await agent.generate("Reply with OK only.", {
    abortSignal: AbortSignal.timeout(timeoutMs),
    maxSteps: 1,
    modelSettings: { maxOutputTokens: 16 }
  });
  return { model: provider.model_name, text: output.text.trim() };
};

type AgentInstructionsInput = {
  runContext: AgentRunContext;
  /** execute_command 工具是否启用（由沙箱隔离可用性与 env 决定）。 */
  commandExecutionEnabled: boolean;
  collaborationToolsEnabled: boolean;
  /** execute_command 是否已接入项目 Python venv（numpy/pandas/matplotlib/sklearn）。 */
  pythonRuntimeAvailable: boolean;
  loadedSkills: LoadedSkillInstruction[];
  selectedSkills: SkillRecord[];
  /** builtin task_* 工具是否启用（取决于是否注入 taskStateRuntime）。 */
  taskToolsEnabled: boolean;
  toolNames: string[];
  preferEvidenceContextBeforeDataTools: boolean;
  trustedStageToolNames: string[];
  trustedStageCapability?: TrustedStageCapability;
  /** MCP tools injected through AG-UI clientTools for this run. */
  mcpToolNames: string[];
  protocolId: string;
  analysisRequirements: AnalysisRequirement[];
  workspaceAttachments: MaterializedWorkspaceAttachment[];
};

type MaterializedWorkspaceAttachment = {
  file_id: string;
  filename: string;
  mime_type?: string;
  path: string;
  size_bytes: number;
};

const buildAgentInstructions = (input: AgentInstructionsInput): string => {
  const { runContext: context, collaborationToolsEnabled, commandExecutionEnabled, taskToolsEnabled } = input;
  const enabled = (name: string): boolean => input.toolNames.includes(name);
  const energyIqTrustedStageDiscovery =
    input.trustedStageCapability === "energyiq-additional-insight-discovery";
  const energyIqTrustedStageTransition =
    input.trustedStageCapability === "energyiq-additional-insight-transition";
  const additionalAiInsightSubmissionEnabled = enabled(ADDITIONAL_AI_INSIGHT_SUBMISSION_TOOL_NAME);
  const hasAnyEnabledTools = input.toolNames.length > 0 || input.mcpToolNames.length > 0;
  const promoteWorkspaceFileEnabled = enabled("promote_workspace_file");
  const dataTools = ["list_data_sources", "inspect_schema", "preview_table", "run_sql_readonly"].filter(enabled);
  const toolGroups: string[] = dataTools.length > 0 ? [`Data tools: ${dataTools.join(", ")}.`] : [];
  if (input.mcpToolNames.length > 0) {
    toolGroups.push(`MCP tools: ${input.mcpToolNames.join(", ")}.`);
  }
  if (input.trustedStageToolNames.length > 0) {
    toolGroups.push(
      `Server-scoped read-only tools: ${input.trustedStageToolNames.join(", ")}. `
      + "Their identity and Evidence boundary are server-owned; pass only each tool's declared controlled arguments.",
    );
  }
  if (additionalAiInsightSubmissionEnabled) {
    toolGroups.push(
      `Submission tool: ${ADDITIONAL_AI_INSIGHT_SUBMISSION_TOOL_NAME}. `
        + "This tool is available in addition to the server-scoped read-only tools. Call it exactly once with the final "
        + "Candidate envelope, including candidates: [] when no angle survives review.",
    );
  }
  if ((context.enabled_knowledge_ids?.length ?? 0) > 0 && enabled("retrieve_knowledge")) {
    toolGroups.push("Knowledge tools: retrieve_knowledge.");
  }
  const workspaceAssetTools = ["list_workspace_files", "read_workspace_file", "promote_workspace_file"]
    .filter(enabled);
  if (workspaceAssetTools.length > 0) {
    const sessionProducerTools = [
      ...(enabled("write_file") ? ["write_file"] : []),
      ...(enabled("execute_command") ? ["execute_command"] : [])
    ];
    const sessionProducerText = sessionProducerTools.length > 0
      ? `New files you write (${sessionProducerTools.join(" / ")}) are session-scoped — only this session sees them. `
      : "New files in the session workspace are session-scoped — only this session sees them. ";
    toolGroups.push(
      `Workspace asset tools: ${workspaceAssetTools.join(", ")}. `
      + sessionProducerText
      + "list_workspace_files / read_workspace_file read the cross-session workspace root (shared across your "
      + "sessions, read-only). "
      + (promoteWorkspaceFileEnabled
        ? "promote_workspace_file copies a session file into that cross-session root."
        : "Use only the available workspace asset tools listed above.")
    );
  }
  const workspaceTools = [
    "read_file",
    "write_file",
    "edit_file",
    "list_files",
    "file_stat",
    "mkdir",
    "grep",
    ...(commandExecutionEnabled ? ["execute_command"] : [])
  ].filter(enabled);
  if (workspaceTools.length > 0) {
    toolGroups.push(`Workspace tools (session-isolated directory): ${workspaceTools.join(", ")}. `
      + "Files you write stay within this session's workspace and can be reused by later runs in the same session. "
      + (enabled("execute_command")
          ? (input.pythonRuntimeAvailable
          ? "execute_command runs in a sandbox without network access. Use `python3.12 script.py` for local analysis; "
            + "numpy, pandas, matplotlib, and scikit-learn are available from the project venv. "
            + "Write scripts with write_file first, "
            + "save charts with plt.savefig(), and persist outputs as workspace files. "
            + "Do not use execute_command for external services or direct database access."
          : "execute_command runs in a sandbox without network access. Use it only for local transforms, charts, "
            + "or exports; never use it to access external services.")
        : "Command execution is disabled this run; rely on the available data and file tools only."));
  }
  if (input.workspaceAttachments.length > 0) {
    toolGroups.push(`Uploaded workspace input files: ${input.workspaceAttachments
      .map((file) =>
        `${file.path} (file_id=${file.file_id}, mime=${file.mime_type ?? "unknown"}, size=${file.size_bytes})`
      )
      .join("; ")}.`);
  }
  // R-019: per-run @ mentions — focus signal, not a narrowing. The agent is told which
  // resources the user explicitly highlighted this run so it can prioritize them while
  // the rest of the enabled set stays available.
  const mentioned = context.mentioned;
  if (mentioned) {
    const focusParts: string[] = [];
    if (mentioned.db.length > 0) {
      focusParts.push(`datasources ${mentioned.db.join(", ")}`);
    }
    if (mentioned.kb.length > 0) {
      focusParts.push(`knowledge bases ${mentioned.kb.join(", ")}`);
    }
    if (mentioned.mcp.length > 0) {
      focusParts.push(`MCP servers ${mentioned.mcp.join(", ")}`);
    }
    if (mentioned.skill.length > 0) {
      focusParts.push(`skills ${mentioned.skill.join(", ")}`);
    }
    if (focusParts.length > 0) {
      toolGroups.push(
        `User focus this run (via @ mentions): ${focusParts.join("; ")}. Prioritize these resources in your analysis `
          + "and tool selection; other enabled resources remain available but should take lower priority."
      );
    }
  }
  // R-024: pinned session-relative workspace files the user wants the agent to read/reference.
  const pinnedPaths = context.pinned_paths;
  if (pinnedPaths && pinnedPaths.length > 0) {
    toolGroups.push(
      `Pinned workspace files to read/reference this run: ${pinnedPaths.join(", ")}. These already exist in the `
        + "session workspace — read them with read_file; do not re-create or copy them into input/."
    );
  }
  const evidenceRefs = context.evidence_refs;
  if (evidenceRefs && evidenceRefs.length > 0) {
    const labels = evidenceRefs
      .map((ref) => {
        const selection = ref.source.selection;
        if (!selection) return `${ref.kind}:${ref.label}`;
        if (selection.mode === "text") return `${ref.kind}:${ref.label} (text selection)`;
        return `${ref.kind}:${ref.label} (${selection.mode} selection)`;
      })
      .slice(0, 12)
      .join("; ");
    toolGroups.push(
      `User-selected evidence focus this run: ${labels}. Selected evidence content (including any table/text `
        + "subsets) is already provided in context — prefer that over opening the full artifact file. "
        + "Treat these references as the primary context for the follow-up question. You may run new data "
        + "tools when needed; make new queries and outputs visible in steps."
    );
  }
  const taskTools = ["task_write", "task_update", "task_complete", "task_check"].filter(enabled);
  if (taskToolsEnabled && taskTools.length > 0) {
    toolGroups.push(`Task tools: ${taskTools.join(", ")}.`);
  }
  const collaborationTools = ["ask_user", "submit_plan"].filter(enabled);
  if (collaborationToolsEnabled && collaborationTools.length > 0) {
    toolGroups.push(`Collaboration tools: ${collaborationTools.join(", ")}.`);
  }
  const skillTools = ["skill", "skill_search", "skill_read"].filter(enabled);
  if (skillTools.length > 0) {
    toolGroups.push(`Skill tools: ${skillTools.join(", ")}.`);
  }

  const policies: string[] = [];
  if (energyIqTrustedStageTransition) {
    policies.push(
      "EnergyIQ server-scoped transition path: compare only the server-provided exact A and B Artifact and Evidence "
        + "lineage. Do not request tools, SQL, network access, writes, or outside context. A no-material-change "
        + "result is valid, and the structured output remains authoritative.",
    );
  } else if (context.energy_query_context) {
    const energyContext = context.energy_query_context;
    if (isTrustedEnergyTextQueryContract(energyContext)) {
      policies.push(
        "EnergyIQ trusted Snapshot path: the server has already compiled immutable Project, Scope, half-open Period, "
          + "timezone, released Metric, Data Snapshot, Data as of, expected facts, and Evidence pins. Use only the "
          + "structured expected facts in the authoritative ProjectAnalysisSnapshot context. Do not rediscover or "
          + "replace them with SQL, files, memory, another datasource, or model inference. Never reveal the internal "
          + "datasource, schema, model profile, provider configuration, or credentials. The answer must state Scope, "
          + "Period with exclusive end and timezone, Metric, Data as of, and Evidence. If a required expected fact is "
          + "absent, report it as unavailable; never invent, extrapolate, or substitute a nearby Metric."
      );
    } else if (energyIqTrustedStageDiscovery) {
      policies.push(
        "EnergyIQ server-scoped discovery path: use only the listed server-scoped read-only tools and the "
          + "server-provided Evidence context. Explore Evidence-backed angles openly; zero candidates is valid. "
          + "Do not request SQL, arbitrary queries, network access, writes, or tools outside this run's allowlist. "
          + (additionalAiInsightSubmissionEnabled
            ? "The native submission and downstream server acceptance remain authoritative."
            : "The structured output and downstream server acceptance remain authoritative."),
      );
    } else if (
      input.analysisRequirements.length > 0
      && input.analysisRequirements.every((requirement) => requirement.contextEvidence?.mode === "sufficient")
    ) {
      policies.push(
        "EnergyIQ immutable package answer path: the server has already selected sufficient facts from the exact "
          + "current-Snapshot Analysis Context Package for this question. Bind those Context Evidence facts and commit "
          + "the reported claim once; do not request or simulate Schema, SQL, protocol handoff, files, network access, "
          + "or outside facts. Answer the user's question normally and concisely from the authorized values and Evidence "
          + "references. This is not the Overview selection-only JSON path. If the selected facts cannot support the "
          + "answer, state what is unavailable instead of inferring it."
      );
    } else if (!enabled("inspect_schema") || !enabled("run_sql_readonly")) {
      policies.push(
        "EnergyIQ selection-only path: "
          + (input.toolNames.length === 0
            ? "No tools are enabled for this run. "
            : "The governed Schema-and-SQL tool pair is not enabled for this run. ")
          + "Select zero to three concise Findings only from the server-provided Candidate selection views and compact "
          + "Coverage. Do not call, request, or simulate inspect_schema, run_sql_readonly, protocol_handoff, or any "
          + "other tool. Do not independently investigate, recalculate, merge, or rewrite canonical Candidate content, "
          + "Evidence references, SQL Evidence indexes, epistemic levels, or presentation. Follow the requested JSON "
          + "output contract exactly; zero Findings is valid."
      );
    } else {
    const localRangeStart = formatEnergyTimestamp(energyContext.from, energyContext.timezone);
    const localRangeEnd = formatEnergyTimestamp(
      new Date(Date.parse(energyContext.to) - 1).toISOString(),
      energyContext.timezone
    );
    const hasAnalysisRequirements = input.analysisRequirements.length > 0;
    const noDeclaredClaimValues = input.analysisRequirements.every((requirement) =>
      requirement.assertions.every((assertion) => assertion.claimValues.length === 0)
    );
    const chartRequested = isChartRequested(context.user_input);
    policies.push(
      "EnergyIQ trusted-query fast path: the server has already selected and allowlisted exactly one datasource for "
        + `Project "${energyContext.projectName}", scope "${energyContext.scopeName}" (${energyContext.scopeType}), `
        + `resource "${energyContext.resource}", and the half-open time range [${energyContext.from}, `
        + `${energyContext.to}) in timezone ${energyContext.timezone}. The user selected period is `
        + `"${energyContext.period}"; its local calendar display range is ${localRangeStart} through `
        + `${localRangeEnd}. Treat that scope and period as authoritative and show the local calendar range, not raw UTC. `
        + "Do not call list_data_sources, list_files, preview_table, workspace file tools, or direct database clients "
        + "to rediscover data. "
        + (input.preferEvidenceContextBeforeDataTools
          ? "Answer from the bound immutable Evidence without opening the datasource. Only after identifying a demonstrated "
            + "gap in that package, call inspect_schema once for the lazy governed datasource and wait for its result. "
          : "Call inspect_schema alone as the initial governed-contract setup action and wait for its result. ")
        + "This setup action does not require a SQL investigation. If scoped SQL can add explanation, reduce "
        + "uncertainty, verify a new angle, or change the action, reuse that inspection's schema_id in run_sql_readonly. "
        + (hasAnalysisRequirements
          ? "A requirement whose analysis_contract declares sufficient context_evidence may be committed directly; the server "
            + "binds its authorized current-Snapshot Context Evidence. Requirements without sufficient context evidence need "
            + "at least one successful run_sql_readonly result in the current run. "
          : "Released authoritative current-Snapshot Context Evidence may be cited directly when it supports a claim. ")
        + "Scoped SQL may investigate relevant context but must not silently replace released values. Schema IDs and table "
        + "names found in prior messages, deterministic Evidence, examples, or earlier runs are reference-only and "
        + "must never be executed in the current run. The run-scoped relation is already restricted to the authoritative "
        + "period, so do not add a redundant time filter. If a boundary audit truly requires one, compare a TIMESTAMPTZ "
        + "column only with explicit TIMESTAMPTZ UTC literals; never compare it with an unzoned TIMESTAMP literal. Prefer one "
        + "focused aggregate SQL query that supplies all requested figures; for simple aggregates, query the inspected "
        + "physical table directly and avoid CTEs or derived table aliases when that is the clearest correct query. "
        + "Use as many focused SQL queries as the question and Evidence require. Avoid redundant repeats, but never "
        + "stop investigating merely to meet a query, step, latency, or token target. If a validation error occurs, "
        + "use its feedback to repair the query or choose a better supported path. "
        + (hasAnalysisRequirements
          ? "Commit evidenced analysis requirements when they are sufficiently verified. "
          : "Keep every reported claim bound to the Evidence that supports it. ")
        + "For one count, total, lookup, or direct comparison, start with the "
        + "smallest sufficient query. If it does not fully answer and verify the request, continue investigating. "
        + "When reporting a share or percentage, make the full requested denominator explicit in the SQL result, for "
        + "example with a conditional total or a window total. Preserve NULL or Unknown dimension values as an explicit "
        + "bucket or disclose the unreconciled amount; never use only the displayed non-null groups as the parent total. "
        + "Prefer an authoritative deterministic Evidence item when it already answers the question. Business "
        + "classifications such as facility type must come from an explicit Metadata field or authoritative Evidence. "
        + "Never infer a classification or a zero count from project titles, ID prefixes, Scope names, device labels, "
        + "or the absence of matching words in energy facts. If the required dimension is not exposed, return Missing "
        + "Evidence or Unavailable instead of searching similar labels or guessing. Do not enumerate a large Evidence "
        + "bundle in reasoning when one Evidence item or query can verify the answer. For an explanatory or discovery "
        + "question, begin with the strongest available observation and use targeted follow-ups to test candidate "
        + "explanations, comparisons, and decisions. Continue while another check can materially improve correctness, "
        + "reduce uncertainty, or change the recommended action. "
        + (hasAnalysisRequirements
          ? "Finish only when the requirements are supported by sufficient Evidence, or when the remaining Evidence gap is "
            + "stated honestly with a useful verification path. "
          : "Finish when the requested output is supported by sufficient Evidence, or state the remaining Evidence gap "
            + "honestly with a useful verification path. ")
        + "Keep visible reasoning useful: name the question, the Evidence gap, the next check, and what the result changed. Do not "
        + "repeat the Prompt, policy, schema, protocol contract, or the same finding in multiple reasoning rounds. "
        + (hasAnalysisRequirements
          ? (noDeclaredClaimValues
              ? "This run declares no claim value names, so every analysis_requirements_commit claim must omit its values field entirely. "
              : "Include only claim value names explicitly declared in the requirement assertions. ")
          : "This run has no generic analysis-requirement commit step. Do not search for, invent, or mention requirement IDs or a commit tool. Follow the requested final output contract exactly. ")
        + "Call tools without narrating internal plans or validation "
        + "mechanics. After the tools finish, start the final answer with the user-facing result itself, then give the "
        + "scope, period, unit, and concise caveats. Never preface the answer with a workflow status such as requirements "
        + "committed, validation completed, analysis completed, or protocol completed. Do not mention requirement IDs, "
        + "tool names, schema IDs, artifact IDs, commits, or internal protocol state unless "
        + "the user explicitly asks for audit details. Never show the internal datasource ID; use the Project and scope "
        + "names above. Do not create a report, export, chart file, "
        + "or other workspace artifact unless the user explicitly requests one; a normal conversational answer is not "
        + "an artifact. "
        + (chartRequested
          ? "The user explicitly requested a chart. Make the first chartable analytical SQL result exactly two columns: "
            + "one label/time column and one numeric metric column, with 2 to 500 exact rows, and set the "
            + "run_sql_readonly limit argument to 500 so the result is not truncated. The backend automatically "
            + "creates the validated chart preview from those SQL rows. Never use write_file or execute_command to build "
            + "HTML, CSV, JavaScript, SVG, or simulated chart values; never interpolate, repeat, or invent points. For an "
            + "hourly trend across a multi-day period, the first chart query must group by the full local hourly timestamp "
            + "(for example date_trunc('hour', local_interval_start) AS local_hour_start), not return raw interval rows and "
            + "not group by hour-of-day or EXTRACT(hour); a complete seven-day hourly timeline has 168 ordered points, "
            + "not 24 aggregated clock-hour buckets. Reuse that chart result to identify the peak. If the chart result "
            + "preview is truncated and the exact peak is not visible, run a focused follow-up using the same "
            + "hourly aggregation ordered by the hourly metric descending with LIMIT 1; never use MAX on a raw interval "
            + "row as the hourly peak. Do not add a total query unless the user asked for a total. Mention a generated "
            + "chart preview only when the successful SQL tool "
            + "result explicitly reports that the backend created a chart artifact. When it exists, tell the user that "
            + "the chart is available in Task Console > Outputs > Preview; do not say chart below because charts are not "
            + "currently embedded inline in the answer. If no chart artifact exists, use the validation feedback to "
            + "correct the SQL and retry; otherwise state plainly that no chart was generated."
          : "")
    );
    }
  }
  if (enabled(OVERVIEW_AI_CANDIDATE_SUBMISSION_TOOL_NAME) && enabled("run_sql_readonly")) {
    policies.push(
      "For Overview Candidate submission, every successful run_sql_readonly result includes an evidence_index assigned "
        + "by this Run. Copy the returned evidence_index exactly into evidenceSqlIndexes. Do not count or reconstruct "
        + "SQL Evidence indexes yourself. Failed SQL calls have no evidence_index and do not consume one."
    );
  }
  if (taskToolsEnabled && taskTools.length === 4) {
    policies.push(
      "Plan with tasks. For work with three or more distinct actions, call task_write first and keep exactly one "
        + "task in_progress at a time. "
        + "Update tasks as you progress and call task_complete when each is done. "
        + "Before declaring work finished, call task_check to confirm nothing is left. "
        + "Never invent task IDs; reuse only those returned by tool results."
    );
  }
  if (input.analysisRequirements.length > 0) {
    const requirementList = input.analysisRequirements.map((requirement) => {
      const assertions = requirement.assertions.map((assertion) => ({
        id: assertion.id,
        kind: assertion.kind,
        ...(assertion.sourceTables.length > 0 ? { sourceTables: assertion.sourceTables } : {}),
        ...(assertion.dimensions.length > 0 ? { dimensions: assertion.dimensions } : {}),
        ...(assertion.sqlConstraints.length > 0 ? { sqlConstraints: assertion.sqlConstraints } : {}),
        ...(assertion.resultChecks.length > 0 ? { resultChecks: assertion.resultChecks } : {}),
        ...(assertion.claimValues.length > 0 ? { claimValues: assertion.claimValues } : {})
      }));
      return `${requirement.id}: ${requirement.description}; acceptance=`
        + `${requirement.acceptanceCriteria.join(" | ") || "evidenced"}; assertions=${JSON.stringify(assertions)}`;
    }).join("\n");
    toolGroups.push("Analysis requirement tool: analysis_requirements_commit.");
    policies.push(
      "Analysis requirements are mandatory minimum completion conditions, not an exhaustive boundary on investigation:\n"
        + requirementList
        + "\nThe Analyst may pursue additional Evidence-backed angles when they can improve correctness, reduce uncertainty, "
        + "or create decision value. Additional investigation must not replace or weaken the user's required claims. "
        + "\nWhen using task_write, include the relevant requirement IDs in each task content. Every run_sql_readonly call "
        + "must include requirement_ids for the claims it supports and expected_columns for its result contract. "
        + "For every non-manual structured requirement, also include its exact assertion_ids; the runtime rejects SQL "
        + "that violates declared source, aggregate, grain, filter, or time-range semantics. "
        + "Include downstream validation and decision requirement IDs on the source SQL call that supplies their facts; "
        + "one SQL result may support multiple requirement IDs and derived conclusions do not need duplicate queries. "
        + "Preserve the user's exact metric and allocation semantics: do not substitute a requested metric with a nearby "
        + "one. For counterfactual budgets, write the allocation formula before querying and validate budget conservation. "
        + "A uniform percentage or rate means budget divided by the relevant cost base, then each row receives its own "
        + "cost multiplied by that rate; it never means budget divided equally by row count. Use half-open timestamps to "
        + "include the full requested end date. Compute threshold crossings from row-level SQL, never estimates. "
        + "Do not defer every claim until the final step. As soon as a requirement has sufficient validated evidence, "
        + "call analysis_requirements_commit for that requirement before starting more optional drill-downs. Commit any "
        + "remaining evidenced requirements before writing final report files or the closing answer. Runtime resolves "
        + "validated evidence already bound to that requirement, so do not guess "
        + "artifact IDs. Every required claimValues entry must be copied into the claim values array with the exact "
        + "verified name, numeric value, and unit; the runtime rejects unverified or mismatched values. "
        + "For a derived claim, use evidence_requirement_ids to name the upstream requirement IDs that "
        + "supply its facts. evidence_refs are optional hints. Missing requirements force a partial result."
    );
  }
  if (collaborationToolsEnabled && collaborationTools.length > 0) {
    policies.push(
      "Use ask_user only when progress requires information or a decision that cannot be inferred safely. "
        + "Use submit_plan when explicit user approval is required before implementation; both tools suspend the run."
    );
  }
  if (input.mcpToolNames.length > 0) {
    policies.push(
      "MCP tools are enabled for this run. Use the exact MCP tool names listed above when the user asks for MCP, "
        + "datagraph, graph exploration, or a tool whose description directly matches the task."
    );
  }
  if (skillTools.length > 0) {
    const selectedSkillHint = input.selectedSkills.length > 0
      ? ` Prioritize the selected skills listed in the prompt: ${
          input.selectedSkills.map((skill) => skill.name).join(", ")
        }.`
      : "";
    const skillScriptPolicy = enabled("execute_command")
      ? " Scripts from skills may be executed only through approved workspace tools such as execute_command."
      : " Treat scripts from skills as reference material this run because command execution is unavailable.";
    policies.push(
      "Use skills as task guidance, not as executable tools. skill_search may search the full shared skill cache; "
        + "a search result does not by itself mean the skill was selected for this run."
        + selectedSkillHint
        + " When the task matches an available skill, call "
        + "skill_search or skill to load its instructions, then use normal approved tools to act. "
        + "Use skill_read for references, scripts, or assets that belong to a relevant loaded skill. "
        + skillScriptPolicy
    );
  }
  if (enabled("inspect_schema") && (enabled("run_sql_readonly") || enabled("preview_table"))) {
    policies.push("Inspect before you query, then reuse the schema_id. "
      + "inspect_schema returns a schema_id token that authorizes "
      + "run_sql_readonly and preview_table; pass it as their schema_id argument. The first SQL or preview against a "
      + "datasource must be preceded by an inspect_schema for it; without a valid schema_id the tools fail with "
      + "SCHEMA_REQUIRED. The token enforces inspect-before-query ordering within this run; Data Gateway remains the "
      + "authorization and read-only SQL boundary. Reuse the token instead of repeatedly inspecting the same schema."
    );
  }
  if (enabled("run_sql_readonly")) {
    policies.push("Write read-only SQL only. Generate SELECT or WITH queries and run them through run_sql_readonly. "
      + "Do not attempt writes, DDL, or multi-statement scripts through SQL"
      + (enabled("execute_command")
        ? ". Never use execute_command or direct database clients to bypass Data Gateway."
        : ". Never use direct database clients to bypass Data Gateway.")
    );
  }
  if (enabled("protocol_handoff")) {
    policies.push(
      `This run is governed by ${input.protocolId}@1. Use protocol_handoff only when the user's remaining goal truly `
        + "requires the other registered protocol (general-task@1 or data-analysis@1). Provide stable reasonCodes and "
        + "all unresolvedGoals. Never hand off to bypass schema, SQL validation, evidence, policy, or completion gates."
    );
  }
  policies.push(energyIqTrustedStageTransition
    ? "For EnergyIQ server-scoped transition comparison, follow the requested structured output exactly. Classify "
      + "changes only from exact A and B Finding and Evidence lineage. Do not force a fixed What/Why/Action lens or "
      + "invent a change merely to fill the result."
    : context.energy_query_context
      ? energyIqTrustedStageDiscovery
      ? additionalAiInsightSubmissionEnabled
        ? `For EnergyIQ server-scoped discovery, submit the requested Candidate envelope through `
          + `${ADDITIONAL_AI_INSIGHT_SUBMISSION_TOOL_NAME} exactly once. Keep factual claims bound to current Evidence and `
          + "distinguish observed, inferred, and speculative content honestly. Do not force a fixed What/Why/Action lens "
          + "or invent a candidate merely to fill the result."
        : "For EnergyIQ server-scoped discovery, follow the requested structured output exactly. Keep factual claims bound "
          + "to current Evidence and distinguish observed, inferred, and speculative content honestly. Do not force a fixed "
          + "What/Why/Action lens or invent a candidate merely to fill the result."
      : "For EnergyIQ, write the final customer answer in plain English even when the question is in Chinese. Lead with "
      + "the answer or finding, then explain What happened, Why it matters or may have happened, What to do next, and "
      + "How to verify when those sections are useful. Unless the user explicitly requests detail, multiple deliverables, "
      + "or a report, the final answer to one decision question must be a compact executive brief under 300 words and "
      + "use no more than five short bullets: one-sentence takeaway, up to three decisive Evidence points, one next "
      + "action, and one verification measure. Keep only facts "
      + "that change prioritization, impact, action, or uncertainty; omit secondary metrics and technical method details. "
      + "This is a presentation target, not an analysis or tool budget; investigate as much as needed before answering. "
      + "Do not list every query or checked metric. Avoid protocol jargon and unexplained technical terms. Visible "
      + "reasoning may use the model's natural working language. Do not invent external definitions, classifications, "
      + "causes, or operational facts that are absent from authoritative Context or successful Tool Evidence. Keep SQL, "
      + "table names, and column names unchanged."
    : "Reply in the same natural language as the user's latest request. If the user mixes languages, use the dominant "
      + "language from the request. Keep SQL, code, table names, column names, and other technical identifiers unchanged."
  );
  policies.push(additionalAiInsightSubmissionEnabled
    ? `After a successful submission, stop immediately. Do not emit the Candidate envelope or any closing Assistant `
      + `text after ${ADDITIONAL_AI_INSIGHT_SUBMISSION_TOOL_NAME}; the accepted tool result is the run's terminal value.`
    : "Always finish a run with a brief natural-language message to the user that summarizes what you did and the "
      + "outcome, even when your most recent action was a tool call such as a file write, command execution, or "
      + "artifact publish. Never end a run silently right after a tool result: that closing message is how the user "
      + "learns the result. Summarize outcomes and refer to any produced files or artifacts by name instead of "
      + "restating raw tool output.");
  policies.push(
    "Runtime circuit breakers exist only to stop runaway execution; they are not an analysis budget or a reason to "
      + "answer early. Continue until the requirement is supported by sufficient Evidence or the unresolved gap is "
      + "explicit. When another query would not change the conclusion, next action, or material uncertainty, finish "
      + "the investigation and answer; this is a judgment principle, not a fixed query or step limit. Prefer focused, "
      + "non-duplicative queries and use validation feedback to refine the investigation. "
      + `(SQL longer than ${SQL_MAX_SQL_CHARS} chars is truncated from view.)`
  );
  if (commandExecutionEnabled) {
    const workspacePromotionPolicy = promoteWorkspaceFileEnabled
      ? "Call promote_workspace_file only to lift a session workspace file into a cross-session reusable asset "
        + "(files in the same session are already retained across runs; do not promote merely to reuse within this "
        + "session)."
      : "";
    policies.push(
      "Persist derived artifacts in the workspace. When analysis produces exports, charts, or transformed datasets, "
        + "write them as files via write_file so they are retained with the session, rather than only echoing them in "
        + "the final message. "
        + "Eligible reusable files (for example CSV, JSON, Markdown, HTML, PNG, SVG, XLSX) are automatically shown "
        + "as Session Outputs after successful write_file/edit_file calls. "
        + "Do not invent download URLs, link text, or UI placement such as 'click the link below'; the client renders "
        + "download controls from output events and file APIs. "
        + workspacePromotionPolicy
    );
    if (input.pythonRuntimeAvailable) {
      policies.push(
        "For Python analysis, prefer write_file to create a .py script, then execute_command with "
          + "`python3.12 <script>`. "
          + "Use pandas for tabular work, matplotlib with plt.savefig() for charts (no GUI display), and scikit-learn "
          + "for modeling. "
          + "Export CSV/JSON/PNG files to the session workspace when the user should reuse or download results."
      );
    }
  }
  policies.push(
    "Report failures honestly. If schema inspection, SQL execution, a file write, or a command fails, explain the "
      + "failure plainly. "
      + "Do not fabricate results to mask an error."
  );
  policies.push(
    "Recover from tool failures deliberately. Structured tool errors include error.executionStatus and a recovery "
      + "object. Follow recovery.strategy and recovery.instruction, and respect every recovery.avoid item. If "
      + "executionStatus is succeeded_uncommitted, do not repeat the external action unless the recovery strategy "
      + "explicitly permits a retry."
  );
  policies.push(
    "Confidentiality. Never reveal credentials, datasource config, internal environment values, or workspace "
      + "absolute paths in your responses."
  );
  const selectedSkillSummary = input.selectedSkills.length > 0
    ? input.selectedSkills.map((skill) => `${skill.name} (${skill.id}): ${skill.description}`).join("\n")
    : "None";
  const loadedSkillInstructions = input.loadedSkills.length > 0
    ? input.loadedSkills.map((skill) => (
        `${skill.name}@${skill.semanticVersion} (config revision ${skill.configRevision})\n${skill.instructions}`
      )).join("\n\n")
    : "None";
  const datasourcePolicy = (context.enabled_datasource_ids ?? []).length > 0 && dataTools.length > 0
    ? `Datasources available this run: [${(context.enabled_datasource_ids ?? []).join(", ")}]
Default datasource: "${context.selected_datasource_id ?? ""}".
You may query any datasource in the list above by passing its id to a data tool's datasource_id argument.
Never reference a datasource id outside this list; the tool rejects it with DATASOURCE_NOT_SELECTED.`
    : (context.enabled_datasource_ids ?? []).length > 0
      ? `Datasource scope is server-bound to [${(context.enabled_datasource_ids ?? []).join(", ")}], but no data tools `
        + "are enabled for this run. Use only the supplied context and do not attempt a datasource query."
    : "No datasources are enabled this run. Answer general questions directly. "
      + "Do not call data tools unless the user enables a datasource.";
  const agentMission = hasAnyEnabledTools
    ? input.preferEvidenceContextBeforeDataTools
      ? "Answer from the supplied authoritative Evidence first. Call data tools only when the question requires facts outside that Evidence."
      : "Analyze data by calling tools."
    : "Follow the supplied context and requested output contract without calling tools.";

  return `
You are a general-purpose data agent. ${agentMission} Never invent schema, rows, SQL results,
file contents, or command output.

${datasourcePolicy}
Selected skills to prioritize this run:
${selectedSkillSummary}

Loaded governed Skill instructions:
${loadedSkillInstructions}

Tool groups:
- ${toolGroups.join("\n- ")}

Operating policy:
${policies.map((policy, index) => `${index + 1}. ${policy}`).join("\n")}
`;
};

const isTrustedEnergyTextQueryContract = (
  value: NonNullable<AgentRunContext["energy_query_context"]>
): value is TrustedEnergyTextQueryContract =>
  "kind" in value && value.kind === "trusted-energy-text-query";

const formatEnergyTimestamp = (value: string, timeZone: string): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(new Date(value));

const selectToolsByPolicy = <TTool>(
  availableTools: Record<string, TTool>,
  skillSelection: SkillSelectionResult | undefined
): Record<string, TTool> => {
  const policy = skillSelection?.effectiveToolPolicy;
  const deniedTools = new Set(policy?.deniedTools ?? []);
  const allowedTools = policy?.allowedTools ? new Set(policy.allowedTools) : undefined;
  return Object.fromEntries(Object.entries(availableTools).filter(([name]) =>
    !deniedTools.has(name)
    && (!allowedTools || allowedTools.has(name))
  ));
};

const createReadOnlyWorkingMemoryProcessor = async (
  runtime: TaskStateRuntime
): Promise<WorkingMemory | undefined> => {
  const memoryStore = await runtime.storage.getStore("memory");
  if (!memoryStore) {
    return undefined;
  }
  return new WorkingMemory({
    storage: memoryStore,
    readOnly: true,
    scope: CONVERSATION_WORKING_MEMORY_CONFIG.workingMemory.scope,
    template: {
      format: "markdown",
      content: CONVERSATION_WORKING_MEMORY_CONFIG.workingMemory.template
    },
    templateProvider: runtime.memory
  });
};

const requireFileAssetService = (service: FileAssetService | undefined): FileAssetService => {
  if (!service) {
    throw new Error("SKILL_FILE_ASSET_SERVICE_REQUIRED");
  }
  return service;
};

const materializeWorkspaceAttachments = (
  runDir: string,
  attachments: WorkspaceAttachment[]
): MaterializedWorkspaceAttachment[] => {
  const inputDir = join(runDir, "input");
  mkdirSync(inputDir, { recursive: true });
  const usedNames = new Set<string>();
  return attachments.map((attachment) => {
    const filename = uniqueWorkspaceInputFilename(attachment.filename, usedNames);
    const targetPath = resolve(inputDir, filename);
    if (!targetPath.startsWith(`${inputDir}${sep}`)) {
      throw new Error("WORKSPACE_ATTACHMENT_PATH_ESCAPE");
    }
    mkdirSync(dirname(targetPath), { recursive: true });
    try {
      linkSync(attachment.source_path, targetPath);
    } catch {
      copyFileSync(attachment.source_path, targetPath);
    }
    return {
      file_id: attachment.file_id,
      filename,
      ...(attachment.mime_type ? { mime_type: attachment.mime_type } : {}),
      path: `input/${filename}`,
      size_bytes: attachment.size_bytes
    };
  });
};

const createFileAssetTools = (input: {
  abortSignal?: AbortSignal | undefined;
  fileAssetService: FileAssetService;
  runContext: AgentRunContext;
  /** Per-session directory — the agent's writable basePath (where new files live). */
  sessionDir: string;
  /** Persistent workspace root — cross-session asset area (read-only to the agent). */
  workspaceDir: string;
}): Record<string, ReturnType<typeof createTool>> => ({
  promote_workspace_file: createTool({
    id: "promote_workspace_file",
    description: "Promote a session file into the cross-session workspace root so other sessions can read it. "
      + "The file currently lives in this session's scope (only this session sees it); after promote it is "
      + "copied/hardlinked into the persistent workspace root and registered as a cross-session asset. "
      + "Use this only to share a file across sessions, not to reuse within the current session.",
    inputSchema: z.object({
      path: z.string().min(1),
      filename: z.string().min(1).optional(),
      description: z.string().optional()
    }),
    execute: async (toolInput) => {
      throwIfAborted(input.abortSignal);
      // Source is a session-scoped file; target is the persistent workspace root.
      const sourcePath = resolveWorkspaceRelativePath(input.sessionDir, toolInput.path);
      const filename = toolInput.filename ?? basename(sourcePath);
      const targetPath = resolveWorkspaceRelativePath(input.workspaceDir, filename);
      const sourceRef = input.fileAssetService.createRefFromPath({
        user_id: input.runContext.user_id,
        workspace_id: input.runContext.workspace_id ?? "default",
        session_id: input.runContext.session_id,
        run_id: input.runContext.run_id,
        filename,
        declared_mime_type: mimeTypeForFilename(filename),
        source: "workspace",
        path: sourcePath,
        ...(toolInput.description ? { metadata: { description: toolInput.description } } : {})
      }).ref;
      // Materialize into the workspace root (hardlink, fall back to copy).
      input.fileAssetService.materializeRefToPath({
        ref: sourceRef,
        targetPath,
        linkStrategy: "hardlink"
      });
      // Register as a cross-session workspace ref (session_id IS NULL).
      const resolved = input.fileAssetService.promoteFileToWorkspace({
        user_id: input.runContext.user_id,
        workspace_id: input.runContext.workspace_id ?? "default",
        file_asset_ref_id: sourceRef.id,
        filename,
        declared_mime_type: mimeTypeForFilename(filename)
      });
      return {
        ...fileAssetRefDto(resolved),
        download_url: `/api/v1/files/${resolved.ref.id}/download`
      };
    }
  }),
  list_workspace_files: createTool({
    id: "list_workspace_files",
    description: "List files in the cross-session workspace root (read-only). These are assets shared across "
      + "all of the user's sessions — uploads and promoted files. To read one, use read_workspace_file with the "
      + "returned path. New files you write go to the session scope (list_files), not here.",
    inputSchema: z.object({
      path: z.string().optional()
    }),
    execute: async (toolInput) => {
      throwIfAborted(input.abortSignal);
      const listPath = toolInput.path
        ? resolveWorkspaceRelativePath(input.workspaceDir, toolInput.path)
        : input.workspaceDir;
      const entries = listWorkspaceFiles(listPath);
      return { path: toolInput.path ?? ".", files: entries };
    }
  }),
  read_workspace_file: createTool({
    id: "read_workspace_file",
    description: "Read a file from the cross-session workspace root (read-only). Use the path from "
      + "list_workspace_files. These files are shared across sessions; do not attempt to write or edit them "
      + "(use write_file for new session-scoped files, promote_workspace_file to add one here).",
    inputSchema: z.object({
      path: z.string().min(1)
    }),
    execute: async (toolInput) => {
      throwIfAborted(input.abortSignal);
      const filePath = resolveWorkspaceRelativePath(input.workspaceDir, toolInput.path);
      const body = readFileSync(filePath);
      return {
        path: toolInput.path,
        content: body.toString("utf8"),
        size_bytes: body.length,
        mime_type: mimeTypeForFilename(toolInput.path)
      };
    }
  })
});

const resolveWorkspaceRelativePath = (workspaceDir: string, relativePath: string): string => {
  if (relativePath.startsWith("/") || relativePath.includes("\0")) {
    throw new Error("WORKSPACE_PATH_INVALID");
  }
  const path = resolve(workspaceDir, relativePath);
  if (path !== workspaceDir && !path.startsWith(`${workspaceDir}${sep}`)) {
    throw new Error("WORKSPACE_PATH_ESCAPE");
  }
  return path;
};

const throwIfAborted = (signal?: AbortSignal | undefined): void => {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error("RUN_CANCELLED");
  }
};

/** List files under a directory (one level) relative to the workspace root, read-only. */
type WorkspaceFileEntry = {
  is_directory: boolean;
  name: string;
  path: string;
  size_bytes: number;
};

const listWorkspaceFiles = (dirPath: string): WorkspaceFileEntry[] => {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.name !== ".DS_Store")
    .map((entry) => {
      const full = join(dirPath, entry.name);
      let size = 0;
      try {
        size = statSync(full).size;
      } catch {
        // unreadable entry — keep size 0
      }
      return {
        path: entry.name,
        name: entry.name,
        size_bytes: size,
        is_directory: entry.isDirectory()
      };
    });
};

const uniqueWorkspaceInputFilename = (filename: string, usedNames: Set<string>): string => {
  const safe = basename(filename).replace(/[^a-zA-Z0-9._ -]+/gu, "-").trim() || "file";
  if (!usedNames.has(safe)) {
    usedNames.add(safe);
    return safe;
  }
  const dot = safe.lastIndexOf(".");
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  const extension = dot > 0 ? safe.slice(dot) : "";
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${stem}-${index}${extension}`;
    if (!usedNames.has(candidate)) {
      usedNames.add(candidate);
      return candidate;
    }
  }
  throw new Error("WORKSPACE_ATTACHMENT_NAME_EXHAUSTED");
};

export const normalizeIngressMessages = (messages: Message[]): Message[] =>
  messages
    .filter((message) => message.role !== "activity" && message.role !== "reasoning")
    .map(normalizeWorkspaceUploadMessage);

const normalizeWorkspaceUploadMessage = (message: Message): Message => {
  if (message.role !== "user" || !Array.isArray(message.content)) {
    return message;
  }
  const existingText = message.content
    .filter((part): part is { text: string; type: "text" } =>
      isRecord(part) && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
  const content: unknown[] = [];
  let changed = false;

  for (const part of message.content) {
    content.push(part);
    const uploadText = workspaceUploadPartText(part, existingText);
    if (uploadText) {
      content.push({ type: "text", text: uploadText });
      changed = true;
    }
  }

  return changed ? { ...message, content } as Message : message;
};

const workspaceUploadPartText = (part: unknown, existingText: string): string | undefined => {
  if (!isRecord(part)) {
    return undefined;
  }
  const source = isRecord(part.source) ? part.source : undefined;
  const rawPath = source?.type === "url" && typeof source.value === "string" ? source.value.trim() : undefined;
  if (
    !rawPath
    || !isWorkspaceUploadPath(rawPath)
    || (existingText.includes("Uploaded workspace file:") && existingText.includes(rawPath))
  ) {
    return undefined;
  }
  const metadata = isRecord(part.metadata) ? part.metadata : {};
  const filename = typeof metadata.filename === "string" && metadata.filename.trim()
    ? metadata.filename.trim()
    : basename(rawPath);
  const mimeType = typeof source?.mimeType === "string" && source.mimeType.trim()
    ? source.mimeType.trim()
    : "unknown";
  return [
    "Uploaded workspace file:",
    `- path: ${rawPath}`,
    `- filename: ${filename}`,
    `- mime_type: ${mimeType}`,
    "Use the workspace read_file tool with this path when you need the file contents."
  ].join("\n");
};

const isWorkspaceUploadPath = (value: string): boolean =>
  value.startsWith("uploads/")
  && !value.startsWith("/")
  && !value.includes("\0")
  && value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

type RuntimeExecutableTool = {
  description?: string;
  execute?: (...args: any[]) => unknown | Promise<unknown>;
};

const describeOverviewAiSqlEvidenceIndexes = <TTools extends Record<string, RuntimeExecutableTool>>(
  tools: TTools,
): TTools => {
  const runSqlReadonly = tools.run_sql_readonly;
  if (!runSqlReadonly?.execute) {
    return tools;
  }
  return {
    ...tools,
    run_sql_readonly: {
      ...runSqlReadonly,
      description: `${runSqlReadonly.description ?? "Execute one governed read-only SQL query."} `
        + "For Overview Candidate submission, copy the returned evidence_index exactly into evidenceSqlIndexes; "
        + "failed calls do not receive or consume an index.",
    },
  } as TTools;
};

const isProtocolRuntimeAction = (actionName: string): boolean =>
  actionName === "general.answer.commit"
  || actionName === "protocol.handoff.propose"
  || actionName.startsWith("analysis.")
  || actionName.startsWith("data.query.")
  || actionName === "semantic.context.resolve";

const protocolToolCallId = (options: unknown): string | undefined => {
  if (!isRecord(options) || !isRecord(options.agent)) {
    return undefined;
  }
  return typeof options.agent.toolCallId === "string" && options.agent.toolCallId.length > 0
    ? options.agent.toolCallId
    : undefined;
};

export { validateProtocolDefinition } from "./protocol/definition-validator.js";
export { ActionRouter } from "./capabilities/action-router.js";
export { CapabilityRegistry } from "./capabilities/capability-registry.js";
export { createToolCapabilityPlugin } from "./capabilities/tool-capability-plugin.js";
export type * from "./capabilities/types.js";
export { ToolExecutionError, toToolExecutionError, toolErrorObservation } from "./errors/tool-execution-error.js";
export type * from "./errors/tool-execution-error.js";
export { evaluateProtocolHandoff } from "./protocol/protocol-handoff.js";
export {
  createCoreAnalysisRequirements,
  createUserAnalysisRequirements
} from "./protocol/analysis-requirements.js";
export type * from "./protocol/analysis-requirements.js";
export {
  createAnalysisRequirementExtractionPrompt,
  createModelAnalysisRequirementExtractor,
  parseAnalysisRequirementExtractionText
} from "./protocol/model-analysis-requirement-extractor.js";
export type { AnalysisRequirementExtractor } from "./protocol/model-analysis-requirement-extractor.js";
export {
  createAnalysisContractGroundingPrompt,
  createModelAnalysisContractGrounder,
  parseAnalysisContractGroundingText
} from "./protocol/model-analysis-contract-grounder.js";
export type * from "./protocol/model-analysis-contract-grounder.js";
export { ProtocolHandoffCoordinator } from "./protocol/protocol-handoff-coordinator.js";
export { InMemoryProtocolStateStore } from "./protocol/in-memory-protocol-state-store.js";
export { ProtocolRegistry } from "./protocol/protocol-registry.js";
export { ProtocolRouter } from "./protocol/protocol-router.js";
export { ProtocolRuntime } from "./protocol/protocol-runtime.js";
export { createModelProtocolClassifier } from "./protocol/model-protocol-classifier.js";
export { createRunProtocolBoundary } from "./protocol/run-protocol-boundary.js";
export type * from "./protocol/run-protocol-boundary.js";
export { createGeneralTaskProtocol } from "./protocol/protocols/general-task.js";
export { createDataAnalysisProtocol } from "./protocol/protocols/data-analysis.js";
export type * from "./protocol/protocol-handoff.js";
export type * from "./protocol/protocol-handoff-coordinator.js";
export type * from "./protocol/protocol-router.js";
export type * from "./protocol/protocol-runtime.js";
export type * from "./protocol/types.js";
export { DataLinkSemanticProvider } from "./semantic/datalink-semantic-provider.js";
export { EnergyQuerySemanticProvider } from "./semantic/energy-query-semantic-provider.js";
export {
  createEnergyAnalysisContractGrounder,
  createEnergyContextEvidenceGrounder,
  selectEnergyAnalysisContextEvidence,
} from "./semantic/energy-analysis-contract-grounder.js";
export type { EnergyAnalysisSemantics } from "./semantic/energy-analysis-contract-grounder.js";
export {
  executeTrustedEnergyText,
  projectAnalysisSnapshotToTrustedText
} from "./semantic/project-analysis-snapshot-trusted-text.js";
export type {
  ProjectAnalysisSnapshotTrustedTextInput,
  TrustedEnergySnapshotMetric,
  TrustedEnergySnapshotProjection,
  TrustedEnergyStructuredClaimProvider
} from "./semantic/project-analysis-snapshot-trusted-text.js";
export {
  compileTrustedEnergyTextQuery,
  createTrustedEnergyAnswerEnvelope,
  TRUSTED_ENERGY_TEXT_INTENT_METRICS,
  TRUSTED_ENERGY_TEXT_INTENTS,
  validateTrustedEnergyTextResult
} from "./semantic/trusted-energy-text.js";
export type {
  TrustedEnergyPhysicalSchemaIdentity,
  TrustedEnergyTextIntent,
  TrustedEnergyTextQueryContract,
  TrustedEnergyTextRequest,
  TrustedEnergyTextResult,
  TrustedEnergyTextResultInput
} from "./semantic/trusted-energy-text.js";
export { LocalSemanticProvider } from "./semantic/local-semantic-provider.js";
export { SemanticProviderChain } from "./semantic/semantic-provider-chain.js";
export { createDefaultSemanticProvider } from "./semantic/default-semantic-provider.js";
export type * from "./semantic/types.js";
