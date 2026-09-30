import { NapEnergyAnalysisData } from "@/mock/napEnergyAnalysisData";
import { formatIsoDateRangeWithWeekday } from "@/components/analysis/nap/napDateFormat";
import { RequirementGuideTitle } from "@/components/analysis/RequirementGuide";

export function NapDataSourceBanner({ data }: { data: NapEnergyAnalysisData }) {
  return (
    <div className="panel mb-4 border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm text-slate-300">
      <p className="font-medium text-emerald-200">Live dataset: {data.projectName} · Level 6 &amp; 7</p>
      <p className="mt-1 text-xs text-slate-400">
        Period {formatIsoDateRangeWithWeekday(data.meta.periodStart, data.meta.periodEnd)} · {data.meta.dayCount} days · 15-minute interval readings ·
        aggregate meters for totals, sub-meters for circuit breakdown (no double counting).
      </p>
      <p className="mt-1 text-xs text-slate-500">Sources: {data.meta.sourceFiles.join(" · ")}</p>
    </div>
  );
}

export function NapCircuitRankingTable({ data }: { data: NapEnergyAnalysisData }) {
  const avg = data.topCircuits.reduce((sum, row) => sum + row.consumption, 0) / Math.max(data.topCircuits.length, 1);

  return (
    <section className="panel p-4">
      <RequirementGuideTitle
        title="Top Circuit Ranking (Sub-meters)"
        className="mb-3 text-sm font-semibold text-white"
        content={{
          title: "Top Circuit Ranking",
          summary: "Identify the highest-consuming sub-meter circuits to prioritise audit and retrofit actions.",
          dataAcquisition: [
            "Sum each sub-meter's daily kWh over 19 May–17 Jun 2026 (monitoring period).",
            "Map device names to Lighting, Office Load, or Ventilation/Fan categories.",
            "Rank by total kWh; show top 10 with variance vs the average of those top 10."
          ],
          chartGeneration: [
            "Sortable-style table with rank, circuit name, floor, category, consumption, and vs-average delta."
          ]
        }}
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-shell-700 text-slate-300">
            <tr>
              <th className="px-3 py-2 text-left">Rank</th>
              <th className="px-3 py-2 text-left">Circuit</th>
              <th className="px-3 py-2 text-left">Floor</th>
              <th className="px-3 py-2 text-left">Category</th>
              <th className="px-3 py-2 text-right">Consumption</th>
              <th className="px-3 py-2 text-right">vs Avg of Top 10</th>
            </tr>
          </thead>
          <tbody>
            {data.topCircuits.map((row, index) => {
              const deltaPct = avg > 0 ? Math.round(((row.consumption - avg) / avg) * 100) : 0;
              return (
                <tr key={row.name} className="border-t border-shell-600">
                  <td className="px-3 py-2 text-slate-100">{index + 1}</td>
                  <td className="px-3 py-2 text-slate-100">{row.name}</td>
                  <td className="px-3 py-2 text-slate-300">Level {row.level}</td>
                  <td className="px-3 py-2 text-slate-300">{row.category}</td>
                  <td className="px-3 py-2 text-right text-slate-200">{row.consumption.toLocaleString()} kWh</td>
                  <td className={`px-3 py-2 text-right ${deltaPct > 0 ? "text-amber-300" : "text-emerald-300"}`}>
                    {deltaPct > 0 ? "+" : ""}
                    {deltaPct}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function NapInsightsPanel({ data }: { data: NapEnergyAnalysisData }) {
  const { summary } = data;
  return (
    <section className="panel p-4">
      <RequirementGuideTitle
        title="Energy Health Summary"
        className="mb-3 text-sm font-semibold text-white"
        content={{
          title: "Energy Health Summary",
          summary: "Day-type daily averages and weekday hour-band totals from aggregate meters in the monitoring period.",
          dataAcquisition: [
            "Weekday / weekend / holiday daily averages from aggregate Level 6 + Level 7 totals.",
            "Office hours = weekday 08:00–18:00; after-hours = weekday 22:00–06:00 on aggregate data.",
            "Level totals use aggregate meters (not sub-meter sums) to avoid double counting."
          ],
          chartGeneration: [
            "KPI cards for day-type averages, office/after-hours bands, and per-level aggregate totals."
          ]
        }}
      />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <InsightCard label="Weekday daily average" value={`${summary.weekdayDailyAvgKwh} kWh/day`} />
        <InsightCard label="Weekend daily average" value={`${summary.weekendDailyAvgKwh} kWh/day`} />
        <InsightCard label="Public holiday daily average" value={`${summary.holidayDailyAvgKwh} kWh/day`} />
        <InsightCard label="Weekday office hours (08-18)" value={`${summary.officeHoursWeekdayKwh} kWh`} />
        <InsightCard label="Weekday after-hours (22-06)" value={`${summary.afterHoursWeekdayKwh} kWh (${summary.afterHoursWeekdayPct}%)`} />
        <InsightCard label="Level 6 total (aggregate)" value={`${summary.level6Kwh} kWh`} />
        <InsightCard label="Level 7 total (aggregate)" value={`${summary.level7Kwh} kWh`} />
      </div>
    </section>
  );
}

function InsightCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-shell-600 bg-shell-800 p-3">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-1 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}
