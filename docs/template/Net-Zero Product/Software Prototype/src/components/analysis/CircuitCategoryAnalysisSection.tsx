import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface CircuitCategoryItem {
  tag: "lighting" | "aircon" | "socket" | "kitchen" | "heater";
  consumption: number;
  sharePct: number;
  peakHour: string;
}

interface CircuitCategoryAnalysisSectionProps {
  categories: CircuitCategoryItem[];
  unitLabel: string;
}

const tagLabel: Record<CircuitCategoryItem["tag"], string> = {
  lighting: "Lighting",
  aircon: "Aircon",
  socket: "Socket",
  kitchen: "Kitchen Appliances",
  heater: "Water Heater"
};

export function CircuitCategoryAnalysisSection({ categories, unitLabel }: CircuitCategoryAnalysisSectionProps) {
  const chartData = categories.map((item) => ({
    name: tagLabel[item.tag],
    consumption: item.consumption
  }));

  return (
    <div className="grid gap-4">
      <div className="panel p-4">
        <h3 className="mb-2 text-sm font-semibold text-white">Category Consumption Breakdown</h3>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
              <XAxis dataKey="name" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip />
              <Bar dataKey="consumption" fill="#60a5fa" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {categories.map((item) => (
          <article key={item.tag} className="rounded-lg border border-shell-600 bg-shell-900 p-3">
            <p className="text-xs text-slate-400">{tagLabel[item.tag]}</p>
            <p className="mt-1 text-lg font-semibold text-white">
              {item.consumption.toLocaleString()} {unitLabel}
            </p>
            <p className="mt-1 text-xs text-slate-300">Share: {item.sharePct.toFixed(1)}%</p>
            <p className="text-xs text-slate-400">Peak: {item.peakHour}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
