/**
 * The rules behind three site alerts, worked out from each meter's hourly readings. Pure: no database, no clock.
 *
 * Hourly readings are the cells the Explorer and the site reports use (explorer-trends.ts): [local date, local hour,
 * kWh read on time, minutes read on time, intervals not read on time, kWh sent late]. Meters whose silence or zero use
 * is expected are left out the way the reports leave them out (meters-in-use.ts, energy-idle-meters.ts): a meter marked
 * not in use, one that is idle (online at the live check and able to rightly use nothing), and one that must never use
 * power (it is expected to send nothing).
 *
 * 1. Stopped sending (meter_offline). A meter in use that sent nothing for more than 12 hours past when it would next
 *    have reported as usual, up to the newest data the site has. Its usual reporting hours are learned from the
 *    readings: the clock hours it sent readings in on at least half of the days it was sending. A meter powered only
 *    while its lights are on (it reports only at night) is next expected at dusk, so its silent days are never a stop.
 *    Meters in the same area that went quiet within an hour of each other are one alert: most likely their gateway.
 * 2. Should never use power (never_used). Any hour above 0.01 kWh on a meter marked that way. Consecutive hours are one
 *    episode, with its start and its total.
 * 3. Unusual hourly use (usage_pattern). Each meter's usual use for each clock hour, from the last 21 complete days, kept
 *    apart by day type (open and closed days on an opening-hours site with a calendar, weekdays and weekends without one,
 *    every day alike on a lights-on site), with at least 7 samples an hour. Usual is the median; spread is the median
 *    absolute deviation (MAD, unscaled). An hour stands out when it differs from the median by more than
 *    max(50% of the median, 3 × MAD, 0.05 kWh). Two such hours in a row make an episode; one is enough when a meter
 *    that is always on by design drops to about nothing. Hours not read completely on time (offline, or sent late) are
 *    never judged: those belong to the first alert.
 */

export type HourCell = [string, number, number | null, number, number, number];

export type MeterAlertInputMeter = {
  id: string;
  name: string;
  /** The area the meter belongs to, as reports name it, and its id; meters in one area usually share a gateway. */
  location?: string;
  locationId?: string;
  notInUse?: boolean;
  alwaysOn?: boolean;
  neverUsed?: boolean;
  /** Online at the latest live check and able to rightly use nothing (readIdleWhenQuietMeters). */
  idleWhenQuiet?: boolean;
  /** The end of the meter's last reading received on time (ISO); absent when it never sent one. */
  lastReadingAt?: string;
};

export const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** A meter is stopped once it has been quiet this long past when it would next have reported as usual. */
export const OFFLINE_AFTER_MINUTES = 12 * 60;
/** Meters in one area that went quiet this close together are reported as one alert. */
export const OFFLINE_GROUP_WINDOW_MS = HOUR_MS;
/** An hour is a usual reporting hour when the meter sent readings in it on at least this share of its days. */
export const USUAL_HOUR_SHARE = 0.5;
/** Use above this in one hour, on a meter that must never use power, is an alert. */
export const NEVER_USED_KWH = 0.01;
export const BASELINE_DAYS = 21;
export const BASELINE_MIN_SAMPLES = 7;
export const PATTERN_SHARE = 0.5;
export const PATTERN_MAD_FACTOR = 3;
export const PATTERN_MIN_KWH = 0.05;
export const PATTERN_MIN_HOURS = 2;
/** "About nothing" for a meter always on by design: at most this, or 5% of its usual hour. */
export const NEAR_ZERO_KWH = 0.005;

const formatters = new Map<string, Intl.DateTimeFormat>();
const offsets = new Map<string, number>();
/** How far a time zone is ahead of UTC at an instant (cached per hour). */
export const zoneOffsetMs = (instant: number, timezone: string): number => {
  const key = `${timezone}|${Math.floor(instant / HOUR_MS)}`;
  const known = offsets.get(key);
  if (known !== undefined) return known;
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    formatters.set(timezone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
  const offset = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute), Number(parts.second)) - Math.floor(instant / 1000) * 1000;
  if (offsets.size > 50_000) offsets.clear();
  offsets.set(key, offset);
  return offset;
};

/** The local date and clock hour an instant falls in. */
export const localHourOf = (instant: number, timezone: string): { date: string; hour: number } => {
  const local = instant + zoneOffsetMs(instant, timezone);
  const iso = new Date(local).toISOString();
  return { date: iso.slice(0, 10), hour: Number(iso.slice(11, 13)) };
};

/** The instant a local clock hour starts. */
export const localHourStartMs = (date: string, hour: number, timezone: string): number => {
  const guess = Date.parse(`${date}T00:00:00Z`) + hour * HOUR_MS;
  // Two passes settle the offset at the instant itself (it only differs across a clock change).
  const first = guess - zoneOffsetMs(guess, timezone);
  return guess - zoneOffsetMs(first, timezone);
};

/** A local (date, hour) as a running hour number, for "consecutive" and "how far apart". */
export const hourIndex = (date: string, hour: number): number => Date.parse(`${date}T00:00:00Z`) / HOUR_MS + hour;
const shiftDate = (date: string, days: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
export const datesBetween = (from: string, to: string): string[] => {
  const dates: string[] = [];
  for (let day = from; day <= to; day = shiftDate(day, 1)) dates.push(day);
  return dates;
};

/** One interval of a meter's readings as the fact store keeps it (readEnergyMeterIntervalCoverage). */
export type MeterInterval = { meterPointId: string; startMs: number; endMs: number; qualityStatus: string; usageKwh: number | null };

/**
 * Each meter's readings as hourly cells in the site's time zone, the way the Explorer counts them: energy read on time
 * and its minutes, intervals with a quality problem, and energy sent late (spread over the hours it was offline). An
 * interval across several hours is shared out by time.
 */
export function hourlyCellsFromIntervals(intervals: readonly MeterInterval[], timezone: string): Map<string, HourCell[]> {
  const byMeter = new Map<string, Map<string, HourCell>>();
  for (const interval of intervals) {
    if (!(interval.endMs > interval.startMs)) continue;
    const length = interval.endMs - interval.startMs;
    let cells = byMeter.get(interval.meterPointId);
    if (!cells) byMeter.set(interval.meterPointId, cells = new Map());
    let cursor = interval.startMs;
    while (cursor < interval.endMs) {
      const offset = zoneOffsetMs(cursor, timezone);
      const localHourStart = Math.floor((cursor + offset) / HOUR_MS) * HOUR_MS;
      const end = Math.min(interval.endMs, localHourStart + HOUR_MS - offset);
      const iso = new Date(localHourStart).toISOString();
      const key = iso.slice(0, 13);
      let cell = cells.get(key);
      if (!cell) cells.set(key, cell = [iso.slice(0, 10), Number(iso.slice(11, 13)), null, 0, 0, 0]);
      const kwh = (interval.usageKwh ?? 0) * (end - cursor) / length;
      if (interval.qualityStatus === "ok") {
        if (interval.usageKwh !== null) cell[2] = (cell[2] ?? 0) + kwh;
        cell[3] += (end - cursor) / 60_000;
      } else {
        cell[4] += 1;
        if (interval.qualityStatus === "gap") cell[5] += kwh;
      }
      cursor = end > cursor ? end : interval.endMs;
    }
  }
  return new Map([...byMeter].map(([id, cells]) => [id, [...cells.values()].sort((a, b) => hourIndex(a[0], a[1]) - hourIndex(b[0], b[1]))]));
}

/** Every minute of the hour read on time, with no quality problem and nothing sent late. */
export const completeHour = (cell: HourCell): boolean => cell[2] !== null && cell[3] >= 59.5 && cell[4] === 0 && cell[5] === 0;

// ---------------------------------------------------------------- 1. stopped sending

/**
 * The clock hours (0–23) a meter usually sends readings in: those with a reading on at least half of the days it was
 * sending (from its first day with readings up to, not including, its last). Too few days to tell, or no hour reaching
 * half, gives every hour, so the meter is judged as one that reports around the clock.
 */
export function usualReportingHours(cells: readonly HourCell[]): Set<number> {
  const all = new Set(Array.from({ length: 24 }, (_, hour) => hour));
  const readDates = [...new Set(cells.filter((cell) => cell[3] > 0).map((cell) => cell[0]))].sort();
  if (readDates.length < 2) return all;
  const alive = datesBetween(readDates[0]!, shiftDate(readDates.at(-1)!, -1));
  const seen = new Map<number, Set<string>>();
  for (const cell of cells) {
    if (cell[3] <= 0 || cell[0] >= readDates.at(-1)!) continue;
    seen.set(cell[1], (seen.get(cell[1]) ?? new Set()).add(cell[0]));
  }
  const usual = new Set([...seen].filter(([, dates]) => dates.size / alive.length >= USUAL_HOUR_SHARE).map(([hour]) => hour));
  return usual.size ? usual : all;
}

/**
 * When a meter quiet since `fromMs` would next report as usual: at once if that is inside its usual hours, otherwise at
 * the start of its next usual hour (a lights-only meter quiet since 07:00 is next expected at dusk).
 */
export function nextUsualReport(fromMs: number, usual: ReadonlySet<number>, timezone: string): number {
  if (usual.size === 24) return fromMs;
  let cursor = fromMs;
  for (let step = 0; step < 48; step += 1) {
    const offset = zoneOffsetMs(cursor, timezone);
    const localHourStart = Math.floor((cursor + offset) / HOUR_MS) * HOUR_MS;
    if (usual.has(new Date(localHourStart).getUTCHours())) return cursor;
    cursor = localHourStart + HOUR_MS - offset;
  }
  return fromMs;
}

/** Quiet for more than 12 hours past when the meter would next have reported as usual. */
export const quietTooLong = (fromMs: number, toMs: number, usual: ReadonlySet<number>, timezone: string): boolean =>
  toMs - nextUsualReport(fromMs, usual, timezone) > OFFLINE_AFTER_MINUTES * 60_000;

export type OfflineMeter = {
  id: string;
  name: string;
  location?: string;
  locationId?: string;
  /** The end of its last reading before it went quiet. */
  since: string;
  /** When it was read on time again, and the energy it sent late for the time it was away; absent while still quiet. */
  back?: string;
  filledLateKwh?: number;
};

/** A stopped spell that ended this long before the newest data is not news any more. */
export const OFFLINE_NEWS_MS = 3 * DAY_MS;

/**
 * Each meter in use's spells without a reading for more than 12 hours past when it would next have reported as usual: the one it is in now
 * (from its last reading to `referenceMs`, the newest data the site has: its latest reading, or the end of the last
 * successful daily update), and those that ended since `newsFromMs`. A spell found only after it ended (the daily
 * update brings the outage and the return together) still counts: the hardware may need a look. Oldest first.
 */
export function findOfflineMeters(input: { meters: readonly MeterAlertInputMeter[]; cells: ReadonlyMap<string, readonly HourCell[]>; referenceMs: number; timezone: string; newsFromMs?: number }): OfflineMeter[] {
  const newsFrom = input.newsFromMs ?? input.referenceMs - OFFLINE_NEWS_MS;
  return input.meters.flatMap((meter) => {
    if (meter.notInUse || meter.idleWhenQuiet || meter.neverUsed) return [];
    const own = input.cells.get(meter.id) ?? [];
    const usual = usualReportingHours(own);
    const place = { id: meter.id, name: meter.name, ...(meter.location ? { location: meter.location } : {}), ...(meter.locationId ? { locationId: meter.locationId } : {}) };
    const spells: OfflineMeter[] = [];
    const onTime = own.filter((cell) => cell[3] > 0);
    for (let index = 1; index < onTime.length; index += 1) {
      const before = onTime[index - 1]!, after = onTime[index]!;
      if (hourIndex(after[0], after[1]) - hourIndex(before[0], before[1]) <= 1) continue;
      // Readings fill each hour from its start: the hour it went quiet ends where its minutes end, the hour it came back starts where they start.
      const sinceMs = localHourStartMs(before[0], before[1], input.timezone) + Math.min(60, before[3]) * 60_000;
      const backMs = localHourStartMs(after[0], after[1], input.timezone) + Math.max(0, 60 - Math.min(60, after[3])) * 60_000;
      if (backMs < newsFrom || !quietTooLong(sinceMs, backMs, usual, input.timezone)) continue;
      const late = own.filter((cell) => {
        const start = localHourStartMs(cell[0], cell[1], input.timezone);
        return start + HOUR_MS > sinceMs && start < backMs;
      }).reduce((sum, cell) => sum + cell[5], 0);
      spells.push({ ...place, since: new Date(sinceMs).toISOString(), back: new Date(backMs).toISOString(), filledLateKwh: round3(late) });
    }
    const last = meter.lastReadingAt ? Date.parse(meter.lastReadingAt) : Number.NaN;
    if (Number.isFinite(last) && last < input.referenceMs && quietTooLong(last, input.referenceMs, usual, input.timezone)) {
      spells.push({ ...place, since: new Date(last).toISOString() });
    }
    return spells;
  }).sort((left, right) => left.since.localeCompare(right.since) || left.name.localeCompare(right.name));
}

export type OfflineGroup = {
  /** The area when two or more of its meters went quiet together; absent for a single meter. */
  location?: string;
  locationId?: string;
  /** When the first of them went quiet. */
  since: string;
  /** When the last of them came back, once every one of them has; absent while any is still quiet. */
  back?: string;
  filledLateKwh?: number;
  meters: OfflineMeter[];
};

/** Meters in one area that went quiet within an hour of the first of them are one group; any other meter stands alone. */
export function groupOfflineMeters(meters: readonly OfflineMeter[]): OfflineGroup[] {
  const groups: OfflineGroup[] = [];
  const open = new Map<string, OfflineGroup>();
  for (const meter of [...meters].sort((left, right) => left.since.localeCompare(right.since))) {
    const known = meter.locationId ? open.get(meter.locationId) : undefined;
    if (known && Date.parse(meter.since) - Date.parse(known.since) <= OFFLINE_GROUP_WINDOW_MS && !known.meters.some((item) => item.id === meter.id)) {
      known.meters.push(meter);
      continue;
    }
    const group: OfflineGroup = { since: meter.since, meters: [meter], ...(meter.location ? { location: meter.location } : {}), ...(meter.locationId ? { locationId: meter.locationId } : {}) };
    groups.push(group);
    if (meter.locationId) open.set(meter.locationId, group);
  }
  return groups.map((group) => {
    const back = group.meters.every((meter) => meter.back)
      ? { back: group.meters.map((meter) => meter.back!).sort().at(-1)!, filledLateKwh: round3(group.meters.reduce((sum, meter) => sum + (meter.filledLateKwh ?? 0), 0)) }
      : {};
    // A "group" of one is just that meter.
    return group.meters.length > 1 ? { ...group, ...back } : { since: group.since, meters: group.meters, ...back };
  });
}

/**
 * When a meter that was quiet since `since` came back: the start of its first hour read on time after it, and the
 * energy it sent late for the time it was away (filled in over those hours). Null when it has not come back.
 */
export function meterBack(cells: readonly HourCell[], sinceMs: number, timezone: string): { at: string; filledLateKwh: number } | null {
  let back: number | null = null;
  let late = 0;
  for (const cell of cells) {
    const start = localHourStartMs(cell[0], cell[1], timezone);
    if (start + HOUR_MS <= sinceMs) continue;
    late += cell[5];
    // The hour it went quiet in still holds its last readings; it is back from the first later hour read on time.
    if (back === null && cell[3] > 0 && start >= sinceMs) back = start;
  }
  return back === null ? null : { at: new Date(back).toISOString(), filledLateKwh: Math.round(late * 1000) / 1000 };
}

// ---------------------------------------------------------------- 2. should never use power

export type HourEpisode = {
  /** First hour (local date and clock hour) and the hour after the last one. */
  startDate: string;
  startHour: number;
  endDate: string;
  endHour: number;
  hours: number;
  /** The episode reaches the newest readings: nothing yet says it has stopped. */
  ongoing: boolean;
};

export type NeverUsedEpisode = HourEpisode & { totalKwh: number; peakKwh: number };

const hourUse = (cell: HourCell): number => (cell[2] ?? 0) + cell[5];
const nextHour = (date: string, hour: number): { date: string; hour: number } => hour >= 23 ? { date: shiftDate(date, 1), hour: 0 } : { date, hour: hour + 1 };

/** Runs of consecutive hours above 0.01 kWh. A run is over once a later hour was read on time with no such use. */
export function neverUsedEpisodes(cells: readonly HourCell[]): NeverUsedEpisode[] {
  const episodes: NeverUsedEpisode[] = [];
  let run: HourCell[] = [];
  const flush = (ended: boolean) => {
    if (!run.length) return;
    const first = run[0]!, last = run.at(-1)!;
    const after = nextHour(last[0], last[1]);
    episodes.push({
      startDate: first[0], startHour: first[1], endDate: after.date, endHour: after.hour, hours: run.length, ongoing: !ended,
      totalKwh: round3(run.reduce((sum, cell) => sum + hourUse(cell), 0)), peakKwh: round3(Math.max(...run.map(hourUse))),
    });
    run = [];
  };
  for (const cell of cells) {
    const used = hourUse(cell) > NEVER_USED_KWH;
    const previous = run.at(-1);
    if (used) {
      if (previous && hourIndex(cell[0], cell[1]) !== hourIndex(previous[0], previous[1]) + 1) flush(true);
      run.push(cell);
    } else if (run.length && cell[3] > 0) {
      flush(true);
    }
  }
  flush(false);
  return episodes;
}

// ---------------------------------------------------------------- 3. unusual hourly use

export type DayTypeOf = (date: string) => string;
export type HourBaseline = { median: number; mad: number; samples: number };

export const median = (values: readonly number[]): number => {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};
/** Median absolute deviation, unscaled. */
export const medianAbsoluteDeviation = (values: readonly number[]): number => {
  const centre = median(values);
  return median(values.map((value) => Math.abs(value - centre)));
};

/**
 * A meter's usual use for each clock hour on each day type, from its complete hours on `dates`. Hours with fewer than
 * 7 samples are left out: there is nothing to compare them with.
 */
export function hourlyBaseline(cells: readonly HourCell[], dates: ReadonlySet<string>, dayTypeOf: DayTypeOf): Map<string, HourBaseline> {
  const samples = new Map<string, number[]>();
  for (const cell of cells) {
    if (!dates.has(cell[0]) || !completeHour(cell)) continue;
    const key = `${dayTypeOf(cell[0])}|${cell[1]}`;
    samples.set(key, [...(samples.get(key) ?? []), cell[2]!]);
  }
  return new Map([...samples].filter(([, values]) => values.length >= BASELINE_MIN_SAMPLES)
    .map(([key, values]) => [key, { median: median(values), mad: medianAbsoluteDeviation(values), samples: values.length }]));
}

/** How far an hour may stray from its usual use before it counts: max(50% of usual, 3 × MAD, 0.05 kWh). */
export const patternThreshold = (baseline: HourBaseline): number =>
  Math.max(PATTERN_SHARE * baseline.median, PATTERN_MAD_FACTOR * baseline.mad, PATTERN_MIN_KWH);

export type PatternEpisode = HourEpisode & {
  direction: "high" | "low" | "zero";
  /** The hour that strayed furthest: its start, its use and its usual use. */
  peakDate: string;
  peakHour: number;
  kwh: number;
  usualKwh: number;
};

/**
 * Hours on `dates` that strayed from the meter's usual use, as episodes: at least 2 consecutive hours in the same
 * direction, or 1 for a meter always on by design that dropped to about nothing. An hour not read completely on time,
 * or with nothing to compare it with, breaks a run.
 */
export function patternEpisodes(input: { cells: readonly HourCell[]; baseline: ReadonlyMap<string, HourBaseline>; dates: ReadonlySet<string>; dayTypeOf: DayTypeOf; alwaysOn?: boolean }): PatternEpisode[] {
  type Flag = { cell: HourCell; direction: "high" | "low" | "zero"; usual: number; gap: number };
  const episodes: PatternEpisode[] = [];
  let run: Flag[] = [];
  let lastJudged: HourCell | null = null;
  const flush = (ongoing = false) => {
    if (!run.length) return;
    const singleDrop = input.alwaysOn && run.every((flag) => flag.direction === "zero");
    if (run.length >= PATTERN_MIN_HOURS || singleDrop) {
      const first = run[0]!.cell, last = run.at(-1)!.cell;
      const peak = run.reduce((best, flag) => flag.gap > best.gap ? flag : best, run[0]!);
      const after = nextHour(last[0], last[1]);
      episodes.push({
        startDate: first[0], startHour: first[1], endDate: after.date, endHour: after.hour, hours: run.length, ongoing,
        direction: run.some((flag) => flag.direction === "high") ? "high" : run.every((flag) => flag.direction === "zero") ? "zero" : "low",
        peakDate: peak.cell[0], peakHour: peak.cell[1], kwh: round3(peak.cell[2]!), usualKwh: round3(peak.usual),
      });
    }
    run = [];
  };
  for (const cell of input.cells) {
    if (!input.dates.has(cell[0])) continue;
    const baseline = completeHour(cell) ? input.baseline.get(`${input.dayTypeOf(cell[0])}|${cell[1]}`) : undefined;
    const previous = run.at(-1)?.cell;
    if (previous && hourIndex(cell[0], cell[1]) !== hourIndex(previous[0], previous[1]) + 1) flush();
    if (!baseline) {
      flush();
      continue;
    }
    lastJudged = cell;
    const value = cell[2]!;
    const gap = value - baseline.median;
    if (Math.abs(gap) <= patternThreshold(baseline)) {
      flush();
      continue;
    }
    const direction: Flag["direction"] = gap > 0 ? "high" : value <= Math.max(NEAR_ZERO_KWH, 0.05 * baseline.median) ? "zero" : "low";
    // A run keeps one direction: higher, or lower (dropping to nothing counts as lower).
    if (run.length && (run.at(-1)!.direction === "high") !== (direction === "high")) flush();
    run.push({ cell, direction, usual: baseline.median, gap: Math.abs(gap) });
  }
  // The last run is still going when it reaches the last hour that could be judged.
  flush(run.length > 0 && run.at(-1)!.cell === lastJudged);
  return episodes;
}

/**
 * The day type a date belongs to for the hourly pattern: "all" on a lights-on site; "open" or "closed" on an
 * opening-hours site whose calendar says which days it opens; "weekday" or "weekend" without one.
 */
export function dayTypeResolver(input: {
  meaning: "opening" | "lights_on";
  /** Whether the site opens on a date, from its calendar; absent when it has none. */
  opensOn?: (date: string) => boolean;
}): DayTypeOf {
  if (input.meaning === "lights_on") return () => "all";
  if (input.opensOn) return (date) => (input.opensOn!(date) ? "open" : "closed");
  return (date) => {
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    return day === 0 || day === 6 ? "weekend" : "weekday";
  };
}

const round3 = (value: number): number => Math.round(value * 1000) / 1000;
