"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { floorPlanMessages } from "./floor-plan-messages";
import { useMessages } from "./energyiq-locale";
import styles from "./plan-enlarge.module.css";

/** How much bigger than the window's width the plan can be shown; each press of + or − moves one step. */
export const ENLARGE_ZOOMS = [1, 1.5, 2, 3, 4] as const;

/**
 * A large view of a floor plan in a dialog that fills most of the screen, so small rooms and device names can be read.
 * Esc, the Close button or a click on the dimmed backdrop closes it. Zooming makes the plan wider than the window and
 * the view scrolls; nothing about the plan itself changes.
 */
export function PlanEnlargeDialog({ open, title, onClose, children }: { open: boolean; title?: string; onClose: () => void; children: ReactNode }) {
  const t = useMessages(floorPlanMessages);
  const dialog = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState(0);
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) { setStep(0); if (typeof node.showModal === "function") node.showModal(); else node.setAttribute("open", ""); }
    if (!open && node.open) { if (typeof node.close === "function") node.close(); else node.removeAttribute("open"); }
  }, [open]);
  const zoom = ENLARGE_ZOOMS[step]!;
  return <dialog ref={dialog} className={styles.dialog} aria-label={title ?? t("enlarge.title")} onClose={onClose} onCancel={onClose}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    {open && <div className={styles.panel}>
      <header className={styles.bar}>
        <h4>{title ?? t("enlarge.title")}</h4>
        <div className={styles.tools}>
          <button type="button" aria-label={t("enlarge.zoomOut")} title={t("enlarge.zoomOut")} disabled={step === 0} onClick={() => setStep(value => Math.max(0, value - 1))}>−</button>
          <output aria-live="polite">{Math.round(zoom * 100)}%</output>
          <button type="button" aria-label={t("enlarge.zoomIn")} title={t("enlarge.zoomIn")} disabled={step === ENLARGE_ZOOMS.length - 1} onClick={() => setStep(value => Math.min(ENLARGE_ZOOMS.length - 1, value + 1))}>+</button>
          <button type="button" disabled={step === 0} onClick={() => setStep(0)}>{t("enlarge.fit")}</button>
          <button type="button" className={styles.close} onClick={onClose}>{t("enlarge.close")}</button>
        </div>
      </header>
      <div className={styles.body} data-zoom={zoom}>
        <div className={styles.sheet} style={{ width: `${zoom * 100}%` }}>{children}</div>
      </div>
    </div>}
  </dialog>;
}

/** The small "How it will look" picture in the layout editor: clicking it (or Enter/Space) opens the large view. */
export function EnlargeablePreview({ children }: { children: ReactNode }) {
  const t = useMessages(floorPlanMessages);
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className={styles.trigger} aria-label={t("enlarge.openPreview")} title={t("enlarge.openPreview")} onClick={() => setOpen(true)}>
      <span className={styles.triggerPlan}>{children}</span>
      <span className={styles.hint} aria-hidden="true">⤢ {t("enlarge.open")}</span>
    </button>
    <PlanEnlargeDialog open={open} title={t("style.preview")} onClose={() => setOpen(false)}>{children}</PlanEnlargeDialog>
  </>;
}
