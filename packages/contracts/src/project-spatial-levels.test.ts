import { describe, expect, it } from "vitest";
import { spatialLevelOf, spatialLevelReference, spatialLevels, spatialRoomTitle, type ProjectSpatialReference } from "./project-spatial.js";

const reference = {
  schemaVersion: 1, projectId: "site", provenance: { file: "plan", status: "drawn" },
  layout: {
    viewBox: [0, 0, 1000, 600], levels: [{ id: "g", name: " Ground " }, { id: "l2", name: "Level 2" }],
    zones: [{ id: "A", referenceBoard: "DB1", rect: [0, 0, 400, 400] }, { id: "B", referenceBoard: "DB2", rect: [0, 0, 400, 400], level: "l2" }],
    rooms: [{ name: "Store", zone: "A", rect: [10, 10, 100, 100] }, { name: "Store (2)", displayName: "Store", zone: "B", rect: [10, 10, 100, 100], level: "l2" }],
    devices: [{ meterId: "m1", position: [20, 20] }, { meterId: "m2", position: [20, 20], level: "l2" }],
    entrance: { label: "Gate", position: [200, 590] }, boardMarkers: { DB1: [5, 5], DB2: [5, 5] },
  },
} as unknown as ProjectSpatialReference;

describe("floors in a stored layout", () => {
  it("reads well-formed floors and refuses anything malformed", () => {
    expect(spatialLevels(reference.layout)).toEqual([{ id: "g", name: "Ground" }, { id: "l2", name: "Level 2" }]);
    for (const levels of [undefined, [], "x", [{ id: "g" }], [{ id: "a b", name: "A" }], [{ id: "a", name: "A" }, { id: "a", name: "B" }], [{ id: "a", name: "   " }], Array.from({ length: 51 }, (_, index) => ({ id: `l${index}`, name: "x" }))]) expect(spatialLevels({ levels })).toBeNull();
  });
  it("puts an item naming no floor, or an unknown one, on the first", () => {
    const levels = spatialLevels(reference.layout)!;
    expect(spatialLevelOf({}, levels)).toBe("g");
    expect(spatialLevelOf({ level: "nowhere" }, levels)).toBe("g");
    expect(spatialLevelOf({ level: "l2" }, levels)).toBe("l2");
  });
  it("gives each floor only its own items, and leaves a one-floor layout as it is", () => {
    const second = spatialLevelReference(reference, "l2").layout as unknown as Record<string, unknown>;
    expect((second.zones as Array<{ id: string }>).map(zone => zone.id)).toEqual(["B"]);
    expect((second.devices as Array<{ meterId: string }>).map(device => device.meterId)).toEqual(["m2"]);
    expect(second.entrance).toBeUndefined();
    expect(second.boardMarkers).toEqual({ DB2: [5, 5] });
    const plain = { ...reference, layout: { ...reference.layout, levels: undefined } } as unknown as ProjectSpatialReference;
    expect(spatialLevelReference(plain, "l2")).toBe(plain);
  });
  it("shows a room's short name when it has a usable one", () => {
    expect(spatialRoomTitle({ name: "Store (2)", displayName: "Store" })).toBe("Store");
    expect(spatialRoomTitle({ name: "Store (2)", displayName: 3 })).toBe("Store (2)");
    expect(spatialRoomTitle({ name: "Store (2)", displayName: "  " })).toBe("Store (2)");
  });
});
