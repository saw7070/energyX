/**
 * The setting changes the report feedback AI may suggest: what each one carries, how it is checked, and the plain
 * sentence an administrator reads before applying it.
 *
 * The sentence is written here from the payload, never taken from the model, so what the administrator reads is
 * exactly what Apply does. Meter names, the names of report points and the rate's currency are taken from the site,
 * not from the model or the page, for the same reason.
 *
 * An hours change keeps only the days it changes, with those days' hours as they were when it was suggested and the
 * calendar entry they belong to; Apply changes only those days, and only while they still read as they did.
 */
import { z } from "zod";
import { energyReviewCheckTitle, ENERGY_REVIEW_CHECK_KEY } from "@datafoundry/site-report";
import type { SuggestionKind } from "./report-feedback-store.js";
import { WEEK_DAYS, type FeedbackSite, type TimeRange, type WeekDay, type WeeklyHours } from "./report-feedback-site.js";

const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const END_TIME = /^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/;
const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** A stretch of hours; an end before the start runs past midnight. An empty stretch is never valid. */
const range = z.object({ from: z.string().regex(TIME), to: z.string().regex(END_TIME) }).strict()
  .refine(value => value.from !== value.to, "Empty range");
const dayRanges = z.array(range).max(4).superRefine((ranges, context) => {
  // Same-day stretches may not overlap; a stretch past midnight must be the day's last.
  const sorted = [...ranges].sort((a, b) => minutes(a.from) - minutes(b.from));
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1]!;
    const end = previous.to === "24:00" || previous.to === "00:00" ? 1440 : minutes(previous.to);
    if (end <= minutes(previous.from) || minutes(sorted[index]!.from) < end) context.addIssue({ code: "custom", message: "Overlapping ranges" });
  }
});
const dateText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "Invalid date");
const meterId = z.string().trim().min(1).max(200);
const meterName = z.string().trim().max(200).optional();
const checkKey = z.string().trim().min(1).max(300);
const someDays = z.object(Object.fromEntries(WEEK_DAYS.map(day => [day, dayRanges.optional()])) as Record<WeekDay, z.ZodOptional<typeof dayRanges>>).strict();
const rate = z.number().positive().max(100);

/** What a stored suggestion carries; checked again before it is applied. */
export const PAYLOAD_SCHEMAS = {
  operating_hours: z.object({
    weekly: someDays.refine(days => Object.keys(days).length > 0, "No days"),
    base: z.object({ entryId: z.string().trim().min(1).max(300), weekly: someDays }).strict(),
  }).strict().refine(value => Object.keys(value.weekly).every(day => day in value.base.weekly), "Missing base"),
  meter_not_in_use: z.object({ meterId, meterName, reason: z.string().trim().min(1).max(160) }).strict(),
  meter_in_use: z.object({ meterId, meterName }).strict(),
  meter_always_on: z.object({ meterId, meterName, alwaysOn: z.boolean() }).strict(),
  light_count: z.object({ meterId, meterName, count: z.number().int().min(1).max(9999) }).strict(),
  holiday: z.object({
    date: dateText, label: z.string().trim().min(1).max(80), closed: z.literal(true),
    classification: z.enum(["public_holiday", "special_closure"]).optional(),
  }).strict(),
  electricity_rate: z.object({ ratePerKwh: rate, effectiveFrom: dateText, currency: z.string().trim().min(1).max(10) }).strict(),
  dismiss_check: z.object({ checkKey, title: z.string().trim().min(1).max(300), reason: z.string().trim().min(1).max(300), meterName }).strict(),
} as const;

/**
 * What the model may write, where it differs from what is stored: hours as days and times only (the base is the
 * site's own), a rate without a currency (it keeps the site's), a report point by its key (its title is the report's).
 */
const MODEL_SCHEMAS: Partial<Record<SuggestionKind, z.ZodTypeAny>> = {
  operating_hours: z.object({ weekly: someDays }).strict(),
  electricity_rate: z.object({ ratePerKwh: rate, effectiveFrom: dateText, currency: z.unknown().optional() }).strict(),
  dismiss_check: z.object({ checkKey, title: z.unknown().optional(), reason: z.string().trim().min(1).max(300) }).strict(),
};

export type HoursBase = { entryId: string; weekly: Partial<WeeklyHours> };
export type SuggestionPayloads = {
  /** `weekly`: only the days that change. `base`: those days' hours when it was suggested, and their calendar entry. */
  operating_hours: { weekly: Partial<WeeklyHours>; base: HoursBase };
  meter_not_in_use: { meterId: string; meterName: string; reason: string };
  meter_in_use: { meterId: string; meterName: string };
  meter_always_on: { meterId: string; meterName: string; alwaysOn: boolean };
  light_count: { meterId: string; meterName: string; count: number };
  holiday: { date: string; label: string; closed: true; classification: "public_holiday" | "special_closure" };
  electricity_rate: { ratePerKwh: number; effectiveFrom: string; currency: string };
  /** `title` and `meterName` are the report's own, from the key and the site. */
  dismiss_check: { checkKey: string; title: string; reason: string; meterName?: string };
};
export type NormalizedSuggestion = { [K in SuggestionKind]: { kind: K; label: string; payload: SuggestionPayloads[K] } }[SuggestionKind];

export type SuggestionContext = { site: FeedbackSite };

/**
 * Checks one suggestion and puts it in the form Apply uses: the meter's real name, the changed days with the hours
 * they replace, and a plain sentence. Anything not valid for this site, or that would change nothing, gives null.
 */
export function normalizeSuggestion(kind: unknown, rawPayload: unknown, context: SuggestionContext): NormalizedSuggestion | null {
  if (typeof kind !== "string" || !(kind in PAYLOAD_SCHEMAS)) return null;
  const schema = MODEL_SCHEMAS[kind as SuggestionKind] ?? PAYLOAD_SCHEMAS[kind as SuggestionKind];
  const parsed = schema.safeParse(kind === "operating_hours" ? withShortDayNames(rawPayload) : rawPayload);
  if (!parsed.success) return null;
  const { site } = context;
  const meterOf = (id: string) => site.meters.find(meter => meter.id === id);
  switch (kind as SuggestionKind) {
    case "operating_hours": {
      const value = parsed.data as { weekly: Partial<WeeklyHours> };
      const hours = site.hours;
      // Hours are changed in the project's own calendar entry; with none there is nothing to apply them to.
      if (!hours) return null;
      const changed = WEEK_DAYS.filter(day => value.weekly[day] && !sameRanges(value.weekly[day]!, hours.weekly[day]));
      if (!changed.length) return null;
      const payload: SuggestionPayloads["operating_hours"] = {
        weekly: Object.fromEntries(changed.map(day => [day, sortRanges(value.weekly[day]!)])),
        base: { entryId: hours.entryId, weekly: Object.fromEntries(changed.map(day => [day, sortRanges(hours.weekly[day])])) },
      };
      return { kind: "operating_hours", payload, label: hoursLabel({ ...hours.weekly, ...payload.weekly }, hours.weekly, hours.meaning) };
    }
    case "meter_not_in_use": {
      const value = parsed.data as z.infer<typeof PAYLOAD_SCHEMAS.meter_not_in_use>;
      const meter = meterOf(value.meterId);
      if (!meter) return null;
      const payload = { meterId: meter.id, meterName: meter.name, reason: oneLine(value.reason).slice(0, 160) };
      return { kind: "meter_not_in_use", payload, label: `Mark ${meter.name} as not in use (${payload.reason})` };
    }
    case "meter_in_use": {
      const value = parsed.data as z.infer<typeof PAYLOAD_SCHEMAS.meter_in_use>;
      const meter = meterOf(value.meterId);
      if (!meter || !meter.notInUse) return null;
      return { kind: "meter_in_use", payload: { meterId: meter.id, meterName: meter.name }, label: `Mark ${meter.name} as in use again` };
    }
    case "meter_always_on": {
      const value = parsed.data as z.infer<typeof PAYLOAD_SCHEMAS.meter_always_on>;
      const meter = meterOf(value.meterId);
      if (!meter || !!meter.alwaysOn === value.alwaysOn) return null;
      return {
        kind: "meter_always_on", payload: { meterId: meter.id, meterName: meter.name, alwaysOn: value.alwaysOn },
        label: value.alwaysOn ? `Mark ${meter.name} as always on by design` : `Mark ${meter.name} as not always on`,
      };
    }
    case "light_count": {
      const value = parsed.data as z.infer<typeof PAYLOAD_SCHEMAS.light_count>;
      const meter = meterOf(value.meterId);
      if (!meter || meter.lightCount === value.count) return null;
      return { kind: "light_count", payload: { meterId: meter.id, meterName: meter.name, count: value.count }, label: `Set ${meter.name} to ${value.count} ${value.count === 1 ? "light" : "lights"}` };
    }
    case "holiday": {
      const value = parsed.data as z.infer<typeof PAYLOAD_SCHEMAS.holiday>;
      const classification = value.classification ?? "public_holiday";
      // Already a day off: nothing to change.
      if (site.upcomingClosures.some(item => item.date === value.date)) return null;
      const payload = { date: value.date, label: oneLine(value.label).slice(0, 80), closed: true as const, classification };
      return { kind: "holiday", payload, label: `Add ${longDate(value.date)} as ${classification === "special_closure" ? "a planned closure" : "a public holiday"}: ${payload.label}` };
    }
    case "electricity_rate": {
      const value = parsed.data as { ratePerKwh: number; effectiveFrom: string };
      const current = site.electricityRate;
      // The new rate keeps the current entry's currency and tax, so there must be one; peak pricing is changed in Facility.
      if (!current || current.peakPricing) return null;
      const ratePerKwh = Math.round(value.ratePerKwh * 10_000) / 10_000;
      if (ratePerKwh <= 0 || (ratePerKwh === current.ratePerKwh && value.effectiveFrom >= current.from)) return null;
      const payload = { ratePerKwh, effectiveFrom: value.effectiveFrom, currency: current.currency };
      return { kind: "electricity_rate", payload, label: rateLabel(payload) };
    }
    case "dismiss_check": {
      const value = parsed.data as { checkKey: string; reason: string };
      const subject = checkSubject(value.checkKey, site);
      if (!subject) return null;
      const payload = { checkKey: value.checkKey, title: subject.title, reason: oneLine(value.reason).slice(0, 300), ...(subject.meterName ? { meterName: subject.meterName } : {}) };
      return { kind: "dismiss_check", payload, label: dismissLabel(payload.title) };
    }
  }
}

export const rateLabel = (payload: { ratePerKwh: number; effectiveFrom: string; currency: string }) =>
  `Change the electricity rate to ${payload.currency} ${payload.ratePerKwh} per kWh from ${longDate(payload.effectiveFrom)}`;
export const dismissLabel = (title: string) => `Stop flagging “${title}” in reports`;

/**
 * The report point a key names, worded as the report words it, with the meter's name from the site. Only the
 * report's own keys, and for a meter point only a meter of this site; anything else gives null.
 */
export function checkSubject(key: string, site: Pick<FeedbackSite, "meters">): { title: string; meterName?: string } | null {
  const match = ENERGY_REVIEW_CHECK_KEY.exec(key);
  if (!match) return null;
  const meter = match[1] ? site.meters.find(item => item.id === match[2]) : undefined;
  if (match[1] && !meter) return null;
  const title = energyReviewCheckTitle(key, meter?.name, "en");
  return title ? { title: title.slice(0, 300), ...(meter ? { meterName: meter.name } : {}) } : null;
}

const FULL_DAY_NAMES: Record<string, WeekDay> = { monday: "mon", tuesday: "tue", wednesday: "wed", thursday: "thu", friday: "fri", saturday: "sat", sunday: "sun" };
/** "monday" as "mon": the model sometimes writes days in full, as the calendar itself does. */
function withShortDayNames(payload: unknown): unknown {
  const weekly = (payload as { weekly?: unknown } | null)?.weekly;
  if (!weekly || typeof weekly !== "object" || Array.isArray(weekly)) return payload;
  return { ...(payload as object), weekly: Object.fromEntries(Object.entries(weekly).map(([day, ranges]) => [FULL_DAY_NAMES[day.toLowerCase()] ?? day.toLowerCase(), ranges])) };
}

export const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

export const sortRanges = (ranges: TimeRange[]): TimeRange[] => [...ranges].map(item => ({ from: item.from, to: item.to })).sort((a, b) => minutes(a.from) - minutes(b.from));
export const sameRanges = (left: TimeRange[], right: TimeRange[]) =>
  left.length === right.length && sortRanges(left).every((item, index) => {
    const other = sortRanges(right)[index]!;
    return item.from === other.from && normalEnd(item.to) === normalEnd(other.to);
  });
const normalEnd = (time: string) => (time === "00:00" ? "24:00" : time);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-12-25" as "25 Dec 2026". */
export const longDate = (date: string): string => `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;

/** "19:10" as "7:10 pm"; midnight as "midnight". */
export function clockTime(time: string): string {
  if (time === "24:00" || time === "00:00") return "midnight";
  const hour = Number(time.slice(0, 2));
  const minute = time.slice(3, 5);
  return `${hour % 12 === 0 ? 12 : hour % 12}:${minute} ${hour < 12 ? "am" : "pm"}`;
}

const DAY_NAMES: Record<WeekDay, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
const rangesText = (ranges: TimeRange[]) => ranges.length ? ranges.map(item => `${clockTime(item.from)} – ${clockTime(item.to)}`).join(", ") : "closed";

/** Which days, in the fewest words: "every day", "Mon–Fri", or "Mon, Wed, Sat–Sun". */
function daysText(days: WeekDay[]): string {
  if (days.length === 7) return "every day";
  const runs: Array<[WeekDay, WeekDay]> = [];
  for (const day of days) {
    const previous = runs.at(-1);
    if (previous && WEEK_DAYS.indexOf(day) === WEEK_DAYS.indexOf(previous[1]) + 1) previous[1] = day;
    else runs.push([day, day]);
  }
  return runs.map(([first, last]) => first === last ? DAY_NAMES[first] : `${DAY_NAMES[first]}–${DAY_NAMES[last]}`).join(", ");
}

/** Days with the same hours side by side, as "Mon–Fri" or "Sat"; all seven as "every day". */
function dayGroups(days: WeekDay[], weekly: WeeklyHours): Array<{ days: string; ranges: TimeRange[] }> {
  const groups: Array<{ first: WeekDay; last: WeekDay; ranges: TimeRange[] }> = [];
  for (const day of days) {
    const previous = groups.at(-1);
    const adjacent = previous && WEEK_DAYS.indexOf(day) === WEEK_DAYS.indexOf(previous.last) + 1;
    if (previous && adjacent && sameRanges(previous.ranges, weekly[day])) previous.last = day;
    else groups.push({ first: day, last: day, ranges: weekly[day] });
  }
  if (groups.length === 1 && days.length === 7) return [{ days: "every day", ranges: groups[0]!.ranges }];
  return groups.map(group => ({ days: group.first === group.last ? DAY_NAMES[group.first] : `${DAY_NAMES[group.first]}–${DAY_NAMES[group.last]}`, ranges: group.ranges }));
}

/**
 * The hours change in one sentence. When every changed day keeps its start and only the end moves (or the other way
 * round), it says just that: "Change lights-off to 7:10 am, every day".
 */
export function hoursLabel(weekly: WeeklyHours, current: WeeklyHours | null, meaning: "opening" | "lights_on"): string {
  const changed = WEEK_DAYS.filter(day => !current || !sameRanges(weekly[day], current[day]));
  const hoursWord = meaning === "lights_on" ? "lights-on hours" : "opening hours";
  if (current && changed.length) {
    const single = changed.every(day => weekly[day].length === 1 && current[day].length === 1);
    if (single) {
      const sameStart = changed.every(day => weekly[day][0]!.from === current[day][0]!.from);
      const sameEnd = changed.every(day => normalEnd(weekly[day][0]!.to) === normalEnd(current[day][0]!.to));
      const ends = new Set(changed.map(day => normalEnd(weekly[day][0]!.to)));
      const starts = new Set(changed.map(day => weekly[day][0]!.from));
      const whenText = daysText(changed);
      if (sameStart && ends.size === 1) {
        const word = meaning === "lights_on" ? "lights-off" : "closing time";
        return `Change ${word} to ${clockTime([...ends][0]!)}, ${whenText}`;
      }
      if (sameEnd && starts.size === 1) {
        const word = meaning === "lights_on" ? "lights-on" : "opening time";
        return `Change ${word} to ${clockTime([...starts][0]!)}, ${whenText}`;
      }
    }
  }
  const groups = dayGroups(changed.length ? changed : [...WEEK_DAYS], weekly);
  return `Change ${hoursWord} to ${groups.map(group => group.days === "every day" ? `${rangesText(group.ranges)}, every day` : `${group.days} ${rangesText(group.ranges)}`).join("; ")}`;
}
