import { describe, expect, it } from "vitest";
import { readProjectSpatialReference } from "@datafoundry/contracts";
import { alignItems, distributeItems, placeTyped, sameSize } from "./floor-plan-align";
import { lockItems } from "./floor-plan-arrange";
import { canShift, resizeCanvasFrom, shiftPlan } from "./floor-plan-canvas";
import { parseColour, withBoardColour } from "./floor-plan-colour";
import { parseAmount } from "./floor-plan-position";
import { MAX_COORD, notesWithReference, planFromReference, referenceFromPlan, resizeCanvas, resizeRect, type FloorPlan, type Selection, type StoredSpatialReference } from "./floor-plan-model";
import { DEFAULT_PREFS, editorPrefs, gridSpacing, guideFor, guideTargets, snapToLines, withPrefs } from "./floor-plan-snap";

type Rect = [number, number, number, number];
/** A layout saved before this change: an estate with five areas (one is equipment), 14 rooms, 19 devices and an entrance. */
function sktcLike(): StoredSpatialReference {
  const names = ["Lobby", "Store", "Bin centre", "Lift motor room", "Corridors L1-L17"];
  const rooms = [
    ...names.map((name, index) => ({ name: `264E ${name}`, zone: "264E", rect: [40 + (index % 2) * 240, 80 + Math.floor(index / 2) * 200, 220, 160] as Rect })),
    ...names.map((name, index) => ({ name: `264F ${name}`, zone: "264F", rect: [580 + (index % 2) * 240, 80 + Math.floor(index / 2) * 200, 220, 160] as Rect, ...(index === 1 ? { colour: "#e87ba4" } : {}) })),
    { name: "Drive-in", zone: "Carpark", rect: [1120, 80, 200, 300] as Rect }, { name: "Lots", zone: "Carpark", rect: [1340, 80, 220, 300] as Rect },
    { name: "Play area", zone: "Playground", rect: [1120, 520, 200, 220] as Rect }, { name: "Fitness corner", zone: "Playground", rect: [1340, 520, 220, 220] as Rect },
  ];
  const devices = Array.from({ length: 19 }, (_, index) => ({ meterId: `m${index + 1}`, position: [60 + (index % 10) * 150, 120 + Math.floor(index / 10) * 400] as [number, number], ...(index === 3 ? { size: [160, 50] as [number, number] } : {}), ...(index === 5 ? { colour: "#4a3aa7" } : {}) }));
  return {
    schemaVersion: 1, projectId: "sktc", provenance: { file: "Drawn in EnergyX", status: "Edited in Facility → Floor layout" },
    layout: {
      viewBox: [0, 0, 1600, 900],
      zones: [
        { id: "264E", referenceBoard: "DB-E", rect: [20, 20, 500, 700] },
        { id: "264F", referenceBoard: "DB-F", rect: [560, 20, 500, 700] },
        { id: "Carpark", referenceBoard: "", rect: [1100, 20, 480, 400], colour: "#1b9aaa" } as never,
        { id: "Playground", referenceBoard: "DB-P", meterLocations: ["Playground lights"], rect: [1100, 460, 480, 300] },
        { id: "LED", referenceBoard: "DB-L", rect: [52, 190, 196, 40], independentSpace: false, physicalParentRoom: "264E Lobby", equipment: "Lift lobby LED" },
      ],
      rooms,
      entrance: { label: "Main gate", position: [540, 860] },
      devices,
      boardColours: { "DB-E": "#2a78d6" },
      style: "blueprint",
    },
  };
}
const read = (reference: StoredSpatialReference) => readProjectSpatialReference(notesWithReference("", null, reference), reference.projectId)!.reference as StoredSpatialReference;
const save = (plan: FloorPlan, previous: StoredSpatialReference) => referenceFromPlan(plan, previous.projectId, previous);
const room = (plan: FloorPlan, name: string) => plan.rooms.find(item => item.name === name)!;
const area = (plan: FloorPlan, label: string) => plan.areas.find(item => item.label === label)!;
const sel = (kind: Selection["kind"], key: string): Selection => ({ kind, key });

describe("layouts saved before this change", () => {
  it("load, and save back exactly as they were, with no grid choices added", () => {
    const saved = read(sktcLike()), plan = planFromReference(saved);
    expect([saved.layout.zones.length, saved.layout.rooms.length, saved.layout.devices!.length, !!saved.layout.entrance]).toEqual([5, 14, 19, true]);
    // The editor's default grid choices add nothing to a layout that had none.
    expect(editorPrefs(plan)).toEqual(DEFAULT_PREFS);
    expect(withPrefs(plan, DEFAULT_PREFS)).toBe(plan);
    const again = save(withPrefs(plan, DEFAULT_PREFS), saved);
    expect(JSON.stringify(again)).toBe(JSON.stringify(saved));
    expect(notesWithReference("Site notes.", null, again)).toBe(notesWithReference("Site notes.", null, saved));
    expect("editor" in again.layout).toBe(false);
  });
});

describe("grid choices", () => {
  it("are saved in layout.editor, read back, and keep anything else in that block as saved", () => {
    const saved = read(sktcLike()), plan = planFromReference(saved);
    const changed = save(withPrefs(plan, { grid: 20, snap: false, showGrid: false }), saved);
    expect(changed.layout.editor).toEqual({ grid: 20, snap: false, showGrid: false });
    // The editor block comes after the editor's other keys; the map and reports never read it.
    expect(Object.keys(changed.layout).slice(-1)).toEqual(["editor"]);
    const reopened = planFromReference(read(changed));
    expect(editorPrefs(reopened)).toEqual({ grid: 20, snap: false, showGrid: false });
    expect(JSON.stringify(save(reopened, read(changed)))).toBe(JSON.stringify(read(changed)));
    // A later version's own keys in the block stay; only the three choices are written.
    const later = read({ ...sktcLike(), layout: { ...sktcLike().layout, editor: { zoom: 2, grid: 50 } } } as StoredSpatialReference);
    const laterPlan = planFromReference(later);
    expect(editorPrefs(laterPlan)).toEqual({ grid: 50, snap: true, showGrid: true });
    expect(save(withPrefs(laterPlan, { grid: 5, snap: true, showGrid: true }), later).layout.editor).toEqual({ zoom: 2, grid: 5, snap: true, showGrid: true });
  });

  it("treat saved values as untrusted: anything not understood reads as the default and is left as saved", () => {
    expect(editorPrefs({ editor: { grid: 7, snap: "yes", showGrid: 0 } })).toEqual(DEFAULT_PREFS);
    expect(editorPrefs({ editor: { grid: 5, snap: false } })).toEqual({ grid: 5, snap: false, showGrid: true });
    const odd = read({ ...sktcLike(), layout: { ...sktcLike().layout, editor: "grid please" } } as unknown as StoredSpatialReference);
    const plan = planFromReference(odd);
    expect(editorPrefs(plan)).toEqual(DEFAULT_PREFS);
    expect(JSON.stringify(save(plan, odd))).toBe(JSON.stringify(odd));
  });

  it("space grid lines further apart on a big plan", () => {
    expect(gridSpacing(10, 1000)).toBe(20);
    expect(gridSpacing(5, 10000)).toBe(40);
    expect(gridSpacing(50, 10000)).toBe(100);
  });
});

describe("alignment guides", () => {
  const targets = guideTargets([[100, 100, 200, 100], [400, 300, 100, 100]]);
  it("pull an edge or centre onto the nearest edge or centre within reach", () => {
    // Left edge at 103 lines up with the left edge at 100.
    expect(snapToLines(targets.x, [103, 153, 203], 6)).toEqual({ shift: -3, at: 100 });
    // The centre at 196 lines up with the first box's centre (200).
    expect(snapToLines(targets.x, [150, 196, 242], 6)).toEqual({ shift: 4, at: 200 });
    expect(snapToLines(targets.x, [120, 160, 240], 6)).toBeNull();
    expect(snapToLines(targets.y, [397], 6)).toEqual({ shift: 3, at: 400 });
    expect(snapToLines({ x: [] }.x, [10], 6)).toBeNull();
  });
  it("draw across the dragged box and everything lined up with it", () => {
    expect(guideFor(targets.x, "x", 400, [400, 50, 40, 20])).toEqual({ axis: "x", at: 400, from: 50, to: 400 });
  });
});

describe("edge grips", () => {
  const box: Rect = [100, 100, 200, 100], view: Rect = [0, 0, 1000, 640];
  it("move one side only, never below the smallest size", () => {
    expect(resizeRect(box, "e", 40, 30, view)).toEqual([100, 100, 240, 100]);
    expect(resizeRect(box, "w", -40, 30, view)).toEqual([60, 100, 240, 100]);
    expect(resizeRect(box, "n", 15, -50, view)).toEqual([100, 50, 200, 150]);
    expect(resizeRect(box, "s", 15, -500, view)).toEqual([100, 100, 200, 20]);
    // Corners still move both.
    expect(resizeRect(box, "se", 10, 10, view)).toEqual([100, 100, 210, 110]);
  });
});

describe("line up", () => {
  const base = () => planFromReference(read(sktcLike()));
  it("aligns left edges with the outermost item, moving what is inside each item along, as one change", () => {
    const plan = base(), store = room(plan, "264F Store"), lobby = room(plan, "264E Lobby");
    const { plan: next, skipped } = alignItems(plan, [sel("room", lobby.key), sel("room", store.key)], "left");
    expect(skipped).toBe(0);
    expect(room(next, "264F Store").rect[0]).toBe(lobby.rect[0]);
    expect(room(next, "264E Lobby").rect).toEqual(lobby.rect);
    // An area's rooms come with it.
    const aligned = alignItems(plan, [sel("area", area(plan, "264E").key), sel("area", area(plan, "264F").key)], "top").plan;
    expect(aligned).toBe(plan); // both already share a top edge: nothing changes
    const right = alignItems(plan, [sel("area", area(plan, "264E").key), sel("area", area(plan, "Carpark").key)], "right").plan;
    expect(area(right, "264E").rect[0]).toBe(1100 + 480 - 500);
    expect(room(right, "264E Lobby").rect[0] - area(right, "264E").rect[0]).toBe(20);
  });

  it("leaves locked items where they are and says how many", () => {
    const plan = base(), lobby = room(plan, "264E Lobby"), store = room(plan, "264F Store"), drive = room(plan, "Drive-in");
    const locked = lockItems(plan, [sel("room", store.key)], true);
    const { plan: next, skipped } = alignItems(locked, [sel("room", lobby.key), sel("room", store.key), sel("room", drive.key)], "bottom");
    expect(skipped).toBe(1);
    expect(room(next, "264F Store").rect).toEqual(store.rect);
    expect(room(next, "264E Lobby").rect[1] + room(next, "264E Lobby").rect[3]).toBe(drive.rect[1] + drive.rect[3]);
  });

  it("spaces three or more items evenly between the first and last", () => {
    const plan = base(), list = ["264E Lobby", "264E Store", "264F Lobby"].map(name => sel("room", room(plan, name).key));
    const moved = { ...plan, rooms: plan.rooms.map(item => item.name === "264E Store" ? { ...item, rect: [300, 80, 220, 160] as Rect } : item) };
    const { plan: next } = distributeItems(moved, list, "x");
    // From 40 to 800 (the last's right edge): three boxes of 220 leave two gaps of 50.
    expect(["264E Lobby", "264E Store", "264F Lobby"].map(name => room(next, name).rect[0])).toEqual([40, 310, 580]);
    expect(distributeItems(plan, list.slice(0, 2), "x").plan).toBe(plan);
  });

  it("gives the same width or height as the first item picked, keeping each top-left corner", () => {
    const plan = base(), drive = room(plan, "Drive-in"), lobby = room(plan, "264E Lobby");
    const { plan: next } = sameSize(plan, [sel("room", drive.key), sel("room", lobby.key)], "h");
    expect(room(next, "264E Lobby").rect).toEqual([lobby.rect[0], lobby.rect[1], lobby.rect[2], drive.rect[3]]);
    // A device box takes the size too; its centre moves so its top-left corner stays.
    const boxed = sameSize(plan, [sel("room", drive.key), sel("device", "m4")], "w").plan.devices.find(item => item.meterId === "m4")!;
    expect(boxed.size).toEqual([200, 50]);
    expect(boxed.position).toEqual([510 - 80 + 100, 120]);
  });
});

describe("typed position and size", () => {
  const base = () => planFromReference(read(sktcLike()));
  it("moves an item to an exact place from the top-left of the drawing space, with what is inside it", () => {
    const plan = base(), item = sel("area", area(plan, "264E").key);
    const { plan: next, adjusted } = placeTyped(plan, item, "x", 40);
    expect(adjusted).toBe(false);
    expect(area(next, "264E").rect[0]).toBe(40);
    expect(room(next, "264E Lobby").rect[0]).toBe(60);
    // Measured from the drawing space's own corner when it does not start at 0.
    const offset = { ...plan, viewBox: [10, 0, 1590, 900] as Rect };
    expect(area(placeTyped(offset, item, "x", 40).plan, "264E").rect[0]).toBe(50);
  });
  it("keeps typed values inside the plan and at least the smallest size, and says so", () => {
    const plan = base(), item = sel("room", room(plan, "Lots").key);
    const far = placeTyped(plan, item, "x", 99999);
    expect([room(far.plan, "Lots").rect[0], far.adjusted]).toEqual([1600 - 220, true]);
    const thin = placeTyped(plan, item, "w", 3);
    expect([room(thin.plan, "Lots").rect[2], thin.adjusted]).toEqual([20, true]);
    const wide = placeTyped(plan, item, "w", 5000);
    expect([room(wide.plan, "Lots").rect[2], wide.adjusted]).toEqual([1600 - 1340, true]);
    expect(placeTyped(plan, item, "h", 300).plan).toBe(plan);
    // Locked items are not changed.
    const locked = lockItems(plan, [item], true);
    expect(placeTyped(locked, item, "x", 0).plan).toBe(locked);
  });
  it("reads only plain numbers", () => {
    expect([parseAmount("120"), parseAmount(" 12.5 "), parseAmount("12,5"), parseAmount("-4")]).toEqual([120, 12.5, 12.5, -4]);
    expect([parseAmount(""), parseAmount("abc"), parseAmount("1e3"), parseAmount("12px")]).toEqual([null, null, null, null]);
  });
});

describe("custom colours", () => {
  it("accept only #rrggbb codes", () => {
    expect([parseColour("#1B9AAA"), parseColour("1b9aaa"), parseColour(" #abcdef ")]).toEqual(["#1b9aaa", "#1b9aaa", "#abcdef"]);
    expect([parseColour("#abc"), parseColour("red"), parseColour("#12345g"), parseColour("url(#x)"), parseColour("")]).toEqual([null, null, null, null, null]);
  });
  it("set a panel's colour for everyone on it, saved as boardColours, and back to automatic", () => {
    const saved = read(sktcLike()), plan = planFromReference(saved);
    const coloured = withBoardColour(plan, "DB-F", "#D6453D");
    expect(coloured.colours).toEqual({ "DB-E": "#2a78d6", "DB-F": "#d6453d" });
    expect(save(coloured, saved).layout.boardColours).toEqual({ "DB-E": "#2a78d6", "DB-F": "#d6453d" });
    expect(withBoardColour(coloured, "DB-F", "#d6453d")).toBe(coloured);
    expect(withBoardColour(plan, "DB-F", "not a colour")).toBe(plan);
    const cleared = withBoardColour(plan, "DB-E", null);
    expect(cleared.colours).toBeUndefined();
    expect("boardColours" in save(cleared, saved).layout).toBe(false);
  });
});

describe("a bigger drawing space", () => {
  it("grows to the left by using the room before its corner first, moving nothing", () => {
    // A plan whose drawing space starts 200 in from the left.
    const saved = read(sktcLike()), plan = { ...shiftPlan(planFromReference(saved), 200, 0), viewBox: [200, 0, 1600, 900] as Rect };
    const { plan: next, blocked } = resizeCanvasFrom(plan, "w", 1700);
    expect(blocked).toBe(false);
    expect(next.viewBox).toEqual([100, 0, 1700, 900]);
    expect(next.areas).toBe(plan.areas);
    expect(read(save(next, saved)).layout.viewBox).toEqual([100, 0, 1700, 900]);
  });

  it("moves everything over together past the corner, keeping places relative to each other and the report's notes", () => {
    const base = sktcLike();
    const saved = read({ ...base, layout: { ...base.layout, zones: base.layout.zones.map((zone, index) => index === 0 ? { ...zone, directionFromEntrance: "left" } : zone), boardMarkers: { "DB-E": [30, 700], "DB-F": [570, 700] } } } as StoredSpatialReference);
    const plan = planFromReference(saved);
    expect(canShift(plan)).toBe(true);
    const { plan: left } = resizeCanvasFrom(plan, "w", 1700);
    const { plan: grown, blocked } = resizeCanvasFrom(left, "n", 1000);
    expect(blocked).toBe(false);
    expect(grown.viewBox).toEqual([0, 0, 1700, 1000]);
    const after = save(grown, saved);
    // Everything moved 100 right and 100 down, together.
    expect(after.layout.rooms.map(item => item.rect)).toEqual(saved.layout.rooms.map(item => [item.rect[0] + 100, item.rect[1] + 100, item.rect[2], item.rect[3]]));
    expect(after.layout.zones.map(item => item.rect)).toEqual(saved.layout.zones.map(item => item.rect && [item.rect[0] + 100, item.rect[1] + 100, item.rect[2], item.rect[3]]));
    expect(after.layout.devices!.map(item => item.position)).toEqual(saved.layout.devices!.map(item => [item.position[0] + 100, item.position[1] + 100]));
    expect(after.layout.entrance!.position).toEqual([640, 960]);
    // The report's notes still hold: board markers moved with their areas, and the direction from the entrance stays.
    expect(after.layout.boardMarkers).toEqual({ "DB-E": [130, 800], "DB-F": [670, 800] });
    expect((after.layout.zones[0] as { directionFromEntrance?: string }).directionFromEntrance).toBe("left");
    expect(read(after)).not.toBeNull();
  });

  it("shrinks from the left by moving its corner in, never cutting anything off", () => {
    const plan = planFromReference(read(sktcLike()));
    const { plan: next } = resizeCanvasFrom(plan, "w", 100);
    // The first thing drawn is area 264E at x 20, and the plan keeps a margin of 20 before it: nothing to cut.
    expect(next).toBe(plan);
    const moved = { ...plan, viewBox: [0, 0, 1600, 900] as Rect, areas: plan.areas.map(item => ({ ...item, rect: [item.rect[0] + 200, item.rect[1], item.rect[2], item.rect[3]] as Rect })), rooms: plan.rooms.map(item => ({ ...item, rect: [item.rect[0] + 200, item.rect[1], item.rect[2], item.rect[3]] as Rect })), devices: [], entrance: null };
    expect(resizeCanvasFrom(moved, "w", 100).plan.viewBox).toEqual([200, 0, 1400, 900]);
  });

  it("only grows to the right and down when the plan holds something this version cannot move", () => {
    const saved = read({ ...sktcLike(), layout: { ...sktcLike().layout, pipes: [{ points: [[10, 10], [60, 10]], style: "water" }] } } as unknown as StoredSpatialReference);
    const plan = planFromReference(saved);
    expect(canShift(plan)).toBe(false);
    const { plan: next, blocked } = resizeCanvasFrom(plan, "w", 2000);
    expect(blocked).toBe(true);
    expect(next).toBe(plan);
    expect(JSON.stringify(save(next, saved))).toBe(JSON.stringify(saved));
  });

  it("goes up to the stored format's limit and no further", () => {
    const plan = planFromReference(read(sktcLike()));
    expect(resizeCanvas(plan, 20000, 20000).viewBox).toEqual([0, 0, MAX_COORD, MAX_COORD]);
    const offset = { ...plan, viewBox: [500, 0, 1100, 900] as Rect };
    // The right edge stays at the limit when the drawing space starts further in.
    expect(resizeCanvas(offset, 20000, 900).viewBox.slice(0, 3)).toEqual([500, 0, MAX_COORD - 500]);
    const grown = resizeCanvasFrom(plan, "w", 20000).plan;
    expect(grown.viewBox).toEqual([0, 0, MAX_COORD, 900]);
    expect(read(save(grown, read(sktcLike())))).not.toBeNull();
  });
});
