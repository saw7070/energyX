import { useMemo, useState } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { RequirementGuideTitle } from "@/components/analysis/RequirementGuide";
import { formatIsoDateWithWeekday, getWeekdayShort } from "@/components/analysis/nap/napDateFormat";
import { getNapDayTypeTooltipMeta } from "@/components/analysis/nap/napDayTypeFormat";
import { NapDailyTotalRow, NapEnergyAnalysisData } from "@/mock/napEnergyAnalysisData";

type FilterMode = "tag" | "space";
type TagChartRow = NapEnergyAnalysisData["tagChartRows"][number];

const TAG_SERIES = [
  { key: "lighting", label: "Lighting", color: "#4F9B86" },
  { key: "office_load", label: "Office Load", color: "#5B8BCF" },
  { key: "ventilation_fan", label: "Ventilation/Fan", color: "#9A8DBF" }
] as const;

const SPACE_SERIES = [
  { key: "level_6", label: "Level 6", color: "#5B8BCF" },
  { key: "level_7", label: "Level 7", color: "#4F9B86" }
] as const;

/** Show date label every Nth bar (interval={2} ≈ every 3rd tick). */
const DATE_TICK_INTERVAL = 3;

type TagKey = (typeof TAG_SERIES)[number]["key"];
type SpaceKey = (typeof SPACE_SERIES)[number]["key"];

/** Background fills for weekend / public-holiday column bands. */
const WEEKEND_BAND_FILL = "rgba(148, 163, 184, 0.22)";
const HOLIDAY_BAND_FILL = "rgba(251, 191, 36, 0.26)";

const DAY_TYPE_LEGEND = [
  { key: "weekend", label: "Weekend", fill: WEEKEND_BAND_FILL },
  { key: "holiday", label: "Public holiday", fill: HOLIDAY_BAND_FILL }
] as const;

interface DayMeta {
  date: string;
  dayType: NapDailyTotalRow["dayType"];
  weekday: string;
  holidayName?: string;
}

interface NapConsumptionBreakdownChartProps {
  data: NapEnergyAnalysisData;
}

function applyTagRowsToChart(
  row: TagChartRow,
  activeSeries: Array<(typeof TAG_SERIES)[number]>,
  selectedTag: string,
  costRate: number
) {
  const record: Record<string, number | string> = {
    label: row.label,
    total: row.total,
    cost: Math.round(row.total * costRate * 100) / 100
  };
  activeSeries.forEach((series) => {
    record[series.key] = row[series.key] ?? 0;
  });
  if (selectedTag !== "all") {
    const tagKey = activeSeries[0]?.key as TagKey | undefined;
    record.total = tagKey ? row[tagKey] : row.total;
    record.cost = Math.round(Number(record.total) * costRate * 100) / 100;
  }
  return record;
}

export function NapConsumptionBreakdownChart({ data }: NapConsumptionBreakdownChartProps) {
  const [mode, setMode] = useState<FilterMode>("tag");
  const [selectedTag, setSelectedTag] = useState<string>("all");
  const [selectedSpace, setSelectedSpace] = useState<string>("all");
  const [activeLabel, setActiveLabel] = useState<string | null>(null);

  const unitLabel = "kWh";
  const costRate = useMemo(() => {
    if (data.summary.totalKwh <= 0) {
      return 0.2972;
    }
    return data.summary.estimatedCostSgd / data.summary.totalKwh;
  }, [data.summary.estimatedCostSgd, data.summary.totalKwh]);

  const dayMetaByLabel = useMemo(() => {
    const map = new Map<string, DayMeta>();
    data.dailyTotals.forEach((row) => {
      map.set(row.shortLabel, {
        date: row.date,
        dayType: row.dayType,
        weekday: getWeekdayShort(row.date),
        holidayName: row.holidayName
      });
    });
    return map;
  }, [data.dailyTotals]);

  const isSingleLevelSpace = mode === "space" && selectedSpace !== "all";
  const selectedLevelNum = selectedSpace === "level_6" ? 6 : selectedSpace === "level_7" ? 7 : null;

  const levelTagRows = useMemo(() => {
    if (selectedSpace === "level_6") {
      return data.level6TagChartRows ?? [];
    }
    if (selectedSpace === "level_7") {
      return data.level7TagChartRows ?? [];
    }
    return [];
  }, [data.level6TagChartRows, data.level7TagChartRows, selectedSpace]);

  const activeSeries = useMemo(() => {
    if (isSingleLevelSpace) {
      return [...TAG_SERIES];
    }
    if (mode === "space") {
      return [...SPACE_SERIES];
    }
    if (selectedTag !== "all") {
      const matched = TAG_SERIES.find((item) => item.key === selectedTag);
      return matched ? [matched] : [TAG_SERIES[0]];
    }
    return [...TAG_SERIES];
  }, [isSingleLevelSpace, mode, selectedTag]);

  const chartData = useMemo(() => {
    if (isSingleLevelSpace) {
      return levelTagRows.map((row) => applyTagRowsToChart(row, activeSeries, "all", costRate));
    }
    if (mode === "tag") {
      return data.tagChartRows.map((row) => applyTagRowsToChart(row, activeSeries, selectedTag, costRate));
    }
    return data.spaceChartRows.map((row) => {
      const record: Record<string, number | string> = {
        label: row.label,
        total: row.total,
        cost: Math.round(row.total * costRate * 100) / 100
      };
      activeSeries.forEach((series) => {
        record[series.key] = row[series.key as SpaceKey] ?? 0;
      });
      return record;
    });
  }, [
    activeSeries,
    costRate,
    data.spaceChartRows,
    data.tagChartRows,
    isSingleLevelSpace,
    levelTagRows,
    mode,
    selectedTag
  ]);

  const chartDataWithMeta = useMemo(
    () =>
      chartData.map((row) => {
        const meta = dayMetaByLabel.get(String(row.label));
        return {
          ...row,
          dayType: meta?.dayType ?? "weekday",
          weekday: meta?.weekday ?? "",
          holidayName: meta?.holidayName
        };
      }),
    [chartData, dayMetaByLabel]
  );

  const weekendBands = useMemo(() => {
    const bands: Array<{ start: string; end: string }> = [];
    let bandStart: string | null = null;
    let bandEnd: string | null = null;

    chartDataWithMeta.forEach((row) => {
      const label = String(row.label);
      if (row.dayType === "weekend") {
        if (!bandStart) {
          bandStart = label;
        }
        bandEnd = label;
      } else if (bandStart && bandEnd) {
        bands.push({ start: bandStart, end: bandEnd });
        bandStart = null;
        bandEnd = null;
      }
    });

    if (bandStart && bandEnd) {
      bands.push({ start: bandStart, end: bandEnd });
    }
    return bands;
  }, [chartDataWithMeta]);

  const holidayBands = useMemo(
    () =>
      chartDataWithMeta
        .filter((row) => row.dayType === "holiday")
        .map((row) => ({ start: String(row.label), end: String(row.label) })),
    [chartDataWithMeta]
  );

  const periodAverage = useMemo(() => {
    if (chartData.length === 0) {
      return 0;
    }
    const sum = chartData.reduce((acc, item) => acc + Number(item.total), 0);
    return Math.round((sum / chartData.length) * 10) / 10;
  }, [chartData]);

  const activeRow = useMemo(
    () => (activeLabel ? chartDataWithMeta.find((item) => String(item.label) === activeLabel) : null),
    [activeLabel, chartDataWithMeta]
  );

  const levelPeriodSummary = useMemo(() => {
    if (!selectedLevelNum || levelTagRows.length === 0) {
      return null;
    }
    const totals = levelTagRows.reduce(
      (acc, row) => ({
        lighting: acc.lighting + row.lighting,
        office_load: acc.office_load + row.office_load,
        ventilation_fan: acc.ventilation_fan + row.ventilation_fan,
        total: acc.total + row.total
      }),
      { lighting: 0, office_load: 0, ventilation_fan: 0, total: 0 }
    );
    const tagShares = TAG_SERIES.map((series) => ({
      ...series,
      value: totals[series.key],
      pct: totals.total > 0 ? (totals[series.key] / totals.total) * 100 : 0
    }));
    const topCircuits = data.topCircuits
      .filter((circuit) => circuit.level === selectedLevelNum)
      .slice(0, 5);
    return { totals, tagShares, topCircuits, levelLabel: selectedLevelNum === 6 ? "Level 6" : "Level 7" };
  }, [data.topCircuits, levelTagRows, selectedLevelNum]);

  function formatTooltipDate(label: string) {
    const meta = dayMetaByLabel.get(label);
    if (!meta) {
      return label;
    }
    return formatIsoDateWithWeekday(meta.date);
  }

  function renderXAxisTick(props: { x?: number; y?: number; index?: number; payload?: { value?: string } }) {
    const { x = 0, y = 0, index = 0, payload } = props;
    const label = String(payload?.value ?? "");
    const meta = dayMetaByLabel.get(label);
    const showDate = index % DATE_TICK_INTERVAL === 0;
    const isHoliday = meta?.dayType === "holiday";
    return (
      <g transform={`translate(${x},${y})`}>
        {meta?.weekday ? (
          <text y={0} dy={10} textAnchor="middle" fill="#94a3b8" fontSize={10}>
            {meta.weekday}
          </text>
        ) : null}
        {showDate ? (
          <text y={0} dy={22} textAnchor="middle" fill="#64748b" fontSize={9}>
            {label}
          </text>
        ) : null}
        {isHoliday ? (
          <text y={0} dy={showDate ? 34 : 22} textAnchor="middle" fill="#fbbf24" fontSize={8}>
            PH
          </text>
        ) : null}
      </g>
    );
  }

  return (
    <section className="panel p-4">
      <div className="mb-2">
        <RequirementGuideTitle
          title="Consumption Breakdown"
          className="text-sm font-semibold text-white"
          content={{
            title: "Consumption Breakdown",
            summary: "Daily kWh and estimated cost by tag or floor over the 30-day monitoring period.",
            dataAcquisition: [
              "Monitoring period: 19 May–17 Jun 2026. Tag mode sums sub-meter daily totals by Lighting, Office Load, Ventilation/Fan.",
              "Space mode uses aggregate meters for both floors, or sub-meter tags when a single level is selected.",
              "Cost overlay uses SP regulated blended tariff (incl. 9% GST) for Apr/May/Jun 2026."
            ],
            chartGeneration: [
              "Stacked daily kWh bars with estimated daily cost line.",
              "X-axis: weekday on every bar, date labels at intervals, PH badge on public holidays.",
              "Amber bands = public holidays; grey bands = weekends.",
              "Single-floor filter stacks the three tag categories for that level only."
            ]
          }}
        />
      </div>

      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-1 flex-wrap items-center gap-1.5 text-xs">
          <select
            className="min-w-[140px] rounded-md border border-shell-600 bg-shell-800 px-2.5 py-1.5 text-slate-200"
            value={mode}
            onChange={(event) => {
              setMode(event.target.value as FilterMode);
              setSelectedTag("all");
              setSelectedSpace("all");
            }}
          >
            <option value="tag">Filter by tag</option>
            <option value="space">Filter by space</option>
          </select>

          {mode === "tag" ? (
            <select
              className="min-w-[170px] rounded-md border border-shell-600 bg-shell-800 px-2.5 py-1.5 text-slate-200"
              value={selectedTag}
              onChange={(event) => setSelectedTag(event.target.value)}
            >
              <option value="all">All energy tags</option>
              {TAG_SERIES.map((tag) => (
                <option key={tag.key} value={tag.key}>
                  {tag.label}
                </option>
              ))}
            </select>
          ) : null}

          {mode === "space" ? (
            <select
              className="min-w-[170px] rounded-md border border-shell-600 bg-shell-800 px-2.5 py-1.5 text-slate-200"
              value={selectedSpace}
              onChange={(event) => {
                setSelectedSpace(event.target.value);
                setSelectedTag("all");
              }}
            >
              <option value="all">All spaces</option>
              {SPACE_SERIES.map((space) => (
                <option key={space.key} value={space.key}>
                  {space.label}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      </div>

      <div className="mb-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px] text-slate-400">
        <span>Daily consumption · Unit: {unitLabel}</span>
        <div className="flex flex-wrap items-center gap-3">
          {DAY_TYPE_LEGEND.map((item) => (
            <span key={item.key} className="inline-flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-4 rounded-sm border border-white/10"
                style={{ backgroundColor: item.fill }}
              />
              {item.label}
            </span>
          ))}
          <span className="text-slate-500">·</span>
          <span>Estimated cost · Unit: S$</span>
        </div>
      </div>

      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartDataWithMeta}
            margin={{ bottom: 16, top: 8, right: 8, left: 0 }}
            onMouseMove={(state) => {
              if (state.activeLabel !== undefined) {
                setActiveLabel(String(state.activeLabel));
              }
            }}
            onMouseLeave={() => setActiveLabel(null)}
          >
            <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
            {weekendBands.map((band) => (
              <ReferenceArea
                key={`weekend-${band.start}-${band.end}`}
                yAxisId="usage"
                x1={band.start}
                x2={band.end}
                fill={WEEKEND_BAND_FILL}
                strokeOpacity={0}
              />
            ))}
            {holidayBands.map((band) => (
              <ReferenceArea
                key={`holiday-${band.start}-${band.end}`}
                yAxisId="usage"
                x1={band.start}
                x2={band.end}
                fill={HOLIDAY_BAND_FILL}
                strokeOpacity={0}
              />
            ))}
            <XAxis dataKey="label" stroke="#94a3b8" interval={0} height={48} tick={renderXAxisTick} />
            <YAxis yAxisId="usage" stroke="#94a3b8" tick={{ fontSize: 10 }} />
            <YAxis yAxisId="cost" orientation="right" stroke="#94a3b8" tick={{ fontSize: 10 }} />
            <Tooltip
              cursor={{ fill: "rgba(248, 250, 252, 0.08)" }}
              content={({ active, payload, label }) => {
                if (!active || !payload || payload.length === 0) {
                  return null;
                }

                const row = payload[0]?.payload as Record<string, number | string> & {
                  dayType?: NapDailyTotalRow["dayType"];
                  holidayName?: string;
                };
                const total = Number(row.total ?? 0);
                const cost = Number(row.cost ?? 0);
                const vsAvg = periodAverage > 0 ? ((total - periodAverage) / periodAverage) * 100 : 0;
                const dayTypeMeta = getNapDayTypeTooltipMeta(row.dayType ?? "weekday");
                const metricRows = [
                  { key: "type", label: dayTypeMeta.label, swatch: dayTypeMeta.swatch },
                  { key: "cost", label: `Cost (S$): ${cost.toFixed(2)}`, swatch: "#fde047" },
                  { key: "avg", label: `Period Average: ${periodAverage.toFixed(1)} ${unitLabel}`, swatch: "#f472b6" },
                  ...activeSeries.map((series) => ({
                    key: `series-${series.key}`,
                    label: `${series.label}: ${Number(row[series.key] ?? 0).toFixed(1)} ${unitLabel}`,
                    swatch: series.color
                  })),
                  { key: "total", label: `Total: ${total.toFixed(1)} ${unitLabel}`, swatch: "transparent", emphasis: true },
                  { key: "cost2", label: `Cost: S$${cost.toFixed(2)}`, swatch: "transparent", emphasis: true },
                  {
                    key: "vs",
                    label: `Vs Avg: ${vsAvg >= 0 ? "+" : ""}${vsAvg.toFixed(1)}%`,
                    swatch: "transparent",
                    emphasis: true,
                    tone: vsAvg >= 0 ? "text-rose-300" : "text-emerald-300"
                  }
                ];

                return (
                  <div className="rounded-lg border border-shell-600 bg-black/85 px-3 py-2 text-xs text-slate-200 shadow-soft">
                    <p className="mb-1 text-lg font-semibold text-white">{formatTooltipDate(String(label ?? ""))}</p>
                    <div className="space-y-0.5">
                      {metricRows.map((item) => (
                        <div key={item.key} className="flex h-6 items-center gap-2">
                          {item.swatch === "transparent" ? null : (
                            <span
                              className="inline-block h-3 w-3 border border-white/60"
                              style={{ backgroundColor: item.swatch }}
                            />
                          )}
                          <span className={`${item.emphasis ? "font-semibold text-white" : ""} ${item.tone ?? ""}`}>
                            {item.label}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              }}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
            {activeSeries.map((series) => (
              <Bar
                key={series.key}
                yAxisId="usage"
                dataKey={series.key}
                stackId="usage"
                name={series.label}
                fill={series.color}
              >
                {chartDataWithMeta.map((entry) => (
                  <Cell
                    key={`${series.key}-${String(entry.label)}`}
                    opacity={activeLabel === null || String(entry.label) === activeLabel ? 1 : 0.82}
                  />
                ))}
              </Bar>
            ))}
            <Line
              yAxisId="cost"
              type="monotone"
              dataKey="cost"
              name="Cost (S$)"
              stroke="#facc15"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: "#facc15", stroke: "#fff", strokeWidth: 1 }}
            />
            <ReferenceLine yAxisId="usage" y={periodAverage} stroke="#f472b6" strokeDasharray="5 4" />
            {activeRow ? (
              <ReferenceDot
                yAxisId="usage"
                x={String(activeRow.label)}
                y={periodAverage}
                r={5}
                fill="#f472b6"
                stroke="#ffffff"
                strokeWidth={1.5}
              />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {levelPeriodSummary ? (
        <div className="mt-4 grid gap-4 rounded-lg border border-shell-600 bg-shell-800/60 p-4 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
              {levelPeriodSummary.levelLabel} period breakdown (sub-meters)
            </p>
            <div className="space-y-2">
              {levelPeriodSummary.tagShares.map((item) => (
                <div key={item.key}>
                  <div className="mb-1 flex items-center justify-between text-xs text-slate-300">
                    <span className="inline-flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: item.color }} />
                      {item.label}
                    </span>
                    <span>
                      {item.value.toLocaleString()} {unitLabel} ({item.pct.toFixed(1)}%)
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-shell-900">
                    <div className="h-2 rounded-full" style={{ width: `${item.pct}%`, backgroundColor: item.color }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Top circuits</p>
            <ul className="space-y-1.5">
              {levelPeriodSummary.topCircuits.map((circuit, index) => (
                <li key={circuit.name} className="flex items-center justify-between text-xs text-slate-300">
                  <span className="truncate pr-3">
                    #{index + 1} {circuit.name}
                  </span>
                  <span className="shrink-0 text-slate-100">
                    {circuit.consumption.toLocaleString()} {unitLabel}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  );
}
