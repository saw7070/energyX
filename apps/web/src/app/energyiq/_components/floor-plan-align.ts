/**
 * Lining items up: align edges or centres, space items evenly, make them the same size, and type an exact position or
 * size. Locked items never move (they are counted in `skipped` so the editor can say so), and the rooms, equipment and
 * devices inside a moved area or room come along. Each returns the same plan object when nothing changes, so a press
 * that does nothing leaves no undo step.
 */
import { boxOf, isLocked, moveItems } from "./floor-plan-arrange";
import { keepBoxInside } from "./floor-plan-mark-data";
import { MIN_SIZE, clampRect, settleRooms, type FloorPlan, type Point, type Rect, type Selection } from "./floor-plan-model";

export type AlignHow = "left" | "centre" | "right" | "top" | "middle" | "bottom";
export type Arranged = { plan: FloorPlan; skipped: number };

/** Outer items first (areas, rooms, equipment, then devices and the entrance), so an item inside another selected item ends at its own place. */
function depth(plan: FloorPlan, item: Selection): number {
  if (item.kind === "area") return plan.areas.find(entry => entry.key === item.key)?.insideRoom ? 2 : 0;
  return item.kind === "room" ? 1 : 3;
}
/** Moves each item so its box's top-left corner is at `to`, with what is inside it. */
function placeAll(plan: FloorPlan, moves: Array<{ item: Selection; to: Point }>): FloorPlan {
  let current = plan;
  for (const { item, to } of [...moves].sort((a, b) => depth(plan, a.item) - depth(plan, b.item))) {
    const box = boxOf(current, item);
    if (!box) continue;
    const dx = Math.round(to[0] - box[0]), dy = Math.round(to[1] - box[1]);
    if (dx || dy) current = moveItems(current, [item], dx, dy);
  }
  return current === plan ? plan : settleRooms(current);
}
const boxesOf = (plan: FloorPlan, list: Selection[]) => list.flatMap(item => { const box = boxOf(plan, item); return box ? [{ item, box, locked: isLocked(plan, item) }] : []; });

/**
 * Lines up the selected items' left edges, centres or right edges (or top edges, middles or bottoms) with the outermost
 * of them. Locked items stay put, but still count when working out where the line is.
 */
export function alignItems(plan: FloorPlan, list: Selection[], how: AlignHow): Arranged {
  const entries = boxesOf(plan, list), skipped = entries.filter(entry => entry.locked).length;
  if (entries.length < 2) return { plan, skipped: 0 };
  const left = Math.min(...entries.map(({ box }) => box[0])), right = Math.max(...entries.map(({ box }) => box[0] + box[2]));
  const top = Math.min(...entries.map(({ box }) => box[1])), bottom = Math.max(...entries.map(({ box }) => box[1] + box[3]));
  const target = ([x, y, w, h]: Rect): Point => ({
    left: [left, y], centre: [(left + right) / 2 - w / 2, y], right: [right - w, y],
    top: [x, top], middle: [x, (top + bottom) / 2 - h / 2], bottom: [x, bottom - h],
  } satisfies Record<AlignHow, Point>)[how];
  return { plan: placeAll(plan, entries.filter(entry => !entry.locked).map(({ item, box }) => ({ item, to: target(box) }))), skipped };
}

/**
 * Spaces the selected items evenly across (or down): the first and last stay put and the gaps between them become
 * equal. Needs three or more items that are not locked; locked items are left out.
 */
export function distributeItems(plan: FloorPlan, list: Selection[], axis: "x" | "y"): Arranged {
  const all = boxesOf(plan, list), skipped = all.filter(entry => entry.locked).length;
  const i = axis === "x" ? 0 : 1, entries = all.filter(entry => !entry.locked).sort((a, b) => a.box[i] - b.box[i] || a.box[i + 2] - b.box[i + 2]);
  if (entries.length < 3) return { plan, skipped };
  const first = entries[0]!.box, last = entries[entries.length - 1]!.box;
  const span = last[i] + last[i + 2] - first[i], used = entries.reduce((sum, { box }) => sum + box[i + 2], 0), gap = (span - used) / (entries.length - 1);
  let cursor = first[i];
  const moves = entries.map(({ item, box }) => { const to: Point = axis === "x" ? [cursor, box[1]] : [box[0], cursor]; cursor += box[i + 2] + gap; return { item, to }; });
  return { plan: placeAll(plan, moves), skipped };
}

/** Whether an item has a size of its own to change: an area, a room, equipment or a device drawn as a box. */
export const sizable = (plan: FloorPlan, item: Selection) => item.kind === "area" || item.kind === "room" || (item.kind === "device" && !!plan.devices.find(entry => entry.meterId === item.key)?.size);
/** Puts an area, room, equipment or device box in `rect` (kept inside the plan and at least MIN_SIZE). */
export function setRect(plan: FloorPlan, item: Selection, rect: Rect): FloorPlan {
  const [x, y, w, h] = clampRect(rect, plan.viewBox);
  if (item.kind === "area") return { ...plan, areas: plan.areas.map(entry => entry.key === item.key ? { ...entry, rect: [x, y, w, h] } : entry) };
  if (item.kind === "room") return { ...plan, rooms: plan.rooms.map(entry => entry.key === item.key ? { ...entry, rect: [x, y, w, h] } : entry) };
  // A turned device box keeps all of itself inside the plan as turned.
  if (item.kind === "device") return { ...plan, devices: plan.devices.map(entry => entry.meterId === item.key && entry.size ? { ...entry, position: entry.rotation ? keepBoxInside([x + w / 2, y + h / 2], [w, h], entry.rotation, plan.viewBox) : [x + w / 2, y + h / 2], size: [w, h] } : entry) };
  return plan;
}

/**
 * Gives the selected items the width (or height) of the first one picked, keeping each one's top-left corner where it
 * is. Dots and the entrance have no size and are left as they are; locked items stay as they are.
 */
export function sameSize(plan: FloorPlan, list: Selection[], dimension: "w" | "h"): Arranged {
  const entries = boxesOf(plan, list).filter(entry => sizable(plan, entry.item));
  const reference = entries[0];
  if (!reference || entries.length < 2) return { plan, skipped: 0 };
  const i = dimension === "w" ? 2 : 3, size = reference.box[i];
  let current = plan, skipped = 0;
  for (const { item, box, locked } of entries.slice(1)) {
    if (box[i] === size) continue;
    if (locked) { skipped += 1; continue; }
    const next = [...box] as Rect; next[i] = size;
    current = setRect(current, item, next);
  }
  return { plan: current === plan ? plan : settleRooms(current), skipped };
}

export type Field = "x" | "y" | "w" | "h";
/**
 * Sets one typed value for one item: X and Y are measured from the top-left corner of the drawing space, W and H are the
 * size. X and Y move the item with what is inside it; W and H keep its top-left corner. Values are kept inside the plan
 * and at least MIN_SIZE; `adjusted` says the value had to change to fit.
 */
export function placeTyped(plan: FloorPlan, item: Selection, field: Field, value: number): { plan: FloorPlan; adjusted: boolean } {
  const box = boxOf(plan, item);
  if (!box || isLocked(plan, item)) return { plan, adjusted: false };
  const [vx, vy, vw, vh] = plan.viewBox, [x, y, w, h] = box;
  const fit = (wanted: number, low: number, high: number) => Math.min(Math.max(wanted, low), Math.max(low, high));
  if (field === "x" || field === "y") {
    const wanted = (field === "x" ? vx : vy) + value, to = field === "x" ? fit(wanted, vx, vx + vw - w) : fit(wanted, vy, vy + vh - h);
    const moved = field === "x" ? moveItems(plan, [item], to - x, 0) : moveItems(plan, [item], 0, to - y);
    return { plan: moved === plan ? plan : settleRooms(moved), adjusted: to !== wanted };
  }
  const size = field === "w" ? fit(value, MIN_SIZE, vx + vw - x) : fit(value, MIN_SIZE, vy + vh - y);
  if (size === (field === "w" ? w : h)) return { plan, adjusted: size !== value };
  return { plan: settleRooms(setRect(plan, item, field === "w" ? [x, y, size, h] : [x, y, w, size])), adjusted: size !== value };
}
