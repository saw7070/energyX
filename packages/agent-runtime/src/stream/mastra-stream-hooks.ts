import { createCustomEvent } from "../events.js";
import type { AgUiEventEmitter } from "../types.js";
import type { MastraStreamChunk, MastraStreamNormalizerHooks } from "./mastra-stream-normalizer.js";

const SANDBOX_DATA_TYPES = new Set([
  "data-sandbox-stdout",
  "data-sandbox-stderr",
  "data-sandbox-exit",
  "data-sandbox-command",
]);

const STEP_END_CHUNK_TYPES = new Set(["step-finish", "finish-step"]);

/** Map Mastra data-* stream chunks to AG-UI CUSTOM events for persistence and UI. */
export const createMastraStreamNormalizerHooks = (
  emitter: AgUiEventEmitter,
  options: {
    onWorkspaceMetadata?: (metadata: unknown) => Promise<void> | void;
  } = {},
): MastraStreamNormalizerHooks => {
  let previousEmittedUsage: { key: string; chunkType: string } | undefined;
  let completedSteps = 0;

  return {
    onChunk(chunk: MastraStreamChunk) {
      const type = typeof chunk.type === "string" ? chunk.type : undefined;
      if (!type || !STEP_END_CHUNK_TYPES.has(type)) {
        return;
      }

      const usageEvent = tokenUsageEventFromChunk(chunk, {});
      if (!usageEvent) {
        if (type === "step-finish") {
          completedSteps += 1;
        }
        return;
      }

      const toolCallId = stringValue(usageEvent.tool_call_id);
      const toolName = stringValue(usageEvent.tool_name);
      const dedupeKey = [
        toolCallId ?? "",
        toolName ?? "",
        String(usageEvent.input_tokens ?? 0),
        String(usageEvent.output_tokens ?? 0),
        stringValue(usageEvent.model) ?? "",
      ].join("|");
      // Mastra versions may emit both aliases for one completed step. Only collapse
      // the adjacent cross-alias duplicate; a later real step is allowed to have
      // exactly the same token counts and tool metadata.
      if (
        previousEmittedUsage?.key === dedupeKey
        && previousEmittedUsage.chunkType !== type
      ) {
        return;
      }
      previousEmittedUsage = { key: dedupeKey, chunkType: type };

      completedSteps += 1;
      usageEvent.step_number = completedSteps;
      emitter.emit(createCustomEvent("token_usage", usageEvent));
    },
    onDataChunk(chunk: MastraStreamChunk) {
      const type = typeof chunk.type === "string" ? chunk.type : undefined;
      if (!type?.startsWith("data-")) {
        return;
      }

      if (type === "data-workspace-metadata") {
        emitter.emit(createCustomEvent("workspace.metadata", chunk.data));
        void Promise.resolve(options.onWorkspaceMetadata?.(chunk.data)).catch((error) => {
          console.warn("[data-foundry] workspace_metadata_hook_failed", error);
        });
        return;
      }

      if (SANDBOX_DATA_TYPES.has(type)) {
        const kind = type.slice("data-sandbox-".length);
        const data = isRecord(chunk.data) ? chunk.data : { value: chunk.data };
        emitter.emit(createCustomEvent("sandbox.output", { kind, ...data }));
      }
    },
  };
};

export const tokenUsageEventFromChunk = (
  chunk: MastraStreamChunk,
  context: { stepNumber?: number } = {},
): Record<string, unknown> | undefined => {
  const payload = isRecord(chunk.payload) ? chunk.payload : undefined;
  const data = isRecord(chunk.data) ? chunk.data : undefined;
  const output = isRecord(payload?.output) ? payload.output : undefined;
  const usage =
    usageRecord(chunk.usage) ??
    usageRecord(payload?.usage) ??
    usageRecord(output?.usage) ??
    usageRecord(data?.usage);
  if (!usage) {
    return undefined;
  }
  const inputTokens = tokenCount(usage.inputTokens) ?? tokenCount(usage.promptTokens);
  const outputTokens = tokenCount(usage.outputTokens) ?? tokenCount(usage.completionTokens);
  if (inputTokens === undefined && outputTokens === undefined) {
    return undefined;
  }

  const toolCalls = arrayValue(output?.toolCalls);
  const lastToolCall = toolCalls.at(-1);
  const toolCallRecord = isRecord(lastToolCall) ? lastToolCall : undefined;
  const toolCallId =
    stringValue(toolCallRecord?.toolCallId) ?? stringValue(toolCallRecord?.id);
  const toolName = stringValue(toolCallRecord?.toolName) ?? stringValue(toolCallRecord?.name);
  const modelInfo = isRecord(payload?.model) ? payload.model : undefined;
  const stepNumber =
    context.stepNumber ??
    numericValue(chunk.stepNumber) ??
    numericValue(payload?.stepNumber);
  const cacheUsage = cacheUsageFromRecord(usage);

  return {
    input_tokens: inputTokens ?? 0,
    output_tokens: outputTokens ?? 0,
    prompt_tokens: inputTokens ?? 0,
    completion_tokens: outputTokens ?? 0,
    ...(tokenCount(usage.totalTokens) !== undefined
      ? { total_tokens: tokenCount(usage.totalTokens) }
      : {}),
    cache_telemetry_available: cacheUsage.available,
    ...(cacheUsage.hitTokens !== undefined ? { cache_hit_tokens: cacheUsage.hitTokens } : {}),
    ...(cacheUsage.missTokens !== undefined ? { cache_miss_tokens: cacheUsage.missTokens } : {}),
    ...(cacheUsage.hitRatio !== undefined ? { cache_hit_ratio: cacheUsage.hitRatio } : {}),
    ...(stepNumber !== undefined ? { step_number: stepNumber } : {}),
    ...(toolCallId ? { tool_call_id: toolCallId } : {}),
    ...(toolName ? { tool_name: toolName } : {}),
    ...(stringValue(modelInfo?.modelId) ? { model: stringValue(modelInfo?.modelId) } : {}),
    ...(typeof chunk.runId === "string" ? { run_id: chunk.runId } : {}),
    ...(typeof chunk.from === "string" ? { source: chunk.from } : {}),
  };
};

const cacheUsageFromRecord = (usage: Record<string, unknown>): {
  available: boolean;
  hitTokens?: number;
  missTokens?: number;
  hitRatio?: number;
} => {
  const inputDetails = usageRecord(usage.inputTokenDetails)
    ?? usageRecord(usage.input_token_details)
    ?? usageRecord(usage.promptTokensDetails)
    ?? usageRecord(usage.prompt_tokens_details);
  const hitTokens = firstTokenCount([
    usage.promptCacheHitTokens,
    usage.prompt_cache_hit_tokens,
    usage.cachedInputTokens,
    usage.cached_input_tokens,
    inputDetails?.cacheRead,
    inputDetails?.cache_read,
    inputDetails?.cachedTokens,
    inputDetails?.cached_tokens
  ]);
  const missTokens = firstTokenCount([
    usage.promptCacheMissTokens,
    usage.prompt_cache_miss_tokens,
    inputDetails?.cacheWrite,
    inputDetails?.cache_write,
    inputDetails?.cacheMiss,
    inputDetails?.cache_miss
  ]);
  const available = hitTokens !== undefined || missTokens !== undefined;
  const total = (hitTokens ?? 0) + (missTokens ?? 0);
  return {
    available,
    ...(hitTokens !== undefined ? { hitTokens } : {}),
    ...(missTokens !== undefined ? { missTokens } : {}),
    ...(hitTokens !== undefined && missTokens !== undefined && total > 0
      ? { hitRatio: hitTokens / total }
      : {})
  };
};

const firstTokenCount = (values: unknown[]): number | undefined => {
  for (const value of values) {
    const count = tokenCount(value);
    if (count !== undefined) return count;
  }
  return undefined;
};

const usageRecord = (value: unknown): Record<string, unknown> | undefined =>
  isRecord(value) ? value : undefined;

const tokenCount = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (isRecord(value)) {
    return numericValue(value.total) ?? numericValue(value.text);
  }
  return undefined;
};

const arrayValue = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const numericValue = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
