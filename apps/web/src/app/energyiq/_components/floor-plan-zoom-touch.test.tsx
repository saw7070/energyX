/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readProjectSpatialReference } from "@datafoundry/contracts";
import { configApi } from "../../../lib/config-api";
import { EnergyIqLocaleProvider } from "./energyiq-locale";
import { FloorPlanEditor, LONG_PRESS_MS } from "./floor-plan-editor";
import { DRAFT_DELAY, draftKey, fingerprint } from "./floor-plan-draft";
import { notesWithReference, planFromReference, referenceFromPlan, type StoredSpatialReference } from "./floor-plan-model";

/**
 * Zoom and pan, touch, keyboard and screen-reader access, and the unsaved draft in the layout editor. The editor is given
 * a size on screen (`pxWidth`), and its screen matrix follows the viewBox it shows, as a browser's does, so pointer
 * positions can be checked at any zoom.
 */
let pxWidth = 1000;
const svgProto = SVGSVGElement.prototype as unknown as Record<string, unknown>;
function sized(width: number) {
  pxWidth = width;
  Object.defineProperty(svgProto, "getScreenCTM", { configurable: true, value(this: SVGSVGElement) { const [x, y, w] = (this.getAttribute("viewBox") ?? "0 0 1000 640").split(/\s+/).map(Number) as [number, number, number]; const a = pxWidth / w; return new DOMMatrix([a, 0, 0, a, -x * a, -y * a]); } });
  Object.defineProperty(svgProto, "getBoundingClientRect", { configurable: true, value: () => ({ x: 0, y: 0, left: 0, top: 0, width: pxWidth, height: pxWidth * 0.64, right: pxWidth, bottom: pxWidth * 0.64, toJSON() { return {}; } }) });
}
afterEach(() => { delete svgProto.getScreenCTM; delete svgProto.getBoundingClientRect; delete svgProto.scrollIntoView; localStorage.clear(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); delete document.documentElement.dataset.energyiqTheme; });

const meters = [{ id: "tv", name: "Showroom TV", board: "DB1", type: "Power" }, { id: "desk", name: "Office desk", board: "DB2", type: "Power" }, { id: "fan", name: "Pantry fan", board: "DB1", type: "Power" }];
const office = (style?: string) => ({
  schemaVersion: 1, projectId: "office", provenance: { file: "plan", status: "Edited in Facility → Floor layout" },
  layout: {
    viewBox: [0, 0, 1000, 640], ...(style ? { style } : {}),
    zones: [{ id: "Block 264E", referenceBoard: "DB1", rect: [20, 20, 460, 500] }, { id: "Block 264F", referenceBoard: "DB2", rect: [520, 20, 460, 500] }],
    rooms: [{ name: "Showroom", zone: "Block 264E", rect: [40, 80, 260, 200] }, { name: "Pantry", zone: "Block 264E", rect: [320, 300, 140, 120] }, { name: "Office", zone: "Block 264F", rect: [540, 80, 200, 150] }, { name: "Store", zone: "Block 264F", rect: [547, 300, 100, 100] }],
    devices: [{ meterId: "tv", position: [100, 150] }, { meterId: "desk", position: [600, 120] }],
  },
}) as unknown as StoredSpatialReference;
const pointer = (type: string, x: number, y: number, extra: PointerEventInit = {}) => new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, pointerId: 1, pointerType: "mouse", ...extra });

async function render(options: { previous?: StoredSpatialReference; meters?: typeof meters; width?: number; projectId?: string } = {}) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("React", React);
  sized(options.width ?? 1000);
  const projectId = options.projectId ?? "office", previous = options.previous ?? office();
  const notes = notesWithReference("Office notes.", null, previous), block = readProjectSpatialReference(notes, projectId)!.block;
  const sent: string[] = [];
  vi.spyOn(configApi, "reportAgentRequest").mockImplementation(async (_project, path, request) => { if (!path) return { settings: { contextNotes: notes } } as never; sent.push(String(request?.body)); return {} as never; });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const onCancel = vi.fn();
  const editor = () => <EnergyIqLocaleProvider><FloorPlanEditor projectId={projectId} notes={notes} block={block} previous={previous} meters={options.meters ?? meters} boards={["DB1", "DB2"]} onCancel={onCancel} onSaved={() => undefined} /></EnergyIqLocaleProvider>;
  await act(async () => root.render(editor()));
  const canvas = () => host.querySelector('svg[role="application"]') as SVGSVGElement;
  const box = () => canvas().getAttribute("viewBox")!.split(" ").map(Number) as [number, number, number, number];
  /** Where a plan point is on screen at the current zoom. */
  const at = (px: number, py: number): [number, number] => { const [x, y, w] = box(), a = pxWidth / w; return [(px - x) * a, (py - y) * a]; };
  const button = (label: string) => [...host.querySelectorAll("button")].find(item => item.textContent === label || item.getAttribute("aria-label") === label) as HTMLButtonElement;
  const item = (id: string) => canvas().querySelector(`[data-item="${id}"]`) as SVGGElement;
  const rect = (id: string) => { const shape = item(id).querySelector("rect")!; return ["x", "y", "width", "height"].map(key => Number(shape.getAttribute(key))); };
  const send = async (target: EventTarget, event: Event) => { await act(async () => { target.dispatchEvent(event); }); return event.defaultPrevented; };
  const down = (target: Element, [x, y]: [number, number], extra: PointerEventInit = {}) => send(target, pointer("pointerdown", x, y, extra));
  const move = ([x, y]: [number, number], extra: PointerEventInit = {}) => send(canvas(), pointer("pointermove", x, y, extra));
  const up = ([x, y]: [number, number], extra: PointerEventInit = {}) => send(canvas(), pointer("pointerup", x, y, extra));
  const press = (target: EventTarget, key: string, extra: KeyboardEventInit = {}) => send(target, new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra }));
  const live = () => host.querySelector('[data-live="plan"]')!.textContent!.trim();
  const heading = () => host.querySelector("aside h5")?.textContent;
  const saved = async () => { await act(async () => button("Save layout").click()); return (JSON.parse(sent[sent.length - 1]!) as { contextNotes: string }).contextNotes; };
  return { host, notes, block, canvas, box, at, button, item, rect, send, down, move, up, press, live, heading, saved, onCancel, rerender: () => act(async () => root.render(editor())), unmount: async () => { await act(async () => root.unmount()); host.remove(); } };
}
type View = Awaited<ReturnType<typeof render>>;
/** A wheel event with the pointer position and keys a browser gives it (the test DOM's WheelEvent leaves them out). */
const wheelAt = ({ clientX = 0, clientY = 0, ctrlKey = false, metaKey = false, shiftKey = false, ...rest }: WheelEventInit) => {
  const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...rest });
  for (const [key, value] of Object.entries({ clientX, clientY, ctrlKey, metaKey, shiftKey })) Object.defineProperty(event, key, { value });
  return event;
};
/** Opens the editor at a remembered zoom (as if it was left there last time). */
const remember = (z: number, x: number, y: number) => localStorage.setItem("energyiq.floorPlanView.office", JSON.stringify({ z, x, y }));
const drag = async (view: View, target: Element, from: [number, number], to: [number, number], extra: PointerEventInit = {}) => { await view.down(target, from, extra); await view.move([(from[0] + to[0]) / 2, (from[1] + to[1]) / 2], extra); await view.move(to, extra); await view.up(to, extra); };

describe("zoom and pan", () => {
  it("zooms with the buttons, reads out the level, fits the plan, shows actual size, and never changes what is saved", async () => {
    const view = await render({ width: 500 });
    // 1000 plan units across 500 pixels: the whole plan is 50%.
    expect(view.box()).toEqual([0, 0, 1000, 640]);
    expect(view.host.querySelector("output")!.textContent).toBe("50%");
    expect(view.host.querySelectorAll('button[aria-label^="Drag to"]').length).toBe(5);
    await act(async () => view.button("Zoom in (Ctrl++)").click());
    expect(view.box()).toEqual([100, 64, 800, 512]);
    expect(view.host.querySelector("output")!.textContent).toBe("63%");
    expect(view.live()).toBe("Zoom 63%");
    // The edges of the drawing space are only at the frame's edges while the whole plan shows.
    expect(view.host.querySelectorAll('button[aria-label^="Drag to"]').length).toBe(0);
    expect(view.button("Fit plan").getAttribute("aria-pressed")).toBe("false");
    await act(async () => view.button("Show the plan at actual size").click());
    expect(view.box()).toEqual([250, 160, 500, 320]);
    expect(view.host.querySelector("output")!.textContent).toBe("100%");
    await act(async () => view.button("Zoom out (Ctrl+−)").click());
    expect(view.box().map(value => Math.round(value))).toEqual([188, 120, 625, 400]);
    await act(async () => view.button("Fit plan").click());
    expect(view.box()).toEqual([0, 0, 1000, 640]);
    expect(view.button("Fit plan").getAttribute("aria-pressed")).toBe("true");
    // The zoom is remembered in this browser, never in the layout.
    await act(async () => view.button("Show the plan at actual size").click());
    expect(JSON.parse(localStorage.getItem("energyiq.floorPlanView.office")!)).toEqual({ z: 2, x: 250, y: 160 });
    expect(await view.saved()).toBe(view.notes);
    await view.unmount();
  });

  it("zooms around the pointer with Ctrl or ⌘ and the wheel (or a trackpad pinch), and the plain wheel moves around a zoomed plan", async () => {
    const view = await render();
    const wheel = (extra: WheelEventInit) => wheelAt({ clientX: 250, clientY: 160, ...extra });
    expect(await view.send(view.canvas(), wheel({ ctrlKey: true, deltaY: -60 }))).toBe(true);
    const [x, y, w] = view.box(), scale = pxWidth / w;
    expect(scale).toBeCloseTo(Math.exp(0.3));
    // The plan point that was under the pointer (250, 160) is still under it.
    expect(x + 250 / scale).toBeCloseTo(250);
    expect(y + 160 / scale).toBeCloseTo(160);
    // A plain wheel moves the zoomed plan (and not the page) ...
    expect(await view.send(view.canvas(), wheel({ deltaY: 100 }))).toBe(true);
    expect(view.box()[1]).toBeCloseTo(y + 100 / scale);
    expect(await view.send(view.canvas(), wheel({ deltaY: 100, shiftKey: true }))).toBe(true);
    expect(view.box()[0]).toBeCloseTo(x + 100 / scale);
    // ... until it reaches the edge, and with the whole plan shown it scrolls the page as usual.
    for (let step = 0; step < 10; step += 1) await view.send(view.canvas(), wheel({ deltaY: 400 }));
    expect(await view.send(view.canvas(), wheel({ deltaY: 100 }))).toBe(false);
    await act(async () => view.button("Fit plan").click());
    expect(await view.send(view.canvas(), wheel({ deltaY: 100 }))).toBe(false);
    expect(view.box()).toEqual([0, 0, 1000, 640]);
    await view.unmount();
  });

  it("zooms with Cmd/Ctrl and plus, minus and 0 only inside the editor, never while typing in a field", async () => {
    const view = await render();
    expect(await view.press(view.canvas(), "=", { ctrlKey: true })).toBe(true);
    expect(view.box()[2]).toBe(800);
    expect(await view.press(view.canvas(), "-", { metaKey: true })).toBe(true);
    expect(view.box()).toEqual([0, 0, 1000, 640]);
    await view.press(view.canvas(), "+", { ctrlKey: true, shiftKey: true });
    expect(view.box()[2]).toBe(800);
    expect(await view.press(view.canvas(), "0", { ctrlKey: true })).toBe(true);
    expect(view.box()).toEqual([0, 0, 1000, 640]);
    // A field in the editor and the page outside it keep the browser's own zoom keys.
    await view.down(view.item("room:room-2"), [330, 310]); await view.up([330, 310]);
    const field = view.host.querySelector("aside input") as HTMLInputElement;
    expect(await view.press(field, "=", { ctrlKey: true })).toBe(false);
    expect(await view.press(document.body, "=", { ctrlKey: true })).toBe(false);
    expect(view.box()).toEqual([0, 0, 1000, 640]);
    await view.unmount();
  });

  it("moves and resizes exactly under the pointer at 200% and at 50%, with grips the same size on screen", async () => {
    // 200%: two screen pixels per plan unit.
    remember(2, 250, 160);
    let view = await render();
    expect(view.box()).toEqual([250, 160, 500, 320]);
    await drag(view, view.item("room:room-2"), view.at(330, 310), [view.at(330, 310)[0] + 60, view.at(330, 310)[1]]);
    expect(view.rect("room:room-2")).toEqual([350, 300, 140, 120]);
    expect(view.live()).toBe("Moved to 350, 300");
    let east = view.canvas().querySelector('rect[data-handle="e"]')!;
    expect(Number(east.getAttribute("width"))).toBe(6.5);
    await drag(view, east, view.at(490, 360), [view.at(490, 360)[0] + 40, view.at(490, 360)[1]]);
    expect(view.rect("room:room-2")).toEqual([350, 300, 160, 120]);
    expect(view.live()).toBe("Resized to 160 by 120");
    // A selection box drawn at this zoom takes what is inside it in plan units.
    await drag(view, view.canvas(), view.at(530, 290), view.at(660, 410));
    expect(view.heading()).toBe("Room");
    expect(view.live()).toBe("Room Store selected");
    await view.unmount();
    localStorage.clear();

    // 50%: half a pixel per plan unit, and the plan sits in the middle of the frame.
    remember(0.5, 0, 0);
    view = await render();
    expect(view.box()).toEqual([-500, -320, 2000, 1280]);
    await drag(view, view.item("room:room-2"), view.at(330, 310), [view.at(330, 310)[0] + 20, view.at(330, 310)[1] + 10]);
    expect(view.rect("room:room-2")).toEqual([360, 320, 140, 120]);
    east = view.canvas().querySelector('rect[data-handle="e"]')!;
    expect(Number(east.getAttribute("width"))).toBe(26);
    await drag(view, east, view.at(500, 380), [view.at(500, 380)[0] - 10, view.at(500, 380)[1]]);
    expect(view.rect("room:room-2")).toEqual([360, 320, 120, 120]);
    await view.unmount();
  });

  it("moves around with the middle button or Space and a drag, without moving what is under the pointer", async () => {
    remember(2, 250, 160);
    const view = await render();
    await view.down(view.item("room:room-2"), [200, 300], { button: 1, pointerId: 2 });
    await view.move([100, 300], { pointerId: 2 });
    await view.up([100, 300], { pointerId: 2 });
    expect(view.box()).toEqual([300, 160, 500, 320]);
    expect(view.rect("room:room-2")).toEqual([320, 300, 140, 120]);
    // Space held on the plan: a drag moves the view; the page does not scroll.
    await act(async () => { view.canvas().focus(); });
    expect(await view.press(view.canvas(), " ")).toBe(true);
    expect(view.canvas().getAttribute("class")).toMatch(/panReady/);
    await view.down(view.item("room:room-2"), [100, 300], { pointerId: 3 });
    await view.move([100, 400], { pointerId: 3 });
    await view.up([100, 400], { pointerId: 3 });
    expect(view.box()).toEqual([300, 110, 500, 320]);
    expect(view.rect("room:room-2")).toEqual([320, 300, 140, 120]);
    await act(async () => { view.canvas().dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true })); });
    expect(view.canvas().getAttribute("class")).not.toMatch(/panReady/);
    expect(view.button("Undo").disabled).toBe(true);
    await view.unmount();
  });
});

describe("touch", () => {
  const touch = (id: number): PointerEventInit => ({ pointerType: "touch", pointerId: id });
  it("pinches with two fingers to zoom and pan, and drops a one-finger drag that turns into a pinch", async () => {
    const view = await render();
    await view.down(view.canvas(), [400, 300], touch(11));
    await view.down(view.canvas(), [600, 300], touch(12));
    await view.move([800, 300], touch(12));
    // The fingers are twice as far apart (200%), and the plan point first between them (500, 300) is still between them.
    expect(view.box()).toEqual([200, 150, 500, 320]);
    await view.up([800, 300], touch(12)); await view.up([400, 300], touch(11));
    expect(view.host.querySelector(".marquee, [class*=marquee]")).toBeNull();
    await act(async () => view.button("Fit plan").click());
    // One finger drags an item ...
    await drag(view, view.item("room:room-2"), [330, 310], [350, 310], touch(21));
    expect(view.rect("room:room-2")).toEqual([340, 300, 140, 120]);
    // ... and a second finger mid-drag puts it back and pinches instead.
    await view.down(view.item("room:room-2"), [350, 310], touch(31));
    await view.move([380, 310], touch(31));
    expect(view.rect("room:room-2")[0]).toBe(370);
    await view.down(view.canvas(), [580, 310], touch(32));
    expect(view.rect("room:room-2")[0]).toBe(340);
    await view.move([400, 310], touch(31));
    expect(view.rect("room:room-2")[0]).toBe(340);
    await view.up([400, 310], touch(31)); await view.up([580, 310], touch(32));
    expect(view.button("Undo").disabled).toBe(false);
    await act(async () => view.button("Undo").click());
    expect(view.button("Undo").disabled).toBe(true);
    await view.unmount();
  });

  it("adds an item to the selection with a long press, takes it out with another, and a finger that moves just drags", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const view = await render();
    await view.down(view.item("room:room-1"), [50, 90]); await view.up([50, 90]);
    expect(view.live()).toBe("Room Showroom selected");
    await view.down(view.item("room:room-2"), [330, 310], touch(41));
    await act(async () => { vi.advanceTimersByTime(LONG_PRESS_MS + 50); });
    await view.up([330, 310], touch(41));
    expect(view.heading()).toBe("2 items selected");
    expect(view.live()).toBe("2 items selected");
    expect(view.rect("room:room-2")).toEqual([320, 300, 140, 120]);
    // Again on the same room: it comes out of the selection.
    await view.down(view.item("room:room-2"), [330, 310], touch(42));
    await view.move([333, 312], touch(42)); // a small wobble still counts as holding still, and moves nothing
    await act(async () => { vi.advanceTimersByTime(LONG_PRESS_MS + 50); });
    await view.up([333, 312], touch(42));
    expect(view.heading()).toBe("Room");
    expect(view.live()).toBe("Room Showroom selected");
    expect(view.rect("room:room-2")).toEqual([320, 300, 140, 120]);
    // A finger that moves on is a drag: no long press.
    await view.down(view.item("room:room-2"), [330, 310], touch(43));
    await view.move([360, 310], touch(43));
    await act(async () => { vi.advanceTimersByTime(LONG_PRESS_MS + 50); });
    await view.up([360, 310], touch(43));
    expect(view.rect("room:room-2")).toEqual([350, 300, 140, 120]);
    expect(view.heading()).toBe("Room");
    await view.unmount();
  });

  it("places a device with a tap on Place and a tap on the plan, and brings the plan into view on a narrow screen", async () => {
    const observers: Array<() => void> = [];
    vi.stubGlobal("ResizeObserver", class { constructor(private readonly done: (entries: Array<{ contentRect: { width: number } }>) => void) {} observe() { observers.push(() => this.done([{ contentRect: { width: 600 } }])); } disconnect() { /* nothing to stop */ } });
    const scrolled = vi.fn();
    svgProto.scrollIntoView = scrolled;
    const view = await render({ width: 600 });
    await act(async () => { observers.forEach(run => run()); });
    const section = view.host.querySelector("section")!;
    expect(section.getAttribute("data-layout")).toBe("narrow");
    expect(section.className).toMatch(/narrow/);
    const place = [...view.host.querySelectorAll("aside li")].find(row => row.textContent?.includes("Pantry fan"))!.querySelector("button")!;
    await act(async () => place.click());
    expect(scrolled).toHaveBeenCalled();
    expect(view.host.textContent).toContain("Click or tap the plan where Pantry fan is.");
    // At 600 pixels wide, plan point (400, 350) is at (240, 210) on screen.
    await view.down(view.item("room:room-2"), [240, 210], touch(51));
    await view.up([240, 210], touch(51));
    expect(view.item("device:fan").querySelector("circle")!.getAttribute("cx")).toBe("400");
    expect(view.live()).toBe("Added Device Pantry fan");
    await view.unmount();
  });

  it("stays a side-by-side layout on a wide screen, and draws bigger grips for fingers", async () => {
    vi.stubGlobal("ResizeObserver", class { constructor(private readonly done: (entries: Array<{ contentRect: { width: number } }>) => void) {} observe() { this.done([{ contentRect: { width: 1200 } }]); } disconnect() { /* nothing to stop */ } });
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(pointer: coarse)", addEventListener() { /* fixed */ }, removeEventListener() { /* fixed */ } }));
    sized(1200);
    const view = await render({ width: 1200 });
    expect(view.host.querySelector("section")!.getAttribute("data-layout")).toBe("wide");
    await view.down(view.item("room:room-2"), view.at(330, 310)); await view.up(view.at(330, 310));
    expect(Number(view.canvas().querySelector('rect[data-handle="e"]')!.getAttribute("width"))).toBe(26);
    await view.unmount();
  });
});

describe("keyboard and screen readers", () => {
  it("goes through items with ] and [, selects with Enter, moves and resizes with keys, and reads each step out", async () => {
    const view = await render();
    await act(async () => { view.canvas().focus(); });
    await view.press(view.canvas(), "]");
    expect(document.activeElement?.getAttribute("data-item")).toBe("area:Block 264E");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Area DB1 · Block 264E");
    expect(view.canvas().querySelector("[data-focus-ring]")).not.toBeNull();
    for (const key of ["]", "]", "]", "["]) await view.press(document.activeElement!, key);
    expect(document.activeElement?.getAttribute("data-item")).toBe("room:room-1");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Room Showroom");
    expect(await view.press(document.activeElement!, "Enter")).toBe(true);
    expect(view.heading()).toBe("Room");
    expect(view.live()).toBe("Room Showroom selected");
    await view.press(document.activeElement!, "ArrowRight");
    expect(view.rect("room:room-1")).toEqual([50, 80, 260, 200]);
    expect(view.live()).toBe("Moved to 50, 80");
    await view.press(document.activeElement!, "ArrowDown", { shiftKey: true });
    expect(view.live()).toBe("Moved to 50, 130");
    await view.press(document.activeElement!, "ArrowRight", { altKey: true, shiftKey: true });
    await view.press(document.activeElement!, "ArrowUp", { altKey: true, shiftKey: true });
    expect(view.rect("room:room-1")).toEqual([50, 130, 270, 190]);
    expect(view.live()).toBe("Resized to 270 by 190");
    // Undo keeps focus on the item, and says so.
    const focusedRoom = document.activeElement;
    // Each press is its own step: Undo takes back the last one.
    await view.press(focusedRoom!, "z", { ctrlKey: true });
    expect(view.rect("room:room-1")).toEqual([50, 130, 270, 200]);
    expect(document.activeElement).toBe(focusedRoom);
    expect(view.live()).toBe("Undone");
    await view.press(focusedRoom!, "z", { ctrlKey: true, shiftKey: true });
    expect(view.live()).toBe("Redone");
    expect(document.activeElement).toBe(focusedRoom);
    // Shift+Enter on another item adds it; Esc clears the selection.
    await view.press(focusedRoom!, "]");
    await view.press(document.activeElement!, "Enter", { shiftKey: true });
    expect(view.live()).toBe("2 items selected");
    await view.press(document.activeElement!, "Escape");
    expect(view.live()).toBe("Nothing selected");
    expect(view.heading()).not.toBe("Room");
    // Deleting is read out, and Undo brings it back with focus still on the plan.
    await view.press(document.activeElement!, "Enter");
    await view.press(document.activeElement!, "Delete");
    expect(view.live()).toBe("Deleted Room Pantry");
    expect(view.item("room:room-2")).toBeNull();
    await view.press(view.canvas(), "z", { ctrlKey: true });
    expect(view.item("room:room-2")).not.toBeNull();
    expect(view.canvas().contains(document.activeElement)).toBe(true);
    // Adding is read out too.
    await view.press(view.canvas(), "d", { ctrlKey: true });
    expect(view.live()).toBe("Added Room Pantry 2");
    await view.unmount();
  });

  it("names every new control, describes the keys, and moves a zoomed plan to show the item that gets focus", async () => {
    remember(4, 0, 0);
    const view = await render();
    expect(view.box()).toEqual([0, 0, 250, 160]);
    const keys = view.host.querySelector(`#${CSS.escape(view.canvas().getAttribute("aria-describedby")!)}`)!;
    expect(keys.textContent).toContain("press ] or [");
    expect(view.host.querySelector('[role="group"][aria-label="Zoom"]')).not.toBeNull();
    for (const label of ["Zoom in (Ctrl++)", "Zoom out (Ctrl+−)", "Show the plan at actual size"]) expect(view.button(label)).toBeTruthy();
    expect(view.host.querySelector("output")!.getAttribute("aria-label")).toBe("Zoom 400%");
    await act(async () => { view.canvas().focus(); });
    for (let step = 0; step < 5; step += 1) await view.press(document.activeElement!, "]");
    expect(document.activeElement?.getAttribute("data-item")).toBe("room:room-3");
    // The Office room (540, 80) was off screen: the view moved to show it, at the same zoom.
    const [x, y, w] = view.box();
    expect(w).toBe(250);
    expect(x).toBeLessThanOrEqual(540); expect(x + w).toBeGreaterThanOrEqual(740);
    expect(y).toBeLessThanOrEqual(80);
    await view.unmount();
  });

  it("draws the focus ring in every plan style and in dark mode", async () => {
    for (const style of [undefined, "drawing", "blueprint", "blocks"]) for (const dark of [false, true]) {
      if (dark) document.documentElement.dataset.energyiqTheme = "dark"; else delete document.documentElement.dataset.energyiqTheme;
      const view = await render({ previous: office(style) });
      await act(async () => { view.canvas().focus(); });
      await view.press(view.canvas(), "]");
      const ring = view.canvas().querySelector("[data-focus-ring]")!;
      expect(ring.getAttribute("class")).toMatch(/focusRing/);
      // It sits around the focused area, a little outside it.
      expect(Number(ring.getAttribute("x"))).toBeLessThan(20);
      await view.unmount();
    }
  });
});

describe("the unsaved draft", () => {
  const nudge = async (view: View) => {
    await view.down(view.item("room:room-2"), [330, 310]); await view.up([330, 310]);
    await view.press(view.canvas(), "ArrowRight");
  };
  const wait = () => act(async () => { vi.advanceTimersByTime(DRAFT_DELAY + 100); });
  const stored = () => JSON.parse(localStorage.getItem(draftKey("office")) ?? "null") as { savedAt: number; base: string; reference: StoredSpatialReference } | null;

  it("is kept while editing, offered back with its time, restored as one undo step, and cleared once saved", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date("2026-11-12T10:30:00Z"));
    let view = await render();
    expect(view.host.textContent).not.toContain("Restore your unsaved changes");
    await nudge(view);
    expect(stored()).toBeNull();
    await wait();
    expect(stored()!.reference.layout.rooms.find(room => room.name === "Pantry")!.rect).toEqual([330, 300, 140, 120]);
    expect(stored()!.base).toBe(fingerprint(view.block));
    // The zoom is never part of the draft or the layout.
    expect(JSON.stringify(stored())).not.toMatch(/"z"|zoom/i);
    await view.unmount();

    view = await render();
    const offer = view.host.querySelector('[role="group"][aria-label="Unsaved changes"]')!;
    expect(offer.textContent).toMatch(/^Restore your unsaved changes from .+\?RestoreDiscard$/);
    expect(offer.textContent).not.toContain("has changed since then");
    expect(view.rect("room:room-2")).toEqual([320, 300, 140, 120]);
    await act(async () => view.button("Restore").click());
    expect(view.host.querySelector('[aria-label="Unsaved changes"]')).toBeNull();
    expect(view.rect("room:room-2")).toEqual([330, 300, 140, 120]);
    expect(view.host.textContent).toContain("Your unsaved changes are back.");
    // Undo goes back to the saved plan in one step.
    await act(async () => view.button("Undo").click());
    expect(view.rect("room:room-2")).toEqual([320, 300, 140, 120]);
    await act(async () => view.button("Redo").click());
    const notes = await view.saved();
    expect(readProjectSpatialReference(notes, "office")!.reference.layout.rooms.find(room => room.name === "Pantry")!.rect).toEqual([330, 300, 140, 120]);
    expect(stored()).toBeNull();
    await view.unmount();
  });

  it("is discarded on request, cleared by leaving without saving or undoing every change, and never offered when it matches the saved plan", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    let view = await render();
    await nudge(view); await wait();
    await view.unmount();
    view = await render();
    await act(async () => view.button("Discard").click());
    expect(stored()).toBeNull();
    expect(view.rect("room:room-2")).toEqual([320, 300, 140, 120]);
    // Undoing back to the saved plan leaves nothing to keep.
    await nudge(view); await wait();
    expect(stored()).not.toBeNull();
    await act(async () => view.button("Undo").click());
    expect(stored()).toBeNull();
    // Leaving without saving drops it.
    await nudge(view); await wait();
    expect(stored()).not.toBeNull();
    await act(async () => view.button("Cancel").click());
    await act(async () => view.button("Leave without saving").click());
    expect(view.onCancel).toHaveBeenCalled();
    expect(stored()).toBeNull();
    await view.unmount();
    // A draft that is the saved plan is nothing to offer (and is cleared).
    const same = referenceFromPlan(planFromReference(office()), "office", office());
    localStorage.setItem(draftKey("office"), JSON.stringify({ version: 1, savedAt: Date.now(), base: "x", reference: same }));
    view = await render();
    expect(view.host.querySelector('[aria-label="Unsaved changes"]')).toBeNull();
    expect(stored()).toBeNull();
    await view.unmount();
  });

  it("says when the saved plan changed after the draft was made, and ignores a draft that would not load", async () => {
    const moved = office();
    moved.layout.rooms[1]!.rect = [330, 310, 140, 120];
    localStorage.setItem(draftKey("office"), JSON.stringify({ version: 1, savedAt: Date.now() - 60_000, base: "someone-else", reference: moved }));
    let view = await render();
    expect(view.host.querySelector('[aria-label="Unsaved changes"]')!.textContent).toContain("The saved plan has changed since then.");
    await view.unmount();
    localStorage.setItem(draftKey("office"), JSON.stringify({ version: 1, savedAt: Date.now(), base: "x", reference: { ...moved, layout: { ...moved.layout, zones: "lots" } } }));
    view = await render();
    expect(view.host.querySelector('[aria-label="Unsaved changes"]')).toBeNull();
    await view.unmount();
  });
});

/** An SKTC-like estate saved before this change: five areas (one is equipment inside a room), 14 rooms, 19 devices and the gate. */
function estate(): StoredSpatialReference {
  const room = (name: string, zone: string, rect: [number, number, number, number]) => ({ name, zone, rect });
  const blocks = (block: string, x: number) => ["Lobby", "Store", "Bin centre", "Lift motor room", "Corridors L1-L17"].map((name, index) => room(`${block} ${name}`, block, [x + (index % 2) * 240, 80 + Math.floor(index / 2) * 200, 220, 160]));
  return {
    schemaVersion: 1, projectId: "sktc", provenance: { file: "SKTC site plan.pdf", status: "Edited in Facility → Floor layout" },
    layout: {
      viewBox: [0, 0, 1600, 900], style: "blueprint",
      zones: [
        { id: "264E", referenceBoard: "DB-E", rect: [20, 20, 500, 700], directionFromEntrance: "Left of the gate" }, { id: "264F", referenceBoard: "DB-F", rect: [560, 20, 500, 700] }, { id: "Carpark", referenceBoard: "", rect: [1100, 20, 480, 400] },
        { id: "Playground", referenceBoard: "DB-P", meterLocations: ["Playground lights"], rect: [1100, 460, 480, 300] }, { id: "LED", referenceBoard: "DB-L", rect: [52, 190, 196, 40], independentSpace: false, physicalParentRoom: "264E Lobby", equipment: "Lift lobby LED" },
      ],
      rooms: [...blocks("264E", 40), ...blocks("264F", 580), room("Drive-in", "Carpark", [1120, 80, 200, 300]), room("Lots", "Carpark", [1340, 80, 220, 300]), room("Play area", "Playground", [1120, 520, 200, 220]), room("Fitness corner", "Playground", [1340, 520, 220, 220])],
      entrance: { label: "Main gate", position: [540, 860], referenceBoard: "DB-E" },
      devices: Array.from({ length: 19 }, (_, index) => ({ meterId: `m${index + 1}`, position: [60 + (index % 10) * 150, 120 + Math.floor(index / 10) * 400] })),
      boardMarkers: { "DB-E": [30, 30] },
    },
  } as unknown as StoredSpatialReference;
}

describe("layouts saved before this change", () => {
  it("load, zoom, pan, take keyboard focus and save back exactly as they were", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const original = estate(), estateMeters = Array.from({ length: 19 }, (_, index) => ({ id: `m${index + 1}`, name: `Meter ${index + 1}`, board: "DB-E", type: "Power" }));
    const plan = planFromReference(original);
    expect([plan.areas.length, plan.rooms.length, plan.devices.length, !!plan.entrance]).toEqual([5, 14, 19, true]);
    const view = await render({ previous: original, meters: estateMeters, projectId: "sktc", width: 800 });
    await act(async () => view.button("Zoom in (Ctrl++)").click());
    await view.send(view.canvas(), wheelAt({ deltaY: 80, clientX: 100, clientY: 100 }));
    await view.down(view.canvas(), [100, 100], { button: 1, pointerId: 9 }); await view.move([50, 80], { pointerId: 9 }); await view.up([50, 80], { pointerId: 9 });
    await act(async () => { view.canvas().focus(); });
    for (let step = 0; step < 6; step += 1) await view.press(document.activeElement!, "]");
    await view.press(document.activeElement!, "Enter");
    await act(async () => { vi.advanceTimersByTime(DRAFT_DELAY * 3); });
    expect(view.button("Undo").disabled).toBe(true);
    expect(localStorage.getItem(draftKey("sktc"))).toBeNull();
    expect(await view.saved()).toBe(view.notes);
    await view.unmount();
  });
});

describe("a big plan", () => {
  it("opens and drags smoothly with 200 rooms and 300 devices on a 10,000-unit canvas", async () => {
    const zones = Array.from({ length: 10 }, (_, index) => ({ id: `Block ${index + 1}`, referenceBoard: `DB${index + 1}`, rect: [100 + (index % 5) * 1960, 100 + Math.floor(index / 5) * 3100, 1900, 3000] }));
    const rooms = zones.flatMap((zone, block) => Array.from({ length: 20 }, (_, index) => ({ name: `Room ${block + 1}-${index + 1}`, zone: zone.id, rect: [zone.rect[0]! + 40 + (index % 4) * 460, zone.rect[1]! + 120 + Math.floor(index / 4) * 560, 420, 500] })));
    const bigMeters = Array.from({ length: 300 }, (_, index) => ({ id: `m${index}`, name: `Meter ${index}`, board: `DB${(index % 10) + 1}`, type: "Power" }));
    const devices = bigMeters.map((meter, index) => { const room = rooms[index % 200]!; return { meterId: meter.id, position: [room.rect[0]! + 40 + Math.floor(index / 200) * 120, room.rect[1]! + 200] }; });
    const big = { schemaVersion: 1, projectId: "office", provenance: { file: "plan", status: "Edited" }, layout: { viewBox: [0, 0, 10000, 6400], zones, rooms, devices } } as unknown as StoredSpatialReference;
    const started = performance.now();
    const view = await render({ previous: big, meters: bigMeters });
    const opened = performance.now() - started;
    expect(view.canvas().querySelectorAll("[data-item]").length).toBe(510);
    const room = view.item("room:room-7")!, [x, y] = view.rect("room:room-7");
    const from = view.at(x! + 50, y! + 50);
    const moving = performance.now();
    await view.down(room, from);
    for (let step = 1; step <= 10; step += 1) await view.move([from[0] + step * 2, from[1] + step]);
    await view.up([from[0] + 20, from[1] + 10]);
    const dragged = performance.now() - moving;
    expect(view.rect("room:room-7")[0]).toBe(x! + 200);
    // Generous limits: this only catches a plan that has become far too slow (for example, redrawing everything per move).
    expect(opened).toBeLessThan(15_000);
    expect(dragged).toBeLessThan(10_000);
    await view.unmount();
  }, 60_000);
});
