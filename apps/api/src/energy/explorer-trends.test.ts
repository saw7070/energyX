import { describe, it, expect } from "vitest";
import { explorerTrendSql, decodeExplorerTrends } from "./explorer-trends.js";
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
