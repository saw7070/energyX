/**
 * Placing things precisely: the grid choices saved with the layout, and alignment guides that pull a dragged item onto
 * the edges and centres of the items around it.
 */
import { isRecord } from "./floor-plan-carry";
import type { FloorPlan, Rect } from "./floor-plan-model";

export const GRID_SIZES = [5, 10, 20, 50] as const;
export type GridSize = typeof GRID_SIZES[number];
/** The editor's grid choices: grid spacing in plan units, whether dragging snaps to it, and whether it is drawn. */
export type EditorPrefs = { grid: GridSize; snap: boolean; showGrid: boolean };
/** What a layout saved without grid choices gets: snapping on a grid of 10, grid shown (as the editor always did). */
export const DEFAULT_PREFS: EditorPrefs = { grid: 10, snap: true, showGrid: true };

/** The grid choices saved with the plan; anything missing or not understood (saved data is untrusted) reads as the default. */
export function editorPrefs(plan: Pick<FloorPlan, "editor">): EditorPrefs {
  const raw = isRecord(plan.editor) ? plan.editor : {};
  return {
    grid: (GRID_SIZES as readonly unknown[]).includes(raw.grid) ? raw.grid as GridSize : DEFAULT_PREFS.grid,
    snap: typeof raw.snap === "boolean" ? raw.snap : DEFAULT_PREFS.snap,
    showGrid: typeof raw.showGrid === "boolean" ? raw.showGrid : DEFAULT_PREFS.showGrid,
  };
}
export const samePrefs = (a: EditorPrefs, b: EditorPrefs) => a.grid === b.grid && a.snap === b.snap && a.showGrid === b.showGrid;
/**
 * The plan with these grid choices saved in `layout.editor`. The same plan when they are what it already reads as, so a
 * layout saved without choices stays exactly as it was until someone changes one. Other keys in the block stay as saved.
 */
export function withPrefs(plan: FloorPlan, prefs: EditorPrefs): FloorPlan {
  if (samePrefs(editorPrefs(plan), prefs)) return plan;
  return { ...plan, editor: { ...(plan.editor ?? {}), grid: prefs.grid, snap: prefs.snap, showGrid: prefs.showGrid } };
}
/** Grid lines drawn every other grid step, spaced out further on a big plan so the lines never crowd together. */
export function gridSpacing(grid: number, planWidth: number): number {
  let spacing = grid * 2;
  while (spacing < planWidth / 250) spacing *= 2;
  return spacing;
}

/** A line to line up with: where it is on one axis, and where its item starts and ends on the other. */
type Line = { at: number; from: number; to: number };
/** The edges and centres of the items a dragged item can line up with, sorted, worked out once when a drag starts. */
export type GuideTargets = { x: Line[]; y: Line[] };
/** A thin guide line to draw: vertical at x = `at` (axis "x") or horizontal at y = `at` (axis "y"), from `from` to `to`. */
export type Guide = { axis: "x" | "y"; at: number; from: number; to: number };

export function guideTargets(boxes: Rect[]): GuideTargets {
  const lines = (pick: (box: Rect) => [number, number, number, number]) => boxes.flatMap(box => { const [start, size, from, length] = pick(box); return [0, 0.5, 1].map(part => ({ at: start + size * part, from, to: from + length })); }).sort((a, b) => a.at - b.at);
  return { x: lines(([x, y, w, h]) => [x, w, y, h]), y: lines(([x, y, w, h]) => [y, h, x, w]) };
}

/** The target line nearest to `value` (binary search, so big plans stay smooth while dragging). */
function nearest(lines: Line[], value: number): Line | undefined {
  let low = 0, high = lines.length - 1;
  while (low < high) { const middle = (low + high) >> 1; if (lines[middle]!.at < value) low = middle + 1; else high = middle; }
  const after = lines[low], before = lines[low - 1];
  if (!after) return before;
  return before && value - before.at <= after.at - value ? before : after;
}

/**
 * Pulls the closest of `values` (a dragged item's edges or centre on one axis) onto the nearest target line within
 * `reach`: how far to shift, and the line it lines up with. Null when nothing is close enough.
 */
export function snapToLines(lines: Line[], values: number[], reach: number): { shift: number; at: number } | null {
  let best: { shift: number; at: number } | null = null;
  for (const value of values) {
    const line = nearest(lines, value);
    if (line && Math.abs(line.at - value) <= reach && (!best || Math.abs(line.at - value) < Math.abs(best.shift))) best = { shift: line.at - value, at: line.at };
  }
  return best;
}

/** The guide lines to draw for a box lined up at `at` on one axis: across the box and every item lined up with it there. */
export function guideFor(lines: Line[], axis: Guide["axis"], at: number, box: Rect): Guide {
  const [from, length] = axis === "x" ? [box[1], box[3]] : [box[0], box[2]];
  const matching = lines.filter(line => Math.abs(line.at - at) < 0.5);
  return { axis, at, from: Math.min(from, ...matching.map(line => line.from)), to: Math.max(from + length, ...matching.map(line => line.to)) };
}

/** The box around a set of boxes. */
export const boundsOf = (boxes: Rect[]): Rect => {
  const left = Math.min(...boxes.map(box => box[0])), top = Math.min(...boxes.map(box => box[1]));
  return [left, top, Math.max(...boxes.map(box => box[0] + box[2])) - left, Math.max(...boxes.map(box => box[1] + box[3])) - top];
};
