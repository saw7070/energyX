import { useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Bar
} from "recharts";
import { RequirementGuideTitle } from "@/components/analysis/RequirementGuide";
import { formatIsoDateWithWeekday, getWeekdayShort } from "@/components/analysis/nap/napDateFormat";
import { formatNapDayTypeLabel } from "@/components/analysis/nap/napDayTypeFormat";
import { NapAnomalyDeviceDetailPanel } from "@/components/analysis/nap/NapAnomalyDeviceDetailPanel";
import { NapDailyTotalRow, NapEnergyAnalysisData, NapHourlyRow } from "@/mock/napEnergyAnalysisData";

type SpaceScope = "all" | "level6" | "level7";
type DayTypeFilter = NapDailyTotalRow["dayType"];
type DetailViewMode = "overlay" | "selected" | "average";
type CircuitKey = "Lighting" | "Office Load" | "Ventilation/Fan";
export type NapDailyTrendViewMode = "full" | "trendOnly" | "anomalyListOnly";

const CIRCUITS: CircuitKey[] = ["Lighting", "Office Load", "Ventilation/Fan"];
const CIRCUIT_COLORS: Record<CircuitKey, string> = {
  Lighting: "#4F9B86",
  "Office Load": "#5B8BCF",
  "Ventilation/Fan": "#9A8DBF"
};

const SPACE_OPTIONS: Array<{ key: SpaceScope; label: string }> = [
  { key: "all", label: "All spaces" },
  { key: "level6", label: "Level 6" },
  { key: "level7", label: "Level 7" }
];

const DAY_TYPE_OPTIONS: Array<{ key: DayTypeFilter; label: string }> = [
  { key: "weekday", label: "Weekday" },
  { key: "weekend", label: "Weekend" },
  { key: "holiday", label: "Holiday" }
];

const DAY_TYPE_FILTER_LABEL: Record<DayTypeFilter, string> = {
  weekday: "Weekday",
  weekend: "Weekend",
  holiday: "Public holiday"
};

const DATE_TICK_INTERVAL = 3;

interface NapDailyTrendAnomalySectionProps {
  data: NapEnergyAnalysisData;
  viewMode?: NapDailyTrendViewMode;
  spaceScope?: SpaceScope;
  onSpaceScopeChange?: (scope: SpaceScope) => void;
  /** When true, chart and anomaly list filter by weekday / weekend / holiday. */
  dayTypeFilterEnabled?: boolean;
  /** v2: sub-meter × 24h heatmaps in anomaly detail modal. */
  deviceHeatmapDetail?: boolean;
}

interface TrendRow {
  dateLabel: string;
  shortLabel: string;
  weekday: string;
  dayType: NapDailyTotalRow["dayType"];
  holidayName?: string;
  total: number;
  level6: number;
  level7: number;
  expected: number;
  threshold: number;
  deltaPct: number;
  anomaly: boolean;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function stackedHourTotal(row: NapHourlyRow | undefined): number {
  if (!row) {
    return 0;
  }
  if (typeof row.total === "number") {
    return row.total;
  }
  return (row.Lighting ?? 0) + (row.Office_Load ?? 0) + (row.Ventilation_Fan ?? 0);
}

function circuitValue(row: NapHourlyRow | undefined, circuit: CircuitKey): number {
  if (!row) {
    return 0;
  }
  if (circuit === "Lighting") {
    return row.Lighting ?? 0;
  }
  if (circuit === "Office Load") {
    return row.Office_Load ?? 0;
  }
  return row.Ventilation_Fan ?? 0;
}

function buildScopedTrendRows(
  dailyTotals: NapDailyTotalRow[],
  scope: SpaceScope,
  baselineMeta: NapEnergyAnalysisData["baselineMeta"]
): TrendRow[] {
  const typeMeans = baselineMeta.byScope[scope];

  return dailyTotals.map((row) => {
    const total = scope === "level6" ? row.level6 : scope === "level7" ? row.level7 : row.total;
    const expected = typeMeans[row.dayType] ?? 0;
    const threshold = round1(expected * 1.15);
    const anomaly = total > threshold;
    const deltaPct = expected > 0 ? round2(((total - expected) / expected) * 100) : 0;
    return {
      dateLabel: row.date,
      shortLabel: row.shortLabel,
      weekday: getWeekdayShort(row.date),
      dayType: row.dayType,
      holidayName: row.holidayName,
      total,
      level6: row.level6,
      level7: row.level7,
      expected,
      threshold,
      deltaPct,
      anomaly
    };
  });
}

function referenceLabelForDayType(dayType: NapDailyTotalRow["dayType"]): string {
  if (dayType === "weekend") {
    return "Weekend average";
  }
  if (dayType === "holiday") {
    return "Holiday average";
  }
  return "Weekday average";
}

function heatCellColor(reference: number, selected: number, isSelectedRow: boolean): string {
  if (!isSelectedRow || reference <= 0) {
    return "rgba(148, 163, 184, 0.18)";
  }
  const delta = (selected - reference) / reference;
  if (delta > 0.3) {
    return "rgba(225, 29, 72, 0.42)";
  }
  if (delta > 0.18) {
    return "rgba(249, 115, 22, 0.32)";
  }
  if (delta < -0.2) {
    return "rgba(16, 185, 129, 0.3)";
  }
  return "rgba(71, 85, 105, 0.24)";
}

export function NapDailyTrendAnomalySection({
  data,
  viewMode = "full",
  spaceScope: controlledSpaceScope,
  onSpaceScopeChange,
  dayTypeFilterEnabled = false,
  deviceHeatmapDetail = false
}: NapDailyTrendAnomalySectionProps) {
  const unitLabel = "kWh";
  const hourlyUnitLabel = "kWh/h";
  const [internalSpaceScope, setInternalSpaceScope] = useState<SpaceScope>("all");
  const [dayTypeFilter, setDayTypeFilter] = useState<DayTypeFilter>("weekday");
  const spaceScope = controlledSpaceScope ?? internalSpaceScope;
  const setSpaceScope = onSpaceScopeChange ?? setInternalSpaceScope;
  const showTrend = viewMode === "full" || viewMode === "trendOnly";
  const showAnomalyList = viewMode === "full" || viewMode === "anomalyListOnly";
  const [selectedAnomalyRow, setSelectedAnomalyRow] = useState<TrendRow | null>(null);
  const [detailMode, setDetailMode] = useState<DetailViewMode>("overlay");
  const [selectedCircuit, setSelectedCircuit] = useState<CircuitKey>("Ventilation/Fan");
  const referenceLabelForSelected = selectedAnomalyRow
    ? referenceLabelForDayType(selectedAnomalyRow.dayType)
    : "";

  const scopedTrendRows = useMemo(
    () => buildScopedTrendRows(data.dailyTotals, spaceScope, data.baselineMeta),
    [data.baselineMeta, data.dailyTotals, spaceScope]
  );

  const trendRows = useMemo(() => {
    if (!dayTypeFilterEnabled) {
      return scopedTrendRows;
    }
    return scopedTrendRows.filter((row) => row.dayType === dayTypeFilter);
  }, [dayTypeFilterEnabled, dayTypeFilter, scopedTrendRows]);

  const filteredDayCount = trendRows.length;

  const anomalyRows = useMemo(() => trendRows.filter((row) => row.anomaly), [trendRows]);
  const anomalyCount = anomalyRows.length;
  const dateTickInterval = filteredDayCount <= 8 ? 1 : DATE_TICK_INTERVAL;
  const dayTypeBaseline = data.baselineMeta.byScope[spaceScope][dayTypeFilter];

  const anomalyDetailData = useMemo(() => {
    if (!selectedAnomalyRow || deviceHeatmapDetail) {
      return null;
    }

    const selectedHourly = data.dailyHourlyBySpace[spaceScope][selectedAnomalyRow.dateLabel] ?? [];
    const referenceHourly = data.profileHourlyBySpace[spaceScope][selectedAnomalyRow.dayType] ?? [];
    const referenceLabel = referenceLabelForDayType(selectedAnomalyRow.dayType);

    const overlayData = Array.from({ length: 24 }, (_, hourIndex) => {
      const selectedRow = selectedHourly[hourIndex];
      const referenceRow = referenceHourly[hourIndex];
      const row: Record<string, number | string> = {
        hour: `${String(hourIndex).padStart(2, "0")}:00`,
        selectedTotal: stackedHourTotal(selectedRow),
        referenceTotal: stackedHourTotal(referenceRow)
      };
      CIRCUITS.forEach((circuit) => {
        row[`${circuit}-selected`] = circuitValue(selectedRow, circuit);
        row[`${circuit}-reference`] = circuitValue(referenceRow, circuit);
      });
      return row;
    });

    const referenceValues = referenceHourly.map((row) => circuitValue(row, selectedCircuit));
    const selectedValues = selectedHourly.map((row) => circuitValue(row, selectedCircuit));
    const circuitReferenceTotal = referenceValues.reduce((sum, value) => sum + value, 0);
    const circuitSelectedTotal = selectedValues.reduce((sum, value) => sum + value, 0);
    const circuitDeltaPct =
      circuitReferenceTotal > 0
        ? ((circuitSelectedTotal - circuitReferenceTotal) / circuitReferenceTotal) * 100
        : 0;
    const over30Count = selectedValues.filter((value, index) => {
      const baseline = referenceValues[index];
      return baseline > 0 && (value - baseline) / baseline > 0.3;
    }).length;

    let peakHourIndex = 0;
    let peakDelta = -Infinity;
    selectedValues.forEach((value, hourIndex) => {
      const baseline = referenceValues[hourIndex];
      const delta = baseline > 0 ? (value - baseline) / baseline : 0;
      if (delta > peakDelta) {
        peakDelta = delta;
        peakHourIndex = hourIndex;
      }
    });
    const focusWindowLabel = `${String(peakHourIndex).padStart(2, "0")}:00-${String((peakHourIndex + 1) % 24).padStart(2, "0")}:00`;

    return {
      referenceLabel,
      overlayData,
      heatmapRows: [
        { name: referenceLabel, values: referenceValues },
        { name: selectedAnomalyRow.dateLabel, values: selectedValues }
      ],
      circuitDeltaPct,
      over30Count,
      circuitReferenceTotal,
      circuitSelectedTotal,
      focusCircuit: selectedCircuit,
      focusWindowLabel
    };
  }, [data.dailyHourlyBySpace, data.profileHourlyBySpace, deviceHeatmapDetail, selectedAnomalyRow, selectedCircuit, spaceScope]);

  const scopeLabel = SPACE_OPTIONS.find((option) => option.key === spaceScope)?.label ?? "All spaces";

  const dayMetaByLabel = useMemo(() => {
    const map = new Map<
      string,
      { date: string; dayType: NapDailyTotalRow["dayType"]; weekday: string; holidayName?: string }
    >();
    trendRows.forEach((row) => {
      map.set(row.shortLabel, {
        date: row.dateLabel,
        dayType: row.dayType,
        weekday: row.weekday,
        holidayName: row.holidayName
      });
    });
    return map;
  }, [trendRows]);

  function handleDayTypeFilterChange(next: DayTypeFilter) {
    setDayTypeFilter(next);
    setSelectedAnomalyRow(null);
  }

  function renderXAxisTick(props: { x?: number; y?: number; index?: number; payload?: { value?: string } }) {
    const { x = 0, y = 0, index = 0, payload } = props;
    const label = String(payload?.value ?? "");
    const meta = dayMetaByLabel.get(label);
    const showDate = index % dateTickInterval === 0;
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
    <section className="panel p-4" id={showAnomalyList && !showTrend ? "nap-anomaly-section" : undefined}>
      {showTrend ? (
        <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <RequirementGuideTitle
            title="Daily Total Trend"
            className="text-sm font-semibold text-white"
            content={{
              title: "Daily Total Trend",
              summary: "Daily aggregate consumption vs day-type baseline and 115% anomaly threshold.",
              dataAcquisition: [
                "Chart data: aggregate meter daily totals (dailyTotals) for 19 May–17 Jun 2026.",
                "Expected baseline = day-type mean calibrated over 21 Apr–17 Jun 2026 (58 days, incl. 1 May Labour Day).",
                "Each day classified as weekday, weekend, or holiday per SG public holiday calendar.",
                "Anomaly when actual exceeds same day-type baseline by >15% (threshold = baseline × 1.15)."
              ],
              chartGeneration: [
                "ComposedChart: bars (actual), smooth line (expected), dashed line (threshold).",
                "Red ReferenceDot on anomaly days; scope filter for All / Level 6 / Level 7.",
                "X-axis shows weekday and PH markers consistent with Consumption Breakdown."
              ]
            }}
          />
          <p className="text-xs text-slate-400">
            {dayTypeFilterEnabled ? (
              <>
                {filteredDayCount} {DAY_TYPE_FILTER_LABEL[dayTypeFilter].toLowerCase()} sample
                {filteredDayCount === 1 ? "" : "s"} · expected baseline {dayTypeBaseline} {unitLabel}/day ·
                calibrated {formatIsoDateWithWeekday(data.baselineMeta.periodStart)} –{" "}
                {formatIsoDateWithWeekday(data.baselineMeta.periodEnd)} · anomaly rule: actual &gt; day-type baseline
                by 15%.
              </>
            ) : (
              <>
                {data.meta.dayCount}-day chart · baseline calibrated{" "}
                {formatIsoDateWithWeekday(data.baselineMeta.periodStart)} –{" "}
                {formatIsoDateWithWeekday(data.baselineMeta.periodEnd)} ({data.baselineMeta.dayCount} days) · anomaly
                rule: actual &gt; day-type baseline by 15%.
              </>
            )}
          </p>
        </div>
        <div className="text-xs text-slate-300">
          Scope: <span className="font-semibold text-white">{scopeLabel}</span>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-start gap-3">
        {dayTypeFilterEnabled ? (
          <div className="rounded-md border border-shell-600 bg-shell-900 p-2">
            <p className="mb-2 text-[11px] text-slate-400">Day Type</p>
            <div className="inline-flex rounded border border-shell-600 bg-shell-800 p-1">
              {DAY_TYPE_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => handleDayTypeFilterChange(option.key)}
                  className={`rounded px-2 py-1 text-[10px] ${
                    dayTypeFilter === option.key ? "bg-blue-600 text-white" : "text-slate-300 hover:text-white"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="rounded-md border border-shell-600 bg-shell-900 p-2">
          <p className="mb-2 text-[11px] text-slate-400">Space Filter</p>
          <div className="inline-flex rounded border border-shell-600 bg-shell-800 p-1">
            {SPACE_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setSpaceScope(option.key)}
                className={`rounded px-2 py-1 text-[10px] ${
                  spaceScope === option.key ? "bg-blue-600 text-white" : "text-slate-300 hover:text-white"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mb-1 text-[11px] text-slate-400">
        Daily total · Unit: {unitLabel}
        {dayTypeFilterEnabled ? ` · ${DAY_TYPE_FILTER_LABEL[dayTypeFilter]} only` : ""}
      </div>

      <div className="mb-4 h-80">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={trendRows} margin={{ top: 8, right: 12, bottom: 8, left: 2 }}>
            <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
            <XAxis
              dataKey="shortLabel"
              stroke="#94a3b8"
              interval={0}
              height={48}
              tick={renderXAxisTick}
            />
            <YAxis stroke="#94a3b8" tick={{ fontSize: 10 }} width={40} tickFormatter={(value) => String(value)} />
            <Tooltip
              formatter={(value: number, name: string) => [`${Number(value).toFixed(1)} ${unitLabel}`, name]}
              labelFormatter={(_, payload) => {
                const row = payload?.[0]?.payload as TrendRow | undefined;
                return row ? formatIsoDateWithWeekday(row.dateLabel) : "";
              }}
              contentStyle={{ backgroundColor: "#020617", border: "1px solid #334155", borderRadius: 8 }}
              labelStyle={{ color: "#f8fafc" }}
              itemStyle={{ color: "#e2e8f0" }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="total" fill="#5B8BCF" name="Daily Total" radius={[4, 4, 0, 0]} />
            <Line
              type="monotone"
              dataKey="expected"
              stroke="#f59e0b"
              strokeWidth={2}
              dot={false}
              strokeLinejoin="round"
              strokeLinecap="round"
              name="Expected Baseline"
            />
            <Line
              type="monotone"
              dataKey="threshold"
              stroke="#ef4444"
              strokeDasharray="4 4"
              strokeWidth={1.8}
              dot={false}
              strokeLinejoin="round"
              strokeLinecap="round"
              name="Anomaly Threshold (115%)"
            />
            {anomalyRows.map((row) => (
              <ReferenceDot
                key={`anom-${row.dateLabel}`}
                x={row.shortLabel}
                y={row.total}
                r={4}
                fill="#ef4444"
                stroke="#fff"
                strokeWidth={1.2}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="mb-2 text-xs text-slate-300">
        Detected anomalies: <span className="font-semibold text-rose-300">{anomalyCount}</span> / {filteredDayCount}{" "}
        {dayTypeFilterEnabled ? `${DAY_TYPE_FILTER_LABEL[dayTypeFilter].toLowerCase()} ` : ""}
        day{filteredDayCount === 1 ? "" : "s"}
      </div>
        </>
      ) : null}

      {showAnomalyList ? (
        <>
      {!showTrend ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300">
          <span>
            Scope: <span className="font-semibold text-white">{scopeLabel}</span>
          </span>
        </div>
      ) : null}

      <div className="rounded-md border border-shell-600" id={showTrend ? "nap-anomaly-section" : undefined}>
        <div className="border-b border-shell-600 bg-shell-800 px-3 py-2 text-xs font-medium text-slate-300">
          <RequirementGuideTitle
            title="Detected Anomaly List"
            className="text-xs font-medium text-slate-300"
            content={{
              title: "Detected Anomaly List",
              summary: "All days flagged above the day-type threshold; click a row for hourly drill-down.",
              dataAcquisition: [
                "Filter dailyTotals where anomaly = true for the selected space scope.",
                "Columns: date, day type, actual vs expected, threshold, Level 6/7 split, delta %."
              ],
              chartGeneration: [
                "Compact table; row click opens Anomaly Detail modal.",
                "Empty state when no anomalies in scope."
              ]
            }}
          />
        </div>
        <div className="max-h-72 overflow-y-auto">
          {anomalyRows.length === 0 ? (
            <div className="px-3 py-4 text-xs text-slate-400">
              No anomalies detected
              {dayTypeFilterEnabled ? ` for ${DAY_TYPE_FILTER_LABEL[dayTypeFilter].toLowerCase()} samples` : ""} in the
              current scope.
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-shell-700 text-slate-300">
                <tr>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-right">Daily Total</th>
                  <th className="px-3 py-2 text-right">Expected</th>
                  <th className="px-3 py-2 text-right">Threshold</th>
                  <th className="px-3 py-2 text-right">L6 / L7 (kWh)</th>
                  <th className="px-3 py-2 text-right">Delta</th>
                  <th className="px-3 py-2 text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {anomalyRows.map((row) => (
                  <tr
                    key={`daily-row-${row.dateLabel}`}
                    className="cursor-pointer border-t border-shell-600 text-slate-200 hover:bg-shell-800/70"
                    onClick={() => {
                      setSelectedAnomalyRow(row);
                      setDetailMode("overlay");
                      setSelectedCircuit("Ventilation/Fan");
                    }}
                  >
                    <td className="whitespace-nowrap px-3 py-2">{formatIsoDateWithWeekday(row.dateLabel)}</td>
                    <td className="px-3 py-2">
                      {formatNapDayTypeLabel(row.dayType)}
                      {row.holidayName ? ` (${row.holidayName})` : ""}
                    </td>
                    <td className="px-3 py-2 text-right">{row.total.toFixed(1)}</td>
                    <td className="px-3 py-2 text-right">{row.expected.toFixed(1)}</td>
                    <td className="px-3 py-2 text-right">{row.threshold.toFixed(1)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-slate-400">
                      {row.level6.toFixed(1)} / {row.level7.toFixed(1)}
                    </td>
                    <td className="px-3 py-2 text-right text-rose-300">+{row.deltaPct.toFixed(1)}%</td>
                    <td className="px-3 py-2 text-center">
                      <span className="rounded bg-rose-500/20 px-2 py-0.5 text-rose-300">Anomaly</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

        </>
      ) : null}

      {selectedAnomalyRow && (deviceHeatmapDetail || anomalyDetailData) ? (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 px-4">
          <div className="max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-lg border border-shell-600 bg-shell-950 p-4 shadow-soft">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <RequirementGuideTitle
                  title={`Anomaly Detail — ${formatIsoDateWithWeekday(selectedAnomalyRow.dateLabel)}`}
                  className="text-sm font-semibold text-white"
                  content={{
                    title: "Anomaly Detail",
                    summary: deviceHeatmapDetail
                      ? "Sub-meter hourly heatmaps compare the spike day against the day-type average."
                      : "Compare the anomaly day's hourly category load against the day-type reference profile.",
                    dataAcquisition: deviceHeatmapDetail
                      ? [
                          "Spike: deviceHourlyByDate for the selected anomaly date.",
                          "Reference: deviceHourlyProfilesByDayType for the same day type.",
                          "Overlay cells: (spike − average) / average as percentage."
                        ]
                      : [
                          "Selected day: hourly category totals from dailyHourlyBySpace for the anomaly date.",
                          "Reference: profileHourlyBySpace average for the same day type (weekday/weekend/holiday) and scope."
                        ],
                    chartGeneration: deviceHeatmapDetail
                      ? [
                          "Three tabs: delta % heatmap, spike kWh/h heatmap, average kWh/h heatmap.",
                          "Y-axis = sub-meters in scope; X-axis = 24 clock hours."
                        ]
                      : [
                          "Overlay or stacked modes: selected day vs reference profile.",
                          "Category selector and 24-hour heatmap with delta-aware colour encoding (>30% above reference = red)."
                        ]
                  }}
                />
                <p className="text-xs text-slate-400">
                  {selectedAnomalyRow.deltaPct >= 0 ? "+" : ""}
                  {selectedAnomalyRow.deltaPct.toFixed(1)}% vs {referenceLabelForSelected.toLowerCase()} · {scopeLabel}
                </p>
              </div>
              <button
                type="button"
                className="rounded border border-shell-600 px-2 py-1 text-xs text-slate-300 hover:text-white"
                onClick={() => setSelectedAnomalyRow(null)}
              >
                Close
              </button>
            </div>

            {deviceHeatmapDetail ? (
              <NapAnomalyDeviceDetailPanel
                data={data}
                dateLabel={selectedAnomalyRow.dateLabel}
                shortLabel={selectedAnomalyRow.shortLabel}
                dayType={selectedAnomalyRow.dayType}
                referenceLabel={referenceLabelForSelected}
                spaceScope={spaceScope}
                detailMode={detailMode}
                onDetailModeChange={setDetailMode}
              />
            ) : anomalyDetailData ? (
              <>
                <section className="mb-4 rounded-md border border-shell-700 bg-shell-900 p-3">
                  <h4 className="mb-2 text-xs font-semibold text-emerald-300">
                    Stacked chart: {selectedAnomalyRow.shortLabel} vs {anomalyDetailData.referenceLabel}
                  </h4>
                  <div className="mb-2 inline-flex rounded border border-shell-600 bg-shell-800 p-1 text-xs">
                    {(
                      [
                        { key: "overlay", label: "Overlay comparison" },
                        { key: "selected", label: `${selectedAnomalyRow.shortLabel} (spike)` },
                        { key: "average", label: anomalyDetailData.referenceLabel }
                      ] as Array<{ key: DetailViewMode; label: string }>
                    ).map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        className={`rounded px-2 py-1 ${detailMode === item.key ? "bg-emerald-700 text-white" : "text-slate-300"}`}
                        onClick={() => setDetailMode(item.key)}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                  <p className="mb-2 text-[11px] text-slate-400">
                    Peak deviation hour: <span className="text-rose-300">{anomalyDetailData.focusWindowLabel}</span> |
                    Category: <span className="text-rose-300">{anomalyDetailData.focusCircuit}</span>
                  </p>

                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={anomalyDetailData.overlayData}>
                        <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                        <XAxis dataKey="hour" stroke="#94a3b8" tick={{ fontSize: 10 }} interval={1} />
                        <YAxis stroke="#94a3b8" tick={{ fontSize: 10 }} unit={` ${hourlyUnitLabel}`} />
                        <Tooltip
                          formatter={(value: number, key: string) => [`${value.toFixed(2)} ${hourlyUnitLabel}`, key]}
                          contentStyle={{ backgroundColor: "#020617", border: "1px solid #334155", borderRadius: 8 }}
                          labelStyle={{ color: "#f8fafc" }}
                          itemStyle={{ color: "#e2e8f0" }}
                        />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        {detailMode === "overlay" ? (
                          <>
                            <Line
                              type="monotone"
                              dataKey="selectedTotal"
                              name={`${selectedAnomalyRow.shortLabel} hourly total`}
                              stroke="#ef4444"
                              strokeWidth={2.2}
                              dot={false}
                            />
                            <Line
                              type="monotone"
                              dataKey="referenceTotal"
                              name={`${anomalyDetailData.referenceLabel} hourly total`}
                              stroke="#84a98c"
                              strokeDasharray="4 4"
                              strokeWidth={1.8}
                              dot={false}
                            />
                          </>
                        ) : null}
                        {detailMode === "selected"
                          ? CIRCUITS.map((circuit) => (
                              <Area
                                key={`selected-${circuit}`}
                                type="monotone"
                                dataKey={`${circuit}-selected`}
                                name={circuit}
                                stackId="selected"
                                stroke={CIRCUIT_COLORS[circuit]}
                                fill={CIRCUIT_COLORS[circuit]}
                                fillOpacity={0.35}
                                strokeWidth={1.5}
                              />
                            ))
                          : null}
                        {detailMode === "average"
                          ? CIRCUITS.map((circuit) => (
                              <Area
                                key={`reference-${circuit}`}
                                type="monotone"
                                dataKey={`${circuit}-reference`}
                                name={circuit}
                                stackId="reference"
                                stroke={CIRCUIT_COLORS[circuit]}
                                fill={CIRCUIT_COLORS[circuit]}
                                fillOpacity={0.25}
                                strokeWidth={1.4}
                              />
                            ))
                          : null}
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="mt-2 text-xs text-slate-300">
                    Red line = selected day hourly total. Dashed line = {anomalyDetailData.referenceLabel.toLowerCase()}.
                  </p>
                </section>

                <section className="rounded-md border border-shell-700 bg-shell-900 p-3">
                  <RequirementGuideTitle
                    title={`Heatmap: ${anomalyDetailData.referenceLabel} vs ${selectedAnomalyRow.shortLabel}`}
                    className="mb-1 text-xs font-semibold text-emerald-300"
                    content={{
                      title: "Anomaly Heatmap",
                      summary: "Hour-by-hour comparison of reference profile vs the anomaly day for the selected category.",
                      dataAcquisition: [
                        "Two rows: day-type reference average and selected anomaly day, per clock hour.",
                        "Values from the same category filter (Lighting, Office Load, Ventilation/Fan, or Total)."
                      ],
                      chartGeneration: [
                        "24-column hourly matrix; red cells = >30% above reference at that hour.",
                        "Moderate increase and reduction use distinct colour steps."
                      ]
                    }}
                  />
                  <p className="mb-2 text-xs text-slate-400">Red cells indicate &gt;30% above reference at that hour.</p>
                  <div className="mb-2 flex items-center gap-2 text-xs text-slate-300">
                    <span>Category:</span>
                    <div className="flex flex-wrap gap-1">
                      {CIRCUITS.map((circuit) => (
                        <button
                          key={`circuit-${circuit}`}
                          type="button"
                          className={`rounded-full border px-2 py-0.5 ${
                            selectedCircuit === circuit
                              ? "border-emerald-500 bg-emerald-700/30 text-emerald-200"
                              : "border-shell-600 text-slate-300"
                          }`}
                          onClick={() => setSelectedCircuit(circuit)}
                        >
                          {circuit}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-[190px_repeat(24,minmax(0,1fr))] gap-1 text-[10px]">
                    <div />
                    {Array.from({ length: 24 }, (_, hour) => (
                      <div key={`h-${hour}`} className="text-center text-slate-500">
                        {hour % 3 === 0 ? `${hour}:00` : ""}
                      </div>
                    ))}

                    {anomalyDetailData.heatmapRows.map((row, rowIndex) => (
                      <div key={`heat-${row.name}`} className="contents">
                        <div className={`pr-2 ${rowIndex === 1 ? "font-semibold text-rose-300" : "text-slate-300"}`}>
                          {rowIndex === 1 ? selectedAnomalyRow.shortLabel : row.name}
                        </div>
                        {row.values.map((value, hourIndex) => {
                          const reference = anomalyDetailData.heatmapRows[0].values[hourIndex];
                          return (
                            <div
                              key={`${row.name}-${hourIndex}`}
                              className="rounded border border-shell-700 px-1 py-1 text-center text-slate-100"
                              style={{ backgroundColor: heatCellColor(reference, value, rowIndex === 1) }}
                            >
                              {value.toFixed(2)}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>

                  <p className="mt-2 text-xs text-slate-300">
                    {selectedCircuit}: {anomalyDetailData.referenceLabel} ={" "}
                    {anomalyDetailData.circuitReferenceTotal.toFixed(2)} {hourlyUnitLabel} | {selectedAnomalyRow.shortLabel}{" "}
                    = {anomalyDetailData.circuitSelectedTotal.toFixed(2)} {hourlyUnitLabel} (
                    {anomalyDetailData.circuitDeltaPct >= 0 ? "+" : ""}
                    {anomalyDetailData.circuitDeltaPct.toFixed(0)}%) | {anomalyDetailData.over30Count} hour(s) above +30%.
                  </p>
                </section>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
