import { useEffect, useMemo, useState } from "react";
import { BellRing, Database, Download, Filter, MessageSquareText, Router, ScrollText } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { DataTable, DataTableColumn } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { useAppContext } from "@/context/AppContext";
import { alarms, devices } from "@/mock/mockData";
import { Alarm, Device } from "@/mock/types";

type DataSection = "devices" | "gateways" | "messages" | "logs" | "alarms";

interface DataPageProps {
  section?: DataSection;
}

const sectionMeta: Record<DataSection, { title: string; subtitle: string; breadcrumbs: string[] }> = {
  devices: {
    title: "Data / Devices",
    subtitle: "Device registry, status health, and mapped location inventory.",
    breadcrumbs: ["Dashboard", "Data", "Devices"]
  },
  gateways: {
    title: "Data / Gateways",
    subtitle: "Gateway connectivity, edge health, and data forwarding status.",
    breadcrumbs: ["Dashboard", "Data", "Gateways"]
  },
  messages: {
    title: "Data / Messages",
    subtitle: "Ingestion queue, payload diagnostics, and processing outcomes.",
    breadcrumbs: ["Dashboard", "Data", "Messages"]
  },
  logs: {
    title: "Data / Logs",
    subtitle: "Operational logs, audit trails, and system event tracking.",
    breadcrumbs: ["Dashboard", "Data", "Logs"]
  },
  alarms: {
    title: "Data / Alarms",
    subtitle: "Alarm feed, acknowledgement lifecycle, and clearance tracking.",
    breadcrumbs: ["Dashboard", "Data", "Alarms"]
  }
};

interface DeviceRow extends Record<string, unknown> {
  id: string;
  name: string;
  category: string;
  status: Device["status"];
  locationPath: string;
}

interface GatewayRow extends Record<string, unknown> {
  id: string;
  gateway: string;
  protocol: string;
  status: "online" | "offline";
  packetLoss: string;
}

interface MessageRow extends Record<string, unknown> {
  id: string;
  topic: string;
  source: string;
  status: "processed" | "retrying" | "failed";
  latency: string;
}

interface LogRow extends Record<string, unknown> {
  id: string;
  module: string;
  level: "info" | "warning" | "error";
  summary: string;
  timestamp: string;
}

interface AlarmRow extends Record<string, unknown> {
  id: string;
  source: string;
  level: Alarm["level"];
  status: Alarm["status"];
  timestamp: string;
}

const deviceStatusStyle: Record<Device["status"], string> = {
  healthy: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  warning: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  critical: "bg-rose-500/20 text-rose-300 border-rose-500/40",
  offline: "bg-slate-500/20 text-slate-300 border-slate-500/40"
};

const alarmLevelStyle: Record<Alarm["level"], string> = {
  info: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  warning: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  critical: "bg-rose-500/20 text-rose-300 border-rose-500/40"
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

export function DataPage({ section = "devices" }: DataPageProps) {
  const { selectedProjectId } = useAppContext();
  const currentMeta = sectionMeta[section];
  const [searchKeyword, setSearchKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    setSearchKeyword("");
    setStatusFilter("all");
  }, [selectedProjectId]);

  const scopedDevices = useMemo(() => {
    const matched = devices.filter((item) => item.projectId === selectedProjectId);
    if (matched.length > 0) {
      return matched;
    }

    const seed = hashCode(selectedProjectId);
    const statusOptions: Device["status"][] = ["healthy", "healthy", "warning", "critical", "offline"];
    const categories = ["Electric Meter", "Water Meter", "Gas Sensor", "Gateway"];
    return Array.from({ length: 4 }, (_, index) => ({
      id: `dev-${selectedProjectId}-${index + 1}`,
      projectId: selectedProjectId,
      name: `Device ${String(index + 1).padStart(2, "0")}`,
      category: categories[index % categories.length],
      status: statusOptions[Math.floor(seeded(seed, index + 1) * statusOptions.length)],
      locationPath: `Block ${String.fromCharCode(65 + index)} / Floor ${index + 1} / Room ${String(101 + index).padStart(3, "0")}`
    }));
  }, [selectedProjectId]);

  const scopedAlarms = useMemo(() => {
    const matched = alarms.filter((item) => item.projectId === selectedProjectId);
    if (matched.length > 0) {
      return matched;
    }

    const seed = hashCode(`${selectedProjectId}-alarms`);
    const levels: Alarm["level"][] = ["info", "warning", "critical"];
    const statuses: Alarm["status"][] = ["active", "acknowledged", "cleared"];
    return Array.from({ length: 3 }, (_, index) => ({
      id: `alarm-${selectedProjectId}-${index + 1}`,
      projectId: selectedProjectId,
      source: `Gateway ${String.fromCharCode(65 + index)}`,
      level: levels[Math.floor(seeded(seed, index + 3) * levels.length)],
      status: statuses[Math.floor(seeded(seed, index + 11) * statuses.length)],
      timestamp: `2026-05-${String(10 + index).padStart(2, "0")} ${String(8 + index).padStart(2, "0")}:20`
    }));
  }, [selectedProjectId]);

  const deviceRows = useMemo<DeviceRow[]>(() => {
    return scopedDevices.map((item) => ({
      id: item.id,
      name: item.name,
      category: item.category,
      status: item.status,
      locationPath: item.locationPath
    }));
  }, [scopedDevices]);
  const gatewayRows: GatewayRow[] = [
    { id: "gw-01", gateway: `LoRa Gateway ${selectedProjectId.slice(-2).toUpperCase()}-A`, protocol: "LoRaWAN", status: "online", packetLoss: "0.8%" },
    { id: "gw-02", gateway: `BACnet Bridge ${selectedProjectId.slice(-2).toUpperCase()}-B`, protocol: "BACnet/IP", status: "online", packetLoss: "1.4%" },
    { id: "gw-03", gateway: `Modbus Node ${selectedProjectId.slice(-2).toUpperCase()}-C`, protocol: "Modbus TCP", status: "offline", packetLoss: "9.2%" }
  ];
  const messageRows: MessageRow[] = [
    { id: "msg-01", topic: `meter/${selectedProjectId}/electricity/realtime`, source: gatewayRows[0].gateway, status: "processed", latency: "180 ms" },
    { id: "msg-02", topic: `meter/${selectedProjectId}/water/realtime`, source: gatewayRows[1].gateway, status: "retrying", latency: "620 ms" },
    { id: "msg-03", topic: `alarm/${selectedProjectId}/critical`, source: gatewayRows[2].gateway, status: "failed", latency: "1.8 s" }
  ];
  const logRows: LogRow[] = [
    { id: "log-01", module: "Ingestion Worker", level: "info", summary: `Batch committed for ${selectedProjectId}`, timestamp: "2026-05-10 00:16" },
    { id: "log-02", module: "Gateway Sync", level: "warning", summary: "Gateway heartbeat delayed", timestamp: "2026-05-10 00:09" },
    { id: "log-03", module: "Rules Engine", level: "error", summary: "Rule execution timeout", timestamp: "2026-05-09 23:57" }
  ];
  const alarmRows: AlarmRow[] = scopedAlarms.map((item) => ({
    id: item.id,
    source: item.source,
    level: item.level,
    status: item.status,
    timestamp: item.timestamp
  }));

  const sourceRows = useMemo(() => {
    if (section === "devices") {
      return deviceRows as Array<Record<string, unknown>>;
    }
    if (section === "gateways") {
      return gatewayRows as Array<Record<string, unknown>>;
    }
    if (section === "messages") {
      return messageRows as Array<Record<string, unknown>>;
    }
    if (section === "logs") {
      return logRows as Array<Record<string, unknown>>;
    }
    return alarmRows as Array<Record<string, unknown>>;
  }, [alarmRows, deviceRows, gatewayRows, logRows, messageRows, section]);

  const activeRows = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();
    return sourceRows.filter((row) => {
      if (keyword) {
        const hit = Object.values(row).some((value) => String(value).toLowerCase().includes(keyword));
        if (!hit) {
          return false;
        }
      }
      if (statusFilter !== "all") {
        const values = Object.values(row).map((value) => String(value));
        return values.includes(statusFilter);
      }
      return true;
    });
  }, [searchKeyword, sourceRows, statusFilter]);

  const sectionColumns: Record<DataSection, DataTableColumn<Record<string, unknown>>[]> = {
    devices: [
      { key: "name", header: "Device Name" },
      { key: "category", header: "Category" },
      {
        key: "status",
        header: "Status",
        render: (row) => {
          const status = row.status as Device["status"];
          return <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-medium ${deviceStatusStyle[status]}`}>{status}</span>;
        }
      },
      { key: "locationPath", header: "Location" }
    ],
    gateways: [
      { key: "gateway", header: "Gateway" },
      { key: "protocol", header: "Protocol" },
      {
        key: "status",
        header: "Status",
        render: (row) => {
          const isOnline = row.status === "online";
          return (
            <span
              className={`inline-flex rounded-md border px-2 py-1 text-xs font-medium ${
                isOnline ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-300" : "border-slate-500/40 bg-slate-500/20 text-slate-300"
              }`}
            >
              {String(row.status)}
            </span>
          );
        }
      },
      { key: "packetLoss", header: "Packet Loss" }
    ],
    messages: [
      { key: "topic", header: "Topic" },
      { key: "source", header: "Source" },
      {
        key: "status",
        header: "Status",
        render: (row) => {
          const value = String(row.status);
          const style =
            value === "processed"
              ? "border-emerald-500/40 bg-emerald-500/20 text-emerald-300"
              : value === "retrying"
                ? "border-amber-500/40 bg-amber-500/20 text-amber-300"
                : "border-rose-500/40 bg-rose-500/20 text-rose-300";
          return <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-medium ${style}`}>{value}</span>;
        }
      },
      { key: "latency", header: "Latency" }
    ],
    logs: [
      { key: "module", header: "Module" },
      { key: "summary", header: "Summary" },
      {
        key: "level",
        header: "Level",
        render: (row) => {
          const value = String(row.level);
          const style =
            value === "info"
              ? "border-blue-500/40 bg-blue-500/20 text-blue-300"
              : value === "warning"
                ? "border-amber-500/40 bg-amber-500/20 text-amber-300"
                : "border-rose-500/40 bg-rose-500/20 text-rose-300";
          return <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-medium ${style}`}>{value}</span>;
        }
      },
      { key: "timestamp", header: "Timestamp" }
    ],
    alarms: [
      { key: "source", header: "Source" },
      {
        key: "level",
        header: "Level",
        render: (row) => {
          const level = row.level as Alarm["level"];
          return <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-medium ${alarmLevelStyle[level]}`}>{level}</span>;
        }
      },
      { key: "status", header: "Status" },
      { key: "timestamp", header: "Timestamp" }
    ]
  };

  return (
    <PageContainer
      title={currentMeta.title}
      subtitle={currentMeta.subtitle}
      breadcrumbs={currentMeta.breadcrumbs}
    >
      <section className="panel p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="space-y-1">
            <span className="text-xs text-slate-400">Search</span>
            <input
              className="w-full rounded-md border border-shell-600 bg-shell-900 px-3 py-2 text-sm text-slate-200 outline-none placeholder:text-slate-500"
              placeholder="Device, topic, source..."
              value={searchKeyword}
              onChange={(event) => setSearchKeyword(event.target.value)}
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-slate-400">Status</span>
            <select className="w-full rounded-md border border-shell-600 bg-shell-900 px-3 py-2 text-sm text-slate-200" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">All</option>
              <option value="healthy">healthy</option>
              <option value="warning">warning</option>
              <option value="critical">critical</option>
              <option value="online">online</option>
              <option value="offline">offline</option>
              <option value="processed">processed</option>
              <option value="retrying">retrying</option>
              <option value="failed">failed</option>
              <option value="active">active</option>
              <option value="acknowledged">acknowledged</option>
              <option value="cleared">cleared</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs text-slate-400">Time Range</span>
            <select className="w-full rounded-md border border-shell-600 bg-shell-900 px-3 py-2 text-sm text-slate-200">
              <option>Today</option>
              <option>Last 7 days</option>
              <option>Last 30 days</option>
            </select>
          </label>
          <div className="flex items-end gap-2">
            <button className="inline-flex items-center gap-2 rounded-md border border-shell-600 bg-shell-900 px-3 py-2 text-sm text-slate-200 hover:bg-shell-700">
              <Filter className="h-4 w-4" />
              Apply
            </button>
            <button className="inline-flex items-center gap-2 rounded-md border border-shell-600 bg-shell-900 px-3 py-2 text-sm text-slate-200 hover:bg-shell-700">
              <Download className="h-4 w-4" />
              Export
            </button>
          </div>
          <div className="panel flex items-center justify-center bg-shell-900 px-3 py-2 text-sm text-slate-300">Showing {activeRows.length} records</div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <article className="panel p-4">
          <p className="text-xs text-slate-400">Connected Devices</p>
          <p className="mt-2 text-2xl font-semibold text-white">{deviceRows.length}</p>
        </article>
        <article className="panel p-4">
          <p className="text-xs text-slate-400">Gateways Online</p>
          <p className="mt-2 text-2xl font-semibold text-emerald-300">{gatewayRows.filter((row) => row.status === "online").length}</p>
        </article>
        <article className="panel p-4">
          <p className="text-xs text-slate-400">Message Exceptions</p>
          <p className="mt-2 text-2xl font-semibold text-amber-300">{messageRows.filter((row) => row.status !== "processed").length}</p>
        </article>
        <article className="panel p-4">
          <p className="text-xs text-slate-400">Active Alarms</p>
          <p className="mt-2 text-2xl font-semibold text-rose-300">{alarmRows.filter((row) => row.status === "active").length}</p>
        </article>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="space-y-4">
          <h2 className="section-title">Primary Dataset</h2>
          <DataTable columns={sectionColumns[section]} rows={activeRows} />
        </section>
        <section className="space-y-4">
          <h2 className="section-title">Alarm Feed</h2>
          <DataTable columns={sectionColumns.alarms} rows={alarmRows} />
        </section>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <EmptyState title="Edge Gateway Status" description="Gateway heartbeat, protocol health, and throughput monitoring placeholder." icon={<Router className="h-5 w-5" />} />
        <EmptyState title="Message Center" description="Ingestion queue, dead-letter retry, and payload quality checks placeholder." icon={<MessageSquareText className="h-5 w-5" />} />
        <EmptyState title="Logs & Alerts" description="Correlated log/alert timeline for fast root-cause tracing placeholder." icon={<ScrollText className="h-5 w-5" />} />
        <EmptyState title="Device Model Mapping" description="Tag model and point metadata governance placeholder." icon={<Database className="h-5 w-5" />} />
        <EmptyState title="Alarm Automation" description="Ack, escalation, and incident bridge automation placeholder." icon={<BellRing className="h-5 w-5" />} />
        <EmptyState title="Data QA Rules" description="Data completeness checks and anomaly quality score placeholder." />
      </div>
    </PageContainer>
  );
}
