/**
 * Saving without losing anything. The stored layout can hold more than the editor draws: keys the report reads
 * (board markers, a zone's own room list, its direction from the entrance, the entrance's board), keys a later version
 * or the advisor wrote, and areas with no place on the drawing. They are carried on the plan items they belong to and
 * written back on save, in their saved order, so a layout nobody changed saves exactly as it was.
 *
 * Saved layouts are untrusted (the advisor or a notes edit can write anything): carried values are only passed through,
 * never drawn, and every key the editor owns is rebuilt and checked by the editor instead.
 */
import type { Point, Rect } from "./floor-plan-model";

export type Json = Record<string, unknown>;
/** What an item carries from the saved layout: keys the editor does not own, and the saved key order when it differs. */
export type Carried = { extra?: Json; order?: string[] };
/** Where an area was when the layout was opened, for keys that hold only while it stays put. */
export type AreaBaseline = { rect: Rect; rooms: string[]; derived?: true };

export const LAYOUT_KEYS = ["viewBox", "zones", "rooms", "entrance", "devices", "boardColours", "style", "labels", "symbols"] as const;
export const ZONE_KEYS = ["id", "referenceBoard", "meterLocations", "rect", "independentSpace", "physicalParentRoom", "equipment", "colour"] as const;
/** Keys that describe equipment inside a room: owned for equipment, carried as saved on a stand-alone area. */
export const GROUP_KEYS = ["independentSpace", "physicalParentRoom", "equipment"];
export const STANDALONE_ZONE_KEYS = ZONE_KEYS.filter(key => !GROUP_KEYS.includes(key));
export const ROOM_KEYS = ["name", "zone", "rect", "colour"] as const;
export const DEVICE_KEYS = ["meterId", "position", "size", "colour"] as const;
export const ENTRANCE_KEYS = ["label", "position"] as const;
/** Keys of a text label and of a landmark the editor owns (only while each holds a value it understands; see floor-plan-mark-data). */
export const LABEL_KEYS = ["id", "text", "position", "size", "rotation", "colour", "bold", "locked"] as const;
export const SYMBOL_KEYS = ["id", "kind", "position", "size", "rotation", "label", "colour", "locked"] as const;
/** Zone keys that describe the area's role (a stand-alone area or equipment inside a room) and its place on the site. */
export const ROLE_KEYS = ["kind", "rooms", "directionFromEntrance"];

export const isRecord = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);
/**
 * Whether the stored-layout reader filled in this zone's empty panel (it appends `referenceBoard: ""` to a zone that
 * named none). Such a zone is written back without one, which reads the same, so its saved form does not change.
 */
export const boardFilledIn = (zone: unknown) => { if (!isRecord(zone)) return false; const keys = Object.keys(zone); return keys[keys.length - 1] === "referenceBoard" && zone.referenceBoard === ""; };
/** The zone as it was saved, before the reader filled in an empty panel. */
export const withoutFilledBoard = (zone: Json): Json => { if (!boardFilledIn(zone)) return zone; const { referenceBoard: _board, ...rest } = zone; return rest; };

/** The keys of a saved item the editor does not own, in their saved order, and that order when it is not the usual one. */
export function carriedOf(raw: unknown, owned: readonly string[]): Carried {
  if (!isRecord(raw)) return {};
  const keys = Object.keys(raw), others = keys.filter(key => !owned.includes(key));
  const usual = [...owned.filter(key => keys.includes(key)), ...others];
  return { ...(others.length ? { extra: Object.fromEntries(others.map(key => [key, raw[key]])) } : {}), ...(keys.some((key, index) => key !== usual[index]) ? { order: keys } : {}) };
}

/** The item without the named carried keys; nothing else changes. */
export function withoutCarried<T extends Carried>(item: T, keys: readonly string[]): T {
  if (!item.extra || !keys.some(key => key in item.extra!)) return item;
  const extra = Object.fromEntries(Object.entries(item.extra).filter(([key]) => !keys.includes(key)));
  const { extra: _old, ...rest } = item;
  return (Object.keys(extra).length ? { ...rest, extra } : rest) as T;
}

/** A copy of an item drawn anew (duplicate or paste): nothing carried comes along, since it described the original only. */
export function freshCopy<T extends Carried & { saved?: AreaBaseline; meterLocations?: string[] }>(item: T): T {
  const { extra: _extra, order: _order, saved: _saved, meterLocations: _locations, ...rest } = item;
  return rest as T;
}

/**
 * Writes an item: the editor's own keys, then the carried ones it keeps (never replacing its own), in the saved order
 * when there is one. `drop` leaves out a carried key that no longer holds.
 */
export function withCarried(own: Json, item: Carried, drop: (key: string, value: unknown) => boolean = () => false): Json {
  const entries = [...Object.entries(own).filter(([, value]) => value !== undefined), ...Object.entries(item.extra ?? {}).filter(([key, value]) => !Object.hasOwn(own, key) && !drop(key, value))];
  if (item.order) { const rank = new Map(item.order.map((key, index) => [key, index])); entries.sort(([a], [b]) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity)); }
  return Object.fromEntries(entries);
}

export const sameRect = (a: Rect | undefined, b: Rect | undefined) => !!a && !!b && a.every((value, index) => Math.round(value) === Math.round(b[index]!));
export const samePoint = (a: Point | null | undefined, b: Point | null | undefined) => !a || !b ? !a && !b : Math.round(a[0]) === Math.round(b[0]) && Math.round(a[1]) === Math.round(b[1]);
export const sameNames = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");
