import { Line, LineChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ProfilePoint } from "@/mock/types";

interface OperationalProfileCardProps {
  profileName: string;
  data: ProfilePoint[];
  insight: string;
}

export function OperationalProfileCard({ profileName, data, insight }: OperationalProfileCardProps) {
  return (
    <section className="panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Operational Profile Analysis</h2>
        <button className="rounded-md border border-shell-600 px-2.5 py-1 text-xs text-slate-300 hover:bg-shell-700">Configure Profile</button>
      </div>
      <p className="mb-2 text-xs text-slate-400">Selected Profile: {profileName}</p>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
            <XAxis dataKey="hour" stroke="#94a3b8" />
            <YAxis stroke="#94a3b8" />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="expected" stroke="#34d399" dot={false} name="Expected Profile" />
            <Line type="monotone" dataKey="actual" stroke="#f59e0b" dot={false} name="Actual Usage" />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-xs text-slate-300">{insight}</p>
    </section>
  );
}
