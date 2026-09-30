import { describe, expect, it } from "vitest";

import {
  ADDITIONAL_AI_INSIGHT_SUBMISSION_TOOL_NAME,
  additionalAiInsightSubmissionSchema,
  createAdditionalAiInsightSubmissionTool,
} from "./additional-ai-insight-submission-tool.js";

describe("Additional AI Insight submission tool", () => {
  it("accepts a bounded gross candidate envelope without turning candidate validation into an all-or-nothing gate", async () => {
    const envelope = {
      candidates: [
        { id: "useful", title: "A useful angle", evidenceRefs: ["fact:1"] },
        { id: "malformed-sibling", evidenceRefs: "wrong-on-purpose" },
      ],
    };
    const tool = createAdditionalAiInsightSubmissionTool();

    const result = await tool.execute?.(envelope, {} as never);

    expect(ADDITIONAL_AI_INSIGHT_SUBMISSION_TOOL_NAME).toBe("energyiq_additional_insights_submit");
    expect(result).toEqual({
      ok: true,
      resultType: "additional-ai-insight-submission",
      payload: envelope,
    });
  });

  it("fails closed on an unbounded or malformed root envelope", () => {
    expect(additionalAiInsightSubmissionSchema.safeParse({ candidates: [] }).success).toBe(true);
    expect(additionalAiInsightSubmissionSchema.safeParse({ candidates: Array.from({ length: 13 }, () => ({})) }).success)
      .toBe(false);
    expect(additionalAiInsightSubmissionSchema.safeParse({ candidates: ["not-an-object"] }).success).toBe(false);
    expect(additionalAiInsightSubmissionSchema.safeParse({ candidates: [], extra: true }).success).toBe(false);
  });

  it("allows one corrected submission after a root-schema rejection and rejects a second success", async () => {
    const tool = createAdditionalAiInsightSubmissionTool();

    const rejected = await tool.execute?.({ candidates: ["not-an-object"] } as never, {} as never);
    const accepted = await tool.execute?.({ candidates: [{ id: "candidate-1" }] }, {} as never);
    const duplicate = await tool.execute?.({ candidates: [] }, {} as never);

    expect(rejected).toMatchObject({ error: true });
    expect(accepted).toMatchObject({ ok: true, resultType: "additional-ai-insight-submission" });
    expect(duplicate).toMatchObject({
      ok: false,
      isError: true,
      error: { code: "ADDITIONAL_AI_INSIGHT_SUBMISSION_CONFLICT" },
    });
  });
});
