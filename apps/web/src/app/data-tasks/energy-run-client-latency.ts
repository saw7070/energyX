import {
  ENERGY_RUN_LATENCY_CONTRACT,
  ENERGY_RUN_LATENCY_EVENT,
  ENERGY_RUN_PREPARATION_CONTRACT,
  ENERGY_RUN_PREPARATION_EVENT,
  ENERGY_RUN_CORRELATION_CONTRACT,
  isEnergyRunLatencyPhase,
  isEnergyRunPackageStatus,
  isEnergyRunPreparationPhase,
  parseEnergyRunCorrelation,
  type EnergyRunCorrelation,
  type EnergyRunPackageStatus,
} from "@datafoundry/contracts";
import {
  attachEnergyRunCorrelation,
  type RunForwardedProps,
} from "./data-task-state";

export { type EnergyRunCorrelation } from "@datafoundry/contracts";
export const ENERGY_RUN_CLIENT_LATENCY_CONTRACT = "energyiq-client-run-latency@1" as const;


export type EnergyRunClientLatencySnapshot = {
  contract: typeof ENERGY_RUN_CLIENT_LATENCY_CONTRACT;
  correlationId: string;
  sendClickedAtMs: number;
  firstSseReceivedAtMs?: number;
  firstContentPaintedAtMs?: number;
  packageStatus?: EnergyRunPackageStatus;
  serverMilestones: Record<string, {
    clientReceivedAtMs: number;
    serverElapsedMs: number;
  }>;
};

type EventLike = {
  type?: string;
  name?: unknown;
  value?: unknown;
  messageId?: unknown;
  delta?: unknown;
  runId?: unknown;
  run_id?: unknown;
  runTerminalKind?: unknown;
  snapshot?: unknown;
  status?: unknown;
};

type MutableSnapshot = EnergyRunClientLatencySnapshot & {
  contentPaintScheduled?: boolean;
  correlatedServerEventObserved?: boolean;
  terminalObserved?: boolean;
};
const MAX_PENDING_RUNS_PER_THREAD = 8;

type TrackerDependencies = {
  now?: () => number;
  mark?: (name: string) => void;
  measure?: (name: string, startMark: string, endMark: string) => void;
  scheduleAfterPaint?: (callback: () => void) => void;
};

export type EnergyRunClientLatencyTracker = {
  begin(threadId: string, correlation: EnergyRunCorrelation): void;
  observe(threadId: string, event: EventLike): void;
  contentCommitted(
    threadId: string,
    messageId: string,
    content: string,
    isStillVisible?: () => boolean,
  ): void;
  visibilityChanged(threadId: string): void;
  disposeThread(threadId: string): void;
  read(threadId: string, correlationId?: string): EnergyRunClientLatencySnapshot | undefined;
};

/**
 * Browser-only latency ledger. It stores no Prompt, SQL, Evidence, credentials,
 * or customer data; the only identity is the short random correlation id.
 */
export const createEnergyRunClientLatencyTracker = (
  dependencies: TrackerDependencies = {},
): EnergyRunClientLatencyTracker => {
  const snapshots = new Map<string, MutableSnapshot[]>();
  const messageOwners = new Map<string, Map<string, string>>();
  const runOwners = new Map<string, Map<string, string>>();
  const suspendedRuns = new Map<string, Set<string>>();
  const committedMessages = new Map<string, Map<string, {
    hasContent: boolean;
    isStillVisible: () => boolean;
  }>>();
  const now = dependencies.now ?? (() => performance.now());
  const mark = dependencies.mark ?? safePerformanceMark;
  const measure = dependencies.measure ?? safePerformanceMeasure;
  const scheduleAfterPaint = dependencies.scheduleAfterPaint ?? scheduleBrowserPaint;

  const removeSnapshot = (threadId: string, correlationId: string): void => {
    const remaining = (snapshots.get(threadId) ?? []).filter(
      (candidate) => candidate.correlationId !== correlationId,
    );
    if (remaining.length > 0) snapshots.set(threadId, remaining);
    else snapshots.delete(threadId);
    for (const [messageId, owner] of messageOwners.get(threadId) ?? []) {
      if (owner !== correlationId) continue;
      messageOwners.get(threadId)?.delete(messageId);
      committedMessages.get(threadId)?.delete(messageId);
    }
    for (const [runId, owner] of runOwners.get(threadId) ?? []) {
      if (owner !== correlationId) continue;
      runOwners.get(threadId)?.delete(runId);
      suspendedRuns.get(threadId)?.delete(runId);
    }
  };

  const scheduleCommittedPaint = (threadId: string, messageId: string): void => {
    const correlationId = messageOwners.get(threadId)?.get(messageId);
    const committed = committedMessages.get(threadId)?.get(messageId);
    const snapshot = snapshots.get(threadId)?.find(
      (candidate) => candidate.correlationId === correlationId,
    );
    if (!snapshot?.correlatedServerEventObserved
      || !committed?.hasContent
      || !committed.isStillVisible()
      || snapshot.contentPaintScheduled
      || snapshot.firstContentPaintedAtMs !== undefined) return;
    snapshot.contentPaintScheduled = true;
    scheduleAfterPaint(() => {
      const current = snapshots.get(threadId)?.find(
        (candidate) => candidate.correlationId === snapshot.correlationId,
      );
      if (!current || current.firstContentPaintedAtMs !== undefined) return;
      if (!committed.isStillVisible()) {
        current.contentPaintScheduled = false;
        return;
      }
      current.firstContentPaintedAtMs = now();
      messageOwners.get(threadId)?.delete(messageId);
      committedMessages.get(threadId)?.delete(messageId);
      mark(markName("first-content-painted", current.correlationId));
      measure(
        measureName("send-to-first-content-paint", current.correlationId),
        markName("send-clicked", current.correlationId),
        markName("first-content-painted", current.correlationId),
      );
      if (current.terminalObserved) removeSnapshot(threadId, current.correlationId);
    });
  };

  return {
    begin(threadId, correlation) {
      if (!threadId || !isSafeCorrelationId(correlation.correlation_id)) return;
      const threadSnapshots = snapshots.get(threadId) ?? [];
      if (threadSnapshots.some((item) => item.correlationId === correlation.correlation_id)) return;
      const snapshot: MutableSnapshot = {
        contract: ENERGY_RUN_CLIENT_LATENCY_CONTRACT,
        correlationId: correlation.correlation_id,
        sendClickedAtMs: now(),
        serverMilestones: {},
      };
      threadSnapshots.push(snapshot);
      snapshots.set(threadId, threadSnapshots);
      for (const stale of threadSnapshots.slice(0, -MAX_PENDING_RUNS_PER_THREAD)) {
        removeSnapshot(threadId, stale.correlationId);
      }
      mark(markName("send-clicked", snapshot.correlationId));
    },
    observe(threadId, event) {
      const value = recordFromUnknown(event.value);
      const eventCorrelationId = stringFromRecord(value, "correlation_id");
      const snapshot = snapshots.get(threadId)?.find(
        (candidate) => candidate.correlationId === eventCorrelationId,
      );
      const isPreparation = event.name === ENERGY_RUN_PREPARATION_EVENT
        && value?.contract === ENERGY_RUN_PREPARATION_CONTRACT
        && isEnergyRunPreparationPhase(value?.phase);
      const isLatency = event.name === ENERGY_RUN_LATENCY_EVENT
        && value?.contract === ENERGY_RUN_LATENCY_CONTRACT
        && isEnergyRunLatencyPhase(value?.phase);
      const isCorrelatedServerEvent = event.type === "CUSTOM"
        && (isPreparation || isLatency)
        && eventCorrelationId === snapshot?.correlationId;
      if (isCorrelatedServerEvent && snapshot) {
        const runId = runIdFromMilestoneEventId(stringFromRecord(value, "eventId"));
        if (runId) {
          const owners = runOwners.get(threadId) ?? new Map<string, string>();
          owners.set(runId, snapshot.correlationId);
          runOwners.set(threadId, owners);
        }
        snapshot.correlatedServerEventObserved = true;
        const receivedAt = now();
        if (snapshot.firstSseReceivedAtMs === undefined) {
          snapshot.firstSseReceivedAtMs = receivedAt;
          mark(markName("first-sse-received", snapshot.correlationId));
          measure(
            measureName("send-to-first-sse", snapshot.correlationId),
            markName("send-clicked", snapshot.correlationId),
            markName("first-sse-received", snapshot.correlationId),
          );
        }
        if (isLatency) {
          const phase = stringFromRecord(value, "phase");
          const serverElapsedMs = numberFromRecord(value, "elapsed_ms");
          if (phase && serverElapsedMs !== undefined && serverElapsedMs >= 0) {
            snapshot.serverMilestones[phase] = {
              clientReceivedAtMs: receivedAt,
              serverElapsedMs,
            };
            if (phase === "first-model-content") {
              const messageId = stringFromRecord(value, "message_id");
              if (messageId) {
                const owners = messageOwners.get(threadId) ?? new Map<string, string>();
                owners.set(messageId, snapshot.correlationId);
                messageOwners.set(threadId, owners);
                scheduleCommittedPaint(threadId, messageId);
              }
            }
          }
        } else {
          const packageStatus = stringFromRecord(value, "package_status");
          if (isEnergyRunPackageStatus(packageStatus)) {
            snapshot.packageStatus = packageStatus;
          }
        }
      }
      const eventRunId = stringEventRunId(event);
      if ((event.type === "STATE_SNAPSHOT" || event.type === "STATE_DELTA") && eventRunId) {
        if (eventMarksRunSuspended(event)) {
          const runs = suspendedRuns.get(threadId) ?? new Set<string>();
          runs.add(eventRunId);
          suspendedRuns.set(threadId, runs);
        }
      }
      if (event.type === "RUN_STARTED" && eventRunId) {
        suspendedRuns.get(threadId)?.delete(eventRunId);
      }
      if (isCanonicalDurableTerminal(event) && eventRunId) {
        if (event.runTerminalKind === "transport-suspended"
          || event.status === "suspended"
          || (event.type === "RUN_FINISHED" && suspendedRuns.get(threadId)?.has(eventRunId))) return;
        const correlationId = runOwners.get(threadId)?.get(eventRunId);
        const terminalSnapshot = snapshots.get(threadId)?.find(
          (candidate) => candidate.correlationId === correlationId,
        );
        if (!terminalSnapshot) return;
        terminalSnapshot.terminalObserved = true;
        const hasPendingPaint = [...(messageOwners.get(threadId)?.values() ?? [])]
          .some((owner) => owner === terminalSnapshot.correlationId);
        if (!hasPendingPaint || terminalSnapshot.firstContentPaintedAtMs !== undefined) {
          removeSnapshot(threadId, terminalSnapshot.correlationId);
        }
      }
    },
    contentCommitted(threadId, messageId, content, isStillVisible = () => true) {
      const threadMessages = committedMessages.get(threadId) ?? new Map();
      threadMessages.set(messageId, { hasContent: Boolean(content.trim()), isStillVisible });
      while (threadMessages.size > MAX_PENDING_RUNS_PER_THREAD * 4) {
        const oldestMessageId = threadMessages.keys().next().value as string | undefined;
        if (!oldestMessageId) break;
        threadMessages.delete(oldestMessageId);
        messageOwners.get(threadId)?.delete(oldestMessageId);
      }
      committedMessages.set(threadId, threadMessages);
      scheduleCommittedPaint(threadId, messageId);
    },
    visibilityChanged(threadId) {
      for (const messageId of committedMessages.get(threadId)?.keys() ?? []) {
        scheduleCommittedPaint(threadId, messageId);
      }
    },
    disposeThread(threadId) {
      snapshots.delete(threadId);
      messageOwners.delete(threadId);
      runOwners.delete(threadId);
      suspendedRuns.delete(threadId);
      committedMessages.delete(threadId);
    },
    read(threadId, correlationId) {
      const threadSnapshots = snapshots.get(threadId);
      const snapshot = correlationId
        ? threadSnapshots?.find((candidate) => candidate.correlationId === correlationId)
        : threadSnapshots?.at(-1);
      if (!snapshot) return undefined;
      const {
        contentPaintScheduled: _scheduled,
        correlatedServerEventObserved: _correlated,
        terminalObserved: _terminal,
        ...readModel
      } = snapshot;
      return {
        ...readModel,
        serverMilestones: { ...readModel.serverMilestones },
      };
    },
  };
};

const isCanonicalDurableTerminal = (event: EventLike): boolean => (
  event.runTerminalKind === "durable"
  && (
    (event.type === "RUN_ERROR" && event.status === "failed")
    || (event.type === "RUN_FINISHED"
      && (event.status === "completed" || event.status === "canceled"))
  )
);

export const createEnergyRunCorrelation = (
  randomUuid: (() => string | undefined) | undefined = secureRandomUuid,
): EnergyRunCorrelation | undefined => {
  const correlationId = randomUuid?.();
  return correlationId
    ? parseEnergyRunCorrelation({
      contract: ENERGY_RUN_CORRELATION_CONTRACT,
      correlation_id: correlationId,
    })
    : undefined;
};

export const renderedEnergyRunContent = (
  content: string,
  hidden: boolean,
): string => hidden ? "" : content;

/** A mounted background Session can still receive stream events. Only the
 * active thread whose real DOM surface participates in layout can own paint. */
export const isEnergyRunPaintSurfaceVisible = (
  active: boolean,
  element: HTMLElement | null,
): boolean => {
  if (!active || !element || !element.isConnected || element.getClientRects().length === 0) {
    return false;
  }
  if (typeof getComputedStyle !== "function") return true;
  const style = getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
};

const isSafeCorrelationId = (value: string): boolean => Boolean(parseEnergyRunCorrelation({
  contract: ENERGY_RUN_CORRELATION_CONTRACT,
  correlation_id: value,
}));

const secureRandomUuid = (): string | undefined => {
  if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") {
    return undefined;
  }
  return crypto.randomUUID();
};

const markName = (phase: string, correlationId: string): string => (
  `energyiq.run.${phase}.${correlationId}`
);

/** Common client dispatch seam. Every new real Send gets exactly one opaque
 * correlation before it can be queued, branched, or handed to CopilotKit.
 * Retries keep the already-attached identity and never begin a second ledger. */
export const prepareEnergyRunDispatch = (input: {
  threadId?: string | null;
  forwardedProps: RunForwardedProps;
  tracker?: EnergyRunClientLatencyTracker;
  randomUuid?: () => string | undefined;
}): RunForwardedProps => {
  if (input.forwardedProps.energyRunCorrelation) return input.forwardedProps;
  const correlation = createEnergyRunCorrelation(input.randomUuid);
  if (!correlation) return input.forwardedProps;
  const forwardedProps = attachEnergyRunCorrelation(input.forwardedProps, correlation);
  if (input.threadId) (input.tracker ?? energyRunClientLatency).begin(input.threadId, correlation);
  return forwardedProps;
};

const measureName = (phase: string, correlationId: string): string => (
  `energyiq.run.${phase}.${correlationId}`
);

const scheduleBrowserPaint = (callback: () => void): void => {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => requestAnimationFrame(() => callback()));
    return;
  }
  callback();
};

const safePerformanceMark = (name: string): void => {
  try {
    performance.mark(name);
  } catch {
    // Performance marks are optional diagnostics, never a Send dependency.
  }
};

const safePerformanceMeasure = (name: string, startMark: string, endMark: string): void => {
  try {
    performance.measure(name, startMark, endMark);
  } catch {
    // Missing browser Performance APIs must not affect the Run.
  }
};

const recordFromUnknown = (value: unknown): Record<string, unknown> | undefined => (
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
);

const stringFromRecord = (
  value: Record<string, unknown> | undefined,
  key: string,
): string | undefined => typeof value?.[key] === "string" ? value[key] : undefined;

const numberFromRecord = (
  value: Record<string, unknown> | undefined,
  key: string,
): number | undefined => typeof value?.[key] === "number" && Number.isFinite(value[key])
  ? value[key]
  : undefined;

const stringEventRunId = (event: EventLike): string | undefined => (
  typeof event.runId === "string" && event.runId.length > 0
    ? event.runId
    : typeof event.run_id === "string" && event.run_id.length > 0 ? event.run_id : undefined
);

const runIdFromMilestoneEventId = (eventId: string | undefined): string | undefined => (
  /^energy-run-(?:latency|preparation):(.+):[^:]+$/u.exec(eventId ?? "")?.[1]
);

const eventMarksRunSuspended = (event: EventLike): boolean => {
  if (event.type === "STATE_SNAPSHOT") {
    return stringFromRecord(recordFromUnknown(event.snapshot), "runStatus") === "suspended";
  }
  return Array.isArray(event.delta) && event.delta.some((operation) => {
    const record = recordFromUnknown(operation);
    return record?.path === "/runStatus" && record?.value === "suspended";
  });
};

export const energyRunClientLatency = createEnergyRunClientLatencyTracker();
