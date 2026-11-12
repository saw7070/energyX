/**
 * Doors, windows, openings and walls on a project's floor layout: drawing only, they never change how meters are grouped.
 * They are optional layout keys (schemaVersion stays 1), and the layout is untrusted (a notes edit or the advisor can
 * write anything), so every reader takes only the entries checked here: known kinds, finite numbers in range, capped lists.
 */
export type SpatialWall = "n" | "e" | "s" | "w";
export const SPATIAL_WALLS = ["n", "e", "s", "w"] as const;
export const OPENING_KINDS = ["door", "double", "opening", "window"] as const;
export type SpatialOpeningKind = typeof OPENING_KINDS[number];
/**
 * A door, double door, opening (a gap) or window in one wall of a room. `room` is the room's id when it has one, else its
 * name. `offset` is where its middle sits along the wall (0 = the wall's start: its left end for the top and bottom
 * walls, its top end for the left and right walls; 1 = its other end), `width` its width in plan units. A door swings
 * into the room (`in`, the default) or out of it, hinged at the end of its gap nearer the wall's start or its end.
 */
export interface SpatialOpening { id: string; room: string; wall: SpatialWall; offset: number; width: number; kind: SpatialOpeningKind; swing?: "in" | "out"; hinge?: "start" | "end" }
export const LINE_STYLES = ["wall", "partition", "fence", "road"] as const;
export type SpatialLineStyle = typeof LINE_STYLES[number];
export const LINE_THICKNESSES = ["s", "m", "l"] as const;
export type SpatialLineThickness = typeof LINE_THICKNESSES[number];
/** A wall, partition, fence or road edge drawn as a line through `points` (2 to 200 of them). */
export interface SpatialLine { id: string; points: Array<[number, number]>; style: SpatialLineStyle; thickness?: SpatialLineThickness; locked?: boolean }

/** Most openings and lines a layout can hold, and most points one line can have. */
export const MAX_OPENINGS = 400, MAX_LINES = 100, MAX_LINE_POINTS = 200;
/** An opening or line id: short letters, digits, - and _. */
export const DRAWING_ID = /^[A-Za-z0-9_-]{1,64}$/;
const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T => (list as readonly unknown[]).includes(value);
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const coordinate = (value: unknown) => isNumber(value) && value >= 0 && value <= 10000;

export function isSpatialOpening(value: unknown): value is SpatialOpening {
  if (!isRecord(value)) return false;
  const { id, room, wall, offset, width, kind, swing, hinge } = value;
  return typeof id === "string" && DRAWING_ID.test(id) && typeof room === "string" && room.length > 0 && room.length <= 300 && isOneOf(SPATIAL_WALLS, wall) && isNumber(offset) && offset >= 0 && offset <= 1
    && isNumber(width) && width > 0 && width <= 10000 && isOneOf(OPENING_KINDS, kind) && (swing === undefined || swing === "in" || swing === "out") && (hinge === undefined || hinge === "start" || hinge === "end");
}
export function isSpatialLine(value: unknown): value is SpatialLine {
  if (!isRecord(value)) return false;
  const { id, points, style, thickness, locked } = value;
  return typeof id === "string" && DRAWING_ID.test(id) && Array.isArray(points) && points.length >= 2 && points.length <= MAX_LINE_POINTS && points.every(point => Array.isArray(point) && point.length === 2 && point.every(coordinate))
    && isOneOf(LINE_STYLES, style) && (thickness === undefined || isOneOf(LINE_THICKNESSES, thickness)) && (locked === undefined || typeof locked === "boolean");
}
/** The layout's openings that can be drawn (well formed, at most MAX_OPENINGS). */
export const spatialOpenings = (layout: unknown): SpatialOpening[] => { const list = isRecord(layout) ? layout.openings : undefined; return Array.isArray(list) ? list.filter(isSpatialOpening).slice(0, MAX_OPENINGS) : []; };
/** The layout's lines that can be drawn (well formed, at most MAX_LINES). */
export const spatialLines = (layout: unknown): SpatialLine[] => { const list = isRecord(layout) ? layout.lines : undefined; return Array.isArray(list) ? list.filter(isSpatialLine).slice(0, MAX_LINES) : []; };
/** The room an opening belongs to: the one with its id, else the one with its name. */
export function openingRoom<R extends { name: string }>(rooms: readonly R[], opening: { room: string }): R | undefined {
  return rooms.find(room => (room as { id?: unknown }).id === opening.room) ?? rooms.find(room => room.name === opening.room);
}
/**
 * Where an opening sits on its room's wall: from `a` (the end nearer the wall's start) to `b`, with `inward` pointing into
 * the room. It is never wider than the wall and always stays on it, however the room was resized.
 */
export function openingSpan([x, y, w, h]: [number, number, number, number], opening: { wall: SpatialWall; offset: number; width: number }): { a: [number, number]; b: [number, number]; inward: [number, number]; width: number } {
  const across = opening.wall === "n" || opening.wall === "s", length = across ? w : h;
  const width = Math.max(0, Math.min(opening.width, length)), middle = Math.min(Math.max(opening.offset * length, width / 2), length - width / 2);
  const from = middle - width / 2, to = middle + width / 2;
  if (opening.wall === "n") return { a: [x + from, y], b: [x + to, y], inward: [0, 1], width };
  if (opening.wall === "s") return { a: [x + from, y + h], b: [x + to, y + h], inward: [0, -1], width };
  if (opening.wall === "w") return { a: [x, y + from], b: [x, y + to], inward: [1, 0], width };
  return { a: [x + w, y + from], b: [x + w, y + to], inward: [-1, 0], width };
}
/** Line widths in plan units for each style and thickness, as a share of the plan's width unit (a hundredth of its width). */
export const lineWidth = (style: SpatialLineStyle, thickness: SpatialLineThickness = "m") => (style === "wall" ? 0.6 : style === "road" ? 0.3 : 0.22) * (thickness === "s" ? 0.6 : thickness === "l" ? 1.7 : 1);
