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
import { promoteEntrance, settleRooms, type Elsewhere, type FloorPlan, type PlanArea, type PlanEntrance, type PlanLevel, type PlanRoom, type PlanSymbol } from "./floor-plan-model";

/** Most floors a layout can hold (the stored format's limit), and the longest floor name the editor offers. */
export const MAX_LEVELS = 50, LEVEL_NAME_MAX = 40;
type Item = { level?: string };
type Lists = Record<string, Item[]>;
/**
 * Fields of the plan whose items each sit on one floor. A later kind registers its field here, and then follows floors
 * everywhere: shown per floor, kept on its floor, moved or deleted with a floor, and, when `copy` is set, copied by
 * Duplicate floor (an item with a string `key` gets a new one). Text labels, landmarks, walls and lines, and plain shapes
 * are registered: each names its own floor. Doors and windows name none: they are on their room's floor.
 */
const FIELDS: Array<{ field: string; copy: boolean }> = [{ field: "areas", copy: true }, { field: "rooms", copy: true }, { field: "devices", copy: false },
  { field: "labels", copy: true }, { field: "symbols", copy: true }, { field: "lines", copy: true }, { field: "shapes", copy: true }];
/** Doors and windows follow their room: on the floor it is on, copied with it, gone with it. */
type Opening = { key: string; room: string };
const openingsOf = (plan: FloorPlan): Opening[] => (plan as { openings?: Opening[] }).openings ?? [];
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
  const here = new Set(plan.rooms.filter(on).map(item => item.key));
  const openings = (plan as { openings?: Opening[] }).openings ? { openings: openingsOf(plan).filter(item => here.has(item.room)) } : {};
  // The other floors' drawing items: their keys and ids (a new door, line, shape, label or landmark here takes none of
  // them), how many there are (the stored format's limits count the whole site), and their entrances.
  const away = (field: string) => listOf(plan, field).filter(off) as Array<{ key?: unknown; id?: unknown; kind?: unknown; label?: unknown }>;
  const openingsAway = openingsOf(plan).filter(item => !here.has(item.room));
  const drawingIds = [...openingsAway.map(item => item.key), ...["lines", "shapes", "labels", "symbols"].flatMap(field => away(field).flatMap(item => [item.key, item.id].filter((value): value is string => typeof value === "string")))];
  const mainAway = !!plan.entrance && off(plan.entrance);
  if (mainAway && plan.entrance!.id) drawingIds.push(plan.entrance!.id);
  const entrances = [...(mainAway ? [plan.entrance!.label] : []), ...away("symbols").filter(item => item.kind === "entrance" && typeof item.label === "string").map(item => item.label as string)];
  Object.assign(elsewhere, { drawingIds, lines: away("lines").length, openings: openingsAway.length, shapes: away("shapes").length, labelCount: away("labels").length, symbols: away("symbols").length + (mainAway ? 1 : 0), entrances, ...(mainAway ? { entrance: true as const } : {}) });
  const view = { ...plan, ...lists, ...openings, entrance: plan.entrance && on(plan.entrance) ? plan.entrance : null, elsewhere } as FloorPlan;
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
  // Doors and windows: those of rooms on other floors stay as they are; this floor's are the view's, in their place.
  const own = new Set(openingsOf(view).map(item => item.key)), mineOpenings = openingsOf(next);
  if (openingsOf(plan).length || mineOpenings.length) {
    let at = 0;
    const merged: Opening[] = [];
    for (const item of openingsOf(plan)) { if (!own.has(item.key)) merged.push(item); else if (at < mineOpenings.length) merged.push(mineOpenings[at++]!); }
    merged.push(...mineOpenings.slice(at));
    const before = openingsOf(plan);
    (lists as Record<string, unknown>).openings = merged.length === before.length && merged.every((item, index) => item === before[index]) ? before : merged;
  }
  // The entrance: put on this floor when this floor has it; taken away when it was here and is gone; else left where it is.
  // The site has one main entrance: one set here while the main entrance is on another floor (which the editor's own
  // checks avoid) never replaces it, and is kept here as an entrance landmark instead.
  if (next.entrance && plan.entrance && !view.entrance) {
    const symbols = (lists.symbols ?? listOf(plan, "symbols")) as PlanSymbol[];
    return { ...rest, ...lists, symbols: [...symbols, asEntranceSymbol(plan, next.entrance, level, symbols)], entrance: plan.entrance } as FloorPlan;
  }
  const entrance = next.entrance ? tagged(plan, next.entrance, level) : view.entrance ? null : plan.entrance;
  const merged = { ...rest, ...lists, entrance } as FloorPlan;
  // Deleting the main entrance makes the next entrance on any floor the main one, on its own floor.
  return view.entrance && !entrance ? promoteEntrance(merged) : merged;
}
/** An entrance set on one floor kept as an entrance landmark there (a new key; what it carries comes along). */
function asEntranceSymbol(plan: FloorPlan, entrance: PlanEntrance, level: string, symbols: PlanSymbol[]): PlanSymbol {
  const keys = new Set(symbols.map(item => item.key));
  let number = 1; while (keys.has(`symbol-entrance-${number}`)) number += 1;
  const { mark, label, position, size, rotation, colour, locked, id } = entrance;
  const symbol: PlanSymbol = { key: `symbol-entrance-${number}`, kind: "entrance", position: [...position] as PlanSymbol["position"], ...(label ? { label } : {}), ...(size !== undefined ? { size } : {}), ...(rotation ? { rotation } : {}), ...(colour ? { colour } : {}), ...(locked ? { locked } : {}), ...(id ? { id } : {}), ...(mark?.extra ? { extra: mark.extra } : {}), ...(mark?.order ? { order: mark.order } : {}) };
  return tagged(plan, symbol, level);
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

/**
 * Floor ids already spoken for: the floors', and any floor an item still names in what it carries from the saved layout
 * (a floor since removed, or a floor list the editor could not read). A new floor never takes one of those, so items the
 * editor shows on the first floor never move onto a new floor after saving.
 */
function usedLevelIds(plan: FloorPlan): Set<string> {
  const ids = new Set(plan.levels?.map(item => item.id));
  const note = (value: unknown) => { if (typeof value === "string") ids.add(value); };
  const carried = (item: unknown) => note((item as Carried | null)?.extra?.level);
  for (const { field } of FIELDS) listOf(plan, field).forEach(carried);
  carried(plan.entrance);
  for (const { zone } of plan.carried?.zones ?? []) note(zone.level);
  for (const { device } of plan.carried?.devices ?? []) note((device as { level?: unknown } | null)?.level);
  const raw = plan.extra?.levels;
  if (Array.isArray(raw)) for (const item of raw) note((item as { id?: unknown } | null)?.id);
  return ids;
}
/** A floor id no floor (or stale item) has yet. */
function newLevelId(plan: FloorPlan, taken = usedLevelIds(plan)): string { let number = (plan.levels?.length ?? 0) + 1; while (taken.has(`level-${number}`)) number += 1; return `level-${number}`; }
/**
 * Adds a floor after the others (a plan without floors first becomes "Floor 1" with everything on it). `names` words a
 * floor's default name in the reader's language. Null when the plan holds as many floors as it can.
 */
export function addLevel(plan: FloorPlan, names: (number: number) => string): { plan: FloorPlan; level: string } | null {
  const taken = usedLevelIds(plan);
  const levels: PlanLevel[] = plan.levels?.length ? plan.levels : [{ id: newLevelId({ ...plan, levels: [] }, taken), name: names(1) }];
  if (levels.length >= MAX_LEVELS) return null;
  const base = { ...plan, levels };
  taken.add(levels[0]!.id);
  const id = newLevelId(base, taken);
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
/** A floor's name as shown: its own, or the default ("Floor 2") when it is blank. */
export const shownLevelName = (level: PlanLevel, index: number, fallback: (number: number) => string) => level.name.trim() || fallback(index + 1);
/** What is on a floor, for the question asked before deleting it (`others`: later kinds, such as labels). */
export type LevelContents = { areas: number; rooms: number; devices: number; entrance: boolean; others: number };
export const levelContents = (plan: FloorPlan, level: string): LevelContents => { const on = (item: Item) => levelOf(plan, item) === level; return { areas: plan.areas.filter(on).length, rooms: plan.rooms.filter(on).length, devices: plan.devices.filter(on).length, entrance: !!plan.entrance && on(plan.entrance), others: FIELDS.filter(({ field }) => !["areas", "rooms", "devices"].includes(field)).reduce((sum, { field }) => sum + listOf(plan, field).filter(on).length, 0) }; };
/**
 * Deletes a floor. Nothing on it goes silently: with `moveTo` its items move to that floor (where they keep their place
 * on the drawing); without, they are deleted with it, and its devices go back to the list of devices to place.
 */
export function deleteLevel(plan: FloorPlan, level: string, moveTo: string | null): FloorPlan {
  if (!plan.levels?.some(item => item.id === level) || plan.levels.length < 2 || moveTo === level || (moveTo && !plan.levels.some(item => item.id === moveTo))) return plan;
  const spelled = spelledOut(plan);
  const moved = eachItem(spelled, item => item.level !== level ? item : moveTo ? { ...item, level: moveTo } : null);
  const kept = moveTo ? unclashed(moved, moveTo) : moved;
  // Deleting the main entrance with its floor makes the next entrance (on another floor) the main one.
  return single(tidied(promoteEntrance(settleRoomsEverywhere({ ...kept, levels: plan.levels.filter(item => item.id !== level) }))));
}
/**
 * Rooms that came together on one floor and now show the same name: each one showing a short name shows its stored,
 * unique one again ("Store (2)"), so no two rooms on that floor look alike. Items here name their floor outright.
 */
function unclashed(plan: FloorPlan, level: string): FloorPlan {
  const here = plan.rooms.filter(room => room.level === level), count = new Map<string, number>();
  for (const room of here) { const shown = (room.displayName ?? room.name).trim(); count.set(shown, (count.get(shown) ?? 0) + 1); }
  if (![...count.values()].some(value => value > 1)) return plan;
  return { ...plan, rooms: plan.rooms.map(room => { if (room.level !== level || room.displayName === undefined || (count.get(room.displayName.trim()) ?? 0) < 2) return room; const { displayName: _shown, ...rest } = room; return rest as PlanRoom; }) };
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
  // A copy's saved id is new too: a label's or landmark's (optional) id is left out, a shape's id is its new key, and a
  // line's key is its id. The first entrance is not copied (it stays the one main entrance).
  const others = Object.fromEntries(FIELDS.filter(({ field, copy }) => copy && field !== "areas" && field !== "rooms" && hasField(plan, field)).map(({ field }) => [field, [...listOf(plan, field), ...listOf(plan, field).filter(on).map(item => {
    const { locked: _locked, asSaved: _saved, savedPoints: _points, ...copy } = freshCopy(item as Item & Carried & { locked?: true; asSaved?: unknown; savedPoints?: unknown }) as Item & { locked?: true; id?: string; asSaved?: unknown; savedPoints?: unknown };
    const key = typeof (item as { key?: unknown }).key === "string" ? fresh((item as { key: string }).key) : undefined;
    if (field === "labels" || field === "symbols") delete copy.id;
    return { ...copy, level: id, ...(key ? { key } : {}), ...(field === "shapes" && key ? { id: key } : {}) };
  })]]));
  // Doors and windows of the rooms copied, on the copies (new keys, nothing carried).
  const openingKeys = new Set(openingsOf(plan).map(item => item.key));
  const copiedOpenings = openingsOf(plan).filter(item => roomKeys.has(item.room)).map(item => {
    let number = 1; while (openingKeys.has(`${item.key}-f${number}`)) number += 1;
    const key = `${item.key}-f${number}`; openingKeys.add(key);
    return { ...freshCopy(item as Opening & Carried), key, room: roomKeys.get(item.room)! };
  });
  if (copiedOpenings.length) (others as Record<string, unknown>).openings = [...openingsOf(plan), ...copiedOpenings];
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
  // A name another room on this floor shows is stored as typed, so saving names the clash instead of hiding it.
  const shownHere = plan.rooms.some(item => item.key !== key && (item.displayName ?? item.name).trim() === text);
  if (!away.has(text) || shownHere) { const { displayName: _shown, ...rest } = room; return { ...plan, rooms: plan.rooms.map(item => item.key === key ? { ...rest, name: typed } : item) }; }
  const taken = new Set([...away, ...plan.rooms.filter(item => item.key !== key).map(item => item.name.trim())]);
  // The suffix chosen once stays while the same name is typed (so it never changes under the reader).
  const name = room.displayName?.trim() === text && !taken.has(room.name.trim()) ? room.name : suffixed(text, taken);
  return { ...plan, rooms: plan.rooms.map(item => item.key === key ? { ...item, name, displayName: typed } : item) };
}

/**
 * The label a new area gets: the first free letter, else "Area 4", "Area 5"… Free means not used by an area on this floor,
 * on any other floor (`elsewhere`), or by an area not on the drawing (`reserved`), so no two floors ever get the same one.
 */
export function nextAreaLabel(plan: FloorPlan, reserved: string[], numbered: (number: number) => string): string {
  const taken = new Set([...plan.areas.map(item => item.label.trim()), ...(plan.elsewhere?.labels ?? []), ...reserved]);
  for (let index = 0; index < 26; index += 1) { const label = String.fromCharCode(65 + index); if (!taken.has(label)) return label; }
  for (let number = plan.areas.length + 1; ; number += 1) { const label = numbered(number); if (!taken.has(label.trim())) return label; }
}
