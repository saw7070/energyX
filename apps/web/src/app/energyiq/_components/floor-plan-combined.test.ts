/**
 * Where the floor layout's features meet: floors and layers over labels, landmarks, doors, walls and shapes; copy,
 * paste, lock, front/back and the keyboard order across every kind; doors on free-shape rooms; and saving losslessly.
 */
import { describe, expect, it } from "vitest";
import { drawnOpeningRoom, readProjectSpatialReference, spatialLevelReference } from "@datafoundry/contracts";
import { copyItems, everything, isLocked, lockItems, pasteClip, reorderItems } from "./floor-plan-arrange";
import { layerOf } from "./floor-plan-layers";
import { duplicateLevel, levelView, mergeView } from "./floor-plan-levels";
import { notesWithReference, planFromReference, referenceFromPlan, type FloorPlan, type Selection, type StoredSpatialReference } from "./floor-plan-model";
import { addOpening } from "./floor-plan-openings";

const copyName = (name: string) => `${name} copy`;
const read = (reference: StoredSpatialReference) => readProjectSpatialReference(notesWithReference("", null, reference), "p")!.reference as StoredSpatialReference;
const save = (plan: FloorPlan, previous: StoredSpatialReference) => referenceFromPlan(plan, "p", previous);

/** Two floors: a hall on the ground floor, an office upstairs, and drawing items on both (a floor named mid-entry too). */
const TWO_FLOORS = {
  schemaVersion: 1, projectId: "p", provenance: { file: "plan", status: "Edited in Facility → Floor layout" },
  layout: {
    viewBox: [0, 0, 1000, 640],
    zones: [{ id: "A", referenceBoard: "DB-A", rect: [20, 20, 460, 560] }, { id: "B", referenceBoard: "DB-B", rect: [20, 20, 460, 560], level: "l2" }],
    rooms: [{ name: "Hall", zone: "A", rect: [40, 60, 200, 160], id: "rm-hall" }, { name: "Office", zone: "B", rect: [40, 60, 200, 160], id: "rm-office", level: "l2" }],
    entrance: { label: "Main gate", position: [300, 600] },
    devices: [{ meterId: "m1", position: [100, 100] }, { meterId: "m2", position: [120, 120], level: "l2" }],
    labels: [{ id: "lb-ground", text: "Lobby", position: [300, 300] }, { id: "lb-up", level: "l2", text: "Upstairs", position: [300, 300] }],
    symbols: [{ kind: "entrance", label: "Main gate", position: [300, 600] }, { id: "sy-lift", kind: "lift", position: [400, 400], level: "l2" }],
    openings: [{ id: "d-hall", room: "rm-hall", wall: "s", offset: 0.5, width: 30, kind: "door" }, { id: "d-office", room: "rm-office", wall: "n", offset: 0.5, width: 30, kind: "door" }],
    lines: [{ id: "ln-1", level: "l2", points: [[500, 100], [700, 100]], style: "wall" }, { id: "ln-2", points: [[500, 200], [700, 200]], style: "fence", level: "l2" }],
    shapes: [{ id: "lawn", kind: "rect", rect: [600, 400, 100, 80], fill: "#77bb77", level: "l2" }],
    levels: [{ id: "g", name: "Ground" }, { id: "l2", name: "Level 2" }],
  },
} as unknown as StoredSpatialReference;

const keysOf = (list: Array<{ key: string }> | undefined) => (list ?? []).map(item => item.key);

describe("floors over labels, landmarks, doors, walls and shapes", () => {
  const saved = read(TWO_FLOORS), plan = planFromReference(saved);

  it("reads each item's floor and saves a two-floor layout exactly as it was", () => {
    expect(plan.labels?.map(item => item.level)).toEqual([undefined, "l2"]);
    expect(plan.symbols?.map(item => item.level)).toEqual(["l2"]);
    expect(plan.lines?.map(item => item.level)).toEqual(["l2", "l2"]);
    expect(plan.shapes?.[0]?.level).toBe("l2");
    expect(JSON.stringify(save(plan, saved))).toBe(JSON.stringify(saved));
  });

  it("shows each floor only its own drawing items, and doors with their rooms", () => {
    const up = levelView(plan, "l2"), ground = levelView(plan, "g");
    expect(keysOf(up.labels)).toEqual(["label-2"]);
    expect(keysOf(up.symbols)).toEqual(["symbol-2"]);
    expect(keysOf(up.lines)).toEqual(["ln-1", "ln-2"]);
    expect(keysOf(up.shapes)).toEqual(["lawn"]);
    expect(keysOf(up.openings)).toEqual(["d-office"]);
    expect(keysOf(ground.labels)).toEqual(["label-1"]);
    expect(ground.lines).toEqual([]);
    expect(keysOf(ground.openings)).toEqual(["d-hall"]);
  });

  it("puts a changed floor back without touching the other floor's items, in their saved order", () => {
    const up = levelView(plan, "l2");
    const next = mergeView(plan, "l2", { ...up, labels: up.labels!.map(item => ({ ...item, text: "Level 2 lobby" })), openings: up.openings!.map(item => ({ ...item, offset: 0.25 })) });
    expect(next.labels?.map(item => item.text)).toEqual(["Lobby", "Level 2 lobby"]);
    expect(next.openings?.map(item => [item.key, item.offset])).toEqual([["d-hall", 0.5], ["d-office", 0.25]]);
    const written = save(next, saved).layout as unknown as { labels: Array<Record<string, unknown>> };
    // The floor stays where it was saved among the label's keys.
    expect(Object.keys(written.labels[1]!)).toEqual(["id", "level", "text", "position"]);
  });

  it("copies a floor's drawing items and its rooms' doors with new keys and ids, but never its devices", () => {
    const result = duplicateLevel(plan, "l2", copyName, copyName)!;
    const next = result.plan, level = result.level;
    expect(next.devices).toHaveLength(2);
    const label = next.labels!.find(item => item.level === level)!, symbol = next.symbols!.find(item => item.level === level)!, shape = next.shapes!.find(item => item.level === level)!;
    expect(label.id).toBeUndefined();
    expect(symbol.id).toBeUndefined();
    expect(shape.id).toBe(shape.key);
    expect(new Set(next.lines!.map(item => item.key)).size).toBe(4);
    const room = next.rooms.find(item => item.level === level)!, door = next.openings!.find(item => item.room === room.key)!;
    expect(door.key).not.toBe("d-office");
    expect(next.openings).toHaveLength(3);
    // The copy saves, and reads back with every item on its floor.
    const again = planFromReference(read(save(next, saved)));
    expect(levelView(again, level).openings).toHaveLength(1);
    expect(levelView(again, level).lines).toHaveLength(2);
  });

  it("keeps the main entrance's landmark entry on the entrance's floor", () => {
    const moved = { ...plan, entrance: { ...plan.entrance!, level: "l2" } };
    const written = read(save(moved, saved));
    expect((written.layout.entrance as { level?: string }).level).toBe("l2");
    expect((written.layout as unknown as { symbols: Array<{ kind: string; level?: string }> }).symbols[0]).toMatchObject({ kind: "entrance", level: "l2" });
    const ground = spatialLevelReference(written, "g").layout as unknown as { entrance?: unknown; symbols: unknown[] };
    expect(ground.entrance).toBeUndefined();
    expect(ground.symbols).toEqual([]);
    expect(planFromReference(written).entrance?.level).toBe("l2");
  });

  it("puts every kind on its layer", () => {
    const up = levelView(plan, "l2");
    const layers = Object.fromEntries(everything(up).map(item => [item.kind, layerOf(up, item)]));
    expect(layers).toMatchObject({ label: "labels", symbol: "symbols", line: "lines", shape: "shapes", room: "rooms", device: "devices" });
    expect(layerOf(up, { kind: "opening", key: "d-office" })).toBe("lines");
  });

  it("gives readers one floor at a time, doors with their rooms", () => {
    const up = spatialLevelReference(saved, "l2").layout as unknown as Record<string, Array<{ id?: string }>>;
    expect(up.labels!.map(item => item.id)).toEqual(["lb-up"]);
    expect(up.lines!.map(item => item.id)).toEqual(["ln-1", "ln-2"]);
    expect(up.shapes!.map(item => item.id)).toEqual(["lawn"]);
    expect(up.openings!.map(item => item.id)).toEqual(["d-office"]);
    const ground = spatialLevelReference(saved, "g").layout as unknown as Record<string, Array<{ id?: string }>>;
    expect(ground.openings!.map(item => item.id)).toEqual(["d-hall"]);
    expect((ground.symbols as Array<{ kind?: string }>).map(item => item.kind)).toEqual(["entrance"]);
  });
});

describe("arranging every kind of item", () => {
  const view = levelView(planFromReference(read(TWO_FLOORS)), "l2");
  const picked: Selection[] = [{ kind: "label", key: "label-2" }, { kind: "symbol", key: "symbol-2" }, { kind: "line", key: "ln-1" }, { kind: "shape", key: "lawn" }, { kind: "room", key: "room-2" }];

  it("cycles through every kind with the keyboard, in drawing order", () => {
    expect([...new Set(everything(view).map(item => item.kind))]).toEqual(["area", "shape", "room", "line", "label", "symbol", "device"]);
  });

  it("copies and pastes labels, landmarks, lines, shapes and rooms with their doors", () => {
    const clip = copyItems(view, picked)!;
    const { plan: next, selection } = pasteClip(view, clip, 20, copyName);
    expect(selection.map(item => item.kind).sort()).toEqual(["label", "line", "room", "shape", "symbol"]);
    expect(next.labels).toHaveLength(2); expect(next.symbols).toHaveLength(2); expect(next.lines).toHaveLength(3); expect(next.shapes).toHaveLength(2);
    const room = selection.find(item => item.kind === "room")!;
    expect(next.openings!.some(item => item.room === room.key)).toBe(true);
  });

  it("locks every kind, and a door with its room", () => {
    const locked = lockItems(view, picked, true);
    expect(picked.every(item => isLocked(locked, item))).toBe(true);
    expect(isLocked(locked, { kind: "opening", key: "d-office" })).toBe(true);
  });

  it("brings lines and shapes to the front", () => {
    expect(keysOf(reorderItems(view, [{ kind: "line", key: "ln-1" }], "front").lines)).toEqual(["ln-2", "ln-1"]);
  });
});

describe("doors on free-shape rooms", () => {
  const shaped = { ...TWO_FLOORS, layout: { ...TWO_FLOORS.layout, levels: undefined, rooms: TWO_FLOORS.layout.rooms.map(room => room.name === "Hall" ? { ...room, points: [[40, 60], [240, 60], [240, 140], [140, 140], [140, 220], [40, 220]] } : room) } } as unknown as StoredSpatialReference;

  it("are refused in the editor, and kept but not drawn by readers", () => {
    const plan = planFromReference(read(shaped));
    expect(plan.rooms[0]!.outline).toBeDefined();
    expect(addOpening(plan, plan.rooms[0]!.key, "s", 0.5)).toBeNull();
    expect(addOpening(plan, plan.rooms[1]!.key, "s", 0.5)).not.toBeNull();
    // The door it had is kept on save, but the readers draw it on no room.
    expect(save(plan, read(shaped)).layout.openings).toHaveLength(2);
    const layout = read(shaped).layout;
    expect(drawnOpeningRoom(layout.rooms, layout.openings![0]!)).toBeUndefined();
    expect(drawnOpeningRoom(layout.rooms, layout.openings![1]!)?.name).toBe("Office");
  });
});
