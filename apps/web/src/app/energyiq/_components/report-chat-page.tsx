"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { ReportAgentPanel } from "./report-agent-panel";
import { ReportProjectGate } from "./report-project-gate";
import { useMessages } from "./energyiq-locale";
import { libraryMessages } from "./report-library-messages";
/** Shown while the advisor page loads, in the reader's language. */
export function ReportChatLoading() { const t = useMessages(libraryMessages); return <p className="p-6">{t("loadingAdvisor")}</p>; }
export function ReportChatPage() {
  const search = useSearchParams(); const router = useRouter();
  const sessionId = search.get("sessionId");
  return <ReportProjectGate workbench>{(projectId) => <ReportAgentPanel referenceReportId={search.get("reportId") ?? undefined} projectId={projectId} configurationFocus={search.get("focus") ?? ""} initialConfigure={search.get("configure") === "1"} initialSessionId={sessionId ?? "new"} onSessionChange={(id) => router.replace(`/energyiq/reports?${new URLSearchParams({ projectId, sessionId: id })}`, { scroll: false })} />}</ReportProjectGate>;
}