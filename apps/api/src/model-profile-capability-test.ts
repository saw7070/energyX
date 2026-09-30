import {
  MODEL_PROVIDER_TOOL_CONTRACT_BUNDLE_REVISION,
  probeModelProvider,
  probeModelProviderToolContract,
  type ModelProviderToolContractProbeResult
} from "@datafoundry/agent-runtime";

export const MODEL_PROFILE_TOOL_BUNDLE_REVISION = MODEL_PROVIDER_TOOL_CONTRACT_BUNDLE_REVISION;

type ToolContractFailureKind = Extract<
  ModelProviderToolContractProbeResult,
  { compatible: false }
>["failure"]["kind"];
type ToolContractDiagnostic = Extract<
  ModelProviderToolContractProbeResult,
  { compatible: false }
>["failure"]["diagnostic"];

export type ModelProfileToolCapabilities = {
  reasoning: "unknown";
  toolCall: "compatible" | "incompatible";
  toolCallBundleRevision: typeof MODEL_PROFILE_TOOL_BUNDLE_REVISION;
  toolCallDiagnostic?: ToolContractDiagnostic;
  toolCallFailureKind?: ToolContractFailureKind;
};

type ConnectedProvider = Parameters<typeof probeModelProvider>[0];
type ConnectivityProbe = (
  provider: ConnectedProvider,
  timeoutMs?: number
) => Promise<{ model: string; text: string }>;
type ToolContractProbe = (
  provider: ConnectedProvider,
  timeoutMs?: number
) => Promise<ModelProviderToolContractProbeResult>;

/**
 * Keep connectivity and Tool Contract compatibility as separate outcomes.
 * A post-connectivity Tool failure must never downgrade the profile connection.
 */
export const probeModelProfileCapabilities = async (input: {
  provider: ConnectedProvider;
  timeoutMs: number;
  connectivityProbe?: ConnectivityProbe;
  toolContractProbe?: ToolContractProbe;
}): Promise<{
  connectivity: { model: string; text: string };
  capabilities: ModelProfileToolCapabilities;
}> => {
  const connectivity = await (input.connectivityProbe ?? probeModelProvider)(
    input.provider,
    input.timeoutMs
  );

  let toolContract: ModelProviderToolContractProbeResult;
  try {
    toolContract = await (input.toolContractProbe ?? probeModelProviderToolContract)(
      input.provider,
      input.timeoutMs
    );
  } catch {
    toolContract = {
      compatible: false,
      model: input.provider.model_name,
      failure: {
        kind: "tool_execution_failed",
        diagnostic: { stage: "tool-execution" }
      }
    };
  }

  const capabilities: ModelProfileToolCapabilities = toolContract.compatible
    ? {
        reasoning: "unknown",
        toolCall: "compatible",
        toolCallBundleRevision: MODEL_PROFILE_TOOL_BUNDLE_REVISION
      }
    : {
        reasoning: "unknown",
        toolCall: "incompatible",
        toolCallBundleRevision: MODEL_PROFILE_TOOL_BUNDLE_REVISION,
        toolCallFailureKind: toolContract.failure.kind,
        toolCallDiagnostic: toolContract.failure.diagnostic ?? {
          stage: failureStageByKind[toolContract.failure.kind]
        }
      };
  return { connectivity, capabilities };
};

const failureStageByKind = {
  provider_schema_rejected: "schema-submission",
  tool_arguments_invalid: "local-arguments",
  tool_execution_failed: "tool-execution",
  result_evidence_rejected: "result-evidence"
} as const satisfies Record<ToolContractFailureKind, NonNullable<ToolContractDiagnostic>["stage"]>;

/** Future fallback selection must require the currently verified fixed Bundle. */
export const isModelProfileToolCallFallbackEligible = (
  input: {
    connectionStatus: "connected" | "failed" | "untested" | "disabled";
    capabilities: ModelProfileToolCapabilities;
  }
): boolean => input.connectionStatus === "connected"
  && input.capabilities.toolCall === "compatible"
  && input.capabilities.toolCallBundleRevision === MODEL_PROFILE_TOOL_BUNDLE_REVISION;
