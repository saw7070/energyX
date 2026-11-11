import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readProjectSpatialReference } from "@datafoundry/contracts";
import { copyItems, everything, inBox, lockItems, moveItems, pasteClip, removeItems, reorderItems, ridersOf, uniqueLabel, uniqueRoomName } from "./floor-plan-arrange";
import { clampDelta } from "./floor-plan-geometry";
import { notesWithReference, planFromReference, referenceFromPlan, type FloorPlan, type Selection, type StoredSpatialReference } from "./floor-plan-model";

type Rect = [number, number, number, number];
const copyOf = (name: string) => `${name} copy`;
/** Two blocks side by side; 264F has a lobby with LED equipment, a store, and carried report data. */
const stored = {
  schemaVersion: 1, projectId: "sktc", provenance: { file: "Drawn in EnergyX", status: "Edited in Facility → Floor layout" },
  layout: {
    viewBox: [0, 0, 1200, 700],
    zones: [
      { id: "Block 264E", referenceBoard: "DB-E", rect: [20, 20, 500, 600] },
      { id: "Block 264F", referenceBoard: "DB-F", rect: [560, 20, 500, 600], meterLocations: ["264F"], directionFromEntrance: "right", futureKey: { keep: true } },
      { id: "LED", referenceBoard: "DB-L", rect: [592, 210, 196, 40], independentSpace: false, physicalParentRoom: "Lobby", equipment: "Lift lobby LED" },
    ],
    rooms: [
      { name: "Store", zone: "Block 264E", rect: [40, 80, 200, 150] },
      { name: "Lobby", zone: "Block 264F", rect: [580, 80, 220, 180], note: "carried" },
      { name: "Store 2", zone: "Block 264F", rect: [820, 80, 200, 150] },
    ],
    entrance: { label: "Main gate", position: [540, 660] },
    devices: [{ meterId: "lobby-lights", position: [640, 150] }, { meterId: "store-fan", position: [100, 150] }],
  },
} as unknown as StoredSpatialReference;
const plan = () => planFromReference(stored);
const area = (key: string): Selection => ({ kind: "area", key }), room = (key: string): Selection => ({ kind: "room", key });
const rectOf = (p: FloorPlan, kind: "area" | "room", key: string) => (kind === "area" ? p.areas : p.rooms).find(item => item.key === key)!.rect;
const save = (p: FloorPlan) => referenceFromPlan(p, "sktc", stored);

describe("several items at once", () => {
  it("moves a selected area and its selected room together, each exactly once", () => {
    const base = plan();
    // Block 264F (with its lobby, the LED box in it, the lobby lights) and its lobby are both selected.
    const moved = moveItems(base, [area("Block 264F"), room("room-2")], -40, 20);
    expect(rectOf(moved, "area", "Block 264F")).toEqual([520, 40, 500, 600]);
    expect(rectOf(moved, "room", "room-2")).toEqual([540, 100, 220, 180]);
    expect(rectOf(moved, "area", "LED")).toEqual([552, 230, 196, 40]);
    expect(moved.devices.find(item => item.meterId === "lobby-lights")!.position).toEqual([600, 170]);
    // Block 264E and its store stay where they are.
    expect(rectOf(moved, "room", "room-1")).toEqual([40, 80, 200, 150]);
  });

  it("stops the whole group together at the edge of the plan, keeping their spacing", () => {
    const base = plan();
    const moved = moveItems(base, [room("room-1"), room("room-3")], -500, 0, ridersOf(base, []));
    expect(rectOf(moved, "room", "room-1")[0]).toBe(0);
    expect(rectOf(moved, "room", "room-3")[0]).toBe(780);
    expect(clampDelta([[10, 10, 10, 10]], [-50, 5], [0, 0, 100, 100])).toEqual([-10, 5]);
  });

  it("selects with a box only what lies fully inside it", () => {
    const base = plan();
    const found = inBox(base, [560, 60, 480, 220] as Rect);
    expect(found).toEqual([room("room-2"), room("room-3"), area("LED"), { kind: "device", key: "lobby-lights" }]);
    // Select all takes everything drawn, but only devices the editor shows.
    expect(everything(base, id => id === "store-fan").filter(item => item.kind === "device")).toEqual([{ kind: "device", key: "store-fan" }]);
  });

  it("deletes the selected items that are not locked", () => {
    const base = lockItems(plan(), [room("room-3")], true);
    const after = removeItems(base, [room("room-1"), room("room-3")]);
    expect(after.rooms.map(item => item.name)).toEqual(["Lobby", "Store 2"]);
  });
});

describe("duplicate, copy and paste", () => {
  it("duplicates an area with its rooms and equipment, but never its devices or carried report data", () => {
    const base = plan();
    const clip = copyItems(base, [area("Block 264F")])!;
    expect(clip.rooms.map(item => item.name)).toEqual(["Lobby", "Store 2"]);
    expect(clip.areas.map(item => item.label)).toEqual(["Block 264F", "LED"]);
    const { plan: next, selection } = pasteClip(base, clip, 10, copyOf);
    expect(next.devices).toBe(base.devices);
    const copy = next.areas.find(item => item.label === "Block 264F copy")!;
    expect(copy).toMatchObject({ rect: [570, 30, 500, 600], board: "DB-F" });
    // Meter locations and report-only keys described the original only.
    expect(copy.meterLocations).toBeUndefined(); expect(copy.extra).toBeUndefined(); expect(copy.saved).toBeUndefined();
    const rooms = next.rooms.slice(3);
    expect(rooms.map(item => item.name)).toEqual(["Lobby 2", "Store 3"]);
    expect(rooms.every(item => item.area === copy.key && /^rm-[a-z0-9]{8}$/.test(item.id ?? "") && !item.extra)).toBe(true);
    expect(new Set(next.rooms.map(item => item.id).filter(Boolean)).size).toBe(2);
    // The LED box goes into the copied lobby, under a label of its own.
    const led = next.areas.find(item => item.label === "LED copy")!;
    expect(led.insideRoom).toBe(rooms[0]!.key);
    expect(selection).toEqual([area(copy.key)]);
    // The original is untouched and the copy saves as a valid layout with every name unique.
    expect(next.areas.slice(0, 3)).toEqual(base.areas);
    const saved = save(next);
    expect(saved.layout.rooms.map(item => item.name)).toEqual(["Store", "Lobby", "Store 2", "Lobby 2", "Store 3"]);
    expect(saved.layout.zones.find(item => item.id === "Block 264F copy")).toEqual({ id: "Block 264F copy", referenceBoard: "DB-F", rect: [570, 30, 500, 600] });
    expect(saved.layout.zones.find(item => item.id === "Block 264F")).toMatchObject({ meterLocations: ["264F"], directionFromEntrance: "right", futureKey: { keep: true } });
    expect(readProjectSpatialReference(notesWithReference("", null, saved), "sktc")).not.toBeNull();
  });

  it("gives copies names no other item uses, in the reader's language", () => {
    const taken = new Set(["Block 264F", "Block 264F copy", "A", "B"]);
    expect(uniqueLabel("Block 264F", taken, copyOf)).toBe("Block 264F copy 2");
    expect(uniqueLabel("Block 264F copy", taken, copyOf)).toBe("Block 264F copy 2");
    expect(uniqueLabel("A", taken, copyOf)).toBe("C");
    expect(uniqueLabel("楼栋", new Set(["楼栋"]), name => `${name} 副本`)).toBe("楼栋 副本");
    expect(uniqueLabel("x".repeat(40), new Set(), copyOf)).toHaveLength(40);
    expect(uniqueRoomName("Store", new Set(["Store", "Store 2"]))).toBe("Store 3");
    expect(uniqueRoomName("Room 3", new Set(["Room 3"]))).toBe("Room 4");
    expect(uniqueRoomName("y".repeat(60), new Set())).toHaveLength(60);
  });

  it("pastes one grid step on, kept inside the plan, and copies a room alone into the same area", () => {
    const base = plan();
    const clip = copyItems(base, [room("room-3")])!;
    const once = pasteClip(base, clip, 10, copyOf);
    expect(once.plan.rooms[3]).toMatchObject({ name: "Store 3", rect: [830, 90, 200, 150], area: "Block 264F" });
    // Far enough to leave the plan: the copy stops at the edge.
    const far = pasteClip(base, clip, 400, copyOf);
    expect(far.plan.rooms[3]!.rect).toEqual([1000, 480, 200, 150]);
    // Devices and the entrance alone cannot be copied.
    expect(copyItems(base, [{ kind: "device", key: "lobby-lights" }, { kind: "entrance", key: "entrance" }])).toBeNull();
    // Copies start unlocked, and equipment whose room is gone becomes its own area.
    const locked = lockItems(base, [area("LED")], true);
    const ledClip = copyItems(locked, [area("LED")])!;
    expect(pasteClip(locked, ledClip, 10, copyOf).plan.areas[3]!.locked).toBeUndefined();
    const roomless = { ...locked, rooms: locked.rooms.filter(item => item.key !== "room-2") };
    expect(pasteClip(roomless, ledClip, 10, copyOf).plan.areas[3]!.insideRoom).toBeUndefined();
  });
});

describe("lock and drawing order", () => {
  it("keeps a locked item from moving or being deleted, and saves the lock", () => {
    const base = plan();
    const locked = lockItems(base, [room("room-1"), { kind: "device", key: "store-fan" }, area("Block 264E")], true);
    expect(lockItems(locked, [room("room-1")], true)).toBe(locked);
    expect(moveItems(locked, [room("room-1")], 30, 0)).toBe(locked);
    expect(removeItems(locked, [room("room-1"), area("Block 264E")])).toBe(locked);
    // A locked room still rides along with an unlocked area it sits in.
    const unlockedArea = lockItems(locked, [area("Block 264E")], false);
    expect(rectOf(moveItems(unlockedArea, [area("Block 264E")], 20, 0), "room", "room-1")[0]).toBe(60);
    const saved = save(locked);
    expect(saved.layout.rooms[0]).toEqual({ name: "Store", zone: "Block 264E", rect: [40, 80, 200, 150], locked: true });
    expect(saved.layout.zones[0]).toEqual({ id: "Block 264E", referenceBoard: "DB-E", rect: [20, 20, 500, 600], locked: true });
    expect((saved.layout as { devices: unknown[] }).devices[1]).toEqual({ meterId: "store-fan", position: [100, 150], locked: true });
    const reopened = planFromReference(saved);
    expect([reopened.rooms[0]!.locked, reopened.areas[0]!.locked, reopened.devices[1]!.locked]).toEqual([true, true, true]);
    expect(save(lockItems(reopened, [room("room-1"), area("Block 264E"), { kind: "device", key: "store-fan" }], false))).toEqual(save(base));
  });

  it("treats saved locks and room ids as untrusted: only values it understands are used, the rest ride along unchanged", () => {
    const odd = { ...stored, layout: { ...stored.layout, rooms: [{ ...stored.layout.rooms[0]!, id: "<script>", locked: "yes" }, { ...stored.layout.rooms[1]!, id: "rm-lobby" }, stored.layout.rooms[2]!] } } as StoredSpatialReference;
    const read = planFromReference(odd);
    expect(read.rooms[0]!.id).toBeUndefined(); expect(read.rooms[0]!.locked).toBeUndefined();
    expect(read.rooms[1]!.id).toBe("rm-lobby");
    expect(moveItems(read, [room("room-1")], 10, 0)).not.toBe(read);
    expect(referenceFromPlan(read, "sktc", odd).layout.rooms.slice(0, 2)).toEqual([{ name: "Store", zone: "Block 264E", rect: [40, 80, 200, 150], id: "<script>", locked: "yes" }, { name: "Lobby", zone: "Block 264F", rect: [580, 80, 220, 180], note: "carried", id: "rm-lobby" }]);
  });

  it("brings items to the front or sends them to the back within their own kind, and saves that order", () => {
    const base = plan();
    const front = reorderItems(base, [room("room-1")], "front");
    expect(front.rooms.map(item => item.name)).toEqual(["Lobby", "Store 2", "Store"]);
    expect(reorderItems(front, [room("room-1")], "front")).toBe(front);
    expect(reorderItems(base, [room("room-1")], "back")).toBe(base);
    // Areas only change places with areas: equipment keeps its own order.
    const areas = reorderItems(base, [area("Block 264E")], "front");
    expect(areas.areas.map(item => item.key)).toEqual(["Block 264F", "Block 264E", "LED"]);
    expect(reorderItems(base, [area("LED")], "front")).toBe(base);
    const devices = reorderItems(base, [{ kind: "device", key: "store-fan" }], "back");
    expect(devices.devices.map(item => item.meterId)).toEqual(["store-fan", "lobby-lights"]);
    const saved = save(reorderItems(areas, [room("room-1")], "front"));
    expect(saved.layout.zones.map(item => item.id)).toEqual(["Block 264F", "Block 264E", "LED"]);
    expect(saved.layout.rooms.map(item => item.name)).toEqual(["Lobby", "Store 2", "Store"]);
    expect(planFromReference(saved).rooms.map(item => item.name)).toEqual(["Lobby", "Store 2", "Store"]);
  });
});

it("gives every new mark on the editor canvas a dark-mode colour", () => {
  const css = readFileSync(new URL("./floor-plan-editor.module.css", import.meta.url), "utf8");
  for (const name of ["marquee", "drawBox", "lockBadge", "notice", "tool[aria-pressed=\"true\"]"]) expect(css).toContain(`[data-energyiq-theme="dark"])) .${name}`);
});
