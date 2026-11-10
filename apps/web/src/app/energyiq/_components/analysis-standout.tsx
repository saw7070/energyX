"use client";
/**
 * "Why was this day different?" on the Analysis daily chart: the hover / tap explanation of one bar, and the same
 * explanations listed under the chart so they can be read without a mouse. The rules and wording live in
 * @datafoundry/site-report (standout-days, standout-messages), shared with the Overview report.
 */
import { useId, useMemo } from "react";
import {
  contributorsLead, dateWithDay, dayHeadline, explainDays, meterGroupPlaces, meterPlace, signedKwh, standoutKwh, standoutMeters, standoutRule, standoutText,
  type AnalysisDay, type AnalysisGroups, type DayExplanation, type LoadedPeriod, type ScopeData,
} from "@datafoundry/site-report";
import { useEnergyIqLocale } from "./energyiq-locale";

/** Outline of a bar that stood out; the amber of the chart's holiday mark, visible in both themes. */
export const STANDOUT_STROKE = "#b45309";

/**
 * Each day's explanation by date, for one scope's days: a chosen space and its meters, or (with no space) the whole
 * site and the meters of every space. Meters are named with their group.
 */
export function useDayExplanations(days: AnalysisDay[], space: ScopeData | null, current: LoadedPeriod, lighting: boolean, groups?: AnalysisGroups): Map<string, DayExplanation> {
  return useMemo(() => {
    const meters = standoutMeters(space ? [space] : [current.project, ...current.spaces]);
    return new Map(explainDays({ days, meters, lighting, places: meterGroupPlaces(groups) }).map(item => [item.date, item]));
  }, [days, space, current, lighting, groups]);
}

/** One day's explanation: how it compares with a usual day, and the meters that account for most of the difference. */
export function DayExplanationView({ item, siteName }: { item: DayExplanation; siteName: string }) {
  const { locale } = useEnergyIqLocale();
  const t = standoutText(locale);
  const lead = contributorsLead(item, locale);
  return <div className="space-y-1">
    <p>{dayHeadline(item, locale)}</p>
    {item.status === "standout" && item.lead === "none" && <p className="text-slate-600">{t("lead.none")}</p>}
    {lead && <div>
      <p className="font-medium text-slate-900">{lead}</p>
      <ul className="mt-0.5 space-y-0.5">{item.contributors.map(contributor => {
        const place = meterPlace(contributor.place, siteName);
        return <li key={contributor.id} className="flex flex-wrap items-baseline gap-x-1.5">
          <span title={contributor.fullName}>{contributor.name}</span>
          {place && <small className="text-[11px] text-slate-500">{place}</small>}
          <span className="font-semibold tabular-nums text-slate-900">{signedKwh(contributor.deltaKwh)}</span>
        </li>;
      })}</ul>
      {item.lead === "spread" && <p className="mt-0.5 text-slate-600">{t("rest")}</p>}
    </div>}
  </div>;
}

/** The chart tooltip for one bar. Days that are not compared also show their total, which the sentence then leaves out. */
export function DayTip({ date, item, siteName, totalLabel }: { date: string; item: DayExplanation | undefined; siteName: string; totalLabel: (kwh: string, complete: boolean) => string }) {
  const { locale } = useEnergyIqLocale();
  return <div className="max-w-[320px] rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-sm text-slate-800 shadow-lg">
    <p className="mb-1 text-base font-semibold text-slate-900">{dateWithDay(date, locale)}</p>
    {item && (item.status === "missing" || item.status === "few-days") && <p className="mb-1 text-slate-600">{totalLabel(standoutKwh(item.totalKwh), item.status !== "missing")}</p>}
    {item && <DayExplanationView item={item} siteName={siteName} />}
  </div>;
}

/** The days that stood out among the days on the chart, written out in full: the keyboard and screen-reader route to the tooltips. */
export function StandoutDayList({ items, lighting, siteName, hint }: { items: DayExplanation[]; lighting: boolean; siteName: string; hint: string }) {
  const { locale } = useEnergyIqLocale();
  const t = standoutText(locale);
  const heading = useId();
  const found = items.filter(item => item.status === "standout");
  return <section aria-labelledby={heading} className="mb-4 rounded-md border border-slate-200 bg-slate-50 p-3">
    <h3 id={heading} className="text-sm font-semibold text-slate-900">{t("title")}</h3>
    <p className="mt-0.5 text-xs text-slate-600">{standoutRule(locale, lighting)}{found.length ? ` ${hint}` : ""}</p>
    {found.length
      ? <ul className="mt-2 max-h-80 space-y-2 overflow-auto">{found.map(item => <li key={item.date} className="rounded border border-slate-200 bg-white p-2 text-sm text-slate-800"><DayExplanationView item={item} siteName={siteName} /></li>)}</ul>
      : <p className="mt-2 text-sm text-slate-600">{t(lighting ? "lights.none" : "none")}</p>}
  </section>;
}
