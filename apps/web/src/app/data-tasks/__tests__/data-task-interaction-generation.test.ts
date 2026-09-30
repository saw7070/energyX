import { describe, expect, it, vi } from "vitest";

import {
  advanceDataTaskInteractionGate,
  resolveDataTaskInteractionBlockReason,
  runDataTaskInteractionMutation,
  runDataTaskInteractionMutationAfterAwait,
  type DataTaskInteractionGateState,
} from "../data-task-interaction-generation";

describe("Data Tasks context-transition generation", () => {
  it("invalidates work captured before a transition even after interaction is re-enabled", () => {
    const initial: DataTaskInteractionGateState = {
      generation: 0,
      disabledReason: null,
    };
    const capturedGeneration = initial.generation;

    const transitioning = advanceDataTaskInteractionGate(
      initial,
      "Resolving exact analysis context before interaction is available.",
    );
    expect(transitioning.generation).toBe(1);
    expect(resolveDataTaskInteractionBlockReason(transitioning, capturedGeneration))
      .toContain("Resolving exact analysis context");

    const resolved = advanceDataTaskInteractionGate(transitioning, null);
    expect(resolved.generation).toBe(2);
    expect(resolveDataTaskInteractionBlockReason(resolved, capturedGeneration))
      .toBe("Analysis context changed before this action could run.");
    expect(resolveDataTaskInteractionBlockReason(resolved, resolved.generation)).toBeNull();
  });

  it("starts a new generation for a later transition with the same message", () => {
    const first = advanceDataTaskInteractionGate(
      { generation: 4, disabledReason: null },
      "Resolving exact analysis context before interaction is available.",
    );
    const enabled = advanceDataTaskInteractionGate(first, null);
    const second = advanceDataTaskInteractionGate(
      enabled,
      "Resolving exact analysis context before interaction is available.",
    );

    expect(second.generation).toBe(7);
  });

  it("invalidates work captured during a transition after interaction is re-enabled", () => {
    const transitioning = advanceDataTaskInteractionGate(
      { generation: 10, disabledReason: null },
      "Resolving exact analysis context before interaction is available.",
    );
    const capturedDuringTransition = transitioning.generation;

    const resolved = advanceDataTaskInteractionGate(transitioning, null);

    expect(resolved.generation).toBe(12);
    expect(resolveDataTaskInteractionBlockReason(resolved, capturedDuringTransition))
      .toBe("Analysis context changed before this action could run.");
  });

  it("blocks a stale cancellation before the external mutation is called", async () => {
    const cancelRun = vi.fn().mockResolvedValue(undefined);

    const result = await runDataTaskInteractionMutation({
      capturedGeneration: 3,
      getBlockReason: (generation) => generation === 4
        ? null
        : "Analysis context changed before this action could run.",
      mutation: cancelRun,
    });

    expect(result).toEqual({
      status: "blocked",
      reason: "Analysis context changed before this action could run.",
    });
    expect(cancelRun).not.toHaveBeenCalled();
  });

  it("blocks a refresh cancellation after a deferred stop crosses a completed transition", async () => {
    let releaseStop!: () => void;
    const stopActiveRun = vi.fn(() => new Promise<void>((resolve) => {
      releaseStop = resolve;
    }));
    const cancelRun = vi.fn().mockResolvedValue(undefined);
    const runAgent = vi.fn();
    let gate: DataTaskInteractionGateState = { generation: 7, disabledReason: null };

    const cancellation = runDataTaskInteractionMutationAfterAwait({
      capturedGeneration: gate.generation,
      getBlockReason: (generation) => resolveDataTaskInteractionBlockReason(gate, generation),
      beforeMutation: stopActiveRun,
      mutation: cancelRun,
    });
    gate = advanceDataTaskInteractionGate(gate, "Resolving exact analysis context.");
    gate = advanceDataTaskInteractionGate(gate, null);
    releaseStop();

    const result = await cancellation;
    if (result.status === "started") {
      await result.value;
      runAgent();
    }

    expect(result).toEqual({
      status: "blocked",
      reason: "Analysis context changed before this action could run.",
    });
    expect(cancelRun).not.toHaveBeenCalled();
    expect(runAgent).not.toHaveBeenCalled();
  });
});
