import type { Point, Rect } from "./floor-plan-model";

/**
 * How the layout editor looks at the plan. `null` shows the whole plan ("Fit plan"); otherwise the editor is `z` times
 * closer than that, with the top-left corner of what it shows at (x, y) in plan units. Zooming only moves this window
 * (the editor SVG's viewBox): the plan's own coordinates never change, and the view is never saved with the layout.
 */
export type PlanView = { z: number; x: number; y: number } | null;
/** Furthest out (a quarter of the fitted size) and how much one press of + or − zooms. */
export const MIN_ZOOM = 0.25, ZOOM_STEP = 1.25;
/** Closest in: 800% (eight screen pixels per plan unit), and never less than eight times the fitted size. */
const MAX_ACTUAL = 8, MAX_FIT = 8;
export const maxZoom = (fitPx: number) => Math.max(MAX_FIT, fitPx > 0 ? MAX_ACTUAL / fitPx : MAX_FIT);
export const zoomOf = (view: PlanView) => view?.z ?? 1;
const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), Math.max(low, high));

/**
 * The part of the plan on screen: the same shape as the plan, so the editor keeps its size on the page. Zoomed in, it
 * stays inside the plan; zoomed out, the plan sits in the middle.
 */
export function windowOf(viewBox: Rect, view: PlanView): Rect {
  if (!view) return viewBox;
  const [vx, vy, vw, vh] = viewBox, w = vw / view.z, h = vh / view.z;
  if (view.z <= 1) return [vx + (vw - w) / 2, vy + (vh - h) / 2, w, h];
  return [clamp(view.x, vx, vx + vw - w), clamp(view.y, vy, vy + vh - h), w, h];
}
/** The view kept within its limits; back to "whole plan" (null) when it is that again. */
export function settleView(viewBox: Rect, view: PlanView, fitPx: number): PlanView {
  if (!view || ![view.z, view.x, view.y].every(Number.isFinite)) return null;
  const z = clamp(view.z, MIN_ZOOM, maxZoom(fitPx));
  if (Math.abs(z - 1) < 0.005) return null;
  const [x, y] = windowOf(viewBox, { z, x: view.x, y: view.y });
  return { z, x, y };
}
/** Zoomed to `z` with the plan point `anchor` shown at `fraction` (0..1 across and down) of the editor. */
export function zoomKeeping(viewBox: Rect, anchor: Point, z: number, fraction: Point, fitPx: number): PlanView {
  const nz = clamp(z, MIN_ZOOM, maxZoom(fitPx)), w = viewBox[2] / nz, h = viewBox[3] / nz;
  return settleView(viewBox, { z: nz, x: anchor[0] - fraction[0] * w, y: anchor[1] - fraction[1] * h }, fitPx);
}
/** Zoomed to `z` around a point of the editor (the pointer, or the middle): what is under it stays under it. */
export function zoomAround(viewBox: Rect, view: PlanView, z: number, fraction: Point, fitPx: number): PlanView {
  const [wx, wy, ww, wh] = windowOf(viewBox, view);
  return zoomKeeping(viewBox, [wx + fraction[0] * ww, wy + fraction[1] * wh], z, fraction, fitPx);
}
/** Moved by (dx, dy) plan units. Only a zoomed-in view moves: the whole plan is already on screen otherwise. */
export function panBy(viewBox: Rect, view: PlanView, dx: number, dy: number, fitPx: number): PlanView {
  if (!view || view.z <= 1) return view;
  const [wx, wy] = windowOf(viewBox, view);
  return settleView(viewBox, { z: view.z, x: wx + dx, y: wy + dy }, fitPx);
}
/** Moved just enough to show `box` (centred on it when it is off screen), at the same zoom. */
export function revealBox(viewBox: Rect, view: PlanView, [bx, by, bw, bh]: Rect, fitPx: number): PlanView {
  if (!view || view.z <= 1) return view;
  const [wx, wy, ww, wh] = windowOf(viewBox, view);
  if (bx >= wx && by >= wy && bx + bw <= wx + ww && by + bh <= wy + wh) return view;
  return settleView(viewBox, { z: view.z, x: bx + bw / 2 - ww / 2, y: by + bh / 2 - wh / 2 }, fitPx);
}
export const sameView = (a: PlanView, b: PlanView) => a === b || (!!a && !!b && a.z === b.z && a.x === b.x && a.y === b.y);
/** The zoom as people read it: screen pixels per plan unit, as a percentage (fitted size × zoom when the width is unknown). */
export const zoomPercent = (view: PlanView, fitPx: number) => Math.round(zoomOf(view) * (fitPx > 0 ? fitPx : 1) * 100);
/** The zoom that shows one plan unit on one screen pixel. */
export const actualZoom = (fitPx: number) => fitPx > 0 ? 1 / fitPx : 1;
/** How much one wheel turn (or a trackpad pinch step, which arrives as a wheel with Ctrl) zooms. */
export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
  const pixels = deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? 400 : 1);
  return Math.exp(-clamp(pixels, -60, 60) * 0.005);
}

type ScreenMatrix = { inverse(): DOMMatrix } | DOMMatrix;
/**
 * The one place a pointer's screen position becomes a plan point: through the SVG's screen matrix, which already
 * includes the zoom window, so dragging, resizing, guides, the selection box, drawing and placing are right at any zoom.
 * Pass the matrix taken when a gesture began to measure against the view as it was then.
 */
export function planPoint(svg: SVGSVGElement | null, clientX: number, clientY: number, matrix: ScreenMatrix | null = svg?.getScreenCTM() ?? null): Point | null {
  if (!matrix) return null;
  const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
  return Number.isFinite(point.x) && Number.isFinite(point.y) ? [point.x, point.y] : null;
}
/** Where a plan point sits across and down `window` (0..1). */
export const fractionIn = ([wx, wy, ww, wh]: Rect, [px, py]: Point): Point => [ww > 0 ? (px - wx) / ww : 0.5, wh > 0 ? (py - wy) / wh : 0.5];

/** The last view per project is remembered in this browser only (a convenience; it can be missing or blocked). */
const viewKey = (projectId: string) => `energyiq.floorPlanView.${projectId}`;
export function rememberedView(projectId: string): PlanView {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(viewKey(projectId)) ?? "null");
    if (!value || typeof value !== "object") return null;
    const { z, x, y } = value as Record<string, unknown>;
    return typeof z === "number" && typeof x === "number" && typeof y === "number" && [z, x, y].every(Number.isFinite) && z >= MIN_ZOOM && z <= 1000 ? { z, x, y } : null;
  } catch { return null; }
}
export function rememberView(projectId: string, view: PlanView): void {
  try { if (view) window.localStorage.setItem(viewKey(projectId), JSON.stringify(view)); else window.localStorage.removeItem(viewKey(projectId)); } catch { /* per-browser convenience only */ }
}
