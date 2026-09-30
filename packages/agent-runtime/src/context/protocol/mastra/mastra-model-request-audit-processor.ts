import type { ModelRequestPreparedEventPayloadV1 } from "@datafoundry/contracts";
import type {
  ProcessInputStepArgs,
  ProcessInputStepResult,
  ProcessLLMRequestArgs,
  ProcessLLMRequestResult,
  Processor,
} from "@mastra/core/processors";

import type { ContextRunState } from "../../inventory/context-run-state.js";
import type { ContextProtocolEventSink } from "../context-protocol-event-sink.js";

export type ModelRequestSnapshotReference = {
  snapshotId: string;
  contentSha256: string;
  payloadAvailability: "not-retained" | "retained";
};

export type ModelRequestAuditCaptureV1 = {
  schemaVersion: 1;
  requestFidelity: "complete" | "partial";
  stepNumber: number;
  retryCount: number;
  modelName?: string;
  contextPackage: { packageId: string; revision: number };
  prompt: unknown;
  toolSet: Array<{ name: string; description?: string; inputSchema?: unknown }>;
  activeToolNames: string[];
  toolChoice?: unknown;
  modelSettings?: unknown;
  providerOptions?: unknown;
};

export type ModelRequestSnapshotRecorder = {
  record(input: ModelRequestAuditCaptureV1): ModelRequestSnapshotReference;
};

export type MastraModelRequestAuditProcessorOptions = {
  eventSink: ContextProtocolEventSink;
  modelName: string | undefined;
  recorder: ModelRequestSnapshotRecorder;
  runState: ContextRunState;
};

type RequestHeader = Omit<ModelRequestAuditCaptureV1, "prompt" | "requestFidelity" | "schemaVersion"> & {
  headerFidelity: "complete" | "partial";
};

/** Captures the final application-level request immediately before Mastra invokes the Provider. */
export class MastraModelRequestAuditProcessor implements Processor<"model-request-audit"> {
  readonly id = "model-request-audit";
  readonly name = "Model Request Audit";
  private readonly headers = new Map<string, RequestHeader>();

  constructor(private readonly options: MastraModelRequestAuditProcessorOptions) {}

  processInputStep(args: ProcessInputStepArgs): ProcessInputStepResult | undefined {
    const toolSet = captureToolSet(args.tools, args.activeTools);
    const toolChoice = sanitizeJson(args.toolChoice);
    const modelSettings = sanitizeJson(args.modelSettings);
    const providerOptions = sanitizeJson(args.providerOptions);
    const contextPackage = this.options.runState.package;
    this.headers.set(requestKey(args.stepNumber, args.retryCount), {
      stepNumber: args.stepNumber,
      retryCount: args.retryCount,
      ...(this.options.modelName ? { modelName: this.options.modelName } : {}),
      contextPackage: {
        packageId: contextPackage.packageId,
        revision: contextPackage.revision,
      },
      toolSet: toolSet.items,
      activeToolNames: toolSet.items.map(({ name }) => name),
      ...(toolChoice.value !== undefined ? { toolChoice: toolChoice.value } : {}),
      ...(modelSettings.value !== undefined ? { modelSettings: modelSettings.value } : {}),
      ...(providerOptions.value !== undefined ? { providerOptions: providerOptions.value } : {}),
      headerFidelity: toolSet.complete && toolChoice.complete && modelSettings.complete && providerOptions.complete
        ? "complete"
        : "partial",
    });
    return undefined;
  }

  processLLMRequest(args: ProcessLLMRequestArgs): ProcessLLMRequestResult {
    const header = this.headers.get(requestKey(args.stepNumber, args.retryCount));
    const prompt = sanitizeJson(args.prompt);
    const fallbackPackage = this.options.runState.package;
    const capture: ModelRequestAuditCaptureV1 = header
      ? {
          schemaVersion: 1,
          requestFidelity: header.headerFidelity === "complete" && prompt.complete ? "complete" : "partial",
          stepNumber: header.stepNumber,
          retryCount: header.retryCount,
          ...(header.modelName ? { modelName: header.modelName } : {}),
          contextPackage: header.contextPackage,
          prompt: prompt.value,
          toolSet: header.toolSet,
          activeToolNames: header.activeToolNames,
          ...(header.toolChoice !== undefined ? { toolChoice: header.toolChoice } : {}),
          ...(header.modelSettings !== undefined ? { modelSettings: header.modelSettings } : {}),
          ...(header.providerOptions !== undefined ? { providerOptions: header.providerOptions } : {}),
        }
      : {
          schemaVersion: 1,
          requestFidelity: "partial",
          stepNumber: args.stepNumber,
          retryCount: args.retryCount,
          ...(this.options.modelName ? { modelName: this.options.modelName } : {}),
          contextPackage: {
            packageId: fallbackPackage.packageId,
            revision: fallbackPackage.revision,
          },
          prompt: prompt.value,
          toolSet: [],
          activeToolNames: [],
        };
    const reference = this.options.recorder.record(capture);
    const event: ModelRequestPreparedEventPayloadV1 = {
      eventId: modelRequestPreparedEventId(
        this.options.runState.identity.runId,
        capture.stepNumber,
        capture.retryCount,
      ),
      run_event_schema_version: 1,
      request_fidelity: capture.requestFidelity,
      step_number: capture.stepNumber,
      retry_count: capture.retryCount,
      payload_availability: reference.payloadAvailability,
      ...(capture.modelName ? { model: capture.modelName } : {}),
      context_package_id: capture.contextPackage.packageId,
      context_package_revision: capture.contextPackage.revision,
      tool_names: capture.activeToolNames,
      payload_ref: {
        kind: "model-request-snapshot",
        id: reference.snapshotId,
        sha256: reference.contentSha256,
      },
    };
    this.options.eventSink.emitContextEvent("model.request.prepared", event);
    return undefined;
  }
}

const requestKey = (stepNumber: number, retryCount: number): string => `${stepNumber}:${retryCount}`;

const modelRequestPreparedEventId = (
  runId: string,
  stepNumber: number,
  retryCount: number,
): string => `model-request-prepared:${runId}:${stepNumber}:${retryCount}`;

const captureToolSet = (
  tools: Record<string, unknown> | undefined,
  activeTools: string[] | undefined,
): { complete: boolean; items: ModelRequestAuditCaptureV1["toolSet"] } => {
  const configured = tools ?? {};
  const names = [...new Set(activeTools ?? Object.keys(configured))].sort((left, right) => left.localeCompare(right));
  let complete = true;
  const items = names.map((name) => {
    const tool = configured[name];
    if (!isRecord(tool)) {
      complete = false;
      return { name };
    }
    const description = typeof tool.description === "string" ? tool.description : undefined;
    const schema = extractInputSchema(tool.inputSchema ?? tool.parameters);
    complete &&= schema.complete;
    return {
      name,
      ...(description ? { description } : {}),
      ...(schema.value !== undefined ? { inputSchema: schema.value } : {}),
    };
  });
  return { complete, items };
};

const extractInputSchema = (schema: unknown): SanitizedJson => {
  if (schema === undefined) return { complete: false, value: undefined };
  if (isRecord(schema) && typeof schema.toJSONSchema === "function") {
    try {
      return sanitizeJson(schema.toJSONSchema());
    } catch {
      return { complete: false, value: undefined };
    }
  }
  return sanitizeJson(schema);
};

type SanitizedJson = { complete: boolean; value: unknown };

const SENSITIVE_KEYS = /^(?:api[-_]?key|authorization|cookie|headers?|password|secret|token)$/iu;

const sanitizeJson = (value: unknown): SanitizedJson => {
  if (value === undefined) return { complete: true, value: undefined };
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return { complete: true, value };
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? { complete: true, value } : { complete: false, value: null };
  }
  if (Array.isArray(value)) {
    const items = value.map(sanitizeJson);
    return { complete: items.every(({ complete }) => complete), value: items.map(({ value: item }) => item) };
  }
  if (!isRecord(value)) return { complete: false, value: undefined };
  let complete = true;
  const entries = Object.entries(value).flatMap(([key, item]): Array<[string, unknown]> => {
    if (SENSITIVE_KEYS.test(key)) {
      complete = false;
      return [];
    }
    const sanitized = sanitizeJson(item);
    complete &&= sanitized.complete;
    return sanitized.value === undefined ? [] : [[key, sanitized.value]];
  });
  return { complete, value: Object.fromEntries(entries) };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
