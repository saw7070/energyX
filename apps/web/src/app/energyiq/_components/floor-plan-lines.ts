/**
 * Walls, partitions, fences and road edges the reader draws as lines through points. Like any other item they can be
 * selected, moved, copied, locked and deleted, and each point can be dragged, added or taken away. Drawing only: a wall
 * never changes how meters are grouped.
 *
 * Saved layouts are untrusted: only well-formed lines are read (see project-spatial-drawing), their points are kept inside
 * the plan, and anything else a line carries rides along as saved. Entries the editor cannot read (malformed, a repeated
 * id, past the cap) are kept as saved too, and written back after the editor's own, so a save never loses them.
 */
import { isSpatialLine, MAX_LINE_COORD, MAX_LINE_POINTS, MAX_LINES, type SpatialLineStyle, type SpatialLineThickness } from "@datafoundry/contracts";
import { carriedOf, withCarried, type Carried } from "./floor-plan-carry";
import type { FloorPlan, Point, Rect } from "./floor-plan-model";

/** `savedPoints` holds the points as saved while `points` is still the list read with them (any change makes a new list). */
export type PlanLine = { key: string; points: Point[]; style: SpatialLineStyle; thickness?: SpatialLineThickness; locked?: true; savedPoints?: { read: Point[]; value: Array<[number, number]> }; level?: string } & Carried;
export { MAX_LINE_POINTS, MAX_LINES };

/** A point kept inside the plan, and never past what a saved line may hold (0 to MAX_LINE_COORD). */
export const inside = ([x, y]: Point, [vx, vy, vw, vh]: Rect): Point => [Math.min(Math.max(vx, x, 0), vx + vw, MAX_LINE_COORD), Math.min(Math.max(vy, y, 0), vy + vh, MAX_LINE_COORD)];
/** The lines a saved layout holds, with their points kept inside the plan; `skipped` gets the entries the editor cannot read. */
export function readLines(raw: unknown, viewBox: Rect, skipped: unknown[] = []): PlanLine[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>(), list: PlanLine[] = [];
  for (const item of raw) {
    if (list.length >= MAX_LINES || !isSpatialLine(item) || seen.has(item.id)) { skipped.push(item); continue; }
    seen.add(item.id);
    const owned = ["id", "points", "style", "thickness", ...(item.locked === true ? ["locked"] : [])], points = item.points.map(point => inside(point, viewBox));
    list.push({ key: item.id, points, style: item.style, ...(item.thickness ? { thickness: item.thickness } : {}), ...(item.locked === true ? { locked: true as const } : {}), savedPoints: { read: points, value: item.points }, ...carriedOf(item, owned) });
  }
  return list;
}
/** The lines as saved: points nobody moved exactly as they were, moved ones on whole plan units; then the entries the editor could not read. */
export const writeLines = (plan: FloorPlan): unknown[] => [
  ...(plan.lines ?? []).map(item => withCarried({ id: item.key, points: item.savedPoints?.read === item.points ? item.savedPoints.value : item.points.map(point => point.map(Math.round)), style: item.style, ...(item.thickness ? { thickness: item.thickness } : {}), ...(item.locked ? { locked: true } : {}) }, item)),
  ...(plan.carried?.lines ?? []),
];

/** The box around a line's points (never quite empty, so a straight line still reads as having a size). */
export function lineBox(line: { points: Point[] }): Rect {
  const xs = line.points.map(point => point[0]), ys = line.points.map(point => point[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return [x, y, Math.max(Math.max(...xs) - x, 0.01), Math.max(Math.max(...ys) - y, 0.01)];
}
export const findLine = (plan: FloorPlan, key: string) => plan.lines?.find(item => item.key === key);
const replace = (plan: FloorPlan, key: string, change: (line: PlanLine) => PlanLine): FloorPlan => {
  let changed = false;
  const lines = (plan.lines ?? []).map(item => { if (item.key !== key) return item; const next = change(item); changed ||= next !== item; return next; });
  return changed ? { ...plan, lines } : plan;
};
/** Moves the named lines by (dx, dy), as already kept inside the plan by the caller. */
export const shiftLines = (plan: FloorPlan, keys: Set<string>, dx: number, dy: number): FloorPlan => !keys.size || (!dx && !dy) ? plan : { ...plan, lines: (plan.lines ?? []).map(item => keys.has(item.key) ? { ...item, points: item.points.map(([x, y]) => inside([x + dx, y + dy], plan.viewBox)) } : item) };
/** Moves one line by (dx, dy) without leaving the plan (it stops at the edge as a whole). */
export function moveLine(plan: FloorPlan, key: string, dx: number, dy: number): FloorPlan {
  const line = findLine(plan, key);
  if (!line || line.locked) return plan;
  const [x, y, w, h] = lineBox(line), [vx, vy, vw, vh] = plan.viewBox;
  const mx = Math.min(Math.max(dx, vx - x), vx + vw - x - (w > 0.01 ? w : 0)), my = Math.min(Math.max(dy, vy - y), vy + vh - y - (h > 0.01 ? h : 0));
  return shiftLines(plan, new Set([key]), mx, my);
}
/** Puts one point of a line at `to` (inside the plan). */
export const setPoint = (plan: FloorPlan, key: string, index: number, to: Point): FloorPlan => replace(plan, key, line => {
  const at = inside(to, plan.viewBox), old = line.points[index];
  if (!old || line.locked || (old[0] === at[0] && old[1] === at[1])) return line;
  return { ...line, points: line.points.map((point, place) => place === index ? at : point) };
});
/** Adds a point to a line after point `after` (up to MAX_LINE_POINTS). */
export const insertPoint = (plan: FloorPlan, key: string, after: number, at: Point): FloorPlan => replace(plan, key, line => line.locked || line.points.length >= MAX_LINE_POINTS || after < 0 || after >= line.points.length - 1 ? line : { ...line, points: [...line.points.slice(0, after + 1), inside(at, plan.viewBox), ...line.points.slice(after + 1)] });
/** Takes one point out of a line; a line always keeps at least two. */
export const removePoint = (plan: FloorPlan, key: string, index: number): FloorPlan => replace(plan, key, line => line.locked || line.points.length <= 2 || !line.points[index] ? line : { ...line, points: line.points.filter((_, place) => place !== index) });
/** Changes a line's style or thickness. */
export const restyleLine = (plan: FloorPlan, key: string, patch: { style?: SpatialLineStyle; thickness?: SpatialLineThickness }): FloorPlan => replace(plan, key, line => (patch.style ?? line.style) === line.style && (patch.thickness ?? line.thickness ?? "m") === (line.thickness ?? "m") ? line : { ...line, ...patch });

/** The segment of a line nearest a point (its first point's index) and the nearest place on it. */
/**
 * Where "Add point" puts a new point: in the middle of the segment after the picked point (or before it, for the last
 * point), else in the middle of the longest segment. For touch screens and keyboards, where double-clicking is not easy.
 */
export function midpointAfter(points: Point[], picked: number | null): { after: number; at: Point } | null {
  if (points.length < 2) return null;
  let after = picked !== null && picked >= 0 && picked < points.length ? Math.min(picked, points.length - 2) : -1;
  if (after < 0) { let longest = -1; for (let index = 0; index < points.length - 1; index += 1) { const [ax, ay] = points[index]!, [bx, by] = points[index + 1]!, length = Math.hypot(bx - ax, by - ay); if (length > longest) { longest = length; after = index; } } }
  const [ax, ay] = points[after]!, [bx, by] = points[after + 1]!;
  return { after, at: [(ax + bx) / 2, (ay + by) / 2] };
}
export function nearestSegment(points: Point[], [px, py]: Point): { after: number; at: Point; distance: number } | null {
  let best: { after: number; at: Point; distance: number } | null = null;
  for (let index = 0; index < points.length - 1; index += 1) {
    const [ax, ay] = points[index]!, [bx, by] = points[index + 1]!, dx = bx - ax, dy = by - ay, length = dx * dx + dy * dy;
    const t = length ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / length)) : 0, at: Point = [ax + t * dx, ay + t * dy];
    const distance = Math.hypot(px - at[0], py - at[1]);
    if (!best || distance < best.distance) best = { after: index, at, distance };
  }
  return best;
}
/** Line keys (their saved ids) already used: on this floor, by entries kept as saved, and (for one floor of several) on the other floors. */
export const takenLineKeys = (plan: FloorPlan) => new Set([...(plan.lines ?? []).map(item => item.key), ...(plan.carried?.lines ?? []).flatMap(item => typeof (item as { id?: unknown } | null)?.id === "string" ? [(item as { id: string }).id] : []), ...(plan.elsewhere?.drawingIds ?? [])]);
/** How many lines the site holds: the stored format's limit counts every floor. */
export const lineCount = (plan: FloorPlan) => (plan.lines?.length ?? 0) + (plan.elsewhere?.lines ?? 0);
/** A new line key no other line has, on any floor. */
export function newLineKey(plan: FloorPlan, prefix = "ln"): string {
  const taken = takenLineKeys(plan);
  let number = taken.size + 1; while (taken.has(`${prefix}-${number}`)) number += 1;
  return `${prefix}-${number}`;
}
/** Adds a finished line through `points` (two or more, repeats in a row dropped). Null when it is too short or the plan is full. */
export function addLine(plan: FloorPlan, points: Point[], style: SpatialLineStyle = "wall"): { plan: FloorPlan; key: string } | null {
  const clean = points.map(point => inside(point, plan.viewBox)).filter((point, index, list) => index === 0 || point[0] !== list[index - 1]![0] || point[1] !== list[index - 1]![1]).slice(0, MAX_LINE_POINTS);
  if (clean.length < 2 || lineCount(plan) >= MAX_LINES) return null;
  const key = newLineKey(plan);
  return { plan: { ...plan, lines: [...(plan.lines ?? []), { key, points: clean, style }] }, key };
}
