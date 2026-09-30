import { Fragment, useMemo, useState } from "react";
import { RequirementGuideTitle } from "@/components/analysis/RequirementGuide";
import { ELITE_USAGE_CATEGORIES, type EliteUsageCategory } from "@/components/analysis/eliteiot/eliteiotCategoryConfig";
import { NapDeviceHourlyProfile, NapEnergyAnalysisData } from "@/mock/napEnergyAnalysisData";

const HOUR_LABELS = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`);

type ProfileType = "weekday" | "weekend" | "holiday";

const PROFILE_OPTIONS: Array<{ key: ProfileType; label: string }> = [
  { key: "weekday", label: "Weekday" },
  { key: "weekend", label: "Weekend" },
  { key: "holiday", label: "Holiday" }
];

interface EliteLevelUsageHeatmapSectionProps {
  data: NapEnergyAnalysisData;
}

interface CategoryBreakdownRow {
  category: EliteUsageCategory;
  label: string;
  totalKwh: number;
  sharePct: number;
  dailyAvgKwh: number;
  deviceCount: number;
  peakHour: string;
  peakKwhPerHour: number;
}

interface DeviceDetailRow {
  device: string;
  shortName: string;
  category: string;
  dailyAvgKwh: number;
  peakHour: string;
  peakKwhPerHour: number;
}

function sumHourly(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}

function peakFromHourly(values: number[]): { hour: string; value: number } {
  let bestHour = 0;
  let bestValue = 0;
  values.forEach((value, hour) => {
    if (value > bestValue) {
      bestValue = value;
      bestHour = hour;
    }
  });
  return { hour: HOUR_LABELS[bestHour], value: bestValue };
}

function aggregateLevelHourly(profiles: NapDeviceHourlyProfile[]): number[] {
  const totals = Array.from({ length: 24 }, () => 0);
  profiles.forEach((profile) => {
    profile.hourlyKwh.forEach((value, hour) => {
      totals[hour] += value;
    });
  });
  return totals;
}

function shortenDeviceName(device: string): string {
  const stripped = device.replace(/^Lvl \d+ /, "");
  const loadMatch = stripped.match(/Office Load (\d+)/);
  if (loadMatch) {
    return `Load ${loadMatch[1]}`;
  }
  if (stripped.includes("Light-Left")) {
    return "Light L-Ext";
  }
  if (stripped.includes("Light-Right")) {
    return "Light R-Int";
  }
  if (stripped.includes("Back Row Office Light")) {
    return "Light Back";
  }
  if (stripped.includes("Front Row Office Light")) {
    return "Light Front";
  }
  if (stripped.includes("Middle Row Office Light")) {
    return "Light Mid";
  }
  if (stripped.includes("Fan")) {
    return "Fan Isol";
  }
  if (stripped.length > 16) {
    return `${stripped.slice(0, 14)}…`;
  }
  return stripped;
}

function usageHeatColor(value: number, min: number, max: number): string {
  if (max <= min) {
    return "rgba(71, 85, 105, 0.45)";
  }
  const ratio = (value - min) / (max - min);
  const start = { r: 30, g: 41, b: 59 };
  const mid = { r: 245, g: 158, b: 11 };
  const end = { r: 239, g: 68, b: 68 };
  const blend = ratio < 0.55 ? start : mid;
  const target = ratio < 0.55 ? mid : end;
  const localRatio = ratio < 0.55 ? ratio / 0.55 : (ratio - 0.55) / 0.45;
  const r = Math.round(blend.r + (target.r - blend.r) * localRatio);
  const g = Math.round(blend.g + (target.g - blend.g) * localRatio);
  const b = Math.round(blend.b + (target.b - blend.b) * localRatio);
  const alpha = 0.45 + ratio * 0.5;
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
}

function formatPeakHourCell(peakHour: string, peakKwhPerHour: number): string {
  return `${peakHour} (${peakKwhPerHour.toFixed(2)} kWh/h)`;
}

function aggregateCategoryHourly(profiles: NapDeviceHourlyProfile[]): number[] {
  return aggregateLevelHourly(profiles);
}

function profileCategory(profile: NapDeviceHourlyProfile): EliteUsageCategory {
  return profile.category as EliteUsageCategory;
}

function collectHourlyValues(profiles: NapDeviceHourlyProfile[]): number[] {
  return profiles.flatMap((profile) => profile.hourlyKwh);
}

function computeHeatmapBounds(values: number[]): { min: number; max: number } {
  if (values.length === 0) {
    return { min: 0, max: 0 };
  }
  return {
    min: Math.min(...values),
    max: Math.max(...values)
  };
}

export function EliteLevelUsageHeatmapSection({ data }: EliteLevelUsageHeatmapSectionProps) {
  const [profileType, setProfileType] = useState<ProfileType>("weekday");
  const [selectedCategory, setSelectedCategory] = useState<EliteUsageCategory | null>(null);
  const [hoveredCell, setHoveredCell] = useState<{
    device: string;
    shortName: string;
    hour: string;
    value: number;
    x: number;
    y: number;
  } | null>(null);

  const levelUsage = data.levelUsageByDayType[profileType];
  const deviceHourlyProfiles = data.deviceHourlyProfilesByDayType[profileType] ?? [];

  const profileSampleLabel = useMemo(() => {
    const count = levelUsage.sampleCount;
    if (profileType === "weekday") {
      return `${count} weekday sample${count === 1 ? "" : "s"}`;
    }
    if (profileType === "weekend") {
      return `${count} weekend sample${count === 1 ? "" : "s"}`;
    }
    return `${count} public holiday sample${count === 1 ? "" : "s"}`;
  }, [levelUsage.sampleCount, profileType]);

  const categoryBreakdownRows = useMemo((): CategoryBreakdownRow[] => {
    const categoryTotals = ELITE_USAGE_CATEGORIES.map((category) => {
      const profiles = deviceHourlyProfiles.filter((profile) => profileCategory(profile) === category);
      const categoryTotal = profiles.reduce(
        (sum, profile) => sum + sumHourly(profile.hourlyKwh),
        0
      );
      return { category, profiles, categoryTotal };
    });
    const totalKwh = categoryTotals.reduce((sum, item) => sum + item.categoryTotal, 0);

    return categoryTotals.map(({ category, profiles, categoryTotal }) => {
      const aggregatedHourly = aggregateCategoryHourly(profiles);
      const peak = peakFromHourly(aggregatedHourly);
      return {
        category,
        label: category,
        totalKwh: categoryTotal,
        sharePct: totalKwh > 0 ? (categoryTotal / totalKwh) * 100 : 0,
        dailyAvgKwh:
          levelUsage.sampleCount > 0
            ? Math.round((categoryTotal / levelUsage.sampleCount) * 10) / 10
            : 0,
        deviceCount: profiles.length,
        peakHour: peak.hour,
        peakKwhPerHour: Math.round(peak.value * 100) / 100
      };
    });
  }, [deviceHourlyProfiles, levelUsage.sampleCount]);

  const selectedProfiles = useMemo(() => {
    if (selectedCategory == null) {
      return [];
    }
    return deviceHourlyProfiles.filter((profile) => profileCategory(profile) === selectedCategory);
  }, [deviceHourlyProfiles, selectedCategory]);

  const deviceDetailRows = useMemo((): DeviceDetailRow[] => {
    return selectedProfiles.map((profile) => {
      const peak = peakFromHourly(profile.hourlyKwh);
      return {
        device: profile.device,
        shortName: shortenDeviceName(profile.device),
        category: profile.category,
        dailyAvgKwh: Math.round(sumHourly(profile.hourlyKwh) * 100) / 100,
        peakHour: peak.hour,
        peakKwhPerHour: Math.round(peak.value * 100) / 100
      };
    });
  }, [selectedProfiles]);

  const heatmapColorBounds = useMemo(() => {
    if (selectedCategory == null) {
      return { min: 0, max: 0 };
    }
    const categoryProfiles = PROFILE_OPTIONS.flatMap(({ key }) =>
      (data.deviceHourlyProfilesByDayType[key] ?? []).filter(
        (profile) => profileCategory(profile) === selectedCategory
      )
    );
    return computeHeatmapBounds(collectHourlyValues(categoryProfiles));
  }, [data.deviceHourlyProfilesByDayType, selectedCategory]);

  const selectedCategoryLabel = selectedCategory;
  const showHeatmap = selectedCategory != null && selectedProfiles.length > 0;

  return (
    <section className="mt-4 rounded-md border border-shell-700 bg-black/10 p-3">
      <RequirementGuideTitle
        title="Daily Usage Pattern by Category"
        className="mb-2 text-xs font-semibold text-white"
        content={{
          title: "Daily Usage Pattern by Category",
          summary: "Usage-category summary and sub-meter hourly heatmap by day type (weekday / weekend / holiday).",
          dataAcquisition: [
            "Per sub-meter day: sum 15-minute deltas into clock-hour kWh/h buckets.",
            "Average hourly values within weekday, weekend, or holiday sample groups in the monitoring period.",
            "Category table: share of total, daily average (kWh/day), and peak clock hour with intensity."
          ],
          chartGeneration: [
            "Selectable category breakdown table; sub-meter detail list for the chosen category.",
            "Heatmap appears after category selection; one row per sub-meter, 24 clock hours.",
            "Colour scale (kWh/h) is fixed per category and shared across weekday, weekend, and holiday views."
          ]
        }}
      />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-slate-400">
          Average hourly usage · Unit kWh/h · {profileSampleLabel} · Select a category to view sub-meter heatmap
        </p>
        <div className="inline-flex rounded border border-shell-600 bg-shell-800 p-1">
          {PROFILE_OPTIONS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setProfileType(option.key)}
              className={`rounded px-2 py-1 text-[10px] ${
                profileType === option.key ? "bg-blue-600 text-white" : "text-slate-300 hover:text-white"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(360px,1fr)_minmax(420px,1.35fr)]">
        <div className="flex min-h-[400px] flex-col rounded-lg border border-shell-600">
          <div className="border-b border-shell-600 bg-shell-800 px-3 py-2 text-[11px] font-medium text-slate-300">
            Breakdown by Category
          </div>
          <div className="min-h-0 shrink-0 overflow-x-auto">
            <table className="w-full min-w-[380px] table-fixed text-[11px]">
              <colgroup>
                <col className="w-[12%]" />
                <col className="w-[20%]" />
                <col className="w-[20%]" />
                <col className="w-[32%]" />
                <col className="w-[16%]" />
              </colgroup>
              <thead className="bg-shell-700 text-slate-300">
                <tr>
                  <th className="whitespace-nowrap px-2 py-1.5 text-left">Category</th>
                  <th className="whitespace-nowrap px-2 py-1.5 text-center">Total (kWh)</th>
                  <th className="whitespace-nowrap px-2 py-1.5 text-center">Daily avg (kWh)</th>
                  <th className="whitespace-nowrap px-2 py-1.5 text-center">Peak hour</th>
                  <th className="whitespace-nowrap px-2 py-1.5 text-left">Share (%)</th>
                </tr>
              </thead>
              <tbody>
                {categoryBreakdownRows.map((row) => (
                  <tr
                    key={row.category}
                    className={`cursor-pointer border-t border-shell-600 ${
                      selectedCategory === row.category ? "bg-blue-500/10 text-blue-200" : "text-slate-200 hover:bg-shell-800"
                    }`}
                    onClick={() => setSelectedCategory(row.category)}
                  >
                    <td className="whitespace-nowrap px-2 py-1.5">{row.label}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-center">{row.totalKwh.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-center">{row.dailyAvgKwh.toFixed(1)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-center">
                      {formatPeakHourCell(row.peakHour, row.peakKwhPerHour)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5">{row.sharePct.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

            <div className="min-h-[240px] flex-1 border-t border-shell-600">
              <div className="border-b border-shell-700 bg-shell-900 px-3 py-1.5 text-[10px] text-slate-400">
                {selectedCategoryLabel
                  ? `${selectedCategoryLabel} sub-meters (${deviceDetailRows.length})`
                  : "Sub-meter details"}
              </div>
              <div>
                {selectedCategory == null ? (
                  <p className="px-3 py-4 text-[11px] text-slate-500">Select a category to view sub-meter details</p>
                ) : (
                  <table className="w-full text-[10px]">
                    <thead className="bg-shell-800 text-slate-400">
                      <tr>
                        <th className="px-2 py-1.5 text-left">Device</th>
                        <th className="px-2 py-1.5 text-left">Tag</th>
                        <th className="whitespace-nowrap px-2 py-1.5 text-left">Daily avg (kWh)</th>
                        <th className="whitespace-nowrap px-2 py-1.5 text-left">Peak hour</th>
                      </tr>
                    </thead>
                    <tbody>
                      {deviceDetailRows.map((row) => (
                        <tr key={row.device} className="border-t border-shell-700 text-slate-300">
                          <td className="px-2 py-1.5" title={row.device}>
                            {row.shortName}
                          </td>
                          <td className="px-2 py-1.5">{row.category}</td>
                          <td className="whitespace-nowrap px-2 py-1.5">{row.dailyAvgKwh.toFixed(1)}</td>
                          <td className="whitespace-nowrap px-2 py-1.5">
                            {formatPeakHourCell(row.peakHour, row.peakKwhPerHour)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
        </div>

        <div className="relative flex min-h-[400px] flex-col rounded-lg border border-shell-600 bg-shell-900 p-2.5">
          <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
            <p className="text-[11px] font-medium text-slate-300">Usage Heatmap</p>
            {selectedCategoryLabel ? (
              <p className="text-[10px] text-slate-500">
                Selected: <span className="text-slate-300">{selectedCategoryLabel}</span>
              </p>
            ) : null}
          </div>

          <div className="flex min-h-0 flex-1 flex-col justify-center pt-3">
            {!showHeatmap ? (
              <div className="flex items-center justify-center rounded-md border border-dashed border-shell-600 px-4 py-16 text-xs text-slate-500">
                Select a category from the left table to display heatmap
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <div className="overflow-hidden rounded-md border border-shell-700 bg-black/20 p-1.5">
                  <div
                    className="grid w-full gap-px"
                    style={{ gridTemplateColumns: "minmax(52px, 16%) repeat(24, minmax(0, 1fr))" }}
                  >
                    <div className="truncate bg-black/20 text-[9px] text-slate-500">Device</div>
                    {HOUR_LABELS.map((hour) => (
                      <div key={hour} className="text-center text-[8px] leading-none text-slate-500">
                        {Number(hour.slice(0, 2)) % 2 === 0 ? hour.slice(0, 2) : ""}
                      </div>
                    ))}

                    {selectedProfiles.map((profile) => {
                      const shortName = shortenDeviceName(profile.device);
                      return (
                        <Fragment key={profile.device}>
                          <div
                            className="truncate bg-black/20 pr-0.5 text-[9px] text-slate-300"
                            title={profile.device}
                          >
                            {shortName}
                          </div>
                          {profile.hourlyKwh.map((value, hourIndex) => (
                            <button
                              key={`${profile.device}-${hourIndex}`}
                              type="button"
                              className="h-6 w-full min-w-0 rounded-sm border border-shell-800/80 transition hover:brightness-110"
                              style={{
                                backgroundColor: usageHeatColor(
                                  value,
                                  heatmapColorBounds.min,
                                  heatmapColorBounds.max
                                )
                              }}
                              onMouseMove={(event) =>
                                setHoveredCell({
                                  device: profile.device,
                                  shortName,
                                  hour: HOUR_LABELS[hourIndex],
                                  value,
                                  x: event.clientX,
                                  y: event.clientY
                                })
                              }
                              onMouseLeave={() => setHoveredCell(null)}
                            />
                          ))}
                        </Fragment>
                      );
                    })}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-500">
                  <span>Low</span>
                  <div className="h-2 w-28 rounded-full bg-gradient-to-r from-slate-700 via-amber-500 to-red-500" />
                  <span>High</span>
                  <span className="text-slate-400">
                    Fixed scale {heatmapColorBounds.min.toFixed(2)}–{heatmapColorBounds.max.toFixed(2)} kWh/h
                    (Weekday / Weekend / Holiday)
                  </span>
                </div>
              </div>
            )}
          </div>

          {hoveredCell ? (
            <div
              className="pointer-events-none fixed z-[90] min-w-[180px] rounded-md border border-shell-600 bg-black/90 px-3 py-2 text-[11px] text-slate-100 shadow-soft"
              style={{ left: hoveredCell.x + 12, top: hoveredCell.y + 12 }}
            >
              <p className="font-semibold text-white">{hoveredCell.shortName}</p>
              <p className="mt-1 text-slate-400">{hoveredCell.device}</p>
              <p className="mt-1 text-slate-300">Hour: {hoveredCell.hour}</p>
              <p className="text-slate-300">Avg usage: {hoveredCell.value.toFixed(2)} kWh/h</p>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
