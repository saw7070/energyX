import { materializeAgentProjectSource, publishAgentProjectSetup } from "./energy/energy-api.js";
import { AbstractAgent, EventType, type BaseEvent, type RunAgentInput } from "@ag-ui/client";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNodeHttpEndpoint
} from "@copilotkit/runtime";
import {
  CONVERSATION_WORKING_MEMORY_CONFIG,
  createEnergyAnalysisContractGrounder,
  createEnergyContextEvidenceGrounder,
  createTaskStateRuntime,
  createCustomEvent,
  parseAgentMemoryMode,
  resolveSkillCacheDir,
  selectEnergyAnalysisContextEvidence,
  type AgentMemoryMode,
  type AnalysisContextEvidenceCatalog,
  type AnalysisRequirement,
  type CreateDataFoundryInput,
  type TaskStateRuntime,
  type TrustedEnergyTextQueryContract
} from "@datafoundry/agent-runtime";
import { createTool } from "@mastra/core/tools";
import { toStandardSchema } from "@mastra/core/schema";
import { LocalArtifactService, SessionOutputService } from "@datafoundry/artifacts";
import { type MeResponse, createEnvConfig, createErrorResult, createSuccessResult } from "@datafoundry/contracts";
import { LocalDataGateway, type DataGateway } from "@datafoundry/data-gateway";
import { LocalFileAssetService } from "@datafoundry/files";
import { LocalKnowledgeService } from "@datafoundry/knowledge";
import {
  RunEventWriter,
  createMetadataStore,
  type EnergyIqAdditionalInsightModelProfileSnapshot,
  type EnergyIqOverviewAiArtifactIdentity,
  type UserRecord,
  type MetadataStore
} from "@datafoundry/metadata";
import {
  buildSkillResourcePayload,
  configResourceToSkillRecord,
  materializeSkillPackages,
  parseSkillPackage
} from "@datafoundry/skills";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Observable } from "rxjs";
import { z } from "zod";

import { handleConfigApiRequest } from "./config-api.js";
import { reportSkillCatalog, resolveReportSkillSelection } from "./report-agent/report-skill-catalog.js";
import { ReportService, registerReportService } from "./report-agent/report-service.js";
import { createPiReportHarness, resolvePiReportModel } from "./report-agent/pi-report-harness.js";
import { createAsyncMemoByKey, createStartupTimer } from "./async-memo.js";
import { ensureBuiltinDtcGrowthDatasource } from "./builtin-dtc-growth-datasource.js";
import { reclaimOrphanedQueuedAndRunningRuns } from "./stale-active-runs.js";
import { loadPasswordAuthConfig, type PasswordAuthConfig } from "./auth/config.js";
import { AuthService, type AuthIdentity } from "./auth/service.js";
import { serverDefaultConnectionStatus, isServerLlmEnvConfigured } from "./model-profile-connection-status.js";
import {
  handleAuthApiRequest,
  isUnsafeMethod,
  resolvePasswordSessionIdentity,
  sendAuthError
} from "./auth/routes.js";
import { createMetadataContextPackageRecorder } from "./context-package-recorder.js";
import {
  energySessionForkProvenanceFromContext,
  inspectLatestAuthoritativeEnergyContextSnapshots,
  sessionEnergyContextFromPersistedJson,
  validateEnergySessionForkLineage,
  type EnergySessionForkLineage,
  type EnergySessionForkProvenance,
  type SessionEnergyContextDto,
} from "./energy/session-energy-context.js";
import { createMetadataModelRequestSnapshotRecorder } from "./model-request-snapshot-recorder.js";
import { MetadataProtocolStateStore } from "./protocol-state-store.js";
import { replayPendingProtocolEvents } from "./protocol-event-recovery.js";
import { assistantMessageIdFromEvent, completeProtocolRun } from "./protocol-run-completion.js";
import { persistCurrentUserMessage } from "./conversation-memory.js";
import { resolveEvidenceReferenceContext } from "./evidence-reference-context.js";
import { createRunAgentAssembly, createRunAgentContext } from "./run-agent-assembly.js";
import { RunCheckpointProjector } from "./run-checkpoint-projector.js";
import { TraceSectionCoordinator } from "./trace-section-coordinator.js";
import { resolveCheckpointResumeSeed, type CheckpointResumeSeed } from "./run-checkpoint-resume.js";
import { resolveRunConfig } from "./run-config-resolver.js";
import {
  createRunConfigAuditCapture,
  emitRunSkillEvidenceAuditEvents,
} from "./run-config-audit.js";
import { resolveRunIdentity } from "./run-identity-orchestrator.js";
import { createRunMemoryAssembly } from "./run-memory-assembly.js";
import {
  extractEnergyQueryContextRequest,
  extractEnergySessionForkRequest,
  extractLastUserText,
  extractTrustedEnergyTextIntent
} from "./run-input.js";
import {
  buildHitlToolCallStartEvent,
  extractInteractionResume,
  extractInteractionResumeRunId,
  InteractionRuntimeAdapter
} from "./interaction-runtime-adapter.js";
import { RunCancelRegistry } from "./run-cancel-registry.js";
import { RunEventPipeline } from "./run-event-pipeline.js";
import {
  RunFinalizer,
  createRunStatusDelta,
  withRunTerminalIdentity,
} from "./run-finalizer.js";
import { startSessionTitleTask } from "./session-title.js";
import { TaskPlanProjector } from "./task-plan-projector.js";
import { ToolCallResultBridge } from "./tool-call-result-bridge.js";
import { compileTrustedEnergyRunContract } from "./trusted-energy-run-contract.js";
import { ensureEnergyIqBootstrap } from "./energy/energy-bootstrap.js";
import {
  ensureEnergyIqAnalysisWorkspace,
  type EnergyIqAnalysisWorkspace,
} from "./energy/energy-analysis-workspace.js";
import {
  ENERGY_RUN_LATENCY_EVENT,
  ENERGY_RUN_PREPARATION_EVENT,
  createEnergyRunPreparationTrace,
  energyRunCorrelationIdFromForwardedProps,
  type EnergyRunPreparationTrace,
} from "./energy/energy-run-preparation.js";
import { createLazyEnergyTargetedQueryGateway } from "./energy/energy-lazy-targeted-query.js";
import {
  resolveEnergyAccessContext,
  resolveEnergyPublishedMeterRoute,
  type EnergyPublishedMeterRoute,
  type EnergyQueryContext,
} from "./energy/energy-query-context.js";
import { createEnergyAuthoritativeContextItems } from "./energy/energy-context-item.js";
import { createProjectAnalysisContextEvidenceCatalog } from "./energy/project-analysis-context-evidence.js";
import { recoverStrandedEnergyProjectPublications } from "./energy/energy-project-materialization.js";
import {
  materializeProjectAnalysisContextPackage,
  materializeCurrentProjectOverviewProjectionIfReady,
  prewarmProjectAnalysisContextPackage,
  readProjectAnalysisContextPackage,
  readCurrentProjectOverviewProjection,
  resolveProjectAnalysis,
  resolvePublishedEnergyQueryContext,
  type ProjectAnalysisRequestDiagnostics,
  type ProjectAnalysisSnapshot,
  type PublishedProjectRelease
} from "./energy/project-analysis-resolver.js";
import {
  type PreschoolOverviewAiStage,
  type PreschoolOverviewAiStageInput,
} from "./energy/preschool-overview-ai-workflow.js";
import { createPreschoolOverviewAiPageWorkflow } from "./energy/preschool-overview-ai-page-workflow.js";
import {
  composeNgeeAnnOverviewAiReadModel,
  createNgeeAnnProjectOverviewAiAdapter,
} from "./energy/ngee-ann-overview-ai-adapter.js";
import {
  createNgeeAnnOverviewAiWorkflow,
  isNgeeAnnOverviewAiGenerationTerminal,
  requireNgeeAnnAdditionalInsightsReady,
} from "./energy/ngee-ann-overview-ai-workflow.js";
import { NGEE_ANN_SECTION_MESSAGE_MAX_CHARS } from "./energy/ngee-ann-section-interpreter.js";
import { resolveNgeeAnnSectionManifestForRelease } from "./energy/ngee-ann-section-manifest.js";
import {
  composeTuyaOfficeOverviewAiReadModel,
  createTuyaOfficeProjectOverviewAiAdapter,
} from "./energy/tuya-office-overview-ai-adapter.js";
import { requireTuyaOfficeAiSurfaceForIdentity } from "./energy/tuya-office-ai-surface.js";
import {
  createTuyaOfficeOverviewAiWorkflow,
  isTuyaOfficeOverviewAiGenerationTerminal,
  requireTuyaOfficeAdditionalInsightsReady,
} from "./energy/tuya-office-overview-ai-workflow.js";
import {
  createPreschoolAdditionalAiInsightsEvaluationWorkflow,
  MAX_PRESCHOOL_ADDITIONAL_TRANSITION_PROMPT_CHARS,
  PRESCHOOL_ADDITIONAL_AI_STRUCTURED_OUTPUT_ROOT_INVALID,
  PRESCHOOL_ADDITIONAL_AI_STRUCTURED_OUTPUT_SCHEMA_INVALID,
} from "./energy/preschool-additional-ai-insights-evaluation.js";
import {
  createPreschoolAdditionalAiInsightsWorkflow,
  createPreschoolAdditionalAiPresentedClaims,
  MAX_PRESCHOOL_ADDITIONAL_DISCOVERY_PROMPT_CHARS,
} from "./energy/preschool-additional-ai-insights-workflow.js";
import { composePreschoolOverviewAiReadModel } from "./energy/preschool-overview-ai-read-model.js";
import { resolveWorkspaceDefaultModelProfileSnapshot } from "./workspace-model-profile-resolver.js";
import {
  createNgeeAnnAdditionalAiInsightArtifactIdentity,
  createTuyaOfficeAdditionalAiInsightArtifactIdentity,
  isCurrentProjectAdditionalAiInsightArtifactIdentity,
  isCurrentPreschoolAdditionalAiInsightArtifactIdentity,
  overviewAiArtifactPinnedLocalPeriod,
  projectCurrentOverviewAiArtifactBaseIdentity,
} from "./energy/overview-ai-artifact.js";
import { MAX_PRESCHOOL_EXECUTIVE_PROMPT_CHARS } from "./energy/preschool-executive-synthesis.js";
import type {
  PreschoolSectionInsightToolInvocation,
  PreschoolSectionInsightToolName,
  PreschoolSectionInsightToolResult,
} from "./energy/preschool-section-insight-runtime.js";
import type {
  PreschoolAdditionalAiInsightToolInvocation,
  PreschoolAdditionalAiInsightToolName,
  PreschoolAdditionalAiInsightToolResult,
} from "./energy/preschool-additional-ai-insight-runtime.js";
import { createEnergyIqTemplateChangeWorkflow } from "./energy/energy-template-change-workflow.js";
import { createEnergyTuyaDailyScheduler } from "./energy/energy-tuya-scheduler.js";
import {
  createEnergyLiveConnectionScheduler,
  registerEnergyLiveConnectionScheduler,
} from "./energy/energy-live-connection-scheduler.js";
import { createTuyaOpenApiClientFor, createTuyaOpenApiClientFromEnv } from "./energy/tuya-openapi-client.js";
import { resolveEnergyTuyaProjectConnector } from "./energy/energy-tuya-connector.js";
import type { ConfigApiContext } from "./routes/types.js";
import { resolveOverviewAiStageStructuredOutput } from "./energy/preschool-overview-ai-structured-output.js";
import { collectAdditionalAiInsightSubmission } from "./energy/additional-ai-insight-submission.js";
import { bindGracefulServerLifecycle } from "./server-lifecycle.js";
import {
  MAX_PRESCHOOL_HTML_AI_SLOT_PROMPT_CHARS,
  type PreschoolHtmlAiSlotRunner,
} from "./energy/preschool-html-ai-slot.js";
import { createPreschoolHtmlAiSlotWorkflow } from "./energy/preschool-html-ai-slot-workflow.js";
export { resolveOverviewAiStageStructuredOutput } from "./energy/preschool-overview-ai-structured-output.js";

type OverviewAiRuntimeStageInput = Omit<PreschoolOverviewAiStageInput, "stage"> & {
  stage: PreschoolOverviewAiStage;
  /** Exact profile resource reserved by the server for evaluation recovery. */
  modelProfileSnapshot?: EnergyIqAdditionalInsightModelProfileSnapshot;
  /** Server-owned only; never read from AG-UI forwarded props. */
  trustedRuntimeOverride?: OverviewAiTrustedRuntimeOverride;
};

export const resolveOverviewAiArtifactSessionScope = (input: {
  identity: EnergyIqOverviewAiArtifactIdentity;
  workspaceId: string;
}): { projectId: string; workspaceId: string } => {
  if (input.identity.workspaceId !== input.workspaceId) {
    throw new Error("OVERVIEW_AI_RUNTIME_WORKSPACE_MISMATCH");
  }
  return {
    workspaceId: input.identity.workspaceId,
    projectId: input.identity.projectId,
  };
};

type OverviewAiStructuredOutput = NonNullable<ReturnType<typeof resolveOverviewAiStageStructuredOutput>>;

type OverviewAiTrustedRuntimeOverride = {
  structuredOutput?: OverviewAiStructuredOutput | undefined;
  conversationMessageMaxChars: number;
  runTimeoutMs?: number;
  additionalAiInsightSubmission?: true;
  disableTools?: false;
  trustedStageTools?: CreateDataFoundryInput["trustedStageTools"];
  trustedStageCapability?: CreateDataFoundryInput["trustedStageCapability"];
};

const PACK_V2_SECTION_MESSAGE_MAX_CHARS = 110_000;
const PRESCHOOL_ADDITIONAL_DISCOVERY_RUN_TIMEOUT_MS = 120_000;

const DEV_USER: MeResponse = {
  id: "dev-user",
  email: "admin@energyiq.local",
  display_name: "EnergyIQ Admin"
};

const COPILOTKIT_PATH = "/api/copilotkit";
const DEFAULT_WORKSPACE_ID = "default";
const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const BUILTIN_SKILL_ROOT = join(SERVER_DIR, "../../../packages/skills/builtin");
const skillCacheSignatures = new Map<string, string>();
const legacyDemoRemovedUsers = new Set<string>();
/** Set true only after createServer finishes required init (Mastra + builtins). */
let serverReady = false;
let startupTimings: Record<string, number> = {};
let startupTotalMs = 0;

export const resolveOverviewAiStageRuntimeOptions = (stage: PreschoolOverviewAiStage) => {
  const structuredOutput = resolveOverviewAiStageStructuredOutput(stage);
  const boundedValueStage = stage === "section-interpreter"
    || stage === "executive-synthesis"
    || stage === "template-proposal"
    || stage === "additional-insights-discovery"
    || stage === "additional-insights-transition"
    || stage === "html-slot";
  return {
    analysisRequirementsMode: "omit" as const,
    ...(boundedValueStage
      ? {
          conversationMessageMaxChars: stage === "section-interpreter"
            ? 12_000
            : stage === "html-slot"
              ? MAX_PRESCHOOL_HTML_AI_SLOT_PROMPT_CHARS
              : 24_000,
          disableTools: true as const,
        }
      : {}),
    excludedToolNames: boundedValueStage
      ? ["skill", "skill_search", "skill_read", "inspect_schema", "run_sql_readonly", "protocol_handoff"] as const
      : stage === "editor"
        ? ["inspect_schema", "run_sql_readonly", "protocol_handoff"] as const
        : ["protocol_handoff"] as const,
    overviewAiCandidateSubmission: stage === "investigator",
    reasoningModel: false as const,
    ...(structuredOutput ? { structuredOutput } : {}),
  };
};

export const resolveOverviewAiServerRunnerOptions = (input: {
  stage: PreschoolOverviewAiStage;
  identity?: EnergyIqOverviewAiArtifactIdentity;
  structuredOutput?: OverviewAiStructuredOutput;
  sectionInsightTools?: readonly PreschoolSectionInsightToolName[];
  invokeSectionInsightTool?: (
    invocation: PreschoolSectionInsightToolInvocation,
  ) => Promise<PreschoolSectionInsightToolResult>;
  additionalInsightTools?: readonly PreschoolAdditionalAiInsightToolName[];
  invokeAdditionalInsightTool?: (
    invocation: PreschoolAdditionalAiInsightToolInvocation,
  ) => Promise<PreschoolAdditionalAiInsightToolResult>;
}): OverviewAiTrustedRuntimeOverride | undefined => {
  if ((input.stage !== "section-interpreter"
      && input.stage !== "executive-synthesis"
      && input.stage !== "additional-insights-discovery"
      && input.stage !== "additional-insights-transition")
    || !input.structuredOutput) return undefined;
  const nativeAdditionalSubmission = input.stage === "additional-insights-discovery"
    && input.identity !== undefined
    && isCurrentPreschoolAdditionalAiInsightArtifactIdentity(input.identity);
  const trustedStageTools = input.stage === "section-interpreter"
    && input.sectionInsightTools && input.invokeSectionInsightTool
    ? createPreschoolSectionTrustedStageTools({
        toolNames: input.sectionInsightTools,
        invoke: input.invokeSectionInsightTool,
      })
    : input.stage === "additional-insights-discovery"
      && input.additionalInsightTools && input.invokeAdditionalInsightTool
      ? createPreschoolAdditionalAiInsightTrustedStageTools({
          toolNames: input.additionalInsightTools,
          invoke: input.invokeAdditionalInsightTool,
        })
    : undefined;
  return {
    structuredOutput: nativeAdditionalSubmission ? undefined : input.structuredOutput,
    conversationMessageMaxChars: input.stage === "section-interpreter"
      ? input.identity?.rendererKey === "ngee-ann-overview"
        && input.identity.identityContractRevision === "ngee-ann-section-v16"
        ? NGEE_ANN_SECTION_MESSAGE_MAX_CHARS
        : PACK_V2_SECTION_MESSAGE_MAX_CHARS
      : input.stage === "additional-insights-discovery"
        ? MAX_PRESCHOOL_ADDITIONAL_DISCOVERY_PROMPT_CHARS
        : input.stage === "additional-insights-transition"
          ? MAX_PRESCHOOL_ADDITIONAL_TRANSITION_PROMPT_CHARS
        : MAX_PRESCHOOL_EXECUTIVE_PROMPT_CHARS,
    ...(trustedStageTools
      ? {
          disableTools: false as const,
          trustedStageTools,
          ...(input.stage === "additional-insights-discovery"
            && input.identity
            && isCurrentProjectAdditionalAiInsightArtifactIdentity(input.identity)
            ? { trustedStageCapability: "energyiq-additional-insight-discovery" as const }
            : {}),
          ...(nativeAdditionalSubmission
            ? { additionalAiInsightSubmission: true as const }
            : {}),
        }
      : {}),
    ...(nativeAdditionalSubmission
      ? { runTimeoutMs: PRESCHOOL_ADDITIONAL_DISCOVERY_RUN_TIMEOUT_MS }
      : {}),
    ...(input.stage === "additional-insights-transition"
      && input.identity
      && isCurrentPreschoolAdditionalAiInsightArtifactIdentity(input.identity)
      ? { trustedStageCapability: "energyiq-additional-insight-transition" as const }
      : {}),
  };
};

export const createPreschoolSectionTrustedStageTools = (input: {
  toolNames: readonly PreschoolSectionInsightToolName[];
  invoke(invocation: PreschoolSectionInsightToolInvocation): Promise<PreschoolSectionInsightToolResult>;
}): NonNullable<CreateDataFoundryInput["trustedStageTools"]> => Object.fromEntries(
  input.toolNames.map((toolName) => [toolName, preschoolSectionTrustedStageTool(toolName, input.invoke)]),
) as unknown as NonNullable<CreateDataFoundryInput["trustedStageTools"]>;

export const createPreschoolAdditionalAiInsightTrustedStageTools = (input: {
  toolNames: readonly PreschoolAdditionalAiInsightToolName[];
  invoke(invocation: PreschoolAdditionalAiInsightToolInvocation): Promise<PreschoolAdditionalAiInsightToolResult>;
}): NonNullable<CreateDataFoundryInput["trustedStageTools"]> => Object.fromEntries(
  input.toolNames.map((toolName) => [toolName, preschoolAdditionalAiInsightTrustedStageTool(toolName, input.invoke)]),
) as unknown as NonNullable<CreateDataFoundryInput["trustedStageTools"]>;

const preschoolAdditionalAiInsightTrustedStageTool = (
  toolName: PreschoolAdditionalAiInsightToolName,
  invoke: (invocation: PreschoolAdditionalAiInsightToolInvocation) => Promise<PreschoolAdditionalAiInsightToolResult>,
) => {
  const execute = (controlledInput: unknown, options: unknown) => {
    const toolCallId = isServerRecord(options)
      && isServerRecord(options.agent)
      && typeof options.agent.toolCallId === "string"
      && options.agent.toolCallId.trim()
      ? options.agent.toolCallId
      : null;
    if (!toolCallId) throw new Error("PRESCHOOL_ADDITIONAL_AI_TOOL_CALL_ID_REQUIRED");
    return invoke({ toolName, toolCallId, input: controlledInput });
  };
  const factIds = z.object({ factIds: z.array(z.string().min(1)).min(1) }).strict();
  return createTool({
    id: toolName,
    description: additionalInsightToolDescription(toolName),
    inputSchema: toolName === "energy.project-knowledge.read"
      ? z.object({ knowledgeIds: z.array(z.string().min(1)).min(1) }).strict()
      : factIds,
    execute,
  });
};

const additionalInsightToolDescription = (toolName: PreschoolAdditionalAiInsightToolName): string => ({
  "energy.evidence.read": "Read selected typed facts from the current server-owned Evidence Catalog.",
  "energy.metrics.compare": "Compare selected numeric facts from the current server-owned Evidence Catalog.",
  "energy.timeseries.analyze": "Inspect selected time-pattern facts from the current server-owned Evidence Catalog.",
  "energy.snapshot-history.read": "Read only server-approved Snapshot history facts when that source is available.",
  "energy.project-knowledge.read": "Read only server-approved project knowledge entries when that source is available.",
})[toolName];

const preschoolSectionTrustedStageTool = (
  toolName: PreschoolSectionInsightToolName,
  invoke: (invocation: PreschoolSectionInsightToolInvocation) => Promise<PreschoolSectionInsightToolResult>,
) => {
  const execute = (controlledInput: unknown, options: unknown) => {
    const toolCallId = isServerRecord(options)
      && isServerRecord(options.agent)
      && typeof options.agent.toolCallId === "string"
      && options.agent.toolCallId.trim()
      ? options.agent.toolCallId
      : null;
    if (!toolCallId) throw new Error("PRESCHOOL_SECTION_INSIGHT_TOOL_CALL_ID_REQUIRED");
    return invoke({ toolName, toolCallId, input: controlledInput } as PreschoolSectionInsightToolInvocation);
  };
  if (toolName === "compare_centres") {
    return createTool({
      id: toolName,
      description: "Compare selected Centres using only requested allowlisted benchmark dimensions from the current Section Pack.",
      inputSchema: z.object({
        centreScopeIds: z.array(z.string().min(1)).min(1),
        dimensions: z.array(z.enum(["absoluteUsage", "floorAreaNormalised", "peopleNormalised"])).min(1),
      }).strict(),
      execute,
    });
  }
  if (toolName === "inspect_related_section_signals") {
    return createTool({
      id: toolName,
      description: "Inspect selected allowlisted cross-Section signals from the current server-owned Pack.",
      inputSchema: z.object({ signalIds: z.array(z.string().min(1)).min(1) }).strict(),
      execute,
    });
  }
  return createTool({
    id: toolName,
    description: toolName === "inspect_time_pattern"
      ? "Inspect selected time-pattern Evidence from the current server-owned Section Pack."
      : "Inspect selected load-composition Evidence from the current server-owned Section Pack.",
    inputSchema: z.object({ evidenceIds: z.array(z.string().min(1)).min(1) }).strict(),
    execute,
  });
};

const isServerRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const resolveOverviewAiAgentRuntimeOptions = (
  stage: PreschoolOverviewAiStage,
  trustedOverride?: OverviewAiTrustedRuntimeOverride,
): {
  analysisRequirementsMode: "omit";
  conversationMessageMaxChars?: number;
  disableTools?: boolean;
  excludedToolNames: readonly string[];
  overviewAiCandidateSubmission: boolean;
  additionalAiInsightSubmission?: boolean;
  reasoningModel: false;
  runTimeoutMs?: number;
  structuredOutput?: OverviewAiStructuredOutput | undefined;
  trustedStageTools?: CreateDataFoundryInput["trustedStageTools"];
  trustedStageCapability?: CreateDataFoundryInput["trustedStageCapability"];
} => ({
  ...resolveOverviewAiStageRuntimeOptions(stage),
  ...(trustedOverride ?? {}),
});

export const shouldIncludeProjectAnalysisEvidenceContext = (
  stage?: PreschoolOverviewAiStage,
): boolean => stage === undefined;

const OPTIONAL_OVERVIEW_EVIDENCE_UNAVAILABLE = new Set([
  "ENERGYIQ_OVERVIEW_PROJECTION_NOT_MATERIALIZED",
  "ENERGYIQ_DATA_SNAPSHOT_MISMATCH",
  "ENERGYIQ_PROJECT_RELEASE_MISMATCH",
  "ENERGYIQ_CURRENT_OVERVIEW_WINDOW_MISMATCH",
]);

const isOptionalOverviewEvidenceUnavailable = (error: unknown): boolean => (
  error instanceof Error && OPTIONAL_OVERVIEW_EVIDENCE_UNAVAILABLE.has(error.message)
);

export const shouldUseEnergyContextForOverviewAiStage = (
  stage?: PreschoolOverviewAiStage,
): boolean => stage !== "executive-synthesis"
  && stage !== "template-proposal"
  && stage !== "additional-insights-transition"
  && stage !== "html-slot";

const emitEarlyRunFailure = (
  subscriber: { complete(): void; next(event: BaseEvent): void },
  runId: string,
  message: string,
  durable: boolean,
): void => {
  const timestamp = Date.now();
  if (!durable) {
    subscriber.next({ type: EventType.RUN_ERROR, message, timestamp });
    subscriber.complete();
    return;
  }
  subscriber.next({ type: EventType.RUN_STARTED, runId, timestamp });
  subscriber.next(createRunStatusDelta("failed", { errorMessage: message, runId }));
  subscriber.next(withRunTerminalIdentity(
    { type: EventType.RUN_ERROR, message, timestamp },
    { kind: "durable", runId, status: "failed" },
  ));
  subscriber.complete();
};

const transitionEarlyRunFailure = (input: {
  energySessionScope?: {
    projectId: string;
    workspaceId: string;
  };
  errorMessage: string;
  isResume: boolean;
  metadataStore: MetadataStore;
  runId: string;
  runInput: RunAgentInput;
  sessionId: string;
  userId: string;
  userInput: string;
}): boolean => {
  if (input.isResume) {
    return input.metadataStore.runs.failSuspended({
      user_id: input.userId,
      run_id: input.runId,
      session_id: input.sessionId,
      error_message: input.errorMessage,
    }) !== undefined;
  }
  if (
    !input.userInput.trim()
    || input.errorMessage.startsWith("ENERGYIQ_SESSION_CONTEXT_")
  ) {
    return false;
  }
  let transitioned = false;
  try {
    input.metadataStore.sessions.create({
      user_id: input.userId,
      id: input.sessionId,
      ...(input.energySessionScope
        ? {
            workspace_id: input.energySessionScope.workspaceId,
            project_id: input.energySessionScope.projectId
          }
        : {})
    });
    const claim = input.metadataStore.runs.claim({
      user_id: input.userId,
      id: input.runId,
      session_id: input.sessionId,
      user_input: input.userInput,
      status: "running",
      model_name: "unresolved"
    });
    if (!claim.created) return false;
    transitioned = input.metadataStore.runs.finishActive({
      user_id: input.userId,
      run_id: input.runId,
      session_id: input.sessionId,
      status: "failed",
      error_message: input.errorMessage
    }) !== undefined;
    if (!transitioned) return false;
  } catch (error) {
    console.warn("[data-foundry] failed to transition early Run failure", error);
    return false;
  }
  try {
    const record = persistCurrentUserMessage({
      currentUserText: input.userInput,
      repository: input.metadataStore.conversationMessages,
      runId: input.runId,
      runInput: input.runInput,
      sessionId: input.sessionId,
      userId: input.userId
    });
    input.metadataStore.sessions.touchLastMessage({
      user_id: input.userId,
      session_id: input.sessionId,
      last_message_at: record.created_at
    });
  } catch (error) {
    // The Run transition is authoritative; conversation history is auxiliary.
    console.warn("[data-foundry] failed to persist early failed user message", error);
  }
  return transitioned;
};

const persistClaimedEnergyPreparation = (input: {
  metadataStore: MetadataStore;
  runId: string;
  sessionId: string;
  trace: EnergyRunPreparationTrace | undefined;
  userId: string;
}): void => {
  if (!input.trace || !input.metadataStore.runs.find({
    user_id: input.userId,
    run_id: input.runId,
  })) {
    return;
  }
  try {
    const writer = new RunEventWriter(input.metadataStore.runEvents);
    input.trace.attachPersistence((event) => {
      writer.write({
        user_id: input.userId,
        run_id: input.runId,
        session_id: input.sessionId,
        event,
      });
    });
  } catch (error) {
    // Preparation evidence is diagnostic; never hide the original terminal error.
    console.warn("[data-foundry] failed to persist early Energy preparation", error);
  }
};

export type CreateServerOptions = {
  conversationMemoryMode?: AgentMemoryMode | undefined;
  memoryExtractionTimeoutMs?: number | undefined;
  metadataStore?: MetadataStore;
  taskStateRuntime?: TaskStateRuntime;
  traceSectionSummaries?: boolean;
};

const gracefulServerClosers = new WeakMap<Server, () => Promise<void>>();

export const closeServerGracefully = async (server: Server): Promise<void> => {
  const close = gracefulServerClosers.get(server);
  if (close) {
    await close();
    return;
  }
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
};

export const shouldPrepareBuiltinConfigResourcesForRequest = (
  method: string | undefined,
): boolean => isUnsafeMethod(method);

export const resolveConfigApiRequestPreflight = (input: {
  request: IncomingMessage;
  metadataStore: MetadataStore;
  authConfig: PasswordAuthConfig;
  authService: AuthService;
}): { authContext: RequestAuthContext; prepareBuiltinResources: boolean } => {
  const authContext = resolveRequestAuth(
    input.request,
    input.metadataStore,
    input.authConfig,
    input.authService,
  );
  if (isPasswordAuth(input.authConfig) && isUnsafeMethod(input.request.method)) {
    input.authService.validateCsrf(
      authContext.identity,
      headerString(input.request.headers["x-csrf-token"]),
    );
  }
  return {
    authContext,
    prepareBuiltinResources: shouldPrepareBuiltinConfigResourcesForRequest(input.request.method),
  };
};

export const createServer = async (options: CreateServerOptions = {}): Promise<Server> => {
  const timer = createStartupTimer();
  serverReady = false;

  const envConfig = createEnvConfig(process.env);
  const authConfig = loadPasswordAuthConfig(process.env);
  const conversationMemoryMode =
    options.conversationMemoryMode
    ?? parseAgentMemoryMode(process.env.MASTRA_CONVERSATION_MEMORY_MODE, "working-memory-readonly");
  const metadataStore = await timer.measure("metadata_store", () =>
    options.metadataStore ??
    createMetadataStore({
      database_path: process.env.METADATA_DB_PATH ?? join(envConfig.storage.root_dir, "metadata", "workbench.sqlite"),
      ...(envConfig.storage.secret_master_key ? { secret_master_key: envConfig.storage.secret_master_key } : {}),
      dev_user: {
        id: DEV_USER.id,
        email: DEV_USER.email ?? "admin@energyiq.local",
        display_name: DEV_USER.display_name ?? "EnergyIQ Admin",
        dev_token: "dev-token"
      }
    }),
  );
  const fileAssetService = new LocalFileAssetService(metadataStore, {
    storageRoot: process.env.FILE_ASSET_STORAGE_ROOT ?? join(envConfig.storage.root_dir, "files")
  });
  const dataGateway = new LocalDataGateway(metadataStore, {
    defaultLimit: envConfig.sql.default_limit,
    maxLimit: envConfig.sql.max_limit,
    timeoutMs: envConfig.sql.timeout_ms,
    workspaceId: DEFAULT_WORKSPACE_ID
  }, fileAssetService);
  const artifactService = new LocalArtifactService(metadataStore, fileAssetService);
  const reportService = process.env.ENERGYIQ_REPORT_AGENT_ENABLED === "true" ? new ReportService({
    maxConcurrent: Number(process.env.ENERGYIQ_REPORT_MAX_CONCURRENT ?? 1),
    maxPerUser: Number(process.env.ENERGYIQ_REPORT_MAX_PER_USER ?? 1),
    resolveScheduledSkills: settings => resolveReportSkillSelection(settings, reportSkillCatalog({ metadataStore, workspaceId: settings.workspaceId, userId: settings.actorUserId }, settings, true)),
    metadata: metadataStore, files: fileAssetService, dataGateway, root: join(envConfig.storage.root_dir, "report-agent"),
    projectLifecycle: run => {
      const context = {authService, dataGateway, fileAssetService, knowledgeService, metadataStore,
        additionalAiInsightsWorkflow, additionalAiInsightsEvaluationWorkflow, overviewAiWorkflow,
        preschoolHtmlAiSlotWorkflow, projectOverviewAiAdapters: [ngeeAnnOverviewAiAdapter, tuyaOfficeOverviewAiAdapter],
        templateChangeWorkflow, runCancelRegistry, userId: run.actorUserId, workspaceId: run.workspaceId};
      return {materialize: batchId => materializeAgentProjectSource(context, run.projectId, batchId),
        publish: revisions => publishAgentProjectSetup(context, run.projectId, revisions)};
    },
    harness: (process.env.ENERGYIQ_REPORT_AGENT_HARNESS ?? "pi") === "pi" ? createPiReportHarness({
      image: process.env.ENERGYIQ_REPORT_AGENT_IMAGE ?? "energyiq-report-agent:pi-review-20260913",
      model: () => resolvePiReportModel(metadataStore),
    }) : async () => { throw new Error("REPORT_HARNESS_NOT_CONFIGURED"); },
  }) : undefined;
  if (reportService) registerReportService(metadataStore, reportService);
  const sessionOutputService = new SessionOutputService(metadataStore, fileAssetService);
  const knowledgeService = new LocalKnowledgeService(metadataStore, {
    embedding: {
      provider: envConfig.embedding.provider,
      model: envConfig.embedding.model,
      base_url: envConfig.embedding.base_url,
      ...(envConfig.embedding.api_key ? { api_key: envConfig.embedding.api_key } : {})
    }
  });
  const ownsTaskStateRuntime = options.taskStateRuntime === undefined;
  // Mastra init and builtin skill materialization are independent — overlap them.
  const taskStateRuntimePromise =
    options.taskStateRuntime
    ?? createTaskStateRuntime(
      process.env.MASTRA_STORAGE_PATH ?? join(envConfig.storage.root_dir, "mastra", "agent-state.sqlite"),
      { conversationMemoryMode }
    );
  const runCancelRegistry = new RunCancelRegistry();
  const authService = new AuthService(metadataStore, authConfig);
  ensureDevUser(metadataStore);
  ensureEnergyIqBootstrap(metadataStore);
  removeLegacyBuiltinDemoDataSourceOnce(metadataStore, DEV_USER.id);

  const [taskStateRuntime] = await Promise.all([
    timer.measure("mastra_runtime", () => taskStateRuntimePromise),
    timer.measure("builtin_resources", () =>
      ensureBuiltinConfigResourcesOnce(fileAssetService, metadataStore, DEV_USER.id, DEFAULT_WORKSPACE_ID),
    ),
  ]);

  const runOverviewAiValueStage = async (stageInput: OverviewAiRuntimeStageInput) => {
    const startedAt = Date.now();
    const completed = await collectOverviewAiStageEvents(
      new DataFoundryAgUiAgent({
        dataGateway,
        artifactService,
        sessionOutputService,
        fileAssetService,
        conversationMemoryMode: stageInput.stage === "html-slot" ? "off" : conversationMemoryMode,
        knowledgeService,
        memoryExtractionTimeoutMs: options.memoryExtractionTimeoutMs
          ?? envConfig.memory.completed_extraction_timeout_ms,
        metadataStore,
        runCancelRegistry,
        taskStateRuntime,
        traceSectionSummaries: options.traceSectionSummaries !== false,
        user: {
          id: stageInput.user.id,
          ...(stageInput.user.email ? { email: stageInput.user.email } : {}),
          ...(stageInput.user.display_name ? { display_name: stageInput.user.display_name } : {}),
        },
        overviewAiStage: stageInput.stage,
        ...(stageInput.modelProfileSnapshot
          ? { trustedModelProfileSnapshot: stageInput.modelProfileSnapshot }
          : {}),
        ...(stageInput.trustedRuntimeOverride
          ? { overviewAiTrustedRuntimeOverride: stageInput.trustedRuntimeOverride }
          : {}),
        trustedEnergySessionScope: resolveOverviewAiArtifactSessionScope({
          identity: stageInput.identity,
          workspaceId: stageInput.workspaceId,
        }),
        workspaceId: stageInput.workspaceId,
        workspaceRoot: process.env.WORKSPACE_ROOT ?? join(process.env.STORAGE_ROOT_DIR ?? "storage", "workspaces"),
        ...(stageInput.stage === "html-slot"
          ? { completedMemoryFlushOverride: async () => undefined }
          : {}),
      }),
      stageInput,
      metadataStore,
    );
    return {
      answer: collectOverviewAiValueStageAnswer(
        completed.events,
        stageInput.stage,
        stageInput.trustedRuntimeOverride?.additionalAiInsightSubmission === true,
      ),
      runId: completed.completedRun.runId,
      sessionId: completed.completedRun.sessionId,
      latencyMs: Math.max(0, Date.now() - startedAt),
      ...overviewAiTokenUsage(completed.events),
    };
  };
  const overviewAiWorkflow = createPreschoolOverviewAiPageWorkflow({
    metadataStore,
    dataGateway,
    runSection: ({
      structuredOutput,
      sectionInsightTools,
      invokeSectionInsightTool,
      ...stageInput
    }) => {
      const trustedRuntimeOverride = resolveOverviewAiServerRunnerOptions({
        stage: "section-interpreter",
        ...(structuredOutput ? { structuredOutput } : {}),
        ...(sectionInsightTools ? { sectionInsightTools } : {}),
        ...(invokeSectionInsightTool ? { invokeSectionInsightTool } : {}),
      });
      return runOverviewAiValueStage({
        ...stageInput,
        stage: "section-interpreter",
        ...(trustedRuntimeOverride ? { trustedRuntimeOverride } : {}),
      });
    },
    runExecutiveSynthesis: ({ structuredOutput, ...stageInput }) => {
      const trustedRuntimeOverride = resolveOverviewAiServerRunnerOptions({
        stage: "executive-synthesis",
        ...(structuredOutput ? { structuredOutput } : {}),
      });
      return runOverviewAiValueStage({
        ...stageInput,
        stage: "executive-synthesis",
        ...(trustedRuntimeOverride ? { trustedRuntimeOverride } : {}),
      });
    },
  });
  const runPreschoolHtmlAiSlot: PreschoolHtmlAiSlotRunner = async (stageInput) => {
    const identity = stageInput.runtimeIdentity;
    return runOverviewAiValueStage({
      ...stageInput,
      stage: "html-slot",
      identity,
    });
  };
  const preschoolHtmlAiSlotWorkflow = createPreschoolHtmlAiSlotWorkflow({
    metadataStore,
    dataGateway,
    runSlot: runPreschoolHtmlAiSlot,
  });
  const ngeeAnnOverviewAiWorkflow = createNgeeAnnOverviewAiWorkflow({
    metadataStore,
    dataGateway,
    runSection: ({ structuredOutput, ...stageInput }) => {
      const trustedRuntimeOverride = resolveOverviewAiServerRunnerOptions({
        stage: "section-interpreter",
        structuredOutput,
      });
      return runOverviewAiValueStage({
        ...stageInput,
        stage: "section-interpreter",
        ...(trustedRuntimeOverride ? { trustedRuntimeOverride } : {}),
      });
    },
    runExecutive: ({ structuredOutput, ...stageInput }) => {
      const trustedRuntimeOverride = resolveOverviewAiServerRunnerOptions({
        stage: "executive-synthesis",
        structuredOutput,
      });
      return runOverviewAiValueStage({
        ...stageInput,
        stage: "executive-synthesis",
        ...(trustedRuntimeOverride ? { trustedRuntimeOverride } : {}),
      });
    },
  });
  const tuyaOfficeOverviewAiWorkflow = createTuyaOfficeOverviewAiWorkflow({
    metadataStore,
    dataGateway,
    runSection: ({ structuredOutput, ...stageInput }) => {
      const trustedRuntimeOverride = resolveOverviewAiServerRunnerOptions({
        stage: "section-interpreter",
        structuredOutput,
      });
      return runOverviewAiValueStage({
        ...stageInput,
        stage: "section-interpreter",
        ...(trustedRuntimeOverride ? { trustedRuntimeOverride } : {}),
      });
    },
    runExecutive: ({ structuredOutput, ...stageInput }) => {
      const trustedRuntimeOverride = resolveOverviewAiServerRunnerOptions({
        stage: "executive-synthesis",
        structuredOutput,
      });
      return runOverviewAiValueStage({
        ...stageInput,
        stage: "executive-synthesis",
        ...(trustedRuntimeOverride ? { trustedRuntimeOverride } : {}),
      });
    },
  });
  const additionalAiInsightsWorkflow = createPreschoolAdditionalAiInsightsWorkflow({
    metadataStore,
    resolveEvidenceCatalog: async ({ identity, user }) => {
      const project = metadataStore.energyIq.getProject(identity.projectId);
      const period = overviewAiArtifactPinnedLocalPeriod({ identity, timezone: project.timezone });
      const projection = await readCurrentProjectOverviewProjection({
        metadataStore,
        dataGateway,
        user,
        workspaceId: identity.workspaceId,
        projectId: identity.projectId,
        expectedFrom: period.from,
        expectedTo: period.to,
        expectedDataSnapshotId: identity.dataSnapshotId,
        expectedProjectReleaseId: identity.projectReleaseId,
      });
      return createProjectAnalysisContextEvidenceCatalog(projection.contextPackage.snapshot);
    },
    resolvePresentedClaims: async ({ identity, catalog }) => createPreschoolAdditionalAiPresentedClaims({
      identity,
      catalog,
      readModel: composePreschoolOverviewAiReadModel({
        metadataStore,
        baseIdentity: identity,
      }),
    }),
    runDiscovery: ({ toolNames, invokeTool, ...stageInput }) => {
      const structuredOutput = resolveOverviewAiStageStructuredOutput("additional-insights-discovery");
      if (!structuredOutput) throw new Error("PRESCHOOL_ADDITIONAL_AI_STRUCTURED_OUTPUT_REQUIRED");
      const trustedRuntimeOverride = resolveOverviewAiServerRunnerOptions({
        stage: "additional-insights-discovery",
        identity: stageInput.identity,
        structuredOutput,
        additionalInsightTools: toolNames,
        invokeAdditionalInsightTool: invokeTool,
      });
      return runOverviewAiValueStage({
        ...stageInput,
        stage: "additional-insights-discovery",
        ...(trustedRuntimeOverride ? { trustedRuntimeOverride } : {}),
      });
    },
  });
  const ngeeAnnAdditionalAiInsightsWorkflow = createPreschoolAdditionalAiInsightsWorkflow({
    metadataStore,
    createArtifactIdentity: createNgeeAnnAdditionalAiInsightArtifactIdentity,
    discoveryContext: {
      productLabel: "EnergyX Ngee Ann campus energy Overview",
      entityGuidance: "the cited campus Levels, Circuits, loads, and operating-time patterns",
      runPrefix: "ngee-ann-additional-ai-insights",
    },
    resolveEvidenceCatalog: async ({ identity, user }) => {
      const project = metadataStore.energyIq.getProject(identity.projectId);
      const period = overviewAiArtifactPinnedLocalPeriod({ identity, timezone: project.timezone });
      const projection = await readCurrentProjectOverviewProjection({
        metadataStore,
        dataGateway,
        user,
        workspaceId: identity.workspaceId,
        projectId: identity.projectId,
        expectedFrom: period.from,
        expectedTo: period.to,
        expectedDataSnapshotId: identity.dataSnapshotId,
        expectedProjectReleaseId: identity.projectReleaseId,
      });
      return createProjectAnalysisContextEvidenceCatalog(projection.contextPackage.snapshot);
    },
    resolvePresentedClaims: async ({ identity, catalog }) => createPreschoolAdditionalAiPresentedClaims({
      identity,
      catalog,
      readModel: composeNgeeAnnOverviewAiReadModel({
        metadataStore,
        baseIdentity: projectCurrentOverviewAiArtifactBaseIdentity(identity),
      }),
    }),
    runDiscovery: ({ toolNames, invokeTool, ...stageInput }) => {
      const structuredOutput = resolveOverviewAiStageStructuredOutput("additional-insights-discovery");
      if (!structuredOutput) throw new Error("PROJECT_ADDITIONAL_AI_STRUCTURED_OUTPUT_REQUIRED");
      const trustedRuntimeOverride = resolveOverviewAiServerRunnerOptions({
        stage: "additional-insights-discovery",
        identity: stageInput.identity,
        structuredOutput,
        additionalInsightTools: toolNames,
        invokeAdditionalInsightTool: invokeTool,
      });
      return runOverviewAiValueStage({
        ...stageInput,
        stage: "additional-insights-discovery",
        ...(trustedRuntimeOverride ? { trustedRuntimeOverride } : {}),
      });
    },
  });
  const ngeeAnnOverviewAiAdapter = createNgeeAnnProjectOverviewAiAdapter({
    metadataStore,
    dataGateway,
    async executeMissing({ identity, user, retryTarget }) {
      const modelProfileSnapshot = resolveWorkspaceDefaultModelProfileSnapshot(metadataStore);
      const sectionIds = resolveNgeeAnnSectionManifestForRelease(
        metadataStore,
        identity.projectReleaseId,
      ).enabledSectionIds;
      if (retryTarget === "additional-insights") {
        requireNgeeAnnAdditionalInsightsReady(composeNgeeAnnOverviewAiReadModel({
          metadataStore,
          baseIdentity: projectCurrentOverviewAiArtifactBaseIdentity(identity),
        }), sectionIds);
        await ngeeAnnAdditionalAiInsightsWorkflow.execute({
          baseIdentity: identity,
          user,
          modelProfileSnapshot,
        });
        return;
      }
      const core = await ngeeAnnOverviewAiWorkflow.execute({
        identity,
        user,
        modelProfileSnapshot,
        ...(retryTarget ? { retryTarget } : {}),
      });
      if (!retryTarget && isNgeeAnnOverviewAiGenerationTerminal(core, sectionIds)) {
        await ngeeAnnAdditionalAiInsightsWorkflow.execute({
          baseIdentity: identity,
          user,
          modelProfileSnapshot,
        });
      }
    },
  });
  const tuyaOfficeAdditionalAiInsightsWorkflow = createPreschoolAdditionalAiInsightsWorkflow({
    metadataStore,
    createArtifactIdentity: (input) => {
      const surface = requireTuyaOfficeAiSurfaceForIdentity(metadataStore, input.baseIdentity);
      if (!surface.additionalInsights) throw new Error("ENERGYIQ_TUYA_OFFICE_AI_SURFACE_DEFINITION_INVALID");
      return createTuyaOfficeAdditionalAiInsightArtifactIdentity({
        ...input,
        unit: surface.additionalInsights,
      });
    },
    findingWindowIds: ["current-overview"],
    discoveryContext: {
      productLabel: "EnergyX Tuya Office energy Overview",
      entityGuidance: "the cited office Spaces, Distribution Boards, Circuits, categories, and operating-time patterns",
      runPrefix: "tuya-office-additional-ai-insights",
    },
    resolveEvidenceCatalog: async ({ identity, user }) => {
      const project = metadataStore.energyIq.getProject(identity.projectId);
      const period = overviewAiArtifactPinnedLocalPeriod({ identity, timezone: project.timezone });
      const projection = await readCurrentProjectOverviewProjection({
        metadataStore,
        dataGateway,
        user,
        workspaceId: identity.workspaceId,
        projectId: identity.projectId,
        expectedFrom: period.from,
        expectedTo: period.to,
        expectedDataSnapshotId: identity.dataSnapshotId,
        expectedProjectReleaseId: identity.projectReleaseId,
      });
      return createProjectAnalysisContextEvidenceCatalog(projection.contextPackage.snapshot);
    },
    resolvePresentedClaims: async ({ identity, catalog }) => createPreschoolAdditionalAiPresentedClaims({
      identity,
      catalog,
      readModel: composeTuyaOfficeOverviewAiReadModel({
        metadataStore,
        baseIdentity: projectCurrentOverviewAiArtifactBaseIdentity(identity),
      }),
    }),
    runDiscovery: ({ toolNames, invokeTool, ...stageInput }) => {
      const structuredOutput = resolveOverviewAiStageStructuredOutput("additional-insights-discovery");
      if (!structuredOutput) throw new Error("PROJECT_ADDITIONAL_AI_STRUCTURED_OUTPUT_REQUIRED");
      const trustedRuntimeOverride = resolveOverviewAiServerRunnerOptions({
        stage: "additional-insights-discovery",
        identity: stageInput.identity,
        structuredOutput,
        additionalInsightTools: toolNames,
        invokeAdditionalInsightTool: invokeTool,
      });
      return runOverviewAiValueStage({
        ...stageInput,
        stage: "additional-insights-discovery",
        ...(trustedRuntimeOverride ? { trustedRuntimeOverride } : {}),
      });
    },
  });
  const tuyaOfficeOverviewAiAdapter = createTuyaOfficeProjectOverviewAiAdapter({
    metadataStore,
    dataGateway,
    async executeMissing({ identity, user, retryTarget }) {
      const modelProfileSnapshot = resolveWorkspaceDefaultModelProfileSnapshot(metadataStore);
      if (retryTarget === "additional-insights") {
        requireTuyaOfficeAdditionalInsightsReady(composeTuyaOfficeOverviewAiReadModel({
          metadataStore,
          baseIdentity: projectCurrentOverviewAiArtifactBaseIdentity(identity),
        }));
        await tuyaOfficeAdditionalAiInsightsWorkflow.execute({
          baseIdentity: identity,
          user,
          modelProfileSnapshot,
        });
        return;
      }
      const core = await tuyaOfficeOverviewAiWorkflow.execute({
        identity,
        user,
        modelProfileSnapshot,
        ...(retryTarget ? { retryTarget } : {}),
      });
      if (!retryTarget && isTuyaOfficeOverviewAiGenerationTerminal(core)) {
        await tuyaOfficeAdditionalAiInsightsWorkflow.execute({
          baseIdentity: identity,
          user,
          modelProfileSnapshot,
        });
      }
    },
  });
  const additionalAiInsightsEvaluationWorkflow = createPreschoolAdditionalAiInsightsEvaluationWorkflow({
    metadataStore,
    runAttempt: (attempt) => additionalAiInsightsWorkflow.evaluateAttempt(attempt),
    runTransition: (stageInput) => {
      const structuredOutput = resolveOverviewAiStageStructuredOutput("additional-insights-transition");
      if (!structuredOutput) throw new Error("PRESCHOOL_ADDITIONAL_TRANSITION_STRUCTURED_OUTPUT_REQUIRED");
      const trustedRuntimeOverride = resolveOverviewAiServerRunnerOptions({
        stage: "additional-insights-transition",
        identity: stageInput.identity,
        structuredOutput,
      });
      return runOverviewAiValueStage({
        ...stageInput,
        stage: "additional-insights-transition",
        workspaceId: stageInput.identity.workspaceId,
        ...(trustedRuntimeOverride ? { trustedRuntimeOverride } : {}),
      });
    },
  });
  const templateChangeWorkflow = createEnergyIqTemplateChangeWorkflow({
    metadataStore,
    resolveIdentity: ({ projectId, scopeId, user }) => overviewAiWorkflow.resolveCurrentIdentity({
      projectId,
      scopeId,
      user,
    }),
    runProposal: (stageInput) => runOverviewAiValueStage({
      ...stageInput,
      stage: "template-proposal",
    }),
  });

  // After restart, cancel-registry is empty — reclaim queued/running rows left by dead workers.
  const reclaimedActiveRuns = await timer.measure("stale_active_run_reclaim", () =>
    reclaimOrphanedQueuedAndRunningRuns({
      metadataStore,
      runCancelRegistry,
    }),
  );
  if (reclaimedActiveRuns > 0) {
    console.log(`[startup] stale active run reclaim: canceled=${reclaimedActiveRuns}`);
  }

  startupTimings = timer.timings();
  startupTotalMs = timer.totalMs();
  serverReady = true;
  console.log(
    `[startup] createServer ready in ${startupTotalMs}ms`,
    JSON.stringify(startupTimings),
  );

  const server = createHttpServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);

      if (request.method === "GET" && requestUrl.pathname === "/healthz") {
        sendJson(response, 200, createSuccessResult({ status: "ok" }));
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/ready") {
        if (!serverReady) {
          sendJson(response, 503, createErrorResult("INTERNAL_ERROR", "Server is still starting."));
          return;
        }
        sendJson(response, 200, createSuccessResult({
          status: "ready",
          startup_ms: startupTotalMs,
          phases: startupTimings,
        }));
        return;
      }

      if (request.method === "OPTIONS" && requestUrl.pathname.startsWith("/api/v1/")) {
        sendCorsPreflight(response);
        return;
      }

      if (isPasswordAuth(authConfig) && requestUrl.pathname.startsWith("/api/v1/auth/")) {
        let identity: AuthIdentity | undefined;
        try {
          identity = resolvePasswordSessionIdentity(authService, request);
        } catch {
          identity = undefined;
        }
        if (await handleAuthApiRequest(request, response, requestUrl.pathname, { authService, ...(identity ? { identity } : {}) })) {
          return;
        }
      }

      const requestPreflight = resolveConfigApiRequestPreflight({
        request,
        metadataStore,
        authConfig,
        authService,
      });
      const { authContext } = requestPreflight;
      if (requestPreflight.prepareBuiltinResources) {
        removeLegacyBuiltinDemoDataSourceOnce(metadataStore, authContext.user.id);
        await ensureBuiltinConfigResourcesOnce(
          fileAssetService,
          metadataStore,
          authContext.user.id,
          authContext.workspaceId,
        );
      }

      const configResponse = await handleConfigApiRequest(request, requestUrl.pathname, {
        authService,
        dataGateway,
        fileAssetService,
        knowledgeService,
        metadataStore,
        additionalAiInsightsWorkflow,
        additionalAiInsightsEvaluationWorkflow,
        overviewAiWorkflow,
        preschoolHtmlAiSlotWorkflow,
        projectOverviewAiAdapters: [ngeeAnnOverviewAiAdapter, tuyaOfficeOverviewAiAdapter],
        templateChangeWorkflow,
        runCancelRegistry,
        userId: authContext.user.id,
        workspaceId: authContext.workspaceId
      });
      if (configResponse) {
        if (Buffer.isBuffer(configResponse.body)) {
          response.writeHead(configResponse.status, {
            "Access-Control-Allow-Origin": "*",
            ...configResponse.headers
          });
          response.end(configResponse.body);
        } else {
          sendJson(response, configResponse.status, configResponse.body, configResponse.headers);
        }
        return;
      }

      if (isCopilotKitPath(requestUrl.pathname)) {
        if (request.method === "OPTIONS") {
          sendCorsPreflight(response);
          return;
        }

        await handleCopilotKitRequest({
          request,
          response,
          metadataStore,
          dataGateway,
          artifactService,
          sessionOutputService,
          fileAssetService,
          knowledgeService,
          taskStateRuntime,
          conversationMemoryMode,
          memoryExtractionTimeoutMs: options.memoryExtractionTimeoutMs
            ?? envConfig.memory.completed_extraction_timeout_ms,
          runCancelRegistry,
          user: authContext.user,
          workspaceId: authContext.workspaceId,
          traceSectionSummaries: options.traceSectionSummaries !== false
        });
        return;
      }

      sendJson(response, 404, createErrorResult("RESOURCE_NOT_FOUND", "Route not found."));
    } catch (error) {
      if (error instanceof Error && error.name === "AuthError") {
        sendAuthError(response, error);
        return;
      }
      if (!response.headersSent) {
        const classified = classifyServerRequestError(error);
        sendJson(response, classified.status, createErrorResult(classified.code, classified.message));
        return;
      }

      const message = error instanceof Error ? error.message : "Unknown server error";
      response.destroy(error instanceof Error ? error : new Error(message));
    }
  });

  // Opt-in scheduler state is process-owned; persisted Runs/State make a watch/restart recoverable.
  const tuyaSyncEnabled = process.env.ENERGYIQ_TUYA_SYNC_ENABLED?.trim().toLocaleLowerCase() === "true";
  const tuyaSyncLocalHour = parseTuyaSyncLocalHour(process.env.ENERGYIQ_TUYA_SYNC_LOCAL_HOUR);
  const configuredTuyaSyncActorUserId = process.env.ENERGYIQ_TUYA_SYNC_ACTOR_USER_ID?.trim();
  if (tuyaSyncEnabled && !configuredTuyaSyncActorUserId) {
    throw new Error("ENERGYIQ_TUYA_SYNC_ACTOR_USER_ID_REQUIRED");
  }
  const tuyaSyncActorUserId = configuredTuyaSyncActorUserId || DEV_USER.id;
  if (tuyaSyncEnabled) metadataStore.users.getById({ user_id: tuyaSyncActorUserId });
  const tuyaConnector = tuyaSyncEnabled
    ? resolveEnergyTuyaProjectConnector({
      metadataStore,
      projectId: process.env.ENERGYIQ_TUYA_CONNECTOR_PROJECT_ID?.trim() ?? "",
    })
    : undefined;
  const energyProjectContext = {
      authService,
      dataGateway,
      fileAssetService,
      knowledgeService,
      metadataStore,
      additionalAiInsightsWorkflow,
      additionalAiInsightsEvaluationWorkflow,
      overviewAiWorkflow,
      preschoolHtmlAiSlotWorkflow,
      projectOverviewAiAdapters: [ngeeAnnOverviewAiAdapter, tuyaOfficeOverviewAiAdapter],
      templateChangeWorkflow,
      runCancelRegistry,
      userId: tuyaSyncActorUserId,
      workspaceId: tuyaConnector?.workspaceId ?? DEFAULT_WORKSPACE_ID,
  } satisfies Required<ConfigApiContext>;
  const tuyaScheduler = createEnergyTuyaDailyScheduler({
    enabled: tuyaSyncEnabled,
    localHour: tuyaSyncLocalHour,
    actorUserId: tuyaSyncActorUserId,
    ...(tuyaConnector ? {
      resolveConnector: () => resolveEnergyTuyaProjectConnector({
        metadataStore,
        projectId: process.env.ENERGYIQ_TUYA_CONNECTOR_PROJECT_ID?.trim() ?? "",
      }),
    } : {}),
    context: energyProjectContext,
    syncTuyaEnergyReadings: (syncInput) => createTuyaOpenApiClientFromEnv().syncEnergyReadings(syncInput),
    afterMaterialization: async (_materialized, beforePublish) => {
      if (!tuyaConnector) return;
      const projection = await materializeCurrentProjectOverviewProjectionIfReady({
        metadataStore,
        dataGateway,
        user: metadataStore.users.getById({ user_id: tuyaSyncActorUserId }),
        workspaceId: tuyaConnector.workspaceId,
        projectId: tuyaConnector.projectId,
        beforePublish,
      });
      return projection ? { projectionRef: projection.contextPackage.projectionRef } : undefined;
    },
    afterPublication: async () => {
      if (!tuyaConnector || process.env.ENERGYIQ_LEGACY_ANALYSIS_PREWARM_ENABLED !== "true") return;
      await prewarmProjectAnalysisContextPackage({
        metadataStore,
        dataGateway,
        user: metadataStore.users.getById({ user_id: tuyaSyncActorUserId }),
        workspaceId: tuyaConnector.workspaceId,
        projectId: tuyaConnector.projectId,
        scopeId: "project",
        resource: "electricity",
        trigger: "tuya",
      });
    },
  });
  // Sites an administrator connected in the app (Facility → Live connection) update on their own daily hour.
  const liveConnectionScheduler = createEnergyLiveConnectionScheduler({
    context: energyProjectContext,
    syncTuyaEnergyReadings: (syncInput) => createTuyaOpenApiClientFor(syncInput.credentials).syncEnergyReadings(syncInput),
    afterMaterialization: (projectId, workspaceId, actorUserId) => async (_materialized, beforePublish) => {
      const projection = await materializeCurrentProjectOverviewProjectionIfReady({
        metadataStore,
        dataGateway,
        user: metadataStore.users.getById({ user_id: actorUserId }),
        workspaceId,
        projectId,
        beforePublish,
      });
      return projection ? { projectionRef: projection.contextPackage.projectionRef } : undefined;
    },
  });
  registerEnergyLiveConnectionScheduler(liveConnectionScheduler);
  // A release that restarts the API mid-publication leaves that journal open, and every read for the project then
  // refuses until a materialization rolls it back. Recover at boot so a deploy cannot strand a site until the next
  // sync — which never arrives when the source sync is switched off or failing. Startup does not wait on it.
  void recoverStrandedEnergyProjectPublications({
    context: energyProjectContext,
    userId: tuyaSyncActorUserId,
  }).then(({ recovered, failed }) => {
    for (const projectId of recovered) {
      console.log(`[energy-publication] recovered-interrupted-publication project=${projectId}`);
    }
    for (const failure of failed) {
      console.error(`[energy-publication] recovery-failed project=${failure.projectId} code=${failure.message}`);
    }
  }).catch((error) => {
    console.error(`[energy-publication] recovery-failed code=${error instanceof Error ? error.message : "unknown"}`);
  });
  tuyaScheduler.start();
  liveConnectionScheduler.start();
  reportService?.start();

  gracefulServerClosers.set(server, bindGracefulServerLifecycle({
    server,
    closeResources: async () => {
      await tuyaScheduler.stop();
      await liveConnectionScheduler.stop();
      registerEnergyLiveConnectionScheduler(undefined);
      await reportService?.stop();
      metadataStore.close();
      if (ownsTaskStateRuntime) {
        await taskStateRuntime.close();
      }
    },
  }));

  return server;
};

const parseTuyaSyncLocalHour = (value: string | undefined): number => {
  if (!value?.trim()) return 2;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 23) {
    throw new Error("ENERGYIQ_TUYA_SYNC_LOCAL_HOUR_INVALID");
  }
  return parsed;
};

export function classifyServerRequestError(error: unknown): {
  status: 401 | 403 | 500;
  code: "UNAUTHORIZED" | "FORBIDDEN" | "NOT_ENABLED";
  message: string;
} {
  const message = error instanceof Error ? error.message : "Unknown server error";
  if (message.startsWith("UNAUTHORIZED:")) {
    return { status: 401, code: "UNAUTHORIZED", message: message.slice("UNAUTHORIZED:".length) };
  }
  if (message.startsWith("FORBIDDEN:")) {
    return { status: 403, code: "FORBIDDEN", message: message.slice("FORBIDDEN:".length) };
  }
  if (message === "ENERGYIQ_WORKSPACE_FORBIDDEN") {
    return { status: 403, code: "FORBIDDEN", message };
  }
  return { status: 500, code: "NOT_ENABLED", message };
}

export const collectOverviewAiStageEvents = (
  agent: DataFoundryAgUiAgent,
  input: OverviewAiRuntimeStageInput,
  metadataStore: MetadataStore,
): Promise<{
  events: ReadonlyArray<Record<string, unknown>>;
  completedRun: { runId: string; sessionId: string };
}> => new Promise((resolve, reject) => {
  const events: BaseEvent[] = [];
  agent.run(buildOverviewAiStageRunInput(input)).subscribe({
    next: (event) => events.push(event),
    error: (error) => reject(normalizeOverviewAiStageRuntimeError(input.stage, error)),
    complete: () => {
      const run = metadataStore.runs.find({ user_id: input.user.id, run_id: input.runId });
      if (!run
        || run.status !== "completed"
        || !run.finished_at
        || run.session_id !== input.sessionId
        || !run.user_input.includes(input.identity.dataSnapshotId)
        || !run.user_input.includes(input.identity.projectReleaseId)
        || !run.user_input.includes(input.identity.analysisPeriodFrom)
        || !run.user_input.includes(input.identity.analysisPeriodTo)) {
        reject(normalizeOverviewAiStageRuntimeError(
          input.stage,
          run?.error_message ?? "OVERVIEW_AI_RUNTIME_RUN_INVALID",
        ));
        return;
      }
      resolve({
        events: events as unknown as ReadonlyArray<Record<string, unknown>>,
        completedRun: { runId: run.id, sessionId: run.session_id },
      });
    },
  });
});

const overviewAiTokenUsage = (events: ReadonlyArray<Record<string, unknown>>): {
  inputTokens?: number;
  outputTokens?: number;
} => {
  const usage = events
    .filter((event) => event.type === "CUSTOM" && event.name === "token_usage" && isServerRecord(event.value))
    .map((event) => event.value as Record<string, unknown>)
    .at(-1);
  if (!usage) return {};
  const inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : undefined;
  const outputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : undefined;
  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
  };
};

export const normalizeOverviewAiStageRuntimeError = (
  stage: PreschoolOverviewAiStage,
  error: unknown,
): Error => {
  const message = error instanceof Error ? error.message : String(error);
  if ((stage === "additional-insights-discovery" || stage === "additional-insights-transition")
    && (message === PRESCHOOL_ADDITIONAL_AI_STRUCTURED_OUTPUT_ROOT_INVALID
      || /(?:structured[ _-]?output.*\broot\b|\broot\b.*structured[ _-]?output).*(?:undefined|null|missing|invalid)/iu
        .test(message))) {
    return new Error(PRESCHOOL_ADDITIONAL_AI_STRUCTURED_OUTPUT_ROOT_INVALID);
  }
  if ((stage === "additional-insights-discovery" || stage === "additional-insights-transition")
    && errorChainIncludesLocalAdditionalStructuredOutputSchemaError(error)) {
    return new Error(PRESCHOOL_ADDITIONAL_AI_STRUCTURED_OUTPUT_SCHEMA_INVALID);
  }
  return error instanceof Error ? error : new Error(message);
};

const LOCAL_ADDITIONAL_STRUCTURED_OUTPUT_SCHEMA_ERROR = Symbol(
  "energyiq.local-additional-structured-output-schema-error",
);

class LocalAdditionalStructuredOutputSchemaError extends Error {
  readonly [LOCAL_ADDITIONAL_STRUCTURED_OUTPUT_SCHEMA_ERROR] = true;

  constructor(cause: unknown) {
    super(PRESCHOOL_ADDITIONAL_AI_STRUCTURED_OUTPUT_SCHEMA_INVALID, { cause });
  }
}

const wrapLocalAdditionalStructuredOutputSchema = (
  stage: PreschoolOverviewAiStage,
  structuredOutput: NonNullable<CreateDataFoundryInput["structuredOutput"]>,
): NonNullable<CreateDataFoundryInput["structuredOutput"]> => {
  if (stage !== "additional-insights-discovery" && stage !== "additional-insights-transition") {
    return structuredOutput;
  }
  const schema = toStandardSchema(structuredOutput.schema);
  const standard = schema["~standard"];
  return {
    ...structuredOutput,
    schema: {
      "~standard": {
        ...standard,
        validate: async (value: unknown) => {
          let result;
          try {
            result = await standard.validate(value);
          } catch (error) {
            throw new LocalAdditionalStructuredOutputSchemaError(error);
          }
          if ("issues" in result && Array.isArray(result.issues) && result.issues.length > 0) {
            throw new LocalAdditionalStructuredOutputSchemaError(result.issues);
          }
          return result;
        },
      },
    },
  };
};

const errorChainIncludesLocalAdditionalStructuredOutputSchemaError = (error: unknown): boolean => {
  let current: unknown = error;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 6 && typeof current === "object" && current !== null; depth += 1) {
    if (seen.has(current)) return false;
    seen.add(current);
    if (isLocalAdditionalStructuredOutputSchemaError(current)) return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
};

const isLocalAdditionalStructuredOutputSchemaError = (
  error: unknown,
): error is LocalAdditionalStructuredOutputSchemaError => (
  error instanceof LocalAdditionalStructuredOutputSchemaError
  && error[LOCAL_ADDITIONAL_STRUCTURED_OUTPUT_SCHEMA_ERROR] === true
);

const DEEPSEEK_REASONING_TERMINATOR = "<｜end▁of▁thinking｜>";

export const collectOverviewAiText = (
  events: ReadonlyArray<Record<string, unknown>>,
  stage?: PreschoolOverviewAiStage,
): string => {
  const answer = events
    .filter((event) => event.type === "TEXT_MESSAGE_CONTENT" || event.type === "TEXT_MESSAGE_CHUNK")
    .map((event) => typeof event.delta === "string" ? event.delta : "")
    .join("")
    .trim();
  if (stage !== "additional-insights-discovery"
    && stage !== "additional-insights-transition"
    && stage !== "html-slot") return answer;
  const terminatorIndex = answer.lastIndexOf(DEEPSEEK_REASONING_TERMINATOR);
  if (terminatorIndex < 0) return answer;
  const finalAnswer = answer.slice(terminatorIndex + DEEPSEEK_REASONING_TERMINATOR.length).trim();
  try {
    const parsed = JSON.parse(finalAnswer) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? finalAnswer : answer;
  } catch {
    return answer;
  }
};

export const collectOverviewAiValueStageAnswer = (
  events: ReadonlyArray<Record<string, unknown>>,
  stage: PreschoolOverviewAiStage,
  additionalAiInsightSubmission: boolean,
): string => additionalAiInsightSubmission
  ? JSON.stringify(collectAdditionalAiInsightSubmission(events) ?? {})
  : collectOverviewAiText(events, stage);

export const buildOverviewAiStageRunInput = (input: OverviewAiRuntimeStageInput): RunAgentInput => ({
  threadId: input.sessionId,
  runId: input.runId,
  state: {},
  messages: [{ id: `${input.runId}:user`, role: "user", content: overviewAiStageUserPrompt(input) }],
  tools: [],
  context: [],
  forwardedProps: {
    ...(shouldUseEnergyContextForOverviewAiStage(input.stage)
      ? {
          externalContext: {
            source: "energyiq",
            projectId: input.identity.projectId,
            scopeId: input.identity.scopeId,
            resource: input.identity.resource,
            period: "Custom",
            from: input.identity.analysisPeriodFrom,
            to: input.identity.analysisPeriodTo,
            expectedDataSnapshotId: input.identity.dataSnapshotId,
            expectedProjectReleaseId: input.identity.projectReleaseId,
            overviewAiStage: input.stage,
          },
        }
      : {}),
    run_config: {
      protocol: ((input.stage === "additional-insights-discovery"
        && isCurrentProjectAdditionalAiInsightArtifactIdentity(input.identity))
        || (input.stage === "additional-insights-transition"
          && isCurrentPreschoolAdditionalAiInsightArtifactIdentity(input.identity)))
        ? { id: "general-task", version: "1" }
        : { id: "data-analysis", version: "1" },
      activeLlmProfileId: input.identity.modelProfileId,
      skillMode: isIsolatedValueStage(input.stage)
        ? "none"
        : "auto",
      ...(isIsolatedValueStage(input.stage)
        ? {}
        : { activeSkillId: input.identity.methodSkillId }),
      enabledDatasourceIds: [],
      enabledKnowledgeIds: [],
      enabledMcpServerIds: [],
      enabledSkillIds: isIsolatedValueStage(input.stage)
        ? []
        : [input.identity.methodSkillId],
      skillPolicy: {
        allowedToolNames: isIsolatedValueStage(input.stage)
          ? []
          : input.stage === "editor"
            ? ["skill", "skill_search", "skill_read"]
            : ["skill", "skill_search", "skill_read", "inspect_schema", "run_sql_readonly"],
        deniedToolNames: ["list_data_sources", "preview_table"],
        maxSkills: 1,
        requireUserInvocable: true,
        strictSkillTools: true,
      },
    },
  },
});

const overviewAiStageUserPrompt = (input: OverviewAiRuntimeStageInput): string =>
  input.stage === "section-interpreter"
    ? [
        input.prompt,
        `Server-owned Artifact pin for runtime validation only; do not repeat it in customer text: ${JSON.stringify({
          workspaceId: input.identity.workspaceId,
          projectId: input.identity.projectId,
          scopeId: input.identity.scopeId,
          dataSnapshotId: input.identity.dataSnapshotId,
          projectReleaseId: input.identity.projectReleaseId,
          analysisPeriod: {
            from: input.identity.analysisPeriodFrom,
            to: input.identity.analysisPeriodTo,
          },
        })}`,
      ].join("\n\n")
    : input.prompt;

const isIsolatedValueStage = (stage: PreschoolOverviewAiStage): boolean =>
  stage === "section-interpreter"
  || stage === "executive-synthesis"
  || stage === "template-proposal"
  || stage === "additional-insights-discovery"
  || stage === "additional-insights-transition"
  || stage === "html-slot";

type HandleCopilotKitRequestInput = {
  artifactService: LocalArtifactService;
  sessionOutputService: SessionOutputService;
  conversationMemoryMode: AgentMemoryMode;
  request: IncomingMessage;
  response: ServerResponse;
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  fileAssetService: LocalFileAssetService;
  knowledgeService: LocalKnowledgeService;
  memoryExtractionTimeoutMs: number;
  runCancelRegistry: RunCancelRegistry;
  taskStateRuntime: TaskStateRuntime;
  traceSectionSummaries: boolean;
  user: MeResponse;
  workspaceId: string;
};

const handleCopilotKitRequest = async ({
  request,
  response,
  metadataStore,
  dataGateway,
  artifactService,
  sessionOutputService,
  fileAssetService,
  conversationMemoryMode,
  knowledgeService,
  memoryExtractionTimeoutMs,
  runCancelRegistry,
  taskStateRuntime,
  traceSectionSummaries,
  user,
  workspaceId
}: HandleCopilotKitRequestInput): Promise<void> => {
  const runtime = new CopilotRuntime({
    agents: {
      dataFoundry: new DataFoundryAgUiAgent({
        dataGateway,
        artifactService,
        sessionOutputService,
        fileAssetService,
        conversationMemoryMode,
        knowledgeService,
        memoryExtractionTimeoutMs,
        metadataStore,
        runCancelRegistry,
        taskStateRuntime,
        traceSectionSummaries,
        user,
        workspaceId,
        workspaceRoot: process.env.WORKSPACE_ROOT ?? join(process.env.STORAGE_ROOT_DIR ?? "storage", "workspaces")
      }) as never
    }
  });
  const endpointOptions = {
    endpoint: COPILOTKIT_PATH,
    runtime,
    serviceAdapter: new ExperimentalEmptyAdapter(),
    cors: {
      origin: "*"
    }
  } as unknown as Parameters<typeof copilotRuntimeNodeHttpEndpoint>[0];
  const endpoint = copilotRuntimeNodeHttpEndpoint(endpointOptions);

  try {
    await endpoint(request, response);
  } catch (error) {
    throw error;
  }
};

export type DataFoundryAgUiAgentInput = {
  artifactService: LocalArtifactService;
  sessionOutputService: SessionOutputService;
  conversationMemoryMode: AgentMemoryMode;
  dataGateway: LocalDataGateway;
  defaultDatasourceId?: string;
  fileAssetService: LocalFileAssetService;
  metadataStore: MetadataStore;
  knowledgeService: LocalKnowledgeService;
  memoryExtractionTimeoutMs: number;
  /** Internal test seam; production always uses the canonical assembly factory. */
  runAgentAssemblyFactory?: typeof createRunAgentAssembly;
  /** Internal test seam preventing model-backed memory extraction in event-loop tests. */
  completedMemoryFlushOverride?: () => Promise<void>;
  /** Server-created Overview Artifact stage; never accepted from browser props. */
  overviewAiStage?: PreschoolOverviewAiStage;
  /** Server-created Pack-v2 override; never accepted from browser props. */
  overviewAiTrustedRuntimeOverride?: OverviewAiTrustedRuntimeOverride;
  /** Server-created durable evaluation binding; never accepted from browser props. */
  trustedModelProfileSnapshot?: EnergyIqAdditionalInsightModelProfileSnapshot;
  /** Server-created Artifact project scope for stages that intentionally omit Energy query context. */
  trustedEnergySessionScope?: {
    projectId: string;
    workspaceId: string;
  };
  runCancelRegistry: RunCancelRegistry;
  taskStateRuntime: TaskStateRuntime;
  traceSectionSummaries: boolean;
  user: MeResponse;
  workspaceId: string;
  workspaceRoot: string;
};

export const energyRunMatchesPersistedSessionContext = (input: {
  persisted: SessionEnergyContextDto;
  resolved: EnergyQueryContext;
  projectReleaseId?: string;
  fork?: EnergySessionForkLineage;
}): boolean => JSON.stringify({
  workspaceId: input.persisted.workspaceId,
  projectId: input.persisted.projectId,
  scopeId: input.persisted.scopeId,
  resource: input.persisted.resource,
  timezone: input.persisted.timezone,
  from: input.persisted.from,
  to: input.persisted.to,
  hierarchyRevisionId: input.persisted.hierarchyRevisionId,
  meterMappingRevisionId: input.persisted.meterMappingRevisionId,
  meterFormulaRevisionId: input.persisted.meterFormulaRevisionId,
  projectReleaseId: input.persisted.projectReleaseId ?? null,
  dataSnapshotId: input.persisted.dataSnapshotId,
  fork: input.persisted.forkedFromContextStatus !== "unavailable"
    && input.persisted.forkedFromSessionId
    && input.persisted.forkedFromRunId
    && input.persisted.forkedFromFrom
    && input.persisted.forkedFromTo
    ? {
        sourceSessionId: input.persisted.forkedFromSessionId,
        sourceRunId: input.persisted.forkedFromRunId,
        sourceFrom: input.persisted.forkedFromFrom,
        sourceTo: input.persisted.forkedFromTo,
      }
    : null,
}) === JSON.stringify({
  workspaceId: input.resolved.workspaceId,
  projectId: input.resolved.projectId,
  scopeId: input.resolved.scopeId,
  resource: input.resolved.resource,
  timezone: input.resolved.timezone,
  from: input.resolved.from,
  to: input.resolved.to,
  hierarchyRevisionId: input.resolved.hierarchyRevisionId,
  meterMappingRevisionId: input.resolved.meterMappingRevisionId,
  meterFormulaRevisionId: input.resolved.meterFormulaRevisionId,
  projectReleaseId: input.projectReleaseId ?? null,
  dataSnapshotId: input.resolved.dataSnapshotId,
  fork: input.fork ?? null,
});

export const retainRunOwnershipUntilFinalized = (
  finalization: Promise<void>,
  releaseOwnership: () => void,
): Promise<void> => finalization.finally(releaseOwnership);

export class DataFoundryAgUiAgent extends AbstractAgent {
  private input: DataFoundryAgUiAgentInput;

  constructor(input: DataFoundryAgUiAgentInput) {
    super({
      agentId: "dataFoundry",
      description: "Read-only data analysis agent backed by Mastra and Data Gateway."
    });
    this.input = input;
  }

  clone(): DataFoundryAgUiAgent {
    const cloned = super.clone() as DataFoundryAgUiAgent;
    cloned.input = this.input;
    return cloned;
  }

  run(runInput: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      const requestStartedAt = performance.now();
      let clientRunId = runInput.runId;
      let clientRunStarted = false;
      const clientEventIds = new Set<string>();
      const emitClientEvent = (event: BaseEvent): void => {
        const eventId = event.type === EventType.CUSTOM
          && (event.name === ENERGY_RUN_LATENCY_EVENT || event.name === ENERGY_RUN_PREPARATION_EVENT)
          && isServerRecord(event.value)
          && typeof event.value.eventId === "string"
          ? event.value.eventId
          : undefined;
        if (eventId && clientEventIds.has(eventId)) return;
        if (eventId) clientEventIds.add(eventId);
        // Preparation is streamed before the durable Run claim, while AG-UI
        // requires RUN_STARTED to open the client transport. The real runtime
        // event still flows through the canonical persistence pipeline below.
        if (!clientRunStarted) {
          if (event.type === EventType.RUN_STARTED) {
            clientRunStarted = true;
            subscriber.next({
              ...event,
              threadId: runInput.threadId,
              runId: clientRunId,
            });
            return;
          }
          subscriber.next({
            type: EventType.RUN_STARTED,
            threadId: runInput.threadId,
            runId: clientRunId,
            timestamp: Date.now(),
          });
          clientRunStarted = true;
        } else if (event.type === EventType.RUN_STARTED) {
          return;
        }
        subscriber.next(event);
      };
      const clientSubscriber = {
        complete: () => subscriber.complete(),
        next: emitClientEvent,
      };
      let interactionResume: ReturnType<typeof extractInteractionResume>;
      try {
        interactionResume = extractInteractionResume(runInput);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid interaction resume";
        const resumeRunId = extractInteractionResumeRunId(runInput);
        let failureRunId = resumeRunId ?? runInput.runId;
        const command = isServerRecord(runInput.forwardedProps)
          && isServerRecord(runInput.forwardedProps.command)
          ? runInput.forwardedProps.command
          : undefined;
        const durable = transitionEarlyRunFailure({
          errorMessage: message,
          isResume: Boolean(command && "resume" in command),
          metadataStore: this.input.metadataStore,
          runId: failureRunId,
          runInput,
          sessionId: runInput.threadId,
          userId: this.input.user.id,
          userInput: extractLastUserText(runInput) ?? "CopilotKit AG-UI run"
        });
        if (!durable && resumeRunId) failureRunId = runInput.runId;
        clientRunId = failureRunId;
        const correlationId = energyRunCorrelationIdFromForwardedProps(runInput.forwardedProps);
        const trace = createEnergyRunPreparationTrace({
          ...(correlationId ? { correlationId } : {}),
          runId: failureRunId,
          startedAt: requestStartedAt,
          stream: emitClientEvent,
        });
        if (durable) {
          persistClaimedEnergyPreparation({
            trace,
            metadataStore: this.input.metadataStore,
            runId: failureRunId,
            sessionId: runInput.threadId,
            userId: this.input.user.id,
          });
        }
        emitEarlyRunFailure(clientSubscriber, failureRunId, message, durable);
        return;
      }
      const runId = interactionResume?.interrupt.runId ?? runInput.runId;
      clientRunId = runId;
      let energyPreparationTrace: EnergyRunPreparationTrace | undefined;
      const run = async (): Promise<void> => {
        const sessionId = runInput.threadId;
        // CopilotKit may send a fresh runId on resume; Mastra embeds runInput.runId in
        // on_interrupt payloads, so keep AG-UI identity aligned with the suspended run.
        const normalizedRunInput =
          runId === runInput.runId ? runInput : { ...runInput, runId };
        const userInput = extractLastUserText(normalizedRunInput) ?? "CopilotKit AG-UI run";
        const overviewAiStageOptions = this.input.overviewAiStage
          ? resolveOverviewAiAgentRuntimeOptions(
              this.input.overviewAiStage,
              this.input.overviewAiTrustedRuntimeOverride,
            )
          : undefined;
        const overviewAiStructuredOutput = this.input.overviewAiStage && overviewAiStageOptions?.structuredOutput
          ? wrapLocalAdditionalStructuredOutputSchema(
              this.input.overviewAiStage,
              overviewAiStageOptions.structuredOutput,
            )
          : undefined;
        const useEnergyContext = shouldUseEnergyContextForOverviewAiStage(this.input.overviewAiStage);
        let effectiveRunConfig;
        let mcpRuntime;
        let modelContextProfile;
        let modelProvider;
        let modelSettings;
        let reasoningModel;
        let runTimeoutMs;
        let selectedSkills;
        let skillSelection;
        let energyQueryContext;
        let energySessionFork;
        let energySessionForkProvenance: EnergySessionForkProvenance | undefined;
        let energyAnalysisWorkspace: EnergyIqAnalysisWorkspace | undefined;
        let contextEvidenceCatalog: AnalysisContextEvidenceCatalog | undefined;
        let contextEvidenceSelection: NonNullable<AnalysisRequirement["contextEvidence"]> | undefined;
        let analysisContextPackageStatus:
          | "package_hit"
          | "targeted_query"
          | "full_materialization_missing"
          | undefined;
        let projectAnalysisDiagnostics: ProjectAnalysisRequestDiagnostics | undefined;
        let projectAnalysisSnapshot: ProjectAnalysisSnapshot | undefined;
        let publishedProjectRelease: PublishedProjectRelease | null = null;
        let publishedMeterRoute: EnergyPublishedMeterRoute | undefined;
        let trustedEnergyTextContract: TrustedEnergyTextQueryContract | undefined;
        try {
          const energyRequest = useEnergyContext
            ? extractEnergyQueryContextRequest(normalizedRunInput)
            : undefined;
          if (energyRequest) {
            const correlationId = energyRunCorrelationIdFromForwardedProps(
              normalizedRunInput.forwardedProps,
            );
            energyPreparationTrace = createEnergyRunPreparationTrace({
              ...(correlationId ? { correlationId } : {}),
              runId,
              startedAt: requestStartedAt,
              stream: emitClientEvent,
            });
            energyPreparationTrace.record("request-accepted");
          }
          let persistedSessionContext: SessionEnergyContextDto | undefined;
          let historicalSessionContextUnavailable = false;
          try {
            const session = this.input.metadataStore.sessions.get({
              user_id: this.input.user.id,
              session_id: sessionId,
            });
            if (session.energy_context_json !== undefined) {
              persistedSessionContext = sessionEnergyContextFromPersistedJson(
                session.energy_context_json,
              );
              if (!persistedSessionContext) {
                throw new Error("ENERGYIQ_SESSION_CONTEXT_INVALID");
              }
            } else {
              const inspection = inspectLatestAuthoritativeEnergyContextSnapshots(
                this.input.metadataStore.contextPackageSnapshots.iterateBySession({
                  user_id: this.input.user.id,
                  session_id: sessionId,
                }),
              );
              if (inspection.status === "invalid") {
                throw new Error("ENERGYIQ_SESSION_CONTEXT_INVALID");
              }
              if (inspection.status === "available") {
                persistedSessionContext = inspection.context;
              } else {
                historicalSessionContextUnavailable = Boolean(
                  this.input.metadataStore.runs.findLatestBySession({
                    user_id: this.input.user.id,
                    session_id: sessionId,
                  }),
                );
              }
            }
          } catch (error) {
            if (
              !(error instanceof Error)
              || !error.message.startsWith("Session not found:")
            ) {
              throw error;
            }
            // A normal client-created Session can be claimed by its first Run.
            // A pre-created continued Session is already present and therefore
            // must never reach this branch.
          }
          if (historicalSessionContextUnavailable) {
            throw new Error("ENERGYIQ_SESSION_CONTEXT_UNAVAILABLE");
          }
          if (persistedSessionContext && !energyRequest) {
            throw new Error("ENERGYIQ_SESSION_CONTEXT_REQUIRED");
          }
          energySessionFork = useEnergyContext
            ? extractEnergySessionForkRequest(normalizedRunInput)
            : undefined;
          energySessionForkProvenance = energySessionForkProvenanceFromContext(
            persistedSessionContext,
          );
          if (energySessionFork && !energyRequest) {
            throw new Error("ENERGYIQ_SESSION_FORK_CONTEXT_REQUIRED");
          }
          const trustedTextIntent = extractTrustedEnergyTextIntent(normalizedRunInput);
          if (trustedTextIntent && !energyRequest) {
            throw new Error("TRUSTED_ENERGY_TEXT_CONTEXT_REQUIRED");
          }
          if (energyRequest) {
            const publishedRunContext = resolvePublishedEnergyQueryContext({
              metadataStore: this.input.metadataStore,
              user: this.input.metadataStore.users.getById({ user_id: this.input.user.id }),
              workspaceId: this.input.workspaceId,
              request: energyRequest,
            });
            energyQueryContext = publishedRunContext.context;
            publishedProjectRelease = publishedRunContext.projectRelease;
            energyPreparationTrace?.record("query-context-resolved");
            if (energySessionFork) {
              energySessionFork = validateEnergySessionForkLineage({
                currentSessionId: sessionId,
                currentWorkspaceId: this.input.workspaceId,
                currentProjectId: energyQueryContext.projectId,
                lineage: energySessionFork,
                readSourceSession: (sourceSessionId) => {
                  const source = this.input.metadataStore.sessions.get({
                    user_id: this.input.user.id,
                    session_id: sourceSessionId,
                  });
                  return {
                    workspaceId: source.workspace_id,
                    projectId: source.project_id,
                  };
                },
                readSourceRunContext: (sourceRunId) => {
                  const sourceRun = this.input.metadataStore.runs.get({
                    user_id: this.input.user.id,
                    run_id: sourceRunId,
                  });
                  const sourceInspection = inspectLatestAuthoritativeEnergyContextSnapshots(
                    this.input.metadataStore.contextPackageSnapshots.iterateByRun({
                      user_id: this.input.user.id,
                      run_id: sourceRunId,
                    }),
                  );
                  const sourceContext = sourceInspection.status === "available"
                    ? sourceInspection.context
                    : undefined;
                  return {
                    sessionId: sourceRun.session_id,
                    workspaceId: sourceContext?.workspaceId,
                    projectId: sourceContext?.projectId,
                    from: sourceContext?.from,
                    to: sourceContext?.to,
                  };
                },
              });
              energySessionForkProvenance = energySessionFork;
            }
            if (persistedSessionContext && !energyRunMatchesPersistedSessionContext({
              persisted: persistedSessionContext,
              resolved: energyQueryContext,
              ...(publishedProjectRelease?.id
                ? { projectReleaseId: publishedProjectRelease.id }
                : {}),
              ...(energySessionFork ? { fork: energySessionFork } : {}),
            })) {
              throw new Error("ENERGYIQ_SESSION_CONTEXT_MISMATCH");
            }
          }
          publishedMeterRoute = energyQueryContext
            ? resolveEnergyPublishedMeterRoute({
                metadataStore: this.input.metadataStore,
                projectId: energyQueryContext.projectId,
                hierarchyRevisionId: energyQueryContext.hierarchyRevisionId,
                scopeId: energyQueryContext.scopeId,
                resource: energyQueryContext.resource,
                expectedMeterMappingRevisionId: energyQueryContext.meterMappingRevisionId
              })
            : undefined;
          if (publishedMeterRoute) {
            energyPreparationTrace?.record("meter-route-resolved");
          }
          if (energyRequest && shouldIncludeProjectAnalysisEvidenceContext(this.input.overviewAiStage)) {
            const analysisPackage = energyQueryContext && publishedProjectRelease
              ? await readProjectAnalysisContextPackage({
                  metadataStore: this.input.metadataStore,
                  dataGateway: this.input.dataGateway,
                  user: this.input.metadataStore.users.getById({ user_id: this.input.user.id }),
                  workspaceId: this.input.workspaceId,
                  context: energyQueryContext,
                  projectRelease: publishedProjectRelease,
                  analysisWindow: energyRequest.analysisWindow ?? null,
                })
              : undefined;
            if (analysisPackage) {
              projectAnalysisSnapshot = analysisPackage.resolution.snapshot;
              contextEvidenceCatalog = createProjectAnalysisContextEvidenceCatalog(
                analysisPackage.resolution.snapshot,
              );
              contextEvidenceSelection = selectEnergyAnalysisContextEvidence(
                userInput,
                contextEvidenceCatalog,
              );
            }
            if (contextEvidenceSelection?.mode !== "sufficient"
              && energyQueryContext
              && publishedProjectRelease
              && energyQueryContext.scopeType === "project"
              && energyQueryContext.resource === "electricity") {
              try {
                const overviewProjection = await readCurrentProjectOverviewProjection({
                  metadataStore: this.input.metadataStore,
                  dataGateway: this.input.dataGateway,
                  user: this.input.metadataStore.users.getById({ user_id: this.input.user.id }),
                  workspaceId: this.input.workspaceId,
                  projectId: energyQueryContext.projectId,
                  expectedDataSnapshotId: energyQueryContext.dataSnapshotId,
                  expectedProjectReleaseId: publishedProjectRelease.id,
                  expectedFrom: energyQueryContext.from,
                  expectedTo: energyQueryContext.to,
                });
                const overviewCatalog = createProjectAnalysisContextEvidenceCatalog(
                  overviewProjection.resolution.snapshot,
                );
                const overviewSelection = selectEnergyAnalysisContextEvidence(
                  userInput,
                  overviewCatalog,
                );
                if (overviewSelection?.mode === "sufficient") {
                  projectAnalysisSnapshot = overviewProjection.resolution.snapshot;
                  contextEvidenceCatalog = overviewCatalog;
                  contextEvidenceSelection = overviewSelection;
                }
              } catch (error) {
                if (!isOptionalOverviewEvidenceUnavailable(error)) throw error;
              }
            }
            analysisContextPackageStatus = contextEvidenceSelection?.mode === "sufficient"
              ? "package_hit"
              : analysisPackage
                ? "targeted_query"
                : "full_materialization_missing";
            energyPreparationTrace?.record("analysis-context-package-resolved", {
              packageStatus: analysisContextPackageStatus,
            });
          }
          energyAnalysisWorkspace = energyQueryContext
            && publishedMeterRoute
            && trustedTextIntent
            ? await ensureEnergyIqAnalysisWorkspace({
                metadataStore: this.input.metadataStore,
                userId: this.input.user.id,
                context: energyQueryContext,
                publishedMeterRoute,
              })
            : undefined;
          if (energyAnalysisWorkspace) {
            energyPreparationTrace?.record("scoped-datasource-ready");
          }
          const energyScopedDataSource = energyAnalysisWorkspace?.scopedDatasource;
          if (energyRequest
            && energyScopedDataSource
            && !projectAnalysisSnapshot
            && shouldIncludeProjectAnalysisEvidenceContext(this.input.overviewAiStage)) {
            const resolution = await resolveProjectAnalysis({
              metadataStore: this.input.metadataStore,
              dataGateway: this.input.dataGateway,
              user: this.input.metadataStore.users.getById({ user_id: this.input.user.id }),
              workspaceId: this.input.workspaceId,
              request: energyRequest,
              includeMutableLifecycle: false,
              onDiagnostics: (diagnostics) => {
                projectAnalysisDiagnostics = diagnostics;
              },
            });
            if (resolution.status === "ready") {
              projectAnalysisSnapshot = resolution.snapshot;
              contextEvidenceCatalog = createProjectAnalysisContextEvidenceCatalog(resolution.snapshot);
              if (energyQueryContext && publishedProjectRelease) {
                await materializeProjectAnalysisContextPackage({
                  metadataStore: this.input.metadataStore,
                  dataGateway: this.input.dataGateway,
                  context: energyQueryContext,
                  projectRelease: publishedProjectRelease,
                  analysisWindow: energyRequest.analysisWindow ?? null,
                  resolution,
                });
              }
            } else if (trustedTextIntent) {
              throw new Error("TRUSTED_ENERGY_TEXT_PROJECT_ANALYSIS_NOT_CONFIGURED");
            }
            energyPreparationTrace?.record(
              "project-analysis-resolved",
              resolution.status === "ready" && projectAnalysisDiagnostics
                ? {
                    cacheStatus: projectAnalysisDiagnostics.cacheStatus,
                    evidenceQueryCount: projectAnalysisDiagnostics.evidenceQueryCount,
                  }
                : {},
            );
          }
          if (trustedTextIntent && energyRequest && energyScopedDataSource) {
            if (!projectAnalysisSnapshot) {
              throw new Error("TRUSTED_ENERGY_TEXT_PROJECT_ANALYSIS_NOT_CONFIGURED");
            }
            trustedEnergyTextContract = compileTrustedEnergyRunContract({
              intent: trustedTextIntent,
              metadataStore: this.input.metadataStore,
              snapshot: projectAnalysisSnapshot,
              scopedDatasource: energyScopedDataSource
            });
            // A generic Agent response is not a trusted result. Enable this
            // branch only after production calls executeTrustedEnergyText and
            // persists its validated canonical answer.
            throw new Error("TRUSTED_ENERGY_TEXT_VALIDATED_EXECUTOR_REQUIRED");
          }
          ({
            effectiveRunConfig,
            mcpRuntime,
            modelContextProfile,
            modelProvider,
            modelSettings,
            reasoningModel,
            runTimeoutMs,
            selectedSkills,
            skillSelection
          } = resolveRunConfig({
            ...(useEnergyContext && energyScopedDataSource?.datasourceId
              ? { defaultDatasourceId: energyScopedDataSource.datasourceId }
              : {}),
            metadataStore: this.input.metadataStore,
            modelSelection: overviewAiStageOptions
              ? "request-or-workspace"
              : energyRequest ? "system-default" : "request-or-workspace",
            ...(energyRequest && !overviewAiStageOptions
              ? { implicitSkillDenylist: ["data-analysis", "energy-insight-investigation"] }
              : {}),
            runInput: normalizedRunInput,
            userId: this.input.user.id,
            userInput,
            workspaceId: this.input.workspaceId,
            ...(this.input.trustedModelProfileSnapshot
              ? { trustedModelProfileSnapshot: this.input.trustedModelProfileSnapshot }
              : {}),
          }));
          if (useEnergyContext
            && analysisContextPackageStatus === "package_hit"
            && !energyScopedDataSource) {
            const {
              activeDatasourceId: _activeDatasourceId,
              ...withoutActiveDatasource
            } = effectiveRunConfig;
            effectiveRunConfig = {
              ...withoutActiveDatasource,
              enabledDatasourceIds: [],
              resourceRevisions: Object.fromEntries(
                Object.entries(withoutActiveDatasource.resourceRevisions ?? {})
                  .filter(([resourceId]) => !resourceId.startsWith("datasource:")),
              ),
            };
          }
          if (overviewAiStageOptions) {
            reasoningModel = overviewAiStageOptions.reasoningModel;
            if (overviewAiStageOptions.runTimeoutMs !== undefined) {
              runTimeoutMs = overviewAiStageOptions.runTimeoutMs;
            }
          }
          if (useEnergyContext && energyScopedDataSource) {
            effectiveRunConfig = {
              ...effectiveRunConfig,
              activeDatasourceId: energyScopedDataSource.datasourceId,
              enabledDatasourceIds: [energyScopedDataSource.datasourceId],
              resourceRevisions: {
                ...effectiveRunConfig.resourceRevisions,
                [`datasource:${energyScopedDataSource.datasourceId}`]: energyScopedDataSource.revision
              }
            };
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const energySessionScope = energyQueryContext
            ? {
                workspaceId: energyQueryContext.workspaceId,
                projectId: energyQueryContext.projectId,
              }
            : this.input.trustedEnergySessionScope;
          const durable = transitionEarlyRunFailure({
            ...(energySessionScope
              ? {
                  energySessionScope,
                }
              : {}),
            errorMessage: message,
            isResume: Boolean(interactionResume),
            metadataStore: this.input.metadataStore,
            runId,
            runInput: normalizedRunInput,
            sessionId,
            userId: this.input.user.id,
            userInput
          });
          if (durable) {
            persistClaimedEnergyPreparation({
              trace: energyPreparationTrace,
              metadataStore: this.input.metadataStore,
              runId,
              sessionId,
              userId: this.input.user.id,
            });
          }
          emitEarlyRunFailure(clientSubscriber, runId, message, durable);
          return;
        }
        const runEventWriter = new RunEventWriter(this.input.metadataStore.runEvents);
        const energySessionScope = energyQueryContext
          ? {
              workspaceId: energyQueryContext.workspaceId,
              projectId: energyQueryContext.projectId,
            }
          : this.input.trustedEnergySessionScope;
        if (energyQueryContext && this.input.trustedEnergySessionScope
          && (energyQueryContext.workspaceId !== this.input.trustedEnergySessionScope.workspaceId
            || energyQueryContext.projectId !== this.input.trustedEnergySessionScope.projectId)) {
          throw new Error("OVERVIEW_AI_RUNTIME_PROJECT_SCOPE_MISMATCH");
        }
        const identity = resolveRunIdentity({
          ...(energySessionScope
            ? {
                energySessionScope,
              }
            : {}),
          effectiveRunConfig,
          ...(interactionResume ? { interactionResume } : {}),
          metadataStore: this.input.metadataStore,
          modelName: modelProvider.model_name,
          runCancelRegistry: this.input.runCancelRegistry,
          runEventWriter,
          runInput: normalizedRunInput,
          userId: this.input.user.id,
          userInput
        });
        if (identity.kind === "replay") {
          identity.events.forEach(emitClientEvent);
          subscriber.complete();
          return;
        }
        persistClaimedEnergyPreparation({
          trace: energyPreparationTrace,
          metadataStore: this.input.metadataStore,
          runId,
          sessionId,
          userId: this.input.user.id,
        });
        energyPreparationTrace?.record("run-claimed");
        const { isResume, selectedDatasourceId } = identity;
        let checkpointResumeSeed: CheckpointResumeSeed | undefined;
        try {
          checkpointResumeSeed = resolveCheckpointResumeSeed({
            metadataStore: this.input.metadataStore,
            runInput: normalizedRunInput,
            sessionId,
            userId: this.input.user.id
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const durable = transitionEarlyRunFailure({
            ...(energySessionScope
              ? {
                  energySessionScope,
                }
              : {}),
            errorMessage: message,
            isResume: Boolean(interactionResume),
            metadataStore: this.input.metadataStore,
            runId,
            runInput: normalizedRunInput,
            sessionId,
            userId: this.input.user.id,
            userInput
          });
          emitEarlyRunFailure(clientSubscriber, runId, message, durable);
          return;
        }

        const memoryAssembly = await createRunMemoryAssembly({
          conversationMemoryMode: this.input.conversationMemoryMode,
          ...(overviewAiStageOptions?.conversationMessageMaxChars
            ? { conversationMessageMaxChars: overviewAiStageOptions.conversationMessageMaxChars }
            : {}),
          isResume,
          metadataStore: this.input.metadataStore,
          model: modelProvider.model,
          modelName: modelProvider.model_name,
          modelTemperature: modelSettings?.temperature,
          runId,
          runInput: normalizedRunInput,
          ...(selectedDatasourceId ? { selectedDatasourceId } : {}),
          sessionId,
          taskStateRuntime: this.input.taskStateRuntime,
          userId: this.input.user.id,
          userInput,
          evidenceRefs: effectiveRunConfig.evidenceRefs
        });
        const {
          conversationMemoryObserver,
          conversationMessages,
          longTermMemories
        } = memoryAssembly;
        const authoritativeEnergyQueryContext = trustedEnergyTextContract ?? energyQueryContext;
        const runContext = createRunAgentContext({
          effectiveRunConfig,
          modelProvider,
          ...(reasoningModel !== undefined ? { reasoningModel } : {}),
          runId,
          ...(selectedDatasourceId ? { selectedDatasourceId } : {}),
          sessionId,
          userId: this.input.user.id,
          userInput,
          workspaceId: this.input.workspaceId,
          ...(authoritativeEnergyQueryContext
            ? { energyQueryContext: authoritativeEnergyQueryContext }
            : {})
        });
        const evidenceContext = resolveEvidenceReferenceContext({
          evidenceRefs: effectiveRunConfig.evidenceRefs,
          metadataStore: this.input.metadataStore,
          sessionId,
          userId: this.input.user.id,
          workspaceId: this.input.workspaceId
        });
        const authoritativeContextItems = [
          ...createEnergyAuthoritativeContextItems({
            ...(energyAnalysisWorkspace
              ? { analysisWorkspace: energyAnalysisWorkspace.semantics }
              : {}),
            ...(energyQueryContext ? { context: energyQueryContext } : {}),
            ...(shouldIncludeProjectAnalysisEvidenceContext(this.input.overviewAiStage)
              && contextEvidenceSelection && projectAnalysisSnapshot ? { projectAnalysisSnapshot } : {}),
            ...(shouldIncludeProjectAnalysisEvidenceContext(this.input.overviewAiStage)
              && contextEvidenceSelection && contextEvidenceCatalog ? { contextEvidenceCatalog } : {}),
            ...(shouldIncludeProjectAnalysisEvidenceContext(this.input.overviewAiStage)
              && contextEvidenceSelection ? { contextEvidenceSelection } : {}),
            ...(publishedProjectRelease ? { projectRelease: publishedProjectRelease } : {}),
            ...(energySessionForkProvenance
              ? { sessionFork: energySessionForkProvenance }
              : {}),
            sessionId,
            ...(trustedEnergyTextContract ? { trustedTextContract: trustedEnergyTextContract } : {}),
            userId: this.input.user.id
          }),
          ...evidenceContext.items
        ];
        const taskPlanProjector = new TaskPlanProjector(runContext);
        const toolCallResultBridge = new ToolCallResultBridge();
        const checkpointProjector = new RunCheckpointProjector(this.input.metadataStore, this.input.user.id);
        const traceSectionCoordinator = this.input.traceSectionSummaries === false
          ? undefined
          : new TraceSectionCoordinator(
            this.input.metadataStore,
            modelProvider,
            this.input.user.id
          );
        const contextPackageRecorder = createMetadataContextPackageRecorder({
          metadataStore: this.input.metadataStore,
          runId,
          sessionId,
          userId: this.input.user.id
        });
        const modelRequestSnapshotRecorder = createMetadataModelRequestSnapshotRecorder({
          metadataStore: this.input.metadataStore,
          runId,
          sessionId,
          userId: this.input.user.id
        });
        const protocolStateStore = new MetadataProtocolStateStore(
          this.input.metadataStore,
          this.input.user.id
        );
        const runAbortController = new AbortController();
        const interactionRuntime = new InteractionRuntimeAdapter(
          this.input.metadataStore,
          this.input.user.id,
          sessionId,
          runId
        );
        const eventPipeline = new RunEventPipeline({
          checkpointProjector,
          conversationMemoryObserver,
          runEventWriter,
          runId,
          sessionId,
          taskPlanProjector,
          ...(traceSectionCoordinator ? { traceSectionCoordinator } : {}),
          toolCallResultBridge,
          userId: this.input.user.id,
          sink: emitClientEvent
        });
        const emit = (event: BaseEvent): void => {
          eventPipeline.emit(event);
          energyPreparationTrace?.observeRuntimeEvent(event);
        };
        // Replayed journal entries are delivery recovery, not fresh model output.
        // Bypass the live latency observer so a prior process cannot consume the
        // resumed Run's first-model milestone.
        replayPendingProtocolEvents({
          runId,
          stateStore: protocolStateStore,
          emit: (event) => eventPipeline.emit(event),
        });
        const packageEvidenceDirect = analysisContextPackageStatus === "package_hit"
          && contextEvidenceSelection?.mode === "sufficient"
          && !overviewAiStageOptions;
        const lazyDatasourceId = (analysisContextPackageStatus === "targeted_query"
          || analysisContextPackageStatus === "full_materialization_missing")
          && energyQueryContext && publishedMeterRoute
          ? `energyiq-lazy-${runId}`
          : undefined;
        const lazyEnergyQueryContext = lazyDatasourceId ? energyQueryContext! : undefined;
        const packageEvidenceRunConfig = packageEvidenceDirect
          ? {
              ...effectiveRunConfig,
              enabledDatasourceIds: [],
              protocol: {
                protocolId: "data-analysis",
                protocolVersion: "1",
              },
            }
          : undefined;
        if (packageEvidenceRunConfig) {
          delete packageEvidenceRunConfig.activeDatasourceId;
        }
        const assemblyEffectiveRunConfig = packageEvidenceRunConfig
          ?? (lazyDatasourceId
            ? {
              ...effectiveRunConfig,
              activeDatasourceId: lazyDatasourceId,
              enabledDatasourceIds: [lazyDatasourceId],
              resourceRevisions: {
                ...effectiveRunConfig.resourceRevisions,
                [`datasource:${lazyDatasourceId}`]: 1,
              },
            }
            : effectiveRunConfig);
        const assemblyRunContext = lazyDatasourceId
          ? createRunAgentContext({
              effectiveRunConfig: assemblyEffectiveRunConfig,
              modelProvider,
              ...(reasoningModel !== undefined ? { reasoningModel } : {}),
              runId,
              selectedDatasourceId: lazyDatasourceId,
              sessionId,
              userId: this.input.user.id,
              userInput,
              workspaceId: this.input.workspaceId,
              energyQueryContext: lazyEnergyQueryContext!,
            })
          : runContext;
        const assemblyDataGateway: DataGateway = lazyDatasourceId
          ? createLazyEnergyTargetedQueryGateway({
              dataGateway: this.input.dataGateway,
              virtualDatasourceId: lazyDatasourceId,
              ensureWorkspace: async () => {
                const workspace = await ensureEnergyIqAnalysisWorkspace({
                  metadataStore: this.input.metadataStore,
                  userId: this.input.user.id,
                  context: lazyEnergyQueryContext!,
                  publishedMeterRoute: publishedMeterRoute!,
                });
                energyPreparationTrace?.record("scoped-datasource-ready");
                return workspace;
              },
            })
          : this.input.dataGateway;
        const agentAssembly = await (this.input.runAgentAssemblyFactory ?? createRunAgentAssembly)({
          ...(lazyDatasourceId ? { preferEvidenceContextBeforeDataTools: true } : {}),
          ...(packageEvidenceDirect
            ? {
                excludedToolNames: ["inspect_schema", "run_sql_readonly", "protocol_handoff"],
              }
            : {}),
          ...(trustedEnergyTextContract || energyQueryContext
            ? {
                // The server-created EnergyIQ view is already the physical,
                // allowlisted contract for this project/scope/time range.
                // Preserve Data Foundry's downstream SQL validation without a
                // second model call that can drift from the trusted boundary.
                analysisContractGrounder: energyAnalysisWorkspace
                  ? createEnergyAnalysisContractGrounder(
                      energyAnalysisWorkspace.semantics,
                      contextEvidenceCatalog,
                    )
                  : contextEvidenceCatalog
                    ? createEnergyContextEvidenceGrounder(contextEvidenceCatalog)
                  : async (groundingInput) => ({
                      requirements: groundingInput.requirements,
                      findings: []
                    })
              }
            : {}),
          abortSignal: runAbortController.signal,
          ...(contextEvidenceCatalog ? { contextEvidenceCatalog } : {}),
          ...(overviewAiStageOptions
            ? {
                analysisRequirementsMode: overviewAiStageOptions.analysisRequirementsMode,
                ...(overviewAiStageOptions.disableTools ? { disableTools: true } : {}),
                ...(overviewAiStageOptions.overviewAiCandidateSubmission
                  ? { overviewAiCandidateSubmission: true }
                  : {}),
                ...(overviewAiStageOptions.additionalAiInsightSubmission
                  ? { additionalAiInsightSubmission: true }
                  : {}),
                ...(overviewAiStageOptions.excludedToolNames.length > 0
                  ? { excludedToolNames: overviewAiStageOptions.excludedToolNames }
                  : {}),
                ...(overviewAiStructuredOutput
                  ? { structuredOutput: overviewAiStructuredOutput }
                  : {}),
                ...(overviewAiStageOptions.trustedStageTools
                  ? { trustedStageTools: overviewAiStageOptions.trustedStageTools }
                  : {}),
                ...(overviewAiStageOptions.trustedStageCapability
                  ? { trustedStageCapability: overviewAiStageOptions.trustedStageCapability }
                  : {}),
              }
            : {}),
          contextPackageRecorder,
          modelRequestSnapshotRecorder,
          contextPackageExists: (reference) => Boolean(
            this.input.metadataStore.contextPackageSnapshots.findByPackageRevision({
              user_id: this.input.user.id,
              package_id: reference.packageId,
              revision: reference.revision
            })
          ),
          dataGateway: assemblyDataGateway,
          artifactService: this.input.artifactService,
          sessionOutputService: this.input.sessionOutputService,
          effectiveRunConfig: assemblyEffectiveRunConfig,
          ...(authoritativeContextItems.length
            ? { evidenceContextItems: authoritativeContextItems }
            : {}),
          fileAssetService: this.input.fileAssetService,
          emitter: { emit },
          ...(effectiveRunConfig.goal ? { goal: effectiveRunConfig.goal } : {}),
          ...(checkpointResumeSeed ? { initialContextPackage: checkpointResumeSeed.contextPackage } : {}),
          ...(interactionResume ? { interactionResume } : {}),
          knowledgeService: this.input.knowledgeService,
          longTermMemories,
          mcpRuntime,
          messages: conversationMessages,
          ...(modelContextProfile ? { modelContextProfile } : {}),
          modelProvider,
          protocolStateStore,
          ...(modelSettings ? { modelSettings } : {}),
          runContext: assemblyRunContext,
          selectedSkills,
          skillSelection,
          taskStateRuntime: this.input.taskStateRuntime,
          userId: this.input.user.id,
          workspaceId: this.input.workspaceId,
          workspaceRoot: this.input.workspaceRoot
        });
        const finalizer = new RunFinalizer({
          destroyWorkspace: agentAssembly.destroyWorkspace,
          emit,
          fileAssetService: this.input.fileAssetService,
          flushCompletedMemory: this.input.completedMemoryFlushOverride
            ? async () => this.input.completedMemoryFlushOverride!()
            : (flushInput) => memoryAssembly.flushCompletedMemory(flushInput),
          flushDraftsMemory: () => {
            memoryAssembly.flushDraftsMemory();
          },
          memoryExtractionTimeoutMs: this.input.memoryExtractionTimeoutMs,
          metadataStore: this.input.metadataStore,
          runId,
          sessionId,
          userId: this.input.user.id,
          sessionDir: agentAssembly.sessionDir,
          workspaceId: this.input.workspaceId
        });
        let subscription: { unsubscribe(): void } | undefined;
        let suspended = false;
        let resumeResolved = false;
        let finalization: Promise<void> | undefined;
        let unregisterCancel = (): void => undefined;
        let runTimeout: ReturnType<typeof setTimeout> | undefined;
        let terminalStarted = false;
        let sessionTitleStarted = false;
        let lastAssistantMessageId: string | undefined;
        /** toolCallIds that already persisted TOOL_CALL_START in this run (HITL atomic contract). */
        const startedToolCallIds = new Set<string>();
        const clearRunTimeout = (): void => {
          if (runTimeout) {
            clearTimeout(runTimeout);
            runTimeout = undefined;
          }
        };
        const failRun = (message: string, terminalEvent?: BaseEvent): void => {
          if (terminalStarted) {
            return;
          }
          terminalStarted = true;
          runAbortController.abort(new Error(message));
          clearRunTimeout();
          unregisterCancel();
          finalizer.fail({
            errorMessage: message,
            terminalEvent: terminalEvent ?? {
              type: EventType.RUN_ERROR,
              message,
              timestamp: Date.now()
            }
          });
        };
        const cancelRun = (reason = "RUN_CANCELLED"): void => {
          if (terminalStarted) {
            return;
          }
          terminalStarted = true;
          runAbortController.abort(new Error(reason));
          clearRunTimeout();
          subscription?.unsubscribe();
          finalization = retainRunOwnershipUntilFinalized(
            finalizer.cancelRun({
              reason,
              terminalEvent: {
                type: EventType.RUN_FINISHED,
                status: "cancelled",
                timestamp: Date.now()
              } as BaseEvent
            }),
            unregisterCancel,
          );
          void finalization.then(() => subscriber.complete(), (error: unknown) => subscriber.error(error));
        };
        unregisterCancel = this.input.runCancelRegistry.register({
          cancel: cancelRun,
          runId,
          sessionId,
          userId: this.input.user.id
        });
        // The browser transport can close or reconnect before the governed
        // Agent emits its semantic terminal event. The Run remains owned by
        // this process and must continue durably in the background; binding
        // its cancel handle or model subscription to the transport teardown
        // makes Session polling reclaim a healthy long Run as an orphan.

        if (this.input.conversationMemoryMode === "working-memory-readonly") {
          await ensureConversationWorkingMemoryThread({
            resourceId: this.input.user.id,
            taskStateRuntime: this.input.taskStateRuntime,
            threadId: sessionId
          });
        }

        subscription = agentAssembly.mastraAgent.run({
          ...normalizedRunInput,
          runId,
          messages: agentAssembly.governedMessages
        }).subscribe({
          next: (event) => {
            if (terminalStarted) {
              return;
            }
            const assistantMessageId = assistantMessageIdFromEvent(event);
            if (assistantMessageId) {
              lastAssistantMessageId = assistantMessageId;
            }
            let interactionRequested: ReturnType<InteractionRuntimeAdapter["capture"]>;
            try {
              interactionRequested = interactionRuntime.capture(event);
            } catch (error) {
              const message = error instanceof Error ? error.message : "Invalid interaction interrupt";
              failRun(message);
              return;
            }
            if (interactionRequested) {
              terminalStarted = true;
              clearRunTimeout();
              unregisterCancel();
              suspended = true;
              // R-018: persist TOOL_CALL_START with the interactions row when the stream
              // never emitted one (common for Mastra on_interrupt before tool-start).
              if (!startedToolCallIds.has(interactionRequested.interrupt.toolCallId)) {
                emit(buildHitlToolCallStartEvent(interactionRequested.interrupt));
                startedToolCallIds.add(interactionRequested.interrupt.toolCallId);
              }
              emit(interactionRequested.event);
              finalizer.suspend();
              // CopilotKit useInterrupt listens for the native Mastra interrupt event.
              if (event.type === EventType.CUSTOM && event.name === "on_interrupt") {
                emit(event);
              }
              // Stream must finalize so CopilotKit can surface the interrupt UI via onRunFinalized.
              // This synthetic terminal event is transport-only; suspended runs must not replay as finished.
              emitClientEvent(withRunTerminalIdentity({
                type: EventType.RUN_FINISHED,
                timestamp: Date.now()
              }, {
                kind: "transport-suspended",
                runId,
                status: "suspended"
              }));
              return;
            }
            if (event.type === EventType.RUN_FINISHED && suspended) {
              return;
            }
            if (event.type === EventType.RUN_FINISHED && interactionResume?.response === false) {
              try {
                const interactionResolvedEvent = interactionRuntime.cancel(interactionResume);
                terminalStarted = true;
                clearRunTimeout();
                finalization = retainRunOwnershipUntilFinalized(
                  finalizer.cancel({
                    interactionResolvedEvent,
                    terminalEvent: event
                  }),
                  unregisterCancel,
                );
              } catch (error) {
                const message = error instanceof Error ? error.message : "Interaction cancel failed";
                failRun(message);
              }
              return;
            }
            if (event.type === EventType.RUN_FINISHED) {
              terminalStarted = true;
              clearRunTimeout();
              const persistedAssistantMessage = lastAssistantMessageId
                ? undefined
                : this.input.metadataStore.conversationMessages.findLatestAssistantByRun({
                    user_id: this.input.user.id,
                    session_id: sessionId,
                    run_id: runId
                  });
              finalization = retainRunOwnershipUntilFinalized(
                completeProtocolRun({
                  finalizer,
                  ...(agentAssembly.goalRuntime ? { goalRuntime: agentAssembly.goalRuntime } : {}),
                  ...(lastAssistantMessageId ? { lastAssistantMessageId } : {}),
                  ...(persistedAssistantMessage?.message_id
                    ? { persistedAssistantMessageId: persistedAssistantMessage.message_id }
                    : {}),
                  protocol: agentAssembly.protocol,
                  runId,
                  terminalEvent: event
                }),
                unregisterCancel,
              );
              return;
            }
            if (event.type === EventType.RUN_ERROR) {
              failRun("AG-UI run error", event);
              return;
            }
            if (
              event.type === EventType.TOOL_CALL_START
              && typeof event.toolCallId === "string"
              && event.toolCallId.length > 0
            ) {
              startedToolCallIds.add(event.toolCallId);
            }
            emit(event);

            if (event.type === EventType.RUN_STARTED) {
              agentAssembly.flushProtocolEvents();
            }

            if (
              interactionResume
              && !resumeResolved
              && event.type === EventType.TOOL_CALL_RESULT
              && event.toolCallId === interactionResume.interrupt.toolCallId
            ) {
              try {
                emit(interactionRuntime.resolve(interactionResume));
                resumeResolved = true;
              } catch (error) {
                const message = error instanceof Error ? error.message : "Interaction resume failed";
                failRun(message);
              }
            }

            if (event.type === EventType.RUN_STARTED) {
              emit(createCustomEvent("run.config.resolved", {
                active_datasource_id: effectiveRunConfig.activeDatasourceId,
                active_skill_id: effectiveRunConfig.activeSkillId,
                enabled_datasource_ids: effectiveRunConfig.enabledDatasourceIds,
                file_ids: effectiveRunConfig.fileIds,
                enabled_knowledge_ids: effectiveRunConfig.enabledKnowledgeIds,
                enabled_mcp_server_ids: effectiveRunConfig.enabledMcpServerIds,
                selected_skill_ids: selectedSkills.map((skill) => skill.id),
                skill_mode: effectiveRunConfig.skillMode,
                requested_llm_profile_id: effectiveRunConfig.activeLlmProfileId,
                active_llm_profile_id: effectiveRunConfig.activeLlmProfileId,
                workspace_id: this.input.workspaceId,
                workspace: agentAssembly.workspace,
                ...createRunConfigAuditCapture({
                  ...(effectiveRunConfig.resourceRevisions
                    ? { resourceRevisions: effectiveRunConfig.resourceRevisions }
                    : {}),
                  mcpToolNamesByServerId: mcpRuntime.toolNamesByServerId,
                }),
                ...(modelContextProfile
                  ? {
                      context_window: modelContextProfile.contextWindow,
                      max_output_tokens: modelContextProfile.maxOutputTokens,
                      output_reserve: modelContextProfile.outputReserve,
                      safety_margin: modelContextProfile.safetyMargin,
                      capability_source: modelContextProfile.capabilitySource,
                      input_budget: Math.max(
                        modelContextProfile.contextWindow
                          - modelContextProfile.outputReserve
                          - modelContextProfile.safetyMargin,
                        0
                      )
                    }
                  : {}),
                ...(reasoningModel !== undefined ? { reasoning_model: reasoningModel } : {}),
                ...(this.input.overviewAiStage ? { overview_ai_stage: this.input.overviewAiStage } : {}),
                ...(runTimeoutMs !== undefined ? { run_timeout_ms: runTimeoutMs } : {}),
                ...(effectiveRunConfig.mentioned
                  ? {
                      mentioned: {
                        db: effectiveRunConfig.mentioned.db,
                        kb: effectiveRunConfig.mentioned.kb,
                        mcp: effectiveRunConfig.mentioned.mcp,
                        skill: effectiveRunConfig.mentioned.skill,
                        ...(effectiveRunConfig.mentioned.excluded && effectiveRunConfig.mentioned.excluded.length > 0
                          ? { excluded: effectiveRunConfig.mentioned.excluded }
                          : {})
                      }
                    }
                  : {}),
                ...((effectiveRunConfig.pinnedPaths?.length ?? 0) > 0
                  ? { pinned_paths: effectiveRunConfig.pinnedPaths }
                  : {}),
                ...(effectiveRunConfig.evidenceRefs.length > 0
                  ? {
                      evidence_refs: effectiveRunConfig.evidenceRefs,
                      evidence_resolution: evidenceContext.diagnostics
                    }
                  : {}),
                ...(effectiveRunConfig.disabledByPolicy && effectiveRunConfig.disabledByPolicy.length > 0
                  ? { disabled_by_policy: effectiveRunConfig.disabledByPolicy }
                  : {}),
                ...(effectiveRunConfig.unavailableResources && effectiveRunConfig.unavailableResources.length > 0
                  ? { unavailable_resources: effectiveRunConfig.unavailableResources }
                  : {})
              }));
              emit(createCustomEvent("skill.selection", {
                audit: skillSelection.audit,
                effective_tool_policy: skillSelection.effectiveToolPolicy,
                mode: effectiveRunConfig.skillMode,
                selected: selectedSkills.map((skill) => ({
                  id: skill.id,
                  name: skill.name,
                  revision: skill.revision,
                  tags: skill.tags
                }))
              }));
              emitRunSkillEvidenceAuditEvents({
                emit,
                loadedSkills: agentAssembly.loadedSkills,
                materializedSkills: agentAssembly.materializedSkills,
                runId,
              });
              emit({
                type: EventType.STATE_SNAPSHOT,
                snapshot: {
                  selectedDatasourceId,
                  runId,
                  runStatus: "running",
                  sessionId
                },
                timestamp: Date.now()
              });
              if (!isResume && !sessionTitleStarted && this.input.overviewAiStage !== "html-slot") {
                sessionTitleStarted = true;
                startSessionTitleTask({
                  // Title generation is async and may finish after the agent run
                  // terminals; still forward the event while the stream is open
                  // (finalizer continues emitting after RUN_FINISHED).
                  emit,
                  metadataStore: this.input.metadataStore,
                  model: modelProvider.model,
                  modelTemperature: modelSettings?.temperature,
                  sessionId,
                  userId: this.input.user.id,
                  userInput
                });
              }
            }

          },
          error: (error: unknown) => {
            const normalizedError = this.input.overviewAiStage
              ? normalizeOverviewAiStageRuntimeError(this.input.overviewAiStage, error)
              : error;
            const message = normalizedError instanceof Error
              ? normalizedError.message
              : "Unknown AG-UI agent error";
            const event: BaseEvent = {
              type: EventType.RUN_ERROR,
              message,
              timestamp: Date.now()
            };
            failRun(message, event);
            subscriber.complete();
          },
          complete: () => {
            clearRunTimeout();
            if (finalization) {
              void finalization.then(() => subscriber.complete(), (error: unknown) => subscriber.error(error));
              return;
            }
            unregisterCancel();
            subscriber.complete();
          }
        });

        if (runTimeoutMs !== undefined) {
          runTimeout = setTimeout(() => {
            runAbortController.abort(new Error(`RUN_TIMEOUT:${runTimeoutMs}`));
            subscription?.unsubscribe();
            failRun(`RUN_TIMEOUT:${runTimeoutMs}`);
            subscriber.complete();
          }, runTimeoutMs);
        }

      };

      run().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        const durable = transitionEarlyRunFailure({
          errorMessage: message,
          isResume: Boolean(interactionResume),
          metadataStore: this.input.metadataStore,
          runId,
          runInput,
          sessionId: runInput.threadId,
          userId: this.input.user.id,
          userInput: extractLastUserText(runInput) ?? "CopilotKit AG-UI run"
        });
        if (durable) {
          persistClaimedEnergyPreparation({
            trace: energyPreparationTrace,
            metadataStore: this.input.metadataStore,
            runId,
            sessionId: runInput.threadId,
            userId: this.input.user.id,
          });
        }
        emitEarlyRunFailure(clientSubscriber, runId, message, durable);
      });
    });
  }
}

const isCopilotKitPath = (pathname: string): boolean =>
  pathname === COPILOTKIT_PATH || pathname.startsWith(`${COPILOTKIT_PATH}/`);

const sendCorsPreflight = (response: ServerResponse): void => {
  response.writeHead(204, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Idempotency-Key, If-Match, X-CSRF-Token, X-Dev-Token, X-Workspace-Id",
    "Access-Control-Max-Age": "86400"
  });
  response.end();
};

export type RequestAuthContext = {
  identity: AuthIdentity;
  user: MeResponse;
  workspaceId: string;
};

const resolveRequestAuth = (
  request: IncomingMessage,
  metadataStore: MetadataStore,
  authConfig: PasswordAuthConfig,
  authService: AuthService
): RequestAuthContext => {
  if (isPasswordAuth(authConfig)) {
    const identity = resolvePasswordSessionIdentity(authService, request);
    const requestedWorkspaceId = sanitizeOptionalWorkspaceId(
      headerString(request.headers["x-workspace-id"])
    );
    const access = resolveEnergyAccessContext({
      metadataStore,
      user: identity.user,
      ...(requestedWorkspaceId ? { requestedWorkspaceId } : {})
    });
    const workspace = access.activeWorkspaceId
      ? metadataStore.workspaces.get({ id: access.activeWorkspaceId })
      : identity.workspace;
    return {
      identity: { ...identity, workspace },
      user: userRecordToMeResponse(identity.user),
      workspaceId: workspace.id
    };
  }

  const token = extractAuthToken(request);
  const workspaceId = sanitizeWorkspaceId(headerString(request.headers["x-workspace-id"]));
  const devUser = metadataStore.users.getById({ user_id: DEV_USER.id });
  const devWorkspace = metadataStore.workspaces.get({ id: workspaceId });
  const devIdentity = {
    user: devUser,
    workspace: devWorkspace
  };
  if (!token) {
    return { identity: devIdentity, user: DEV_USER, workspaceId };
  }
  const user = metadataStore.users.getByDevToken({ dev_token: token });
  if (!user) {
    throw new Error("UNAUTHORIZED:Invalid local auth token.");
  }
  const access = resolveEnergyAccessContext({
    metadataStore,
    user,
    requestedWorkspaceId: workspaceId
  });
  const workspace = metadataStore.workspaces.get({ id: access.activeWorkspaceId });
  return {
    identity: {
      user,
      workspace
    },
    user: userRecordToMeResponse(user),
    workspaceId: workspace.id
  };
};

const ensureConversationWorkingMemoryThread = async (input: {
  resourceId: string;
  taskStateRuntime: TaskStateRuntime;
  threadId: string;
}): Promise<void> => {
  const existing = await input.taskStateRuntime.memory.getThreadById({
    resourceId: input.resourceId,
    threadId: input.threadId
  });
  if (existing) {
    return;
  }
  await input.taskStateRuntime.memory.createThread({
    memoryConfig: CONVERSATION_WORKING_MEMORY_CONFIG,
    resourceId: input.resourceId,
    saveThread: true,
    threadId: input.threadId
  });
};

const isPasswordAuth = (config: PasswordAuthConfig): boolean => config.mode === "password";

const extractAuthToken = (request: IncomingMessage): string | undefined => {
  const authorization = headerString(request.headers.authorization);
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim() || undefined;
  }
  return headerString(request.headers["x-dev-token"]);
};

const sanitizeWorkspaceId = (value: string | undefined): string => {
  const candidate = value?.trim() || DEFAULT_WORKSPACE_ID;
  if (!/^[a-zA-Z0-9._-]{1,128}$/u.test(candidate)) {
    throw new Error("UNAUTHORIZED:Invalid workspace id.");
  }
  return candidate;
};

const sanitizeOptionalWorkspaceId = (value: string | undefined): string | undefined =>
  value === undefined ? undefined : sanitizeWorkspaceId(value);

const headerString = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const userRecordToMeResponse = (user: UserRecord): MeResponse => ({
  id: user.id,
  ...(user.email ? { email: user.email } : {}),
  ...(user.display_name ? { display_name: user.display_name } : {}),
  ...(user.avatar_url ? { avatar_url: user.avatar_url } : {})
});

const ensureDevUser = (metadataStore: MetadataStore): void => {
  metadataStore.users.upsertDevUser({
    id: DEV_USER.id,
    email: DEV_USER.email ?? "admin@energyiq.local",
    display_name: DEV_USER.display_name ?? "EnergyIQ Admin",
    dev_token: "dev-token"
  });
};

const sendJson = (
  response: ServerResponse,
  statusCode: number,
  body: unknown,
  headers: Record<string, string> = {},
): void => {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(JSON.stringify(body));
};

const BUILTIN_DEMO_DATASOURCE_ID = "api-duckdb-demo";

/** Drop previously auto-seeded builtin demo datasources; they are no longer injected by default. */
const removeLegacyBuiltinDemoDataSource = (metadataStore: MetadataStore, userId: string): void => {
  const current = metadataStore.dataSources.find({
    user_id: userId,
    datasource_id: BUILTIN_DEMO_DATASOURCE_ID
  });
  if (!current) return;
  try {
    const config = JSON.parse(current.config_json) as Record<string, unknown>;
    if (config.builtin === true && config.mode === "demo") {
      metadataStore.dataSources.delete({
        user_id: userId,
        datasource_id: BUILTIN_DEMO_DATASOURCE_ID
      });
    }
  } catch {
    // Ignore malformed legacy rows; leave non-demo datasources untouched.
  }
};

const removeLegacyBuiltinDemoDataSourceOnce = (metadataStore: MetadataStore, userId: string): void => {
  if (legacyDemoRemovedUsers.has(userId)) return;
  removeLegacyBuiltinDemoDataSource(metadataStore, userId);
  legacyDemoRemovedUsers.add(userId);
};

const BUILTIN_SKILL_SOURCES = [
  { id: "data-analysis", path: join(BUILTIN_SKILL_ROOT, "data-analysis", "SKILL.md") },
  {
    id: "energy-insight-investigation",
    path: join(BUILTIN_SKILL_ROOT, "energy-insight-investigation", "SKILL.md")
  }
] as const;

const ensureBuiltinConfigResources = async (
  fileAssetService: LocalFileAssetService,
  metadataStore: MetadataStore,
  userId: string,
  workspaceId: string
): Promise<void> => {
  const common = { workspace_id: workspaceId, user_id: userId };
  const currentServerDefault = metadataStore.configResources.find({
    ...common,
    kind: "model-profile",
    id: "server-default"
  });
  if (isServerLlmEnvConfigured(process.env)) {
    if (!currentServerDefault) {
      metadataStore.configResources.upsert({
        ...common,
        kind: "model-profile",
        id: "server-default",
        name: "default",
        description: "Uses the server LLM environment variables.",
        payload: { provider: "server", modelName: "server", baseUrl: "server" },
        builtin: true,
        status: "untested"
      });
    } else {
      const nextStatus = serverDefaultConnectionStatus({
        currentStatus: currentServerDefault.status,
        storedFingerprint: stringRecordValue(currentServerDefault.payload, "llmEnvFingerprint"),
        env: process.env
      });
      if (nextStatus !== currentServerDefault.status) {
        metadataStore.configResources.upsert({
          ...common,
          kind: "model-profile",
          id: "server-default",
          name: currentServerDefault.name,
          ...(currentServerDefault.description ? { description: currentServerDefault.description } : {}),
          payload: currentServerDefault.payload,
          default_enabled: currentServerDefault.default_enabled,
          builtin: true,
          status: nextStatus,
          expected_revision: currentServerDefault.revision
        });
      }
    }
  } else if (currentServerDefault?.builtin) {
    metadataStore.configResources.delete({
      ...common,
      kind: "model-profile",
      id: "server-default"
    });
  }
  ensureBuiltinDtcGrowthDatasource({
    metadataStore,
    userId,
    workspaceId
  });

  for (const source of BUILTIN_SKILL_SOURCES) {
    const content = readFileSync(source.path);
    const contentSha256 = createHash("sha256").update(content).digest("hex");
    const current = metadataStore.configResources.find({ ...common, kind: "skill", id: source.id });
    const currentPackageRefId = stringRecordValue(current?.payload, "packageFileRefId");
    const currentContentSha256 = stringRecordValue(current?.payload, "builtinContentSha256");
    if (currentPackageRefId && currentContentSha256 === contentSha256 && current?.status === "valid") {
      continue;
    }
    const parsed = await parseSkillPackage({
      content,
      filename: "SKILL.md",
      mimeType: "text/markdown"
    });
    const packageRef = fileAssetService.createRef({
      user_id: userId,
      workspace_id: workspaceId,
      filename: "SKILL.md",
      content,
      declared_mime_type: "text/markdown",
      source: "skill-package",
      metadata: { builtin: true, kind: "skill-package", skill: parsed.name, version: parsed.version }
    });
    metadataStore.configResources.upsert({
      ...common,
      kind: "skill",
      id: source.id,
      name: parsed.name,
      description: parsed.description,
      payload: {
        ...buildSkillResourcePayload({
          fields: { packageSource: `builtin://${source.id}` },
          packageFileRefId: packageRef.ref.id,
          parsed
        }),
        builtinContentSha256: contentSha256,
        builtinSource: `builtin://${source.id}`
      },
      builtin: true,
      default_enabled: false,
      status: "valid"
    });
  }
  await materializeConfiguredSkillCache(fileAssetService, metadataStore, userId, workspaceId);
};

/**
 * Builtins are idempotent for a process lifetime (content changes require redeploy).
 * Memoize per user/workspace and coalesce concurrent first hits.
 */
const ensureBuiltinConfigResourcesOnce = createAsyncMemoByKey(
  ensureBuiltinConfigResources,
  (_fileAssetService, _metadataStore, userId, workspaceId) => `${userId}:${workspaceId}`,
);

const materializeConfiguredSkillCache = async (
  fileAssetService: LocalFileAssetService,
  metadataStore: MetadataStore,
  userId: string,
  workspaceId: string
): Promise<void> => {
  const skills = metadataStore.configResources.list({
    workspace_id: workspaceId,
    user_id: userId,
    kind: "skill"
  }).map(configResourceToSkillRecord)
    .filter((skill) => skill.status === "valid" && Boolean(skill.packageFileRefId));
  const signature = skills.map((skill) => `${skill.id}:${skill.revision}:${skill.packageFileRefId}`).sort().join("|");
  const cacheKey = `${userId}:${workspaceId}`;
  if (skillCacheSignatures.get(cacheKey) === signature) {
    return;
  }
  if (skills.length === 0) {
    skillCacheSignatures.set(cacheKey, signature);
    return;
  }
  const workspaceRoot = process.env.WORKSPACE_ROOT ?? join(process.env.STORAGE_ROOT_DIR ?? "storage", "workspaces");
  const skillCacheDir = resolveSkillCacheDir({
    runContext: {
      user_id: userId,
      workspace_id: workspaceId,
      session_id: "skill-cache",
      run_id: "skill-cache",
      selected_datasource_id: "",
      enabled_datasource_ids: [],
      user_input: "",
      chat_mode: "server",
      model_name: "skill-cache"
    },
    workspaceRoot
  });
  await materializeSkillPackages({
    fileAssetService,
    runDir: skillCacheDir,
    skills,
    userId,
    workspaceId
  });
  skillCacheSignatures.set(cacheKey, signature);
};

const stringRecordValue = (record: Record<string, unknown> | undefined, key: string): string | undefined => {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};
