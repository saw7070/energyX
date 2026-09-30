import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { RequirementGuideTitle } from "@/components/analysis/RequirementGuide";
import { NapLevelUsageHeatmapSection } from "@/components/analysis/nap/NapLevelUsageHeatmapSection";
import { NapEnergyAnalysisData, NapHourlyRow } from "@/mock/napEnergyAnalysisData";

type ProfileType = "weekday" | "weekend" | "holiday";
type SpaceScope = "all" | "level6" | "level7";

const TAG_SERIES = [
  { key: "Lighting", label: "Lighting", color: "#4F9B86" },
  { key: "Office_Load", label: "Office Load", color: "#5B8BCF" },
  { key: "Ventilation_Fan", label: "Ventilation/Fan", color: "#9A8DBF" }
] as const;

/** Tooltip breakdown top → bottom: Fan, Load, Lighting. */
const TOOLTIP_TAG_ORDER = ["Ventilation_Fan", "Office_Load", "Lighting"] as const;

const SPACE_OPTIONS: Array<{ key: SpaceScope; label: string }> = [
  { key: "all", label: "All spaces" },
  { key: "level6", label: "Level 6" },
  { key: "level7", label: "Level 7" }
];

interface NapDayProfileAnalysisSectionProps {
  data: NapEnergyAnalysisData;
}

/** Hourly stacked total unit — sum of all sub-meter readings in that clock hour. */
const HOUR_UNIT_LABEL = "kWh/h";

function stackedHourTotal(row: NapHourlyRow): number {
  return (row.Lighting ?? 0) + (row.Office_Load ?? 0) + (row.Ventilation_Fan ?? 0);
}

/** Daily kWh from profile: sum of 24 hourly category totals. */
function estimateDailyKwhFromProfile(rows: NapHourlyRow[]): number {
  return rows.reduce((sum, row) => sum + stackedHourTotal(row), 0);
}

function hourlyRowsToChartData(rows: NapHourlyRow[]) {
  const mapped = rows.map((row) => {
    const lighting = row.Lighting ?? 0;
    const officeLoad = row.Office_Load ?? 0;
    const ventilationFan = row.Ventilation_Fan ?? 0;
    return {
      hour: `${row.hour}:00`,
      Lighting: lighting,
      Office_Load: officeLoad,
      Ventilation_Fan: ventilationFan,
      total: lighting + officeLoad + ventilationFan
    };
  });
  if (mapped.length === 0) {
    return mapped;
  }
  return [...mapped, { ...mapped[0], hour: "24:00" }];
}

export function NapDayProfileAnalysisSection({ data }: NapDayProfileAnalysisSectionProps) {
  const unitLabel = "kWh";
  const profileYAxisMax = data.profileMeta.stackedProfileYMax ?? 50;
  const [profileType, setProfileType] = useState<ProfileType>("weekday");
  const [spaceScope, setSpaceScope] = useState<SpaceScope>("all");

  const { summary, profileMeta } = data;

  const profileKpis = useMemo(
    () => ({
      weekday: summary.weekdayDailyAvgKwh,
      weekend: summary.weekendDailyAvgKwh,
      holiday: summary.holidayDailyAvgKwh
    }),
    [summary.holidayDailyAvgKwh, summary.weekdayDailyAvgKwh, summary.weekendDailyAvgKwh]
  );

  const weekdayVsHolidayPct =
    profileKpis.holiday > 0 ? ((profileKpis.weekday - profileKpis.holiday) / profileKpis.holiday) * 100 : 0;
  const weekendVsWeekdayPct =
    profileKpis.weekday > 0 ? ((profileKpis.weekend - profileKpis.weekday) / profileKpis.weekday) * 100 : 0;

  const holidayLabelText = useMemo(() => {
    if (profileMeta.holidayDays.length === 0) {
      return "—";
    }
    return profileMeta.holidayDays.map((item) => item.shortLabel).join(", ");
  }, [profileMeta.holidayDays]);

  const activeHourlyRows = useMemo(
    () => data.profileHourlyBySpace[spaceScope][profileType],
    [data.profileHourlyBySpace, profileType, spaceScope]
  );

  const chartData = useMemo(() => hourlyRowsToChartData(activeHourlyRows), [activeHourlyRows]);

  const profileDailyKwh = useMemo(
    () => Math.round(estimateDailyKwhFromProfile(activeHourlyRows) * 10) / 10,
    [activeHourlyRows]
  );

  const peakHour = useMemo(() => {
    const rows = hourlyRowsToChartData(activeHourlyRows).filter((row) => row.hour !== "24:00");
    return rows.reduce(
      (best, row) => (row.total > best.total ? { hour: row.hour, total: row.total } : best),
      { hour: "00:00", total: 0 }
    );
  }, [activeHourlyRows]);

  const scopeLabel = SPACE_OPTIONS.find((item) => item.key === spaceScope)?.label ?? "All spaces";

  const profileSampleLabel =
    profileType === "weekday"
      ? `${profileMeta.weekdayCount} weekday sample${profileMeta.weekdayCount === 1 ? "" : "s"}`
      : profileType === "weekend"
        ? `${profileMeta.weekendCount} weekend sample${profileMeta.weekendCount === 1 ? "" : "s"}`
        : `${profileMeta.holidayCount} public holiday sample${profileMeta.holidayCount === 1 ? "" : "s"}`;

  return (
    <div className="panel p-4">
      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-emerald-700/40 bg-shell-900 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Weekday Avg</p>
          <p className="mt-1 text-3xl font-semibold text-slate-100">
            {profileKpis.weekday.toFixed(1)}
            <span className="ml-1 text-xl">{unitLabel}/day</span>
          </p>
          <p className="mt-1 text-[10px] text-slate-500">
            {profileMeta.weekdayCount} weekday sample{profileMeta.weekdayCount === 1 ? "" : "s"} in monitoring period
          </p>
        </div>
        <div className="rounded-lg border border-shell-600 bg-shell-900 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Weekend Avg</p>
          <p className="mt-1 text-3xl font-semibold text-slate-100">
            {profileKpis.weekend.toFixed(1)}
            <span className="ml-1 text-xl">{unitLabel}/day</span>
          </p>
          <p className={`mt-1 text-[10px] ${weekendVsWeekdayPct <= 0 ? "text-emerald-300" : "text-amber-300"}`}>
            {weekendVsWeekdayPct >= 0 ? "+" : ""}
            {weekendVsWeekdayPct.toFixed(1)}% vs weekday
          </p>
        </div>
        <div className="rounded-lg border border-shell-600 bg-shell-900 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Holiday Baseline</p>
          <p className="mt-1 text-3xl font-semibold text-emerald-300">
            {profileKpis.holiday.toFixed(1)}
            <span className="ml-1 text-xl">{unitLabel}/day</span>
          </p>
          <p className="mt-1 text-[10px] text-slate-500">{holidayLabelText}</p>
        </div>
      </div>

      <RequirementGuideTitle
        title="24-Hour Stacked Profile Comparison"
        className="mb-1 text-xs font-semibold text-white"
        content={{
          title: "24-Hour Stacked Profile Comparison",
          summary: "Average weekday, weekend, or holiday hourly load by tag for the selected floor scope.",
          dataAcquisition: [
            "For each calendar day, sum sub-meter 15-minute deltas into clock-hour buckets by tag.",
            "Average those hourly totals across weekday, weekend, or holiday samples in 19 May–17 Jun 2026.",
            "Scope: all sub-meters, Level 6 only, or Level 7 only.",
            "Holiday samples in monitoring period: 27 May (Vesak Day) and 1 Jun (Public Holiday)."
          ],
          chartGeneration: [
            "Stacked area chart: average kWh/h per clock hour for Lighting, Office Load, Ventilation/Fan.",
            "Profile and space selectors drive precomputed hourly rows.",
            "Y-axis max fixed across filters (stackedProfileYMax) for fair comparison."
          ]
        }}
      />
      <p className="mb-3 text-[11px] text-slate-400">
        Average daily hourly sub-meter totals by tag · Period {profileMeta.periodLabel}
      </p>

      <div className="mb-3 grid gap-3 xl:grid-cols-2">
        <div className="rounded-md border border-shell-600 bg-shell-900 p-2">
          <p className="mb-2 text-[10px] text-slate-400">Usage Profile</p>
          <div className="inline-flex rounded border border-shell-600 bg-shell-800 p-1">
            {(
              [
                { key: "weekday", label: "Weekday" },
                { key: "weekend", label: "Weekend" },
                { key: "holiday", label: "Holiday" }
              ] as Array<{ key: ProfileType; label: string }>
            ).map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setProfileType(item.key)}
                className={`rounded px-2 py-1 text-[10px] ${
                  profileType === item.key ? "bg-blue-600 text-white" : "text-slate-300 hover:text-white"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-md border border-shell-600 bg-shell-900 p-2">
          <p className="mb-2 text-[10px] text-slate-400">Space Filter</p>
          <select
            className="w-full rounded border border-shell-600 bg-shell-800 px-3 py-1.5 text-[11px] text-slate-200"
            value={spaceScope}
            onChange={(event) => setSpaceScope(event.target.value as SpaceScope)}
          >
            {SPACE_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="h-72 rounded-md border border-shell-700 bg-black/10 p-2">
        <p className="mb-1 text-[10px] text-slate-400">
          Stacked height = average daily sum of all sub-meters in that hour by tag · Y-axis fixed 0–{profileYAxisMax}{" "}
          {HOUR_UNIT_LABEL}
        </p>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 6, right: 22, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
            <XAxis
              dataKey="hour"
              stroke="#94a3b8"
              tick={{ fontSize: 10 }}
              interval={1}
              padding={{ left: 4, right: 10 }}
              tickMargin={6}
            />
            <YAxis
              stroke="#94a3b8"
              tick={{ fontSize: 10 }}
              domain={[0, profileYAxisMax]}
              tickCount={7}
              allowDataOverflow
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload || payload.length === 0) {
                  return null;
                }
                const payloadByKey = new Map(payload.map((item) => [String(item.dataKey), item]));
                const rows = TOOLTIP_TAG_ORDER.map((key) => payloadByKey.get(key)).filter(
                  (item): item is NonNullable<typeof item> => item != null
                );
                const stackedTotal = rows.reduce((sum, item) => sum + Number(item.value ?? 0), 0);
                return (
                  <div className="rounded-lg border border-shell-600 bg-black/85 px-3 py-2 text-xs text-slate-200 shadow-soft">
                    <p className="mb-1.5 text-sm font-semibold text-white">Time {label}</p>
                    <div className="space-y-1">
                      {rows.map((item) => (
                        <div key={String(item.dataKey)} className="flex items-center gap-2">
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-sm"
                            style={{ backgroundColor: item.color }}
                          />
                          <span>
                            {String(item.name ?? item.dataKey).replace(/_/g, " ")}:{" "}
                            {Number(item.value ?? 0).toFixed(2)} {HOUR_UNIT_LABEL}
                          </span>
                        </div>
                      ))}
                      <div className="mt-1 border-t border-shell-600 pt-1 font-semibold text-white">
                        Total: {stackedTotal.toFixed(2)} {HOUR_UNIT_LABEL}
                      </div>
                    </div>
                  </div>
                );
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: "#cbd5e1" }} />
            {TAG_SERIES.map((tag) => (
              <Area
                key={tag.key}
                type="monotone"
                dataKey={tag.key}
                name={tag.label}
                stackId="usage"
                stroke={tag.color}
                fill={tag.color}
                fillOpacity={0.35}
                strokeWidth={1.2}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 grid gap-2 text-[11px] text-slate-300 md:grid-cols-3">
        <div className="rounded border border-shell-700 bg-shell-900 px-2 py-1">
          Profile: {profileType === "weekday" ? "Weekday" : profileType === "weekend" ? "Weekend" : "Holiday"} ·{" "}
          {profileSampleLabel}
        </div>
        <div className="rounded border border-shell-700 bg-shell-900 px-2 py-1">Scope: {scopeLabel}</div>
        <div className="rounded border border-shell-700 bg-shell-900 px-2 py-1">
          Est. daily: {profileDailyKwh} kWh · Peak {peakHour.hour}: {peakHour.total.toFixed(1)} {HOUR_UNIT_LABEL} stacked
        </div>
      </div>
      <p className="mt-2 text-[11px] text-slate-500">
        Weekday is {weekdayVsHolidayPct.toFixed(1)}% above holiday baseline. Day groups are mutually exclusive
        (weekday, weekend, holiday).
        {profileMeta.holidayDays.length > 0
          ? ` Holidays: ${profileMeta.holidayDays.map((item) => item.shortLabel).join(", ")}.`
          : null}
      </p>

      <NapLevelUsageHeatmapSection data={data} />
    </div>
  );
}
