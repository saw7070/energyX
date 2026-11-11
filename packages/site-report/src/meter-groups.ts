/**
 * Groups: meters filed by what they serve ("Block 264F › Ground floor", "Common area › Pavilion"), not by the panel
 * they are wired from. A group is one location of the project's own Locations tree, so the tree the Facility page
 * edits is the one every total here comes from.
 *
 * A group's total is the sum of the meters inside it, at any depth; its share is of the group directly above it. A
 * meter counts only in the group it is filed in, wherever it is wired from. Where the site has a main meter, the
 * whole-site figure stays the official total and the part no sub-meter explains is its own line at the top.
 *
 * Everything here is pure, so the Facility page, the Devices tab, Analysis, the site report and the advisor all
 * compute the same figures from the same inputs.
 */

/**
 * One group as the Locations tree holds it. `parentId` null: a top-level group. `order` is the place someone saved for
 * it among the groups beside it (the setup's sort order); groups without one follow in the order they are listed.
 */
export type MeterGroup = { id: string; name: string; parentId: string | null; order?: number | undefined };

/** One meter's energy, filed in a group. A `groupId` that is null or names no group: not in any group. */
export type GroupedMeter = {
  id: string;
  /** The name readers see first: the short name when one is set. */
  name: string;
  /** The installer's full label, kept only when a short name replaces it. */
  fullName?: string | undefined;
  groupId: string | null;
  kwh: number;
  /** The electrical panel it is wired from, when recorded: a detail only, never what it counts under. */
  panel?: string | undefined;
  /** The part of a total that no sub-meter explains, rather than a meter of its own. */
  unmetered?: boolean | undefined;
};

export type MeterGroupNode = {
  id: string;
  name: string;
  kwh: number;
  /** Share of the group directly above, 0–1. The whole site is 1. */
  share: number;
  /** Meters anywhere inside this group (not counting the "not measured by a sub-meter" line). */
  meterCount: number;
  /** One meter measures this whole group, so it cannot be split any further: there is no sub-meter below it. */
  singleMeter: boolean;
  /** Meters filed directly in this group, largest first, each with its share of this group. */
  meters: Array<GroupedMeter & { share: number }>;
  /** Groups inside this one, largest first. */
  children: MeterGroupNode[];
  depth: number;
  /** Where the group comes in its saved order (see inSavedOrder); the whole site is 0. */
  position: number;
};

export type MeterGroupTree = MeterGroupNode & { unmeteredKwh: number };

export const SITE_GROUP_ID = "__site__";

/**
 * Each group's place in the order someone saved: by its saved sort order, then the order the list gives. Groups
 * compared by this number read as they do on the Facility page, wherever their size puts them.
 */
function savedPositions(groups: readonly MeterGroup[]): Map<string, number> {
  const ranked = groups.map((group, index) => ({ group, index }))
    .sort((a, b) => (a.group.order ?? Number.POSITIVE_INFINITY) - (b.group.order ?? Number.POSITIVE_INFINITY) || a.index - b.index);
  return new Map(ranked.map((item, position) => [item.group.id, position + 1]));
}

/** Groups in the order someone saved for them, rather than largest first. */
export const inSavedOrder = <T extends { position: number }>(groups: readonly T[]): T[] => [...groups].sort((a, b) => a.position - b.position);
export const UNMETERED_GROUP_METER_ID = "__unmetered__";

/** Readings never line up to the last watt-hour; only a real share of the site is worth a line of its own. */
const isRealGap = (total: number, gap: number) => total > 0 && gap > Math.max(0.5, total * 0.02);

const byKwhThenName = <T extends { kwh: number; name: string }>(left: T, right: T) =>
  right.kwh - left.kwh || left.name.localeCompare(right.name, undefined, { numeric: true });

/**
 * The whole site as a tree of groups with their totals and shares. `totalKwh` is the site's official total; when it
 * is larger than the meters add up to (a main meter above sub-meters), the difference becomes a "not measured by a
 * sub-meter" line at the top, named `unmeteredLabel`. Groups with no meter anywhere inside are left out unless
 * `keepEmpty` is set.
 */
export function buildMeterGroupTree(input: {
  groups: readonly MeterGroup[];
  meters: readonly GroupedMeter[];
  name: string;
  totalKwh?: number | null | undefined;
  unmeteredLabel?: string | undefined;
  keepEmpty?: boolean | undefined;
}): MeterGroupTree {
  const known = new Map(input.groups.map(group => [group.id, group]));
  const positions = savedPositions(input.groups);
  const childrenOf = new Map<string | null, MeterGroup[]>();
  for (const group of input.groups) {
    const parent = group.parentId && known.has(group.parentId) && group.parentId !== group.id ? group.parentId : null;
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), group]);
  }
  const metersIn = new Map<string | null, GroupedMeter[]>();
  for (const meter of input.meters) {
    const groupId = meter.groupId && known.has(meter.groupId) ? meter.groupId : null;
    metersIn.set(groupId, [...(metersIn.get(groupId) ?? []), meter]);
  }
  const visited = new Set<string>();
  const build = (group: MeterGroup | null, depth: number): MeterGroupNode | null => {
    const id = group?.id ?? null;
    if (id) { if (visited.has(id)) return null; visited.add(id); }
    const children = (childrenOf.get(id) ?? []).map(child => build(child, depth + 1)).filter((child): child is MeterGroupNode => !!child && (input.keepEmpty || child.meterCount > 0));
    const own = metersIn.get(id) ?? [];
    const kwh = own.reduce((sum, meter) => sum + meter.kwh, 0) + children.reduce((sum, child) => sum + child.kwh, 0);
    const meterCount = own.filter(meter => !meter.unmetered).length + children.reduce((sum, child) => sum + child.meterCount, 0);
    const shareOf = (value: number) => kwh > 0 ? value / kwh : 0;
    return {
      id: id ?? SITE_GROUP_ID, name: group?.name ?? input.name, kwh, share: 1, meterCount, singleMeter: meterCount === 1, depth, position: id ? positions.get(id) ?? 0 : 0,
      meters: own.map(meter => ({ ...meter, share: shareOf(meter.kwh) })).sort(byKwhThenName),
      children: children.map(child => ({ ...child, share: shareOf(child.kwh) })).sort(byKwhThenName),
    };
  };
  const root = build(null, 0)!;
  const total = input.totalKwh ?? 0;
  const gap = total - root.kwh;
  if (!isRealGap(total, gap)) return { ...root, unmeteredKwh: 0 };
  // The site total is the main meter: the groups are shares of it, and what they leave is its own line.
  const unmetered: GroupedMeter = { id: UNMETERED_GROUP_METER_ID, name: input.unmeteredLabel ?? "Not measured by a sub-meter", groupId: null, kwh: gap, unmetered: true };
  const kwh = root.kwh + gap;
  const reshare = <T extends { kwh: number }>(item: T) => ({ ...item, share: kwh > 0 ? item.kwh / kwh : 0 });
  return {
    ...root, kwh, unmeteredKwh: gap,
    meters: [...root.meters, { ...unmetered, share: 0 }].map(reshare).sort(byKwhThenName),
    children: root.children.map(reshare),
  };
}

/** Every group in reading order (each group followed by the groups inside it), without the whole site itself. */
export function flattenMeterGroups(tree: MeterGroupNode): MeterGroupNode[] {
  return tree.children.flatMap(child => [child, ...flattenMeterGroups(child)]);
}

/** The groups with no group inside them: the most specific places the energy can be pinned to. */
export function innermostMeterGroups(tree: MeterGroupNode): MeterGroupNode[] {
  return flattenMeterGroups(tree).filter(group => !group.children.length);
}

/** The single most specific group that uses the most energy ("Entrance"), or null when nothing has readings. */
export function biggestMeterGroup(tree: MeterGroupNode): MeterGroupNode | null {
  return innermostMeterGroups(tree).filter(group => group.kwh > 0).sort(byKwhThenName)[0] ?? null;
}

/** Whether the tree says anything a flat list of meters would not: at least one group with a meter in it. */
export const hasMeterGroups = (tree: MeterGroupNode): boolean => tree.children.some(group => group.meterCount > 0);

/**
 * The group tree for one set of Analysis readings, or null when the readings carry no groups (saved before groups
 * existed) or no meter sits in a group. The whole site is the official total.
 */
export function analysisGroupTree(data: { projectName: string; groups?: { list: MeterGroup[]; meters: GroupedMeter[] } | undefined; current: { project: { usageKwh: number | null } } }, unmeteredLabel: string): MeterGroupTree | null {
  if (!data.groups?.list.length) return null;
  const tree = buildMeterGroupTree({ groups: data.groups.list, meters: data.groups.meters, name: data.projectName, totalKwh: data.current.project.usageKwh, unmeteredLabel });
  return hasMeterGroups(tree) ? tree : null;
}

/**
 * The project's Locations, as the published project information lists them, turned into groups: the project itself
 * is the whole site rather than a group, so its direct children become the top-level groups and a meter filed on the
 * project itself is in no group.
 */
export function groupsFromLocations(locations: ReadonlyArray<{ id: string; name: string; parentId?: string | null | undefined; sortOrder?: number | undefined }>): MeterGroup[] {
  const roots = new Set(locations.filter(location => !location.parentId).map(location => location.id));
  return locations.filter(location => !roots.has(location.id)).map(location => ({
    id: location.id, name: location.name, parentId: location.parentId && !roots.has(location.parentId) ? location.parentId : null,
    ...(typeof location.sortOrder === "number" && Number.isFinite(location.sortOrder) ? { order: location.sortOrder } : {}),
  }));
}
