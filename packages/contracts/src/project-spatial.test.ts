import { describe, expect, it } from "vitest";
import { readSpatialLabel, readSpatialSymbol, renderProjectSpatialSvg, spatialLabels, spatialRotation, spatialSymbols, spatialTextUnit, type ProjectSpatialReference } from "./project-spatial.js";

const base = { schemaVersion: 1 as const, projectId: "estate", provenance: { file: "plan", status: "drawn" }, layout: { viewBox: [0, 0, 1000, 640] as [number, number, number, number], zones: [{ id: "A", referenceBoard: "DB1", rect: [10, 10, 500, 500] as [number, number, number, number] }], rooms: [{ name: "Lobby", zone: "A", rect: [20, 60, 200, 150] as [number, number, number, number] }] } };
const withMarks = (layout: Record<string, unknown>) => ({ ...base, layout: { ...base.layout, ...layout } }) as ProjectSpatialReference;

describe("drawing marks: text labels and landmarks", () => {
  it("draws text labels and landmarks simply, turned where they are turned, and escapes their text", () => {
    const svg = renderProjectSpatialSvg(withMarks({
      entrance: { label: "Main gate", position: [500, 600] },
      labels: [{ id: "lb-1", text: "Car park <exit>", position: [700, 100], size: "l", rotation: 90, bold: true, colour: "#d6453d" }],
      symbols: [{ kind: "entrance", position: [500, 600], label: "Main gate" }, { kind: "entrance", position: [900, 300], rotation: 270, label: "Side gate" }, { kind: "tree", position: [800, 500], label: "Rain tree" }, { kind: "futureThing", position: [850, 500] }],
    }));
    expect(svg).toContain("Car park &lt;exit&gt;");
    expect(svg).not.toContain("<exit>");
    expect(svg).toContain('transform="rotate(90 700 100)"');
    expect(svg).toContain('font-weight="bold"');
    expect(svg).toContain('fill="#d6453d"');
    expect(svg).toContain("Side gate");
    expect(svg).toContain('transform="rotate(270 900 300)"');
    expect(svg).toContain("Rain tree");
    // The main gate is drawn once, though both the legacy entrance and its symbol name it.
    expect(svg.match(/Main gate/g)).toHaveLength(1);
    // A kind this version does not know is drawn as a plain dot.
    expect(svg).toContain('cx="850"');
  });

  it("draws a layout saved before labels and landmarks existed exactly as before", () => {
    const old = withMarks({ entrance: { label: "Main gate", position: [500, 600] } });
    expect(renderProjectSpatialSvg(old)).toBe(renderProjectSpatialSvg(base as ProjectSpatialReference));
  });

  it("treats saved marks as untrusted: bad text, colours, kinds, numbers and long lists are left out or cut short", () => {
    expect(readSpatialLabel({ text: "  ", position: [1, 1] })).toBeNull();
    expect(readSpatialLabel({ text: "Hi", position: [1, Number.NaN] })).toBeNull();
    expect(readSpatialLabel({ text: "Hi", position: [1, 20000] })).toBeNull();
    expect(readSpatialLabel({ text: 5, position: [1, 1] })).toBeNull();
    expect(readSpatialLabel({ text: "x".repeat(200), position: [1, 1] })!.text).toHaveLength(80);
    expect(readSpatialLabel({ text: "Hi", position: [1, 1], colour: "red", size: "xl", rotation: "90", bold: "yes", locked: 1 })).toEqual({ text: "Hi", position: [1, 1] });
    expect(readSpatialLabel({ text: "Hi", position: [1, 1], rotation: -15 })!.rotation).toBe(345);
    expect(readSpatialSymbol({ kind: "<script>", position: [1, 1] })).toBeNull();
    expect(readSpatialSymbol({ kind: "tree", position: [1, 1], size: 1e9, label: "", id: "bad id!" })).toEqual({ kind: "tree", position: [1, 1] });
    expect(readSpatialSymbol({ kind: "spaceship", position: [1, 1] })!.kind).toBe("spaceship");
    expect([spatialRotation(720), spatialRotation(359.6), spatialRotation(Infinity)]).toEqual([0, 0, null]);
    expect(spatialLabels({ labels: Array.from({ length: 400 }, (_, i) => ({ text: `L${i}`, position: [i, i] })) })).toHaveLength(300);
    expect(spatialLabels({ labels: "not a list" })).toEqual([]);
  });

  it("takes the legacy entrance as the first entrance, without drawing it twice", () => {
    expect(spatialSymbols({ entrance: { label: "Gate", position: [10, 20] } })).toEqual([{ kind: "entrance", position: [10, 20], label: "Gate", legacy: true }]);
    const both = spatialSymbols({ entrance: { label: "Gate", position: [10, 20] }, symbols: [{ kind: "lift", position: [5, 5] }, { kind: "entrance", position: [10.2, 19.8], rotation: 90 }] });
    expect(both).toEqual([{ kind: "lift", position: [5, 5] }, { kind: "entrance", position: [10.2, 19.8], rotation: 90, label: "Gate", legacy: true }]);
  });

  it("follows the main entrance when only layout.entrance was moved, so it is never drawn twice", () => {
    const moved = spatialSymbols({ entrance: { label: "Gate", position: [300, 20] }, symbols: [{ kind: "entrance", position: [80, 20], label: "Side door" }, { kind: "entrance", position: [10, 20], label: "Gate", rotation: 90 }] });
    expect(moved).toEqual([{ kind: "entrance", position: [80, 20], label: "Side door" }, { kind: "entrance", position: [300, 20], label: "Gate", rotation: 90, legacy: true }]);
    // An entrance symbol with another name is a different entrance: the legacy one is added in front, as before.
    expect(spatialSymbols({ entrance: { label: "Gate", position: [300, 20] }, symbols: [{ kind: "entrance", position: [80, 20], label: "Side door" }] })).toHaveLength(2);
  });
});

describe("the size of plan text and symbols", () => {
  type Rect = [number, number, number, number];
  // Shaped like SKTC: 1000 wide, narrow block columns (300-wide areas) holding rooms 270-290 wide.
  const areas: Rect[] = [[20, 20, 300, 600], [340, 20, 300, 600], [660, 20, 300, 600]];
  const rooms: Rect[] = [270, 280, 290, 275, 285, 280, 270, 290, 280].map((width, index) => [35 + (index % 3) * 320, 60 + Math.floor(index / 3) * 110, width, 100]);
  const shifted = (rects: Rect[], dx: number): Rect[] => rects.map(([x, y, w, h]) => [x + dx, y, w, h]);

  it("is a hundredth of the width with no rooms, and for a plan whose rooms fit (SKTC exactly as before)", () => {
    expect(spatialTextUnit([0, 0, 1000, 640], [])).toBe(10);
    expect(spatialTextUnit([0, 0, 1234, 640], [], areas)).toBe(12.34);
    expect(spatialTextUnit([0, 0, 1000, 640], rooms)).toBe(10);
    expect(spatialTextUnit([0, 0, 1000, 640], rooms, areas)).toBe(10);
  });

  it("stays about the same when the drawing space is made wider around the same rooms", () => {
    // A 26th of the typical room (280 wide), not a hundredth of the new width (20).
    for (const unit of [spatialTextUnit([0, 0, 2000, 640], rooms), spatialTextUnit([0, 0, 2000, 640], rooms, areas), spatialTextUnit([0, 0, 2000, 640], shifted(rooms, 1000), shifted(areas, 1000))]) expect(unit).toBeCloseTo(280 / 26, 9);
    // A template beside the narrow blocks widens the space to 1720 without making the text grow with it.
    const template: Rect[] = [[1020, 80, 240, 80], [1270, 70, 160, 130], [1440, 80, 240, 80], [1020, 220, 320, 100], [1360, 220, 320, 100]];
    expect(spatialTextUnit([0, 0, 1720, 640], [...rooms, ...template], [...areas, [1000, 20, 700, 320]])).toBeCloseTo(280 / 26, 9);
  });

  it("keeps the old size for roomy areas that fill the space, however narrow their rooms, and keeps it when the space grows past them", () => {
    // Areas 480-500 wide filling a 1600-wide space, rooms only 200-220 wide (like the editor's test estate).
    const roomy: Rect[] = [[20, 20, 500, 700], [560, 20, 500, 700], [1100, 20, 480, 400], [1100, 460, 480, 300]];
    const narrow: Rect[] = [200, 220, 220, 200, 220, 220, 220].map((width, index) => [40 + index * 210, 80, width, 160]);
    expect(spatialTextUnit([0, 0, 1600, 900], narrow, roomy)).toBe(16);
    expect(spatialTextUnit([0, 0, 3200, 900], narrow, roomy)).toBe(16);
    expect(spatialTextUnit([0, 0, 3200, 900], shifted(narrow, 1600), shifted(roomy, 1600))).toBe(16);
  });

  it("never drops below 40% of a hundredth of the width, and skips malformed boxes", () => {
    expect(spatialTextUnit([0, 0, 1000, 640], [[0, 0, 50, 50], [60, 0, 40, 50]])).toBe(4);
    const messy = [...rooms, [1, 2], null, "room", [0, 0, -5, 5], [0, 0, 0, 5], [0, 0, Number.NaN, 5], [0, 0, Infinity, 5], [0, 0, "300", 5]];
    expect(spatialTextUnit([0, 0, 2000, 640], messy, [null, [1, 1], ...areas])).toBe(spatialTextUnit([0, 0, 2000, 640], rooms, areas));
    expect(spatialTextUnit([0, 0, 1000, 640], [[1, 2], null, [0, 0, -5, 5]])).toBe(10);
  });
});
