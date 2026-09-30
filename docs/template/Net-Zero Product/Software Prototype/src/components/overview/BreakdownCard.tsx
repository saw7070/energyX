import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { OverviewSite } from "@/mock/types";

interface BreakdownCardProps {
  site: OverviewSite;
  mode: "space" | "tag";
}

export function BreakdownCard({ site, mode }: BreakdownCardProps) {
  const data = mode === "space" ? site.breakdownBySpace : site.breakdownByTag;
  const title = mode === "space" ? "Breakdown by Space (Block / Floor / Room)" : "Breakdown by Asset Tag";

  return (
    <section className="panel p-4">
      <h3 className="mb-3 text-sm font-semibold text-white">{title}</h3>
      <div className="h-60">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
            <XAxis dataKey="label" stroke="#94a3b8" />
            <YAxis stroke="#94a3b8" />
            <Tooltip />
            <Bar dataKey="value" fill="#60a5fa" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
