import { clampRect, MIN_SIZE, snap, type Point, type Rect } from "./floor-plan-model";

/** The box between two corners, whichever way the pointer went. */
export const boxBetween = ([ax, ay]: Point, [bx, by]: Point): Rect => [Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay)];
/** The box between two corners, each on the grid. */
export const snappedBox = (a: Point, b: Point, step: number): Rect => boxBetween([snap(a[0], step), snap(a[1], step)], [snap(b[0], step), snap(b[1], step)]);
/** A box of `size` centred on a point, on the grid and inside the plan. */
export const centredBox = ([cx, cy]: Point, [w, h]: Point, bounds: Rect, step: number): Rect => clampRect([snap(cx - w / 2, step), snap(cy - h / 2, step), w, h], bounds);
/** A drag too small to be a box was a click: the item is added at its usual size there. */
export const isClick = (box: Rect) => Math.max(box[2], box[3]) < MIN_SIZE;
/** Whether `inner` lies fully inside `outer` (edges included). */
export const within = ([x, y, w, h]: Rect, [ox, oy, ow, oh]: Rect) => x >= ox && y >= oy && x + w <= ox + ow && y + h <= oy + oh;
/** How far a set of boxes can move by (dx, dy) and all stay inside the plan; each box keeps its place relative to the others. */
export function clampDelta(boxes: Rect[], [dx, dy]: Point, [vx, vy, vw, vh]: Rect): Point {
  if (!boxes.length) return [dx, dy];
  const lowX = Math.max(...boxes.map(([x]) => vx - x)), highX = Math.min(...boxes.map(([x, , w]) => vx + vw - x - w));
  const lowY = Math.max(...boxes.map(([, y]) => vy - y)), highY = Math.min(...boxes.map(([, y, , h]) => vy + vh - y - h));
  return [lowX > highX ? 0 : Math.min(Math.max(dx, lowX), highX), lowY > highY ? 0 : Math.min(Math.max(dy, lowY), highY)];
}
