import { useEffect, useMemo, useRef, useState } from "react";
import { Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AnalysisUtilityKey } from "@/mock/types";
import { buildSpaceRoot, hashCode, SpaceNode } from "@/components/analysis/spaceHierarchy";
import { RequirementGuideTitle } from "@/components/analysis/RequirementGuide";

type FilterMode = "tag" | "space";
type TimeRange = "today" | "yesterday" | "last7" | "last30";

interface ConsumptionBreakdownChartProps {
  utilityKey: AnalysisUtilityKey;
  projectId: string;
  projectName?: string;
  unitLabel: string;
  totalConsumption: number;
  spaceRootOverride?: SpaceNode;
}

const tagMeta = [
  { key: "aircon", label: "Air Conditioning", color: "#5B8BCF" },
  { key: "lighting", label: "Lighting", color: "#4F9B86" },
  { key: "plug", label: "Plug Load", color: "#9A8DBF" },
  { key: "kitchen", label: "Kitchen", color: "#C68656" },
  { key: "heater", label: "Heater", color: "#B35A73" }
] as const;

const timeRangeOptions: Array<{ key: TimeRange; label: string }> = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "last7", label: "Last 7 Days" },
  { key: "last30", label: "Last 1 Month" }
];

function seeded(seed: number, offset = 0) {
  const value = Math.sin(seed * 12.9898 + offset * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function getTimeLabels(range: TimeRange) {
  if (range === "today" || range === "yesterday") {
    return Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, "0")}:00`);
  }
  if (range === "last7") {
    return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  }
  return Array.from({ length: 30 }, (_, index) => `D${String(index + 1).padStart(2, "0")}`);
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

function buildColumns(root: SpaceNode, hoverPath: string[], selectedPath: string[]) {
  const columns: SpaceNode[][] = [];
  const activePath = hoverPath.length > 0 ? hoverPath : selectedPath;
  let children = root.children ?? [];
  let depth = 0;

  if (children.length > 0) {
    columns.push(children);
  }

  while (children.length > 0 && depth < activePath.length) {
    const targetName = activePath[depth];
    const targetNode = children.find((item) => item.name === targetName);
    children = targetNode?.children ?? [];
    if (children.length > 0) {
      columns.push(children);
    }
    depth += 1;
  }

  return columns;
}

function buildSpaceSeries(root: SpaceNode, selectedPath: string[]) {
  const node = getNodeByPath(root, selectedPath);
  const children = node ? node.children ?? [] : root.children ?? [];
  if (selectedPath.length > 0 && (!children || children.length === 0)) {
    return [{ key: `space-${selectedPath.join("-")}`, label: selectedPath[selectedPath.length - 1], color: tagMeta[0].color }];
  }
  return children.map((child, index) => ({
    key: `space-${selectedPath.join("-") || "root"}-${index}`,
    label: child.name,
    color: tagMeta[index % tagMeta.length].color
  }));
}

export function ConsumptionBreakdownChart({ utilityKey, projectId, projectName, unitLabel, totalConsumption, spaceRootOverride }: ConsumptionBreakdownChartProps) {
  const displayProjectName = projectName ?? "Project";
  const [mode, setMode] = useState<FilterMode>("tag");
  const [timeRange, setTimeRange] = useState<TimeRange>("yesterday");
  const [selectedTag, setSelectedTag] = useState<string>("all");
  const [selectedSpacePath, setSelectedSpacePath] = useState<string[]>([]);
  const [hoverSpacePath, setHoverSpacePath] = useState<string[]>([]);
  const [spacePanelOpen, setSpacePanelOpen] = useState(false);
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const spacePanelRef = useRef<HTMLDivElement | null>(null);
  const spaceRoot = useMemo(
    () => spaceRootOverride ?? buildSpaceRoot(projectId, displayProjectName),
    [displayProjectName, projectId, spaceRootOverride]
  );

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (!spacePanelRef.current) {
        return;
      }
      if (!spacePanelRef.current.contains(event.target as Node)) {
        setSpacePanelOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const activeSeries = useMemo(() => {
    if (mode === "tag") {
      if (selectedTag !== "all") {
        const matched = tagMeta.find((item) => item.key === selectedTag);
        return matched ? [matched] : [tagMeta[0]];
      }
      return [...tagMeta];
    }
    return buildSpaceSeries(spaceRoot, selectedSpacePath);
  }, [mode, selectedTag, selectedSpacePath, spaceRoot]);

  const chartData = useMemo(() => {
    const labels = getTimeLabels(timeRange);
    const seedBase = hashCode(`${projectId}-${utilityKey}-${mode}-${timeRange}-${selectedTag}-${selectedSpacePath.join("/")}`);
    const usageBase = totalConsumption / Math.max(labels.length, 1);
    const costRate = utilityKey === "electricity" ? 0.3 : utilityKey === "water" ? 2.8 : 1.2;

    return labels.map((label, index) => {
      const total = usageBase * (0.72 + seeded(seedBase, index + 1) * 0.65);
      const row: Record<string, number | string> = { label };
      let allocated = 0;
      activeSeries.forEach((series, seriesIndex) => {
        const isLast = seriesIndex === activeSeries.length - 1;
        const ratio =
          isLast
            ? 1
            : 0.1 + seeded(seedBase + seriesIndex * 17, index + 100) * (0.85 / Math.max(activeSeries.length - seriesIndex, 1));
        const value = isLast ? Math.max(total - allocated, 0) : total * ratio;
        allocated += value;
        row[series.key] = Math.round(value * 10) / 10;
      });
      row.total = Math.round(total * 10) / 10;
      row.cost = Math.round(total * costRate * 100) / 100;
      return row;
    });
  }, [activeSeries, mode, projectId, selectedSpacePath, selectedTag, timeRange, totalConsumption, utilityKey]);

  const periodAverage = useMemo(() => {
    if (chartData.length === 0) {
      return 0;
    }
    const sum = chartData.reduce((acc, item) => acc + Number(item.total), 0);
    return Math.round((sum / chartData.length) * 10) / 10;
  }, [chartData]);

  const activeRow = useMemo(
    () => (activeLabel ? chartData.find((item) => String(item.label) === activeLabel) : null),
    [activeLabel, chartData]
  );

  const spaceColumns = useMemo(
    () => buildColumns(spaceRoot, hoverSpacePath, selectedSpacePath),
    [hoverSpacePath, selectedSpacePath, spaceRoot]
  );
  const displayPath = selectedSpacePath.length > 0 ? selectedSpacePath.join(" / ") : "All spaces";
  const panelWidth = useMemo(() => {
    const columnWidth = 168;
    const paddingAndGap = 24;
    const width = spaceColumns.length * columnWidth + paddingAndGap;
    return Math.min(Math.max(width, 190), 760);
  }, [spaceColumns.length]);

  function openSpacePanel() {
    setHoverSpacePath(selectedSpacePath);
    setSpacePanelOpen(true);
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
  }

  return (
    <section className="panel p-4">
      <div className="mb-2">
        <RequirementGuideTitle
          title="Consumption Breakdown"
          className="text-sm font-semibold text-white"
          content={{
            title: "Consumption Breakdown Requirements",
            summary: "This chart decomposes utility usage and cost over time by selected tag or space.",
            dataAcquisition: [
              "Use totalConsumption as the aggregate budget for the selected utility.",
              "Build time labels by selected range (today/yesterday/last7/last30).",
              "Build tag or space series from tagMeta or hierarchy children under selected path.",
              "Generate deterministic per-point variability with seeded hash values."
            ],
            chartGeneration: [
              "Render stacked bars for usage and overlay line for cost in ComposedChart.",
              "Render period average as ReferenceLine and active-point marker as ReferenceDot.",
              "Support interactive filtering by mode, time range, tag, and space scope.",
              "Tooltip must show per-series breakdown, total, cost, and vs-average delta."
            ]
          }}
        />
      </div>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-1 flex-wrap items-center gap-1.5 text-xs">
          <select
            className="min-w-[140px] rounded-md border border-shell-600 bg-shell-800 px-2.5 py-1.5 text-slate-200"
            value={mode}
            onChange={(event) => setMode(event.target.value as FilterMode)}
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
              {tagMeta.map((tag) => (
                <option key={tag.key} value={tag.key}>
                  {tag.label}
                </option>
              ))}
            </select>
          ) : (
            <div className="relative" ref={spacePanelRef}>
              <button
                type="button"
                onClick={() => (spacePanelOpen ? setSpacePanelOpen(false) : openSpacePanel())}
                className="min-w-[200px] rounded-md border border-shell-600 bg-shell-800 px-3 py-1.5 text-left text-xs text-slate-200"
              >
                {displayPath}
              </button>

              {spacePanelOpen ? (
                <div
                  className="absolute left-0 top-full z-50 mt-1 rounded-lg border border-shell-600 bg-shell-900 p-2 shadow-soft"
                  style={{ width: `${panelWidth}px` }}
                >
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
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {timeRangeOptions.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setTimeRange(option.key)}
              className={`rounded-md border px-2.5 py-1.5 ${timeRange === option.key ? "border-shell-500 bg-shell-700 text-white" : "border-shell-600 text-slate-500 hover:text-slate-300"}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-1 flex items-center justify-between text-[11px] text-slate-400">
        <span>Unit: {unitLabel}</span>
        <span>Unit: $</span>
      </div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            onMouseMove={(state) => {
              if (state.activeLabel !== undefined) {
                setActiveLabel(String(state.activeLabel));
              }
            }}
            onMouseLeave={() => setActiveLabel(null)}
          >
            <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
            <XAxis dataKey="label" stroke="#94a3b8" tick={{ fontSize: 10 }} />
            <YAxis yAxisId="usage" stroke="#94a3b8" tick={{ fontSize: 10 }} />
            <YAxis yAxisId="cost" orientation="right" stroke="#94a3b8" tick={{ fontSize: 10 }} />
            <Tooltip
              cursor={{ fill: "rgba(248, 250, 252, 0.08)" }}
              content={({ active, payload, label }) => {
                if (!active || !payload || payload.length === 0) {
                  return null;
                }

                const row = payload[0]?.payload as Record<string, number | string>;
                const total = Number(row.total ?? 0);
                const cost = Number(row.cost ?? 0);
                const vsAvg = periodAverage > 0 ? ((total - periodAverage) / periodAverage) * 100 : 0;
                const metricRows = [
                  { key: "cost", label: `Cost (S$): ${cost.toFixed(2)}`, swatch: "#fde047" },
                  { key: "avg", label: `Period Average: ${periodAverage.toFixed(1)}`, swatch: "#f472b6" },
                  ...activeSeries.map((series) => ({
                    key: `series-${series.key}`,
                    label: `${series.label}: ${Number(row[series.key] ?? 0).toFixed(1)}`,
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
                    <p className="mb-1 text-lg font-semibold text-white">{label}</p>
                    <div className="space-y-0.5">
                      {metricRows.map((item) => (
                        <div key={item.key} className="flex h-6 items-center gap-2">
                          {item.swatch === "transparent" ? null : (
                            <span
                              className="inline-block h-3 w-3 border border-white/60"
                              style={{ backgroundColor: item.swatch }}
                            />
                          )}
                          <span className={`${item.emphasis ? "font-semibold text-white" : ""} ${item.tone ?? ""}`}>{item.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              }}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
            {activeSeries.map((series) => (
              <Bar key={series.key} yAxisId="usage" dataKey={series.key} stackId="usage" name={series.label} fill={series.color}>
                {chartData.map((entry) => (
                  <Cell key={`${series.key}-${String(entry.label)}`} opacity={activeLabel === null || String(entry.label) === activeLabel ? 1 : 0.82} />
                ))}
              </Bar>
            ))}
            <Line yAxisId="cost" type="monotone" dataKey="cost" name="Cost ($)" stroke="#facc15" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "#facc15", stroke: "#fff", strokeWidth: 1 }} />
            <ReferenceLine yAxisId="usage" y={periodAverage} stroke="#f472b6" strokeDasharray="5 4" />
            {activeRow ? <ReferenceDot yAxisId="usage" x={String(activeRow.label)} y={periodAverage} r={5} fill="#f472b6" stroke="#ffffff" strokeWidth={1.5} /> : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
