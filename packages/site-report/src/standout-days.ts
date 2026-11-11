/**
 * "Why was this day different?": which days used clearly more (or less) than a usual day of the same kind, and which
 * meters account for most of the difference. Pure and shared, so the Analysis chart, the Overview report and anything
 * on the server tell the same story from the same readings.
 *
 * The rules, in one place:
 * - Same kind: weekday, weekend or public holiday, as the rest of the app classifies days. At a lights-on site the
 *   lights run every night, so every day is the same kind.
 * - Usual day: the middle value (median) of the complete days of that kind in the chosen dates. At least
 *   STANDOUT_MIN_DAYS of them are needed; with fewer, nothing is called out for that kind.
 * - A day stands out only when its difference from the usual day is more than STANDOUT_MIN_PCT percent of it AND
 *   more than STANDOUT_SPREAD_TIMES times the normal day-to-day variation (the median distance of those days from
 *   the usual day, scaled to be comparable with a standard deviation).
 * - A day with missing readings is never compared and never blamed on a meter.
 * - Meters: each meter's own usual day is the median of its complete days among the same comparison days. A meter
 *   whose readings are incomplete on the day is left out (its share stays in "everything else"), so the named meters
 *   plus `otherKwh` always add up to the whole difference. Meters go by the name readers see first (the short name
 *   when one is set) and their group, as everywhere else.
 *
 * The same usual day is the Analysis chart's expected-day line and what its "unusually high" check measures against
 * (usualDayBaselines), so the page shows one usual figure.
 */
import type { AnalysisBaseline, AnalysisDay, AnalysisDayType } from "./analysis-model.js";
import type { AnalysisGroups, ScopeData, ScopeMeter, TrendSeries } from "./analysis-types.js";

/** Smallest difference from a usual day worth calling out, in percent of it. */
export const STANDOUT_MIN_PCT = 3;
/** How many times the normal day-to-day variation a day has to differ by. */
export const STANDOUT_SPREAD_TIMES = 2;
/** Complete days of a kind needed before a usual day is worked out. */
export const STANDOUT_MIN_DAYS = 5;
/** At most this many meters are named for one day. */
export const STANDOUT_MAX_METERS = 3;
/** A meter is named only when it explains at least this share of the difference. */
export const STANDOUT_NAMED_SHARE = 0.1;
const NAMED_SHARE = STANDOUT_NAMED_SHARE;
/** Differences smaller than this would print as "+0.0 kWh". */
export const STANDOUT_NAMED_MIN_KWH = 0.05;
const NAMED_MIN_KWH = STANDOUT_NAMED_MIN_KWH;
/** Named meters that explain at least this share of the difference are "most of" it. */
export const STANDOUT_MOST_SHARE = 0.5;
const MOST_SHARE = STANDOUT_MOST_SHARE;
/** Median absolute deviation × 1.4826 is comparable with a standard deviation for normally spread days. */
const MAD_TO_SPREAD = 1.4826;

/** The kind of day a day is compared within. "any": every day, at a lights-on site. */
export type DayKind = AnalysisDayType | "any";
/**
 * One meter's change on a day. `name` is the name readers see first (the short name when one is set) and `fullName`
 * the installer's full label behind it; `place` is the meter's group ("Block 264F › Ground floor"), or its location
 * for readings saved before groups existed, or empty when it is in no group.
 */
export type StandoutContributor = { id: string; name: string; fullName?: string | undefined; place: string; kwh: number; usualKwh: number; deltaKwh: number };
export type DayExplanation = {
  date: string; kind: DayKind; totalKwh: number;
  /** missing: readings were missing, not compared. few-days: too few complete days of this kind. usual: no clear difference. standout: a clear difference. */
  status: "missing" | "few-days" | "usual" | "standout";
  /** The usual day of this kind and the difference from it; null when there is none to compare with. */
  usualKwh: number | null; deltaKwh: number | null; deltaPct: number | null;
  /** Normal day-to-day variation of this kind, in kWh. */
  spreadKwh: number | null;
  /** Complete days of this kind the usual day was worked out from. */
  samples: number;
  /** For a standout day: the meters that moved most the same way as the whole site, largest first. */
  contributors: StandoutContributor[];
  /** The rest of the difference: the whole difference minus the named meters. */
  otherKwh: number;
  /** most: the named meters explain most of it. spread: they explain less than half. none: no single meter stands out. Null without meter readings. */
  lead: "most" | "spread" | "none" | null;
  /**
   * For a standout day: every meter's change that day (meters with complete readings and a usual day of their own),
   * so the change can also be added up by group. Absent on other days.
   */
  moves?: StandoutContributor[] | undefined;
};

export const dayKindOf = (day: Pick<AnalysisDay, "dayType">, lighting: boolean): DayKind => lighting ? "any" : day.dayType;

const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/** Each local date's kWh in one series, and whether that day is complete: the same rule as the day totals (scopeDays). */
function dailyValues(series: TrendSeries | null | undefined): Map<string, { kwh: number; complete: boolean }> {
  const days = new Map<string, { kwh: number; minutes: number; flagged: boolean }>();
  for (const cell of series?.cells ?? []) {
    const day = days.get(cell[0]) ?? { kwh: 0, minutes: 0, flagged: false };
    day.kwh += cell[2] ?? 0;
    day.minutes += cell[3];
    day.flagged ||= cell[4] !== 0;
    days.set(cell[0], day);
  }
  const expected = (series?.expectedMinutesPerHour ?? 60) * 24;
  return new Map([...days].map(([date, day]) => [date, { kwh: day.kwh, complete: day.minutes >= expected && !day.flagged }]));
}

/**
 * The meters a day's difference is split between: every real circuit with readings, without the totals above them —
 * a main meter, or an official meter whose location also has sub-meters (those sub-meters already show where its
 * energy went). The same rule as the circuit ranking. Each meter appears once, however many scopes list it.
 */
export function standoutMeters(scopes: ScopeData[]): ScopeMeter[] {
  const byId = new Map<string, ScopeMeter>();
  for (const scope of scopes) for (const meter of scope.meters) {
    const known = byId.get(meter.id);
    if (!known || (!known.series && meter.series)) byId.set(meter.id, meter);
  }
  const all = [...byId.values()].filter(meter => meter.series);
  const main = (meter: ScopeMeter) => meter.category === "overall";
  const subMetered = new Set(all.filter(meter => !meter.official && !main(meter)).map(meter => meter.location));
  const circuits = all.filter(meter => !main(meter) && !(meter.official && subMetered.has(meter.location)));
  return circuits.length ? circuits : all;
}

/**
 * Each meter's group as readers see it, the groups above it first ("Common area › Pavilion"), from the readings'
 * groups. Null when the readings carry no groups (saved before groups existed); a meter in no group has an empty place.
 */
export function meterGroupPlaces(groups: AnalysisGroups | undefined): Map<string, string> | null {
  if (!groups?.list.length) return null;
  const byId = new Map(groups.list.map(group => [group.id, group]));
  const path = (id: string | null) => {
    const names: string[] = [], seen = new Set<string>();
    for (let group = id ? byId.get(id) : undefined; group && !seen.has(group.id); group = group.parentId ? byId.get(group.parentId) : undefined) {
      seen.add(group.id);
      names.unshift(group.name);
    }
    return names.join(" › ");
  };
  return new Map(groups.meters.map(meter => [meter.id, path(meter.groupId)]));
}

/** The usual day of each kind of day present: the median of its complete days, and their day-to-day spread. */
function usualDays(days: AnalysisDay[], lighting: boolean): Map<DayKind, { dates: string[]; usual: number | null; spread: number | null }> {
  const groups = new Map<DayKind, { dates: string[]; usual: number | null; spread: number | null }>();
  for (const kind of new Set(days.map(day => dayKindOf(day, lighting)))) {
    const samples = days.filter(day => day.complete && dayKindOf(day, lighting) === kind);
    const dates = samples.map(day => day.date);
    if (samples.length < STANDOUT_MIN_DAYS) { groups.set(kind, { dates, usual: null, spread: null }); continue; }
    const usual = median(samples.map(day => day.totalKwh))!;
    groups.set(kind, { dates, usual, spread: median(samples.map(day => Math.abs(day.totalKwh - usual)))! * MAD_TO_SPREAD });
  }
  return groups;
}

/**
 * The usual day for each day type, shaped as the chart's expected-day line and the unusual-day check use it. At a
 * lights-on site every day type has the same usual day. Null for a type with fewer than STANDOUT_MIN_DAYS complete days.
 */
export function usualDayBaselines(days: AnalysisDay[], lighting = false): AnalysisBaseline[] {
  const groups = usualDays(days, lighting);
  return (["weekday", "weekend", "public_holiday"] as const).map(dayType => {
    const group = groups.get(lighting ? "any" : dayType);
    return { dayType, samples: group?.dates.length ?? 0, expectedKwh: group?.usual ?? null };
  });
}

/**
 * Every day of the period with its explanation. `days` are one scope's days (from scopeDays) and `meters` the meters
 * inside that scope (from standoutMeters). `lighting` makes every day the same kind. `places` names each meter's group
 * (from meterGroupPlaces); without it a meter's location is shown.
 */
export function explainDays(input: { days: AnalysisDay[]; meters?: ScopeMeter[]; lighting?: boolean; places?: Map<string, string> | null }): DayExplanation[] {
  const lighting = input.lighting ?? false;
  const kindOf = (day: AnalysisDay) => dayKindOf(day, lighting);
  const meters = (input.meters ?? []).map(meter => ({ meter, days: dailyValues(meter.series) }));
  const placeOf = (meter: ScopeMeter) => input.places ? input.places.get(meter.id) ?? "" : meter.location;
  // The usual day of each kind, its spread, and each meter's own usual day over the same comparison days.
  const groups = new Map([...usualDays(input.days, lighting)].map(([kind, group]) => {
    const meterUsual = new Map<string, number>();
    if (group.usual != null) for (const { meter, days } of meters) {
      const own = group.dates.map(date => days.get(date)).filter(day => day?.complete).map(day => day!.kwh);
      // A meter needs most of the comparison days itself before its usual day means anything.
      if (own.length >= Math.max(3, Math.ceil(group.dates.length / 2))) meterUsual.set(meter.id, median(own)!);
    }
    return [kind, { ...group, meterUsual }];
  }));
  return input.days.map((day): DayExplanation => {
    const kind = kindOf(day);
    const group = groups.get(kind)!;
    const base = { date: day.date, kind, totalKwh: day.totalKwh, samples: group.dates.length, contributors: [] as StandoutContributor[], otherKwh: 0, lead: null };
    if (!day.complete) return { ...base, status: "missing", usualKwh: null, deltaKwh: null, deltaPct: null, spreadKwh: group.spread };
    if (group.usual == null) return { ...base, status: "few-days", usualKwh: null, deltaKwh: null, deltaPct: null, spreadKwh: null };
    const deltaKwh = day.totalKwh - group.usual;
    const deltaPct = group.usual > 0 ? deltaKwh / group.usual * 100 : null;
    const clear = deltaPct != null && Math.abs(deltaPct) > STANDOUT_MIN_PCT && Math.abs(deltaKwh) > STANDOUT_SPREAD_TIMES * group.spread!;
    const compared = { ...base, usualKwh: group.usual, deltaKwh, deltaPct, spreadKwh: group.spread };
    if (!clear) return { ...compared, status: "usual" };
    // Each meter's own change on this day; a meter with missing readings that day is never blamed.
    const moves: StandoutContributor[] = meters.flatMap(({ meter, days }) => {
      const own = days.get(day.date), usual = group.meterUsual.get(meter.id);
      return own?.complete && usual !== undefined
        ? [{ id: meter.id, name: meter.name, ...(meter.fullName ? { fullName: meter.fullName } : {}), place: placeOf(meter), kwh: own.kwh, usualKwh: usual, deltaKwh: own.kwh - usual }] : [];
    });
    const sign = Math.sign(deltaKwh);
    const contributors = moves.filter(move => move.deltaKwh * sign >= Math.max(NAMED_MIN_KWH, Math.abs(deltaKwh) * NAMED_SHARE))
      .sort((a, b) => b.deltaKwh * sign - a.deltaKwh * sign).slice(0, STANDOUT_MAX_METERS);
    const named = contributors.reduce((sum, move) => sum + move.deltaKwh, 0);
    const lead = !meters.length ? null : !contributors.length ? "none" : named * sign >= Math.abs(deltaKwh) * MOST_SHARE ? "most" : "spread";
    return { ...compared, status: "standout", contributors, otherKwh: deltaKwh - named, lead, moves };
  });
}

/** Standout days only, the clearest first (largest difference in percent). */
export const standoutDays = (explanations: DayExplanation[]) =>
  explanations.filter(item => item.status === "standout").sort((a, b) => Math.abs(b.deltaPct ?? 0) - Math.abs(a.deltaPct ?? 0) || a.date.localeCompare(b.date));
