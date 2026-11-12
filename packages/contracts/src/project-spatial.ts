import { lineWidth, spatialLines, type SpatialLine, type SpatialOpening } from "./project-spatial-drawing.js";
import { innerBox, pointsAttribute, polygonOf, spatialShapes, type SpatialPoint, type SpatialShape } from "./spatial-polygon.js";

/** Project-owned reference geometry. It never establishes electrical aggregation. */
export type SpatialRect = [number, number, number, number];
export interface ProjectSpatialReference {
  schemaVersion: 1;
  projectId: string;
  provenance: { file: string; status: string };
  layout: {
    viewBox: SpatialRect;
    /**
     * `points` (optional, 3 to 100 absolute [x, y]) draws a room or zone as a free shape, such as an L-shaped block.
     * `rect` stays required and is always the points' bounding box, so readers that ignore `points` draw that box. The
     * reader below does not check `points`: use `polygonOf` (spatial-polygon.ts), which ignores malformed ones.
     * `autoDoor: false` leaves out the door drawn for a room automatically (see project-spatial-drawing).
     */
    rooms: Array<{ name: string; zone: string; rect: SpatialRect; points?: SpatialPoint[]; id?: string; autoDoor?: false; level?: string; displayName?: string }>;
    /**
     * `referenceBoard` is the panel an electrician looks for on the plan, or ""
     * when none is named: the plan is a drawing only, so a panel is optional.
     * `meterLocations` is where the meters that feed this zone are filed, for
     * sites that file them by area rather than by panel. Naming both lets the
     * plan keep the panel label while still matching the meters, so renaming
     * one does not quietly empty the zone.
     */
    zones: Array<{ id: string; referenceBoard: string; meterLocations?: string[]; rect?: SpatialRect; points?: SpatialPoint[]; independentSpace?: boolean; physicalParentRoom?: string; equipment?: string; level?: string }>;
    /** Plain shapes (a lawn, a driveway, a pond): a drawing only, never holding rooms or devices. Not checked here: use `spatialShapes`. */
    shapes?: SpatialShape[];
    /** Drawing only, optional and untrusted: read them through spatialOpenings and spatialLines. */
    openings?: SpatialOpening[];
    lines?: SpatialLine[];
  };
}
/**
 * Optional floors, saved as `layout.levels: SpatialLevel[]` (read with `spatialLevels`, since saved layouts are
 * untrusted). Missing means one floor (every layout saved before floors existed). Each zone, room, device and the
 * entrance may name its floor with `level` (a level id); missing means the first floor. A room may carry `displayName`,
 * the short name shown, while its `name` stays unique across the whole layout (e.g. "Store (2)"). Readers that know
 * nothing of floors draw every floor on one sheet, overlaid. `layout.layers.hidden` lists layers hidden on the shared
 * (read-only) map, e.g. ["devices"].
 */
export type SpatialLevel = { id: string; name: string };
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 300;
/** A panel name, or "" (or missing, read as "") when the area names no panel. */
const board = (v: unknown) => v === undefined || v === "" || text(v);
const rect = (v: unknown): v is SpatialRect => Array.isArray(v) && v.length === 4 && v.every(n => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 10000) && v[2] > 0 && v[3] > 0;

/** Reuse the existing reference block in project notes; malformed or foreign blocks stay visible as notes. */
export function readProjectSpatialReference(notes: string, projectId: string): { reference: ProjectSpatialReference; block: string } | null {
  for (const match of notes.matchAll(/```json\s*\n([\s\S]*?)\n```/g)) {
    try {
      const v = JSON.parse(match[1]!);
      if (v.schemaVersion !== 1 || v.projectId !== projectId || !text(v.provenance?.file) || !text(v.provenance?.status) || !rect(v.layout?.viewBox)) continue;
      const { rooms, zones } = v.layout;
      if (!Array.isArray(rooms) || !rooms.length || rooms.length > 200 || !Array.isArray(zones) || !zones.length || zones.length > 100) continue;
      if (!zones.every(z => text(z.id) && board(z.referenceBoard) && (z.meterLocations === undefined || (Array.isArray(z.meterLocations) && z.meterLocations.length > 0 && z.meterLocations.length <= 50 && z.meterLocations.every(text))) && (z.rect === undefined || rect(z.rect)) && (z.independentSpace === undefined || typeof z.independentSpace === "boolean") && (z.physicalParentRoom === undefined || text(z.physicalParentRoom)) && (z.equipment === undefined || text(z.equipment)))) continue;
      if (!rooms.every(r => text(r.name) && text(r.zone) && rect(r.rect) && zones.some(z => z.id === r.zone))) continue;
      const [vx, vy, vw, vh] = v.layout.viewBox;
      if ([...rooms, ...zones.filter(z => z.rect)].some(r => r.rect[0] < vx || r.rect[1] < vy || r.rect[0] + r.rect[2] > vx + vw || r.rect[1] + r.rect[3] > vy + vh)) continue;
      for (const z of zones) if (z.referenceBoard === undefined) z.referenceBoard = "";
      return { reference: v, block: match[0] };
    } catch { /* Other project notes may contain unrelated JSON. */ }
  }
  return null;
}

/**
 * Optional drawing marks a layout may hold (schemaVersion stays 1): free text labels and landmark symbols. They are
 * drawing only and never change how meters are grouped. Saved layouts are untrusted (the advisor or a notes edit can
 * write anything), so every reader takes them through these checks: known value shapes only, #rrggbb colours, short
 * text, finite coordinates inside the stored format's range, and at most SPATIAL_MARK_LIMIT of each kind. A symbol of
 * a kind this version does not know is kept as it is and drawn as a plain dot.
 */
export const SPATIAL_SYMBOL_KINDS = ["entrance", "lift", "stairs", "toilet", "parking", "bin", "lamp", "tree", "playground", "shelter", "fireExit", "switchRoom", "pump", "busStop", "arrow", "north"] as const;
export type SpatialSymbolKind = typeof SPATIAL_SYMBOL_KINDS[number];
export type SpatialLabelSize = "s" | "m" | "l";
/** `position` is the middle of the text; `rotation` is in degrees, clockwise, 0-359. */
export interface SpatialLabel { id?: string; text: string; position: [number, number]; size?: SpatialLabelSize; rotation?: number; colour?: string; bold?: boolean; locked?: boolean }
/** `position` is the middle of the symbol (the tip of the arrow for an entrance); `size` its width in plan units. */
export interface SpatialSymbol { id?: string; kind: string; position: [number, number]; size?: number; rotation?: number; label?: string; colour?: string; locked?: boolean }
/** Most labels, and most symbols, a layout's readers draw; longest text and kind; the size range of a symbol. */
export const SPATIAL_MARK_LIMIT = 300, SPATIAL_TEXT_MAX = 80, SPATIAL_KIND_MAX = 40, SPATIAL_SYMBOL_SIZE: [number, number] = [4, 1000];
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const point = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every(n => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 10000);
export const isSpatialColour = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
/** A rotation in whole degrees, 0-359; null when it is not a finite number. */
export function spatialRotation(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return ((Math.round(v) % 360) + 360) % 360;
}
const shortText = (v: unknown, max = SPATIAL_TEXT_MAX) => typeof v === "string" && v.trim().length > 0 && v.length <= max * 4 ? v.trim().slice(0, max) : null;
const markId = (v: unknown) => typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? { id: v } : {};
const common = (raw: Record<string, unknown>) => {
  const rotation = spatialRotation(raw.rotation);
  return { ...(rotation ? { rotation } : {}), ...(isSpatialColour(raw.colour) ? { colour: raw.colour } : {}), ...(raw.locked === true ? { locked: true } : {}) };
};
const wellFormed = (rects: ReadonlyArray<unknown>): SpatialRect[] => rects.filter((rect): rect is SpatialRect => Array.isArray(rect) && rect.length === 4 && rect.every(value => typeof value === "number" && Number.isFinite(value)) && rect[2] > 0);
/** The middle width of the boxes, or null when there are none. */
function medianWidth(rects: SpatialRect[]): number | null {
  const widths = rects.map(rect => rect[2]).sort((a, b) => a - b);
  if (!widths.length) return null;
  return widths.length % 2 ? widths[(widths.length - 1) / 2]! : (widths[widths.length / 2 - 1]! + widths[widths.length / 2]!) / 2;
}
/**
 * How wide the drawing itself is: from its leftmost to its rightmost box, plus the smaller of the two margins on each
 * side. For a drawing that fills its space evenly that is the space's width; space added past one edge does not count.
 */
function drawnWidth([vx, , vw]: ReadonlyArray<number>, rects: SpatialRect[]): number {
  const left = Math.min(...rects.map(rect => rect[0])), right = Math.max(...rects.map(rect => rect[0] + rect[2]));
  return right - left + 2 * Math.max(0, Math.min(left - vx!, vx! + vw! - right));
}
/**
 * The size of plan text and symbols, in plan units. It is a hundredth of the drawing space's width, as it always was,
 * but never more than the drawing calls for: a 26th of the typical room's width; or, for a drawing whose areas are
 * roomy (a 30th of the typical area's width), a hundredth of the width the areas and rooms take up. So making the
 * drawing space wider, by pulling its edge or adding a template next to narrow blocks, no longer makes every name grow
 * until it runs into its neighbours, while a plan whose rooms already fit, or whose roomy areas fill the drawing space
 * (most plans, SKTC included), draws exactly as before. It never drops below 40% of the old size. Every reader (the map,
 * the editor, the report) works it out the same way, from the same floor's rooms and stand-alone areas, so they agree.
 * Malformed boxes are skipped; with no rooms it is a hundredth of the width.
 */
export function spatialTextUnit(viewBox: ReadonlyArray<number>, roomRects: ReadonlyArray<unknown>, areaRects: ReadonlyArray<unknown> = []): number {
  const base = (viewBox[2] ?? Number.NaN) / 100, rooms = wellFormed(roomRects), areas = wellFormed(areaRects), room = medianWidth(rooms);
  if (room === null || !(base > 0) || !Number.isFinite(viewBox[0])) return base;
  const area = medianWidth(areas), roomy = area === null ? 0 : Math.min(area / 30, drawnWidth(viewBox, [...areas, ...rooms]) / 100);
  return Math.min(base, Math.max(room / 26, roomy, base * 0.4));
}

/** A saved label as readers draw it, or null when it cannot be drawn (no text, no usable position). */
export function readSpatialLabel(raw: unknown): SpatialLabel | null {
  if (!record(raw) || !point(raw.position)) return null;
  const text = shortText(raw.text);
  if (text === null) return null;
  const size = raw.size === "s" || raw.size === "m" || raw.size === "l" ? { size: raw.size } : {};
  return { ...markId(raw.id), text, position: [raw.position[0], raw.position[1]], ...size, ...common(raw), ...(raw.bold === true ? { bold: true } : {}) } as SpatialLabel;
}
/** A saved symbol as readers draw it, or null when it cannot be drawn. A kind this version does not know is kept as written. */
export function readSpatialSymbol(raw: unknown): SpatialSymbol | null {
  if (!record(raw) || !point(raw.position) || typeof raw.kind !== "string" || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(raw.kind) || raw.kind.length > SPATIAL_KIND_MAX) return null;
  const size = typeof raw.size === "number" && Number.isFinite(raw.size) && raw.size >= SPATIAL_SYMBOL_SIZE[0] && raw.size <= SPATIAL_SYMBOL_SIZE[1] ? { size: raw.size } : {};
  const label = shortText(raw.label);
  return { ...markId(raw.id), kind: raw.kind, position: [raw.position[0], raw.position[1]], ...size, ...common(raw), ...(label !== null ? { label } : {}) } as SpatialSymbol;
}
export const isKnownSymbol = (kind: string): kind is SpatialSymbolKind => (SPATIAL_SYMBOL_KINDS as readonly string[]).includes(kind);
const samePlace = (a: [number, number], b: [number, number]) => Math.round(a[0]) === Math.round(b[0]) && Math.round(a[1]) === Math.round(b[1]);
/** The labels a layout holds that can be drawn, in drawing order (at most SPATIAL_MARK_LIMIT). */
export function spatialLabels(layout: unknown): SpatialLabel[] {
  const list = record(layout) && Array.isArray(layout.labels) ? layout.labels.slice(0, SPATIAL_MARK_LIMIT) : [];
  return list.flatMap(item => { const label = readSpatialLabel(item); return label ? [label] : []; });
}
/**
 * The symbols a layout holds that can be drawn, with its entrance among them. The legacy `entrance` is the first
 * entrance (layouts saved before symbols existed have only that): when an entrance symbol sits where it is, that symbol
 * is the same entrance (its label is the legacy one), and so is an entrance symbol elsewhere that carries its name (the
 * legacy entrance was moved alone); otherwise the legacy entrance comes first as an entrance symbol.
 * `legacy` marks the entry that stands for `layout.entrance`. On a site with floors, only an entrance symbol on the legacy
 * entrance's own floor can stand for it (another floor's entrance at the same spot, or with the same name, never does).
 */
export function spatialSymbols(layout: unknown): Array<SpatialSymbol & { legacy?: true }> {
  const list = record(layout) && Array.isArray(layout.symbols) ? layout.symbols.slice(0, SPATIAL_MARK_LIMIT) : [];
  const read = list.flatMap(item => { const symbol = readSpatialSymbol(item); return symbol ? [{ symbol: symbol as SpatialSymbol & { legacy?: true }, raw: item as unknown }] : []; });
  const symbols = read.map(item => item.symbol);
  const entrance = record(layout) && record(layout.entrance) && point(layout.entrance.position) ? layout.entrance : null;
  if (!entrance) return symbols;
  const levels = spatialLevels(layout), floor = levels ? spatialLevelOf(entrance, levels) : null;
  const sameFloor = (index: number) => !levels || spatialLevelOf(read[index]!.raw, levels) === floor;
  const label = typeof entrance.label === "string" && entrance.label.trim() ? { label: entrance.label.trim().slice(0, SPATIAL_TEXT_MAX) } : {};
  const at = symbols.findIndex((item, index) => item.kind === "entrance" && samePlace(item.position, entrance.position as [number, number]) && sameFloor(index));
  if (at >= 0) { symbols[at] = { ...symbols[at]!, ...label, legacy: true }; return symbols; }
  // Moved where only `layout.entrance` was changed (by an older build, a notes edit or the advisor): the entrance symbol
  // that carries its name is the same entrance, drawn where `layout.entrance` now is.
  const named = label.label ? symbols.findIndex((item, index) => item.kind === "entrance" && item.label === label.label && sameFloor(index)) : -1;
  if (named >= 0) { symbols[named] = { ...symbols[named]!, position: [...entrance.position as [number, number]], legacy: true }; return symbols; }
  return [{ kind: "entrance", position: [...entrance.position as [number, number]], ...label, legacy: true }, ...symbols];
}
/** A floor id: short letters, digits, - and _. */
export const SPATIAL_LEVEL_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Most floors a layout can hold. */
export const MAX_SPATIAL_LEVELS = 50;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
/**
 * The layout's floors, or null when it has none it can use (missing, or anything malformed: then every item reads as
 * being on one floor, exactly as before floors existed). Saved layouts are untrusted: ids must be well formed and
 * unique, and names short text.
 */
export function spatialLevels(layout: unknown): SpatialLevel[] | null {
  const raw = isObject(layout) ? layout.levels : undefined;
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_SPATIAL_LEVELS) return null;
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isObject(item) || typeof item.id !== "string" || !SPATIAL_LEVEL_ID.test(item.id) || seen.has(item.id) || !text(item.name) || item.name.trim().length === 0 || item.name.length > 120) return null;
    seen.add(item.id);
  }
  return raw.map(item => ({ id: item.id as string, name: (item.name as string).trim() }));
}
/** The floor an item is on: the one it names when that floor exists, else the first. */
export const spatialLevelOf = (item: unknown, levels: SpatialLevel[]): string => { const value = isObject(item) ? item.level : undefined; return typeof value === "string" && levels.some(level => level.id === value) ? value : levels[0]!.id; };
/**
 * The floor a zone is on. Equipment inside a room (independentSpace false) is always on its room's floor, whatever its own
 * `level` says (the editor works the same way), so it is never split from the room it sits in.
 */
export const spatialZoneLevel = (zone: { independentSpace?: boolean; physicalParentRoom?: string; level?: string }, layout: { rooms: Array<{ name: string; level?: string }> }, levels: SpatialLevel[]): string =>
  spatialLevelOf(zone.independentSpace === false ? layout.rooms.find(room => room.name === zone.physicalParentRoom) ?? zone : zone, levels);
/** Layers the shared map (and the report) can hide, as saved in `layout.layers.hidden`. */
export const SPATIAL_LAYERS = ["areas", "rooms", "equipment", "devices", "labels", "symbols", "lines", "shapes"] as const;
/** The layers hidden for everyone who views the plan. Saved layouts are untrusted: only known layer names count. */
export function spatialHiddenLayers(layout: unknown): Set<typeof SPATIAL_LAYERS[number]> {
  const layers = isObject(layout) ? layout.layers : undefined, hidden = isObject(layers) ? layers.hidden : undefined;
  return new Set(Array.isArray(hidden) ? hidden.filter((item): item is typeof SPATIAL_LAYERS[number] => (SPATIAL_LAYERS as readonly unknown[]).includes(item)) : []);
}
/** A room's name as shown: its short `displayName` when it has a usable one, else its name. */
export const spatialRoomTitle = (room: { name: string; displayName?: unknown }): string => typeof room.displayName === "string" && room.displayName.trim() && room.displayName.length <= 120 ? room.displayName.trim() : room.name;
/**
 * The layout as one floor sees it: only that floor's zones, rooms, devices and entrance, and its text labels, landmarks,
 * lines and plain shapes (each names its floor in `level` like a room). Doors and windows are on their room's floor.
 * Board markers stay only for boards with an area on that floor. A layout with fewer than two floors is returned unchanged.
 */
export function spatialLevelReference<T extends ProjectSpatialReference>(reference: T, level: string): T {
  const levels = spatialLevels(reference.layout);
  if (!levels || levels.length < 2) return reference;
  const on = (item: unknown) => spatialLevelOf(item, levels) === level;
  const layout = reference.layout as T["layout"] & { devices?: unknown; entrance?: unknown; boardMarkers?: unknown };
  const zones = layout.zones.filter(zone => spatialZoneLevel(zone, layout, levels) === level), boards = new Set(zones.map(zone => zone.referenceBoard).filter(Boolean));
  const next: Record<string, unknown> = { ...layout, zones, rooms: layout.rooms.filter(on) };
  if (Array.isArray(layout.devices)) next.devices = layout.devices.filter(on);
  for (const field of ["labels", "symbols", "lines", "shapes"] as const) { const list = (layout as Record<string, unknown>)[field]; if (Array.isArray(list)) next[field] = list.filter(on); }
  // A door names its room by id, else by name (see openingRoom): it stays while that room is on this floor.
  const openings = (layout as { openings?: unknown }).openings;
  if (Array.isArray(openings)) { const rooms = next.rooms as Array<{ name: string; id?: unknown }>; next.openings = openings.filter(item => { const room = isObject(item) ? item.room : undefined; return typeof room === "string" && rooms.some(entry => entry.id === room || entry.name === room); }); }
  if (layout.entrance !== undefined && !on(layout.entrance)) delete next.entrance;
  if (isObject(layout.boardMarkers)) next.boardMarkers = Object.fromEntries(Object.entries(layout.boardMarkers).filter(([board]) => boards.has(board)));
  return { ...reference, layout: next as T["layout"] };
}

const xml = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
export function renderProjectSpatialSvg(ref: ProjectSpatialReference): string {
  const [x, y, w, h] = ref.layout.viewBox;
  const label = (s: string, px: number, py: number, size = 13) => `<text x="${px}" y="${py}" text-anchor="middle" font-family="Arial,sans-serif" font-size="${size}" fill="#203b42">${xml(s)}</text>`;
  // A zone or room with usable points is drawn as that shape; anything else (or malformed points) as its box.
  const box = (r: SpatialRect, fill: string, points?: SpatialPoint[] | null) => points ? `<polygon points="${pointsAttribute(points)}" fill="${fill}" stroke="#a0b3b4" stroke-linejoin="round"/>` : `<rect x="${r[0]}" y="${r[1]}" width="${r[2]}" height="${r[3]}" rx="5" fill="${fill}" stroke="#a0b3b4"/>`;
  // Labels go in the largest part of a shaped item, never in the notch of an L.
  const labelBox = (r: SpatialRect, points: SpatialPoint[] | null): SpatialRect => points ? innerBox(points) : r;
  const plain = spatialShapes(ref.layout).map(s => {
    const fill = s.fill ?? "#e4ebe6", line = s.stroke === "none" ? `stroke="none"` : `stroke="#8a9a92"${s.stroke === "dashed" ? ` stroke-dasharray="6 4"` : ""}`, [sx, sy, sw, sh] = s.rect;
    const body = s.kind === "ellipse" ? `<ellipse cx="${sx + sw / 2}" cy="${sy + sh / 2}" rx="${sw / 2}" ry="${sh / 2}" fill="${fill}" fill-opacity="0.55" ${line}/>` : s.points ? `<polygon points="${pointsAttribute(s.points)}" fill="${fill}" fill-opacity="0.55" ${line} stroke-linejoin="round"/>` : `<rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" fill="${fill}" fill-opacity="0.55" ${line}/>`;
    const [lx, ly, lw, lh] = labelBox(s.rect, s.points ?? null);
    return body + (s.label ? label(s.label, lx + lw / 2, ly + lh / 2 + 4, 12) : "");
  }).join("");
  const zones = ref.layout.zones.filter(z => z.rect && z.independentSpace !== false).map(z => { const points = polygonOf(z.points, z.rect), [lx, ly, lw] = labelBox(z.rect!, points); return box(z.rect!, "#edf3f1", points) + label([z.referenceBoard, `Area ${z.id}`].filter(Boolean).join(" · "), lx + lw / 2, ly + 25, 17); }).join("");
  const rooms = ref.layout.rooms.map(r => {
    const points = polygonOf(r.points, r.rect), [rx, ry, rw, rh] = labelBox(r.rect, points);
    const words = r.name.split(/\s+/); const lines: string[] = []; let line = "";
    for (const word of words) { if (line && (line + " " + word).length > Math.max(9, Math.floor(rw / 7))) { lines.push(line); line = word; } else line += (line ? " " : "") + word; } if (line) lines.push(line);
    const subgroup = ref.layout.zones.filter(z => z.independentSpace === false && z.physicalParentRoom === r.name);
    return box(r.rect, "#ffffff", points) + lines.map((s, i) => label(s, rx + rw / 2, ry + rh / 2 + (i - (lines.length - 1) / 2) * 17)).join("") + subgroup.map((z, i) => label([z.referenceBoard, "subgroup"].filter(Boolean).join(" · "), rx + rw / 2, ry + rh - 13 - i * 16, 11)).join("");
  }).join("");
  // Walls, fences and road edges drawn on the layout, as plain lines (fences dashed).
  const lines = spatialLines(ref.layout).map(line => `<polyline points="${line.points.map(point => point.join(",")).join(" ")}" fill="none" stroke="${line.style === "partition" ? "#7d8f90" : "#203b42"}" stroke-width="${+(lineWidth(line.style, line.thickness) * w / 100).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"${line.style === "fence" ? ` stroke-dasharray="${+(w / 100).toFixed(2)} ${+(w / 160).toFixed(2)}"` : ""}/>`).join("");
  // Text labels and landmarks are drawing only: text as written (turned when it is turned), an entrance as an arrow, and
  // every other landmark as a small ring with its caption.
  const turn = (deg: number | undefined, px: number, py: number) => deg ? ` transform="rotate(${deg} ${px} ${py})"` : "";
  const ink = (colour: string | undefined) => colour ?? "#203b42";
  const texts = spatialLabels(ref.layout).map(item => { const [px, py] = item.position, size = { s: 11, m: 15, l: 22 }[item.size ?? "m"]; return `<text x="${px}" y="${py}" text-anchor="middle" dominant-baseline="central" font-family="Arial,sans-serif" font-size="${size}"${item.bold ? ' font-weight="bold"' : ""} fill="${ink(item.colour)}"${turn(item.rotation, px, py)}>${xml(item.text)}</text>`; }).join("");
  // The entrance of a layout saved before landmarks existed (no symbol list) was never drawn here, and still is not.
  const marks = spatialSymbols(ref.layout).filter(item => !item.legacy || Array.isArray((ref.layout as { symbols?: unknown }).symbols)).map(item => {
    const [px, py] = item.position, colour = ink(item.colour), caption = item.label ? xml(item.label) : "";
    if (item.kind === "entrance") return `<path d="M${px - 12} ${py + 18} L${px} ${py} L${px + 12} ${py + 18} Z" fill="${colour}"${turn(item.rotation, px, py)}/>` + (caption ? `<text x="${px}" y="${py + 34}" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" fill="${colour}">${caption}</text>` : "");
    return `<circle cx="${px}" cy="${py}" r="8" fill="white" stroke="${colour}" stroke-width="2"/><circle cx="${px}" cy="${py}" r="2.5" fill="${colour}"/>` + (caption ? `<text x="${px}" y="${py + 22}" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" fill="${colour}">${caption}</text>` : "");
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" role="img" aria-label="Project spatial reference"><title>Spaces and meter distribution</title><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="white"/>${zones}${plain}${rooms}${lines}${texts}${marks}${label("Illustrative schematic · not to scale · reference-derived", x + w / 2, y + h - 16, 12)}</svg>`;
}
