import { useEffect, useMemo, useRef, useState } from "react";
import { Search, MapPinned, List, Zap, Droplets, Flame, Leaf, DollarSign, ChevronDown } from "lucide-react";
import { portfolioProjectRecords, type PortfolioProjectRecord } from "@/mock/portfolioProjects";

type SiteRecord = PortfolioProjectRecord;

const statusOptions = ["All Status", "Operational", "Under Maintenance"] as const;
const typeOptions = ["All Types", "Commercial", "Industrial", "Residential", "Hospitality", "Data Centre"] as const;
const topTabs = ["Today", "MTD", "YTD"] as const;
type RangeTab = (typeof topTabs)[number];
type SortKey = "name" | "type" | "status" | "electricity" | "water" | "gas" | "eui" | "cost" | "alarms";
const tableStatusValues: SiteRecord["status"][] = ["Operational", "Under Maintenance"];
const tableTypeValues: SiteRecord["type"][] = ["Commercial", "Industrial", "Residential", "Hospitality", "Data Centre"];

const rangeFactors: Record<RangeTab, { volume: number; eui: number }> = {
  Today: { volume: 1 / 30, eui: 0.95 },
  MTD: { volume: 1, eui: 1 },
  YTD: { volume: 12, eui: 1.06 }
};

function round(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function PortfolioPage() {
  const [rangeTab, setRangeTab] = useState<(typeof topTabs)[number]>("MTD");
  const [searchText, setSearchText] = useState("");
  const [typeFilter, setTypeFilter] = useState<(typeof typeOptions)[number]>("All Types");
  const [statusFilter, setStatusFilter] = useState<(typeof statusOptions)[number]>("All Status");
  const [viewMode, setViewMode] = useState<"map" | "table">("map");
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: "asc" | "desc" } | null>(null);
  const [activeFilterMenu, setActiveFilterMenu] = useState<"status" | "type" | null>(null);
  const [tableStatusFilters, setTableStatusFilters] = useState<Array<SiteRecord["status"]>>(tableStatusValues);
  const [tableTypeFilters, setTableTypeFilters] = useState<Array<SiteRecord["type"]>>(tableTypeValues);
  const [mapReady, setMapReady] = useState(false);
  const tableFilterRef = useRef<HTMLDivElement | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerLayerRef = useRef<any>(null);

  const filteredSites = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    return portfolioProjectRecords.filter((site) => {
      if (typeFilter !== "All Types" && site.type !== typeFilter) {
        return false;
      }
      if (statusFilter !== "All Status" && site.status !== statusFilter) {
        return false;
      }
      if (keyword && !`${site.name} ${site.address}`.toLowerCase().includes(keyword)) {
        return false;
      }
      return true;
    });
  }, [searchText, statusFilter, typeFilter]);

  const selectedSite = useMemo(() => filteredSites.find((site) => site.id === selectedSiteId) ?? null, [filteredSites, selectedSiteId]);

  const transformedSites = useMemo(() => {
    const factor = rangeFactors[rangeTab];
    return filteredSites.map((site) => ({
      ...site,
      electricity: Math.round(site.electricity * factor.volume),
      water: round(site.water * factor.volume, 2),
      gas: round(site.gas * factor.volume, 1),
      cost: Math.round(site.cost * factor.volume),
      carbon: round(site.carbon * factor.volume, 2),
      eui: round(site.eui * factor.eui, 1)
    }));
  }, [filteredSites, rangeTab]);

  const selectedSiteMetrics = useMemo(() => {
    if (!selectedSite) {
      return null;
    }
    const factor = rangeFactors[rangeTab];
    return {
      ...selectedSite,
      electricity: Math.round(selectedSite.electricity * factor.volume),
      water: round(selectedSite.water * factor.volume, 2),
      gas: round(selectedSite.gas * factor.volume, 1),
      cost: Math.round(selectedSite.cost * factor.volume),
      carbon: round(selectedSite.carbon * factor.volume, 2),
      eui: round(selectedSite.eui * factor.eui, 1)
    };
  }, [rangeTab, selectedSite]);

  useEffect(() => {
    let cancelled = false;

    async function ensureLeafletReady() {
      if (!document.getElementById("leaflet-css")) {
        const link = document.createElement("link");
        link.id = "leaflet-css";
        link.rel = "stylesheet";
        link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        document.head.appendChild(link);
      }

      if (!(window as any).L) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script");
          script.id = "leaflet-js";
          script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
          script.onload = () => resolve();
          script.onerror = () => reject(new Error("Leaflet script failed to load"));
          document.body.appendChild(script);
        });
      }

      if (cancelled || !mapContainerRef.current) {
        return;
      }

      const L = (window as any).L;
      if (mapRef.current && mapRef.current._container && !document.body.contains(mapRef.current._container)) {
        mapRef.current.remove();
        mapRef.current = null;
        markerLayerRef.current = null;
        setMapReady(false);
      }
      if (!mapRef.current) {
        mapRef.current = L.map(mapContainerRef.current, { zoomControl: true }).setView([1.3521, 103.8198], 11);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: '&copy; OpenStreetMap contributors'
        }).addTo(mapRef.current);
        markerLayerRef.current = L.layerGroup().addTo(mapRef.current);
      }
      mapRef.current.invalidateSize();
      setMapReady(true);
    }

    if (viewMode === "map") {
      ensureLeafletReady();
    }

    return () => {
      cancelled = true;
    };
  }, [viewMode]);

  useEffect(() => {
    const L = (window as any).L;
    if (!L || !mapRef.current || !markerLayerRef.current || viewMode !== "map" || !mapReady) {
      return;
    }

    markerLayerRef.current.clearLayers();
    const markerSvg =
      '<svg width="24" height="34" viewBox="0 0 24 34" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M12 1C5.95 1 1 5.95 1 12c0 8.38 8.98 17.72 11 19.72C14.02 29.72 23 20.38 23 12 23 5.95 18.05 1 12 1Z" fill="#0ea5e9" stroke="#ffffff" stroke-width="2"/>' +
      '<circle cx="12" cy="12" r="3.5" fill="#ffffff"/>' +
      "</svg>";
    const markerIcon = L.divIcon({
      className: "portfolio-marker",
      html: `<div style="filter: drop-shadow(0 6px 8px rgba(15, 23, 42, 0.28));">${markerSvg}</div>`,
      iconSize: [24, 34],
      iconAnchor: [12, 34]
    });

    filteredSites.forEach((site) => {
      const marker = L.marker([site.map.lat, site.map.lng], { icon: markerIcon });
      marker.on("click", () => setSelectedSiteId(site.id));
      marker.addTo(markerLayerRef.current);
    });
  }, [filteredSites, viewMode, mapReady]);

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!tableFilterRef.current) {
        return;
      }
      if (!tableFilterRef.current.contains(event.target as Node)) {
        setActiveFilterMenu(null);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, []);

  const kpis = useMemo(() => {
    const totalElectricity = transformedSites.reduce((sum, site) => sum + site.electricity, 0);
    const totalWater = transformedSites.reduce((sum, site) => sum + site.water, 0);
    const totalGas = transformedSites.reduce((sum, site) => sum + site.gas, 0);
    const totalCarbon = transformedSites.reduce((sum, site) => sum + site.carbon, 0);
    const totalCost = transformedSites.reduce((sum, site) => sum + site.cost, 0);
    return { totalElectricity, totalWater, totalGas, totalCarbon, totalCost };
  }, [transformedSites]);

  const sortedSites = useMemo(() => {
    if (!sortConfig) {
      return transformedSites;
    }

    const directionFactor = sortConfig.direction === "asc" ? 1 : -1;
    return [...transformedSites].sort((a, b) => {
      const valueA = a[sortConfig.key];
      const valueB = b[sortConfig.key];
      if (typeof valueA === "number" && typeof valueB === "number") {
        return (valueA - valueB) * directionFactor;
      }
      return String(valueA).localeCompare(String(valueB)) * directionFactor;
    });
  }, [sortConfig, transformedSites]);

  const visibleSites = useMemo(() => {
    return sortedSites.filter((site) => tableStatusFilters.includes(site.status) && tableTypeFilters.includes(site.type));
  }, [sortedSites, tableStatusFilters, tableTypeFilters]);

  function toggleSort(key: SortKey) {
    setSortConfig((current) => {
      if (!current || current.key !== key) {
        return { key, direction: "desc" };
      }
      if (current.direction === "desc") {
        return { key, direction: "asc" };
      }
      return null;
    });
  }

  function sortMark(key: SortKey) {
    if (!sortConfig || sortConfig.key !== key) {
      return "↕";
    }
    return sortConfig.direction === "asc" ? "↑" : "↓";
  }

  function sortMarkClass(key: SortKey) {
    if (!sortConfig || sortConfig.key !== key) {
      return "text-slate-500";
    }
    return "text-slate-200";
  }

  function toggleStatusFilter(value: SiteRecord["status"]) {
    setTableStatusFilters((current) => (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]));
  }

  function toggleTypeFilter(value: SiteRecord["type"]) {
    setTableTypeFilters((current) => (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]));
  }

  function resetStatusFilter() {
    setTableStatusFilters(tableStatusValues);
  }

  function resetTypeFilter() {
    setTableTypeFilters(tableTypeValues);
  }

  function invertStatusFilter() {
    setTableStatusFilters(tableStatusValues.filter((item) => !tableStatusFilters.includes(item)));
  }

  function invertTypeFilter() {
    setTableTypeFilters(tableTypeValues.filter((item) => !tableTypeFilters.includes(item)));
  }

  return (
    <div className="min-h-full bg-shell-950 p-5 text-slate-100">
      <section className="rounded-xl border border-shell-600 bg-shell-800 p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold text-white">Global Performance</h1>
            <p className="text-sm text-slate-400">Portfolio overview across all sites</p>
          </div>
          <div className="inline-flex rounded-lg border border-shell-600 bg-shell-700 p-1">
            {topTabs.map((tab) => (
              <button
                key={tab}
                onClick={() => setRangeTab(tab)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  rangeTab === tab ? "bg-shell-800 text-white shadow-soft" : "text-slate-400 hover:text-white"
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <article className="rounded-xl border border-shell-600 bg-shell-900 px-4 py-2.5">
            <div className="mb-1 inline-flex rounded-md bg-amber-50 p-1 text-amber-500">
              <Zap className="h-3.5 w-3.5" />
            </div>
            <p className="text-[11px] text-slate-400">Electricity</p>
            <p className="mt-0.5 text-[30px] leading-none font-semibold text-white">{kpis.totalElectricity.toLocaleString()} <span className="text-base">kWh</span></p>
          </article>
          <article className="rounded-xl border border-shell-600 bg-shell-900 px-4 py-2.5">
            <div className="mb-1 inline-flex rounded-md bg-sky-50 p-1 text-sky-500">
              <Droplets className="h-3.5 w-3.5" />
            </div>
            <p className="text-[11px] text-slate-400">Water</p>
            <p className="mt-0.5 text-[30px] leading-none font-semibold text-white">{kpis.totalWater.toFixed(1)} <span className="text-base">m³</span></p>
          </article>
          <article className="rounded-xl border border-shell-600 bg-shell-900 px-4 py-2.5">
            <div className="mb-1 inline-flex rounded-md bg-orange-50 p-1 text-orange-500">
              <Flame className="h-3.5 w-3.5" />
            </div>
            <p className="text-[11px] text-slate-400">Gas</p>
            <p className="mt-0.5 text-[30px] leading-none font-semibold text-white">{kpis.totalGas.toFixed(1)} <span className="text-base">m³</span></p>
          </article>
          <article className="rounded-xl border border-shell-600 bg-shell-900 px-4 py-2.5">
            <div className="mb-1 inline-flex rounded-md bg-emerald-50 p-1 text-emerald-500">
              <Leaf className="h-3.5 w-3.5" />
            </div>
            <p className="text-[11px] text-slate-400">Carbon</p>
            <p className="mt-0.5 text-[30px] leading-none font-semibold text-white">{kpis.totalCarbon.toFixed(1)} <span className="text-base">t CO₂</span></p>
          </article>
          <article className="rounded-xl border border-shell-600 bg-shell-900 px-4 py-2.5">
            <div className="mb-1 inline-flex rounded-md bg-emerald-50 p-1 text-emerald-500">
              <DollarSign className="h-3.5 w-3.5" />
            </div>
            <p className="text-[11px] text-slate-400">Cost</p>
            <p className="mt-0.5 text-[30px] leading-none font-semibold text-white">${kpis.totalCost.toLocaleString()}</p>
          </article>
        </div>

        <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-[1.5fr_0.7fr_0.7fr_auto]">
          <label className="flex items-center gap-2 rounded-lg border border-shell-600 bg-shell-900 px-3 py-2">
            <Search className="h-4 w-4 text-slate-500" />
            <input
              className="w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-500"
              placeholder="Search sites..."
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
            />
          </label>
          <select
            className="rounded-lg border border-shell-600 bg-shell-900 px-3 py-2 text-sm text-slate-100 outline-none"
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value as (typeof typeOptions)[number])}
          >
            {typeOptions.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
          <select
            className="rounded-lg border border-shell-600 bg-shell-900 px-3 py-2 text-sm text-slate-100 outline-none"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as (typeof statusOptions)[number])}
          >
            {statusOptions.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
          <div className="inline-flex rounded-lg border border-shell-600 bg-shell-900 p-1">
            <button
              onClick={() => setViewMode("map")}
              className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs ${viewMode === "map" ? "bg-emerald-500 text-white" : "text-slate-400"}`}
            >
              <MapPinned className="h-3.5 w-3.5" />
              Map
            </button>
            <button
              onClick={() => setViewMode("table")}
              className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs ${viewMode === "table" ? "bg-emerald-500 text-white" : "text-slate-400"}`}
            >
              <List className="h-3.5 w-3.5" />
              Table
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[2.15fr_1fr]">
          <section className="relative overflow-hidden rounded-xl border border-shell-600 bg-shell-800">
            {viewMode === "map" ? (
              <div className="relative h-[300px] w-full">
                <div ref={mapContainerRef} className="h-full w-full" />
                {selectedSite ? (
                  <div className="absolute left-1/2 top-1/2 w-56 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-shell-600 bg-shell-900 p-3 text-left shadow-soft">
                    <p className="text-sm font-semibold text-white">{selectedSite.name}</p>
                    <p className="mt-2 text-xs text-slate-400">{selectedSite.address}</p>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="max-h-[300px] overflow-auto">
                <table className="w-full border-collapse text-sm">
                  <thead className="bg-shell-700">
                    <tr className="text-left text-xs text-slate-400">
                      <th className="px-3 py-2">Site</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSites.map((site) => (
                      <tr key={site.id} className="cursor-pointer border-t border-shell-600 hover:bg-shell-700" onClick={() => setSelectedSiteId(site.id)}>
                        <td className="px-3 py-2">{site.name}</td>
                        <td className="px-3 py-2 text-slate-300">{site.type}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium ${site.status === "Operational" ? "bg-emerald-500 text-white" : "bg-slate-600 text-white"}`}>
                            {site.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <aside className="rounded-xl border border-shell-600 bg-shell-800 p-4">
            {selectedSiteMetrics ? (
              <div className="space-y-3">
                <div>
                  <h3 className="text-xl font-semibold text-white">{selectedSiteMetrics.name}</h3>
                  <p className="text-sm text-slate-400">{selectedSiteMetrics.address}</p>
                </div>
                <div className="flex gap-2 text-xs">
                  <span className="rounded bg-shell-700 px-2 py-1 text-slate-300">{selectedSiteMetrics.type}</span>
                  <span className={`rounded px-2 py-1 text-white ${selectedSiteMetrics.status === "Operational" ? "bg-emerald-500" : "bg-slate-600"}`}>{selectedSiteMetrics.status}</span>
                </div>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <dt className="text-slate-400">GFA</dt>
                  <dd className="text-right">{selectedSiteMetrics.gfa.toLocaleString()} m²</dd>
                  <dt className="text-slate-400">Electricity</dt>
                  <dd className="text-right">{selectedSiteMetrics.electricity.toLocaleString()} kWh</dd>
                  <dt className="text-slate-400">Water</dt>
                  <dd className="text-right">{selectedSiteMetrics.water.toFixed(1)} m³</dd>
                  <dt className="text-slate-400">Gas</dt>
                  <dd className="text-right">{selectedSiteMetrics.gas.toFixed(1)} m³</dd>
                  <dt className="text-slate-400">Carbon</dt>
                  <dd className="text-right">{selectedSiteMetrics.carbon.toFixed(2)} t CO₂</dd>
                  <dt className="text-slate-400">Cost</dt>
                  <dd className="text-right">${selectedSiteMetrics.cost.toLocaleString()}</dd>
                  <dt className="text-slate-400">EUI</dt>
                  <dd className="text-right">{selectedSiteMetrics.eui.toFixed(1)} kWh/m²</dd>
                </dl>
                <div className="flex items-center justify-between border-t border-shell-600 pt-3">
                  <span className="text-sm text-rose-500">{selectedSiteMetrics.alarms} Active Alarms</span>
                  <button className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-600">Go to Site</button>
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-[300px] items-center justify-center text-center text-slate-400">
                Click a marker on the map to view site details
              </div>
            )}
          </aside>
        </div>
      </section>

      <section className="mt-4 rounded-xl border border-shell-600 bg-shell-800" ref={tableFilterRef}>
        <header className="border-b border-shell-600 px-4 py-3">
          <h2 className="text-lg font-semibold text-white">Asset Performance Ranking</h2>
        </header>
        <div className="min-h-[360px] overflow-x-auto">
          <table className="w-full table-fixed border-collapse text-sm">
            <colgroup>
              <col style={{ width: "18%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "14%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "9%" }} />
              <col style={{ width: "9%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "9%" }} />
            </colgroup>
            <thead className="bg-shell-700 text-[11px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Site</th>
                <th className="relative px-4 py-3 text-left font-medium">
                  <button
                    type="button"
                    onClick={() => setActiveFilterMenu((current) => (current === "type" ? null : "type"))}
                    className="inline-flex items-center gap-1 text-slate-400 hover:text-white"
                  >
                    Type
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                  {activeFilterMenu === "type" ? (
                    <div className="absolute left-4 top-10 z-20 w-44 rounded-lg border border-shell-600 bg-shell-900 p-2 shadow-soft">
                      <div className="mb-2 flex items-center justify-between text-xs">
                        <button type="button" onClick={resetTypeFilter} className="text-slate-400 hover:text-white">
                          Select all
                        </button>
                        <button type="button" onClick={invertTypeFilter} className="text-slate-400 hover:text-white">
                          Invert
                        </button>
                      </div>
                      <div className="space-y-1">
                        {tableTypeValues.map((item) => (
                          <label key={item} className="flex items-center gap-2 rounded px-2 py-1 text-xs text-slate-300 hover:bg-shell-700">
                            <input type="checkbox" checked={tableTypeFilters.includes(item)} onChange={() => toggleTypeFilter(item)} />
                            <span>{item}</span>
                          </label>
                        ))}
                      </div>
                      <div className="mt-2 flex items-center justify-between border-t border-shell-600 pt-2 text-xs">
                        <button type="button" onClick={resetTypeFilter} className="text-slate-400 hover:text-white">
                          Reset
                        </button>
                        <button type="button" onClick={() => setActiveFilterMenu(null)} className="font-medium text-emerald-600 hover:text-emerald-700">
                          Done
                        </button>
                      </div>
                    </div>
                  ) : null}
                </th>
                <th className="relative px-4 py-3 text-left font-medium">
                  <button
                    type="button"
                    onClick={() => setActiveFilterMenu((current) => (current === "status" ? null : "status"))}
                    className="inline-flex items-center gap-1 text-slate-400 hover:text-white"
                  >
                    Status
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                  {activeFilterMenu === "status" ? (
                    <div className="absolute left-4 top-10 z-20 w-44 rounded-lg border border-shell-600 bg-shell-900 p-2 shadow-soft">
                      <div className="mb-2 flex items-center justify-between text-xs">
                        <button type="button" onClick={resetStatusFilter} className="text-slate-400 hover:text-white">
                          Select all
                        </button>
                        <button type="button" onClick={invertStatusFilter} className="text-slate-400 hover:text-white">
                          Invert
                        </button>
                      </div>
                      <div className="space-y-1">
                        {tableStatusValues.map((item) => (
                          <label key={item} className="flex items-center gap-2 rounded px-2 py-1 text-xs text-slate-300 hover:bg-shell-700">
                            <input type="checkbox" checked={tableStatusFilters.includes(item)} onChange={() => toggleStatusFilter(item)} />
                            <span>{item}</span>
                          </label>
                        ))}
                      </div>
                      <div className="mt-2 flex items-center justify-between border-t border-shell-600 pt-2 text-xs">
                        <button type="button" onClick={resetStatusFilter} className="text-slate-400 hover:text-white">
                          Reset
                        </button>
                        <button type="button" onClick={() => setActiveFilterMenu(null)} className="font-medium text-emerald-600 hover:text-emerald-700">
                          Done
                        </button>
                      </div>
                    </div>
                  ) : null}
                </th>
                <th className="px-4 py-3 text-right font-medium">
                  <button type="button" onClick={() => toggleSort("electricity")} className="ml-auto inline-flex items-center gap-1 hover:text-white">
                    Electricity (kWh) <span className={`text-[11px] font-semibold ${sortMarkClass("electricity")}`}>{sortMark("electricity")}</span>
                  </button>
                </th>
                <th className="px-4 py-3 text-right font-medium">
                  <button type="button" onClick={() => toggleSort("water")} className="ml-auto inline-flex items-center gap-1 hover:text-white">
                    Water (m³) <span className={`text-[11px] font-semibold ${sortMarkClass("water")}`}>{sortMark("water")}</span>
                  </button>
                </th>
                <th className="px-4 py-3 text-right font-medium">
                  <button type="button" onClick={() => toggleSort("gas")} className="ml-auto inline-flex items-center gap-1 hover:text-white">
                    Gas (m³) <span className={`text-[11px] font-semibold ${sortMarkClass("gas")}`}>{sortMark("gas")}</span>
                  </button>
                </th>
                <th className="px-4 py-3 text-right font-medium">
                  <button type="button" onClick={() => toggleSort("eui")} className="ml-auto inline-flex items-center gap-1 hover:text-white">
                    EUI (kWh/m²) <span className={`text-[11px] font-semibold ${sortMarkClass("eui")}`}>{sortMark("eui")}</span>
                  </button>
                </th>
                <th className="px-4 py-3 text-right font-medium">
                  <button type="button" onClick={() => toggleSort("cost")} className="ml-auto inline-flex items-center gap-1 hover:text-white">
                    Cost ($) <span className={`text-[11px] font-semibold ${sortMarkClass("cost")}`}>{sortMark("cost")}</span>
                  </button>
                </th>
                <th className="px-4 py-3 text-right font-medium">Alarms</th>
              </tr>
            </thead>
            <tbody>
              {visibleSites.map((site) => (
                <tr key={site.id} className="cursor-pointer border-t border-shell-600 hover:bg-shell-700" onClick={() => setSelectedSiteId(site.id)}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-white">{site.name}</p>
                    <p className="text-xs text-slate-400">{site.address}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-300">{site.type}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium ${site.status === "Operational" ? "bg-emerald-500 text-white" : "bg-slate-600 text-white"}`}>{site.status}</span>
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-emerald-300">{site.electricity.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-medium text-sky-300">{site.water.toFixed(2)}</td>
                  <td className="px-4 py-3 text-right font-medium text-amber-300">{site.gas.toFixed(1)}</td>
                  <td className="px-4 py-3 text-right font-medium text-teal-300">{site.eui.toFixed(1)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-emerald-300">${site.cost.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`inline-flex min-w-7 justify-center rounded-md px-2 py-1 text-xs font-semibold text-white ${site.alarms >= 8 ? "bg-rose-500" : "bg-emerald-500"}`}>{site.alarms}</span>
                  </td>
                </tr>
              ))}
              {visibleSites.length === 0 ? (
                <tr className="border-t border-slate-100">
                  <td className="px-4 py-24 text-center text-sm text-slate-400" colSpan={9}>
                    No records match current table filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
