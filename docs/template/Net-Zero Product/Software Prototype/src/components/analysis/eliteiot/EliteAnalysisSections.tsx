import { formatIsoDateRangeWithWeekday } from "@/components/analysis/nap/napDateFormat";
import { RequirementGuideTitle } from "@/components/analysis/RequirementGuide";
import { asEliteData } from "@/components/analysis/eliteiot/eliteiotScopeHelpers";
import { NapEnergyAnalysisData } from "@/mock/napEnergyAnalysisData";

export function EliteDataSourceBanner({ data }: { data: NapEnergyAnalysisData }) {
  const coveragePct =
    data.summary.totalKwh > 0
      ? Math.round((data.summary.level6Kwh + data.summary.level7Kwh) / data.summary.totalKwh * 1000) / 10
      : 0;

  return (
    <div className="panel mb-4 border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm text-slate-300">
      <p className="font-medium text-emerald-200">
        Live dataset: {data.projectName} · Incoming 3Phase + sub-meters
      </p>
      <p className="mt-1 text-xs text-slate-400">
        Period {formatIsoDateRangeWithWeekday(data.meta.periodStart, data.meta.periodEnd)} · {data.meta.dayCount}{" "}
        days · 15-minute interval readings · incoming meter for totals, sub-meters for circuit breakdown (
        {coveragePct}% coverage).
      </p>
      <p className="mt-1 text-xs text-slate-500">Sources: {data.meta.sourceFiles.join(" · ")}</p>
    </div>
  );
}

export function EliteCircuitRankingTable({ data }: { data: NapEnergyAnalysisData }) {
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
            "Sum each sub-meter's kWh over the EliteIOT monitoring period.",
            "Map devices to F&B, Lighting, IT Devices, and General Plug.",
            "Rank by total kWh; show top 10 with variance vs the average of those top 10."
          ],
          chartGeneration: [
            "Table with rank, circuit name, type group, category, consumption, and vs-average delta."
          ]
        }}
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-shell-700 text-slate-300">
            <tr>
              <th className="px-3 py-2 text-left">Rank</th>
              <th className="px-3 py-2 text-left">Circuit</th>
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

export function EliteInsightsPanel({ data }: { data: NapEnergyAnalysisData }) {
  const { summary } = data;
  const eliteData = asEliteData(data);
  const categoryTotals = eliteData.eliteCategoryTotals;

  return (
    <section className="panel p-4">
      <RequirementGuideTitle
        title="Energy Health Summary"
        className="mb-3 text-sm font-semibold text-white"
        content={{
          title: "Energy Health Summary",
          summary: "Day-type daily averages and weekday hour-band totals from the incoming meter.",
          dataAcquisition: [
            "Weekday / weekend daily averages from Incoming 3Phase totals.",
            "Office hours = weekday 08:00–18:00; after-hours = weekday 22:00–06:00 on incoming data.",
            "Sub-meter totals by usage category: F&B, Lighting, IT Devices, General Plug."
          ],
          chartGeneration: [
            "KPI cards for day-type averages, office/after-hours bands, and per-category sub-meter totals."
          ]
        }}
      />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <InsightCard label="Weekday daily average (incoming)" value={`${summary.weekdayDailyAvgKwh} kWh/day`} />
        <InsightCard label="Weekend daily average (incoming)" value={`${summary.weekendDailyAvgKwh} kWh/day`} />
        <InsightCard label="Weekday office hours (08-18)" value={`${summary.officeHoursWeekdayKwh} kWh`} />
        <InsightCard
          label="Weekday after-hours (22-06)"
          value={`${summary.afterHoursWeekdayKwh} kWh (${summary.afterHoursWeekdayPct}%)`}
        />
        <InsightCard label="F&B (sub-meters)" value={`${categoryTotals.fnb} kWh`} />
        <InsightCard label="Lighting (sub-meters)" value={`${categoryTotals.lighting} kWh`} />
        <InsightCard label="IT Devices (sub-meters)" value={`${categoryTotals.it_devices} kWh`} />
        <InsightCard label="General Plug (sub-meters)" value={`${categoryTotals.general_plug} kWh`} />
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
