import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { RequirementGuideTitle } from "@/components/analysis/RequirementGuide";

interface ForecastPoint {
  day: string;
  actual: number;
  forecast: number;
}

interface ForecastPredictionSectionProps {
  points: ForecastPoint[];
  endOfMonthConsumption: number;
  billForecast: number;
  peakRiskPct: number;
  unitLabel: string;
}

export function ForecastPredictionSection({
  points,
  endOfMonthConsumption,
  billForecast,
  peakRiskPct,
  unitLabel
}: ForecastPredictionSectionProps) {
  return (
    <div className="grid gap-4">
      <RequirementGuideTitle
        title="Forecast KPI Summary"
        className="text-sm font-semibold text-white"
        content={{
          title: "Forecast KPI Summary Requirements",
          summary: "Show end-of-month forecast, bill forecast, and peak risk in one glance.",
          dataAcquisition: [
            "Use computed endOfMonthConsumption from forecast points.",
            "Use utility tariff mapping to derive billForecast.",
            "Use seeded peakRiskPct for projected operational risk."
          ],
          chartGeneration: [
            "Render 3 KPI cards with clear units and emphasized values.",
            "Keep card values synchronized with forecast trend calculation."
          ]
        }}
      />
      <div className="grid gap-3 md:grid-cols-3">
        <article className="rounded-lg border border-shell-600 bg-shell-900 p-3">
          <p className="text-xs text-slate-400">End-of-month forecast</p>
          <p className="mt-1 text-xl font-semibold text-white">
            {endOfMonthConsumption.toLocaleString()} {unitLabel}
          </p>
        </article>
        <article className="rounded-lg border border-shell-600 bg-shell-900 p-3">
          <p className="text-xs text-slate-400">Bill forecast</p>
          <p className="mt-1 text-xl font-semibold text-white">SGD {billForecast.toLocaleString()}</p>
        </article>
        <article className="rounded-lg border border-shell-600 bg-shell-900 p-3">
          <p className="text-xs text-slate-400">Peak risk forecast</p>
          <p className="mt-1 text-xl font-semibold text-amber-300">{peakRiskPct.toFixed(0)}%</p>
        </article>
      </div>

      <div className="panel p-4">
        <RequirementGuideTitle
          title="Forecast Trend"
          className="mb-2 text-sm font-semibold text-white"
          content={{
            title: "Forecast Trend Requirements",
            summary: "Compare recent actual points and short-term forecast in one timeline.",
            dataAcquisition: [
              "Use points[] with actual and forecast values per day.",
              "Treat forecast as continuation after latest actual days."
            ],
            chartGeneration: [
              "Render line chart with solid actual and dashed forecast styles.",
              "Display tooltip for both series at each day point.",
              "Keep axis labels generic for electricity/water/gas reuse."
            ]
          }}
        />
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points}>
              <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
              <XAxis dataKey="day" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip />
              <Line type="monotone" dataKey="actual" name="Actual" stroke="#22c55e" strokeWidth={2} dot={{ r: 2 }} />
              <Line type="monotone" dataKey="forecast" name="Forecast" stroke="#a78bfa" strokeWidth={2} dot={false} strokeDasharray="4 4" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
