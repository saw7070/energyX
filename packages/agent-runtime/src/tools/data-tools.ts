import { createTool } from "@mastra/core/tools";
import type { ArtifactService } from "@datafoundry/artifacts";
import type { DataGateway, SchemaSummary, SqlExecutionResult } from "@datafoundry/data-gateway";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { ContextPackage } from "../context/inventory/context-package.js";
import { truncateContextText } from "../context/inventory/context-text.js";
import { SQL_MAX_SQL_CHARS } from "../context/inventory/context-limits.js";
import { toolObservationActivityFromPackage } from "../context/tool-observation/tool-observation-projection-items.js";
import { createActivitySnapshot, createArtifactEvent, createCustomEvent } from "../events.js";
import { SQL_MAX_EXECUTION_COUNT } from "../runtime-limits.js";
import { createTokenUsageCorrelationStore } from "../stream/token-usage-correlation.js";
import type { AgentRunContext, AgUiEventEmitter } from "../types.js";
import { enrichSqlDialectError, validateSqlDialect } from "./sql-dialect-validation.js";

type DataToolExecutionOptions = {
  toolCallId?: string;
};

type MastraToolExecuteOptions = {
  agent?: { toolCallId?: string };
};

const toolCallIdFromOptions = (options?: MastraToolExecuteOptions): string | undefined =>
  typeof options?.agent?.toolCallId === "string" && options.agent.toolCallId.length > 0
    ? options.agent.toolCallId
    : undefined;

const executionOptionsFromMastra = (
  options?: MastraToolExecuteOptions,
): DataToolExecutionOptions | undefined => {
  const toolCallId = toolCallIdFromOptions(options);
  return toolCallId ? { toolCallId } : undefined;
};

type TokenUsageCorrelationStore = ReturnType<typeof createTokenUsageCorrelationStore>;

type SchemaCapability = {
  datasource_id: string;
  dialect?: string;
  schema_id: string;
};

type InspectSchemaResult = SchemaSummary & {
  schema_id: string;
};

type RawSqlToolResult = {
  cache_hit?: boolean;
  chart_artifact?: Awaited<ReturnType<ArtifactService["createChartArtifact"]>>;
  result: SqlExecutionResult;
  sql: string;
};

type GovernedResultInput = {
  contextPackage: ContextPackage;
  rawResult: unknown;
  toolName: string;
  toolCallId?: string;
  toolInput?: unknown;
};

export type ToolRegistry = {
  inspectSchema(
    input?: { datasource_id?: string; table_names?: string[] },
    options?: DataToolExecutionOptions,
  ): Promise<InspectSchemaResult>;
  listDataSources(input?: { enabled_only?: boolean }): Promise<unknown>;
  mastraTools: {
    inspect_schema: ReturnType<typeof createTool>;
    list_data_sources: ReturnType<typeof createTool>;
    preview_table: ReturnType<typeof createTool>;
    run_sql_readonly: ReturnType<typeof createTool>;
  };
  onGovernedResult(input: GovernedResultInput): void;
  onGovernanceError(input: { error: unknown; rawResult: unknown; toolName: string }): void;
  previewTable(input: { schema_id: string; table: string; limit?: number }): Promise<unknown>;
  runSqlReadonly(
    input: {
      schema_id: string;
      sql: string;
      assertion_ids?: string[];
      requirement_ids?: string[];
      expected_columns?: string[];
      limit?: number;
      timeout_ms?: number;
    },
    options?: DataToolExecutionOptions,
  ): Promise<RawSqlToolResult>;
  state: {
    artifact_ids: string[];
    chart_artifact_ids: string[];
    schema_capabilities: Map<string, SchemaCapability>;
    sql_execution_count: number;
    sql_execution_count_by_datasource: Map<string, number>;
  };
};

type CreateDataFoundryToolRegistryInput = {
  abortSignal?: AbortSignal | undefined;
  artifactService?: ArtifactService;
  dataGateway: DataGateway;
  emitter: AgUiEventEmitter;
  runContext: AgentRunContext;
  tokenUsageCorrelation?: TokenUsageCorrelationStore;
};

/** Create the run-local data tool registry and concurrency-safe execution state. */
export const createDataFoundryToolRegistry = (input: CreateDataFoundryToolRegistryInput): ToolRegistry => {
  const state = {
    artifact_ids: [] as string[],
    chart_artifact_ids: [] as string[],
    schema_capabilities: new Map<string, SchemaCapability>(),
    sql_execution_count: 0,
    sql_execution_count_by_datasource: new Map<string, number>()
  };
  const resultMetadata = new WeakMap<object, { datasourceId: string; stepId: string }>();
  const sqlResultCache = new Map<string, RawSqlToolResult>();

  const listDataSources = async (toolInput: { enabled_only?: boolean } = {}): Promise<unknown> => {
    throwIfAborted(input.abortSignal);
    const allowedIds = new Set(input.runContext.enabled_datasource_ids ?? []);
    const results = await input.dataGateway.listDataSources({
      user_id: input.runContext.user_id,
      ...(toolInput.enabled_only !== undefined ? { enabled_only: toolInput.enabled_only } : {})
    });
    return { datasources: results.filter((datasource) => allowedIds.has(datasource.id)) };
  };

  const emitStepCorrelation = (
    stepId: string,
    toolName: string,
    toolCallId?: string,
  ): void => {
    if (!toolCallId || !input.tokenUsageCorrelation) return;
    input.tokenUsageCorrelation.emitCorrelation(input.emitter, {
      stepId,
      toolCallId,
      toolName,
    });
  };

  const inspectSchema = async (
    toolInput: { datasource_id?: string; table_names?: string[] } = {},
    options?: DataToolExecutionOptions,
  ): Promise<InspectSchemaResult> => {
    throwIfAborted(input.abortSignal);
    const datasourceId = resolveDatasourceId(input.runContext, toolInput.datasource_id);
    const stepId = `schema-${randomUUID()}`;
    emitStepCorrelation(stepId, "inspect_schema", options?.toolCallId);
    input.emitter.emit(createActivitySnapshot(input.runContext, "STEP", {
      step_id: stepId,
      title: "Inspect data source schema",
      kind: "schema",
      tool_name: "inspect_schema",
      status: "running",
      datasource_id: datasourceId,
      input: toolInput
    }));

    try {
      const result = await input.dataGateway.inspectSchema({
        user_id: input.runContext.user_id,
        ...(input.runContext.workspace_id ? { workspace_id: input.runContext.workspace_id } : {}),
        datasource_id: datasourceId,
        ...(toolInput.table_names ? { table_names: toolInput.table_names } : {}),
        ...(input.abortSignal ? { signal: input.abortSignal } : {})
      });
      const schema_id = `schema_${randomUUID()}`;
      state.schema_capabilities.set(schema_id, {
        datasource_id: datasourceId,
        ...(result.dialect ? { dialect: result.dialect } : {}),
        schema_id
      });
      const rawResult = { ...result, schema_id };
      resultMetadata.set(rawResult, { datasourceId, stepId });
      return rawResult;
    } catch (error) {
      emitFailedStep(input, stepId, "inspect_schema", "Inspect data source schema", error);
      throw error;
    }
  };

  const runSqlReadonly = async (
    toolInput: {
      schema_id: string;
      sql: string;
      assertion_ids?: string[];
      requirement_ids?: string[];
      expected_columns?: string[];
      limit?: number;
      timeout_ms?: number;
    },
    options?: DataToolExecutionOptions,
  ): Promise<RawSqlToolResult> => {
    throwIfAborted(input.abortSignal);
    const capability = state.schema_capabilities.get(toolInput.schema_id);
    if (!capability) {
      throw new Error("SCHEMA_REQUIRED_BEFORE_SQL");
    }
    const datasourceId = capability.datasource_id;
    const dialectIssues = validateSqlDialect(toolInput.sql, capability.dialect);
    if (dialectIssues.length > 0) {
      const issue = dialectIssues[0];
      throw new Error(`SQL_DIALECT_UNSUPPORTED:${issue?.dialect}:${issue?.code}:${issue?.hint}`);
    }
    const cacheKey = sqlCacheKey(toolInput);
    const cached = sqlResultCache.get(cacheKey);
    if (cached) {
      const rawResult = { ...cached, cache_hit: true as const };
      resultMetadata.set(rawResult, { datasourceId, stepId: `sql-cache-${randomUUID()}` });
      return rawResult;
    }

    state.sql_execution_count += 1;
    const datasourceCount = (state.sql_execution_count_by_datasource.get(datasourceId) ?? 0) + 1;
    state.sql_execution_count_by_datasource.set(datasourceId, datasourceCount);
    if (state.sql_execution_count > SQL_MAX_EXECUTION_COUNT) {
      throw new Error("SQL_EXECUTION_LIMIT_EXCEEDED");
    }

    const stepId = `sql-${state.sql_execution_count}`;
    emitStepCorrelation(stepId, "run_sql_readonly", options?.toolCallId);
    const sqlActivityPreview = truncateContextText(toolInput.sql, SQL_MAX_SQL_CHARS);
    input.emitter.emit(createActivitySnapshot(input.runContext, "STEP", {
      step_id: stepId,
      title: "Run read-only SQL",
      kind: "sql",
      tool_name: "run_sql_readonly",
      status: "running",
      datasource_id: datasourceId,
      sql: sqlActivityPreview,
      input: { ...toolInput, datasource_id: datasourceId, sql: sqlActivityPreview }
    }));

    try {
      const result = await input.dataGateway.runSqlReadonly({
        user_id: input.runContext.user_id,
        ...(input.runContext.workspace_id ? { workspace_id: input.runContext.workspace_id } : {}),
        run_id: input.runContext.run_id,
        datasource_id: datasourceId,
        sql: toolInput.sql,
        ...(toolInput.limit ? { limit: toolInput.limit } : {}),
        ...(toolInput.timeout_ms ? { timeout_ms: toolInput.timeout_ms } : {}),
        ...(input.abortSignal ? { signal: input.abortSignal } : {}),
        // R-018: let the produced table artifact record its origin so the Detail view
        // can link the SQL result back to this tool_call / step.
        ...(options?.toolCallId || stepId
          ? { correlation: {
              ...(options?.toolCallId ? { tool_call_id: options.toolCallId } : {}),
              ...(stepId ? { step_id: stepId } : {})
            } }
          : {})
      });
      if (result.artifact_id) {
        state.artifact_ids.push(result.artifact_id);
      }
      emitSqlReferences(input, datasourceId, result);
      const chartArtifact = await maybeCreateEnergyChartArtifact({
        ...(input.artifactService ? { artifactService: input.artifactService } : {}),
        emitter: input.emitter,
        result,
        runContext: input.runContext,
        ...(toolInput.limit !== undefined ? { requestedLimit: toolInput.limit } : {}),
        state,
        stepId,
        ...(options?.toolCallId ? { toolCallId: options.toolCallId } : {})
      });
      const rawResult = {
        result,
        sql: toolInput.sql,
        ...(chartArtifact ? { chart_artifact: chartArtifact } : {})
      };
      sqlResultCache.set(cacheKey, rawResult);
      resultMetadata.set(rawResult, { datasourceId, stepId });
      return rawResult;
    } catch (error) {
      emitFailedStep(input, stepId, "run_sql_readonly", "Run read-only SQL", error);
      throw enrichSqlDialectError(error, capability.dialect);
    }
  };

  const previewTable = async (toolInput: {
    schema_id: string;
    table: string;
    limit?: number;
  }): Promise<unknown> => {
    throwIfAborted(input.abortSignal);
    const capability = state.schema_capabilities.get(toolInput.schema_id);
    if (!capability) {
      throw new Error("SCHEMA_REQUIRED_BEFORE_PREVIEW");
    }
    const result = await input.dataGateway.previewTable({
      user_id: input.runContext.user_id,
      ...(input.runContext.workspace_id ? { workspace_id: input.runContext.workspace_id } : {}),
      datasource_id: capability.datasource_id,
      table: toolInput.table,
      ...(toolInput.limit ? { limit: toolInput.limit } : {}),
      ...(input.abortSignal ? { signal: input.abortSignal } : {})
    });
    return { datasource_id: capability.datasource_id, table: toolInput.table, ...result };
  };

  const onGovernedResult = (governed: GovernedResultInput): void => {
    if (!isObject(governed.rawResult)) {
      return;
    }
    const metadata = resultMetadata.get(governed.rawResult);
    if (!metadata) {
      return;
    }
    const isSchema = governed.toolName === "inspect_schema";
    const isSql = governed.toolName === "run_sql_readonly";
    if (!isSchema && !isSql) {
      return;
    }
    input.emitter.emit(createActivitySnapshot(input.runContext, "STEP", {
      step_id: metadata.stepId,
      title: isSchema ? "Inspect data source schema" : "Run read-only SQL",
      kind: isSchema ? "schema" : "sql",
      tool_name: governed.toolName,
      status: "completed",
      output_type: isSchema ? "json" : "table",
      content: toolObservationActivityFromPackage(governed.contextPackage)
    }));
  };

  const onGovernanceError = (failed: { error: unknown; rawResult: unknown; toolName: string }): void => {
    if (!isObject(failed.rawResult)) {
      return;
    }
    const metadata = resultMetadata.get(failed.rawResult);
    if (!metadata || (failed.toolName !== "inspect_schema" && failed.toolName !== "run_sql_readonly")) {
      return;
    }
    emitFailedStep(
      input,
      metadata.stepId,
      failed.toolName,
      failed.toolName === "inspect_schema" ? "Inspect data source schema" : "Run read-only SQL",
      failed.error
    );
  };

  return {
    inspectSchema,
    listDataSources,
    mastraTools: createMastraDataTools({ inspectSchema, listDataSources, previewTable, runSqlReadonly }),
    onGovernanceError,
    onGovernedResult,
    previewTable,
    runSqlReadonly,
    state
  };
};

export const isChartRequested = (userInput: string): boolean =>
  /\b(?:chart|graph|plot|visuali[sz](?:e|ation)|line[- ]?chart|bar[- ]?chart|pie[- ]?chart)\b|\u56fe\u8868|\u8d8b\u52bf\u56fe|\u6298\u7ebf\u56fe|\u67f1\u72b6\u56fe|\u997c\u56fe|\u53ef\u89c6\u5316/iu
    .test(userInput);

const maybeCreateEnergyChartArtifact = async (input: {
  artifactService?: ArtifactService;
  emitter: AgUiEventEmitter;
  result: SqlExecutionResult;
  runContext: AgentRunContext;
  requestedLimit?: number;
  state: ToolRegistry["state"];
  stepId: string;
  toolCallId?: string;
}): Promise<Awaited<ReturnType<ArtifactService["createChartArtifact"]>> | undefined> => {
  if (
    !input.artifactService
    || !input.runContext.energy_query_context
    || !isChartRequested(input.runContext.user_input)
    || input.state.chart_artifact_ids.length > 0
  ) {
    return undefined;
  }
  const preview = chartPreviewFromSqlResult(input.result, input.runContext.user_input);
  if (input.requestedLimit === undefined || input.requestedLimit < input.result.row_count) {
    return undefined;
  }
  if (!preview) {
    return undefined;
  }
  try {
    const artifact = await input.artifactService.createChartArtifact({
      user_id: input.runContext.user_id,
      session_id: input.runContext.session_id,
      run_id: input.runContext.run_id,
      name: preview.name,
      chartType: preview.chartType,
      points: preview.points,
      ...(preview.unit ? { unit: preview.unit } : {}),
      metadata_json: {
        source_artifact_id: input.result.artifact_id,
        audit_log_id: input.result.audit_log_id,
        step_id: input.stepId,
        ...(input.toolCallId ? { tool_call_id: input.toolCallId } : {}),
        generated_by: "energyiq-rule-based-chart"
      }
    });
    input.state.chart_artifact_ids.push(artifact.id);
    input.emitter.emit(createArtifactEvent(artifact));
    return artifact;
  } catch (error) {
    input.emitter.emit(createCustomEvent("chart.preview.skipped", {
      reason: error instanceof Error ? error.message : "CHART_PREVIEW_FAILED",
      run_id: input.runContext.run_id,
      step_id: input.stepId
    }));
    return undefined;
  }
};

const chartPreviewFromSqlResult = (
  result: SqlExecutionResult,
  userInput: string
): {
  chartType: "bar" | "line" | "pie";
  name: string;
  points: Array<{ label: string; value: number }>;
  unit?: string;
} | undefined => {
  if (result.columns.length !== 2 || result.rows.length < 2 || result.rows.length > 500) {
    return undefined;
  }
  const [labelColumn, valueColumn] = result.columns;
  if (!labelColumn || !valueColumn) {
    return undefined;
  }
  if (!requestedTimeGrainMatches(userInput, labelColumn)) {
    return undefined;
  }
  const points = result.rows.map((row) => ({
    label: chartLabel(row[0]),
    value: typeof row[1] === "number" ? row[1] : Number(row[1])
  }));
  if (points.some((point) => point.label.length === 0 || !Number.isFinite(point.value))) {
    return undefined;
  }
  if (!requestedTimeSpacingMatches(userInput, points)) {
    return undefined;
  }
  const chartType = /\bpie[- ]?chart\b|\u997c\u56fe/iu.test(userInput)
    ? "pie"
    : /\bbar[- ]?chart\b|\u67f1\u72b6\u56fe/iu.test(userInput)
      ? "bar"
      : /(?:time|date|hour|day|week|month|interval|timestamp)/iu.test(labelColumn)
        ? "line"
        : "bar";
  const unit = chartUnit(valueColumn);
  return {
    chartType,
    name: `${humanizeColumn(valueColumn)} by ${humanizeColumn(labelColumn)}`,
    points,
    ...(unit ? { unit } : {})
  };
};

const chartLabel = (value: unknown): string => {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
};

const requestedTimeGrainMatches = (userInput: string, labelColumn: string): boolean => {
  const requestedGrain = /\b(?:hour|hourly)\b|\u5c0f\u65f6/iu.test(userInput)
    ? "hour"
    : /\b(?:day|daily)\b|\u6bcf\u65e5|\u6309\u65e5|\u5929/iu.test(userInput)
      ? "day"
      : /\b(?:week|weekly)\b|\u6bcf\u5468|\u6309\u5468/iu.test(userInput)
        ? "week"
        : /\b(?:month|monthly)\b|\u6bcf\u6708|\u6309\u6708/iu.test(userInput)
          ? "month"
          : undefined;
  const normalizedLabel = labelColumn.toLowerCase();
  if (requestedGrain === undefined || !normalizedLabel.includes(requestedGrain)) {
    return requestedGrain === undefined;
  }
  const requestsTimeline = /\b(?:trend|timeline|over\s+the\s+period|across\s+the\s+period)\b|\u8d8b\u52bf|\u65f6\u95f4\u7ebf/iu
    .test(userInput);
  if (requestedGrain === "hour" && requestsTimeline) {
    return /(?:timestamp|start|date|datetime|time|(?:^|_)ts(?:$|_))/iu.test(normalizedLabel)
      && !/(?:^|_)(?:local_)?hour(?:_of_day)?$/iu.test(normalizedLabel);
  }
  return true;
};

const requestedTimeSpacingMatches = (
  userInput: string,
  points: Array<{ label: string; value: number }>
): boolean => {
  const requestsTimeline = /\b(?:trend|timeline|over\s+the\s+period|across\s+the\s+period)\b|\u8d8b\u52bf|\u65f6\u95f4\u7ebf/iu
    .test(userInput);
  if (!requestsTimeline) {
    return true;
  }
  const minimumSpacingMs = /\b(?:hour|hourly)\b|\u5c0f\u65f6/iu.test(userInput)
    ? 60 * 60 * 1000
    : /\b(?:day|daily)\b|\u6bcf\u65e5|\u6309\u65e5|\u5929/iu.test(userInput)
      ? 20 * 60 * 60 * 1000
      : /\b(?:week|weekly)\b|\u6bcf\u5468|\u6309\u5468/iu.test(userInput)
        ? 6 * 24 * 60 * 60 * 1000
        : /\b(?:month|monthly)\b|\u6bcf\u6708|\u6309\u6708/iu.test(userInput)
          ? 27 * 24 * 60 * 60 * 1000
          : undefined;
  if (minimumSpacingMs === undefined) {
    return true;
  }
  const timestamps = points.map((point) => Date.parse(point.label));
  if (timestamps.some((timestamp) => !Number.isFinite(timestamp))) {
    return false;
  }
  return timestamps.slice(1).every((timestamp, index) =>
    timestamp - (timestamps[index] as number) >= minimumSpacingMs
  );
};

const chartUnit = (column: string): string | undefined => {
  if (/(?:^|_)kwh(?:$|_)/iu.test(column)) return "kWh";
  if (/(?:^|_)kw(?:$|_)/iu.test(column)) return "kW";
  if (/(?:percent|percentage|pct|rate)/iu.test(column)) return "%";
  return undefined;
};

const humanizeColumn = (column: string): string =>
  column.replaceAll("_", " ").replace(/\b\w/gu, (letter) => letter.toUpperCase());

const sqlCacheKey = (input: {
  schema_id: string;
  sql: string;
  limit?: number;
  timeout_ms?: number;
}): string => [
  input.schema_id,
  input.sql.trim().replace(/;\s*$/u, ""),
  input.limit ?? "default",
  input.timeout_ms ?? "default"
].join("\u0000");

type DataToolExecutors = Pick<ToolRegistry, "inspectSchema" | "listDataSources" | "previewTable" | "runSqlReadonly">;

const createMastraDataTools = (executors: DataToolExecutors): ToolRegistry["mastraTools"] => ({
  list_data_sources: createTool({
    id: "list_data_sources",
    description: "List datasources enabled for this run.",
    inputSchema: z.object({ enabled_only: z.boolean().optional() }),
    execute: (toolInput) => executors.listDataSources({
      ...(toolInput.enabled_only !== undefined ? { enabled_only: toolInput.enabled_only } : {})
    })
  }),
  inspect_schema: createTool({
    id: "inspect_schema",
    description:
      "Inspect a datasource schema and return a run-local schema_id that must precede SQL or preview calls.",
    inputSchema: z.object({
      datasource_id: z.string().optional(),
      table_names: z.array(z.string()).optional()
    }),
    execute: (toolInput, options) =>
      executors.inspectSchema(
        {
          ...(toolInput.datasource_id ? { datasource_id: toolInput.datasource_id } : {}),
          ...(toolInput.table_names ? { table_names: toolInput.table_names } : {}),
        },
        executionOptionsFromMastra(options),
      ),
  }),
  preview_table: createTool({
    id: "preview_table",
    description: "Preview a table using a schema_id returned by inspect_schema in this run.",
    inputSchema: z.object({
      schema_id: z.string(),
      table: z.string().min(1),
      limit: z.number().int().positive().optional()
    }),
    execute: (toolInput) => executors.previewTable({
      schema_id: toolInput.schema_id,
      table: toolInput.table,
      ...(toolInput.limit ? { limit: toolInput.limit } : {})
    })
  }),
  run_sql_readonly: createTool({
    id: "run_sql_readonly",
    description: "Execute one read-only SELECT/WITH query using a schema_id returned in this run.",
    inputSchema: z.object({
      schema_id: z.string(),
      sql: z.string(),
      assertion_ids: z.array(z.string().min(1)).max(32).optional(),
      requirement_ids: z.array(z.string().min(1)).max(16).optional(),
      expected_columns: z.array(z.string().min(1)).max(100).optional(),
      limit: z.number().int().positive().max(1000).optional(),
      timeout_ms: z.number().int().positive().max(30000).optional()
    }),
    execute: (toolInput, options) =>
      executors.runSqlReadonly(
        {
          schema_id: toolInput.schema_id,
          sql: toolInput.sql,
          ...(toolInput.assertion_ids ? { assertion_ids: toolInput.assertion_ids } : {}),
          ...(toolInput.requirement_ids ? { requirement_ids: toolInput.requirement_ids } : {}),
          ...(toolInput.expected_columns ? { expected_columns: toolInput.expected_columns } : {}),
          ...(toolInput.limit ? { limit: toolInput.limit } : {}),
          ...(toolInput.timeout_ms ? { timeout_ms: toolInput.timeout_ms } : {}),
        },
        executionOptionsFromMastra(options),
      ),
  })
});

const emitSqlReferences = (
  input: CreateDataFoundryToolRegistryInput,
  datasourceId: string,
  result: SqlExecutionResult
): void => {
  input.emitter.emit(createCustomEvent("sql_audit", {
    audit_log_id: result.audit_log_id,
    datasource_id: datasourceId,
    status: "succeeded",
    row_count: result.row_count,
    elapsed_ms: result.elapsed_ms
  }));
  if (result.artifact) {
    input.emitter.emit(createArtifactEvent(result.artifact));
  }
};

const emitFailedStep = (
  input: CreateDataFoundryToolRegistryInput,
  stepId: string,
  toolName: string,
  title: string,
  error: unknown
): void => {
  input.emitter.emit(createActivitySnapshot(input.runContext, "STEP", {
    step_id: stepId,
    title,
    kind: toolName === "inspect_schema" ? "schema" : "sql",
    tool_name: toolName,
    status: "failed",
    error_message: error instanceof Error ? error.message : `Unknown ${toolName} error`
  }));
};

const resolveDatasourceId = (context: AgentRunContext, requestedDatasourceId: string | undefined): string => {
  const datasourceId = requestedDatasourceId ?? context.selected_datasource_id;
  if (!datasourceId || !(context.enabled_datasource_ids ?? []).includes(datasourceId)) {
    throw new Error("DATASOURCE_NOT_SELECTED");
  }
  return datasourceId;
};

const throwIfAborted = (signal?: AbortSignal | undefined): void => {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error("RUN_CANCELLED");
  }
};

const isObject = (value: unknown): value is object => typeof value === "object" && value !== null;
