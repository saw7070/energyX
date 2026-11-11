/**
 * Editing groups: the project's Locations tree, named for what its meters serve. A group is a location node, so a
 * meter moved into a group is counted there and nowhere else, by every page and report.
 *
 * The tree keeps its levels (tiers) behind the scenes: a group inside a group sits one level down. Putting a group
 * inside one on the lowest level adds a new lowest level, and removing the last group on a level removes that level,
 * so people only ever think in groups.
 */
import type { EnergyProjectSetupDocumentDto, EnergyTierDefinitionDto } from "../../../lib/config-api";
import { addNode, hasSiblingNameConflict } from "../admin/project-setup-model";
import { translatorFor, type EnergyIqLocale } from "./energyiq-messages";
import { structureMessages } from "./facility-messages";
import { applyMeterEdit, locationRemoval } from "./site-structure-editing";
import { projectMeterName } from "./project-meter-name";

/** The project allows at most seven levels. */
export const MAX_GROUP_LEVELS = 7;

const cleanName = (value: string) => value.trim().replace(/\s+/g, " ");

/** A level name nobody else uses ("Group", then "Group 2"…); level names must be unique and never read "Circuit". */
function freeTierAlias(tiers: EnergyTierDefinitionDto[], base: string): string {
  const taken = new Set(tiers.map(tier => tier.alias.trim().toLocaleLowerCase()));
  for (let index = 1; ; index += 1) {
    const alias = index === 1 ? base : `${base} ${index}`;
    if (!taken.has(alias.toLocaleLowerCase())) return alias;
  }
}

function freeTierId(document: EnergyProjectSetupDocumentDto, projectId: string): string {
  const taken = new Set(document.tiers.map(tier => tier.id));
  for (let index = 1; ; index += 1) {
    const id = `${projectId}-group-level-${index}`;
    if (!taken.has(id)) return id;
  }
}

/**
 * Creates a group named `name`, at the top or inside `parentId`. Returns the new group's id, or an error in the
 * reader's language when the name is empty or already used beside it, or the tree is as deep as it can go.
 */
export function addGroup(document: EnergyProjectSetupDocumentDto, projectId: string, input: { name: string; parentId?: string | undefined }, locale: EnergyIqLocale = "en"): { document: EnergyProjectSetupDocumentDto; nodeId: string } | { error: string } {
  const t = translatorFor(structureMessages, locale);
  const name = cleanName(input.name);
  if (!name) return { error: t("error.name") };
  const parent = input.parentId ? document.nodes.find(node => node.id === input.parentId) : undefined;
  if (input.parentId && !parent) return { error: t("error.level") };
  let next = document;
  let tierId: string;
  if (!parent) {
    const top = [...next.tiers].sort((left, right) => right.ordinal - left.ordinal)[0];
    if (top) tierId = top.id;
    else {
      tierId = freeTierId(next, projectId);
      next = { ...next, tiers: [{ id: tierId, ordinal: 1, alias: freeTierAlias(next.tiers, t("group.levelName")) }], tier_structure_locked: true };
    }
  } else {
    const parentTier = next.tiers.find(tier => tier.id === parent.tier_definition_id);
    if (!parentTier) return { error: t("error.level") };
    const below = next.tiers.find(tier => tier.ordinal === parentTier.ordinal - 1);
    if (below) tierId = below.id;
    else {
      // The parent is on the lowest level: add a new lowest level for the group to sit on.
      if (next.tiers.length >= MAX_GROUP_LEVELS) return { error: t("group.tooDeep", { count: MAX_GROUP_LEVELS }) };
      tierId = freeTierId(next, projectId);
      next = { ...next, tiers: [...next.tiers.map(tier => ({ ...tier, ordinal: tier.ordinal + 1 })), { id: tierId, ordinal: 1, alias: freeTierAlias(next.tiers, t("group.levelName")) }] };
    }
  }
  if (hasSiblingNameConflict(next, { tierId, ...(parent ? { parentId: parent.id } : {}), name })) return { error: t("error.duplicate", { name }) };
  const created = addNode(next, { projectId, tierId, ...(parent ? { parentId: parent.id } : {}) });
  if (!created.nodeId) return { error: t("error.level") };
  return { nodeId: created.nodeId, document: { ...created.document, nodes: created.document.nodes.map(node => node.id === created.nodeId ? { ...node, name } : node) } };
}

/** Levels with no group left on them are dropped and the rest renumbered from the bottom, so no level is ever empty. */
export function withoutEmptyLevels(document: EnergyProjectSetupDocumentDto): EnergyProjectSetupDocumentDto {
  if (!document.nodes.length) return document;
  const used = new Set(document.nodes.map(node => node.tier_definition_id));
  if (document.tiers.every(tier => used.has(tier.id))) return document;
  const kept = document.tiers.filter(tier => used.has(tier.id)).sort((left, right) => left.ordinal - right.ordinal);
  return { ...document, tiers: kept.map((tier, index) => ({ ...tier, ordinal: index + 1 })) };
}

/** Removes a group that holds no meters (with any empty groups inside it); a group still holding meters is refused. */
export function removeGroup(document: EnergyProjectSetupDocumentDto, nodeId: string, locale: EnergyIqLocale = "en"): { document: EnergyProjectSetupDocumentDto } | { error: string } {
  const removed = locationRemoval(document, nodeId, locale);
  return "error" in removed ? removed : { document: withoutEmptyLevels(removed.document) };
}

/**
 * Moves meters into one group. A meter counts only in the group it is in, wherever it is wired from. The first time a
 * meter leaves the place it was set up in, that place's name is kept as its electrical panel, so the wiring detail is
 * not lost.
 */
export function moveMetersToGroup(document: EnergyProjectSetupDocumentDto, meterIds: string[], groupId: string, locale: EnergyIqLocale = "en"): EnergyProjectSetupDocumentDto | { error: string } {
  const t = translatorFor(structureMessages, locale);
  if (!meterIds.length) return { error: t("move.errorNone") };
  if (!document.nodes.some(node => node.id === groupId)) return { error: t("error.meterLocation") };
  let next = document;
  for (const id of meterIds) {
    const meter = next.meter_mapping?.rows.find(row => row.id === id);
    if (!meter) return { error: t("move.errorGone") };
    if (meter.scope_id === groupId) continue;
    const from = next.nodes.find(node => node.id === meter.scope_id)?.name;
    const panel = meter.presentation?.panel ?? from;
    const moved = applyMeterEdit(next, meter, {
      name: meter.presentation?.device_name?.trim() || meter.presentation?.circuit_name?.trim() || meter.display_name || projectMeterName(meter),
      scopeId: groupId, category: meter.category, counted: meter.aggregation_usage === "official",
      ...(panel ? { panel } : {}),
    }, locale);
    if ("error" in moved) return moved;
    next = moved;
  }
  return next;
}

/** Every group with its full path ("Block 264F / Ground floor"), in tree order, for a "Move to…" list. */
export function groupChoices(document: EnergyProjectSetupDocumentDto): Array<{ id: string; label: string; depth: number }> {
  const out: Array<{ id: string; label: string; depth: number }> = [];
  const seen = new Set<string>();
  const ids = new Set(document.nodes.map(node => node.id));
  const visit = (parentId: string | undefined, path: string[], depth: number) => {
    const children = document.nodes.filter(node => (node.parent_id && ids.has(node.parent_id) ? node.parent_id : undefined) === parentId)
      .sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name, undefined, { numeric: true }));
    for (const node of children) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      const label = [...path, node.name];
      out.push({ id: node.id, label: label.join(" / "), depth });
      visit(node.id, label, depth + 1);
    }
  };
  visit(undefined, [], 0);
  return out;
}

/** Meters anywhere inside a group, counting the groups inside it. */
export function metersInGroup(document: EnergyProjectSetupDocumentDto, groupId: string): number {
  const inside = new Set([groupId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of document.nodes) if (node.parent_id && inside.has(node.parent_id) && !inside.has(node.id)) { inside.add(node.id); grew = true; }
  }
  return (document.meter_mapping?.rows ?? []).filter(row => inside.has(row.scope_id)).length;
}
