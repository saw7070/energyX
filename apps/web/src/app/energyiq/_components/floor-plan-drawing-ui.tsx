"use client";
import { memo, useState, type KeyboardEvent, type ReactNode } from "react";
import { LINE_STYLES, LINE_THICKNESSES, OPENING_KINDS, SPATIAL_WALLS, type SpatialWall } from "@datafoundry/contracts";
import { useMessages } from "./energyiq-locale";
import { removePoint, restyleLine, type PlanLine } from "./floor-plan-lines";
import { floorPlanMessages } from "./floor-plan-messages";
import type { FloorPlan, PlanRoom, Point, Rect, Selection } from "./floor-plan-model";
import { addOpening, flipOpening, isDoorLike, openingsOf, updateOpening, type PlanOpening } from "./floor-plan-openings";
import { parseAmount } from "./floor-plan-position";
import type { ItemDown } from "./floor-plan-shapes";
import { LineSymbol, OpeningSymbol, type LineClasses, type OpeningClasses } from "./plan-openings";
import mapStyles from "./site-floor-map.module.css";
import styles from "./floor-plan-editor.module.css";

/**
 * The layout editor's doors, windows and lines: their shapes on the canvas (one small component each, redrawn only when
 * they change) and their side panels. The model is in floor-plan-openings and floor-plan-lines.
 */
const OPENING_CLASSES: OpeningClasses = { gap: styles.openingGap!, leaf: mapStyles.planDoor!, swing: mapStyles.planDoorSwing!, window: mapStyles.planWindow! };
const LINE_CLASSES: LineClasses = { wall: mapStyles.planLineWall!, partition: mapStyles.planLinePartition!, fence: mapStyles.planLineFence!, road: mapStyles.planLineRoad! };
const focusable = (id: string, label: string) => ({ "data-item": id, tabIndex: -1, role: "img", "aria-label": label });

export const LineShape = memo(function LineShape({ line, unit, label, onDown }: { line: PlanLine; unit: number; label: string; onDown: ItemDown }) {
  return <g className={`${styles.item} ${line.locked ? styles.lockedItem : ""}`} {...focusable(`line:${line.key}`, label)} data-line={line.key} onPointerDown={event => onDown(event, { kind: "line", key: line.key })}>
    <polyline points={line.points.map(point => point.join(",")).join(" ")} className={styles.hit} strokeWidth={unit * 1.6} />
    <LineSymbol points={line.points} style={line.style} thickness={line.thickness} unit={unit} classes={LINE_CLASSES} />
  </g>;
});

export const OpeningShape = memo(function OpeningShape({ opening, rect, unit, label, onDown }: { opening: PlanOpening; rect: Rect; unit: number; label: string; onDown: ItemDown }) {
  return <g className={styles.item} {...focusable(`opening:${opening.key}`, label)} data-opening={opening.key} onPointerDown={event => onDown(event, { kind: "opening", key: opening.key })}>
    <OpeningSymbol rect={rect} opening={opening} unit={unit} swings classes={OPENING_CLASSES} gapWidth={unit * 0.5} />
    <OpeningSymbol rect={rect} opening={{ ...opening, kind: "opening" }} unit={unit} swings={false} classes={{ ...OPENING_CLASSES, gap: styles.hit! }} gapWidth={unit * 1.4} />
  </g>;
});

/** The line being drawn with the Wall / line tool: its points so far and, dashed, the next segment to the pointer. */
export function LinePreview({ points, hover, unit }: { points: Point[]; hover: Point | null; unit: number }) {
  const all = hover ? [...points, hover] : points;
  return <g pointerEvents="none">
    {all.length > 1 && <polyline points={all.map(point => point.join(",")).join(" ")} className={styles.linePreview} />}
    {points.map((point, index) => <circle key={index} cx={point[0]} cy={point[1]} r={unit * 0.5} className={styles.vertexPicked} />)}
  </g>;
}

/** A number typed into a field: used when the field is left or Enter is pressed (one undo step); Esc puts it back. */
function AmountField({ label, value, disabled, onCommit }: { label: string; value: number; disabled: boolean; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const finish = () => { if (draft === null) return; const amount = parseAmount(draft); setDraft(null); if (amount !== null && amount > 0 && Math.round(amount) !== value) onCommit(amount); };
  const keys = (event: KeyboardEvent<HTMLInputElement>) => { if (event.key === "Enter") { event.preventDefault(); finish(); } if (event.key === "Escape") setDraft(null); };
  return <label>{label}<input inputMode="decimal" autoComplete="off" disabled={disabled} value={draft ?? String(Math.round(value))} onFocus={() => setDraft(String(Math.round(value)))} onChange={event => setDraft(event.target.value)} onBlur={finish} onKeyDown={keys} /></label>;
}

/** The first wall of a room with no door or window on it yet (bottom, top, right, left), for "+ Add door". */
const freeWall = (plan: FloorPlan, room: PlanRoom): SpatialWall => (["s", "n", "e", "w"] as const).find(wall => !openingsOf(plan, room.key).some(item => item.wall === wall)) ?? "s";

/**
 * In a room's panel: whether the plan draws a door for it by itself, its own doors and windows (each selects it), and a
 * button that adds a door. `commit` makes one undo step and selects what it is given.
 */
export function RoomDoors({ plan, room, commit, onSelect, onFull }: { plan: FloorPlan; room: PlanRoom; commit: (next: FloorPlan, selection?: Selection[]) => void; onSelect: (item: Selection) => void; onFull: () => void }) {
  const t = useMessages(floorPlanMessages);
  const own = openingsOf(plan, room.key), hasDoor = own.some(item => isDoorLike(item.kind));
  const setAuto = (on: boolean) => commit({ ...plan, rooms: plan.rooms.map(item => { if (item.key !== room.key) return item; const { autoDoor: _old, ...rest } = item; return on ? rest : { ...rest, autoDoor: false as const }; }) });
  const add = () => { const result = addOpening(plan, room.key, freeWall(plan, room), 0.5); if (result) commit(result.plan, [{ kind: "opening", key: result.key }]); else onFull(); };
  return <fieldset className={styles.doorsField}><legend>{t("panel.doors")}</legend>
    <label className={styles.check}><input type="checkbox" checked={room.autoDoor !== false && !hasDoor} disabled={hasDoor} onChange={event => setAuto(event.target.checked)} />{t("panel.autoDoor")}</label>
    <small>{t("panel.autoDoorHint")}</small>
    {own.length > 0 && <ul className={styles.doorList}>{own.map(item => <li key={item.key}><button type="button" onClick={() => onSelect({ kind: "opening", key: item.key })}>{t(`opening.${item.kind}`)} · {t(`wall.${item.wall}`)}</button></li>)}</ul>}
    <button type="button" className={styles.tool} onClick={add}>{t("panel.addDoor")}</button>
  </fieldset>;
}

/** The side panel for one door, double door, opening or window. */
export function OpeningPanel({ plan, opening, commit, onDelete }: { plan: FloorPlan; opening: PlanOpening; commit: (next: FloorPlan) => void; onDelete: () => void }) {
  const t = useMessages(floorPlanMessages);
  const room = plan.rooms.find(item => item.key === opening.room);
  const change = (patch: Parameters<typeof updateOpening>[2]) => commit(updateOpening(plan, opening.key, patch));
  const door = opening.kind === "door" || opening.kind === "double";
  return <div className={styles.panel} data-panel="opening">
    <h5>{t("panel.opening")}</h5>
    {room && <p>{t("panel.openingIn", { room: room.name })}</p>}
    <label>{t("panel.openingKind")}<select value={opening.kind} onChange={event => change({ kind: event.target.value as PlanOpening["kind"] })}>{OPENING_KINDS.map(kind => <option key={kind} value={kind}>{t(`opening.${kind}`)}</option>)}</select></label>
    <label>{t("panel.openingWall")}<select value={opening.wall} onChange={event => change({ wall: event.target.value as SpatialWall })}>{SPATIAL_WALLS.map(wall => <option key={wall} value={wall}>{t(`wall.${wall}`)}</option>)}</select></label>
    <AmountField key={`width:${opening.key}`} label={t("panel.openingWidth")} value={opening.width} disabled={false} onCommit={width => change({ width })} />
    {door && <label>{t("panel.swing")}<select value={opening.swing ?? "in"} onChange={event => change({ swing: event.target.value as "in" | "out" })}><option value="in">{t("swing.in")}</option><option value="out">{t("swing.out")}</option></select></label>}
    {opening.kind === "door" && <label>{t("panel.hinge")}<select value={opening.hinge ?? "start"} onChange={event => change({ hinge: event.target.value as "start" | "end" })}><option value="start">{t("hinge.start")}</option><option value="end">{t("hinge.end")}</option></select></label>}
    {door && <button type="button" className={styles.tool} title={t("panel.flipHint")} onClick={() => commit(flipOpening(plan, opening.key))}>{t("panel.flip")}</button>}
    <p className={styles.hint}>{t("panel.openingHint")}</p>
    <button type="button" className={styles.danger} onClick={onDelete}>{t("panel.deleteOpening")}</button>
  </div>;
}

/** The side panel for one line: its style and thickness, the point picked on it, and the shared actions. */
export function LinePanel({ plan, line, locked, point, commit, onPointGone, actions, onDelete }: { plan: FloorPlan; line: PlanLine; locked: boolean; point: number | null; commit: (next: FloorPlan) => void; onPointGone: () => void; actions: ReactNode; onDelete: () => void }) {
  const t = useMessages(floorPlanMessages);
  const picked = point !== null && point < line.points.length ? point : null;
  return <div className={styles.panel} data-panel="line">
    <h5>{t("panel.line")}</h5>
    <label>{t("panel.lineStyle")}<select value={line.style} disabled={locked} onChange={event => commit(restyleLine(plan, line.key, { style: event.target.value as PlanLine["style"] }))}>{LINE_STYLES.map(style => <option key={style} value={style}>{t(`line.${style}`)}</option>)}</select></label>
    <label>{t("panel.thickness")}<select value={line.thickness ?? "m"} disabled={locked} onChange={event => commit(restyleLine(plan, line.key, { thickness: event.target.value as NonNullable<PlanLine["thickness"]> }))}>{LINE_THICKNESSES.map(size => <option key={size} value={size}>{t(`thickness.${size}`)}</option>)}</select></label>
    <p className={styles.hint}>{t("panel.lineHint")}</p>
    {picked !== null && <small role="status">{t("a11y.point", { number: picked + 1, count: line.points.length })}</small>}
    <button type="button" className={styles.tool} disabled={locked || picked === null || line.points.length <= 2} onClick={() => { if (picked === null) return; commit(removePoint(plan, line.key, picked)); onPointGone(); }}>{t("panel.deletePoint")}</button>
    {actions}
    <button type="button" className={styles.danger} disabled={locked} onClick={onDelete}>{t("panel.deleteLine")}</button>
  </div>;
}
