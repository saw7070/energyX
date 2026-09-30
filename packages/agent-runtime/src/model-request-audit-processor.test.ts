import { describe, expect, it, vi } from "vitest";

import {
  ContextRunState,
  MastraModelRequestAuditProcessor,
} from "./testing.js";

describe("MastraModelRequestAuditProcessor", () => {
  it("records the final Provider-boundary prompt and emits only its immutable reference", () => {
    const events: Array<{ name: string; value: unknown }> = [];
    const record = vi.fn().mockReturnValue({
      snapshotId: "model-request:run-1:1:0",
      contentSha256: `sha256:${"a".repeat(64)}`,
      payloadAvailability: "not-retained",
    });
    const runState = new ContextRunState({
      resourceId: "actor-1",
      sessionId: "session-1",
      runId: "run-1",
    });
    const state: Record<string, unknown> = {};
    const processor = new MastraModelRequestAuditProcessor({
      eventSink: {
        emitContextEvent: (name, value) => events.push({ name, value }),
      },
      modelName: "provider/model-1",
      recorder: { record },
      runState,
    });

    processor.processInputStep({
      activeTools: ["inspect_schema"],
      modelSettings: { maxOutputTokens: 800, temperature: 0.2 },
      retryCount: 0,
      state,
      stepNumber: 1,
      toolChoice: "auto",
      tools: {
        inspect_schema: {
          id: "inspect_schema",
          description: "Inspect the allowed schema",
          inputSchema: { toJSONSchema: () => ({ type: "object", properties: {} }) },
          execute: () => "must not be serialized",
          providerOptions: { headers: { Authorization: "must-not-be-stored" } },
        },
      },
    } as never);
    processor.processLLMRequest({
      prompt: [{ role: "user", content: [{ type: "text", text: "private final prompt" }] }],
      retryCount: 0,
      state,
      stepNumber: 1,
    } as never);

    expect(record).toHaveBeenCalledWith({
      schemaVersion: 1,
      requestFidelity: "complete",
      stepNumber: 1,
      retryCount: 0,
      modelName: "provider/model-1",
      contextPackage: {
        packageId: runState.package.packageId,
        revision: runState.package.revision,
      },
      prompt: [{ role: "user", content: [{ type: "text", text: "private final prompt" }] }],
      toolSet: [{
        name: "inspect_schema",
        description: "Inspect the allowed schema",
        inputSchema: { type: "object", properties: {} },
      }],
      activeToolNames: ["inspect_schema"],
      toolChoice: "auto",
      modelSettings: { maxOutputTokens: 800, temperature: 0.2 },
    });
    expect(events).toEqual([{
      name: "model.request.prepared",
      value: {
        eventId: "model-request-prepared:run-1:1:0",
        run_event_schema_version: 1,
        request_fidelity: "complete",
        step_number: 1,
        retry_count: 0,
        payload_availability: "not-retained",
        model: "provider/model-1",
        context_package_id: runState.package.packageId,
        context_package_revision: runState.package.revision,
        tool_names: ["inspect_schema"],
        payload_ref: {
          kind: "model-request-snapshot",
          id: "model-request:run-1:1:0",
          sha256: `sha256:${"a".repeat(64)}`,
        },
      },
    }]);
    expect(JSON.stringify(events)).not.toContain("private final prompt");
    expect(JSON.stringify(record.mock.calls)).not.toContain("must-not-be-stored");
    expect(JSON.stringify(record.mock.calls)).not.toContain("must not be serialized");
  });

});
