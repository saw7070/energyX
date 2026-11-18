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
 */
import { readEnergyMeterDataHealth, readEnergyMeterIntervalCoverage } from "@datafoundry/data-gateway";
import type { MetadataStore } from "@datafoundry/metadata";

import { sendPendingAlertEmails, type AlertEmail } from "./energy-alert-emails.js";
import { lightsOnHoursOn, readIdleWhenQuietMeters } from "./energy-idle-meters.js";
import {
  BASELINE_DAYS,
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
  neverUsedEpisodes,
  patternEpisodes,
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
const compactLocal = (ms: number, timezone: string): string => {
  const { date, hour } = localHourOf(ms, timezone);
  const minute = new Date(ms).getUTCMinutes();
  return `${date.replaceAll("-", "")}T${String(hour).padStart(2, "0")}${String(minute).padStart(2, "0")}`;
};
const shiftDate = (date: string, days: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const iso = (ms: number) => new Date(ms).toISOString();

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
 */
export function evaluateMeterAlerts(input: { store: MeterAlertStore; projectId: string; readings: MeterAlertReadings; patternAlerts: boolean; now: Date }): MeterAlertChanges {
  const { store, projectId, readings, now } = input;
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
      if (known.status === "open" && group.back) resolve(known.key, payload);
      else if (known.status === "open" || group.back) store.update(projectId, known.key, payload, now);
      // Quiet again from the same time: the readings that said it was back are gone.
      else open("meter_offline", "hardware", known.key, known.subject, payload);
      continue;
    }
    const subject = group.locationId && group.meters.length > 1 ? group.locationId : group.meters[0]!.id;
    const key = `meter-offline:${shortId(subject)}:${compactLocal(Date.parse(group.since), timezone)}`;
    open("meter_offline", "hardware", key, subject, payload);
    // Found only once it was over (the daily update brought the outage and the return together): news all the same.
    if (group.back) resolve(key, payload);
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

  // ---------- 2. should never use power: the people who run the site
  const seen = new Set<string>();
  const newsFrom = (readings.referenceMs ?? now.getTime()) - NEVER_USED_NEWS_DAYS * DAY_MS;
  for (const meter of readings.meters) {
    if (!meter.neverUsed || meter.notInUse) continue;
    for (const episode of neverUsedEpisodes(cells.get(meter.id) ?? [])) {
      const startMs = localHourStartMs(episode.startDate, episode.startHour, timezone);
      const endMs = localHourStartMs(episode.endDate, episode.endHour, timezone);
      const key = `never-used:${shortId(meter.id)}:${compactLocal(startMs, timezone)}`;
      const payload = { meterId: meter.id, meterName: meter.name, start: iso(startMs), end: iso(endMs), hours: episode.hours, totalKwh: episode.totalKwh, peakKwh: episode.peakKwh, ongoing: episode.ongoing };
      const known = store.get(projectId, key);
      if (!known && !episode.ongoing && endMs < newsFrom) continue;
      seen.add(key);
      if (known) store.update(projectId, key, payload, now);
      else open("never_used", "operators", key, meter.id, payload);
      if (!episode.ongoing) resolve(key, payload);
    }
  }
  for (const alert of store.list(projectId, { status: "open", kind: "never_used" })) {
    if (!seen.has(alert.key)) resolve(alert.key, { ...alert.payload, ongoing: false });
  }

  // ---------- 3. unusual hourly use: the people who run the site
  if (input.patternAlerts && readings.referenceMs !== null) {
    const newest = localHourOf(readings.referenceMs - 1, timezone).date;
    const judged = new Set(datesBetween(shiftDate(newest, 1 - PATTERN_DAYS), newest));
    const learned = new Set(datesBetween(shiftDate(newest, -PATTERN_DAYS - BASELINE_DAYS + 1), shiftDate(newest, -PATTERN_DAYS)));
    const dayTypeOf = dayTypeResolver({ meaning: readings.hoursMeaning, ...(readings.opensOn ? { opensOn: readings.opensOn } : {}) });
    // Meters quiet right now have nothing to judge; the hours of a spell already over are left out as incomplete.
    const offlineIds = new Set(offline.filter((meter) => !meter.back).map((meter) => meter.id));
    const openPattern = store.list(projectId, { status: "open", kind: "usage_pattern" });
    // Today's limit counts the alerts opened today, by the site's own date.
    const today = localHourOf(now.getTime(), timezone).date;
    const dayFrom = iso(localHourStartMs(today, 0, timezone)), dayTo = iso(localHourStartMs(shiftDate(today, 1), 0, timezone));
    let shown = store.countOpened(projectId, "usage_pattern", dayFrom, dayTo, (record) => record.payload.suppressed !== true);
    const touched = new Set<string>();
    let summaryNeeded = false;
    for (const meter of readings.meters) {
      if (meter.notInUse || meter.idleWhenQuiet || meter.neverUsed || offlineIds.has(meter.id)) continue;
      const own = cells.get(meter.id) ?? [];
      const baseline = hourlyBaseline(own, learned, dayTypeOf);
      if (!baseline.size) continue;
      for (const episode of patternEpisodes({ cells: own, baseline, dates: judged, dayTypeOf, ...(meter.alwaysOn ? { alwaysOn: true } : {}) })) {
        const startMs = localHourStartMs(episode.startDate, episode.startHour, timezone);
        const endMs = localHourStartMs(episode.endDate, episode.endHour, timezone);
        const peakAt = localHourStartMs(episode.peakDate, episode.peakHour, timezone);
        const fresh = { meterId: meter.id, meterName: meter.name, direction: episode.direction, start: iso(startMs), end: iso(endMs), hours: episode.hours, at: iso(peakAt), kwh: episode.kwh, usualKwh: episode.usualKwh, ongoing: episode.ongoing };
        const key = `usage-pattern:${shortId(meter.id)}:${compactLocal(startMs, timezone)}`;
        // The same episode seen again, or one still going from before the judged days began.
        const continuing = store.get(projectId, key)
          ?? openPattern.find((alert) => alert.subject === meter.id && typeof alert.payload.end === "string" && Date.parse(alert.payload.end) >= startMs);
        if (continuing) {
          const before = continuing.payload;
          const keepPeak = typeof before.kwh === "number" && typeof before.usualKwh === "number" && Math.abs(before.kwh - before.usualKwh) > Math.abs(fresh.kwh - fresh.usualKwh);
          const payload = {
            ...fresh,
            start: typeof before.start === "string" && before.start < fresh.start ? before.start : fresh.start,
            ...(keepPeak ? { at: before.at, kwh: before.kwh, usualKwh: before.usualKwh, direction: before.direction } : {}),
            ...(before.suppressed === true ? { suppressed: true } : {}),
          };
          touched.add(continuing.key);
          store.update(projectId, continuing.key, payload, now);
          if (!episode.ongoing) resolve(continuing.key, payload);
          continue;
        }
        const suppressed = shown >= PATTERN_ALERTS_PER_DAY;
        const payload = suppressed ? { ...fresh, suppressed: true } : fresh;
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
    for (const alert of openPattern) if (!touched.has(alert.key)) resolve(alert.key, { ...alert.payload, ongoing: false });
    // The rest of today's unusual use, in one alert.
    const hidden = store.list(projectId, { kind: "usage_pattern" }).filter((record) => record.payload.suppressed === true && record.openedAt >= dayFrom && record.openedAt < dayTo);
    if (summaryNeeded || hidden.length) {
      const summaryKey = `usage-pattern-more:${today.replaceAll("-", "")}`;
      const payload = { date: today, count: hidden.length, names: [...new Set(hidden.map((record) => String(record.payload.meterName ?? "")))].filter(Boolean).slice(0, 10) };
      if (store.get(projectId, summaryKey)) store.update(projectId, summaryKey, payload, now);
      else if (hidden.length) open("usage_pattern_more", "operators", summaryKey, "site", payload);
    }
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
        "",
        "Someone may be using it without leave. Worth checking who has access to it.",
      ].join("\n") + input.link,
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

export type MeterAlertRun = { checked: boolean; opened: MeterAlertRecord[]; resolved: MeterAlertRecord[]; emailed: string[] };

/**
 * Checks one site if it has new readings since its last check (or was last checked over three hours ago), and emails
 * whatever opened or came back. `send` is given only when mail is configured; emails also need
 * ENERGYIQ_ALERT_EMAILS_ENABLED=true.
 */
export async function runMeterAlerts(input: {
  metadataStore: MetadataStore;
  projectId: string;
  now: Date;
  env?: Record<string, string | undefined>;
  send?: (message: { to: string[]; subject: string; text: string }) => Promise<void>;
  publicBaseUrl?: string;
  read?: (metadataStore: MetadataStore, projectId: string, now: Date) => Promise<MeterAlertReadings>;
  force?: boolean;
}): Promise<MeterAlertRun> {
  const env = input.env ?? process.env;
  const store = new MeterAlertStore(input.metadataStore.db);
  const snapshotId = input.metadataStore.energyIq.findCurrentDataSnapshot(input.projectId)?.id ?? null;
  const last = store.lastCheck(input.projectId);
  if (!input.force && last && (last.dataSnapshotId ?? null) === snapshotId && input.now.getTime() - Date.parse(last.checkedAt) < RECHECK_MS) {
    return { checked: false, opened: [], resolved: [], emailed: [] };
  }
  const readings = await (input.read ?? readMeterAlertReadings)(input.metadataStore, input.projectId, input.now);
  const changes = evaluateMeterAlerts({ store, projectId: input.projectId, readings, patternAlerts: store.getSettings(input.projectId).patternAlerts, now: input.now });
  store.recordCheck(input.projectId, readings.dataSnapshotId ?? snapshotId, input.now);
  const emailed = input.send && env.ENERGYIQ_ALERT_EMAILS_ENABLED?.trim() === "true"
    ? await emailMeterAlerts({ ...input, env, send: input.send, store, changes, timezone: readings.timezone })
    : [];
  return { checked: true, ...changes, emailed };
}

const emailMeterAlerts = async (input: {
  metadataStore: MetadataStore; projectId: string; env: Record<string, string | undefined>; publicBaseUrl?: string; store: MeterAlertStore;
  changes: MeterAlertChanges; timezone: string; send: (message: { to: string[]; subject: string; text: string }) => Promise<void>;
}): Promise<string[]> => {
  const project = input.metadataStore.energyIq.getProject(input.projectId);
  const base = input.publicBaseUrl?.replace(/\/$/u, "") ?? "";
  const link = (path: string, extra: Record<string, string> = {}) => base ? `\n\nOpen in EnergyX: ${base}${path}?${new URLSearchParams({ projectId: input.projectId, ...extra })}` : "";
  const hardware: AlertEmail[] = [];
  const operators: AlertEmail[] = [];
  const resolvedNow = new Set(input.changes.resolved.map((alert) => alert.key));
  for (const alert of input.changes.opened) {
    // Unusual use past today's limit is only counted; an outage found once it was over gets the one "back" email below.
    if (alert.payload.suppressed === true || (alert.kind === "meter_offline" && resolvedNow.has(alert.key))) continue;
    const email = meterAlertEmail({
      site: project.name, timezone: input.timezone, alert,
      link: alert.kind === "meter_offline" ? link("/energyiq/project-configuration", { tab: "availability" }) : link("/energyiq/analysis"),
    });
    if (email) (alert.audience === "hardware" ? hardware : operators).push(email);
  }
  for (const alert of input.changes.resolved) {
    if (alert.kind !== "meter_offline") continue;
    const email = meterAlertEmail({ site: project.name, timezone: input.timezone, alert, back: true, link: link("/energyiq/project-configuration", { tab: "availability" }) });
    if (email) hardware.push(email);
  }
  const sent: string[] = [];
  if (hardware.length) {
    sent.push(...await sendPendingAlertEmails({
      metadataStore: input.metadataStore, projectId: input.projectId, emails: hardware, send: input.send,
      recipients: hardwareAlertRecipients(input.metadataStore, input.projectId, input.store.getSettings(input.projectId).hardwareEmails, input.env),
    }));
  }
  if (operators.length) {
    sent.push(...await sendPendingAlertEmails({
      metadataStore: input.metadataStore, projectId: input.projectId, emails: operators, send: input.send,
      recipients: operatorAlertRecipients(input.metadataStore, input.projectId, input.env),
    }));
  }
  return sent;
};
