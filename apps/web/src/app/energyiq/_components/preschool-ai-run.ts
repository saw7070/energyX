import type {
  EnergyOverviewAiArtifactDto,
  EnergyProjectAnalysisSnapshotDto,
  PreschoolOverviewAiReadModelDto,
  PreschoolDecisionSignalsDto,
} from "../../../lib/config-api";
import { configApi } from "../../../lib/config-api";
import { parseSchemaToolResult, parseSqlToolResult, sqlFromToolPayload } from "../../data-tasks/tool-result-normalize";
import {
  buildPreschoolDiscoveryEvidenceBundle,
  type PreschoolDiscoveryEvidenceBundleV1,
  type PreschoolDiscoveryEvidenceItem,
} from "./preschool-ai-discovery-evidence";
import {
  buildPreschoolOverviewCoverage,
  type PreschoolOverviewCoverageV1,
} from "./preschool-ai-coverage";
import {
  aiFindingPresentationEvidenceText,
  filterAiFindingPresentationEvidence,
  parseAiFindingPresentation,
  type AiFindingPresentation,
} from "./ai-finding-presentation";
import {
  PRESCHOOL_AI_ACCEPTED_CONTRACT_REVISION,
  PRESCHOOL_AI_EDITOR_PROMPT_REVISION,
  PRESCHOOL_AI_INVESTIGATOR_PROMPT_REVISION,
  PRESCHOOL_AI_METHOD_SKILL_ID,
  PRESCHOOL_AI_METHOD_SKILL_REVISION,
  PRESCHOOL_AI_WORKFLOW_REVISION,
  selectPreschoolAiSectionInterpretation,
  type PreschoolAiAcceptedArtifact,
  type PreschoolAiEpistemicLevel,
} from "./preschool-ai-artifact";

export type PreschoolAiProgress = "queued" | "inspecting" | "querying" | "validating" | "drafting";
export type PreschoolAiRelationship = "supports" | "challenges" | "independent";
export type PreschoolAiWhyKind = "Evidence" | "Hypothesis" | "Missing Evidence";
export type PreschoolAiSectionId =
  | PreschoolDecisionSignalsDto["items"][number]["sectionId"]
  | "standby-wastage"
  | "page-synthesis";

export type PreschoolAiToolEvidence = {
  evidenceIndex: number;
  toolCallId: string;
  sql: string | null;
  rowCount: number | null;
  auditLogId: string | null;
  elapsedMs: number | null;
  resultPreview: string;
};

export type PreschoolAiFinding = {
  id: string;
  sectionId: PreschoolAiSectionId;
  signalRefs: string[];
  relationship: PreschoolAiRelationship;
  title: string;
  what: string;
  why: { kind: PreschoolAiWhyKind; text: string };
  how: string;
  expectedIfAct: string;
  ifIgnored: string;
  howToVerify: string;
  evidenceNote: string;
  presentation?: AiFindingPresentation;
  evidence: {
    snapshotId: string;
    period: { from: string; to: string };
    deterministic: PreschoolDiscoveryEvidenceItem[];
    tools: PreschoolAiToolEvidence[];
  };
};

export type PreschoolAiLegacyRunResult = {
  status: "available";
  providerProfileId: string;
  runId: string;
  packId: "preschool-analysis-pack";
  packRevision: "v1";
  findings: PreschoolAiFinding[];
} | {
  status: "unavailable";
  reason: string;
};

export type PreschoolAiSectionedRunResult = PreschoolOverviewAiReadModelDto;

export type PreschoolAiRunResult = PreschoolAiAcceptedArtifact | PreschoolAiSectionedRunResult | Extract<PreschoolAiLegacyRunResult, { status: "available" }> | {
  status: "unavailable";
  reason: string;
  retryable?: boolean;
};

export type PreschoolAiValidationIssue = {
  code: "unsupported_claim";
  findingIndex: number;
  field: "title" | "what" | "why" | "how" | "expectedIfAct" | "ifIgnored" | "howToVerify" | "evidenceNote" | "presentation";
};

type PreschoolAiDecisionSignals = {
  contract: PreschoolDecisionSignalsDto["contract"];
  items: Array<{
    id: PreschoolDecisionSignalsDto["items"][number]["id"];
    sectionId: PreschoolDecisionSignalsDto["items"][number]["sectionId"];
    priority: number;
    label: string;
    metrics: Array<Pick<PreschoolDecisionSignalsDto["items"][number]["metrics"][number], "id" | "label" | "metricId" | "value" | "unit" | "role">>;
    centreCodes: string[];
    limitations: string[];
  }>;
};

export type PreschoolAiArtifactReadInput = {
  identityKey: string;
  projectId: "preschool-demo";
  projectName: string;
  scopeId: string;
  scopeName: string;
  resource: "electricity";
  timezone: string;
  snapshotId: string;
  projectReleaseId: string;
  analysisFrom: string;
  analysisTo: string;
  analysisPeriod: { from: string; to: string };
};

export type PreschoolAiRunInput = PreschoolAiArtifactReadInput & {
  decisionSignals: PreschoolAiDecisionSignals;
  discoveryEvidence: PreschoolDiscoveryEvidenceBundleV1;
  coverage: PreschoolOverviewCoverageV1;
};

type AgUiEvent = Record<string, unknown> & { type?: string };
type ToolAccumulator = {
  id: string;
  name: string;
  args: Record<string, unknown> | null;
  argsText: string;
  result: unknown;
};
type CollectedSqlEvidence = Omit<PreschoolAiToolEvidence, "evidenceIndex"> & {
  columns: string[];
  rows: unknown[];
  numericEvidence: SqlNumericEvidenceCell[];
  normalizedSql: string | null;
  returnedRowCount: number;
};
type SqlDimensionEvidence = { column: string | null; value: string };
type SqlNumericEvidenceCell = {
  column: string | null;
  row: number;
  value: number;
  dimensions: SqlDimensionEvidence[];
};
type ProgressCallback = (progress: PreschoolAiProgress) => void;
type CurrentRun = {
  promise: Promise<PreschoolAiRunResult>;
  progress: PreschoolAiProgress;
  listeners: Set<ProgressCallback>;
  settled: boolean;
};

const currentRuns = new Map<string, CurrentRun>();
const FRIENDLY_UNAVAILABLE = "AI analysis is temporarily unavailable. The verified Overview remains available.";
const PRESCHOOL_AI_PACK_ID = "preschool-analysis-pack" as const;
const PRESCHOOL_AI_PACK_REVISION = "v1" as const;
const PRESCHOOL_AI_OUTPUT_CONTRACT_REVISION = "v13";
const SHARED_ARTIFACT_POLL_MS = 1_000;
const SHARED_ARTIFACT_WAIT_TIMEOUT_MS = 13 * 60 * 1_000;

export function resetPreschoolAiRunsForTests(): void {
  currentRuns.clear();
}

export function buildPreschoolAiArtifactReadInput(
  snapshot: EnergyProjectAnalysisSnapshotDto,
): PreschoolAiArtifactReadInput | null {
  if (
    snapshot.renderer.key !== "preschool-overview"
    || snapshot.context.projectId !== "preschool-demo"
    || snapshot.context.resource !== "electricity"
  ) return null;
  const analysisPeriod = {
    from: snapshot.context.primaryPeriod.start,
    to: snapshot.context.primaryPeriod.endExclusive,
  };
  const analysisFrom = localDate(new Date(analysisPeriod.from), snapshot.context.timezone);
  const analysisTo = localDate(new Date(Date.parse(analysisPeriod.to) - 1), snapshot.context.timezone);
  const identityKey = [
    snapshot.context.userId,
    snapshot.context.workspaceId,
    snapshot.context.projectId,
    snapshot.context.scopeId,
    snapshot.context.resource,
    snapshot.dataSnapshot.id,
    snapshot.projectRelease.id,
    snapshot.renderer.key,
    snapshot.renderer.version,
    snapshot.context.hierarchyRevisionId,
    snapshot.context.meterMappingRevisionId,
    snapshot.context.meterFormulaRevisionId,
    snapshot.context.metricVersion,
    snapshot.context.businessCalendarVersion,
    snapshot.context.tariffScheduleVersion,
    `${PRESCHOOL_AI_PACK_ID}@${PRESCHOOL_AI_PACK_REVISION}`,
    `preschool-ai-output-contract@${PRESCHOOL_AI_OUTPUT_CONTRACT_REVISION}`,
    `preschool-ai-workflow@${PRESCHOOL_AI_WORKFLOW_REVISION}`,
    `investigator-prompt@${PRESCHOOL_AI_INVESTIGATOR_PROMPT_REVISION}`,
    `editor-prompt@${PRESCHOOL_AI_EDITOR_PROMPT_REVISION}`,
    `method-skill@${PRESCHOOL_AI_METHOD_SKILL_ID}@${PRESCHOOL_AI_METHOD_SKILL_REVISION}`,
    analysisFrom,
    analysisTo,
  ].join(":");
  return {
    identityKey,
    projectId: "preschool-demo",
    projectName: snapshot.context.projectName,
    scopeId: snapshot.context.scopeId,
    scopeName: snapshot.context.scopeName,
    resource: "electricity",
    timezone: snapshot.context.timezone,
    snapshotId: snapshot.dataSnapshot.id,
    projectReleaseId: snapshot.projectRelease.id,
    analysisFrom,
    analysisTo,
    analysisPeriod,
  };
}

export function buildPreschoolAiRunInput(
  snapshot: EnergyProjectAnalysisSnapshotDto,
): PreschoolAiRunInput | null {
  const readInput = buildPreschoolAiArtifactReadInput(snapshot);
  const discoveryEvidence = buildPreschoolDiscoveryEvidenceBundle(snapshot);
  const coverage = buildPreschoolOverviewCoverage(snapshot);
  const decisionSignals = snapshot.preschoolDecisionSignals;
  if (
    !readInput
    || !discoveryEvidence
    || !coverage
    || !decisionSignals
    || decisionSignals.status !== "available"
    || decisionSignals.context.dataSnapshotId !== snapshot.dataSnapshot.id
    || decisionSignals.context.projectReleaseId !== snapshot.projectRelease.id
  ) return null;
  return {
    ...readInput,
    decisionSignals: compactDecisionSignals(decisionSignals),
    discoveryEvidence,
    coverage,
  };
}

function compactDecisionSignals(signals: PreschoolDecisionSignalsDto): PreschoolAiDecisionSignals {
  return {
    contract: signals.contract,
    items: signals.items.map((signal) => ({
      id: signal.id,
      sectionId: signal.sectionId,
      priority: signal.priority,
      label: signal.label,
      metrics: signal.metrics.map(({ id, label, metricId, value, unit, role }) => ({ id, label, metricId, value, unit, role })),
      centreCodes: signal.entities.map((entity) => entity.code),
      limitations: signal.limitations.map((limitation) => limitation.label),
    })),
  };
}

export function getOrStartPreschoolAiRun(
  input: PreschoolAiArtifactReadInput,
  onProgress?: ProgressCallback,
): Promise<PreschoolAiRunResult> {
  const existing = currentRuns.get(input.identityKey);
  if (existing) {
    onProgress?.(existing.progress);
    if (onProgress && !existing.settled) existing.listeners.add(onProgress);
    return existing.promise;
  }
  const listeners = new Set<ProgressCallback>();
  if (onProgress) listeners.add(onProgress);
  const run: CurrentRun = {
    promise: Promise.resolve({ status: "unavailable", reason: "The AI Analyst did not start." }),
    progress: "queued",
    listeners,
    settled: false,
  };
  const report = (progress: PreschoolAiProgress) => {
    if (run.progress === progress) return;
    run.progress = progress;
    for (const listener of run.listeners) listener(progress);
  };
  run.promise = restoreOrExecutePreschoolAiRun(input, report)
    .catch((error: unknown) => ({
      status: "unavailable" as const,
      reason: friendlyReason(error instanceof Error ? error.message : "AI Analyst unavailable."),
    }))
    .then((result) => {
      if (isRefreshableUnavailable(result) && currentRuns.get(input.identityKey) === run) {
        currentRuns.delete(input.identityKey);
      }
      return result;
    })
    .finally(() => {
      run.settled = true;
      run.listeners.clear();
    });
  currentRuns.set(input.identityKey, run);
  return run.promise;
}

async function restoreOrExecutePreschoolAiRun(
  input: PreschoolAiArtifactReadInput,
  onProgress?: ProgressCallback,
): Promise<PreschoolAiRunResult> {
  onProgress?.("inspecting");
  const pin = overviewAiArtifactPin(input);
  const artifact = await configApi.getEnergyOverviewAiArtifact(input.projectId, input.scopeId, pin);
  if (artifact.status === "missing") return { status: "unavailable", reason: FRIENDLY_UNAVAILABLE };
  if (artifact.status === "available") {
    const shared = acceptedSharedPreschoolAiArtifact(input, artifact);
    if (!shared) return { status: "unavailable", reason: FRIENDLY_UNAVAILABLE };
    if (isPendingPreschoolSectionedReadModel(shared)) {
      return waitForSharedPreschoolAiArtifact(input, onProgress);
    }
    onProgress?.("validating");
    onProgress?.("drafting");
    return shared;
  }
  if (artifact.status === "failed") return {
    status: "unavailable",
    reason: FRIENDLY_UNAVAILABLE,
    retryable: (artifact.attemptCount ?? 0) < 2,
  };
  return waitForSharedPreschoolAiArtifact(input, onProgress);
}

export async function retryPreschoolAiRun(
  input: PreschoolAiArtifactReadInput,
  onProgress?: ProgressCallback,
  targetId?: "centre-benchmark" | "standby-wastage" | "operating-behaviour" | "planning-outlook" | "executive-synthesis",
): Promise<PreschoolAiRunResult> {
  onProgress?.("inspecting");
  const artifact = targetId
    ? await configApi.retryEnergyOverviewAiArtifact(
        input.projectId,
        input.scopeId,
        overviewAiArtifactPin(input),
        targetId,
      )
    : await configApi.retryEnergyOverviewAiArtifact(
        input.projectId,
        input.scopeId,
        overviewAiArtifactPin(input),
      );
  const accepted = acceptedSharedPreschoolAiArtifact(input, artifact);
  if (accepted) {
    if (isPendingPreschoolSectionedReadModel(accepted)) {
      return cacheSettledPreschoolAiRun(
        input.identityKey,
        await waitForSharedPreschoolAiArtifact(input, onProgress),
      );
    }
    onProgress?.("validating");
    onProgress?.("drafting");
    return cacheSettledPreschoolAiRun(input.identityKey, accepted);
  }
  if (artifact.status === "failed") return cacheSettledPreschoolAiRun(input.identityKey, {
    status: "unavailable",
    reason: FRIENDLY_UNAVAILABLE,
    retryable: (artifact.attemptCount ?? 0) < 2,
  });
  return cacheSettledPreschoolAiRun(
    input.identityKey,
    await waitForSharedPreschoolAiArtifact(input, onProgress),
  );
}

export function invalidatePreschoolAiRun(input: PreschoolAiArtifactReadInput | null): void {
  if (input) currentRuns.delete(input.identityKey);
}

function cacheSettledPreschoolAiRun(identityKey: string, result: PreschoolAiRunResult): PreschoolAiRunResult {
  if (isRefreshableUnavailable(result)) {
    currentRuns.delete(identityKey);
    return result;
  }
  currentRuns.set(identityKey, {
    promise: Promise.resolve(result),
    progress: result.status === "available" ? "drafting" : "inspecting",
    listeners: new Set(),
    settled: true,
  });
  return result;
}

const isRefreshableUnavailable = (
  result: PreschoolAiRunResult,
): result is Extract<PreschoolAiRunResult, { status: "unavailable" }> & { retryable: true } =>
  result.status === "unavailable" && result.retryable === true;

function acceptedSharedPreschoolAiArtifact(
  input: PreschoolAiArtifactReadInput,
  artifact: EnergyOverviewAiArtifactDto,
): Extract<PreschoolAiRunResult, { status: "available" }> | null {
  if (artifact.status !== "available"
    || artifact.dataSnapshotId !== input.snapshotId
    || artifact.projectReleaseId !== input.projectReleaseId
    || !artifact.result) return null;
  if (isExactPreschoolSectionedReadModel(artifact.result, input)) return artifact.result;
  if (!isPreschoolAiRunInput(input)) return null;
  const exact = selectPreschoolAiSectionInterpretation(artifact.result, input.coverage.binding, "preschool.overall-key-findings");
  return exact.status === "available"
    ? artifact.result as unknown as PreschoolAiAcceptedArtifact
    : null;
}

function isPreschoolAiRunInput(input: PreschoolAiArtifactReadInput): input is PreschoolAiRunInput {
  return "coverage" in input
    && "decisionSignals" in input
    && "discoveryEvidence" in input;
}

async function waitForSharedPreschoolAiArtifact(
  input: PreschoolAiArtifactReadInput,
  onProgress?: ProgressCallback,
): Promise<PreschoolAiRunResult> {
  const deadline = Date.now() + SHARED_ARTIFACT_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const artifact = await configApi.getEnergyOverviewAiArtifact(
      input.projectId,
      input.scopeId,
      overviewAiArtifactPin(input),
    );
    const accepted = acceptedSharedPreschoolAiArtifact(input, artifact);
    if (accepted && !isPendingPreschoolSectionedReadModel(accepted)) {
      onProgress?.("validating");
      onProgress?.("drafting");
      return accepted;
    }
    if (!accepted && (artifact.status === "available" || artifact.status === "failed")) {
      return {
        status: "unavailable",
        reason: FRIENDLY_UNAVAILABLE,
        ...(artifact.status === "failed" ? { retryable: (artifact.attemptCount ?? 0) < 2 } : {}),
      };
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(SHARED_ARTIFACT_POLL_MS, remaining)));
  }
  return { status: "unavailable", reason: FRIENDLY_UNAVAILABLE, retryable: true };
}

function overviewAiArtifactPin(input: PreschoolAiArtifactReadInput): {
  from: string;
  to: string;
  dataSnapshotId: string;
  projectReleaseId: string;
} {
  return {
    from: input.analysisFrom,
    to: input.analysisTo,
    dataSnapshotId: input.snapshotId,
    projectReleaseId: input.projectReleaseId,
  };
}

type PreschoolAiEventStreamInput = {
  eventStream: string;
  input: PreschoolAiRunInput;
  providerProfileId: string;
  runId: string;
};

const isExactPreschoolSectionedReadModel = (
  value: EnergyOverviewAiArtifactDto["result"],
  input: PreschoolAiArtifactReadInput,
): value is PreschoolOverviewAiReadModelDto => {
  if (!value || value.artifactKind !== "preschool-overview-ai-read-model") return false;
  const candidate = value as PreschoolOverviewAiReadModelDto;
  return candidate.status === "available"
    && candidate.binding.projectId === input.projectId
    && candidate.binding.scopeId === input.scopeId
    && candidate.binding.dataSnapshotId === input.snapshotId
    && candidate.binding.projectReleaseId === input.projectReleaseId
    && candidate.binding.analysisPeriod.from === input.analysisPeriod.from
    && candidate.binding.analysisPeriod.to === input.analysisPeriod.to;
};

export const isPendingPreschoolSectionedReadModel = (
  value: Extract<PreschoolAiRunResult, { status: "available" }>,
): value is PreschoolAiSectionedRunResult => isExactSectionedResultShape(value)
  && [
    ...Object.values(value.sections),
    value.executive,
  ].some((unit) => unit.status === "queued" || unit.status === "running");

const isExactSectionedResultShape = (
  value: Extract<PreschoolAiRunResult, { status: "available" }>,
): value is PreschoolAiSectionedRunResult => "artifactKind" in value
  && value.artifactKind === "preschool-overview-ai-read-model";

export function resolvePreschoolAiEventStream(args: PreschoolAiEventStreamInput): PreschoolAiLegacyRunResult {
  return validatePreschoolAiEventStream(args).result;
}

export function validatePreschoolAiEventStream(args: PreschoolAiEventStreamInput): {
  result: PreschoolAiLegacyRunResult;
  issues: PreschoolAiValidationIssue[];
} {
  const issues: PreschoolAiValidationIssue[] = [];
  return { result: resolvePreschoolAiEventStreamInternal(args, issues), issues };
}

function resolvePreschoolAiEventStreamInternal(
  args: PreschoolAiEventStreamInput,
  validationIssues: PreschoolAiValidationIssue[],
): PreschoolAiLegacyRunResult {
  const events = parseEventStream(args.eventStream);
  const runError = events.findLast((event) => event.type === "RUN_ERROR");
  if (runError) return { status: "unavailable", reason: friendlyReason(stringValue(runError.message) ?? "AI Analyst Run failed.") };
  if (!events.some((event) => event.type === "RUN_FINISHED")) return { status: "unavailable", reason: "The AI Analyst Run did not finish." };
  const collected = collectTools(events);
  if (!collected.schemaValid || collected.sql.length < 1) {
    return { status: "unavailable", reason: "The AI Analyst did not complete a grounded read-only SQL investigation." };
  }
  if (!discoveryMatchesInput(args.input)) return { status: "unavailable", reason: "The Preschool Discovery Evidence does not match this Run identity." };
  const answer = events.filter((event) => event.type === "TEXT_MESSAGE_CONTENT")
    .map((event) => stringValue(event.delta) ?? "").join("").trim();
  const generated = parseFindings(answer);
  if (!generated) return { status: "unavailable", reason: "The AI response could not be verified against this Snapshot." };
  const evidenceById = new Map(args.input.discoveryEvidence.items.map((item) => [item.id, item]));
  const signalById = new Map<string, PreschoolAiDecisionSignals["items"][number]>(
    args.input.decisionSignals.items.map((signal) => [signal.id, signal]),
  );
  let missingSnapshotEvidence = false;
  let missingSqlEvidence = false;
  const referenceValidFindings = generated.flatMap((finding, findingIndex) => {
    const signals = finding.signalRefs.map((id) => signalById.get(id)).filter(Boolean);
    if (signals.length !== finding.signalRefs.length) return [];
    const evidence = finding.evidenceRefs
      .map((id) => evidenceById.get(id)).filter((item): item is PreschoolDiscoveryEvidenceItem => Boolean(item));
    if (evidence.length !== finding.evidenceRefs.length) {
      missingSnapshotEvidence = true;
      return [];
    }
    const tools = finding.evidenceSqlIndexes
      .map((index) => collected.sql[index - 1]).filter((tool): tool is CollectedSqlEvidence => Boolean(tool));
    if (tools.length !== finding.evidenceSqlIndexes.length) {
      missingSqlEvidence = true;
      return [];
    }
    return [{ finding, evidence, tools, findingIndex }];
  });
  if (generated.length > 0 && referenceValidFindings.length === 0) {
    return missingSnapshotEvidence
      ? { status: "unavailable", reason: "A Preschool Finding cited Evidence that is not present in this Snapshot." }
      : { status: "unavailable", reason: missingSqlEvidence
        ? "A Preschool Finding cited SQL Evidence that is not present in this Run."
        : "The AI Analyst returned no Finding with current Snapshot Evidence." };
  }
  let oversizedSqlEvidence = false;
  const verifiedFindings = referenceValidFindings.flatMap(({ finding, evidence, tools, findingIndex }) => {
    const repaired = repairFindingEvidenceBindings(finding, evidence, tools, collected.sql, args.input);
    const repairedTools = repaired.evidenceSqlIndexes
      .map((index) => collected.sql[index - 1]).filter((tool): tool is CollectedSqlEvidence => Boolean(tool));
    if (repairedTools.some(isOversizedSqlEvidence)) {
      oversizedSqlEvidence = true;
      return [];
    }
    return [{ finding: repaired, findingIndex }];
  });
  if (generated.length > 0 && verifiedFindings.length === 0 && oversizedSqlEvidence) {
    return { status: "unavailable", reason: "The AI Analyst exceeded the ten-row SQL Evidence limit." };
  }
  const selectedEvidence = verifiedFindings.map(({ finding }) => finding.evidenceRefs
    .map((id) => evidenceById.get(id)).filter((item): item is PreschoolDiscoveryEvidenceItem => Boolean(item)));
  const selectedTools = verifiedFindings.map(({ finding }) => finding.evidenceSqlIndexes
    .map((index) => collected.sql[index - 1]).filter((tool): tool is CollectedSqlEvidence => Boolean(tool)));
  for (const { finding } of verifiedFindings) {
    const presentation = materializePreschoolPresentation(finding, evidenceById, collected.sql, args.input);
    if (presentation) finding.presentation = presentation;
    else delete finding.presentation;
  }
  const displayable = verifiedFindings.flatMap(({ finding, findingIndex }, index) => {
    const unsupportedFields = unsupportedFindingFields(
      finding,
      selectedEvidence[index]!,
      selectedTools[index]!,
      args.input,
    );
    validationIssues.push(...unsupportedFields.map((field) => ({
      code: "unsupported_claim" as const,
      findingIndex,
      field,
    })));
    const canonical = canonicalizeFindingNarrative(
      finding,
      unsupportedFields,
      selectedEvidence[index]!,
      selectedTools[index]!,
      args.input,
    );
    if (canonical && !canonical.presentation) {
      const projected = derivePreschoolEvidencePresentation(canonical, collected.sql);
      if (projected) canonical.presentation = projected;
    }
    return canonical ? [{
      finding: canonical,
      evidence: selectedEvidence[index]!,
      tools: selectedTools[index]!,
    }] : [];
  });
  if (verifiedFindings.length > 0 && displayable.length === 0) {
    return { status: "unavailable", reason: "The AI Analyst returned a numeric claim without Finding-specific Evidence." };
  }
  return {
    status: "available",
    providerProfileId: args.providerProfileId,
    runId: args.runId,
    packId: "preschool-analysis-pack",
    packRevision: "v1",
    findings: displayable.map(({ finding, evidence, tools }, index) => ({
      id: `preschool-ai-finding-${index + 1}`,
      sectionId: finding.sectionId,
      signalRefs: finding.signalRefs,
      relationship: finding.relationship,
      title: finding.title,
      what: finding.what,
      why: { kind: finding.whyKind, text: finding.why },
      how: finding.how,
      expectedIfAct: finding.expectedIfAct,
      ifIgnored: finding.ifIgnored,
      howToVerify: finding.howToVerify,
      evidenceNote: finding.evidenceNote,
      ...(finding.presentation ? { presentation: finding.presentation } : {}),
      evidence: {
        snapshotId: args.input.snapshotId,
        period: { from: args.input.analysisFrom, to: args.input.analysisTo },
        deterministic: evidence,
        tools: tools.map(({
          columns: _,
          rows: __,
          numericEvidence: ___,
          normalizedSql: ____,
          returnedRowCount: _____,
          ...tool
        }, toolIndex) => ({
          evidenceIndex: finding.evidenceSqlIndexes[toolIndex]!,
          ...tool,
        })),
      },
    })),
  };
}

function isOversizedSqlEvidence(tool: CollectedSqlEvidence): boolean {
  return Math.max(tool.rowCount ?? 0, tool.returnedRowCount) > 10;
}

function repairFindingEvidenceBindings(
  finding: GeneratedFinding,
  evidence: PreschoolDiscoveryEvidenceItem[],
  selectedTools: CollectedSqlEvidence[],
  allTools: CollectedSqlEvidence[],
  input: PreschoolAiRunInput,
): GeneratedFinding {
  if (!unsupportedNumber(finding, evidence, selectedTools, input)) return finding;
  const fallbackCentreReference = findingCentreReference(finding);
  const narrative = removeAllowedStructuralReferences(
    [finding.title, finding.what, finding.why, finding.how, finding.expectedIfAct,
      finding.ifIgnored, finding.howToVerify, removeCitedSqlReturnedRowReferences(finding.evidenceNote, selectedTools),
      aiFindingPresentationEvidenceText(finding.presentation)].join("\n"),
    input,
    finding.evidenceSqlIndexes,
  );
  const evidenceNarrative = removeCitedSqlPredicateReferences(narrative, selectedTools);
  const deterministicValues = evidence.flatMap((item) => collectTypedNumericEvidence(item.values)
    .map((cell) => ({ item, cell })));
  const selectedValues = selectedTools.flatMap((tool) => tool.numericEvidence);
  const unsupportedClaims = numericTokens(evidenceNarrative).filter((claim) => {
    if (deterministicValues.some(({ item, cell }) => numericMatches(claim, cell.value)
      && deterministicCellSupportsClaim(item, cell, claim.context, claim.entityContext, fallbackCentreReference))) return false;
    return !selectedValues.some((cell) => numericMatches(claim, cell.value)
      && sqlCellSupportsClaim(cell, claim.context, claim.entityContext, fallbackCentreReference));
  });
  if (unsupportedClaims.length === 0) return finding;
  const indexes = new Set(finding.evidenceSqlIndexes);
  const evidenceRefs = new Set(finding.evidenceRefs);
  for (const claim of unsupportedClaims) {
    // Do not turn dates, ids, or an uncited "Evidence index N" phrase into an
    // Evidence binding. Automatic repair is restricted to typed business facts.
    if (!hasExplicitUnit(claim.context) || /(?:sql\s+)?evidence\s+index\s*$/u.test(claim.context)) {
      return finding;
    }
    const hasWrongSelectedDimension = evidence.some((item) => collectTypedNumericEvidence(item.values)
      .some((cell) => numericMatches(claim, cell.value)
        && sqlColumnSupportsClaim(cell.field, claim.context)
        && !deterministicCellSupportsClaim(item, cell, claim.context, claim.entityContext, fallbackCentreReference)))
      || selectedTools.some((tool) => tool.numericEvidence.some((cell) => numericMatches(claim, cell.value)
        && sqlColumnSupportsClaim(cell.column, claim.context)
        && !sqlCellSupportsClaim(cell, claim.context, claim.entityContext, fallbackCentreReference)));
    if (hasWrongSelectedDimension) return finding;
    const sqlMatches = allTools.flatMap((tool, index) => tool.numericEvidence.flatMap((cell) =>
      numericMatches(claim, cell.value)
        && sqlCellSupportsClaim(cell, claim.context, claim.entityContext, fallbackCentreReference)
        ? [{ evidenceIndex: index + 1, cell }]
        : []));
    const deterministicMatches = input.discoveryEvidence.items.flatMap((item) =>
      collectTypedNumericEvidence(item.values).flatMap((cell) => numericMatches(claim, cell.value)
        && deterministicCellSupportsClaim(item, cell, claim.context, claim.entityContext, fallbackCentreReference)
        ? [{ item, cell }]
        : []));
    const matchCount = sqlMatches.length + deterministicMatches.length;
    if (matchCount !== 1) return finding;
    if (sqlMatches[0]) indexes.add(sqlMatches[0].evidenceIndex);
    if (deterministicMatches[0]) evidenceRefs.add(deterministicMatches[0].item.id);
  }
  const repaired = {
    ...finding,
    evidenceRefs: [...evidenceRefs],
    evidenceSqlIndexes: [...indexes].sort((left, right) => left - right),
  };
  const repairedEvidence = repaired.evidenceRefs.map((id) => input.discoveryEvidence.items
    .find((item) => item.id === id)).filter((item): item is PreschoolDiscoveryEvidenceItem => Boolean(item));
  const repairedTools = repaired.evidenceSqlIndexes.map((index) => allTools[index - 1]!)
    .filter(Boolean);
  return unsupportedNumber(repaired, repairedEvidence, repairedTools, input) ? finding : repaired;
}

type GeneratedFinding = {
  sectionId: PreschoolAiSectionId;
  signalRefs: string[];
  relationship: PreschoolAiRelationship;
  title: string;
  what: string;
  whyKind: PreschoolAiWhyKind;
  why: string;
  how: string;
  expectedIfAct: string;
  ifIgnored: string;
  howToVerify: string;
  evidenceNote: string;
  evidenceRefs: string[];
  evidenceSqlIndexes: number[];
  presentation?: AiFindingPresentation;
};

function parseFindings(answer: string): GeneratedFinding[] | null {
  const envelope = findLastFindingsEnvelope(answer);
  if (!envelope || !Array.isArray(envelope.findings) || envelope.findings.length > 4) return null;
  const findings = envelope.findings.flatMap<GeneratedFinding>((candidate) => {
    if (!isRecord(candidate)) return [];
    const sectionId = stringValue(candidate.sectionId) ?? "page-synthesis";
    const signalRefs = stringArray(candidate.signalRefs);
    const evidenceRefs = stringArray(candidate.evidenceRefs);
    const evidenceSqlIndexes = positiveIntegerArray(candidate.evidenceSqlIndexes);
    const relationship = stringValue(candidate.relationship) ?? "independent";
    const whyKind = stringValue(candidate.whyKind);
    const title = cleanText(candidate.title) ?? providerFindingTitle(sectionId, signalRefs);
    const what = cleanText(candidate.what);
    const why = cleanText(candidate.why);
    const how = cleanText(candidate.how) ?? cleanText(candidate.next);
    const expectedIfAct = cleanText(candidate.expectedIfAct) ?? cleanText(candidate.acted);
    const ifIgnored = cleanText(candidate.ifIgnored) ?? cleanText(candidate.ignored);
    const howToVerify = cleanText(candidate.howToVerify) ?? cleanText(candidate.verification);
    const evidenceNote = cleanText(candidate.evidenceNote);
    const presentation = parseAiFindingPresentation(normalizeProviderPresentation(
      candidate.presentation ?? (Array.isArray(candidate.blocks) ? { version: "1", blocks: candidate.blocks } : null),
      evidenceRefs,
      evidenceSqlIndexes ?? [],
    ));
    if (!isPreschoolAiSectionId(sectionId)
      || (relationship !== "supports" && relationship !== "challenges" && relationship !== "independent")
      || (whyKind !== "Evidence" && whyKind !== "Hypothesis" && whyKind !== "Missing Evidence")
      || !title || !what || !why || !how || !expectedIfAct || !ifIgnored || !howToVerify || !evidenceNote
      || evidenceSqlIndexes === null) return [];
    return [{ sectionId, signalRefs, relationship, title, what, whyKind, why, how, expectedIfAct, ifIgnored, howToVerify, evidenceNote, evidenceRefs, evidenceSqlIndexes, ...(presentation ? { presentation } : {}) }];
  });
  if (findings.length !== envelope.findings.length) return null;
  const semantic = findings.map((finding) => `${finding.title} ${finding.what}`.toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim());
  return new Set(semantic).size === semantic.length ? findings : null;
}

function providerFindingTitle(sectionId: string, signalRefs: string[]): string | null {
  const signalTitles: Record<string, string> = {
    "after-hours": "Energy used after closing",
    efficiency: "High for both floor area and headcount",
    operating: "Unusual peaks during opening hours",
  };
  if (signalRefs.length === 1 && signalTitles[signalRefs[0]!]) return signalTitles[signalRefs[0]!]!;
  const sectionTitles: Record<string, string> = {
    "overall-summary": "Portfolio pattern",
    "centre-benchmark": "Centre benchmark",
    "operating-behaviour": "Operating pattern",
    "appliance-contribution": "Energy drivers",
    "planning-outlook": "Planning outlook",
    "page-synthesis": "Portfolio priorities",
  };
  return sectionTitles[sectionId] ?? null;
}

function normalizeProviderPresentation(
  value: unknown,
  evidenceRefs: string[],
  evidenceSqlIndexes: number[],
): unknown {
  if (!isRecord(value) || !Array.isArray(value.blocks)) return value;
  return {
    version: "1",
    blocks: value.blocks.map((block) => normalizeProviderPresentationBlock(
      block,
      evidenceRefs,
      evidenceSqlIndexes,
    )),
  };
}

function normalizeProviderPresentationBlock(
  value: unknown,
  findingEvidenceRefs: string[],
  findingEvidenceSqlIndexes: number[],
): unknown {
  if (!isRecord(value)) return value;
  const type = stringValue(value.type) ?? stringValue(value.shape);
  const tone = value.tone === "warning" ? "caution" : value.tone === "info" ? "insight" : value.tone;
  const evidenceRefs = Array.isArray(value.evidenceRefs) ? value.evidenceRefs : findingEvidenceRefs;
  const evidenceSqlIndexes = Array.isArray(value.evidenceSqlIndexes)
    ? value.evidenceSqlIndexes
    : findingEvidenceSqlIndexes;
  const normalized: Record<string, unknown> = {
    ...value,
    ...(type ? { type } : {}),
    evidenceRefs,
    evidenceSqlIndexes,
    ...(tone ? { tone } : {}),
  };
  delete normalized.shape;
  if (type === "metric") normalized.value = providerNumericValue(value.value);
  if (type === "comparison" || type === "ranking" || type === "share" || type === "distribution") {
    normalized.items = normalizeProviderValueItems(value.items);
  }
  if (type === "trend") normalized.points = normalizeProviderValueItems(value.points);
  if (type === "heatmap" && Array.isArray(value.values)) {
    normalized.values = value.values.map((row) => Array.isArray(row)
      ? row.map(providerNumericValue)
      : row);
  }
  if (type === "table" && Array.isArray(value.rows)) {
    normalized.rows = value.rows.map((row) => Array.isArray(row)
      ? row.map(providerTableCell)
      : row);
  }
  return normalized;
}

function normalizeProviderValueItems(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((item) => isRecord(item)
    ? { ...item, value: providerNumericValue(item.value) }
    : item);
}

function providerTableCell(value: unknown): unknown {
  return typeof value === "string" && /^-?\d+(?:\.\d+)?$/u.test(value.trim())
    ? providerNumericValue(value)
    : value;
}

function providerNumericValue(value: unknown): unknown {
  if (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/u.test(value.trim())) return value;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : value;
}

function isPreschoolAiSectionId(value: string): value is PreschoolAiSectionId {
  return value === "overall-summary"
    || value === "centre-benchmark"
    || value === "operating-behaviour"
    || value === "appliance-contribution"
    || value === "planning-outlook"
    || value === "page-synthesis";
}

function collectTools(events: AgUiEvent[]): { schemaValid: boolean; sql: CollectedSqlEvidence[] } {
  const tools = new Map<string, ToolAccumulator>();
  for (const event of events) {
    const id = stringValue(event.toolCallId) ?? stringValue(event.tool_call_id);
    if (!id) continue;
    const current = tools.get(id) ?? { id, name: "unknown", args: null, argsText: "", result: undefined };
    current.name = stringValue(event.toolCallName) ?? stringValue(event.tool_call_name) ?? current.name;
    if (event.type === "TOOL_CALL_ARGS") current.argsText += stringValue(event.delta) ?? "";
    if (isRecord(event.args)) current.args = event.args;
    if (isRecord(event.parameters)) current.args = event.parameters;
    if (event.type === "TOOL_CALL_RESULT") current.result = event.result ?? event.content;
    tools.set(id, current);
  }
  for (const tool of tools.values()) {
    if (tool.argsText && !tool.args) {
      try { const parsed: unknown = JSON.parse(tool.argsText); if (isRecord(parsed)) tool.args = parsed; } catch {}
    }
  }
  const attempts = [...tools.values()];
  const schemaValid = attempts.some((tool) => tool.name === "inspect_schema" && Boolean(parseSchemaToolResult(tool.result)));
  const sql = attempts.flatMap<CollectedSqlEvidence>((tool) => {
    if (tool.name !== "run_sql_readonly") return [];
    const parsed = parseSqlToolResult(tool.result);
    if (!parsed) return [];
    const preview = typeof tool.result === "string" ? tool.result : JSON.stringify(tool.result);
    const sql = sqlFromToolPayload(tool.args, tool.result) ?? null;
    return [{
      toolCallId: tool.id,
      sql,
      rowCount: parsed.row_count ?? null,
      auditLogId: parsed.audit_log_id ?? null,
      elapsedMs: parsed.elapsed_ms ?? null,
      resultPreview: preview.slice(0, 2_000),
      columns: parsed.columns,
      rows: parsed.rows,
      numericEvidence: collectSqlNumericEvidence(parsed.columns, parsed.rows),
      normalizedSql: normalizeSql(sql),
      returnedRowCount: parsed.rows.length,
    }];
  });
  return { schemaValid, sql };
}

function normalizeSql(sql: string | null): string | null {
  if (!sql) return null;
  const normalized = sql
    .replace(/\/\*[\s\S]*?\*\//gu, " ")
    .replace(/--[^\r\n]*/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/;+$/gu, "")
    .trim()
    .toLowerCase();
  return normalized || null;
}

function unsupportedNumber(
  finding: GeneratedFinding,
  evidence: PreschoolDiscoveryEvidenceItem[],
  tools: CollectedSqlEvidence[],
  input: PreschoolAiRunInput,
): boolean {
  return unsupportedFindingFields(finding, evidence, tools, input).length > 0;
}

function unsupportedFindingFields(
  finding: GeneratedFinding,
  evidence: PreschoolDiscoveryEvidenceItem[],
  tools: CollectedSqlEvidence[],
  input: PreschoolAiRunInput,
): PreschoolAiValidationIssue["field"][] {
  const fallbackCentreReference = findingCentreReference(finding);
  const fields: Array<{ field: PreschoolAiValidationIssue["field"]; value: string }> = [
    { field: "title", value: finding.title },
    { field: "what", value: finding.what },
    { field: "why", value: finding.why },
    { field: "how", value: finding.how },
    { field: "expectedIfAct", value: finding.expectedIfAct },
    { field: "ifIgnored", value: finding.ifIgnored },
    { field: "howToVerify", value: finding.howToVerify },
    { field: "evidenceNote", value: removeCitedSqlReturnedRowReferences(finding.evidenceNote, tools) },
    { field: "presentation", value: aiFindingPresentationEvidenceText(finding.presentation) },
  ];
  return fields.flatMap(({ field, value }) => value && unsupportedNarrative(
    value,
    evidence,
    tools,
    input,
    finding.evidenceSqlIndexes,
    narrativeFragmentCentreFallback(value, fallbackCentreReference),
  ) ? [field] : []);
}

function canonicalizeFindingNarrative(
  finding: GeneratedFinding,
  unsupportedFields: PreschoolAiValidationIssue["field"][],
  evidence: PreschoolDiscoveryEvidenceItem[],
  tools: CollectedSqlEvidence[],
  input: PreschoolAiRunInput,
): GeneratedFinding | null {
  if (unsupportedFields.length === 0) return finding;
  const unsupported = new Set(unsupportedFields);
  const canonical = { ...finding };
  const fallbackCentreReference = findingCentreReference(finding);
  const keepSupported = (value: string): string | null => supportedNarrativeFragments(
    value,
    evidence,
    tools,
    input,
    finding.evidenceSqlIndexes,
    fallbackCentreReference,
  );
  if (unsupported.has("title")) {
    canonical.title = providerFindingTitle(finding.sectionId, finding.signalRefs) ?? "AI interpretation";
  }
  if (unsupported.has("what")) {
    const supported = keepSupported(finding.what);
    if (!supported) return null;
    canonical.what = supported;
  }
  if (unsupported.has("why")) {
    canonical.why = keepSupported(finding.why)
      ?? "The cited Snapshot and scoped SQL Evidence support this investigation priority.";
  }
  if (unsupported.has("how")) {
    canonical.how = keepSupported(finding.how)
      ?? "Review the cited Evidence before changing operations.";
  }
  if (unsupported.has("expectedIfAct")) {
    canonical.expectedIfAct = keepSupported(finding.expectedIfAct)
      ?? "A follow-up check should show whether the verified pattern changes.";
  }
  if (unsupported.has("ifIgnored")) {
    canonical.ifIgnored = keepSupported(finding.ifIgnored)
      ?? "The reason for this pattern will remain unresolved.";
  }
  if (unsupported.has("howToVerify")) {
    canonical.howToVerify = keepSupported(finding.howToVerify)
      ?? "Repeat the same scoped check on the next published Snapshot.";
  }
  if (unsupported.has("evidenceNote")) {
    canonical.evidenceNote = keepSupported(finding.evidenceNote)
      ?? "The Evidence supports prioritisation, not a confirmed cause.";
  }
  if (unsupported.has("presentation")) delete canonical.presentation;
  return unsupportedFindingFields(canonical, evidence, tools, input).length === 0 ? canonical : null;
}

function supportedNarrativeFragments(
  raw: string,
  evidence: PreschoolDiscoveryEvidenceItem[],
  tools: CollectedSqlEvidence[],
  input: PreschoolAiRunInput,
  evidenceSqlIndexes: number[],
  fallbackCentreReference: string | null,
): string | null {
  const fragments = raw.split(/(?<=[.!?])\s+|;\s+|\s+[—–]\s+|\s+while\s+/iu)
    .map((fragment) => cleanText(fragment))
    .filter((fragment): fragment is string => Boolean(fragment))
    .map((fragment) => labelBareCentreFragment(fragment, evidence));
  let accepted = "";
  for (const fragment of fragments) {
    const fragmentFallback = narrativeFragmentCentreFallback(fragment, fallbackCentreReference);
    if (unsupportedNarrative(
      fragment,
      evidence,
      tools,
      input,
      evidenceSqlIndexes,
      fragmentFallback,
    )) continue;
    const candidate = accepted ? `${accepted}; ${fragment}` : fragment;
    if (!unsupportedNarrative(
      candidate,
      evidence,
      tools,
      input,
      evidenceSqlIndexes,
      narrativeFragmentCentreFallback(candidate, fallbackCentreReference),
    )) accepted = candidate;
  }
  return accepted || null;
}

function labelBareCentreFragment(fragment: string, evidence: PreschoolDiscoveryEvidenceItem[]): string {
  const match = /^([A-Z]{1,2})\s*(?=\()/u.exec(fragment);
  if (!match) return fragment;
  const centreCode = match[1]!;
  const citedCentreCodes = new Set(evidence.flatMap((item) => collectNamedCentreDimensions(item.values)));
  return citedCentreCodes.has(centreCode) ? `Centre ${fragment}` : fragment;
}

function narrativeFragmentCentreFallback(fragment: string, original: string | null): string | null {
  const explicit = explicitCentreReference(fragment);
  if (explicit) return explicit;
  return /\b(?:it|its|this centre|the centre|selected centre)\b/iu.test(fragment) ? original : null;
}

function materializePreschoolPresentation(
  finding: GeneratedFinding,
  evidenceById: ReadonlyMap<string, PreschoolDiscoveryEvidenceItem>,
  allTools: CollectedSqlEvidence[],
  input: PreschoolAiRunInput,
): AiFindingPresentation | null {
  const scoped = filterAiFindingPresentationEvidence(finding.presentation, {
    evidenceRefs: finding.evidenceRefs,
    evidenceSqlIndexes: finding.evidenceSqlIndexes,
  });
  if (!scoped) return null;
  const fallbackCentreReference = findingCentreReference(finding);
  const blocks = scoped.blocks.filter((block) => {
    const evidence = (block.evidenceRefs ?? []).flatMap((reference) => {
      const item = evidenceById.get(reference);
      return item ? [item] : [];
    });
    const tools = (block.evidenceSqlIndexes ?? []).flatMap((index) => {
      const tool = allTools[index - 1];
      return tool ? [tool] : [];
    });
    return !unsupportedNarrative(
      aiFindingPresentationEvidenceText({ version: "1", blocks: [block] }),
      evidence,
      tools,
      input,
      block.evidenceSqlIndexes ?? [],
      fallbackCentreReference,
    );
  });
  return blocks.length > 0 ? { version: "1", blocks } : null;
}

/**
 * Keeps model-selected presentation authoritative. When the Provider omits it,
 * project only a small set of customer-useful relationships already selected
 * by the Finding and returned by its cited SQL. This never runs a new query or
 * derives a new business claim.
 */
function derivePreschoolEvidencePresentation(
  finding: GeneratedFinding,
  allTools: CollectedSqlEvidence[],
): AiFindingPresentation | null {
  for (const evidenceSqlIndex of finding.evidenceSqlIndexes) {
    const tool = allTools[evidenceSqlIndex - 1];
    if (!tool) continue;
    const rows = tool.rows.filter((row): row is unknown[] => Array.isArray(row));

    if (finding.sectionId === "operating-behaviour") {
      const items = sqlValueItems(tool.columns, rows, "day_type", "mean_kwh_per_day", dayTypeLabel);
      const presentation = items.length >= 2 ? parseAiFindingPresentation({
        version: "1",
        blocks: [{
          type: "comparison",
          title: "Average energy by day type",
          unit: "kWh/day",
          items,
          evidenceSqlIndexes: [evidenceSqlIndex],
        }],
      }) : null;
      if (presentation) return presentation;
    }

    if (finding.sectionId === "appliance-contribution") {
      const items = sqlValueItems(tool.columns, rows, "category", "share_pct", applianceCategoryLabel);
      const presentation = items.length >= 2 ? parseAiFindingPresentation({
        version: "1",
        blocks: [{
          type: "share",
          title: "Energy share by appliance category",
          unit: "%",
          items,
          evidenceSqlIndexes: [evidenceSqlIndex],
        }],
      }) : null;
      if (presentation) return presentation;
    }

    if (finding.sectionId === "overall-summary") {
      const items = sqlValueItems(tool.columns, rows, "circuit_name", "interval_kw", circuitLabel);
      const presentation = items.length >= 2 ? parseAiFindingPresentation({
        version: "1",
        blocks: [{
          type: "ranking",
          title: "Power at the peak interval",
          unit: "kW",
          items,
          evidenceSqlIndexes: [evidenceSqlIndex],
        }],
      }) : null;
      if (presentation) return presentation;
    }
  }
  return null;
}

function sqlValueItems(
  columns: string[],
  rows: unknown[][],
  labelColumn: string,
  valueColumn: string,
  label: (value: string) => string,
): Array<{ label: string; value: number }> {
  const labelIndex = columns.indexOf(labelColumn);
  const valueIndex = columns.indexOf(valueColumn);
  if (labelIndex < 0 || valueIndex < 0) return [];
  return rows.slice(0, 10).flatMap((row) => {
    const rawLabel = row[labelIndex];
    const rawValue = row[valueIndex];
    if (typeof rawLabel !== "string" || typeof rawValue !== "number" || !Number.isFinite(rawValue)) return [];
    return [{ label: label(rawLabel), value: rawValue }];
  });
}

function dayTypeLabel(value: string): string {
  return value.toLowerCase() === "weekday" ? "Weekday"
    : value.toLowerCase() === "weekend" ? "Weekend"
      : value.replace(/(^|[-_\s]+)(\p{L})/gu, (_match, _separator, letter: string) => ` ${letter.toUpperCase()}`).trim();
}

function applianceCategoryLabel(value: string): string {
  const category = value.toLowerCase();
  if (category === "load") return "Plugload";
  if (category === "aircon") return "Air conditioning";
  if (category === "light") return "Lighting";
  return dayTypeLabel(value);
}

function circuitLabel(value: string): string {
  const [scope, circuit = value] = value.split(":", 2);
  const centre = /^preschool-centre-(.+)$/u.exec(scope)?.[1]?.toUpperCase();
  const readableCircuit = circuit.replace(/([\p{L}])(\d+)/gu, "$1 $2");
  return centre ? `Centre ${centre} · ${readableCircuit}` : readableCircuit;
}

function unsupportedNarrative(
  rawNarrative: string,
  evidence: PreschoolDiscoveryEvidenceItem[],
  tools: CollectedSqlEvidence[],
  input: PreschoolAiRunInput,
  evidenceSqlIndexes: number[],
  fallbackCentreReference: string | null = null,
): boolean {
  if (hasMismatchedPinnedReference(rawNarrative, "Snapshot", input.snapshotId)
    || hasMismatchedPinnedReference(rawNarrative, "Release", input.projectReleaseId)) {
    return true;
  }
  const narrative = removeAllowedStructuralReferences(
    rawNarrative,
    input,
    evidenceSqlIndexes,
  );
  const evidenceNarrative = removeCitedSqlPredicateReferences(narrative, tools);
  const deterministicValues = evidence.flatMap((item) => collectTypedNumericEvidence(item.values)
    .map((cell) => ({ item, cell })));
  const sqlValues = tools.flatMap((tool) => tool.numericEvidence);
  return numericTokens(evidenceNarrative).some((claim) => {
    if (deterministicValues.some(({ item, cell }) => numericMatches(claim, cell.value)
      && deterministicCellSupportsClaim(
        item,
        cell,
        claim.context,
        claim.entityContext,
        fallbackCentreReference,
      ))) return false;
    return !sqlValues.some((cell) => numericMatches(claim, cell.value)
      && sqlCellSupportsClaim(cell, claim.context, claim.entityContext, fallbackCentreReference));
  });
}

function removeCitedSqlPredicateReferences(narrative: string, tools: CollectedSqlEvidence[]): string {
  const citedSql = tools.flatMap((tool) => tool.sql ? [tool.sql] : []);
  const hasPredicate = (column: string, operator: string, value: string) => citedSql.some((sql) => {
    const pattern = new RegExp(
      `\\b${escapeRegExp(column)}\\s*${escapeRegExp(operator)}\\s*${escapeRegExp(value)}(?![\\d.])`,
      "iu",
    );
    return pattern.test(sql);
  });
  let remaining = narrative.replace(
    /\b(local_hour|hour_of_day)\s*(<=|>=|=|<|>)\s*(-?\d+(?:\.\d+)?)\s+or\s+(<=|>=|=|<|>)\s*(-?\d+(?:\.\d+)?)/giu,
    (full, column: string, firstOperator: string, firstValue: string, secondOperator: string, secondValue: string) =>
      hasPredicate(column, firstOperator, firstValue) && hasPredicate(column, secondOperator, secondValue)
        ? `${column}${firstOperator} or ${secondOperator}`
        : full,
  );
  remaining = remaining.replace(
    /\b(local_hour|hour_of_day)\s*(<=|>=|=|<|>)\s*(-?\d+(?:\.\d+)?)/giu,
    (full, column: string, operator: string, value: string) => hasPredicate(column, operator, value)
      ? `${column}${operator}`
      : full,
  );
  return remaining;
}

function removeCitedSqlReturnedRowReferences(evidenceNote: string, tools: CollectedSqlEvidence[]): string {
  let remaining = evidenceNote;
  for (const tool of tools) {
    if (tool.returnedRowCount < 1) continue;
    remaining = remaining.replace(
      new RegExp(`\\b${tool.returnedRowCount}\\s+rows?\\s+(?:returned|shown)\\b`, "giu"),
      "returned rows",
    );
  }
  return remaining;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function hasMismatchedPinnedReference(narrative: string, label: "Release" | "Snapshot", expected: string): boolean {
  const pattern = new RegExp(`\\b${label}\\s+([A-Za-z0-9_-]*\\d[A-Za-z0-9_-]*)`, "giu");
  return [...narrative.matchAll(pattern)].some((match) => match[1] !== expected);
}

function removeAllowedStructuralReferences(
  narrative: string,
  input: PreschoolAiRunInput,
  evidenceSqlIndexes: number[],
): string {
  let remaining = replaceCompleteStructuralReference(narrative, input.analysisFrom, "");
  remaining = replaceCompleteStructuralReference(remaining, input.analysisTo, "");
  remaining = replaceCompleteStructuralReference(remaining, input.snapshotId, "");
  remaining = replaceCompleteStructuralReference(remaining, input.projectReleaseId, "");
  for (const reference of structuralPeriodPresentations(input)) {
    remaining = replaceCompleteStructuralReference(remaining, reference, "");
  }
  for (const reference of structuralDiscoveryPeriodPresentations(input)) {
    remaining = replaceCompleteStructuralReference(remaining, reference, "");
  }
  for (const index of evidenceSqlIndexes) {
    remaining = replaceCompleteStructuralReference(
      remaining,
      `SQL Evidence index ${index}`,
      "SQL Evidence",
    );
    remaining = replaceCompleteStructuralReference(
      remaining,
      `Evidence index ${index}`,
      "Evidence",
    );
  }
  remaining = remaining.replace(
    /\btop[- ]\d+\s+(?:scan|query|result|list)\b/giu,
    "ranked query",
  );
  return remaining;
}

function structuralPeriodPresentations(input: PreschoolAiRunInput): string[] {
  const from = parseIsoLocalDate(input.analysisFrom);
  const to = parseIsoLocalDate(input.analysisTo);
  if (!from || !to || from.valueOf() > to.valueOf()) return [];
  const dayCount = Math.round((to.valueOf() - from.valueOf()) / 86_400_000) + 1;
  const references = [`${dayCount}-day analysis period`, `${dayCount} days`];
  const isFullMonth = from.getUTCDate() === 1
    && from.getUTCFullYear() === to.getUTCFullYear()
    && from.getUTCMonth() === to.getUTCMonth()
    && to.getUTCDate() === new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() + 1, 0)).getUTCDate();
  if (!isFullMonth) return references;
  const month = new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" }).format(from);
  return [...references, `${month} ${from.getUTCFullYear()}`, `${dayCount} ${month} days`];
}

function structuralDiscoveryPeriodPresentations(input: PreschoolAiRunInput): string[] {
  const period = input.discoveryEvidence.identity.period;
  if (!evidencePeriodMatchesInput(period, input)) return [];
  return [...new Set([period.from, period.to].flatMap(strictIsoPresentations))];
}

function strictIsoPresentations(value: string): string[] {
  const instant = new Date(value);
  if (Number.isNaN(instant.valueOf())) return [];
  const canonical = instant.toISOString();
  return [value, canonical, canonical.replace(/\.000Z$/u, "Z")];
}

function parseIsoLocalDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function replaceCompleteStructuralReference(
  value: string,
  reference: string,
  replacement: string,
): string {
  if (!reference) return value;
  let output = "";
  let cursor = 0;
  while (cursor < value.length) {
    const matchIndex = value.indexOf(reference, cursor);
    if (matchIndex < 0) return output + value.slice(cursor);
    const before = matchIndex > 0 ? value[matchIndex - 1] : undefined;
    const afterIndex = matchIndex + reference.length;
    const after = afterIndex < value.length ? value[afterIndex] : undefined;
    const isComplete = !isStructuralIdentifierCharacter(before)
      && !isStructuralIdentifierCharacter(after);
    output += value.slice(cursor, matchIndex);
    output += isComplete ? replacement : reference;
    cursor = afterIndex;
  }
  return output;
}

function isStructuralIdentifierCharacter(value: string | undefined): boolean {
  return Boolean(value && /[A-Za-z0-9_-]/u.test(value));
}

function collectTypedNumericEvidence(
  value: unknown,
  field = "",
): Array<{ field: string | null; value: number }> {
  if (typeof value === "number") return Number.isFinite(value) ? [{ field: field || null, value }] : [];
  if (Array.isArray(value)) return value.flatMap((item) => collectTypedNumericEvidence(item, field));
  if (isRecord(value)) return Object.entries(value).flatMap(([key, item]) => collectTypedNumericEvidence(item, key));
  return [];
}

function collectSqlNumericEvidence(
  columns: string[],
  rows: unknown[],
): SqlNumericEvidenceCell[] {
  return rows.flatMap((row, rowIndex) => {
    if (Array.isArray(row)) {
      const dimensions = row.flatMap<SqlDimensionEvidence>((value, columnIndex) => typeof value === "string"
        ? [{ column: columns[columnIndex] ?? null, value }]
        : []);
      return row.flatMap((value, columnIndex) => typeof value === "number" && Number.isFinite(value)
        ? [{ column: columns[columnIndex] ?? null, row: rowIndex, value, dimensions }]
        : []);
    }
    if (isRecord(row)) {
      const dimensions = Object.entries(row).flatMap<SqlDimensionEvidence>(([column, value]) => typeof value === "string"
        ? [{ column, value }]
        : []);
      return Object.entries(row).flatMap(([column, value]) => typeof value === "number" && Number.isFinite(value)
        ? [{ column, row: rowIndex, value, dimensions }]
        : []);
    }
    return [];
  });
}

function numericTokens(value: string): Array<{
  context: string;
  entityContext: string;
  precision: number;
  value: number;
}> {
  return [...value.matchAll(/(?<![A-Za-z0-9])[-+]?\d[\d,]*(?:\.\d+)?(?![A-Za-z0-9])/gu)].flatMap((match) => {
    const token = match[0];
    const normalized = token.replaceAll(",", "");
    const parsed = Number(normalized);
    const tokenStart = match.index ?? 0;
    const tokenEnd = tokenStart + token.length;
    return Number.isFinite(parsed) ? [{
      context: numericUnitContext(value, tokenStart, tokenEnd),
      entityContext: entityClauseAround(value, tokenStart, tokenEnd).toLowerCase(),
      precision: normalized.includes(".") ? normalized.split(".")[1]!.length : 0,
      value: parsed,
    }] : [];
  });
}

function numericUnitContext(value: string, numberStart: number, numberEnd: number): string {
  const before = value.slice(Math.max(0, numberStart - 20), numberStart).toLowerCase();
  const after = value.slice(numberEnd, Math.min(value.length, numberEnd + 24)).toLowerCase();
  const explicitAfter = /^\s*(?:%|percent(?:age)?|kwh|mwh|gwh|wh|kw|mw|gw|kilowatt[- ]?hours?|centres?|spikes?|events?|people|persons?|pax)/u.exec(after);
  const explicitBefore = /(?:[$€£]|\b(?:sgd|usd))\s*$/u.exec(before);
  if (explicitAfter || explicitBefore) return `${explicitBefore?.[0] ?? ""} ${explicitAfter?.[0] ?? ""}`;
  return `${before} ${after}`;
}

function entityClauseAround(value: string, numberStart: number, numberEnd: number): string {
  const boundaries = [...value.matchAll(/[.;\n]|\b(?:while|whereas|however|but)\b/giu)];
  const previous = boundaries.filter((boundary) => (boundary.index ?? 0) < numberStart).at(-1);
  const next = boundaries.find((boundary) => (boundary.index ?? value.length) >= numberEnd);
  const start = previous?.index === undefined ? 0 : previous.index + previous[0].length;
  const end = next?.index ?? value.length;
  return value.slice(start, end);
}

function numericMatches(claim: { precision: number; value: number }, evidence: number): boolean {
  return Math.abs(claim.value - evidence) <= (0.5 * (10 ** -claim.precision)) + Number.EPSILON;
}

function sqlColumnSupportsClaim(column: string | null, context: string): boolean {
  if (!column) return !hasExplicitUnit(context) && !hasCurrencyUnit(context);
  const normalizedColumn = column.toLowerCase();
  if (hasCurrencyUnit(context)) return /cost|amount|price|tariff|sgd|usd|currency/u.test(normalizedColumn);
  if (/\b(?:eui|kwh\s*(?:\/|per)\s*(?:m(?:²|2)|sqm|square metres?))\b/u.test(context)) {
    return /eui|kwh.*(?:m2|sqm)|(?:m2|sqm).*kwh/u.test(normalizedColumn);
  }
  if (/\bkwh\s*(?:\/|per)\s*(?:pax|people|persons?)\b|\bper[-_ ]?pax\b/u.test(context)) {
    return /per_?pax|pax|kwh.*person|person.*kwh/u.test(normalizedColumn);
  }
  const energyUnit = context.match(/\b(kwh|mwh|gwh|wh|kw|mw|gw|kilowatt[- ]?hours?)\b/u)?.[1];
  if (energyUnit) {
    if (energyUnit === "kwh" || energyUnit.startsWith("kilowatt")) {
      return normalizedColumn.includes("kwh");
    }
    return normalizedColumn.includes(energyUnit);
  }
  if (/%|\bpercent(?:age)?\b/u.test(context)) return /pct|percent|share|rate|ratio/u.test(normalizedColumn);
  if (/\bcentres?\b/u.test(context)) return /centre.*count|count.*centre/u.test(normalizedColumn);
  if (/\b(?:spikes?|events?)\b/u.test(context)) return /spike.*count|event.*count|count.*spike|count.*event/u.test(normalizedColumn);
  if (/\b(?:people|persons?|pax)\b/u.test(context)) return /pax|people|person|headcount/u.test(normalizedColumn);
  return true;
}

function sqlCellSupportsClaim(
  cell: SqlNumericEvidenceCell,
  context: string,
  entityContext: string,
  fallbackCentreReference: string | null = null,
): boolean {
  if (!sqlColumnSupportsClaim(cell.column, `${context} ${semanticMetricContext(entityContext)}`)) return false;
  const centreReference = explicitCentreReference(entityContext) ?? fallbackCentreReference;
  if (!centreReference) return true;
  return cell.dimensions.some((dimension) => {
    if (!dimension.column || !/(?:centre|center|parent_node|scope)/u.test(dimension.column.toLowerCase())) {
      return false;
    }
    const tokens: string[] = dimension.value.toLowerCase().match(/[a-z0-9]+/gu) ?? [];
    return tokens.includes(centreReference);
  });
}

function deterministicCellSupportsClaim(
  item: PreschoolDiscoveryEvidenceItem,
  cell: { field: string | null; value: number },
  context: string,
  entityContext: string,
  fallbackCentreReference: string | null = null,
): boolean {
  if (!sqlColumnSupportsClaim(cell.field, `${context} ${semanticMetricContext(entityContext)}`)) return false;
  const centreReference = explicitCentreReference(entityContext) ?? fallbackCentreReference;
  if (!centreReference) return true;
  const dimensionTokens: string[] = `${item.id} ${item.label} ${collectNamedCentreDimensions(item.values).join(" ")}`
    .toLowerCase().match(/[a-z0-9]+/gu) ?? [];
  return dimensionTokens.includes(centreReference);
}

function semanticMetricContext(entityContext: string): string {
  return [
    /[$€£]|\b(?:sgd|usd|cost|price|tariff|dollars?)\b/u.test(entityContext) ? "cost" : "",
    /\b(?:eui|kwh\s*(?:\/|per)\s*(?:m(?:²|2)|sqm|square metres?))\b/u.test(entityContext) ? "eui" : "",
    /\bkwh\s*(?:\/|per)\s*(?:pax|people|persons?)\b|\bper[-_ ]?pax\b/u.test(entityContext) ? "per-pax" : "",
  ].filter(Boolean).join(" ");
}

function collectNamedCentreDimensions(value: unknown, field = ""): string[] {
  if (typeof value === "string") {
    return /(?:centre|center|parent_node|scope)(?:_?code|_?id|_?name)?$/u.test(field.toLowerCase())
      ? [value]
      : [];
  }
  if (Array.isArray(value)) return value.flatMap((item) => collectNamedCentreDimensions(item, field));
  if (isRecord(value)) {
    return Object.entries(value).flatMap(([key, item]) => collectNamedCentreDimensions(item, key));
  }
  return [];
}

function explicitCentreReference(context: string): string | null {
  const references = new Set([...context.matchAll(/\bcent(?:re|er)\s+([a-z]{1,2}|\d+)\b/giu)]
    .map((match) => match[1]!.toLowerCase()));
  if (references.size === 0) return null;
  if (references.size > 1) return "__ambiguous_centre__";
  return [...references][0]!;
}

function findingCentreReference(finding: GeneratedFinding): string | null {
  return explicitCentreReference([
    finding.title,
    finding.what,
    finding.why,
    finding.how,
    finding.expectedIfAct,
    finding.ifIgnored,
    finding.howToVerify,
    finding.evidenceNote,
  ].join("\n"));
}

function hasCurrencyUnit(context: string): boolean {
  return /[$€£]|\b(?:sgd|usd|cost|price|tariff|dollars?)\b/u.test(context);
}

function hasExplicitUnit(context: string): boolean {
  return /%|\b(?:kwh|kilowatt[- ]?hours?|percent(?:age)?|centres?|spikes?|events?|people|persons?|pax)\b/u.test(context);
}

function discoveryMatchesInput(input: PreschoolAiRunInput): boolean {
  const identity = input.discoveryEvidence.identity;
  return identity.projectId === input.projectId
    && identity.scopeId === input.scopeId
    && identity.snapshotId === input.snapshotId
    && identity.projectReleaseId === input.projectReleaseId
    && identity.timezone === input.timezone
    && evidencePeriodMatchesInput(identity.period, input)
    && [identity.rendererKey, identity.hierarchyRevisionId, identity.meterMappingRevisionId,
      identity.meterFormulaRevisionId, identity.metricVersion, identity.businessCalendarVersion]
      .every((pin) => input.identityKey.includes(pin));
}

function evidencePeriodMatchesInput(
  period: { from: string; to: string },
  input: PreschoolAiRunInput,
): boolean {
  try {
    const from = new Date(period.from);
    const toExclusive = new Date(period.to);
    if (Number.isNaN(from.valueOf()) || Number.isNaN(toExclusive.valueOf())) return false;
    return localDate(from, input.timezone) === input.analysisFrom
      && localDate(new Date(toExclusive.valueOf() - 1), input.timezone) === input.analysisTo;
  } catch {
    return false;
  }
}

function parseEventStream(text: string): AgUiEvent[] {
  return text.split(/\r?\n\r?\n/u).flatMap((chunk) => {
    const data = chunk.split(/\r?\n/u).filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart()).join("\n").trim();
    if (!data || data === "[DONE]") return [];
    try { const parsed: unknown = JSON.parse(data); return isRecord(parsed) ? [parsed] : []; } catch { return []; }
  });
}

function findLastFindingsEnvelope(answer: string): Record<string, unknown> | null {
  for (let start = answer.lastIndexOf("{"); start >= 0; start = answer.lastIndexOf("{", start - 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < answer.length; index += 1) {
      const character = answer[index]!;
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === "\"") inString = false;
        continue;
      }
      if (character === "\"") inString = true;
      else if (character === "{") depth += 1;
      else if (character === "}" && --depth === 0) {
        try {
          const parsed: unknown = JSON.parse(answer.slice(start, index + 1));
          if (isRecord(parsed) && Object.hasOwn(parsed, "findings")) return parsed;
        } catch {}
        break;
      }
    }
  }
  return null;
}

function localDate(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function positiveIntegerArray(value: unknown): number[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => Number.isSafeInteger(item) && (item as number) > 0)) return null;
  return [...new Set(value as number[])];
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const values = value.map(cleanText);
  return values.every(Boolean) ? [...new Set(values as string[])] : [];
}

function cleanText(value: unknown): string | null {
  const text = stringValue(value)?.replace(/\s+/gu, " ").trim();
  return text && text.length <= 800 ? text : null;
}

function friendlyReason(reason: string): string {
  const trimmed = reason.trim();
  return /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/u.test(trimmed)
    || /\b(?:timeout|timed out|network error|failed to fetch|abort(?:ed|ing)?)\b/iu.test(trimmed)
    ? FRIENDLY_UNAVAILABLE
    : trimmed || FRIENDLY_UNAVAILABLE;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
