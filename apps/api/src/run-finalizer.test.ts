import { EventType, type BaseEvent } from "@ag-ui/client";
import { describe, expect, it, vi } from "vitest";

import { RunFinalizer, withRunTerminalIdentity } from "./run-finalizer.js";

describe("RunFinalizer authoritative terminal identity", () => {
  it.each([
    { operation: "complete", type: EventType.RUN_FINISHED, status: "completed" },
    { operation: "fail", type: EventType.RUN_ERROR, status: "failed" },
    { operation: "cancel", type: EventType.RUN_FINISHED, status: "canceled" },
  ] as const)("emits an exact durable terminal for $operation", async ({ operation, type, status }) => {
    const emitted: BaseEvent[] = [];
    const finalizer = createFinalizer(emitted);
    const terminalEvent = { type, timestamp: 1 } as BaseEvent;

    if (operation === "complete") {
      await finalizer.complete({
        terminalDecision: {
          status: "completed",
          evaluatedContextPackageRef: { packageId: "package-1", revision: 1 },
          evidenceRefs: [],
        },
        terminalEvent,
      });
    } else if (operation === "fail") {
      finalizer.fail({ errorMessage: "safe failure", terminalEvent });
    } else {
      await finalizer.cancelRun({ terminalEvent });
    }

    expect(emitted.at(-1)).toMatchObject({
      runId: "run-exact",
      runTerminalKind: "durable",
      status,
      type,
    });
  });

  it("marks a suspended transport finish without claiming durable completion", () => {
    expect(withRunTerminalIdentity({ type: EventType.RUN_FINISHED } as BaseEvent, {
      kind: "transport-suspended",
      runId: "run-suspended",
      status: "suspended",
    })).toMatchObject({
      runId: "run-suspended",
      runTerminalKind: "transport-suspended",
      status: "suspended",
      type: EventType.RUN_FINISHED,
    });
  });

  it("emits no second durable terminal after another worker wins the terminal CAS", () => {
    const emitted: BaseEvent[] = [];
    const finishActive = vi.fn()
      .mockReturnValueOnce({ status: "failed" })
      .mockReturnValueOnce(undefined);
    const finalizer = createFinalizer(emitted, finishActive);

    finalizer.fail({
      errorMessage: "first failure",
      terminalEvent: { type: EventType.RUN_ERROR } as BaseEvent,
    });
    finalizer.fail({
      errorMessage: "late failure",
      terminalEvent: { type: EventType.RUN_ERROR } as BaseEvent,
    });

    expect(emitted.filter((event) => (
      (event as BaseEvent & { runTerminalKind?: string }).runTerminalKind === "durable"
    ))).toHaveLength(1);
    expect(finishActive).toHaveBeenCalledTimes(2);
  });

  it("does not emit suspended after a terminal Run wins the state race", () => {
    const emitted: BaseEvent[] = [];
    const finalizer = createFinalizer(emitted, undefined, vi.fn(() => undefined));

    finalizer.suspend();

    expect(emitted).toHaveLength(0);
  });
});

const createFinalizer = (
  emitted: BaseEvent[],
  finishActive: ReturnType<typeof vi.fn> = vi.fn(() => ({ status: "running" })),
  suspendRunning: ReturnType<typeof vi.fn> = vi.fn(() => ({ status: "suspended" })),
): RunFinalizer => new RunFinalizer({
  destroyWorkspace: vi.fn(async () => undefined),
  emit: (event) => emitted.push(event),
  fileAssetService: {
    gcOrphanAssets: vi.fn(() => 0),
    syncWorkspaceFile: vi.fn(),
  } as never,
  flushCompletedMemory: vi.fn(async () => undefined),
  flushDraftsMemory: vi.fn(),
  memoryExtractionTimeoutMs: 50,
  metadataStore: {
    runs: { finishActive, suspendRunning },
  } as never,
  runId: "run-exact",
  sessionDir: "Z:/directory-that-does-not-exist",
  sessionId: "session-exact",
  userId: "user-exact",
  workspaceId: "workspace-exact",
});
