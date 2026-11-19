/**
 * Unusual hourly use within the hour, from the live readings, for sites with a live connection.
 *
 * Readings normally arrive once a day: the daily update publishes the previous day's readings, so an hour of unusual
 * use at 2 pm is otherwise only seen the next morning. The 15-minute live check (energy-live-readings.ts) already reads
 * each meter's running total from Tuya. This file keeps those totals for a day and, after each live check, works out
 * each meter's use for the hours that ended after the daily readings stop, and judges them against the same usual use
 * the daily check uses (energy-meter-alert-rules.ts, energy-meter-alerts.ts). No extra call is made to Tuya.
 *
 * How an hour is measured. A Tuya meter sends its running total when it moves (about once an hour), and the live check
 * reads that value with the time the meter sent it. Those values are the anchors; use between two of them is spread
 * evenly over the time between, as the daily update spreads it. A meter Tuya had online at every live check of the
 * last report slot (70 minutes) that has sent nothing new has not moved since the slot began, so a meter that suddenly
 * uses nothing is measured as using nothing once that long has passed (`inferred`). An hour is measured only when
 * anchors bracket it
 * and nothing between them casts doubt: a total that went down (a counter reset or a replaced meter), use sent after a
 * live check found the meter offline, or more than three hours without a value that ends with use (an outage whose
 * catch-up cannot be placed). Anything else waits, and the daily readings decide.
 *
 * What it raises. One hour beyond the usual range is enough here (the daily check needs two in a row): seeing it within
 * the hour is the point. The alert has the daily check's key, kind and payload, plus `live: true`, and the same limits:
 * the per-site switch for unusual use, five a day then one summary, the same meters left out (not in use, idle, must
 * never use power, stopped sending, used now and then). Meters that must never use
 * power are judged on the same live hours, and so is the whole site's total (see evaluateLiveHourAlerts). Once the daily
 * readings cover those hours the daily check takes the alert over: it keeps it if the full readings agree, and withdraws
 * it quietly if they show the live view was wrong (a meter that was offline and sent its use late, or an hour that was
 * in fact usual).
 *
 * The values come from energy-live-samples.ts. Off with ENERGYIQ_LIVE_HOUR_ALERTS_ENABLED=false, or with all meter
 * alerts (ENERGYIQ_METER_ALERTS_ENABLED=false).
 */
import type { DatabaseSync } from "node:sqlite";
import type { MetadataStore } from "@datafoundry/metadata";

import { loadPasswordAuthConfig } from "../auth/config.js";
import { createMailDelivery, type MailDelivery } from "../email/mail-delivery.js";
import { logger } from "../observability/logger.js";
import {
  dayTypeResolver,
  HOUR_MS,
  hourlyBaseline,
  localHourOf,
  localHourStartMs,
  NEAR_ZERO_KWH,
  NEVER_USED_KWH,
  patternThreshold,
} from "./energy-meter-alert-rules.js";
import { readLiveSamples, type LiveSample } from "./energy-live-samples.js";
import { MeterAlertStore, type MeterAlertRecord } from "./energy-meter-alert-store.js";
import {
  compactLocal,
  drainMeterAlertEmails,
  SITE_SUBJECT,
  siteHourCells,
  siteMeters,
  siteThreshold,
  meterAlertEmails,
  overlapsOrTouches,
  PATTERN_ALERTS_PER_DAY,
  patternDay,
  patternLearnedDates,
  readMeterAlertReadings,
  refreshPatternSummary,
  sameSide,
  shortId,
  type MeterAlertChanges,
  type MeterAlertReadings,
} from "./energy-meter-alerts.js";

const log = logger.child({ component: "live-hour-alert" });

/** A meter online and quiet at a live check has not moved since this long before it (its usual report slot, and margin). */
export const LIVE_REPORT_SLOT_MS = 70 * 60_000;
/** Hours that ended longer ago than this are left to the daily readings: they are no longer news within the hour. */
export const LIVE_LOOKBACK_HOURS = 6;
/** Mirrors TUYA_OUTAGE_MIN_HOURS / TUYA_OUTAGE_MIN_KWH in data-gateway's energy-fact-writer.ts. */
const OUTAGE_MS = 3 * HOUR_MS;
const OUTAGE_KWH = 0.05;
/** A total this much lower than the one before is a reset; anything smaller is rounding. */
const RESET_KWH = 0.001;
/** The daily readings (each meter's usual use) are read again after this long, or as soon as a new snapshot is published. */
const READINGS_CACHE_MS = 60 * 60_000;

/** Whether the live hourly check runs: on unless switched off, and never with the meter alerts switched off. */
export const liveHourAlertsEnabled = (env: Record<string, string | undefined>): boolean =>
  env.ENERGYIQ_LIVE_HOUR_ALERTS_ENABLED?.trim().toLowerCase() !== "false" && env.ENERGYIQ_METER_ALERTS_ENABLED?.trim().toLowerCase() !== "false";

// ---------------------------------------------------------------- measuring an hour

export type LiveAnchor = { at: number; kwh: number; inferred: boolean };

/**
 * The points a meter's running total is known at: each value at the time the meter sent it (or, without that time, at
 * the live check, if the meter was not offline then), and for a meter online and quiet at a live check, its last value
 * one report slot before the check. Also when live checks found it offline.
 */
export function liveAnchors(samples: readonly LiveSample[], slotMs = LIVE_REPORT_SLOT_MS): { anchors: LiveAnchor[]; offlineAt: number[] } {
  const offlineAt = samples.filter((sample) => sample.online === false).map((sample) => sample.polledAt);
  const real = new Map<number, number>();
  for (const sample of samples) {
    if (sample.energyKwh === null) continue;
    if (sample.reportedAt === undefined && sample.online === false) continue;
    // A meter clock ahead of the check is read as sent at the check.
    real.set(Math.min(sample.reportedAt ?? sample.polledAt, sample.polledAt), sample.energyKwh);
  }
  const reals = [...real].map(([at, kwh]): LiveAnchor => ({ at, kwh, inferred: false })).sort((left, right) => left.at - right.at);
  const inferred = new Map<number, LiveAnchor>();
  for (const sample of samples) {
    if (sample.online !== true || sample.energyKwh === null || sample.reportedAt === undefined) continue;
    const at = sample.polledAt - slotMs;
    if (at <= sample.reportedAt || real.has(at)) continue;
    // Online through the whole slot, at every live check in it: a meter just back has not had the time to send.
    if (samples.some((other) => other.polledAt >= at && other.polledAt <= sample.polledAt && other.online !== true)) continue;
    // Only while nothing newer was sent before then: the latest value up to then must be this one.
    const latest = reals.filter((anchor) => anchor.at <= at).at(-1);
    if (latest && latest.at === sample.reportedAt && Math.abs(latest.kwh - sample.energyKwh) < 1e-9) inferred.set(at, { at, kwh: sample.energyKwh, inferred: true });
  }
  return { anchors: [...reals, ...inferred.values()].sort((left, right) => left.at - right.at), offlineAt };
}

export type LiveHourMeasure =
  | { kwh: number; inferred: boolean }
  | { kwh: null; reason: "waiting" | "reset" | "offline" | "outage" };

/** A meter's use in [startMs, endMs) from its anchors, or why it cannot be measured (yet). */
export function measureLiveHour(input: { anchors: readonly LiveAnchor[]; offlineAt: readonly number[]; startMs: number; endMs: number }): LiveHourMeasure {
  const { anchors, startMs, endMs } = input;
  let first = -1;
  for (let index = 0; index < anchors.length && anchors[index]!.at <= startMs; index += 1) first = index;
  const last = anchors.findIndex((anchor) => anchor.at >= endMs);
  if (first < 0 || last < 0) return { kwh: null, reason: "waiting" };
  let kwh = 0;
  let inferred = false;
  for (let index = first; index < last; index += 1) {
    const before = anchors[index]!, after = anchors[index + 1]!;
    const elapsed = after.at - before.at;
    const delta = after.kwh - before.kwh;
    if (delta < -RESET_KWH) return { kwh: null, reason: "reset" };
    // Use counted while the meter was offline arrives in one go when it is back: when it was used is not known.
    if (delta > RESET_KWH && input.offlineAt.some((at) => at > before.at && at < after.at)) return { kwh: null, reason: "offline" };
    if (elapsed > OUTAGE_MS && delta >= OUTAGE_KWH) return { kwh: null, reason: "outage" };
    const overlap = Math.min(after.at, endMs) - Math.max(before.at, startMs);
    if (overlap <= 0 || elapsed <= 0) continue;
    kwh += Math.max(0, delta) * overlap / elapsed;
    if (before.inferred || after.inferred) inferred = true;
  }
  return { kwh: Math.round(kwh * 1000) / 1000, inferred };
}

/** One hour measured from live readings. */
export type LiveHourCell = { startMs: number; date: string; hour: number; kwh: number; inferred: boolean };

const floorLocalHour = (ms: number, timezone: string): number => {
  const { date, hour } = localHourOf(ms, timezone);
  return localHourStartMs(date, hour, timezone);
};

/**
 * Each meter's measured hours that ended in the last six hours and start at or after where the daily readings end
 * (`readings.referenceMs`, the hour it falls in included), oldest first. Meters with no hour measured are left out.
 */
export function measureLiveHours(input: { db: DatabaseSync; projectId: string; readings: MeterAlertReadings; now: Date }): Map<string, LiveHourCell[]> {
  const { timezone, referenceMs } = input.readings;
  const result = new Map<string, LiveHourCell[]>();
  if (referenceMs === null) return result;
  const lastEnd = floorLocalHour(input.now.getTime(), timezone);
  const from = Math.max(floorLocalHour(referenceMs, timezone), lastEnd - LIVE_LOOKBACK_HOURS * HOUR_MS);
  if (from >= lastEnd) return result;
  const samples = readLiveSamples(input.db, input.projectId, from - OUTAGE_MS - LIVE_REPORT_SLOT_MS);
  for (const meter of input.readings.meters) {
    const own = samples.get(meter.id);
    if (!own?.length) continue;
    const { anchors, offlineAt } = liveAnchors(own);
    const cells: LiveHourCell[] = [];
    for (let at = from; at < lastEnd; at += HOUR_MS) {
      const measured = measureLiveHour({ anchors, offlineAt, startMs: at, endMs: at + HOUR_MS });
      if (measured.kwh === null) continue;
      const { date, hour } = localHourOf(at, timezone);
      cells.push({ startMs: at, date, hour, kwh: measured.kwh, inferred: measured.inferred });
    }
    if (cells.length) result.set(meter.id, cells);
  }
  return result;
}

// ---------------------------------------------------------------- judging the hours

const iso = (ms: number) => new Date(ms).toISOString();
const round3 = (value: number): number => Math.round(value * 1000) / 1000;
type Direction = "high" | "low" | "zero";

/**
 * Brings the stored alerts in line with the hours measured from live readings, like evaluateMeterAlerts does for the
 * daily readings: opens what is new (one hour is enough), extends what goes on, resolves what an hour back to usual has
 * ended. Checking the same hours again changes nothing.
 *
 * Besides each meter, the whole site is judged on the same hours: the sum of its official meters against the site's
 * usual total for that hour (same day kinds). It stands out at 30% and at least 0.5 kWh off usual (kW over the hour);
 * below usual counts only in the site's hours (lights-on or opening hours), so near-zero daytime or night-time loads
 * never alert. It is an unusual-use alert on subject "site" (`scope: "site"`), within the same five a day.
 */
export function evaluateLiveHourAlerts(input: {
  store: MeterAlertStore; projectId: string; readings: MeterAlertReadings; live: ReadonlyMap<string, readonly LiveHourCell[]>; patternAlerts: boolean; now: Date;
  /** The site's name, for the whole-site alert. */
  siteName?: string;
}): MeterAlertChanges {
  const { store, projectId, readings, now } = input;
  const { timezone } = readings;
  const changes: MeterAlertChanges = { opened: [], resolved: [] };
  if (readings.referenceMs === null || !input.live.size) return changes;
  const open = (kind: "never_used" | "usage_pattern", key: string, subject: string, payload: Record<string, unknown>) => {
    if (store.open({ projectId, key, kind, audience: "operators", subject, payload, now }) !== "exists") changes.opened.push(store.get(projectId, key)!);
  };
  const resolve = (key: string, payload: Record<string, unknown>) => {
    if (store.resolve(projectId, key, payload, now)) changes.resolved.push(store.get(projectId, key)!);
  };
  /** An alert of this meter this run can carry on: open, or raised from live readings, and never one withdrawn. */
  const carries = (alert: MeterAlertRecord, meterId: string) => alert.subject === meterId && alert.payload.withdrawn !== true && (alert.status === "open" || alert.payload.live === true);
  // Meters said to have stopped sending are the hardware alert's; judging their quiet as "used nothing" too would say it twice.
  const stopped = new Set(store.list(projectId, { status: "open", kind: "meter_offline" })
    .flatMap((alert) => (Array.isArray(alert.payload.meters) ? alert.payload.meters as Array<{ id?: unknown }> : []).map((meter) => String(meter.id ?? ""))));
  const dayTypeOf = dayTypeResolver({ meaning: readings.hoursMeaning, ...(readings.opensOn ? { opensOn: readings.opensOn } : {}) });
  const learned = patternLearnedDates(readings.referenceMs, timezone);
  const day = patternDay(now.getTime(), timezone);
  let shown = store.countOpened(projectId, "usage_pattern", day.dayFrom, day.dayTo, { suppressed: false });
  let summaryNeeded = false;
  const patternAlerts = store.list(projectId, { kind: "usage_pattern" });
  const neverAlerts = store.list(projectId, { kind: "never_used" });

  type Judged = { cell: LiveHourCell; flag?: { direction: Direction; usual: number; gap: number } };
  /**
   * Turns one subject's judged hours (a meter, or the whole site) into alerts: runs of consecutive unusual hours on one
   * side, one hour being enough, each opening, carrying on or ending an episode; and an open episode whose next hour was
   * judged back to usual (or unusual the other way) is over.
   */
  const raiseEpisodes = (input: { subject: string; keyId: string; name: string; judged: readonly Judged[]; extra?: Record<string, unknown> }) => {
    const { subject, judged } = input;
    const runs: Judged[][] = [];
    let current: Judged[] | null = null;
    for (const item of judged) {
      const previous: Judged | undefined = current?.at(-1);
      if (!item.flag) {
        current = null;
      } else if (current && previous?.flag && previous.cell.startMs + HOUR_MS === item.cell.startMs && sameSide(previous.flag.direction, item.flag.direction)) {
        current.push(item);
      } else {
        current = [item];
        runs.push(current);
      }
    }
    const touched = new Set<string>();
    for (const run of runs) {
      const startMs = run[0]!.cell.startMs, endMs = run.at(-1)!.cell.startMs + HOUR_MS;
      const peak = run.reduce((best, item) => (item.flag!.gap > best.flag!.gap ? item : best), run[0]!);
      const direction: Direction = run.some((item) => item.flag!.direction === "high") ? "high" : run.every((item) => item.flag!.direction === "zero") ? "zero" : "low";
      const fresh = {
        meterId: subject, meterName: input.name, direction, start: iso(startMs), end: iso(endMs), hours: run.length,
        at: iso(peak.cell.startMs), kwh: round3(peak.cell.kwh), usualKwh: round3(peak.flag!.usual),
        ongoing: run.at(-1) === judged.at(-1), live: true, ...(run.some((item) => item.cell.inferred) ? { inferred: true } : {}), ...input.extra,
      };
      const key = `usage-pattern:${input.keyId}:${compactLocal(startMs, timezone)}`;
      const own = store.get(projectId, key);
      // The same episode seen again, or one it carries on (raised earlier from live readings, or by the daily check).
      const continuing = (own && own.payload.withdrawn !== true ? own : undefined)
        ?? patternAlerts.find((alert) => carries(alert, subject) && overlapsOrTouches(alert, startMs, endMs) && sameSide(alert.payload.direction, direction));
      if (continuing) {
        const before = continuing.payload;
        const keepPeak = typeof before.kwh === "number" && typeof before.usualKwh === "number" && Math.abs(before.kwh - before.usualKwh) > Math.abs(fresh.kwh - fresh.usualKwh);
        const start = typeof before.start === "string" && before.start < fresh.start ? before.start : fresh.start;
        const end = typeof before.end === "string" && before.end > fresh.end ? before.end : fresh.end;
        const payload = {
          ...fresh, start, end, hours: Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / HOUR_MS)),
          ongoing: end === fresh.end ? fresh.ongoing : before.ongoing === true,
          ...(keepPeak ? { at: before.at, kwh: before.kwh, usualKwh: before.usualKwh, direction: before.direction } : {}),
          ...(before.inferred === true ? { inferred: true } : {}),
          ...(before.confirmed === true ? { confirmed: true } : {}),
          ...(before.suppressed === true ? { suppressed: true } : {}),
          ...(before.seeded === true ? { seeded: true } : {}),
        };
        touched.add(continuing.key);
        store.update(projectId, continuing.key, payload, now);
        if (!payload.ongoing) resolve(continuing.key, payload);
        continue;
      }
      const suppressed = shown >= PATTERN_ALERTS_PER_DAY;
      const payload = { ...fresh, ...(suppressed ? { suppressed: true } : {}) };
      touched.add(key);
      if (suppressed) {
        store.open({ projectId, key, kind: "usage_pattern", audience: "operators", subject, payload, now });
        summaryNeeded = true;
      } else {
        open("usage_pattern", key, subject, payload);
        shown += 1;
      }
      if (!fresh.ongoing) resolve(key, payload);
    }
    const judgedAt = new Map(judged.map((item) => [item.cell.startMs, item]));
    for (const alert of patternAlerts) {
      if (alert.subject !== subject || alert.status !== "open" || touched.has(alert.key)) continue;
      const next = judgedAt.get(Date.parse(String(alert.payload.end ?? "")));
      if (next && !(next.flag && sameSide(next.flag.direction, alert.payload.direction))) resolve(alert.key, { ...alert.payload, ongoing: false });
    }
  };

  for (const meter of readings.meters) {
    const hours = input.live.get(meter.id) ?? [];
    if (!hours.length || meter.notInUse || stopped.has(meter.id)) continue;

    // ---------- should never use power
    if (meter.neverUsed) {
      const touched = new Set<string>();
      const runs: LiveHourCell[][] = [];
      for (const cell of hours) {
        if (cell.kwh <= NEVER_USED_KWH) continue;
        const run = runs.at(-1);
        if (run && run.at(-1)!.startMs + HOUR_MS === cell.startMs) run.push(cell);
        else runs.push([cell]);
      }
      for (const run of runs) {
        const startMs = run[0]!.startMs, endMs = run.at(-1)!.startMs + HOUR_MS;
        const fresh = {
          meterId: meter.id, meterName: meter.name, start: iso(startMs), end: iso(endMs), hours: run.length,
          totalKwh: round3(run.reduce((sum, cell) => sum + cell.kwh, 0)), peakKwh: round3(Math.max(...run.map((cell) => cell.kwh))),
          ongoing: run.at(-1) === hours.at(-1), live: true, ...(run.some((cell) => cell.inferred) ? { inferred: true } : {}),
        };
        const key = `never-used:${shortId(meter.id)}:${compactLocal(startMs, timezone)}`;
        const own = store.get(projectId, key);
        const continuing = (own && own.payload.withdrawn !== true ? own : undefined)
          ?? neverAlerts.find((alert) => carries(alert, meter.id) && overlapsOrTouches(alert, startMs, endMs));
        if (continuing) {
          const before = continuing.payload;
          const beforeEnd = Date.parse(String(before.end ?? "")) || endMs;
          // Only hours after what it already counted add to its total, so checking the same hours again adds nothing.
          const added = run.filter((cell) => cell.startMs >= beforeEnd);
          const start = typeof before.start === "string" && before.start < fresh.start ? before.start : fresh.start;
          const end = typeof before.end === "string" && before.end > fresh.end ? before.end : fresh.end;
          const payload = {
            ...fresh, start, end, hours: Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / HOUR_MS)),
            totalKwh: round3(Number(before.totalKwh ?? 0) + added.reduce((sum, cell) => sum + cell.kwh, 0)),
            peakKwh: Math.max(fresh.peakKwh, Number(before.peakKwh ?? 0)),
            ongoing: end === fresh.end ? fresh.ongoing : before.ongoing === true,
            ...(before.inferred === true ? { inferred: true } : {}),
            ...(before.confirmed === true ? { confirmed: true } : {}),
            ...(before.seeded === true ? { seeded: true } : {}),
          };
          touched.add(continuing.key);
          store.update(projectId, continuing.key, payload, now);
          if (!payload.ongoing) resolve(continuing.key, payload);
          continue;
        }
        touched.add(key);
        open("never_used", key, meter.id, fresh);
        if (!fresh.ongoing) resolve(key, fresh);
      }
      // An open episode whose next hour was measured with no use is over.
      const measured = new Set(hours.map((cell) => cell.startMs));
      for (const alert of neverAlerts) {
        if (alert.subject !== meter.id || alert.status !== "open" || touched.has(alert.key)) continue;
        if (measured.has(Date.parse(String(alert.payload.end ?? "")))) resolve(alert.key, { ...alert.payload, ongoing: false });
      }
      continue;
    }

    // ---------- unusual hourly use
    // Used now and then: its use is sporadic by design, so no hour of it is unusual (it still counts in the site's total).
    if (!input.patternAlerts || meter.idleWhenQuiet || meter.occasionalUse) continue;
    const baseline = hourlyBaseline(readings.cells.get(meter.id) ?? [], learned, dayTypeOf);
    if (!baseline.size) continue;
    const judged: Judged[] = [];
    for (const cell of hours) {
      const usual = baseline.get(`${dayTypeOf(cell.date)}|${cell.hour}`);
      if (!usual) continue;
      const gap = cell.kwh - usual.median;
      if (Math.abs(gap) <= patternThreshold(usual)) {
        judged.push({ cell });
        continue;
      }
      const direction: Direction = gap > 0 ? "high" : cell.kwh <= Math.max(NEAR_ZERO_KWH, 0.05 * usual.median) ? "zero" : "low";
      judged.push({ cell, flag: { direction, usual: usual.median, gap: Math.abs(gap) } });
    }
    raiseEpisodes({ subject: meter.id, keyId: shortId(meter.id), name: meter.name, judged });
  }

  // ---------- the whole site: its official total against its usual level for the hour
  if (input.patternAlerts) {
    const members = siteMeters(readings.meters);
    const siteBaseline = members.some((meter) => !meter.occasionalUse) ? hourlyBaseline(siteHourCells(readings), learned, dayTypeOf) : new Map();
    if (siteBaseline.size) {
      const judged: Judged[] = [];
      const starts = [...new Set(members.flatMap((meter) => (input.live.get(meter.id) ?? []).map((cell) => cell.startMs)))].sort((left, right) => left - right);
      for (const startMs of starts) {
        // Every official meter measured that hour (one used now and then counts as using nothing when it sent nothing).
        const parts = members.map((meter) => ({ meter, cell: input.live.get(meter.id)?.find((cell) => cell.startMs === startMs) }));
        if (parts.some((part) => !part.cell && !part.meter.occasionalUse)) continue;
        const { date, hour } = localHourOf(startMs, timezone);
        const usual = siteBaseline.get(`${dayTypeOf(date)}|${hour}`);
        if (!usual) continue;
        const cell: LiveHourCell = { startMs, date, hour, kwh: round3(parts.reduce((sum, part) => sum + (part.cell?.kwh ?? 0), 0)), inferred: parts.some((part) => part.cell?.inferred === true) };
        const gap = cell.kwh - usual.median;
        // Below usual counts only in the site's hours (lights that did not come on); outside them it is noise.
        const counts = Math.abs(gap) >= siteThreshold(usual.median) && (gap > 0 || readings.activeHour?.(date, hour) === true);
        judged.push(counts ? { cell, flag: { direction: gap > 0 ? "high" : "low", usual: usual.median, gap: Math.abs(gap) } } : { cell });
      }
      raiseEpisodes({ subject: SITE_SUBJECT, keyId: SITE_SUBJECT, name: input.siteName ?? "The site", judged, extra: { scope: "site" } });
    }
  }
  if (input.patternAlerts) refreshPatternSummary({ store, projectId, day, summaryNeeded, seeded: {}, now, changes });
  return changes;
}

// ---------------------------------------------------------------- running it

export type LiveHourRun = { checked: boolean; measured: number; opened: MeterAlertRecord[]; resolved: MeterAlertRecord[]; emailed: string[]; emailFailures: number };
type Send = (message: { to: string[]; subject: string; text: string }) => Promise<void>;
type ReadReadings = (metadataStore: MetadataStore, projectId: string, now: Date) => Promise<MeterAlertReadings>;

/**
 * Judges one live site's latest hours and sends whatever that raised. A site the daily check has never looked at is left
 * alone (its first check records its history first), as is one with no daily readings to learn usual use from. The
 * alerts and the emails about them are saved in one transaction, as the daily check saves its own.
 */
export async function runLiveHourAlerts(input: {
  metadataStore: MetadataStore; projectId: string; now: Date; env?: Record<string, string | undefined>; send?: Send; publicBaseUrl?: string; read?: ReadReadings;
}): Promise<LiveHourRun> {
  const env = input.env ?? process.env;
  const none: LiveHourRun = { checked: false, measured: 0, opened: [], resolved: [], emailed: [], emailFailures: 0 };
  if (!liveHourAlertsEnabled(env)) return none;
  const store = new MeterAlertStore(input.metadataStore.db);
  if (!store.lastCheck(input.projectId)) return none;
  const readings = await (input.read ?? readMeterAlertReadings)(input.metadataStore, input.projectId, input.now);
  if (!readings.meters.length || readings.referenceMs === null) return none;
  const live = measureLiveHours({ db: input.metadataStore.db, projectId: input.projectId, readings, now: input.now });
  const measured = [...live.values()].reduce((sum, cells) => sum + cells.length, 0);
  if (!measured) return { ...none, checked: true };
  const emailsOn = Boolean(input.send) && env.ENERGYIQ_ALERT_EMAILS_ENABLED?.trim() === "true";
  const project = input.metadataStore.energyIq.getProject(input.projectId);
  let queued = false;
  const changes = store.transaction(() => {
    const found = evaluateLiveHourAlerts({ store, projectId: input.projectId, readings, live, patternAlerts: store.getSettings(input.projectId).patternAlerts, now: input.now, siteName: project.name });
    if (emailsOn) {
      for (const email of meterAlertEmails({ changes: found, site: project.name, timezone: readings.timezone, projectId: input.projectId, ...(input.publicBaseUrl ? { publicBaseUrl: input.publicBaseUrl } : {}) })) {
        queued = store.enqueueEmail({ projectId: input.projectId, key: email.key, audience: email.audience, subject: email.subject, text: email.text, now: input.now }) || queued;
      }
    }
    return found;
  });
  // Sent now rather than at the next hourly check: being within the hour is the point.
  const sent = emailsOn && queued
    ? await drainMeterAlertEmails({ metadataStore: input.metadataStore, projectId: input.projectId, store, send: input.send!, env, now: input.now })
    : { emailed: [], failures: 0 };
  return { checked: true, measured, ...changes, emailed: sent.emailed, emailFailures: sent.failures };
}

export type EnergyLiveHourAlerts = {
  /** After a site's live check: judge its latest hours. Never throws; a failure is logged and the next check tries again. */
  check(projectId: string): Promise<LiveHourRun | undefined>;
};

/**
 * The live hourly check as the server runs it, after each site's 15-minute live check. Each site's daily readings (its
 * usual use) are read at most once an hour, or again when a new snapshot is published, so the check costs a few
 * small database reads; it never calls Tuya.
 */
export const createEnergyLiveHourAlerts = (input: {
  metadataStore: MetadataStore; env?: NodeJS.ProcessEnv; delivery?: MailDelivery; now?: () => Date; read?: ReadReadings;
}): EnergyLiveHourAlerts => {
  const env = input.env ?? process.env;
  const now = input.now ?? (() => new Date());
  const delivery = input.delivery ?? createMailDelivery(env);
  const publicBaseUrl = loadPasswordAuthConfig(env).publicBaseUrl;
  const cache = new Map<string, { snapshotId: string | null; at: number; readings: MeterAlertReadings }>();
  const read: ReadReadings = async (metadataStore, projectId, at) => {
    const snapshotId = metadataStore.energyIq.findCurrentDataSnapshot(projectId)?.id ?? null;
    const known = cache.get(projectId);
    const age = at.getTime() - (known?.at ?? 0);
    if (known && known.snapshotId === snapshotId && age >= 0 && age < READINGS_CACHE_MS) return known.readings;
    const readings = await (input.read ?? readMeterAlertReadings)(metadataStore, projectId, at);
    cache.set(projectId, { snapshotId, at: at.getTime(), readings });
    return readings;
  };
  return {
    async check(projectId) {
      if (!liveHourAlertsEnabled(env)) return undefined;
      try {
        const run = await runLiveHourAlerts({
          metadataStore: input.metadataStore, projectId, now: now(), env, read, publicBaseUrl,
          ...(delivery.mode !== "off" ? { send: delivery.send } : {}),
        });
        if (run.opened.length || run.resolved.length || run.emailed.length || run.emailFailures) {
          log.info("live-hour-alerts", { project_id: projectId, measured: run.measured, opened: run.opened.length, resolved: run.resolved.length, emailed: run.emailed.length, email_failures: run.emailFailures });
        }
        return run;
      } catch (error) {
        log.warn("failed", { project_id: projectId, code: error instanceof Error ? error.message.slice(0, 160) : "unknown" });
        return undefined;
      }
    },
  };
};
