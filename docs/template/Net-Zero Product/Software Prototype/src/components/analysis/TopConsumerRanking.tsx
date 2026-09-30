import { useMemo, useState } from "react";
import { TopConsumerRecord } from "@/mock/types";

const levelOptions = ["Room", "Floor", "Block", "Project", "Appliance Tag"] as const;

export function TopConsumerRanking({ rows, unitLabel }: { rows: TopConsumerRecord[]; unitLabel: string }) {
  const [level, setLevel] = useState<(typeof levelOptions)[number]>("Room");
  const filtered = useMemo(() => rows.filter((row) => row.type === level || (level === "Appliance Tag" && row.type === "Appliance Tag")), [level, rows]);

  return (
    <section className="panel p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-white">Top Consumer Ranking</h2>
        <div className="inline-flex rounded border border-shell-600 bg-shell-800 p-1">
          {levelOptions.map((option) => (
            <button
              key={option}
              className={`rounded px-2 py-1 text-xs ${option === level ? "bg-blue-600 text-white" : "text-slate-400 hover:text-white"}`}
              onClick={() => setLevel(option)}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-shell-700 text-slate-300">
            <tr>
              <th className="px-3 py-2 text-left">Rank</th>
              <th className="px-3 py-2 text-left">Location / Asset</th>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-right">Consumption</th>
              <th className="px-3 py-2 text-right">EUI / WEI / Intensity</th>
              <th className="px-3 py-2 text-right">Compared to Average</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={`${row.type}-${row.rank}-${row.name}`} className="border-t border-shell-600">
                <td className="px-3 py-2 text-slate-100">{row.rank}</td>
                <td className="px-3 py-2 text-slate-100">{row.name}</td>
                <td className="px-3 py-2 text-slate-300">{row.type}</td>
                <td className="px-3 py-2 text-right text-slate-200">
                  {row.consumption.toLocaleString()} {unitLabel}
                </td>
                <td className="px-3 py-2 text-right text-slate-200">{row.intensity.toFixed(2)}</td>
                <td className={`px-3 py-2 text-right ${row.comparedToAverage > 0 ? "text-amber-300" : "text-emerald-300"}`}>
                  {row.comparedToAverage > 0 ? "+" : ""}
                  {row.comparedToAverage}%
                </td>
                <td className="px-3 py-2">
                  <StatusChip status={row.status} />
                </td>
                <td className="px-3 py-2 text-right">
                  <button className="rounded bg-blue-600 px-2.5 py-1 text-xs text-white hover:bg-blue-500">View</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Ranking compares assets of the same type and operational profile to avoid unfair comparison.
      </p>
    </section>
  );
}

function StatusChip({ status }: { status: TopConsumerRecord["status"] }) {
  const style =
    status === "Outlier"
      ? "bg-rose-500/20 text-rose-300"
      : status === "High"
        ? "bg-amber-500/20 text-amber-300"
        : status === "Normal"
          ? "bg-green-500/20 text-green-300"
          : "bg-emerald-500/20 text-emerald-300";
  return <span className={`rounded px-2 py-1 text-xs ${style}`}>{status}</span>;
}
