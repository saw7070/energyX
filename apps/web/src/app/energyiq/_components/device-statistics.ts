import type { EnergyOperatingCalendarEntryDto, EnergyOperatingDayDto } from "../../../lib/config-api";
import { translatorFor, type EnergyIqLocale } from "./energyiq-messages";
import { dayMessages } from "./site-devices-messages";

/** One local hour of one meter from the analysis `explorerTrends`: [localDate, hour, kWh, validMinutes, qualityEvents]. */
export type HourCell = [string, number, number | null, number, number];

export type DeviceStatistics = {
  daily: Array<{ date: string; kwh: number | null; open: boolean; complete: boolean }>;
  /** Average kW for each hour of the day, from fully received hours only. */
  profileKw: Array<number | null>;
  /** The same hourly averages, split by whether the site was open that day. */
  openProfileKw: Array<number | null>;
  closedProfileKw: Array<number | null>;
  openDays: number;
  closedDays: number;
  outOfHoursKwh: number | null;
  outOfHoursPct: number | null;
  /** The draw exceeded in 9 of every 10 fully received hours. */
  alwaysOnKw: number | null;
  dailyAverageKwh: number | null;
  openDayAverageKwh: number | null;
  closedDayAverageKwh: number | null;
  receivedPct: number;
};

const DAYS: EnergyOperatingDayDto[] = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as EnergyOperatingDayDto[];
const minuteOfDay = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const COMPLETE_DAY_MINUTES = 0.9 * 1440;
const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

/** Opening minutes inside one local hour, from the project-wide calendar entry in force on that date. */
export function operatingMinutes(entries: EnergyOperatingCalendarEntryDto[], date: string, hour: number): number {
  const entry = entries.find(item => item.owner.kind === "project" && item.effective_from.slice(0, 10) <= date && (!item.effective_to || date < item.effective_to.slice(0, 10)));
  if (!entry) return 0;
  const exception = entry.exceptions?.find(item => item.date === date);
  const ranges = exception ? exception.operating : entry.weekly[DAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]!] ?? [];
  const start = hour * 60, end = start + 60;
  return ranges.reduce((sum, range) => sum + Math.max(0, Math.min(end, minuteOfDay(range.to)) - Math.max(start, minuteOfDay(range.from))), 0);
}

export function isOpenDay(entries: EnergyOperatingCalendarEntryDto[], date: string): boolean {
  return Array.from({ length: 24 }, (_, hour) => operatingMinutes(entries, date, hour)).some(minutes => minutes > 0);
}

/** Local calendar dates covered by an end-exclusive UTC window. */
export function periodDates(fromIso: string, toExclusiveIso: string, timeZone: string): string[] {
  const format = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const first = format.format(new Date(fromIso)), last = format.format(new Date(Date.parse(toExclusiveIso) - 1));
  const dates: string[] = [];
  for (let day = Date.parse(`${first}T00:00:00Z`); dates.length < 400; day += 86_400_000) {
    const date = new Date(day).toISOString().slice(0, 10);
    dates.push(date);
    if (date >= last) break;
  }
  return dates;
}

function percentile(values: number[], share: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))]!;
}

/**
 * Figures from hourly readings. Out-of-hours uses the same published calendar as the site total.
 * `expectedMinutesPerHour` is 60 for one meter and 60 × meters for a whole-site series.
 */
export function deviceStatistics(cells: HourCell[], dates: string[], calendar: EnergyOperatingCalendarEntryDto[] | null, expectedMinutesPerHour = 60): DeviceStatistics {
  const days = new Map<string, { kwh: number; minutes: number }>();
  const openDates = new Set(dates.filter(date => !calendar || isOpenDay(calendar, date)));
  const hours = Array.from({ length: 24 }, () => ({ all: [] as number[], open: [] as number[], closed: [] as number[] }));
  const fullHours: number[] = [];
  let total = 0, outOfHours = 0, receivedMinutes = 0;
  for (const [date, hour, kwh, validMinutes] of cells) {
    if (kwh === null) continue;
    const day = days.get(date) ?? { kwh: 0, minutes: 0 };
    day.kwh += kwh; day.minutes += validMinutes; days.set(date, day);
    total += kwh; receivedMinutes += validMinutes;
    if (validMinutes >= expectedMinutesPerHour) {
      const slot = hours[hour]!;
      slot.all.push(kwh); (openDates.has(date) ? slot.open : slot.closed).push(kwh); fullHours.push(kwh);
    }
    if (calendar) outOfHours += kwh * (1 - operatingMinutes(calendar, date, hour) / 60);
  }
  const daily = dates.map(date => ({ date, kwh: days.get(date)?.kwh ?? null, open: openDates.has(date), complete: (days.get(date)?.minutes ?? 0) >= COMPLETE_DAY_MINUTES * expectedMinutesPerHour / 60 }));
  const complete = daily.filter(day => day.complete);
  return {
    daily,
    profileKw: hours.map(slot => average(slot.all)),
    openProfileKw: hours.map(slot => average(slot.open)),
    closedProfileKw: hours.map(slot => average(slot.closed)),
    openDays: complete.filter(day => day.open).length,
    closedDays: complete.filter(day => !day.open).length,
    outOfHoursKwh: calendar && total > 0 ? outOfHours : null,
    outOfHoursPct: calendar && total > 0 ? outOfHours / total * 100 : null,
    alwaysOnKw: percentile(fullHours, 0.1),
    dailyAverageKwh: average(complete.map(day => day.kwh!)),
    openDayAverageKwh: average(complete.filter(day => day.open).map(day => day.kwh!)),
    closedDayAverageKwh: average(complete.filter(day => !day.open).map(day => day.kwh!)),
    receivedPct: dates.length ? receivedMinutes / (dates.length * 24 * expectedMinutesPerHour) * 100 : 0,
  };
}

/** Plain summary of weekly operating hours, e.g. "Mon–Fri 09:00–18:00" (Chinese: "周一至周五 09:00–18:00"). */
export function openingHoursLabel(entries: EnergyOperatingCalendarEntryDto[] | null, locale: EnergyIqLocale = "en"): string | null {
  const entry = entries?.find(item => item.owner.kind === "project");
  if (!entry) return null;
  const t = translatorFor(dayMessages, locale);
  const order = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const satisfies readonly EnergyOperatingDayDto[];
  const short = (day: (typeof order)[number]) => t(`weekday.${day}`);
  const groups: Array<{ days: Array<(typeof order)[number]>; hours: string }> = [];
  for (const day of order) {
    const ranges = entry.weekly[day] ?? [];
    if (!ranges.length) continue;
    // Compared in one fixed form so grouping never depends on the reader's language.
    const hours = ranges.map(range => `${range.from}–${range.to}`).join(", ");
    const last = groups[groups.length - 1];
    if (last && last.hours === hours && order.indexOf(last.days[last.days.length - 1]!) === order.indexOf(day) - 1) last.days.push(day);
    else groups.push({ days: [day], hours });
  }
  const label = (group: (typeof groups)[number]) => t("hours.group", {
    days: group.days.length > 1 ? t("hours.dayRange", { from: short(group.days[0]!), to: short(group.days[group.days.length - 1]!) }) : short(group.days[0]!),
    hours: group.hours.split(", ").join(t("hours.rangeSeparator")),
  });
  return groups.length ? groups.map(label).join(t("hours.groupSeparator")) : t("hours.closedEveryDay");
}

/** Average kW in each hour of each day; null where no readings arrived. Partly received hours are scaled to a full hour. */
export function hourlyByDay(cells: HourCell[], dates: string[], expectedMinutesPerHour = 60): Map<string, Array<number | null>> {
  const byDay = new Map(dates.map(date => [date, Array.from({ length: 24 }, (): number | null => null)]));
  for (const [date, hour, kwh, validMinutes] of cells) {
    const day = byDay.get(date);
    if (!day || kwh === null || validMinutes <= 0) continue;
    day[hour] = kwh * expectedMinutesPerHour / validMinutes;
  }
  return byDay;
}
