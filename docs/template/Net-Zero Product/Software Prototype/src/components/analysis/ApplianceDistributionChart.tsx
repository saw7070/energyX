import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { ApplianceDistributionItem } from "@/mock/types";

const TAG_COLOR_MAP: Record<string, string> = {
  "air conditioning": "#5B8BCF",
  lighting: "#4F9B86",
  "plug load": "#9A8DBF",
  kitchen: "#C68656",
  heater: "#B35A73"
};
const FALLBACK_COLORS = ["#5B8BCF", "#4F9B86", "#9A8DBF", "#C68656", "#B35A73", "#5A9EAD"];

function getTagColor(tag: string, index: number) {
  return TAG_COLOR_MAP[tag.toLowerCase()] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

export function ApplianceDistributionChart({ data, unit, interpretation }: { data: ApplianceDistributionItem[]; unit: string; interpretation: string }) {
  return (
    <section className="panel p-4">
      <h2 className="mb-3 text-sm font-semibold text-white">Appliance Type Distribution</h2>
      <div className="grid gap-4 md:grid-cols-[260px_1fr]">
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="tag" outerRadius={84}>
                {data.map((item, index) => (
                  <Cell key={item.tag} fill={getTagColor(item.tag, index)} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="space-y-2">
          {data.map((item) => (
            <div key={item.tag} className="flex items-center justify-between rounded-md bg-shell-900 px-3 py-2 text-sm">
              <span className="text-slate-300">{item.tag}</span>
              <span className="font-medium text-white">
                {item.value.toLocaleString()} {unit} ({item.percentage}%)
              </span>
            </div>
          ))}
          <p className="mt-2 text-xs text-slate-400">{interpretation}</p>
        </div>
      </div>
    </section>
  );
}
