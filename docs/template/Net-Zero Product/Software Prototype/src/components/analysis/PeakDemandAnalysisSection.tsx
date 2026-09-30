import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface PeakContributor {
  name: string;
  demand: number;
}

interface SimultaneousUsageRisk {
  pair: string;
  score: number;
}

interface PeakDemandAnalysisSectionProps {
  peakTime: string;
  peakDemand: number;
  contributors: PeakContributor[];
  risks: SimultaneousUsageRisk[];
  unitLabel: string;
}

export function PeakDemandAnalysisSection({
  peakTime,
  peakDemand,
  contributors,
  risks,
  unitLabel
}: PeakDemandAnalysisSectionProps) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <article className="rounded-lg border border-shell-600 bg-shell-900 p-3">
          <p className="text-xs text-slate-400">Peak demand (1h)</p>
          <p className="mt-1 text-xl font-semibold text-white">
            {peakDemand.toLocaleString()} {unitLabel}
          </p>
        </article>
        <article className="rounded-lg border border-shell-600 bg-shell-900 p-3">
          <p className="text-xs text-slate-400">Peak window</p>
          <p className="mt-1 text-sm font-semibold text-white">{peakTime}</p>
        </article>
        <article className="rounded-lg border border-shell-600 bg-shell-900 p-3">
          <p className="text-xs text-slate-400">Top contributor</p>
          <p className="mt-1 text-xl font-semibold text-white">{contributors[0]?.name ?? "N/A"}</p>
        </article>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        <div className="panel p-4">
          <h3 className="mb-2 text-sm font-semibold text-white">Peak Contributor Breakdown</h3>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={contributors}>
                <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
                <XAxis dataKey="name" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip />
                <Bar dataKey="demand" fill="#a78bfa" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel p-4">
          <h3 className="mb-2 text-sm font-semibold text-white">Simultaneous Usage Detection</h3>
          <div className="space-y-2">
            {risks.map((risk) => (
              <div key={risk.pair} className="rounded-md border border-shell-600 bg-shell-900 px-3 py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-300">{risk.pair}</span>
                  <span className="font-medium text-amber-300">{risk.score}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
