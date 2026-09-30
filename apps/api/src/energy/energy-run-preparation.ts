import { createCustomEvent } from "@datafoundry/agent-runtime";
import {
  ENERGY_RUN_LATENCY_CONTRACT,
  ENERGY_RUN_LATENCY_EVENT,
  ENERGY_RUN_PREPARATION_CONTRACT,
  ENERGY_RUN_PREPARATION_EVENT,
  parseEnergyRunCorrelation,
  type EnergyRunLatencyPhase,
  type EnergyRunPackageStatus,
  type EnergyRunPreparationPhase,
} from "@datafoundry/contracts";
import { EventType, type BaseEvent } from "@ag-ui/client";

export {
  ENERGY_RUN_LATENCY_CONTRACT,
  ENERGY_RUN_LATENCY_EVENT,
  ENERGY_RUN_PREPARATION_CONTRACT,
  ENERGY_RUN_PREPARATION_EVENT,
};

export type EnergyRunPreparationDetails = {
  cacheStatus?: "computed" | "reused";
  evidenceQueryCount?: number;
  packageStatus?: EnergyRunPackageStatus;
};

export type EnergyRunOutputKind = "reasoning" | "text";

export type EnergyRunPreparationTrace = {
  record(phase: EnergyRunPreparationPhase, details?: EnergyRunPreparationDetails): void;
  observeRuntimeEvent(event: BaseEvent, source?: "live" | "replay"): void;
  attachPersistence(persist: (event: BaseEvent) => void): void;
};

/**
 * Stream safe preparation progress before Run identity exists, then backfill the
 * same events into the canonical Run Event ledger once the Run is claimed.
 */
export const createEnergyRunPreparationTrace = (input: {
  correlationId?: string;
  runId: string;
  stream: (event: BaseEvent) => void;
  now?: () => number;
  startedAt?: number;
}): EnergyRunPreparationTrace => {
  const now = input.now ?? (() => performance.now());
  const startedAt = input.startedAt ?? now();
  const pending: BaseEvent[] = [];
  const latencyPhases = new Set<EnergyRunLatencyPhase>();
  let persist: ((event: BaseEvent) => void) | undefined;

  const emit = (event: BaseEvent): void => {
    input.stream(event);
    if (persist) {
      persist(event);
    } else {
      pending.push(event);
    }
  };

  const recordLatency = (
    phase: EnergyRunLatencyPhase,
    outputKind?: EnergyRunOutputKind,
    messageId?: string,
  ): void => {
    if (latencyPhases.has(phase)) return;
    latencyPhases.add(phase);
    emit(createCustomEvent(ENERGY_RUN_LATENCY_EVENT, {
      eventId: milestoneEventId("latency", input.runId, phase),
      contract: ENERGY_RUN_LATENCY_CONTRACT,
      ...(input.correlationId ? { correlation_id: input.correlationId } : {}),
      phase,
      elapsed_ms: Math.max(0, Math.round(now() - startedAt)),
      ...(outputKind ? { output_kind: outputKind } : {}),
      ...(messageId ? { message_id: messageId } : {}),
    }));
  };

  const trace: EnergyRunPreparationTrace = {
    record(phase, details = {}) {
      const value = {
        eventId: milestoneEventId("preparation", input.runId, phase),
        contract: ENERGY_RUN_PREPARATION_CONTRACT,
        ...(input.correlationId ? { correlation_id: input.correlationId } : {}),
        phase,
        elapsed_ms: Math.max(0, Math.round(now() - startedAt)),
        ...(details.cacheStatus ? { cache_status: details.cacheStatus } : {}),
        ...(details.packageStatus ? { package_status: details.packageStatus } : {}),
        ...(details.evidenceQueryCount !== undefined
          ? { evidence_query_count: nonNegativeInteger(details.evidenceQueryCount) }
          : {}),
      };
      emit(createCustomEvent(ENERGY_RUN_PREPARATION_EVENT, value));
    },
    observeRuntimeEvent(event, source = "live") {
      if (source === "replay") return;
      if (event.type === EventType.RUN_STARTED) {
        recordLatency("agent-runtime-started");
        return;
      }
      if (isCustomEventNamed(event, "model.request.prepared")) {
        recordLatency("model-request-prepared");
        return;
      }
      const output = modelOutputMilestone(event);
      if (!output) return;
      recordLatency("first-model-event", output.kind, output.messageId);
      if (output.content) {
        recordLatency("first-model-content", output.kind, output.messageId);
      }
    },
    attachPersistence(nextPersist) {
      if (persist) throw new Error("ENERGY_RUN_PREPARATION_PERSISTENCE_ALREADY_ATTACHED");
      persist = nextPersist;
      pending.splice(0).forEach((event) => persist?.(event));
    },
  };
  recordLatency("request-received");
  return trace;
};

/** Accept only the non-sensitive versioned client correlation envelope. */
export const energyRunCorrelationIdFromForwardedProps = (
  forwardedProps: unknown,
): string | undefined => {
  const root = recordFromUnknown(forwardedProps);
  return parseEnergyRunCorrelation(root?.energyRunCorrelation)?.correlation_id;
};

const milestoneEventId = (
  kind: "latency" | "preparation",
  runId: string,
  phase: string,
): string => `energy-run-${kind}:${runId}:${phase}`;

const isCustomEventNamed = (event: BaseEvent, name: string): boolean => (
  event.type === EventType.CUSTOM
  && "name" in event
  && event.name === name
);

const modelOutputMilestone = (
  event: BaseEvent,
): { content: boolean; kind: EnergyRunOutputKind; messageId?: string } | undefined => {
  const messageId = eventMessageId(event);
  switch (String(event.type)) {
    case "REASONING_START":
    case "REASONING_MESSAGE_START":
      return { content: false, kind: "reasoning", ...(messageId ? { messageId } : {}) };
    case "TEXT_MESSAGE_START":
      return { content: false, kind: "text", ...(messageId ? { messageId } : {}) };
    case "REASONING_MESSAGE_CONTENT":
    case "REASONING_MESSAGE_CHUNK":
      return { content: nonEmptyEventDelta(event), kind: "reasoning", ...(messageId ? { messageId } : {}) };
    case "TEXT_MESSAGE_CONTENT":
    case "TEXT_MESSAGE_CHUNK":
      return { content: nonEmptyEventDelta(event), kind: "text", ...(messageId ? { messageId } : {}) };
    default:
      return undefined;
  }
};

const eventMessageId = (event: BaseEvent): string | undefined => {
  const value = (event as unknown as Record<string, unknown>).messageId;
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const nonEmptyEventDelta = (event: BaseEvent): boolean => {
  const record = event as unknown as Record<string, unknown>;
  const delta = typeof record.delta === "string"
    ? record.delta
    : typeof record.content === "string" ? record.content : "";
  return delta.trim().length > 0;
};

const nonNegativeInteger = (value: number): number => (
  Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
);

const recordFromUnknown = (value: unknown): Record<string, unknown> | undefined => (
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
);
