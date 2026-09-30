import { useMemo } from "react";
import { OverviewSite, OperationalStatus } from "@/mock/types";

type MetricKey = "eui" | "wei" | "cost" | "carbon";
type Timeframe = "Today" | "MTD" | "YTD";

interface SiteRankingProps {
  sites: OverviewSite[];
  facilityFilter: string;
  statusFilter: "All" | OperationalStatus;
  metric: MetricKey;
  timeframe: Timeframe;
}

function performanceBadge(performance: OverviewSite["ranking"]["performance"]) {
  if (performance === "Good") {
    return "bg-emerald-500/20 text-emerald-300";
  }
  if (performance === "Average") {
    return "bg-amber-500/20 text-amber-300";
  }
  return "bg-rose-500/20 text-rose-300";
}

export function SiteRanking({ sites, facilityFilter, statusFilter, metric, timeframe }: SiteRankingProps) {
  const rows = useMemo(() => {
    const filtered = sites.filter((site) => {
      if (facilityFilter !== "All" && site.facilityType !== facilityFilter) {
        return false;
      }
      if (statusFilter !== "All" && site.operationalStatus !== statusFilter) {
        return false;
      }
      return true;
    });

    const sorted = [...filtered].sort((a, b) => {
      const metricValue = (site: OverviewSite) => {
        if (metric === "eui") return site.ranking.eui;
        if (metric === "wei") return site.ranking.wei;
        if (metric === "carbon") return site.ranking.carbon;
        return site.ranking.utilityCost;
      };
      return metricValue(a) - metricValue(b);
    });
    return sorted;
  }, [facilityFilter, metric, sites, statusFilter]);

  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-shell-600 px-4 py-3">
        <h3 className="text-sm font-semibold text-white">Site Performance Ranking ({timeframe})</h3>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-shell-700 text-slate-300">
          <tr>
            <th className="px-3 py-2 text-left">Rank</th>
            <th className="px-3 py-2 text-left">Site</th>
            <th className="px-3 py-2 text-left">Facility Type</th>
            <th className="px-3 py-2 text-right">EUI</th>
            <th className="px-3 py-2 text-right">WEI</th>
            <th className="px-3 py-2 text-right">Utility Cost</th>
            <th className="px-3 py-2 text-left">Performance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((site, index) => (
            <tr key={site.id} className="border-t border-shell-600">
              <td className="px-3 py-2 text-slate-200">#{index + 1}</td>
              <td className="px-3 py-2 text-slate-100">{site.name}</td>
              <td className="px-3 py-2 text-slate-300">{site.facilityType}</td>
              <td className="px-3 py-2 text-right text-slate-200">{site.ranking.eui.toFixed(1)}</td>
              <td className="px-3 py-2 text-right text-slate-200">{site.ranking.wei.toFixed(1)}</td>
              <td className="px-3 py-2 text-right text-slate-200">SGD {site.ranking.utilityCost.toLocaleString()}</td>
              <td className="px-3 py-2">
                <span className={`rounded-md px-2 py-1 text-xs ${performanceBadge(site.ranking.performance)}`}>{site.ranking.performance}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
