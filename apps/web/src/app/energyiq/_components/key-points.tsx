"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { configApi } from "../../../lib/config-api";
import styles from "./key-points.module.css";
import { operatingHoursWording } from "./hours-wording";
import { formatPeriod, shiftDate } from "./report-period";
import { EnergyIcon } from "./icons";
import { plainNames, plainTimes, SiteReportPanel, useSiteReport } from "./site-report";
import { ReportScheduleNote } from "./report-schedule-note";
import { StoppedMetersNote } from "./meter-health-notice";
import { ForecastLine } from "./forecast-line";
import { LiveNow } from "./live-now";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { intlLocale, type EnergyIqLocale } from "./energyiq-messages";
import { keyPointsMessages } from "./key-points-messages";
import { useEnergyIqAccess } from "./energyiq-access";

/** Two sentences that say nearly the same thing ("used after working hours" / "used outside working hours"). */
const sameText = (left: string, right: string): boolean => {
  const words = (value: string) => new Set(value.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  const a = words(left);
  const b = words(right);
  const shared = [...a].filter((word) => b.has(word)).length;
  const all = new Set([...a, ...b]).size;
  // CJK sentences have no spaces, so compare them whole.
  return all === 0 ? true : all <= 2 ? left.trim() === right.trim() : shared / all >= 0.6;
};

/**
 * Analysis for the same dates as the headline's report. A headline about equipment left on opens step 3,
 * "What stays on after working hours"; anything else opens the short version at the top. Pass the report's topic
 * when known: the headline may be in Chinese or Malay, so the English wording test is only a fallback.
 */
export function analysisHref(projectId: string, period: { from: string; toExclusive: string } | null, headline: string, topic?: string): string {
  const alwaysOn = topic ? topic === "always-on" : /around the clock|always[- ]on|stays? on|left on|after working hours|nobody|never (really )?switch/i.test(headline);
  const section = alwaysOn ? "story-on" : "story-title";
  return `/energyiq/analysis?${new URLSearchParams({ projectId, ...(period ? { from: period.from, to: shiftDate(period.toExclusive, -1) } : {}), section })}`;
}

type Point = {sourceReportId?:string;annualBenefit?:{referenceYear:number;method:string;condition:string;assumptions:string[];money?:{tariffSource:string;taxBasis:"inclusive"|"exclusive"}};question?:string;category?:"saving"|"safety"|"investigation";cause?:string;card?:{issue:string;nextStep:string;benefit:string};actionId:string;issue:string;evidence:string;nextStep:string;benefit:string;assumptions:string;evidenceFrom:string;evidenceToExclusive:string};
type Metrics = {projectName:string;period:{from:string;toExclusive:string};energyKwh:number|null;peakKw:number|null;coverage:number;cost:number|null;currency:string|null;costBasis:string;outsideHoursPercent:number|null};
type SiteNote={id:string;question:string;answer:string;recordedAt:string};
type Source = {reportId:string;category:"scheduled"|"custom";version:number;createdAt:string;finishedAt:string|null;period:{from:string;toExclusive:string};newerDataAvailable:boolean};
type Result = {source?:Source|null;siteNotes?:Record<string,SiteNote[]>;metrics?:Metrics|null;publication:null | {reportId:string;selection:{summary?:string;active:Point[];featuredActionIds:string[];dataEndExclusive:string}};actionStates?:Record<string,string>};
// Compatibility wording for older cards; evidence and saved analysis remain unchanged.
function plainCard(text:string) {
  return operatingHoursWording(text).replace(/retained a measurable evening tail/gi,"used electricity late in the evening")
    .replace(/remained a material persistent load/gi,"had steady recorded electricity use")
    .replace(/The three LED Display channels/gi,"The three LED displays")

    .replace(/Confirm a 20:00 weekday rule for switchable (.+)\./,"Check whether $1 can turn off at 20:00 on weekdays.");
}
function SiteQuestion({projectId,point,notes}:{projectId:string;point:Point;notes:SiteNote[]}) {
  const t=useMessages(keyPointsMessages);
  const {locale}=useEnergyIqLocale();
  const question=point.question?.trim();
  const [answer,setAnswer]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(false),[saved,setSaved]=useState<SiteNote|null>(null);
  const [attempt,setAttempt]=useState<{answer:string;id:string}|null>(null);
  const latest=saved??notes[0];
  async function save(){
    if(!question||!answer.trim()||busy)return;
    const id=attempt?.answer===answer?attempt.id:crypto.randomUUID();setAttempt({answer,id});setBusy(true);setError(false);
    try{const note=await configApi.reportActionRequest<SiteNote>(projectId,`${point.actionId}/site-notes`,{method:"POST",body:JSON.stringify({requestId:id,question,answer:answer.trim()})});setSaved(note);setAnswer("");setAttempt(null);}
    catch{setError(true);}finally{setBusy(false);}
  }
  if(!question)return null;
  return <section className={styles.question} aria-label={t("questionLabel")}>
    <h3 className={styles.questionHeading}>{t("beforeDecide")}</h3>
    <p className={styles.questionText}>{question}</p>
    {latest && <div className={styles.saved}><strong>{t("latestNote")}</strong><p>{latest.answer}</p><span>{new Date(latest.recordedAt).toLocaleDateString(intlLocale(locale))}</span></div>}
    <details className={styles.answer}><summary>{t(latest?"updateAnswer":"answerQuestion")}</summary><p>{t("answerHelps")}</p><label htmlFor={`site-${point.actionId}`}>{t("yourAnswer")}</label><form onSubmit={event=>{event.preventDefault();void save();}}><textarea disabled={busy} id={`site-${point.actionId}`} value={answer} onChange={e=>setAnswer(e.target.value)} maxLength={2000} placeholder={t("placeholder")} rows={2}/><button type="submit" disabled={busy||!answer.trim()}>{t(busy?"saving":latest?"addUpdate":"saveAnswer")}</button></form>
    <p className={styles.note}>{t("teamCanSee")}</p>
    {saved && <p role="status">{t("saved")}</p>}
    {error && <p role="alert">{t("saveFailed")}</p>}
    </details>
  </section>;
}
/** A translated sentence with one placeholder shown in bold, e.g. the report date. */
function withBold(sentence: string, placeholder: string, value: string) {
  const [before, after = ""] = sentence.split(placeholder);
  return <>{before}<strong>{value}</strong>{after}</>;
}
const reportDate = (value: string, locale: EnergyIqLocale = "en") => new Date(value).toLocaleDateString(locale === "en" ? "en-GB" : intlLocale(locale),{timeZone:"Asia/Singapore",day:"numeric",month:"short",year:"numeric"}).replace("Sept","Sep");
export function KeyPoints({projectId}:{projectId:string}) {
  const { activeProject } = useEnergyIqAccess();
  const t=useMessages(keyPointsMessages);
  const {locale}=useEnergyIqLocale();
  const [result,setResult]=useState<Result|null>(null),[error,setError]=useState(false),[retry,setRetry]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();setResult(null);setError(false);
    configApi.reportActionRequest<Result>(projectId,"key-points",{signal:controller.signal})
      .then(value=>{if(!controller.signal.aborted)setResult(value);})
      .catch(()=>{if(!controller.signal.aborted)setError(true);});
    return ()=>controller.abort();
  },[projectId,retry]);
  const publication=result?.publication;
  const points=publication?.selection.featuredActionIds.flatMap(id=>publication.selection.active.filter(p=>p.actionId===id)) ?? [];
  const metrics=result?.metrics;
  const source=result?.source ?? null;
  // The heading and the full report are one report: the saved one for this project, or — until one has been saved —
  // a report built here for the same dates as the priorities.
  const site=useSiteReport(projectId, source ? {from:source.period.from,to:shiftDate(source.period.toExclusive,-1)} : null, !!result && !error);
  const report=site.state && "report" in site.state ? site.state.report : null;
  const saved=site.saved;
  const shownPeriod=saved?.period ?? source?.period ?? null;
  const names=plainNames(report);
  // Everyday names and times if the published summary is shown: "office area lights" instead of "DB1 L1 Light", "8 pm" instead of "20:00".
  const plain=(text:string)=>plainTimes(names(plainCard(text)), locale);
  return <main className={styles.page}>
    <header className={styles.header}><div><h1>{t("title")}</h1><p>{t("subtitle")}</p></div><Link href={`/energyiq/library?projectId=${encodeURIComponent(projectId)}`}>{t("viewReports")}</Link></header>
    {error?<div role="alert" className={styles.empty}><h2>{t("loadFailed")}</h2><button onClick={()=>setRetry(n=>n+1)}>{t("tryAgain")}</button></div>
      :!result?<p role="status">{t("loading")}</p>
      :<>
      <section className={styles.hero}><p className={styles.heroEyebrow}>{metrics?.projectName ?? activeProject?.name ?? t("yourProject")}</p>
        <h2>{report ? <>{report.title.before}<span>{report.title.emphasis}</span></> : site.state && publication?.selection.summary ? plain(publication.selection.summary) : t("fallbackHeadline")}</h2>
        {/* The sentence under the headline only when it adds something: often it is the headline again. */}
        {report?.headline && sameText(report.headline, `${report.title.before}${report.title.emphasis}`) === false ? <p>{report.headline}</p> : null}
        <ForecastLine projectId={projectId} className={styles.heroForecast} />
        <p className={styles.heroLinks}><Link href={analysisHref(projectId, shownPeriod, report?.headline ?? "", report?.headlineTopic)}>{t("seeWhy")}</Link></p></section>
      {/* What the site is drawing right now, for a site with a live connection. */}
      <LiveNow projectId={projectId} className={styles.source} />
      {/* Say which report is on screen — the saved one, by its dates and the day it was written — and how to open it. */}
      {saved ? <div className={styles.source} aria-label={t("sourceLabel")}>
        <EnergyIcon name="document" />
        <p>{withBold(t("fromSavedReport", { period: formatPeriod(saved.period.from, shiftDate(saved.period.toExclusive,-1), locale) }), "{date}", reportDate(saved.generatedAt, locale))}{saved.coverage!=null ? t("coverage", { percent: saved.coverage.toFixed(1) }) : ""}</p>
        <Link href={`/energyiq/library?${new URLSearchParams({projectId,reportId:saved.reportId})}`}>{t("openReport")}</Link>
      </div> : source ? <div className={styles.source} aria-label={t("sourceLabel")}>
        <EnergyIcon name="document" />
        <p>{withBold(t(source.category==="scheduled"?"fromAutomaticReport":"fromReport", { period: formatPeriod(source.period.from, shiftDate(source.period.toExclusive,-1), locale) }), "{date}", reportDate(source.finishedAt ?? source.createdAt, locale))}{metrics ? t("coverage", { percent: (metrics.coverage*100).toFixed(1) }) : ""}</p>
        <Link href={`/energyiq/library?${new URLSearchParams({projectId,reportId:source.reportId})}`}>{t("openReport")}</Link>

      </div> : metrics && <p className={styles.period}>{t("periodCoverage", { period: formatPeriod(metrics.period.from, shiftDate(metrics.period.toExclusive,-1), locale), percent: (metrics.coverage*100).toFixed(1) })}</p>}
      {/* Readings newer than the report on screen, measured against that same report. */}
      {(saved ? site.newerReadings : !!source?.newerDataAvailable) && <p className={styles.newer} role="note">{t(saved ? "newerThanSaved" : "newer")} <Link href={`/energyiq/analysis?${new URLSearchParams({projectId})}`}>{t("seeLatest")}</Link></p>}
      {/* Circuits that went dark: the figures above stop where their readings do. */}
      <StoppedMetersNote projectId={projectId} className={styles.stopped} />
      {/* When the next report arrives by itself, so nobody waits for one that is already scheduled. */}
      <ReportScheduleNote projectId={projectId} className={styles.schedule} />
      </>}
      {/* The saved report itself. Until one exists it is built here, for the same dates as the priorities. */}
      {result && !error && <SiteReportPanel state={site.state} onRetry={site.retry} projectId={projectId} saved={saved} />}
  </main>;
}

/** The answer editor belongs to the action, not the overview. */
export function ActionSiteQuestion({projectId,actionId}:{projectId:string;actionId:string}) {
  const [result,setResult]=useState<Result|null>(null);
  useEffect(()=>{const controller=new AbortController();setResult(null);
    configApi.reportActionRequest<Result>(projectId,"key-points",{signal:controller.signal})
      .then(value=>{if(!controller.signal.aborted)setResult(value);}).catch(()=>{});
    return ()=>controller.abort();
  },[projectId,actionId]);
  const point=result?.publication?.selection.active.find(p=>p.actionId===actionId);
  return point?.question ? <SiteQuestion key={`${projectId}:${actionId}`} projectId={projectId} point={point} notes={result?.siteNotes?.[actionId]??[]}/> : null;
}
