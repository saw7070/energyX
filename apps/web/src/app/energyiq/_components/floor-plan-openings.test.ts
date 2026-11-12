import { describe, expect, it } from "vitest";
import { readProjectSpatialReference } from "@datafoundry/contracts";
import { copyItems, everything, isLocked, lockItems, moveItems, pasteClip, removeItems } from "./floor-plan-arrange";
import { canShift, shiftPlan } from "./floor-plan-canvas";
import { addLine, insertPoint, MAX_LINE_POINTS, MAX_LINES, midpointAfter, removePoint, restyleLine, setPoint } from "./floor-plan-lines";
import { contentExtent, NOTES_LIMIT, notesWithReference, planFromReference, referenceFromPlan, type FloorPlan, type StoredSpatialReference } from "./floor-plan-model";
import { addOpening, flipOpening, MAX_OPENINGS, slideOpening, spanOf, updateOpening, wallAt } from "./floor-plan-openings";
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
    const storeSaved = saved.layout.rooms.find(item => item.name === "264E Store") as { id?: string };
    expect(storeSaved).toMatchObject({ autoDoor: false });
    // The room had no id, so it gets one and the door names it by that; nothing else in the layout changes.
    expect(storeSaved.id).toMatch(/^rm-[a-z0-9]{8}$/);
    expect(saved.layout.openings).toEqual([{ id: "op-1", room: storeSaved.id, wall: "e", offset: 0.5, width: 48, kind: "door" }]);
    expect(saved.layout.rooms.filter(item => "autoDoor" in item)).toHaveLength(1);
    expect(saved.layout.rooms.filter(item => "id" in item)).toHaveLength(1);
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
    // Renamed: the door names the room by the id it got with its first door, so the link holds.
    const renamed = { ...withDoor, rooms: withDoor.rooms.map(item => item.key === store.key ? { ...item, name: "Bin store" } : item) };
    const storeId = withDoor.rooms.find(item => item.key === store.key)!.id!;
    expect(save(renamed, base).layout.openings![0]!.room).toBe(storeId);
    // Renamed outside the editor (the advisor or a notes edit) without touching the door: it still finds its room.
    const elsewhere = save(withDoor, base);
    elsewhere.layout.rooms = elsewhere.layout.rooms.map(item => (item as { id?: string }).id === storeId ? { ...item, name: "Renamed store" } : item);
    const reread = reopen(elsewhere);
    expect(reread.rooms.find(item => item.key === reread.openings![0]!.room)!.name).toBe("Renamed store");
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
    // What the editor cannot read is kept as saved, after its own entries; an untouched line keeps its saved points.
    const saved = save(plan, base) as unknown as { layout: Record<string, unknown> };
    const openings = base.layout.openings as unknown[], lines = base.layout.lines as unknown[];
    expect(saved.layout.openings).toEqual([openings[0], ...openings.slice(1)]);
    expect(saved.layout.lines).toEqual(lines);
    // Moved, the line is kept inside the plan.
    const moved = save(moveItems(plan, [{ kind: "line", key: "ln-1" }], 0, 5), base) as unknown as { layout: { lines: unknown[] } };
    expect(moved.layout.lines[0]).toEqual({ id: "ln-1", points: [[10, 15], [1600, 15]], style: "road", colour: "#ff0000" });
  });

  it("never loses doors or lines it cannot read: an untouched layout saves byte for byte as it was", () => {
    const base = sktcLike() as StoredSpatialReference & { layout: Record<string, unknown> };
    base.layout.openings = [
      { id: "op-1", room: "264E Store", wall: "e", offset: 0.5, width: 40, kind: "door" },
      { id: "op-2", room: "Nope", wall: "n", offset: 0.5, width: 30, kind: "window" },
      { id: "door 1", room: "264E Store", wall: "n", offset: 1.02, width: "x", kind: "door" },
    ] as never;
    base.layout.lines = [{ id: "ln-1", points: [[10.5, 20], [300, 20.25]], style: "wall" }, { id: "ln-2", points: [[0, 0], [10001, 0]], style: "fence" }, { id: "ln-1", points: [[1, 1], [2, 2]], style: "wall" }] as never;
    const notes = notesWithReference("Site notes.", null, base);
    const found = readProjectSpatialReference(notes, "sktc")!;
    const plan = planFromReference(found.reference as StoredSpatialReference);
    expect(plan.openings!.map(item => item.key)).toEqual(["op-1"]);
    expect(plan.lines!.map(item => item.key)).toEqual(["ln-1"]);
    const saved = save(plan, found.reference as StoredSpatialReference);
    expect(JSON.stringify(saved)).toBe(JSON.stringify(found.reference));
    expect(notesWithReference(notes, found.block, saved)).toBe(notes);
    // Deleting the door the editor reads keeps the ones it could not; deleting its room in the editor takes its doors with it.
    const store = room(plan, "264E Store");
    expect((save(removeItems(plan, [{ kind: "opening", key: "op-1" }]), base).layout.openings as unknown[]).map(item => (item as { id: string }).id)).toEqual(["op-2", "door 1"]);
    expect((save(removeItems(plan, [{ kind: "room", key: store.key }]), base).layout.openings as unknown[]).map(item => (item as { id: string }).id)).toEqual(["op-2", "door 1"]);
    // A new door never takes the id of one carried as saved.
    const carried = planFromReference({ ...base, layout: { ...base.layout, openings: [{ id: "op-1", room: "Nope", wall: "n", offset: 0.5, width: 30, kind: "door" }] } } as never);
    expect(addOpening(carried, store.key, "s", 0.5)!.key).toBe("op-2");
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

describe("the automatic door", () => {
  const door = (plan: FloorPlan, roomKey: string) => plan.rooms.find(item => item.key === roomKey)!;
  it("comes back when the door that turned it off is deleted or made a window", () => {
    const plan = planFromReference(sktcLike()), store = room(plan, "264E Store");
    const { plan: withDoor, key } = addOpening(plan, store.key, "e", 0.5)!;
    expect(door(withDoor, store.key).autoDoor).toBe(false);
    const removed = removeItems(withDoor, [{ kind: "opening", key }]);
    expect(door(removed, store.key).autoDoor).toBeUndefined();
    expect(save(removed, sktcLike()).layout.rooms.find(item => item.name === "264E Store")).not.toHaveProperty("autoDoor");
    const windowed = updateOpening(withDoor, key, { kind: "window" });
    expect(door(windowed, store.key).autoDoor).toBeUndefined();
    expect(door(updateOpening(windowed, key, { kind: "door" }), store.key).autoDoor).toBe(false);
    // With a second door still there, it stays off.
    const two = addOpening(withDoor, store.key, "n", 0.5)!.plan;
    expect(door(removeItems(two, [{ kind: "opening", key }]), store.key).autoDoor).toBe(false);
  });

  it("stays off when the reader turned it off, and comes back for a saved room whose doors are deleted", () => {
    const plan = planFromReference(sktcLike()), store = room(plan, "264E Store");
    const off = { ...plan, rooms: plan.rooms.map(item => item.key === store.key ? { ...item, autoDoor: false as const } : item) };
    const { plan: withDoor, key } = addOpening(off, store.key, "e", 0.5)!;
    expect(door(removeItems(withDoor, [{ kind: "opening", key }]), store.key).autoDoor).toBe(false);
    // Saved with a door of its own (the editor turned it off then), opened again: deleting that door turns it back on.
    const saved = save(addOpening(plan, store.key, "e", 0.5)!.plan, sktcLike()), reread = reopen(saved), again = room(reread, "264E Store");
    expect(door(removeItems(reread, [{ kind: "opening", key: reread.openings![0]!.key }]), again.key).autoDoor).toBeUndefined();
  });
});

describe("locked rooms", () => {
  it("keep their doors and windows where they are", () => {
    const plan = planFromReference(sktcLike()), store = room(plan, "264E Store");
    const { plan: withDoor, key } = addOpening(plan, store.key, "s", 0.5)!, item = { kind: "opening" as const, key };
    const locked = lockItems(withDoor, [{ kind: "room", key: store.key }], true);
    expect(isLocked(locked, item)).toBe(true);
    expect(moveItems(locked, [item], 50, 0)).toBe(locked);
    expect(removeItems(locked, [item])).toBe(locked);
    expect(isLocked(lockItems(locked, [{ kind: "room", key: store.key }], false), item)).toBe(false);
  });
});

describe("walls inside an area or room", () => {
  it("move with it, and stay put when only partly inside", () => {
    const plan = planFromReference(sktcLike()), store = room(plan, "264E Store");
    // 264E Store is [280, 80, 220, 160].
    const inside = addLine(plan, [[300, 100], [480, 100]])!, across = addLine(inside.plan, [[300, 200], [700, 200]])!;
    const moved = moveItems(across.plan, [{ kind: "room", key: store.key }], 10, 5);
    expect(moved.lines!.find(item => item.key === inside.key)!.points).toEqual([[310, 105], [490, 105]]);
    expect(moved.lines!.find(item => item.key === across.key)!.points).toEqual([[300, 200], [700, 200]]);
    const area = moved.areas.find(item => item.label === "264E")!;
    const shifted = moveItems(across.plan, [{ kind: "area", key: area.key }], 0, 10);
    expect(shifted.lines!.find(item => item.key === inside.key)!.points).toEqual([[300, 110], [480, 110]]);
  });
});

describe("lines on a large plan", () => {
  it("keep every point within what a saved line can hold, so they read back", () => {
    // A plan whose drawing space starts at 3000: its far edge (12000) is past what a saved line point can be.
    const base = sktcLike(), far = ([x, y, w, h]: number[]) => [x! + 3000, y! + 3000, w!, h!] as [number, number, number, number];
    base.layout = { ...base.layout, viewBox: [3000, 3000, 9000, 9000], zones: base.layout.zones.map(zone => ({ ...zone, rect: far(zone.rect!) })), rooms: base.layout.rooms.map(item => ({ ...item, rect: far(item.rect) })), devices: base.layout.devices!.map(item => ({ ...item, position: [item.position[0] + 3000, item.position[1] + 3000] as [number, number] })), entrance: { label: "Main gate", position: [3540, 3860] } };
    const plan = planFromReference(base);
    const drawn = addLine(plan, [[9000, 9000], [12500, 12500]])!;
    expect(drawn.plan.lines![0]!.points[1]).toEqual([10000, 10000]);
    expect(setPoint(drawn.plan, drawn.key, 0, [13000, 4500]).lines![0]!.points[0]).toEqual([10000, 4500]);
    expect(addLine(plan, [[9000, 9000], [3500, 2000]])!.plan.lines![0]!.points[1]).toEqual([3500, 3000]);
    expect(reopen(save(drawn.plan, base)).lines).toHaveLength(1);
  });

  it("adds a point in the middle of the segment after the one picked, or of the longest", () => {
    expect(midpointAfter([[0, 0], [100, 0], [100, 300]], null)).toEqual({ after: 1, at: [100, 150] });
    expect(midpointAfter([[0, 0], [100, 0], [100, 300]], 0)).toEqual({ after: 0, at: [50, 0] });
    expect(midpointAfter([[0, 0], [100, 0], [100, 300]], 2)).toEqual({ after: 1, at: [100, 150] });
  });
});

describe("the size of the saved block", () => {
  it("fits a plan with every door and line list full in Project notes, beside the site", () => {
    const base = sktcLike();
    base.layout.viewBox = [0, 0, 10000, 10000];
    base.layout.rooms = base.layout.rooms.map((item, index) => ({ ...item, id: `rm-${String(index).padStart(8, "0")}` }));
    base.layout.openings = Array.from({ length: MAX_OPENINGS }, (_, index) => ({ id: `op-${index + 1000}`, room: `rm-${String(index % 14).padStart(8, "0")}`, wall: "n" as const, offset: 0.5123, width: 200, kind: "double" as const, swing: "out" as const, hinge: "end" as const }));
    base.layout.lines = Array.from({ length: MAX_LINES }, (_, index) => ({ id: `ln-${index + 1000}`, points: Array.from({ length: MAX_LINE_POINTS }, (_, point) => [9999 - point, 9998 - point] as [number, number]), style: "partition" as const, thickness: "m" as const, locked: true }));
    const notes = notesWithReference("Site notes.", null, base);
    expect(notes.length).toBeLessThan(NOTES_LIMIT * 0.8);
    // Each door and line is one line of text; the rest is laid out as before.
    expect(notes).toContain('      {"id":"ln-1000","points":[[9999,9998],');
    const found = readProjectSpatialReference(notes, "sktc")!;
    expect(found.reference).toEqual(base);
    expect(notesWithReference(notes, found.block, save(planFromReference(found.reference as StoredSpatialReference), found.reference as StoredSpatialReference))).toBe(notes);
  });
});
