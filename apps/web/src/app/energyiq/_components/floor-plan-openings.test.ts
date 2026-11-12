import { describe, expect, it } from "vitest";
import { readProjectSpatialReference } from "@datafoundry/contracts";
import { copyItems, everything, isLocked, lockItems, moveItems, pasteClip, removeItems } from "./floor-plan-arrange";
import { canShift, shiftPlan } from "./floor-plan-canvas";
import { addLine, insertPoint, removePoint, restyleLine, setPoint } from "./floor-plan-lines";
import { contentExtent, notesWithReference, planFromReference, referenceFromPlan, type FloorPlan, type StoredSpatialReference } from "./floor-plan-model";
import { addOpening, flipOpening, slideOpening, spanOf, updateOpening, wallAt } from "./floor-plan-openings";
import { sktcLike } from "./floor-plan-openings-fixture";

const save = (plan: FloorPlan, previous: StoredSpatialReference) => referenceFromPlan(plan, previous.projectId, previous);
const reopen = (reference: StoredSpatialReference) => planFromReference(readProjectSpatialReference(notesWithReference("", null, reference), reference.projectId)!.reference as StoredSpatialReference);
const room = (plan: FloorPlan, name: string) => plan.rooms.find(item => item.name === name)!;

describe("layouts saved before doors and walls", () => {
  it("open, save and reopen exactly as they were", () => {
    const base = sktcLike();
    const notes = notesWithReference("Site notes.", null, base);
    const found = readProjectSpatialReference(notes, "sktc")!;
    const plan = planFromReference(found.reference as StoredSpatialReference);
    expect(plan.openings).toBeUndefined();
    expect(plan.lines).toBeUndefined();
    const saved = save(plan, found.reference as StoredSpatialReference);
    expect(JSON.stringify(saved)).toBe(JSON.stringify(found.reference));
    expect(notesWithReference(notes, found.block, saved)).toBe(notes);
  });
});

describe("doors and windows", () => {
  it("adds a door to a room wall, switches the room's automatic door off, and saves both", () => {
    const base = sktcLike(), plan = planFromReference(base), store = room(plan, "264E Store");
    const added = addOpening(plan, store.key, "e", 0.5)!;
    expect(added.plan.rooms.find(item => item.key === store.key)!.autoDoor).toBe(false);
    const saved = save(added.plan, base);
    expect(saved.layout.rooms.find(item => item.name === "264E Store")).toMatchObject({ autoDoor: false });
    // The room has no id, so the door names it by name; nothing else in the layout changes.
    expect(saved.layout.openings).toEqual([{ id: "op-1", room: "264E Store", wall: "e", offset: 0.5, width: 48, kind: "door" }]);
    expect(saved.layout.rooms.filter(item => "autoDoor" in item)).toHaveLength(1);
    // A window keeps the automatic door.
    expect(addOpening(plan, store.key, "n", 0.5, "window")!.plan.rooms.find(item => item.key === store.key)!.autoDoor).toBeUndefined();
    // And it all reads back the same.
    const again = reopen(saved);
    expect(JSON.stringify(save(again, saved))).toBe(JSON.stringify(saved));
  });

  it("moves along its wall, flips, changes and is deleted", () => {
    const base = sktcLike(), plan = planFromReference(base), store = room(plan, "264E Store");
    const { plan: withDoor, key } = addOpening(plan, store.key, "s", 0.5)!;
    // Only the part of a drag along the wall counts, and it stops at the wall's end.
    const slid = slideOpening(withDoor, key, 44, 300);
    expect(slid.openings![0]!.offset).toBe(0.7);
    expect(slideOpening(withDoor, key, 9999, 0).openings![0]!.offset).toBe(0.8909);
    expect(moveItems(withDoor, [{ kind: "opening", key }], 44, 0).openings![0]!.offset).toBe(0.7);
    const flipped = flipOpening(withDoor, key);
    expect(flipped.openings![0]).toMatchObject({ hinge: "end", swing: "out" });
    expect(flipOpening(flipped, key).openings![0]).toMatchObject({ hinge: "start", swing: "in" });
    expect(updateOpening(withDoor, key, { kind: "double", width: 80.4 }).openings![0]).toMatchObject({ kind: "double", width: 80 });
    expect(updateOpening(withDoor, key, { kind: "door" })).toBe(withDoor);
    expect(removeItems(withDoor, [{ kind: "opening", key }]).openings).toEqual([]);
  });

  it("follows its room when the room is renamed, resized, moved, copied or deleted", () => {
    const base = sktcLike(), plan = planFromReference(base), store = room(plan, "264E Store");
    const { plan: withDoor, key } = addOpening(plan, store.key, "e", 0.5)!;
    // Renamed: the door names the room by its new name on save.
    const renamed = { ...withDoor, rooms: withDoor.rooms.map(item => item.key === store.key ? { ...item, name: "Bin store" } : item) };
    expect(save(renamed, base).layout.openings![0]!.room).toBe("Bin store");
    // Resized: it keeps its place along the wall and stays on it.
    const resized = { ...withDoor, rooms: withDoor.rooms.map(item => item.key === store.key ? { ...item, rect: [280, 80, 220, 40] as [number, number, number, number] } : item) };
    expect(spanOf(resized, resized.openings![0]!)).toMatchObject({ a: [500, 80], b: [500, 120], width: 40 });
    expect(save(resized, base).layout.openings![0]!.width).toBe(40);
    // Moved (with its area): it moves too.
    const moved = moveItems(withDoor, [{ kind: "room", key: store.key }], 10, 0);
    expect(spanOf(moved, moved.openings![0]!)!.a[0]).toBe(spanOf(withDoor, withDoor.openings![0]!)!.a[0] + 10);
    // Copied: the copy has its own door, tied to the copy (by the copy's id).
    const pasted = pasteClip(withDoor, copyItems(withDoor, [{ kind: "room", key: store.key }])!, 20, name => `${name} copy`);
    const copy = pasted.plan.rooms.find(item => item.key === pasted.selection[0]!.key)!;
    expect(pasted.plan.openings).toHaveLength(2);
    expect(pasted.plan.openings![1]).toMatchObject({ room: copy.key, wall: "e", offset: 0.5 });
    expect(save(pasted.plan, base).layout.openings![1]!.room).toBe(copy.id);
    // Deleted: its doors go with it.
    expect(removeItems(withDoor, [{ kind: "room", key: store.key }]).openings).toEqual([]);
    // A door whose room is gone some other way is left out on save, with no error.
    expect(save({ ...withDoor, rooms: withDoor.rooms.filter(item => item.key !== store.key), areas: withDoor.areas.filter(item => item.insideRoom !== store.key) }, base).layout.openings).toEqual([]);
  });

  it("is tied to a room by its id first, then by name, when read back", () => {
    const base = sktcLike();
    base.layout.rooms[0] = { ...base.layout.rooms[0]!, id: "rm-lobby" };
    base.layout.openings = [{ id: "op-a", room: "rm-lobby", wall: "n", offset: 0.25, width: 30, kind: "window" }, { id: "op-b", room: "264F Store", wall: "w", offset: 0.5, width: 30, kind: "double", swing: "out" }];
    const plan = reopen(base);
    expect(plan.openings!.map(item => plan.rooms.find(entry => entry.key === item.room)!.name)).toEqual(["264E Lobby", "264F Store"]);
    expect(JSON.stringify(save(plan, base).layout.openings)).toBe(JSON.stringify(base.layout.openings));
  });

  it("finds the room wall nearest a click", () => {
    const plan = planFromReference(sktcLike());
    // 264E Store is [280, 80, 220, 160]: a click just inside its right wall picks that wall.
    expect(wallAt(plan, [497, 120], 10)).toMatchObject({ room: { name: "264E Store" }, wall: "e", offset: 0.25 });
    expect(wallAt(plan, [1000, 860], 10)).toBeNull();
  });
});

describe("walls and lines", () => {
  const drawn = () => { const plan = planFromReference(sktcLike()); return addLine(plan, [[100, 800], [400, 800], [400, 800], [400, 880]])!; };
  it("draws a line through its points (repeats dropped), saves it on whole units and reads it back", () => {
    const base = sktcLike(), { plan, key } = drawn();
    expect(plan.lines![0]).toEqual({ key, points: [[100, 800], [400, 800], [400, 880]], style: "wall" });
    const saved = save(plan, base);
    expect(saved.layout.lines).toEqual([{ id: key, points: [[100, 800], [400, 800], [400, 880]], style: "wall" }]);
    expect(JSON.stringify(save(reopen(saved), saved))).toBe(JSON.stringify(saved));
    expect(addLine(plan, [[1, 1]])).toBeNull();
  });

  it("edits points, style and thickness", () => {
    const { plan, key } = drawn();
    expect(setPoint(plan, key, 1, [420, 790]).lines![0]!.points[1]).toEqual([420, 790]);
    expect(setPoint(plan, key, 1, [99999, -5]).lines![0]!.points[1]).toEqual([1600, 0]);
    expect(insertPoint(plan, key, 0, [250, 800]).lines![0]!.points).toEqual([[100, 800], [250, 800], [400, 800], [400, 880]]);
    expect(removePoint(plan, key, 1).lines![0]!.points).toEqual([[100, 800], [400, 880]]);
    expect(removePoint(removePoint(plan, key, 1), key, 0)).toEqual(removePoint(plan, key, 1));
    expect(restyleLine(plan, key, { style: "fence", thickness: "l" }).lines![0]).toMatchObject({ style: "fence", thickness: "l" });
    expect(restyleLine(plan, key, { thickness: "m" })).toBe(plan);
  });

  it("is selected, moved, copied, locked and deleted like any item", () => {
    const { plan, key } = drawn(), item = { kind: "line" as const, key };
    expect(everything(plan)).toContainEqual(item);
    expect(moveItems(plan, [item], 10, -10).lines![0]!.points[0]).toEqual([110, 790]);
    // It stops at the edge of the plan as a whole.
    expect(moveItems(plan, [item], 0, 500).lines![0]!.points).toEqual([[100, 820], [400, 820], [400, 900]]);
    const locked = lockItems(plan, [item], true);
    expect(isLocked(locked, item)).toBe(true);
    expect(moveItems(locked, [item], 10, 0)).toBe(locked);
    expect(removeItems(locked, [item])).toBe(locked);
    expect(save(locked, sktcLike()).layout.lines![0]).toMatchObject({ locked: true });
    const pasted = pasteClip(locked, copyItems(locked, [item])!, 20, name => name);
    expect(pasted.plan.lines).toHaveLength(2);
    expect(pasted.plan.lines![1]).toEqual({ key: "ln-copy-1", points: [[120, 820], [420, 820], [420, 900]], style: "wall" });
    expect(pasted.selection).toEqual([{ kind: "line", key: "ln-copy-1" }]);
    expect(removeItems(plan, [item]).lines).toEqual([]);
  });

  it("counts toward the space the plan needs, and moves when the plan grows left or up", () => {
    const plan = planFromReference(sktcLike()), far = addLine(plan, [[100, 100], [1590, 895]])!.plan;
    expect(contentExtent(far)[1]).toBeGreaterThanOrEqual(895);
    expect(canShift(far)).toBe(true);
    expect(shiftPlan(far, 10, 5).lines![0]!.points).toEqual([[110, 105], [1600, 900]]);
  });
});

describe("untrusted saved data", () => {
  it("reads only well-formed doors and lines, keeps lines inside the plan, and carries unknown keys", () => {
    const base = sktcLike() as StoredSpatialReference & { layout: Record<string, unknown> };
    base.layout.openings = [
      { id: "op-1", room: "264E Store", wall: "e", offset: 0.5, width: 40, kind: "door", note: "fire door" },
      { id: "op-2", room: "No such room", wall: "e", offset: 0.5, width: 40, kind: "door" },
      { id: "op-3", room: "264E Store", wall: "up", offset: 0.5, width: 40, kind: "door" },
      { id: "op-4", room: "264E Store", wall: "n", offset: 7, width: 40, kind: "door" },
      { id: "op-1", room: "264E Store", wall: "n", offset: 0.5, width: 40, kind: "door" },
      "<script>",
    ] as never;
    base.layout.lines = [{ id: "ln-1", points: [[10, 10], [5000, 10]], style: "road", colour: "#ff0000" }, { id: "ln-2", points: [[10, 10]], style: "wall" }, { id: "ln-3", points: [[0, 0], [1, 1]], style: "laser" }] as never;
    const plan = planFromReference(base);
    expect(plan.openings!.map(item => item.key)).toEqual(["op-1"]);
    expect(plan.openings![0]!.extra).toEqual({ note: "fire door" });
    expect(plan.lines!.map(item => [item.key, item.points])).toEqual([["ln-1", [[10, 10], [1600, 10]]]]);
    const saved = save(plan, base);
    expect(saved.layout.openings).toEqual([{ id: "op-1", room: "264E Store", wall: "e", offset: 0.5, width: 40, kind: "door", note: "fire door" }]);
    expect(saved.layout.lines).toEqual([{ id: "ln-1", points: [[10, 10], [1600, 10]], style: "road", colour: "#ff0000" }]);
  });

  it("keeps doors or lines that are not lists exactly as saved", () => {
    const base = sktcLike() as StoredSpatialReference & { layout: Record<string, unknown> };
    base.layout.openings = "doors here" as never;
    base.layout.lines = { wall: true } as never;
    const saved = save(planFromReference(base), base) as unknown as { layout: Record<string, unknown> };
    expect(saved.layout.openings).toBe("doors here");
    expect(saved.layout.lines).toEqual({ wall: true });
  });

  it("caps how many it reads", () => {
    const base = sktcLike() as StoredSpatialReference & { layout: Record<string, unknown> };
    base.layout.lines = Array.from({ length: 130 }, (_, index) => ({ id: `ln-${index}`, points: [[0, index], [10, index]], style: "partition" }));
    expect(planFromReference(base).lines).toHaveLength(100);
  });
});
