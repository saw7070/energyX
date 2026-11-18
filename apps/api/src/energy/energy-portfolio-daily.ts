import type { EnergyDailyMeterFacts } from "@datafoundry/data-gateway";
import type { EnergyIqAnalysisInterval } from "@datafoundry/metadata";
import { averageFullDay, categoryOf, scopeDays, withMetersInUse, type HoursMeaning, type ScopeData, type TrendCell, type TrendSeries } from "@datafoundry/site-report";

/**
 * How much a site uses on an average day, and each day's use for the Portfolio's small trend chart.
 *
 * The Portfolio leads with a site's average full day (siteFullDays below), the same figure as its Overview. This is
 * what it falls back to when no day in the period is complete: the average of days with readings, the kWh read divided
 * by how many days of readings that is. A site connected part-way through the period is therefore counted from its
 * first reading (as data availability does), and a day lost to an outage does not drag the average down. Time between
 * two readings whose running total did not move is a real reading of 0 kWh (a lighting circuit by day), so it counts
 * as read time. Energy a meter counted while offline (an estimate) has no read time and is left out of both sides.
 */
export type SiteDailyFigures = {
  /** kWh per day of readings (the average of days with readings); 0 when there is less than one day of readings. */
  averageDailyKwh: number;
  /** Days of readings the average is over, to one decimal (a day with half its readings counts as half). */
  readingDays: number;
  /** One value per local date from the period's first to its last day; null on a day with no readings. */
  dailyKwh: Array<number | null>;
};

/** A whole day of readings, in minutes (as ENERGY_METER_DAY_MINUTES in the daily meter facts). */
const DAY_MINUTES = 24 * 60;
/** Below one day of readings an average a day would be a guess from a few hours. */
export const MIN_READING_DAYS_FOR_AVERAGE = 1;

export const siteDailyFigures = (input: {
  intervals: readonly EnergyIqAnalysisInterval[];
  timezone: string;
  period: { from: string; to: string };
}): SiteDailyFigures => {
  const dates = datesBetween(input.period.from, input.period.to);
  const index = new Map(dates.map((date, position) => [date, position]));
  const kwh = dates.map(() => 0);
  const minutes = dates.map(() => 0);
  const dayOf = localDateFormatter(input.timezone);
  for (const interval of input.intervals) {
    const start = Date.parse(interval.start);
    const length = (Date.parse(interval.end_exclusive) - start) / 60_000;
    const position = index.get(dayOf(start));
    if (position === undefined || !(length > 0)) continue;
    kwh[position]! += interval.usage_kwh;
    minutes[position]! += length;
  }
  const read = minutes.map((value) => Math.min(1, value / DAY_MINUTES));
  const readingDays = read.reduce((sum, value) => sum + value, 0);
  const totalKwh = kwh.reduce((sum, value) => sum + value, 0);
  return {
    averageDailyKwh: readingDays >= MIN_READING_DAYS_FOR_AVERAGE ? round(totalKwh / readingDays, 2) : 0,
    readingDays: round(readingDays, 1),
    dailyKwh: kwh.map((value, position) => (minutes[position]! > 0 ? round(value, 2) : null)),
  };
};

/**
 * A site's average full day, worked out exactly as the Overview and the reports work out "Uses about … a day".
 *
 * A day is complete when every official meter read every minute of it on time and nothing was read late or wrongly
 * (scopeDays); a meter whose silence is expected (marked not in use, or idle) never makes a day incomplete
 * (withMetersInUse). The average is averageFullDay over those days: every complete day alike for lights-on hours, a
 * week of five weekdays and two weekend days otherwise, public holidays counting with the weekend.
 */
export type SiteFullDays = {
  /** kWh on an average full day; null with no complete day in the period. */
  averageDailyKwh: number | null;
  /** Complete days in the period. */
  fullDays: number;
  /**
   * Official meters (other than those already expected to be silent) short of a whole day of readings on the last date
   * that has any. Only these could be idle through the end of the period, so the idle check is needed only when there
   * are some.
   */
  shortOnLastDay: string[];
};

const DAY_START_HOUR = 0;

export const siteFullDays = (input: {
  period: { from: string; to: string };
  timezone: string;
  /** The official meters, with their meter type; each is expected for every minute of every day. */
  meters: ReadonlyArray<{ id: string; category?: string | undefined }>;
  /** The official meters' days, as readEnergyOverviewHeadline gives them. */
  facts: EnergyDailyMeterFacts;
  holidays?: ReadonlyMap<string, string>;
  meaning?: HoursMeaning;
  /** Meters whose silence is expected: marked not in use, or idle through the end of the period. */
  silentMeterIds?: ReadonlySet<string>;
}): SiteFullDays => {
  const dates = datesBetween(input.period.from, input.period.to);
  const dateSet = new Set(dates);
  const official = new Map(input.meters.map((meter) => [meter.id, meter.category ?? ""]));
  const silent = new Set([...(input.silentMeterIds ?? [])].filter((id) => official.has(id)));
  const days = input.facts.days.filter((day) => dateSet.has(day.localDate));
  // The meter-days that were not a whole clean day, by meter and date, gathered once. Any other meter-day on a date with
  // readings was a whole day read on time with nothing wrong.
  const exceptions = new Map<string, Map<string, { validMinutes: number; qualityEventCount: number }>>();
  for (const exception of input.facts.meterExceptions) {
    if (!official.has(exception.meterPointId) || !dateSet.has(exception.localDate)) continue;
    const byDate = exceptions.get(exception.meterPointId) ?? new Map<string, { validMinutes: number; qualityEventCount: number }>();
    byDate.set(exception.localDate, exception);
    exceptions.set(exception.meterPointId, byDate);
  }
  // One cell per day holding the day's sums, in the hourly cells' shape ([date, hour, kWh read on time, minutes read on
  // time, intervals not read on time, kWh sent late]). scopeDays and withMetersInUse only ever add a day's cells
  // together, so a day in one cell is judged exactly as its 24 hourly cells are on the Analysis page.
  const total: TrendSeries | null = official.size ? {
    id: "__scope__",
    expectedMinutesPerHour: official.size * 60,
    cells: days.map((day): TrendCell => [day.localDate, DAY_START_HOUR, day.usageKwh, day.validMinutes, day.qualityEventCount, day.recoveredKwh]),
  } : null;
  // Only the meters whose silence is expected need a day of their own: withMetersInUse takes their minutes and problems
  // back out of the total, and expects one meter fewer. Their energy stays in the total.
  const ownDays = (id: string): TrendSeries => ({
    id,
    expectedMinutesPerHour: 60,
    cells: days.map((day): TrendCell => {
      const exception = exceptions.get(id)?.get(day.localDate);
      return [day.localDate, DAY_START_HOUR, null, exception ? exception.validMinutes : DAY_MINUTES, exception ? exception.qualityEventCount : 0, 0];
    }),
  });
  const scope: ScopeData = {
    id: "site", name: "site", dates, timezone: input.timezone, total, types: {},
    meters: [...silent].map((id) => ({ id, name: id, location: "", category: categoryOf(official.get(id) ?? ""), official: true, series: ownDays(id) })),
    usageKwh: null, peakKw: null, peakAt: null, cost: null, typeTotals: {}, coverage: null,
  };
  const judged = scopeDays(withMetersInUse(scope, silent), new Map(input.holidays ?? []));
  const average = averageFullDay(judged, input.meaning ?? "opening");
  const lastDate = days.filter((day) => day.validMinutes > 0).at(-1)?.localDate;
  return {
    averageDailyKwh: average === null ? null : round(average, 2),
    fullDays: judged.filter((day) => day.complete).length,
    shortOnLastDay: lastDate
      ? [...official.keys()].filter((id) => !silent.has(id) && (exceptions.get(id)?.get(lastDate)?.validMinutes ?? DAY_MINUTES) < DAY_MINUTES).sort()
      : [],
  };
};

const localDateFormatter = (timezone: string) => {
  const format = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  return (at: number) => format.format(new Date(at));
};

const datesBetween = (from: string, to: string): string[] => {
  const dates: string[] = [];
  for (let day = Date.parse(`${from}T00:00:00Z`); day <= Date.parse(`${to}T00:00:00Z`); day += 86_400_000) dates.push(new Date(day).toISOString().slice(0, 10));
  return dates;
};

const round = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};
