/** Compact hourly facts; scope totals use only published official routes. */
export type ExplorerTrendSeries = {
  id: string;
  expectedMinutesPerHour: number;
  cells: Array<[string, number, number | null, number, number]>;
};
const literal = (s: string) => "'" + s.replaceAll("'", "''") + "'";
export function explorerTrendSql(
  view: string,
  routes: Array<{ id: string; meters: string[] }>,
) {
  const terms = routes.flatMap((r) =>
    [...new Set(r.meters)].map((m) => `(${literal(r.id)}, ${literal(m)})`),
  );
  if (!terms.length) return null;
  return `SELECT series_id, to_json(list(struct_pack(d := d, h := h, k := k, valid_mins := valid_mins, events := events) ORDER BY d,h)) AS cells
  FROM (SELECT r.series_id, CAST(local_date AS VARCHAR) d, local_hour h,
    SUM(usage_kwh) FILTER (WHERE quality_status = 'ok') k,
    COALESCE(SUM(elapsed_minutes) FILTER (WHERE quality_status = 'ok'),0) AS valid_mins,
    COUNT(*) FILTER (WHERE quality_status <> 'ok') events
    FROM "${view.replaceAll('"', '""')}" source
    JOIN (VALUES ${terms.join(",")}) r(series_id,meter_id) ON source.meter_node_id=r.meter_id
    GROUP BY r.series_id,local_date,local_hour) cells GROUP BY series_id`;
}
export function decodeExplorerTrends(
  rows: Array<Record<string, unknown>>,
  routes: Array<{ id: string; meters: string[] }>,
): ExplorerTrendSeries[] {
  return routes.map((route) => {
    const row = rows.find((row) => row.series_id === route.id);
    const cells = row
      ? (JSON.parse(String(row.cells)) as Array<{
          d: string;
          h: number;
          k: number | null;
          valid_mins: number;
          events: number;
        }>)
      : [];
    return {
      id: route.id,
      expectedMinutesPerHour: new Set(route.meters).size * 60,
      cells: cells.map((c) => [
        String(c.d).slice(0, 10),
        Number(c.h),
        c.k == null ? null : Number(c.k),
        Number(c.valid_mins),
        Number(c.events),
      ]),
    };
  });
}
