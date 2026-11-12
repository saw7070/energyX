import type { CSSProperties } from "react";
import { innerBox, pointsAttribute, type SpatialPoint } from "@datafoundry/contracts";

type Box = [number, number, number, number];
/** Fill of a plain shape saved without one: a soft green, like grass on a site plan. */
export const PLAIN_SHAPE_FILL = "#9cc5a1";

/**
 * The drawing of a plain shape (a lawn, a driveway, a pond), shared by the layout editor and the map: a rectangle, a
 * circle, or an outline through `corners` (absolute plan units; a polygon without usable corners is drawn as its box).
 * The fill comes from the saved #rrggbb colour through `--shape`, so the stylesheet decides how strongly it shows in
 * each plan style and in dark mode. `stroke` is the outline style; the caption sits in the shape's largest part.
 */
export function PlainShapeBody({ kind, rect, corners, fill, stroke, label, unit, className, labelClassName }: { kind: "rect" | "ellipse" | "polygon"; rect: Box; corners: SpatialPoint[] | null | undefined; fill?: string | undefined; stroke?: "solid" | "dashed" | "none" | undefined; label?: string | undefined; unit: number; className?: string; labelClassName?: string }) {
  const [x, y, w, h] = rect, outline = kind === "polygon" && corners ? corners : null;
  const look = { className, "data-outline": stroke ?? "solid", style: { "--shape": fill ?? PLAIN_SHAPE_FILL } as CSSProperties, strokeWidth: unit * 0.2, ...(stroke === "dashed" ? { strokeDasharray: `${unit * 0.8} ${unit * 0.5}` } : {}) };
  const [lx, ly, lw, lh] = outline ? innerBox(outline) : rect, size = Math.max(unit * 0.6, Math.min(unit * 1.5, lw / 6)), text = label?.trim();
  return <>
    {kind === "ellipse" ? <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} {...look} /> : outline ? <polygon points={pointsAttribute(outline)} strokeLinejoin="round" {...look} /> : <rect x={x} y={y} width={w} height={h} {...look} />}
    {text && <text x={lx + lw / 2} y={ly + lh / 2 + size * 0.35} textAnchor="middle" className={labelClassName} style={{ fontSize: size }}>{text}</text>}
  </>;
}
