import {
  getEnergyIqHarnessEvalSuite,
  type EnergyIqHarnessEvalCase,
} from "./energyiq-harness-eval-cases.js";

type EventRecord = Record<string, unknown>;

export type EnergyIqHarnessObservation = {
  events: unknown[];
  elapsedMs: number;
  runId?: string;
  threadId?: string;
};

export type EnergyIqHarnessContinuityTurnObservation = EnergyIqHarnessObservation & {
  question: string;
  turn: number;
};

export type EnergyIqHarnessContinuityReport = {
  status: "passed" | "failed";
  threadId: string | null;
  snapshotIds: string[];
  assertions: Array<{ id: string; passed: boolean; hard: boolean; detail: string }>;
  turns: Array<{
    turn: number;
    question: string;
    answer: string;
    elapsedMs: number;
    toolCalls: number;
    sqlCalls: number;
    contextCheckpoints: number;
    snapshotIds: string[];
    steps: EnergyIqHarnessStepMetrics[];
    runId?: string;
  }>;
};

export type EnergyIqHarnessStepMetrics = {
  stepNumber: number;
  promptTokens: number;
  compiledPromptTokens: number | null;
  verifiedPromptTokens: number | null;
  remainingTokens: number | null;
  inputBudget: number | null;
  contextWindow: number | null;
  budgetUtilization: number | null;
  highWaterMark: string | null;
  capabilitySource: string | null;
  systemTokens: number;
  toolTokens: number;
  messageTokens: number;
  selectedGroupIds: string[];
  repeatedSelectedGroupIds: string[];
  selectedGroupTokens: number;
  omittedGroupTokens: number;
  sourceHashCount: number;
  authoritativeSourceHashes: Record<string, string>;
  artifactRefCount: number;
  inputTokens: number;
  outputTokens: number;
  toolNames: string[];
  cacheTelemetryAvailable: boolean;
  cacheHitTokens: number | null;
  cacheMissTokens: number | null;
};

export type EnergyIqDecisionQualityBreakdown = {
  takeaway: number;
  evidenceUse: number;
  decisionRelevance: number;
  action: number;
  verification: number;
  causalDiscipline: number;
  readability: number;
  consequence: number;
  total: number;
  maximum: number;
  ratio: number;
};

export type EnergyIqSqlInvestigationPattern = "none" | "focused" | "extended" | "recovery-heavy";

export type EnergyIqHarnessCaseReport = {
  caseId: string;
  title: string;
  attempt: number;
  status: "passed" | "failed";
  hardFailure: boolean;
  answer: string;
  snapshotIds: string[];
  assertions: Array<{ id: string; passed: boolean; hard: boolean; detail: string }>;
  steps: EnergyIqHarnessStepMetrics[];
  metrics: {
    elapsedMs: number;
    toolCalls: number;
    failedToolCalls: number;
    recoveredToolFailures: number;
    sqlCalls: number;
    sqlInvestigationPattern: EnergyIqSqlInvestigationPattern;
    reasoningRounds: number;
    inputTokens: number;
    outputTokens: number;
    maxPromptTokens: number;
    maxBudgetUtilization: number | null;
    contextCheckpointCount: number;
    cacheTelemetrySteps: number;
    cacheHitTokens: number;
    cacheMissTokens: number;
    cacheHitRatio: number | null;
    authoritativePinDrift: boolean;
    correctnessRatio: number;
    insightQuality: number | null;
    decisionQuality: EnergyIqDecisionQualityBreakdown | null;
    answerWordCount: number;
    openingWordCount: number;
    repeatedSqlCalls: number;
  };
  runId?: string;
  threadId?: string;
};

export type EnergyIqHarnessSuiteReport = {
  schemaVersion: 1;
  suiteId: string;
  profileId: string;
  candidateVersion: string;
  baseUrl: string;
  generatedAt: string;
  status: "passed" | "failed";
  summary: {
    totalRuns: number;
    passedRuns: number;
    hardFailures: number;
    passRate: number;
    p50ElapsedMs: number;
    p95ElapsedMs: number;
    averageSqlCalls: number;
    averageReasoningRounds: number;
    averageCorrectnessRatio: number;
    averageInsightQuality: number | null;
    averageDecisionQualityRatio: number | null;
    averageAnswerWordCount: number;
    totalRepeatedSqlCalls: number;
    totalFailedToolCalls: number;
    totalRecoveredToolFailures: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    maxPromptTokens: number;
    maxBudgetUtilization: number | null;
    totalContextCheckpoints: number;
    totalCacheTelemetrySteps: number;
    totalCacheHitTokens: number;
    totalCacheMissTokens: number;
    cacheHitRatio: number | null;
  };
  cases: EnergyIqHarnessCaseReport[];
};

export type RunEnergyIqHarnessEvalInput = {
  suiteId: string;
  profileId: string;
  candidateVersion: string;
  baseUrl: string;
  attemptsPerCase?: number;
  caseIds?: string[];
  runCase: (
    evalCase: EnergyIqHarnessEvalCase,
    context: { profileId: string; attempt: number },
  ) => Promise<EnergyIqHarnessObservation>;
};

export type PreschoolOverviewAiValueReview = {
  nonRepetition: 0 | 1 | 2;
  depth: 0 | 1 | 2;
  managerValue: 0 | 1 | 2;
  epistemicDiscipline: 0 | 1 | 2;
  placementQuality: 0 | 1 | 2;
  expressionFit: 0 | 1 | 2;
};

export type PreschoolOverviewAiPassAt3Input = {
  expected: {
    projectId: "preschool-demo";
    scopeId: string;
    dataSnapshotId: string;
    projectReleaseId: string;
    dataCutoff: string;
  };
  baseline: Array<{ result: unknown; review: PreschoolOverviewAiValueReview }>;
  twoStage: Array<{ result: unknown; review: PreschoolOverviewAiValueReview }>;
};

export type PreschoolOverviewAiPassAt3Report = {
  status: "passed" | "failed";
  methodSkillValueProved: boolean;
  baseline: PreschoolOverviewAiVariantReport;
  twoStage: PreschoolOverviewAiVariantReport;
};

type PreschoolOverviewAiVariantReport = {
  passAt3: boolean;
  passedCount: number;
  averageValueScore: number;
  attempts: Array<{
    attempt: number;
    passed: boolean;
    exactIdentity: boolean;
    contractValid: boolean;
    valueScore: number;
    findingCount: number;
  }>;
};

export const evaluatePreschoolOverviewAiPassAt3 = (
  input: PreschoolOverviewAiPassAt3Input,
): PreschoolOverviewAiPassAt3Report => {
  if (input.baseline.length !== 3 || input.twoStage.length !== 3) {
    throw new Error("PRESCHOOL_OVERVIEW_AI_PASS_AT_3_REQUIRES_THREE_ATTEMPTS");
  }
  const baseline = evaluatePreschoolVariant(input.baseline, input.expected, false);
  const twoStage = evaluatePreschoolVariant(input.twoStage, input.expected, true);
  const methodSkillValueProved = twoStage.passAt3
    && twoStage.averageValueScore > baseline.averageValueScore;
  return {
    status: methodSkillValueProved ? "passed" : "failed",
    methodSkillValueProved,
    baseline,
    twoStage,
  };
};

const evaluatePreschoolVariant = (
  observations: PreschoolOverviewAiPassAt3Input["baseline"],
  expected: PreschoolOverviewAiPassAt3Input["expected"],
  requireTwoStage: boolean,
): PreschoolOverviewAiVariantReport => {
  const attempts = observations.map((observation, index) => {
    const result = isRecord(observation.result) ? observation.result : {};
    const findings = Array.isArray(result.findings) ? result.findings.filter(isRecord) : [];
    const exactIdentity = requireTwoStage
      ? isRecord(result.binding)
        && result.binding.projectId === expected.projectId
        && result.binding.scopeId === expected.scopeId
        && result.binding.dataSnapshotId === expected.dataSnapshotId
        && result.binding.projectReleaseId === expected.projectReleaseId
        && result.binding.dataCutoff === expected.dataCutoff
        && findings.every((finding) => isRecord(finding.binding)
          && finding.binding.dataSnapshotId === expected.dataSnapshotId
          && isRecord(finding.evidence)
          && finding.evidence.snapshotId === expected.dataSnapshotId)
      : findings.every((finding) => isRecord(finding.evidence)
        && finding.evidence.snapshotId === expected.dataSnapshotId);
    const contractValid = result.status === "available" && (!requireTwoStage || (
      isRecord(result.contract)
      && result.contract.id === "preschool-ai-accepted-artifact"
      && result.contract.revision === "v13"
      && isRecord(result.workflow)
      && result.workflow.id === "preschool-two-stage"
      && result.workflow.revision === "preschool-two-stage-v2"
      && isRecord(result.workflow.methodSkill)
      && result.workflow.methodSkill.id === "energy-insight-investigation"
      && result.workflow.methodSkill.revision === "1.0.0"
    ));
    const valueScore = Object.values(observation.review).reduce<number>((total, score) => total + score, 0);
    const passed = exactIdentity
      && contractValid
      && valueScore >= 9
      && observation.review.nonRepetition >= 1
      && observation.review.managerValue === 2
      && observation.review.epistemicDiscipline >= 1;
    return {
      attempt: index + 1,
      passed,
      exactIdentity,
      contractValid,
      valueScore,
      findingCount: findings.length,
    };
  });
  const passedCount = attempts.filter((attempt) => attempt.passed).length;
  return {
    passAt3: passedCount >= 2,
    passedCount,
    averageValueScore: average(attempts.map((attempt) => attempt.valueScore)),
    attempts,
  };
};

export const runEnergyIqHarnessEval = async (
  input: RunEnergyIqHarnessEvalInput,
): Promise<EnergyIqHarnessSuiteReport> => {
  const suiteCases = getEnergyIqHarnessEvalSuite(input.suiteId);
  const requestedCaseIds = new Set(input.caseIds ?? []);
  const cases = requestedCaseIds.size > 0
    ? suiteCases.filter((evalCase) => requestedCaseIds.has(evalCase.id))
    : suiteCases;
  if (cases.length !== requestedCaseIds.size && requestedCaseIds.size > 0) {
    const known = new Set(suiteCases.map((evalCase) => evalCase.id));
    const unknown = [...requestedCaseIds].filter((caseId) => !known.has(caseId));
    throw new Error(`ENERGYIQ_HARNESS_EVAL_CASE_UNKNOWN:${unknown.join(",")}`);
  }
  const attempts = Math.max(1, Math.floor(input.attemptsPerCase ?? 1));
  const reports: EnergyIqHarnessCaseReport[] = [];

  for (const evalCase of cases) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const observation = await input.runCase(evalCase, { profileId: input.profileId, attempt });
        reports.push(evaluateEnergyIqHarnessObservation(evalCase, observation, attempt));
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        reports.push({
          caseId: evalCase.id,
          title: evalCase.title,
          attempt,
          status: "failed",
          hardFailure: true,
          answer: "",
          snapshotIds: [],
          steps: [],
          assertions: [{ id: "runner.completed", passed: false, hard: true, detail }],
          metrics: {
            elapsedMs: 0,
            toolCalls: 0,
            failedToolCalls: 0,
            recoveredToolFailures: 0,
            sqlCalls: 0,
            sqlInvestigationPattern: "none",
            reasoningRounds: 0,
            inputTokens: 0,
            outputTokens: 0,
            maxPromptTokens: 0,
            maxBudgetUtilization: null,
            contextCheckpointCount: 0,
            cacheTelemetrySteps: 0,
            cacheHitTokens: 0,
            cacheMissTokens: 0,
            cacheHitRatio: null,
            authoritativePinDrift: false,
            correctnessRatio: 0,
            insightQuality: null,
            decisionQuality: null,
            answerWordCount: 0,
            openingWordCount: 0,
            repeatedSqlCalls: 0,
          },
        });
      }
    }
  }

  const elapsed = reports.map((report) => report.metrics.elapsedMs).sort((a, b) => a - b);
  const insightScores = reports
    .map((report) => report.metrics.insightQuality)
    .filter((score): score is number => score !== null);
  const decisionQualityRatios = reports
    .map((report) => report.metrics.decisionQuality?.ratio ?? null)
    .filter((score): score is number => score !== null);
  const passedRuns = reports.filter((report) => report.status === "passed").length;
  const hardFailures = reports.filter((report) => report.hardFailure).length;
  const totalCacheHitTokens = sum(reports.map((report) => report.metrics.cacheHitTokens));
  const totalCacheMissTokens = sum(reports.map((report) => report.metrics.cacheMissTokens));
  return {
    schemaVersion: 1,
    suiteId: input.suiteId,
    profileId: input.profileId,
    candidateVersion: input.candidateVersion,
    baseUrl: input.baseUrl,
    generatedAt: new Date().toISOString(),
    status: passedRuns === reports.length ? "passed" : "failed",
    summary: {
      totalRuns: reports.length,
      passedRuns,
      hardFailures,
      passRate: ratio(passedRuns, reports.length),
      p50ElapsedMs: percentile(elapsed, 0.5),
      p95ElapsedMs: percentile(elapsed, 0.95),
      averageSqlCalls: average(reports.map((report) => report.metrics.sqlCalls)),
      averageReasoningRounds: average(reports.map((report) => report.metrics.reasoningRounds)),
      averageCorrectnessRatio: average(reports.map((report) => report.metrics.correctnessRatio)),
      averageInsightQuality: insightScores.length > 0 ? average(insightScores) : null,
      averageDecisionQualityRatio: decisionQualityRatios.length > 0 ? average(decisionQualityRatios) : null,
      averageAnswerWordCount: average(reports.map((report) => report.metrics.answerWordCount)),
      totalRepeatedSqlCalls: sum(reports.map((report) => report.metrics.repeatedSqlCalls)),
      totalFailedToolCalls: sum(reports.map((report) => report.metrics.failedToolCalls)),
      totalRecoveredToolFailures: sum(reports.map((report) => report.metrics.recoveredToolFailures)),
      totalInputTokens: sum(reports.map((report) => report.metrics.inputTokens)),
      totalOutputTokens: sum(reports.map((report) => report.metrics.outputTokens)),
      maxPromptTokens: Math.max(0, ...reports.map((report) => report.metrics.maxPromptTokens)),
      maxBudgetUtilization: maximumOptional(reports.map((report) => report.metrics.maxBudgetUtilization)),
      totalContextCheckpoints: sum(reports.map((report) => report.metrics.contextCheckpointCount)),
      totalCacheTelemetrySteps: sum(reports.map((report) => report.metrics.cacheTelemetrySteps)),
      totalCacheHitTokens,
      totalCacheMissTokens,
      cacheHitRatio: cacheHitRatio(totalCacheHitTokens, totalCacheMissTokens),
    },
    cases: reports,
  };
};

export const evaluateEnergyIqHarnessObservation = (
  evalCase: EnergyIqHarnessEvalCase,
  observation: EnergyIqHarnessObservation,
  attempt = 1,
): EnergyIqHarnessCaseReport => {
  const events = observation.events.filter(isRecord);
  const toolNames = events
    .filter((event) => stringValue(event.type) === "TOOL_CALL_START")
    .map((event) => stringValue(event.toolCallName))
    .filter(Boolean);
  const toolNameByCallId = new Map(events
    .filter((event) => stringValue(event.type) === "TOOL_CALL_START")
    .map((event) => [stringValue(event.toolCallId), stringValue(event.toolCallName)] as const)
    .filter(([toolCallId, toolCallName]) => toolCallId.length > 0 && toolCallName.length > 0));
  const toolResults = events.flatMap((event, eventIndex) => {
    if (stringValue(event.type) !== "TOOL_CALL_RESULT") return [];
    const toolCallName = stringValue(event.toolCallName)
      || toolNameByCallId.get(stringValue(event.toolCallId))
      || "unknown";
    return [{ event, eventIndex, toolCallName, failed: toolResultFailed(event) }];
  });
  const successfulToolNames = toolResults
    .filter((result) => !result.failed)
    .map((result) => result.toolCallName);
  const failedTools = toolResults.filter((result) => result.failed);
  const failedSqlCalls = failedTools.filter((result) => result.toolCallName === "run_sql_readonly").length;
  const recoveredToolFailures = failedTools.filter((failed) => toolResults.some((candidate) => (
    candidate.eventIndex > failed.eventIndex
    && candidate.toolCallName === failed.toolCallName
    && !candidate.failed
  ))).length;
  const sqlCalls = toolNames.filter((name) => name === "run_sql_readonly").length;
  const sqlInvestigationPattern = classifySqlInvestigationPattern(sqlCalls, failedSqlCalls);
  const reasoningRounds = countReasoningRounds(events);
  const answer = extractFinalAnswer(events);
  const assertions: EnergyIqHarnessCaseReport["assertions"] = [];
  const assert = (id: string, passed: boolean, detail: string, hard = false) => {
    assertions.push({ id, passed, hard, detail });
  };

  const runError = findLastEvent(events, (event) => stringValue(event.type) === "RUN_ERROR");
  assert("run.no-error", runError === undefined, runError ? JSON.stringify(runError) : "No RUN_ERROR", true);
  const terminal = findLastEvent(events, (event) => (
    stringValue(event.type) === "RUN_FINISHED" || stringValue(event.type) === "RUN_ERROR"
  ));
  assert("run.finished", stringValue(terminal?.type) === "RUN_FINISHED", `terminal=${stringValue(terminal?.type) || "missing"}`, true);
  assert("answer.present", answer.length > 0, `answer_chars=${answer.length}`, true);

  for (const required of evalCase.contract.requiredTools) {
    const started = toolNames.filter((name) => name === required).length;
    const succeeded = successfulToolNames.filter((name) => name === required).length;
    assert(`tool.${required}`, succeeded >= 1, `started=${started}, succeeded=${succeeded}`);
  }
  for (const forbidden of evalCase.contract.forbiddenTools) {
    assert(`tool.forbidden.${forbidden}`, !toolNames.includes(forbidden), `present=${toolNames.includes(forbidden)}`, true);
  }
  const inspectIndex = toolNames.indexOf("inspect_schema");
  const sqlIndex = toolNames.indexOf("run_sql_readonly");
  assert("tools.inspect-before-sql", sqlIndex < 0 || (inspectIndex >= 0 && inspectIndex < sqlIndex), `tools=${toolNames.join(",")}`);

  const protocolActions = extractSucceededProtocolActions(events);
  for (const required of evalCase.contract.requiredProtocolActions ?? []) {
    const count = protocolActions.filter((actionName) => actionName === required).length;
    assert(`protocol.${required}`, count >= 1, `succeeded=${count}`);
  }
  for (const forbidden of evalCase.contract.forbiddenProtocolActions ?? []) {
    const count = protocolActions.filter((actionName) => actionName === forbidden).length;
    assert(`protocol.forbidden.${forbidden}`, count === 0, `succeeded=${count}`, true);
  }

  const snapshotIds = extractSnapshotIds(events);
  const authoritativePinDrift = detectAuthoritativePinDrift(events);
  assert(
    "context.authoritative-pin-stable",
    !authoritativePinDrift,
    authoritativePinDrift ? "authoritative source hash changed within one run" : "authoritative source hashes stable",
    true,
  );
  if (evalCase.contract.requireSingleSnapshot) {
    assert("context.single-snapshot", snapshotIds.length === 1, `snapshot_ids=${snapshotIds.join(",") || "missing"}`, true);
    const resolvedWorkspaceId = extractResolvedWorkspaceId(events);
    assert("context.workspace", resolvedWorkspaceId === evalCase.workspaceId, `actual=${resolvedWorkspaceId || "missing"}`, true);
    const expectedProjectSnapshotPrefix = `project-analysis-snapshot:${evalCase.projectId}:`;
    assert(
      "context.project-snapshot",
      events.some((event) => JSON.stringify(event).includes(expectedProjectSnapshotPrefix)),
      `expected_prefix=${expectedProjectSnapshotPrefix}`,
      true,
    );
  }

  for (const [index, pattern] of (evalCase.contract.answerAllOf ?? []).entries()) {
    assert(`answer.all.${index + 1}`, regex(pattern).test(answer), `/${pattern}/`);
  }
  const anyPatterns = evalCase.contract.answerAnyOf ?? [];
  if (anyPatterns.length > 0) {
    assert("answer.any", anyPatterns.some((pattern) => regex(pattern).test(answer)), anyPatterns.map((pattern) => `/${pattern}/`).join(" OR "));
  }
  for (const [index, pattern] of (evalCase.contract.answerNoneOf ?? []).entries()) {
    assert(`answer.none.${index + 1}`, !regex(pattern).test(answer), `must not match /${pattern}/`, true);
  }
  for (const pattern of [
    "energy-scope-",
    "requirements? committed",
    "protocol completed",
    "validation completed",
    "adapter_missing",
    "SECRET_MASTER_KEY_REQUIRED",
    "ENERGYIQ_PROJECT_FORBIDDEN",
  ]) {
    assert(`answer.no-internal.${pattern}`, !regex(pattern).test(answer), `must not match /${pattern}/`, true);
  }

  if (evalCase.contract.chart) {
    const chart = extractChart(events);
    assert("chart.present", chart !== null, "backend chart artifact", true);
    assert("chart.type", chart?.chartType === evalCase.contract.chart.type, `actual=${chart?.chartType ?? "missing"}`, true);
    assert("chart.point-count", chart?.points.length === evalCase.contract.chart.pointCount, `actual=${chart?.points.length ?? 0}`, true);
    const sqlPointSets = extractSqlChartPointSets(events);
    assert(
      "chart.matches-sql",
      chart !== null && sqlPointSets.some((points) => chartPointsEqual(chart.points, points)),
      `chart_points=${chart?.points.length ?? 0}, sql_candidates=${sqlPointSets.length}`,
      true,
    );
  }

  const insightQuality = evalCase.contract.insightSignals
    ? scoreInsight(answer, evalCase.contract.insightSignals)
    : null;
  const decisionQuality = evalCase.contract.insightSignals
    ? scoreDecisionQuality(answer, evalCase.contract.insightSignals)
    : null;
  if (insightQuality !== null) {
    assert("insight.quality", insightQuality >= 7, `${insightQuality}/10`);
    const evidenceScore = scoreSignal(answer, evalCase.contract.insightSignals?.evidence ?? []);
    const verifyScore = scoreSignal(answer, evalCase.contract.insightSignals?.verify ?? []);
    assert("insight.evidence", evidenceScore > 0, `${evidenceScore}/2`, true);
    assert("insight.verify", verifyScore > 0, `${verifyScore}/2`);
  }

  const tokenTotals = events
    .filter((event) => stringValue(event.type) === "CUSTOM" && stringValue(event.name) === "token_usage")
    .reduce<{ input: number; output: number }>((total, event) => {
      const value = isRecord(event.value) ? event.value : {};
      return {
        input: total.input + numberValue(value.input_tokens ?? value.inputTokens),
        output: total.output + numberValue(value.output_tokens ?? value.outputTokens),
      };
    }, { input: 0, output: 0 });
  const steps = extractStepMetrics(events);
  const answerWordCount = countWords(answer);
  const openingWordCount = countWords(answerOpening(answer));
  const repeatedSqlCalls = countRepeatedSqlCalls(events);
  const hardFailure = assertions.some((entry) => !entry.passed && entry.hard);
  const correctnessAssertions = assertions.filter((entry) => isCorrectnessAssertion(entry.id));
  const passedCorrectnessAssertions = correctnessAssertions.filter((entry) => entry.passed).length;
  return {
    caseId: evalCase.id,
    title: evalCase.title,
    attempt,
    status: assertions.every((entry) => entry.passed) ? "passed" : "failed",
    hardFailure,
    answer,
    snapshotIds,
    assertions,
    steps,
    metrics: {
      elapsedMs: observation.elapsedMs,
      toolCalls: toolNames.length,
      failedToolCalls: failedTools.length,
      recoveredToolFailures,
      sqlCalls,
      sqlInvestigationPattern,
      reasoningRounds,
      inputTokens: tokenTotals.input,
      outputTokens: tokenTotals.output,
      maxPromptTokens: Math.max(0, ...steps.map((step) => step.promptTokens)),
      maxBudgetUtilization: maximumOptional(steps.map((step) => step.budgetUtilization)),
      contextCheckpointCount: events.filter((event) => (
        stringValue(event.type) === "CUSTOM" && stringValue(event.name) === "context.compiled"
      )).length,
      cacheTelemetrySteps: steps.filter((step) => step.cacheTelemetryAvailable).length,
      cacheHitTokens: sum(steps.map((step) => step.cacheHitTokens ?? 0)),
      cacheMissTokens: sum(steps.map((step) => step.cacheMissTokens ?? 0)),
      cacheHitRatio: cacheHitRatio(
        sum(steps.map((step) => step.cacheHitTokens ?? 0)),
        sum(steps.map((step) => step.cacheMissTokens ?? 0)),
      ),
      authoritativePinDrift,
      correctnessRatio: ratio(passedCorrectnessAssertions, correctnessAssertions.length),
      insightQuality,
      decisionQuality,
      answerWordCount,
      openingWordCount,
      repeatedSqlCalls,
    },
    ...(observation.runId ? { runId: observation.runId } : {}),
    ...(observation.threadId ? { threadId: observation.threadId } : {}),
  };
};

export const compareEnergyIqHarnessReports = (
  baseline: EnergyIqHarnessSuiteReport,
  candidate: EnergyIqHarnessSuiteReport,
) => ({
  passRateDelta: candidate.summary.passRate - baseline.summary.passRate,
  p50ElapsedMsDelta: candidate.summary.p50ElapsedMs - baseline.summary.p50ElapsedMs,
  p95ElapsedMsDelta: candidate.summary.p95ElapsedMs - baseline.summary.p95ElapsedMs,
  averageSqlCallsDelta: candidate.summary.averageSqlCalls - baseline.summary.averageSqlCalls,
  averageReasoningRoundsDelta: candidate.summary.averageReasoningRounds - baseline.summary.averageReasoningRounds,
  averageCorrectnessRatioDelta: candidate.summary.averageCorrectnessRatio - baseline.summary.averageCorrectnessRatio,
  averageInsightQualityDelta:
    candidate.summary.averageInsightQuality === null || baseline.summary.averageInsightQuality === null
      ? null
      : candidate.summary.averageInsightQuality - baseline.summary.averageInsightQuality,
  averageDecisionQualityRatioDelta: optionalMetricDelta(
    candidate.summary.averageDecisionQualityRatio,
    baseline.summary.averageDecisionQualityRatio,
  ),
  averageAnswerWordCountDelta: optionalMetricDelta(
    candidate.summary.averageAnswerWordCount,
    baseline.summary.averageAnswerWordCount,
  ),
  totalRepeatedSqlCallsDelta: optionalMetricDelta(
    candidate.summary.totalRepeatedSqlCalls,
    baseline.summary.totalRepeatedSqlCalls,
  ),
  hardFailureDelta: candidate.summary.hardFailures - baseline.summary.hardFailures,
  totalInputTokensDelta: candidate.summary.totalInputTokens - baseline.summary.totalInputTokens,
  totalOutputTokensDelta: candidate.summary.totalOutputTokens - baseline.summary.totalOutputTokens,
  maxPromptTokensDelta: candidate.summary.maxPromptTokens - baseline.summary.maxPromptTokens,
  maxBudgetUtilizationDelta:
    candidate.summary.maxBudgetUtilization === null || baseline.summary.maxBudgetUtilization === null
      ? null
      : candidate.summary.maxBudgetUtilization - baseline.summary.maxBudgetUtilization,
  cacheHitRatioDelta:
    candidate.summary.cacheHitRatio === null || baseline.summary.cacheHitRatio === null
      ? null
      : candidate.summary.cacheHitRatio - baseline.summary.cacheHitRatio,
});

export const evaluateEnergyIqSameSessionContinuity = (
  observations: EnergyIqHarnessContinuityTurnObservation[],
): EnergyIqHarnessContinuityReport => {
  const assertions: EnergyIqHarnessContinuityReport["assertions"] = [];
  const assert = (id: string, passed: boolean, detail: string, hard = true): void => {
    assertions.push({ id, passed, hard, detail });
  };
  const threadIds = [...new Set(observations.map((observation) => observation.threadId).filter(Boolean))] as string[];
  assert("continuity.three-turns", observations.length === 3, `turns=${observations.length}`);
  assert("continuity.same-thread", threadIds.length === 1, `thread_ids=${threadIds.join(",") || "missing"}`);

  const turns = observations.map((observation) => {
    const events = observation.events.filter(isRecord);
    const answer = extractFinalAnswer(events);
    const snapshotIds = extractSnapshotIds(events);
    const terminal = findLastEvent(events, (event) => (
      stringValue(event.type) === "RUN_FINISHED" || stringValue(event.type) === "RUN_ERROR"
    ));
    const toolCalls = events.filter((event) => stringValue(event.type) === "TOOL_CALL_START");
    const sqlCalls = toolCalls.filter((event) => stringValue(event.toolCallName) === "run_sql_readonly").length;
    const contextCheckpoints = events.filter((event) => (
      stringValue(event.type) === "CUSTOM" && stringValue(event.name) === "context.compiled"
    )).length;
    assert(
      `continuity.turn-${observation.turn}.finished`,
      stringValue(terminal?.type) === "RUN_FINISHED",
      `terminal=${stringValue(terminal?.type) || "missing"}`,
    );
    assert(
      `continuity.turn-${observation.turn}.answer`,
      answer.length > 0,
      `answer_chars=${answer.length}`,
    );
    assert(
      `continuity.turn-${observation.turn}.checkpoint`,
      contextCheckpoints > 0,
      `context_checkpoints=${contextCheckpoints}`,
    );
    assert(
      `continuity.turn-${observation.turn}.snapshot`,
      snapshotIds.length === 1,
      `snapshot_ids=${snapshotIds.join(",") || "missing"}`,
    );
    return {
      turn: observation.turn,
      question: observation.question,
      answer,
      elapsedMs: observation.elapsedMs,
      toolCalls: toolCalls.length,
      sqlCalls,
      contextCheckpoints,
      snapshotIds,
      steps: extractStepMetrics(events),
      ...(observation.runId ? { runId: observation.runId } : {}),
    };
  });
  const snapshotIds = [...new Set(turns.flatMap((turn) => turn.snapshotIds))].sort();
  assert(
    "continuity.snapshot-stable",
    snapshotIds.length === 1,
    `snapshot_ids=${snapshotIds.join(",") || "missing"}`,
  );
  assert(
    "continuity.authoritative-pins-stable",
    !detectAuthoritativePinDrift(observations.flatMap((observation) => observation.events.filter(isRecord))),
    "authoritative Context source hashes must remain stable across turns",
  );
  const evidenceAnswer = turns.find((turn) => turn.turn === 2)?.answer ?? "";
  assert(
    "continuity.evidence-follow-up",
    /\b(?:evidence|measured|calculated|observed|data|snapshot|period)\b/iu.test(evidenceAnswer),
    "turn 2 should explain supporting Evidence",
  );
  const actionAnswer = turns.find((turn) => turn.turn === 3)?.answer ?? "";
  assert(
    "continuity.action-follow-up",
    /\b(?:check|inspect|review|investigate|adjust|reduce|action)\b/iu.test(actionAnswer)
      && /\b(?:verify|validate|confirm|monitor|compare|recheck)\b/iu.test(actionAnswer),
    "turn 3 should state an action and how to verify it",
  );

  return {
    status: assertions.every((entry) => entry.passed) ? "passed" : "failed",
    threadId: threadIds.length === 1 ? threadIds[0] ?? null : null,
    snapshotIds,
    assertions,
    turns,
  };
};

const extractStepMetrics = (events: EventRecord[]): EnergyIqHarnessStepMetrics[] => {
  const steps = new Map<number, EnergyIqHarnessStepMetrics>();
  const ensureStep = (stepNumber: number): EnergyIqHarnessStepMetrics => {
    const existing = steps.get(stepNumber);
    if (existing) return existing;
    const created: EnergyIqHarnessStepMetrics = {
      stepNumber,
      promptTokens: 0,
      compiledPromptTokens: null,
      verifiedPromptTokens: null,
      remainingTokens: null,
      inputBudget: null,
      contextWindow: null,
      budgetUtilization: null,
      highWaterMark: null,
      capabilitySource: null,
      systemTokens: 0,
      toolTokens: 0,
      messageTokens: 0,
      selectedGroupIds: [],
      repeatedSelectedGroupIds: [],
      selectedGroupTokens: 0,
      omittedGroupTokens: 0,
      sourceHashCount: 0,
      authoritativeSourceHashes: {},
      artifactRefCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      toolNames: [],
      cacheTelemetryAvailable: false,
      cacheHitTokens: null,
      cacheMissTokens: null,
    };
    steps.set(stepNumber, created);
    return created;
  };

  let compiledFallbackStep = 0;
  let usageFallbackStep = 0;
  for (const event of events) {
    if (stringValue(event.type) !== "CUSTOM" || !isRecord(event.value)) continue;
    const value = event.value;
    if (stringValue(event.name) === "context.compiled") {
      compiledFallbackStep += 1;
      const stepNumber = optionalNumberValue(value.step_number) ?? compiledFallbackStep;
      const step = ensureStep(stepNumber);
      const budget = isRecord(value.budget) ? value.budget : {};
      const tokenReport = isRecord(value.token_report) ? value.token_report : {};
      step.promptTokens = optionalNumberValue(value.prompt_tokens)
        ?? optionalNumberValue(tokenReport.totalInputTokens)
        ?? 0;
      step.compiledPromptTokens = step.promptTokens;
      step.remainingTokens = optionalNumberValue(value.remaining_tokens)
        ?? optionalNumberValue(tokenReport.remainingTokens)
        ?? null;
      step.inputBudget = optionalNumberValue(value.budget_tokens)
        ?? optionalNumberValue(budget.inputBudget)
        ?? null;
      step.contextWindow = optionalNumberValue(budget.contextWindow) ?? null;
      step.budgetUtilization = optionalNumberValue(value.budget_utilization)
        ?? (step.inputBudget && step.inputBudget > 0 ? step.promptTokens / step.inputBudget : null);
      step.highWaterMark = nullableStringValue(value.high_water_mark);
      step.capabilitySource = nullableStringValue(budget.capabilitySource);
      step.systemTokens = optionalNumberValue(tokenReport.systemTokens) ?? 0;
      step.toolTokens = optionalNumberValue(tokenReport.toolTokens) ?? 0;
      step.messageTokens = optionalNumberValue(tokenReport.messageTokens) ?? 0;
      step.selectedGroupIds = Array.isArray(value.selected_group_ids)
        ? value.selected_group_ids.filter((groupId): groupId is string => typeof groupId === "string")
        : [];
      const groupCosts = Array.isArray(value.group_token_costs) ? value.group_token_costs.filter(isRecord) : [];
      step.selectedGroupTokens = sum(groupCosts
        .filter((group) => group.selected === true)
        .map((group) => optionalNumberValue(group.tokenCost) ?? 0));
      step.omittedGroupTokens = sum(groupCosts
        .filter((group) => group.selected !== true)
        .map((group) => optionalNumberValue(group.tokenCost) ?? 0));
      step.sourceHashCount = Array.isArray(value.source_snapshot_hashes) ? value.source_snapshot_hashes.length : 0;
      step.authoritativeSourceHashes = authoritativeSourceHashes(value.source_snapshot_hashes);
      step.artifactRefCount = Array.isArray(value.artifact_refs) ? value.artifact_refs.length : 0;
      continue;
    }
    if (stringValue(event.name) === "context.prompt-verified") {
      const stepNumber = optionalNumberValue(value.step_number) ?? Math.max(compiledFallbackStep, 1);
      const step = ensureStep(stepNumber);
      const verifiedPromptTokens = optionalNumberValue(value.prompt_tokens);
      step.verifiedPromptTokens = verifiedPromptTokens ?? null;
      step.promptTokens = Math.max(step.promptTokens, verifiedPromptTokens ?? 0);
      step.inputBudget = optionalNumberValue(value.input_budget ?? value.budget_tokens) ?? step.inputBudget;
      step.contextWindow = optionalNumberValue(value.context_window) ?? step.contextWindow;
      step.remainingTokens = optionalNumberValue(value.remaining_tokens) ?? step.remainingTokens;
      step.budgetUtilization = optionalNumberValue(value.budget_utilization) ?? step.budgetUtilization;
      step.highWaterMark = nullableStringValue(value.high_water_mark) ?? step.highWaterMark;
      step.capabilitySource = nullableStringValue(value.capability_source) ?? step.capabilitySource;
      continue;
    }
    if (stringValue(event.name) === "token_usage") {
      usageFallbackStep += 1;
      const stepNumber = optionalNumberValue(value.step_number) ?? usageFallbackStep;
      const step = ensureStep(stepNumber);
      step.inputTokens += optionalNumberValue(value.input_tokens ?? value.inputTokens) ?? 0;
      step.outputTokens += optionalNumberValue(value.output_tokens ?? value.outputTokens) ?? 0;
      const cacheAvailable = value.cache_telemetry_available === true
        || optionalNumberValue(value.cache_hit_tokens) !== undefined
        || optionalNumberValue(value.cache_miss_tokens) !== undefined;
      step.cacheTelemetryAvailable ||= cacheAvailable;
      const cacheHitTokens = optionalNumberValue(value.cache_hit_tokens);
      const cacheMissTokens = optionalNumberValue(value.cache_miss_tokens);
      if (cacheHitTokens !== undefined) step.cacheHitTokens = (step.cacheHitTokens ?? 0) + cacheHitTokens;
      if (cacheMissTokens !== undefined) step.cacheMissTokens = (step.cacheMissTokens ?? 0) + cacheMissTokens;
      const toolName = nullableStringValue(value.tool_name);
      if (toolName && !step.toolNames.includes(toolName)) step.toolNames.push(toolName);
    }
  }
  const seenGroups = new Set<string>();
  return [...steps.values()]
    .sort((left, right) => left.stepNumber - right.stepNumber)
    .map((step) => {
      step.repeatedSelectedGroupIds = step.selectedGroupIds.filter((groupId) => seenGroups.has(groupId));
      step.selectedGroupIds.forEach((groupId) => seenGroups.add(groupId));
      return step;
    });
};

const AUTHORITATIVE_CONTEXT_SOURCE_TYPES = new Set([
  "energy-query-context",
  "project-analysis-snapshot",
  "project-analysis-pack",
]);

const authoritativeSourceHashes = (value: unknown): Record<string, string> => Object.fromEntries(
  (Array.isArray(value) ? value : [])
    .filter(isRecord)
    .flatMap((entry) => {
      const sourceType = stringValue(entry.source_type);
      const contentHash = stringValue(entry.content_hash);
      return AUTHORITATIVE_CONTEXT_SOURCE_TYPES.has(sourceType) && contentHash
        ? [[sourceType, contentHash] as const]
        : [];
    }),
);

const detectAuthoritativePinDrift = (events: EventRecord[]): boolean => {
  const observed = new Map<string, string>();
  for (const event of events) {
    if (stringValue(event.type) !== "CUSTOM"
      || stringValue(event.name) !== "context.compiled"
      || !isRecord(event.value)) continue;
    for (const [sourceType, contentHash] of Object.entries(
      authoritativeSourceHashes(event.value.source_snapshot_hashes),
    )) {
      const previous = observed.get(sourceType);
      if (previous !== undefined && previous !== contentHash) return true;
      observed.set(sourceType, contentHash);
    }
  }
  return false;
};

const extractFinalAnswer = (events: EventRecord[]): string => {
  const messages = new Map<string, string>();
  for (const event of events) {
    if (!["TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_CHUNK"].includes(stringValue(event.type))
      || typeof event.delta !== "string") continue;
    const messageId = stringValue(event.messageId) || "unknown";
    messages.set(messageId, `${messages.get(messageId) ?? ""}${event.delta}`);
  }
  return [...messages.values()].at(-1)?.trim() ?? "";
};

const extractSucceededProtocolActions = (events: EventRecord[]): string[] => events.flatMap((event) => {
  if (stringValue(event.type) !== "CUSTOM" || stringValue(event.name) !== "protocol.action.succeeded") return [];
  if (!isRecord(event.value) || !isRecord(event.value.payload)) return [];
  const actionName = stringValue(event.value.payload.actionName);
  return actionName ? [actionName] : [];
});

const extractSnapshotIds = (events: EventRecord[]): string[] => [...new Set(events.flatMap((event) => (
  JSON.stringify(event).match(/energy-snapshot-[a-z0-9]+/giu) ?? []
)))].sort();

const extractResolvedWorkspaceId = (events: EventRecord[]): string => {
  const event = findLastEvent(events, (candidate) => (
    stringValue(candidate.type) === "CUSTOM" && stringValue(candidate.name) === "run.config.resolved"
  ));
  return isRecord(event?.value) ? stringValue(event.value.workspace_id) : "";
};

const countReasoningRounds = (events: EventRecord[]): number => {
  const reasoningEvents = events.filter((event) => (
    stringValue(event.type) === "REASONING_START"
    || stringValue(event.type) === "REASONING_MESSAGE_START"
  ));
  const identifiedRounds = new Set(reasoningEvents
    .map((event) => stringValue(event.messageId))
    .filter(Boolean));
  const anonymousStarts = reasoningEvents.filter((event) => (
    stringValue(event.type) === "REASONING_START"
    && !stringValue(event.messageId)
  )).length;
  const anonymousMessageStarts = reasoningEvents.some((event) => stringValue(event.type) === "REASONING_START")
    ? 0
    : reasoningEvents.filter((event) => !stringValue(event.messageId)).length;
  return identifiedRounds.size + anonymousStarts + anonymousMessageStarts;
};

type ChartPoint = { label: string; value: number };

const extractChart = (events: EventRecord[]): { chartType: string; points: ChartPoint[] } | null => {
  const event = events.find((entry) => (
    stringValue(entry.type) === "CUSTOM"
    && stringValue(entry.name) === "artifact"
    && isRecord(entry.value)
    && stringValue(entry.value.type) === "chart"
  ));
  if (!event || !isRecord(event.value)) return null;
  let preview: unknown = event.value.preview_json;
  if (typeof preview === "string") {
    try { preview = JSON.parse(preview); } catch { return null; }
  }
  if (!isRecord(preview)) return null;
  const directPoints = Array.isArray(preview.points) ? chartPoints(preview.points) : [];
  const firstSeries = Array.isArray(preview.series) && isRecord(preview.series[0]) ? preview.series[0] : null;
  const seriesPoints = firstSeries && Array.isArray(firstSeries.points) ? chartPoints(firstSeries.points) : [];
  return { chartType: stringValue(preview.chartType), points: directPoints.length > 0 ? directPoints : seriesPoints };
};

const extractSqlChartPointSets = (events: EventRecord[]): ChartPoint[][] => {
  const sqlCallIds = new Set(events
    .filter((event) => stringValue(event.type) === "TOOL_CALL_START" && stringValue(event.toolCallName) === "run_sql_readonly")
    .map((event) => stringValue(event.toolCallId))
    .filter(Boolean));
  const pointSets: ChartPoint[][] = [];
  for (const event of events) {
    if (stringValue(event.type) === "TOOL_CALL_RESULT") {
      const toolName = stringValue(event.toolCallName);
      const toolCallId = stringValue(event.toolCallId);
      if (toolName !== "run_sql_readonly" && !sqlCallIds.has(toolCallId)) continue;
      for (const candidate of eventPayloadCandidates(event)) {
        const points = tabularChartPoints(isRecord(candidate.result) ? candidate.result : candidate);
        if (points.length > 0) pointSets.push(points);
      }
      continue;
    }

    if (stringValue(event.type) !== "CUSTOM"
      || stringValue(event.name) !== "artifact"
      || !isRecord(event.value)
      || stringValue(event.value.type) !== "table"
      || !sqlCallIds.has(stringValue(event.value.tool_call_id))) continue;
    const points = tabularChartPoints(parseJsonRecord(event.value.preview_json));
    if (points.length > 0) pointSets.push(points);
  }
  return pointSets;
};

const tabularChartPoints = (payload: EventRecord | null): ChartPoint[] => {
  if (!payload || !Array.isArray(payload.columns) || payload.columns.length !== 2 || !Array.isArray(payload.rows)) return [];
  const points = payload.rows.flatMap((row) => {
    if (!Array.isArray(row) || row.length < 2) return [];
    const label = chartPointLabel(row[0]);
    const value = Number(row[1]);
    return label && Number.isFinite(value) ? [{ label, value }] : [];
  });
  return points.length === payload.rows.length && points.length > 0 ? points : [];
};

const parseJsonRecord = (value: unknown): EventRecord | null => {
  let parsed = value;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch { return null; }
  }
  return isRecord(parsed) ? parsed : null;
};

const eventPayloadCandidates = (event: EventRecord): EventRecord[] => [event.result, event.content, event.value]
  .flatMap((candidate) => {
    let parsed = candidate;
    if (typeof parsed === "string" && parsed.trim().startsWith("{")) {
      try { parsed = JSON.parse(parsed); } catch { return []; }
    }
    return isRecord(parsed) ? [parsed] : [];
  });

const chartPoints = (values: unknown[]): ChartPoint[] => values.flatMap((value) => {
  if (!isRecord(value)) return [];
  const label = chartPointLabel(value.label);
  const numericValue = Number(value.value);
  return label && Number.isFinite(numericValue) ? [{ label, value: numericValue }] : [];
});

const chartPointLabel = (value: unknown): string => value instanceof Date
  ? value.toISOString()
  : typeof value === "string" || typeof value === "number" ? String(value) : "";

const chartPointsEqual = (left: ChartPoint[], right: ChartPoint[]): boolean => left.length === right.length
  && left.every((point, index) => {
    const comparison = right[index];
    return comparison !== undefined
      && point.label === comparison.label
      && Math.abs(point.value - comparison.value) <= 1e-9;
  });

const scoreInsight = (
  answer: string,
  signals: NonNullable<EnergyIqHarnessEvalCase["contract"]["insightSignals"]>,
) => sum([
  scoreSignal(answer, signals.what),
  scoreSignal(answer, signals.evidence),
  scoreSignal(answer, signals.why),
  scoreSignal(answer, signals.action),
  scoreSignal(answer, signals.verify),
]);

const scoreDecisionQuality = (
  answer: string,
  signals: NonNullable<EnergyIqHarnessEvalCase["contract"]["insightSignals"]>,
): EnergyIqDecisionQualityBreakdown => {
  const opening = answerOpening(answer);
  const wordCount = countWords(answer);
  const openingWords = countWords(opening);
  const causalDiscipline = unsafeCausalClaim(answer)
    ? 0
    : /\b(?:hypothes(?:is|es)|cannot|can't|does not prove|not enough|uncertain|needs? (?:more )?evidence|verify|confirm)\b/iu.test(answer)
      ? 2
      : 1;
  const readability = wordCount <= 220 && openingWords <= 80
    ? 2
    : wordCount <= 350 && openingWords <= 140
      ? 1
      : 0;
  const consequence = signals.consequence ? scoreSignal(answer, signals.consequence) : 0;
  const dimensions = {
    takeaway: scoreSignal(opening, signals.what),
    evidenceUse: scoreSignal(answer, signals.evidence),
    decisionRelevance: scoreSignal(answer, signals.why),
    action: scoreSignal(answer, signals.action),
    verification: scoreSignal(answer, signals.verify),
    causalDiscipline,
    readability,
    consequence,
  };
  const maximum = 16;
  const total = sum(Object.values(dimensions));
  return { ...dimensions, total, maximum, ratio: ratio(total, maximum) };
};

const scoreSignal = (answer: string, patterns: string[]): number => Math.min(
  2,
  patterns.filter((pattern) => regex(pattern).test(answer)).length,
);

const answerOpening = (answer: string): string => {
  const sentences = answer.trim().split(/(?<=[.!?。！？])\s+/u).filter(Boolean);
  return sentences.slice(0, 2).join(" ") || answer.slice(0, 500);
};

const countWords = (value: string): number => {
  const latinWords = value.match(/[\p{Script=Latin}\p{N}]+(?:['’-][\p{Script=Latin}\p{N}]+)*/gu) ?? [];
  const cjkCharacters = value.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) ?? [];
  return latinWords.length + cjkCharacters.length;
};

const unsafeCausalClaim = (answer: string): boolean => /\b(?:definitely caused by|proves? that|certainly caused by|the root cause is)\b/iu.test(answer);

const countRepeatedSqlCalls = (events: EventRecord[]): number => {
  const sqlByCallId = new Map<string, { name: string; argsText: string; args: unknown }>();
  for (const event of events) {
    const callId = stringValue(event.toolCallId ?? event.tool_call_id);
    if (!callId) continue;
    const current = sqlByCallId.get(callId) ?? { name: "", argsText: "", args: undefined };
    current.name = stringValue(event.toolCallName ?? event.tool_call_name) || current.name;
    if (stringValue(event.type) === "TOOL_CALL_ARGS") current.argsText += stringValue(event.delta);
    if (event.args !== undefined) current.args = event.args;
    if (event.parameters !== undefined) current.args = event.parameters;
    sqlByCallId.set(callId, current);
  }
  const normalized = [...sqlByCallId.values()].flatMap((call) => {
    if (call.name !== "run_sql_readonly") return [];
    let args = call.args;
    if (!isRecord(args) && call.argsText.trim()) {
      try { args = JSON.parse(call.argsText); } catch { return []; }
    }
    if (!isRecord(args)) return [];
    const sql = stringValue(args.sql ?? args.query);
    if (!sql) return [];
    const canonical = sql
      .replace(/\/\*[\s\S]*?\*\//gu, " ")
      .replace(/--[^\r\n]*/gu, " ")
      .replace(/\s+/gu, " ")
      .trim()
      .replace(/;+$/gu, "")
      .trim()
      .toLowerCase();
    return canonical ? [canonical] : [];
  });
  return normalized.length - new Set(normalized).size;
};

const classifySqlInvestigationPattern = (
  sqlCalls: number,
  failedSqlCalls: number,
): EnergyIqSqlInvestigationPattern => {
  if (sqlCalls === 0) return "none";
  if (failedSqlCalls >= 2) return "recovery-heavy";
  if (sqlCalls > 4) return "extended";
  return "focused";
};

const toolResultFailed = (event: EventRecord): boolean => {
  const candidates = [event.result, event.content, event.value];
  for (const candidate of candidates) {
    let parsed = candidate;
    if (typeof parsed === "string" && parsed.trim().startsWith("{")) {
      try { parsed = JSON.parse(parsed); } catch { continue; }
    }
    if (!isRecord(parsed)) continue;
    if (parsed.success === false || parsed.ok === false || parsed.isError === true) return true;
    if (typeof parsed.error === "string" && parsed.error.length > 0) return true;
  }
  return false;
};

const regex = (pattern: string): RegExp => new RegExp(pattern, "iu");
const isCorrectnessAssertion = (id: string): boolean => [
  "answer.all.",
  "answer.any",
  "answer.none.",
  "chart.",
  "insight.",
].some((prefix) => id.startsWith(prefix));
const findLastEvent = (
  events: EventRecord[],
  predicate: (event: EventRecord) => boolean,
): EventRecord | undefined => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event && predicate(event)) return event;
  }
  return undefined;
};
const isRecord = (value: unknown): value is EventRecord => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const stringValue = (value: unknown): string => typeof value === "string" ? value : "";
const nullableStringValue = (value: unknown): string | null => typeof value === "string" ? value : null;
const numberValue = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
const optionalNumberValue = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return value !== null && value !== undefined && Number.isFinite(parsed) ? parsed : undefined;
};
const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);
const average = (values: number[]): number => values.length > 0 ? sum(values) / values.length : 0;
const maximumOptional = (values: Array<number | null>): number | null => {
  const present = values.filter((value): value is number => value !== null);
  return present.length > 0 ? Math.max(...present) : null;
};
const optionalMetricDelta = (candidate: unknown, baseline: unknown): number | null => (
  typeof candidate === "number" && Number.isFinite(candidate)
  && typeof baseline === "number" && Number.isFinite(baseline)
    ? candidate - baseline
    : null
);
const cacheHitRatio = (hitTokens: number, missTokens: number): number | null => {
  const total = hitTokens + missTokens;
  return total > 0 ? hitTokens / total : null;
};
const ratio = (numerator: number, denominator: number): number => denominator > 0 ? numerator / denominator : 0;
const percentile = (sortedValues: number[], fraction: number): number => {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.ceil(sortedValues.length * fraction) - 1);
  return sortedValues[index] ?? 0;
};
