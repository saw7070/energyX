import { describe, expect, it } from "vitest";
import { isSpatialLine, isSpatialOpening, openingRoom, openingSpan, spatialLines, spatialOpenings } from "./project-spatial-drawing.js";
import { renderProjectSpatialSvg, type ProjectSpatialReference } from "./project-spatial.js";

const reference = { schemaVersion: 1, projectId: "office", provenance: { file: "plan", status: "drawn" }, layout: { viewBox: [0, 0, 800, 500], zones: [{ id: "A", referenceBoard: "DB1", rect: [10, 10, 600, 400] }], rooms: [{ name: "Store", zone: "A", rect: [20, 60, 200, 100], id: "rm-1" }, { name: "Office", zone: "A", rect: [240, 60, 200, 100] }] } } as ProjectSpatialReference;

describe("doors, windows and walls on a layout", () => {
  it("reads only well-formed openings and lines, and caps how many", () => {
    const good = { id: "op-1", room: "Store", wall: "e", offset: 0.5, width: 30, kind: "door" };
    expect(isSpatialOpening(good)).toBe(true);
    for (const bad of [{ ...good, wall: "up" }, { ...good, offset: 2 }, { ...good, width: -1 }, { ...good, width: Number.NaN }, { ...good, kind: "portal" }, { ...good, id: "<x>" }, { ...good, swing: "sideways" }, { ...good, room: "" }, null, "door"]) expect(isSpatialOpening(bad)).toBe(false);
    const line = { id: "ln-1", points: [[0, 0], [100, 0]], style: "wall" };
    expect(isSpatialLine(line)).toBe(true);
    for (const bad of [{ ...line, points: [[0, 0]] }, { ...line, points: [[0, 0], [1e9, 0]] }, { ...line, points: [[0, 0], ["1", 2]] }, { ...line, style: "laser" }, { ...line, thickness: "xl" }, { ...line, points: Array.from({ length: 201 }, (_, i) => [i, i]) }]) expect(isSpatialLine(bad)).toBe(false);
    expect(spatialOpenings({ openings: Array.from({ length: 500 }, (_, i) => ({ ...good, id: `op-${i}` })) })).toHaveLength(400);
    expect(spatialLines({ lines: Array.from({ length: 150 }, (_, i) => ({ ...line, id: `ln-${i}` })) })).toHaveLength(100);
    expect(spatialLines({ lines: "nope" })).toEqual([]);
    expect(spatialOpenings(null)).toEqual([]);
  });

  it("finds an opening's room by id, then by name, and keeps the opening on its wall", () => {
    expect(openingRoom(reference.layout.rooms, { room: "rm-1" })?.name).toBe("Store");
    expect(openingRoom(reference.layout.rooms, { room: "Office" })?.name).toBe("Office");
    expect(openingRoom(reference.layout.rooms, { room: "Gone" })).toBeUndefined();
    expect(openingSpan([0, 0, 200, 100], { wall: "e", offset: 0.5, width: 30 })).toEqual({ a: [200, 35], b: [200, 65], inward: [-1, 0], width: 30 });
    // Too wide for the wall, or pushed past its end: it is clamped to fit.
    expect(openingSpan([0, 0, 200, 100], { wall: "n", offset: 1, width: 500 })).toMatchObject({ a: [0, 0], b: [200, 0], width: 200 });
    expect(openingSpan([0, 0, 200, 100], { wall: "s", offset: 0, width: 40 })).toMatchObject({ a: [0, 100], b: [40, 100] });
  });

  it("draws lines on the advisor's picture, and nothing new for a layout without them", () => {
    const before = renderProjectSpatialSvg(reference);
    expect(before).not.toContain("<polyline");
    const svg = renderProjectSpatialSvg({ ...reference, layout: { ...reference.layout, lines: [{ id: "ln-1", points: [[20, 450], [600, 450]], style: "fence" }, { id: "bad", points: [[1, 1]], style: "wall" } as never] } });
    expect(svg).toContain('<polyline points="20,450 600,450" fill="none" stroke="#203b42"');
    expect(svg).toContain("stroke-dasharray");
    expect(svg.match(/<polyline/g)).toHaveLength(1);
  });
});
