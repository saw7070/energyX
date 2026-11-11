import { describe, expect, it } from "vitest";
import { readProjectSpatialReference } from "@datafoundry/contracts";
import { freshCopy, withoutCarried } from "./floor-plan-carry";
import { asGroupIn, asOwnArea, contentExtent, hiddenZones, moveSelection, notesWithReference, planFromReference, referenceFromPlan, removeSelection, resizeCanvas, sameGeometry, settleRooms, type FloorPlan, type StoredSpatialReference } from "./floor-plan-model";
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
  it("keep their rooms filed under them until a room is moved into an area on the drawing", () => {
    expect(plan.rooms.find(item => item.name === "Roof deck")!.zone).toBe("Roof");
    expect(JSON.stringify(save(plan, reference))).toBe(JSON.stringify(reference).replace(/"status":"[^"]*"/, '"status":"Edited in Facility → Floor layout"'));
    const deck = plan.rooms.find(item => item.name === "Roof deck")!;
    // Moved somewhere no drawn area holds: still filed under the area that is not on the drawing.
    const loose = settleRooms({ ...plan, rooms: plan.rooms.map(item => item.key === deck.key ? { ...item, rect: [20, 780, 100, 60] as Rect } : item) });
    expect(save(loose, reference).layout.rooms.find(item => item.name === "Roof deck")!.zone).toBe("Roof");
    // Dragged into area 264E: it now belongs to 264E, as drawn, and moves with it.
    const dragged = settleRooms(moveSelection(plan, { kind: "room", key: deck.key }, -1140, -500));
    expect(dragged.rooms.find(item => item.key === deck.key)!.area).toBe("264E");
    expect(save(dragged, reference).layout.rooms.find(item => item.name === "Roof deck")!.zone).toBe("264E");
  });
  it("still count when checking labels, here and when areas are added from a spreadsheet", () => {
    expect(() => save({ ...plan, areas: plan.areas.map(item => item.key === "Carpark" ? { ...item, label: "Roof" } : item) }, reference)).toThrow('The label "Roof" is already used by an area under "Not on the drawing". Give this area another label.');
    const added = floorPlanWithGroupAreas(reference, ["Roof", "Hall"])!;
    expect(added.added).toEqual(["Hall"]);
    const saved = save(added.plan, reference);
    expect(saved.layout.zones.find(item => item.id === "Roof")).toEqual({ id: "Roof", referenceBoard: "DB-R", meterLocations: ["Roof PV"], note: "no drawing yet" });
  });
});

describe("areas that are not on the drawing, when the saved layout is odd", () => {
  const base = sktcLike();
  it("never fail a save because two of them share a label, which the reader could not fix", () => {
    const reference = read({ ...base, layout: { ...base.layout, zones: [...base.layout.zones, { id: "Roof", referenceBoard: "DB-R" }, { id: "Roof", referenceBoard: "DB-S" }] } });
    const plan = planFromReference(reference);
    expect(hiddenZones(plan)).toEqual([{ id: "Roof", board: "DB-R" }, { id: "Roof", board: "DB-S" }]);
    expect(save(plan, reference).layout.zones.slice(-2)).toEqual([{ id: "Roof", referenceBoard: "DB-R" }, { id: "Roof", referenceBoard: "DB-S" }]);
    expect(() => save({ ...plan, areas: plan.areas.map(item => item.key === "264E" ? { ...item, label: "Roof" } : item) }, reference)).toThrow(/already used by an area under "Not on the drawing"/);
  });

  it("hold their place on the plan, so the drawing space can never shrink below them", () => {
    // Equipment whose room is gone, with a place of its own near the bottom-right corner.
    const reference = read({ ...base, layout: { ...base.layout, zones: [...base.layout.zones, { id: "G", referenceBoard: "DB-G", rect: [1500, 820, 80, 60], independentSpace: false, physicalParentRoom: "Gone" }] } });
    const plan = planFromReference(reference);
    expect(hiddenZones(plan)).toEqual([{ id: "G", board: "DB-G" }]);
    const [width, height] = contentExtent(plan);
    expect(width).toBeGreaterThanOrEqual(1580); expect(height).toBeGreaterThanOrEqual(880);
    const smallest = resizeCanvas(plan, 300, 300);
    expect(smallest.viewBox[2]).toBeGreaterThanOrEqual(1580); expect(smallest.viewBox[3]).toBeGreaterThanOrEqual(880);
    expect(zone(save(smallest, reference), "G")).toEqual({ id: "G", referenceBoard: "DB-G", rect: [1500, 820, 80, 60], independentSpace: false, physicalParentRoom: "Gone" });
    // Untrusted rectangles are ignored rather than trusted.
    expect(contentExtent({ ...plan, carried: { zones: [{ index: 0, zone: { id: "X", rect: ["9000", 0, 1, 1] } }] } })).toEqual(contentExtent({ ...plan, carried: {} }));
  });

  it("lose their room list and their direction from the entrance once these no longer hold, like drawn areas", () => {
    const reference = read({ ...base, layout: { ...base.layout, zones: [...base.layout.zones, { id: "Roof", referenceBoard: "DB-R", rooms: ["Roof deck"], directionFromEntrance: "up", note: "kept" } as never], rooms: [...base.layout.rooms, { name: " Roof deck ", zone: "Roof", rect: [1200, 800, 100, 60] }] } });
    const plan = planFromReference(reference);
    const roof = (saved: StoredSpatialReference) => saved.layout.zones.find(item => item.id === "Roof");
    // Nothing changed: kept as saved, even though the room's name has spaces around it.
    expect(roof(save(plan, reference))).toEqual({ id: "Roof", referenceBoard: "DB-R", rooms: ["Roof deck"], directionFromEntrance: "up", note: "kept" });
    const renamed = save({ ...plan, rooms: plan.rooms.map(item => item.name.trim() === "Roof deck" ? { ...item, name: "Sky deck" } : item) }, reference);
    expect(roof(renamed)).toEqual({ id: "Roof", referenceBoard: "DB-R", directionFromEntrance: "up", note: "kept" });
    const removed = save(removeSelection(plan, { kind: "room", key: plan.rooms.find(item => item.name.trim() === "Roof deck")!.key }), reference);
    expect(roof(removed)).not.toHaveProperty("rooms");
    const entranceMoved = save(moveSelection(plan, { kind: "entrance", key: "entrance" }, 40, 0), reference);
    expect(roof(entranceMoved)).toEqual({ id: "Roof", referenceBoard: "DB-R", rooms: ["Roof deck"], note: "kept" });
    expect(roof(save(removeSelection(plan, { kind: "entrance", key: "entrance" }), reference))).not.toHaveProperty("directionFromEntrance");
  });
});

describe("what the plan cannot draw is kept as saved", () => {
  const base = sktcLike();
  const resave = (reference: StoredSpatialReference) => JSON.stringify(save(planFromReference(reference), reference));
  const asSaved = (reference: StoredSpatialReference) => JSON.stringify(reference).replace(/"status":"[^"]*"/, '"status":"Edited in Facility → Floor layout"');

  it("an entrance with no usable position, until the reader adds one of their own", () => {
    for (const entrance of [{ label: "Gate", referenceBoard: "DB-E", note: "north side" }, { label: "Gate", position: ["a", 2] }, null, "front"]) {
      const reference = read({ ...base, layout: { ...base.layout, entrance } as never });
      expect(planFromReference(reference).entrance).toBeNull();
      expect(resave(reference)).toBe(asSaved(reference));
    }
    const reference = read({ ...base, layout: { ...base.layout, entrance: { label: "Gate" } } as never });
    const plan = planFromReference(reference);
    expect(save({ ...plan, entrance: { label: "Front door", position: [100, 880] } }, reference).layout.entrance).toEqual({ label: "Front door", position: [100, 880] });
  });

  it("device entries with no meter or position, in their place, and a device list that is not a list", () => {
    const devices = [base.layout.devices![0], { meterId: "lost" }, base.layout.devices![1], { position: [1, 2] }, 7, null];
    const reference = read({ ...base, layout: { ...base.layout, devices } as never });
    const plan = planFromReference(reference);
    expect(plan.devices.map(item => item.meterId)).toEqual(["m1", "m2"]);
    expect(resave(reference)).toBe(asSaved(reference));
    const removed = save(removeSelection(plan, { kind: "device", key: "m1" }), reference);
    expect(removed.layout.devices).toEqual([base.layout.devices![1], { meterId: "lost" }, { position: [1, 2] }, 7, null]);
    const odd = read({ ...base, layout: { ...base.layout, devices: { m1: [1, 2] } } as never });
    expect(planFromReference(odd).devices).toEqual([]);
    expect(resave(odd)).toBe(asSaved(odd));
    expect(save({ ...planFromReference(odd), devices: [{ meterId: "m1", position: [100, 100] }] }, odd).layout.devices).toEqual([{ meterId: "m1", position: [100, 100] }]);
  });

  it("stand-alone areas saved with equipment keys or no panel at all, byte for byte", () => {
    const zones = [
      { id: "264E", referenceBoard: "DB-E", rect: [20, 20, 500, 700], independentSpace: true },
      { id: "264F", rect: [560, 20, 500, 700], physicalParentRoom: "264E Lobby", equipment: "Lift lobby LED" },
      { id: "Carpark", rect: [1100, 20, 480, 400] },
      ...base.layout.zones.slice(3),
      { id: "Roof" },
    ];
    const raw = { ...base, layout: { ...base.layout, zones } } as unknown as StoredSpatialReference;
    const notes = notesWithReference("Site notes.", null, raw);
    const found = readProjectSpatialReference(notes, "sktc")!;
    const reference = found.reference as StoredSpatialReference;
    const plan = planFromReference(reference);
    expect(notesWithReference(notes, found.block, save(plan, reference)).replace(/"status": "[^"]*"/, "")).toBe(notes.replace(/"status": "[^"]*"/, ""));
    // Choosing a panel for an area that had none writes it; going back to none is still read the same.
    const named = save({ ...plan, areas: plan.areas.map(item => item.key === "Carpark" ? { ...item, board: "DB-C" } : item) }, reference);
    expect(zone(named, "Carpark")).toEqual({ id: "Carpark", referenceBoard: "DB-C", rect: [1100, 20, 480, 400] });
    // Turned into equipment, what the stand-alone area said about equipment gives way to the new room.
    const lobby = plan.rooms.find(item => item.name === "264E Store")!;
    const area = plan.areas.find(item => item.key === "264F")!;
    expect(area.extra).toEqual({ physicalParentRoom: "264E Lobby", equipment: "Lift lobby LED" });
    const asGroup = { ...plan, areas: plan.areas.map(item => item.key === "264F" ? asGroupIn(item, lobby) : item), rooms: plan.rooms.filter(item => !item.name.startsWith("264F")) };
    expect(asGroup.areas.find(item => item.key === "264F")).not.toHaveProperty("extra");
    const group = zone(save(asGroup, reference), "264F");
    expect(group).toMatchObject({ independentSpace: false, physicalParentRoom: "264E Store" });
    expect(group).not.toHaveProperty("equipment");
  });
});

describe("a drag that comes back to where it started", () => {
  it("draws nothing different", () => {
    const plan = planFromReference(read(sktcLike()));
    const there = moveArea(plan, "264E", 40, 0), back = moveSelection(there, { kind: "area", key: "264E" }, -40, 0);
    expect(back).not.toBe(plan);
    expect(sameGeometry(settleRooms(back), plan)).toBe(true);
    expect(sameGeometry(there, plan)).toBe(false);
  });
});
