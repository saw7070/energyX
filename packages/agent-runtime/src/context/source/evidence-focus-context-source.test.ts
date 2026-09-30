import { describe, expect, it } from "vitest";

import { createContextItem } from "../inventory/context-item.js";
import { createContextSourceMetadata } from "../inventory/context-source-metadata.js";
import { ContextRunState } from "../inventory/context-run-state.js";
import { MastraContextBudgetProcessor } from "../protocol/mastra/mastra-context-budget-processor.js";
import { MastraContextRuntimeSourceProcessor } from "../protocol/mastra/mastra-context-runtime-source-processor.js";
import { createEvidenceFocusRuntimeSource } from "./evidence-focus-context-source.js";
import { RuntimeContextSourceRegistry } from "./runtime-context-source-registry.js";

describe("createEvidenceFocusRuntimeSource", () => {
  it("keeps authoritative Energy context through runtime collection and prompt selection", async () => {
    const evidenceItems = [
      createContextItem({
        id: "energy-query-context:nap",
        sourceType: "energy-query-context",
        sourceId: "ngee-ann-polytechnic",
        groupId: "energy-query-context",
        visibility: "model",
        trust: "tool",
        retention: "active",
        priority: 100,
        content: "Authoritative EnergyIQ query context: snapshot=snapshot-1",
        metadata: createContextSourceMetadata({
          sourceKind: "energy-query-context",
          sourceOwner: "server"
        }, { atomic: true, groupKind: "source" })
      }),
      createContextItem({
        id: "project-analysis-pack:nap-v1",
        sourceType: "project-analysis-pack",
        sourceId: "ngee-ann-analysis-pack@v1",
        groupId: "project-analysis-pack:ngee-ann-analysis-pack@v1",
        visibility: "model",
        trust: "tool",
        retention: "active",
        priority: 99,
        content: "Authoritative Ngee Ann Analysis Pack",
        metadata: createContextSourceMetadata({
          sourceKind: "project-analysis-pack",
          sourceOwner: "server"
        }, { atomic: true, groupKind: "source" })
      })
    ];
    const source = createEvidenceFocusRuntimeSource(evidenceItems);
    expect(source).toBeDefined();

    const registry = new RuntimeContextSourceRegistry();
    registry.register(source!);
    const runState = new ContextRunState({
      resourceId: "user-1",
      sessionId: "session-1",
      runId: "run-1"
    });
    const runtimeProcessor = new MastraContextRuntimeSourceProcessor({
      registry,
      runScope: {
        runId: runState.identity.runId,
        sessionId: runState.identity.sessionId,
        userId: runState.identity.resourceId
      },
      runState
    });
    await runtimeProcessor.processInputStep({
      messages: [],
      stepNumber: 0,
      systemMessages: []
    } as never);

    expect(runState.package.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "energy-query-context:nap",
        sourceType: "evidence-focus",
        metadata: expect.objectContaining({ originalSourceType: "energy-query-context" })
      }),
      expect.objectContaining({
        id: "project-analysis-pack:nap-v1",
        sourceType: "evidence-focus",
        metadata: expect.objectContaining({ originalSourceType: "project-analysis-pack" })
      })
    ]));

    const emitted: Array<{ name: string; value: unknown }> = [];
    const budgetProcessor = new MastraContextBudgetProcessor({
      eventSink: {
        emitContextEvent: (name, value) => emitted.push({ name, value })
      },
      modelName: "qwen-plus",
      runState
    });
    const result = budgetProcessor.processInputStep({
      messages: [],
      stepNumber: 0,
      systemMessages: []
    } as never);

    expect(JSON.stringify(result)).toContain("Authoritative EnergyIQ query context");
    expect(JSON.stringify(result)).toContain("Authoritative Ngee Ann Analysis Pack");
    expect(emitted).toEqual([
      expect.objectContaining({
        name: "context.compiled",
        value: expect.objectContaining({
          selected_sources: expect.arrayContaining([
            expect.objectContaining({
              source_types: ["evidence-focus"],
              source_kinds: ["energy-query-context"]
            }),
            expect.objectContaining({
              source_types: ["evidence-focus"],
              source_kinds: ["project-analysis-pack"]
            })
          ])
        })
      })
    ]);

    const firstStepMessages = (result as { messages?: unknown[] }).messages ?? [];
    expect(firstStepMessages.length).toBeGreaterThan(0);

    const secondResult = budgetProcessor.processInputStep({
      messages: [
        ...firstStepMessages,
        {
          id: "question-1",
          role: "user",
          createdAt: new Date("2026-08-07T00:00:00.000Z"),
          content: {
            format: 2,
            parts: [{ type: "text", text: "Which centre should I investigate?" }]
          }
        }
      ],
      stepNumber: 1,
      systemMessages: []
    } as never);

    expect(
      JSON.stringify(secondResult).match(/Authoritative EnergyIQ query context/gu) ?? []
    ).toHaveLength(1);
    expect(runState.plans.at(-1)?.selectedGroupIds).not.toContain(
      "turn-context:energy-query-context"
    );
    expect(JSON.stringify(secondResult)).toContain("Which centre should I investigate?");
  });
});
