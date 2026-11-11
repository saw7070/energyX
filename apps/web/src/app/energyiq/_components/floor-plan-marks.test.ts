import { describe, expect, it } from "vitest";
import { readProjectSpatialReference } from "@datafoundry/contracts";
import { alignItems, placeTyped } from "./floor-plan-align";
import { boxOf, copyItems, extentOf, inBox, lockItems, markAt, moveItems, pasteClip, removeItems, turnItem } from "./floor-plan-arrange";
import { frameBounds, hitsFrame, labelBounds, labelFrame, normaliseRotation, symbolBounds, type PlanLabel, type PlanSymbol } from "./floor-plan-marks";
import { contentExtent, notesWithReference, planFromReference, referenceFromPlan, removeSelection, type FloorPlan, type Rect, type StoredSpatialReference } from "./floor-plan-model";

/** A layout saved before this change: an estate with five areas (one is equipment), 14 rooms, 19 devices and an entrance. */
function sktcLike(): StoredSpatialReference {
  const room = (name: string, zone: string, rect: Rect) => ({ name, zone, rect });
  const blocks = (block: string, x: number) => ["Lobby", "Store", "Bin centre", "Lift motor room", "Corridors L1-L17"].map((name, index) => room(`${block} ${name}`, block, [x + (index % 2) * 240, 80 + Math.floor(index / 2) * 200, 220, 160]));
  return {
    schemaVersion: 1, projectId: "sktc", provenance: { file: "Drawn in EnergyX", status: "Edited in Facility → Floor layout" },
    layout: {
      viewBox: [0, 0, 1600, 900],
      zones: [
        { id: "264E", referenceBoard: "DB-E", rect: [20, 20, 500, 700] }, { id: "264F", referenceBoard: "DB-F", rect: [560, 20, 500, 700] }, { id: "Carpark", referenceBoard: "", rect: [1100, 20, 480, 400] },
        { id: "Playground", referenceBoard: "DB-P", meterLocations: ["Playground lights"], rect: [1100, 460, 480, 300] }, { id: "LED", referenceBoard: "DB-L", rect: [52, 190, 196, 40], independentSpace: false, physicalParentRoom: "264E Lobby", equipment: "Lift lobby LED" },
      ],
      rooms: [...blocks("264E", 40), ...blocks("264F", 580), room("Drive-in", "Carpark", [1120, 80, 200, 300]), room("Lots", "Carpark", [1340, 80, 220, 300]), room("Play area", "Playground", [1120, 520, 200, 220]), room("Fitness corner", "Playground", [1340, 520, 220, 220])],
      entrance: { label: "Main gate", position: [540, 860], referenceBoard: "DB-E" },
      devices: Array.from({ length: 19 }, (_, index) => ({ meterId: `m${index + 1}`, position: [60 + (index % 10) * 150, 120 + Math.floor(index / 10) * 400] })),
    },
  } as unknown as StoredSpatialReference;
}
/** The stored layout as the page reads it back from Project notes. */
const read = (reference: StoredSpatialReference) => readProjectSpatialReference(notesWithReference("", null, reference), reference.projectId)!.reference as StoredSpatialReference;
const save = (plan: FloorPlan, previous: StoredSpatialReference) => read(referenceFromPlan(plan, previous.projectId, previous));
const withLayout = (extra: Record<string, unknown>) => read({ ...sktcLike(), layout: { ...sktcLike().layout, ...extra } } as unknown as StoredSpatialReference);
const layoutOf = (reference: StoredSpatialReference) => reference.layout as unknown as Record<string, unknown> & { entrance?: Record<string, unknown>; symbols?: Array<Record<string, unknown>>; labels?: Array<Record<string, unknown>> };

describe("layouts saved before text labels and landmarks", () => {
  it("load, and save back byte for byte, with no symbol or label list added", () => {
    const original = read(sktcLike()), text = notesWithReference("SKTC notes.", null, original);
    const found = readProjectSpatialReference(text, "sktc")!;
    const plan = planFromReference(found.reference as StoredSpatialReference);
    expect([plan.areas.length, plan.rooms.length, plan.devices.length, !!plan.entrance, plan.labels, plan.symbols]).toEqual([5, 14, 19, true, undefined, undefined]);
    expect(plan.entrance).toEqual({ label: "Main gate", position: [540, 860], extra: { referenceBoard: "DB-E" } });
    const saved = referenceFromPlan(plan, "sktc", found.reference as StoredSpatialReference);
    expect(notesWithReference(text, found.block, saved)).toBe(text);
    expect("symbols" in saved.layout || "labels" in saved.layout).toBe(false);
  });

  it("keep the legacy entrance as the one entrance: moving it writes layout.entrance, with no symbol list", () => {
    const saved = read(sktcLike()), plan = planFromReference(saved);
    const moved = save(moveItems(plan, [{ kind: "entrance", key: "entrance" }], 40, -20), saved);
    expect(layoutOf(moved).entrance).toEqual({ label: "Main gate", position: [580, 840], referenceBoard: "DB-E" });
    expect("symbols" in moved.layout).toBe(false);
  });
});

describe("several entrances", () => {
  it("turning the main entrance adds a symbol list; it reopens as one entrance (never twice) and saves the same", () => {
    const saved = read(sktcLike()), plan = planFromReference(saved);
    const turned = save(turnItem(plan, { kind: "entrance", key: "entrance" }, 90), saved);
    expect(layoutOf(turned).entrance).toEqual({ label: "Main gate", position: [540, 860], referenceBoard: "DB-E" });
    expect(layoutOf(turned).symbols).toEqual([{ kind: "entrance", position: [540, 860], rotation: 90, label: "Main gate" }]);
    const again = planFromReference(turned);
    expect(again.symbols).toBeUndefined();
    expect(again.entrance).toMatchObject({ label: "Main gate", position: [540, 860], rotation: 90, slot: 0 });
    expect(JSON.stringify(save(again, turned))).toBe(JSON.stringify(turned));
  });

  it("the first entrance drives layout.entrance: move, rotate, delete the first (the next takes over) and delete all", () => {
    const saved = read(sktcLike()), plan = planFromReference(saved);
    const side: PlanSymbol = { key: "symbol-x", id: "sy-side0001", kind: "entrance", position: [1200, 860], label: "Side gate" };
    const two = { ...plan, symbols: [{ key: "symbol-t", kind: "tree", position: [1300, 800] } as PlanSymbol, side] };
    const first = save(two, saved);
    expect(layoutOf(first).entrance).toEqual({ label: "Main gate", position: [540, 860], referenceBoard: "DB-E" });
    expect(layoutOf(first).symbols!.map(item => [item.kind, item.label ?? null])).toEqual([["entrance", "Main gate"], ["tree", null], ["entrance", "Side gate"]]);
    // Reopened: the main gate is the first entrance, the side gate a landmark, each drawn once.
    const reopened = planFromReference(first);
    expect(reopened.entrance?.label).toBe("Main gate");
    expect(reopened.symbols!.map(item => item.kind)).toEqual(["tree", "entrance"]);
    expect(JSON.stringify(save(reopened, first))).toBe(JSON.stringify(first));
    // Moving and turning the first entrance moves layout.entrance and its symbol together.
    const shifted = save(turnItem(moveItems(reopened, [{ kind: "entrance", key: "entrance" }], 20, 0), { kind: "entrance", key: "entrance" }, 45), first);
    expect(layoutOf(shifted).entrance!.position).toEqual([560, 860]);
    expect(layoutOf(shifted).symbols![0]).toEqual({ kind: "entrance", position: [560, 860], rotation: 45, label: "Main gate" });
    // Deleting the first: the side gate becomes the main entrance in layout.entrance; the board belonged to the old one.
    const gone = save(removeSelection(planFromReference(shifted), { kind: "entrance", key: "entrance" }), shifted);
    expect(layoutOf(gone).entrance).toEqual({ label: "Side gate", position: [1200, 860] });
    expect(layoutOf(gone).symbols!.map(item => item.kind)).toEqual(["tree", "entrance"]);
    // None left: no entrance at all, as before landmarks existed.
    const none = save(removeSelection(planFromReference(gone), { kind: "entrance", key: "entrance" }), gone);
    expect("entrance" in none.layout).toBe(false);
    expect(layoutOf(none).symbols!.map(item => item.kind)).toEqual(["tree"]);
  });

  it("deletes the first entrance and the next one together without the next one taking over", () => {
    const plan = { ...planFromReference(read(sktcLike())), symbols: [{ key: "s1", kind: "entrance", position: [900, 860] } as PlanSymbol] };
    const both = removeItems(plan, [{ kind: "entrance", key: "entrance" }, { kind: "symbol", key: "s1" }]);
    expect([both.entrance, both.symbols]).toEqual([null, undefined]);
  });

  it("a layout with only entrance symbols takes the first as the entrance and writes layout.entrance from it", () => {
    const { entrance: _gone, ...layout } = sktcLike().layout as unknown as Record<string, unknown>;
    const saved = read({ ...sktcLike(), layout: { ...layout, symbols: [{ kind: "lift", position: [100, 850] }, { kind: "entrance", position: [700, 860], label: "North gate" }] } } as unknown as StoredSpatialReference);
    const plan = planFromReference(saved);
    expect(plan.entrance).toMatchObject({ label: "North gate", position: [700, 860], slot: 1 });
    expect(layoutOf(save(plan, saved)).entrance).toEqual({ label: "North gate", position: [700, 860] });
  });
});

describe("text labels and landmarks", () => {
  const marks = { labels: [{ id: "lb-road0001", text: "Jalan Besar", position: [800, 870], size: "l", rotation: 15, colour: "#2A78D6", bold: true, locked: true, note: "kept" }, { text: "Bus stop A", position: [100, 880] }], symbols: [{ kind: "entrance", position: [540, 860], label: "Main gate" }, { id: "sy-lift0001", kind: "lift", position: [300, 850], size: 40, rotation: 270, label: "Lift A", colour: "#d6453d" }, { kind: "hovercraftPad", position: [1500, 860], future: { any: "thing" } }] };

  it("round-trip exactly, a kind this version does not know included", () => {
    const saved = withLayout(marks), plan = planFromReference(saved);
    expect(plan.labels!.map(item => item.text)).toEqual(["Jalan Besar", "Bus stop A"]);
    expect(plan.labels![0]).toMatchObject({ size: "l", rotation: 15, colour: "#2A78D6", bold: true, locked: true, extra: { note: "kept" } });
    expect(plan.symbols!.map(item => item.kind)).toEqual(["lift", "hovercraftPad"]);
    expect(JSON.stringify(save(plan, saved))).toBe(JSON.stringify(saved));
  });

  it("add the main entrance to a symbol list written without it, once, at the front", () => {
    const saved = withLayout({ symbols: [{ kind: "tree", position: [300, 850] }] }), plan = planFromReference(saved);
    expect(plan.symbols!.map(item => item.kind)).toEqual(["tree"]);
    const again = save(plan, saved);
    expect(layoutOf(again).symbols).toEqual([{ kind: "entrance", position: [540, 860], label: "Main gate" }, { kind: "tree", position: [300, 850] }]);
    expect(JSON.stringify(save(planFromReference(again), again))).toBe(JSON.stringify(again));
  });

  it("treat saved data as untrusted: what cannot be drawn is kept aside, bad values are never used, and long lists stop at 300", () => {
    const bad = withLayout({ labels: [{ text: "", position: [1, 1] }, { text: "OK", position: [10, 10], colour: "red", size: "huge", rotation: "90", bold: "yes" }, "not a label", { text: "x".repeat(200), position: [20, 20] }], symbols: [{ kind: "<script>", position: [1, 1] }, { kind: "tree", position: [5, Number.MAX_VALUE] }, { kind: "tree", position: [50, 50], size: -4, colour: "url(#x)" }] });
    const plan = planFromReference(bad);
    expect(plan.labels!.map(item => [item.text.length, item.colour ?? null, item.size ?? null, item.rotation ?? null, item.bold ?? null])).toEqual([[2, null, null, null, null], [80, null, null, null, null]]);
    expect(plan.symbols!.map(item => [item.kind, item.size ?? null, item.colour ?? null])).toEqual([["tree", null, null]]);
    expect(plan.carried?.labels?.map(item => item.index)).toEqual([0, 2]);
    expect(plan.carried?.symbols?.map(item => item.index)).toEqual([0, 1]);
    // Entries kept aside go back where they were, and bad values ride along untouched (never drawn).
    const again = save(plan, bad);
    expect(layoutOf(again).labels![0]).toEqual({ text: "", position: [1, 1] });
    expect(layoutOf(again).labels![1]).toEqual({ text: "OK", position: [10, 10], colour: "red", size: "huge", rotation: "90", bold: "yes" });
    expect(layoutOf(again).symbols!.slice(0, 2)).toEqual([{ kind: "<script>", position: [1, 1] }, { kind: "tree", position: [5, Number.MAX_VALUE] }].map(item => JSON.parse(JSON.stringify(item))));
    const many = withLayout({ labels: Array.from({ length: 305 }, (_, index) => ({ text: `L${index}`, position: [10 + index, 10] })) });
    const big = planFromReference(many);
    expect([big.labels!.length, big.carried?.labels?.length]).toEqual([300, 5]);
    expect(JSON.stringify(save(big, many))).toBe(JSON.stringify(many));
  });

  it("refuse to save an empty label, in plain words", () => {
    const plan = { ...planFromReference(read(sktcLike())), labels: [{ key: "l", text: "   ", position: [100, 100] } as PlanLabel] };
    expect(() => referenceFromPlan(plan, "sktc", null)).toThrow("A text label is empty");
  });

  it("normalise turning to whole degrees 0-359", () => {
    expect([normaliseRotation(-15), normaliseRotation(360), normaliseRotation(374.6), normaliseRotation(Number.NaN)]).toEqual([345, 0, 15, 0]);
    const plan = { ...planFromReference(read(sktcLike())), labels: [{ key: "l", text: "Hi", position: [800, 400] } as PlanLabel] };
    expect(turnItem(plan, { kind: "label", key: "l" }, -90).labels![0]!.rotation).toBe(270);
    expect(turnItem(turnItem(plan, { kind: "label", key: "l" }, 90), { kind: "label", key: "l" }, 720).labels![0]!.rotation).toBeUndefined();
  });

  it("count in the space the plan must keep, so shrinking it never cuts them off", () => {
    const plan = planFromReference(read(sktcLike()));
    const far = { ...plan, labels: [{ key: "l", text: "Far corner", position: [1550, 890], rotation: 90 } as PlanLabel] };
    expect(contentExtent(far)[1]).toBeGreaterThan(contentExtent(plan)[1]);
    expect(contentExtent(far)[1]).toBeGreaterThanOrEqual(labelBounds(far.labels![0]!, 16)[1] + labelBounds(far.labels![0]!, 16)[3]);
    const symbol = { ...plan, symbols: [{ key: "s", kind: "tree", position: [1590, 450], label: "Rain tree" } as PlanSymbol] };
    expect(contentExtent(symbol)[0]).toBeGreaterThanOrEqual(symbolBounds(symbol.symbols![0]!, 16)[0] + symbolBounds(symbol.symbols![0]!, 16)[2]);
  });
});

describe("turned items", () => {
  const plan: FloorPlan = { viewBox: [0, 0, 1000, 640], areas: [{ key: "A", label: "A", board: "", rect: [0, 0, 1000, 640] }], rooms: [{ key: "r", name: "Room", rect: [20, 20, 200, 200], area: "A" }], devices: [], entrance: null,
    labels: [{ key: "road", text: "A long road name", position: [500, 300], rotation: 90 }, { key: "note", text: "Note", position: [800, 100] }] };

  it("are hit by turning the point back: a point on the turned text hits it, the same point unturned does not", () => {
    const frame = labelFrame(plan.labels![0]!, 10);
    expect(hitsFrame([500, 360], frame)).toBe(true);   // along the text, now running down the page
    expect(hitsFrame([560, 300], frame)).toBe(false);  // where the text would run if it were not turned
    expect(markAt(plan, [500, 360])).toEqual({ kind: "label", key: "road" });
    expect(markAt(plan, [560, 300])).toBeNull();
  });

  it("are taken by a selection box only when the whole turned box is inside it", () => {
    const [x, y, w, h] = frameBounds(labelFrame(plan.labels![0]!, 10));
    expect(h).toBeGreaterThan(w);
    expect(inBox(plan, [x - 2, y - 2, w + 4, h + 4]).map(item => item.key)).toContain("road");
    // A box as wide as the text unturned (but only as tall as one line) does not take it.
    expect(inBox(plan, [400, 290, 200, 20]).map(item => item.key)).not.toContain("road");
  });

  it("stay fully inside the plan when moved or turned, and a turned device box too", () => {
    const pushed = moveItems(plan, [{ kind: "label", key: "note" }], 5000, -5000);
    const [x, y, w] = boxOf(pushed, { kind: "label", key: "note" })!;
    expect([Math.round(x + w), Math.round(y)]).toEqual([1000, 0]);
    const nearEdge = { ...plan, devices: [{ meterId: "tv", position: [980, 320] as [number, number], size: [160, 40] as [number, number] }] };
    const turned = turnItem(nearEdge, { kind: "device", key: "tv" }, 45);
    const [bx, , bw] = extentOf(turned, { kind: "device", key: "tv" })!;
    expect(bx + bw).toBeLessThanOrEqual(1000.0001);
    expect(turned.devices[0]!.rotation).toBe(45);
  });
});

describe("everyday tools on text labels and landmarks", () => {
  const plan: FloorPlan = { viewBox: [0, 0, 1000, 640], areas: [{ key: "A", label: "A", board: "", rect: [0, 0, 1000, 640] }], rooms: [{ key: "r", name: "Room", rect: [20, 20, 200, 200], area: "A" }], devices: [], entrance: null,
    labels: [{ key: "a", id: "lb-a0000000", text: "Gate road", position: [400, 300], extra: { note: "only the original" } }, { key: "b", text: "Car park", position: [600, 500] }],
    symbols: [{ key: "s", id: "sy-s0000000", kind: "tree", position: [700, 200], locked: true }] };

  it("copy and paste labels with new keys and ids, unlocked and without what the original carried", () => {
    const clip = copyItems(plan, [{ kind: "label", key: "a" }, { kind: "symbol", key: "s" }])!;
    const { plan: pasted, selection } = pasteClip(plan, clip, 10, name => `${name} copy`);
    expect(pasted.labels!.length).toBe(3);
    expect(pasted.symbols!.length).toBe(2);
    const copy = pasted.labels![2]!;
    expect([copy.text, copy.position, copy.extra, copy.id === "lb-a0000000", copy.id?.startsWith("lb-")]).toEqual(["Gate road", [410, 310], undefined, false, true]);
    expect(pasted.symbols![1]!.locked).toBeUndefined();
    expect(selection.map(item => item.kind)).toEqual(["label", "symbol"]);
  });

  it("line labels up, and leave locked landmarks where they are", () => {
    const lined = alignItems(plan, [{ kind: "label", key: "a" }, { kind: "label", key: "b" }, { kind: "symbol", key: "s" }], "left");
    const lefts = ["a", "b"].map(key => Math.round(boxOf(lined.plan, { kind: "label", key })![0]));
    expect(Math.abs(lefts[0]! - lefts[1]!)).toBeLessThanOrEqual(1);
    expect(lined.skipped).toBe(1);
    expect(lined.plan.symbols![0]!.position).toEqual([700, 200]);
  });

  it("take a typed X and Y for the box around them, kept inside the plan", () => {
    const typed = placeTyped(plan, { kind: "label", key: "b" }, "x", 100);
    expect(Math.round(boxOf(typed.plan, { kind: "label", key: "b" })![0])).toBe(100);
    const far = placeTyped(plan, { kind: "label", key: "b" }, "y", 5000);
    const [, y, , h] = boxOf(far.plan, { kind: "label", key: "b" })!;
    expect([far.adjusted, Math.round(y + h)]).toEqual([true, 640]);
  });

  it("lock labels so they cannot be moved, turned or deleted until unlocked", () => {
    const locked = lockItems(plan, [{ kind: "label", key: "b" }], true);
    expect(locked.labels![1]!.locked).toBe(true);
    expect(moveItems(locked, [{ kind: "label", key: "b" }], 10, 10)).toBe(locked);
    expect(turnItem(locked, { kind: "label", key: "b" }, 90)).toBe(locked);
    expect(removeItems(locked, [{ kind: "label", key: "b" }])).toBe(locked);
    expect(lockItems(locked, [{ kind: "label", key: "b" }], false).labels![1]!.locked).toBeUndefined();
  });
});
