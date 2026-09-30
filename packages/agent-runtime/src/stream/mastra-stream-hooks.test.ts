import { describe, expect, it } from "vitest";

import {
  createMastraStreamNormalizerHooks,
  tokenUsageEventFromChunk,
} from "./mastra-stream-hooks.js";

describe("tokenUsageEventFromChunk", () => {
  it("preserves DeepSeek prompt cache telemetry when the provider exposes it", () => {
    expect(tokenUsageEventFromChunk({
      type: "step-finish",
      usage: {
        promptTokens: 1_000,
        completionTokens: 200,
        prompt_cache_hit_tokens: 750,
        prompt_cache_miss_tokens: 250
      }
    })).toMatchObject({
      input_tokens: 1_000,
      output_tokens: 200,
      cache_telemetry_available: true,
      cache_hit_tokens: 750,
      cache_miss_tokens: 250,
      cache_hit_ratio: 0.75
    });
  });

  it("accepts normalized input token detail telemetry", () => {
    expect(tokenUsageEventFromChunk({
      type: "step-finish",
      usage: {
        inputTokens: 500,
        outputTokens: 50,
        inputTokenDetails: { cacheRead: 320, cacheWrite: 180 }
      }
    })).toMatchObject({
      cache_telemetry_available: true,
      cache_hit_tokens: 320,
      cache_miss_tokens: 180,
      cache_hit_ratio: 0.64
    });
  });

  it("marks cache telemetry unavailable instead of fabricating zeroes", () => {
    const event = tokenUsageEventFromChunk({
      type: "step-finish",
      usage: { inputTokens: 100, outputTokens: 10 }
    });

    expect(event).toMatchObject({ cache_telemetry_available: false });
    expect(event).not.toHaveProperty("cache_hit_tokens");
    expect(event).not.toHaveProperty("cache_miss_tokens");
  });

  it("keeps distinct steps when their usage totals happen to be identical", () => {
    const events: Array<Record<string, unknown>> = [];
    const hooks = createMastraStreamNormalizerHooks({
      emit: (event) => events.push(event as unknown as Record<string, unknown>),
    });
    const chunk = {
      type: "step-finish",
      usage: { inputTokens: 100, outputTokens: 10 },
    };

    hooks.onChunk?.(chunk);
    hooks.onChunk?.(chunk);

    expect(events.map((event) => (event.value as Record<string, unknown>).step_number)).toEqual([1, 2]);
  });

  it("collapses adjacent step-end aliases for the same usage record", () => {
    const events: Array<Record<string, unknown>> = [];
    const hooks = createMastraStreamNormalizerHooks({
      emit: (event) => events.push(event as unknown as Record<string, unknown>),
    });
    const usage = { inputTokens: 100, outputTokens: 10 };

    hooks.onChunk?.({ type: "step-finish", usage });
    hooks.onChunk?.({ type: "finish-step", usage });

    expect(events).toHaveLength(1);
  });
});
