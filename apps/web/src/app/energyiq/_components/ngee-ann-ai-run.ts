import type {
  EnergyProjectAnalysisSnapshotDto,
  SessionConversationDto,
  TraceDagDto,
} from "../../../lib/config-api";
import { ConfigApiError, configApi, getAgentRuntimeUrl } from "../../../lib/config-api";
import {
  configApiCsrfHeaders,
  configApiIdentityHeaders,
  isPasswordAuthMode,
} from "../../../lib/config-api/client";
import { parseSchemaToolResult, parseSqlToolResult, sqlFromToolPayload } from "../../data-tasks/tool-result-normalize";
import {
  buildNgeeAnnDiscoveryEvidenceBundle,
  type NgeeAnnDiscoveryEvidenceBundleV1,
  type NgeeAnnDiscoveryEvidenceItem,
  type NgeeAnnDiscoveryHorizon,
} from "./ngee-ann-ai-discovery-evidence";
import type { NgeeAnnDecisionPrioritiesViewModel } from "./ngee-ann-overview-view-model";
import {
  AI_FINDING_PRESENTATION_PROMPT,
  aiFindingPresentationEvidenceText,
  filterAiFindingPresentationEvidence,
  parseAiFindingPresentation,
  type AiFindingPresentation,
} from "./ai-finding-presentation";

export type { NgeeAnnDiscoveryEvidenceItem } from "./ngee-ann-ai-discovery-evidence";

export type NgeeAnnAiHorizon = "1d" | "7d" | "28d";
export type NgeeAnnAiWhyKind = "Evidence" | "Hypothesis" | "Missing Evidence";
export type NgeeAnnAiRelationship = "supports" | "challenges" | "independent";
export type NgeeAnnAiProgress = "inspecting" | "querying" | "drafting";
export type NgeeAnnAiProgressCallback = (progress: NgeeAnnAiProgress) => void;

export type NgeeAnnAiToolEvidence = {
  evidenceIndex: number;
  toolCallId: string;
  toolName: "inspect_schema" | "run_sql_readonly";
  sql: string | null;
  rowCount: number | null;
  auditLogId: string | null;
  elapsedMs: number | null;
  resultPreview: string;
};

export type NgeeAnnAiFinding = {
  id: string;
  relationship: NgeeAnnAiRelationship;
  horizons: NgeeAnnAiHorizon[];
  title: string;
  what: string;
  why: { kind: NgeeAnnAiWhyKind; text: string };
  how: string;
  howToVerify: string;
  evidenceNote: string;
  presentation?: AiFindingPresentation;
  evidence: {
    snapshotId: string;
    dataCutoff: string;
    dataQuality: NgeeAnnAiDataQuality;
    deterministic: NgeeAnnDiscoveryEvidenceItem[];
    tools: NgeeAnnAiToolEvidence[];
  };
};

export type NgeeAnnAiDataQuality = {
  status: "complete" | "partial" | "unavailable";
  scope: "deterministic-overview-period";
  period: { from: string; to: string };
  coveragePct: number;
  validIntervalCount: number;
  expectedMeterIntervalCount: number;
  qualityEventCount: number;
  limitation: string;
};

export type NgeeAnnAiRunResult = {
  status: "available";
  providerProfileId: string;
  runId: string;
  findings: NgeeAnnAiFinding[];
} | {
  status: "unavailable";
  reason: string;
};

type HorizonEvidence = NgeeAnnDiscoveryHorizon;

export type NgeeAnnAiRunInput = {
  identityKey: string;
  projectId: string;
  projectName: string;
  scopeId: string;
  scopeName: string;
  resource: "electricity";
  timezone: string;
  snapshotId: string;
  projectReleaseId: string;
  dataCutoff: string;
  analysisFrom: string;
  analysisTo: string;
  deterministicProjection: unknown;
  dataQuality: NgeeAnnAiDataQuality;
  horizons: [HorizonEvidence, HorizonEvidence, HorizonEvidence];
  discoveryEvidence: NgeeAnnDiscoveryEvidenceBundleV1;
};

type AgUiEvent = Record<string, unknown> & { type?: string };
type ToolAccumulator = {
  id: string;
  name: string;
  argsText: string;
  args: Record<string, unknown> | null;
  result: unknown;
};
type CollectedToolEvidence = Omit<NgeeAnnAiToolEvidence, "evidenceIndex"> & {
  numericEvidence: string;
};

type CurrentRun = {
  promise: Promise<NgeeAnnAiRunResult>;
  progress: NgeeAnnAiProgress;
  listeners: Set<NgeeAnnAiProgressCallback>;
  settled: boolean;
};

const currentRuns = new Map<string, CurrentRun>();
const FRIENDLY_AI_UNAVAILABLE_REASON = "AI analysis is temporarily unavailable. The verified Overview remains available.";
const NGEE_ANN_AI_OUTPUT_CONTRACT_REVISION = "v6";
const PERSISTED_WORKSPACE_PROFILE_ID = "workspace-default";
const ACTIVE_RUN_POLL_INTERVAL_MS = 1_500;
const ACTIVE_RUN_POLL_LIMIT = 200;

export function resetNgeeAnnAiRunsForTests(): void {
  currentRuns.clear();
}

export function buildNgeeAnnAiRunInput(
  snapshot: EnergyProjectAnalysisSnapshotDto,
  decisionPriorities: NgeeAnnDecisionPrioritiesViewModel,
): NgeeAnnAiRunInput | null {
  if (snapshot.context.resource !== "electricity" || decisionPriorities.status === "unavailable") return null;
  const item = snapshot.decisionPriorities?.items[0];
  if (!item || !decisionPriorities.items[0]) return null;
  const horizonMap = new Map(item.horizons.map((horizon) => [horizon.horizon, horizon]));
  const latest = horizonMap.get("latest_complete_day");
  const rolling7 = horizonMap.get("rolling_7d");
  const rolling28 = horizonMap.get("rolling_28d");
  if (!latest || !rolling7 || !rolling28
    || latest.status !== "available"
    || rolling7.status !== "available"
    || rolling28.status !== "available"
    || latest.actualKwh === null || latest.baselineKwh === null
    || latest.deltaKwh === null || latest.relativePct === null
    || rolling7.actualKwh === null || rolling7.baselineKwh === null
    || rolling7.deltaKwh === null || rolling7.relativePct === null
    || rolling28.actualKwh === null || rolling28.baselineKwh === null
    || rolling28.deltaKwh === null || rolling28.relativePct === null) return null;
  const dataCutoff = rolling28.period.toLocalDate;
  const horizons: NgeeAnnAiRunInput["horizons"] = [
    {
      horizon: "1d",
      period: latest.period,
      actualKwh: latest.actualKwh,
      baselineKwh: latest.baselineKwh,
      deltaKwh: latest.deltaKwh,
      relativePct: latest.relativePct,
    },
    {
      horizon: "7d",
      period: rolling7.period,
      actualKwh: rolling7.actualKwh,
      baselineKwh: rolling7.baselineKwh,
      deltaKwh: rolling7.deltaKwh,
      relativePct: rolling7.relativePct,
    },
    {
      horizon: "28d",
      period: rolling28.period,
      actualKwh: rolling28.actualKwh,
      baselineKwh: rolling28.baselineKwh,
      deltaKwh: rolling28.deltaKwh,
      relativePct: rolling28.relativePct,
    },
  ];
  const identityKey = [
    snapshot.context.userId,
    snapshot.context.workspaceId,
    snapshot.context.projectId,
    snapshot.context.scopeId,
    snapshot.context.resource,
    snapshot.dataSnapshot.id,
    dataCutoff,
    snapshot.projectRelease.id,
    snapshot.renderer.key,
    snapshot.renderer.version,
    snapshot.context.hierarchyRevisionId,
    snapshot.context.meterMappingRevisionId,
    snapshot.context.meterFormulaRevisionId,
    snapshot.context.metricVersion,
    snapshot.context.businessCalendarVersion,
    snapshot.context.tariffScheduleVersion,
    `ngee-ann-ai-output-contract@${NGEE_ANN_AI_OUTPUT_CONTRACT_REVISION}`,
  ].join(":");
  return {
    identityKey,
    projectId: snapshot.context.projectId,
    projectName: snapshot.context.projectName,
    scopeId: snapshot.context.scopeId,
    scopeName: snapshot.context.scopeName,
    resource: "electricity",
    timezone: snapshot.context.timezone,
    snapshotId: snapshot.dataSnapshot.id,
    projectReleaseId: snapshot.projectRelease.id,
    dataCutoff,
    analysisFrom: shiftLocalDate(dataCutoff, -55),
    analysisTo: dataCutoff,
    deterministicProjection: decisionPriorities,
    dataQuality: buildAiDataQuality(snapshot),
    horizons,
    discoveryEvidence: buildNgeeAnnDiscoveryEvidenceBundle({ snapshot, horizons, dataCutoff }),
  };
}

export function getOrStartNgeeAnnAiRun(
  input: NgeeAnnAiRunInput,
  onProgress?: NgeeAnnAiProgressCallback,
): Promise<NgeeAnnAiRunResult> {
  const existing = currentRuns.get(input.identityKey);
  if (existing) {
    onProgress?.(existing.progress);
    if (onProgress && !existing.settled) existing.listeners.add(onProgress);
    return existing.promise;
  }
  const listeners = new Set<NgeeAnnAiProgressCallback>();
  if (onProgress) listeners.add(onProgress);
  const current: CurrentRun = {
    promise: Promise.resolve({ status: "unavailable", reason: "The AI Analyst did not start." }),
    progress: "inspecting",
    listeners,
    settled: false,
  };
  onProgress?.("inspecting");
  const reportProgress = (progress: NgeeAnnAiProgress) => {
    if (current.progress === progress) return;
    current.progress = progress;
    for (const listener of current.listeners) listener(progress);
  };
  current.promise = restoreOrExecuteNgeeAnnAiRun(input, reportProgress).catch((error: unknown) => ({
    status: "unavailable" as const,
    reason: toFriendlyNgeeAnnAiUnavailableReason(readableError(error)),
  })).finally(() => {
    current.settled = true;
    current.listeners.clear();
  });
  currentRuns.set(input.identityKey, current);
  return current.promise;
}

export async function executeNgeeAnnAiRun(
  input: NgeeAnnAiRunInput,
  onProgress?: NgeeAnnAiProgressCallback,
  prepared: { profileId?: string; threadId?: string } = {},
): Promise<NgeeAnnAiRunResult> {
  let progress: NgeeAnnAiProgress | null = null;
  const reportProgress = (next: NgeeAnnAiProgress) => {
    const order: Record<NgeeAnnAiProgress, number> = { inspecting: 0, querying: 1, drafting: 2 };
    if (progress && order[next] <= order[progress]) return;
    progress = next;
    onProgress?.(next);
  };
  reportProgress("inspecting");
  const profileId = prepared.profileId ?? (await configApi.getRunDefaults()).activeLlmProfileId;
  if (!profileId) {
    return { status: "unavailable", reason: "No current Workspace model profile is configured." };
  }
  const runId = `ngee-ann-overview-${crypto.randomUUID()}`;
  const threadId = prepared.threadId ?? await buildNgeeAnnAiSessionId(input);
  const response = await fetch(getAgentRuntimeUrl(), {
    method: "POST",
    ...(isPasswordAuthMode() ? { credentials: "same-origin" as RequestCredentials } : {}),
    headers: {
      Accept: "text/event-stream",
      "Content-Type": "application/json",
      ...configApiIdentityHeaders(),
      ...configApiCsrfHeaders("POST"),
    },
    body: JSON.stringify(buildAgentRunBody(input, profileId, runId, threadId)),
    signal: AbortSignal.timeout(300_000),
  });
  if (!response.ok) {
    return { status: "unavailable", reason: `AI Analyst request failed (${response.status}).` };
  }
  const eventStream = await readAgUiEventStream(response, (event) => {
    const toolName = stringValue(event.toolCallName) ?? stringValue(event.tool_call_name);
    if (event.type === "TOOL_CALL_START" && toolName === "inspect_schema") {
      reportProgress("inspecting");
    }
    if (event.type === "TOOL_CALL_START" && toolName === "run_sql_readonly") {
      reportProgress("querying");
    }
    if (
      event.type === "TOOL_CALL_RESULT"
      && toolName === "run_sql_readonly"
      && parseSqlToolResult(event.result ?? event.content)
    ) {
      reportProgress("drafting");
    }
  });
  return resolveNgeeAnnAiEventStream({
    eventStream,
    input,
    providerProfileId: profileId,
    runId,
  });
}

async function restoreOrExecuteNgeeAnnAiRun(
  input: NgeeAnnAiRunInput,
  onProgress?: NgeeAnnAiProgressCallback,
): Promise<NgeeAnnAiRunResult> {
  const threadId = await buildNgeeAnnAiSessionId(input);
  let persisted = await probePersistedNgeeAnnAiRun(input, threadId);
  if (persisted.result) {
    onProgress?.("drafting");
    return persisted.result;
  }
  for (let attempt = 0; persisted.active && attempt < ACTIVE_RUN_POLL_LIMIT; attempt += 1) {
    await delay(ACTIVE_RUN_POLL_INTERVAL_MS);
    persisted = await probePersistedNgeeAnnAiRun(input, threadId);
    if (persisted.result) {
      onProgress?.("drafting");
      return persisted.result;
    }
  }
  if (persisted.active) {
    return { status: "unavailable", reason: "The existing AI analysis did not finish within the bounded wait." };
  }
  const defaults = await configApi.getRunDefaults();
  if (!defaults.activeLlmProfileId) {
    return { status: "unavailable", reason: "No current Workspace model profile is configured." };
  }
  const executed = await executeNgeeAnnAiRun(input, onProgress, {
    profileId: defaults.activeLlmProfileId,
    threadId,
  });
  if (executed.status === "available" || executed.reason !== "The AI Analyst Run did not finish.") {
    return executed;
  }

  // Another browser tab can pass the initial persisted-session probe before the
  // winning Run is visible. The runtime rejects the duplicate thread start, so
  // the losing tab follows the winner's persisted result instead of surfacing a
  // false unavailable state.
  persisted = await probePersistedNgeeAnnAiRun(input, threadId);
  for (let attempt = 0; attempt < ACTIVE_RUN_POLL_LIMIT; attempt += 1) {
    if (persisted.result) {
      onProgress?.("drafting");
      return persisted.result;
    }
    if (!persisted.active && attempt >= 1) break;
    await delay(ACTIVE_RUN_POLL_INTERVAL_MS);
    persisted = await probePersistedNgeeAnnAiRun(input, threadId);
  }
  if (persisted.result) {
    onProgress?.("drafting");
    return persisted.result;
  }
  return executed;
}

async function buildNgeeAnnAiSessionId(input: NgeeAnnAiRunInput): Promise<string> {
  const bytes = new TextEncoder().encode(`ngee-ann-overview-ai-slot\u0000${input.identityKey}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const suffix = [...new Uint8Array(digest)].slice(0, 16)
    .map((value) => value.toString(16).padStart(2, "0")).join("");
  return `energyiq-overview-slot-${input.projectId}-${suffix}`;
}

async function probePersistedNgeeAnnAiRun(
  input: NgeeAnnAiRunInput,
  threadId: string,
): Promise<{ active: boolean; result: Extract<NgeeAnnAiRunResult, { status: "available" }> | null }> {
  let conversation: SessionConversationDto;
  try {
    conversation = await configApi.getSessionConversation(threadId, 200);
  } catch (error) {
    if (error instanceof ConfigApiError && error.status === 404) {
      return { active: false, result: null };
    }
    throw error;
  }
  const completed = [...(conversation.checkpoints ?? [])]
    .filter((checkpoint) => checkpoint.status === "completed" && checkpoint.terminalEvent === "RUN_FINISHED")
    .sort((left, right) => (right.finishedAt ?? "").localeCompare(left.finishedAt ?? ""));
  if (completed.length === 0) {
    return { active: Boolean(conversation.activeRun), result: null };
  }
  const trace = await configApi.getSessionTraceDag(threadId, 200);
  for (const checkpoint of completed) {
    const result = resolveNgeeAnnAiEventStream({
      eventStream: persistedEventStream(conversation, trace, checkpoint.runId),
      input,
      providerProfileId: PERSISTED_WORKSPACE_PROFILE_ID,
      runId: checkpoint.runId,
    });
    if (result.status === "available") {
      return { active: Boolean(conversation.activeRun), result };
    }
  }
  return { active: Boolean(conversation.activeRun), result: null };
}

function persistedEventStream(
  conversation: SessionConversationDto,
  trace: TraceDagDto,
  runId: string,
): string {
  const toolEvents = trace.nodes
    .filter((node) => node.runId === runId && node.kind === "tool" && node.detail?.type === "tool")
    .sort((left, right) => (left.eventSeq ?? 0) - (right.eventSeq ?? 0))
    .flatMap<AgUiEvent>((node) => {
      if (node.detail?.type !== "tool") return [];
      const toolCallId = node.toolCallId ?? node.id;
      const toolCallName = node.detail.toolName ?? node.label.replace(/^Tool:\s*/u, "");
      const result = node.detail.result ?? node.detail.resultText;
      return [
        {
          type: "TOOL_CALL_START",
          toolCallId,
          toolCallName,
          ...(node.detail.arguments !== undefined ? { args: node.detail.arguments } : {}),
          ...(node.detail.argumentsText ? { argsText: node.detail.argumentsText } : {}),
        },
        { type: "TOOL_CALL_RESULT", toolCallId, toolCallName, result },
      ];
    });
  const traceMessageEvents = trace.nodes
    .filter((node) => node.runId === runId
      && node.kind === "context"
      && node.detail?.type === "context"
      && Boolean(node.detail.assistantOutput))
    .sort((left, right) => (left.eventSeq ?? 0) - (right.eventSeq ?? 0))
    .flatMap<AgUiEvent>((node) => node.detail?.type === "context" && node.detail.assistantOutput
      ? [{ type: "TEXT_MESSAGE_CONTENT", delta: node.detail.assistantOutput }]
      : []);
  const conversationMessages = conversation.messages
    .filter((message) => message.runId === runId && message.role === "assistant" && message.contentText)
    .sort((left, right) => left.position - right.position);
  const conversationIsComplete = conversationMessages.length > 0
    && conversationMessages.every((message) => !message.contentText.includes("[conversation message truncated:"));
  const messageEvents = conversationIsComplete
    ? conversationMessages.map<AgUiEvent>((message) => ({ type: "TEXT_MESSAGE_CONTENT", delta: message.contentText }))
    : traceMessageEvents;
  return [...toolEvents, ...messageEvents, { type: "RUN_FINISHED" }]
    .map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readAgUiEventStream(
  response: Response,
  onEvent: (event: AgUiEvent) => void,
): Promise<string> {
  const readBufferedFallback = async () => {
    const text = await response.text();
    for (const event of parseAgUiEventStream(text)) onEvent(event);
    return text;
  };
  if (!response.body) return readBufferedFallback();
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = response.body.getReader();
  } catch {
    return readBufferedFallback();
  }
  const decoder = new TextDecoder();
  let eventStream = "";
  let pending = "";
  const consumeCompleteEvents = (flush = false) => {
    while (pending) {
      const separator = /\r?\n\r?\n/u.exec(pending);
      if (!separator && !flush) return;
      const end = separator ? separator.index + separator[0].length : pending.length;
      const completeEvent = pending.slice(0, end);
      pending = pending.slice(end);
      for (const event of parseAgUiEventStream(completeEvent)) onEvent(event);
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    eventStream += text;
    pending += text;
    consumeCompleteEvents();
  }
  const trailing = decoder.decode();
  eventStream += trailing;
  pending += trailing;
  consumeCompleteEvents(true);
  return eventStream;
}

export function buildAgentRunBody(
  input: NgeeAnnAiRunInput,
  profileId: string,
  runId: string,
  threadId: string,
): Record<string, unknown> {
  return {
    method: "agent/run",
    params: { agentId: "dataFoundry" },
    body: {
      threadId,
      runId,
      state: {},
      messages: [{ id: `${runId}:user`, role: "user", content: buildAgentPrompt(input) }],
      tools: [],
      context: [],
      forwardedProps: {
        externalContext: {
          source: "energyiq",
          projectId: input.projectId,
          scopeId: input.scopeId,
          resource: input.resource,
          period: "Custom",
          from: input.analysisFrom,
          to: input.analysisTo,
          expectedDataSnapshotId: input.snapshotId,
          expectedProjectReleaseId: input.projectReleaseId,
        },
        run_config: {
          protocol: { id: "data-analysis", version: "1" },
          activeLlmProfileId: profileId,
          activeSkillId: "data-analysis",
          enabledDatasourceIds: [],
          enabledKnowledgeIds: [],
          enabledMcpServerIds: [],
          enabledSkillIds: ["data-analysis"],
          skillPolicy: {
            allowedToolNames: ["inspect_schema", "run_sql_readonly"],
            deniedToolNames: ["list_data_sources", "preview_table", "skill", "skill_search", "skill_read"],
            maxSkills: 1,
            requireUserInvocable: true,
            strictSkillTools: true,
          },
        },
      },
    },
  };
}

function buildAgentPrompt(input: NgeeAnnAiRunInput): string {
  const acceptedEvidenceRefs = input.discoveryEvidence.items.map((item) => item.id);
  return [
    `Act as an autonomous energy analyst for ${input.projectName}, Scope ${input.scopeName}.`,
    `The governed analysis window is ${input.analysisFrom} through ${input.analysisTo} in ${input.timezone}; data cutoff is ${input.dataCutoff}.`,
    "Your first action must be inspect_schema. Then investigate the most decision-useful question with scoped read-only SQL against the inspected physical table. Do not call list_data_sources or preview_table. Do not use WITH/CTEs or EXTRACT syntax.",
    "Choose the investigation order and depth from the Evidence you observe. A simple question may need one successful SQL query; a complex question may need multiple distinct queries. Stop when another query would not change the conclusion, next action, or material uncertainty. Number successful SQL results consecutively from 1.",
    "The supplied deterministic Discovery Evidence is the authoritative source for official totals, comparisons, dimensions and limitations; the SQL is one autonomous cross-check, not a second truth source. Never report an unfiltered SUM(usage_kwh) as a Project total and never add total and component rows together. When calculating an official total, require quality_status='ok' and official_aggregation_eligible=TRUE.",
    "For each SQL plan, include the runtime requirement_ids it materially supports and every listed assertion_id for those requirements, including manual assertions. If a query is rejected, replan from the Tool feedback instead of repeating it.",
    "Use the official deterministic projection as context, not as a script. Return zero to three useful, semantically different Findings. Return zero when the investigation does not produce a decision-relevant, Evidence-backed angle.",
    "Use a 1d, 7d, or 28d Horizon only when it materially supports that Finding. Do not mechanically cover every Horizon, and do not repeat one angle across time scales.",
    "For every Finding state whether it supports, challenges, or is independent of the deterministic projection. Answer What, Why, How, and How to verify.",
    "How must state the next investigation or operational action. It must not restate What, Why, or the numeric Evidence in different words. How to verify must name the observed outcome, metric, or dimension that would confirm or challenge the Finding.",
    "whyKind must be Evidence, Hypothesis, or Missing Evidence. Do not invent a cause, owner, saving, ROI, device state, or commitment.",
    "Every Finding must cite the exact Evidence it actually uses. Cite Discovery item ids in evidenceRefs and successful SQL result numbers in evidenceSqlIndexes. An independent SQL-only Finding may leave evidenceRefs empty. Every declared Horizon must cite its matching horizon Evidence id. Do not attribute SQL to an unrelated Finding.",
    `Accepted evidenceRefs IDs are exactly: ${JSON.stringify(acceptedEvidenceRefs)}. Use only these exact strings in evidenceRefs and presentation block evidenceRefs. Do not cite runtime context catalog IDs such as analysis.*; if a fact is available only there, reproduce it with scoped SQL and cite its successful evidenceSqlIndexes, or omit it.`,
    "Every Finding must include a horizons array. Use horizons:[] when no 1d, 7d or 28d Horizon materially supports that Finding; never omit the field.",
    "Finding text may use only numeric values directly present in that Finding's cited Discovery Evidence items or cited SQL result, or a single-step sum, difference, ratio, or percentage computed from those values. Never report a multi-step derived number such as normalizing values and then comparing the normalized results.",
    "In how and howToVerify, never invent a numeric threshold, target, tolerance, percentage, duration, or time window that is absent from that Finding's cited Evidence. Verification may name the metric or dimension to monitor, but it must not introduce a new number.",
    "Include the relevant quality status or coverage fields in the SQL result used as Evidence. The supplied deterministic Overview quality summary covers only its primary period and must not be claimed as the quality of the full AI lookback.",
    "Category, Circuit, daily, time and operating dimensions are available investigation options, not quotas. Prefer the strongest decision-relevant change or pattern, not the largest absolute consumer by default. Do not claim Category or Circuit has complete 1d/7d/28d deltas when the cited item says Primary Period only.",
    "After the useful investigation is complete, return the required strict JSON without commentary.",
    AI_FINDING_PRESENTATION_PROMPT,
    "Return only strict JSON with no markdown or commentary using this shape:",
    '{"findings":[{"relationship":"supports","horizons":["1d","7d"],"title":"...","what":"...","whyKind":"Evidence","why":"...","how":"...","howToVerify":"...","evidenceNote":"what the cited Evidence supports or cannot prove","evidenceRefs":["horizon:1d","category:load"],"evidenceSqlIndexes":[1],"presentation":{"version":"1","blocks":[{"type":"comparison","prominence":"primary","title":"Current versus previous","unit":"kWh","items":[{"label":"Current","value":0},{"label":"Previous","value":0}],"evidenceRefs":["horizon:1d"],"evidenceSqlIndexes":[1]}]}}]}',
    "Bounded Ngee Ann Discovery Evidence Bundle:",
    JSON.stringify(input.discoveryEvidence),
    "Official deterministic projection:",
    JSON.stringify(input.deterministicProjection),
  ].join("\n\n");
}

export function parseAgUiEventStream(text: string): AgUiEvent[] {
  return text
    .split(/\r?\n\r?\n/u)
    .map((chunk) => chunk
      .split(/\r?\n/u)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart())
      .join("\n")
      .trim())
    .filter((data) => data && data !== "[DONE]")
    .flatMap((data) => {
      try {
        const parsed: unknown = JSON.parse(data);
        return isRecord(parsed) ? [parsed] : [];
      } catch {
        return [];
      }
    });
}

export function resolveNgeeAnnAiEventStream(input: {
  eventStream: string;
  input: NgeeAnnAiRunInput;
  providerProfileId: string;
  runId: string;
}): NgeeAnnAiRunResult {
  const events = parseAgUiEventStream(input.eventStream);
  const runError = events.findLast((event) => event.type === "RUN_ERROR");
  if (runError) {
    return {
      status: "unavailable",
      reason: toFriendlyNgeeAnnAiUnavailableReason(
        stringValue(runError.message) ?? "The AI Analyst Run failed.",
      ),
    };
  }
  if (!events.some((event) => event.type === "RUN_FINISHED")) {
    return { status: "unavailable", reason: "The AI Analyst Run did not finish." };
  }
  const collected = collectToolEvidence(events);
  const tools = collected.tools;
  const sqlTools = tools.filter((tool) => tool.toolName === "run_sql_readonly");
  if (!collected.schemaValid || sqlTools.length < 1) {
    return { status: "unavailable", reason: "The AI Analyst did not complete a grounded read-only SQL investigation." };
  }
  if (!discoveryEvidenceMatchesInput(input.input)) {
    return { status: "unavailable", reason: "The deterministic Discovery Evidence does not match this Run identity." };
  }
  const answer = events
    .filter((event) => event.type === "TEXT_MESSAGE_CONTENT")
    .map((event) => stringValue(event.delta) ?? "")
    .join("")
    .trim();
  const generated = parseGeneratedFindings(answer);
  if (!generated) {
    return { status: "unavailable", reason: "The AI response could not be verified against this Snapshot." };
  }
  const evidenceById = new Map(input.input.discoveryEvidence.items.map((item) => [item.id, item]));
  const rejected = {
    horizon: false,
    deterministicEvidence: false,
    sqlEvidence: false,
    numericEvidence: false,
  };
  const verified = generated.flatMap((finding) => {
    if (finding.horizons.some((horizon) => !finding.evidenceRefs.includes(`horizon:${horizon}`))) {
      rejected.horizon = true;
      return [];
    }
    const deterministic = finding.evidenceRefs
      .map((reference) => evidenceById.get(reference))
      .filter((item): item is NgeeAnnDiscoveryEvidenceItem => Boolean(item));
    if (deterministic.length !== finding.evidenceRefs.length) {
      rejected.deterministicEvidence = true;
      return [];
    }
    const findingTools = finding.evidenceSqlIndexes
      .map((index) => sqlTools[index - 1])
      .filter((tool): tool is CollectedToolEvidence => Boolean(tool));
    if (findingTools.length !== finding.evidenceSqlIndexes.length) {
      rejected.sqlEvidence = true;
      return [];
    }
    const presentation = materializeNgeeAnnPresentation(finding, evidenceById, sqlTools);
    if (presentation) finding.presentation = presentation;
    else delete finding.presentation;
    if (narrativeHasUnsupportedNumber(finding, deterministic, findingTools)) {
      rejected.numericEvidence = true;
      return [];
    }
    return [{ finding, deterministic, tools: findingTools }];
  });
  if (generated.length > 0 && verified.length === 0) {
    if (rejected.horizon) {
      return {
        status: "unavailable",
        reason: "A Finding declared a Horizon without its matching deterministic Evidence.",
      };
    }
    if (rejected.deterministicEvidence) {
      return { status: "unavailable", reason: "A Finding cited deterministic Evidence that is not present in this Snapshot." };
    }
    if (rejected.sqlEvidence) {
      return { status: "unavailable", reason: "A Finding cited SQL Evidence that is not present in this Run." };
    }
    if (rejected.numericEvidence) {
      return { status: "unavailable", reason: "The AI Analyst returned a numeric claim without Finding-specific Evidence." };
    }
  }
  const findings = verified.map<NgeeAnnAiFinding>(({ finding, deterministic, tools: findingTools }, index) => ({
    id: `ai-finding-${index + 1}`,
    relationship: finding.relationship,
    horizons: finding.horizons,
    title: finding.title,
    what: finding.what,
    why: { kind: finding.whyKind, text: finding.why },
    how: finding.how,
    howToVerify: finding.howToVerify,
    evidenceNote: finding.evidenceNote,
    ...(finding.presentation ? { presentation: finding.presentation } : {}),
    evidence: {
      snapshotId: input.input.snapshotId,
      dataCutoff: input.input.dataCutoff,
      dataQuality: input.input.dataQuality,
      deterministic,
      tools: findingTools.map((tool, toolIndex) => toPublicToolEvidence(
        tool,
        finding.evidenceSqlIndexes[toolIndex]!,
      )),
    },
  }));
  return {
    status: "available",
    providerProfileId: input.providerProfileId,
    runId: input.runId,
    findings,
  };
}

function collectToolEvidence(events: AgUiEvent[]): {
  tools: CollectedToolEvidence[];
  schemaValid: boolean;
  sqlAttemptCount: number;
} {
  const accumulators = new Map<string, ToolAccumulator>();
  for (const event of events) {
    const id = stringValue(event.toolCallId) ?? stringValue(event.tool_call_id);
    if (!id) continue;
    const existing = accumulators.get(id) ?? {
      id,
      name: stringValue(event.toolCallName) ?? stringValue(event.tool_call_name) ?? "unknown",
      argsText: "",
      args: null,
      result: undefined,
    };
    existing.name = stringValue(event.toolCallName) ?? stringValue(event.tool_call_name) ?? existing.name;
    if (event.type === "TOOL_CALL_ARGS") {
      existing.argsText += stringValue(event.delta) ?? "";
    }
    if (isRecord(event.args)) existing.args = event.args;
    if (isRecord(event.parameters)) existing.args = event.parameters;
    if (event.type === "TOOL_CALL_RESULT") {
      existing.result = event.result ?? event.content;
    }
    accumulators.set(id, existing);
  }
  const attempts = [...accumulators.values()];
  const tools = attempts.flatMap<CollectedToolEvidence>((tool) => {
    if (tool.name !== "inspect_schema" && tool.name !== "run_sql_readonly") return [];
    if (tool.argsText && !tool.args) {
      try {
        const parsed: unknown = JSON.parse(tool.argsText);
        if (isRecord(parsed)) tool.args = parsed;
      } catch {}
    }
    if (tool.result === undefined) return [];
    const parsedSchema = tool.name === "inspect_schema" ? parseSchemaToolResult(tool.result) : null;
    const parsedSql = tool.name === "run_sql_readonly" ? parseSqlToolResult(tool.result) : null;
    if (tool.name === "inspect_schema" && !parsedSchema) return [];
    if (tool.name === "run_sql_readonly" && !parsedSql) return [];
    const preview = typeof tool.result === "string" ? tool.result : JSON.stringify(tool.result);
    return [{
      toolCallId: tool.id,
      toolName: tool.name,
      sql: tool.name === "run_sql_readonly" ? sqlFromToolPayload(tool.args, tool.result) ?? null : null,
      rowCount: parsedSql?.row_count ?? null,
      auditLogId: parsedSql?.audit_log_id ?? null,
      elapsedMs: parsedSql?.elapsed_ms ?? null,
      resultPreview: preview.slice(0, 2_000),
      // Keep adjacent array cells separated by whitespace. Compact JSON such as
      // `[96768,0,9736.4214]` makes the numeric tokenizer interpret cell
      // delimiters as thousands separators and hides otherwise exact Evidence.
      numericEvidence: parsedSql ? JSON.stringify(parsedSql.rows, null, 1) : "",
    }];
  });
  return {
    tools,
    schemaValid: tools.some((tool) => tool.toolName === "inspect_schema"),
    sqlAttemptCount: attempts.filter((tool) => tool.name === "run_sql_readonly").length,
  };
}

function toPublicToolEvidence(tool: CollectedToolEvidence, evidenceIndex: number): NgeeAnnAiToolEvidence {
  return {
    evidenceIndex,
    toolCallId: tool.toolCallId,
    toolName: tool.toolName,
    sql: tool.sql,
    rowCount: tool.rowCount,
    auditLogId: tool.auditLogId,
    elapsedMs: tool.elapsedMs,
    resultPreview: tool.resultPreview,
  };
}

type GeneratedFinding = {
  relationship: NgeeAnnAiRelationship;
  horizons: NgeeAnnAiHorizon[];
  title: string;
  what: string;
  whyKind: NgeeAnnAiWhyKind;
  why: string;
  how: string;
  howToVerify: string;
  evidenceNote: string;
  evidenceRefs: string[];
  evidenceSqlIndexes: number[];
  presentation?: AiFindingPresentation;
};

function parseGeneratedFindings(answer: string): GeneratedFinding[] | null {
  const parsed = findLastFindingsEnvelope(answer);
  if (!isRecord(parsed) || !Array.isArray(parsed.findings) || parsed.findings.length > 3) return null;
  const findings = parsed.findings.flatMap<GeneratedFinding>((value) => {
    if (!isRecord(value)) return [];
    const relationship = stringValue(value.relationship);
    const whyKind = stringValue(value.whyKind);
    const horizons = parseHorizons(value.horizons);
    const evidenceRefs = parseEvidenceRefs(value.evidenceRefs);
    const evidenceSqlIndexes = parseOptionalEvidenceIndexes(value.evidenceSqlIndexes);
    const title = cleanText(value.title);
    const what = cleanText(value.what);
    const why = cleanText(value.why);
    const how = cleanText(value.how);
    const howToVerify = cleanText(value.howToVerify);
    const evidenceNote = cleanText(value.evidenceNote);
    const presentation = parseAiFindingPresentation(value.presentation);
    if ((relationship !== "supports" && relationship !== "challenges" && relationship !== "independent")
      || (whyKind !== "Evidence" && whyKind !== "Hypothesis" && whyKind !== "Missing Evidence")
      || horizons === null || evidenceRefs === null || evidenceSqlIndexes === null
      || (evidenceRefs.length === 0 && evidenceSqlIndexes.length === 0)
      || !title || !what || !why || !how || !howToVerify || !evidenceNote) return [];
    return [{
      relationship,
      horizons,
      title,
      what,
      whyKind,
      why,
      how,
      howToVerify,
      evidenceNote,
      evidenceRefs,
      evidenceSqlIndexes,
      ...(presentation ? { presentation } : {}),
    }];
  });
  if (findings.length !== parsed.findings.length) return null;
  const semanticKeys = findings.map((finding) => `${finding.title} ${finding.what}`
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim());
  if (new Set(semanticKeys).size !== semanticKeys.length) return null;
  return findings;
}

function findLastFindingsEnvelope(answer: string): Record<string, unknown> | null {
  for (let start = answer.lastIndexOf("{"); start >= 0; start = answer.lastIndexOf("{", start - 1)) {
    const parsed = parseJsonObjectAt(answer, start);
    if (isRecord(parsed) && Object.hasOwn(parsed, "findings")) return parsed;
  }
  return null;
}

function parseJsonObjectAt(value: string, start: number): unknown {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index]!;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === "\"") {
        inString = false;
      }
      continue;
    }
    if (character === "\"") {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(value.slice(start, index + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function parseHorizons(value: unknown): NgeeAnnAiHorizon[] | null {
  if (!Array.isArray(value)) return null;
  const horizons = value.filter((candidate): candidate is NgeeAnnAiHorizon => (
    candidate === "1d" || candidate === "7d" || candidate === "28d"
  ));
  return horizons.length === value.length ? [...new Set(horizons)] : null;
}

function parseOptionalEvidenceIndexes(value: unknown): number[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const indexes = value.filter((candidate): candidate is number => (
    typeof candidate === "number" && Number.isSafeInteger(candidate) && candidate > 0
  ));
  return indexes.length === value.length ? [...new Set(indexes)] : null;
}

function parseEvidenceRefs(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const references = value.flatMap((candidate) => {
    const reference = cleanText(candidate);
    return reference ? [reference] : [];
  });
  return references.length === value.length ? [...new Set(references)] : null;
}

function narrativeHasUnsupportedNumber(
  finding: GeneratedFinding,
  evidenceItems: NgeeAnnDiscoveryEvidenceItem[],
  tools: CollectedToolEvidence[],
): boolean {
  const narrative = [
    finding.title,
    finding.what,
    finding.why,
    finding.how,
    finding.howToVerify,
    finding.evidenceNote,
    aiFindingPresentationEvidenceText(finding.presentation),
  ].join(" ");
  return textHasUnsupportedNumber(narrative, evidenceItems, tools);
}

function materializeNgeeAnnPresentation(
  finding: GeneratedFinding,
  evidenceById: ReadonlyMap<string, NgeeAnnDiscoveryEvidenceItem>,
  sqlTools: CollectedToolEvidence[],
): AiFindingPresentation | null {
  const scoped = filterAiFindingPresentationEvidence(finding.presentation, {
    evidenceRefs: finding.evidenceRefs,
    evidenceSqlIndexes: finding.evidenceSqlIndexes,
  });
  if (!scoped) return null;
  const blocks = scoped.blocks.filter((block) => {
    const evidenceItems = (block.evidenceRefs ?? []).flatMap((reference) => {
      const item = evidenceById.get(reference);
      return item ? [item] : [];
    });
    const tools = (block.evidenceSqlIndexes ?? []).flatMap((index) => {
      const tool = sqlTools[index - 1];
      return tool ? [tool] : [];
    });
    return !textHasUnsupportedNumber(
      aiFindingPresentationEvidenceText({ version: "1", blocks: [block] }),
      evidenceItems,
      tools,
    );
  });
  return blocks.length > 0 ? { version: "1", blocks } : null;
}

function textHasUnsupportedNumber(
  narrative: string,
  evidenceItems: NgeeAnnDiscoveryEvidenceItem[],
  tools: CollectedToolEvidence[],
): boolean {
  const evidenceNumbers = toNumericTokens([
    ...tools.map((tool) => tool.numericEvidence),
    ...evidenceItems.map((item) => JSON.stringify({
      id: item.id,
      label: item.label,
      period: item.period,
      values: item.values,
      quality: item.quality,
    })),
  ].join(" "))
    .map((token) => token.value);
  return toNumericTokens(narrative).some((token) => !numericClaimIsVerified(token, evidenceNumbers));
}

function discoveryEvidenceMatchesInput(input: NgeeAnnAiRunInput): boolean {
  const identity = input.discoveryEvidence.identity;
  return identity.snapshotId === input.snapshotId
    && identity.dataCutoff === input.dataCutoff
    && identity.projectReleaseId === input.projectReleaseId
    && identity.timezone === input.timezone
    && [
      identity.projectReleaseId,
      identity.hierarchyRevisionId,
      identity.meterMappingRevisionId,
      identity.meterFormulaRevisionId,
      identity.metricVersion,
      identity.businessCalendarVersion,
    ].every((pin) => input.identityKey.includes(pin));
}

function numericClaimIsVerified(
  claim: { precision: number; value: number },
  evidence: number[],
): boolean {
  if (evidence.some((value) => numericValuesMatch(claim, value))) return true;
  for (const left of evidence) {
    for (const right of evidence) {
      const candidates = [
        left + right,
        left - right,
        right - left,
        ...(right !== 0 ? [left / right, (left / right) * 100, ((left - right) / right) * 100] : []),
      ];
      if (candidates.some((value) => Number.isFinite(value) && derivedNumericValueMatches(claim, value))) {
        return true;
      }
    }
  }
  return false;
}

function numericValuesMatch(
  claim: { precision: number; value: number },
  evidence: number,
): boolean {
  const tolerance = (0.5 * (10 ** -claim.precision)) + Number.EPSILON;
  return Math.abs(evidence - claim.value) <= tolerance;
}

function derivedNumericValueMatches(
  claim: { precision: number; value: number },
  evidence: number,
): boolean {
  const tolerance = 10 ** -claim.precision;
  // A candidate exactly one displayed unit away is not supporting Evidence.
  return Math.abs(evidence - claim.value) < tolerance;
}

function toNumericTokens(value: string): Array<{ precision: number; value: number }> {
  return (value.match(/[-+]?\d[\d,]*(?:\.\d+)?/gu) ?? []).flatMap((token) => {
    const normalized = token.replace(/,/gu, "");
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) return [];
    return [{
      precision: normalized.includes(".") ? normalized.split(".")[1]!.length : 0,
      value: parsed,
    }];
  });
}

function buildAiDataQuality(snapshot: EnergyProjectAnalysisSnapshotDto): NgeeAnnAiDataQuality {
  const quality = snapshot.dataQuality;
  const limitation = quality.status === "complete"
    ? "No data-quality limitation is declared for this Snapshot."
    : quality.status === "partial"
      ? "Coverage or quality events make this Snapshot partial; interpret AI Findings within that limitation."
      : "Snapshot data quality is unavailable; AI Findings cannot be treated as complete Evidence.";
  return {
    status: quality.status,
    scope: "deterministic-overview-period",
    period: {
      from: snapshot.context.primaryPeriod.start,
      to: snapshot.context.primaryPeriod.endExclusive,
    },
    coveragePct: quality.coveragePct,
    validIntervalCount: quality.validIntervalCount,
    expectedMeterIntervalCount: quality.expectedMeterIntervalCount,
    qualityEventCount: quality.qualityEventCount,
    limitation: `${limitation} This summary covers only the deterministic Overview primary period, not the full AI lookback; use each cited SQL result for query-specific quality.`,
  };
}

function shiftLocalDate(localDate: string, days: number): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function cleanText(value: unknown): string | null {
  const text = stringValue(value)?.replace(/\s+/gu, " ").trim();
  return text && text.length <= 800 ? text : null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readableError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "The AI Analyst is unavailable for this Snapshot.";
}

export function toFriendlyNgeeAnnAiUnavailableReason(reason: string): string {
  const trimmed = reason.trim();
  if (!trimmed) return FRIENDLY_AI_UNAVAILABLE_REASON;
  const containsRuntimeCode = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/u.test(trimmed);
  const containsTransportFailure = /\b(?:timeout|timed out|network error|failed to fetch)\b/iu.test(trimmed);
  return containsRuntimeCode || containsTransportFailure
    ? FRIENDLY_AI_UNAVAILABLE_REASON
    : trimmed;
}
