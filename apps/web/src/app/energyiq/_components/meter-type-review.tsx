"use client";
import { useState } from "react";
import type { EnergyMeterCategoryDto, EnergyProjectSetupDocumentDto } from "../../../lib/config-api";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { meterTypeChanges, meterTypeRows, SORTABLE_TYPES } from "./meter-type-review-model";
import { meterTypeReviewMessages } from "./meter-type-review-messages";
import { measurementLabel } from "./site-structure-editing";
import styles from "./project-configuration-view.module.css";

/** Shown above the floor layout while some meters' equipment suggests a better type than the one they have. */
export function MeterTypeBanner({ document, onOpen }: { document: EnergyProjectSetupDocumentDto; onOpen: () => void }) {
  const t = useMessages(meterTypeReviewMessages);
  const count = meterTypeChanges(meterTypeRows(document)).length;
  if (!count) return null;
  return <section className={styles.typesBanner} aria-label={t("banner.title")}>
    <div><strong>{t("banner.title")}</strong><p>{count === 1 ? t("banner.bodyOne") : t("banner.body", { count })}</p></div>
    <button type="button" className={styles.primaryAction} onClick={onOpen}>{t("open")}</button>
  </section>;
}

/** Every meter below the main meter with a suggested type; nothing changes until the person saves. */
export function MeterTypeReview({ document, busy, error, onSave, onCancel }: { document: EnergyProjectSetupDocumentDto; busy: boolean; error: string; onSave: (choices: Record<string, EnergyMeterCategoryDto>) => void; onCancel: () => void }) {
  const t = useMessages(meterTypeReviewMessages);
  const { locale } = useEnergyIqLocale();
  const rows = meterTypeRows(document);
  const [choices, setChoices] = useState<Record<string, EnergyMeterCategoryDto>>(() => Object.fromEntries(rows.map(row => [row.id, row.suggested ?? row.current])));
  const changed = rows.filter(row => choices[row.id] !== row.current);
  return <form className={styles.inlineForm} aria-label={t("title")} onSubmit={event => { event.preventDefault(); onSave(Object.fromEntries(changed.map(row => [row.id, choices[row.id]!]))); }}>
    <div><h4>{t("title")}</h4><p className={styles.formHint}>{t("intro")}</p></div>
    {rows.length ? <div className={styles.typeRows}>
      <div className={styles.typeRowHeading}><span>{t("col.meter")}</span><span>{t("col.type")}</span></div>
      {rows.map(row => {
        const choice = choices[row.id] ?? row.current;
        const note = choice !== row.current ? t("was", { type: measurementLabel(row.current, locale) })
          : row.suggested === null ? t("noMatch") : "";
        return <div key={row.id} className={styles.typeRow}>
          <span>{row.name}{note && <small>{note}</small>}</span>
          <label className={styles.typeSelect}><span className="sr-only">{t("typeFor", { name: row.name })}</span>
            <select value={choice} onChange={event => setChoices({ ...choices, [row.id]: event.target.value as EnergyMeterCategoryDto })}>
              {[...new Set([...SORTABLE_TYPES, row.current])].map(value => <option key={value} value={value}>{measurementLabel(value, locale)}{value === row.suggested ? ` · ${t("suggested")}` : ""}</option>)}
            </select>
          </label>
        </div>;
      })}
    </div> : <p>{t("noMeters")}</p>}
    {error && <p role="alert" className={styles.editorError}>{error}</p>}
    <div className={styles.editorActions}>
      <span className={styles.formHint}>{changed.length === 1 ? t("changesOne") : changed.length ? t("changes", { count: changed.length }) : t("noChanges")}</span>
      <button type="button" className={styles.secondaryAction} disabled={busy} onClick={onCancel}>{t("cancel")}</button>
      <button type="submit" className={styles.primaryAction} disabled={busy || !changed.length}>{busy ? t("saving") : t("save")}</button>
    </div>
  </form>;
}
