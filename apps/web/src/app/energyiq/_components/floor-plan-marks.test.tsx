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

afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); delete document.documentElement.dataset.energyiqTheme; });

const meters = [{ id: "tv", name: "Showroom TV", board: "DB1", type: "Power" }];
const previous = {
  schemaVersion: 1, projectId: "office", provenance: { file: "plan", status: "Edited in Facility → Floor layout" },
  layout: {
    viewBox: [0, 0, 1000, 640],
    zones: [{ id: "Block 264E", referenceBoard: "DB1", rect: [20, 20, 460, 500] }],
    rooms: [{ name: "Showroom", zone: "Block 264E", rect: [40, 80, 260, 200] }],
    entrance: { label: "Main gate", position: [500, 600], referenceBoard: "DB1" },
    devices: [{ meterId: "tv", position: [100, 150], size: [120, 40] }],
  },
} as unknown as StoredSpatialReference;
const notes = notesWithReference("Office notes.", null, previous);
const block = readProjectSpatialReference(notes, "office")!.block;
const pointer = (type: string, x: number, y: number, extra: PointerEventInit = {}) => new PointerEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1, ...extra });
const setValue = (element: HTMLInputElement | HTMLSelectElement, value: string) => { Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")!.set!.call(element, value); };

async function render(locale?: string) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("React", React);
  if (locale) localStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
  const sent: string[] = [];
  vi.spyOn(configApi, "reportAgentRequest").mockImplementation(async (_project, path, options) => { if (!path) return { settings: { contextNotes: notes } } as never; sent.push(String(options?.body)); return {} as never; });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<EnergyIqLocaleProvider><FloorPlanEditor projectId="office" notes={notes} block={block} previous={previous} meters={meters} boards={["DB1"]} onCancel={() => undefined} onSaved={() => undefined} /></EnergyIqLocaleProvider>));
  const canvas = () => host.querySelector('svg[role="application"]') as SVGSVGElement;
  const button = (label: string) => [...host.querySelectorAll("button")].find(item => item.textContent === label) as HTMLButtonElement;
  const click = async (target: Element, at: [number, number], extra: PointerEventInit = {}) => { await act(async () => { target.dispatchEvent(pointer("pointerdown", ...at, extra)); canvas().dispatchEvent(pointer("pointerup", ...at, extra)); }); };
  const drag = async (target: Element, from: [number, number], to: [number, number]) => {
    await act(async () => { target.dispatchEvent(pointer("pointerdown", ...from)); });
    await act(async () => { canvas().dispatchEvent(pointer("pointermove", ...to)); });
    await act(async () => { canvas().dispatchEvent(pointer("pointerup", ...to)); });
  };
  const field = (label: string) => [...host.querySelectorAll("aside label")].find(item => item.textContent?.startsWith(label))?.querySelector("input, select") as HTMLInputElement | HTMLSelectElement;
  const type = async (element: HTMLInputElement, text: string) => {
    await act(async () => { element.dispatchEvent(new FocusEvent("focus")); element.focus(); });
    await act(async () => { setValue(element, text); element.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => { element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
  };
  const choose = async (select: HTMLSelectElement, value: string) => { await act(async () => { setValue(select, value); select.dispatchEvent(new Event("change", { bubbles: true })); }); };
  const item = (id: string) => canvas().querySelector(`[data-item="${id}"]`);
  const items = (kind: string) => [...canvas().querySelectorAll(`[data-item^="${kind}:"]`)];
  const heading = () => host.querySelector("aside h5")?.textContent;
  const save = async () => { await act(async () => button("Save layout").click()); return readProjectSpatialReference((JSON.parse(sent[sent.length - 1]!) as { contextNotes: string }).contextNotes, "office")!.reference as unknown as { layout: Record<string, unknown> & { entrance?: unknown; labels?: Array<Record<string, unknown>>; symbols?: Array<Record<string, unknown>>; devices: Array<Record<string, unknown>> } }; };
  return { host, canvas, button, click, drag, field, type, choose, item, items, heading, save, sent, unmount: async () => { await act(async () => root.unmount()); host.remove(); } };
}

describe("+ Text", () => {
  it("puts a label where the plan is clicked, edits, turns and deletes it, each as one step", async () => {
    const view = await render();
    await act(async () => view.button("+ Text").click());
    expect(view.host.querySelector('[role="status"]')?.textContent).toContain("Click the plan where the text should go");
    await view.click(view.canvas(), [700, 300]);
    const [label] = view.items("label");
    expect(label?.textContent).toBe("Text");
    expect(view.heading()).toBe("Text label");
    await view.type(view.field("Text") as HTMLInputElement, "To MRT");
    expect(view.items("label")[0]!.textContent).toBe("To MRT");
    await view.choose(view.field("Text size") as HTMLSelectElement, "l");
    await view.type(view.host.querySelector('input[aria-label="Degrees, clockwise"]') as HTMLInputElement, "90");
    expect(view.items("label")[0]!.querySelector("text")!.getAttribute("transform")).toBe("rotate(90 700 300)");
    await act(async () => view.button("↻ 15°").click());
    expect(view.items("label")[0]!.querySelector("text")!.getAttribute("transform")).toBe("rotate(105 700 300)");
    // The plan says plainly that text is drawing only.
    expect(view.host.textContent).toContain("Text, landmarks and entrances are drawing only");
    const saved = await view.save();
    expect(saved.layout.labels).toEqual([expect.objectContaining({ text: "To MRT", position: [700, 300], size: "l", rotation: 105 })]);
    expect(String(saved.layout.labels![0]!.id)).toMatch(/^lb-/);
    await act(async () => view.button("Delete text").click());
    expect(view.items("label")).toHaveLength(0);
    await act(async () => view.button("Undo").click());
    expect(view.items("label")).toHaveLength(1);
    await view.unmount();
  });

  it("copies, locks and lines up labels like any other item", async () => {
    const view = await render();
    for (const at of [[700, 200], [760, 330]] as Array<[number, number]>) { await act(async () => view.button("+ Text").click()); await view.click(view.canvas(), at); }
    expect(view.items("label")).toHaveLength(2);
    await view.click(view.items("label")[0]!, [700, 200]);
    await view.click(view.items("label")[1]!, [760, 330], { shiftKey: true });
    expect(view.heading()).toBe("2 items selected");
    await act(async () => view.button("Left").click());
    const lefts = view.items("label").map(item => Number(item.querySelector("rect")!.getAttribute("x")));
    expect(Math.abs(lefts[0]! - lefts[1]!)).toBeLessThanOrEqual(1);
    await act(async () => view.button("Duplicate").click());
    expect(view.items("label")).toHaveLength(4);
    await act(async () => view.button("Lock all").click());
    expect(view.canvas().querySelectorAll('[aria-label="Locked"]').length).toBe(2);
    await view.unmount();
  });
});

describe("+ Landmark", () => {
  it("offers each landmark in plain words and puts the one picked where the plan is clicked", async () => {
    const view = await render();
    await act(async () => view.button("+ Landmark").click());
    const choices = [...view.host.querySelectorAll('[role="group"][aria-label="Landmarks"] button')].map(item => item.textContent);
    expect(choices).toEqual(["Entrance or gate", "Lift", "Stairs", "Toilet", "Car park", "Bin centre", "Lamp post", "Tree", "Playground", "Shelter or bench", "Fire exit", "Switch room or DB", "Water pump", "Bus stop", "Arrow", "North arrow"]);
    await act(async () => view.button("Lift").click());
    expect(view.host.querySelector('[role="status"]')?.textContent).toContain("Click the plan where the Lift should go");
    await view.click(view.canvas(), [800, 200]);
    expect(view.canvas().querySelector('[data-symbol="lift"]')).not.toBeNull();
    expect(view.heading()).toBe("Landmark");
    await view.type(view.field("Caption") as HTMLInputElement, "Lift A");
    await view.choose(view.field("Shows") as HTMLSelectElement, "tree");
    expect(view.canvas().querySelector('[data-symbol="tree"]')).not.toBeNull();
    const saved = await view.save();
    expect(saved.layout.symbols!.map(item => [item.kind, item.label ?? null])).toEqual([["entrance", "Main gate"], ["tree", "Lift A"]]);
    await view.unmount();
  });

  it("names the landmarks in Chinese and Malay", async () => {
    for (const [locale, open, word] of [["zh-Hans", "+ 地标", "电梯"], ["ms", "+ Mercu tanda", "Lif"]] as const) {
      const view = await render(locale);
      await act(async () => view.button(open).click());
      expect(view.button(word)).toBeDefined();
      await view.unmount();
    }
  });
});

describe("several entrances", () => {
  it("adds a second entrance beside the first; the first still drives layout.entrance, and the button stays", async () => {
    const view = await render();
    await act(async () => view.button("+ Add entrance").click());
    expect(view.items("symbol")).toHaveLength(1);
    expect(view.button("+ Add entrance")).toBeDefined();
    const saved = await view.save();
    expect(saved.layout.entrance).toEqual({ label: "Main gate", position: [500, 600], referenceBoard: "DB1" });
    expect(saved.layout.symbols!.map(item => [item.kind, item.label])).toEqual([["entrance", "Main gate"], ["entrance", "Entrance 2"]]);
    // Removing the main entrance makes the second one the main entrance.
    await view.click(view.item("entrance:entrance")!, [500, 600]);
    expect(view.heading()).toBe("Entrance");
    await act(async () => view.button("Remove entrance").click());
    expect(view.items("symbol")).toHaveLength(0);
    expect(view.item("entrance:entrance")?.textContent).toBe("Entrance 2");
    const after = await view.save();
    expect(after.layout.entrance).toMatchObject({ label: "Entrance 2" });
    await view.unmount();
  });

  it("turns the main entrance with the round handle, in 15° steps, as one undo step", async () => {
    const view = await render();
    await view.click(view.item("entrance:entrance")!, [500, 600]);
    const handle = view.canvas().querySelector("[data-turn]")!;
    expect(handle).not.toBeNull();
    // The entrance turns around its tip (500, 600): dragging the handle round to the right turns it a quarter turn.
    await view.drag(handle, [500, 560], [541, 602]);
    expect(view.item("entrance:entrance")!.querySelector("path")!.getAttribute("transform")).toBe("rotate(90 500 600)");
    expect(view.host.querySelector('[data-live="plan"]')?.textContent).toContain("Turned to 90°");
    const saved = await view.save();
    expect(saved.layout.entrance).toEqual({ label: "Main gate", position: [500, 600], referenceBoard: "DB1" });
    expect(saved.layout.symbols).toEqual([{ kind: "entrance", position: [500, 600], rotation: 90, label: "Main gate" }]);
    await act(async () => view.button("Undo").click());
    expect(view.item("entrance:entrance")!.querySelector("path")!.getAttribute("transform")).toBeNull();
    await view.unmount();
  });
});

describe("turning a device box", () => {
  it("turns a device box from its panel and saves devices[].rotation; a dot drops it", async () => {
    const view = await render();
    await view.click(view.item("device:tv")!, [100, 150]);
    await view.type(view.host.querySelector('input[aria-label="Degrees, clockwise"]') as HTMLInputElement, "30");
    expect(view.item("device:tv")!.querySelector("g[transform]")!.getAttribute("transform")).toBe("rotate(30 100 150)");
    expect(view.host.textContent).toContain("A turned box is resized with Width and Height");
    // Resize grips are only offered while the box is upright.
    expect(view.canvas().querySelector("[data-handle]")).toBeNull();
    expect((await view.save()).layout.devices[0]).toEqual({ meterId: "tv", position: [100, 150], size: [120, 40], rotation: 30 });
    await view.choose(view.field("Show on the plan as") as HTMLSelectElement, "dot");
    expect((await view.save()).layout.devices[0]).toEqual({ meterId: "tv", position: [100, 150] });
    await view.unmount();
  });
});

describe("the shared map", () => {
  const marked = (style?: string) => ({ ...previous, layout: { ...previous.layout, ...(style ? { style } : {}),
    labels: [{ text: "Jalan Besar", position: [700, 100], size: "l", rotation: 90, colour: "#d6453d", bold: true }],
    symbols: [{ kind: "entrance", position: [500, 600], label: "Main gate" }, { kind: "entrance", position: [900, 600], rotation: 270, label: "Side gate" }, { kind: "lift", position: [600, 300], label: "Lift A" }, { kind: "spaceship", position: [650, 300] }],
    devices: [{ meterId: "tv", position: [100, 150], size: [120, 40], rotation: 30 }] } }) as unknown as StoredSpatialReference;
  async function draw(reference: StoredSpatialReference) {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("React", React);
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    await act(async () => root.render(<SiteFloorMap reference={reference} devices={mapDevices(reference, meters)} />));
    return { host, unmount: async () => { await act(async () => root.unmount()); host.remove(); } };
  }

  it("draws text, landmarks, every entrance and turned boxes in every style and in dark mode, above rooms and below devices", async () => {
    for (const dark of [false, true]) {
      if (dark) document.documentElement.dataset.energyiqTheme = "dark";
      for (const style of ["drawing", "blueprint", "blocks"]) {
        const map = await draw(marked(style)), svg = map.host.querySelector("svg")!, html = svg.outerHTML;
        expect(svg.getAttribute("data-look")).toBe(style);
        const label = [...svg.querySelectorAll("text")].find(item => item.textContent === "Jalan Besar")!;
        expect(label.getAttribute("transform")).toBe("rotate(90 700 100)");
        expect(label.getAttribute("style")).toMatch(/color: ?(#d6453d|rgb\(214, 69, 61\))/);
        // Landmarks use the plan style's own ink (the same classes in every style and theme).
        expect(svg.querySelector('[data-symbol="lift"]')!.getAttribute("class")).toMatch(/planMark/);
        expect(svg.querySelector('[data-symbol="other"]')).not.toBeNull();
        // Both entrances, the main one once.
        expect(html.match(/Main gate/g)).toHaveLength(1);
        expect(html).toContain("Side gate");
        expect(html).toContain('transform="rotate(270 900 600)"');
        expect(html).toContain('transform="rotate(30 100 150)"');
        // Above the rooms, below the devices.
        const order = [...svg.querySelectorAll("text")].map(item => item.textContent);
        expect(order.indexOf("Showroom")).toBeLessThan(order.indexOf("Jalan Besar"));
        expect(order.indexOf("Lift A")).toBeLessThan(order.indexOf("Showroom TV"));
        await map.unmount();
      }
    }
  });

  it("draws a layout with no labels or landmarks exactly as before", async () => {
    const plain = await draw(previous), html = plain.host.innerHTML;
    await plain.unmount();
    const empty = await draw({ ...previous, layout: { ...previous.layout, labels: [], symbols: [{ kind: "entrance", position: [500, 600], label: "Main gate" }] } } as unknown as StoredSpatialReference);
    expect(empty.host.innerHTML.replace(/-r[0-9a-z]+\b/g, "-id")).toBe(html.replace(/-r[0-9a-z]+\b/g, "-id"));
    await empty.unmount();
  });

  it("leaves out saved marks that cannot be trusted", async () => {
    const bad = { ...previous, layout: { ...previous.layout, labels: [{ text: "<b>hi</b>", position: [10, 10], colour: "javascript:alert(1)" }, { text: "Lost", position: ["a", 1] }], symbols: [{ kind: "lift'><script>", position: [5, 5] }] } } as unknown as StoredSpatialReference;
    const map = await draw(bad), html = map.host.innerHTML;
    expect(html).toContain("&lt;b&gt;hi&lt;/b&gt;");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("Lost");
    await map.unmount();
  });
});
