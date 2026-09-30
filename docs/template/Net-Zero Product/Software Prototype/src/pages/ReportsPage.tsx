import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageContainer } from "@/components/layout/PageContainer";
import { ChartCard } from "@/components/ui/ChartCard";
import { DataTable } from "@/components/ui/DataTable";
import { reports } from "@/mock/mockData";

const pubWaterBalance = [
  { zone: "Inflow", value: 94 },
  { zone: "Consumption", value: 86 },
  { zone: "Loss", value: 8 },
  { zone: "Recovery", value: 3 }
];

export function ReportsPage() {
  return (
    <PageContainer
      title="Reports"
      subtitle="Reporting center placeholders for compliance, availability, incidents, and utility outcomes."
      breadcrumbs={["Dashboard", "Reports"]}
    >
      <div className="grid gap-4 xl:grid-cols-2">
        <DataTable
          columns={[
            { key: "type", header: "Report Type" },
            { key: "generatedAt", header: "Generated At" },
            { key: "status", header: "Status" }
          ]}
          rows={reports}
        />

        <ChartCard title="PUB Water Balance Chart Placeholder" subtitle="Water balance presentation-ready structure">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={pubWaterBalance}>
              <CartesianGrid stroke="#334155" strokeDasharray="3 3" />
              <XAxis dataKey="zone" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip />
              <Bar dataKey="value" fill="#38bdf8" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="panel p-4 text-sm text-slate-300">System Availability Report placeholder</div>
        <div className="panel p-4 text-sm text-slate-300">Data Unavailability Report placeholder</div>
        <div className="panel p-4 text-sm text-slate-300">Incident Ticket Report placeholder</div>
        <div className="panel p-4 text-sm text-slate-300">Utility Report placeholder</div>
      </div>
    </PageContainer>
  );
}
