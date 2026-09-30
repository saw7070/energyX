import type { ArtifactService } from "@datafoundry/artifacts";
import type { DataGateway } from "@datafoundry/data-gateway";
import { describe, expect, it } from "vitest";

import { createDataFoundryToolRegistry } from "./data-tools.js";

describe("data tool SQL reuse", () => {
  it("reuses an exact successful SQL result within one run and schema", async () => {
    let executionCount = 0;
    const dataGateway = {
      inspectSchema: async () => ({ datasource_id: "orders", dialect: "sqlite", tables: [] }),
      runSqlReadonly: async () => {
        executionCount += 1;
        return {
          columns: ["value"],
          rows: [[1]],
          row_count: 1,
          audit_log_id: "audit-1",
          artifact_id: "artifact-1",
          elapsed_ms: 1
        };
      }
    } as unknown as DataGateway;
    const registry = createDataFoundryToolRegistry({
      dataGateway,
      emitter: { emit: () => undefined },
      runContext: {
        user_id: "user-1",
        workspace_id: "workspace-1",
        session_id: "session-1",
        run_id: "run-cache",
        user_input: "analyze orders",
        chat_mode: "copilotkit",
        enabled_datasource_ids: ["orders"],
        selected_datasource_id: "orders",
        model_name: "test-model"
      }
    });
    const schema = await registry.inspectSchema({ datasource_id: "orders" });

    const first = await registry.runSqlReadonly({ schema_id: schema.schema_id, sql: "SELECT 1", limit: 10 });
    const second = await registry.runSqlReadonly({ schema_id: schema.schema_id, sql: "SELECT 1", limit: 10 });
    await registry.runSqlReadonly({ schema_id: schema.schema_id, sql: "SELECT 1", limit: 20 });

    expect(first.cache_hit).toBeUndefined();
    expect(second).toMatchObject({ cache_hit: true, result: { audit_log_id: "audit-1" } });
    expect(executionCount).toBe(2);
    expect(registry.state.sql_execution_count).toBe(2);
  });

  it("creates one exact backend chart artifact for an EnergyIQ chart request", async () => {
    const emitted: unknown[] = [];
    const chartInputs: unknown[] = [];
    const dataGateway = {
      inspectSchema: async () => ({ datasource_id: "energy", dialect: "duckdb", tables: [] }),
      runSqlReadonly: async (input: { sql: string }) => input.sql.includes("local_interval_start")
        ? {
            columns: ["local_interval_start", "usage_kwh"],
            rows: [["2026-06-03 00:00", 0.25], ["2026-06-03 00:15", 0.5]],
            row_count: 2,
            audit_log_id: "audit-interval",
            artifact_id: "table-interval",
            elapsed_ms: 1
          }
        : input.sql.includes("aliased_interval")
          ? {
              columns: ["hour_start", "hourly_usage_kwh"],
              rows: [["2026-06-03 00:00", 0.25], ["2026-06-03 00:15", 0.5]],
              row_count: 2,
              audit_log_id: "audit-aliased-interval",
              artifact_id: "table-aliased-interval",
              elapsed_ms: 1
            }
          : input.sql.includes("local_hour")
          ? {
              columns: ["local_hour", "average_usage_kwh"],
              rows: [[0, 0.25], [1, 0.5]],
              row_count: 2,
              audit_log_id: "audit-hour-profile",
              artifact_id: "table-hour-profile",
              elapsed_ms: 1
            }
          : {
            columns: ["hour_ts", "hourly_usage_kwh"],
            rows: [["2026-06-03 00:00", 1.25], ["2026-06-03 01:00", 2.5]],
            row_count: 2,
            audit_log_id: "audit-energy",
            artifact_id: "table-energy",
            elapsed_ms: 1
          }
    } as unknown as DataGateway;
    const artifactService = {
      createChartArtifact: async (input: unknown) => {
        chartInputs.push(input);
        return {
          id: "chart-energy",
          type: "chart" as const,
          name: "Hourly Usage Kwh by Hour Start",
          preview_json: {
            chartType: "line",
            unit: "kWh",
            points: [
              { label: "2026-06-03 00:00", value: 1.25 },
              { label: "2026-06-03 01:00", value: 2.5 }
            ]
          }
        };
      }
    } as unknown as ArtifactService;
    const registry = createDataFoundryToolRegistry({
      artifactService,
      dataGateway,
      emitter: { emit: (event) => emitted.push(event) },
      runContext: {
        user_id: "user-1",
        workspace_id: "workspace-1",
        session_id: "session-energy",
        run_id: "run-energy",
        user_input: "Create an hourly trend line chart across the period",
        chat_mode: "copilotkit",
        enabled_datasource_ids: ["energy"],
        selected_datasource_id: "energy",
        model_name: "test-model",
        energy_query_context: {
          projectId: "project-1",
          projectName: "Project 1",
          scopeId: "scope-1",
          scopeName: "Scope 1",
          scopeType: "circuit",
          resource: "electricity",
          timezone: "Asia/Singapore",
          from: "2026-06-02T16:00:00.000Z",
          to: "2026-06-03T16:00:00.000Z",
          endExclusive: true,
          period: "Custom"
        }
      }
    });
    const schema = await registry.inspectSchema({ datasource_id: "energy" });
    const intervalResult = await registry.runSqlReadonly({
      schema_id: schema.schema_id,
      sql: "SELECT local_interval_start, usage_kwh FROM energy_fact",
      limit: 10
    });
    const hourProfileResult = await registry.runSqlReadonly({
      schema_id: schema.schema_id,
      sql: "SELECT local_hour, average_usage_kwh FROM energy_fact",
      limit: 10
    });
    const aliasedIntervalResult = await registry.runSqlReadonly({
      schema_id: schema.schema_id,
      sql: "SELECT hour_start, hourly_usage_kwh FROM aliased_interval",
      limit: 10
    });
    const result = await registry.runSqlReadonly({
      schema_id: schema.schema_id,
      sql: "SELECT hour_ts, hourly_usage_kwh FROM energy_fact",
      limit: 10
    });

    expect(intervalResult.chart_artifact).toBeUndefined();
    expect(hourProfileResult.chart_artifact).toBeUndefined();
    expect(aliasedIntervalResult.chart_artifact).toBeUndefined();
    expect(result.chart_artifact).toMatchObject({ id: "chart-energy", type: "chart" });
    expect(chartInputs).toHaveLength(1);
    expect(chartInputs[0]).toMatchObject({
      chartType: "line",
      unit: "kWh",
      points: [
        { label: "2026-06-03 00:00", value: 1.25 },
        { label: "2026-06-03 01:00", value: 2.5 }
      ]
    });
    expect(registry.state.chart_artifact_ids).toEqual(["chart-energy"]);
    expect(emitted).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "CUSTOM", name: "artifact" })
    ]));
  });
});
