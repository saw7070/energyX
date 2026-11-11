/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from "vitest";
import { clearAllPlanDrafts, draftKey, DRAFT_MAX_AGE, fingerprint, readDraft } from "./floor-plan-draft";
import { planShortcut } from "./floor-plan-keys";
import type { Rect } from "./floor-plan-model";
import { actualZoom, fractionIn, maxZoom, MIN_ZOOM, panBy, planPoint, rememberedView, rememberView, revealBox, settleView, wheelZoomFactor, windowOf, zoomAround, zoomKeeping, zoomPercent } from "./floor-plan-zoom";

afterEach(() => localStorage.clear());
const plan: Rect = [0, 0, 1000, 640];

describe("the zoom window", () => {
  it("shows the whole plan when not zoomed, stays inside the plan zoomed in, and centres it zoomed out", () => {
    expect(windowOf(plan, null)).toEqual(plan);
    expect(windowOf(plan, { z: 2, x: 900, y: -50 })).toEqual([500, 0, 500, 320]);
    expect(windowOf(plan, { z: 0.5, x: 123, y: 456 })).toEqual([-500, -320, 2000, 1280]);
    // Back to "whole plan" at 1, and kept within its limits otherwise.
    expect(settleView(plan, { z: 1.001, x: 0, y: 0 }, 1)).toBeNull();
    expect(settleView(plan, { z: 0.01, x: 0, y: 0 }, 1)!.z).toBe(MIN_ZOOM);
    expect(settleView(plan, { z: 500, x: 0, y: 0 }, 1)!.z).toBe(maxZoom(1));
    expect(settleView(plan, { z: Number.NaN, x: 0, y: 0 }, 1)).toBeNull();
    // 800% at most, and never less than eight times the fitted size (so a huge plan can still be zoomed into).
    expect(maxZoom(1)).toBe(8);
    expect(maxZoom(0.08)).toBeCloseTo(100);
  });

  it("keeps the point under the pointer where it is while zooming, and pinches around the first point between the fingers", () => {
    // The pointer is a quarter across and half down: plan point (250, 320) stays there.
    const zoomed = zoomAround(plan, null, 2, [0.25, 0.5], 1)!;
    const [x, y, w, h] = windowOf(plan, zoomed);
    expect([x + 0.25 * w, y + 0.5 * h]).toEqual([250, 320]);
    // Zooming out again around the same point lands back on the whole plan.
    expect(zoomAround(plan, zoomed, 1, [0.25, 0.5], 1)).toBeNull();
    // A pinch: plan point (500, 300) first between the fingers is now 60% across.
    const pinched = zoomKeeping(plan, [500, 300], 2, [0.6, 0.46875], 1)!;
    expect(windowOf(plan, pinched)).toEqual([200, 150, 500, 320]);
  });

  it("pans only a zoomed-in view, within the plan, and moves to show an item that is off screen", () => {
    expect(panBy(plan, null, 100, 100, 1)).toBeNull();
    expect(windowOf(plan, panBy(plan, { z: 2, x: 0, y: 0 }, 100, 50, 1))).toEqual([100, 50, 500, 320]);
    expect(windowOf(plan, panBy(plan, { z: 2, x: 0, y: 0 }, 9999, 9999, 1))).toEqual([500, 320, 500, 320]);
    const view = { z: 2, x: 0, y: 0 };
    expect(revealBox(plan, view, [100, 100, 50, 50], 1)).toBe(view);
    expect(windowOf(plan, revealBox(plan, view, [800, 500, 100, 100], 1))).toEqual([500, 320, 500, 320]);
  });

  it("reads the zoom as a percentage of actual size, and turns wheel steps into gentle zoom steps", () => {
    expect(zoomPercent(null, 0.8)).toBe(80);
    expect(zoomPercent({ z: 2, x: 0, y: 0 }, 0.8)).toBe(160);
    expect(zoomPercent({ z: 2, x: 0, y: 0 }, 0)).toBe(200);
    expect(actualZoom(0.5)).toBe(2);
    expect(wheelZoomFactor(-100)).toBeCloseTo(Math.exp(0.3));
    expect(wheelZoomFactor(3, 1)).toBeCloseTo(Math.exp(-0.24));
    expect(wheelZoomFactor(0)).toBe(1);
  });

  it("turns screen points into plan points through the screen matrix, and back into a place across the window", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg") as SVGSVGElement;
    // 2 screen pixels per plan unit, plan point (250, 160) at the screen's top-left.
    const matrix = new DOMMatrix([2, 0, 0, 2, -500, -320]);
    expect(planPoint(svg, 100, 60, matrix)).toEqual([300, 190]);
    expect(planPoint(null, 1, 1, null)).toBeNull();
    expect(fractionIn([250, 160, 500, 320], [500, 320])).toEqual([0.5, 0.5]);
  });

  it("remembers the view in this browser only, and ignores anything odd stored there", () => {
    rememberView("office", { z: 2, x: 10, y: 20 });
    expect(rememberedView("office")).toEqual({ z: 2, x: 10, y: 20 });
    rememberView("office", null);
    expect(localStorage.getItem("energyiq.floorPlanView.office")).toBeNull();
    for (const odd of ["not json", JSON.stringify({ z: "2", x: 0, y: 0 }), JSON.stringify({ z: -1, x: 0, y: 0 }), JSON.stringify([1, 2, 3])]) {
      localStorage.setItem("energyiq.floorPlanView.office", odd);
      expect(rememberedView("office")).toBeNull();
    }
  });
});

describe("zoom, focus and resize keys", () => {
  const key = (name: string, extra: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; target: EventTarget | null }> = {}) => planShortcut({ key: name, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, target: document.body, ...extra }, 10);
  it("zooms with Cmd/Ctrl and plus, minus or 0, goes through items with [ and ], selects with Enter and resizes with Cmd/Ctrl+arrows", () => {
    expect([key("=", { metaKey: true }), key("+", { ctrlKey: true, shiftKey: true }), key("-", { ctrlKey: true }), key("0", { metaKey: true })]).toEqual([{ kind: "zoom", how: "in" }, { kind: "zoom", how: "in" }, { kind: "zoom", how: "out" }, { kind: "zoom", how: "fit" }]);
    expect([key("]"), key("[")]).toEqual([{ kind: "cycle", by: 1 }, { kind: "cycle", by: -1 }]);
    expect([key("Enter"), key("Enter", { shiftKey: true })]).toEqual([{ kind: "select", toggle: false }, { kind: "select", toggle: true }]);
    expect(key("ArrowRight", { ctrlKey: true })).toEqual({ kind: "resize", by: [10, 0] });
    expect(key("ArrowUp", { metaKey: true })).toEqual({ kind: "resize", by: [0, -10] });
    expect(key("ArrowDown", { metaKey: true, shiftKey: true })).toEqual({ kind: "resize", by: [0, 50] });
    // Shift alone still nudges five grid steps, Alt alone nudges an area on its own, and Alt+Shift does both (as before).
    expect(key("ArrowLeft", { shiftKey: true })).toEqual({ kind: "nudge", by: [-50, 0], alone: false });
    expect(key("ArrowLeft", { altKey: true })).toEqual({ kind: "nudge", by: [-10, 0], alone: true });
    expect(key("ArrowRight", { altKey: true, shiftKey: true })).toEqual({ kind: "nudge", by: [50, 0], alone: true });
    // Cmd/Ctrl+Alt+arrow is left to the browser and the computer (it switches tabs or desktops there).
    expect(key("ArrowRight", { metaKey: true, altKey: true })).toBeNull();
  });
  it("leaves zoom and the new keys to fields, and Enter, [ and ] on a field or button to that control", () => {
    const input = document.createElement("input"), button = document.createElement("button");
    for (const [name, extra] of [["=", { metaKey: true }], ["0", { ctrlKey: true }], ["]", {}], ["Enter", {}], ["ArrowRight", { ctrlKey: true }], ["ArrowRight", { altKey: true, shiftKey: true }]] as const) expect(key(name, { target: input, ...extra })).toBeNull();
    expect(key("Enter", { target: button })).toBeNull();
    expect(key("ArrowRight", { target: button, ctrlKey: true })).toBeNull();
  });
});

describe("the unsaved draft in this browser", () => {
  const reference = { schemaVersion: 1, projectId: "office", provenance: { file: "plan", status: "Edited" }, layout: { viewBox: [0, 0, 1000, 640], zones: [{ id: "A", referenceBoard: "DB1", rect: [20, 20, 400, 400] }], rooms: [{ name: "Pantry", zone: "A", rect: [40, 40, 100, 100] }] } };
  const store = (record: unknown) => localStorage.setItem(draftKey("office"), JSON.stringify(record));
  it("is read back only when it is a draft of a layout that would load", () => {
    store({ version: 1, savedAt: 1_000, base: "b", reference });
    expect(readDraft("office", 2_000)).toMatchObject({ savedAt: 1_000, base: "b", reference: { projectId: "office" } });
    // Too old, from the future, another project, a broken layout, or not a draft at all: ignored.
    expect(readDraft("office", 1_000 + DRAFT_MAX_AGE + 1)).toBeNull();
    store({ version: 1, savedAt: 10_000_000, base: "b", reference });
    expect(readDraft("office", 2_000)).toBeNull();
    store({ version: 1, savedAt: 1_000, base: "b", reference: { ...reference, projectId: "other" } });
    expect(readDraft("office", 2_000)).toBeNull();
    store({ version: 1, savedAt: 1_000, base: "b", reference: { ...reference, layout: { ...reference.layout, viewBox: "big" } } });
    expect(readDraft("office", 2_000)).toBeNull();
    for (const odd of [null, 5, "x", { version: 2, savedAt: 1_000, base: "b", reference }, { version: 1, savedAt: "1", base: "b", reference }]) { store(odd); expect(readDraft("office", 2_000)).toBeNull(); }
    localStorage.setItem(draftKey("office"), "{not json");
    expect(readDraft("office", 2_000)).toBeNull();
  });
  it("belongs to the person who made it, and signing out removes every draft in this browser", () => {
    localStorage.setItem(draftKey("office", "amy"), JSON.stringify({ version: 1, savedAt: 1_000, base: "b", user: "amy", reference }));
    expect(draftKey("office", "amy")).not.toBe(draftKey("office", "ben"));
    expect(readDraft("office", 2_000, "amy")).not.toBeNull();
    expect(readDraft("office", 2_000, "ben")).toBeNull();
    expect(readDraft("office", 2_000)).toBeNull();
    // A record copied under someone else's key is still not theirs.
    localStorage.setItem(draftKey("office", "ben"), localStorage.getItem(draftKey("office", "amy"))!);
    expect(readDraft("office", 2_000, "ben")).toBeNull();
    localStorage.setItem("energyiq.floorPlanView.office", "{}");
    clearAllPlanDrafts();
    expect([localStorage.getItem(draftKey("office", "amy")), localStorage.getItem(draftKey("office", "ben"))]).toEqual([null, null]);
    expect(localStorage.getItem("energyiq.floorPlanView.office")).toBe("{}");
  });
  it("tells saved layouts apart by a short fingerprint", () => {
    expect(fingerprint("abc")).toBe(fingerprint("abc"));
    expect(fingerprint("abc")).not.toBe(fingerprint("abd"));
    expect(fingerprint("")).toMatch(/^0-/);
  });
});
