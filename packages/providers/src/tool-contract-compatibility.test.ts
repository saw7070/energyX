import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  classifyProviderToolContractFailure,
  prepareProviderToolContract
} from "./index.js";

const activeOverviewToolBundleSchema = z.object({
  enabled_only: z.boolean().optional(),
  table_names: z.array(z.string()).optional(),
  claims: z.array(z.object({
    requirement_id: z.string().min(1),
    values: z.array(z.object({
      name: z.string().min(1),
      value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
      unit: z.string().optional()
    })).optional()
  }))
});

describe("prepareProviderToolContract", () => {
  it("keeps the canonical Zod validator authoritative for a read-only Kimi compatibility probe", () => {
    const prepared = prepareProviderToolContract({
      providerId: "openai-compatible",
      modelName: "kimi-k3",
      access: "read-only",
      inputSchema: activeOverviewToolBundleSchema
    });

    expect(prepared).toMatchObject({
      eligible: true,
      schemaStrategy: "provider-nonstrict-local-validation",
      strict: false,
      providerOptions: {
        openaiCompatible: { strictJsonSchema: false }
      }
    });
    if (!prepared.eligible) throw new Error("expected Kimi read-only compatibility");
    expect(prepared.inputSchema).toBe(activeOverviewToolBundleSchema);
    expect(prepared.validateArguments({
      table_names: ["scoped_interval_facts"],
      claims: [{
        requirement_id: "req-1",
        values: [{ name: "usage", value: 42.5, unit: "kWh" }]
      }]
    })).toMatchObject({ success: true });
  });

  it("fails closed on locally invalid arguments even when provider strict mode is disabled", () => {
    const prepared = prepareProviderToolContract({
      providerId: "openai-compatible",
      modelName: "kimi-k3",
      access: "read-only",
      inputSchema: activeOverviewToolBundleSchema
    });

    if (!prepared.eligible) throw new Error("expected Kimi read-only compatibility");
    expect(prepared.validateArguments({
      table_names: "scoped_interval_facts",
      claims: [{ requirement_id: "" }]
    })).toMatchObject({
      success: false,
      failure: { kind: "tool_arguments_invalid" }
    });
  });

  it("does not allow the Kimi non-strict strategy for mutating tools", () => {
    expect(prepareProviderToolContract({
      providerId: "openai-compatible",
      modelName: "kimi-k3",
      access: "mutating",
      inputSchema: activeOverviewToolBundleSchema
    })).toEqual({
      eligible: false,
      reason: "KIMI_NON_STRICT_TOOLS_READ_ONLY_ONLY"
    });
  });

  it.each([
    { providerId: "deepseek", modelName: "deepseek-v4-flash" },
    { providerId: "openai-compatible", modelName: "step-3.7-flash" }
  ])("preserves provider defaults for $modelName", (identity) => {
    const prepared = prepareProviderToolContract({
      ...identity,
      access: "read-only" as const,
      inputSchema: activeOverviewToolBundleSchema
    });

    expect(prepared).toMatchObject({
      eligible: true,
      schemaStrategy: "provider-default"
    });
    if (!prepared.eligible) throw new Error("expected provider compatibility");
    expect(prepared.strict).toBeUndefined();
    expect(prepared.providerOptions).toBeUndefined();
    expect(prepared.inputSchema).toBe(activeOverviewToolBundleSchema);
  });
});

describe("classifyProviderToolContractFailure", () => {
  it.each([
    ["schema-submission", "provider_schema_rejected"],
    ["local-arguments", "tool_arguments_invalid"],
    ["tool-execution", "tool_execution_failed"],
    ["result-evidence", "result_evidence_rejected"]
  ] as const)("classifies %s without conflating contract layers", (stage, kind) => {
    expect(classifyProviderToolContractFailure({
      stage,
      error: new Error("probe failed")
    })).toMatchObject({ kind, error: expect.any(Error) });
  });
});
