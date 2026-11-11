"use client";
import { useState, type KeyboardEvent } from "react";
import { useMessages } from "./energyiq-locale";
import { floorPlanMessages } from "./floor-plan-messages";
import type { FloorPlan } from "./floor-plan-model";
import { PANEL_COLOURS } from "./site-floor-map";
import styles from "./floor-plan-editor.module.css";

/** A typed colour code as #rrggbb (lower case), with or without the #; null when it is not one. */
export function parseColour(text: string): string | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(text.trim());
  return match ? `#${match[1]!.toLowerCase()}` : null;
}

/**
 * The plan with a colour chosen for a panel (saved as `boardColours`, which the map, reports and editor all read), or
 * with the panel back on the automatic colour (`null`). Only a valid #rrggbb is kept; the same plan when nothing changes.
 */
export function withBoardColour(plan: FloorPlan, board: string, hex: string | null): FloorPlan {
  const colour = hex === null ? null : parseColour(hex), name = board.trim();
  if (!name || (hex !== null && !colour) || (plan.colours?.[name] ?? null) === colour) return plan;
  const { [name]: _old, ...rest } = plan.colours ?? {};
  const colours = colour ? { ...rest, [name]: colour } : rest;
  if (Object.keys(colours).length) return { ...plan, colours };
  const { colours: _none, ...without } = plan;
  return without;
}

/**
 * Picks a colour: one of the ten swatches, a custom colour (the computer's colour picker, or a typed #rrggbb code), or
 * the automatic colour (`null`). `onPick` with `live` is a colour picker still being dragged: the editor folds those into
 * one undo step, which `onDone` (leaving the picker) closes.
 */
export function ColourPicker({ legend, hint, value, autoLabel, onPick, onDone }: { legend: string; hint: string; value: string | undefined; autoLabel: string; onPick: (hex: string | null, live?: boolean) => void; onDone: () => void }) {
  const t = useMessages(floorPlanMessages);
  const [draft, setDraft] = useState<string | null>(null);
  const [problem, setProblem] = useState("");
  const custom = !!value && !PANEL_COLOURS.some(item => item.hex === value.toLowerCase());
  // A typed code is checked when the field is left or Enter is pressed: a code that is not a colour is put back.
  const finish = () => {
    if (draft === null) return;
    const typed = draft; setDraft(null);
    if (!typed.trim()) { setProblem(""); return; }
    const hex = parseColour(typed);
    if (!hex) { setProblem(t("colour.invalid")); return; }
    setProblem("");
    if (hex !== value?.toLowerCase()) onPick(hex);
  };
  const keys = (event: KeyboardEvent<HTMLInputElement>) => { if (event.key === "Enter") { event.preventDefault(); finish(); } if (event.key === "Escape") { setDraft(null); setProblem(""); } };
  return <fieldset className={styles.colourField}><legend>{legend}</legend>
    <div className={styles.swatches}>
      {PANEL_COLOURS.map(item => <button type="button" key={item.key} className={styles.swatchButton} style={{ background: item.hex }} aria-label={t(`colour.${item.key}`)} title={t(`colour.${item.key}`)} aria-pressed={value === item.hex} onClick={() => onPick(item.hex)} />)}
      <button type="button" className={styles.autoColour} aria-pressed={!value} onClick={() => onPick(null)}>{autoLabel}</button>
    </div>
    <div className={styles.customColour}>
      <input type="color" className={`${styles.colourWell} ${custom ? styles.colourWellOn : ""}`} aria-label={t("colour.pick")} title={t("colour.pick")} value={value ?? "#6b7480"} onChange={event => { const hex = parseColour(event.target.value); if (hex) onPick(hex, true); }} onBlur={onDone} />
      <label className={styles.colourCode}><span>{t("colour.code")}</span><input value={draft ?? value ?? ""} placeholder="#2a78d6" maxLength={7} spellCheck={false} autoComplete="off" aria-invalid={!!problem} onChange={event => setDraft(event.target.value)} onBlur={finish} onKeyDown={keys} /></label>
    </div>
    {problem ? <small className={styles.fieldProblem} role="alert">{problem}</small> : <small>{hint}</small>}
  </fieldset>;
}
