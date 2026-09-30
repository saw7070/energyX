import { describe, expect, it } from "vitest";

import { ContextPackageBuilder } from "../../inventory/context-package-builder.js";
import { createContextItem } from "../../inventory/context-item.js";
import type { ContextPlan } from "../../inventory/context-plan.js";
import { createMastraContextCompiledEventPayload } from "./mastra-context-compiled-event.js";

describe("createMastraContextCompiledEventPayload", () => {
  it("keeps stable group and source ordering for cache-prefix diagnostics", () => {
    const contextPackage = new ContextPackageBuilder().build([
      createContextItem({
        id: "source-z",
        sourceType: "z-source",
        sourceId: "z",
        groupId: "group-z",
        visibility: "model",
        trust: "tool",
        retention: "active",
        priority: 90,
        content: "z",
        metadata: { groupKind: "source", sourceKind: "test", sourceOwner: "server" },
      }),
      createContextItem({
        id: "source-a",
        sourceType: "a-source",
        sourceId: "a",
        groupId: "group-a",
        visibility: "model",
        trust: "tool",
        retention: "active",
        priority: 100,
        content: "a",
        metadata: { groupKind: "source", sourceKind: "test", sourceOwner: "server" },
      }),
    ], { packageId: "package-1", revision: 2 });
    const plan: ContextPlan = {
      planId: "plan-1",
      stepNumber: 1,
      packageRevision: 2,
      selectedGroupIds: ["group-z", "group-a"],
      omittedGroupIds: [],
      selectedSourceItemIds: ["source-z", "source-a"],
      omittedSourceItemIds: [],
      groupTokenCosts: [
        { groupId: "group-z", mandatory: false, retention: "active", selected: true, tokenCost: 10 },
        { groupId: "group-a", mandatory: true, retention: "active", selected: true, tokenCost: 20 },
      ],
      decisions: [],
      budget: {
        capabilitySource: "verified-model-default",
        contextWindow: 1_000_000,
        maxOutputTokens: 32_000,
        outputReserve: 32_000,
        safetyMargin: 4096,
        inputBudget: 963_904,
      },
      tokenReport: {
        systemTokens: 10,
        toolTokens: 20,
        messageTokens: 30,
        totalInputTokens: 60,
        inputBudget: 963_904,
        remainingTokens: 963_844,
        countQuality: "estimated",
      },
    };

    const first = createMastraContextCompiledEventPayload(contextPackage, plan, "deepseek-v4-flash");
    const second = createMastraContextCompiledEventPayload(contextPackage, plan, "deepseek-v4-flash");

    expect(second).toEqual(first);
    expect(first.checkpoint_schema_version).toBe(1);
    expect(first.selected_group_ids).toEqual(["group-z", "group-a"]);
    expect(first.group_token_costs.map((group) => group.groupId)).toEqual(["group-z", "group-a"]);
    expect(first.source_snapshot_hashes.map((snapshot) => snapshot.source_type)).toEqual([
      "a-source",
      "z-source",
    ]);
  });
});
