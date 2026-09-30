import { createHash } from "node:crypto";

import {
  createAssistantMessageEventStream,
  createModels,
  createProvider,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxThinking,
  fauxToolCall,
  isContextOverflow,
  validateToolCall,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
  type TSchema,
  type Tool,
  type ToolResultMessage
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";

import {
  prepareProviderToolContract,
  resolveProviderToolContractCompatibility,
  type CanonicalToolInputValidator,
  type ProviderToolContractAccess
} from "../../../packages/providers/src/tool-contract-compatibility.js";

type JsonObject = Record<string, unknown>;

export type EnergyIqGatewayProfile = {
  profileId: string;
  revision: string;
  workspaceId: string;
  provider: string;
  model: string;
  baseUrl: string;
  secretRef: string;
  headers: Record<string, string>;
  reasoning: "enabled" | "disabled";
  contextWindow: number;
  maxOutputTokens: number;
  costRates?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
};

export type EnergyIqGatewayRequest = {
  projectId: string;
  actorId: string;
  sessionId: string;
  runId: string;
  requestId: string;
  stepId: string;
  retryIndex: number;
  systemPrompt?: string;
  messages: Array<{ role: "user" | "assistant"; text: string }>;
  tools: Array<{
    name: string;
    description: string;
    inputSchema: JsonObject;
    schemaPolicy?: "require" | "prefer" | "disabled";
  }>;
};

export type EnergyIqScriptedBlock =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | {
    type: "tool-call";
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  };

export type EnergyIqScriptedResponse = {
  blocks: EnergyIqScriptedBlock[];
  stopReason: "stop" | "length" | "tool-use" | "error";
  errorMessage?: string;
  responseId?: string;
};

type EnergyIqGatewayEventPayload =
  | {
    type: "request-started";
    requestId: string;
    profileId: string;
    profileRevision: string;
    reasoning: "enabled" | "disabled";
    observedHeaderNames: string[];
  }
  | { type: "text-delta"; contentIndex: number; text: string }
  | { type: "reasoning-delta"; contentIndex: number; text: string }
  | {
    type: "tool-call";
    contentIndex: number;
    toolCallId: string;
    toolName: string;
    arguments: Record<string, unknown>;
    argumentsStatus: "valid" | "invalid";
    executionStatus: "not-executed-by-gateway";
    failureKind?: "tool_arguments_invalid" | "unknown_tool";
  }
  | {
    type: "usage";
    usageStatus: "available" | "unavailable";
    usageSource: "pi-normalized-provider" | "unavailable";
    inputTokens: number | null;
    outputTokens: number | null;
    cacheReadTokens: number | null;
    cacheWriteTokens: number | null;
    reasoningTokens: number | null;
    totalTokens: number | null;
    cost: {
      status: "estimated" | "unavailable";
      source: "energyiq-profile-rate-snapshot" | "unavailable";
      rateSnapshotHash: string | null;
      input: number | null;
      output: number | null;
      cacheRead: number | null;
      cacheWrite: number | null;
      total: number | null;
    };
  }
  | {
    type: "request-completed";
    stopReason: "stop" | "length" | "tool-use";
    overflowAssessment: "not-applicable" | "unavailable";
    upstreamResponseId?: string;
  }
  | { type: "request-deferred" }
  | { type: "request-aborted" }
  | {
    type: "request-failed";
    failureKind: "provider_error" | "context_overflow" | "timeout" | "auth_error" | "rate_limited";
    upstreamResponseId?: string;
  };

export type EnergyIqGatewayEvent = EnergyIqGatewayEventPayload & {
  eventId: string;
  eventFingerprint: string;
  requestId: string;
  sequence: number;
};

/** Reject replay data whose deterministic identity no longer matches its normalized content. */
export const assertPiAiGatewayEventIntegrity = (input: {
  attemptId: string;
  event: EnergyIqGatewayEvent;
}): void => {
  const { eventId, eventFingerprint, ...normalizedEvent } = input.event;
  const actualFingerprint = sha256(stableJson(normalizedEvent));
  if (actualFingerprint !== eventFingerprint) {
    throw new Error("PI_AI_EVENT_CONTENT_FINGERPRINT_MISMATCH");
  }
  const expectedEventId = sha256(stableJson({
    attemptId: input.attemptId,
    sequence: input.event.sequence,
    eventFingerprint
  }));
  if (expectedEventId !== eventId) {
    throw new Error("PI_AI_EVENT_ID_COLLISION");
  }
};

export type CompiledPiAiEvaluationProfile = {
  profile: {
    profileId: string;
    revision: string;
    workspaceId: string;
    provider: string;
    model: string;
    reasoning: "enabled" | "disabled";
    contextWindow: number;
    maxOutputTokens: number;
    costRates?: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
    };
    headerNames: string[];
    secretHandling: "server-owned-reference-not-exported";
  };
  requestIdentity: {
    provider: string;
    model: string;
    baseUrl: string;
    headerPolicyFingerprint: string;
    protocolCandidate: "openai-responses" | "openai-completions";
  };
};

export type PiAiGatewayEvaluationResult = CompiledPiAiEvaluationProfile & {
  attemptId: string;
  requestFingerprint: string;
  transportAudit: {
    provider: string;
    model: string;
    baseUrl: string;
    protocolCandidate: "openai-responses" | "openai-completions";
    reasoningRequested: "off" | "medium";
    reasoningObserved: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "unavailable";
    maxOutputTokens: number;
    timeoutMs: number;
    maxRetries: number;
    headerNames: string[];
    toolSchemas: Array<{
      name: string;
      mode: "json-schema" | "disabled" | "unspecified";
      strict?: "require" | "prefer";
    }>;
  };
  events: EnergyIqGatewayEvent[];
};

export type PiAiToolRoundTripAudit = {
  providerCallCount: number;
  toolCallId: string;
  toolName: string;
  argumentsStatus: "valid";
  executionOwner: "energyiq-external-to-pi-ai";
  resultStatus: "success" | "error";
  resultContentFingerprint: string;
  secondRequestObserved: boolean;
  finalText: string;
};

export type PiAiCatalogIsolationAudit = {
  exactModelAvailableBeforeMutation: boolean;
  exactModelAvailableAfterReplacement: boolean;
  offlineRefreshAborted: boolean;
  offlineRefreshErrorCount: number;
  networkFetchCount: number;
  profileSnapshotUnchanged: boolean;
  requestIdentityUnchanged: boolean;
  energyIqStoreBoundary: "not-wired-to-pi-catalog";
};

export type PiAiOpenAiCompatibleRequestAudit = {
  requestUrl: string;
  requestMethod: string;
  requestHeaderNames: string[];
  payload: {
    model: string;
    maxTokensField: "max_tokens" | "max_completion_tokens" | "unavailable";
    maxTokens: number | null;
    deepSeekThinkingEnabled: boolean;
    qwenThinkingEnabled: boolean;
    allMessageContentNonEmpty: boolean;
    emptyMessageCompatibilityApplied: boolean;
    toolNames: string[];
    strictToolSchema: boolean;
  };
  terminal: "stop" | "length" | "tool-use" | "error" | "aborted";
  finalText: string;
  localToolValidation:
    | { status: "not-applicable" }
    | { status: "valid"; toolName: string };
};

const SUPPORTED_PROFILE_PROVIDERS = new Set([
  "openai",
  "deepseek",
  "alibaba",
  "openai-compatible"
]);

/**
 * Evaluation-only projection. It deliberately excludes secret refs and header
 * values, and is not exported from the package index or used by production.
 */
export const compilePiAiEvaluationProfile = (
  source: EnergyIqGatewayProfile
): CompiledPiAiEvaluationProfile => {
  if (!SUPPORTED_PROFILE_PROVIDERS.has(source.provider)) {
    throw new Error(`Unsupported EnergyIQ Provider profile: ${source.provider}`);
  }
  if (source.model.trim().length === 0) throw new Error("EnergyIQ Profile model is required");
  const baseUrl = normalizeEvaluationBaseUrl(source.baseUrl);
  const headerNames = Object.keys(source.headers).sort();
  const headerPolicyFingerprint = sha256(stableJson({
    credentialRefFingerprint: sha256(source.secretRef),
    headerNames: headerNames.map((name) => name.toLowerCase()).sort(),
  }));
  return deepFreeze({
    profile: {
      profileId: source.profileId,
      revision: source.revision,
      workspaceId: source.workspaceId,
      provider: source.provider,
      model: source.model,
      reasoning: source.reasoning,
      contextWindow: source.contextWindow,
      maxOutputTokens: source.maxOutputTokens,
      ...(source.costRates ? { costRates: structuredClone(source.costRates) } : {}),
      headerNames,
      secretHandling: "server-owned-reference-not-exported"
    },
    requestIdentity: {
      provider: source.provider,
      model: source.model,
      baseUrl,
      headerPolicyFingerprint,
      protocolCandidate: source.provider === "openai"
        ? "openai-responses"
        : "openai-completions"
    }
  });
};

/**
 * Exercise pi-ai behind EnergyIQ-owned DTOs with its in-memory faux Provider.
 * No network access or real Provider credential is possible on this path.
 */
export const runPiAiGatewayEvaluation = async (input: {
  profile: EnergyIqGatewayProfile;
  request: EnergyIqGatewayRequest;
  scriptedResponse: EnergyIqScriptedResponse;
  syntheticCatalogModelIds?: string[];
  suppressedHeaderNames?: string[];
  syntheticStreamPattern?: "interleaved";
  usageEvidence?: "provider-reported" | "unavailable";
  syntheticReportedUsage?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    reasoning?: number;
    totalTokens: number;
  };
  deadlineMs?: number;
  syntheticResponseDelayMs?: number;
  signal?: AbortSignal;
  abortAfterFirstContentDelta?: () => void;
}): Promise<PiAiGatewayEvaluationResult> => {
  const compiled = compilePiAiEvaluationProfile(input.profile);
  const deadlineSignal = input.deadlineMs === undefined
    ? undefined
    : AbortSignal.timeout(input.deadlineMs);
  const effectiveSignal = input.signal && deadlineSignal
    ? AbortSignal.any([input.signal, deadlineSignal])
    : input.signal ?? deadlineSignal;
  const requestBoundary = {
    workspaceId: compiled.profile.workspaceId,
    projectId: input.request.projectId,
    actorId: input.request.actorId,
    sessionId: input.request.sessionId,
    runId: input.request.runId,
    requestId: input.request.requestId,
    stepId: input.request.stepId,
    retryIndex: input.request.retryIndex
  };
  for (const [name, value] of Object.entries(requestBoundary)) {
    if (typeof value === "string" && value.trim().length === 0) {
      throw new Error(`Exact EnergyIQ request identity is required: ${name}`);
    }
  }
  const requestFingerprint = sha256(stableJson({
    requestBoundary,
    profile: {
      profileId: compiled.profile.profileId,
      revision: compiled.profile.revision,
      workspaceId: compiled.profile.workspaceId,
      provider: compiled.profile.provider,
      model: compiled.profile.model,
      reasoning: compiled.profile.reasoning,
      contextWindow: compiled.profile.contextWindow,
      maxOutputTokens: compiled.profile.maxOutputTokens,
      baseUrl: compiled.requestIdentity.baseUrl,
      headerPolicyFingerprint: compiled.requestIdentity.headerPolicyFingerprint,
    },
    request: {
      systemPrompt: input.request.systemPrompt,
      messages: input.request.messages,
      tools: input.request.tools
    }
  }));
  const attemptId = sha256(stableJson({
    requestBoundary,
    profileId: compiled.profile.profileId,
    profileRevision: compiled.profile.revision,
    requestFingerprint
  }));

  const syntheticCatalogModelIds = input.syntheticCatalogModelIds ?? [input.profile.model];
  const faux = fauxProvider({
    api: `energyiq-evaluation-${requestFingerprint.slice(0, 12)}`,
    provider: input.profile.provider,
    models: syntheticCatalogModelIds.map((modelId) => ({
      id: modelId,
      name: modelId,
      reasoning: input.profile.reasoning === "enabled",
      input: ["text"],
      cost: compiled.profile.costRates ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: input.profile.contextWindow,
      maxTokens: input.profile.maxOutputTokens
    })),
    tokenSize: input.abortAfterFirstContentDelta
      ? { min: 1, max: 1 }
      : { min: 100_000, max: 100_000 },
    ...(input.abortAfterFirstContentDelta ? { tokensPerSecond: 10_000 } : {})
  });
  const models = createModels();
  models.setProvider(faux.provider);

  const piTools = input.request.tools.map(toPiTool);
  const events: EnergyIqGatewayEvent[] = [];
  const setEvent = (sequence: number, event: EnergyIqGatewayEventPayload): void => {
    const normalizedEvent = {
      ...event,
      requestId: input.request.requestId,
      sequence
    };
    const eventFingerprint = sha256(stableJson(normalizedEvent));
    const normalized: EnergyIqGatewayEvent = {
      ...normalizedEvent,
      eventFingerprint,
      eventId: sha256(stableJson({ attemptId, sequence, eventFingerprint }))
    };
    assertPiAiGatewayEventIntegrity({ attemptId, event: normalized });
    events[sequence] = normalized;
  };
  const pushEvent = (event: EnergyIqGatewayEventPayload): void => {
    setEvent(events.length, event);
  };
  const observedHeaderNames = new Set<string>();
  let contentDeltaObserved = false;
  let terminalObserved = false;
  let transportAudit: PiAiGatewayEvaluationResult["transportAudit"] = {
    provider: compiled.requestIdentity.provider,
    model: compiled.requestIdentity.model,
    baseUrl: compiled.requestIdentity.baseUrl,
    protocolCandidate: compiled.requestIdentity.protocolCandidate,
    reasoningRequested: input.profile.reasoning === "enabled" ? "medium" : "off",
    reasoningObserved: "unavailable",
    maxOutputTokens: input.profile.maxOutputTokens,
    timeoutMs: 30_000,
    maxRetries: 0,
    headerNames: [],
    toolSchemas: []
  };
  const catalogModel = faux.getModel(input.profile.model);
  if (!catalogModel) {
    throw new Error(`Exact Profile model is unavailable: ${input.profile.provider}/${input.profile.model}`);
  }
  const piModel: Model<string> = {
    ...catalogModel,
    baseUrl: compiled.requestIdentity.baseUrl,
    headers: { ...input.profile.headers }
  };
  const observeTransport = (context: Context, options: SimpleStreamOptions | undefined, model: Model<string>): void => {
    transportAudit = {
      provider: model.provider,
      model: model.id,
      baseUrl: model.baseUrl,
      protocolCandidate: compiled.requestIdentity.protocolCandidate,
      reasoningRequested: input.profile.reasoning === "enabled" ? "medium" : "off",
      reasoningObserved: options?.reasoning ?? "off",
      maxOutputTokens: options?.maxTokens ?? model.maxTokens,
      timeoutMs: options?.timeoutMs ?? 0,
      maxRetries: options?.maxRetries ?? -1,
      headerNames: Object.entries(options?.headers ?? {})
        .filter(([, value]) => value !== null)
        .map(([name]) => name)
        .sort(),
      toolSchemas: (context.tools ?? []).map((tool) => {
        if (tool.constrainedSampling === false) return { name: tool.name, mode: "disabled" as const };
        if (tool.constrainedSampling?.type === "json_schema") {
          return { name: tool.name, mode: "json-schema" as const, strict: tool.constrainedSampling.strict };
        }
        return { name: tool.name, mode: "unspecified" as const };
      })
    };
  };
  if (input.syntheticStreamPattern === "interleaved") {
    models.setProvider({
      ...faux.provider,
      streamSimple: (model, context, options) => {
        observeTransport(context, options, model);
        return interleavedPiStream(model, input.scriptedResponse);
      }
    });
  } else {
    faux.setResponses([async (context, options, _state, model) => {
      observeTransport(context, options, model);
      if (input.syntheticResponseDelayMs !== undefined) {
        await new Promise<void>((resolve) => setTimeout(resolve, input.syntheticResponseDelayMs));
      }
      return toPiResponse(input.scriptedResponse);
    }]);
  }

  const stream = models.streamSimple(
    piModel,
    {
      ...(input.request.systemPrompt ? { systemPrompt: input.request.systemPrompt } : {}),
      messages: input.request.messages.map((message, index) => message.role === "user"
        ? { role: "user" as const, content: message.text, timestamp: index }
        : assistantHistoryMessage(piModel, message.text, index)),
      tools: piTools
    },
    {
      ...(effectiveSignal ? { signal: effectiveSignal } : {}),
      ...(input.profile.reasoning === "enabled" ? { reasoning: "medium" as const } : {}),
      maxTokens: input.profile.maxOutputTokens,
      timeoutMs: 30_000,
      maxRetries: 0,
      maxRetryDelayMs: 0,
      headers: {
        "X-EnergyIQ-Request-ID": attemptId,
        ...Object.fromEntries((input.suppressedHeaderNames ?? []).map((name) => [name, null]))
      },
      cacheRetention: "short",
      sessionId: input.request.requestId,
      transformHeaders: (headers) => {
        for (const [name, value] of Object.entries(headers)) {
          if (value !== null) observedHeaderNames.add(name);
        }
        return headers;
      }
    }
  );

  pushEvent({
    type: "request-started",
    requestId: input.request.requestId,
    profileId: compiled.profile.profileId,
    profileRevision: compiled.profile.revision,
    reasoning: compiled.profile.reasoning,
    observedHeaderNames: []
  });

  for await (const event of stream) {
    if (event.type === "text_delta") {
      pushEvent({ type: "text-delta", contentIndex: event.contentIndex, text: event.delta });
      if (!contentDeltaObserved) {
        contentDeltaObserved = true;
        input.abortAfterFirstContentDelta?.();
      }
      continue;
    }
    if (event.type === "thinking_delta") {
      pushEvent({ type: "reasoning-delta", contentIndex: event.contentIndex, text: event.delta });
      if (!contentDeltaObserved) {
        contentDeltaObserved = true;
        input.abortAfterFirstContentDelta?.();
      }
      continue;
    }
    if (event.type === "toolcall_end") {
      pushEvent(normalizeToolCall(piTools, event.toolCall, event.contentIndex));
      continue;
    }
    if (event.type === "done") {
      pushEvent(normalizeUsage(event.message, {
        evidence: input.usageEvidence ?? "provider-reported",
        syntheticReported: input.syntheticReportedUsage,
        rates: compiled.profile.costRates
      }));
      if (event.reason === "deferred") {
        pushEvent({ type: "request-deferred" });
      } else {
        pushEvent({
          type: "request-completed",
          stopReason: event.reason === "toolUse" ? "tool-use" : event.reason,
          overflowAssessment: event.reason === "length" ? "unavailable" : "not-applicable",
          ...(event.message.responseId ? { upstreamResponseId: event.message.responseId } : {})
        });
      }
      terminalObserved = true;
      continue;
    }
    if (event.type === "error") {
      pushEvent(normalizeUsage(event.error, {
        evidence: input.usageEvidence ?? "provider-reported",
        syntheticReported: input.syntheticReportedUsage,
        rates: compiled.profile.costRates
      }));
      if (event.reason === "aborted" || effectiveSignal?.aborted === true) {
        if (deadlineSignal?.aborted === true && input.signal?.aborted !== true) {
          pushEvent({ type: "request-failed", failureKind: "timeout" });
        } else {
          pushEvent({ type: "request-aborted" });
        }
      } else {
        pushEvent({
          type: "request-failed",
          failureKind: classifyFailure(event.error, piModel.contextWindow),
          ...(event.error.responseId ? { upstreamResponseId: event.error.responseId } : {})
        });
      }
      terminalObserved = true;
    }
  }

  if (!terminalObserved) {
    pushEvent({ type: "request-failed", failureKind: "provider_error" });
  }
  const started = events[0];
  if (started?.type === "request-started") {
    setEvent(0, {
      type: "request-started",
      requestId: started.requestId,
      profileId: started.profileId,
      profileRevision: started.profileRevision,
      reasoning: started.reasoning,
      observedHeaderNames: [...observedHeaderNames].sort()
    });
  }

  return deepFreeze({
    ...compiled,
    attemptId,
    requestFingerprint,
    transportAudit,
    events
  });
};

const toPiResponse = (response: EnergyIqScriptedResponse): AssistantMessage =>
  fauxAssistantMessage(
    response.blocks.map((block) => {
      if (block.type === "text") return fauxText(block.text);
      if (block.type === "reasoning") return fauxThinking(block.text);
      return fauxToolCall(block.name, block.arguments, { id: block.id });
    }),
    {
      stopReason: response.stopReason === "tool-use" ? "toolUse" : response.stopReason,
      ...(response.errorMessage ? { errorMessage: response.errorMessage } : {}),
      ...(response.responseId ? { responseId: response.responseId } : {})
    }
  );

const toPiTool = (tool: EnergyIqGatewayRequest["tools"][number]): Tool => ({
  name: tool.name,
  description: tool.description,
  parameters: structuredClone(tool.inputSchema) as TSchema,
  ...(tool.schemaPolicy === "disabled"
    ? { constrainedSampling: false as const }
    : tool.schemaPolicy
      ? { constrainedSampling: { type: "json_schema" as const, strict: tool.schemaPolicy } }
      : {})
});

const interleavedPiStream = (
  model: Model<string>,
  response: EnergyIqScriptedResponse
): AssistantMessageEventStream => {
  const stream = createAssistantMessageEventStream();
  const scripted = toPiResponse(response);
  const final: AssistantMessage = {
    ...scripted,
    api: model.api,
    provider: model.provider,
    model: model.id
  };
  const partial: AssistantMessage = { ...final, content: [], stopReason: "pending" };
  const [reasoning, text, toolCall] = final.content;
  if (reasoning?.type !== "thinking" || text?.type !== "text" || toolCall?.type !== "toolCall") {
    throw new Error("Interleaved synthetic stream requires reasoning, text and Tool blocks in that order");
  }
  const reasoningSplit = Math.ceil(reasoning.thinking.length / 2);
  const textSplit = Math.ceil(text.text.length / 2);

  queueMicrotask(() => {
    stream.push({ type: "start", partial });
    stream.push({ type: "thinking_start", contentIndex: 0, partial });
    stream.push({ type: "thinking_delta", contentIndex: 0, delta: reasoning.thinking.slice(0, reasoningSplit), partial });
    stream.push({ type: "text_start", contentIndex: 1, partial });
    stream.push({ type: "text_delta", contentIndex: 1, delta: text.text.slice(0, textSplit), partial });
    stream.push({ type: "thinking_delta", contentIndex: 0, delta: reasoning.thinking.slice(reasoningSplit), partial });
    stream.push({ type: "thinking_end", contentIndex: 0, content: reasoning.thinking, partial });
    stream.push({ type: "toolcall_start", contentIndex: 2, partial });
    stream.push({ type: "toolcall_delta", contentIndex: 2, delta: JSON.stringify(toolCall.arguments), partial });
    stream.push({ type: "toolcall_end", contentIndex: 2, toolCall, partial });
    stream.push({ type: "text_delta", contentIndex: 1, delta: text.text.slice(textSplit), partial });
    stream.push({ type: "text_end", contentIndex: 1, content: text.text, partial });
    stream.push({ type: "done", reason: final.stopReason === "toolUse" ? "toolUse" : "stop", message: final });
    stream.end(final);
  });
  return stream;
};

/**
 * Exercise the pinned OpenAI-compatible implementation with a local fake
 * fetch/SSE transport. Raw payload and credentials stay inside this function.
 */
export const runPiAiOpenAiCompatibleRequestEvaluation = async (input: {
  profile: EnergyIqGatewayProfile;
  request: EnergyIqGatewayRequest;
  toolAccess: ProviderToolContractAccess;
  toolBundleEligible: boolean;
  localToolValidators?: Record<string, CanonicalToolInputValidator>;
  syntheticToolCall?: { name: string; arguments: Record<string, unknown> };
}): Promise<PiAiOpenAiCompatibleRequestAudit> => {
  const compiled = compilePiAiEvaluationProfile(input.profile);
  if (compiled.requestIdentity.protocolCandidate !== "openai-completions") {
    throw new Error(`Profile does not use the OpenAI-compatible completions probe: ${input.profile.provider}`);
  }
  const toolCompatibility = resolveProviderToolContractCompatibility({
    providerId: input.profile.provider,
    modelName: input.profile.model,
    toolAccess: input.toolAccess,
    toolBundleEligible: input.toolBundleEligible
  });
  if (!toolCompatibility.eligible) throw new Error(toolCompatibility.reason);
  const usesNonStrictTools = toolCompatibility.schemaStrategy === "provider-nonstrict-local-validation";
  if (usesNonStrictTools) {
    for (const tool of input.request.tools) {
      if (!input.localToolValidators?.[tool.name]) {
        throw new Error(`KIMI_LOCAL_TOOL_VALIDATOR_REQUIRED:${tool.name}`);
      }
    }
  }
  const model: Model<"openai-completions"> = {
    id: input.profile.model,
    name: input.profile.model,
    api: "openai-completions",
    provider: input.profile.provider,
    baseUrl: compiled.requestIdentity.baseUrl,
    reasoning: input.profile.reasoning === "enabled",
    input: ["text"],
    cost: input.profile.costRates ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: input.profile.contextWindow,
    maxTokens: input.profile.maxOutputTokens,
    headers: { ...input.profile.headers },
    compat: {
      maxTokensField: "max_tokens",
      supportsDeveloperRole: false,
      supportsStore: false,
      supportsStrictMode: !usesNonStrictTools,
      supportsReasoningEffort: input.profile.provider === "deepseek",
      thinkingFormat: input.profile.provider === "deepseek"
        ? "deepseek"
        : input.profile.provider === "alibaba"
          ? "qwen"
          : "openai"
    }
  };
  const provider = createProvider({
    id: input.profile.provider,
    auth: { apiKey: { name: "Synthetic", resolve: async () => ({ auth: {} }) } },
    models: [model],
    api: openAICompletionsApi()
  });
  const models = createModels();
  models.setProvider(provider);
  let capturedUrl = "";
  let capturedMethod = "";
  let capturedHeaderNames: string[] = [];
  let capturedPayload: unknown;
  const fakeFetch: typeof globalThis.fetch = async (request, init) => {
    capturedUrl = typeof request === "string"
      ? request
      : request instanceof URL
        ? request.toString()
        : request.url;
    capturedMethod = init?.method ?? (request instanceof Request ? request.method : "GET");
    const headers = new Headers(request instanceof Request ? request.headers : undefined);
    new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
    capturedHeaderNames = [...headers.keys()].map((name) => name.toLowerCase()).sort();
    const firstChoice = input.syntheticToolCall
      ? {
          index: 0,
          delta: {
            role: "assistant",
            content: null,
            tool_calls: [{
              index: 0,
              id: "call-synthetic",
              type: "function",
              function: {
                name: input.syntheticToolCall.name,
                arguments: JSON.stringify(input.syntheticToolCall.arguments),
              },
            }],
          },
          finish_reason: null,
        }
      : { index: 0, delta: { role: "assistant", content: "synthetic-ok" }, finish_reason: null };
    const body = [
      `data: ${JSON.stringify({
        id: "chatcmpl-synthetic",
        object: "chat.completion.chunk",
        created: 1,
        model: input.profile.model,
        choices: [firstChoice]
      })}`,
      `data: ${JSON.stringify({
        id: "chatcmpl-synthetic",
        object: "chat.completion.chunk",
        created: 1,
        model: input.profile.model,
        choices: [{
          index: 0,
          delta: {},
          finish_reason: input.syntheticToolCall ? "tool_calls" : "stop",
        }]
      })}`,
      `data: ${JSON.stringify({
        id: "chatcmpl-synthetic",
        object: "chat.completion.chunk",
        created: 1,
        model: input.profile.model,
        choices: [],
        usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 }
      })}`,
      "data: [DONE]",
      ""
    ].join("\n\n");
    return new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" }
    });
  };
  const requiresNonEmptyMessageCompatibility = input.profile.provider === "alibaba";
  const context: Context = {
    ...(input.request.systemPrompt ? { systemPrompt: input.request.systemPrompt } : {}),
    messages: input.request.messages.map((message, index) => message.role === "user"
      ? {
        role: "user" as const,
        content: message.text.length > 0 || !requiresNonEmptyMessageCompatibility ? message.text : " ",
        timestamp: index
      }
      : assistantHistoryMessage(
          model,
          message.text.length > 0 || !requiresNonEmptyMessageCompatibility ? message.text : " ",
          index
        )),
    tools: input.request.tools.map((tool) => toPiTool(usesNonStrictTools && tool.schemaPolicy === "require"
      ? { ...tool, schemaPolicy: "disabled" }
      : tool))
  };
  const final = await models.completeSimple(model, context, {
    apiKey: "synthetic-api-key",
    fetch: fakeFetch,
    headers: { "X-EnergyIQ-Request-ID": sha256(input.request.requestId) },
    maxTokens: input.profile.maxOutputTokens,
    maxRetries: 0,
    maxRetryDelayMs: 0,
    timeoutMs: 1_000,
    cacheRetention: "none",
    ...(input.profile.reasoning === "enabled" ? { reasoning: "medium" as const } : {}),
    onPayload: (payload) => {
      capturedPayload = structuredClone(payload);
      return undefined;
    }
  });
  if (!isRecord(capturedPayload)) throw new Error("Pi OpenAI-compatible payload was not captured");
  const messages = Array.isArray(capturedPayload.messages) ? capturedPayload.messages : [];
  const tools = Array.isArray(capturedPayload.tools) ? capturedPayload.tools : [];
  const maxTokensField = typeof capturedPayload.max_tokens === "number"
    ? "max_tokens"
    : typeof capturedPayload.max_completion_tokens === "number"
      ? "max_completion_tokens"
      : "unavailable";
  const maxTokens = maxTokensField === "max_tokens"
    ? capturedPayload.max_tokens
    : maxTokensField === "max_completion_tokens"
      ? capturedPayload.max_completion_tokens
      : null;
  const toolAudits = tools.map((tool) => isRecord(tool) && isRecord(tool.function)
    ? { name: typeof tool.function.name === "string" ? tool.function.name : "", strict: tool.function.strict === true }
    : { name: "", strict: false });
  if (final.stopReason === "pending" || final.stopReason === "deferred") {
    throw new Error(`Synthetic OpenAI-compatible request did not reach a supported terminal: ${final.stopReason}`);
  }
  let localToolValidation: PiAiOpenAiCompatibleRequestAudit["localToolValidation"] = {
    status: "not-applicable",
  };
  if (usesNonStrictTools) {
    for (const block of final.content) {
      if (block.type !== "toolCall") continue;
      const validator = input.localToolValidators?.[block.name];
      if (!validator) throw new Error(`KIMI_LOCAL_TOOL_VALIDATOR_REQUIRED:${block.name}`);
      const contract = prepareProviderToolContract({
        providerId: input.profile.provider,
        modelName: input.profile.model,
        access: input.toolAccess,
        inputSchema: validator,
      });
      if (!contract.eligible) throw new Error(contract.reason);
      const validation = contract.validateArguments(block.arguments);
      if (!validation.success) {
        throw new Error(`KIMI_LOCAL_TOOL_ARGUMENTS_INVALID:${block.name}`);
      }
      localToolValidation = { status: "valid", toolName: block.name };
    }
  }
  return deepFreeze({
    requestUrl: capturedUrl,
    requestMethod: capturedMethod,
    requestHeaderNames: capturedHeaderNames,
    payload: {
      model: typeof capturedPayload.model === "string" ? capturedPayload.model : "",
      maxTokensField,
      maxTokens: typeof maxTokens === "number" ? maxTokens : null,
      deepSeekThinkingEnabled: isRecord(capturedPayload.thinking) && capturedPayload.thinking.type === "enabled",
      qwenThinkingEnabled: capturedPayload.enable_thinking === true,
      allMessageContentNonEmpty: messages.every((message) => isRecord(message)
        && typeof message.content === "string"
        && message.content.length > 0),
      emptyMessageCompatibilityApplied: requiresNonEmptyMessageCompatibility
        && input.request.messages.some((message) => message.text.length === 0),
      toolNames: toolAudits.map((tool) => tool.name),
      strictToolSchema: toolAudits.every((tool) => tool.strict)
    },
    terminal: final.stopReason === "toolUse" ? "tool-use" : final.stopReason,
    localToolValidation,
    finalText: final.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("")
  });
};

/** Exercise actual MutableModels mutation without wiring any EnergyIQ Store. */
export const runPiAiCatalogIsolationEvaluation = async (input: {
  profile: EnergyIqGatewayProfile;
  replacementModelId: string;
}): Promise<PiAiCatalogIsolationAudit> => {
  const compiled = compilePiAiEvaluationProfile(input.profile);
  const profileHashBefore = sha256(stableJson(compiled.profile));
  const requestIdentityHashBefore = sha256(stableJson(compiled.requestIdentity));
  const original = fauxProvider({
    api: "energyiq-catalog-isolation",
    provider: input.profile.provider,
    models: [{
      id: input.profile.model,
      name: input.profile.model,
      reasoning: input.profile.reasoning === "enabled",
      input: ["text"],
      cost: input.profile.costRates ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: input.profile.contextWindow,
      maxTokens: input.profile.maxOutputTokens
    }]
  });
  const replacement = fauxProvider({
    api: "energyiq-catalog-replacement",
    provider: input.profile.provider,
    models: [{
      id: input.replacementModelId,
      name: input.replacementModelId,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1_024,
      maxTokens: 128
    }]
  });
  const models = createModels();
  models.setProvider(original.provider);
  const exactModelAvailableBeforeMutation = models.getModel(input.profile.provider, input.profile.model) !== undefined;
  models.setProvider(replacement.provider);
  const exactModelAvailableAfterReplacement = models.getModel(input.profile.provider, input.profile.model) !== undefined;

  let networkFetchCount = 0;
  const dynamicProvider = createProvider({
    id: input.profile.provider,
    auth: original.provider.auth,
    models: original.models,
    fetchModels: async () => {
      networkFetchCount += 1;
      return replacement.models;
    },
    api: {
      stream: original.provider.stream,
      streamSimple: original.provider.streamSimple
    }
  });
  models.setProvider(dynamicProvider);
  const refresh = await models.refresh({
    allowNetwork: false,
    providers: [input.profile.provider]
  });

  return deepFreeze({
    exactModelAvailableBeforeMutation,
    exactModelAvailableAfterReplacement,
    offlineRefreshAborted: refresh.aborted,
    offlineRefreshErrorCount: refresh.errors.size,
    networkFetchCount,
    profileSnapshotUnchanged: sha256(stableJson(compiled.profile)) === profileHashBefore,
    requestIdentityUnchanged: sha256(stableJson(compiled.requestIdentity)) === requestIdentityHashBefore,
    energyIqStoreBoundary: "not-wired-to-pi-catalog"
  });
};

/**
 * Synthetic two-request probe. The Tool result is caller-supplied: pi-ai only
 * transports it into the second model request and never executes the Tool.
 */
export const runPiAiToolRoundTripEvaluation = async (input: {
  profile: EnergyIqGatewayProfile;
  request: EnergyIqGatewayRequest;
  proposedToolCall: { id: string; name: string; arguments: Record<string, unknown> };
  externalToolResult: { content: string; isError: boolean };
  scriptedFinalText: string;
}): Promise<PiAiToolRoundTripAudit> => {
  const compiled = compilePiAiEvaluationProfile(input.profile);
  const faux = fauxProvider({
    api: "energyiq-tool-round-trip",
    provider: input.profile.provider,
    models: [{
      id: input.profile.model,
      name: input.profile.model,
      reasoning: input.profile.reasoning === "enabled",
      input: ["text"],
      cost: input.profile.costRates ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: input.profile.contextWindow,
      maxTokens: input.profile.maxOutputTokens
    }],
    tokenSize: { min: 100_000, max: 100_000 }
  });
  const models = createModels();
  models.setProvider(faux.provider);
  const model = faux.getModel(input.profile.model);
  if (!model) throw new Error(`Exact Profile model is unavailable: ${input.profile.provider}/${input.profile.model}`);
  const requestModel: Model<string> = {
    ...model,
    baseUrl: compiled.requestIdentity.baseUrl,
    headers: { ...input.profile.headers }
  };
  const tools = input.request.tools.map(toPiTool);
  let secondRequestObserved = false;
  faux.setResponses([
    toPiResponse({
      blocks: [{ type: "tool-call", ...input.proposedToolCall }],
      stopReason: "tool-use"
    }),
    (context) => {
      const result = context.messages.at(-1);
      secondRequestObserved = result?.role === "toolResult"
        && result.toolCallId === input.proposedToolCall.id
        && result.toolName === input.proposedToolCall.name
        && result.isError === input.externalToolResult.isError;
      return fauxAssistantMessage(input.scriptedFinalText);
    }
  ]);

  const baseMessages = input.request.messages.map((message, index) => message.role === "user"
    ? { role: "user" as const, content: message.text, timestamp: index }
    : assistantHistoryMessage(requestModel, message.text, index));
  const first = await models.completeSimple(requestModel, {
    ...(input.request.systemPrompt ? { systemPrompt: input.request.systemPrompt } : {}),
    messages: baseMessages,
    tools
  }, { maxRetries: 0, timeoutMs: 30_000 });
  const proposed = first.content.find((block) => block.type === "toolCall" && block.id === input.proposedToolCall.id);
  if (!proposed || proposed.type !== "toolCall") throw new Error("Pi did not return the scripted Tool call");
  const normalized = normalizeToolCall(tools, proposed, 0);
  if (normalized.argumentsStatus !== "valid") throw new Error("Scripted Tool call did not pass the canonical validator");

  const toolResult: ToolResultMessage = {
    role: "toolResult",
    toolCallId: proposed.id,
    toolName: proposed.name,
    content: [{ type: "text", text: input.externalToolResult.content }],
    isError: input.externalToolResult.isError,
    timestamp: 1
  };
  const final = await models.completeSimple(requestModel, {
    ...(input.request.systemPrompt ? { systemPrompt: input.request.systemPrompt } : {}),
    messages: [...baseMessages, first, toolResult],
    tools
  }, { maxRetries: 0, timeoutMs: 30_000 });

  return deepFreeze({
    providerCallCount: faux.state.callCount,
    toolCallId: normalized.toolCallId,
    toolName: normalized.toolName,
    argumentsStatus: "valid",
    executionOwner: "energyiq-external-to-pi-ai",
    resultStatus: input.externalToolResult.isError ? "error" : "success",
    resultContentFingerprint: sha256(input.externalToolResult.content),
    secondRequestObserved,
    finalText: final.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("")
  });
};

const assistantHistoryMessage = (
  model: Model<string>,
  text: string,
  timestamp: number
): AssistantMessage => ({
  role: "assistant",
  content: [{ type: "text", text }],
  api: model.api,
  provider: model.provider,
  model: model.id,
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  },
  stopReason: "stop",
  timestamp
});

const normalizeToolCall = (
  tools: Tool[],
  toolCall: { id: string; name: string; arguments: Record<string, unknown> },
  contentIndex: number
): Extract<EnergyIqGatewayEventPayload, { type: "tool-call" }> => {
  if (!tools.some((tool) => tool.name === toolCall.name)) {
    return {
      type: "tool-call",
      contentIndex,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      arguments: structuredClone(toolCall.arguments),
      argumentsStatus: "invalid",
      executionStatus: "not-executed-by-gateway",
      failureKind: "unknown_tool"
    };
  }
  try {
    const arguments_ = validateToolCall(tools, {
      type: "toolCall",
      id: toolCall.id,
      name: toolCall.name,
      arguments: toolCall.arguments
    }) as Record<string, unknown>;
    return {
      type: "tool-call",
      contentIndex,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      arguments: arguments_,
      argumentsStatus: "valid",
      executionStatus: "not-executed-by-gateway"
    };
  } catch {
    return {
      type: "tool-call",
      contentIndex,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      arguments: structuredClone(toolCall.arguments),
      argumentsStatus: "invalid",
      executionStatus: "not-executed-by-gateway",
      failureKind: "tool_arguments_invalid"
    };
  }
};

const normalizeUsage = (
  message: AssistantMessage,
  options: {
    evidence: "provider-reported" | "unavailable";
    syntheticReported: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      reasoning?: number;
      totalTokens: number;
    } | undefined;
    rates: { input: number; output: number; cacheRead: number; cacheWrite: number } | undefined;
  }
): Extract<EnergyIqGatewayEventPayload, { type: "usage" }> => {
  if (options.evidence === "unavailable") {
    return {
      type: "usage",
      usageStatus: "unavailable",
      usageSource: "unavailable",
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      reasoningTokens: null,
      totalTokens: null,
      cost: unavailableCost()
    };
  }
  const usage = options.syntheticReported ?? message.usage;
  return {
    type: "usage",
    usageStatus: "available",
    usageSource: "pi-normalized-provider",
    inputTokens: usage.input,
    outputTokens: usage.output,
    cacheReadTokens: usage.cacheRead,
    cacheWriteTokens: usage.cacheWrite,
    reasoningTokens: usage.reasoning ?? null,
    totalTokens: usage.totalTokens,
    cost: options.rates ? estimatedCost(usage, options.rates) : unavailableCost()
  };
};

const unavailableCost = (): Extract<EnergyIqGatewayEventPayload, { type: "usage" }>["cost"] => ({
  status: "unavailable",
  source: "unavailable",
  rateSnapshotHash: null,
  input: null,
  output: null,
  cacheRead: null,
  cacheWrite: null,
  total: null
});

const estimatedCost = (
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number },
  rates: { input: number; output: number; cacheRead: number; cacheWrite: number }
): Extract<EnergyIqGatewayEventPayload, { type: "usage" }>["cost"] => {
  const input = rates.input * usage.input / 1_000_000;
  const output = rates.output * usage.output / 1_000_000;
  const cacheRead = rates.cacheRead * usage.cacheRead / 1_000_000;
  const cacheWrite = rates.cacheWrite * usage.cacheWrite / 1_000_000;
  return {
    status: "estimated",
    source: "energyiq-profile-rate-snapshot",
    rateSnapshotHash: sha256(stableJson(rates)),
    input,
    output,
    cacheRead,
    cacheWrite,
    total: input + output + cacheRead + cacheWrite
  };
};

const classifyFailure = (
  message: AssistantMessage,
  contextWindow: number
): Extract<EnergyIqGatewayEventPayload, { type: "request-failed" }>["failureKind"] => {
  if (isContextOverflow(message, contextWindow)) return "context_overflow";
  if (/\b(?:401|403)\b|unauthori[sz]ed|invalid\s+api\s+key/iu.test(message.errorMessage ?? "")) return "auth_error";
  if (/\b429\b|rate\s*limit/iu.test(message.errorMessage ?? "")) return "rate_limited";
  if (/timed?\s*out|timeout/iu.test(message.errorMessage ?? "")) return "timeout";
  return "provider_error";
};

const normalizeEvaluationBaseUrl = (value: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("EnergyIQ Profile baseUrl must be an absolute HTTPS URL");
  }
  if (parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash) {
    throw new Error("EnergyIQ Profile baseUrl must be a credential-free absolute HTTPS URL");
  }
  parsed.pathname = parsed.pathname === "/"
    ? ""
    : parsed.pathname.replace(/\/+$/u, "");
  return parsed.toString().replace(/\/$/u, "");
};

const stableJson = (value: unknown): string => JSON.stringify(sortValue(value));

const sortValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortValue(item)])
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

const deepFreeze = <T>(value: T): T => {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};
