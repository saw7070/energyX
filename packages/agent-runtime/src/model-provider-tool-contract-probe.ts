import { Agent } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import {
  classifyProviderToolContractFailure,
  createModelRuntimeProviderOptions,
  prepareProviderToolContract,
  type ModelProvider,
  type ProviderToolContractFailureKind,
  type ProviderToolContractFailureStage
} from "@datafoundry/providers";
import { z } from "zod";
import { buildAnalysisRequirementsCommitInputSchema } from "./protocol/analysis-requirements-commit-tool.js";
import { createUserAnalysisRequirements } from "./protocol/analysis-requirements.js";

export const MODEL_PROVIDER_TOOL_CONTRACT_BUNDLE_REVISION = "overview-readonly-tools-v3" as const;

export const modelProviderToolContractCommitInputSchema = buildAnalysisRequirementsCommitInputSchema(
  createUserAnalysisRequirements([{
    kind: "validation",
    description: "Return one Evidence-backed answer",
    acceptanceCriteria: ["Cite the successful read-only result"]
  }])
);

const inspectSchemaInput = z.object({
  datasource_id: z.string().min(1).optional(),
  table_names: z.array(z.string().min(1)).optional()
});

const runSqlReadonlyInput = z.object({
  schema_id: z.string().min(1),
  sql: z.string().min(1),
  expected_columns: z.array(z.string().min(1)).optional(),
  limit: z.number().int().positive().max(1000).optional()
});

type ProbeToolName = "inspect_schema" | "run_sql_readonly";
type RegisteredProbeToolName = ProbeToolName | "analysis_requirements_commit";

const REGISTERED_PROBE_TOOLS: [RegisteredProbeToolName, RegisteredProbeToolName, RegisteredProbeToolName] = [
  "inspect_schema",
  "run_sql_readonly",
  "analysis_requirements_commit"
];
const EXECUTED_PROBE_TOOLS: [ProbeToolName, ProbeToolName] = ["inspect_schema", "run_sql_readonly"];

export type ModelProviderToolContractProbeDiagnostic = {
  stage: ProviderToolContractFailureStage;
  missingToolNames?: ProbeToolName[];
};

type ProbeFailure = {
  kind: ProviderToolContractFailureKind;
  diagnostic?: ModelProviderToolContractProbeDiagnostic;
};

export type ModelProviderToolContractProbeResult =
  | {
      compatible: true;
      model: string;
      checks: {
        registeredTools: [RegisteredProbeToolName, RegisteredProbeToolName, RegisteredProbeToolName];
        executedTools: [ProbeToolName, ProbeToolName];
      };
    }
  | {
      compatible: false;
      model: string;
      failure: ProbeFailure;
    };

class ToolContractProbeFailure extends Error {
  constructor(readonly stage: ProviderToolContractFailureStage, cause: unknown) {
    super(`MODEL_TOOL_CONTRACT_PROBE_FAILED:${stage}`, { cause });
    this.name = "ToolContractProbeFailure";
  }
}

const errorChain = (error: unknown): unknown[] => {
  const chain: unknown[] = [];
  let current = error;
  while (current !== undefined && current !== null && !chain.includes(current)) {
    chain.push(current);
    current = typeof current === "object" && "cause" in current
      ? (current as { cause?: unknown }).cause
      : undefined;
  }
  return chain;
};

const errorName = (error: unknown): string =>
  typeof error === "object" && error !== null && "name" in error
    ? String((error as { name?: unknown }).name ?? "")
    : "";

const errorMessage = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : String(error ?? "");

const errorStatusCode = (error: unknown): number | undefined => {
  if (typeof error !== "object" || error === null) return undefined;
  for (const key of ["statusCode", "status"] as const) {
    const value = (error as Record<string, unknown>)[key];
    if (typeof value === "number") return value;
  }
  return undefined;
};

const classifyKnownProbeFailure = (error: unknown): ProbeFailure | undefined => {
  const chain = errorChain(error);
  const explicit = chain.find((item): item is ToolContractProbeFailure =>
    item instanceof ToolContractProbeFailure
  );
  if (explicit) {
    return {
      kind: classifyProviderToolContractFailure({
        stage: explicit.stage,
        error: explicit.cause
      }).kind,
      diagnostic: { stage: explicit.stage }
    };
  }

  if (chain.some((item) => /InvalidTool(?:Input|Arguments)Error/iu.test(errorName(item)))) {
    return {
      kind: "tool_arguments_invalid",
      diagnostic: { stage: "local-arguments" }
    };
  }

  const providerSchemaRejection = chain.some((item) => {
    const message = errorMessage(item);
    return errorStatusCode(item) === 400
      && /(?:schema|function\s+parameters|tools?\W+function|strictJsonSchema)/iu.test(message);
  });
  return providerSchemaRejection
    ? {
        kind: "provider_schema_rejected",
        diagnostic: { stage: "schema-submission" }
      }
    : undefined;
};

/**
 * Probe the production Overview Tool schemas without touching a real datasource.
 * The commit Tool is schema-registration-only; inspect and SQL must execute and replay.
 */
export const probeModelProviderToolContract = async (
  provider: Exclude<ModelProvider, { kind: "mock" }>,
  timeoutMs = 30000
): Promise<ModelProviderToolContractProbeResult> => {
  const compatibilityInput = {
    providerId: provider.provider_id,
    modelName: provider.model_name,
    access: "read-only" as const
  };
  const inspectContract = prepareProviderToolContract({
    ...compatibilityInput,
    inputSchema: inspectSchemaInput
  });
  const sqlContract = prepareProviderToolContract({
    ...compatibilityInput,
    inputSchema: runSqlReadonlyInput
  });
  const commitContract = prepareProviderToolContract({
    ...compatibilityInput,
    inputSchema: modelProviderToolContractCommitInputSchema
  });
  if (!inspectContract.eligible || !sqlContract.eligible || !commitContract.eligible) {
    return {
      compatible: false,
      model: provider.model_name,
      failure: {
        kind: "provider_schema_rejected",
        diagnostic: { stage: "schema-submission" }
      }
    };
  }

  const providerOptions = createModelRuntimeProviderOptions({
    providerId: provider.provider_id,
    modelName: provider.model_name,
    reasoningEnabled: false,
    toolAccess: "read-only",
    toolBundleEligible: true
  });
  const defaultOptions = providerOptions ? { providerOptions } : undefined;
  const executedTools = new Set<string>();

  try {
    const inspectSchemaTool = createTool({
      id: "inspect_schema",
      description: "Inspect the fixed read-only compatibility fixture.",
      inputSchema: inspectSchemaInput,
      ...(inspectContract.strict !== undefined ? { strict: inspectContract.strict } : {}),
      execute: async (toolInput) => {
        const validation = inspectContract.validateArguments(toolInput);
        if (!validation.success) {
          throw new ToolContractProbeFailure("local-arguments", validation.failure.error);
        }
        executedTools.add("inspect_schema");
        return {
          schema_id: "probe-schema",
          tables: ["scoped_interval_facts"]
        };
      }
    });
    const runSqlReadonlyTool = createTool({
      id: "run_sql_readonly",
      description: "Return the fixed read-only compatibility fixture result.",
      inputSchema: runSqlReadonlyInput,
      ...(sqlContract.strict !== undefined ? { strict: sqlContract.strict } : {}),
      execute: async (toolInput) => {
        const validation = sqlContract.validateArguments(toolInput);
        if (!validation.success) {
          throw new ToolContractProbeFailure("local-arguments", validation.failure.error);
        }
        executedTools.add("run_sql_readonly");
        return {
          audit_log_id: "probe-audit",
          columns: ["probe_value"],
          rows: [{ probe_value: 1 }]
        };
      }
    });
    const analysisRequirementsCommitTool = createTool({
      id: "analysis_requirements_commit",
      description: "Validate the production claim commit schema without side effects.",
      inputSchema: modelProviderToolContractCommitInputSchema,
      ...(commitContract.strict !== undefined ? { strict: commitContract.strict } : {}),
      execute: async (toolInput) => {
        const validation = commitContract.validateArguments(toolInput);
        if (!validation.success) {
          throw new ToolContractProbeFailure("local-arguments", validation.failure.error);
        }
        return { accepted: false, dry_run: true };
      }
    });
    const toolAgent = new Agent({
      id: "model-tool-contract-probe",
      name: "Model Tool Contract Probe",
      instructions: [
        "You are a Tool Contract probe and must call both execution tools.",
        "Call inspect_schema and run_sql_readonly with SELECT 1 AS probe_value.",
        "Do not call analysis_requirements_commit; it is registered only to validate its production schema.",
        "Do not answer until both tool results have been returned to you, then reply OK."
      ].join(" "),
      model: provider.model as never,
      tools: {
        inspect_schema: inspectSchemaTool,
        run_sql_readonly: runSqlReadonlyTool,
        analysis_requirements_commit: analysisRequirementsCommitTool
      },
      ...(defaultOptions ? { defaultOptions } : {})
    });
    await toolAgent.generate(
      "Run the fixed read-only Tool Contract probe now.",
      {
        abortSignal: AbortSignal.timeout(timeoutMs),
        maxSteps: 5,
        modelSettings: { maxOutputTokens: 512 },
        toolChoice: "auto"
      }
    );

    const missingToolNames = EXECUTED_PROBE_TOOLS
      .filter((toolName) => !executedTools.has(toolName));
    if (missingToolNames.length > 0) {
      return {
        compatible: false,
        model: provider.model_name,
        failure: {
          kind: "tool_execution_failed",
          diagnostic: {
            stage: "tool-execution",
            missingToolNames
          }
        }
      };
    }
    return {
      compatible: true,
      model: provider.model_name,
      checks: {
        registeredTools: REGISTERED_PROBE_TOOLS,
        executedTools: EXECUTED_PROBE_TOOLS
      }
    };
  } catch (error) {
    const failure = classifyKnownProbeFailure(error);
    if (!failure) throw error;
    return {
      compatible: false,
      model: provider.model_name,
      failure
    };
  }
};
