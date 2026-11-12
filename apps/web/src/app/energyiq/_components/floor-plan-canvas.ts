/**
 * Growing the drawing space to the left or upward. The stored format keeps every coordinate at 0 or more, so the plan
 * first uses the room it already has before its top-left corner (a viewBox that does not start at 0, which every reader
 * draws). Past that, everything on the plan moves right (or down) by the same amount, so items keep their places
 * relative to each other, and so do the saved notes that depend on them (board markers, where the entrance was).
 *
 * Saved layouts are untrusted and may hold keys from a later version or the advisor that this editor does not know.
 * Such keys could hold positions it cannot move, so a plan that carries them only grows as far as its top-left room
 * allows: it is never left with something drawn in the wrong place.
 */
import { isRecord, type Json } from "./floor-plan-carry";
import { contentBounds, isPoint, isRect, MAX_COORD, MAX_PLAN_SIZE, MIN_PLAN, type FloorPlan, type Point, type Rect } from "./floor-plan-model";

/** Carried keys known to hold no position: names, text, lists of names, colours and flags. */
const NO_POSITION = new Set(["kind", "rooms", "directionFromEntrance", "referenceBoard", "id", "locked", "colour", "label", "name", "meterLocations", "equipment", "physicalParentRoom", "independentSpace"]);
const plain = (extra: Json | undefined) => !extra || Object.keys(extra).every(key => NO_POSITION.has(key));

/**
 * Whether everything the plan holds can move together: nothing it carries could be a position this editor does not
 * know how to move. Board markers are moved when each is a plain [x, y] point.
 */
export function canShift(plan: FloorPlan): boolean {
  const { boardMarkers, ...rest } = plan.extra ?? {};
  if (Object.keys(rest).length) return false;
  if (boardMarkers !== undefined && !(isRecord(boardMarkers) && Object.values(boardMarkers).every(isPoint))) return false;
  if (plan.carried?.devices?.length || plan.carried?.rawDevices || plan.carried?.shapes?.length) return false;
  if (![...plan.areas, ...plan.rooms, ...plan.devices, ...(plan.shapes ?? [])].every(item => plain(item.extra)) || (plan.entrance && !plain(plan.entrance.extra))) return false;
  return (plan.carried?.zones ?? []).every(({ zone }) => Object.keys(zone).every(key => key === "rect" || NO_POSITION.has(key)));
}

/** Everything on the plan moved by (dx, dy), together with the saved notes that depend on where things are. */
export function shiftPlan(plan: FloorPlan, dx: number, dy: number): FloorPlan {
  if (!dx && !dy) return plan;
  const rect = ([x, y, w, h]: Rect): Rect => [x + dx, y + dy, w, h];
  const point = ([x, y]: Point): Point => [x + dx, y + dy];
  const carried = plan.carried;
  const markers = plan.extra && isRecord(plan.extra.boardMarkers) ? { ...plan.extra, boardMarkers: Object.fromEntries(Object.entries(plan.extra.boardMarkers).map(([board, at]) => [board, isPoint(at) ? point(at) : at])) } : plan.extra;
  return {
    ...plan,
    areas: plan.areas.map(item => ({ ...item, rect: rect(item.rect), ...(item.saved ? { saved: { ...item.saved, rect: rect(item.saved.rect) } } : {}) })),
    rooms: plan.rooms.map(item => ({ ...item, rect: rect(item.rect), ...(item.zoneRect ? { zoneRect: rect(item.zoneRect) } : {}) })),
    devices: plan.devices.map(item => ({ ...item, position: point(item.position) })),
    ...(plan.shapes ? { shapes: plan.shapes.map(item => ({ ...item, rect: rect(item.rect) })) } : {}),
    entrance: plan.entrance ? { ...plan.entrance, position: point(plan.entrance.position) } : null,
    ...(markers ? { extra: markers } : {}),
    ...(carried ? { carried: { ...carried, ...(carried.entrance ? { entrance: point(carried.entrance) } : {}), ...(carried.zones ? { zones: carried.zones.map(item => isRect(item.zone.rect) ? { ...item, zone: { ...item.zone, rect: rect(item.zone.rect) } } : item) } : {}) } } : {}),
  };
}

/**
 * Pulls the left edge ("w") or the top edge ("n") of the drawing space so it becomes `size` wide or tall; the opposite
 * edge stays where it is. It never cuts off anything drawn, never goes past the stored format's limits, and returns the
 * same plan when nothing changes. `blocked` says it could not grow as far as asked because the plan carries items this
 * version cannot move.
 */
export function resizeCanvasFrom(plan: FloorPlan, edge: "w" | "n", size: number): { plan: FloorPlan; blocked: boolean } {
  const axis = edge === "w" ? 0 : 1, box = plan.viewBox, origin = box[axis], length = box[axis + 2], end = origin + length;
  const bounds = contentBounds(plan);
  // Shrinking stops at the first thing drawn (or keeps today's edge when something is already that close to it).
  const shortest = Math.max(MIN_PLAN[axis]!, Math.min(length, bounds ? end - bounds[axis] : 0));
  let wanted = Math.round(Math.min(MAX_PLAN_SIZE, Math.max(shortest, size)));
  const set = (next: FloorPlan, start: number, span: number): FloorPlan => {
    const viewBox = [...next.viewBox] as Rect; viewBox[axis] = start; viewBox[axis + 2] = span;
    return viewBox.every((value, index) => value === plan.viewBox[index]) ? plan : { ...next, viewBox };
  };
  if (end - wanted >= 0) return { plan: set(plan, end - wanted, wanted), blocked: false };
  // Past the top-left corner: everything moves over, unless something carried could not move with it.
  if (!canShift(plan)) return { plan: set(plan, 0, end), blocked: true };
  wanted = Math.min(wanted, MAX_COORD);
  const by = wanted - end;
  return { plan: set(shiftPlan(plan, axis === 0 ? by : 0, axis === 1 ? by : 0), 0, wanted), blocked: false };
}
