"use client";
import { useState, type KeyboardEvent } from "react";
import { useMessages } from "./energyiq-locale";
import type { Field } from "./floor-plan-align";
import { floorPlanMessages } from "./floor-plan-messages";
import { MIN_SIZE, type Point, type Rect } from "./floor-plan-model";
import styles from "./floor-plan-editor.module.css";

const FIELDS: Field[] = ["x", "y", "w", "h"];
/** A typed whole or decimal number (a comma works as the decimal point too); null when it is not a number. */
export function parseAmount(text: string): number | null {
  const value = text.trim().replace(",", ".");
  return /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : null;
}

/**
 * Position and size of one item, typed exactly: X and Y from the top-left corner of the drawing space (`origin`), W and
 * H its size, in plan units. A value is used when the field is left or Enter is pressed (one undo step, never one per
 * key); Esc puts the value back. Something that is not a number is put back with a plain message. `onCommit` says
 * whether the value had to change to fit inside the plan.
 */
export function PositionFields({ box, origin, disabled, onCommit }: { box: Rect; origin: Point; disabled: boolean; onCommit: (field: Field, value: number) => boolean }) {
  const t = useMessages(floorPlanMessages);
  const [draft, setDraft] = useState<{ field: Field; text: string } | null>(null);
  const [message, setMessage] = useState<{ text: string; problem: boolean } | null>(null);
  const shown: Record<Field, number> = { x: Math.round(box[0] - origin[0]), y: Math.round(box[1] - origin[1]), w: Math.round(box[2]), h: Math.round(box[3]) };
  const finish = (field: Field) => {
    if (!draft || draft.field !== field) return;
    const value = parseAmount(draft.text); setDraft(null);
    if (value === null) { setMessage({ text: t("position.invalid"), problem: true }); return; }
    const rounded = Math.round(value);
    if (rounded === shown[field]) { setMessage(null); return; }
    setMessage(onCommit(field, rounded) ? { text: t("position.adjusted", { min: MIN_SIZE }), problem: false } : null);
  };
  const keys = (event: KeyboardEvent<HTMLInputElement>, field: Field) => {
    if (event.key === "Enter") { event.preventDefault(); finish(field); }
    if (event.key === "Escape") { setDraft(null); setMessage(null); }
  };
  return <fieldset className={styles.positionField} disabled={disabled}><legend>{t("position.title")}</legend>
    <div className={styles.positionGrid}>
      {FIELDS.map(field => <label key={field}><span title={t(`position.${field}Hint`)}>{t(`position.${field}`)}</span>
        {/* The hint is in the input's name too: a title alone never shows on touch screens or reaches screen readers. */}
        <input inputMode="decimal" autoComplete="off" aria-label={`${t(`position.${field}`)}: ${t(`position.${field}Hint`)}`} value={draft?.field === field ? draft.text : String(shown[field])}
          onFocus={() => { setDraft({ field, text: String(shown[field]) }); }} onChange={event => setDraft({ field, text: event.target.value })} onBlur={() => finish(field)} onKeyDown={event => keys(event, field)} />
      </label>)}
    </div>
    {message ? <small className={message.problem ? styles.fieldProblem : undefined} role={message.problem ? "alert" : "status"}>{message.text}</small> : <small>{t("position.hint")}</small>}
  </fieldset>;
}
