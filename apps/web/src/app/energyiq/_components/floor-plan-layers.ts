/**
 * Layers: kinds of things on the plan that can be shown, hidden or locked together while editing (only in the editor,
 * never saved), and hidden on the shared map for everyone (saved as `layout.layers.hidden`). A later kind (labels,
 * landmarks, walls and doors, shapes) is already listed here; it shows in the Layers panel once the plan has some, and
 * its own items say which layer they are on through `LAYER_OF_KIND`.
 */
import { SPATIAL_LAYERS, spatialHiddenLayers } from "@datafoundry/contracts";
import { isRecord, type Json } from "./floor-plan-carry";
import type { FloorPlan, Selection } from "./floor-plan-model";

export const LAYER_KEYS = SPATIAL_LAYERS;
export type LayerKey = typeof LAYER_KEYS[number];
/** `fields` are the plan lists a later kind keeps its items in; the layer shows in the panel once one of them has items. */
export type PlanLayer = { key: LayerKey; fields?: string[]; core?: true };
export const PLAN_LAYERS: PlanLayer[] = [
  { key: "areas", core: true }, { key: "rooms", core: true }, { key: "equipment", core: true }, { key: "devices", core: true },
  { key: "labels", fields: ["labels"] }, { key: "symbols", fields: ["symbols"] }, { key: "lines", fields: ["lines", "openings"] }, { key: "shapes", fields: ["shapes"] },
];
/** Which layer each kind of selected item is on; a later kind adds its own (for example label → labels). */
export const LAYER_OF_KIND: Record<string, LayerKey> = { room: "rooms", device: "devices", entrance: "symbols" };

/** The layer an item on the plan is on: equipment and areas are both areas in the plan, told apart by `insideRoom`. */
export function layerOf(plan: FloorPlan, item: Selection): LayerKey {
  if (item.kind === "area") return plan.areas.find(entry => entry.key === item.key)?.insideRoom ? "equipment" : "areas";
  return LAYER_OF_KIND[item.kind] ?? "areas";
}
/** Whether the plan has anything on a layer (core layers always show in the panel). */
export function layerInUse(plan: FloorPlan, layer: PlanLayer): boolean {
  if (layer.core) return true;
  if (layer.key === "symbols" && plan.entrance) return true;
  return (layer.fields ?? []).some(field => { const value = (plan as unknown as Record<string, unknown>)[field]; return Array.isArray(value) && value.length > 0; });
}

/** What the editor shows and lets the reader press: hidden layers are not drawn, locked ones are drawn but stay put. */
export type LayerView = { hidden: LayerKey[]; locked: LayerKey[] };
export const ALL_SHOWN: LayerView = { hidden: [], locked: [] };
export const toggleLayer = (view: LayerView, part: keyof LayerView, key: LayerKey): LayerView => ({ ...view, [part]: view[part].includes(key) ? view[part].filter(item => item !== key) : [...view[part], key] });

/**
 * The layers the shared map hides, from the saved block. Saved layouts are untrusted: only known layer names count, and
 * anything else there is ignored (and kept as saved).
 */
export const sharedHidden = (layers: unknown): Set<LayerKey> => spatialHiddenLayers({ layers });
/**
 * The plan with one layer hidden on (or shown again on) the shared map. Entries the editor does not know stay; with
 * nothing left hidden the list goes, and with nothing else in the block the block goes too.
 */
export function withSharedHidden(plan: FloorPlan, key: LayerKey, hide: boolean): FloorPlan {
  const block: Json = isRecord(plan.layers) ? plan.layers : {};
  const list = Array.isArray(block.hidden) ? block.hidden as unknown[] : [];
  if (list.includes(key) === hide) return plan;
  const hidden = hide ? [...list, key] : list.filter(item => item !== key);
  const { hidden: _old, ...rest } = block;
  const next: Json = hidden.length ? { ...rest, hidden } : rest;
  const { layers: _layers, ...others } = plan;
  return Object.keys(next).length ? { ...others, layers: next } : others;
}
