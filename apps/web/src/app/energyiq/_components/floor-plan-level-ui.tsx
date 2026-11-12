"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useMessages } from "./energyiq-locale";
import { PLAN_LAYERS, type LayerKey, type LayerView } from "./floor-plan-layers";
import { LEVEL_NAME_MAX, shownLevelName, type LevelContents } from "./floor-plan-levels";
import type { Translate } from "./energyiq-messages";
import { floorPlanMessages } from "./floor-plan-messages";
import { MAX_REPEAT, MAX_ROW_ROOMS, type TemplateKind } from "./floor-plan-templates";
import type { PlanLevel } from "./floor-plan-model";
import styles from "./floor-plan-editor.module.css";

/** A floor's name as shown: its own, or "Floor 2" when it has none (never the id the reader never typed). */
export function useLevelName() {
  const t = useMessages(floorPlanMessages);
  return (level: PlanLevel, index: number) => shownLevelName(level, index, number => t("level.default", { number }));
}

/**
 * Buttons above the plan, one per floor, the floor shown pressed; shown only once the site has two floors or more. They
 * are plain buttons in a named group (not tabs), so a screen reader promises no arrow keys.
 */
export function LevelTabs({ levels, current, onPick }: { levels: PlanLevel[]; current: string; onPick: (level: string) => void }) {
  const t = useMessages(floorPlanMessages), nameOf = useLevelName();
  return <div className={styles.levelTabs} role="group" aria-label={t("level.tabs")} data-level-tabs="">
    {levels.map((level, index) => <button key={level.id} type="button" aria-pressed={level.id === current} className={styles.levelTab} onClick={() => onPick(level.id)}>{nameOf(level, index)}</button>)}
  </div>;
}

/** What is on a floor, in words: only what is there ("1 area and the entrance"), joined the reader's way. */
function contentsText(t: Translate<keyof (typeof floorPlanMessages)["en"]>, contents: LevelContents) {
  const parts = [
    contents.areas ? (contents.areas === 1 ? t("level.countArea") : t("level.countAreas", { count: contents.areas })) : null,
    contents.rooms ? (contents.rooms === 1 ? t("level.countRoom") : t("level.countRooms", { count: contents.rooms })) : null,
    contents.devices ? (contents.devices === 1 ? t("level.countDevice") : t("level.countDevices", { count: contents.devices })) : null,
    contents.entrance ? t("level.countEntrance") : null,
    contents.others ? (contents.others === 1 ? t("level.countOther") : t("level.countOthers", { count: contents.others })) : null,
  ].filter((part): part is string => !!part);
  return parts.length > 1 ? `${parts.slice(0, -1).join(t("level.comma"))}${t("level.and")}${parts.at(-1)}` : parts[0] ?? "";
}

/**
 * The floor shown: its name, its place among the tabs, Duplicate, the faint floor below, and Delete. Delete asks first,
 * in the page; when the floor has anything on it, the reader chooses to move it to another floor or delete it too.
 * Focus goes into the question when it opens and back to Delete floor when it closes, so keyboard readers keep their place.
 */
export function LevelPanel({ levels, current, contents, ghost, onGhost, onRename, onDone, onMove, onDuplicate, onDelete }: { levels: PlanLevel[]; current: string; contents: LevelContents; ghost: boolean; onGhost: (show: boolean) => void; onRename: (name: string) => void; onDone: () => void; onMove: (by: -1 | 1) => void; onDuplicate: () => void; onDelete: (moveTo: string | null) => void }) {
  const t = useMessages(floorPlanMessages), nameOf = useLevelName();
  const index = levels.findIndex(level => level.id === current), level = levels[index]!, name = nameOf(level, index);
  const [asking, setAsking] = useState(false);
  const others = levels.filter(item => item.id !== current);
  const [target, setTarget] = useState(others[0]?.id ?? "");
  const moveTo = others.some(item => item.id === target) ? target : others[0]?.id ?? "";
  const empty = !contents.areas && !contents.rooms && !contents.devices && !contents.entrance && !contents.others;
  const deleteButton = useRef<HTMLButtonElement>(null), firstAction = useRef<HTMLButtonElement>(null), asked = useRef(false), question = useId();
  useEffect(() => {
    if (asking) { asked.current = true; firstAction.current?.focus(); }
    else if (asked.current) { asked.current = false; deleteButton.current?.focus(); }
  }, [asking]);
  return <div className={styles.panel} data-panel="level">
    <h5>{t("level.title")}</h5>
    <label>{t("level.name")}<input value={level.name} maxLength={LEVEL_NAME_MAX} onChange={event => onRename(event.target.value)} onBlur={onDone} onKeyDown={event => { if (event.key === "Enter") onDone(); }} /></label>
    <div className={styles.arrangeRow}>
      <button type="button" className={styles.tool} disabled={index <= 0} onClick={() => onMove(-1)}>{t("level.earlier")}</button>
      <button type="button" className={styles.tool} disabled={index >= levels.length - 1} onClick={() => onMove(1)}>{t("level.later")}</button>
      <button type="button" className={styles.tool} title={t("level.duplicateHint")} onClick={onDuplicate}>{t("level.duplicate")}</button>
    </div>
    {index > 0 && <label className={styles.check}><input type="checkbox" checked={ghost} onChange={event => onGhost(event.target.checked)} />{t("level.ghost")}</label>}
    {!asking ? <button ref={deleteButton} type="button" className={styles.danger} onClick={() => setAsking(true)}>{t("level.delete")}</button>
      : <div className={styles.confirm} role="alertdialog" aria-label={t("level.delete")} aria-describedby={question} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); event.preventDefault(); setAsking(false); } }}>
        <p id={question}>{empty ? t("level.confirmEmpty", { name }) : t("level.confirmItems", { name, items: contentsText(t, contents) })}</p>
        {!empty && <label>{t("level.moveTo")}<select value={moveTo} onChange={event => setTarget(event.target.value)}>{others.map(item => <option key={item.id} value={item.id}>{nameOf(item, levels.indexOf(item))}</option>)}</select></label>}
        <div className={styles.arrangeRow}>
          {!empty && <button ref={firstAction} type="button" className={styles.tool} onClick={() => onDelete(moveTo)}>{t("level.moveAndDelete")}</button>}
          <button ref={empty ? firstAction : undefined} type="button" className={styles.danger} onClick={() => onDelete(null)}>{empty ? t("level.delete") : t("level.deleteAll")}</button>
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
export function RepeatForm({ grid, onRepeat }: { grid: number; onRepeat: (count: number, direction: "across" | "down", gap: number) => void }) {
  const t = useMessages(floorPlanMessages);
  const [count, setCount] = useState("3"), [direction, setDirection] = useState<"across" | "down">("across"), [gap, setGap] = useState("20");
  const number = (text: string, low: number, high: number, fallback: number) => { const value = Math.round(Number(text)); return Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback; };
  return <div className={styles.arrange} role="group" aria-label={t("repeat.title")}>
    <p className={styles.subhead}>{t("repeat.title")}</p>
    <div className={styles.repeatGrid}>
      <label>{t("repeat.count")}<input type="number" min={1} max={MAX_REPEAT} value={count} onChange={event => setCount(event.target.value)} /></label>
      <label>{t("repeat.direction")}<select value={direction} onChange={event => setDirection(event.target.value === "down" ? "down" : "across")}><option value="across">{t("repeat.across")}</option><option value="down">{t("repeat.down")}</option></select></label>
      <label>{t("repeat.gap", { grid })}<input type="number" min={0} max={1000} value={gap} onChange={event => setGap(event.target.value)} /></label>
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
