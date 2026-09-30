import { OverviewSite } from "@/mock/types";

function statusPill(status: OverviewSite["operationalStatus"]) {
  if (status === "critical") {
    return "bg-rose-500/20 text-rose-300";
  }
  if (status === "warning") {
    return "bg-amber-500/20 text-amber-300";
  }
  return "bg-emerald-500/20 text-emerald-300";
}

interface AssetTableProps {
  sites: OverviewSite[];
  onGoToSite: (projectId: string) => void;
}

export function AssetTable({ sites, onGoToSite }: AssetTableProps) {
  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-shell-600 px-4 py-3">
        <h3 className="text-sm font-semibold text-white">Portfolio Asset Table</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="bg-shell-700 text-slate-300">
            <tr>
              <th className="px-3 py-2 text-left">Site Name</th>
              <th className="px-3 py-2 text-left">Address</th>
              <th className="px-3 py-2 text-left">Facility Type</th>
              <th className="px-3 py-2 text-left">Operational Status</th>
              <th className="px-3 py-2 text-right">Electricity MTD</th>
              <th className="px-3 py-2 text-right">Water MTD</th>
              <th className="px-3 py-2 text-right">Carbon MTD</th>
              <th className="px-3 py-2 text-right">Cost MTD</th>
              <th className="px-3 py-2 text-right">Active Alarms</th>
              <th className="px-3 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {sites.map((site) => (
              <tr key={site.id} className="border-t border-shell-600">
                <td className="px-3 py-2 text-slate-100">{site.name}</td>
                <td className="px-3 py-2 text-slate-300">{site.address}</td>
                <td className="px-3 py-2 text-slate-300">{site.facilityType}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-md px-2 py-1 text-xs ${statusPill(site.operationalStatus)}`}>{site.operationalStatus}</span>
                </td>
                <td className="px-3 py-2 text-right text-slate-200">{site.mtd.electricity.toLocaleString()} kWh</td>
                <td className="px-3 py-2 text-right text-slate-200">{site.mtd.water.toLocaleString()} m3</td>
                <td className="px-3 py-2 text-right text-slate-200">{site.mtd.carbon.toLocaleString()} tCO2e</td>
                <td className="px-3 py-2 text-right text-slate-200">SGD {site.mtd.cost.toLocaleString()}</td>
                <td className="px-3 py-2 text-right text-slate-200">{site.activeAlarms}</td>
                <td className="px-3 py-2 text-right">
                  <button className="rounded-md bg-blue-600 px-2.5 py-1.5 text-xs text-white hover:bg-blue-500" onClick={() => onGoToSite(site.projectId)}>
                    Go to Site
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
