/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readProjectSpatialReference } from "@datafoundry/contracts";
import { configApi } from "../../../lib/config-api";
import { EnergyIqLocaleProvider } from "./energyiq-locale";
import { LANGUAGE_STORAGE_KEY } from "./energyiq-messages";
import { FloorPlanEditor } from "./floor-plan-editor";
import { notesWithReference, planFromReference, referenceFromPlan, type StoredSpatialReference } from "./floor-plan-model";
import { mapDevices, SiteFloorMap } from "./site-floor-map";

afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const meters = [{ id: "tv", name: "Showroom TV", board: "DB1", type: "Power" }, { id: "desk", name: "Office desk", board: "DB2", type: "Power" }];
const previous = {
  schemaVersion: 1, projectId: "office", provenance: { file: "plan", status: "Edited in Facility → Floor layout" },
  layout: {
    viewBox: [0, 0, 1000, 640],
    zones: [{ id: "Block 264E", referenceBoard: "DB1", rect: [20, 20, 460, 500] }, { id: "Block 264F", referenceBoard: "DB2", rect: [520, 20, 460, 500], meterLocations: ["264F"] }],
    rooms: [{ name: "Showroom", zone: "Block 264E", rect: [40, 80, 260, 200] }, { name: "Pantry", zone: "Block 264E", rect: [320, 80, 140, 120] }, { name: "Office", zone: "Block 264F", rect: [540, 80, 200, 150] }],
    devices: [{ meterId: "tv", position: [100, 150] }, { meterId: "desk", position: [600, 120] }],
  },
} as unknown as StoredSpatialReference;
const notes = notesWithReference("Office notes.", null, previous);
const block = readProjectSpatialReference(notes, "office")!.block;
const pointer = (type: string, x: number, y: number, extra: PointerEventInit = {}) => new PointerEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1, ...extra });

async function render(saved: StoredSpatialReference = previous) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("React", React);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const text = saved === previous ? notes : notesWithReference("Office notes.", null, saved), found = saved === previous ? block : readProjectSpatialReference(text, "office")!.block;
  await act(async () => root.render(<EnergyIqLocaleProvider><FloorPlanEditor projectId="office" notes={text} block={found} previous={saved} meters={meters} boards={["DB1", "DB2"]} onCancel={() => undefined} onSaved={() => undefined} /></EnergyIqLocaleProvider>));
  const canvas = () => host.querySelector('svg[role="application"]') as SVGSVGElement;
  const button = (label: string) => [...host.querySelectorAll("button")].find(item => item.textContent === label) as HTMLButtonElement;
  /** Presses a key; says whether the editor kept the browser from acting on it too. */
  const press = async (key: string, extra: KeyboardEventInit = {}, target: EventTarget = canvas()) => { const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra }); await act(async () => { target.dispatchEvent(event); }); return event.defaultPrevented; };
  /** The room tile showing `name`, and where its rectangle is. */
  const roomTile = (name: string) => [...canvas().querySelectorAll("g")].find(item => item.querySelector("text")?.textContent === name);
  const roomX = (name: string) => roomTile(name)?.querySelector("rect")?.getAttribute("x");
  const roomNames = () => [...canvas().querySelectorAll("g")].filter(item => item.querySelector('rect[class*="room"]')).map(item => item.querySelector("text")?.textContent);
  const sweep = async (from: [number, number], to: [number, number], extra: PointerEventInit = {}, target: Element = canvas()) => {
    await act(async () => { target.dispatchEvent(pointer("pointerdown", ...from, extra)); });
    await act(async () => { canvas().dispatchEvent(pointer("pointermove", (from[0] + to[0]) / 2, (from[1] + to[1]) / 2, extra)); });
    await act(async () => { canvas().dispatchEvent(pointer("pointermove", ...to, extra)); });
    await act(async () => { canvas().dispatchEvent(pointer("pointerup", ...to, extra)); });
  };
  const click = async (target: Element, at: [number, number] = [0, 0], extra: PointerEventInit = {}) => { await act(async () => { target.dispatchEvent(pointer("pointerdown", ...at, extra)); canvas().dispatchEvent(pointer("pointerup", ...at, extra)); }); };
  const heading = () => host.querySelector("aside h5")?.textContent;
  return { host, canvas, button, press, roomTile, roomX, roomNames, sweep, click, heading, unmount: async () => { await act(async () => root.unmount()); host.remove(); } };
}

describe("drag to draw", () => {
  it("draws a room in the box dragged on the plan, as one undo step, and Esc stops drawing", async () => {
    const view = await render();
    await act(async () => view.button("+ Add room").click());
    expect(view.button("+ Add room").getAttribute("aria-pressed")).toBe("true");
    expect(view.host.querySelector('[role="status"]')?.textContent).toContain("Drag a box on the plan to draw the room");
    await view.sweep([560, 300], [702, 398]);
    const added = view.roomTile("New room 4")!.querySelector("rect")!;
    expect([added.getAttribute("x"), added.getAttribute("y"), added.getAttribute("width"), added.getAttribute("height")]).toEqual(["560", "300", "140", "100"]);
    expect(view.heading()).toBe("Room");
    // The tool is used once; one undo takes the room away again.
    expect(view.button("+ Add room").getAttribute("aria-pressed")).toBe("false");
    await act(async () => view.button("Undo").click());
    expect(view.roomTile("New room 4")).toBeUndefined();
    expect(view.button("Undo").disabled).toBe(true);
    // Esc stops drawing: a click afterwards adds nothing.
    await act(async () => view.button("+ Add area").click());
    await view.press("Escape");
    expect(view.host.querySelector('[role="status"]')).toBeNull();
    await view.click(view.canvas(), [700, 560]);
    expect(view.button("Undo").disabled).toBe(true);
    await view.unmount();
  });

  it("adds an item at its usual size with a single click, and Enter adds one from the keyboard", async () => {
    const view = await render();
    await act(async () => view.button("+ Add area").click());
    await view.click(view.canvas(), [500, 560]);
    expect([...view.canvas().querySelectorAll("text")].map(text => text.textContent)).toContain("Area A");
    expect(view.heading()).toBe("Area");
    await act(async () => view.button("+ Add room").click());
    await view.press("Enter");
    expect(view.roomNames()).toContain("New room 4");
    // Equipment must go inside a room.
    await act(async () => view.button("+ Add equipment inside a room").click());
    await view.click(view.canvas(), [990, 630]);
    expect(view.host.textContent).toContain("Equipment goes inside a room. Draw it over a room.");
    await view.unmount();
  });

  it("does not add a room drawn outside every area, says why, and keeps the tool on", async () => {
    const view = await render();
    await act(async () => view.button("+ Add room").click());
    await view.click(view.canvas(), [700, 600]);
    await view.sweep([600, 560], [760, 630]);
    expect(view.roomNames()).toEqual(["Showroom", "Pantry", "Office"]);
    expect(view.host.textContent).toContain("Rooms go inside an area. Draw it over an area, or add an area first.");
    expect(view.button("+ Add room").getAttribute("aria-pressed")).toBe("true");
    expect(view.button("Undo").disabled).toBe(true);
    // Cancel on the drawing line stops drawing and clears the message.
    await act(async () => (view.host.querySelector('[role="status"] button') as HTMLButtonElement).click());
    expect(view.host.textContent).not.toContain("Rooms go inside an area");
    await view.unmount();
  });
});

describe("selecting several items", () => {
  it("selects with a box and Shift-click, then moves them together as one undo step without moving anything twice", async () => {
    const view = await render();
    // The box takes Showroom, Pantry and the TV on the showroom wall, but not Block 264E, which it only partly covers.
    await view.sweep([30, 70], [470, 300]);
    expect(view.heading()).toBe("3 items selected");
    await view.click(view.roomTile("Office")!, [560, 100], { shiftKey: true });
    expect(view.heading()).toBe("4 items selected");
    await view.click(view.roomTile("Office")!, [560, 100], { metaKey: true });
    expect(view.heading()).toBe("3 items selected");
    await view.click(view.roomTile("Office")!, [560, 100], { ctrlKey: true });
    // Dragging one of them drags all four; the TV is selected and rides on the showroom, and still moves only once.
    await view.sweep([60, 100], [80, 120], {}, view.roomTile("Showroom")!);
    expect([view.roomX("Showroom"), view.roomX("Pantry"), view.roomX("Office")]).toEqual(["60", "340", "560"]);
    const tv = () => [...view.canvas().querySelectorAll("g")].find(item => item.querySelector("title")?.textContent?.startsWith("Showroom TV"))!.querySelector("circle:not([class*=selectRing])")!;
    expect([tv().getAttribute("cx"), tv().getAttribute("cy")]).toEqual(["120", "170"]);
    // Arrow keys nudge them all; Undo goes back one action at a time.
    await view.press("ArrowRight");
    expect([view.roomX("Showroom"), view.roomX("Office")]).toEqual(["70", "570"]);
    await act(async () => view.button("Undo").click());
    await act(async () => view.button("Undo").click());
    expect([view.roomX("Showroom"), view.roomX("Pantry"), view.roomX("Office")]).toEqual(["40", "320", "540"]);
    expect(view.button("Undo").disabled).toBe(true);
    // A plain click on one of them, without dragging, picks just that one.
    await view.click(view.roomTile("Pantry")!, [330, 90]);
    expect(view.heading()).toBe("Room");
    await view.unmount();
  });

  it("boxes the rooms inside an area with Shift-drag, Shift-click on an area adds it, and Shift-click takes an item out", async () => {
    const view = await render();
    const block = () => view.canvas().querySelector("g")!;
    // Pressing inside Block 264E with Shift starts a box instead of moving the block.
    await view.sweep([30, 70], [470, 300], { shiftKey: true }, block());
    expect(view.heading()).toBe("3 items selected");
    expect(block().querySelector("rect")!.getAttribute("x")).toBe("20");
    expect(view.button("Undo").disabled).toBe(true);
    // A Shift-click on the block, without dragging, adds the block itself.
    await view.click(block(), [30, 30], { shiftKey: true });
    expect(view.heading()).toBe("4 items selected");
    // A Shift-click on a selected item takes it out, and starts no drag (no undo step).
    await view.sweep([60, 100], [120, 160], { shiftKey: true }, view.roomTile("Showroom")!);
    expect(view.heading()).toBe("3 items selected");
    expect(view.roomX("Showroom")).toBe("40");
    expect(view.button("Undo").disabled).toBe(true);
    // Esc in the middle of a selection box drops it.
    await act(async () => { view.canvas().dispatchEvent(pointer("pointerdown", 990, 630)); view.canvas().dispatchEvent(pointer("pointermove", 900, 560)); });
    expect(view.canvas().querySelector('rect[class*="marquee"]')).not.toBeNull();
    await view.press("Escape");
    expect(view.canvas().querySelector('rect[class*="marquee"]')).toBeNull();
    await view.unmount();
  });

  it("selects everything with Cmd/Ctrl+A only inside the editor, and deletes the selection together", async () => {
    const view = await render();
    await view.press("a", { metaKey: true }, document.body);
    expect(view.heading()).not.toMatch(/selected/);
    await view.press("a", { ctrlKey: true });
    expect(view.heading()).toBe("7 items selected");
    await view.press("Delete");
    expect(view.roomNames()).toEqual([]);
    await act(async () => view.button("Undo").click());
    expect(view.roomNames()).toEqual(["Showroom", "Pantry", "Office"]);
    await view.unmount();
  });
});

describe("duplicate, copy and paste", () => {
  it("duplicates an area with its rooms (not its devices) and pastes copies one grid step apart, each one undo step", async () => {
    const view = await render();
    const area = () => view.canvas().querySelector("g")!;
    await view.click(area(), [30, 30]);
    expect(view.heading()).toBe("Area");
    await view.press("d", { metaKey: true });
    expect(view.roomNames()).toEqual(["Showroom", "Pantry", "Office", "Showroom 2", "Pantry 2"]);
    expect(view.roomX("Showroom 2")).toBe("50");
    expect((view.host.querySelector("aside input") as HTMLInputElement).value).toBe("Block 264E copy");
    expect(view.canvas().querySelectorAll("title").length).toBe(2);
    await act(async () => view.button("Undo").click());
    expect(view.roomNames()).toEqual(["Showroom", "Pantry", "Office"]);
    // The panel's Duplicate button does the same.
    await act(async () => view.button("Duplicate").click());
    expect(view.roomNames()).toHaveLength(5);
    await act(async () => view.button("Undo").click());
    // Copy, then paste twice: each paste lands one more grid step on.
    await view.click(view.roomTile("Office")!, [560, 100]);
    await view.press("c", { ctrlKey: true });
    expect(view.host.textContent).toContain("Copied. Press Ctrl+V to paste.");
    await view.press("v", { ctrlKey: true });
    await view.press("v", { ctrlKey: true });
    expect([view.roomX("Office 2"), view.roomX("Office 3")]).toEqual(["550", "560"]);
    await act(async () => view.button("Undo").click());
    expect(view.roomTile("Office 3")).toBeUndefined();
    await view.unmount();
  });

  it("leaves copy and paste alone outside the editor and in its fields, and never copies a device", async () => {
    const view = await render();
    await view.click(view.roomTile("Office")!, [560, 100]);
    const name = view.host.querySelector("aside input") as HTMLInputElement;
    for (const target of [document.body, name]) for (const key of ["c", "v", "d"]) await view.press(key, { metaKey: true }, target);
    expect(view.roomNames()).toEqual(["Showroom", "Pantry", "Office"]);
    expect(view.host.textContent).not.toContain("Copied.");
    // A device alone: nothing to copy, and the reader is told why.
    const tv = [...view.canvas().querySelectorAll("g")].find(item => item.querySelector("title")?.textContent?.startsWith("Showroom TV"))!;
    await view.click(tv, [100, 150]);
    await view.press("d", { ctrlKey: true });
    expect(view.host.textContent).toContain("Devices and the entrance are not copied");
    expect(view.button("Duplicate")).toBeUndefined();
    // A new selection clears that message.
    await view.click(view.roomTile("Office")!, [560, 100]);
    expect(view.host.textContent).not.toContain("Devices and the entrance are not copied");
    // A room and a device: the room is copied, and the reader is told why the device was not.
    await view.click(tv, [100, 150], { shiftKey: true });
    await view.press("d", { ctrlKey: true });
    expect(view.roomNames()).toContain("Office 2");
    expect(view.host.textContent).toContain("Devices and the entrance are not copied");
    await view.unmount();
  });

  it("keeps Cmd/Ctrl+D as Duplicate with nothing selected, so the browser's bookmark dialog never opens", async () => {
    const view = await render();
    expect(await view.press("d", { metaKey: true })).toBe(true);
    expect(view.button("Undo").disabled).toBe(true);
    await view.unmount();
  });

  it("refuses a copy the plan could not save, and says how many areas and rooms a plan holds", async () => {
    const crowded = { ...previous, layout: { ...previous.layout, rooms: [...previous.layout.rooms, ...Array.from({ length: 196 }, (_, index) => ({ name: `Desk ${index + 1}`, zone: "Block 264E", rect: [30 + (index % 20) * 22, 290 + Math.floor(index / 20) * 22, 20, 20] }))] } } as StoredSpatialReference;
    const view = await render(crowded);
    await view.click(view.roomTile("Office")!, [560, 100]);
    await view.press("d", { ctrlKey: true });
    expect(view.roomNames()).toHaveLength(200);
    await view.press("d", { ctrlKey: true });
    expect(view.roomNames()).toHaveLength(200);
    expect(view.host.textContent).toContain("A plan can hold up to 100 areas and 200 rooms. Remove some, then try again.");
    await view.unmount();
  });

  it("drags out a copy with Alt, leaving the original where it was", async () => {
    const view = await render();
    await view.sweep([560, 100], [660, 100], { altKey: true }, view.roomTile("Office")!);
    expect([view.roomX("Office"), view.roomX("Office 2")]).toEqual(["540", "640"]);
    await act(async () => view.button("Undo").click());
    expect(view.roomTile("Office 2")).toBeUndefined();
    // An Alt-click that never moves adds nothing.
    await view.click(view.roomTile("Office")!, [560, 100], { altKey: true });
    expect(view.roomTile("Office 2")).toBeUndefined();
    expect(view.button("Undo").disabled).toBe(true);
    await view.unmount();
  });
});

describe("lock and drawing order", () => {
  it("locks an item so it cannot be dragged, resized, nudged or deleted until unlocked", async () => {
    const view = await render();
    await view.click(view.roomTile("Office")!, [560, 100]);
    // Four corner grips and four edge grips.
    expect(view.canvas().querySelectorAll('rect[class*="handle"]').length).toBe(8);
    await act(async () => view.button("Lock in place").click());
    expect(view.canvas().querySelector('g[aria-label="Locked"] title')?.textContent).toBe("Locked");
    expect(view.canvas().querySelectorAll('rect[class*="handle"]').length).toBe(0);
    expect(view.button("Delete room").disabled).toBe(true);
    await view.press("ArrowRight");
    await view.press("Delete");
    await view.sweep([560, 100], [700, 100], {}, view.roomTile("Office")!);
    expect(view.roomX("Office")).toBe("540");
    expect(view.host.textContent).toContain("Locked items stay where they are.");
    // The button's label says what it does, so it is not announced as a pressed toggle.
    expect(view.button("Unlock").hasAttribute("aria-pressed")).toBe(false);
    await act(async () => view.button("Unlock").click());
    await view.press("ArrowRight");
    expect(view.roomX("Office")).toBe("550");
    // Lock, unlock and nudge: three undo steps.
    for (let step = 0; step < 3; step += 1) await act(async () => view.button("Undo").click());
    expect(view.button("Undo").disabled).toBe(true);
    await view.unmount();
  });

  it("Alt-drags an unlocked copy out of a locked room, leaving the original locked where it was", async () => {
    const view = await render();
    await view.click(view.roomTile("Office")!, [560, 100]);
    await act(async () => view.button("Lock in place").click());
    await view.sweep([560, 100], [660, 100], { altKey: true }, view.roomTile("Office")!);
    expect([view.roomX("Office"), view.roomX("Office 2")]).toEqual(["540", "640"]);
    expect(view.button("Lock in place")).toBeDefined();
    await view.click(view.roomTile("Office")!, [560, 100]);
    expect(view.button("Unlock")).toBeDefined();
    await view.unmount();
  });

  it("brings a room to the front, saves that order, and the map draws in it in every style", async () => {
    const sent: string[] = [];
    vi.spyOn(configApi, "reportAgentRequest").mockImplementation(async (_project, path, options) => { if (!path) return { settings: { contextNotes: notes } } as never; sent.push(String(options?.body)); return {} as never; });
    const view = await render();
    await view.click(view.roomTile("Showroom")!, [60, 100]);
    expect(view.button("Send to back").disabled).toBe(true);
    await act(async () => view.button("Bring to front").click());
    expect(view.roomNames()).toEqual(["Pantry", "Office", "Showroom"]);
    expect(view.button("Bring to front").disabled).toBe(true);
    await act(async () => view.button("Lock in place").click());
    await act(async () => view.button("Save layout").click());
    const saved = readProjectSpatialReference((JSON.parse(sent[0]!) as { contextNotes: string }).contextNotes, "office")!.reference as StoredSpatialReference;
    expect(saved.layout.rooms.map(room => room.name)).toEqual(["Pantry", "Office", "Showroom"]);
    expect(saved.layout.rooms[2]).toEqual({ name: "Showroom", zone: "Block 264E", rect: [40, 80, 260, 200], locked: true });
    await view.unmount();
    for (const style of ["drawing", "blueprint", "blocks"] as const) {
      const reference = { ...saved, layout: { ...saved.layout, style } } as StoredSpatialReference;
      const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
      await act(async () => root.render(<SiteFloorMap reference={reference} devices={mapDevices(reference, meters)} />));
      expect(host.querySelector("svg")?.getAttribute("data-look")).toBe(style);
      expect([...host.querySelectorAll("g[style] text")].map(text => text.textContent).filter(name => ["Pantry", "Office", "Showroom"].includes(name ?? ""))).toEqual(["Pantry", "Office", "Showroom"]);
      await act(async () => root.unmount()); host.remove();
    }
  });

  it("shows the new tools in Chinese and Malay", async () => {
    for (const [language, words] of [["zh-Hans", ["移到最前", "锁定位置", "创建副本"]], ["ms", ["Bawa ke hadapan", "Kunci di tempatnya", "Pendua"]]] as const) {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
      const view = await render();
      await view.click(view.roomTile("Office")!, [560, 100]);
      for (const word of words) expect(view.button(word)).toBeDefined();
      await view.unmount();
    }
  });
});

/** A layout saved before this change: an estate with five areas (one is equipment), 14 rooms, 19 devices and an entrance. */
function estate(style?: string): StoredSpatialReference {
  const room = (name: string, zone: string, rect: [number, number, number, number]) => ({ name, zone, rect });
  const blocks = (block: string, x: number) => ["Lobby", "Store", "Bin centre", "Lift motor room", "Corridors L1-L17"].map((name, index) => room(`${block} ${name}`, block, [x + (index % 2) * 240, 80 + Math.floor(index / 2) * 200, 220, 160]));
  return {
    schemaVersion: 1, projectId: "sktc", provenance: { file: "Drawn in EnergyX", status: "Edited in Facility → Floor layout" },
    layout: {
      viewBox: [0, 0, 1600, 900], ...(style ? { style } : {}),
      zones: [
        { id: "264E", referenceBoard: "DB-E", rect: [20, 20, 500, 700] }, { id: "264F", referenceBoard: "DB-F", rect: [560, 20, 500, 700] }, { id: "Carpark", referenceBoard: "", rect: [1100, 20, 480, 400] },
        { id: "Playground", referenceBoard: "DB-P", meterLocations: ["Playground lights"], rect: [1100, 460, 480, 300] }, { id: "LED", referenceBoard: "DB-L", rect: [52, 190, 196, 40], independentSpace: false, physicalParentRoom: "264E Lobby", equipment: "Lift lobby LED" },
      ],
      rooms: [...blocks("264E", 40), ...blocks("264F", 580), room("Drive-in", "Carpark", [1120, 80, 200, 300]), room("Lots", "Carpark", [1340, 80, 220, 300]), room("Play area", "Playground", [1120, 520, 200, 220]), room("Fitness corner", "Playground", [1340, 520, 220, 220])],
      entrance: { label: "Main gate", position: [540, 860] },
      devices: Array.from({ length: 19 }, (_, index) => ({ meterId: `m${index + 1}`, position: [60 + (index % 10) * 150, 120 + Math.floor(index / 10) * 400] })),
    },
  } as unknown as StoredSpatialReference;
}

describe("layouts saved before this change", () => {
  it("open, draw and re-save exactly as before, in every plan style", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("React", React);
    const estateMeters = Array.from({ length: 19 }, (_, index) => ({ id: `m${index + 1}`, name: `Meter ${index + 1}`, board: "DB-E" }));
    for (const style of [undefined, "drawing", "blueprint", "blocks"]) {
      const original = estate(style), text = notesWithReference("SKTC.", null, original);
      const found = readProjectSpatialReference(text, "sktc")!;
      const plan = planFromReference(found.reference as StoredSpatialReference);
      expect([plan.areas.length, plan.rooms.length, plan.devices.length, !!plan.entrance]).toEqual([5, 14, 19, true]);
      // No ids or locks appear on items saved without them.
      expect([...plan.areas, ...plan.rooms, ...plan.devices].some(item => "locked" in item || "id" in item)).toBe(false);
      const saved = referenceFromPlan(plan, "sktc", found.reference as StoredSpatialReference);
      expect(notesWithReference(text, found.block, saved)).toBe(text);
      const markup: string[] = [];
      for (const reference of [found.reference as StoredSpatialReference, saved]) {
        const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
        await act(async () => root.render(<SiteFloorMap reference={reference} devices={mapDevices(reference, estateMeters)} />));
        markup.push(host.innerHTML.replace(/-r[0-9a-z]+\b/g, "-id"));
        await act(async () => root.unmount()); host.remove();
      }
      expect(markup[1]).toBe(markup[0]);
    }
  });

  it("draws a locked item and a room with an id exactly like any other, in every style", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("React", React);
    for (const style of ["drawing", "blueprint", "blocks"]) {
      const plain = estate(style), marked = estate(style);
      Object.assign(marked.layout.rooms[0]!, { id: "rm-lobby001", locked: true }); Object.assign(marked.layout.zones[0]!, { locked: true });
      const markup: string[] = [];
      for (const reference of [plain, marked]) {
        const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
        await act(async () => root.render(<SiteFloorMap reference={reference} />));
        markup.push(host.innerHTML.replace(/-r[0-9a-z]+\b/g, "-id"));
        await act(async () => root.unmount()); host.remove();
      }
      expect(markup[1]).toBe(markup[0]);
    }
  });
});

