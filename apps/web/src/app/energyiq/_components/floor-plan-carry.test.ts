import { describe, expect, it } from "vitest";
import { readProjectSpatialReference } from "@datafoundry/contracts";
import { freshCopy, withoutCarried } from "./floor-plan-carry";
import { asGroupIn, asOwnArea, hiddenZones, moveSelection, notesWithReference, planFromReference, referenceFromPlan, removeSelection, type FloorPlan, type StoredSpatialReference } from "./floor-plan-model";
import { floorPlanWithGroupAreas } from "./spreadsheet-arrange-model";

type Rect = [number, number, number, number];
/** A layout as the editor saved it before this change: an estate with five areas (one is equipment), 14 rooms, 19 devices and an entrance. */
function sktcLike(): StoredSpatialReference {
  const room = (name: string, zone: string, rect: Rect, colour?: string) => ({ name, zone, rect, ...(colour ? { colour } : {}) });
  const rooms = [
    ...["Lobby", "Store", "Bin centre", "Lift motor room", "Corridors L1-L17"].map((name, index) => room(`264E ${name}`, "264E", [40 + (index % 2) * 240, 80 + Math.floor(index / 2) * 200, 220, 160])),
    ...["Lobby", "Store", "Bin centre", "Lift motor room", "Corridors L1-L17"].map((name, index) => room(`264F ${name}`, "264F", [580 + (index % 2) * 240, 80 + Math.floor(index / 2) * 200, 220, 160], index === 1 ? "#e87ba4" : undefined)),
    room("Drive-in", "Carpark", [1120, 80, 200, 300]), room("Lots", "Carpark", [1340, 80, 220, 300]),
    room("Play area", "Playground", [1120, 520, 200, 220]), room("Fitness corner", "Playground", [1340, 520, 220, 220]),
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

/** A layout written by hand before the editor existed: report-only keys, unknown keys, its own key order, and equipment placed from its room alone. */
const handWritten = {
  schemaVersion: 1, projectId: "tuya-office",
  provenance: { file: "Tuya_Office_Energy_Report.html", sha256: "9d57", section: "1. Property profile", status: "reference-derived; not survey-confirmed" },
  property: { address: "6 Battery Road, Singapore", level: 27 },
  layout: {
    kind: "illustrative schematic", notToScale: true, northOrientation: null,
    viewBox: [0, 0, 860, 508],
    entrance: { label: "Main entrance gate", referenceBoard: "DB1", position: [430, 420] },
    zones: [
      { id: "A", referenceBoard: "DB1", directionFromEntrance: "right", rooms: ["Open office", "Director room"], rect: [470, 20, 366, 396] },
      { id: "B", referenceBoard: "DB2", directionFromEntrance: "left", rooms: ["Showroom", "Pantry"], rect: [24, 20, 366, 396] },
      { id: "C", referenceBoard: "DB3", kind: "LED reporting subgroup", physicalParentRoom: "Showroom", independentSpace: false, equipment: "Three large LED panels" },
    ],
    rooms: [
      { name: "Showroom", zone: "B", rect: [32, 70, 210, 150] }, { name: "Pantry", zone: "B", rect: [250, 70, 132, 70] },
      { name: "Open office", zone: "A", rect: [478, 70, 166, 240] }, { name: "Director room", zone: "A", rect: [652, 218, 176, 92] },
    ],
    boardMarkers: { DB1: [478, 330], DB2: [86, 238], DB3: [32, 238] },
  },
  usageRules: ["Coordinates are SVG drawing units."],
} as unknown as StoredSpatialReference;

const read = (reference: StoredSpatialReference) => readProjectSpatialReference("```json\n" + JSON.stringify(reference) + "\n```", reference.projectId)!.reference as StoredSpatialReference;
const save = (plan: FloorPlan, previous: StoredSpatialReference) => referenceFromPlan(plan, previous.projectId, previous);
const zone = (reference: StoredSpatialReference, id: string) => reference.layout.zones.find(item => item.id === id) as Record<string, unknown>;
const moveArea = (plan: FloorPlan, key: string, dx: number, dy: number) => moveSelection(plan, { kind: "area", key }, dx, dy);

describe("layouts saved before this change", () => {
  it("re-save byte for byte: an estate with 5 areas, 14 rooms, 19 devices and an entrance", () => {
    const notes = notesWithReference("Site notes: SKTC estate.", null, sktcLike());
    const found = readProjectSpatialReference(notes, "sktc")!;
    const plan = planFromReference(found.reference as StoredSpatialReference);
    expect([plan.areas.length, plan.rooms.length, plan.devices.length, !!plan.entrance]).toEqual([5, 14, 19, true]);
    // Nothing is carried for a layout the editor wrote: no new fields at all.
    expect(plan.carried).toBeUndefined(); expect(plan.extra).toBeUndefined();
    expect([...plan.areas, ...plan.rooms, ...plan.devices].some(item => "extra" in item || "order" in item || "saved" in item)).toBe(false);
    expect(notesWithReference(notes, found.block, save(plan, found.reference as StoredSpatialReference))).toBe(notes);
  });

  it("re-save a hand-written layout exactly, apart from the note that it was edited here", () => {
    const reference = read(handWritten);
    const saved = save(planFromReference(reference), reference);
    expect(JSON.stringify(saved)).toBe(JSON.stringify({ ...handWritten, provenance: { ...handWritten.provenance, status: "Edited in Facility → Floor layout" } }));
  });
});

describe("keys the editor does not know", () => {
  const withUnknown = (): StoredSpatialReference => {
    const base = sktcLike();
    return { ...base, layout: { ...base.layout, levels: [{ id: "L1" }], zones: base.layout.zones.map((item, index) => index === 0 ? { ...item, futureShape: { points: [[1, 2]] } } : item), rooms: base.layout.rooms.map((item, index) => index === 0 ? { ...item, id: "r-1", openings: [{ wall: "s" }] } : item), devices: base.layout.devices!.map((item, index) => index === 0 ? { ...item, rotation: 45 } : item), entrance: { ...base.layout.entrance!, rotation: 90 } } as StoredSpatialReference["layout"] };
  };
  it("survive a save, and edits to the items that hold them", () => {
    const reference = read(withUnknown());
    const plan = planFromReference(reference);
    const edited: FloorPlan = { ...moveArea(plan, "264E", 0, 10), rooms: plan.rooms.map((item, index) => index === 0 ? { ...item, name: "264E Main lobby", rect: [item.rect[0], item.rect[1] + 10, item.rect[2], item.rect[3]] } : item) };
    const saved = save(edited, reference) as unknown as { layout: Record<string, unknown> & { zones: Array<Record<string, unknown>>; rooms: Array<Record<string, unknown>>; devices: Array<Record<string, unknown>>; entrance: Record<string, unknown> } };
    expect(saved.layout.levels).toEqual([{ id: "L1" }]);
    expect(saved.layout.zones[0]!.futureShape).toEqual({ points: [[1, 2]] });
    expect(saved.layout.rooms[0]).toMatchObject({ name: "264E Main lobby", id: "r-1", openings: [{ wall: "s" }] });
    expect(saved.layout.devices[0]!.rotation).toBe(45);
    expect(saved.layout.entrance.rotation).toBe(90);
  });
  it("are checked where the editor reads them: a label that is not text falls back to the usual one", () => {
    const base = sktcLike();
    const odd = { ...base, layout: { ...base.layout, entrance: { label: 42, position: [540, 860] } } } as unknown as StoredSpatialReference;
    expect(save(planFromReference(read(odd)), odd).layout.entrance?.label).toBe("Entrance");
  });
  it("never replace what the editor itself writes", () => {
    const reference = read(withUnknown());
    const plan = planFromReference(reference);
    const forged: FloorPlan = { ...plan, rooms: plan.rooms.map((item, index) => index === 0 ? { ...item, extra: { ...item.extra, name: "forged" } } : item) };
    expect(save(forged, reference).layout.rooms[0]!.name).toBe("264E Lobby");
  });
  it("are not copied onto a duplicate, which also leaves the meter locations behind", () => {
    const area = { key: "a", label: "A", board: "DB1", rect: [0, 0, 50, 50] as Rect, meterLocations: ["DB1 Area"], extra: { directionFromEntrance: "left", kind: "x" }, order: ["id"], saved: { rect: [0, 0, 50, 50] as Rect, rooms: [] } };
    expect(freshCopy(area)).toEqual({ key: "a", label: "A", board: "DB1", rect: [0, 0, 50, 50] });
    expect(withoutCarried(area, ["kind"]).extra).toEqual({ directionFromEntrance: "left" });
    expect(withoutCarried({ ...area, extra: { kind: "x" } }, ["kind"])).not.toHaveProperty("extra");
  });
});

describe("keys the report reads, kept only while they still hold", () => {
  const reference = read(handWritten);
  const plan = planFromReference(reference);

  it("a zone's own room list: kept while its rooms are the same, even when the area is relabelled", () => {
    const relabelled = save({ ...plan, areas: plan.areas.map(item => item.key === "A" ? { ...item, label: "North" } : item) }, reference);
    expect(zone(relabelled, "North").rooms).toEqual(["Open office", "Director room"]);
    const renamed = save({ ...plan, rooms: plan.rooms.map(item => item.name === "Pantry" ? { ...item, name: "Kitchen" } : item) }, reference);
    expect(zone(renamed, "B")).not.toHaveProperty("rooms");
    expect(zone(renamed, "A").rooms).toEqual(["Open office", "Director room"]);
    const removed = save(removeSelection(plan, { kind: "room", key: plan.rooms.find(item => item.name === "Director room")!.key }), reference);
    expect(zone(removed, "A")).not.toHaveProperty("rooms");
    const added = save({ ...plan, rooms: [...plan.rooms, { key: "new", name: "Store", rect: [500, 330, 60, 60], area: "A" }] }, reference);
    expect(zone(added, "A")).not.toHaveProperty("rooms");
  });

  it("directions from the entrance: kept while neither the entrance nor the area moved", () => {
    expect(zone(save(plan, reference), "A").directionFromEntrance).toBe("right");
    const entranceMoved = save(moveSelection(plan, { kind: "entrance", key: "entrance" }, 40, 0), reference);
    expect(zone(entranceMoved, "A")).not.toHaveProperty("directionFromEntrance");
    expect(zone(entranceMoved, "B")).not.toHaveProperty("directionFromEntrance");
    expect(zone(save(removeSelection(plan, { kind: "entrance", key: "entrance" }), reference), "A")).not.toHaveProperty("directionFromEntrance");
    const areaMoved = save(moveArea(plan, "A", 0, 20), reference);
    expect(zone(areaMoved, "A")).not.toHaveProperty("directionFromEntrance");
    expect(zone(areaMoved, "B").directionFromEntrance).toBe("left");
  });

  it("board markers: kept for boards still on the plan whose areas did not move", () => {
    const moved = save(moveArea(plan, "A", 0, 20), reference).layout.boardMarkers;
    expect(moved).toEqual({ DB2: [86, 238], DB3: [32, 238] });
    const gone = save(removeSelection(plan, { kind: "area", key: "C" }), reference);
    expect(gone.layout.boardMarkers).toEqual({ DB1: [478, 330], DB2: [86, 238] });
    const renamedBoard = save({ ...plan, areas: plan.areas.map(item => item.key === "B" ? { ...item, board: "DB9" } : item) }, reference);
    expect(renamedBoard.layout.boardMarkers).toEqual({ DB1: [478, 330], DB3: [32, 238] });
  });

  it("the entrance's board: kept while that board is still on the plan", () => {
    expect(save(plan, reference).layout.entrance?.referenceBoard).toBe("DB1");
    const withoutDb1 = save({ ...plan, areas: plan.areas.map(item => item.key === "A" ? { ...item, board: "" } : item) }, reference);
    expect(withoutDb1.layout.entrance).toEqual({ label: "Main entrance gate", position: [430, 420] });
  });

  it("a zone's kind stays through edits, and is dropped when the area changes between equipment and its own area", () => {
    expect(zone(save(moveArea(plan, "B", 0, 10), reference), "C").kind).toBe("LED reporting subgroup");
    const own = { ...plan, areas: plan.areas.map(item => item.key === "C" ? asOwnArea(item) : item) };
    expect(zone(save(own, reference), "C")).not.toHaveProperty("kind");
    const showroom = plan.rooms.find(item => item.name === "Showroom")!;
    const group = { ...plan, areas: plan.areas.map(item => item.key === "A" ? asGroupIn(item, showroom) : item) };
    const room = plan.rooms.find(item => item.name === "Open office")!;
    const asGroup = save({ ...group, rooms: plan.rooms.filter(item => item.area !== "A").concat([{ ...room, rect: [60, 300, 100, 80] }, { ...plan.rooms.find(item => item.name === "Director room")!, rect: [200, 300, 100, 80] }]) }, reference);
    expect(zone(asGroup, "A")).not.toHaveProperty("directionFromEntrance");
    expect(zone(asGroup, "A")).not.toHaveProperty("rooms");
  });

  it("equipment placed from its room alone stays that way until it is moved", () => {
    expect(zone(save(plan, reference), "C")).not.toHaveProperty("rect");
    const roomMoved = save(moveSelection(plan, { kind: "room", key: plan.rooms.find(item => item.name === "Showroom")!.key }, 0, 10), reference);
    expect(zone(roomMoved, "C").rect).toHaveLength(4);
    // Turned into its own area, it needs a place of its own.
    expect(zone(save(removeSelection(plan, { kind: "room", key: plan.rooms.find(item => item.name === "Showroom")!.key }), reference), "C").rect).toHaveLength(4);
  });
});

describe("areas that are not on the drawing", () => {
  const base = sktcLike();
  const reference = read({ ...base, layout: { ...base.layout, zones: [base.layout.zones[0]!, { id: "Roof", referenceBoard: "DB-R", meterLocations: ["Roof PV"], note: "no drawing yet" } as never, ...base.layout.zones.slice(1)], rooms: [...base.layout.rooms, { name: "Roof deck", zone: "Roof", rect: [1200, 800, 100, 60] }] } });
  const plan = planFromReference(reference);

  it("are kept exactly as saved, in their place, and listed for the reader", () => {
    expect(plan.areas.map(item => item.label)).not.toContain("Roof");
    expect(hiddenZones(plan)).toEqual([{ id: "Roof", board: "DB-R" }]);
    const saved = save(moveArea(plan, "264F", 0, 10), reference);
    expect(saved.layout.zones[1]).toEqual({ id: "Roof", referenceBoard: "DB-R", meterLocations: ["Roof PV"], note: "no drawing yet" });
    expect(saved.layout.zones.map(item => item.id)).toEqual(["264E", "Roof", "264F", "Carpark", "Playground", "LED"]);
  });
  it("keep their rooms filed under them, wherever the room is drawn", () => {
    expect(plan.rooms.find(item => item.name === "Roof deck")!.zone).toBe("Roof");
    const dragged = { ...plan, rooms: plan.rooms.map(item => item.name === "Roof deck" ? { ...item, rect: [60, 300, 100, 60] as Rect } : item) };
    expect(save(dragged, reference).layout.rooms.find(item => item.name === "Roof deck")!.zone).toBe("Roof");
    expect(JSON.stringify(save(plan, reference))).toBe(JSON.stringify(reference).replace(/"status":"[^"]*"/, '"status":"Edited in Facility → Floor layout"'));
  });
  it("still count when checking labels, here and when areas are added from a spreadsheet", () => {
    expect(() => save({ ...plan, areas: plan.areas.map(item => item.key === "Carpark" ? { ...item, label: "Roof" } : item) }, reference)).toThrow('Two areas are labelled "Roof".');
    const added = floorPlanWithGroupAreas(reference, ["Roof", "Hall"])!;
    expect(added.added).toEqual(["Hall"]);
    const saved = save(added.plan, reference);
    expect(saved.layout.zones.find(item => item.id === "Roof")).toEqual({ id: "Roof", referenceBoard: "DB-R", meterLocations: ["Roof PV"], note: "no drawing yet" });
  });
});
