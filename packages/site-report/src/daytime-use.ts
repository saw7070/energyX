/**
 * Lights-on hours: which meters used power in the daytime, in which hours and on how many days, and the daytime share
 * the headline warns about. Shared by the site report, the management review, Analysis and the Overview so they all
 * name the same lights.
 *
 * The rules, in one place:
 * - Meters meant to run day and night (always on by design, such as emergency lighting) are left out. Their daytime
 *   use is expected; they stay in every total.
 * - The 20-minute allowance: a light that comes on or goes off within ON_TIME_MARGIN_MINUTES of the set hours is on
 *   time. Readings are often only hourly, so an hour is judged by how much it used. Each clock hour may rightly hold
 *   the minutes of it inside the set hours widened by 20 minutes at each end ("allowed minutes"). An hour that is not
 *   wholly allowed counts as on time when its use is no more than allowed minutes / 60 of the meter's usual
 *   lights-on hour. With hours set on the hour (19:00–07:00) that is a third of a usual lights-on hour in 18:00–19:00
 *   and in 07:00–08:00; with 18:30–07:15 it is five-sixths in 18:00–19:00 and seven-twelfths in 07:00–08:00.
 * - When an hour is not on time, what it used beyond its minutes inside the set hours is daytime use.
 * - An hour counts as "on" only when it used at least ON_MIN_SHARE of the meter's usual lights-on hour and at least
 *   ON_MIN_KWH. Tuya meters leave 0 kWh readings while idle and spread a few watt-hours over a quiet spell; neither is
 *   a light left on.
 * - Readings with a quality problem (energy a meter counted while offline, spread as an estimate) are never daytime
 *   use: when that energy was used is not known.
 *
 * A meter's usual lights-on hour is the average of its complete hours that lie wholly inside the set hours.
 */
import { bucketOf, effectiveHours, minutesInHours, type HoursByDay } from "./analysis-model.js";
import type { AnalysisData, ScopeData, TrendSeries } from "./analysis-types.js";
import { alwaysOnByDesignIds, type AlwaysOnMeter } from "./always-on-by-design.js";
import { standoutMeters } from "./standout-days.js";

/** A light that comes on or goes off within this many minutes of the set hours is on time. */
export const ON_TIME_MARGIN_MINUTES = 20;
/** An hour is "on" only when it used at least this share of the meter's usual lights-on hour (six minutes of light)… */
export const ON_MIN_SHARE = 0.1;
/** …and at least this many kWh. */
export const ON_MIN_KWH = 0.005;
/** A meter is named for daytime use only from this many kWh in the period; smaller amounts still count in the share. */
export const DAYTIME_NAMED_MIN_KWH = 0.05;

/** One meter that used power in the daytime: how much, on how many days, and its usual daytime hours (start hour, end hour). */
export type DaytimeMeter = { id: string; name: string; kwh: number; days: number; hours: Array<{ from: number; to: number }> };
export type DaytimeUse = {
  /** Daytime kWh as the headline counts it: every meter except those always on by design, with the allowance. */
  kwh: number;
  /** That kWh as a share of all use (always-on meters included); null with no use at all. */
  share: number | null;
  /** All use in the period, always-on meters included. */
  totalKwh: number;
  /** Meters that used power in the daytime, largest first (only those worth naming). */
  meters: DaytimeMeter[];
  /**
   * Every meter's daytime kWh as the rules count it, small amounts included, by meter id; always-on meters are not in
   * it. What stays on in the daytime and the savings plan take each meter's figure from here (closedUseBreakdown), so
   * a light the report calls on time is never offered as a saving.
   */
  byMeter: ReadonlyMap<string, number>;
  /** The always-on meters left out, as the readings name them. */
  alwaysOn: AlwaysOnMeter[];
};

const isComplete = (series: TrendSeries, cell: TrendSeries["cells"][number]) => cell[2] != null && cell[3] >= series.expectedMinutesPerHour && cell[4] === 0;

/** The average use of a meter's complete hours that lie wholly inside the set hours; null when it has none. */
export function usualLightsOnHour(series: TrendSeries | null | undefined, hours: HoursByDay, dates: ReadonlySet<string>): number | null {
  if (!series) return null;
  let sum = 0, count = 0;
  for (const cell of series.cells) if (dates.has(cell[0]) && isComplete(series, cell) && minutesInHours(hours, cell[0], cell[1]) >= 60) { sum += cell[2]!; count += 1; }
  return count ? sum / count : null;
}

/** The share of a usual lights-on hour a light may rightly use in one clock hour: its allowed minutes / 60. */
export const allowedShare = (hours: HoursByDay, date: string, hour: number) => minutesInHours(hours, date, hour, ON_TIME_MARGIN_MINUTES) / 60;

/**
 * Whether an hour next to the set hours is on time under the 20-minute allowance: its use is no more than its allowed
 * share of the usual lights-on hour. Without a usual lights-on hour nothing can be judged on time.
 */
export const onTime = (kwh: number, usualLitKwh: number | null, share: number) => usualLitKwh != null && usualLitKwh > 0 && share > 0 && kwh <= share * usualLitKwh;

/** Hours of the day (0–23) as runs of consecutive hours, joining a run that ends at midnight with one starting at it. */
function hourRuns(hours: number[]): Array<{ from: number; to: number }> {
  const sorted = [...new Set(hours)].sort((a, b) => a - b);
  const runs: Array<{ from: number; to: number }> = [];
  for (const hour of sorted) { const last = runs.at(-1); if (last && last.to === hour) last.to = hour + 1; else runs.push({ from: hour, to: hour + 1 }); }
  if (runs.length > 1 && runs[0]!.from === 0 && runs.at(-1)!.to === 24) { const first = runs.shift()!; runs.at(-1)!.to = 24 + first.to; }
  return runs.map(run => ({ from: run.from, to: run.to > 24 ? run.to - 24 : run.to }));
}

/**
 * Daytime use at a lights-on site (see the rules above). `project` is the whole site (pass the one with meters not in
 * use already accounted for, if the caller has it); its spaces are searched for each meter's own readings.
 */
export function daytimeUse(data: AnalysisData, project: ScopeData = data.current.project): DaytimeUse {
  const hours = effectiveHours(data.openingHours, "lights_on");
  const dates = new Set(project.dates);
  const daytime = (date: string, hour: number) => bucketOf(hours, date, "weekday", hour, { meaning: "lights_on" }) !== "open";
  // Today's figure for the whole site: every hour outside the set hours.
  let totalKwh = 0, siteDaytime = 0;
  for (const cell of project.total?.cells ?? []) if (dates.has(cell[0]) && cell[2] != null) { totalKwh += cell[2]; if (daytime(cell[0], cell[1])) siteDaytime += cell[2]; }
  const ids = alwaysOnByDesignIds(data);
  const meters = standoutMeters([project, ...data.current.spaces]);
  let adjustment = 0;
  const named: DaytimeMeter[] = [];
  const byMeter = new Map<string, number>();
  for (const meter of meters) {
    const series = meter.series!;
    // Each meter's own daytime by the hour, as in the site figure; replaced below by what the rules count.
    let hourDaytime = 0, counted = 0;
    const usual = usualLightsOnHour(series, hours, dates);
    const onAt = new Map<number, Set<string>>();
    const daysOn = new Set<string>();
    for (const cell of series.cells) {
      if (!dates.has(cell[0]) || cell[2] == null) continue;
      if (daytime(cell[0], cell[1])) hourDaytime += cell[2];
      if (ids.has(meter.id) || cell[4] !== 0) continue;
      const share = allowedShare(hours, cell[0], cell[1]);
      if (share >= 1 || onTime(cell[2], usual, share) || cell[2] < Math.max(ON_MIN_KWH, ON_MIN_SHARE * (usual ?? 0))) continue;
      const inside = minutesInHours(hours, cell[0], cell[1]) / 60;
      const extra = Math.max(0, cell[2] - inside * (usual ?? 0));
      if (extra <= 0) continue;
      counted += extra;
      daysOn.add(cell[0]);
      onAt.set(cell[1], (onAt.get(cell[1]) ?? new Set()).add(cell[0]));
    }
    adjustment += hourDaytime - counted;
    if (!ids.has(meter.id)) byMeter.set(meter.id, counted);
    if (counted < DAYTIME_NAMED_MIN_KWH) continue;
    // The usual daytime hours: those it was on in on at least a third of its daytime days, so one odd hour does not stretch them.
    const usualHours = [...onAt].filter(([, on]) => on.size >= Math.max(1, Math.ceil(daysOn.size / 3))).map(([hour]) => hour);
    named.push({ id: meter.id, name: meter.name, kwh: counted, days: daysOn.size, hours: hourRuns(usualHours.length ? usualHours : [...onAt.keys()]) });
  }
  const kwh = Math.max(0, siteDaytime - adjustment);
  const alwaysOn = (data.alwaysOnByDesign ?? []).filter(item => meters.some(meter => meter.id === item.id) || project.meters.some(meter => meter.id === item.id))
    .map(item => ({ id: item.id, name: meters.find(meter => meter.id === item.id)?.name ?? item.name }));
  return { kwh, share: totalKwh > 0 ? kwh / totalKwh : null, totalKwh, meters: named.sort((a, b) => b.kwh - a.kwh || a.name.localeCompare(b.name)), byMeter, alwaysOn };
}
