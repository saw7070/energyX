/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readProjectSpatialReference } from "@datafoundry/contracts";
import { configApi } from "../../../lib/config-api";
import { EnergyIqLocaleProvider } from "./energyiq-locale";
import { FloorPlanEditor } from "./floor-plan-editor";
import { notesWithReference, type StoredSpatialReference } from "./floor-plan-model";

afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const meters = [{ id: "tv", name: "Showroom TV", board: "DB1", type: "Power" }];
const previous = {
  schemaVersion: 1, projectId: "office", provenance: { file: "plan", status: "Edited in Facility → Floor layout" },
  layout: {
    viewBox: [0, 0, 1000, 640],
    zones: [{ id: "Block 264E", referenceBoard: "DB1", rect: [20, 20, 460, 500] }],
    rooms: [{ name: "Showroom", zone: "Block 264E", rect: [40, 80, 260, 200] }, { name: "Pantry", zone: "Block 264E", rect: [320, 80, 140, 120] }],
    devices: [{ meterId: "tv", position: [100, 150] }],
  },
} as unknown as StoredSpatialReference;
const notes = notesWithReference("Office notes.", null, previous);
const block = readProjectSpatialReference(notes, "office")!.block;
const pointer = (type: string, x: number, y: number) => new PointerEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1 });

async function render() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("React", React);
  const sent: string[] = [];
  vi.spyOn(configApi, "reportAgentRequest").mockImplementation(async (_project, path, options) => { if (!path) return { settings: { contextNotes: notes } } as never; sent.push(String(options?.body)); return {} as never; });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<EnergyIqLocaleProvider><FloorPlanEditor projectId="office" notes={notes} block={block} previous={previous} meters={meters} boards={["DB1"]} onCancel={() => undefined} onSaved={() => undefined} /></EnergyIqLocaleProvider>));
  const canvas = () => host.querySelector('svg[role="application"]') as SVGSVGElement;
  const button = (label: string) => [...host.querySelectorAll("button")].find(item => item.textContent === label) as HTMLButtonElement;
  const press = async (key: string, target: EventTarget = canvas()) => { await act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); }); };
  const down = async (target: Element, at: [number, number]) => { await act(async () => { target.dispatchEvent(pointer("pointerdown", ...at)); }); };
  const up = async (at: [number, number]) => { await act(async () => { canvas().dispatchEvent(pointer("pointerup", ...at)); }); };
  const click = async (target: Element, at: [number, number]) => { await down(target, at); await up(at); };
  const drag = async (target: Element, from: [number, number], to: [number, number]) => { await down(target, from); await act(async () => { canvas().dispatchEvent(pointer("pointermove", (from[0] + to[0]) / 2, (from[1] + to[1]) / 2)); canvas().dispatchEvent(pointer("pointermove", ...to)); }); await up(to); };
  const heading = () => host.querySelector("aside h5")?.textContent;
  const save = async () => { await act(async () => button("Save layout").click()); return readProjectSpatialReference((JSON.parse(sent.at(-1)!) as { contextNotes: string }).contextNotes, "office")!.reference as StoredSpatialReference; };
  return { host, canvas, button, press, down, click, drag, heading, save, unmount: async () => { await act(async () => root.unmount()); host.remove(); } };
}

describe("doors and windows in the editor", () => {
  it("adds a door on the wall clicked, flips it, slides it along the wall, and saves it with the room's automatic door off", async () => {
    const view = await render();
    await act(async () => view.button("+ Door / window").click());
    expect(view.host.querySelector('[role="status"]')?.textContent).toContain("Click on a room's wall");
    // Pantry is [320, 80, 140, 120]: a click on its right wall puts a door half way along it.
    await view.click(view.canvas(), [459, 140]);
    expect(view.heading()).toBe("Door or window");
    expect(view.host.querySelector('[data-panel="opening"]')?.textContent).toContain("In Pantry");
    const door = () => view.canvas().querySelector("[data-opening]")!;
    expect(door()).not.toBeNull();
    await act(async () => view.button("Flip").click());
    // Dragged down the wall: it slides along it (and only along it).
    await view.drag(door(), [460, 140], [520, 170]);
    let saved = await view.save();
    const pantry = saved.layout.rooms.find(room => room.name === "Pantry")!;
    expect(pantry).toMatchObject({ autoDoor: false });
    expect(saved.layout.rooms.find(room => room.name === "Showroom")).not.toHaveProperty("autoDoor");
    expect(saved.layout.openings).toHaveLength(1);
    expect(saved.layout.openings![0]).toMatchObject({ room: "Pantry", wall: "e", kind: "door", hinge: "end", swing: "out" });
    expect(saved.layout.openings![0]!.offset).toBeGreaterThan(0.6);
    // Undo puts it back where it was; delete takes it away.
    await act(async () => view.button("Undo").click());
    await view.click(door(), [460, 140]);
    await act(async () => view.button("Delete door or window").click());
    expect(view.canvas().querySelector("[data-opening]")).toBeNull();
    saved = await view.save();
    expect(saved.layout.openings).toEqual([]);
    await view.unmount();
  });

  it("adds a door from a room's panel, which switches its automatic door off", async () => {
    const view = await render();
    const tile = [...view.canvas().querySelectorAll("g")].find(item => item.querySelector("text")?.textContent === "Showroom")!;
    await view.click(tile, [60, 100]);
    const auto = () => [...view.host.querySelectorAll("label")].find(item => item.textContent === "Automatic door")!.querySelector("input")!;
    expect(auto().checked).toBe(true);
    await act(async () => view.button("+ Add door").click());
    expect(view.heading()).toBe("Door or window");
    await view.click(tile, [60, 100]);
    expect(auto().checked).toBe(false);
    expect(auto().disabled).toBe(true);
    expect(view.button("Door · Bottom")).toBeDefined();
    const saved = await view.save();
    expect(saved.layout.openings![0]).toMatchObject({ room: "Showroom", wall: "s", offset: 0.5, kind: "door" });
    await view.unmount();
  });
});

describe("walls and lines in the editor", () => {
  it("draws a line point by point, finishes on Enter, edits a point, locks and copies it", async () => {
    const view = await render();
    await act(async () => view.button("+ Wall / line").click());
    for (const at of [[100, 560], [300, 560], [300, 600]] as Array<[number, number]>) await view.click(view.canvas(), at);
    await view.press("Enter");
    expect(view.heading()).toBe("Wall or line");
    expect(view.canvas().querySelector("[data-line] polyline")?.getAttribute("points")).toBe("100,560 300,560 300,600");
    // Drag the middle point; one undo puts it back.
    await view.drag(view.canvas().querySelector('[data-point="1"]')!, [300, 560], [340, 520]);
    expect(view.canvas().querySelector("[data-line] polyline")?.getAttribute("points")).toBe("100,560 340,520 300,600");
    await act(async () => view.button("Undo").click());
    expect(view.canvas().querySelector("[data-line] polyline")?.getAttribute("points")).toBe("100,560 300,560 300,600");
    // Pick a point and delete it.
    const line = view.canvas().querySelector("[data-line]")!;
    await view.click(line, [200, 560]);
    await view.down(view.canvas().querySelector('[data-point="1"]')!, [300, 560]);
    await act(async () => { view.canvas().dispatchEvent(pointer("pointerup", 300, 560)); });
    await act(async () => view.button("Delete point").click());
    expect(view.canvas().querySelector("[data-line] polyline")?.getAttribute("points")).toBe("100,560 300,600");
    // Restyled, locked (no points to drag), then saved.
    const style = view.host.querySelector('[data-panel="line"] select') as HTMLSelectElement;
    await act(async () => { style.value = "fence"; style.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => view.button("Lock in place").click());
    expect(view.canvas().querySelector("[data-point]")).toBeNull();
    const saved = await view.save();
    expect(saved.layout.lines).toEqual([{ id: "ln-1", points: [[100, 560], [300, 600]], style: "fence", locked: true }]);
    await view.unmount();
  });

  it("Esc drops a line being drawn, and a double-click finishes one", async () => {
    const view = await render();
    await act(async () => view.button("+ Wall / line").click());
    await view.click(view.canvas(), [100, 560]);
    await view.click(view.canvas(), [300, 560]);
    await view.press("Escape");
    expect(view.canvas().querySelector("[data-line]")).toBeNull();
    expect(view.button("Undo").disabled).toBe(true);
    await act(async () => view.button("+ Wall / line").click());
    await view.click(view.canvas(), [600, 560]);
    await view.click(view.canvas(), [800, 560]);
    await act(async () => { view.canvas().dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 800, clientY: 560 })); });
    expect(view.canvas().querySelector("[data-line] polyline")?.getAttribute("points")).toBe("600,560 800,560");
    await view.unmount();
  });
});
