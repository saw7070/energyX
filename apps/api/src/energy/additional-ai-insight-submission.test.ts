import { describe, expect, it } from "vitest";

import { collectAdditionalAiInsightSubmission } from "./additional-ai-insight-submission.js";

const productionFailureText = "[].\n\nLet me construct the JSON.<｜end▁of▁thinking｜>\n\n"
  + "<｜｜DSML｜｜tool_calls><｜｜DSML｜｜invoke name=\"energy_evidence_read\">...</｜｜DSML｜｜invoke>";

const start = (id: string) => ({
  type: "TOOL_CALL_START",
  toolCallId: id,
  toolCallName: "energyiq_additional_insights_submit",
});

const result = (id: string, value: unknown) => ({
  type: "TOOL_CALL_RESULT",
  toolCallId: id,
  toolCallName: "energyiq_additional_insights_submit",
  result: value,
});

describe("Additional AI Insight structured submission", () => {
  it("does not reinterpret production literal DSML or scratch text as a submission", () => {
    expect(collectAdditionalAiInsightSubmission([{
      type: "TEXT_MESSAGE_CONTENT",
      messageId: "assistant-1",
      delta: productionFailureText,
    }])).toBeNull();
  });

  it("returns exactly one successful native submission payload", () => {
    const payload = { candidates: [{ id: "candidate-1" }] };

    expect(collectAdditionalAiInsightSubmission([
      start("submit-1"),
      result("submit-1", {
        ok: true,
        resultType: "additional-ai-insight-submission",
        payload,
      }),
    ])).toEqual(payload);
  });

  it("allows a rejected correction attempt before one success but fails closed on duplicate successes", () => {
    const rejected = {
      ok: false,
      isError: true,
      error: { code: "ADDITIONAL_AI_INSIGHT_SUBMISSION_INVALID" },
    };
    const accepted = (id: string) => ({
      ok: true,
      resultType: "additional-ai-insight-submission",
      payload: { candidates: [{ id }] },
    });

    expect(collectAdditionalAiInsightSubmission([
      start("submit-1"), result("submit-1", rejected),
      start("submit-2"), result("submit-2", accepted("candidate-2")),
    ])).toEqual({ candidates: [{ id: "candidate-2" }] });

    expect(collectAdditionalAiInsightSubmission([
      start("submit-1"), result("submit-1", accepted("candidate-1")),
      start("submit-2"), result("submit-2", accepted("candidate-2")),
    ])).toBeNull();

    expect(collectAdditionalAiInsightSubmission([
      start("submit-1"), result("submit-1", accepted("candidate-1")),
      start("submit-2"), result("submit-2", rejected),
    ])).toBeNull();
  });

  it("fails closed when any Evidence tool is still active after the successful submission starts", () => {
    expect(collectAdditionalAiInsightSubmission([
      start("submit-1"),
      result("submit-1", {
        ok: true,
        resultType: "additional-ai-insight-submission",
        payload: { candidates: [{ id: "candidate-1", toolAuditIds: ["future-audit"] }] },
      }),
      {
        type: "TOOL_CALL_START",
        toolCallId: "evidence-after-submit",
        toolCallName: "energy_evidence_read",
      },
      {
        type: "TOOL_CALL_RESULT",
        toolCallId: "evidence-after-submit",
        toolCallName: "energy_evidence_read",
        result: { ok: true, auditId: "future-audit" },
      },
    ])).toBeNull();
  });
});
