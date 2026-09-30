import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { OverviewSite } from "@/mock/types";

type MetricKey = "electricity" | "water" | "gas" | "carbon" | "cost";
type DatasetKey = "realtime" | "daily" | "monthly";

interface UtilityTrendChartProps {
  site: OverviewSite;
  metric: MetricKey;
  dataset: DatasetKey;
  variant: "line" | "bar";
  title: string;
}

export function UtilityTrendChart({ site, metric, dataset, variant, title }: UtilityTrendChartProps) {
  const data = site.trends[dataset];

  return (
    <section className="panel p-4">
      <h3 className="mb-3 text-sm font-semibold text-white">{title}</h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          {variant === "line" ? (
            <LineChart data={data}>
              <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
              <XAxis dataKey="label" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip />
              <Line dataKey={metric} stroke="#38bdf8" strokeWidth={2.5} dot={false} />
            </LineChart>
          ) : (
            <BarChart data={data}>
              <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
              <XAxis dataKey="label" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip />
              <Bar dataKey={metric} fill="#22d3ee" radius={[4, 4, 0, 0]} />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </section>
  );
}
