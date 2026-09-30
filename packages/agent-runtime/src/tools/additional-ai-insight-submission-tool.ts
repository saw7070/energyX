import { createTool } from "@mastra/core/tools";
import { z } from "zod";

export const ADDITIONAL_AI_INSIGHT_SUBMISSION_TOOL_NAME = "energyiq_additional_insights_submit" as const;

const grossCandidateSchema = z.record(z.string(), z.unknown());

/**
 * Transport-only envelope. Candidate correctness, Evidence, novelty, and value
 * remain local workflow responsibilities so one malformed sibling cannot reject
 * the entire Provider response.
 */
export const additionalAiInsightSubmissionSchema = z.object({
  candidates: z.array(grossCandidateSchema).max(12),
}).strict();

export const createAdditionalAiInsightSubmissionTool = () => {
  let accepted = false;
  return createTool({
    id: ADDITIONAL_AI_INSIGHT_SUBMISSION_TOOL_NAME,
    description: "Submit the final Additional AI Insights candidate envelope. Submit one root object with candidates[], "
      + "ordered from highest to lowest incremental value. Candidate fields are reviewed independently after transport, "
      + "so preserve every candidate exactly. After one successful submission, stop and do not emit the envelope as "
      + "Assistant text.",
    inputSchema: additionalAiInsightSubmissionSchema,
    execute: async (input) => {
      const parsed = additionalAiInsightSubmissionSchema.safeParse(input);
      if (!parsed.success) {
        return {
          ok: false,
          isError: true,
          error: {
            code: "ADDITIONAL_AI_INSIGHT_SUBMISSION_INVALID",
            issues: parsed.error.issues.map(({ path, message }) => ({ path, message })),
          },
        };
      }
      if (accepted) {
        return {
          ok: false,
          isError: true,
          error: { code: "ADDITIONAL_AI_INSIGHT_SUBMISSION_CONFLICT" },
        };
      }
      accepted = true;
      return {
        ok: true,
        resultType: "additional-ai-insight-submission" as const,
        payload: parsed.data,
      };
    },
  });
};
