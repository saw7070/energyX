import { asRecord, BaseToolObservationAdapter, pickFields } from "./base-tool-observation-adapter.js";

/**
 * analysis_requirements_commit is a protocol-runtime action, not an external
 * data source. Its result is already validated by the ActionRouter; this
 * adapter gives the model a small, explicit acknowledgement instead of the
 * generic CONTEXT_ADAPTER_REQUIRED fallback.
 */
export class AnalysisRequirementsCommitToolObservationAdapter extends BaseToolObservationAdapter {
  readonly toolName = "analysis_requirements_commit";
  readonly resultType = "analysis-requirements-commit";

  protected project(raw: unknown): unknown {
    const record = asRecord(raw);
    if (record.ok === false || record.isError === true) {
      return {
        committed: false,
        ...pickFields(record, ["ok", "isError", "error", "recovery"]),
        source: "analysis-protocol",
      };
    }
    return {
      committed: true,
      ...pickFields(record, ["claims"]),
      source: "analysis-protocol",
    };
  }
}

/**
 * The Overview Candidate submit tool is a run-local syntax boundary. Preserve
 * its accepted envelope for the owning workflow while giving the model an
 * unambiguous acknowledgement so it stops after one successful submission.
 */
export class OverviewAiCandidateSubmissionToolObservationAdapter extends BaseToolObservationAdapter {
  readonly toolName = "overview_ai_candidates_submit";
  readonly resultType = "overview-ai-candidate-submission";

  protected project(raw: unknown): unknown {
    const record = asRecord(raw);
    if (record.ok === false || record.isError === true) {
      return {
        submitted: false,
        ...pickFields(record, ["ok", "isError", "error"]),
        instruction: "Correct the complete Candidate envelope only when the error is actionable.",
      };
    }
    return {
      submitted: true,
      ...pickFields(record, ["ok", "resultType", "payload"]),
      instruction: "Submission accepted. Stop now; do not submit again and do not emit Candidate JSON as text.",
    };
  }
}
