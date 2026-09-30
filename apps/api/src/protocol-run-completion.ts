import { EventType, type BaseEvent } from "@ag-ui/client";
import { DATA_AGENT_TOOL_NAMES, type ProtocolRunState } from "@datafoundry/agent-runtime";

import type { RunFinalizer } from "./run-finalizer.js";

type ProtocolCompletionInput = {
  finalizer: Pick<RunFinalizer, "complete" | "fail">;
  goalRuntime?: Parameters<RunFinalizer["complete"]>[0]["goalRuntime"];
  lastAssistantMessageId?: string;
  persistedAssistantMessageId?: string;
  protocol: {
    actionRouter: {
      execute(input: {
        runId: string;
        segmentId: string;
        actionId: string;
        actionName: string;
        input: unknown;
        idempotencyKey?: string;
      }): Promise<unknown>;
    };
    protocolRuntime: {
      getState(runId: string, segmentId?: string): ProtocolRunState;
      proposeCompletion(input: {
        runId: string;
        segmentId: string;
        expectedRevision: number;
        forceTerminal?: boolean;
      }): ProtocolRunState;
      terminateFailure(input: {
        runId: string;
        segmentId: string;
        reasons: string[];
      }): ProtocolRunState;
    };
    segmentId: string;
  };
  runId: string;
  terminalEvent: BaseEvent;
};

/** Complete a governed protocol run and convert finalization failures into a durable RUN_ERROR. */
export const completeProtocolRun = async (input: ProtocolCompletionInput): Promise<void> => {
  let protocolState = input.protocol.protocolRuntime.getState(input.runId, input.protocol.segmentId);
  const rejectedDataActions = protocolState.actions.filter((action) =>
    action.status === "rejected"
    && DATA_AGENT_TOOL_NAMES.some((actionName) => actionName === action.actionName)
    && isProtocolAdmissionRejection(action.reasonCode));
  if (protocolState.protocolId === "general-task" && rejectedDataActions.length > 0) {
    const attempted = [...new Set(rejectedDataActions.map((action) => action.actionName))].join(", ");
    const message = `DATA_ACTIONS_REJECTED_BY_PROTOCOL: ${rejectedDataActions.length} data tool call(s) `
      + `(${attempted}) were rejected by the general-task protocol before execution, so the requested analysis `
      + "never ran. The final assistant text explains the failure and is not a completed analysis.";
    failProtocolAndRun(input, message);
    return;
  }

  try {
    const answerMessageId = input.lastAssistantMessageId ?? input.persistedAssistantMessageId;
    if (
      protocolState.protocolId === "general-task"
      && answerMessageId
      && !committedGeneralAnswerMessageId(protocolState)
    ) {
      await input.protocol.actionRouter.execute({
        runId: input.runId,
        segmentId: input.protocol.segmentId,
        actionId: `${input.runId}:general-answer-commit`,
        actionName: "general.answer.commit",
        input: { messageId: answerMessageId },
        idempotencyKey: answerMessageId
      });
      protocolState = input.protocol.protocolRuntime.getState(input.runId, input.protocol.segmentId);
    }
    protocolState = input.protocol.protocolRuntime.proposeCompletion({
      runId: input.runId,
      segmentId: input.protocol.segmentId,
      expectedRevision: protocolState.revision,
      forceTerminal: true
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "PROTOCOL_FINALIZATION_FAILED";
    failProtocolAndRun(input, message);
    return;
  }

  const terminalDecision = protocolState.terminalDecision;
  if (!terminalDecision) {
    throw new Error("PROTOCOL_TERMINAL_DECISION_REQUIRED");
  }
  if (terminalDecision.status === "failed") {
    const message = terminalDecision.reasons.join("; ");
    input.finalizer.fail({
      errorMessage: message,
      terminalEvent: createRunErrorEvent(message)
    });
    return;
  }
  await input.finalizer.complete({
    ...(input.goalRuntime ? { goalRuntime: input.goalRuntime } : {}),
    terminalDecision,
    terminalEvent: input.terminalEvent
  });
};

/** Return the assistant message identifier carried by text or tool-parent AG-UI events. */
export const assistantMessageIdFromEvent = (event: BaseEvent): string | undefined => {
  if (event.type === EventType.TOOL_CALL_START) {
    const parentMessageId = (event as BaseEvent & { parentMessageId?: string }).parentMessageId;
    return typeof parentMessageId === "string" && parentMessageId.length > 0 ? parentMessageId : undefined;
  }
  if (
    event.type !== EventType.TEXT_MESSAGE_START
    && event.type !== EventType.TEXT_MESSAGE_CONTENT
    && event.type !== EventType.TEXT_MESSAGE_CHUNK
    && event.type !== EventType.TEXT_MESSAGE_END
  ) {
    return undefined;
  }
  const candidate = event as BaseEvent & { messageId?: string; role?: string };
  if (candidate.role && candidate.role !== "assistant") {
    return undefined;
  }
  return typeof candidate.messageId === "string" && candidate.messageId.length > 0
    ? candidate.messageId
    : undefined;
};

const committedGeneralAnswerMessageId = (state: ProtocolRunState): string | undefined => {
  if (typeof state.domain !== "object" || state.domain === null || Array.isArray(state.domain)) {
    return undefined;
  }
  const messageId = (state.domain as Record<string, unknown>).answerMessageId;
  return typeof messageId === "string" && messageId.length > 0 ? messageId : undefined;
};

const isProtocolAdmissionRejection = (reasonCode: string | undefined): boolean =>
  reasonCode === "ACTION_NOT_ALLOWED_IN_PHASE"
  || reasonCode === "PROTOCOL_ACTION_BUDGET_EXHAUSTED"
  || reasonCode === "PROTOCOL_GUARD_REJECTED";

const failProtocolAndRun = (input: ProtocolCompletionInput, message: string): void => {
  const current = input.protocol.protocolRuntime.getState(input.runId, input.protocol.segmentId);
  if (current.status === "terminal" && current.terminalDecision?.status === "failed") {
    input.finalizer.fail({ errorMessage: message, terminalEvent: createRunErrorEvent(message) });
    return;
  }
  if (current.status !== "active" && current.status !== "waiting") {
    throw new Error(
      `PROTOCOL_FAILURE_PERSISTENCE_FAILED:PROTOCOL_RUN_NOT_FAILABLE:${current.status}:${message}`
    );
  }
  let failedState: ProtocolRunState;
  try {
    failedState = input.protocol.protocolRuntime.terminateFailure({
      runId: input.runId,
      segmentId: input.protocol.segmentId,
      reasons: [message]
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "PROTOCOL_TERMINATION_FAILED";
    throw new Error(`PROTOCOL_FAILURE_PERSISTENCE_FAILED:${detail}`);
  }
  if (failedState.status !== "terminal" || failedState.terminalDecision?.status !== "failed") {
    throw new Error("PROTOCOL_FAILURE_PERSISTENCE_FAILED:TERMINAL_FAILED_STATE_REQUIRED");
  }
  input.finalizer.fail({ errorMessage: message, terminalEvent: createRunErrorEvent(message) });
};

const createRunErrorEvent = (message: string): BaseEvent => ({
  type: EventType.RUN_ERROR,
  message,
  timestamp: Date.now()
});
