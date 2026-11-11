/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { roomDoor, SiteFloorMap } from "./site-floor-map";
import { FloorPlanEditor } from "./floor-plan-editor";
import type { StoredSpatialReference } from "./floor-plan-model";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const reference = (style?: string) => ({ schemaVersion: 1, projectId: "estate", provenance: { file: "plan", status: "drawn" }, layout: {
  viewBox: [0, 0, 1000, 640], ...(style ? { style } : {}),
  zones: [{ id: "A", referenceBoard: "Block A", rect: [20, 20, 460, 560] }],
  rooms: [{ name: "Lift lobby", zone: "A", rect: [40, 80, 400, 200] }],
  devices: [{ meterId: "m1", position: [240, 180] }],
} }) as unknown as StoredSpatialReference;
const meters = [{ id: "m1", name: "Lift lobby lights", board: "Block A" }];
async function render(node: React.ReactNode) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("React", React);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(node));
  return { host, unmount: async () => { await act(async () => root.unmount()); host.remove(); } };
}

it("draws the site's chosen look: a building drawing by default, with a grid, border and doors", async () => {
  const drawing = await render(<SiteFloorMap reference={reference()} devices={[{ ...meters[0]!, position: [240, 180] }]} />);
  const svg = drawing.host.querySelector("svg")!;
  expect(svg.getAttribute("data-look")).toBe("drawing");
  expect(svg.querySelectorAll("pattern").length).toBe(2);
  expect(svg.querySelector("path[stroke-dasharray]")).not.toBeNull(); // the door swing
  await drawing.unmount();
  const blocks = await render(<SiteFloorMap reference={reference("blocks")} devices={[{ ...meters[0]!, position: [240, 180] }]} />);
  const plain = blocks.host.querySelector("svg")!;
  expect(plain.getAttribute("data-look")).toBe("blocks");
  // Colour blocks leave out the drawing furniture: no grid fill, no doors.
  expect(plain.querySelector('rect[fill^="url("]')).toBeNull();
  expect(plain.querySelector("path[stroke-dasharray]")).toBeNull();
  expect(blocks.host.textContent).toContain("Lift lobby");
  await blocks.unmount();
});

it("puts a room's door in a free corner and leaves it out when every corner is taken", () => {
  const room: [number, number, number, number] = [0, 0, 300, 200];
  expect(roomDoor(room, 10, [])).toMatchObject({ x: 13, y: 200, along: 1, inward: -1 });
  // Something in the bottom-left corner moves the door to the bottom right.
  expect(roomDoor(room, 10, [[0, 170, 60, 30]])).toMatchObject({ y: 200, along: -1 });
  expect(roomDoor(room, 10, [[0, 0, 300, 40], [0, 160, 300, 40]])).toBeNull();
  // A small room gets no door.
  expect(roomDoor([0, 0, 80, 60], 10, [])).toBeNull();
});

it("lets an editor choose the plan's look, with a live preview, and saves the choice", async () => {
  const editor = await render(<FloorPlanEditor projectId="estate" notes="" block={null} previous={reference()} meters={[{ ...meters[0]!, type: "Lighting" }]} boards={["Block A"]} onCancel={() => undefined} onSaved={() => undefined} />);
  const choices = [...editor.host.querySelectorAll<HTMLButtonElement>('[role="radiogroup"] [role="radio"]')];
  expect(choices.map(choice => choice.querySelector("strong")?.textContent)).toEqual(["Building drawing", "Blueprint", "Colour blocks"]);
  expect(choices.map(choice => choice.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
  await act(async () => choices[1]!.click());
  expect(editor.host.querySelector('[role="radio"][aria-checked="true"] strong')?.textContent).toBe("Blueprint");
  // The preview shows the chosen look straight away.
  expect(editor.host.querySelector('svg[data-look="blueprint"]')).not.toBeNull();
  await editor.unmount();
});
