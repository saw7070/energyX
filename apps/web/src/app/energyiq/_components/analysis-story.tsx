"use client";
import Link from "next/link";
import React, { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  CATEGORY_COLORS, CATEGORY_ORDER, TIME_BUCKETS, dateWithDayYear, TIME_BUCKET_COLORS, aboveBenchmarkWhenClosed, alwaysOnKw, closedUseBreakdown,
  effectiveHours, openingLabel, percentChange, savingsPlan, shortDate, statusFor, storyProfile, timeBuckets,
  type AnalysisAnomaly, type AnalysisDay, type HealthStatus, type overnightFloor,
} from "./analysis-model";
import type { AnalysisData } from "./analysis-data";
import { analysisMessages, categoryLabel, confidenceLabel, effortLabel, holidayName, joinText, rich, timeBucketLabel } from "./analysis-messages";
import { storyMessages } from "./analysis-story-messages";
import { forecastMessages } from "./forecast-messages";
import { forecastNextMonth, localDate, type Forecast } from "./forecast-model";
import { configApi, type EnergyOperationalPolicyConfigurationDto } from "../../../lib/config-api";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { intlLocale } from "./energyiq-messages";
import type { EnergyIqLocale, Translate } from "./energyiq-messages";
import { EnergyIcon, type EnergyIconName } from "./icons";
import { DayPicker } from "./day-picker";
import { dayKindLabel, type DayKind as CalendarDayKind } from "./day-context";
import { TypeHint } from "./type-hint";

// The forecast's three colours: what really happened (green), next month's working days (blue) and its closed
// days (pale blue, striped like the after-hours band in step 2), so past, working and closed never look alike.
const FORECAST_USED = "#176b59", FORECAST_OPEN = "#2a78d6", FORECAST_CLOSED = "#cfe3fa", FORECAST_CLOSED_LINE = "#7aa9e0";
const FORECAST_CLOSED_CSS = `repeating-linear-gradient(45deg, ${FORECAST_CLOSED} 0 4px, ${FORECAST_CLOSED_LINE} 4px 6px)`;
// Always-on is a solid mid grey; closed hours are a pale striped band, so the two never read as the same thing.
const ALWAYS_ON_COLOR = "#8f8a84";
const num = (value: number, digits = 1) => value.toLocaleString("en-SG", { maximumFractionDigits: digits });
const hh = (hour: number) => `${String(hour).padStart(2, "0")}:00`;
const STATUS: Record<HealthStatus, { icon: EnergyIconName; chip: string; ring: string }> = {
  good: { icon: "check", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200", ring: "border-emerald-200" },
  watch: { icon: "info", chip: "bg-amber-50 text-amber-800 ring-amber-200", ring: "border-amber-200" },
  act: { icon: "alert", chip: "bg-rose-50 text-rose-700 ring-rose-200", ring: "border-rose-200" },
};
type StoryText = Translate<keyof typeof storyMessages.en>;

type StoryInput = { data: AnalysisData; days: AnalysisDay[]; anomalies: AnalysisAnomaly[]; floor: ReturnType<typeof overnightFloor>; rate: number | null };
type Story = ReturnType<typeof buildStory>;

/** Every number the decision summary shows, from the same readings as the detailed analysis below it. */
function buildStory({ data, days, anomalies, floor, rate }: StoryInput, locale: EnergyIqLocale = "en") {
  const project = data.current.project;
  const currency = project.cost?.currency ?? null;
  const hours = data.openingHours;
  const split = timeBuckets(project, days, hours);
  const closedHoursPerYear = split.closedShareOfHours * 8760;
  const alwaysOn = alwaysOnKw(project);
  const benchmark = floor?.bestKw ?? alwaysOn;
  const aboveBenchmark = benchmark != null ? aboveBenchmarkWhenClosed(project, days, hours, benchmark) : null;
  const closedUse = closedUseBreakdown(project, data.current.spaces, data.holidays, hours, locale);
  const plan = savingsPlan({ projectName: data.projectName, closedUse, closedHoursPerYear, rate, currency, aboveBenchmarkKwh: aboveBenchmark, benchmarkKw: benchmark, periodDays: days.length, anomalies, actions: data.actions }, locale);
  const counted = plan.filter(item => item.counted);
  const periodCost = project.cost?.amount ?? null;
  const share = (kwh: number) => split.total > 0 ? kwh / split.total : 0;
  return {
    project, currency, rate, hours, split, closedHoursPerYear, alwaysOn, benchmark, closedUse, plan, days,
    periodCost, closedShare: share(split.closedKwh), closedCost: periodCost != null ? periodCost * share(split.closedKwh) : null,
    yearlyCost: periodCost != null && days.length ? periodCost * 365 / days.length : null,
    alwaysOnYearlyCost: alwaysOn != null && rate != null ? alwaysOn * 8760 * rate : null,
    savingKwh: counted.reduce((sum, item) => sum + (item.annualKwh ?? 0), 0), savingCost: rate != null ? counted.reduce((sum, item) => sum + (item.annualCost ?? 0), 0) : null,
    provenKwh: counted.some(item => item.provenKwh != null) ? counted.reduce((sum, item) => sum + (item.provenKwh ?? 0), 0) : null,
    provenCost: rate != null && counted.some(item => item.provenCost != null) ? counted.reduce((sum, item) => sum + (item.provenCost ?? 0), 0) : null,
    change: percentChange(project.usageKwh, data.previous?.project.usageKwh),
    usingDefaultHours: effectiveHours(hours) !== hours,
  };
}

export function DecisionSummary(props: StoryInput) {
  const { data: storyData, days, anomalies, floor, rate } = props;
  const { locale } = useEnergyIqLocale();
  const t = useMessages(storyMessages);
  const story = useMemo(() => buildStory({ data: storyData, days, anomalies, floor, rate }, locale), [storyData, days, anomalies, floor, rate, locale]);
  const { data } = props;
  const money = (amount: number | null) => amount == null || !story.currency ? "—" : `${story.currency} ${Math.round(amount).toLocaleString("en-SG")}`;
  const first = story.plan.find(item => item.counted);
  // Health check can send the reader to one day, hour by hour, in step 2.
  const [inspectDay, setInspectDay] = useState<{ date: string; at: number } | null>(null);
  // Scroll only the page area; scrollIntoView would also shift the fixed app shell around it.
  const jump = (id: string) => {
    const target = document.getElementById(id);
    const scroller = target?.closest("main");
    if (!target || !scroller) return target?.scrollIntoView({ behavior: "smooth", block: "start" });
    scroller.scrollTo({ top: scroller.scrollTop + target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 16, behavior: "smooth" });
  };
  const dates = story.project.dates;
  return <div className="space-y-8">
    <section aria-labelledby="story-title" className="overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-white to-emerald-50/60 shadow-sm">
      <div className="px-6 pt-6">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">{t("summary.eyebrow")}</p>
        <h2 id="story-title" className="mt-1 max-w-4xl text-xl font-semibold leading-snug text-slate-900 sm:text-2xl">
          {story.periodCost != null
            ? rich(t("summary.headlineCost", { days: dates.length }), { name: data.projectName, cost: <Strong>{money(story.periodCost)}</Strong>, closed: <Strong tone="amber">{money(story.closedCost)} ({num(story.closedShare * 100, 0)}%)</Strong> })
            : rich(t("summary.headlineKwh", { days: dates.length }), { name: data.projectName, kwh: <Strong>{num(story.split.total, 0)} kWh</Strong>, share: <Strong tone="amber">{num(story.closedShare * 100, 0)}%</Strong> })}
        </h2>
      </div>
      <div className="mt-5 grid gap-px border-y border-slate-200 bg-slate-200/70 md:grid-cols-3">
        <Step index={1} label={t(story.periodCost != null ? "step.spent" : "step.used", { days: dates.length })} value={story.periodCost != null ? money(story.periodCost) : `${num(story.split.total, 0)} kWh`}
          note={<>{story.periodCost != null ? `${num(story.project.usageKwh ?? story.split.total, 0)} kWh · ` : null}{shortDate(dates[0]!, locale)} – {shortDate(dates.at(-1)!, locale)}{story.change != null && <> · <span className={story.change > 0 ? "text-amber-700" : "text-emerald-700"}>{t("step.change", { change: `${story.change > 0 ? "+" : ""}${num(story.change)}`, days: dates.length })}</span></>}</>} />
        <Step index={2} label={t("step.after")} tone="amber" value={story.periodCost != null ? money(story.closedCost) : `${num(story.split.closedKwh, 0)} kWh`}
          note={<>{t(story.periodCost != null ? "step.afterNote" : "step.afterNoteEnergy", { pct: num(story.closedShare * 100, 0) })}{story.alwaysOn != null ? t("step.neverBelow", { kw: num(story.alwaysOn, 1) }) : null}</>} />
        <Step index={3} label={t("step.save")} tone="emerald" value={savingRange(story, money, t)}
          note={story.savingKwh ? <>{story.provenKwh != null && meaningfulLow(story.provenKwh, story.savingKwh)
            ? t("step.saveRange", { low: story.provenCost != null ? money(story.provenCost) : `${num(story.provenKwh, 0)} kWh`, high: story.savingCost != null ? money(story.savingCost) : `${num(story.savingKwh, 0)} kWh` })
            : t("step.saveSwitchOff")}{story.yearlyCost && story.savingCost != null ? t("step.saveShare", { pct: num(story.savingCost / story.yearlyCost * 100, 0), yearly: money(story.yearlyCost) }) : null}{t("step.end")}</> : t("step.none")} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
        <p className="max-w-3xl text-sm text-slate-600">{first ? rich(first.annualCost != null ? t("start.item", { range: itemRange(first, money, t) }) : t("start.itemNoCost"), { title: <span className="font-medium text-slate-900">{first.title}</span> }) : t("start.none")}{story.alwaysOnYearlyCost != null ? t("start.alwaysOn", { cost: money(story.alwaysOnYearlyCost) }) : null}</p>
        <button type="button" onClick={() => jump("story-plan")} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-slate-700">{t("start.cta")}<EnergyIcon name="arrow" className="h-4 w-4" /></button>
      </div>
      {story.periodCost == null ? <p className="border-t border-slate-200 bg-amber-50/60 px-6 py-3 text-sm text-amber-900">
        {t("rate.missing")}{" "}
        <Link href={`/energyiq/project-configuration?${new URLSearchParams({ projectId: data.projectId, tab: "tariff" })}`} className="font-medium underline">{t("rate.add")}</Link>
      </p> : null}
    </section>

    <nav aria-label={t("nav.label")} className="flex flex-wrap gap-2 text-xs">
      {([["story-money", story.periodCost != null ? "nav.money" : "nav.energy"], ["story-when", "nav.when"], ["story-on", "nav.on"], ["story-health", "nav.health"], ["story-plan", "nav.plan"], ["story-ahead", "nav.ahead"], ["details", "nav.details"]] as const).map(([id, label]) => <button key={id} type="button" onClick={() => jump(id)} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-slate-600 hover:border-slate-300 hover:text-slate-900">{t(label)}</button>)}
    </nav>

    <MoneySection story={story} data={data} money={money} />
    <WhenSection story={story} money={money} inspect={inspectDay} />
    <StaysOnSection story={story} money={money} />
    <HealthSection story={story} data={data} anomalies={props.anomalies} floor={props.floor} onJump={jump} onInspectDay={date => { setInspectDay({ date, at: Date.now() }); jump("story-when"); }} />
    <PlanSection story={story} data={data} money={money} />
    <AheadSection story={story} data={data} />
  </div>;
}

/** Show a lower figure only when it says something: between 10% and 95% of the higher one. */
const meaningfulLow = (low: number, high: number) => low >= high * 0.1 && low < high * 0.95;

/** "Up to SGD 1,924", or "SGD 400 – 1,924" when the lower figure means something; `lower` starts "up to" mid-sentence. */
function savingRange(story: Story, money: (amount: number | null) => string, t: StoryText, lower = false) {
  if (!story.savingKwh) return "—";
  const upTo = (amount: string) => t(lower ? "range.upToLower" : "range.upTo", { amount });
  if (story.savingCost == null) return story.provenKwh != null && meaningfulLow(story.provenKwh, story.savingKwh) ? `${num(story.provenKwh, 0)}–${num(story.savingKwh, 0)} kWh` : upTo(`${num(story.savingKwh, 0)} kWh`);
  const low = story.provenCost;
  return low != null && meaningfulLow(low, story.savingCost) ? `${money(low)} – ${Math.round(story.savingCost).toLocaleString("en-SG")}` : upTo(money(story.savingCost));
}

function itemRange(item: Story["plan"][number], money: (amount: number | null) => string, t: StoryText, upTo = true) {
  if (item.annualCost == null) return "—";
  return item.provenCost != null && meaningfulLow(item.provenCost, item.annualCost) ? `${money(item.provenCost)} – ${Math.round(item.annualCost).toLocaleString("en-SG")}` : upTo ? t("range.upToLower", { amount: money(item.annualCost) }) : money(item.annualCost);
}

function Strong({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "amber" }) {
  return <span className={`font-semibold ${tone === "amber" ? "text-amber-700" : "text-slate-900"}`}>{children}</span>;
}
function Step({ index, label, value, note, tone = "slate" }: { index: number; label: string; value: string; note: ReactNode; tone?: "slate" | "amber" | "emerald" }) {
  const color = tone === "amber" ? "text-amber-700" : tone === "emerald" ? "text-emerald-700" : "text-slate-900";
  return <div className="relative bg-white/90 px-6 py-5">
    <p className="flex items-center gap-2 text-xs font-medium text-slate-500"><span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-700">{index}</span>{label}</p>
    <p className={`mt-2 text-3xl font-semibold tracking-tight ${color}`}>{value}</p>
    <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{note}</p>
  </div>;
}
/** A value written on a reference line, on a white pad so the bars behind it never make it unreadable. */
function BaselineTag({ viewBox, text, colour }: { viewBox?: { x?: number; y?: number }; text: string; colour: string }) {
  const x = (viewBox?.x ?? 0) + 8, y = (viewBox?.y ?? 0) - 7;
  return <g>
    <rect x={x - 5} y={y - 11} width={text.length * 6.1 + 12} height={15} rx={3} fill="#ffffff" fillOpacity={0.9} />
    <text x={x} y={y} fill={colour} fontSize={11} fontWeight={600}>{text}</text>
  </g>;
}
function StoryCard({ id, step, title, takeaway, children }: { id: string; step: number; title: string; takeaway: ReactNode; children: ReactNode }) {
  return <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
    <div className="mb-5 flex items-start gap-3">
      <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white">{step}</span>
      <div>
        <h2 id={`${id}-title`} className="text-lg font-semibold text-slate-900">{title}</h2>
        <p className="mt-1 max-w-4xl text-sm leading-relaxed text-slate-600">{takeaway}</p>
      </div>
    </div>
    {children}
  </section>;
}
function ShareBars({ title, rows, format }: { title: string; rows: Array<{ key: string; label: string; value: number; color: string; hint?: ReactNode }>; format: (value: number) => string }) {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const max = Math.max(0.001, ...rows.map(row => row.value));
  return <div>
    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
    <ul className="space-y-3">{rows.map(row => <li key={row.key}>
      <div className="flex items-baseline justify-between gap-3 text-sm"><span className="min-w-0 truncate text-slate-800" title={row.hint ? undefined : row.label}>{row.hint ?? row.label}</span><span className="shrink-0 tabular-nums"><span className="font-semibold text-slate-900">{format(row.value)}</span><span className="ml-2 text-sm text-slate-600">{total > 0 ? num(row.value / total * 100, 0) : 0}%</span></span></div>
      <div className="mt-1.5 h-2 rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${row.value / max * 100}%`, background: row.color }} /></div>
    </li>)}</ul>
  </div>;
}

function MoneySection({ story, data, money }: { story: Story; data: AnalysisData; money: (amount: number | null) => string }) {
  const t = useMessages(storyMessages);
  const { locale } = useEnergyIqLocale();
  const rate = story.rate;
  // Money when a rate is published, otherwise kWh.
  const value = (kwh: number) => rate != null ? kwh * rate : kwh;
  const format = (amount: number) => rate != null ? money(amount) : `${num(amount, 0)} kWh`;
  const spaceColors = ["#2a78d6", "#4a3aa7", "#1baf7a", "#eb6834", "#eda100", "#e87ba4", "#008300", "#e34948"];
  const spaces = [...data.current.spaces].filter(space => (space.usageKwh ?? 0) > 0).sort((a, b) => (b.usageKwh ?? 0) - (a.usageKwh ?? 0))
    .map((space, index) => ({ key: space.id, label: space.name, value: value(space.usageKwh ?? 0), color: spaceColors[index % spaceColors.length]! }));
  const types = CATEGORY_ORDER.filter(category => (story.project.typeTotals[category] ?? 0) > 0)
    .map(category => ({ key: category, label: categoryLabel(category, locale), value: value(story.project.typeTotals[category]!), color: CATEGORY_COLORS[category], hint: <TypeHint category={category} examples={data.circuits.filter(circuit => circuit.category === category).slice(0, 3).map(circuit => circuit.name)} place={data.projectName} /> })).sort((a, b) => b.value - a.value);
  const lead = spaces.length ? spaces : types;
  const all = lead.reduce((sum, row) => sum + row.value, 0);
  const takeaway = lead[0] ? rich(t(spaces.length && types[0] ? "money.takeawayType" : "money.takeaway", { pct: num(lead[0].value / Math.max(all, 0.001) * 100, 0), what: t(rate != null ? "money.bill" : "money.energy") }), {
    lead: <span className="font-medium text-slate-900">{lead[0].label}</span>, type: types[0] ? <span className="font-medium text-slate-900">{types[0].label.toLowerCase()}</span> : null,
  }) : t("money.none");
  return <StoryCard id="story-money" step={1} title={t(rate != null ? "money.title" : "money.titleEnergy")} takeaway={takeaway}>
    <div className={`grid gap-8 ${spaces.length && types.length ? "lg:grid-cols-2" : ""}`}>
      {spaces.length > 0 && <ShareBars title={t("money.byArea")} rows={spaces} format={format} />}
      {types.length > 0 && <ShareBars title={t("money.byType")} rows={types} format={format} />}
    </div>
  </StoryCard>;
}

function WhenSection({ story, money, inspect }: { story: Story; money: (amount: number | null) => string; inspect?: { date: string; at: number } | null }) {
  const t = useMessages(storyMessages);
  const { locale } = useEnergyIqLocale();
  const [dayType, setDayType] = useState<"weekday" | "weekend" | "day">("weekday");
  // Single-day view: any date in the period, defaulting to the latest day with complete readings.
  const [date, setDate] = useState(() => [...story.days].reverse().find(day => day.complete)?.date ?? story.days.at(-1)?.date ?? "");
  // Opening a day from the health check switches this step to that single day.
  useEffect(() => { if (inspect?.date) { setDayType("day"); setDate(inspect.date); } }, [inspect?.date, inspect?.at]);
  const dayIndex = story.days.findIndex(day => day.date === date);
  const pickedDay = story.days[dayIndex];
  const cost = (kwh: number) => story.periodCost != null && story.split.total > 0 ? story.periodCost * kwh / story.split.total : null;
  const chosen = dayType === "day" ? (pickedDay ? [pickedDay] : []) : story.days.filter(day => day.complete && day.dayType === dayType);
  const minimum = story.alwaysOn ?? 0;
  const profileFor = (type: "weekday" | "weekend") => storyProfile(story.project, story.days.filter(day => day.complete && day.dayType === type), story.hours, minimum);
  const rows = dayType === "day" ? storyProfile(story.project, chosen, story.hours, minimum) : profileFor(dayType);
  // One scale for weekday, weekend and the chosen day, so switching shows how much lower (or higher) each really is.
  const peak = Math.max(0.1, ...(["weekday", "weekend"] as const).flatMap(type => profileFor(type).map(row => row.total)), ...(dayType === "day" ? rows.map(row => row.total) : []));
  // About four round steps (1, 2, 2.5 or 5 × a power of ten) so the axis reads 0, 2, 4, 6, 8 rather than ending on an odd value.
  const rough = peak * 1.05 / 4, magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map(factor => factor * magnitude).find(value => value >= rough)!;
  const yMax = Math.ceil(peak * 1.05 / step) * step;
  const yTicks = Array.from({ length: Math.round(yMax / step) + 1 }, (_, index) => Number((index * step).toFixed(4)));
  // When every hour is outside working hours (weekends, holidays), say so once instead of striping the whole chart.
  const allClosed = rows.length > 0 && rows.every(row => row.closed);
  const closedPattern = `closed-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const closedRanges: Array<{ from: number; to: number }> = [];
  for (const row of rows) { const last = closedRanges.at(-1); if (!row.closed) continue; if (last && last.to === row.hour - 1) last.to = row.hour; else closedRanges.push({ from: row.hour, to: row.hour }); }
  const dayAvoidable = rows.reduce((sum, row) => sum + row.avoidable, 0), dayBase = rows.reduce((sum, row) => sum + row.base, 0), dayTotal = rows.reduce((sum, row) => sum + row.total, 0);
  const biggestClosed = TIME_BUCKETS.filter(bucket => bucket !== "open").sort((a, b) => story.split.kwh[b] - story.split.kwh[a])[0]!;
  const segments = TIME_BUCKETS.filter(bucket => story.split.kwh[bucket] > 0);
  const series = [
    { key: "base", label: t("when.alwaysOn"), color: ALWAYS_ON_COLOR },
    { key: "working", label: t("when.working"), color: TIME_BUCKET_COLORS.open },
    { key: "avoidable", label: t("when.leftOn"), color: "#eb6834" },
  ] as const;
  const noCompleteDays = t(dayType === "weekend" ? "when.noComplete.weekend" : "when.noComplete.weekday");
  const takeaway = rich(t(story.usingDefaultHours ? "when.takeawayAssumed" : "when.takeaway", { pct: num(story.closedShare * 100, 0) }), {
    hours: <span className="font-medium text-slate-900">{openingLabel(story.hours)}</span>,
    bucket: <span className="font-medium text-slate-900">{timeBucketLabel(biggestClosed, locale).toLowerCase()}</span>,
  });
  return <StoryCard id="story-when" step={2} title={t("when.title")} takeaway={takeaway}>
    <div className="mb-2 flex h-9 w-full overflow-hidden rounded-lg" role="img" aria-label={joinText(segments.map(bucket => `${timeBucketLabel(bucket, locale)} ${num(story.split.kwh[bucket] / story.split.total * 100, 0)}%`), locale)}>
      {segments.map(bucket => { const pct = story.split.kwh[bucket] / story.split.total * 100; return <div key={bucket} className="flex items-center justify-center border-r-2 border-white text-xs font-semibold text-white last:border-r-0" style={{ width: `${pct}%`, background: TIME_BUCKET_COLORS[bucket] }}>{pct >= 8 ? `${num(pct, 0)}%` : ""}</div>; })}
    </div>
    <ul className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{TIME_BUCKETS.map(bucket => <li key={bucket} className="rounded-lg border border-slate-200 px-3 py-2.5">
      <p className="flex items-center gap-2 text-sm text-slate-600"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: TIME_BUCKET_COLORS[bucket] }} />{timeBucketLabel(bucket, locale)}</p>
      <p className="mt-1 text-base font-semibold tabular-nums text-slate-900">{story.periodCost != null ? money(cost(story.split.kwh[bucket])) : `${num(story.split.kwh[bucket], 0)} kWh`}</p>
      <p className="text-sm tabular-nums text-slate-600">{story.periodCost != null ? `${num(story.split.kwh[bucket], 0)} kWh · ` : null}{story.split.total > 0 ? num(story.split.kwh[bucket] / story.split.total * 100, 0) : 0}%</p>
    </li>)}</ul>
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{dayType === "day" ? pickedDay ? t("when.dayHeading", { date: dateWithDayYear(pickedDay.date, locale) }) : t("when.oneDayHeading") : t(dayType === "weekend" ? "when.avgHeading.weekend" : "when.avgHeading.weekday")}</h3>
          <p className="mt-0.5 max-w-3xl text-sm text-slate-600">{chosen.length ? t(dayAvoidable < 0.05 ? "when.summary" : !allClosed ? "when.summaryLeftOn" : "when.summaryOnTop", {
            total: num(dayTotal, 0), when: t(dayType === "day" ? "when.thatDay" : "when.aDay"), base: num(dayBase, 0), kw: minimum ? `${num(minimum, 1)} kW` : "—", extra: num(dayAvoidable, 1),
          }) : dayType === "day" ? t("when.choose") : noCompleteDays}{dayType === "day" && pickedDay && !pickedDay.complete ? t("when.missing") : ""}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5" role="group" aria-label={t("when.dayGroup")}>{([["weekday", "when.weekdayAvg"], ["weekend", "when.weekendAvg"], ["day", "when.singleDay"]] as const).map(([id, text]) => <button key={id} type="button" aria-pressed={dayType === id} onClick={() => setDayType(id)} className={`rounded-md px-3 py-1 text-xs ${dayType === id ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"}`}>{t(text)}</button>)}</div>
          {dayType === "day" && <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white p-0.5 text-xs">
            <button type="button" aria-label={t("when.previousDay")} disabled={dayIndex <= 0} onClick={() => setDate(story.days[dayIndex - 1]!.date)} className="rounded-md px-2 py-1 text-slate-600 hover:bg-slate-100 disabled:opacity-40"><EnergyIcon name="chevron" className="h-3.5 w-3.5 rotate-180" /></button>
            <DayPicker days={story.days} value={date} onChange={setDate} />
            <button type="button" aria-label={t("when.nextDay")} disabled={dayIndex < 0 || dayIndex >= story.days.length - 1} onClick={() => setDate(story.days[dayIndex + 1]!.date)} className="rounded-md px-2 py-1 text-slate-600 hover:bg-slate-100 disabled:opacity-40"><EnergyIcon name="chevron" className="h-3.5 w-3.5" /></button>
          </div>}
        </div>
      </div>
      {allClosed && chosen.length > 0 && <p className="mb-2 inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800"><EnergyIcon name="clock" className="h-3.5 w-3.5" />{dayType === "day"
        ? t("when.closedDay", { reason: pickedDay?.dayType === "public_holiday" ? pickedDay.holidayName != null ? holidayName(pickedDay.holidayName, locale) : t("when.reasonHoliday") : t("when.reasonWeekend"), kwh: num(rows.reduce((sum, row) => sum + row.total, 0), 0) })
        : t(dayType === "weekend" ? "when.closedWeekends" : "when.closedTheseDays", { kwh: num(rows.reduce((sum, row) => sum + row.total, 0), 0) })}</p>}
      <div className="h-64">
        {chosen.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={rows} margin={{ top: 16, right: 8, left: 0, bottom: 0 }} barCategoryGap={2}>
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
          <defs><pattern id={closedPattern} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#f3f5f8" /><line x1="0" y1="0" x2="0" y2="6" stroke="#cfd7e2" strokeWidth="2" /></pattern></defs>
          {!allClosed && closedRanges.map(range => <ReferenceArea key={range.from} x1={range.from} x2={range.to} fill={`url(#${closedPattern})`} fillOpacity={1} strokeOpacity={0} label={{ value: t("when.afterHours"), position: "insideTop", fill: "#64748b", fontSize: 10 }} />)}
          <XAxis dataKey="hour" tickFormatter={hour => hh(Number(hour))} interval={2} tick={{ fontSize: 10, fill: "#64748b" }} axisLine={{ stroke: "#cbd5e1" }} tickLine={false} />
          <YAxis domain={[0, yMax]} ticks={yTicks} allowDataOverflow tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} width={36} tickFormatter={value => num(Number(value), 1)} label={{ value: "kWh", angle: -90, position: "insideLeft", fill: "#94a3b8", fontSize: 10 }} />
          <Tooltip cursor={{ fill: "rgba(15,23,42,0.04)" }} content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const row = payload[0]!.payload as (typeof rows)[number];
            return <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-lg">
              <p className="mb-1 font-semibold text-slate-900">{hh(Number(label))}–{hh(Number(label) + 1)} · {row.closed ? t("when.afterHoursLower") : t("when.workingLower")}</p>
              {series.filter(item => row[item.key] > 0.005).map(item => <p key={item.key} className="flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: item.color }} />{t("when.tooltipRow", { label: item.label, kwh: num(row[item.key], 2) })}</p>)}
              <p className="mt-1 border-t border-slate-100 pt-1 font-semibold text-slate-900">{t("when.tooltipTotal", { kwh: num(row.total, 2) })}</p>
            </div>;
          }} />
          {series.map((item, index) => <Bar key={item.key} dataKey={item.key} stackId="hour" fill={item.color} radius={index === series.length - 1 ? [3, 3, 0, 0] : 0} isAnimationActive={false} />)}
        </BarChart></ResponsiveContainer> : <div className="flex h-full items-center justify-center text-sm text-slate-600">{dayType === "day" ? t("when.noReadingsDay") : noCompleteDays}</div>}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-slate-600">{series.map(item => <span key={item.key} className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: item.color }} />{item.label}</span>)}{!allClosed && <span className="inline-flex items-center gap-1.5"><span className="energyiq-closed-swatch inline-block h-2.5 w-4 rounded-sm border border-slate-300" />{t("when.afterHours")}</span>}</div>
    </div>
  </StoryCard>;
}

function StaysOnSection({ story, money }: { story: Story; money: (amount: number | null) => string }) {
  const t = useMessages(storyMessages);
  const [all, setAll] = useState(false);
  const rows = all ? story.closedUse : story.closedUse.slice(0, 8);
  const yearly = (kw: number) => kw * story.closedHoursPerYear;
  const max = Math.max(0.001, ...story.closedUse.map(row => row.closedKw));
  const covered = story.closedUse.slice(0, 3).reduce((sum, row) => sum + row.closedKwh, 0);
  const lead = story.closedUse.find(row => row.kind !== "remainder");
  const closedTotal = story.closedUse.reduce((sum, row) => sum + row.closedKwh, 0);
  const note = (row: Story["closedUse"][number]) => row.kind === "remainder" ? { text: t("on.tagRest"), tone: "bg-slate-100 text-slate-600" }
    : row.essential ? { text: t("on.tagEssential"), tone: "bg-slate-100 text-slate-700" }
      : { text: t("on.tagSwitchable"), tone: "bg-amber-50 text-amber-800" };
  const takeaway = story.closedUse.length ? <>{t("on.takeaway", { pct: num(covered / Math.max(closedTotal, 0.001) * 100, 0) })}{lead ? rich(t("on.takeawayLead", { kw: num(lead.closedKw, 2) }), { name: <span className="font-medium text-slate-900">{lead.name}</span> }) : null}</> : t("on.noCircuits");
  return <StoryCard id="story-on" step={3} title={t("on.title")} takeaway={takeaway}>
    {story.closedUse.length ? <>
      <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm">
        <thead><tr className="border-b border-slate-200 text-left text-sm text-slate-600"><th className="py-2 pr-3 font-medium">{t("on.colName")}</th><th className="px-3 py-2 font-medium">{t("on.colArea")}</th><th className="px-3 py-2 font-medium">{t("on.colPower")}</th><th className="px-3 py-2 text-right font-medium">{t(story.rate != null ? "on.colCost" : "on.colEnergy")}</th><th className="px-3 py-2 text-right font-medium">{t("on.colShare")}</th><th className="py-2 pl-3 font-medium">{t("on.colMeaning")}</th></tr></thead>
        <tbody>{rows.map(row => { const tag = note(row); return <tr key={row.id} className="border-b border-slate-100 last:border-0">
          <td className="py-2.5 pr-3 font-medium text-slate-900">{row.name}</td>
          <td className="px-3 py-2.5 text-slate-600">{row.kind === "type" ? t("on.wholeSite") : row.space}</td>
          <td className="px-3 py-2.5"><div className="flex items-center gap-2"><div className="h-2 w-20 shrink-0 rounded-full bg-slate-100"><div className="h-full rounded-full bg-[#eb6834]" style={{ width: `${row.closedKw / max * 100}%` }} /></div><span className="whitespace-nowrap tabular-nums text-slate-700">{num(row.closedKw, 2)} kW</span></div></td>
          <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-900">{story.rate != null ? money(yearly(row.closedKw) * story.rate) : `${num(yearly(row.closedKw), 0)} kWh`}</td>
          <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">{row.totalKwh > 0 ? num(Math.min(100, row.closedKwh / row.totalKwh * 100), 0) : "—"}%</td>
          <td className="py-2.5 pl-3"><span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${tag.tone}`}>{tag.text}</span></td>
        </tr>; })}</tbody>
      </table></div>
      {story.closedUse.length > 8 && <button type="button" onClick={() => setAll(!all)} className="mt-3 text-xs font-medium text-blue-700 hover:text-blue-800">{all ? t("on.showFewer") : t("on.showAll", { count: story.closedUse.length })}</button>}
      <p className="mt-3 text-sm text-slate-600">{t("on.footnote", { hours: num(story.closedHoursPerYear, 0), rate: story.rate != null && story.currency ? ` × ${story.currency} ${story.rate.toFixed(2)}/kWh` : "" })}</p>
    </> : <p className="text-sm text-slate-500">{t("on.none")}</p>}
  </StoryCard>;
}

function HealthSection({ story, data, anomalies, floor, onJump, onInspectDay }: { story: Story; data: AnalysisData; anomalies: AnalysisAnomaly[]; floor: ReturnType<typeof overnightFloor>; onJump: (id: string) => void; onInspectDay: (date: string) => void }) {
  const t = useMessages(storyMessages);
  const shared = useMessages(analysisMessages);
  const { locale } = useEnergyIqLocale();
  const coverage = story.project.coverage;
  const gap = story.alwaysOn != null && floor ? (story.alwaysOn - floor.bestKw) / Math.max(floor.bestKw, 0.001) * 100 : null;
  type HealthAction = { label: string; onClick?: () => void; href?: string };
  const items: Array<{ title: string; status: HealthStatus; value: string; text: string; days?: string[]; actions?: HealthAction[] }> = [
    { title: t("health.unusual"), status: anomalies.length >= 3 ? "act" : anomalies.length ? "watch" : "good", value: `${anomalies.length}`,
      text: anomalies.length ? t("health.unusualSome", { days: joinText(anomalies.slice(0, 3).map(item => shortDate(item.date, locale)), locale) + (anomalies.length > 3 ? "…" : "") }) : t("health.unusualNone"),
      ...(anomalies.length ? { days: anomalies.slice(0, 4).map(item => item.date) } : {}) },
    { title: t("health.closedShare"), status: statusFor(story.closedShare * 100, 35, 50), value: `${num(story.closedShare * 100, 0)}%`,
      text: story.closedShare >= 0.35 ? t(story.rate != null ? "health.closedHigh" : "health.closedHighEnergy") : t("health.closedOk"), actions: [{ label: t("health.seeStaysOn"), onClick: () => onJump("story-on") }] },
    ...(gap != null ? [{ title: t("health.alwaysOn"), status: statusFor(gap, 10, 25), value: t("health.alwaysOnValue", { now: num(story.alwaysOn!, 2), best: num(floor!.bestKw, 2) }),
      text: gap >= 10 ? t("health.floorHigher", { kw: num(floor!.bestKw, 2), date: shortDate(floor!.bestTo, locale), pct: num(gap, 0) }) : gap < 1 ? t("health.floorAt") : t("health.floorWithin", { pct: num(gap, 0) }), actions: [{ label: t("health.seeStaysOn"), onClick: () => onJump("story-on") }] }] : []),
    ...(story.change != null ? [{ title: t("health.change", { days: story.days.length }), status: statusFor(story.change, 5, 15), value: `${story.change > 0 ? "+" : ""}${num(story.change)}%`,
      text: story.change >= 5 ? t("health.rising") : story.change <= -5 ? t("health.falling") : t("health.steady"), actions: [{ label: t("health.compareDays"), onClick: () => onJump("story-when") }] }] : []),
    ...(coverage != null ? [{ title: t("health.readings"), status: statusFor(100 - coverage, 5, 20), value: `${num(coverage, 1)}%`,
      text: coverage >= 95 ? t("health.readingsOk") : t("health.readingsMissing", { pct: num(100 - coverage, 0) }),
      ...(coverage >= 95 ? {} : { actions: [{ label: t("health.checkDevices"), href: `/energyiq/project-configuration?${new URLSearchParams({ projectId: data.projectId, tab: "devices" })}` }] }) }] : []),
  ];
  const worst = items.some(item => item.status === "act") ? "act" : items.some(item => item.status === "watch") ? "watch" : "good";
  const acting = items.filter(item => item.status === "act").length;
  return <StoryCard id="story-health" step={4} title={t("health.title")} takeaway={worst === "good" ? t("health.allGood") : worst === "watch" ? t("health.watch") : t(acting === 1 ? "health.act.one" : "health.act.other", { count: acting })}>
    <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{items.map(item => { const look = STATUS[item.status]; return <li key={item.title} className={`rounded-xl border bg-white p-4 ${look.ring}`}>
      <div className="flex items-start justify-between gap-3"><p className="text-sm font-medium text-slate-900">{item.title}</p><span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${look.chip}`}><EnergyIcon name={look.icon} className="h-3.5 w-3.5" />{shared(`status.${item.status}`)}</span></div>
      <p className="mt-2 text-xl font-semibold tabular-nums text-slate-900">{item.value}</p>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">{item.text}</p>
      {(item.days?.length || item.actions?.length) && <div className="mt-3 flex flex-wrap gap-1.5">
        {item.days?.map(day => <button key={day} type="button" onClick={() => onInspectDay(day)} aria-label={t("health.openDay", { day: dateWithDayYear(day, locale) })} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50">{shortDate(day, locale)} →</button>)}
        {item.actions?.map(action => action.href
          ? <Link key={action.label} href={action.href} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50">{action.label} →</Link>
          : <button key={action.label} type="button" onClick={action.onClick} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50">{action.label} →</button>)}
      </div>}
    </li>; })}</ul>
    <p className="mt-3 text-sm text-slate-600">{t("health.thresholds")}{data.previous ? "" : t("health.noPrevious")}</p>
  </StoryCard>;
}

/**
 * What next month should use: a normal open day and closed day from these readings, applied to the published
 * operating hours, holidays and closures, and priced with the saved electricity rate.
 */
function AheadSection({ story, data }: { story: Story; data: AnalysisData }) {
  const t = useMessages(forecastMessages);
  const { locale } = useEnergyIqLocale();
  const closedDaysPattern = `closed-days-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [policies, setPolicies] = useState<EnergyOperationalPolicyConfigurationDto | null | "failed">(null);
  useEffect(() => {
    let cancelled = false;
    configApi.getEnergyOperationalPolicies(data.projectId).then(result => { if (!cancelled) setPolicies(result); }).catch(() => { if (!cancelled) setPolicies("failed"); });
    return () => { cancelled = true; };
  }, [data.projectId]);
  const timeZone = story.project.timezone ?? "Asia/Singapore";
  const forecast: Forecast | null = useMemo(() => {
    if (!policies || policies === "failed") return null;
    const pick = <T extends { version_id: string }>(list: T[], version: string | undefined) => list.find(item => item.version_id === version) ?? list[0] ?? null;
    return forecastNextMonth({
      history: story.days.map(day => ({ date: day.date, kwh: day.totalKwh, complete: day.complete })),
      revision: pick(policies.operatingCalendarRevisions, policies.published.business_calendar_version),
      tariff: pick(policies.tariffRevisions, policies.published.tariff_schedule_version),
      timeZone, today: localDate(new Date().toISOString(), timeZone),
    });
  }, [policies, story.days, timeZone]);
  const kwh = (value: number) => Math.round(value).toLocaleString(intlLocale(locale));
  const money = (value: number, currency: string) => `${currency} ${Math.round(value).toLocaleString(intlLocale(locale))}`;
  const monthName = (date: string) => new Intl.DateTimeFormat(intlLocale(locale), { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
  if (policies === null) return <StoryCard id="story-ahead" step={6} title={t("title")} takeaway={t("loading")}><p className="text-sm text-slate-600" role="status">{t("loading")}</p></StoryCard>;
  if (!forecast) return <StoryCard id="story-ahead" step={6} title={t("title")} takeaway={t("unavailable")}>
    <p className="max-w-3xl text-sm leading-relaxed text-slate-600">{t("unavailable.body", { days: story.days.length })}</p>
    <Link href={`/energyiq/project-configuration?${new URLSearchParams({ projectId: data.projectId, tab: "devices" })}`} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">{t("unavailable.action")} <EnergyIcon name="arrow" className="h-3.5 w-3.5" /></Link>
  </StoryCard>;
  const month = monthName(forecast.month.from);
  const open = forecast.typical.find(item => item.kind === "open");
  const closed = forecast.typical.find(item => item.kind === "closed");
  const periodKwh = story.days.reduce((sum, day) => sum + (day.totalKwh ?? 0), 0);
  // Like for like. A 31-day month beats a 28-day period on the total alone, so the comparison is per day:
  // otherwise the card reports a rise of 11% when nothing about the site has changed.
  const monthDays = forecast.openDays + forecast.closedDays;
  const perDayNow = story.days.length > 0 ? periodKwh / story.days.length : 0;
  const perDayNext = monthDays > 0 ? forecast.kwh.mid / monthDays : 0;
  const change = perDayNow > 0 ? (perDayNext - perDayNow) / perDayNow * 100 : null;
  const cost = forecast.cost;
  const daysInMonth = forecast.days.length;
  const openAvg = open?.average ?? 0, closedAvg = closed?.average ?? 0;
  const currency = cost?.currency ?? story.currency ?? "SGD";
  // Step 5's plan is a yearly figure; show next month's share of it, and never more than half the month.
  const share = daysInMonth / 365;
  const cap = story.savingKwh > 0 ? Math.min(1, forecast.kwh.mid * 0.5 / (story.savingKwh * share)) : 0;
  const planKwh = story.savingKwh * share * cap;
  const planCost = story.savingCost != null ? story.savingCost * share * cap : null;
  const specials = forecast.days.filter(day => day.kind === "public_holiday" || day.kind === "special_closure" || day.kind === "special_operating_day");
  const mixTotal = Math.max(0.001, forecast.openKwh + forecast.closedKwh);
  const closedPct = forecast.closedKwh / mixTotal * 100;
  const series = [
    ...story.days.map(day => ({ date: day.date, kwh: day.totalKwh ?? 0, actual: true, open: day.dayType === "weekday", name: day.holidayName, kind: null as CalendarDayKind | null, shortHours: undefined as number | undefined })),
    ...forecast.days.map(day => ({ date: day.date, kwh: day.kwh, actual: false, open: day.open, name: day.name, kind: day.kind, shortHours: day.shortHours })),
  ];
  return <StoryCard id="story-ahead" step={6} title={t("title")} takeaway={t("takeaway", { month, kwh: kwh(forecast.kwh.mid), cost: cost ? t("takeawayCost", { cost: money(cost.mid, cost.currency) }) : "" })}>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-600">{t("expected", { month })}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{kwh(forecast.kwh.mid)} kWh</p>
        <p className="mt-1 text-sm text-slate-600">{t("range", { low: kwh(forecast.kwh.low), high: kwh(forecast.kwh.high) })}</p>
      </div>
      {cost && <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-600">{t("costLabel")}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{money(cost.mid, cost.currency)}</p>
        <p className="mt-1 text-sm text-slate-600">{t("costRange", { low: money(cost.low, cost.currency), high: money(cost.high, cost.currency) })}{cost.beforeTax && cost.taxName ? ` · ${cost.taxPct === undefined ? t("beforeTax", { tax: cost.taxName }) : t("withTax", { amount: money(cost.mid * (1 + cost.taxPct / 100), cost.currency), pct: cost.taxPct, tax: cost.taxName })}` : ""}</p>
      </div>}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-600">{t("daysLabel", { month })}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{t("daysValue", { open: forecast.openDays, closed: forecast.closedDays })}</p>
        <p className="mt-1 text-sm text-slate-700">{open ? <span className="font-medium text-slate-900">{t("chart.baseline", { kwh: kwh(openAvg) })}</span> : null}{open && closed ? " · " : ""}{closed ? <span className="font-medium text-slate-900">{t("chart.closedBaseline", { kwh: kwh(closedAvg) })}</span> : null}</p>
        <p className="mt-1 text-sm text-slate-600">{t("typicalNote")}</p>
      </div>
      {change != null && story.days.length >= 21 && <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-600">{t("comparedLabel", { days: story.days.length })}</p>
        {/* A rounded -0.4% is not "-0%": say that nothing much changes. */}
        <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{Math.round(change) === 0 ? t("comparedFlat") : `${change > 0 ? "+" : ""}${num(change, 0)}%`}</p>
        <p className="mt-1 text-sm text-slate-600">{t("comparedValue", { next: kwh(perDayNext), now: kwh(perDayNow) })}</p>
        <p className="mt-1 text-sm text-slate-600">{t("comparedDays", { month, monthDays, days: story.days.length })}</p>
      </div>}
    </div>
    {/* The story in one picture: what the site used, then what each day of next month should use. */}
    <figure className="mt-5">
      <figcaption className="mb-1 text-xs font-medium text-slate-700">{t("chart.title", { days: story.days.length, month })}</figcaption>
      <div className="h-52" role="img" aria-label={t("chart.aria", { days: story.days.length, month })}>
        <ResponsiveContainer width="100%" height="100%"><BarChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={1}>
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
          <defs><pattern id={closedDaysPattern} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill={FORECAST_CLOSED} /><line x1="0" y1="0" x2="0" y2="6" stroke={FORECAST_CLOSED_LINE} strokeWidth="2" /></pattern></defs>
          <XAxis dataKey="date" tickFormatter={date => shortDate(date, locale)} interval={Math.max(2, Math.round(series.length / 8))} tick={{ fontSize: 10, fill: "#64748b" }} axisLine={{ stroke: "#cbd5e1" }} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} width={38} tickFormatter={value => num(Number(value), 0)} label={{ value: "kWh", angle: -90, position: "insideLeft", fill: "#94a3b8", fontSize: 10 }} />
          <ReferenceLine x={forecast.month.from} stroke="#475569" strokeDasharray="4 3" label={{ value: t("chart.divider", { month }), position: "insideTopRight", fill: "#475569", fontSize: 10 }} />
          {/* The two baselines the whole month is built from; the legend names them, so no text sits over the bars. */}
          {open && <ReferenceLine y={open.average} stroke="#1b4f7e" strokeDasharray="5 4" label={<BaselineTag text={t("chart.baseline", { kwh: kwh(open.average) })} colour="#1b4f7e" />} />}
          {closed && <ReferenceLine y={closed.average} stroke="#475569" strokeDasharray="5 4" label={<BaselineTag text={t("chart.closedBaseline", { kwh: kwh(closed.average) })} colour="#475569" />} />}
          <Tooltip cursor={{ fill: "rgba(15,23,42,0.04)" }} content={({ active, payload }) => {
            const row = active && payload?.length ? payload[0]!.payload as (typeof series)[number] : null;
            if (!row) return null;
            return <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
              <p className="font-medium text-slate-900">{dateWithDayYear(row.date, locale)}</p>
              <p className="mt-0.5 text-slate-700">{row.actual ? t("chart.usedPoint", { value: kwh(row.kwh) }) : t("chart.expectedPoint", { value: kwh(row.kwh) })}</p>
              {row.kind && <p className="mt-0.5 text-slate-500">{dayKindLabel(row.kind, locale)}</p>}
              {row.shortHours != null && <p className="mt-0.5 text-slate-500">{t("chart.shortHours", { hours: num(row.shortHours, 1), normal: num(forecast.normalOpenHours, 1) })}</p>}
              {row.name && <p className="mt-0.5 text-slate-500">{row.name}</p>}
            </div>;
          }} />
          <Bar dataKey="kwh" radius={[2, 2, 0, 0]} isAnimationActive={false}>{series.map(row => <Cell key={row.date} fill={row.actual ? FORECAST_USED : row.open ? FORECAST_OPEN : `url(#${closedDaysPattern})`} />)}</Bar>
        </BarChart></ResponsiveContainer>
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600">
        {([[FORECAST_USED, t("chart.used")], [FORECAST_OPEN, t("chart.expectedOpen")], [FORECAST_CLOSED_CSS, t("chart.expectedClosed")]] as const).map(([colour, label]) => <span key={label} className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm border border-slate-200" style={{ background: colour }} />{label}</span>)}
      </p>
      <p className="mt-2 max-w-4xl text-sm leading-relaxed text-slate-600">{t("chart.caption", { month })}</p>
    </figure>
    {/* Where the month's energy goes: the same total, split into the two kinds of day it is built from. */}
    {forecast.openKwh > 0 && forecast.closedKwh > 0 && <figure className="mt-6">
      <figcaption className="mb-2 text-xs font-medium text-slate-700">{t("mix.title", { month })}</figcaption>
      <div className="flex h-14 w-full overflow-hidden rounded-lg" role="img" aria-label={t("mix.aria", { month })}>
        {([["open", forecast.openKwh, FORECAST_OPEN, "text-white", t("mix.working", { days: forecast.openDays })], ["closed", forecast.closedKwh, FORECAST_CLOSED_CSS, "text-slate-900", t("mix.closed", { days: forecast.closedDays })]] as const).map(([key, value, background, ink, label]) => {
          const pct = value / mixTotal * 100;
          return <div key={key} className={`flex flex-col items-center justify-center border-r-2 border-white px-1 text-center last:border-r-0 ${ink}`} style={{ width: `${pct}%`, background }}>
            {pct >= 14 && <><span className="text-xs font-semibold">{label}</span><span className="text-[11px] tabular-nums opacity-90">{t("mix.segment", { kwh: kwh(value), pct: num(pct, 0) })}</span></>}
          </div>;
        })}
      </div>
      <p className="mt-2 max-w-4xl text-sm leading-relaxed text-slate-600">{t("mix.note", { open: kwh(openAvg), closed: kwh(closedAvg), pct: num(closedPct, 0) })}</p>
    </figure>}
    {/* Holidays and closures: what each marked day is expected to do, and what it saves. */}
    <div className="mt-6">
      <h3 className="text-xs font-medium text-slate-700">{t("special.title", { month })}</h3>
      {specials.length ? <>
        <ul className="mt-2 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
          {specials.map(day => {
            const saved = Math.max(0, openAvg - day.kwh);
            return <li key={day.date} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2.5 text-sm">
              <span className="text-slate-900"><span className="font-medium">{day.name ?? dayKindLabel(day.kind, locale)}</span> · {dateWithDayYear(day.date, locale)}{day.name ? ` · ${dayKindLabel(day.kind, locale).toLowerCase()}` : ""}</span>
              <span className="text-slate-600">{day.open
                ? day.shortHours != null ? t("special.shortDay", { hours: num(day.shortHours, 1), normal: num(forecast.normalOpenHours, 1), kwh: kwh(day.kwh), saved: kwh(saved), cost: story.rate != null ? t("special.savesCost", { cost: money(saved * story.rate, currency) }) : "" }) : t("special.openDay", { kwh: kwh(day.kwh) })
                : `${t("special.closedDay", { kwh: kwh(day.kwh) })} · ${t("special.saves", { kwh: kwh(saved), cost: story.rate != null ? t("special.savesCost", { cost: money(saved * story.rate, currency) }) : "" })}`}</span>
            </li>;
          })}
        </ul>
        <p className="mt-2 max-w-4xl text-sm leading-relaxed text-slate-600">{t("special.note")}</p>
      </> : <p className="mt-2 max-w-4xl text-sm leading-relaxed text-slate-600">{t("special.none", { month })}{" "}
        <Link href={`/energyiq/project-configuration?${new URLSearchParams({ projectId: data.projectId, tab: "holidays" })}`} className="font-medium text-blue-700 underline hover:text-blue-800">{t("special.add")}</Link>
      </p>}
    </div>
    {/* What would change the forecast: the same month with the savings plan acted on. */}
    {planKwh > 1 && <figure className="mt-6">
      <figcaption className="mb-2 text-xs font-medium text-slate-700">{t("scenario.title")}</figcaption>
      <div role="img" aria-label={t("scenario.aria", { month })} className="space-y-2">
        {([["now", forecast.kwh.mid, FORECAST_OPEN, t("scenario.now")], ["after", Math.max(0, forecast.kwh.mid - planKwh), "#1baf7a", t("scenario.after")]] as const).map(([key, value, colour, label]) => <div key={key} className="flex items-center gap-3">
          <span className="w-44 shrink-0 text-sm text-slate-700">{label}</span>
          <div className="h-6 min-w-0 flex-1 rounded-md bg-slate-100"><div className="h-full rounded-md" style={{ width: `${value / Math.max(0.001, forecast.kwh.mid) * 100}%`, background: colour }} /></div>
          <span className="w-28 shrink-0 text-right text-sm font-semibold tabular-nums text-slate-900">{kwh(value)} kWh</span>
        </div>)}
      </div>
      <p className="mt-2 max-w-4xl text-sm leading-relaxed text-slate-600">{t("scenario.note", { kwh: kwh(planKwh), cost: planCost != null ? t("takeawayCost", { cost: money(planCost, currency) }) : "", month, total: kwh(Math.max(0, forecast.kwh.mid - planKwh)) })}{" "}
        <a href="#story-plan" className="font-medium text-blue-700 underline hover:text-blue-800">{t("scenario.link")}</a>
      </p>
    </figure>}
    {forecast.missingRateFrom && <p className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <EnergyIcon name="alert" className="h-3.5 w-3.5" />{t("noRate", { date: shortDate(forecast.missingRateFrom, locale) })}
      <Link href={`/energyiq/project-configuration?${new URLSearchParams({ projectId: data.projectId, tab: "tariff" })}`} className="font-medium underline">{t("addRate")}</Link>
    </p>}
    <p className="mt-3 text-sm text-slate-600">{forecast.basis === "partial" ? t("partial") : forecast.sampleDays < 10 ? t("rough", { days: forecast.sampleDays }) : t("basis", { days: forecast.sampleDays })} {t("savingsHint")}</p>
  </StoryCard>;
}

function PlanSection({ story, data, money }: { story: Story; data: AnalysisData; money: (amount: number | null) => string }) {
  const t = useMessages(storyMessages);
  const { locale } = useEnergyIqLocale();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [fixCost, setFixCost] = useState<Record<string, string>>({});
  const confidence = { High: "bg-emerald-50 text-emerald-700 ring-emerald-200", Medium: "bg-blue-50 text-blue-700 ring-blue-200", "Check first": "bg-slate-100 text-slate-700 ring-slate-200" };
  const counted = story.plan.filter(item => item.counted), checks = story.plan.filter(item => !item.counted);
  const toggle = (id: string) => setOpen(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const row = (item: Story["plan"][number], index: number) => {
    const expanded = open.has(item.id);
    const cost = Number(fixCost[item.id]);
    // Payback on the lower, proven figure when it is meaningful, so it is never flattering.
    const lowBasis = item.provenCost != null && item.annualCost != null && meaningfulLow(item.provenCost, item.annualCost);
    const basis = lowBasis ? item.provenCost : item.annualCost;
    const payback = basis && cost > 0 ? cost / basis * 12 : null;
    const start = item.counted && index === 0;
    return <React.Fragment key={item.id}>
      <tr className={`border-t border-slate-100 ${start ? "bg-emerald-50/50" : ""} ${expanded ? "" : "hover:bg-slate-50"}`}>
        <td className="w-10 py-2.5 pl-4 pr-2 align-top"><span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold ${item.counted ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-600"}`}>{index + 1}</span></td>
        <td className="py-2.5 pr-3 align-top">
          <button type="button" aria-expanded={expanded} onClick={() => toggle(item.id)} className="text-left font-medium text-slate-900 hover:text-blue-700">{item.title}</button>
          {start && <span className="ml-2 rounded-full bg-emerald-600 px-1.5 py-0.5 align-middle text-[10px] font-medium text-white">{t("plan.startHere")}</span>}
          {item.source === "action_plan" && <span className="ml-2 rounded-full bg-slate-100 px-1.5 py-0.5 align-middle text-[10px] text-slate-600">{t("plan.actionPlan")}</span>}
        </td>
        <td className={`whitespace-nowrap px-3 py-2.5 text-right align-top font-semibold tabular-nums first-letter:uppercase ${item.counted ? "text-emerald-700" : "text-slate-500"}`}>{item.annualCost != null ? itemRange(item, money, t, item.counted) : item.annualKwh != null ? `${num(item.annualKwh, 0)} kWh` : "—"}</td>
        <td className="whitespace-nowrap px-3 py-2.5 text-right align-top tabular-nums text-slate-500">{item.annualKwh != null ? `${num(item.annualKwh, 0)} kWh` : "—"}</td>
        <td className="whitespace-nowrap px-3 py-2.5 align-top"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${confidence[item.confidence]}`}>{confidenceLabel(item.confidence, locale)}</span></td>
        <td className="whitespace-nowrap px-3 py-2.5 align-top text-sm text-slate-600">{effortLabel(item.effort, locale)}</td>
        <td className="w-10 py-2.5 pr-4 text-right align-top"><button type="button" aria-expanded={expanded} aria-label={t(expanded ? "plan.hideDetails" : "plan.showDetails", { title: item.title })} onClick={() => toggle(item.id)} className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><EnergyIcon name="chevron" className={`h-4 w-4 transition-transform ${expanded ? "-rotate-90" : "rotate-90"}`} /></button></td>
      </tr>
      {expanded && <tr className={start ? "bg-emerald-50/50" : "bg-slate-50/70"}>
        <td />
        <td colSpan={6} className="pb-3 pr-4 text-sm leading-relaxed text-slate-600">
          <p className="text-sm text-slate-700">{item.detail}</p>
          <p className="mt-1">{t("plan.where", { area: item.area })}{item.math ? t("plan.how", { math: item.math }) : null}</p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            {item.counted && item.annualCost ? <label className="flex flex-wrap items-center gap-2">{t("plan.costToFix", { currency: story.currency ?? "" })}
              <input type="number" min={0} inputMode="decimal" aria-label={t("plan.costToFixLabel", { title: item.title, currency: story.currency ?? "" })} value={fixCost[item.id] ?? ""} onChange={event => setFixCost({ ...fixCost, [item.id]: event.target.value })} placeholder={t("plan.costPlaceholder")} className="w-24 rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-900" />
              <span className="font-medium text-slate-900">{payback == null ? t("plan.enterCost") : payback < 1 ? t("plan.paybackUnderMonth") : payback < 24 ? t(Math.round(payback) === 1 ? "plan.paybackMonths.one" : "plan.paybackMonths.other", { count: num(payback, 0) }) : t("plan.paybackYears", { count: num(payback / 12, 1) })}{payback != null ? <span className="font-normal text-slate-500">{t(lowBasis ? "plan.atLower" : "plan.ifSwitchedOff")}</span> : null}</span>
            </label> : <span>{item.confidence === "Check first" ? t("plan.confirm") : ""}</span>}
            {item.actionId
              ? <Link href={`/energyiq/actions?${new URLSearchParams({ projectId: data.projectId, actionId: item.actionId })}`} className="rounded-md border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50">{t("plan.openAction")}</Link>
              : <Link href={`/energyiq/reports?${new URLSearchParams({ projectId: data.projectId, sessionId: "new" })}`} className="rounded-md border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50">{t("plan.ask")}</Link>}
          </div>
        </td>
      </tr>}
    </React.Fragment>;
  };
  const takeaway = counted.length ? rich(t(counted.length === 1 ? "plan.takeaway.one" : "plan.takeaway.other", { count: counted.length }), {
    saving: <span className="font-semibold text-emerald-700">{t("plan.savingPerYear", { amount: savingRange(story, money, t, true) })}</span>,
  }) : t("plan.none");
  return <StoryCard id="story-plan" step={5} title={t("plan.title")} takeaway={takeaway}>
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-slate-50 text-left text-sm text-slate-600"><tr><th className="py-2 pl-4 pr-2 font-medium">#</th><th className="py-2 pr-3 font-medium">{t("plan.colAction")}</th><th className="px-3 py-2 text-right font-medium">{t("plan.colSaving")}</th><th className="px-3 py-2 text-right font-medium">{t("plan.colEnergy")}</th><th className="px-3 py-2 font-medium">{t("plan.colConfidence")}</th><th className="px-3 py-2 font-medium">{t("plan.colEffort")}</th><th className="py-2 pr-4"><span className="sr-only">{t("plan.colDetails")}</span></th></tr></thead>
        <tbody>
          {counted.map((item, index) => row(item, index))}
          {checks.length > 0 && <tr className="border-t border-slate-200 bg-slate-50"><td colSpan={7} className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{t("plan.checks")}</td></tr>}
          {checks.map((item, index) => row(item, counted.length + index))}
        </tbody>
      </table>
    </div>
    <p className="mt-3 text-sm text-slate-600">{t("plan.footnote")}</p>
  </StoryCard>;
}
