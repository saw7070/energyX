/**
 * Working on several items at once: selecting, moving, deleting, locking, drawing order, and duplicate / copy / paste.
 * Every function returns the same plan object when nothing changes, so a press that does nothing leaves no undo step.
 */
import { freshCopy, sameRect } from "./floor-plan-carry";
import { clampDelta, within } from "./floor-plan-geometry";
import { findLine, inside, lineBox, MAX_LINES, shiftLines, type PlanLine } from "./floor-plan-lines";
import { copiedOpenings, newRoomId, openingBox, type PlanOpening } from "./floor-plan-openings";
import { asOwnArea, clampPoint, clampRect, deviceRect, MAX_AREAS, MAX_ROOMS, moveSelection, NO_PASSENGERS, passengers, removeSelection, roomOwner, settleRooms, type FloorPlan, type PlanArea, type PlanRoom, type Point, type Rect, type Selection } from "./floor-plan-model";

export type Riders = ReturnType<typeof NO_PASSENGERS>;
export const sameItem = (a: Selection, b: Selection) => a.kind === b.kind && a.key === b.key;
export const isIn = (list: readonly Selection[], item: Selection) => list.some(entry => sameItem(entry, item));
/** Shift- or Cmd/Ctrl-click: adds the item, or takes it out when it is already selected. */
export const toggled = (list: Selection[], item: Selection) => isIn(list, item) ? list.filter(entry => !sameItem(entry, item)) : [...list, item];

function find(plan: FloorPlan, item: Selection): { locked?: true } | null | undefined {
  if (item.kind === "area") return plan.areas.find(entry => entry.key === item.key);
  if (item.kind === "room") return plan.rooms.find(entry => entry.key === item.key);
  if (item.kind === "device") return plan.devices.find(entry => entry.meterId === item.key);
  if (item.kind === "line") return findLine(plan, item.key);
  // A door or window is locked with its room: locking a room keeps its doors where they are too.
  if (item.kind === "opening") { const opening = plan.openings?.find(entry => entry.key === item.key); return opening ? (plan.rooms.find(room => room.key === opening.room)?.locked ? { locked: true } : {}) : undefined; }
  return plan.entrance as { locked?: true } | null;
}
export const exists = (plan: FloorPlan, item: Selection) => !!find(plan, item);
export const isLocked = (plan: FloorPlan, item: Selection) => find(plan, item)?.locked === true;
/** Only what is still on the plan (after an undo or a delete, a selected item may be gone). */
export const stillThere = (plan: FloorPlan, list: Selection[]) => list.every(item => exists(plan, item)) ? list : list.filter(item => exists(plan, item));

/** Where an item is drawn: its box, or a point (a box with no size) for a dot or the entrance. */
export function boxOf(plan: FloorPlan, item: Selection): Rect | null {
  if (item.kind === "area" || item.kind === "room") return (find(plan, item) as { rect: Rect } | undefined)?.rect ?? null;
  if (item.kind === "device") { const device = plan.devices.find(entry => entry.meterId === item.key); return device ? deviceRect(device) ?? [device.position[0], device.position[1], 0, 0] : null; }
  if (item.kind === "line") { const line = findLine(plan, item.key); return line ? lineBox(line) : null; }
  if (item.kind === "opening") { const opening = plan.openings?.find(entry => entry.key === item.key); return opening ? openingBox(plan, opening) : null; }
  return plan.entrance ? [plan.entrance.position[0], plan.entrance.position[1], 0, 0] : null;
}

/**
 * Everything on the drawing, in the order it is drawn; `shown` says which devices the editor draws (those with a meter).
 * Doors and windows are not listed: they belong to their room (select one by clicking it, or from its room's panel).
 */
export function everything(plan: FloorPlan, shown: (meterId: string) => boolean = () => true): Selection[] {
  return [
    ...plan.areas.filter(item => !item.insideRoom).map(item => ({ kind: "area" as const, key: item.key })), ...plan.rooms.map(item => ({ kind: "room" as const, key: item.key })),
    ...plan.areas.filter(item => item.insideRoom).map(item => ({ kind: "area" as const, key: item.key })), ...(plan.lines ?? []).map(item => ({ kind: "line" as const, key: item.key })), ...(plan.entrance ? [{ kind: "entrance" as const, key: "entrance" }] : []),
    ...plan.devices.filter(item => shown(item.meterId)).map(item => ({ kind: "device" as const, key: item.meterId })),
  ];
}
/** What a selection box takes: every item fully inside it. */
export const inBox = (plan: FloorPlan, box: Rect, shown?: (meterId: string) => boolean) => everything(plan, shown).filter(item => { const at = boxOf(plan, item); return !!at && within(at, box); });

/**
 * What rides along when the selection moves: the rooms, equipment, devices and lines inside each selected area or room. A
 * locked item still rides with the area it is in; only moving it on its own is blocked.
 */
export function ridersOf(plan: FloorPlan, list: Selection[]): Riders {
  const riders = NO_PASSENGERS();
  for (const item of list) {
    if (isLocked(plan, item)) continue;
    const { rooms, areas, devices, lines } = passengers(plan, item);
    rooms.forEach(key => riders.rooms.add(key)); areas.forEach(key => riders.areas.add(key)); devices.forEach(key => riders.devices.add(key)); lines.forEach(key => riders.lines.add(key));
  }
  return riders;
}

/**
 * Moves every selected item that is not locked, with what is inside it, by the same amount. Each item moves once, even
 * when it is both selected and inside another selected item, and the group stops together at the edge of the plan.
 */
export function moveItems(plan: FloorPlan, list: Selection[], dx: number, dy: number, riders: Riders = ridersOf(plan, list)): FloorPlan {
  // A door or window only slides along its wall on its own; with other items it stays with its room.
  const movable = list.filter(item => exists(plan, item) && !isLocked(plan, item));
  const hosts = movable.length > 1 ? movable.filter(item => item.kind !== "opening") : movable;
  if (!hosts.length) return plan;
  if (hosts.length === 1) return moveSelection(plan, hosts[0]!, dx, dy, riders);
  const [mx, my] = clampDelta(hosts.map(item => boxOf(plan, item)!), [dx, dy], plan.viewBox);
  if (!mx && !my) return plan;
  const keys = (kind: Selection["kind"], extra: Set<string>) => new Set([...hosts.filter(item => item.kind === kind).map(item => item.key), ...extra]);
  const areas = keys("area", riders.areas), rooms = keys("room", riders.rooms), devices = keys("device", riders.devices);
  const shift = (rect: Rect): Rect => clampRect([rect[0] + mx, rect[1] + my, rect[2], rect[3]], plan.viewBox);
  const step = (point: Point): Point => clampPoint([point[0] + mx, point[1] + my], plan.viewBox);
  return {
    ...plan,
    areas: plan.areas.map(item => areas.has(item.key) ? { ...item, rect: shift(item.rect) } : item),
    rooms: plan.rooms.map(item => rooms.has(item.key) ? { ...item, rect: shift(item.rect) } : item),
    devices: plan.devices.map(item => devices.has(item.meterId) ? { ...item, position: step(item.position) } : item),
    entrance: plan.entrance && hosts.some(item => item.kind === "entrance") ? { ...plan.entrance, position: step(plan.entrance.position) } : plan.entrance,
    ...(plan.lines ? { lines: shiftLines(plan, keys("line", riders.lines), mx, my).lines } : {}),
  };
}

/** Deletes the selected items that are not locked. */
export const removeItems = (plan: FloorPlan, list: Selection[]) => list.filter(item => !isLocked(plan, item)).reduce((current, item) => exists(current, item) ? removeSelection(current, item) : current, plan);

/** Locks or unlocks the selected areas, rooms, equipment, devices and lines (the entrance has no lock; doors and windows lock with their room). */
export function lockItems(plan: FloorPlan, list: Selection[], lock: boolean): FloorPlan {
  let changed = false;
  const set = <T extends { locked?: true }>(item: T, picked: boolean): T => {
    if (!picked || !!item.locked === lock) return item;
    changed = true;
    if (lock) return { ...item, locked: true };
    const { locked: _locked, ...rest } = item;
    return rest as T;
  };
  const next = { ...plan, areas: plan.areas.map(item => set(item, isIn(list, { kind: "area", key: item.key }))), rooms: plan.rooms.map(item => set(item, isIn(list, { kind: "room", key: item.key }))), devices: plan.devices.map(item => set(item, isIn(list, { kind: "device", key: item.meterId }))), ...(plan.lines ? { lines: plan.lines.map(item => set(item, isIn(list, { kind: "line", key: item.key }))) } : {}) };
  return changed ? next : plan;
}

/**
 * Brings the selected items to the front (drawn last) or sends them to the back (drawn first) among items of the same
 * kind: areas among areas, equipment among equipment, rooms among rooms, devices among devices. The saved lists keep
 * this order, and the map draws in it.
 */
export function reorderItems(plan: FloorPlan, list: Selection[], where: "front" | "back"): FloorPlan {
  let changed = false;
  const bump = <T>(items: T[], sameKind: (item: T) => boolean, picked: (item: T) => boolean): T[] => {
    const slots = items.flatMap((item, index) => sameKind(item) ? [index] : []), kind = slots.map(index => items[index]!);
    const chosen = kind.filter(picked), rest = kind.filter(item => !picked(item));
    const order = where === "front" ? [...rest, ...chosen] : [...chosen, ...rest];
    if (!chosen.length || order.every((item, index) => item === kind[index])) return items;
    changed = true;
    const next = [...items];
    slots.forEach((slot, index) => { next[slot] = order[index]!; });
    return next;
  };
  const area = (item: PlanArea) => isIn(list, { kind: "area", key: item.key });
  let areas = bump(plan.areas, item => !item.insideRoom, area);
  areas = bump(areas, item => !!item.insideRoom, area);
  const rooms = bump(plan.rooms, () => true, item => isIn(list, { kind: "room", key: item.key }));
  const devices = bump(plan.devices, () => true, item => isIn(list, { kind: "device", key: item.meterId }));
  const lines = plan.lines ? bump(plan.lines, () => true, item => isIn(list, { kind: "line", key: item.key })) : undefined;
  return changed ? { ...plan, areas, rooms, devices, ...(lines ? { lines } : {}) } : plan;
}

/**
 * What Copy holds: the areas, rooms and lines picked, the rooms and equipment inside them, the doors and windows of
 * those rooms, and which ones were picked.
 */
export type Clip = { areas: PlanArea[]; rooms: PlanRoom[]; roots: Selection[]; lines?: PlanLine[]; openings?: PlanOpening[] };
/**
 * Copies the selected areas, rooms and equipment, with the rooms and equipment inside them. Devices and the entrance
 * are not copied: each meter is placed on the plan once, and a site has one main entrance. Null when nothing can be copied.
 */
export function copyItems(plan: FloorPlan, list: Selection[]): Clip | null {
  const areaKeys = new Set<string>(), roomKeys = new Set<string>(), roots: Selection[] = [];
  for (const item of list) {
    if (item.kind === "area") {
      const host = plan.areas.find(entry => entry.key === item.key);
      if (!host) continue;
      areaKeys.add(host.key); roots.push(item);
      if (!host.insideRoom) for (const room of plan.rooms) if (roomOwner(plan, room)?.key === host.key) roomKeys.add(room.key);
    }
    if (item.kind === "room" && plan.rooms.some(entry => entry.key === item.key)) { roomKeys.add(item.key); roots.push(item); }
    if (item.kind === "line" && findLine(plan, item.key)) roots.push(item);
  }
  for (const item of plan.areas) if (item.insideRoom && roomKeys.has(item.insideRoom)) areaKeys.add(item.key);
  const lines = (plan.lines ?? []).filter(line => isIn(roots, { kind: "line", key: line.key })), openings = (plan.openings ?? []).filter(opening => roomKeys.has(opening.room));
  return roots.length ? { areas: plan.areas.filter(item => areaKeys.has(item.key)), rooms: plan.rooms.filter(item => roomKeys.has(item.key)), roots, ...(lines.length ? { lines } : {}), ...(openings.length ? { openings } : {}) } : null;
}

const LETTERS = Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index));
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Longest area label and room name the editor offers. */
export const LABEL_MAX = 40, ROOM_NAME_MAX = 60;
/**
 * A label for a copied area that no other area uses: the next free letter for a one-letter label ("A" → "C"), otherwise
 * "Block 264F copy", then "Block 264F copy 2" and so on. `copyOf` words "… copy" in the reader's language.
 */
export function uniqueLabel(label: string, taken: Set<string>, copyOf: (name: string) => string, max = LABEL_MAX): string {
  const text = label.trim();
  if (/^[A-Z]$/i.test(text)) { const letter = LETTERS.find(item => !taken.has(item)); if (letter) return letter; }
  // A copy of a copy counts on from the original ("Block 264F copy" → "Block 264F copy 2"), never "… copy copy".
  const [before = "", after = ""] = copyOf("\u0000").split("\u0000");
  const stem = new RegExp(`^${escape(before)}(.+?)${escape(after)}(?: \\d+)?$`).exec(text)?.[1] ?? text;
  for (let number = 1; ; number += 1) {
    const suffix = number > 1 ? ` ${number}` : "", room = max - before.length - after.length - suffix.length;
    const candidate = copyOf(stem.slice(0, Math.max(1, room)).trim()) + suffix;
    if (!taken.has(candidate)) return candidate;
  }
}
/** A name for a copied room that no other room uses: "Store" → "Store 2", "Room 3" → "Room 4". */
export function uniqueRoomName(name: string, taken: Set<string>, max = ROOM_NAME_MAX): string {
  const text = name.trim(), match = /^(.*\S)\s+(\d{1,6})$/.exec(text);
  const stem = match ? match[1]! : text;
  for (let number = match ? Number(match[2]) + 1 : 2; ; number += 1) {
    const suffix = ` ${number}`, candidate = stem.slice(0, max - suffix.length).trim() + suffix;
    if (!taken.has(candidate)) return candidate;
  }
}
export { newRoomId };
export const roomIds = (plan: FloorPlan) => plan.rooms.flatMap(room => room.id ? [room.id] : []);
/**
 * Whether adding `areas` areas and `rooms` rooms keeps the plan within what a saved layout can hold. `hidden` is how
 * many areas the layout holds that are not on the drawing: they count too.
 */
export const fitsLimits = (plan: FloorPlan, hidden: number, areas: number, rooms: number) => plan.areas.length + hidden + areas <= MAX_AREAS && plan.rooms.length + rooms <= MAX_ROOMS;

/**
 * Puts a copy of what Copy holds on the plan, `offset` units down and to the right (kept inside the plan), on top of
 * everything of its kind. Copies get new labels, names and room ids, and start unlocked. Nothing carried from the
 * saved layout comes along (meter locations, report notes): it described the original only. Copies name no panel, so
 * the report keeps linking the panel's meters to the original until the reader picks one for the copy. A room filed
 * under an area that is not on the drawing keeps that filing for its copy while the copy stays put. Equipment whose room was
 * not copied goes back into that room, or becomes its own area when that room is gone. `reserved` are labels used by
 * areas that are not on the drawing. The copies of what was picked come back selected.
 */
export function pasteClip(plan: FloorPlan, clip: Clip, offset: number, copyOf: (name: string) => string, reserved: string[] = []): { plan: FloorPlan; selection: Selection[] } {
  const [dx, dy] = clampDelta([...clip.areas, ...clip.rooms].map(item => item.rect).concat((clip.lines ?? []).map(lineBox)), [offset, offset], plan.viewBox);
  const shift = (rect: Rect): Rect => clampRect([rect[0] + dx, rect[1] + dy, rect[2], rect[3]], plan.viewBox);
  const keys = new Set([...plan.areas.map(item => item.key), ...plan.rooms.map(item => item.key)]);
  const fresh = (prefix: string) => { let number = 1; while (keys.has(`${prefix}-copy-${number}`)) number += 1; const key = `${prefix}-copy-${number}`; keys.add(key); return key; };
  const areaKeys = new Map(clip.areas.map(item => [item.key, fresh(item.insideRoom ? "group" : "area")]));
  const roomKeys = new Map(clip.rooms.map(item => [item.key, fresh("room")]));
  const labels = new Set([...plan.areas.map(item => item.label.trim()), ...reserved]), names = new Set(plan.rooms.map(item => item.name.trim())), ids = new Set(roomIds(plan));
  const areas = clip.areas.map((source): PlanArea => {
    const { locked: _locked, boardFilled: _filled, ...copy } = freshCopy(source);
    const label = uniqueLabel(source.label, labels, copyOf); labels.add(label);
    const next: PlanArea = { ...copy, key: areaKeys.get(source.key)!, label, board: "", rect: shift(source.rect) };
    if (!source.insideRoom) return next;
    const room = roomKeys.get(source.insideRoom) ?? (plan.rooms.some(item => item.key === source.insideRoom) ? source.insideRoom : undefined);
    return room ? { ...next, insideRoom: room } : asOwnArea(next);
  });
  const rooms = clip.rooms.map((source): PlanRoom => {
    const { locked: _locked, zone: _zone, zoneRect: _zoneRect, area: from, ...copy } = freshCopy(source);
    const name = uniqueRoomName(source.name, names); names.add(name);
    const id = newRoomId(ids); ids.add(id);
    const area = from === undefined ? undefined : areaKeys.get(from) ?? from, rect = shift(source.rect);
    // Filed under an area not on the drawing (and not moved out of it): the copy is filed there too.
    const filed = source.zone !== undefined && (!roomOwner(plan, source) || sameRect(source.zoneRect, source.rect)) ? { zone: source.zone, zoneRect: [...rect] as Rect } : {};
    return { ...copy, key: roomKeys.get(source.key)!, name, rect, ...(area ? { area } : {}), ...filed, id };
  });
  // Lines get new keys and start unlocked; doors and windows come with the copies of their rooms.
  const lineKeys = new Map<string, string>(), taken = new Set((plan.lines ?? []).map(item => item.key));
  const lines = (clip.lines ?? []).slice(0, Math.max(0, MAX_LINES - taken.size)).map((source): PlanLine => {
    const { locked: _locked, savedPoints: _saved, ...copy } = freshCopy(source);
    let number = 1; while (taken.has(`ln-copy-${number}`)) number += 1;
    const key = `ln-copy-${number}`; taken.add(key); lineKeys.set(source.key, key);
    return { ...copy, key, points: source.points.map(([x, y]) => inside([x + dx, y + dy], plan.viewBox)) };
  });
  const openings = copiedOpenings(plan, clip.openings ?? [], roomKeys);
  const selection = clip.roots.flatMap((root): Selection[] => { const key = (root.kind === "area" ? areaKeys : root.kind === "line" ? lineKeys : roomKeys).get(root.key); return key ? [{ kind: root.kind, key }] : []; });
  return { plan: settleRooms({ ...plan, areas: [...plan.areas, ...areas], rooms: [...plan.rooms, ...rooms], ...(lines.length ? { lines: [...(plan.lines ?? []), ...lines] } : {}), ...(openings.length ? { openings: [...(plan.openings ?? []), ...openings] } : {}) }), selection };
}
