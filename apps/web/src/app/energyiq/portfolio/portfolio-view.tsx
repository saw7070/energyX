"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { EnergyPortfolioDto, EnergyPortfolioSiteDto } from "../../../lib/config-api";
import { useEnergyIqLocale, useMessages } from "../_components/energyiq-locale";
import { intlLocale } from "../_components/energyiq-messages";
import { withCurrency } from "../_components/money";
import { EnergyIcon, type EnergyIconName } from "../_components/icons";
import { portfolioMessages } from "./portfolio-messages";
import styles from "./portfolio.module.css";

type SortKey = "name" | "usageKwh" | "averageDailyKwh" | "changePct" | "cost" | "peakKw" | "afterHoursSharePct" | "kwhPerSqm" | "carbonKg";

/** A site's kWh on an average day, or null when it has less than a day of readings (an older server sends no day count). */
export const averageOf = (site: EnergyPortfolioSiteDto): number | null =>
  site.status !== "ok" ? null : site.readingDays === undefined ? (site.averageDailyKwh > 0 ? site.averageDailyKwh : null) : site.readingDays >= 1 ? site.averageDailyKwh : null;
/** Every local date from the period's first to its last day. */
const periodDates = (period: { from: string; to: string }) => {
  const dates: string[] = [];
  for (let day = Date.parse(`${period.from}T00:00:00Z`); day <= Date.parse(`${period.to}T00:00:00Z`); day += 86_400_000) dates.push(new Date(day).toISOString().slice(0, 10));
  return dates;
};

/** Every site's figures for one period, as summary tiles and a sortable comparison table. */
export function PortfolioView({ portfolio }: { portfolio: EnergyPortfolioDto }) {
  const t = useMessages(portfolioMessages);
  const { locale } = useEnergyIqLocale();
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: "usageKwh", descending: true });
  const format = useMemo(() => formatters(intlLocale(locale)), [locale]);
  const { totals } = portfolio;
  const change = totals.previousUsageKwh > 0 ? ((totals.usageKwh - totals.previousUsageKwh) / totals.previousUsageKwh) * 100 : null;
  const budgeted = portfolio.sites.filter(site => site.budget);
  const sites = useMemo(() => sortSites(portfolio.sites, sort.key, sort.descending), [portfolio.sites, sort]);
  const largest = Math.max(1, ...portfolio.sites.map(site => site.usageKwh));
  const showIntensity = portfolio.sites.some(site => site.kwhPerSqm !== undefined);
  const factors = uniqueFactors(portfolio.sites);
  const dates = useMemo(() => periodDates(portfolio.period), [portfolio.period]);
  const dayLabel = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString(intlLocale(locale), { timeZone: "UTC", day: "numeric", month: "short" }).replace("Sept", "Sep");
  const trendLabel = (values: Array<number | null>) => {
    const days = values.flatMap((kwh, index) => kwh === null || !dates[index] ? [] : [{ kwh, date: dates[index]! }]);
    if (!days.length) return t("trendNone");
    const low = days.reduce((best, day) => day.kwh < best.kwh ? day : best), high = days.reduce((best, day) => day.kwh > best.kwh ? day : best);
    return t("trendAlt", { from: dayLabel(dates[0]!), to: dayLabel(dates.at(-1)!), low: format.one(low.kwh), lowDate: dayLabel(low.date), high: format.one(high.kwh), highDate: dayLabel(high.date) });
  };
  const header = (key: SortKey, label: string, align: "left" | "right" = "right") => (
    <th scope="col" className={align === "right" ? styles.numeric : undefined} aria-sort={sort.key === key ? (sort.descending ? "descending" : "ascending") : "none"}>
      <button type="button" onClick={() => setSort(current => ({ key, descending: current.key === key ? !current.descending : key !== "name" }))} aria-label={t("sortBy", { column: label })}>
        {label}{sort.key === key ? <span aria-hidden="true">{sort.descending ? " ↓" : " ↑"}</span> : null}
      </button>
    </th>
  );

  if (portfolio.sites.length === 0) return <p className={styles.empty}>{t("noSites")}</p>;
  return (
    <div className={styles.stack}>
      <section className={styles.tiles} aria-label={t("title")}>
        <Tile icon="bolt" iconTone="energy" chip={change === null ? undefined : format.signedPct(change)} chipTone={change !== null && change > 0 ? "up" : "down"} label={t("tile.energy")} value={`${format.kwh(totals.usageKwh)} kWh`} note={change === null ? t("tile.sites", { count: totals.sitesWithData }) : t("tile.change", { change: format.signedPct(change) })} />
        <Tile icon="calendar" iconTone="energy" label={t("tile.average")} value={totals.averageDailyKwh ? `${format.kwh(totals.averageDailyKwh)} kWh` : "—"} note={t("tile.averageNote")} />
        <Tile icon="dollar" iconTone="cost" label={t("tile.cost")} value={Object.keys(totals.costByCurrency).length
          ? Object.entries(totals.costByCurrency).map(([currency, amount]) => withCurrency(currency, format.money(amount))).join(" + ")
          : "—"} note={Object.keys(totals.costByCurrency).length ? undefined : t("tile.noCost")} />
        <Tile icon="leaf" iconTone="carbon" label={t("tile.carbon")} value={`${format.tonnes(totals.carbonKg / 1000)} tCO2e`} note={t("tile.carbonNote")} />
        <Tile icon="wallet" iconTone="budget" label={t("tile.budgets")} value={budgeted.length === 0 ? t("budgets.none") : totals.sitesOverBudget || totals.sitesAtRisk
          ? t("budgets.summary", { over: totals.sitesOverBudget, risk: totals.sitesAtRisk })
          : t("budgets.ok")} tone={totals.sitesOverBudget ? "bad" : totals.sitesAtRisk ? "warn" : undefined} note={budgeted.length === 0 ? t("setBudget") : undefined} />
      </section>

      <section className={styles.sitesCard} aria-labelledby="portfolio-sites-title">
      <header className={styles.sitesHead}><h2 id="portfolio-sites-title">{t("sitesTitle")}</h2><span>{t("sortHint")}</span></header>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              {header("name", t("col.site"), "left")}
              {header("usageKwh", t("col.energy"))}
              {header("averageDailyKwh", t("col.average"))}
              <th scope="col">{t("col.trend")}</th>
              {header("changePct", t("col.change"))}
              {header("cost", t("col.cost"))}
              {header("peakKw", t("col.peak"))}
              {header("afterHoursSharePct", t("col.afterHours"))}
              {showIntensity && header("kwhPerSqm", t("col.intensity"))}
              {header("carbonKg", t("col.carbon"))}
              {budgeted.length > 0 && <th scope="col">{t("col.budget")}</th>}
              <th scope="col">{t("col.data")}</th>
            </tr>
          </thead>
          <tbody>
            {sites.map(site => (
              <tr key={site.projectId}>
                <th scope="row" className={styles.siteCell}>
                  <span className={styles.siteLine}>
                    <span className={styles.siteBadge} aria-hidden="true">{site.country ?? site.name.slice(0, 2).toUpperCase()}</span>
                    <span className={styles.siteName}>
                      <Link href={`/energyiq/key-points?${new URLSearchParams({ projectId: site.projectId })}`} aria-label={t("openSite", { site: site.name })}>{site.name}</Link>
                      {site.country && <small>{site.country === "MY" && site.state ? `${site.state} · ` : ""}{t(`country.${site.country}`)}</small>}
                    </span>
                  </span>
                  {site.status === "ok" && <span className={styles.bar} aria-hidden="true"><span style={{ width: `${(site.usageKwh / largest) * 100}%` }} /></span>}
                </th>
                {site.status === "unavailable" ? (
                  <td colSpan={7 + (showIntensity ? 1 : 0) + (budgeted.length > 0 ? 1 : 0) + 1} className={styles.unavailable}>{t("unavailable")}</td>
                ) : (
                  <>
                    <td className={styles.numeric}>{format.kwh(site.usageKwh)}</td>
                    <td className={styles.numeric}>
                      {averageOf(site) === null ? "—" : format.kwh(averageOf(site)!)}
                      {/* A site connected part-way through, or with days lost, says how many days the average is over. */}
                      {site.readingDays !== undefined && site.readingDays >= 1 && site.readingDays <= dates.length - 1 && <small className={styles.cellNote}>{t("readingDays", { days: format.days(site.readingDays) })}</small>}
                    </td>
                    <td className={styles.trendCell}><Sparkline values={site.dailyKwh ?? []} label={trendLabel(site.dailyKwh ?? [])} /></td>
                    <td className={`${styles.numeric} ${site.changePct !== null && site.changePct > 0 ? styles.up : site.changePct !== null && site.changePct < 0 ? styles.down : ""}`}>{site.changePct === null ? "—" : format.signedPct(site.changePct)}</td>
                    <td className={styles.numeric}>{site.cost ? withCurrency(site.cost.currency, format.money(site.cost.amount)) : "—"}</td>
                    <td className={styles.numeric}>{format.one(site.peakKw)}</td>
                    <td className={styles.numeric}>{site.afterHoursSharePct === undefined ? "—" : `${format.whole(site.afterHoursSharePct)}%`}</td>
                    {showIntensity && <td className={styles.numeric}>{site.kwhPerSqm === undefined ? "—" : format.one(site.kwhPerSqm)}</td>}
                    <td className={styles.numeric}>{format.tonnes(site.carbonKg / 1000)}</td>
                    {budgeted.length > 0 && <td>{site.budget ? <BudgetBadge site={site} /> : "—"}</td>}
                    <td className={styles.coverage}>{site.dataStatus === "complete" ? t("complete") : t("coverage", { pct: format.whole(site.coveragePct) })}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {factors.length > 0 && (
        <details className={styles.footnote}>
          <summary>{t("carbonTitle")}</summary>
          <p>{t("carbonBody")}</p>
          <ul>
            {factors.map(factor => (
              <li key={factor.key}>
                {t("carbonFactorLine", { factor: factor.kgCo2ePerKwh, source: factor.source, year: factor.year })}
                {factor.provisional ? ` (${t("provisional")})` : ""}{factor.basis === "custom" ? ` (${t("custom")})` : ""}
                {" — "}{factor.sites.join(", ")}
              </li>
            ))}
          </ul>
        </details>
      )}
      </section>
    </div>
  );
}

/**
 * Each day's use as a small line from zero, so a steady site reads as steady. Days without readings leave a gap.
 * Screen readers, and a mouse hovering over it, get the same story in words: the period and its lowest and highest day.
 */
export function Sparkline({ values, label }: { values: Array<number | null>; label: string }) {
  const width = 104, height = 28, pad = 2;
  const present = values.filter((value): value is number => value !== null);
  if (!present.length) return <span className={styles.coverage} title={label}>—<span className={styles.srOnly}>{label}</span></span>;
  const max = Math.max(...present, 0.001);
  const x = (index: number) => values.length === 1 ? width / 2 : pad + index * (width - 2 * pad) / (values.length - 1);
  const y = (value: number) => pad + (1 - value / max) * (height - 2 * pad);
  const runs: Array<Array<[number, number]>> = [];
  values.forEach((value, index) => {
    if (value === null) { if (runs.at(-1)?.length) runs.push([]); return; }
    if (!runs.length) runs.push([]);
    runs.at(-1)!.push([x(index), y(value)]);
  });
  return <svg className={styles.spark} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
    <title>{label}</title>
    {runs.filter(run => run.length).map((run, index) => run.length === 1
      ? <circle key={index} cx={run[0]![0]} cy={run[0]![1]} r={1.6} />
      : <polyline key={index} points={run.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(" ")} />)}
  </svg>;
}

function Tile({ label, value, note, tone, icon, iconTone, chip, chipTone }: { label: string; value: string; note?: string | undefined; tone?: "warn" | "bad" | undefined; icon: EnergyIconName; iconTone: "energy" | "cost" | "carbon" | "budget"; chip?: string | undefined; chipTone?: "up" | "down" }) {
  return (
    <div className={`${styles.tile} ${tone ? styles[tone] : ""}`}>
      <span className={styles.tileHead}>
        <span className={`${styles.tileIcon} ${styles[`icon-${iconTone}`]}`} aria-hidden="true"><EnergyIcon name={icon} /></span>
        <span className={styles.tileLabel}>{label}</span>
        {chip && <span className={`${styles.tileChip} ${chipTone === "up" ? styles.chipUp : styles.chipDown}`}>{chip}</span>}
      </span>
      <strong className={styles.tileValue}>{value}</strong>
      {note && <span className={styles.tileNote}>{note}</span>}
    </div>
  );
}

function BudgetBadge({ site }: { site: EnergyPortfolioSiteDto }) {
  const t = useMessages(portfolioMessages);
  const { locale } = useEnergyIqLocale();
  const budget = site.budget!;
  const format = formatters(intlLocale(locale));
  const onMoney = budget.actualCost !== undefined && budget.forecastCost !== undefined;
  const value = (amount: number) => onMoney ? withCurrency(budget.currency, format.money(amount, 0)) : `${format.kwh(amount)} kWh`;
  const month = new Date(`${budget.month}-01T00:00:00Z`).toLocaleDateString(intlLocale(locale), { timeZone: "UTC", month: "short" });
  const tip = budget.status === "no-data" ? undefined : t("budgetTip", {
    month,
    actual: value(onMoney ? budget.actualCost! : budget.actualKwh),
    budget: value(onMoney ? budget.budgetAmount : budget.budgetKwh ?? 0),
    forecast: value(onMoney ? budget.forecastCost! : budget.forecastKwh),
  });
  return <span className={`${styles.badge} ${styles[budget.status]}`} title={tip}>{t(`budget.${budget.status}`)}{tip && <span className={styles.srOnly}>: {tip}</span>}</span>;
}

const sortSites = (sites: EnergyPortfolioSiteDto[], key: SortKey, descending: boolean): EnergyPortfolioSiteDto[] => {
  const value = (site: EnergyPortfolioSiteDto): number | string | undefined => key === "name" ? site.name
    : key === "cost" ? site.cost?.amount
    : key === "changePct" ? site.changePct ?? undefined
    : key === "averageDailyKwh" ? averageOf(site) ?? undefined
    : site[key];
  return [...sites].sort((left, right) => {
    // Sites without the figure go last whichever way the column is sorted.
    const a = left.status === "ok" ? value(left) : undefined;
    const b = right.status === "ok" ? value(right) : undefined;
    if (a === undefined || b === undefined) return a === undefined ? (b === undefined ? left.name.localeCompare(right.name) : 1) : -1;
    const order = typeof a === "string" ? a.localeCompare(String(b)) : a - Number(b);
    return descending ? -order : order;
  });
};

const uniqueFactors = (sites: EnergyPortfolioSiteDto[]) => {
  const groups = new Map<string, EnergyPortfolioSiteDto["carbonFactor"] & { key: string; sites: string[] }>();
  for (const site of sites) {
    const factor = site.carbonFactor;
    const key = `${factor.kgCo2ePerKwh}|${factor.year}|${factor.source}|${factor.basis}`;
    const group = groups.get(key) ?? { ...factor, key, sites: [] };
    group.sites.push(site.name);
    groups.set(key, group);
  }
  return [...groups.values()];
};

export const formatters = (locale: string) => {
  const fixed = (digits: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return {
    kwh: (value: number) => fixed(value >= 100 ? 0 : 1).format(value),
    money: (value: number, digits = 2) => fixed(digits).format(value),
    one: (value: number) => fixed(1).format(value),
    whole: (value: number) => fixed(0).format(value),
    days: (value: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value),
    tonnes: (value: number) => fixed(value >= 100 ? 0 : value >= 1 ? 1 : 2).format(value),
    signedPct: (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${fixed(0).format(Math.abs(value))}%`,
  };
};
