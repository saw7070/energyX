/**
 * Floors meeting entrances, doors, lines, repeat and the stored format's limits: one main entrance for the whole site,
 * ids unique over every floor, Repeat moving every kind of item, limits counted over every floor, and the main entrance
 * matched only on its own floor.
 */
import { describe, expect, it } from "vitest";
import { MAX_LINES, readProjectSpatialReference, spatialSymbols } from "@datafoundry/contracts";
import { copyItems, pasteClip } from "./floor-plan-arrange";
import { translatorFor } from "./energyiq-messages";
import { deleteLevel, levelView, mergeView } from "./floor-plan-levels";
import { addLine } from "./floor-plan-lines";
import { floorPlanMessages } from "./floor-plan-messages";
import { hasMainEntrance, notesWithReference, planFromReference, promoteEntrance, referenceFromPlan, removeSelection, type FloorPlan, type StoredSpatialReference } from "./floor-plan-model";
import { addOpening } from "./floor-plan-openings";
import { repeatItems } from "./floor-plan-templates";

type Json = Record<string, unknown>;
const copyName = (name: string) => `${name} copy`;
const read = (reference: StoredSpatialReference) => readProjectSpatialReference(notesWithReference("", null, reference), "p")!.reference as StoredSpatialReference;
const save = (plan: FloorPlan, previous: StoredSpatialReference) => referenceFromPlan(plan, "p", previous);

/** A hall on the ground floor and an office upstairs, with whatever else a test adds to the layout. */
function site(layout: Json = {}, levels = [{ id: "g", name: "Ground" }, { id: "l2", name: "Level 2" }]): StoredSpatialReference {
  return read({
    schemaVersion: 1, projectId: "p", provenance: { file: "plan", status: "Edited in Facility → Floor layout" },
    layout: {
      viewBox: [0, 0, 1000, 640],
      zones: [{ id: "A", referenceBoard: "DB-A", rect: [20, 20, 460, 560] }, { id: "B", referenceBoard: "DB-B", rect: [20, 20, 460, 560], level: "l2" }],
      rooms: [{ name: "Hall", zone: "A", rect: [40, 60, 200, 160], id: "rm-hall" }, { name: "Office", zone: "B", rect: [40, 60, 200, 160], id: "rm-office", level: "l2" }],
      levels, ...layout,
    },
  } as unknown as StoredSpatialReference);
}

describe("one main entrance for the whole site", () => {
  // The main entrance is upstairs; the ground floor has a lift landmark.
  const upstairs = site({ entrance: { label: "Main gate", position: [300, 600], level: "l2" }, symbols: [{ kind: "entrance", label: "Main gate", position: [300, 600], level: "l2" }, { id: "sy-lift", kind: "lift", position: [400, 400] }] });
  const plan = planFromReference(upstairs), ground = levelView(plan, "g");

  it("knows on the ground floor that the site already has its main entrance", () => {
    expect(ground.entrance).toBeNull();
    expect(hasMainEntrance(ground)).toBe(true);
  });

  it("keeps the upstairs entrance when a ground-floor landmark becomes an entrance", () => {
    const changed = { ...ground, symbols: ground.symbols!.map(item => ({ ...item, kind: "entrance" })) };
    expect(promoteEntrance(changed)).toBe(changed);
    const next = mergeView(plan, "g", promoteEntrance(changed));
    expect(next.entrance).toMatchObject({ label: "Main gate", level: "l2" });
    expect(next.symbols?.filter(item => item.kind === "entrance")).toHaveLength(1);
  });

  it("keeps the upstairs entrance when a pasted entrance lands on the ground floor", () => {
    const entranceHere = { ...ground, symbols: [...ground.symbols!, { key: "symbol-gate", kind: "entrance", label: "Side gate", position: [500, 600] as [number, number] }] };
    const { plan: pasted, selection } = pasteClip(entranceHere, copyItems(entranceHere, [{ kind: "symbol", key: "symbol-gate" }])!, 20, copyName);
    expect(selection[0]!.kind).toBe("symbol");
    expect(mergeView(plan, "g", pasted).entrance).toMatchObject({ label: "Main gate", level: "l2" });
  });

  it("keeps an entrance set on the wrong floor as an entrance landmark there, never replacing the main one", () => {
    const next = mergeView(plan, "g", { ...ground, entrance: { label: "Back gate", position: [100, 600] } });
    expect(next.entrance).toMatchObject({ label: "Main gate", level: "l2" });
    const kept = next.symbols!.find(item => item.label === "Back gate")!;
    expect(kept).toMatchObject({ kind: "entrance", position: [100, 600] });
    expect(kept.level).toBeUndefined();
    expect((save(next, upstairs).layout.entrance as Json).level).toBe("l2");
  });
});

describe("the next entrance becoming the main one stays on its floor", () => {
  const groundGate = { entrance: { label: "Main gate", position: [300, 600] }, symbols: [{ kind: "entrance", label: "Main gate", position: [300, 600] }, { kind: "entrance", label: "Upper gate", position: [600, 600], level: "l2" }] };

  it("when the main entrance is deleted", () => {
    const plan = planFromReference(site(groundGate));
    expect(removeSelection(plan, { kind: "entrance", key: "entrance" }).entrance).toMatchObject({ label: "Upper gate", level: "l2" });
    // Deleted on the ground floor's own sheet: the upstairs entrance is the main one, upstairs.
    const next = mergeView(plan, "g", removeSelection(levelView(plan, "g"), { kind: "entrance", key: "entrance" }));
    expect(next.entrance).toMatchObject({ label: "Upper gate", level: "l2" });
    expect((save(next, site(groundGate)).layout.entrance as Json).level).toBe("l2");
  });

  it("when the main entrance's floor is deleted", () => {
    const three = site({ ...groundGate, symbols: [groundGate.symbols[0], { kind: "entrance", label: "Top gate", position: [600, 600], level: "l3" }] }, [{ id: "g", name: "Ground" }, { id: "l2", name: "Level 2" }, { id: "l3", name: "Level 3" }]);
    const next = deleteLevel(planFromReference(three), "g", null);
    expect(next.entrance).toMatchObject({ label: "Top gate", level: "l3" });
  });
});

describe("door and line ids are unique over every floor", () => {
  const withDrawing = site({
    openings: [{ id: "op-1", room: "rm-hall", wall: "s", offset: 0.5, width: 30, kind: "door" }, { id: "op-copy-1", room: "rm-hall", wall: "n", offset: 0.5, width: 30, kind: "door" }],
    lines: [{ id: "ln-1", points: [[500, 100], [700, 100]], style: "wall" }, { id: "ln-copy-1", points: [[500, 200], [700, 200]], style: "wall" }],
  });
  const plan = planFromReference(withDrawing), up = levelView(plan, "l2");

  it("gives a door added upstairs an id no ground-floor door has, and the map keeps both", () => {
    const office = up.rooms.find(room => room.name === "Office")!;
    const added = addOpening(up, office.key, "s", 0.5)!;
    expect(["op-1", "op-copy-1"]).not.toContain(added.key);
    const saved = save(mergeView(plan, "l2", added.plan), withDrawing);
    expect(new Set(saved.layout.openings!.map(item => item.id)).size).toBe(3);
  });

  it("gives a wall drawn upstairs an id no ground-floor line has", () => {
    const added = addLine(up, [[100, 300], [300, 300]])!;
    expect(["ln-1", "ln-copy-1"]).not.toContain(added.key);
  });

  it("gives pasted lines and the doors of pasted rooms new ids over every floor", () => {
    const drawn = mergeView(plan, "l2", addLine(up, [[100, 300], [300, 300]])!.plan), upper = levelView(drawn, "l2");
    const office = upper.rooms.find(room => room.name === "Office")!, withDoor = addOpening(upper, office.key, "s", 0.5)!.plan;
    const clip = copyItems(withDoor, [{ kind: "line", key: upper.lines![0]!.key }, { kind: "room", key: office.key }])!;
    const { plan: pasted } = pasteClip(withDoor, clip, 20, copyName);
    const saved = save(mergeView(drawn, "l2", pasted), withDrawing);
    expect(new Set(saved.layout.lines!.map(item => item.id)).size).toBe(saved.layout.lines!.length);
    expect(new Set(saved.layout.openings!.map(item => item.id)).size).toBe(saved.layout.openings!.length);
    expect(saved.layout.lines).toHaveLength(4);
  });
});

describe("Repeat moves every kind of item", () => {
  const drawn = site({ labels: [{ text: "Lobby", position: [300, 300] }], lines: [{ id: "ln-1", points: [[500, 100], [600, 100]], style: "wall" }], shapes: [{ id: "lawn", kind: "rect", rect: [600, 400, 100, 80] }] }, [{ id: "g", name: "Ground" }]);
  const plan = planFromReference(drawn);

  it("repeats labels, lines and shapes on their own, each copy one step further on", () => {
    const result = repeatItems(plan, [{ kind: "line", key: "ln-1" }, { kind: "shape", key: "lawn" }], 2, "down", 10, copyName);
    expect("failure" in result).toBe(false);
    const next = (result as { plan: FloorPlan }).plan;
    expect(next.viewBox.every(Number.isFinite)).toBe(true);
    // Together they span y 100 to 480: each copy is 380 + the 10 gap further down.
    expect(next.lines!.map(item => item.points[0]![1])).toEqual([100, 490, 880]);
    expect(next.shapes!.map(item => item.rect[1])).toEqual([400, 790, 1180]);
  });

  it("moves a label with the room it is repeated with", () => {
    const result = repeatItems(plan, [{ kind: "room", key: "room-1" }, { kind: "label", key: "label-1" }], 1, "across", 20, copyName) as { plan: FloorPlan };
    expect(result.plan.labels!.map(item => item.position[1])).toEqual([300, 300]);
    expect(result.plan.labels![1]!.position[0]).toBeGreaterThan(300);
  });
});

describe("the stored format's limits count every floor", () => {
  const lines = Array.from({ length: MAX_LINES }, (_, index) => ({ id: `ln-${index + 1}`, points: [[10, 10 + index], [60, 10 + index]], style: "wall" }));
  const full = site({ lines });

  it("refuses a wall upstairs when the ground floor already holds the most a layout can", () => {
    const plan = planFromReference(full);
    expect(addLine(levelView(plan, "l2"), [[100, 300], [300, 300]])).toBeNull();
  });

  it("refuses to save more lines than readers draw, with a plain message in every language", () => {
    const plan = planFromReference(full), extra = { ...plan, lines: [...plan.lines!, { key: "ln-extra", points: [[100, 300], [300, 300]] as Array<[number, number]>, style: "wall" as const, level: "l2" }] };
    expect(() => save(extra, full)).toThrow(translatorFor(floorPlanMessages, "en")("check.tooManyLines", { max: MAX_LINES }));
    for (const locale of ["en", "zh-Hans", "ms"] as const) for (const key of ["check.tooManyLines", "check.tooManyOpenings", "check.tooManyShapes"] as const) expect(translatorFor(floorPlanMessages, locale)(key, { max: 1 })).not.toBe(key);
  });
});

describe("the main entrance is matched on its own floor only", () => {
  // The ground floor's main gate; upstairs, a copied "Main gate" landmark at the same spot.
  const copied = site({ entrance: { label: "Main gate", position: [300, 600] }, symbols: [{ kind: "entrance", label: "Main gate", position: [300, 600], level: "l2" }] });

  it("in the editor", () => {
    const plan = planFromReference(copied);
    expect(plan.entrance).toMatchObject({ label: "Main gate" });
    expect(plan.entrance?.level).toBeUndefined();
    expect(plan.symbols).toHaveLength(1);
    expect(plan.symbols![0]!.level).toBe("l2");
  });

  it("for readers, by place and by name", () => {
    const marks = spatialSymbols(copied.layout);
    expect(marks).toHaveLength(2);
    expect(marks.filter(item => item.legacy)).toHaveLength(1);
    expect(marks[0]).toMatchObject({ legacy: true, position: [300, 600] });
    const moved = { ...copied.layout, entrance: { label: "Main gate", position: [100, 600] } };
    expect(spatialSymbols(moved).map(item => [item.position[0], !!item.legacy])).toEqual([[100, true], [300, false]]);
  });
});
