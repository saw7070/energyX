/**
 * Free shapes in the layout editor: areas and rooms drawn as an L, U or T, or any outline clicked corner by corner.
 *
 * On the plan an item keeps its `rect` (always the box around its shape) and holds its shape as `outline`: each corner
 * as a fraction of that box (0 at its left or top edge, 1 at its right or bottom). So everything that moves, resizes,
 * lines up, copies or shifts a box moves and stretches the shape with it, and nothing else needs to know about shapes.
 * The saved layout holds absolute `points` (see spatial-polygon in the contracts package), turned to and from
 * `outline` here. Saved points are untrusted: malformed ones are never read as a shape (the item stays a box and the
 * saved value rides along unchanged).
 */
import { innerBox, MAX_POLYGON_POINTS, MIN_POLYGON_POINTS, pointInPolygon, polygonBounds, polygonOf, selfIntersects, signedArea } from "@datafoundry/contracts";
import { centre, clampPoint, MIN_SIZE, snap, type Point, type Rect } from "./floor-plan-model";

export { MAX_POLYGON_POINTS, MIN_POLYGON_POINTS };
/** The shapes offered when adding an area, a room or a plain shape. "draw" means clicking the corners one by one. */
export const SHAPE_PRESETS = ["rect", "L", "U", "T"] as const;
export type ShapePreset = typeof SHAPE_PRESETS[number];
export type ShapeChoice = ShapePreset | "draw";
/** Something with a box and, maybe, a shape inside it. */
export type Outlined = { rect: Rect; outline?: Point[] };

/** Each preset's corners as fractions of its box. The arms are about 40% of the box, wide enough to hold a room. */
const PRESET_OUTLINES: Record<Exclude<ShapePreset, "rect">, Point[]> = {
  L: [[0, 0], [0.45, 0], [0.45, 0.55], [1, 0.55], [1, 1], [0, 1]],
  U: [[0, 0], [0.35, 0], [0.35, 0.6], [0.65, 0.6], [0.65, 0], [1, 0], [1, 1], [0, 1]],
  T: [[0, 0], [1, 0], [1, 0.4], [0.68, 0.4], [0.68, 1], [0.32, 1], [0.32, 0.4], [0, 0.4]],
};
/** The outline a preset gives (none for a plain rectangle). */
export const presetOutline = (preset: ShapePreset): Point[] | undefined => preset === "rect" ? undefined : PRESET_OUTLINES[preset].map(([x, y]) => [x, y] as Point);

/** The corners in plan units. */
export const cornersOf = ({ rect: [x, y, w, h], outline }: Outlined): Point[] | null => outline ? outline.map(([fx, fy]) => [x + fx * w, y + fy * h] as Point) : null;
/** The four corners of a box, clockwise from the top left. */
export const boxCorners = ([x, y, w, h]: Rect): Point[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
/** Corners in plan units as a box and an outline in that box; null when the corners do not make a shape at least MIN_SIZE across. */
export function fromCorners(corners: Point[]): Outlined | null {
  if (corners.length < MIN_POLYGON_POINTS) return null;
  const rect = polygonBounds(corners) as Rect, [x, y, w, h] = rect;
  if (w < MIN_SIZE || h < MIN_SIZE) return null;
  return { rect, outline: corners.map(([px, py]) => [(px - x) / w, (py - y) / h] as Point) };
}
/** Why a set of corners cannot be a shape, in a word the editor turns into a plain message; null when it can. */
export function shapeProblem(corners: Point[]): "few" | "many" | "crossing" | "small" | null {
  if (corners.length < MIN_POLYGON_POINTS) return "few";
  if (corners.length > MAX_POLYGON_POINTS) return "many";
  if (Math.abs(signedArea(corners)) < 1e-6 || selfIntersects(corners)) return "crossing";
  return fromCorners(corners) ? null : "small";
}
/** The saved points read as a shape in the item's box (null when malformed: the item stays a box). */
export function outlineFromSaved(points: unknown, rect: Rect): Point[] | null {
  // Every outline the readers (the Facility map, the site report) draw is read, however small, so the editor shows what
  // they show; the MIN_SIZE check is only for new drawing.
  const polygon = polygonOf(points, rect);
  if (!polygon) return null;
  // Corners are held as fractions of the item's own saved box, so they stay exactly where they were saved. Writers
  // always save that box as the one around the corners; a hand-edited box larger than the shape is tightened to it
  // on the next save.
  const [x, y, w, h] = rect;
  return polygon.map(([px, py]) => [(px - x) / w, (py - y) / h] as Point);
}
/** The shape's box and absolute points to save, rounded to whole plan units. */
export function savedShape(item: Outlined): { rect: Rect; points: Point[] } | null {
  const corners = cornersOf(item);
  if (!corners) return null;
  const points = corners.map(([x, y]) => [Math.round(x), Math.round(y)] as Point);
  // Rounding can fold a tiny shape; then it is saved as its box.
  if (shapeProblem(points) === "crossing" || shapeProblem(points) === "few") return null;
  return { rect: polygonBounds(points) as Rect, points };
}

/** Whether a point is inside the item: inside its shape when it has one, else inside its box. */
export function holds(item: Outlined, point: Point): boolean {
  const [x, y, w, h] = item.rect;
  if (point[0] < x || point[0] > x + w || point[1] < y || point[1] > y + h) return false;
  const corners = cornersOf(item);
  return !corners || pointInPolygon(point, corners);
}
/** The largest upright box inside the item: where its label goes and where things are placed in it. Its box when it has no shape. */
export function insideBox(item: Outlined): Rect {
  const corners = cornersOf(item);
  return corners ? innerBox(corners) as Rect : item.rect;
}
/** A point that is surely inside the item: the middle of its box, or for a shape whose middle is outside it, the middle of its largest part. */
export function middleOf(item: Outlined): Point {
  const middle = centre(item.rect);
  return holds(item, middle) ? middle : centre(insideBox(item));
}

/** The point moved so the line from `from` runs across, down or at 45 degrees (Shift while dragging a corner). */
export function lockAngle(from: Point, to: Point): Point {
  const dx = to[0] - from[0], dy = to[1] - from[1], length = Math.hypot(dx, dy);
  if (!length) return to;
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const along = Math.abs(Math.cos(angle)) > 0.5 && Math.abs(Math.sin(angle)) > 0.5 ? Math.max(Math.abs(dx), Math.abs(dy)) * Math.SQRT2 : length;
  return [from[0] + Math.round(Math.cos(angle) * along * 1e6) / 1e6, from[1] + Math.round(Math.sin(angle) * along * 1e6) / 1e6];
}
/** A corner placed by the pointer: on the grid (unless `step` is 0), at 45 degree steps from `anchor` with Shift, and inside the plan. */
export function placeCorner(point: Point, step: number, viewBox: Rect, anchor: Point | null, angle: boolean): Point {
  const raw = angle && anchor ? lockAngle(anchor, point) : point;
  return clampPoint(angle && anchor ? raw : [snap(raw[0], step), snap(raw[1], step)], viewBox);
}

/** The item with corner `index` moved to `to` (plan units); null when the new shape would cross itself or be too small. */
export function moveCorner<T extends Outlined>(item: T, index: number, to: Point): T | null {
  const corners = cornersOf(item);
  if (!corners || !corners[index]) return null;
  return withCorners(item, corners.map((corner, i) => i === index ? to : corner));
}
/** The item with a new corner at `at` on the side after corner `index`; null at the corner limit. */
export function addCorner<T extends Outlined>(item: T, index: number, at: Point): T | null {
  const corners = cornersOf(item) ?? boxCorners(item.rect);
  if (corners.length >= MAX_POLYGON_POINTS) return null;
  return withCorners(item, [...corners.slice(0, index + 1), at, ...corners.slice(index + 1)]);
}
/** The item without corner `index`; null when it would have fewer than three corners or the rest would cross. */
export function removeCorner<T extends Outlined>(item: T, index: number): T | null {
  const corners = cornersOf(item);
  if (!corners || corners.length <= MIN_POLYGON_POINTS) return null;
  return withCorners(item, corners.filter((_, i) => i !== index));
}
/** The item drawn with these corners; null when they do not make a usable shape. */
export function withCorners<T extends Outlined>(item: T, corners: Point[]): T | null {
  if (shapeProblem(corners)) return null;
  const shaped = fromCorners(corners)!;
  return { ...item, rect: shaped.rect, outline: shaped.outline };
}
/** The item as a plain box again ("Make rectangle"), in the box around its shape. */
export function asRectangle<T extends Outlined>(item: T): T {
  if (!item.outline) return item;
  const { outline: _outline, ...rest } = item;
  return rest as T;
}
/** The item given a preset shape in its own box (a rectangle drops its shape). */
export function withPreset<T extends Outlined>(item: T, preset: ShapePreset): T {
  const outline = presetOutline(preset);
  return outline ? { ...item, outline } : asRectangle(item);
}
/** The point on the side from `a` to `b` nearest to `p`. */
export function nearestOnSide(p: Point, a: Point, b: Point): Point {
  const dx = b[0] - a[0], dy = b[1] - a[1], length = dx * dx + dy * dy;
  const t = length ? Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length)) : 0;
  return [a[0] + t * dx, a[1] + t * dy];
}
/** SVG `points` text for corners. */
export const pointsText = (corners: Point[]) => corners.map(([x, y]) => `${x},${y}`).join(" ");
