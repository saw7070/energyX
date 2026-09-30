"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { EnergyIcon } from "./icons";
import { useEnergyIqAccess } from "./energyiq-access";
import {
  buildDecisionDashboardModel,
  type DashboardInsight,
  type DecisionDashboardModel,
} from "./decision-dashboard-model";
import {
  configApi,
  type EnergyScopeAnalysisDto,
  type EnergyQueryContextRequestDto,
} from "../../../lib/config-api";

const waterTrend = [
  { day: "01 Jul", current: 11.8, baseline: 10.9 },
  { day: "05 Jul", current: 11.2, baseline: 10.7 },
  { day: "09 Jul", current: 12.1, baseline: 10.8 },
  { day: "13 Jul", current: 11.4, baseline: 10.9 },
  { day: "17 Jul", current: 13.8, baseline: 11.1 },
  { day: "21 Jul", current: 14.2, baseline: 11.2 },
  { day: "25 Jul", current: 12.9, baseline: 11.0 },
  { day: "29 Jul", current: 12.0, baseline: 10.8 },
];

const waterRanking = [
  { scope: "Block B", value: 142, change: 21 },
  { scope: "Block A", value: 118, change: 5 },
  { scope: "Block C", value: 96, change: -4 },
];

type ResourceType = "electricity" | "water";

type Insight = DashboardInsight;

const waterInsights: Insight[] = [
    {
      id: "block-b-water",
      scopeId: "project",
      severity: "high",
      scope: "Block B · Level 2",
      title: "Continuous water flow detected overnight",
      finding: "A stable flow persisted from 02:15–05:30, 63% above this meter's own night-time baseline.",
      impact: "Estimated 4.8 m³ above baseline",
      action: "Inspect washrooms and pantry supply points on Level 2 for a tap left open or a possible leak.",
      evidence: "13 consecutive 15-minute intervals exceeded the configured minimum-flow rule.",
    },
    {
      id: "block-a-water",
      scopeId: "project",
      severity: "medium",
      scope: "Block A",
      title: "Water use increased despite stable operating hours",
      finding: "The selected period is 12% above the previous 30-day period.",
      impact: "Estimated 13.1 m³ increase",
      action: "Review cleaning schedules and compare Level 1 and Level 3 usage before escalating.",
      evidence: "Current period 121.9 m³ vs previous period 108.8 m³.",
    },
];

const periods = ["Yesterday", "Last 7 days", "Last 30 days", "Custom"] as const;

const reportSections = [
  { id: "overview", label: "Overview", number: "01" },
  { id: "benchmarks", label: "Benchmarks", number: "02" },
  { id: "standby", label: "Standby wastage", number: "03" },
  { id: "operating", label: "Operating hours", number: "04" },
  { id: "forecast", label: "Forecast preview", number: "05" },
] as const;

export function DecisionDashboard() {
  const { activeProject } = useEnergyIqAccess();
  const [resource, setResource] = useState<ResourceType>("electricity");
  const [period, setPeriod] = useState<(typeof periods)[number]>("Custom");
  const [selectedInsight, setSelectedInsight] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [runMessage, setRunMessage] = useState("Waiting for project context…");
  const [activeSection, setActiveSection] = useState<(typeof reportSections)[number]["id"]>("overview");
  const [analysis, setAnalysis] = useState<EnergyScopeAnalysisDto | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [refreshRevision, setRefreshRevision] = useState(0);

  const activeProjectId = activeProject?.id;
  const currentAnalysis = analysis?.context.projectId === activeProjectId ? analysis : null;
  const dashboard = useMemo(
    () => currentAnalysis ? buildDecisionDashboardModel(currentAnalysis) : null,
    [currentAnalysis],
  );

  useEffect(() => {
    if (!activeProjectId || resource !== "electricity") return;
    let cancelled = false;
    const request = overviewAnalysisRequest(activeProjectId, period);
    setIsRunning(true);
    setAnalysisError(null);
    setRunMessage(`Resolving ${activeProject?.name ?? "project"} scope and facts…`);
    void configApi.executeEnergyScopeAnalysis(request)
      .then((result) => {
        if (cancelled) return;
        setAnalysis(result);
        setSelectedInsight(null);
        setRunMessage(`${formatRunPeriod(result)} · ${result.provenance.dataSnapshotId}`);
      })
      .catch((reason) => {
        if (cancelled) return;
        setAnalysis(null);
        setAnalysisError(reason instanceof Error ? reason.message : "Unable to run project analysis");
        setRunMessage("Analysis could not be completed");
      })
      .finally(() => {
        if (!cancelled) setIsRunning(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProject?.name, activeProjectId, period, refreshRevision, resource]);

  const resourceInsights = resource === "electricity"
    ? dashboard?.insights ?? [loadingInsight(activeProject?.name)]
    : waterInsights;
  const activeInsight = resourceInsights.find((item) => item.id === selectedInsight) ?? resourceInsights[0]!;
  const trend = resource === "electricity" ? dashboard?.trend ?? [] : waterTrend;
  const ranking = resource === "electricity" ? dashboard?.ranking ?? [] : waterRanking;
  const unit = resource === "electricity" ? "kW" : "m³";
  const summary = useMemo(
    () =>
      resource === "electricity"
        ? dashboard?.summary ?? loadingSummary()
        : [
            { label: "Total consumption", value: "356 m³", note: "+11.8% vs own history", tone: "warning" },
            { label: "Estimated cost", value: "S$1,022", note: "Tariff v1 · S$2.87/m³", tone: "muted" },
            { label: "Night-time share", value: "9.2%", note: "Target below 5%", tone: "warning" },
            { label: "Data completeness", value: "100%", note: "All intervals received", tone: "success" },
          ],
    [dashboard, resource],
  );
  const currentBenchmarkRows = dashboard?.benchmarkRows ?? [];
  const currentOperatingMix = dashboard?.operatingMix ?? [];
  const currentTimeProfile = dashboard?.timeProfile ?? [];
  const topTimeBand = currentTimeProfile.slice().sort((left, right) => right.average - left.average)[0];
  const peakTimeBand = currentTimeProfile.slice().sort((left, right) => right.peak - left.peak)[0];
  const visibleReportSections = useMemo(
    () => (resource === "electricity" ? reportSections : reportSections.slice(0, 1)),
    [resource],
  );

  useEffect(() => {
    const elements = visibleReportSections
      .map((section) => document.getElementById(section.id))
      .filter((element): element is HTMLElement => Boolean(element));
    if (elements.length === 0) return;
    const scrollContainer = elements[0]?.closest("main");
    if (!scrollContainer) return;

    const updateActiveSection = () => {
      const readingLine = 168;
      const passed = elements.filter(
        (element) => element.getBoundingClientRect().top <= readingLine,
      );
      const current = passed.at(-1) ?? elements[0];
      setActiveSection(
        current.id as (typeof reportSections)[number]["id"],
      );
    };

    updateActiveSection();
    scrollContainer.addEventListener("scroll", updateActiveSection, {
      passive: true,
    });
    return () =>
      scrollContainer.removeEventListener("scroll", updateActiveSection);
  }, [visibleReportSections]);

  function runAnalysis() {
    setRefreshRevision((current) => current + 1);
  }

  return (
    <div className="mx-auto w-full max-w-[1480px] px-4 py-6 lg:px-8 lg:py-8">
      <section className="flex flex-col gap-5 border-b border-border pb-6 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted">
            <span>{activeProject?.name ?? "Ngee Ann Polytechnic"}</span>
            <EnergyIcon name="chevron" className="h-3 w-3" />
            <span>Energy analysis</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Energy & water analysis</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted">
            Prioritised actions for the selected period, supported by project-level evidence.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-border bg-surface p-1" aria-label="Resource type">
            <button
              type="button"
              onClick={() => {
                setResource("electricity");
                setSelectedInsight(null);
                setActiveSection("overview");
              }}
              className={[
                "flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors",
                resource === "electricity"
                  ? "bg-primary text-white"
                  : "text-muted hover:bg-surface-subtle hover:text-foreground",
              ].join(" ")}
            >
              <EnergyIcon name="bolt" className="h-3.5 w-3.5" />
              Electricity
            </button>
            <button
              type="button"
              onClick={() => {
                setResource("water");
                setSelectedInsight("block-b-water");
                setActiveSection("overview");
              }}
              className={[
                "flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors",
                resource === "water"
                  ? "bg-primary text-white"
                  : "text-muted hover:bg-surface-subtle hover:text-foreground",
              ].join(" ")}
            >
              <EnergyIcon name="water" className="h-3.5 w-3.5" />
              Water
            </button>
          </div>

          <div className="flex max-w-full overflow-x-auto rounded-lg border border-border bg-surface p-1">
            {periods.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setPeriod(item)}
                className={[
                  "h-8 whitespace-nowrap rounded-md px-2.5 text-xs font-medium transition-colors",
                  period === item
                    ? "bg-surface-subtle text-foreground shadow-sm"
                    : "text-muted hover:text-foreground",
                ].join(" ")}
              >
                {item}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={runAnalysis}
            disabled={isRunning}
            className="h-10 rounded-lg bg-primary px-4 text-xs font-semibold text-white transition-colors hover:bg-primary-light disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
          >
            {isRunning ? "Running…" : "Run analysis"}
          </button>
        </div>
      </section>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-light">
        <span>{runMessage}</span>
        <button type="button" className="font-medium text-muted underline-offset-4 hover:text-foreground hover:underline">
          View history & calculation
        </button>
      </div>
      {analysisError ? (
        <p className="mt-4 rounded-lg border border-step-error/25 bg-step-error/5 px-4 py-3 text-xs text-step-error">
          {analysisError}
        </p>
      ) : null}

      <div className="mt-5 lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:items-start lg:gap-8 xl:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-6">
          <p className="mb-2 hidden px-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-light lg:block">
            Report sections
          </p>
          <nav
            className="flex max-w-full gap-1 overflow-x-auto rounded-lg border border-border bg-surface p-1 lg:flex-col lg:overflow-visible"
            aria-label="Analysis report sections"
          >
            {visibleReportSections.map((section) => {
              const active = activeSection === section.id;
              return (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  onClick={() => setActiveSection(section.id)}
                  aria-current={active ? "location" : undefined}
                  className={[
                    "group flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-xs font-medium transition-colors lg:min-h-10 lg:w-full",
                    active
                      ? "bg-primary text-white"
                      : "text-muted hover:bg-surface-subtle hover:text-foreground",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "text-[10px] tabular-nums",
                      active ? "text-white/65" : "text-muted-light",
                    ].join(" ")}
                  >
                    {section.number}
                  </span>
                  <span>{section.label}</span>
                </a>
              );
            })}
          </nav>
          <p className="mt-3 hidden px-3 text-[11px] leading-5 text-muted-light lg:block">
            Jump between the published sections of this project template.
          </p>
        </aside>

        <div className="min-w-0">
      <section id="overview" className="mt-6 scroll-mt-24 overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-card)] lg:mt-0">
        <div className="grid xl:grid-cols-[1.15fr_0.85fr]">
          <div className="border-b border-border p-5 sm:p-6 xl:border-b-0 xl:border-r">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-step-warning/10 text-step-warning">
                <EnergyIcon name="spark" className="h-4.5 w-4.5" />
              </span>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-light">
                  Recommended first action
                </p>
                <h2 className="mt-1 text-lg font-semibold tracking-tight text-foreground">{activeInsight.title}</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{activeInsight.finding}</p>
              </div>
            </div>
            <div className="mt-5 rounded-lg border-l-2 border-primary bg-surface-subtle px-4 py-3">
              <p className="text-xs font-semibold text-foreground">Suggested action</p>
              <p className="mt-1 text-sm leading-6 text-muted">{activeInsight.action}</p>
            </div>
          </div>

          <div className="grid content-start gap-4 p-5 sm:grid-cols-2 sm:p-6 xl:grid-cols-1">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-light">Estimated impact</p>
              <p className="mt-1 text-sm font-medium text-foreground">{activeInsight.impact}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-light">Evidence</p>
              <p className="mt-1 text-sm leading-5 text-muted">{activeInsight.evidence}</p>
            </div>
            <div className="flex flex-wrap gap-2 sm:col-span-2 xl:col-span-1">
              <a
                href="/energyiq/project-configuration?tab=devices"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-semibold text-foreground transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
              >
                View devices
                <EnergyIcon name="arrow" className="h-3.5 w-3.5" />
              </a>
              <a
                href={buildOverviewAiHref({
                  projectId: activeProjectId ?? "",
                  projectName: activeProject?.name ?? "",
                  scopeId: activeInsight.scopeId,
                  scopeName: activeInsight.scope,
                  resource,
                  period,
                })}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-medium text-muted transition-colors hover:bg-surface-subtle hover:text-foreground"
              >
                Investigate with the advisor
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-6 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 xl:grid-cols-4">
        {summary.map((metric) => (
          <div key={metric.label} className="bg-surface px-5 py-4">
            <p className="text-[11px] font-medium text-muted-light">{metric.label}</p>
            <p className="mt-2 tabular text-xl font-semibold tracking-tight text-foreground">{metric.value}</p>
            <p
              className={[
                "mt-1 text-[11px]",
                metric.tone === "warning"
                  ? "text-step-warning"
                  : metric.tone === "success"
                    ? "text-step-success"
                    : "text-muted-light",
              ].join(" ")}
            >
              {metric.note}
            </p>
          </div>
        ))}
      </section>

      <section className="mt-8 grid gap-6 xl:grid-cols-[1.55fr_0.9fr]">
        <div>
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                {resource === "electricity" ? "Hourly operating profile" : "Consumption against own history"}
              </h2>
              <p className="mt-1 text-xs text-muted-light">
                {resource === "electricity"
                  ? "Average demand and observed peak by hour across the selected period"
                  : "Current period compared with the same time pattern baseline"}
              </p>
            </div>
            <span className="text-[11px] text-muted-light">{resource === "electricity" ? "Average power · kW" : `${unit} per day`}</span>
          </div>
          <div className="h-[310px] rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id={`energy-fill-${resource}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4d6f96" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="#4d6f96" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#ececf0" strokeDasharray="3 4" vertical={false} />
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#8a8a99" }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: "#8a8a99" }} />
                <Tooltip
                  contentStyle={{
                    border: "1px solid #ececf0",
                    borderRadius: 8,
                    boxShadow: "0 8px 24px rgba(13,13,13,.08)",
                    fontSize: 12,
                  }}
                  formatter={(value, name) => [
                    `${Number(value).toFixed(resource === "water" ? 1 : 0)} ${unit}`,
                    resource === "electricity"
                      ? name === "current" ? "Hourly average" : "Observed peak"
                      : name === "current" ? "Current" : "Historical baseline",
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="baseline"
                  stroke="#a3a3a3"
                  strokeWidth={1.5}
                  strokeDasharray="5 4"
                  fill="none"
                  dot={false}
                />
                <Area
                  type="monotone"
                  dataKey="current"
                  stroke="#4d6f96"
                  strokeWidth={2}
                  fill={`url(#energy-fill-${resource})`}
                  dot={false}
                  activeDot={{ r: 4, fill: "#4d6f96", stroke: "#fff", strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div>
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-foreground">Highest-consuming scopes</h2>
            <p className="mt-1 text-xs text-muted-light">Absolute usage; area-normalised comparison appears when metadata is available</p>
          </div>
          <div className="h-[310px] rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ranking} layout="vertical" margin={{ top: 12, right: 22, left: 6, bottom: 4 }}>
                <CartesianGrid stroke="#ececf0" strokeDasharray="3 4" horizontal={false} />
                <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#8a8a99" }} />
                <YAxis
                  type="category"
                  dataKey="scope"
                  width={64}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 11, fill: "#4d4d4d" }}
                />
                <Tooltip
                  cursor={{ fill: "#f7f7f8" }}
                  contentStyle={{
                    border: "1px solid #ececf0",
                    borderRadius: 8,
                    boxShadow: "0 8px 24px rgba(13,13,13,.08)",
                    fontSize: 12,
                  }}
                  formatter={(value) => [`${Number(value).toLocaleString()} ${resource === "electricity" ? "kWh" : unit}`, "Consumption"]}
                />
                <Bar dataKey="value" fill="#74628f" radius={[0, 5, 5, 0]} maxBarSize={24} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      {resource === "electricity" ? (
        <>
          <section id="benchmarks" className="mt-10 scroll-mt-24">
            <ReportSectionHeading
              number="02"
              title="Benchmark analysis"
              description="Charles template adapted to this project's hierarchy. Absolute use is shown alongside area and occupant-normalised views."
            />
            <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
              <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-card)]">
                <div className="border-b border-border px-5 py-4">
                  <h3 className="text-sm font-semibold text-foreground">Scope efficiency comparison</h3>
                  <p className="mt-1 text-xs text-muted-light">
                    Published scope metadata · absolute, area and occupant-normalised views
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[680px] text-left text-xs">
                    <thead className="bg-surface-subtle text-[10px] uppercase tracking-[0.06em] text-muted-light">
                      <tr>
                        <th className="px-5 py-3 font-semibold">Scope</th>
                        <th className="px-4 py-3 text-right font-semibold">Energy</th>
                        <th className="px-4 py-3 text-right font-semibold">kWh / m²</th>
                        <th className="px-4 py-3 text-right font-semibold">kWh / person</th>
                        <th className="px-5 py-3 text-right font-semibold">Project share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentBenchmarkRows.map((row) => (
                        <tr key={row.scope} className="border-t border-border">
                          <td className="px-5 py-4 font-semibold text-foreground">{row.scope}</td>
                          <td className="px-4 py-4 text-right tabular-nums text-muted">{row.energy.toLocaleString()} kWh</td>
                          <td className="px-4 py-4 text-right tabular-nums text-muted">{row.eui?.toFixed(2) ?? "—"}</td>
                          <td className="px-4 py-4 text-right tabular-nums text-muted">{row.perPerson?.toFixed(1) ?? "—"}</td>
                          <td className="px-5 py-4 text-right font-medium text-step-warning">{row.sharePct.toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-xl border border-step-warning/25 bg-step-warning/5 p-5 shadow-[var(--shadow-card)]">
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-step-warning">Benchmark finding</p>
                <h3 className="mt-2 text-base font-semibold text-foreground">
                  {currentBenchmarkRows[0]?.scope ?? "No child scope"} has the highest selected-period consumption
                </h3>
                <p className="mt-2 text-sm leading-6 text-muted">
                  {currentBenchmarkRows[0]
                    ? `${currentBenchmarkRows[0].energy.toLocaleString(undefined, { maximumFractionDigits: 1 })} kWh, ${currentBenchmarkRows[0].sharePct.toFixed(1)}% of ${activeProject?.name ?? "the project"}.`
                    : "No child-scope comparison is available for this selection."}
                </p>
                <div className="mt-4 border-t border-step-warning/20 pt-4">
                  <p className="text-xs font-semibold text-foreground">Decision</p>
                  <p className="mt-1 text-xs leading-5 text-muted">
                    Investigate time-of-use and load composition before treating floor size as the main cause.
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section id="standby" className="mt-10 scroll-mt-24">
            <ReportSectionHeading
              number="03"
              title="Standby energy wastage"
              description="Post-operating consumption is separated from active-hour demand and ranked by load family."
            />
            <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
              <div className="h-[330px] rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
                <div className="mb-2 flex items-end justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Operating vs off-hours energy</h3>
                    <p className="mt-1 text-xs text-muted-light">
                      Published business calendar: {currentAnalysis?.context.businessCalendarVersion ?? "loading"}
                    </p>
                  </div>
                  <span className="text-[10px] text-muted-light">kWh</span>
                </div>
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={currentOperatingMix} margin={{ top: 12, right: 10, left: -18, bottom: 0 }}>
                      <CartesianGrid stroke="#ececf0" strokeDasharray="3 4" vertical={false} />
                      <XAxis dataKey="category" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#6b6b76" }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#8a8a99" }} />
                      <Tooltip
                        contentStyle={{ border: "1px solid #ececf0", borderRadius: 8, fontSize: 12 }}
                        formatter={(value, name) => [`${Number(value).toLocaleString()} kWh`, name === "operating" ? "Operating" : "Off-hours"]}
                      />
                      <Bar dataKey="operating" stackId="hours" fill="#4d6f96" radius={[0, 0, 0, 0]} maxBarSize={44} />
                      <Bar dataKey="offHours" stackId="hours" fill="#b9794d" radius={[5, 5, 0, 0]} maxBarSize={44} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-card)]">
                <div className="border-b border-border px-5 py-4">
                  <h3 className="text-sm font-semibold text-foreground">Standby priority</h3>
                  <p className="mt-1 text-xs text-muted-light">Highest avoidable contribution first</p>
                </div>
                {currentOperatingMix
                  .slice()
                  .sort((a, b) => b.offHours - a.offHours)
                  .map((row, index) => (
                    <div key={row.category} className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-5 py-4 last:border-b-0">
                      <span className="text-xs font-semibold text-muted-light">{index + 1}</span>
                      <div>
                        <p className="text-sm font-semibold text-foreground">{row.category}</p>
                        <p className="mt-1 text-xs text-muted">{Math.round((row.offHours / (row.operating + row.offHours)) * 100)}% occurs off-hours</p>
                      </div>
                      <span className="text-sm font-semibold tabular-nums text-step-warning">{row.offHours} kWh</span>
                    </div>
                  ))}
              </div>
            </div>
          </section>

          <section id="operating" className="mt-10 scroll-mt-24">
            <ReportSectionHeading
              number="04"
              title="Operating-hour and time-pattern analysis"
              description="The same consumption is sliced by hour and day type so the user can see when demand occurs, not only how much."
            />
            <div className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
              <div className="h-[330px] rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow-card)]">
                <div className="mb-2 flex items-end justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">Average load by time band</h3>
                    <p className="mt-1 text-xs text-muted-light">Selected-period hourly average and observed peak</p>
                  </div>
                  <span className="text-[10px] text-muted-light">average kW</span>
                </div>
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={currentTimeProfile} margin={{ top: 12, right: 10, left: -18, bottom: 0 }}>
                      <CartesianGrid stroke="#ececf0" strokeDasharray="3 4" vertical={false} />
                      <XAxis dataKey="slot" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#6b6b76" }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#8a8a99" }} />
                      <Tooltip
                        contentStyle={{ border: "1px solid #ececf0", borderRadius: 8, fontSize: 12 }}
                        formatter={(value, name) => [`${Number(value).toFixed(1)} kW`, name === "average" ? "Average" : "Observed peak"]}
                      />
                      <Bar dataKey="average" fill="#4d6f96" radius={[4, 4, 0, 0]} maxBarSize={30} />
                      <Bar dataKey="peak" fill="#b9b7bf" radius={[4, 4, 0, 0]} maxBarSize={30} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="rounded-xl border border-border bg-surface p-5 shadow-[var(--shadow-card)]">
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-light">Time finding</p>
                <h3 className="mt-2 text-base font-semibold text-foreground">
                  {topTimeBand?.slot ?? "No time band"} has the highest average demand
                </h3>
                <p className="mt-2 text-sm leading-6 text-muted">
                  This section now uses the selected Project&apos;s hourly facts. It does not claim a historical deviation until a published baseline query is available.
                </p>
                <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-border pt-4 text-xs">
                  <div>
                    <dt className="text-muted-light">Highest average band</dt>
                    <dd className="mt-1 font-semibold text-foreground">{topTimeBand?.slot ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-light">Highest observed peak</dt>
                    <dd className="mt-1 font-semibold text-foreground">{peakTimeBand ? `${peakTimeBand.peak.toFixed(1)} kW` : "—"}</dd>
                  </div>
                </dl>
              </div>
            </div>
          </section>

          <section id="forecast" className="mt-10 scroll-mt-24">
            <ReportSectionHeading
              number="05"
              title="Forecast preview"
              description="Retained from Charles's template as a preview, but not treated as decision-grade until enough historical data is available."
            />
            <div className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3">
              <ForecastMetric label="Selected-period reference" value={dashboard?.forecast.projectedUsage ?? "—"} note={dashboard?.periodLabel ?? "Loading period"} />
              <ForecastMetric label="Selected-period cost" value={dashboard?.forecast.projectedCost ?? "—"} note={currentAnalysis?.context.tariffScheduleVersion ?? "Loading tariff"} />
              <ForecastMetric label="Forecast readiness" value={dashboard?.forecast.readiness ?? "—"} note="Needs ≥3 complete months for release" />
            </div>
          </section>
        </>
      ) : null}

      <section className="mt-10">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Priority exceptions</h2>
            <p className="mt-1 text-xs text-muted-light">Deterministic rules only · possible causes are labelled as hypotheses</p>
          </div>
          <span className="rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] text-muted">
            {resourceInsights.length} items
          </span>
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow-card)]">
          {resourceInsights.map((item, index) => {
            const active = activeInsight.id === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedInsight(item.id)}
                className={[
                  "grid w-full gap-3 border-b border-border px-4 py-4 text-left transition-colors last:border-b-0 md:grid-cols-[96px_minmax(0,1fr)_auto] md:items-center",
                  active ? "bg-surface-subtle" : "hover:bg-surface-subtle/70",
                ].join(" ")}
              >
                <span
                  className={[
                    "inline-flex w-fit items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.05em]",
                    item.severity === "high"
                      ? "border-step-error/25 bg-step-error/10 text-step-error"
                      : item.severity === "medium"
                        ? "border-step-warning/25 bg-step-warning/10 text-step-warning"
                        : "border-step-inspect/25 bg-step-inspect/10 text-step-inspect",
                  ].join(" ")}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  {item.severity}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-muted">{item.scope}</span>
                  <span className="mt-1 block text-sm font-semibold text-foreground">{item.title}</span>
                  <span className="mt-1 block text-xs leading-5 text-muted">{item.finding}</span>
                </span>
                <span className="flex items-center gap-1 text-xs font-medium text-muted">
                  Review
                  <EnergyIcon name="chevron" className="h-3.5 w-3.5" />
                </span>
              </button>
            );
          })}
        </div>
      </section>
        </div>
      </div>
    </div>
  );
}

function overviewAnalysisRequest(
  projectId: string,
  period: (typeof periods)[number],
): EnergyQueryContextRequestDto {
  const scopeId = projectId === "preschool-demo" ? "preschool-project" : "project";
  if (period !== "Custom") {
    return { projectId, scopeId, resource: "electricity", period };
  }
  const range = demoRangeForProject(projectId);
  return {
    projectId,
    scopeId,
    resource: "electricity",
    period: "Custom",
    from: range.from,
    to: range.to,
  };
}

function demoRangeForProject(projectId: string): { from: string; to: string } {
  return projectId === "preschool-demo"
    ? { from: "2026-05-01", to: "2026-05-31" }
    : { from: "2026-05-19", to: "2026-06-17" };
}

function formatRunPeriod(analysis: EnergyScopeAnalysisDto): string {
  const formatter = new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: analysis.context.timezone,
  });
  const from = formatter.format(new Date(analysis.context.from));
  const to = formatter.format(new Date(new Date(analysis.context.to).getTime() - 1));
  return `${analysis.context.projectName} · ${from}–${to}`;
}

function loadingInsight(projectName?: string): DashboardInsight {
  return {
    id: "loading-project-analysis",
    scopeId: "project",
    severity: "info",
    scope: projectName ?? "Selected project",
    title: "Loading deterministic project analysis",
    finding: "Resolving the selected Project, period, hierarchy and trusted Energy Fact scope.",
    impact: "No result is shown until the scoped queries complete.",
    action: "Wait for the current analysis run to finish.",
    evidence: "Project-aware query in progress",
  };
}

function loadingSummary(): DecisionDashboardModel["summary"] {
  return [
    { label: "Total consumption", value: "—", note: "Loading selected Project", tone: "muted" },
    { label: "Estimated cost", value: "—", note: "Loading tariff version", tone: "muted" },
    { label: "Off-hours share", value: "—", note: "Loading business calendar", tone: "muted" },
    { label: "Data quality", value: "—", note: "Loading interval validation", tone: "muted" },
  ];
}

function buildOverviewAiHref(input: {
  projectId: string;
  projectName: string;
  scopeId: string;
  scopeName: string;
  resource: ResourceType;
  period: (typeof periods)[number];
}): string {
  const params = new URLSearchParams({
    projectId: input.projectId,
    projectName: input.projectName,
    scopeId: input.scopeId,
    scopeName: input.scopeName,
    resource: input.resource,
    period: input.period,
  });
  if (input.period === "Custom") {
    const range = demoRangeForProject(input.projectId);
    params.set("from", range.from);
    params.set("to", range.to);
  }
  return `/energyiq/ai?${params.toString()}`;
}

function ReportSectionHeading({
  number,
  title,
  description,
}: {
  number: string;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <span className="mt-0.5 rounded-md bg-primary px-2 py-1 text-[10px] font-semibold tracking-[0.08em] text-white">
        SECTION {number}
      </span>
      <div>
        <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
        <p className="mt-1 max-w-4xl text-xs leading-5 text-muted">{description}</p>
      </div>
    </div>
  );
}

function ForecastMetric({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="bg-surface px-5 py-5">
      <p className="text-[11px] font-medium text-muted-light">{label}</p>
      <p className="mt-2 text-xl font-semibold tracking-tight text-foreground">{value}</p>
      <p className="mt-1 text-[11px] text-muted">{note}</p>
    </div>
  );
}
