import { AnalysisAnomalyRecord } from "@/mock/types";

export function AnomalyDetectionTable({
  rows,
  stats
}: {
  rows: AnalysisAnomalyRecord[];
  stats: { total: number; critical: number; resolved: number; pendingReview: number };
}) {
  return (
    <section className="panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-white">Anomaly Detection</h2>
          <span className="rounded bg-indigo-500/20 px-2 py-0.5 text-[10px] text-indigo-300">AI-assisted insight</span>
        </div>
      </div>
      <div className="mb-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Total anomalies" value={stats.total} tone="blue" />
        <StatCard title="Critical anomalies" value={stats.critical} tone="red" />
        <StatCard title="Resolved anomalies" value={stats.resolved} tone="green" />
        <StatCard title="Pending review" value={stats.pendingReview} tone="amber" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1150px] text-sm">
          <thead className="bg-shell-700 text-slate-300">
            <tr>
              <th className="px-3 py-2 text-left">Time</th>
              <th className="px-3 py-2 text-left">Utility</th>
              <th className="px-3 py-2 text-left">Location</th>
              <th className="px-3 py-2 text-left">Anomaly Type</th>
              <th className="px-3 py-2 text-left">Severity</th>
              <th className="px-3 py-2 text-left">Possible Cause</th>
              <th className="px-3 py-2 text-left">Recommended Action</th>
              <th className="px-3 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.time}-${row.location}`} className="border-t border-shell-600">
                <td className="px-3 py-2 text-slate-200">{row.time}</td>
                <td className="px-3 py-2 text-slate-200">{row.utility}</td>
                <td className="px-3 py-2 text-slate-200">{row.location}</td>
                <td className="px-3 py-2 text-slate-200">{row.anomalyType}</td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded px-2 py-1 text-xs ${
                      row.severity === "Critical"
                        ? "bg-rose-500/20 text-rose-300"
                        : row.severity === "Warning"
                          ? "bg-amber-500/20 text-amber-300"
                          : "bg-blue-500/20 text-blue-300"
                    }`}
                  >
                    {row.severity}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-300">{row.possibleCause}</td>
                <td className="px-3 py-2 text-slate-300">{row.recommendedAction}</td>
                <td className="px-3 py-2 text-slate-300">{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StatCard({ title, value, tone }: { title: string; value: number; tone: "blue" | "red" | "green" | "amber" }) {
  const style =
    tone === "red"
      ? "bg-rose-500/10 text-rose-300"
      : tone === "green"
        ? "bg-emerald-500/10 text-emerald-300"
        : tone === "amber"
          ? "bg-amber-500/10 text-amber-300"
          : "bg-blue-500/10 text-blue-300";
  return (
    <div className={`rounded-lg p-3 ${style}`}>
      <p className="text-xs">{title}</p>
      <p className="text-xl font-semibold">{value}</p>
    </div>
  );
}
