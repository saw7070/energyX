"use client";
import { useState } from "react";
import { configApi, type EnergyOperatingCalendarRevisionDto } from "../../../lib/config-api";
import { CalendarEntryEditor } from "../admin/operational-policy-settings";
import { calendarDraftFromRevision, calendarPublishEntries, createEmptyCalendarEntry, type OperatingCalendarEntryDraft } from "../admin/operational-policy-model";
import type { EnergySelectOption } from "./energy-select";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { operatingHoursMessages } from "./operating-policy-messages";
import styles from "./project-configuration-view.module.css";

/** Saves a new calendar version for review, keeping the school terms of the version being edited. */
export function OperatingCalendarEditor({ projectId, revision, scopeOptions, onSaved, onCancel }: { projectId: string; revision?: EnergyOperatingCalendarRevisionDto; scopeOptions: EnergySelectOption[]; onSaved: () => void; onCancel: () => void }) {
  const [entries, setEntries] = useState<OperatingCalendarEntryDraft[]>(() => revision ? calendarDraftFromRevision(revision) : [createEmptyCalendarEntry("calendar-new-1")]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const t = useMessages(operatingHoursMessages);
  const { locale } = useEnergyIqLocale();
  const save = async () => {
    setError("");
    let input: ReturnType<typeof calendarPublishEntries>;
    try { input = calendarPublishEntries(entries, locale); } catch (reason) { setError(reason instanceof Error ? reason.message : t("editor.incomplete")); return; }
    setSaving(true);
    try { await configApi.publishEnergyOperatingCalendar(projectId, { entries: input, ...(revision ? { academicPeriods: revision.academic_periods ?? [] } : {}) }); onSaved(); }
    catch { setError(t("editor.saveFailed")); }
    finally { setSaving(false); }
  };
  return <div className={styles.calendarEditor}>
    <p className={styles.editorIntro}>{t("editor.intro")}</p>
    {entries.map((entry, index) => <CalendarEntryEditor key={entry.key} entry={entry} index={index} scopeOptions={scopeOptions} removable={entries.length > 1}
      onChange={next => setEntries(current => current.map(candidate => candidate.key === entry.key ? next : candidate))}
      onRemove={() => setEntries(current => current.filter(candidate => candidate.key !== entry.key))} />)}
    {error && <p role="alert" className={styles.editorError}>{error}</p>}
    <div className={styles.editorActions}>
      <button type="button" className={styles.secondaryAction} disabled={saving} onClick={onCancel}>{t("cancel")}</button>
      <button type="button" className={styles.primaryAction} disabled={saving} onClick={() => void save()}>{saving ? t("saving") : t("saveChanges")}</button>
    </div>
  </div>;
}
