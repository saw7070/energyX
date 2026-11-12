/**
 * Working on several items at once: selecting, moving, deleting, locking, drawing order, and duplicate / copy / paste.
 * Every function returns the same plan object when nothing changes, so a press that does nothing leaves no undo step.
 */
import { freshCopy, sameRect } from "./floor-plan-carry";
import { clampDelta, within } from "./floor-plan-geometry";
import { shiftLabel, shiftSymbol, withoutRejected } from "./floor-plan-mark-data";
import { boxFrame, frameBounds, hitsFrame, labelBounds, labelFrame, MARK_LIMIT, normaliseRotation, symbolBounds, symbolFrame, type Frame, type PlanLabel, type PlanSymbol } from "./floor-plan-marks";
import { asOwnArea, clampPoint, clampRect, deviceRect, devicePosition, MAX_AREAS, MAX_ROOMS, moveSelection, NO_PASSENGERS, passengers, promoteEntrance, removeSelection, roomOwner, settleRooms, type FloorPlan, type PlanArea, type PlanRoom, type Point, type Rect, type Selection } from "./floor-plan-model";

export type Riders = ReturnType<typeof NO_PASSENGERS>;
export const sameItem = (a: Selection, b: Selection) => a.kind === b.kind && a.key === b.key;
export const isIn = (list: readonly Selection[], item: Selection) => list.some(entry => sameItem(entry, item));
/** Shift- or Cmd/Ctrl-click: adds the item, or takes it out when it is already selected. */
export const toggled = (list: Selection[], item: Selection) => isIn(list, item) ? list.filter(entry => !sameItem(entry, item)) : [...list, item];

function find(plan: FloorPlan, item: Selection): { locked?: true } | null | undefined {
  if (item.kind === "area") return plan.areas.find(entry => entry.key === item.key);
  if (item.kind === "room") return plan.rooms.find(entry => entry.key === item.key);
  if (item.kind === "device") return plan.devices.find(entry => entry.meterId === item.key);
  if (item.kind === "label") return plan.labels?.find(entry => entry.key === item.key);
  if (item.kind === "symbol") return plan.symbols?.find(entry => entry.key === item.key);
  return plan.entrance as { locked?: true } | null;
}
export const exists = (plan: FloorPlan, item: Selection) => !!find(plan, item);
export const isLocked = (plan: FloorPlan, item: Selection) => find(plan, item)?.locked === true;
/** Only what is still on the plan (after an undo or a delete, a selected item may be gone). */
export const stillThere = (plan: FloorPlan, list: Selection[]) => list.every(item => exists(plan, item)) ? list : list.filter(item => exists(plan, item));

/**
 * Where an item is drawn: its box, or a point (a box with no size) for a dot or the entrance. A text label or landmark
 * gives the upright box around it as turned. A device box gives its box before turning (its size and the Width and
 * Height fields); `extentOf` gives the space it takes once turned.
 */
export function boxOf(plan: FloorPlan, item: Selection): Rect | null {
  if (item.kind === "area" || item.kind === "room") return (find(plan, item) as { rect: Rect } | undefined)?.rect ?? null;
  const unit = plan.viewBox[2] / 100;
  if (item.kind === "label") { const label = plan.labels?.find(entry => entry.key === item.key); return label ? labelBounds(label, unit) : null; }
  if (item.kind === "symbol") { const symbol = plan.symbols?.find(entry => entry.key === item.key); return symbol ? symbolBounds(symbol, unit) : null; }
  if (item.kind === "device") { const device = plan.devices.find(entry => entry.meterId === item.key); return device ? deviceRect(device) ?? [device.position[0], device.position[1], 0, 0] : null; }
  return plan.entrance ? [plan.entrance.position[0], plan.entrance.position[1], 0, 0] : null;
}

/** The shape an item turns with (see floor-plan-marks), for the items that can turn: labels, landmarks, the entrance and device boxes. */
export function frameOf(plan: FloorPlan, item: Selection): Frame | null {
  const unit = plan.viewBox[2] / 100;
  if (item.kind === "label") { const label = plan.labels?.find(entry => entry.key === item.key); return label ? labelFrame(label, unit) : null; }
  if (item.kind === "symbol") { const symbol = plan.symbols?.find(entry => entry.key === item.key); return symbol ? symbolFrame(symbol, unit) : null; }
  if (item.kind === "entrance") { const entrance = plan.entrance; return entrance ? symbolFrame({ kind: "entrance", position: entrance.position, ...(entrance.size !== undefined ? { size: entrance.size } : {}), ...(entrance.rotation ? { rotation: entrance.rotation } : {}) }, unit) : null; }
  if (item.kind === "device") { const device = plan.devices.find(entry => entry.meterId === item.key); return device?.size ? boxFrame(device.position, device.size, device.rotation ?? 0) : null; }
  return null;
}
/** The text label or landmark under a point, found by turning the point back the other way (the topmost one wins). */
export function markAt(plan: FloorPlan, point: Point): Selection | null {
  const found = [...everything(plan)].reverse().find(item => (item.kind === "label" || item.kind === "symbol") && hitsFrame(point, frameOf(plan, item)!));
  return found ?? null;
}
/** The space an item takes on the plan: its box, turned (for a turned device box). */
export function extentOf(plan: FloorPlan, item: Selection): Rect | null {
  if (item.kind === "device") { const device = plan.devices.find(entry => entry.meterId === item.key); if (device?.size && device.rotation) return frameBounds(boxFrame(device.position, device.size, device.rotation)); }
  return boxOf(plan, item);
}
/** Everything on the drawing, in the order it is drawn; `shown` says which devices the editor draws (those with a meter). */
export function everything(plan: FloorPlan, shown: (meterId: string) => boolean = () => true): Selection[] {
  return [
    ...plan.areas.filter(item => !item.insideRoom).map(item => ({ kind: "area" as const, key: item.key })), ...plan.rooms.map(item => ({ kind: "room" as const, key: item.key })),
    ...plan.areas.filter(item => item.insideRoom).map(item => ({ kind: "area" as const, key: item.key })), ...(plan.labels ?? []).map(item => ({ kind: "label" as const, key: item.key })),
    ...(plan.symbols ?? []).map(item => ({ kind: "symbol" as const, key: item.key })), ...(plan.entrance ? [{ kind: "entrance" as const, key: "entrance" }] : []),
    ...plan.devices.filter(item => shown(item.meterId)).map(item => ({ kind: "device" as const, key: item.meterId })),
  ];
}
/** What a selection box takes: every item fully inside it, turned items by the upright box around them as turned. */
export const inBox = (plan: FloorPlan, box: Rect, shown?: (meterId: string) => boolean) => everything(plan, shown).filter(item => { const at = extentOf(plan, item); return !!at && within(at, box); });

/**
 * What rides along when the selection moves: the rooms, equipment and devices inside each selected area or room. A
 * locked item still rides with the area it is in; only moving it on its own is blocked.
 */
export function ridersOf(plan: FloorPlan, list: Selection[]): Riders {
  const riders = NO_PASSENGERS();
  for (const item of list) {
    if (isLocked(plan, item)) continue;
    const { rooms, areas, devices } = passengers(plan, item);
    rooms.forEach(key => riders.rooms.add(key)); areas.forEach(key => riders.areas.add(key)); devices.forEach(key => riders.devices.add(key));
  }
  return riders;
}

/**
 * Moves every selected item that is not locked, with what is inside it, by the same amount. Each item moves once, even
 * when it is both selected and inside another selected item, and the group stops together at the edge of the plan.
 */
export function moveItems(plan: FloorPlan, list: Selection[], dx: number, dy: number, riders: Riders = ridersOf(plan, list)): FloorPlan {
  const hosts = list.filter(item => exists(plan, item) && !isLocked(plan, item));
  if (!hosts.length) return plan;
  if (hosts.length === 1) return moveSelection(plan, hosts[0]!, dx, dy, riders);
  const [mx, my] = clampDelta(hosts.map(item => extentOf(plan, item)!), [dx, dy], plan.viewBox);
  if (!mx && !my) return plan;
  const keys = (kind: Selection["kind"], extra: Set<string>) => new Set([...hosts.filter(item => item.kind === kind).map(item => item.key), ...extra]);
  const areas = keys("area", riders.areas), rooms = keys("room", riders.rooms), devices = keys("device", riders.devices), labels = keys("label", new Set()), symbols = keys("symbol", new Set());
  const shift = (rect: Rect): Rect => clampRect([rect[0] + mx, rect[1] + my, rect[2], rect[3]], plan.viewBox);
  const step = (point: Point): Point => clampPoint([point[0] + mx, point[1] + my], plan.viewBox);
  return {
    ...plan,
    areas: plan.areas.map(item => areas.has(item.key) ? { ...item, rect: shift(item.rect) } : item),
    rooms: plan.rooms.map(item => rooms.has(item.key) ? { ...item, rect: shift(item.rect) } : item),
    devices: plan.devices.map(item => devices.has(item.meterId) ? { ...item, position: devicePosition(item, [item.position[0] + mx, item.position[1] + my], plan.viewBox) } : item),
    entrance: plan.entrance && hosts.some(item => item.kind === "entrance") ? { ...plan.entrance, position: step(plan.entrance.position) } : plan.entrance,
    ...(plan.labels ? { labels: plan.labels.map(item => labels.has(item.key) ? shiftLabel(item, mx, my, plan.viewBox) : item) } : {}),
    ...(plan.symbols ? { symbols: plan.symbols.map(item => symbols.has(item.key) ? shiftSymbol(item, mx, my, plan.viewBox) : item) } : {}),
  };
}

/**
 * Turns one item to `deg` degrees (clockwise): a text label, a landmark, the entrance or a device box. A label, landmark
 * or box stays fully inside the plan as turned. Locked items stay as they are; the same plan when nothing changes.
 */
export function turnItem(plan: FloorPlan, item: Selection, deg: number): FloorPlan {
  if (isLocked(plan, item)) return plan;
  // A saved turn the checks turned down (riding along as written) goes, so turning back to 0° never brings it back.
  const rotation = normaliseRotation(deg), turned = <T extends { rotation?: number; extra?: Record<string, unknown>; mark?: { extra?: Record<string, unknown> } }>(entry: T): T => { const { rotation: _old, ...rest } = withoutRejected(entry, "rotation", item.kind === "entrance"); return (rotation ? { ...rest, rotation } : rest) as T; };
  const same = (entry: { rotation?: number }) => (entry.rotation ?? 0) === rotation;
  if (item.kind === "label") { const label = plan.labels?.find(entry => entry.key === item.key); return !label || same(label) ? plan : { ...plan, labels: plan.labels!.map(entry => entry === label ? shiftLabel(turned(entry), 0, 0, plan.viewBox) : entry) }; }
  if (item.kind === "symbol") { const symbol = plan.symbols?.find(entry => entry.key === item.key); return !symbol || same(symbol) ? plan : { ...plan, symbols: plan.symbols!.map(entry => entry === symbol ? shiftSymbol(turned(entry), 0, 0, plan.viewBox) : entry) }; }
  if (item.kind === "entrance") return !plan.entrance || same(plan.entrance) ? plan : { ...plan, entrance: turned(plan.entrance) };
  if (item.kind === "device") { const device = plan.devices.find(entry => entry.meterId === item.key); if (!device?.size || same(device)) return plan; const next = turned(device); return { ...plan, devices: plan.devices.map(entry => entry === device ? { ...next, position: devicePosition(next, next.position, plan.viewBox) } : entry) }; }
  return plan;
}

/**
 * Deletes the selected items that are not locked. The first entrance goes last: deleting it makes the next entrance
 * landmark the first, and that one must not survive when it was selected too.
 */
export const removeItems = (plan: FloorPlan, list: Selection[]) => [...list.filter(item => item.kind !== "entrance"), ...list.filter(item => item.kind === "entrance")].filter(item => !isLocked(plan, item)).reduce((current, item) => exists(current, item) ? removeSelection(current, item) : current, plan);

/** Locks or unlocks the selected areas, rooms, equipment, devices, text labels, landmarks and entrance. */
export function lockItems(plan: FloorPlan, list: Selection[], lock: boolean): FloorPlan {
  let changed = false;
  const set = <T extends { locked?: true }>(item: T, picked: boolean): T => {
    if (!picked || !!item.locked === lock) return item;
    changed = true;
    if (lock) return { ...item, locked: true };
    const { locked: _locked, ...rest } = item;
    return rest as T;
  };
  const next = { ...plan, areas: plan.areas.map(item => set(item, isIn(list, { kind: "area", key: item.key }))), rooms: plan.rooms.map(item => set(item, isIn(list, { kind: "room", key: item.key }))), devices: plan.devices.map(item => set(item, isIn(list, { kind: "device", key: item.meterId }))),
    entrance: plan.entrance ? set(plan.entrance, isIn(list, { kind: "entrance", key: "entrance" })) : null,
    ...(plan.labels ? { labels: plan.labels.map(item => set(item, isIn(list, { kind: "label", key: item.key }))) } : {}), ...(plan.symbols ? { symbols: plan.symbols.map(item => set(item, isIn(list, { kind: "symbol", key: item.key }))) } : {}) };
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
  const labels = plan.labels && bump(plan.labels, () => true, item => isIn(list, { kind: "label", key: item.key })), symbols = plan.symbols && bump(plan.symbols, () => true, item => isIn(list, { kind: "symbol", key: item.key }));
  return changed ? { ...plan, areas, rooms, devices, ...(labels ? { labels } : {}), ...(symbols ? { symbols } : {}) } : plan;
}

/** What Copy holds: the areas and rooms picked, the rooms and equipment inside them, the text labels and landmarks picked, and which ones were picked. */
export type Clip = { areas: PlanArea[]; rooms: PlanRoom[]; labels?: PlanLabel[]; symbols?: PlanSymbol[]; roots: Selection[] };
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
    if ((item.kind === "label" || item.kind === "symbol") && exists(plan, item)) roots.push(item);
  }
  for (const item of plan.areas) if (item.insideRoom && roomKeys.has(item.insideRoom)) areaKeys.add(item.key);
  const labels = (plan.labels ?? []).filter(item => isIn(roots, { kind: "label", key: item.key })), symbols = (plan.symbols ?? []).filter(item => isIn(roots, { kind: "symbol", key: item.key }));
  return roots.length ? { areas: plan.areas.filter(item => areaKeys.has(item.key)), rooms: plan.rooms.filter(item => roomKeys.has(item.key)), ...(labels.length ? { labels } : {}), ...(symbols.length ? { symbols } : {}), roots } : null;
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
/** A new stable room id no other room has. */
export function newRoomId(taken: Iterable<string>): string {
  const used = new Set(taken);
  for (;;) { const id = `rm-${Math.random().toString(36).slice(2, 10).padEnd(8, "0")}`; if (!used.has(id)) return id; }
}
export const roomIds = (plan: FloorPlan) => plan.rooms.flatMap(room => room.id ? [room.id] : []);
/**
 * Whether adding `areas` areas and `rooms` rooms keeps the plan within what a saved layout can hold. `hidden` is how
 * many areas the layout holds that are not on the drawing: they count too.
 */
export const fitsLimits = (plan: FloorPlan, hidden: number, areas: number, rooms: number) => plan.areas.length + hidden + areas <= MAX_AREAS && plan.rooms.length + rooms <= MAX_ROOMS;
/** Whether adding `labels` text labels and `symbols` landmarks keeps the plan within what a saved layout can hold (entries kept aside count too). */
export const fitsMarks = (plan: FloorPlan, labels: number, symbols: number) => (plan.labels?.length ?? 0) + (plan.carried?.labels?.length ?? 0) + labels <= MARK_LIMIT && (plan.symbols?.length ?? 0) + (plan.entrance ? 1 : 0) + (plan.carried?.symbols?.length ?? 0) + symbols <= MARK_LIMIT;
/** A new id for a text label or landmark (letters, digits and -), unlike any other on the plan. */
export function newMarkId(plan: FloorPlan, prefix: "lb" | "sy"): string {
  const used = new Set([...(plan.labels ?? []), ...(plan.symbols ?? []), ...(plan.entrance ? [plan.entrance] : [])].flatMap(item => item.id ? [item.id] : []));
  for (;;) { const id = `${prefix}-${Math.random().toString(36).slice(2, 10).padEnd(8, "0")}`; if (!used.has(id)) return id; }
}

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
  const unit = plan.viewBox[2] / 100;
  const [dx, dy] = clampDelta([...clip.areas.map(item => item.rect), ...clip.rooms.map(item => item.rect), ...(clip.labels ?? []).map(item => labelBounds(item, unit)), ...(clip.symbols ?? []).map(item => symbolBounds(item, unit))], [offset, offset], plan.viewBox);
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
  // Text labels and landmarks: fresh keys and ids, unlocked, nothing carried from the saved layout.
  const markKeys = new Set([...(plan.labels ?? []), ...(plan.symbols ?? [])].map(item => item.key)), markKey = (prefix: string) => { let number = 1; while (markKeys.has(`${prefix}-copy-${number}`)) number += 1; const key = `${prefix}-copy-${number}`; markKeys.add(key); return key; };
  const labelKeys = new Map<string, string>(), symbolKeys = new Map<string, string>();
  let withIds: FloorPlan = plan;
  const newLabels = (clip.labels ?? []).map((source): PlanLabel => { const { locked: _locked, asSaved: _saved, ...copy } = freshCopy(source), key = markKey("label"), id = newMarkId(withIds, "lb"); labelKeys.set(source.key, key); const next = shiftLabel({ ...copy, key, id }, dx, dy, plan.viewBox); withIds = { ...withIds, labels: [...(withIds.labels ?? []), next] }; return next; });
  const newSymbols = (clip.symbols ?? []).map((source): PlanSymbol => { const { locked: _locked, asSaved: _saved, ...copy } = freshCopy(source), key = markKey("symbol"), id = newMarkId(withIds, "sy"); symbolKeys.set(source.key, key); const next = shiftSymbol({ ...copy, key, id }, dx, dy, plan.viewBox); withIds = { ...withIds, symbols: [...(withIds.symbols ?? []), next] }; return next; });
  const keyMaps: Partial<Record<Selection["kind"], Map<string, string>>> = { area: areaKeys, room: roomKeys, label: labelKeys, symbol: symbolKeys };
  const selection = clip.roots.flatMap((root): Selection[] => { const key = keyMaps[root.kind]?.get(root.key); return key ? [{ kind: root.kind, key }] : []; });
  // A plan left with no main entrance takes the first pasted entrance as it (so `layout.entrance` is written from it).
  const pasted = settleRooms({ ...plan, areas: [...plan.areas, ...areas], rooms: [...plan.rooms, ...rooms], ...(newLabels.length ? { labels: [...(plan.labels ?? []), ...newLabels] } : {}), ...(newSymbols.length ? { symbols: [...(plan.symbols ?? []), ...newSymbols] } : {}) });
  const next = promoteEntrance(pasted);
  if (next === pasted) return { plan: next, selection };
  const left = new Set((next.symbols ?? []).map(entry => entry.key));
  return { plan: next, selection: selection.map(entry => entry.kind === "symbol" && !left.has(entry.key) ? { kind: "entrance", key: "entrance" } : entry) };
}
