"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { dateWithDayYear } from "@datafoundry/site-report";
import { configApi } from "../../../lib/config-api";
import { ConfirmDialog } from "./confirm-dialog";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { friendlyErrorMessage } from "./friendly-error";
import { EnergyIcon } from "./icons";
import {
  affectedParts, changeInput, changeProblems, draftFor, latestStart, localToday, MAX_NAME_LENGTH, MAX_NOTE_LENGTH, pickerFrom,
  type ChangeDraft, type ChangeProblem, type Picker, type PickerMeter, type SiteChangeDto, type SiteChangeInformation, type SiteChangeInput, type SiteChangesDto,
} from "./site-changes-model";
import { siteSavingsMessages } from "./site-savings-messages";
import styles from "./site-savings.module.css";

/**
 * Facility → Savings: the changes made on site (smart lighting, new LED fittings, a timer moved), each with the date
 * it starts and what it affects. Analysis shows each one's before and after; this page only keeps the list. Anyone
 * who may change the Facility page may record, edit or remove a change; everyone else sees the list.
 */
export function SiteSavings({ projectId }: { projectId: string }) {
  const t = useMessages(siteSavingsMessages);
  const [data, setData] = useState<SiteChangesDto | null>(null);
  const [picker, setPicker] = useState<Picker>({ groups: [], ungrouped: [] });
  const [today, setToday] = useState(() => localToday());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all([
      configApi.listEnergySavingsChecks(projectId),
      configApi.getEnergyProjectInformation<SiteChangeInformation & { timezone?: string }>(projectId).catch(() => null),
    ]).then(([changes, information]) => {
      if (!live) return;
      setPicker(pickerFrom(information));
      if (information?.timezone) setToday(localToday(information.timezone));
      setError(null);
      setData(changes);
    }).catch(reason => { if (live) setError(friendlyErrorMessage(reason, { fallback: t("loadFailed") })); });
    return () => { live = false; };
  }, [projectId, t]);

  const run = async (action: () => Promise<SiteChangesDto>, done: string, failed: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setData(await action());
      setNotice(done);
      return true;
    } catch (reason) {
      setError(friendlyErrorMessage(reason, { fallback: failed }));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const save = (input: SiteChangeInput, id?: string) => run(() => id ? configApi.updateEnergySavingsCheck(projectId, id, input) : configApi.createEnergySavingsCheck(projectId, input), t("saved"), t("saveFailed"));
  const remove = (id: string) => run(() => configApi.deleteEnergySavingsCheck(projectId, id), t("removed"), t("removeFailed"));

  if (!data) return <section className={styles.panel}>{error ? <p role="alert" className={styles.error}>{error}</p> : <p role="status" className={styles.quiet}>{t("loading")}</p>}</section>;
  return <SiteSavingsView projectId={projectId} data={data} picker={picker} today={today} busy={busy} error={error} notice={notice} onSave={save} onRemove={remove} />;
}

export function SiteSavingsView({ projectId, data, picker, today, busy, error, notice, onSave, onRemove }: {
  projectId: string;
  data: SiteChangesDto;
  picker: Picker;
  today: string;
  busy: boolean;
  error: string | null;
  notice?: string | null;
  onSave: (input: SiteChangeInput, id?: string) => Promise<boolean>;
  onRemove: (id: string) => Promise<boolean>;
}) {
  const t = useMessages(siteSavingsMessages);
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<SiteChangeDto | null>(null);
  const canEdit = data.canEdit;
  return (
    <section className={styles.panel} aria-label={t("title")}>
      <header className={styles.header}>
        <div>
          <h3>{t("title")}</h3>
          <p>{t("intro")}</p>
        </div>
        {canEdit && editing === null && <button type="button" className={styles.primary} onClick={() => setEditing("new")}><EnergyIcon name="plus" className="h-4 w-4" />{t("addButton")}</button>}
      </header>
      {error && <p role="alert" className={styles.error}><EnergyIcon name="alert" className="h-4 w-4" />{error}</p>}
      {notice && !error && <p role="status" className={styles.quiet}>{notice}</p>}
      {canEdit && editing === "new" && <ChangeForm title={t("addTitle")} initial={draftFor(null, today)} picker={picker} today={today} busy={busy}
        onCancel={() => setEditing(null)} onSave={async input => { if (await onSave(input)) setEditing(null); }} />}
      {data.checks.length === 0 && editing !== "new" && <p className={styles.empty}>{canEdit ? t("empty") : t("emptyReadOnly")}</p>}
      <div className={styles.list}>
        {data.checks.map(change => canEdit && editing === change.id
          ? <ChangeForm key={change.id} title={t("editTitle")} initial={draftFor(change, today)} picker={picker} today={today} busy={busy}
            onCancel={() => setEditing(null)} onSave={async input => { if (await onSave(input, change.id)) setEditing(null); }} />
          : <ChangeCard key={change.id} projectId={projectId} change={change} picker={picker} today={today} canEdit={canEdit && editing === null} busy={busy}
            onEdit={() => setEditing(change.id)} onRemove={() => setRemoving(change)} />)}
      </div>
      {removing && <ConfirmDialog title={t("removeTitle", { name: removing.name })} body={t("removeBody")} confirmLabel={t("remove")} cancelLabel={t("cancel")} destructive busy={busy}
        onCancel={() => setRemoving(null)} onConfirm={() => void onRemove(removing.id).then(() => setRemoving(null))} />}
    </section>
  );
}

function ChangeCard({ projectId, change, picker, today, canEdit, busy, onEdit, onRemove }: {
  projectId: string; change: SiteChangeDto; picker: Picker; today: string; canEdit: boolean; busy: boolean; onEdit: () => void; onRemove: () => void;
}) {
  const t = useMessages(siteSavingsMessages);
  const { locale } = useEnergyIqLocale();
  const parts = affectedParts(change.meterIds, picker);
  const names = [...parts.groups, ...parts.meters];
  const scope = parts.site ? t("scopeSite") : names.length > 3 ? t("scopeMore", { names: names.slice(0, 3).join(", "), count: names.length - 3 }) : names.join(", ");
  return (
    <article className={styles.card} aria-label={change.name}>
      <header className={styles.cardHeader}>
        <div>
          <h4>{change.name}</h4>
          <p>{t(change.changeDate > today ? "starts" : "started", { date: dateWithDayYear(change.changeDate, locale) })} · {scope}</p>
          {change.note && <p className={styles.quiet}>{change.note}</p>}
        </div>
        {canEdit && <div className={styles.cardActions}>
          <button type="button" className={styles.ghost} disabled={busy} aria-label={t("editNamed", { name: change.name })} onClick={onEdit}>{t("edit")}</button>
          <button type="button" className={styles.ghost} disabled={busy} aria-label={t("removeNamed", { name: change.name })} onClick={onRemove}>{t("remove")}</button>
        </div>}
      </header>
      <Link className={styles.link} href={`/energyiq/analysis?${new URLSearchParams({ projectId, section: "story-change" })}`}>{t("seeResult")} →</Link>
    </article>
  );
}

const PROBLEM_TEXT: Record<ChangeProblem, "problemName" | "problemDate" | "problemDateAhead" | "problemMeters"> = { name: "problemName", date: "problemDate", dateAhead: "problemDateAhead", meters: "problemMeters" };

function ChangeForm({ title, initial, picker, today, busy, onCancel, onSave }: {
  title: string; initial: ChangeDraft; picker: Picker; today: string; busy: boolean; onCancel: () => void; onSave: (input: SiteChangeInput) => Promise<void>;
}) {
  const t = useMessages(siteSavingsMessages);
  const [draft, setDraft] = useState(initial);
  const [tried, setTried] = useState(false);
  const problems = changeProblems(draft, today);
  const shown = tried ? problems : [];
  const problem = (kind: ChangeProblem) => shown.includes(kind) ? <small role="alert" className={styles.bad}>{t(PROBLEM_TEXT[kind])}</small> : null;
  const set = (patch: Partial<ChangeDraft>) => setDraft(current => ({ ...current, ...patch }));
  const toggle = (ids: string[], on: boolean) => setDraft(current => ({ ...current, meterIds: on ? [...new Set([...current.meterIds, ...ids])] : current.meterIds.filter(id => !ids.includes(id)) }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setTried(true);
    if (problems.length) return;
    await onSave(changeInput(draft));
  };
  const meterBox = (meter: PickerMeter) => <label key={meter.id} className={styles.choice}>
    <input type="checkbox" checked={draft.meterIds.includes(meter.id)} onChange={event => toggle([meter.id], event.target.checked)} />
    <span title={meter.name}>{meter.name}</span>
  </label>;
  return (
    <form className={styles.add} onSubmit={event => void submit(event)} aria-label={title} noValidate>
      <h4>{title}</h4>
      <div className={styles.grid}>
        <label className={styles.field}><span>{t("fieldName")}</span>
          <input maxLength={MAX_NAME_LENGTH} autoFocus value={draft.name} onChange={event => set({ name: event.target.value })} placeholder={t("namePlaceholder")} aria-label={t("fieldName")} aria-invalid={shown.includes("name")} />
          {problem("name")}
        </label>
        <label className={styles.field}><span>{t("fieldDate")}</span>
          <input type="date" max={latestStart(today)} value={draft.changeDate} onChange={event => set({ changeDate: event.target.value })} aria-label={t("fieldDate")} aria-invalid={shown.includes("date") || shown.includes("dateAhead")} />
          <small className={styles.hint}>{t("dateHint")}</small>
          {problem("date")}{problem("dateAhead")}
        </label>
      </div>
      <fieldset className={styles.devices}>
        <legend>{t("fieldAffects")}</legend>
        <label className={styles.choice}><input type="radio" name="affects" checked={draft.whole} onChange={() => set({ whole: true })} />{t("affectsSite")}</label>
        <label className={styles.choice}><input type="radio" name="affects" checked={!draft.whole} onChange={() => set({ whole: false })} />{t("affectsSome")}</label>
        {!draft.whole && <div className={styles.pickList}>
          {picker.groups.map(group => <div key={group.id} className={styles.group}>
            <GroupBox name={t("groupAll", { name: group.name, count: group.meters.length })} ids={group.meters.map(meter => meter.id)} chosen={draft.meterIds} onToggle={toggle} />
            <div className={styles.groupMeters}>{group.meters.map(meterBox)}</div>
          </div>)}
          {picker.ungrouped.length > 0 && <div className={styles.group}>
            {picker.groups.length > 0 && <p className={styles.groupTitle}>{t("ungrouped")}</p>}
            <div className={picker.groups.length ? styles.groupMeters : undefined}>{picker.ungrouped.map(meterBox)}</div>
          </div>}
          {!picker.groups.length && !picker.ungrouped.length && <p className={styles.quiet}>{t("noMeters")}</p>}
        </div>}
        {problem("meters")}
      </fieldset>
      <label className={styles.field}><span>{t("fieldNote")}</span><input maxLength={MAX_NOTE_LENGTH} value={draft.note} onChange={event => set({ note: event.target.value })} aria-label={t("fieldNote")} /></label>
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} onClick={onCancel}>{t("cancel")}</button>
        <button type="submit" className={styles.primary} disabled={busy}>{t("save")}</button>
      </div>
    </form>
  );
}

/** "All of Block 264E": ticked when every meter in the group is, half-ticked when some are. */
function GroupBox({ name, ids, chosen, onToggle }: { name: string; ids: string[]; chosen: string[]; onToggle: (ids: string[], on: boolean) => void }) {
  const box = useRef<HTMLInputElement>(null);
  const picked = ids.filter(id => chosen.includes(id)).length;
  const all = ids.length > 0 && picked === ids.length;
  useEffect(() => { if (box.current) box.current.indeterminate = picked > 0 && !all; }, [picked, all]);
  return <label className={`${styles.choice} ${styles.groupTitle}`}>
    <input ref={box} type="checkbox" checked={all} onChange={event => onToggle(ids, event.target.checked)} />
    <span title={name}>{name}</span>
  </label>;
}
