"use client";
import { useEnergyIqAccess } from "./energyiq-access";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import styles from "./report-workbench.module.css";
import { useMessages } from "./energyiq-locale";
import { libraryMessages } from "./report-library-messages";
function SettingsLoading() { const t = useMessages(libraryMessages); return <p>{t("loadingSettings")}</p>; }
const Panel = dynamic(() => import("./report-agent-panel").then(module => module.ReportAgentPanel), { loading: () => <SettingsLoading /> });
export function ReportSettingsButton({ projectId, mode, onClose }: { projectId: string; mode: "project" | "automation"; onClose?: () => void }) {
  const t = useMessages(libraryMessages);
  const [open, setOpen] = useState(false);
  const { access } = useEnergyIqAccess();
  const project = access?.projects.find(p => p.id === projectId);
  const allowed = project?.capabilities?.[mode === "automation" ? "manageAutomation" : "editConfiguration"] ?? access?.role === "admin";
  const label = mode === "project" ? t("projectBackground") : t("automaticReports");
  if (!allowed) return null;
  return <><button className="rounded-lg border border-border px-4 py-2 text-sm" onClick={() => setOpen(true)}>{label}</button>{open && <SettingsDialog label={label} close={() => { setOpen(false); onClose?.(); }}><Panel projectId={projectId} settingsMode={mode} sidebarNavigation /></SettingsDialog>}</>;
}
function SettingsDialog({ label, close, children }: { label: string; close: () => void; children: React.ReactNode }) {
  const t = useMessages(libraryMessages);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const opener = document.activeElement as HTMLElement; ref.current?.showModal(); return () => { if (opener?.isConnected) opener.focus(); }; }, []);
  return <dialog ref={ref} aria-label={label} className={styles.settingsDialog} onCancel={event => { event.preventDefault(); close(); }}><div className={styles.settingsDialogBar}><span>{label}</span><button aria-label={t("closeSettings")} onClick={close}>{t("closeX")}</button></div>{children}</dialog>;
}
