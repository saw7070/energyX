import { describe, expect, it } from "vitest";

import {
  acceptInsightCanvasPlan,
  type InsightCanvasAcceptanceInput,
  type InsightCanvasEvidenceFact,
  type InsightCanvasIdentity,
  type InsightCanvasPlan,
  type InsightCanvasQuantitativeBlock,
} from "./energyiq-insight-canvas.js";

const IDENTITY: InsightCanvasIdentity = {
  workspaceId: "workspace-singapore-preschool",
  projectId: "preschool-demo",
  scopeId: "project",
  dataSnapshotId: "snapshot:preschool:2026-05",
  projectReleaseId: "release:preschool:17",
};

const FACTS: readonly InsightCanvasEvidenceFact[] = [
  {
    identity: IDENTITY,
    evidenceRef: "evidence:closed-hours:portfolio",
    entityId: "portfolio:preschool-demo",
    metricId: "closed-hours-energy",
    value: 3_104,
    unit: "kWh",
  },
  {
    identity: IDENTITY,
    evidenceRef: "evidence:closed-hours:centre-l",
    entityId: "centre:l",
    metricId: "closed-hours-spike",
    value: 5.038,
    unit: "kWh",
  },
  {
    identity: IDENTITY,
    evidenceRef: "evidence:closed-hours:centre-e",
    entityId: "centre:e",
    metricId: "closed-hours-spike",
    value: 4.052,
    unit: "kWh",
  },
] as const;

const binding = (fact: InsightCanvasEvidenceFact) => ({
  evidenceRef: fact.evidenceRef,
  entityId: fact.entityId,
  metricId: fact.metricId,
  value: fact.value,
  unit: fact.unit,
});

const quantitativeBlock = (
  id: string,
  fact: InsightCanvasEvidenceFact,
  overrides: Partial<InsightCanvasQuantitativeBlock["bindings"][number]> = {},
): InsightCanvasQuantitativeBlock => ({
  id,
  kind: "quantitative",
  visualization: "metric",
  title: `Evidence-bound metric ${id}`,
  bindings: [{ ...binding(fact), ...overrides }],
});

const plan = (overrides: Partial<InsightCanvasPlan> = {}): InsightCanvasPlan => ({
  identity: IDENTITY,
  finding: {
    id: "finding:closed-hours-shape",
    title: "Closed-hours demand has two different shapes",
    text: "The recurring base load and isolated Centre spikes should not be treated as one operating problem.",
    evidenceRefs: [FACTS[0]!.evidenceRef, FACTS[1]!.evidenceRef],
    visualNeeded: true,
  },
  investigatorBlocks: [quantitativeBlock("metric:portfolio", FACTS[0]!)],
  presentationGapRequests: [],
  editorPlan: { orderedBlockIds: ["metric:portfolio"] },
  ...overrides,
});

const input = (candidatePlan: unknown = plan()): InsightCanvasAcceptanceInput => ({
  expectedIdentity: IDENTITY,
  evidenceFacts: FACTS,
  plan: candidatePlan,
});

describe("EnergyIQ Insight Canvas acceptance", () => {
  it("locally rejects quantitative blocks whose server-owned fact binding is not exact", () => {
    const valid = quantitativeBlock("metric:valid", FACTS[0]!);
    const wrongValue = quantitativeBlock("metric:wrong-value", FACTS[0]!, { value: 3_105 });
    const wrongUnit = quantitativeBlock("metric:wrong-unit", FACTS[0]!, { unit: "MWh" });
    const wrongEntity = quantitativeBlock("metric:wrong-entity", FACTS[0]!, { entityId: "centre:l" });
    const wrongMetric = quantitativeBlock("metric:wrong-metric", FACTS[0]!, { metricId: "total-energy" });
    const result = acceptInsightCanvasPlan(input(plan({
      investigatorBlocks: [valid, wrongValue, wrongUnit, wrongEntity, wrongMetric],
      editorPlan: {
        orderedBlockIds: [
          valid.id,
          wrongValue.id,
          wrongUnit.id,
          wrongEntity.id,
          wrongMetric.id,
        ],
      },
    })));

    expect(result.acceptedFinding?.id).toBe("finding:closed-hours-shape");
    expect(result.acceptedBlocks.map(({ id }) => id)).toEqual(["metric:valid"]);
    expect(result.rejections.filter(({ code }) => code === "EVIDENCE_BINDING_MISMATCH").map(({ subjectId }) => subjectId)).toEqual([
      "metric:wrong-value",
      "metric:wrong-unit",
      "metric:wrong-entity",
      "metric:wrong-metric",
    ]);
  });

  it("accepts an Evidence-backed Finding without forcing a visual when visualNeeded is false", () => {
    const result = acceptInsightCanvasPlan(input(plan({
      finding: {
        ...plan().finding,
        visualNeeded: false,
      },
      investigatorBlocks: [],
      editorPlan: { orderedBlockIds: [] },
    })));

    expect(result.acceptedFinding).toMatchObject({
      id: "finding:closed-hours-shape",
      visualNeeded: false,
    });
    expect(result.acceptedBlocks).toEqual([]);
    expect(result.gaps).toEqual([]);
    expect(result.rejections).toEqual([]);
  });

  it("lets the Editor select, delete and reorder Investigator blocks without gaining authorship", () => {
    const portfolio = quantitativeBlock("metric:portfolio", FACTS[0]!);
    const centreL = quantitativeBlock("metric:centre-l", FACTS[1]!);
    const centreE = quantitativeBlock("metric:centre-e", FACTS[2]!);
    const result = acceptInsightCanvasPlan(input(plan({
      investigatorBlocks: [portfolio, centreL, centreE],
      editorPlan: { orderedBlockIds: [centreE.id, portfolio.id] },
    })));

    expect(result.acceptedBlocks.map(({ id }) => id)).toEqual([centreE.id, portfolio.id]);
    expect(result.acceptedBlocks[0]?.bindings).toEqual(centreE.bindings);
    expect(result.acceptedBlocks.some(({ id }) => id === centreL.id)).toBe(false);
  });

  it("rejects unknown Editor blocks and any attempted binding override", () => {
    const source = quantitativeBlock("metric:portfolio", FACTS[0]!);
    const unknown = acceptInsightCanvasPlan(input(plan({
      investigatorBlocks: [source],
      editorPlan: { orderedBlockIds: [source.id, "metric:not-investigated"] },
    })));

    expect(unknown.acceptedBlocks.map(({ id }) => id)).toEqual([source.id]);
    expect(unknown.rejections).toContainEqual({
      code: "EDITOR_BLOCK_NOT_INVESTIGATED",
      subjectId: "metric:not-investigated",
    });

    const attemptedOverride = acceptInsightCanvasPlan(input({
      ...plan({ investigatorBlocks: [source] }),
      editorPlan: {
        orderedBlockIds: [source.id],
        blockOverrides: {
          [source.id]: { bindings: [{ ...source.bindings[0], value: 999_999 }] },
        },
      },
    }));
    expect(attemptedOverride.acceptedBlocks).toEqual([]);
    expect(attemptedOverride.rejections).toContainEqual({
      code: "EDITOR_PLAN_INVALID",
      subjectId: "editor-plan",
    });
  });

  it.each([
    ["tenant", { workspaceId: "workspace-other-customer" }],
    ["Snapshot", { dataSnapshotId: "snapshot:other" }],
    ["Project Release", { projectReleaseId: "release:other" }],
  ])("fails closed when the plan %s identity differs", (_label, identityOverride) => {
    const result = acceptInsightCanvasPlan(input(plan({
      identity: { ...IDENTITY, ...identityOverride },
    })));

    expect(result.acceptedFinding).toBeNull();
    expect(result.acceptedBlocks).toEqual([]);
    expect(result.gaps).toEqual([]);
    expect(result.rejections).toEqual([{
      code: "PLAN_IDENTITY_MISMATCH",
      subjectId: "plan",
    }]);
  });

  it("turns an unsupported expression into non-executable human roadmap Evidence", () => {
    const unsupportedExpression = {
      thesis: "A relationship view could show whether the same Centres recur across otherwise separate signals.",
      requestedCapability: "Evidence-bound Centre relationship diagram",
      why: "The current metric and comparison blocks cannot express many-to-many relationships without implying unsupported causality.",
      requiredDataShape: "Centre nodes plus typed signal edges, each carrying a server-owned Evidence reference.",
      evidenceRefs: [FACTS[1]!.evidenceRef, FACTS[2]!.evidenceRef],
      safeFallback: "table" as const,
    };
    const result = acceptInsightCanvasPlan(input(plan({
      investigatorBlocks: [],
      editorPlan: { orderedBlockIds: [] },
      presentationGapRequests: [unsupportedExpression, {
        ...unsupportedExpression,
        evidenceRefs: [...unsupportedExpression.evidenceRefs].reverse(),
      }],
    })));

    expect(result.acceptedFinding?.id).toBe("finding:closed-hours-shape");
    expect(result.acceptedBlocks).toEqual([]);
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0]).toMatchObject({
      ...unsupportedExpression,
      occurrences: 2,
      disposition: "human-roadmap-evidence-only",
    });
    expect(result.gaps[0]?.roadmapEvidenceKey).toMatch(/^insight-canvas-gap-v1:/u);
    expect(JSON.stringify(result.gaps)).not.toMatch(/publish|execute|codingAgent/iu);
  });

  it.each([
    ["HTML", { thesis: "<strong>Render this</strong>" }],
    ["JavaScript", { why: "javascript:alert(1)" }],
    ["React", { requestedCapability: "Return a React component" }],
    ["CSS", { requiredDataShape: "CSS grid with url(https://example.test/chart)" }],
    ["URL", { requestedCapability: "Fetch https://example.test/chart" }],
    ["script", { why: "Run this script after validation" }],
    ["function", { requiredDataShape: "Use a function that receives arbitrary props" }],
    ["callable value", { why: () => "execute" }],
  ])("rejects a presentation Gap containing %s instead of preserving executable declarations", (_label, override) => {
    const result = acceptInsightCanvasPlan(input(plan({
      presentationGapRequests: [{
        thesis: "A relationship view could reveal repeated Centre membership.",
        requestedCapability: "Evidence-bound relationship diagram",
        why: "The supported blocks cannot express this relationship.",
        requiredDataShape: "Centre nodes and typed Evidence edges.",
        evidenceRefs: [FACTS[1]!.evidenceRef],
        safeFallback: "prose",
        ...override,
      } as unknown as InsightCanvasPlan["presentationGapRequests"][number]],
    })));

    expect(result.gaps).toEqual([]);
    expect(result.rejections).toContainEqual({
      code: "PRESENTATION_GAP_INVALID",
      subjectId: "presentation-gap:1",
    });
  });

  it("applies the non-executable declaration rule to Finding and block text too", () => {
    const unsafeFinding = acceptInsightCanvasPlan(input(plan({
      finding: {
        ...plan().finding,
        text: "Render <img src=x onerror=alert(1)>",
      },
    })));
    expect(unsafeFinding.acceptedFinding).toBeNull();
    expect(unsafeFinding.rejections).toContainEqual({ code: "FINDING_INVALID", subjectId: "finding" });

    const unsafeBlock = quantitativeBlock("metric:unsafe-title", FACTS[0]!);
    unsafeBlock.title = "Open https://example.test and inject CSS";
    const blockResult = acceptInsightCanvasPlan(input(plan({
      investigatorBlocks: [unsafeBlock],
      editorPlan: { orderedBlockIds: [unsafeBlock.id] },
    })));
    expect(blockResult.acceptedBlocks).toEqual([]);
    expect(blockResult.rejections).toContainEqual({
      code: "INVESTIGATOR_BLOCK_INVALID",
      subjectId: unsafeBlock.id,
    });
  });

  it("rejects a Gap whose Evidence reference is absent from the exact tenant Snapshot and Release", () => {
    const result = acceptInsightCanvasPlan(input(plan({
      presentationGapRequests: [{
        thesis: "A relationship view could reveal repeated Centre membership.",
        requestedCapability: "Evidence-bound relationship diagram",
        why: "The supported blocks cannot express this relationship.",
        requiredDataShape: "Centre nodes and typed Evidence edges.",
        evidenceRefs: ["evidence:other-snapshot"],
        safeFallback: "omit-visual",
      }],
    })));

    expect(result.gaps).toEqual([]);
    expect(result.rejections).toContainEqual({
      code: "PRESENTATION_GAP_INVALID",
      subjectId: "presentation-gap:1",
    });
  });
});
