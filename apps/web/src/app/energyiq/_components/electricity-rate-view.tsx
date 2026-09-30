"use client";
import type { ReactNode } from "react";
import type { EnergyTariffScheduleEntryDto, EnergyTariffScheduleRevisionDto } from "../../../lib/config-api";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { intlLocale, translatorFor, type EnergyIqLocale } from "./energyiq-messages";
import { EnergyIcon } from "./icons";
import { dateRange } from "./operating-hours-view";
import { electricityRateMessages } from "./operating-policy-messages";
import styles from "./operating-hours-view.module.css";

type Status = "published" | "draft" | "saved";
const DAY_MS = 86_400_000;

/** Tariff periods are stored as instants; show them as local calendar days with an inclusive end. */
export function localDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}
export function ratePeriod(entry: Pick<EnergyTariffScheduleEntryDto, "effective_from" | "effective_to">, timeZone: string, locale: EnergyIqLocale = "en"): { from: string; to: string | null; text: string } {
  const from = localDay(entry.effective_from, timeZone);
  const to = entry.effective_to ? localDay(new Date(Date.parse(entry.effective_to) - 1).toISOString(), timeZone) : null;
  const start = new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${from}T00:00:00Z`));
  return { from, to, text: to ? dateRange(from, to, locale) : translatorFor(electricityRateMessages, locale)("from", { date: start }) };
}
export function withTax(entry: Pick<EnergyTariffScheduleEntryDto, "rate_per_kwh" | "rate_basis" | "tax">, locale: EnergyIqLocale = "en"): { beforeTax: number | null; afterTax: number | null; note: string } {
  const t = translatorFor(electricityRateMessages, locale);
  const tax = entry.tax ? { pct: entry.tax.rate_pct, tax: entry.tax.name } : undefined;
  if (entry.rate_basis === "tax_exclusive") return { beforeTax: entry.rate_per_kwh, afterTax: entry.tax ? entry.rate_per_kwh * (1 + entry.tax.rate_pct / 100) : null, note: tax ? t("note.before", tax) : t("note.beforeTax") };
  if (entry.rate_basis === "tax_inclusive") return { beforeTax: entry.tax ? entry.rate_per_kwh / (1 + entry.tax.rate_pct / 100) : null, afterTax: entry.rate_per_kwh, note: tax ? t("note.including", tax) : t("note.includingTax") };
  return { beforeTax: null, afterTax: null, note: t("note.notStated") };
}
const money = (currency: string, value: number, digits = 4, locale: EnergyIqLocale = "en") => `${currency} ${value.toLocaleString(intlLocale(locale), { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

export function ElectricityRateView({ revision, status, action, ownerName, timezone, onAddNext }: {
  revision: EnergyTariffScheduleRevisionDto; status: Status; action?: ReactNode; ownerName: (owner: EnergyTariffScheduleEntryDto["owner"]) => string; timezone: string; onAddNext?: () => void;
}) {
  const t = useMessages(electricityRateMessages);
  const { locale } = useEnergyIqLocale();
  const today = localDay(new Date().toISOString(), timezone);
  const entries = [...revision.entries].sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  const periods = entries.map(entry => ({ entry, period: ratePeriod(entry, timezone, locale) }));
  // State codes drive the logic; only their labels are translated.
  const state = (period: { from: string; to: string | null }) => period.from > today ? "upcoming" as const : period.to && period.to < today ? "ended" as const : "current" as const;
  const current = periods.find(item => state(item.period) === "current") ?? periods[periods.length - 1];
  if (!current) return null;
  const { entry, period } = current;
  const price = withTax(entry, locale);
  const cost = (value: number, digits?: number) => money(entry.currency, value, digits, locale);
  const last = periods[periods.length - 1]!.period;
  const daysLeft = last.to ? Math.round((Date.parse(`${last.to}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS) : null;
  const example = 1000;
  return <div className={styles.view}>
    <div className={styles.statusRow}>
      <span className={`${styles.badge} ${styles[status]}`}><span className={styles.dot} />{t(`status.${status}`)}</span>
      <span className={styles.hint}>{t(`status.${status}.hint`)}</span>
      {action}
    </div>

    <div className={styles.rateHero}>
      <span>{state(period) === "current" ? t("currentRate") : t("latestRate")}</span>
      <strong>{cost(entry.rate_per_kwh)}<small> {t("perKwhUnit")}</small></strong>
      <p>{price.note}{price.afterTax !== null && entry.rate_basis === "tax_exclusive" ? ` · ${t("priceWithTax", { price: cost(price.afterTax), tax: entry.tax!.name })}` : ""}{price.beforeTax !== null && entry.rate_basis === "tax_inclusive" ? ` · ${t("priceBeforeTax", { price: cost(price.beforeTax), tax: entry.tax!.name })}` : ""}</p>
    </div>

    <div className={styles.tiles}>
      <div className={styles.tile}><span>{t("appliesTo")}</span><strong>{ownerName(entry.owner)}</strong><small>{t("everyMeter")}</small></div>
      <div className={styles.tile}><span>{t("inEffect")}</span><strong>{period.text}</strong><small>{daysLeft === null ? t("noEndDate") : daysLeft < 0 ? t(daysLeft === -1 ? "endedAgo.one" : "endedAgo.other", { count: -daysLeft }) : daysLeft === 0 ? t("endsToday") : t(daysLeft === 1 ? "endsIn.one" : "endsIn.other", { count: daysLeft })}</small></div>
      <div className={styles.tile}><span>{t("exampleCost")}</span><strong>{t("example", { kwh: example.toLocaleString(intlLocale(locale)), price: cost(entry.rate_per_kwh * example, 2) })}</strong><small>{price.afterTax !== null && entry.rate_basis === "tax_exclusive" ? t("exampleWithTax", { price: cost(price.afterTax * example, 2), tax: entry.tax!.name }) : price.note}</small></div>
    </div>

    {daysLeft !== null && daysLeft <= 30 && <div className={styles.alert} role="note"><EnergyIcon name="alert" /><p><strong>{t("noRateAfter", { date: dateRange(last.to!, last.to!, locale) })}</strong> {t("addNextHint")}</p>{onAddNext && <button type="button" className={styles.alertAction} onClick={onAddNext}>{t("addNextRate")}</button>}</div>}

    <section className={styles.special} aria-label={t("ratePeriods")}>
      <header><div><h4>{t("ratePeriods")}</h4><p>{t("ratePeriodsHint")}</p></div></header>
      <ul>{periods.map(({ entry: item, period: range }) => {
        const tag = state(range);
        const tax = withTax(item, locale);
        return <li key={item.id} className={tag === "current" ? styles.current : undefined}>
          <span className={styles.when}>{range.text}</span>
          <span className={styles.what}><strong>{t("perKwh", { price: money(item.currency, item.rate_per_kwh, 4, locale) })}</strong><small>{tax.note} · {ownerName(item.owner)} · {t(`state.${tag}`)}</small></span>
        </li>;
      })}</ul>
    </section>
  </div>;
}
