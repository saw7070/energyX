"use client";

import { useCallback, useEffect, useState } from "react";

import { configApi, type EnergyPortfolioDto } from "../../../lib/config-api";
import { useEnergyIqAccess } from "../_components/energyiq-access";
import { useEnergyIqLocale, useMessages } from "../_components/energyiq-locale";
import { intlLocale } from "../_components/energyiq-messages";
import { friendlyErrorMessage } from "../_components/friendly-error";
import { EnergyIcon } from "../_components/icons";
import { portfolioMessages } from "./portfolio-messages";
import { PortfolioView } from "./portfolio-view";
import { ReportSchedules } from "./report-schedules";
import styles from "./portfolio.module.css";

export type PeriodPreset = "lastMonth" | "thisMonth" | "last3Months" | "thisYear" | "custom";
const PRESETS: PeriodPreset[] = ["lastMonth", "thisMonth", "last3Months", "thisYear", "custom"];
/** Every site EnergyX serves is in Singapore or Malaysia, both UTC+8. */
const SITE_TIME_ZONE = "Asia/Singapore";

export function EnergyIqPortfolio() {
  const t = useMessages(portfolioMessages);
  const { locale } = useEnergyIqLocale();
  const { access, error: accessError } = useEnergyIqAccess();
  const workspaceId = access?.activeWorkspaceId ?? "";
  const workspaceName = access?.workspaces.find(workspace => workspace.id === workspaceId)?.name;
  const canManageReports = access?.team?.canManagePeople === true || access?.role === "admin";
  const [preset, setPreset] = useState<PeriodPreset>("lastMonth");
  const [custom, setCustom] = useState(() => presetPeriod("lastMonth"));
  const [period, setPeriod] = useState(() => presetPeriod("lastMonth"));
  const [portfolio, setPortfolio] = useState<EnergyPortfolioDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<"pdf" | "carbon.csv" | null>(null);

  const load = useCallback(async (next: { from: string; to: string }) => {
    setPortfolio(null);
    setError(null);
    try {
      setPortfolio(await configApi.getEnergyPortfolio(next));
    } catch (reason) {
      setError(friendlyErrorMessage(reason, { fallback: t("loadFailed") }));
    }
  }, [t]);
  // The client can change from the top bar; reload so one client's sites never show under another's name.
  useEffect(() => { if (workspaceId) void load(period); }, [workspaceId, period, load]);

  const choose = (next: PeriodPreset) => {
    setPreset(next);
    if (next !== "custom") setPeriod(presetPeriod(next));
  };
  const download = async (kind: "pdf" | "carbon.csv") => {
    setDownloading(kind);
    setError(null);
    try {
      const { blob, filename } = await configApi.downloadEnergyPortfolio(kind, period);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) {
      setError(friendlyErrorMessage(reason, { fallback: t("downloadFailed") }));
    } finally {
      setDownloading(null);
    }
  };

  if (!access) return <div className="p-4 sm:p-6">{accessError ? <p role="alert" className={styles.error}>{accessError}</p> : <p role="status" className={styles.muted}>{t("loading")}</p>}</div>;
  return (
    <div className="min-w-0 p-4 sm:p-6">
      <section className={styles.page}>
        <header className={styles.pageHeader}>
          <div>
            <h1>{t("title")}</h1>
            <p>{workspaceName ? t("intro", { client: workspaceName }) : t("introNoClient")}</p>
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.secondary} disabled={!portfolio || downloading !== null} onClick={() => void download("carbon.csv")}>
              <EnergyIcon name="download" className="h-4 w-4" />{downloading === "carbon.csv" ? t("downloading") : t("downloadCarbon")}
            </button>
            <button type="button" className={styles.primary} disabled={!portfolio || downloading !== null} onClick={() => void download("pdf")}>
              <EnergyIcon name="document" className="h-4 w-4" />{downloading === "pdf" ? t("downloading") : t("downloadPdf")}
            </button>
          </div>
        </header>

        <div className={styles.periodBar}>
          <div role="radiogroup" aria-label={t("periodLabel")} className={styles.segmented}>
            {PRESETS.map(option => (
              <button key={option} type="button" role="radio" aria-checked={preset === option} onClick={() => choose(option)}>{t(`period.${option}`)}</button>
            ))}
          </div>
          {preset === "custom" ? (
            <form className={styles.custom} onSubmit={event => { event.preventDefault(); if (custom.from <= custom.to) setPeriod({ ...custom }); }}>
              <label><span>{t("from")}</span><input type="date" value={custom.from} max={custom.to} onChange={event => setCustom(current => ({ ...current, from: event.target.value }))} /></label>
              <label><span>{t("to")}</span><input type="date" value={custom.to} min={custom.from} onChange={event => setCustom(current => ({ ...current, to: event.target.value }))} /></label>
              <button type="submit" className={styles.secondary}>{t("apply")}</button>
            </form>
          ) : <span className={styles.periodText}>{periodText(period, intlLocale(locale))}</span>}
        </div>

        {error && <p role="alert" className={styles.error}>{error}</p>}
        {portfolio ? <PortfolioView portfolio={portfolio} /> : !error && <p role="status" className={styles.loading}>{t("loading")}</p>}
      </section>
      {canManageReports && workspaceId && <ReportSchedules key={workspaceId} />}
    </div>
  );
}

/** Local dates in the sites' time zone; "this month" and "this year" end yesterday, the last full day. */
export const presetPeriod = (preset: Exclude<PeriodPreset, "custom">, now = new Date()): { from: string; to: string } => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: SITE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const shift = (date: string, days: number) => {
    const value = new Date(`${date}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
  };
  const monthStart = `${today.slice(0, 7)}-01`;
  const yesterday = shift(today, -1);
  const lastMonthEnd = shift(monthStart, -1);
  if (preset === "lastMonth") return { from: `${lastMonthEnd.slice(0, 7)}-01`, to: lastMonthEnd };
  if (preset === "thisMonth") return { from: monthStart, to: yesterday < monthStart ? today : yesterday };
  if (preset === "last3Months") {
    const start = new Date(`${monthStart}T00:00:00Z`);
    start.setUTCMonth(start.getUTCMonth() - 3);
    return { from: start.toISOString().slice(0, 10), to: lastMonthEnd };
  }
  const yearStart = `${today.slice(0, 4)}-01-01`;
  return { from: yearStart, to: yesterday < yearStart ? today : yesterday };
};

const periodText = (period: { from: string; to: string }, locale: string) => {
  const day = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString(locale, { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
  return period.from === period.to ? day(period.from) : `${day(period.from)} – ${day(period.to)}`;
};
