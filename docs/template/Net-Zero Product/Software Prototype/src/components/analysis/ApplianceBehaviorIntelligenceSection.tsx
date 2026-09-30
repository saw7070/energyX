import { Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, BarChart } from "recharts";

interface RuntimePoint {
  day: string;
  hours: number;
}

interface StandbyDevicePoint {
  device: string;
  standbyLoad: number;
}

interface AbnormalDeviceItem {
  name: string;
  issue: string;
  severity: string;
}

interface ApplianceBehaviorIntelligenceSectionProps {
  airconRuntime: RuntimePoint[];
  standbyDevices: StandbyDevicePoint[];
  abnormalDevices: AbnormalDeviceItem[];
}

export function ApplianceBehaviorIntelligenceSection({
  airconRuntime,
  standbyDevices,
  abnormalDevices
}: ApplianceBehaviorIntelligenceSectionProps) {
  const totalRuntimeHours = airconRuntime.reduce((sum, item) => sum + item.hours, 0);
  const totalStandby = standbyDevices.reduce((sum, item) => sum + item.standbyLoad, 0);

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="panel p-4">
          <h3 className="mb-2 text-sm font-semibold text-white">Aircon Runtime Analysis</h3>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={airconRuntime}>
                <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                <XAxis dataKey="day" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip />
                <Line type="monotone" dataKey="hours" stroke="#22c55e" strokeWidth={2} dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-xs text-slate-300">Total aircon runtime: {totalRuntimeHours.toFixed(1)} hours (last 7 days)</p>
        </div>

        <div className="panel p-4">
          <h3 className="mb-2 text-sm font-semibold text-white">Standby Load Detection</h3>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={standbyDevices}>
                <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                <XAxis dataKey="device" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip />
                <Bar dataKey="standbyLoad" fill="#f59e0b" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-xs text-slate-300">Detected standby baseline: {totalStandby.toFixed(1)} kWh/day equivalent</p>
        </div>
      </div>

      <div className="panel p-4">
        <h3 className="mb-2 text-sm font-semibold text-white">Abnormal Device Detection</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-shell-700 text-slate-300">
              <tr>
                <th className="px-3 py-2 text-left">Device / Circuit</th>
                <th className="px-3 py-2 text-left">Issue</th>
                <th className="px-3 py-2 text-left">Severity</th>
              </tr>
            </thead>
            <tbody>
              {abnormalDevices.map((item) => (
                <tr key={`${item.name}-${item.issue}`} className="border-t border-shell-600">
                  <td className="px-3 py-2 text-slate-200">{item.name}</td>
                  <td className="px-3 py-2 text-slate-300">{item.issue}</td>
                  <td className="px-3 py-2 text-slate-300">{item.severity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
