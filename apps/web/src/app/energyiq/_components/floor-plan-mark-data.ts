/**
 * Reading and writing text labels and landmarks (`layout.labels`, `layout.symbols`), and the entrances among them.
 *
 * Saved layouts are untrusted: an entry is only drawn once the shared checks (readSpatialLabel / readSpatialSymbol) take
 * it, and only the keys they accepted belong to the editor. Everything else rides along as saved, and entries that
 * cannot be drawn are kept aside at their place in the list, so a layout nobody changed saves exactly as it was.
 *
 * Entrances: the first entrance is the plan's `entrance`, which `layout.entrance` (read by older builds, the site report
 * and the advisor) is always written from. Its own landmark entry goes back at its place in `layout.symbols`, and only
 * when the plan has a symbol list at all: a layout with just the one entrance it always had saves without one.
 */
import { readSpatialLabel, readSpatialSymbol } from "@datafoundry/contracts";
import { carriedOf, LABEL_KEYS, samePoint, SYMBOL_KEYS, withCarried, type Carried, type Json } from "./floor-plan-carry";
import { boxFrame, frameBounds, keepInside, labelBounds, MARK_LIMIT, normaliseRotation, symbolBounds, TEXT_MAX, type PlanLabel, type PlanSymbol } from "./floor-plan-marks";

type Point = [number, number];
type Rect = [number, number, number, number];
/** An entry the plan cannot draw, kept as saved at its place in the list. */
export type MarkSkip = { index: number; item: unknown };
/** What a saved list held: the entries the plan draws (with where each was), those kept aside, and whether it was a list at all. */
export type MarkList<T> = { items: Array<{ index: number; item: T }>; skipped: MarkSkip[]; list: boolean; raw?: { value: unknown } };
/**
 * The first entrance, as the editor holds it. `label` and `position` (with what `layout.entrance` carries, such as the
 * board an electrician looks for) are what older readers see; the rest belongs to its landmark entry: how it is turned,
 * its size and colour, a lock, its id, what that entry carries (`mark`) and its place in the symbol list (`slot`).
 */
export type EntranceMarkParts = { rotation?: number; size?: number; colour?: string; locked?: true; id?: string; mark?: Carried; slot?: number };

const ids = (accepted: Set<string>, value: unknown): { id?: string } => { if (typeof value !== "string" || accepted.has(value)) return {}; accepted.add(value); return { id: value }; };
/** The editor's keys of an entry: those the shared check accepted (an id only the first time it appears). */
const ownedOf = (keys: readonly string[], read: object, id: { id?: string }) => keys.filter(key => key === "id" ? "id" in id : key in read);

export function readLabels(raw: unknown): MarkList<PlanLabel> {
  if (raw === undefined) return { items: [], skipped: [], list: false };
  if (!Array.isArray(raw)) return { items: [], skipped: [], list: false, raw: { value: raw } };
  const seen = new Set<string>(), items: MarkList<PlanLabel>["items"] = [], skipped: MarkSkip[] = [];
  raw.forEach((entry, index) => {
    const read = index < MARK_LIMIT ? readSpatialLabel(entry) : null;
    if (!read) { skipped.push({ index, item: entry }); return; }
    const id = ids(seen, read.id), { id: _id, locked, bold, ...rest } = read;
    items.push({ index, item: { key: `label-${index + 1}`, ...rest, position: [...read.position] as Point, ...(bold ? { bold: true as const } : {}), ...(locked ? { locked: true as const } : {}), ...id, ...carriedOf(entry, ownedOf(LABEL_KEYS, read, id)) } });
  });
  return { items, skipped, list: true };
}
export function readSymbols(raw: unknown): MarkList<PlanSymbol> {
  if (raw === undefined) return { items: [], skipped: [], list: false };
  if (!Array.isArray(raw)) return { items: [], skipped: [], list: false, raw: { value: raw } };
  const seen = new Set<string>(), items: MarkList<PlanSymbol>["items"] = [], skipped: MarkSkip[] = [];
  raw.forEach((entry, index) => {
    const read = index < MARK_LIMIT ? readSpatialSymbol(entry) : null;
    if (!read) { skipped.push({ index, item: entry }); return; }
    const id = ids(seen, read.id), { id: _id, locked, ...rest } = read;
    items.push({ index, item: { key: `symbol-${index + 1}`, ...rest, position: [...read.position] as Point, ...(locked ? { locked: true as const } : {}), ...id, ...carriedOf(entry, ownedOf(SYMBOL_KEYS, read, id)) } });
  });
  return { items, skipped, list: true };
}

/** The entrance parts of a landmark entry (see EntranceMarkParts). */
export function entranceParts(symbol: PlanSymbol, slot?: number): EntranceMarkParts {
  return { ...(symbol.rotation ? { rotation: symbol.rotation } : {}), ...(symbol.size !== undefined ? { size: symbol.size } : {}), ...(symbol.colour ? { colour: symbol.colour } : {}), ...(symbol.locked ? { locked: true as const } : {}), ...(symbol.id ? { id: symbol.id } : {}),
    ...(symbol.extra || symbol.order ? { mark: { ...(symbol.extra ? { extra: symbol.extra } : {}), ...(symbol.order ? { order: symbol.order } : {}) } } : {}), ...(slot !== undefined ? { slot } : {}) };
}
/**
 * Which landmark is the first entrance. A legacy entrance (`at`) is the entrance symbol at the same place, if there is
 * one, so it is never drawn twice; without a legacy entrance the first entrance symbol is. Null when none is.
 */
export function firstEntrance(symbols: MarkList<PlanSymbol>["items"], at: Point | null): number {
  return symbols.findIndex(({ item }) => item.kind === "entrance" && (!at || samePoint(item.position, at)));
}
/** Whether the first entrance holds anything only its landmark entry can hold (so a symbol list must be saved). */
export const entranceMarked = (entrance: EntranceMarkParts) => !!entrance.rotation || entrance.size !== undefined || !!entrance.colour || !!entrance.locked || !!entrance.id || !!entrance.mark?.extra;

const round = (point: Point): Point => [Math.round(point[0]), Math.round(point[1])];
export function writeLabel(label: PlanLabel): Json {
  const rotation = normaliseRotation(label.rotation ?? 0);
  return withCarried({ ...(label.id ? { id: label.id } : {}), text: label.text.trim().slice(0, TEXT_MAX), position: round(label.position), ...(label.size ? { size: label.size } : {}), ...(rotation ? { rotation } : {}), ...(label.colour ? { colour: label.colour } : {}), ...(label.bold ? { bold: true } : {}), ...(label.locked ? { locked: true } : {}) }, label);
}
export function writeSymbol(symbol: Omit<PlanSymbol, "key">): Json {
  const rotation = normaliseRotation(symbol.rotation ?? 0), caption = symbol.label?.trim().slice(0, TEXT_MAX);
  return withCarried({ ...(symbol.id ? { id: symbol.id } : {}), kind: symbol.kind, position: round(symbol.position), ...(symbol.size !== undefined ? { size: Math.max(4, Math.round(symbol.size)) } : {}), ...(rotation ? { rotation } : {}), ...(caption ? { label: caption } : {}), ...(symbol.colour ? { colour: symbol.colour } : {}), ...(symbol.locked ? { locked: true } : {}) }, symbol);
}
/** The first entrance's own landmark entry, named as `layout.entrance` is (`label`). */
export const entranceSymbol = (entrance: { position: Point } & EntranceMarkParts, label: string): Json => writeSymbol({ kind: "entrance", position: entrance.position, label, ...(entrance.id ? { id: entrance.id } : {}), ...(entrance.size !== undefined ? { size: entrance.size } : {}), ...(entrance.rotation ? { rotation: entrance.rotation } : {}), ...(entrance.colour ? { colour: entrance.colour } : {}), ...(entrance.locked ? { locked: true } : {}), ...(entrance.mark ?? {}) });
/** Puts entries back at their saved places (smallest place first), around what the plan wrote. */
export function withPlaced(list: unknown[], placed: MarkSkip[]): unknown[] {
  const out = [...list];
  for (const { index, item } of [...placed].sort((a, b) => a.index - b.index)) out.splice(Math.min(index, out.length), 0, item);
  return out;
}

/** A label or landmark moved by (dx, dy), as far as it can go and still lie fully inside the plan, turned as it is. */
export function shiftLabel(label: PlanLabel, dx: number, dy: number, viewBox: Rect): PlanLabel {
  const unit = viewBox[2] / 100, moved: PlanLabel = { ...label, position: [label.position[0] + dx, label.position[1] + dy] };
  return { ...moved, position: keepInside(moved.position, labelBounds(moved, unit), viewBox) };
}
export function shiftSymbol(symbol: PlanSymbol, dx: number, dy: number, viewBox: Rect): PlanSymbol {
  const unit = viewBox[2] / 100, moved: PlanSymbol = { ...symbol, position: [symbol.position[0] + dx, symbol.position[1] + dy] };
  return { ...moved, position: keepInside(moved.position, symbolBounds(moved, unit), viewBox) };
}
/** A turned device box's middle, moved so the whole turned box stays inside the plan. */
export const keepBoxInside = (centre: Point, size: Point, rotation: number, viewBox: Rect): Point => keepInside(centre, frameBounds(boxFrame(centre, size, rotation)), viewBox);
