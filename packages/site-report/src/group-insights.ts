/**
 * What the groups say beyond their totals, shared by the full report, the management review and the Overview, so all
 * three read the same figures from the same readings:
 *
 * - The breakdown: the top-level groups in the order someone saved for them, each opening into the groups inside it
 *   (and those into their meters), with kWh a day and the share of the whole site. Shares are of the whole site at
 *   every level, so the groups inside a group add up to its own share.
 * - Like for like: two or more top-level groups of the same kind (two blocks) side by side, matching the groups inside
 *   them by name ("Block lighting" with "Block lighting"), never one circuit against another.
 * - The average day hour by hour, one line per group, the same groups in alike blocks added together.
 * - Energy per light, for meters someone recorded a number of light points on.
 * - Meters that used nothing at all in the dates: said plainly, and never as a fault for a meter that can rightly use
 *   nothing; one that should run (see mustRunIds) is something to check.
 *
 * Everything here is pure.
 */
import type { LightCountMeter, ScopeData, ScopeMeter, TrendSeries } from "./analysis-types.js";
import { inSavedOrder, type MeterGroupNode, type MeterGroupTree } from "./meter-groups.js";
import { alwaysOnByDesignIds, type AlwaysOnMeter } from "./always-on-by-design.js";

const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

// ---------- groups of the same kind ----------
const tokens = (name: string) => name.toLowerCase().replace(/[(),:;]/g, " ").split(/\s+/).filter(Boolean);
/** "12A", "A", "2": the part of a name that tells one group of a kind from another. */
const isIdentifier = (token: string) => /\d/.test(token) || token.length === 1;
/** What kind of group a name is: "Block 12A" and "Block A" are both "block"; "Common area" is its own kind. */
export const groupKind = (name: string) => tokens(name).filter(token => !isIdentifier(token)).join(" ");
/** A part's name without its group's own identifier: "12A lift lobby lighting" in Block 12A is "lift lobby lighting". */
export const partKey = (name: string, group: string) => { const own = new Set(tokens(group).filter(isIdentifier)); return tokens(name).filter(token => !own.has(token)).join(" "); };
/** The same, for readers: the part's own words without its group's identifier, starting with a capital. */
export const partLabel = (name: string, group: string) => {
  const own = new Set(tokens(group).filter(isIdentifier));
  const kept = name.split(/\s+/).filter(word => !own.has(word.toLowerCase().replace(/[(),:;]/g, ""))).join(" ").trim();
  return kept ? kept.charAt(0).toUpperCase() + kept.slice(1) : name;
};

/**
 * Top-level groups that can be compared: two or more of the same kind (two blocks, three towers). With several such
 * kinds, the one with the most groups, then the most energy, wins. Null when no two groups are alike.
 */
export function comparableGroups(tree: MeterGroupTree): MeterGroupNode[] | null {
  const byKind = new Map<string, MeterGroupNode[]>();
  for (const group of tree.children) {
    const kind = groupKind(group.name);
    if (!kind || group.kwh <= 0) continue;
    byKind.set(kind, [...(byKind.get(kind) ?? []), group]);
  }
  const sets = [...byKind.values()].filter(set => set.length >= 2);
  if (!sets.length) return null;
  const energy = (set: MeterGroupNode[]) => set.reduce((sum, group) => sum + group.kwh, 0);
  return inSavedOrder(sets.sort((a, b) => b.length - a.length || energy(b) - energy(a))[0]!);
}

/** A group's direct parts: the groups inside it in their saved order, then the meters filed in it directly, largest first. */
export function groupParts(node: MeterGroupNode): Array<{ name: string; kwh: number; node: MeterGroupNode | null; meterIds: string[] }> {
  return [
    ...inSavedOrder(node.children).map(child => ({ name: child.name, kwh: child.kwh, node: child, meterIds: meterIdsIn(child) })),
    ...node.meters.filter(meter => !meter.unmetered).map(meter => ({ name: meter.name, kwh: meter.kwh, node: null, meterIds: [meter.id] })),
  ];
}

/** Every meter inside a group, at any depth. */
export const meterIdsIn = (node: MeterGroupNode): string[] => [...node.meters.filter(meter => !meter.unmetered).map(meter => meter.id), ...node.children.flatMap(meterIdsIn)];

/** Two figures within this share of each other read as "close". */
export const LIKE_CLOSE_SHARE = 0.05;

export type LikePart = { key: string; name: string; kwh: number[]; meterIds: string[] };
/**
 * Alike groups part for part: each part matched by its name once each group's own identifier is taken out ("Block
 * lighting" in Block 264F with "Block lighting" in Block 264E; "12A lift lobby" with "12B lift lobby"). `shared` holds
 * the parts every group has, in the first group's order, each with its kWh in every group (in the order given);
 * `extra` holds, for each group, the parts only some groups have, largest first.
 */
export function likeForLike(groups: MeterGroupNode[]): { shared: LikePart[]; extra: Array<Array<{ key: string; name: string; kwh: number }>> } {
  const keyed = groups.map(group => {
    const map = new Map<string, { name: string; kwh: number; meterIds: string[] }>();
    for (const part of groupParts(group)) {
      const key = partKey(part.name, group.name);
      if (!key) continue;
      const known = map.get(key);
      map.set(key, { name: known?.name ?? partLabel(part.name, group.name), kwh: (known?.kwh ?? 0) + part.kwh, meterIds: [...(known?.meterIds ?? []), ...part.meterIds] });
    }
    return map;
  });
  const sharedKeys = [...(keyed[0]?.keys() ?? [])].filter(key => keyed.every(map => map.has(key)));
  return {
    shared: sharedKeys.map(key => ({ key, name: keyed[0]!.get(key)!.name, kwh: keyed.map(map => map.get(key)!.kwh), meterIds: keyed.flatMap(map => map.get(key)!.meterIds) })),
    extra: keyed.map(map => [...map].filter(([key]) => !sharedKeys.includes(key)).map(([key, part]) => ({ key, name: part.name, kwh: part.kwh })).sort((a, b) => b.kwh - a.kwh)),
  };
}

// ---------- the breakdown ----------
/**
 * One line of the breakdown. `share` is of the whole site at every depth; `perDay` is the site's average day times that
 * share, so the lines add up to the average day (null when the site has no average day). `pct` is the share as a whole
 * percentage for readers, rounded so the top-level lines add up to exactly 100 and the lines inside a group to exactly
 * its own. `rows` holds what is inside a group: its groups in their saved order, then its own meters, largest first.
 */
export type BreakdownRow = { key: string; name: string; kind: "group" | "meter" | "unmetered"; kwh: number; share: number; pct: number; perDay: number | null; rows: BreakdownRow[] };

/**
 * Whole percentages for shares (of 1) that should add up to `total`: each rounded down, then the ones that lost the
 * most get one more until they do (the largest remainders), so "40% + 38% + 21%" never reads as 99%.
 */
export function wholePercents(shares: readonly number[], total: number): number[] {
  const raw = shares.map(share => Math.max(0, share * 100));
  const whole = raw.map(value => Math.floor(value + 1e-9));
  const order = raw.map((value, index) => ({ index, rest: value - whole[index]! })).sort((a, b) => b.rest - a.rest || a.index - b.index);
  let left = total - whole.reduce((sum, value) => sum + value, 0);
  // Never more than one step each way per line; a total that cannot be reached is left as near as it gets.
  for (const item of order) { if (left <= 0) break; whole[item.index]! += 1; left -= 1; }
  for (const item of [...order].reverse()) { if (left >= 0) break; if (whole[item.index]! > 0) { whole[item.index]! -= 1; left += 1; } }
  return whole;
}

/** The whole site by group, top-level groups in their saved order, then any meter in no group and the part no sub-meter explains. */
export function groupBreakdown(tree: MeterGroupTree, siteDayKwh: number | null): BreakdownRow[] {
  const total = tree.kwh;
  const share = (kwh: number) => total > 0 ? kwh / total : 0;
  const perDay = (kwh: number) => siteDayKwh == null || total <= 0 ? null : siteDayKwh * kwh / total;
  const meterRow = (meter: MeterGroupNode["meters"][number]): BreakdownRow => ({ key: meter.id, name: meter.name, kind: meter.unmetered ? "unmetered" : "meter", kwh: meter.kwh, share: share(meter.kwh), pct: 0, perDay: perDay(meter.kwh), rows: [] });
  const groupRow = (node: MeterGroupNode): BreakdownRow => ({
    key: node.id, name: node.name, kind: "group", kwh: node.kwh, share: share(node.kwh), pct: 0, perDay: perDay(node.kwh),
    rows: [...inSavedOrder(node.children).map(groupRow), ...node.meters.filter(meter => !meter.unmetered).map(meterRow)],
  });
  // Whole percentages level by level: the lines inside a group share out exactly the group's own.
  const withPercents = (rows: BreakdownRow[], target: number): BreakdownRow[] => {
    const pcts = wholePercents(rows.map(row => row.share), target);
    return rows.map((row, index) => ({ ...row, pct: pcts[index]!, rows: withPercents(row.rows, pcts[index]!) }));
  };
  return withPercents([
    ...inSavedOrder(tree.children).map(groupRow),
    ...tree.meters.filter(meter => !meter.unmetered).map(meterRow),
    ...tree.meters.filter(meter => meter.unmetered).map(meterRow),
  ], total > 0 ? 100 : 0);
}

// ---------- readings of single meters ----------
/** Each meter's own hourly readings, found wherever the scopes list it. */
export function meterSeries(scopes: readonly ScopeData[]): Map<string, TrendSeries> {
  const found = new Map<string, TrendSeries>();
  for (const scope of scopes) for (const meter of scope.meters) if (meter.series && !found.has(meter.id)) found.set(meter.id, meter.series);
  return found;
}
/** A complete hour's reading: the full minutes and no problem. */
const completeHour = (series: TrendSeries, cell: TrendSeries["cells"][number]) => cell[2] != null && cell[3] >= series.expectedMinutesPerHour && cell[4] === 0;

/** A meter's usual day: the average of the days within `dates` on which every hour's readings arrived complete; null with none. */
export function meterUsualDay(series: TrendSeries | null | undefined, dates: readonly string[]): number | null {
  if (!series) return null;
  const set = new Set(dates);
  const days = new Map<string, { kwh: number; hours: number }>();
  for (const cell of series.cells) {
    if (!set.has(cell[0]) || !completeHour(series, cell)) continue;
    const day = days.get(cell[0]) ?? { kwh: 0, hours: 0 };
    day.kwh += cell[2]!; day.hours += 1;
    days.set(cell[0], day);
  }
  return mean([...days.values()].filter(day => day.hours >= 24).map(day => day.kwh));
}

/** A meter's average kW in each hour of the day over `dates`, from complete hours only; 0 for an hour with none. */
function meterHours(series: TrendSeries | undefined, dates: ReadonlySet<string>): number[] {
  const byHour: number[][] = Array.from({ length: 24 }, () => []);
  if (series) for (const cell of series.cells) if (dates.has(cell[0]) && completeHour(series, cell)) byHour[cell[1]]!.push(cell[2]!);
  return byHour.map(values => mean(values) ?? 0);
}

// ---------- the average day, one line per group ----------
export type ProfileLine = { key: string; name: string; hours: number[]; dayKwh: number };
/** At most this many lines are drawn; the smallest of the rest share one "other groups" line. */
export const MAX_PROFILE_LINES = 7;

/**
 * The average day hour by hour, one line per group: the groups inside alike top-level groups added together by name
 * ("Block lighting" in every block is one line), and the groups inside every other top-level group each a line of its
 * own ("Driveway", "Pavilion"); a top-level group with no groups inside it is one line. Lines follow the saved order.
 * `dates` are the days averaged (complete days). Beyond MAX_PROFILE_LINES, the smallest lines are added into one named
 * `otherLabel`. Empty when there is nothing to split.
 */
export function groupProfileLines(input: { tree: MeterGroupTree; series: ReadonlyMap<string, TrendSeries>; dates: readonly string[]; otherLabel: string }): ProfileLine[] {
  const { tree } = input;
  const alike = comparableGroups(tree) ?? [];
  const alikeIds = new Set(alike.map(group => group.id));
  const lines: Array<{ key: string; name: string; meterIds: string[]; top: string }> = [];
  let alikeAdded = false;
  for (const top of inSavedOrder(tree.children)) {
    if (alikeIds.has(top.id)) {
      // The alike groups' parts, added together by name; parts only some of them have stay lines of their own.
      if (alikeAdded) continue;
      alikeAdded = true;
      const merged = new Map<string, { name: string; meterIds: string[] }>();
      for (const group of alike) for (const part of groupParts(group)) {
        const key = partKey(part.name, group.name) || part.name.toLowerCase();
        const known = merged.get(key);
        merged.set(key, { name: known?.name ?? partLabel(part.name, group.name), meterIds: [...(known?.meterIds ?? []), ...part.meterIds] });
      }
      for (const [key, part] of merged) lines.push({ key: `like:${key}`, ...part, top: "" });
      continue;
    }
    if (!top.children.length) { lines.push({ key: top.id, name: top.name, meterIds: meterIdsIn(top), top: "" }); continue; }
    for (const child of inSavedOrder(top.children)) lines.push({ key: child.id, name: child.name, meterIds: meterIdsIn(child), top: top.name });
    const own = top.meters.filter(meter => !meter.unmetered).map(meter => meter.id);
    if (own.length) lines.push({ key: `own:${top.id}`, name: top.name, meterIds: own, top: "" });
  }
  if (lines.length < 2) return [];
  const dates = new Set(input.dates);
  const hoursOf = (meterIds: string[]) => meterIds.reduce((sum, id) => { const own = meterHours(input.series.get(id), dates); return sum.map((value, hour) => value + own[hour]!); }, Array.from({ length: 24 }, () => 0));
  // Two groups can share a name ("Ground floor" under two unlike groups): the line then says which group it is in.
  const named = (line: (typeof lines)[number]) => line.top && lines.some(other => other !== line && other.name === line.name) ? `${line.top} › ${line.name}` : line.name;
  const withHours = lines.map(line => { const hours = hoursOf(line.meterIds); return { key: line.key, name: named(line), hours, dayKwh: hours.reduce((sum, value) => sum + value, 0) }; });
  if (withHours.length <= MAX_PROFILE_LINES) return withHours;
  const kept = new Set([...withHours].sort((a, b) => b.dayKwh - a.dayKwh).slice(0, MAX_PROFILE_LINES - 1).map(line => line.key));
  const rest = withHours.filter(line => !kept.has(line.key));
  const other = rest.reduce((sum, line) => sum.map((value, hour) => value + line.hours[hour]!), Array.from({ length: 24 }, () => 0));
  return [...withHours.filter(line => kept.has(line.key)), { key: "__other__", name: input.otherLabel, hours: other, dayKwh: other.reduce((sum, value) => sum + value, 0) }];
}

// ---------- energy per light ----------
export type PerLightMeter = { id: string; name: string; group: string; groupKey: string | null; lights: number; perDay: number | null; perLight: number | null };
export type PerLightGroup = { key: string; name: string; lights: number; perDay: number; perLight: number; meters: number };

/**
 * kWh per light point a day for each meter someone recorded a number of light points on (from its usual day, complete
 * days only), and for the group each one is filed in: the meters with a count in that group added together. Meters
 * without a count are left out, so a group's figure covers only the meters that have one. Groups are named with the
 * group above them ("Block 264F › Block lighting").
 */
export function energyPerLight(input: { counts: readonly LightCountMeter[]; tree: MeterGroupTree | null; series: ReadonlyMap<string, TrendSeries>; names: ReadonlyMap<string, string>; dates: readonly string[] }): { meters: PerLightMeter[]; groups: PerLightGroup[] } {
  const home = new Map<string, { key: string; name: string; position: number[] }>();
  const visit = (node: MeterGroupNode, path: string[], order: number[]) => {
    for (const meter of node.meters) if (!meter.unmetered) home.set(meter.id, { key: node.id, name: path.join(" › "), position: order });
    for (const child of inSavedOrder(node.children)) visit(child, [...path, child.name], [...order, child.position]);
  };
  if (input.tree) visit(input.tree, [], []);
  const compare = (a: number[], b: number[]) => { for (let index = 0; index < Math.max(a.length, b.length); index += 1) { const diff = (a[index] ?? -1) - (b[index] ?? -1); if (diff) return diff; } return 0; };
  const orderOf = (id: string) => home.get(id)?.position ?? [];
  const meters: PerLightMeter[] = input.counts.map(item => {
    const perDay = meterUsualDay(input.series.get(item.id), input.dates);
    const place = home.get(item.id);
    return { id: item.id, name: input.names.get(item.id) ?? item.name, group: place?.name ?? "", groupKey: place?.key ?? null, lights: item.count, perDay, perLight: perDay == null ? null : perDay / item.count };
  }).sort((a, b) => compare(orderOf(a.id), orderOf(b.id)) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  const groups = new Map<string, PerLightGroup>();
  for (const meter of meters) {
    if (!meter.groupKey || meter.perDay == null) continue;
    const known = groups.get(meter.groupKey) ?? { key: meter.groupKey, name: meter.group, lights: 0, perDay: 0, perLight: 0, meters: 0 };
    known.lights += meter.lights; known.perDay += meter.perDay; known.meters += 1;
    known.perLight = known.perDay / known.lights;
    groups.set(meter.groupKey, known);
  }
  return { meters, groups: [...groups.values()] };
}

// ---------- meters that used nothing ----------
/** Below this many kWh over the dates, a meter used nothing worth a figure. */
export const NO_USE_KWH = 0.005;
/**
 * Meters that sent readings in the dates but used nothing at all (a fan nobody switched on), with the dates they
 * sent readings on. A meter that sent nothing is a different story (it has stopped) and is not listed here.
 */
export function metersWithNoUse(meters: readonly ScopeMeter[], dates: readonly string[]): Array<{ meter: ScopeMeter; dates: string[] }> {
  const set = new Set(dates);
  return meters.flatMap(meter => {
    const cells = (meter.series?.cells ?? []).filter(cell => set.has(cell[0]) && cell[3] > 0);
    if (!cells.length) return [];
    const kwh = cells.reduce((sum, cell) => sum + (cell[2] ?? 0), 0);
    return kwh < NO_USE_KWH ? [{ meter, dates: [...new Set(cells.map(cell => cell[0]))].sort() }] : [];
  });
}

/**
 * Meters that should never go a whole day using nothing, so using nothing is something to check on site rather than
 * "not a fault": the same rule the server uses before it calls a quiet meter idle (energy-idle-meters.ts). These are a
 * meter marked always on by design (emergency lighting), and lighting on a site with lights-on hours, whose lights
 * should come on every night. Anything else can rightly sit unused (a fan nobody switched on).
 */
export function mustRunIds(meters: readonly Pick<ScopeMeter, "id" | "category">[], data: { alwaysOnByDesign?: AlwaysOnMeter[] | undefined; hoursMeaning?: "opening" | "lights_on" | undefined }): Set<string> {
  const byDesign = alwaysOnByDesignIds(data);
  return new Set(meters.filter(meter => byDesign.has(meter.id) || (data.hoursMeaning === "lights_on" && meter.category === "light")).map(meter => meter.id));
}
