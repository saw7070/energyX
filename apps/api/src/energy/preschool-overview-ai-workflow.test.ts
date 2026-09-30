import { LocalDataGateway } from "@datafoundry/data-gateway";
import { WORKSPACE_DEFAULT_MODEL_PROFILE_ID } from "@datafoundry/metadata";
import { createMetadataStore, type EnergyIqOverviewAiArtifactIdentity } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { ProjectAnalysisSnapshot } from "./project-analysis-resolver.js";
import {
  createPreschoolOverviewAiWorkflow,
  type PreschoolOverviewAiStageRunner,
} from "./preschool-overview-ai-workflow.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Preschool Overview AI server workflow", () => {
  it("single-flights two authorized callers and commits one canonical two-stage Artifact", async () => {
    const harness = createHarness();
    let releaseInvestigator!: () => void;
    const investigatorGate = new Promise<void>((resolve) => { releaseInvestigator = resolve; });
    const stages: string[] = [];
    const investigatorPrompts: string[] = [];
    const editorPrompts: string[] = [];
    const runStage: PreschoolOverviewAiStageRunner = async ({ stage, prompt, runId, sessionId }) => {
      stages.push(stage);
      if (stage === "investigator") investigatorPrompts.push(prompt);
      if (stage === "editor") editorPrompts.push(prompt);
      if (stage === "investigator") await investigatorGate;
      return stageEvents(stage, runId, sessionId);
    };
    const workflow = createPreschoolOverviewAiWorkflow({
      metadataStore: harness.metadata,
      dataGateway: harness.gateway,
      runStage,
      resolveSnapshot: async () => snapshot(),
    });

    const owner = workflow.execute({ identity: harness.identity, user: harness.user, retry: false });
    await until(() => harness.metadata.energyIq.overviewAiArtifacts.get(harness.identity).status === "running");
    const waiting = await workflow.execute({ identity: harness.identity, user: harness.secondUser, retry: false });
    expect(waiting).toMatchObject({ status: "running", attempt_count: 1 });
    expect(stages).toEqual(["investigator"]);

    releaseInvestigator();
    const available = await owner;
    expect(available).toMatchObject({ status: "available", attempt_count: 1 });
    expect(stages).toEqual(["investigator", "editor"]);
    expect(investigatorPrompts[0]).toContain("copy verbatim the evidence_index returned by each successful run_sql_readonly result");
    expect(investigatorPrompts[0]).toContain("Never infer, count, renumber, or guess an index");
    expect(investigatorPrompts[0]).toContain("if a successful result lacks evidence_index, do not cite it");
    expect(investigatorPrompts[0]).toContain("Before using SQL, choose one decision-changing question");
    expect(investigatorPrompts[0]).toContain("resubmit the complete candidates[] envelope");
    expect(investigatorPrompts[0]).not.toContain("at most two submission starts");
    expect(investigatorPrompts[0]).toContain("Do not emit Candidate JSON as Assistant text");
    expect(investigatorPrompts[0]).toContain("Do not rerun or reformulate an equivalent SQL query");
    expect(investigatorPrompts[0]).toContain("evidenceRefs may contain only exact item.id strings copied verbatim from Bounded Snapshot Evidence");
    expect(investigatorPrompts[0]).toContain("Never use claimRefs, Coverage claim paths, JSON property paths, labels, or queryIds as evidenceRefs");
    expect(investigatorPrompts[0]).toContain("When SQL alone supports a candidate, evidenceRefs may be empty");
    expect(investigatorPrompts[0]).toContain("A verified Candidate must cite at least one Catalog Evidence item or successful SQL evidence_index");
    expect(investigatorPrompts[0]).toContain("action/expectedIfAct/ifIgnored/limitation<=600");
    expect(investigatorPrompts[0]).toContain("The Editor will make accepted content concise and customer-facing");
    expect(investigatorPrompts[0]).toContain("Complete shape example");
    expect(investigatorPrompts[0]).toContain("A zero-row successful result may have an index; an isError result never does");
    expect(investigatorPrompts[0]).toContain("A verified Candidate that uses SQL facts but submits evidenceSqlIndexes:[] is invalid");
    expect(investigatorPrompts[0]).toContain("if Centre H and its per-person value came from a result labelled evidence_index 7");
    expect(investigatorPrompts[0]).toContain("ranking, percentage, ratio, share, difference, or delta");
    expect(investigatorPrompts[0]).toContain("must be explicitly returned by SQL; never calculate or estimate it yourself");
    expect(investigatorPrompts[0]).toContain("Prompt revision: preschool-investigator-v15");
    expect(investigatorPrompts[0]).toContain("never a quota");
    expect(investigatorPrompts[0]).toContain("Never add a decorative chart");
    expect(investigatorPrompts[0]).toContain("Do not put HTML, JS, React");
    expect(editorPrompts[0]).toContain("You cannot query Schema or SQL");
    expect(editorPrompts[0]).toContain("Similar absolute kWh does not invalidate EUI/per-pax");
    expect(editorPrompts[0]).toContain("verify metadata first");
    expect(editorPrompts[0]).toContain("if correct, investigate equipment that keeps drawing similar electricity regardless of site size");
    expect(editorPrompts[0]).toContain("instead of 'denominator effect'");
    expect(editorPrompts[0]).toContain("This is conditional, not mandatory");
    expect(editorPrompts[0]).toContain("final customer-facing Editor");
    expect(editorPrompts[0]).toContain("unsupportedFields");
    expect(editorPrompts[0]).toContain("remove every numeral, explicit count, quantity, ratio, date, and unsupported comparison");
    expect(editorPrompts[0]).toContain("rewrite 'highest of all 30 Centres' as 'stands out across the portfolio'");
    expect(editorPrompts[0]).toContain("rewrite each accepted Candidate into plain English");
    expect(editorPrompts[0]!.length).toBeLessThanOrEqual(12_000);
    expect(editorPrompts[0]!.indexOf("Investigator candidates")).toBeLessThan(
      editorPrompts[0]!.indexOf("Overview Coverage (compact):"),
    );
    expect(editorPrompts[0]).not.toContain("visibleClaims");
    const result = JSON.parse(available.result_json!) as Record<string, unknown>;
    expect(result).toMatchObject({
      status: "available",
      providerProfileId: harness.identity.modelProfileId,
      binding: {
        dataSnapshotId: harness.identity.dataSnapshotId,
        projectReleaseId: harness.identity.projectReleaseId,
        analysisPeriod: {
          from: harness.identity.analysisPeriodFrom,
          to: harness.identity.analysisPeriodTo,
        },
      },
      workflow: {
        revision: harness.identity.workflowRevision,
        stages: {
          investigator: { promptRevision: harness.identity.investigatorPromptRevision },
          editor: { promptRevision: harness.identity.editorPromptRevision },
        },
      },
      findings: [{ placementTargets: ["preschool.benchmark"], epistemicLevel: "hypothesis" }],
    });
    expect((result.workflow as { editorTrace: unknown[] }).editorTrace).toHaveLength(1);

    const restored = await workflow.execute({ identity: harness.identity, user: harness.secondUser, retry: true });
    expect(restored).toEqual(available);
    expect(stages).toHaveLength(2);
    harness.close();
  }, 15_000);

  it("keeps three maximum legal Candidates visible inside the bounded Editor context", async () => {
    const harness = createHarness();
    let editorPrompt = "";
    const candidates = [1, 2, 3].map((index) => ({
      id: `candidate-${index}`,
      epistemicLevel: "verified",
      title: String.fromCharCode(64 + index).repeat(240),
      takeaway: String.fromCharCode(67 + index).repeat(800),
      action: String.fromCharCode(70 + index).repeat(600),
      expectedIfAct: String.fromCharCode(73 + index).repeat(600),
      ifIgnored: String.fromCharCode(76 + index).repeat(600),
      limitation: String.fromCharCode(79 + index).repeat(600),
      significance: String.fromCharCode(82 + index).repeat(600),
      possibleExplanation: String.fromCharCode(85 + index).repeat(600),
      nextCheck: String.fromCharCode(88 + index).repeat(600),
      evidenceRefs: ["quality:window"],
      evidenceSqlIndexes: [],
      presentation: {
        version: "1",
        blocks: [{
          type: "callout",
          tone: "insight",
          text: `Candidate ${index} presentation summary`,
          evidenceRefs: ["quality:window"],
        }],
      },
    }));
    const workflow = createPreschoolOverviewAiWorkflow({
      metadataStore: harness.metadata,
      dataGateway: harness.gateway,
      resolveSnapshot: async () => snapshot(),
      runStage: async ({ stage, prompt, runId, sessionId }) => {
        if (stage === "editor") editorPrompt = prompt;
        return stage === "investigator"
          ? envelopeEvents({ candidates }, runId, sessionId)
          : stageEvents(stage, runId, sessionId);
      },
    });

    const artifact = await workflow.execute({ identity: harness.identity, user: harness.user, retry: false });
    harness.close();

    expect(artifact.status, artifact.error_code ?? undefined).toBe("available");
    expect(editorPrompt.length).toBeLessThanOrEqual(12_000);
    expect(editorPrompt).toContain('"id":"candidate-1"');
    expect(editorPrompt).toContain('"id":"candidate-2"');
    expect(editorPrompt).toContain('"id":"candidate-3"');
    for (const candidate of candidates) {
      expect(editorPrompt).toContain(`"title":"${candidate.title}"`);
      expect(editorPrompt).toContain(`"takeaway":"${candidate.takeaway}"`);
      expect(editorPrompt).toContain(`"action":"${candidate.action.slice(0, 219)}…"`);
      expect(editorPrompt).toContain(`"expectedIfAct":"${candidate.expectedIfAct.slice(0, 219)}…"`);
      expect(editorPrompt).toContain(`"ifIgnored":"${candidate.ifIgnored.slice(0, 219)}…"`);
      expect(editorPrompt).toContain(`"limitation":"${candidate.limitation.slice(0, 219)}…"`);
      expect(editorPrompt).toContain(`"significance":"${candidate.significance.slice(0, 219)}…"`);
      expect(editorPrompt).toContain(`"possibleExplanation":"${candidate.possibleExplanation.slice(0, 219)}…"`);
      expect(editorPrompt).toContain(`"nextCheck":"${candidate.nextCheck.slice(0, 219)}…"`);
      expect(editorPrompt).toContain(`"text":"Candidate ${candidate.id.at(-1)} presentation summary"`);
    }
    expect(JSON.parse(artifact.result_json!) as Record<string, unknown>).toMatchObject({
      findings: [{
        action: candidates[0]!.action,
        expectedIfAct: candidates[0]!.expectedIfAct,
        ifIgnored: candidates[0]!.ifIgnored,
        uncertainty: candidates[0]!.limitation,
        interpretation: candidates[0]!.significance,
        possibleExplanation: candidates[0]!.possibleExplanation,
        verification: candidates[0]!.nextCheck,
      }],
    });
  });

  it("fails closed beyond three Candidates, text bounds, or possibleExplanation without nextCheck", async () => {
    const baseCandidate = {
      epistemicLevel: "verified",
      title: "A bounded Candidate",
      takeaway: "The Candidate remains inside the pinned Snapshot.",
      evidenceRefs: ["quality:window"],
      evidenceSqlIndexes: [],
    };
    const attempts = [
      {
        candidates: [1, 2, 3, 4].map((index) => ({ ...baseCandidate, id: `candidate-${index}` })),
      },
      {
        candidates: [{ ...baseCandidate, id: "candidate-1", title: "T".repeat(241) }],
      },
      {
        candidates: [{ ...baseCandidate, id: "candidate-1", action: "A".repeat(601) }],
      },
      {
        candidates: [{
          ...baseCandidate,
          id: "candidate-1",
          possibleExplanation: "An operating difference may explain the observed pattern.",
        }],
      },
    ];

    for (const submission of attempts) {
      const harness = createHarness();
      const workflow = createPreschoolOverviewAiWorkflow({
        metadataStore: harness.metadata,
        dataGateway: harness.gateway,
        resolveSnapshot: async () => snapshot(),
        runStage: async ({ stage, runId, sessionId }) => stage === "investigator"
          ? envelopeEvents(submission, runId, sessionId)
          : stageEvents(stage, runId, sessionId),
      });

      const artifact = await workflow.execute({ identity: harness.identity, user: harness.user, retry: false });
      harness.close();
      expect(artifact).toMatchObject({ status: "failed", error_code: "OVERVIEW_AI_INVESTIGATOR_RESULT_INVALID" });
    }
  });

  it("fails before Editor when a verified Candidate has no Catalog or SQL Evidence binding", async () => {
    const harness = createHarness();
    const stages: string[] = [];
    const workflow = createPreschoolOverviewAiWorkflow({
      metadataStore: harness.metadata,
      dataGateway: harness.gateway,
      resolveSnapshot: async () => snapshot(),
      runStage: async ({ stage, runId, sessionId }) => {
        stages.push(stage);
        return stage === "investigator"
          ? envelopeEvents({
              candidates: [{
                id: "candidate-1",
                epistemicLevel: "verified",
                title: "An unbound verified claim",
                takeaway: "This claim has no cited Catalog or SQL Evidence.",
                evidenceRefs: [],
                evidenceSqlIndexes: [],
              }],
            }, runId, sessionId)
          : stageEvents(stage, runId, sessionId);
      },
    });

    const artifact = await workflow.execute({ identity: harness.identity, user: harness.user, retry: false });
    harness.close();

    expect(artifact).toMatchObject({ status: "failed", error_code: "OVERVIEW_AI_INVESTIGATOR_RESULT_INVALID" });
    expect(stages).toEqual(["investigator"]);
  });

  it("parses only the final Editor Assistant message as the Stage submission", async () => {
    const harness = createHarness();
    const workflow = createPreschoolOverviewAiWorkflow({
      metadataStore: harness.metadata,
      dataGateway: harness.gateway,
      resolveSnapshot: async () => snapshot(),
      runStage: async ({ stage, runId, sessionId }) => stage === "investigator"
        ? stageEvents(stage, runId, sessionId)
        : {
            events: [
              { type: "TEXT_MESSAGE_CONTENT", messageId: "editor-note", delta: "I checked the candidates before submitting." },
              {
                type: "TEXT_MESSAGE_CONTENT",
                messageId: "final-submission",
                delta: JSON.stringify({
                  findings: [{
                    sourceCandidateIds: ["candidate-1"],
                    placementTargets: ["preschool.benchmark"],
                    relationship: "independent",
                    signalRefs: ["efficiency"],
                  }],
                  trace: [{ decision: "accepted", sourceCandidateIds: ["candidate-1"] }],
                }),
              },
              { type: "RUN_FINISHED" },
            ],
            completedRun: { runId, sessionId },
          },
    });

    const artifact = await workflow.execute({ identity: harness.identity, user: harness.user, retry: false });
    harness.close();

    expect(artifact.status, artifact.error_code ?? undefined).toBe("available");
  });

  it("preserves whitespace when the Editor JSON arrives in streamed text chunks", async () => {
    const harness = createHarness();
    const editorEnvelope = JSON.stringify({
      findings: [{
        sourceCandidateIds: ["candidate-1"],
        placementTargets: ["preschool.benchmark"],
        relationship: "independent",
        signalRefs: ["efficiency"],
        copy: {
          title: "The dual-normalisation outlier deserves an operating review",
          takeaway: "The same Centre remains a priority after both normalisations, so size alone is not a sufficient explanation.",
          action: "Review the pinned Evidence before choosing an operational response.",
          expectedIfAct: "The next review will resolve the decision-relevant question.",
          ifIgnored: "The unresolved pattern may continue without an accountable review.",
          limitation: "The pinned Snapshot does not prove a cause or future outcome.",
        },
      }],
      trace: [{ decision: "accepted", sourceCandidateIds: ["candidate-1"] }],
    });
    const chunks = editorEnvelope.split(/(?= )/u);
    const workflow = createPreschoolOverviewAiWorkflow({
      metadataStore: harness.metadata,
      dataGateway: harness.gateway,
      resolveSnapshot: async () => snapshot(),
      runStage: async ({ stage, runId, sessionId }) => stage === "investigator"
        ? stageEvents(stage, runId, sessionId)
        : {
            events: [
              ...chunks.map((delta) => ({ type: "TEXT_MESSAGE_CHUNK", messageId: "editor-stream", delta })),
              { type: "RUN_FINISHED" },
            ],
            completedRun: { runId, sessionId },
          },
    });

    const artifact = await workflow.execute({ identity: harness.identity, user: harness.user, retry: false });
    const result = JSON.parse(artifact.result_json!) as { findings: Array<{ title: string; takeaway: string }> };
    harness.close();

    expect(artifact.status, artifact.error_code ?? undefined).toBe("available");
    expect(result.findings[0]?.title).toBe("The dual-normalisation outlier deserves an operating review");
    expect(result.findings[0]?.takeaway).toContain("same Centre remains a priority");
  });

  it("uses exactly one successful structured Investigator submission and ignores malformed Assistant JSON", async () => {
    const harness = createHarness();
    const structured = {
      candidates: [{
        id: "candidate-1",
        epistemicLevel: "hypothesis",
        title: "A quoted \"lower-intensity\" label remains valid text",
        takeaway: "The candidate arrived through the strict submission tool.",
        nextCheck: "Verify the source row before acting.",
        evidenceRefs: ["benchmark:portfolio-p75"],
        evidenceSqlIndexes: [],
      }],
    };
    let editorPrompt = "";
    const workflow = createPreschoolOverviewAiWorkflow({
      metadataStore: harness.metadata,
      dataGateway: harness.gateway,
      resolveSnapshot: async () => snapshot(),
      runStage: async ({ stage, prompt, runId, sessionId }) => {
        if (stage === "editor") editorPrompt = prompt;
        return stage === "investigator"
          ? {
              events: [
                {
                  type: "TOOL_CALL_START",
                  toolCallId: "submit-1",
                  toolCallName: "overview_ai_candidates_submit",
                },
                {
                  type: "TOOL_CALL_RESULT",
                  toolCallId: "submit-1",
                  content: JSON.stringify({
                    ok: true,
                    resultType: "overview-ai-candidate-submission",
                    payload: canonicalCandidateSubmission(structured),
                  }),
                },
                {
                  type: "TEXT_MESSAGE_CHUNK",
                  messageId: "malformed-free-text",
                  delta: '{"candidates":[{"title":"unescaped "lower-intensity" text"}]}',
                },
                { type: "RUN_FINISHED" },
              ],
              completedRun: { runId, sessionId },
            }
          : stageEvents(stage, runId, sessionId);
      },
    });

    const artifact = await workflow.execute({ identity: harness.identity, user: harness.user, retry: false });
    harness.close();

    expect(artifact.status, artifact.error_code ?? undefined).toBe("available");
    expect(editorPrompt).toContain("A quoted \\\"lower-intensity\\\" label remains valid text");
    expect(editorPrompt).not.toContain("unescaped");
  });

  it("fails closed when one Run reports a duplicate structured submission conflict", async () => {
    const harness = createHarness();
    const first = {
      candidates: [{
        id: "candidate-1",
        epistemicLevel: "hypothesis",
        title: "First submission",
        takeaway: "First payload.",
        nextCheck: "Verify first.",
        evidenceRefs: ["benchmark:portfolio-p75"],
        evidenceSqlIndexes: [],
      }],
    };
    const workflow = createPreschoolOverviewAiWorkflow({
      metadataStore: harness.metadata,
      dataGateway: harness.gateway,
      resolveSnapshot: async () => snapshot(),
      runStage: async ({ stage, runId, sessionId }) => stage === "investigator"
        ? {
            events: [
              ...successfulSubmissionEvents(first, "submit-1"),
              {
                type: "TOOL_CALL_START",
                toolCallId: "submit-2",
                toolCallName: "overview_ai_candidates_submit",
              },
              {
                type: "TOOL_CALL_RESULT",
                toolCallId: "submit-2",
                content: JSON.stringify({
                  ok: false,
                  isError: true,
                  error: { code: "OVERVIEW_AI_CANDIDATE_SUBMISSION_CONFLICT" },
                }),
              },
              { type: "RUN_FINISHED" },
            ],
            completedRun: { runId, sessionId },
          }
        : stageEvents(stage, runId, sessionId),
    });

    const artifact = await workflow.execute({ identity: harness.identity, user: harness.user, retry: false });
    harness.close();

    expect(artifact).toMatchObject({
      status: "failed",
      error_code: "OVERVIEW_AI_INVESTIGATOR_RESULT_INVALID",
    });
  });

  it("allows one failed submission correction and aligns Candidate indexes to successful SQL order", async () => {
    const harness = createHarness();
    const submission = {
      candidates: [{
        id: "candidate-1",
        epistemicLevel: "verified",
        title: "Centre A1 and Centre E remain visible in the scoped query",
        takeaway: "The two pre-submission SQL results support the selected review.",
        evidenceRefs: [],
        evidenceSqlIndexes: [1, 2],
      }],
    };
    const workflow = createPreschoolOverviewAiWorkflow({
      metadataStore: harness.metadata,
      dataGateway: harness.gateway,
      resolveSnapshot: async () => snapshot(),
      runStage: async ({ stage, runId, sessionId }) => stage === "investigator"
        ? {
            events: [
              ...schemaEvents(),
              ...sqlEvents("sql-1", 1, "A1", 100),
              ...failedSubmissionEvents("submit-1"),
              ...sqlEvents("sql-2", 2, "E", 300),
              ...successfulSubmissionEvents(submission, "submit-2"),
              ...sqlEvents("sql-after-submit", 3, "H", 900),
              { type: "RUN_FINISHED" },
            ],
            completedRun: { runId, sessionId },
          }
        : stageEvents(stage, runId, sessionId),
    });

    const artifact = await workflow.execute({ identity: harness.identity, user: harness.user, retry: false });
    const result = JSON.parse(artifact.result_json!) as { findings: Array<{ evidence: { tools: Array<Record<string, unknown>> } }> };
    harness.close();

    expect(artifact.status, artifact.error_code ?? undefined).toBe("available");
    expect(result.findings[0]!.evidence.tools).toMatchObject([
      { evidenceIndex: 1, toolCallId: "sql-1" },
      { evidenceIndex: 2, toolCallId: "sql-2" },
    ]);
    expect(result.findings[0]!.evidence.tools).not.toContainEqual(expect.objectContaining({ toolCallId: "sql-after-submit" }));
  });

  it("rebinds a Candidate to the supporting SQL from the same pre-submission Run", async () => {
    const harness = createHarness();
    const workflow = createPreschoolOverviewAiWorkflow({
      metadataStore: harness.metadata,
      dataGateway: harness.gateway,
      resolveSnapshot: async () => snapshot(),
      runStage: async ({ stage, runId, sessionId }) => stage === "investigator"
        ? {
            events: [
              ...schemaEvents(),
              ...sqlEvents("sql-1", 1, "A1", 100),
              ...sqlEvents("sql-2", 2, "E", 300),
              ...successfulSubmissionEvents({
                candidates: [{
                  id: "candidate-1",
                  epistemicLevel: "verified",
                  title: "Centre E recorded 300 kWh",
                  takeaway: "The scoped query places Centre E at 300 kWh.",
                  evidenceRefs: [],
                  // The model remembered the wrong Run-local index. Runtime must
                  // attach the source that actually proves the displayed claim.
                  evidenceSqlIndexes: [1],
                }],
              }, "submit-1"),
              { type: "RUN_FINISHED" },
            ],
            completedRun: { runId, sessionId },
          }
        : stageEvents(stage, runId, sessionId),
    });

    const artifact = await workflow.execute({ identity: harness.identity, user: harness.user, retry: false });
    const result = artifact.result_json
      ? JSON.parse(artifact.result_json) as { findings: Array<{ evidence: { tools: Array<Record<string, unknown>> } }> }
      : null;
    harness.close();

    expect(artifact.status, artifact.error_code ?? undefined).toBe("available");
    expect(result?.findings[0]!.evidence.tools).toMatchObject([
      { evidenceIndex: 2, toolCallId: "sql-2" },
    ]);
  });

  it("fails closed when persisted SQL evidence indexes differ from the Runtime indexes shown to the model", async () => {
    const harness = createHarness();
    const workflow = createPreschoolOverviewAiWorkflow({
      metadataStore: harness.metadata,
      dataGateway: harness.gateway,
      resolveSnapshot: async () => snapshot(),
      runStage: async ({ stage, runId, sessionId }) => stage === "investigator"
        ? {
            events: [
              ...schemaEvents(),
              ...sqlEvents("sql-1", 2, "A1", 100),
              ...successfulSubmissionEvents({ candidates: [] }, "submit-1"),
              { type: "RUN_FINISHED" },
            ],
            completedRun: { runId, sessionId },
          }
        : envelopeEvents({ findings: [], trace: [] }, runId, sessionId),
    });

    const artifact = await workflow.execute({ identity: harness.identity, user: harness.user, retry: false });
    harness.close();

    expect(artifact).toMatchObject({
      status: "failed",
      error_code: "OVERVIEW_AI_SQL_EVIDENCE_INDEX_MISMATCH:2:1",
    });
  });

  it("rejects a specific date or time that does not occur in the cited Evidence", async () => {
    const harness = createHarness();
    const workflow = createPreschoolOverviewAiWorkflow({
      metadataStore: harness.metadata,
      dataGateway: harness.gateway,
      resolveSnapshot: async () => snapshot(),
      runStage: async ({ stage, runId, sessionId }) => stage === "investigator"
        ? sqlEnvelopeEvents({
            candidates: [{
              id: "candidate-1",
              epistemicLevel: "verified",
              title: "Centre A1 peaked on 2026-05-29 at 03:00",
              takeaway: "Centre A1 recorded 100 kWh in the cited result.",
              evidenceRefs: [],
              evidenceSqlIndexes: [1],
            }],
          }, runId, sessionId)
        : stageEvents(stage, runId, sessionId),
    });

    const artifact = await workflow.execute({ identity: harness.identity, user: harness.user, retry: false });
    harness.close();

    expect(artifact).toMatchObject({
      status: "failed",
      error_code: "OVERVIEW_AI_RUNTIME_VALIDATION_REJECTED_ALL",
    });
  });

  it("rejects an Editor-selected Candidate when its only SQL index started after successful submission", async () => {
    const harness = createHarness();
    const workflow = createPreschoolOverviewAiWorkflow({
      metadataStore: harness.metadata,
      dataGateway: harness.gateway,
      resolveSnapshot: async () => snapshot(),
      runStage: async ({ stage, runId, sessionId }) => stage === "investigator"
        ? {
            events: [
              ...schemaEvents(),
              ...successfulSubmissionEvents({
                candidates: [{
                  id: "candidate-1",
                  epistemicLevel: "verified",
                  title: "Centre H recorded 900 kWh",
                  takeaway: "The Candidate cites only a post-submission SQL result.",
                  evidenceRefs: [],
                  evidenceSqlIndexes: [1],
                }],
              }, "submit-1"),
              ...sqlEvents("sql-after-submit", 1, "H", 900),
              { type: "RUN_FINISHED" },
            ],
            completedRun: { runId, sessionId },
          }
        : stageEvents(stage, runId, sessionId),
    });

    const artifact = await workflow.execute({ identity: harness.identity, user: harness.user, retry: false });
    harness.close();

    expect(artifact).toMatchObject({
      status: "failed",
      error_code: "OVERVIEW_AI_RUNTIME_VALIDATION_REJECTED_ALL",
    });
  });

  it("accepts the final valid Investigator submission after earlier schema-only corrections", async () => {
    const harness = createHarness();
    const stages: string[] = [];
    const workflow = createPreschoolOverviewAiWorkflow({
      metadataStore: harness.metadata,
      dataGateway: harness.gateway,
      resolveSnapshot: async () => snapshot(),
      runStage: async ({ stage, runId, sessionId }) => {
        stages.push(stage);
        return stage === "investigator" ? {
            events: [
              ...failedSubmissionEvents("submit-1"),
              ...failedSubmissionEvents("submit-2"),
              ...successfulSubmissionEvents({
                candidates: [{
                  id: "candidate-1",
                  epistemicLevel: "hypothesis",
                  title: "The dual-normalisation outlier deserves an operating review",
                  takeaway: "The same Centre remains a priority after both normalisations, so size alone is not a sufficient explanation.",
                  possibleExplanation: "The current Snapshot does not observe occupancy or equipment state.",
                  nextCheck: "Compare its operating schedule and equipment state with lower-intensity peers before assigning a cause.",
                  evidenceRefs: ["benchmark:portfolio-p75", "benchmark:priority-centre:A1"],
                  evidenceSqlIndexes: [],
                }],
              }, "submit-3"),
              { type: "RUN_FINISHED" },
            ],
            completedRun: { runId, sessionId },
          }
          : stageEvents(stage, runId, sessionId);
      },
    });

    const artifact = await workflow.execute({ identity: harness.identity, user: harness.user, retry: false });
    harness.close();

    expect(artifact).toMatchObject({ status: "available" });
    expect(stages).toEqual(["investigator", "editor"]);
    expect(JSON.parse(artifact.result_json!)).toMatchObject({
      findings: [{ title: "The dual-normalisation outlier deserves an operating review" }],
    });
  });

  it("drops an invalid optional Presentation from a structured Candidate submission", async () => {
    const harness = createHarness();
    let editorPrompt = "";
    const submission = {
      candidates: [{
        id: "candidate-1",
        epistemicLevel: "hypothesis",
        title: "The dual-normalisation outlier deserves an operating review",
        takeaway: "The same Centre remains a priority after both normalisations, so size alone is not a sufficient explanation.",
        evidenceRefs: ["benchmark:portfolio-p75", "benchmark:priority-centre:A1"],
        evidenceSqlIndexes: [],
        presentation: {
          version: "1",
          blocks: [{ type: "unsupported-block", text: "Optional visual explanation" }],
        },
      }],
    };
    const workflow = createPreschoolOverviewAiWorkflow({
      metadataStore: harness.metadata,
      dataGateway: harness.gateway,
      resolveSnapshot: async () => snapshot(),
      runStage: async ({ stage, prompt, runId, sessionId }) => {
        if (stage === "editor") editorPrompt = prompt;
        return stage === "investigator"
          ? envelopeEvents(submission, runId, sessionId)
          : stageEvents(stage, runId, sessionId);
      },
    });

    const artifact = await workflow.execute({ identity: harness.identity, user: harness.user, retry: false });
    const result = JSON.parse(artifact.result_json!) as { findings: Array<{ presentation?: unknown }> };
    harness.close();

    expect(artifact.status).toBe("available");
    expect(editorPrompt).toContain("The dual-normalisation outlier deserves an operating review");
    expect(result.findings.every((finding) => !Object.hasOwn(finding, "presentation"))).toBe(true);
  });

  it("keeps the latest valid Editor envelope when a later Runtime message has no submission", async () => {
    const harness = createHarness();
    const workflow = createPreschoolOverviewAiWorkflow({
      metadataStore: harness.metadata,
      dataGateway: harness.gateway,
      resolveSnapshot: async () => snapshot(),
      runStage: async ({ stage, runId, sessionId }) => stage === "investigator"
        ? stageEvents(stage, runId, sessionId)
        : {
            events: [
              {
                type: "TEXT_MESSAGE_CHUNK",
                messageId: "model-submission",
                delta: JSON.stringify({
                  findings: [{
                    sourceCandidateIds: ["candidate-1"],
                    placementTargets: ["preschool.benchmark"],
                    relationship: "independent",
                    signalRefs: ["efficiency"],
                  }],
                  trace: [{ decision: "accepted", sourceCandidateIds: ["candidate-1"] }],
                }),
              },
              {
                type: "TEXT_MESSAGE_CONTENT",
                messageId: "runtime-finalizer",
                delta: "The run completed and its trace was saved.",
              },
              { type: "RUN_FINISHED" },
            ],
            completedRun: { runId, sessionId },
          },
    });

    const artifact = await workflow.execute({ identity: harness.identity, user: harness.user, retry: false });
    harness.close();

    expect(artifact.status).toBe("available");
  });

  it("lets the Editor humanize display copy while inheriting the Investigator identity and Evidence", async () => {
    const harness = createHarness();
    const longHumanTakeaway = "Centre A1 stays high after both fair comparisons, so the result deserves a closer operational review before any conclusion is made. ".repeat(3).trim();
    const workflow = createPreschoolOverviewAiWorkflow({
      metadataStore: harness.metadata,
      dataGateway: harness.gateway,
      resolveSnapshot: async () => snapshot(),
      runStage: async ({ stage, runId, sessionId }) => stage === "investigator"
        ? envelopeEvents({
            candidates: [{
              id: "candidate-1",
              epistemicLevel: "hypothesis",
              title: "Centre A1 remains a priority after both normalisations",
              takeaway: "Centre A1 stays above the peer threshold after adjusting for floor area and headcount.",
              action: "Verify metadata, then review Centre A1 operating conditions.",
              expectedIfAct: "The review will isolate the decision-relevant operating condition.",
              ifIgnored: "The priority may persist without an accountable investigation.",
              limitation: "The Snapshot does not observe occupancy schedules or equipment state.",
              significance: "The result is unlikely to be explained by Centre size alone.",
              possibleExplanation: "Its operating pattern or equipment mix may differ from lower-intensity peers.",
              nextCheck: "Compare Centre A1 operating hours and equipment state with lower-intensity peers.",
              evidenceRefs: ["benchmark:portfolio-p75", "benchmark:priority-centre:A1"],
              evidenceSqlIndexes: [],
            }],
          }, runId, sessionId)
        : envelopeEvents({
            findings: [{
              sourceCandidateIds: ["candidate-1"],
              placementTargets: ["preschool.benchmark"],
              relationship: "independent",
              signalRefs: ["efficiency"],
              copy: {
                title: "Centre A1 needs a closer look",
                takeaway: longHumanTakeaway,
                action: "Check its source data, then review how the Centre is being operated.",
                expectedIfAct: "The review should reveal which operating condition needs attention.",
                ifIgnored: "The same issue may continue without a clear owner or follow-up.",
                limitation: "The current data cannot show what equipment was running or why.",
                significance: "Centre size alone does not explain the result.",
                possibleExplanation: "Its schedule or equipment mix may differ from similar Centres.",
                nextCheck: "Compare its opening hours and equipment state with lower-use peers.",
              },
              title: "Centre H is the hidden priority",
              takeaway: "Centre H should be investigated first.",
              epistemicLevel: "hypothesis",
              uncertainty: "The current Snapshot does not confirm the cause.",
              evidenceRefs: ["benchmark:portfolio-p75", "benchmark:priority-centre:A1"],
              evidenceSqlIndexes: [],
            }],
            trace: [{ decision: "accepted", sourceCandidateIds: ["candidate-1"] }],
          }, runId, sessionId),
    });

    const artifact = await workflow.execute({ identity: harness.identity, user: harness.user, retry: false });
    harness.close();

    expect(artifact.status).toBe("available");
    expect(JSON.parse(artifact.result_json!) as Record<string, unknown>).toMatchObject({
      findings: [{
        title: "Centre A1 needs a closer look",
        takeaway: longHumanTakeaway,
        interpretation: "Centre size alone does not explain the result.",
        action: "Check its source data, then review how the Centre is being operated.",
        expectedIfAct: "The review should reveal which operating condition needs attention.",
        ifIgnored: "The same issue may continue without a clear owner or follow-up.",
        uncertainty: "The current data cannot show what equipment was running or why.",
        possibleExplanation: "Its schedule or equipment mix may differ from similar Centres.",
        verification: "Compare its opening hours and equipment state with lower-use peers.",
      }],
    });
    const firstFinding = (JSON.parse(artifact.result_json!) as { findings: Array<Record<string, unknown>> }).findings[0]!;
    expect(firstFinding.interpretation).not.toContain("normalisations");
    expect(artifact.result_json).not.toContain("Centre H");
  });

  it("inherits deterministic Evidence and SQL indexes from the selected Investigator candidate", async () => {
    const harness = createHarness();
    const workflow = createPreschoolOverviewAiWorkflow({
      metadataStore: harness.metadata,
      dataGateway: harness.gateway,
      resolveSnapshot: async () => snapshot(),
      runStage: async ({ stage, runId, sessionId }) => stage === "investigator"
        ? sqlEnvelopeEvents({
            candidates: [{
              id: "candidate-1",
              epistemicLevel: "verified",
              title: "Centre E recorded 300 kWh",
              takeaway: "The scoped query places Centre E at 300 kWh.",
              evidenceRefs: ["benchmark:portfolio-p75"],
              evidenceSqlIndexes: [1],
              presentation: {
                version: "1",
                blocks: [{
                  type: "metric",
                  label: "Centre E energy",
                  value: 300,
                  unit: "kWh",
                  evidenceSqlIndexes: [1],
                }],
              },
            }],
          }, runId, sessionId)
        : envelopeEvents({
            findings: [{
              sourceCandidateIds: ["candidate-1"],
              placementTargets: ["preschool.benchmark"],
              relationship: "independent",
              signalRefs: ["efficiency"],
              evidenceRefs: ["quality:window"],
              evidenceSqlIndexes: [],
              presentation: {
                version: "1",
                blocks: [{ type: "metric", label: "Wrong Editor value", value: 999, unit: "kWh", evidenceRefs: ["quality:window"] }],
              },
            }],
            trace: [{ decision: "accepted", sourceCandidateIds: ["candidate-1"] }],
          }, runId, sessionId),
    });

    const artifact = await workflow.execute({ identity: harness.identity, user: harness.user, retry: false });
    harness.close();

    expect(artifact.status).toBe("available");
    expect(JSON.parse(artifact.result_json!) as Record<string, unknown>).toMatchObject({
      findings: [{
        title: "Centre E recorded 300 kWh",
        evidence: {
          deterministic: [{ id: "benchmark:portfolio-p75" }],
          tools: [{ evidenceIndex: 1, auditLogId: "audit-1", rowCount: 2 }],
        },
        presentation: {
          version: "1",
          blocks: [{ label: "Centre E energy", value: 300, evidenceSqlIndexes: [1] }],
        },
      }],
    });
  });

  it("inherits Candidate Evidence binding for an otherwise valid optional Presentation", async () => {
    const harness = createHarness();
    const workflow = createPreschoolOverviewAiWorkflow({
      metadataStore: harness.metadata,
      dataGateway: harness.gateway,
      resolveSnapshot: async () => snapshot(),
      runStage: async ({ stage, runId, sessionId }) => stage === "investigator"
        ? sqlEnvelopeEvents({
            candidates: [{
              id: "candidate-1",
              epistemicLevel: "verified",
              title: "Centre E recorded 300 kWh",
              takeaway: "The scoped query places Centre E at 300 kWh.",
              evidenceRefs: ["benchmark:portfolio-p75"],
              evidenceSqlIndexes: [1],
              presentation: {
                version: "1",
                blocks: [{
                  type: "comparison",
                  title: "Centre energy comparison",
                  unit: "kWh",
                  items: [
                    { label: "Centre E", value: 300 },
                    { label: "Centre A1", value: 100 },
                  ],
                }],
              },
            }],
          }, runId, sessionId)
        : envelopeEvents({
            findings: [{
              sourceCandidateIds: ["candidate-1"],
              placementTargets: ["preschool.benchmark"],
              relationship: "independent",
              signalRefs: ["efficiency"],
            }],
            trace: [{ decision: "accepted", sourceCandidateIds: ["candidate-1"] }],
          }, runId, sessionId),
    });

    const artifact = await workflow.execute({ identity: harness.identity, user: harness.user, retry: false });
    harness.close();

    expect(artifact.status).toBe("available");
    expect(JSON.parse(artifact.result_json!) as Record<string, unknown>).toMatchObject({
      findings: [{
        presentation: {
          version: "1",
          blocks: [{
            type: "comparison",
            title: "Centre energy comparison",
            evidenceSqlIndexes: [1],
          }],
        },
      }],
    });
  });

  it("keeps an all-rejected Editor result available and empty", async () => {
    const harness = createHarness();
    const workflow = createPreschoolOverviewAiWorkflow({
      metadataStore: harness.metadata,
      dataGateway: harness.gateway,
      resolveSnapshot: async () => snapshot(),
      runStage: async ({ stage, runId, sessionId }) => stage === "investigator"
        ? stageEvents(stage, runId, sessionId)
        : envelopeEvents({
            findings: [],
            trace: [{ decision: "rejected", sourceCandidateIds: ["candidate-1"], reason: "No incremental manager value." }],
          }, runId, sessionId),
    });

    const artifact = await workflow.execute({ identity: harness.identity, user: harness.user, retry: false });
    harness.close();

    expect(artifact.status).toBe("available");
    expect(JSON.parse(artifact.result_json!) as Record<string, unknown>).toMatchObject({
      findings: [],
      workflow: { editorTrace: [{ decision: "rejected", sourceCandidateIds: ["candidate-1"] }] },
    });
  });

  it("calibrates a partially rejected Editor selection to Runtime validation instead of accepted-without-findingId", async () => {
    const harness = createHarness();
    const workflow = createPreschoolOverviewAiWorkflow({
      metadataStore: harness.metadata,
      dataGateway: harness.gateway,
      resolveSnapshot: async () => snapshot(),
      runStage: async ({ stage, runId, sessionId }) => stage === "investigator"
        ? envelopeEvents({
            candidates: [
              {
                id: "candidate-valid",
                epistemicLevel: "verified",
                title: "The current Snapshot exposes a bounded quality window",
                takeaway: "This Candidate cites a real deterministic Evidence item.",
                evidenceRefs: ["quality:window"],
                evidenceSqlIndexes: [],
              },
              {
                id: "candidate-invalid",
                epistemicLevel: "verified",
                title: "A missing Evidence item should not survive Runtime validation",
                takeaway: "This Candidate cites an identifier outside the bounded Snapshot.",
                evidenceRefs: ["missing:evidence"],
                evidenceSqlIndexes: [],
              },
            ],
          }, runId, sessionId)
        : envelopeEvents({
            findings: ["candidate-valid", "candidate-invalid"].map((id) => ({
              sourceCandidateIds: [id],
              placementTargets: ["preschool.benchmark"],
              relationship: "independent",
              signalRefs: [],
            })),
            trace: ["candidate-valid", "candidate-invalid"].map((id) => ({
              decision: "accepted",
              sourceCandidateIds: [id],
            })),
          }, runId, sessionId),
    });

    const artifact = await workflow.execute({ identity: harness.identity, user: harness.user, retry: false });
    const result = JSON.parse(artifact.result_json!) as {
      findings: Array<{ id: string }>;
      workflow: { editorTrace: Array<Record<string, unknown>> };
    };
    harness.close();

    expect(artifact.status, artifact.error_code ?? undefined).toBe("available");
    expect(result.findings).toHaveLength(1);
    expect(result.workflow.editorTrace).toContainEqual(expect.objectContaining({
      decision: "rejected",
      sourceCandidateIds: ["candidate-invalid"],
      reason: expect.stringContaining("Runtime validation"),
    }));
    expect(result.workflow.editorTrace).not.toContainEqual({
      decision: "accepted",
      sourceCandidateIds: ["candidate-invalid"],
    });
  });

  it("fails closed when Editor selects an unknown candidate, attempts a merge, or contradicts its selection", async () => {
    for (const attempt of [
      {
        candidates: null,
        editorEnvelope: {
          findings: [{
            sourceCandidateIds: ["candidate-404"],
            placementTargets: ["preschool.benchmark"],
            relationship: "independent",
            signalRefs: [],
          }],
          trace: [],
        },
      },
      {
        candidates: [{
          id: "candidate-2",
          epistemicLevel: "verified",
          title: "A second supported candidate",
          takeaway: "The current Snapshot contains a second distinct candidate.",
          evidenceRefs: ["quality:window"],
          evidenceSqlIndexes: [],
        }],
        editorEnvelope: {
          findings: [{
            sourceCandidateIds: ["candidate-1", "candidate-2"],
            placementTargets: ["cross-section"],
            relationship: "supports",
            signalRefs: [],
          }],
          trace: [{ decision: "merged", sourceCandidateIds: ["candidate-1", "candidate-2"] }],
        },
      },
      {
        candidates: null,
        editorEnvelope: {
          findings: [{
            sourceCandidateIds: ["candidate-1"],
            placementTargets: ["preschool.benchmark"],
            relationship: "independent",
            signalRefs: [],
          }],
          trace: [{ decision: "rejected", sourceCandidateIds: ["candidate-1"] }],
        },
      },
    ]) {
      const harness = createHarness();
      const workflow = createPreschoolOverviewAiWorkflow({
        metadataStore: harness.metadata,
        dataGateway: harness.gateway,
        resolveSnapshot: async () => snapshot(),
        runStage: async ({ stage, runId, sessionId }) => stage === "investigator"
          ? attempt.candidates
            ? envelopeEvents({
                candidates: [
                  {
                    id: "candidate-1",
                    epistemicLevel: "verified",
                    title: "A supported candidate",
                    takeaway: "The current Snapshot contains a distinct candidate.",
                    evidenceRefs: ["quality:window"],
                    evidenceSqlIndexes: [],
                  },
                  ...attempt.candidates,
                ],
              }, runId, sessionId)
            : stageEvents(stage, runId, sessionId)
          : envelopeEvents(attempt.editorEnvelope, runId, sessionId),
      });

      const artifact = await workflow.execute({ identity: harness.identity, user: harness.user, retry: false });
      harness.close();
      expect(artifact).toMatchObject({ status: "failed", error_code: "OVERVIEW_AI_EDITOR_RESULT_INVALID" });
    }
  });

  it("normalizes known short Section targets and blank relationship metadata", async () => {
    const harness = createHarness();
    const workflow = createPreschoolOverviewAiWorkflow({
      metadataStore: harness.metadata,
      dataGateway: harness.gateway,
      resolveSnapshot: async () => snapshot(),
      runStage: async ({ stage, runId, sessionId }) => stage === "investigator"
        ? envelopeEvents({
            candidates: [{
              id: "candidate-1",
              epistemicLevel: "verified",
              title: "A bounded operational exception",
              takeaway: "The accepted Snapshot contains a decision-relevant exception.",
              evidenceRefs: ["quality:window"],
              evidenceSqlIndexes: [],
            }],
          }, runId, sessionId)
        : envelopeEvents({
            findings: [{
              sourceCandidateIds: ["candidate-1"],
              placementTargets: ["standby"],
              relationship: "",
              signalRefs: [],
            }],
            trace: [{
              decision: "Select this useful non-repeating finding.",
              sourceCandidateIds: ["candidate-1"],
            }],
          }, runId, sessionId),
    });

    const artifact = await workflow.execute({ identity: harness.identity, user: harness.user, retry: false });
    const result = JSON.parse(artifact.result_json!) as {
      findings: Array<{ relationship: string; placementTargets: string[] }>;
      workflow: { editorTrace: Array<Record<string, unknown>> };
    };
    harness.close();

    expect(artifact.status, artifact.error_code ?? undefined).toBe("available");
    expect(result.findings).toEqual([expect.objectContaining({
      relationship: "independent",
      placementTargets: ["preschool.standby"],
    })]);
    expect(result.workflow.editorTrace).toContainEqual(expect.objectContaining({
      decision: "accepted",
      sourceCandidateIds: ["candidate-1"],
    }));
  });

  it("requires an explicit retry, caps the identity at two attempts, and never reruns available", async () => {
    const harness = createHarness();
    let shouldFail = true;
    let calls = 0;
    const workflow = createPreschoolOverviewAiWorkflow({
      metadataStore: harness.metadata,
      dataGateway: harness.gateway,
      resolveSnapshot: async () => snapshot(),
      runStage: async ({ stage, runId, sessionId }) => {
        calls += 1;
        if (shouldFail) return {
          events: [{ type: "RUN_ERROR", message: "temporary provider failure" }],
          completedRun: { runId, sessionId },
        };
        return stageEvents(stage, runId, sessionId);
      },
    });

    const failed = await workflow.execute({ identity: harness.identity, user: harness.user, retry: false });
    expect(failed).toMatchObject({ status: "failed", attempt_count: 1 });
    expect(calls).toBe(1);
    expect(await workflow.execute({ identity: harness.identity, user: harness.secondUser, retry: false }))
      .toEqual(failed);
    expect(calls).toBe(1);

    shouldFail = false;
    const retried = await workflow.execute({ identity: harness.identity, user: harness.secondUser, retry: true });
    expect(retried).toMatchObject({ status: "available", attempt_count: 2 });
    expect(calls).toBe(3);
    expect(await workflow.execute({ identity: harness.identity, user: harness.user, retry: true }))
      .toEqual(retried);
    expect(calls).toBe(3);
    harness.close();
  });

  it("fails closed for a stale Snapshot and accepts an empty Editor result without filler", async () => {
    const staleHarness = createHarness();
    let calls = 0;
    const staleWorkflow = createPreschoolOverviewAiWorkflow({
      metadataStore: staleHarness.metadata,
      dataGateway: staleHarness.gateway,
      resolveSnapshot: async () => snapshot({ dataSnapshotId: "snapshot-old" }),
      runStage: async ({ stage, runId, sessionId }) => { calls += 1; return stageEvents(stage, runId, sessionId); },
    });
    const stale = await staleWorkflow.execute({ identity: staleHarness.identity, user: staleHarness.user, retry: false });
    expect(stale).toMatchObject({ status: "failed", error_code: "OVERVIEW_AI_SNAPSHOT_IDENTITY_MISMATCH" });
    expect(calls).toBe(0);
    staleHarness.close();

    const emptyHarness = createHarness();
    const emptyWorkflow = createPreschoolOverviewAiWorkflow({
      metadataStore: emptyHarness.metadata,
      dataGateway: emptyHarness.gateway,
      resolveSnapshot: async () => snapshot(),
      runStage: async ({ stage, runId, sessionId }) => stage === "investigator"
        ? envelopeEvents({ candidates: [] }, runId, sessionId)
        : envelopeEvents({ findings: [], trace: [] }, runId, sessionId),
    });
    const empty = await emptyWorkflow.execute({ identity: emptyHarness.identity, user: emptyHarness.user, retry: false });
    expect(empty.status).toBe("available");
    expect(JSON.parse(empty.result_json!) as Record<string, unknown>).toMatchObject({ findings: [] });
    emptyHarness.close();
  });

  it("fails when Runtime rejects every selected finding and rejects unverified Runtime provenance", async () => {
    const validatorHarness = createHarness();
    const validatorWorkflow = createPreschoolOverviewAiWorkflow({
      metadataStore: validatorHarness.metadata,
      dataGateway: validatorHarness.gateway,
      resolveSnapshot: async () => snapshot(),
      runStage: async ({ stage, runId, sessionId }) => stage === "investigator"
        ? envelopeEvents({
            candidates: [{
              id: "candidate-1",
              epistemicLevel: "hypothesis",
              title: "Unsupported savings claim",
              takeaway: "The intervention will save 37%.",
              nextCheck: "Measure the result on a later Snapshot.",
              evidenceRefs: ["benchmark:portfolio-p75"],
              evidenceSqlIndexes: [],
            }],
          }, runId, sessionId)
        : envelopeEvents({
            findings: [{
              sourceCandidateIds: ["candidate-1"],
              placementTargets: ["preschool.benchmark"],
              relationship: "independent",
              signalRefs: ["efficiency"],
            }],
            trace: [{ decision: "accepted", sourceCandidateIds: ["candidate-1"] }],
          }, runId, sessionId),
    });
    const validated = await validatorWorkflow.execute({ identity: validatorHarness.identity, user: validatorHarness.user, retry: false });
    validatorHarness.close();
    expect(validated).toMatchObject({
      status: "failed",
      error_code: "OVERVIEW_AI_RUNTIME_VALIDATION_REJECTED_ALL",
    });

    const provenanceHarness = createHarness();
    const provenanceWorkflow = createPreschoolOverviewAiWorkflow({
      metadataStore: provenanceHarness.metadata,
      dataGateway: provenanceHarness.gateway,
      resolveSnapshot: async () => snapshot(),
      runStage: async ({ stage, runId, sessionId }) => ({
        ...stageEvents(stage, runId, sessionId),
        completedRun: { runId: "different-runtime-run", sessionId },
      }),
    });
    const rejected = await provenanceWorkflow.execute({ identity: provenanceHarness.identity, user: provenanceHarness.user, retry: false });
    expect(rejected).toMatchObject({ status: "failed", error_code: "OVERVIEW_AI_RUNTIME_RUN_IDENTITY_MISMATCH" });
    provenanceHarness.close();
  });

  it("does not let a Centre count authorize an energy claim with the same number", async () => {
    const harness = createHarness();
    const workflow = createPreschoolOverviewAiWorkflow({
      metadataStore: harness.metadata,
      dataGateway: harness.gateway,
      resolveSnapshot: async () => snapshot(),
      runStage: async ({ stage, runId, sessionId }) => stage === "investigator"
        ? envelopeEvents({
            candidates: [{
              id: "candidate-1",
              epistemicLevel: "verified",
              title: "Aircon uses 30 kWh",
              takeaway: "The current Snapshot shows 30 kWh for the Aircon contribution.",
              evidenceRefs: ["circuit:appliance:Aircon 1"],
              evidenceSqlIndexes: [],
            }],
          }, runId, sessionId)
        : envelopeEvents({
            findings: [{
              sourceCandidateIds: ["candidate-1"],
              placementTargets: ["preschool.forecast"],
              relationship: "independent",
              signalRefs: [],
            }],
            trace: [{ decision: "accepted", sourceCandidateIds: ["candidate-1"] }],
          }, runId, sessionId),
    });

    const artifact = await workflow.execute({ identity: harness.identity, user: harness.user, retry: false });
    harness.close();

    expect(artifact).toMatchObject({
      status: "failed",
      error_code: "OVERVIEW_AI_RUNTIME_VALIDATION_REJECTED_ALL",
    });
  });

  it("binds a deterministic metric value to the same cited Centre", async () => {
    const harness = createHarness();
    const currentSnapshot = snapshot();
    const benchmark = currentSnapshot.preschoolBenchmark;
    if (!benchmark || benchmark.status !== "provisional") throw new Error("Expected benchmark fixture");
    benchmark.priorityCentreCodes = ["A1", "E"];
    benchmark.centres = [
      {
        scopeId: "centre-a1",
        centreCode: "A1",
        name: "Centre A1",
        cohort: "Childcare",
        usageKwh: 100,
        annualisedEuiKwhPerSqmYear: 120,
        mayKwhPerPerson: 30,
        quadrant: "priority",
        priority: true,
      },
      {
        scopeId: "centre-e",
        centreCode: "E",
        name: "Centre E",
        cohort: "Childcare",
        usageKwh: 300,
        annualisedEuiKwhPerSqmYear: 140,
        mayKwhPerPerson: 35,
        quadrant: "priority",
        priority: true,
      },
    ];
    const workflow = createPreschoolOverviewAiWorkflow({
      metadataStore: harness.metadata,
      dataGateway: harness.gateway,
      resolveSnapshot: async () => currentSnapshot,
      runStage: async ({ stage, runId, sessionId }) => stage === "investigator"
        ? envelopeEvents({
            candidates: [{
              id: "candidate-1",
              epistemicLevel: "verified",
              title: "Centre A1 used 300 kWh",
              takeaway: "Centre A1 recorded 300 kWh in the current period.",
              evidenceRefs: ["benchmark:priority-centre:A1", "benchmark:priority-centre:E"],
              evidenceSqlIndexes: [],
            }],
          }, runId, sessionId)
        : envelopeEvents({
            findings: [{
              sourceCandidateIds: ["candidate-1"],
              placementTargets: ["preschool.benchmark"],
              relationship: "independent",
              signalRefs: [],
            }],
            trace: [{ decision: "accepted", sourceCandidateIds: ["candidate-1"] }],
          }, runId, sessionId),
    });

    const artifact = await workflow.execute({ identity: harness.identity, user: harness.user, retry: false });
    harness.close();

    expect(artifact).toMatchObject({
      status: "failed",
      error_code: "OVERVIEW_AI_RUNTIME_VALIDATION_REJECTED_ALL",
    });
  });

  it("uses the complete Snapshot Centre vocabulary for lowercase multi-character references", async () => {
    const harness = createHarness();
    const currentSnapshot = snapshot();
    const benchmark = currentSnapshot.preschoolBenchmark;
    if (!benchmark || benchmark.status !== "provisional") throw new Error("Expected benchmark fixture");
    benchmark.priorityCentreCodes = ["G", "AA"];
    benchmark.centres = [
      {
        scopeId: "centre-g",
        centreCode: "G",
        name: "Centre G",
        cohort: "Childcare",
        usageKwh: 100,
        annualisedEuiKwhPerSqmYear: 120,
        mayKwhPerPerson: 30,
        quadrant: "priority",
        priority: true,
      },
      {
        scopeId: "centre-aa",
        centreCode: "AA",
        name: "Centre AA",
        cohort: "Childcare",
        usageKwh: 300,
        annualisedEuiKwhPerSqmYear: 140,
        mayKwhPerPerson: 35,
        quadrant: "priority",
        priority: true,
      },
    ];
    const workflow = createPreschoolOverviewAiWorkflow({
      metadataStore: harness.metadata,
      dataGateway: harness.gateway,
      resolveSnapshot: async () => currentSnapshot,
      runStage: async ({ stage, runId, sessionId }) => stage === "investigator"
        ? envelopeEvents({
            candidates: [{
              id: "candidate-1",
              epistemicLevel: "verified",
              title: "centre aa warrants a timing check",
              takeaway: "centre aa warrants a separate timing check despite citing only Centre G Evidence.",
              evidenceRefs: ["benchmark:priority-centre:G"],
              evidenceSqlIndexes: [],
            }],
          }, runId, sessionId)
        : envelopeEvents({
            findings: [{
              sourceCandidateIds: ["candidate-1"],
              placementTargets: ["preschool.benchmark"],
              relationship: "independent",
              signalRefs: [],
            }],
            trace: [{ decision: "accepted", sourceCandidateIds: ["candidate-1"] }],
          }, runId, sessionId),
    });

    const artifact = await workflow.execute({ identity: harness.identity, user: harness.user, retry: false });
    harness.close();

    expect(artifact).toMatchObject({
      status: "failed",
      error_code: "OVERVIEW_AI_RUNTIME_VALIDATION_REJECTED_ALL",
    });
  });

  it("accepts manager-facing percentage rounding from the same typed metric", async () => {
    const harness = createHarness();
    const currentSnapshot = snapshot();
    const operational = currentSnapshot.preschoolOperational;
    if (!operational || operational.status !== "available") throw new Error("Expected operational fixture");
    operational.energy.standbySharePct = 51.96;
    const workflow = createPreschoolOverviewAiWorkflow({
      metadataStore: harness.metadata,
      dataGateway: harness.gateway,
      resolveSnapshot: async () => currentSnapshot,
      runStage: async ({ stage, runId, sessionId }) => stage === "investigator"
        ? envelopeEvents({
            candidates: [{
              id: "candidate-1",
              epistemicLevel: "verified",
              title: "Standby accounts for 52% of energy",
              takeaway: "The current standby share rounds to 52%.",
              evidenceRefs: ["operating:portfolio"],
              evidenceSqlIndexes: [],
            }],
          }, runId, sessionId)
        : envelopeEvents({
            findings: [{
              sourceCandidateIds: ["candidate-1"],
              placementTargets: ["preschool.standby"],
              relationship: "independent",
              signalRefs: [],
            }],
            trace: [{ decision: "accepted", sourceCandidateIds: ["candidate-1"] }],
          }, runId, sessionId),
    });

    const artifact = await workflow.execute({ identity: harness.identity, user: harness.user, retry: false });
    harness.close();

    expect(JSON.parse(artifact.result_json!) as Record<string, unknown>).toMatchObject({
      findings: [{ title: "Standby accounts for 52% of energy" }],
    });
  });

  it("binds SQL metric values and Centre identity to the same returned row", async () => {
    const harness = createHarness();
    const workflow = createPreschoolOverviewAiWorkflow({
      metadataStore: harness.metadata,
      dataGateway: harness.gateway,
      resolveSnapshot: async () => snapshot(),
      runStage: async ({ stage, runId, sessionId }) => stage === "investigator"
        ? sqlEnvelopeEvents({
            candidates: [
              {
                id: "candidate-1",
                epistemicLevel: "verified",
                title: "Centre A1 used 300 kWh",
                takeaway: "Centre A1 recorded 300 kWh in the scoped query.",
                evidenceRefs: [],
                evidenceSqlIndexes: [1],
              },
              {
                id: "candidate-2",
                epistemicLevel: "verified",
                title: "Centre E used 300 kWh",
                takeaway: "Centre E recorded 300 kWh in the scoped query.",
                evidenceRefs: [],
                evidenceSqlIndexes: [1],
              },
            ],
          }, runId, sessionId)
        : envelopeEvents({
            findings: [
              {
                sourceCandidateIds: ["candidate-1"],
                placementTargets: ["preschool.benchmark"],
                relationship: "independent",
                signalRefs: [],
              },
              {
                sourceCandidateIds: ["candidate-2"],
                placementTargets: ["preschool.benchmark"],
                relationship: "independent",
                signalRefs: [],
              },
            ],
            trace: [
              { decision: "accepted", sourceCandidateIds: ["candidate-1"] },
              { decision: "accepted", sourceCandidateIds: ["candidate-2"] },
            ],
          }, runId, sessionId),
    });

    const artifact = await workflow.execute({ identity: harness.identity, user: harness.user, retry: false });
    harness.close();

    expect(JSON.parse(artifact.result_json!) as Record<string, unknown>).toMatchObject({
      findings: [{ title: "Centre E used 300 kWh" }],
    });
  });

  it("fails before Provider when model binding or Method Skill revision drifts", async () => {
    const modelHarness = createHarness();
    modelHarness.metadata.workspaceDefaultModelProfiles.set({
      workspace_id: "default",
      profile_id: "profile-current",
      profile_owner_user_id: modelHarness.user.id,
      configured_by_user_id: modelHarness.user.id,
      expected_revision: modelHarness.identity.modelProfileRevision,
    });
    let modelCalls = 0;
    const modelWorkflow = createPreschoolOverviewAiWorkflow({
      metadataStore: modelHarness.metadata,
      dataGateway: modelHarness.gateway,
      resolveSnapshot: async () => snapshot(),
      runStage: async ({ stage, runId, sessionId }) => { modelCalls += 1; return stageEvents(stage, runId, sessionId); },
    });
    const modelResult = await modelWorkflow.execute({ identity: modelHarness.identity, user: modelHarness.user, retry: false });
    modelHarness.close();
    expect(modelResult).toMatchObject({ status: "failed", error_code: "OVERVIEW_AI_MODEL_PROFILE_REVISION_MISMATCH" });
    expect(modelCalls).toBe(0);

    const skillHarness = createHarness();
    const skill = skillHarness.metadata.configResources.get({
      workspace_id: skillHarness.identity.workspaceId,
      user_id: skillHarness.user.id,
      kind: "skill",
      id: skillHarness.identity.methodSkillId,
    });
    skillHarness.metadata.configResources.upsert({
      workspace_id: skill.workspace_id,
      user_id: skill.user_id,
      kind: "skill",
      id: skill.id,
      name: skill.name,
      payload: { ...skill.payload, version: "2.0.0" },
      builtin: skill.builtin,
      default_enabled: skill.default_enabled,
      status: skill.status,
      expected_revision: skill.revision,
    });
    let skillCalls = 0;
    const skillWorkflow = createPreschoolOverviewAiWorkflow({
      metadataStore: skillHarness.metadata,
      dataGateway: skillHarness.gateway,
      resolveSnapshot: async () => snapshot(),
      runStage: async ({ stage, runId, sessionId }) => { skillCalls += 1; return stageEvents(stage, runId, sessionId); },
    });
    const skillResult = await skillWorkflow.execute({ identity: skillHarness.identity, user: skillHarness.user, retry: false });
    skillHarness.close();
    expect(skillResult).toMatchObject({ status: "failed", error_code: "OVERVIEW_AI_METHOD_SKILL_REVISION_MISMATCH" });
    expect(skillCalls).toBe(0);
  });
});

function createHarness() {
  const root = mkdtempSync(join(tmpdir(), "preschool-overview-ai-server-"));
  roots.push(root);
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  metadata.users.upsertDevUser({ id: "dev-user", email: "dev@example.test", display_name: "Dev", dev_token: "dev" });
  metadata.users.upsertDevUser({ id: "second-user", email: "second@example.test", display_name: "Second", dev_token: "second" });
  metadata.workspaces.upsert({ id: "default", owner_user_id: "dev-user", name: "System", kind: "personal" });
  metadata.workspaces.upsert({ id: "preschool-workspace", owner_user_id: "dev-user", name: "Preschool", kind: "customer" });
  metadata.workspaceMemberships.upsert({ workspace_id: "preschool-workspace", user_id: "second-user", role: "member" });
  metadata.energyIq.upsertProject({
    id: "preschool-demo",
    workspace_id: "preschool-workspace",
    name: "Preschool",
    status: "published",
    root_scope_id: "preschool-project",
  });
  metadata.configResources.upsert({
    id: "profile-current",
    workspace_id: "default",
    user_id: "dev-user",
    kind: "model-profile",
    name: "Current model",
    payload: { provider: "openai-compatible", modelName: "test-model" },
    default_enabled: true,
    status: "connected",
  });
  metadata.workspaceDefaultModelProfiles.set({
    workspace_id: "default",
    profile_id: "profile-current",
    profile_owner_user_id: "dev-user",
    configured_by_user_id: "dev-user",
  });
  for (const userId of ["dev-user", "second-user"]) {
    metadata.configResources.upsert({
      id: "energy-insight-investigation",
      workspace_id: "preschool-workspace",
      user_id: userId,
      kind: "skill",
      name: "energy-insight-investigation",
      payload: { version: "1.0.0", userInvocable: true },
      builtin: true,
      default_enabled: false,
      status: "valid",
    });
  }
  const identity: EnergyIqOverviewAiArtifactIdentity = {
    workspaceId: "preschool-workspace",
    projectId: "preschool-demo",
    scopeId: "preschool-project",
    resource: "electricity",
    dataSnapshotId: "snapshot-current",
    projectReleaseId: "release-current",
    analysisPeriodFrom: "2026-05-01T00:00:00.000Z",
    analysisPeriodTo: "2026-06-01T00:00:00.000Z",
    rendererKey: "preschool-overview",
    rendererVersion: "1",
    analysisPackId: "preschool-analysis-pack",
    analysisPackRevision: "v1",
    modelProfileId: WORKSPACE_DEFAULT_MODEL_PROFILE_ID,
    modelProfileRevision: 1,
    outputContractRevision: "v13",
    validatorRevision: "preschool-ai-two-stage-fact-boundary-v5",
    workflowRevision: "preschool-two-stage-v2",
    investigatorPromptRevision: "preschool-investigator-v15",
    editorPromptRevision: "preschool-insight-editor-v7",
    methodSkillId: "energy-insight-investigation",
    methodSkillRevision: "1.0.0",
  };
  return {
    metadata,
    gateway: new LocalDataGateway(metadata),
    identity,
    user: metadata.users.getById({ user_id: "dev-user" }),
    secondUser: metadata.users.getById({ user_id: "second-user" }),
    close: () => metadata.close(),
  };
}

function snapshot(options: { dataSnapshotId?: string } = {}): ProjectAnalysisSnapshot {
  const dataSnapshotId = options.dataSnapshotId ?? "snapshot-current";
  return {
    context: {
      userId: "dev-user",
      workspaceId: "preschool-workspace",
      projectId: "preschool-demo",
      projectName: "Preschool",
      scopeId: "preschool-project",
      scopeName: "Portfolio",
      scopeType: "project",
      resource: "electricity",
      timezone: "Asia/Singapore",
      from: "2026-05-01T00:00:00.000Z",
      to: "2026-06-01T00:00:00.000Z",
      endExclusive: true,
      period: "Custom",
      hierarchyRevisionId: "hierarchy-1",
      meterMappingRevisionId: "mapping-1",
      meterFormulaRevisionId: "formula-1",
      dataSnapshotId,
      metricVersion: "metric-revisions:metric-1",
      businessCalendarVersion: "calendar-1",
      tariffScheduleVersion: "tariff-1",
      primaryPeriod: { start: "2026-05-01T00:00:00.000Z", endExclusive: "2026-06-01T00:00:00.000Z" },
      projectReleaseId: "release-current",
    },
    projectRelease: {
      id: "release-current",
      renderer: { key: "preschool-overview", version: "1", contractVersion: "project-analysis-snapshot@1" },
    },
    renderer: { key: "preschool-overview", version: "1", contractVersion: "project-analysis-snapshot@1" },
    dataSnapshot: { id: dataSnapshotId, importBatchIds: ["batch-1"], lastSeenAt: null },
    dataQuality: { status: "complete", coveragePct: 100, validIntervalCount: 100, expectedMeterIntervalCount: 100, qualityEventCount: 0 },
    analysis: {
      summary: { usageKwh: 1000, averageDailyUsageKwh: 32.25 },
      childScopes: [{ nodeId: "centre-a1", name: "Centre A1", usageKwh: 100 }],
    },
    preschoolBenchmark: {
      status: "provisional",
      sampleSize: 30,
      portfolio: { eui: { p50: 80, p75: 100, unit: "kWh/m2/year" }, perPax: { p50: 20, p75: 25, unit: "kWh/person/month" } },
      priorityCentreCodes: ["A1"],
      centres: [{ centreCode: "A1", cohort: "Childcare", usageKwh: 100, annualisedEuiKwhPerSqmYear: 120, mayKwhPerPerson: 30, quadrant: "priority" }],
      evidence: { metadataStatus: "provisional", sourceQueryIds: ["benchmark-query"] },
    },
    preschoolAppliances: {
      status: "available",
      appliances: [{ name: "Aircon 1", applianceGroup: "Aircon", usageKwh: 400, sharePct: 40, centreCount: 30 }],
      evidence: { projectionRecipeId: "preschool-appliance-ranking-v1" },
    },
    preschoolOperational: {
      status: "available",
      energy: { totalKwh: 1000, standbyKwh: 200, standbySharePct: 20, operatingKwh: 800 },
      spikes: {
        standby: { count: 3, centreCount: 1, centres: [{ centreCode: "A1" }] },
        operating: { count: 2, centreCount: 1, centres: [{ centreCode: "A1" }] },
      },
      sop: { label: "Provisional after-hours SOP signal", status: "provisional", breachingCentreCodes: ["A1"] },
    },
    preschoolDecisionSignals: {
      status: "available",
      context: { dataSnapshotId, projectReleaseId: "release-current" },
      items: [{
        id: "efficiency",
        label: "High for both floor area and headcount",
        metrics: [{ id: "priority-centres", metricId: "priority_count", value: 1, unit: "count" }],
        limitations: [{ label: "Provisional metadata" }],
      }],
    },
  } as unknown as ProjectAnalysisSnapshot;
}

function stageEvents(stage: "investigator" | "editor", runId: string, sessionId: string) {
  return stage === "investigator"
    ? envelopeEvents({
        candidates: [{
          id: "candidate-1",
          epistemicLevel: "hypothesis",
          title: "The dual-normalisation outlier deserves an operating review",
          takeaway: "The same Centre remains a priority after both normalisations, so size alone is not a sufficient explanation.",
          possibleExplanation: "The current Snapshot does not observe occupancy or equipment state.",
          nextCheck: "Compare its operating schedule and equipment state with lower-intensity peers before assigning a cause.",
          evidenceRefs: ["benchmark:portfolio-p75", "benchmark:priority-centre:A1"],
          evidenceSqlIndexes: [],
        }],
      }, runId, sessionId)
    : envelopeEvents({
        findings: [{
          sourceCandidateIds: ["candidate-1"],
          placementTargets: ["preschool.benchmark"],
          relationship: "independent",
          signalRefs: ["efficiency"],
        }],
        trace: [{ decision: "accepted", sourceCandidateIds: ["candidate-1"], reason: "Adds a decision-relevant interpretation." }],
      }, runId, sessionId);
}

function envelopeEvents(value: Record<string, unknown>, runId: string, sessionId: string) {
  return {
    events: [
      ...(Object.hasOwn(value, "candidates")
        ? successfulSubmissionEvents(value, "submit-1")
        : [{ type: "TEXT_MESSAGE_CONTENT", delta: JSON.stringify(value) }]),
      { type: "RUN_FINISHED" },
    ],
    completedRun: { runId, sessionId },
  };
}

function sqlEnvelopeEvents(value: Record<string, unknown>, runId: string, sessionId: string) {
  return {
    events: [
      { type: "TOOL_CALL_START", toolCallId: "schema-1", toolCallName: "inspect_schema", args: {} },
      { type: "TOOL_CALL_RESULT", toolCallId: "schema-1", toolCallName: "inspect_schema", result: { tables: [{ name: "energy_facts" }] } },
      { type: "TOOL_CALL_START", toolCallId: "sql-1", toolCallName: "run_sql_readonly", args: { sql: "SELECT centre_code, usage_kwh FROM energy_facts" } },
      {
        type: "TOOL_CALL_RESULT",
        toolCallId: "sql-1",
        toolCallName: "run_sql_readonly",
        result: {
          evidence_index: 1,
          columns: ["centre_code", "usage_kwh"],
          rows: [["A1", 100], ["E", 300]],
          row_count: 2,
          audit_log_id: "audit-1",
        },
      },
      ...successfulSubmissionEvents(value, "submit-1"),
      { type: "RUN_FINISHED" },
    ],
    completedRun: { runId, sessionId },
  };
}

function successfulSubmissionEvents(value: Record<string, unknown>, toolCallId: string) {
  return [
    {
      type: "TOOL_CALL_START",
      toolCallId,
      toolCallName: "overview_ai_candidates_submit",
    },
    {
      type: "TOOL_CALL_RESULT",
      toolCallId,
      content: JSON.stringify({
        ok: true,
        resultType: "overview-ai-candidate-submission",
        payload: canonicalCandidateSubmission(value),
      }),
    },
  ];
}

function failedSubmissionEvents(toolCallId: string) {
  return [
    {
      type: "TOOL_CALL_START",
      toolCallId,
      toolCallName: "overview_ai_candidates_submit",
    },
    {
      type: "TOOL_CALL_RESULT",
      toolCallId,
      content: JSON.stringify({
        ok: false,
        isError: true,
        error: { code: "OVERVIEW_AI_CANDIDATE_SUBMISSION_INVALID" },
      }),
    },
  ];
}

function schemaEvents() {
  return [
    { type: "TOOL_CALL_START", toolCallId: "schema-1", toolCallName: "inspect_schema", args: {} },
    { type: "TOOL_CALL_RESULT", toolCallId: "schema-1", toolCallName: "inspect_schema", result: { tables: [{ name: "energy_facts" }] } },
  ];
}

function sqlEvents(toolCallId: string, evidenceIndex: number, centreCode: string, usageKwh: number) {
  return [
    {
      type: "TOOL_CALL_START",
      toolCallId,
      toolCallName: "run_sql_readonly",
      args: { sql: `SELECT '${centreCode}' AS centre_code, ${usageKwh} AS usage_kwh` },
    },
    {
      type: "TOOL_CALL_RESULT",
      toolCallId,
      toolCallName: "run_sql_readonly",
      result: {
        evidence_index: evidenceIndex,
        columns: ["centre_code", "usage_kwh"],
        rows: [[centreCode, usageKwh]],
        row_count: 1,
        audit_log_id: `audit-${toolCallId}`,
      },
    },
  ];
}

function canonicalCandidateSubmission(value: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(value.candidates)) return value;
  return {
    ...value,
    candidates: value.candidates.map((candidate) => typeof candidate === "object" && candidate !== null && !Array.isArray(candidate)
      ? {
          action: "Review the pinned Evidence before choosing an operational response.",
          expectedIfAct: "The next review will resolve the decision-relevant question.",
          ifIgnored: "The unresolved pattern may continue without an accountable review.",
          limitation: "The pinned Snapshot does not prove a cause or future outcome.",
          ...candidate,
        }
      : candidate),
  };
}

async function until(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 50; index += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("Timed out waiting for condition");
}
