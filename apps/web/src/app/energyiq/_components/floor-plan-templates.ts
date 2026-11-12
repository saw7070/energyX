/**
 * Repeat and templates: quick ways to lay out many rooms at once. Repeat copies what is selected several times in a row,
 * across or down, with a gap; a template drops a ready-made area with its rooms on the plan. Both are one undo step,
 * keep every label and room name unique (on every floor), never copy devices, and make the plan bigger when the copies
 * need the space (up to the largest plan a layout can hold).
 */
import { copyItems, fitsLimits, fitsMarks, newRoomId, pasteClip, roomIds, uniqueRoomName, type Clip } from "./floor-plan-arrange";
import { lineBox, lineCount, MAX_LINES } from "./floor-plan-lines";
import { MAX_OPENINGS, openingCount } from "./floor-plan-openings";
import { MAX_SHAPES } from "./floor-plan-plain-shapes";
import { labelBounds, symbolBounds } from "./floor-plan-marks";
import { MAX_COORD, MAX_PLAN_SIZE, contentBounds, settleRooms, type FloorPlan, type PlanArea, type PlanRoom, type Point, type Rect, type Selection } from "./floor-plan-model";

/** Most copies one Repeat makes. */
export const MAX_REPEAT = 20, MAX_ROW_ROOMS = 20;
export type RepeatFailure = "nothing" | "tooMany" | "noSpace" | "tooManyMarks" | "tooManyLines" | "tooManyOpenings" | "tooManyShapes";
type Result = { plan: FloorPlan; selection: Selection[] } | { failure: RepeatFailure };

const boundsOf = (rects: Rect[]): Rect => { const left = Math.min(...rects.map(([x]) => x)), top = Math.min(...rects.map(([, y]) => y)); return [left, top, Math.max(...rects.map(([x, , w]) => x + w)) - left, Math.max(...rects.map(([, y, , h]) => y + h)) - top]; };
/** The plan made big enough to hold `right` and `bottom`; null when that is bigger than a layout can hold. */
function roomFor(plan: FloorPlan, right: number, bottom: number): FloorPlan | null {
  if (!Number.isFinite(right) || !Number.isFinite(bottom)) return null;
  const [vx, vy, vw, vh] = plan.viewBox;
  if (right <= vx + vw && bottom <= vy + vh) return plan;
  const width = Math.ceil(Math.max(vw, right + 20 - vx)), height = Math.ceil(Math.max(vh, bottom + 20 - vy));
  if (width > MAX_PLAN_SIZE || height > MAX_PLAN_SIZE || vx + width > MAX_COORD || vy + height > MAX_COORD) return null;
  return { ...plan, viewBox: [vx, vy, width, height] };
}
const moved = (rect: Rect, dx: number, dy: number): Rect => [rect[0] + dx, rect[1] + dy, rect[2], rect[3]];
const movedPoint = ([x, y]: Point, dx: number, dy: number): Point => [x + dx, y + dy];
/** The clip moved by (dx, dy): every kind it holds (doors move with their rooms, as they sit on the rooms' walls). */
const shifted = (clip: Clip, dx: number, dy: number): Clip => ({
  ...clip,
  areas: clip.areas.map(item => ({ ...item, rect: moved(item.rect, dx, dy) })),
  rooms: clip.rooms.map(item => ({ ...item, rect: moved(item.rect, dx, dy) })),
  ...(clip.labels ? { labels: clip.labels.map(item => ({ ...item, position: movedPoint(item.position, dx, dy) })) } : {}),
  ...(clip.symbols ? { symbols: clip.symbols.map(item => ({ ...item, position: movedPoint(item.position, dx, dy) })) } : {}),
  ...(clip.lines ? { lines: clip.lines.map(item => ({ ...item, points: item.points.map(point => movedPoint(point, dx, dy)) })) } : {}),
  ...(clip.shapes ? { shapes: clip.shapes.map(item => ({ ...item, rect: moved(item.rect, dx, dy) })) } : {}),
});
/** The space everything in the clip takes (labels and landmarks as turned). */
const clipBoxes = (clip: Clip, unit: number): Rect[] => [...clip.areas.map(item => item.rect), ...clip.rooms.map(item => item.rect), ...(clip.labels ?? []).map(item => labelBounds(item, unit)), ...(clip.symbols ?? []).map(item => symbolBounds(item, unit)), ...(clip.lines ?? []).map(lineBox), ...(clip.shapes ?? []).map(item => item.rect)];

/**
 * Repeats the selected items (areas and rooms with the rooms, equipment and doors inside them, labels, landmarks, lines
 * and shapes) `count` times, each copy `gap` units after the last, across (to the right) or down. The originals and the
 * copies come back selected.
 */
export function repeatItems(plan: FloorPlan, selection: Selection[], count: number, direction: "across" | "down", gap: number, copyOf: (name: string) => string, reserved: string[] = []): Result {
  const clip = copyItems(plan, selection);
  if (!clip) return { failure: "nothing" };
  const times = Math.max(1, Math.min(MAX_REPEAT, Math.round(count))), space = Math.max(0, Math.min(1000, Math.round(gap)));
  if (!fitsLimits(plan, reserved.length, clip.areas.length * times, clip.rooms.length * times)) return { failure: "tooMany" };
  // The drawing items' limits count every floor too: never make fewer copies than asked without saying so.
  if (!fitsMarks(plan, (clip.labels?.length ?? 0) * times, (clip.symbols?.length ?? 0) * times)) return { failure: "tooManyMarks" };
  if (lineCount(plan) + (clip.lines?.length ?? 0) * times > MAX_LINES) return { failure: "tooManyLines" };
  if (openingCount(plan) + (clip.openings?.length ?? 0) * times > MAX_OPENINGS) return { failure: "tooManyOpenings" };
  if ((plan.shapes?.length ?? 0) + (plan.elsewhere?.shapes ?? 0) + (clip.shapes?.length ?? 0) * times > MAX_SHAPES) return { failure: "tooManyShapes" };
  const boxes = clipBoxes(clip, plan.viewBox[2] / 100);
  if (!boxes.length) return { failure: "nothing" };
  const [bx, by, bw, bh] = boundsOf(boxes);
  const step = direction === "across" ? [bw + space, 0] : [0, bh + space];
  let next = roomFor(plan, bx + bw + step[0]! * times, by + bh + step[1]! * times);
  if (!next) return { failure: "noSpace" };
  const picked: Selection[] = [...clip.roots];
  for (let index = 1; index <= times; index += 1) {
    const result = pasteClip(next, shifted(clip, step[0]! * index, step[1]! * index), 0, copyOf, reserved);
    next = result.plan; picked.push(...result.selection);
  }
  return { plan: next, selection: picked };
}

export type TemplateKind = "row" | "hdb" | "office";
/** A template's area and rooms, in plan units from the area's top-left corner; room names are message keys. */
type Shape = { size: [number, number]; rooms: Array<{ name: string; number?: number; rect: Rect }> };
function shapeOf(kind: TemplateKind, count: number): Shape {
  if (kind === "row") {
    const rooms = Math.max(1, Math.min(MAX_ROW_ROOMS, Math.round(count)));
    return { size: [40 + rooms * 160 + (rooms - 1) * 10, 190], rooms: Array.from({ length: rooms }, (_, index) => ({ name: "template.room", number: index + 1, rect: [20 + index * 170, 50, 160, 120] as Rect })) };
  }
  if (kind === "hdb") return { size: [700, 320], rooms: [
    { name: "template.corridorLeft", rect: [20, 60, 240, 80] }, { name: "template.liftLobby", rect: [270, 50, 160, 130] }, { name: "template.corridorRight", rect: [440, 60, 240, 80] },
    { name: "template.decorative", rect: [20, 200, 320, 100] }, { name: "template.emergency", rect: [360, 200, 320, 100] },
  ] };
  return { size: [640, 380], rooms: [
    { name: "template.openOffice", rect: [20, 50, 380, 310] }, { name: "template.reception", rect: [420, 50, 200, 90] }, { name: "template.meeting", rect: [420, 150, 200, 110] }, { name: "template.pantry", rect: [420, 270, 200, 90] },
  ] };
}
/** Where a new block goes: to the right of what is already drawn, else below it, at the top-left of an empty plan. */
function spotFor(plan: FloorPlan, [w, h]: [number, number]): { plan: FloorPlan; at: [number, number] } | null {
  const [vx, vy] = plan.viewBox, bounds = contentBounds(plan);
  const tries: Array<[number, number]> = bounds ? [[Math.max(vx + 20, bounds[2]), vy + 20], [vx + 20, Math.max(vy + 20, bounds[3])]] : [[vx + 20, vy + 20]];
  for (const at of tries) { const grown = roomFor(plan, at[0] + w, at[1] + h); if (grown) return { plan: grown, at }; }
  return null;
}

/**
 * Drops a template on the plan: one area (the next free letter, no panel) with its rooms, named in the reader's language
 * and kept unique on every floor. `count` is how many rooms a row has. The new area comes back selected.
 */
export function insertTemplate(plan: FloorPlan, kind: TemplateKind, count: number, text: (key: string, values?: Record<string, number>) => string, label: string, reserved: string[] = []): Result {
  const shape = shapeOf(kind, count);
  if (!fitsLimits(plan, reserved.length, 1, shape.rooms.length)) return { failure: "tooMany" };
  const spot = spotFor(plan, shape.size);
  if (!spot) return { failure: "noSpace" };
  const [ax, ay] = spot.at, stamp = Date.now().toString(36), key = `area-${stamp}`;
  const area: PlanArea = { key, label, board: "", rect: [ax, ay, shape.size[0], shape.size[1]] };
  const names = new Set([...plan.rooms.map(item => item.name.trim()), ...(plan.elsewhere?.names ?? [])]), ids = new Set(roomIds(plan));
  const rooms = shape.rooms.map((item, index): PlanRoom => {
    const wanted = text(item.name, item.number !== undefined ? { number: item.number } : undefined), name = names.has(wanted) ? uniqueRoomName(wanted, names) : wanted; names.add(name);
    const id = newRoomId(ids); ids.add(id);
    return { key: `room-${stamp}-${index + 1}`, name, rect: [ax + item.rect[0], ay + item.rect[1], item.rect[2], item.rect[3]], area: key, id };
  });
  return { plan: settleRooms({ ...spot.plan, areas: [...spot.plan.areas, area], rooms: [...spot.plan.rooms, ...rooms] }), selection: [{ kind: "area", key }] };
}
