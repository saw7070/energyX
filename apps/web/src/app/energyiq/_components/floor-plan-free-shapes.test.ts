/**
 * Free shapes in the floor layout (slice 4): L-, U- and T-shaped areas and rooms, shapes drawn corner by corner, corner
 * editing, and plain shapes (a lawn, a driveway). Geometry, saving and loading, and who owns what inside a shape.
 */
import { describe, expect, it } from "vitest";
import { insideSpatial, polygonOf, readProjectSpatialReference, renderProjectSpatialSvg, selfIntersects, spatialShapes } from "@datafoundry/contracts";
import { autoPlace, moveSelection, notesWithReference, passengers, planFromReference, referenceFromPlan, roomOwner, type FloorPlan, type Point, type StoredSpatialReference } from "./floor-plan-model";
import { addCorner, asRectangle, cornersOf, holds, insideBox, lockAngle, middleOf, moveCorner, outlineFromSaved, presetOutline, removeCorner, savedShape, shapeProblem, SHAPE_PRESETS, withPreset, type Outlined } from "./floor-plan-polygon";
import { setRect } from "./floor-plan-align";
import { newShape, shapesFromLayout } from "./floor-plan-plain-shapes";

/** An SKTC-like layout saved before free shapes: 5 zones, 14 rooms, 19 devices, an entrance, and keys the editor only carries. */
function sktc(): StoredSpatialReference {
  const zones = ["A", "B", "C", "D", "E"].map((id, index) => ({ id, referenceBoard: `DB${index + 1}`, rect: [20 + index * 196, 20, 180, 560], colour: index === 2 ? "#3366cc" : undefined, directionFromEntrance: index < 2 ? "left" : "right" })).map(zone => JSON.parse(JSON.stringify(zone)));
  const rooms = Array.from({ length: 14 }, (_, index) => { const zone = zones[index % 5]!, row = Math.floor(index / 5); return { name: `Room ${index + 1}`, zone: zone.id, rect: [zone.rect[0] + 10, 60 + row * 170, 160, 150], ...(index === 3 ? { id: "room-4", locked: true } : {}) }; });
  const devices = Array.from({ length: 19 }, (_, index) => ({ meterId: `m${index + 1}`, position: [rooms[index % 14]!.rect[0] + 20 + (index >= 14 ? 40 : 0), rooms[index % 14]!.rect[1] + 30], ...(index === 5 ? { size: [60, 20] } : {}) }));
  return { schemaVersion: 1, projectId: "sktc", provenance: { file: "Drawn in EnergyX", status: "Edited in Facility → Floor layout" },
    layout: { viewBox: [0, 0, 1000, 640], zones, rooms, devices, entrance: { label: "Main gate", position: [500, 600], referenceBoard: "DB1" }, boardMarkers: { DB1: [40, 40] }, style: "blueprint" } } as unknown as StoredSpatialReference;
}
const L: Point[] = [[100, 100], [300, 100], [300, 200], [200, 200], [200, 400], [100, 400]];
/** One L-shaped area (DB1) with a room in its arm and a room in its notch, which a box area beside it (DB2) holds. */
function lPlan(): StoredSpatialReference {
  return { schemaVersion: 1, projectId: "p", provenance: { file: "f", status: "Edited in Facility → Floor layout" }, layout: {
    viewBox: [0, 0, 600, 500],
    zones: [{ id: "A", referenceBoard: "DB1", rect: [100, 100, 200, 300], points: L }, { id: "B", referenceBoard: "DB2", rect: [210, 210, 120, 180] }],
    rooms: [{ name: "Arm", zone: "A", rect: [110, 250, 60, 60] }, { name: "Notch", zone: "B", rect: [230, 260, 60, 60] }],
    devices: [{ meterId: "arm", position: [140, 380] }, { meterId: "notch", position: [280, 380] }],
  } } as unknown as StoredSpatialReference;
}

describe("shape geometry", () => {
  it("gives presets that are valid shapes, inside their box, that hold their middle part and not their notch", () => {
    for (const preset of SHAPE_PRESETS) {
      const item: Outlined = withPreset<Outlined>({ rect: [0, 0, 200, 100] }, preset);
      if (preset === "rect") { expect(item.outline).toBeUndefined(); continue; }
      const corners = cornersOf(item)!;
      expect(shapeProblem(corners)).toBeNull();
      expect(corners.every(([x, y]) => x >= 0 && x <= 200 && y >= 0 && y <= 100)).toBe(true);
      expect(holds(item, middleOf(item))).toBe(true);
    }
    const l = withPreset({ rect: [0, 0, 100, 100] as [number, number, number, number] }, "L");
    expect(holds(l, [20, 80])).toBe(true); expect(holds(l, [80, 20])).toBe(false);
    const u = withPreset({ rect: [0, 0, 100, 100] as [number, number, number, number] }, "U");
    expect(holds(u, [50, 20])).toBe(false); expect(holds(u, [50, 80])).toBe(true);
    const t = withPreset({ rect: [0, 0, 100, 100] as [number, number, number, number] }, "T");
    expect(holds(t, [10, 80])).toBe(false); expect(holds(t, [50, 80])).toBe(true);
  });

  it("refuses shapes that cross themselves, are flat or have too few corners", () => {
    expect(shapeProblem([[0, 0], [100, 100], [100, 0], [0, 100]])).toBe("crossing");
    expect(shapeProblem([[0, 0], [50, 0], [100, 0]])).toBe("crossing");
    expect(shapeProblem([[0, 0], [100, 0]])).toBe("few");
    expect(shapeProblem([[0, 0], [5, 0], [5, 5]])).toBe("small");
    expect(selfIntersects(L)).toBe(false);
  });

  it("moves, adds and removes corners, keeping the box around the shape, and refuses a crossing move", () => {
    const item = { rect: [100, 100, 200, 300] as [number, number, number, number], outline: outlineFromSaved(L, [100, 100, 200, 300])! };
    const moved = moveCorner(item, 0, [80, 90])!;
    expect(moved.rect).toEqual([80, 90, 220, 310]); expect(cornersOf(moved)![0]).toEqual([80, 90]);
    expect(moveCorner(item, 4, [250, 50])).toBeNull();
    const added = addCorner(item, 0, [200, 100])!;
    expect(cornersOf(added)!).toHaveLength(7);
    const removed = removeCorner(added, 1)!;
    expect(cornersOf(removed)!.map(([x, y]) => [Math.round(x), Math.round(y)])).toEqual(L);
    expect(removeCorner(withPreset({ rect: [0, 0, 100, 100] as [number, number, number, number] }, "rect"), 0)).toBeNull();
    // Shift locks a side across, down or at 45 degrees.
    const across = lockAngle([0, 0], [100, 8]); expect(across[1]).toBeCloseTo(0); expect(across[0]).toBeCloseTo(Math.hypot(100, 8));
    const diagonal = lockAngle([0, 0], [100, 90]); expect(Math.abs(diagonal[0] - diagonal[1])).toBeLessThan(1e-6);
    expect(asRectangle(item).outline).toBeUndefined();
  });

  it("stretches a shape with its box and puts labels in its largest part", () => {
    const item = { rect: [100, 100, 200, 300] as [number, number, number, number], outline: outlineFromSaved(L, [100, 100, 200, 300])! };
    const stretched = { ...item, rect: [100, 100, 400, 300] as [number, number, number, number] };
    expect(cornersOf(stretched)![1]).toEqual([500, 100]);
    const [x, y, w, h] = insideBox(item);
    expect(x).toBe(100); expect(w * h).toBeGreaterThanOrEqual(100 * 300);
    expect(holds(item, [x + w / 2, y + h / 2])).toBe(true);
  });

  it("ignores malformed saved points", () => {
    const rect: [number, number, number, number] = [100, 100, 200, 300];
    for (const bad of [null, "L", [[100, 100], [300, 100]], [[100, 100], [300, "x"], [100, 400]], [[100, 100], [900, 100], [100, 400]], [[100, 100], [300, 400], [300, 100], [100, 400]], Array.from({ length: 101 }, (_, i) => [100 + i, 100 + (i % 2) * 300])])
      expect(outlineFromSaved(bad, rect)).toBeNull();
    expect(polygonOf([[0, 0], [NaN, 1], [1, 1]], [0, 0, 5, 5])).toBeNull();
    expect(insideSpatial({ rect, points: "bad" }, [290, 110])).toBe(true);
    expect(insideSpatial({ rect, points: L }, [290, 390])).toBe(false);
  });
});

describe("saving and loading free shapes", () => {
  it("re-saves a layout from before free shapes byte for byte", () => {
    const stored = sktc();
    const notes = notesWithReference("Site notes.", null, stored);
    const loaded = readProjectSpatialReference(notes, "sktc")!;
    const saved = referenceFromPlan(planFromReference(loaded.reference as StoredSpatialReference), "sktc", loaded.reference as StoredSpatialReference);
    expect(JSON.stringify(saved)).toBe(JSON.stringify(loaded.reference));
    expect(notesWithReference("Site notes.", loaded.block, saved)).toBe(notes);
    expect(JSON.stringify(saved)).not.toContain("points"); expect(JSON.stringify(saved)).not.toContain("shapes");
  });

  it("keeps an L-shaped area's points, writes its box as the box around them, and passes the stored format check", () => {
    const stored = lPlan(), plan = planFromReference(stored);
    expect(plan.areas[0]!.outline).toBeDefined();
    expect(JSON.stringify(referenceFromPlan(plan, "p", stored))).toBe(JSON.stringify(stored));
    const moved = moveSelection(plan, { kind: "area", key: plan.areas[0]!.key }, 10, 0);
    const saved = referenceFromPlan(moved, "p", stored), zone = saved.layout.zones[0] as { rect: number[]; points: number[][] };
    expect(zone.points[0]).toEqual([110, 100]); expect(zone.rect).toEqual([110, 100, 200, 300]);
    const scaled = setRect(plan, { kind: "area", key: plan.areas[0]!.key }, [100, 100, 100, 300]);
    const zone2 = referenceFromPlan(scaled, "p", stored).layout.zones[0] as { rect: number[]; points: number[][] };
    expect(zone2.points[1]).toEqual([200, 100]); expect(zone2.rect).toEqual([100, 100, 100, 300]);
    expect(readProjectSpatialReference(notesWithReference("", null, saved), "p")).not.toBeNull();
  });

  it("tightens a hand-edited box to its shape without moving the shape, and keeps malformed points as saved", () => {
    const stored = lPlan();
    (stored.layout.zones[0] as { rect: number[] }).rect = [90, 90, 220, 320];
    const tightened = referenceFromPlan(planFromReference(stored), "p", stored).layout.zones[0] as { rect: number[]; points: number[][] };
    expect(tightened.rect).toEqual([100, 100, 200, 300]); expect(tightened.points).toEqual(L);
    const bad = lPlan();
    (bad.layout.rooms[0] as { points?: unknown }).points = [[110, 250], [999, 999], [110, 310]];
    const plan = planFromReference(bad);
    expect(plan.rooms[0]!.outline).toBeUndefined();
    expect(JSON.stringify(referenceFromPlan(plan, "p", bad))).toBe(JSON.stringify(bad));
  });

  it("lets an L-shaped area own the rooms and devices in its arms, never those in its notch", () => {
    const plan = planFromReference(lPlan());
    const [arm, notch] = plan.rooms;
    expect(roomOwner(plan, arm!)?.label).toBe("A"); expect(roomOwner(plan, notch!)?.label).toBe("B");
    const riders = passengers(plan, { kind: "area", key: plan.areas[0]!.key });
    expect([...riders.rooms]).toEqual([arm!.key]); expect([...riders.devices]).toEqual(["arm"]);
    // Auto-place puts a meter in the largest part of the shape, never the notch.
    const placed = autoPlace({ ...planFromReference(lPlan()), rooms: [planFromReference(lPlan()).rooms[1]!], devices: [] } as FloorPlan, [{ id: "x", name: "Lights", board: "DB1" }]);
    expect(holds(placed.areas[0]!, placed.devices[0]!.position)).toBe(true);
  });

  it("saves rounded points and refuses to save a shape folded flat by rounding", () => {
    expect(savedShape({ rect: [0, 0, 100, 100], outline: presetOutline("L")! })!.points).toEqual([[0, 0], [45, 0], [45, 55], [100, 55], [100, 100], [0, 100]]);
    expect(savedShape({ rect: [0, 0, 100, 100] })).toBeNull();
  });
});

describe("plain shapes", () => {
  const withShapes = (shapes: unknown[]) => { const stored = lPlan(); (stored.layout as { shapes?: unknown }).shapes = shapes; return stored; };
  const lawn = { id: "lawn", kind: "polygon", rect: [20, 20, 60, 60], points: [[20, 20], [80, 20], [20, 80]], fill: "#88cc88", stroke: "dashed", label: "Lawn" };

  it("round-trips plain shapes and keeps entries it cannot draw where they were", () => {
    const stored = withShapes([lawn, { id: "pond", kind: "ellipse", rect: [400, 20, 80, 50] }, { kind: "star", id: "s" }, { id: "x", kind: "rect", rect: [0, 0, 10, 10], fill: "red", extra: 1 }, { id: "far", kind: "rect", rect: [590, 0, 50, 50] }]);
    const plan = planFromReference(stored);
    expect(plan.shapes!.map(shape => shape.kind)).toEqual(["polygon", "ellipse", "rect"]);
    expect(plan.shapes![2]!.fill).toBeUndefined();
    expect(JSON.stringify(referenceFromPlan(plan, "p", stored))).toBe(JSON.stringify(stored));
  });

  it("never owns rooms or devices and never rides along with an area", () => {
    const stored = withShapes([{ id: "drive", kind: "rect", rect: [100, 100, 400, 350] }]);
    const plan = planFromReference(stored);
    expect(roomOwner(plan, plan.rooms[0]!)?.label).toBe("A");
    const riders = passengers(plan, { kind: "shape", key: "drive" });
    expect(riders.rooms.size + riders.devices.size + riders.areas.size).toBe(0);
    const moved = moveSelection(plan, { kind: "area", key: plan.areas[0]!.key }, 10, 0);
    expect(moved.shapes![0]!.rect).toEqual([100, 100, 400, 350]);
    const shifted = moveSelection(plan, { kind: "shape", key: "drive" }, 10, 0);
    expect(shifted.rooms).toEqual(plan.rooms); expect(shifted.devices).toEqual(plan.devices);
  });

  it("checks saved values: kinds, #rrggbb fills, outline styles, captions and polygon points", () => {
    const shapes = spatialShapes({ shapes: [lawn, { ...lawn, id: "b", fill: "url(#x)", stroke: "wavy", label: "x".repeat(81) }, { ...lawn, id: "c", points: [[0, 0]] }, { id: "d", kind: "triangle", rect: [0, 0, 5, 5] }, "junk"] });
    expect(shapes.map(shape => shape.id)).toEqual(["lawn", "b", "c"]);
    expect(shapes[1]).toEqual({ id: "b", kind: "polygon", rect: [20, 20, 60, 60], points: [[20, 20], [80, 20], [20, 80]] });
    expect(shapes[2]!.points).toBeUndefined();
    expect(shapesFromLayout("nope", [0, 0, 100, 100])).toBeNull();
    const fresh = newShape([], "ellipse", [0, 0, 5, 5]);
    expect(fresh.rect).toEqual([0, 0, 20, 20]); expect(fresh.fill).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("draws polygons and plain shapes in the offline SVG, and boxes where points are malformed", () => {
    const stored = withShapes([lawn, { id: "pond", kind: "ellipse", rect: [400, 20, 80, 50], label: "<b>Pond</b>" }]);
    (stored.layout.rooms[1] as { points?: unknown }).points = "broken";
    const svg = renderProjectSpatialSvg(stored);
    expect(svg).toContain(`<polygon points="100,100 300,100 300,200 200,200 200,400 100,400"`);
    expect(svg).toContain("<ellipse"); expect(svg).toContain("Lawn"); expect(svg).toContain("&lt;b&gt;Pond");
    expect(svg).toContain(`<rect x="230" y="260" width="60" height="60"`);
  });
});
