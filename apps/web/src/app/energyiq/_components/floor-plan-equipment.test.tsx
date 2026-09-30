/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { EnergyIqLocaleProvider } from "./energyiq-locale";
import { FloorPlanEditor } from "./floor-plan-editor";
import { contentExtent, moveSelection, passengers, planFromReference, referenceFromPlan, resizeCanvas, settleRooms, type FloorPlan, type StoredSpatialReference } from "./floor-plan-model";

const meters = [{ id: "led", name: "LED Display 1", board: "DB3", type: "Other" }];
const previous: StoredSpatialReference = {
  schemaVersion: 1, projectId: "office", provenance: { file: "plan", status: "Drawn in EnergyX" },
  layout: { viewBox: [0, 0, 1000, 640], zones: [{ id: "B", referenceBoard: "DB2", rect: [20, 20, 460, 500] }], rooms: [{ name: "Showroom", zone: "B", rect: [40, 80, 260, 200] }], devices: [{ meterId: "led", position: [150, 150] }] },
};

it("adds equipment inside a room from the toolbar and shows a device as a named box instead of a dot", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("React", React);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<EnergyIqLocaleProvider><FloorPlanEditor projectId="office" notes="" block={null} previous={previous} meters={meters} boards={["DB2", "DB3"]} onCancel={() => undefined} onSaved={() => undefined} /></EnergyIqLocaleProvider>));
    const button = (label: string) => [...host.querySelectorAll("button")].find(item => item.textContent === label)!;

    // One click makes the dashed "DB3 · …" box inside the showroom, on the board no area uses yet, ready to describe.
    await act(async () => button("+ Add equipment inside a room").click());
    const panel = host.querySelector("aside")!;
    expect(panel.querySelector("h5")?.textContent).toBe("Equipment group");
    expect((panel.querySelector("select") as HTMLSelectElement).value).toBe("DB3");
    expect(panel.textContent).toContain("What it supplies");
    expect([...host.querySelectorAll("svg text")].some(text => text.textContent?.startsWith("DB3 · "))).toBe(true);

    // A placed device starts as a dot; its panel can switch it to a box with its name.
    await act(async () => button("On plan").click());
    const shapeSelect = () => [...host.querySelectorAll("aside label")].find(label => label.textContent?.startsWith("Show on the plan as"))!.querySelector("select") as HTMLSelectElement;
    const shape = shapeSelect();
    expect(shape.value).toBe("dot");
    expect(host.querySelectorAll("svg circle").length).toBeGreaterThan(0);
    await act(async () => { shape.value = "box"; shape.dispatchEvent(new Event("change", { bubbles: true })); });
    expect([...host.querySelectorAll("svg tspan")].map(item => item.textContent)).toContain("LED Display 1");
    expect(shapeSelect().value).toBe("box");
  } finally {
    await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
  }
});

it("pulls the edges of the drawing space to make it bigger or smaller, never cutting anything off", async () => {
  const plan = planFromReference(previous);
  expect(resizeCanvas(plan, 1250, 640).viewBox).toEqual([0, 0, 1250, 640]);
  expect(resizeCanvas(plan, 1000, 800).viewBox).toEqual([0, 0, 1000, 800]);
  // Shrinking stops at what is drawn: area B ends at x 480, y 520.
  const [width, height] = contentExtent(plan);
  expect(width).toBeGreaterThanOrEqual(500);
  expect(height).toBeGreaterThanOrEqual(540);
  expect(resizeCanvas(plan, 0, 0).viewBox).toEqual([0, 0, Math.round(width), Math.round(height)]);
  expect(resizeCanvas(plan, 99999, 99999).viewBox).toEqual([0, 0, 5000, 5000]);

  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("React", React);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<EnergyIqLocaleProvider><FloorPlanEditor projectId="office" notes="" block={null} previous={previous} meters={meters} boards={["DB2", "DB3"]} onCancel={() => undefined} onSaved={() => undefined} /></EnergyIqLocaleProvider>));
    const edge = (label: string) => host.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement;
    const viewBox = () => host.querySelector('svg[role="application"]')!.getAttribute("viewBox");
    const pull = async (label: string, dx: number, dy: number) => {
      const handle = edge(label);
      await act(async () => { handle.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 0, clientY: 0 })); });
      await act(async () => { handle.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: dx, clientY: dy })); });
      await act(async () => { handle.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: dx, clientY: dy })); });
    };
    // No buttons to keep clicking: pull the bottom edge down, then the right edge out (the test page has no layout, so 1 px = 1 unit).
    await pull("Drag to make the drawing space taller or shorter", 0, 160);
    expect(viewBox()).toBe("0 0 1000 800");
    await pull("Drag to make the drawing space wider or narrower", 250, 0);
    expect(viewBox()).toBe("0 0 1250 800");
    // Pulling the corner inwards shrinks both ways, but never past what is drawn.
    await pull("Drag to resize the drawing space", -5000, -5000);
    expect(viewBox()).toBe(`0 0 ${Math.round(width)} ${Math.round(height)}`);
    // The keyboard works too: arrow keys on a focused edge.
    await act(async () => { edge("Drag to make the drawing space taller or shorter").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
    expect(viewBox()).toBe(`0 0 ${Math.round(width)} ${Math.round(height) + 50}`);
  } finally {
    await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
  }
});

it("moves only an area's own rooms, even when another area overlaps them", () => {
  // Area D (DB3) is drawn over part of area B, covering the showroom that belongs to B.
  const base = planFromReference(previous);
  const plan: FloorPlan = { ...base, areas: [...base.areas, { key: "D", label: "D", board: "DB3", rect: [30, 60, 300, 260] }] };
  expect(plan.rooms[0]!.area).toBe("B");
  expect([...passengers(plan, { kind: "area", key: "D" }).rooms]).toEqual([]);
  const moved = moveSelection(plan, { kind: "area", key: "D" }, 100, 100, passengers(plan, { kind: "area", key: "D" }));
  expect(moved.rooms[0]!.rect).toEqual(plan.rooms[0]!.rect);
  expect(moved.devices).toEqual(plan.devices);
  // Moving B still takes its showroom, and saving keeps the showroom in zone B although D is smaller.
  expect([...passengers(plan, { kind: "area", key: "B" }).rooms]).toEqual(["room-1"]);
  expect(referenceFromPlan(plan, "office", previous).layout.rooms[0]!.zone).toBe("B");
  // A room dragged fully into another area joins that area.
  const relocated = settleRooms({ ...plan, areas: [...plan.areas, { key: "A", label: "A", board: "DB1", rect: [520, 20, 460, 500] }], rooms: [{ ...plan.rooms[0]!, rect: [560, 100, 200, 150] }] });
  expect(relocated.rooms[0]!.area).toBe("A");
});

it("tells people they can hold Alt to move an area without its rooms", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("React", React);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<EnergyIqLocaleProvider><FloorPlanEditor projectId="office" notes="" block={null} previous={previous} meters={meters} boards={["DB2", "DB3"]} onCancel={() => undefined} onSaved={() => undefined} /></EnergyIqLocaleProvider>));
    expect(host.querySelector("header p")?.textContent).toContain("hold Alt (⌥) while dragging to move an area on its own");
  } finally {
    await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
  }
});

it("gives each area, equipment box, room and device its own colour, saved with the layout", async () => {
  // Saved per item; an item without a colour follows its panel.
  const base = planFromReference(previous);
  const plan: FloorPlan = { ...base, areas: base.areas.map(item => ({ ...item, colour: "#d6453d" })), rooms: base.rooms.map(item => ({ ...item, colour: "#1b9aaa" })), devices: base.devices.map(item => ({ ...item, colour: "#8a6a4f" })) };
  const saved = referenceFromPlan(plan, "office", previous);
  expect(saved.layout.zones[0]).toMatchObject({ id: "B", colour: "#d6453d" });
  expect(saved.layout.rooms[0]).toMatchObject({ name: "Showroom", colour: "#1b9aaa" });
  expect(saved.layout.devices).toEqual([{ meterId: "led", position: [150, 150], colour: "#8a6a4f" }]);
  const reopened = planFromReference(saved);
  expect([reopened.areas[0]!.colour, reopened.rooms[0]!.colour, reopened.devices[0]!.colour]).toEqual(["#d6453d", "#1b9aaa", "#8a6a4f"]);
  expect(planFromReference({ ...saved, layout: { ...saved.layout, rooms: [{ ...saved.layout.rooms[0]!, colour: "red" } as never] } }).rooms[0]!.colour).toBeUndefined();

  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("React", React);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<EnergyIqLocaleProvider><FloorPlanEditor projectId="office" notes="" block={null} previous={previous} meters={meters} boards={["DB2", "DB3"]} onCancel={() => undefined} onSaved={() => undefined} /></EnergyIqLocaleProvider>));
    const button = (label: string) => [...host.querySelectorAll("button")].find(item => item.textContent === label)!;
    const picker = () => host.querySelector("aside fieldset")!;
    const pick = async (name: string) => act(async () => (picker().querySelector(`button[aria-label="${name}"]`) as HTMLButtonElement).click());
    // Make a DB3 equipment box inside the showroom and colour it teal.
    await act(async () => button("+ Add equipment inside a room").click());
    await pick("Teal");
    const group = () => host.querySelector('svg[role="application"] rect[class*="subgroup"]') as SVGRectElement;
    expect(group().style.fill).toBe("#1b9aaa");
    // Select area B and colour it red: the equipment box keeps its own colour.
    const area = () => host.querySelector('svg[role="application"] rect[class*="zone"]') as SVGRectElement;
    const panelColour = area().style.fill;
    await act(async () => { area().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 })); });
    await act(async () => { area().dispatchEvent(new PointerEvent("pointerup", { bubbles: true })); });
    expect(picker().querySelector("legend")?.textContent).toBe("Colour");
    expect(picker().textContent).toContain("Only this one changes");
    await pick("Red");
    expect(area().style.fill).toBe("#d6453d");
    expect(group().style.fill).toBe("#1b9aaa");
    // "Same as panel DB2" puts area B back to its panel colour, still without touching the box.
    await act(async () => button("Same as panel DB2").click());
    expect(area().style.fill).toBe(panelColour);
    expect(group().style.fill).toBe("#1b9aaa");
  } finally {
    await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
  }
});
