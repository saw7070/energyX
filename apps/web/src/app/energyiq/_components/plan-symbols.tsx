/**
 * Small symbols drawn on the floor plan, in plan units so they scale with the drawing. Their colours come from the
 * stylesheet passed in (light and dark), never from saved data.
 */

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
