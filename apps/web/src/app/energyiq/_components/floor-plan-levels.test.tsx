/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readProjectSpatialReference } from "@datafoundry/contracts";
import { configApi } from "../../../lib/config-api";
import { EnergyIqLocaleProvider } from "./energyiq-locale";
import { LANGUAGE_STORAGE_KEY } from "./energyiq-messages";
import { FloorPlanEditor } from "./floor-plan-editor";
import { notesWithReference, type StoredSpatialReference } from "./floor-plan-model";
import { mapDevices, SiteFloorMap } from "./site-floor-map";

afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const meters = [{ id: "tv", name: "Showroom TV", board: "DB1", type: "Power" }, { id: "pump", name: "Roof pump", board: "DB2", type: "Power" }];
const ONE = {
  schemaVersion: 1, projectId: "office", provenance: { file: "plan", status: "Edited in Facility → Floor layout" },
  layout: {
    viewBox: [0, 0, 1000, 640],
    zones: [{ id: "A", referenceBoard: "DB1", rect: [20, 20, 460, 500] }],
    rooms: [{ name: "Showroom", zone: "A", rect: [40, 80, 260, 200] }, { name: "Pantry", zone: "A", rect: [320, 80, 140, 120] }],
    devices: [{ meterId: "tv", position: [100, 150] }],
  },
} as unknown as StoredSpatialReference;
/** The same site with a roof floor: area B with a plant room and the roof pump. */
const TWO = { ...ONE, layout: { ...ONE.layout, levels: [{ id: "g", name: "Ground" }, { id: "roof", name: "Roof" }],
  zones: [...ONE.layout.zones, { id: "B", referenceBoard: "DB2", rect: [20, 20, 460, 500], level: "roof" }],
  rooms: [...ONE.layout.rooms, { name: "Plant room", zone: "B", rect: [40, 80, 200, 150], level: "roof" }],
  devices: [...(ONE.layout as unknown as { devices: unknown[] }).devices, { meterId: "pump", position: [120, 140], level: "roof" }] } } as unknown as StoredSpatialReference;

async function mount(node: React.ReactNode) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("React", React);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<EnergyIqLocaleProvider>{node}</EnergyIqLocaleProvider>));
  return { host, unmount: async () => { await act(async () => root.unmount()); host.remove(); } };
}
async function editor(saved: StoredSpatialReference = ONE) {
  const notes = notesWithReference("Notes.", null, saved), block = readProjectSpatialReference(notes, "office")!.block;
  const sent: string[] = [];
  vi.spyOn(configApi, "reportAgentRequest").mockImplementation(async (_project, path, options) => { if (!path) return { settings: { contextNotes: notes } } as never; sent.push(String(options?.body)); return {} as never; });
  const view = await mount(<FloorPlanEditor projectId="office" notes={notes} block={block} previous={saved} meters={meters} boards={["DB1", "DB2"]} onCancel={() => undefined} onSaved={() => undefined} />);
  const { host } = view;
  const canvas = () => host.querySelector('svg[role="application"]') as SVGSVGElement;
  const button = (label: string, within: ParentNode = host) => [...within.querySelectorAll("button")].find(item => item.textContent === label) as HTMLButtonElement;
  const tabs = () => [...host.querySelectorAll('[data-level-tabs] button')].map(tab => `${tab.textContent}${tab.getAttribute("aria-pressed") === "true" ? "*" : ""}`);
  const roomNames = () => [...canvas().querySelectorAll("g")].filter(item => item.querySelector('rect[class*="room"]')).map(item => item.querySelector("text")?.textContent);
  const layerRow = (layer: string) => host.querySelector(`[data-layer="${layer}"]`)!;
  const click = async (element: Element) => { await act(async () => (element as HTMLElement).click()); };
  const saveLayout = async () => { await click(button("Save layout")); return readProjectSpatialReference((JSON.parse(sent.at(-1)!) as { contextNotes: string }).contextNotes, "office")!.reference as StoredSpatialReference; };
  return { ...view, canvas, button, tabs, roomNames, layerRow, click, saveLayout, sent };
}

describe("floors in the editor", () => {
  it("hides the floor tabs until a second floor is added, then shows one floor at a time", async () => {
    const view = await editor();
    expect(view.host.querySelector('[data-level-tabs]')).toBeNull();
    expect(view.host.querySelector('[data-panel="level"]')).toBeNull();
    await view.click(view.button("+ Add floor"));
    expect(view.tabs()).toEqual(["Floor 1", "Floor 2*"]);
    expect(view.roomNames()).toEqual([]);
    expect(view.host.textContent).toContain("Added Floor 2.");
    // The floor below, faintly, takes no clicks.
    expect(view.canvas().querySelector("[data-ghost]")).toBeNull();
    await view.click(view.host.querySelector('[data-panel="level"] input[type="checkbox"]')!);
    const ghost = view.canvas().querySelector("[data-ghost]")!;
    expect(ghost.getAttribute("aria-hidden")).toBe("true");
    expect([...ghost.querySelectorAll("text")].map(text => text.textContent)).toEqual(["Showroom", "Pantry"]);
    await view.click(view.button("Floor 1"));
    expect(view.tabs()).toEqual(["Floor 1*", "Floor 2"]);
    expect(view.roomNames()).toEqual(["Showroom", "Pantry"]);
    // Switching floors is not a change: Undo takes back adding the floor (and shows the floor it was added from).
    await view.click(view.button("Floor 2"));
    await view.click(view.button("Undo"));
    expect(view.host.querySelector('[data-level-tabs]')).toBeNull();
    expect(view.roomNames()).toEqual(["Showroom", "Pantry"]);
    await view.unmount();
  });

  it("duplicates a floor without its devices, shows short names, and saves unique ones", async () => {
    const view = await editor(TWO);
    expect(view.tabs()).toEqual(["Ground*", "Roof"]);
    expect(view.roomNames()).toEqual(["Showroom", "Pantry"]);
    await view.click(view.button("Duplicate floor"));
    expect(view.tabs()).toEqual(["Ground", "Ground copy*", "Roof"]);
    expect(view.roomNames()).toEqual(["Showroom", "Pantry"]);
    const saved = await view.saveLayout();
    const copy = (saved.layout as unknown as { levels: Array<{ id: string; name: string }> }).levels[1]!;
    expect(copy.name).toBe("Ground copy");
    expect(saved.layout.rooms.filter(room => room.level === copy.id).map(room => [room.name, room.displayName])).toEqual([["Showroom (2)", "Showroom"], ["Pantry (2)", "Pantry"]]);
    expect((saved.layout as unknown as { devices: Array<{ level?: string }> }).devices.filter(device => device.level === copy.id)).toEqual([]);
    // Renaming the floor changes no room name.
    const name = view.host.querySelector('[data-panel="level"] input:not([type])') as HTMLInputElement;
    await act(async () => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; set.call(name, "Level 2"); name.dispatchEvent(new Event("input", { bubbles: true })); });
    expect(view.tabs()).toContain("Level 2*");
    const renamed = await view.saveLayout();
    expect(renamed.layout.rooms.map(room => room.name)).toEqual(saved.layout.rooms.map(room => room.name));
    await view.unmount();
  });

  it("asks before deleting a floor, and moves what is on it when asked", async () => {
    const view = await editor(TWO);
    await view.click(view.button("Roof"));
    expect(view.roomNames()).toEqual(["Plant room"]);
    await view.click(view.button("Delete floor"));
    const dialog = view.host.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain("Roof has 1 area, 1 room and 1 device on it.");
    // Focus goes into the question, and back to Delete floor when it is put away (Keep, or Escape).
    expect(document.activeElement?.textContent).toBe("Move them and delete the floor");
    expect(dialog.getAttribute("aria-describedby")).toBe(dialog.querySelector("p")!.id);
    await view.click(view.button("Keep the floor", dialog));
    expect(view.host.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement?.textContent).toBe("Delete floor");
    await view.click(view.button("Delete floor"));
    await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(view.host.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement?.textContent).toBe("Delete floor");
    expect(view.tabs()).toEqual(["Ground", "Roof*"]);
    await view.click(view.button("Delete floor"));
    await view.click(view.button("Move them and delete the floor"));
    expect(view.host.querySelector('[data-level-tabs]')).toBeNull();
    const saved = await view.saveLayout();
    expect((saved.layout as unknown as { levels?: unknown }).levels).toBeUndefined();
    expect(saved.layout.rooms.map(room => room.name)).toEqual(["Showroom", "Pantry", "Plant room"]);
    expect(saved.layout.rooms.some(room => "level" in room)).toBe(false);
    await view.unmount();
  });

  it("hides and locks layers only while editing, and saves the shared map's hidden layers", async () => {
    const view = await editor();
    expect([...view.host.querySelectorAll("[data-layer]")].map(row => row.getAttribute("data-layer"))).toEqual(["areas", "rooms", "equipment", "devices"]);
    await view.click(view.button("Hide", view.layerRow("rooms")));
    expect(view.roomNames()).toEqual([]);
    expect(view.button("Show", view.layerRow("rooms")).getAttribute("aria-pressed")).toBe("true");
    await view.click(view.button("Show", view.layerRow("rooms")));
    expect(view.roomNames()).toEqual(["Showroom", "Pantry"]);
    await view.click(view.layerRow("devices").querySelector('input[type="checkbox"]')!);
    const saved = await view.saveLayout();
    expect((saved.layout as unknown as { layers: unknown }).layers).toEqual({ hidden: ["devices"] });
    // Editor-only choices are never saved.
    await view.click(view.button("Hide", view.layerRow("areas")));
    const again = await view.saveLayout();
    expect((again.layout as unknown as { layers: unknown }).layers).toEqual({ hidden: ["devices"] });
    await view.unmount();
  });

  it("shows a hidden or locked layer again when something is added to it, and says while a layer is hidden", async () => {
    const view = await editor();
    expect(view.host.querySelector("[data-hidden-layers]")).toBeNull();
    await view.click(view.button("Hide", view.layerRow("rooms")));
    await view.click(view.button("Lock", view.layerRow("areas")));
    expect(view.host.querySelector("[data-hidden-layers]")?.textContent).toContain("Hidden while you edit: Rooms.");
    await view.click(view.button("Insert template"));
    await view.click(view.button("Office suite"));
    // The new rooms are drawn, and their layers are shown and unlocked again.
    expect(view.roomNames()).toEqual(["Showroom", "Pantry", "Open office", "Reception", "Meeting room", "Pantry 2"]);
    expect(view.button("Hide", view.layerRow("rooms")).getAttribute("aria-pressed")).toBe("false");
    expect(view.button("Lock", view.layerRow("areas")).getAttribute("aria-pressed")).toBe("false");
    expect(view.host.querySelector("[data-hidden-layers]")).toBeNull();
    // Show all, from the note.
    await view.click(view.button("Hide", view.layerRow("devices")));
    await view.click(view.button("Show all", view.host.querySelector("[data-hidden-layers]")!));
    expect(view.host.querySelector("[data-hidden-layers]")).toBeNull();
    await view.unmount();
  });

  it("refuses to duplicate a floor whose copy would not fit in a layout that can be saved", async () => {
    const many = { ...ONE, layout: { ...ONE.layout, zones: [{ id: "A", referenceBoard: "DB1", rect: [0, 0, 1000, 640] }], devices: [],
      rooms: Array.from({ length: 105 }, (_, index) => ({ name: `Room ${index + 1}`, zone: "A", rect: [10 + (index % 15) * 60, 10 + Math.floor(index / 15) * 60, 50, 50] })) } } as unknown as StoredSpatialReference;
    const view = await editor(many);
    await view.click(view.button("+ Add floor"));
    await view.click(view.button("Floor 1"));
    await view.click(view.button("Duplicate floor"));
    expect(view.host.querySelector('[role="status"]:not([data-hidden-layers])')?.textContent ?? "").toContain("A plan can hold up to 100 areas and 200 rooms.");
    expect(view.tabs()).toEqual(["Floor 1*", "Floor 2"]);
    await view.unmount();
  });

  it("names only what is on a floor before deleting it, the entrance too", async () => {
    const withGate = { ...TWO, layout: { ...TWO.layout, entrance: { label: "Gate", position: [240, 600], level: "roof" },
      zones: TWO.layout.zones.filter(zone => zone.id !== "B"), rooms: TWO.layout.rooms.filter(room => room.zone !== "B"), devices: (ONE.layout as unknown as { devices: unknown[] }).devices } } as unknown as StoredSpatialReference;
    const view = await editor(withGate);
    await view.click(view.button("Roof"));
    await view.click(view.button("Delete floor"));
    expect(view.host.querySelector('[role="alertdialog"] p')?.textContent).toBe("Roof has the entrance on it. Move them to another floor, or delete them with the floor?");
    await view.unmount();
  });

  it("inserts a template and repeats a selection as single undo steps", async () => {
    const view = await editor();
    await view.click(view.button("Insert template"));
    await view.click(view.button("Office suite"));
    expect(view.roomNames()).toEqual(["Showroom", "Pantry", "Open office", "Reception", "Meeting room", "Pantry 2"]);
    await view.click(view.button("Undo"));
    expect(view.roomNames()).toEqual(["Showroom", "Pantry"]);
    // Select Pantry, then Repeat 2 copies.
    const pantry = [...view.canvas().querySelectorAll("g")].find(item => item.querySelector('rect[class*="room"]') && item.querySelector("text")?.textContent === "Pantry")!;
    await act(async () => { pantry.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 330, clientY: 90, pointerId: 1 })); view.canvas().dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, clientX: 330, clientY: 90, pointerId: 1 })); });
    const form = view.host.querySelector('[role="group"][aria-label="Repeat"]')!;
    const count = form.querySelector('input[type="number"]') as HTMLInputElement;
    await act(async () => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; set.call(count, "2"); count.dispatchEvent(new Event("input", { bubbles: true })); });
    await view.click(view.button("Repeat", form));
    expect(view.roomNames()).toHaveLength(4);
    expect(new Set(view.roomNames()).size).toBe(4);
    await view.click(view.button("Undo"));
    expect(view.roomNames()).toEqual(["Showroom", "Pantry"]);
    await view.unmount();
  });

  it("words the floor tools in Chinese and Malay", async () => {
    for (const [locale, add, layers] of [["zh-Hans", "+ 添加楼层", "图层"], ["ms", "+ Tambah tingkat", "Lapisan"]] as const) {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
      const view = await editor();
      expect(view.button(add)).toBeDefined();
      expect(view.host.querySelector('[data-panel="layers"] h5')?.textContent).toBe(layers);
      await view.unmount();
    }
  });
});

describe("floors on the shared map", () => {
  const titles = (host: HTMLElement) => [...host.querySelectorAll("svg title")].map(title => title.textContent ?? "");
  it("looks exactly as before for a one-floor site", async () => {
    const view = await mount(<SiteFloorMap reference={ONE} devices={mapDevices(ONE, meters)} />);
    expect(view.host.querySelector('[data-level-tabs]')).toBeNull();
    expect(view.host.firstElementChild?.tagName.toLowerCase()).toBe("svg");
    await view.unmount();
  });
  for (const style of ["drawing", "blueprint", "blocks"] as const) it(`shows a tab per floor and one floor at a time (${style})`, async () => {
    const reference = { ...TWO, layout: { ...TWO.layout, style } } as StoredSpatialReference;
    const view = await mount(<SiteFloorMap reference={reference} devices={mapDevices(reference, meters)} />);
    const tabs = () => [...view.host.querySelectorAll('[data-level-tabs] button')].map(tab => `${tab.textContent}${tab.getAttribute("aria-pressed") === "true" ? "*" : ""}`);
    expect(view.host.querySelector("svg")?.getAttribute("data-look")).toBe(style);
    expect(tabs()).toEqual(["Ground*", "Roof"]);
    expect(view.host.textContent).toContain("Showroom");
    expect(view.host.textContent).not.toContain("Plant room");
    expect(titles(view.host).some(title => title.includes("Roof pump"))).toBe(false);
    await act(async () => (view.host.querySelectorAll('[data-level-tabs] button')[1] as HTMLElement).click());
    expect(tabs()).toEqual(["Ground", "Roof*"]);
    expect(view.host.textContent).toContain("Plant room");
    expect(view.host.textContent).not.toContain("Showroom");
    expect(titles(view.host).some(title => title.includes("Roof pump"))).toBe(true);
    await view.unmount();
  });
  it("turns to the floor of the highlighted devices, so a highlight never lands on another floor", async () => {
    const view = await mount(<SiteFloorMap reference={TWO} devices={mapDevices(TWO, meters)} highlight={["DB2"]} highlightDevices={["pump"]} />);
    expect(view.host.querySelector('[data-level-tabs] button[aria-pressed="true"]')?.textContent).toBe("Roof");
    await view.unmount();
    const ground = await mount(<SiteFloorMap reference={TWO} devices={mapDevices(TWO, meters)} highlight={["DB1"]} highlightDevices={["tv"]} />);
    expect(ground.host.querySelector('[data-level-tabs] button[aria-pressed="true"]')?.textContent).toBe("Ground");
    await ground.unmount();
    const focused = await mount(<SiteFloorMap reference={TWO} devices={mapDevices(TWO, meters)} focusDevice="pump" />);
    expect(focused.host.querySelector('[data-level-tabs] button[aria-pressed="true"]')?.textContent).toBe("Roof");
    await focused.unmount();
  });
  it("puts equipment that names no floor on its room's floor, and turns there when it is highlighted", async () => {
    const reference = { ...TWO, layout: { ...TWO.layout, zones: [...TWO.layout.zones, { id: "C", referenceBoard: "DB3", independentSpace: false, physicalParentRoom: "Plant room", equipment: "Chillers" }] } } as unknown as StoredSpatialReference;
    const view = await mount(<SiteFloorMap reference={reference} highlight={["DB3"]} />);
    expect(view.host.querySelector('[data-level-tabs] button[aria-pressed="true"]')?.textContent).toBe("Roof");
    expect(view.host.querySelector("svg")?.textContent).toContain("Chillers");
    await view.unmount();
  });
  it("leaves out the layers the layout hides on the shared map", async () => {
    const reference = { ...ONE, layout: { ...ONE.layout, layers: { hidden: ["devices", "rooms", "bogus"] } } } as unknown as StoredSpatialReference;
    const view = await mount(<SiteFloorMap reference={reference} devices={mapDevices(reference, meters)} />);
    expect(titles(view.host).some(title => title.includes("Showroom TV"))).toBe(false);
    expect(view.host.textContent).not.toContain("Pantry");
    await view.unmount();
  });
});
