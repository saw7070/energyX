import { OverviewSite } from "@/mock/types";

export function ProjectInfoCard({ site }: { site: OverviewSite }) {
  return (
    <section className="panel p-4">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">{site.name}</h3>
          <p className="text-sm text-slate-400">{site.address}</p>
        </div>
        <span
          className={`rounded-md px-2 py-1 text-xs ${
            site.operationalStatus === "critical"
              ? "bg-rose-500/20 text-rose-300"
              : site.operationalStatus === "warning"
                ? "bg-amber-500/20 text-amber-300"
                : "bg-emerald-500/20 text-emerald-300"
          }`}
        >
          {site.operationalStatus}
        </span>
      </div>
      <p className="mb-4 text-sm text-slate-300">{site.description}</p>
      <div className="grid grid-cols-2 gap-3 text-sm xl:grid-cols-5">
        <InfoItem label="Property Type" value={site.facilityType} />
        <InfoItem label="Total GFA" value={`${site.gfa.toLocaleString()} m2`} />
        <InfoItem label="Blocks" value={site.hierarchyCounts.blocks.toString()} />
        <InfoItem label="Floors" value={site.hierarchyCounts.floors.toString()} />
        <InfoItem label="Rooms" value={site.hierarchyCounts.rooms.toString()} />
        <InfoItem label="Devices" value={site.hierarchyCounts.devices.toString()} />
      </div>
    </section>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-shell-900 p-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-sm font-medium text-slate-100">{value}</p>
    </div>
  );
}
