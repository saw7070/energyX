import { describe, expect, it, vi } from "vitest";
import { EventType } from "@ag-ui/client";
import { createCustomEvent } from "@datafoundry/agent-runtime";

import {
  createEnergyRunPreparationTrace,
  energyRunCorrelationIdFromForwardedProps,
} from "./energy-run-preparation.js";

describe("EnergyIQ run preparation trace", () => {
  it("accepts only the versioned safe correlation envelope", () => {
    expect(energyRunCorrelationIdFromForwardedProps({
      energyRunCorrelation: {
        contract: "energyiq-run-correlation@1",
        correlation_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      },
    })).toBe("f47ac10b-58cc-4372-a567-0e02b2c3d479");
    expect(energyRunCorrelationIdFromForwardedProps({
      energyRunCorrelation: {
        contract: "energyiq-run-correlation@1",
        correlation_id: "energy-run-correlation-12345678",
      },
    })).toBeUndefined();
    expect(energyRunCorrelationIdFromForwardedProps({
      energyRunCorrelation: {
        contract: "energyiq-run-correlation@1",
        correlation_id: "contains prompt text and spaces",
      },
    })).toBeUndefined();
    expect(energyRunCorrelationIdFromForwardedProps({
      energyRunCorrelation: {
        contract: "wrong-contract",
        correlation_id: "energy-run-correlation-12345678",
      },
    })).toBeUndefined();
  });

  it("streams safe monotonic phases immediately and persists the same events after Run claim", () => {
    const streamed: unknown[] = [];
    const persisted: unknown[] = [];
    const now = vi.fn()
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(14.4)
      .mockReturnValueOnce(23.8)
      .mockReturnValueOnce(31.2)
      .mockReturnValueOnce(42.2);
    const trace = createEnergyRunPreparationTrace({
      correlationId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      runId: "run-1",
      now,
      stream: (event) => streamed.push(event),
    });

    trace.record("request-accepted");
    trace.record("project-analysis-resolved", {
      cacheStatus: "reused",
      evidenceQueryCount: 10,
      packageStatus: "package_hit",
    });

    expect(streamed).toMatchObject([
      {
        type: "CUSTOM",
        name: "energy.run.latency",
        value: {
          contract: "energyiq-run-latency@1",
          correlation_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
          eventId: "energy-run-latency:run-1:request-received",
          phase: "request-received",
          elapsed_ms: 4,
        },
      },
      {
        type: "CUSTOM",
        name: "energy.run.preparation",
        value: {
          contract: "energyiq-run-preparation@1",
          correlation_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
          eventId: "energy-run-preparation:run-1:request-accepted",
          phase: "request-accepted",
          elapsed_ms: 14,
        },
      },
      {
        type: "CUSTOM",
        name: "energy.run.preparation",
        value: {
          contract: "energyiq-run-preparation@1",
          correlation_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
          eventId: "energy-run-preparation:run-1:project-analysis-resolved",
          phase: "project-analysis-resolved",
          elapsed_ms: 21,
          cache_status: "reused",
          evidence_query_count: 10,
          package_status: "package_hit",
        },
      },
    ]);
    expect(JSON.stringify(streamed)).not.toMatch(
      /prompt|sql|evidence_text|credential|api[_-]?key|customer/i,
    );

    trace.attachPersistence((event) => persisted.push(event));
    expect(persisted).toEqual(streamed);
    trace.record("run-claimed");
    expect(streamed.at(-1)).toMatchObject({
      type: "CUSTOM",
      name: "energy.run.preparation",
      value: {
        contract: "energyiq-run-preparation@1",
        correlation_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        phase: "run-claimed",
        elapsed_ms: 32,
      },
    });
    expect(persisted).toEqual(streamed);
    expect(now).toHaveBeenCalledTimes(5);
  });

  it("separates server preparation from model startup and records each runtime milestone once", () => {
    const streamed: unknown[] = [];
    const persisted: unknown[] = [];
    const now = vi.fn()
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(104)
      .mockReturnValueOnce(112)
      .mockReturnValueOnce(128)
      .mockReturnValueOnce(145)
      .mockReturnValueOnce(171)
      .mockReturnValueOnce(195);
    const trace = createEnergyRunPreparationTrace({
      correlationId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      runId: "run-1",
      now,
      stream: (event) => streamed.push(event),
    });

    trace.record("request-accepted");
    trace.attachPersistence((event) => persisted.push(event));
    trace.observeRuntimeEvent({ type: EventType.RUN_STARTED, runId: "run-1" });
    trace.observeRuntimeEvent(createCustomEvent("model.request.prepared", {
      eventId: "model-request-prepared:run-1:1:0",
    }));
    trace.observeRuntimeEvent({ type: "REASONING_START", messageId: "reasoning-1" } as never);
    trace.observeRuntimeEvent({
      type: "REASONING_MESSAGE_CONTENT",
      messageId: "reasoning-1",
      delta: "Checking the exact package.",
    } as never);

    // Replay must not double-count startup milestones.
    trace.observeRuntimeEvent({ type: EventType.RUN_STARTED, runId: "run-1" });
    trace.observeRuntimeEvent({
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: "answer-1",
      delta: "Answer",
    });

    expect(streamed).toMatchObject([
      {
        type: "CUSTOM",
        name: "energy.run.latency",
        value: {
          contract: "energyiq-run-latency@1",
          correlation_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
          phase: "request-received",
          elapsed_ms: 4,
        },
      },
      {
        name: "energy.run.preparation",
        value: {
          correlation_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
          phase: "request-accepted",
          elapsed_ms: 12,
        },
      },
      {
        name: "energy.run.latency",
        value: {
          contract: "energyiq-run-latency@1",
          correlation_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
          phase: "agent-runtime-started",
          elapsed_ms: 28,
        },
      },
      {
        name: "energy.run.latency",
        value: {
          contract: "energyiq-run-latency@1",
          correlation_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
          phase: "model-request-prepared",
          elapsed_ms: 45,
        },
      },
      {
        name: "energy.run.latency",
        value: {
          contract: "energyiq-run-latency@1",
          correlation_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
          phase: "first-model-event",
          output_kind: "reasoning",
          message_id: "reasoning-1",
          elapsed_ms: 71,
        },
      },
      {
        name: "energy.run.latency",
        value: {
          contract: "energyiq-run-latency@1",
          correlation_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
          phase: "first-model-content",
          output_kind: "reasoning",
          message_id: "reasoning-1",
          elapsed_ms: 95,
        },
      },
    ]);
    expect(persisted).toEqual(streamed);
    expect(JSON.stringify(streamed)).not.toMatch(
      /prompt|sql|evidence_text|credential|api[_-]?key|customer/i,
    );
    expect(now).toHaveBeenCalledTimes(7);
  });

  it("does not let recovered output consume the resumed live first-model milestone", () => {
    const streamed: unknown[] = [];
    const trace = createEnergyRunPreparationTrace({
      correlationId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      runId: "run-resume",
      now: vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(1).mockReturnValueOnce(8),
      stream: (event) => streamed.push(event),
    });
    trace.observeRuntimeEvent({
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: "old-output",
      delta: "recovered",
    }, "replay");
    trace.observeRuntimeEvent({
      type: EventType.REASONING_MESSAGE_CONTENT,
      messageId: "resumed-output",
      delta: "live",
    });

    expect(streamed).toHaveLength(3);
    expect(streamed.slice(1)).toMatchObject([
      { value: { eventId: expect.stringContaining("run-resume"), phase: "first-model-event" } },
      { value: { eventId: expect.stringContaining("run-resume"), phase: "first-model-content" } },
    ]);
  });

  it("uses Run and phase as durable authority regardless of client correlation", () => {
    const events: unknown[] = [];
    for (const correlationId of [
      "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      "9a7b3302-25cc-4ec6-8a71-1ba83ad1b45e",
    ]) {
      const trace = createEnergyRunPreparationTrace({
        correlationId,
        runId: "same-run",
        now: () => 0,
        stream: (event) => events.push(event),
      });
      trace.observeRuntimeEvent({
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: "answer",
        delta: "answer",
      });
    }
    const eventIds = events.map((event) => (
      (event as { value: { eventId: string } }).value.eventId
    ));
    expect(eventIds.slice(0, 3)).toEqual(eventIds.slice(3));
    expect(new Set(eventIds)).toEqual(new Set([
      "energy-run-latency:same-run:request-received",
      "energy-run-latency:same-run:first-model-event",
      "energy-run-latency:same-run:first-model-content",
    ]));
  });

  it("does not mark empty model chunks as first visible content", () => {
    const events: Array<{ value?: { phase?: string } }> = [];
    const trace = createEnergyRunPreparationTrace({
      runId: "empty-run",
      now: () => 0,
      stream: (event) => events.push(event as never),
    });
    trace.observeRuntimeEvent({
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: "answer",
      delta: "   ",
    });
    expect(events.map((event) => event.value?.phase)).toEqual([
      "request-received",
      "first-model-event",
    ]);
  });
});
