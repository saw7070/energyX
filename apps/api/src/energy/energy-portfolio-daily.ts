import type { EnergyIqAnalysisInterval } from "@datafoundry/metadata";

/**
 * How much a site uses on an average day, and each day's use for the Portfolio's small trend chart.
 *
 * The average counts only time the site actually sent readings: the kWh it read divided by how many days of readings
 * that is. A site connected part-way through the period is therefore counted from its first reading (as data
 * availability does), and a day lost to an outage does not drag the average down. Time between two readings whose
 * running total did not move is a real reading of 0 kWh (a lighting circuit by day), so it counts as read time.
 * Energy a meter counted while offline (an estimate) has no read time and is left out of both sides.
 */
export type SiteDailyFigures = {
  /** kWh per day of readings; 0 when there is less than one day of readings to go on. */
  averageDailyKwh: number;
  /** Days of readings the average is over, to one decimal (a day with half its readings counts as half). */
  readingDays: number;
  /** One value per local date from the period's first to its last day; null on a day with no readings. */
  dailyKwh: Array<number | null>;
};

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
