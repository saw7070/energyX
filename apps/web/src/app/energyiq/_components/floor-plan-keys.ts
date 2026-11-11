import type { Point } from "./floor-plan-model";

export type PlanShortcut = { kind: "undo" } | { kind: "redo" } | { kind: "escape" } | { kind: "delete" } | { kind: "nudge"; by: Point; alone: boolean } | { kind: "copy" } | { kind: "paste" } | { kind: "duplicate" } | { kind: "selectAll" }
  | { kind: "resize"; by: Point } | { kind: "cycle"; by: 1 | -1 } | { kind: "select"; toggle: boolean } | { kind: "zoom"; how: "in" | "out" | "fit" };
/** Cmd/Ctrl + these keys zoom the plan (never the page) while focus is in the editor: + or =, −, and 0 for the whole plan. */
const ZOOM_KEYS: Record<string, "in" | "out" | "fit"> = { "=": "in", "+": "in", "-": "out", "_": "out", "0": "fit" };
/** Cmd/Ctrl + these letters: copy, paste, duplicate and select all, inside the editor only. */
const COMMANDS: Record<string, PlanShortcut> = { c: { kind: "copy" }, v: { kind: "paste" }, d: { kind: "duplicate" }, a: { kind: "selectAll" } };
type Key = { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; target: EventTarget | null };

const closest = (target: EventTarget | null, selector: string) => !!target && typeof (target as Element).closest === "function" && !!(target as Element).closest(selector);
/** Somewhere the reader types or picks from a list: every key belongs to the control itself. */
export function isTextEntry(target: EventTarget | null): boolean {
  return (target as HTMLElement | null)?.isContentEditable === true || closest(target, 'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"], [role="combobox"]');
}
/** A button: it uses Space, Enter and the arrow keys itself, and Delete there must never remove what is on the plan. */
export const isButton = (target: EventTarget | null) => closest(target, 'button, [role="button"]');
const BUTTON_KEYS = new Set(["Delete", "Backspace", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " ", "Spacebar", "Enter"]);

/**
 * The editor shortcut a key press means, or null. The editor only listens inside itself, and never while the reader is
 * typing in a field, so copy, paste and Delete keep working everywhere else on the page. On a button (Undo, a colour,
 * Place…) Undo, Redo and Escape still work, but Delete and the arrow keys are left to the button. Copy, paste, duplicate
 * and select all work on the plan's own items (the editor keeps its own clipboard; the computer's is never touched).
 */
export function planShortcut(event: Key, step: number): PlanShortcut | null {
  if (isTextEntry(event.target)) return null;
  if (isButton(event.target) && BUTTON_KEYS.has(event.key)) return null;
  const key = event.key.toLowerCase(), command = event.metaKey || event.ctrlKey;
  if (command && key === "z") return { kind: event.shiftKey ? "redo" : "undo" };
  if (event.ctrlKey && !event.metaKey && key === "y") return { kind: "redo" };
  if (command && !event.altKey && ZOOM_KEYS[event.key]) return { kind: "zoom", how: ZOOM_KEYS[event.key]! };
  // Cmd/Ctrl+arrow resizes the selected item by one grid step (right and down make it bigger; Shift for five). Alt with
  // an arrow stays "nudge an area on its own", with or without Shift.
  const resize = (step || 1) * (event.shiftKey ? 5 : 1);
  const sizes: Record<string, Point> = { ArrowLeft: [-resize, 0], ArrowRight: [resize, 0], ArrowUp: [0, -resize], ArrowDown: [0, resize] };
  if (command && !event.altKey && sizes[event.key]) return { kind: "resize", by: sizes[event.key]! };
  if (command) return !event.shiftKey && !event.altKey && COMMANDS[key] ? COMMANDS[key]! : null;
  if (event.key === "Escape") return { kind: "escape" };
  if (event.key === "Delete" || event.key === "Backspace") return { kind: "delete" };
  // [ and ] go through the items on the plan one by one; Enter selects the one with focus (Shift+Enter adds it).
  if ((event.key === "[" || event.key === "]") && !event.altKey) return { kind: "cycle", by: event.key === "]" ? 1 : -1 };
  if (event.key === "Enter") return { kind: "select", toggle: event.shiftKey };
  const by = step * (event.shiftKey ? 5 : 1);
  const moves: Record<string, Point> = { ArrowLeft: [-by, 0], ArrowRight: [by, 0], ArrowUp: [0, -by], ArrowDown: [0, by] };
  return moves[event.key] ? { kind: "nudge", by: moves[event.key]!, alone: event.altKey } : null;
}
