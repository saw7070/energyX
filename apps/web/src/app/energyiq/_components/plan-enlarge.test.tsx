/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { EnergyIqLocaleProvider } from "./energyiq-locale";
import { LANGUAGE_STORAGE_KEY } from "./energyiq-messages";
import { FloorPlanEditor, FloorPlanView } from "./floor-plan-editor";
import type { StoredSpatialReference } from "./floor-plan-model";

afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });
const reference = { schemaVersion: 1, projectId: "estate", provenance: { file: "plan", status: "drawn" }, layout: {
  viewBox: [0, 0, 1000, 640],
  zones: [{ id: "A", referenceBoard: "Block A", rect: [20, 20, 460, 560] }],
  rooms: [{ name: "Lift lobby", zone: "A", rect: [40, 80, 400, 200] }],
  devices: [{ meterId: "m1", position: [240, 180] }],
} } as unknown as StoredSpatialReference;
const meters = [{ id: "m1", name: "Lift lobby lights", board: "Block A", type: "Power" }];
async function render(node: React.ReactNode) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("React", React);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(<EnergyIqLocaleProvider>{node}</EnergyIqLocaleProvider>));
  return { host, unmount: async () => { await act(async () => root.unmount()); host.remove(); } };
}
const click = async (element: Element | null | undefined) => { expect(element).toBeTruthy(); await act(async () => (element as HTMLElement).click()); };
const button = (host: HTMLElement, text: string) => [...host.querySelectorAll("button")].find(item => item.textContent?.includes(text) || item.getAttribute("aria-label") === text);

it("opens the editor's small preview in a large view with zoom, and closes it", async () => {
  const { host, unmount } = await render(<FloorPlanEditor projectId="estate" notes="" block={null} previous={reference} meters={meters} boards={["Block A"]} onCancel={() => undefined} onSaved={() => undefined} />);
  const dialog = host.querySelector("dialog")!;
  expect(dialog.hasAttribute("open")).toBe(false);
  await click(button(host, "View the preview larger"));
  expect(dialog.hasAttribute("open")).toBe(true);
  expect(dialog.getAttribute("aria-label")).toBe("How it will look");
  expect(dialog.querySelector("svg")).not.toBeNull();
  const sheet = dialog.querySelector<HTMLElement>("[style*='width']")!;
  expect(sheet.style.width).toBe("100%");
  await click(button(dialog, "Zoom in"));
  expect(sheet.style.width).toBe("150%");
  expect(dialog.querySelector("output")?.textContent).toBe("150%");
  await click(button(dialog, "Fit"));
  expect(sheet.style.width).toBe("100%");
  await click(button(dialog, "Close"));
  expect(dialog.hasAttribute("open")).toBe(false);
  await unmount();
});

it("offers View larger on the Facility floor plan, in English, Chinese and Malay", async () => {
  for (const [locale, label, close] of [["en", "View larger", "Close"], ["zh-Hans", "放大查看", "关闭"], ["ms", "Lihat lebih besar", "Tutup"]] as const) {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
    const { host, unmount } = await render(<FloorPlanView reference={reference} meters={meters} highlight={null} focusDevice={null} canEdit onEdit={() => undefined} onSelectBoard={() => undefined} onSelectDevice={() => undefined} />);
    const dialog = host.querySelector("dialog")!;
    await click(button(host, label));
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(dialog.querySelectorAll("svg").length).toBeGreaterThan(0);
    await click(button(dialog, close));
    expect(dialog.hasAttribute("open")).toBe(false);
    await unmount();
  }
});
