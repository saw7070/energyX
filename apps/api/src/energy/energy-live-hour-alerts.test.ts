import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { ensureEnergyIqBootstrap } from "./energy-bootstrap.js";
import {
  createEnergyLiveHourAlerts,
  evaluateLiveHourAlerts,
  LIVE_REPORT_SLOT_MS,
  liveAnchors,
  measureLiveHour,
  runLiveHourAlerts,
  type LiveHourCell,
} from "./energy-live-hour-alerts.js";
import { createEnergyLiveReadingsPoller, pollLiveReadings } from "./energy-live-readings.js";
import { readLiveSamples, type LiveSample } from "./energy-live-samples.js";
import type { HourCell, MeterAlertInputMeter } from "./energy-meter-alert-rules.js";
import { MeterAlertStore } from "./energy-meter-alert-store.js";
import { evaluateMeterAlerts, meterAlertEmail, meterAlertEmails, type MeterAlertReadings } from "./energy-meter-alerts.js";
import { readSiteAlerts } from "./energy-site-alerts.js";
import type { EnergyTuyaProjectConnector } from "./energy-tuya-connector.js";
import { TUYA_OFFICE_PROJECT_ID as PROJECT, TUYA_OFFICE_WORKSPACE_ID as WORKSPACE } from "./tuya-office-project.js";

const TZ = "Asia/Singapore";
const HOUR = 3_600_000;
const MIN = 60_000;
/** A Singapore local time, "YYYY-MM-DDTHH:mm". */
const sg = (local: string) => Date.parse(`${local}:00+08:00`);
const isoAt = (local: string) => new Date(sg(local)).toISOString();

function hours(from: string, to: string, make: (date: string, hour: number) => HourCell | null): HourCell[] {
  const cells: HourCell[] = [];
  for (let at = sg(`${from}:00`); at < sg(`${to}:00`); at += HOUR) {
    const local = new Date(at + 8 * HOUR).toISOString();
    const cell = make(local.slice(0, 10), Number(local.slice(11, 13)));
    if (cell) cells.push(cell);
  }
  return cells;
}

type FixtureMeter = { id: string; name: string; usual: number; neverUsed?: boolean; alwaysOn?: boolean };
/**
 * A lights-on site's daily readings up to `through` (local hour, exclusive): each meter uses `usual` kWh every hour
 * since 20 Oct, except the hours `override` gives.
 */
const daily = (input: { through: string; meters: FixtureMeter[]; override?: (meterId: string, date: string, hour: number) => HourCell | undefined }): MeterAlertReadings => ({
  timezone: TZ,
  referenceMs: sg(`${input.through}:00`),
  hoursMeaning: "lights_on",
  meters: input.meters.map((meter): MeterAlertInputMeter => ({
    id: meter.id, name: meter.name, lastReadingAt: isoAt(`${input.through}:00`),
    ...(meter.neverUsed ? { neverUsed: true } : {}), ...(meter.alwaysOn ? { alwaysOn: true } : {}),
  })),
  cells: new Map(input.meters.map((meter) => [meter.id, hours("2026-10-20T00", input.through, (date, hour) =>
    input.override?.(meter.id, date, hour) ?? [date, hour, meter.neverUsed ? 0 : meter.usual, 60, 0, 0])])),
});

/** Hours measured from live readings: [local hour "YYYY-MM-DDTHH", kWh, inferred from an online quiet meter]. */
const live = (entries: Record<string, Array<[string, number, boolean?]>>): Map<string, LiveHourCell[]> =>
  new Map(Object.entries(entries).map(([id, list]) => [id, list.map(([local, kwh, inferred]) => ({
    startMs: sg(`${local}:00`), date: local.slice(0, 10), hour: Number(local.slice(11, 13)), kwh, inferred: inferred === true,
  }))]));

const PAVILION: FixtureMeter = { id: "pavilion-1", name: "Pavilion 1", usual: 0.4, alwaysOn: true };

const withMetadata = async (run: (metadata: ReturnType<typeof createMetadataStore>, store: MeterAlertStore) => void | Promise<void>): Promise<void> => {
  const root = mkdtempSync(join(tmpdir(), "energy-live-hour-alerts-"));
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  try {
    ensureEnergyIqBootstrap(metadata);
    await run(metadata, new MeterAlertStore(metadata.db));
  } finally {
    metadata.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};

const bell = (metadata: ReturnType<typeof createMetadataStore>, now: Date) =>
  readSiteAlerts({ metadataStore: metadata, projectId: PROJECT, userId: "reader", includeReports: true, includeSync: false, includeHardware: false, now: now.getTime() }).meterAlerts;

// ---------------------------------------------------------------- measuring an hour from running totals

/** What 15-minute live checks from `from` to `to` see of a meter that sent `reports` ([local time, total]). */
const polls = (input: { from: string; to: string; reports: Array<[string, number]>; online?: (at: number) => boolean | undefined; skip?: (at: number) => boolean }): LiveSample[] => {
  const samples: LiveSample[] = [];
  for (let at = sg(input.from); at <= sg(input.to); at += 15 * MIN) {
    if (input.skip?.(at)) continue;
    const latest = input.reports.filter(([time]) => sg(time) <= at).at(-1);
    if (!latest) continue;
    const online = input.online ? input.online(at) : true;
    samples.push({ polledAt: at, energyKwh: latest[1], reportedAt: sg(latest[0]), ...(online === undefined ? {} : { online }) });
  }
  return samples;
};
const hourOf = (samples: LiveSample[], local: string) => {
  const { anchors, offlineAt } = liveAnchors(samples);
  return measureLiveHour({ anchors, offlineAt, startMs: sg(local), endMs: sg(local) + HOUR });
};
const HOURLY: Array<[string, number]> = [["2026-11-18T12:40", 100], ["2026-11-18T13:40", 100.4], ["2026-11-18T14:40", 100.8], ["2026-11-18T15:40", 101.2]];

describe("Live hourly use: measuring an hour from running totals", () => {
  it("spreads use between the values a meter sent, by the time it sent them, once a value after the hour is in", () => {
    // Before the 3:40 pm value arrives, nothing after 3 pm is known: 2–3 pm waits.
    expect(hourOf(polls({ from: "2026-11-18T12:00", to: "2026-11-18T15:30", reports: HOURLY }), "2026-11-18T14:00")).toEqual({ kwh: null, reason: "waiting" });
    expect(hourOf(polls({ from: "2026-11-18T12:00", to: "2026-11-18T15:45", reports: HOURLY }), "2026-11-18T14:00")).toEqual({ kwh: 0.4, inferred: false });
  });

  it("measures a meter that went quiet while online as using nothing, once it has been quiet past its report slot", () => {
    // The emergency light failed after its 1:40 pm value; Tuya still has the meter online.
    const quiet: Array<[string, number]> = HOURLY.slice(0, 2);
    expect(LIVE_REPORT_SLOT_MS).toBe(70 * MIN);
    expect(hourOf(polls({ from: "2026-11-18T12:00", to: "2026-11-18T16:00", reports: quiet }), "2026-11-18T14:00")).toEqual({ kwh: null, reason: "waiting" });
    expect(hourOf(polls({ from: "2026-11-18T12:00", to: "2026-11-18T16:15", reports: quiet }), "2026-11-18T14:00")).toEqual({ kwh: 0, inferred: true });
    // Not when Tuya had it offline, nor when the status check failed (unknown): quiet then may just be no connection.
    expect(hourOf(polls({ from: "2026-11-18T12:00", to: "2026-11-18T18:00", reports: quiet, online: (at) => at < sg("2026-11-18T14:00") }), "2026-11-18T14:00").kwh).toBeNull();
    expect(hourOf(polls({ from: "2026-11-18T12:00", to: "2026-11-18T18:00", reports: quiet, online: () => undefined }), "2026-11-18T14:00").kwh).toBeNull();
  });

  it("never measures across a counter reset, use sent after the meter was offline, or a long silence that ends with use", () => {
    // Replaced or reset at 2:40 pm: its total starts again near zero.
    const reset: Array<[string, number]> = [["2026-11-18T13:40", 100.4], ["2026-11-18T14:40", 0.3], ["2026-11-18T15:40", 0.7], ["2026-11-18T16:40", 1.1]];
    expect(hourOf(polls({ from: "2026-11-18T13:00", to: "2026-11-18T17:00", reports: reset }), "2026-11-18T14:00")).toEqual({ kwh: null, reason: "reset" });
    // The hour after the reset is measured as usual.
    expect(hourOf(polls({ from: "2026-11-18T13:00", to: "2026-11-18T17:00", reports: reset }), "2026-11-18T15:00")).toEqual({ kwh: 0.4, inferred: false });
    // Offline from 2 pm; at 4:20 pm it is back and sends everything it counted meanwhile: when it was used is not known.
    const catchUp: Array<[string, number]> = [["2026-11-18T13:40", 100.4], ["2026-11-18T16:20", 101.5]];
    const away = (at: number) => at < sg("2026-11-18T14:00") || at >= sg("2026-11-18T16:15");
    expect(hourOf(polls({ from: "2026-11-18T13:00", to: "2026-11-18T17:00", reports: catchUp, online: away }), "2026-11-18T14:00")).toEqual({ kwh: null, reason: "offline" });
    // Four hours without a value, ending with use (the live checks themselves were down): an outage, not measured.
    const silence: Array<[string, number]> = [["2026-11-18T10:40", 99], ["2026-11-18T14:40", 100.6], ["2026-11-18T15:40", 101]];
    const down = (at: number) => at > sg("2026-11-18T10:45") && at < sg("2026-11-18T14:45");
    expect(hourOf(polls({ from: "2026-11-18T10:00", to: "2026-11-18T16:00", reports: silence, skip: down }), "2026-11-18T13:00")).toEqual({ kwh: null, reason: "outage" });
  });

  it("still measures an hour when some live checks were missed, from the values the meter sent around it", () => {
    // No live check between 1:45 and 4 pm (the API restarting); the meter's 1:40 and 3:40 values still bracket 2–3 pm.
    const missed = (at: number) => at > sg("2026-11-18T13:45") && at < sg("2026-11-18T16:00");
    expect(hourOf(polls({ from: "2026-11-18T12:00", to: "2026-11-18T16:00", reports: HOURLY, skip: missed }), "2026-11-18T14:00")).toEqual({ kwh: 0.4, inferred: false });
  });
});

// ---------------------------------------------------------------- judging the hours

describe("Live hourly use: unusual hours against the usual level", () => {
  const meters: FixtureMeter[] = [
    PAVILION,
    { id: "corridor", name: "Corridor lights", usual: 0.4 },
    { id: "pump", name: "Booster pump", usual: 4 },
    { id: "lobby", name: "Lift lobby", usual: 0.4 },
  ];
  const readings = daily({ through: "2026-11-18T02", meters });

  it("raises a spike, a drop and a drop to zero from one unusual hour, within the hour, once", async () => {
    await withMetadata((metadata, store) => {
      const now = new Date(sg("2026-11-18T15:10"));
      const hoursSeen = live({
        "pavilion-1": [["2026-11-18T13", 0.4], ["2026-11-18T14", 0, true]],
        corridor: [["2026-11-18T13", 0.4], ["2026-11-18T14", 0.15]],
        pump: [["2026-11-18T13", 4], ["2026-11-18T14", 6.5]],
        lobby: [["2026-11-18T13", 0.45], ["2026-11-18T14", 0.3]],
      });
      const changes = evaluateLiveHourAlerts({ store, projectId: PROJECT, readings, live: hoursSeen, patternAlerts: true, now });
      expect(changes.opened.map((alert) => [alert.kind, alert.subject, alert.payload.direction, alert.payload.kwh, alert.payload.usualKwh, alert.payload.start, alert.payload.end, alert.payload.ongoing, alert.payload.live]))
        .toEqual([
          ["usage_pattern", "pavilion-1", "zero", 0, 0.4, isoAt("2026-11-18T14:00"), isoAt("2026-11-18T15:00"), true, true],
          ["usage_pattern", "corridor", "low", 0.15, 0.4, isoAt("2026-11-18T14:00"), isoAt("2026-11-18T15:00"), true, true],
          ["usage_pattern", "pump", "high", 6.5, 4, isoAt("2026-11-18T14:00"), isoAt("2026-11-18T15:00"), true, true],
        ]);
      expect(store.get(PROJECT, changes.opened[0]!.key)!.payload.inferred).toBe(true);
      // The next live check, a quarter of an hour later, sees the same hours: nothing new.
      expect(evaluateLiveHourAlerts({ store, projectId: PROJECT, readings, live: hoursSeen, patternAlerts: true, now: new Date(sg("2026-11-18T15:25")) })).toEqual({ opened: [], resolved: [] });

      // An hour later: the pavilion and the pump are still off their usual level, the corridor is back to usual.
      const later = evaluateLiveHourAlerts({
        store, projectId: PROJECT, readings, now: new Date(sg("2026-11-18T16:10")), patternAlerts: true,
        live: live({
          "pavilion-1": [["2026-11-18T13", 0.4], ["2026-11-18T14", 0, true], ["2026-11-18T15", 0, true]],
          corridor: [["2026-11-18T13", 0.4], ["2026-11-18T14", 0.15], ["2026-11-18T15", 0.4]],
          pump: [["2026-11-18T13", 4], ["2026-11-18T14", 6.5], ["2026-11-18T15", 7]],
        }),
      });
      expect(later.opened).toEqual([]);
      expect(later.resolved.map((alert) => [alert.subject, alert.payload.end, alert.payload.ongoing])).toEqual([["corridor", isoAt("2026-11-18T15:00"), false]]);
      expect(store.list(PROJECT, { status: "open", kind: "usage_pattern" }).map((alert) => [alert.subject, alert.payload.hours, alert.payload.end, alert.payload.kwh]))
        .toEqual([["pavilion-1", 2, isoAt("2026-11-18T16:00"), 0], ["pump", 2, isoAt("2026-11-18T16:00"), 7]]);
      // In the bell, for the people who run the site.
      expect(bell(metadata, new Date(sg("2026-11-18T16:10"))).map((alert) => [alert.kind, alert.status, alert.details.live])).toHaveLength(3);
    });
  });

  it("says in the email that it was seen within the hour, with the hour it is about", async () => {
    await withMetadata((metadata, store) => {
      const changes = evaluateLiveHourAlerts({ store, projectId: PROJECT, readings, patternAlerts: true, now: new Date(sg("2026-11-18T15:10")), live: live({ "pavilion-1": [["2026-11-18T14", 0, true]], pump: [["2026-11-18T22", 6.5]] }) });
      const [zero, spike] = changes.opened.map((alert) => meterAlertEmail({ site: "SKTC", timezone: TZ, alert, link: "" })!);
      expect(zero!.subject).toBe("SKTC: unusual use on Pavilion 1, 2–3 pm");
      expect(zero!.text).toContain("Pavilion 1 used nothing 2–3 pm on Wed, 18 Nov (usually 0.40 kW).");
      expect(zero!.text).toContain("Seen within the hour from the live meter readings.");
      expect(spike!.text).toContain("Booster pump used 6.5 kW 10–11 pm on Wed, 18 Nov, usually about 4.0 kW.");
      expect(meterAlertEmails({ changes, site: "SKTC", timezone: TZ, projectId: PROJECT })).toHaveLength(2);
    });
  });

  it("keeps to the limit of five a day per site, then one summary, counted together with the daily check's", async () => {
    await withMetadata((metadata, store) => {
      const many = Array.from({ length: 7 }, (_, index): FixtureMeter => ({ id: `m${index}`, name: `Meter ${index + 1}`, usual: 4 }));
      const changes = evaluateLiveHourAlerts({
        store, projectId: PROJECT, readings: daily({ through: "2026-11-18T02", meters: many }), patternAlerts: true, now: new Date(sg("2026-11-18T15:10")),
        live: live(Object.fromEntries(many.map((meter) => [meter.id, [["2026-11-18T14", 7] as [string, number]]]))),
      });
      expect(changes.opened.filter((alert) => alert.kind === "usage_pattern")).toHaveLength(5);
      expect(changes.opened.find((alert) => alert.kind === "usage_pattern_more")!.payload).toMatchObject({ date: "2026-11-18", count: 2, names: ["Meter 6", "Meter 7"] });
      // Five emails, and one for the summary; none for the two only counted in it.
      expect(meterAlertEmails({ changes, site: "SKTC", timezone: TZ, projectId: PROJECT }).map((email) => email.key.split(":")[0])).toEqual([...Array(5).fill("usage-pattern"), "usage-pattern-more"]);
    });
  });

  it("respects the per-site switch for unusual use, and still judges a meter that must never use power", async () => {
    await withMetadata((metadata, store) => {
      const fan: FixtureMeter = { id: "fan", name: "Pavilion DL & fan", usual: 0, neverUsed: true };
      const both = daily({ through: "2026-11-18T02", meters: [PAVILION, fan] });
      const changes = evaluateLiveHourAlerts({
        store, projectId: PROJECT, readings: both, patternAlerts: false, now: new Date(sg("2026-11-18T15:10")),
        live: live({ "pavilion-1": [["2026-11-18T14", 0, true]], fan: [["2026-11-18T13", 0, true], ["2026-11-18T14", 0.3]] }),
      });
      expect(changes.opened.map((alert) => [alert.kind, alert.subject, alert.payload.totalKwh, alert.payload.start, alert.payload.live])).toEqual([["never_used", "fan", 0.3, isoAt("2026-11-18T14:00"), true]]);
      // The next hour it used nothing: over.
      const next = evaluateLiveHourAlerts({ store, projectId: PROJECT, readings: both, patternAlerts: false, now: new Date(sg("2026-11-18T16:10")), live: live({ fan: [["2026-11-18T14", 0.3], ["2026-11-18T15", 0, true]] }) });
      expect(next.resolved.map((alert) => [alert.kind, alert.payload.ongoing])).toEqual([["never_used", false]]);
      expect(store.list(PROJECT, { kind: "never_used" })).toHaveLength(1);
    });
  });

  it("leaves a meter already said to have stopped sending to that alert", async () => {
    await withMetadata((metadata, store) => {
      store.open({ projectId: PROJECT, key: "meter-offline:p1:20261118T0200", kind: "meter_offline", audience: "hardware", subject: "pavilion-1", payload: { meters: [{ id: "pavilion-1", name: "Pavilion 1", since: isoAt("2026-11-18T02:00") }], since: isoAt("2026-11-18T02:00") }, now: new Date(sg("2026-11-18T03:00")) });
      expect(evaluateLiveHourAlerts({ store, projectId: PROJECT, readings, patternAlerts: true, now: new Date(sg("2026-11-18T15:10")), live: live({ "pavilion-1": [["2026-11-18T14", 0, true]] }) }).opened).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------- the daily readings take over

describe("Live hourly use: when the daily readings arrive", () => {
  const meters = [PAVILION];
  /** The live view on 18 Nov: Pavilion 1 used nothing 2–4 pm, back to usual from 4 pm. */
  const raiseLive = (store: MeterAlertStore, inferred = true) => {
    const readings = daily({ through: "2026-11-18T02", meters });
    const first = evaluateLiveHourAlerts({ store, projectId: PROJECT, readings, patternAlerts: true, now: new Date(sg("2026-11-18T15:10")), live: live({ "pavilion-1": [["2026-11-18T13", 0.4], ["2026-11-18T14", 0, inferred]] }) });
    evaluateLiveHourAlerts({ store, projectId: PROJECT, readings, patternAlerts: true, now: new Date(sg("2026-11-18T16:10")), live: live({ "pavilion-1": [["2026-11-18T14", 0, inferred], ["2026-11-18T15", 0, inferred]] }) });
    evaluateLiveHourAlerts({ store, projectId: PROJECT, readings, patternAlerts: true, now: new Date(sg("2026-11-18T17:10")), live: live({ "pavilion-1": [["2026-11-18T14", 0, inferred], ["2026-11-18T15", 0, inferred], ["2026-11-18T16", 0.4]] }) });
    return first.opened[0]!.key;
  };
  const nextMorning = new Date(sg("2026-11-19T03:00"));
  const dailyWith = (override: (date: string, hour: number) => HourCell | undefined) =>
    daily({ through: "2026-11-19T02", meters, override: (meterId, date, hour) => (date === "2026-11-18" ? override(date, hour) : undefined) });

  it("keeps the alert the live check raised instead of opening a second one, when the readings agree", async () => {
    await withMetadata((metadata, store) => {
      const key = raiseLive(store);
      expect(store.get(PROJECT, key)).toMatchObject({ status: "resolved", payload: { hours: 2, ongoing: false, end: isoAt("2026-11-18T16:00") } });
      const changes = evaluateMeterAlerts({ store, projectId: PROJECT, patternAlerts: true, now: nextMorning, readings: dailyWith((date, hour) => (hour === 14 || hour === 15 ? [date, hour, 0, 60, 0, 0] : undefined)) });
      expect(changes.opened).toEqual([]);
      expect(store.list(PROJECT, { kind: "usage_pattern" }).map((alert) => [alert.key, alert.status, alert.payload.start, alert.payload.end, alert.payload.confirmed, alert.payload.live]))
        .toEqual([[key, "resolved", isoAt("2026-11-18T14:00"), isoAt("2026-11-18T16:00"), true, true]]);
      // The same readings again change nothing.
      expect(evaluateMeterAlerts({ store, projectId: PROJECT, patternAlerts: true, now: new Date(sg("2026-11-19T04:00")), readings: dailyWith((date, hour) => (hour === 14 || hour === 15 ? [date, hour, 0, 60, 0, 0] : undefined)) })).toEqual({ opened: [], resolved: [] });
    });
  });

  it("carries on the live alert when the readings show the drop began an hour earlier than the live check saw", async () => {
    await withMetadata((metadata, store) => {
      const key = raiseLive(store);
      const changes = evaluateMeterAlerts({ store, projectId: PROJECT, patternAlerts: true, now: nextMorning, readings: dailyWith((date, hour) => (hour >= 13 && hour <= 15 ? [date, hour, 0, 60, 0, 0] : undefined)) });
      expect(changes.opened).toEqual([]);
      expect(store.list(PROJECT, { kind: "usage_pattern" }).map((alert) => [alert.key, alert.payload.start, alert.payload.end, alert.payload.hours])).toEqual([[key, isoAt("2026-11-18T13:00"), isoAt("2026-11-18T16:00"), 3]]);
    });
  });

  it("keeps a one-hour live alert the readings confirm, though the daily check alone needs two hours", async () => {
    await withMetadata((metadata, store) => {
      const readings = daily({ through: "2026-11-18T02", meters: [{ id: "corridor", name: "Corridor lights", usual: 0.4 }] });
      const opened = evaluateLiveHourAlerts({ store, projectId: PROJECT, readings, patternAlerts: true, now: new Date(sg("2026-11-18T15:10")), live: live({ corridor: [["2026-11-18T14", 0.1]] }) }).opened;
      evaluateMeterAlerts({
        store, projectId: PROJECT, patternAlerts: true, now: nextMorning,
        readings: daily({ through: "2026-11-19T02", meters: [{ id: "corridor", name: "Corridor lights", usual: 0.4 }], override: (meterId, date, hour) => (date === "2026-11-18" && hour === 14 ? [date, hour, 0.1, 60, 0, 0] : undefined) }),
      });
      expect(store.get(PROJECT, opened[0]!.key)).toMatchObject({ status: "resolved", payload: { confirmed: true, ongoing: false } });
      expect(bell(metadata, nextMorning).map((alert) => alert.key)).toEqual([opened[0]!.key]);
    });
  });

  it("withdraws the alert quietly when the readings show the hours were usual, and frees its place in the day's five", async () => {
    await withMetadata((metadata, store) => {
      // Measured from values the meter sent (not inferred), so usual readings contradict it.
      const key = raiseLive(store, false);
      const changes = evaluateMeterAlerts({ store, projectId: PROJECT, patternAlerts: true, now: nextMorning, readings: dailyWith(() => undefined) });
      expect(changes).toEqual({ opened: [], resolved: [] });
      expect(store.get(PROJECT, key)!.payload).toMatchObject({ withdrawn: true });
      expect(bell(metadata, nextMorning)).toEqual([]);
      expect(store.countOpened(PROJECT, "usage_pattern", isoAt("2026-11-18T00:00"), isoAt("2026-11-19T00:00"))).toBe(0);
    });
  });

  it("withdraws it when the meter was in fact offline and sent its use late, and keeps it when the readings only spread later use over the quiet time", async () => {
    await withMetadata((metadata, store) => {
      const key = raiseLive(store);
      // Late-sent use filled 2–4 pm: the meter was away, not idle.
      evaluateMeterAlerts({ store, projectId: PROJECT, patternAlerts: true, now: nextMorning, readings: dailyWith((date, hour) => (hour === 14 || hour === 15 ? [date, hour, null, 0, 1, 0.4] : undefined)) });
      expect(store.get(PROJECT, key)!.payload.withdrawn).toBe(true);
    });
    await withMetadata((metadata, store) => {
      const key = raiseLive(store);
      // Usual-looking hours from the daily update spreading the 4:30 pm value back over the quiet time: not proof.
      evaluateMeterAlerts({ store, projectId: PROJECT, patternAlerts: true, now: nextMorning, readings: dailyWith(() => undefined) });
      expect(store.get(PROJECT, key)!.payload.withdrawn).toBeUndefined();
      expect(bell(metadata, nextMorning).map((alert) => alert.key)).toEqual([key]);
    });
  });

  it("leaves a live alert alone while the daily readings do not reach its hours yet", async () => {
    await withMetadata((metadata, store) => {
      const readings = daily({ through: "2026-11-18T02", meters });
      const opened = evaluateLiveHourAlerts({ store, projectId: PROJECT, readings, patternAlerts: true, now: new Date(sg("2026-11-18T15:10")), live: live({ "pavilion-1": [["2026-11-18T14", 0, true]] }) }).opened;
      // The hourly site check re-reads the same (older) readings in the afternoon.
      expect(evaluateMeterAlerts({ store, projectId: PROJECT, readings, patternAlerts: true, now: new Date(sg("2026-11-18T15:30")) })).toEqual({ opened: [], resolved: [] });
      expect(store.get(PROJECT, opened[0]!.key)).toMatchObject({ status: "open", payload: { ongoing: true } });
    });
  });

  it("does not open a second never-use alert when the readings bring the use the live check already raised", async () => {
    await withMetadata((metadata, store) => {
      const fan: FixtureMeter = { id: "fan", name: "Pavilion DL & fan", usual: 0, neverUsed: true };
      const opened = evaluateLiveHourAlerts({ store, projectId: PROJECT, readings: daily({ through: "2026-11-18T02", meters: [fan] }), patternAlerts: true, now: new Date(sg("2026-11-18T15:10")), live: live({ fan: [["2026-11-18T14", 0.3]] }) }).opened;
      const changes = evaluateMeterAlerts({
        store, projectId: PROJECT, patternAlerts: true, now: nextMorning,
        readings: daily({ through: "2026-11-19T02", meters: [fan], override: (meterId, date, hour) => (date === "2026-11-18" && hour === 14 ? [date, hour, 0.3, 60, 0, 0] : undefined) }),
      });
      expect(changes.opened).toEqual([]);
      expect(store.list(PROJECT, { kind: "never_used" }).map((alert) => [alert.key, alert.status, alert.payload.confirmed])).toEqual([[opened[0]!.key, "resolved", true]]);
    });
  });
});

// ---------------------------------------------------------------- running it after the live check

describe("Live hourly use: run after each live check", () => {
  const ON = { ENERGYIQ_ALERT_EMAILS_ENABLED: "true" };
  const meters: FixtureMeter[] = [PAVILION, { id: "pump", name: "Booster pump", usual: 4 }];
  const connector = {
    projectId: PROJECT,
    publishedDocument: { project: { timezone: TZ } },
    devices: [{ deviceId: "dev-pavilion", sourceLabel: "PAV" }, { deviceId: "dev-pump", sourceLabel: "PUMP" }],
    meterPoints: [{ meterPointId: "pavilion-1", sourceLabel: "PAV" }, { meterPointId: "pump", sourceLabel: "PUMP" }],
  } as unknown as EnergyTuyaProjectConnector;
  /** The pump's running total: 4 kWh an hour, 7 from 2 pm. */
  const pumpTotal = (at: number) => 1000 + 4 * (Math.min(at, sg("2026-11-18T14:00")) - sg("2026-11-18T00:00")) / HOUR + 7 * Math.max(0, at - sg("2026-11-18T14:00")) / HOUR;
  /** What Tuya says at `at`: the pavilion sent hourly at :40 until 1:40 pm, then nothing; the pump sends at :05, :20, :35, :50. */
  const tuya = (at: number) => {
    const pavilionAt = Math.min(sg("2026-11-18T13:40"), Math.floor((at - 40 * MIN) / HOUR) * HOUR + 40 * MIN);
    const pumpAt = Math.floor((at - 5 * MIN) / (15 * MIN)) * 15 * MIN + 5 * MIN;
    return [
      { sourceLabel: "PAV", energyKwh: Math.round((200 + 0.4 * (pavilionAt - sg("2026-11-18T00:40")) / HOUR) * 1000) / 1000, reportedAt: new Date(pavilionAt).toISOString() },
      { sourceLabel: "PUMP", energyKwh: Math.round(pumpTotal(pumpAt) * 1000) / 1000, reportedAt: new Date(pumpAt).toISOString() },
    ];
  };
  const poll = (metadata: ReturnType<typeof createMetadataStore>, at: number, listDevices?: () => Promise<Array<{ id: string; online: boolean }>>) => pollLiveReadings({
    metadataStore: metadata, connector, now: () => at,
    readLatestEnergy: async () => tuya(at),
    listDevices: listDevices ?? (async () => [{ id: "dev-pavilion", online: true }, { id: "dev-pump", online: true }]),
  });
  const addOwner = (metadata: ReturnType<typeof createMetadataStore>) => {
    metadata.users.createPasswordUser({ id: "owner", email: "owner@example.test" });
    metadata.workspaceMemberships.upsertOwner({ workspace_id: WORKSPACE, user_id: "owner" });
  };

  it("raises the spike from what the 15-minute checks read, and the drop to nothing once the meter has been quiet past its report slot, emailing each once", async () => {
    await withMetadata(async (metadata, store) => {
      addOwner(metadata);
      store.recordCheck(PROJECT, null, new Date(sg("2026-11-18T03:00")));
      const read = vi.fn(async () => daily({ through: "2026-11-18T02", meters }));
      const send = vi.fn<(message: { to: string[]; subject: string; text: string }) => Promise<void>>(async () => undefined);
      const runAt = (local: string) => runLiveHourAlerts({ metadataStore: metadata, projectId: PROJECT, now: new Date(sg(local) + 10 * MIN), env: ON, send, read });
      for (let at = sg("2026-11-18T10:00"); at <= sg("2026-11-18T15:00"); at += 15 * MIN) await poll(metadata, at);
      // 3:10 pm: the pump's latest value is from 2:50 pm, so 2–3 pm is not known yet.
      expect((await runAt("2026-11-18T15:00")).opened).toEqual([]);
      await poll(metadata, sg("2026-11-18T15:15"));
      expect(readLiveSamples(metadata.db, PROJECT, sg("2026-11-18T00:00")).get("pump")).toHaveLength(22);

      // 3:25 pm: the pump's 3:05 pm value is in, so its 2–3 pm is measured; the pavilion's quiet hour is not known yet.
      const first = await runAt("2026-11-18T15:15");
      expect(first.opened.map((alert) => [alert.subject, alert.payload.direction, alert.payload.start])).toEqual([["pump", "high", isoAt("2026-11-18T14:00")]]);
      expect(Number(first.opened[0]!.payload.kwh)).toBeGreaterThan(6.5);
      expect(send.mock.calls.map(([message]) => message.subject)).toEqual([`${metadata.energyIq.getProject(PROJECT).name}: unusual use on Booster pump, 2–3 pm`]);
      expect(send.mock.calls[0]![0].to).toContain("owner@example.test");

      // 4:20 pm: quiet and online since 1:40 pm, past its 70-minute report slot: it used nothing 2–3 pm.
      for (let at = sg("2026-11-18T15:30"); at <= sg("2026-11-18T16:15"); at += 15 * MIN) await poll(metadata, at);
      const second = await runAt("2026-11-18T16:15");
      expect(second.opened.map((alert) => [alert.subject, alert.payload.direction, alert.payload.start, alert.payload.inferred])).toEqual([["pavilion-1", "zero", isoAt("2026-11-18T14:00"), true]]);
      expect(send).toHaveBeenCalledTimes(2);
      expect(send.mock.calls[1]![0].text).toContain("Pavilion 1 used nothing 2–3 pm on Wed, 18 Nov (usually 0.40 kW).");
      // The pump is still high, so its alert simply runs on; checking again changes nothing.
      expect(store.get(PROJECT, first.opened[0]!.key)!.payload).toMatchObject({ hours: 2, ongoing: true });
      const third = await runAt("2026-11-18T16:15");
      expect(third).toMatchObject({ opened: [], resolved: [], emailed: [] });
      expect(send).toHaveBeenCalledTimes(2);
    });
  });

  it("measures nothing quiet as zero when the status check fails, and keeps the power readings", async () => {
    await withMetadata(async (metadata, store) => {
      store.recordCheck(PROJECT, null, new Date(sg("2026-11-18T03:00")));
      const failing = async () => { throw new Error("ENERGYIQ_TUYA_API_ERROR:1010"); };
      for (let at = sg("2026-11-18T10:00"); at <= sg("2026-11-18T17:00"); at += 15 * MIN) await poll(metadata, at, failing);
      const run = await runLiveHourAlerts({ metadataStore: metadata, projectId: PROJECT, now: new Date(sg("2026-11-18T17:10")), env: {}, read: async () => daily({ through: "2026-11-18T02", meters }) });
      expect(run.opened.map((alert) => alert.subject)).toEqual(["pump"]);
      expect(readLiveSamples(metadata.db, PROJECT, 0).get("pavilion-1")!.every((sample) => sample.online === undefined)).toBe(true);
    });
  });

  it("does nothing when switched off, before a site's first daily check, or with no daily readings to learn from", async () => {
    await withMetadata(async (metadata, store) => {
      for (let at = sg("2026-11-18T10:00"); at <= sg("2026-11-18T16:15"); at += 15 * MIN) await poll(metadata, at);
      const read = vi.fn(async () => daily({ through: "2026-11-18T02", meters }));
      const now = new Date(sg("2026-11-18T16:25"));
      // Not checked by the daily check yet: its first check records the site's history first.
      expect(await runLiveHourAlerts({ metadataStore: metadata, projectId: PROJECT, now, env: {}, read })).toMatchObject({ checked: false });
      store.recordCheck(PROJECT, null, new Date(sg("2026-11-18T03:00")));
      expect(await runLiveHourAlerts({ metadataStore: metadata, projectId: PROJECT, now, env: { ENERGYIQ_LIVE_HOUR_ALERTS_ENABLED: "false" }, read })).toMatchObject({ checked: false });
      expect(await runLiveHourAlerts({ metadataStore: metadata, projectId: PROJECT, now, env: { ENERGYIQ_METER_ALERTS_ENABLED: "false" }, read })).toMatchObject({ checked: false });
      expect(read).not.toHaveBeenCalled();
      const empty: MeterAlertReadings = { timezone: TZ, meters: [], cells: new Map(), referenceMs: null, hoursMeaning: "opening" };
      expect(await runLiveHourAlerts({ metadataStore: metadata, projectId: PROJECT, now, env: {}, read: async () => empty })).toMatchObject({ checked: false });
      expect(store.list(PROJECT)).toEqual([]);
      // Switched on, the same hours raise the pump and the pavilion.
      expect((await runLiveHourAlerts({ metadataStore: metadata, projectId: PROJECT, now, env: {}, read })).opened.map((alert) => alert.subject).sort()).toEqual(["pavilion-1", "pump"]);
    });
  });

  it("never throws: a failure to read the daily readings is logged and the next live check tries again", async () => {
    await withMetadata(async (metadata, store) => {
      store.recordCheck(PROJECT, null, new Date(sg("2026-11-18T03:00")));
      let fail = true;
      const read = vi.fn(async () => {
        if (fail) throw new Error("ENERGYIQ_PROJECT_PUBLICATION_IN_PROGRESS");
        return daily({ through: "2026-11-18T02", meters });
      });
      for (let at = sg("2026-11-18T10:00"); at <= sg("2026-11-18T15:15"); at += 15 * MIN) await poll(metadata, at);
      const alerts = createEnergyLiveHourAlerts({ metadataStore: metadata, env: {}, delivery: { mode: "off", send: vi.fn(async () => undefined) }, now: () => new Date(sg("2026-11-18T15:25")), read });
      await expect(alerts.check(PROJECT)).resolves.toBeUndefined();
      fail = false;
      expect((await alerts.check(PROJECT))!.opened.map((alert) => alert.subject)).toEqual(["pump"]);
      // Read once more for the next check within the hour: from memory.
      await alerts.check(PROJECT);
      expect(read).toHaveBeenCalledTimes(2);
    });
  });
});

describe("Live hourly use: the 15-minute live check", () => {
  const env = (metadata: ReturnType<typeof createMetadataStore>) => {
    const project = metadata.energyIq.getProject(PROJECT);
    const revision = metadata.energyIq.projectSetup.listHierarchyRevisions(PROJECT).find((candidate) => candidate.id === project.hierarchy_revision_id)!;
    const rows = (JSON.parse(revision.snapshot_json) as { meter_mapping?: { rows?: Array<{ id: string }> } }).meter_mapping?.rows ?? [];
    return {
      ENERGYIQ_TUYA_CONNECTOR_PROJECT_ID: PROJECT,
      ENERGYIQ_TUYA_CONNECTOR_WORKSPACE_ID: WORKSPACE,
      ENERGYIQ_TUYA_DEVICE_BINDINGS_JSON: JSON.stringify(Object.fromEntries(rows.map((row, index) => [row.id, `exampledevice${String(index + 1).padStart(3, "0")}`]))),
    };
  };

  it("judges a site's hours after reading it, never when Tuya failed, and a failure in the judging never stops the poll", async () => {
    await withMetadata(async (metadata) => {
      let tuyaDown = true;
      const readLatestEnergy = vi.fn(async (input: { devices: Array<{ sourceLabel: string }> }) => {
        if (tuyaDown) throw new Error("ENERGYIQ_TUYA_API_ERROR:1114");
        return input.devices.map((device) => ({ sourceLabel: device.sourceLabel, energyKwh: 10, reportedAt: new Date(sg("2026-11-18T13:40")).toISOString() }));
      });
      const afterPoll = vi.fn(async () => { throw new Error("boom"); });
      const poller = createEnergyLiveReadingsPoller({ metadataStore: metadata, readLatestEnergy, env: env(metadata), now: () => sg("2026-11-18T14:00"), afterPoll });
      await expect(poller.pollAll()).resolves.toBeUndefined();
      expect(readLatestEnergy).toHaveBeenCalledTimes(1);
      expect(afterPoll).not.toHaveBeenCalled();
      expect(readLiveSamples(metadata.db, PROJECT, 0).size).toBe(0);
      tuyaDown = false;
      await expect(poller.pollAll()).resolves.toBeUndefined();
      expect(afterPoll).toHaveBeenCalledWith(PROJECT);
      // What was read is kept although the judging after it failed; one Tuya read per site per check, nothing more.
      expect(readLiveSamples(metadata.db, PROJECT, 0).size).toBeGreaterThan(0);
      expect(readLatestEnergy).toHaveBeenCalledTimes(2);
    });
  });
});
