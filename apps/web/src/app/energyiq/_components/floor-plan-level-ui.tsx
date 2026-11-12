"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useMessages } from "./energyiq-locale";
import { PLAN_LAYERS, type LayerKey, type LayerView } from "./floor-plan-layers";
import { LEVEL_NAME_MAX } from "./floor-plan-levels";
import { floorPlanMessages } from "./floor-plan-messages";
import { MAX_REPEAT, MAX_ROW_ROOMS, type TemplateKind } from "./floor-plan-templates";
import type { PlanLevel } from "./floor-plan-model";
import styles from "./floor-plan-editor.module.css";

/** Tabs above the plan, one per floor; shown only once the site has two floors or more. */
export function LevelTabs({ levels, current, onPick }: { levels: PlanLevel[]; current: string; onPick: (level: string) => void }) {
  const t = useMessages(floorPlanMessages);
  return <div className={styles.levelTabs} role="tablist" aria-label={t("level.tabs")}>
    {levels.map(level => <button key={level.id} type="button" role="tab" aria-selected={level.id === current} className={styles.levelTab} onClick={() => onPick(level.id)}>{level.name.trim() || level.id}</button>)}
  </div>;
}

/**
 * The floor shown: its name, its place among the tabs, Duplicate, the faint floor below, and Delete. Delete asks first,
 * in the page; when the floor has anything on it, the reader chooses to move it to another floor or delete it too.
 */
export function LevelPanel({ levels, current, contents, ghost, onGhost, onRename, onDone, onMove, onDuplicate, onDelete }: { levels: PlanLevel[]; current: string; contents: { areas: number; rooms: number; devices: number; others: number }; ghost: boolean; onGhost: (show: boolean) => void; onRename: (name: string) => void; onDone: () => void; onMove: (by: -1 | 1) => void; onDuplicate: () => void; onDelete: (moveTo: string | null) => void }) {
  const t = useMessages(floorPlanMessages);
  const index = levels.findIndex(level => level.id === current), level = levels[index]!;
  const [asking, setAsking] = useState(false);
  const others = levels.filter(item => item.id !== current);
  const [target, setTarget] = useState(others[0]?.id ?? "");
  const moveTo = others.some(item => item.id === target) ? target : others[0]?.id ?? "";
  const empty = !contents.areas && !contents.rooms && !contents.devices && !contents.others;
  return <div className={styles.panel} data-panel="level">
    <h5>{t("level.title")}</h5>
    <label>{t("level.name")}<input value={level.name} maxLength={LEVEL_NAME_MAX} onChange={event => onRename(event.target.value)} onBlur={onDone} onKeyDown={event => { if (event.key === "Enter") onDone(); }} /></label>
    <div className={styles.arrangeRow}>
      <button type="button" className={styles.tool} disabled={index <= 0} onClick={() => onMove(-1)}>{t("level.earlier")}</button>
      <button type="button" className={styles.tool} disabled={index >= levels.length - 1} onClick={() => onMove(1)}>{t("level.later")}</button>
      <button type="button" className={styles.tool} title={t("level.duplicateHint")} onClick={onDuplicate}>{t("level.duplicate")}</button>
    </div>
    {index > 0 && <label className={styles.check}><input type="checkbox" checked={ghost} onChange={event => onGhost(event.target.checked)} />{t("level.ghost")}</label>}
    {!asking ? <button type="button" className={styles.danger} onClick={() => setAsking(true)}>{t("level.delete")}</button>
      : <div className={styles.confirm} role="alertdialog" aria-label={t("level.delete")}>
        <p>{empty ? t("level.confirmEmpty", { name: level.name }) : t("level.confirmItems", { name: level.name, areas: contents.areas, rooms: contents.rooms, devices: contents.devices })}</p>
        {!empty && <label>{t("level.moveTo")}<select value={moveTo} onChange={event => setTarget(event.target.value)}>{others.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        <div className={styles.arrangeRow}>
          {!empty && <button type="button" className={styles.tool} onClick={() => onDelete(moveTo)}>{t("level.moveAndDelete")}</button>}
          <button type="button" className={styles.danger} onClick={() => onDelete(null)}>{empty ? t("level.delete") : t("level.deleteAll")}</button>
          <button type="button" className={styles.tool} onClick={() => setAsking(false)}>{t("level.keep")}</button>
        </div>
      </div>}
  </div>;
}

/**
 * Layers: hide or lock a kind of item while editing (only here, never saved), and tick it to hide it on the shared map
 * for everyone (saved with the layout, an undo step like any change).
 */
export function LayersPanel({ layers, view, shared, onToggle, onShared }: { layers: LayerKey[]; view: LayerView; shared: Set<LayerKey>; onToggle: (part: keyof LayerView, key: LayerKey) => void; onShared: (key: LayerKey, hide: boolean) => void }) {
  const t = useMessages(floorPlanMessages);
  return <div className={styles.panel} data-panel="layers">
    <h5>{t("layers.title")}</h5>
    <p className={styles.hint}>{t("layers.hint")}</p>
    <ul className={styles.layerList}>{PLAN_LAYERS.filter(layer => layers.includes(layer.key)).map(({ key }) => {
      const name = t(`layers.${key}`), hidden = view.hidden.includes(key), locked = view.locked.includes(key);
      return <li key={key} data-layer={key}>
        <span className={hidden ? styles.layerOff : undefined}>{name}</span>
        <span className={styles.arrangeRow}>
          <button type="button" className={styles.tool} aria-pressed={hidden} aria-label={t(hidden ? "layers.showLabel" : "layers.hideLabel", { layer: name })} onClick={() => onToggle("hidden", key)}>{hidden ? t("layers.show") : t("layers.hide")}</button>
          <button type="button" className={styles.tool} aria-pressed={locked} aria-label={t(locked ? "layers.unlockLabel" : "layers.lockLabel", { layer: name })} onClick={() => onToggle("locked", key)}>{locked ? t("layers.unlock") : t("layers.lock")}</button>
        </span>
        <label className={styles.check}><input type="checkbox" checked={shared.has(key)} onChange={event => onShared(key, event.target.checked)} />{t("layers.map")}</label>
      </li>;
    })}</ul>
  </div>;
}

/** Repeat what is selected: how many copies, across or down, and the gap between them. One press is one undo step. */
export function RepeatForm({ onRepeat }: { onRepeat: (count: number, direction: "across" | "down", gap: number) => void }) {
  const t = useMessages(floorPlanMessages);
  const [count, setCount] = useState("3"), [direction, setDirection] = useState<"across" | "down">("across"), [gap, setGap] = useState("20");
  const number = (text: string, low: number, high: number, fallback: number) => { const value = Math.round(Number(text)); return Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback; };
  return <div className={styles.arrange} role="group" aria-label={t("repeat.title")}>
    <p className={styles.subhead}>{t("repeat.title")}</p>
    <div className={styles.repeatGrid}>
      <label>{t("repeat.count")}<input type="number" min={1} max={MAX_REPEAT} value={count} onChange={event => setCount(event.target.value)} /></label>
      <label>{t("repeat.direction")}<select value={direction} onChange={event => setDirection(event.target.value === "down" ? "down" : "across")}><option value="across">{t("repeat.across")}</option><option value="down">{t("repeat.down")}</option></select></label>
      <label>{t("repeat.gap")}<input type="number" min={0} max={1000} value={gap} onChange={event => setGap(event.target.value)} /></label>
    </div>
    <button type="button" className={styles.tool} onClick={() => onRepeat(number(count, 1, MAX_REPEAT, 3), direction, number(gap, 0, 1000, 20))}>{t("repeat.go")}</button>
    <p className={styles.hint}>{t("repeat.hint")}</p>
  </div>;
}

/** The toolbar's Insert template menu: a row of rooms (how many), an HDB block or an office suite. */
export function TemplateMenu({ onInsert }: { onInsert: (kind: TemplateKind, count: number) => void }) {
  const t = useMessages(floorPlanMessages);
  const [open, setOpen] = useState(false), [count, setCount] = useState("4");
  const root = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null), popover = useId();
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { if (root.current && !root.current.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  const insert = (kind: TemplateKind) => { const rooms = Math.round(Number(count)); onInsert(kind, Number.isFinite(rooms) ? Math.min(MAX_ROW_ROOMS, Math.max(1, rooms)) : 4); setOpen(false); button.current?.focus(); };
  return <div className={styles.gridMenu} ref={root} onKeyDown={event => { if (event.key === "Escape" && open) { event.stopPropagation(); setOpen(false); button.current?.focus(); } }}>
    <button ref={button} type="button" className={styles.tool} aria-expanded={open} aria-controls={open ? popover : undefined} title={t("template.hint")} onClick={() => setOpen(current => !current)}>{t("template.menu")}</button>
    {open && <div id={popover} className={styles.gridPopover} role="group" aria-label={t("template.menu")}>
      <div className={styles.templateRow}>
        <label>{t("template.rowCount")}<input type="number" min={1} max={MAX_ROW_ROOMS} value={count} onChange={event => setCount(event.target.value)} /></label>
        <button type="button" className={styles.tool} onClick={() => insert("row")}>{t("template.row")}</button>
      </div>
      <button type="button" className={styles.tool} onClick={() => insert("hdb")}>{t("template.hdb")}</button>
      <button type="button" className={styles.tool} onClick={() => insert("office")}>{t("template.office")}</button>
      <p className={styles.hint}>{t("template.hint")}</p>
    </div>}
  </div>;
}
