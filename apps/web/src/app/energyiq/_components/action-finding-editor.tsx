"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { configApi } from "../../../lib/config-api";
import { EnergySelect } from "./energy-select";
import styles from "./project-actions.module.css";
import { useMessages } from "./energyiq-locale";
import { findingEditorMessages } from "./project-actions-messages";

export function ActionFindingEditor({ projectId, action, findings, onSaved, onCancel }: {
  projectId: string;
  action: { id: string; title: string; sourceReportId: string };
  findings: Array<{ id: string; title: string; summary: string }>;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const t = useMessages(findingEditorMessages);
  const [existingId, setExistingId] = useState("");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [quote, setQuote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => { formRef.current?.scrollIntoView?.({ block: "nearest" }); formRef.current?.querySelector<HTMLInputElement>("input")?.focus(); }, []);
  return <form ref={formRef} className={`${styles.editor} ${styles.findingEditor}`} aria-label={t("label")} onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError(false);
    try {
      await configApi.reportActionRequest(projectId, "insights", { method: "POST", body: JSON.stringify({ actionId: action.id, title, summary, sourceQuote: quote, ...(existingId ? { existingInsightId: existingId } : {}) }) });
      onSaved();
    } catch { setError(true); }
    finally { setBusy(false); }
  }}>
    <h2>{t("title")}</h2>
    <p>{action.title}</p>
    <Link target="_blank" rel="noreferrer" href={`/energyiq/library?projectId=${encodeURIComponent(projectId)}&reportId=${encodeURIComponent(action.sourceReportId)}`}>{t("readSource")}</Link>
    <EnergySelect ariaLabel={t("finding")} value={existingId} options={[{ value: "", label: t("addFromReport") }, ...findings.map(f => ({value: f.id, label: f.title}))]} onValueChange={value => {
      setExistingId(value); const match = findings.find(f => f.id === value); setTitle(match?.title ?? ""); setSummary(match?.summary ?? "");
    }} />
    <label>{t("findingTitle")}<input required maxLength={160} value={title} readOnly={!!existingId} onChange={e => setTitle(e.target.value)} /></label>
    <label>{t("whatFound")}<textarea required minLength={12} maxLength={1200} value={summary} readOnly={!!existingId} onChange={e => setSummary(e.target.value)} /></label>
    <label>{t("supportingWords")}<textarea required minLength={12} maxLength={600} value={quote} onChange={e => setQuote(e.target.value)} /></label>
    {error && <p role="alert">{t("saveFailed")}</p>}
    <div className={styles.filters}><button className={styles.primaryButton} disabled={busy}>{t("link")}</button><button type="button" disabled={busy} onClick={onCancel}>{t("cancel")}</button></div>
  </form>;
}
