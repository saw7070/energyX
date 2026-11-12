/** @vitest-environment happy-dom */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { EnergyIqLocaleProvider } from "./energyiq-locale";
import { LANGUAGE_STORAGE_KEY } from "./energyiq-messages";
import { FloorPlanEditor } from "./floor-plan-editor";

afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });
const meters = [{ id: "tv", name: "Showroom TV", board: "DB1", type: "Power" }];
async function render() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("React", React);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(<EnergyIqLocaleProvider><FloorPlanEditor projectId="office" notes="" block={null} previous={null} meters={meters} boards={["DB1"]} onCancel={() => undefined} onSaved={() => undefined} /></EnergyIqLocaleProvider>));
  return { host, unmount: async () => { await act(async () => root.unmount()); host.remove(); } };
}

it("keeps the editor header to two short lines, with the keys and tips folded away, in all three languages", async () => {
  for (const [locale, intro, label] of [["en", "Drag to move; pull a corner or an edge to resize.", "Keys and tips"], ["zh-Hans", "拖动可移动位置", "按键和提示"], ["ms", "Seret untuk mengalihkan", "Kekunci dan petua"]] as const) {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
    const { host, unmount } = await render();
    const header = host.querySelector("header")!;
    const paragraphs = [...header.querySelectorAll(":scope > div > p")].map(p => p.textContent ?? "");
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]).toContain(intro);
    expect(paragraphs.every(text => text.length < 200)).toBe(true);
    const tips = header.querySelector("details")!;
    expect(tips.open).toBe(false);
    expect(tips.querySelector("summary")?.textContent).toBe(label);
    const items = [...tips.querySelectorAll("li")].map(li => li.textContent ?? "");
    expect(items).toHaveLength(6);
    // Key names are filled in, never left as {placeholders}.
    expect(items.some(text => /\{\w+\}/.test(text))).toBe(false);
    await unmount();
  }
});
