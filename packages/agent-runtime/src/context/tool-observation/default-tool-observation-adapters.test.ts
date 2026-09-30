import { describe, expect, it } from "vitest";

import { createToolObservationBoundary } from "./tool-observation-boundary.js";

describe("default tool observation adapters", () => {
  it("projects a protocol requirements commit as a governed acknowledgement", () => {
    const runScope = {
      modelName: "test-model",
      resourceId: "user-1",
      runId: "run-1",
      sessionId: "session-1",
    };
    const boundary = createToolObservationBoundary({ identity: runScope });
    const contextPackage = boundary.packager.packageToolObservation({
      toolName: "analysis_requirements_commit",
      rawResult: {
        claims: [{
          requirement_id: "R1",
          claim: "There are 8 Active Aging Centers",
          evidence_refs: ["sql-result-1"],
        }],
      },
      runScope,
    });

    expect(contextPackage.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceType: "analysis-requirements-commit",
        visibility: "model",
        content: expect.objectContaining({
          committed: true,
          source: "analysis-protocol",
        }),
      }),
    ]));
    expect(JSON.stringify(contextPackage)).not.toContain("adapter_missing");
  });

  it("preserves a failed requirements commit instead of acknowledging it as committed", () => {
    const runScope = {
      modelName: "test-model",
      resourceId: "user-1",
      runId: "run-1",
      sessionId: "session-1",
    };
    const boundary = createToolObservationBoundary({ identity: runScope });
    const contextPackage = boundary.packager.packageToolObservation({
      toolName: "analysis_requirements_commit",
      rawResult: {
        ok: false,
        isError: true,
        error: {
          code: "ACTION_INPUT_INVALID",
          category: "validation",
          message: "The claim did not match the trusted contract.",
          executionStatus: "not_started",
          retryable: false,
        },
        recovery: {
          strategy: "refresh_and_replan",
          instruction: "Correct the claim before committing it.",
          avoid: ["Do not repeat the same invalid claim."],
        },
      },
      runScope,
    });

    expect(contextPackage.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceType: "analysis-requirements-commit",
        visibility: "model",
        content: expect.objectContaining({
          committed: false,
          error: expect.objectContaining({ code: "ACTION_INPUT_INVALID" }),
        }),
      }),
    ]));
    expect(JSON.stringify(contextPackage)).not.toContain('"committed":true');
  });

  it("preserves an accepted Overview Candidate envelope and tells the model to stop", () => {
    const runScope = {
      modelName: "test-model",
      resourceId: "user-1",
      runId: "run-1",
      sessionId: "session-1",
    };
    const boundary = createToolObservationBoundary({ identity: runScope });
    const payload = {
      candidates: [{
        id: "candidate-1",
        epistemicLevel: "verified",
        title: "A useful finding",
        takeaway: "The evidence changes the review order.",
        action: "Check the leading Centre first.",
        expectedIfAct: "The driver can be confirmed.",
        ifIgnored: "The issue may remain unexamined.",
        limitation: "Equipment state is not available.",
        evidenceRefs: ["benchmark:priority"],
        evidenceSqlIndexes: [],
      }],
    };
    const contextPackage = boundary.packager.packageToolObservation({
      toolName: "overview_ai_candidates_submit",
      rawResult: { ok: true, resultType: "overview-ai-candidate-submission", payload },
      runScope,
    });

    expect(contextPackage.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceType: "overview-ai-candidate-submission",
        visibility: "model",
        content: expect.objectContaining({
          submitted: true,
          ok: true,
          resultType: "overview-ai-candidate-submission",
          payload,
          instruction: expect.stringContaining("Stop now"),
        }),
      }),
    ]));
    expect(JSON.stringify(contextPackage)).not.toContain("adapter_missing");
  });

  it("keeps the run-local SQL evidence index visible after projection", () => {
    const runScope = {
      modelName: "test-model",
      resourceId: "user-1",
      runId: "run-1",
      sessionId: "session-1",
    };
    const boundary = createToolObservationBoundary({ identity: runScope });
    const contextPackage = boundary.packager.packageToolObservation({
      toolName: "run_sql_readonly",
      rawResult: {
        evidence_index: 7,
        columns: ["centre", "energy_kwh"],
        rows: [["Centre G", 815.9]],
        row_count: 1,
        audit_log_id: "audit-7",
      },
      runScope,
    });

    expect(contextPackage.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceType: "sql",
        visibility: "model",
        content: expect.objectContaining({ evidence_index: 7 }),
      }),
    ]));
  });

  it("bounds a missing SQL observation instead of crashing the context processor", () => {
    const runScope = {
      modelName: "test-model",
      resourceId: "user-1",
      runId: "run-1",
      sessionId: "session-1",
    };
    const boundary = createToolObservationBoundary({ identity: runScope });

    const contextPackage = boundary.packager.packageToolObservation({
      toolName: "run_sql_readonly",
      rawResult: undefined,
      runScope,
    });

    expect(contextPackage.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceType: "sql",
        visibility: "model",
        content: expect.objectContaining({
          tool_result_invalid: true,
          tool_name: "run_sql_readonly",
          preview: "undefined",
        }),
      }),
    ]));
  });
});
