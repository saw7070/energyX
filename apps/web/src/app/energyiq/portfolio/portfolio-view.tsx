"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { EnergyPortfolioDto, EnergyPortfolioSiteDto } from "../../../lib/config-api";
import { useEnergyIqLocale, useMessages } from "../_components/energyiq-locale";
import { intlLocale } from "../_components/energyiq-messages";
import { withCurrency } from "../_components/money";
import { portfolioMessages } from "./portfolio-messages";
import styles from "./portfolio.module.css";

type SortKey = "name" | "usageKwh" | "changePct" | "cost" | "peakKw" | "afterHoursSharePct" | "kwhPerSqm" | "carbonKg";

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
        <Tile label={t("tile.energy")} value={`${format.kwh(totals.usageKwh)} kWh`} note={change === null ? t("tile.sites", { count: totals.sitesWithData }) : t("tile.change", { change: format.signedPct(change) })} />
        <Tile label={t("tile.cost")} value={Object.keys(totals.costByCurrency).length
          ? Object.entries(totals.costByCurrency).map(([currency, amount]) => withCurrency(currency, format.money(amount))).join(" + ")
          : "—"} note={Object.keys(totals.costByCurrency).length ? undefined : t("tile.noCost")} />
        <Tile label={t("tile.carbon")} value={`${format.tonnes(totals.carbonKg / 1000)} tCO2e`} note={t("tile.carbonNote")} />
        <Tile label={t("tile.budgets")} value={budgeted.length === 0 ? t("budgets.none") : totals.sitesOverBudget || totals.sitesAtRisk
          ? t("budgets.summary", { over: totals.sitesOverBudget, risk: totals.sitesAtRisk })
          : t("budgets.ok")} tone={totals.sitesOverBudget ? "bad" : totals.sitesAtRisk ? "warn" : undefined} note={budgeted.length === 0 ? t("setBudget") : undefined} />
      </section>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              {header("name", t("col.site"), "left")}
              {header("usageKwh", t("col.energy"))}
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
                  <Link href={`/energyiq/key-points?${new URLSearchParams({ projectId: site.projectId })}`} aria-label={t("openSite", { site: site.name })}>{site.name}</Link>
                  {site.status === "ok" && <span className={styles.bar} aria-hidden="true"><span style={{ width: `${(site.usageKwh / largest) * 100}%` }} /></span>}
                </th>
                {site.status === "unavailable" ? (
                  <td colSpan={5 + (showIntensity ? 1 : 0) + (budgeted.length > 0 ? 1 : 0) + 1} className={styles.unavailable}>{t("unavailable")}</td>
                ) : (
                  <>
                    <td className={styles.numeric}>{format.kwh(site.usageKwh)}</td>
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
        <section className={styles.footnote}>
          <h3>{t("carbonTitle")}</h3>
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
        </section>
      )}
    </div>
  );
}

function Tile({ label, value, note, tone }: { label: string; value: string; note?: string | undefined; tone?: "warn" | "bad" | undefined }) {
  return (
    <div className={`${styles.tile} ${tone ? styles[tone] : ""}`}>
      <span className={styles.tileLabel}>{label}</span>
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
    tonnes: (value: number) => fixed(value >= 100 ? 0 : value >= 1 ? 1 : 2).format(value),
    signedPct: (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${fixed(0).format(Math.abs(value))}%`,
  };
};
