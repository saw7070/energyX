import type {
  EnergyIqOverviewAiArtifactRecord,
  MetadataStore,
  RunEventRecord,
  RunRecord,
  UserRecord,
} from "@datafoundry/metadata";
import { createHash } from "node:crypto";

import { createSkillLoadedAuditEventId, type SkillLoadedAuditCapture } from "../run-config-audit.js";

export type ProjectAiOperationsState = {
  project: {
    id: string;
    name: string;
    workspaceId: string;
  };
  runs: ProjectAiRunSummary[];
  selectedRun: ProjectAiRunDetail | null;
  pagination: {
    limit: number;
    returned: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
};

export type ProjectAiRunSummary = {
  runId: string;
  actorId: string;
  sessionId: string;
  status: RunRecord["status"];
  stage: string | null;
  modelProvider: string | null;
  modelName: string | null;
  startedAt: string;
  finishedAt: string | null;
  latencyMs: number | null;
  parentRunId: string | null;
  errorCode: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  toolCounts: {
    called: number;
    succeeded: number;
    rejected: number;
    failed: number;
  } | null;
  traceAvailability: "available" | "partial" | "unavailable" | "detail-required";
};

export type ProjectAiRunDetail = ProjectAiRunSummary & {
  historicalConfiguration: {
    status: "available" | "unavailable";
    detail: string;
    modelProfileId: string | null;
    resourceRevisions: Record<string, number>;
    selectedSkills: Array<{ id: string; name: string; revision: number }>;
    selectionAudit: { selected: number; rejected: number; unavailable: number };
    materializedSkills: {
      status: "available" | "unavailable";
      items: Array<{ id: string; revision: number | null }>;
    };
    loadedSkills: {
      status: "available" | "unavailable";
      items: Array<{
        contentSha256: string | null;
        detail: string;
        evidenceStatus: "available" | "unavailable";
        id: string;
        loadSource: string | null;
        loadStage: string | null;
        name: string | null;
        ownerScope: "builtin" | "user" | "workspace" | null;
        ownerUserId: string | null;
        ownerWorkspaceId: string | null;
        packageRef: string | null;
        revision: number | null;
        semanticVersion: string | null;
      }>;
    };
    mcp: {
      enabledServerIds: string[];
      serverToolMapping: {
        status: "available" | "unavailable";
        items: Array<{ serverId: string; toolNames: string[] }>;
      };
    };
  };
  context: {
    status: "available" | "unavailable";
    steps: Array<{
      stepNumber: number;
      packageId: string | null;
      packageRevision: number | null;
      planId: string | null;
      selectedGroupCount: number;
      omittedGroupCount: number;
      selectedSourceTypes: string[];
      omittedSourceTypes: string[];
      truncationDecisionCount: number;
      promptTokens: number | null;
      inputBudget: number | null;
      contextWindow: number | null;
      remainingTokens: number | null;
      capabilitySource: string | null;
      highWaterMark: string | null;
    }>;
  };
  modelRequests: {
    status: "available" | "partial" | "unavailable";
    detail: string;
    items: Array<{
      stepNumber: number | null;
      retryCount: number | null;
      modelName: string | null;
      reconstructionStatus: "available" | "unavailable";
      snapshotId: string | null;
      contentSha256: string | null;
      contextPackageId: string | null;
      contextPackageRevision: number | null;
      toolNames: string[];
      payloadAvailability: "not-retained" | "retained" | null;
    }>;
  };
  tools: Array<{
    toolCallId: string;
    name: string;
    status: "called" | "succeeded" | "rejected" | "failed";
    startedAt: string | null;
    finishedAt: string | null;
  }>;
  tokens: {
    status: "available" | "unavailable";
    input: number | null;
    output: number | null;
    total: number | null;
    cache: {
      status: "available" | "unavailable";
      hit: number | null;
      miss: number | null;
    };
  };
  lineage: {
    artifacts: Array<{ id: string; type: string; name: string }>;
    energyIqArtifacts: Array<{
      id: string;
      kind: string;
      targetId: string | null;
      findingIds: string[];
    }>;
  };
};

export type ProjectAiOperationsReader = {
  readProjectAiOperations(
    projectId: string,
    filters?: { actorId?: string; runId?: string; limit?: number; cursor?: string },
  ): ProjectAiOperationsState;
};

export const createProjectAiOperationsReader = (input: {
  metadataStore: MetadataStore;
  user: UserRecord;
  workspaceId: string;
}): ProjectAiOperationsReader => ({
  readProjectAiOperations(projectId, filters = {}) {
    requireAdmin(input.metadataStore, input.user);
    const project = input.metadataStore.energyIq.getProject(projectId);
    if (project.workspace_id !== input.workspaceId) {
      throw new Error("ENERGYIQ_PROJECT_FORBIDDEN");
    }

    const limit = boundedPageLimit(filters.limit);
    const before = filters.cursor ? decodeRunCursor(filters.cursor) : undefined;
    const page = input.metadataStore.runs.listByProject({
      workspace_id: project.workspace_id,
      project_id: project.id,
      limit: limit + 1,
      ...(before ? { before } : {}),
    });
    const hasMore = page.length > limit;
    const runs = page.slice(0, limit);
    const summaries = runs.map(lightweightRunSummary);
    let selectedRun: ProjectAiRunDetail | null = null;
    if (filters.runId && !filters.actorId) {
      throw new Error("ENERGYIQ_AI_OPERATIONS_ACTOR_REQUIRED");
    }
    if (filters.actorId && !filters.runId) {
      throw new Error("ENERGYIQ_AI_OPERATIONS_RUN_REQUIRED");
    }
    if (filters.runId && filters.actorId) {
      const exactRun = input.metadataStore.runs.findByProjectActorRun({
        workspace_id: project.workspace_id,
        project_id: project.id,
        actor_id: filters.actorId,
        run_id: filters.runId,
      });
      if (!exactRun) throw new Error("ENERGYIQ_RUN_FORBIDDEN");
      const energyIqArtifacts = input.metadataStore.energyIq.overviewAiArtifacts.listByProject({
        workspaceId: project.workspace_id,
        projectId: project.id,
      });
      selectedRun = projectRun(
        input.metadataStore,
        project.workspace_id,
        exactRun,
        energyIqArtifacts,
      ).detail;
    }
    return {
      project: { id: project.id, name: project.name, workspaceId: project.workspace_id },
      runs: summaries,
      selectedRun,
      pagination: {
        limit,
        returned: summaries.length,
        hasMore,
        nextCursor: hasMore && runs.length > 0 ? encodeRunCursor(runs[runs.length - 1]!) : null,
      },
    };
  },
});

const DEFAULT_PAGE_LIMIT = 20;
const MAX_PAGE_LIMIT = 100;

const boundedPageLimit = (limit: number | undefined): number => {
  if (limit === undefined) return DEFAULT_PAGE_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
    throw new Error("ENERGYIQ_AI_OPERATIONS_LIMIT_INVALID");
  }
  return limit;
};

const encodeRunCursor = (run: RunRecord): string => Buffer.from(JSON.stringify({
  startedAt: run.started_at,
  runId: run.id,
  actorId: run.user_id,
}), "utf8").toString("base64url");

const decodeRunCursor = (cursor: string): { started_at: string; run_id: string; actor_id: string } => {
  try {
    if (!cursor || cursor.length > 2_048) throw new Error("invalid");
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (!isRecord(value)) throw new Error("invalid");
    const startedAt = stringValue(value.startedAt);
    const runId = stringValue(value.runId);
    const actorId = stringValue(value.actorId);
    if (!startedAt || !runId || !actorId) throw new Error("invalid");
    return { started_at: startedAt, run_id: runId, actor_id: actorId };
  } catch {
    throw new Error("ENERGYIQ_AI_OPERATIONS_CURSOR_INVALID");
  }
};

const lightweightRunSummary = (run: RunRecord): ProjectAiRunSummary => ({
  runId: run.id,
  actorId: run.user_id,
  sessionId: run.session_id,
  status: run.status,
  stage: null,
  modelProvider: run.model_provider ?? null,
  modelName: run.model_name ?? null,
  startedAt: run.started_at,
  finishedAt: run.finished_at ?? null,
  latencyMs: elapsedMs(run.started_at, run.finished_at),
  parentRunId: run.parent_run_id ?? null,
  errorCode: safeErrorCode(run),
  inputTokens: null,
  outputTokens: null,
  toolCounts: null,
  traceAvailability: "detail-required",
});

const projectRun = (
  metadataStore: MetadataStore,
  workspaceId: string,
  run: RunRecord,
  energyIqArtifacts: EnergyIqOverviewAiArtifactRecord[],
): { summary: ProjectAiRunSummary; detail: ProjectAiRunDetail } => {
  const eventRecords = metadataStore.runEvents.listByRun({ user_id: run.user_id, run_id: run.id });
  const events = eventRecords.map((record) => ({ record, value: parseRecord(record.payload_json) }));
  const configEvent = findLastCustom(events, "run.config.resolved", run.session_id);
  const configExact = configEvent !== undefined
    && exactStringValue(configEvent.value.workspace_id) === workspaceId;
  const stage = configExact ? nullableStringValue(configEvent.value.overview_ai_stage) : null;
  const tokens = tokenSummary(events);
  const tools = toolSummary(events);
  const context = contextSummary(events);
  const modelRequests = modelRequestSummary(metadataStore, run, events);
  const historicalConfiguration = configSummary(
    events,
    configExact ? configEvent?.value : undefined,
    run,
    workspaceId,
  );
  const artifacts = metadataStore.artifacts.listByRun({ user_id: run.user_id, run_id: run.id })
    .map((artifact) => ({ id: artifact.id, type: artifact.type, name: artifact.name }));
  const traceParts = [configExact, context.status === "available", events.length > 0];
  const traceAvailability = traceParts.every(Boolean)
    ? "available" as const
    : traceParts.some(Boolean)
      ? "partial" as const
      : "unavailable" as const;
  const summary: ProjectAiRunSummary = {
    runId: run.id,
    actorId: run.user_id,
    sessionId: run.session_id,
    status: run.status,
    stage,
    modelProvider: run.model_provider ?? null,
    modelName: run.model_name ?? null,
    startedAt: run.started_at,
    finishedAt: run.finished_at ?? null,
    latencyMs: elapsedMs(run.started_at, run.finished_at),
    parentRunId: run.parent_run_id ?? null,
    errorCode: safeErrorCode(run),
    inputTokens: tokens.status === "available" ? tokens.input : null,
    outputTokens: tokens.status === "available" ? tokens.output : null,
    toolCounts: {
      called: tools.length,
      succeeded: tools.filter(({ status }) => status === "succeeded").length,
      rejected: tools.filter(({ status }) => status === "rejected").length,
      failed: tools.filter(({ status }) => status === "failed").length,
    },
    traceAvailability,
  };
  return {
    summary,
    detail: {
      ...summary,
      historicalConfiguration,
      context,
      modelRequests,
      tools,
      tokens,
      lineage: { artifacts, energyIqArtifacts: energyIqLineage(run, energyIqArtifacts) },
    },
  };
};

const energyIqLineage = (
  run: RunRecord,
  artifacts: EnergyIqOverviewAiArtifactRecord[],
): ProjectAiRunDetail["lineage"]["energyIqArtifacts"] => artifacts.flatMap((artifact) => {
  if (artifact.triggered_by !== run.user_id
    || artifact.session_id !== run.session_id
    || artifact.run_id !== run.id) return [];
  const result = parseResult(artifact.result_json);
  const referencedRunIds = new Set([
    ...(artifact.run_id ? [artifact.run_id] : []),
    ...collectStringFields(result, "runId"),
  ]);
  if (!referencedRunIds.has(run.id)) return [];
  const identity = parseResult(artifact.identity_json);
  return [{
    id: artifact.id,
    kind: isRecord(identity) ? stringValue(identity.artifactKind) || artifact.analysis_pack_id : artifact.analysis_pack_id,
    targetId: isRecord(identity) ? nullableStringValue(identity.targetId) : null,
    findingIds: collectFindingIds(result),
  }];
});

const collectStringFields = (value: unknown, field: string): string[] => {
  if (Array.isArray(value)) return value.flatMap((item) => collectStringFields(item, field));
  if (!isRecord(value)) return [];
  return [
    ...(typeof value[field] === "string" && value[field].trim() ? [value[field].trim()] : []),
    ...Object.values(value).flatMap((item) => collectStringFields(item, field)),
  ];
};

const collectFindingIds = (value: unknown): string[] => [...new Set(collectArraysNamed(value, "findings")
  .flatMap((findings) => arrayRecords(findings).map((finding) => stringValue(finding.id)).filter(Boolean)))]
  .sort((left, right) => left.localeCompare(right));

const collectArraysNamed = (value: unknown, field: string): unknown[] => {
  if (Array.isArray(value)) return value.flatMap((item) => collectArraysNamed(item, field));
  if (!isRecord(value)) return [];
  return [
    ...(Array.isArray(value[field]) ? [value[field]] : []),
    ...Object.values(value).flatMap((item) => collectArraysNamed(item, field)),
  ];
};

type ParsedEvent = { record: RunEventRecord; value: Record<string, unknown> };

const configSummary = (
  events: ParsedEvent[],
  config: Record<string, unknown> | undefined,
  run: RunRecord,
  workspaceId: string,
): ProjectAiRunDetail["historicalConfiguration"] => {
  if (!config) {
    return {
      status: "unavailable",
      detail: "This Run has no Project-exact run.config.resolved event; current configuration was not substituted.",
      modelProfileId: null,
      resourceRevisions: {},
      selectedSkills: [],
      selectionAudit: { selected: 0, rejected: 0, unavailable: 0 },
      materializedSkills: { status: "unavailable", items: [] },
      loadedSkills: { status: "unavailable", items: [] },
      mcp: { enabledServerIds: [], serverToolMapping: { status: "unavailable", items: [] } },
    };
  }
  const selection = findLastCustom(events, "skill.selection", run.session_id)?.value;
  const selectedEntries = arrayRecords(selection?.selected);
  const selectedSkills = selectedEntries.flatMap((skill) => {
    const id = exactStringValue(skill.id);
    const name = exactStringValue(skill.name);
    const revision = integerValue(skill.revision);
    return id && name && revision !== undefined ? [{ id, name, revision }] : [];
  });
  const audit = arrayRecords(selection?.audit);
  const auditCount = (decision: string) => audit.filter((item) => stringValue(item.decision) === decision).length;
  const materialized = findLastCustom(events, "skill.materialized", run.session_id)?.value;
  const materializedEvidence = arrayRecords(materialized?.items).flatMap((item) => {
    const id = exactStringValue(item.id);
    if (!id) return [];
    return [{
      contentSha256: exactStringValue(item.content_sha256),
      id,
      packageRef: exactStringValue(item.package_ref),
      revision: integerValue(item.revision) ?? null,
    }];
  });
  const materializedItems = materializedEvidence.map(({ id, revision }) => ({ id, revision }));
  const enabledServerIds = stringArray(config.enabled_mcp_server_ids);
  const mapping = mcpMapping(config.mcp_tool_names_by_server_id);
  const resourceRevisions = numericRecord(config.resource_revisions);
  return {
    status: "available",
    detail: "Historical effective configuration comes only from this Run's persisted events.",
    modelProfileId: nullableStringValue(config.active_llm_profile_id),
    resourceRevisions,
    selectedSkills,
    selectionAudit: {
      selected: auditCount("selected"),
      rejected: auditCount("rejected"),
      unavailable: auditCount("unavailable") + (selectedEntries.length - selectedSkills.length),
    },
    materializedSkills: {
      status: materialized ? "available" : "unavailable",
      items: materializedItems,
    },
    loadedSkills: loadedSkillSummary({
      events,
      materializedItems: materializedEvidence,
      resourceRevisions,
      run,
      selectedSkills,
      workspaceId,
    }),
    mcp: {
      enabledServerIds,
      serverToolMapping: {
        status: mapping || enabledServerIds.length === 0 ? "available" : "unavailable",
        items: mapping ?? [],
      },
    },
  };
};

const loadedSkillSummary = (input: {
  events: ParsedEvent[];
  materializedItems: Array<{
    contentSha256: string | null;
    id: string;
    packageRef: string | null;
    revision: number | null;
  }>;
  resourceRevisions: Record<string, number>;
  run: RunRecord;
  selectedSkills: Array<{ id: string; name: string; revision: number }>;
  workspaceId: string;
}): ProjectAiRunDetail["historicalConfiguration"]["loadedSkills"] => {
  const loadedItems = input.events.flatMap(({ record, value }) => {
    if (record.session_id !== input.run.session_id) return [];
    if (!isCustom(value, "skill.loaded")) return [];
    const capture = isRecord(value.value) ? value.value : {};
    const skill = isRecord(capture.skill) ? capture.skill : {};
    const owner = isRecord(skill.owner) ? skill.owner : {};
    const exactId = exactStringValue(skill.id);
    const id = exactId ?? `unknown-skill-load:${record.seq}`;
    const name = exactStringValue(skill.name);
    const revision = integerValue(skill.config_revision) ?? null;
    const semanticVersion = exactStringValue(skill.semantic_version);
    const contentSha256 = exactStringValue(skill.content_sha256);
    const packageRef = exactStringValue(skill.package_ref);
    const ownerScope: "builtin" | "user" | "workspace" | null =
      owner.scope === "builtin" || owner.scope === "user" || owner.scope === "workspace"
        ? owner.scope
        : null;
    const ownerUserId = exactStringValue(owner.user_id);
    const ownerWorkspaceId = exactStringValue(owner.workspace_id);
    const loadSource = exactStringValue(skill.load_source);
    const loadStage = exactStringValue(skill.load_stage);
    const selected = input.selectedSkills.find((candidate) => candidate.id === id);
    const materialized = input.materializedItems.find((candidate) => candidate.id === id);
    const structurallyValid = capture.run_event_schema_version === 1
      && exactId !== null
      && name !== null
      && revision !== null
      && contentSha256 !== null
      && /^sha256:[a-f0-9]{64}$/u.test(contentSha256)
      && packageRef !== null
      && semanticVersion !== null
      && ownerScope !== null
      && ownerUserId !== null
      && ownerWorkspaceId !== null
      && loadSource === "materialized-skill-package"
      && loadStage === "agent-instruction-assembly";
    const expectedEventId = structurallyValid
      ? createSkillLoadedAuditEventId(input.run.id, {
          config_revision: revision,
          content_sha256: contentSha256,
          id,
          load_source: loadSource,
          load_stage: loadStage,
          name,
          owner: {
            scope: ownerScope,
            user_id: ownerUserId,
            workspace_id: ownerWorkspaceId,
          },
          package_ref: packageRef,
          semantic_version: semanticVersion,
        } as SkillLoadedAuditCapture["skill"])
      : null;
    const identityExact = structurallyValid
      && exactStringValue(capture.eventId) === expectedEventId
      && record.session_id === input.run.session_id
      && selected?.revision === revision
      && materialized?.revision === revision
      && materialized?.contentSha256 === contentSha256
      && materialized?.packageRef === packageRef
      && input.resourceRevisions[`skill:${id}`] === revision
      && ownerUserId === input.run.user_id
      && ownerWorkspaceId === input.workspaceId;
    return [{
      contentSha256,
      detail: identityExact
        ? "Exact Skill content was read and assembled for this Run."
        : structurallyValid
          ? "Skill load identity did not match this Run's selected revision and materialized package evidence."
          : "Skill load evidence was malformed; this item is unavailable.",
      evidenceStatus: identityExact ? "available" as const : "unavailable" as const,
      id,
      loadSource,
      loadStage,
      name,
      ownerScope,
      ownerUserId,
      ownerWorkspaceId,
      packageRef,
      revision,
      semanticVersion,
    }];
  });
  const loadedIds = new Set(loadedItems.map(({ id }) => id));
  const expectedById = new Map<string, {
    contentSha256: string | null;
    id: string;
    name: string | null;
    packageRef: string | null;
    revision: number | null;
  }>();
  input.selectedSkills.forEach((skill) => expectedById.set(skill.id, {
    contentSha256: null,
    id: skill.id,
    name: skill.name,
    packageRef: null,
    revision: skill.revision,
  }));
  input.materializedItems.forEach((skill) => {
    const selected = expectedById.get(skill.id);
    expectedById.set(skill.id, {
      contentSha256: skill.contentSha256,
      id: skill.id,
      name: selected?.name ?? null,
      packageRef: skill.packageRef,
      revision: selected?.revision ?? skill.revision,
    });
  });
  const missingItems = [...expectedById.values()].flatMap((skill) => loadedIds.has(skill.id) ? [] : [{
    contentSha256: skill.contentSha256,
    detail: "The Skill was selected or materialized, but no exact skill.loaded event was persisted for this Run.",
    evidenceStatus: "unavailable" as const,
    id: skill.id,
    loadSource: null,
    loadStage: null,
    name: skill.name,
    ownerScope: null,
    ownerUserId: null,
    ownerWorkspaceId: null,
    packageRef: skill.packageRef,
    revision: skill.revision,
    semanticVersion: null,
  }]);
  const items = [...loadedItems, ...missingItems];
  return {
    status: items.some(({ evidenceStatus }) => evidenceStatus === "available") ? "available" : "unavailable",
    items,
  };
};

const contextSummary = (events: ParsedEvent[]): ProjectAiRunDetail["context"] => {
  const verifiedByStep = new Map<number, Record<string, unknown>>();
  events.forEach((event) => {
    if (!isCustom(event.value, "context.prompt-verified") || !isRecord(event.value.value)) return;
    const step = integerValue(event.value.value.step_number) ?? 1;
    verifiedByStep.set(step, event.value.value);
  });
  const compiled = events.flatMap((event, index) => {
    if (!isCustom(event.value, "context.compiled") || !isRecord(event.value.value)) return [];
    const value = event.value.value;
    const stepNumber = integerValue(value.step_number) ?? index + 1;
    const verified = verifiedByStep.get(stepNumber);
    const budget = isRecord(value.budget) ? value.budget : {};
    const report = isRecord(value.token_report) ? value.token_report : {};
    return [{
      stepNumber,
      packageId: nullableStringValue(value.package_id),
      packageRevision: integerValue(value.package_revision) ?? null,
      planId: nullableStringValue(value.plan_id),
      selectedGroupCount: stringArray(value.selected_group_ids).length,
      omittedGroupCount: stringArray(value.omitted_group_ids).length,
      selectedSourceTypes: sourceTypes(value.selected_sources),
      omittedSourceTypes: sourceTypes(value.omitted_sources),
      truncationDecisionCount: arrayRecords(value.decisions).filter((decision) => (
        numberValue(decision.tokenSavings) > 0 || /drop|truncate|omit/iu.test(stringValue(decision.strategyId))
      )).length,
      promptTokens: firstNumber(verified?.prompt_tokens, value.prompt_tokens, report.totalInputTokens),
      inputBudget: firstNumber(verified?.input_budget, verified?.budget_tokens, budget.inputBudget, value.budget_tokens),
      contextWindow: firstNumber(verified?.context_window, budget.contextWindow),
      remainingTokens: firstNumber(verified?.remaining_tokens, value.remaining_tokens, report.remainingTokens),
      capabilitySource: nullableStringValue(verified?.capability_source ?? budget.capabilitySource),
      highWaterMark: nullableStringValue(verified?.high_water_mark ?? value.high_water_mark),
    }];
  });
  return {
    status: compiled.length > 0 ? "available" : "unavailable",
    steps: compiled.sort((left, right) => left.stepNumber - right.stepNumber),
  };
};

const modelRequestSummary = (
  metadataStore: MetadataStore,
  run: RunRecord,
  events: ParsedEvent[],
): ProjectAiRunDetail["modelRequests"] => {
  const requestEvents = events.filter(({ value }) => isCustom(value, "model.request.prepared"));
  if (requestEvents.length === 0) {
    return {
      status: "unavailable",
      detail: "This historical Run has no Provider-boundary request snapshot.",
      items: [],
    };
  }

  const items = requestEvents.map(({ value: event }) => {
    const value = isRecord(event.value) ? event.value : {};
    const payloadRef = isRecord(value.payload_ref) ? value.payload_ref : {};
    const stepNumber = integerValue(value.step_number) ?? null;
    const retryCount = integerValue(value.retry_count) ?? null;
    const modelName = nullableStringValue(value.model);
    const contextPackageId = nullableStringValue(value.context_package_id);
    const contextPackageRevision = integerValue(value.context_package_revision) ?? null;
    const snapshotId = nullableStringValue(payloadRef.id);
    const contentSha256 = nullableStringValue(payloadRef.sha256);
    const toolNames = stringArray(value.tool_names).sort((left, right) => left.localeCompare(right));
    let snapshot;
    try {
      snapshot = snapshotId
        ? metadataStore.modelRequestSnapshots.find({ user_id: run.user_id, id: snapshotId })
        : undefined;
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith("MODEL_REQUEST_SNAPSHOT_INVALID:")) {
        throw error;
      }
      snapshot = undefined;
    }
    const payloadAvailability = value.payload_availability === "retained"
      || value.payload_availability === "not-retained"
      ? value.payload_availability
      : snapshot?.payload_availability ?? null;
    const capture = snapshot ? parseRecord(snapshot.payload_json) : {};
    const captureContext = isRecord(capture.contextPackage) ? capture.contextPackage : {};
    const reconstructionAvailable = value.run_event_schema_version === 1
      && value.request_fidelity === "complete"
      && payloadRef.kind === "model-request-snapshot"
      && stepNumber !== null
      && retryCount !== null
      && contextPackageId !== null
      && contextPackageRevision !== null
      && snapshot !== undefined
      && snapshot.user_id === run.user_id
      && snapshot.run_id === run.id
      && snapshot.session_id === run.session_id
      && snapshot.step_number === stepNumber
      && snapshot.retry_count === retryCount
      && snapshot.context_package_id === contextPackageId
      && snapshot.context_package_revision === contextPackageRevision
      && snapshot.content_sha256 === contentSha256
      && snapshot.content_sha256 === sha256(snapshot.payload_json)
      && payloadAvailability === "retained"
      && snapshot.payload_availability === "retained"
      && capture.schemaVersion === 1
      && capture.requestFidelity === "complete"
      && capture.stepNumber === stepNumber
      && capture.retryCount === retryCount
      && nullableStringValue(capture.modelName) === modelName
      && captureContext.packageId === contextPackageId
      && captureContext.revision === contextPackageRevision
      && Array.isArray(capture.prompt)
      && sameStrings(stringArray(capture.activeToolNames), toolNames)
      && sameStrings(arrayRecords(capture.toolSet).map((tool) => stringValue(tool.name)).filter(Boolean), toolNames);
    return {
      stepNumber,
      retryCount,
      modelName,
      reconstructionStatus: reconstructionAvailable ? "available" as const : "unavailable" as const,
      snapshotId,
      contentSha256,
      contextPackageId,
      contextPackageRevision,
      toolNames,
      payloadAvailability,
    };
  });
  const available = items.filter(({ reconstructionStatus }) => reconstructionStatus === "available").length;
  return {
    status: available === items.length ? "available" : available > 0 ? "partial" : "unavailable",
    detail: `${available} of ${items.length} Provider-boundary request snapshots can be reconstructed.`,
    items,
  };
};

const toolSummary = (events: ParsedEvent[]): ProjectAiRunDetail["tools"] => {
  const calls = new Map<string, ProjectAiRunDetail["tools"][number]>();
  events.forEach(({ record, value }) => {
    const type = stringValue(value.type);
    const toolCallId = stringValue(value.toolCallId ?? value.tool_call_id);
    if (!toolCallId) return;
    const name = stringValue(value.toolCallName ?? value.tool_call_name)
      || calls.get(toolCallId)?.name
      || "Unknown Tool";
    if (type === "TOOL_CALL_START") {
      calls.set(toolCallId, {
        toolCallId,
        name,
        status: "called",
        startedAt: record.created_at,
        finishedAt: null,
      });
      return;
    }
    if (type !== "TOOL_CALL_RESULT") return;
    const current = calls.get(toolCallId);
    const result = parseResult(value.content ?? value.result ?? value.value);
    calls.set(toolCallId, {
      toolCallId,
      name,
      status: rejectedResult(result) ? "rejected" : failedResult(result) ? "failed" : "succeeded",
      startedAt: current?.startedAt ?? null,
      finishedAt: record.created_at,
    });
  });
  return [...calls.values()];
};

const tokenSummary = (events: ParsedEvent[]): ProjectAiRunDetail["tokens"] => {
  let input = 0;
  let output = 0;
  let total = 0;
  let usageEventCount = 0;
  let hit = 0;
  let miss = 0;
  let cacheAvailable = false;
  events.forEach((event) => {
    if (!isCustom(event.value, "token_usage") || !isRecord(event.value.value)) return;
    const value = event.value.value;
    const eventInput = optionalNumber(value.input_tokens ?? value.inputTokens);
    const eventOutput = optionalNumber(value.output_tokens ?? value.outputTokens);
    if (eventInput === undefined || eventOutput === undefined) return;
    usageEventCount += 1;
    input += eventInput;
    output += eventOutput;
    total += optionalNumber(value.total_tokens ?? value.totalTokens) ?? eventInput + eventOutput;
    const eventHit = optionalNumber(value.cache_hit_tokens);
    const eventMiss = optionalNumber(value.cache_miss_tokens);
    cacheAvailable ||= value.cache_telemetry_available === true || eventHit !== undefined || eventMiss !== undefined;
    hit += eventHit ?? 0;
    miss += eventMiss ?? 0;
  });
  if (usageEventCount === 0) {
    return {
      status: "unavailable",
      input: null,
      output: null,
      total: null,
      cache: { status: "unavailable", hit: null, miss: null },
    };
  }
  return {
    status: "available",
    input,
    output,
    total,
    cache: {
      status: cacheAvailable ? "available" : "unavailable",
      hit: cacheAvailable ? hit : null,
      miss: cacheAvailable ? miss : null,
    },
  };
};

const findLastCustom = (
  events: ParsedEvent[],
  name: string,
  sessionId?: string,
): ParsedEvent | undefined => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const parsed = events[index];
    const event = parsed?.value;
    if (parsed
      && (sessionId === undefined || parsed.record.session_id === sessionId)
      && event
      && isCustom(event, name)
      && isRecord(event.value)) return { ...parsed, value: event.value };
  }
  return undefined;
};

const sourceTypes = (value: unknown): string[] => [...new Set(arrayRecords(value)
  .flatMap((entry) => stringArray(entry.source_types)))]
  .sort((left, right) => left.localeCompare(right));

const mcpMapping = (value: unknown): Array<{ serverId: string; toolNames: string[] }> | null => {
  if (!isRecord(value)) return null;
  return Object.entries(value)
    .flatMap(([serverId, names]) => stringArray(names).length > 0
      ? [{ serverId, toolNames: stringArray(names).sort((left, right) => left.localeCompare(right)) }]
      : [{ serverId, toolNames: [] }])
    .sort((left, right) => left.serverId.localeCompare(right.serverId));
};

const numericRecord = (value: unknown): Record<string, number> => {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .flatMap(([key, candidate]) => integerValue(candidate) !== undefined
      ? [[key, integerValue(candidate)!] as const]
      : [])
    .sort(([left], [right]) => left.localeCompare(right)));
};

const parseResult = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value) as unknown; } catch { return value; }
};

const rejectedResult = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  const marker = [value.status, value.code, value.error, value.reason]
    .map(stringValue)
    .join(" ")
    .toLowerCase();
  return /reject|block|denied|forbidden/iu.test(marker);
};

const failedResult = (value: unknown): boolean => isRecord(value)
  && (value.success === false || value.ok === false || value.isError === true || Boolean(stringValue(value.error)));

const safeErrorCode = (run: RunRecord): string | null => {
  if (run.status !== "failed") return null;
  const code = run.error_message?.match(/^[A-Z][A-Z0-9_]{2,80}/u)?.[0];
  return code ?? "RUN_FAILED";
};

const elapsedMs = (startedAt: string, finishedAt: string | undefined): number | null => {
  if (!finishedAt) return null;
  const elapsed = Date.parse(finishedAt) - Date.parse(startedAt);
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null;
};

const requireAdmin = (metadataStore: MetadataStore, user: UserRecord): void => {
  if (metadataStore.energyIq.findUserRole(user.id)?.role !== "admin") {
    throw new Error("ENERGYIQ_ADMIN_REQUIRED");
  }
};

const parseRecord = (value: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const arrayRecords = (value: unknown): Record<string, unknown>[] => Array.isArray(value)
  ? value.filter(isRecord)
  : [];

const stringArray = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
  : [];

const firstNumber = (...values: unknown[]): number | null => {
  for (const value of values) {
    const number = optionalNumber(value);
    if (number !== undefined) return number;
  }
  return null;
};

const optionalNumber = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value)
  ? value
  : undefined;

const numberValue = (value: unknown): number => optionalNumber(value) ?? 0;

const integerValue = (value: unknown): number | undefined => typeof value === "number" && Number.isSafeInteger(value)
  ? value
  : undefined;

const nullableStringValue = (value: unknown): string | null => {
  const result = stringValue(value);
  return result || null;
};

const exactStringValue = (value: unknown): string | null => typeof value === "string"
  && value.length > 0
  && value === value.trim()
  ? value
  : null;

const stringValue = (value: unknown): string => typeof value === "string" ? value.trim() : "";

const sameStrings = (left: string[], right: string[]): boolean => {
  const sortedLeft = [...left].sort((first, second) => first.localeCompare(second));
  const sortedRight = [...right].sort((first, second) => first.localeCompare(second));
  return sortedLeft.length === sortedRight.length
    && sortedLeft.every((value, index) => value === sortedRight[index]);
};

const sha256 = (value: string): string => `sha256:${createHash("sha256").update(value).digest("hex")}`;

const isCustom = (event: Record<string, unknown>, name: string): boolean => (
  stringValue(event.type) === "CUSTOM" && stringValue(event.name) === name
);

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);
