import { Lightbulb, Plug } from "lucide-react";
import { useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Sector, Tooltip } from "recharts";
import { NapBreakdownMeterRow, NapPeakWindow } from "@/mock/napEnergyAnalysisData";
import { formatPeakClockRange, formatPeakWindowLabel } from "@/components/analysis/nap/napPeakHelpers";
import type { LucideIcon } from "lucide-react";

const LEVEL_COLORS: Record<number, string> = {
  0: "#F59E0B",
  1: "#C68656",
  2: "#4F9B86",
  3: "#5B8BCF",
  4: "#9A8DBF",
  6: "#5B8BCF",
  7: "#9A8DBF"
};

type MeterKind = "light" | "load" | "fan";

const meterKindMeta: Record<MeterKind, { Icon: LucideIcon }> = {
  light: { Icon: Lightbulb },
  load: { Icon: Plug },
  fan: { Icon: Plug }
};

function getMeterKind(name: string, group: NapBreakdownMeterRow["group"], category?: string): MeterKind {
  if (category === "Lighting") {
    return "light";
  }
  if (category === "IT Devices") {
    return "fan";
  }
  const normalized = name.toLowerCase();
  if (group === "light" || normalized.includes("light")) {
    return "light";
  }
  if (normalized.includes("fan") || normalized.includes("isol")) {
    return "fan";
  }
  return "load";
}

interface NapPeakBreakdownModalProps {
  peaks: NapPeakWindow[];
  onClose: () => void;
  variant?: "nap" | "elite";
}

export function NapPeakBreakdownModal({ peaks, onClose, variant = "nap" }: NapPeakBreakdownModalProps) {
  const [selectedRank, setSelectedRank] = useState(peaks[0]?.rank ?? 1);
  const [selectedLevel, setSelectedLevel] = useState<number>(peaks[0]?.levels[0]?.level ?? (variant === "elite" ? 1 : 6));

  const activePeak = useMemo(
    () => peaks.find((item) => item.rank === selectedRank) ?? peaks[0],
    [peaks, selectedRank]
  );

  const donutData = useMemo(() => {
    if (!activePeak) {
      return [];
    }
    return activePeak.levels.map((level) => ({
      name: level.name,
      level: level.level,
      value: level.totalKwh,
      percentage: activePeak.totalKwh > 0 ? (level.totalKwh / activePeak.totalKwh) * 100 : 0,
      color: LEVEL_COLORS[level.level] ?? "#64748b"
    }));
  }, [activePeak]);

  const selectedLevelData = useMemo(
    () => activePeak?.levels.find((level) => level.level === selectedLevel) ?? activePeak?.levels[0],
    [activePeak, selectedLevel]
  );

  const selectedIndex = useMemo(
    () => donutData.findIndex((item) => item.level === selectedLevel),
    [donutData, selectedLevel]
  );

  const deviceRows = useMemo(() => {
    if (!selectedLevelData) {
      return [];
    }
    const peakTotal = activePeak?.totalKwh ?? 1;
    return selectedLevelData.subMeters
      .map((meter) => ({
        ...meter,
        sharePct: peakTotal > 0 ? (meter.kwh / peakTotal) * 100 : 0,
        kind: getMeterKind(meter.name, meter.group, meter.category)
      }))
      .sort((left, right) => right.kwh - left.kwh);
  }, [activePeak?.totalKwh, selectedLevelData]);

  const subMeterSum = useMemo(
    () => deviceRows.reduce((sum, meter) => sum + meter.kwh, 0),
    [deviceRows]
  );

  if (!activePeak) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl border border-shell-600 bg-shell-900 shadow-soft">
        <div className="flex items-start justify-between gap-3 border-b border-shell-600 p-5">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Peak breakdown</p>
            <h3 className="text-lg font-semibold text-white">Peak 1h Consumption</h3>
            <p className="mt-1 text-sm text-emerald-300">
              {activePeak.kwh.toLocaleString()} kWh ({formatPeakClockRange(activePeak.window)})
            </p>
            <p className="mt-1 text-xs text-slate-500">{formatPeakWindowLabel(activePeak.window)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-shell-600 px-2.5 py-1 text-xs text-slate-300 hover:bg-shell-800"
          >
            Close
          </button>
        </div>

        <div className="overflow-y-auto p-5">
          <label className="mb-1 block text-xs text-slate-400">Select peak window (top 5 clock hours)</label>
          <select
            value={selectedRank}
            onChange={(event) => {
              const rank = Number(event.target.value);
              setSelectedRank(rank);
              const peak = peaks.find((item) => item.rank === rank);
              if (peak?.levels[0]) {
                setSelectedLevel(peak.levels[0].level);
              }
            }}
            className="mb-4 w-full rounded-md border border-shell-600 bg-shell-800 px-3 py-2 text-sm text-slate-200"
          >
            {peaks.map((peak) => (
              <option key={peak.rank} value={peak.rank}>
                #{peak.rank} · {peak.kwh.toLocaleString()} kWh · {formatPeakWindowLabel(peak.window)}
              </option>
            ))}
          </select>

          <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                {variant === "elite" ? "By usage category (sub-meters)" : "By floor (aggregate totals)"}
              </p>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={donutData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={64}
                      outerRadius={108}
                      paddingAngle={1}
                      stroke="none"
                      activeIndex={selectedIndex >= 0 ? selectedIndex : undefined}
                      activeShape={(props: {
                        cx: number;
                        cy: number;
                        innerRadius: number;
                        outerRadius: number;
                        startAngle: number;
                        endAngle: number;
                        fill: string;
                      }) => (
                        <Sector
                          cx={props.cx}
                          cy={props.cy}
                          innerRadius={props.innerRadius}
                          outerRadius={props.outerRadius + 6}
                          startAngle={props.startAngle}
                          endAngle={props.endAngle}
                          fill={props.fill}
                          stroke="none"
                        />
                      )}
                      onClick={(_, index) => {
                        const item = donutData[index];
                        if (item) {
                          setSelectedLevel(item.level);
                        }
                      }}
                    >
                      {donutData.map((item) => (
                        <Cell key={item.level} fill={item.color} stroke="none" style={{ outline: "none" }} />
                      ))}
                    </Pie>
                    <text x="50%" y="42%" textAnchor="middle" dominantBaseline="middle" fill="#94a3b8" fontSize="11">
                      Peak total
                    </text>
                    <text x="50%" y="52%" textAnchor="middle" dominantBaseline="middle" fill="#f8fafc" fontSize="22" fontWeight={700}>
                      {activePeak.totalKwh.toLocaleString()}
                    </text>
                    <text x="50%" y="60%" textAnchor="middle" dominantBaseline="middle" fill="#94a3b8" fontSize="11">
                      kWh
                    </text>
                    <Tooltip
                      formatter={(value: number, name: string) => [`${value.toLocaleString()} kWh`, name]}
                      contentStyle={{ backgroundColor: "#020617", border: "1px solid #334155", borderRadius: 8 }}
                      labelStyle={{ color: "#f8fafc" }}
                      itemStyle={{ color: "#e2e8f0" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="mt-2 space-y-1">
                {donutData.map((item) => (
                  <button
                    key={item.level}
                    type="button"
                    onClick={() => setSelectedLevel(item.level)}
                    className={`flex w-full items-center justify-between rounded-md border px-2.5 py-2 text-left text-xs ${
                      selectedLevel === item.level
                        ? "border-blue-500/40 bg-shell-800 text-white"
                        : "border-shell-700 text-slate-300 hover:bg-shell-800"
                    }`}
                  >
                    <span className="inline-flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: item.color }} />
                      {item.name}
                    </span>
                    <span>
                      {item.value.toLocaleString()} kWh ({item.percentage.toFixed(1)}%)
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-shell-600 bg-shell-800/70 p-4">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                {selectedLevelData?.name ?? "Floor"} circuit breakdown
              </p>
              <p className="mb-3 text-xs text-slate-500">
                Sub-meter readings only (excludes Total Office Light / Total Office Load aggregate meters).
              </p>

              <ul className="max-h-80 divide-y divide-shell-700 overflow-y-auto rounded-md border border-shell-700 bg-shell-900">
                {deviceRows.map((meter) => {
                  const Icon = meterKindMeta[meter.kind].Icon;
                  return (
                    <li
                      key={meter.name}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                    >
                      <span className="inline-flex min-w-0 items-center gap-2 text-slate-200">
                        <Icon className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                        <span className="truncate">{meter.name}</span>
                      </span>
                      <span className="shrink-0 whitespace-nowrap text-slate-100">
                        {meter.kwh.toLocaleString()} kWh ({meter.sharePct.toFixed(1)}%)
                      </span>
                    </li>
                  );
                })}
              </ul>

              <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
                Peak total and floor split use aggregate meter totals. Circuit rows sum to{" "}
                {subMeterSum.toLocaleString()} kWh for this floor; a small discrepancy vs aggregate totals is normal
                due to metering and rounding.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
