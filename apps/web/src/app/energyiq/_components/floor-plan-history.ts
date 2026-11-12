import type { FloorPlan, Selection } from "./floor-plan-model";

/** How many steps Undo can go back (and Redo forward). */
export const HISTORY_LIMIT = 100;
/**
 * One state of the editor: the plan and what was selected in it (several items can be selected at once), and the floor
 * shown (`level`, see floor-plan-levels), so Undo and Redo go back to the floor where the change was made.
 */
export type HistoryEntry = { plan: FloorPlan; selection: Selection[]; level?: string };
/** The floor shown in an entry, carried into the next one. */
const floorOf = (entry: HistoryEntry) => entry.level !== undefined ? { level: entry.level } : {};
/** `merge` names the last change so that typing into one field makes one undo step, not one per letter. */
export type PlanHistory = { present: HistoryEntry; past: HistoryEntry[]; future: HistoryEntry[]; merge?: string };

const push = (list: HistoryEntry[], entry: HistoryEntry) => [...list, entry].slice(-HISTORY_LIMIT);

export const startHistory = (plan: FloorPlan): PlanHistory => ({ present: { plan, selection: [] }, past: [], future: [] });
const NONE: Selection[] = [];
/** The same items, in the same order. */
export const sameSelection = (a: readonly Selection[], b: readonly Selection[]) => a === b || (a.length === b.length && a.every((item, index) => item.kind === b[index]!.kind && item.key === b[index]!.key));
export const canUndo = (history: PlanHistory) => history.past.length > 0;
export const canRedo = (history: PlanHistory) => history.future.length > 0;

/**
 * A finished change: one undo step, and nothing is left to redo. Changes with the same `merge` name in a row (letters
 * typed into one field) share one step.
 */
export function commitPlan(history: PlanHistory, plan: FloorPlan, options: { selection?: Selection[]; merge?: string } = {}): PlanHistory {
  const selection = options.selection ?? history.present.selection;
  if (plan === history.present.plan) return selectIn(history, selection);
  const merging = options.merge !== undefined && options.merge === history.merge && history.past.length > 0;
  return { past: merging ? history.past : push(history.past, history.present), present: { plan, selection, ...floorOf(history.present) }, future: [], ...(options.merge !== undefined ? { merge: options.merge } : {}) };
}
/** Leaving a field (or pressing Enter in it) ends the typing: what is typed next, even in the same field, is a new step. */
export const endTyping = (history: PlanHistory): PlanHistory => { if (history.merge === undefined) return history; const { merge: _merge, ...rest } = history; return rest; };
/** A change still under way, such as a drag: shown at once, but not an undo step until it is finished. */
export const showPlan = (history: PlanHistory, plan: FloorPlan, selection: Selection[] = history.present.selection): PlanHistory => plan === history.present.plan && sameSelection(selection, history.present.selection) ? history : { ...history, present: { plan, selection, ...floorOf(history.present) } };
/** Finishes a change that began at `before`: exactly one undo step back to it, whatever was shown along the way. */
export function finishChange(history: PlanHistory, before: HistoryEntry, plan: FloorPlan = history.present.plan): PlanHistory {
  if (plan === before.plan) return showPlan(history, plan);
  return { past: push(history.past, { ...floorOf(history.present), ...before }), present: { plan, selection: history.present.selection, ...floorOf(history.present) }, future: [] };
}
/** Selecting is not a change: it is never an undo step of its own. */
export function selectIn(history: PlanHistory, selection: Selection[] | null): PlanHistory {
  const next = selection ?? NONE;
  if (sameSelection(history.present.selection, next)) return history;
  return { ...history, present: { ...history.present, selection: next } };
}
export function undo(history: PlanHistory): PlanHistory {
  const last = history.past[history.past.length - 1];
  return last ? { past: history.past.slice(0, -1), present: last, future: [history.present, ...history.future].slice(0, HISTORY_LIMIT) } : history;
}
export function redo(history: PlanHistory): PlanHistory {
  const [next, ...rest] = history.future;
  return next ? { past: push(history.past, history.present), present: next, future: rest } : history;
}
/** Shows another floor: not a change, so never an undo step; what was selected on the other floor is let go. */
export function showLevel(history: PlanHistory, level: string, selection: Selection[] = NONE): PlanHistory {
  if (history.present.level === level && sameSelection(history.present.selection, selection)) return history;
  return { ...history, present: { ...history.present, level, selection } };
}
