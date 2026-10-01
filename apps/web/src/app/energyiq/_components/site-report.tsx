"use client";
/**
 * The site energy report on the Overview: finding the saved report, the panel around it, and the download.
 *
 * The Overview shows the report the server saved on the schedule, rebuilt from the readings kept with it so it reads
 * in the reader's own language. Only a site that has never had one saved falls back to building a report here.
 *
 * The report itself — its charts, tables and the standalone HTML file — lives in @datafoundry/site-report, so the
 * server can save the same document on a schedule. This file keeps the page's side of it: the hook that loads the
 * readings, the panel chrome, and the plain-wording helpers the Overview cards use. Everything the rest of the app
 * imported from here is still exported from here.
 */
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { readProjectSpatialReference, type ProjectSpatialReference } from "@datafoundry/contracts";
import { parseSiteReportSnapshot, type SiteReportCadence } from "@datafoundry/site-report";
import { renderSiteReportHtml, siteReportFileName, SiteReportDocument } from "@datafoundry/site-report/site-report-document";
import { configApi } from "../../../lib/config-api";
import { loadAnalysis, type AnalysisData } from "./analysis-data";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { intlLocale, translatorFor, type EnergyIqLocale } from "./energyiq-messages";
import { buildSiteReport, clock, type SiteReport } from "./site-report-model";
import { siteReportMessages } from "./site-report-messages";
import { REPORT_CSS } from "./site-report-styles";
import styles from "./key-points.module.css";

export { monotonePath, niceTicks, renderSiteReportHtml, Rich, siteReportFileName, SiteReportDocument } from "@datafoundry/site-report/site-report-document";

/** The document's wording follows the language its sentences were written in, so a downloaded copy never mixes languages. */
const reportText = (locale: EnergyIqLocale) => translatorFor(siteReportMessages, locale);

/** The day a report was written, as people write dates: "22 Sep 2026" in English and Malay, "2026年9月22日" in Chinese. */
const writtenOn = (value: string, locale: EnergyIqLocale) =>
  new Date(value).toLocaleDateString(locale === "en" ? "en-GB" : intlLocale(locale), { timeZone: "Asia/Singapore", day: "numeric", month: "short", year: "numeric" }).replace("Sept", "Sep");

/**
 * A standalone copy of the report. Kept for the callers that still hand over the rendered element; the file is now
 * rendered from the report alone, exactly as the server renders it, so the element is no longer read.
 * @deprecated call renderSiteReportHtml(report) instead.
 */
export const standaloneReportHtml = (_article: HTMLElement, report: SiteReport) => renderSiteReportHtml(report);

type Period = { from: string; to: string } | null;
/** Why a report could not be prepared, in words the reader can act on. */
export type ReportProblem = { title: string; steps: string[]; fixTab?: string };
export type SiteReportState = { report: SiteReport } | { error: ReportProblem } | null;
/**
 * The saved report the Overview is showing: which one it is, the dates it covers, when the server wrote it and how
 * much of the readings it had. Absent when no report has been saved yet and the page had to build one itself.
 */
export type SavedSiteReport = { reportId: string; cadence: SiteReportCadence; period: { from: string; toExclusive: string }; generatedAt: string; coverage: number | null };
type Readings = { data: AnalysisData; reference: ProjectSpatialReference | null; generatedAt: string; saved: SavedSiteReport | null; dataToExclusive: string | null };
type Loaded = Readings | { error: ReportProblem } | null;
/** One report as the Reports library lists it; site reports are the ones the server writes on the schedule. */
type LibraryReport = { id: string; source?: "site" | "advisor"; cadence?: SiteReportCadence };

/**
 * The newest saved site report for the cadence this project's Overview shows, with the readings it was built from.
 * Returns null when nothing has been saved yet, so the page can fall back to building one itself.
 */
async function loadSavedSiteReport(projectId: string): Promise<Readings | null> {
  const library = await configApi.reportLibraryRequest<{ reports?: LibraryReport[]; overviewCadence?: SiteReportCadence }>(projectId);
  const reports = library.reports ?? [];
  // The list is newest first. The project's own cadence wins; any saved site report still beats building one here.
  const chosen = reports.find(item => item.source === "site" && item.cadence === (library.overviewCadence === "weekly" ? "weekly" : "monthly"))
    ?? reports.find(item => item.source === "site");
  if (!chosen) return null;
  const [saved, dates] = await Promise.all([
    configApi.reportLibraryRequest<{ snapshot: unknown }>(projectId, `snapshot/${encodeURIComponent(chosen.id)}`),
    // How far the readings now run, so the page can say when a report has been overtaken by newer readings.
    configApi.reportAgentRequest<{ periodOptions?: { availablePeriod: { toExclusive?: string } | null } }>(projectId, "")
      .then(result => result.periodOptions?.availablePeriod?.toExclusive ?? null).catch(() => null),
  ]);
  const snapshot = parseSiteReportSnapshot(saved.snapshot);
  return { data: snapshot.data, reference: snapshot.reference, generatedAt: snapshot.generatedAt, dataToExclusive: dates,
    saved: { reportId: chosen.id, cadence: snapshot.cadence, period: snapshot.period, generatedAt: snapshot.generatedAt, coverage: snapshot.data.current.project.coverage } };
}
/**
 * Turns an engine error into something a reader can act on. The engine reports the location by id, so the project's
 * own location names are fetched to name it; without them the id is still better than silence.
 */
export async function describeProblem(reason: unknown, projectId: string, locale: EnergyIqLocale = "en"): Promise<ReportProblem> {
  return reportProblem(reason, projectId, reportText(locale));
}

async function reportProblem(reason: unknown, projectId: string, t: ReturnType<typeof reportText>): Promise<ReportProblem> {
  const message = reason instanceof Error ? reason.message : String(reason ?? "");
  const scopeOf = async (raw: string | undefined) => {
    if (!raw) return "";
    const information = await configApi.getEnergyProjectInformation<{ locations?: Array<{ id: string; name: string }> }>(projectId).catch(() => null);
    return information?.locations?.find(location => location.id === raw)?.name ?? raw;
  };
  const route = /ENERGYIQ_PUBLISHED_METER_ROUTE_REQUIRED:([^:]+)/.exec(message);
  if (route) {
    const place = await scopeOf(route[1]);
    return { title: t("problem.noMeter", { place }), steps: [t("problem.noMeterStep1", { place }), t("problem.noMeterStep2"), t("problem.noMeterStep3")], fixTab: "structure" };
  }
  const duplicate = /ENERGYIQ_PUBLISHED_METER_ROUTE_DUPLICATE:([^:]+)/.exec(message);
  if (duplicate) {
    const place = await scopeOf(duplicate[1]);
    return { title: t("problem.twoTotals", { place }), steps: [t("problem.twoTotalsStep1", { place }), t("problem.twoTotalsStep2")], fixTab: "structure" };
  }
  if (/PUBLICATION_RECOVERY_REQUIRED/.test(message)) return { title: t("problem.interrupted"), steps: [t("problem.interruptedStep1"), t("problem.interruptedStep2")], fixTab: "structure" };
  if (/FORBIDDEN|ADMIN_REQUIRED/.test(message)) return { title: t("problem.forbidden"), steps: [t("problem.forbiddenStep")] };
  if (/SNAPSHOT|DATA_NOT_READY|NOT_READY/.test(message)) return { title: t("problem.noReadings"), steps: [t("problem.noReadingsStep")] };
  return { title: t("problem.unexpected"), steps: [t("problem.unexpectedStep")] };
}

/**
 * The report the Overview shows, with everything the page needs to describe it. The newest saved report for this
 * project's cadence comes first; `period` only chooses the dates of the report built on the spot when nothing has
 * been saved yet. The Overview uses one result for both its heading and the full document, so the two never
 * disagree. The report is written in the reader's language; switching language rewrites it from the same readings
 * without loading them again.
 */
export function useSiteReport(projectId: string, period: Period, enabled = true) {
  const { locale } = useEnergyIqLocale();
  const t = useMessages(siteReportMessages);
  const [loaded, setLoaded] = useState<Loaded>(null);
  const [retry, setRetry] = useState(0);
  const from = period?.from, to = period?.to;
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoaded(null);
    // The saved report comes first: it is the one in Reports, and everyone opening the page sees the same one.
    loadSavedSiteReport(projectId).catch(() => null).then(saved => {
      if (cancelled) return;
      if (saved) { setLoaded(saved); return null; }
      return Promise.all([
        loadAnalysis(projectId, from && to ? { kind: "custom", from, to } : { kind: "latest-28" }),
        // Project notes hold the floor layout; without them the report shows a zone table instead of the map.
        configApi.reportAgentRequest<{ contextNotes: string }>(projectId, "context").then(result => result.contextNotes ?? "").catch(() => ""),
      ]).then(([data, notes]) => {
        if (cancelled) return;
        if (!data.current.project.dates.length || !data.current.project.total) { setLoaded({ error: { title: t("problem.noReadings"), steps: [t("problem.noReadingsStep")] } }); return; }
        setLoaded({ data, reference: readProjectSpatialReference(notes, projectId)?.reference ?? null, generatedAt: new Date().toISOString(), saved: null, dataToExclusive: null });
      });
    }).catch(async reason => {
      if (cancelled) return;
      setLoaded({ error: await reportProblem(reason, projectId, t) });
    });
    return () => { cancelled = true; };
  }, [projectId, from, to, retry, enabled]);
  const state = useMemo<SiteReportState>(() => {
    if (!loaded || "error" in loaded) return loaded;
    try { return { report: buildSiteReport(loaded.data, loaded.reference, loaded.generatedAt, locale) }; } catch { return { error: { title: t("problem.unexpected"), steps: [t("problem.unexpectedStep")] } }; }
  }, [loaded, locale]);
  // The heading and the document are the same report, so what is said about one is true of the other.
  const shown = loaded && !("error" in loaded) && state && "report" in state ? loaded : null;
  return {
    state, saved: shown?.saved ?? null,
    /** Readings have arrived for days the saved report does not cover, so it no longer shows the whole picture. */
    newerReadings: !!shown?.saved && !!shown.dataToExclusive && shown.dataToExclusive > shown.saved.period.toExclusive,
    retry: () => setRetry(value => value + 1),
  };
}

/** The report as shown on the Overview, with a download of the same page as one HTML file. */
export function SiteReportPanel({ state, onRetry, projectId, saved }: { state: SiteReportState; onRetry: () => void; projectId?: string; saved?: SavedSiteReport | null }) {
  const t = useMessages(siteReportMessages);
  const { locale } = useEnergyIqLocale();
  const report = state && "report" in state ? state.report : null;
  // The file is rendered from the report, not from what is on screen, so a saved copy is the same document wherever
  // it was made — on this page, or by the server on a schedule.
  const download = () => {
    if (!report) return;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([renderSiteReportHtml(report)], { type: "text/html" }));
    link.download = siteReportFileName(report);
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };
  return <section className={styles.fullReport} aria-label={t("panel.aria")}>
    <style>{REPORT_CSS}</style>
    <header>
      <div><h2>{t("panel.title")}</h2><p>{report ? t("panel.summaryPeriod", { period: report.masthead.period }) : t("panel.summary")}</p>
        {/* Which report this is: the saved one everybody can open again, or one built here because none exists yet. */}
        <p className={styles.reportNotSaved}>{saved ? t("panel.savedNote", { date: writtenOn(saved.generatedAt, locale) }) : t("panel.liveNote")}</p></div>
      <div className={styles.reportActions}>
        <button type="button" onClick={download} disabled={!report}>{t("panel.download")}</button>
      </div>
    </header>
    {state && "error" in state ? <div role="alert" className={styles.reportProblem}>
        <h3>{state.error.title}</h3>
        <ol>{state.error.steps.map(step => <li key={step}>{step}</li>)}</ol>
        <p>{state.error.fixTab && projectId ? <Link href={`/energyiq/project-configuration?${new URLSearchParams({ projectId, tab: state.error.fixTab })}`}>{t("problem.openFacility")}</Link> : null}<button type="button" onClick={onRetry}>{t("panel.retry")}</button></p>
      </div>
      : !report ? <p role="status" className={styles.reportMessage}>{t("panel.loading")}</p>
      : <div><SiteReportDocument report={report} /></div>}
  </section>;
}

/** "20:00" → "8 pm", as people say it; Chinese "晚上8点", Malay "8 malam". */
export const plainTimes = (text: string, locale: EnergyIqLocale = "en") => {
  const spoken = text.replace(/\b([01]?\d|2[0-3]):00\b/g, (_match, hour: string) => clock(Number(hour), locale));
  return locale === "en" ? spoken.replace(/\b([Aa]) (8|11) (am|pm)\b/g, "$1n $2 $3") : spoken;
};

/**
 * Swaps panel codes ("DB1 L1 Light") in other text for the report's plain names ("office area lights"). The names are
 * in the report's language; only English lowers them inside a sentence.
 */
export function plainNames(report: SiteReport | null, locale: EnergyIqLocale = report?.locale ?? "en") {
  // Grouped channels ("LED Display 1–3") are left alone when named one by one, so a single display is never renamed as three.
  const pairs = (report?.circuits ?? []).flatMap(circuit => circuit.meterIds.length === 1 ? [[circuit.code, circuit.name] as const] : [])
    .filter(([code, name]) => code && code !== name).sort((a, b) => b[0].length - a[0].length);
  if (!pairs.length) return (text: string) => text;
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\b(${pairs.map(([code]) => escape(code)).join("|")})\\b`, "g");
  const byCode = new Map(pairs);
  return (text: string) => text.replace(pattern, (code, _match, offset: number, whole: string) => {
    const name = byCode.get(code)!;
    const sentenceStart = offset === 0 || /[.!?:]\s*$/.test(whole.slice(0, offset));
    return locale !== "en" || sentenceStart || !/^[A-Z][a-z]/.test(name) ? name : name.charAt(0).toLowerCase() + name.slice(1);
  });
}
