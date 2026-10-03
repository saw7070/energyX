"use client";
import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import {
  Area, AreaChart, Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ReferenceArea, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  ANOMALY_THRESHOLD_PCT, CATEGORY_COLORS, CATEGORY_ORDER, average, dateWithDay, dayTypeBaselines,
  findAnomalies, hourlyProfile, meterHeatmap, openingLabel, overnightFloor, percentChange, scopeDays, shortDate, topHours, weekdayShort, weekdayWindows,
  type AnalysisCategory, type AnalysisDay, type AnalysisDayType, type PeakHour,
} from "./analysis-model";
import { loadAnalysis, type AnalysisData, type AnalysisRange, type ScopeData, type ScopeMeter, type TrendSeries } from "./analysis-data";
import { categoryLabel, dayTypeLabel, dayTypeWord, holidayName, joinText, rich, tariffNote } from "./analysis-messages";
import { viewMessages } from "./analysis-view-messages";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { PendingDayNote } from "./meter-health-notice";
import type { EnergyIqLocale, Translate } from "./energyiq-messages";
import { formatPeriod } from "./report-period";
import { EnergyIcon, type EnergyIconName } from "./icons";
import { circuitSlices, PeakShareDonut } from "./peak-share-donut";
import { DecisionSummary } from "./analysis-story";
import { TypeHint } from "./type-hint";
import { breakdownSpaces } from "./site-total";

// Layout of the approved NetZero analysis page on a light surface: white panels, slate borders.
const PANEL = "rounded-xl border border-slate-200 bg-white shadow-sm";
const SUB = "rounded-md border border-slate-200 bg-slate-50";
const SPACE_COLORS = ["#5B8BCF", "#4F9B86", "#9A8DBF", "#C9965B", "#6FB0C4", "#B97A95", "#8FA85B", "#8B95A5"];
const WEEKEND_FILL = "rgba(148, 163, 184, 0.22)";
const HOLIDAY_FILL = "rgba(251, 191, 36, 0.26)";
const GRID = { stroke: "#e2e8f0", strokeDasharray: "3 3" };
const AXIS = { stroke: "#64748b", tick: { fontSize: 10 } };
const TOOLTIP = { contentStyle: { backgroundColor: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, boxShadow: "0 4px 12px rgba(15,23,42,0.08)" }, labelStyle: { color: "#0f172a" }, itemStyle: { color: "#334155" } };
const DATE_EVERY = 3;
const DAY_TYPES: AnalysisDayType[] = ["weekday", "weekend", "public_holiday"];
type ViewText = Translate<keyof typeof viewMessages.en>;
/** Day-type buttons labelled in the reader's language. */
const dayTypeOptions = (locale: EnergyIqLocale) => DAY_TYPES.map(type => [type, dayTypeLabel(type, locale)] as [AnalysisDayType, string]);
const num = (value: number, digits = 1) => value.toLocaleString("en-SG", { maximumFractionDigits: digits });
const kwh = (value: number | null | undefined, digits = 1) => value == null ? "—" : `${num(value, digits)} kWh`;
const pct = (value: number | null) => value == null ? null : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
const slash = (date: string) => `${date.slice(5, 7)}/${date.slice(8, 10)}`;
const hh = (hour: number) => `${String(hour).padStart(2, "0")}:00`;
const period = (dates: string[], locale: EnergyIqLocale = "en") => !dates.length ? "—"
  : locale === "en" ? `${shortDate(dates[0]!)} – ${shortDate(dates.at(-1)!)} ${dates.at(-1)!.slice(0, 4)}` : formatPeriod(dates[0]!, dates.at(-1)!, locale);
const currencyMark = (currency: string) => currency === "SGD" ? "S$" : currency;
const money = (amount: number, currency: string) => `${currency} ${amount.toLocaleString("en-SG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const seriesKwh = (series: TrendSeries | null | undefined) => (series?.cells ?? []).reduce((sum, cell) => sum + (cell[2] ?? 0), 0);
const cellKwh = (series: TrendSeries | null | undefined, date: string, hour: number) => series?.cells.find(cell => cell[0] === date && cell[1] === hour)?.[2] ?? null;
const dayTypeName = (day: AnalysisDay, t: ViewText, locale: EnergyIqLocale) => day.dayType === "public_holiday" ? day.holidayName ? t("publicHolidayName", { name: holidayName(day.holidayName, locale) }) : t("publicHoliday") : dayTypeLabel(day.dayType, locale);
/** Heat colour, green (low) → yellow → orange → red (high), the same traffic-light scale as the device heatmap. */
const HEAT_STOPS: Array<[number, [number, number, number]]> = [[0, [99, 190, 123]], [0.35, [250, 215, 100]], [0.7, [240, 140, 60]], [1, [214, 60, 47]]];
const heatColor = (value: number, min: number, max: number) => {
  const t = max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0;
  const upper = HEAT_STOPS.findIndex(([at]) => at >= t);
  const [a, from] = HEAT_STOPS[Math.max(0, upper - 1)]!, [b, to] = HEAT_STOPS[Math.max(0, upper)]!;
  const mix = b === a ? 0 : (t - a) / (b - a);
  return `rgb(${from.map((channel, index) => Math.round(channel + (to[index]! - channel) * mix)).join(", ")})`;
};

type Guide = { title: string; summary: string; dataAcquisition: string[]; chartGeneration: string[] };
const GuideContext = createContext<(guide: Guide) => void>(() => undefined);

/** This site's three biggest circuits of a type, to make the type's meaning concrete. */
const examplesFor = (data: AnalysisData, category: AnalysisCategory) => data.circuits.filter(circuit => circuit.category === category).slice(0, 3).map(circuit => circuit.name);

type Derived = ReturnType<typeof derive>;
function derive(data: AnalysisData) {
  const days = scopeDays(data.current.project, data.holidays);
  const previousDays = data.previous ? scopeDays(data.previous.project, data.holidays) : [];
  const calibration = [...previousDays, ...days];
  const baselines = dayTypeBaselines(calibration);
  const spaces = data.current.spaces.map(space => {
    const previous = data.previous?.spaces.find(item => item.id === space.id) ?? null;
    const spaceDays = scopeDays(space, data.holidays);
    const spaceCalibration = [...(previous ? scopeDays(previous, data.holidays) : []), ...spaceDays];
    const spaceBaselines = dayTypeBaselines(spaceCalibration);
    return { scope: space, previous, days: spaceDays, calibration: spaceCalibration, baselines: spaceBaselines, anomalies: findAnomalies(spaceDays, spaceBaselines) };
  });
  const project = data.current.project;
  const rate = project.cost && project.usageKwh ? project.cost.amount / project.usageKwh : null;
  const complete = days.filter(day => day.complete);
  const avgOf = (type: AnalysisDayType) => average(complete.filter(day => day.dayType === type).map(day => day.totalKwh));
  const windows = weekdayWindows(project, days, data.openingHours);
  const floor = overnightFloor(data.history ?? project);
  const anomalies = findAnomalies(days, baselines);
  return { days, previousDays, calibration, baselines, anomalies, spaces, rate, avgOf, windows, floor, complete };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Dates and section from a link such as `?from=2026-08-14&to=2026-09-10&section=story-on` (dates inclusive). */
export function analysisLinkTarget(params: Pick<URLSearchParams, "get"> | null): { range: AnalysisRange | null; section: string | null } {
  const from = params?.get("from"), to = params?.get("to"), section = params?.get("section");
  return {
    range: from && to && DAY.test(from) && DAY.test(to) && from <= to ? { kind: "custom", from, to } : null,
    section: section && /^story-[a-z]+$/.test(section) ? section : null,
  };
}

export function AnalysisView({ projectId }: { projectId: string }) {
  const link = analysisLinkTarget(useSearchParams());
  const [range, setRange] = useState<AnalysisRange>(() => link.range ?? { kind: "latest-28" });
  const scrolledTo = useRef<string | null>(null);
  const [draft, setDraft] = useState({ from: "", to: "" });
  const [data, setData] = useState<AnalysisData | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [guide, setGuide] = useState<Guide | null>(null);
  const { locale } = useEnergyIqLocale();
  const t = useMessages(viewMessages);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(false);
    loadAnalysis(projectId, range)
      .then(result => { if (!cancelled) { setData(result); setDraft({ from: result.current.project.dates[0] ?? "", to: result.current.project.dates.at(-1) ?? "" }); } })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, range]);
  const derived = useMemo(() => data ? derive(data) : null, [data]);
  const dates = data?.current.project.dates ?? [];
  // A link can ask for one step of the story (for example from the Overview headline); scroll there once it is on screen.
  useEffect(() => {
    if (!data || loading || !link.section || scrolledTo.current === link.section) return;
    // The story renders after the figures arrive; try for a moment until the step exists. Timers rather than animation
    // frames, and an instant jump, so it also works in a tab opened in the background.
    let timer = 0, tries = 0;
    const attempt = () => {
      const target = document.getElementById(link.section!);
      if (!target) { if (tries++ < 40) timer = window.setTimeout(attempt, 100); return; }
      scrolledTo.current = link.section;
      const scroller = target.closest("main");
      if (scroller) scroller.scrollTo({ top: scroller.scrollTop + target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 16 });
      else target.scrollIntoView({ block: "start" });
    };
    timer = window.setTimeout(attempt, 0);
    return () => window.clearTimeout(timer);
  }, [data, loading, link.section]);
  return <GuideContext.Provider value={setGuide}>
    <div data-energyiq-analysis className="min-h-full bg-white text-slate-900">
      <div className="space-y-6 p-6">
        <header className="space-y-3">
          <p className="text-sm text-slate-600">{t("breadcrumb")}</p>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">{t("title")}</h1>
              <p className="max-w-3xl text-base leading-relaxed text-slate-600">{data ? t("intro", { name: data.projectName, period: period(dates, locale) }) : t("introEmpty")}</p>
              {data && <PendingDayNote projectId={projectId} lastLocalDay={dates.at(-1)} timezone={data.timezone} className="max-w-3xl text-sm leading-relaxed text-slate-600" />}
            </div>
            <form className="flex flex-wrap items-center gap-1.5 text-xs" aria-label={t("dates")} onSubmit={event => { event.preventDefault(); if (draft.from && draft.to && draft.from <= draft.to) setRange({ kind: "custom", from: draft.from, to: draft.to }); }}>
              <button type="button" aria-pressed={range.kind === "latest-28"} onClick={() => setRange({ kind: "latest-28" })} className={`rounded-md border px-3 py-1.5 ${range.kind === "latest-28" ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100"}`}>{t("latest")}</button>
              <input aria-label={t("from")} type="date" value={draft.from} max={draft.to || undefined} onChange={event => setDraft({ ...draft, from: event.target.value })} className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-slate-800" />
              <span className="text-slate-500">–</span>
              <input aria-label={t("to")} type="date" value={draft.to} min={draft.from || undefined} onChange={event => setDraft({ ...draft, to: event.target.value })} className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-slate-800" />
              <button type="submit" disabled={!draft.from || !draft.to || draft.from > draft.to} className="rounded-md bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-500 disabled:opacity-40">{t("apply")}</button>
            </form>
          </div>
        </header>
        {error ? <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{t("loadError")}</p>
          : !data || !derived ? <p role="status" className={`${PANEL} p-6 text-sm text-slate-500`}>{t("loading")}</p>
            : <AnalysisBody data={data} derived={derived} loading={loading} />}
      </div>
    </div>
    {guide && <Overlay label={guide.title} onClose={() => setGuide(null)} className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-slate-200 bg-white p-4" backdrop="bg-slate-900/40 px-4 z-[120]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div><h3 className="text-base font-semibold text-slate-900">{guide.title}</h3><p className="mt-1 text-sm text-slate-600">{guide.summary}</p></div>
        <button type="button" autoFocus onClick={() => setGuide(null)} aria-label={t("closeGuide")} className="rounded border border-slate-200 p-1 text-slate-700 hover:text-slate-900"><EnergyIcon name="close" className="h-4 w-4" /></button>
      </div>
      {([[t("guide.data"), guide.dataAcquisition], [t("guide.chart"), guide.chartGeneration]] as const).map(([heading, lines]) => <section key={heading} className="mb-3 rounded-md border border-slate-100 bg-slate-50 p-3 last:mb-0">
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-800">{heading}</h4>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">{lines.map(line => <li key={line}>{line}</li>)}</ul>
      </section>)}
    </Overlay>}
  </GuideContext.Provider>;
}

function Overlay({ label, onClose, className, backdrop = "z-50 bg-slate-900/40 p-4", children }: { label: string; onClose: () => void; className: string; backdrop?: string; children: ReactNode }) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  return <div className={`fixed inset-0 flex items-center justify-center ${backdrop}`} onClick={onClose}>
    <div role="dialog" aria-modal="true" aria-label={label} onClick={event => event.stopPropagation()} className={`text-slate-900 shadow-xl ${className}`}>{children}</div>
  </div>;
}

type SectionId = "summary" | "profiles" | "behaviour" | "circuits";
const SECTION_IDS: SectionId[] = ["summary", "profiles", "behaviour", "circuits"];
function AnalysisBody({ data, derived, loading }: { data: AnalysisData; derived: Derived; loading: boolean }) {
  const [collapsed, setCollapsed] = useState<Set<SectionId>>(new Set());
  const toggle = (id: SectionId) => setCollapsed(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const { locale } = useEnergyIqLocale();
  const t = useMessages(viewMessages);
  const project = data.current.project;
  const spaceNames = data.current.spaces.map(space => space.name).join(" & ");
  const allCollapsed = collapsed.size === SECTION_IDS.length;
  const where = `${data.projectName}${spaceNames ? ` · ${spaceNames}` : ""}`;
  const firstDay = dateWithDay(project.dates[0]!, locale), lastDay = dateWithDay(project.dates.at(-1)!, locale);
  return <div className={`space-y-6 transition-opacity ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
    <DecisionSummary data={data} days={derived.days} anomalies={derived.anomalies} floor={derived.floor} rate={derived.rate} />

    <div id="details" className="scroll-mt-4 border-t border-slate-200 pt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t("details.eyebrow")}</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-900">{t("details.title")}</h2>
          <p className="mt-1 text-sm text-slate-500">{t("details.body")}</p>
        </div>
        <button type="button" onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(SECTION_IDS))} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100">{allCollapsed ? t("expandAll") : t("collapseAll")}</button>
      </div>
    </div>
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-slate-700">
      <p className="font-medium text-emerald-800">{t("live", { where })}</p>
      <p className="mt-1 text-sm text-slate-600">{t("liveMeta", { from: firstDay, to: lastDay, days: project.dates.length })}</p>
      <p className="mt-1 text-sm text-slate-600">{rich(t("source", {
        snapshot: data.snapshotId ? t("snapshot", { id: data.snapshotId }) : "",
        coverage: project.coverage == null ? t("coverageUnknown") : t("coverage", { pct: project.coverage.toFixed(1) }),
      }), { link: <Link href={`/energyiq/project-configuration?${new URLSearchParams({ projectId: data.projectId, tab: "devices" })}`} className="text-blue-700 hover:text-blue-800">{t("openDevices")}</Link> })}</p>
    </div>

    <DailyTotalTrend data={data} derived={derived} />

    <Section title={t("exec.title")} subtitle={t("exec.subtitle", { where, from: firstDay, to: lastDay })} collapsed={collapsed.has("summary")} onToggle={() => toggle("summary")} guide={{
      title: t("exec.title"), summary: t("exec.summary"),
      dataAcquisition: [t("exec.data1"), t("exec.data2")],
      chartGeneration: [t("exec.chart1"), t("exec.chart2")],
    }}>
      <KeyHighlights data={data} derived={derived} />
      <ConsumptionBreakdown data={data} derived={derived} />
      <EnergyDistribution data={data} derived={derived} />
      <SummaryOfFindings data={data} derived={derived} />
    </Section>

    <Section title={t("profiles.title")} subtitle={t("profiles.subtitle")} collapsed={collapsed.has("profiles")} onToggle={() => toggle("profiles")} guide={{
      title: t("profiles.title"), summary: t("profiles.summary"),
      dataAcquisition: [t("profiles.data1"), t("profiles.data2")],
      chartGeneration: [t("profiles.chart1"), t("profiles.chart2")],
    }}>
      <DayProfiles data={data} derived={derived} />
    </Section>

    <Section title={t("behaviour.title")} subtitle={spaceNames ? t("behaviour.subtitleFor", { spaces: spaceNames }) : t("behaviour.subtitle")} collapsed={collapsed.has("behaviour")} onToggle={() => toggle("behaviour")} guide={{
      title: t("behaviour.title"), summary: t("behaviour.summary"),
      dataAcquisition: [t("behaviour.data1"), t("behaviour.data2")],
      chartGeneration: [t("behaviour.chart1"), t("behaviour.chart2")],
    }}>
      <HealthSummary data={data} derived={derived} />
    </Section>

    <Section title={t("circuits.title")} subtitle={spaceNames ? t("circuits.subtitleFor", { spaces: spaceNames }) : t("circuits.subtitle")} collapsed={collapsed.has("circuits")} onToggle={() => toggle("circuits")} guide={{
      title: t("circuits.title"), summary: t("circuits.summary"),
      dataAcquisition: [t("circuits.data1"), t("circuits.data2")],
      chartGeneration: [t("circuits.chart1")],
    }}>
      <CircuitRanking data={data} />
    </Section>

  </div>;
}

function Title({ children, guide, className = "text-sm font-semibold text-slate-900" }: { children: string; guide: Omit<Guide, "title">; className?: string }) {
  const open = useContext(GuideContext);
  const t = useMessages(viewMessages);
  return <button type="button" title={t("howCalculated")} onClick={() => open({ title: children, ...guide })} className={`inline-flex items-center gap-1 text-left hover:text-blue-700 ${className}`}><span>{children}</span><EnergyIcon name="info" className="h-3.5 w-3.5 text-slate-500" /></button>;
}
function Section({ title, subtitle, collapsed, onToggle, guide, children }: { title: string; subtitle: string; collapsed: boolean; onToggle: () => void; guide: Guide; children: ReactNode }) {
  const t = useMessages(viewMessages);
  return <section className="space-y-3">
    <div className="flex items-center justify-between gap-3">
      <div><h2><Title guide={guide} className="text-base font-semibold text-slate-900">{title}</Title></h2><p className="text-sm text-slate-600">{subtitle}</p></div>
      <button type="button" aria-expanded={!collapsed} aria-label={t(collapsed ? "expandSection" : "collapseSection", { title })} onClick={onToggle} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-sm text-slate-700 hover:bg-slate-100"><EnergyIcon name="chevron" className={`h-3.5 w-3.5 ${collapsed ? "rotate-90" : "-rotate-90"}`} />{collapsed ? t("expand") : t("collapse")}</button>
    </div>
    {!collapsed && children}
  </section>;
}
function Toggle<T extends string>({ label, options, value, onChange }: { label: string; options: Array<[T, string]>; value: T; onChange: (value: T) => void }) {
  return <div className={`${SUB} p-2`}>
    <p className="mb-2 text-[11px] text-slate-500">{label}</p>
    <div className="inline-flex flex-wrap rounded border border-slate-200 bg-white p-1" role="group" aria-label={label}>{options.map(([id, text]) => <button key={id} type="button" aria-pressed={value === id} onClick={() => onChange(id)} className={`rounded px-2 py-1 text-[10px] ${value === id ? "bg-blue-600 text-white" : "text-slate-700 hover:text-slate-900"}`}>{text}</button>)}</div>
  </div>;
}
function Select({ label, value, onChange, options, className = "" }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]>; className?: string }) {
  return <select aria-label={label} value={value} onChange={event => onChange(event.target.value)} className={`rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-slate-800 ${className}`}>{options.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select>;
}
function TrendBadge({ change, label }: { change: number | null; label: string }) {
  const t = useMessages(viewMessages);
  if (change == null) return null;
  const tone = change === 0 ? "bg-slate-100 text-slate-700" : change > 0 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700";
  return <span title={t("badge.title", { label })} className={`inline-flex flex-col items-end gap-0.5 rounded px-2 py-1 text-xs ${tone}`}><span>{change > 0 ? "↗ +" : change < 0 ? "↘ " : ""}{change.toFixed(1)}%</span><span className="text-[10px] uppercase tracking-wide opacity-80">{t("badge.vsPrev")}</span></span>;
}
function InlineChange({ change }: { change: number | null }) {
  return change == null ? null : <span className={`ml-1.5 text-xs ${change > 0 ? "text-amber-700" : "text-emerald-700"}`}>{pct(change)}</span>;
}
/** Weekday name on every bar, the date every third bar, and a PH badge on public holidays. */
function makeDayTick(holidays: Map<string, string>, locale: EnergyIqLocale = "en", holidayBadge = "PH") {
  return function DayTick({ x, y, index = 0, payload }: { x?: number | string; y?: number | string; index?: number; payload?: { value: string } }) {
    const date = payload?.value ?? "";
    const showDate = index % DATE_EVERY === 0;
    return <g transform={`translate(${x ?? 0},${y ?? 0})`}>
      <text dy={10} textAnchor="middle" fill="#475569" fontSize={10}>{weekdayShort(date, locale)}</text>
      {showDate && <text dy={22} textAnchor="middle" fill="#94a3b8" fontSize={9}>{slash(date)}</text>}
      {holidays.has(date) && <text dy={showDate ? 34 : 22} textAnchor="middle" fill="#b45309" fontSize={8}>{holidayBadge}</text>}
    </g>;
  };
}

// ---------- Daily Total Trend ----------
function DailyTotalTrend({ data, derived }: { data: AnalysisData; derived: Derived }) {
  const [dayType, setDayType] = useState<AnalysisDayType>("weekday");
  const [space, setSpace] = useState("all");
  const { locale } = useEnergyIqLocale();
  const t = useMessages(viewMessages);
  const DayTick = useMemo(() => makeDayTick(data.holidays, locale, t("ph")), [data.holidays, locale, t]);
  const spaceItem = derived.spaces.find(item => item.scope.id === space);
  const selected = spaceItem ? { ...spaceItem, name: spaceItem.scope.name } : { days: derived.days, baselines: derived.baselines, anomalies: derived.anomalies, calibration: derived.calibration, name: t("allSpaces") };
  const baseline = selected.baselines.find(item => item.dayType === dayType)!;
  const shown = selected.days.filter(day => day.dayType === dayType);
  const complete = shown.filter(day => day.complete);
  const incomplete = shown.filter(day => !day.complete && day.totalKwh > 0).length;
  const anomalies = selected.anomalies.filter(item => item.dayType === dayType);
  const threshold = baseline.expectedKwh == null ? null : baseline.expectedKwh * (1 + ANOMALY_THRESHOLD_PCT / 100);
  const rows = shown.map(day => ({ date: day.date, total: day.totalKwh > 0 ? day.totalKwh : null, complete: day.complete, expected: baseline.expectedKwh, threshold }));
  const calibrationDates = selected.calibration.map(day => day.date).sort();
  // The area that only holds the main meter is the site total, not a part of it; it is already the daily total column.
  const listedSpaces = breakdownSpaces(derived.spaces, item => item.scope);
  const showSpaces = !spaceItem && listedSpaces.length > 1;
  const label = dayTypeWord(dayType, locale);
  const dailyTotalName = t("trend.dailyTotal");
  return <section className={`${PANEL} p-4`}>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div>
        <Title guide={{ summary: t("trend.summary"), dataAcquisition: [t("trend.data1"), t("trend.data2")], chartGeneration: [t("trend.chart1"), t("trend.chart2", { pct: ANOMALY_THRESHOLD_PCT })] }}>{t("trend.title")}</Title>
        <p className="text-sm text-slate-600">{t("trend.meta", {
          samples: t(complete.length === 1 ? "trend.samples.one" : "trend.samples.other", { count: complete.length, type: label }),
          baseline: baseline.expectedKwh == null ? t("trend.baselineNeeds") : t("unit.perDay", { value: num(baseline.expectedKwh) }),
          calibrated: calibrationDates.length ? `${dateWithDay(calibrationDates[0]!, locale)} – ${dateWithDay(calibrationDates.at(-1)!, locale)}` : "—",
          pct: ANOMALY_THRESHOLD_PCT,
        })}</p>
      </div>
    </div>
    <div className="mb-3 text-sm text-slate-700">{rich(t("trend.scope"), { name: <span className="font-semibold text-slate-900">{selected.name}</span> })}</div>
    <div className="mb-3 flex flex-wrap items-start gap-3">
      <Toggle label={t("trend.dayType")} value={dayType} onChange={setDayType} options={dayTypeOptions(locale)} />
      {derived.spaces.length > 0 && <Toggle label={t("spaceFilter")} value={space} onChange={setSpace} options={[["all", t("allSpaces")], ...derived.spaces.map(item => [item.scope.id, item.scope.name] as [string, string])]} />}
    </div>
    <div className="mb-1 text-[11px] text-slate-500">{incomplete ? t("trend.captionFaded", { type: dayTypeLabel(dayType, locale), count: incomplete }) : t("trend.caption", { type: dayTypeLabel(dayType, locale) })}</div>
    <div className="mb-4 h-80">
      {rows.length ? <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 8, left: 2 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="date" stroke="#64748b" interval={0} height={48} tick={DayTick} />
          <YAxis {...AXIS} width={40} />
          <Tooltip {...TOOLTIP} labelFormatter={date => dateWithDay(String(date), locale)} formatter={(value, name, item) => [value == null ? "—" : `${Number(value).toFixed(1)} kWh${item.dataKey === "total" && !(item.payload as { complete: boolean }).complete ? t("trend.incomplete") : ""}`, String(name)]} />
          <Legend itemSorter={null} wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="total" fill="#5B8BCF" name={dailyTotalName} radius={[4, 4, 0, 0]} isAnimationActive={false}>{rows.map(row => <Cell key={row.date} fillOpacity={row.complete ? 1 : 0.35} />)}</Bar>
          <Line type="monotone" dataKey="expected" stroke="#f59e0b" strokeWidth={2} dot={false} strokeLinejoin="round" strokeLinecap="round" name={t("trend.expected")} isAnimationActive={false} />
          <Line type="monotone" dataKey="threshold" stroke="#ef4444" strokeDasharray="4 4" strokeWidth={1.8} dot={false} strokeLinejoin="round" strokeLinecap="round" name={t("trend.threshold", { pct: 100 + ANOMALY_THRESHOLD_PCT })} isAnimationActive={false} />
          {anomalies.map(item => <ReferenceDot key={item.date} x={item.date} y={item.totalKwh} r={4} fill="#ef4444" stroke="#fff" strokeWidth={1.2} />)}
        </ComposedChart>
      </ResponsiveContainer> : <div className="flex h-full items-center justify-center rounded-md border border-dashed border-slate-200 text-sm text-slate-600">{t("trend.noDays", { type: label })}</div>}
    </div>
    <div className="mb-2 text-sm text-slate-700">{rich(t(complete.length === 1 ? "trend.detected.one" : "trend.detected.other", { total: complete.length, type: label }), { count: <span className="font-semibold text-rose-700">{anomalies.length}</span> })}</div>
    <div className="rounded-md border border-slate-200">
      <div className="border-b border-slate-200 bg-white px-3 py-2"><Title className="text-xs font-medium text-slate-700" guide={{ summary: t("anomalies.summary"), dataAcquisition: [t("anomalies.data1")], chartGeneration: [t("anomalies.chart1")] }}>{t("anomalies.title")}</Title></div>
      <div className="max-h-72 overflow-auto">
        {anomalies.length ? <table className="w-full min-w-[640px] text-sm">
          <thead className="sticky top-0 bg-slate-100 text-slate-700"><tr><th className="px-3 py-2 text-left">{t("col.date")}</th><th className="px-3 py-2 text-left">{t("col.type")}</th><th className="px-3 py-2 text-right">{t("col.dailyTotal")}</th><th className="px-3 py-2 text-right">{t("col.expected")}</th><th className="px-3 py-2 text-right">{t("col.threshold")}</th>{showSpaces && <th className="px-3 py-2 text-right">{listedSpaces.map(item => item.scope.name).join(" / ")} (kWh)</th>}<th className="px-3 py-2 text-right">{t("col.delta")}</th><th className="px-3 py-2 text-left">{t("col.status")}</th></tr></thead>
          <tbody>{anomalies.map(item => <tr key={item.date} className="border-t border-slate-200 text-slate-800 hover:bg-slate-50">
            <td className="px-3 py-2">{dateWithDay(item.date, locale)}</td><td className="px-3 py-2">{dayTypeLabel(item.dayType, locale)}</td>
            <td className="px-3 py-2 text-right">{num(item.totalKwh)}</td><td className="px-3 py-2 text-right">{num(item.expectedKwh)}</td><td className="px-3 py-2 text-right">{num(item.expectedKwh * (1 + ANOMALY_THRESHOLD_PCT / 100))}</td>
            {showSpaces && <td className="px-3 py-2 text-right text-slate-500">{listedSpaces.map(entry => num(entry.days.find(day => day.date === item.date)?.totalKwh ?? 0)).join(" / ")}</td>}
            <td className="px-3 py-2 text-right text-rose-700">+{item.deltaPct.toFixed(1)}%</td><td className="px-3 py-2"><span className="rounded bg-rose-100 px-2 py-0.5 text-rose-700">{t("anomaly")}</span></td>
          </tr>)}</tbody>
        </table> : <p className="px-3 py-4 text-sm text-slate-600">{baseline.expectedKwh == null ? t("trend.noBaseline", { type: label }) : t("trend.noneAbove", { type: label, pct: ANOMALY_THRESHOLD_PCT })}</p>}
      </div>
    </div>
  </section>;
}

// ---------- Executive summary ----------
type CardId = "total" | "average" | "cost";
function KeyHighlights({ data, derived }: { data: AnalysisData; derived: Derived }) {
  const [open, setOpen] = useState<CardId | "peak" | null>(null);
  const { locale } = useEnergyIqLocale();
  const t = useMessages(viewMessages);
  const project = data.current.project, previous = data.previous?.project ?? null;
  const dailyAvg = average(derived.complete.map(day => day.totalKwh));
  const previousAvg = average(derived.previousDays.filter(day => day.complete).map(day => day.totalKwh));
  const peaks = topHours(project, 5);
  const previousLabel = previous ? `${dateWithDay(previous.dates[0]!, locale)} – ${dateWithDay(previous.dates.at(-1)!, locale)}` : "";
  const cards: Array<{ id: CardId | "peak"; icon: EnergyIconName; title: string; value: string; change: number | null; detail: string; link: string }> = [
    { id: "total", icon: "bolt", title: t("kh.total"), value: kwh(project.usageKwh), change: percentChange(project.usageKwh, previous?.usageKwh), detail: previous ? t("kh.vsPrevious", { label: previousLabel, value: kwh(previous.usageKwh) }) : t("kh.noPrevious"), link: t("kh.viewBreakdown") },
    { id: "average", icon: "calendar", title: t("kh.average"), value: dailyAvg == null ? "—" : t("unit.perDay", { value: num(dailyAvg) }), change: percentChange(dailyAvg, previousAvg), detail: previousAvg == null ? t("kh.completeOnly", { count: derived.complete.length, total: project.dates.length }) : t("kh.previousAverage", { value: t("unit.perDay", { value: num(previousAvg) }) }), link: t("kh.viewBreakdown") },
    { id: "peak", icon: "analysis", title: t("kh.peak"), value: peaks[0] ? `${num(peaks[0].kwh)} kWh` : "—", change: null, detail: peaks[0] ? `${dateWithDay(peaks[0].date, locale)} · ${hh(peaks[0].hour)}–${hh(peaks[0].hour + 1)}` : t("kh.noHour"), link: t("kh.viewPeaks") },
    { id: "cost", icon: "document", title: t("kh.cost"), value: project.cost ? money(project.cost.amount, project.cost.currency) : "—", change: percentChange(project.cost?.amount, previous?.cost?.amount), detail: project.cost ? t("kh.tariff", { note: tariffNote(project.cost, locale) }) + (previous?.cost ? t("kh.previousCost", { value: money(previous.cost.amount, previous.cost.currency) }) : "") : t("kh.noRate"), link: t("kh.viewBreakdown") },
  ];
  return <div>
    <h3 className="mb-3 text-sm font-semibold text-slate-900">{t("kh.title")}</h3>
    <p className="mb-3 text-sm text-slate-600">{previous ? t("kh.intro", { label: previousLabel }) : t("kh.introNone")}</p>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{cards.map(card => <button key={card.id} type="button" onClick={() => setOpen(card.id)} className={`${PANEL} cursor-pointer p-4 text-left transition hover:border-blue-300 hover:bg-slate-50`}>
      <div className="mb-2 flex items-center justify-between">
        <span className="rounded-lg bg-blue-50 p-2 text-blue-700"><EnergyIcon name={card.icon} className="h-4 w-4" /></span>
        {card.id !== "peak" && <TrendBadge change={card.change} label={previousLabel} />}
      </div>
      <p className="text-xs uppercase tracking-wide text-slate-600">{card.title}</p>
      <p className="mt-1 text-lg font-semibold text-slate-900">{card.value}</p>
      <p className="mt-1 text-sm text-slate-600">{card.detail}</p>
      <p className="mt-2 text-xs text-blue-700">{card.link}</p>
    </button>)}</div>
    {open === "peak" ? <PeakModal data={data} peaks={peaks} onClose={() => setOpen(null)} />
      : open ? <BreakdownModal data={data} derived={derived} card={cards.find(card => card.id === open)!} kind={open} previousLabel={previousLabel} onClose={() => setOpen(null)} /> : null}
  </div>;
}

function BreakdownModal({ data, derived, card, kind, previousLabel, onClose }: { data: AnalysisData; derived: Derived; card: { title: string; value: string; change: number | null; detail: string }; kind: CardId; previousLabel: string; onClose: () => void }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(data.current.spaces.map(space => space.id)));
  const [circuits, setCircuits] = useState<Set<string>>(new Set());
  const t = useMessages(viewMessages);
  const days = data.current.project.dates.length, previousDays = data.previous?.project.dates.length ?? 1;
  const currency = data.current.project.cost?.currency ?? "";
  // Same unit as the card: kWh, kWh per day, or money at the period's average rate.
  const show = (amount: number | null, dayCount: number) => amount == null ? "—" : kind === "average" ? t("unit.perDay", { value: num(amount / dayCount) }) : kind === "cost" && derived.rate != null ? money(amount * derived.rate, currency) : kwh(amount);
  const flip = (set: Set<string>, id: string) => { const next = new Set(set); if (next.has(id)) next.delete(id); else next.add(id); return next; };
  const meterRow = (meter: ScopeMeter, previous: ScopeData | null, muted = false) => {
    const now = seriesKwh(meter.series), before = previous ? seriesKwh(previous.meters.find(item => item.id === meter.id)?.series) : null;
    return <li key={meter.id} className={`flex items-center justify-between gap-3 text-xs ${muted ? "text-slate-500" : "text-slate-800"}`}>
      <span className="flex min-w-0 items-center gap-2"><span className="inline-block h-2 w-2 shrink-0 rounded-sm" style={{ background: meter.category === "overall" ? "#8B95A5" : CATEGORY_COLORS[meter.category] }} /><span className="truncate" title={meter.name}>{meter.name}</span></span>
      <span className="shrink-0">{show(now, days)}<InlineChange change={percentChange(now, before || null)} /></span>
    </li>;
  };
  return <Overlay label={t("bd.label", { title: card.title })} onClose={onClose} className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-slate-200 bg-slate-50">
    <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-5">
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-600">{t("bd.eyebrow")}</p>
        <h3 className="text-lg font-semibold text-slate-900">{card.title}</h3>
        <p className="mt-1 text-sm text-emerald-700">{card.value}<InlineChange change={card.change} /></p>
        <p className="mt-1 text-sm text-slate-600">{card.detail}</p>
      </div>
      <button type="button" autoFocus onClick={onClose} className="rounded-md border border-slate-200 px-2.5 py-1 text-sm text-slate-700 hover:bg-slate-50">{t("close")}</button>
    </div>
    <div className="overflow-y-auto p-5">
      <div className="space-y-3">{derived.spaces.length ? breakdownSpaces(derived.spaces, item => item.scope).map(({ scope, previous }) => {
        const open = expanded.has(scope.id), showCircuits = circuits.has(scope.id);
        const withSeries = scope.meters.filter(meter => meter.series);
        const aggregates = withSeries.filter(meter => meter.official), subMeters = withSeries.filter(meter => !meter.official).sort((a, b) => seriesKwh(b.series) - seriesKwh(a.series));
        return <div key={scope.id} className="rounded-lg border border-slate-200 bg-slate-50">
          <button type="button" aria-expanded={open} onClick={() => setExpanded(flip(expanded, scope.id))} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
            <span className="inline-flex items-center gap-2 text-sm font-medium text-slate-900"><EnergyIcon name="chevron" className={`h-4 w-4 text-slate-500 ${open ? "rotate-90" : ""}`} />{scope.name}</span>
            <span className="text-sm text-slate-800">{show(scope.usageKwh, days)}<InlineChange change={percentChange(kind === "average" && scope.usageKwh != null ? scope.usageKwh / days : scope.usageKwh, kind === "average" && previous?.usageKwh != null ? previous.usageKwh / previousDays : previous?.usageKwh)} /></span>
          </button>
          {open && <div className="border-t border-slate-200 px-4 py-3">
            {aggregates.length > 0 && <><p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">{t("bd.aggregate")}</p><ul className="space-y-2">{aggregates.map(meter => meterRow(meter, previous))}</ul></>}
            {subMeters.length > 0 && <>
              <button type="button" onClick={() => setCircuits(flip(circuits, scope.id))} className={`inline-flex items-center gap-1 text-xs text-blue-700 hover:text-blue-800 ${aggregates.length ? "mt-4" : ""}`}><EnergyIcon name="chevron" className={`h-3.5 w-3.5 ${showCircuits ? "rotate-90" : ""}`} />{showCircuits ? t("bd.hideCircuits") : t("bd.showCircuits")}</button>
              {showCircuits && <ul className="mt-3 space-y-2 border-t border-slate-100 pt-3">{subMeters.map(meter => meterRow(meter, previous, true))}</ul>}
            </>}
            {!withSeries.length && <p className="text-sm text-slate-600">{t("bd.noMeters")}</p>}
          </div>}
        </div>;
      }) : CATEGORY_ORDER.filter(category => data.current.project.typeTotals[category]).map(category => {
        const now = data.current.project.typeTotals[category] ?? null, before = data.previous?.project.typeTotals[category] ?? null;
        return <div key={category} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
          <span className="inline-flex items-center gap-2 font-medium text-slate-900"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: CATEGORY_COLORS[category] }} /><TypeHint category={category} examples={examplesFor(data, category)} place={data.projectName} /></span>
          <span className="text-slate-800">{show(now, days)}<InlineChange change={percentChange(now, before)} /></span>
        </div>;
      })}</div>
      <p className="mt-4 text-sm text-slate-600">{derived.spaces.length ? t("bd.spaceNote") : t("bd.typeNote")}{previousLabel ? t("bd.comparePrevious", { label: previousLabel }) : ""}{kind === "cost" && derived.rate != null ? t("bd.rate", { rate: derived.rate.toFixed(4), currency }) : ""}</p>
    </div>
  </Overlay>;
}

function PeakModal({ data, peaks, onClose }: { data: AnalysisData; peaks: PeakHour[]; onClose: () => void }) {
  const [rank, setRank] = useState(0);
  const [spaceId, setSpaceId] = useState(data.current.spaces[0]?.id ?? "");
  const { locale } = useEnergyIqLocale();
  const t = useMessages(viewMessages);
  const peak = peaks[rank];
  if (!peak) return null;
  const spaces = data.current.spaces.map((space, index) => ({ space, kwh: cellKwh(space.total, peak.date, peak.hour) ?? 0, color: SPACE_COLORS[index % SPACE_COLORS.length]! }));
  const space = data.current.spaces.find(item => item.id === spaceId);
  const meters = space ? space.meters.filter(meter => meter.series && (!meter.official || space.meters.every(item => item.official))) : [];
  const meterRows = meters.map(meter => ({ meter, kwh: cellKwh(meter.series, peak.date, peak.hour) ?? 0 })).filter(row => row.kwh > 0).sort((a, b) => b.kwh - a.kwh);
  const spaceHourKwh = spaces.find(row => row.space.id === spaceId)?.kwh ?? 0;
  return <Overlay label={t("kh.peak")} onClose={onClose} className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl border border-slate-200 bg-slate-50">
    <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-5">
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-600">{t("peak.eyebrow")}</p>
        <h3 className="text-lg font-semibold text-slate-900">{t("kh.peak")}</h3>
        <p className="mt-1 text-sm text-emerald-700">{num(peak.kwh)} kWh ({hh(peak.hour)}–{hh(peak.hour + 1)})</p>
        <p className="mt-1 text-sm text-slate-600">{dateWithDay(peak.date, locale)} · {hh(peak.hour)}–{hh(peak.hour + 1)}</p>
      </div>
      <button type="button" autoFocus onClick={onClose} className="rounded-md border border-slate-200 px-2.5 py-1 text-sm text-slate-700 hover:bg-slate-50">{t("close")}</button>
    </div>
    <div className="overflow-y-auto p-5">
      <label className="mb-1 block text-sm text-slate-600" htmlFor="analysis-peak">{t("peak.select")}</label>
      <select id="analysis-peak" value={rank} onChange={event => setRank(Number(event.target.value))} className="mb-4 w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-800">{peaks.map((item, index) => <option key={`${item.date}-${item.hour}`} value={index}>#{index + 1} · {dateWithDay(item.date, locale)} {hh(item.hour)}–{hh(item.hour + 1)} · {num(item.kwh)} kWh</option>)}</select>
      {spaces.length ? <>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">{t("peak.bySpace")}</p>
        <div className="mb-4 space-y-2">{spaces.map(row => <button key={row.space.id} type="button" aria-pressed={spaceId === row.space.id} onClick={() => setSpaceId(row.space.id)} className={`block w-full rounded-lg border px-3 py-2 text-left ${spaceId === row.space.id ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-slate-50 hover:bg-slate-50"}`}>
          <div className="flex justify-between text-sm text-slate-800"><span>{row.space.name}</span><span>{num(row.kwh, 2)} kWh · {peak.kwh > 0 ? num(row.kwh / peak.kwh * 100) : "—"}%</span></div>
          <div className="mt-1.5 h-1.5 rounded bg-slate-100"><div className="h-full rounded" style={{ width: `${peak.kwh > 0 ? Math.min(100, row.kwh / peak.kwh * 100) : 0}%`, background: row.color }} /></div>
        </button>)}</div>
        {space && <><p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">{t("peak.circuitsIn", { space: space.name })}</p>
          {meterRows.length > 0 && spaceHourKwh > 0 && <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4"><PeakShareDonut spaceName={space.name} total={spaceHourKwh} slices={circuitSlices(meters.map(meter => ({ id: meter.id, name: meter.name, kwh: cellKwh(meter.series, peak.date, peak.hour) ?? 0, periodKwh: meter.series?.cells.reduce((sum, cell) => sum + (cell[2] ?? 0), 0) ?? 0 })), spaceHourKwh, locale)} /></div>}
          {meterRows.length ? <table className="w-full text-xs"><thead className="bg-slate-100 text-slate-700"><tr><th className="px-3 py-2 text-left">{t("col.circuit")}</th><th className="px-3 py-2 text-left">{t("col.type")}</th><th className="px-3 py-2 text-right">kWh</th><th className="px-3 py-2 text-right">{t("col.shareOfSpace")}</th></tr></thead>
            <tbody>{meterRows.map(row => <tr key={row.meter.id} className="border-t border-slate-200 text-slate-800"><td className="px-3 py-2">{row.meter.name}</td><td className="px-3 py-2 text-slate-500">{row.meter.category === "overall" ? t("type.total") : categoryLabel(row.meter.category, locale)}</td><td className="px-3 py-2 text-right">{num(row.kwh, 2)}</td><td className="px-3 py-2 text-right">{spaceHourKwh > 0 ? `${num(row.kwh / spaceHourKwh * 100)}%` : "—"}</td></tr>)}</tbody></table>
            : <p className="text-sm text-slate-600">{t("peak.noCircuitReadings")}</p>}</>}
      </> : <p className="text-sm text-slate-600">{t("peak.noSpaces")}</p>}
    </div>
  </Overlay>;
}

function ConsumptionBreakdown({ data, derived }: { data: AnalysisData; derived: Derived }) {
  const [mode, setMode] = useState<"tag" | "space">("tag");
  const [value, setValue] = useState("all");
  const { locale } = useEnergyIqLocale();
  const t = useMessages(viewMessages);
  const DayTick = useMemo(() => makeDayTick(data.holidays, locale, t("ph")), [data.holidays, locale, t]);
  const categories = CATEGORY_ORDER.filter(category => derived.days.some(day => (day.byCategory[category] ?? 0) > 0));
  const series = mode === "tag"
    ? (value === "all" ? categories : categories.filter(category => category === value)).map(category => ({ key: category as string, label: categoryLabel(category, locale), color: CATEGORY_COLORS[category] }))
    // Stacking the main meter's area on top of the areas below it would count the site twice.
    : breakdownSpaces(derived.spaces, item => item.scope).map((item, index) => ({ key: item.scope.id, label: item.scope.name, color: SPACE_COLORS[index % SPACE_COLORS.length]! })).filter(item => value === "all" || item.key === value);
  const useTotal = series.length === 0;
  const currency = data.current.project.cost?.currency ?? "";
  const rows = derived.days.map(day => {
    const row: Record<string, number | string | boolean | null> = { date: day.date, dayType: dayTypeName(day, t, locale), complete: day.complete };
    if (mode === "tag") for (const category of categories) row[category] = day.byCategory[category] ?? 0;
    else for (const item of derived.spaces) row[item.scope.id] = item.days.find(entry => entry.date === day.date)?.totalKwh ?? 0;
    const shownKwh = useTotal ? day.totalKwh : series.reduce((sum, item) => sum + Number(row[item.key] ?? 0), 0);
    row.total = shownKwh;
    row.cost = derived.rate == null ? null : Math.round(shownKwh * derived.rate * 100) / 100;
    return row;
  });
  const periodAverage = average(rows.filter(row => row.complete).map(row => Number(row.total))) ?? 0;
  // Contiguous weekend and public-holiday runs, shaded as one band each.
  const bands: Array<{ start: string; end: string; fill: string }> = [];
  for (const day of derived.days) {
    const fill = day.dayType === "public_holiday" ? HOLIDAY_FILL : day.dayType === "weekend" ? WEEKEND_FILL : null;
    const last = bands.at(-1);
    if (!fill) continue;
    const previousDate = derived.days[derived.days.indexOf(day) - 1]?.date;
    if (last && last.fill === fill && last.end === previousDate) last.end = day.date;
    else bands.push({ start: day.date, end: day.date, fill });
  }
  const options: Array<[string, string]> = mode === "tag"
    ? [["all", t("cb.allTags")], ...categories.map(category => [category, categoryLabel(category, locale)] as [string, string])]
    : [["all", t("allSpaces")], ...derived.spaces.map(item => [item.scope.id, item.scope.name] as [string, string])];
  const costLabel = t("cb.costLabel", { mark: currencyMark(currency) });
  const dailyTotal = t("cb.dailyTotal");
  return <section className={`${PANEL} mt-4 p-4`}>
    <div className="mb-2"><Title guide={{ summary: t("cb.summary"), dataAcquisition: [t("cb.data1"), t("cb.data2")], chartGeneration: [t("cb.chart1"), t("cb.chart2"), t("cb.chart3")] }}>{t("cb.title")}</Title></div>
    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
      <div className="flex flex-1 flex-wrap items-center gap-1.5 text-xs">
        <Select label={t("cb.filter")} className="min-w-[140px]" value={mode} onChange={next => { setMode(next as "tag" | "space"); setValue("all"); }} options={[["tag", t("cb.byTag")], ...(derived.spaces.length ? [["space", t("cb.bySpace")] as [string, string]] : [])]} />
        <Select label={mode === "tag" ? t("cb.tag") : t("cb.space")} className="min-w-[170px]" value={value} onChange={setValue} options={options} />
      </div>
    </div>
    <div className="mb-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px] text-slate-500">
      <span>{t("cb.caption")}</span>
      <div className="flex flex-wrap items-center gap-3">
        {([["weekend", dayTypeLabel("weekend", locale), WEEKEND_FILL], ["holiday", t("publicHoliday"), HOLIDAY_FILL]] as const).map(([id, text, fill]) => <span key={id} className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-4 rounded-sm border border-slate-300" style={{ backgroundColor: fill }} />{text}</span>)}
        {derived.rate != null && <><span className="text-slate-500">·</span><span>{t("cb.costCaption", { mark: currencyMark(currency) })}</span></>}
      </div>
    </div>
    <div className="h-80">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ bottom: 16, top: 8, right: 8, left: 0 }}>
          <CartesianGrid {...GRID} yAxisId="usage" />
          {bands.map(band => <ReferenceArea key={band.start} yAxisId="usage" x1={band.start} x2={band.end} fill={band.fill} fillOpacity={1} strokeOpacity={0} />)}
          <XAxis dataKey="date" stroke="#64748b" interval={0} height={48} tick={DayTick} />
          <YAxis yAxisId="usage" {...AXIS} />
          {derived.rate != null && <YAxis yAxisId="cost" orientation="right" {...AXIS} />}
          <Tooltip cursor={{ fill: "rgba(15, 23, 42, 0.04)" }} content={({ active, payload }) => {
            const row = active ? payload?.[0]?.payload as (typeof rows)[number] | undefined : undefined;
            if (!row) return null;
            const total = Number(row.total), versus = periodAverage > 0 ? (total - periodAverage) / periodAverage * 100 : 0;
            return <div className="rounded-lg border border-slate-200 bg-white/95 shadow-lg px-3 py-2 text-sm text-slate-800">
              <p className="mb-1 text-base font-semibold text-slate-900">{dateWithDay(String(row.date), locale)}</p>
              <p className="mb-1 text-slate-500">{String(row.dayType)}{row.complete ? "" : t("cb.incompleteDay")}</p>
              <div className="space-y-0.5">
                {(useTotal ? [{ key: "total", label: dailyTotal, color: "#5B8BCF" }] : series).map(item => <div key={item.key} className="flex items-center gap-2"><span className="inline-block h-3 w-3 border border-slate-300" style={{ backgroundColor: item.color }} />{t("cb.row", { label: item.label, kwh: Number(row[item.key] ?? 0).toFixed(1) })}</div>)}
                <div className="flex items-center gap-2"><span className="inline-block h-3 w-3 border border-slate-300 bg-[#db2777]" />{t("cb.periodAverage", { kwh: periodAverage.toFixed(1) })}</div>
                <p className="pt-1 font-semibold text-slate-900">{t("cb.total", { kwh: total.toFixed(1) })}</p>
                {row.cost != null && <p className="font-semibold text-slate-900">{t("cb.cost", { mark: currencyMark(currency), value: Number(row.cost).toFixed(2) })}</p>}
                <p className={`font-semibold ${versus >= 0 ? "text-rose-700" : "text-emerald-700"}`}>{t("cb.vsAvg", { change: `${versus >= 0 ? "+" : ""}${versus.toFixed(1)}` })}</p>
              </div>
            </div>;
          }} />
          <Legend itemSorter={null} wrapperStyle={{ fontSize: 10 }} iconSize={8} />
          {useTotal ? <Bar yAxisId="usage" dataKey="total" name={dailyTotal} fill="#5B8BCF" isAnimationActive={false} />
            : series.map(item => <Bar key={item.key} yAxisId="usage" dataKey={item.key} stackId="usage" name={item.label} fill={item.color} isAnimationActive={false} />)}
          {derived.rate != null && <Line yAxisId="cost" type="monotone" dataKey="cost" name={costLabel} stroke="#ca8a04" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "#ca8a04", stroke: "#fff", strokeWidth: 1 }} isAnimationActive={false} />}
          {periodAverage > 0 && <ReferenceLine yAxisId="usage" y={periodAverage} stroke="#db2777" strokeDasharray="5 4" />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
    {mode === "tag" && categories.length > 0 && <p className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-slate-500">{t("whatTheseMean")}{categories.map(category => <TypeHint key={category} category={category} examples={examplesFor(data, category)} place={data.projectName} />)}</p>}
  </section>;
}

function EnergyDistribution({ data, derived }: { data: AnalysisData; derived: Derived }) {
  const [space, setSpace] = useState("all");
  const [range, setRange] = useState<"period" | "day">("period");
  const [day, setDay] = useState(derived.days.at(-1)?.date ?? "");
  const [tag, setTag] = useState<AnalysisCategory | null>(null);
  const { locale } = useEnergyIqLocale();
  const t = useMessages(viewMessages);
  const spaceItem = derived.spaces.find(item => item.scope.id === space);
  const scope: ScopeData = spaceItem?.scope ?? data.current.project;
  const sourceDays = spaceItem?.days ?? derived.days;
  // Whole-period split uses the engine's category totals; a single day uses that day's type series.
  const totals = range === "period" && CATEGORY_ORDER.some(category => scope.typeTotals[category])
    ? CATEGORY_ORDER.filter(category => (scope.typeTotals[category] ?? 0) > 0).map(category => ({ category, kwh: scope.typeTotals[category]! }))
    : CATEGORY_ORDER.map(category => ({ category, kwh: sourceDays.filter(entry => range === "period" || entry.date === day).reduce((sum, entry) => sum + (entry.byCategory[category] ?? 0), 0) })).filter(item => item.kwh > 0);
  const all = totals.reduce((sum, item) => sum + item.kwh, 0);
  const ranked = tag ? data.circuits.filter(circuit => circuit.category === tag && (!spaceItem || circuit.location === scope.name)) : [];
  const rankMax = Math.max(1, ...ranked.map(item => item.kwh));
  const pickTag = (category: AnalysisCategory) => setTag(tag === category ? null : category);
  return <section className={`${PANEL} mt-4 p-4`}>
    <div className="mb-2"><Title className="text-xs font-semibold text-slate-900" guide={{ summary: t("ed.summary"), dataAcquisition: [t("ed.data1"), t("ed.data2")], chartGeneration: [t("ed.chart1")] }}>{t("ed.title")}</Title></div>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <div className={`${SUB} w-full min-w-[160px] max-w-[220px] p-2 sm:w-auto`}>
        <p className="mb-1.5 text-[10px] text-slate-500">{t("spaceFilter")}</p>
        <select aria-label={t("ed.spaceLabel")} value={space} onChange={event => { setSpace(event.target.value); setTag(null); }} className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-800"><option value="all">{t("allSpaces")}</option>{derived.spaces.map(item => <option key={item.scope.id} value={item.scope.id}>{item.scope.name}</option>)}</select>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <div className={`${SUB} inline-flex items-center gap-1 px-1 py-0.5`}>
          <span className="px-1 text-[10px] text-slate-500">{t("ed.range")}</span>
          <div className="inline-flex gap-0.5 text-[10px]" role="group" aria-label={t("ed.range")}>{([["period", t("ed.allDays", { count: derived.days.length })], ["day", t("singleDay")]] as const).map(([id, text]) => <button key={id} type="button" aria-pressed={range === id} onClick={() => setRange(id)} className={`whitespace-nowrap rounded px-2 py-0.5 ${range === id ? "bg-emerald-100 text-emerald-800" : "text-slate-500 hover:bg-slate-50 hover:text-slate-800"}`}>{text}</button>)}</div>
        </div>
        {range === "day" && <select aria-label={t("ed.day")} value={day} onChange={event => setDay(event.target.value)} className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-800">{derived.days.map(entry => <option key={entry.date} value={entry.date}>{dateWithDay(entry.date, locale)}</option>)}</select>}
      </div>
    </div>
    <div className="grid w-full items-start gap-5 md:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[280px_320px_minmax(260px,1fr)] xl:gap-8">
      <div className="mx-auto h-72 w-[280px]">
        {totals.length ? <ResponsiveContainer width="100%" height="100%"><PieChart>
          <Pie data={totals} dataKey="kwh" nameKey="category" innerRadius={64} outerRadius={112} paddingAngle={0} stroke="none" isAnimationActive={false} labelLine={false} label={SliceLabel}
            onClick={(_entry, index) => { const item = totals[index]; if (item) pickTag(item.category); }}>
            {totals.map(item => <Cell key={item.category} fill={CATEGORY_COLORS[item.category]} stroke="none" style={{ outline: "none", cursor: "pointer" }} />)}
          </Pie>
          {tag && <Pie data={totals} dataKey="kwh" innerRadius={64} outerRadius={118} paddingAngle={0} stroke="none" isAnimationActive={false} label={false} pointerEvents="none" legendType="none" tooltipType="none">
            {totals.map(item => <Cell key={item.category} fill={item.category === tag ? CATEGORY_COLORS[item.category] : "transparent"} stroke="none" />)}
          </Pie>}
          <text x="50%" y="42%" textAnchor="middle" dominantBaseline="middle" fill="#64748b" fontSize="12">{t("total")}</text>
          <text x="50%" y="52%" textAnchor="middle" dominantBaseline="middle" fill="#0f172a" fontSize="24" fontWeight={700}>{num(all)}</text>
          <text x="50%" y="60%" textAnchor="middle" dominantBaseline="middle" fill="#64748b" fontSize="11">kWh</text>
          <Tooltip {...TOOLTIP} formatter={(amount, _name, item) => [`${Number(amount).toFixed(1)} kWh (${(Number(amount) / all * 100).toFixed(1)}%)`, categoryLabel((item.payload as { category: AnalysisCategory }).category, locale)]} />
        </PieChart></ResponsiveContainer> : <div className="flex h-full items-center justify-center text-sm text-slate-600">{t("ed.noReadings")}</div>}
      </div>
      <div className="w-full min-w-0 space-y-1">{totals.map(item => <div key={item.category} className={`flex items-center gap-1 border-b border-slate-100 pr-2 hover:bg-slate-50 ${tag === item.category ? "bg-slate-50" : ""}`}>
        <button type="button" aria-pressed={tag === item.category} onClick={() => pickTag(item.category)} className="grid min-w-0 flex-1 grid-cols-[130px_auto] items-center gap-3 py-2 pl-2 text-left text-[12px]">
          <span className="flex items-center gap-2"><span className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ background: CATEGORY_COLORS[item.category] }} /><span className="text-slate-800">{categoryLabel(item.category, locale)}</span></span>
          <span className="text-slate-900">{num(item.kwh)} kWh ({(item.kwh / all * 100).toFixed(1)}%)</span>
        </button>
        <TypeHint category={item.category} examples={examplesFor(data, item.category)} place={data.projectName}><span className="sr-only">{categoryLabel(item.category, locale)}</span></TypeHint>
      </div>)}</div>
      <div className="rounded border border-slate-100 bg-slate-50 p-3 md:col-span-2 xl:col-span-1">
        <div className="mb-2 flex items-center justify-between"><p className="text-[11px] font-medium text-slate-800">{tag ? spaceItem ? t("ed.circuitsOfIn", { type: categoryLabel(tag, locale), space: scope.name }) : t("ed.circuitsOf", { type: categoryLabel(tag, locale) }) : t("ed.selectTag")}</p>{tag && <button type="button" onClick={() => setTag(null)} className="text-[10px] text-slate-500 hover:text-slate-900">{t("ed.clear")}</button>}</div>
        {!tag ? <div className="flex h-60 items-center justify-center rounded border border-dashed border-slate-100 text-sm text-slate-600">{t("ed.clickHint")}</div>
          : ranked.length ? <ol className="space-y-1.5">{ranked.slice(0, 10).map((circuit, index) => <li key={circuit.id} className="text-[11px] text-slate-700">
            <div className="flex justify-between gap-2"><span className="truncate">{index + 1}. {circuit.name}{circuit.location && !spaceItem ? ` · ${circuit.location}` : ""}</span><span className="shrink-0 text-slate-900">{num(circuit.kwh)} kWh</span></div>
            <div className="mt-0.5 h-1.5 rounded bg-slate-100"><div className="h-full rounded" style={{ width: `${circuit.kwh / rankMax * 100}%`, background: CATEGORY_COLORS[tag] }} /></div>
          </li>)}</ol>
            : <div className="flex h-60 items-center justify-center rounded border border-dashed border-slate-100 px-4 text-center text-sm text-slate-600">{spaceItem ? t("ed.noCircuitsIn", { space: scope.name }) : t("ed.noCircuits")}</div>}
      </div>
    </div>
  </section>;
}

/** Share printed on its own segment, mid-ring; slivers under 5% rely on the legend beside the donut. */
function SliceLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }: { cx?: number; cy?: number; midAngle?: number; innerRadius?: number; outerRadius?: number; percent?: number }) {
  if (cx == null || cy == null || midAngle == null || innerRadius == null || outerRadius == null || !percent || percent < 0.05) return null;
  const radius = (innerRadius + outerRadius) / 2, angle = -midAngle * Math.PI / 180;
  return <text x={cx + radius * Math.cos(angle)} y={cy + radius * Math.sin(angle)} textAnchor="middle" dominantBaseline="central" fill="#fff" fontSize={13} fontWeight={700} style={{ pointerEvents: "none" }}>{`${(percent * 100).toFixed(0)}%`}</text>;
}

function SummaryOfFindings({ data, derived }: { data: AnalysisData; derived: Derived }) {
  const { locale } = useEnergyIqLocale();
  const t = useMessages(viewMessages);
  const project = data.current.project, previous = data.previous?.project;
  const baseline = (type: AnalysisDayType) => { const value = derived.baselines.find(item => item.dayType === type)?.expectedKwh; return value == null ? t("sf.notEnoughDays") : t("unit.perDay", { value: num(value) }); };
  const avg = (type: AnalysisDayType) => { const value = derived.avgOf(type); return value == null ? "—" : t("unit.perDay", { value: num(value) }); };
  const spaces = [...data.current.spaces].sort((a, b) => (b.usageKwh ?? 0) - (a.usageKwh ?? 0));
  const typeTotals = CATEGORY_ORDER.filter(category => project.typeTotals[category]).map(category => ({ category, kwh: project.typeTotals[category]! }));
  const typeSum = typeTotals.reduce((sum, item) => sum + item.kwh, 0);
  // Where only some of the site is sub-metered, the types are shares of the whole site and the rest is its own part.
  const unmeteredKwh = typeSum > 0 && project.usageKwh != null && project.usageKwh - typeSum > Math.max(0.5, project.usageKwh * 0.02) ? project.usageKwh - typeSum : 0;
  const splitKwh = typeSum + unmeteredKwh;
  const highestDay = [...derived.complete].sort((a, b) => b.totalKwh - a.totalKwh)[0];
  const peak = topHours(project, 1)[0];
  const calDates = derived.calibration.map(day => day.date).sort();
  const w = derived.windows;
  const weekdayAvg = derived.avgOf("weekday"), weekendAvg = derived.avgOf("weekend");
  const count = (type: AnalysisDayType) => derived.anomalies.filter(item => item.dayType === type).length;
  const top = spaces[0], second = spaces[1];
  const share = (value: number | null) => value == null ? "—" : num(value * 100);
  const cards: Array<[string, string[]]> = [
    [t("sf.scope"), [
      t("sf.period", { from: project.dates[0] ?? "", to: project.dates.at(-1) ?? "", days: project.dates.length, kwh: kwh(project.usageKwh) }),
      previous ? t("sf.vsPrevious", { from: previous.dates[0] ?? "", to: previous.dates.at(-1) ?? "", change: pct(percentChange(project.usageKwh, previous.usageKwh)) ?? "—" }) : t("kh.noPrevious"),
      t("sf.calibrated", { from: calDates[0] ?? "", to: calDates.at(-1) ?? "", days: calDates.length, weekday: baseline("weekday"), weekend: baseline("weekend"), holiday: baseline("public_holiday") }),
    ]],
    [spaces.length ? t("sf.byLevel") : t("sf.byType"), [
      ...(top ? [second?.usageKwh
        ? t("sf.topSpaceVs", { name: top.name, kwh: kwh(top.usageKwh), pct: project.usageKwh ? num((top.usageKwh ?? 0) / project.usageKwh * 100) : "—", ratio: num((top.usageKwh ?? 0) / second.usageKwh, 2), second: second.name, secondKwh: kwh(second.usageKwh) })
        : t("sf.topSpace", { name: top.name, kwh: kwh(top.usageKwh), pct: project.usageKwh ? num((top.usageKwh ?? 0) / project.usageKwh * 100) : "—" })]
        : typeTotals.map(item => t("sf.typeLine", { label: categoryLabel(item.category, locale), kwh: kwh(item.kwh), pct: num(item.kwh / splitKwh * 100) }))),
      t("sf.averages", { weekday: avg("weekday"), weekend: avg("weekend"), holiday: avg("public_holiday") }),
    ]],
    [t("sf.mix"), [
      t("sf.tagSplit", { list: joinText([...typeTotals.map(item => `${categoryLabel(item.category, locale)} ${num(item.kwh / splitKwh * 100)}%`), ...(unmeteredKwh ? [`${t("sf.unmetered")} ${num(unmeteredKwh / splitKwh * 100)}%`] : [])], locale) || t("sf.notAvailable") }),
      ...(data.circuits[0] ? [data.circuits[0].location
        ? t("sf.highestCircuitAt", { name: data.circuits[0].name, location: data.circuits[0].location, kwh: kwh(data.circuits[0].kwh) })
        : t("sf.highestCircuit", { name: data.circuits[0].name, kwh: kwh(data.circuits[0].kwh) })] : []),
    ]],
    [t("sf.behaviour"), [
      t("sf.openHours", { hours: openingLabel(data.openingHours), kwh: kwh(w.open), pct: share(w.openShare) }),
      t("sf.afterHours", { kwh: kwh(w.night), pct: share(w.nightShare) }),
      ...(weekdayAvg && weekendAvg ? [t("sf.weekendShare", { pct: num(weekendAvg / weekdayAvg * 100, 0) })] : []),
      ...(derived.floor && derived.floor.latestKw - derived.floor.bestKw >= 0.5 ? [t("sf.overnight", { now: num(derived.floor.latestKw, 2), best: num(derived.floor.bestKw, 2), date: shortDate(derived.floor.bestTo, locale) })] : []),
    ]],
    [t("sf.peaks"), [
      ...(highestDay ? [derived.spaces.length > 1
        ? t("sf.highestDaySpaces", { date: highestDay.date, kwh: kwh(highestDay.totalKwh), spaces: derived.spaces.map(item => `${item.scope.name} ${num(item.days.find(entry => entry.date === highestDay.date)?.totalKwh ?? 0)} kWh`).join(" · ") })
        : t("sf.highestDay", { date: highestDay.date, kwh: kwh(highestDay.totalKwh) })] : []),
      ...(peak ? [t("sf.peakHour", { kwh: kwh(peak.kwh), date: peak.date, from: hh(peak.hour), to: hh(peak.hour + 1) })] : []),
    ]],
    [t("sf.flags"), derived.anomalies.length ? [
      t(count("public_holiday") ? "sf.flagCountHoliday" : "sf.flagCount", { count: derived.anomalies.length, pct: ANOMALY_THRESHOLD_PCT, weekday: count("weekday"), weekend: count("weekend"), holiday: count("public_holiday") }),
      ...derived.anomalies.slice(0, 5).map(item => t("sf.flagItem", { date: item.date, type: dayTypeWord(item.dayType, locale), kwh: kwh(item.totalKwh), expected: kwh(item.expectedKwh), pct: item.deltaPct.toFixed(2) })),
      ...(derived.anomalies.length > 5 ? [t("sf.flagMore", { count: derived.anomalies.length - 5 })] : []),
    ] : [t("sf.flagNone", { pct: ANOMALY_THRESHOLD_PCT })]],
  ];
  return <section className={`${PANEL} mt-4 p-4`}>
    <div className="mb-4 flex items-center justify-between gap-3">
      <Title guide={{ summary: t("sf.summary"), dataAcquisition: [t("sf.data1")], chartGeneration: [t("sf.chart1")] }}>{t("sf.title")}</Title>
      <Link href={`/energyiq/reports?${new URLSearchParams({ projectId: data.projectId, sessionId: "new" })}`} className="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-500">{t("sf.generate")}</Link>
    </div>
    <div className="grid gap-3 md:grid-cols-2">{cards.map(([title, lines]) => <article key={title} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</h4>
      <ul className="space-y-2">{lines.map(line => <li key={line} className="flex gap-2 text-sm leading-snug text-slate-700"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" aria-hidden /><span>{line}</span></li>)}</ul>
    </article>)}</div>
  </section>;
}

// ---------- Day profiles ----------
function DayProfiles({ data, derived }: { data: AnalysisData; derived: Derived }) {
  const [profile, setProfile] = useState<AnalysisDayType>("weekday");
  const [space, setSpace] = useState("all");
  const { locale } = useEnergyIqLocale();
  const t = useMessages(viewMessages);
  const spaceItem = derived.spaces.find(item => item.scope.id === space);
  const scope = spaceItem?.scope ?? data.current.project;
  const scopeDayList = spaceItem?.days ?? derived.days;
  const datesOf = (type: AnalysisDayType) => scopeDayList.filter(day => day.complete && day.dayType === type).map(day => day.date);
  const profileDates = datesOf(profile);
  const categories = CATEGORY_ORDER.filter(category => scope.types[category]);
  const stacked = (row: ReturnType<typeof hourlyProfile>[number]) => categories.length ? categories.reduce((sum, category) => sum + (row[category] ?? 0), 0) : row.total;
  const hourly = hourlyProfile(scope, profileDates);
  // Close the day at 24:00 with the midnight values, as in the reference chart.
  const rows = hourly.length ? [...hourly.map(row => ({ ...row, label: hh(row.hour) })), { ...hourly[0]!, label: "24:00" }] : [];
  const peakRow = profileDates.length ? [...hourly].sort((a, b) => stacked(b) - stacked(a))[0] : undefined;
  // Fixed y-axis across the three day types so switching profiles compares like with like.
  const rawMax = Math.max(0.1, ...DAY_TYPES.flatMap(type => hourlyProfile(scope, datesOf(type)).map(stacked)));
  const yMax = Math.ceil(rawMax * 10) / 10;
  const count = (type: AnalysisDayType) => derived.complete.filter(day => day.dayType === type).length;
  const holidays = derived.complete.filter(day => day.dayType === "public_holiday");
  const weekdayAvg = derived.avgOf("weekday"), weekendAvg = derived.avgOf("weekend"), holidayAvg = derived.avgOf("public_holiday");
  const weekendDelta = percentChange(weekendAvg, weekdayAvg);
  const kpi = (value: number | null) => value == null ? "—" : <>{num(value)}<span className="ml-1 text-xl">{t("unit.kwhPerDay")}</span></>;
  const seriesList = categories.length ? categories.map(category => ({ key: category as string, label: categoryLabel(category, locale), color: CATEGORY_COLORS[category] })) : [{ key: "total", label: t("total"), color: "#5B8BCF" }];
  const holidayDates = joinText(holidays.map(day => slash(day.date)), locale);
  return <div className={`${PANEL} p-4`}>
    <div className="mb-4 grid gap-3 md:grid-cols-3">
      <div className="rounded-lg border border-emerald-300 bg-slate-50 px-3 py-2"><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t("dp.weekdayAvg")}</p><p className="mt-1 text-3xl font-semibold text-slate-900">{kpi(weekdayAvg)}</p><p className="mt-1 text-[10px] text-slate-500">{t(count("weekday") === 1 ? "dp.weekdaySamples.one" : "dp.weekdaySamples.other", { count: count("weekday") })}</p></div>
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t("dp.weekendAvg")}</p><p className="mt-1 text-3xl font-semibold text-slate-900">{kpi(weekendAvg)}</p><p className={`mt-1 text-[10px] ${weekendDelta == null || weekendDelta <= 0 ? "text-emerald-700" : "text-amber-700"}`}>{weekendDelta == null ? t("dp.weekendSamples", { count: count("weekend") }) : t("dp.vsWeekday", { change: pct(weekendDelta) ?? "" })}</p></div>
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t("dp.holidayBaseline")}</p><p className="mt-1 text-3xl font-semibold text-emerald-700">{kpi(holidayAvg)}</p><p className="mt-1 text-[10px] text-slate-500">{holidays.length ? t(holidays.length === 1 ? "dp.holidaySamples.one" : "dp.holidaySamples.other", { count: holidays.length, dates: holidayDates }) : t("dp.noHoliday")}</p></div>
    </div>
    <Title className="mb-1 text-xs font-semibold text-slate-900" guide={{ summary: t("dp.summary"), dataAcquisition: [t("dp.data1"), t("dp.data2")], chartGeneration: [t("dp.chart1")] }}>{t("dp.title")}</Title>
    <p className="mb-3 text-[11px] text-slate-500">{t("dp.caption", { from: data.current.project.dates[0] ?? "", to: data.current.project.dates.at(-1) ?? "" })}</p>
    <div className="mb-3 space-y-3">
      <Toggle label={t("dp.usageProfile")} value={profile} onChange={setProfile} options={dayTypeOptions(locale)} />
      <div className={`${SUB} p-2`}><p className="mb-2 text-[11px] text-slate-500">{t("spaceFilter")}</p><select aria-label={t("dp.profileSpace")} value={space} onChange={event => setSpace(event.target.value)} className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-[11px] text-slate-800"><option value="all">{t("allSpaces")}</option>{derived.spaces.map(item => <option key={item.scope.id} value={item.scope.id}>{item.scope.name}</option>)}</select></div>
    </div>
    <div className="h-72 rounded-md border border-slate-100 bg-white p-2">
      <p className="mb-1 text-[10px] text-slate-500">{t("dp.stackNote", { max: yMax })}</p>
      {profileDates.length ? <ResponsiveContainer width="100%" height="92%"><AreaChart data={rows} margin={{ top: 6, right: 22, left: 0, bottom: 0 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="label" stroke="#64748b" tick={{ fontSize: 10 }} interval={1} padding={{ left: 4, right: 10 }} tickMargin={6} />
        <YAxis {...AXIS} domain={[0, yMax]} tickCount={7} allowDataOverflow />
        <Tooltip content={({ active, payload, label }) => {
          if (!active || !payload?.length) return null;
          const total = payload.reduce((sum, item) => sum + Number(item.value ?? 0), 0);
          return <div className="rounded-lg border border-slate-200 bg-white/95 shadow-lg px-3 py-2 text-sm text-slate-800">
            <p className="mb-1.5 text-sm font-semibold text-slate-900">{t("dp.time", { label: String(label) })}</p>
            <div className="space-y-1">{[...payload].reverse().map(item => <div key={String(item.dataKey)} className="flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: item.color }} />{t("dp.row", { name: String(item.name), kwh: Number(item.value ?? 0).toFixed(2) })}</div>)}
              <div className="mt-1 border-t border-slate-200 pt-1 font-semibold text-slate-900">{t("dp.total", { kwh: total.toFixed(2) })}</div></div>
          </div>;
        }} />
        <Legend itemSorter={null} wrapperStyle={{ fontSize: 11, color: "#475569" }} />
        {seriesList.map(item => <Area key={item.key} type="monotone" dataKey={item.key} name={item.label} stackId="usage" stroke={item.color} fill={item.color} fillOpacity={0.35} strokeWidth={1.2} isAnimationActive={false} />)}
      </AreaChart></ResponsiveContainer> : <div className="flex h-[90%] items-center justify-center text-sm text-slate-600">{t("dp.noDays", { type: dayTypeWord(profile, locale) })}</div>}
    </div>
    {categories.length > 0 && <p className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-slate-500">{t("whatTheseMean")}{categories.map(category => <TypeHint key={category} category={category} examples={examplesFor(data, category)} place={data.projectName} />)}</p>}
    <div className="mt-2 grid gap-2 text-[11px] text-slate-700 md:grid-cols-3">
      <div className="rounded border border-slate-100 bg-slate-50 px-2 py-1">{t("dp.profile", { label: dayTypeLabel(profile, locale), count: profileDates.length, type: dayTypeWord(profile, locale) })}</div>
      <div className="rounded border border-slate-100 bg-slate-50 px-2 py-1">{t("dp.scope", { name: spaceItem ? scope.name : t("allSpaces") })}</div>
      <div className="rounded border border-slate-100 bg-slate-50 px-2 py-1">{peakRow ? t("dp.estDailyPeak", { kwh: num(hourly.reduce((sum, row) => sum + stacked(row), 0)), hour: hh(peakRow.hour), peak: num(stacked(peakRow)) }) : t("dp.estDaily", { kwh: num(hourly.reduce((sum, row) => sum + stacked(row), 0)) })}</div>
    </div>
    <p className="mt-2 text-[11px] text-slate-500">{weekdayAvg && holidayAvg ? t(weekdayAvg > holidayAvg ? "dp.weekdayAbove" : "dp.weekdayBelow", { pct: num(Math.abs(percentChange(weekdayAvg, holidayAvg)!)) }) : ""}{t("dp.groups")}{holidays.length ? t("dp.holidays", { dates: holidayDates }) : ""}</p>
    {derived.spaces.length > 0 && <LevelPattern derived={derived} />}
  </div>;
}

function LevelPattern({ derived }: { derived: Derived }) {
  const [dayType, setDayType] = useState<AnalysisDayType>("weekday");
  const [level, setLevel] = useState<string | null>(null);
  const [hover, setHover] = useState<{ name: string; hour: number; value: number; x: number; y: number } | null>(null);
  const { locale } = useEnergyIqLocale();
  const t = useMessages(viewMessages);
  const datesFor = (item: Derived["spaces"][number], type: AnalysisDayType) => item.days.filter(day => day.complete && day.dayType === type).map(day => day.date);
  const rows = derived.spaces.map(item => {
    const dates = datesFor(item, dayType);
    const total = item.days.filter(day => day.dayType === dayType).reduce((sum, day) => sum + day.totalKwh, 0);
    const peak = dates.length ? [...hourlyProfile(item.scope, dates)].sort((a, b) => b.total - a.total)[0] : undefined;
    const daily = average(dates.map(date => item.days.find(day => day.date === date)!.totalKwh));
    return { item, total, daily, peak, dates };
  });
  const sum = rows.reduce((acc, row) => acc + row.total, 0);
  const selected = rows.find(row => row.item.scope.id === level);
  const heat = selected ? meterHeatmap(selected.item.scope, selected.dates) : [];
  // One colour scale across weekday, weekend and holiday so switching day type compares like with like.
  const scale = useMemo(() => {
    if (!selected) return { min: 0, max: 0 };
    const values = DAY_TYPES.flatMap(type => meterHeatmap(selected.item.scope, datesFor(selected.item, type)).flatMap(row => row.hours));
    return values.length ? { min: Math.min(...values), max: Math.max(...values) } : { min: 0, max: 0 };
  }, [selected]);
  const samples = rows[0]?.dates.length ?? 0;
  return <section className="mt-4 rounded-md border border-slate-100 bg-white p-3">
    <Title className="mb-2 text-xs font-semibold text-slate-900" guide={{ summary: t("lp.summary"), dataAcquisition: [t("lp.data1"), t("lp.data2")], chartGeneration: [t("lp.chart1")] }}>{t("lp.title")}</Title>
    <p className="mb-2 text-[11px] text-slate-500">{t(samples === 1 ? "lp.caption.one" : "lp.caption.other", { count: samples, type: dayTypeWord(dayType, locale) })}</p>
    <div className="mb-3 inline-flex rounded border border-slate-200 bg-white p-1" role="group" aria-label={t("lp.dayType")}>{dayTypeOptions(locale).map(([id, text]) => <button key={id} type="button" aria-pressed={dayType === id} onClick={() => setDayType(id)} className={`rounded px-2 py-1 text-[10px] ${dayType === id ? "bg-blue-600 text-white" : "text-slate-700 hover:text-slate-900"}`}>{text}</button>)}</div>
    <div className="grid gap-3 xl:grid-cols-[minmax(360px,1fr)_minmax(420px,1.35fr)]">
      <div className="flex min-h-[400px] flex-col rounded-lg border border-slate-200">
        <div className="border-b border-slate-200 bg-white px-3 py-2 text-[11px] font-medium text-slate-700">{t("lp.breakdown")}</div>
        <div className="min-h-0 shrink-0 overflow-x-auto"><table className="w-full min-w-[380px] table-fixed text-[11px]">
          <colgroup><col className="w-[26%]" /><col className="w-[15%]" /><col className="w-[16%]" /><col className="w-[28%]" /><col className="w-[15%]" /></colgroup>
          <thead className="bg-slate-100 text-slate-700"><tr>{[t("lp.colLevel"), t("lp.colTotal"), t("lp.colDaily"), t("lp.colPeak"), t("lp.colShare")].map(text => <th key={text} className="px-2 py-1.5 text-left align-bottom font-medium">{text}</th>)}</tr></thead>
          <tbody>{rows.map(row => { const id = row.item.scope.id; return <tr key={id} tabIndex={0} aria-selected={level === id} onClick={() => setLevel(id)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setLevel(id); } }} className={`cursor-pointer border-t border-slate-200 ${level === id ? "bg-blue-50 text-blue-800" : "text-slate-800 hover:bg-slate-50"}`}>
            <td className="break-words px-2 py-1.5">{row.item.scope.name}</td><td className="whitespace-nowrap px-2 py-1.5">{num(row.total)}</td><td className="whitespace-nowrap px-2 py-1.5">{row.daily == null ? "—" : num(row.daily)}</td>
            <td className="px-2 py-1.5">{row.peak ? `${hh(row.peak.hour)} (${row.peak.total.toFixed(2)} kWh/h)` : "—"}</td><td className="whitespace-nowrap px-2 py-1.5">{sum > 0 ? (row.total / sum * 100).toFixed(1) : "—"}</td>
          </tr>; })}</tbody>
        </table></div>
        <div className="min-h-[240px] flex-1 border-t border-slate-200">
          <div className="border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-[10px] text-slate-500">{selected ? t("lp.subMeters", { name: selected.item.scope.name, count: heat.length }) : t("lp.subMeterDetails")}</div>
          {!selected ? <p className="px-3 py-4 text-[11px] text-slate-500">{t("lp.selectLevel")}</p>
            : heat.length ? <table className="w-full text-[10px]"><thead className="bg-white text-slate-500"><tr><th className="px-2 py-1.5 text-left">{t("lp.colDevice")}</th><th className="px-2 py-1.5 text-left">{t("lp.colTag")}</th><th className="whitespace-nowrap px-2 py-1.5 text-left">{t("lp.colDaily")}</th><th className="whitespace-nowrap px-2 py-1.5 text-left">{t("lp.colPeak")}</th></tr></thead>
              <tbody>{heat.map(row => { const peakHour = row.hours.indexOf(Math.max(...row.hours)); return <tr key={row.id} className="border-t border-slate-100 text-slate-700">
                <td className="max-w-[160px] truncate px-2 py-1.5" title={row.name}>{row.name}</td><td className="px-2 py-1.5">{row.category === "overall" ? t("type.total") : <TypeHint category={row.category} />}</td>
                <td className="whitespace-nowrap px-2 py-1.5">{row.hours.reduce((acc, value) => acc + value, 0).toFixed(1)}</td><td className="whitespace-nowrap px-2 py-1.5">{hh(peakHour)} ({row.hours[peakHour]!.toFixed(2)} kWh/h)</td>
              </tr>; })}</tbody></table>
              : <p className="px-3 py-4 text-[11px] text-slate-500">{t("lp.noCircuits")}</p>}
        </div>
      </div>
      <div className="relative flex min-h-[400px] flex-col rounded-lg border border-slate-200 bg-slate-50 p-2.5">
        <div className="mb-2 flex shrink-0 items-center justify-between gap-2"><p className="text-[11px] font-medium text-slate-700">{t("lp.heatmap")}</p>{selected && <p className="text-[10px] text-slate-500">{rich(t("lp.selected"), { name: <span className="text-slate-700">{selected.item.scope.name}</span> })}</p>}</div>
        <div className="flex min-h-0 flex-1 flex-col justify-center pt-3">
          {selected && heat.length ? <div className="flex flex-col gap-2">
            <div className="overflow-hidden rounded-md border border-slate-100 bg-slate-50 p-1.5">
              <div className="grid w-full gap-px" style={{ gridTemplateColumns: "minmax(52px, 16%) repeat(24, minmax(0, 1fr))" }}>
                <div className="truncate bg-slate-50 text-[9px] text-slate-500">{t("lp.colDevice")}</div>
                {Array.from({ length: 24 }, (_, hour) => <div key={hour} className="text-center text-[8px] leading-none text-slate-500">{hour % 2 === 0 ? String(hour).padStart(2, "0") : ""}</div>)}
                {heat.map(row => <div key={row.id} className="contents">
                  <div className="truncate bg-slate-50 pr-0.5 text-[9px] text-slate-700" title={row.name}>{row.name}</div>
                  {row.hours.map((value, hour) => <div key={hour} role="img" aria-label={`${row.name} ${hh(hour)} ${value.toFixed(2)} kWh/h`} className="h-6 w-full min-w-0 rounded-sm border border-white transition hover:brightness-110" style={{ backgroundColor: heatColor(value, scale.min, scale.max) }}
                    onMouseMove={event => setHover({ name: row.name, hour, value, x: event.clientX, y: event.clientY })} onMouseLeave={() => setHover(null)} />)}
                </div>)}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-500"><span>{t("lp.low")}</span><div className="h-2 w-28 rounded-full" style={{ background: `linear-gradient(90deg, ${HEAT_STOPS.map(([at, [r, g, bl]]) => `rgb(${r}, ${g}, ${bl}) ${at * 100}%`).join(", ")})` }} /><span>{t("lp.high")}</span><span className="text-slate-500">{t("lp.scale", { min: scale.min.toFixed(2), max: scale.max.toFixed(2) })}</span></div>
          </div> : <div className="flex items-center justify-center rounded-md border border-dashed border-slate-200 px-4 py-16 text-sm text-slate-600">{selected ? t("lp.noCircuitsType") : t("lp.selectFromTable")}</div>}
        </div>
        {hover && <div className="pointer-events-none fixed z-[90] min-w-[180px] rounded-md border border-slate-200 bg-white shadow-lg px-3 py-2 text-[11px] text-slate-900" style={{ left: hover.x + 12, top: hover.y + 12 }}>
          <p className="font-semibold text-slate-900">{hover.name}</p><p className="mt-1 text-slate-700">{t("lp.hour", { hour: hh(hover.hour) })}</p><p className="text-slate-700">{t("lp.avg", { kwh: hover.value.toFixed(2) })}</p>
        </div>}
      </div>
    </div>
  </section>;
}

// ---------- Behaviour, circuits, recommendations ----------
function HealthSummary({ data, derived }: { data: AnalysisData; derived: Derived }) {
  const t = useMessages(viewMessages);
  const w = derived.windows;
  const avg = (type: AnalysisDayType, empty = "—") => { const value = derived.avgOf(type); return value == null ? empty : t("unit.perDay", { value: num(value) }); };
  const items: Array<[string, string]> = [
    [t("hs.weekday"), avg("weekday")],
    [t("hs.weekend"), avg("weekend")],
    [t("hs.holiday"), avg("public_holiday", t("hs.noHoliday"))],
    [t("hs.openHours", { hours: openingLabel(data.openingHours) }), `${kwh(w.open)}${w.openShare == null ? "" : ` (${num(w.openShare * 100)}%)`}`],
    [t("hs.afterHours"), `${kwh(w.night)}${w.nightShare == null ? "" : ` (${num(w.nightShare * 100)}%)`}`],
    ...data.current.spaces.map(space => [t("hs.spaceTotal", { name: space.name }), kwh(space.usageKwh)] as [string, string]),
    ...(derived.floor ? [[t("hs.overnight"), t("hs.overnightValue", { now: num(derived.floor.latestKw, 2), best: num(derived.floor.bestKw, 2) })] as [string, string]] : []),
  ];
  return <section className={`${PANEL} p-4`}>
    <Title className="mb-3 text-sm font-semibold text-slate-900" guide={{ summary: t("hs.summary"), dataAcquisition: [t("hs.data1"), t("hs.data2")], chartGeneration: [t("hs.chart1")] }}>{t("hs.title")}</Title>
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{items.map(([label, value]) => <div key={label} className="rounded-md border border-slate-200 bg-white p-3"><p className="text-sm text-slate-600">{label}</p><p className="mt-1 text-sm font-semibold text-slate-900">{value}</p></div>)}</div>
  </section>;
}

function CircuitRanking({ data }: { data: AnalysisData }) {
  const t = useMessages(viewMessages);
  const top = data.circuits.slice(0, 10);
  const avgTop = average(top.map(item => item.kwh)) ?? 0;
  return <section className={`${PANEL} p-4`}>
    <Title className="mb-3 text-sm font-semibold text-slate-900" guide={{ summary: t("cr.summary"), dataAcquisition: [t("cr.data1"), t("cr.data2")], chartGeneration: [t("cr.chart1")] }}>{t("cr.title")}</Title>
    {top.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm">
      <thead className="bg-slate-100 text-slate-700"><tr><th className="px-3 py-2 text-left">{t("cr.rank")}</th><th className="px-3 py-2 text-left">{t("col.circuit")}</th><th className="px-3 py-2 text-left">{t("cr.floor")}</th><th className="px-3 py-2 text-left">{t("cr.category")}</th><th className="px-3 py-2 text-right">{t("cr.consumption")}</th><th className="px-3 py-2 text-right">{t("cr.vsAvg")}</th></tr></thead>
      <tbody>{top.map((circuit, index) => { const delta = avgTop > 0 ? Math.round((circuit.kwh / avgTop - 1) * 100) : 0; return <tr key={circuit.id} className="border-t border-slate-200">
        <td className="px-3 py-2 text-slate-900">{index + 1}</td><td className="px-3 py-2 text-slate-900">{circuit.name}</td><td className="px-3 py-2 text-slate-700">{circuit.location || "—"}</td>
        <td className="px-3 py-2 text-slate-700">{circuit.category === "overall" ? t("type.total") : <TypeHint category={circuit.category} />}</td><td className="px-3 py-2 text-right text-slate-800">{kwh(circuit.kwh)}</td>
        <td className={`px-3 py-2 text-right ${delta > 0 ? "text-amber-700" : "text-emerald-700"}`}>{delta > 0 ? "+" : ""}{delta}%</td>
      </tr>; })}</tbody>
    </table></div> : <p className="text-sm text-slate-600">{t("cr.none")}</p>}
  </section>;
}
