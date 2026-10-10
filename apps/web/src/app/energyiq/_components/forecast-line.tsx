"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { configApi, type EnergyOperatingCalendarEntryDto } from "../../../lib/config-api";
import { deviceStatistics, periodDates, type HourCell } from "./device-statistics";
import { forecastNextMonth, localDate, type Forecast } from "./forecast-model";
import { forecastMessages } from "./forecast-messages";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { intlLocale } from "./energyiq-messages";
import { withCurrency } from "./money";

/** One line on Overview: what next month should use, with a link to the full estimate on Analysis. */
export function ForecastLine({ projectId, className }: { projectId: string; className?: string }) {
  const t = useMessages(forecastMessages);
  const { locale } = useEnergyIqLocale();
  const [forecast, setForecast] = useState<Forecast | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [analysis, policies] = await Promise.all([
        configApi.executeEnergyScopeAnalysis({ projectId, scopeId: "project", resource: "electricity", period: "Custom", analysisWindow: "current-overview-28d", surface: "project-explorer" }),
        configApi.getEnergyOperationalPolicies(projectId),
      ]);
      const pick = <T extends { version_id: string }>(list: T[], version: string | undefined) => list.find(item => item.version_id === version) ?? list[0] ?? null;
      const revision = pick(policies.operatingCalendarRevisions, policies.published.business_calendar_version);
      const scope = analysis.explorerTrends?.find(trend => trend.id === "__scope__");
      if (!scope) return;
      const timeZone = analysis.context.timezone;
      const dates = periodDates(analysis.context.from, analysis.context.to, timeZone);
      const calendar: EnergyOperatingCalendarEntryDto[] | null = revision?.entries ?? null;
      const stats = deviceStatistics(scope.cells as HourCell[], dates, calendar, scope.expectedMinutesPerHour);
      const next = forecastNextMonth({
        history: stats.daily.map(day => ({ date: day.date, kwh: day.kwh, complete: day.complete })),
        revision, tariff: pick(policies.tariffRevisions, policies.published.tariff_schedule_version),
        timeZone, today: localDate(new Date().toISOString(), timeZone),
      });
      if (!cancelled) setForecast(next);
    })().catch(() => { /* Overview stays useful without the estimate. */ });
    return () => { cancelled = true; };
  }, [projectId]);
  if (!forecast) return null;
  const month = new Intl.DateTimeFormat(intlLocale(locale), { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${forecast.month.from}T00:00:00Z`));
  const number = (value: number) => Math.round(value).toLocaleString(intlLocale(locale));
  const cost = forecast.cost ? t("takeawayCost", { cost: withCurrency(forecast.cost.currency, number(forecast.cost.mid)) }) : "";
  return <p className={className}>{t("takeaway", { month, kwh: number(forecast.kwh.mid), cost })} <Link href={`/energyiq/analysis?${new URLSearchParams({ projectId, section: "story-ahead" })}`}>{t("seeAhead")} →</Link></p>;
}
