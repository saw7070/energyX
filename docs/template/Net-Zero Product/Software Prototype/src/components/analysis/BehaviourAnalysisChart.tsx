import { Line, LineChart, CartesianGrid, Legend, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BehaviourPoint } from "@/mock/types";

export function BehaviourAnalysisChart({ data }: { data: BehaviourPoint[] }) {
  const firstAbnormal = data.find((point) => point.abnormal);

  return (
    <section className="panel p-4">
      <h2 className="mb-3 text-sm font-semibold text-white">24-Hour Behaviour Analysis</h2>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
            <XAxis dataKey="hour" stroke="#94a3b8" />
            <YAxis stroke="#94a3b8" />
            <Tooltip />
            <Legend />
            <Line dataKey="baseline" stroke="#34d399" dot={false} name="Typical Pattern" />
            <Line dataKey="actual" stroke="#f59e0b" dot={false} name="Actual Pattern" />
            {data
              .filter((point) => point.abnormal)
              .map((point) => (
                <ReferenceDot key={point.hour} x={point.hour} y={point.actual} r={4} fill="#ef4444" />
              ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-xs text-slate-300">
        {firstAbnormal
          ? `Consumption at ${firstAbnormal.hour}:00 was ${Math.round(((firstAbnormal.actual - firstAbnormal.baseline) / firstAbnormal.baseline) * 100)}% above baseline.`
          : "No significant off-profile hour detected."}
      </p>
      <p className="mt-1 text-[11px] text-slate-500">Best suited for office or smaller-scale monitoring.</p>
    </section>
  );
}
