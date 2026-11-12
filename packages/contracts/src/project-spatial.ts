/** Project-owned reference geometry. It never establishes electrical aggregation. */
export type SpatialRect = [number, number, number, number];
export interface ProjectSpatialReference {
  schemaVersion: 1;
  projectId: string;
  provenance: { file: string; status: string };
  layout: {
    viewBox: SpatialRect;
    rooms: Array<{ name: string; zone: string; rect: SpatialRect; level?: string; displayName?: string }>;
    /**
     * `referenceBoard` is the panel an electrician looks for on the plan, or ""
     * when none is named: the plan is a drawing only, so a panel is optional.
     * `meterLocations` is where the meters that feed this zone are filed, for
     * sites that file them by area rather than by panel. Naming both lets the
     * plan keep the panel label while still matching the meters, so renaming
     * one does not quietly empty the zone.
     */
    zones: Array<{ id: string; referenceBoard: string; meterLocations?: string[]; rect?: SpatialRect; independentSpace?: boolean; physicalParentRoom?: string; equipment?: string; level?: string }>;
  };
}
/**
 * Optional floors, saved as `layout.levels: SpatialLevel[]` (read with `spatialLevels`, since saved layouts are
 * untrusted). Missing means one floor (every layout saved before floors existed). Each zone, room, device and the
 * entrance may name its floor with `level` (a level id); missing means the first floor. A room may carry `displayName`,
 * the short name shown, while its `name` stays unique across the whole layout (e.g. "Store (2)"). Readers that know
 * nothing of floors draw every floor on one sheet, overlaid. `layout.layers.hidden` lists layers hidden on the shared
 * (read-only) map, e.g. ["devices"].
 */
export type SpatialLevel = { id: string; name: string };
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

/** A floor id: short letters, digits, - and _. */
export const SPATIAL_LEVEL_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Most floors a layout can hold. */
export const MAX_SPATIAL_LEVELS = 50;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
/**
 * The layout's floors, or null when it has none it can use (missing, or anything malformed: then every item reads as
 * being on one floor, exactly as before floors existed). Saved layouts are untrusted: ids must be well formed and
 * unique, and names short text.
 */
export function spatialLevels(layout: unknown): SpatialLevel[] | null {
  const raw = isObject(layout) ? layout.levels : undefined;
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_SPATIAL_LEVELS) return null;
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isObject(item) || typeof item.id !== "string" || !SPATIAL_LEVEL_ID.test(item.id) || seen.has(item.id) || !text(item.name) || item.name.trim().length === 0 || item.name.length > 120) return null;
    seen.add(item.id);
  }
  return raw.map(item => ({ id: item.id as string, name: (item.name as string).trim() }));
}
/** The floor an item is on: the one it names when that floor exists, else the first. */
export const spatialLevelOf = (item: unknown, levels: SpatialLevel[]): string => { const value = isObject(item) ? item.level : undefined; return typeof value === "string" && levels.some(level => level.id === value) ? value : levels[0]!.id; };
/**
 * The floor a zone is on. Equipment inside a room (independentSpace false) is always on its room's floor, whatever its own
 * `level` says (the editor works the same way), so it is never split from the room it sits in.
 */
export const spatialZoneLevel = (zone: { independentSpace?: boolean; physicalParentRoom?: string; level?: string }, layout: { rooms: Array<{ name: string; level?: string }> }, levels: SpatialLevel[]): string =>
  spatialLevelOf(zone.independentSpace === false ? layout.rooms.find(room => room.name === zone.physicalParentRoom) ?? zone : zone, levels);
/** Layers the shared map (and the report) can hide, as saved in `layout.layers.hidden`. */
export const SPATIAL_LAYERS = ["areas", "rooms", "equipment", "devices", "labels", "symbols", "lines", "shapes"] as const;
/** The layers hidden for everyone who views the plan. Saved layouts are untrusted: only known layer names count. */
export function spatialHiddenLayers(layout: unknown): Set<typeof SPATIAL_LAYERS[number]> {
  const layers = isObject(layout) ? layout.layers : undefined, hidden = isObject(layers) ? layers.hidden : undefined;
  return new Set(Array.isArray(hidden) ? hidden.filter((item): item is typeof SPATIAL_LAYERS[number] => (SPATIAL_LAYERS as readonly unknown[]).includes(item)) : []);
}
/** A room's name as shown: its short `displayName` when it has a usable one, else its name. */
export const spatialRoomTitle = (room: { name: string; displayName?: unknown }): string => typeof room.displayName === "string" && room.displayName.trim() && room.displayName.length <= 120 ? room.displayName.trim() : room.name;
/**
 * The layout as one floor sees it: only that floor's zones, rooms, devices and entrance. Board markers stay only for
 * boards with an area on that floor. A layout with fewer than two floors is returned unchanged.
 */
export function spatialLevelReference<T extends ProjectSpatialReference>(reference: T, level: string): T {
  const levels = spatialLevels(reference.layout);
  if (!levels || levels.length < 2) return reference;
  const on = (item: unknown) => spatialLevelOf(item, levels) === level;
  const layout = reference.layout as T["layout"] & { devices?: unknown; entrance?: unknown; boardMarkers?: unknown };
  const zones = layout.zones.filter(zone => spatialZoneLevel(zone, layout, levels) === level), boards = new Set(zones.map(zone => zone.referenceBoard).filter(Boolean));
  const next: Record<string, unknown> = { ...layout, zones, rooms: layout.rooms.filter(on) };
  if (Array.isArray(layout.devices)) next.devices = layout.devices.filter(on);
  if (layout.entrance !== undefined && !on(layout.entrance)) delete next.entrance;
  if (isObject(layout.boardMarkers)) next.boardMarkers = Object.fromEntries(Object.entries(layout.boardMarkers).filter(([board]) => boards.has(board)));
  return { ...reference, layout: next as T["layout"] };
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
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} ${w} ${h}" role="img" aria-label="Project spatial reference"><title>Spaces and meter distribution</title><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="white"/>${zones}${rooms}${label("Illustrative schematic · not to scale · reference-derived", x + w / 2, y + h - 16, 12)}</svg>`;
}
