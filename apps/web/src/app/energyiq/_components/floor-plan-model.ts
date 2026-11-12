import { readProjectSpatialReference, spatialLevels, spatialRotation, spatialTextUnit, type ProjectSpatialReference } from "@datafoundry/contracts";
import { translatorFor, type EnergyIqLocale } from "./energyiq-messages";
import { floorPlanMessages } from "./floor-plan-messages";
import { entranceMarked, entranceParts, entranceSymbol, firstEntrance, readLabels, readSymbols, shiftLabel, shiftSymbol, keepBoxInside, withPlaced, writeLabel, writeSymbol, type EntranceMarkParts, type MarkSkip } from "./floor-plan-mark-data";
import { boxFrame, frameBounds, labelBounds, MARK_LIMIT, symbolBounds, symbolFrame, TEXT_MAX as MARK_TEXT_MAX, unionBox, type PlanLabel, type PlanSymbol } from "./floor-plan-marks";
import { readLines, writeLines, lineBox, MAX_LINES, moveLine, shiftLines, type PlanLine } from "./floor-plan-lines";
import { markDoorRooms, MAX_OPENINGS, readOpenings, removeOpening, slideOpening, writeOpenings, type PlanOpening } from "./floor-plan-openings";
import { holds, insideBox, middleOf, outlineFromSaved, savedShape } from "./floor-plan-polygon";
import { MAX_SHAPES, shapesFromLayout, shapesForLayout, type PlanShape } from "./floor-plan-plain-shapes";
import { planUnit } from "./floor-plan-unit";
import { boardFilledIn, carriedOf, DEVICE_KEYS, ENTRANCE_KEYS, GROUP_KEYS, isRecord, LAYOUT_KEYS, ROLE_KEYS, ROOM_KEYS, sameNames, samePoint, sameRect, STANDALONE_ZONE_KEYS, withCarried, withoutCarried, withoutFilledBoard, ZONE_KEYS, type AreaBaseline, type Carried, type Json } from "./floor-plan-carry";

/** [x, y, width, height] in plan units. */
export type Rect = [number, number, number, number];
export type Point = [number, number];
/**
 * An area on the drawing. `board` is the electrical panel that supplies it, or "" when none is named: the plan is a
 * drawing only, so a panel is optional. `insideRoom` makes it an equipment group drawn inside that room.
 * `meterLocations` is carried over from the saved layout unchanged, so editing the drawing never loses it. `extra` and
 * `order` carry what the editor does not draw (see floor-plan-carry); `saved` is where it was when the layout opened.
 * `boardFilled` marks a saved zone that named no panel at all, so it is written back without one while it still has none.
 */
/** `outline` draws a stand-alone area as a free shape (an L-shaped block): its corners as fractions of `rect` (see floor-plan-polygon). */
export type PlanArea = { key: string; label: string; board: string; rect: Rect; outline?: Point[]; insideRoom?: string; equipment?: string; colour?: string; meterLocations?: string[]; saved?: AreaBaseline; boardFilled?: true; locked?: true; level?: string } & Carried;
/**
 * `area` is the key of the area the room belongs to; it moves only with that area, even where areas overlap. `zone`
 * is kept only for a room filed under an area that is not on the drawing: it stays filed there while it stays where it
 * was when the layout opened (`zoneRect`), or while no drawn area holds it. Once moved into a drawn area, it belongs there.
 * `id` is the room's stable id, so later things (such as doors) can point at a room even after it is renamed. Only new
 * and copied rooms get one; a room saved without one keeps working by its name.
 */
export type PlanRoom = { key: string; name: string; rect: Rect; outline?: Point[]; area?: string; colour?: string; zone?: string; zoneRect?: Rect; id?: string; locked?: true; autoDoor?: false; autoDoorOffByDoor?: true; level?: string; displayName?: string } & Carried;
/**
 * A device on the plan: a dot at `position`, or, with `size`, a named box centred there (e.g. a bank of LED screens).
 * `rotation` turns a box (degrees, clockwise, around its middle); a dot is never drawn turned.
 */
export type PlanDevice = { meterId: string; position: Point; size?: Point; rotation?: number; colour?: string; locked?: true; level?: string } & Carried;
/** The first entrance (see floor-plan-mark-data): what `layout.entrance` holds, plus what its landmark entry holds. */
export type PlanEntrance = { label: string; position: Point; level?: string } & Carried & EntranceMarkParts;
export type { PlanLabel, PlanSymbol };
/**
 * A floor of the site (see floor-plan-levels). An item's `level` names its floor; missing means the first floor. A room's
 * `displayName` is the short name shown when its stored name had to be made unique across floors ("Store (2)").
 */
export type PlanLevel = { id: string; name: string } & Carried;
/**
 * What the other floors use, for a plan that shows one floor only: names, labels and keys a new item may not take, and
 * how many items they hold (the stored format's limits count the whole site). `drawingIds` are the keys and saved ids of
 * the other floors' doors, lines, shapes, labels and landmarks, which a new one never takes (readers keep only the first
 * of an id). `entrance` says the site's main entrance is on another floor, so this floor has none of its own to fill;
 * `entrances` are the names of the other floors' entrances, so a new one is not named like one of them.
 */
export type Elsewhere = { keys: string[]; labels: string[]; names: string[]; ids: string[]; areas: number; rooms: number;
  drawingIds?: string[]; lines?: number; openings?: number; shapes?: number; labelCount?: number; symbols?: number; entrance?: true; entrances?: string[] };
/**
 * An area the layout holds without a place on the drawing, kept as saved, at its place in the saved list. `rooms` is the
 * names of the rooms filed under it when the layout opened, kept when it has its own room list (see referenceFromPlan).
 */
export type HiddenZone = { index: number; zone: Json; rooms?: string[] };
/**
 * Layout-level things carried through a save: the saved key order, areas not on the drawing, where the entrance was
 * when the layout opened (for directions from it), and whether the layout had no device list. What the layout holds but
 * the editor cannot draw is kept as saved too: an entrance with no usable position (`rawEntrance`), device entries with
 * no meter or position (`devices`, at their place in the list) and a device list that is not a list (`rawDevices`), and
 * door and line entries the editor cannot read (`openings`, `lines`: written back after its own).
 */
/**
 * Text labels and landmarks are kept the same way: entries that cannot be drawn (`labels`, `symbols`, at their place in
 * the list), a value that is not a list (`rawLabels`, `rawSymbols`), and whether the layout had a list at all
 * (`labelList`, `symbolList`), so one is written back exactly when there was one or the plan now has something in it.
 */
/** `shapes` are saved plain shapes the editor cannot draw (kept in their place), `shapeList` that the layout had a list of shapes. */
export type CarriedLayout = { shapes?: Array<{ index: number; shape: unknown }>; shapeList?: true; order?: string[]; zones?: HiddenZone[]; entrance?: Point | null; noDevices?: true; rawEntrance?: { value: unknown }; devices?: Array<{ index: number; device: unknown }>; rawDevices?: { value: unknown }; labels?: MarkSkip[]; symbols?: MarkSkip[]; rawLabels?: { value: unknown }; rawSymbols?: { value: unknown }; labelList?: true; symbolList?: true; openings?: unknown[]; lines?: unknown[] };
/** `colours` holds a colour chosen for a board (board name → #rrggbb); boards without one use the automatic order. */
/**
 * `editor` is the saved `layout.editor` block (grid and snap choices, see floor-plan-snap), kept as saved: only the editor
 * reads it, and the map, reports and the advisor ignore it.
 */
/**
 * `labels` and `symbols` (landmarks other than the first entrance) are drawing only; missing means none.
 * `openings` are doors and windows in room walls (floor-plan-openings), `lines` the walls and fences drawn (floor-plan-lines).
 * `shapes` are plain shapes (a lawn, a driveway): a drawing only, see floor-plan-plain-shapes.
 * `levels` are the site's floors (none: one floor, as before floors existed); `layers` is the saved `layout.layers` block
 * (what the shared map hides), kept as saved and checked where it is read (floor-plan-layers). `elsewhere` is only on a
 * plan that shows one floor of several (floor-plan-levels), never on a whole plan.
 */
export type FloorPlan = { viewBox: Rect; areas: PlanArea[]; rooms: PlanRoom[]; devices: PlanDevice[]; entrance: PlanEntrance | null; shapes?: PlanShape[]; labels?: PlanLabel[]; symbols?: PlanSymbol[]; colours?: Record<string, string>; style?: PlanStyle; editor?: Json; extra?: Json; carried?: CarriedLayout; openings?: PlanOpening[]; lines?: PlanLine[]; levels?: PlanLevel[]; layers?: Json; elsewhere?: Elsewhere };
/**
 * How the plan is drawn for everyone at the site: an architect's building drawing (the default), a blueprint, or soft
 * colour blocks. Only the look changes; nothing the plan shows or selects does.
 */
export const PLAN_STYLES = ["drawing", "blueprint", "blocks"] as const;
export type PlanStyle = typeof PLAN_STYLES[number];
export const planStyleOf = (layout: { style?: unknown } | undefined): PlanStyle => (PLAN_STYLES as readonly unknown[]).includes(layout?.style) ? layout!.style as PlanStyle : "drawing";
export type Selection = { kind: "area" | "room" | "device" | "entrance" | "label" | "symbol" | "opening" | "line" | "shape"; key: string };

/** The stored block: the shared contract plus the optional extras the Floor plan adds or keeps. */
export type StoredSpatialReference = ProjectSpatialReference & {
  property?: Record<string, unknown>;
  layout: ProjectSpatialReference["layout"] & { entrance?: { label?: string; position?: Point; referenceBoard?: string }; devices?: Array<{ meterId: string; position: Point; size?: Point }>; boardColours?: Record<string, string>; style?: PlanStyle; boardMarkers?: Record<string, unknown>; editor?: Record<string, unknown> };
};

export const MIN_SIZE = 20;
/** Most areas (including those not on the drawing) and rooms a saved layout can hold (the stored format's limits). */
export const MAX_AREAS = 100, MAX_ROOMS = 200;
export const DEFAULT_VIEWBOX: Rect = [0, 0, 1000, 640];
/** A colour chosen for one item (#rrggbb); items without one use their panel's colour. */
const colourOf = (item: unknown) => { const value = (item as { colour?: unknown } | null)?.colour; return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? { colour: value } : {}; };
/** Where the meters of a zone are filed, kept as saved (only a valid, non-empty list). */
const locationsOf = (zone: { meterLocations?: unknown }) => Array.isArray(zone.meterLocations) && zone.meterLocations.length > 0 && zone.meterLocations.every(item => typeof item === "string" && item.length > 0) ? { meterLocations: [...zone.meterLocations as string[]] } : {};
/**
 * The same area drawn on its own rather than inside a room; its colour and meter locations stay. What described it as
 * equipment (its kind, a position worked out from its room) no longer holds and is dropped.
 */
export const asOwnArea = (item: PlanArea): PlanArea => { const own = withoutCarried({ ...item }, ROLE_KEYS); delete own.insideRoom; delete own.equipment; if (own.saved?.derived) { const { derived: _derived, ...saved } = own.saved; own.saved = saved; } return own; };
/** The same area drawn as equipment inside a room, along its bottom; what described it as a stand-alone area is dropped. */
export function asGroupIn(item: PlanArea, room: PlanRoom): PlanArea {
  const [rx, ry, rw, rh] = room.rect, height = Math.min(60, rh * 0.4);
  const { outline: _outline, ...rest } = withoutCarried(item, [...ROLE_KEYS, ...GROUP_KEYS]);
  return { ...rest, insideRoom: room.key, rect: [rx + 12, ry + rh - height - 12, Math.max(20, rw - 24), height] };
}
/** `locked: true` keeps an item where it is (it cannot be dragged, resized, nudged or deleted until unlocked). */
const lockedOf = (item: unknown) => (item as { locked?: unknown } | null)?.locked === true ? { locked: true as const } : {};
/** A room id the editor wrote (or could have): short letters, digits, - and _. Anything else rides along as saved. */
export const ROOM_ID = /^[A-Za-z0-9_-]{1,64}$/;
const roomIdOf = (room: unknown): { id?: string } => { const value = (room as { id?: unknown } | null)?.id; return typeof value === "string" && ROOM_ID.test(value) ? { id: value } : {}; };
/**
 * The keys the editor owns on an item: its usual ones, plus `locked` when it holds a value the editor understands, and
 * for a room `id` when `roomId` holds it (a well-formed id no earlier room uses).
 */
const owned = (raw: unknown, keys: readonly string[], roomId: { id?: string } = {}, floors: Set<string> = NO_FLOORS, outline: { outline?: Point[] } = {}) => [...keys, ...("id" in roomId ? ["id"] : []), ...("locked" in lockedOf(raw) ? ["locked"] : []), ...("autoDoor" in autoDoorOf(raw) ? ["autoDoor"] : []), ...("outline" in outline ? ["points"] : []), ...("level" in levelOf(raw, floors) ? ["level"] : []), ...("displayName" in displayNameOf(raw) && keys === ROOM_KEYS ? ["displayName"] : [])];
/** A free shape read from saved `points` (only usable ones: malformed points ride along as saved and the item stays a box). */
const outlineOf = (item: unknown, rect: Rect): { outline?: Point[] } => { const outline = outlineFromSaved((item as { points?: unknown } | null)?.points, rect); return outline ? { outline } : {}; };
/** `autoDoor: false` leaves out the door the map draws for a room by itself (a room with doors of its own has it off). */
const autoDoorOf = (item: unknown) => (item as { autoDoor?: unknown } | null)?.autoDoor === false ? { autoDoor: false as const } : {};
/**
 * A device box's turn, read as the map reads it (spatialRotation: any finite number, in whole degrees 0-359), so the
 * editor draws, hits and keeps inside exactly the box the map draws. Owned (and written back in whole degrees) while it
 * turns the box; anything else rides along as saved.
 */
const rotationOf = (item: unknown): { rotation?: number } => { const value = spatialRotation((item as { rotation?: unknown } | null)?.rotation); return value ? { rotation: value } : {}; };
const NO_FLOORS = new Set<string>();
/** The floor an item names, when the layout has that floor; anything else rides along as saved (and reads as the first floor). */
const levelOf = (item: unknown, floors: Set<string>): { level?: string } => { const value = (item as { level?: unknown } | null)?.level; return typeof value === "string" && floors.has(value) ? { level: value } : {}; };
/** A room's short name shown in place of its stored one, when it is usable text. */
const displayNameOf = (room: unknown): { displayName?: string } => { const value = (room as { displayName?: unknown } | null)?.displayName; return typeof value === "string" && value.trim().length > 0 && value.length <= 120 ? { displayName: value } : {}; };
/**
 * Text labels, landmarks, lines and plain shapes keep everything their own readers do not own as carried keys; a `level`
 * naming one of the layout's floors is lifted out of those into the item's own `level` (and put back on save by
 * floorLowered), so they follow floors like areas and rooms. Any other `level` rides along as saved.
 */
export function liftLevel<T extends Carried & { level?: string }>(item: T, floors: Set<string>): T {
  const value = item.extra?.level;
  return typeof value === "string" && floors.has(value) ? { ...withoutCarried(item, ["level"]), level: value } : item;
}
const floorLifted = <T extends Carried & { level?: string }, L extends { items: Array<{ index: number; item: T }> }>(list: L, floors: Set<string>): L => floors.size ? { ...list, items: list.items.map(({ index, item }) => ({ index, item: liftLevel(item, floors) })) } : list;
/** A room's name as shown: its short name when its stored one had to be made unique across floors. */
export const roomTitle = (room: { name: string; displayName?: string }) => room.displayName ?? room.name;
/** Whether two items are on the same floor (an item that names none is on the first). */
export const sameLevel = (plan: Pick<FloorPlan, "levels">, a: { level?: string }, b: { level?: string }) => !plan.levels?.length || (a.level ?? plan.levels[0]!.id) === (b.level ?? plan.levels[0]!.id);
export const isPoint = (value: unknown): value is Point => Array.isArray(value) && value.length === 2 && value.every(n => typeof n === "number" && Number.isFinite(n));
export const isRect = (value: unknown): value is Rect => Array.isArray(value) && value.length === 4 && value.every(n => typeof n === "number" && Number.isFinite(n));

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
/** A resize grip: a corner, or the middle of an edge (n, e, s, w), which moves that edge only. */
export type Handle = "nw" | "ne" | "sw" | "se" | "n" | "e" | "s" | "w";
/** Drags one corner (the opposite corner stays put) or one edge (the opposite edge stays put). */
export function resizeRect([x, y, w, h]: Rect, handle: Handle, dx: number, dy: number, viewBox: Rect): Rect {
  let left = x, top = y, right = x + w, bottom = y + h;
  if (handle.includes("w")) left = Math.min(left + dx, right - MIN_SIZE); else if (handle.includes("e")) right = Math.max(right + dx, left + MIN_SIZE);
  if (handle.includes("n")) top = Math.min(top + dy, bottom - MIN_SIZE); else if (handle.includes("s")) bottom = Math.max(bottom + dy, top + MIN_SIZE);
  const [vx, vy, vw, vh] = viewBox;
  left = Math.max(vx, left); top = Math.max(vy, top); right = Math.min(vx + vw, right); bottom = Math.min(vy + vh, bottom);
  return [left, top, right - left, bottom - top];
}

/**
 * Where an equipment group sits when the stored layout only names its room (same geometry as the read-only map, at the
 * text size the map draws that room's floor with: see planUnit).
 */
function groupRect(room: Rect, unit: number): Rect {
  const [rx, ry, rw, rh] = room, pad = unit * 1.2, height = Math.min(rh * 0.34, unit * 7);
  return [rx + pad, ry + rh - height - pad, rw - pad * 2, height];
}

/**
 * Reads the stored layout into a plan. Areas that cannot be drawn (no rectangle, or equipment whose room is missing)
 * are kept aside exactly as saved, and everything the editor does not draw rides along on the item it belongs to.
 */
export function planFromReference(reference: StoredSpatialReference, locale: EnergyIqLocale = "en"): FloorPlan {
  const { layout } = reference;
  // Floors: a well-formed list is the editor's own; anything else rides along untouched and the plan is one floor.
  const floorList = spatialLevels(layout) ? (layout as unknown as { levels: unknown[] }).levels : null;
  const levels = floorList?.map((item): PlanLevel => ({ id: (item as { id: string }).id, name: (item as { name: string }).name, ...carriedOf(item, ["id", "name"]) }));
  const floors = new Set(levels?.map(item => item.id) ?? []);
  const roomByName = new Map(layout.rooms.map((room, index) => [room.name, `room-${index + 1}`]));
  const drawable = (zone: StoredSpatialReference["layout"]["zones"][number]) => zone.independentSpace === false ? roomByName.has(zone.physicalParentRoom ?? "") : !!zone.rect;
  // Room names as they are written on save (trimmed), so a room list compares equal when nothing changed.
  const filedUnder = (id: string) => layout.rooms.filter(room => room.zone === id).map(room => room.name.trim());
  const hidden: HiddenZone[] = layout.zones.flatMap((zone, index) => drawable(zone) ? [] : [{ index, zone: withoutFilledBoard(zone as unknown as Json), ...("rooms" in zone ? { rooms: filedUnder(zone.id) } : {}) }]);
  const hiddenIds = new Set(hidden.map(item => item.zone.id));
  const ownZones = new Set(layout.zones.filter(zone => zone.independentSpace !== false && zone.rect).map(zone => zone.id));
  // A room id is the room's own only the first time it appears: a repeat (written by hand or by the advisor) stays in the
  // saved data as it was, so it is saved back unchanged but never taken as that room's identity.
  const seenIds = new Set<string>();
  const rooms = layout.rooms.map((room, index): PlanRoom => {
    const found = roomIdOf(room), id = found.id !== undefined && !seenIds.has(found.id) ? found : {};
    if (id.id !== undefined) seenIds.add(id.id);
    const shape = outlineOf(room, room.rect as Rect);
    return { key: `room-${index + 1}`, name: room.name, rect: [...room.rect] as Rect, ...shape, ...(ownZones.has(room.zone) ? { area: room.zone } : {}), ...colourOf(room), ...(hiddenIds.has(room.zone) ? { zone: room.zone, zoneRect: [...room.rect] as Rect } : {}), ...id, ...lockedOf(room), ...autoDoorOf(room), ...levelOf(room, floors), ...displayNameOf(room), ...carriedOf(room, owned(room, ROOM_KEYS, id, floors, shape)) };
  });
  // Where each area stood, kept only when something depends on it staying put (board markers, its room list, its direction).
  const markers = isRecord(layout.boardMarkers);
  const baseline = (zone: object, rect: Rect, derived: boolean): { saved?: AreaBaseline } => markers || derived || "rooms" in zone || "directionFromEntrance" in zone
    ? { saved: { rect: [...rect] as Rect, rooms: filedUnder((zone as { id: string }).id), ...(derived ? { derived: true as const } : {}) } } : {};
  // The map draws each floor of a site with floors on its own, its text sized from that floor's rooms and areas (see planUnit).
  const floorOf = (item: { level?: string }) => item.level ?? levels?.[0]?.id;
  const floorUnit = (room: PlanRoom) => {
    const split = (levels?.length ?? 0) > 1, here = (item: { level?: string }) => !split || floorOf(item) === floorOf(room);
    return spatialTextUnit(layout.viewBox, rooms.filter(here).map(item => item.rect), layout.zones.filter(zone => zone.rect && zone.independentSpace !== false && here(levelOf(zone, floors))).map(zone => zone.rect));
  };
  const areas = layout.zones.flatMap((zone): PlanArea[] => {
    if (!drawable(zone)) return [];
    // A zone that named no panel is read as if it had none at all, so its saved keys and their order stay as they were.
    const raw = withoutFilledBoard(zone as unknown as Json), common = { key: zone.id, label: zone.id, board: zone.referenceBoard ?? "", ...(boardFilledIn(zone) ? { boardFilled: true as const } : {}) };
    if (zone.independentSpace === false) {
      const room = rooms.find(item => item.name === zone.physicalParentRoom)!;
      const rect = zone.rect ? [...zone.rect] as Rect : groupRect(room.rect, floorUnit(room));
      // Equipment is on its room's floor, whatever its own entry says.
      return [{ ...common, rect, insideRoom: room.key, ...(zone.equipment ? { equipment: zone.equipment } : {}), ...colourOf(zone), ...locationsOf(zone), ...lockedOf(zone), ...(room.level ? { level: room.level } : {}), ...carriedOf(raw, owned(raw, ZONE_KEYS, {}, floors)), ...baseline(zone, rect, !zone.rect) }];
    }
    // A stand-alone area keeps what it says about equipment (independentSpace, a room, what it supplies) as saved.
    const shape = outlineOf(zone, zone.rect as Rect);
    return [{ ...common, rect: [...zone.rect!] as Rect, ...shape, ...colourOf(zone), ...locationsOf(zone), ...lockedOf(zone), ...levelOf(zone, floors), ...carriedOf(raw, owned(raw, STANDALONE_ZONE_KEYS, {}, floors, shape)), ...baseline(zone, zone.rect!, false) }];
  });
  // Devices and the entrance are not checked by the stored format: entries the plan cannot draw are kept aside as saved.
  const rawDevices: unknown = (layout as { devices?: unknown }).devices, skipped: Array<{ index: number; device: unknown }> = [];
  const devices = (Array.isArray(rawDevices) ? rawDevices as unknown[] : []).flatMap((item, index): PlanDevice[] => {
    if (!isRecord(item) || typeof item.meterId !== "string" || !isPoint(item.position)) { skipped.push({ index, device: item }); return []; }
    return [{ meterId: item.meterId, position: clampPoint(item.position, layout.viewBox), ...(isSize(item.size) ? { size: [...item.size] as Point } : {}), ...rotationOf(item), ...colourOf(item), ...lockedOf(item), ...levelOf(item, floors), ...carriedOf(item, [...owned(item, DEVICE_KEYS, {}, floors), ...("rotation" in rotationOf(item) ? ["rotation"] : [])]) }];
  });
  const rawEntrance: unknown = (layout as { entrance?: unknown }).entrance;
  const legacyName = isRecord(rawEntrance) && typeof rawEntrance.label === "string" && rawEntrance.label.trim() ? rawEntrance.label.trim().slice(0, MARK_TEXT_MAX) : undefined;
  const legacy = isRecord(rawEntrance) && isPoint(rawEntrance.position) ? { label: typeof rawEntrance.label === "string" && rawEntrance.label ? rawEntrance.label : translatorFor(floorPlanMessages, locale)("name.entrance"), position: [...rawEntrance.position] as Point, ...levelOf(rawEntrance, floors), ...carriedOf(rawEntrance, [...ENTRANCE_KEYS, ...("level" in levelOf(rawEntrance, floors) ? ["level"] : [])]) } : null;
  // Text labels and landmarks, and lines and shapes below, name their floor in `level` like every other item (floorLifted).
  // The first entrance is the legacy one (taking the entrance symbol at its place, if any),
  // else the first entrance symbol: either way it is drawn once, and `layout.entrance` is written from it.
  const labelList = floorLifted(readLabels((layout as { labels?: unknown }).labels), floors), symbolList = floorLifted(readSymbols((layout as { symbols?: unknown }).symbols), floors);
  // On a site with floors, only an entrance landmark on the legacy entrance's floor can be that entrance.
  const firstFloor = levels?.[0]?.id, entranceFloor = legacy?.level ?? firstFloor;
  const first = firstEntrance(symbolList.items, legacy ? legacy.position : null, legacyName, symbol => (symbol.level ?? firstFloor) === entranceFloor), firstMark = symbolList.items[first];
  const entrance: PlanEntrance | null = firstMark ? { ...(legacy ?? { label: firstMark.item.label ?? "", position: [...firstMark.item.position] as Point, ...(firstMark.item.level ? { level: firstMark.item.level } : {}) }), ...entranceParts(firstMark.item, firstMark.index) } : legacy;
  const labels = labelList.items.map(({ item }) => item), symbols = symbolList.items.filter((_, index) => index !== first).map(({ item }) => item);
  const colours = Object.fromEntries(Object.entries(isRecord(layout.boardColours) ? layout.boardColours : {}).filter(([, value]) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)));
  // A well-formed editor block is the editor's own (kept as saved); anything else there rides along untouched.
  const editor = isRecord(layout.editor) ? { ...layout.editor } : undefined;
  // Doors, windows and lines are the editor's own when they are lists (only well-formed entries are read); anything else rides along.
  const rawOpenings: unknown = (layout as { openings?: unknown }).openings, rawLines: unknown = (layout as { lines?: unknown }).lines;
  const drawing = [...(Array.isArray(rawOpenings) ? ["openings"] : []), ...(Array.isArray(rawLines) ? ["lines"] : [])];
  // Plain shapes: a list of them is the editor's own; anything else saved there rides along untouched.
  const plain = shapesFromLayout((layout as { shapes?: unknown }).shapes, layout.viewBox);
  // The shared map's hidden layers: a block of its own is the editor's (kept as saved, checked where read); else it rides along.
  const layers = isRecord((layout as { layers?: unknown }).layers) ? { ...(layout as unknown as { layers: Json }).layers } : undefined;
  const { extra, order } = carriedOf(layout, [...LAYOUT_KEYS, ...(editor ? ["editor"] : []), ...drawing, ...(plain ? ["shapes"] : []), ...(levels ? ["levels"] : []), ...(layers ? ["layers"] : [])]);
  // Entries the editor cannot read ride along as saved (a save never loses them).
  const unreadOpenings: unknown[] = [], unreadLines: unknown[] = [];
  const openings = Array.isArray(rawOpenings) ? readOpenings(rawOpenings, rooms, unreadOpenings) : undefined, lines = Array.isArray(rawLines) ? readLines(rawLines, layout.viewBox, unreadLines).map(item => liftLevel(item, floors)) : undefined;
  const carried: CarriedLayout = {
    ...(order ? { order } : {}), ...(hidden.length ? { zones: hidden } : {}), ...(layout.zones.some(zone => "directionFromEntrance" in zone) ? { entrance: entrance ? [...entrance.position] as Point : null } : {}), ...(rawDevices === undefined ? { noDevices: true as const } : {}),
    ...(plain ? { shapeList: true as const, ...(plain.skipped.length ? { shapes: plain.skipped } : {}) } : {}),
    ...("entrance" in layout && !legacy ? { rawEntrance: { value: rawEntrance } } : {}), ...(skipped.length ? { devices: skipped } : {}), ...(rawDevices !== undefined && !Array.isArray(rawDevices) ? { rawDevices: { value: rawDevices } } : {}),
    ...(labelList.skipped.length ? { labels: labelList.skipped } : {}), ...(symbolList.skipped.length ? { symbols: symbolList.skipped } : {}), ...(labelList.raw ? { rawLabels: labelList.raw } : {}), ...(symbolList.raw ? { rawSymbols: symbolList.raw } : {}),
    ...(labelList.list ? { labelList: true as const } : {}), ...(symbolList.list ? { symbolList: true as const } : {}),
    ...(unreadOpenings.length ? { openings: unreadOpenings } : {}), ...(unreadLines.length ? { lines: unreadLines } : {}),
  };
  return { viewBox: [...layout.viewBox] as Rect, areas, rooms: openings ? markDoorRooms(rooms, openings) : rooms, devices, entrance, ...(plain ? { shapes: plain.shapes.map(item => liftLevel(item, floors)) } : {}), ...(labels.length ? { labels } : {}), ...(symbols.length ? { symbols } : {}), ...(Object.keys(colours).length ? { colours } : {}), ...((layout as { style?: unknown }).style !== undefined ? { style: planStyleOf(layout as { style?: unknown }) } : {}), ...(editor ? { editor } : {}), ...(extra ? { extra } : {}), ...(Object.keys(carried).length ? { carried } : {}), ...(openings ? { openings } : {}), ...(lines ? { lines } : {}), ...(levels ? { levels } : {}), ...(layers ? { layers } : {}) };
}
/** Areas the layout holds that are not on the drawing: kept as saved, listed for the reader. */
export const hiddenZones = (plan: FloorPlan): Array<{ id: string; board: string }> => (plan.carried?.zones ?? []).map(({ zone }) => ({ id: String(zone.id), board: typeof zone.referenceBoard === "string" ? zone.referenceBoard : "" }));

/** A first draft to start from: one area per board side by side, each with one room; one area with no panel when there are none. */
export function starterPlan(boards: string[], locale: EnergyIqLocale = "en"): FloorPlan {
  const t = translatorFor(floorPlanMessages, locale);
  const [vx, vy, vw] = DEFAULT_VIEWBOX, gap = 30, margin = 20, list = boards.length ? boards : [""];
  const width = Math.floor((vw - margin * 2 - gap * (list.length - 1)) / list.length);
  const areas = list.map((board, index): PlanArea => ({ key: `area-${index + 1}`, label: String.fromCharCode(65 + index), board, rect: [vx + margin + index * (width + gap), vy + margin, width, 540] }));
  const rooms = areas.map((item, index): PlanRoom => ({ key: `room-${index + 1}`, name: t("name.room", { number: index + 1 }), rect: [item.rect[0] + 20, item.rect[1] + 60, Math.max(MIN_SIZE, item.rect[2] - 40), 180], area: item.key }));
  return { viewBox: [...DEFAULT_VIEWBOX], areas, rooms, devices: [], entrance: null };
}

/** The area a room belongs to: the one it was drawn in while that still holds it, else the smallest area around it. */
export function roomOwner(plan: FloorPlan, room: PlanRoom): PlanArea | undefined {
  // A room belongs to an area on its own floor only.
  const own = plan.areas.filter(item => !item.insideRoom && sameLevel(plan, item, room));
  // A free-shape area holds a room whose middle is inside its shape (not in the notch of an L), and a free-shape room
  // is judged by a point surely inside it.
  const middle = middleOf(room), current = own.find(item => item.key === room.area);
  if (current && holds(current, middle)) return current;
  return own.filter(item => holds(item, middle)).sort((a, b) => area(a.rect) - area(b.rect))[0];
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

export const NO_PASSENGERS = () => ({ rooms: new Set<string>(), areas: new Set<string>(), devices: new Set<string>(), lines: new Set<string>() });
/**
 * Items that ride along when an area or room is moved: the area's own rooms (not rooms of another area it overlaps),
 * the equipment groups inside those rooms, the devices on them, and the walls and lines drawn fully inside it.
 */
export function passengers(plan: FloorPlan, selection: Selection): ReturnType<typeof NO_PASSENGERS> {
  const host = selection.kind === "area" ? plan.areas.find(item => item.key === selection.key) : selection.kind === "room" ? plan.rooms.find(item => item.key === selection.key) : null;
  if (!host || (selection.kind === "area" && (host as PlanArea).insideRoom)) return NO_PASSENGERS();
  const rooms = selection.kind === "area" ? plan.rooms.filter(room => roomOwner(plan, room)?.key === host.key).map(room => room.key) : [];
  const roomKeys = new Set(selection.kind === "room" ? [host.key, ...rooms] : rooms);
  const areas = plan.areas.filter(item => item.key !== host.key && (item.insideRoom ? roomKeys.has(item.insideRoom) : false)).map(item => item.key);
  const riding = plan.rooms.filter(room => roomKeys.has(room.key));
  const others = plan.rooms.filter(room => !roomKeys.has(room.key));
  const otherAreas = plan.areas.filter(item => !item.insideRoom && item.key !== host.key);
  // A device rides when it sits on a riding room, or loose in this area outside any other room or area.
  const devices = plan.devices.filter(item => riding.some(room => holds(room, item.position))
    || (selection.kind === "area" && holds(host, item.position) && !others.some(room => holds(room, item.position)) && !otherAreas.some(other => holds(other, item.position) && area(other.rect) < area(host.rect))))
    .map(item => item.meterId);
  const [hx, hy, hw, hh] = host.rect, lines = (plan.lines ?? []).filter(line => line.points.every(([x, y]) => x >= hx && x <= hx + hw && y >= hy && y <= hy + hh)).map(line => line.key);
  return { rooms: new Set(rooms), areas: new Set(areas), devices: new Set(devices), lines: new Set(lines) };
}

/** Moves the selection (and anything inside it) by dx, dy without leaving the plan. */
export function moveSelection(plan: FloorPlan, selection: Selection, dx: number, dy: number, riders = passengers(plan, selection)): FloorPlan {
  const [vx, vy, vw, vh] = plan.viewBox;
  const within = (rect: Rect) => { const nx = Math.min(Math.max(dx, vx - rect[0]), vx + vw - rect[0] - rect[2]); const ny = Math.min(Math.max(dy, vy - rect[1]), vy + vh - rect[1] - rect[3]); return [nx, ny] as Point; };
  const shift = (rect: Rect, [mx, my]: Point): Rect => [rect[0] + mx, rect[1] + my, rect[2], rect[3]];
  if (selection.kind === "device") return { ...plan, devices: plan.devices.map(item => item.meterId === selection.key ? { ...item, position: devicePosition(item, [item.position[0] + dx, item.position[1] + dy], plan.viewBox) } : item) };
  if (selection.kind === "entrance") return plan.entrance ? { ...plan, entrance: { ...plan.entrance, position: clampPoint([plan.entrance.position[0] + dx, plan.entrance.position[1] + dy], plan.viewBox) } } : plan;
  // A text label or landmark stays fully inside the plan, turned as it is.
  if (selection.kind === "label") return { ...plan, labels: (plan.labels ?? []).map(item => item.key === selection.key ? shiftLabel(item, dx, dy, plan.viewBox, planUnit(plan)) : item) };
  if (selection.kind === "symbol") return { ...plan, symbols: (plan.symbols ?? []).map(item => item.key === selection.key ? shiftSymbol(item, dx, dy, plan.viewBox, planUnit(plan)) : item) };
  // A line moves as a whole; a door or window only slides along its wall.
  if (selection.kind === "line") return moveLine(plan, selection.key, dx, dy);
  if (selection.kind === "opening") return slideOpening(plan, selection.key, dx, dy);
  if (selection.kind === "shape") return { ...plan, shapes: (plan.shapes ?? []).map(item => item.key === selection.key ? { ...item, rect: clampRect(shift(item.rect, within(item.rect)), plan.viewBox) } : item) };
  const host = selection.kind === "area" ? plan.areas.find(item => item.key === selection.key) : plan.rooms.find(item => item.key === selection.key);
  if (!host) return plan;
  const delta = within(host.rect);
  return {
    ...plan,
    ...(plan.lines && riders.lines.size ? { lines: shiftLines(plan, riders.lines, delta[0], delta[1]).lines } : {}),
    areas: plan.areas.map(item => item.key === host.key && selection.kind === "area" || riders.areas.has(item.key) ? { ...item, rect: clampRect(shift(item.rect, delta), plan.viewBox) } : item),
    rooms: plan.rooms.map(item => item.key === host.key && selection.kind === "room" || riders.rooms.has(item.key) ? { ...item, rect: clampRect(shift(item.rect, delta), plan.viewBox) } : item),
    devices: plan.devices.map(item => riders.devices.has(item.meterId) ? { ...item, position: devicePosition(item, [item.position[0] + delta[0], item.position[1] + delta[1]], plan.viewBox) } : item),
  };
}
/** Where a device goes when moved to `to`: a dot inside the plan; a turned box with all of it inside the plan. */
export const devicePosition = (device: PlanDevice, to: Point, viewBox: Rect): Point => device.size && device.rotation ? keepBoxInside(to, device.size, device.rotation, viewBox) : clampPoint(to, viewBox);

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
    const room = roomFor(meter.name, plan.rooms.filter(item => boardAreas.some(host => holds(host, middleOf(item))))) ?? (boardAreas.length ? undefined : roomFor(meter.name, plan.rooms));
    // In a free-shape room or area, devices go in its largest part, never in the notch of an L.
    const target = group ? { key: `group:${group.key}`, rect: group.rect, kind: "group" as const } : room ? { key: `room:${room.key}`, rect: insideBox(room), kind: "room" as const } : boardAreas[0] ? { key: `area:${boardAreas[0].key}`, rect: insideBox(boardAreas[0]), kind: "area" as const } : null;
    if (!target) continue;
    const entry = targets.get(target.key) ?? { rect: target.rect, kind: target.kind, ids: [] };
    entry.ids.push(meter.id); targets.set(target.key, entry);
  }
  const unit = planUnit(plan), rowGap = unit * 3.4, spacing = unit * 9;
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
      const rooms = plan.rooms.filter(item => contains(rect, middleOf(item)));
      const free = Math.max(y + unit * 6, ...rooms.map(item => item.rect[1] + item.rect[3] + unit * 3));
      top = free + unit * 2 <= y + h ? free : y + h - unit * 2.6; bottom = y + h - unit * 2.6;
    }
    spread(rect, ids.length, top, bottom, kind === "area" ? spacing * 1.25 : spacing, rowGap).forEach((position, index) => added.push({ meterId: ids[index]!, position: clampPoint(position.map(Math.round) as Point, plan.viewBox) }));
  }
  return added.length ? { ...plan, devices: [...plan.devices, ...added] } : plan;
}

/**
 * Largest coordinate the stored format accepts (project-spatial.ts checks every number is at most 10,000). The editor
 * keeps the plan's right and bottom edges at or below it, so every saved position stays valid.
 */
export const MAX_COORD = 10_000;
/** Largest plan the editor offers, in plan units: the stored format's own limit. */
export const MAX_PLAN_SIZE = MAX_COORD;
/** Smallest drawing space the editor offers. */
export const MIN_PLAN: Point = [MIN_SIZE * 10, MIN_SIZE * 8];
/** Where everything drawn sits, with room for labels: [left, top, right, bottom] in plan units, or null for an empty plan. */
export function contentBounds(plan: FloorPlan): [number, number, number, number] | null {
  const unit = planUnit(plan), margin = 20;
  // Areas not on the drawing still hold their place when they have one: the plan can never shrink below them.
  const hiddenRects = (plan.carried?.zones ?? []).map(({ zone }) => zone.rect).filter(isRect);
  const boxes: Rect[] = [...plan.areas.map(item => item.rect), ...plan.rooms.map(item => item.rect), ...(plan.shapes ?? []).map(item => item.rect), ...hiddenRects, ...plan.devices.map(item => item.size && item.rotation ? frameBounds(boxFrame(item.position, item.size, item.rotation)) : deviceRect(item) ?? [item.position[0] - unit * 5, item.position[1], unit * 10, unit * 3] as Rect)];
  // The entrance label sits under its arrow (and a turned or bigger arrow takes the space it is drawn in).
  if (plan.entrance) { const { position, size, rotation } = plan.entrance, label: Rect = [position[0] - unit * 8, position[1], unit * 16, unit * 6]; boxes.push(size !== undefined || rotation ? unionBox([label, frameBounds(symbolFrame({ kind: "entrance", position, ...(size !== undefined ? { size } : {}), ...(rotation ? { rotation } : {}) }, unit))]) : label); }
  // Text labels and landmarks, turned as they are: shrinking the plan never cuts them off.
  for (const item of plan.labels ?? []) boxes.push(labelBounds(item, unit));
  for (const item of plan.symbols ?? []) boxes.push(symbolBounds(item, unit));
  for (const line of plan.lines ?? []) boxes.push(lineBox(line));
  if (!boxes.length) return null;
  return [Math.min(...boxes.map(([x]) => x - margin)), Math.min(...boxes.map(([, y]) => y - margin)), Math.max(...boxes.map(([x, , w]) => x + w + margin)), Math.max(...boxes.map(([, y, , h]) => y + h + margin))];
}
/** The smallest width and height that still hold everything drawn (with room for labels), from the plan's top-left. */
export function contentExtent(plan: FloorPlan): Point {
  const [vx, vy] = plan.viewBox, bounds = contentBounds(plan);
  return [Math.max(MIN_PLAN[0], bounds ? bounds[2] - vx : 0), Math.max(MIN_PLAN[1], bounds ? bounds[3] - vy : 0)];
}
/** Makes the drawing area bigger or smaller from its right and bottom edges, never cutting off anything already drawn. */
export function resizeCanvas(plan: FloorPlan, width: number, height: number): FloorPlan {
  const [minWidth, minHeight] = contentExtent(plan);
  const [vx, vy] = plan.viewBox;
  const fit = (value: number, minimum: number, origin: number) => Math.round(Math.min(MAX_PLAN_SIZE, MAX_COORD - origin, Math.max(minimum, value)));
  return { ...plan, viewBox: [vx, vy, fit(width, minWidth, vx), fit(height, minHeight, vy)] };
}

/**
 * With no first entrance, the first entrance landmark becomes it (and so what `layout.entrance` is written from): after
 * the first entrance is deleted, or a landmark is changed into an entrance. The same plan when nothing changes.
 */
export function promoteEntrance(plan: FloorPlan): FloorPlan {
  // One floor of several whose site has its main entrance on another floor keeps its entrances as landmarks.
  const symbols = plan.symbols ?? [], at = hasMainEntrance(plan) ? -1 : symbols.findIndex(item => item.kind === "entrance");
  if (at < 0) return plan;
  const next = symbols[at]!, rest = symbols.filter((_, index) => index !== at);
  const { symbols: _old, ...without } = plan;
  // It stays on its floor.
  return { ...without, ...(rest.length ? { symbols: rest } : {}), entrance: { label: next.label ?? "", position: [...next.position] as Point, ...(next.level ? { level: next.level } : {}), ...entranceParts(next, at) } };
}
/** Whether the site has its main entrance: on the plan, or (for one floor of several) on another floor. */
export const hasMainEntrance = (plan: Pick<FloorPlan, "entrance" | "elsewhere">) => !!plan.entrance || !!plan.elsewhere?.entrance;
export function removeSelection(plan: FloorPlan, selection: Selection): FloorPlan {
  if (selection.kind === "device") return { ...plan, devices: plan.devices.filter(item => item.meterId !== selection.key) };
  // Deleting the first entrance makes the next entrance (if any) the first.
  if (selection.kind === "entrance") return promoteEntrance({ ...plan, entrance: null });
  if (selection.kind === "label") { const labels = (plan.labels ?? []).filter(item => item.key !== selection.key), { labels: _old, ...rest } = plan; return labels.length ? { ...rest, labels } : rest; }
  if (selection.kind === "symbol") { const symbols = (plan.symbols ?? []).filter(item => item.key !== selection.key), { symbols: _old, ...rest } = plan; return symbols.length ? { ...rest, symbols } : rest; }
  if (selection.kind === "shape") return { ...plan, shapes: (plan.shapes ?? []).filter(item => item.key !== selection.key) };
  if (selection.kind === "line") return { ...plan, lines: (plan.lines ?? []).filter(item => item.key !== selection.key) };
  if (selection.kind === "opening") return removeOpening(plan, selection.key);
  // A room's doors and windows go with it.
  if (selection.kind === "room") return { ...plan, rooms: plan.rooms.filter(item => item.key !== selection.key), areas: plan.areas.map(item => item.insideRoom === selection.key ? asOwnArea(item) : item), ...(plan.openings?.some(item => item.room === selection.key) ? { openings: plan.openings.filter(item => item.room !== selection.key) } : {}) };
  return settleRooms({ ...plan, areas: plan.areas.filter(item => item.key !== selection.key) });
}

/** Whether two plans draw everything in the same place, for changes that only move or resize (a drag that came back). */
export function sameGeometry(a: FloorPlan, b: FloorPlan): boolean {
  const shape = (plan: FloorPlan) => JSON.stringify([plan.viewBox, plan.areas.map(item => [item.key, item.rect, item.outline ?? null]), plan.rooms.map(item => [item.key, item.rect, item.outline ?? null, item.area ?? null]), (plan.shapes ?? []).map(item => [item.key, item.rect, item.outline ?? null]), plan.devices.map(item => [item.meterId, item.position, item.size ?? null, item.rotation ?? 0]), plan.entrance?.position ?? null, plan.entrance?.rotation ?? 0,
    (plan.labels ?? []).map(item => [item.key, item.position, item.rotation ?? 0]), (plan.symbols ?? []).map(item => [item.key, item.position, item.rotation ?? 0]),
    (plan.lines ?? []).map(item => [item.key, item.points]), (plan.openings ?? []).map(item => [item.key, item.offset])]);
  return a === b || shape(a) === shape(b);
}

const rounded = (rect: Rect): Rect => rect.map(Math.round) as Rect;
/** Most characters Project notes can hold (the API's limit); the floor plan is saved inside them. */
export const NOTES_LIMIT = 100_000;

/**
 * Checks the plan in plain words and turns it into the stored block. The plan is a drawing only: an area may have no
 * panel (stored as an empty `referenceBoard`), and the meter locations a zone already had are kept.
 *
 * Nothing is lost: what the editor does not draw is written back as it was, in its saved order. Keys the report reads
 * are kept only while what they describe is unchanged: a zone's room list while its rooms are the same, its direction
 * from the entrance while neither moved, a board marker while that board's areas stay put, and the entrance's board
 * while that board is still on the plan.
 */
export function referenceFromPlan(drawn: FloorPlan, projectId: string, previous: StoredSpatialReference | null, locale: EnergyIqLocale = "en"): StoredSpatialReference {
  const t = translatorFor(floorPlanMessages, locale);
  // The first entrance always drives `layout.entrance`, however the plan was left (a paste, an undo, a draft).
  const plan = promoteEntrance(drawn);
  const own = plan.areas.filter(item => !item.insideRoom);
  if (!own.length) throw new Error(t("check.noArea"));
  if (!plan.rooms.length) throw new Error(t("check.noRoom"));
  const hidden = plan.carried?.zones ?? [];
  if (plan.areas.length + hidden.length > MAX_AREAS) throw new Error(t("check.tooManyAreas", { max: MAX_AREAS }));
  if (plan.rooms.length > MAX_ROOMS) throw new Error(t("check.tooManyRooms", { max: MAX_ROOMS }));
  const hiddenIds = new Set(hidden.map(item => String(item.zone.id)));
  const labels = plan.areas.map(item => item.label.trim());
  if (labels.some(label => !label)) throw new Error(t("check.areaLabel"));
  const duplicateLabel = labels.find((label, index) => labels.indexOf(label) !== index);
  if (duplicateLabel) throw new Error(t("check.duplicateLabel", { label: duplicateLabel }));
  // A drawn area may not take the label of one that is not on the drawing (renaming the drawn one fixes it). Areas not
  // on the drawing are never checked against each other: the reader cannot change them here.
  const takenLabel = labels.find(label => hiddenIds.has(label));
  if (takenLabel) throw new Error(t("check.labelTaken", { label: takenLabel }));
  const names = plan.rooms.map(room => room.name.trim());
  if (names.some(name => !name)) throw new Error(t("check.roomName"));
  const duplicateName = names.find((name, index) => names.indexOf(name) !== index);
  if (duplicateName) throw new Error(t("check.duplicateRoom", { name: duplicateName }));
  // Two rooms on one floor may not show the same name either (a short name can hide a stored "Store (2)").
  const firstFloor = plan.levels?.[0]?.id ?? "", shownOn = plan.rooms.map(room => `${room.level && plan.levels?.some(item => item.id === room.level) ? room.level : firstFloor}\n${(room.displayName ?? room.name).trim()}`);
  const duplicateShown = shownOn.find((entry, index) => shownOn.indexOf(entry) !== index);
  if (duplicateShown) throw new Error(t("check.duplicateRoom", { name: duplicateShown.slice(duplicateShown.indexOf("\n") + 1) }));
  const roomName = new Map(plan.rooms.map(room => [room.key, room.name.trim()]));
  // Each item names its floor when it is not on the first; a floor no longer there (a stale value) is dropped.
  const floors = new Set(plan.levels?.map(item => item.id) ?? []);
  const floorOf = (item: { level?: string }) => item.level && floors.has(item.level) ? { level: item.level } : {};
  // A label, landmark, line or shape writes its floor back among its carried keys (see liftLevel), in its saved place.
  const floorLowered = <T extends Carried & { level?: string }>(item: T): T => { const { level, ...rest } = item; return (level && floors.has(level) ? { ...rest, extra: { ...rest.extra, level } } : rest) as T; };
  // The first entrance's landmark entry is on the entrance's floor.
  const entranceFloored = (item: PlanEntrance): PlanEntrance => item.level && floors.has(item.level) ? { ...item, mark: { ...item.mark, extra: { ...item.mark?.extra, level: item.level } } } : item;
  // Only colours for boards still on the plan are kept.
  const boards = new Set(plan.areas.map(item => item.board.trim()).filter(Boolean));
  const boardColours = plan.colours ? Object.fromEntries(Object.entries(plan.colours).filter(([board]) => boards.has(board))) : undefined;
  const rooms = plan.rooms.map(room => {
    // A room filed under an area that is not on the drawing stays filed there until it is moved into a drawn area.
    const host = roomOwner(plan, room);
    const fixed = room.zone !== undefined && hiddenIds.has(room.zone) && (!host || sameRect(room.zoneRect, room.rect)) ? room.zone : null;
    if (fixed === null && !host) throw new Error(t("check.outside", { name: room.name.trim() }));
    // A free-shape room is saved with its corners and, as its box, the box around them (what older readers draw).
    const shaped = savedShape(room);
    return withCarried({ name: room.name.trim(), zone: fixed ?? host!.label.trim(), rect: shaped ? shaped.rect : rounded(room.rect), ...(shaped ? { points: shaped.points } : {}), ...colourOf(room), ...roomIdOf(room), ...lockedOf(room), ...autoDoorOf(room), ...floorOf(room), ...displayNameOf(room) }, room) as { name: string; zone: string; rect: Rect };
  });
  const roomsIn = (zone: string) => rooms.filter(room => room.zone === zone).map(room => room.name);
  const entranceMoved = !(plan.carried && "entrance" in plan.carried) || !samePoint(plan.carried.entrance, plan.entrance?.position);
  const zones = plan.areas.map(item => {
    const id = item.label.trim(), group = !!item.insideRoom && roomName.has(item.insideRoom), saved = item.saved;
    // Equipment placed from its room alone stays that way until it is moved, so the map keeps working it out.
    const rect = group && saved?.derived && sameRect(saved.rect, item.rect) ? {} : { rect: rounded(item.rect) };
    // A zone saved with no panel at all is written back without one while it still has none.
    const board = item.boardFilled && !item.board.trim() ? {} : { referenceBoard: item.board.trim() };
    const own = group
      ? { id, ...board, ...locationsOf(item), ...rect, independentSpace: false, physicalParentRoom: roomName.get(item.insideRoom!)!, ...(item.equipment?.trim() ? { equipment: item.equipment.trim() } : {}), ...colourOf(item), ...lockedOf(item), ...floorOf(plan.rooms.find(room => room.key === item.insideRoom) ?? item) }
      : (() => { const shaped = savedShape(item); return { id, ...board, ...locationsOf(item), ...(shaped ? { rect: shaped.rect, points: shaped.points } : rect), ...colourOf(item), ...lockedOf(item), ...floorOf(item) }; })();
    return withCarried(own, item, key => (key === "rooms" && !(saved && sameNames(saved.rooms, roomsIn(id))))
      || (key === "directionFromEntrance" && (entranceMoved || !sameRect(saved?.rect, item.rect))));
  });
  // Areas not on the drawing go back as saved, in their place, under the same rules for the keys the report reads.
  for (const { index, zone, rooms: filed } of [...hidden].sort((a, b) => a.index - b.index)) {
    const kept = Object.fromEntries(Object.entries(zone).filter(([key]) => !(key === "rooms" && !(filed && sameNames(filed, roomsIn(String(zone.id))))) && !(key === "directionFromEntrance" && entranceMoved)));
    zones.splice(Math.min(index, zones.length), 0, kept);
  }
  // A board marker holds while its board is still on the plan and none of that board's areas moved.
  const boardsHere = new Set([...boards, ...hidden.map(({ zone }) => zone.referenceBoard).filter((board): board is string => typeof board === "string" && !!board)]);
  const markerHolds = (board: string) => boardsHere.has(board) && plan.areas.every(item => item.board.trim() !== board || !item.saved || sameRect(item.saved.rect, item.rect));
  const extra = plan.extra && isRecord(plan.extra.boardMarkers) ? { ...plan.extra, boardMarkers: Object.fromEntries(Object.entries(plan.extra.boardMarkers).filter(([board]) => markerHolds(board))) } : plan.extra;
  const entranceLabel = plan.entrance ? plan.entrance.label.trim() || t("name.entrance") : "";
  const entrance = plan.entrance ? withCarried({ label: entranceLabel, position: plan.entrance.position.map(Math.round) as Point, ...floorOf(plan.entrance) }, plan.entrance, (key, value) => key === "referenceBoard" && !(typeof value === "string" && boardsHere.has(value))) : null;
  // Text labels and landmarks: drawing only. Each list is written when the layout had one or the plan now has something
  // for it (the first entrance counts once it is turned, sized, coloured or locked), so an old layout saves as it was.
  // A symbol list always holds every entrance, the first one first among them: a list written elsewhere without the
  // main entrance gets it (once) on its first save here.
  const labelItems = plan.labels ?? [], symbolItems = plan.symbols ?? [], carriedMarks = plan.carried;
  if (labelItems.some(item => !item.text.trim())) throw new Error(t("check.labelText"));
  // A main entrance with no entry of its own in the list joins it only while the list has room for it: a list written
  // elsewhere that already holds as many entries as readers draw keeps it in `layout.entrance` alone, so a save never
  // refuses, hides or repeats anything that was there (readers add `layout.entrance` when no entry stands for it).
  const listed = symbolItems.length + (carriedMarks?.symbols?.length ?? 0), entranceListed = !!plan.entrance && (plan.entrance.slot !== undefined || listed < MARK_LIMIT);
  // Only what the plan draws counts here: a saved list already longer than readers draw still saves as it was.
  if (labelItems.length > MARK_LIMIT || symbolItems.length + (entranceListed ? 1 : 0) > MARK_LIMIT) throw new Error(t("check.tooManyMarks", { max: MARK_LIMIT }));
  // Doors, lines and shapes are counted over the whole site (every floor), as readers draw at most so many of each.
  const roomKeys = new Set(plan.rooms.map(room => room.key));
  if ((plan.lines?.length ?? 0) > MAX_LINES) throw new Error(t("check.tooManyLines", { max: MAX_LINES }));
  if ((plan.openings ?? []).filter(item => roomKeys.has(item.room)).length > MAX_OPENINGS) throw new Error(t("check.tooManyOpenings", { max: MAX_OPENINGS }));
  if ((plan.shapes?.length ?? 0) > MAX_SHAPES) throw new Error(t("check.tooManyShapes", { max: MAX_SHAPES }));
  const labelOut = carriedMarks?.labelList || labelItems.length || carriedMarks?.labels?.length ? { labels: withPlaced(labelItems.map(item => writeLabel(floorLowered(item))), carriedMarks?.labels ?? []) } : carriedMarks?.rawLabels ? { labels: carriedMarks.rawLabels.value } : {};
  const firstEntrance = plan.entrance && entranceListed && (carriedMarks?.symbolList || symbolItems.length || carriedMarks?.symbols?.length || entranceMarked(plan.entrance)) ? [{ index: plan.entrance.slot ?? 0, item: entranceSymbol(entranceFloored(plan.entrance), entranceLabel) }] : [];
  const symbolOut = carriedMarks?.symbolList || symbolItems.length || carriedMarks?.symbols?.length || firstEntrance.length ? { symbols: withPlaced(symbolItems.map(({ key: _key, ...item }) => writeSymbol(floorLowered(item))), [...firstEntrance, ...(carriedMarks?.symbols ?? [])]) } : carriedMarks?.rawSymbols ? { symbols: carriedMarks.rawSymbols.value } : {};
  // Device entries the plan could not draw go back in their place; a device "list" that was not a list stays until devices are placed.
  const devices: unknown[] = plan.devices.map(item => withCarried({ meterId: item.meterId, position: item.position.map(Math.round) as Point, ...(item.size ? { size: item.size.map(Math.round) as Point } : {}), ...colourOf(item), ...lockedOf(item), ...rotationOf(item), ...floorOf(item) }, item));
  for (const { index, device } of [...(plan.carried?.devices ?? [])].sort((a, b) => a.index - b.index)) devices.splice(Math.min(index, devices.length), 0, device);
  const rawDevices = plan.carried?.rawDevices, rawEntrance = plan.carried?.rawEntrance;
  const layout = withCarried({
    viewBox: rounded(plan.viewBox),
    zones,
    rooms,
    ...(entrance ? { entrance } : rawEntrance ? { entrance: rawEntrance.value } : {}),
    ...(plan.carried?.noDevices && !plan.devices.length ? {} : rawDevices && !plan.devices.length ? { devices: rawDevices.value } : { devices }),
    ...(boardColours && Object.keys(boardColours).length ? { boardColours } : {}),
    ...(plan.style ? { style: plan.style } : {}),
    ...labelOut,
    ...symbolOut,
    ...(plan.editor ? { editor: plan.editor } : {}),
    ...(plan.openings ? { openings: writeOpenings(plan) } : {}),
    ...(plan.lines ? { lines: writeLines({ ...plan, lines: plan.lines.map(floorLowered) }) } : {}),
    // Plain shapes, while there are any or the layout had a list of them.
    ...(plan.shapes?.length || plan.carried?.shapes?.length || plan.carried?.shapeList ? { shapes: shapesForLayout((plan.shapes ?? []).map(floorLowered), plan.carried?.shapes) } : {}),
    ...(plan.levels ? { levels: plan.levels.map((item, index) => withCarried({ id: item.id, name: item.name.trim() ? item.name : t("level.default", { number: index + 1 }) }, item)) } : {}),
    ...(plan.layers ? { layers: plan.layers } : {}),
  }, { ...(extra ? { extra } : {}), ...(plan.carried?.order ? { order: plan.carried.order } : {}) }, (key, value) => key === "boardMarkers" && !isRecord(value)) as StoredSpatialReference["layout"];
  const reference: StoredSpatialReference = {
    ...(previous ?? {}),
    schemaVersion: 1,
    projectId,
    provenance: { ...(previous?.provenance ?? {}), file: previous?.provenance.file ?? "Drawn in EnergyX", status: "Edited in Facility → Floor layout" },
    layout,
  };
  if (!readProjectSpatialReference(notesWithReference("", null, reference), projectId)) throw new Error(t("check.insidePlan"));
  return reference;
}

/**
 * The stored block as text. Each door and each line goes on one line of its own: indented in full, a line's points take
 * about four lines each, and a full plan would not fit in Project notes. Everything else is written as it always was,
 * so a layout without doors or lines saves exactly as before.
 */
export function referenceText(reference: StoredSpatialReference): string {
  const layout = reference.layout as Record<string, unknown>, openings = layout.openings, lines = layout.lines;
  if (!Array.isArray(openings) && !Array.isArray(lines)) return JSON.stringify(reference, null, 2);
  const compact: string[] = [];
  let tag = "fp";
  const base = () => JSON.stringify(reference);
  while (base().includes(`@@${tag}:`)) tag += "x";
  const mark = (item: unknown) => { compact.push(JSON.stringify(item) ?? "null"); return `@@${tag}:${compact.length - 1}@@`; };
  const marked = { ...reference, layout: { ...layout, ...(Array.isArray(openings) ? { openings: openings.map(mark) } : {}), ...(Array.isArray(lines) ? { lines: lines.map(mark) } : {}) } };
  return JSON.stringify(marked, null, 2).replace(new RegExp(`"@@${tag}:(\\d+)@@"`, "g"), (_, index: string) => compact[Number(index)]!);
}
/** Replaces the existing layout block in the notes, or adds one at the end. */
export function notesWithReference(notes: string, block: string | null, reference: StoredSpatialReference): string {
  // Doors and lines one per line (referenceText), then shape corners folded onto one line each (compactPoints).
  const next = "```json\n" + compactPoints(referenceText(reference)) + "\n```";
  if (block && notes.includes(block)) return notes.replace(block, () => next);
  return `${notes.trimEnd()}${notes.trim() ? "\n\n" : ""}## Floor layout\n\n${next}\n`;
}
const NUMBER = String.raw`-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?`;
const PAIR = new RegExp(String.raw`\[\s*(${NUMBER}),\s*(${NUMBER})\s*\]`, "g");
const POINTS_LIST = new RegExp(String.raw`"points": \[\s*(?:\[\s*${NUMBER},\s*${NUMBER}\s*\],?\s*)+\]`, "g");
/**
 * Shape corners (`points`) on one line each, as [[x,y],[x,y],...]: indented, every corner takes four lines, so a few
 * drawn shapes would fill the notes. Only a `points` list of number pairs is folded; every other value (and so any
 * layout saved before free shapes) is written exactly as before.
 */
export const compactPoints = (json: string) => json.replace(POINTS_LIST, list => `"points": [${[...list.slice(list.indexOf("[") + 1).matchAll(PAIR)].map(([, x, y]) => `[${x},${y}]`).join(",")}]`);
