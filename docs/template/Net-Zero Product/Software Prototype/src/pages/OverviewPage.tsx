import { useEffect, useMemo, useRef, useState } from "react";
import { BellRing, ChevronRight, CircleAlert, Droplets, Flame, Leaf, Router, Zap } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useAppContext } from "@/context/AppContext";
import { portfolioProjectRecords, type PortfolioProjectRecord } from "@/mock/portfolioProjects";

type PeriodRange = "Day" | "Week" | "Month" | "Year";
const periodRanges: PeriodRange[] = ["Day", "Week", "Month", "Year"];
type HeatmapUtility = "electricity" | "water" | "gas" | "carbon";

type HierarchyLevel = {
  name: string;
  rooms: string[];
};

type HierarchyBlock = {
  name: string;
  levels: HierarchyLevel[];
};

type LandProfile = {
  electricityPerRoomDay: number;
  waterPerRoomDay: number;
  gasPerRoomDay: number;
  euiBase: number;
  alarmRate: number;
};

const landProfiles: Record<PortfolioProjectRecord["type"], LandProfile> = {
  Commercial: { electricityPerRoomDay: 110, waterPerRoomDay: 1.3, gasPerRoomDay: 0.8, euiBase: 220, alarmRate: 0.018 },
  Industrial: { electricityPerRoomDay: 150, waterPerRoomDay: 1.8, gasPerRoomDay: 1.4, euiBase: 285, alarmRate: 0.024 },
  Residential: { electricityPerRoomDay: 95, waterPerRoomDay: 2.2, gasPerRoomDay: 1.6, euiBase: 180, alarmRate: 0.015 },
  Hospitality: { electricityPerRoomDay: 130, waterPerRoomDay: 2.9, gasPerRoomDay: 2.1, euiBase: 245, alarmRate: 0.02 },
  "Data Centre": { electricityPerRoomDay: 460, waterPerRoomDay: 0.2, gasPerRoomDay: 0.1, euiBase: 2900, alarmRate: 0.01 }
};

function round(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function hashCode(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function seeded(seed: number, offset = 0) {
  const value = Math.sin(seed * 12.9898 + offset * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function seededInt(seed: number, min: number, max: number, offset = 0) {
  const randomValue = seeded(seed, offset);
  return Math.floor(min + randomValue * (max - min + 1));
}

function buildProjectHierarchy(project: PortfolioProjectRecord): HierarchyBlock[] {
  const seed = hashCode(project.id);
  const baseByType: Record<PortfolioProjectRecord["type"], { blocks: [number, number]; levels: [number, number]; rooms: [number, number] }> = {
    Commercial: { blocks: [2, 4], levels: [4, 7], rooms: [8, 14] },
    Industrial: { blocks: [3, 5], levels: [3, 6], rooms: [6, 12] },
    Residential: { blocks: [4, 7], levels: [6, 9], rooms: [10, 18] },
    Hospitality: { blocks: [2, 4], levels: [5, 8], rooms: [8, 16] },
    "Data Centre": { blocks: [1, 2], levels: [3, 5], rooms: [5, 9] }
  };

  const config = baseByType[project.type];
  const blockCount = seededInt(seed, config.blocks[0], config.blocks[1], 1);
  const blockBase = 500 + seededInt(seed, 1, 6, 2) * 2;

  return Array.from({ length: blockCount }, (_, blockIndex) => {
    const levelCount = seededInt(seed, config.levels[0], config.levels[1], 10 + blockIndex);
    const blockNumber = blockBase + blockIndex * 2;
    const levels = Array.from({ length: levelCount }, (_, levelIndex) => {
      const roomCount = seededInt(seed, config.rooms[0], config.rooms[1], 30 + blockIndex * 10 + levelIndex);
      return {
        name: `Level ${String(levelIndex + 1).padStart(2, "0")}`,
        rooms: Array.from({ length: roomCount }, (_, roomIndex) => `Room ${String(roomIndex + 1).padStart(2, "0")}`)
      };
    });
    return {
      name: `Block ${blockNumber}`,
      levels
    };
  });
}

function countRoomsInHierarchy(hierarchy: HierarchyBlock[]) {
  return hierarchy.reduce((sum, block) => sum + block.levels.reduce((levelSum, level) => levelSum + level.rooms.length, 0), 0);
}

function countSelectedRooms(hierarchy: HierarchyBlock[], selectedBlock: string, selectedLevel: string, selectedRoom: string) {
  if (selectedRoom !== "all") {
    return 1;
  }

  let targetBlocks = hierarchy;
  if (selectedBlock !== "all") {
    targetBlocks = hierarchy.filter((block) => block.name === selectedBlock);
  }

  if (selectedLevel === "all") {
    return countRoomsInHierarchy(targetBlocks);
  }

  return targetBlocks.reduce(
    (sum, block) => sum + block.levels.filter((level) => level.name === selectedLevel).reduce((inner, level) => inner + level.rooms.length, 0),
    0
  );
}

function getPeriodDays(range: PeriodRange) {
  if (range === "Day") {
    return 1;
  }
  if (range === "Week") {
    return 7;
  }
  if (range === "Month") {
    return 30;
  }
  return 365;
}

export function OverviewPage() {
  const { selectedProjectId, setSelectedProjectId } = useAppContext();
  const [range, setRange] = useState<PeriodRange>("Month");
  const [heatmapUtility, setHeatmapUtility] = useState<HeatmapUtility>("electricity");
  const [selectedBlock, setSelectedBlock] = useState("all");
  const [selectedLevel, setSelectedLevel] = useState("all");
  const [selectedRoom, setSelectedRoom] = useState("all");
  const [spacePickerOpen, setSpacePickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const hasPortfolioProject = portfolioProjectRecords.some((project) => project.id === selectedProjectId);
    if (!hasPortfolioProject) {
      setSelectedProjectId(portfolioProjectRecords[0].id);
    }
  }, [selectedProjectId, setSelectedProjectId]);

  const selectedPortfolioProject = useMemo(
    () => portfolioProjectRecords.find((project) => project.id === selectedProjectId) ?? portfolioProjectRecords[0],
    [selectedProjectId]
  );
  const hierarchy = useMemo(() => buildProjectHierarchy(selectedPortfolioProject), [selectedPortfolioProject]);

  useEffect(() => {
    setSelectedBlock("all");
    setSelectedLevel("all");
    setSelectedRoom("all");
    setSpacePickerOpen(false);
  }, [selectedPortfolioProject.id]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) {
        setSpacePickerOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const blockOptions = useMemo(() => hierarchy.map((block) => block.name), [hierarchy]);
  const levelOptions = useMemo(() => {
    if (selectedBlock === "all") {
      return Array.from(new Set(hierarchy.flatMap((block) => block.levels.map((level) => level.name))));
    }
    const block = hierarchy.find((item) => item.name === selectedBlock);
    return block ? block.levels.map((level) => level.name) : [];
  }, [hierarchy, selectedBlock]);
  const roomOptions = useMemo(() => {
    if (selectedBlock === "all" && selectedLevel === "all") {
      return Array.from(new Set(hierarchy.flatMap((block) => block.levels.flatMap((level) => level.rooms))));
    }
    if (selectedBlock !== "all" && selectedLevel === "all") {
      const block = hierarchy.find((item) => item.name === selectedBlock);
      return block ? Array.from(new Set(block.levels.flatMap((level) => level.rooms))) : [];
    }
    if (selectedBlock === "all" && selectedLevel !== "all") {
      return Array.from(new Set(hierarchy.flatMap((block) => block.levels.filter((level) => level.name === selectedLevel).flatMap((level) => level.rooms))));
    }
    const block = hierarchy.find((item) => item.name === selectedBlock);
    const level = block?.levels.find((item) => item.name === selectedLevel);
    return level ? level.rooms : [];
  }, [hierarchy, selectedBlock, selectedLevel]);

  const totalRooms = useMemo(() => countRoomsInHierarchy(hierarchy), [hierarchy]);
  const selectedRooms = useMemo(() => Math.max(1, countSelectedRooms(hierarchy, selectedBlock, selectedLevel, selectedRoom)), [hierarchy, selectedBlock, selectedLevel, selectedRoom]);
  const scopeRatio = useMemo(() => (totalRooms > 0 ? selectedRooms / totalRooms : 1), [selectedRooms, totalRooms]);
  const days = getPeriodDays(range);
  const projectSeed = hashCode(selectedPortfolioProject.id);
  const profile = landProfiles[selectedPortfolioProject.type];
  const scaleByGfa = Math.max(0.85, selectedPortfolioProject.gfa / 10000);
  const periodJitter = 0.92 + seeded(projectSeed, days) * 0.16;

  const metrics = useMemo(() => {
    const electricity = profile.electricityPerRoomDay * totalRooms * days * scopeRatio * scaleByGfa * periodJitter;
    const water = profile.waterPerRoomDay * totalRooms * days * scopeRatio * (0.94 + seeded(projectSeed, 13) * 0.12);
    const gas = profile.gasPerRoomDay * totalRooms * days * scopeRatio * (0.9 + seeded(projectSeed, 23) * 0.2);
    const carbon = electricity * 0.00041 + gas * 0.0018;
    const efficiency = profile.euiBase * (0.9 + seeded(projectSeed, 41) * 0.18) * (0.8 + (1 - scopeRatio) * 0.28);
    return {
      electricity: Math.round(electricity),
      water: round(water, 1),
      gas: round(gas, 1),
      carbon: round(carbon, 2),
      efficiency: round(efficiency, 1)
    };
  }, [days, profile, projectSeed, scaleByGfa, scopeRatio, totalRooms, periodJitter]);

  const selectedSpaceLabel = selectedRoom !== "all" ? `${selectedBlock} / ${selectedLevel} / ${selectedRoom}` : selectedLevel !== "all" ? `${selectedBlock} / ${selectedLevel}` : selectedBlock !== "all" ? selectedBlock : "All spaces";

  const deviceStats = useMemo(() => {
    const total = Math.max(1, Math.round(selectedRooms * (1.45 + seeded(projectSeed, 55) * 0.5)));
    const warning = Math.round(total * (0.03 + seeded(projectSeed, 56) * 0.08));
    const offline = Math.round(total * (0.01 + seeded(projectSeed, 57) * 0.04));
    const normal = Math.max(total - warning, 0);
    const online = Math.max(total - offline, 0);
    const switchOn = Math.round(total * (0.42 + seeded(projectSeed, 58) * 0.18));
    const switchOff = Math.max(total - switchOn, 0);
    return {
      total,
      normal,
      online,
      offline,
      warning,
      switchOn,
      switchOff
    };
  }, [projectSeed, selectedRooms]);

  const alarmStats = useMemo(() => {
    const rangeFactor = range === "Day" ? 0.35 : range === "Week" ? 0.65 : range === "Month" ? 1 : 1.9;
    const alarmsTotal = Math.max(0, Math.round(deviceStats.total * profile.alarmRate * rangeFactor + seeded(projectSeed, 70) * 2));
    const resolved = Math.round(alarmsTotal * (0.35 + seeded(projectSeed, 71) * 0.3));
    const active = Math.max(alarmsTotal - resolved, 0);
    return {
      total: alarmsTotal,
      active,
      resolved
    };
  }, [deviceStats.total, profile.alarmRate, projectSeed, range]);

  const solvedRatio = alarmStats.total > 0 ? alarmStats.resolved / alarmStats.total : 0;
  const alarmFocusName = selectedRoom !== "all" ? `${selectedRoom} Sensor Gateway` : selectedLevel !== "all" ? `${selectedLevel} Multimode Gateway` : selectedBlock !== "all" ? `${selectedBlock} Multimode Gateway` : `${selectedPortfolioProject.name} Gateway`;

  const chartLabels = useMemo(() => {
    if (range === "Day") {
      return ["00", "02", "04", "06", "08", "10", "12", "14", "16", "18", "20", "22"];
    }
    if (range === "Week") {
      return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    }
    if (range === "Month") {
      return ["W1", "W2", "W3", "W4"];
    }
    return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  }, [range]);

  const electricitySeries = useMemo(
    () =>
      chartLabels.map((label, index) => ({
        label,
        value: round(metrics.electricity * (0.72 + seeded(projectSeed, index + 90) * 0.45) / Math.max(chartLabels.length / 3, 1), 0)
      })),
    [chartLabels, metrics.electricity, projectSeed]
  );
  const waterSeries = useMemo(
    () =>
      chartLabels.map((label, index) => ({
        label,
        value: round(metrics.water * (0.76 + seeded(projectSeed, index + 120) * 0.35) / Math.max(chartLabels.length / 2, 1), 2)
      })),
    [chartLabels, metrics.water, projectSeed]
  );
  const gasSeries = useMemo(
    () =>
      chartLabels.map((label, index) => ({
        label,
        value: round(metrics.gas * (0.68 + seeded(projectSeed, index + 140) * 0.5) / Math.max(chartLabels.length / 2, 1), 1)
      })),
    [chartLabels, metrics.gas, projectSeed]
  );
  const carbonSeries = useMemo(
    () =>
      chartLabels.map((label, index) => ({
        label,
        value: round(metrics.carbon * (0.78 + seeded(projectSeed, index + 170) * 0.3) / Math.max(chartLabels.length / 2, 1), 2)
      })),
    [chartLabels, metrics.carbon, projectSeed]
  );

  const heatmapRows = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const heatmapCols = Array.from({ length: 24 }, (_, hour) => hour);
  const utilityMeta: Record<HeatmapUtility, { label: string; unit: string; costRate: number }> = {
    electricity: { label: "Electricity", unit: "kWh", costRate: 0.29 },
    water: { label: "Water", unit: "m³", costRate: 2.8 },
    gas: { label: "Gas", unit: "m³", costRate: 1.2 },
    carbon: { label: "Carbon", unit: "t CO₂", costRate: 80 }
  };
  const utilityTotals: Record<HeatmapUtility, number> = {
    electricity: metrics.electricity,
    water: metrics.water,
    gas: metrics.gas,
    carbon: metrics.carbon
  };
  const heatmapCells = useMemo(() => {
    const totalForUtility = utilityTotals[heatmapUtility];
    const dailyBase = totalForUtility / Math.max(range === "Year" ? 365 : range === "Month" ? 30 : range === "Week" ? 7 : 1, 1);
    const hourBase = dailyBase / 24;
    const utilityPattern: Record<HeatmapUtility, { dayPeak: [number, number]; nightPeak?: [number, number]; baseLoad: number }> = {
      electricity: { dayPeak: [10, 18], nightPeak: [20, 22], baseLoad: 0.82 },
      water: { dayPeak: [7, 10], nightPeak: [18, 21], baseLoad: 0.75 },
      gas: { dayPeak: [6, 9], nightPeak: [18, 22], baseLoad: 0.68 },
      carbon: { dayPeak: [10, 18], nightPeak: [19, 22], baseLoad: 0.8 }
    };
    const profileBiasByType: Record<PortfolioProjectRecord["type"], number> = {
      Commercial: 1,
      Industrial: 1.1,
      Residential: 0.9,
      Hospitality: 1.05,
      "Data Centre": 1.25
    };
    const pattern = utilityPattern[heatmapUtility];
    const profileBias = profileBiasByType[selectedPortfolioProject.type];
    const scopeLoadFactor = 0.72 + scopeRatio * 0.38;

    return heatmapRows.map((_, rowIndex) =>
      heatmapCols.map((hour) => {
        const dayPeakFactor = hour >= pattern.dayPeak[0] && hour <= pattern.dayPeak[1] ? 1.35 : pattern.baseLoad;
        const nightPeakFactor = pattern.nightPeak && hour >= pattern.nightPeak[0] && hour <= pattern.nightPeak[1] ? 1.25 : 1;
        const peakFactor = dayPeakFactor * nightPeakFactor;
        const weekdayFactor = rowIndex >= 5 ? 0.72 : 1;
        const randomFactor = 0.9 + seeded(projectSeed, rowIndex * 100 + hour + 300) * 0.22;
        const anomalyTrigger = seeded(projectSeed, rowIndex * 100 + hour + 380);
        const anomalyBoost = anomalyTrigger > 0.992 ? 1.2 + anomalyTrigger * 0.2 : 1;
        const actual = hourBase * peakFactor * weekdayFactor * randomFactor * profileBias * scopeLoadFactor * anomalyBoost;
        const baseline = hourBase * peakFactor * weekdayFactor * (0.93 + seeded(projectSeed, rowIndex * 100 + hour + 330) * 0.14) * profileBias * scopeLoadFactor;
        const intensity = actual / Math.max(selectedRooms, 1);
        const deviation = baseline > 0 ? ((actual - baseline) / baseline) * 100 : 0;
        return {
          actual,
          baseline,
          intensity,
          deviation,
          display: actual
        };
      })
    );
  }, [heatmapRows, heatmapCols, heatmapUtility, projectSeed, range, scopeRatio, selectedRooms, utilityTotals, selectedPortfolioProject.type]);

  const heatmapColor = (actual: number, baseline: number) => {
    const ratio = baseline > 0 ? actual / baseline : 1;
    if (ratio >= 1.18) {
      const alpha = Math.min(0.9, 0.35 + Math.min((ratio - 1.18) / 0.55, 1) * 0.55);
      return `rgba(239, 68, 68, ${alpha})`;
    }
    if (ratio >= 1.08) {
      const alpha = Math.min(0.82, 0.28 + Math.min((ratio - 1.08) / 0.18, 1) * 0.5);
      return `rgba(249, 115, 22, ${alpha})`;
    }
    if (ratio >= 0.92) {
      return "rgba(71, 85, 105, 0.35)";
    }
    const alpha = Math.min(0.78, 0.2 + Math.min((0.92 - ratio) / 0.42, 1) * 0.5);
    return `rgba(52, 211, 153, ${alpha})`;
  };

  const heatmapInsights = useMemo(() => {
    const flattened = heatmapCells.flatMap((row, rowIndex) => row.map((cell, colIndex) => ({ ...cell, rowIndex, colIndex })));
    const peak = flattened.reduce((best, current) => (current.actual > best.actual ? current : best), flattened[0]);
    const anomaly = flattened.reduce((best, current) => (Math.abs(current.deviation) > Math.abs(best.deviation) ? current : best), flattened[0]);
    const positiveDeviation = flattened.filter((cell) => cell.deviation > 0).reduce((sum, cell) => sum + (cell.actual - cell.baseline), 0);
    const potentialSaving = positiveDeviation * utilityMeta[heatmapUtility].costRate * 0.35;
    return {
      peak,
      anomaly,
      potentialSaving
    };
  }, [heatmapCells, heatmapUtility, utilityMeta]);

  return (
    <div className="min-h-full space-y-4 bg-shell-950 p-5 text-slate-100">
      <section className="rounded-xl border border-shell-600 bg-shell-800 p-4">
        <div className="mb-3 grid gap-3 md:grid-cols-[320px_1fr_auto]">
          <div className="relative" ref={pickerRef}>
            <button
              type="button"
              onClick={() => setSpacePickerOpen((open) => !open)}
              className="flex w-full items-center justify-between rounded-lg border border-shell-600 bg-shell-900 px-3 py-2 text-sm text-slate-100"
            >
              <span className="truncate">{selectedSpaceLabel}</span>
              <ChevronRight className={`h-4 w-4 text-slate-400 transition ${spacePickerOpen ? "rotate-90" : ""}`} />
            </button>
            {spacePickerOpen ? (
              <div className="absolute left-0 top-11 z-30 grid w-[720px] grid-cols-3 rounded-xl border border-shell-600 bg-shell-900 shadow-soft">
                <div className="max-h-64 overflow-y-auto border-r border-shell-600 p-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedBlock("all");
                      setSelectedLevel("all");
                      setSelectedRoom("all");
                    }}
                    className={`mb-1 flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm ${
                      selectedBlock === "all" ? "bg-shell-700 text-white" : "text-slate-300 hover:bg-shell-800"
                    }`}
                  >
                    All Blocks
                  </button>
                  {blockOptions.map((block) => (
                    <button
                      key={block}
                      type="button"
                      onClick={() => {
                        setSelectedBlock(block);
                        setSelectedLevel("all");
                        setSelectedRoom("all");
                      }}
                      className={`mb-1 flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm ${
                        selectedBlock === block ? "bg-shell-700 text-white" : "text-slate-300 hover:bg-shell-800"
                      }`}
                    >
                      {block}
                      <ChevronRight className="h-3.5 w-3.5 text-slate-500" />
                    </button>
                  ))}
                </div>
                <div className="max-h-64 overflow-y-auto border-r border-shell-600 p-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedLevel("all");
                      setSelectedRoom("all");
                    }}
                    className={`mb-1 flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm ${
                      selectedLevel === "all" ? "bg-shell-700 text-white" : "text-slate-300 hover:bg-shell-800"
                    }`}
                  >
                    All Levels
                  </button>
                  {levelOptions.map((level) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => {
                        setSelectedLevel(level);
                        setSelectedRoom("all");
                      }}
                      className={`mb-1 flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm ${
                        selectedLevel === level ? "bg-shell-700 text-white" : "text-slate-300 hover:bg-shell-800"
                      }`}
                    >
                      {level}
                      <ChevronRight className="h-3.5 w-3.5 text-slate-500" />
                    </button>
                  ))}
                </div>
                <div className="max-h-64 overflow-y-auto p-2">
                  <button
                    type="button"
                    onClick={() => setSelectedRoom("all")}
                    className={`mb-1 flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm ${
                      selectedRoom === "all" ? "bg-shell-700 text-white" : "text-slate-300 hover:bg-shell-800"
                    }`}
                  >
                    All Rooms
                  </button>
                  {roomOptions.map((room) => (
                    <button
                      key={room}
                      type="button"
                      onClick={() => setSelectedRoom(room)}
                      className={`mb-1 flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm ${
                        selectedRoom === room ? "bg-shell-700 text-white" : "text-slate-300 hover:bg-shell-800"
                      }`}
                    >
                      {room}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          <div className="flex items-center rounded-lg border border-shell-600 bg-shell-900 px-3 py-2 text-sm text-slate-300">
            <span className="mr-2 inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            {selectedPortfolioProject.address}
          </div>
          <div className="inline-flex rounded-lg border border-shell-600 bg-shell-700 p-1">
            {periodRanges.map((item) => (
              <button
                key={item}
                onClick={() => setRange(item)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${range === item ? "bg-shell-800 text-white shadow-soft" : "text-slate-400 hover:text-white"}`}
              >
                {item}
              </button>
            ))}
          </div>
        </div>

      </section>

      <section className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_260px]">
        <article className="rounded-xl border border-shell-600 bg-shell-800 p-3">
          <div className="mb-2 flex items-center justify-between text-sm text-slate-300">
            <div className="flex items-center gap-2">
              <Router className="h-3.5 w-3.5 text-slate-200" />
              <span className="text-sm font-semibold text-white">Device Statistics</span>
            </div>
            <span className="rounded-md border border-shell-500 bg-shell-900 px-2 py-0.5 text-[10px] text-slate-400">Select space</span>
          </div>
          <p className="text-[11px] text-slate-400">Total number of devices</p>
          <p className="mt-1 text-4xl font-semibold text-white">{deviceStats.total}</p>
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            <div className="rounded-lg border border-shell-600 bg-shell-900 p-2.5">
              <p className="text-[11px] text-slate-400">Fault/Normal</p>
              <p className="mt-1 text-xl font-semibold text-white">
                <span className="text-amber-400">{deviceStats.warning}</span>/{deviceStats.normal}
              </p>
            </div>
            <div className="rounded-lg border border-shell-600 bg-shell-900 p-2.5">
              <p className="text-[11px] text-slate-400">Alarm/Normal</p>
              <p className="mt-1 text-xl font-semibold text-white">
                <span className="text-rose-400">{alarmStats.active}</span>/{Math.max(deviceStats.total - alarmStats.active, 0)}
              </p>
            </div>
            <div className="rounded-lg border border-shell-600 bg-shell-900 p-2.5">
              <p className="text-[11px] text-slate-400">Offline/Online</p>
              <p className="mt-1 text-xl font-semibold text-white">
                <span className="text-slate-400">{deviceStats.offline}</span>/{deviceStats.online}
              </p>
            </div>
            <div className="rounded-lg border border-shell-600 bg-shell-900 p-2.5">
              <p className="text-[11px] text-slate-400">On/Off</p>
              <p className="mt-1 text-xl font-semibold text-white">
                <span className="text-emerald-400">{deviceStats.switchOn}</span>/{deviceStats.switchOff}
              </p>
            </div>
          </div>
        </article>

        <article className="rounded-xl border border-shell-600 bg-shell-800 p-3">
          <div className="mb-3 flex items-center justify-between text-sm text-slate-300">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500 text-shell-950">
                <BellRing className="h-3.5 w-3.5" />
              </span>
              <span className="text-sm font-semibold text-white">Alarm Statistics</span>
            </div>
            <button type="button" className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-white">
              View More <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mb-3 flex justify-end">
            <div className="inline-flex rounded-lg bg-black/70 p-1 text-[11px]">
              <span className="rounded-md bg-shell-800 px-2.5 py-1 text-white">Today</span>
              <span className="px-2.5 py-1 text-slate-400">Last 7 days</span>
            </div>
          </div>
          <p className="text-[11px] text-slate-400">Total number of alarms</p>
          <p className="mt-1.5 text-4xl font-semibold text-slate-100">{alarmStats.total}</p>
          <div className="mt-4 grid grid-cols-[84px_1fr_1fr] items-center gap-3">
            <div
              className="mx-auto h-[68px] w-[68px] rounded-full"
              style={{
                background: `conic-gradient(#84cc16 ${Math.round(solvedRatio * 360)}deg, #fbbf24 ${Math.round(solvedRatio * 360)}deg 360deg)`
              }}
            >
              <div className="m-[7px] h-[54px] w-[54px] rounded-full border border-shell-600 bg-shell-900" />
            </div>
            <div>
              <p className="text-[11px] text-slate-400">
                <span className="mr-1.5 inline-flex h-2.5 w-2.5 rounded-full bg-lime-400" />
                Solved
              </p>
              <p className="mt-1 text-xl font-semibold text-emerald-400">{alarmStats.resolved}</p>
            </div>
            <div>
              <p className="text-[11px] text-slate-400">
                <span className="mr-1.5 inline-flex h-2.5 w-2.5 rounded-full bg-amber-400" />
                Unhandled
              </p>
              <p className="mt-1 text-xl font-semibold text-amber-400">{alarmStats.active}</p>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between rounded-xl bg-shell-900 px-3 py-2.5">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-shell-700 text-xs font-semibold text-slate-100">1</span>
              <span className="truncate text-[13px] text-slate-100">{alarmFocusName}</span>
            </div>
            <span className="shrink-0 text-[13px] text-slate-200">{alarmStats.total} alarms</span>
          </div>
        </article>

        <div className="grid gap-3">
          <article className="rounded-lg border border-shell-600 bg-shell-900 p-2.5">
            <div className="mb-1 flex items-center gap-2 text-xs text-slate-400">
              <CircleAlert className="h-3.5 w-3.5" />
              Carbon Emission
            </div>
            <p className="text-2xl font-semibold text-white">
              {metrics.carbon} <span className="text-sm">t CO₂</span>
            </p>
            <p className="mt-1 text-[11px] text-slate-400">Current {range}</p>
          </article>
          <article className="rounded-lg border border-shell-600 bg-shell-900 p-2.5">
            <div className="mb-1 flex items-center gap-2 text-xs text-slate-400">
              <Leaf className="h-3.5 w-3.5" />
              Efficiency Index
            </div>
            <p className="text-2xl font-semibold text-white">
              {metrics.efficiency} <span className="text-sm">kWh/m²</span>
            </p>
            <p className="mt-1 text-[11px] text-slate-400">EUI this period</p>
          </article>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-xl border border-shell-600 bg-shell-800 p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
            <Zap className="h-4 w-4 text-amber-400" />
            Electricity Consumption
          </h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={electricitySeries}>
                <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip />
                <Bar dataKey="value" fill="#f59e0b" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="rounded-xl border border-shell-600 bg-shell-800 p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
            <Droplets className="h-4 w-4 text-sky-400" />
            Water Consumption
          </h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={waterSeries}>
                <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip />
                <Line type="monotone" dataKey="value" stroke="#60a5fa" strokeWidth={2} dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </article>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-xl border border-shell-600 bg-shell-800 p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
            <Flame className="h-4 w-4 text-orange-400" />
            Gas Consumption
          </h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={gasSeries}>
                <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip />
                <Bar dataKey="value" fill="#f97316" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className="rounded-xl border border-shell-600 bg-shell-800 p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
            <Leaf className="h-4 w-4 text-emerald-400" />
            Carbon Emissions
          </h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={carbonSeries}>
                <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip />
                <Line type="monotone" dataKey="value" stroke="#34d399" strokeWidth={2} dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </article>
      </section>

      <section className="rounded-xl border border-shell-600 bg-shell-800 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-white">Consumption Heatmap</h3>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-shell-600 bg-shell-900 p-1 text-xs">
              {(["electricity", "water", "gas", "carbon"] as HeatmapUtility[]).map((utility) => (
                <button
                  key={utility}
                  type="button"
                  onClick={() => setHeatmapUtility(utility)}
                  className={`rounded-md px-2.5 py-1 transition ${heatmapUtility === utility ? "bg-shell-700 text-white" : "text-slate-400 hover:text-white"}`}
                >
                  {utilityMeta[utility].label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="text-slate-400">
            Unit: <span className="text-slate-200">{utilityMeta[heatmapUtility].unit}</span> · Highlight:{" "}
            <span className="text-slate-200">only peak/outlier usage trends to orange-red</span>
          </div>
          <div className="inline-flex items-center gap-2 text-slate-400">
            <span>Lower vs baseline</span>
            <span className="inline-flex h-2.5 w-14 rounded bg-gradient-to-r from-emerald-400 via-orange-400 to-rose-500" />
            <span>Higher vs baseline</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <div className="grid min-w-[980px] grid-cols-[40px_repeat(24,minmax(0,1fr))] gap-1 text-[10px] text-slate-400">
            <div />
            {heatmapCols.map((hour) => (
              <div key={`h-${hour}`} className="text-center">
                {hour}
              </div>
            ))}
            {heatmapRows.map((day, rowIndex) => (
              <div key={day} className="contents">
                <div className="pr-1 text-right">{day}</div>
                {heatmapCells[rowIndex].map((cell, colIndex) => (
                  <div
                    key={`${day}-${colIndex}`}
                    className="h-5 rounded-sm border border-shell-600"
                    style={{ backgroundColor: heatmapColor(cell.actual, cell.baseline) }}
                    title={`${day} ${String(colIndex).padStart(2, "0")}:00 | Actual ${cell.actual.toFixed(2)} ${utilityMeta[heatmapUtility].unit} | Baseline ${cell.baseline.toFixed(2)} ${utilityMeta[heatmapUtility].unit} | Deviation ${cell.deviation.toFixed(1)}%`}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="mt-3 grid gap-2 text-xs text-slate-400 md:grid-cols-3">
          <div className="rounded-lg border border-shell-600 bg-shell-900 px-3 py-2">
            Peak Hour: <span className="text-slate-200">{heatmapRows[heatmapInsights.peak.rowIndex]} {String(heatmapInsights.peak.colIndex).padStart(2, "0")}:00</span>
          </div>
          <div className="rounded-lg border border-shell-600 bg-shell-900 px-3 py-2">
            Highest Anomaly: <span className="text-slate-200">{heatmapInsights.anomaly.deviation >= 0 ? "+" : ""}{heatmapInsights.anomaly.deviation.toFixed(1)}%</span>
          </div>
          <div className="rounded-lg border border-shell-600 bg-shell-900 px-3 py-2">
            Potential Saving: <span className="text-slate-200">${heatmapInsights.potentialSaving.toFixed(0)}</span>
          </div>
        </div>
      </section>
    </div>
  );
}
