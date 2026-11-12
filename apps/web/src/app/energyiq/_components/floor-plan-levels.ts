/**
 * Floors (levels). A plan with no floors, or one, is today's plan, unchanged. With two or more, every item sits on one
 * floor (`level`, missing meaning the first) and the editor works on one floor at a time: `levelView` is the plan as that
 * floor sees it, so everything the editor already does (selecting, moving, which area a room belongs to, placing devices)
 * stays on that floor without knowing floors exist, and `mergeView` puts a changed floor back into the whole plan.
 *
 * Names never come from floor names: a room copied onto another floor whose name is taken gets a short suffix once
 * ("Store (2)"), kept from then on, with the short name shown (`displayName`). Renaming a floor changes no room names.
 */
import { freshCopy, type Carried } from "./floor-plan-carry";
import { newRoomId, uniqueLabel, ROOM_NAME_MAX } from "./floor-plan-arrange";
import { settleRooms, type Elsewhere, type FloorPlan, type PlanArea, type PlanLevel, type PlanRoom } from "./floor-plan-model";

/** Most floors a layout can hold (the stored format's limit), and the longest floor name the editor offers. */
export const MAX_LEVELS = 50, LEVEL_NAME_MAX = 40;
type Item = { level?: string };
type Lists = Record<string, Item[]>;
/**
 * Fields of the plan whose items each sit on one floor. A later kind (labels, landmarks, walls and doors, shapes)
 * registers its field here, and then follows floors everywhere: shown per floor, kept on its floor, moved or deleted
 * with a floor, and, when `copy` is set, copied by Duplicate floor (an item with a string `key` gets a new one).
 */
const FIELDS: Array<{ field: string; copy: boolean }> = [{ field: "areas", copy: true }, { field: "rooms", copy: true }, { field: "devices", copy: false }];
export function registerLevelField(field: string, options: { copy: boolean }) { if (!FIELDS.some(item => item.field === field)) FIELDS.push({ field, ...options }); }
const listOf = (plan: FloorPlan, field: string): Item[] => { const value = (plan as unknown as Lists)[field]; return Array.isArray(value) ? value : []; };
const hasField = (plan: FloorPlan, field: string) => Array.isArray((plan as unknown as Lists)[field]);

/** Whether the plan has floors to choose between (two or more). */
export const hasLevels = (plan: Pick<FloorPlan, "levels">) => (plan.levels?.length ?? 0) > 1;
export const firstLevel = (plan: Pick<FloorPlan, "levels">) => plan.levels?.[0]?.id ?? "";
/** The floor an item is on. */
export const levelOf = (plan: Pick<FloorPlan, "levels">, item: Item | null | undefined) => item?.level && plan.levels?.some(level => level.id === item.level) ? item.level : firstLevel(plan);
/** The floor shown: the one asked for when the plan still has it, else the first. */
export const currentLevel = (plan: Pick<FloorPlan, "levels">, wanted?: string) => wanted && plan.levels?.some(level => level.id === wanted) ? wanted : firstLevel(plan);
/** The floor drawn faintly under this one (the floor before it), if any. */
export const levelBelow = (plan: Pick<FloorPlan, "levels">, level: string) => { const index = plan.levels?.findIndex(item => item.id === level) ?? -1; return index > 0 ? plan.levels![index - 1]!.id : null; };

// One view per plan and floor, so the editor sees the same object until the plan changes (a change that does nothing then
// leaves no undo step).
const views = new WeakMap<FloorPlan, Map<string, FloorPlan>>();
/** The plan as one floor sees it. A plan without floors to choose between is its own view. */
export function levelView(plan: FloorPlan, level: string): FloorPlan {
  if (!hasLevels(plan)) return plan;
  const cached = views.get(plan)?.get(level);
  if (cached) return cached;
  const on = (item: Item) => levelOf(plan, item) === level, off = (item: Item) => !on(item);
  const areasAway = plan.areas.filter(off), roomsAway = plan.rooms.filter(off);
  const elsewhere: Elsewhere = { keys: [...areasAway.map(item => item.key), ...roomsAway.map(item => item.key)], labels: areasAway.map(item => item.label.trim()), names: roomsAway.map(item => item.name.trim()), ids: roomsAway.flatMap(item => item.id ? [item.id] : []), areas: areasAway.length, rooms: roomsAway.length };
  const lists = Object.fromEntries(FIELDS.filter(({ field }) => hasField(plan, field)).map(({ field }) => [field, listOf(plan, field).filter(on)]));
  const view = { ...plan, ...lists, entrance: plan.entrance && on(plan.entrance) ? plan.entrance : null, elsewhere } as FloorPlan;
  const byLevel = views.get(plan) ?? new Map<string, FloorPlan>();
  byLevel.set(level, view); views.set(plan, byLevel);
  return view;
}

/** An item put on `level`: unchanged when it is already there (an item naming no floor is on the first). */
function tagged<T extends Item>(plan: FloorPlan, item: T, level: string): T {
  if (item.level === level || (item.level === undefined && level === firstLevel(plan))) return item;
  if (level === firstLevel(plan)) { const { level: _level, ...rest } = item; return rest as T; }
  return { ...item, level };
}
/**
 * Puts a changed floor back into the whole plan: each of its items takes the place of one of that floor's items, in
 * order, so the saved order stays as it was where nothing moved. A device placed on this floor leaves any other floor
 * (each meter is on the plan once). Returns the whole plan itself when the floor did not change.
 */
export function mergeView(plan: FloorPlan, level: string, next: FloorPlan): FloorPlan {
  if (!hasLevels(plan)) return next;
  const view = levelView(plan, level);
  if (next === view) return plan;
  const { elsewhere: _elsewhere, ...rest } = next;
  const placed = new Set(next.devices.map(item => item.meterId));
  const lists: Lists = {};
  for (const { field } of FIELDS) {
    if (!hasField(plan, field) && !hasField(next, field)) continue;
    const all = listOf(plan, field), mine = listOf(next, field).map(item => tagged(plan, item, level));
    let index = 0;
    const merged: Item[] = [];
    for (const item of all) {
      if (levelOf(plan, item) !== level) { if (!(field === "devices" && placed.has((item as { meterId: string }).meterId))) merged.push(item); }
      else if (index < mine.length) merged.push(mine[index++]!);
    }
    merged.push(...mine.slice(index));
    lists[field] = merged.length === all.length && merged.every((item, at) => item === all[at]) ? all : merged;
  }
  // The entrance: put on this floor when this floor has it; taken away when it was here and is gone; else left where it is.
  const entrance = next.entrance ? tagged(plan, next.entrance, level) : view.entrance ? null : plan.entrance;
  return { ...rest, ...lists, entrance } as FloorPlan;
}
/** After a move on one floor: each room there belongs to the area it now sits in on that floor. */
export const settleLevel = (plan: FloorPlan, level: string) => mergeView(plan, level, settleRooms(levelView(plan, level)));

/** Every item, on every floor, through `change` (the entrance too). */
function eachItem(plan: FloorPlan, change: <T extends Item>(item: T) => T | null): FloorPlan {
  const lists = Object.fromEntries(FIELDS.filter(({ field }) => hasField(plan, field)).map(({ field }) => [field, listOf(plan, field).flatMap(item => { const next = change(item); return next ? [next] : []; })]));
  return { ...plan, ...lists, entrance: plan.entrance ? change(plan.entrance) : null } as FloorPlan;
}
/** Every item names its floor outright, so the floors can change order (or the first go) without moving anything. */
const spelledOut = (plan: FloorPlan) => eachItem(plan, item => item.level === levelOf(plan, item) ? item : { ...item, level: levelOf(plan, item) });
/** Items on the first floor name none again (the form saved before floors existed). */
const tidied = (plan: FloorPlan) => eachItem(plan, item => { if (item.level === undefined || item.level !== firstLevel(plan)) return item; const { level: _level, ...rest } = item; return rest as typeof item; });
/** With one floor left, the plan is a plain one-floor plan again, saved exactly as before floors existed. */
const single = (plan: FloorPlan): FloorPlan => { if (hasLevels(plan)) return plan; const { levels: _levels, ...rest } = eachItem(plan, item => { if (item.level === undefined) return item; const { level: _level, ...other } = item; return other as typeof item; }); return rest as FloorPlan; };

/** A floor id no floor has yet. */
function newLevelId(plan: FloorPlan): string { const taken = new Set(plan.levels?.map(item => item.id)); let number = (plan.levels?.length ?? 0) + 1; while (taken.has(`level-${number}`)) number += 1; return `level-${number}`; }
/**
 * Adds a floor after the others (a plan without floors first becomes "Floor 1" with everything on it). `names` words a
 * floor's default name in the reader's language. Null when the plan holds as many floors as it can.
 */
export function addLevel(plan: FloorPlan, names: (number: number) => string): { plan: FloorPlan; level: string } | null {
  const levels: PlanLevel[] = plan.levels?.length ? plan.levels : [{ id: "level-1", name: names(1) }];
  if (levels.length >= MAX_LEVELS) return null;
  const base = { ...plan, levels };
  const id = newLevelId(base);
  let number = levels.length + 1; while (levels.some(item => item.name === names(number))) number += 1;
  return { plan: { ...base, levels: [...levels, { id, name: names(number) }] }, level: id };
}
export function renameLevel(plan: FloorPlan, level: string, name: string): FloorPlan {
  const text = name.slice(0, LEVEL_NAME_MAX);
  return plan.levels?.some(item => item.id === level && item.name !== text) ? { ...plan, levels: plan.levels.map(item => item.id === level ? { ...item, name: text } : item) } : plan;
}
/** Moves a floor one place earlier (-1) or later (1) in the tabs; its items stay on it. */
export function moveLevel(plan: FloorPlan, level: string, by: -1 | 1): FloorPlan {
  const levels = plan.levels ?? [], from = levels.findIndex(item => item.id === level), to = from + by;
  if (from < 0 || to < 0 || to >= levels.length) return plan;
  const order = [...levels]; [order[from], order[to]] = [order[to]!, order[from]!];
  const spelled = from === 0 || to === 0 ? spelledOut(plan) : plan;
  return from === 0 || to === 0 ? tidied({ ...spelled, levels: order }) : { ...plan, levels: order };
}
/** What is on a floor, for the question asked before deleting it. */
export const levelContents = (plan: FloorPlan, level: string) => { const on = (item: Item) => levelOf(plan, item) === level; return { areas: plan.areas.filter(on).length, rooms: plan.rooms.filter(on).length, devices: plan.devices.filter(on).length, others: FIELDS.filter(({ field }) => !["areas", "rooms", "devices"].includes(field)).reduce((sum, { field }) => sum + listOf(plan, field).filter(on).length, 0) + (plan.entrance && on(plan.entrance) ? 1 : 0) }; };
/**
 * Deletes a floor. Nothing on it goes silently: with `moveTo` its items move to that floor (where they keep their place
 * on the drawing); without, they are deleted with it, and its devices go back to the list of devices to place.
 */
export function deleteLevel(plan: FloorPlan, level: string, moveTo: string | null): FloorPlan {
  if (!plan.levels?.some(item => item.id === level) || plan.levels.length < 2 || moveTo === level || (moveTo && !plan.levels.some(item => item.id === moveTo))) return plan;
  const spelled = spelledOut(plan);
  const moved = eachItem(spelled, item => item.level !== level ? item : moveTo ? { ...item, level: moveTo } : null);
  return single(tidied(settleRoomsEverywhere({ ...moved, levels: plan.levels.filter(item => item.id !== level) })));
}
/** Each room belongs to an area on its own floor, on every floor. */
function settleRoomsEverywhere(plan: FloorPlan): FloorPlan { return hasLevels(plan) ? plan.levels!.reduce((current, item) => settleLevel(current, item.id), plan) : settleRooms(plan); }

/** "Store" → "Store (2)", the first not taken (kept within `max` characters). */
export function suffixed(name: string, taken: Set<string>, max = ROOM_NAME_MAX): string {
  const text = name.trim();
  for (let number = 2; ; number += 1) { const suffix = ` (${number})`, candidate = text.slice(0, max - suffix.length).trim() + suffix; if (!taken.has(candidate)) return candidate; }
}
/**
 * A floor copied after the one copied: its areas, rooms, equipment and other drawing items, at the same places, but not
 * its devices (each meter is on the plan once) or the entrance. Copies get new keys and room ids, start unlocked and
 * carry nothing from the saved layout. An area label that is taken gets the next free letter (or a suffix), and a room
 * name that is taken gets a suffix once ("Store (2)") with its short name shown. Like any copy, areas name no panel.
 */
export function duplicateLevel(plan: FloorPlan, level: string, copyName: (name: string) => string, areaCopy: (name: string) => string): { plan: FloorPlan; level: string } | null {
  const source = plan.levels?.find(item => item.id === level);
  if (!source || plan.levels!.length >= MAX_LEVELS) return null;
  const id = newLevelId(plan), on = (item: Item) => levelOf(plan, item) === level;
  const keys = new Set<string>(FIELDS.flatMap(({ field }) => listOf(plan, field).flatMap(item => typeof (item as { key?: unknown }).key === "string" ? [(item as { key: string }).key] : [])));
  const fresh = (key: string) => { let number = 1; while (keys.has(`${key}-f${number}`)) number += 1; const next = `${key}-f${number}`; keys.add(next); return next; };
  const areaKeys = new Map(plan.areas.filter(on).map(item => [item.key, fresh(item.key)])), roomKeys = new Map(plan.rooms.filter(on).map(item => [item.key, fresh(item.key)]));
  const labels = new Set([...plan.areas.map(item => item.label.trim()), ...(plan.carried?.zones ?? []).map(({ zone }) => String(zone.id))]);
  const names = new Set(plan.rooms.map(item => item.name.trim())), ids = new Set(plan.rooms.flatMap(item => item.id ? [item.id] : []));
  const areas = plan.areas.filter(on).map((item): PlanArea => {
    const { locked: _locked, boardFilled: _filled, ...copy } = freshCopy(item);
    const label = uniqueLabel(item.label, labels, areaCopy); labels.add(label);
    return { ...copy, key: areaKeys.get(item.key)!, label, board: "", level: id, ...(item.insideRoom ? { insideRoom: roomKeys.get(item.insideRoom) ?? item.insideRoom } : {}) };
  });
  const rooms = plan.rooms.filter(on).map((item): PlanRoom => {
    const { locked: _locked, zoneRect: _zoneRect, area, ...copy } = freshCopy(item);
    const shown = item.displayName ?? item.name.trim(), name = names.has(shown) ? suffixed(shown, names) : shown; names.add(name);
    const roomId = newRoomId(ids); ids.add(roomId);
    const { displayName: _shown, ...rest } = copy;
    return { ...rest, key: roomKeys.get(item.key)!, name, ...(name !== shown ? { displayName: shown } : {}), ...(area ? { area: areaKeys.get(area) ?? area } : {}), ...(item.zone !== undefined ? { zoneRect: [...item.rect] as PlanRoom["rect"] } : {}), id: roomId, level: id };
  });
  const others = Object.fromEntries(FIELDS.filter(({ field, copy }) => copy && field !== "areas" && field !== "rooms" && hasField(plan, field)).map(({ field }) => [field, [...listOf(plan, field), ...listOf(plan, field).filter(on).map(item => { const { locked: _locked, ...copy } = freshCopy(item as Item & Carried & { locked?: true }) as Item & { locked?: true }; return { ...copy, level: id, ...(typeof (item as { key?: unknown }).key === "string" ? { key: fresh((item as { key: string }).key) } : {}) }; })]]));
  const at = plan.levels!.findIndex(item => item.id === level) + 1;
  const levels = [...plan.levels!.slice(0, at), { id, name: copyName(source.name).slice(0, LEVEL_NAME_MAX) }, ...plan.levels!.slice(at)];
  return { plan: settleLevel({ ...plan, ...others, levels, areas: [...plan.areas, ...areas], rooms: [...plan.rooms, ...rooms] }, id), level: id };
}

/**
 * Renames a room. A name another floor's room already has is kept unique across the site with a short suffix ("Store
 * (2)") while the name typed is shown. Two rooms on one floor still may not share a name (saving says so), and a plan
 * without floors renames exactly as before.
 */
export function renameRoom(plan: FloorPlan, key: string, typed: string): FloorPlan {
  const room = plan.rooms.find(item => item.key === key);
  if (!room) return plan;
  const away = new Set(plan.elsewhere?.names ?? []), text = typed.trim();
  if (!away.has(text)) { const { displayName: _shown, ...rest } = room; return { ...plan, rooms: plan.rooms.map(item => item.key === key ? { ...rest, name: typed } : item) }; }
  const taken = new Set([...away, ...plan.rooms.filter(item => item.key !== key).map(item => item.name.trim())]);
  // The suffix chosen once stays while the same name is typed (so it never changes under the reader).
  const name = room.displayName?.trim() === text && !taken.has(room.name.trim()) ? room.name : suffixed(text, taken);
  return { ...plan, rooms: plan.rooms.map(item => item.key === key ? { ...item, name, displayName: typed } : item) };
}
