import type { EnergyMeterIntervalCoverage } from "@datafoundry/data-gateway";

/**
 * Data availability, as government IoT contracts measure it: how much of a period each meter's readings were actually
 * received. HDB's term is 95%. Energy a meter counted while offline (an estimate) and time with nothing at all both
 * count as not received; a meter someone confirmed is not in use is shown but left out of the site figure.
 */
export const DATA_AVAILABILITY_TARGET_PCT = 95;
/** A meter whose newest reading is this much older than the period's end has stopped sending (as in the bell). */
const STOPPED_AFTER_MS = 12 * 3_600_000;
/** Outages shorter than this are left out of the list: a missed reading or two, not a fault. */
const MIN_OUTAGE_MS = 3_600_000;
/** The same non-zero use, hour after hour, for this long: a stuck reading rather than a real load. */
const STUCK_VALUE_MIN_HOURS = 24;
const STUCK_VALUE_MIN_KWH = 0.05;
/** No use at all for this long, from a meter that does use energy at other times. */
const FLAT_ZERO_MIN_HOURS = 72;
const FLAT_ZERO_MIN_PERIOD_KWH = 1;
const HOUR_MS = 3_600_000;

export type DataAvailabilityMeterInput = { meterPointId: string; name: string; location?: string; notInUse?: string };
export type DataAvailabilityStatus = "ok" | "below_target" | "stopped" | "no_readings" | "not_in_use";
export type DataAvailabilityCheck = { kind: "stuck_value" | "flat_zero"; from: string; to: string; hours: number; kwhPerHour: number };
export type DataAvailabilityMeter = {
  meterPointId: string;
  name: string;
  location?: string;
  notInUse?: string;
  status: DataAvailabilityStatus;
  availabilityPct: number;
  realHours: number;
  estimatedHours: number;
  estimatedKwh: number;
  missingHours: number;
  longestOutageHours: number;
  lastReadingAt?: string;
  checks: DataAvailabilityCheck[];
};
export type DataAvailabilityOutage = {
  meterPointId: string;
  name: string;
  from: string;
  to: string;
  hours: number;
  /** "estimated": offline, but its energy arrived later and is spread as an estimate. "missing": nothing arrived. */
  kind: "estimated" | "missing";
  estimatedKwh: number;
  /** Still going at the end of the period. */
  ongoing: boolean;
};
export type DataAvailabilitySummary = {
  targetPct: number;
  site: { availabilityPct: number | null; metersCounted: number; metersBelowTarget: number; outageCount: number; estimatedKwh: number; checkCount: number };
  meters: DataAvailabilityMeter[];
  outages: DataAvailabilityOutage[];
};

const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;
const iso = (ms: number) => new Date(ms).toISOString();

type Segment = { start: number; end: number; kind: "real" | "estimated" | "missing"; kwh: number };

/** The period cut into what was received, what was estimated and what is missing, in time order. */
const segmentsFor = (intervals: EnergyMeterIntervalCoverage[], fromMs: number, toMs: number): Segment[] => {
  const segments: Segment[] = [];
  let cursor = fromMs;
  for (const interval of [...intervals].sort((left, right) => left.startMs - right.startMs)) {
    const start = Math.max(interval.startMs, cursor, fromMs), end = Math.min(interval.endMs, toMs);
    if (end <= start) continue;
    if (start > cursor) segments.push({ start: cursor, end: start, kind: "missing", kwh: 0 });
    const share = interval.endMs > interval.startMs ? (end - start) / (interval.endMs - interval.startMs) : 0;
    // Rejected readings (going backwards, irregular) were received but cannot be used: as good as missing.
    const kind = interval.qualityStatus === "ok" ? "real" : interval.qualityStatus === "gap" ? "estimated" : "missing";
    segments.push({ start, end, kind, kwh: kind === "missing" ? 0 : (interval.usageKwh ?? 0) * share });
    cursor = end;
  }
  if (cursor < toMs) segments.push({ start: cursor, end: toMs, kind: "missing", kwh: 0 });
  return segments;
};

/** Runs of whole hours with the same real use (stuck) or no use (flat), from the received readings only. */
const checksFor = (segments: Segment[]): DataAvailabilityCheck[] => {
  const hours = new Map<number, { minutes: number; kwh: number }>();
  for (const segment of segments) {
    if (segment.kind !== "real" || segment.end - segment.start > HOUR_MS) continue;
    const hour = Math.floor(segment.start / HOUR_MS);
    if (Math.floor((segment.end - 1) / HOUR_MS) !== hour) continue;
    const bucket = hours.get(hour) ?? { minutes: 0, kwh: 0 };
    bucket.minutes += (segment.end - segment.start) / 60_000;
    bucket.kwh += segment.kwh;
    hours.set(hour, bucket);
  }
  const full = [...hours.entries()].filter(([, bucket]) => bucket.minutes >= 59.9).sort(([left], [right]) => left - right);
  const periodKwh = full.reduce((sum, [, bucket]) => sum + bucket.kwh, 0);
  const checks: DataAvailabilityCheck[] = [];
  const close = (run: Array<[number, { kwh: number }]>, kind: DataAvailabilityCheck["kind"]) => {
    const first = run[0]!, last = run.at(-1)!;
    checks.push({ kind, from: iso(first[0] * HOUR_MS), to: iso((last[0] + 1) * HOUR_MS), hours: run.length, kwhPerHour: round(first[1].kwh, 3) });
  };
  let run: Array<[number, { kwh: number }]> = [];
  const flush = () => {
    const value = run[0]?.[1].kwh ?? 0;
    if (value >= STUCK_VALUE_MIN_KWH && run.length >= STUCK_VALUE_MIN_HOURS) close(run, "stuck_value");
    else if (value < 0.0005 && run.length >= FLAT_ZERO_MIN_HOURS && periodKwh >= FLAT_ZERO_MIN_PERIOD_KWH) close(run, "flat_zero");
    run = [];
  };
  for (const entry of full) {
    const previous = run.at(-1);
    const same = previous && entry[0] === previous[0] + 1 && Math.round(entry[1].kwh * 1000) === Math.round(previous[1].kwh * 1000);
    if (!same) flush();
    run.push(entry);
  }
  flush();
  return checks;
};

export function summariseDataAvailability(input: {
  fromMs: number;
  toMs: number;
  meters: DataAvailabilityMeterInput[];
  intervals: EnergyMeterIntervalCoverage[];
  lastReadingAt: Map<string, string>;
}): DataAvailabilitySummary {
  const periodMs = Math.max(1, input.toMs - input.fromMs);
  const byMeter = new Map<string, EnergyMeterIntervalCoverage[]>();
  for (const interval of input.intervals) byMeter.set(interval.meterPointId, [...(byMeter.get(interval.meterPointId) ?? []), interval]);
  const outages: DataAvailabilityOutage[] = [];
  const meters = input.meters.map((meter): DataAvailabilityMeter => {
    const segments = segmentsFor(byMeter.get(meter.meterPointId) ?? [], input.fromMs, input.toMs);
    const total = (kind: Segment["kind"]) => segments.filter(segment => segment.kind === kind).reduce((sum, segment) => sum + segment.end - segment.start, 0);
    const realMs = total("real"), estimatedMs = total("estimated"), missingMs = total("missing");
    const estimatedKwh = segments.filter(segment => segment.kind === "estimated").reduce((sum, segment) => sum + segment.kwh, 0);
    // Neighbouring estimated and missing stretches are one outage.
    let longest = 0;
    let open: Segment[] = [];
    const flush = () => {
      if (!open.length) return;
      const start = open[0]!.start, end = open.at(-1)!.end;
      longest = Math.max(longest, end - start);
      if (end - start >= MIN_OUTAGE_MS) {
        const kwh = open.reduce((sum, segment) => sum + segment.kwh, 0);
        outages.push({
          meterPointId: meter.meterPointId, name: meter.name, from: iso(start), to: iso(end), hours: round((end - start) / HOUR_MS),
          kind: open.some(segment => segment.kind === "estimated") ? "estimated" : "missing", estimatedKwh: round(kwh, 2), ongoing: end >= input.toMs,
        });
      }
      open = [];
    };
    for (const segment of segments) {
      if (segment.kind === "real") flush();
      else open.push(segment);
    }
    flush();
    const lastReadingAt = input.lastReadingAt.get(meter.meterPointId);
    const availabilityPct = round(realMs / periodMs * 100);
    const status: DataAvailabilityStatus = meter.notInUse ? "not_in_use"
      : realMs === 0 && estimatedMs === 0 ? "no_readings"
        : !lastReadingAt || Date.parse(lastReadingAt) < input.toMs - STOPPED_AFTER_MS ? "stopped"
          : availabilityPct < DATA_AVAILABILITY_TARGET_PCT ? "below_target" : "ok";
    return {
      meterPointId: meter.meterPointId,
      name: meter.name,
      ...(meter.location ? { location: meter.location } : {}),
      ...(meter.notInUse ? { notInUse: meter.notInUse } : {}),
      status,
      availabilityPct,
      realHours: round(realMs / HOUR_MS),
      estimatedHours: round(estimatedMs / HOUR_MS),
      estimatedKwh: round(estimatedKwh, 2),
      missingHours: round(missingMs / HOUR_MS),
      longestOutageHours: round(longest / HOUR_MS),
      ...(lastReadingAt ? { lastReadingAt } : {}),
      checks: meter.notInUse ? [] : checksFor(segments),
    };
  });
  const counted = meters.filter(meter => meter.status !== "not_in_use");
  const notInUse = new Set(meters.filter(meter => meter.status === "not_in_use").map(meter => meter.meterPointId));
  const listed = outages.filter(outage => !notInUse.has(outage.meterPointId)).sort((left, right) => right.from.localeCompare(left.from));
  return {
    targetPct: DATA_AVAILABILITY_TARGET_PCT,
    site: {
      availabilityPct: counted.length ? round(counted.reduce((sum, meter) => sum + meter.availabilityPct, 0) / counted.length) : null,
      metersCounted: counted.length,
      metersBelowTarget: counted.filter(meter => meter.availabilityPct < DATA_AVAILABILITY_TARGET_PCT).length,
      outageCount: listed.length,
      estimatedKwh: round(counted.reduce((sum, meter) => sum + meter.estimatedKwh, 0), 2),
      checkCount: counted.reduce((sum, meter) => sum + meter.checks.length, 0),
    },
    meters,
    outages: listed,
  };
}

const DAY_MS = 24 * HOUR_MS;
/** How far a time zone is ahead of UTC at an instant. */
const zoneOffsetMs = (instant: number, timezone: string): number => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second)) - Math.floor(instant / 1000) * 1000;
};
/** Midnight at the start of a site's local calendar date (YYYY-MM-DD). */
export const localDayStartMs = (date: string, timezone: string): number => {
  const guess = Date.parse(`${date}T00:00:00.000Z`);
  return guess - zoneOffsetMs(guess - zoneOffsetMs(guess, timezone), timezone);
};
export const siteLocalDate = (instant: number, timezone: string): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(instant));
const shiftDate = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** At most about a quarter; a monthly availability report needs a month. */
const MAX_PERIOD_DAYS = 93;
/**
 * The dates to report, both inclusive: the ones asked for, or else the last 30 complete local days. Rejects a range
 * that is back to front, longer than a quarter or not dates at all.
 */
export const resolveDataAvailabilityPeriod = (input: { from?: string | null; to?: string | null; nowMs: number; timezone: string }): { from: string; to: string; fromMs: number; toMs: number } => {
  const to = input.to ?? shiftDate(siteLocalDate(input.nowMs, input.timezone), -1);
  const from = input.from ?? shiftDate(to, -29);
  if (!DATE.test(from) || !DATE.test(to) || from > to) throw new Error("ENERGYIQ_DATA_AVAILABILITY_PERIOD_INVALID");
  if ((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS + 1 > MAX_PERIOD_DAYS) throw new Error("ENERGYIQ_DATA_AVAILABILITY_PERIOD_INVALID");
  return { from, to, fromMs: localDayStartMs(from, input.timezone), toMs: localDayStartMs(shiftDate(to, 1), input.timezone) };
};
