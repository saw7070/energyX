/** @vitest-environment happy-dom */
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { EnergyIqLocaleProvider } from "./energyiq-locale";
import { LANGUAGE_STORAGE_KEY } from "./energyiq-messages";
import { FloorPlanEditor, FloorPlanView } from "./floor-plan-editor";

afterEach(() => { localStorage.clear(); document.documentElement.lang = "en"; vi.unstubAllGlobals(); });

const meters = [{ id: "tv", name: "Showroom TV", board: "DB1", type: "Power" }];

async function render(node: React.ReactNode) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("React", React);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<EnergyIqLocaleProvider>{node}</EnergyIqLocaleProvider>));
  return { host, unmount: async () => { await act(async () => root.unmount()); host.remove(); } };
}
const editor = <FloorPlanEditor projectId="office" notes="" block={null} previous={null} meters={meters} boards={["DB1"]} onCancel={() => undefined} onSaved={() => undefined} />;
/** Like the Floor layout tab: the editor opens when the reader chooses Draw the layout. */
function FloorLayout() {
  const [editing, setEditing] = useState(false);
  return editing ? editor : <FloorPlanView reference={null} meters={meters} highlight={null} focusDevice={null} canEdit onEdit={() => setEditing(true)} onSelectBoard={() => undefined} onSelectDevice={() => undefined} />;
}

it("shows the floor plan and its editor in English by default", async () => {
  const { host, unmount } = await render(<>
    <FloorPlanView reference={null} meters={meters} highlight={null} focusDevice={null} canEdit onEdit={() => undefined} onSelectBoard={() => undefined} onSelectDevice={() => undefined} />
    {editor}
  </>);
  expect(host.querySelector('section[aria-label="Floor plan"] button')?.textContent).toBe("Draw the layout");
  expect(host.querySelector('[role="toolbar"]')?.getAttribute("aria-label")).toBe("Floor plan tools");
  expect(host.querySelector("svg text")?.textContent).toBe("DB1Area A");
  expect(host.textContent).toContain("0 of 1 placed");
  await unmount();
});

it("shows the floor plan and its editor in Chinese and Malay, leaving the site's own names as they are", async () => {
  localStorage.setItem(LANGUAGE_STORAGE_KEY, "zh-Hans");
  const chinese = await render(<FloorLayout />);
  const view = chinese.host.querySelector('section[aria-label="平面图"]')!;
  expect(view.querySelector("h4")?.textContent).toBe("平面图");
  expect(view.querySelector("p")?.textContent).toBe("还没有平面图。画出场地布局，让大家都能看到每个配电箱和每台设备的位置。");
  const draw = view.querySelector("button")!;
  expect(draw.textContent).toBe("绘制布局");
  await act(async () => draw.click());
  const editing = chinese.host.querySelector('section[aria-label="修改平面图"]')!;
  expect(editing.querySelector("h4")?.textContent).toBe("修改平面图");
  expect(editing.querySelector('[role="toolbar"]')?.getAttribute("aria-label")).toBe("平面图工具");
  expect([...editing.querySelectorAll("header button")].map(button => button.textContent)).toEqual(["取消", "保存布局"]);
  // A new plan starts with one area and one room per board, named in the reader's language; the board keeps its name.
  expect([...editing.querySelectorAll("svg text")].map(text => text.textContent)).toEqual(["DB1区域 A", "房间 1"]);
  expect(editing.textContent).toContain("已放置 0/1");
  expect(editing.textContent).toContain("Showroom TV");
  await chinese.unmount();

  localStorage.setItem(LANGUAGE_STORAGE_KEY, "ms");
  const malay = await render(<FloorLayout />);
  await act(async () => malay.host.querySelector("button")!.click());
  expect(malay.host.querySelector("h4")?.textContent).toBe("Ubah pelan lantai");
  expect(malay.host.textContent).toContain("0 daripada 1 diletakkan");
  expect(malay.host.textContent).toContain("Letakkan selebihnya di kawasan papan masing-masing");
  await malay.unmount();
});
