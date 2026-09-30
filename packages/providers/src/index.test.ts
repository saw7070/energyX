import { describe, expect, it } from "vitest";

import {
  createModelHelperProviderOptions,
  createModelHelperSettings,
  createModelRuntimeProviderOptions
} from "./index.js";

const legacyModelHelperProviderOptions = {
  alibaba: { enableThinking: false },
  deepseek: { thinking: { type: "disabled" as const } }
};

describe("createModelHelperProviderOptions", () => {
  it("keeps Kimi K3 structured helpers on low reasoning effort", () => {
    expect(createModelHelperProviderOptions({
      providerId: "openai-compatible",
      modelName: "kimi-k3"
    })).toEqual({
      ...legacyModelHelperProviderOptions,
      openaiCompatible: { reasoningEffort: "low" }
    });
  });

  it.each([
    { providerId: "openai-compatible" as const, modelName: "step-3.7-flash" },
    { providerId: "deepseek" as const, modelName: "deepseek-v4-flash" },
    { providerId: "alibaba" as const, modelName: "qwen3.8-max" }
  ])("preserves helper options for $modelName", (identity) => {
    expect(createModelHelperProviderOptions(identity)).toEqual(legacyModelHelperProviderOptions);
  });
});

describe("createModelHelperSettings", () => {
  it("uses Kimi K3's fixed temperature for structured helper calls", () => {
    expect(createModelHelperSettings({
      modelName: "kimi-k3",
      maxOutputTokens: 512
    })).toEqual({
      maxOutputTokens: 512,
      temperature: 1
    });
  });

  it.each(["KIMI-K3", "kimi-k3-preview", "step-3.7-flash", "deepseek-v4-flash"])(
    "preserves deterministic helper sampling for non-matching model %s",
    (modelName) => {
      expect(createModelHelperSettings({ modelName, maxOutputTokens: 256 })).toEqual({
        maxOutputTokens: 256,
        temperature: 0
      });
    }
  );
});

describe("createModelRuntimeProviderOptions", () => {
  it("enables the controlled Kimi compatibility strategy for an eligible read-only bundle", () => {
    expect(createModelRuntimeProviderOptions({
      providerId: "openai-compatible",
      modelName: "kimi-k3",
      reasoningEnabled: false,
      toolAccess: "read-only",
      toolBundleEligible: true
    })).toEqual({
      openaiCompatible: {
        reasoningEffort: "low",
        strictJsonSchema: false
      }
    });
  });

  it.each([
    { toolAccess: "mutating" as const, toolBundleEligible: true },
    { toolAccess: "read-only" as const, toolBundleEligible: false }
  ])("rejects Kimi non-strict mode for an ineligible tool bundle", (toolContract) => {
    expect(() => createModelRuntimeProviderOptions({
      providerId: "openai-compatible",
      modelName: "kimi-k3",
      ...toolContract
    })).toThrow("KIMI_NON_STRICT_TOOL_BUNDLE_NOT_ELIGIBLE");
  });

  it("preserves StepFun runtime options for the same eligible read-only bundle", () => {
    expect(createModelRuntimeProviderOptions({
      providerId: "openai-compatible",
      modelName: "step-3.7-flash",
      reasoningEnabled: false,
      toolAccess: "read-only",
      toolBundleEligible: true
    })).toEqual({
      openaiCompatible: { reasoningEffort: "low" }
    });
  });

  it("requests low reasoning effort for an explicitly disabled openai-compatible model", () => {
    expect(createModelRuntimeProviderOptions({
      providerId: "openai-compatible",
      reasoningEnabled: false
    })).toEqual({
      openaiCompatible: { reasoningEffort: "low" }
    });
  });

  it("does not override an openai-compatible model when reasoning is unspecified", () => {
    expect(createModelRuntimeProviderOptions({
      providerId: "openai-compatible"
    })).toBeUndefined();
  });

  it("does not force high reasoning for an enabled openai-compatible model", () => {
    expect(createModelRuntimeProviderOptions({
      providerId: "openai-compatible",
      reasoningEnabled: true
    })).toBeUndefined();
  });

  it("preserves the existing Alibaba reasoning options", () => {
    expect(createModelRuntimeProviderOptions({
      providerId: "alibaba",
      reasoningEnabled: false
    })).toEqual({
      alibaba: { enableThinking: false }
    });
    expect(createModelRuntimeProviderOptions({
      providerId: "alibaba",
      reasoningEnabled: true
    })).toEqual({
      alibaba: { enableThinking: true, thinkingBudget: 2048 }
    });
  });

  it("preserves the existing DeepSeek reasoning options", () => {
    expect(createModelRuntimeProviderOptions({
      providerId: "deepseek",
      reasoningEnabled: false
    })).toEqual({
      deepseek: { thinking: { type: "disabled" } }
    });
    expect(createModelRuntimeProviderOptions({
      providerId: "deepseek",
      reasoningEnabled: true
    })).toEqual({
      deepseek: { thinking: { type: "enabled" } }
    });
  });
});
