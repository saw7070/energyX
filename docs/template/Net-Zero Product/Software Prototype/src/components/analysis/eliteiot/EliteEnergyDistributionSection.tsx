import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Sector,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { RequirementGuideTitle } from "@/components/analysis/RequirementGuide";
import {
  ELITE_CATEGORY_OPTIONS,
  ELITE_USAGE_CATEGORIES,
  type EliteCategoryScope,
  type EliteUsageCategory
} from "@/components/analysis/eliteiot/eliteiotCategoryConfig";
import { NapDistributionDayCalendar } from "@/components/analysis/nap/NapDistributionDayCalendar";
import { NapDeviceDailyReading, NapEnergyAnalysisData } from "@/mock/napEnergyAnalysisData";

type CategoryScope = EliteCategoryScope | "all_submeters";
type DistributionTimeMode = "period" | "day";

const CATEGORY_OPTIONS: Array<{ key: CategoryScope; label: string }> = [
  { key: "all_submeters", label: "All sub-meters" },
  ...ELITE_CATEGORY_OPTIONS.filter((option) => option.key !== "incoming")
];

const TAG_SERIES = ELITE_USAGE_CATEGORIES.map((category) => ({
  key: category,
  label: category,
  color:
    category === "F&B"
      ? "#C68656"
      : category === "Lighting"
        ? "#4F9B86"
        : category === "IT Devices"
          ? "#5B8BCF"
          : "#9A8DBF"
}));

interface EliteEnergyDistributionSectionProps {
  data: NapEnergyAnalysisData;
}

function filterReadingsByScope(
  readings: NapDeviceDailyReading[],
  scope: CategoryScope
): NapDeviceDailyReading[] {
  if (scope === "all_submeters") {
    return readings;
  }
  const categoryMap: Record<Exclude<EliteCategoryScope, "incoming">, EliteUsageCategory> = {
    fnb: "F&B",
    lighting: "Lighting",
    it_devices: "IT Devices",
    general_plug: "General Plug"
  };
  const category = categoryMap[scope];
  return readings.filter((row) => row.category === category);
}

function sumCategoryTotals(readings: NapDeviceDailyReading[]): Array<{ tag: string; value: number }> {
  return ELITE_USAGE_CATEGORIES.map((tag) => ({
    tag,
    value:
      Math.round(readings.filter((row) => row.category === tag).reduce((sum, row) => sum + row.kwh, 0) * 10) / 10
  }));
}

function buildDeviceRank(
  readings: NapDeviceDailyReading[],
  tag: EliteUsageCategory
): Array<{ name: string; usage: number }> {
  const byDevice = new Map<string, number>();
  readings
    .filter((row) => row.category === tag)
    .forEach((row) => {
      byDevice.set(row.device, (byDevice.get(row.device) ?? 0) + row.kwh);
    });

  return Array.from(byDevice.entries())
    .map(([name, usage]) => ({ name, usage: Math.round(usage * 10) / 10 }))
    .sort((a, b) => b.usage - a.usage);
}

export function EliteEnergyDistributionSection({ data }: EliteEnergyDistributionSectionProps) {
  const unitLabel = "kWh";
  const [distributionCategoryScope, setDistributionCategoryScope] = useState<CategoryScope>("all_submeters");
  const [distributionTimeMode, setDistributionTimeMode] = useState<DistributionTimeMode>("period");
  const [selectedDistributionDate, setSelectedDistributionDate] = useState<string>(data.meta.periodEnd);
  const [selectedDistributionTag, setSelectedDistributionTag] = useState<string | null>(null);

  const availableDistributionDates = useMemo(
    () => new Set(data.dailyTotals.map((row) => row.date)),
    [data.dailyTotals]
  );

  const distributionScopeLabel =
    CATEGORY_OPTIONS.find((item) => item.key === distributionCategoryScope)?.label ?? "All sub-meters";

  const activeDistributionReadings = useMemo(() => {
    const base =
      distributionTimeMode === "day"
        ? data.deviceDailyReadings.filter((row) => row.date === selectedDistributionDate)
        : data.deviceDailyReadings;
    return filterReadingsByScope(base, distributionCategoryScope);
  }, [data.deviceDailyReadings, distributionCategoryScope, distributionTimeMode, selectedDistributionDate]);

  const distributionTimeLabel = useMemo(() => {
    if (distributionTimeMode === "period") {
      return "Last 1 Month";
    }
    return data.dailyTotals.find((row) => row.date === selectedDistributionDate)?.shortLabel ?? selectedDistributionDate;
  }, [data.dailyTotals, distributionTimeMode, selectedDistributionDate]);

  const energyDistributionData = useMemo(() => {
    const categoryTotals = sumCategoryTotals(activeDistributionReadings);
    const rows = categoryTotals.map((item, index) => ({
      tag: item.tag,
      value: item.value,
      color: TAG_SERIES[index % TAG_SERIES.length].color
    }));
    const total = rows.reduce((sum, item) => sum + item.value, 0);
    return rows.map((item) => ({
      ...item,
      percentage: total > 0 ? (item.value / total) * 100 : 0
    }));
  }, [activeDistributionReadings]);

  const energyDistributionTotal = useMemo(
    () => energyDistributionData.reduce((sum, item) => sum + item.value, 0),
    [energyDistributionData]
  );

  const selectedDistributionIndex = useMemo(
    () => energyDistributionData.findIndex((item) => item.tag === selectedDistributionTag),
    [energyDistributionData, selectedDistributionTag]
  );

  const distributionRankData = useMemo(() => {
    if (!selectedDistributionTag) {
      return [];
    }
    return buildDeviceRank(activeDistributionReadings, selectedDistributionTag as EliteUsageCategory);
  }, [activeDistributionReadings, selectedDistributionTag]);

  const rankChartHeight = Math.max(240, distributionRankData.length * 26);

  return (
    <section className="panel mt-4 p-4">
      <RequirementGuideTitle
        title="Energy Distribution"
        className="mb-2 text-xs font-semibold text-white"
        content={{
          title: "Energy Distribution",
          summary: "Usage-category share and device drill-down for the selected category scope and date.",
          dataAcquisition: [
            "Tag distribution from sub-meter daily readings; scope = all sub-meters or a single usage category.",
            "Full period default, or a single calendar day from the monitoring window.",
            "Rank chart lists devices within the selected usage category."
          ],
          chartGeneration: [
            "Donut chart with selectable tag segment.",
            "Tag legend list; clicking a tag switches to a vertical rank bar chart.",
            "Clear exit action returns to the donut view."
          ]
        }}
      />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="w-full min-w-[160px] max-w-[220px] rounded-md border border-shell-600 bg-shell-900 p-2 sm:w-auto">
          <p className="mb-1.5 text-[10px] text-slate-400">Category Filter</p>
          <select
            className="w-full rounded border border-shell-600 bg-shell-800 px-2 py-1 text-[11px] text-slate-200"
            value={distributionCategoryScope}
            onChange={(event) => setDistributionCategoryScope(event.target.value as CategoryScope)}
          >
            {CATEGORY_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <NapDistributionDayCalendar
          periodStart={data.meta.periodStart}
          periodEnd={data.meta.periodEnd}
          availableDates={availableDistributionDates}
          selectedDate={selectedDistributionDate}
          mode={distributionTimeMode}
          onSelectPeriod={() => setDistributionTimeMode("period")}
          onSelectDate={(isoDate) => {
            setSelectedDistributionDate(isoDate);
            setDistributionTimeMode("day");
          }}
        />
      </div>

      <div className="grid w-full gap-3 md:grid-cols-[280px_300px_minmax(300px,1fr)] md:items-start">
        <div className="h-72 w-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={energyDistributionData}
                dataKey="value"
                nameKey="tag"
                innerRadius={64}
                outerRadius={112}
                paddingAngle={0}
                stroke="none"
                activeIndex={selectedDistributionIndex >= 0 ? selectedDistributionIndex : undefined}
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
                  const item = energyDistributionData[index];
                  setSelectedDistributionTag(item?.tag ?? null);
                }}
              >
                {energyDistributionData.map((item) => (
                  <Cell key={item.tag} fill={item.color} stroke="none" style={{ outline: "none" }} />
                ))}
              </Pie>
              <text x="50%" y="42%" textAnchor="middle" dominantBaseline="middle" fill="#94a3b8" fontSize="12">
                Total
              </text>
              <text x="50%" y="52%" textAnchor="middle" dominantBaseline="middle" fill="#f8fafc" fontSize="24" fontWeight={700}>
                {energyDistributionTotal.toLocaleString(undefined, { maximumFractionDigits: 1 })}
              </text>
              <text x="50%" y="60%" textAnchor="middle" dominantBaseline="middle" fill="#94a3b8" fontSize="11">
                {unitLabel}
              </text>
              <Tooltip
                formatter={(value: number, name: string) => [`${value.toFixed(1)} ${unitLabel}`, name]}
                contentStyle={{ backgroundColor: "#020617", border: "1px solid #334155", borderRadius: 8 }}
                labelStyle={{ color: "#f8fafc" }}
                itemStyle={{ color: "#e2e8f0" }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="w-[300px] space-y-1 md:justify-self-start">
          {energyDistributionData.map((item) => (
            <button
              key={`dist-${item.tag}`}
              type="button"
              className={`grid w-full grid-cols-[130px_auto] items-center gap-3 border-b px-2 py-2 text-left text-[12px] ${
                selectedDistributionTag === item.tag
                  ? "border-shell-600 bg-shell-900"
                  : "border-shell-800 hover:bg-shell-900"
              }`}
              onClick={() => setSelectedDistributionTag(item.tag)}
            >
              <div className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-md" style={{ backgroundColor: item.color }} />
                <span className="text-slate-200">{item.tag}</span>
              </div>
              <span className="text-left text-slate-100">
                {item.value.toLocaleString(undefined, { maximumFractionDigits: 1 })} {unitLabel} (
                {item.percentage.toFixed(1)}%)
              </span>
            </button>
          ))}
        </div>

        <div className="rounded border border-shell-700 bg-shell-900 p-2">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[11px] font-medium text-slate-200">
              {selectedDistributionTag
                ? `${selectedDistributionTag} rank · ${distributionScopeLabel} · ${distributionTimeLabel}`
                : "Select a tag to view rank"}
            </p>
            {selectedDistributionTag ? (
              <button
                type="button"
                className="rounded border border-shell-600 px-2 py-0.5 text-[10px] text-slate-300 hover:text-white"
                onClick={() => setSelectedDistributionTag(null)}
              >
                Clear
              </button>
            ) : null}
          </div>
          {selectedDistributionTag ? (
            <div style={{ height: rankChartHeight }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={distributionRankData} layout="vertical" margin={{ top: 4, right: 6, left: 8, bottom: 4 }}>
                  <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                  <XAxis type="number" stroke="#94a3b8" tick={{ fontSize: 10 }} />
                  <YAxis
                    dataKey="name"
                    type="category"
                    stroke="#94a3b8"
                    tick={{ fontSize: 10 }}
                    width={120}
                  />
                  <Tooltip
                    formatter={(value: number) => [`${value.toFixed(1)} ${unitLabel}`, selectedDistributionTag]}
                    contentStyle={{ backgroundColor: "#020617", border: "1px solid #334155", borderRadius: 8 }}
                    labelStyle={{ color: "#f8fafc" }}
                    itemStyle={{ color: "#e2e8f0" }}
                  />
                  <Bar
                    dataKey="usage"
                    fill={energyDistributionData.find((item) => item.tag === selectedDistributionTag)?.color ?? "#5B8BCF"}
                    radius={[0, 4, 4, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex h-60 items-center justify-center rounded border border-dashed border-shell-700 text-xs text-slate-500">
              Click donut segment or legend row
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
