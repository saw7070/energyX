import { Bolt, Coins, Droplets, Flame, Leaf, TrendingDown, TrendingUp } from "lucide-react";
import { overviewPortfolioKpis } from "@/mock/mockData";

const iconMap: Record<string, typeof Bolt> = {
  electricity: Bolt,
  water: Droplets,
  gas: Flame,
  carbon: Leaf,
  cost: Coins
};

export function PortfolioKpiGrid() {
  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
      {overviewPortfolioKpis.map((item) => {
        const Icon = iconMap[item.key] ?? Bolt;
        const positive = item.changePct > 0;
        return (
          <article key={item.key} className="panel p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="rounded-lg bg-blue-500/15 p-2 text-blue-300">
                <Icon className="h-4 w-4" />
              </div>
              <span
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${
                  positive ? "bg-amber-500/20 text-amber-300" : "bg-emerald-500/20 text-emerald-300"
                }`}
              >
                {positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {positive ? "+" : ""}
                {item.changePct.toFixed(1)}%
              </span>
            </div>
            <p className="text-xs uppercase tracking-wide text-slate-400">{item.label}</p>
            <p className="mt-2 text-2xl font-semibold text-white">
              {item.unit === "SGD" ? "SGD " : ""}
              {Number(item.value).toLocaleString()}
              <span className="ml-1 text-sm font-medium text-slate-400">{item.unit !== "SGD" ? item.unit : ""}</span>
            </p>
            <p className="mt-1 text-xs text-slate-500">{item.description}</p>
          </article>
        );
      })}
    </section>
  );
}
