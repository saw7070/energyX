/**
 * Meter alerts, checked whenever a site has new readings: meters that stopped sending, a meter that used power it
 * never should, and hours of unusual use. The rules live in energy-meter-alert-rules.ts; this file reads the readings,
 * keeps each alert's state (energy-meter-alert-store.ts) and sends the emails.
 *
 * - Stopped sending goes to the people who look after the meters and gateways (platform administrators, people allowed
 *   to change the live connection, and the extra addresses set on Facility → Live connection), never to the people who
 *   run the site. It resolves on its own once readings come back.
 * - Never-use and unusual-use alerts go to the people who run the site (the same people as the budget and overnight
 *   alerts) and platform administrators. Unusual-use alerts can be turned off per site, and at most five a day open per
 *   site; the rest are counted in one summary alert.
 *
 * Checking the same readings again changes nothing, so the nightly update, its hourly retries and uploads can all
 * trigger a check. Emails go out only when ENERGYIQ_ALERT_EMAILS_ENABLED=true and mail is configured; the bell always
 * shows the alerts.
 *
 * On sites with a live connection, unusual use and never-use are also judged within the hour from the live readings
 * (energy-live-hour-alerts.ts), on the hours after these readings end. Those alerts carry `live: true`. Once these
 * readings cover their hours, this check takes them over: an episode found here continues the live alert rather than
 * opening a second one; one these readings do not confirm is withdrawn quietly (`withdrawn: true`, out of the bell).
 */
import { readEnergyMeterDataHealth, readEnergyMeterIntervalCoverage } from "@datafoundry/data-gateway";
import type { MetadataStore } from "@datafoundry/metadata";

import { logger } from "../observability/logger.js";
import type { AlertEmail } from "./energy-alert-emails.js";
import { lightsOnHoursOn, readIdleWhenQuietMeters } from "./energy-idle-meters.js";
import {
  BASELINE_DAYS,
  completeHour,
  dayTypeResolver,
  datesBetween,
  findOfflineMeters,
  groupOfflineMeters,
  HOUR_MS,
  hourlyBaseline,
  hourlyCellsFromIntervals,
  localHourOf,
  localHourStartMs,
  meterBack,
  NEVER_USED_KWH,
  neverUsedEpisodes,
  patternEpisodes,
  patternThreshold,
  type HourBaseline,
  type HourCell,
  type MeterAlertInputMeter,
  type OfflineGroup,
} from "./energy-meter-alert-rules.js";
import { MeterAlertStore, type MeterAlertAudience, type MeterAlertKind, type MeterAlertRecord } from "./energy-meter-alert-store.js";
import { buildEnergyProjectInformation } from "./energy-project-information.js";
import { withEnergyProjectPublicationReadLock } from "./energy-project-materialization.js";
import { resolveEnergyPublishedMeterPoints } from "./energy-query-context.js";
import { hardwareAlertRecipients, operatorAlertRecipients } from "./energy-recipients.js";

const DAY_MS = 24 * HOUR_MS;
const log = logger.child({ component: "meter-alert" });
/** A never-use episode that ended longer ago than this is not news when it is first seen (say, on the first check). */
export const NEVER_USED_NEWS_DAYS = 7;
/** Days whose hours are judged for unusual use: the newest day with readings and the one before. */
export const PATTERN_DAYS = 2;
/** Unusual-use alerts that open per site per day before the rest are only counted. */
export const PATTERN_ALERTS_PER_DAY = 5;
/** With no new readings, a site is checked again after this long (the newest data can move without a new snapshot). */
export const RECHECK_MS = 3 * HOUR_MS;

export type MeterAlertReadings = {
  timezone: string;
  meters: MeterAlertInputMeter[];
  cells: ReadonlyMap<string, readonly HourCell[]>;
  /** The newest data the site has (latest reading, or the end of the last successful daily update); null with none. */
  referenceMs: number | null;
  hoursMeaning: "opening" | "lights_on";
  /** Whether the site opens on a date, from its calendar; absent without one. */
  opensOn?: (date: string) => boolean;
  dataSnapshotId?: string | null;
};

export type MeterAlertChanges = { opened: MeterAlertRecord[]; resolved: MeterAlertRecord[] };

/** A short, stable id for a meter or area inside an alert key. */
export const shortId = (text: string): string => {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) hash = ((hash * 33) ^ text.charCodeAt(index)) >>> 0;
  return hash.toString(36);
};
/** An instant as the site's own "YYYYMMDDTHHmm", for alert keys. */
export const compactLocal = (ms: number, timezone: string): string => {
  const { date, hour } = localHourOf(ms, timezone);
  const minute = new Date(ms).getUTCMinutes();
  return `${date.replaceAll("-", "")}T${String(hour).padStart(2, "0")}${String(minute).padStart(2, "0")}`;
};
const shiftDate = (date: string, days: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const iso = (ms: number) => new Date(ms).toISOString();

/**
 * The dates a meter's usual use is learned from: the 21 days before the two days the daily check judges, counted back
 * from the newest data. Hours judged from live readings are compared with the same usual use, so the daily check that
 * later covers them reaches the same view.
 */
export const patternLearnedDates = (referenceMs: number, timezone: string): Set<string> => {
  const newest = localHourOf(referenceMs - 1, timezone).date;
  return new Set(datesBetween(shiftDate(newest, -PATTERN_DAYS - BASELINE_DAYS + 1), shiftDate(newest, -PATTERN_DAYS)));
};

/** The site's own date at `now`, and when it starts and ends: the day the limit of five unusual-use alerts counts. */
export const patternDay = (nowMs: number, timezone: string): { today: string; dayFrom: string; dayTo: string } => {
  const today = localHourOf(nowMs, timezone).date;
  return { today, dayFrom: iso(localHourStartMs(today, 0, timezone)), dayTo: iso(localHourStartMs(shiftDate(today, 1), 0, timezone)) };
};

/** Unusual use further than the day's five, counted in one summary alert (opened once there is any, updated after). */
export function refreshPatternSummary(input: {
  store: MeterAlertStore; projectId: string; day: { today: string; dayFrom: string; dayTo: string }; summaryNeeded: boolean; seeded: Record<string, unknown>; now: Date; changes: MeterAlertChanges;
}): void {
  const { store, projectId, day } = input;
  const hidden = store.listOpened(projectId, "usage_pattern", day.dayFrom, day.dayTo, { suppressed: true });
  if (!input.summaryNeeded && !hidden.length) return;
  const summaryKey = `usage-pattern-more:${day.today.replaceAll("-", "")}`;
  const known = store.get(projectId, summaryKey);
  const payload = {
    date: day.today, count: hidden.length, names: [...new Set(hidden.map((record) => String(record.payload.meterName ?? "")))].filter(Boolean).slice(0, 10),
    ...(known ? (known.payload.seeded === true ? { seeded: true } : {}) : input.seeded),
  };
  if (known) store.update(projectId, summaryKey, payload, input.now);
  else if (hidden.length && store.open({ projectId, key: summaryKey, kind: "usage_pattern_more", audience: "operators", subject: "site", payload, now: input.now }) !== "exists") {
    input.changes.opened.push(store.get(projectId, summaryKey)!);
  }
}

/** Higher, or lower (dropping to nothing counts as lower): an episode keeps one side. */
export const sameSide = (left: unknown, right: unknown): boolean => (left === "high") === (right === "high");

/** Whether an alert's hours [start, end) overlap [startMs, endMs] or meet it end to start. */
export const overlapsOrTouches = (alert: MeterAlertRecord, startMs: number, endMs: number): boolean => {
  const start = Date.parse(typeof alert.payload.start === "string" ? alert.payload.start : "");
  const end = Date.parse(typeof alert.payload.end === "string" ? alert.payload.end : "");
  return Number.isFinite(start) && Number.isFinite(end) && start <= endMs && end >= startMs;
};

/** Alerts raised from live readings (energy-live-hour-alerts.ts) that the daily readings have not withdrawn. */
const isLive = (alert: MeterAlertRecord): boolean => alert.payload.live === true && alert.payload.withdrawn !== true;

/**
 * What the daily readings say about the hours of an alert raised from live readings, once they cover them:
 * - confirmed: at least one of its hours was unusual the same way (or, for a meter that must never use power, used it);
 * - refuted: every hour is known and none agrees, because the meter was in fact offline and sent its use late, or the
 *   hours were usual after all. An hour the live check measured as unchanged because the meter was online and quiet is
 *   not contradicted by the daily update spreading the next reading's use back over the quiet time, so such an alert
 *   (`inferred`) is refuted only by use sent late;
 * - unknown: some hours have no complete daily reading.
 */
export function liveAlertVerdict(input: {
  alert: MeterAlertRecord; cells: readonly HourCell[]; baseline: ReadonlyMap<string, HourBaseline>; dayTypeOf: (date: string) => string; timezone: string;
}): "confirmed" | "refuted" | "unknown" {
  const { alert, timezone } = input;
  const start = Date.parse(String(alert.payload.start ?? "")), end = Date.parse(String(alert.payload.end ?? ""));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return "unknown";
  const byHour = new Map(input.cells.map((cell) => [`${cell[0]}|${cell[1]}`, cell]));
  let confirmed = 0, against = 0, late = 0, unknown = 0;
  for (let at = start; at < end; at += HOUR_MS) {
    const { date, hour } = localHourOf(at, timezone);
    const cell = byHour.get(`${date}|${hour}`);
    if (!cell) {
      unknown += 1;
    } else if (alert.kind === "never_used") {
      if ((cell[2] ?? 0) + cell[5] > NEVER_USED_KWH) confirmed += 1;
      else if (completeHour(cell)) against += 1;
      else unknown += 1;
    } else if (cell[4] > 0 || cell[5] > 0) {
      late += 1;
    } else {
      const usual = completeHour(cell) ? input.baseline.get(`${input.dayTypeOf(date)}|${hour}`) : undefined;
      if (!usual) unknown += 1;
      else if (Math.abs(cell[2]! - usual.median) > patternThreshold(usual) && sameSide(cell[2]! > usual.median ? "high" : "low", alert.payload.direction)) confirmed += 1;
      else against += 1;
    }
  }
  if (confirmed) return "confirmed";
  if (unknown) return "unknown";
  if (late || (against && alert.payload.inferred !== true)) return "refuted";
  return "unknown";
}

type OfflinePayloadMeter = { id: string; name: string; since: string };
const payloadMeters = (payload: Record<string, unknown>): OfflinePayloadMeter[] =>
  Array.isArray(payload.meters) ? (payload.meters as unknown[]).flatMap((item) => {
    const meter = item as Partial<OfflinePayloadMeter> | null;
    return meter && typeof meter.id === "string" && typeof meter.since === "string" ? [{ id: meter.id, name: String(meter.name ?? meter.id), since: meter.since }] : [];
  }) : [];
const offlinePayload = (group: OfflineGroup): Record<string, unknown> => ({
  meters: group.meters.map((meter) => ({ id: meter.id, name: meter.name, since: meter.since, ...(meter.back ? { back: meter.back } : {}) })),
  since: group.since,
  ...(group.location ? { location: group.location } : {}),
  ...(group.back ? { back: group.back, filledLateKwh: group.filledLateKwh ?? 0 } : {}),
});
/** Two readings of when a meter went quiet this close together are the same spell. */
const SAME_SPELL_MS = 90 * 60_000;

/**
 * Brings the stored alerts in line with the readings: opens new ones, updates those still going, resolves those that
 * are over. Returns what opened (or came back) and what resolved in this check; a second check of the same readings
 * returns nothing.
 *
 * `firstCheck`: the site has never been checked, so the readings hold weeks of history at once. What is already over
 * (outages that ended, use that stopped) and the day's unusual hours are recorded as `seeded`: kept, but never
 * emailed, and outages already over are not shown in the bell either. What is still going is raised as usual.
 */
export function evaluateMeterAlerts(input: { store: MeterAlertStore; projectId: string; readings: MeterAlertReadings; patternAlerts: boolean; now: Date; firstCheck?: boolean }): MeterAlertChanges {
  const { store, projectId, readings, now } = input;
  const seeded = input.firstCheck ? { seeded: true } : {};
  const { timezone, cells } = readings;
  const changes: MeterAlertChanges = { opened: [], resolved: [] };
  const open = (kind: MeterAlertKind, audience: MeterAlertAudience, key: string, subject: string, payload: Record<string, unknown>) => {
    const outcome = store.open({ projectId, key, kind, audience, subject, payload, now });
    if (outcome !== "exists") changes.opened.push(store.get(projectId, key)!);
    return outcome;
  };
  const resolve = (key: string, payload: Record<string, unknown>) => {
    if (store.resolve(projectId, key, payload, now)) changes.resolved.push(store.get(projectId, key)!);
  };

  // ---------- 1. stopped sending: the people who look after the hardware
  const offline = readings.referenceMs === null ? [] : findOfflineMeters({ meters: readings.meters, cells, referenceMs: readings.referenceMs, timezone });
  const groups = groupOfflineMeters(offline);
  const stored = store.list(projectId, { kind: "meter_offline" }).sort((left, right) => Number(right.status === "open") - Number(left.status === "open"));
  const claimed = new Set<string>();
  // The same spell seen again: one of its meters, quiet from about the same time (the time is exact while it is quiet,
  // and read from the hourly readings once it is back).
  const sameSpell = (group: OfflineGroup, alert: MeterAlertRecord) => payloadMeters(alert.payload)
    .some((item) => group.meters.some((meter) => meter.id === item.id && Math.abs(Date.parse(meter.since) - Date.parse(item.since)) <= SAME_SPELL_MS));
  for (const group of groups) {
    const payload = offlinePayload(group);
    const known = stored.find((alert) => !claimed.has(alert.key) && sameSpell(group, alert));
    if (known) {
      claimed.add(known.key);
      // History from a site's first check stays history each time the spell is seen again (the readings cover days,
      // so every later check finds it); losing the flag would put it in the bell as news.
      const kept = known.payload.seeded === true ? { ...payload, seeded: true } : payload;
      if (known.status === "open" && group.back) resolve(known.key, kept);
      else if (known.status === "open" || group.back) store.update(projectId, known.key, kept, now);
      // Quiet again from the same time: the readings that said it was back are gone.
      else open("meter_offline", "hardware", known.key, known.subject, payload);
      continue;
    }
    const subject = group.locationId && group.meters.length > 1 ? group.locationId : group.meters[0]!.id;
    const key = `meter-offline:${shortId(subject)}:${compactLocal(Date.parse(group.since), timezone)}`;
    // Found only once it was over (the daily update brought the outage and the return together): news all the same,
    // except on a site's first check, when it is only history.
    const fresh = group.back ? { ...payload, ...seeded } : payload;
    open("meter_offline", "hardware", key, subject, fresh);
    if (group.back) resolve(key, fresh);
  }
  for (const alert of stored) {
    if (alert.status !== "open" || claimed.has(alert.key)) continue;
    // No longer quiet and no spell found (it came back long ago, or is no longer watched): when it came back, if it did.
    // Readings that later filled the quiet time on time (a meter that sends only when its total moves, and used
    // nothing) mean it never stopped: resolved without a "back" message.
    const before = payloadMeters(alert.payload);
    const backs = before.map((meter) => {
      const back = meterBack(cells.get(meter.id) ?? [], Date.parse(meter.since), timezone);
      return back && Date.parse(back.at) - Date.parse(meter.since) >= HOUR_MS ? back : null;
    });
    const back = backs.length && backs.every(Boolean)
      ? { back: backs.map((item) => item!.at).sort().at(-1)!, filledLateKwh: Math.round(backs.reduce((sum, item) => sum + item!.filledLateKwh, 0) * 1000) / 1000 }
      : { cleared: true };
    resolve(alert.key, { ...alert.payload, ...back });
  }

  // Alerts the live check raised (energy-live-hour-alerts.ts) on hours these readings may now cover. Hours after
  // `coveredTo` are still the live check's to judge; the hours up to it are this check's.
  const coveredTo = readings.referenceMs ?? Number.NEGATIVE_INFINITY;
  const recentLive = (kind: MeterAlertKind) => store.list(projectId, { kind }).filter((alert) => isLive(alert) && Date.parse(String(alert.payload.end ?? "")) >= coveredTo - (NEVER_USED_NEWS_DAYS + 1) * DAY_MS);
  /** Takes over a live alert these readings cover and no episode here continued: kept, or withdrawn quietly. */
  const settleLive = (alert: MeterAlertRecord, verdict: "confirmed" | "refuted" | "unknown") => {
    if (verdict === "refuted") {
      const withdrawn = { ...alert.payload, ongoing: false, withdrawn: true };
      if (alert.status === "open") store.resolve(projectId, alert.key, withdrawn, now);
      else store.update(projectId, alert.key, withdrawn, now);
      return;
    }
    const kept = { ...alert.payload, ...(verdict === "confirmed" ? { confirmed: true } : {}) };
    // Its next hour is covered here too and nothing continued it: it is over.
    if (alert.status === "open" && Date.parse(String(alert.payload.end)) < coveredTo) resolve(alert.key, { ...kept, ongoing: false });
    else store.update(projectId, alert.key, kept, now);
  };
  /** A live alert an episode here continues: these readings speak for the hours they cover, the live check for later ones. */
  const mergeLive = (before: Record<string, unknown>, fresh: Record<string, unknown> & { start: string; end: string; ongoing: boolean }, resolved: boolean) => {
    const beforeEnd = typeof before.end === "string" ? before.end : "";
    const liveTail = beforeEnd > fresh.end;
    const start = typeof before.start === "string" && before.start < fresh.start ? before.start : fresh.start;
    const end = liveTail ? beforeEnd : fresh.end;
    return {
      start, end, hours: Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / HOUR_MS)),
      // Over is over: a later check of older readings does not reopen what the live check saw end.
      ongoing: liveTail || (resolved && beforeEnd >= fresh.end) ? before.ongoing === true : fresh.ongoing,
      live: true, confirmed: true, ...(before.inferred === true ? { inferred: true } : {}),
    };
  };
  const dayTypeOf = dayTypeResolver({ meaning: readings.hoursMeaning, ...(readings.opensOn ? { opensOn: readings.opensOn } : {}) });
  const learned = readings.referenceMs === null ? new Set<string>() : patternLearnedDates(readings.referenceMs, timezone);
  const baselines = new Map<string, Map<string, HourBaseline>>();
  const baselineOf = (meterId: string) => {
    if (!baselines.has(meterId)) baselines.set(meterId, hourlyBaseline(cells.get(meterId) ?? [], learned, dayTypeOf));
    return baselines.get(meterId)!;
  };
  const verdictOf = (alert: MeterAlertRecord) => liveAlertVerdict({ alert, cells: cells.get(alert.subject) ?? [], baseline: baselineOf(alert.subject), dayTypeOf, timezone });

  // ---------- 2. should never use power: the people who run the site
  const seen = new Set<string>();
  const newsFrom = (readings.referenceMs ?? now.getTime()) - NEVER_USED_NEWS_DAYS * DAY_MS;
  const liveNever = recentLive("never_used");
  for (const meter of readings.meters) {
    if (!meter.neverUsed || meter.notInUse) continue;
    for (const episode of neverUsedEpisodes(cells.get(meter.id) ?? [])) {
      const startMs = localHourStartMs(episode.startDate, episode.startHour, timezone);
      const endMs = localHourStartMs(episode.endDate, episode.endHour, timezone);
      const key = `never-used:${shortId(meter.id)}:${compactLocal(startMs, timezone)}`;
      const payload = { meterId: meter.id, meterName: meter.name, start: iso(startMs), end: iso(endMs), hours: episode.hours, totalKwh: episode.totalKwh, peakKwh: episode.peakKwh, ongoing: episode.ongoing };
      // The same episode seen again, or one the live check already raised (it may have started it an hour later).
      const known = store.get(projectId, key) ?? liveNever.find((alert) => alert.subject === meter.id && overlapsOrTouches(alert, startMs, endMs));
      if (!known && !episode.ongoing && endMs < newsFrom) continue;
      seen.add(known?.key ?? key);
      const merged = known && isLive(known)
        ? {
          ...payload, ...mergeLive(known.payload, payload, known.status === "resolved"),
          totalKwh: Math.max(payload.totalKwh, Number(known.payload.totalKwh ?? 0)), peakKwh: Math.max(payload.peakKwh, Number(known.payload.peakKwh ?? 0)),
        }
        : payload;
      // Use that already stopped before a site's first check is shown, not emailed.
      const stored = known ? { ...merged, ...(known.payload.seeded === true ? { seeded: true } : {}) } : episode.ongoing ? payload : { ...payload, ...seeded };
      if (known) store.update(projectId, known.key, stored, now);
      else open("never_used", "operators", key, meter.id, stored);
      if (!stored.ongoing) resolve(known?.key ?? key, stored);
    }
  }
  for (const alert of store.list(projectId, { status: "open", kind: "never_used" })) {
    if (!seen.has(alert.key) && !isLive(alert)) resolve(alert.key, { ...alert.payload, ongoing: false });
  }
  for (const alert of liveNever) {
    if (!seen.has(alert.key) && Date.parse(String(alert.payload.end)) <= coveredTo) settleLive(alert, verdictOf(alert));
  }

  // ---------- 3. unusual hourly use: the people who run the site
  // Today's limit counts the alerts opened today, by the site's own date.
  const day = patternDay(now.getTime(), timezone);
  const { today, dayFrom, dayTo } = day;
  if (input.patternAlerts && readings.referenceMs !== null) {
    const newest = localHourOf(readings.referenceMs - 1, timezone).date;
    const judged = new Set(datesBetween(shiftDate(newest, 1 - PATTERN_DAYS), newest));
    // Meters quiet right now have nothing to judge; the hours of a spell already over are left out as incomplete.
    const offlineIds = new Set(offline.filter((meter) => !meter.back).map((meter) => meter.id));
    const openPattern = store.list(projectId, { status: "open", kind: "usage_pattern" });
    const livePattern = recentLive("usage_pattern");
    let shown = store.countOpened(projectId, "usage_pattern", dayFrom, dayTo, { suppressed: false });
    const touched = new Set<string>();
    let summaryNeeded = false;
    for (const meter of readings.meters) {
      if (meter.notInUse || meter.idleWhenQuiet || meter.neverUsed || offlineIds.has(meter.id)) continue;
      const own = cells.get(meter.id) ?? [];
      const baseline = baselineOf(meter.id);
      if (!baseline.size) continue;
      for (const episode of patternEpisodes({ cells: own, baseline, dates: judged, dayTypeOf, ...(meter.alwaysOn ? { alwaysOn: true } : {}) })) {
        const startMs = localHourStartMs(episode.startDate, episode.startHour, timezone);
        const endMs = localHourStartMs(episode.endDate, episode.endHour, timezone);
        const peakAt = localHourStartMs(episode.peakDate, episode.peakHour, timezone);
        const fresh = { meterId: meter.id, meterName: meter.name, direction: episode.direction, start: iso(startMs), end: iso(endMs), hours: episode.hours, at: iso(peakAt), kwh: episode.kwh, usualKwh: episode.usualKwh, ongoing: episode.ongoing };
        const key = `usage-pattern:${shortId(meter.id)}:${compactLocal(startMs, timezone)}`;
        // The same episode seen again, one still going from before the judged days began, or one the live check
        // already raised on some of these hours (whether or not it has seen it end).
        const continuing = store.get(projectId, key)
          ?? openPattern.find((alert) => alert.subject === meter.id && typeof alert.payload.end === "string" && Date.parse(alert.payload.end) >= startMs
            && !(typeof alert.payload.start === "string" && Date.parse(alert.payload.start) > endMs))
          ?? livePattern.find((alert) => alert.subject === meter.id && overlapsOrTouches(alert, startMs, endMs) && sameSide(alert.payload.direction, episode.direction));
        if (continuing) {
          const before = continuing.payload;
          const keepPeak = typeof before.kwh === "number" && typeof before.usualKwh === "number" && Math.abs(before.kwh - before.usualKwh) > Math.abs(fresh.kwh - fresh.usualKwh);
          const payload = {
            ...fresh,
            start: typeof before.start === "string" && before.start < fresh.start ? before.start : fresh.start,
            ...(isLive(continuing) ? mergeLive(before, fresh, continuing.status === "resolved") : {}),
            ...(keepPeak ? { at: before.at, kwh: before.kwh, usualKwh: before.usualKwh, direction: before.direction } : {}),
            ...(before.suppressed === true ? { suppressed: true } : {}),
            ...(before.seeded === true ? { seeded: true } : {}),
          };
          touched.add(continuing.key);
          store.update(projectId, continuing.key, payload, now);
          if (!payload.ongoing) resolve(continuing.key, payload);
          continue;
        }
        const suppressed = shown >= PATTERN_ALERTS_PER_DAY;
        const payload = { ...fresh, ...(suppressed ? { suppressed: true } : {}), ...seeded };
        touched.add(key);
        if (suppressed) {
          store.open({ projectId, key, kind: "usage_pattern", audience: "operators", subject: meter.id, payload, now });
          summaryNeeded = true;
        } else {
          open("usage_pattern", "operators", key, meter.id, payload);
          shown += 1;
        }
        if (!episode.ongoing) resolve(key, payload);
      }
    }
    for (const alert of openPattern) if (!touched.has(alert.key) && !isLive(alert)) resolve(alert.key, { ...alert.payload, ongoing: false });
    // Live alerts no episode here continued: those on hours these readings cover are kept or withdrawn; later ones
    // are left to the live check.
    for (const alert of livePattern) {
      if (!touched.has(alert.key) && Date.parse(String(alert.payload.end)) <= coveredTo) settleLive(alert, verdictOf(alert));
    }
    // The rest of today's unusual use, in one alert.
    refreshPatternSummary({ store, projectId, day, summaryNeeded, seeded, now, changes });
  } else if (!input.patternAlerts) {
    // Switched off: what was still going is closed, so it does not sit open in the bell.
    for (const alert of store.list(projectId, { status: "open", kind: "usage_pattern" })) resolve(alert.key, { ...alert.payload, ongoing: false });
  }
  // A day's summary is over once the day is, once nothing is left only counted in it, or with the alerts switched off.
  for (const summary of store.list(projectId, { status: "open", kind: "usage_pattern_more" })) {
    const date = typeof summary.payload.date === "string" ? summary.payload.date : "";
    const counted = date === today ? store.countOpened(projectId, "usage_pattern", dayFrom, dayTo, { suppressed: true }) : 0;
    if (!input.patternAlerts || date !== today || counted === 0) resolve(summary.key, summary.payload);
  }
  return changes;
}

/**
 * Everything a check reads, for one site: each meter's settings and last reading, its hourly readings for the last
 * few weeks, and the site's hours. Read under the publication lock, like every other read of published readings.
 */
export async function readMeterAlertReadings(metadataStore: MetadataStore, projectId: string, now: Date): Promise<MeterAlertReadings> {
  const project = metadataStore.energyIq.getProject(projectId);
  const timezone = project.timezone || "UTC";
  return withEnergyProjectPublicationReadLock({ metadataStore, workspaceId: project.workspace_id, projectId }, async () => {
    const snapshot = metadataStore.energyIq.findCurrentDataSnapshot(projectId);
    const hierarchyRevisionId = project.hierarchy_revision_id;
    const empty: MeterAlertReadings = { timezone, meters: [], cells: new Map(), referenceMs: null, hoursMeaning: "opening", dataSnapshotId: snapshot?.id ?? null };
    if (!snapshot || !hierarchyRevisionId) return empty;
    const meterPoints = resolveEnergyPublishedMeterPoints({ metadataStore, projectId, hierarchyRevisionId, resource: "electricity" });
    if (!meterPoints.length) return empty;
    const nowMs = now.getTime();
    const [health, intervals] = await Promise.all([
      readEnergyMeterDataHealth({ metadataStore, workspaceId: project.workspace_id, projectId, dataSnapshotId: snapshot.id, resource: "electricity", meterPoints }),
      readEnergyMeterIntervalCoverage({
        metadataStore, workspaceId: project.workspace_id, projectId, dataSnapshotId: snapshot.id, resource: "electricity",
        meterPointIds: meterPoints.map((point) => point.meterPointId), fromMs: nowMs - (BASELINE_DAYS + PATTERN_DAYS + 2) * DAY_MS, toMs: nowMs,
      }),
    ]);
    const information = buildEnergyProjectInformation(metadataStore, projectId);
    const details = new Map(information.meters.map((meter) => [meter.id, meter]));
    const idle = readIdleWhenQuietMeters({ metadataStore, projectId, now: nowMs });
    const lastOnTime = new Map<string, number>();
    for (const interval of intervals) {
      if (interval.qualityStatus === "ok") lastOnTime.set(interval.meterPointId, Math.max(lastOnTime.get(interval.meterPointId) ?? 0, interval.endMs));
    }
    const healthById = new Map(health.map((row) => [row.meterPointId, row]));
    const meters: MeterAlertInputMeter[] = meterPoints.map((point) => {
      const detail = details.get(point.meterPointId);
      const row = healthById.get(point.meterPointId);
      const fallback = row?.coverageTo ?? row?.readingTo;
      const last = lastOnTime.get(point.meterPointId) ?? (fallback ? Date.parse(fallback) : undefined);
      return {
        id: point.meterPointId,
        name: detail?.name ?? point.sourceLabel,
        ...(detail?.location ? { location: detail.location } : {}),
        ...(detail?.locationId ? { locationId: detail.locationId } : {}),
        ...(detail?.notInUse ? { notInUse: true } : {}),
        ...(detail?.alwaysOn ? { alwaysOn: true } : {}),
        ...(detail?.neverUsed ? { neverUsed: true } : {}),
        ...(idle.has(point.meterPointId) ? { idleWhenQuiet: true } : {}),
        ...(last && Number.isFinite(last) ? { lastReadingAt: iso(last) } : {}),
      };
    });
    const newest = Math.max(0, ...meters.filter((meter) => !meter.notInUse && meter.lastReadingAt).map((meter) => Date.parse(meter.lastReadingAt!)));
    // A daily update that asked for readings up to its window's end and found none for a meter says it is quiet too.
    const watermark = metadataStore.energyIq.sourceSync.findState({ project_id: projectId, source_kind: "tuya" })?.watermark_ms ?? 0;
    const referenceMs = newest > 0 ? Math.min(nowMs, Math.max(newest, watermark)) : null;
    const calendar = publishedCalendar(metadataStore, projectId);
    const referenceDate = localHourOf(referenceMs ?? nowMs, timezone).date;
    const own = (calendar?.entries ?? []).filter((entry) => entry.owner.kind === "project");
    return {
      timezone, meters, cells: hourlyCellsFromIntervals(intervals, timezone), referenceMs,
      hoursMeaning: lightsOnHoursOn(own, referenceDate) ? "lights_on" : "opening",
      ...(own.length ? { opensOn: (date: string) => opensOn(own, date) } : {}),
      dataSnapshotId: snapshot.id,
    };
  });
}

type CalendarEntry = { owner: { kind: string }; effective_from: string; effective_to?: string; weekly: Record<string, Array<{ from: string; to: string }>>; exceptions?: Array<{ date: string; operating: unknown[] }>; hours_meaning?: string };
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
/** Whether the site opens on a date: a day off or a holiday in its calendar closes it; otherwise its weekly hours say. */
const opensOn = (entries: readonly CalendarEntry[], date: string): boolean => {
  const entry = entries.find((item) => item.effective_from <= date && (!item.effective_to || date < item.effective_to));
  if (!entry) return new Date(`${date}T00:00:00Z`).getUTCDay() % 6 !== 0;
  const exception = entry.exceptions?.find((item) => item.date === date);
  if (exception) return exception.operating.length > 0;
  return (entry.weekly[WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]!] ?? []).length > 0;
};

/** The calendar the published site uses (as readIdleWhenQuietMeters reads it); null without one. */
const publishedCalendar = (metadataStore: MetadataStore, projectId: string): { entries: CalendarEntry[] } | null => {
  const project = metadataStore.energyIq.getProject(projectId);
  const published = metadataStore.energyIq.templates.getLatestProjectRevision(projectId);
  const version = published ? published.business_calendar_version : project.business_calendar_version;
  if (!version) return null;
  try {
    return metadataStore.energyIq.operationalPolicy.getOperatingCalendar(version) as unknown as { entries: CalendarEntry[] };
  } catch {
    return null;
  }
};

// ---------------------------------------------------------------- emails

const formatTime = (value: string, timezone: string): string =>
  new Date(value).toLocaleString("en-SG", { timeZone: timezone, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const formatClock = (value: string, timezone: string): string =>
  new Date(value).toLocaleTimeString("en-SG", { timeZone: timezone, hour: "numeric", minute: "2-digit" });
/** A span of whole hours, such as "2–3 pm" (with plain spaces: Intl puts narrow ones before "pm"). */
const formatWindow = (from: string, to: string, timezone: string): string =>
  new Intl.DateTimeFormat("en-SG", { timeZone: timezone, hour: "numeric" }).formatRange(new Date(from), new Date(to)).replace(/[\u2009\u202f]/gu, " ");
const formatDay = (value: string, timezone: string): string =>
  new Date(value).toLocaleDateString("en-SG", { timeZone: timezone, weekday: "short", day: "numeric", month: "short" });
const LIVE_NOTE = "Seen within the hour from the live meter readings. The daily update checks it again, and withdraws it if the full readings disagree.";
const kw = (value: number): string => `${new Intl.NumberFormat("en-SG", { maximumFractionDigits: value < 1 ? 2 : 1, minimumFractionDigits: value < 1 ? 2 : 1 }).format(value)} kW`;
const kwh = (value: number): string => `${new Intl.NumberFormat("en-SG", { maximumFractionDigits: value < 1 ? 2 : 1, minimumFractionDigits: value < 1 ? 2 : 1 }).format(value)} kWh`;

/** The email for an alert that opened, or (`back`) for meters that are sending again. English, like the other alert emails. */
export function meterAlertEmail(input: { site: string; timezone: string; alert: MeterAlertRecord; back?: boolean; link: string }): AlertEmail | null {
  const { site, timezone, alert } = input;
  const payload = alert.payload;
  if (alert.kind === "meter_offline") {
    const meters = payloadMeters(payload);
    if (!meters.length) return null;
    const since = String(payload.since ?? meters[0]!.since);
    const area = typeof payload.location === "string" ? payload.location : "";
    if (input.back) {
      if (typeof payload.back !== "string") return null;
      const filled = Number(payload.filledLateKwh ?? 0) > 0 ? "; readings sent late were filled in" : "";
      const who = meters.length === 1 ? meters[0]!.name : `${meters.length} meters${area ? ` in ${area}` : ""}`;
      return {
        key: `${alert.key}:back`,
        subject: `${site}: ${who} ${meters.length === 1 ? "is" : "are"} sending readings again`,
        text: [
          `${who} stopped sending readings at ${formatTime(since, timezone)}${meters.length > 1 ? " (most likely their gateway)" : ""} and ${meters.length === 1 ? "is" : "are"} back since ${formatTime(payload.back, timezone)}${filled}.`,
          ...(meters.length > 1 ? ["", ...meters.map((meter) => `- ${meter.name}`)] : []),
          "",
          "Nothing more to do unless it happens again.",
        ].join("\n") + input.link,
      };
    }
    if (meters.length === 1) {
      return {
        key: alert.key,
        subject: `${site}: ${meters[0]!.name} has stopped sending readings`,
        text: [
          `${meters[0]!.name} has stopped sending readings since ${formatTime(since, timezone)}.`,
          "",
          "Its use is missing from the figures until it reports again. Worth checking: whether it still has power, and whether its gateway or Wi-Fi is online.",
        ].join("\n") + input.link,
      };
    }
    return {
      key: alert.key,
      subject: `${site}: ${meters.length} meters${area ? ` in ${area}` : ""} stopped sending at ${formatClock(since, timezone)}`,
      text: [
        `${meters.length} meters${area ? ` in ${area}` : ""} stopped sending readings at ${formatTime(since, timezone)}, within an hour of each other — most likely their gateway.`,
        "",
        ...meters.map((meter) => `- ${meter.name}: last reading ${formatTime(meter.since, timezone)}`),
        "",
        "Worth checking first: whether the gateway still has power and is online.",
      ].join("\n") + input.link,
    };
  }
  if (alert.kind === "never_used") {
    const name = String(payload.meterName ?? "A meter");
    const start = String(payload.start ?? alert.openedAt);
    const total = Number(payload.totalKwh ?? 0);
    const hours = Number(payload.hours ?? 1);
    return {
      key: alert.key,
      subject: `${site}: ${name} used power — it should never use power`,
      text: [
        `${name} used ${kwh(total)} at ${formatTime(start, timezone)} — it should never use power.${hours > 1 ? ` It kept using power for ${hours} hours from then.` : ""}`,
        ...(payload.live === true ? ["", LIVE_NOTE] : []),
        "",
        "Someone may be using it without leave. Worth checking who has access to it.",
      ].join("\n") + input.link,
    };
  }
  if (alert.kind === "usage_pattern" && payload.live === true) {
    // Seen within the hour: the hour (or, for use that stopped, the hours) and the day.
    const name = String(payload.meterName ?? "A meter");
    const start = String(payload.start ?? alert.openedAt);
    const at = String(payload.at ?? start);
    const value = Number(payload.kwh ?? 0), usual = Number(payload.usualKwh ?? 0);
    const zero = payload.direction === "zero";
    const from = zero ? start : at;
    const to = zero && typeof payload.end === "string" ? payload.end : iso(Date.parse(from) + HOUR_MS);
    const when = `${formatWindow(from, to, timezone)} on ${formatDay(from, timezone)}`;
    const line = zero
      ? `${name} used nothing ${when} (usually ${kw(usual)}).`
      : payload.direction === "low"
        ? `${name} used only ${kw(value)} ${when}, usually about ${kw(usual)}.`
        : `${name} used ${kw(value)} ${when}, usually about ${kw(usual)}.`;
    return {
      key: alert.key,
      subject: `${site}: unusual use on ${name}, ${formatWindow(from, to, timezone)}`,
      text: [line, "", LIVE_NOTE, "", "Usual is that hour's typical use over the last three weeks. Worth checking what was running, or what was switched off."].join("\n") + input.link,
    };
  }
  if (alert.kind === "usage_pattern") {
    const name = String(payload.meterName ?? "A meter");
    const at = String(payload.at ?? payload.start ?? alert.openedAt);
    const value = Number(payload.kwh ?? 0), usual = Number(payload.usualKwh ?? 0);
    const line = payload.direction === "zero"
      ? `${name} dropped to 0 at ${formatTime(at, timezone)} (usually ${kw(usual)}).`
      : payload.direction === "low"
        ? `${name} used only ${kw(value)} at ${formatTime(at, timezone)}, usually about ${kw(usual)}.`
        : `${name} used ${kw(value)} at ${formatTime(at, timezone)}, usually about ${kw(usual)}.`;
    return {
      key: alert.key,
      subject: `${site}: unusual use on ${name}`,
      text: [line, "", "Usual is that hour's typical use over the last three weeks. Worth checking what was running, or what was switched off."].join("\n") + input.link,
    };
  }
  if (alert.kind === "usage_pattern_more") {
    const names = Array.isArray(payload.names) ? (payload.names as unknown[]).map(String) : [];
    return {
      key: alert.key,
      subject: `${site}: unusual use on more meters today`,
      text: `${Number(payload.count ?? 0)} more meters had unusual use today${names.length ? `: ${names.join(", ")}` : ""}. Open the alerts in EnergyX to see each one.` + input.link,
    };
  }
  return null;
}

export type MeterAlertRun = { checked: boolean; opened: MeterAlertRecord[]; resolved: MeterAlertRecord[]; emailed: string[]; emailFailures: number };

/** An email still unsent after this long is not news any more: it is left in the outbox, unsent, for the record. */
export const EMAIL_MAX_AGE_MS = 2 * DAY_MS;
type Send = (message: { to: string[]; subject: string; text: string }) => Promise<void>;

/**
 * Checks one site if it has new readings since its last check (or was last checked over three hours ago), then sends
 * whatever is waiting in its outbox. The alerts, the check and the emails about them are saved in one transaction, so
 * an email that cannot be sent is tried again at the next hourly check (for up to two days) rather than lost. `send`
 * is given only when mail is configured; emails also need ENERGYIQ_ALERT_EMAILS_ENABLED=true, and none are written
 * while they are off.
 */
export async function runMeterAlerts(input: {
  metadataStore: MetadataStore;
  projectId: string;
  now: Date;
  env?: Record<string, string | undefined>;
  send?: Send;
  publicBaseUrl?: string;
  read?: (metadataStore: MetadataStore, projectId: string, now: Date) => Promise<MeterAlertReadings>;
  force?: boolean;
}): Promise<MeterAlertRun> {
  const env = input.env ?? process.env;
  const store = new MeterAlertStore(input.metadataStore.db);
  const emailsOn = Boolean(input.send) && env.ENERGYIQ_ALERT_EMAILS_ENABLED?.trim() === "true";
  const drain = async (run: Omit<MeterAlertRun, "emailed" | "emailFailures">): Promise<MeterAlertRun> => {
    const sent = emailsOn ? await drainMeterAlertEmails({ metadataStore: input.metadataStore, projectId: input.projectId, store, send: input.send!, env, now: input.now }) : { emailed: [], failures: 0 };
    return { ...run, emailed: sent.emailed, emailFailures: sent.failures };
  };
  const snapshotId = input.metadataStore.energyIq.findCurrentDataSnapshot(input.projectId)?.id ?? null;
  const last = store.lastCheck(input.projectId);
  if (!input.force && last && (last.dataSnapshotId ?? null) === snapshotId && input.now.getTime() - Date.parse(last.checkedAt) < RECHECK_MS) {
    return drain({ checked: false, opened: [], resolved: [] });
  }
  const readings = await (input.read ?? readMeterAlertReadings)(input.metadataStore, input.projectId, input.now);
  // Nothing to judge (no published readings or setup right now): leave every alert as it is rather than resolve
  // the open ones and raise them again once the readings are back.
  if (!readings.meters.length || readings.referenceMs === null) return drain({ checked: false, opened: [], resolved: [] });
  const project = input.metadataStore.energyIq.getProject(input.projectId);
  const changes = store.transaction(() => {
    // Asked again inside the transaction: a check that started at the same time (the API restarting during a deploy)
    // may have recorded the site's first check while this one was reading.
    const firstCheck = !store.lastCheck(input.projectId);
    const found = evaluateMeterAlerts({ store, projectId: input.projectId, readings, patternAlerts: store.getSettings(input.projectId).patternAlerts, now: input.now, firstCheck });
    store.recordCheck(input.projectId, readings.dataSnapshotId ?? snapshotId, input.now);
    if (emailsOn) {
      for (const email of meterAlertEmails({ changes: found, site: project.name, timezone: readings.timezone, projectId: input.projectId, ...(input.publicBaseUrl ? { publicBaseUrl: input.publicBaseUrl } : {}) })) {
        store.enqueueEmail({ projectId: input.projectId, key: email.key, audience: email.audience, subject: email.subject, text: email.text, now: input.now });
      }
    }
    return found;
  });
  return drain({ checked: true, ...changes });
}

/**
 * The emails a check's changes call for: one for each alert that opened, and for meters sending again. Not for unusual
 * use only counted in a summary, nor for anything recorded at a site's first check (`seeded`); an outage found only
 * once it was over gets the one "back" email, which says both.
 */
export function meterAlertEmails(input: { changes: MeterAlertChanges; site: string; timezone: string; projectId: string; publicBaseUrl?: string }): Array<AlertEmail & { audience: MeterAlertAudience }> {
  const base = input.publicBaseUrl?.replace(/\/$/u, "") ?? "";
  const link = (path: string, extra: Record<string, string> = {}) => base ? `\n\nOpen in EnergyX: ${base}${path}?${new URLSearchParams({ projectId: input.projectId, ...extra })}` : "";
  const facility = link("/energyiq/project-configuration", { tab: "availability" });
  const quiet = (alert: MeterAlertRecord) => alert.payload.suppressed === true || alert.payload.seeded === true;
  const resolvedNow = new Set(input.changes.resolved.map((alert) => alert.key));
  const emails: Array<AlertEmail & { audience: MeterAlertAudience }> = [];
  for (const alert of input.changes.opened) {
    if (quiet(alert) || (alert.kind === "meter_offline" && resolvedNow.has(alert.key))) continue;
    const email = meterAlertEmail({ site: input.site, timezone: input.timezone, alert, link: alert.kind === "meter_offline" ? facility : link("/energyiq/analysis") });
    if (email) emails.push({ ...email, audience: alert.audience });
  }
  for (const alert of input.changes.resolved) {
    if (alert.kind !== "meter_offline" || quiet(alert)) continue;
    const email = meterAlertEmail({ site: input.site, timezone: input.timezone, alert, back: true, link: facility });
    if (email) emails.push({ ...email, audience: "hardware" });
  }
  return emails;
}

/** Each site's outbox being sent right now, so two checks (the hourly one and the live one) take turns. */
const draining = new Map<string, Promise<unknown>>();

/**
 * Sends a site's waiting emails, oldest first, each on its own: one that fails is recorded and tried again at the next
 * check, and never stops the rest. Recipients are worked out at sending time; with nobody to send to, an email waits.
 * Two checks of one site never send at once: the second waits for the first, then finds its emails already sent.
 */
export async function drainMeterAlertEmails(input: {
  metadataStore: MetadataStore; projectId: string; store: MeterAlertStore; send: Send; env: Record<string, string | undefined>; now: Date;
}): Promise<{ emailed: string[]; failures: number }> {
  const run = (draining.get(input.projectId) ?? Promise.resolve()).catch(() => undefined).then(() => drainNow(input));
  draining.set(input.projectId, run);
  try {
    return await run;
  } finally {
    if (draining.get(input.projectId) === run) draining.delete(input.projectId);
  }
}

async function drainNow(input: {
  metadataStore: MetadataStore; projectId: string; store: MeterAlertStore; send: Send; env: Record<string, string | undefined>; now: Date;
}): Promise<{ emailed: string[]; failures: number }> {
  const pending = input.store.pendingEmails(input.projectId, new Date(input.now.getTime() - EMAIL_MAX_AGE_MS).toISOString());
  if (!pending.length) return { emailed: [], failures: 0 };
  const recipients = new Map<MeterAlertAudience, string[]>();
  const to = (audience: MeterAlertAudience) => {
    if (!recipients.has(audience)) {
      recipients.set(audience, audience === "hardware"
        ? hardwareAlertRecipients(input.metadataStore, input.projectId, input.store.getSettings(input.projectId).hardwareEmails, input.env)
        : operatorAlertRecipients(input.metadataStore, input.projectId, input.env));
    }
    return recipients.get(audience)!;
  };
  const emailed: string[] = [];
  let failures = 0;
  for (const email of pending) {
    const list = to(email.audience);
    if (!list.length) continue;
    try {
      await input.send({ to: list, subject: email.subject, text: email.text });
      input.store.markEmailSent(input.projectId, email.key, input.now);
      emailed.push(email.key);
    } catch (error) {
      failures += 1;
      input.store.markEmailFailed(input.projectId, email.key, error instanceof Error ? error.message : "unknown", input.now);
      log.warn("email-failed", { project_id: input.projectId, alert: email.key.split(":")[0], attempts: email.attempts + 1 });
    }
  }
  return { emailed, failures };
}
