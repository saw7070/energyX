import { describe, expect, it } from "vitest";

import { DuckDbAdapter } from "./local-sql-adapters.js";

describe("DuckDbAdapter in-memory database identity", () => {
  it("keeps a table inside one logical :memory: adapter", async () => {
    const first = new DuckDbAdapter({ path: ":memory:" });
    const second = new DuckDbAdapter({ path: ":memory:" });

    await first.runSqlReadonly({
      sql: `
        CREATE TABLE t08a_adapter_isolation(value INTEGER);
        INSERT INTO t08a_adapter_isolation VALUES (42);
        SELECT value FROM t08a_adapter_isolation LIMIT 1
      `,
      limit: 10,
    });
    await expect(first.runSqlReadonly({
      sql: "SELECT value FROM t08a_adapter_isolation LIMIT 1",
      limit: 10,
    })).resolves.toMatchObject({ rows: [[42]] });
    await expect(second.runSqlReadonly({
      sql: "SELECT value FROM t08a_adapter_isolation LIMIT 1",
      limit: 10,
    })).rejects.toThrow(/t08a_adapter_isolation/iu);
  });
});
