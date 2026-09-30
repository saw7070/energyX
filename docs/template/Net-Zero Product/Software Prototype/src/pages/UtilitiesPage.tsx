import { Download, Link2, Move } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useEffect, useMemo, useRef, useState } from "react";
import { PageContainer } from "@/components/layout/PageContainer";
import { ChartCard } from "@/components/ui/ChartCard";
import { SectionTabs } from "@/components/ui/SectionTabs";
import { useAppContext } from "@/context/AppContext";
import { portfolioProjectRecords, type PortfolioProjectRecord } from "@/mock/portfolioProjects";

const tabs = ["Electricity", "Water", "Gas"];

interface UtilitiesPageProps {
  initialUtility?: (typeof tabs)[number];
  title?: string;
  subtitle?: string;
  breadcrumbs?: string[];
}

type HierarchyLevel = {
  name: string;
  rooms: string[];
};

type HierarchyBlock = {
  name: string;
  levels: HierarchyLevel[];
};

type PhaseValue = { A: number; B: number; C: number; total: number };

type MeterReading = {
  id: string;
  name: string;
  location: string;
  voltage: PhaseValue;
  current: PhaseValue;
  activePower: PhaseValue;
  reactivePower: PhaseValue;
  apparentPower: PhaseValue;
  powerFactor: PhaseValue;
  frequency: PhaseValue;
  activeEnergy: PhaseValue;
  reactiveEnergy: PhaseValue;
  maxDemand: PhaseValue;
};

type DiagramNode = {
  id: string;
  label: string;
  x: number;
  y: number;
  type: "source" | "meter" | "load";
};

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

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function phaseTriplet(seed: number, base: number, variance: number, offset: number): PhaseValue {
  const A = round(base + (seeded(seed, offset) - 0.5) * variance, 2);
  const B = round(base + (seeded(seed, offset + 1) - 0.5) * variance, 2);
  const C = round(base + (seeded(seed, offset + 2) - 0.5) * variance, 2);
  return { A, B, C, total: round(A + B + C, 2) };
}

function buildProjectHierarchy(project: PortfolioProjectRecord): HierarchyBlock[] {
  const seed = hashCode(project.id);
  const blockCount = seededInt(seed, 2, 5, 1);
  const blockBase = 500 + seededInt(seed, 1, 4, 2) * 2;
  return Array.from({ length: blockCount }, (_, blockIndex) => {
    const levelCount = seededInt(seed, 3, 7, 20 + blockIndex);
    const blockNumber = blockBase + blockIndex * 2;
    const levels = Array.from({ length: levelCount }, (_, levelIndex) => {
      const roomCount = seededInt(seed, 8, 15, 50 + blockIndex * 10 + levelIndex);
      return {
        name: `Level ${String(levelIndex + 1).padStart(2, "0")}`,
        rooms: Array.from({ length: roomCount }, (_, roomIndex) => `Room ${String(roomIndex + 1).padStart(2, "0")}`)
      };
    });
    return { name: `Block ${blockNumber}`, levels };
  });
}

function buildMeterReadings(seedKey: string, block: string, level: string, room: string): MeterReading[] {
  const seed = hashCode(`${seedKey}-${block}-${level}-${room}`);
  const meterCount = seededInt(seed, 4, 8, 1);
  return Array.from({ length: meterCount }, (_, index) => {
    const meterSeed = hashCode(`${seed}-${index}`);
    const locationLabel = room !== "all" ? `${block} ${level} ${room}` : level !== "all" ? `${block} ${level}` : block !== "all" ? block : "Main Incomer";
    return {
      id: `meter-${index + 1}`,
      name: `EM-${String(100 + index).padStart(3, "0")}`,
      location: locationLabel,
      voltage: phaseTriplet(meterSeed, 230, 8, 2),
      current: phaseTriplet(meterSeed, 62, 30, 8),
      activePower: phaseTriplet(meterSeed, 15, 8, 14),
      reactivePower: phaseTriplet(meterSeed, 4.5, 2.3, 20),
      apparentPower: phaseTriplet(meterSeed, 15.7, 8.4, 26),
      powerFactor: phaseTriplet(meterSeed, 0.95, 0.06, 32),
      frequency: phaseTriplet(meterSeed, 50, 0.12, 38),
      activeEnergy: phaseTriplet(meterSeed, 4800, 1400, 44),
      reactiveEnergy: phaseTriplet(meterSeed, 850, 360, 50),
      maxDemand: phaseTriplet(meterSeed, 21, 7, 56)
    };
  });
}

export function UtilitiesPage({ initialUtility, title, subtitle, breadcrumbs }: UtilitiesPageProps = {}) {
  const { selectedProjectId, setSelectedProjectId } = useAppContext();
  const resolvedInitialUtility = useMemo(() => {
    if (initialUtility && tabs.includes(initialUtility)) {
      return initialUtility;
    }
    return tabs[0];
  }, [initialUtility]);
  const [activeTab, setActiveTab] = useState(resolvedInitialUtility);
  const [selectedBlock, setSelectedBlock] = useState("all");
  const [selectedLevel, setSelectedLevel] = useState("all");
  const [selectedRoom, setSelectedRoom] = useState("all");
  const [selectedMeterId, setSelectedMeterId] = useState<string | null>(null);
  const [nodes, setNodes] = useState<DiagramNode[]>([
    { id: "source-main", label: "Main LV Panel", x: 80, y: 80, type: "source" },
    { id: "meter-1", label: "EM-101", x: 260, y: 60, type: "meter" },
    { id: "meter-2", label: "EM-102", x: 260, y: 170, type: "meter" },
    { id: "load-1", label: "AHU Load", x: 470, y: 50, type: "load" },
    { id: "load-2", label: "Lighting DB", x: 470, y: 130, type: "load" },
    { id: "load-3", label: "Socket DB", x: 470, y: 210, type: "load" }
  ]);
  const [connections, setConnections] = useState<Array<{ from: string; to: string }>>([
    { from: "source-main", to: "meter-1" },
    { from: "source-main", to: "meter-2" },
    { from: "meter-1", to: "load-1" },
    { from: "meter-1", to: "load-2" },
    { from: "meter-2", to: "load-3" }
  ]);
  const [pendingConnectionNodeId, setPendingConnectionNodeId] = useState<string | null>(null);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const schematicRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setActiveTab(resolvedInitialUtility);
  }, [resolvedInitialUtility]);

  useEffect(() => {
    const hasPortfolioProject = portfolioProjectRecords.some((project) => project.id === selectedProjectId);
    if (!hasPortfolioProject) {
      setSelectedProjectId(portfolioProjectRecords[0].id);
    }
  }, [selectedProjectId, setSelectedProjectId]);

  const selectedProject = useMemo(
    () => portfolioProjectRecords.find((project) => project.id === selectedProjectId) ?? portfolioProjectRecords[0],
    [selectedProjectId]
  );
  const hierarchy = useMemo(() => buildProjectHierarchy(selectedProject), [selectedProject]);
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

  useEffect(() => {
    setSelectedBlock("all");
    setSelectedLevel("all");
    setSelectedRoom("all");
  }, [selectedProjectId]);

  const meterReadings = useMemo(
    () => buildMeterReadings(selectedProject.id, selectedBlock, selectedLevel, selectedRoom),
    [selectedProject.id, selectedBlock, selectedLevel, selectedRoom]
  );
  const selectedMeter = useMemo(() => meterReadings.find((meter) => meter.id === selectedMeterId) ?? meterReadings[0], [meterReadings, selectedMeterId]);

  useEffect(() => {
    if (!selectedMeterId || !meterReadings.some((meter) => meter.id === selectedMeterId)) {
      setSelectedMeterId(meterReadings[0]?.id ?? null);
    }
  }, [meterReadings, selectedMeterId]);

  const consumptionStats = useMemo(() => {
    const totalActive = meterReadings.reduce((sum, meter) => sum + meter.activeEnergy.total, 0);
    const totalReactive = meterReadings.reduce((sum, meter) => sum + meter.reactiveEnergy.total, 0);
    const peakDemand = Math.max(...meterReadings.map((meter) => meter.maxDemand.total));
    const averagePf = meterReadings.reduce((sum, meter) => sum + meter.powerFactor.total / 3, 0) / Math.max(meterReadings.length, 1);
    return {
      totalActive: Math.round(totalActive),
      totalReactive: Math.round(totalReactive),
      peakDemand: round(peakDemand, 1),
      averagePf: round(averagePf, 3)
    };
  }, [meterReadings]);

  const trendData = useMemo(
    () =>
      ["00", "04", "08", "12", "16", "20"].map((slot, index) => ({
        name: slot,
        electricity: round((consumptionStats.peakDemand * (0.65 + seeded(hashCode(`${selectedProject.id}-${slot}`), index) * 0.45)) / 2, 2)
      })),
    [consumptionStats.peakDemand, selectedProject.id]
  );

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      if (!draggingNodeId || !schematicRef.current) {
        return;
      }
      const rect = schematicRef.current.getBoundingClientRect();
      const nextX = event.clientX - rect.left - dragOffset.x;
      const nextY = event.clientY - rect.top - dragOffset.y;
      setNodes((prev) =>
        prev.map((node) =>
          node.id === draggingNodeId
            ? { ...node, x: Math.max(20, Math.min(nextX, rect.width - 120)), y: Math.max(20, Math.min(nextY, rect.height - 60)) }
            : node
        )
      );
    }
    function handlePointerUp() {
      setDraggingNodeId(null);
    }
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [dragOffset.x, dragOffset.y, draggingNodeId]);

  const parameterRows = selectedMeter
    ? [
        { label: "Voltage (V)", value: selectedMeter.voltage },
        { label: "Current (A)", value: selectedMeter.current },
        { label: "Active Power (kW)", value: selectedMeter.activePower },
        { label: "Reactive Power (kVAR)", value: selectedMeter.reactivePower },
        { label: "Apparent Power (kVA)", value: selectedMeter.apparentPower },
        { label: "Power Factor", value: selectedMeter.powerFactor },
        { label: "Frequency (Hz)", value: selectedMeter.frequency },
        { label: "Active Energy (kWh)", value: selectedMeter.activeEnergy },
        { label: "Reactive Energy (kVARh)", value: selectedMeter.reactiveEnergy },
        { label: "Max Demand (kW)", value: selectedMeter.maxDemand }
      ]
    : [];

  return (
    <PageContainer
      title={title ?? "Utilities"}
      subtitle={subtitle ?? "Consumption baseline, device parameters, and utility-level trend scaffolding."}
      breadcrumbs={breadcrumbs ?? ["Dashboard", "Utilities"]}
      actions={
        <button className="inline-flex items-center gap-2 rounded-md border border-shell-600 bg-shell-800 px-3 py-2 text-sm text-slate-200 hover:bg-shell-700">
          <Download className="h-4 w-4" />
          Export
        </button>
      }
    >
      <SectionTabs tabs={tabs} active={activeTab} onChange={setActiveTab} />

      {activeTab !== "Electricity" ? (
        <div className="panel p-5 text-sm text-slate-300">{activeTab} will follow this same structure once electricity layout is confirmed.</div>
      ) : (
        <div className="space-y-4">
          <section className="grid gap-3 md:grid-cols-[220px_220px_220px_1fr]">
            <select
              className="rounded-lg border border-shell-600 bg-shell-900 px-3 py-2 text-sm text-slate-100"
              value={selectedProjectId}
              onChange={(event) => setSelectedProjectId(event.target.value)}
            >
              {portfolioProjectRecords.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <select
              className="rounded-lg border border-shell-600 bg-shell-900 px-3 py-2 text-sm text-slate-100"
              value={selectedBlock}
              onChange={(event) => {
                setSelectedBlock(event.target.value);
                setSelectedLevel("all");
                setSelectedRoom("all");
              }}
            >
              <option value="all">All Blocks</option>
              {blockOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <select
              className="rounded-lg border border-shell-600 bg-shell-900 px-3 py-2 text-sm text-slate-100"
              value={selectedLevel}
              onChange={(event) => {
                setSelectedLevel(event.target.value);
                setSelectedRoom("all");
              }}
            >
              <option value="all">All Levels</option>
              {levelOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <select className="rounded-lg border border-shell-600 bg-shell-900 px-3 py-2 text-sm text-slate-100" value={selectedRoom} onChange={(event) => setSelectedRoom(event.target.value)}>
              <option value="all">All Rooms</option>
              {roomOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </section>

          <section className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
            <ChartCard title="Electricity Consumption" subtitle={`${selectedProject.name} · ${selectedMeter?.location ?? "Main Incomer"}`}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData}>
                  <defs>
                    <linearGradient id="utilityGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="#60a5fa" stopOpacity={0.08} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                  <XAxis dataKey="name" stroke="#94a3b8" />
                  <YAxis stroke="#94a3b8" />
                  <Tooltip />
                  <Area type="monotone" dataKey="electricity" stroke="#60a5fa" fill="url(#utilityGradient)" />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <div className="panel p-4">
                <p className="text-xs text-slate-400">Active Energy</p>
                <p className="mt-1 text-3xl font-semibold text-white">{consumptionStats.totalActive.toLocaleString()} kWh</p>
              </div>
              <div className="panel p-4">
                <p className="text-xs text-slate-400">Reactive Energy</p>
                <p className="mt-1 text-3xl font-semibold text-white">{consumptionStats.totalReactive.toLocaleString()} kVARh</p>
              </div>
              <div className="panel p-4">
                <p className="text-xs text-slate-400">Max Demand</p>
                <p className="mt-1 text-3xl font-semibold text-white">{consumptionStats.peakDemand.toFixed(1)} kW</p>
              </div>
              <div className="panel p-4">
                <p className="text-xs text-slate-400">Average PF</p>
                <p className="mt-1 text-3xl font-semibold text-white">{consumptionStats.averagePf.toFixed(3)}</p>
              </div>
            </div>
          </section>

          <section className="panel p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white">Meter Parameters</h3>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Meter</span>
                <select
                  className="rounded-md border border-shell-600 bg-shell-900 px-2 py-1 text-sm text-slate-100"
                  value={selectedMeter?.id ?? ""}
                  onChange={(event) => setSelectedMeterId(event.target.value)}
                >
                  {meterReadings.map((meter) => (
                    <option key={meter.id} value={meter.id}>
                      {meter.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-shell-700 text-xs text-slate-400">
                  <tr>
                    <th className="px-3 py-2 text-left">Parameter</th>
                    <th className="px-3 py-2 text-right">Phase A</th>
                    <th className="px-3 py-2 text-right">Phase B</th>
                    <th className="px-3 py-2 text-right">Phase C</th>
                    <th className="px-3 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {parameterRows.map((row) => (
                    <tr key={row.label} className="border-t border-shell-600 text-slate-200">
                      <td className="px-3 py-2">{row.label}</td>
                      <td className="px-3 py-2 text-right">{row.value.A.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right">{row.value.B.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right">{row.value.C.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-white">{row.value.total.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-white">Electrical Single-Line Diagram</h3>
                <p className="text-xs text-slate-400">Drag devices to reposition. Click two devices to create a connection.</p>
              </div>
              <div className="inline-flex items-center gap-2 text-xs text-slate-400">
                <Move className="h-3.5 w-3.5" />
                Drag
                <Link2 className="ml-2 h-3.5 w-3.5" />
                Connect
              </div>
            </div>

            <div ref={schematicRef} className="relative h-[320px] overflow-hidden rounded-lg border border-shell-600 bg-shell-900">
              <svg className="absolute inset-0 h-full w-full">
                {connections.map((connection, index) => {
                  const fromNode = nodes.find((node) => node.id === connection.from);
                  const toNode = nodes.find((node) => node.id === connection.to);
                  if (!fromNode || !toNode) {
                    return null;
                  }
                  return (
                    <line
                      key={`${connection.from}-${connection.to}-${index}`}
                      x1={fromNode.x + 56}
                      y1={fromNode.y + 18}
                      x2={toNode.x + 56}
                      y2={toNode.y + 18}
                      stroke="#38bdf8"
                      strokeWidth="2"
                      strokeDasharray="6 4"
                    />
                  );
                })}
              </svg>

              {nodes.map((node) => (
                <button
                  key={node.id}
                  type="button"
                  onPointerDown={(event) => {
                    if (!schematicRef.current) {
                      return;
                    }
                    const rect = schematicRef.current.getBoundingClientRect();
                    setDraggingNodeId(node.id);
                    setDragOffset({ x: event.clientX - rect.left - node.x, y: event.clientY - rect.top - node.y });
                  }}
                  onClick={() => {
                    if (!pendingConnectionNodeId) {
                      setPendingConnectionNodeId(node.id);
                      return;
                    }
                    if (pendingConnectionNodeId === node.id) {
                      setPendingConnectionNodeId(null);
                      return;
                    }
                    const exists = connections.some(
                      (connection) =>
                        (connection.from === pendingConnectionNodeId && connection.to === node.id) ||
                        (connection.from === node.id && connection.to === pendingConnectionNodeId)
                    );
                    if (!exists) {
                      setConnections((prev) => [...prev, { from: pendingConnectionNodeId, to: node.id }]);
                    }
                    setPendingConnectionNodeId(null);
                  }}
                  className={`absolute w-28 rounded-md border px-2 py-2 text-center text-xs ${
                    node.type === "source"
                      ? "border-emerald-500 bg-emerald-500/15 text-emerald-200"
                      : node.type === "meter"
                        ? "border-sky-500 bg-sky-500/15 text-sky-200"
                        : "border-amber-500 bg-amber-500/15 text-amber-200"
                  } ${pendingConnectionNodeId === node.id ? "ring-2 ring-rose-400" : ""}`}
                  style={{ left: node.x, top: node.y }}
                >
                  {node.label}
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </PageContainer>
  );
}
