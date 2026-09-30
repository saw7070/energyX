"use client";
import Link from "next/link";
import { useEffect, useState, type MouseEvent } from "react";
import { configApi } from "../../../lib/config-api";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { dateLocale, libraryMessages } from "./report-library-messages";
export const REPORT_SESSIONS_CHANGED = "energyiq:report-sessions-changed";
export function notifyReportSessionsChanged(projectId: string) { window.dispatchEvent(new CustomEvent(REPORT_SESSIONS_CHANGED, { detail: { projectId } })); }
type Session = { id: string; createdAt: string };
type Index = { sessions: Session[]; runs: Array<{ sessionId?: string; prompt: string; createdAt: string }> };
export function ReportSessionNavigation({ projectId, currentSessionId, onNavigate }: { projectId: string; currentSessionId: string | null; onNavigate?: (event: MouseEvent<HTMLAnchorElement>, href: string) => void }) {
  const t = useMessages(libraryMessages);
  const { locale } = useEnergyIqLocale();
  const [index, setIndex] = useState<Index | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let controller: AbortController | undefined;
    const refresh = async () => {
      controller?.abort(); const requestController = new AbortController(); controller = requestController;
      try { const result = await configApi.reportAgentRequest<Index>(projectId, "", { signal: requestController.signal }); if (!requestController.signal.aborted) { setIndex(result); setError(false); } }
      catch { if (!requestController.signal.aborted) setError(true); }
    };
    const onChanged = (event: Event) => { if ((event as CustomEvent<{ projectId: string }>).detail?.projectId === projectId) void refresh(); };
    void refresh(); window.addEventListener(REPORT_SESSIONS_CHANGED, onChanged);
    return () => { controller?.abort(); window.removeEventListener(REPORT_SESSIONS_CHANGED, onChanged); };
  }, [projectId]);
  const href = (sessionId: string) => `/energyiq/reports?${new URLSearchParams({ projectId, sessionId })}`;
  return <section aria-label={t("projectConversations")} className="px-1">

    {error ? <p className="px-3 py-2 text-xs text-muted">{t("conversationsUnavailable")}</p> : !index ? <p className="px-3 py-2 text-xs text-muted">{t("loadingConversations")}</p> : !index.sessions?.length ? <p className="px-3 py-2 text-xs text-muted">{t("noConversations")}</p> : <ul className="mt-2 space-y-1">{index.sessions.map((session) => {
      const firstRun = index.runs.filter((run) => run.sessionId === session.id).sort((a,b) => a.createdAt.localeCompare(b.createdAt))[0];
      const title = firstRun?.prompt ?? t("newConversation");
      return <li key={session.id}><Link href={href(session.id)} onClick={(event) => onNavigate?.(event, href(session.id))} aria-current={session.id === currentSessionId ? "page" : undefined} className={`block rounded-lg px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-primary/20 ${session.id === currentSessionId ? "bg-surface-subtle text-foreground" : "text-muted hover:bg-surface-subtle"}`}><span className="block truncate" title={title}>{title}</span><span className="block text-xs text-muted">{new Date(session.createdAt).toLocaleString(dateLocale(locale), { timeZone: "Asia/Singapore", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: true })} SGT</span></Link></li>;
    })}</ul>}
  </section>;
}