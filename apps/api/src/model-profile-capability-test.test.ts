import { describe, expect, it, vi } from "vitest";

import {
  MODEL_PROFILE_TOOL_BUNDLE_REVISION,
  isModelProfileToolCallFallbackEligible,
  probeModelProfileCapabilities
} from "./model-profile-capability-test.js";

const provider = {
  kind: "openai-compatible" as const,
  provider_id: "openai-compatible" as const,
  model_name: "test-model",
  model: {}
};

describe("probeModelProfileCapabilities", () => {
  it("runs the Tool Contract probe only after connectivity and returns a compatible capability", async () => {
    const order: string[] = [];
    const connectivityProbe = vi.fn(async () => {
      order.push("connectivity");
      return { model: "test-model", text: "OK" };
    });
    const toolContractProbe = vi.fn(async () => {
      order.push("tool-contract");
      return {
        compatible: true as const,
        model: "test-model",
        checks: {
          registeredTools: [
            "inspect_schema",
            "run_sql_readonly",
            "analysis_requirements_commit"
          ] as ["inspect_schema", "run_sql_readonly", "analysis_requirements_commit"],
          executedTools: [
            "inspect_schema",
            "run_sql_readonly"
          ] as ["inspect_schema", "run_sql_readonly"]
        }
      };
    });

    const result = await probeModelProfileCapabilities({
      provider,
      timeoutMs: 5000,
      connectivityProbe,
      toolContractProbe
    });

    expect(order).toEqual(["connectivity", "tool-contract"]);
    expect(MODEL_PROFILE_TOOL_BUNDLE_REVISION).toBe("overview-readonly-tools-v3");
    expect(result).toEqual({
      connectivity: { model: "test-model", text: "OK" },
      capabilities: {
        reasoning: "unknown",
        toolCall: "compatible",
        toolCallBundleRevision: MODEL_PROFILE_TOOL_BUNDLE_REVISION
      }
    });
    expect(isModelProfileToolCallFallbackEligible({
      connectionStatus: "connected",
      capabilities: result.capabilities
    })).toBe(true);
    expect(isModelProfileToolCallFallbackEligible({
      connectionStatus: "untested",
      capabilities: result.capabilities
    })).toBe(false);
  });

  it.each([
    ["provider_schema_rejected", "schema-submission"],
    ["tool_arguments_invalid", "local-arguments"],
    ["tool_execution_failed", "tool-execution"],
    ["result_evidence_rejected", "result-evidence"]
  ] as const)("keeps connectivity successful while persisting %s", async (failureKind, stage) => {
    const result = await probeModelProfileCapabilities({
      provider,
      timeoutMs: 5000,
      connectivityProbe: async () => ({ model: "test-model", text: "OK" }),
      toolContractProbe: async () => ({
        compatible: false,
        model: "test-model",
        failure: { kind: failureKind }
      })
    });

    expect(result).toEqual({
      connectivity: { model: "test-model", text: "OK" },
      capabilities: {
        reasoning: "unknown",
        toolCall: "incompatible",
        toolCallBundleRevision: MODEL_PROFILE_TOOL_BUNDLE_REVISION,
        toolCallFailureKind: failureKind,
        toolCallDiagnostic: { stage }
      }
    });
    expect(isModelProfileToolCallFallbackEligible({
      connectionStatus: "connected",
      capabilities: result.capabilities
    })).toBe(false);
  });

  it("does not turn a post-connectivity probe exception into a failed profile", async () => {
    await expect(probeModelProfileCapabilities({
      provider,
      timeoutMs: 5000,
      connectivityProbe: async () => ({ model: "test-model", text: "OK" }),
      toolContractProbe: async () => {
        throw new Error("tool probe timed out");
      }
    })).resolves.toMatchObject({
      connectivity: { model: "test-model", text: "OK" },
      capabilities: {
        toolCall: "incompatible",
        toolCallFailureKind: "tool_execution_failed",
        toolCallDiagnostic: { stage: "tool-execution" }
      }
    });
  });

  it("stops before Tool Contract probing when connectivity fails", async () => {
    const toolContractProbe = vi.fn();
    await expect(probeModelProfileCapabilities({
      provider,
      timeoutMs: 5000,
      connectivityProbe: async () => {
        throw new Error("connection refused");
      },
      toolContractProbe
    })).rejects.toThrow("connection refused");
    expect(toolContractProbe).not.toHaveBeenCalled();
  });
});
