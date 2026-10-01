"use client";
import { useState, type FormEvent } from "react";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { intlLocale } from "./energyiq-messages";
import { addFact, FACT_KINDS, factEditText, factFromEditText, factLayout, readFacts, removeFact, saveProjectNotes, updateFact, type FactKind, type SiteFact } from "./advisor-facts-model";
import { advisorFactsMessages } from "./advisor-facts-messages";
import styles from "./advisor-facts.module.css";

/** "Things the advisor should know": site facts the readings cannot show, kept in Project notes for every answer and report. */
export function AdvisorFacts({ projectId, notes, timezone, canEdit, onSaved }: { projectId: string; notes: string; timezone: string; canEdit: boolean; onSaved: () => void }) {
  const t = useMessages(advisorFactsMessages);
  const { locale } = useEnergyIqLocale();
  const facts = readFacts(notes);
  const [kind, setKind] = useState<FactKind>("afterHours");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<{ line: string; kind: FactKind; text: string } | null>(null);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const shown = (date: string) => new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
  const save = async (next: string, done: string) => {
    setBusy(true); setStatus("");
    try {
      const result = await saveProjectNotes(projectId, notes, next);
      setStatus(result === "changed" ? t("changed") : done);
      if (result === "saved") { setText(""); setEditing(null); onSaved(); }
    } catch { setStatus(t("failed")); }
    finally { setBusy(false); }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); if (text.trim() && !busy) void save(addFact(notes, kind, text, today), t("added")); };
  return <section className={styles.card} aria-label={t("title")}>
    <header><h4>{t("title")}</h4><p>{t("intro")}</p></header>
    {facts.length > 0 ? <ul className={styles.list}>{facts.map(fact => editing?.line === fact.line
      ? <li key={fact.line} className={styles.editing}>
        <form className={styles.editForm} onSubmit={event => { event.preventDefault(); const next = factFromEditText(editing.text); if (next && !busy) void save(updateFact(notes, fact, editing.kind, next), t("saved")); }}>
          <div className={styles.kinds} role="group" aria-label={t("kindLabel")}>{FACT_KINDS.map(item => <button key={item} type="button" aria-pressed={editing.kind === item} onClick={() => setEditing({ ...editing, kind: item })}>{t(`kind.${item}`)}</button>)}</div>
          <textarea autoFocus aria-label={t("factLabel")} value={editing.text} rows={Math.min(12, Math.max(2, editing.text.split("\n").length + 1))} onChange={event => setEditing({ ...editing, text: event.target.value })} />
          <p className={styles.hint}>{t("editHint")}</p>
          <div className={styles.editActions}>
            <button type="button" className={styles.cancel} disabled={busy} onClick={() => setEditing(null)}>{t("cancel")}</button>
            <button type="submit" className={styles.add} disabled={busy || !factFromEditText(editing.text)}>{busy ? t("saving") : t("save")}</button>
          </div>
        </form>
      </li>
      : <li key={fact.line}>
        <span className={`${styles.kind} ${styles[fact.kind]}`}>{t(`kind.${fact.kind}`)}</span>
        <FactBody fact={fact} date={fact.date ? shown(fact.date) : ""} code={t("column.code")} items={t("column.items")} />
        {canEdit && <div className={styles.actions}>
          <button type="button" className={styles.edit} disabled={busy || editing !== null} aria-label={t("editLabel", { text: fact.text })} onClick={() => { setStatus(""); setEditing({ line: fact.line, kind: fact.kind, text: factEditText(fact.text) }); }}>{t("edit")}</button>
          <button type="button" className={styles.remove} disabled={busy || editing !== null} aria-label={t("removeLabel", { text: fact.text })} onClick={() => void save(removeFact(notes, fact), t("removed"))}>{t("remove")}</button>
        </div>}
      </li>)}</ul> : canEdit && <div className={styles.examples}><p>{t("empty")}</p><ul>{FACT_KINDS.filter(item => item !== "other").map(item => <li key={item}><button type="button" onClick={() => { setKind(item); setText(t(`example.${item}`)); }}><b>{t(`kind.${item}`)}</b> {t(`example.${item}`)}</button></li>)}</ul></div>}
    {canEdit ? <form className={styles.form} onSubmit={submit}>
      <div className={styles.kinds} role="group" aria-label={t("kindLabel")}>{FACT_KINDS.map(item => <button key={item} type="button" aria-pressed={kind === item} onClick={() => setKind(item)}>{t(`kind.${item}`)}</button>)}</div>
      <div className={styles.row}>
        <input aria-label={t("factLabel")} value={text} maxLength={300} placeholder={t(`example.${kind}`)} onChange={event => setText(event.target.value)} />
        <button type="submit" className={styles.add} disabled={busy || !text.trim()}>{busy ? t("adding") : t("add")}</button>
      </div>
    </form> : <p className={styles.muted}>{t("adminOnly")}</p>}
    {status && <p role="status" className={styles.status}>{status}</p>}
    {canEdit && <p className={styles.tip}>{t("chatTip")}</p>}
  </section>;
}

/** A fact's wording laid out for reading: a code-to-equipment table, a bullet list, or a sentence. */
function FactBody({ fact, date, code, items }: { fact: SiteFact; date: string; code: string; items: string }) {
  const layout = factLayout(fact.text);
  const stamp = date ? <small>{date}</small> : null;
  if (layout.kind === "plain") return <p>{layout.text}{stamp}</p>;
  return <div className={styles.body}>
    {layout.intro ? <p className={styles.intro}>{layout.intro}{stamp}</p> : null}
    {layout.kind === "table"
      ? <table className={styles.table}>
        <thead><tr><th scope="col">{code}</th><th scope="col">{items}</th></tr></thead>
        <tbody>{layout.rows.map(row => <tr key={row.code}><th scope="row">{row.code}</th><td>{row.items}</td></tr>)}</tbody>
      </table>
      : <ul className={styles.bullets}>{layout.items.map(item => <li key={item}>{item}</li>)}</ul>}
    {!layout.intro && stamp ? <p className={styles.intro}>{stamp}</p> : null}
  </div>;
}
