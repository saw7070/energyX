import { useEffect, useMemo, useRef, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Sector, Tooltip, XAxis, YAxis } from "recharts";
import { SpaceNode } from "@/components/analysis/spaceHierarchy";
import { AnalysisTimeRange } from "@/mock/types";
import { RequirementGuideTitle } from "@/components/analysis/RequirementGuide";

type ProfileType = "weekday" | "weekend" | "holiday";
type DistributionRange = "today" | "yesterday" | "last7" | "last30";
interface ProfileBasePoint {
  hour: string;
  baseline: number;
  actual: number;
}

interface TagDistributionPoint {
  tag: string;
  value: number;
}

interface OverallEnergyConsumptionSectionProps {
  behaviour24h: ProfileBasePoint[];
  applianceDistribution: TagDistributionPoint[];
  spaceRoot: SpaceNode;
  timeRange: AnalysisTimeRange;
  unitLabel: string;
}

const TAG_COLORS = ["#5B8BCF", "#4F9B86", "#9A8DBF", "#C68656", "#B35A73", "#5A9EAD"];
const DISTRIBUTION_RANGE_OPTIONS: Array<{ key: DistributionRange; label: string }> = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "last7", label: "Last 7 Days" },
  { key: "last30", label: "Last 1 Month" }
];

function getDayCountByRange(timeRange: AnalysisTimeRange, referenceDate: Date) {
  if (timeRange === "Today") {
    return 1;
  }
  if (timeRange === "Last 7 Days") {
    return 7;
  }
  if (timeRange === "MTD") {
    return 30;
  }
  if (timeRange === "Last Month") {
    return new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 0).getDate();
  }
  if (timeRange === "YTD") {
    const yearStart = new Date(referenceDate.getFullYear(), 0, 1);
    const diffMs = referenceDate.getTime() - yearStart.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
  }
  return 14;
}

function hashCode(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function getTagPatternFactor(tag: string, hour: number, profile: ProfileType) {
  const isEvening = hour >= 18 && hour <= 23;
  const isDaytime = hour >= 8 && hour <= 17;
  const isMealHour = [7, 12, 13, 19, 20].includes(hour);
  const normalizedTag = tag.toLowerCase();

  if (normalizedTag.includes("air conditioning")) {
    return isEvening ? 1.24 : isDaytime ? 1.08 : 0.82;
  }
  if (normalizedTag.includes("lighting")) {
    return isEvening ? 1.22 : isDaytime ? 0.92 : 0.72;
  }
  if (normalizedTag.includes("plug")) {
    return isDaytime || isEvening ? 1.12 : 0.78;
  }
  if (normalizedTag.includes("kitchen")) {
    return isMealHour ? 1.36 : 0.74;
  }
  if (normalizedTag.includes("heater") || normalizedTag.includes("heating")) {
    return hour <= 8 || hour >= 21 ? 1.22 : 0.8;
  }

  if (profile === "holiday") {
    return 0.74;
  }
  return 1;
}

function buildColumns(root: SpaceNode, hoverPath: string[], selectedPath: string[]) {
  const columns: SpaceNode[][] = [];
  const activePath = hoverPath.length > 0 ? hoverPath : selectedPath;
  let children = root.children ?? [];
  let depth = 0;

  if (children.length > 0) {
    columns.push(children);
  }

  while (children.length > 0 && depth < activePath.length) {
    const node = children.find((item) => item.name === activePath[depth]);
    children = node?.children ?? [];
    if (children.length > 0) {
      columns.push(children);
    }
    depth += 1;
  }

  return columns;
}

function getNodeByPath(root: SpaceNode, path: string[]) {
  let current: SpaceNode | null = root;
  for (let index = 0; index < path.length; index += 1) {
    current = current?.children?.find((item) => item.name === path[index]) ?? null;
    if (!current) {
      return null;
    }
  }
  return current;
}

function countLeafRooms(node: SpaceNode): number {
  if (!node.children || node.children.length === 0) {
    return 1;
  }
  return node.children.reduce((sum, child) => sum + countLeafRooms(child), 0);
}

export function OverallEnergyConsumptionSection({
  behaviour24h,
  applianceDistribution,
  spaceRoot,
  timeRange,
  unitLabel
}: OverallEnergyConsumptionSectionProps) {
  const [profileType, setProfileType] = useState<ProfileType>("weekday");
  const [distributionRange, setDistributionRange] = useState<DistributionRange>("today");
  const [selectedDistributionTag, setSelectedDistributionTag] = useState<string | null>(null);
  const [selectedSpacePath, setSelectedSpacePath] = useState<string[]>([]);
  const [hoverSpacePath, setHoverSpacePath] = useState<string[]>([]);
  const [spacePanelOpen, setSpacePanelOpen] = useState(false);
  const [distributionSpacePanelOpen, setDistributionSpacePanelOpen] = useState(false);
  const spacePanelRef = useRef<HTMLDivElement | null>(null);
  const distributionSpacePanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      const target = event.target as Node;
      if (spacePanelRef.current && !spacePanelRef.current.contains(target)) {
        setSpacePanelOpen(false);
      }
      if (distributionSpacePanelRef.current && !distributionSpacePanelRef.current.contains(target)) {
        setDistributionSpacePanelOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const scopeSeed = selectedSpacePath.length > 0 ? selectedSpacePath.join("/") : "all-spaces";
  const scopeDepth = selectedSpacePath.length;
  const scopeTypeLabel = scopeDepth >= 3 ? "Room" : scopeDepth === 2 ? "Level" : scopeDepth === 1 ? "Block" : "All Spaces";
  const scopeLabel = scopeDepth > 0 ? selectedSpacePath.join(" / ") : "All spaces";
  const scopeFactor = useMemo(() => {
    const seed = hashCode(scopeSeed);
    const base = scopeDepth >= 3 ? 0.66 : scopeDepth === 2 ? 0.82 : scopeDepth === 1 ? 0.94 : 1;
    return base + (seed % 28) / 100;
  }, [scopeDepth, scopeSeed]);

  const tagMeta = useMemo(
    () =>
      applianceDistribution.map((item, index) => ({
        key: `tag_${index}`,
        label: item.tag,
        value: item.value,
        color: TAG_COLORS[index % TAG_COLORS.length]
      })),
    [applianceDistribution]
  );

  const hourlyProfile = useMemo(() => {
    const byHour = new Map<number, ProfileBasePoint>();
    behaviour24h.forEach((point) => {
      const hour = Number.parseInt(point.hour, 10);
      if (!Number.isNaN(hour)) {
        byHour.set(hour, point);
      }
    });

    const existingHours = Array.from(byHour.keys()).sort((a, b) => a - b);
    if (existingHours.length === 0) {
      return Array.from({ length: 24 }, (_, hour) => ({
        hour: String(hour).padStart(2, "0"),
        baseline: 0,
        actual: 0
      }));
    }

    function valueForHour(targetHour: number, key: "baseline" | "actual") {
      const direct = byHour.get(targetHour);
      if (direct) {
        return direct[key];
      }
      const prevHourCandidates = existingHours.filter((hour) => hour < targetHour);
      const nextHourCandidates = existingHours.filter((hour) => hour > targetHour);
      const prevHour = prevHourCandidates.length > 0 ? prevHourCandidates[prevHourCandidates.length - 1] : existingHours[existingHours.length - 1] - 24;
      const nextHour = nextHourCandidates.length > 0 ? nextHourCandidates[0] : existingHours[0] + 24;
      const prevPoint = byHour.get((prevHour + 24) % 24) ?? byHour.get(existingHours[0])!;
      const nextPoint = byHour.get(nextHour % 24) ?? byHour.get(existingHours[existingHours.length - 1])!;
      const ratio = (targetHour - prevHour) / (nextHour - prevHour || 1);
      return prevPoint[key] + (nextPoint[key] - prevPoint[key]) * ratio;
    }

    return Array.from({ length: 24 }, (_, hour) => ({
      hour: String(hour).padStart(2, "0"),
      baseline: valueForHour(hour, "baseline"),
      actual: valueForHour(hour, "actual")
    }));
  }, [behaviour24h]);

  const spaceColumns = useMemo(
    () => buildColumns(spaceRoot, hoverSpacePath, selectedSpacePath),
    [hoverSpacePath, selectedSpacePath, spaceRoot]
  );
  const panelWidth = useMemo(() => {
    const width = spaceColumns.length * 168 + 24;
    return Math.min(Math.max(width, 190), 760);
  }, [spaceColumns.length]);
  function openSpacePanel() {
    setHoverSpacePath(selectedSpacePath);
    setSpacePanelOpen(true);
  }

  function openDistributionSpacePanel() {
    setHoverSpacePath(selectedSpacePath);
    setDistributionSpacePanelOpen(true);
  }

  function handleHoverNode(depth: number, nodeName: string) {
    setHoverSpacePath((current) => {
      const base = current.length > 0 ? current : selectedSpacePath;
      const next = base.slice(0, depth);
      next[depth] = nodeName;
      return next;
    });
  }

  function handleSelectNode(depth: number, nodeName: string) {
    const base = hoverSpacePath.length > 0 ? hoverSpacePath : selectedSpacePath;
    const next = base.slice(0, depth);
    next[depth] = nodeName;
    setSelectedSpacePath(next);
    setHoverSpacePath(next);
    setSpacePanelOpen(false);
    setDistributionSpacePanelOpen(false);
  }

  const periodProfiles = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayCount = getDayCountByRange(timeRange, today);
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - dayCount + 1);

    const holidayCount = Math.min(2, dayCount);
    const weekdayCandidateIndices = Array.from({ length: dayCount }, (_, index) => index).filter((index) => {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + index);
      const weekDay = date.getDay();
      return weekDay !== 0 && weekDay !== 6;
    });
    const fallbackIndices = Array.from({ length: dayCount }, (_, index) => index);
    const holidayCandidates = (weekdayCandidateIndices.length > 0 ? weekdayCandidateIndices : fallbackIndices)
      .map((index) => ({
        index,
        weight: hashCode(`${scopeSeed}-${timeRange}-holiday-${index}`)
      }))
      .sort((a, b) => a.weight - b.weight)
      .slice(0, holidayCount)
      .map((item) => item.index);
    const holidaySet = new Set<number>(holidayCandidates);

    const byType: Record<ProfileType, number[][]> = { weekday: [], weekend: [], holiday: [] };

    for (let dayIndex = 0; dayIndex < dayCount; dayIndex += 1) {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + dayIndex);
      const dayOfWeek = date.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const dayType: ProfileType = holidaySet.has(dayIndex) ? "holiday" : isWeekend ? "weekend" : "weekday";

      const hourly = hourlyProfile.map((point, hourIndex) => {
        const hour = Number.parseInt(point.hour, 10);
        const daySeed = hashCode(`${scopeSeed}-${timeRange}-${dayIndex}-${hourIndex}`);
        if (dayType === "holiday") {
          const variance = 0.92 + (daySeed % 15) / 100;
          return Math.max(0, point.baseline * scopeFactor * variance);
        }
        if (dayType === "weekend") {
          const variance = 0.88 + (daySeed % 19) / 100;
          const weekendShape = hour >= 9 && hour <= 23 ? 0.92 : 0.82;
          return Math.max(0, point.actual * scopeFactor * weekendShape * variance);
        }
        const variance = 0.9 + (daySeed % 18) / 100;
        return Math.max(0, point.actual * scopeFactor * variance);
      });

      byType[dayType].push(hourly);
    }

    function averageHourly(samples: number[][], fallback: number[]) {
      if (samples.length === 0) {
        return fallback;
      }
      return Array.from({ length: fallback.length }, (_, hourIndex) => {
        const total = samples.reduce((sum, day) => sum + day[hourIndex], 0);
        return total / samples.length;
      });
    }

    const fallbackWeekday = hourlyProfile.map((point) => point.actual * scopeFactor);
    const fallbackWeekend = hourlyProfile.map((point) => point.actual * scopeFactor * 0.9);
    const fallbackHoliday = hourlyProfile.map((point) => point.baseline * scopeFactor);

    const weekdayAvgHourly = averageHourly(byType.weekday, fallbackWeekday);
    const weekendAvgHourly = averageHourly(byType.weekend, fallbackWeekend);
    const holidayAvgHourly = averageHourly(byType.holiday, fallbackHoliday);

    const holidayLabels = holidayCandidates.map((index) => {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + index);
      return `${date.getMonth() + 1}/${date.getDate()}`;
    });

    return {
      averageHourly: {
        weekday: weekdayAvgHourly,
        weekend: weekendAvgHourly,
        holiday: holidayAvgHourly
      },
      counts: {
        weekday: byType.weekday.length,
        weekend: byType.weekend.length,
        holiday: byType.holiday.length
      },
      holidayLabels
    };
  }, [hourlyProfile, scopeFactor, scopeSeed, timeRange]);

  const chartData = useMemo(() => {
    const totalTagValue = tagMeta.reduce((sum, item) => sum + item.value, 0);
    const selectedProfileHourly = periodProfiles.averageHourly[profileType];

    return hourlyProfile.map((point, hourIndex) => {
      const hourNumber = Number.parseInt(point.hour, 10);
      const baseTotal = selectedProfileHourly[hourIndex] ?? 0;
      const record: Record<string, number | string> = {
        hour: `${point.hour}:00`,
        total: 0
      };

      tagMeta.forEach((tag) => {
        const share = totalTagValue > 0 ? tag.value / totalTagValue : 0;
        const patternFactor = getTagPatternFactor(tag.label, hourNumber, profileType);
        const variance = 0.93 + (hashCode(`${scopeSeed}-${profileType}-${tag.label}-${point.hour}`) % 14) / 100;
        const value = Math.max(0, baseTotal * share * patternFactor * variance);
        record[tag.key] = value;
        record.total = Number(record.total) + value;
      });

      return record;
    });
  }, [hourlyProfile, periodProfiles.averageHourly, profileType, scopeSeed, tagMeta]);

  const displayChartData = useMemo(() => {
    if (chartData.length === 0) {
      return chartData;
    }
    const first = chartData[0];
    const extraPoint = { ...first, hour: "24:00" };
    return [...chartData, extraPoint];
  }, [chartData]);

  const dailyTotal = useMemo(() => chartData.reduce((sum, row) => sum + Number(row.total), 0), [chartData]);
  const profileKpis = useMemo(
    () => ({
      weekday: periodProfiles.averageHourly.weekday.reduce((sum, value) => sum + value, 0),
      weekend: periodProfiles.averageHourly.weekend.reduce((sum, value) => sum + value, 0),
      holiday: periodProfiles.averageHourly.holiday.reduce((sum, value) => sum + value, 0)
    }),
    [periodProfiles.averageHourly]
  );

  const weekdayVsHolidayPct = profileKpis.holiday > 0 ? ((profileKpis.weekday - profileKpis.holiday) / profileKpis.holiday) * 100 : 0;
  const weekendVsWeekdayPct = profileKpis.weekday > 0 ? ((profileKpis.weekend - profileKpis.weekday) / profileKpis.weekday) * 100 : 0;
  const peakHour = useMemo(() => {
    const best = chartData.reduce(
      (current, row) => (Number(row.total) > current.total ? { hour: String(row.hour), total: Number(row.total) } : current),
      { hour: "00:00", total: 0 }
    );
    return best;
  }, [chartData]);
  const energyDistributionData = useMemo(() => {
    const rangeDays = distributionRange === "today" ? 1 : distributionRange === "yesterday" ? 1 : distributionRange === "last7" ? 7 : 30;
    const rangeFactor = distributionRange === "today" ? 1 : distributionRange === "yesterday" ? 0.96 : distributionRange === "last7" ? 0.92 : 0.9;
    const selectedDaily = profileKpis[profileType];
    const baseTotal = Math.max(1, selectedDaily * rangeDays * rangeFactor);
    const totalTagWeight = tagMeta.reduce((sum, item) => sum + item.value, 0);

    const rows = tagMeta.map((tag) => {
      const share = totalTagWeight > 0 ? tag.value / totalTagWeight : 0;
      const variability = 0.92 + (hashCode(`${scopeSeed}-${distributionRange}-${tag.label}`) % 14) / 100;
      const value = Math.max(0, baseTotal * share * variability);
      return {
        tag: tag.label,
        value,
        color: tag.color
      };
    });

    const total = rows.reduce((sum, item) => sum + item.value, 0);
    return rows.map((item) => ({
      ...item,
      percentage: total > 0 ? (item.value / total) * 100 : 0
    }));
  }, [distributionRange, profileKpis, profileType, scopeSeed, tagMeta]);
  const energyDistributionTotal = useMemo(
    () => energyDistributionData.reduce((sum, item) => sum + item.value, 0),
    [energyDistributionData]
  );
  const selectedDistributionIndex = useMemo(
    () => energyDistributionData.findIndex((item) => item.tag === selectedDistributionTag),
    [energyDistributionData, selectedDistributionTag]
  );
  const distributionChildRankData = useMemo(() => {
    if (!selectedDistributionTag) {
      return [];
    }
    const targetTag = energyDistributionData.find((item) => item.tag === selectedDistributionTag);
    if (!targetTag) {
      return [];
    }
    const currentNode = selectedSpacePath.length > 0 ? getNodeByPath(spaceRoot, selectedSpacePath) : spaceRoot;
    if (!currentNode) {
      return [];
    }
    const children = currentNode.children && currentNode.children.length > 0 ? currentNode.children : [currentNode];
    const hotspotIndex = children.length > 0 ? hashCode(`${scopeSeed}-${selectedDistributionTag}-hot`) % children.length : 0;
    const lowSpotIndex = children.length > 0 ? hashCode(`${scopeSeed}-${selectedDistributionTag}-low`) % children.length : 0;

    const tagPatternFactor = (tag: string, seed: number) => {
      const normalized = tag.toLowerCase();
      if (normalized.includes("air")) {
        return 1.08 + ((seed >> 2) % 36) / 100;
      }
      if (normalized.includes("plug")) {
        return 0.94 + ((seed >> 3) % 30) / 100;
      }
      if (normalized.includes("light")) {
        return 0.78 + ((seed >> 4) % 26) / 100;
      }
      if (normalized.includes("heat")) {
        return 0.82 + ((seed >> 5) % 28) / 100;
      }
      if (normalized.includes("kitchen")) {
        return 0.88 + ((seed >> 6) % 34) / 100;
      }
      return 0.9 + ((seed >> 7) % 30) / 100;
    };

    const rangeFactor = distributionRange === "today" ? 0.98 : distributionRange === "yesterday" ? 0.96 : distributionRange === "last7" ? 1 : 1.04;
    const weighted = children.map((child, index) => {
      const leafCount = Math.max(1, countLeafRooms(child));
      const seed = hashCode(`${scopeSeed}-${selectedDistributionTag}-${child.name}-${index}`);
      const occupancyProxy = 0.7 + (seed % 95) / 100;
      const behaviourFactor = 0.62 + ((seed >> 2) % 92) / 100;
      const microNoise = 0.93 + ((seed >> 4) % 16) / 100;
      const hotspotFactor = index === hotspotIndex ? 1.28 : index === lowSpotIndex ? 0.72 : 1;
      const leafScaled = Math.pow(leafCount, 0.9);
      const tagFactor = tagPatternFactor(selectedDistributionTag, seed);
      return {
        name: child.name,
        weight: Math.max(0.001, leafScaled * occupancyProxy * behaviourFactor * microNoise * hotspotFactor * tagFactor * rangeFactor)
      };
    });
    const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
    return weighted
      .map((item) => ({
        name: item.name,
        usage: totalWeight > 0 ? (targetTag.value * item.weight) / totalWeight : 0
      }))
      .sort((a, b) => b.usage - a.usage)
      .slice(0, 12);
  }, [distributionRange, energyDistributionData, scopeSeed, selectedDistributionTag, selectedSpacePath, spaceRoot]);

  return (
    <div className="panel p-4">
      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-emerald-700/40 bg-shell-900 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Weekday Avg</p>
          <p className="mt-1 text-3xl font-semibold text-slate-100">
            {profileKpis.weekday.toFixed(3)}
            <span className="ml-1 text-xl">{unitLabel}/day</span>
          </p>
          <p className="mt-1 text-[10px] text-slate-500">
            {periodProfiles.counts.weekday} weekday sample{periodProfiles.counts.weekday === 1 ? "" : "s"} in {timeRange}
          </p>
        </div>
        <div className="rounded-lg border border-shell-600 bg-shell-900 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Weekend Avg</p>
          <p className="mt-1 text-3xl font-semibold text-slate-100">
            {profileKpis.weekend.toFixed(3)}
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
            {profileKpis.holiday.toFixed(2)}
            <span className="ml-1 text-xl">{unitLabel}/day</span>
          </p>
          <p className="mt-1 text-[10px] text-slate-500">
            {periodProfiles.counts.holiday} public holiday sample{periodProfiles.counts.holiday === 1 ? "" : "s"}:{" "}
            {periodProfiles.holidayLabels.join(", ")}
          </p>
        </div>
      </div>

      <RequirementGuideTitle
        title="24-Hour Stacked Profile Comparison"
        className="mb-1 text-xs font-semibold text-white"
        content={{
          title: "24-Hour Stacked Profile Comparison Requirements",
          summary: "Show weekday/weekend/holiday load behavior by tag across selected scope.",
          dataAcquisition: [
            "Use behaviour24h as baseline source and interpolate to full 24-hour profile.",
            "Derive profile-specific averages from day-type samples in selected time range.",
            "Apply scope factor from hierarchy path and deterministic variability per tag/hour."
          ],
          chartGeneration: [
            "Render stacked AreaChart by tag with one point per hour plus 24:00 closing point.",
            "Expose profile selector and hierarchical space selector.",
            "Display KPI cards and profile summary text tied to selected filters."
          ]
        }}
      />
      <p className="mb-3 text-[11px] text-slate-400">Express usage habits by profile period and selected space scope using tag-based wave patterns.</p>

      <div className="mb-3 grid gap-3 xl:grid-cols-2">
        <div className="rounded-md border border-shell-600 bg-shell-900 p-2">
          <p className="mb-2 text-[10px] text-slate-400">Usage Profile</p>
          <div className="inline-flex rounded border border-shell-600 bg-shell-800 p-1">
            {([
              { key: "weekday", label: "Weekday" },
              { key: "weekend", label: "Weekend" },
              { key: "holiday", label: "Holiday" }
            ] as Array<{ key: ProfileType; label: string }>).map((item) => (
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
          <div className="relative" ref={spacePanelRef}>
            <button
              type="button"
              onClick={() => (spacePanelOpen ? setSpacePanelOpen(false) : openSpacePanel())}
              className="w-full rounded border border-shell-600 bg-shell-800 px-3 py-1.5 text-left text-[11px] text-slate-200"
            >
              {scopeLabel}
            </button>
            {spacePanelOpen ? (
              <div
                className="absolute left-0 top-full z-50 mt-1 rounded-lg border border-shell-600 bg-shell-900 p-2 shadow-soft"
                style={{ width: `${panelWidth}px` }}
              >
                <button
                  type="button"
                  className="mb-2 w-full rounded-md border border-shell-600 bg-shell-800 px-2 py-1 text-left text-xs text-slate-200 hover:bg-shell-700"
                  onClick={() => {
                    setSelectedSpacePath([]);
                    setHoverSpacePath([]);
                    setSpacePanelOpen(false);
                  }}
                >
                  All spaces
                </button>
                <div className="flex items-start gap-2">
                  {spaceColumns.map((column, depth) => (
                    <div key={`col-${depth}`} className="max-h-64 w-40 shrink-0 overflow-y-auto rounded-md bg-shell-900 pr-1">
                      {column.map((node) => {
                        const hovered = hoverSpacePath[depth] === node.name;
                        const selected = selectedSpacePath[depth] === node.name;
                        return (
                          <button
                            key={`${depth}-${node.name}`}
                            type="button"
                            onMouseEnter={() => handleHoverNode(depth, node.name)}
                            onClick={() => handleSelectNode(depth, node.name)}
                            className={`mb-1 flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs ${
                              hovered || selected ? "bg-shell-700 text-white" : "text-slate-300 hover:bg-shell-800"
                            }`}
                          >
                            <span className="truncate whitespace-nowrap">{node.name}</span>
                            {node.children && node.children.length > 0 ? <span className="text-slate-500">›</span> : null}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="h-72 rounded-md border border-shell-700 bg-black/10 p-2">
        <p className="mb-1 text-[10px] text-slate-400">Unit: {unitLabel}</p>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={displayChartData} margin={{ top: 6, right: 22, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
            <XAxis
              dataKey="hour"
              stroke="#94a3b8"
              tick={{ fontSize: 10 }}
              interval={1}
              padding={{ left: 4, right: 10 }}
              tickMargin={6}
            />
            <YAxis stroke="#94a3b8" tick={{ fontSize: 10 }} />
            <Tooltip
              formatter={(value: number, name: string) => [`${value.toFixed(2)} ${unitLabel}`, name]}
              labelFormatter={(label) => `Time ${label}`}
              contentStyle={{ backgroundColor: "#020617", border: "1px solid #334155", borderRadius: 8 }}
              labelStyle={{ color: "#f8fafc", fontSize: 12, fontWeight: 600 }}
              itemStyle={{ color: "#e2e8f0", fontSize: 12 }}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: "#cbd5e1" }} />
            {tagMeta.map((tag) => (
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
        <div className="rounded border border-shell-700 bg-shell-900 px-2 py-1">Profile: {profileType === "weekday" ? "Weekday" : profileType === "weekend" ? "Weekend" : "Holiday"}</div>
        <div className="rounded border border-shell-700 bg-shell-900 px-2 py-1">
          Scope: {scopeTypeLabel} · {scopeLabel}
        </div>
        <div className="rounded border border-shell-700 bg-shell-900 px-2 py-1">
          Total: {dailyTotal.toFixed(1)} {unitLabel}/day | Peak: {peakHour.hour} ({peakHour.total.toFixed(1)} {unitLabel})
        </div>
      </div>
      <p className="mt-2 text-[11px] text-slate-500">
        Weekday is {weekdayVsHolidayPct.toFixed(1)}% above holiday baseline. Categories are mutually exclusive (weekday, weekend, holiday).
      </p>

      <section className="mt-4 rounded-md border border-shell-700 bg-black/10 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <RequirementGuideTitle
            title="Energy Distribution"
            className="text-xs font-semibold text-white"
            content={{
              title: "Energy Distribution Requirements",
              summary: "Provide tag distribution and drill-down rank by child spaces.",
              dataAcquisition: [
                "Build tag distribution from applianceDistribution shares and selected profile totals.",
                "Recalculate by selected date range and selected space scope.",
                "Generate child rank weights from leaf counts, tag behavior factors, and seeded noise."
              ],
              chartGeneration: [
                "Render donut chart with interactive selected segment state.",
                "Render tag legend list and switch to rank bar chart on selected tag.",
                "Use vertical BarChart for child rank and provide clear action to exit drill-down."
              ]
            }}
          />
        </div>

        <div className="mb-3 grid gap-2 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-md border border-shell-600 bg-shell-900 p-2">
            <p className="mb-2 text-[10px] text-slate-400">Space Filter</p>
            <div className="relative" ref={distributionSpacePanelRef}>
              <button
                type="button"
                onClick={() => (distributionSpacePanelOpen ? setDistributionSpacePanelOpen(false) : openDistributionSpacePanel())}
                className="w-full rounded border border-shell-600 bg-shell-800 px-3 py-1.5 text-left text-[11px] text-slate-200"
              >
                {scopeLabel}
              </button>
              {distributionSpacePanelOpen ? (
                <div
                  className="absolute left-0 top-full z-50 mt-1 rounded-lg border border-shell-600 bg-shell-900 p-2 shadow-soft"
                  style={{ width: `${panelWidth}px` }}
                >
                  <button
                    type="button"
                    className="mb-2 w-full rounded-md border border-shell-600 bg-shell-800 px-2 py-1 text-left text-xs text-slate-200 hover:bg-shell-700"
                    onClick={() => {
                      setSelectedSpacePath([]);
                      setHoverSpacePath([]);
                      setDistributionSpacePanelOpen(false);
                    }}
                  >
                    All spaces
                  </button>
                  <div className="flex items-start gap-2">
                    {spaceColumns.map((column, depth) => (
                      <div key={`dist-col-${depth}`} className="max-h-64 w-40 shrink-0 overflow-y-auto rounded-md bg-shell-900 pr-1">
                        {column.map((node) => {
                          const hovered = hoverSpacePath[depth] === node.name;
                          const selected = selectedSpacePath[depth] === node.name;
                          return (
                            <button
                              key={`dist-${depth}-${node.name}`}
                              type="button"
                              onMouseEnter={() => handleHoverNode(depth, node.name)}
                              onClick={() => handleSelectNode(depth, node.name)}
                              className={`mb-1 flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs ${
                                hovered || selected ? "bg-shell-700 text-white" : "text-slate-300 hover:bg-shell-800"
                              }`}
                            >
                              <span className="truncate whitespace-nowrap">{node.name}</span>
                              {node.children && node.children.length > 0 ? <span className="text-slate-500">›</span> : null}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-1.5 text-[11px]">
            {DISTRIBUTION_RANGE_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setDistributionRange(option.key)}
                className={`rounded border px-2.5 py-1 ${
                  distributionRange === option.key
                    ? "border-shell-500 bg-shell-700 text-white"
                    : "border-shell-600 text-slate-400 hover:text-slate-200"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
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
                  activeShape={(props: any) => (
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
                  {item.value.toLocaleString(undefined, { maximumFractionDigits: 1 })} {unitLabel} ({item.percentage.toFixed(1)}%)
                </span>
              </button>
            ))}
          </div>

          <div className="rounded border border-shell-700 bg-shell-900 p-2">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[11px] font-medium text-slate-200">
                {selectedDistributionTag
                  ? `${selectedDistributionTag} Rank by ${selectedSpacePath.length >= 2 ? "Room" : selectedSpacePath.length === 1 ? "Level" : "Block"}`
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
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={distributionChildRankData} layout="vertical" margin={{ top: 4, right: 6, left: 8, bottom: 4 }}>
                    <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                    <XAxis type="number" stroke="#94a3b8" tick={{ fontSize: 10 }} />
                    <YAxis dataKey="name" type="category" stroke="#94a3b8" tick={{ fontSize: 10 }} width={90} />
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
    </div>
  );
}
