import { useEffect, useMemo, useRef, useState } from "react";
import { Area, Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SpaceNode, hashCode } from "@/components/analysis/spaceHierarchy";
import { RequirementGuideTitle } from "@/components/analysis/RequirementGuide";

type DayType = "weekday" | "weekend" | "holiday";
type TrendRow = {
  dateLabel: string;
  shortLabel: string;
  dayType: DayType;
  total: number;
  expected: number;
  threshold: number;
  perCapitaActual: number;
  perCapitaExpected: number;
  deltaPct: number;
  anomaly: boolean;
};
type DetailViewMode = "overlay" | "selected" | "average";
type CircuitKey = "Air Conditioning" | "Plug Load" | "Lighting" | "Heater" | "Kitchen";
const CIRCUITS: CircuitKey[] = ["Air Conditioning", "Plug Load", "Lighting", "Heater", "Kitchen"];
const CIRCUIT_COLORS: Record<CircuitKey, string> = {
  "Air Conditioning": "#5B8BCF",
  "Plug Load": "#9A8DBF",
  Lighting: "#4F9B86",
  Heater: "#B35A73",
  Kitchen: "#C68656"
};

interface DailyTrendAnomalyAnalysisSectionProps {
  projectId: string;
  utilityKey: string;
  dailyTotals30d: Array<{ label: string; total: number }>;
  spaceRoot: SpaceNode;
  unitLabel: string;
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

function countOccupantsForNode(projectId: string, root: SpaceNode, path: string[]) {
  const node = path.length === 0 ? root : getNodeByPath(root, path);
  if (!node) {
    return 0;
  }

  function traverse(current: SpaceNode, blockName: string, levelName: string) {
    if (!current.children || current.children.length === 0) {
      const seed = hashCode(`${projectId}-${blockName}-${levelName}-${current.name}`);
      return 2 + (seed % 7);
    }
    if (current.name.startsWith("Block")) {
      return current.children.reduce((sum, child) => sum + traverse(child, current.name, child.name), 0);
    }
    if (current.name.startsWith("Level")) {
      return current.children.reduce((sum, child) => sum + traverse(child, blockName, current.name), 0);
    }
    return current.children.reduce((sum, child) => sum + traverse(child, blockName, levelName), 0);
  }

  if (path.length === 0) {
    return (root.children ?? []).reduce((sum, block) => sum + traverse(block, block.name, ""), 0);
  }
  if (path.length === 1) {
    return traverse(node, path[0], "");
  }
  if (path.length === 2) {
    return traverse(node, path[0], path[1]);
  }
  const seed = hashCode(`${projectId}-${path[0]}-${path[1]}-${path[2]}`);
  return 2 + (seed % 7);
}

export function DailyTrendAnomalyAnalysisSection({
  projectId,
  utilityKey,
  dailyTotals30d,
  spaceRoot,
  unitLabel
}: DailyTrendAnomalyAnalysisSectionProps) {
  const [selectedSpacePath, setSelectedSpacePath] = useState<string[]>([]);
  const [hoverSpacePath, setHoverSpacePath] = useState<string[]>([]);
  const [spacePanelOpen, setSpacePanelOpen] = useState(false);
  const [selectedAnomalyRow, setSelectedAnomalyRow] = useState<TrendRow | null>(null);
  const [detailMode, setDetailMode] = useState<DetailViewMode>("overlay");
  const [selectedCircuit, setSelectedCircuit] = useState<CircuitKey>("Air Conditioning");
  const spacePanelRef = useRef<HTMLDivElement | null>(null);

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

  const displayPath = selectedSpacePath.length > 0 ? selectedSpacePath.join(" / ") : "All spaces";
  const spaceColumns = useMemo(
    () => buildColumns(spaceRoot, hoverSpacePath, selectedSpacePath),
    [hoverSpacePath, selectedSpacePath, spaceRoot]
  );
  const panelWidth = useMemo(() => {
    const width = spaceColumns.length * 168 + 24;
    return Math.min(Math.max(width, 190), 760);
  }, [spaceColumns.length]);

  const totalProjectOccupants = useMemo(() => countOccupantsForNode(projectId, spaceRoot, []), [projectId, spaceRoot]);
  const selectedScopeOccupants = useMemo(
    () => countOccupantsForNode(projectId, spaceRoot, selectedSpacePath),
    [projectId, selectedSpacePath, spaceRoot]
  );
  const occupantRatio = totalProjectOccupants > 0 ? selectedScopeOccupants / totalProjectOccupants : 1;

  const trendRows = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - dailyTotals30d.length + 1);
    const holidayCount = Math.min(2, dailyTotals30d.length);

    const weekdayIndices = Array.from({ length: dailyTotals30d.length }, (_, index) => {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + index);
      return { index, day: d.getDay() };
    })
      .filter((item) => item.day !== 0 && item.day !== 6)
      .map((item) => item.index);

    const holidayIndices = weekdayIndices
      .slice()
      .sort((a, b) => hashCode(`${projectId}-${utilityKey}-holiday-${a}`) - hashCode(`${projectId}-${utilityKey}-holiday-${b}`))
      .slice(0, holidayCount);
    const holidaySet = new Set(holidayIndices);

    const rawRows = dailyTotals30d.map((item, index) => {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + index);
      const day = date.getDay();
      const type: DayType = holidaySet.has(index) ? "holiday" : day === 0 || day === 6 ? "weekend" : "weekday";
      const scopeVariance = 0.93 + (hashCode(`${projectId}-${utilityKey}-${displayPath}-${index}`) % 15) / 100;
      const total = Math.max(1, item.total * occupantRatio * scopeVariance);
      const perCapita = selectedScopeOccupants > 0 ? total / selectedScopeOccupants : 0;
      return {
        date,
        dateLabel: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
        shortLabel: `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`,
        dayType: type,
        total,
        perCapita
      };
    });

    const perTypeHistory = {
      weekday: [] as number[],
      weekend: [] as number[],
      holiday: [] as number[]
    };

    return rawRows.map((row) => {
      const history = perTypeHistory[row.dayType];
      const baselinePerCapita =
        history.length > 0
          ? history.reduce((sum, value) => sum + value, 0) / history.length
          : rawRows.filter((item) => item.dayType === row.dayType).reduce((sum, item, _, arr) => sum + item.perCapita / arr.length, 0);
      const expected = baselinePerCapita * selectedScopeOccupants;
      const threshold = expected * 1.15;
      const anomaly = row.total > threshold;
      const deltaPct = expected > 0 ? ((row.total - expected) / expected) * 100 : 0;
      history.push(row.perCapita);

      return {
        dateLabel: row.dateLabel,
        shortLabel: row.shortLabel,
        dayType: row.dayType,
        total: Math.round(row.total * 10) / 10,
        expected: Math.round(expected * 10) / 10,
        threshold: Math.round(threshold * 10) / 10,
        perCapitaActual: Math.round(row.perCapita * 100) / 100,
        perCapitaExpected: Math.round(baselinePerCapita * 100) / 100,
        deltaPct,
        anomaly
      } satisfies TrendRow;
    });
  }, [dailyTotals30d, displayPath, occupantRatio, projectId, selectedScopeOccupants, utilityKey]);

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

  const anomalyCount = trendRows.filter((item) => item.anomaly).length;
  const anomalyRows = trendRows.filter((item) => item.anomaly);
  const anomalyDetailData = useMemo(() => {
    if (!selectedAnomalyRow) {
      return null;
    }

    const dayType = selectedAnomalyRow.dayType;
    const referenceLabel = dayType === "weekend" ? "Weekend average" : dayType === "holiday" ? "Holiday average" : "Weekday average";
    const selectedSeed = hashCode(`${projectId}-${utilityKey}-${selectedAnomalyRow.dateLabel}-selected`);
    const referenceSeed = hashCode(`${projectId}-${utilityKey}-${selectedAnomalyRow.dateLabel}-reference`);
    const baseShares: Record<CircuitKey, number> = {
      "Air Conditioning": 0.42,
      "Plug Load": 0.22,
      Lighting: 0.14,
      Heater: 0.1,
      Kitchen: 0.12
    };

    function inWindow(hour: number, start: number, end: number) {
      if (start <= end) {
        return hour >= start && hour < end;
      }
      return hour >= start || hour < end;
    }

    function dayTypeFactor(targetDayType: DayType, hour: number) {
      if (targetDayType === "weekday") {
        return inWindow(hour, 8, 18) ? 0.66 : inWindow(hour, 18, 24) ? 1.24 : inWindow(hour, 5, 8) ? 1.1 : 0.84;
      }
      if (targetDayType === "weekend") {
        return inWindow(hour, 9, 18) ? 1.14 : inWindow(hour, 18, 24) ? 1.2 : 0.92;
      }
      return inWindow(hour, 8, 23) ? 1.28 : 1.02;
    }

    function circuitHourFactor(circuit: CircuitKey, hour: number, targetDayType: DayType) {
      if (circuit === "Air Conditioning") {
        return inWindow(hour, 20, 2) ? 1.54 : inWindow(hour, 18, 20) ? 1.24 : 0.78;
      }
      if (circuit === "Plug Load") {
        const weekendDayBoost = targetDayType !== "weekday" && inWindow(hour, 9, 18) ? 1.28 : 1;
        return (inWindow(hour, 19, 24) ? 1.32 : inWindow(hour, 0, 6) ? 0.72 : 0.84) * weekendDayBoost;
      }
      if (circuit === "Lighting") {
        return inWindow(hour, 5, 8) || inWindow(hour, 18, 24) ? 1.16 : 0.44;
      }
      if (circuit === "Heater") {
        return inWindow(hour, 5, 8) || inWindow(hour, 20, 23) ? 1.88 : 0.1;
      }
      return inWindow(hour, 6, 8) || inWindow(hour, 12, 14) || inWindow(hour, 18, 21) ? 1.3 : 0.2;
    }

    function buildHourlyByCircuit(total: number, targetDayType: DayType, seed: number, spikeBias = 1) {
      const perHour: Record<CircuitKey, number[]> = {
        "Air Conditioning": [],
        "Plug Load": [],
        Lighting: [],
        Heater: [],
        Kitchen: []
      };

      for (let hour = 0; hour < 24; hour += 1) {
        const dayFactor = dayTypeFactor(targetDayType, hour) * spikeBias;
        const weightSum = CIRCUITS.reduce((sum, circuit) => sum + baseShares[circuit] * circuitHourFactor(circuit, hour, targetDayType), 0);
        CIRCUITS.forEach((circuit, index) => {
          const variance = 0.92 + (hashCode(`${seed}-${circuit}-${hour}-${index}`) % 16) / 100;
          const weight = baseShares[circuit] * circuitHourFactor(circuit, hour, targetDayType);
          const value = weightSum > 0 ? ((total / 24) * (weight / weightSum) * dayFactor * variance) : 0;
          perHour[circuit].push(value);
        });
      }

      return perHour;
    }

    const referenceByCircuit = buildHourlyByCircuit(selectedAnomalyRow.expected, dayType, referenceSeed, 1);
    const selectedByCircuit: Record<CircuitKey, number[]> = {
      "Air Conditioning": [...referenceByCircuit["Air Conditioning"]],
      "Plug Load": [...referenceByCircuit["Plug Load"]],
      Lighting: [...referenceByCircuit.Lighting],
      Heater: [...referenceByCircuit.Heater],
      Kitchen: [...referenceByCircuit.Kitchen]
    };

    const focusCircuit = CIRCUITS[hashCode(`${selectedSeed}-focus-circuit`) % CIRCUITS.length];
    const secondaryCircuit = CIRCUITS[(CIRCUITS.indexOf(focusCircuit) + 1) % CIRCUITS.length];
    const focusStart = 15 + (hashCode(`${selectedSeed}-focus-start`) % 6); // 15:00 - 20:00
    const focusLen = 3 + (hashCode(`${selectedSeed}-focus-len`) % 3); // 3-5h
    const focusHours = Array.from({ length: focusLen }, (_, idx) => (focusStart + idx) % 24);

    for (let hour = 0; hour < 24; hour += 1) {
      CIRCUITS.forEach((circuit) => {
        const localVariance = 0.95 + (hashCode(`${selectedSeed}-${circuit}-local-${hour}`) % 11) / 100; // 0.95-1.05
        selectedByCircuit[circuit][hour] *= localVariance;
      });

      if (focusHours.includes(hour)) {
        selectedByCircuit[focusCircuit][hour] *= 1.35;
        selectedByCircuit[secondaryCircuit][hour] *= 1.16;
      } else if (hour <= 6) {
        CIRCUITS.forEach((circuit) => {
          selectedByCircuit[circuit][hour] *= 0.94;
        });
      }
    }

    const selectedSum = CIRCUITS.reduce((sum, circuit) => sum + selectedByCircuit[circuit].reduce((s, v) => s + v, 0), 0);
    const targetSum = Math.max(selectedAnomalyRow.total, selectedAnomalyRow.expected * 1.16);
    const normalizeFactor = selectedSum > 0 ? targetSum / selectedSum : 1;
    CIRCUITS.forEach((circuit) => {
      selectedByCircuit[circuit] = selectedByCircuit[circuit].map((value) => value * normalizeFactor);
    });

    const overlayData = Array.from({ length: 24 }, (_, hour) => {
      const selectedTotal = CIRCUITS.reduce((sum, circuit) => sum + selectedByCircuit[circuit][hour], 0);
      const referenceTotal = CIRCUITS.reduce((sum, circuit) => sum + referenceByCircuit[circuit][hour], 0);
      const row: Record<string, number | string> = {
        hour: `${String(hour).padStart(2, "0")}:00`,
        selectedTotal,
        referenceTotal
      };
      CIRCUITS.forEach((circuit) => {
        row[`${circuit}-selected`] = selectedByCircuit[circuit][hour];
        row[`${circuit}-reference`] = referenceByCircuit[circuit][hour];
      });
      return row;
    });

    const heatmapRows = [
      {
        name: referenceLabel,
        values: referenceByCircuit[selectedCircuit]
      },
      {
        name: selectedAnomalyRow.dateLabel,
        values: selectedByCircuit[selectedCircuit]
      }
    ];

    const circuitReferenceTotal = referenceByCircuit[selectedCircuit].reduce((sum, value) => sum + value, 0);
    const circuitSelectedTotal = selectedByCircuit[selectedCircuit].reduce((sum, value) => sum + value, 0);
    const circuitDeltaPct = circuitReferenceTotal > 0 ? ((circuitSelectedTotal - circuitReferenceTotal) / circuitReferenceTotal) * 100 : 0;
    const over30Count = selectedByCircuit[selectedCircuit].filter((value, index) => {
      const baseline = referenceByCircuit[selectedCircuit][index];
      return baseline > 0 && (value - baseline) / baseline > 0.3;
    }).length;

    return {
      referenceLabel,
      overlayData,
      heatmapRows,
      circuitDeltaPct,
      over30Count,
      circuitReferenceTotal,
      circuitSelectedTotal,
      focusCircuit,
      focusWindowLabel: `${String(focusHours[0]).padStart(2, "0")}:00-${String((focusHours[focusHours.length - 1] + 1) % 24).padStart(2, "0")}:00`
    };
  }, [projectId, selectedAnomalyRow, selectedCircuit, utilityKey]);

  function heatCellColor(reference: number, selected: number, isSelectedRow: boolean) {
    if (!isSelectedRow) {
      return "rgba(148, 163, 184, 0.18)";
    }
    if (reference <= 0) {
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

  return (
    <section className="panel p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <RequirementGuideTitle
            title="Daily Total Trend"
            className="text-sm font-semibold text-white"
            content={{
              title: "Daily Total Trend Requirements",
              summary: "Track 30-day consumption against expected baseline and anomaly threshold.",
              dataAcquisition: [
                "Use dailyTotals30d and selected scope occupant count from hierarchy.",
                "Classify each day as weekday/weekend/holiday with deterministic holiday selection.",
                "Compute expected baseline by historical per-capita average for same day type.",
                "Flag anomalies when actual exceeds expected by 15%."
              ],
              chartGeneration: [
                "Render ComposedChart with bar (actual), line (expected), and dashed line (threshold).",
                "Mark anomalies using ReferenceDot.",
                "Keep chart responsive to space filter selection."
              ]
            }}
          />
          <p className="text-xs text-slate-400">
            30-day daily consumption with anomaly rule: actual &gt; expected baseline by 15%.
          </p>
        </div>
        <div className="text-xs text-slate-300">
          Scope Occupants: <span className="font-semibold text-white">{selectedScopeOccupants}</span>
        </div>
      </div>

      <div className="mb-3 rounded-md border border-shell-600 bg-shell-900 p-2">
        <p className="mb-2 text-[11px] text-slate-400">Space Filter</p>
        <div className="relative" ref={spacePanelRef}>
          <button
            type="button"
            onClick={() => (spacePanelOpen ? setSpacePanelOpen(false) : openSpacePanel())}
            className="w-full rounded border border-shell-600 bg-shell-800 px-3 py-1.5 text-left text-xs text-slate-200"
          >
            {displayPath}
          </button>
          {spacePanelOpen ? (
            <div className="absolute left-0 top-full z-50 mt-1 rounded-lg border border-shell-600 bg-shell-900 p-2 shadow-soft" style={{ width: `${panelWidth}px` }}>
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

      <div className="mb-4 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={trendRows}>
            <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
            <XAxis dataKey="shortLabel" stroke="#94a3b8" tick={{ fontSize: 10 }} />
            <YAxis stroke="#94a3b8" tick={{ fontSize: 10 }} />
            <Tooltip
              formatter={(value: number, name: string) => [`${Number(value).toFixed(1)} ${unitLabel}`, name]}
              labelFormatter={(label, payload) =>
                payload && payload[0] && "payload" in payload[0] ? (payload[0].payload as TrendRow).dateLabel : label
              }
              contentStyle={{ backgroundColor: "#020617", border: "1px solid #334155", borderRadius: 8 }}
              labelStyle={{ color: "#f8fafc" }}
              itemStyle={{ color: "#e2e8f0" }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="total" fill="#5B8BCF" name="Daily Total" radius={[4, 4, 0, 0]} />
            <Line dataKey="expected" stroke="#f59e0b" strokeWidth={2} dot={false} name="Expected Baseline" />
            <Line dataKey="threshold" stroke="#ef4444" strokeDasharray="4 4" strokeWidth={1.8} dot={false} name="Anomaly Threshold (115%)" />
            {trendRows
              .filter((item) => item.anomaly)
              .map((item) => (
                <ReferenceDot key={`anom-${item.dateLabel}`} x={item.shortLabel} y={item.total} r={4} fill="#ef4444" stroke="#fff" strokeWidth={1.2} />
              ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="mb-2 text-xs text-slate-300">
        Detected anomalies: <span className="font-semibold text-rose-300">{anomalyCount}</span> / 30 days
      </div>

      <div className="rounded-md border border-shell-600">
        <div className="border-b border-shell-600 bg-shell-800 px-3 py-2 text-xs font-medium text-slate-300">
          <RequirementGuideTitle
            title="Detected Anomaly List"
            className="text-xs font-medium text-slate-300"
            content={{
              title: "Detected Anomaly List Requirements",
              summary: "List only anomaly days and expose deep-dive on row click.",
              dataAcquisition: [
                "Filter trendRows by anomaly flag.",
                "Show day type, actual, expected, threshold, and per-capita metrics."
              ],
              chartGeneration: [
                "Render compact table with sortable-style numeric columns.",
                "Open anomaly detail modal when user clicks a row.",
                "Show empty state when no anomaly exists."
              ]
            }}
          />
        </div>
        <div className="max-h-72 overflow-y-auto">
          {anomalyRows.length === 0 ? (
            <div className="px-3 py-4 text-xs text-slate-400">No anomalies detected for the current scope.</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-shell-700 text-slate-300">
                <tr>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-right">Daily Total</th>
                  <th className="px-3 py-2 text-right">Expected</th>
                  <th className="px-3 py-2 text-right">Threshold</th>
                  <th className="px-3 py-2 text-right">Per Capita (Act / Exp)</th>
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
                      setSelectedCircuit("Air Conditioning");
                    }}
                  >
                    <td className="px-3 py-2">{row.dateLabel}</td>
                    <td className="px-3 py-2 capitalize">{row.dayType}</td>
                    <td className="px-3 py-2 text-right">{row.total.toFixed(1)}</td>
                    <td className="px-3 py-2 text-right">{row.expected.toFixed(1)}</td>
                    <td className="px-3 py-2 text-right">{row.threshold.toFixed(1)}</td>
                    <td className="px-3 py-2 text-right">
                      {row.perCapitaActual.toFixed(2)} / {row.perCapitaExpected.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right text-rose-300">
                      +{row.deltaPct.toFixed(1)}%
                    </td>
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

      {selectedAnomalyRow && anomalyDetailData ? (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 px-4">
          <div className="max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-lg border border-shell-600 bg-shell-950 p-4 shadow-soft">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <RequirementGuideTitle
                  title={`Anomaly Detail — ${selectedAnomalyRow.dateLabel}`}
                  className="text-sm font-semibold text-white"
                  content={{
                    title: "Anomaly Detail Requirements",
                    summary: "Deep dive should explain which circuits and hours drive the anomaly.",
                    dataAcquisition: [
                      "Generate selected-day and reference-day hourly circuit series from deterministic seeded logic.",
                      "Apply focused spike window and focused circuit amplification for realistic anomalies.",
                      "Recompute totals and delta statistics for selected circuit."
                    ],
                    chartGeneration: [
                      "Support overlay and stacked modes for selected day vs reference average.",
                      "Render circuit selector and 24-hour heatmap with delta-aware color encoding.",
                      "Provide numeric explanation for circuit totals and hour count over +30%."
                    ]
                  }}
                />
                <p className="text-xs text-slate-400">
                  {selectedAnomalyRow.deltaPct >= 0 ? "+" : ""}
                  {selectedAnomalyRow.deltaPct.toFixed(1)}% vs {anomalyDetailData.referenceLabel.toLowerCase()}
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

            <section className="mb-4 rounded-md border border-shell-700 bg-shell-900 p-3">
              <h4 className="mb-2 text-xs font-semibold text-emerald-300">
                Stacked chart: {selectedAnomalyRow.shortLabel} vs {anomalyDetailData.referenceLabel}
              </h4>
              <div className="mb-2 inline-flex rounded border border-shell-600 bg-shell-800 p-1 text-xs">
                {([
                  { key: "overlay", label: "Overlay comparison" },
                  { key: "selected", label: `${selectedAnomalyRow.shortLabel} (spike)` },
                  { key: "average", label: anomalyDetailData.referenceLabel }
                ] as Array<{ key: DetailViewMode; label: string }>).map((item) => (
                  <button
                    key={item.key}
                    className={`rounded px-2 py-1 ${detailMode === item.key ? "bg-emerald-700 text-white" : "text-slate-300"}`}
                    onClick={() => setDetailMode(item.key)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <p className="mb-2 text-[11px] text-slate-400">
                Focus anomaly window: <span className="text-rose-300">{anomalyDetailData.focusWindowLabel}</span> | Primary circuit:{" "}
                <span className="text-rose-300">{anomalyDetailData.focusCircuit}</span>
              </p>

              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={anomalyDetailData.overlayData}>
                    <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                    <XAxis dataKey="hour" stroke="#94a3b8" tick={{ fontSize: 10 }} interval={1} />
                    <YAxis stroke="#94a3b8" tick={{ fontSize: 10 }} />
                    <Tooltip
                      formatter={(value: number, key: string) => [`${value.toFixed(2)} ${unitLabel}`, key]}
                      contentStyle={{ backgroundColor: "#020617", border: "1px solid #334155", borderRadius: 8 }}
                      labelStyle={{ color: "#f8fafc" }}
                      itemStyle={{ color: "#e2e8f0" }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {detailMode === "overlay" ? (
                      <>
                        <Line type="monotone" dataKey="selectedTotal" name={`${selectedAnomalyRow.shortLabel} hourly total`} stroke="#ef4444" strokeWidth={2.2} dot={false} />
                        <Line type="monotone" dataKey="referenceTotal" name={`${anomalyDetailData.referenceLabel} hourly total`} stroke="#84a98c" strokeDasharray="4 4" strokeWidth={1.8} dot={false} />
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
                Red line = selected day hourly total. Dashed line = {anomalyDetailData.referenceLabel.toLowerCase()}. Use mode buttons to inspect circuit-level curves.
              </p>
            </section>

            <section className="rounded-md border border-shell-700 bg-shell-900 p-3">
              <RequirementGuideTitle
                title={`Heatmap: ${anomalyDetailData.referenceLabel} vs ${selectedAnomalyRow.shortLabel} spike`}
                className="mb-1 text-xs font-semibold text-emerald-300"
                content={{
                  title: "Anomaly Heatmap Requirements",
                  summary: "Heatmap should highlight the exact hours and circuits responsible for anomaly deviation.",
                  dataAcquisition: [
                    "Use selected circuit hourly arrays from reference and anomaly day.",
                    "Calculate per-hour delta ratio against reference."
                  ],
                  chartGeneration: [
                    "Render two-row hourly matrix (reference vs selected day).",
                    "Apply conditional colors: strong red for >30% increase, orange for moderate increase, green for reductions.",
                    "Keep hour axis fixed at 24 columns for consistent diagnosis."
                  ]
                }}
              />
              <p className="mb-2 text-xs text-slate-400">Red cells indicate &gt;30% above reference at that hour.</p>
              <div className="mb-2 flex items-center gap-2 text-xs text-slate-300">
                <span>Circuit:</span>
                <div className="flex flex-wrap gap-1">
                  {CIRCUITS.map((circuit) => (
                    <button
                      key={`circuit-${circuit}`}
                      className={`rounded-full border px-2 py-0.5 ${
                        selectedCircuit === circuit ? "border-emerald-500 bg-emerald-700/30 text-emerald-200" : "border-shell-600 text-slate-300"
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
                    <div className={`pr-2 ${rowIndex === 1 ? "font-semibold text-rose-300" : "text-slate-300"}`}>{row.name}</div>
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
                {selectedCircuit}: {anomalyDetailData.referenceLabel} = {anomalyDetailData.circuitReferenceTotal.toFixed(2)} {unitLabel} |{" "}
                {selectedAnomalyRow.shortLabel} = {anomalyDetailData.circuitSelectedTotal.toFixed(2)} {unitLabel} (
                {anomalyDetailData.circuitDeltaPct >= 0 ? "+" : ""}
                {anomalyDetailData.circuitDeltaPct.toFixed(0)}%) | {anomalyDetailData.over30Count} hour(s) above +30%.
              </p>
            </section>
          </div>
        </div>
      ) : null}
    </section>
  );
}
