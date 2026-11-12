"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useMessages } from "./energyiq-locale";
import type { AlignHow } from "./floor-plan-align";
import { floorPlanMessages } from "./floor-plan-messages";
import { GRID_SIZES, type EditorPrefs, type GridSize } from "./floor-plan-snap";
import styles from "./floor-plan-editor.module.css";

/**
 * The shared actions for what is selected: Duplicate, Lock, Bring to front and Send to back. An action that does not
 * apply (nothing to copy, already in front) is left out or greyed out. The lock button's label says what it will do
 * ("Lock in place" / "Unlock"), so it is a plain button, not a pressed toggle.
 */
export function ArrangeActions({ onDuplicate, duplicateKey, locked, many, onLock, order, onFront, onBack }: { onDuplicate?: () => void; duplicateKey: string; locked: boolean; many: boolean; onLock?: () => void; order: boolean; onFront?: () => void; onBack?: () => void }) {
  const t = useMessages(floorPlanMessages);
  const lockLabel = locked ? (many ? t("panel.unlockAll") : t("panel.unlock")) : (many ? t("panel.lockAll") : t("panel.lock"));
  return <div className={styles.arrange} role="group" aria-label={t("panel.arrange")}>
    <div className={styles.arrangeRow}>
      {onDuplicate && <button type="button" className={styles.tool} title={t("panel.duplicateHint", { duplicateKey })} onClick={onDuplicate}>{t("panel.duplicate")}</button>}
      {onLock && <button type="button" className={styles.tool} onClick={onLock}>{lockLabel}</button>}
    </div>
    {order && <div className={styles.arrangeRow} title={t("panel.orderHint")}>
      <button type="button" className={styles.tool} disabled={!onFront} onClick={onFront}>{t("panel.front")}</button>
      <button type="button" className={styles.tool} disabled={!onBack} onClick={onBack}>{t("panel.back")}</button>
    </div>}
    {locked && <p className={styles.hint}>{t("panel.lockedNote")}</p>}
  </div>;
}

const ALIGNS: AlignHow[] = ["left", "centre", "right", "top", "middle", "bottom"];
/**
 * Lining up two or more selected items: align their edges or centres, space them evenly (three or more), or give them
 * the width or height of the first one picked. Each press is one undo step.
 */
export function LineUpActions({ count, sizable, onAlign, onDistribute, onSize }: { count: number; sizable: boolean; onAlign: (how: AlignHow) => void; onDistribute: (axis: "x" | "y") => void; onSize: (dimension: "w" | "h") => void }) {
  const t = useMessages(floorPlanMessages);
  return <div className={styles.arrange} role="group" aria-label={t("align.title")}>
    <p className={styles.subhead}>{t("align.title")}</p>
    <div className={styles.alignGrid}>{ALIGNS.map(how => <button key={how} type="button" className={styles.tool} title={t(`align.${how}Hint`)} aria-label={`${t(`align.${how}`)}: ${t(`align.${how}Hint`)}`} onClick={() => onAlign(how)}>{t(`align.${how}`)}</button>)}</div>
    <div className={styles.arrangeRow}>
      <button type="button" className={styles.tool} disabled={count < 3} onClick={() => onDistribute("x")}>{t("align.across")}</button>
      <button type="button" className={styles.tool} disabled={count < 3} onClick={() => onDistribute("y")}>{t("align.down")}</button>
    </div>
    <div className={styles.arrangeRow}>
      <button type="button" className={styles.tool} disabled={!sizable} onClick={() => onSize("w")}>{t("align.width")}</button>
      <button type="button" className={styles.tool} disabled={!sizable} onClick={() => onSize("h")}>{t("align.height")}</button>
    </div>
    <p className={styles.hint}>{t("align.hint")}</p>
  </div>;
}

/**
 * The toolbar's Grid menu: snap to the grid on or off, the grid spacing, and whether the grid is drawn. These are the
 * editor's own choices, saved with the layout; the shared map never shows them. It closes on Esc or a click elsewhere.
 */
export function GridMenu({ prefs, onChange, commandKey }: { prefs: EditorPrefs; onChange: (prefs: EditorPrefs) => void; commandKey: string }) {
  const t = useMessages(floorPlanMessages);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const popover = useId();
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { if (root.current && !root.current.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  return <div className={styles.gridMenu} ref={root} onKeyDown={event => { if (event.key === "Escape" && open) { event.stopPropagation(); setOpen(false); button.current?.focus(); } }}>
    {/* Esc puts focus back on the Grid button, so it never falls out of the editor (and its keys keep working). */}
    <button ref={button} type="button" className={styles.tool} aria-expanded={open} aria-controls={open ? popover : undefined} title={t("grid.title")} onClick={() => setOpen(current => !current)}>{t("grid.menu")}</button>
    {open && <div id={popover} className={styles.gridPopover} role="group" aria-label={t("grid.title")}>
      <label className={styles.check}><input type="checkbox" checked={prefs.snap} onChange={event => onChange({ ...prefs, snap: event.target.checked })} />{t("grid.snap")}</label>
      <label>{t("grid.size")}<select value={prefs.grid} onChange={event => onChange({ ...prefs, grid: Number(event.target.value) as GridSize })}>{GRID_SIZES.map(size => <option key={size} value={size}>{t(`grid.size${size}`)}</option>)}</select></label>
      <label className={styles.check}><input type="checkbox" checked={prefs.showGrid} onChange={event => onChange({ ...prefs, showGrid: event.target.checked })} />{t("grid.show")}</label>
      <p className={styles.hint}>{t("grid.hint", { commandKey })}</p>
    </div>}
  </div>;
}
