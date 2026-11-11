"use client";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { intlLocale } from "./energyiq-messages";
import { floorPlanMessages } from "./floor-plan-messages";
import styles from "./floor-plan-editor.module.css";

/**
 * Zoom in the toolbar: −, the zoom level, +, Fit plan (the whole plan) and 100% (one plan unit on one screen pixel).
 * Zooming changes only what the editor shows; nothing about the plan or how it is saved changes.
 */
export function ZoomControls({ percent, whole, canIn, canOut, commandKey, keyFor, onIn, onOut, onFit, onActual }: { percent: number; whole: boolean; canIn: boolean; canOut: boolean; commandKey: string; keyFor: (key: string) => string; onIn: () => void; onOut: () => void; onFit: () => void; onActual: () => void }) {
  const t = useMessages(floorPlanMessages);
  return <div className={styles.zoom} role="group" aria-label={t("zoom.title")} title={t("zoom.hint", { commandKey })}>
    <button type="button" className={styles.tool} disabled={!canOut} aria-label={t("zoom.outHint", { key: keyFor("−") })} title={t("zoom.outHint", { key: keyFor("−") })} onClick={onOut}>−</button>
    <output className={styles.zoomLevel} aria-label={t("zoom.level", { percent })}>{percent}%</output>
    <button type="button" className={styles.tool} disabled={!canIn} aria-label={t("zoom.inHint", { key: keyFor("+") })} title={t("zoom.inHint", { key: keyFor("+") })} onClick={onIn}>+</button>
    <button type="button" className={styles.tool} aria-pressed={whole} title={t("zoom.fitHint", { key: keyFor("0") })} onClick={onFit}>{t("zoom.fit")}</button>
    <button type="button" className={styles.tool} aria-label={t("zoom.actualHint")} title={t("zoom.actualHint")} onClick={onActual}>{t("zoom.actual")}</button>
  </div>;
}

/** "Restore your unsaved changes from …?" when the editor opens with a draft left from before (see floor-plan-draft). */
export function DraftOffer({ savedAt, stale, onRestore, onDiscard }: { savedAt: number; stale: boolean; onRestore: () => void; onDiscard: () => void }) {
  const t = useMessages(floorPlanMessages);
  const { locale } = useEnergyIqLocale();
  let time: string;
  try { time = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeStyle: "short" }).format(savedAt); } catch { time = new Date(savedAt).toLocaleString(); }
  return <div className={styles.draft} role="group" aria-label={t("draft.label")}>
    <span><strong>{t("draft.offer", { time })}</strong>{stale && <> {t("draft.stale")}</>}</span>
    <button type="button" onClick={onRestore}>{t("draft.restore")}</button>
    <button type="button" className={styles.leave} onClick={onDiscard}>{t("draft.discard")}</button>
  </div>;
}
