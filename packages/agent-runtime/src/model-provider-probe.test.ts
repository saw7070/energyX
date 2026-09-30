import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const { agentConfigs, generate } = vi.hoisted(() => ({
  agentConfigs: [] as Array<Record<string, unknown>>,
  generate: vi.fn(),
}));

vi.mock("@mastra/core/agent", () => ({
  Agent: class {
    constructor(config: Record<string, unknown>) {
      agentConfigs.push(config);
    }

    generate = generate;
  },
}));

import { probeModelProvider, probeModelProviderToolContract } from "./index.js";
import { modelProviderToolContractCommitInputSchema } from "./model-provider-tool-contract-probe.js";

describe("model provider probe", () => {
  beforeEach(() => {
    agentConfigs.length = 0;
    generate.mockReset();
    generate.mockResolvedValue({ text: "OK" });
  });

  it("keeps the connectivity probe free of provider sampling parameters", async () => {
    await expect(probeModelProvider({
      kind: "openai-compatible",
      provider_id: "openai-compatible",
      model_name: "test-model",
      model: {},
    })).resolves.toEqual({ model: "test-model", text: "OK" });

    expect(generate).toHaveBeenCalledOnce();
    expect(generate).toHaveBeenCalledWith("Reply with OK only.", {
      abortSignal: expect.any(AbortSignal),
      maxSteps: 1,
      modelSettings: { maxOutputTokens: 16 },
    });
    const options = generate.mock.calls[0]?.[1];
    expect(options?.modelSettings).not.toHaveProperty("temperature");
    expect(options?.modelSettings).not.toHaveProperty("topP");
    expect(options?.modelSettings).not.toHaveProperty("frequencyPenalty");
    expect(options?.modelSettings).not.toHaveProperty("presencePenalty");
  });

  it("accepts parallel SQL-first probe calls while validating the actual Kimi Tool payload", async () => {
    generate.mockImplementationOnce(async () => {
      const toolAgent = agentConfigs.find((config) => config.id === "model-tool-contract-probe");
      const tools = toolAgent?.tools as Record<string, {
        execute(input: unknown, context: unknown): Promise<unknown>;
      }>;
      const [sqlResult] = await Promise.all([
        tools.run_sql_readonly?.execute({
          schema_id: "probe-schema",
          sql: "SELECT 1 AS probe_value",
          expected_columns: ["probe_value"]
        }, {}),
        tools.inspect_schema?.execute({
          datasource_id: "energy-scoped",
          table_names: ["scoped_interval_facts"]
        }, {})
      ]);
      expect(sqlResult).toMatchObject({ audit_log_id: "probe-audit" });
      return { text: "OK" };
    });

    await expect(probeModelProviderToolContract({
      kind: "openai-compatible",
      provider_id: "openai-compatible",
      model_name: "kimi-k3",
      model: {},
    })).resolves.toEqual({
      compatible: true,
      model: "kimi-k3",
      checks: {
        registeredTools: ["inspect_schema", "run_sql_readonly", "analysis_requirements_commit"],
        executedTools: ["inspect_schema", "run_sql_readonly"]
      }
    });

    const toolAgent = agentConfigs.find((config) => config.id === "model-tool-contract-probe");
    expect(toolAgent?.defaultOptions).toMatchObject({
      providerOptions: {
        openaiCompatible: {
          reasoningEffort: "low",
          strictJsonSchema: false
        }
      }
    });
    const tools = toolAgent?.tools as Record<string, { strict?: boolean; inputSchema?: unknown }>;
    expect(tools.inspect_schema?.strict).toBe(false);
    expect(tools.run_sql_readonly?.strict).toBe(false);
    expect(tools.analysis_requirements_commit?.strict).toBe(false);
    expect(tools.inspect_schema?.inputSchema).toBeDefined();
    expect(tools.run_sql_readonly?.inputSchema).toBeDefined();
    expect(tools.analysis_requirements_commit?.inputSchema).toBe(modelProviderToolContractCommitInputSchema);
    expect(modelProviderToolContractCommitInputSchema.safeParse({ claims: [] }).success).toBe(false);
    expect(modelProviderToolContractCommitInputSchema.safeParse({
      claims: [{
        requirement_id: "R1",
        claim: "The fixture is valid",
        values: [{ name: "invented_value", value: 1 }]
      }]
    }).success).toBe(false);
    expect(generate.mock.calls[0]?.[1]).toMatchObject({
      maxSteps: 5,
      modelSettings: { maxOutputTokens: 512 },
      toolChoice: "auto"
    });
  });

  it("keeps the active commit preflight schema flat and free of undeclared values", () => {
    const schemaJson = JSON.stringify(z.toJSONSchema(modelProviderToolContractCommitInputSchema));

    expect(schemaJson).not.toContain('"values"');
    expect(schemaJson).not.toContain('"oneOf"');
    expect(schemaJson).not.toContain('"anyOf"');
    expect(schemaJson).toContain('"requirement_id"');
    expect(schemaJson).toContain('"R1"');
  });

  it("classifies provider-side schema rejection before any Function Tool executes", async () => {
    generate.mockRejectedValueOnce(Object.assign(
        new Error("Invalid schema for function inspect_schema"),
        { statusCode: 400 }
      ));

    await expect(probeModelProviderToolContract({
      kind: "openai-compatible",
      provider_id: "openai-compatible",
      model_name: "kimi-k3",
      model: {},
    })).resolves.toEqual({
      compatible: false,
      model: "kimi-k3",
      failure: {
        kind: "provider_schema_rejected",
        diagnostic: { stage: "schema-submission" }
      }
    });
  });

  it("disables DeepSeek thinking while explicitly requesting the auto Tool policy", async () => {
    generate.mockImplementationOnce(async () => {
      const toolAgent = agentConfigs.find((config) => config.id === "model-tool-contract-probe");
      const tools = toolAgent?.tools as Record<string, {
        execute(input: unknown, context: unknown): Promise<unknown>;
      }>;
      await Promise.all([
        tools.inspect_schema?.execute({ table_names: ["scoped_interval_facts"] }, {}),
        tools.run_sql_readonly?.execute({
          schema_id: "probe-schema",
          sql: "SELECT 1 AS probe_value"
        }, {})
      ]);
      return { text: "OK" };
    });

    await expect(probeModelProviderToolContract({
      kind: "openai-compatible",
      provider_id: "deepseek",
      model_name: "deepseek-v4-flash",
      model: {},
    })).resolves.toMatchObject({ compatible: true });

    const toolAgent = agentConfigs.find((config) => config.id === "model-tool-contract-probe");
    expect(toolAgent?.defaultOptions).toMatchObject({
      providerOptions: {
        deepseek: { thinking: { type: "disabled" } }
      }
    });
    expect(generate.mock.calls[0]?.[1]).toMatchObject({ toolChoice: "auto" });
  });

  it("keeps StepFun low reasoning and provider-default strictness with the auto Tool policy", async () => {
    generate.mockImplementationOnce(async () => {
      const toolAgent = agentConfigs.find((config) => config.id === "model-tool-contract-probe");
      const tools = toolAgent?.tools as Record<string, {
        execute(input: unknown, context: unknown): Promise<unknown>;
        strict?: boolean;
      }>;
      await Promise.all([
        tools.inspect_schema?.execute({ table_names: ["scoped_interval_facts"] }, {}),
        tools.run_sql_readonly?.execute({
          schema_id: "probe-schema",
          sql: "SELECT 1 AS probe_value"
        }, {})
      ]);
      expect(tools.inspect_schema?.strict).toBeUndefined();
      expect(tools.run_sql_readonly?.strict).toBeUndefined();
      expect(tools.analysis_requirements_commit?.strict).toBeUndefined();
      return { text: "OK" };
    });

    await expect(probeModelProviderToolContract({
      kind: "openai-compatible",
      provider_id: "openai-compatible",
      model_name: "step-3.7-flash",
      model: {},
    })).resolves.toMatchObject({ compatible: true });

    const toolAgent = agentConfigs.find((config) => config.id === "model-tool-contract-probe");
    expect(toolAgent?.defaultOptions).toEqual({
      providerOptions: {
        openaiCompatible: { reasoningEffort: "low" }
      }
    });
    expect(generate.mock.calls[0]?.[1]).toMatchObject({ toolChoice: "auto" });
  });

  it("reports fixed missing Tool names without persisting model arguments or results", async () => {
    generate.mockImplementationOnce(async () => {
        const toolAgent = agentConfigs.find((config) => config.id === "model-tool-contract-probe");
        const tools = toolAgent?.tools as Record<string, {
          execute(input: unknown, context: unknown): Promise<unknown>;
        }>;
        await tools.inspect_schema?.execute({ table_names: ["scoped_interval_facts"] }, {});
        return { text: "OK" };
      });

    await expect(probeModelProviderToolContract({
      kind: "openai-compatible",
      provider_id: "deepseek",
      model_name: "deepseek-v4-flash",
      model: {},
    })).resolves.toEqual({
      compatible: false,
      model: "deepseek-v4-flash",
      failure: {
        kind: "tool_execution_failed",
        diagnostic: {
          stage: "tool-execution",
          missingToolNames: ["run_sql_readonly"]
        }
      }
    });
  });
});
