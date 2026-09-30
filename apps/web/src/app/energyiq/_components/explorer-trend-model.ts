import type { EnergyScopeAnalysisDto } from "../../../lib/config-api";
export type Series = NonNullable<
  EnergyScopeAnalysisDto["explorerTrends"]
>[number];
export type Mode = "daily" | "weekly" | "monthly" | "typical" | "yesterday" | "hourly";
export function localDate(iso: string, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}
export function datesBetween(from: string, to: string) {
  const days: string[] = [];
  for (
    let d = Date.parse(from + "T00:00:00Z");
    d <= Date.parse(to + "T00:00:00Z");
    d += 86400000
  )
    days.push(new Date(d).toISOString().slice(0, 10));
  return days;
}
export function dailyPoints(series: Series, dates: string[]) {
  return dates.map((date) => {
    const cells = series.cells.filter((c) => c[0] === date);
    const minutes = cells.reduce((n, c) => n + c[3], 0),
      expected = series.expectedMinutesPerHour * 24;
    return {
      label: date,
      value: minutes > 0 ? cells.reduce((n, c) => n + (c[2] ?? 0), 0) : null,
      coverage: expected > 0 ? Math.min(100, (minutes / expected) * 100) : 0,
      events: cells.reduce((n, c) => n + c[4], 0),
    };
  });
}
export function chartPoints(series: Series, dates: string[], mode: Mode) {
  if (mode === "hourly") return dates.flatMap(date => Array.from({length: 24}, (_, hour) => {
    const cell = series.cells.find(c => c[0] === date && c[1] === hour);
    return {label: `${date} ${String(hour).padStart(2, "0")}:00`,
      value: cell && cell[3] > 0 ? cell[2] : null,
      coverage: cell && series.expectedMinutesPerHour > 0 ? Math.min(100, cell[3] / series.expectedMinutesPerHour * 100) : 0,
      events: cell?.[4] ?? 0};
  }));
  if (mode === "typical" || mode === "yesterday")
    return Array.from({ length: 24 }, (_, hour) => {
      const cells = series.cells.filter(
        (c) => dates.includes(c[0]) && c[1] === hour,
      );
      const eligible =
        mode === "typical"
          ? cells.filter(
              (c) => c[3] === series.expectedMinutesPerHour && c[4] === 0,
            )
          : cells;
      const minutes = cells.reduce((n, c) => n + c[3], 0),
        expected = series.expectedMinutesPerHour * dates.length;
      return {
        label: String(hour).padStart(2, "0") + ":00",
        value: eligible.some((c) => c[2] != null)
          ? eligible.reduce((n, c) => n + (c[2] ?? 0), 0) / eligible.length
          : null,
        coverage: expected > 0 ? Math.min(100, (minutes / expected) * 100) : 0,
        events: cells.reduce((n, c) => n + c[4], 0),
      };
    });
  const daily = dailyPoints(series, dates);
  if (mode === "daily") return daily;
  if (mode === "monthly") {
    const months = new Map<string, typeof daily>();
    for (const point of daily) {
      const key = point.label.slice(0, 7) + "-01";
      months.set(key, [...(months.get(key) ?? []), point]);
    }
    return [...months].map(([label, days]) => ({
      label,
      value: days.some((d) => d.value != null)
        ? days.reduce((n, d) => n + (d.value ?? 0), 0)
        : null,
      coverage: days.reduce((n, d) => n + d.coverage, 0) / days.length,
      events: days.reduce((n, d) => n + d.events, 0),
    }));
  }
  const weeks = new Map<string, typeof daily>();
  for (const point of daily) {
    const d = new Date(point.label + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const key = d.toISOString().slice(0, 10);
    weeks.set(key, [...(weeks.get(key) ?? []), point]);
  }
  return [...weeks].map(([label, days]) => ({
    label,
    value: days.some((d) => d.value != null)
      ? days.reduce((n, d) => n + (d.value ?? 0), 0)
      : null,
    coverage: days.reduce((n, d) => n + d.coverage, 0) / days.length,
    events: days.reduce((n, d) => n + d.events, 0),
  }));
}

export function analysisDates(analysis: EnergyScopeAnalysisDto | null): string[] {
  return analysis ? datesBetween(localDate(analysis.context.from, analysis.context.timezone),
    localDate(new Date(Date.parse(analysis.context.to) - 1).toISOString(), analysis.context.timezone)) : [];
}
export function completeDailyAverage(analysis: EnergyScopeAnalysisDto | null, meterId = "__scope__") {
  const series = analysis?.explorerTrends?.find(s => s.id === meterId);
  const days = series ? dailyPoints(series, analysisDates(analysis)).filter(p => p.value != null && p.coverage >= 100 && p.events === 0) : [];
  return {value: days.length ? days.reduce((n, p) => n + p.value!, 0) / days.length : null, days: days.length};
}
export function recentCompleteDates(timezone: string, now = new Date()) {
  const today = localDate(now.toISOString(), timezone);
  const end = Date.parse(today + "T00:00:00Z");
  return {from: new Date(end - 3 * 86400000).toISOString().slice(0,10), to: new Date(end - 86400000).toISOString().slice(0,10)};
}
export function recentSeriesHealth(series: Series, dates: string[]) {
  const days = dailyPoints(series, dates);
  if (days.length === 3 && days.every(d => d.coverage >= 97 && d.events === 0))
    return {status: "complete" as const, label: "Last 3 complete days: readings available (each day ≥97%)"};
  return {status: "review" as const, label: days.every(d => d.value == null)
    ? "Last 3 complete days: no usable intervals. Check source updates; this does not establish a meter fault."
    : "Last 3 complete days: gaps or quality events. Check readings."};
}
