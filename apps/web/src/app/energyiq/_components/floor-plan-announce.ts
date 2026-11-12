"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Translate } from "./energyiq-messages";
import { boxOf } from "./floor-plan-arrange";
import type { floorPlanMessages } from "./floor-plan-messages";
import type { FloorPlan, PlanArea, Rect, Selection } from "./floor-plan-model";
import { boundsOf } from "./floor-plan-snap";

/**
 * Plain words for screen readers: what an item on the plan is ("Room Lift lobby"), and what just happened to the
 * selection ("Room Lift lobby selected", "Moved to 240, 180"). Read out by a polite live region in the editor.
 */
type T = Translate<Extract<keyof typeof floorPlanMessages["en"], string>>;
/** An area's name as the plan shows it: a short id such as "A" reads "Area A". */
export const areaName = (t: T, label: string) => label.length <= 2 ? t("name.area", { id: label }) : label;
export const itemId = (item: Selection) => `${item.kind}:${item.key}`;
export const parseItemId = (value: string | null | undefined): Selection | null => {
  const at = value ? value.indexOf(":") : -1;
  if (!value || at < 1) return null;
  const kind = value.slice(0, at), key = value.slice(at + 1);
  return kind === "area" || kind === "room" || kind === "device" || kind === "entrance" || kind === "opening" || kind === "line" ? { kind, key } : null;
};

/** "Area DB1 · Block 264E", or for equipment inside a room "Equipment DB3 · LED screens". */
export const areaItemName = (t: T, area: PlanArea) => area.insideRoom ? t("a11y.group", { name: [area.board, area.equipment || t("panel.groupFallback")].filter(Boolean).join(" · ") }) : t("a11y.area", { name: [area.board, areaName(t, area.label)].filter(Boolean).join(" · ") });
export function itemName(t: T, plan: FloorPlan, item: Selection, meterName: (id: string) => string | undefined): string {
  if (item.kind === "area") { const area = plan.areas.find(entry => entry.key === item.key); return area ? areaItemName(t, area) : ""; }
  if (item.kind === "room") { const room = plan.rooms.find(entry => entry.key === item.key); return room ? t("a11y.room", { name: room.name }) : ""; }
  if (item.kind === "device") return t("a11y.device", { name: meterName(item.key) ?? item.key });
  if (item.kind === "line") { const line = plan.lines?.find(entry => entry.key === item.key); return line ? t("a11y.line", { style: t(`line.${line.style}`) }) : ""; }
  if (item.kind === "opening") { const opening = plan.openings?.find(entry => entry.key === item.key), room = opening && plan.rooms.find(entry => entry.key === opening.room); return opening ? t("a11y.opening", { kind: t(`opening.${opening.kind}`), room: room?.name ?? "" }) : ""; }
  return plan.entrance ? t("a11y.entrance", { name: plan.entrance.label }) : "";
}
export function selectionText(t: T, plan: FloorPlan, list: Selection[], meterName: (id: string) => string | undefined): string {
  if (!list.length) return t("a11y.none");
  return list.length === 1 ? t("a11y.selected", { item: itemName(t, plan, list[0]!, meterName) }) : t("a11y.selectedMany", { count: list.length });
}
/** Where the items now are, from the top-left corner of the drawing space (as the position fields show it). */
export function movedText(t: T, plan: FloorPlan, list: Selection[]): string {
  const boxes = list.flatMap(item => { const box = boxOf(plan, item); return box ? [box] : []; });
  if (!boxes.length) return "";
  const [x, y] = boundsOf(boxes), values = { x: Math.round(x - plan.viewBox[0]), y: Math.round(y - plan.viewBox[1]) };
  return boxes.length === 1 ? t("a11y.moved", values) : t("a11y.movedMany", { ...values, count: boxes.length });
}
export const resizedText = (t: T, box: Rect | null) => box ? t("a11y.resized", { w: Math.round(box[2]), h: Math.round(box[3]) }) : "";
export function countText(t: T, plan: FloorPlan, list: Selection[], meterName: (id: string) => string | undefined, one: "a11y.added" | "a11y.deleted", many: "a11y.addedMany" | "a11y.deletedMany"): string {
  if (!list.length) return "";
  return list.length === 1 ? t(one, { item: itemName(t, plan, list[0]!, meterName) }) : t(many, { count: list.length });
}

/**
 * The editor's polite live region. `say` words the next change from the plan as it then stands ("Moved to 240, 180");
 * any other change of selection is read out as the new selection (`describe`). `trigger` is the editor's history: each
 * change of it is a moment to speak. The same words twice in a row are read again (a no-break space tells them apart).
 */
export function useAnnouncer({ plan, selectionKey, trigger, describe }: { plan: FloorPlan; selectionKey: string; trigger: unknown; describe: () => string }) {
  const [live, setLive] = useState("");
  const speak = useCallback((text: string) => { if (text) setLive(current => current === text ? `${text}\u00a0` : text); }, []);
  const pending = useRef<((plan: FloorPlan) => string) | null>(null);
  const say = useCallback((make: (plan: FloorPlan) => string) => { pending.current = make; }, []);
  const spoken = useRef(selectionKey);
  const latest = useRef({ plan, selectionKey, describe });
  useLayoutEffect(() => { latest.current = { plan, selectionKey, describe }; });
  useEffect(() => {
    const make = pending.current, now = latest.current;
    pending.current = null;
    if (make) { spoken.current = now.selectionKey; speak(make(now.plan)); return; }
    if (now.selectionKey !== spoken.current) { spoken.current = now.selectionKey; speak(now.describe()); }
  }, [trigger, speak]);
  return { live, speak, say };
}
