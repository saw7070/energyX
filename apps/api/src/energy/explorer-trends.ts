/** Compact hourly facts; scope totals use only published official routes. */
export type ExplorerTrendSeries = {
  id: string;
  expectedMinutesPerHour: number;
  cells: Array<[string, number, number | null, number, number]>;
};
/**
 * A series sums its meters. A virtual meter's series also carries each input's sign (main − sub-meters); its hour is
 * only a value when every input has a complete hour, because a missing input would otherwise read as real usage.
 */
export type ExplorerTrendRoute = {
  id: string;
  meters: string[];
  coefficients?: Record<string, 1 | -1>;
};
const literal = (s: string) => "'" + s.replaceAll("'", "''") + "'";
const quoted = (view: string) => `"${view.replaceAll('"', '""')}"`;
const routeTerms = (routes: ExplorerTrendRoute[], withTermCount = false) => routes.flatMap((r) => {
  const meters = [...new Set(r.meters)];
  return meters.map((m) => `(${literal(r.id)}, ${literal(m)}, ${r.coefficients?.[m] === -1 ? -1 : 1}${withTermCount ? `, ${meters.length}` : ""})`);
});
export function explorerTrendSql(
  view: string,
  routes: ExplorerTrendRoute[],
) {
  const terms = routeTerms(routes);
  if (!terms.length) return null;
  return `SELECT series_id, to_json(list(struct_pack(d := d, h := h, k := k, valid_mins := valid_mins, events := events) ORDER BY d,h)) AS cells
  FROM (SELECT r.series_id, CAST(local_date AS VARCHAR) d, local_hour h,
    SUM(usage_kwh * r.coef) FILTER (WHERE quality_status = 'ok') k,
    COALESCE(SUM(elapsed_minutes) FILTER (WHERE quality_status = 'ok'),0) AS valid_mins,
    COUNT(*) FILTER (WHERE quality_status <> 'ok') events
    FROM ${quoted(view)} source
    JOIN (VALUES ${terms.join(",")}) r(series_id,meter_id,coef) ON source.meter_node_id=r.meter_id
    GROUP BY r.series_id,local_date,local_hour) cells GROUP BY series_id`;
}
export function decodeExplorerTrends(
  rows: Array<Record<string, unknown>>,
  routes: ExplorerTrendRoute[],
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
    const expectedMinutesPerHour = new Set(route.meters).size * 60;
    return {
      id: route.id,
      expectedMinutesPerHour,
      cells: cells.map((c) => [
        String(c.d).slice(0, 10),
        Number(c.h),
        c.k == null || (route.coefficients && Number(c.valid_mins) < expectedMinutesPerHour) ? null : Number(c.k),
        Number(c.valid_mins),
        Number(c.events),
      ]),
    };
  });
}

/**
 * Highest 15-minute average power of each virtual meter, over intervals where every input reported a valid reading.
 * Returns local interval start and kW per series.
 */
export function virtualMeterPeakSql(view: string, routes: ExplorerTrendRoute[]) {
  const terms = routeTerms(routes, true);
  if (!terms.length) return null;
  return `SELECT series_id, MAX(kw) AS peak_kw, CAST(arg_max(t, kw) AS VARCHAR) AS peak_at
  FROM (SELECT r.series_id, source.local_interval_start t,
      SUM(source.usage_kwh * r.coef) / (MAX(source.elapsed_minutes) / 60.0) AS kw,
      COUNT(DISTINCT source.meter_node_id) AS inputs, MAX(r.term_count) AS term_count
    FROM ${quoted(view)} source
    JOIN (VALUES ${terms.join(",")}) r(series_id,meter_id,coef,term_count) ON source.meter_node_id=r.meter_id
    WHERE source.quality_status = 'ok' AND source.elapsed_minutes > 0
    GROUP BY r.series_id, source.local_interval_start) intervals
  WHERE inputs = term_count
  GROUP BY series_id`;
}
