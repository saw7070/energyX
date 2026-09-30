import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { OverviewSite } from "@/mock/types";

export function DeviceStatisticsCard({ site }: { site: OverviewSite }) {
  const data = [
    { name: "Online", value: site.deviceStats.online, color: "#22c55e" },
    { name: "Offline", value: site.deviceStats.offline, color: "#f43f5e" },
    { name: "Warning", value: site.deviceStats.warning, color: "#f59e0b" }
  ];

  return (
    <section className="panel p-4">
      <h3 className="mb-3 text-sm font-semibold text-white">Device Statistics</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="h-44">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" innerRadius={45} outerRadius={70}>
                {data.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="space-y-2 text-sm text-slate-300">
          <Row label="Total devices onboarded" value={site.deviceStats.total} />
          <Row label="Online devices" value={site.deviceStats.online} />
          <Row label="Offline devices" value={site.deviceStats.offline} />
          <Row label="Warning devices" value={site.deviceStats.warning} />
          <Row label="Gateways online" value={site.deviceStats.gatewaysOnline} />
          <Row label="Gateways offline" value={site.deviceStats.gatewaysOffline} />
        </div>
      </div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-shell-900 px-2 py-1.5">
      <span>{label}</span>
      <span className="font-semibold text-white">{value}</span>
    </div>
  );
}
