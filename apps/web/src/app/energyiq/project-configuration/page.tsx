"use client";
import { Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { configApi, type EnergyOperationalPolicyConfigurationDto, type EnergyProjectSetupDto } from "../../../lib/config-api";
import { PublishedProjectInformation } from "../_components/project-information";
import { useEnergyIqAccess } from "../_components/energyiq-access";
import { ReportProjectGate } from "../_components/report-project-gate";
import { ReportSettingsButton } from "../_components/report-settings-dialog";
import { ProjectConfigurationView } from "../_components/project-configuration-view";
import { useMessages } from "../_components/energyiq-locale";
import { facilityPageMessages } from "../_components/facility-messages";
import { EnergyIcon } from "../_components/icons";
import styles from "../_components/project-configuration-view.module.css";
import { SmartImportPanel } from "../admin/smart-import-panel";
import { LiveConnectionPanel } from "../_components/live-connection-panel";

function ProjectPage({ projectId }: { projectId: string }) {
  const { access } = useEnergyIqAccess();
  const project = access?.projects.find(p => p.id === projectId);
  return (project?.capabilities?.editConfiguration ?? access?.role === "admin") ? <Configuration projectId={projectId} canPublish={project?.capabilities?.publishConfiguration ?? access?.role === "admin"} /> : <PublishedProjectInformation projectId={projectId} />;
}
const TABS = new Set(["structure", "devices", "availability", "context", "policies", "holidays", "tariff"]);
function Configuration({ projectId, canPublish }: { projectId: string; canPublish: boolean }) {
  const t = useMessages(facilityPageMessages);
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const initialTab = requestedTab && TABS.has(requestedTab) ? requestedTab : undefined;
  const [data, setData] = useState<{ setup: EnergyProjectSetupDto; notes: string; policies: EnergyOperationalPolicyConfigurationDto | null } | null>(null);
  // A flag rather than the message, so the text follows a language change.
  const [failed, setFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [uploading, setUploading] = useState(false);
  // The bell's "daily update didn't finish" alert opens the Live connection straight away.
  const [connecting, setConnecting] = useState(() => searchParams.get("connection") === "live");
  // Clear only when switching projects; a refresh keeps the current tab and message on screen.
  useEffect(() => { setData(null); }, [projectId]);
  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    Promise.all([
      configApi.getEnergyProjectSetup(projectId),
      // Only the notes are shown here; the full advisor state (history, files, skills) is much slower to build.
      configApi.reportAgentRequest<{ contextNotes: string }>(projectId, "context"),
      configApi.getEnergyOperationalPolicies(projectId).catch(() => null),
    ]).then(([setup, report, policies]) => { if (!cancelled) setData({ setup, notes: report.contextNotes, policies }); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [projectId, refresh]);
  return <section className="space-y-6">
    <header className={styles.pageHeader}>
      <div className={styles.pageHeading}><h1>{t("title")}</h1><p>{t(canPublish ? "introPublish" : "introReview")}</p></div>
      <div className={styles.toolbar}>
        {canPublish && <button onClick={() => setUploading(true)}><EnergyIcon name="attach" aria-hidden="true" />{t("uploadData")}</button>}
        {canPublish && <button onClick={() => setConnecting(true)}><EnergyIcon name="bolt" aria-hidden="true" />{t("liveConnection")}</button>}
        <ReportSettingsButton projectId={projectId} mode="project" onClose={()=>setRefresh(value=>value+1)} /><button onClick={() => setRefresh(value => value + 1)}>{t("refresh")}</button>
        <Link className={`${styles.advisorAction} focus-visible:ring-2 focus-visible:ring-primary`} href={`/energyiq/reports?${new URLSearchParams({ projectId, sessionId: "new", configure: "1" })}`}><EnergyIcon name="ask" aria-hidden="true" />{t("editWithAdvisor")}</Link>
      </div>
    </header>
    {uploading && <FacilityDialog id="upload-data" title={t("uploadTitle")} intro={t("uploadIntro")} onClose={() => setUploading(false)}><SmartImportPanel projectId={projectId} onChanged={() => setRefresh(value => value + 1)} /></FacilityDialog>}
    {connecting && <FacilityDialog id="live-connection" title={t("liveTitle")} intro={t("liveIntro")} onClose={() => setConnecting(false)}><LiveConnectionPanel projectId={projectId} onChanged={() => setRefresh(value => value + 1)} /></FacilityDialog>}
    {failed ? <p role="alert">{t("loadFailed")}</p> : !data ? <p role="status">{t("loading")}</p> : <>
      <ProjectConfigurationView initialTab={initialTab} onTabChange={(tab, extra) => router.replace(`/energyiq/project-configuration?${new URLSearchParams({ projectId, tab, ...extra })}`, { scroll: false })} onPolicyChange={() => setRefresh(value => value + 1)} projectId={projectId} canEditPolicies={canPublish} canEditSetup setup={data.setup} notes={data.notes} policies={data.policies} />
    </>}
  </section>;
}
function FacilityDialog({ id, title, intro, onClose, children }: { id: string; title: string; intro: string; onClose: () => void; children: ReactNode }) {
  const t = useMessages(facilityPageMessages);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog
    ref={dialog}
    aria-labelledby={`${id}-title`}
    className="m-auto max-h-[calc(100dvh-48px)] w-[min(960px,calc(100vw-32px))] overflow-y-auto rounded-2xl border border-border bg-surface-subtle p-0 shadow-2xl backdrop:bg-black/40"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => {
      // A click on the dimmed backdrop lands on the dialog itself, outside its box.
      if (event.target !== dialog.current) return;
      const box = dialog.current.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose();
    }}
  >
    <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-border bg-surface px-6 py-4">
      <div><h2 id={`${id}-title`} className="text-lg font-semibold">{title}</h2><p className="mt-1 text-xs text-muted">{intro}</p></div>
      <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-surface-subtle">{t("close")}</button>
    </header>
    <div className="p-6">{children}</div>
  </dialog>;
}
function LoadingProject() { const t = useMessages(facilityPageMessages); return <p className="p-6">{t("loadingProject")}</p>; }
export default function Page() { return <Suspense fallback={<LoadingProject />}><ReportProjectGate fullWidth>{projectId => <ProjectPage projectId={projectId} />}</ReportProjectGate></Suspense>; }
