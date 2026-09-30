import { describe, expect, it, vi } from "vitest";

import { createLazyEnergyTargetedQueryGateway } from "./energy-lazy-targeted-query.js";

describe("lazy EnergyIQ targeted query gateway", () => {
  it("opens the authorized scoped workspace only on the first governed data tool call", async () => {
    const inspectSchema = vi.fn(async (input) => ({
      datasource_id: input.datasource_id,
      dialect: "duckdb",
      tables: [],
    }));
    const runSqlReadonly = vi.fn(async (input) => ({
      columns: ["value"], rows: [[1]], row_count: 1,
      audit_log_id: "audit-1", elapsed_ms: 1,
    }));
    const gateway = {
      inspectSchema,
      runSqlReadonly,
    };
    const ensureWorkspace = vi.fn(async () => ({
      scopedDatasource: { datasourceId: "scoped-real" },
    }));
    const lazy = createLazyEnergyTargetedQueryGateway({
      dataGateway: gateway as never,
      ensureWorkspace: ensureWorkspace as never,
      virtualDatasourceId: "energy-lazy-run-1",
    });

    expect(ensureWorkspace).not.toHaveBeenCalled();
    await lazy.inspectSchema({
      user_id: "user-1", workspace_id: "workspace-1",
      datasource_id: "energy-lazy-run-1",
    });
    await lazy.runSqlReadonly({
      user_id: "user-1", workspace_id: "workspace-1", run_id: "run-1",
      datasource_id: "energy-lazy-run-1", sql: "SELECT 1", limit: 1,
    });

    expect(ensureWorkspace).toHaveBeenCalledOnce();
    expect(inspectSchema).toHaveBeenCalledWith(expect.objectContaining({ datasource_id: "scoped-real" }));
    expect(runSqlReadonly).toHaveBeenCalledWith(expect.objectContaining({
      datasource_id: "scoped-real", sql: "SELECT 1", limit: 1,
    }));
  });
});
