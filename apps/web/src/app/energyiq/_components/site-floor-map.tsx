"use client";
import type { KeyboardEvent } from "react";
import type { ProjectSpatialReference } from "@datafoundry/contracts";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { translatorFor, type EnergyIqLocale } from "./energyiq-messages";
import { floorMapMessages } from "./site-floor-map-messages";
import styles from "./site-floor-map.module.css";

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
  const sorted = [...new Set(boards)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return new Map(sorted.map((board, index) => [board, isColour(chosen[board]) ? chosen[board] : ZONE_COLOURS[index % ZONE_COLOURS.length]!]));
}
export function zoneColours(zones: Zone[], chosen: Record<string, string> = {}): Map<string, string> {
  const byBoard = boardColours(zones.map(zone => zone.referenceBoard), chosen);
  // An area or equipment box can have its own colour; otherwise it takes its board's colour.
  return new Map(zones.map(zone => { const own = (zone as { colour?: unknown }).colour; return [zone.id, isColour(own) ? own : byBoard.get(zone.referenceBoard)!]; }));
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

/**
 * `highlight` names the boards to emphasise (others fade); `onSelectBoard` makes each area clickable;
 * `onOpenDevice` makes each pin clickable; `focusDevice` rings one pin.
 */
export function SiteFloorMap({ reference, large = false, devices = [], onOpenDevice, highlight = null, onSelectBoard, focusDevice = null }: { reference: ProjectSpatialReference; large?: boolean; devices?: MapDevice[]; onOpenDevice?: (id: string) => void; highlight?: string[] | null; onSelectBoard?: (board: string) => void; focusDevice?: string | null }) {
  const t = useMessages(floorMapMessages);
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
  const faded = (board: string) => highlight !== null && !highlight.includes(board);
  const clickable = (board: string, label: string) => onSelectBoard ? { role: "button", tabIndex: 0, "aria-label": label, "aria-pressed": highlight?.includes(board) ?? false, className: `${styles.areaLink} ${faded(board) ? styles.faded : ""}`, onClick: () => onSelectBoard(board), onKeyDown: (event: KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelectBoard(board); } } } : { className: faded(board) ? styles.faded : undefined };
  return <svg viewBox={`${x} ${y} ${w} ${h + unit * 4}`} className={`${styles.map} ${large ? styles.large : ""}`} role={interactive ? "group" : "img"} aria-label={devices.length ? t("ariaDevices", { count: devices.length }) : t("aria")}>
    {areas.map(zone => { const [zx, zy, zw, zh] = zone.rect as Rect; const colour = colours.get(zone.id)!; return <g key={zone.id} {...clickable(zone.referenceBoard, t("selectArea", { board: zone.referenceBoard, area: areaLabel(zone.id, locale) }))}>
      <rect x={zx} y={zy} width={zw} height={zh} rx={unit * 1.4} className={`${styles.zone} ${highlight?.includes(zone.referenceBoard) ? styles.zoneActive : ""}`} style={{ fill: colour, stroke: colour }} />
      <circle cx={zx + unit * 2.4} cy={zy + unit * 2.6} r={unit * 0.9} style={{ fill: colour }} />
      <text x={zx + unit * 4} y={zy + unit * 3.3} className={styles.zoneLabel} style={{ fontSize: unit * 2.1 }}>{zone.referenceBoard}<tspan className={styles.zoneSub} dx={unit * 0.8}>{areaLabel(zone.id, locale)}</tspan></text>
    </g>; })}
    {reference.layout.rooms.map(room => { const [rx, ry, rw, rh] = room.rect as Rect; const colour = colours.get(room.zone); const size = Math.min(unit * 1.75, rw / 7); const board = reference.layout.zones.find(zone => zone.id === room.zone)?.referenceBoard ?? ""; return <g key={room.name} {...clickable(board, t("selectRoom", { board, room: room.name }))}>
      {(() => { const own = (room as { colour?: unknown }).colour; return <rect x={rx} y={ry} width={rw} height={rh} rx={unit * 0.8} className={styles.room} style={isColour(own) ? { stroke: own, fill: `color-mix(in srgb, ${own} 12%, white)` } : colour ? { stroke: colour } : undefined} />; })()}
      {(() => { const lines = wrapLabel(room.name, Math.max(6, Math.floor(rw / (size * 0.56)))); return text(lines, rx + rw / 2, roomHasPins(room.rect, positions) ? ry + size * 1.5 + (lines.length - 1) * size * 0.6 : ry + rh / 2 + size * 0.35, size, styles.roomLabel); })()}
    </g>; })}
    {subgroups.map(({ zone, box }) => {
      const colour = colours.get(zone.id)!;
      const [gx, gy, gw, gh] = box;
      const pinned = roomHasPins(box, positions);
      return <g key={zone.id} {...clickable(zone.referenceBoard, zone.equipment ? t("selectGroup", { board: zone.referenceBoard, equipment: zone.equipment }) : t("selectBoard", { board: zone.referenceBoard }))}>
        <rect x={gx} y={gy} width={gw} height={gh} rx={unit * 0.8} className={`${styles.subgroup} ${highlight?.includes(zone.referenceBoard) ? styles.zoneActive : ""}`} style={{ stroke: colour, fill: colour }} />
        <text x={pinned ? gx + unit * 0.8 : gx + gw / 2} y={pinned ? gy + unit * 1.6 : gy + gh / 2 + unit * 0.6} textAnchor={pinned ? "start" : "middle"} className={styles.subgroupLabel} style={{ fontSize: unit * (pinned ? 1.15 : 1.5) }}>{zone.referenceBoard} · {zone.equipment ?? t("equipmentInRoom")}</text>
      </g>;
    })}
    {entrance?.position && <g>
      <path d={`M${entrance.position[0] - unit * 1.4},${entrance.position[1] + unit * 2.2} L${entrance.position[0]},${entrance.position[1]} L${entrance.position[0] + unit * 1.4},${entrance.position[1] + unit * 2.2} Z`} className={styles.entrance} />
      <text x={entrance.position[0]} y={entrance.position[1] + unit * 4.6} textAnchor="middle" className={styles.entranceLabel} style={{ fontSize: unit * 1.6 }}>{entrance.label ?? t("entrance")}</text>
    </g>}
    {devices.map(device => {
      const [dx, dy] = device.position, colour = device.colour ?? byBoard.get(device.board) ?? "var(--zone-6)", r = unit * 1.1;
      const open = onOpenDevice ? () => onOpenDevice(device.id) : undefined;
      return <g key={device.id} className={`${open ? styles.pinLink : ""} ${faded(device.board) ? styles.faded : ""}`} {...(open ? { role: "button", tabIndex: 0, "aria-label": t("openDevice", { name: device.name }), onClick: open, onKeyDown: (event: KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } } } : {})}>
        <title>{t(open ? "deviceTitleOpen" : "deviceTitle", { name: device.name, board: device.board })}</title>
        {device.size ? <DeviceBox x={dx} y={dy} size={device.size} name={device.name} colour={colour} unit={unit} focus={focusDevice === device.id} /> : <>
        {focusDevice === device.id && <circle cx={dx} cy={dy} r={r * 1.9} className={styles.pinFocus} />}
        <circle cx={dx} cy={dy} r={r} className={styles.pin} style={{ fill: colour }} />
        <path d={`M${dx - r * 0.2},${dy - r * 0.55} L${dx - r * 0.45},${dy + r * 0.05} L${dx},${dy + r * 0.05} L${dx - r * 0.1},${dy + r * 0.6} L${dx + r * 0.45},${dy - r * 0.1} L${dx},${dy - r * 0.1} Z`} className={styles.pinIcon} />
        <text x={dx} y={dy + r + unit * 1.3} textAnchor="middle" className={styles.pinLabel} style={{ fontSize: unit * 1.15 }}>{pinLabel(device.name, device.position, reference.layout.rooms, groupBoxes)}</text>
        </>}
      </g>;
    })}
    <text x={x + w - unit} y={y + h + unit * 3} textAnchor="end" className={styles.caption} style={{ fontSize: unit * 1.4 }}>{t("caption")}</text>
  </svg>;
}

/** A device drawn as a named box (dashed, in its board's colour), like an equipment group, instead of a dot. */
export function DeviceBox({ x, y, size, name, colour, unit, focus = false, selected = false }: { x: number; y: number; size: [number, number]; name: string; colour: string; unit: number; focus?: boolean; selected?: boolean }) {
  const [w, h] = size, left = x - w / 2, top = y - h / 2;
  const fontSize = Math.min(unit * 1.5, h * 0.42), lines = wrapLabel(name, Math.max(6, Math.floor((w - unit) / (fontSize * 0.56)))).slice(0, Math.max(1, Math.floor(h / (fontSize * 1.25))));
  return <>
    {(focus || selected) && <rect x={left - unit * 0.6} y={top - unit * 0.6} width={w + unit * 1.2} height={h + unit * 1.2} rx={unit * 1.2} className={styles.pinFocus} />}
    <rect x={left} y={top} width={w} height={h} rx={unit * 0.8} className={styles.subgroup} style={{ stroke: colour, fill: colour }} />
    <text x={x} y={y + fontSize * 0.35 - (lines.length - 1) * fontSize * 0.6} textAnchor="middle" className={styles.subgroupLabel} style={{ fontSize }}>{lines.map((line, index) => <tspan key={index} x={x} dy={index ? fontSize * 1.2 : 0}>{line}</tspan>)}</text>
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
        <strong>{zone.referenceBoard}<span> · {zone.independentSpace === false ? t("inside", { room: zone.physicalParentRoom ?? t("aRoom") }) : areaLabel(zone.id, locale)}</span></strong>
        {zone.independentSpace === false ? <p>{t("subgroup", { equipment: zone.equipment ?? t("subgroupDefault"), room: zone.physicalParentRoom ?? t("roomAbove") })}</p> : <p className={styles.chips}>{rooms.map(room => <span key={room}>{room}</span>)}</p>}
      </div>
    </li>;
  })}</ul>;
}
