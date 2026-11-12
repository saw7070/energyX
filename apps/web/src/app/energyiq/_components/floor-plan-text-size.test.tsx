/** @vitest-environment happy-dom */
/**
 * Plan text keeps its size when the drawing space is made wider. Text and symbols used to be a hundredth of the drawing
 * space's width, so pulling an edge (or adding a template beside the blocks) made every name grow while the rooms stayed
 * the same size, until names ran into each other. Now the map, the editor and the editor's own geometry all size text
 * from the same rooms (spatialTextUnit / planUnit), so a wider space leaves it about as it was.
 */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EnergyIqLocaleProvider } from "./energyiq-locale";
import { FloorPlanEditor } from "./floor-plan-editor";
import { planFromReference, type StoredSpatialReference } from "./floor-plan-model";
import { insertTemplate } from "./floor-plan-templates";
import { planUnit } from "./floor-plan-unit";
import { SiteFloorMap } from "./site-floor-map";

afterEach(() => { vi.unstubAllGlobals(); });

type Rect = [number, number, number, number];
/** Shaped like SKTC: two tall block columns and a column of common areas, each a 300-wide area with 270-wide rooms. */
function estate(width: number): StoredSpatialReference {
  const column = (block: string, x: number, names: string[]) => names.map((name, index) => ({ name: `${block} ${name}`, zone: block, rect: [x + 15, 60 + index * 110, 270, 100] as Rect }));
  return {
    schemaVersion: 1, projectId: "estate", provenance: { file: "plan", status: "drawn" },
    layout: {
      viewBox: [0, 0, width, 640],
      zones: [
        { id: "264F", referenceBoard: "Block 264F", rect: [20, 20, 300, 600] },
        { id: "264E", referenceBoard: "Block 264E", rect: [340, 20, 300, 600] },
        { id: "264C", referenceBoard: "Common", rect: [660, 20, 300, 600] },
        { id: "LED", referenceBoard: "DB-L", independentSpace: false, physicalParentRoom: "264F GF lift lobby", equipment: "Lift lobby LED" },
      ],
      rooms: [
        ...column("264F", 20, ["Corridors L1-L17", "GF lift lobby", "GF decorative", "Emergency lighting", "Compassvale Bow entrance"]),
        ...column("264E", 340, ["Corridors L1-L17", "GF lift lobby", "GF decorative", "Emergency lighting", "Rubbish chute lamp"]),
        ...column("264C", 660, ["Driveway", "Pavilion", "Pavilion linkway", "Playground"]),
      ],
      devices: [{ meterId: "m1", position: [100, 100] }, { meterId: "m2", position: [230, 100] }, { meterId: "m3", position: [420, 320] }],
      labels: [{ id: "lb-1", text: "Compassvale Bow", position: [500, 628] }],
    } as StoredSpatialReference["layout"],
  };
}
const meters = [{ id: "m1", name: "L1-L6A Lighting", board: "Block 264F", type: "Lighting" }, { id: "m2", name: "Level 2-lvl17 Lighting", board: "Block 264F", type: "Lighting" }, { id: "m3", name: "RA-RB Lighting", board: "Block 264E", type: "Lighting" }];
const devices = meters.map(({ id, name, board }, index) => ({ id, name, board, position: estate(1000).layout.devices![index]!.position }));

async function render(node: React.ReactNode) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("React", React);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(<EnergyIqLocaleProvider>{node}</EnergyIqLocaleProvider>));
  return { host, unmount: async () => { await act(async () => root.unmount()); host.remove(); } };
}
/** Every text drawn at a size of its own (room and area names, device names, labels, the caption): text → size. */
const sizes = (svg: Element) => new Map([...svg.querySelectorAll("text")].flatMap(text => { const size = parseFloat((text as SVGTextElement).style.fontSize); return Number.isFinite(size) && text.textContent ? [[text.textContent, size] as const] : []; }));
/** The same texts at the same size, give or take 5%, in both drawings. */
function expectSameSizes(before: Map<string, number>, after: Map<string, number>, must: string[]) {
  for (const text of must) expect([...before.keys()].some(key => key.includes(text)), text).toBe(true);
  expect(after.size).toBe(before.size);
  for (const [text, size] of before) {
    expect(after.has(text), text).toBe(true);
    expect(after.get(text)! / size, text).toBeGreaterThan(0.95);
    expect(after.get(text)! / size, text).toBeLessThan(1.05);
  }
}
const named = ["264F Corridors L1-L17", "264E Rubbish chute lamp", "Pavilion linkway", "Block 264F", "Compassvale Bow", "L1-L6A"];

describe("plan text when the drawing space is made wider", () => {
  it("keeps the same size on the map when the space is pulled from 1000 to 2000 wide", async () => {
    const narrow = await render(<SiteFloorMap reference={estate(1000)} devices={devices} />);
    const wide = await render(<SiteFloorMap reference={estate(2000)} devices={devices} />);
    const before = sizes(narrow.host.querySelector("svg")!), after = sizes(wide.host.querySelector("svg")!);
    expectSameSizes(before, after, named);
    // Before the fix every one of them doubled (a hundredth of 2000 is twice a hundredth of 1000).
    expect(after.get("264C Pavilion linkway")! / before.get("264C Pavilion linkway")!).toBeLessThan(1.5);
    await narrow.unmount(); await wide.unmount();
  });

  it("keeps the same size in the editor, and the editor's equipment box matches the map's", async () => {
    const editor = (reference: StoredSpatialReference) => <FloorPlanEditor projectId="estate" notes="" block={null} previous={reference} meters={meters} boards={["Block 264F", "Block 264E", "Common", "DB-L"]} onCancel={() => undefined} onSaved={() => undefined} />;
    const narrow = await render(editor(estate(1000)));
    const wide = await render(editor(estate(2000)));
    const canvas = (host: HTMLElement) => host.querySelector('svg[role="application"]')!;
    expectSameSizes(sizes(canvas(narrow.host)), sizes(canvas(wide.host)), ["264F Corridors L1-L17", "Pavilion linkway", "Compassvale Bow"]);
    await narrow.unmount(); await wide.unmount();

    // Equipment saved by its room only is drawn where the map draws it, at the map's (unchanged) text size.
    const map = await render(<SiteFloorMap reference={estate(2000)} />);
    const box = map.host.querySelector("rect[stroke-dasharray]")!;
    const drawn = ["x", "y", "width", "height"].map(name => Number(box.getAttribute(name)));
    const group = planFromReference(estate(2000)).areas.find(item => item.insideRoom)!;
    group.rect.forEach((value, index) => expect(value).toBeCloseTo(drawn[index]!, 6));
    await map.unmount();
  });

  it("sizes the editor's text the same after a template makes the space wider", () => {
    const plan = planFromReference(estate(1000));
    expect(planUnit(plan)).toBe(10);
    const result = insertTemplate(plan, "hdb", 1, key => key, "D");
    if (!("plan" in result)) throw new Error("the template did not fit");
    expect(result.plan.viewBox[2]).toBeGreaterThan(1600);
    expect(planUnit(result.plan) / planUnit(plan)).toBeLessThan(1.05);
  });
});
