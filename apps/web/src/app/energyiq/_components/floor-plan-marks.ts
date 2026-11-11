/**
 * Text labels and landmarks on the floor plan: what they are, where they sit and how much space they take, turned or
 * not. They are drawing only (they never change how meters are grouped). The editor canvas, the shared map and the
 * model all size them here, so a label is clamped, selected and drawn in the same box everywhere.
 *
 * Pure geometry with no runtime imports from the plan model, so the model, renderers and editor can all use it.
 */
import { isKnownSymbol, SPATIAL_MARK_LIMIT, SPATIAL_SYMBOL_KINDS, SPATIAL_TEXT_MAX, spatialRotation, type SpatialLabelSize, type SpatialSymbolKind } from "@datafoundry/contracts";
import type { Carried } from "./floor-plan-carry";

type Point = [number, number];
type Rect = [number, number, number, number];
export { isKnownSymbol, SPATIAL_SYMBOL_KINDS as SYMBOL_KINDS, type SpatialSymbolKind as SymbolKind };
/** Most text labels, and most landmarks, a plan holds; the longest text or caption. */
export const MARK_LIMIT = SPATIAL_MARK_LIMIT, TEXT_MAX = SPATIAL_TEXT_MAX;
export type LabelSize = SpatialLabelSize;
export const LABEL_SIZES: LabelSize[] = ["s", "m", "l"];
/**
 * A free text label. `position` is the middle of the text; `rotation` is in degrees, clockwise (missing = 0). `key` is the
 * editor's own; `id` is the saved one (new labels get one; a label saved without one keeps working without it).
 */
export type PlanLabel = { key: string; text: string; position: Point; size?: LabelSize; rotation?: number; colour?: string; bold?: true; locked?: true; id?: string } & Carried;
/**
 * A landmark: an icon of `kind` (a kind this version does not know is kept and drawn as a dot) with an optional caption
 * under it. `position` is its middle (an entrance's is the tip of its arrow); `size` its width in plan units.
 */
export type PlanSymbol = { key: string; kind: string; position: Point; size?: number; rotation?: number; label?: string; colour?: string; locked?: true; id?: string } & Carried;
/** Turning offered by the buttons and the handle (hold ⌘/Ctrl on the handle to turn freely). */
export const ROTATION_STEP = 15;
/** Whole degrees, 0-359. */
export const normaliseRotation = (deg: number) => spatialRotation(deg) ?? 0;

/** Text height for each label size, in hundredths of the plan's width. */
const LABEL_FONT: Record<LabelSize, number> = { s: 1.3, m: 1.9, l: 2.8 };
export const labelFont = (label: { size?: LabelSize }, unit: number) => unit * LABEL_FONT[label.size ?? "m"];
/** Rough width of a line of text: Chinese characters are about a full em wide, Latin letters a little over half. */
export function textWidth(text: string, size: number, bold = false): number {
  const wide = text.match(/[⺀-鿿＀-￯]/g)?.length ?? 0;
  return (text.length - wide) * size * (bold ? 0.62 : 0.57) + wide * size;
}
/** Landmark sizes the panel offers, in hundredths of the plan's width (Medium is what a new landmark gets). */
export const SYMBOL_SIZES = { s: 3, m: 4.5, l: 6.5, xl: 9 } as const;
export type SymbolSizeName = keyof typeof SYMBOL_SIZES;
/** The entrance arrow drawn before landmarks existed: 2.8 hundredths wide and 2.2 tall, its tip at the entrance. */
export const ENTRANCE_WIDTH = 2.8, ENTRANCE_HEIGHT = 2.2;
export const symbolSize = (symbol: { kind: string; size?: number }, unit: number) => symbol.size ?? unit * (symbol.kind === "entrance" ? ENTRANCE_WIDTH : SYMBOL_SIZES.m);
/** The size name a landmark's size is closest to, or null for a size typed or saved elsewhere. */
export function sizeName(symbol: { kind: string; size?: number }, unit: number): SymbolSizeName | null {
  if (symbol.size === undefined) return symbol.kind === "entrance" ? "s" : "m";
  const match = (Object.keys(SYMBOL_SIZES) as SymbolSizeName[]).find(name => Math.round(unit * SYMBOL_SIZES[name]) === Math.round(symbol.size!));
  return match ?? null;
}
/** The plan-unit size for a size name (an entrance's sizes run from the arrow drawn before landmarks existed). */
export const sizeFor = (kind: string, name: SymbolSizeName, unit: number) => Math.round(unit * (kind === "entrance" ? ENTRANCE_WIDTH * SYMBOL_SIZES[name] / SYMBOL_SIZES.s : SYMBOL_SIZES[name]));

/**
 * The shape an item turns with: the point it turns around (`pivot`), and its box before turning, relative to that point
 * ([left, top, width, height]). Labels, landmarks and device boxes turn around their middle; an entrance around its tip.
 */
export type Frame = { pivot: Point; box: Rect; rotation: number };
export const labelFrame = (label: Pick<PlanLabel, "text" | "position" | "size" | "rotation" | "bold">, unit: number): Frame => {
  const size = labelFont(label, unit), width = Math.max(unit, textWidth(label.text, size, !!label.bold)), height = size * 1.3;
  return { pivot: label.position, box: [-width / 2, -height / 2, width, height], rotation: label.rotation ?? 0 };
};
export const symbolFrame = (symbol: Pick<PlanSymbol, "kind" | "position" | "size" | "rotation">, unit: number): Frame => {
  const size = symbolSize(symbol, unit);
  if (symbol.kind === "entrance") { const height = size * ENTRANCE_HEIGHT / ENTRANCE_WIDTH; return { pivot: symbol.position, box: [-size / 2, 0, size, height], rotation: symbol.rotation ?? 0 }; }
  return { pivot: symbol.position, box: [-size / 2, -size / 2, size, size], rotation: symbol.rotation ?? 0 };
};
/** A device box turns around its middle. */
export const boxFrame = (centre: Point, size: Point, rotation = 0): Frame => ({ pivot: centre, box: [-size[0] / 2, -size[1] / 2, size[0], size[1]], rotation });

/** `point` turned by `deg` degrees clockwise (SVG's y runs down) around `pivot`. */
export function rotatePoint([x, y]: Point, [px, py]: Point, deg: number): Point {
  if (!deg) return [x, y];
  const a = deg * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a), dx = x - px, dy = y - py;
  return [px + dx * cos - dy * sin, py + dx * sin + dy * cos];
}
/** The four corners of a frame, turned, in plan units. */
export const frameCorners = ({ pivot, box: [bx, by, bw, bh], rotation }: Frame): Point[] => ([[bx, by], [bx + bw, by], [bx + bw, by + bh], [bx, by + bh]] as Point[]).map(([x, y]) => rotatePoint([pivot[0] + x, pivot[1] + y], pivot, rotation));
/** The upright box around a frame once turned: what must stay inside the plan, and what a selection box must hold. */
export function frameBounds(frame: Frame): Rect {
  const corners = frameCorners(frame), xs = corners.map(([x]) => x), ys = corners.map(([, y]) => y);
  const left = Math.min(...xs), top = Math.min(...ys);
  return [left, top, Math.max(...xs) - left, Math.max(...ys) - top];
}
/** Whether a point is on a turned item: the point is turned back the other way and checked against the box before turning. */
export function hitsFrame(point: Point, { pivot, box: [bx, by, bw, bh], rotation }: Frame): boolean {
  const [x, y] = rotatePoint(point, pivot, -rotation), dx = x - pivot[0], dy = y - pivot[1];
  return dx >= bx && dx <= bx + bw && dy >= by && dy <= by + bh;
}
/** Where the turning handle sits: above the middle of the frame's top edge, `gap` further out, turned with it. */
export function handleSpot({ pivot, box: [bx, by, bw], rotation }: Frame, gap: number): { from: Point; to: Point } {
  return { from: rotatePoint([pivot[0] + bx + bw / 2, pivot[1] + by], pivot, rotation), to: rotatePoint([pivot[0] + bx + bw / 2, pivot[1] + by - gap], pivot, rotation) };
}
/** The angle (degrees clockwise from straight up) of a point seen from the pivot. */
export const angleFrom = ([px, py]: Point, [x, y]: Point) => Math.atan2(x - px, -(y - py)) * 180 / Math.PI;

/** A landmark's caption: under the icon, upright whichever way the icon turns. */
export function captionBox(symbol: Pick<PlanSymbol, "kind" | "position" | "size" | "rotation" | "label">, unit: number): Rect | null {
  if (!symbol.label) return null;
  const font = captionFont(symbol, unit), bottom = frameBounds(symbolFrame(symbol, unit))[1] + frameBounds(symbolFrame(symbol, unit))[3];
  const width = textWidth(symbol.label, font, true);
  return [symbol.position[0] - width / 2, bottom + font * 0.2, width, font * 1.3];
}
export const captionFont = (symbol: { kind: string; size?: number }, unit: number) => Math.max(unit * 1.2, symbolSize(symbol, unit) * (symbol.kind === "entrance" ? 0.5 : 0.28));
/** The caption's first line sits this far below the icon's lowest point. */
export const captionBaseline = (symbol: Pick<PlanSymbol, "kind" | "position" | "size" | "rotation">, unit: number) => { const bounds = frameBounds(symbolFrame(symbol, unit)); return bounds[1] + bounds[3] + captionFont(symbol, unit) * 1.15; };
const union = (boxes: Rect[]): Rect => { const left = Math.min(...boxes.map(([x]) => x)), top = Math.min(...boxes.map(([, y]) => y)); return [left, top, Math.max(...boxes.map(([x, , w]) => x + w)) - left, Math.max(...boxes.map(([, y, , h]) => y + h)) - top]; };
/** Everything a label takes on the plan, turned. */
export const labelBounds = (label: PlanLabel, unit: number) => frameBounds(labelFrame(label, unit));
/** Everything a landmark takes on the plan: its turned icon and its caption. */
export const symbolBounds = (symbol: PlanSymbol, unit: number): Rect => { const icon = frameBounds(symbolFrame(symbol, unit)), caption = captionBox(symbol, unit); return caption ? union([icon, caption]) : icon; };

/** How far a box must move so it lies inside the plan (or as far in as it can, when it is bigger than the plan). */
export function insideShift([x, y, w, h]: Rect, [vx, vy, vw, vh]: Rect): Point {
  const fit = (start: number, size: number, low: number, span: number) => size >= span ? low - start : start < low ? low - start : start + size > low + span ? low + span - start - size : 0;
  return [fit(x, w, vx, vw), fit(y, h, vy, vh)];
}
/** The point moved by the shift that keeps `bounds` inside the plan. */
export const keepInside = (position: Point, bounds: Rect, viewBox: Rect): Point => { const [dx, dy] = insideShift(bounds, viewBox); return dx || dy ? [position[0] + dx, position[1] + dy] : position; };
export { union as unionBox };
