import { describe, expect, it } from "vitest";
import { toStandardSchema } from "@mastra/core/schema";

import {
  PRESCHOOL_ADDITIONAL_AI_INSIGHTS_STRUCTURED_OUTPUT_V1,
  PRESCHOOL_ADDITIONAL_AI_INSIGHTS_STRUCTURED_OUTPUT_V2,
  PRESCHOOL_ADDITIONAL_AI_INSIGHTS_STRUCTURED_OUTPUT_V3,
  PRESCHOOL_ADDITIONAL_AI_INSIGHTS_TRANSITION_STRUCTURED_OUTPUT_V1,
  PRESCHOOL_EXECUTIVE_SYNTHESIS_STRUCTURED_OUTPUT_V4,
  PRESCHOOL_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V3,
  PRESCHOOL_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V4,
  resolveOverviewAiStageStructuredOutput,
  resolveOverviewAiStageStructuredOutputV4,
} from "./preschool-overview-ai-structured-output.js";

describe("Preschool Overview AI structured output", () => {
  it("keeps Additional discovery open while bounding its candidate transport", () => {
    expect(PRESCHOOL_ADDITIONAL_AI_INSIGHTS_STRUCTURED_OUTPUT_V1.schema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["candidates"],
      properties: {
        candidates: {
          type: "array",
          minItems: 0,
          items: {
            required: ["id", "title", "text", "epistemicStatus", "evidenceRefs", "toolAuditIds"],
            properties: {
              epistemicStatus: { enum: ["observed", "inferred", "speculative"] },
            },
          },
        },
      },
    });
    expect(PRESCHOOL_ADDITIONAL_AI_INSIGHTS_STRUCTURED_OUTPUT_V1.schema.properties!.candidates!.items!.properties)
      .not.toHaveProperty("canvas");
  });

  it("keeps the approved Canvas declaration in history while current transport delegates block acceptance", () => {
    const candidates = PRESCHOOL_ADDITIONAL_AI_INSIGHTS_STRUCTURED_OUTPUT_V2.schema.properties!.candidates!;
    const canvas = candidates.items!.properties!.canvas!;
    const block = canvas.properties!.investigatorBlocks!.items!;

    expect(block).toMatchObject({
      additionalProperties: false,
      required: ["id", "kind", "visualization", "title", "bindings"],
      properties: {
        kind: { enum: ["quantitative"] },
        visualization: { enum: ["metric", "comparison", "trend"] },
      },
    });
    expect(canvas.properties).not.toHaveProperty("html");
    expect(canvas.properties).not.toHaveProperty("url");
    expect(canvas.properties).not.toHaveProperty("sql");
    expect(canvas.properties!.finding!.properties!.evidenceRefs).toMatchObject({
      minItems: 1,
      uniqueItems: true,
    });
    expect(canvas.properties!.presentationGapRequests!.items!.properties!.evidenceRefs).toMatchObject({
      minItems: 1,
      uniqueItems: true,
    });
    expect(PRESCHOOL_ADDITIONAL_AI_INSIGHTS_STRUCTURED_OUTPUT_V3.schema.properties!.candidates)
      .toMatchObject({ type: "array", maxItems: 32, items: { type: "object" } });
    expect(PRESCHOOL_ADDITIONAL_AI_INSIGHTS_STRUCTURED_OUTPUT_V3.errorStrategy).toBe("warn");
    expect(PRESCHOOL_ADDITIONAL_AI_INSIGHTS_TRANSITION_STRUCTURED_OUTPUT_V1.errorStrategy).toBe("warn");
    expect(resolveOverviewAiStageStructuredOutput("additional-insights-discovery"))
      .toBe(PRESCHOOL_ADDITIONAL_AI_INSIGHTS_STRUCTURED_OUTPUT_V3);
  });

  it("keeps the historical origin schema strict without making current root validation candidate-global", async () => {
    const historicalSchema = toStandardSchema(PRESCHOOL_ADDITIONAL_AI_INSIGHTS_STRUCTURED_OUTPUT_V2.schema as never);
    const currentSchema = toStandardSchema(PRESCHOOL_ADDITIONAL_AI_INSIGHTS_STRUCTURED_OUTPUT_V3.schema as never);
    const candidate = (origin: unknown) => ({
      candidates: [{
        id: "candidate-origin",
        title: "Distinct denominator signal",
        text: "The intensity pattern differs from total consumption.",
        epistemicStatus: "inferred",
        origin,
        incrementalContext: {
          relatedPresentedClaimIds: ["deterministic-overview:analysis.summary.usage_kwh"],
          novelConclusion: "Compare the already-presented total with a different denominator.",
        },
        evidenceRefs: ["analysis.summary.usage_kwh"],
        toolAuditIds: [],
      }],
    });
    const historicalCandidate = (origin: unknown) => {
      const { incrementalContext: _incrementalContext, ...value } = candidate(origin).candidates[0]!;
      return { candidates: [value] };
    };
    const validateHistorical = (origin: unknown) => Promise.resolve(
      historicalSchema["~standard"].validate(historicalCandidate(origin)),
    );
    const validateCurrent = (origin: unknown) => Promise.resolve(currentSchema["~standard"].validate(candidate(origin)));

    await expect(validateHistorical({ kind: "ai-discovery", directionMethodResourceIds: [] }))
      .resolves.toEqual(expect.not.objectContaining({ issues: expect.anything() }));
    await expect(validateHistorical({
      kind: "expert-sop",
      directionMethodResourceIds: ["insight-method:workspace-direction"],
    })).resolves.toEqual(expect.not.objectContaining({ issues: expect.anything() }));
    await expect(validateHistorical({
      kind: "hybrid",
      directionMethodResourceIds: ["insight-method:workspace-direction"],
      novelContribution: "Connect the approved direction with a separately evidenced counter-pattern.",
    })).resolves.toEqual(expect.not.objectContaining({ issues: expect.anything() }));

    for (const [name, origin] of Object.entries({
      "ai-extra": { kind: "ai-discovery", directionMethodResourceIds: [], html: "<b>unsafe</b>" },
      "ai-direction": { kind: "ai-discovery", directionMethodResourceIds: ["insight-method:forged"] },
      "sop-empty": { kind: "expert-sop", directionMethodResourceIds: [] },
      "sop-duplicate": {
        kind: "expert-sop",
        directionMethodResourceIds: ["insight-method:one", "insight-method:one"],
      },
      "sop-novel": {
        kind: "expert-sop",
        directionMethodResourceIds: ["insight-method:one"],
        novelContribution: "Only hybrid may declare this.",
      },
      "hybrid-missing-novel": { kind: "hybrid", directionMethodResourceIds: ["insight-method:one"] },
      "hybrid-empty-direction": { kind: "hybrid", directionMethodResourceIds: [], novelContribution: "Novel." },
      "hybrid-long-novel": {
        kind: "hybrid",
        directionMethodResourceIds: ["insight-method:one"],
        novelContribution: "x".repeat(801),
      },
      forged: { kind: "browser-authored", directionMethodResourceIds: [] },
    })) {
      const result = await validateHistorical(origin);
      expect(result, name).toEqual(expect.objectContaining({ issues: expect.any(Array) }));
      await expect(validateCurrent(origin), name)
        .resolves.toEqual(expect.not.objectContaining({ issues: expect.anything() }));
    }
  });

  it("leaves incremental-claim detail to candidate-local acceptance", async () => {
    const schema = toStandardSchema(PRESCHOOL_ADDITIONAL_AI_INSIGHTS_STRUCTURED_OUTPUT_V3.schema as never);
    const proposal = (incrementalContext: unknown) => ({ candidates: [{
      id: "candidate-incremental",
      title: "A separately testable concentration pattern",
      text: "The already-presented share may be concentrated in recurring intervals.",
      epistemicStatus: "speculative",
      origin: { kind: "ai-discovery", directionMethodResourceIds: [] },
      incrementalContext,
      evidenceRefs: ["analysis.off_hours.share_pct"],
      toolAuditIds: [],
    }] });

    await expect(Promise.resolve(schema["~standard"].validate(proposal({
      relatedPresentedClaimIds: ["section:standby-wastage:summary"],
      novelConclusion: "Test whether the known share is concentrated in recurring intervals.",
    })))).resolves.toEqual(expect.not.objectContaining({ issues: expect.anything() }));
    for (const incrementalContext of [
      { relatedPresentedClaimIds: ["claim-a", "claim-a"], novelConclusion: "Duplicate refs." },
      { relatedPresentedClaimIds: [], novelConclusion: "" },
      { relatedPresentedClaimIds: [], novelConclusion: "Novel.", html: "<b>unsafe</b>" },
    ]) {
      await expect(Promise.resolve(schema["~standard"].validate(proposal(incrementalContext))))
        .resolves.toEqual(expect.not.objectContaining({ issues: expect.anything() }));
    }
    expect(resolveOverviewAiStageStructuredOutput("additional-insights-discovery"))
      .toBe(PRESCHOOL_ADDITIONAL_AI_INSIGHTS_STRUCTURED_OUTPUT_V3);
  });

  it("keeps production-shaped candidate format defects below the gross discovery envelope", async () => {
    const schema = toStandardSchema(PRESCHOOL_ADDITIONAL_AI_INSIGHTS_STRUCTURED_OUTPUT_V3.schema as never);
    const validCandidate = {
      id: "candidate-valid",
      title: "A separately testable timing relationship",
      text: "The recurring timing pattern may move differently from the already-presented total.",
      epistemicStatus: "speculative",
      origin: { kind: "ai-discovery", directionMethodResourceIds: [] },
      incrementalContext: {
        relatedPresentedClaimIds: ["deterministic-overview:analysis.summary.usage_kwh"],
        novelConclusion: "The recurring timing pattern may move differently from the already-presented total.",
      },
      evidenceRefs: ["analysis.summary.usage_kwh"],
      toolAuditIds: [],
    };
    const replay = {
      candidates: [
        validCandidate,
        { ...validCandidate, id: "candidate-long-title", title: "x".repeat(140) },
        {
          ...validCandidate,
          id: "candidate-misplaced-deep-dive",
          incrementalContext: {
            ...validCandidate.incrementalContext,
            deepDiveQuestion: "Which interval should be inspected next?",
          },
        },
      ],
    };

    await expect(Promise.resolve(schema["~standard"].validate(replay)))
      .resolves.toEqual(expect.not.objectContaining({ issues: expect.anything() }));
    await expect(Promise.resolve(schema["~standard"].validate({ candidates: ["not-an-object"] })))
      .resolves.toEqual(expect.objectContaining({ issues: expect.any(Array) }));
    await expect(Promise.resolve(schema["~standard"].validate({ candidates: Array.from({ length: 33 }, () => ({})) })))
      .resolves.toEqual(expect.objectContaining({ issues: expect.any(Array) }));
    expect(PRESCHOOL_ADDITIONAL_AI_INSIGHTS_STRUCTURED_OUTPUT_V3.schema.properties!.candidates)
      .toMatchObject({ type: "array", minItems: 0, maxItems: 32 });
  });

  it("leaves the publication title budget to candidate-local acceptance", async () => {
    const candidateSchema = PRESCHOOL_ADDITIONAL_AI_INSIGHTS_STRUCTURED_OUTPUT_V3
      .schema.properties!.candidates!.items!;
    expect(candidateSchema).toEqual({ type: "object" });
    const schema = toStandardSchema(PRESCHOOL_ADDITIONAL_AI_INSIGHTS_STRUCTURED_OUTPUT_V3.schema as never);
    const proposal = (title: string) => ({ candidates: [{
      id: "candidate-title-budget",
      title,
      text: "A separately testable relationship.",
      epistemicStatus: "inferred",
      origin: { kind: "ai-discovery", directionMethodResourceIds: [] },
      incrementalContext: {
        relatedPresentedClaimIds: [],
        novelConclusion: "A separately testable relationship.",
      },
      evidenceRefs: ["analysis.summary.usage_kwh"],
      toolAuditIds: [],
    }] });

    await expect(Promise.resolve(schema["~standard"].validate(proposal("x".repeat(100)))))
      .resolves.toEqual(expect.not.objectContaining({ issues: expect.anything() }));
    await expect(Promise.resolve(schema["~standard"].validate(proposal("x".repeat(101)))))
      .resolves.toEqual(expect.not.objectContaining({ issues: expect.anything() }));
  });

  it("keeps Section presentation budgets below the gross Provider envelope", async () => {
    const schema = toStandardSchema(PRESCHOOL_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V4.schema as never);
    const proposal = {
      sectionId: "operating-behaviour",
      status: "available",
      summary: {
        text: "A".repeat(400),
        evidenceRefs: ["evidence:summary"],
      },
      candidates: [{
        title: "T".repeat(97),
        epistemicStatus: "inferred",
        text: "I".repeat(481),
        evidenceRefs: ["evidence:insight"],
      }],
    };

    await expect(Promise.resolve(schema["~standard"].validate(proposal)))
      .resolves.toEqual(expect.not.objectContaining({ issues: expect.anything() }));
  });

  it("defers malformed Section envelopes to the local parser so exact honest-empty output can recover", () => {
    expect(PRESCHOOL_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V4.errorStrategy).toBe("warn");
  });

  it("keeps the v3 schema for history while making v4 the current Section discovery contract", () => {
    const legacyProperties = PRESCHOOL_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V3.schema.properties!;
    const v4Properties = PRESCHOOL_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V4.schema.properties!;
    const v4PropertyMap = v4Properties as Record<string, unknown>;

    expect(legacyProperties.keyPoints).toBeDefined();
    expect(legacyProperties.keyPoints!.items!.properties!.kind).toBeDefined();
    expect(v4PropertyMap.keyPoints).toBeUndefined();
    expect(v4PropertyMap.allowedNextChecks).toBeUndefined();
    expect(v4Properties.candidates!.items).toEqual({ type: "object" });
    expect(v4Properties.summary!.properties!.text).toMatchObject({ maxLength: 480 });
    expect(v4Properties.limitation).toMatchObject({ maxLength: 320 });
    expect(resolveOverviewAiStageStructuredOutput("section-interpreter"))
      .toBe(PRESCHOOL_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V3);
    expect(resolveOverviewAiStageStructuredOutputV4("section-interpreter"))
      .toBe(PRESCHOOL_SECTION_INTERPRETER_STRUCTURED_OUTPUT_V4);
    expect(resolveOverviewAiStageStructuredOutputV4("executive-synthesis"))
      .toBe(PRESCHOOL_EXECUTIVE_SYNTHESIS_STRUCTURED_OUTPUT_V4);
    expect(PRESCHOOL_EXECUTIVE_SYNTHESIS_STRUCTURED_OUTPUT_V4.errorStrategy).toBe("warn");
    expect(PRESCHOOL_EXECUTIVE_SYNTHESIS_STRUCTURED_OUTPUT_V4.schema).toMatchObject({
      required: ["status", "findings"],
      properties: {
        summary: { type: "object", properties: { text: { maxLength: 600 } } },
        findings: {
          type: "array",
          maxItems: 3,
          items: { type: "object" },
        },
      },
    });

    const sectionSummaryEvidence = v4Properties.summary!.properties!.evidenceRefs!;
    const executiveProperties = PRESCHOOL_EXECUTIVE_SYNTHESIS_STRUCTURED_OUTPUT_V4.schema.properties!;
    expect(executiveProperties.findings!.items).toEqual({ type: "object" });
    const executiveSummaryEvidence = executiveProperties.summary!.properties!.evidenceRefs!;
    for (const schema of [
      sectionSummaryEvidence,
      executiveSummaryEvidence,
    ]) expect(schema).not.toHaveProperty("uniqueItems");
  });
});
