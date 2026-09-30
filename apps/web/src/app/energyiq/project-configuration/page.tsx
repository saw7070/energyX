"use client";
import { Suspense, useEffect, useState } from "react";
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

function ProjectPage({ projectId }: { projectId: string }) {
  const { access } = useEnergyIqAccess();
  const project = access?.projects.find(p => p.id === projectId);
  return (project?.capabilities?.editConfiguration ?? access?.role === "admin") ? <Configuration projectId={projectId} canPublish={project?.capabilities?.publishConfiguration ?? access?.role === "admin"} /> : <PublishedProjectInformation projectId={projectId} />;
}
const TABS = new Set(["structure", "devices", "context", "policies", "holidays", "tariff"]);
function Configuration({ projectId, canPublish }: { projectId: string; canPublish: boolean }) {
  const t = useMessages(facilityPageMessages);
  const router = useRouter();
  const requestedTab = useSearchParams().get("tab");
  const initialTab = requestedTab && TABS.has(requestedTab) ? requestedTab : undefined;
  const [data, setData] = useState<{ setup: EnergyProjectSetupDto; notes: string; policies: EnergyOperationalPolicyConfigurationDto | null } | null>(null);
  // A flag rather than the message, so the text follows a language change.
  const [failed, setFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  // Clear only when switching projects; a refresh keeps the current tab and message on screen.
  useEffect(() => { setData(null); }, [projectId]);
  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    Promise.all([
      configApi.getEnergyProjectSetup(projectId),
      configApi.reportAgentRequest<{ settings: { contextNotes: string } }>(projectId, ""),
      configApi.getEnergyOperationalPolicies(projectId).catch(() => null),
    ]).then(([setup, report, policies]) => { if (!cancelled) setData({ setup, notes: report.settings.contextNotes, policies }); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [projectId, refresh]);
  return <section className="space-y-6">
    <header className={styles.pageHeader}>
      <div className={styles.pageHeading}><h1>{t("title")}</h1><p>{t(canPublish ? "introPublish" : "introReview")}</p></div>
      <div className={styles.toolbar}>
        <ReportSettingsButton projectId={projectId} mode="project" onClose={()=>setRefresh(value=>value+1)} /><button onClick={() => setRefresh(value => value + 1)}>{t("refresh")}</button>
        <Link className={`${styles.advisorAction} focus-visible:ring-2 focus-visible:ring-primary`} href={`/energyiq/reports?${new URLSearchParams({ projectId, sessionId: "new", configure: "1" })}`}><EnergyIcon name="ask" aria-hidden="true" />{t("editWithAdvisor")}</Link>
      </div>
    </header>
    {failed ? <p role="alert">{t("loadFailed")}</p> : !data ? <p role="status">{t("loading")}</p> : <>
      <ProjectConfigurationView initialTab={initialTab} onTabChange={(tab, extra) => router.replace(`/energyiq/project-configuration?${new URLSearchParams({ projectId, tab, ...extra })}`, { scroll: false })} onPolicyChange={() => setRefresh(value => value + 1)} projectId={projectId} canEditPolicies={canPublish} canEditSetup setup={data.setup} notes={data.notes} policies={data.policies} />
    </>}
  </section>;
}
function LoadingProject() { const t = useMessages(facilityPageMessages); return <p className="p-6">{t("loadingProject")}</p>; }
export default function Page() { return <Suspense fallback={<LoadingProject />}><ReportProjectGate fullWidth>{projectId => <ProjectPage projectId={projectId} />}</ReportProjectGate></Suspense>; }
