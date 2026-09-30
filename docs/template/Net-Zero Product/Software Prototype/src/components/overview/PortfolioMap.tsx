import { MapPin, TriangleAlert } from "lucide-react";
import { OverviewSite, OperationalStatus } from "@/mock/types";

function statusColor(status: OperationalStatus) {
  if (status === "critical") {
    return "bg-rose-500";
  }
  if (status === "warning") {
    return "bg-amber-500";
  }
  return "bg-emerald-500";
}

interface PortfolioMapProps {
  sites: OverviewSite[];
  selectedSiteId: string | null;
  onSelectSite: (siteId: string | null) => void;
  onGoToSite: (projectId: string) => void;
}

export function PortfolioMap({ sites, selectedSiteId, onSelectSite, onGoToSite }: PortfolioMapProps) {
  const selected = sites.find((site) => site.id === selectedSiteId) ?? null;

  return (
    <section className="panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">Portfolio Map / Asset Map</h3>
        <p className="text-xs text-slate-400">Stylized map placeholder</p>
      </div>
      <div className="relative h-[360px] overflow-hidden rounded-lg border border-shell-600 bg-shell-900">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(59,130,246,0.15),transparent_40%),radial-gradient(circle_at_80%_80%,rgba(34,197,94,0.1),transparent_40%)]" />
        <div className="absolute inset-0 opacity-30 [background-size:28px_28px] [background-image:linear-gradient(to_right,#334155_1px,transparent_1px),linear-gradient(to_bottom,#334155_1px,transparent_1px)]" />
        {sites.map((site) => (
          <button
            key={site.id}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${site.mapPosition.x}%`, top: `${site.mapPosition.y}%` }}
            onClick={() => onSelectSite(site.id)}
            title={site.name}
          >
            <span className={`absolute inset-0 animate-ping rounded-full ${statusColor(site.operationalStatus)} opacity-30`} />
            <span className={`relative flex h-8 w-8 items-center justify-center rounded-full border-2 border-white/70 ${statusColor(site.operationalStatus)}`}>
              <MapPin className="h-4 w-4 text-white" />
            </span>
          </button>
        ))}

        {selected ? (
          <div className="absolute right-4 top-4 w-[320px] rounded-xl border border-shell-600 bg-shell-800 p-4 shadow-soft">
            <div className="mb-2 flex items-start justify-between">
              <div>
                <h4 className="text-sm font-semibold text-white">{selected.name}</h4>
                <p className="text-xs text-slate-400">{selected.address}</p>
              </div>
              <span className={`h-2.5 w-2.5 rounded-full ${statusColor(selected.operationalStatus)}`} />
            </div>
            <div className="space-y-1 text-xs text-slate-300">
              <p>
                <span className="text-slate-400">Facility:</span> {selected.facilityType}
              </p>
              <p>
                <span className="text-slate-400">Electricity Today:</span> {selected.kpis.electricity.value.toLocaleString()} {selected.kpis.electricity.unit}
              </p>
              <p>
                <span className="text-slate-400">Water Today:</span> {selected.kpis.water.value.toLocaleString()} {selected.kpis.water.unit}
              </p>
              <p className="inline-flex items-center gap-1">
                <TriangleAlert className="h-3.5 w-3.5 text-amber-400" />
                <span>Active alarms: {selected.activeAlarms}</span>
              </p>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button className="rounded-md border border-shell-600 px-3 py-1.5 text-xs text-slate-300 hover:bg-shell-700" onClick={() => onSelectSite(null)}>
                Close
              </button>
              <button className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500" onClick={() => onGoToSite(selected.projectId)}>
                Go to Site
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
