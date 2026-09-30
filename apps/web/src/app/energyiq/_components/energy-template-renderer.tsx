import React, { type ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { EnergyMeterDataHealthDto, EnergyScopeAnalysisDto } from "../../../lib/config-api";
import type {
  EnergyTemplateRenderModule,
  EnergyTemplateRenderPlan,
} from "./energy-template-render-plan";
import { EnergyIcon } from "./icons";

export type EnergyTemplateRenderAdvisory = {
  kind: "partial" | "stale" | "unsupported";
  title: string;
  detail: string;
};

export type EnergyTemplateRendererState =
  | {
    status: "loading" | "empty" | "unsupported" | "error";
    title: string;
    detail: string;
  }
  | {
    status: "ready";
    analysis: EnergyScopeAnalysisDto;
    plan: EnergyTemplateRenderPlan;
    meterDataHealth?: EnergyMeterDataHealthDto;
    advisories?: readonly EnergyTemplateRenderAdvisory[];
  };

export function EnergyTemplateRenderer({
  state,
  sectionIdPrefix = "template-section",
  onRetry,
}: {
  state: EnergyTemplateRendererState;
  sectionIdPrefix?: string;
  onRetry?: () => void;
}) {
  if (state.status !== "ready") {
    return <RendererStatePanel state={state} onRetry={onRetry} />;
  }

  const { analysis, plan, meterDataHealth } = state;
  if (plan.module_count === 0) {
    return <RendererStatePanel state={{ status: "empty", title: "No modules are enabled", detail: "Enable at least one Catalog module in the Template Draft, then save and preview again." }} />;
  }

  return (
    <div className="space-y-10">
      {state.advisories?.length ? <RendererAdvisories advisories={state.advisories} /> : null}
      {plan.sections.map((section) => (
        <section
          key={section.section_id}
          id={`${sectionIdPrefix}-${section.section_id}`}
          data-overview-section="true"
          data-overview-navigation-label={section.navigation_label}
          aria-labelledby={`${sectionIdPrefix}-${section.section_id}-heading`}
          tabIndex={-1}
          className="scroll-mt-24 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
        >
          <div className="mb-4">
            <h2 id={`${sectionIdPrefix}-${section.section_id}-heading`} className="text-base font-semibold tracking-tight text-foreground">{section.title}</h2>
            {section.description ? <p className="mt-1 text-xs leading-5 text-muted">{section.description}</p> : null}
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            {section.modules.map((module) => (
              <div key={module.placement.placement_id} className={spanClass(module.placement.layout.span)}>
                <TemplateModuleFrame
                  id={`${sectionIdPrefix}-${section.section_id}-${module.placement.placement_id}`}
                  module={module}
                >
                  {module.readiness.status === "missing" ? (
                    <UnavailableModule detail={module.readiness.detail} />
                  ) : (
                    <ModuleContent module={module} analysis={analysis} meterDataHealth={meterDataHealth} />
                  )}
                </TemplateModuleFrame>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function RendererStatePanel({
  state,
  onRetry,
}: {
  state: Exclude<EnergyTemplateRendererState, { status: "ready" }>;
  onRetry?: () => void;
}) {
  const meta = {
    loading: { label: "Loading", icon: "analysis" as const, tone: "text-muted", surface: "border-border bg-surface" },
    empty: { label: "No data", icon: "info" as const, tone: "text-muted", surface: "border-border bg-surface" },
    unsupported: { label: "Unsupported", icon: "info" as const, tone: "text-step-warning", surface: "border-step-warning/25 bg-step-warning/5" },
    error: { label: "Unavailable", icon: "alert" as const, tone: "text-step-error", surface: "border-step-error/25 bg-step-error/5" },
  }[state.status];
  const role = state.status === "error" ? "alert" : "status";

  return (
    <div role={role} aria-live={state.status === "loading" ? "polite" : undefined} className={`rounded-xl border px-5 py-8 ${meta.surface}`}>
      <div className="mx-auto flex max-w-xl items-start gap-3">
        <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background ${meta.tone}`}>
          <EnergyIcon name={meta.icon} className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className={`text-[10px] font-semibold uppercase tracking-[0.08em] ${meta.tone}`}>{meta.label}</p>
          <h2 className="mt-1 text-sm font-semibold text-foreground">{state.title}</h2>
          <p className="mt-1 text-xs leading-5 text-muted">{state.detail}</p>
          {state.status === "error" && onRetry ? (
            <button type="button" onClick={onRetry} className="mt-4 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
              Try again
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function RendererAdvisories({ advisories }: { advisories: readonly EnergyTemplateRenderAdvisory[] }) {
  return (
    <div className="space-y-2" aria-label="Analysis data advisories">
      {advisories.map((advisory) => (
        <div key={`${advisory.kind}:${advisory.title}`} className="flex items-start gap-3 rounded-lg border border-step-warning/25 bg-step-warning/5 px-4 py-3 text-step-warning">
          <EnergyIcon name={advisory.kind === "stale" ? "alert" : "info"} className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground">{advisory.title}</p>
            <p className="mt-0.5 text-[11px] leading-5 text-muted">{advisory.detail}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function TemplateModuleFrame({
  id,
  module,
  children,
}: {
  id: string;
  module: EnergyTemplateRenderModule;
  children: ReactNode;
}) {
  const { presentation, layout } = module.placement;
  const title = presentation.title ?? module.component.display_name;
  const description = presentation.description ?? module.component.description;
  return (
    <article
      id={id}
      data-overview-module="true"
      data-overview-navigation-label={title}
      aria-labelledby={`${id}-heading`}
      tabIndex={-1}
      className={[
      "h-full overflow-hidden rounded-xl border bg-surface shadow-[var(--shadow-card)]",
      presentation.tone === "highlight" ? "border-primary/30 ring-1 ring-primary/5" : "border-border",
      presentation.tone === "quiet" ? "shadow-none" : "",
      heightClass(layout.height),
      "scroll-mt-24 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
    ].join(" ")}
    >
      <div className={[
        "flex flex-wrap items-start justify-between gap-3 border-b border-border",
        presentation.density === "compact" ? "px-4 py-3" : "px-5 py-4",
      ].join(" ")}>
        <div className="min-w-0">
          <h3 id={`${id}-heading`} className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="mt-1 text-[11px] leading-4 text-muted">{description}</p>
        </div>
        <span className={[
          "rounded-full px-2.5 py-1 text-[9px] font-semibold",
          module.readiness.status === "ready"
            ? "bg-step-success/10 text-step-success"
            : module.readiness.status === "partial"
              ? "bg-step-warning/10 text-step-warning"
              : "bg-surface-subtle text-muted",
        ].join(" ")}>
          {module.readiness.label}
        </span>
      </div>
      <div className={presentation.density === "compact" ? "p-4" : "p-5"}>{children}</div>
    </article>
  );
}

function ModuleContent({
  module,
  analysis,
  meterDataHealth,
}: {
  module: EnergyTemplateRenderModule;
  analysis: EnergyScopeAnalysisDto;
  meterDataHealth?: EnergyMeterDataHealthDto;
}) {
  const viewKey = module.component.view_key;
  const presentation = module.placement.presentation;
  switch (viewKey) {
    case "executive_action_summary_v1":
      return <ExecutiveAction analysis={analysis} />;
    case "recommended_actions_v1":
      return <RecommendedActions analysis={analysis} limit={presentation.limit} />;
    case "consumption_overview_v1":
      return <ConsumptionOverview analysis={analysis} />;
    case "child_scope_ranking_v1":
      return <ScopeRanking analysis={analysis} limit={presentation.limit} visualPreset={presentation.visual_preset} showLegend={presentation.show_legend} />;
    case "area_intensity_comparison_v1":
      return <NormalisedComparison analysis={analysis} kind="area" limit={presentation.limit} />;
    case "people_intensity_comparison_v1":
      return <NormalisedComparison analysis={analysis} kind="people" limit={presentation.limit} />;
    case "off_hours_analysis_v1":
      return <OffHoursAnalysis analysis={analysis} limit={presentation.limit} />;
    case "operating_pattern_v1":
      return <OperatingPattern analysis={analysis} visualPreset={presentation.visual_preset} showLegend={presentation.show_legend} />;
    case "meter_breakdown_v1":
      return <MeterBreakdown analysis={analysis} limit={presentation.limit} />;
    case "data_quality_summary_v1":
      return <DataQuality analysis={analysis} meterDataHealth={meterDataHealth} />;
    case "exceptions_evidence_v1":
      return <ExceptionsEvidence analysis={analysis} limit={presentation.limit} />;
    default:
      return <UnavailableModule detail={`No renderer is registered for ${viewKey}`} />;
  }
}

function ExecutiveAction({ analysis }: { analysis: EnergyScopeAnalysisDto }) {
  const finding = analysis.attention[0];
  if (!finding) return <UnavailableModule detail="No deterministic finding is available for this selection." />;
  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_0.8fr]">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-light">Recommended first action</p>
        <h6 className="mt-2 text-base font-semibold text-foreground">{finding.title}</h6>
        <p className="mt-2 text-sm leading-6 text-muted">{finding.evidence}</p>
        <div className="mt-4 border-l-2 border-primary bg-surface-subtle px-4 py-3 text-sm text-muted">{finding.suggestedAction}</div>
      </div>
      <dl className="grid content-start gap-3 rounded-lg bg-surface-subtle p-4 text-xs">
        <div><dt className="text-muted-light">Scope</dt><dd className="mt-1 font-semibold">{analysis.context.scopeName}</dd></div>
        <div><dt className="text-muted-light">Analysed energy</dt><dd className="mt-1 font-semibold">{formatNumber(analysis.summary.usageKwh, 2)} kWh</dd></div>
        <div><dt className="text-muted-light">Evidence</dt><dd className="mt-1 break-words text-muted">{analysis.provenance.dataSnapshotId} · {analysis.provenance.queryIds.join(", ")}</dd></div>
      </dl>
    </div>
  );
}

function RecommendedActions({ analysis, limit }: { analysis: EnergyScopeAnalysisDto; limit: number }) {
  const items = analysis.attention.slice(0, limit);
  if (items.length === 0) {
    return <UnavailableModule detail="No priority exception requires an action for this selection." />;
  }
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {items.map((item, index) => (
        <article key={`${item.code}:${item.title}`} className="rounded-lg border border-border bg-surface-subtle p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-light">Priority {index + 1}</span>
            <span className="rounded-full bg-background px-2 py-0.5 text-[9px] font-semibold uppercase text-muted">{item.severity}</span>
          </div>
          <h4 className="mt-3 text-sm font-semibold text-foreground">{item.title}</h4>
          <p className="mt-2 text-xs leading-5 text-muted">{item.suggestedAction}</p>
          <p className="mt-3 border-t border-border pt-3 text-[10px] leading-4 text-muted-light">Evidence: {item.evidence}</p>
        </article>
      ))}
    </div>
  );
}

function ConsumptionOverview({ analysis }: { analysis: EnergyScopeAnalysisDto }) {
  const { summary, comparison, cost, context } = analysis;
  const comparisonValue = comparison.changePct === null
    ? "No baseline"
    : `${comparison.changePct >= 0 ? "+" : ""}${formatNumber(comparison.changePct, 1)}%`;
  const comparisonNote = comparison.changePct === null
    ? "Previous period has no validated usage"
    : `${comparison.changeKwh >= 0 ? "+" : ""}${formatNumber(comparison.changeKwh, 2)} kWh vs previous period`;
  const peakNote = summary.peakAt
    ? `At ${formatAnalysisTimestamp(summary.peakAt, context.timezone)}`
    : "Peak interval-average power";
  const cards = [
    { label: "Total consumption", value: `${formatNumber(summary.usageKwh, 2)} kWh`, note: `${context.scopeName} · selected period` },
    { label: "Previous-period change", value: comparisonValue, note: comparisonNote },
    { label: "Average daily use", value: `${formatNumber(summary.averageDailyUsageKwh, 2)} kWh/day`, note: "Selected-period daily average" },
    { label: "Peak demand", value: `${formatNumber(summary.peakKw, 2)} kW`, note: peakNote },
    {
      label: "Energy cost",
      value: cost.status === "available" ? formatCurrencyAmount(cost.amount, cost.currency, 2) : "Unavailable",
      note: cost.status === "available" ? `Tariff ${cost.tariffScheduleVersion}` : cost.reason.message,
    },
  ];
  return (
    <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 xl:grid-cols-5">
      {cards.map((item) => (
        <div key={item.label} className="bg-surface px-4 py-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-light">{item.label}</p>
          <p className="mt-2 text-lg font-semibold tabular-nums text-foreground">{item.value}</p>
          <p className="mt-1 text-[10px] leading-4 text-muted">{item.note}</p>
        </div>
      ))}
    </div>
  );
}

function ScopeRanking({
  analysis,
  limit,
  visualPreset,
  showLegend,
}: {
  analysis: EnergyScopeAnalysisDto;
  limit: number;
  visualPreset: EnergyTemplateRenderModule["placement"]["presentation"]["visual_preset"];
  showLegend: boolean;
}) {
  const rows = analysis.childScopes
    .toSorted((left, right) => right.usageKwh - left.usageKwh)
    .slice(0, limit);
  const maximum = Math.max(0, ...rows.map((row) => row.usageKwh));
  if (rows.length === 0) return <UnavailableModule detail="The selected scope has no directly comparable child scopes." />;
  if (visualPreset === "bar" || visualPreset === "auto") {
    return (
      <div>
        {showLegend ? <p className="mb-3 text-[10px] text-muted-light">Total usage · kWh · highest first</p> : null}
        <div className="h-[280px] min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 20, left: 12, bottom: 4 }}>
              <CartesianGrid stroke="#ececf0" strokeDasharray="3 4" horizontal={false} />
              <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#8a8a99" }} />
              <YAxis type="category" dataKey="name" width={88} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#4d4d4d" }} />
              <Tooltip formatter={(value) => [`${formatNumber(Number(value), 1)} kWh`, "Usage"]} />
              <Bar dataKey="usageKwh" fill="#74628f" radius={[0, 5, 5, 0]} maxBarSize={24} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {rows.map((row, index) => (
        <div key={row.nodeId} className="grid grid-cols-[24px_minmax(120px,0.8fr)_minmax(120px,1.4fr)_auto] items-center gap-3 text-xs">
          <span className="text-muted-light">{index + 1}</span>
          <span className="truncate font-semibold">{row.name}</span>
          <div className="h-2 overflow-hidden rounded-full bg-surface-subtle"><div className="h-full rounded-full bg-primary" style={{ width: `${maximum > 0 ? (row.usageKwh / maximum) * 100 : 0}%` }} /></div>
          <span className="text-right tabular-nums text-muted">{formatNumber(row.usageKwh, 1)} kWh · {row.sharePct.toFixed(1)}%</span>
        </div>
      ))}
    </div>
  );
}

function NormalisedComparison({ analysis, kind, limit }: { analysis: EnergyScopeAnalysisDto; kind: "area" | "people"; limit: number }) {
  const rows = analysis.childScopes
    .flatMap((row) => {
      const value = kind === "area" ? row.kwhPerSqm : row.kwhPerPerson;
      return value === undefined ? [] : [{ id: row.nodeId, name: row.name, value, base: kind === "area" ? row.areaSqm : row.occupantCount }];
    })
    .toSorted((left, right) => right.value - left.value)
    .slice(0, limit);
  if (rows.length === 0) {
    return <UnavailableModule detail={`No child scope has usable ${kind === "area" ? "area" : "people"} metadata in this result.`} />;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-left text-xs">
        <thead className="text-[10px] uppercase tracking-wide text-muted-light"><tr><th className="pb-3">Scope</th><th className="pb-3 text-right">{kind === "area" ? "Area" : "People"}</th><th className="pb-3 text-right">{kind === "area" ? "kWh / m²" : "kWh / person"}</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.id} className="border-t border-border"><td className="py-3 font-semibold">{row.name}</td><td className="py-3 text-right text-muted">{row.base?.toLocaleString() ?? "—"}</td><td className="py-3 text-right font-semibold tabular-nums">{formatNumber(row.value, 2)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function OffHoursAnalysis({ analysis, limit }: { analysis: EnergyScopeAnalysisDto; limit: number }) {
  if (analysis.offHours.status === "unavailable") {
    return <UnavailableModule detail={analysis.offHours.reason.message} />;
  }
  const rows = analysis.circuits
    .filter((row): row is typeof row & { nonOperatingKwh: number } => row.nonOperatingKwh !== undefined)
    .toSorted((left, right) => right.nonOperatingKwh - left.nonOperatingKwh)
    .slice(0, limit);
  return (
    <div className="space-y-5">
      <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
        <div className="bg-surface-subtle p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-light">Operating energy</p>
          <p className="mt-2 text-xl font-semibold">{formatNumber(analysis.offHours.operatingKwh, 2)} kWh</p>
          <p className="mt-1 text-xs text-muted">Inside configured hours</p>
        </div>
        <div className="bg-surface-subtle p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-light">Standby energy</p>
          <p className="mt-2 text-xl font-semibold">{formatNumber(analysis.offHours.standbyKwh, 2)} kWh</p>
          <p className="mt-1 text-xs text-muted">{analysis.offHours.sharePct.toFixed(1)}% outside configured hours</p>
        </div>
        <div className="min-w-0 bg-surface-subtle p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-light">Policy basis</p>
          <p className="mt-2 break-all text-sm font-semibold">Calendar {analysis.offHours.businessCalendarVersion}</p>
          <p className="mt-1 text-xs text-muted">{analysis.offHours.timezone} project timezone</p>
        </div>
      </div>
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.meterNodeId} className="flex items-center justify-between gap-3 border-b border-border py-2 text-xs last:border-b-0">
            <span className="truncate font-medium">{row.name}</span>
            <span className="shrink-0 tabular-nums text-muted">{formatNumber(row.nonOperatingKwh, 2)} kWh</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function OperatingPattern({
  analysis,
  visualPreset,
  showLegend,
}: {
  analysis: EnergyScopeAnalysisDto;
  visualPreset: EnergyTemplateRenderModule["placement"]["presentation"]["visual_preset"];
  showLegend: boolean;
}) {
  const maximum = Math.max(0, ...analysis.hourlyProfile.map((point) => point.peakKw));
  if (visualPreset === "area" || visualPreset === "auto") {
    return (
      <div className="space-y-5">
        <div className="h-[280px] min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={analysis.hourlyProfile} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="energy-template-hourly-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#4d6f96" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="#4d6f96" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#ececf0" strokeDasharray="3 4" vertical={false} />
              <XAxis dataKey="hour" tickFormatter={(hour) => `${String(hour).padStart(2, "0")}:00`} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#8a8a99" }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#8a8a99" }} />
              {showLegend ? (
                <Legend
                  align="left"
                  verticalAlign="top"
                  iconType="plainline"
                  height={32}
                  wrapperStyle={{ color: "#696977", fontSize: 10 }}
                />
              ) : null}
              <Tooltip
                itemSorter={(item) => item.dataKey === "peakKw" ? -1 : 1}
                labelFormatter={(hour) => `${String(hour).padStart(2, "0")}:00`}
                formatter={(value, name) => [`${formatNumber(Number(value), 2)} kW`, String(name)]}
              />
              <Area name="Observed peak" type="monotone" dataKey="peakKw" stroke="#a3a3a3" strokeDasharray="5 4" fill="none" dot={false} />
              <Area name="Hourly average" type="monotone" dataKey="averageKw" stroke="#4d6f96" strokeWidth={2} fill="url(#energy-template-hourly-fill)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <HourlyHeatStrip points={analysis.hourlyProfile} maximum={maximum} />
      </div>
    );
  }
  return (
    <div className="grid h-56 grid-cols-12 items-end gap-1 sm:grid-cols-24">
      {analysis.hourlyProfile.map((point) => (
        <div key={point.hour} className="group flex h-full flex-col justify-end gap-1" title={`${String(point.hour).padStart(2, "0")}:00 · avg ${point.averageKw.toFixed(2)} kW · peak ${point.peakKw.toFixed(2)} kW`}>
          <div className="mx-auto w-full max-w-5 rounded-t bg-primary/25" style={{ height: `${maximum > 0 ? Math.max(2, (point.peakKw / maximum) * 100) : 2}%` }} />
          <div className="mx-auto w-full max-w-5 rounded-t bg-primary" style={{ height: `${maximum > 0 ? Math.max(2, (point.averageKw / maximum) * 100) : 2}%` }} />
          <span className="hidden text-center text-[8px] text-muted-light sm:block">{point.hour % 3 === 0 ? String(point.hour).padStart(2, "0") : ""}</span>
        </div>
      ))}
    </div>
  );
}

function HourlyHeatStrip({
  points,
  maximum,
}: {
  points: EnergyScopeAnalysisDto["hourlyProfile"];
  maximum: number;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3 text-[10px] text-muted-light">
        <span>Average day heatmap · hourly average kW</span>
        <span>Low → High</span>
      </div>
      <div className="grid grid-cols-12 gap-1 sm:grid-cols-24" role="img" aria-label="Average hourly demand heatmap">
        {points.map((point) => {
          const intensity = maximum > 0 ? Math.max(0.08, point.averageKw / maximum) : 0.08;
          return (
            <div key={point.hour} className="min-w-0">
              <div
                className="h-8 rounded-sm bg-primary"
                style={{ opacity: intensity }}
                title={`${String(point.hour).padStart(2, "0")}:00 · ${formatNumber(point.averageKw, 2)} kW average`}
              />
              <span className="mt-1 block text-center text-[8px] text-muted-light">{point.hour % 3 === 0 ? String(point.hour).padStart(2, "0") : ""}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[10px] leading-4 text-muted-light">Each cell is the server-provided hourly average across the selected period; it does not infer a Date × Hour matrix.</p>
    </div>
  );
}

function MeterBreakdown({ analysis, limit }: { analysis: EnergyScopeAnalysisDto; limit: number }) {
  const rows = analysis.circuits.toSorted((left, right) => right.usageKwh - left.usageKwh).slice(0, limit);
  if (rows.length === 0) return <UnavailableModule detail="No mapped meter contributes to the selected scope and period." />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[620px] text-left text-xs">
        <thead className="text-[10px] uppercase tracking-wide text-muted-light"><tr><th className="pb-3">Meter</th><th className="pb-3">Category</th><th className="pb-3">Role</th><th className="pb-3 text-right">Energy</th><th className="pb-3 text-right">Share</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.meterNodeId} className="border-t border-border"><td className="py-3 font-semibold">{row.name}</td><td className="py-3 capitalize text-muted">{row.category}</td><td className="py-3 capitalize text-muted">{row.meterRole}</td><td className="py-3 text-right tabular-nums">{formatNumber(row.usageKwh, 2)} kWh</td><td className="py-3 text-right tabular-nums text-muted">{row.sharePct.toFixed(1)}%</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function DataQuality({
  analysis,
  meterDataHealth,
}: {
  analysis: EnergyScopeAnalysisDto;
  meterDataHealth?: EnergyMeterDataHealthDto;
}) {
  const { dataHealth } = analysis;
  return (
    <div className="space-y-5">
      <dl className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 xl:grid-cols-3">
        <QualityFact label="Data health" value={dataHealth.status === "complete" ? "Complete" : dataHealth.status === "partial" ? "Partial" : "Unavailable"} />
        <QualityFact label="Coverage" value={`${formatNumber(dataHealth.coveragePct, 1)}%`} />
        <QualityFact label="Valid intervals" value={`${dataHealth.validIntervalCount.toLocaleString()} / ${dataHealth.expectedMeterIntervalCount.toLocaleString()}`} />
        <QualityFact label="Quality events" value={dataHealth.qualityEventCount.toLocaleString()} />
        <QualityFact label="Last accepted interval" value={dataHealth.lastSeenAt ? formatAnalysisTimestamp(dataHealth.lastSeenAt, analysis.context.timezone) : "Not provided"} />
        <QualityFact label="Import batches" value={dataHealth.importBatchIds.length > 0 ? dataHealth.importBatchIds.join(", ") : "Not provided"} mono />
        <QualityFact label="Data snapshot" value={analysis.provenance.dataSnapshotId} mono />
        <QualityFact label="Source view" value={analysis.provenance.sourceView} mono />
        <QualityFact label="Scope" value={`${analysis.context.scopeName} · ${analysis.context.scopeType}`} />
      </dl>
      {meterDataHealth ? <MeterPointHealth health={meterDataHealth} timezone={analysis.context.timezone} /> : null}
    </div>
  );
}

function MeterPointHealth({ health, timezone }: { health: EnergyMeterDataHealthDto; timezone: string }) {
  const rows = health.meters.toSorted((left, right) =>
    meterHealthOrder(left.status) - meterHealthOrder(right.status)
    || left.sourceLabel.localeCompare(right.sourceLabel));
  return (
    <section aria-label="Configured Meter Points" className="overflow-hidden rounded-lg border border-border">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-surface-subtle px-4 py-3">
        <div>
          <h4 className="text-xs font-semibold text-foreground">Configured Meter Points</h4>
          <p className="mt-1 text-[10px] leading-4 text-muted">
            One cumulative reading is retained as evidence but needs a later reading before an interval can be calculated.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-[10px] font-semibold">
          <span className="text-step-success">{health.summary.usable} usable</span>
          <span className="text-step-warning">{health.summary.insufficientHistory} need history</span>
          <span className="text-muted">{health.summary.noReadings} no readings</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-left text-xs">
          <thead className="bg-surface text-[10px] uppercase tracking-wide text-muted-light">
            <tr><th className="px-4 py-3">Meter Point</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Cumulative readings</th><th className="px-4 py-3 text-right">Intervals</th><th className="px-4 py-3">Coverage</th></tr>
          </thead>
          <tbody>
            {rows.map((meter) => (
              <tr key={meter.meterPointId} className="border-t border-border">
                <td className="px-4 py-3 font-semibold text-foreground">{meter.sourceLabel}</td>
                <td className="px-4 py-3"><MeterHealthBadge status={meter.status} /></td>
                <td className="px-4 py-3 text-right tabular-nums text-muted">{meter.cumulativeReadingCount.toLocaleString()}</td>
                <td className="px-4 py-3 text-right tabular-nums text-muted">{meter.intervalFactCount.toLocaleString()}</td>
                <td className="px-4 py-3 text-[10px] text-muted">
                  {meter.coverageFrom && meter.coverageTo
                    ? `${formatAnalysisTimestamp(meter.coverageFrom, timezone)} – ${formatAnalysisTimestamp(meter.coverageTo, timezone)}`
                    : "No interval coverage"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MeterHealthBadge({ status }: { status: EnergyMeterDataHealthDto["meters"][number]["status"] }) {
  const meta = status === "usable"
    ? { label: "Usable", className: "bg-step-success/10 text-step-success" }
    : status === "insufficient_history"
      ? { label: "Needs another reading", className: "bg-step-warning/10 text-step-warning" }
      : { label: "No readings", className: "bg-surface-subtle text-muted" };
  return <span className={`inline-flex rounded-full px-2 py-1 text-[9px] font-semibold ${meta.className}`}>{meta.label}</span>;
}

function meterHealthOrder(status: EnergyMeterDataHealthDto["meters"][number]["status"]): number {
  if (status === "no_readings") return 0;
  if (status === "insufficient_history") return 1;
  return 2;
}

function QualityFact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="bg-surface p-4"><dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-light">{label}</dt><dd className={["mt-2 text-sm font-semibold", mono ? "break-all font-mono text-[11px]" : ""].join(" ")}>{value}</dd></div>;
}

function ExceptionsEvidence({ analysis, limit }: { analysis: EnergyScopeAnalysisDto; limit: number }) {
  const items = analysis.attention.length > 0 ? analysis.attention : [{ code: "NO_EXCEPTION", severity: "info" as const, title: "No deterministic exception was triggered", evidence: "The selected scope passed the enabled rules.", suggestedAction: "Continue monitoring after the next import." }];
  return (
    <div className="space-y-3">
      {items.slice(0, limit).map((item) => (
        <div key={`${item.code}:${item.title}`} className="rounded-lg border border-border p-4">
          <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-surface-subtle px-2 py-0.5 text-[9px] font-semibold uppercase text-muted">{item.severity}</span><strong className="text-xs">{item.title}</strong></div>
          <p className="mt-2 text-xs leading-5 text-muted">{item.evidence}</p>
          <p className="mt-2 text-xs font-medium">{item.suggestedAction}</p>
        </div>
      ))}
      <p className="break-words text-[10px] text-muted-light">Queries: {analysis.provenance.queryIds.join(", ")} · Rules: {analysis.provenance.ruleRevisionIds.join(", ") || "none"} · Aggregation: {analysis.provenance.aggregationRule}</p>
    </div>
  );
}

function UnavailableModule({ detail }: { detail: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface-subtle px-4 py-5 text-xs text-muted">
      Preview withheld: {detail}
    </div>
  );
}

function formatNumber(value: number, digits: number): string {
  return value.toLocaleString("en-SG", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function formatCurrencyAmount(amount: number, currency: string, digits: number): string {
  const code = currency.trim().toUpperCase();
  const value = formatNumber(amount, digits);
  return code === "SGD" ? `S$${value}` : `${code} ${value}`;
}

function formatAnalysisTimestamp(value: string, timeZone: string): string {
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

function spanClass(span: EnergyTemplateRenderModule["placement"]["layout"]["span"]): string {
  switch (span) {
    case 4: return "lg:col-span-4";
    case 6: return "lg:col-span-6";
    case 8: return "lg:col-span-8";
    case 12: return "lg:col-span-12";
  }
}

function heightClass(height: EnergyTemplateRenderModule["placement"]["layout"]["height"]): string {
  switch (height) {
    case "compact": return "min-h-0";
    case "standard": return "min-h-[180px]";
    case "tall": return "min-h-[320px]";
  }
}
