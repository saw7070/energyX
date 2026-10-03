"use client";
import { useState } from "react";
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import {
  type EnergyScopeAnalysisDto,
} from "../../../lib/config-api";
import {
  chartPoints,
  dailyPoints,
  analysisDates,
  type Mode,
} from "./explorer-trend-model";
import { downloadText, explorerCsvFilename, explorerHourlyCsv } from "./explorer-export";
export function ExplorerTrends({
  analysis,
  meterId,
  onHealth,
}: {
  analysis: EnergyScopeAnalysisDto | null;
  meterId?: string;
  onHealth?: (a: EnergyScopeAnalysisDto | null) => void;
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  const displayed = analysis;
  const dates = analysisDates(analysis);
  const modes: Array<[Mode, string]> = [
    ...(dates.length <= 7 ? [["hourly", "Hourly"] as [Mode, string]] : []),
    ["daily", "Daily"],
    ...(dates.length >= 7 ? [["weekly", "Weekly"] as [Mode, string]] : []),
    ...(dates.length >= 28 ? [["monthly", "Monthly"] as [Mode, string]] : []),
  ];
  const selectedMode: Mode = mode && modes.some(([id]) => id === mode) ? mode : dates.length === 1 ? "hourly" : "daily";
  const series = displayed?.explorerTrends?.find(
    (s) => s.id === (meterId ?? "__scope__"),
  );
  const timezone = displayed?.context.timezone ?? "Asia/Singapore";
  const points = series ? chartPoints(series, dates, selectedMode) : [];
  const qs = displayed?.explorerTrends?.find(
    (s) => s.id === (meterId ?? "__scope__"),
  );
  const qualityDates = dates;
  const qp = qs ? dailyPoints(qs, qualityDates) : [];
  const coverage = qp.length
    ? qp.reduce((n, p) => n + p.coverage, 0) / qp.length
    : null;
  const unit = "kWh";
  const typicalPoints = series ? chartPoints(series, dates, "typical") : [];
  const meters = !meterId
    ? (displayed?.explorerMeters ?? []).filter(
        (m) =>
          m.scopeId === displayed?.context.scopeId &&
          displayed?.explorerTrends?.some((s) => s.id === m.id),
      )
    : [];
  const heatMax = Math.max(
    0.001,
    ...meters.flatMap((m) =>
      chartPoints(
        displayed!.explorerTrends!.find((s) => s.id === m.id)!,
        dates,
        selectedMode,
      ).map((c) => c.value ?? 0),
    ),
  );
  return (
    <section
      aria-label="Energy trends"
      className="my-6 space-y-5 rounded-xl border border-border bg-surface p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">Energy trends</h2>
        <div role="group" aria-label="Chart view" className="flex flex-wrap items-center gap-1 rounded-lg bg-surface-subtle p-1"><span className="px-2 text-sm text-muted">Show</span>
          {modes.map(([id, label]) => (
            <button
              type="button"
              key={id}
              aria-pressed={selectedMode === id}
              onClick={() => setMode(id)}
              className={`rounded-md px-3 py-2 text-sm transition-colors ${selectedMode === id ? "bg-primary text-white" : "text-muted hover:bg-surface"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted" aria-label="Chart dates">{dates[0] ?? "—"} – {dates.at(-1) ?? "—"} · {timezone}</p>
        {displayed?.explorerTrends?.length ? <button
          type="button"
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-subtle"
          onClick={() => downloadText(explorerCsvFilename(displayed, displayed.context.scopeId), explorerHourlyCsv(displayed))}
        >
          Download hourly data (Excel / CSV)
        </button> : null}
      </div>
      <details aria-label="Trend quality" className="text-sm text-muted">
        <summary className="cursor-pointer">Selected dates · {coverage == null ? "Coverage unavailable" : `${coverage.toFixed(1)}% coverage`}</summary>
        Only selected days are included, including a partially selected week or month.
      </details>
      <div
        className="h-72"
        aria-label="Actual energy chart"
      >
        {points.some((p) => p.value != null) ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={points}
              margin={{ top: 12, right: 16, left: 0, bottom: 12 }}
            >
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" minTickGap={35} />
              <YAxis
                width={65}
                label={{ value: unit, angle: -90, position: "insideLeft" }}
              />
              <Tooltip
                formatter={(value, _name, item) => [
                  `${Number(value).toFixed(2)} ${unit} · ${Number(item.payload.coverage).toFixed(1)}% coverage`,
                  "Energy",
                ]}
              />
              <Area
                dataKey="value"
                type="linear"
                connectNulls={false}
                stroke="var(--color-primary, #276854)"
                fill="#dcece5"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="grid h-full place-items-center text-sm text-muted">
            No usable time-series readings in this window.
          </div>
        )}
      </div>
      <details className="rounded-lg bg-surface-subtle p-4" aria-label="Average day profile">
        <summary className="cursor-pointer font-medium">Average 24-hour profile</summary>
        <p className="my-3 text-sm text-muted">Average power at each hour across these dates, using complete hours only.</p>
        <div className="h-56" aria-label="Average hourly power chart">
          {typicalPoints.some(p => p.value != null) ? <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={typicalPoints}>
              <CartesianGrid strokeDasharray="3 3" vertical={false}/><XAxis dataKey="label" minTickGap={35}/>
              <YAxis width={60} label={{value:"kW",angle:-90,position:"insideLeft"}}/>
              <Tooltip formatter={value => [`${Number(value).toFixed(2)} kW`, "Average power"]}/>
              <Area dataKey="value" type="linear" connectNulls={false} stroke="#276854" fill="#dcece5" isAnimationActive={false}/>
            </AreaChart>
          </ResponsiveContainer> : <p>No complete hourly readings in these dates.</p>}
        </div>
      </details>
      {meters.length > 0 && (
        <div>
          <h3 className="mb-2 font-semibold">Device energy heatmap</h3>
          <p className="mb-3 text-sm text-muted">
            Darker = more energy · Grey = no readings · Outline = partial readings.
          </p>
          <details className="mb-3 text-sm text-muted"><summary>How to read this heatmap</summary><p>Each row is a meter on the same colour scale. Hover over a cell for its reading. Meter rows may overlap; do not add them together.</p></details>
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-surface p-2 text-left">
                    Circuit
                  </th>
                  {points.map((p) => (
                    <th className="px-2 py-1 font-normal" key={p.label}>
                      {p.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {meters.map((m) => {
                  const s = displayed!.explorerTrends!.find(
                    (s) => s.id === m.id,
                  )!;
                  const cells = chartPoints(s, dates, selectedMode);
                  const max = heatMax;
                  return (
                    <tr key={m.id}>
                      <th className="sticky left-0 whitespace-nowrap bg-surface p-2 text-left font-medium">
                        {m.name}
                      </th>
                      {cells.map((c) => (
                        <td key={c.label} className="p-0.5">
                          <div
                            tabIndex={0}
                            aria-label={`${m.name}, ${c.label}: ${c.value == null ? "No data" : c.value.toFixed(2) + " " + unit}, ${c.coverage.toFixed(1)}% coverage`}
                            title={`${m.name} · ${c.label}: ${c.value == null ? "No data" : c.value.toFixed(2) + " " + unit} · ${c.coverage.toFixed(1)}% coverage`}
                            className={`h-7 min-w-7 rounded-sm ${c.coverage < 100 ? "ring-1 ring-inset ring-amber-500" : ""}`}
                            style={{
                              background:
                                c.value == null
                                  ? "#e5e7eb"
                                  : `rgba(39,104,84,${0.08 + (0.92 * c.value) / max})`,
                            }}
                          />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
