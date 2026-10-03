import { describe, it, expect } from "vitest";
import { explorerTrendSql, decodeExplorerTrends, virtualMeterPeakSql } from "./explorer-trends.js";
describe("published Explorer hourly projection", () => {
  it("keeps official routes separate from component detail and deduplicates routes", () => {
    const sql = explorerTrendSql("scoped_view", [
      { id: "__scope__", meters: ["main", "main"] },
      { id: "child", meters: ["child"] },
    ])!;
    expect(sql.match(/'__scope__', 'main'/g)).toHaveLength(1);
    expect(sql).not.toContain("'__scope__', 'child'");
    expect(sql).toContain("quality_status = 'ok'");
  });
  it.each(["office", "preschool", "school"])(
    "preserves missing, zero, partial and event facts for %s",
    (project) => {
      const routes = [
        { id: project, meters: ["a", "b"] },
        { id: "missing", meters: ["c"] },
      ];
      const result = decodeExplorerTrends(
        [
          {
            series_id: project,
            cells: JSON.stringify([
              { d: "2026-09-10", h: 0, k: 0, valid_mins: 120, events: 0 },
              { d: "2026-09-10", h: 1, k: 1, valid_mins: 90, events: 1 },
            ]),
          },
        ],
        routes,
      );
      expect(result[0]?.expectedMinutesPerHour).toBe(120);
      expect(result[0]?.cells[0]?.[2]).toBe(0);
      expect(result[0]?.cells[1]?.[3]).toBe(90);
      expect(result[1]?.cells).toEqual([]);
    },
  );
});

describe("virtual meter hourly series and peak", () => {
  const routes = [{ id: "balance", meters: ["main", "ahu"], coefficients: { main: 1, ahu: -1 } as const }];
  // main reports 10 kWh and ahu 4 kWh per 15 minutes in hour 8; in hour 9 ahu reports 1, 1, 0.5 and then nothing.
  const facts = [
    ...[0, 15, 30, 45].flatMap((minute) => [
      ["main", 8, minute, 10], ["ahu", 8, minute, 4],
      ["main", 9, minute, 12], ...(minute === 45 ? [] : [["ahu", 9, minute, minute === 30 ? 0.5 : 1]]),
    ]),
  ] as Array<[string, number, number, number]>;

  it("subtracts sub-meters per hour and blanks an hour with a missing input", async () => {
    const rows = await query(explorerTrendSql("facts", routes)!, facts);
    const [series] = decodeExplorerTrends(rows, routes);
    expect(series?.expectedMinutesPerHour).toBe(120);
    expect(series?.cells).toEqual([
      ["2026-09-10", 8, 24, 120, 0],
      ["2026-09-10", 9, null, 105, 0],
    ]);
  });

  it("finds the highest complete 15-minute interval", async () => {
    const [row] = await query(virtualMeterPeakSql("facts", routes)!, facts);
    // Hour 9's last interval (12 kWh, no ahu reading) would read as 48 kW; it is not a complete interval.
    expect(Number(row?.peak_kw)).toBeCloseTo(46, 6);
    expect(String(row?.peak_at)).toBe("2026-09-10 09:30:00");
  });
});

const query = async (sql: string, facts: Array<[string, number, number, number]>): Promise<Array<Record<string, unknown>>> => {
  const duckdb = (await import("duckdb")).default;
  const db = new duckdb.Database(":memory:");
  const run = (statement: string) => new Promise<Array<Record<string, unknown>>>((resolve, reject) =>
    db.all(statement, (error, rows) => error ? reject(error) : resolve(rows as Array<Record<string, unknown>>)));
  await run(`CREATE TABLE facts AS SELECT * FROM (VALUES ${facts.map(([meter, hour, minute, kwh]) =>
    `('${meter}', DATE '2026-09-10', ${hour}, TIMESTAMP '2026-09-10 ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00', ${kwh}, 15, 'ok')`).join(",")})
    t(meter_node_id, local_date, local_hour, local_interval_start, usage_kwh, elapsed_minutes, quality_status)`);
  try {
    return await run(sql);
  } finally {
    db.close();
  }
};
