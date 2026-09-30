import type { EnergyOperatingCalendarRevisionDto, EnergyTariffScheduleRevisionDto } from "../../../lib/config-api";
import { dayContext, type DayKind as CalendarDayKind } from "./day-context";
import { operatingMinutes } from "./device-statistics";

export type HistoryDay = { date: string; kwh: number | null; complete: boolean };
export type DayKind = "open" | "closed";
export type Typical = { kind: DayKind; days: number; average: number; low: number; high: number };
/** "complete" uses only days with every reading; "partial" had too few, so days with gaps were used as well. */
export type ForecastBasis = "complete" | "partial";
/** One expected day of next month, so the shape of the month can be drawn and each day explained. */
export type ForecastDay = { date: string; open: boolean; kind: CalendarDayKind; kwh: number; low: number; high: number; name?: string;
  /** Hours the site is open that day, when they differ from a normal working day (a half-day closure, say). */
  shortHours?: number };
export type Forecast = {
  month: { from: string; toExclusive: string };
  days: ForecastDay[];
  openDays: number;
  closedDays: number;
  /** Energy expected on working days and on closed days, so the month can be shown as the sum of the two. */
  openKwh: number;
  closedKwh: number;
  /** Hours a normal working day is open, which the shorter days are measured against. */
  normalOpenHours: number;
  named: Array<{ date: string; name: string }>;
  typical: Typical[];
  kwh: { low: number; mid: number; high: number };
  cost: { low: number; mid: number; high: number; currency: string; beforeTax: boolean; taxName?: string; taxPct?: number } | null;
  /** The first day of the month with no saved electricity rate, so costs stop there. */
  missingRateFrom: string | null;
  /** Days behind the estimate; below 10 the estimate is a rough guide. */
  sampleDays: number;
  basis: ForecastBasis;
  /** Days in the period that had no readings at all, so the reader knows what is missing. */
  daysWithoutReadings: number;
};

const DAY_MS = 86_400_000;
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
export const localDate = (iso: string, timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

/** The whole calendar month after the one `today` falls in. */
export function nextMonth(today: string): { from: string; toExclusive: string } {
  const [year, month] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  const from = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const [nextYear, nextMonthNumber] = [Number(from.slice(0, 4)), Number(from.slice(5, 7))];
  return { from, toExclusive: nextMonthNumber === 12 ? `${nextYear + 1}-01-01` : `${nextYear}-${String(nextMonthNumber + 1).padStart(2, "0")}-01` };
}

export const datesIn = (from: string, toExclusive: string) => { const dates: string[] = []; for (let date = from; date < toExclusive && dates.length < 400; date = addDays(date, 1)) dates.push(date); return dates; };

/** Fewer days than this cannot describe a normal day, so no estimate is offered. */
export const MIN_SAMPLE_DAYS = 3;

const quantile = (sorted: number[], share: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(share * (sorted.length - 1))))]! : 0;

/**
 * What a normal open day and closed day use. Complete days are preferred; when there are fewer than three, days with
 * gaps are used too, dropping the clearly partial ones (under half the median), and the basis says so.
 */
export function typicalDays(history: HistoryDay[], revision: EnergyOperatingCalendarRevisionDto | null, normalOpenHours?: number): { typical: Typical[]; basis: ForecastBasis } {
  const complete = history.filter(day => day.complete && day.kwh !== null);
  let basis: ForecastBasis = "complete";
  let usable = complete;
  if (complete.length < 3) {
    const measured = history.filter(day => day.kwh !== null && day.kwh > 0);
    const sorted = measured.map(day => day.kwh!).sort((a, b) => a - b);
    const median = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0;
    const salvaged = measured.filter(day => day.kwh! >= median * 0.5);
    if (salvaged.length > complete.length) { usable = salvaged; basis = "partial"; }
  }
  const groups = new Map<DayKind, number[]>([["open", []], ["closed", []]]);
  const shortened: number[] = [];
  for (const day of usable) {
    const open = dayContext(revision, day.date).open;
    // A day that opened for fewer hours than usual would drag the normal working day down, so it waits aside.
    if (open && normalOpenHours && openHoursOn(revision, day.date) < normalOpenHours - 0.01) { shortened.push(day.kwh!); continue; }
    groups.get(open ? "open" : "closed")!.push(day.kwh!);
  }
  if (groups.get("open")!.length < 3) groups.get("open")!.push(...shortened);
  const typical = [...groups].flatMap(([kind, values]) => {
    if (!values.length) return [];
    const sorted = [...values].sort((a, b) => a - b);
    return [{ kind, days: values.length, average: values.reduce((sum, value) => sum + value, 0) / values.length, low: quantile(sorted, 0.1), high: quantile(sorted, 0.9) }];
  });
  return { typical, basis };
}

/** Hours the site is open on a local date, from the same published calendar the analysis used. */
export const openHoursOn = (revision: EnergyOperatingCalendarRevisionDto | null, date: string) =>
  Array.from({ length: 24 }, (_, hour) => operatingMinutes(revision?.entries ?? [], date, hour)).reduce((sum, minutes) => sum + minutes, 0) / 60;

/** Price per kWh in force on a local date, from the published rate periods. */
export function rateOn(date: string, tariff: EnergyTariffScheduleRevisionDto | null, timeZone: string) {
  return tariff?.entries.find(entry => localDate(entry.effective_from, timeZone) <= date && (!entry.effective_to || date < localDate(entry.effective_to, timeZone))) ?? null;
}

/**
 * Next month's energy and cost: each day of the month counted as a normal open or closed day, using the published
 * operating hours, holidays and closures, priced with the saved electricity rate.
 */
export function forecastNextMonth({ history, revision, tariff, timeZone, today }: {
  history: HistoryDay[]; revision: EnergyOperatingCalendarRevisionDto | null; tariff: EnergyTariffScheduleRevisionDto | null; timeZone: string; today: string;
}): Forecast | null {
  const month = nextMonth(today);
  const dates = datesIn(month.from, month.toExclusive);
  // A normal working day is the opening length most of the month's ordinary working days share; a day open for less
  // than that (a half-day closure, say) keeps the equipment that stays on and only part of the working-hours energy.
  const plainOpen = dates.map(date => dayContext(revision, date)).filter(context => context.open && context.kind !== "special_operating_day");
  const counts = new Map<number, number>();
  for (const context of plainOpen) { const hours = openHoursOn(revision, context.date); counts.set(hours, (counts.get(hours) ?? 0) + 1); }
  const normalOpenHours = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 0;
  const { typical, basis } = typicalDays(history, revision, normalOpenHours);
  const byKind = new Map(typical.map(item => [item.kind, item]));
  // A month needs a normal day of each kind it contains, from at least MIN_SAMPLE_DAYS days of readings.
  const kindsNeeded = new Set(dates.map(date => dayContext(revision, date).open ? "open" : "closed"));
  const measured = typical.reduce((sum, item) => sum + item.days, 0);
  if (measured < MIN_SAMPLE_DAYS || [...kindsNeeded].some(kind => !byKind.has(kind as DayKind))) return null;
  const totals = { low: 0, mid: 0, high: 0 };
  const cost = { low: 0, mid: 0, high: 0 };
  const named: Array<{ date: string; name: string }> = [];
  const expected: ForecastDay[] = [];
  let openDays = 0, closedDays = 0, missingRateFrom: string | null = null;
  let currency = "", beforeTax = false, taxName: string | undefined, taxPct: number | undefined;
  const closedShape = byKind.get("closed");
  for (const date of dates) {
    const context = dayContext(revision, date);
    const shape = byKind.get(context.open ? "open" : "closed")!;
    if (context.open) openDays += 1; else closedDays += 1;
    if (context.name) named.push({ date, name: context.name });
    // Shorter opening: the closed-day energy stays, the working-hours part shrinks with the hours actually open.
    const hours = context.open ? openHoursOn(revision, date) : normalOpenHours;
    const short = context.open && closedShape && normalOpenHours > 0 && hours > 0 && hours < normalOpenHours - 0.01;
    const part = short ? hours / normalOpenHours : 1;
    const scale = (value: number, base: number) => short ? base + (value - base) * part : value;
    const day = { kwh: scale(shape.average, closedShape?.average ?? 0), low: scale(shape.low, closedShape?.low ?? 0), high: scale(shape.high, closedShape?.high ?? 0) };
    expected.push({ date, open: context.open, kind: context.kind, ...day, ...(context.name ? { name: context.name } : {}), ...(short ? { shortHours: hours } : {}) });
    totals.low += day.low; totals.mid += day.kwh; totals.high += day.high;
    const entry = rateOn(date, tariff, timeZone);
    if (!entry) { missingRateFrom ??= date; continue; }
    currency = entry.currency; beforeTax = entry.rate_basis === "tax_exclusive";
    if (entry.tax) { taxName = entry.tax.name; taxPct = entry.tax.rate_pct; }
    cost.low += day.low * entry.rate_per_kwh; cost.mid += day.kwh * entry.rate_per_kwh; cost.high += day.high * entry.rate_per_kwh;
  }
  return {
    month, days: expected, openDays, closedDays, named, typical,
    openKwh: expected.filter(day => day.open).reduce((sum, day) => sum + day.kwh, 0),
    closedKwh: expected.filter(day => !day.open).reduce((sum, day) => sum + day.kwh, 0),
    normalOpenHours,
    kwh: totals,
    cost: currency ? { ...cost, currency, beforeTax, ...(taxName ? { taxName } : {}), ...(taxPct === undefined ? {} : { taxPct }) } : null,
    missingRateFrom,
    sampleDays: typical.reduce((sum, item) => sum + item.days, 0),
    basis,
    daysWithoutReadings: history.filter(day => day.kwh === null || day.kwh === 0).length,
  };
}
