/**
 * Free shapes on a floor layout: an area or room drawn as a polygon (an L-shaped block, a bent driveway), and plain
 * shapes that are part of the drawing only (a lawn, a pond, a car-park row). The stored format's reader does not check
 * them (`readProjectSpatialReference` checks only `rect`), so every reader goes through these helpers, which treat the
 * saved values as untrusted: anything malformed is ignored and the reader draws the item's `rect` instead.
 *
 * `points` are absolute plan units, 3 to 100 of them, and must sit inside the item's `rect` (which writers always set to
 * the points' bounding box, so readers that do not know `points` still draw the right box).
 *
 * Known and accepted: an older build (before free shapes) draws a shaped area or room as its box, so it also counts and
 * highlights a device standing in the notch of an L-shape as inside it. The saved data stays correct; only that older
 * screen is off until it is updated. A zone may hold no rooms (a driveway, a playground): the stored format only needs
 * at least one room somewhere on the layout.
 */
import type { SpatialRect } from "./project-spatial.js";

export type SpatialPoint = [number, number];
/** Fewest and most corners a shape can have. */
export const MIN_POLYGON_POINTS = 3, MAX_POLYGON_POINTS = 100;
/** How far (in plan units) a corner may sit outside its box and still count as inside it (rounding on save). */
const SLACK = 1;
export const SHAPE_KINDS = ["rect", "ellipse", "polygon"] as const;
export const SHAPE_OUTLINES = ["solid", "dashed", "none"] as const;
/**
 * A plain shape: part of the drawing only, it never holds rooms or devices and changes no totals. `fill` is #rrggbb,
 * `stroke` the outline style, `label` an optional caption.
 */
export type SpatialShape = { id: string; kind: typeof SHAPE_KINDS[number]; rect: SpatialRect; points?: SpatialPoint[]; fill?: string; stroke?: typeof SHAPE_OUTLINES[number]; label?: string; locked?: boolean };
/** Most plain shapes a layout holds, and the longest caption. */
export const MAX_SHAPES = 200, SHAPE_LABEL_MAX = 80;

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const isBox = (v: unknown): v is SpatialRect => Array.isArray(v) && v.length === 4 && v.every(finite) && (v[2] as number) > 0 && (v[3] as number) > 0;
export const isHexColour = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

/** Twice the signed area (positive or negative by winding); 0 for a flat shape. */
export function signedArea(points: SpatialPoint[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) { const [x1, y1] = points[i]!, [x2, y2] = points[(i + 1) % points.length]!; sum += x1 * y2 - x2 * y1; }
  return sum;
}
const cross = (o: SpatialPoint, a: SpatialPoint, b: SpatialPoint) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
const onSegment = (p: SpatialPoint, a: SpatialPoint, b: SpatialPoint) => Math.min(a[0], b[0]) - 1e-9 <= p[0] && p[0] <= Math.max(a[0], b[0]) + 1e-9 && Math.min(a[1], b[1]) - 1e-9 <= p[1] && p[1] <= Math.max(a[1], b[1]) + 1e-9;
function segmentsMeet(a: SpatialPoint, b: SpatialPoint, c: SpatialPoint, d: SpatialPoint): boolean {
  const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return (d1 === 0 && onSegment(a, c, d)) || (d2 === 0 && onSegment(b, c, d)) || (d3 === 0 && onSegment(c, a, b)) || (d4 === 0 && onSegment(d, a, b));
}
/** Whether the outline crosses or touches itself anywhere other than where neighbouring sides meet. */
export function selfIntersects(points: SpatialPoint[]): boolean {
  const n = points.length;
  for (let i = 0; i < n; i += 1) for (let j = i + 1; j < n; j += 1) {
    if (j === i + 1 || (i === 0 && j === n - 1)) continue;
    if (segmentsMeet(points[i]!, points[(i + 1) % n]!, points[j]!, points[(j + 1) % n]!)) return true;
  }
  // Two corners in the same place make a side of no length.
  return points.some((p, i) => { const q = points[(i + 1) % n]!; return p[0] === q[0] && p[1] === q[1]; });
}
/** The box around a set of points. */
export function polygonBounds(points: SpatialPoint[]): SpatialRect {
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const left = Math.min(...xs), top = Math.min(...ys);
  return [left, top, Math.max(...xs) - left, Math.max(...ys) - top];
}
/** Whether a point is inside the shape (even-odd rule; a point on an edge counts as inside). */
export function pointInPolygon([px, py]: SpatialPoint, points: SpatialPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i]!, [xj, yj] = points[j]!;
    if (onSegment([px, py], [xi, yi], [xj, yj]) && Math.abs(cross([xi, yi], [xj, yj], [px, py])) < 1e-9) return true;
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * The saved points as a usable outline, or null when they cannot be drawn: not a list of 3 to 100 [x, y] numbers, a
 * corner outside `rect`, flat, or crossing itself. Readers then draw the `rect`.
 */
export function polygonOf(points: unknown, rect: unknown): SpatialPoint[] | null {
  if (!Array.isArray(points) || points.length < MIN_POLYGON_POINTS || points.length > MAX_POLYGON_POINTS || !isBox(rect)) return null;
  if (!points.every(p => Array.isArray(p) && p.length === 2 && finite(p[0]) && finite(p[1]))) return null;
  const list = points.map(p => [p[0], p[1]] as SpatialPoint), [x, y, w, h] = rect;
  if (list.some(([px, py]) => px < x - SLACK || px > x + w + SLACK || py < y - SLACK || py > y + h + SLACK)) return null;
  if (Math.abs(signedArea(list)) < 1e-6 || selfIntersects(list)) return null;
  return list;
}
/** Whether `point` is inside an item: inside its outline when it has a usable one, else inside its box. */
export function insideSpatial(item: { rect: unknown; points?: unknown }, point: SpatialPoint): boolean {
  if (!isBox(item.rect)) return false;
  const [x, y, w, h] = item.rect;
  if (point[0] < x || point[0] > x + w || point[1] < y || point[1] > y + h) return false;
  const polygon = polygonOf(item.points, item.rect);
  return !polygon || pointInPolygon(point, polygon);
}
/** SVG `points` attribute text. */
export const pointsAttribute = (points: SpatialPoint[]) => points.map(([x, y]) => `${x},${y}`).join(" ");

/**
 * The largest upright box that fits inside the outline, roughly: where a label goes in an L-, U- or T-shape. Exact for
 * shapes with square corners; for slanted sides it searches a grid and keeps clear of them.
 */
export function innerBox(points: SpatialPoint[]): SpatialRect {
  const lines = (values: number[]) => {
    const sorted = [...new Set(values)].sort((a, b) => a - b), low = sorted[0]!, high = sorted[sorted.length - 1]!;
    // Extra lines between corners give slanted sides a finer grid; at most 40 lines a side keeps it quick.
    const extra = Array.from({ length: 9 }, (_, i) => low + (high - low) * (i + 1) / 10);
    let all = [...new Set([...sorted, ...extra])].sort((a, b) => a - b);
    if (all.length > 40) all = Array.from({ length: 40 }, (_, i) => all[Math.round(i * (all.length - 1) / 39)]!);
    return all;
  };
  const xs = lines(points.map(p => p[0])), ys = lines(points.map(p => p[1]));
  const cols = xs.length - 1, rows = ys.length - 1;
  // A cell counts when its centre and its corners (pulled in a little) are all inside.
  const filled = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => {
    const x0 = xs[c]!, x1 = xs[c + 1]!, y0 = ys[r]!, y1 = ys[r + 1]!, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, ix = (x1 - x0) * 0.02, iy = (y1 - y0) * 0.02;
    return [[cx, cy], [x0 + ix, y0 + iy], [x1 - ix, y0 + iy], [x0 + ix, y1 - iy], [x1 - ix, y1 - iy]].every(p => pointInPolygon(p as SpatialPoint, points));
  }));
  // Largest rectangle of filled cells by area, one row at a time (heights of filled runs above each cell).
  let best: SpatialRect | null = null, bestArea = 0;
  const heights = new Array<number>(cols).fill(0);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) heights[c] = filled[r]![c] ? heights[c]! + 1 : 0;
    for (let c = 0; c < cols; c += 1) {
      if (!heights[c]) continue;
      let minHeight = Infinity;
      for (let e = c; e < cols && heights[e]; e += 1) {
        minHeight = Math.min(minHeight, heights[e]!);
        const box: SpatialRect = [xs[c]!, ys[r + 1 - minHeight]!, xs[e + 1]! - xs[c]!, ys[r + 1]! - ys[r + 1 - minHeight]!];
        if (box[2] * box[3] > bestArea) { bestArea = box[2] * box[3]; best = box; }
      }
    }
  }
  return best ?? polygonBounds(points);
}

/**
 * The plain shapes a layout holds that can be drawn, each checked: a known kind, a box, a usable outline for a polygon
 * (a polygon without one is drawn as its box), a #rrggbb fill, a known outline style and a short caption. Anything
 * else is left out. The editor keeps the saved entries it cannot draw as they were (see the web floor plan editor).
 */
export function spatialShapes(layout: unknown): SpatialShape[] {
  const list = (layout as { shapes?: unknown } | null)?.shapes;
  if (!Array.isArray(list)) return [];
  return list.slice(0, MAX_SHAPES).flatMap((raw): SpatialShape[] => {
    const shape = readShape(raw);
    return shape ? [shape] : [];
  });
}
/** One saved plain shape, checked, or null when it cannot be drawn. */
export function readShape(raw: unknown): SpatialShape | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.id !== "string" || !v.id || v.id.length > 64 || !(SHAPE_KINDS as readonly unknown[]).includes(v.kind) || !isBox(v.rect) || !v.rect.every(n => n >= 0 && n <= 10000)) return null;
  const points = v.kind === "polygon" ? polygonOf(v.points, v.rect) : null;
  return {
    id: v.id, kind: v.kind as SpatialShape["kind"], rect: [...v.rect] as SpatialRect, ...(points ? { points } : {}),
    ...(isHexColour(v.fill) ? { fill: v.fill } : {}), ...((SHAPE_OUTLINES as readonly unknown[]).includes(v.stroke) ? { stroke: v.stroke as NonNullable<SpatialShape["stroke"]> } : {}),
    ...(typeof v.label === "string" && v.label.trim() && v.label.length <= SHAPE_LABEL_MAX ? { label: v.label } : {}), ...(v.locked === true ? { locked: true } : {}),
  };
}
