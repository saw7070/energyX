import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface HourlyPoint {
  hour: string;
  baseline: number;
  actual: number;
}

interface OccupancyPoint {
  hour: string;
  status: "Home" | "Away";
}

interface TimeBehaviorDeepDiveSectionProps {
  hourlyPattern: HourlyPoint[];
  nightPattern: HourlyPoint[];
  occupancyTimeline: OccupancyPoint[];
}

function statusClass(status: OccupancyPoint["status"]) {
  return status === "Home" ? "bg-emerald-500/30 text-emerald-300" : "bg-slate-600/40 text-slate-300";
}

export function TimeBehaviorDeepDiveSection({
  hourlyPattern,
  nightPattern,
  occupancyTimeline
}: TimeBehaviorDeepDiveSectionProps) {
  return (
    <div className="grid gap-4">
      <div className="panel p-4">
        <h3 className="mb-2 text-sm font-semibold text-white">Hourly Usage Pattern</h3>
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={hourlyPattern}>
              <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
              <XAxis dataKey="hour" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip />
              <Line type="monotone" dataKey="baseline" name="Baseline" stroke="#34d399" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="actual" name="Actual" stroke="#f59e0b" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="panel p-4">
          <h3 className="mb-2 text-sm font-semibold text-white">Night Consumption Analysis (22:00-06:00)</h3>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={nightPattern}>
                <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                <XAxis dataKey="hour" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip />
                <Line type="monotone" dataKey="actual" name="Night Load" stroke="#60a5fa" strokeWidth={2} dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel p-4">
          <h3 className="mb-2 text-sm font-semibold text-white">Occupancy Pattern Estimation</h3>
          <div className="grid grid-cols-4 gap-2 text-xs">
            {occupancyTimeline.map((item) => (
              <div key={item.hour} className={`rounded-md border border-shell-600 px-2 py-1.5 text-center ${statusClass(item.status)}`}>
                <p className="text-[10px] text-slate-400">{item.hour}:00</p>
                <p className="font-medium">{item.status}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
