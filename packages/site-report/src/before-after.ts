/**
 * Before and after a change made on site: did smart lighting dimmed 30% at night, new LED fittings or a timer moved
 * save what it promised? Someone records the change in Facility → Savings (what, the date it started, which meters);
 * this compares the days either side of it from the same readings the reports use.
 *
 * The rules, in one place, so the Analysis page, the energy review and the Overview all say the same:
 * - Like for like: the same hours and the same kinds of day. At a lights-on site only the lights-on hours count (the
 *   night, by the site's own published hours, or 19:00–07:00 when none are set); otherwise the whole day. Weekdays are
 *   compared with weekdays, weekends with weekends and public holidays with public holidays (with weekends when no
 *   holiday came before, as holidays count with the weekend elsewhere). The days after are compared as they fell: the
 *   figure before is what the same mix of days used before the change.
 * - Complete days only, by the reports' rule: every expected minute received and no reading with a problem (a meter
 *   marked not in use, or idle, never makes a day incomplete). Energy a meter sent late after being offline counts in
 *   that day's total, as everywhere else, but the day stays incomplete, so it is never compared.
 * - Before: up to BEFORE_AFTER_BEFORE_DAYS complete days before the change, looking back no further than
 *   BEFORE_AFTER_LOOKBACK_DAYS. After: every complete day since, up to the last of the chosen dates. The day of the
 *   change itself is left out: it is part before and part after.
 * - A figure needs BEFORE_AFTER_MIN_DAYS complete days after (and before); it is called reliable from
 *   BEFORE_AFTER_RELIABLE_DAYS on both sides, and early until then.
 * - Money at the site's electricity rate for the chosen dates, with the tax added when the rate is published before
 *   tax (as the energy review does); a month is BEFORE_AFTER_MONTH_DAYS days. Carbon at the site's grid factor.
 *
 * Pure: no fetching, no clock, no DOM.
 */
import { averageFullDay, effectiveHours, isOpenHour, localDayType, type AnalysisDayType, type HoursByDay, type HoursMeaning } from "./analysis-model.js";
import type { AnalysisData, ScopeData, SiteChange, TrendCell, TrendSeries } from "./analysis-types.js";
import { shiftScopeDate } from "./analysis-scope.js";
import { meterSeries } from "./group-insights.js";
import type { MeterGroup } from "./meter-groups.js";
import { idleIds, notInUseIds, silentByDesignIds, withMetersInUse } from "./meters-in-use.js";

/** At most this many complete days before the change are compared… */
export const BEFORE_AFTER_BEFORE_DAYS = 28;
/** …found no further back than this, so the days before are recent ones. */
export const BEFORE_AFTER_LOOKBACK_DAYS = 56;
/** Complete days needed after the change (and before it) before any figure is given. */
export const BEFORE_AFTER_MIN_DAYS = 3;
/** Complete days on each side from which the figure is called reliable. */
export const BEFORE_AFTER_RELIABLE_DAYS = 7;
/** The month the reports quote: 30 days. */
export const BEFORE_AFTER_MONTH_DAYS = 30;

/**
 * - `upcoming`: the change starts after the last of the chosen dates, so nothing after it is in these readings yet.
 * - `waiting`: fewer than BEFORE_AFTER_MIN_DAYS complete days since the change.
 * - `no-before`: enough days after, but too few complete days before to compare with.
 * - `early`: a figure, from fewer than BEFORE_AFTER_RELIABLE_DAYS days on one side.
 * - `reliable`: a figure from at least BEFORE_AFTER_RELIABLE_DAYS complete days on each side.
 */
export type BeforeAfterStatus = "upcoming" | "waiting" | "no-before" | "early" | "reliable";

/** One day of the comparison: `kwh` in the compared hours (null with no reading at all); `counted` when it is in the averages. */
export type BeforeAfterDay = { date: string; dayType: AnalysisDayType; side: "before" | "change" | "after"; kwh: number | null; complete: boolean; counted: boolean };

/** An amount over a stretch of time: kWh, what it costs and the carbon it means (null without a rate or a factor). */
export type BeforeAfterAmount = { kwh: number; cost: number | null; co2Kg: number | null };

/**
 * The comparison's figures. `beforeKwh` and `afterKwh` are an average day in the compared hours; every change is after
 * minus before, so a saving is negative. `changePct` is null when nothing was used before.
 */
export type BeforeAfterFigures = {
  beforeKwh: number; afterKwh: number; changeKwh: number; changePct: number | null;
  day: { before: BeforeAfterAmount; after: BeforeAfterAmount; change: BeforeAfterAmount };
  month: { before: BeforeAfterAmount; after: BeforeAfterAmount; change: BeforeAfterAmount };
  year: { before: BeforeAfterAmount; after: BeforeAfterAmount; change: BeforeAfterAmount };
};

export type BeforeAfterComparison = {
  status: BeforeAfterStatus;
  /** Complete days compared on each side. */
  beforeDays: number; afterDays: number;
  /** Complete days after the change left out because no day of the same kind came before it. */
  unmatchedAfterDays: number;
  /** The first and last day compared on each side; null with none. */
  beforeFrom: string | null; beforeTo: string | null; afterFrom: string | null; afterTo: string | null;
  /** The average day before the change, every kind of day (as the reports' average day): the baseline while waiting. */
  baselineKwh: number | null;
  figures: BeforeAfterFigures | null;
};

/** A top-level group's part in the change: the affected meters filed in it, compared on their own. */
export type BeforeAfterGroup = BeforeAfterComparison & { id: string; name: string; meterIds: string[] };

export type BeforeAfter = BeforeAfterComparison & {
  change: SiteChange;
  /** The hours compared: the lights-on hours, or the whole day. */
  measure: "lights_on" | "whole_day";
  /** The lights-on hours in force (the site's own, or the default when none are set); null for the whole day. */
  hours: HoursByDay | null;
  /** The whole site (its official total), or only the meters the change affects (their own readings added up). */
  scope: "site" | "meters";
  /** The meters the change affects, as readers know them; empty for the whole site. */
  meters: Array<{ id: string; name: string }>;
  /** The days for a chart, from the first day compared before the change to the last of the chosen dates. */
  days: BeforeAfterDay[];
  /** Each top-level group's part, in its saved order; only when the change reaches two groups or more. */
  groups: BeforeAfterGroup[];
  /** The price per kWh the money uses, tax added when the rate is published before tax; null without a rate. */
  rate: number | null; currency: string | null;
  /** Whether the costs include the tax on the price (`taxName`, such as GST). */
  taxIncluded: boolean; taxName: string | null;
  /** kg CO2e per kWh; null without a factor. */
  carbonFactor: number | null;
};

type DayRecord = { date: string; dayType: AnalysisDayType; kwh: number | null; complete: boolean };
type Source = { dates: ReadonlySet<string>; total: TrendSeries | null; meters: ReadonlyMap<string, TrendSeries> };

const byDate = new WeakMap<TrendSeries, Map<string, TrendCell[]>>();
/** A series' hours on one date, indexed once per series. */
function cellsOn(series: TrendSeries, date: string): TrendCell[] {
  let index = byDate.get(series);
  if (!index) {
    index = new Map();
    for (const cell of series.cells) { const list = index.get(cell[0]); if (list) list.push(cell); else index.set(cell[0], [cell]); }
    byDate.set(series, index);
  }
  return index.get(date) ?? [];
}

/**
 * One date of one series: kWh in the compared hours, energy sent late included (null with no reading at all), and
 * whether the day is complete by the same rule as scopeDays.
 */
function seriesDay(series: TrendSeries, date: string, include: (date: string, hour: number) => boolean): { kwh: number | null; complete: boolean } {
  let minutes = 0, recovered = 0, measured = 0, problem = false;
  for (const cell of cellsOn(series, date)) {
    minutes += cell[3];
    recovered += cell[5] ?? 0;
    if (cell[4] !== 0) problem = true;
    if (include(date, cell[1])) measured += (cell[2] ?? 0) + (cell[5] ?? 0);
  }
  return { kwh: minutes > 0 || recovered > 0 ? measured : null, complete: minutes >= series.expectedMinutesPerHour * 24 && !problem };
}

/**
 * Where each date's readings come from: the chosen dates, the period before them, then all history (the site's total
 * only, and meters placed on the site itself). A meter marked not in use never makes a day incomplete; one idle when
 * the readings were loaded only within the chosen dates, as the reports judge them.
 */
function sourcesOf(data: AnalysisData): Source[] {
  const period = (project: ScopeData, spaces: readonly ScopeData[], silent: ReadonlySet<string>, sentNothing: ReadonlySet<string>): Source =>
    ({ dates: new Set(project.dates), total: withMetersInUse(project, silent, spaces, sentNothing).total, meters: meterSeries([project, ...spaces]) });
  const notInUse = notInUseIds(data);
  return [
    period(data.current.project, data.current.spaces, silentByDesignIds(data), idleIds(data)),
    ...(data.previous ? [period(data.previous.project, data.previous.spaces, notInUse, new Set<string>())] : []),
    ...(data.history ? [period(data.history, [], notInUse, new Set<string>())] : []),
  ];
}

function siteDay(sources: readonly Source[], date: string, include: (date: string, hour: number) => boolean): { kwh: number | null; complete: boolean } {
  const source = sources.find(item => item.dates.has(date) && item.total);
  return source ? seriesDay(source.total!, date, include) : { kwh: null, complete: false };
}

/** The meters added up on one date: complete only when every meter in use is complete that day. */
function metersDay(sources: readonly Source[], ids: readonly string[], date: string, include: (date: string, hour: number) => boolean, silent: ReadonlySet<string>): { kwh: number | null; complete: boolean } {
  let kwh = 0, read = false, complete = ids.length > 0;
  for (const id of ids) {
    const series = sources.find(item => item.dates.has(date) && item.meters.has(id))?.meters.get(id);
    const day = series ? seriesDay(series, date, include) : { kwh: null, complete: false };
    if (day.kwh != null) { kwh += day.kwh; read = true; }
    if (!day.complete && !silent.has(id)) complete = false;
  }
  return { kwh: read ? kwh : null, complete: complete && read };
}

const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const usable = (record: DayRecord): record is DayRecord & { kwh: number } => record.complete && record.kwh != null;

/** The kind of day before the change that a kind of day after it is compared with; null with none. */
function matchFor(kind: AnalysisDayType, before: ReadonlyMap<AnalysisDayType, number[]>): AnalysisDayType | null {
  if (before.get(kind)?.length) return kind;
  return kind === "public_holiday" && before.get("weekend")?.length ? "weekend" : null;
}

type Price = { rate: number | null; carbon: number | null };
const amount = (kwh: number, price: Price): BeforeAfterAmount => ({ kwh, cost: price.rate == null ? null : kwh * price.rate, co2Kg: price.carbon == null ? null : kwh * price.carbon });
const stretch = (before: number, after: number, days: number, price: Price) =>
  ({ before: amount(before * days, price), after: amount(after * days, price), change: amount((after - before) * days, price) });

/**
 * The comparison from each date's record (dates ascending), for a change on `changeDate` and readings up to `lastDate`,
 * with the dates it counted on each side.
 */
function compare(records: readonly DayRecord[], changeDate: string, lastDate: string, meaning: HoursMeaning, price: Price): { comparison: BeforeAfterComparison; counted: ReadonlySet<string> } {
  const before = records.filter(record => record.date < changeDate).filter(usable).slice(-BEFORE_AFTER_BEFORE_DAYS);
  const after = records.filter(record => record.date > changeDate && record.date <= lastDate).filter(usable);
  const beforeByKind = new Map<AnalysisDayType, number[]>();
  for (const day of before) beforeByKind.set(day.dayType, [...(beforeByKind.get(day.dayType) ?? []), day.kwh]);
  const matched = after.filter(day => matchFor(day.dayType, beforeByKind) != null);
  // The figure before is what the same mix of days used before: each kind's average weighted by its share of the days after.
  const kinds = new Map<AnalysisDayType, number>();
  for (const day of matched) { const kind = matchFor(day.dayType, beforeByKind)!; kinds.set(kind, (kinds.get(kind) ?? 0) + 1); }
  const comparedBefore = before.filter(day => kinds.has(day.dayType));
  const afterKwh = mean(matched.map(day => day.kwh));
  const beforeKwh = matched.length ? [...kinds].reduce((sum, [kind, count]) => sum + mean(beforeByKind.get(kind)!)! * count / matched.length, 0) : null;
  const status: BeforeAfterStatus = changeDate > lastDate ? "upcoming" : matched.length < BEFORE_AFTER_MIN_DAYS ? "waiting"
    : comparedBefore.length < BEFORE_AFTER_MIN_DAYS ? "no-before"
      : matched.length >= BEFORE_AFTER_RELIABLE_DAYS && comparedBefore.length >= BEFORE_AFTER_RELIABLE_DAYS ? "reliable" : "early";
  const figures: BeforeAfterFigures | null = (status === "early" || status === "reliable") && beforeKwh != null && afterKwh != null ? {
    beforeKwh, afterKwh, changeKwh: afterKwh - beforeKwh, changePct: beforeKwh > 0 ? (afterKwh / beforeKwh - 1) * 100 : null,
    day: stretch(beforeKwh, afterKwh, 1, price), month: stretch(beforeKwh, afterKwh, BEFORE_AFTER_MONTH_DAYS, price), year: stretch(beforeKwh, afterKwh, 365, price),
  } : null;
  // With a figure, the days compared; while waiting, the days the baseline comes from.
  const shownBefore = figures ? comparedBefore : before;
  const shownAfter = figures ? matched : [];
  return {
    comparison: {
      status, beforeDays: shownBefore.length, afterDays: matched.length, unmatchedAfterDays: after.length - matched.length,
      beforeFrom: shownBefore[0]?.date ?? null, beforeTo: shownBefore.at(-1)?.date ?? null, afterFrom: matched[0]?.date ?? null, afterTo: matched.at(-1)?.date ?? null,
      baselineKwh: averageFullDay(before.map(day => ({ complete: true, dayType: day.dayType, totalKwh: day.kwh })), meaning), figures,
    },
    counted: new Set([...shownBefore, ...shownAfter].map(day => day.date)),
  };
}

/** Dates from `from` to `to`, both included. */
function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let date = from; date <= to; date = shiftScopeDate(date, 1)) dates.push(date);
  return dates;
}

/** The top-level group a group sits in (itself when it is one); null for a group that is not in the list. */
function topGroups(list: readonly MeterGroup[]): (id: string | null | undefined) => MeterGroup | null {
  const byId = new Map(list.map(group => [group.id, group]));
  return id => {
    let group = id ? byId.get(id) : undefined;
    for (let depth = 0; group?.parentId && byId.has(group.parentId) && depth < 64; depth += 1) group = byId.get(group.parentId);
    return group ?? null;
  };
}

/** The price per kWh and the carbon factor the figures use, as the energy review reads them. */
function priceOf(data: AnalysisData) {
  const priced = [data.current.project, data.previous?.project].find(scope => scope?.cost && scope.usageKwh);
  const cost = priced?.cost ?? data.current.project.cost;
  const basis = cost?.basis ?? (cost?.note.includes("before tax") ? "tax_exclusive" : cost?.note.includes("incl. tax") ? "tax_inclusive" : null);
  const taxPct = basis === "tax_exclusive" && data.tariffTax && data.tariffTax.ratePct > 0 ? data.tariffTax.ratePct : 0;
  const rate = priced?.cost && priced.usageKwh ? priced.cost.amount / priced.usageKwh * (1 + taxPct / 100) : null;
  const carbon = data.carbon && Number.isFinite(data.carbon.kgCo2ePerKwh) && data.carbon.kgCo2ePerKwh >= 0 ? data.carbon.kgCo2ePerKwh : null;
  return { rate, currency: cost?.currency ?? null, taxIncluded: rate != null && (taxPct > 0 || basis === "tax_inclusive"), taxName: data.tariffTax?.name?.trim() || null, carbon };
}

/**
 * The before and after of one change, from the readings the Analysis page loaded (see the rules at the top). The
 * figures cover the whole site (its official total) when the change lists no meters, otherwise the listed meters
 * added up. Each top-level group the change reaches is compared on its own too.
 */
export function beforeAfter(data: AnalysisData, change: SiteChange): BeforeAfter {
  const meaning: HoursMeaning = data.hoursMeaning ?? "opening";
  const lighting = meaning === "lights_on";
  const hours = lighting ? effectiveHours(data.openingHours, meaning) : null;
  const include = hours ? (date: string, hour: number) => isOpenHour(hours, date, hour) : () => true;
  const lastDate = data.current.project.dates.at(-1) ?? change.date;
  const sources = sourcesOf(data);
  const silent = silentByDesignIds(data);
  const window = datesBetween(shiftScopeDate(change.date, -BEFORE_AFTER_LOOKBACK_DAYS), lastDate > change.date ? lastDate : change.date);
  const kindOf = (date: string) => localDayType(date, data.holidays).dayType;
  const recordsFor = (day: (date: string) => { kwh: number | null; complete: boolean }): DayRecord[] => window.map(date => ({ date, dayType: kindOf(date), ...day(date) }));
  const price = priceOf(data);
  const priceInput: Price = { rate: price.rate, carbon: price.carbon };

  // Every meter as readers know it, wherever the readings list it.
  const names = new Map<string, string>();
  for (const scope of [data.current.project, ...data.current.spaces, ...(data.previous ? [data.previous.project, ...data.previous.spaces] : [])]) for (const meter of scope.meters) if (!names.has(meter.id)) names.set(meter.id, meter.name);
  for (const meter of data.groups?.meters ?? []) if (!names.has(meter.id)) names.set(meter.id, meter.name);

  const scope: BeforeAfter["scope"] = change.meterIds.length ? "meters" : "site";
  const records = scope === "site" ? recordsFor(date => siteDay(sources, date, include)) : recordsFor(date => metersDay(sources, change.meterIds, date, include, silent));
  const { comparison: headline, counted } = compare(records, change.date, lastDate, meaning, priceInput);

  // The days for a chart: from the first day compared before (or four weeks before, with none) to the last chosen date.
  const start = headline.beforeFrom ?? shiftScopeDate(change.date, -BEFORE_AFTER_BEFORE_DAYS);
  const days: BeforeAfterDay[] = records.filter(record => record.date >= start && record.date <= lastDate).map(record => ({
    date: record.date, dayType: record.dayType, side: record.date < change.date ? "before" : record.date === change.date ? "change" : "after",
    kwh: record.kwh, complete: record.complete, counted: counted.has(record.date),
  }));

  // Each top-level group's part: the affected meters filed in it (every grouped meter for a change to the whole site).
  const groups: BeforeAfterGroup[] = [];
  if (data.groups?.list.length) {
    const top = topGroups(data.groups.list);
    const affected = scope === "site" ? data.groups.meters.filter(meter => !meter.unmetered).map(meter => meter.id) : change.meterIds;
    const groupOf = new Map(data.groups.meters.map(meter => [meter.id, meter.groupId]));
    const byGroup = new Map<string, string[]>();
    for (const id of affected) { const group = top(groupOf.get(id)); if (group) byGroup.set(group.id, [...(byGroup.get(group.id) ?? []), id]); }
    const order = new Map(data.groups.list.map((group, index) => [group.id, index]));
    const listed = [...byGroup.keys()].map(id => data.groups!.list.find(group => group.id === id)!)
      .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) || order.get(a.id)! - order.get(b.id)!);
    if (listed.length >= 2) for (const group of listed) {
      const meterIds = byGroup.get(group.id)!;
      groups.push({ id: group.id, name: group.name, meterIds, ...compare(recordsFor(date => metersDay(sources, meterIds, date, include, silent)), change.date, lastDate, meaning, priceInput).comparison });
    }
  }

  return {
    ...headline, change, measure: lighting ? "lights_on" : "whole_day", hours, scope,
    meters: change.meterIds.map(id => ({ id, name: names.get(id) ?? id })),
    days, groups, rate: price.rate, currency: price.currency, taxIncluded: price.taxIncluded, taxName: price.taxName, carbonFactor: price.carbon,
  };
}

/**
 * The changes Analysis shows for these dates, newest first: those that started on or before the last chosen date, and
 * those still to come while the dates shown run to the latest readings (so a change recorded ahead of time is shown as
 * waiting until its days arrive). A change after dates someone picked from the past is left out.
 */
export function beforeAfterChanges(data: Pick<AnalysisData, "changes" | "current" | "history">): SiteChange[] {
  const last = data.current.project.dates.at(-1);
  if (!last) return [];
  const latest = !data.history?.dates.length || data.history.dates.at(-1)! <= last;
  return (data.changes ?? []).filter(change => change.date <= last || latest);
}
