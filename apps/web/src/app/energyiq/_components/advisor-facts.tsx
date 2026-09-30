"use client";
import { useState, type FormEvent } from "react";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { intlLocale } from "./energyiq-messages";
import { addFact, FACT_KINDS, readFacts, removeFact, saveProjectNotes, type FactKind } from "./advisor-facts-model";
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
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const shown = (date: string) => new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
  const save = async (next: string, done: string) => {
    setBusy(true); setStatus("");
    try {
      const result = await saveProjectNotes(projectId, notes, next);
      setStatus(result === "changed" ? t("changed") : done);
      if (result === "saved") { setText(""); onSaved(); }
    } catch { setStatus(t("failed")); }
    finally { setBusy(false); }
  };
  const submit = (event: FormEvent) => { event.preventDefault(); if (text.trim() && !busy) void save(addFact(notes, kind, text, today), t("added")); };
  return <section className={styles.card} aria-label={t("title")}>
    <header><h4>{t("title")}</h4><p>{t("intro")}</p></header>
    {facts.length > 0 ? <ul className={styles.list}>{facts.map(fact => <li key={fact.line}>
      <span className={`${styles.kind} ${styles[fact.kind]}`}>{t(`kind.${fact.kind}`)}</span>
      <p>{fact.text}{fact.date && <small>{shown(fact.date)}</small>}</p>
      {canEdit && <button type="button" className={styles.remove} disabled={busy} aria-label={t("removeLabel", { text: fact.text })} onClick={() => void save(removeFact(notes, fact), t("removed"))}>{t("remove")}</button>}
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
