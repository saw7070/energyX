import type { FloorPlan, Selection } from "./floor-plan-model";

/** How many steps Undo can go back (and Redo forward). */
export const HISTORY_LIMIT = 100;
/** One state of the editor: the plan and what was selected in it. */
export type HistoryEntry = { plan: FloorPlan; selection: Selection | null };
/** `merge` names the last change so that typing into one field makes one undo step, not one per letter. */
export type PlanHistory = { present: HistoryEntry; past: HistoryEntry[]; future: HistoryEntry[]; merge?: string };

const push = (list: HistoryEntry[], entry: HistoryEntry) => [...list, entry].slice(-HISTORY_LIMIT);

export const startHistory = (plan: FloorPlan): PlanHistory => ({ present: { plan, selection: null }, past: [], future: [] });
export const canUndo = (history: PlanHistory) => history.past.length > 0;
export const canRedo = (history: PlanHistory) => history.future.length > 0;

/**
 * A finished change: one undo step, and nothing is left to redo. Changes with the same `merge` name in a row (letters
 * typed into one field) share one step.
 */
export function commitPlan(history: PlanHistory, plan: FloorPlan, options: { selection?: Selection | null; merge?: string } = {}): PlanHistory {
  const selection = options.selection === undefined ? history.present.selection : options.selection;
  if (plan === history.present.plan) return selectIn(history, selection);
  const merging = options.merge !== undefined && options.merge === history.merge && history.past.length > 0;
  return { past: merging ? history.past : push(history.past, history.present), present: { plan, selection }, future: [], ...(options.merge !== undefined ? { merge: options.merge } : {}) };
}
/** A change still under way, such as a drag: shown at once, but not an undo step until it is finished. */
export const showPlan = (history: PlanHistory, plan: FloorPlan): PlanHistory => plan === history.present.plan ? history : { ...history, present: { ...history.present, plan } };
/** Finishes a change that began at `before`: exactly one undo step back to it, whatever was shown along the way. */
export function finishChange(history: PlanHistory, before: HistoryEntry, plan: FloorPlan = history.present.plan): PlanHistory {
  if (plan === before.plan) return showPlan(history, plan);
  return { past: push(history.past, before), present: { plan, selection: history.present.selection }, future: [] };
}
/** Selecting is not a change: it is never an undo step of its own. */
export function selectIn(history: PlanHistory, selection: Selection | null): PlanHistory {
  const current = history.present.selection;
  if (current === selection || (current && selection && current.kind === selection.kind && current.key === selection.key)) return history;
  return { ...history, present: { ...history.present, selection } };
}
export function undo(history: PlanHistory): PlanHistory {
  const last = history.past[history.past.length - 1];
  return last ? { past: history.past.slice(0, -1), present: last, future: [history.present, ...history.future].slice(0, HISTORY_LIMIT) } : history;
}
export function redo(history: PlanHistory): PlanHistory {
  const [next, ...rest] = history.future;
  return next ? { past: push(history.past, history.present), present: next, future: rest } : history;
}
