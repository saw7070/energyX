/**
 * How doors, windows, openings and walls are drawn, the same on the site's floor map and in the layout editor, in plan
 * units so they scale with the drawing. Colours come from the stylesheet classes passed in (each plan style and dark
 * mode set their own tokens), never from saved data.
 */
import { lineWidth, openingSpan, type SpatialLineStyle, type SpatialLineThickness, type SpatialOpening } from "@datafoundry/contracts";

type P = [number, number];
type Rect = [number, number, number, number];
/** `gap` hides the room's wall under the opening, `leaf` and `swing` draw a door, `window` a window's glazing lines. */
export type OpeningClasses = { gap: string; leaf: string; swing: string; window: string };
export type LineClasses = Record<SpatialLineStyle, string>;

/** A door leaf from its hinge, and the dashed arc its free edge sweeps, as on a floor plan. */
function leaf(hinge: P, free: P, toward: P, size: number) {
  const tip: P = [hinge[0] + toward[0] * size, hinge[1] + toward[1] * size];
  const cross = (free[0] - hinge[0]) * (tip[1] - hinge[1]) - (free[1] - hinge[1]) * (tip[0] - hinge[0]);
  return { tip, arc: `M${free[0]} ${free[1]} A${size} ${size} 0 0 ${cross > 0 ? 1 : 0} ${tip[0]} ${tip[1]}` };
}

/**
 * One opening in a room's wall. `swings` draws door leaves and their swing (the building drawing and blueprint looks);
 * without it a door shows as a plain gap, as the colour blocks look does. A window is three thin lines along the wall.
 */
export function OpeningSymbol({ rect, opening, unit, swings, classes, gapWidth }: { rect: Rect; opening: Pick<SpatialOpening, "wall" | "offset" | "width" | "kind" | "swing" | "hinge">; unit: number; swings: boolean; classes: OpeningClasses; gapWidth: number }) {
  const { a, b, inward, width } = openingSpan(rect, opening);
  if (width <= 0) return null;
  const toward: P = opening.swing === "out" ? [-inward[0], -inward[1]] : inward;
  const gap = <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} className={classes.gap} strokeWidth={gapWidth} />;
  if (opening.kind === "window") {
    const k = unit * 0.2;
    return <>{gap}{[-k, 0, k].map(shift => <line key={shift} x1={a[0] + inward[0] * shift} y1={a[1] + inward[1] * shift} x2={b[0] + inward[0] * shift} y2={b[1] + inward[1] * shift} className={classes.window} strokeWidth={unit * 0.07} />)}</>;
  }
  if (opening.kind === "opening" || !swings) {
    // A plain gap, with a short jamb at each side in the drawn looks.
    const j = unit * 0.45;
    return <>{gap}{swings && [a, b].map((end, index) => <line key={index} x1={end[0] - inward[0] * j} y1={end[1] - inward[1] * j} x2={end[0] + inward[0] * j} y2={end[1] + inward[1] * j} className={classes.leaf} strokeWidth={unit * 0.14} />)}</>;
  }
  const leaves = opening.kind === "double"
    ? [{ hinge: a, free: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as P, size: width / 2 }, { hinge: b, free: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as P, size: width / 2 }]
    : [opening.hinge === "end" ? { hinge: b, free: a, size: width } : { hinge: a, free: b, size: width }];
  return <>{gap}{leaves.map(({ hinge, free, size }, index) => { const drawn = leaf(hinge, free, toward, size); return <g key={index}>
    <line x1={hinge[0]} y1={hinge[1]} x2={drawn.tip[0]} y2={drawn.tip[1]} className={classes.leaf} strokeWidth={unit * 0.14} />
    <path d={drawn.arc} className={classes.swing} strokeWidth={unit * 0.08} strokeDasharray={`${unit * 0.35} ${unit * 0.25}`} />
  </g>; })}</>;
}

/** A wall (thick), partition (thin), fence (dashed) or road edge drawn through its points. */
export function LineSymbol({ points, style, thickness, unit, classes }: { points: P[]; style: SpatialLineStyle; thickness?: SpatialLineThickness; unit: number; classes: LineClasses }) {
  return <polyline points={points.map(point => point.join(",")).join(" ")} className={classes[style]} fill="none" strokeWidth={lineWidth(style, thickness) * unit} strokeLinecap={style === "fence" ? "butt" : "round"} strokeLinejoin="round" {...(style === "fence" ? { strokeDasharray: `${unit * 0.9} ${unit * 0.55}` } : {})} />;
}
