import { useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { RequirementGuideTitle } from "@/components/analysis/RequirementGuide";
import { ELITE_CATEGORY_SERIES } from "@/components/analysis/eliteiot/eliteiotCategoryConfig";
import { EliteLevelUsageHeatmapSection } from "@/components/analysis/eliteiot/EliteLevelUsageHeatmapSection";
import { asEliteData, getEliteScopedProfileHourly } from "@/components/analysis/eliteiot/eliteiotScopeHelpers";
import type { EliteCategoryScope } from "@/mock/eliteiotEnergyAnalysisData";
import { NapEnergyAnalysisData, NapHourlyRow } from "@/mock/napEnergyAnalysisData";

type ProfileType = "weekday" | "weekend" | "holiday";
type ProfileCategoryScope = "incoming" | "sub_meters";

const SUB_METER_PROFILE_SCOPES = ["fnb", "lighting", "it_devices", "general_plug"] as const satisfies readonly EliteCategoryScope[];

const SUB_METER_TAG_SERIES = ELITE_CATEGORY_SERIES;

const PROFILE_SCOPE_OPTIONS: Array<{ key: ProfileCategoryScope; label: string }> = [
  { key: "incoming", label: "Incoming 3Phase" },
  { key: "sub_meters", label: "All sub-meters (F&B + Lighting + IT + General Plug)" }
];

function profileScopeLabel(scope: ProfileCategoryScope): string {
  return PROFILE_SCOPE_OPTIONS.find((option) => option.key === scope)?.label ?? scope;
}

interface EliteDayProfileAnalysisSectionProps {
  data: NapEnergyAnalysisData;
}

/** Hourly stacked total unit — sum of all sub-meter readings in that clock hour. */
const HOUR_UNIT_LABEL = "kWh/h";

function hourlyRowsToIncomingChartData(rows: NapHourlyRow[]) {
  const mapped = rows.map((row) => ({
    hour: `${row.hour}:00`,
    total: row.total ?? 0
  }));
  if (mapped.length === 0) {
    return mapped;
  }
  return [...mapped, { ...mapped[0], hour: "24:00" }];
}

function ceilProfileYAxisMax(peak: number): number {
  if (peak <= 0) {
    return 1;
  }
  return Math.ceil(peak * 1.12 * 10) / 10;
}

function peakFromChartRows(rows: Array<Record<string, number | string>>): number {
  return rows
    .filter((row) => row.hour !== "24:00")
    .reduce((peak, row) => Math.max(peak, Number(row.total ?? 0)), 0);
}

function computeFixedProfileYAxisMax(
  data: NapEnergyAnalysisData,
  categoryScope: ProfileCategoryScope,
  includeHoliday: boolean
): number {
  const dayTypes: ProfileType[] = includeHoliday ? ["weekday", "weekend", "holiday"] : ["weekday", "weekend"];
  let peak = 0;
  dayTypes.forEach((dayType) => {
    if (categoryScope === "incoming") {
      const rows =
        dayType === "weekday"
          ? data.hourlyWeekdayTotal
          : dayType === "weekend"
            ? data.hourlyWeekendTotal
            : data.hourlyHolidayTotal;
      peak = Math.max(
        peak,
        rows.reduce((hourPeak, row) => Math.max(hourPeak, row.total ?? 0), 0)
      );
      return;
    }
    peak = Math.max(peak, peakFromChartRows(buildSubMeterStackedChartData(dayType, data)));
  });
  return ceilProfileYAxisMax(peak);
}

function buildSubMeterStackedChartData(profileType: ProfileType, data: NapEnergyAnalysisData) {
  const eliteData = asEliteData(data);
  const scopeRows = SUB_METER_PROFILE_SCOPES.map((scope) => ({
    scope,
    rows: getEliteScopedProfileHourly(eliteData, scope, profileType)
  }));
  const hourCount = scopeRows[0]?.rows.length ?? 0;
  const mapped = Array.from({ length: hourCount }, (_, index) => {
    const hour = scopeRows[0]?.rows[index]?.hour ?? String(index).padStart(2, "0");
    const record: Record<string, number | string> = { hour: `${hour}:00` };
    let total = 0;
    scopeRows.forEach(({ scope, rows }) => {
      const value = rows[index]?.total ?? 0;
      record[scope] = value;
      total += value;
    });
    record.total = total;
    return record;
  });
  if (mapped.length === 0) {
    return mapped;
  }
  return [...mapped, { ...mapped[0], hour: "24:00" }];
}

export function EliteDayProfileAnalysisSection({ data }: EliteDayProfileAnalysisSectionProps) {
  const unitLabel = "kWh";
  const [profileType, setProfileType] = useState<ProfileType>("weekday");
  const [categoryScope, setCategoryScope] = useState<ProfileCategoryScope>("incoming");

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

  const chartData = useMemo(() => {
    if (categoryScope === "incoming") {
      const rows =
        profileType === "weekday"
          ? data.hourlyWeekdayTotal
          : profileType === "weekend"
            ? data.hourlyWeekendTotal
            : data.hourlyHolidayTotal;
      return hourlyRowsToIncomingChartData(rows);
    }
    return buildSubMeterStackedChartData(profileType, data);
  }, [categoryScope, data, profileType]);

  const estimateDailyKwhFromProfile = useMemo(() => {
    const rows = chartData.filter((row) => row.hour !== "24:00");
    return rows.reduce((sum, row) => sum + Number(row.total ?? 0), 0);
  }, [chartData]);

  const profileYAxisMax = useMemo(
    () => computeFixedProfileYAxisMax(data, categoryScope, profileMeta.holidayCount > 0),
    [categoryScope, data, profileMeta.holidayCount]
  );

  const profileDailyKwh = useMemo(
    () => Math.round(estimateDailyKwhFromProfile * 10) / 10,
    [estimateDailyKwhFromProfile]
  );

  const peakHour = useMemo(() => {
    const rows = chartData.filter((row) => row.hour !== "24:00");
    return rows.reduce(
      (best, row) => (row.total > best.total ? { hour: row.hour, total: row.total } : best),
      { hour: "00:00", total: 0 }
    );
  }, [chartData]);

  const scopeLabel = profileScopeLabel(categoryScope);

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
        title="24-Hour Profile Comparison"
        className="mb-1 text-xs font-semibold text-white"
        content={{
          title: "24-Hour Profile Comparison",
          summary: "Average weekday, weekend, or holiday hourly load — incoming meter vs all sub-meters combined.",
          dataAcquisition: [
            "Incoming 3Phase: average hourly totals from the main incomer meter.",
            "All sub-meters: stacked F&B, Lighting, IT Devices, and General Plug hourly profiles.",
            "Holiday sample in monitoring period: 17 Jun 2026 (Hari Raya Haji)."
          ],
          chartGeneration: [
            "Incoming: single area line. Sub-meters: four stacked areas by usage tag.",
            "Y-axis fixed per category — weekday / weekend / holiday share the same scale for fair comparison.",
            "Day-type selector drives the sample group (weekday / weekend / holiday)."
          ]
        }}
      />
      <p className="mb-3 text-[11px] text-slate-400">
        Average hourly profile · {scopeLabel} · Period {profileMeta.periodLabel}
      </p>

      <div className="mb-3 grid gap-3 xl:grid-cols-2">
        <div className="rounded-md border border-shell-600 bg-shell-900 p-2">
          <p className="mb-2 text-[10px] text-slate-400">Usage Profile</p>
          <div className="inline-flex rounded border border-shell-600 bg-shell-800 p-1">
            {(
              [
                { key: "weekday", label: "Weekday" },
                { key: "weekend", label: "Weekend" },
                ...(profileMeta.holidayCount > 0 ? [{ key: "holiday" as const, label: "Holiday" }] : [])
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
          <p className="mb-2 text-[10px] text-slate-400">Category Filter</p>
          <select
            className="w-full rounded border border-shell-600 bg-shell-800 px-3 py-1.5 text-[11px] text-slate-200"
            value={categoryScope}
            onChange={(event) => setCategoryScope(event.target.value as ProfileCategoryScope)}
          >
            {PROFILE_SCOPE_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="h-72 rounded-md border border-shell-700 bg-black/10 p-2">
        <p className="mb-1 text-[10px] text-slate-400">
          {categoryScope === "incoming"
            ? `Average hourly total · ${scopeLabel} · Unit ${HOUR_UNIT_LABEL} · Y-axis fixed 0–${profileYAxisMax.toFixed(1)} ${HOUR_UNIT_LABEL} (weekday / weekend / holiday)`
            : `Stacked sub-meter profile · F&B / Lighting / IT Devices / General Plug · Y-axis fixed 0–${profileYAxisMax.toFixed(1)} ${HOUR_UNIT_LABEL} (weekday / weekend / holiday)`}
        </p>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 6, right: 22, left: 0, bottom: 0 }}>
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
                const rows =
                  categoryScope === "sub_meters"
                    ? SUB_METER_TAG_SERIES.map((series) => ({
                        ...series,
                        value: Number(payload[0]?.payload?.[series.key] ?? 0)
                      }))
                    : [{ label: scopeLabel, color: "#5B8BCF", value: Number(payload[0]?.value ?? 0) }];
                const stackedTotal = rows.reduce((sum, row) => sum + row.value, 0);
                return (
                  <div className="rounded-lg border border-shell-600 bg-black/85 px-3 py-2 text-xs text-slate-200 shadow-soft">
                    <p className="mb-1.5 text-sm font-semibold text-white">Time {label}</p>
                    <div className="space-y-1">
                      {rows.map((row) => (
                        <div key={row.label} className="flex items-center gap-2">
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-sm"
                            style={{ backgroundColor: row.color }}
                          />
                          <span>
                            {row.label}: {row.value.toFixed(2)} {HOUR_UNIT_LABEL}
                          </span>
                        </div>
                      ))}
                      {categoryScope === "sub_meters" ? (
                        <div className="mt-1 border-t border-shell-600 pt-1 font-semibold text-white">
                          Total: {stackedTotal.toFixed(2)} {HOUR_UNIT_LABEL}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: "#cbd5e1" }} />
            {categoryScope === "incoming" ? (
              <Area
                type="monotone"
                dataKey="total"
                name={scopeLabel}
                stroke="#5B8BCF"
                fill="#5B8BCF"
                fillOpacity={0.35}
                strokeWidth={1.2}
              />
            ) : (
              SUB_METER_TAG_SERIES.map((series) => (
                <Area
                  key={series.key}
                  type="monotone"
                  dataKey={series.key}
                  name={series.label}
                  stackId="sub_meters"
                  stroke={series.color}
                  fill={series.color}
                  fillOpacity={0.4}
                  strokeWidth={1.1}
                />
              ))
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 grid gap-2 text-[11px] text-slate-300 md:grid-cols-3">
        <div className="rounded border border-shell-700 bg-shell-900 px-2 py-1">
          Profile: {profileType === "weekday" ? "Weekday" : profileType === "weekend" ? "Weekend" : "Holiday"} ·{" "}
          {profileSampleLabel}
        </div>
        <div className="rounded border border-shell-700 bg-shell-900 px-2 py-1">Scope: {scopeLabel}</div>
        <div className="rounded border border-shell-700 bg-shell-900 px-2 py-1">
          Est. daily: {profileDailyKwh} kWh · Peak {peakHour.hour}: {peakHour.total.toFixed(1)} {HOUR_UNIT_LABEL}
        </div>
      </div>
      <p className="mt-2 text-[11px] text-slate-500">
        Weekday is {weekdayVsHolidayPct.toFixed(1)}% above holiday baseline. Day groups are mutually exclusive
        (weekday, weekend, holiday).
        {profileMeta.holidayDays.length > 0
          ? ` Holidays: ${profileMeta.holidayDays.map((item) => item.shortLabel).join(", ")}.`
          : null}
      </p>

      <EliteLevelUsageHeatmapSection data={data} />
    </div>
  );
}
