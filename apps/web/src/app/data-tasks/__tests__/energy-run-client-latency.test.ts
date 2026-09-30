import { describe, expect, it, vi } from "vitest";

import {
  createEnergyRunCorrelation,
  createEnergyRunClientLatencyTracker,
  isEnergyRunPaintSurfaceVisible,
  prepareEnergyRunDispatch,
  renderedEnergyRunContent,
  type EnergyRunCorrelation,
  type EnergyRunClientLatencyTracker,
} from "../energy-run-client-latency";
import type { RunForwardedProps } from "../data-task-state";

const correlation: EnergyRunCorrelation = {
  contract: "energyiq-run-correlation@1",
  correlation_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
};
const queuedCorrelation: EnergyRunCorrelation = {
  contract: "energyiq-run-correlation@1",
  correlation_id: "9a7b3302-25cc-4ec6-8a71-1ba83ad1b45e",
};

describe("EnergyX client run latency correlation", () => {
  it("uses only an opaque UUID v4 and never blocks Send when secure randomness is unavailable", () => {
    expect(createEnergyRunCorrelation(() => correlation.correlation_id)).toEqual(correlation);
    expect(createEnergyRunCorrelation(() => "customer-entered-correlation")).toBeUndefined();
    expect(createEnergyRunCorrelation(() => undefined)).toBeUndefined();
  });

  it("creates one correlation at the common composer, rewrite, and deferred-branch dispatch seam", () => {
    const begin = vi.fn();
    const tracker = { begin } as unknown as EnergyRunClientLatencyTracker;
    const base = { run_config: {} } as RunForwardedProps;
    const ids = [
      correlation.correlation_id,
      queuedCorrelation.correlation_id,
      "d9428888-122b-4a4b-a73e-bd0e7c8924f1",
    ];

    const dispatched = ["composer", "rewrite", "deferred-branch"].map((threadId, index) => (
      prepareEnergyRunDispatch({
        threadId,
        forwardedProps: base,
        tracker,
        randomUuid: () => ids[index],
      })
    ));
    expect(dispatched.map((item) => item.energyRunCorrelation?.correlation_id)).toEqual(ids);
    expect(begin).toHaveBeenCalledTimes(3);

    expect(prepareEnergyRunDispatch({
      threadId: "composer",
      forwardedProps: dispatched[0]!,
      tracker,
      randomUuid: () => { throw new Error("retry must preserve the existing id"); },
    })).toBe(dispatched[0]);
    expect(begin).toHaveBeenCalledTimes(3);
  });

  it("rejects hidden reasoning and orphan preambles from the paint ledger", () => {
    expect(renderedEnergyRunContent("hidden reasoning", true)).toBe("");
    expect(renderedEnergyRunContent("visible answer", false)).toBe("visible answer");
  });

  it("requires both the active thread and a real visible DOM surface before paint", () => {
    const style = { display: "block", visibility: "visible" };
    vi.stubGlobal("getComputedStyle", () => style);
    const surface = {
      isConnected: false,
      getClientRects: () => [{ width: 100, height: 20 }],
    } as unknown as HTMLElement;
    expect(isEnergyRunPaintSurfaceVisible(true, surface)).toBe(false);
    Object.assign(surface, { isConnected: true });
    expect(isEnergyRunPaintSurfaceVisible(false, surface)).toBe(false);
    expect(isEnergyRunPaintSurfaceVisible(true, surface)).toBe(true);
    style.display = "none";
    expect(isEnergyRunPaintSurfaceVisible(true, surface)).toBe(false);
    vi.unstubAllGlobals();
  });

  it("links Send, first SSE, server milestones, and the first painted model content", () => {
    let now = 100;
    const paintCallbacks: Array<() => void> = [];
    const mark = vi.fn();
    const measure = vi.fn();
    const tracker = createEnergyRunClientLatencyTracker({
      now: () => now,
      mark,
      measure,
      scheduleAfterPaint: (callback) => paintCallbacks.push(callback),
    });

    tracker.begin("thread-1", correlation);
    now = 125;
    tracker.observe("thread-1", {
      type: "CUSTOM",
      name: "energy.run.latency",
      value: {
        contract: "energyiq-run-latency@1",
        correlation_id: correlation.correlation_id,
        phase: "request-received",
        elapsed_ms: 3,
      },
    });
    now = 180;
    tracker.observe("thread-1", {
      type: "CUSTOM",
      name: "energy.run.preparation",
      value: {
        contract: "energyiq-run-preparation@1",
        correlation_id: correlation.correlation_id,
        phase: "analysis-context-package-resolved",
        elapsed_ms: 54,
        package_status: "package_hit",
      },
    });
    now = 260;
    tracker.observe("thread-1", contentEvent("reasoning-1", "Inspecting the immutable package."));
    tracker.contentCommitted("thread-1", "reasoning-1", "Inspecting the immutable package.");
    expect(paintCallbacks).toHaveLength(0);
    tracker.observe("thread-1", {
      type: "CUSTOM",
      name: "energy.run.latency",
      value: {
        contract: "energyiq-run-latency@1",
        correlation_id: correlation.correlation_id,
        phase: "first-model-content",
        elapsed_ms: 132,
        output_kind: "reasoning",
        message_id: "reasoning-1",
      },
    });
    expect(paintCallbacks).toHaveLength(1);
    now = 275;
    paintCallbacks[0]!();

    expect(tracker.read("thread-1")).toEqual({
      contract: "energyiq-client-run-latency@1",
      correlationId: correlation.correlation_id,
      sendClickedAtMs: 100,
      firstSseReceivedAtMs: 125,
      firstContentPaintedAtMs: 275,
      packageStatus: "package_hit",
      serverMilestones: {
        "request-received": { clientReceivedAtMs: 125, serverElapsedMs: 3 },
        "first-model-content": { clientReceivedAtMs: 260, serverElapsedMs: 132 },
      },
    });
    expect(mark).toHaveBeenCalledWith(
      `energyiq.run.send-clicked.${correlation.correlation_id}`,
    );
    expect(measure).toHaveBeenCalledWith(
      `energyiq.run.send-to-first-sse.${correlation.correlation_id}`,
      `energyiq.run.send-clicked.${correlation.correlation_id}`,
      `energyiq.run.first-sse-received.${correlation.correlation_id}`,
    );
    expect(measure).toHaveBeenCalledWith(
      `energyiq.run.send-to-first-content-paint.${correlation.correlation_id}`,
      `energyiq.run.send-clicked.${correlation.correlation_id}`,
      `energyiq.run.first-content-painted.${correlation.correlation_id}`,
    );
  });

  it("ignores replayed or foreign events that have no matching Send", () => {
    const tracker = createEnergyRunClientLatencyTracker({
      now: () => 10,
      mark: vi.fn(),
      measure: vi.fn(),
      scheduleAfterPaint: vi.fn(),
    });

    tracker.observe("thread-foreign", {
      type: "CUSTOM",
      name: "energy.run.preparation",
      value: {
        contract: "energyiq-run-preparation@1",
        correlation_id: "energy-run-foreign-12345678",
        phase: "request-accepted",
        elapsed_ms: 1,
      },
    });

    expect(tracker.read("thread-foreign")).toBeUndefined();
  });

  it("does not attribute an older queued Run's content to a new Send", () => {
    const scheduleAfterPaint = vi.fn();
    const tracker = createEnergyRunClientLatencyTracker({
      now: () => 10,
      mark: vi.fn(),
      measure: vi.fn(),
      scheduleAfterPaint,
    });

    tracker.begin("thread-1", correlation);
    tracker.observe("thread-1", {
      type: "TEXT_MESSAGE_CONTENT",
      messageId: "older-run",
      delta: "This belongs to the Run that was already active.",
    });

    tracker.contentCommitted("thread-1", "older-run", "   ");
    expect(scheduleAfterPaint).not.toHaveBeenCalled();
    expect(tracker.read("thread-1")?.firstContentPaintedAtMs).toBeUndefined();
  });

  it("keeps queued Sends separate and preserves the same id across retry", () => {
    const paints: Array<() => void> = [];
    let now = 1;
    const tracker = createEnergyRunClientLatencyTracker({
      now: () => now,
      mark: vi.fn(),
      measure: vi.fn(),
      scheduleAfterPaint: (callback) => paints.push(callback),
    });
    tracker.begin("thread-1", correlation);
    now = 2;
    tracker.begin("thread-1", queuedCorrelation);
    now = 3;
    tracker.begin("thread-1", correlation);
    tracker.observe("thread-1", contentEvent("message-first", "first queued answer"));
    tracker.contentCommitted("thread-1", "message-first", "first queued answer");
    tracker.observe("thread-1", latencyEvent(correlation.correlation_id, "message-first"));
    expect(paints).toHaveLength(1);
    paints.shift()!();
    expect(tracker.read("thread-1", correlation.correlation_id)?.sendClickedAtMs).toBe(1);
    expect(tracker.read("thread-1", correlation.correlation_id)?.firstContentPaintedAtMs).toBe(3);
    expect(tracker.read("thread-1", queuedCorrelation.correlation_id)?.firstContentPaintedAtMs)
      .toBeUndefined();

    now = 4;
    tracker.observe("thread-1", contentEvent("message-second", "second queued answer"));
    tracker.contentCommitted("thread-1", "message-second", "second queued answer");
    tracker.observe("thread-1", latencyEvent(queuedCorrelation.correlation_id, "message-second"));
    paints.shift()!();
    expect(tracker.read("thread-1", queuedCorrelation.correlation_id)?.firstContentPaintedAtMs).toBe(4);
  });

  it("requires a valid protocol revision and rechecks visibility at the paint boundary", () => {
    const paints: Array<() => void> = [];
    let visible = true;
    const tracker = createEnergyRunClientLatencyTracker({
      now: () => 10,
      mark: vi.fn(),
      measure: vi.fn(),
      scheduleAfterPaint: (callback) => paints.push(callback),
    });
    tracker.begin("thread-1", correlation);
    tracker.observe("thread-1", {
      ...latencyEvent(correlation.correlation_id),
      value: { ...latencyEvent(correlation.correlation_id).value, contract: "stale-contract@0" },
    });
    tracker.observe("thread-1", contentEvent("stale-message", "must not bind"));
    tracker.contentCommitted("thread-1", "stale-message", "must not bind");
    expect(paints).toHaveLength(0);

    tracker.observe("thread-1", contentEvent("visible-message", "visible now"));
    tracker.contentCommitted("thread-1", "visible-message", "visible now", () => visible);
    tracker.observe("thread-1", latencyEvent(correlation.correlation_id, "visible-message"));
    expect(paints).toHaveLength(1);
    visible = false;
    paints[0]!();
    expect(tracker.read("thread-1", correlation.correlation_id)?.firstContentPaintedAtMs)
      .toBeUndefined();
    visible = true;
    tracker.visibilityChanged("thread-1");
    expect(paints).toHaveLength(2);
    paints[1]!();
    expect(tracker.read("thread-1", correlation.correlation_id)?.firstContentPaintedAtMs)
      .toBe(10);
  });

  it("keeps a terminal one-chunk Run until activation paints once, then prunes terminal state", () => {
    const paints: Array<() => void> = [];
    let active = false;
    const tracker = createEnergyRunClientLatencyTracker({
      now: () => 10,
      mark: vi.fn(),
      measure: vi.fn(),
      scheduleAfterPaint: (callback) => paints.push(callback),
    });
    tracker.begin("thread-background", correlation);
    tracker.observe("thread-background", contentEvent("one-chunk", "complete answer"));
    tracker.contentCommitted("thread-background", "one-chunk", "complete answer", () => active);
    tracker.observe("thread-background", latencyEvent(
      correlation.correlation_id,
      "one-chunk",
      "run-background",
    ));
    tracker.observe("thread-background", durableTerminal("run-background", "completed"));
    expect(paints).toHaveLength(0);
    expect(tracker.read("thread-background", correlation.correlation_id)).toBeDefined();

    active = true;
    tracker.visibilityChanged("thread-background");
    expect(paints).toHaveLength(1);
    paints[0]!();
    expect(tracker.read("thread-background", correlation.correlation_id)).toBeUndefined();
  });

  it("binds out-of-order terminals to their exact Run instead of the latest queued Send", () => {
    const tracker = createEnergyRunClientLatencyTracker({
      now: () => 10,
      mark: vi.fn(),
      measure: vi.fn(),
      scheduleAfterPaint: vi.fn(),
    });
    tracker.begin("thread-overlap", correlation);
    tracker.observe("thread-overlap", requestLatencyEvent(correlation.correlation_id, "run-older"));
    tracker.begin("thread-overlap", queuedCorrelation);
    tracker.observe("thread-overlap", requestLatencyEvent(
      queuedCorrelation.correlation_id,
      "run-newer",
    ));

    tracker.observe("thread-overlap", durableTerminal("run-older", "completed"));
    expect(tracker.read("thread-overlap", correlation.correlation_id)).toBeUndefined();
    expect(tracker.read("thread-overlap", queuedCorrelation.correlation_id)).toBeDefined();

    tracker.observe("thread-overlap", durableTerminal("run-newer", "completed"));
    expect(tracker.read("thread-overlap", queuedCorrelation.correlation_id)).toBeUndefined();
  });

  it.each([
    { status: "failed", type: "RUN_ERROR" },
    { status: "canceled", type: "RUN_FINISHED" },
  ] as const)("clears the exact Run on a durable $status terminal", ({ status, type }) => {
    const tracker = createEnergyRunClientLatencyTracker();
    tracker.begin("thread-terminal", correlation);
    tracker.observe("thread-terminal", requestLatencyEvent(correlation.correlation_id, "run-terminal"));

    tracker.observe("thread-terminal", durableTerminal("run-terminal", status, type));

    expect(tracker.read("thread-terminal", correlation.correlation_id)).toBeUndefined();
  });

  it("does not guess terminal ownership when production omits the authoritative Run id", () => {
    const tracker = createEnergyRunClientLatencyTracker();
    tracker.begin("thread-unowned", correlation);
    tracker.observe("thread-unowned", requestLatencyEvent(correlation.correlation_id, "run-unowned"));

    tracker.observe("thread-unowned", {
      type: "RUN_FINISHED",
      runTerminalKind: "durable",
      status: "completed",
    });

    expect(tracker.read("thread-unowned", correlation.correlation_id)).toBeDefined();
  });

  it("does not clear correlation state for a raw legacy error carrying only a Run id", () => {
    const tracker = createEnergyRunClientLatencyTracker();
    tracker.begin("thread-legacy-error", correlation);
    tracker.observe("thread-legacy-error", requestLatencyEvent(
      correlation.correlation_id,
      "run-legacy-error",
    ));

    tracker.observe("thread-legacy-error", {
      type: "RUN_ERROR",
      runId: "run-legacy-error",
      status: "failed",
    });

    expect(tracker.read("thread-legacy-error", correlation.correlation_id)).toBeDefined();
  });

  it.each([
    {
      label: "live snapshot",
      event: {
        type: "STATE_SNAPSHOT",
        runId: "run-hitl",
        snapshot: { runStatus: "suspended" },
      },
    },
    {
      label: "restored state delta",
      event: {
        type: "STATE_DELTA",
        runId: "run-hitl",
        delta: [{ op: "replace", path: "/runStatus", value: "suspended" }],
      },
    },
  ])("does not treat a $label HITL transport finish as a durable terminal", ({ event }) => {
    const paints: Array<() => void> = [];
    const tracker = createEnergyRunClientLatencyTracker({
      now: () => 10,
      mark: vi.fn(),
      measure: vi.fn(),
      scheduleAfterPaint: (callback) => paints.push(callback),
    });
    tracker.begin("thread-hitl", correlation);
    tracker.observe("thread-hitl", requestLatencyEvent(correlation.correlation_id, "run-hitl"));
    tracker.observe("thread-hitl", event);
    tracker.observe("thread-hitl", {
      type: "RUN_FINISHED",
      runId: "run-hitl",
      runTerminalKind: "transport-suspended",
      status: "suspended",
    });
    expect(tracker.read("thread-hitl", correlation.correlation_id)).toBeDefined();

    tracker.observe("thread-hitl", { type: "RUN_STARTED", runId: "run-hitl" });
    tracker.observe("thread-hitl", contentEvent("resume-answer", "answer after approval"));
    tracker.contentCommitted("thread-hitl", "resume-answer", "answer after approval");
    tracker.observe("thread-hitl", latencyEvent(
      correlation.correlation_id,
      "resume-answer",
      "run-hitl",
    ));
    expect(paints).toHaveLength(1);
  });

  it("keeps a bounded content-free message ledger and disposes it with the thread", () => {
    const paints: Array<() => void> = [];
    const tracker = createEnergyRunClientLatencyTracker({
      now: () => 10,
      mark: vi.fn(),
      measure: vi.fn(),
      scheduleAfterPaint: (callback) => paints.push(callback),
    });
    tracker.begin("thread-bounded", correlation);
    for (let index = 0; index < 33; index += 1) {
      const messageId = `message-${index}`;
      tracker.observe("thread-bounded", latencyEvent(correlation.correlation_id, messageId));
      tracker.contentCommitted(
        "thread-bounded",
        messageId,
        `customer content ${index}`,
        () => false,
      );
    }
    tracker.contentCommitted("thread-bounded", "message-0", "old content", () => true);
    expect(paints).toHaveLength(0);
    tracker.contentCommitted("thread-bounded", "message-32", "latest content", () => true);
    expect(paints).toHaveLength(1);
    tracker.disposeThread("thread-bounded");
    paints[0]!();
    expect(tracker.read("thread-bounded", correlation.correlation_id)).toBeUndefined();
  });
});

const latencyEvent = (
  correlationId: string,
  messageId = "message-default",
  runId?: string,
) => ({
  type: "CUSTOM",
  name: "energy.run.latency",
  value: {
    contract: "energyiq-run-latency@1",
    correlation_id: correlationId,
    phase: "first-model-content",
    elapsed_ms: 1,
    message_id: messageId,
    ...(runId ? { eventId: `energy-run-latency:${runId}:first-model-content` } : {}),
  },
});

const contentEvent = (messageId: string, delta: string) => ({
  type: "TEXT_MESSAGE_CONTENT",
  messageId,
  delta,
});

const requestLatencyEvent = (correlationId: string, runId: string) => ({
  type: "CUSTOM",
  name: "energy.run.latency",
  value: {
    contract: "energyiq-run-latency@1",
    correlation_id: correlationId,
    phase: "request-received",
    elapsed_ms: 0,
    eventId: `energy-run-latency:${runId}:request-received`,
  },
});

const durableTerminal = (
  runId: string,
  status: "canceled" | "completed" | "failed",
  type: "RUN_ERROR" | "RUN_FINISHED" = "RUN_FINISHED",
) => ({
  type,
  runId,
  runTerminalKind: "durable",
  status,
});
