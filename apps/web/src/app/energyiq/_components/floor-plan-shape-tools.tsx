"use client";
/**
 * The layout editor's free-shape controls: the shape choices when adding an area, room or plain shape, the corner grips
 * on a selected shape, a shape being drawn corner by corner, the Corners panel, and the panel of a plain shape.
 */
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useMessages } from "./energyiq-locale";
import type { FloorPlan, Point, Selection } from "./floor-plan-model";
import { SHAPE_LABEL_MAX, SHAPE_OUTLINE_STYLES, type PlanShape, type ShapeOutline } from "./floor-plan-plain-shapes";
import { presetOutline, pointsText, SHAPE_PRESETS, type Outlined, type ShapeChoice, type ShapePreset } from "./floor-plan-polygon";
import { shapeMessages } from "./floor-plan-shape-messages";
import styles from "./floor-plan-editor.module.css";

/** What the shape choices offer: the presets, a circle for a plain shape, and drawing the corners. */
export type ShapePick = ShapeChoice | "ellipse";
/** The tools that take a shape. */
export type ShapedTool = "area" | "room" | "shape";

/** The plan with one area, room or plain shape changed by `change` (null leaves the plan as it is). */
export function withOutlined(plan: FloorPlan, item: Selection, change: <T extends Outlined>(entry: T) => T | null): FloorPlan {
  if (item.kind === "area") { const entry = plan.areas.find(area => area.key === item.key), next = entry && change(entry); return next ? { ...plan, areas: plan.areas.map(area => area === entry ? next : area) } : plan; }
  if (item.kind === "room") { const entry = plan.rooms.find(room => room.key === item.key), next = entry && change(entry); return next ? { ...plan, rooms: plan.rooms.map(room => room === entry ? next : room) } : plan; }
  if (item.kind === "shape") { const entry = plan.shapes?.find(shape => shape.key === item.key), next = entry && change(entry); return next ? { ...plan, shapes: plan.shapes!.map(shape => shape === entry ? next : shape) } : plan; }
  return plan;
}
/** The selected item's box and shape, when it is one whose corners can be edited (a stand-alone area, a room or a plain outline). */
export function outlinedItem(plan: FloorPlan, item: Selection | null): Outlined | null {
  if (!item) return null;
  if (item.kind === "area") return plan.areas.find(area => area.key === item.key && !area.insideRoom) ?? null;
  if (item.kind === "room") return plan.rooms.find(room => room.key === item.key) ?? null;
  if (item.kind === "shape") return plan.shapes?.find(shape => shape.key === item.key && shape.kind === "polygon") ?? null;
  return null;
}

/** A small picture of a shape choice, drawn in a 16 × 16 box. */
function PresetIcon({ pick }: { pick: ShapePick }) {
  const outline = pick === "rect" || pick === "draw" || pick === "ellipse" ? null : presetOutline(pick);
  return <svg viewBox="0 0 16 16" className={styles.presetIcon} aria-hidden="true">
    {pick === "ellipse" ? <ellipse cx="8" cy="8" rx="6.5" ry="6.5" /> : pick === "draw" ? <polyline points="2,13 5,3 11,6 14,13" strokeDasharray="2 1.5" /> : outline ? <polygon points={pointsText(outline.map(([x, y]) => [1.5 + x * 13, 1.5 + y * 13] as Point))} /> : <rect x="1.5" y="3" width="13" height="10" />}
  </svg>;
}
/** The shape choices shown while adding an area, a room or a plain shape. */
export function ShapeChoices({ tool, value, onChange }: { tool: ShapedTool; value: ShapePick; onChange: (pick: ShapePick) => void }) {
  const s = useMessages(shapeMessages);
  const picks: ShapePick[] = [...SHAPE_PRESETS.slice(0, 1), ...(tool === "shape" ? ["ellipse" as const] : []), ...SHAPE_PRESETS.slice(1), "draw"];
  return <div className={styles.presets} role="group" aria-label={s("preset.legend")}>
    <span>{s("preset.legend")}</span>
    {picks.map(pick => <button key={pick} type="button" className={styles.tool} aria-pressed={value === pick} onClick={() => onChange(pick)}><PresetIcon pick={pick} />{s(`preset.${pick}`)}</button>)}
  </div>;
}

/**
 * Grips on each corner of the selected shape, and a wide invisible line along each side: drag a grip to move that
 * corner, double-click a side to add a corner there. `size` is a grip's width in plan units.
 */
export function CornerGrips({ corners, picked, size, onCorner, onSide, onSideDown }: { corners: Point[]; picked: number | null; size: number; onCorner: (event: ReactPointerEvent, index: number) => void; onSide: (index: number, at: { clientX: number; clientY: number }) => void; onSideDown: (event: ReactPointerEvent) => void }) {
  const s = useMessages(shapeMessages);
  return <g data-corners={corners.length}>
    {corners.map((corner, index) => { const next = corners[(index + 1) % corners.length]!; return <line key={`side${index}`} data-side={index} x1={corner[0]} y1={corner[1]} x2={next[0]} y2={next[1]} className={styles.side} style={{ strokeWidth: size }} onPointerDown={onSideDown} onDoubleClick={event => { event.stopPropagation(); onSide(index, event); }} />; })}
    {corners.map((corner, index) => <circle key={`corner${index}`} data-corner={index} role="img" aria-label={s("corners.corner", { number: index + 1 })} cx={corner[0]} cy={corner[1]} r={size / 2} className={`${styles.corner} ${picked === index ? styles.cornerPicked : ""}`} onPointerDown={event => onCorner(event, index)} />)}
  </g>;
}
/** A shape being drawn: the corners so far and a line to the pointer, closed back to the first corner. */
export function DrawPreview({ corners, hover, size }: { corners: Point[]; hover: Point | null; size: number }) {
  const all = hover ? [...corners, hover] : corners;
  return <g data-drawing={corners.length} pointerEvents="none">
    {all.length > 1 && <polygon points={pointsText(all)} className={styles.drawLine} />}
    {corners.map((corner, index) => <circle key={index} cx={corner[0]} cy={corner[1]} r={size / 2} className={styles.drawCorner} />)}
  </g>;
}

/** The Corners part of the side panel: which corner is picked, Delete corner and Make rectangle. */
export function CornerPanel({ count, picked, disabled, onDelete, onRectangle }: { count: number; picked: number | null; disabled: boolean; onDelete: () => void; onRectangle: () => void }) {
  const s = useMessages(shapeMessages);
  return <div className={styles.cornerPanel} role="group" aria-label={s("corners.title")}>
    <p className={styles.hint}><strong>{s("corners.title")}.</strong> {s("corners.hint")} {picked !== null && picked < count ? s("corners.picked", { number: picked + 1, count }) : s("corners.pick")}</p>
    <div className={styles.cornerActions}>
      <button type="button" className={styles.tool} disabled={disabled || picked === null || picked >= count} onClick={onDelete}>{s("corners.delete")}</button>
      <button type="button" className={styles.tool} disabled={disabled} onClick={onRectangle}>{s("corners.makeRectangle")}</button>
    </div>
  </div>;
}
/** "Shape: Rectangle / L-shape / U-shape / T-shape" for an area, room or plain shape; an outline drawn by hand shows as its own choice. */
export function ShapeSelect({ value, circle = false, disabled, onChange }: { value: ShapePreset | "ellipse" | "custom"; circle?: boolean; disabled: boolean; onChange: (pick: ShapePreset | "ellipse") => void }) {
  const s = useMessages(shapeMessages);
  return <label>{s("preset.legend")}<select value={value} disabled={disabled} onChange={event => onChange(event.target.value as ShapePreset | "ellipse")}>
    <option value="rect">{s("preset.rect")}</option>{circle && <option value="ellipse">{s("preset.ellipse")}</option>}
    {SHAPE_PRESETS.slice(1).map(preset => <option key={preset} value={preset}>{s(`preset.${preset}`)}</option>)}
    {value === "custom" && <option value="custom" disabled>{s("preset.custom")}</option>}
  </select></label>;
}

/** The side panel of a plain shape: its caption, shape, fill, outline style, then the shared actions and Delete. */
export function PlainShapePanel({ shape, disabled, shapeValue, typing, onCaption, onShape, onOutline, colourPicker, position, actions, onDelete }: { shape: PlanShape; disabled: boolean; shapeValue: ShapePreset | "ellipse" | "custom"; typing: { onBlur: () => void; onKeyDown: (event: React.KeyboardEvent) => void }; onCaption: (text: string) => void; onShape: (pick: ShapePreset | "ellipse") => void; onOutline: (outline: ShapeOutline) => void; colourPicker: ReactNode; position: ReactNode; actions: ReactNode; onDelete: () => void }) {
  const s = useMessages(shapeMessages);
  return <div className={styles.panel}>
    <h5>{s("shape.title")}</h5>
    <p className={styles.hint}>{s("shape.hint")}</p>
    <label>{s("shape.caption")}<input value={shape.label ?? ""} maxLength={SHAPE_LABEL_MAX} placeholder={s("shape.captionExample")} {...typing} onChange={event => onCaption(event.target.value)} /></label>
    <ShapeSelect value={shapeValue} circle disabled={disabled} onChange={onShape} />
    {position}
    {colourPicker}
    <label>{s("shape.outline")}<select value={shape.stroke ?? "solid"} onChange={event => onOutline(event.target.value as ShapeOutline)}>{SHAPE_OUTLINE_STYLES.map(style => <option key={style} value={style}>{s(`outline.${style}`)}</option>)}</select></label>
    {actions}
    <button type="button" className={styles.danger} disabled={disabled} onClick={onDelete}>{s("shape.delete")}</button>
  </div>;
}
