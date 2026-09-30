import { describe, expect, it } from "vitest";

import {
  autonomousInsightOriginIsValid,
  canReuseAutonomousInsightArtifact,
  type AutonomousInsightOrigin,
  type InsightMethodRevisionRef,
} from "./energyiq-autonomous-insights.js";

const CORE_METHOD: InsightMethodRevisionRef = {
  skillId: "energy-insight-investigation",
  semanticVersion: "1.0.0",
  resourceId: "config-resource:energy-insight-investigation",
  resourceRevision: 7,
  contentSha256: "a".repeat(64),
  scope: "builtin",
  workspaceId: "workspace-system",
  userId: "user-system",
  role: "core-method",
};

const EXPERT_DIRECTION: InsightMethodRevisionRef = {
  skillId: "closed-hours-operations-sop",
  semanticVersion: "2.1.0",
  resourceId: "config-resource:closed-hours-operations-sop",
  resourceRevision: 12,
  contentSha256: "b".repeat(64),
  scope: "workspace",
  workspaceId: "workspace-singapore-preschool",
  userId: "user-charles",
  role: "expert-direction",
};

const originIsValid = (
  origin: AutonomousInsightOrigin,
  approvedMethods: readonly InsightMethodRevisionRef[] = [CORE_METHOD, EXPERT_DIRECTION],
  loadedMethods: readonly InsightMethodRevisionRef[] = [CORE_METHOD, EXPERT_DIRECTION],
) => autonomousInsightOriginIsValid({ origin, approvedMethods, loadedMethods });

describe("EnergyIQ autonomous insight origin", () => {
  it("accepts AI discovery, expert SOP and hybrid origins with approved methods that were actually loaded", () => {
    expect(originIsValid({
      kind: "ai-discovery",
      coreMethod: CORE_METHOD,
      directionMethods: [],
    })).toBe(true);

    expect(originIsValid({
      kind: "expert-sop",
      coreMethod: CORE_METHOD,
      directionMethods: [EXPERT_DIRECTION],
    })).toBe(true);

    expect(originIsValid({
      kind: "hybrid",
      coreMethod: CORE_METHOD,
      directionMethods: [EXPERT_DIRECTION],
      novelContribution: "The spike pattern is narrower than the SOP's usual baseline case.",
    })).toBe(true);
  });

  it("rejects an origin method that was loaded but not approved, or approved but not loaded", () => {
    const expertOrigin: AutonomousInsightOrigin = {
      kind: "expert-sop",
      coreMethod: CORE_METHOD,
      directionMethods: [EXPERT_DIRECTION],
    };

    expect(originIsValid(expertOrigin, [CORE_METHOD], [CORE_METHOD, EXPERT_DIRECTION])).toBe(false);
    expect(originIsValid(expertOrigin, [CORE_METHOD, EXPERT_DIRECTION], [CORE_METHOD])).toBe(false);
  });

  it("requires origin-specific method roles instead of treating the three origins as labels", () => {
    expect(originIsValid({
      kind: "ai-discovery",
      coreMethod: CORE_METHOD,
      directionMethods: [EXPERT_DIRECTION],
    } as unknown as AutonomousInsightOrigin)).toBe(false);

    expect(originIsValid({
      kind: "expert-sop",
      coreMethod: CORE_METHOD,
      directionMethods: [],
    } as unknown as AutonomousInsightOrigin)).toBe(false);

    expect(originIsValid({
      kind: "hybrid",
      coreMethod: CORE_METHOD,
      directionMethods: [EXPERT_DIRECTION],
      novelContribution: "   ",
    })).toBe(false);
  });
});

describe("EnergyIQ autonomous insight artifact reuse", () => {
  it("does not reuse an artifact when a method keeps its semantic version but its revision or SHA drifts", () => {
    expect(canReuseAutonomousInsightArtifact({
      requestedMethods: [CORE_METHOD, EXPERT_DIRECTION],
      artifactMethods: [EXPERT_DIRECTION, CORE_METHOD],
    })).toBe(true);

    expect(canReuseAutonomousInsightArtifact({
      requestedMethods: [CORE_METHOD, { ...EXPERT_DIRECTION, resourceRevision: 13 }],
      artifactMethods: [CORE_METHOD, EXPERT_DIRECTION],
    })).toBe(false);

    expect(canReuseAutonomousInsightArtifact({
      requestedMethods: [CORE_METHOD, { ...EXPERT_DIRECTION, contentSha256: "c".repeat(64) }],
      artifactMethods: [CORE_METHOD, EXPERT_DIRECTION],
    })).toBe(false);

    expect(canReuseAutonomousInsightArtifact({
      requestedMethods: [CORE_METHOD, { ...EXPERT_DIRECTION, workspaceId: "workspace-other-customer" }],
      artifactMethods: [CORE_METHOD, EXPERT_DIRECTION],
    })).toBe(false);
  });
});
