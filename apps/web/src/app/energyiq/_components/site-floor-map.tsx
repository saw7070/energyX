"use client";
import { useId, type CSSProperties, type KeyboardEvent } from "react";
import { openingRoom, spatialLines, spatialOpenings, type ProjectSpatialReference } from "@datafoundry/contracts";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { translatorFor, type EnergyIqLocale } from "./energyiq-messages";
import { floorMapMessages } from "./site-floor-map-messages";
import styles from "./site-floor-map.module.css";
import { planStyleOf } from "./floor-plan-model";
import { LineSymbol, OpeningSymbol, type LineClasses, type OpeningClasses } from "./plan-openings";

/** Stylesheet classes for doors, windows and walls on the map (see plan-openings). */
const OPENING_CLASSES: OpeningClasses = { gap: styles.planDoorGap!, leaf: styles.planDoor!, swing: styles.planDoorSwing!, window: styles.planWindow! };
const LINE_CLASSES: LineClasses = { wall: styles.planLineWall!, partition: styles.planLinePartition!, fence: styles.planLineFence!, road: styles.planLineRoad! };

const mapText = (locale: EnergyIqLocale) => translatorFor(floorMapMessages, locale);

/** Fixed categorical order (validated for colour-blind separation); colour follows the board, never its rank. */
const ZONE_COLOURS = ["var(--zone-1)", "var(--zone-2)", "var(--zone-3)", "var(--zone-4)", "var(--zone-5)", "var(--zone-6)"];
type Rect = [number, number, number, number];
type Zone = ProjectSpatialReference["layout"]["zones"][number];
type Extras = { property?: { address?: string; level?: number | string; occupancyExtent?: string; approximateAreaM2?: number }; layout: { entrance?: { label?: string; position?: [number, number] }; devices?: Array<{ meterId: string; position: [number, number]; size?: [number, number] }>; boardColours?: Record<string, string> } };

/** Colours a person can pick for a board in the floor plan editor, in the order shown. */
export const PANEL_COLOURS = [
  { key: "blue", hex: "#2a78d6" }, { key: "orange", hex: "#eb6834" }, { key: "green", hex: "#1baf7a" }, { key: "yellow", hex: "#eda100" }, { key: "pink", hex: "#e87ba4" },
  { key: "purple", hex: "#4a3aa7" }, { key: "teal", hex: "#1b9aaa" }, { key: "red", hex: "#d6453d" }, { key: "brown", hex: "#8a6a4f" }, { key: "grey", hex: "#6b7480" },
] as const;
export const isColour = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
/** Colours chosen for boards in the saved layout. */
export const chosenColours = (reference: ProjectSpatialReference): Record<string, string> => Object.fromEntries(Object.entries((reference as ProjectSpatialReference & Extras).layout.boardColours ?? {}).filter(([, value]) => isColour(value)));
/** Colour for each board name: the colour chosen for it, else the next in a fixed order. The same board gets the same colour on the map, legend and editor. */
export function boardColours(boards: string[], chosen: Record<string, string> = {}): Map<string, string> {
  const sorted = [...new Set(boards.filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return new Map(sorted.map((board, index) => [board, isColour(chosen[board]) ? chosen[board] : ZONE_COLOURS[index % ZONE_COLOURS.length]!]));
}
/**
 * Colours for areas that name no panel (keyed by the area's own key or id): they carry on the fixed order after the
 * boards, so each still stands apart and adding one never changes a board's colour.
 */
export function boardlessColours(boards: string[], keys: string[]): Map<string, string> {
  const offset = new Set(boards.filter(Boolean)).size;
  return new Map([...new Set(keys)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((key, index) => [key, ZONE_COLOURS[(offset + index) % ZONE_COLOURS.length]!]));
}
export function zoneColours(zones: Zone[], chosen: Record<string, string> = {}): Map<string, string> {
  const byBoard = boardColours(zones.map(zone => zone.referenceBoard), chosen);
  const noBoard = boardlessColours(zones.map(zone => zone.referenceBoard), zones.filter(zone => !zone.referenceBoard).map(zone => zone.id));
  // An area or equipment box can have its own colour; otherwise it takes its board's colour.
  return new Map(zones.map(zone => { const own = (zone as { colour?: unknown }).colour; return [zone.id, isColour(own) ? own : (zone.referenceBoard ? byBoard.get(zone.referenceBoard) : noBoard.get(zone.id))!]; }));
}
/** "A" reads as "Area A" (Chinese "区域 A", Malay "Kawasan A"); a longer label such as "Office wing" is shown as written. */
export const areaLabel = (id: string, locale: EnergyIqLocale = "en") => id.length <= 2 ? mapText(locale)("area", { id }) : id;
/** A device on the map: where it is, what it is called and which board feeds it. */
export type MapDevice = { id: string; name: string; board: string; position: [number, number]; size?: [number, number]; colour?: string };
/** Splits a room name into lines that fit its tile. */
export function wrapLabel(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  for (const word of text.split(/\s+/)) {
    const last = lines[lines.length - 1];
    if (last !== undefined && (last + " " + word).length <= maxChars) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}
/** Address, level, extent and size in one line; the address and extent are shown as the project wrote them. */
export function propertySummary(reference: ProjectSpatialReference, locale: EnergyIqLocale = "en"): string | null {
  const property = (reference as ProjectSpatialReference & Extras).property;
  if (!property) return null;
  const t = mapText(locale);
  return [property.address, property.level !== undefined ? t("level", { level: property.level }) : null, property.occupancyExtent, property.approximateAreaM2 ? t("about", { m2: property.approximateAreaM2.toLocaleString("en-SG") }) : null].filter(Boolean).join(" · ") || null;
}

/** Devices saved on the layout that still exist, with their current names and boards. */
export function mapDevices(reference: ProjectSpatialReference, meters: Array<{ id: string; name: string; board: string }>): MapDevice[] {
  const byId = new Map(meters.map(meter => [meter.id, meter]));
  return ((reference as ProjectSpatialReference & Extras).layout.devices ?? []).flatMap(item => { const meter = byId.get(item.meterId); const colour = (item as { colour?: unknown }).colour; return meter && Array.isArray(item.position) ? [{ ...meter, position: item.position, ...(Array.isArray(item.size) && item.size.length === 2 ? { size: item.size } : {}), ...(isColour(colour) ? { colour } : {}) }] : []; });
}
const inside = ([x, y, w, h]: number[], [px, py]: [number, number]) => px >= x && px <= x + w && py >= y && py <= y + h;
const escapeWords = (text: string) => text.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
/**
 * Pin label without what the surroundings already say: the room it sits in ("Showroom TV 1" in the Showroom reads "TV 1")
 * and, inside an equipment box, the words of that box's description ("LED Display 1" in "LED panels" reads "Display 1").
 */
export function pinLabel(name: string, position: [number, number], rooms: Array<{ name: string; rect: number[] }>, groups: Array<{ rect: number[]; equipment?: string }> = []): string {
  const room = rooms.find(item => inside(item.rect, position));
  const group = groups.find(item => inside(item.rect, position));
  let label = name;
  for (const word of (group?.equipment ?? "").split(/\s+/).filter(item => item.length >= 3)) {
    const stripped = label.replace(new RegExp("\\b" + escapeWords(word) + "\\b", "i"), " ").replace(/\s+/g, " ").trim();
    if (stripped.length >= 2) label = stripped;
  }
  if (room) {
    const stripped = label.replace(new RegExp("\\b" + escapeWords(room.name) + "\\b", "i"), " ").replace(/\s+/g, " ").trim();
    if (stripped.length >= 2) label = stripped;
  }
  return label.length > 18 ? `${label.slice(0, 17)}…` : label;
}
/** Rooms holding device pins show their name at the top, leaving the space below for the pins. */
export const roomHasPins = (rect: number[], positions: Array<[number, number]>) => positions.some(position => inside(rect, position));

/** The space a centred label takes, roughly: lines of text whose first baseline is at `y`. */
export const labelBox = (lines: string[], cx: number, y: number, size: number): Rect => {
  const width = Math.max(...lines.map(line => line.length)) * size * 0.6;
  return [cx - width / 2, y - size, width, size * (lines.length * 1.2 + 0.2)];
};
const overlaps = (a: Rect, b: Rect) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
/**
 * A door for a room, as drawn on floor plans: in the first corner (bottom left, bottom right, top left, top right)
 * where it and its swing stay clear of the room's labels and meters, or none when the room is small or crowded.
 * `along` is the way the opening runs along the wall, `inward` the way the door swings into the room.
 */
export function roomDoor([rx, ry, rw, rh]: Rect, unit: number, obstacles: Rect[]): { x: number; y: number; size: number; along: 1 | -1; inward: 1 | -1 } | null {
  if (rw <= unit * 9 || rh <= unit * 7) return null;
  const size = Math.min(unit * 2.6, rw * 0.18), inset = unit * 1.3;
  const spots = [{ x: rx + inset, y: ry + rh, along: 1, inward: -1 }, { x: rx + rw - inset, y: ry + rh, along: -1, inward: -1 }, { x: rx + inset, y: ry, along: 1, inward: 1 }, { x: rx + rw - inset, y: ry, along: -1, inward: 1 }] as const;
  const spot = spots.find(item => {
    const box: Rect = [Math.min(item.x, item.x + item.along * size), Math.min(item.y, item.y + item.inward * size), size, size];
    return !obstacles.some(obstacle => overlaps(box, obstacle));
  });
  return spot ? { ...spot, size } : null;
}

/**
 * `highlight` names the boards to emphasise (others fade); `highlightDevices` says exactly which pins those are, for
 * when different groups share a name; `onSelectBoard` makes each area clickable, saying which pin it holds if any;
 * `onOpenDevice` makes each pin clickable; `focusDevice` rings one pin.
 */
export function SiteFloorMap({ reference, large = false, devices = [], onOpenDevice, highlight = null, highlightDevices = null, onSelectBoard, focusDevice = null }: { reference: ProjectSpatialReference; large?: boolean; devices?: MapDevice[]; onOpenDevice?: (id: string) => void; highlight?: string[] | null; highlightDevices?: string[] | null; onSelectBoard?: (board: string, deviceId?: string) => void; focusDevice?: string | null }) {
  const t = useMessages(floorMapMessages);
  // Pattern ids must be unique per map on the page (the plan and its enlarged copy) and safe inside url(#…).
  const gridId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const { locale } = useEnergyIqLocale();
  const [x, y, w, h] = reference.layout.viewBox;
  const unit = w / 100;
  const colours = zoneColours(reference.layout.zones, chosenColours(reference));
  const zoneOf = new Map(reference.layout.zones.map(zone => [zone.id, zone]));
  const entrance = (reference as ProjectSpatialReference & Extras).layout.entrance;
  const areas = reference.layout.zones.filter(zone => zone.rect && zone.independentSpace !== false);
  const subgroups = reference.layout.zones.flatMap(zone => {
    if (zone.independentSpace !== false) return [];
    if (zone.rect) return [{ zone, box: zone.rect as Rect }];
    const room = reference.layout.rooms.find(item => item.name === zone.physicalParentRoom);
    if (!room) return [];
    const [rx, ry, rw, rh] = room.rect as Rect, pad = unit * 1.2, bh = Math.min(rh * 0.34, unit * 7);
    return [{ zone, box: [rx + pad, ry + rh - bh - pad, rw - pad * 2, bh] as Rect }];
  });
  const groupBoxes = subgroups.map(({ zone, box }) => ({ rect: box, ...(zone.equipment ? { equipment: zone.equipment } : {}) }));
  const byBoard = boardColours(reference.layout.zones.map(zone => zone.referenceBoard), chosenColours(reference));
  const positions = devices.map(device => device.position);
  const text = (lines: string[], cx: number, cy: number, size: number, className: string) => <text x={cx} y={cy - (lines.length - 1) * size * 0.6} textAnchor="middle" className={className} style={{ fontSize: size }}>{lines.map((line, index) => <tspan key={index} x={cx} dy={index ? size * 1.2 : 0}>{line}</tspan>)}</text>;
  const interactive = (!!onOpenDevice && devices.length > 0) || !!onSelectBoard;
  const pinsIn = (board: string, rect: number[]) => devices.filter(device => device.board === board && inside(rect, device.position));
  // A name alone can't say which of two same-named groups an area is, so an area holding pins goes by whose pins they are.
  const selectedArea = (board: string, rect: number[]) => {
    if (!highlight?.includes(board)) return false;
    const pins = highlightDevices ? pinsIn(board, rect) : [];
    return !pins.length || pins.some(pin => highlightDevices!.includes(pin.id));
  };
  const faded = (board: string, rect: number[]) => highlight !== null && !selectedArea(board, rect);
  const fadedPin = (device: MapDevice) => highlightDevices ? !highlightDevices.includes(device.id) : highlight !== null && !highlight.includes(device.board);
  // An area that names no panel is part of the drawing only: there is no panel to select.
  const clickable = (board: string, label: string, rect: number[]) => {
    if (!onSelectBoard || !board) return { className: faded(board, rect) ? styles.faded : undefined };
    const select = () => onSelectBoard(board, pinsIn(board, rect)[0]?.id);
    return { role: "button", tabIndex: 0, "aria-label": label, "aria-pressed": selectedArea(board, rect), className: `${styles.areaLink} ${faded(board, rect) ? styles.faded : ""}`, onClick: select, onKeyDown: (event: KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(); } } };
  };
  // Where each meter's symbol and label sit, so a room's door is drawn clear of them.
  const pinBoxes = devices.filter(device => !device.size).map(device => {
    const [dx, dy] = device.position, r = unit, fontSize = unit * 1.1, label = pinLabel(device.name, device.position, reference.layout.rooms, groupBoxes);
    return { at: device.position, boxes: [[dx - r * 1.75, dy - r * 1.75, r * 3.5, r * 3.5], labelBox([label], dx, dy + r * 1.75 + unit * 1.15, fontSize)] as Rect[] };
  });
  const area = (colour: string | undefined) => (colour ? { "--area": colour } : {}) as CSSProperties;
  // The site's chosen look. Colour blocks are the plain look: no grid, sheet border, title block or doors, and rounder corners.
  const look = planStyleOf((reference as ProjectSpatialReference & { layout: { style?: unknown } }).layout), drawn = look !== "blocks";
  const lookClass = look === "blueprint" ? styles.lookBlueprint : look === "blocks" ? styles.lookBlocks : styles.lookDrawing;
  const ids = { minor: `plan-grid-${gridId}`, major: `plan-grid-major-${gridId}` };
  // Doors, windows and walls the site drew (checked: the layout is untrusted). A room with a door of its own, or with its
  // automatic door switched off, gets no automatic door; every other room keeps the one worked out below.
  const openings = spatialOpenings(reference.layout).flatMap(opening => { const room = openingRoom(reference.layout.rooms, opening); return room ? [{ opening, room }] : []; });
  const ownDoor = new Set(openings.filter(item => item.opening.kind !== "window").map(item => item.room));
  const walls = spatialLines(reference.layout);
  return <svg viewBox={`${x} ${y} ${w} ${h + unit * 4}`} className={`${styles.map} ${lookClass} ${large ? styles.large : ""}`} data-look={look} role={interactive ? "group" : "img"} aria-label={devices.length ? t("ariaDevices", { count: devices.length }) : t("aria")}>
    {/* The sheet: drafting paper with a fine and a coarse grid, inside a drawing border. */}
    {drawn && <defs>
      <pattern id={ids.minor} width={unit * 2} height={unit * 2} patternUnits="userSpaceOnUse"><path d={`M${unit * 2} 0 L0 0 0 ${unit * 2}`} className={styles.gridMinor} strokeWidth={unit * 0.06} /></pattern>
      <pattern id={ids.major} width={unit * 10} height={unit * 10} patternUnits="userSpaceOnUse"><rect width={unit * 10} height={unit * 10} fill={`url(#${ids.minor})`} /><path d={`M${unit * 10} 0 L0 0 0 ${unit * 10}`} className={styles.gridMajor} strokeWidth={unit * 0.1} /></pattern>
    </defs>}
    <rect x={x} y={y} width={w} height={h + unit * 4} className={styles.sheet} />
    {drawn && <rect x={x} y={y} width={w} height={h + unit * 4} fill={`url(#${ids.major})`} />}
    {drawn && <rect x={x + unit * 0.4} y={y + unit * 0.4} width={w - unit * 0.8} height={h + unit * 3.2} className={styles.frame} strokeWidth={unit * 0.12} />}
    {areas.map(zone => { const [zx, zy, zw, zh] = zone.rect as Rect; const colour = colours.get(zone.id)!; return <g key={zone.id} style={area(colour)} {...clickable(zone.referenceBoard, zone.referenceBoard ? t("selectArea", { board: zone.referenceBoard, area: areaLabel(zone.id, locale) }) : areaLabel(zone.id, locale), zone.rect as Rect)}>
      {/* Outer walls in ink; the area's colour is kept to its name plate and a band along the top wall. */}
      {(() => { const on = selectedArea(zone.referenceBoard, zone.rect as Rect); return <rect x={zx} y={zy} width={zw} height={zh} rx={unit * (drawn ? 0.25 : 1.4)} className={`${styles.planZone} ${on ? styles.planZoneActive : ""}`} strokeWidth={unit * (drawn ? (on ? 0.8 : 0.42) : (on ? 0.4 : 0.18))} />; })()}
      {drawn && <rect x={zx + unit * 0.25} y={zy + unit * 0.25} width={Math.max(0, zw - unit * 0.5)} height={unit * 0.45} className={styles.planBand} />}
      <rect x={zx + unit * 1.4} y={zy + unit * 1.75} width={unit * 1.3} height={unit * 1.3} rx={unit * 0.2} className={styles.planSwatch} />
      <text x={zx + unit * 3.4} y={zy + unit * 2.95} className={styles.planZoneLabel} style={{ fontSize: unit * 1.8 }}>{zone.referenceBoard ? <>{zone.referenceBoard}<tspan className={styles.planZoneSub} dx={unit * 0.8}>{areaLabel(zone.id, locale)}</tspan></> : areaLabel(zone.id, locale)}</text>
    </g>; })}
    {reference.layout.rooms.map(room => { const [rx, ry, rw, rh] = room.rect as Rect; const colour = colours.get(room.zone); const size = Math.min(unit * 1.45, rw / 8); const board = reference.layout.zones.find(zone => zone.id === room.zone)?.referenceBoard ?? ""; const own = (room as { colour?: unknown }).colour;
      const lines = wrapLabel(room.name, Math.max(6, Math.floor(rw / (size * 0.58))));
      const labelY = roomHasPins(room.rect, positions) ? ry + size * 1.6 + (lines.length - 1) * size * 0.6 : ry + rh / 2 + size * 0.35;
      // Clear of the room's name (drawn from its first line, above the centre), its meters and any equipment inside it.
      const obstacles = [labelBox(lines, rx + rw / 2, labelY - (lines.length - 1) * size * 0.6, size), ...pinBoxes.filter(item => inside(room.rect, item.at)).flatMap(item => item.boxes),
        ...subgroups.map(item => item.box).filter(box => overlaps(box, room.rect as Rect)), ...devices.flatMap(device => device.size && inside(room.rect, device.position) ? [[device.position[0] - device.size[0] / 2, device.position[1] - device.size[1] / 2, device.size[0], device.size[1]] as Rect] : [])];
      const door = drawn && (room as { autoDoor?: unknown }).autoDoor !== false && !ownDoor.has(room) ? roomDoor(room.rect as Rect, unit, obstacles) : null;
      return <g key={room.name} style={area(isColour(own) ? own : colour)} {...clickable(board, t("selectRoom", { board, room: room.name }), room.rect)}>
      <rect x={rx} y={ry} width={rw} height={rh} rx={drawn ? 0 : unit * 0.8} className={`${styles.planRoom} ${isColour(own) ? styles.planRoomOwn : ""}`} strokeWidth={unit * (drawn ? 0.2 : 0.14)} />
      {door && <>
        <line x1={door.x} y1={door.y} x2={door.x + door.along * door.size} y2={door.y} className={styles.planDoorGap} strokeWidth={unit * 0.34} />
        <line x1={door.x} y1={door.y} x2={door.x} y2={door.y + door.inward * door.size} className={styles.planDoor} strokeWidth={unit * 0.14} />
        <path d={`M${door.x + door.along * door.size} ${door.y} A${door.size} ${door.size} 0 0 ${door.along * door.inward < 0 ? 0 : 1} ${door.x} ${door.y + door.inward * door.size}`} className={styles.planDoorSwing} strokeWidth={unit * 0.08} strokeDasharray={`${unit * 0.35} ${unit * 0.25}`} />
      </>}
      {text(lines, rx + rw / 2, labelY, size, styles.planRoomLabel)}
    </g>; })}
    {openings.length > 0 && <g pointerEvents="none">{openings.map(({ opening, room }) => <OpeningSymbol key={opening.id} rect={room.rect as Rect} opening={opening} unit={unit} swings={drawn} classes={OPENING_CLASSES} gapWidth={unit * (drawn ? 0.34 : 0.3)} />)}</g>}
    {subgroups.map(({ zone, box }) => {
      const colour = colours.get(zone.id)!;
      const [gx, gy, gw, gh] = box;
      const pinned = roomHasPins(box, positions);
      return <g key={zone.id} style={area(colour)} {...clickable(zone.referenceBoard, zone.equipment ? t("selectGroup", { board: zone.referenceBoard, equipment: zone.equipment }) : t("selectBoard", { board: zone.referenceBoard }), box)}>
        {(() => { const on = selectedArea(zone.referenceBoard, box); return <rect x={gx} y={gy} width={gw} height={gh} rx={unit * 0.3} className={`${styles.planEquip} ${on ? styles.planEquipActive : ""}`} strokeWidth={unit * (on ? 0.28 : 0.14)} strokeDasharray={`${unit * 0.6} ${unit * 0.4}`} />; })()}
        <text x={pinned ? gx + unit * 0.8 : gx + gw / 2} y={pinned ? gy + unit * 1.6 : gy + gh / 2 + unit * 0.6} textAnchor={pinned ? "start" : "middle"} className={styles.planEquipLabel} style={{ fontSize: unit * (pinned ? 1.1 : 1.4) }}>{zone.referenceBoard ? `${zone.referenceBoard} · ` : ""}{zone.equipment ?? t("equipmentInRoom")}</text>
      </g>;
    })}
    {walls.length > 0 && <g pointerEvents="none">{walls.map(line => <LineSymbol key={line.id} points={line.points} style={line.style} thickness={line.thickness} unit={unit} classes={LINE_CLASSES} />)}</g>}
    {entrance?.position && <g>
      <path d={`M${entrance.position[0] - unit * 1.4},${entrance.position[1] + unit * 2.2} L${entrance.position[0]},${entrance.position[1]} L${entrance.position[0] + unit * 1.4},${entrance.position[1] + unit * 2.2} Z`} className={styles.planEntrance} />
      <text x={entrance.position[0]} y={entrance.position[1] + unit * 4.4} textAnchor="middle" className={styles.planEntranceLabel} style={{ fontSize: unit * 1.3 }}>{entrance.label ?? t("entrance")}</text>
    </g>}
    {devices.map(device => {
      const [dx, dy] = device.position, colour = device.colour ?? byBoard.get(device.board) ?? "var(--zone-6)", r = unit * 1;
      const open = onOpenDevice ? () => onOpenDevice(device.id) : undefined;
      return <g key={device.id} className={`${open ? styles.pinLink : ""} ${fadedPin(device) ? styles.faded : ""}`} {...(open ? { role: "button", tabIndex: 0, "aria-label": t("openDevice", { name: device.name }), onClick: open, onKeyDown: (event: KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } } } : {})}>
        <title>{t(open ? "deviceTitleOpen" : "deviceTitle", { name: device.name, board: device.board })}</title>
        {device.size ? <DeviceBox x={dx} y={dy} size={device.size} name={device.name} colour={colour} unit={unit} focus={focusDevice === device.id} drawing /> : <>
        {focusDevice === device.id && <circle cx={dx} cy={dy} r={r * 2} className={styles.pinFocus} />}
        {/* A fixture symbol: a soft halo, the meter in its group's colour, and a bolt. */}
        <circle cx={dx} cy={dy} r={r * 1.75} className={styles.planPinHalo} style={{ fill: colour }} />
        <circle cx={dx} cy={dy} r={r} className={styles.planPin} style={{ fill: colour }} strokeWidth={r * 0.3} />
        <path d={`M${dx - r * 0.2},${dy - r * 0.55} L${dx - r * 0.45},${dy + r * 0.05} L${dx},${dy + r * 0.05} L${dx - r * 0.1},${dy + r * 0.6} L${dx + r * 0.45},${dy - r * 0.1} L${dx},${dy - r * 0.1} Z`} className={styles.pinIcon} />
        <text x={dx} y={dy + r * 1.75 + unit * 1.15} textAnchor="middle" className={styles.planPinLabel} style={{ fontSize: unit * 1.1, strokeWidth: unit * 0.35 }}>{pinLabel(device.name, device.position, reference.layout.rooms, groupBoxes)}</text>
        </>}
      </g>;
    })}
    {/* Title block, as on a drawing sheet. */}
    {drawn && <rect x={x + w - unit * 23.5} y={y + h + unit * 0.7} width={unit * 22.6} height={unit * 2.5} className={styles.titleBlock} strokeWidth={unit * 0.1} />}
    <text x={x + w - unit * 12.2} y={y + h + unit * 2.35} textAnchor="middle" className={styles.caption} style={{ fontSize: unit * 1.2 }}>{t("caption")}</text>
  </svg>;
}

/** A device drawn as a named box (dashed, in its board's colour), like an equipment group, instead of a dot. `drawing` draws it like the map's equipment boxes. */
export function DeviceBox({ x, y, size, name, colour, unit, focus = false, selected = false, drawing = false }: { x: number; y: number; size: [number, number]; name: string; colour: string; unit: number; focus?: boolean; selected?: boolean; drawing?: boolean }) {
  const [w, h] = size, left = x - w / 2, top = y - h / 2;
  const fontSize = Math.min(unit * 1.5, h * 0.42), lines = wrapLabel(name, Math.max(6, Math.floor((w - unit) / (fontSize * 0.56)))).slice(0, Math.max(1, Math.floor(h / (fontSize * 1.25))));
  return <>
    {(focus || selected) && <rect x={left - unit * 0.6} y={top - unit * 0.6} width={w + unit * 1.2} height={h + unit * 1.2} rx={unit * 1.2} className={styles.pinFocus} />}
    {drawing ? <rect x={left} y={top} width={w} height={h} rx={unit * 0.3} className={styles.planEquip} style={{ "--area": colour } as CSSProperties} strokeWidth={unit * 0.14} strokeDasharray={`${unit * 0.6} ${unit * 0.4}`} />
      : <rect x={left} y={top} width={w} height={h} rx={unit * 0.8} className={styles.subgroup} style={{ stroke: colour, fill: colour }} />}
    <text x={x} y={y + fontSize * 0.35 - (lines.length - 1) * fontSize * 0.6} textAnchor="middle" className={drawing ? styles.planEquipLabel : styles.subgroupLabel} style={{ fontSize }}>{lines.map((line, index) => <tspan key={index} x={x} dy={index ? fontSize * 1.2 : 0}>{line}</tspan>)}</text>
  </>;
}

export function BoardLegend({ reference }: { reference: ProjectSpatialReference }) {
  const t = useMessages(floorMapMessages);
  const { locale } = useEnergyIqLocale();
  const colours = zoneColours(reference.layout.zones, chosenColours(reference));
  const zones = [...reference.layout.zones].sort((a, b) => a.referenceBoard.localeCompare(b.referenceBoard, undefined, { numeric: true }));
  return <ul className={styles.legend} aria-label={t("legendAria")}>{zones.map(zone => {
    const rooms = reference.layout.rooms.filter(room => room.zone === zone.id).map(room => room.name);
    return <li key={zone.id}>
      <span className={styles.swatch} style={{ background: colours.get(zone.id) }} aria-hidden="true" />
      <div>
        <strong>{zone.referenceBoard}<span>{zone.referenceBoard ? " · " : ""}{zone.independentSpace === false ? t("inside", { room: zone.physicalParentRoom ?? t("aRoom") }) : areaLabel(zone.id, locale)}</span></strong>
        {zone.independentSpace === false ? <p>{t("subgroup", { equipment: zone.equipment ?? t("subgroupDefault"), room: zone.physicalParentRoom ?? t("roomAbove") })}</p> : <p className={styles.chips}>{rooms.map(room => <span key={room}>{room}</span>)}</p>}
      </div>
    </li>;
  })}</ul>;
}
