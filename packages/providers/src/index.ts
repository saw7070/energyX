import { createAlibaba } from "@ai-sdk/alibaba";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createEnvConfig } from "@datafoundry/contracts";
import {
  resolveProviderToolContractCompatibility,
  type ProviderToolContractAccess
} from "./tool-contract-compatibility.js";

export {
  classifyProviderToolContractFailure,
  prepareProviderToolContract,
  resolveProviderToolContractCompatibility
} from "./tool-contract-compatibility.js";
export type {
  CanonicalToolInputValidator,
  ProviderToolContractAccess,
  ProviderToolContractCompatibility,
  ProviderToolContractFailureKind,
  ProviderToolContractFailureStage,
  ProviderToolContractOptions
} from "./tool-contract-compatibility.js";

export type ChatProviderConfig = {
  provider: string;
  model: string;
  base_url: string;
  api_key?: string;
};

export type EmbeddingProviderConfig = {
  provider: string;
  model: string;
  base_url: string;
  embedding_dim: number;
  output_type: "dense";
  api_key?: string;
};

export type ModelProviderId = "alibaba" | "deepseek" | "openai" | "openai-compatible";

export type ModelProvider =
  | {
      kind: "openai-compatible";
      provider_id: ModelProviderId;
      provider_ids?: ModelProviderId[];
      model_name: string;
      model: unknown;
      prompt_compat?: ModelPromptCompatibility;
    }
  | {
      kind: "mock";
      provider_id: ModelProviderId;
      provider_ids?: ModelProviderId[];
      model_name: string;
    };

export type ModelPromptCompatibility = {
  requires_non_empty_message_content?: boolean;
};

/** Keep structured helper sampling compatible without leaking model names into callers. */
export const createModelHelperSettings = (input: {
  modelName: string;
  maxOutputTokens: number;
}) => ({
  maxOutputTokens: input.maxOutputTokens,
  temperature: input.modelName === "kimi-k3" ? 1 : 0
});

/**
 * Keep deterministic helper calls fast and bounded even when the selected chat
 * model defaults to extended reasoning. Vendor-specific option names stay in
 * the provider package instead of leaking into the Agent runtime.
 */
export const createModelHelperProviderOptions = (input: {
  providerId: ModelProviderId;
  modelName: string;
}) => ({
  alibaba: {
    enableThinking: false
  },
  deepseek: {
    thinking: { type: "disabled" as const }
  },
  ...(input.providerId === "openai-compatible" && input.modelName === "kimi-k3"
    ? { openaiCompatible: { reasoningEffort: "low" } }
    : {})
});

export type ModelRuntimeProviderOptionsInput = {
  providerId: ModelProviderId;
  providerIds?: readonly ModelProviderId[];
  modelName?: string;
  reasoningEnabled?: boolean;
  toolAccess?: ProviderToolContractAccess;
  toolBundleEligible?: boolean;
};

type ProviderOptionValue = null | string | number | boolean | ProviderOptionObject | ProviderOptionValue[];
type ProviderOptionObject = { [key: string]: ProviderOptionValue };
export type ModelRuntimeProviderOptions = Record<string, ProviderOptionObject>;

/**
 * Translate provider-neutral persisted model settings into the vendor-specific
 * AI SDK options consumed by Mastra. This keeps the Agent runtime independent
 * from Alibaba/DeepSeek option names while preserving OpenAI message behavior.
 */
export const createModelRuntimeProviderOptions = (
  input: ModelRuntimeProviderOptionsInput
): ModelRuntimeProviderOptions | undefined => {
  const providerIds = new Set(input.providerIds ?? [input.providerId]);
  const options: ModelRuntimeProviderOptions = {};

  if (providerIds.has("alibaba") && input.reasoningEnabled !== undefined) {
    options.alibaba = {
      enableThinking: input.reasoningEnabled,
      ...(input.reasoningEnabled ? { thinkingBudget: 2048 } : {})
    };
  }

  if (providerIds.has("deepseek") && input.reasoningEnabled !== undefined) {
    options.deepseek = {
      thinking: { type: input.reasoningEnabled ? "enabled" : "disabled" }
    };
  }

  if (input.providerId === "openai-compatible" && input.reasoningEnabled === false) {
    options.openaiCompatible = {
      reasoningEffort: "low"
    };
  }

  if (
    input.modelName !== undefined
    && input.toolAccess !== undefined
    && input.toolBundleEligible !== undefined
  ) {
    const compatibility = resolveProviderToolContractCompatibility({
      providerId: input.providerId,
      modelName: input.modelName,
      toolAccess: input.toolAccess,
      toolBundleEligible: input.toolBundleEligible
    });
    if (!compatibility.eligible) {
      throw new Error("KIMI_NON_STRICT_TOOL_BUNDLE_NOT_ELIGIBLE");
    }
    if (compatibility.providerOptions?.openaiCompatible) {
      options.openaiCompatible = {
        ...(options.openaiCompatible ?? {}),
        ...compatibility.providerOptions.openaiCompatible
      };
    }
  }

  if (providerIds.has("openai")) {
    options.openai = {
      systemMessageMode: "system"
    };
  }

  return Object.keys(options).length > 0 ? options : undefined;
};

type ProviderAdapter = {
  id: ModelProviderId;
  aliases: readonly string[];
  createModel(config: Required<Pick<ChatProviderConfig, "api_key" | "base_url" | "model">>): unknown;
};

const PROVIDER_ADAPTERS: readonly ProviderAdapter[] = [
  {
    id: "alibaba",
    aliases: ["alibaba", "bailian", "dashscope", "qwen"],
    createModel: (config) => createAlibaba({
      apiKey: config.api_key,
      baseURL: config.base_url
    }).chatModel(config.model)
  },
  {
    id: "deepseek",
    aliases: ["deepseek"],
    createModel: (config) => createDeepSeek({
      apiKey: config.api_key,
      baseURL: config.base_url
    }).chat(config.model)
  },
  {
    id: "openai",
    aliases: ["openai"],
    createModel: (config) => createOpenAI({
      apiKey: config.api_key,
      baseURL: config.base_url
    }).chat(config.model)
  },
  {
    id: "openai-compatible",
    aliases: ["openai-compatible"],
    createModel: (config) => createOpenAICompatible({
      apiKey: config.api_key,
      baseURL: config.base_url,
      name: "openai-compatible"
    }).chatModel(config.model)
  }
] as const;

export const createModelProvider = (env: Record<string, string | undefined>): ModelProvider => {
  const config = createEnvConfig(env);
  return createModelProviderFromConfig({
    provider: config.llm.provider,
    model: config.llm.model,
    base_url: config.llm.base_url,
    ...(config.llm.api_key ? { api_key: config.llm.api_key } : {})
  });
};

/**
 * Resolve one persisted model profile at the sole provider seam used by callers.
 * Vendor-specific SDKs, aliases, and prompt compatibility stay private to this module.
 */
export const createModelProviderFromConfig = (config: ChatProviderConfig): ModelProvider => {
  const adapter = resolveProviderAdapter(config.provider);
  if (!adapter) {
    throw new Error(`PROVIDER_UNSUPPORTED:${config.provider}`);
  }

  if (!config.api_key) {
    return {
      kind: "mock",
      provider_id: adapter.id,
      model_name: config.model
    };
  }

  const promptCompat = resolvePromptCompatibility(adapter.id, config);
  return {
    kind: "openai-compatible",
    provider_id: adapter.id,
    model_name: config.model,
    model: adapter.createModel({
      api_key: config.api_key,
      base_url: config.base_url,
      model: config.model
    }),
    ...(promptCompat ? { prompt_compat: promptCompat } : {})
  };
};

const normalizeProviderAlias = (provider: string): string =>
  provider.trim().toLowerCase().replaceAll("_", "-");

const resolveProviderAdapter = (provider: string): ProviderAdapter | undefined => {
  const alias = normalizeProviderAlias(provider);
  return PROVIDER_ADAPTERS.find((adapter) => adapter.aliases.includes(alias));
};

const resolvePromptCompatibility = (
  providerId: ModelProviderId,
  config: ChatProviderConfig
): ModelPromptCompatibility | undefined => {
  const normalizedBaseUrl = config.base_url.trim().toLowerCase();
  const requiresNonEmptyMessageContent =
    providerId === "alibaba"
    || normalizedBaseUrl.includes("dashscope.aliyuncs.com")
    || normalizedBaseUrl.includes("maas.aliyuncs.com");

  return requiresNonEmptyMessageContent
    ? { requires_non_empty_message_content: true }
    : undefined;
};
