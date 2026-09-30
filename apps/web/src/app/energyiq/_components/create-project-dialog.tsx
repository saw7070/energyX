"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { configApi } from "../../../lib/config-api";
import { useMessages } from "./energyiq-locale";
import { projectSetupMessages } from "./report-project-setup-messages";
import styles from "./report-workbench.module.css";

export function CreateProjectDialog({ workspaceName, onCreated, onClose }: {
  workspaceName: string; onCreated: (projectId: string) => Promise<void>; onClose: () => void;
}) {
  const t = useMessages(projectSetupMessages);
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const createdId = useRef<string | null>(null);
  const inFlight = useRef(false);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || (!createdId.current && !name.trim())) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      if (!createdId.current) {
        const result = await configApi.createEnergyProject({ name: name.trim(), timezone: "Asia/Singapore" });
        createdId.current = result.project.id;
      }
      await onCreated(createdId.current);
    } catch {
      setError(createdId.current ? t("createdButNotOpened") : t("createFailed"));
    } finally { inFlight.current = false; setBusy(false); }
  }
  return <dialog ref={dialog} aria-label={t("createProject")} className={`${styles.settingsDialog} ${styles.createProjectDialog}`} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className={styles.settingsDialogBar}><strong>{t("createProject")}</strong><button aria-label={t("closeCreate")} disabled={busy} onClick={onClose}>{t("closeX")}</button></div>
    <form onSubmit={submit} className="mx-auto w-full max-w-xl space-y-6 p-6 sm:p-8">
      <div><p className="text-sm font-medium text-primary">{workspaceName}</p><h2 className="mt-2 text-2xl font-semibold">{t("setupHeading")}</h2><p className="mt-3 text-sm leading-6 text-muted">{t("setupIntro")}</p></div>
      <label className="block space-y-2 text-sm font-medium">{t("projectName")}<input autoFocus required maxLength={200} disabled={busy || !!createdId.current} value={name} onChange={event => setName(event.target.value)} placeholder={t("namePlaceholder")} className="w-full rounded-xl border border-border bg-surface-subtle px-4 py-3 text-base outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" /></label>
      <p className="text-sm text-muted">{t("createdIn", { workspace: workspaceName })}</p>
      {error && <p role="alert" className="rounded-lg border border-border p-3 text-sm">{error}</p>}
      <button type="submit" disabled={busy || (!createdId.current && !name.trim())} className="w-full rounded-xl bg-primary px-4 py-3 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50">{busy ? t("opening") : createdId.current ? t("openConversation") : t("createAndContinue")}</button>
    </form>
  </dialog>;
}
