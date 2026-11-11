import type { Point } from "./floor-plan-model";

export type PlanShortcut = { kind: "undo" } | { kind: "redo" } | { kind: "escape" } | { kind: "delete" } | { kind: "nudge"; by: Point; alone: boolean };
type Key = { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; target: EventTarget | null };

/** Somewhere keys belong to the control itself: a text box, a list, editable text or a button. */
export function ownsKeys(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  const element = target as HTMLElement;
  return element.isContentEditable === true || !!element.closest('input, textarea, select, button, [contenteditable=""], [contenteditable="true"], [role="textbox"], [role="combobox"]');
}

/**
 * The editor shortcut a key press means, or null. The editor only listens inside itself, and never while the reader is
 * typing in a field or using a button, so copy, paste and Delete keep working everywhere else on the page.
 */
export function planShortcut(event: Key, step: number): PlanShortcut | null {
  if (ownsKeys(event.target)) return null;
  const key = event.key.toLowerCase(), command = event.metaKey || event.ctrlKey;
  if (command && key === "z") return { kind: event.shiftKey ? "redo" : "undo" };
  if (event.ctrlKey && !event.metaKey && key === "y") return { kind: "redo" };
  if (command) return null;
  if (event.key === "Escape") return { kind: "escape" };
  if (event.key === "Delete" || event.key === "Backspace") return { kind: "delete" };
  const by = step * (event.shiftKey ? 5 : 1);
  const moves: Record<string, Point> = { ArrowLeft: [-by, 0], ArrowRight: [by, 0], ArrowUp: [0, -by], ArrowDown: [0, by] };
  return moves[event.key] ? { kind: "nudge", by: moves[event.key]!, alone: event.altKey } : null;
}
