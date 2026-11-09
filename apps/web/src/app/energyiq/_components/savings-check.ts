/**
 * Proof of savings: what a site (or some of its devices) used after a change, against what it would have used without
 * it. The expectation comes from the days before the change, kept apart by kind of day (open days and closed days use
 * different amounts), so a holiday-heavy week after the change is not mistaken for a saving.
 *
 * Only complete days count on either side (at least 90% of readings, as everywhere else in the app). The change day
 * itself is left out: part of it is before and part after. Weather is not adjusted for; for lighting it does not
 * matter, and for air-conditioning a longer comparison evens it out.
 */

export type SavingsDay = { date: string; kwh: number | null; open: boolean; complete: boolean };

/** Days before the change to learn the usual pattern from, and the fewest that give a fair picture. */
export const SAVINGS_BASELINE_DAYS = 28;
export const SAVINGS_MIN_BASELINE_DAYS = 7;
/** Complete days after the change before a first result is shown. */
export const SAVINGS_MIN_AFTER_DAYS = 3;
/** How long after the change the comparison runs; later days are a different question. */
export const SAVINGS_MAX_AFTER_DAYS = 90;

export type SavingsResult =
  | { status: "need-baseline"; baselineDays: number }
  | { status: "too-early"; baselineDays: number; afterDays: number }
  | {
    status: "saving" | "increase" | "unclear";
    baselineDays: number;
    afterDays: number;
    expectedKwh: number;
    actualKwh: number;
    savedKwh: number;
    savedPct: number;
    /** Saving per day after the change, carried over a year. */
    savedKwhPerYear: number;
    /** The largest difference that normal day-to-day ups and downs could explain over this many days. */
    noiseKwh: number;
  };

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

export function savingsResult(days: ReadonlyArray<SavingsDay>, changeDate: string): SavingsResult {
  const usable = days.filter((day): day is SavingsDay & { kwh: number } => day.complete && day.kwh !== null);
  const baseline = usable.filter(day => day.date < changeDate).slice(-SAVINGS_BASELINE_DAYS);
  const after = usable.filter(day => day.date > changeDate).slice(0, SAVINGS_MAX_AFTER_DAYS);
  if (baseline.length < SAVINGS_MIN_BASELINE_DAYS) return { status: "need-baseline", baselineDays: baseline.length };
  if (after.length < SAVINGS_MIN_AFTER_DAYS) return { status: "too-early", baselineDays: baseline.length, afterDays: after.length };
  const all = mean(baseline.map(day => day.kwh));
  const open = baseline.filter(day => day.open).map(day => day.kwh);
  const closed = baseline.filter(day => !day.open).map(day => day.kwh);
  // A kind of day the baseline never saw falls back to the overall average.
  const usual = (isOpen: boolean) => (isOpen ? (open.length ? mean(open) : all) : (closed.length ? mean(closed) : all));
  const expectedKwh = after.reduce((sum, day) => sum + usual(day.open), 0);
  const actualKwh = after.reduce((sum, day) => sum + day.kwh, 0);
  const savedKwh = expectedKwh - actualKwh;
  // Day-to-day spread around the usual level before the change; over n days it grows with the square root of n.
  const residuals = baseline.map(day => day.kwh - usual(day.open));
  const spread = Math.sqrt(residuals.reduce((sum, value) => sum + value * value, 0) / Math.max(1, residuals.length - 1));
  const noiseKwh = 2 * spread * Math.sqrt(after.length);
  const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;
  return {
    status: Math.abs(savedKwh) <= noiseKwh ? "unclear" : savedKwh > 0 ? "saving" : "increase",
    baselineDays: baseline.length,
    afterDays: after.length,
    expectedKwh: round(expectedKwh),
    actualKwh: round(actualKwh),
    savedKwh: round(savedKwh),
    savedPct: expectedKwh > 0 ? round(savedKwh / expectedKwh * 100) : 0,
    savedKwhPerYear: round(savedKwh / after.length * 365, 0),
    noiseKwh: round(noiseKwh),
  };
}

/** Adds devices' days together: a day is complete only when every chosen device's day is. */
export function combineDays(series: ReadonlyArray<ReadonlyArray<SavingsDay>>): SavingsDay[] {
  const byDate = new Map<string, { kwh: number; open: boolean; complete: boolean; count: number }>();
  for (const days of series) {
    for (const day of days) {
      const entry = byDate.get(day.date) ?? { kwh: 0, open: day.open, complete: true, count: 0 };
      entry.kwh += day.kwh ?? 0;
      entry.complete = entry.complete && day.complete && day.kwh !== null;
      entry.count += 1;
      byDate.set(day.date, entry);
    }
  }
  return [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, entry]) => ({ date, kwh: entry.kwh, open: entry.open, complete: entry.complete && entry.count === series.length }));
}
