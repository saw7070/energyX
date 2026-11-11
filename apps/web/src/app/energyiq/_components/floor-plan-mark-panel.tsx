"use client";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useMessages } from "./energyiq-locale";
import { floorPlanMessages } from "./floor-plan-messages";
import { isKnownSymbol, LABEL_SIZES, normaliseRotation, ROTATION_STEP, sizeFor, sizeName, SYMBOL_KINDS, SYMBOL_SIZES, TEXT_MAX, type LabelSize, type PlanLabel, type PlanSymbol, type SymbolSizeName } from "./floor-plan-marks";
import { parseAmount } from "./floor-plan-position";
import { SymbolIcon } from "./plan-symbols";
import { planSymbolMessages } from "./plan-symbol-messages";
import styles from "./floor-plan-editor.module.css";

/** Typing in a field: one undo step per field, closed when the field is left or Enter is pressed. */
type Typing = { onBlur: () => void; onKeyDown: (event: KeyboardEvent) => void };
const SIZE_NAMES = Object.keys(SYMBOL_SIZES) as SymbolSizeName[];
const SIZE_WORD = { s: "panel.sizeS", m: "panel.sizeM", l: "panel.sizeL", xl: "panel.sizeXl" } as const;
/** A landmark kind in the reader's language (a kind this version does not know reads "Landmark"). */
export function useKindName() {
  const t = useMessages(planSymbolMessages);
  return (kind: string) => t(isKnownSymbol(kind) ? kind : "other");
}

/**
 * How far an item is turned: a turn left or right by 15°, or any angle typed in degrees (clockwise), used when the field
 * is left or Enter is pressed (one undo step, never one per key); Esc puts the value back.
 */
export function RotationField({ value, disabled, commandKey, onCommit }: { value: number; disabled: boolean; commandKey: string; onCommit: (deg: number) => void }) {
  const t = useMessages(floorPlanMessages);
  const [draft, setDraft] = useState<string | null>(null);
  const [problem, setProblem] = useState(false);
  const finish = () => {
    if (draft === null) return;
    const typed = parseAmount(draft); setDraft(null);
    if (typed === null) { setProblem(true); return; }
    setProblem(false);
    const deg = normaliseRotation(typed);
    if (deg !== value) onCommit(deg);
  };
  const keys = (event: KeyboardEvent<HTMLInputElement>) => { if (event.key === "Enter") { event.preventDefault(); finish(); } if (event.key === "Escape") { setDraft(null); setProblem(false); } };
  const step = (by: number) => onCommit(normaliseRotation(Math.round((value + by) / ROTATION_STEP) * ROTATION_STEP));
  return <fieldset className={styles.positionField} disabled={disabled}><legend>{t("rotate.title")}</legend>
    <div className={styles.arrangeRow}>
      <button type="button" className={styles.tool} aria-label={t("rotate.left")} title={t("rotate.left")} onClick={() => step(-ROTATION_STEP)}>↺ 15°</button>
      <label className={styles.rotateField}><span className={styles.srOnly}>{t("rotate.degrees")}</span>
        <input inputMode="decimal" autoComplete="off" aria-label={t("rotate.degrees")} aria-invalid={problem} value={draft ?? String(value)} onFocus={() => setDraft(String(value))} onChange={event => setDraft(event.target.value)} onBlur={finish} onKeyDown={keys} /><span aria-hidden="true">°</span>
      </label>
      <button type="button" className={styles.tool} aria-label={t("rotate.right")} title={t("rotate.right")} onClick={() => step(ROTATION_STEP)}>↻ 15°</button>
    </div>
    {problem ? <small className={styles.fieldProblem} role="alert">{t("rotate.invalid")}</small> : <small>{t("rotate.hint", { commandKey })}</small>}
  </fieldset>;
}

/** A landmark's size: Small, Medium, Large or Extra large (a size saved some other way is shown as it is). */
function SymbolSize({ symbol, unit, disabled, onSize }: { symbol: Pick<PlanSymbol, "kind" | "size">; unit: number; disabled: boolean; onSize: (size: number) => void }) {
  const t = useMessages(floorPlanMessages);
  const named = sizeName(symbol, unit);
  return <label>{t("panel.size")}<select value={named ?? "own"} disabled={disabled} onChange={event => { if (event.target.value !== "own") onSize(sizeFor(symbol.kind, event.target.value as SymbolSizeName, unit)); }}>
    {SIZE_NAMES.map(name => <option key={name} value={name}>{t(SIZE_WORD[name])}</option>)}
    {!named && <option value="own">{t("panel.sizeOwn", { size: Math.round(symbol.size ?? 0) })}</option>}
  </select></label>;
}

/** What the panels share: the colour picker, the position fields and the shared actions are built by the editor. */
type PanelParts = { colour: ReactNode; position?: ReactNode; actions: ReactNode; locked: boolean; typing: Typing; commandKey: string; unit: number; onRotate: (deg: number) => void; onDelete: () => void };

/** A text label: its text (up to 80 characters), size, bold, colour, turn and place. */
export function LabelPanel({ label, onText, onSize, onBold, colour, position, actions, locked, typing, commandKey, onRotate, onDelete }: PanelParts & { label: PlanLabel; onText: (text: string) => void; onSize: (size: LabelSize) => void; onBold: (bold: boolean) => void }) {
  const t = useMessages(floorPlanMessages);
  return <div className={styles.panel}>
    <h5>{t("panel.text")}</h5>
    <label>{t("panel.textField")}<input value={label.text} maxLength={TEXT_MAX} disabled={locked} {...typing} onChange={event => onText(event.target.value)} /></label>
    <label>{t("panel.textSize")}<select value={label.size ?? "m"} disabled={locked} onChange={event => onSize(event.target.value as LabelSize)}>{LABEL_SIZES.map(size => <option key={size} value={size}>{t(SIZE_WORD[size])}</option>)}</select></label>
    <label className={styles.check}><input type="checkbox" checked={!!label.bold} disabled={locked} onChange={event => onBold(event.target.checked)} />{t("panel.bold")}</label>
    {colour}
    <RotationField key={`turn:${label.key}`} value={label.rotation ?? 0} disabled={locked} commandKey={commandKey} onCommit={onRotate} />
    {position}
    {actions}
    <p className={styles.hint}>{t("panel.marksNote")}</p>
    <button type="button" className={styles.danger} disabled={locked} onClick={onDelete}>{t("panel.deleteText")}</button>
  </div>;
}

/**
 * A landmark, or the first entrance (`entrance`: it stays an entrance, and its name is what older readers show): what
 * it shows, its caption, size, colour, turn and place.
 */
export function SymbolPanel({ symbol, entrance = false, onKind, onCaption, onSize, colour, position, actions, locked, typing, commandKey, unit, onRotate, onDelete }: PanelParts & { symbol: Pick<PlanSymbol, "key" | "kind" | "size" | "rotation" | "label">; entrance?: boolean; onKind?: (kind: string) => void; onCaption: (caption: string) => void; onSize: (size: number) => void }) {
  const t = useMessages(floorPlanMessages), kindName = useKindName();
  return <div className={styles.panel}>
    <h5>{entrance ? t("panel.entrance") : t("panel.landmark")}</h5>
    {!entrance && onKind && <label>{t("panel.kind")}<select value={symbol.kind} disabled={locked} onChange={event => onKind(event.target.value)}>
      {SYMBOL_KINDS.map(kind => <option key={kind} value={kind}>{kindName(kind)}</option>)}
      {!isKnownSymbol(symbol.kind) && <option value={symbol.kind}>{t("panel.kindOther", { kind: symbol.kind })}</option>}
    </select></label>}
    <label>{entrance ? t("panel.label") : t("panel.caption")}<input value={symbol.label ?? ""} maxLength={entrance ? 40 : TEXT_MAX} disabled={locked} {...typing} onChange={event => onCaption(event.target.value)} />{!entrance && <small>{t("panel.captionHint")}</small>}</label>
    <SymbolSize symbol={symbol} unit={unit} disabled={locked} onSize={onSize} />
    {colour}
    <RotationField key={`turn:${symbol.key}`} value={symbol.rotation ?? 0} disabled={locked} commandKey={commandKey} onCommit={onRotate} />
    {position}
    {actions}
    <p className={styles.hint}>{t("panel.marksNote")}</p>
    <button type="button" className={styles.danger} disabled={locked} onClick={onDelete}>{entrance ? t("panel.removeEntrance") : t("panel.deleteLandmark")}</button>
  </div>;
}

/**
 * The toolbar's + Landmark button: a small menu of landmarks, each with its icon and plain name. Picking one starts
 * placing it (the next click on the plan puts it there). It closes on Esc, on a pick or on a click elsewhere, and Esc puts
 * focus back on the button so the editor's keys keep working.
 */
export function LandmarkPicker({ chosen, hint, onPick }: { chosen: string | null; hint: string; onPick: (kind: string) => void }) {
  const t = useMessages(floorPlanMessages), kindName = useKindName();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null), menu = useId();
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { if (root.current && !root.current.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  return <div className={styles.gridMenu} ref={root} onKeyDown={event => { if (event.key === "Escape" && open) { event.stopPropagation(); setOpen(false); button.current?.focus(); } }}>
    <button ref={button} type="button" className={styles.tool} aria-expanded={open} aria-controls={open ? menu : undefined} aria-pressed={chosen !== null} title={hint} onClick={() => setOpen(current => !current)}>{t("editor.addLandmark")}</button>
    {open && <div id={menu} className={`${styles.gridPopover} ${styles.landmarkMenu}`} role="group" aria-label={t("editor.landmarks")}>
      {SYMBOL_KINDS.map(kind => <button key={kind} type="button" className={styles.landmarkChoice} aria-pressed={chosen === kind} onClick={() => { setOpen(false); onPick(kind); }}><SymbolIcon kind={kind} /><span>{kindName(kind)}</span></button>)}
      <p className={styles.hint}>{hint}</p>
    </div>}
  </div>;
}
