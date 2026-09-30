import { useMemo, useState } from "react";
import { CostByDimensionItem } from "@/mock/types";
import { buildSpaceRoot, hashCode, SpaceNode } from "@/components/analysis/spaceHierarchy";
import { RequirementGuideTitle } from "@/components/analysis/RequirementGuide";

interface CostAnalysisSectionProps {
  projectId: string;
  projectName: string;
  spaceRootOverride?: SpaceNode;
  totalEstimatedCost: number;
  highestCostBlock: string;
  highestCostRoom: string;
  increaseVsPreviousPct: number;
  costByBlock: CostByDimensionItem[];
  costByTag: CostByDimensionItem[];
}

type HeatmapCell = {
  roomName: string;
  occupants: number;
  monthlyCost: number;
  perCapitaCost: number;
};
type TagKey = "Air Conditioning" | "Plug Load" | "Lighting" | "Heater" | "Kitchen";

const TAG_ORDER: TagKey[] = ["Air Conditioning", "Plug Load", "Lighting", "Heater", "Kitchen"];
const DAY_COUNTS = { weekday: 22, weekend: 6, holiday: 2 } as const;

function inHourWindow(hour: number, start: number, end: number) {
  if (start <= end) {
    return hour >= start && hour < end;
  }
  return hour >= start || hour < end;
}

export function CostAnalysisSection({
  projectId,
  projectName,
  spaceRootOverride,
  totalEstimatedCost,
  highestCostBlock: _highestCostBlock,
  highestCostRoom: _highestCostRoom,
  increaseVsPreviousPct,
  costByBlock: _costByBlock,
  costByTag: _costByTag
}: CostAnalysisSectionProps) {
  const [selectedBlock, setSelectedBlock] = useState<string | null>(null);
  const [heatmapMetric, setHeatmapMetric] = useState<"total" | "perCapita">("total");
  const [hoveredRoom, setHoveredRoom] = useState<{
    roomName: string;
    occupants: number;
    monthlyCost: number;
    perCapitaCost: number;
    x: number;
    y: number;
  } | null>(null);

  const previousEstimatedCost =
    increaseVsPreviousPct === -100 ? totalEstimatedCost : totalEstimatedCost / (1 + increaseVsPreviousPct / 100);
  const deltaCost = totalEstimatedCost - previousEstimatedCost;

  const spaceRoot = useMemo(
    () => spaceRootOverride ?? buildSpaceRoot(projectId, projectName),
    [projectId, projectName, spaceRootOverride]
  );

  const roomRecords = useMemo(() => {
    const rows: Array<{
      block: string;
      level: string;
      room: string;
      monthlyCost: number;
      occupants: number;
      perCapitaCost: number;
      rawWeight: number;
      tagCosts: Record<TagKey, number>;
    }> = [];

    const roomMeta: Array<{ block: string; level: string; room: string; occupants: number; seed: number }> = [];
    (spaceRoot.children ?? []).forEach((blockNode, blockIndex) => {
      (blockNode.children ?? []).forEach((levelNode) => {
        (levelNode.children ?? []).forEach((roomNode) => {
          const seed = hashCode(`${projectId}-${blockNode.name}-${levelNode.name}-${roomNode.name}`);
          // Keep occupant generation logic unchanged across this page.
          const occupants = 2 + (seed % 7);
          roomMeta.push({
            block: blockNode.name,
            level: levelNode.name,
            room: roomNode.name,
            occupants,
            seed: seed + blockIndex * 17
          });
        });
      });
    });

    const blockOccupancy = new Map<string, number>();
    roomMeta.forEach((item) => blockOccupancy.set(item.block, (blockOccupancy.get(item.block) ?? 0) + item.occupants));
    const highestOccupancyBlock =
      [...blockOccupancy.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
      (spaceRoot.children ?? [])[0]?.name ??
      "Block 502";
    const weekendKitchenBlock =
      (spaceRoot.children ?? [])[Math.max(0, ((hashCode(`${projectId}-wk-kitchen`) % ((spaceRoot.children ?? []).length || 1)) + 1) % ((spaceRoot.children ?? []).length || 1))]?.name ??
      highestOccupancyBlock;

    const anomalyNightAcRooms = roomMeta
      .slice()
      .sort((a, b) => hashCode(`${a.seed}-nightac`) - hashCode(`${b.seed}-nightac`))
      .slice(0, 2)
      .map((item) => item.room);
    const standbySocketRoom =
      roomMeta.slice().sort((a, b) => hashCode(`${a.seed}-standby`) - hashCode(`${b.seed}-standby`))[0]?.room ?? roomMeta[0]?.room;
    const lowUsageHighOccupancyRooms = roomMeta
      .filter((item) => item.occupants >= 5)
      .slice()
      .sort((a, b) => hashCode(`${a.seed}-lowusage`) - hashCode(`${b.seed}-lowusage`))
      .slice(0, 2)
      .map((item) => item.room);

    roomMeta.forEach((item) => {
      const lifestyleVariance = 0.84 + (hashCode(`${item.seed}-lifestyle`) % 37) / 100;
      const hasShiftWorker = hashCode(`${item.seed}-shift`) % 11 === 0;
      const dayTypeLoadFactor = {
        weekday: 1,
        weekend: 1.16 + (hashCode(`${item.seed}-weekend-load`) % 10) / 100,
        holiday: 1.24 + (hashCode(`${item.seed}-holiday-load`) % 18) / 100
      } as const;

      const tagKwhRaw: Record<TagKey, number> = {
        "Air Conditioning": 0,
        "Plug Load": 0,
        Lighting: 0,
        Heater: 0,
        Kitchen: 0
      };

      (Object.keys(DAY_COUNTS) as Array<keyof typeof DAY_COUNTS>).forEach((dayType) => {
        const days = DAY_COUNTS[dayType];
        const dayFactor = dayTypeLoadFactor[dayType];

        for (let hour = 0; hour < 24; hour += 1) {
          const daySeed = hashCode(`${item.seed}-${dayType}-${hour}`);
          const workerAtDormFactor =
            dayType === "weekday"
              ? inHourWindow(hour, 8, 18)
                ? 0.56
                : inHourWindow(hour, 5, 8)
                  ? 1.26
                  : inHourWindow(hour, 18, 24)
                    ? 1.42
                    : inHourWindow(hour, 0, 5)
                      ? (hasShiftWorker ? 0.94 : 0.48)
                      : 0.62
              : dayType === "weekend"
                ? inHourWindow(hour, 9, 18)
                  ? 1.16
                  : inHourWindow(hour, 18, 24)
                    ? 1.26
                    : 0.86
                : inHourWindow(hour, 8, 23)
                  ? 1.34
                  : 1.04;

          // Aircon: highest category, evening-night dominant, 20:00-02:00 peak.
          let airconProfile =
            inHourWindow(hour, 20, 2) ? 1.58 : inHourWindow(hour, 18, 20) || inHourWindow(hour, 2, 5) ? 1.22 : 0.74;
          if (dayType !== "weekday") {
            airconProfile *= 1.12;
          }
          if (anomalyNightAcRooms.includes(item.room) && inHourWindow(hour, 20, 5)) {
            airconProfile *= 1.38;
          }
          const airconOccFactor = 0.72 + item.occupants * 0.18;
          tagKwhRaw["Air Conditioning"] +=
            0.28 * airconOccFactor * airconProfile * workerAtDormFactor * dayFactor * lifestyleVariance * (0.92 + (daySeed % 15) / 100) * days;

          // Room Socket(Plug Load): evening boost + night standby, weekend daytime higher.
          let plugProfile =
            inHourWindow(hour, 19, 24) ? 1.34 : inHourWindow(hour, 0, 6) ? 0.68 : inHourWindow(hour, 9, 18) ? 0.72 : 0.86;
          if (dayType === "weekend" && inHourWindow(hour, 9, 18)) {
            plugProfile *= 1.28;
          }
          if (dayType === "holiday" && inHourWindow(hour, 9, 18)) {
            plugProfile *= 1.36;
          }
          if (item.room === standbySocketRoom && inHourWindow(hour, 0, 6)) {
            plugProfile *= 1.72;
          }
          const plugOccFactor = 0.66 + item.occupants * 0.14;
          tagKwhRaw["Plug Load"] +=
            0.19 * plugOccFactor * plugProfile * workerAtDormFactor * dayFactor * lifestyleVariance * (0.91 + (daySeed % 13) / 100) * days;

          // Lighting: low-medium, morning and night peaks, daytime low.
          let lightingProfile =
            inHourWindow(hour, 5, 8) ? 1.12 : inHourWindow(hour, 18, 24) || inHourWindow(hour, 0, 1) ? 1.08 : inHourWindow(hour, 8, 18) ? 0.42 : 0.62;
          if (dayType === "weekend" || dayType === "holiday") {
            lightingProfile *= 1.16;
          }
          const lightingOccFactor = 0.72 + item.occupants * 0.09;
          tagKwhRaw.Lighting +=
            0.09 * lightingOccFactor * lightingProfile * workerAtDormFactor * dayFactor * lifestyleVariance * (0.93 + (daySeed % 11) / 100) * days;

          // Heater: short spikes only in 5-8 and 20-23.
          const isHeaterPeak = inHourWindow(hour, 5, 8) || inHourWindow(hour, 20, 23);
          const heaterProfile = isHeaterPeak ? 1.86 : 0.09;
          const heaterOccFactor = 0.58 + item.occupants * 0.23;
          tagKwhRaw.Heater +=
            0.12 * heaterOccFactor * heaterProfile * dayFactor * lifestyleVariance * (0.9 + (daySeed % 12) / 100) * days;

          // Kitchen: clear meal-time peaks, weekend/holiday lunch and dinner higher.
          let kitchenProfile =
            inHourWindow(hour, 6, 8) ? 1.18 : inHourWindow(hour, 12, 14) ? 1 : inHourWindow(hour, 18, 21) ? 1.26 : 0.18;
          if (dayType !== "weekday" && inHourWindow(hour, 12, 14)) {
            kitchenProfile *= 1.34;
          }
          if (item.block === weekendKitchenBlock && dayType !== "weekday" && inHourWindow(hour, 11, 21)) {
            kitchenProfile *= 1.22;
          }
          const kitchenOccFactor = 0.62 + item.occupants * 0.11;
          tagKwhRaw.Kitchen +=
            0.08 * kitchenOccFactor * kitchenProfile * workerAtDormFactor * dayFactor * lifestyleVariance * (0.92 + (daySeed % 10) / 100) * days;
        }
      });

      if (item.block === highestOccupancyBlock) {
        TAG_ORDER.forEach((tag) => {
          tagKwhRaw[tag] *= 1.1;
        });
      }
      if (lowUsageHighOccupancyRooms.includes(item.room)) {
        TAG_ORDER.forEach((tag) => {
          tagKwhRaw[tag] *= 0.74;
        });
      }

      const roomRawCost = TAG_ORDER.reduce((sum, tag) => sum + tagKwhRaw[tag] * 0.3, 0);

      rows.push({
        block: item.block,
        level: item.level,
        room: item.room,
        monthlyCost: 0,
        occupants: item.occupants,
        perCapitaCost: 0,
        rawWeight: roomRawCost,
        tagCosts: {
          "Air Conditioning": tagKwhRaw["Air Conditioning"] * 0.3,
          "Plug Load": tagKwhRaw["Plug Load"] * 0.3,
          Lighting: tagKwhRaw.Lighting * 0.3,
          Heater: tagKwhRaw.Heater * 0.3,
          Kitchen: tagKwhRaw.Kitchen * 0.3
        }
      });
    });

    const totalWeight = rows.reduce((sum, item) => sum + item.rawWeight, 0);
    const factor = totalWeight > 0 ? totalEstimatedCost / totalWeight : 1;
    return rows.map((item) => {
      const monthlyCost = Math.max(40, Math.round(item.rawWeight * factor));
      const perCapitaCost = monthlyCost / Math.max(item.occupants, 1);
      const scaledTagCosts = TAG_ORDER.reduce(
        (accumulator, tag) => {
          accumulator[tag] = Math.max(0, Math.round(item.tagCosts[tag] * factor));
          return accumulator;
        },
        {} as Record<TagKey, number>
      );
      const scaledTagTotal = TAG_ORDER.reduce((sum, tag) => sum + scaledTagCosts[tag], 0);
      if (scaledTagTotal !== monthlyCost) {
        scaledTagCosts["Air Conditioning"] = Math.max(0, scaledTagCosts["Air Conditioning"] + (monthlyCost - scaledTagTotal));
      }
      return {
        ...item,
        monthlyCost,
        perCapitaCost,
        tagCosts: scaledTagCosts
      };
    });
  }, [projectId, spaceRoot, totalEstimatedCost]);

  const blockBreakdownRows = useMemo(() => {
    const blockMap = new Map<string, number>();
    roomRecords.forEach((record) => {
      blockMap.set(record.block, (blockMap.get(record.block) ?? 0) + record.monthlyCost);
    });
    const totalBlockCost = Array.from(blockMap.values()).reduce((sum, value) => sum + value, 0);
    return Array.from(blockMap.entries())
      .map(([name, cost]) => ({
        name,
        cost,
        share: totalBlockCost > 0 ? (cost / totalBlockCost) * 100 : 0
      }))
      .sort((a, b) => b.cost - a.cost);
  }, [roomRecords]);

  const totalOccupants = useMemo(
    () => roomRecords.reduce((sum, record) => sum + record.occupants, 0),
    [roomRecords]
  );
  const perCapitaCostOverall = useMemo(
    () => (totalOccupants > 0 ? totalEstimatedCost / totalOccupants : 0),
    [totalEstimatedCost, totalOccupants]
  );
  const nationalBenchmarkFactor = useMemo(() => {
    const seed = hashCode(`national-benchmark-${projectId}`);
    return 0.92 + (seed % 14) / 100; // 0.92 - 1.05
  }, [projectId]);
  const nationalPerCapitaBenchmark = useMemo(
    () => perCapitaCostOverall * nationalBenchmarkFactor,
    [nationalBenchmarkFactor, perCapitaCostOverall]
  );

  const blockHeatmap = useMemo(() => {
    if (!selectedBlock) {
      return null;
    }

    const blockNode = (spaceRoot.children ?? []).find((node) => node.name === selectedBlock);
    const levels = (blockNode?.children ?? []).map((level) => level.name);
    const levelRoomNames = (blockNode?.children ?? []).map((level) => (level.children ?? []).map((room) => room.name));
    const maxRooms = 6;

    const roomCells: Array<Array<HeatmapCell | undefined>> = levels.map((levelName, levelIndex) => {
      const roomNames = levelRoomNames[levelIndex] ?? [];
      const row: Array<HeatmapCell | undefined> = Array.from({ length: maxRooms }, () => undefined);
      roomNames.forEach((roomName) => {
        const matched = roomRecords.find((record) => record.block === selectedBlock && record.level === levelName && record.room === roomName);
        const suffix = roomName.split("-")[1];
        const roomColumnIndex = Math.max(0, Math.min(maxRooms - 1, Number.parseInt(suffix, 10) - 1));
        row[roomColumnIndex] = {
          roomName,
          monthlyCost: matched?.monthlyCost ?? 0,
          occupants: matched?.occupants ?? 0,
          perCapitaCost: matched?.perCapitaCost ?? 0
        };
      });
      return row;
    });

    const allCosts = roomCells
      .flat()
      .filter((item): item is HeatmapCell => Boolean(item))
      .map((item) => item.monthlyCost);
    const allPerCapita = roomCells
      .flat()
      .filter((item): item is HeatmapCell => Boolean(item))
      .map((item) => item.perCapitaCost);
    const minCost = Math.min(...allCosts);
    const maxCost = Math.max(...allCosts);
    const minPerCapita = Math.min(...allPerCapita);
    const maxPerCapita = Math.max(...allPerCapita);

    return { levels, roomCells, maxRooms, minCost, maxCost, minPerCapita, maxPerCapita };
  }, [roomRecords, selectedBlock, spaceRoot.children]);

  const tagBreakdownRows = useMemo(() => {
    const tagTotals = new Map<string, number>();
    roomRecords.forEach((room) => {
      TAG_ORDER.forEach((tag) => {
        tagTotals.set(tag, (tagTotals.get(tag) ?? 0) + room.tagCosts[tag]);
      });
    });
    const totalTagCost = [...tagTotals.values()].reduce((sum, value) => sum + value, 0);
    return [...tagTotals.entries()]
      .map(([name, cost]) => ({
        name,
        cost,
        share: totalTagCost > 0 ? (cost / totalTagCost) * 100 : 0
      }))
      .sort((a, b) => b.cost - a.cost);
  }, [roomRecords]);

  return (
    <section className="panel p-4">
      <RequirementGuideTitle
        title="Cost Analysis"
        className="mb-2 text-sm font-semibold text-white"
        content={{
          title: "Cost Analysis Requirements",
          summary: "Cost analytics must support block, room, and tag-level comparison with behavior-based synthetic data.",
          dataAcquisition: [
            "Use buildSpaceRoot hierarchy and deterministic occupant generation per room.",
            "Generate room-level tag costs from weekday/weekend/holiday behavior patterns.",
            "Scale room raw costs to match totalEstimatedCost for the selected project.",
            "Aggregate block and tag totals from room-level records."
          ],
          chartGeneration: [
            "Render summary KPI table for total, previous, delta, per-capita, and benchmark.",
            "Render block breakdown table with share and daily cost.",
            "Render interactive room heatmap by total/per-capita mode after block selection.",
            "Render top per-capita rooms and tag breakdown tables."
          ]
        }}
      />
      <p className="mb-3 text-xs text-slate-400">
        Left side shows breakdown by block. Right side shows room-level cost heatmap only after block selection.
      </p>

      <div className="mb-3 rounded-lg border border-shell-600">
        <table className="w-full text-[11px]">
          <thead className="bg-shell-700 text-slate-300">
            <tr>
              <th className="whitespace-nowrap px-2 py-1.5 text-left">Total Cost (SGD)</th>
              <th className="whitespace-nowrap px-2 py-1.5 text-left">Previous Period (SGD)</th>
              <th className="whitespace-nowrap px-2 py-1.5 text-left">Delta (SGD)</th>
              <th className="whitespace-nowrap px-2 py-1.5 text-left">Trend</th>
              <th className="whitespace-nowrap px-2 py-1.5 text-left">Per Capita Cost (SGD)</th>
              <th className="whitespace-nowrap px-2 py-1.5 text-left">National Per Capita Benchmark (SGD)</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-shell-600 text-slate-200">
              <td className="whitespace-nowrap px-2 py-1.5 font-semibold text-blue-300">SGD {totalEstimatedCost.toLocaleString()}</td>
              <td className="whitespace-nowrap px-2 py-1.5">SGD {Math.round(previousEstimatedCost).toLocaleString()}</td>
              <td className={`whitespace-nowrap px-2 py-1.5 ${deltaCost >= 0 ? "text-amber-300" : "text-emerald-300"}`}>
                {deltaCost >= 0 ? "+" : "-"}SGD {Math.abs(Math.round(deltaCost)).toLocaleString()}
              </td>
              <td className={`whitespace-nowrap px-2 py-1.5 ${increaseVsPreviousPct > 0 ? "text-amber-300" : "text-emerald-300"}`}>
                {increaseVsPreviousPct > 0 ? "+" : ""}
                {increaseVsPreviousPct.toFixed(1)}%
              </td>
              <td className="whitespace-nowrap px-2 py-1.5">SGD {perCapitaCostOverall.toFixed(1)}</td>
              <td className="whitespace-nowrap px-2 py-1.5">SGD {nationalPerCapitaBenchmark.toFixed(1)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mb-4 grid gap-3 xl:grid-cols-[1fr_1.35fr]">
        <div className="flex h-[320px] flex-col rounded-lg border border-shell-600">
          <div className="border-b border-shell-600 bg-shell-800 px-3 py-2 text-[11px] font-medium text-slate-300">
            <RequirementGuideTitle
              title="Breakdown by Block"
              className="text-[11px] font-medium text-slate-300"
              content={{
                title: "Breakdown by Block Requirements",
                summary: "Block table should support cost ranking and heatmap drill-in.",
                dataAcquisition: [
                  "Aggregate monthlyCost from room records grouped by block.",
                  "Compute share against total block cost.",
                  "Compute daily cost as monthly cost divided by 30."
                ],
                chartGeneration: [
                  "Render fixed-width table to avoid wrapping and alignment drift.",
                  "Highlight selected block row for heatmap linkage.",
                  "Sort rows by descending block cost."
                ]
              }}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <table className="w-full table-fixed text-[11px]">
            <colgroup>
              <col className="w-[34%]" />
              <col className="w-[23%]" />
              <col className="w-[27%]" />
              <col className="w-[16%]" />
            </colgroup>
            <thead className="bg-shell-700 text-slate-300">
              <tr>
                <th className="whitespace-nowrap px-2 py-1.5 text-left">Block</th>
                <th className="whitespace-nowrap px-2 py-1.5 text-left">Cost (SGD)</th>
                <th className="whitespace-nowrap px-2 py-1.5 text-left">Daily Cost (SGD)</th>
                <th className="whitespace-nowrap px-2 py-1.5 text-left">Share</th>
              </tr>
            </thead>
            <tbody>
              {blockBreakdownRows.map((item) => (
                <tr
                  key={item.name}
                  className={`cursor-pointer border-t border-shell-600 ${
                    selectedBlock === item.name ? "bg-blue-500/10 text-blue-200" : "text-slate-200 hover:bg-shell-800"
                  }`}
                  onClick={() => setSelectedBlock(item.name)}
                >
                  <td className="whitespace-nowrap px-2 py-1.5">{item.name}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-left">{item.cost.toLocaleString()}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-left">
                    {(item.cost / 30).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-left">{item.share.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
            </table>
          </div>
        </div>

        <div className="relative flex h-[320px] flex-col rounded-lg border border-shell-600 bg-shell-900 p-2.5">
          <div className="mb-2 flex items-center justify-between">
            <RequirementGuideTitle
              title="Cost Heatmap"
              className="text-[11px] text-slate-400"
              content={{
                title: "Cost Heatmap Requirements",
                summary: "Room-level heatmap should surface high-cost rooms quickly and support per-capita mode.",
                dataAcquisition: [
                  "Build room matrix for selected block using level and room hierarchy.",
                  "Map room records to matrix index by room suffix.",
                  "Compute min/max for both monthly and per-capita values."
                ],
                chartGeneration: [
                  "Render grid with fixed columns (R01-R06) and dashed placeholders for missing rooms.",
                  "Use color interpolation between min and max values.",
                  "Support metric toggle between total and per-capita cost.",
                  "Show room tooltip on hover with occupants and costs."
                ]
              }}
            />
            <div className="inline-flex rounded border border-shell-600 bg-shell-800 p-1">
              <button
                className={`rounded px-2 py-1 text-[10px] ${
                  heatmapMetric === "total" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"
                }`}
                onClick={() => setHeatmapMetric("total")}
              >
                Room Total Cost
              </button>
              <button
                className={`rounded px-2 py-1 text-[10px] ${
                  heatmapMetric === "perCapita" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"
                }`}
                onClick={() => setHeatmapMetric("perCapita")}
              >
                Per Capita Cost
              </button>
            </div>
          </div>
          {!blockHeatmap ? (
            <div className="flex min-h-0 flex-1 items-center justify-center rounded-md border border-dashed border-shell-600 text-xs text-slate-500">
              Select a block from the left table to display heatmap
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-2">
              <div className="text-[11px] text-slate-400">
                Selected block: <span className="text-slate-200">{selectedBlock}</span>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-shell-700 bg-black/20 p-1.5">
                <div className="grid gap-1" style={{ gridTemplateColumns: `88px repeat(${blockHeatmap.maxRooms}, minmax(30px, 1fr))` }}>
                  <div className="text-[10px] text-slate-500">Level / Room</div>
                  {Array.from({ length: blockHeatmap.maxRooms }, (_, roomIndex) => (
                    <div key={`room-head-${roomIndex}`} className="text-center text-[10px] text-slate-500">
                      R{String(roomIndex + 1).padStart(2, "0")}
                    </div>
                  ))}

                  {blockHeatmap.levels.map((levelName, levelIndex) => (
                    <>
                      <div key={`level-${levelName}`} className="pr-2 text-[11px] text-slate-300">
                        {levelName}
                      </div>
                      {Array.from({ length: blockHeatmap.maxRooms }, (_, roomIndex) => {
                        const room = blockHeatmap.roomCells[levelIndex][roomIndex];
                        if (!room) {
                          return <div key={`empty-${levelName}-${roomIndex}`} className="h-6 rounded border border-dashed border-shell-700/60" />;
                        }
                        return (
                          <button
                            key={`${levelName}-${room.roomName}`}
                            type="button"
                            className="h-6 rounded border border-shell-700 transition hover:brightness-110"
                            style={{
                              backgroundColor:
                                heatmapMetric === "total"
                                  ? roomColor(room.monthlyCost, blockHeatmap.minCost, blockHeatmap.maxCost)
                                  : roomColor(room.perCapitaCost, blockHeatmap.minPerCapita, blockHeatmap.maxPerCapita)
                            }}
                            onMouseMove={(event) =>
                              setHoveredRoom({
                                roomName: room.roomName,
                                occupants: room.occupants,
                                monthlyCost: room.monthlyCost,
                                perCapitaCost: room.perCapitaCost,
                                x: event.clientX,
                                y: event.clientY
                              })
                            }
                            onMouseLeave={() => setHoveredRoom(null)}
                          />
                        );
                      })}
                    </>
                  ))}
                </div>
              </div>
            </div>
          )}

          {hoveredRoom ? (
            <div
              className="pointer-events-none fixed z-[90] min-w-[170px] rounded-md border border-shell-600 bg-black/90 px-3 py-2 text-[11px] text-slate-100 shadow-soft"
              style={{ left: hoveredRoom.x + 12, top: hoveredRoom.y + 12 }}
            >
              <p className="font-semibold text-white">{hoveredRoom.roomName}</p>
              <p className="mt-1 text-slate-300">Occupants: {hoveredRoom.occupants}</p>
              <p className="text-slate-300">Monthly Cost: SGD {hoveredRoom.monthlyCost.toLocaleString()}</p>
              <p className="text-slate-300">Per Capita Cost: SGD {hoveredRoom.perCapitaCost.toFixed(1)}</p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="mb-4 grid gap-4 xl:grid-cols-2">
        <div className="rounded-lg border border-shell-600">
          <div className="border-b border-shell-600 bg-shell-800 px-3 py-2 text-xs font-medium text-slate-300">
            <RequirementGuideTitle
              title="Highest Per Capita Rooms"
              className="text-xs font-medium text-slate-300"
              content={{
                title: "Highest Per Capita Rooms Requirements",
                summary: "This table lists rooms with the highest cost burden per occupant.",
                dataAcquisition: [
                  "Use roomRecords with monthlyCost and occupants.",
                  "Compute perCapitaCost as monthlyCost / occupants.",
                  "Sort and take top 10 rows."
                ],
                chartGeneration: [
                  "Render rank badges and room-level cost metrics.",
                  "Include monthly and daily cost plus occupant count.",
                  "Keep numeric columns right-aligned for scanability."
                ]
              }}
            />
          </div>
          <table className="w-full text-[11px]">
            <thead className="bg-shell-700 text-slate-300">
              <tr>
                <th className="whitespace-nowrap px-2 py-1.5 text-left">Rank</th>
                <th className="whitespace-nowrap px-2 py-1.5 text-left">Room</th>
                <th className="whitespace-nowrap px-2 py-1.5 text-right">Cost (SGD)</th>
                <th className="whitespace-nowrap px-2 py-1.5 text-right">Daily Cost (SGD)</th>
                <th className="whitespace-nowrap px-2 py-1.5 text-right">Occupants</th>
                <th className="whitespace-nowrap px-2 py-1.5 text-right">Per Capita (SGD)</th>
              </tr>
            </thead>
            <tbody>
              {[...roomRecords]
                .sort((a, b) => b.perCapitaCost - a.perCapitaCost)
                .slice(0, 10)
                .map((room, index) => (
                  <tr key={`${room.block}-${room.level}-${room.room}`} className="border-t border-shell-600 text-slate-200">
                    <td className="whitespace-nowrap px-2 py-1.5">
                      <span className={`inline-flex rounded px-2 py-0.5 text-xs ${rankColor(index)}`}>#{index + 1}</span>
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5">{room.room}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right">{room.monthlyCost.toLocaleString()}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right">
                      {(room.monthlyCost / 30).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right">{room.occupants}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right font-medium text-blue-200">{room.perCapitaCost.toFixed(1)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border border-shell-600">
          <div className="border-b border-shell-600 bg-shell-800 px-3 py-2 text-xs font-medium text-slate-300">
            <RequirementGuideTitle
              title="Breakdown by Tag"
              className="text-xs font-medium text-slate-300"
              content={{
                title: "Breakdown by Tag Requirements",
                summary: "Tag-level table summarizes where cost is concentrated by circuit category.",
                dataAcquisition: [
                  "Sum room tagCosts across all rooms for each tag.",
                  "Compute share percentage from total tag cost.",
                  "Compute daily cost as tag monthly cost / 30."
                ],
                chartGeneration: [
                  "Render sorted table by descending tag cost.",
                  "Display cost, daily cost, and share in compact one-line rows."
                ]
              }}
            />
          </div>
          <table className="w-full text-[11px]">
            <thead className="bg-shell-700 text-slate-300">
              <tr>
                <th className="whitespace-nowrap px-2 py-1.5 text-left">Tag</th>
                <th className="whitespace-nowrap px-2 py-1.5 text-right">Cost (SGD)</th>
                <th className="whitespace-nowrap px-2 py-1.5 text-right">Daily Cost (SGD)</th>
                <th className="whitespace-nowrap px-2 py-1.5 text-right">Share</th>
              </tr>
            </thead>
            <tbody>
              {tagBreakdownRows.map((item) => (
                <tr key={item.name} className="border-t border-shell-600 text-slate-200">
                  <td className="whitespace-nowrap px-2 py-1.5">{item.name}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right">{item.cost.toLocaleString()}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right">
                    {(item.cost / 30).toLocaleString(undefined, { maximumFractionDigits: 1 })}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right">{item.share.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-3 text-xs text-slate-500">Per-capita cost is only available for the smallest space level (Room).</p>
    </section>
  );
}

function roomColor(value: number, min: number, max: number) {
  if (max <= min) {
    return "rgb(219, 234, 254)";
  }
  const ratio = (value - min) / (max - min);
  const start = { r: 219, g: 234, b: 254 }; // light blue
  const end = { r: 167, g: 85, b: 247 }; // blue-purple with slight red tint
  const r = Math.round(start.r + (end.r - start.r) * ratio);
  const g = Math.round(start.g + (end.g - start.g) * ratio);
  const b = Math.round(start.b + (end.b - start.b) * ratio);
  return `rgb(${r}, ${g}, ${b})`;
}

function rankColor(index: number) {
  if (index === 0) {
    return "bg-rose-500/20 text-rose-300";
  }
  if (index === 1) {
    return "bg-orange-500/20 text-orange-300";
  }
  if (index === 2) {
    return "bg-amber-500/20 text-amber-300";
  }
  if (index === 3) {
    return "bg-lime-500/20 text-lime-300";
  }
  return "bg-emerald-500/20 text-emerald-300";
}

