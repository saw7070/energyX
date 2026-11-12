import type { StoredSpatialReference } from "./floor-plan-model";

type Rect = [number, number, number, number];
/** A layout as the editor saved it before doors and walls: an estate with five areas (one is equipment), 14 rooms, 19 devices and an entrance. */
export function sktcLike(): StoredSpatialReference {
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
