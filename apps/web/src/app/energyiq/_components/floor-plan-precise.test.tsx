/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readProjectSpatialReference } from "@datafoundry/contracts";
import { configApi } from "../../../lib/config-api";
import { EnergyIqLocaleProvider } from "./energyiq-locale";
import { FloorPlanEditor } from "./floor-plan-editor";
import { notesWithReference, type StoredSpatialReference } from "./floor-plan-model";
import { mapDevices, SiteFloorMap } from "./site-floor-map";

afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const meters = [{ id: "tv", name: "Showroom TV", board: "DB1", type: "Power" }, { id: "desk", name: "Office desk", board: "DB2", type: "Power" }];
/** Two blocks; the store sits at an odd x (547), off the grid, so lining up with it differs from snapping to the grid. */
const previous = {
  schemaVersion: 1, projectId: "office", provenance: { file: "plan", status: "Edited in Facility → Floor layout" },
  layout: {
    viewBox: [0, 0, 1000, 640],
    zones: [{ id: "Block 264E", referenceBoard: "DB1", rect: [20, 20, 460, 500] }, { id: "Block 264F", referenceBoard: "DB2", rect: [520, 20, 460, 500] }],
    rooms: [{ name: "Showroom", zone: "Block 264E", rect: [40, 80, 260, 200] }, { name: "Pantry", zone: "Block 264E", rect: [320, 300, 140, 120] }, { name: "Office", zone: "Block 264F", rect: [540, 80, 200, 150] }, { name: "Store", zone: "Block 264F", rect: [547, 300, 100, 100] }],
    devices: [{ meterId: "tv", position: [100, 150] }, { meterId: "desk", position: [600, 120] }],
  },
} as unknown as StoredSpatialReference;
const notes = notesWithReference("Office notes.", null, previous);
const block = readProjectSpatialReference(notes, "office")!.block;
const pointer = (type: string, x: number, y: number, extra: PointerEventInit = {}) => new PointerEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1, ...extra });
const setValue = (element: HTMLInputElement | HTMLSelectElement, value: string) => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")!.set!.call(element, value); };

async function render() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("React", React);
  const sent: string[] = [];
  vi.spyOn(configApi, "reportAgentRequest").mockImplementation(async (_project, path, options) => { if (!path) return { settings: { contextNotes: notes } } as never; sent.push(String(options?.body)); return {} as never; });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<EnergyIqLocaleProvider><FloorPlanEditor projectId="office" notes={notes} block={block} previous={previous} meters={meters} boards={["DB1", "DB2"]} onCancel={() => undefined} onSaved={() => undefined} /></EnergyIqLocaleProvider>));
  const canvas = () => host.querySelector('svg[role="application"]') as SVGSVGElement;
  const button = (label: string) => [...host.querySelectorAll("button")].find(item => item.textContent === label) as HTMLButtonElement;
  /** The tile whose name is `name` (an area's name starts with its panel, e.g. "DB2Block 264F"). */
  const tile = (name: string) => [...canvas().querySelectorAll("g")].find(item => item.querySelector("text")?.textContent === name) ?? [...canvas().querySelectorAll("g")].find(item => item.querySelector("text")?.textContent?.startsWith(name))!;
  const rect = (name: string) => { const box = tile(name).querySelector("rect")!; return ["x", "y", "width", "height"].map(key => Number(box.getAttribute(key))); };
  const down = async (target: Element, at: [number, number], extra: PointerEventInit = {}) => { await act(async () => { target.dispatchEvent(pointer("pointerdown", ...at, extra)); }); };
  const move = async (at: [number, number], extra: PointerEventInit = {}) => { await act(async () => { canvas().dispatchEvent(pointer("pointermove", ...at, extra)); }); };
  const up = async (at: [number, number]) => { await act(async () => { canvas().dispatchEvent(pointer("pointerup", ...at)); }); };
  const drag = async (target: Element, from: [number, number], to: [number, number], extra: PointerEventInit = {}) => { await down(target, from); await move([(from[0] + to[0]) / 2, (from[1] + to[1]) / 2], extra); await move(to, extra); await up(to); };
  const click = async (target: Element, at: [number, number], extra: PointerEventInit = {}) => { await down(target, at, extra); await up(at); };
  const press = async (target: EventTarget, key: string, extra: KeyboardEventInit = {}) => { const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra }); await act(async () => { target.dispatchEvent(event); }); return event.defaultPrevented; };
  const field = (legend: string) => [...host.querySelectorAll("aside fieldset")].find(item => item.querySelector("legend")?.textContent === legend) as HTMLFieldSetElement | undefined;
  const input = (legend: string, label: string) => [...field(legend)!.querySelectorAll("label")].find(item => item.querySelector("span")?.textContent === label)!.querySelector("input")!;
  /** Types into a field the way a person does: focus, type, then Enter (or leave the field with `leave`). */
  const type = async (element: HTMLInputElement, text: string, finish: "enter" | "leave" | "none" = "enter") => {
    await act(async () => { element.focus(); });
    await act(async () => { setValue(element, text); element.dispatchEvent(new Event("input", { bubbles: true })); });
    if (finish === "enter") await press(element, "Enter");
    if (finish === "leave") await act(async () => { element.blur(); });
  };
  const saved = async () => { await act(async () => button("Save layout").click()); return readProjectSpatialReference((JSON.parse(sent[sent.length - 1]!) as { contextNotes: string }).contextNotes, "office")!.reference as StoredSpatialReference; };
  return { host, canvas, button, tile, rect, down, move, up, drag, click, press, field, input, type, saved, unmount: async () => { await act(async () => root.unmount()); host.remove(); } };
}
type View = Awaited<ReturnType<typeof render>>;
const openGrid = async (view: View) => { await act(async () => view.button("Grid").click()); return view.host.querySelector('[role="group"][aria-label="Grid and snapping"]') as HTMLElement; };
const checkbox = (menu: HTMLElement, label: string) => [...menu.querySelectorAll("label")].find(item => item.textContent === label)!.querySelector("input")!;

describe("grid settings", () => {
  it("change the grid spacing, turn snapping off, hide the grid, and are saved with the layout without being undo steps", async () => {
    const view = await render();
    const menu = await openGrid(view);
    expect(view.button("Grid").getAttribute("aria-expanded")).toBe("true");
    expect(checkbox(menu, "Snap to the grid and other items").checked).toBe(true);
    expect(checkbox(menu, "Show the grid").checked).toBe(true);
    // A grid of 50: a 30-unit drag jumps a whole grid step.
    const select = menu.querySelector("select")!;
    expect([...select.options].map(option => option.textContent)).toEqual(["Fine (5)", "Normal (10)", "Wide (20)", "Extra wide (50)"]);
    await act(async () => { setValue(select, "50"); select.dispatchEvent(new Event("change", { bubbles: true })); });
    await view.drag(view.tile("Pantry"), [330, 310], [360, 310]);
    expect(view.rect("Pantry")[0]).toBe(370);
    // Undo takes the move back, not the grid choice.
    await act(async () => view.button("Undo").click());
    expect(view.rect("Pantry")[0]).toBe(320);
    expect(view.button("Undo").disabled).toBe(true);
    expect((view.host.querySelector('[aria-label="Grid and snapping"] select') as HTMLSelectElement).value).toBe("50");
    // Snapping off: things go exactly where they are put, with no guide lines.
    await act(async () => checkbox(menu, "Snap to the grid and other items").click());
    await view.down(view.tile("Pantry"), [330, 310]);
    await view.move([343, 310]);
    expect(view.canvas().querySelector("line[data-guide]")).toBeNull();
    await view.up([343, 310]);
    expect(view.rect("Pantry")[0]).toBe(333);
    // Hiding the grid leaves the empty space clickable.
    expect(view.canvas().querySelector("pattern#floor-plan-grid")).not.toBeNull();
    await act(async () => checkbox(menu, "Show the grid").click());
    expect(view.canvas().querySelector("pattern#floor-plan-grid")).toBeNull();
    expect(view.canvas().querySelector("rect[data-grid]")?.getAttribute("fill")).toBe("transparent");
    // The Grid button points at its group of settings (it is not a menu of commands).
    expect(view.button("Grid").getAttribute("aria-haspopup")).toBeNull();
    expect(view.button("Grid").getAttribute("aria-controls")).toBe(menu.id);
    // Esc closes the menu, puts focus back on the Grid button (never lost outside the editor), and leaves the selection alone.
    await act(async () => { checkbox(menu, "Show the grid").focus(); });
    await view.press(checkbox(menu, "Show the grid"), "Escape");
    expect(view.button("Grid").getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(view.button("Grid"));
    expect(view.host.querySelector("aside h5")?.textContent).toBe("Room");
    const reference = await view.saved();
    expect(reference.layout.editor).toEqual({ grid: 50, snap: false, showGrid: false });
    expect(reference.layout.rooms.find(room => room.name === "Pantry")!.rect).toEqual([333, 300, 140, 120]);
    await view.unmount();
  });

  it("holding Cmd or Ctrl while dragging places freely, even with snapping on", async () => {
    const view = await render();
    await view.down(view.tile("Pantry"), [330, 310]);
    await view.move([343, 310], { ctrlKey: true });
    await view.up([343, 310]);
    expect(view.rect("Pantry")[0]).toBe(333);
    await view.drag(view.tile("Pantry"), [340, 310], [353, 310], { metaKey: true });
    expect(view.rect("Pantry")[0]).toBe(346);
    // Without the key, the grid applies again.
    await view.drag(view.tile("Pantry"), [340, 310], [353, 310]);
    expect(view.rect("Pantry")[0]).toBe(356);
    await view.unmount();
  });
});

describe("alignment guides", () => {
  it("line a dragged item up with a nearby edge, draw a guide while dragging, and clear it on drop", async () => {
    const view = await render();
    // Office's left edge (540) is dragged 5 right: the store's left edge at 547 is within reach, so it lines up there
    // instead of jumping to the grid (550). Its device rides along.
    await view.down(view.tile("Office"), [560, 100]);
    await view.move([565, 100]);
    const guide = view.canvas().querySelector('line[data-guide="x"]')!;
    expect(guide.getAttribute("x1")).toBe("547");
    expect(Number(guide.getAttribute("y2"))).toBeGreaterThanOrEqual(400); // down to the store's bottom edge
    expect(view.rect("Office")[0]).toBe(547);
    await view.up([565, 100]);
    expect(view.canvas().querySelector("line[data-guide]")).toBeNull();
    expect(view.rect("Office")[0]).toBe(547);
    const desk = [...view.canvas().querySelectorAll("g")].find(item => item.querySelector("title")?.textContent?.startsWith("Office desk"))!.querySelector("circle:not([class*=selectRing])")!;
    expect(desk.getAttribute("cx")).toBe("607");
    // Resizing lines up too: the room's right edge (740) pulled to 645 meets the store's right edge (647).
    const east = view.canvas().querySelector('rect[data-handle="e"]')!;
    await view.drag(east, [747, 155], [652, 155]);
    expect(view.rect("Office")).toEqual([547, 80, 100, 150]);
    await view.unmount();
  });
});

describe("edge grips", () => {
  it("resize one side only from the middle of an edge", async () => {
    const view = await render();
    await view.click(view.tile("Office"), [560, 100]);
    expect([...view.canvas().querySelectorAll("rect[data-handle]")].map(item => item.getAttribute("data-handle")).sort()).toEqual(["e", "n", "ne", "nw", "s", "se", "sw", "w"]);
    await view.drag(view.canvas().querySelector('rect[data-handle="e"]')!, [740, 155], [787, 155]);
    expect(view.rect("Office")).toEqual([540, 80, 250, 150]);
    await view.drag(view.canvas().querySelector('rect[data-handle="n"]')!, [665, 80], [665, 50]);
    expect(view.rect("Office")).toEqual([540, 50, 250, 180]);
    // One undo step each.
    await act(async () => view.button("Undo").click());
    expect(view.rect("Office")).toEqual([540, 80, 250, 150]);
    await view.unmount();
  });
});

describe("line up", () => {
  it("aligns several items as one undo step", async () => {
    const view = await render();
    await view.click(view.tile("Pantry"), [330, 310]);
    await view.click(view.tile("Store"), [560, 310], { shiftKey: true });
    expect(view.host.querySelector("aside h5")?.textContent).toBe("2 items selected");
    expect(view.button("Space evenly across").disabled).toBe(true);
    // Each button explains itself beyond its one word, on hover and to screen readers ("Centre" and "Middle" differ).
    expect(view.button("Centre").getAttribute("aria-label")).toBe("Centre: Line up their centres on one up-and-down line");
    expect(view.button("Middle").title).toBe("Line up their middles on one side-to-side line");
    await act(async () => view.button("Left").click());
    expect(view.rect("Store")[0]).toBe(320);
    expect(view.rect("Pantry")[0]).toBe(320);
    await act(async () => view.button("Same width").click());
    expect(view.rect("Store")[2]).toBe(140);
    await act(async () => view.button("Undo").click());
    await act(async () => view.button("Undo").click());
    expect(view.rect("Store")).toEqual([547, 300, 100, 100]);
    expect(view.button("Undo").disabled).toBe(true);
    await view.unmount();
  });

  it("leaves locked items where they are, with a short note", async () => {
    const view = await render();
    await view.click(view.tile("Showroom"), [60, 100]);
    await act(async () => view.button("Lock in place").click());
    await view.click(view.tile("Pantry"), [330, 310], { shiftKey: true });
    await view.click(view.tile("Office"), [560, 100], { shiftKey: true });
    await act(async () => view.button("Bottom").click());
    expect(view.rect("Showroom")).toEqual([40, 80, 260, 200]);
    expect(view.rect("Office")[1]).toBe(420 - 150);
    expect(view.host.textContent).toContain("Locked items were left where they are.");
    // Spacing evenly needs three items that are not locked.
    expect(view.button("Space evenly across").disabled).toBe(false);
    await act(async () => view.button("Undo").click());
    expect(view.rect("Office")[1]).toBe(80);
    await view.unmount();
  });
});

describe("typed position and size", () => {
  it("uses a typed value on Enter as one undo step, with what is inside coming along", async () => {
    const view = await render();
    await view.click(view.tile("Office"), [560, 100]);
    expect(["X", "Y", "Width", "Height"].map(label => view.input("Position and size", label).value)).toEqual(["540", "80", "200", "150"]);
    // Screen readers hear what X means, not just "X".
    expect(view.input("Position and size", "X").getAttribute("aria-label")).toBe("X: From the left edge of the drawing space");
    const x = view.input("Position and size", "X");
    // Nothing moves while typing; arrow keys inside the field never nudge the plan.
    await view.type(x, "600", "none");
    expect(view.rect("Office")[0]).toBe(540);
    expect(await view.press(x, "ArrowRight")).toBe(false);
    expect(view.rect("Office")[0]).toBe(540);
    await view.press(x, "Enter");
    expect(view.rect("Office")[0]).toBe(600);
    const desk = () => [...view.canvas().querySelectorAll("g")].find(item => item.querySelector("title")?.textContent?.startsWith("Office desk"))!.querySelector("circle:not([class*=selectRing])")!.getAttribute("cx");
    expect(desk()).toBe("660");
    await act(async () => view.button("Undo").click());
    expect(view.rect("Office")[0]).toBe(540);
    expect(view.button("Undo").disabled).toBe(true);
    // Esc puts the value back without using it.
    await view.type(x, "700", "none");
    await view.press(x, "Escape");
    expect(x.value).toBe("540");
    expect(view.host.querySelector("aside h5")?.textContent).toBe("Room");
    await view.unmount();
  });

  it("says so plainly and puts the value back when it is not a number, and keeps sizes inside the plan", async () => {
    const view = await render();
    await view.click(view.tile("Office"), [560, 100]);
    const width = view.input("Position and size", "Width");
    await view.type(width, "wide", "leave");
    expect(view.field("Position and size")!.querySelector('[role="alert"]')?.textContent).toBe("Type a number, such as 120.");
    expect(width.value).toBe("200");
    expect(view.button("Undo").disabled).toBe(true);
    await view.type(width, "5000");
    expect(view.rect("Office")[2]).toBe(1000 - 540);
    expect(view.field("Position and size")!.textContent).toContain("Changed to fit inside the drawing space (at least 20 units).");
    await view.type(view.input("Position and size", "Height"), "3");
    expect(view.rect("Office")[3]).toBe(20);
    // A locked item's fields cannot be changed.
    await act(async () => view.button("Lock in place").click());
    expect(view.field("Position and size")!.disabled).toBe(true);
    await view.unmount();
  });
});

describe("typing, then pressing the plan straight away", () => {
  it("keeps a typed width when the item is dragged before Enter, with one undo step for each", async () => {
    const view = await render();
    await view.click(view.tile("Office"), [560, 100]);
    await view.type(view.input("Position and size", "Width"), "300", "none");
    await view.drag(view.tile("Office"), [560, 100], [560, 140]);
    expect(view.rect("Office")).toEqual([540, 120, 300, 150]);
    await act(async () => view.button("Undo").click());
    expect(view.rect("Office")).toEqual([540, 80, 300, 150]);
    await act(async () => view.button("Undo").click());
    expect(view.rect("Office")).toEqual([540, 80, 200, 150]);
    expect(view.button("Undo").disabled).toBe(true);
    await view.unmount();
  });

  it("keeps a typed width when a resize grip is pulled before Enter", async () => {
    const view = await render();
    await view.click(view.tile("Office"), [560, 100]);
    await view.type(view.input("Position and size", "Height"), "200", "none");
    const grip = view.canvas().querySelector('rect[data-handle="e"]')!;
    await view.drag(grip, [740, 155], [770, 155]);
    expect(view.rect("Office")[3]).toBe(200);
    expect(view.rect("Office")[2]).toBeGreaterThan(200);
    await view.unmount();
  });

  it("keeps a typed colour code when the item is dragged before Enter", async () => {
    const view = await render();
    await view.click(view.tile("Showroom"), [60, 100]);
    const code = view.field("Colour")!.querySelector('input:not([type="color"])') as HTMLInputElement;
    await view.type(code, "#1b9aaa", "none");
    await view.drag(view.tile("Showroom"), [60, 100], [60, 120]);
    expect(view.tile("Showroom").querySelector("rect")!.getAttribute("style")).toContain("#1b9aaa");
    expect(view.rect("Showroom").slice(0, 2)).toEqual([40, 100]);
    await act(async () => view.button("Undo").click());
    expect(view.rect("Showroom").slice(0, 2)).toEqual([40, 80]);
    expect(view.tile("Showroom").querySelector("rect")!.getAttribute("style")).toContain("#1b9aaa");
    await view.unmount();
  });

  it("keeps a typed width when an edge of the drawing space is pulled before Enter", async () => {
    const view = await render();
    await view.click(view.tile("Office"), [560, 100]);
    await view.type(view.input("Position and size", "Width"), "300", "none");
    const right = view.host.querySelector('button[aria-label="Drag to make the drawing space wider or narrower"]')!;
    await view.down(right, [1000, 300]);
    await act(async () => { right.dispatchEvent(pointer("pointermove", 1100, 300)); });
    await act(async () => { right.dispatchEvent(pointer("pointerup", 1100, 300)); });
    expect(view.rect("Office")[2]).toBe(300);
    expect(view.canvas().getAttribute("viewBox")).not.toBe("0 0 1000 640");
    // Focus stays in the editor, on the edge, so its keys still work.
    expect(document.activeElement).toBe(right);
    await act(async () => view.button("Undo").click());
    expect(view.canvas().getAttribute("viewBox")).toBe("0 0 1000 640");
    expect(view.rect("Office")[2]).toBe(300);
    await view.unmount();
  });
});

describe("custom colours", () => {
  it("take a typed #rrggbb code, refuse anything else with a plain message, and make a dragged colour picker one undo step", async () => {
    const view = await render();
    await view.click(view.tile("Showroom"), [60, 100]);
    let code = view.field("Colour")!.querySelector('input:not([type="color"])') as HTMLInputElement;
    await view.type(code, "#12");
    expect(view.field("Colour")!.querySelector('[role="alert"]')?.textContent).toBe("Type a colour code like #2a78d6.");
    expect(view.button("Undo").disabled).toBe(true);
    // The message belongs to that item: choosing another one starts its colour field afresh.
    await view.click(view.tile("Pantry"), [330, 310]);
    expect(view.field("Colour")!.querySelector('[role="alert"]')).toBeNull();
    await view.click(view.tile("Showroom"), [60, 100]);
    expect(view.field("Colour")!.querySelector('[role="alert"]')).toBeNull();
    code = view.field("Colour")!.querySelector('input:not([type="color"])') as HTMLInputElement;
    await view.type(code, "#1B9AAA");
    expect(view.tile("Showroom").querySelector("rect")!.getAttribute("style")).toContain("#1b9aaa");
    expect(view.field("Colour")!.querySelector('[role="alert"]')).toBeNull();
    await act(async () => view.button("Undo").click());
    expect(view.tile("Showroom").querySelector("rect")!.getAttribute("style") ?? "").not.toContain("#1b9aaa");
    // The computer's colour picker: every colour passed while dragging is one undo step.
    const well = view.field("Colour")!.querySelector('input[type="color"]') as HTMLInputElement;
    await act(async () => { well.focus(); });
    for (const hex of ["#ff0000", "#ee1100", "#dd2200"]) await act(async () => { setValue(well, hex); well.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { well.blur(); });
    expect(view.tile("Showroom").querySelector("rect")!.getAttribute("style")).toContain("#dd2200");
    await act(async () => view.button("Undo").click());
    expect(view.tile("Showroom").querySelector("rect")!.getAttribute("style") ?? "").not.toContain("#");
    expect(view.button("Undo").disabled).toBe(true);
    await view.unmount();
  });

  it("set a panel's colour for everyone on it, saved and drawn on the shared map in every style", async () => {
    const view = await render();
    await view.click(view.tile("DB2"), [900, 480]);
    expect(view.host.querySelector("aside h5")?.textContent).toBe("Area");
    const panel = view.field("Colour for everything on this panel")!;
    expect(panel.textContent).toContain("Everything on panel DB2 uses this colour");
    await act(async () => (panel.querySelector('button[aria-label="Red"]') as HTMLButtonElement).click());
    expect(view.tile("DB2").querySelector("rect")!.getAttribute("style")).toContain("#d6453d");
    // The live preview of the shared map shows it too.
    expect(view.host.querySelector('aside svg[data-look]')!.outerHTML).toContain("--area: #d6453d");
    const reference = await view.saved();
    expect(reference.layout.boardColours).toEqual({ DB2: "#d6453d" });
    await view.unmount();
    for (const style of ["drawing", "blueprint", "blocks"] as const) {
      const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
      const styled = { ...reference, layout: { ...reference.layout, style } } as StoredSpatialReference;
      await act(async () => root.render(<SiteFloorMap reference={styled} devices={mapDevices(styled, meters)} />));
      const svg = host.querySelector("svg")!;
      expect(svg.getAttribute("data-look")).toBe(style);
      expect(svg.outerHTML).toContain("--area: #d6453d");
      await act(async () => root.unmount()); host.remove();
    }
    // A colour that is not a #rrggbb code (saved data is untrusted) is never drawn.
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    const odd = { ...reference, layout: { ...reference.layout, boardColours: { DB2: "red;background:url(x)" } } } as StoredSpatialReference;
    await act(async () => root.render(<SiteFloorMap reference={odd} devices={mapDevices(odd, meters)} />));
    expect(host.innerHTML).not.toContain("url(x)");
    await act(async () => root.unmount()); host.remove();
  });
});

describe("a bigger drawing space", () => {
  it("grows to the left and upward from their edges, everything keeping its place relative to the rest", async () => {
    const view = await render();
    const left = view.host.querySelector('button[aria-label="Drag to make the drawing space wider or narrower on the left"]')!;
    await view.press(left, "ArrowLeft");
    expect(view.canvas().getAttribute("viewBox")).toBe("0 0 1050 640");
    expect([view.rect("Showroom")[0], view.rect("Office")[0], view.rect("Store")[0]]).toEqual([90, 590, 597]);
    const top = view.host.querySelector('button[aria-label="Drag to make the drawing space taller or shorter at the top"]')!;
    await view.press(top, "ArrowUp");
    expect(view.canvas().getAttribute("viewBox")).toBe("0 0 1050 690");
    expect(view.rect("Showroom").slice(0, 2)).toEqual([90, 130]);
    const reference = await view.saved();
    expect(reference.layout.viewBox).toEqual([0, 0, 1050, 690]);
    expect(reference.layout.devices!.map(device => device.position)).toEqual([[150, 200], [650, 170]]);
    await act(async () => view.button("Undo").click());
    await act(async () => view.button("Undo").click());
    expect(view.canvas().getAttribute("viewBox")).toBe("0 0 1000 640");
    expect(view.rect("Showroom")[0]).toBe(40);
    // Pulling it back in from the left moves its corner, never cutting anything off.
    await view.press(left, "ArrowRight");
    expect(view.canvas().getAttribute("viewBox")).toBe("0 0 1000 640");
    await view.unmount();
  });
});

describe("grid menu placement", () => {
  it("opens leftwards from the Grid button, and rightwards when that would leave the screen", async () => {
    // Where the open menu would sit: on a wide screen the Grid button is at the right end of the toolbar, so the
    // leftward menu has room; when the toolbar wraps and the button lands at the left edge, it would start off screen.
    let left = 600;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ left, right: left + 260, top: 0, bottom: 200, width: 260, height: 200, x: left, y: 0, toJSON: () => ({}) }) as DOMRect);
    const view = await render();
    const menu = await openGrid(view);
    expect(menu.getAttribute("data-edge")).toBe("right");
    await act(async () => view.button("Grid").click());
    left = -120;
    const flipped = await openGrid(view);
    expect(flipped.getAttribute("data-edge")).toBe("left");
    await view.unmount();
  });
});
