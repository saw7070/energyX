import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { EfficiencyBenchmarkData } from "@/mock/types";
import { RequirementGuideTitle } from "@/components/analysis/RequirementGuide";

export function EfficiencyBenchmarkCard({ data }: { data: EfficiencyBenchmarkData }) {
  return (
    <section className="panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <RequirementGuideTitle
            title="Efficiency & Benchmarking"
            className="text-sm font-semibold text-white"
            content={{
              title: "Efficiency & Benchmarking Requirements",
              summary: "Compare project intensity with benchmark cohort and percentile standing.",
              dataAcquisition: [
                "Use efficiency payload from analysis mock data (intensity, percentile, bars).",
                "Keep benchmarkBars aligned with current utility context."
              ],
              chartGeneration: [
                "Render intensity and percentile KPI cards.",
                "Render bar chart for benchmark comparison bands.",
                "Apply status color coding using percentileLabel."
              ]
            }}
          />
          <span className="rounded bg-indigo-500/20 px-2 py-0.5 text-[10px] text-indigo-300">Benchmark</span>
        </div>
        <span
          className={`rounded-md px-2 py-1 text-xs ${
            data.percentileLabel === "Top 38%"
              ? "bg-emerald-500/20 text-emerald-300"
              : data.percentileLabel === "Average"
                ? "bg-amber-500/20 text-amber-300"
                : "bg-rose-500/20 text-rose-300"
          }`}
        >
          {data.percentileLabel}
        </span>
      </div>
      <div className="mb-3 grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-shell-600 bg-shell-900 p-3">
          <p className="text-xs text-slate-400">{data.intensityLabel}</p>
          <p className="text-xl font-semibold text-white">{data.intensityValue}</p>
          <p className="text-xs text-slate-300">{data.statusText}</p>
          <p className="mt-2 text-[11px] text-slate-500">{data.historicalGfaNote}</p>
        </div>
        <div className="rounded-lg border border-shell-600 bg-shell-900 p-3">
          <p className="text-xs text-slate-400">Percentile Ranking</p>
          <p className="text-xl font-semibold text-blue-300">{data.percentile}</p>
          <p className="text-xs text-slate-400">Current asset group benchmark position.</p>
        </div>
      </div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.benchmarkBars}>
            <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
            <XAxis dataKey="label" stroke="#94a3b8" />
            <YAxis stroke="#94a3b8" />
            <Tooltip />
            <Legend />
            <Bar dataKey="value" fill="#60a5fa" name="Intensity" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
