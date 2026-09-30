export type ProviderToolContractAccess = "read-only" | "mutating";

export type ProviderToolContractFailureKind =
  | "provider_schema_rejected"
  | "tool_arguments_invalid"
  | "tool_execution_failed"
  | "result_evidence_rejected";

export type ProviderToolContractFailureStage =
  | "schema-submission"
  | "local-arguments"
  | "tool-execution"
  | "result-evidence";

type SafeParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: unknown };

/**
 * Structural subset implemented by Zod's safeParse API. Keeping this structural
 * avoids making the provider package own or replace the application's Zod schema.
 */
export type CanonicalToolInputValidator<T = unknown> = {
  safeParse(input: unknown): SafeParseResult<T>;
};

export type ProviderToolContractOptions = {
  openaiCompatible?: {
    strictJsonSchema: false;
  };
};

type PreparedProviderToolContract<T> = {
  eligible: true;
  inputSchema: CanonicalToolInputValidator<T>;
  providerOptions?: ProviderToolContractOptions;
  schemaStrategy: "provider-default" | "provider-nonstrict-local-validation";
  strict?: false;
  validateArguments(input: unknown):
    | { success: true; data: T }
    | {
        success: false;
        failure: {
          kind: "tool_arguments_invalid";
          error: unknown;
        };
      };
};

type UnsupportedProviderToolContract = {
  eligible: false;
  reason: "KIMI_NON_STRICT_TOOLS_READ_ONLY_ONLY";
};

const isKimiK3 = (input: { providerId: string; modelName: string }): boolean =>
  input.providerId === "openai-compatible" && input.modelName === "kimi-k3";

export type ProviderToolContractCompatibility =
  | {
      eligible: true;
      providerOptions?: ProviderToolContractOptions;
      schemaStrategy: "provider-default" | "provider-nonstrict-local-validation";
      strict?: false;
    }
  | UnsupportedProviderToolContract;

/** Resolve compatibility once for the complete Tool Bundle before a model call starts. */
export const resolveProviderToolContractCompatibility = (input: {
  providerId: string;
  modelName: string;
  toolAccess: ProviderToolContractAccess;
  toolBundleEligible: boolean;
}): ProviderToolContractCompatibility => {
  if (!isKimiK3(input)) {
    return { eligible: true, schemaStrategy: "provider-default" };
  }
  if (input.toolAccess !== "read-only" || !input.toolBundleEligible) {
    return {
      eligible: false,
      reason: "KIMI_NON_STRICT_TOOLS_READ_ONLY_ONLY"
    };
  }
  return {
    eligible: true,
    providerOptions: {
      openaiCompatible: { strictJsonSchema: false }
    },
    schemaStrategy: "provider-nonstrict-local-validation",
    strict: false
  };
};

/**
 * Resolve provider schema behavior without changing the canonical validator.
 * Kimi's non-strict compatibility mode is deliberately limited to read-only
 * tools; every returned contract still validates model arguments locally.
 */
export const prepareProviderToolContract = <T>(input: {
  providerId: string;
  modelName: string;
  access: ProviderToolContractAccess;
  inputSchema: CanonicalToolInputValidator<T>;
}): PreparedProviderToolContract<T> | UnsupportedProviderToolContract => {
  const compatibility = resolveProviderToolContractCompatibility({
    providerId: input.providerId,
    modelName: input.modelName,
    toolAccess: input.access,
    toolBundleEligible: true
  });
  if (!compatibility.eligible) return compatibility;
  return {
    ...compatibility,
    eligible: true,
    inputSchema: input.inputSchema,
    validateArguments: (argumentsInput) => {
      const result = input.inputSchema.safeParse(argumentsInput);
      return result.success
        ? result
        : {
            success: false,
            failure: {
              kind: "tool_arguments_invalid",
              error: result.error
            }
          };
    }
  };
};

const failureKindByStage: Record<ProviderToolContractFailureStage, ProviderToolContractFailureKind> = {
  "schema-submission": "provider_schema_rejected",
  "local-arguments": "tool_arguments_invalid",
  "tool-execution": "tool_execution_failed",
  "result-evidence": "result_evidence_rejected"
};

/** Keep failure reporting explicit so provider, execution, and Evidence layers are not conflated. */
export const classifyProviderToolContractFailure = (input: {
  stage: ProviderToolContractFailureStage;
  error: unknown;
}): { kind: ProviderToolContractFailureKind; error: unknown } => ({
  kind: failureKindByStage[input.stage],
  error: input.error
});
