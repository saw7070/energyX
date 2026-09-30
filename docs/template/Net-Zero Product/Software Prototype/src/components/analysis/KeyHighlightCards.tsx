import { Bolt, Building2, Clock3, Coins, Droplets, Flame, Gauge, TriangleAlert, TrendingDown, TrendingUp } from "lucide-react";
import { useMemo, useState } from "react";
import { AnalysisHighlight } from "@/mock/types";

const iconMap = {
  bolt: Bolt,
  droplet: Droplets,
  flame: Flame,
  coins: Coins,
  gauge: Gauge,
  building: Building2,
  clock: Clock3,
  triangle: TriangleAlert
} as const;

export function KeyHighlightCards({ cards }: { cards: AnalysisHighlight[] }) {
  const [activeInfoKey, setActiveInfoKey] = useState<string | null>(null);
  const activeInfoCard = useMemo(() => cards.find((item) => item.key === activeInfoKey) ?? null, [activeInfoKey, cards]);

  const metricHelpText: Record<string, { meaning: string; calculation: string }> = {
    total: {
      meaning: "Total Consumption means the total energy usage in the selected reporting period.",
      calculation: "Sum all interval usage values (e.g. 15-min kWh) within the selected period."
    },
    eui: {
      meaning: "EUI (Energy Use Intensity) shows consumption normalized by area.",
      calculation: "EUI = Total Consumption (kWh) / Gross Floor Area (m²)."
    },
    peak: {
      meaning: "Peak Demand (1h) is the highest 1-hour rolling usage window in the period.",
      calculation: "Build interval series -> compute every rolling 1-hour window -> take the maximum window value."
    },
    cost: {
      meaning: "Estimated Cost is the projected utility bill amount for the selected period.",
      calculation: "Estimated Cost = Sum(interval usage × tariff), including time-of-use pricing where applicable."
    },
    daily_avg: {
      meaning: "Daily Average is the mean aggregate consumption across all days in the monitoring period.",
      calculation: "Daily Average = Total Consumption / Number of days in period."
    },
    estimated_cost: {
      meaning: "Estimated Cost is the projected electricity bill for the monitoring period.",
      calculation: "Sum of daily aggregate kWh × SP regulated tariff (29.72¢/kWh incl. GST for Apr–Jun 2026)."
    },
  };

  const helpText =
    (activeInfoCard && metricHelpText[activeInfoCard.key]) ?? {
      meaning: "This metric summarizes a key utility performance signal.",
      calculation: "Calculated from aggregated interval and tagged circuit data."
    };

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-white">Key Highlights</h2>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => {
          const Icon = iconMap[card.icon];
          const positive = card.trendPct > 0;
          return (
            <article key={card.key} className="panel p-4">
              <div className="mb-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setActiveInfoKey(card.key)}
                  className="rounded-lg bg-blue-500/15 p-2 text-blue-300 transition hover:bg-blue-500/25"
                  title={`Explain ${card.label}`}
                >
                  <Icon className="h-4 w-4" />
                </button>
                <span className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs ${positive ? "bg-amber-500/20 text-amber-300" : "bg-emerald-500/20 text-emerald-300"}`}>
                  {positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {positive ? "+" : ""}
                  {card.trendPct.toFixed(1)}%
                </span>
              </div>
              <p className="text-xs uppercase tracking-wide text-slate-400">{card.label}</p>
              <p className="mt-1 text-lg font-semibold text-white">
                {card.unit === "SGD" ? "SGD " : ""}
                {typeof card.value === "number" ? card.value.toLocaleString() : card.value}
                {card.unit && card.unit !== "SGD" ? ` ${card.unit}` : ""}
              </p>
              <p className="mt-1 text-xs text-slate-500">{card.note}</p>
            </article>
          );
        })}
      </div>

      {activeInfoCard ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4">
          <div className="w-full max-w-xl rounded-xl border border-shell-600 bg-shell-900 p-5 shadow-soft">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-400">Metric Definition</p>
                <h3 className="text-lg font-semibold text-white">{activeInfoCard.label}</h3>
              </div>
              <button type="button" onClick={() => setActiveInfoKey(null)} className="rounded-md border border-shell-600 px-2.5 py-1 text-xs text-slate-300 hover:bg-shell-800">
                Close
              </button>
            </div>
            <div className="space-y-3 text-sm">
              <div className="rounded-md border border-shell-600 bg-shell-800 p-3">
                <p className="text-xs text-slate-400">What this means</p>
                <p className="mt-1 text-slate-200">{helpText.meaning}</p>
              </div>
              <div className="rounded-md border border-shell-600 bg-shell-800 p-3">
                <p className="text-xs text-slate-400">How to calculate</p>
                <p className="mt-1 text-slate-200">{helpText.calculation}</p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
