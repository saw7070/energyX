/**
 * The size of the plan's text and symbols in the editor: the same as the shared map draws them (spatialTextUnit), so
 * names, labels, landmarks and the room kept for them match on screen, in the saved map and in the report. On its own
 * module (types only from floor-plan-model) so every floor-plan helper can use it without an import cycle.
 */
import { spatialTextUnit } from "@datafoundry/contracts";
import type { FloorPlan, PlanArea, PlanRoom } from "./floor-plan-model";

type Sized = Pick<FloorPlan, "viewBox" | "rooms" | "areas"> & Partial<Pick<FloorPlan, "levels" | "elsewhere">>;
// Equipment groups sit inside rooms: like the map, only stand-alone areas count.
const unitOf = (viewBox: FloorPlan["viewBox"], rooms: PlanRoom[], areas: PlanArea[]) => spatialTextUnit(viewBox, rooms.map(room => room.rect), areas.filter(item => !item.insideRoom).map(item => item.rect));
// Plans are never changed in place (every edit makes a new plan), so a plan's unit is worked out once: helpers that
// measure every item (a sweep finding what it covers) ask for it many times over.
const units = new WeakMap<Sized, number>();

/**
 * The unit for a plan. The map draws each floor of a site with floors on its own, sized from that floor's rooms and
 * areas, so a floor's view (levelView, what the editor shows) gives that floor's unit. The whole plan of a site with
 * floors gives the largest any floor uses, so the room kept for labels (when the plan shrinks or grows) is enough on
 * every floor.
 */
export function planUnit(plan: Sized): number {
  const known = units.get(plan);
  if (known !== undefined) return known;
  const levels = plan.levels ?? [];
  const first = levels[0]?.id, floorOf = (item: { level?: string }) => item.level && levels.some(level => level.id === item.level) ? item.level : first;
  const unit = plan.elsewhere || levels.length < 2 ? unitOf(plan.viewBox, plan.rooms, plan.areas)
    : Math.max(...levels.map(level => unitOf(plan.viewBox, plan.rooms.filter(room => floorOf(room) === level.id), plan.areas.filter(item => floorOf(item) === level.id))));
  units.set(plan, unit);
  return unit;
}
