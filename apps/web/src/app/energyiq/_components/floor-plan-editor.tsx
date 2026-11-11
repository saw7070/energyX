"use client";
import { useCallback, useDeferredValue, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { flushSync } from "react-dom";
import { configApi } from "../../../lib/config-api";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { intlLocale } from "./energyiq-messages";
import { ArrangeActions, GridMenu, LineUpActions } from "./floor-plan-actions";
import { areaItemName, areaName as areaNameOf, countText, itemId, movedText, parseItemId, resizedText, selectionText, symbolName, useAnnouncer } from "./floor-plan-announce";
import { alignItems, distributeItems, placeTyped, sameSize, sizable, type Arranged, type Field } from "./floor-plan-align";
import { resizeCanvasFrom } from "./floor-plan-canvas";
import { ColourPicker, withBoardColour } from "./floor-plan-colour";
import { clearPlanDraft, usePlanDraft } from "./floor-plan-draft";
import { boxOf, copyItems, everything, fitsLimits, fitsMarks, frameOf, inBox, isIn, isLocked, lockItems, markAt, moveItems, newMarkId, newRoomId, pasteClip, removeItems, reorderItems, ridersOf, roomIds, stillThere, toggled, turnItem, type Clip, type Riders } from "./floor-plan-arrange";
import { LabelPanel, LandmarkPicker, RotationField, SymbolPanel, useKindName } from "./floor-plan-mark-panel";
import { shiftLabel, shiftSymbol } from "./floor-plan-mark-data";
import { angleFrom, frameCorners, handleSpot, MARK_LIMIT, normaliseRotation, ROTATION_STEP, type Frame, type PlanLabel, type PlanSymbol } from "./floor-plan-marks";
import { boxBetween, centredBox, isClick, snappedBox } from "./floor-plan-geometry";
import { floorPlanMessages } from "./floor-plan-messages";
import { canRedo, canUndo, commitPlan, endTyping, finishChange, redo, selectIn, showPlan, startHistory, undo, type HistoryEntry } from "./floor-plan-history";
import { isTextEntry, planShortcut } from "./floor-plan-keys";
import { PositionFields } from "./floor-plan-position";
import { boundsOf, editorPrefs, gridSpacing, guideFor, guideTargets, samePrefs, snapToLines, withPrefs, type EditorPrefs, type Guide, type GuideTargets } from "./floor-plan-snap";
import { AreaShape, DeviceShape, EntranceShape, GroupShape, LabelShape, RoomShape, SymbolShape, type ItemDown } from "./floor-plan-shapes";
import { DraftOffer, ZoomControls } from "./floor-plan-view-controls";
import { useCoarsePointer, useElementWidth, usePlanViewport } from "./floor-plan-viewport";
import { maxZoom, MIN_ZOOM, planPoint } from "./floor-plan-zoom";
import { EnergyIcon } from "./icons";
import { LockBadge } from "./plan-symbols";
import { boardColours, boardlessColours, mapDevices, pinLabel, roomHasPins, SiteFloorMap } from "./site-floor-map";
import {
  asGroupIn, asOwnArea, autoPlace, centre, hiddenZones, promoteEntrance, MAX_AREAS, MAX_ROOMS, NOTES_LIMIT, roomOwner, PLAN_STYLES, planStyleOf, clampPoint, clampRect, contains, NO_PASSENGERS, sameGeometry, settleRooms, defaultDeviceSize, deviceRect, resizeCanvas, notesWithReference, planFromReference, referenceFromPlan, resizeRect, snap, starterPlan,
  type FloorPlan, type Handle, type PlanArea, type Point, type Rect, type Selection, type StoredSpatialReference,
} from "./floor-plan-model";
import mapStyles from "./site-floor-map.module.css";
import styles from "./floor-plan-editor.module.css";

export type PlanMeter = { id: string; name: string; board: string; type: string };
const CORNERS: Handle[] = ["nw", "ne", "sw", "se"];
/** How close (in screen pixels) an edge or centre must come to another item's to line up with it. */
const GUIDE_REACH = 6;
/** A finger held still this long on an item adds it to (or takes it out of) the selection, like Shift-click. */
export const LONG_PRESS_MS = 500;
/** How far (in screen pixels) a finger may wander and still count as held still. */
const TOUCH_SLOP = 8;
/** Resize grips across, in screen pixels: big enough for a finger on a touch screen. */
const GRIP_PX = 12, TOUCH_GRIP_PX = 28;
/** How far the keyboard focus ring sits outside an item, in screen pixels. */
const RING_PX = 6;
/** Below this width (in CSS pixels) the editor's side panel goes under the plan. */
const NARROW = 900;
/** Re-exported so the Facility page can drop a draft when someone leaves the editor without saving. */
export { clearPlanDraft };

/**
 * The floor plan inside the Floor layout workspace: the selected location's boards stand out, and clicking an area
 * or a device selects it in the Locations list.
 */
export function FloorPlanView({ reference, meters, highlight, highlightDevices = null, focusDevice, canEdit, onEdit, onSelectBoard, onSelectDevice }: { reference: StoredSpatialReference | null; meters: PlanMeter[]; highlight: string[] | null; highlightDevices?: string[] | null; focusDevice: string | null; canEdit: boolean; onEdit: () => void; onSelectBoard: (board: string, deviceId?: string) => void; onSelectDevice: (id: string) => void }) {
  const [open, setOpen] = useState(() => { try { return window.localStorage.getItem("energyiq.floorPlanOpen") !== "false"; } catch { return true; } });
  const toggle = () => setOpen(current => { try { window.localStorage.setItem("energyiq.floorPlanOpen", String(!current)); } catch { /* per-browser convenience only */ } return !current; });
  const t = useMessages(floorPlanMessages);
  const placed = reference ? mapDevices(reference, meters) : [];
  return <section className={styles.embedded} aria-label={t("view.title")}>
    <header className={styles.embeddedHeader}>
      <div><h4>{t("view.title")}</h4><p>{reference ? t("view.summary", { placed: placed.length, total: meters.length }) : t("view.empty")}</p><p>{t("view.drawingOnly")}</p></div>
      <div className={styles.actions}>
        {canEdit && <button type="button" className={styles.secondary} onClick={onEdit}><EnergyIcon name="map" />{reference ? t("view.edit") : t("view.draw")}</button>}
        {reference && <button type="button" className={styles.secondary} aria-expanded={open} onClick={toggle}>{open ? t("view.hide") : t("view.show")}</button>}
      </div>
    </header>
    {reference && open && <div className={styles.mapFrame}><SiteFloorMap reference={reference} devices={placed} highlight={highlight} highlightDevices={highlightDevices} focusDevice={focusDevice} onSelectBoard={onSelectBoard} onOpenDevice={onSelectDevice} /></div>}
  </section>;
}

/** A drag on an item: moving the selection (or, with Alt, a copy of it), or resizing one item from a corner. */
/**
 * `box` is where the dragged items were when the drag began, `targets` the edges and centres of everything else they can
 * line up with (worked out once, so big plans stay smooth), `reach` how close counts in plan units, and `last` the last
 * amount shown, so a pointer move that changes nothing draws nothing.
 */
/** A turn (`mode` "rotate") turns one item around `pivot`, from `turn` degrees when the pointer was at `angle`. */
type Drag = { mode: "move" | "resize" | "rotate"; selection: Selection[]; handle?: Handle; start: Point; original: FloorPlan; before: HistoryEntry; pressed?: Selection[]; riders: Riders; moved: boolean; copied: boolean; warned: boolean; narrow?: Selection; box?: Rect; targets?: GuideTargets; reach: number; last?: Point; pivot?: Point; angle?: number; turn?: number };
/**
 * A drag on empty space (or a Shift-drag inside an area): a selection box, or the box of a new area, room or equipment.
 * `click` is the area pressed, which a Shift-click without dragging adds to the selection.
 */
type Sweep = { kind: "marquee" | "draw"; start: Point; additive: boolean; base: Selection[]; click?: Selection };
/** What the next drag (or click) on the plan draws. */
type Tool = "area" | "room" | "equipment" | "text" | "landmark";
const TOOL_STATUS = { area: "editor.drawArea", room: "editor.drawRoom", equipment: "editor.drawEquipment", text: "editor.drawText", landmark: "editor.drawLandmark" } as const satisfies Record<Tool, string>;
/** Tools that put something at the point clicked, rather than in a box dragged out. */
const pointTool = (tool: Tool | null) => tool === "text" || tool === "landmark";
/** How far the turning handle sits above an item, in screen pixels. */
const TURN_PX = 26;
/** Which edge of the drawing space is being pulled: right (wider), bottom (taller) or the corner (both). */
type Edge = "e" | "s" | "se" | "w" | "n";
type EdgeDrag = { edge: Edge; startX: number; startY: number; scale: number; original: FloorPlan; before: HistoryEntry; moved: boolean; warned: boolean };
const isMac = () => typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
/** Text picked on the page (in the help or a list): Copy and Select all then stay the browser's own. */
const textPicked = () => { try { const picked = window.getSelection(); return !!picked && !picked.isCollapsed && picked.toString().trim().length > 0; } catch { return false; } };

/** "You have changes that are not saved yet": shown by the editor's Cancel, and by the Facility tabs while it is open. */
export function UnsavedBar({ onKeep, onLeave }: { onKeep: () => void; onLeave: () => void }) {
  const t = useMessages(floorPlanMessages);
  return <div className={styles.unsaved} role="alert"><span>{t("editor.unsaved")}</span><button type="button" onClick={onKeep}>{t("editor.keepEditing")}</button><button type="button" className={styles.leave} onClick={onLeave}>{t("editor.discard")}</button></div>;
}

/** Full-width editor: design areas and rooms, place devices, then save to the layout block in Project notes. */
/** `onDirtyChange` says whether there are changes not saved yet, so the page can ask before leaving the editor. */
/** `userId` is who is signed in: the unsaved draft kept in this browser is theirs alone (see floor-plan-draft). */
export function FloorPlanEditor({ projectId, userId = "", notes, block, previous, meters, boards, onCancel, onSaved, onDirtyChange }: { projectId: string; userId?: string; notes: string; block: string | null; previous: StoredSpatialReference | null; meters: PlanMeter[]; boards: string[]; onCancel: () => void; onSaved: (message: string) => void; onDirtyChange?: (changed: boolean) => void }) {
  const t = useMessages(floorPlanMessages);
  const { locale } = useEnergyIqLocale();
  // The plan and the selection, with every step Undo and Redo can go to (see floor-plan-history).
  const [history, setHistory] = useState(() => startHistory(previous ? planFromReference(previous, locale) : starterPlan(boards, locale)));
  const { plan } = history.present;
  // The history as last drawn, for a press that must first save a field still being typed in (see `latest`).
  const historyRef = useRef(history);
  useLayoutEffect(() => { historyRef.current = history; });
  // Several items can be selected; anything taken off the plan meanwhile (an undo, a delete) simply drops out.
  const selection = stillThere(plan, history.present.selection);
  const single = selection.length === 1 ? selection[0]! : null;
  const [opened] = useState(plan);
  // The grid choices are the editor's own: saved with the layout, but never an undo step (see floor-plan-snap). With
  // snapping off, `step` is 0 and things go exactly where they are put.
  const [prefs, setPrefs] = useState<EditorPrefs>(() => editorPrefs(plan));
  const [openedPrefs] = useState(prefs);
  const changed = plan !== opened || !samePrefs(prefs, openedPrefs);
  const grid = prefs.grid, step = prefs.snap ? grid : 0;
  const dirtyListener = useRef(onDirtyChange);
  useEffect(() => { dirtyListener.current = onDirtyChange; });
  useEffect(() => { dirtyListener.current?.(changed); }, [changed]);
  useEffect(() => () => dirtyListener.current?.(false), []);
  // A new selection clears a message about the last one ("Copied", "Locked items stay where they are").
  const setSelection = (next: Selection[]) => { setHistory(current => selectIn(current, next)); setNotice(""); };
  const [placing, setPlacing] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool | null>(null);
  // The landmark the + Landmark tool puts down next.
  const [landmark, setLandmark] = useState<string | null>(null);
  const kindName = useKindName();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // The editor's own clipboard (never the computer's): what Copy took, and how many times it was pasted.
  const [clipboard, setClipboard] = useState<{ clip: Clip; pasted: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  // Zoom and pan (see floor-plan-viewport): only what the editor shows moves, never the plan's own coordinates. A pinch
  // or a pan that starts during a drag drops the drag (`abortRef`, set below).
  const abortRef = useRef<() => void>(() => undefined);
  const viewport = usePlanViewport({ svgRef, viewBox: plan.viewBox, projectId, onGestureStart: () => abortRef.current() });
  const coarse = useCoarsePointer();
  // On a narrow screen (or a narrow window) the side panel goes under the plan.
  const editorWidth = useElementWidth(sectionRef);
  const narrowScreen = editorWidth > 0 && editorWidth < NARROW;
  const keysId = useId();
  /** Keys work while the plan has focus; clicking it gives it focus. */
  const focusCanvas = () => { const svg = svgRef.current as (SVGSVGElement & { focus?: (options?: FocusOptions) => void }) | null; svg?.focus?.({ preventScroll: true }); };
  /**
   * The plan and selection to start a drag from. A position or colour code field saves when it is left, so pressing
   * the plan straight after typing (without Enter) first saves that field, at once, and the drag then starts from the
   * plan with the typed value in it, never the one before (which would undo the typing and leave a stray undo step).
   */
  const latest = () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && isTextEntry(active) && sectionRef.current?.contains(active)) flushSync(() => active.blur());
    const present = historyRef.current.present;
    return { plan: present.plan, selection: stillThere(present.plan, present.selection) };
  };
  const drag = useRef<Drag | null>(null);
  const sweep = useRef<Sweep | null>(null);
  const [sweepBox, setSweepBox] = useState<{ kind: Sweep["kind"]; rect: Rect } | null>(null);
  const [vx, vy, vw, vh] = plan.viewBox;
  const unit = vw / 100;
  // The part of the plan on screen. `screen` is a hundredth of the editor's width in plan units at this zoom (guides use
  // it); `perPx` is one screen pixel in plan units, so grips and the focus ring are a fixed size on screen however wide
  // the editor is and however far in or out the plan is zoomed (until the width is known, a 1000-pixel editor is assumed).
  const [wx, wy, ww, wh] = viewport.window;
  const screen = unit / viewport.zoom;
  const perPx = viewport.fitPx > 0 ? 1 / (viewport.fitPx * viewport.zoom) : ww / 1000;
  const mac = isMac(), keyName = (letter: string) => mac ? `⌘${letter}` : `Ctrl+${letter}`;
  // Panels are optional: an area may name none (""), and it is never offered as a panel to choose.
  const allBoards = [...new Set([...boards, ...plan.areas.map(item => item.board)].filter(Boolean))];
  // Colours count only the panels the plan's areas name, exactly as the saved map does, so a panel keeps the same
  // colour while editing and after saving (other groups' names never shift it).
  const planBoards = plan.areas.map(item => item.board);
  const boardKey = JSON.stringify(planBoards);
  const colours = useMemo(() => boardColours(JSON.parse(boardKey) as string[], plan.colours), [boardKey, plan.colours]);
  const noBoardColours = boardlessColours(planBoards, plan.areas.filter(item => !item.board).map(item => item.key));
  /** An area's colour: its own, else its panel's, else (no panel) the next colour after the panels. */
  const areaColour = (item: PlanArea) => item.colour ?? (item.board ? colours.get(item.board) : noBoardColours.get(item.key)) ?? "var(--zone-6)";
  /** Each area, equipment box, room and device can have its own colour; without one it follows its panel (a room, its area). */
  const recolour = <T extends { colour?: string }>(item: T, hex: string | null): T => { const { colour: _old, ...rest } = item; return (hex ? { ...rest, colour: hex } : rest) as T; };
  /** One colour choice is one undo step, however long the colour picker is dragged (`target` names what is coloured). */
  const pickColour = (target: string, apply: (hex: string | null) => FloorPlan) => (hex: string | null, live?: boolean) => commit(apply(hex), live ? { merge: `colour:${target}` } : undefined);
  const colourPicker = (target: string, value: string | undefined, autoLabel: string, apply: (hex: string | null) => FloorPlan) => <ColourPicker key={`colour:${target}`} legend={t("panel.colour")} hint={t("panel.colourHint")} value={value} autoLabel={autoLabel} onPick={pickColour(target, apply)} onDone={() => setHistory(endTyping)} />;
  const meterById = useMemo(() => new Map(meters.map(meter => [meter.id, meter])), [meters]);
  const meterName = (id: string) => meterById.get(id)?.name;
  const placedKey = JSON.stringify(plan.devices.map(item => item.meterId).sort());
  const placedIds = useMemo(() => new Set(JSON.parse(placedKey) as string[]), [placedKey]);
  const shown = (meterId: string) => meterById.has(meterId);

  /** One undo step; `merge` makes letters typed into one field a single step. */
  const commit = (next: FloorPlan, options?: { selection?: Selection[]; merge?: string }) => { setHistory(current => commitPlan(current, next, options)); setError(""); setNotice(""); };
  const show = (next: FloorPlan) => setHistory(current => showPlan(current, next));
  // What a screen reader hears (see useAnnouncer): the selection, moves, resizes, adds, deletes, undo and redo.
  const selectionKey = selection.map(itemId).join("|");
  const { live, speak, say } = useAnnouncer({ plan, selectionKey, trigger: history, describe: () => selectionText(t, plan, selection, meterName, kindName) });
  // Undo and Redo keep focus where it was (on the item, or the plan); if what had focus went away, the plan takes it.
  const refocus = useRef(false);
  const keepFocus = () => { const svg = svgRef.current; refocus.current = !!svg && svg.contains(document.activeElement); };
  const undoStep = () => { if (!canUndo(historyRef.current)) return; keepFocus(); say(() => t("a11y.undone")); setHistory(undo); setError(""); setNotice(""); };
  /** Leaving a field, or pressing Enter in it, ends that bit of typing: typing there again is a new undo step. */
  const typing = { onBlur: () => setHistory(endTyping), onKeyDown: (event: React.KeyboardEvent) => { if (event.key === "Enter") setHistory(endTyping); } };
  const redoStep = () => { if (!canRedo(historyRef.current)) return; keepFocus(); say(() => t("a11y.redone")); setHistory(redo); setError(""); setNotice(""); };
  /** A pointer's plan position, through the one helper that reads the SVG's screen matrix (so it is right at any zoom). */
  const toPoint = (clientX: number, clientY: number): Point => planPoint(svgRef.current, clientX, clientY) ?? [wx + ww / 2, wy + wh / 2];
  const place = (meterId: string, at: Point, plan = history.present.plan) => {
    setPlacing(null);
    if (plan.devices.some(item => item.meterId === meterId && item.locked)) { setNotice(t("editor.locked")); return; }
    commit({ ...plan, devices: [...plan.devices.filter(item => item.meterId !== meterId), { meterId, position: clampPoint([snap(at[0], step), snap(at[1], step)], plan.viewBox) }] }, { selection: [{ kind: "device", key: meterId }] });
    say(next => countText(t, next, [{ kind: "device", key: meterId }], meterName, "a11y.added", "a11y.addedMany", kindName));
    focusCanvas();
  };
  /** Deletes what is selected, except locked items, which stay (and stay selected). */
  const remove = () => {
    if (!selection.length) return;
    const kept = selection.filter(item => isLocked(plan, item)), next = removeItems(plan, selection);
    const gone = countText(t, plan, selection.filter(item => !isLocked(plan, item)), meterName, "a11y.deleted", "a11y.deletedMany", kindName);
    // Focus on a deleted item would fall out of the editor (and its keys stop working): it goes back to the plan.
    if (next !== plan) { keepFocus(); say(() => gone); commit(next, { selection: kept }); }
    if (kept.length) setNotice(t("editor.locked"));
  };
  const hidden = hiddenZones(plan);
  const reserved = hidden.map(item => item.id);
  const copyName = (name: string) => t("name.copy", { name });
  const nextLabel = () => { for (let index = 0; index < 26; index += 1) { const label = String.fromCharCode(65 + index); if (!plan.areas.some(item => item.label === label) && !hidden.some(item => item.id === label)) return label; } return t("name.area", { id: plan.areas.length + 1 }); };
  const chooseTool = (next: Tool) => { setPlacing(null); setNotice(""); setLandmark(null); setTool(current => current === next ? null : next); focusCanvas(); };
  /** Picking a landmark from the menu: the next click on the plan puts it there. */
  const chooseLandmark = (kind: string) => { setPlacing(null); setNotice(""); setLandmark(kind); setTool("landmark"); focusCanvas(); };
  const stopTool = () => { setTool(null); setLandmark(null); };
  /**
   * Adds what the tool draws: in the box dragged on the plan, at its usual size where the plan was clicked (`at`), or,
   * from the keyboard (neither), at its usual place. One undo step; the new item comes back selected.
   */
  const create = (kind: Tool, at: Point | null, drawn: Rect | null) => {
    if (kind === "text" || kind === "landmark") { addMark(kind, at ?? (drawn ? centre(drawn) : null)); return; }
    // A saved layout holds at most so many areas and rooms: say so instead of adding one that cannot be saved.
    if (!fitsLimits(plan, hidden.length, kind === "room" ? 0 : 1, kind === "room" ? 1 : 0)) { setNotice(tooMany()); return; }
    const box = drawn && !isClick(drawn) ? clampRect(drawn, plan.viewBox) : null;
    const done = (next: FloorPlan, item: Selection) => { say(placed => countText(t, placed, [item], meterName, "a11y.added", "a11y.addedMany", kindName)); commit(next, { selection: [item] }); setTool(null); focusCanvas(); };
    if (kind === "area") {
      const key = `area-${Date.now()}`, size: Point = [snap(vw * 0.35, grid), snap(vh * 0.55, grid)];
      const rect = box ?? (at ? centredBox(at, size, plan.viewBox, step) : clampRect([vx + 20, vy + 20, size[0], size[1]], plan.viewBox));
      done({ ...plan, areas: [...plan.areas, { key, label: nextLabel(), board: "", rect }] }, { kind: "area", key });
      return;
    }
    if (kind === "room") {
      const host = (single?.kind === "area" ? plan.areas.find(item => item.key === single.key && !item.insideRoom) : undefined) ?? plan.areas.find(item => !item.insideRoom);
      const [hx, hy] = host ? host.rect : [vx + 20, vy + 20];
      const key = `room-${Date.now()}`;
      const roomName = (number: number) => t("name.newRoom", { number });
      let number = plan.rooms.length + 1; while (plan.rooms.some(room => room.name === roomName(number))) number += 1;
      const rect = box ?? (at ? centredBox(at, [180, 110], plan.viewBox, step) : clampRect([hx + 20, hy + 50, 180, 110], plan.viewBox));
      // A new room gets a stable id, so later things can point at it even after it is renamed.
      const next = settleRooms({ ...plan, rooms: [...plan.rooms, { key, name: roomName(number), rect, ...(host && !box && !at ? { area: host.key } : {}), id: newRoomId(roomIds(plan)) }] });
      // A room belongs to an area: one drawn outside every area is not added (the tool stays on), as for equipment.
      if (!roomOwner(next, next.rooms[next.rooms.length - 1]!)) { setNotice(t("editor.roomNeedsArea")); return; }
      done(next, { kind: "room", key });
      return;
    }
    // Equipment on its own panel inside a room, such as a DB3 bank of LED screens in the showroom: pick its board and what it supplies next.
    const point = box ? centre(box) : at;
    const room = point ? plan.rooms.filter(item => contains(item.rect, point)).sort((a, b) => a.rect[2] * a.rect[3] - b.rect[2] * b.rect[3])[0]
      : (single?.kind === "room" ? plan.rooms.find(item => item.key === single.key) : undefined) ?? plan.rooms[0];
    if (!room) { setNotice(t("editor.equipmentNeedsRoom")); return; }
    const hostBoard = plan.areas.filter(item => !item.insideRoom && contains(item.rect, centre(room.rect))).sort((a, b) => a.rect[2] * a.rect[3] - b.rect[2] * b.rect[3])[0]?.board;
    const board = allBoards.find(item => !plan.areas.some(area => area.board === item)) ?? hostBoard ?? allBoards[0] ?? "";
    const [rx, ry, rw, rh] = room.rect, height = Math.min(60, rh * 0.4);
    const key = `group-${Date.now()}`;
    const rect = box ?? clampRect([rx + 12, ry + rh - height - 12, Math.max(20, rw - 24), height], plan.viewBox);
    done({ ...plan, areas: [...plan.areas, { key, label: nextLabel(), board, insideRoom: room.key, equipment: "", rect }] }, { kind: "area", key });
  };
  /**
   * Puts a text label or a landmark at `at` (on the grid), or from the keyboard (no point) in the middle of what is shown.
   * An entrance becomes the first entrance when the plan has none yet. One undo step; the new item comes back selected.
   */
  const addMark = (kind: "text" | "landmark", at: Point | null, symbolKind = landmark ?? "entrance") => {
    const isText = kind === "text", firstEntrance = !isText && symbolKind === "entrance" && !plan.entrance;
    if (!firstEntrance && !fitsMarks(plan, isText ? 1 : 0, isText ? 0 : 1)) { setNotice(t("editor.tooManyMarks", { max: MARK_LIMIT })); return; }
    const point = clampPoint(at ? [snap(at[0], step), snap(at[1], step)] : [wx + ww / 2, wy + wh / 2], plan.viewBox);
    let next: FloorPlan, item: Selection;
    if (isText) {
      const key = `label-${Date.now()}`, label = shiftLabel({ key, id: newMarkId(plan, "lb"), text: t("name.text"), position: point }, 0, 0, plan.viewBox);
      next = { ...plan, labels: [...(plan.labels ?? []), label] }; item = { kind: "label", key };
    } else if (firstEntrance) {
      next = { ...plan, entrance: { label: t("name.mainEntrance"), position: point } }; item = { kind: "entrance", key: "entrance" };
    } else {
      const key = `symbol-${Date.now()}`, count = (plan.symbols ?? []).filter(entry => entry.kind === "entrance").length + 2;
      const symbol = shiftSymbol({ key, id: newMarkId(plan, "sy"), kind: symbolKind, position: point, ...(symbolKind === "entrance" ? { label: t("name.otherEntrance", { number: count }) } : {}) }, 0, 0, plan.viewBox);
      next = { ...plan, symbols: [...(plan.symbols ?? []), symbol] }; item = { kind: "symbol", key };
    }
    say(placed => countText(t, placed, [item], meterName, "a11y.added", "a11y.addedMany", kindName));
    commit(next, { selection: [item] }); stopTool(); focusCanvas();
  };
  /** + Add entrance: the main entrance at the bottom of the plan, or another entrance beside the last one. */
  const addEntrance = () => {
    setPlacing(null); stopTool();
    const others = (plan.symbols ?? []).filter(entry => entry.kind === "entrance").length;
    addMark("landmark", plan.entrance ? [plan.entrance.position[0] + unit * 8 * (others + 1), plan.entrance.position[1]] : [vx + vw / 2, vy + vh - 40], "entrance");
  };
  const updateArea = (key: string, patch: Partial<PlanArea>, merge?: string) => commit({ ...plan, areas: plan.areas.map(item => item.key === key ? { ...item, ...patch } : item) }, merge ? { merge } : undefined);

  // Duplicate, copy and paste: areas and rooms come with what is inside them; devices are placed once, so never copied.
  const tooMany = () => t("editor.tooMany", { areas: MAX_AREAS, rooms: MAX_ROOMS });
  const fits = (clip: Clip) => fitsLimits(plan, hidden.length, clip.areas.length, clip.rooms.length) && fitsMarks(plan, clip.labels?.length ?? 0, clip.symbols?.length ?? 0);
  /** Devices and the entrance in the selection have no copy: say so, so the reader knows why they were left out. */
  const leftOut = () => selection.some(item => item.kind === "device" || item.kind === "entrance");
  /** Puts a copy on the plan; refused, with a message, when the plan could then not be saved. */
  const putCopy = (clip: Clip, offset: number) => {
    if (!fits(clip)) { setNotice(fitsMarks(plan, clip.labels?.length ?? 0, clip.symbols?.length ?? 0) ? tooMany() : t("editor.tooManyMarks", { max: MARK_LIMIT })); return false; }
    const result = pasteClip(plan, clip, offset, copyName, reserved);
    say(placed => countText(t, placed, result.selection, meterName, "a11y.added", "a11y.addedMany", kindName));
    commit(result.plan, { selection: result.selection }); focusCanvas(); return true;
  };
  const duplicate = () => { const clip = copyItems(plan, selection); if (clip) { if (putCopy(clip, grid) && leftOut()) setNotice(t("editor.notCopied")); } else if (selection.length) setNotice(t("editor.notCopied")); };
  const copy = () => { const clip = copyItems(plan, selection); if (!clip) { setNotice(t("editor.notCopied")); return false; } setClipboard({ clip, pasted: 0 }); const copied = t("editor.copied", { pasteKey: keyName("V") }); setNotice(leftOut() ? `${copied} ${t("editor.notCopied")}` : copied); return true; };
  /** Each paste lands one grid step further on, so pasting again does not stack copies on top of each other. */
  const paste = () => { if (!clipboard) return; const pasted = clipboard.pasted + 1; if (putCopy(clipboard.clip, grid * pasted)) setClipboard({ ...clipboard, pasted }); };

  const startDrag = (event: ReactPointerEvent, item: Selection, mode: Drag["mode"] = "move", handle?: Handle) => {
    if (placing || tool || event.button !== 0) return;
    const adding = event.shiftKey || event.metaKey || event.ctrlKey;
    // Shift- or Cmd/Ctrl-pressing an area not yet selected starts a selection box, so the rooms inside a block can be
    // boxed even where areas cover the whole plan; a click without dragging still adds the area itself.
    if (mode === "move" && adding && item.kind === "area" && !isIn(history.present.selection, item)) { event.stopPropagation(); beginSweep(event, item); return; }
    event.stopPropagation();
    const { plan, selection } = latest();
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    focusCanvas();
    const start = toPoint(event.clientX, event.clientY);
    if (mode === "resize") { const box = boxOf(plan, item) ?? undefined; drag.current = { mode, selection: [item], ...(handle ? { handle } : {}), start, original: plan, before: { plan, selection }, riders: NO_PASSENGERS(), moved: false, copied: false, warned: false, ...(box ? { box, targets: targetsAround(plan, other => other.kind === item.kind && other.key === item.key) } : {}), reach: GUIDE_REACH / pxPerUnit() }; return; }
    // Shift- or Cmd/Ctrl-click adds or takes out one item; pressing an item already selected drags the whole selection.
    const next = adding ? toggled(selection, item) : isIn(selection, item) ? selection : [item];
    setSelection(next);
    if (!isIn(next, item)) return;
    // Alt-drag drags out a copy and leaves the original where it was (unless the plan could then not be saved).
    const clip = event.altKey ? copyItems(plan, next) : null;
    if (clip && !fits(clip)) { setNotice(tooMany()); return; }
    const copied = clip ? pasteClip(plan, clip, 0, copyName, reserved) : null;
    if (copied) setHistory(current => showPlan(current, copied.plan, copied.selection));
    const original = copied?.plan ?? plan, moving = copied?.selection ?? next;
    // A plain click on one of several selected items, without dragging, selects just that one.
    const narrow = !adding && !event.altKey && next.length > 1 ? item : undefined;
    const riders = ridersOf(original, moving), hosts = moving.filter(entry => !isLocked(original, entry)).flatMap(entry => { const box = boxOf(original, entry); return box ? [box] : []; });
    // What moves (the picked items and everything riding on them) never lines up with itself.
    const riding = (other: Selection) => isIn(moving, other) || (other.kind === "room" ? riders.rooms.has(other.key) : other.kind === "area" ? riders.areas.has(other.key) : other.kind === "device" && riders.devices.has(other.key));
    drag.current = { mode: "move", selection: moving, start, original, before: { plan, selection: next }, pressed: selection, riders, moved: false, copied: !!copied, warned: false, ...(narrow ? { narrow } : {}), ...(hosts.length ? { box: boundsOf(hosts), targets: targetsAround(original, riding) } : {}), reach: GUIDE_REACH / pxPerUnit() };
    // On a touch screen, holding a finger still on an item adds it to the selection (or takes it out), like Shift-click.
    if (event.pointerType === "touch" && !copied) holdFor(event, item, selection);
  };
  /** Pressing the round handle above a label, landmark, entrance or device box: dragging turns it around its middle. */
  const startTurn = (event: ReactPointerEvent, item: Selection) => {
    if (placing || tool || event.button !== 0) return;
    event.stopPropagation();
    const { plan, selection } = latest(), frame = frameOf(plan, item);
    if (!frame || isLocked(plan, item)) return;
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    focusCanvas();
    const start = toPoint(event.clientX, event.clientY);
    drag.current = { mode: "rotate", selection: [item], start, original: plan, before: { plan, selection }, riders: NO_PASSENGERS(), moved: false, copied: false, warned: false, reach: 0, pivot: frame.pivot, angle: angleFrom(frame.pivot, start), turn: frame.rotation };
  };
  const press = useRef<{ id: number; at: Point; timer: ReturnType<typeof setTimeout> } | null>(null);
  const clearPress = () => { if (press.current) { clearTimeout(press.current.timer); press.current = null; } };
  const holdFor = (event: ReactPointerEvent, item: Selection, before: Selection[]) => {
    clearPress();
    const timer = setTimeout(() => {
      press.current = null;
      abortPointer();
      setSelection(toggled(before, item));
      try { navigator.vibrate?.(12); } catch { /* not every device can */ }
    }, LONG_PRESS_MS);
    press.current = { id: event.pointerId, at: [event.clientX, event.clientY], timer };
  };
  /**
   * A tap that places a device on a touch screen: it places when the finger lifts, not when it lands, so a finger that
   * moves on (a scroll) or is joined by a second one (a pinch) places nothing.
   */
  const pendingPlace = useRef<{ id: number; at: Point; meterId: string } | null>(null);
  /** Drops a drag, selection box or long press under way and puts the plan back as it was (a pinch or a pan took over). */
  const abortPointer = () => {
    clearPress();
    pendingPlace.current = null;
    if (sweep.current) { sweep.current = null; setSweepBox(null); }
    const current = drag.current;
    drag.current = null;
    if (!current) return;
    setGuides(lines => lines.length ? [] : lines);
    // What was selected before the press comes back too (pressing an item had selected it).
    setHistory(list => showPlan(list, current.before.plan, current.pressed ?? current.before.selection));
  };
  useLayoutEffect(() => { abortRef.current = abortPointer; });
  // A long press still waiting when the editor closes never fires afterwards.
  useEffect(() => () => { if (press.current) clearTimeout(press.current.timer); }, []);
  /** Screen pixels per plan unit (at the current zoom), so guides pull from the same distance on screen however big the plan is. */
  const pxPerUnit = () => { const scale = svgRef.current?.getScreenCTM()?.a; return scale && Number.isFinite(scale) && scale > 0 ? scale : 1; };
  /** The edges and centres of everything on the plan except what `skip` names, for alignment guides. */
  const targetsAround = (source: FloorPlan, skip: (item: Selection) => boolean) => guideTargets(everything(source, shown).filter(item => !skip(item)).flatMap(item => { const box = boxOf(source, item); return box ? [box] : []; }));
  const onPointerMove = (event: ReactPointerEvent) => {
    const tap = pendingPlace.current;
    if (tap && event.pointerId === tap.id) { if (Math.hypot(event.clientX - tap.at[0], event.clientY - tap.at[1]) > TOUCH_SLOP) pendingPlace.current = null; return; }
    const area = sweep.current;
    if (area) { if (area.kind === "draw" && pointTool(tool)) return; const end = toPoint(event.clientX, event.clientY); setSweepBox({ kind: area.kind, rect: area.kind === "draw" ? snappedBox(area.start, end, step) : boxBetween(area.start, end) }); return; }
    // A finger held still for a long press does not move anything; moving it further makes it a drag.
    const held = press.current;
    if (held && event.pointerId === held.id) { if (Math.hypot(event.clientX - held.at[0], event.clientY - held.at[1]) <= TOUCH_SLOP) return; clearPress(); }
    const current = drag.current;
    if (!current) return;
    if (current.mode === "rotate") {
      // In 15° steps while snapping is on (hold Cmd/Ctrl to turn freely), one undo step however far it turns.
      const raw = current.turn! + angleFrom(current.pivot!, toPoint(event.clientX, event.clientY)) - current.angle!;
      const deg = normaliseRotation(!prefs.snap || event.metaKey || event.ctrlKey ? raw : Math.round(raw / ROTATION_STEP) * ROTATION_STEP);
      if ((current.last ? current.last[0] : normaliseRotation(current.turn!)) === deg) return;
      current.last = [deg, 0]; current.moved = true;
      show(turnItem(current.original, current.selection[0]!, deg));
      return;
    }
    const [x, y] = toPoint(event.clientX, event.clientY);
    const { dx, dy, lines } = dragAmount(current, x - current.start[0], y - current.start[1], !prefs.snap || event.metaKey || event.ctrlKey);
    if (!dx && !dy && !current.moved) return;
    // The same amount as last time draws nothing new.
    if (current.last && current.last[0] === dx && current.last[1] === dy) return;
    current.last = [dx, dy]; current.moved = true;
    setGuides(lines);
    if (current.mode === "move") {
      const next = moveItems(current.original, current.selection, dx, dy, current.riders);
      // Locked items stay put: say why once, instead of silently ignoring the drag.
      if (next === current.original && !current.warned && current.selection.some(item => isLocked(current.original, item))) { current.warned = true; setNotice(t("editor.locked")); }
      show(next);
      return;
    }
    const target = current.selection[0]!;
    if (isLocked(current.original, target)) return;
    show(withBox(current.original, target, rect => resizeRect(rect, current.handle!, dx, dy, current.original.viewBox)));
  };
  /** The plan with one area, room or device box given a new box (worked out from its current one). */
  const withBox = (source: FloorPlan, target: Selection, change: (rect: Rect) => Rect): FloorPlan => target.kind === "area" ? { ...source, areas: source.areas.map(item => item.key === target.key ? { ...item, rect: change(item.rect) } : item) }
    : target.kind === "device" ? { ...source, devices: source.devices.map(item => { const rect = item.meterId === target.key ? deviceRect(item) : null; if (!rect) return item; const [x, y, w, h] = change(rect); return { ...item, position: [x + w / 2, y + h / 2] as Point, size: [w, h] as Point }; }) }
    : target.kind === "room" ? { ...source, rooms: source.rooms.map(item => item.key === target.key ? { ...item, rect: change(item.rect) } : item) } : source;
  /**
   * How far a drag goes for a pointer movement of (rawX, rawY): on the grid, or lined up with the edge or centre of a
   * nearby item when one is within reach (with the guide lines to draw). `free` (snapping off, or Cmd/Ctrl held) follows
   * the pointer exactly. A resize only moves the edges its grip pulls.
   */
  const dragAmount = (current: Drag, rawX: number, rawY: number, free: boolean): { dx: number; dy: number; lines: Guide[] } => {
    const handle = current.mode === "resize" ? current.handle! : null;
    const across = !handle || /[we]/.test(handle), upDown = !handle || /[ns]/.test(handle);
    let dx = across ? (free ? rawX : snap(rawX, grid)) : 0, dy = upDown ? (free ? rawY : snap(rawY, grid)) : 0;
    if (free || !current.targets || !current.box) return { dx, dy, lines: [] };
    const { targets, reach } = current, [bx, by, bw, bh] = current.box;
    const edges = (start: number, size: number, raw: number, low: string, high: string) => !handle ? [start + raw, start + raw + size / 2, start + raw + size] : handle.includes(low) ? [start + raw] : handle.includes(high) ? [start + size + raw] : [];
    const sx = across ? snapToLines(targets.x, edges(bx, bw, rawX, "w", "e"), reach) : null, sy = upDown ? snapToLines(targets.y, edges(by, bh, rawY, "n", "s"), reach) : null;
    if (sx) dx = rawX + sx.shift;
    if (sy) dy = rawY + sy.shift;
    const placed: Rect = handle ? resizeRect(current.box, handle, dx, dy, current.original.viewBox) : [bx + dx, by + dy, bw, bh];
    return { dx, dy, lines: [...(sx ? [guideFor(targets.x, "x", sx.at, placed)] : []), ...(sy ? [guideFor(targets.y, "y", sy.at, placed)] : [])] };
  };
  const [guides, setGuides] = useState<Guide[]>([]);
  // Pulling an edge of the drawing space: the pointer's movement in screen pixels, at the scale when the pull began.
  const edgeDrag = useRef<EdgeDrag | null>(null);
  const [stretch, setStretch] = useState<number | null>(null);
  const startEdge = (event: ReactPointerEvent, edge: Edge) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const { plan } = latest(), before = historyRef.current.present;
    // The press does not move focus (it is prevented): put it on the edge, so the editor's keys keep working.
    const handle = event.currentTarget as HTMLElement;
    handle.focus?.({ preventScroll: true });
    handle.setPointerCapture?.(event.pointerId);
    const width = svgRef.current?.getBoundingClientRect().width ?? 0;
    edgeDrag.current = { edge, startX: event.clientX, startY: event.clientY, scale: width > 0 ? width / plan.viewBox[2] : 1, original: plan, before, moved: false, warned: false };
  };
  const moveEdge = (event: ReactPointerEvent) => {
    const current = edgeDrag.current;
    if (!current) return;
    const [, , ow, oh] = current.original.viewBox;
    let next: FloorPlan;
    if (current.edge === "w" || current.edge === "n") {
      // The left or top edge: pulling it out makes the plan bigger on that side (see floor-plan-canvas).
      const size = current.edge === "w" ? snap(ow - (event.clientX - current.startX) / current.scale, grid) : snap(oh - (event.clientY - current.startY) / current.scale, grid);
      const result = resizeCanvasFrom(current.original, current.edge, size);
      if (result.blocked && !current.warned) { current.warned = true; setNotice(t("editor.cannotGrow")); }
      next = result.plan;
    } else {
      const width = current.edge === "s" ? ow : snap(ow + (event.clientX - current.startX) / current.scale, grid);
      const height = current.edge === "e" ? oh : snap(oh + (event.clientY - current.startY) / current.scale, grid);
      next = resizeCanvas(current.original, width, height);
    }
    if (!current.moved && next.viewBox.every((value, index) => value === current.original.viewBox[index])) return;
    current.moved = true;
    show(next);
    // Keep the drawing at the same scale while pulling, so the edge follows the pointer; the frame scrolls if needed.
    if (current.edge !== "s" && current.edge !== "n") setStretch(next.viewBox[2] * current.scale);
  };
  const endEdge = () => {
    const current = edgeDrag.current;
    edgeDrag.current = null; setStretch(null);
    if (current?.moved) { setHistory(list => finishChange(list, current.before, sameGeometry(list.present.plan, current.before.plan) ? current.before.plan : list.present.plan)); setError(""); }
  };
  const nudgeEdge = (event: React.KeyboardEvent, edge: Edge) => {
    const by = event.shiftKey ? 100 : 50;
    const moves: Record<string, Point> = { ArrowRight: [by, 0], ArrowLeft: [-by, 0], ArrowDown: [0, by], ArrowUp: [0, -by] };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault(); event.stopPropagation();
    // On the left or top edge, Left or Up pulls the edge outwards (bigger); Right or Down pushes it in.
    if (edge === "w" || edge === "n") {
      const result = resizeCanvasFrom(plan, edge, edge === "w" ? vw - move[0] : vh - move[1]);
      commit(result.plan);
      if (result.blocked) setNotice(t("editor.cannotGrow"));
      return;
    }
    commit(resizeCanvas(plan, vw + (edge === "s" ? 0 : move[0]), vh + (edge === "e" ? 0 : move[1])));
  };
  const edgeHandle = (edge: Edge, label: string) => <button type="button" className={`${styles.edge} ${styles[`edge-${edge}`]}`} aria-label={label} title={label}
    onPointerDown={event => startEdge(event, edge)} onPointerMove={moveEdge} onPointerUp={endEdge} onPointerCancel={endEdge} onKeyDown={event => nudgeEdge(event, edge)}><span /></button>;

  // A drag is one undo step, however far it went; once dropped, a room belongs to the area it now sits in.
  // A drag that ends where it began changes nothing: no undo step, and nothing to save. An Alt-click that never moved adds no copy.
  const endDrag = () => {
    const current = drag.current;
    drag.current = null;
    if (!current) return;
    setGuides(lines => lines.length ? [] : lines);
    if (current.copied && !current.moved) { setHistory(list => showPlan(list, current.before.plan, current.before.selection)); return; }
    if (!current.moved) { if (current.narrow) setSelection([current.narrow]); return; }
    say(next => current.mode === "resize" ? resizedText(t, boxOf(next, current.selection[0]!)) : current.mode === "rotate" ? t("a11y.rotated", { deg: current.last?.[0] ?? 0 }) : movedText(t, next, current.selection));
    setHistory(list => { const settled = settleRooms(list.present.plan); return finishChange(list, current.before, sameGeometry(settled, current.before.plan) ? current.before.plan : settled); });
    setError("");
  };
  /** Starts a selection box (or, with a tool chosen, the new item's box) where the pointer was pressed. */
  const beginSweep = (event: ReactPointerEvent, click?: Selection) => {
    const { selection } = latest();
    focusCanvas();
    svgRef.current?.setPointerCapture?.(event.pointerId);
    sweep.current = { kind: tool ? "draw" : "marquee", start: toPoint(event.clientX, event.clientY), additive: event.shiftKey || event.metaKey || event.ctrlKey, base: selection, ...(click ? { click } : {}) };
  };
  // Pressing empty space starts a selection box; with a tool chosen, pressing anywhere starts the new item's box.
  const startSweep = (event: ReactPointerEvent<SVGSVGElement>) => {
    const { plan } = latest();
    focusCanvas();
    if (event.button !== 0) return;
    if (placing) {
      if (event.pointerType === "touch") { pendingPlace.current = { id: event.pointerId, at: [event.clientX, event.clientY], meterId: placing }; return; }
      place(placing, toPoint(event.clientX, event.clientY), plan); return;
    }
    const empty = event.target === event.currentTarget || !!(event.target as Element).getAttribute?.("data-grid");
    // A press on a turned label or landmark picks it even between its lines (the point is turned back to check it).
    const hit = !tool && empty ? markAt(plan, toPoint(event.clientX, event.clientY)) : null;
    if (hit) { startDrag(event, hit); return; }
    if (!tool && !empty) return;
    beginSweep(event);
  };
  const endPointer = (event: ReactPointerEvent) => {
    clearPress();
    const tap = pendingPlace.current;
    if (tap && event.pointerId === tap.id) { pendingPlace.current = null; if (placing === tap.meterId) place(tap.meterId, toPoint(tap.at[0], tap.at[1])); return; }
    const area = sweep.current;
    if (!area) { endDrag(); return; }
    sweep.current = null; setSweepBox(null);
    const end = toPoint(event.clientX, event.clientY);
    if (area.kind === "draw") { if (tool) create(tool, area.start, snappedBox(area.start, end, step)); return; }
    // A click on empty space clears the selection (Shift keeps it); a box selects everything fully inside it.
    const box = boxBetween(area.start, end);
    if (Math.max(box[2], box[3]) < screen * 0.8) { if (area.click) setSelection(toggled(area.base, area.click)); else if (!area.additive) setSelection([]); return; }
    const found = inBox(plan, box, shown);
    setSelection(area.additive ? [...area.base, ...found.filter(item => !isIn(area.base, item))] : found);
  };
  const cancelPointer = () => { clearPress(); pendingPlace.current = null; if (sweep.current) { sweep.current = null; setSweepBox(null); } else endDrag(); };
  /** Arrow presses in a row are separate steps, but holding an arrow down is one step however far it goes. */
  const nudgeRun = useRef(0);

  // Shortcuts only while focus is inside the editor, never while typing in a field, and on a button only Undo, Redo and
  // Escape (see floor-plan-keys). Copy and Select all leave text picked on the page to the browser.
  const onKeyDown = (event: React.KeyboardEvent) => {
    // Space held on the plan: drag to move around it.
    if (viewport.keyDown(event)) return;
    // Placing a device, Enter puts it in the middle of the room or area with focus, or else in the middle of what is shown.
    if (placing && event.key === "Enter" && !event.metaKey && !event.ctrlKey && !event.altKey && svgRef.current?.contains(event.target as Node)) {
      event.preventDefault();
      const item = parseItemId((event.target as Element | null)?.getAttribute?.("data-item")), box = item ? boxOf(plan, item) : null;
      place(placing, box ? (box[2] ? centre(box) : [box[0], box[1]]) : [wx + ww / 2, wy + wh / 2]);
      return;
    }
    // With a tool chosen, Enter on the plan adds the item at its usual place, for keyboard users.
    if (tool && event.key === "Enter" && event.target === svgRef.current) { event.preventDefault(); create(tool, null, null); return; }
    const shortcut = planShortcut(event, grid);
    if (!shortcut) return;
    // Cmd/Ctrl + plus, minus or 0 zoom the plan here, never the whole page.
    if (shortcut.kind === "zoom") { event.preventDefault(); zoomTo(shortcut.how); return; }
    if (shortcut.kind === "undo" || shortcut.kind === "redo") { event.preventDefault(); if (shortcut.kind === "undo") undoStep(); else redoStep(); return; }
    if (shortcut.kind === "escape") { setPlacing(null); stopTool(); setNotice(""); sweep.current = null; setSweepBox(null); setSelection([]); setLeaving(false); return; }
    if (shortcut.kind === "cycle") { event.preventDefault(); cycle(shortcut.by); return; }
    // Enter on the item with focus selects it (Shift+Enter adds it to the selection).
    if (shortcut.kind === "select") { const item = parseItemId((event.target as Element | null)?.getAttribute?.("data-item")); if (!item) return; event.preventDefault(); setSelection(shortcut.toggle ? toggled(selection, item) : [item]); return; }
    if (shortcut.kind === "selectAll") { if (textPicked()) return; event.preventDefault(); setSelection(everything(plan, shown)); return; }
    if (shortcut.kind === "paste") { if (clipboard) { event.preventDefault(); paste(); } return; }
    // Cmd/Ctrl+D always means Duplicate here, even with nothing selected (never the browser's "Bookmark this page").
    if (shortcut.kind === "duplicate") { event.preventDefault(); duplicate(); return; }
    if (!selection.length) return;
    if (shortcut.kind === "copy") { if (!textPicked() && copy()) event.preventDefault(); return; }
    event.preventDefault();
    if (shortcut.kind === "delete") { remove(); return; }
    if (!event.repeat) nudgeRun.current += 1;
    if (shortcut.kind === "resize") { resizeByKey(shortcut.by); return; }
    const moved = moveItems(plan, selection, shortcut.by[0], shortcut.by[1], shortcut.alone ? NO_PASSENGERS() : ridersOf(plan, selection));
    if (moved === plan) { if (selection.some(item => isLocked(plan, item))) setNotice(t("editor.locked")); return; }
    say(next => movedText(t, next, selection));
    commit(settleRooms(moved), { merge: `nudge:${selection.map(item => `${item.kind}:${item.key}`).join(",")}:${nudgeRun.current}` });
  };
  /** Cmd/Ctrl+arrow: one selected area, room or device box grows (right, down) or shrinks (left, up) by a grid step. */
  const resizeByKey = (by: Point) => {
    if (!single) return;
    if (isLocked(plan, single)) { setNotice(t("editor.locked")); return; }
    const box = boxOf(plan, single);
    if (!box || !box[2]) return;
    const next = withBox(plan, single, rect => resizeRect(rect, "se", by[0], by[1], plan.viewBox));
    if (sameGeometry(next, plan)) return;
    say(placed => resizedText(t, boxOf(placed, single)));
    commit(settleRooms(next), { merge: `resize:${itemId(single)}:${nudgeRun.current}` });
  };

  // Keyboard focus on the plan's items: [ and ] move it from item to item (zoomed in, the plan moves to show it), and a
  // ring shows where it is. Focus that comes from a pointer press shows no ring.
  const [focused, setFocused] = useState<Selection | null>(null);
  const focusItem = (item: Selection) => {
    const box = boxOf(plan, item);
    if (box) viewport.reveal(box);
    const element = [...(svgRef.current?.querySelectorAll("[data-item]") ?? [])].find(node => node.getAttribute("data-item") === itemId(item)) as (Element & { focus?: (options?: FocusOptions) => void }) | undefined;
    element?.focus?.({ preventScroll: true });
    setFocused(item);
  };
  const cycle = (by: 1 | -1) => {
    const items = everything(plan, shown);
    if (!items.length) return;
    const from = focused ?? selection[0] ?? null, at = from ? items.findIndex(item => item.kind === from.kind && item.key === from.key) : -1;
    focusItem(items[at < 0 ? (by > 0 ? 0 : items.length - 1) : (at + by + items.length) % items.length]!);
  };
  const onCanvasFocus = (event: React.FocusEvent) => {
    const item = parseItemId((event.target as Element).getAttribute?.("data-item"));
    let visible = true;
    try { visible = (event.target as Element).matches(":focus-visible"); } catch { /* an older browser: show the ring */ }
    setFocused(item && visible ? item : null);
  };
  const onCanvasBlur = (event: React.FocusEvent) => { if (!svgRef.current?.contains(event.relatedTarget as Node | null)) setFocused(null); };

  // Zoom from the buttons and keys is read out; the wheel and pinches are not (they would say it many times a second).
  const zoomSpoken = useRef(false);
  const zoomTo = (how: "in" | "out" | "fit" | "actual") => {
    zoomSpoken.current = true;
    const moved = how === "in" ? viewport.zoomIn() : how === "out" ? viewport.zoomOut() : how === "fit" ? viewport.fit() : viewport.actual();
    if (!moved) { zoomSpoken.current = false; speak(t("zoom.level", { percent: viewport.percent })); }
  };
  useEffect(() => { if (zoomSpoken.current) { zoomSpoken.current = false; speak(t("zoom.level", { percent: viewport.percent })); } }, [viewport.percent]); // eslint-disable-line react-hooks/exhaustive-deps
  // After Undo, Redo or a delete, focus goes back on the plan if what had it went away.
  useLayoutEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    const svg = svgRef.current;
    if (svg && !svg.contains(document.activeElement)) focusCanvas();
  }, [history]);

  // An unsaved draft is kept in this browser while editing, and one left from before is offered back (floor-plan-draft).
  const draft = usePlanDraft({ projectId, userId, block, previous, locale, opened, plan, prefs, changed, busy: () => !!drag.current || !!sweep.current || !!edgeDrag.current, onReplaced: () => setNotice(t("draft.replaced")) });
  // The grid choices that came with a restored draft go with its undo step: Undo back to the saved plan puts the saved
  // choices back too (so a plan put back as it was saves exactly as it was), and Redo brings the draft's back.
  const restoredPrefs = useRef<{ plan: FloorPlan; before: EditorPrefs; after: EditorPrefs } | null>(null);
  const restoreDraft = () => {
    const next = draft.restore();
    if (!next) return;
    const after = editorPrefs(next);
    restoredPrefs.current = { plan: next, before: prefs, after };
    setHistory(current => commitPlan(current, next, { selection: [] }));
    setPrefs(after);
    setError(""); setNotice(t("draft.restored"));
    focusCanvas();
  };
  useEffect(() => {
    const restored = restoredPrefs.current;
    if (!restored) return;
    if (plan === opened && samePrefs(prefs, restored.after)) setPrefs(restored.before);
    else if (plan === restored.plan && samePrefs(prefs, restored.before)) setPrefs(restored.after);
  }, [plan]); // eslint-disable-line react-hooks/exhaustive-deps

  // Leaving the page with changes not saved asks first; so does Cancel, inside the page.
  useEffect(() => {
    if (!changed) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [changed]);
  const cancel = () => { if (changed) setLeaving(true); else onCancel(); };

  const save = async () => {
    setError(""); setLeaving(false);
    let reference: StoredSpatialReference;
    try { reference = referenceFromPlan(withPrefs(plan, prefs), projectId, previous, locale); } catch (reason) { setError(reason instanceof Error ? reason.message : t("editor.checkLayout")); return; }
    // The plan is saved inside Project notes, which have a size limit: say so plainly instead of failing.
    const nextNotes = notesWithReference(notes, block, reference);
    if (nextNotes.length > NOTES_LIMIT) { const format = (value: number) => value.toLocaleString(intlLocale(locale)); setError(t("editor.tooBig", { limit: format(NOTES_LIMIT), size: format(nextNotes.length) })); return; }
    setSaving(true);
    try {
      // The notes must still be the ones this page opened with. The save also sends the revision just read, which the
      // server checks for administrators (notes-only editors are checked by the notes text alone).
      const current = await configApi.reportAgentRequest<{ settings: Record<string, unknown> & { contextNotes: string } }>(projectId, "");
      if (current.settings.contextNotes !== notes) { setError(t("editor.notesChanged")); return; }
      await configApi.reportAgentRequest(projectId, "settings", { method: "PUT", body: JSON.stringify({ ...current.settings, contextNotes: nextNotes }) });
      draft.finish();
      onSaved(t("editor.saved"));
    } catch (reason) { const message = reason instanceof Error ? reason.message : ""; setError(/SETTINGS_CHANGED/.test(message) ? t("editor.notesChanged") : /ADMIN/.test(message) ? t("editor.adminOnly") : t("editor.saveFailed")); }
    finally { setSaving(false); }
  };

  const selectedArea = single?.kind === "area" ? plan.areas.find(item => item.key === single.key) : undefined;
  const selectedRoom = single?.kind === "room" ? plan.rooms.find(item => item.key === single.key) : undefined;
  const selectedDevice = single?.kind === "device" ? meterById.get(single.key) : undefined;
  const selectedPlacement = single?.kind === "device" ? plan.devices.find(item => item.meterId === single.key) : undefined;
  const singleLocked = !!single && isLocked(plan, single);
  // Corner handles for one selected item that is not locked; several selected items each get an outline.
  const handleRect = single && !singleLocked ? selectedArea?.rect ?? selectedRoom?.rect ?? (selectedPlacement && !selectedPlacement.rotation && deviceRect(selectedPlacement)) ?? undefined : undefined;
  const setDeviceShape = (meterId: string, box: boolean) => commit({ ...plan, devices: plan.devices.map(item => { if (item.meterId !== meterId) return item; const { size: _size, rotation: _turn, ...dot } = item; return box ? { ...dot, size: item.size ?? defaultDeviceSize(plan.viewBox) } : dot; }) });
  const roomColour = (rect: Rect) => { const host = plan.areas.filter(item => !item.insideRoom && contains(item.rect, centre(rect))).sort((a, b) => a.rect[2] * a.rect[3] - b.rect[2] * b.rect[3])[0]; return host ? (host.board ? colours.get(host.board) : noBoardColours.get(host.key)) : undefined; };
  const waiting = meters.filter(meter => !placedIds.has(meter.id));
  const placingName = placing ? meterById.get(placing)?.name : null;
  const own = plan.areas.filter(item => !item.insideRoom), groups = plan.areas.filter(item => item.insideRoom);
  const positions = plan.devices.map(item => item.position);

  // The actions shared by whatever is selected: duplicate, lock, and drawing order within its kind.
  const lockable = selection;
  const allLocked = lockable.length > 0 && lockable.every(item => isLocked(plan, item));
  const fronted = reorderItems(plan, selection, "front"), backed = reorderItems(plan, selection, "back");
  const actions = lockable.length > 0 ? <ArrangeActions onDuplicate={copyItems(plan, selection) ? duplicate : undefined} duplicateKey={keyName("D")} locked={allLocked} many={lockable.length > 1} onLock={() => commit(lockItems(plan, lockable, !allLocked))} order onFront={fronted !== plan ? () => commit(fronted) : undefined} onBack={backed !== plan ? () => commit(backed) : undefined} /> : null;
  const deletable = selection.some(item => !isLocked(plan, item));
  /** Line-up results: one undo step, and a short note when locked items were left where they are. */
  const arrange = (result: Arranged) => { if (result.plan !== plan) commit(settleRooms(result.plan)); if (result.skipped) setNotice(t("align.lockedSkipped")); };
  /** Typed X, Y, W or H for one item: one undo step; says whether the value had to change to fit. */
  const positionFields = (item: Selection, box: Rect, fields?: Field[]) => <PositionFields key={`position:${item.kind}:${item.key}`} box={box} origin={[vx, vy]} disabled={singleLocked} {...(fields ? { fields } : {})} onCommit={(field: Field, value: number) => { const result = placeTyped(plan, item, field, value); if (result.plan !== plan) commit(result.plan); return result.adjusted; }} />;
  // Text labels and landmarks: their own fields, kept fully inside the plan as each change is made.
  const selectedLabel = single?.kind === "label" ? plan.labels?.find(item => item.key === single.key) : undefined;
  const selectedSymbol = single?.kind === "symbol" ? plan.symbols?.find(item => item.key === single.key) : undefined;
  const without = <T extends object>(item: T, key: string, value: unknown): T => { const { [key]: _old, ...rest } = item as Record<string, unknown>; return (value === undefined ? rest : { ...rest, [key]: value }) as T; };
  const updateLabel = (key: string, change: (item: PlanLabel) => PlanLabel, merge?: string) => commit({ ...plan, labels: (plan.labels ?? []).map(item => item.key === key ? shiftLabel(change(item), 0, 0, plan.viewBox) : item) }, merge ? { merge } : undefined);
  const updateSymbol = (key: string, change: (item: PlanSymbol) => PlanSymbol, merge?: string) => commit({ ...plan, symbols: (plan.symbols ?? []).map(item => item.key === key ? shiftSymbol(change(item), 0, 0, plan.viewBox) : item) }, merge ? { merge } : undefined);
  /** A landmark changed into an entrance becomes the first entrance when the plan has none (and stays selected as that). */
  const changeKind = (key: string, kind: string) => {
    const changed = { ...plan, symbols: (plan.symbols ?? []).map(item => item.key === key ? { ...item, kind } : item) }, next = promoteEntrance(changed);
    commit(next, next !== changed ? { selection: [{ kind: "entrance", key: "entrance" }] } : undefined);
  };
  const turn = (item: Selection, deg: number) => { const next = turnItem(plan, item, deg); if (next === plan) return; say(() => t("a11y.rotated", { deg })); commit(next); };
  const markColour = (target: string, value: string | undefined, apply: (hex: string | null) => FloorPlan) => <ColourPicker key={`colour:${target}`} legend={t("panel.colour")} hint={t("panel.markColourHint")} value={value} autoLabel={t("panel.colourAutoInk")} onPick={pickColour(target, apply)} onDone={() => setHistory(endTyping)} />;
  // The turning handle and the turned outline, for the items that can turn.
  const turnable = (item: Selection) => item.kind === "label" || item.kind === "symbol" || item.kind === "entrance" || (item.kind === "device" && !!plan.devices.find(entry => entry.meterId === item.key)?.size);
  const turnFrame = single && !singleLocked && turnable(single) && (single.kind !== "device" || shown(single.key)) ? frameOf(plan, single) : null;
  const outlined = (item: Selection): Frame | null => {
    if (item.kind === "label" || item.kind === "symbol") return frameOf(plan, item);
    if (item.kind === "entrance") return plan.entrance && (plan.entrance.size !== undefined || plan.entrance.rotation) ? frameOf(plan, item) : null;
    if (item.kind === "device") { const device = plan.devices.find(entry => entry.meterId === item.key); return device?.size && device.rotation && shown(device.meterId) ? frameOf(plan, item) : null; }
    return null;
  };
  const gridCell = gridSpacing(grid, ww);
  const focusShown = focused && stillThere(plan, [focused]).length ? focused : null;
  const focusBox = focusShown ? boxOf(plan, focusShown) : null;

  const [placingBefore, placingAfter = ""] = t("editor.placing").split("{name}");
  const areaName = (label: string) => areaNameOf(t, label);

  // A live picture of the saved look, from the plan as it stands; nothing while the drawing is not yet valid. It follows
  // a step behind while dragging (a deferred value), so a drag on a big plan stays smooth.
  const previewPlan = useDeferredValue(plan);
  const preview = useMemo(() => { try { return referenceFromPlan(previewPlan, projectId, previous, locale); } catch { return null; } }, [previewPlan, projectId, previous, locale]);
  const previewMap = useMemo(() => preview ? <SiteFloorMap reference={preview} devices={mapDevices(preview, meters)} /> : null, [preview, meters]);
  // Each item on the canvas is its own small component, redrawn only when it changes; they all share one press handler.
  const downRef = useRef<ItemDown>(() => undefined);
  useLayoutEffect(() => { downRef.current = startDrag; });
  const itemDown = useCallback<ItemDown>((event, item) => downRef.current(event, item), []);
  const startPlacing = (meterId: string) => {
    setTool(null);
    const next = placing === meterId ? null : meterId;
    setPlacing(next);
    focusCanvas();
    // With the side panel under the plan, bring the plan into view so the next tap can place it.
    if (next && narrowScreen) svgRef.current?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  };
  const paletteBoards = JSON.stringify(allBoards.filter(board => meters.some(meter => meter.board === board)));
  const startPlacingRef = useRef(startPlacing);
  useLayoutEffect(() => { startPlacingRef.current = startPlacing; });
  // The device list is long on a big site: it is drawn again only when what it shows changes, never on a pointer move.
  const palette = useMemo(() => (JSON.parse(paletteBoards) as string[]).map(board => <div key={board} className={styles.paletteGroup}>
    <p><span className={styles.swatch} style={{ background: colours.get(board) ?? "var(--zone-6)" }} />{board}</p>
    <ul>{meters.filter(meter => meter.board === board).map(meter => { const onPlan = placedIds.has(meter.id); return <li key={meter.id} draggable onDragStart={event => { event.dataTransfer.setData("text/plain", meter.id); event.dataTransfer.effectAllowed = "move"; }} className={onPlan ? styles.onPlan : undefined}>
      <span className={styles.grip} aria-hidden="true">⋮⋮</span>
      <span className={styles.deviceName}><strong>{meter.name}</strong><small>{meter.type}</small></span>
      {onPlan ? <button type="button" onClick={() => { setHistory(current => selectIn(current, [{ kind: "device", key: meter.id }])); setNotice(""); }}>{t("panel.onPlan")}</button> : <button type="button" aria-pressed={placing === meter.id} onClick={() => startPlacingRef.current(meter.id)}>{t("panel.place")}</button>}
    </li>; })}</ul>
  </div>), [paletteBoards, meters, placedIds, placing, colours, t]);
  const redoKey = mac ? "⇧⌘Z" : "Ctrl+Y";
  const toolButton = (kind: Tool, label: string, hint: string, disabled = false) => <button type="button" className={styles.tool} aria-pressed={tool === kind} disabled={disabled} title={hint} onClick={() => chooseTool(kind)}>{label}</button>;
  return <section ref={sectionRef} className={`${styles.card} ${styles.editing} ${narrowScreen ? styles.narrow : ""}`} data-layout={narrowScreen ? "narrow" : "wide"} aria-label={t("editor.title")} tabIndex={-1} onKeyDown={onKeyDown} onKeyUp={viewport.keyUp}>
    <header className={styles.cardHeader}>
      <div><h4>{t("editor.title")}</h4><p>{t("editor.help", { undoKey: keyName("Z"), redoKey, copyKey: keyName("C"), pasteKey: keyName("V"), duplicateKey: keyName("D"), commandKey: mac ? "⌘" : "Ctrl" })}</p><p>{t("editor.drawingOnly")}</p></div>
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} disabled={saving} onClick={cancel}>{t("editor.cancel")}</button>
        <button type="button" className={styles.primary} disabled={saving} onClick={() => void save()}>{saving ? t("editor.saving") : t("editor.save")}</button>
      </div>
    </header>

    <div className={styles.toolbar} role="toolbar" aria-label={t("editor.tools")}>
      {toolButton("area", t("editor.addArea"), t("editor.hintArea"))}
      {toolButton("room", t("editor.addRoom"), t("editor.hintRoom"))}
      {toolButton("equipment", t("editor.addEquipment"), plan.rooms.length ? t("editor.hintEquipment") : t("editor.addRoomFirst"), !plan.rooms.length)}
      {toolButton("text", t("editor.addText"), t("editor.hintText"))}
      <LandmarkPicker chosen={tool === "landmark" ? landmark : null} hint={t("editor.hintLandmark")} onPick={chooseLandmark} />
      <button type="button" className={styles.tool} title={t("editor.hintEntrance")} onClick={addEntrance}>{t("editor.addEntrance")}</button>
      <GridMenu prefs={prefs} onChange={setPrefs} commandKey={mac ? "⌘" : "Ctrl"} />
      <ZoomControls percent={viewport.percent} edgesHidden={!!viewport.view} whole={!viewport.view} canIn={viewport.zoom < maxZoom(viewport.fitPx) - 1e-6} canOut={viewport.zoom > MIN_ZOOM + 1e-6} commandKey={mac ? "⌘" : "Ctrl"} keyFor={keyName} onIn={() => zoomTo("in")} onOut={() => zoomTo("out")} onFit={() => zoomTo("fit")} onActual={() => zoomTo("actual")} />
      <span className={styles.toolGap} />
      <button type="button" className={styles.tool} disabled={!canUndo(history)} onClick={undoStep}>{t("editor.undo")}</button>
      <button type="button" className={styles.tool} disabled={!canRedo(history)} title={t("editor.hintRedo", { redoKey })} onClick={redoStep}>{t("editor.redo")}</button>
      <button type="button" className={styles.tool} disabled={!deletable} title={t("editor.hintDelete")} onClick={remove}>{t("editor.delete")}</button>
    </div>
    {leaving && <UnsavedBar onKeep={() => setLeaving(false)} onLeave={() => { draft.finish(); onCancel(); }} />}
    {draft.offer && <DraftOffer savedAt={draft.offer.savedAt} stale={draft.offer.stale} onRestore={restoreDraft} onDiscard={() => { draft.discard(); focusCanvas(); }} />}
    <p id={keysId} className={styles.srOnly}>{t("a11y.keys", { commandKey: mac ? "⌘" : "Ctrl" })}</p>
    {placingName && <p className={styles.placing} role="status">{placingBefore}<strong>{placingName}</strong>{placingAfter} <button type="button" onClick={() => setPlacing(null)}>{t("editor.cancel")}</button></p>}
    {tool && <p className={styles.placing} role="status">{t(TOOL_STATUS[tool], { name: kindName(landmark ?? "entrance") })} <button type="button" onClick={() => { stopTool(); setNotice(""); }}>{t("editor.cancel")}</button></p>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}

    <div className={styles.editorBody}>
      <div className={styles.canvasFrame}>
        {/* The drawing space; pull its right or bottom edge (or the corner) to make it bigger or smaller. */}
        <div className={styles.stage} style={stretch ? { width: stretch } : undefined}>
        <svg ref={svgRef} viewBox={`${wx} ${wy} ${ww} ${wh}`} className={`${mapStyles.map} ${styles.canvas} ${placing || tool ? styles.placingCursor : ""} ${viewport.panning ? styles.panning : viewport.spaceHeld ? styles.panReady : ""}`} role="application" aria-label={t("editor.canvas")} aria-describedby={keysId} tabIndex={0}
          {...viewport.handlers} onFocus={onCanvasFocus} onBlur={onCanvasBlur}
          onPointerMove={onPointerMove} onPointerUp={endPointer} onPointerCancel={cancelPointer} onPointerDown={startSweep}
          onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const id = event.dataTransfer.getData("text/plain"); if (meterById.has(id)) place(id, toPoint(event.clientX, event.clientY)); }}>
          {/* The grid (the Grid menu can hide it); the empty space under it still takes clicks either way. */}
          {prefs.showGrid && <defs><pattern id="floor-plan-grid" width={gridCell} height={gridCell} patternUnits="userSpaceOnUse"><path d={`M${gridCell} 0 L0 0 0 ${gridCell}`} className={styles.gridLine} /></pattern></defs>}
          <rect data-grid="1" x={vx} y={vy} width={vw} height={vh} fill={prefs.showGrid ? "url(#floor-plan-grid)" : "transparent"} />
          {own.map(item => <AreaShape key={item.key} item={item} colour={areaColour(item)} name={areaName(item.label)} unit={unit} label={areaItemName(t, item)} onDown={itemDown} />)}
          {plan.rooms.map(room => <RoomShape key={room.key} room={room} colour={room.colour ?? roomColour(room.rect)} pinned={roomHasPins(room.rect, positions)} unit={unit} label={t("a11y.room", { name: room.name })} onDown={itemDown} />)}
          {groups.map(item => <GroupShape key={item.key} item={item} colour={areaColour(item)} pinned={roomHasPins(item.rect, positions)} fallback={t("panel.groupFallback")} unit={unit} label={areaItemName(t, item)} onDown={itemDown} />)}
          {(plan.labels ?? []).map(item => <LabelShape key={item.key} item={item} unit={unit} label={t("a11y.label", { name: item.text })} onDown={itemDown} />)}
          {(plan.symbols ?? []).map(item => <SymbolShape key={item.key} item={item} unit={unit} label={symbolName(t, item, kindName)} fallback={t("name.entrance")} onDown={itemDown} />)}
          {plan.entrance && <EntranceShape entrance={plan.entrance} selected={isIn(selection, { kind: "entrance", key: "entrance" })} unit={unit} label={t("a11y.entrance", { name: plan.entrance.label })} onDown={itemDown} />}
          {plan.devices.map(item => { const meter = meterById.get(item.meterId); if (!meter) return null; return <DeviceShape key={item.meterId} item={item} name={meter.name} board={meter.board} colour={item.colour ?? colours.get(meter.board) ?? "var(--zone-6)"} pin={item.size ? "" : pinLabel(meter.name, item.position, plan.rooms, groups)} selected={isIn(selection, { kind: "device", key: item.meterId })} unit={unit} label={t("a11y.device", { name: meter.name })} onDown={itemDown} />; })}
          {/* A padlock on each locked item, so it is clear why it does not move. */}
          {everything(plan, shown).filter(item => isLocked(plan, item)).map(item => { const [x, y, w] = boxOf(plan, item)!, size = unit * 1.9; return <LockBadge key={`lock:${item.kind}:${item.key}`} x={w ? x + w - size - unit * 0.4 : x + unit * 1} y={w ? y + unit * 0.4 : y - unit * 2.9} size={size} className={styles.lockBadge} label={t("editor.lockedBadge")} />; })}
          {selection.map(item => { const frame = outlined(item); if (frame) return <polygon key={`selected:${item.kind}:${item.key}`} data-turned="1" points={frameCorners(frame).map(point => point.join(",")).join(" ")} className={styles.turnBox} />; const at = boxOf(plan, item); if (!at || !at[2] || (item.kind === "device" && !shown(item.key))) return null; const [x, y, w, h] = at; return <rect key={`selected:${item.kind}:${item.key}`} x={x} y={y} width={w} height={h} className={styles.selectBox} />; })}
          {focusBox && focusShown && (focusBox[2] ? <rect data-focus-ring="1" x={focusBox[0] - perPx * RING_PX} y={focusBox[1] - perPx * RING_PX} width={focusBox[2] + perPx * RING_PX * 2} height={focusBox[3] + perPx * RING_PX * 2} rx={perPx * RING_PX} className={styles.focusRing} />
            : <circle data-focus-ring="1" cx={focusBox[0]} cy={focusShown.kind === "entrance" ? focusBox[1] + unit * 1.2 : focusBox[1]} r={Math.max(focusShown.kind === "entrance" ? unit * 3.2 : unit * 2.2, perPx * RING_PX * 2.5)} className={styles.focusRing} />)}
          {handleRect && (() => { const [x, y, w, h] = handleRect; const size = perPx * (coarse ? TOUCH_GRIP_PX : GRIP_PX); const spot: Record<Handle, Point> = { nw: [x, y], n: [x + w / 2, y], ne: [x + w, y], e: [x + w, y + h / 2], se: [x + w, y + h], s: [x + w / 2, y + h], sw: [x, y + h], w: [x, y + h / 2] };
            // Grips on the middle of each edge resize one side only; they show where the side is long enough to tell them from the corners.
            const handles: Handle[] = [...CORNERS, ...(w >= size * 4 ? ["n", "s"] as const : []), ...(h >= size * 4 ? ["e", "w"] as const : [])];
            return <g>
            {handles.map(handle => <rect key={handle} data-handle={handle} x={spot[handle][0] - size / 2} y={spot[handle][1] - size / 2} width={size} height={size} rx={size * 0.2} className={`${styles.handle} ${styles[handle]}`} onPointerDown={event => startDrag(event, single!, "resize", handle)} />)}
          </g>; })()}
          {turnFrame && (() => { const { from, to } = handleSpot(turnFrame, perPx * TURN_PX), r = perPx * (coarse ? TOUCH_GRIP_PX : GRIP_PX) / 2;
            return <g><line x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} className={styles.turnLine} /><circle data-turn="1" cx={to[0]} cy={to[1]} r={r} className={styles.turnHandle} onPointerDown={event => startTurn(event, single!)}><title>{t("rotate.handle")}</title></circle></g>; })()}
          {guides.map(guide => { const pad = screen; return guide.axis === "x" ? <line key={`x${guide.at}`} data-guide="x" x1={guide.at} x2={guide.at} y1={guide.from - pad} y2={guide.to + pad} className={styles.guide} /> : <line key={`y${guide.at}`} data-guide="y" x1={guide.from - pad} x2={guide.to + pad} y1={guide.at} y2={guide.at} className={styles.guide} />; })}
          {sweepBox && <rect x={sweepBox.rect[0]} y={sweepBox.rect[1]} width={sweepBox.rect[2]} height={sweepBox.rect[3]} className={sweepBox.kind === "draw" ? styles.drawBox : styles.marquee} />}
        </svg>
        {/* The edges of the drawing space are at the frame's edges only while the whole plan is shown. */}
        {!viewport.view && <>{edgeHandle("w", t("editor.edgeLeft"))}{edgeHandle("n", t("editor.edgeTop"))}{edgeHandle("e", t("editor.edgeRight"))}{edgeHandle("s", t("editor.edgeBottom"))}{edgeHandle("se", t("editor.edgeCorner"))}</>}
        </div>
      </div>

      <aside className={styles.side}>
        {selection.length > 1 && <div className={styles.panel}>
          <h5>{t("panel.selected", { count: selection.length })}</h5>
          <p className={styles.hint}>{t("panel.selectedHint")}</p>
          <LineUpActions count={selection.length} sizable={selection.filter(item => sizable(plan, item)).length > 1} onAlign={how => arrange(alignItems(plan, selection, how))} onDistribute={axis => arrange(distributeItems(plan, selection, axis))} onSize={dimension => arrange(sameSize(plan, selection, dimension))} />
          {actions}
          <button type="button" className={styles.danger} disabled={!deletable} onClick={remove}>{t("editor.delete")}</button>
        </div>}
        {selectedArea && <div className={styles.panel}>
          <h5>{selectedArea.insideRoom ? t("panel.group") : t("panel.area")}</h5>
          <label>{t("panel.label")}<input value={selectedArea.label} maxLength={40} {...typing} onChange={event => updateArea(selectedArea.key, { label: event.target.value }, `label:${selectedArea.key}`)} /></label>
          <label>{t("panel.board")}<select value={selectedArea.board} onChange={event => updateArea(selectedArea.key, { board: event.target.value })}><option value="">{t("panel.noBoard")}</option>{allBoards.map(board => <option key={board} value={board}>{board}</option>)}</select></label>
          {positionFields(single!, selectedArea.rect)}
          {colourPicker(`area:${selectedArea.key}`, selectedArea.colour, selectedArea.board ? t("panel.colourAuto", { board: selectedArea.board }) : t("panel.colourAutoNone"), hex => ({ ...plan, areas: plan.areas.map(item => item.key === selectedArea.key ? recolour(item, hex) : item) }))}
          {selectedArea.board && <ColourPicker key={`board:${selectedArea.board}:${selectedArea.key}`} legend={t("panelColour.title")} hint={t("panelColour.hint", { board: selectedArea.board })} value={plan.colours?.[selectedArea.board]} autoLabel={t("panelColour.auto")} onPick={pickColour(`board:${selectedArea.board}`, hex => withBoardColour(plan, selectedArea.board, hex))} onDone={() => setHistory(endTyping)} />}
          <label>{t("panel.shownAs")}<select value={selectedArea.insideRoom ?? ""} disabled={singleLocked} onChange={event => { const room = plan.rooms.find(item => item.key === event.target.value); commit({ ...plan, areas: plan.areas.map(item => item.key !== selectedArea.key ? item : room ? asGroupIn(item, room) : asOwnArea(item)) }); }}>
            <option value="">{t("panel.ownArea")}</option>{plan.rooms.map(room => <option key={room.key} value={room.key}>{t("panel.insideRoom", { room: room.name })}</option>)}
          </select></label>
          {selectedArea.insideRoom && <label>{t("panel.supplies")}<input value={selectedArea.equipment ?? ""} maxLength={80} {...typing} placeholder={t("panel.suppliesExample")} onChange={event => updateArea(selectedArea.key, { equipment: event.target.value }, `equipment:${selectedArea.key}`)} /></label>}
          {actions}
          <button type="button" className={styles.danger} disabled={singleLocked} onClick={remove}>{selectedArea.insideRoom ? t("panel.deleteGroup") : t("panel.deleteArea")}</button>
        </div>}
        {selectedRoom && <div className={styles.panel}>
          <h5>{t("panel.room")}</h5>
          <label>{t("panel.name")}<input value={selectedRoom.name} maxLength={60} {...typing} onChange={event => commit({ ...plan, rooms: plan.rooms.map(item => item.key === selectedRoom.key ? { ...item, name: event.target.value } : item) }, { merge: `name:${selectedRoom.key}` })} /></label>
          {positionFields(single!, selectedRoom.rect)}
          {colourPicker(`room:${selectedRoom.key}`, selectedRoom.colour, t("panel.colourAutoRoom"), hex => ({ ...plan, rooms: plan.rooms.map(item => item.key === selectedRoom.key ? recolour(item, hex) : item) }))}
          {actions}
          <button type="button" className={styles.danger} disabled={singleLocked} onClick={remove}>{t("panel.deleteRoom")}</button>
        </div>}
        {selectedDevice && <div className={styles.panel}>
          <h5>{t("panel.device")}</h5>
          <p><strong>{selectedDevice.name}</strong><br /><small>{selectedDevice.type} · {selectedDevice.board}</small></p>
          <label>{t("panel.showAs")}<select value={selectedPlacement?.size ? "box" : "dot"} disabled={singleLocked} onChange={event => setDeviceShape(selectedDevice.id, event.target.value === "box")}>
            <option value="dot">{t("panel.showDot")}</option><option value="box">{t("panel.showBox")}</option>
          </select></label>
          {selectedPlacement?.size && positionFields(single!, deviceRect(selectedPlacement)!)}
          {selectedPlacement?.size && <RotationField key={`turn:${selectedPlacement.meterId}`} value={selectedPlacement.rotation ?? 0} disabled={singleLocked} commandKey={mac ? "⌘" : "Ctrl"} onCommit={deg => turn(single!, deg)} />}
          {selectedPlacement?.rotation && selectedPlacement.size ? <p className={styles.hint}>{t("rotate.boxNote")}</p> : null}
          {colourPicker(`device:${selectedDevice.id}`, selectedPlacement?.colour, t("panel.colourAuto", { board: selectedDevice.board }), hex => ({ ...plan, devices: plan.devices.map(item => item.meterId === selectedDevice.id ? recolour(item, hex) : item) }))}
          {actions}
          <button type="button" className={styles.danger} disabled={singleLocked} onClick={remove}>{t("panel.takeOff")}</button>
        </div>}
        {single?.kind === "entrance" && plan.entrance && <SymbolPanel symbol={{ key: "entrance", kind: "entrance", label: plan.entrance.label, ...(plan.entrance.size !== undefined ? { size: plan.entrance.size } : {}), ...(plan.entrance.rotation ? { rotation: plan.entrance.rotation } : {}) }} entrance
          onCaption={text => commit({ ...plan, entrance: { ...plan.entrance!, label: text } }, { merge: "entrance:label" })} onSize={size => commit({ ...plan, entrance: { ...plan.entrance!, size } })}
          colour={markColour("entrance", plan.entrance.colour, hex => ({ ...plan, entrance: recolour(plan.entrance!, hex) }))} actions={actions} locked={singleLocked} typing={typing} commandKey={mac ? "⌘" : "Ctrl"} unit={unit} onRotate={deg => turn(single, deg)} onDelete={remove} />}
        {selectedLabel && <LabelPanel label={selectedLabel} onText={text => updateLabel(selectedLabel.key, item => ({ ...item, text }), `text:${selectedLabel.key}`)} onSize={size => updateLabel(selectedLabel.key, item => without(item, "size", size === "m" ? undefined : size))} onBold={bold => updateLabel(selectedLabel.key, item => without(item, "bold", bold || undefined))}
          colour={markColour(`label:${selectedLabel.key}`, selectedLabel.colour, hex => ({ ...plan, labels: (plan.labels ?? []).map(item => item.key === selectedLabel.key ? recolour(item, hex) : item) }))} position={positionFields(single!, boxOf(plan, single!)!, ["x", "y"])} actions={actions} locked={singleLocked} typing={typing} commandKey={mac ? "⌘" : "Ctrl"} unit={unit} onRotate={deg => turn(single!, deg)} onDelete={remove} />}
        {selectedSymbol && <SymbolPanel symbol={selectedSymbol} onKind={kind => changeKind(selectedSymbol.key, kind)} onCaption={text => updateSymbol(selectedSymbol.key, item => without(item, "label", text || undefined), `caption:${selectedSymbol.key}`)} onSize={size => updateSymbol(selectedSymbol.key, item => ({ ...item, size }))}
          colour={markColour(`symbol:${selectedSymbol.key}`, selectedSymbol.colour, hex => ({ ...plan, symbols: (plan.symbols ?? []).map(item => item.key === selectedSymbol.key ? recolour(item, hex) : item) }))} position={positionFields(single!, boxOf(plan, single!)!, ["x", "y"])} actions={actions} locked={singleLocked} typing={typing} commandKey={mac ? "⌘" : "Ctrl"} unit={unit} onRotate={deg => turn(single!, deg)} onDelete={remove} />}

        {hidden.length > 0 && <div className={styles.panel}>
          <h5>{t("hidden.title")}</h5>
          <p className={styles.hint}>{t("hidden.hint")}</p>
          <ul className={styles.hiddenList}>{hidden.map((item, index) => <li key={index}>{areaName(item.id)}{item.board ? <small> · {item.board}</small> : null}</li>)}</ul>
        </div>}
        <div className={styles.panel} role="radiogroup" aria-label={t("style.title")}>
          <h5>{t("style.title")}</h5>
          <p className={styles.hint}>{t("style.hint")}</p>
          <div className={styles.styleChoices}>{PLAN_STYLES.map(look => { const chosen = planStyleOf(plan) === look; return <button key={look} type="button" role="radio" aria-checked={chosen} className={`${styles.styleChoice} ${chosen ? styles.styleChosen : ""}`} onClick={() => { if (!chosen) commit({ ...plan, style: look }); }}>
            <span className={`${styles.styleSwatch} ${styles[`swatch_${look}`]}`} aria-hidden="true" />
            <span><strong>{t(`style.${look}`)}</strong><small>{t(`style.${look}Hint`)}</small></span>
          </button>; })}</div>
          {previewMap && <><p className={styles.previewTitle}>{t("style.preview")}</p><div className={styles.previewFrame}>{previewMap}</div></>}
        </div>
        <div className={styles.panel}>
          <div className={styles.paletteHead}><h5>{t("panel.devices")}</h5><span>{t("panel.placedCount", { placed: plan.devices.filter(item => meterById.has(item.meterId)).length, total: meters.length })}</span></div>
          {waiting.length > 0 && <button type="button" className={styles.tool} onClick={() => commit(autoPlace(plan, meters))}>{t("panel.placeRest")}</button>}
          <p className={styles.hint}>{t("panel.hint")}</p>
          {palette}
        </div>
      </aside>
    </div>
    {/* Read out politely by screen readers: what was selected, moved, resized, added, deleted, undone or redone. */}
    <div className={styles.srOnly} aria-live="polite" aria-atomic="true" data-live="plan">{live}</div>
  </section>;
}
