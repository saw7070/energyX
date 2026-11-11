/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { readProjectSpatialReference } from "@datafoundry/contracts";
import { configApi } from "../../../lib/config-api";
import { EnergyIqLocaleProvider } from "./energyiq-locale";
import { LANGUAGE_STORAGE_KEY } from "./energyiq-messages";
import { FloorPlanEditor } from "./floor-plan-editor";
import { notesWithReference, planFromReference, referenceFromPlan, type StoredSpatialReference } from "./floor-plan-model";
import { SiteFloorMap, mapDevices } from "./site-floor-map";

afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const meters = [{ id: "tv", name: "Showroom TV", board: "DB1", type: "Power" }];
const previous = {
  schemaVersion: 1, projectId: "office", provenance: { file: "plan", status: "Edited in Facility → Floor layout" },
  layout: {
    viewBox: [0, 0, 1000, 640],
    zones: [{ id: "A", referenceBoard: "DB1", rect: [20, 20, 460, 500], directionFromEntrance: "left", futureKey: { keep: true } }, { id: "Roof", referenceBoard: "DB9" }],
    rooms: [{ name: "Showroom", zone: "A", rect: [40, 80, 260, 200], id: "r1" }],
    entrance: { label: "Gate", position: [500, 600] },
    devices: [{ meterId: "tv", position: [100, 150] }],
    levels: [{ id: "GF" }],
  },
} as unknown as StoredSpatialReference;
const notes = notesWithReference("Office notes.", null, previous);
const block = readProjectSpatialReference(notes, "office")!.block;

async function render(props: Partial<React.ComponentProps<typeof FloorPlanEditor>> = {}) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("React", React);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const onCancel = vi.fn(), onSaved = vi.fn();
  await act(async () => root.render(<EnergyIqLocaleProvider><FloorPlanEditor projectId="office" notes={notes} block={block} previous={previous} meters={meters} boards={["DB1"]} onCancel={onCancel} onSaved={onSaved} {...props} /></EnergyIqLocaleProvider>));
  const button = (label: string) => [...host.querySelectorAll("button")].find(item => item.textContent === label) as HTMLButtonElement;
  const canvas = () => host.querySelector('svg[role="application"]') as SVGSVGElement;
  const press = async (target: EventTarget, key: string, extra: KeyboardEventInit = {}) => { await act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra })); }); };
  const roomRect = () => canvas().querySelectorAll("g")[1]!.querySelector("rect")!.getAttribute("x");
  return { host, button, canvas, press, roomRect, onCancel, onSaved, unmount: async () => { await act(async () => root.unmount()); host.remove(); } };
}
const pointer = (type: string, x: number, y: number) => new PointerEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1 });

it("redoes what was undone, from the toolbar and with the keyboard, while the plan has focus", async () => {
  const view = await render();
  const rooms = () => view.canvas().querySelectorAll(".roomLabel, text").length;
  const before = rooms();
  await act(async () => view.button("+ Add room").click());
  const added = rooms();
  expect(added).toBeGreaterThan(before);
  expect(view.button("Redo").disabled).toBe(true);
  await act(async () => view.button("Undo").click());
  expect(rooms()).toBe(before);
  await act(async () => view.button("Redo").click());
  expect(rooms()).toBe(added);
  await view.press(view.canvas(), "z", { ctrlKey: true });
  expect(rooms()).toBe(before);
  await view.press(view.canvas(), "z", { ctrlKey: true, shiftKey: true });
  expect(rooms()).toBe(added);
  await view.press(view.canvas(), "z", { metaKey: true });
  await view.press(view.canvas(), "y", { ctrlKey: true });
  expect(rooms()).toBe(added);
  await view.unmount();
});

it("makes a drag one undo step", async () => {
  const view = await render();
  const area = view.canvas().querySelector("g")!;
  const x = () => view.canvas().querySelector("g rect")!.getAttribute("x");
  expect(x()).toBe("20");
  await act(async () => { area.dispatchEvent(pointer("pointerdown", 100, 100)); });
  for (const step of [20, 40, 60]) await act(async () => { view.canvas().dispatchEvent(pointer("pointermove", 100 + step, 100)); });
  await act(async () => { view.canvas().dispatchEvent(pointer("pointerup", 160, 100)); });
  expect(x()).toBe("80");
  await act(async () => view.button("Undo").click());
  expect(x()).toBe("20");
  expect(view.button("Undo").disabled).toBe(true);
  await view.unmount();
});

it("keeps keys for the field being typed in, and ignores them outside the editor", async () => {
  const view = await render();
  // Select the room by pressing on it; the plan takes focus.
  await act(async () => { view.canvas().querySelectorAll("g")[1]!.dispatchEvent(pointer("pointerdown", 50, 90)); view.canvas().dispatchEvent(pointer("pointerup", 50, 90)); });
  expect(view.host.querySelector("aside h5")?.textContent).toBe("Room");
  const name = view.host.querySelector("aside input") as HTMLInputElement;
  for (const [key, extra] of [["Delete", {}], ["Backspace", {}], ["ArrowRight", {}], ["z", { ctrlKey: true }]] as const) await view.press(name, key, extra);
  await view.press(document.body, "Delete");
  await view.press(view.button("Undo"), "Delete");
  expect(view.roomRect()).toBe("40");
  expect(view.host.querySelector("aside h5")?.textContent).toBe("Room");
  // On the plan itself the same keys work.
  await view.press(view.canvas(), "ArrowRight");
  expect(view.roomRect()).toBe("50");
  await view.press(view.canvas(), "Delete");
  expect(view.host.querySelector("aside h5")?.textContent).not.toBe("Room");
  await view.unmount();
});

it("undoes and cancels with the keyboard while a button of the editor has focus, but never deletes from there", async () => {
  const view = await render({ meters: [...meters, { id: "fan", name: "Pantry fan", board: "DB1", type: "Power" }] });
  const rooms = () => view.canvas().querySelectorAll("text").length;
  const before = rooms();
  const add = view.button("+ Add room");
  await act(async () => add.click());
  expect(rooms()).toBeGreaterThan(before);
  // The button just clicked still has focus: Ctrl+Z undoes, Delete does nothing.
  await view.press(add, "z", { ctrlKey: true });
  expect(rooms()).toBe(before);
  await view.press(add, "z", { ctrlKey: true, shiftKey: true });
  expect(rooms()).toBeGreaterThan(before);
  await view.press(view.button("Undo"), "Delete");
  expect(rooms()).toBeGreaterThan(before);
  // Escape on the Place button stops placing a device.
  const placeButton = view.button("Place");
  await act(async () => placeButton.click());
  expect(view.host.querySelector('[role="status"]')?.textContent).toContain("Pantry fan");
  await view.press(placeButton, "Escape");
  expect(view.host.querySelector('[role="status"]')).toBeNull();
  await view.unmount();
});

it("makes holding an arrow key one undo step, while separate presses stay separate", async () => {
  const view = await render();
  await act(async () => { view.canvas().querySelectorAll("g")[1]!.dispatchEvent(pointer("pointerdown", 50, 90)); view.canvas().dispatchEvent(pointer("pointerup", 50, 90)); });
  await view.press(view.canvas(), "ArrowRight");
  for (let step = 0; step < 5; step += 1) await view.press(view.canvas(), "ArrowRight", { repeat: true });
  expect(view.roomRect()).toBe("100");
  await act(async () => view.button("Undo").click());
  expect(view.roomRect()).toBe("40");
  expect(view.button("Undo").disabled).toBe(true);
  await view.press(view.canvas(), "ArrowRight");
  await view.press(view.canvas(), "ArrowRight");
  await act(async () => view.button("Undo").click());
  expect(view.roomRect()).toBe("50");
  await view.unmount();
});

it("leaves no undo step and nothing to save after a drag that comes back to where it began", async () => {
  const view = await render();
  const leave = () => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; };
  const area = view.canvas().querySelector("g")!;
  await act(async () => { area.dispatchEvent(pointer("pointerdown", 100, 100)); });
  for (const step of [40, 0]) await act(async () => { view.canvas().dispatchEvent(pointer("pointermove", 100 + step, 100)); });
  await act(async () => { view.canvas().dispatchEvent(pointer("pointerup", 100, 100)); });
  expect(view.canvas().querySelector("g rect")!.getAttribute("x")).toBe("20");
  expect(view.button("Undo").disabled).toBe(true);
  expect(leave()).toBe(false);
  await view.unmount();
});

it("says plainly when the plan would not fit in Project notes, without trying to save", async () => {
  const request = vi.spyOn(configApi, "reportAgentRequest").mockResolvedValue({} as never);
  const big = "x".repeat(99_800) + "\n\n";
  const view = await render({ notes: big + block, block });
  await act(async () => view.button("Save layout").click());
  expect(view.host.querySelector('[role="alert"]')?.textContent).toMatch(/^The floor plan is too big to save\. Project notes can hold up to 100,000 characters, and with this plan they would hold 10\d,\d{3}\./);
  expect(request).not.toHaveBeenCalled();
  await view.unmount();
});

it("saves everything the editor does not draw, and reports a change made elsewhere meanwhile", async () => {
  const sent: string[] = [];
  const request = vi.spyOn(configApi, "reportAgentRequest").mockImplementation(async (_project, path, options) => {
    if (!path) return { settings: { contextNotes: notes, revision: 4 } } as never;
    sent.push(String(options?.body)); return {} as never;
  });
  const view = await render();
  await act(async () => view.button("Save layout").click());
  expect(view.onSaved).toHaveBeenCalled();
  const body = JSON.parse(sent[0]!) as { contextNotes: string; revision: number };
  expect(body.revision).toBe(4);
  expect(body.contextNotes).toBe(notes);

  request.mockImplementation(async (_project, path) => { if (!path) return { settings: { contextNotes: notes, revision: 4 } } as never; throw new Error("REPORT_SETTINGS_CHANGED"); });
  await act(async () => view.button("Save layout").click());
  expect(view.host.querySelector('[role="alert"]')?.textContent).toBe("Project notes changed since this page loaded. Copy your changes, refresh and try again.");
  await view.unmount();
});

it("asks before leaving with changes not saved, inside the page and when closing it", async () => {
  const view = await render();
  const leave = () => { const event = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; };
  expect(leave()).toBe(false);
  await act(async () => view.button("Cancel").click());
  expect(view.onCancel).toHaveBeenCalledTimes(1);

  await act(async () => view.button("+ Add room").click());
  expect(leave()).toBe(true);
  await act(async () => view.button("Cancel").click());
  expect(view.onCancel).toHaveBeenCalledTimes(1);
  expect(view.host.querySelector('[role="alert"]')?.textContent).toContain("You have changes that are not saved yet.");
  await act(async () => view.button("Keep editing").click());
  expect(view.host.querySelector('[role="alert"]')).toBeNull();
  await act(async () => view.button("Cancel").click());
  await act(async () => view.button("Leave without saving").click());
  expect(view.onCancel).toHaveBeenCalledTimes(2);
  // Undoing back to how it opened is not a change.
  await act(async () => view.button("Undo").click());
  expect(leave()).toBe(false);
  await view.unmount();
});

it("lists areas that are not on the drawing, in the reader's language", async () => {
  const english = await render();
  const panel = [...english.host.querySelectorAll("aside h5")].find(item => item.textContent === "Not on the drawing")!.parentElement!;
  expect(panel.querySelector("li")?.textContent).toBe("Roof · DB9");
  await english.unmount();

  localStorage.setItem(LANGUAGE_STORAGE_KEY, "zh-Hans");
  const chinese = await render();
  expect(chinese.host.textContent).toContain("不在图上");
  expect(chinese.button("重做")).toBeDefined();
  await chinese.unmount();

  localStorage.setItem(LANGUAGE_STORAGE_KEY, "ms");
  const malay = await render();
  expect(malay.host.textContent).toContain("Tiada pada lukisan");
  expect(malay.button("Buat semula")).toBeDefined();
  await malay.unmount();
});

it("draws a re-saved layout exactly as before, in every plan style", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("React", React);
  for (const style of ["drawing", "blueprint", "blocks"] as const) {
    const original = { ...previous, layout: { ...previous.layout, style } } as StoredSpatialReference;
    const saved = referenceFromPlan(planFromReference(original), "office", original);
    const markup: string[] = [];
    for (const reference of [original, saved]) {
      const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
      await act(async () => root.render(<SiteFloorMap reference={reference} devices={mapDevices(reference, meters)} />));
      markup.push(host.innerHTML.replace(/-r[0-9a-z]+\b/g, "-id"));
      expect(host.querySelector("svg")?.getAttribute("data-look")).toBe(style);
      await act(async () => root.unmount()); host.remove();
    }
    expect(markup[1]).toBe(markup[0]);
  }
});
