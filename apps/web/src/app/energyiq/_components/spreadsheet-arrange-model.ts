/**
 * Arranging a site's groups from the installer's spreadsheet: one row per meter, saying which group it belongs in and,
 * optionally, its short name and how many lights it feeds. Everything here runs in the browser on the file the person chose; the result is an
 * ordinary edit of the setup draft, made with the same group and meter edits as the Groups editor.
 *
 * Nothing in the file is sent anywhere. A device ID column is recognised only so it is never mistaken for a name, and
 * so notes typed below the meters are left out.
 */
import type { EnergyMeterMappingRowDto, EnergyProjectSetupDocumentDto } from "../../../lib/config-api";
import { addGroup, metersInGroup, moveMetersToGroup, removeGroup } from "./meter-groups-editing";
import { applyMeterEdit } from "./site-structure-editing";
import { projectMeterFullName } from "./project-meter-name";
import { decodeXmlText } from "./live-device-list";
import { DEFAULT_VIEWBOX, MAX_COORD, MAX_PLAN_SIZE, contentExtent, hiddenZones, planFromReference, starterPlan, type FloorPlan, type PlanArea, type StoredSpatialReference } from "./floor-plan-model";
import type { EnergyIqLocale } from "./energyiq-messages";

/** What a column holds. Several columns may be groups (read left to right); the others are used once each. */
export type ColumnRole = "ignore" | "group" | "device" | "meter" | "short" | "lights";
export type SheetColumn = { index: number; header: string; sample: string; role: ColumnRole; idColumn: boolean };
export type SheetLayout = { headerRow: number; columns: SheetColumn[] };
/** One meter row of the file. `row` is its row number in the sheet, from 1. */
/** `lights` is the number-of-lights cell as written; it is checked only when the change is worked out. */
export type ArrangeRow = { row: number; path: string[]; meterName: string; deviceName: string; shortName: string; lights: string };
export type MatchConfidence = "exact" | "close" | "guess";
export type RowMatch = { meterId: string | null; confidence: MatchConfidence | "picked" | null; score: number };

/** Splits "Common area > Pavilion" into a group inside a group. */
const PATH_SEPARATOR = /\s*(?:>|›|»|→)\s*/u;
/** More rows than any one site has meters; a bigger file is very likely the wrong one. */
export const ARRANGE_MAX_ROWS = 1000;
/** Short names are kept short, like the meter form's limit. */
const SHORT_NAME_MAX = 60;
/** The most light points one meter can be said to feed, as in the meter form. */
const LIGHTS_MAX = 9999;
/** "12", "12 nos", "12 pcs", "12 lights", "12盏" or "12 biji": the count, with a unit word installers often add. */
const LIGHTS_CELL = /^(\d{1,5})(?:\.0+)?\s*(?:nos?\.?|pcs?\.?|pieces?|units?|lights?|lamps?|fittings?|points?|盏|个|只|套|biji|unit|buah|lampu)?$/iu;

/**
 * A number-of-lights cell: undefined when empty or "-" (nothing to change), the count when it is a whole number from 1
 * to 9999, and null when it is something else ("about 10", "0", "2.5"), so the meter's own count is left alone.
 */
export function parseLights(text: string): number | undefined | null {
  const value = cleanText(text);
  if (!value || /^[-–—]$/u.test(value)) return undefined;
  const match = LIGHTS_CELL.exec(value);
  if (!match) return null;
  const count = Number(match[1]);
  return count >= 1 && count <= LIGHTS_MAX ? count : null;
}

const cleanText = (value: string) => value.normalize("NFKC").replace(/\s+/gu, " ").trim();
/** Same name, ignoring case and spacing. */
const key = (value: string) => cleanText(value).toLocaleLowerCase();
/** Same words, ignoring punctuation and "&" against "and". */
const loose = (value: string) => key(value).replace(/&/gu, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// ---------------------------------------------------------------------------------------------------------------
// Reading the file

/** Cells from an Excel sheet as text. read-excel-file leaves "&" as "&amp;", so Excel text is decoded once. */
export function sheetFromCells(rows: ReadonlyArray<ReadonlyArray<unknown>>, options: { decodeXml?: boolean } = {}): string[][] {
  return rows.map(row => row.map(cell => cell === null || cell === undefined ? ""
    : cell instanceof Date ? cell.toISOString().slice(0, 10)
    : cleanText(typeof cell === "string" && options.decodeXml ? decodeXmlText(cell) : String(cell))));
}

/** A CSV or tab-separated file as rows of cells. Quoted cells may hold commas, quotes and line breaks. */
export function parseDelimitedText(text: string): string[][] {
  const body = text.replace(/^﻿/u, "");
  const firstLine = body.split(/\r?\n/u).find(line => line.trim()) ?? "";
  const delimiter = firstLine.includes("\t") ? "\t" : (firstLine.match(/;/gu)?.length ?? 0) > (firstLine.match(/,/gu)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]!;
    if (quoted) {
      if (char === '"' && body[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && !cell.trim()) { cell = ""; quoted = true; }
    else if (char === delimiter) { row.push(cell); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && body[index + 1] === "\n") index += 1;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.map(cells => cells.map(cleanText));
}

const HEADER_ROLES: Array<[Exclude<ColumnRole, "ignore">, RegExp]> = [
  ["lights", /^(?:(?:no\.?|nos\.?|number|num|count|qty|quantity|total)\s*(?:of\s*)?(?:lights?|lamps?|light\s*points?|lighting\s*points?|fittings?|light\s*fittings?|luminaires?)|(?:lights?|lamps?|light\s*points?|fittings?|light\s*fittings?|luminaires?)\s*(?:count|qty|quantity|no\.?|nos\.?|number|total)?|灯(?:的|具)?(?:数量|数|盏数)|灯具|bilangan\s*(?:mata\s*)?lampu|jumlah\s*lampu)$/iu],
  ["short", /^(?:short(?:\s*(?:name|label))?|nick\s*name|alias|friendly\s*name|display\s*name|简称|短名称|显示名称|nama\s*(?:pendek|ringkas|paparan))$/iu],
  ["device", /^(?:tuya(?:\s*device)?(?:\s*name)?|device(?:\s*name)?|设备(?:名称)?|涂鸦设备(?:名称)?|nama\s*peranti|peranti)$/iu],
  ["meter", /^(?:meter(?:\s*(?:name|label))?|name|label|circuit(?:\s*name)?|load\s*name|电表(?:名称)?|名称|回路(?:名称)?|nama(?:\s*meter)?|meter\s*nama)$/iu],
  ["group", /^(?:(?:sub[\s-]*)*group(?:s|\s*(?:path|name|\d+))?|parent\s*group|group\s*level\s*\d+|level\s*\d+|path|block(?:\s*(?:number|no\.?|#|name))?|blk|building|tower|wing|area|zone|floor|level|storey|location|section|分组(?:路径|名称)?|子分组|组|楼栋|楼座|大楼|区域|楼层|位置|(?:sub[\s-]*)?kumpulan(?:\s*\d+)?|laluan\s*kumpulan|blok|bangunan|kawasan|zon|tingkat|aras|lokasi)$/iu],
];
const ID_HEADER = /(?:^|\s)(?:id|device\s*id|设备\s*id)$|^id\s*peranti$/iu;
/** A Tuya device ID: 16+ letters and digits with both in it (meter names rarely qualify). */
const looksLikeDeviceId = (value: string) => /^[A-Za-z0-9]{16,64}$/u.test(value) && /\d/u.test(value) && /[A-Za-z]/u.test(value);

/** The role a heading names, or "ignore". Trailing colons, stars and "(optional)" are left out. */
export function headerRole(header: string): ColumnRole {
  const text = cleanText(header).replace(/\((?:optional|可选|pilihan)\)/giu, "").replace(/[:：*]+$/u, "").trim();
  if (!text || ID_HEADER.test(text)) return "ignore";
  return HEADER_ROLES.find(([, pattern]) => pattern.test(text))?.[0] ?? "ignore";
}

/** The sheet's own letter for a column: A, B, … Z, AA. */
export const columnLetter = (index: number): string => (index >= 26 ? columnLetter(Math.floor(index / 26) - 1) : "") + String.fromCharCode(65 + (index % 26));

/**
 * Finds the heading row (titles above it are skipped) and what each column holds. When no column is named for the
 * meters, the column whose text matches the most of the site's meter names is taken as the meter name.
 */
export function detectLayout(cells: string[][], meters: EnergyMeterMappingRowDto[] = []): SheetLayout | null {
  const filled = (row: string[] | undefined) => (row ?? []).filter(Boolean).length;
  let headerRow = -1;
  for (let index = 0, seen = 0; index < cells.length && seen < 20; index += 1) {
    if (!filled(cells[index])) continue;
    seen += 1;
    const roles = cells[index]!.map(headerRole).filter(role => role !== "ignore");
    if (roles.length >= 2 || roles.some(role => role !== "group")) { headerRow = index; break; }
  }
  if (headerRow < 0) headerRow = cells.findIndex(row => filled(row) >= 2);
  if (headerRow < 0) headerRow = cells.findIndex(row => filled(row) >= 1);
  if (headerRow < 0) return null;
  const headers = cells[headerRow]!;
  const data = cells.slice(headerRow + 1);
  const width = Math.max(headers.length, ...data.map(row => row.length));
  const used = new Set<ColumnRole>();
  const columns: SheetColumn[] = [];
  for (let index = 0; index < width; index += 1) {
    const header = headers[index] ?? "";
    const values = data.map(row => row[index] ?? "").filter(Boolean);
    if (!header && !values.length) continue;
    const idColumn = ID_HEADER.test(header) || (values.length > 0 && values.filter(looksLikeDeviceId).length / values.length >= 0.6);
    let role: ColumnRole = idColumn ? "ignore" : headerRole(header);
    if (role !== "group" && role !== "ignore") { if (used.has(role)) role = "ignore"; else used.add(role); }
    columns.push({ index, header, sample: values[0] ?? "", role, idColumn });
  }
  // A column of full paths ("Block 12A > Ground floor") already names every level, so a block or area column kept
  // beside it would repeat a level. It starts as not used; the person can still turn it back on.
  const isPathColumn = (column: SheetColumn) => {
    const values = data.map(row => row[column.index] ?? "").filter(Boolean);
    return values.length > 0 && values.filter(value => PATH_SEPARATOR.test(value)).length / values.length >= 0.5;
  };
  const pathColumn = columns.find(column => column.role === "group" && isPathColumn(column));
  if (pathColumn) for (const column of columns) if (column.role === "group" && column !== pathColumn) column.role = "ignore";
  if (!columns.some(column => column.role === "meter" || column.role === "device") && meters.length) {
    const names = new Set(meters.flatMap(meterNames).map(loose));
    const best = columns.filter(column => column.role === "ignore" && !column.idColumn)
      .map(column => ({ column, hits: data.filter(row => names.has(loose(row[column.index] ?? ""))).length }))
      .sort((left, right) => right.hits - left.hits)[0];
    if (best && best.hits > 0) best.column.role = "meter";
  }
  return { headerRow, columns };
}

/** Changes one column's role; a name or short-name role moves off any other column that had it. */
export function withColumnRole(layout: SheetLayout, index: number, role: ColumnRole): SheetLayout {
  return { ...layout, columns: layout.columns.map(column => column.index === index ? { ...column, role }
    : role !== "group" && role !== "ignore" && column.role === role ? { ...column, role: "ignore" } : column) };
}

/**
 * The meter rows, each with its group path. Group columns are read left to right and a cell with ">" is split into a
 * group inside a group. A row holding only group cells (a block named once above its meters) sets the group for the
 * rows below it, and an empty group cell (a merged cell in Excel) takes the one above, unless a group to its left is
 * given on that row. When the sheet has a device ID column, rows after the last device ID (notes) are left out.
 */
export function readRows(cells: string[][], layout: SheetLayout): ArrangeRow[] {
  const cell = (row: string[], role: ColumnRole) => { const column = layout.columns.find(item => item.role === role); return column ? row[column.index] ?? "" : ""; };
  const groupColumns = layout.columns.filter(column => column.role === "group").sort((left, right) => left.index - right.index);
  const idColumns = layout.columns.filter(column => column.idColumn);
  let last = cells.length - 1;
  if (idColumns.length) {
    const lastId = cells.findLastIndex((row, index) => index > layout.headerRow && idColumns.some(column => row[column.index]));
    if (lastId > layout.headerRow) last = lastId;
  }
  const rows: ArrangeRow[] = [];
  let current: string[] = groupColumns.map(() => "");
  for (let index = layout.headerRow + 1; index <= last; index += 1) {
    const row = cells[index] ?? [];
    const given = groupColumns.map(column => row[column.index] ?? "");
    const meterName = cell(row, "meter"), deviceName = cell(row, "device");
    if (!meterName && !deviceName && !given.some(Boolean)) continue;
    const firstGiven = given.findIndex(Boolean);
    const groups = given.map((value, level) => value || (firstGiven < 0 || level < firstGiven ? current[level]! : ""));
    current = groups;
    if (!meterName && !deviceName) continue;
    const path: string[] = [];
    for (const part of groups.flatMap(value => value.split(PATH_SEPARATOR)).map(cleanText).filter(Boolean)) {
      if (key(part) !== key(path.at(-1) ?? "")) path.push(part);
    }
    rows.push({ row: index + 1, path, meterName, deviceName, shortName: cell(row, "short").slice(0, SHORT_NAME_MAX).trim(), lights: cell(row, "lights") });
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------------------------
// Matching rows to meters

/** Every name a meter is known by: its label, its short name and the Tuya device name it was imported under. */
export function meterNames(meter: EnergyMeterMappingRowDto): string[] {
  const names = [meter.presentation?.device_name, meter.display_name, meter.presentation?.circuit_name, meter.presentation?.short_name, meter.source_label];
  return [...new Set(names.map(name => cleanText(name ?? "")).filter(Boolean))];
}

const bigrams = (value: string) => {
  const grams = new Map<string, number>();
  const text = ` ${value} `;
  for (let index = 0; index < text.length - 1; index += 1) { const gram = text.slice(index, index + 2); grams.set(gram, (grams.get(gram) ?? 0) + 1); }
  return grams;
};
/** How alike two texts are, from 0 to 1 (shared letter pairs), so a typo or a missing word still scores high. */
export function similarity(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const a = bigrams(left), b = bigrams(right);
  let shared = 0, total = 0;
  for (const [gram, count] of a) { shared += Math.min(count, b.get(gram) ?? 0); total += count; }
  for (const count of b.values()) total += count;
  return (2 * shared) / total;
}

const FUZZY_MIN = 0.75;
/** The row's own group names, and any word in them with a digit ("12A" in "Block 12A"), as name prefixes. */
const prefixesOf = (row: ArrangeRow) => [...new Set([...row.path, ...row.path.flatMap(part => part.split(/\s+/u).filter(word => /\d/u.test(word)))])];

/** How sure a row is about one meter: 1 for its Tuya device name, then exact, prefixed, loose and fuzzy names. */
export function matchScore(row: ArrangeRow, meter: EnergyMeterMappingRowDto): number {
  if (row.deviceName && key(row.deviceName) === key(meter.source_label)) return 1;
  const names = meterNames(meter);
  const asked = [row.meterName, row.deviceName].filter(Boolean);
  const prefixes = prefixesOf(row);
  const variants = (form: (value: string) => string) => new Set(names.map(form));
  const exact = variants(key), looseNames = variants(loose);
  if (asked.some(name => exact.has(key(name)))) return 0.99;
  if (asked.some(name => prefixes.some(prefix => exact.has(key(`${prefix} ${name}`))))) return 0.97;
  if (asked.some(name => looseNames.has(loose(name)))) return 0.94;
  if (asked.some(name => prefixes.some(prefix => looseNames.has(loose(`${prefix} ${name}`))))) return 0.92;
  let best = 0;
  for (const name of asked) for (const candidate of looseNames) {
    best = Math.max(best, similarity(loose(name), candidate), ...prefixes.map(prefix => similarity(loose(`${prefix} ${name}`), candidate)));
  }
  return best >= FUZZY_MIN ? Math.min(0.9, best * 0.9) : 0;
}

const confidenceOf = (score: number): MatchConfidence => score >= 0.97 ? "exact" : score >= 0.92 ? "close" : "guess";

/** Words two group paths share, to choose between meters with the same name in different places. */
const sharedWords = (left: string[], right: string[]) => {
  const words = (parts: string[]) => new Set(parts.flatMap(part => loose(part).split(" ")).filter(word => word.length > 1));
  const a = words(left), b = words(right);
  return [...a].filter(word => b.has(word)).length;
};

/**
 * Matches each row to at most one meter and each meter to at most one row, surest first. Where two meters fit a row
 * equally well and nothing tells them apart, the match is only a best guess.
 */
export function matchRows(rows: ArrangeRow[], document: EnergyProjectSetupDocumentDto): RowMatch[] {
  const meters = document.meter_mapping?.rows ?? [];
  const currentPath = new Map(meters.map(meter => [meter.id, groupPath(document, meter.scope_id)]));
  const pairs: Array<{ rowIndex: number; meterIndex: number; score: number; rank: number }> = [];
  const ambiguous = new Set<number>();
  rows.forEach((row, rowIndex) => {
    const scored = meters.map((meter, meterIndex) => ({ meterIndex, score: matchScore(row, meter) })).filter(item => item.score > 0);
    for (const item of scored) pairs.push({ rowIndex, meterIndex: item.meterIndex, score: item.score, rank: item.score + sharedWords(row.path, currentPath.get(meters[item.meterIndex]!.id) ?? []) * 0.001 });
    const top = scored.map(item => item.score).sort((left, right) => right - left);
    if (top.length > 1 && top[0] === top[1]) {
      const best = scored.filter(item => item.score === top[0]).map(item => sharedWords(row.path, currentPath.get(meters[item.meterIndex]!.id) ?? [])).sort((left, right) => right - left);
      if (best[0] === best[1]) ambiguous.add(rowIndex);
    }
  });
  pairs.sort((left, right) => right.rank - left.rank || left.rowIndex - right.rowIndex || left.meterIndex - right.meterIndex);
  const matches: RowMatch[] = rows.map(() => ({ meterId: null, confidence: null, score: 0 }));
  const taken = new Set<number>();
  for (const pair of pairs) {
    if (matches[pair.rowIndex]!.meterId || taken.has(pair.meterIndex)) continue;
    taken.add(pair.meterIndex);
    matches[pair.rowIndex] = { meterId: meters[pair.meterIndex]!.id, confidence: ambiguous.has(pair.rowIndex) ? "guess" : confidenceOf(pair.score), score: pair.score };
  }
  return matches;
}

/** The person's own choice for one row (a meter, or null to skip it). A meter picked here leaves any other row. */
export function withPick(matches: RowMatch[], rowIndex: number, meterId: string | null): RowMatch[] {
  return matches.map((match, index) => index === rowIndex ? { meterId, confidence: meterId ? "picked" : null, score: meterId ? 1 : 0 }
    : meterId && match.meterId === meterId ? { meterId: null, confidence: null, score: 0 } : match);
}

/** "17 of 19 meters matched", the rows that matched nothing and the meters the file does not mention. */
export function matchSummary(rows: ArrangeRow[], matches: RowMatch[], document: EnergyProjectSetupDocumentDto) {
  const meters = document.meter_mapping?.rows ?? [];
  const used = new Set(matches.flatMap(match => match.meterId ? [match.meterId] : []));
  return {
    total: meters.length,
    matched: used.size,
    unmatchedRows: rows.filter((_, index) => !matches[index]?.meterId),
    guesses: matches.filter(match => match.confidence === "guess").length,
    notInFile: meters.filter(meter => !used.has(meter.id)),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The change itself

/** A group's path from the top, e.g. ["Common area", "Pavilion"]. */
export function groupPath(document: EnergyProjectSetupDocumentDto, nodeId: string): string[] {
  const byId = new Map(document.nodes.map(node => [node.id, node]));
  const path: string[] = [];
  const seen = new Set<string>();
  for (let node = byId.get(nodeId); node && !seen.has(node.id); node = node.parent_id ? byId.get(node.parent_id) : undefined) { seen.add(node.id); path.unshift(node.name); }
  return path;
}

export type ArrangeResult = {
  document: EnergyProjectSetupDocumentDto;
  /** Groups made for the file, with their paths. */
  created: Array<{ id: string; path: string[] }>;
  /** Meters that change group: where they were and where they go. */
  moved: Array<{ meterId: string; from: string[]; to: string[] }>;
  shortNames: Array<{ meterId: string; name: string }>;
  /** Meters whose number of lights the file sets or changes. */
  lightCounts: Array<{ meterId: string; count: number }>;
  /** Matched rows whose number of lights is not a whole number from 1 to 9999; those meters keep their own. */
  badLights: Array<{ row: number; text: string }>;
  /** Groups that held meters before and hold none afterwards. */
  emptied: Array<{ id: string; path: string[] }>;
  /** Of those, the ones removed (only when asked, and only when nothing at all is attached to them). */
  removed: string[];
};

/**
 * Applies the file to the draft: creates the groups it names (reusing any with the same name in the same place), moves
 * each matched meter into its group and sets the short names and numbers of lights given. Meters are never removed; a
 * meter a row gives no group stays where it is, and an empty short-name or number-of-lights cell keeps what it has. Groups left with no meters are
 * removed only with `removeEmptied`, since a group with no meters cannot go live.
 */
export function arrangeGroups(document: EnergyProjectSetupDocumentDto, projectId: string, rows: ArrangeRow[], matches: RowMatch[], options: { removeEmptied: boolean }, locale: EnergyIqLocale = "en"): ArrangeResult | { error: string } {
  let next = document;
  const created: ArrangeResult["created"] = [], moved: ArrangeResult["moved"] = [], shortNames: ArrangeResult["shortNames"] = [];
  const lightCounts: ArrangeResult["lightCounts"] = [], badLights: ArrangeResult["badLights"] = [];
  const childrenOf = (parentId: string | undefined) => {
    const ids = new Set(next.nodes.map(node => node.id));
    return next.nodes.filter(node => (node.parent_id && ids.has(node.parent_id) ? node.parent_id : undefined) === parentId);
  };
  const ensurePath = (path: string[]): string | { error: string } => {
    let parentId: string | undefined;
    for (const [level, name] of path.entries()) {
      const found = childrenOf(parentId).find(node => key(node.name) === key(name));
      if (found) { parentId = found.id; continue; }
      const added = addGroup(next, projectId, { name, parentId }, locale);
      if ("error" in added) return added;
      next = added.document;
      parentId = added.nodeId;
      created.push({ id: added.nodeId, path: path.slice(0, level + 1) });
    }
    return parentId!;
  };
  for (const [index, row] of rows.entries()) {
    const meterId = matches[index]?.meterId;
    if (!meterId) continue;
    const before = next.meter_mapping?.rows.find(meter => meter.id === meterId);
    if (!before) continue;
    if (row.path.length) {
      const target = ensurePath(row.path);
      if (typeof target !== "string") return target;
      if (before.scope_id !== target) {
        const result = moveMetersToGroup(next, [meterId], target, locale);
        if ("error" in result) return result;
        moved.push({ meterId, from: groupPath(document, before.scope_id), to: groupPath(next, target) });
        next = result;
      }
    }
    const meter = next.meter_mapping!.rows.find(item => item.id === meterId)!;
    const shortName = cleanText(row.shortName);
    const current = meter.presentation?.short_name?.trim() ?? "";
    if (shortName && shortName !== current && !(!current && shortName === projectMeterFullName(meter))) {
      const result = applyMeterEdit(next, meter, { name: projectMeterFullName(meter), scopeId: meter.scope_id, category: meter.category, counted: meter.aggregation_usage === "official", shortName }, locale);
      if ("error" in result) return result;
      next = result;
      shortNames.push({ meterId, name: shortName });
    }
    const lights = parseLights(row.lights);
    if (lights === null) badLights.push({ row: row.row, text: row.lights });
    const counted = next.meter_mapping!.rows.find(item => item.id === meterId)!;
    if (lights && String(lights) !== (counted.presentation?.light_count ?? "")) {
      const result = applyMeterEdit(next, counted, { name: projectMeterFullName(counted), scopeId: counted.scope_id, category: counted.category, counted: counted.aggregation_usage === "official", lightCount: String(lights) }, locale);
      if ("error" in result) return result;
      next = result;
      lightCounts.push({ meterId, count: lights });
    }
  }
  const emptied = document.nodes
    .filter(node => metersInGroup(document, node.id) > 0 && next.nodes.some(item => item.id === node.id) && metersInGroup(next, node.id) === 0)
    .map(node => ({ id: node.id, path: groupPath(document, node.id) }));
  const removed: string[] = [];
  if (options.removeEmptied) {
    const emptiedIds = new Set(emptied.map(item => item.id));
    // Removing a group removes the empty groups inside it, so only the outermost emptied ones are removed directly.
    for (const group of emptied) {
      const parentId = document.nodes.find(node => node.id === group.id)?.parent_id;
      if (parentId && emptiedIds.has(parentId)) continue;
      const result = removeGroup(next, group.id, locale);
      if ("error" in result) continue;
      next = result.document;
      removed.push(group.id);
    }
  }
  return { document: next, created, moved, shortNames, lightCounts, badLights, emptied, removed };
}

/** True when applying would change nothing. */
export const arrangeChangesNothing = (result: ArrangeResult) => !result.created.length && !result.moved.length && !result.shortNames.length && !result.lightCounts.length && !result.removed.length;

export type PreviewGroup = { id: string; name: string; isNew: boolean; meters: EnergyMeterMappingRowDto[]; children: PreviewGroup[] };
/** The tree after the change, with the meters in each group, for the preview. */
export function previewTree(result: ArrangeResult): PreviewGroup[] {
  const { document } = result;
  const createdIds = new Set(result.created.map(item => item.id));
  const ids = new Set(document.nodes.map(node => node.id));
  const seen = new Set<string>();
  const build = (parentId: string | undefined): PreviewGroup[] => document.nodes
    .filter(node => (node.parent_id && ids.has(node.parent_id) ? node.parent_id : undefined) === parentId)
    .sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name, undefined, { numeric: true }))
    .flatMap(node => {
      if (seen.has(node.id)) return [];
      seen.add(node.id);
      return [{ id: node.id, name: node.name, isNew: createdIds.has(node.id), meters: (document.meter_mapping?.rows ?? []).filter(meter => meter.scope_id === node.id), children: build(node.id) }];
    });
  return build(undefined);
}

// ---------------------------------------------------------------------------------------------------------------
// Template and floor plan

export const TEMPLATE_FILENAME = "groups-template.csv";
const csvCell = (value: string) => /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
/** The headings EnergyX looks for, with two made-up example rows. */
export function templateCsv(): string {
  const rows = [
    ["Group", "Meter name", "Short name", "Number of lights"],
    ["Block A > Ground floor", "Block A GF Lobby Lighting", "Lift lobby 1", "6"],
    ["Common area > Pavilion", "Pavilion linkway 1", "Pavilion 1", "4"],
  ];
  return `${rows.map(row => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/**
 * The floor plan with one labelled area added for each top-level group it does not show yet (no panel needed). Areas
 * already drawn stay exactly as they are; the new ones go in a row below them. Null when there is nothing to add.
 */
export function floorPlanWithGroupAreas(previous: StoredSpatialReference | null, groups: string[], locale: EnergyIqLocale = "en"): { plan: FloorPlan; added: string[] } | null {
  const existing = previous ? planFromReference(previous, locale) : null;
  // Areas the layout keeps off the drawing count too, so a new area never takes the same label.
  const taken = new Set([...(existing?.areas ?? []).map(area => area.label), ...(existing ? hiddenZones(existing).map(zone => zone.id) : [])].map(key));
  const added: string[] = [];
  for (const name of groups.map(cleanText).filter(Boolean)) if (!taken.has(key(name))) { taken.add(key(name)); added.push(name); }
  if (!added.length) return null;
  if (!existing) {
    const starter = starterPlan(added.map(() => ""), locale);
    return { plan: { ...starter, areas: starter.areas.map((area, index) => ({ ...area, label: added[index]! })) }, added };
  }
  const [vx, vy, vw, vh] = existing.viewBox;
  const margin = 20, gap = 30, height = Math.round(DEFAULT_VIEWBOX[3] * 0.3);
  const top = vy + contentExtent(existing)[1] + 10;
  const width = Math.max(40, Math.floor((vw - margin * 2 - gap * (added.length - 1)) / added.length));
  const used = new Set(existing.areas.map(area => area.key));
  const freeKey = (start: number) => { let index = start; while (used.has(`area-${index}`)) index += 1; used.add(`area-${index}`); return `area-${index}`; };
  const areas: PlanArea[] = added.map((label, index) => ({ key: freeKey(existing.areas.length + 1 + index), label, board: "", rect: [vx + margin + index * (width + gap), top, width, height] }));
  // The stored format keeps every coordinate at or below MAX_COORD: when the new row would sit past it, nothing is offered.
  if (top + height + margin > MAX_COORD || top - vy + height + margin > MAX_PLAN_SIZE) return null;
  const needed = Math.min(MAX_PLAN_SIZE, MAX_COORD - vy, Math.max(vh, top - vy + height + margin));
  return { plan: { ...existing, viewBox: [vx, vy, vw, needed], areas: [...existing.areas, ...areas] }, added };
}
