import { lineWidth, spatialLines, type SpatialLine, type SpatialOpening } from "./project-spatial-drawing.js";

/** Project-owned reference geometry. It never establishes electrical aggregation. */
export type SpatialRect = [number, number, number, number];
export interface ProjectSpatialReference {
  schemaVersion: 1;
  projectId: string;
  provenance: { file: string; status: string };
  layout: {
    viewBox: SpatialRect;
    /** `autoDoor: false` leaves out the door drawn for a room automatically (see project-spatial-drawing). */
    rooms: Array<{ name: string; zone: string; rect: SpatialRect; id?: string; autoDoor?: false }>;
    /**
     * `referenceBoard` is the panel an electrician looks for on the plan, or ""
     * when none is named: the plan is a drawing only, so a panel is optional.
     * `meterLocations` is where the meters that feed this zone are filed, for
     * sites that file them by area rather than by panel. Naming both lets the
     * plan keep the panel label while still matching the meters, so renaming
     * one does not quietly empty the zone.
     */
    zones: Array<{ id: string; referenceBoard: string; meterLocations?: string[]; rect?: SpatialRect; independentSpace?: boolean; physicalParentRoom?: string; equipment?: string }>;
    /** Drawing only, optional and untrusted: read them through spatialOpenings and spatialLines. */
    openings?: SpatialOpening[];
    lines?: SpatialLine[];
  };
}
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 300;
/** A panel name, or "" (or missing, read as "") when the area names no panel. */
const board = (v: unknown) => v === undefined || v === "" || text(v);
const rect = (v: unknown): v is SpatialRect => Array.isArray(v) && v.length === 4 && v.every(n => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 10000) && v[2] > 0 && v[3] > 0;

/** Reuse the existing reference block in project notes; malformed or foreign blocks stay visible as notes. */
export function readProjectSpatialReference(notes: string, projectId: string): { reference: ProjectSpatialReference; block: string } | null {
  for (const match of notes.matchAll(/```json\s*\n([\s\S]*?)\n```/g)) {
    try {
      const v = JSON.parse(match[1]!);
      if (v.schemaVersion !== 1 || v.projectId !== projectId || !text(v.provenance?.file) || !text(v.provenance?.status) || !rect(v.layout?.viewBox)) continue;
      const { rooms, zones } = v.layout;
      if (!Array.isArray(rooms) || !rooms.length || rooms.length > 200 || !Array.isArray(zones) || !zones.length || zones.length > 100) continue;
      if (!zones.every(z => text(z.id) && board(z.referenceBoard) && (z.meterLocations === undefined || (Array.isArray(z.meterLocations) && z.meterLocations.length > 0 && z.meterLocations.length <= 50 && z.meterLocations.every(text))) && (z.rect === undefined || rect(z.rect)) && (z.independentSpace === undefined || typeof z.independentSpace === "boolean") && (z.physicalParentRoom === undefined || text(z.physicalParentRoom)) && (z.equipment === undefined || text(z.equipment)))) continue;
      if (!rooms.every(r => text(r.name) && text(r.zone) && rect(r.rect) && zones.some(z => z.id === r.zone))) continue;
      const [vx, vy, vw, vh] = v.layout.viewBox;
      if ([...rooms, ...zones.filter(z => z.rect)].some(r => r.rect[0] < vx || r.rect[1] < vy || r.rect[0] + r.rect[2] > vx + vw || r.rect[1] + r.rect[3] > vy + vh)) continue;
      for (const z of zones) if (z.referenceBoard === undefined) z.referenceBoard = "";
      return { reference: v, block: match[0] };
    } catch { /* Other project notes may contain unrelated JSON. */ }
  }
  return null;
}

const xml = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
export function renderProjectSpatialSvg(ref: ProjectSpatialReference): string {
  const [x, y, w, h] = ref.layout.viewBox;
  const label = (s: string, px: number, py: number, size = 13) => `<text x="${px}" y="${py}" text-anchor="middle" font-family="Arial,sans-serif" font-size="${size}" fill="#203b42">${xml(s)}</text>`;
  const box = (r: SpatialRect, fill: string) => `<rect x="${r[0]}" y="${r[1]}" width="${r[2]}" height="${r[3]}" rx="5" fill="${fill}" stroke="#a0b3b4"/>`;
  const zones = ref.layout.zones.filter(z => z.rect && z.independentSpace !== false).map(z => box(z.rect!, "#edf3f1") + label([z.referenceBoard, `Area ${z.id}`].filter(Boolean).join(" · "), z.rect![0] + z.rect![2] / 2, z.rect![1] + 25, 17)).join("");
  const rooms = ref.layout.rooms.map(r => {
    const [rx, ry, rw, rh] = r.rect;
    const words = r.name.split(/\s+/); const lines: string[] = []; let line = "";
    for (const word of words) { if (line && (line + " " + word).length > Math.max(9, Math.floor(rw / 7))) { lines.push(line); line = word; } else line += (line ? " " : "") + word; } if (line) lines.push(line);
    const subgroup = ref.layout.zones.filter(z => z.independentSpace === false && z.physicalParentRoom === r.name);
    return box(r.rect, "#ffffff") + lines.map((s, i) => label(s, rx + rw / 2, ry + rh / 2 + (i - (lines.length - 1) / 2) * 17)).join("") + subgroup.map((z, i) => label([z.referenceBoard, "subgroup"].filter(Boolean).join(" · "), rx + rw / 2, ry + rh - 13 - i * 16, 11)).join("");
  }).join("");
  // Walls, fences and road edges drawn on the layout, as plain lines (fences dashed).
  const lines = spatialLines(ref.layout).map(line => `<polyline points="${line.points.map(point => point.join(",")).join(" ")}" fill="none" stroke="${line.style === "partition" ? "#7d8f90" : "#203b42"}" stroke-width="${+(lineWidth(line.style, line.thickness) * w / 100).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"${line.style === "fence" ? ` stroke-dasharray="${+(w / 100).toFixed(2)} ${+(w / 160).toFixed(2)}"` : ""}/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" role="img" aria-label="Project spatial reference"><title>Spaces and meter distribution</title><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="white"/>${zones}${rooms}${lines}${label("Illustrative schematic · not to scale · reference-derived", x + w / 2, y + h - 16, 12)}</svg>`;
}
