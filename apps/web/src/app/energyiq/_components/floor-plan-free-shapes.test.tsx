/** @vitest-environment happy-dom */
/**
 * Free shapes in the layout editor (slice 4): adding an L-shaped area, drawing a room corner by corner, editing corners,
 * plain shapes, and the map and site report drawing them in every plan style.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { insideSpatial, readProjectSpatialReference } from "@datafoundry/contracts";
import { configApi } from "../../../lib/config-api";
import { EnergyIqLocaleProvider } from "./energyiq-locale";
import { LANGUAGE_STORAGE_KEY } from "./energyiq-messages";
import { FloorPlanEditor } from "./floor-plan-editor";
import { notesWithReference, type StoredSpatialReference } from "./floor-plan-model";
import { mapDevices, SiteFloorMap } from "./site-floor-map";

afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const meters = [{ id: "tv", name: "Showroom TV", board: "DB1", type: "Power" }, { id: "desk", name: "Office desk", board: "DB2", type: "Power" }];
const previous = {
  schemaVersion: 1, projectId: "office", provenance: { file: "plan", status: "Edited in Facility → Floor layout" },
  layout: {
    viewBox: [0, 0, 1000, 640],
    zones: [{ id: "Block 264E", referenceBoard: "DB1", rect: [20, 20, 460, 500] }, { id: "Block 264F", referenceBoard: "DB2", rect: [520, 20, 460, 500] }],
    rooms: [{ name: "Showroom", zone: "Block 264E", rect: [40, 80, 260, 200] }, { name: "Office", zone: "Block 264F", rect: [540, 80, 200, 150] }],
    devices: [{ meterId: "tv", position: [100, 150] }, { meterId: "desk", position: [600, 120] }],
  },
} as unknown as StoredSpatialReference;
const notes = notesWithReference("Office notes.", null, previous);
const pointer = (type: string, x: number, y: number, extra: PointerEventInit = {}) => new PointerEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1, ...extra });

async function render(prev: StoredSpatialReference = previous) {
  const notes = notesWithReference("Office notes.", null, prev);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("React", React);
  const sent: string[] = [];
  vi.spyOn(configApi, "reportAgentRequest").mockImplementation(async (_project, path, options) => { if (!path) return { settings: { contextNotes: notes } } as never; sent.push(String(options?.body)); return {} as never; });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const block = readProjectSpatialReference(notes, "office")!.block;
  await act(async () => root.render(<EnergyIqLocaleProvider><FloorPlanEditor projectId="office" notes={notes} block={block} previous={prev} meters={meters} boards={["DB1", "DB2"]} onCancel={() => undefined} onSaved={() => undefined} /></EnergyIqLocaleProvider>));
  const canvas = () => host.querySelector('svg[role="application"]') as SVGSVGElement;
  const button = (label: string) => [...host.querySelectorAll("button")].find(item => item.textContent?.trim() === label) as HTMLButtonElement;
  const press = async (key: string, target: EventTarget = canvas(), init: KeyboardEventInit = {}) => { await act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })); }); };
  const click = async (at: [number, number], target: Element = canvas()) => { await act(async () => { target.dispatchEvent(pointer("pointerdown", ...at)); canvas().dispatchEvent(pointer("pointerup", ...at)); }); };
  const drag = async (target: Element, from: [number, number], to: [number, number]) => {
    await act(async () => { target.dispatchEvent(pointer("pointerdown", ...from)); });
    await act(async () => { canvas().dispatchEvent(pointer("pointermove", ...to)); });
    await act(async () => { canvas().dispatchEvent(pointer("pointerup", ...to)); });
  };
  const sweep = (from: [number, number], to: [number, number]) => drag(canvas(), from, to);
  const polygons = () => [...canvas().querySelectorAll("polygon")].filter(item => !item.closest("[data-drawing]"));
  const corners = () => canvas().querySelectorAll("circle[data-corner]");
  const save = async () => { await act(async () => button("Save layout").click()); return readProjectSpatialReference((JSON.parse(sent[sent.length - 1]!) as { contextNotes: string }).contextNotes, "office")!.reference as StoredSpatialReference; };
  return { host, canvas, button, press, click, drag, sweep, polygons, corners, save, unmount: async () => { await act(async () => root.unmount()); host.remove(); } };
}

describe("free-shape areas and rooms in the editor", () => {
  it("adds an L-shaped area, and saves its corners with the box around them", async () => {
    const view = await render();
    await act(async () => view.button("+ Add area").click());
    for (const label of ["Rectangle", "L-shape", "U-shape", "T-shape", "Draw shape"]) expect(view.button(label)).toBeDefined();
    expect(view.button("Circle")).toBeUndefined();
    await act(async () => view.button("L-shape").click());
    await view.sweep([40, 540], [300, 620]);
    expect(view.polygons()).toHaveLength(1);
    expect(view.corners()).toHaveLength(6);
    expect((view.host.querySelector("aside select") as HTMLSelectElement | null)).not.toBeNull();
    const saved = await view.save(), zone = saved.layout.zones[2] as { rect: number[]; points: number[][] };
    expect(zone.points).toHaveLength(6);
    const xs = zone.points.map(p => p[0]!), ys = zone.points.map(p => p[1]!);
    expect(zone.rect).toEqual([Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]);
    // The two areas and rooms saved before are written back exactly as they were.
    expect(saved.layout.zones.slice(0, 2)).toEqual(previous.layout.zones); expect(saved.layout.rooms).toEqual(previous.layout.rooms);
    await view.unmount();
  });

  it("draws a room corner by corner: Enter finishes, Backspace takes back a corner, Esc stops", async () => {
    const view = await render();
    await act(async () => view.button("+ Add room").click());
    await act(async () => view.button("Draw shape").click());
    expect(view.host.textContent).toContain("Click each corner of the shape in turn");
    for (const at of [[40, 300], [200, 300], [200, 360], [120, 360], [120, 460], [40, 460], [30, 470]] as Array<[number, number]>) await view.click(at);
    expect(view.host.textContent).toContain("7 corners so far.");
    await view.press("Backspace");
    expect(view.host.textContent).toContain("6 corners so far.");
    await view.press("Enter");
    expect(view.polygons()).toHaveLength(1);
    const saved = await view.save();
    expect(saved.layout.rooms[2]).toMatchObject({ zone: "Block 264E", rect: [40, 300, 160, 160], points: [[40, 300], [200, 300], [200, 360], [120, 360], [120, 460], [40, 460]] });
    // Esc stops drawing: nothing is added.
    await act(async () => view.button("+ Add room").click());
    await act(async () => view.button("Draw shape").click());
    await view.click([600, 300]); await view.click([700, 300]);
    expect(view.canvas().querySelector("[data-drawing]")).not.toBeNull();
    await view.press("Escape");
    expect(view.canvas().querySelector("[data-drawing]")).toBeNull();
    expect(view.polygons()).toHaveLength(1);
    await view.unmount();
  });

  it("refuses a shape that crosses itself with a plain message, and a double-click finishes a good one", async () => {
    const view = await render();
    await act(async () => view.button("+ Add room").click());
    await act(async () => view.button("Draw shape").click());
    for (const at of [[40, 300], [200, 460], [200, 300], [40, 460]] as Array<[number, number]>) await view.click(at);
    await act(async () => { view.canvas().dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
    expect(view.host.textContent).toContain("Those corners make a shape that crosses over itself");
    expect(view.polygons()).toHaveLength(0);
    await view.press("Backspace");
    await act(async () => { view.canvas().dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
    expect(view.polygons()).toHaveLength(1);
    await view.unmount();
  });

  it("drags a corner, adds one on a side, deletes one, turns the shape back into a box, and undoes", async () => {
    const view = await render();
    await act(async () => view.button("+ Add area").click());
    await act(async () => view.button("L-shape").click());
    await view.sweep([40, 540], [300, 620]);
    const before = view.polygons()[0]!.getAttribute("points")!;
    const first = view.corners()[0]!;
    await view.drag(first, [40, 540], [60, 530]);
    expect(view.polygons()[0]!.getAttribute("points")!.startsWith("60,530 ")).toBe(true);
    // A move that would make the shape cross itself is refused, and letting go says why.
    await view.drag(view.corners()[0]!, [60, 530], [400, 630]);
    expect(view.host.textContent).toContain("That shape crosses over itself");
    expect(view.polygons()[0]!.getAttribute("points")!.startsWith("60,530 ")).toBe(true);
    // Double-click a side to add a corner there; it comes back picked, ready to delete.
    await act(async () => { view.canvas().querySelector('line[data-side="5"]')!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 50, clientY: 580 })); });
    expect(view.corners()).toHaveLength(7);
    expect(view.host.textContent).toContain("Corner 7 of 7 picked.");
    await act(async () => view.button("Delete corner").click());
    expect(view.corners()).toHaveLength(6);
    await act(async () => view.button("Make rectangle").click());
    expect(view.polygons()).toHaveLength(0);
    await act(async () => view.button("Undo").click());
    expect(view.polygons()).toHaveLength(1);
    await act(async () => view.button("Undo").click()); await act(async () => view.button("Undo").click()); await act(async () => view.button("Undo").click());
    expect(view.polygons()[0]!.getAttribute("points")).toBe(before);
    await view.unmount();
  });
});

describe("plain shapes in the editor", () => {
  it("adds a circle with a caption, saves it under shapes, and keeps typing in the caption from deleting it", async () => {
    const view = await render();
    await act(async () => view.button("+ Add shape").click());
    await act(async () => view.button("Circle").click());
    await view.sweep([560, 540], [760, 620]);
    expect(view.canvas().querySelector("ellipse")).not.toBeNull();
    expect(view.host.querySelector("aside h5")?.textContent).toBe("Plain shape");
    const caption = view.host.querySelector('aside input[placeholder="e.g. Driveway"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => { setter.call(caption, "Car park"); caption.dispatchEvent(new Event("input", { bubbles: true })); });
    await view.press("Backspace", caption);
    expect(view.canvas().querySelector("ellipse")).not.toBeNull();
    const saved = await view.save(), shapes = (saved.layout as { shapes?: Array<Record<string, unknown>> }).shapes!;
    expect(shapes).toHaveLength(1);
    expect(shapes[0]).toMatchObject({ kind: "ellipse", rect: [560, 540, 200, 80], label: "Car park" });
    expect(String(shapes[0]!.fill)).toMatch(/^#[0-9a-f]{6}$/);
    // A plain shape holds nothing: the rooms and devices are saved as before.
    expect(saved.layout.rooms).toEqual(previous.layout.rooms);
    await view.unmount();
  });

  it("speaks the shape choices in Chinese and Malay", async () => {
    for (const [locale, add, words] of [["zh-Hans", "+ 添加区域", ["L 形", "自己画"]], ["ms", "+ Tambah kawasan", ["Bentuk L", "Lukis bentuk"]]] as const) {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
      const view = await render();
      await act(async () => view.button(add).click());
      for (const word of words) expect(view.button(word)).toBeDefined();
      expect(view.host.textContent).not.toContain("L-shape");
      await view.unmount();
      localStorage.clear();
    }
  });
});

describe("the map and the site report draw free shapes", () => {
  const shaped = {
    ...previous, layout: { ...previous.layout,
      zones: [{ id: "Block 264E", referenceBoard: "DB1", rect: [20, 20, 460, 500], points: [[20, 20], [480, 20], [480, 260], [250, 260], [250, 520], [20, 520]] }, previous.layout.zones[1]],
      rooms: [{ name: "Showroom", zone: "Block 264E", rect: [40, 80, 260, 200], points: [[40, 80], [300, 80], [300, 160], [140, 160], [140, 280], [40, 280]] }, { name: "Office", zone: "Block 264F", rect: [540, 80, 200, 150], points: "broken" }],
      devices: [{ meterId: "tv", position: [100, 150] }, { meterId: "desk", position: [400, 400] }],
      shapes: [{ id: "lawn", kind: "polygon", rect: [560, 300, 100, 100], points: [[560, 300], [660, 300], [560, 400]], fill: "#77bb77", label: "Lawn" }, { id: "pond", kind: "ellipse", rect: [700, 300, 80, 60], stroke: "dashed" }, { id: "bad", kind: "rect", rect: [800, 300, 50, 50], fill: "javascript:alert(1)" }],
    },
  } as unknown as StoredSpatialReference;

  it("draws polygons and plain shapes in every style, a box where points are malformed, and no automatic door on a shaped room", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("React", React);
    for (const style of ["drawing", "blueprint", "blocks"] as const) {
      const reference = { ...shaped, layout: { ...shaped.layout, style } } as StoredSpatialReference;
      const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
      await act(async () => root.render(<SiteFloorMap reference={reference} devices={mapDevices(reference, meters)} highlight={["DB1"]} />));
      const svg = host.querySelector("svg")!;
      expect(svg.getAttribute("data-look")).toBe(style);
      expect(svg.querySelectorAll('polygon[data-shape="outline"]')).toHaveLength(2);
      expect(svg.querySelectorAll('[data-shape="polygon"] polygon, [data-shape="ellipse"] ellipse, [data-shape="rect"] rect')).toHaveLength(3);
      expect(host.textContent).toContain("Lawn");
      expect(svg.innerHTML).not.toContain("javascript");
      // The Office's broken points fall back to its box.
      expect([...svg.querySelectorAll("rect")].some(rect => rect.getAttribute("x") === "540" && rect.getAttribute("width") === "200")).toBe(true);
      // Automatic doors: the shaped Showroom gets none, so there is one door fewer than on the same plan drawn as boxes.
      const doors = svg.querySelectorAll("path[stroke-dasharray]").length;
      await act(async () => root.unmount()); host.remove();
      const boxes = { ...previous, layout: { ...previous.layout, style } } as StoredSpatialReference;
      const plainHost = document.createElement("div"); document.body.append(plainHost); const plainRoot = createRoot(plainHost);
      await act(async () => plainRoot.render(<SiteFloorMap reference={boxes} devices={mapDevices(boxes, meters)} />));
      const boxDoors = plainHost.querySelectorAll("svg path[stroke-dasharray]").length;
      expect(doors).toBe(style === "blocks" ? 0 : boxDoors - 1);
      await act(async () => plainRoot.unmount()); plainHost.remove();
    }
  });

  it("has plain-shape styles for every plan look and for dark mode", () => {
    const css = readFileSync(join(__dirname, "site-floor-map.module.css"), "utf8");
    for (const rule of [".planShape {", ".lookBlueprint .planShape", ".lookBlocks .planShape", 'data-energyiq-theme="dark"])) .planShape']) expect(css).toContain(rule);
    const editorCss = readFileSync(join(__dirname, "floor-plan-editor.module.css"), "utf8");
    for (const rule of [".plainShape {", ".corner {", ".drawLine {", 'data-energyiq-theme="dark"])) .corner']) expect(editorCss).toContain(rule);
  });
});

describe("free-shape keys and placing (review fixes)", () => {
  const item = (view: Awaited<ReturnType<typeof render>>, id: string) => view.canvas().querySelector(`[data-item="${id}"]`) as SVGElement;

  it("never deletes the selection with Backspace while drawing, even with no corners left, and Undo takes back a corner", async () => {
    const view = await render();
    await view.press("Enter", item(view, "area:Block 264E"));
    expect(view.host.querySelector("aside h5")?.textContent).toBeTruthy();
    await act(async () => view.button("+ Add room").click());
    await act(async () => view.button("Draw shape").click());
    await view.click([600, 300]); await view.click([700, 300]);
    await view.press("z", view.canvas(), { ctrlKey: true });
    expect(view.host.textContent).toContain("1 corners so far.");
    for (let i = 0; i < 3; i += 1) await view.press("Backspace");
    expect(view.canvas().querySelector("[data-drawing]")?.getAttribute("data-drawing") ?? "0").toBe("0");
    expect(item(view, "area:Block 264E")).not.toBeNull();
    await view.press("Escape");
    const saved = await view.save();
    expect(saved.layout.zones).toEqual(previous.layout.zones);
    await view.unmount();
  });

  it("deletes the picked corner with the Delete key, not the whole area", async () => {
    const view = await render();
    await act(async () => view.button("+ Add area").click());
    await act(async () => view.button("L-shape").click());
    await view.sweep([40, 540], [300, 620]);
    await view.click([40, 540], view.corners()[0]!);
    expect(view.host.textContent).toContain("Corner 1 of 6 picked.");
    await view.press("Delete");
    expect(view.polygons()).toHaveLength(1);
    expect(view.corners()).toHaveLength(5);
    await view.unmount();
  });

  it("picks, moves and deletes corners from the keyboard, and adds one with Add corner", async () => {
    const view = await render();
    await act(async () => view.button("+ Add area").click());
    await act(async () => view.button("L-shape").click());
    await view.sweep([40, 540], [300, 620]);
    const grip = view.corners()[0]! as SVGCircleElement;
    expect(grip.getAttribute("role")).toBe("button"); expect(grip.getAttribute("tabindex")).toBe("0");
    await act(async () => { grip.dispatchEvent(new FocusEvent("focusin", { bubbles: true })); });
    expect(view.host.textContent).toContain("Corner 1 of 6 picked.");
    await view.press("ArrowRight", grip);
    const [x, y] = view.polygons()[0]!.getAttribute("points")!.split(" ")[0]!.split(",").map(Number);
    expect(x).toBeGreaterThan(40); expect(y).toBe(540);
    await act(async () => view.button("Add corner").click());
    expect(view.corners()).toHaveLength(7);
    expect(view.host.textContent).toContain("Corner 2 of 7 picked.");
    await view.press("Delete", view.corners()[1]!);
    expect(view.corners()).toHaveLength(6);
    expect(view.polygons()).toHaveLength(1);
    await view.unmount();
  });

  it("places a device with Enter inside an L-shaped room, never in its notch", async () => {
    const lRoom = { ...previous, layout: { ...previous.layout,
      rooms: [{ name: "Showroom", zone: "Block 264E", rect: [40, 80, 260, 200], points: [[40, 80], [157, 80], [157, 190], [300, 190], [300, 280], [40, 280]] }, previous.layout.rooms[1]],
      devices: [{ meterId: "desk", position: [600, 120] }] } } as unknown as StoredSpatialReference;
    const view = await render(lRoom);
    const place = [...view.host.querySelectorAll("aside li")].find(row => row.textContent?.includes("Showroom TV"))!.querySelector("button")!;
    await act(async () => place.click());
    await view.press("Enter", item(view, "room:room-1"));
    const saved = await view.save(), tv = saved.layout.devices.find(device => device.meterId === "tv")!;
    expect(insideSpatial(saved.layout.rooms[0]!, tv.position as [number, number])).toBe(true);
    await view.unmount();
  });

  it("adds a room with Enter inside a selected shaped area whose top-left is a notch", async () => {
    const notched = { ...previous, layout: { ...previous.layout,
      zones: [{ id: "Block 264E", referenceBoard: "DB1", rect: [20, 20, 460, 500], points: [[260, 20], [480, 20], [480, 520], [20, 520], [20, 300], [260, 300]] }, previous.layout.zones[1]],
      rooms: [previous.layout.rooms[1]], devices: [{ meterId: "desk", position: [600, 120] }] } } as unknown as StoredSpatialReference;
    const view = await render(notched);
    await view.press("Enter", item(view, "area:Block 264E"));
    await act(async () => view.button("+ Add room").click());
    await view.press("Enter");
    expect(view.host.textContent).not.toContain("Rooms go inside an area.");
    const saved = await view.save();
    expect(saved.layout.rooms).toHaveLength(2);
    expect(saved.layout.rooms[1]!.zone).toBe("Block 264E");
    expect(insideSpatial(saved.layout.zones[0]!, [saved.layout.rooms[1]!.rect[0] + saved.layout.rooms[1]!.rect[2] / 2, saved.layout.rooms[1]!.rect[1] + saved.layout.rooms[1]!.rect[3] / 2])).toBe(true);
    await view.unmount();
  });

  it("shows a plain shape in the editor exactly when the map draws it", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("React", React);
    const shapes = [{ id: "lawn 1", kind: "rect", rect: [560, 540, 80, 40] }, { id: "half", kind: "rect", rect: [960, 540, 80, 40] }, { id: "pond", kind: "ellipse", rect: [700, 540, 80, 40] }, { id: "pond", kind: "rect", rect: [800, 540, 60, 40] }];
    const withShapes = { ...previous, layout: { ...previous.layout, shapes } } as unknown as StoredSpatialReference;
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await act(async () => root.render(<SiteFloorMap reference={withShapes} devices={mapDevices(withShapes, meters)} />));
    expect(host.querySelectorAll("svg [data-shape]:not([data-shape=outline])")).toHaveLength(2);
    expect(errors.mock.calls.some(call => String(call[0]).includes("same key"))).toBe(false);
    await act(async () => root.unmount()); host.remove();
    const view = await render(withShapes);
    expect(view.canvas().querySelectorAll('[data-item^="shape:"]')).toHaveLength(2);
    const saved = await view.save();
    expect((saved.layout as { shapes?: unknown }).shapes).toEqual(shapes);
    await view.unmount();
  });
});
