"use client";
import { memo, type PointerEvent as ReactPointerEvent } from "react";
import { labelFrame, symbolFrame, type Frame, type PlanLabel, type PlanSymbol } from "./floor-plan-marks";
import type { PlanArea, PlanDevice, PlanEntrance, PlanRoom, Selection } from "./floor-plan-model";
import { EntranceMark, LabelMark, SymbolMark, type MarkClasses } from "./plan-symbols";
import type { PlanShape } from "./floor-plan-plain-shapes";
import { cornersOf, insideBox, pointsText } from "./floor-plan-polygon";
import { PlainShapeBody } from "./plan-shapes";
import { DeviceBox, wrapLabel } from "./site-floor-map";
import mapStyles from "./site-floor-map.module.css";
import styles from "./floor-plan-editor.module.css";

/**
 * The items on the layout editor's canvas, one small component each. Each is redrawn only when its own props change,
 * so dragging one room on a big plan (hundreds of rooms and devices) does not redraw every other item. `onDown` must be
 * the same function from one render to the next. Every item can take keyboard focus (the editor moves it with [ and ])
 * and is named for screen readers by `label`.
 */
export type ItemDown = (event: ReactPointerEvent, item: Selection) => void;
type Common = { unit: number; label: string; onDown: ItemDown };
const itemClass = (locked?: true) => `${styles.item} ${locked ? styles.lockedItem : ""}`;
const focusable = (id: string, label: string) => ({ "data-item": id, tabIndex: -1, role: "img", "aria-label": label });

export const AreaShape = memo(function AreaShape({ item, colour, name, unit, label, onDown }: Common & { item: PlanArea; colour: string; name: string }) {
  // A free-shape area (an L-shaped block) is drawn as its outline, its name plate in its largest part.
  const corners = cornersOf(item), [x, y, w, h] = corners ? insideBox(item) : item.rect;
  return <g className={itemClass(item.locked)} {...focusable(`area:${item.key}`, label)} onPointerDown={event => onDown(event, { kind: "area", key: item.key })}>
    {corners ? <polygon points={pointsText(corners)} strokeLinejoin="round" className={mapStyles.zone} style={{ fill: colour, stroke: colour }} /> : <rect x={x} y={y} width={w} height={h} rx={unit * 1.4} className={mapStyles.zone} style={{ fill: colour, stroke: colour }} />}
    <circle cx={x + unit * 2.4} cy={y + unit * 2.6} r={unit * 0.9} style={{ fill: colour }} />
    <text x={x + unit * 4} y={y + unit * 3.3} className={mapStyles.zoneLabel} style={{ fontSize: unit * 2.1 }}>{item.board ? <>{item.board}<tspan className={mapStyles.zoneSub} dx={unit * 0.8}>{name}</tspan></> : name}</text>
  </g>;
});

/** `colour` is the room's own colour, else its area's; a room in no area has none and is drawn dashed red. */
export const RoomShape = memo(function RoomShape({ room, colour, pinned, unit, label, onDown }: Common & { room: PlanRoom; colour: string | undefined; pinned: boolean }) {
  // A free-shape room is drawn as its outline, its name in its largest part.
  const corners = cornersOf(room), [x, y, w, h] = corners ? insideBox(room) : room.rect;
  const size = Math.min(unit * 1.75, w / 7), lines = wrapLabel(room.name, Math.max(6, Math.floor(w / (size * 0.56))));
  const top = pinned ? y + size * 1.5 : y + h / 2 + size * 0.35 - (lines.length - 1) * size * 0.6;
  const look = { className: `${mapStyles.room} ${colour ? "" : styles.orphan}`, style: room.colour ? { stroke: room.colour, fill: `color-mix(in srgb, ${room.colour} 12%, white)` } : colour ? { stroke: colour } : undefined };
  return <g className={itemClass(room.locked)} {...focusable(`room:${room.key}`, label)} onPointerDown={event => onDown(event, { kind: "room", key: room.key })}>
    {corners ? <polygon points={pointsText(corners)} strokeLinejoin="round" {...look} /> : <rect x={x} y={y} width={w} height={h} rx={unit * 0.8} {...look} />}
    <text x={x + w / 2} y={top} textAnchor="middle" className={mapStyles.roomLabel} style={{ fontSize: size }}>{lines.map((line, index) => <tspan key={index} x={x + w / 2} dy={index ? size * 1.2 : 0}>{line}</tspan>)}</text>
  </g>;
});

export const GroupShape = memo(function GroupShape({ item, colour, pinned, fallback, unit, label, onDown }: Common & { item: PlanArea; colour: string; pinned: boolean; fallback: string }) {
  const [x, y, w, h] = item.rect;
  return <g className={itemClass(item.locked)} {...focusable(`area:${item.key}`, label)} onPointerDown={event => onDown(event, { kind: "area", key: item.key })}>
    <rect x={x} y={y} width={w} height={h} rx={unit * 0.8} className={mapStyles.subgroup} style={{ stroke: colour, fill: colour }} />
    <text x={pinned ? x + unit * 0.8 : x + w / 2} y={pinned ? y + unit * 1.6 : y + h / 2 + unit * 0.6} textAnchor={pinned ? "start" : "middle"} className={mapStyles.subgroupLabel} style={{ fontSize: unit * (pinned ? 1.15 : 1.5) }}>{item.board ? `${item.board} · ` : ""}{item.equipment || fallback}</text>
  </g>;
});

/** The editor draws labels and landmarks with the map's own symbols, in the editor's (classic) colours. */
export const EDITOR_MARKS: MarkClasses = { mark: mapStyles.mark!, halo: mapStyles.markHalo!, text: mapStyles.markText!, entrance: mapStyles.entrance!, entranceLabel: mapStyles.entranceLabel! };
/** An invisible box over a turned item, turned with it, so a press anywhere on it (not just on its lines) picks it. */
const HitBox = ({ frame }: { frame: Frame }) => { const { pivot: [px, py], box: [bx, by, bw, bh], rotation } = frame; return <rect x={px + bx} y={py + by} width={bw} height={bh} fill="transparent" data-hit="1" {...(rotation ? { transform: `rotate(${rotation} ${px} ${py})` } : {})} />; };

/** The first entrance: drawn exactly as before landmarks existed until it is turned, sized or coloured. */
export const EntranceShape = memo(function EntranceShape({ entrance, selected, unit, label, onDown }: Common & { entrance: PlanEntrance; selected: boolean }) {
  const [x, y] = entrance.position, plain = entrance.size === undefined && !entrance.rotation;
  const frame = symbolFrame({ kind: "entrance", position: entrance.position, ...(entrance.size !== undefined ? { size: entrance.size } : {}), ...(entrance.rotation ? { rotation: entrance.rotation } : {}) }, unit);
  return <g className={itemClass(entrance.locked)} {...focusable("entrance:entrance", label)} onPointerDown={event => onDown(event, { kind: "entrance", key: "entrance" })}>
    {!plain && <HitBox frame={frame} />}
    <EntranceMark position={entrance.position} {...(entrance.size !== undefined ? { size: entrance.size } : {})} {...(entrance.rotation ? { rotation: entrance.rotation } : {})} {...(entrance.colour ? { colour: entrance.colour } : {})} label={entrance.label} unit={unit} legacy={{ offset: unit * 4.6, font: unit * 1.6 }} classes={EDITOR_MARKS} />
    {selected && plain && <circle cx={x} cy={y + unit * 1.2} r={unit * 2.6} className={styles.selectRing} />}
  </g>;
});

/** A free text label. */
export const LabelShape = memo(function LabelShape({ item, unit, label, onDown }: Common & { item: PlanLabel }) {
  return <g className={itemClass(item.locked)} {...focusable(`label:${item.key}`, label)} onPointerDown={event => onDown(event, { kind: "label", key: item.key })}>
    <HitBox frame={labelFrame(item, unit)} />
    <LabelMark text={item.text} position={item.position} {...(item.size ? { size: item.size } : {})} {...(item.rotation ? { rotation: item.rotation } : {})} {...(item.colour ? { colour: item.colour } : {})} bold={!!item.bold} unit={unit} classes={EDITOR_MARKS} />
  </g>;
});

/** A landmark (an entrance after the first is drawn like the first). */
export const SymbolShape = memo(function SymbolShape({ item, unit, label, fallback, onDown }: Common & { item: PlanSymbol; fallback: string }) {
  const own = { ...(item.size !== undefined ? { size: item.size } : {}), ...(item.rotation ? { rotation: item.rotation } : {}), ...(item.colour ? { colour: item.colour } : {}) };
  return <g className={itemClass(item.locked)} {...focusable(`symbol:${item.key}`, label)} onPointerDown={event => onDown(event, { kind: "symbol", key: item.key })}>
    <HitBox frame={symbolFrame(item, unit)} />
    {item.kind === "entrance" ? <EntranceMark position={item.position} {...own} label={item.label ?? fallback} unit={unit} legacy={{ offset: unit * 4.6, font: unit * 1.6 }} classes={EDITOR_MARKS} />
      : <SymbolMark kind={item.kind} position={item.position} {...own} {...(item.label ? { label: item.label } : {})} unit={unit} classes={EDITOR_MARKS} />}
  </g>;
});

/** `pin` is the short label under a dot (the device name without the room it sits in). */
export const DeviceShape = memo(function DeviceShape({ item, name, board, colour, pin, selected, unit, label, onDown }: Common & { item: PlanDevice; name: string; board: string; colour: string; pin: string; selected: boolean }) {
  const [x, y] = item.position, r = unit * 1.1;
  return <g className={itemClass(item.locked)} {...focusable(`device:${item.meterId}`, label)} onPointerDown={event => onDown(event, { kind: "device", key: item.meterId })}>
    <title>{`${name} · ${board}`}</title>
    {item.size ? item.rotation ? <g transform={`rotate(${item.rotation} ${x} ${y})`}><DeviceBox x={x} y={y} size={item.size} name={name} colour={colour} unit={unit} /></g> : <DeviceBox x={x} y={y} size={item.size} name={name} colour={colour} unit={unit} /> : <>
      {selected && <circle cx={x} cy={y} r={r * 1.7} className={styles.selectRing} />}
      <circle cx={x} cy={y} r={r} className={mapStyles.pin} style={{ fill: colour }} />
      <text x={x} y={y + r + unit * 1.3} textAnchor="middle" className={mapStyles.pinLabel} style={{ fontSize: unit * 1.15 }}>{pin}</text>
    </>}
  </g>;
});

/** A plain shape (a lawn, a driveway): a rectangle, a circle or an outline, in its fill colour, with its caption. */
export const PlainShapeItem = memo(function PlainShapeItem({ shape, unit, label, onDown }: Common & { shape: PlanShape }) {
  return <g className={itemClass(shape.locked)} {...focusable(`shape:${shape.key}`, label)} onPointerDown={event => onDown(event, { kind: "shape", key: shape.key })}>
    <PlainShapeBody kind={shape.kind} rect={shape.rect} corners={shape.kind === "polygon" ? cornersOf(shape) : null} fill={shape.fill} stroke={shape.stroke} label={shape.label} unit={unit} className={styles.plainShape} labelClassName={styles.plainShapeLabel} />
  </g>;
});
