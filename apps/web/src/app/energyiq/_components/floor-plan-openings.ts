/**
 * Doors, double doors, openings (gaps) and windows in room walls, as the layout editor holds them. Each belongs to a room
 * by the room's key in the plan, so it follows the room when it is moved, resized (it keeps its place along the wall, and
 * stays on it), renamed, copied or deleted. On save it names its room by the room's stable id, or by its name when the
 * room has none. Drawing only: doors never change how meters are grouped.
 *
 * Saved layouts are untrusted: only well-formed openings whose room is on the plan are read (see project-spatial-drawing),
 * and anything else an opening carries rides along as saved.
 */
import { isSpatialOpening, MAX_OPENINGS, openingSpan, type SpatialOpening, type SpatialOpeningKind, type SpatialWall } from "@datafoundry/contracts";
import { carriedOf, withCarried, type Carried, type Json } from "./floor-plan-carry";
import type { FloorPlan, PlanRoom, Point, Rect } from "./floor-plan-model";

export type PlanOpening = { key: string; room: string; wall: SpatialWall; offset: number; width: number; kind: SpatialOpeningKind; swing?: "in" | "out"; hinge?: "start" | "end" } & Carried;
const OPENING_KEYS = ["id", "room", "wall", "offset", "width", "kind", "swing", "hinge"] as const;
export { MAX_OPENINGS };

/** The openings a saved layout holds, each tied to the plan room it names (by id first, then by name). */
export function readOpenings(raw: unknown, rooms: PlanRoom[]): PlanOpening[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>(), list: PlanOpening[] = [];
  for (const item of raw) {
    if (list.length >= MAX_OPENINGS || !isSpatialOpening(item) || seen.has(item.id)) continue;
    const room = rooms.find(entry => entry.id === item.room) ?? rooms.find(entry => entry.name === item.room);
    if (!room) continue;
    seen.add(item.id);
    list.push({ key: item.id, room: room.key, wall: item.wall, offset: item.offset, width: item.width, kind: item.kind, ...(item.swing ? { swing: item.swing } : {}), ...(item.hinge ? { hinge: item.hinge } : {}), ...carriedOf(item, OPENING_KEYS) });
  }
  return list;
}
const wallLength = (rect: Rect, wall: SpatialWall) => wall === "n" || wall === "s" ? rect[2] : rect[3];
/** The openings as saved: rooms named by id (or name), widths kept to their wall. Openings whose room is gone are left out. */
export function writeOpenings(plan: FloorPlan): Json[] {
  return (plan.openings ?? []).flatMap(item => {
    const room = plan.rooms.find(entry => entry.key === item.room);
    if (!room) return [];
    const own: SpatialOpening = { id: item.key, room: room.id ?? room.name.trim(), wall: item.wall, offset: item.offset, width: Math.max(1, Math.min(item.width, Math.round(wallLength(room.rect, item.wall)))), kind: item.kind, ...(item.swing ? { swing: item.swing } : {}), ...(item.hinge ? { hinge: item.hinge } : {}) };
    return [withCarried(own as unknown as Json, item)];
  });
}

export const isDoorLike = (kind: SpatialOpeningKind) => kind !== "window";
/** The room's openings, in drawing order. */
export const openingsOf = (plan: FloorPlan, roomKey: string) => (plan.openings ?? []).filter(item => item.room === roomKey);
/** Usual width of a new opening: about a door's width on a plan this size, never wider than most of its wall. */
export function defaultWidth(plan: FloorPlan, kind: SpatialOpeningKind, length: number): number {
  const unit = plan.viewBox[2] / 100, wanted = unit * (kind === "door" ? 3 : kind === "opening" ? 4 : 5);
  return Math.max(4, Math.round(Math.min(wanted, length * 0.8)));
}
const newKey = (plan: FloorPlan) => { const taken = new Set((plan.openings ?? []).map(item => item.key)); let number = taken.size + 1; while (taken.has(`op-${number}`)) number += 1; return `op-${number}`; };
const round = (value: number) => Math.round(value * 10000) / 10000;
/** The room with its automatic door switched off: a room with doors of its own draws only those. */
const withoutAutoDoor = (plan: FloorPlan, roomKey: string): PlanRoom[] => plan.rooms.map(room => room.key === roomKey && room.autoDoor !== false ? { ...room, autoDoor: false as const } : room);
/**
 * Adds an opening to one wall of a room, centred at `offset` along it. A door, double door or opening switches the room's
 * automatic door off (written as `autoDoor: false`), so the room never shows two doors. Null when the plan is full.
 */
export function addOpening(plan: FloorPlan, roomKey: string, wall: SpatialWall, offset: number, kind: SpatialOpeningKind = "door"): { plan: FloorPlan; key: string } | null {
  const room = plan.rooms.find(item => item.key === roomKey);
  if (!room || (plan.openings?.length ?? 0) >= MAX_OPENINGS) return null;
  const length = wallLength(room.rect, wall), width = defaultWidth(plan, kind, length), key = newKey(plan);
  const half = width / 2 / Math.max(1, length), at = round(Math.min(Math.max(offset, half), 1 - half));
  const opening: PlanOpening = { key, room: roomKey, wall, offset: at, width, kind };
  return { plan: { ...plan, rooms: isDoorLike(kind) ? withoutAutoDoor(plan, roomKey) : plan.rooms, openings: [...(plan.openings ?? []), opening] }, key };
}
/** Changes one opening; turning a window into a door switches its room's automatic door off too. */
export function updateOpening(plan: FloorPlan, key: string, patch: Partial<Pick<PlanOpening, "wall" | "width" | "kind" | "swing" | "hinge" | "offset">>): FloorPlan {
  const current = plan.openings?.find(item => item.key === key);
  if (!current) return plan;
  const next = { ...current, ...patch };
  if (patch.width !== undefined) next.width = Math.max(4, Math.round(patch.width));
  const changed = (Object.keys(patch) as Array<keyof typeof patch>).some(name => next[name] !== current[name]);
  if (!changed) return plan;
  return { ...plan, rooms: isDoorLike(next.kind) && !isDoorLike(current.kind) ? withoutAutoDoor(plan, current.room) : plan.rooms, openings: plan.openings!.map(item => item === current ? next : item) };
}
/** Turns a door round: hinged at the other end of its gap and opening the other way. */
export const flipOpening = (plan: FloorPlan, key: string) => { const item = plan.openings?.find(entry => entry.key === key); return item ? updateOpening(plan, key, { hinge: item.hinge === "end" ? "start" : "end", swing: item.swing === "out" ? "in" : "out" }) : plan; };
/** Slides an opening along its wall by the part of (dx, dy) that runs along it; it always stays on the wall. */
export function slideOpening(plan: FloorPlan, key: string, dx: number, dy: number): FloorPlan {
  const item = plan.openings?.find(entry => entry.key === key), room = item && plan.rooms.find(entry => entry.key === item.room);
  if (!item || !room) return plan;
  const length = Math.max(1, wallLength(room.rect, item.wall)), half = Math.min(item.width, length) / 2 / length;
  const offset = round(Math.min(Math.max(item.offset + (item.wall === "n" || item.wall === "s" ? dx : dy) / length, half), 1 - half));
  return offset === item.offset ? plan : { ...plan, openings: plan.openings!.map(entry => entry === item ? { ...entry, offset } : entry) };
}
/** Where an opening is drawn on its room, or null when its room is gone. */
export function spanOf(plan: FloorPlan, item: PlanOpening) {
  const room = plan.rooms.find(entry => entry.key === item.room);
  return room ? openingSpan(room.rect, item) : null;
}
/** The box an opening takes on the plan (a thin strip along the wall), for selecting and lining up. */
export function openingBox(plan: FloorPlan, item: PlanOpening): Rect | null {
  const span = spanOf(plan, item);
  if (!span) return null;
  const depth = plan.viewBox[2] / 100 * 0.8, [ax, ay] = span.a, [bx, by] = span.b;
  return ay === by ? [ax, ay - depth / 2, Math.max(bx - ax, 0.01), depth] : [ax - depth / 2, ay, depth, Math.max(by - ay, 0.01)];
}
/**
 * The wall of a room nearest a point (within `reach`), and where along it the point falls: for adding a door where the
 * plan was clicked. Rooms holding the point come first; then the closest wall wins.
 */
export function wallAt(plan: FloorPlan, [px, py]: Point, reach: number): { room: PlanRoom; wall: SpatialWall; offset: number } | null {
  let best: { room: PlanRoom; wall: SpatialWall; offset: number; distance: number; inside: boolean } | null = null;
  for (const room of plan.rooms) {
    const [x, y, w, h] = room.rect, inside = px >= x && px <= x + w && py >= y && py <= y + h;
    const walls: Array<[SpatialWall, number, number]> = [["n", Math.abs(py - y), (px - x) / w], ["s", Math.abs(py - y - h), (px - x) / w], ["w", Math.abs(px - x), (py - y) / h], ["e", Math.abs(px - x - w), (py - y) / h]];
    for (const [wall, across, along] of walls) {
      if (along < 0 || along > 1) continue;
      if (across > reach) continue;
      if (!best || (inside && !best.inside) || (inside === best.inside && across < best.distance)) best = { room, wall, offset: along, distance: across, inside };
    }
  }
  return best ? { room: best.room, wall: best.wall, offset: best.offset } : null;
}
/**
 * Copies of `source` openings that belong to copied rooms (`rooms` maps each copied room's key to its copy's key), with new
 * keys, as many as the plan still has room for. Nothing carried comes along: it described the original only.
 */
export function copiedOpenings(plan: FloorPlan, source: PlanOpening[], rooms: Map<string, string>): PlanOpening[] {
  const taken = new Set((plan.openings ?? []).map(item => item.key)), room = Math.max(0, MAX_OPENINGS - taken.size);
  return source.filter(item => rooms.has(item.room)).slice(0, room).map(item => {
    let number = 1; while (taken.has(`op-copy-${number}`)) number += 1;
    const key = `op-copy-${number}`; taken.add(key);
    const { extra: _extra, order: _order, ...copy } = item;
    return { ...copy, key, room: rooms.get(item.room)! };
  });
}
