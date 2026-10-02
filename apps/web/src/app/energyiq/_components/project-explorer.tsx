"use client";

import { completeDailyAverage, recentCompleteDates, recentSeriesHealth, analysisDates } from "./explorer-trend-model";

import Link from "next/link";
import { ExplorerTrends } from "./explorer-trends";
import { ExplorerMeterDetail } from "./explorer-meter-detail";
import { ExplorerChildren } from "./explorer-children";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { EnergyIcon, type EnergyIconName } from "./icons";
import { useEnergyIqAccess } from "./energyiq-access";
import { friendlyErrorMessage, isTechnicalMessage } from "./friendly-error";
import { orderProjectNodesDepthFirst, revealProjectTreeSelection } from "./project-tree-model";
import {
  configApi,
  type EnergyProjectNodeDto,
  type EnergyScopeAnalysisDto,
} from "../../../lib/config-api";

type ProjectNode = {
  id: string;
  parentId: string | null;
  type: "project" | "block" | "level" | "centre" | "meter" | "circuit";
  name: string;
  displayType?: string;
  groupScopeId?: string;
  meter?: NonNullable<EnergyScopeAnalysisDto["explorerMeters"]>[number];
  role?: "total" | "submeter" | "virtual";
  category?: "Light" | "Load" | "Aircon";
};

type ExplorerPeriod = "Current 28 days" | "Latest complete day" | "Yesterday" | "Last 7 days" | "Last 30 days" | "Previous week" | "Previous month" | "Custom";
const explorerPeriods: ExplorerPeriod[] = ["Current 28 days", "Yesterday", "Previous week", "Previous month", "Last 7 days", "Last 30 days", "Custom"];

type ExplorerChartView = "daily" | "weekly" | "monthly" | "hourly";

export type ExplorerUrlViewState = {
  projectId: string;
  scopeId: string;
  resource: "electricity" | "water";
  period: ExplorerPeriod;
  from: string;
  to: string;
  dataSnapshotId: string;
  projectReleaseId: string;
  chartView: ExplorerChartView;
};

const typeIcon: Record<ProjectNode["type"], EnergyIconName> = {
  project: "building",
  block: "building",
  level: "floor",
  centre: "building",
  meter: "meter",
  circuit: "meter",
};

export function ProjectExplorer() {
  const searchParams = useSearchParams();
  const initialViewState = explorerViewStateFromSearchParams(searchParams);
  // Internal Scope/Period changes are mirrored into the URL. Keying the whole view by those
  // values remounts the component and repeats the same hierarchy + analysis requests.
  const viewStateKey = [
    initialViewState.projectId,
    initialViewState.dataSnapshotId,
    initialViewState.projectReleaseId,
  ].join(":");
  return <ProjectExplorerView key={viewStateKey} initialViewState={initialViewState} />;
}

function ProjectExplorerView({ initialViewState }: { initialViewState: ExplorerUrlViewState }) {
  const { access, activeProject, selectProject } = useEnergyIqAccess();
  const requestedProject = initialViewState.projectId && access
    ? access.projects.find((candidate) => candidate.id === initialViewState.projectId
      && candidate.status === "published"
      && candidate.workspaceId === access.activeWorkspaceId) ?? null
    : null;
  const selectedProject = initialViewState.projectId ? requestedProject : activeProject;
  const projectSelectionError = initialViewState.projectId && access && !requestedProject
    ? "Requested Project is unavailable in the active workspace."
    : null;
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [resource, setResource] = useState<"electricity" | "water">(initialViewState.resource);
  const [hierarchyNodes, setHierarchyNodes] = useState<ProjectNode[] | null>(null);
  const [hierarchyError, setHierarchyError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<EnergyScopeAnalysisDto | null>(null);
  const [monitoringMode, setMonitoringMode] = useState<"api" | "file" | "unknown">("unknown");
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [snapshotHealthByNode, setSnapshotHealthByNode] = useState<ExplorerSnapshotHealthMap>({});

  const [periodSelection, setPeriodSelection] = useState<ExplorerPeriod>(initialViewState.period);
  const [chartView, setChartView] = useState<ExplorerChartView>(initialViewState.chartView);
  const [customRange, setCustomRange] = useState({
    projectId: initialViewState.projectId,
    from: initialViewState.from,
    to: initialViewState.to,
  });
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  const activeProjectId = selectedProject?.id;

  useEffect(() => {
    if (!requestedProject || requestedProject.id === activeProject?.id) return;
    selectProject(requestedProject.id);
  }, [activeProject?.id, requestedProject, selectProject]);

  useEffect(() => {
    if (
      !activeProjectId
      || periodSelection !== "Custom"
      || customRange.projectId
      || !initialViewState.from
      || !initialViewState.to
    ) return;
    setCustomRange({
      projectId: activeProjectId,
      from: initialViewState.from,
      to: initialViewState.to,
    });
  }, [activeProjectId, customRange.projectId, initialViewState.from, initialViewState.to, periodSelection]);

  useEffect(() => {
    setHierarchyNodes(null);
    setSelectedId("");
    if (!activeProjectId) return;
    let cancelled = false;
    setHierarchyError(null);
    setSnapshotHealthByNode({});
    void configApi.getEnergyProjectHierarchy(activeProjectId)
      .then((hierarchy) => {
        if (cancelled) return;
        const mapped = buildExplorerNavigationNodes(hierarchy.nodes, hierarchy.electricityMeters ?? []);
        const selection = revealProjectTreeSelection(
          mapped,
          defaultExpandedIds(mapped),
          requestedScopeId(mapped, initialViewState.scopeId),
        );
        setHierarchyNodes(mapped);
        setSelectedId(selection.selectedId);
        setExpandedIds(selection.expandedIds);
      })
      .catch((reason) => {
        if (cancelled) return;
        setHierarchyNodes(null);
        setHierarchyError(friendlyErrorMessage(reason, { fallback: "Unable to load project hierarchy" }));
        setSelectedId("");
      });
    return () => {
      cancelled = true;
    };
  }, [activeProjectId, initialViewState.scopeId]);

  const analysisScopeId = hierarchyNodes?.find(node => node.id === selectedId)?.meter?.scopeId ?? selectedId;

  useEffect(() => {
    if (!activeProjectId || !selectedId || resource !== "electricity") {
      setAnalysis(null);
      setAnalysisError(null);
      return;
    }
    let cancelled = false;
    const range = customRange.projectId === activeProjectId
      ? customRange
      : { projectId: activeProjectId, from: "", to: "" };
    if (periodSelection === "Custom" && (!range.from || !range.to || range.from > range.to)) {
      setAnalysis(null);
      setAnalysisError(null);
      return;
    }
    setAnalysisLoading(true);
    setAnalysis(null);
    setAnalysisError(null);
    void configApi.executeEnergyScopeAnalysis(buildExplorerAnalysisRequest({
      projectId: activeProjectId,
      scopeId: analysisScopeId,
      resource,
      period: periodSelection,
      from: periodSelection === "Custom" ? range.from : "",
      to: periodSelection === "Custom" ? range.to : "",
      dataSnapshotId: initialViewState.dataSnapshotId,
      projectReleaseId: initialViewState.projectReleaseId,
    })).then((result) => {
      if (cancelled) return;
      setAnalysis(result);
      setMonitoringMode(result.monitoringMode ?? "unknown");

      setCustomRange((current) => current.projectId === activeProjectId && current.from && current.to
        ? current
        : {
          projectId: activeProjectId,
          from: formatDateInput(result.context.from, result.context.timezone),
          to: formatDateInput(new Date(Date.parse(result.context.to) - 1).toISOString(), result.context.timezone),
        });
    }).catch((reason) => {
      if (cancelled) return;
      setAnalysis(null);
      setAnalysisError(reason instanceof Error ? reason.message : "Unable to load scope analysis");
    }).finally(() => {
      if (!cancelled) setAnalysisLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [
    activeProjectId,
    customRange.from,
    customRange.projectId,
    customRange.to,
    initialViewState.dataSnapshotId,
    initialViewState.projectReleaseId,
    hierarchyNodes,
    analysisScopeId,
    periodSelection,
    resource,
    selectedId,
  ]);

  const statusTimezone = selectedProject?.timezone ?? "Asia/Singapore";
  const recentDates = recentCompleteDates(statusTimezone);
  useEffect(() => {
    let cancelled = false;
    if (!activeProjectId || !analysisScopeId || !monitoringMode || resource !== "electricity") return;
    if (monitoringMode !== "api") return;
    void configApi.executeEnergyScopeAnalysis({projectId: activeProjectId, scopeId: analysisScopeId,
      resource: "electricity", surface: "project-explorer", period: "Custom",
      from: recentDates.from, to: recentDates.to,
    }).then(result => {
      if (cancelled) return;
      const dates = analysisDates(result);
      const states: ExplorerSnapshotHealthMap = {};
      for (const series of result.explorerTrends ?? []) {
        const health = recentSeriesHealth(series, dates);
        const id = series.id === "__scope__" ? result.context.scopeId : series.id;
        states[id] = health;
        states[`meter:${id}`] = health;
      }
      setSnapshotHealthByNode(previous => ({...previous, ...states}));
    }).catch(() => { if (!cancelled) setSnapshotHealthByNode({}); });
    return () => { cancelled = true; };
  }, [activeProjectId, analysisScopeId, monitoringMode, resource, recentDates.from, recentDates.to]);

  const projectNodes = hierarchyNodes ?? [];
  const selected = projectNodes.find((node) => node.id === selectedId)
    ?? projectNodes[0]
    ?? { id: "", parentId: null, type: "project", name: selectedProject?.name ?? "Loading project" };

  const explorerMetricsPending = analysisLoading || !analysis;
  const selectedPeriodHasFacts = hasExplorerFacts(analysis);
  const pinnedContextMismatch = isExplorerPinnedContextMismatch(analysisError);
  const analysisErrorPresentation = explorerAnalysisErrorPresentation(analysisError);
  const currentFactsHref = explorerCurrentFactsUrl({
    projectId: activeProjectId ?? initialViewState.projectId,
    scopeId: selectedId || initialViewState.scopeId,
    resource,
    period: periodSelection,
    from: periodSelection === "Custom" && customRange.projectId === activeProjectId ? customRange.from : "",
    to: periodSelection === "Custom" && customRange.projectId === activeProjectId ? customRange.to : "",
    dataSnapshotId: initialViewState.dataSnapshotId,
    projectReleaseId: initialViewState.projectReleaseId,
    chartView,
  });

  const breadcrumbs = buildBreadcrumbs(selected, projectNodes);
  const filteredNodes = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    if (!normalized) return projectNodes;
    const matchingIds = new Set(
      projectNodes
        .filter((node) => `${node.name} ${node.meter?.circuitName ?? ""}`.toLowerCase().includes(normalized))
        .map((node) => node.id),
    );
    for (const node of projectNodes) {
      if (!matchingIds.has(node.id)) continue;
      let parent = projectNodes.find((candidate) => candidate.id === node.parentId);
      while (parent) {
        matchingIds.add(parent.id);
        parent = projectNodes.find((candidate) => candidate.id === parent?.parentId);
      }
    }
    return projectNodes.filter((node) => matchingIds.has(node.id));
  }, [projectNodes, search]);
  const revealNodeSelection = (nodeId: string) => {
    if (projectNodes.find(node => node.id === nodeId)?.groupScopeId) return;
    setSelectedId(nodeId);
    setExpandedIds((current) => {
      return revealProjectTreeSelection(projectNodes, current, nodeId).expandedIds;
    });
  };
  const handleTreeNodeSelect = (nodeId: string) => {
    if (!projectNodes.find(node => node.id === nodeId)?.groupScopeId) setSelectedId(nodeId);
    setExpandedIds((current) => {
      const next = revealProjectTreeSelection(projectNodes, current, nodeId).expandedIds;
      if (!projectNodes.some((node) => node.parentId === nodeId)) return next;
      if (current.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const selectedValue = selectedPeriodHasFacts ? analysis?.summary.usageKwh ?? null : null;
  const hourlyTrend = useMemo(
    () => (analysis?.hourlyProfile ?? []).map((point) => ({
      time: `${String(point.hour).padStart(2, "0")}:00`,
      averagePowerKw: point.averageKw,
    })),
    [analysis],
  );
  const dailyTrend = useMemo(() => explorerTrendSeries(analysis, "daily"), [analysis]);
  const weeklyTrend = useMemo(() => explorerTrendSeries(analysis, "weekly"), [analysis]);
  const monthlyTrend = useMemo(() => explorerTrendSeries(analysis, "monthly"), [analysis]);
  const childScopeHealth = useMemo(() => explorerChildScopeHealth(analysis), [analysis]);
  const requestedEnergyTrend = chartView === "weekly"
    ? weeklyTrend
    : chartView === "monthly"
      ? monthlyTrend
      : dailyTrend;
  const selectedChartView = chartView === "hourly"
    ? "hourly"
    : requestedEnergyTrend.length > 1
      ? chartView
      : dailyTrend.length > 1
        ? "daily"
        : "hourly";
  const selectedEnergyTrend = selectedChartView === "weekly"
    ? weeklyTrend
    : selectedChartView === "monthly"
      ? monthlyTrend
      : dailyTrend;
  const selectedPeriodAverage = selectedChartView === "hourly"
    ? null
    : explorerSelectedPeriodAverage(
        selectedEnergyTrend,
        selectedChartView === "weekly" ? "weekly" : selectedChartView === "monthly" ? "monthly" : "daily",
      );
  const hourlyAveragePower = hourlyTrend.length > 0
    ? hourlyTrend.reduce((sum, point) => sum + point.averagePowerKw, 0) / hourlyTrend.length
    : null;
  const dailyAverage = completeDailyAverage(analysis);
  const selectedAveragePower = dailyAverage.value;
  const showLatestAvailable = () => {
    const latest = analysis?.latestAvailablePeriod;
    if (!activeProjectId || !latest) return;
    setCustomRange({
      projectId: activeProjectId,
      from: latest.from,
      to: latest.to,
    });
    setPeriodSelection("Custom");
  };

  useEffect(() => {
    if (!activeProjectId || !selectedId) return;
    const range = customRange.projectId === activeProjectId
      ? customRange
      : { from: "", to: "" };
    const nextUrl = explorerUrlWithView({
      projectId: activeProjectId,
      scopeId: selectedId,
      resource,
      period: periodSelection,
      from: periodSelection === "Custom" ? range.from : "",
      to: periodSelection === "Custom" ? range.to : "",
      dataSnapshotId: initialViewState.dataSnapshotId,
      projectReleaseId: initialViewState.projectReleaseId,
      chartView,
    });
    if (`${window.location.pathname}${window.location.search}` === nextUrl) return;
    window.history.replaceState(window.history.state, "", nextUrl);
  }, [
    activeProjectId,
    chartView,
    customRange,
    initialViewState.dataSnapshotId,
    initialViewState.projectReleaseId,
    periodSelection,
    resource,
    selectedId,
  ]);

  return (
    <div className="mx-auto grid min-h-[calc(100vh-56px)] w-full max-w-[1680px] lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="max-h-[420px] overflow-y-auto border-b border-border bg-surface lg:max-h-none lg:overflow-visible lg:border-b-0 lg:border-r">
        <div className="sticky top-0 max-h-[calc(100vh-56px)] overflow-y-auto">
          <div className="energyiq-sidebar-header flex items-center border-b border-border">
            <h1 className="text-base font-semibold text-foreground">Energy consumption</h1>
          </div>

          <div className="p-4">

          {projectSelectionError ? (
            <p role="alert" className="mt-4 rounded-lg border border-step-warning/25 bg-step-warning/5 p-3 text-xs leading-5 text-step-warning">
              {projectSelectionError}
            </p>
          ) : null}

          <div className="mt-4 flex rounded-lg border border-border bg-surface-subtle p-1">
            <button
              type="button"
              onClick={() => setResource("electricity")}
              className={[
                "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors",
                resource === "electricity" ? "bg-surface text-foreground shadow-sm" : "text-muted",
              ].join(" ")}
            >
              <EnergyIcon name="bolt" className="h-3.5 w-3.5" />
              Electricity
            </button>
            <button
              type="button"
              onClick={() => setResource("water")}
              className={[
                "flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md text-xs font-medium transition-colors",
                resource === "water" ? "bg-surface text-foreground shadow-sm" : "text-muted",
              ].join(" ")}
            >
              <EnergyIcon name="water" className="h-3.5 w-3.5" />
              Water
            </button>
          </div>

          <label className="relative mt-4 block">
            <span className="sr-only">Search project structure</span>
            <EnergyIcon
              name="search"
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-light"
            />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search structure or meter"
              className="h-9 w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-ui-support text-foreground outline-none transition-colors placeholder:text-muted-light focus:border-muted-light focus:ring-2 focus:ring-primary/10"
            />
          </label>

          {resource === "water" ? (
            <div className="mt-4 rounded-lg border border-dashed border-border bg-surface-subtle p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                <EnergyIcon name="water" className="h-4 w-4 text-step-inspect" />
                Water structure reserved
              </div>
              <p className="mt-2 text-xs leading-5 text-muted">
                This project has no published water meter mapping yet. The same project tree will appear here after configuration.
              </p>
            </div>
          ) : (
            <>
              {hierarchyError ? (
                <p className="mt-3 rounded-lg border border-step-warning/25 bg-step-warning/5 p-3 text-xs leading-5 text-step-warning">
                  {hierarchyError}
                </p>
              ) : null}
              <p className="mt-3 text-xs text-muted" title={monitoringMode === "api" ? `${recentDates.from} – ${recentDates.to}. Readings status, not equipment health.` : "Historical files are not monitored for daily updates."}>
                {monitoringMode === "api" ? "Status · last 3 complete days" : "Historical / unmonitored data"}
              </p>
              <div className="mt-4 flex items-center justify-between gap-3">
                <span className="text-ui-label font-semibold uppercase tracking-wide text-muted-light">
                  Hierarchy
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label="Expand all hierarchy nodes"
                    onClick={() => setExpandedIds(new Set(
                      projectNodes
                        .filter((node) => projectNodes.some((candidate) => candidate.parentId === node.id))
                        .map((node) => node.id),
                    ))}
                    className="rounded-md px-2 py-1 text-ui-label font-semibold text-muted transition-colors hover:bg-surface-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                  >
                    Expand all
                  </button>
                  <span className="text-border">/</span>
                  <button
                    type="button"
                    aria-label="Collapse all hierarchy nodes"
                    onClick={() => setExpandedIds(new Set())}
                    className="rounded-md px-2 py-1 text-ui-label font-semibold text-muted transition-colors hover:bg-surface-subtle hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                  >
                    Collapse all
                  </button>
                </div>
              </div>
              <div className="mt-2" role="tree" aria-label="Project structure">
                <ProjectTree
                  allNodes={projectNodes}
                  nodes={filteredNodes}
                  selectedId={selectedId}
                  expandedIds={expandedIds}
                  searchActive={search.trim().length > 0}
                  snapshotHealthByNode={snapshotHealthByNode}
                  onSelect={handleTreeNodeSelect}
                />
              </div>
            </>
          )}
          </div>
        </div>
      </aside>

      <section className="energyiq-content-gutter min-w-0 py-6">
        {resource === "electricity" && <div aria-label="Trend date range" className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-3">
          <div className="w-full">
            <div role="group" aria-label="Analysis dates" className="flex flex-wrap gap-1 rounded-xl bg-surface-subtle p-1">
              {explorerPeriods.map(period => <button key={period} type="button" aria-pressed={periodSelection === period}
                onClick={() => setPeriodSelection(period)}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${periodSelection === period ? "bg-primary text-white shadow-sm" : "text-muted hover:bg-surface hover:text-foreground"}`}>
                {period === "Current 28 days" ? "Latest 28 days" : period}
              </button>)}
            </div>
            <p className="mt-3 text-sm font-medium" aria-live="polite">{analysisLoading ? "Updating all charts…" : analysis ? `${formatDateInput(analysis.context.from, analysis.context.timezone)} – ${formatDateInput(new Date(Date.parse(analysis.context.to)-1).toISOString(), analysis.context.timezone)} · ${analysis.context.timezone}` : "Choose dates to explore"}</p>
          </div>
          {periodSelection === "Custom" && <>
            <label className="text-sm">From<input aria-label="History from" type="date" value={customRange.from} onChange={e=>setCustomRange(current=>({...current,projectId:activeProjectId??"",from:e.target.value}))} className="mt-1 block rounded-lg border border-border bg-surface px-3 py-2" /></label>
            <label className="text-sm">Through<input aria-label="History through" type="date" value={customRange.to} min={customRange.from} onChange={e=>setCustomRange(current=>({...current,projectId:activeProjectId??"",to:e.target.value}))} className="mt-1 block rounded-lg border border-border bg-surface px-3 py-2" /></label>
          </>}
        </div>}

        {resource === "water" ? (
          <div className="grid min-h-[520px] place-items-center rounded-xl border border-dashed border-border bg-surface">
            <div className="max-w-md px-6 text-center">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-step-inspect/10 text-step-inspect">
                <EnergyIcon name="water" className="h-5 w-5" />
              </span>
              <h2 className="mt-4 text-base font-semibold text-foreground">Water analysis is ready to configure</h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                Bind physical or virtual water meters to any project node. Water volume and continuous-flow rules will reuse the same drill-down structure.
              </p>
            </div>
          </div>
        ) : selected.meter ? (
          <ExplorerMeterDetail meter={selected.meter} analysis={analysis?.context.scopeId === analysisScopeId ? analysis : null} loading={analysisLoading} error={analysisError} breadcrumbs={breadcrumbs} onSelect={revealNodeSelection} />
        ) : (
          <>
            <div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                {breadcrumbs.length > 1 ? (
                  <div className="flex flex-wrap items-center gap-1 text-ui-support text-muted-light">
                    {breadcrumbs.map((node, index) => (
                      <span key={node.id} className="flex items-center gap-1">
                        {index > 0 ? <EnergyIcon name="chevron" className="h-3 w-3" /> : null}
                        <button
                          type="button"
                          onClick={() => revealNodeSelection(node.id)}
                          className="hover:text-foreground hover:underline"
                        >
                          {node.name}
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="mt-2 flex items-center gap-2">
                  <h1 className="text-2xl font-semibold tracking-tight text-foreground">{selected.name}</h1>
                  <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-ui-meta font-semibold uppercase tracking-[0.06em] text-muted">
                    {selected.displayType ?? selected.type}
                  </span>
                  {!analysisLoading && analysis ? (
                    <span className={[
                      "rounded-full border px-2 py-0.5 text-ui-meta font-semibold",
                      analysis.dataHealth.status === "complete"
                        ? "border-step-success/25 bg-step-success/10 text-step-success"
                        : "border-step-warning/25 bg-step-warning/10 text-step-warning",
                    ].join(" ")}>
                      {analysis.dataHealth.coveragePct.toFixed(1)}% coverage
                    </span>
                  ) : null}
                </div>
              </div>

              {!analysisLoading && analysis ? (
                <p className="text-sm font-medium text-muted">
                  {formatExplorerDate(analysis.context.from, analysis.context.timezone)}–{formatExplorerDate(new Date(Date.parse(analysis.context.to) - 1).toISOString(), analysis.context.timezone)}
                </p>
              ) : null}
            </div>

            {pinnedContextMismatch ? (
              <div role="alert" className="mt-4 flex flex-col gap-3 rounded-xl border border-step-warning/25 bg-step-warning/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">This Explorer link is outdated</p>
                  <p className="mt-1 text-sm leading-5 text-muted">
                    Its pinned Snapshot or Project Release no longer matches the published data. No current facts were mixed into this view.
                  </p>
                </div>
                <Link
                  href={currentFactsHref}
                  className="inline-flex shrink-0 items-center justify-center rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                >
                  Open current Project data
                </Link>
              </div>
            ) : analysisError ? (
              <div className="mt-4 rounded-lg border border-step-warning/25 bg-step-warning/5 p-3 text-sm leading-5 text-step-warning">
                <p>Scope analysis unavailable: {analysisErrorPresentation?.summary}</p>
                {analysisErrorPresentation?.technicalDetails && access?.role === "admin" ? (
                  <details className="mt-2 text-xs text-muted">
                    <summary className="cursor-pointer font-medium">Technical details</summary>
                    <p className="mt-1 break-all font-mono">{analysisErrorPresentation.technicalDetails}</p>
                  </details>
                ) : null}
              </div>
            ) : null}

            {analysis && !selectedPeriodHasFacts ? (
              <div role="status" className="mt-4 flex flex-col gap-3 rounded-xl border border-step-warning/25 bg-step-warning/5 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">No energy facts in this period</p>
                  <p className="mt-1 text-sm leading-5 text-muted">
                    This Scope has no accepted intervals between {formatExplorerDate(analysis.context.from, analysis.context.timezone)} and {formatExplorerDate(new Date(Date.parse(analysis.context.to) - 1).toISOString(), analysis.context.timezone)}. Zero consumption is not assumed.
                  </p>
                </div>
                {analysis.latestAvailablePeriod ? (
                  <button
                    type="button"
                    onClick={showLatestAvailable}
                    className="shrink-0 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  >
                    View latest available data
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className={[
              "mt-6 grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 xl:grid-cols-3",
            ].join(" ")}>
              {explorerMetricsPending ? (
                <>
                  <MetricCell
                    label={isMeterNode(selected) ? "Period energy" : "Total energy"}
                    value={analysisLoading ? "Loading facts…" : "No validated data"}
                  />
                  {isMeterNode(selected) ? (
                    <>
                      <MetricCell label="Daily average" value="—" />
                      <MetricCell label="Peak power" value="—" />
                    </>
                  ) : (
                    <>
                      <MetricCell label="Daily average" value="—" />
                      <MetricCell label="Peak power" value="—" />
                    </>
                  )}
                </>
              ) : (
                <>
                  <MetricCell
                    label={isMeterNode(selected) ? "Period energy" : "Total energy"}
                    value={selectedValue === null ? "No data" : `${selectedValue.toLocaleString(undefined, { maximumFractionDigits: 2 })} kWh`}
                    note={selectedValue === null ? "No accepted interval facts in this period" : undefined}
                    tone={selectedValue === null ? "warning" : "muted"}
                  />
                  {isMeterNode(selected) ? (
                    <>
                      <MetricCell
                        label="Daily average"
                        value={selectedAveragePower === null ? "No data" : `${selectedAveragePower.toFixed(2)} kWh/day`}
                        note={selectedAveragePower === null ? "Average unavailable for this period" : undefined}
                        tone={selectedAveragePower === null ? "warning" : "muted"}
                      />
                      <MetricCell
                        label="Peak power"
                        value={selectedPeriodHasFacts ? `${analysis!.summary.peakKw.toFixed(2)} kW` : "No data"}
                        note={analysis!.summary.peakAt ? formatExplorerDateTime(analysis!.summary.peakAt, analysis!.context.timezone) : "Peak timestamp unavailable"}
                        tone={selectedPeriodHasFacts ? "muted" : "warning"}
                      />
                    </>
                  ) : (
                    <>
                      <MetricCell
                        label="Daily average"
                        value={dailyAverage.value == null ? "No complete days" : `${dailyAverage.value.toFixed(2)} kWh/day`}
                        note={dailyAverage.days ? `Based on ${dailyAverage.days} complete days` : undefined}
                        tone={selectedPeriodHasFacts ? "muted" : "warning"}
                      />
                      <MetricCell
                        label="Peak power"
                        value={selectedPeriodHasFacts ? `${analysis!.summary.peakKw.toFixed(2)} kW` : "No data"}
                        note={analysis!.summary.peakAt ? formatExplorerDateTime(analysis!.summary.peakAt, analysis!.context.timezone) : "Peak timestamp unavailable"}
                        tone={selectedPeriodHasFacts ? "muted" : "warning"}
                      />
                    </>
                  )}
                </>
              )}
            </div>

            <div className="mt-7">
              <ExplorerTrends analysis={analysisLoading ? null : analysis} />
              <div className="mt-6">
                <div className="mb-3">
                  <h2 className="text-sm font-semibold text-foreground">Source & Data Health</h2>
                </div>
                <div className="rounded-xl border border-border bg-surface p-5 shadow-[var(--shadow-card)]">
                  {explorerMetricsPending ? (
                    <p className="text-xs leading-5 text-muted">
                      {analysisLoading
                        ? "Loading the selected Scope, Data Snapshot and source query versions."
                        : analysisError
                          ? "Source evidence is withheld because the trusted analysis request failed."
                          : "No source evidence was returned for this selection."}
                    </p>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">
                            {!selectedPeriodHasFacts
                              ? "No readings in the selected dates"
                              : analysis!.dataHealth.status === "complete"
                              ? "Data is complete for this period"
                              : analysis!.dataHealth.status === "partial"
                                ? "Some expected intervals need review"
                                : "No accepted intervals in this period"}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-muted">
                            {analysis!.dataHealth.coveragePct.toFixed(1)}% coverage · {analysis!.dataHealth.qualityEventCount.toLocaleString()} quality events
                          </p>
                        </div>
                        <span className={[
                          "rounded-full px-2.5 py-1 text-xs font-semibold",
                          analysis!.dataHealth.status === "complete"
                            ? "bg-step-success/10 text-step-success"
                            : "bg-step-warning/10 text-step-warning",
                        ].join(" ")}
                        >
                          {!selectedPeriodHasFacts ? "No data" : analysis!.dataHealth.status === "complete" ? "Readings available" : "Review"}
                        </span>
                      </div>
                      <p className="mt-4 text-xs leading-5 text-muted">
                        Last accepted interval: {analysis!.dataHealth.lastSeenAt
                          ? formatExplorerTimestamp(analysis!.dataHealth.lastSeenAt, analysis!.context.timezone)
                          : "Not provided by the current fact response"}
                      </p>
                      <details className="mt-4 border-t border-border pt-3">
                        <summary className="cursor-pointer text-xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
                          Technical provenance
                        </summary>
                        <dl className="mt-3 space-y-3 text-xs">
                          <EvidenceRow label="Source view" value={analysis!.provenance.sourceView} />
                          <EvidenceRow label="Data Snapshot" value={analysis!.provenance.dataSnapshotId} />
                          <EvidenceRow label="Hierarchy" value={analysis!.provenance.hierarchyRevisionId} />
                          <EvidenceRow label="Meter formula" value={analysis!.provenance.meterFormulaRevisionId} />
                          <EvidenceRow label="Coverage" value={`${analysis!.dataHealth.coveragePct.toFixed(1)}%`} />
                          <EvidenceRow label="Valid intervals" value={`${analysis!.dataHealth.validIntervalCount.toLocaleString()} / ${analysis!.dataHealth.expectedMeterIntervalCount.toLocaleString()}`} />
                          <EvidenceRow label="Quality events" value={analysis!.dataHealth.qualityEventCount.toLocaleString()} />
                          <EvidenceRow label="Import batches" value={analysis!.dataHealth.importBatchIds.join(", ") || "Not provided"} />
                          {analysis!.latestAcceptedReading.status === "available" ? (
                            <>
                              <EvidenceRow label="Reading source" value={analysis!.latestAcceptedReading.sourceFile} />
                              <EvidenceRow label="Source SHA" value={analysis!.latestAcceptedReading.sourceSha256} />
                              <EvidenceRow label="Reading query" value={analysis!.latestAcceptedReading.queryId} />
                            </>
                          ) : (
                            <EvidenceRow label="Latest reading" value={analysis!.latestAcceptedReading.reason.message} />
                          )}
                        </dl>
                      </details>
                    </>
                  )}
                </div>
              </div>
            </div>

            {childScopeHealth ? (
              <section className="mt-8 rounded-xl border border-border bg-surface p-5 shadow-[var(--shadow-card)]" aria-label="Child Scope health">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">Child Scope health</h2>
                    <p className="mt-1 text-xs leading-5 text-muted">
                      {childScopeHealth.total.toLocaleString()} direct child Scopes checked · {childScopeHealth.needsAttention.toLocaleString()} need attention
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-[11px] font-semibold">
                    <span className="rounded-full bg-step-success/10 px-2.5 py-1 text-step-success">{childScopeHealth.validated} validated</span>
                    {childScopeHealth.review > 0 ? <span className="rounded-full bg-step-warning/10 px-2.5 py-1 text-step-warning">{childScopeHealth.review} review</span> : null}
                    {childScopeHealth.unavailable > 0 ? <span className="rounded-full bg-muted/10 px-2.5 py-1 text-muted">{childScopeHealth.unavailable} unavailable</span> : null}
                  </div>
                </div>
                {childScopeHealth.attention.length > 0 ? (
                  <div className="mt-4 divide-y divide-border border-t border-border">
                    {childScopeHealth.attention.slice(0, 5).map((scope) => (
                      <button
                        key={scope.nodeId}
                        type="button"
                        onClick={() => revealNodeSelection(scope.nodeId)}
                        className="grid w-full gap-1 py-3 text-left hover:text-primary sm:grid-cols-[minmax(0,1fr)_140px_140px] sm:items-center sm:gap-4"
                      >
                        <span className="truncate text-xs font-semibold text-foreground">{scope.name}</span>
                        <span className="text-xs tabular-nums text-muted">{scope.coveragePct.toFixed(1)}% coverage</span>
                        <span className={scope.status === "unavailable" ? "text-xs font-semibold text-muted" : "text-xs font-semibold text-step-warning"}>
                          {scope.status === "unavailable"
                            ? "No accepted facts"
                            : scope.qualityEventCount > 0
                              ? `${scope.qualityEventCount} quality events`
                              : "Coverage below 95%"}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 border-t border-border pt-3 text-xs leading-5 text-muted">
                    Every direct child Scope has accepted facts with at least 95% coverage and no flagged quality events in this period.
                  </p>
                )}
              </section>
            ) : null}

            <ExplorerChildren selectedId={selected.id} nodes={projectNodes.filter(node => !node.meter && !node.groupScopeId)} analysis={analysis?.context.scopeId === selected.id ? analysis : null} loading={analysisLoading || (!analysisError && analysis?.context.scopeId !== selected.id)} onSelect={revealNodeSelection} />
          </>
        )}
      </section>
    </div>
  );
}

export function ProjectTree({
  allNodes,
  nodes: visibleNodes,
  selectedId,
  expandedIds,
  searchActive,
  snapshotHealthByNode,
  onSelect,
}: {
  allNodes: ProjectNode[];
  nodes: ProjectNode[];
  selectedId: string;
  expandedIds: Set<string>;
  searchActive: boolean;
  snapshotHealthByNode: ExplorerSnapshotHealthMap;
  onSelect: (id: string) => void;
}) {
  const orderedNodes = useMemo(
    () => orderProjectNodesDepthFirst(visibleNodes),
    [visibleNodes],
  );
  const renderedNodes = searchActive
    ? orderedNodes
    : orderedNodes.filter((node) => ancestorsAreExpanded(node, allNodes, expandedIds));

  return (
    <div className="space-y-0.5">
      {renderedNodes
        .map((node) => {
          const depth = getDepth(node, allNodes);
          const selected = selectedId === node.id;
          const hasChildren = allNodes.some((candidate) => candidate.parentId === node.id);
          const expanded = expandedIds.has(node.id);
          const snapshotHealth = snapshotHealthByNode[node.id];
          return (
            <button
              key={node.id}
              type="button"
              role="treeitem"
              aria-selected={selected}
              aria-expanded={hasChildren ? expanded : undefined}
              onClick={() => onSelect(node.id)}
              style={{ paddingLeft: `${8 + depth * 18}px` }}
              className={[
                "group flex min-h-9 w-full items-center gap-2 rounded-lg pr-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
                selected ? "bg-primary text-white" : "text-muted hover:bg-surface-subtle hover:text-foreground",
              ].join(" ")}
            >
              <EnergyIcon
                name="chevron"
                className={[
                  "h-3 w-3 shrink-0 transition-transform",
                  hasChildren ? "" : "invisible",
                  expanded ? "rotate-90" : "",
                  selected ? "text-white" : "text-muted-light",
                ].join(" ")}
              />
              <EnergyIcon
                name={typeIcon[node.type]}
                className={["h-3.5 w-3.5 shrink-0", selected ? "text-white" : "text-muted-light"].join(" ")}
              />
              <span className="min-w-0 flex-1 truncate font-medium">{node.name}{node.meter?.circuitName && node.meter.circuitName !== node.name ? <span className="ml-1 text-[10px] opacity-70"> · {node.meter.circuitName}</span> : null}</span>
              <span
                aria-label={snapshotHealth?.label ?? "Recent data status unavailable or not monitored"}
                title={snapshotHealth?.label ?? "Recent data status unavailable or not monitored"}
                className={[
                  "h-2 w-2 shrink-0 rounded-full ring-2 ring-current/10",
                  snapshotHealth?.status === "complete"
                    ? "bg-step-success text-step-success"
                    : snapshotHealth?.status === "review"
                      ? "bg-step-warning text-step-warning"
                      : snapshotHealth?.status === "unavailable"
                        ? "bg-red-600 text-red-600"
                        : selected ? "bg-white/70 text-white" : "bg-muted-light text-muted-light",
                  selected ? "ring-white/50" : "",
                ].join(" ")}
              />
            </button>
          );
        })}
    </div>
  );
}

function getDepth(node: ProjectNode, allNodes: ProjectNode[]): number {
  let depth = 0;
  let parent = allNodes.find((candidate) => candidate.id === node.parentId);
  while (parent) {
    depth += 1;
    parent = allNodes.find((candidate) => candidate.id === parent?.parentId);
  }
  return depth;
}

function buildBreadcrumbs(node: ProjectNode, allNodes: ProjectNode[]): ProjectNode[] {
  const result: ProjectNode[] = [node];
  let parent = allNodes.find((candidate) => candidate.id === node.parentId);
  while (parent) {
    result.unshift(parent);
    parent = allNodes.find((candidate) => candidate.id === parent?.parentId);
  }
  return result;
}

function isMeterNode(node: ProjectNode): boolean {
  return node.type === "meter" || node.type === "circuit";
}

function defaultScopeId(allNodes: ProjectNode[]): string {
  return allNodes.find((node) => node.parentId === null)?.id ?? allNodes[0]?.id ?? "";
}

function requestedScopeId(allNodes: ProjectNode[], scopeId: string): string {
  if (scopeId && scopeId !== "project" && allNodes.some((node) => node.id === scopeId)) {
    return scopeId;
  }
  return defaultScopeId(allNodes);
}

function defaultExpandedIds(allNodes: ProjectNode[]): Set<string> {
  const rootId = allNodes.find((node) => node.parentId === null)?.id;
  return new Set(rootId ? [rootId] : []);
}

function ancestorsAreExpanded(
  node: ProjectNode,
  allNodes: ProjectNode[],
  expandedIds: Set<string>,
): boolean {
  let parent = allNodes.find((candidate) => candidate.id === node.parentId);
  while (parent) {
    if (!expandedIds.has(parent.id)) return false;
    parent = allNodes.find((candidate) => candidate.id === parent?.parentId);
  }
  return true;
}

function mapHierarchyNode(
  node: EnergyProjectNodeDto,
): ProjectNode {
  const metadata = parseHierarchyMetadata(node.metadata_json);
  const nodeType = normalizeNodeType(node.node_type);
  return {
    id: node.id,
    parentId: node.parent_id ?? null,
    type: nodeType,
    displayType: node.node_type,
    name: node.name,
    role: metadata.meterRole,
    category: metadata.category,
  };
}

export function formatDateInput(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(new Date(value));
}

export function explorerViewStateFromSearchParams(
  searchParams: Pick<URLSearchParams, "get">,
): ExplorerUrlViewState {
  const requestedPeriod = searchParams.get("period");
  const period: ExplorerPeriod = requestedPeriod === "Current 28 days"
    || requestedPeriod === "Latest complete day"
    || requestedPeriod === "Yesterday"
    || requestedPeriod === "Last 7 days"
    || requestedPeriod === "Last 30 days"
    || requestedPeriod === "Previous week"
    || requestedPeriod === "Previous month"
    || requestedPeriod === "Custom"
    ? requestedPeriod
    : "Current 28 days";
  const requestedFrom = period === "Custom" ? searchParams.get("from") ?? "" : "";
  const requestedTo = period === "Custom" ? searchParams.get("to") ?? "" : "";
  const hasValidCustomRange = period !== "Custom"
    || (validDateInput(requestedFrom) && validDateInput(requestedTo) && requestedFrom <= requestedTo);
  const requestedChartView = searchParams.get("view");
  const chartView: ExplorerChartView = requestedChartView === "weekly"
    || requestedChartView === "monthly"
    || requestedChartView === "hourly"
    ? requestedChartView
    : "daily";
  return {
    projectId: searchParams.get("projectId")?.trim() || "",
    scopeId: searchParams.get("scopeId")?.trim() || "project",
    resource: searchParams.get("resource") === "water" ? "water" : "electricity",
    period,
    from: hasValidCustomRange ? requestedFrom : "",
    to: hasValidCustomRange ? requestedTo : "",
    dataSnapshotId: searchParams.get("dataSnapshotId")?.trim() || "",
    projectReleaseId: searchParams.get("projectReleaseId")?.trim() || "",
    chartView,
  };
}

export function explorerUrlWithView(view: ExplorerUrlViewState): string {
  const next = new URLSearchParams();
  if (view.projectId) next.set("projectId", view.projectId);
  next.set("scopeId", view.scopeId || "project");
  next.set("resource", view.resource);
  if (view.period !== "Current 28 days") next.set("period", view.period);
  if (view.period === "Custom" && view.from && view.to) {
    next.set("from", view.from);
    next.set("to", view.to);
  }
  if (view.dataSnapshotId) next.set("dataSnapshotId", view.dataSnapshotId);
  if (view.projectReleaseId) next.set("projectReleaseId", view.projectReleaseId);
  if (view.chartView !== "daily") next.set("view", view.chartView);
  return `/energyiq/explorer?${next.toString()}`;
}

function formatExplorerDateTime(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-SG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(new Date(value));
}

export function explorerCurrentFactsUrl(view: ExplorerUrlViewState): string {
  return explorerUrlWithView({
    ...view,
    dataSnapshotId: "",
    projectReleaseId: "",
  });
}

export function isExplorerPinnedContextMismatch(message: string | null): boolean {
  if (!message) return false;
  return message.includes("ENERGYIQ_DATA_SNAPSHOT_MISMATCH")
    || message.includes("ENERGYIQ_PROJECT_RELEASE_MISMATCH");
}

export function explorerAnalysisErrorPresentation(
  message: string | null,
): { summary: string; technicalDetails?: string } | null {
  if (!message) return null;
  if (message.startsWith("ENERGYIQ_OPERATIONAL_POLICY_METER_INTERVALS_INCOMPLETE:")) {
    return {
      summary: "Operating-hours details are incomplete for this Scope. No partial meter-policy result was shown.",
      technicalDetails: message,
    };
  }
  // Codes and raw request failures become a plain sentence; the original stays in Technical details for administrators.
  if (isTechnicalMessage(message)) {
    return {
      summary: friendlyErrorMessage(message, { fallback: "The analysis for this area could not be prepared. Try again in a moment." }),
      technicalDetails: message,
    };
  }
  if (message.length > 180) {
    return {
      summary: "Trusted scope analysis could not be completed. Retry after checking the data configuration.",
      technicalDetails: message,
    };
  }
  return { summary: message };
}

export function buildExplorerAnalysisRequest(
  view: Omit<ExplorerUrlViewState, "chartView">,
): Parameters<typeof configApi.executeEnergyScopeAnalysis>[0] {
  return {
    projectId: view.projectId,
    scopeId: view.scopeId || "project",
    resource: view.resource,
    period: view.period === "Latest complete day" || view.period === "Current 28 days" ? "Custom" : view.period,
    surface: "project-explorer",
    ...(view.period === "Latest complete day" ? { analysisWindow: "latest-complete-day" as const } : {}),
    ...(view.period === "Current 28 days" ? { analysisWindow: "current-overview-28d" as const } : {}),
    ...(view.period === "Custom" && view.from && view.to
      ? { from: view.from, to: view.to }
      : {}),
    ...(view.dataSnapshotId ? { expectedDataSnapshotId: view.dataSnapshotId } : {}),
    ...(view.projectReleaseId ? { expectedProjectReleaseId: view.projectReleaseId } : {}),
  };
}

export function hasExplorerFacts(
  analysis: EnergyScopeAnalysisDto | null,
): boolean {
  return Boolean(analysis && analysis.summary.validIntervalCount > 0);
}

export type ExplorerSnapshotHealth = {
  status: "complete" | "review" | "unavailable" | "unknown";
  label: string;
};

export type ExplorerSnapshotHealthMap = Record<string, ExplorerSnapshotHealth>;

export function explorerSnapshotHealthMap(
  analysis: EnergyScopeAnalysisDto | null,
): ExplorerSnapshotHealthMap {
  if (!analysis) return {};
  const result: ExplorerSnapshotHealthMap = {
    [analysis.context.scopeId]: snapshotHealthPresentation(analysis.dataHealth),
  };
  for (const scope of analysis.childScopes) {
    result[scope.nodeId] = scope.dataHealth
      ? snapshotHealthPresentation(scope.dataHealth)
      : { status: "unknown", label: "Recent data status unavailable or not monitored" };
  }
  for (const circuit of analysis.circuits) {
    result[`meter:${circuit.meterNodeId}`] = result[circuit.meterNodeId] = circuit.dataHealth
      ? snapshotHealthPresentation(circuit.dataHealth)
      : { status: "unknown", label: "Recent data status unavailable or not monitored" };
  }
  for (const meter of analysis.explorerMeters ?? []) {
    const key = `meter:${meter.id}`;
    if (!result[key] && analysis.explorerTrends?.some(series => series.id === meter.id)) {
      result[key] = {status: "unavailable", label: "No accepted data in quality window"};
    }
  }
  return result;
}

function snapshotHealthPresentation(health: {
  coveragePct: number;
  validIntervalCount: number;
  qualityEventCount: number;
}): ExplorerSnapshotHealth {
  if (health.validIntervalCount === 0) {
    return { status: "unavailable", label: "No accepted Snapshot data" };
  }
  if (health.coveragePct >= 100 && health.qualityEventCount === 0) {
    return { status: "complete", label: "Complete Snapshot data" };
  }
  return { status: "review", label: "Partial Snapshot data; review" };
}

export function explorerSelectedPeriodAverage(
  rows: Array<{ usageKwh: number | null; coveragePct: number; isPartialCalendarPeriod?: boolean }>,
  grain: "daily" | "weekly" | "monthly",
): number | null {
  const complete = rows.filter((row) => row.usageKwh !== null
    && row.coveragePct >= 100
    && !row.isPartialCalendarPeriod);
  if (grain !== "daily" && complete.length < 2) return null;
  if (complete.length === 0) return null;
  return complete.reduce((sum, row) => sum + (row.usageKwh ?? 0), 0) / complete.length;
}

export function explorerTrendSeries(
  analysis: EnergyScopeAnalysisDto | null,
  grain: "daily" | "weekly" | "monthly" = "daily",
): Array<{
  date: string;
  usageKwh: number | null;
  coveragePct: number;
  isPartialCalendarPeriod?: boolean;
}> {
  if (!analysis || !hasExplorerFacts(analysis)) return [];
  if (grain !== "daily") {
    const selectedScope = analysis.calendarTotals?.scopes.find(
      (candidate) => candidate.scopeId === analysis.context.scopeId,
    );
    const rows = grain === "weekly" ? selectedScope?.weeks : selectedScope?.months;
    return (rows ?? []).map((row) => ({
      date: row.localFrom,
      usageKwh: row.usageKwh,
      coveragePct: row.dataHealth.coveragePct,
      isPartialCalendarPeriod: row.isPartialCalendarPeriod,
    }));
  }
  const selectedScope = analysis.dailyTotals?.scopes.find(
    (candidate) => candidate.scopeId === analysis.context.scopeId,
  );
  return (selectedScope?.rows ?? []).map((row) => ({
    date: row.localDate,
    usageKwh: row.usageKwh,
    coveragePct: row.dataHealth.coveragePct,
  }));
}

export type ExplorerChildScopeHealth = {
  total: number;
  validated: number;
  review: number;
  unavailable: number;
  needsAttention: number;
  attention: Array<{
    nodeId: string;
    name: string;
    coveragePct: number;
    qualityEventCount: number;
    status: "review" | "unavailable";
  }>;
};

export function explorerChildScopeHealth(
  analysis: EnergyScopeAnalysisDto | null,
): ExplorerChildScopeHealth | null {
  if (!analysis || analysis.childScopes.length === 0) return null;
  const scopes = analysis.childScopes.map((scope) => {
    const health = scope.dataHealth;
    const unavailable = !health || health.validIntervalCount === 0;
    const review = !unavailable && (health.coveragePct < 95 || health.qualityEventCount > 0);
    return {
      nodeId: scope.nodeId,
      name: scope.name,
      coveragePct: health?.coveragePct ?? 0,
      qualityEventCount: health?.qualityEventCount ?? 0,
      status: unavailable ? "unavailable" as const : review ? "review" as const : "validated" as const,
    };
  });
  const attention = scopes
    .filter((scope): scope is typeof scope & { status: "review" | "unavailable" } => scope.status !== "validated")
    .sort((left, right) => {
      if (left.status !== right.status) return left.status === "unavailable" ? -1 : 1;
      if (left.coveragePct !== right.coveragePct) return left.coveragePct - right.coveragePct;
      return left.name.localeCompare(right.name);
    });
  const unavailable = scopes.filter((scope) => scope.status === "unavailable").length;
  const review = scopes.filter((scope) => scope.status === "review").length;
  return {
    total: scopes.length,
    validated: scopes.length - unavailable - review,
    review,
    unavailable,
    needsAttention: unavailable + review,
    attention,
  };
}

function validDateInput(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizeNodeType(value: string): ProjectNode["type"] {
  if (
    value === "project"
    || value === "block"
    || value === "level"
    || value === "centre"
    || value === "meter"
    || value === "circuit"
  ) {
    return value;
  }
  return "level";
}

function parseHierarchyMetadata(value: string | undefined): {
  meterRole?: ProjectNode["role"];
  category?: ProjectNode["category"];
} {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const meterRole = parsed.meterRole;
    const rawCategory = parsed.category;
    const category = typeof rawCategory === "string"
      ? `${rawCategory.slice(0, 1).toUpperCase()}${rawCategory.slice(1).toLowerCase()}`
      : undefined;
    return {
      meterRole:
        meterRole === "total" || meterRole === "submeter" || meterRole === "virtual"
          ? meterRole
          : undefined,
      category:
        category === "Light" || category === "Load" || category === "Aircon"
          ? category
          : undefined,
    };
  } catch {
    return {};
  }
}

function formatExplorerTimestamp(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-SG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(new Date(value));
}

function formatExplorerDate(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-SG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone,
  }).format(new Date(value));
}

function formatExplorerTrendDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf())) return value;
  return new Intl.DateTimeFormat("en-SG", { day: "numeric", month: "short", timeZone: "UTC" }).format(parsed);
}

function formatExplorerTrendTooltipDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf())) return value;
  return new Intl.DateTimeFormat("en-SG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

function formatExplorerTrendTooltipLabel(value: string, view: ExplorerChartView): string {
  if (view === "weekly") return `Week of ${formatExplorerTrendTooltipDate(value)}`;
  if (view === "monthly") {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(parsed.valueOf())) return value;
    return new Intl.DateTimeFormat("en-SG", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(parsed);
  }
  return formatExplorerTrendTooltipDate(value);
}

function explorerChartTitle(view: ExplorerChartView): string {
  if (view === "weekly") return "Calendar-week energy trend";
  if (view === "monthly") return "Calendar-month energy trend";
  if (view === "hourly") return "24-hour operating profile";
  return "Daily energy trend";
}

function explorerChartDescription(view: ExplorerChartView): string | null {
  if (view === "weekly") return "Server-aggregated Monday–Sunday totals; boundary weeks may be partial";
  if (view === "monthly") return "Server-aggregated calendar-month totals; boundary months may be partial";
  return null;
}

function explorerChartSeriesLabel(view: ExplorerChartView): string {
  if (view === "weekly") return "Calendar-week energy";
  if (view === "monthly") return "Calendar-month energy";
  return "Daily energy";
}

function compactEvidenceId(value: string): string {
  return value.length <= 24 ? value : `${value.slice(0, 12)}…${value.slice(-8)}`;
}

function EvidenceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-w-0 grid-cols-[100px_minmax(0,1fr)] gap-3">
      <dt className="text-muted-light">{label}</dt>
      <dd className="break-all text-right font-mono text-[11px] leading-4 text-foreground">{value}</dd>
    </div>
  );
}

function MetricCell({
  label,
  value,
  note,
  tone = "muted",
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "muted" | "warning";
}) {
  return (
    <div className="min-w-0 bg-surface px-5 py-4">
      <p className="text-xs font-medium text-muted-light">{label}</p>
      <p className="mt-2 break-words tabular text-lg font-semibold leading-tight tracking-tight text-foreground">{value}</p>
      {note ? (
        <p
          className={[
            "mt-1 break-words text-xs leading-4",
            tone === "warning" ? "text-step-warning" : "text-muted-light",
          ].join(" ")}
        >
          {note}
        </p>
      ) : null}
    </div>
  );
}

export function buildExplorerNavigationNodes(
  scopes: EnergyProjectNodeDto[],
  meters: NonNullable<EnergyScopeAnalysisDto["explorerMeters"]>,
): ProjectNode[] {
  const nodes = scopes.map(mapHierarchyNode);
  for (const meter of meters) {
    // Older projects already have circuit Scopes: keep their existing routes and charts.
    if (nodes.some(node => node.id === meter.id && isMeterNode(node))) continue;
    if (!nodes.some(node => node.id === meter.scopeId)) continue;
    let parentId = meter.scopeId;
    if (meter.displayGroup?.trim()) {
      parentId = `group:${meter.scopeId}:${encodeURIComponent(meter.displayGroup.trim())}`;
      if (!nodes.some(node => node.id === parentId)) nodes.push({ id: parentId, parentId: meter.scopeId,
        type: "level", displayType: "Meter group", name: meter.displayGroup.trim(), groupScopeId: meter.scopeId });
    }
    nodes.push({ id: `meter:${meter.id}`, parentId, type: "circuit", name: meter.name,
      displayType: meter.kind === "virtual" ? "Virtual circuit" : "Circuit", meter });
  }
  return nodes;
}
