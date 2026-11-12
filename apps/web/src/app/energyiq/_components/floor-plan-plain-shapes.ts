/**
 * Plain shapes on the floor plan: a driveway, a lawn, a car-park row, a pond. They are part of the drawing only: they
 * never hold rooms or devices, never ride along with an area, and change no totals. Saved in `layout.shapes` as
 * { id, kind: "rect" | "ellipse" | "polygon", rect, points?, fill?, stroke?, label?, locked? } (see spatial-polygon in
 * the contracts package). Saved shapes are untrusted: only values the editor understands are read, and the rest of
 * each entry (and entries it cannot draw at all) ride along and are written back as saved.
 */
import { readShape, SHAPE_KINDS, SHAPE_LABEL_MAX, SHAPE_OUTLINES, MAX_SHAPES } from "@datafoundry/contracts";
import { carriedOf, withCarried, type Carried, type Json } from "./floor-plan-carry";
import { MIN_SIZE, type Point, type Rect } from "./floor-plan-model";
import { outlineFromSaved, savedShape } from "./floor-plan-polygon";

export { MAX_SHAPES, SHAPE_LABEL_MAX };
export type ShapeKind = typeof SHAPE_KINDS[number];
export type ShapeOutline = typeof SHAPE_OUTLINES[number];
export const SHAPE_OUTLINE_STYLES = SHAPE_OUTLINES;
/**
 * A plain shape on the plan. `key` tells shapes apart in the editor; `id` is what is saved (the same for new shapes).
 * A polygon holds its corners as `outline`, fractions of `rect` (see floor-plan-polygon), so moving or resizing its box
 * moves and stretches it.
 */
export type PlanShape = { key: string; id: string; kind: ShapeKind; rect: Rect; outline?: Point[]; fill?: string; stroke?: ShapeOutline; label?: string; locked?: true; level?: string } & Carried;
/** Fill for a new shape: a soft green, like grass on a site plan. */
export const DEFAULT_SHAPE_FILL = "#9cc5a1";
const SHAPE_KEYS = ["id", "kind", "rect"];

/**
 * Reads `layout.shapes`. Entries the editor cannot draw (no id, an unknown kind, no box) are kept aside as saved, at
 * their place in the list. Null when the layout has no list of shapes (anything else there rides along with the layout).
 * Each entry is checked by the contracts' `readShape`, the same check the Facility map and the site report draw through,
 * so a shape is shown and editable everywhere or nowhere.
 */
export function shapesFromLayout(raw: unknown, viewBox: Rect): { shapes: PlanShape[]; skipped: Array<{ index: number; shape: unknown }> } | null {
  if (!Array.isArray(raw)) return null;
  const keys = new Set<string>(), skipped: Array<{ index: number; shape: unknown }> = [], shapes: PlanShape[] = [];
  raw.forEach((item, index) => {
    // A shape is drawn where it was saved, never moved or resized on opening: one outside the plan rides along as saved.
    const checked = shapes.length < MAX_SHAPES ? readShape(item, viewBox) : null;
    if (!checked) { skipped.push({ index, shape: item }); return; }
    const rect = [...checked.rect] as Rect, kind = checked.kind;
    // A polygon's corners are read only when usable; otherwise it is drawn as its box and its saved points ride along.
    const outline = kind === "polygon" && checked.points ? outlineFromSaved(checked.points, rect) : null;
    const own = [...SHAPE_KEYS, ...(outline ? ["points"] : []), ...(["fill", "stroke", "label", "locked"] as const).filter(name => checked[name] !== undefined)];
    let key = checked.id, n = 2; while (keys.has(key)) key = `${checked.id}-${n++}`;
    keys.add(key);
    shapes.push({ key, id: checked.id, kind, rect, ...(outline ? { outline } : {}), ...(checked.fill ? { fill: checked.fill } : {}), ...(checked.stroke ? { stroke: checked.stroke } : {}), ...(checked.label ? { label: checked.label } : {}), ...(checked.locked ? { locked: true as const } : {}), ...carriedOf(item, own) });
  });
  return { shapes, skipped };
}
/** One shape as saved: a polygon's box is always the box around its corners, so older readers draw the right box. */
export function shapeForLayout(shape: PlanShape): Json {
  const polygon = shape.kind === "polygon" ? savedShape(shape) : null;
  const rect = polygon ? polygon.rect : shape.rect.map(Math.round) as Rect;
  return withCarried({ id: shape.id, kind: shape.kind, rect, ...(polygon ? { points: polygon.points } : {}), ...(shape.fill ? { fill: shape.fill } : {}), ...(shape.stroke ? { stroke: shape.stroke } : {}), ...(shape.label?.trim() ? { label: shape.label.trim().slice(0, SHAPE_LABEL_MAX) } : {}), ...(shape.locked ? { locked: true } : {}) }, shape);
}
/** The saved list: the shapes on the plan, with the entries the editor could not draw back in their places. */
export function shapesForLayout(shapes: PlanShape[], skipped: Array<{ index: number; shape: unknown }> = []): unknown[] {
  const list: unknown[] = shapes.map(shapeForLayout);
  for (const { index, shape } of [...skipped].sort((a, b) => a.index - b.index)) list.splice(Math.min(index, list.length), 0, shape);
  return list;
}
/** A shape id no other shape has. */
export function newShapeKey(shapes: PlanShape[]): string {
  const used = new Set(shapes.flatMap(shape => [shape.key, shape.id]));
  for (;;) { const id = `shape-${Math.random().toString(36).slice(2, 10).padEnd(8, "0")}`; if (!used.has(id)) return id; }
}
/** A new shape of `kind` in `rect` (at least MIN_SIZE), with the default fill. */
export const newShape = (shapes: PlanShape[], kind: ShapeKind, rect: Rect, outline?: Point[]): PlanShape => { const key = newShapeKey(shapes); return { key, id: key, kind, rect: [rect[0], rect[1], Math.max(MIN_SIZE, rect[2]), Math.max(MIN_SIZE, rect[3])], ...(outline ? { outline } : {}), fill: DEFAULT_SHAPE_FILL }; };
