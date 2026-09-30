import { describe, expect, it } from "vitest";
import { readProjectSpatialReference } from "@datafoundry/contracts";
import { autoPlace, clampRect, deviceRect, roomFor, moveSelection, notesWithReference, planFromReference, referenceFromPlan, removeSelection, resizeRect, starterPlan, type FloorPlan, type StoredSpatialReference } from "./floor-plan-model";

const stored: StoredSpatialReference = {
  schemaVersion: 1, projectId: "office", provenance: { file: "Office plan.pdf", status: "Reference-derived" },
  property: { address: "1 Example Road" },
  layout: {
    viewBox: [0, 0, 1000, 640],
    zones: [
      { id: "A", referenceBoard: "DB1", rect: [520, 20, 460, 500] },
      { id: "B", referenceBoard: "DB2", rect: [20, 20, 460, 500] },
      { id: "C", referenceBoard: "DB3", independentSpace: false, physicalParentRoom: "Showroom", equipment: "LED panels" },
    ],
    rooms: [{ name: "Open office", zone: "A", rect: [540, 80, 200, 300] }, { name: "Showroom", zone: "B", rect: [40, 80, 260, 200] }],
    entrance: { label: "Main entrance gate", position: [500, 580] },
  },
};

describe("planFromReference", () => {
  it("reads areas, rooms, the entrance and places an equipment group inside its room", () => {
    const plan = planFromReference(stored);
    expect(plan.areas.map(area => [area.label, area.board, area.insideRoom ?? null])).toEqual([["A", "DB1", null], ["B", "DB2", null], ["C", "DB3", "room-2"]]);
    const group = plan.areas[2]!.rect;
    expect(group[0]).toBeGreaterThan(40); expect(group[1] + group[3]).toBeLessThan(280);
    expect(plan.entrance).toEqual({ label: "Main entrance gate", position: [500, 580] });
    expect(plan.devices).toEqual([]);
  });
});

describe("editing", () => {
  const plan = planFromReference(stored);
  it("moves the rooms, groups and devices inside an area with it, and stops at the plan edge", () => {
    const withDevice: FloorPlan = { ...plan, devices: [{ meterId: "led-1", position: [100, 250] }, { meterId: "desk", position: [600, 300] }] };
    const moved = moveSelection(withDevice, { kind: "area", key: "B" }, 30, -500);
    expect(moved.areas.find(area => area.key === "B")!.rect).toEqual([50, 0, 460, 500]);
    expect(moved.rooms.find(room => room.name === "Showroom")!.rect).toEqual([70, 60, 260, 200]);
    expect(moved.areas.find(area => area.key === "C")!.rect[0]).toBeCloseTo(plan.areas[2]!.rect[0] + 30);
    expect(moved.devices).toEqual([{ meterId: "led-1", position: [130, 230] }, { meterId: "desk", position: [600, 300] }]);
  });
  it("resizes from a corner without shrinking below the minimum or leaving the plan", () => {
    expect(resizeRect([100, 100, 200, 100], "se", 50, 20, [0, 0, 1000, 640])).toEqual([100, 100, 250, 120]);
    expect(resizeRect([100, 100, 200, 100], "nw", 500, 0, [0, 0, 1000, 640])).toEqual([280, 100, 20, 100]);
    expect(resizeRect([100, 100, 200, 100], "nw", -200, -200, [0, 0, 1000, 640])).toEqual([0, 0, 300, 200]);
    expect(clampRect([990, 630, 50, 50], [0, 0, 1000, 640])).toEqual([950, 590, 50, 50]);
  });
  it("turns an equipment group back into a normal area when its room is deleted", () => {
    const next = removeSelection(plan, { kind: "room", key: "room-2" });
    expect(next.rooms.map(room => room.name)).toEqual(["Open office"]);
    expect(next.areas.find(area => area.key === "C")!.insideRoom).toBeUndefined();
  });
  it("places waiting devices in the room their name mentions, in their board's equipment group, or in free space", () => {
    const next = autoPlace(plan, [{ id: "desk", name: "Open Office Power", board: "DB1" }, { id: "total", name: "DB1 L1 Light", board: "DB1" }, { id: "led", name: "LED Display 1", board: "DB3" }, { id: "lost", name: "Mystery", board: "DB9" }]);
    const at = new Map(next.devices.map(item => [item.meterId, item.position]));
    expect([...at.keys()].sort()).toEqual(["desk", "led", "total"]);
    const inside = (id: string, [x, y, w, h]: number[]) => { const [px, py] = at.get(id)!; return px >= x && px <= x + w && py >= y && py <= y + h; };
    expect(inside("desk", [540, 80, 200, 300])).toBe(true);
    expect(inside("led", plan.areas[2]!.rect)).toBe(true);
    expect(at.get("total")![1]).toBeGreaterThan(380);
  });
  it("matches a device to the most specific room name", () => {
    const rooms = [{ key: "a", name: "Meeting Room 2", rect: [0, 0, 50, 50] as [number, number, number, number] }, { key: "b", name: "Small meeting room 2", rect: [0, 0, 50, 50] as [number, number, number, number] }, { key: "c", name: "Showroom", rect: [0, 0, 50, 50] as [number, number, number, number] }];
    expect(roomFor("TV Meeting Room 2", rooms)?.key).toBe("a");
    expect(roomFor("Showroom TV 1", rooms)?.key).toBe("c");
    expect(roomFor("Fridge and Water Dispenser", rooms)).toBeUndefined();
  });
  it("starts a new plan with one area and one room per board", () => {
    const fresh = starterPlan(["DB1", "DB2"]);
    expect(fresh.areas.map(area => [area.label, area.board])).toEqual([["A", "DB1"], ["B", "DB2"]]);
    expect(fresh.rooms).toHaveLength(2);
  });
});

describe("saving", () => {
  it("writes a block the shared reader accepts, keeping the source file, property and device positions", () => {
    const plan: FloorPlan = { ...planFromReference(stored), devices: [{ meterId: "led-1", position: [100.4, 250.6] }] };
    const reference = referenceFromPlan(plan, "office", stored);
    const notes = notesWithReference("Office context.\n\n```json\n{}\n```", null, reference);
    const read = readProjectSpatialReference(notes, "office")!;
    expect(read.reference.provenance).toEqual({ file: "Office plan.pdf", status: "Edited in Facility → Floor layout" });
    expect((read.reference as StoredSpatialReference).property).toEqual({ address: "1 Example Road" });
    expect((read.reference as StoredSpatialReference).layout.devices).toEqual([{ meterId: "led-1", position: [100, 251] }]);
    expect(read.reference.layout.zones.find(zone => zone.id === "C")).toMatchObject({ independentSpace: false, physicalParentRoom: "Showroom", equipment: "LED panels" });
    expect(notes.startsWith("Office context.")).toBe(true);
  });
  it("keeps a device drawn as a named box, with its size, and reads it back", () => {
    const plan: FloorPlan = { ...planFromReference(stored), devices: [{ meterId: "led-1", position: [150, 150], size: [140.4, 40.6] }, { meterId: "tv", position: [600, 300] }] };
    const reference = referenceFromPlan(plan, "office", stored);
    expect(reference.layout.devices).toEqual([{ meterId: "led-1", position: [150, 150], size: [140, 41] }, { meterId: "tv", position: [600, 300] }]);
    const read = planFromReference(reference);
    expect(read.devices[0]).toEqual({ meterId: "led-1", position: [150, 150], size: [140, 41] });
    expect(deviceRect(read.devices[0]!)).toEqual([80, 129.5, 140, 41]);
    expect(deviceRect(read.devices[1]!)).toBeNull();
    // A size too small to see is ignored and the device shows as a dot.
    expect(planFromReference({ ...reference, layout: { ...reference.layout, devices: [{ meterId: "led-1", position: [150, 150], size: [2, 2] }] } }).devices[0]).toEqual({ meterId: "led-1", position: [150, 150] });
  });
  it("replaces the old block instead of adding a second one", () => {
    const block = "```json\n" + JSON.stringify(stored) + "\n```";
    const notes = notesWithReference(`Intro\n\n${block}\n\nMore notes`, block, referenceFromPlan(planFromReference(stored), "office", stored));
    expect(notes.match(/```json/g)).toHaveLength(1);
    expect(notes).toContain("More notes");
  });
  it("explains in plain words what must be fixed", () => {
    const plan = planFromReference(stored);
    expect(() => referenceFromPlan({ ...plan, rooms: [...plan.rooms, { key: "x", name: "Showroom", rect: [600, 400, 100, 60] }] }, "office", stored)).toThrow('Two rooms are called "Showroom". Give each room its own name.');
    expect(() => referenceFromPlan({ ...plan, rooms: [...plan.rooms, { key: "x", name: "Store", rect: [485, 560, 30, 30] }] }, "office", stored)).toThrow('"Store" is outside every area. Drag it into an area.');
    expect(() => referenceFromPlan({ ...plan, areas: plan.areas.map(area => area.key === "A" ? { ...area, label: "B" } : area) }, "office", stored)).toThrow('Two areas are labelled "B". Give each area its own label.');
    expect(() => referenceFromPlan({ ...plan, rooms: [] }, "office", stored)).toThrow("Add at least one room.");
  });
  it("explains the fixes, and names new rooms and entrances, in the reader's language", () => {
    const plan = planFromReference(stored);
    const twoShowrooms: FloorPlan = { ...plan, rooms: [...plan.rooms, { key: "x", name: "Showroom", rect: [600, 400, 100, 60] }] };
    expect(() => referenceFromPlan(twoShowrooms, "office", stored, "zh-Hans")).toThrow("有两个房间都叫“Showroom”。请给每个房间取不同的名称。");
    expect(() => referenceFromPlan(twoShowrooms, "office", stored, "ms")).toThrow('Dua bilik bernama "Showroom". Berikan setiap bilik nama tersendiri.');
    expect(() => referenceFromPlan({ ...plan, rooms: [] }, "office", stored, "zh-Hans")).toThrow("请至少添加一个房间。");
    expect(starterPlan(["DB1"], "zh-Hans").rooms.map(room => room.name)).toEqual(["房间 1"]);
    expect(starterPlan(["DB1"], "ms").rooms.map(room => room.name)).toEqual(["Bilik 1"]);
    const unnamed = { ...stored, layout: { ...stored.layout, entrance: { position: [500, 580] as [number, number] } } };
    expect(planFromReference(unnamed, "ms").entrance?.label).toBe("Pintu masuk");
    // What is stored for the advisor and the map stays the same whatever the reader's language.
    expect(referenceFromPlan(plan, "office", stored, "zh-Hans")).toEqual(referenceFromPlan(plan, "office", stored));
  });
});

describe("pinLabel", () => {
  it("drops the room name from a device inside that room", async () => {
    const { pinLabel } = await import("./site-floor-map");
    const rooms = [{ name: "Showroom", rect: [0, 0, 100, 100] }, { name: "Director room", rect: [200, 0, 100, 100] }, { name: "Meeting Room 2", rect: [400, 0, 100, 100] }];
    expect(pinLabel("Showroom TV 1", [50, 50], rooms)).toBe("TV 1");
    expect(pinLabel("Director Room Blind", [250, 50], rooms)).toBe("Blind");
    expect(pinLabel("TV Meeting Room 2", [450, 50], rooms)).toBe("TV");
    expect(pinLabel("Showroom TV 1", [150, 50], rooms)).toBe("Showroom TV 1");
    expect(pinLabel("Fridge and Water Dispenser Unit", [650, 50], rooms)).toBe("Fridge and Water …");
  });
});

describe("pinLabel inside an equipment box", () => {
  it("drops words the box description already gives", async () => {
    const { pinLabel } = await import("./site-floor-map");
    expect(pinLabel("LED Display 1", [50, 50], [{ name: "Showroom", rect: [0, 0, 200, 200] }], [{ rect: [20, 20, 100, 60], equipment: "Three large LED panels" }])).toBe("Display 1");
  });
});
