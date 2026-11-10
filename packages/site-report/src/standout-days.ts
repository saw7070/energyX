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
 *   plus `otherKwh` always add up to the whole difference.
 */
import type { AnalysisBaseline, AnalysisDay, AnalysisDayType } from "./analysis-model.js";
import type { ScopeData, ScopeMeter, TrendSeries } from "./analysis-types.js";

/** Smallest difference from a usual day worth calling out, in percent of it. */
export const STANDOUT_MIN_PCT = 3;
/** How many times the normal day-to-day variation a day has to differ by. */
export const STANDOUT_SPREAD_TIMES = 2;
/** Complete days of a kind needed before a usual day is worked out. */
export const STANDOUT_MIN_DAYS = 5;
/** At most this many meters are named for one day. */
export const STANDOUT_MAX_METERS = 3;
/** A meter is named only when it explains at least this share of the difference. */
const NAMED_SHARE = 0.1;
/** Differences smaller than this would print as "+0.0 kWh". */
const NAMED_MIN_KWH = 0.05;
/** Named meters that explain at least this share of the difference are "most of" it. */
const MOST_SHARE = 0.5;
/** Median absolute deviation × 1.4826 is comparable with a standard deviation for normally spread days. */
const MAD_TO_SPREAD = 1.4826;

/** The kind of day a day is compared within. "any": every day, at a lights-on site. */
export type DayKind = AnalysisDayType | "any";
export type StandoutContributor = { id: string; name: string; location: string; kwh: number; usualKwh: number; deltaKwh: number };
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
 * Every day of the period with its explanation. `days` are one scope's days (from scopeDays) and `meters` the meters
 * inside that scope (from standoutMeters). `lighting` makes every day the same kind.
 */
export function explainDays(input: { days: AnalysisDay[]; meters?: ScopeMeter[]; lighting?: boolean }): DayExplanation[] {
  const lighting = input.lighting ?? false;
  const kindOf = (day: AnalysisDay) => dayKindOf(day, lighting);
  const meters = (input.meters ?? []).map(meter => ({ meter, days: dailyValues(meter.series) }));
  // The usual day of each kind, its spread, and each meter's own usual day over the same comparison days.
  const groups = new Map<DayKind, { dates: string[]; usual: number | null; spread: number | null; meterUsual: Map<string, number> }>();
  for (const kind of new Set(input.days.map(kindOf))) {
    const samples = input.days.filter(day => day.complete && kindOf(day) === kind);
    const dates = samples.map(day => day.date);
    if (samples.length < STANDOUT_MIN_DAYS) { groups.set(kind, { dates, usual: null, spread: null, meterUsual: new Map() }); continue; }
    const usual = median(samples.map(day => day.totalKwh))!;
    const spread = median(samples.map(day => Math.abs(day.totalKwh - usual)))! * MAD_TO_SPREAD;
    const meterUsual = new Map<string, number>();
    for (const { meter, days } of meters) {
      const own = dates.map(date => days.get(date)).filter(day => day?.complete).map(day => day!.kwh);
      // A meter needs most of the comparison days itself before its usual day means anything.
      if (own.length >= Math.max(3, Math.ceil(dates.length / 2))) meterUsual.set(meter.id, median(own)!);
    }
    groups.set(kind, { dates, usual, spread, meterUsual });
  }
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
      return own?.complete && usual !== undefined ? [{ id: meter.id, name: meter.name, location: meter.location, kwh: own.kwh, usualKwh: usual, deltaKwh: own.kwh - usual }] : [];
    });
    const sign = Math.sign(deltaKwh);
    const contributors = moves.filter(move => move.deltaKwh * sign >= Math.max(NAMED_MIN_KWH, Math.abs(deltaKwh) * NAMED_SHARE))
      .sort((a, b) => b.deltaKwh * sign - a.deltaKwh * sign).slice(0, STANDOUT_MAX_METERS);
    const named = contributors.reduce((sum, move) => sum + move.deltaKwh, 0);
    const lead = !meters.length ? null : !contributors.length ? "none" : named * sign >= Math.abs(deltaKwh) * MOST_SHARE ? "most" : "spread";
    return { ...compared, status: "standout", contributors, otherKwh: deltaKwh - named, lead };
  });
}

/** Standout days only, the clearest first (largest difference in percent). */
export const standoutDays = (explanations: DayExplanation[]) =>
  explanations.filter(item => item.status === "standout").sort((a, b) => Math.abs(b.deltaPct ?? 0) - Math.abs(a.deltaPct ?? 0) || a.date.localeCompare(b.date));

/**
 * The expected day for a lights-on site's daily chart, where every day is one kind: the mean of complete days of any
 * kind, repeated for each day type so the existing chart lines and the unusual-day check keep working.
 */
export function everyDayBaselines(days: AnalysisDay[], minSamples = 3): AnalysisBaseline[] {
  const samples = days.filter(day => day.complete).map(day => day.totalKwh);
  const expectedKwh = samples.length >= minSamples ? samples.reduce((sum, value) => sum + value, 0) / samples.length : null;
  return (["weekday", "weekend", "public_holiday"] as const).map(dayType => ({ dayType, samples: samples.length, expectedKwh }));
}
