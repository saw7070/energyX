import { ArrowDownRight, ArrowUpRight } from "lucide-react";

interface KpiCardProps {
  title: string;
  value: string;
  delta: string;
  trend: "up" | "down";
  hint?: string;
}

export function KpiCard({ title, value, delta, trend, hint }: KpiCardProps) {
  const isUp = trend === "up";
  return (
    <div className="panel p-4">
      <div className="text-xs uppercase tracking-wider text-slate-400">{title}</div>
      <div className="mt-2 text-2xl font-bold text-white">{value}</div>
      <div className="mt-2 flex items-center gap-2">
        <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ${isUp ? "bg-rose-500/20 text-rose-300" : "bg-emerald-500/20 text-emerald-300"}`}>
          {isUp ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
          {delta}
        </span>
        {hint ? <span className="text-xs text-slate-400">{hint}</span> : null}
      </div>
    </div>
  );
}
