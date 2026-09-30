import { describe, expect, it } from "vitest";

import {
  createOverviewAiCandidateSubmissionTool,
  overviewAiCandidateSubmissionSchema,
  OVERVIEW_AI_CANDIDATE_SUBMISSION_TOOL_NAME,
} from "./overview-ai-candidate-submission-tool.js";

const submission = {
  candidates: [{
    id: "candidate-1",
    epistemicLevel: "hypothesis" as const,
    title: "A quoted \"lower-intensity\" label stays ordinary text",
    takeaway: "The structured tool owns serialization.",
    action: "Verify the source metadata before changing operations.",
    expectedIfAct: "The team can decide with an authoritative baseline.",
    ifIgnored: "The apparent priority may remain misleading.",
    limitation: "The current source does not establish causality.",
    possibleExplanation: "The source remains unconfirmed.",
    nextCheck: "Verify it against the pinned Snapshot.",
    evidenceRefs: ["benchmark:priority-centre:A1"],
    evidenceSqlIndexes: [1],
  }],
};

describe("Overview AI Candidate submission tool", () => {
  it("strictly parses and echoes one Candidate submission without rewriting it", async () => {
    const tool = createOverviewAiCandidateSubmissionTool();

    const result = await tool.execute?.(submission, {} as never);

    expect(OVERVIEW_AI_CANDIDATE_SUBMISSION_TOOL_NAME).toBe("overview_ai_candidates_submit");
    expect(tool.description).toContain("zero to three evidence-backed Candidate analyses");
    expect(tool.description).toContain("action, expectedIfAct, ifIgnored, and limitation");
    expect(tool.description).toContain("downstream Editor");
    expect(result).toEqual({
      ok: true,
      resultType: "overview-ai-candidate-submission",
      payload: submission,
    });
  });

  it("fails closed on a duplicate successful submission in the same Run", async () => {
    const tool = createOverviewAiCandidateSubmissionTool();
    await tool.execute?.(submission, {} as never);

    const duplicate = await tool.execute?.({ candidates: [] }, {} as never);

    expect(duplicate).toMatchObject({
      ok: false,
      isError: true,
      error: { code: "OVERVIEW_AI_CANDIDATE_SUBMISSION_CONFLICT" },
    });
  });

  it("accepts zero to three Findings and rejects a fourth", () => {
    expect(overviewAiCandidateSubmissionSchema.safeParse({ candidates: [] }).success).toBe(true);
    expect(overviewAiCandidateSubmissionSchema.safeParse({
      candidates: Array.from({ length: 3 }, (_, index) => ({
        ...submission.candidates[0]!,
        id: `candidate-${index + 1}`,
      })),
    }).success).toBe(true);
    expect(overviewAiCandidateSubmissionSchema.safeParse({
      candidates: Array.from({ length: 4 }, (_, index) => ({
        ...submission.candidates[0]!,
        id: `candidate-${index + 1}`,
      })),
    }).success).toBe(false);
  });

  it("requires the action, expected outcome, ignored outcome, and limitation", () => {
    for (const field of ["action", "expectedIfAct", "ifIgnored", "limitation"] as const) {
      const candidate: Record<string, unknown> = { ...submission.candidates[0]! };
      delete candidate[field];

      expect(overviewAiCandidateSubmissionSchema.safeParse({ candidates: [candidate] }).success).toBe(false);
    }
  });

  it("requires a verification step when a Candidate proposes a possible explanation", () => {
    expect(overviewAiCandidateSubmissionSchema.safeParse({
      candidates: [{ ...submission.candidates[0]!, nextCheck: undefined }],
    }).success).toBe(false);
    expect(overviewAiCandidateSubmissionSchema.safeParse({
      candidates: [{ ...submission.candidates[0]!, possibleExplanation: undefined, nextCheck: undefined }],
    }).success).toBe(true);
  });

  it("keeps the Investigator transport bounded without imposing display-copy limits", () => {
    const textLimits = {
      title: 240,
      takeaway: 800,
      action: 600,
      expectedIfAct: 600,
      ifIgnored: 600,
      limitation: 600,
      significance: 600,
      possibleExplanation: 600,
      nextCheck: 600,
    } as const;

    for (const [field, max] of Object.entries(textLimits)) {
      expect(overviewAiCandidateSubmissionSchema.safeParse({
        candidates: [{ ...submission.candidates[0]!, [field]: "x".repeat(max) }],
      }).success).toBe(true);
      expect(overviewAiCandidateSubmissionSchema.safeParse({
        candidates: [{ ...submission.candidates[0]!, [field]: "x".repeat(max + 1) }],
      }).success).toBe(false);
    }
  });

  it("retains bounded Evidence references and 1-based SQL indexes", () => {
    const exactLimit = {
      ...submission.candidates[0]!,
      evidenceRefs: Array.from({ length: 24 }, (_, index) => `evidence:${index + 1}`),
      evidenceSqlIndexes: Array.from({ length: 24 }, (_, index) => index + 1),
    };
    expect(overviewAiCandidateSubmissionSchema.safeParse({ candidates: [exactLimit] }).success).toBe(true);
    expect(overviewAiCandidateSubmissionSchema.safeParse({
      candidates: [{ ...exactLimit, evidenceRefs: [...exactLimit.evidenceRefs, "evidence:25"] }],
    }).success).toBe(false);
    expect(overviewAiCandidateSubmissionSchema.safeParse({
      candidates: [{ ...exactLimit, evidenceRefs: ["x".repeat(241)] }],
    }).success).toBe(false);
    expect(overviewAiCandidateSubmissionSchema.safeParse({
      candidates: [{ ...exactLimit, evidenceSqlIndexes: [...exactLimit.evidenceSqlIndexes, 25] }],
    }).success).toBe(false);
    expect(overviewAiCandidateSubmissionSchema.safeParse({
      candidates: [{ ...exactLimit, evidenceSqlIndexes: [0] }],
    }).success).toBe(false);
  });

  it("requires verified Findings to bind Catalog or SQL Evidence without blocking exploration", () => {
    const unbound = {
      ...submission.candidates[0]!,
      evidenceRefs: [],
      evidenceSqlIndexes: [],
    };

    expect(overviewAiCandidateSubmissionSchema.safeParse({
      candidates: [{ ...unbound, epistemicLevel: "verified" }],
    }).success).toBe(false);
    expect(overviewAiCandidateSubmissionSchema.safeParse({
      candidates: [{ ...unbound, epistemicLevel: "verified", evidenceRefs: ["quality:window"] }],
    }).success).toBe(true);
    expect(overviewAiCandidateSubmissionSchema.safeParse({
      candidates: [{ ...unbound, epistemicLevel: "verified", evidenceSqlIndexes: [1] }],
    }).success).toBe(true);
    expect(overviewAiCandidateSubmissionSchema.safeParse({
      candidates: [{ ...unbound, epistemicLevel: "hypothesis" }],
    }).success).toBe(true);
    expect(overviewAiCandidateSubmissionSchema.safeParse({
      candidates: [{ ...unbound, epistemicLevel: "exploration-idea" }],
    }).success).toBe(true);
    expect(overviewAiCandidateSubmissionSchema.safeParse({ candidates: [] }).success).toBe(true);
  });

  it("allows one corrected submission after a schema rejection", async () => {
    const tool = createOverviewAiCandidateSubmissionTool();
    const invalid = await tool.execute?.({
      candidates: [{
        ...submission.candidates[0]!,
        epistemicLevel: "verified",
        evidenceRefs: [],
        evidenceSqlIndexes: [],
      }],
    }, {} as never);
    const corrected = await tool.execute?.({
      candidates: [{
        ...submission.candidates[0]!,
        epistemicLevel: "verified",
        evidenceRefs: [],
        evidenceSqlIndexes: [1],
      }],
    }, {} as never);

    expect(invalid).toMatchObject({ error: true });
    expect(corrected).toMatchObject({ ok: true, resultType: "overview-ai-candidate-submission" });
  });

  it("rejects Candidate identities and text that downstream parsing cannot accept", async () => {
    const invalidIdentityTool = createOverviewAiCandidateSubmissionTool();
    const invalidIdentity = await invalidIdentityTool.execute?.({
      candidates: [{ ...submission.candidates[0]!, id: "candidate 1" }],
    }, {} as never);
    const oversizedTextTool = createOverviewAiCandidateSubmissionTool();
    const oversizedText = await oversizedTextTool.execute?.({
      candidates: [{ ...submission.candidates[0]!, takeaway: "x".repeat(801) }],
    }, {} as never);

    expect(invalidIdentity).toMatchObject({ error: true });
    expect(oversizedText).toMatchObject({ error: true });
  });
});
