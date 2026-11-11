import { describe, expect, it } from "vitest";
import { readSpatialLabel, readSpatialSymbol, renderProjectSpatialSvg, spatialLabels, spatialRotation, spatialSymbols, type ProjectSpatialReference } from "./project-spatial.js";

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
});
