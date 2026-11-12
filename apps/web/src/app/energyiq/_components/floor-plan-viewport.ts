"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { isButton, isTextEntry } from "./floor-plan-keys";
import type { Point, Rect } from "./floor-plan-model";
import { actualZoom, fractionIn, panBy, planPoint, rememberedView, rememberView, revealBox, sameView, settleView, wheelZoomFactor, windowOf, zoomAround, zoomKeeping, zoomOf, zoomPercent, ZOOM_STEP, type PlanView } from "./floor-plan-zoom";

/** The width of an element in CSS pixels as it changes (0 until known, e.g. where nothing is laid out). */
export function useElementWidth(ref: RefObject<Element | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = (next: number) => setWidth(current => Math.abs(current - next) < 0.5 ? current : next);
    measure(element.getBoundingClientRect?.().width ?? 0);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(entries => { const entry = entries[entries.length - 1]; if (entry) measure(entry.contentRect.width); });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

const COARSE = "(pointer: coarse)";
const coarseNow = () => { try { return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(COARSE).matches; } catch { return false; } };
const watchCoarse = (changed: () => void) => {
  try {
    const query = window.matchMedia(COARSE);
    query.addEventListener?.("change", changed);
    return () => query.removeEventListener?.("change", changed);
  } catch { return () => undefined; }
};
/** Whether the main pointer is a finger (a phone or tablet): grips are then drawn bigger. */
export const useCoarsePointer = () => useSyncExternalStore(watchCoarse, coarseNow, () => false);

type Gesture =
  | { kind: "pan"; id: number; start: Point; matrix: DOMMatrix; window: Rect; view: PlanView }
  | { kind: "pinch"; ids: [number, number]; distance: number; anchor: Point; matrix: DOMMatrix; window: Rect; zoom: number };
const midpoint = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/**
 * Zoom and pan for the layout editor: the + and − buttons, Fit plan and 100%, Ctrl/⌘ + wheel or a trackpad pinch around
 * the pointer, the plain wheel to move around a zoomed-in plan, Space-drag or middle-drag, and a two-finger pinch on a
 * touch screen (which also pans). Only the SVG's viewBox window changes. Gestures are handled in the capture phase, so
 * a pinch or a pan never also drags an item (`onGestureStart` lets the editor drop a drag it had begun).
 */
export function usePlanViewport({ svgRef, viewBox, projectId, onGestureStart }: { svgRef: RefObject<SVGSVGElement | null>; viewBox: Rect; projectId: string; onGestureStart: () => void }) {
  const width = useElementWidth(svgRef);
  const fitPx = width > 0 ? width / viewBox[2] : 0;
  const [stored, setStored] = useState<PlanView>(() => rememberedView(projectId));
  const [vx, vy, vw, vh] = viewBox;
  const view = useMemo(() => settleView([vx, vy, vw, vh], stored, fitPx), [vx, vy, vw, vh, stored, fitPx]);
  const shown = useMemo(() => windowOf([vx, vy, vw, vh], view), [vx, vy, vw, vh, view]);
  // What the handlers measure against: the latest view (several wheel steps can arrive before a redraw) and the window
  // that is in the page now (what the screen matrix describes).
  const latest = useRef({ view, viewBox, fitPx, shown });
  useLayoutEffect(() => { latest.current = { view, viewBox, fitPx, shown }; });
  const apply = useCallback((next: PlanView) => {
    const { view: current, viewBox: box, fitPx: fit } = latest.current, settled = settleView(box, next, fit);
    if (sameView(settled, current)) return false;
    latest.current.view = settled; setStored(settled); return true;
  }, []);
  useEffect(() => { rememberView(projectId, view); }, [projectId, view]);

  /** Where a screen point is across and down the editor (0..1), whatever the view. */
  const fractionAt = useCallback((clientX: number, clientY: number): Point => { const point = planPoint(svgRef.current, clientX, clientY); return point ? fractionIn(latest.current.shown, point) : [0.5, 0.5]; }, [svgRef]);
  const zoomBy = useCallback((factor: number, fraction: Point = [0.5, 0.5]) => { const { view: current, viewBox: box, fitPx: fit } = latest.current; return apply(zoomAround(box, current, zoomOf(current) * factor, fraction, fit)); }, [apply]);
  const zoomIn = useCallback(() => zoomBy(ZOOM_STEP), [zoomBy]), zoomOut = useCallback(() => zoomBy(1 / ZOOM_STEP), [zoomBy]);
  const fit = useCallback(() => apply(null), [apply]);
  const actual = useCallback(() => { const { view: current, viewBox: box, fitPx: fit } = latest.current; return apply(zoomAround(box, current, actualZoom(fit), [0.5, 0.5], fit)); }, [apply]);
  const reveal = useCallback((box: Rect) => { const { view: current, viewBox: plan, fitPx: fit } = latest.current; apply(revealBox(plan, current, box, fit)); }, [apply]);

  // The wheel needs a listener that can stop the page scrolling (React's is passive). Ctrl/⌘ + wheel and a trackpad
  // pinch zoom around the pointer and never zoom the browser; the plain wheel moves around a zoomed-in plan, and scrolls
  // the page as usual once the plan is at its edge (or shown whole).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) { event.preventDefault(); zoomBy(wheelZoomFactor(event.deltaY, event.deltaMode), fractionAt(event.clientX, event.clientY)); return; }
      const { view: current, viewBox: box, fitPx: fit, shown: inPage } = latest.current;
      if (!current || current.z <= 1) return;
      const scale = (svg.getScreenCTM()?.a || 1) * inPage[2] / windowOf(box, current)[2], lines = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
      const dx = (event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX) * lines / scale, dy = (event.shiftKey && !event.deltaX ? 0 : event.deltaY) * lines / scale;
      if (apply(panBy(box, current, dx, dy, fit))) event.preventDefault();
    };
    // Safari reports a trackpad pinch as gesture events: zoom with them, and keep the page itself from zooming.
    let pinchFrom = 1, pinchAt: Point = [0.5, 0.5];
    const gestureStart = (event: Event) => { event.preventDefault(); pinchFrom = zoomOf(latest.current.view); const at = event as unknown as { clientX?: number; clientY?: number }; pinchAt = typeof at.clientX === "number" && typeof at.clientY === "number" ? fractionAt(at.clientX, at.clientY) : [0.5, 0.5]; };
    const gestureChange = (event: Event) => { event.preventDefault(); const scale = (event as unknown as { scale?: number }).scale; if (typeof scale === "number" && Number.isFinite(scale) && scale > 0) { const { view: current, viewBox: box, fitPx: fit } = latest.current; apply(zoomAround(box, current, pinchFrom * scale, pinchAt, fit)); } };
    svg.addEventListener("wheel", wheel, { passive: false });
    svg.addEventListener("gesturestart", gestureStart);
    svg.addEventListener("gesturechange", gestureChange);
    return () => { svg.removeEventListener("wheel", wheel); svg.removeEventListener("gesturestart", gestureStart); svg.removeEventListener("gesturechange", gestureChange); };
  }, [svgRef, apply, zoomBy, fractionAt]);

  // Space held down while the plan has focus turns a drag into moving around (like most drawing tools).
  const space = useRef(false);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const holdSpace = useCallback((held: boolean) => { space.current = held; setSpaceHeld(held); }, []);
  useEffect(() => { const release = () => { if (space.current) holdSpace(false); }; window.addEventListener("blur", release); return () => window.removeEventListener("blur", release); }, [holdSpace]);
  // While Space is held, letting it go anywhere (focus may have left the editor meanwhile) or hiding the page ends it,
  // so a later press on the plan never pans by mistake.
  useEffect(() => {
    if (!spaceHeld) return;
    const up = (event: KeyboardEvent) => { if (event.key === " " || event.key === "Spacebar") holdSpace(false); };
    const hidden = () => { if (document.visibilityState === "hidden") holdSpace(false); };
    window.addEventListener("keyup", up, true);
    document.addEventListener("visibilitychange", hidden);
    return () => { window.removeEventListener("keyup", up, true); document.removeEventListener("visibilitychange", hidden); };
  }, [spaceHeld, holdSpace]);
  const keyDown = (event: ReactKeyboardEvent) => {
    if (event.key !== " " || event.metaKey || event.ctrlKey || event.altKey || isTextEntry(event.target) || isButton(event.target) || !svgRef.current?.contains(event.target as Node)) return false;
    event.preventDefault();
    if (!space.current) holdSpace(true);
    return true;
  };
  const keyUp = (event: ReactKeyboardEvent) => { if (event.key === " " && space.current) holdSpace(false); };

  const touches = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const [panning, setPanning] = useState(false);
  const beginPinch = () => {
    const svg = svgRef.current, matrix = svg?.getScreenCTM();
    const [a, b] = [...touches.current.entries()];
    if (!svg || !matrix || !a || !b) return false;
    const mid = midpoint(a[1], b[1]), anchor = planPoint(svg, mid[0], mid[1], matrix);
    if (!anchor) return false;
    onGestureStart();
    gesture.current = { kind: "pinch", ids: [a[0], b[0]], distance: Math.max(1, Math.hypot(a[1][0] - b[1][0], a[1][1] - b[1][1])), anchor, matrix, window: latest.current.shown, zoom: zoomOf(latest.current.view) };
    return true;
  };
  const onPointerDownCapture = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.pointerType === "touch") {
      // A first finger down means no other finger is on the screen (one lifted outside the plan is forgotten).
      if (event.isPrimary) { touches.current.clear(); if (gesture.current?.kind === "pinch") gesture.current = null; }
      touches.current.set(event.pointerId, [event.clientX, event.clientY]);
    }
    if (gesture.current?.kind === "pinch") { event.stopPropagation(); return; }
    if (event.pointerType === "touch" && touches.current.size === 2) { if (beginPinch()) { svgRef.current?.setPointerCapture?.(event.pointerId); event.stopPropagation(); event.preventDefault(); } return; }
    if (event.button !== 1 && !(space.current && event.button === 0)) return;
    // Middle button, or Space + drag: move around the plan instead of selecting or moving what is under the pointer.
    const matrix = svgRef.current?.getScreenCTM();
    event.stopPropagation(); event.preventDefault();
    if (!matrix) return;
    svgRef.current?.setPointerCapture?.(event.pointerId);
    gesture.current = { kind: "pan", id: event.pointerId, start: [event.clientX, event.clientY], matrix, window: latest.current.shown, view: latest.current.view };
    setPanning(true);
  };
  const onPointerMoveCapture = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.pointerType === "touch" && touches.current.has(event.pointerId)) touches.current.set(event.pointerId, [event.clientX, event.clientY]);
    const current = gesture.current, svg = svgRef.current;
    if (!current || !svg) return;
    if (current.kind === "pan") {
      if (event.pointerId !== current.id) return;
      event.stopPropagation();
      const from = planPoint(svg, current.start[0], current.start[1], current.matrix), to = planPoint(svg, event.clientX, event.clientY, current.matrix);
      if (!from || !to || !current.view) return;
      const { viewBox: box, fitPx: fit } = latest.current;
      apply(settleView(box, { z: current.view.z, x: current.window[0] - (to[0] - from[0]), y: current.window[1] - (to[1] - from[1]) }, fit));
      return;
    }
    if (!current.ids.includes(event.pointerId)) return;
    event.stopPropagation();
    const a = touches.current.get(current.ids[0]), b = touches.current.get(current.ids[1]);
    if (!a || !b) return;
    // Two fingers: spreading zooms, moving both pans. The plan point first between them stays between them.
    const mid = midpoint(a, b), at = planPoint(svg, mid[0], mid[1], current.matrix);
    if (!at) return;
    const { viewBox: box, fitPx: fit } = latest.current;
    apply(zoomKeeping(box, current.anchor, current.zoom * Math.hypot(a[0] - b[0], a[1] - b[1]) / current.distance, fractionIn(current.window, at), fit));
  };
  const onPointerEndCapture = (event: ReactPointerEvent<SVGSVGElement>) => {
    touches.current.delete(event.pointerId);
    const current = gesture.current;
    if (!current) return;
    if (current.kind === "pan" ? current.id === event.pointerId : current.ids.includes(event.pointerId)) {
      event.stopPropagation();
      if (current.kind === "pinch") { gesture.current = null; return; }
      gesture.current = null; setPanning(false);
      svgRef.current?.releasePointerCapture?.(event.pointerId);
    } else if (current.kind === "pinch") event.stopPropagation();
  };
  /** A middle click never opens the browser's own scrolling or a link. */
  const onAuxClick = (event: React.MouseEvent) => { if (event.button === 1) event.preventDefault(); };

  return {
    view, window: shown, zoom: zoomOf(view), percent: zoomPercent(view, fitPx), fitPx, zoomIn, zoomOut, fit, actual, zoomBy, reveal, keyDown, keyUp, panning, spaceHeld,
    handlers: { onPointerDownCapture, onPointerMoveCapture, onPointerUpCapture: onPointerEndCapture, onPointerCancelCapture: onPointerEndCapture, onAuxClick },
  };
}
