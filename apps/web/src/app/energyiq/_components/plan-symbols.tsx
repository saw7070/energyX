/**
 * Small symbols drawn on the floor plan, in plan units so they scale with the drawing. Their colours come from the
 * stylesheet passed in (light and dark, and each plan style), never from saved data, unless the reader chose a colour
 * for that item (a checked #rrggbb). The editor canvas and the shared map both draw labels and landmarks with these, so
 * they look the same in both and are only built once.
 */
import type { CSSProperties } from "react";
import { captionBaseline, captionFont, ENTRANCE_HEIGHT, ENTRANCE_WIDTH, isKnownSymbol, labelFont, symbolSize, type LabelSize, type SymbolKind } from "./floor-plan-marks";

/** A padlock: the item under it is locked in place. `x`, `y` is the badge's top-left corner; `size` its width. */
export function LockBadge({ x, y, size, className, label }: { x: number; y: number; size: number; className?: string; label: string }) {
  const s = size, body = s * 0.62, shackle = s * 0.38;
  return <g className={className} aria-label={label} role="img" pointerEvents="none">
    <title>{label}</title>
    <rect x={x} y={y} width={s} height={s} rx={s * 0.22} data-part="plate" />
    <path d={`M${x + s / 2 - shackle / 2} ${y + s * 0.5} V${y + s * 0.36} A${shackle / 2} ${shackle / 2} 0 0 1 ${x + s / 2 + shackle / 2} ${y + s * 0.36} V${y + s * 0.5}`} data-part="shackle" fill="none" strokeWidth={s * 0.09} />
    <rect x={x + (s - body) / 2} y={y + s * 0.46} width={body} height={s * 0.36} rx={s * 0.06} data-part="body" />
  </g>;
}

const ring = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`;
/**
 * Line icons on a 24 × 24 grid, drawn with strokes only (currentColor), so each reads at small sizes in every plan
 * style and in dark mode. The entrance keeps the arrow the plan has always drawn (see EntranceMark).
 */
export const SYMBOL_PATHS: Record<Exclude<SymbolKind, "entrance">, string> = {
  lift: "M5 2.5h14v19H5z M8.5 10 12 6l3.5 4z M8.5 14 12 18l3.5-4z",
  stairs: "M3 20.5h5v-5h4.5v-5H17V5.5h4",
  toilet: `${ring(6.5, 4.6, 1.8)} M6.5 8v12.5 M3.6 10.6h5.8 M12 3v18 ${ring(17.5, 4.6, 1.8)} M17.5 8l-3.1 7.5h6.2z M16.3 15.5v5 M18.7 15.5v5`,
  parking: "M4 3h16v18H4z M9.5 17V7h3.8a3 3 0 0 1 0 6H9.5",
  bin: "M4.5 6.5h15 M9 6.5V3.5h6v3 M6.5 6.5l1.1 14h8.8l1.1-14 M10 10v7.5 M14 10v7.5",
  lamp: "M8.5 21.5h7 M12 21.5V4.5 M12 4.5c0-1.4 1.2-2 2.6-2h2.2 M14.2 6.6h5.2l-1.3 2.6h-2.6z M16.8 2.5v4.1",
  tree: `${ring(12, 9, 6.2)} M12 15.2v6.3 M8.5 21.5h7 M12 18l-2.5-2.2`,
  playground: "M3.5 21.5 8 3.5h8l4.5 18 M10.3 3.5v10.5 M13.7 3.5v10.5 M9.3 14h5.4",
  shelter: "M2.5 9 12 3.5 21.5 9 M5 8v13.5 M19 8v13.5 M8 16h8 M8.8 16v3 M15.2 16v3",
  fireExit: "M13 2.5h7.5v19H13 M2.5 12h8 M7.5 8.5 11 12l-3.5 3.5 M16 12h1.5",
  switchRoom: "M5 2.5h14v19H5z M13.5 5.5 9 12.8h3.6L10.5 18.5 15 11.2h-3.6z",
  pump: "M12 2.5c3.2 4.2 6.2 7.4 6.2 11.3a6.2 6.2 0 0 1-12.4 0C5.8 9.9 8.8 6.7 12 2.5z M9 15.2c1 1 2 1 3 0s2-1 3 0",
  busStop: "M5 21.5V2.5 M5 2.5h14.5v10.5H5 M8 5.5h8.5v4.3H8z M9.4 11.6v.1 M15.1 11.6v.1",
  arrow: "M3 12h17 M14 5.5l6.5 6.5-6.5 6.5",
  north: "M12 2.5l6.5 19-6.5-4.4-6.5 4.4z M10.2 13.6V8.4l3.6 5.2V8.4",
};

/** A landmark icon on its own (for the picker and the panel), on its 24 × 24 grid; hidden from screen readers. */
export function SymbolIcon({ kind, className }: { kind: string; className?: string }) {
  return <svg viewBox="0 0 24 24" width="24" height="24" className={className} aria-hidden="true" focusable="false">
    {kind === "entrance" ? <path d="M3.5 19.5 12 4.5l8.5 15z" fill="currentColor" />
      : isKnownSymbol(kind) ? <path d={SYMBOL_PATHS[kind as Exclude<SymbolKind, "entrance">]} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      : <><circle cx={12} cy={12} r={7} fill="none" stroke="currentColor" strokeWidth={2} /><circle cx={12} cy={12} r={2.5} fill="currentColor" /></>}
  </svg>;
}

/** Classes for drawing marks: `mark` sets the ink (currentColor), `halo` the outline that keeps them clear of what is under them. */
export type MarkClasses = { mark: string; halo: string; text: string; entrance: string; entranceLabel: string };
const turn = (rotation: number | undefined, x: number, y: number) => rotation ? `rotate(${rotation} ${x} ${y})` : undefined;
const inked = (colour: string | undefined): CSSProperties | undefined => colour ? { color: colour } : undefined;

/** A free text label, its middle at `position`, turned with it. */
export function LabelMark({ text, position: [x, y], size, rotation, colour, bold, unit, classes }: { text: string; position: [number, number]; size?: LabelSize; rotation?: number; colour?: string; bold?: boolean; unit: number; classes: MarkClasses }) {
  const font = labelFont({ ...(size ? { size } : {}) }, unit);
  return <text x={x} y={y} textAnchor="middle" dominantBaseline="central" className={`${classes.mark} ${classes.text}`} transform={turn(rotation, x, y)} style={{ fontSize: font, fontWeight: bold ? 700 : 500, strokeWidth: font * 0.22, ...inked(colour) }}>{text}</text>;
}

/**
 * The entrance arrow, its tip at `position`, with its name under it. Unturned and at its usual size it is drawn exactly
 * as before landmarks existed (`legacy` gives where that name went and its text size), so old layouts look the same.
 */
export function EntranceMark({ position: [x, y], size, rotation, colour, label, unit, legacy, classes }: { position: [number, number]; size?: number; rotation?: number; colour?: string; label: string; unit: number; legacy: { offset: number; font: number }; classes: MarkClasses }) {
  const half = size === undefined ? unit * 1.4 : size / 2, height = size === undefined ? unit * 2.2 : size * ENTRANCE_HEIGHT / ENTRANCE_WIDTH;
  const plain = size === undefined && !rotation;
  const font = plain ? legacy.font : captionFont({ kind: "entrance", ...(size !== undefined ? { size } : {}) }, unit), at = plain ? y + legacy.offset : captionBaseline({ kind: "entrance", position: [x, y], ...(size !== undefined ? { size } : {}), ...(rotation ? { rotation } : {}) }, unit);
  return <g>
    <path d={`M${x - half},${y + height} L${x},${y} L${x + half},${y + height} Z`} className={classes.entrance} {...(rotation ? { transform: turn(rotation, x, y) } : {})} {...(colour ? { style: { fill: colour } } : {})} />
    <text x={x} y={at} textAnchor="middle" className={classes.entranceLabel} style={{ fontSize: font, ...(colour ? { fill: colour } : {}) }}>{label}</text>
  </g>;
}

/**
 * A landmark other than the entrance: its line icon `size` wide, its middle at `position` and turned with it, and its
 * caption under it, upright. A kind this version does not know is drawn as a plain dot.
 */
export function SymbolMark({ kind, position: [x, y], size, rotation, colour, label, unit, classes }: { kind: string; position: [number, number]; size?: number; rotation?: number; colour?: string; label?: string; unit: number; classes: MarkClasses }) {
  const width = symbolSize({ kind, ...(size !== undefined ? { size } : {}) }, unit), scale = width / 24;
  const known = isKnownSymbol(kind) && kind !== "entrance";
  // The halo (drawn first, wider) keeps the icon clear of walls and grid lines under it; the icon itself is in currentColor.
  const shape = (halo: boolean) => { const look = { fill: "none", ...(halo ? { className: classes.halo, strokeWidth: 5 } : { stroke: "currentColor", strokeWidth: 2 }) };
    return known ? <path d={SYMBOL_PATHS[kind as Exclude<SymbolKind, "entrance">]} {...look} strokeLinecap="round" strokeLinejoin="round" /> : <circle cx={12} cy={12} r={7} {...look} />; };
  const font = captionFont({ kind, ...(size !== undefined ? { size } : {}) }, unit);
  return <g className={classes.mark} style={inked(colour)} data-symbol={known ? kind : "other"}>
    <g transform={`translate(${x} ${y})${rotation ? ` rotate(${rotation})` : ""} scale(${scale}) translate(-12 -12)`}>
      {shape(true)}
      {shape(false)}
      {!known && <circle cx={12} cy={12} r={2.6} fill="currentColor" />}
    </g>
    {label && <text x={x} y={captionBaseline({ kind, position: [x, y], ...(size !== undefined ? { size } : {}), ...(rotation ? { rotation } : {}) }, unit)} textAnchor="middle" className={classes.text} style={{ fontSize: font, fontWeight: 600, strokeWidth: font * 0.22 }}>{label}</text>}
  </g>;
}
