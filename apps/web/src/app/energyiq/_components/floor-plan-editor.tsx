"use client";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { configApi } from "../../../lib/config-api";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { floorPlanMessages } from "./floor-plan-messages";
import { EnergyIcon } from "./icons";
import { boardColours, DeviceBox, mapDevices, PANEL_COLOURS, pinLabel, roomHasPins, SiteFloorMap, wrapLabel } from "./site-floor-map";
import {
  autoPlace, centre, clampPoint, clampRect, contains, NO_PASSENGERS, settleRooms, defaultDeviceSize, deviceRect, moveSelection, resizeCanvas, notesWithReference, passengers, planFromReference, referenceFromPlan, removeSelection, resizeRect, snap, starterPlan,
  type FloorPlan, type Handle, type PlanArea, type Point, type Rect, type Selection, type StoredSpatialReference,
} from "./floor-plan-model";
import mapStyles from "./site-floor-map.module.css";
import styles from "./floor-plan-editor.module.css";

export type PlanMeter = { id: string; name: string; board: string; type: string };
const GRID = 10;
const HANDLES: Handle[] = ["nw", "ne", "sw", "se"];

/**
 * The floor plan inside the Floor layout workspace: the selected location's boards stand out, and clicking an area
 * or a device selects it in the Locations list.
 */
export function FloorPlanView({ reference, meters, highlight, focusDevice, canEdit, onEdit, onSelectBoard, onSelectDevice }: { reference: StoredSpatialReference | null; meters: PlanMeter[]; highlight: string[] | null; focusDevice: string | null; canEdit: boolean; onEdit: () => void; onSelectBoard: (board: string) => void; onSelectDevice: (id: string) => void }) {
  const [open, setOpen] = useState(() => { try { return window.localStorage.getItem("energyiq.floorPlanOpen") !== "false"; } catch { return true; } });
  const toggle = () => setOpen(current => { try { window.localStorage.setItem("energyiq.floorPlanOpen", String(!current)); } catch { /* per-browser convenience only */ } return !current; });
  const t = useMessages(floorPlanMessages);
  const placed = reference ? mapDevices(reference, meters) : [];
  return <section className={styles.embedded} aria-label={t("view.title")}>
    <header className={styles.embeddedHeader}>
      <div><h4>{t("view.title")}</h4><p>{reference ? t("view.summary", { placed: placed.length, total: meters.length }) : t("view.empty")}</p></div>
      <div className={styles.actions}>
        {canEdit && <button type="button" className={styles.secondary} onClick={onEdit}><EnergyIcon name="map" />{reference ? t("view.edit") : t("view.draw")}</button>}
        {reference && <button type="button" className={styles.secondary} aria-expanded={open} onClick={toggle}>{open ? t("view.hide") : t("view.show")}</button>}
      </div>
    </header>
    {reference && open && <div className={styles.mapFrame}><SiteFloorMap reference={reference} devices={placed} highlight={highlight} focusDevice={focusDevice} onSelectBoard={onSelectBoard} onOpenDevice={onSelectDevice} /></div>}
  </section>;
}

type Drag = { mode: "move" | "resize"; selection: Selection; handle?: Handle; start: Point; original: FloorPlan; riders: ReturnType<typeof passengers>; moved: boolean };
/** Which edge of the drawing space is being pulled: right (wider), bottom (taller) or the corner (both). */
type Edge = "e" | "s" | "se";
type EdgeDrag = { edge: Edge; startX: number; startY: number; scale: number; original: FloorPlan; moved: boolean };

/** Full-width editor: design areas and rooms, place devices, then save to the layout block in Project notes. */
export function FloorPlanEditor({ projectId, notes, block, previous, meters, boards, onCancel, onSaved }: { projectId: string; notes: string; block: string | null; previous: StoredSpatialReference | null; meters: PlanMeter[]; boards: string[]; onCancel: () => void; onSaved: (message: string) => void }) {
  const t = useMessages(floorPlanMessages);
  const { locale } = useEnergyIqLocale();
  const [plan, setPlan] = useState<FloorPlan>(() => previous ? planFromReference(previous, locale) : starterPlan(boards, locale));
  const [history, setHistory] = useState<FloorPlan[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [placing, setPlacing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [vx, vy, vw, vh] = plan.viewBox;
  const unit = vw / 100;
  const allBoards = [...new Set([...boards, ...plan.areas.map(item => item.board)])];
  const colours = boardColours(allBoards, plan.colours);
  /** Each area, equipment box, room and device can have its own colour; without one it follows its panel (a room, its area). */
  const recolour = <T extends { colour?: string }>(item: T, hex: string | null): T => { const { colour: _old, ...rest } = item; return (hex ? { ...rest, colour: hex } : rest) as T; };
  const colourPicker = (value: string | undefined, autoLabel: string, onChange: (hex: string | null) => void) => <fieldset className={styles.colourField}><legend>{t("panel.colour")}</legend>
    <div className={styles.swatches}>
      {PANEL_COLOURS.map(item => <button type="button" key={item.key} className={styles.swatchButton} style={{ background: item.hex }} aria-label={t(`colour.${item.key}`)} title={t(`colour.${item.key}`)} aria-pressed={value === item.hex} onClick={() => onChange(item.hex)} />)}
      <button type="button" className={styles.autoColour} aria-pressed={!value} onClick={() => onChange(null)}>{autoLabel}</button>
    </div>
    <small>{t("panel.colourHint")}</small>
  </fieldset>;
  const meterById = new Map(meters.map(meter => [meter.id, meter]));
  const placedIds = new Set(plan.devices.map(item => item.meterId));

  const commit = (next: FloorPlan) => { setHistory(current => [...current.slice(-49), plan]); setPlan(next); setError(""); };
  const undo = () => { const last = history[history.length - 1]; if (!last) return; setHistory(history.slice(0, -1)); setPlan(last); setSelection(null); };
  const toPoint = (clientX: number, clientY: number): Point => {
    const svg = svgRef.current, matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return [vx + vw / 2, vy + vh / 2];
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return [point.x, point.y];
  };
  const place = (meterId: string, at: Point) => { commit({ ...plan, devices: [...plan.devices.filter(item => item.meterId !== meterId), { meterId, position: clampPoint([snap(at[0], GRID), snap(at[1], GRID)], plan.viewBox) }] }); setSelection({ kind: "device", key: meterId }); setPlacing(null); };
  const remove = () => { if (!selection) return; commit(removeSelection(plan, selection)); setSelection(null); };
  const nextLabel = () => { for (let index = 0; index < 26; index += 1) { const label = String.fromCharCode(65 + index); if (!plan.areas.some(item => item.label === label)) return label; } return t("name.area", { id: plan.areas.length + 1 }); };
  const addArea = (board: string) => {
    const key = `area-${Date.now()}`;
    commit({ ...plan, areas: [...plan.areas, { key, label: nextLabel(), board, rect: clampRect([vx + 20, vy + 20, vw * 0.35, vh * 0.55], plan.viewBox) }] });
    setSelection({ kind: "area", key });
  };
  const addRoom = () => {
    const host = (selection?.kind === "area" ? plan.areas.find(item => item.key === selection.key && !item.insideRoom) : undefined) ?? plan.areas.find(item => !item.insideRoom);
    const [hx, hy] = host ? host.rect : [vx + 20, vy + 20];
    const key = `room-${Date.now()}`;
    const roomName = (number: number) => t("name.newRoom", { number });
    let number = plan.rooms.length + 1; while (plan.rooms.some(room => room.name === roomName(number))) number += 1;
    commit({ ...plan, rooms: [...plan.rooms, { key, name: roomName(number), rect: clampRect([hx + 20, hy + 50, 180, 110], plan.viewBox), ...(host ? { area: host.key } : {}) }] });
    setSelection({ kind: "room", key });
  };
  /** An equipment group inside a room, such as a DB3 bank of LED screens in the showroom: pick its board and what it supplies next. */
  const addEquipment = () => {
    const room = (selection?.kind === "room" ? plan.rooms.find(item => item.key === selection.key) : undefined) ?? plan.rooms[0];
    if (!room) return;
    const hostBoard = plan.areas.filter(item => !item.insideRoom && contains(item.rect, centre(room.rect))).sort((a, b) => a.rect[2] * a.rect[3] - b.rect[2] * b.rect[3])[0]?.board;
    const board = allBoards.find(item => !plan.areas.some(area => area.board === item)) ?? hostBoard ?? allBoards[0] ?? "";
    const [rx, ry, rw, rh] = room.rect, height = Math.min(60, rh * 0.4);
    const key = `group-${Date.now()}`;
    commit({ ...plan, areas: [...plan.areas, { key, label: nextLabel(), board, insideRoom: room.key, equipment: "", rect: clampRect([rx + 12, ry + rh - height - 12, Math.max(20, rw - 24), height], plan.viewBox) }] });
    setSelection({ kind: "area", key });
  };
  const addEntrance = () => { commit({ ...plan, entrance: { label: t("name.mainEntrance"), position: [vx + vw / 2, vy + vh - 40] } }); setSelection({ kind: "entrance", key: "entrance" }); };
  const updateArea = (key: string, patch: Partial<PlanArea>) => commit({ ...plan, areas: plan.areas.map(item => item.key === key ? { ...item, ...patch } : item) });

  const startDrag = (event: ReactPointerEvent, next: Selection, mode: Drag["mode"] = "move", handle?: Handle) => {
    if (placing || event.button !== 0) return;
    event.stopPropagation();
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    setSelection(next);
    drag.current = { mode, selection: next, ...(handle ? { handle } : {}), start: toPoint(event.clientX, event.clientY), original: plan, riders: event.altKey ? NO_PASSENGERS() : passengers(plan, next), moved: false };
  };
  const onPointerMove = (event: ReactPointerEvent) => {
    const current = drag.current;
    if (!current) return;
    const [x, y] = toPoint(event.clientX, event.clientY);
    const dx = snap(x - current.start[0], GRID), dy = snap(y - current.start[1], GRID);
    if (!dx && !dy && !current.moved) return;
    current.moved = true;
    if (current.mode === "move") setPlan(moveSelection(current.original, current.selection, dx, dy, current.riders));
    else {
      const resize = (rect: Rect) => resizeRect(rect, current.handle!, dx, dy, current.original.viewBox);
      const key = current.selection.key;
      setPlan(current.selection.kind === "area" ? { ...current.original, areas: current.original.areas.map(item => item.key === key ? { ...item, rect: resize(item.rect) } : item) }
        : current.selection.kind === "device" ? { ...current.original, devices: current.original.devices.map(item => { const rect = item.meterId === key ? deviceRect(item) : null; if (!rect) return item; const [x, y, w, h] = resize(rect); return { ...item, position: [x + w / 2, y + h / 2] as Point, size: [w, h] as Point }; }) }
        : { ...current.original, rooms: current.original.rooms.map(item => item.key === key ? { ...item, rect: resize(item.rect) } : item) });
    }
  };
  // Pulling an edge of the drawing space: the pointer's movement in screen pixels, at the scale when the pull began.
  const edgeDrag = useRef<EdgeDrag | null>(null);
  const [stretch, setStretch] = useState<number | null>(null);
  const startEdge = (event: ReactPointerEvent, edge: Edge) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
    const width = svgRef.current?.getBoundingClientRect().width ?? 0;
    edgeDrag.current = { edge, startX: event.clientX, startY: event.clientY, scale: width > 0 ? width / vw : 1, original: plan, moved: false };
  };
  const moveEdge = (event: ReactPointerEvent) => {
    const current = edgeDrag.current;
    if (!current) return;
    const [, , ow, oh] = current.original.viewBox;
    const width = current.edge === "s" ? ow : snap(ow + (event.clientX - current.startX) / current.scale, GRID);
    const height = current.edge === "e" ? oh : snap(oh + (event.clientY - current.startY) / current.scale, GRID);
    const next = resizeCanvas(current.original, width, height);
    if (!current.moved && next.viewBox[2] === ow && next.viewBox[3] === oh) return;
    current.moved = true;
    setPlan(next);
    // Keep the drawing at the same scale while pulling, so the edge follows the pointer; the frame scrolls if needed.
    if (current.edge !== "s") setStretch(next.viewBox[2] * current.scale);
  };
  const endEdge = () => {
    const current = edgeDrag.current;
    edgeDrag.current = null; setStretch(null);
    if (current?.moved) { setHistory(list => [...list.slice(-49), current.original]); setError(""); }
  };
  const nudgeEdge = (event: React.KeyboardEvent, edge: Edge) => {
    const step = event.shiftKey ? GRID * 10 : GRID * 5;
    const moves: Record<string, Point> = { ArrowRight: [step, 0], ArrowLeft: [-step, 0], ArrowDown: [0, step], ArrowUp: [0, -step] };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault(); event.stopPropagation();
    commit(resizeCanvas(plan, vw + (edge === "s" ? 0 : move[0]), vh + (edge === "e" ? 0 : move[1])));
  };
  const edgeHandle = (edge: Edge, label: string) => <button type="button" className={`${styles.edge} ${styles[`edge-${edge}`]}`} aria-label={label} title={label}
    onPointerDown={event => startEdge(event, edge)} onPointerMove={moveEdge} onPointerUp={endEdge} onPointerCancel={endEdge} onKeyDown={event => nudgeEdge(event, edge)}><span /></button>;

  // Once dropped, a room belongs to the area it now sits in (it keeps its area where areas overlap).
  const endDrag = () => { const current = drag.current; drag.current = null; if (current?.moved) { setHistory(list => [...list.slice(-49), current.original]); setPlan(settleRooms(plan)); setError(""); } };

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !typing) { event.preventDefault(); undo(); return; }
      if (event.key === "Escape") { setPlacing(null); setSelection(null); return; }
      if (typing || !selection) return;
      if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); remove(); return; }
      const step = event.shiftKey ? GRID * 5 : GRID;
      const arrows: Record<string, Point> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const move = arrows[event.key];
      if (move) { event.preventDefault(); commit(settleRooms(moveSelection(plan, selection, move[0], move[1], event.altKey ? NO_PASSENGERS() : passengers(plan, selection)))); }
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  });

  const save = async () => {
    setError("");
    let reference: StoredSpatialReference;
    try { reference = referenceFromPlan(plan, projectId, previous, locale); } catch (reason) { setError(reason instanceof Error ? reason.message : t("editor.checkLayout")); return; }
    setSaving(true);
    try {
      const current = await configApi.reportAgentRequest<{ settings: Record<string, unknown> & { contextNotes: string } }>(projectId, "");
      if (current.settings.contextNotes !== notes) { setError(t("editor.notesChanged")); return; }
      await configApi.reportAgentRequest(projectId, "settings", { method: "PUT", body: JSON.stringify({ ...current.settings, contextNotes: notesWithReference(notes, block, reference) }) });
      onSaved(t("editor.saved"));
    } catch (reason) { setError(reason instanceof Error && /ADMIN/.test(reason.message) ? t("editor.adminOnly") : t("editor.saveFailed")); }
    finally { setSaving(false); }
  };

  const selectedArea = selection?.kind === "area" ? plan.areas.find(item => item.key === selection.key) : undefined;
  const selectedRoom = selection?.kind === "room" ? plan.rooms.find(item => item.key === selection.key) : undefined;
  const selectedDevice = selection?.kind === "device" ? meterById.get(selection.key) : undefined;
  const selectedPlacement = selection?.kind === "device" ? plan.devices.find(item => item.meterId === selection.key) : undefined;
  const selectedRect = selectedArea?.rect ?? selectedRoom?.rect ?? (selectedPlacement && deviceRect(selectedPlacement)) ?? undefined;
  const setDeviceShape = (meterId: string, box: boolean) => commit({ ...plan, devices: plan.devices.map(item => { if (item.meterId !== meterId) return item; const { size: _size, ...dot } = item; return box ? { ...dot, size: item.size ?? defaultDeviceSize(plan.viewBox) } : dot; }) });
  const roomColour = (rect: Rect) => { const host = plan.areas.filter(item => !item.insideRoom && contains(item.rect, centre(rect))).sort((a, b) => a.rect[2] * a.rect[3] - b.rect[2] * b.rect[3])[0]; return host ? colours.get(host.board) : undefined; };
  const waiting = meters.filter(meter => !placedIds.has(meter.id));
  const placingName = placing ? meterById.get(placing)?.name : null;
  const own = plan.areas.filter(item => !item.insideRoom), groups = plan.areas.filter(item => item.insideRoom);
  const positions = plan.devices.map(item => item.position);

  const [placingBefore, placingAfter = ""] = t("editor.placing").split("{name}");
  const areaName = (label: string) => label.length <= 2 ? t("name.area", { id: label }) : label;

  return <section className={`${styles.card} ${styles.editing}`} aria-label={t("editor.title")}>
    <header className={styles.cardHeader}>
      <div><h4>{t("editor.title")}</h4><p>{t("editor.help", { undoKey: typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "⌘Z" : "Ctrl+Z" })}</p></div>
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} disabled={saving} onClick={onCancel}>{t("editor.cancel")}</button>
        <button type="button" className={styles.primary} disabled={saving} onClick={() => void save()}>{saving ? t("editor.saving") : t("editor.save")}</button>
      </div>
    </header>

    <div className={styles.toolbar} role="toolbar" aria-label={t("editor.tools")}>
      <label className={styles.toolSelect} title={t("editor.hintArea")}><span>{t("editor.addAreaFor")}</span><select value="" onChange={event => { if (event.target.value) addArea(event.target.value); }}><option value="">{t("editor.chooseBoard")}</option>{allBoards.map(board => <option key={board} value={board}>{board}</option>)}</select></label>
      <button type="button" className={styles.tool} title={t("editor.hintRoom")} onClick={addRoom}>{t("editor.addRoom")}</button>
      <button type="button" className={styles.tool} disabled={!plan.rooms.length} title={plan.rooms.length ? t("editor.hintEquipment") : t("editor.addRoomFirst")} onClick={addEquipment}>{t("editor.addEquipment")}</button>
      {!plan.entrance && <button type="button" className={styles.tool} title={t("editor.hintEntrance")} onClick={addEntrance}>{t("editor.addEntrance")}</button>}
      <span className={styles.toolGap} />
      <button type="button" className={styles.tool} disabled={!history.length} onClick={undo}>{t("editor.undo")}</button>
      <button type="button" className={styles.tool} disabled={!selection} title={t("editor.hintDelete")} onClick={remove}>{t("editor.delete")}</button>
    </div>
    {placingName && <p className={styles.placing} role="status">{placingBefore}<strong>{placingName}</strong>{placingAfter} <button type="button" onClick={() => setPlacing(null)}>{t("editor.cancel")}</button></p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}

    <div className={styles.editorBody}>
      <div className={styles.canvasFrame}>
        {/* The drawing space; pull its right or bottom edge (or the corner) to make it bigger or smaller. */}
        <div className={styles.stage} style={stretch ? { width: stretch } : undefined}>
        <svg ref={svgRef} viewBox={`${vx} ${vy} ${vw} ${vh}`} className={`${mapStyles.map} ${styles.canvas} ${placing ? styles.placingCursor : ""}`} role="application" aria-label={t("editor.canvas")}
          onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}
          onPointerDown={event => { if (placing) place(placing, toPoint(event.clientX, event.clientY)); else if (event.target === event.currentTarget || (event.target as Element).getAttribute("data-grid")) setSelection(null); }}
          onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const id = event.dataTransfer.getData("text/plain"); if (meterById.has(id)) place(id, toPoint(event.clientX, event.clientY)); }}>
          <defs><pattern id="floor-plan-grid" width={GRID * 2} height={GRID * 2} patternUnits="userSpaceOnUse"><path d={`M${GRID * 2} 0 L0 0 0 ${GRID * 2}`} className={styles.gridLine} /></pattern></defs>
          <rect data-grid="1" x={vx} y={vy} width={vw} height={vh} fill="url(#floor-plan-grid)" />
          {own.map(item => { const colour = item.colour ?? colours.get(item.board)!; const [x, y, w, h] = item.rect; return <g key={item.key} className={styles.item} onPointerDown={event => startDrag(event, { kind: "area", key: item.key })}>
            <rect x={x} y={y} width={w} height={h} rx={unit * 1.4} className={mapStyles.zone} style={{ fill: colour, stroke: colour }} />
            <circle cx={x + unit * 2.4} cy={y + unit * 2.6} r={unit * 0.9} style={{ fill: colour }} />
            <text x={x + unit * 4} y={y + unit * 3.3} className={mapStyles.zoneLabel} style={{ fontSize: unit * 2.1 }}>{item.board}<tspan className={mapStyles.zoneSub} dx={unit * 0.8}>{areaName(item.label)}</tspan></text>
          </g>; })}
          {plan.rooms.map(room => { const [x, y, w, h] = room.rect; const colour = room.colour ?? roomColour(room.rect); return <g key={room.key} className={styles.item} onPointerDown={event => startDrag(event, { kind: "room", key: room.key })}>
            <rect x={x} y={y} width={w} height={h} rx={unit * 0.8} className={`${mapStyles.room} ${colour ? "" : styles.orphan}`} style={room.colour ? { stroke: room.colour, fill: `color-mix(in srgb, ${room.colour} 12%, white)` } : colour ? { stroke: colour } : undefined} />
            {(() => { const size = Math.min(unit * 1.75, w / 7), lines = wrapLabel(room.name, Math.max(6, Math.floor(w / (size * 0.56)))); const top = roomHasPins(room.rect, positions) ? y + size * 1.5 : y + h / 2 + size * 0.35 - (lines.length - 1) * size * 0.6; return <text x={x + w / 2} y={top} textAnchor="middle" className={mapStyles.roomLabel} style={{ fontSize: size }}>{lines.map((line, index) => <tspan key={index} x={x + w / 2} dy={index ? size * 1.2 : 0}>{line}</tspan>)}</text>; })()}
          </g>; })}
          {groups.map(item => { const colour = item.colour ?? colours.get(item.board)!; const [x, y, w, h] = item.rect; const pinned = roomHasPins(item.rect, positions); return <g key={item.key} className={styles.item} onPointerDown={event => startDrag(event, { kind: "area", key: item.key })}>
            <rect x={x} y={y} width={w} height={h} rx={unit * 0.8} className={mapStyles.subgroup} style={{ stroke: colour, fill: colour }} />
            <text x={pinned ? x + unit * 0.8 : x + w / 2} y={pinned ? y + unit * 1.6 : y + h / 2 + unit * 0.6} textAnchor={pinned ? "start" : "middle"} className={mapStyles.subgroupLabel} style={{ fontSize: unit * (pinned ? 1.15 : 1.5) }}>{item.board} · {item.equipment || t("panel.groupFallback")}</text>
          </g>; })}
          {plan.entrance && (() => { const [x, y] = plan.entrance.position; return <g className={styles.item} onPointerDown={event => startDrag(event, { kind: "entrance", key: "entrance" })}>
            <path d={`M${x - unit * 1.4},${y + unit * 2.2} L${x},${y} L${x + unit * 1.4},${y + unit * 2.2} Z`} className={mapStyles.entrance} />
            <text x={x} y={y + unit * 4.6} textAnchor="middle" className={mapStyles.entranceLabel} style={{ fontSize: unit * 1.6 }}>{plan.entrance.label}</text>
            {selection?.kind === "entrance" && <circle cx={x} cy={y + unit * 1.2} r={unit * 2.6} className={styles.selectRing} />}
          </g>; })()}
          {plan.devices.map(item => { const meter = meterById.get(item.meterId); if (!meter) return null; const [x, y] = item.position; const r = unit * 1.1; const selected = selection?.kind === "device" && selection.key === item.meterId; return <g key={item.meterId} className={styles.item} onPointerDown={event => startDrag(event, { kind: "device", key: item.meterId })}>
            <title>{`${meter.name} · ${meter.board}`}</title>
            {item.size ? <DeviceBox x={x} y={y} size={item.size} name={meter.name} colour={item.colour ?? colours.get(meter.board) ?? "var(--zone-6)"} unit={unit} /> : <>
            {selected && <circle cx={x} cy={y} r={r * 1.7} className={styles.selectRing} />}
            <circle cx={x} cy={y} r={r} className={mapStyles.pin} style={{ fill: item.colour ?? colours.get(meter.board) ?? "var(--zone-6)" }} />
            <text x={x} y={y + r + unit * 1.3} textAnchor="middle" className={mapStyles.pinLabel} style={{ fontSize: unit * 1.15 }}>{pinLabel(meter.name, item.position, plan.rooms, groups)}</text>
            </>}
          </g>; })}
          {selectedRect && (() => { const [x, y, w, h] = selectedRect; const size = unit * 1.3; const corner: Record<Handle, Point> = { nw: [x, y], ne: [x + w, y], sw: [x, y + h], se: [x + w, y + h] }; return <g>
            <rect x={x} y={y} width={w} height={h} className={styles.selectBox} />
            {HANDLES.map(handle => <rect key={handle} x={corner[handle][0] - size / 2} y={corner[handle][1] - size / 2} width={size} height={size} rx={size * 0.2} className={`${styles.handle} ${styles[handle]}`} onPointerDown={event => startDrag(event, selection!, "resize", handle)} />)}
          </g>; })()}
        </svg>
        {edgeHandle("e", t("editor.edgeRight"))}{edgeHandle("s", t("editor.edgeBottom"))}{edgeHandle("se", t("editor.edgeCorner"))}
        </div>
      </div>

      <aside className={styles.side}>
        {selectedArea && <div className={styles.panel}>
          <h5>{selectedArea.insideRoom ? t("panel.group") : t("panel.area")}</h5>
          <label>{t("panel.label")}<input value={selectedArea.label} maxLength={40} onChange={event => updateArea(selectedArea.key, { label: event.target.value })} /></label>
          <label>{t("panel.board")}<select value={selectedArea.board} onChange={event => updateArea(selectedArea.key, { board: event.target.value })}>{allBoards.map(board => <option key={board} value={board}>{board}</option>)}</select></label>
          {colourPicker(selectedArea.colour, t("panel.colourAuto", { board: selectedArea.board }), hex => commit({ ...plan, areas: plan.areas.map(item => item.key === selectedArea.key ? recolour(item, hex) : item) }))}
          <label>{t("panel.shownAs")}<select value={selectedArea.insideRoom ?? ""} onChange={event => { const room = plan.rooms.find(item => item.key === event.target.value); if (!room) { commit({ ...plan, areas: plan.areas.map(item => item.key === selectedArea.key ? { key: item.key, label: item.label, board: item.board, rect: item.rect, ...(item.colour ? { colour: item.colour } : {}) } : item) }); return; } const [rx, ry, rw, rh] = room.rect; updateArea(selectedArea.key, { insideRoom: room.key, rect: [rx + 12, ry + rh - Math.min(60, rh * 0.4) - 12, Math.max(20, rw - 24), Math.min(60, rh * 0.4)] }); }}>
            <option value="">{t("panel.ownArea")}</option>{plan.rooms.map(room => <option key={room.key} value={room.key}>{t("panel.insideRoom", { room: room.name })}</option>)}
          </select></label>
          {selectedArea.insideRoom && <label>{t("panel.supplies")}<input value={selectedArea.equipment ?? ""} maxLength={80} placeholder={t("panel.suppliesExample")} onChange={event => updateArea(selectedArea.key, { equipment: event.target.value })} /></label>}
          <button type="button" className={styles.danger} onClick={remove}>{selectedArea.insideRoom ? t("panel.deleteGroup") : t("panel.deleteArea")}</button>
        </div>}
        {selectedRoom && <div className={styles.panel}>
          <h5>{t("panel.room")}</h5>
          <label>{t("panel.name")}<input value={selectedRoom.name} maxLength={60} onChange={event => commit({ ...plan, rooms: plan.rooms.map(item => item.key === selectedRoom.key ? { ...item, name: event.target.value } : item) })} /></label>
          {colourPicker(selectedRoom.colour, t("panel.colourAutoRoom"), hex => commit({ ...plan, rooms: plan.rooms.map(item => item.key === selectedRoom.key ? recolour(item, hex) : item) }))}
          <button type="button" className={styles.danger} onClick={remove}>{t("panel.deleteRoom")}</button>
        </div>}
        {selectedDevice && <div className={styles.panel}>
          <h5>{t("panel.device")}</h5>
          <p><strong>{selectedDevice.name}</strong><br /><small>{selectedDevice.type} · {selectedDevice.board}</small></p>
          <label>{t("panel.showAs")}<select value={selectedPlacement?.size ? "box" : "dot"} onChange={event => setDeviceShape(selectedDevice.id, event.target.value === "box")}>
            <option value="dot">{t("panel.showDot")}</option><option value="box">{t("panel.showBox")}</option>
          </select></label>
          {colourPicker(selectedPlacement?.colour, t("panel.colourAuto", { board: selectedDevice.board }), hex => commit({ ...plan, devices: plan.devices.map(item => item.meterId === selectedDevice.id ? recolour(item, hex) : item) }))}
          <button type="button" className={styles.danger} onClick={remove}>{t("panel.takeOff")}</button>
        </div>}
        {selection?.kind === "entrance" && plan.entrance && <div className={styles.panel}>
          <h5>{t("panel.entrance")}</h5>
          <label>{t("panel.label")}<input value={plan.entrance.label} maxLength={40} onChange={event => commit({ ...plan, entrance: { ...plan.entrance!, label: event.target.value } })} /></label>
          <button type="button" className={styles.danger} onClick={remove}>{t("panel.removeEntrance")}</button>
        </div>}

        <div className={styles.panel}>
          <div className={styles.paletteHead}><h5>{t("panel.devices")}</h5><span>{t("panel.placedCount", { placed: plan.devices.filter(item => meterById.has(item.meterId)).length, total: meters.length })}</span></div>
          {waiting.length > 0 && <button type="button" className={styles.tool} onClick={() => commit(autoPlace(plan, meters))}>{t("panel.placeRest")}</button>}
          <p className={styles.hint}>{t("panel.hint")}</p>
          {allBoards.filter(board => meters.some(meter => meter.board === board)).map(board => <div key={board} className={styles.paletteGroup}>
            <p><span className={styles.swatch} style={{ background: colours.get(board) }} />{board}</p>
            <ul>{meters.filter(meter => meter.board === board).map(meter => { const onPlan = placedIds.has(meter.id); return <li key={meter.id} draggable onDragStart={event => { event.dataTransfer.setData("text/plain", meter.id); event.dataTransfer.effectAllowed = "move"; }} className={onPlan ? styles.onPlan : undefined}>
              <span className={styles.grip} aria-hidden="true">⋮⋮</span>
              <span className={styles.deviceName}><strong>{meter.name}</strong><small>{meter.type}</small></span>
              {onPlan ? <button type="button" onClick={() => setSelection({ kind: "device", key: meter.id })}>{t("panel.onPlan")}</button> : <button type="button" aria-pressed={placing === meter.id} onClick={() => setPlacing(placing === meter.id ? null : meter.id)}>{t("panel.place")}</button>}
            </li>; })}</ul>
          </div>)}
        </div>
      </aside>
    </div>
  </section>;
}
