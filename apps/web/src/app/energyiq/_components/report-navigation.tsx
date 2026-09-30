"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { configApi } from "../../../lib/config-api";
import styles from "./report-workbench.module.css";
import { ReportThumbnail } from "./report-thumbnail";
import { shiftDate } from "./report-period";
import { reportFile, type ReportLibrary } from "./report-library";
import { REPORT_SESSIONS_CHANGED } from "./report-session-navigation";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { libraryMessages } from "./report-library-messages";
export const OPEN_REPORT = "energyiq:open-report";
export function ReportNavigation({ projectId, onOpen }: { projectId: string; onOpen: () => void }) {
  const pathname = usePathname();
  const t = useMessages(libraryMessages);
  const { locale } = useEnergyIqLocale();
  const [expanded,setExpanded] = useState(false);
  const [library, setLibrary] = useState<ReportLibrary | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let controller: AbortController;
    const refresh = () => { controller?.abort(); controller = new AbortController(); const signal = controller.signal; configApi.reportLibraryRequest<ReportLibrary>(projectId, "", { signal }).then(data => { if (!signal.aborted) { setLibrary(data); setError(false); } }).catch(() => { if (!signal.aborted) setError(true); }); };
    refresh(); window.addEventListener(REPORT_SESSIONS_CHANGED, refresh);
    return () => { controller.abort(); window.removeEventListener(REPORT_SESSIONS_CHANGED, refresh); };
  }, [projectId]);
  return <section className={styles.sidebarReports} aria-label={t("recentProjectReports")}><header><h2>{t("recentReports")}</h2><Link href={`/energyiq/library?${new URLSearchParams({projectId})}`} onClick={onOpen}>{t("viewAll")}</Link></header>{error ? <p>{t("reportsUnavailable")}</p> : !library ? <p>{t("loadingReports")}</p> : !library.reports.length ? <p>{t("reportsAppearHere")}</p> : library.reports.slice().sort((a,b) => (b.finishedAt || b.createdAt).localeCompare(a.finishedAt || a.createdAt)).slice(0,expanded ? 6 : 2).map(report => <Link key={report.id} className={styles.sidebarReport} title={report.title} aria-label={t("previewNamed", { title: report.title })} href={`/energyiq/library?${new URLSearchParams({projectId,reportId:report.id})}`} onClick={event => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && ["/energyiq/reports","/energyiq/library"].includes(pathname)) { event.preventDefault(); window.dispatchEvent(new CustomEvent(OPEN_REPORT,{detail:{projectId,reportId:report.id}})); } onOpen(); }}><ReportThumbnail file={reportFile(projectId,report,locale)} /><strong>{report.title}</strong><small>{report.period.from} → {shiftDate(report.period.toExclusive,-1)}</small></Link>)}{(library?.reports.length ?? 0)>2 && <button className={styles.moreReports} aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded ? t("showFewer") : t("showMoreReports")}</button>}</section>;
}
