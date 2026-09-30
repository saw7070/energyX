import { describe, expect, it } from "vitest";

import { ENERGYIQ_HARNESS_FAST_CASES } from "./energyiq-harness-eval-cases.js";
import {
  evaluateEnergyIqHarnessObservation,
  evaluatePreschoolOverviewAiPassAt3,
  evaluateEnergyIqSameSessionContinuity,
} from "./energyiq-harness-eval.js";

describe("EnergyIQ Harness Eval", () => {
  it("compares one fixed-Snapshot single-stage baseline with two-stage pass@3 without a Finding quota", () => {
    const expected = {
      projectId: "preschool-demo" as const,
      scopeId: "preschool-project",
      dataSnapshotId: "snapshot-fixed",
      projectReleaseId: "release-fixed",
      dataCutoff: "2026-06-01T00:00:00.000Z",
    };
    const weakReview = {
      nonRepetition: 0 as const,
      depth: 0 as const,
      managerValue: 1 as const,
      epistemicDiscipline: 1 as const,
      placementQuality: 0 as const,
      expressionFit: 1 as const,
    };
    const strongReview = {
      nonRepetition: 2 as const,
      depth: 2 as const,
      managerValue: 2 as const,
      epistemicDiscipline: 2 as const,
      placementQuality: 2 as const,
      expressionFit: 2 as const,
    };
    const baselineResult = {
      status: "available",
      findings: [{ evidence: { snapshotId: expected.dataSnapshotId } }],
    };
    const binding = {
      ...expected,
      analysisPeriod: { from: "2026-05-01T00:00:00.000Z", to: expected.dataCutoff },
      outputContractRevision: "v13",
    };
    const twoStageResult = {
      status: "available",
      contract: { id: "preschool-ai-accepted-artifact", revision: "v13" },
      binding,
      workflow: {
        id: "preschool-two-stage",
        revision: "preschool-two-stage-v2",
        methodSkill: { id: "energy-insight-investigation", revision: "1.0.0" },
      },
      findings: Array.from({ length: 6 }, (_, index) => ({
        id: `finding-${index + 1}`,
        binding,
        evidence: { snapshotId: expected.dataSnapshotId },
      })),
    };

    const report = evaluatePreschoolOverviewAiPassAt3({
      expected,
      baseline: Array.from({ length: 3 }, () => ({ result: baselineResult, review: weakReview })),
      twoStage: [
        { result: twoStageResult, review: strongReview },
        { result: twoStageResult, review: strongReview },
        { result: { ...twoStageResult, binding: { ...binding, dataSnapshotId: "stale" } }, review: strongReview },
      ],
    });

    expect(report).toMatchObject({
      status: "passed",
      methodSkillValueProved: true,
      baseline: { passAt3: false },
      twoStage: {
        passAt3: true,
        passedCount: 2,
        attempts: [
          { passed: true, findingCount: 6 },
          { passed: true, findingCount: 6 },
          { passed: false, exactIdentity: false },
        ],
      },
    });

    const oneOfThree = evaluatePreschoolOverviewAiPassAt3({
      expected,
      baseline: Array.from({ length: 3 }, () => ({ result: baselineResult, review: weakReview })),
      twoStage: [
        { result: twoStageResult, review: strongReview },
        { result: { ...twoStageResult, binding: { ...binding, dataSnapshotId: "stale-a" } }, review: strongReview },
        { result: { ...twoStageResult, binding: { ...binding, dataSnapshotId: "stale-b" } }, review: strongReview },
      ],
    });
    expect(oneOfThree).toMatchObject({
      status: "failed",
      methodSkillValueProved: false,
      twoStage: { passAt3: false, passedCount: 1 },
    });
  });

  it("keeps the fast suite small, product-specific, and uniquely named", () => {
    expect(ENERGYIQ_HARNESS_FAST_CASES).toHaveLength(10);
    expect(new Set(ENERGYIQ_HARNESS_FAST_CASES.map((evalCase) => evalCase.id)).size).toBe(10);
  });

  it("accepts an exact, evidenced Ngee Ann answer", () => {
    const evalCase = ENERGYIQ_HARNESS_FAST_CASES[0];
    expect(evalCase?.id).toBe("ngee-total-energy");
    const report = evaluateEnergyIqHarnessObservation(evalCase!, {
      elapsedMs: 25_000,
      events: successfulEvents(
        "The whole project used 1,531.1683 kWh from 2026-06-10 to 2026-06-16. The result is calculated from the scoped interval evidence.",
      ),
    });

    expect(report.status).toBe("passed");
    expect(report.hardFailure).toBe(false);
    expect(report.metrics.sqlCalls).toBe(1);
    expect(report.metrics.correctnessRatio).toBe(1);
  });

  it("records extra investigation as efficiency telemetry without failing a correct answer", () => {
    const evalCase = ENERGYIQ_HARNESS_FAST_CASES[0]!;
    const answer = "The whole project used 1,531.1683 kWh from 2026-06-10 to 2026-06-16. The result is calculated from the scoped interval evidence.";
    const baseEvents = successfulEvents(answer);
    const extraInvestigationEvents = Array.from({ length: 6 }, (_, index) => [
      { type: "REASONING_START" },
      { type: "TOOL_CALL_START", toolCallName: "run_sql_readonly", toolCallId: `follow-up-${index}` },
      { type: "TOOL_CALL_RESULT", toolCallName: "run_sql_readonly", toolCallId: `follow-up-${index}`, content: JSON.stringify({ success: true }) },
    ]).flat();
    const terminalIndex = baseEvents.findIndex((event) => event.type === "TEXT_MESSAGE_CONTENT");
    const report = evaluateEnergyIqHarnessObservation(evalCase, {
      elapsedMs: 180_000,
      events: [
        ...baseEvents.slice(0, terminalIndex),
        ...extraInvestigationEvents,
        ...baseEvents.slice(terminalIndex),
      ],
    });

    expect(report.status).toBe("passed");
    expect(report.metrics.sqlCalls).toBe(7);
    expect(report.metrics.reasoningRounds).toBe(7);
    expect(report.metrics.elapsedMs).toBe(180_000);
    expect(report.assertions.some((assertion) => assertion.id.startsWith("efficiency."))).toBe(false);
  });

  it("accepts a three-turn same-session follow-up with stable Snapshot pins", () => {
    const answers = [
      "Centre G is the priority investigation target in the current snapshot.",
      "It matters because the measured data and Snapshot evidence show a provisional high-intensity result for the period.",
      "Inspect Centre G occupancy and equipment schedules first; verify the action by comparing the next week with the current baseline.",
    ];
    const observations = answers.map((answer, index) => ({
      turn: index + 1,
      question: `question-${index + 1}`,
      elapsedMs: 1_000,
      runId: `run-${index + 1}`,
      threadId: "shared-thread",
      events: [
        { type: "RUN_STARTED" },
        {
          type: "CUSTOM",
          name: "context.compiled",
          value: {
            step_number: 1,
            source_snapshot_hashes: [{
              source_type: "project-analysis-snapshot",
              content_hash: "sha256:stable",
              item_ids: ["project-analysis-snapshot:preschool-demo:energy-snapshot-stable"],
            }],
          },
        },
        { type: "TEXT_MESSAGE_CONTENT", messageId: `answer-${index + 1}`, delta: answer },
        { type: "RUN_FINISHED" },
      ],
    }));

    const report = evaluateEnergyIqSameSessionContinuity(observations);

    expect(report.status).toBe("passed");
    expect(report.threadId).toBe("shared-thread");
    expect(report.snapshotIds).toEqual(["energy-snapshot-stable"]);
    expect(report.turns).toHaveLength(3);
  });

  it("records per-step context budget, checkpoint, and cache telemetry without grading it", () => {
    const evalCase = ENERGYIQ_HARNESS_FAST_CASES[0]!;
    const answer = "The whole project used 1,531.1683 kWh from 2026-06-10 to 2026-06-16. The result is calculated from the scoped interval evidence.";
    const events = successfulEvents(answer).map((event) => (
      event.type === "CUSTOM" && event.name === "token_usage"
        ? {
            ...event,
            value: {
              input_tokens: 900,
              output_tokens: 120,
              step_number: 1,
              cache_telemetry_available: true,
              cache_hit_tokens: 600,
              cache_miss_tokens: 300,
            },
          }
        : event
    ));
    events.splice(events.length - 1, 0, {
      type: "CUSTOM",
      name: "context.compiled",
      value: {
        step_number: 1,
        prompt_tokens: 510_000,
        budget_tokens: 963_904,
        budget_utilization: 510_000 / 963_904,
        high_water_mark: "diagnostic",
        budget: {
          capabilitySource: "verified-model-default",
          contextWindow: 1_000_000,
          inputBudget: 963_904,
        },
        token_report: { systemTokens: 10_000, toolTokens: 20_000, messageTokens: 480_000 },
        group_token_costs: [
          { tokenCost: 470_000, selected: true },
          { tokenCost: 10_000, selected: false },
        ],
        source_snapshot_hashes: [{
          source_type: "project-analysis-pack",
          content_hash: "sha256:test",
          item_ids: ["project-analysis-pack:ngee-ann-polytechnic:energy-snapshot-test"],
        }],
        artifact_refs: ["artifact-1"],
      },
    });
    events.splice(events.length - 1, 0, {
      type: "CUSTOM",
      name: "context.prompt-verified",
      value: {
        step_number: 1,
        prompt_tokens: 515_000,
        input_budget: 963_904,
        remaining_tokens: 448_904,
        context_window: 1_000_000,
        budget_utilization: 515_000 / 963_904,
        high_water_mark: "diagnostic",
        capability_source: "verified-model-default",
      },
    });

    const report = evaluateEnergyIqHarnessObservation(evalCase, { elapsedMs: 25_000, events });

    expect(report.status).toBe("passed");
    expect(report.steps).toEqual([expect.objectContaining({
      stepNumber: 1,
      promptTokens: 515_000,
      compiledPromptTokens: 510_000,
      verifiedPromptTokens: 515_000,
      remainingTokens: 448_904,
      inputBudget: 963_904,
      contextWindow: 1_000_000,
      highWaterMark: "diagnostic",
      capabilitySource: "verified-model-default",
      selectedGroupTokens: 470_000,
      omittedGroupTokens: 10_000,
      sourceHashCount: 1,
      authoritativeSourceHashes: { "project-analysis-pack": "sha256:test" },
      artifactRefCount: 1,
      cacheTelemetryAvailable: true,
      cacheHitTokens: 600,
      cacheMissTokens: 300,
    })]);
    expect(report.metrics).toMatchObject({
      maxPromptTokens: 515_000,
      contextCheckpointCount: 1,
      cacheTelemetrySteps: 1,
      cacheHitTokens: 600,
      cacheMissTokens: 300,
      cacheHitRatio: 2 / 3,
    });
  });

  it("fails closed when an authoritative Context source drifts within one run", () => {
    const evalCase = ENERGYIQ_HARNESS_FAST_CASES[0]!;
    const answer = "The whole project used 1,531.1683 kWh from 2026-06-10 to 2026-06-16. The result is calculated from the scoped interval evidence.";
    const events = successfulEvents(answer);
    events.splice(events.length - 1, 0,
      {
        type: "CUSTOM",
        name: "context.compiled",
        value: {
          step_number: 1,
          source_snapshot_hashes: [{
            source_type: "project-analysis-snapshot",
            content_hash: "sha256:snapshot-a",
          }],
        },
      },
      {
        type: "CUSTOM",
        name: "context.compiled",
        value: {
          step_number: 2,
          source_snapshot_hashes: [{
            source_type: "project-analysis-snapshot",
            content_hash: "sha256:snapshot-b",
          }],
        },
      },
    );

    const report = evaluateEnergyIqHarnessObservation(evalCase, { elapsedMs: 25_000, events });

    expect(report.status).toBe("failed");
    expect(report.hardFailure).toBe(true);
    expect(report.metrics.authoritativePinDrift).toBe(true);
    expect(report.assertions).toContainEqual(expect.objectContaining({
      id: "context.authoritative-pin-stable",
      passed: false,
      hard: true,
    }));
  });

  it("counts one reasoning round per message when AG-UI emits both start event variants", () => {
    const evalCase = ENERGYIQ_HARNESS_FAST_CASES[0]!;
    const answer = "The whole project used 1,531.1683 kWh from 2026-06-10 to 2026-06-16. The result is calculated from the scoped interval evidence.";
    const events = successfulEvents(answer).flatMap((event) => event.type === "REASONING_START"
      ? [
          { type: "REASONING_START", messageId: "reasoning-1" },
          { type: "REASONING_MESSAGE_START", messageId: "reasoning-1" },
          { type: "REASONING_START", messageId: "reasoning-2" },
          { type: "REASONING_MESSAGE_START", messageId: "reasoning-2" },
        ]
      : [event]);

    const report = evaluateEnergyIqHarnessObservation(evalCase, { elapsedMs: 25_000, events });

    expect(report.status).toBe("passed");
    expect(report.metrics.reasoningRounds).toBe(2);
  });

  it("records a recovered tool failure without turning a correct completed run into a hard failure", () => {
    const evalCase = ENERGYIQ_HARNESS_FAST_CASES[0]!;
    const answer = "The whole project used 1,531.1683 kWh from 2026-06-10 to 2026-06-16. The result is calculated from the scoped interval evidence.";
    const events = successfulEvents(answer);
    const successfulCommitIndex = events.findIndex((event) => (
      event.type === "TOOL_CALL_START" && event.toolCallName === "analysis_requirements_commit"
    ));
    events.splice(successfulCommitIndex, 0,
      { type: "TOOL_CALL_START", toolCallName: "analysis_requirements_commit", toolCallId: "commit-rejected" },
      {
        type: "TOOL_CALL_RESULT",
        toolCallName: "analysis_requirements_commit",
        toolCallId: "commit-rejected",
        content: JSON.stringify({ ok: false, isError: true, error: { code: "ANALYSIS_CONTEXT_EVIDENCE_REQUIRED" } }),
      });

    const report = evaluateEnergyIqHarnessObservation(evalCase, { elapsedMs: 50_000, events });

    expect(report.status).toBe("passed");
    expect(report.hardFailure).toBe(false);
    expect(report.metrics.failedToolCalls).toBe(1);
    expect(report.metrics.recoveredToolFailures).toBe(1);
  });

  it("accepts a released EUI answer after contract setup without forcing SQL", () => {
    const evalCase = ENERGYIQ_HARNESS_FAST_CASES.find((entry) => entry.id === "preschool-released-eui")!;
    const answer = "Centre A's released EUI is 13.62 kWh/m²/year, provisional. Its Senior Care Center cohort P50 is 6.75 and P75 is 9.20 kWh/m²/year.";
    const report = evaluateEnergyIqHarnessObservation(evalCase, {
      elapsedMs: 45_000,
      events: contextEvidenceEvents(answer, ["analysis.context.evidence.bind", "analysis.requirements.commit"]),
    });

    expect(report.status).toBe("passed");
    expect(report.metrics.sqlCalls).toBe(0);
    expect(report.snapshotIds).toEqual(["energy-snapshot-52ca9611e48b0d71c2efe7b7"]);
    expect(report.assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "protocol.analysis.context.evidence.bind", passed: true }),
      expect.objectContaining({ id: "context.single-snapshot", passed: true, hard: true }),
    ]));
  });

  it("records optional released-EUI investigation as telemetry without rejecting the evidenced answer", () => {
    const evalCase = ENERGYIQ_HARNESS_FAST_CASES.find((entry) => entry.id === "preschool-released-eui")!;
    const answer = "Centre A's released EUI is 13.62 kWh/m²/year, provisional. Its Senior Care Center cohort P50 is 6.75 and P75 is 9.20 kWh/m²/year.";
    const report = evaluateEnergyIqHarnessObservation(evalCase, {
      elapsedMs: 70_000,
      events: contextEvidenceEvents(answer, [
        "analysis.evidence.bind",
        "analysis.context.evidence.bind",
        "analysis.requirements.commit",
      ], { includeSql: true }),
    });

    expect(report.status).toBe("passed");
    expect(report.hardFailure).toBe(false);
    expect(report.metrics.sqlCalls).toBe(1);
    expect(report.assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "protocol.analysis.context.evidence.bind", passed: true }),
      expect.objectContaining({ id: "context.single-snapshot", passed: true, hard: true }),
    ]));
  });

  it("still rejects a released EUI answer that omits Context Evidence binding", () => {
    const evalCase = ENERGYIQ_HARNESS_FAST_CASES.find((entry) => entry.id === "preschool-released-eui")!;
    const answer = "Centre A's released EUI is 13.62 kWh/m²/year, provisional. Its Senior Care Center cohort P50 is 6.75 and P75 is 9.20 kWh/m²/year.";
    const report = evaluateEnergyIqHarnessObservation(evalCase, {
      elapsedMs: 45_000,
      events: contextEvidenceEvents(answer, ["analysis.requirements.commit"]),
    });

    expect(report.status).toBe("failed");
    expect(report.assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "protocol.analysis.context.evidence.bind", passed: false }),
    ]));
  });

  it("requires an autonomous investigation to combine Context and Query Evidence on one Snapshot", () => {
    const evalCase = ENERGYIQ_HARNESS_FAST_CASES.find((entry) => entry.id === "preschool-released-plus-query-investigation")!;
    const answer = "Investigate Centre G first: it is the priority pattern in the released evidence for the current snapshot, but the facts are provisional. This matters because area or occupant denominator uncertainty can distort the apparent load. Check area, occupancy, and operating hours; then verify them and compare the next week's trend before acting.";
    const events = contextEvidenceEvents(answer, [
      "analysis.evidence.bind",
      "analysis.context.evidence.bind",
      "analysis.requirements.commit",
    ], { includeSql: true });
    const report = evaluateEnergyIqHarnessObservation(evalCase, { elapsedMs: 95_000, events });

    expect(report.status).toBe("passed");
    expect(report.metrics.sqlCalls).toBe(1);
    expect(report.assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "protocol.analysis.evidence.bind", passed: true }),
      expect.objectContaining({ id: "protocol.analysis.context.evidence.bind", passed: true }),
      expect.objectContaining({ id: "context.single-snapshot", passed: true, hard: true }),
    ]));
  });

  it("fails closed when the released Context crosses Workspace or Snapshot boundaries", () => {
    const evalCase = ENERGYIQ_HARNESS_FAST_CASES.find((entry) => entry.id === "preschool-released-eui")!;
    const events = contextEvidenceEvents(
      "Centre A's released EUI is 13.62 kWh/m²/year, provisional. Its Senior Care Center cohort P50 is 6.75 kWh/m²/year.",
      ["analysis.context.evidence.bind", "analysis.requirements.commit"],
    );
    events.splice(-2, 0,
      { type: "CUSTOM", name: "run.config.resolved", value: { workspace_id: "another-workspace" } },
      { type: "CUSTOM", name: "context.compiled", value: { item_id: "project-analysis-snapshot:preschool-demo:energy-snapshot-second" } },
    );

    const report = evaluateEnergyIqHarnessObservation(evalCase, { elapsedMs: 45_000, events });

    expect(report.status).toBe("failed");
    expect(report.hardFailure).toBe(true);
    expect(report.assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "context.single-snapshot", passed: false, hard: true }),
      expect.objectContaining({ id: "context.workspace", passed: false, hard: true }),
    ]));
  });

  it("treats internal errors and forbidden execution tools as hard failures", () => {
    const evalCase = ENERGYIQ_HARNESS_FAST_CASES[0]!;
    const report = evaluateEnergyIqHarnessObservation(evalCase, {
      elapsedMs: 25_000,
      events: successfulEvents("SECRET_MASTER_KEY_REQUIRED", ["execute_command"]),
    });

    expect(report.status).toBe("failed");
    expect(report.hardFailure).toBe(true);
    expect(report.metrics.correctnessRatio).toBe(0);
    expect(report.assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "tool.forbidden.execute_command", passed: false, hard: true }),
      expect.objectContaining({ id: "answer.no-internal.SECRET_MASTER_KEY_REQUIRED", passed: false, hard: true }),
    ]));
  });

  it("checks chart type and exact point count at the backend artifact boundary", () => {
    const evalCase = ENERGYIQ_HARNESS_FAST_CASES.find((entry) => entry.id === "ngee-hourly-chart")!;
    const points = Array.from({ length: 168 }, (_, index) => ({ label: String(index), value: index }));
    const events = successfulEvents("The period is 3 June 2026 to 9 June 2026. The peak is 9.1 kWh. Open Outputs for the chart preview.")
      .map((event) => event.type === "TOOL_CALL_RESULT"
        && (event as { toolCallName?: string }).toolCallName === "run_sql_readonly"
        ? {
            ...event,
            content: JSON.stringify({
              columns: ["local_hour_start", "energy_kwh"],
              rows: points.slice(0, 20).map((point) => [point.label, point.value]),
              row_count: 168,
              context: {
                truncation: { truncated: true, originalSize: 168, returnedSize: 20 },
              },
            }),
          }
        : event);
    const report = evaluateEnergyIqHarnessObservation(evalCase, {
      elapsedMs: 40_000,
      events: [
        ...events,
        {
          type: "CUSTOM",
          name: "artifact",
          value: {
            type: "table",
            tool_call_id: "call-1",
            preview_json: {
              columns: ["local_hour_start", "energy_kwh"],
              rows: points.map((point) => [point.label, point.value]),
              row_count: 168,
            },
          },
        },
        { type: "CUSTOM", name: "artifact", value: { type: "chart", preview_json: { chartType: "line", points } } },
      ],
    });

    expect(report.assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "chart.present", passed: true }),
      expect.objectContaining({ id: "chart.type", passed: true }),
      expect.objectContaining({ id: "chart.point-count", passed: true }),
      expect.objectContaining({ id: "chart.matches-sql", passed: true }),
    ]));
    expect(report.status).toBe("passed");
  });

  it("does not accept a full table artifact that is unrelated to the SQL tool call", () => {
    const evalCase = ENERGYIQ_HARNESS_FAST_CASES.find((entry) => entry.id === "ngee-hourly-chart")!;
    const points = Array.from({ length: 168 }, (_, index) => ({ label: String(index), value: index }));
    const events = successfulEvents("The period is 3 June 2026 to 9 June 2026. The peak is 9.1 kWh.")
      .map((event) => event.type === "TOOL_CALL_RESULT"
        && (event as { toolCallName?: string }).toolCallName === "run_sql_readonly"
        ? {
            ...event,
            content: JSON.stringify({
              columns: ["local_hour_start", "energy_kwh"],
              rows: points.slice(0, 20).map((point) => [point.label, point.value]),
              row_count: 168,
            }),
          }
        : event);
    const report = evaluateEnergyIqHarnessObservation(evalCase, {
      elapsedMs: 40_000,
      events: [
        ...events,
        {
          type: "CUSTOM",
          name: "artifact",
          value: {
            type: "table",
            tool_call_id: "unrelated-call",
            preview_json: {
              columns: ["local_hour_start", "energy_kwh"],
              rows: points.map((point) => [point.label, point.value]),
            },
          },
        },
        { type: "CUSTOM", name: "artifact", value: { type: "chart", preview_json: { chartType: "line", points } } },
      ],
    });

    expect(report.assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "chart.matches-sql", passed: false, hard: true }),
    ]));
    expect(report.hardFailure).toBe(true);
  });

  it("scores actionable insight across What, Evidence, Why, Action, and Verify", () => {
    const evalCase = ENERGYIQ_HARNESS_FAST_CASES.find((entry) => entry.id === "ngee-actionable-insight")!;
    const answer = [
      "The priority issue is Load 4: measured use was 439 kWh, the highest circuit in the 2026-06-10 to 2026-06-16 period.",
      "This matters because its share creates a material waste and demand risk, but the data does not prove a cause.",
      "Investigate the circuit schedule and inspect connected equipment with the operations team.",
      "Verify the hypothesis by monitoring the next week and comparing meter readings against the baseline after the check.",
    ].join(" ");
    const report = evaluateEnergyIqHarnessObservation(evalCase, {
      elapsedMs: 45_000,
      events: successfulEvents(answer),
    });

    expect(report.metrics.insightQuality).toBe(10);
    expect(report.metrics.decisionQuality).toMatchObject({
      takeaway: 2,
      evidenceUse: 2,
      decisionRelevance: 2,
      action: 2,
      verification: 2,
      causalDiscipline: 2,
      readability: 2,
      consequence: 0,
      total: 14,
      maximum: 16,
    });
    expect(report.metrics.answerWordCount).toBeGreaterThan(40);
    expect(report.metrics.openingWordCount).toBeLessThan(report.metrics.answerWordCount);
    expect(report.status).toBe("passed");
  });

  it("reports repeated SQL as efficiency telemetry without restricting a correct investigation", () => {
    const evalCase = ENERGYIQ_HARNESS_FAST_CASES[0]!;
    const answer = "The whole project used 1,531.1683 kWh from 2026-06-10 to 2026-06-16. The result is calculated from the scoped interval evidence.";
    const sql = "SELECT SUM(usage_kwh) FROM canonical_interval WHERE quality_status = 'ok';";
    const events = successfulEvents(answer).map((event) => (
      event.type === "TOOL_CALL_START" && event.toolCallName === "run_sql_readonly"
        ? { ...event, args: { sql } }
        : event
    ));
    const answerIndex = events.findIndex((event) => event.type === "TEXT_MESSAGE_CONTENT");
    events.splice(answerIndex, 0,
      { type: "TOOL_CALL_START", toolCallName: "run_sql_readonly", toolCallId: "duplicate-sql", args: { sql: `  ${sql.toUpperCase()}  ` } },
      { type: "TOOL_CALL_RESULT", toolCallName: "run_sql_readonly", toolCallId: "duplicate-sql", content: JSON.stringify({ success: true }) },
    );

    const report = evaluateEnergyIqHarnessObservation(evalCase, { elapsedMs: 90_000, events });

    expect(report.status).toBe("passed");
    expect(report.metrics.sqlCalls).toBe(2);
    expect(report.metrics.repeatedSqlCalls).toBe(1);
    expect(report.assertions.some((assertion) => assertion.id.startsWith("efficiency."))).toBe(false);
  });

  it("classifies a retry-heavy SQL investigation without turning telemetry into a correctness gate", () => {
    const evalCase = ENERGYIQ_HARNESS_FAST_CASES[0]!;
    const answer = "The whole project used 1,531.1683 kWh from 2026-06-10 to 2026-06-16. The result is calculated from the scoped interval evidence.";
    const events = successfulEvents(answer);
    const answerIndex = events.findIndex((event) => event.type === "TEXT_MESSAGE_CONTENT");
    events.splice(answerIndex, 0,
      ...Array.from({ length: 8 }, (_, index) => [
        {
          type: "TOOL_CALL_START",
          toolCallName: "run_sql_readonly",
          toolCallId: `investigation-sql-${index + 1}`,
          args: { sql: `SELECT ${index + 1} AS investigation_step` },
        },
        {
          type: "TOOL_CALL_RESULT",
          toolCallName: "run_sql_readonly",
          toolCallId: `investigation-sql-${index + 1}`,
          content: JSON.stringify(index < 2
            ? { success: false, error: "query timed out" }
            : { success: true }),
        },
      ]).flat(),
    );

    const report = evaluateEnergyIqHarnessObservation(evalCase, { elapsedMs: 176_000, events });

    expect(report.status).toBe("passed");
    expect(report.metrics.sqlCalls).toBe(9);
    expect(report.metrics.sqlInvestigationPattern).toBe("recovery-heavy");
  });
});

const successfulEvents = (answer: string, extraTools: string[] = []): Array<Record<string, unknown>> => {
  const tools = ["inspect_schema", "run_sql_readonly", "analysis_requirements_commit", ...extraTools];
  return [
    { type: "RUN_STARTED" },
    { type: "REASONING_START" },
    ...tools.flatMap((toolCallName, index) => [
      { type: "TOOL_CALL_START", toolCallName, toolCallId: `call-${index}` },
      { type: "TOOL_CALL_RESULT", toolCallName, toolCallId: `call-${index}`, content: JSON.stringify({ success: true }) },
    ]),
    { type: "TEXT_MESSAGE_CONTENT", messageId: "answer", delta: answer },
    { type: "CUSTOM", name: "token_usage", value: { input_tokens: 100, output_tokens: 40 } },
    { type: "RUN_FINISHED" },
  ];
};

const contextEvidenceEvents = (
  answer: string,
  protocolActions: string[],
  options: { includeSql?: boolean } = {},
): Array<Record<string, unknown>> => {
  const snapshotId = "energy-snapshot-52ca9611e48b0d71c2efe7b7";
  const tools = [
    "inspect_schema",
    ...(options.includeSql ? ["run_sql_readonly"] : []),
    "analysis_requirements_commit",
  ];
  return [
    { type: "RUN_STARTED" },
    { type: "REASONING_START" },
    {
      type: "CUSTOM",
      name: "run.config.resolved",
      value: { workspace_id: "preschool-demo-org" },
    },
    {
      type: "CUSTOM",
      name: "context.compiled",
      value: {
        selected_group_ids: ["energy-query-context", "project-analysis-snapshot"],
        selected_sources: [{
          group_id: "project-analysis-snapshot",
          item_ids: [`project-analysis-snapshot:preschool-demo:${snapshotId}`],
        }],
        decisions: [{ affectedItemIds: [`project-analysis-snapshot:preschool-demo:${snapshotId}`] }],
      },
    },
    ...tools.flatMap((toolCallName, index) => [
      { type: "TOOL_CALL_START", toolCallName, toolCallId: `context-call-${index}` },
      { type: "TOOL_CALL_RESULT", toolCallName, toolCallId: `context-call-${index}`, content: JSON.stringify({ success: true }) },
    ]),
    ...protocolActions.map((actionName, index) => ({
      type: "CUSTOM",
      name: "protocol.action.succeeded",
      value: { payload: { actionId: `protocol-${index}`, actionName } },
    })),
    { type: "TEXT_MESSAGE_CHUNK", messageId: "answer", delta: answer },
    { type: "RUN_FINISHED" },
  ];
};
