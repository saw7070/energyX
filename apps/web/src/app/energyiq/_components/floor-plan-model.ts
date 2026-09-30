import { readProjectSpatialReference, type ProjectSpatialReference } from "@datafoundry/contracts";
import { translatorFor, type EnergyIqLocale } from "./energyiq-messages";
import { floorPlanMessages } from "./floor-plan-messages";

/** [x, y, width, height] in plan units. */
export type Rect = [number, number, number, number];
export type Point = [number, number];
/** An area served by one distribution board. `insideRoom` makes it an equipment group drawn inside that room. */
export type PlanArea = { key: string; label: string; board: string; rect: Rect; insideRoom?: string; equipment?: string; colour?: string };
/** `area` is the key of the area the room belongs to; it moves only with that area, even where areas overlap. */
export type PlanRoom = { key: string; name: string; rect: Rect; area?: string; colour?: string };
/** A device on the plan: a dot at `position`, or, with `size`, a named box centred there (e.g. a bank of LED screens). */
export type PlanDevice = { meterId: string; position: Point; size?: Point; colour?: string };
/** `colours` holds a colour chosen for a board (board name → #rrggbb); boards without one use the automatic order. */
export type FloorPlan = { viewBox: Rect; areas: PlanArea[]; rooms: PlanRoom[]; devices: PlanDevice[]; entrance: { label: string; position: Point } | null; colours?: Record<string, string> };
export type Selection = { kind: "area" | "room" | "device" | "entrance"; key: string };

/** The stored block: the shared contract plus the optional extras the Floor plan adds or keeps. */
export type StoredSpatialReference = ProjectSpatialReference & {
  property?: Record<string, unknown>;
  layout: ProjectSpatialReference["layout"] & { entrance?: { label?: string; position?: Point }; devices?: Array<{ meterId: string; position: Point; size?: Point }>; boardColours?: Record<string, string> };
};

export const MIN_SIZE = 20;
export const DEFAULT_VIEWBOX: Rect = [0, 0, 1000, 640];
/** A colour chosen for one item (#rrggbb); items without one use their panel's colour. */
const colourOf = (item: unknown) => { const value = (item as { colour?: unknown } | null)?.colour; return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? { colour: value } : {}; };
const isPoint = (value: unknown): value is Point => Array.isArray(value) && value.length === 2 && value.every(n => typeof n === "number" && Number.isFinite(n));

export const snap = (value: number, step: number) => step > 0 ? Math.round(value / step) * step : value;
export const centre = ([x, y, w, h]: Rect): Point => [x + w / 2, y + h / 2];
export const contains = ([x, y, w, h]: Rect, [px, py]: Point) => px >= x && px <= x + w && py >= y && py <= y + h;
const isSize = (value: unknown): value is Point => isPoint(value) && value[0] >= MIN_SIZE && value[1] >= MIN_SIZE;
/** The box of a device drawn as a box; null for a dot. */
export const deviceRect = (device: { position: Point; size?: Point }): Rect | null => device.size ? [device.position[0] - device.size[0] / 2, device.position[1] - device.size[1] / 2, device.size[0], device.size[1]] : null;
/** Default box for a device switched from a dot: wide enough for its name. */
export const defaultDeviceSize = (viewBox: Rect): Point => [Math.round(viewBox[2] * 0.16), Math.round(viewBox[2] * 0.05)];
const area = ([, , w, h]: Rect) => w * h;

/** Keeps a rectangle at least MIN_SIZE and fully inside the plan. */
export function clampRect([x, y, w, h]: Rect, [vx, vy, vw, vh]: Rect): Rect {
  const width = Math.min(Math.max(MIN_SIZE, w), vw), height = Math.min(Math.max(MIN_SIZE, h), vh);
  return [Math.min(Math.max(vx, x), vx + vw - width), Math.min(Math.max(vy, y), vy + vh - height), width, height];
}
export function clampPoint([x, y]: Point, [vx, vy, vw, vh]: Rect): Point {
  return [Math.min(Math.max(vx, x), vx + vw), Math.min(Math.max(vy, y), vy + vh)];
}
export type Handle = "nw" | "ne" | "sw" | "se";
/** Drags one corner; the opposite corner stays put. */
export function resizeRect([x, y, w, h]: Rect, handle: Handle, dx: number, dy: number, viewBox: Rect): Rect {
  let left = x, top = y, right = x + w, bottom = y + h;
  if (handle.includes("w")) left = Math.min(left + dx, right - MIN_SIZE); else right = Math.max(right + dx, left + MIN_SIZE);
  if (handle.includes("n")) top = Math.min(top + dy, bottom - MIN_SIZE); else bottom = Math.max(bottom + dy, top + MIN_SIZE);
  const [vx, vy, vw, vh] = viewBox;
  left = Math.max(vx, left); top = Math.max(vy, top); right = Math.min(vx + vw, right); bottom = Math.min(vy + vh, bottom);
  return [left, top, right - left, bottom - top];
}

/** Where an equipment group sits when the stored layout only names its room (same geometry as the read-only map). */
function groupRect(room: Rect, viewBox: Rect): Rect {
  const unit = viewBox[2] / 100, [rx, ry, rw, rh] = room, pad = unit * 1.2, height = Math.min(rh * 0.34, unit * 7);
  return [rx + pad, ry + rh - height - pad, rw - pad * 2, height];
}

export function planFromReference(reference: StoredSpatialReference, locale: EnergyIqLocale = "en"): FloorPlan {
  const { layout } = reference;
  const ownZones = new Set(layout.zones.filter(zone => zone.independentSpace !== false && zone.rect).map(zone => zone.id));
  const rooms = layout.rooms.map((room, index): PlanRoom => ({ key: `room-${index + 1}`, name: room.name, rect: [...room.rect] as Rect, ...(ownZones.has(room.zone) ? { area: room.zone } : {}), ...colourOf(room) }));
  const areas = layout.zones.flatMap((zone): PlanArea[] => {
    if (zone.independentSpace === false) {
      const room = rooms.find(item => item.name === zone.physicalParentRoom);
      const rect = zone.rect ? [...zone.rect] as Rect : room ? groupRect(room.rect, layout.viewBox) : null;
      return rect ? [{ key: zone.id, label: zone.id, board: zone.referenceBoard, rect, ...(room ? { insideRoom: room.key } : {}), ...(zone.equipment ? { equipment: zone.equipment } : {}), ...colourOf(zone) }] : [];
    }
    return zone.rect ? [{ key: zone.id, label: zone.id, board: zone.referenceBoard, rect: [...zone.rect] as Rect, ...colourOf(zone) }] : [];
  });
  const devices = (layout.devices ?? []).filter(item => typeof item?.meterId === "string" && isPoint(item.position)).map(item => ({ meterId: item.meterId, position: clampPoint(item.position, layout.viewBox), ...(isSize(item.size) ? { size: [...item.size] as Point } : {}), ...colourOf(item) }));
  const entrance = layout.entrance && isPoint(layout.entrance.position) ? { label: layout.entrance.label || translatorFor(floorPlanMessages, locale)("name.entrance"), position: layout.entrance.position } : null;
  const colours = Object.fromEntries(Object.entries(layout.boardColours ?? {}).filter(([, value]) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)));
  return { viewBox: [...layout.viewBox] as Rect, areas, rooms, devices, entrance, ...(Object.keys(colours).length ? { colours } : {}) };
}

/** A first draft to start from: one area per board side by side, each with one room. */
export function starterPlan(boards: string[], locale: EnergyIqLocale = "en"): FloorPlan {
  const t = translatorFor(floorPlanMessages, locale);
  const [vx, vy, vw] = DEFAULT_VIEWBOX, gap = 30, margin = 20, list = boards.length ? boards : ["Main board"];
  const width = Math.floor((vw - margin * 2 - gap * (list.length - 1)) / list.length);
  const areas = list.map((board, index): PlanArea => ({ key: `area-${index + 1}`, label: String.fromCharCode(65 + index), board, rect: [vx + margin + index * (width + gap), vy + margin, width, 540] }));
  const rooms = areas.map((item, index): PlanRoom => ({ key: `room-${index + 1}`, name: t("name.room", { number: index + 1 }), rect: [item.rect[0] + 20, item.rect[1] + 60, Math.max(MIN_SIZE, item.rect[2] - 40), 180], area: item.key }));
  return { viewBox: [...DEFAULT_VIEWBOX], areas, rooms, devices: [], entrance: null };
}

/** The area a room belongs to: the one it was drawn in while that still holds it, else the smallest area around it. */
export function roomOwner(plan: FloorPlan, room: PlanRoom): PlanArea | undefined {
  const own = plan.areas.filter(item => !item.insideRoom);
  const current = own.find(item => item.key === room.area);
  if (current && contains(current.rect, centre(room.rect))) return current;
  return own.filter(item => contains(item.rect, centre(room.rect))).sort((a, b) => area(a.rect) - area(b.rect))[0];
}
/** After a room or area is moved or resized, each room belongs to the area it now sits in; it keeps its area where areas overlap. */
export function settleRooms(plan: FloorPlan): FloorPlan {
  let changed = false;
  const rooms = plan.rooms.map(room => {
    const owner = roomOwner(plan, room)?.key;
    if (owner === room.area) return room;
    changed = true;
    const { area: _old, ...rest } = room;
    return owner ? { ...rest, area: owner } : rest;
  });
  return changed ? { ...plan, rooms } : plan;
}

export const NO_PASSENGERS = () => ({ rooms: new Set<string>(), areas: new Set<string>(), devices: new Set<string>() });
/**
 * Items that ride along when an area or room is moved: the area's own rooms (not rooms of another area it overlaps),
 * the equipment groups inside those rooms, and the devices on them.
 */
export function passengers(plan: FloorPlan, selection: Selection): { rooms: Set<string>; areas: Set<string>; devices: Set<string> } {
  const host = selection.kind === "area" ? plan.areas.find(item => item.key === selection.key) : selection.kind === "room" ? plan.rooms.find(item => item.key === selection.key) : null;
  if (!host || (selection.kind === "area" && (host as PlanArea).insideRoom)) return NO_PASSENGERS();
  const rooms = selection.kind === "area" ? plan.rooms.filter(room => roomOwner(plan, room)?.key === host.key).map(room => room.key) : [];
  const roomKeys = new Set(selection.kind === "room" ? [host.key, ...rooms] : rooms);
  const areas = plan.areas.filter(item => item.key !== host.key && (item.insideRoom ? roomKeys.has(item.insideRoom) : false)).map(item => item.key);
  const riding = plan.rooms.filter(room => roomKeys.has(room.key));
  const others = plan.rooms.filter(room => !roomKeys.has(room.key));
  const otherAreas = plan.areas.filter(item => !item.insideRoom && item.key !== host.key);
  // A device rides when it sits on a riding room, or loose in this area outside any other room or area.
  const devices = plan.devices.filter(item => riding.some(room => contains(room.rect, item.position))
    || (selection.kind === "area" && contains(host.rect, item.position) && !others.some(room => contains(room.rect, item.position)) && !otherAreas.some(other => contains(other.rect, item.position) && area(other.rect) < area(host.rect))))
    .map(item => item.meterId);
  return { rooms: new Set(rooms), areas: new Set(areas), devices: new Set(devices) };
}

/** Moves the selection (and anything inside it) by dx, dy without leaving the plan. */
export function moveSelection(plan: FloorPlan, selection: Selection, dx: number, dy: number, riders = passengers(plan, selection)): FloorPlan {
  const [vx, vy, vw, vh] = plan.viewBox;
  const within = (rect: Rect) => { const nx = Math.min(Math.max(dx, vx - rect[0]), vx + vw - rect[0] - rect[2]); const ny = Math.min(Math.max(dy, vy - rect[1]), vy + vh - rect[1] - rect[3]); return [nx, ny] as Point; };
  const shift = (rect: Rect, [mx, my]: Point): Rect => [rect[0] + mx, rect[1] + my, rect[2], rect[3]];
  if (selection.kind === "device") return { ...plan, devices: plan.devices.map(item => item.meterId === selection.key ? { ...item, position: clampPoint([item.position[0] + dx, item.position[1] + dy], plan.viewBox) } : item) };
  if (selection.kind === "entrance") return plan.entrance ? { ...plan, entrance: { ...plan.entrance, position: clampPoint([plan.entrance.position[0] + dx, plan.entrance.position[1] + dy], plan.viewBox) } } : plan;
  const host = selection.kind === "area" ? plan.areas.find(item => item.key === selection.key) : plan.rooms.find(item => item.key === selection.key);
  if (!host) return plan;
  const delta = within(host.rect);
  return {
    ...plan,
    areas: plan.areas.map(item => item.key === host.key && selection.kind === "area" || riders.areas.has(item.key) ? { ...item, rect: clampRect(shift(item.rect, delta), plan.viewBox) } : item),
    rooms: plan.rooms.map(item => item.key === host.key && selection.kind === "room" || riders.rooms.has(item.key) ? { ...item, rect: clampRect(shift(item.rect, delta), plan.viewBox) } : item),
    devices: plan.devices.map(item => riders.devices.has(item.meterId) ? { ...item, position: clampPoint([item.position[0] + delta[0], item.position[1] + delta[1]], plan.viewBox) } : item),
  };
}

const words = (text: string) => ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
/** The room a device's name points to, e.g. "Director Room Power" → "Director room"; the longest match wins. */
export function roomFor(name: string, rooms: PlanRoom[]): PlanRoom | undefined {
  const device = words(name);
  return rooms.filter(room => words(room.name).trim().length >= 3 && device.includes(words(room.name))).sort((a, b) => b.name.length - a.name.length)[0];
}
/** Evenly spaced points in rows, centred across a box; packs more per row when the rows would not fit. */
function spread([x, , w]: Rect, count: number, top: number, bottom: number, spacing: number, rowGap: number): Point[] {
  let columns = Math.max(1, Math.min(count, Math.floor((w - 16) / spacing)));
  const maxRows = Math.max(1, Math.floor(Math.max(0, bottom - top) / rowGap) + 1);
  if (Math.ceil(count / columns) > maxRows) columns = Math.min(count, Math.ceil(count / maxRows));
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / columns), inRow = Math.min(columns, count - row * columns), column = index % columns;
    const gap = Math.min(spacing, (w - 16) / inRow);
    return [x + w / 2 + (column - (inRow - 1) / 2) * gap, top + row * rowGap] as Point;
  });
}

/**
 * Places every device not yet on the plan: inside the room its name mentions, inside its board's equipment group,
 * or in the free space of its board's area.
 */
export function autoPlace(plan: FloorPlan, meters: Array<{ id: string; name: string; board: string }>): FloorPlan {
  const placed = new Set(plan.devices.map(item => item.meterId));
  const own = plan.areas.filter(item => !item.insideRoom);
  const targets = new Map<string, { rect: Rect; kind: "room" | "group" | "area"; ids: string[] }>();
  for (const meter of meters.filter(item => !placed.has(item.id))) {
    const group = plan.areas.find(item => item.insideRoom && item.board === meter.board);
    const boardAreas = own.filter(item => item.board === meter.board);
    const room = roomFor(meter.name, plan.rooms.filter(item => boardAreas.some(host => contains(host.rect, centre(item.rect))))) ?? (boardAreas.length ? undefined : roomFor(meter.name, plan.rooms));
    const target = group ? { key: `group:${group.key}`, rect: group.rect, kind: "group" as const } : room ? { key: `room:${room.key}`, rect: room.rect, kind: "room" as const } : boardAreas[0] ? { key: `area:${boardAreas[0].key}`, rect: boardAreas[0].rect, kind: "area" as const } : null;
    if (!target) continue;
    const entry = targets.get(target.key) ?? { rect: target.rect, kind: target.kind, ids: [] };
    entry.ids.push(meter.id); targets.set(target.key, entry);
  }
  const unit = plan.viewBox[2] / 100, rowGap = unit * 3.4, spacing = unit * 9;
  const added: PlanDevice[] = [];
  for (const [key, { rect, kind, ids }] of targets) {
    const [, y, , h] = rect;
    let top = y + h / 2, bottom = top;
    if (kind === "group") top = bottom = y + Math.max(h * 0.55, unit * 2.8);
    if (kind === "room") {
      // Below the room name, and above any equipment group drawn inside the room.
      const group = plan.areas.find(item => item.insideRoom === key.slice(5));
      top = y + unit * 4.2; bottom = Math.max(top, (group ? group.rect[1] - unit * 2.2 : y + h - unit * 2.6));
    }
    if (kind === "area") {
      const rooms = plan.rooms.filter(item => contains(rect, centre(item.rect)));
      const free = Math.max(y + unit * 6, ...rooms.map(item => item.rect[1] + item.rect[3] + unit * 3));
      top = free + unit * 2 <= y + h ? free : y + h - unit * 2.6; bottom = y + h - unit * 2.6;
    }
    spread(rect, ids.length, top, bottom, kind === "area" ? spacing * 1.25 : spacing, rowGap).forEach((position, index) => added.push({ meterId: ids[index]!, position: clampPoint(position.map(Math.round) as Point, plan.viewBox) }));
  }
  return added.length ? { ...plan, devices: [...plan.devices, ...added] } : plan;
}

/** Largest plan the editor offers, in plan units (the stored format accepts up to 10,000). */
export const MAX_PLAN_SIZE = 5000;
/** The smallest width and height that still hold everything drawn (with room for labels), from the plan's top-left. */
export function contentExtent(plan: FloorPlan): Point {
  const [vx, vy, vw] = plan.viewBox, unit = vw / 100, margin = 20;
  const boxes: Rect[] = [...plan.areas.map(item => item.rect), ...plan.rooms.map(item => item.rect), ...plan.devices.map(item => deviceRect(item) ?? [item.position[0] - unit * 5, item.position[1], unit * 10, unit * 3] as Rect)];
  // The entrance label sits under its arrow.
  if (plan.entrance) boxes.push([plan.entrance.position[0] - unit * 8, plan.entrance.position[1], unit * 16, unit * 6]);
  return [Math.max(MIN_SIZE * 10, ...boxes.map(([x, , w]) => x + w - vx + margin)), Math.max(MIN_SIZE * 8, ...boxes.map(([, y, , h]) => y + h - vy + margin))];
}
/** Makes the drawing area bigger or smaller, never cutting off anything already drawn. */
export function resizeCanvas(plan: FloorPlan, width: number, height: number): FloorPlan {
  const [minWidth, minHeight] = contentExtent(plan);
  const [vx, vy] = plan.viewBox;
  const fit = (value: number, minimum: number) => Math.round(Math.min(MAX_PLAN_SIZE, Math.max(minimum, value)));
  return { ...plan, viewBox: [vx, vy, fit(width, minWidth), fit(height, minHeight)] };
}

export function removeSelection(plan: FloorPlan, selection: Selection): FloorPlan {
  if (selection.kind === "device") return { ...plan, devices: plan.devices.filter(item => item.meterId !== selection.key) };
  if (selection.kind === "entrance") return { ...plan, entrance: null };
  if (selection.kind === "room") return { ...plan, rooms: plan.rooms.filter(item => item.key !== selection.key), areas: plan.areas.map(item => item.insideRoom === selection.key ? { key: item.key, label: item.label, board: item.board, rect: item.rect, ...colourOf(item) } : item) };
  return settleRooms({ ...plan, areas: plan.areas.filter(item => item.key !== selection.key) });
}

const rounded = (rect: Rect): Rect => rect.map(Math.round) as Rect;

/** Checks the plan in plain words and turns it into the stored block. */
export function referenceFromPlan(plan: FloorPlan, projectId: string, previous: StoredSpatialReference | null, locale: EnergyIqLocale = "en"): StoredSpatialReference {
  const t = translatorFor(floorPlanMessages, locale);
  const own = plan.areas.filter(item => !item.insideRoom);
  if (!own.length) throw new Error(t("check.noArea"));
  if (!plan.rooms.length) throw new Error(t("check.noRoom"));
  const labels = plan.areas.map(item => item.label.trim());
  if (labels.some(label => !label)) throw new Error(t("check.areaLabel"));
  const duplicateLabel = labels.find((label, index) => labels.indexOf(label) !== index);
  if (duplicateLabel) throw new Error(t("check.duplicateLabel", { label: duplicateLabel }));
  if (plan.areas.some(item => !item.board.trim())) throw new Error(t("check.areaBoard"));
  const names = plan.rooms.map(room => room.name.trim());
  if (names.some(name => !name)) throw new Error(t("check.roomName"));
  const duplicateName = names.find((name, index) => names.indexOf(name) !== index);
  if (duplicateName) throw new Error(t("check.duplicateRoom", { name: duplicateName }));
  const roomName = new Map(plan.rooms.map(room => [room.key, room.name.trim()]));
  // Only colours for boards still on the plan are kept.
  const boards = new Set(plan.areas.map(item => item.board.trim()));
  const boardColours = plan.colours ? Object.fromEntries(Object.entries(plan.colours).filter(([board]) => boards.has(board))) : undefined;
  const rooms = plan.rooms.map(room => {
    const host = roomOwner(plan, room);
    if (!host) throw new Error(t("check.outside", { name: room.name.trim() }));
    return { name: room.name.trim(), zone: host.label.trim(), rect: rounded(room.rect), ...colourOf(room) };
  });
  const zones = plan.areas.map(item => item.insideRoom && roomName.has(item.insideRoom)
    ? { id: item.label.trim(), referenceBoard: item.board.trim(), rect: rounded(item.rect), independentSpace: false, physicalParentRoom: roomName.get(item.insideRoom)!, ...(item.equipment?.trim() ? { equipment: item.equipment.trim() } : {}), ...colourOf(item) }
    : { id: item.label.trim(), referenceBoard: item.board.trim(), rect: rounded(item.rect), ...colourOf(item) });
  const reference: StoredSpatialReference = {
    ...(previous ?? {}),
    schemaVersion: 1,
    projectId,
    provenance: { file: previous?.provenance.file ?? "Drawn in EnergyX", status: "Edited in Facility → Floor layout" },
    layout: {
      viewBox: rounded(plan.viewBox),
      zones,
      rooms,
      ...(plan.entrance ? { entrance: { label: plan.entrance.label.trim() || t("name.entrance"), position: plan.entrance.position.map(Math.round) as Point } } : {}),
      devices: plan.devices.map(item => ({ meterId: item.meterId, position: item.position.map(Math.round) as Point, ...(item.size ? { size: item.size.map(Math.round) as Point } : {}), ...colourOf(item) })),
      ...(boardColours && Object.keys(boardColours).length ? { boardColours } : {}),
    },
  };
  if (!readProjectSpatialReference(notesWithReference("", null, reference), projectId)) throw new Error(t("check.insidePlan"));
  return reference;
}

/** Replaces the existing layout block in the notes, or adds one at the end. */
export function notesWithReference(notes: string, block: string | null, reference: StoredSpatialReference): string {
  const next = "```json\n" + JSON.stringify(reference, null, 2) + "\n```";
  if (block && notes.includes(block)) return notes.replace(block, () => next);
  return `${notes.trimEnd()}${notes.trim() ? "\n\n" : ""}## Floor layout\n\n${next}\n`;
}
