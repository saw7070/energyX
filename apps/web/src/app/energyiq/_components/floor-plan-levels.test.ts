import { describe, expect, it } from "vitest";
import { readProjectSpatialReference, spatialLevelReference, spatialLevels } from "@datafoundry/contracts";
import { commitPlan, showLevel, startHistory, undo } from "./floor-plan-history";
import { sharedHidden, withSharedHidden, layerOf, layerInUse, PLAN_LAYERS } from "./floor-plan-layers";
import { addLevel, deleteLevel, duplicateLevel, levelContents, levelOf, levelView, mergeView, moveLevel, nextAreaLabel, renameLevel, renameRoom, settleLevel, suffixed } from "./floor-plan-levels";
import { insertTemplate, repeatItems } from "./floor-plan-templates";
import { translatorFor } from "./energyiq-messages";
import { floorPlanMessages } from "./floor-plan-messages";
import { notesWithReference, planFromReference, referenceFromPlan, type FloorPlan, type StoredSpatialReference } from "./floor-plan-model";

type Rect = [number, number, number, number];
const names = (number: number) => `Floor ${number}`;
const copyName = (name: string) => `${name} copy`;
const en = translatorFor(floorPlanMessages, "en");
const messageText = (key: string, values?: Record<string, number>) => en(key as Parameters<typeof en>[0], values);
/**
 * A layout saved before floors existed, shaped like SKTC: five areas (one of them equipment in a room), fourteen rooms,
 * nineteen devices, an entrance, and report data the editor carries.
 */
const blocks = ["264E", "264F", "265A", "Carpark"];
const rooms = blocks.flatMap((block, b) => Array.from({ length: block === "Carpark" ? 2 : 4 }, (_, index) => ({ name: `${block} room ${index + 1}`, zone: `Block ${block}`, rect: [40 + b * 300 + (index % 2) * 130, 80 + Math.floor(index / 2) * 160, 120, 140] as Rect })));
const SKTC = {
  schemaVersion: 1, projectId: "sktc", provenance: { file: "Drawn in EnergyX", status: "Edited in Facility → Floor layout" },
  layout: {
    viewBox: [0, 0, 1300, 700], style: "blueprint",
    zones: [
      ...blocks.map((block, b) => ({ id: `Block ${block}`, referenceBoard: `DB-${block}`, rect: [20 + b * 300, 20, 280, 560], ...(b === 1 ? { meterLocations: ["264F"], directionFromEntrance: "right" } : {}) })),
      { id: "LED", referenceBoard: "DB-L", independentSpace: false, physicalParentRoom: "264E room 1", equipment: "Lift lobby LED" },
    ],
    rooms: [...rooms.slice(0, 13), { ...rooms[13]!, colour: "#3366aa" }],
    entrance: { label: "Main gate", position: [600, 660], referenceBoard: "DB-264E" },
    devices: Array.from({ length: 19 }, (_, index) => ({ meterId: `m${index + 1}`, position: [60 + (index % 9) * 130, 120 + Math.floor(index / 9) * 160] })),
    boardMarkers: { "DB-264E": [30, 30] },
  },
} as unknown as StoredSpatialReference;
const save = (plan: FloorPlan, previous: StoredSpatialReference = SKTC) => referenceFromPlan(plan, "sktc", previous);
/** A small two-block site, with floors added by the editor. */
const SMALL = {
  schemaVersion: 1, projectId: "sktc", provenance: { file: "plan", status: "Edited in Facility → Floor layout" },
  layout: {
    viewBox: [0, 0, 1000, 640],
    zones: [{ id: "A", referenceBoard: "DB1", rect: [20, 20, 460, 560] }],
    rooms: [{ name: "Store", zone: "A", rect: [40, 80, 200, 150] }, { name: "Lobby", zone: "A", rect: [260, 80, 200, 150] }],
    devices: [{ meterId: "fan", position: [100, 150] }],
    entrance: { label: "Gate", position: [240, 600] },
  },
} as unknown as StoredSpatialReference;
const small = () => planFromReference(SMALL);
const twoFloors = () => addLevel(small(), names)!.plan;

describe("a layout saved before floors existed", () => {
  it("loads, saves and loads again exactly as saved (SKTC-like: 5 areas, 14 rooms, 19 devices, an entrance)", () => {
    const plan = planFromReference(SKTC);
    expect(plan.levels).toBeUndefined();
    expect([plan.areas.length, plan.rooms.length, plan.devices.length, !!plan.entrance]).toEqual([5, 14, 19, true]);
    // The editor works on the plan itself: the one floor's view is the plan, and putting it back changes nothing.
    expect(levelView(plan, "")).toBe(plan);
    expect(mergeView(plan, "", plan)).toBe(plan);
    const saved = save(plan);
    expect(JSON.stringify(saved)).toBe(JSON.stringify(SKTC));
    expect(JSON.stringify(save(planFromReference(saved), saved))).toBe(JSON.stringify(SKTC));
    expect(notesWithReference("", null, saved)).toBe(notesWithReference("", null, SKTC));
  });
  it("comes back byte-identical after a floor is added and deleted again", () => {
    const plan = planFromReference(SKTC);
    const added = addLevel(plan, names)!;
    const back = deleteLevel(added.plan, added.level, null);
    expect(back.levels).toBeUndefined();
    expect(JSON.stringify(save(back))).toBe(JSON.stringify(SKTC));
  });
});

describe("floors", () => {
  it("adds a floor: the plan's items stay on the first, which names none, and the floors are saved", () => {
    const { plan, level } = addLevel(small(), names)!;
    expect(plan.levels).toEqual([{ id: "level-1", name: "Floor 1" }, { id: "level-2", name: "Floor 2" }]);
    expect(level).toBe("level-2");
    const saved = save(plan, SMALL);
    expect((saved.layout as unknown as { levels: unknown }).levels).toEqual([{ id: "level-1", name: "Floor 1" }, { id: "level-2", name: "Floor 2" }]);
    expect(saved.layout.rooms.every(room => !("level" in room))).toBe(true);
    expect(levelView(plan, level).rooms).toEqual([]);
    expect(levelView(plan, "level-1").rooms.map(room => room.name)).toEqual(["Store", "Lobby"]);
  });
  it("keeps what is drawn on a floor on that floor, and a room belongs to an area on its own floor only", () => {
    const plan = twoFloors();
    const view = levelView(plan, "level-2");
    // A room drawn on floor 2 right over floor 1's area A is not in it.
    const withRoom = mergeView(plan, "level-2", { ...view, rooms: [{ key: "room-x", name: "Plant", rect: [60, 300, 120, 100] }] });
    expect(withRoom.rooms.find(room => room.key === "room-x")?.level).toBe("level-2");
    expect(() => save(settleLevel(withRoom, "level-2"), SMALL)).toThrow(/Plant/);
    // With its own area on floor 2 it saves, naming its floor.
    const area = mergeView(withRoom, "level-2", { ...levelView(withRoom, "level-2"), areas: [{ key: "area-2", label: "B", board: "", rect: [20, 260, 400, 300] }] });
    const saved = save(settleLevel(area, "level-2"), SMALL);
    expect(saved.layout.rooms.find(room => room.name === "Plant")).toEqual({ name: "Plant", zone: "B", rect: [60, 300, 120, 100], level: "level-2" });
    expect(saved.layout.zones.find(zone => zone.id === "B")).toMatchObject({ level: "level-2" });
    // Loading it again reads the same floors.
    const again = planFromReference(saved);
    expect(levelOf(again, again.rooms.find(room => room.name === "Plant"))).toBe("level-2");
    expect(levelView(again, "level-1").rooms.map(room => room.name)).toEqual(["Store", "Lobby"]);
    expect(JSON.stringify(save(again, saved))).toBe(JSON.stringify(saved));
  });
  it("renames and reorders floors without moving anything or renaming any room", () => {
    const plan = duplicateLevel(twoFloors(), "level-1", copyName, copyName)!.plan;
    const renamed = renameLevel(plan, "level-1", "Ground floor");
    expect(renamed.levels![0]!.name).toBe("Ground floor");
    expect(renamed.rooms.map(room => room.name)).toEqual(plan.rooms.map(room => room.name));
    // Moving the first floor later spells out each item's floor, so nothing changes floor.
    const moved = moveLevel(renamed, "level-1", 1);
    expect(moved.levels!.map(level => level.id)).toEqual(["level-3", "level-1", "level-2"]);
    for (const room of plan.rooms) expect(levelOf(moved, moved.rooms.find(item => item.key === room.key))).toBe(levelOf(plan, room));
    // The new first floor's items name none again.
    expect(moved.rooms.filter(room => levelOf(moved, room) === moved.levels![0]!.id).every(room => room.level === undefined)).toBe(true);
    expect(moveLevel(moved, moved.levels![0]!.id, -1)).toBe(moved);
  });
  it("duplicates a floor with its areas and rooms but not its devices, suffixing a clashing room name once", () => {
    const { plan, level } = duplicateLevel(twoFloors(), "level-1", copyName, copyName)!;
    expect(plan.levels!.map(item => item.name)).toEqual(["Floor 1", "Floor 1 copy", "Floor 2"]);
    const copy = levelView(plan, level);
    expect(copy.devices).toEqual([]);
    expect(copy.entrance).toBeNull();
    expect(copy.rooms.map(room => [room.name, room.displayName])).toEqual([["Store (2)", "Store"], ["Lobby (2)", "Lobby"]]);
    expect(copy.areas).toHaveLength(1);
    expect(copy.areas[0]!.label).not.toBe("A");
    const saved = save(plan, SMALL);
    expect(saved.layout.rooms.filter(room => room.level === level)).toEqual([
      expect.objectContaining({ name: "Store (2)", displayName: "Store", level }), expect.objectContaining({ name: "Lobby (2)", displayName: "Lobby", level }),
    ]);
    // The suffix is frozen: renaming the floor (or the floor copied) changes no room name.
    const renamed = renameLevel(renameLevel(plan, level, "Level 2"), "level-1", "Ground");
    expect(save(renamed, SMALL).layout.rooms.map(room => room.name)).toEqual(saved.layout.rooms.map(room => room.name));
    expect(levelContents(plan, "level-1")).toEqual({ areas: 1, rooms: 2, devices: 1, entrance: true, others: 0 });
  });
  it("keeps room names unique across floors when renaming, and still refuses two rooms with one name on one floor", () => {
    const { plan, level } = duplicateLevel(twoFloors(), "level-1", copyName, copyName)!;
    const view = levelView(plan, level), store = view.rooms[0]!;
    // Typing the same short name again keeps the suffix chosen once.
    const same = renameRoom(view, store.key, "Store");
    expect(same.rooms[0]).toMatchObject({ name: "Store (2)", displayName: "Store" });
    // A name no other floor has needs no suffix.
    expect(renameRoom(view, store.key, "Plant").rooms[0]).toMatchObject({ name: "Plant" });
    expect(renameRoom(view, store.key, "Plant").rooms[0]!.displayName).toBeUndefined();
    // Two rooms named alike on one floor: saving says so.
    const clash = mergeView(plan, level, { ...view, rooms: view.rooms.map(room => ({ ...room, name: "Twin", displayName: undefined })) as FloorPlan["rooms"] });
    expect(() => save(clash, SMALL)).toThrow(/Twin/);
    expect(suffixed("Store", new Set(["Store (2)"]))).toBe("Store (3)");
  });
  it("deletes a floor only as asked: moving its items to another floor, or deleting them and freeing its devices", () => {
    const base = twoFloors();
    const moved = mergeView(base, "level-2", { ...levelView(base, "level-2"), areas: [{ key: "area-2", label: "B", board: "", rect: [500, 20, 400, 400] }], rooms: [{ key: "room-x", name: "Plant", rect: [520, 60, 100, 100] }], devices: [{ meterId: "pump", position: [560, 100] }] });
    const settled = settleLevel(moved, "level-2");
    const kept = deleteLevel(settled, "level-2", "level-1");
    expect(kept.levels).toBeUndefined();
    expect(kept.rooms.map(room => room.name)).toEqual(["Store", "Lobby", "Plant"]);
    expect(kept.devices.map(device => device.meterId)).toEqual(["fan", "pump"]);
    expect(kept.rooms.every(room => room.level === undefined)).toBe(true);
    const gone = deleteLevel(settled, "level-2", null);
    expect(gone.rooms.map(room => room.name)).toEqual(["Store", "Lobby"]);
    expect(gone.devices.map(device => device.meterId)).toEqual(["fan"]);
    expect(deleteLevel(settled, "level-2", "level-2")).toBe(settled);
    expect(JSON.stringify(save(gone, SMALL))).toBe(JSON.stringify(SMALL));
  });
  it("refuses a rename that makes two rooms on one floor show the same name", () => {
    const { plan, level } = duplicateLevel(twoFloors(), "level-1", copyName, copyName)!;
    const view = levelView(plan, level), lobby = view.rooms.find(room => room.displayName === "Lobby")!;
    // "Store" is free nowhere: another floor has it, and this floor shows it ("Store (2)"). It is stored as typed, so saving says so.
    const renamed = renameRoom(view, lobby.key, "Store");
    expect(renamed.rooms.find(room => room.key === lobby.key)).toMatchObject({ name: "Store" });
    expect(renamed.rooms.find(room => room.key === lobby.key)!.displayName).toBeUndefined();
    expect(() => save(mergeView(plan, level, renamed), SMALL)).toThrow(/Store/);
    // A short name that only hides a clash is refused on save too.
    const hiding = mergeView(plan, level, { ...view, rooms: view.rooms.map(room => room.key === lobby.key ? { ...room, name: "Lobby (2)", displayName: "Store" } : room) });
    expect(() => save(hiding, SMALL)).toThrow(/Store/);
  });
  it("shows the stored names again when a deleted floor's rooms move onto a floor that shows the same names", () => {
    const { plan, level } = duplicateLevel(twoFloors(), "level-1", copyName, copyName)!;
    const merged = deleteLevel(plan, level, "level-1");
    expect(merged.rooms.map(room => [room.name, room.displayName])).toEqual([["Store", undefined], ["Lobby", undefined], ["Store (2)", undefined], ["Lobby (2)", undefined]]);
    const saved = save(merged, SMALL);
    expect(saved.layout.rooms.map(room => room.name)).toEqual(["Store", "Lobby", "Store (2)", "Lobby (2)"]);
  });
  it("never gives a new floor an id that items still name from saved data, so nothing moves floor after saving", () => {
    // No floors, but rooms naming "level-2" (an old floor removed by hand or by the advisor).
    const stale = { ...SMALL, layout: { ...SMALL.layout, rooms: SMALL.layout.rooms.map(room => ({ ...room, level: "level-2" })) } } as unknown as StoredSpatialReference;
    const added = addLevel(planFromReference(stale), names)!;
    expect(added.plan.levels!.map(item => item.id)).not.toContain("level-2");
    const reloaded = planFromReference(save(added.plan, stale));
    expect(reloaded.rooms.every(room => levelOf(reloaded, room) === reloaded.levels![0]!.id)).toBe(true);
    // A floor list the editor cannot read (a blank name): its ids are not reused either.
    const malformed = { ...stale, layout: { ...stale.layout, levels: [{ id: "level-1", name: "" }, { id: "level-2", name: "Upstairs" }] } } as unknown as StoredSpatialReference;
    const plan = planFromReference(malformed);
    expect(plan.levels).toBeUndefined();
    const fresh = addLevel(plan, names)!;
    expect(fresh.plan.levels!.map(item => item.id).some(id => id === "level-1" || id === "level-2")).toBe(false);
    const again = planFromReference(save(fresh.plan, malformed));
    expect(again.rooms.every(room => levelOf(again, room) === again.levels![0]!.id)).toBe(true);
    // An existing list with a floor removed: Add floor skips the id rooms still name.
    const removed = { ...SMALL, layout: { ...SMALL.layout, levels: [{ id: "level-1", name: "Ground" }, { id: "level-2", name: "Roof" }], rooms: [{ ...SMALL.layout.rooms[0]!, level: "level-3" }, SMALL.layout.rooms[1]] } } as unknown as StoredSpatialReference;
    const third = addLevel(planFromReference(removed), names)!;
    expect(third.level).not.toBe("level-3");
    const back = planFromReference(save(third.plan, removed));
    expect(levelOf(back, back.rooms[0]!)).toBe("level-1");
  });
  it("saves floor names exactly as read, and a blank one as the usual name", () => {
    const spaced = { ...SMALL, layout: { ...SMALL.layout, levels: [{ id: "g", name: "Ground " }, { id: "l2", name: " Level 2" }] } } as unknown as StoredSpatialReference;
    expect(JSON.stringify(save(planFromReference(spaced), spaced))).toBe(JSON.stringify(spaced));
    const blank = renameLevel(twoFloors(), "level-2", "  ");
    expect((save(blank, SMALL).layout as unknown as { levels: Array<{ name: string }> }).levels.map(item => item.name)).toEqual(["Floor 1", "Floor 2"]);
  });
  it("never gives two floors the same new area label once every letter is used", () => {
    const letters = Array.from({ length: 25 }, (_, index) => String.fromCharCode(66 + index));
    let plan = addLevel(twoFloors(), names)!.plan;
    plan = { ...plan, areas: [...plan.areas, ...letters.map((label, index) => ({ key: `area-${label}`, label, board: "", rect: [600, 20 + index * 20, 10, 10] as Rect }))] };
    const area = (n: number) => `Area ${n}`;
    for (const level of ["level-2", "level-3"]) {
      const view = levelView(plan, level), label = nextAreaLabel(view, [], area);
      plan = mergeView(plan, level, { ...view, areas: [...view.areas, { key: `new-${level}`, label, board: "", rect: [20, 20, 200, 200] }] });
    }
    const added = plan.areas.filter(item => item.key.startsWith("new-")).map(item => item.label);
    expect(added).toEqual(["Area 1", "Area 2"]);
    expect(() => save(plan, SMALL)).not.toThrow();
    expect(nextAreaLabel(levelView(plan, "level-2"), ["Area 3"], area)).toBe("Area 4");
  });
  it("puts a device placed on one floor there only (each meter is on the plan once)", () => {
    const plan = twoFloors();
    const next = mergeView(plan, "level-2", { ...levelView(plan, "level-2"), devices: [{ meterId: "fan", position: [300, 300] }] });
    expect(next.devices).toEqual([{ meterId: "fan", position: [300, 300], level: "level-2" }]);
  });
  it("goes back to the floor where a change was made on Undo", () => {
    const plan = twoFloors();
    let history = showLevel(startHistory(plan), "level-2");
    const next = mergeView(plan, "level-2", { ...levelView(plan, "level-2"), areas: [{ key: "area-2", label: "B", board: "", rect: [500, 20, 400, 400] }] });
    history = showLevel(commitPlan(history, next), "level-1");
    expect(undo(history).present).toMatchObject({ plan, level: "level-2" });
  });
  it("treats malformed floors in saved data as one floor, keeping them as saved", () => {
    const odd = { ...SMALL, layout: { ...SMALL.layout, levels: [{ id: "bad id!", name: "x" }], rooms: SMALL.layout.rooms.map(room => ({ ...room, level: "nowhere" })) } } as unknown as StoredSpatialReference;
    expect(spatialLevels(odd.layout)).toBeNull();
    const plan = planFromReference(odd);
    expect(plan.levels).toBeUndefined();
    expect(JSON.stringify(save(plan, odd))).toBe(JSON.stringify(odd));
    // A known list of floors, with an item naming a floor that is not there: read on the first floor, kept as saved.
    const stray = { ...SMALL, layout: { ...SMALL.layout, levels: [{ id: "g", name: "Ground" }, { id: "l1", name: "Level 1" }], rooms: [{ ...SMALL.layout.rooms[0]!, level: 42 }, SMALL.layout.rooms[1]] } } as unknown as StoredSpatialReference;
    const read = planFromReference(stray);
    expect(levelView(read, "g").rooms).toHaveLength(2);
    expect(JSON.stringify(save(read, stray))).toBe(JSON.stringify(stray));
    expect(spatialLevels({ levels: [{ id: "a", name: "A" }, { id: "a", name: "B" }] })).toBeNull();
    expect(spatialLevels({ levels: [{ id: "a", name: "<b>".repeat(100) }] })).toBeNull();
  });
  it("gives each floor its own view of the stored layout for readers (map, report)", () => {
    const { plan, level } = duplicateLevel(twoFloors(), "level-1", copyName, copyName)!;
    const saved = { ...save(plan, SMALL), layout: { ...save(plan, SMALL).layout, boardMarkers: { DB1: [30, 30] } } } as StoredSpatialReference;
    const first = spatialLevelReference(saved, "level-1"), copy = spatialLevelReference(saved, level);
    expect(first.layout.rooms.map(room => room.name)).toEqual(["Store", "Lobby"]);
    expect(copy.layout.rooms.map(room => room.name)).toEqual(["Store (2)", "Lobby (2)"]);
    expect((copy.layout as unknown as { devices: unknown[] }).devices).toEqual([]);
    expect((copy.layout as unknown as { entrance?: unknown }).entrance).toBeUndefined();
    expect((first.layout as unknown as { boardMarkers: unknown }).boardMarkers).toEqual({ DB1: [30, 30] });
    expect((copy.layout as unknown as { boardMarkers: unknown }).boardMarkers).toEqual({});
    expect(spatialLevelReference(SKTC, "x")).toBe(SKTC);
  });
});

describe("layers", () => {
  it("saves which layers the shared map hides, reads only known ones, and drops the block when nothing is hidden", () => {
    const plan = small();
    const hidden = withSharedHidden(withSharedHidden(plan, "devices", true), "rooms", true);
    expect(sharedHidden(hidden.layers)).toEqual(new Set(["devices", "rooms"]));
    const saved = save(hidden, SMALL);
    expect((saved.layout as unknown as { layers: unknown }).layers).toEqual({ hidden: ["devices", "rooms"] });
    expect(sharedHidden({ hidden: ["devices", "<script>", 3, null] })).toEqual(new Set(["devices"]));
    expect(sharedHidden("nonsense")).toEqual(new Set());
    const shown = withSharedHidden(withSharedHidden(hidden, "devices", false), "rooms", false);
    expect(shown.layers).toBeUndefined();
    expect(JSON.stringify(save(shown, SMALL))).toBe(JSON.stringify(SMALL));
    // Entries a later version knows stay as saved.
    expect(withSharedHidden({ ...plan, layers: { hidden: ["future"], other: 1 } }, "areas", true).layers).toEqual({ hidden: ["future", "areas"], other: 1 });
  });
  it("lists the core layers always and a later kind's layer once the plan has some", () => {
    const plan = small();
    expect(PLAN_LAYERS.filter(layer => layerInUse(plan, layer)).map(layer => layer.key)).toEqual(["areas", "rooms", "equipment", "devices", "symbols"]);
    expect(layerInUse({ ...plan, labels: [{}] } as unknown as FloorPlan, PLAN_LAYERS.find(layer => layer.key === "labels")!)).toBe(true);
    expect(layerOf(plan, { kind: "room", key: "room-1" })).toBe("rooms");
    expect(layerOf(plan, { kind: "area", key: "A" })).toBe("areas");
    expect(layerOf(planFromReference(SKTC), { kind: "area", key: "LED" })).toBe("equipment");
  });
});

describe("repeat and templates", () => {
  it("repeats a room three times across with a gap, with unique names, as one change", () => {
    const plan = small();
    const result = repeatItems(plan, [{ kind: "room", key: "room-1" }], 3, "across", 10, copyName);
    if ("failure" in result) throw new Error(result.failure);
    const added = result.plan.rooms.slice(2);
    expect(added.map(room => room.rect[0])).toEqual([250, 460, 670]);
    expect(new Set(result.plan.rooms.map(room => room.name)).size).toBe(5);
    expect(result.plan.devices).toEqual(plan.devices);
    expect(result.selection).toHaveLength(4);
    expect(repeatItems(plan, [], 3, "down", 10, copyName)).toEqual({ failure: "nothing" });
    // Down a block: the plan grows to hold the copies.
    const down = repeatItems(plan, [{ kind: "area", key: "A" }], 2, "down", 20, copyName);
    if ("failure" in down) throw new Error(down.failure);
    expect(down.plan.areas.map(item => item.rect[1])).toEqual([20, 600, 1180]);
    expect(down.plan.viewBox[3]).toBeGreaterThanOrEqual(1740);
    expect(down.plan.rooms).toHaveLength(6);
    expect(() => save(down.plan, SMALL)).not.toThrow();
    expect(repeatItems(plan, [{ kind: "area", key: "A" }], 20, "down", 1000, copyName)).toEqual({ failure: "noSpace" });
  });
  it("keeps repeated names unique against rooms on other floors", () => {
    const plan = twoFloors(), view = levelView(plan, "level-1");
    const result = repeatItems(view, [{ kind: "room", key: "room-1" }], 1, "down", 10, copyName);
    if ("failure" in result) throw new Error(result.failure);
    const next = mergeView(plan, "level-1", result.plan);
    expect(new Set(next.rooms.map(room => room.name)).size).toBe(next.rooms.length);
  });
  for (const kind of ["row", "hdb", "office"] as const) it(`inserts a valid, saveable ${kind} template`, () => {
    const result = insertTemplate(small(), kind, 5, messageText, "B");
    if ("failure" in result) throw new Error(result.failure);
    const saved = save(result.plan, SMALL);
    const added = saved.layout.rooms.filter(room => room.zone === "B");
    expect(added.length).toBe(kind === "row" ? 5 : kind === "hdb" ? 5 : 4);
    if (kind === "hdb") expect(added.map(room => room.name)).toEqual(["Corridor (left)", "Lift lobby", "Corridor (right)", "Decorative lighting", "Emergency lighting"]);
    if (kind === "office") expect(added.map(room => room.name)).toEqual(["Open office", "Reception", "Meeting room", "Pantry"]);
    expect(readProjectSpatialReference(notesWithReference("", null, saved), "sktc")).not.toBeNull();
    // Inserting it again keeps every name unique.
    const again = insertTemplate(result.plan, kind, 5, messageText, "C");
    if ("failure" in again) throw new Error(again.failure);
    expect(new Set(again.plan.rooms.map(room => room.name)).size).toBe(again.plan.rooms.length);
  });
});
