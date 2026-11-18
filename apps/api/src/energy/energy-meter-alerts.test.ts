import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { PassThrough } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { ConfigApiContext } from "../routes/types.js";
import { handleEnergyApiRequest } from "./energy-api.js";
import { ensureEnergyIqBootstrap } from "./energy-bootstrap.js";
import type { HourCell, MeterAlertInputMeter } from "./energy-meter-alert-rules.js";
import { MeterAlertStore, normalizeHardwareEmails } from "./energy-meter-alert-store.js";
import { evaluateMeterAlerts, meterAlertEmail, runMeterAlerts, type MeterAlertReadings } from "./energy-meter-alerts.js";
import { hardwareAlertRecipients, operatorAlertRecipients } from "./energy-recipients.js";
import { markSiteAlertRead, readSiteAlerts } from "./energy-site-alerts.js";
import { createEnergyTargetsMonitor } from "./energy-targets-monitor.js";
import { TUYA_OFFICE_PROJECT_ID as PROJECT, TUYA_OFFICE_WORKSPACE_ID as WORKSPACE } from "./tuya-office-project.js";

const TZ = "Asia/Singapore";
const sg = (local: string) => Date.parse(`${local}:00+08:00`);
const isoAt = (local: string) => new Date(sg(local)).toISOString();

function hours(from: string, to: string, make: (date: string, hour: number, at: number) => HourCell | null): HourCell[] {
  const cells: HourCell[] = [];
  for (let at = sg(`${from}:00`); at < sg(`${to}:00`); at += 3_600_000) {
    const local = new Date(at + 8 * 3_600_000).toISOString();
    const cell = make(local.slice(0, 10), Number(local.slice(11, 13)), at);
    if (cell) cells.push(cell);
  }
  return cells;
}
const steady = (kwh: number) => (date: string, hour: number): HourCell => [date, hour, kwh, 60, 0, 0];

const BLOCK = ["264F L2-L17", "264F L1", "264F lift lobby", "264F stairs"];
/**
 * SKTC-like readings up to `through` (local hour, exclusive): Block 264F's four meters, Pavilion 1 (stopped on 5 Nov),
 * Pavilion 2 (powered only with its lights), and the pavilion fan that must never use power. `blockQuiet` is when the
 * block's gateway went down and `blockBack` when it came back, if it did.
 */
function sktc(input: { through: string; blockQuiet?: string; blockBack?: string; fan?: (date: string, hour: number) => number }): MeterAlertReadings {
  const block = hours("2026-10-25T00", input.through, (date, hour, at) => {
    const quiet = input.blockQuiet ? sg(input.blockQuiet) : Infinity;
    const back = input.blockBack ? sg(input.blockBack) : Infinity;
    if (at + 3_600_000 <= quiet || at >= back) return steady(0.2)(date, hour);
    if (at < quiet) return [date, hour, 0.1, (quiet - at) / 60_000, 1, 0.02];
    return back === Infinity ? null : [date, hour, null, 0, 1, 0.2];
  });
  const end = sg(`${input.through}:00`);
  const blockLast = input.blockQuiet && (!input.blockBack || sg(input.blockBack) > end) ? sg(input.blockQuiet) : end;
  const meters: MeterAlertInputMeter[] = [
    ...BLOCK.map((name) => ({ id: name, name, location: "Block 264F", locationId: "block-264f", lastReadingAt: new Date(blockLast).toISOString() })),
    { id: "pavilion-1", name: "Pavilion 1", location: "Pavilions", locationId: "pavilions", lastReadingAt: isoAt("2026-11-05T21:00") },
    { id: "pavilion-2", name: "Pavilion 2", location: "Pavilions", locationId: "pavilions", lastReadingAt: new Date(end).toISOString() },
    { id: "pavilion-fan", name: "Pavilion DL & fan", location: "Pavilions", locationId: "pavilions", neverUsed: true, lastReadingAt: new Date(end).toISOString() },
  ];
  return {
    timezone: TZ,
    meters,
    referenceMs: end,
    hoursMeaning: "lights_on",
    cells: new Map<string, HourCell[]>([
      ...BLOCK.map((name) => [name, block] as const),
      ["pavilion-1", hours("2026-10-25T00", "2026-11-05T21", steady(0.4))],
      ["pavilion-2", hours("2026-10-25T00", input.through, (date, hour) => (hour >= 19 || hour < 7 ? steady(0.3)(date, hour) : null))],
      ["pavilion-fan", hours("2026-10-25T00", input.through, (date, hour) => [date, hour, input.fan?.(date, hour) ?? 0, 60, 0, 0])],
    ]),
  };
}

const withMetadata = async (run: (metadata: ReturnType<typeof createMetadataStore>, store: MeterAlertStore) => void | Promise<void>): Promise<void> => {
  const root = mkdtempSync(join(tmpdir(), "energy-meter-alerts-"));
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  try {
    ensureEnergyIqBootstrap(metadata);
    await run(metadata, new MeterAlertStore(metadata.db));
  } finally {
    metadata.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};

/** A platform admin, a meter technician (may change the live connection), the site's owner and a plain viewer. */
const addTeam = (metadata: ReturnType<typeof createMetadataStore>) => {
  for (const id of ["admin", "tech", "owner", "viewer"]) metadata.users.createPasswordUser({ id, email: `${id}@example.test` });
  metadata.energyIq.upsertUserRole({ user_id: "admin", role: "admin" });
  metadata.energyIq.roles.create({ id: "role-tech", name: "Meter technician", permissions: { reports: "read", facility: "read", hours_rate: "none", notes: "none", live_connection: "write", people: "none" } });
  metadata.workspaceMemberships.upsert({ workspace_id: WORKSPACE, user_id: "tech", role: "member", role_id: "role-tech" });
  metadata.workspaceMemberships.upsertOwner({ workspace_id: WORKSPACE, user_id: "owner" });
  metadata.workspaceMemberships.upsert({ workspace_id: WORKSPACE, user_id: "viewer", role: "member" });
};

const bell = (metadata: ReturnType<typeof createMetadataStore>, who: { hardware: boolean; operators: boolean }, now: Date, userId = "reader") =>
  readSiteAlerts({ metadataStore: metadata, projectId: PROJECT, userId, includeReports: who.operators, includeSync: false, includeHardware: who.hardware, now: now.getTime() });

describe("Meter alerts: stopped sending", () => {
  it("opens one alert for a gateway's meters and one for a meter on its own, never for a lights-only meter, and does it once", async () => {
    await withMetadata((metadata, store) => {
      const now = new Date(sg("2026-11-18T03:00"));
      const readings = sktc({ through: "2026-11-18T02", blockQuiet: "2026-11-17T10:30" });
      const first = evaluateMeterAlerts({ store, projectId: PROJECT, readings, patternAlerts: true, now });
      expect(first.opened.map((alert) => [alert.kind, alert.audience, alert.payload.location ?? null, (alert.payload.meters as unknown[]).length, alert.payload.since])).toEqual([
        ["meter_offline", "hardware", null, 1, isoAt("2026-11-05T21:00")],
        ["meter_offline", "hardware", "Block 264F", 4, isoAt("2026-11-17T10:30")],
      ]);
      expect(first.resolved).toEqual([]);
      // The nightly update's hourly retry, or an upload, brings the same readings: nothing new.
      expect(evaluateMeterAlerts({ store, projectId: PROJECT, readings, patternAlerts: true, now: new Date(sg("2026-11-18T04:00")) })).toEqual({ opened: [], resolved: [] });
      expect(store.list(PROJECT, { status: "open" })).toHaveLength(2);
    });
  });

  it("resolves on its own once readings come back, saying since when and that late readings were filled in", async () => {
    await withMetadata((metadata, store) => {
      evaluateMeterAlerts({ store, projectId: PROJECT, readings: sktc({ through: "2026-11-18T02", blockQuiet: "2026-11-17T10:30" }), patternAlerts: true, now: new Date(sg("2026-11-18T03:00")) });
      const later = new Date(sg("2026-11-19T03:00"));
      const back = evaluateMeterAlerts({ store, projectId: PROJECT, readings: sktc({ through: "2026-11-19T02", blockQuiet: "2026-11-17T10:30", blockBack: "2026-11-18T08:00" }), patternAlerts: true, now: later });
      expect(back.opened).toEqual([]);
      expect(back.resolved).toHaveLength(1);
      expect(back.resolved[0]).toMatchObject({ status: "resolved", resolvedAt: later.toISOString(), payload: { location: "Block 264F", back: isoAt("2026-11-18T08:00") } });
      expect(Number(back.resolved[0]!.payload.filledLateKwh)).toBeGreaterThan(0);
      expect(store.list(PROJECT, { status: "open" }).map((alert) => alert.payload.since)).toEqual([isoAt("2026-11-05T21:00")]);
      // The bell: Pavilion 1 still open, and the block's return as its own news, for the hardware people only.
      const hardware = bell(metadata, { hardware: true, operators: false }, later);
      expect(hardware.meterAlerts.map((alert) => [alert.status, alert.readKey.endsWith(":back")])).toEqual([["resolved", true], ["open", false]]);
      expect(bell(metadata, { hardware: false, operators: true }, later).meterAlerts).toEqual([]);
      markSiteAlertRead({ db: metadata.db, userId: "reader", projectId: PROJECT, key: hardware.meterAlerts[0]!.readKey });
      expect(bell(metadata, { hardware: true, operators: false }, later).readKeys).toEqual([hardware.meterAlerts[0]!.readKey]);
    });
  });

  it("drops the alert quietly when later readings fill the quiet time on time: the meter used nothing, it never stopped", async () => {
    await withMetadata((metadata, store) => {
      const meter = { id: "office-lights", name: "Office lights", lastReadingAt: isoAt("2026-11-13T19:00") };
      const quiet: MeterAlertReadings = { timezone: TZ, hoursMeaning: "opening", referenceMs: sg("2026-11-15T02:00"), meters: [meter], cells: new Map([["office-lights", hours("2026-11-01T00", "2026-11-13T19", steady(0.5))]]) };
      const sunday = new Date(sg("2026-11-15T03:00"));
      expect(evaluateMeterAlerts({ store, projectId: PROJECT, readings: quiet, patternAlerts: false, now: sunday }).opened).toHaveLength(1);
      // Monday's readings: its total did not move all weekend, so the weekend was filled in as read, at 0 kWh.
      const filled: MeterAlertReadings = { ...quiet, referenceMs: sg("2026-11-17T02:00"), meters: [{ ...meter, lastReadingAt: isoAt("2026-11-17T02:00") }],
        cells: new Map([["office-lights", hours("2026-11-01T00", "2026-11-17T02", (date, hour, at) => steady(at >= sg("2026-11-13T19:00") && at < sg("2026-11-16T08:00") ? 0 : 0.5)(date, hour))]]) };
      const monday = new Date(sg("2026-11-17T03:00"));
      const changes = evaluateMeterAlerts({ store, projectId: PROJECT, readings: filled, patternAlerts: false, now: monday });
      expect(changes.resolved.map((alert) => alert.payload.cleared)).toEqual([true]);
      expect(bell(metadata, { hardware: true, operators: true }, monday).meterAlerts).toEqual([]);
    });
  });

  it("still reports an outage the daily update found only once it was over, opened and resolved together", async () => {
    await withMetadata((metadata, store) => {
      // SKTC: Block 264F's gateway was down 16 Nov 18:30 – 17 Nov 07:00; the 02:00 update brought both.
      const now = new Date(sg("2026-11-18T03:00"));
      const changes = evaluateMeterAlerts({ store, projectId: PROJECT, readings: sktc({ through: "2026-11-18T02", blockQuiet: "2026-11-16T18:30", blockBack: "2026-11-17T07:00" }), patternAlerts: true, now });
      const block = changes.opened.find((alert) => alert.payload.location === "Block 264F")!;
      expect(changes.resolved.map((alert) => alert.key)).toEqual([block.key]);
      expect(store.get(PROJECT, block.key)).toMatchObject({ status: "resolved", payload: { since: isoAt("2026-11-16T18:30"), back: isoAt("2026-11-17T07:00") } });
      const email = meterAlertEmail({ site: "SKTC", timezone: TZ, alert: store.get(PROJECT, block.key)!, back: true, link: "" })!;
      expect(email.subject).toBe("SKTC: 4 meters in Block 264F are sending readings again");
      expect(email.text).toContain("4 meters in Block 264F stopped sending readings at 16 Nov, 6:30 pm (most likely their gateway) and are back since 17 Nov, 7:00 am; readings sent late were filled in.");
    });
  });
});

describe("Meter alerts: should never use power", () => {
  it("raises one alert per episode with its start and total for the people who run the site, and old use is not news", async () => {
    await withMetadata((metadata, store) => {
      const fan = (date: string, hour: number) => (date === "2026-11-13" && hour === 23 ? 0.4 : date === "2026-11-20" && hour === 23 ? 0.3 : date === "2026-11-21" && hour === 0 ? 0.25 : 0);
      const now = new Date(sg("2026-11-21T03:00"));
      const readings = sktc({ through: "2026-11-21T02", fan });
      const changes = evaluateMeterAlerts({ store, projectId: PROJECT, readings, patternAlerts: false, now });
      const used = changes.opened.filter((alert) => alert.kind === "never_used");
      // 13 Nov was more than a week before the newest readings: not news on a first check.
      expect(used.map((alert) => [alert.audience, alert.payload.start, alert.payload.totalKwh, alert.payload.hours])).toEqual([["operators", isoAt("2026-11-20T23:00"), 0.55, 2]]);
      expect(store.get(PROJECT, used[0]!.key)?.status).toBe("resolved");
      expect(evaluateMeterAlerts({ store, projectId: PROJECT, readings, patternAlerts: false, now: new Date(sg("2026-11-21T04:00")) }).opened.filter((alert) => alert.kind === "never_used")).toEqual([]);
      const operators = bell(metadata, { hardware: false, operators: true }, now).meterAlerts;
      expect(operators.map((alert) => [alert.kind, alert.readKey === alert.key])).toEqual([["never_used", true]]);
      expect(bell(metadata, { hardware: true, operators: false }, now).meterAlerts.some((alert) => alert.kind === "never_used")).toBe(false);
      expect(meterAlertEmail({ site: "SKTC", timezone: TZ, alert: store.get(PROJECT, used[0]!.key)!, link: "" })!.text)
        .toContain("Pavilion DL & fan used 0.55 kWh at 20 Nov, 11:00 pm — it should never use power. It kept using power for 2 hours from then.");
    });
  });
});

describe("Meter alerts: unusual hourly use", () => {
  /** Meters that use 4 kWh every hour, and two hours at 7 kWh on the newest day for `spiking` of them. */
  const patternReadings = (count: number, spiking: number, through = "2026-11-19T02"): MeterAlertReadings => ({
    timezone: TZ, referenceMs: sg(`${through}:00`), hoursMeaning: "lights_on",
    meters: Array.from({ length: count }, (_, index) => ({ id: `m${index}`, name: `Meter ${index + 1}`, lastReadingAt: new Date(sg(`${through}:00`)).toISOString() })),
    cells: new Map(Array.from({ length: count }, (_, index) => [`m${index}`, hours("2026-10-20T00", through, (date, hour) =>
      [date, hour, index < spiking && date === "2026-11-18" && (hour === 21 || hour === 22) ? 7 : 4, 60, 0, 0])])),
  });

  it("opens at most five a day per site, then one summary, and nothing twice", async () => {
    await withMetadata((metadata, store) => {
      const now = new Date(sg("2026-11-19T03:00"));
      const changes = evaluateMeterAlerts({ store, projectId: PROJECT, readings: patternReadings(8, 7), patternAlerts: true, now });
      expect(changes.opened.filter((alert) => alert.kind === "usage_pattern")).toHaveLength(5);
      const summary = changes.opened.find((alert) => alert.kind === "usage_pattern_more")!;
      expect(summary.payload).toMatchObject({ date: "2026-11-19", count: 2, names: ["Meter 6", "Meter 7"] });
      expect(changes.opened.find((alert) => alert.kind === "usage_pattern")!.payload).toMatchObject({ direction: "high", kwh: 7, usualKwh: 4, hours: 2, at: isoAt("2026-11-18T21:00") });
      expect(evaluateMeterAlerts({ store, projectId: PROJECT, readings: patternReadings(8, 7), patternAlerts: true, now: new Date(sg("2026-11-19T04:00")) })).toEqual({ opened: [], resolved: [] });
      // The bell shows the five and the summary, never the ones only counted in it.
      expect(bell(metadata, { hardware: false, operators: true }, now).meterAlerts.map((alert) => alert.kind).sort())
        .toEqual(["usage_pattern", "usage_pattern", "usage_pattern", "usage_pattern", "usage_pattern", "usage_pattern_more"]);
    });
  });

  it("is switched off per site", async () => {
    await withMetadata((metadata, store) => {
      expect(store.getSettings(PROJECT).patternAlerts).toBe(true);
      store.setSettings(PROJECT, { patternAlerts: false }, "admin");
      expect(evaluateMeterAlerts({ store, projectId: PROJECT, readings: patternReadings(2, 2), patternAlerts: store.getSettings(PROJECT).patternAlerts, now: new Date(sg("2026-11-19T03:00")) }).opened).toEqual([]);
      expect(() => store.setSettings(PROJECT, { patternAlerts: "yes" }, "admin")).toThrow("ENERGYIQ_METER_ALERT_SETTINGS_INVALID");
    });
  });
});

describe("Meter alerts: who hears and when", () => {
  it("emails the hardware people about stopped meters and the people who run the site about use, only when e-mail is switched on", async () => {
    await withMetadata(async (metadata, store) => {
      addTeam(metadata);
      store.setSettings(PROJECT, { hardwareEmails: ["Gateway-Team@Example.test"] }, "admin");
      const fan = (date: string, hour: number) => (date === "2026-11-17" && hour === 23 ? 0.3 : 0);
      const read = vi.fn(async () => sktc({ through: "2026-11-18T02", blockQuiet: "2026-11-17T10:30", fan }));
      const send = vi.fn<(message: { to: string[]; subject: string; text: string }) => Promise<void>>(async () => undefined);
      const now = new Date(sg("2026-11-18T03:00"));

      // Production keeps alert e-mails off: the bell still gets the alerts, nobody is emailed.
      const off = await runMeterAlerts({ metadataStore: metadata, projectId: PROJECT, now, env: {}, send, read });
      expect(off).toMatchObject({ checked: true, emailed: [] });
      expect(off.opened.map((alert) => alert.kind).sort()).toEqual(["meter_offline", "meter_offline", "never_used"]);
      expect(send).not.toHaveBeenCalled();

      // Nothing new and checked within the hour: not read again.
      expect(await runMeterAlerts({ metadataStore: metadata, projectId: PROJECT, now: new Date(sg("2026-11-18T03:30")), env: {}, send, read })).toMatchObject({ checked: false });
      expect(read).toHaveBeenCalledTimes(1);

      // With e-mail on, a fresh site's alerts go to the right people, once.
      store.list(PROJECT).forEach((alert) => metadata.db.prepare("DELETE FROM energyiq_meter_alerts WHERE alert_key = ?").run(alert.key));
      const env = { ENERGYIQ_ALERT_EMAILS_ENABLED: "true" };
      const on = await runMeterAlerts({ metadataStore: metadata, projectId: PROJECT, now, env, send, read, force: true });
      expect(on.emailed).toHaveLength(3);
      const sent = send.mock.calls.map(([message]) => message);
      const hardware = ["admin@example.test", "gateway-team@example.test", "tech@example.test"];
      const operators = ["admin@example.test", "owner@example.test"];
      expect(sent.map((message) => [message.subject, message.to])).toEqual([
        [`${metadata.energyIq.getProject(PROJECT).name}: Pavilion 1 has stopped sending readings`, hardware],
        [`${metadata.energyIq.getProject(PROJECT).name}: 4 meters in Block 264F stopped sending at 10:30 am`, hardware],
        [`${metadata.energyIq.getProject(PROJECT).name}: Pavilion DL & fan used power — it should never use power`, operators],
      ]);
      await runMeterAlerts({ metadataStore: metadata, projectId: PROJECT, now: new Date(sg("2026-11-18T04:00")), env, send, read, force: true });
      expect(send).toHaveBeenCalledTimes(3);
      // Without a mail service, nothing is sent even when switched on.
      store.list(PROJECT).forEach((alert) => metadata.db.prepare("DELETE FROM energyiq_meter_alerts WHERE alert_key = ?").run(alert.key));
      expect((await runMeterAlerts({ metadataStore: metadata, projectId: PROJECT, now, env, read, force: true })).emailed).toEqual([]);
    });
  });

  it("chooses recipients: hardware people never include the site's operators, and at most five extra addresses", async () => {
    await withMetadata((metadata) => {
      addTeam(metadata);
      expect(hardwareAlertRecipients(metadata, PROJECT, ["extra@example.test"], {})).toEqual(["admin@example.test", "extra@example.test", "tech@example.test"]);
      expect(hardwareAlertRecipients(metadata, PROJECT, [], { ENERGYIQ_ADMIN_EMAILS: "root@example.test, x@localhost" })).toEqual(["admin@example.test", "root@example.test", "tech@example.test"]);
      expect(operatorAlertRecipients(metadata, PROJECT, {})).toEqual(["admin@example.test", "owner@example.test"]);
      expect(normalizeHardwareEmails([" A@Example.test ", "a@example.test", "b@example.test"])).toEqual(["a@example.test", "b@example.test"]);
      expect(() => normalizeHardwareEmails(["1@x.test", "2@x.test", "3@x.test", "4@x.test", "5@x.test", "6@x.test"])).toThrow("ENERGYIQ_METER_ALERT_EMAILS_INVALID");
      expect(() => normalizeHardwareEmails(["not an address"])).toThrow("ENERGYIQ_METER_ALERT_EMAILS_INVALID");
    });
  });
});

describe("Meter alerts: when they are checked", () => {
  it("are checked by the hourly site check at any hour, once per new set of readings, unless switched off", async () => {
    await withMetadata(async (metadata, store) => {
      // 03:00 in Singapore: before the daily budget check's hour, just after the nightly update.
      let clock = new Date(sg("2026-11-18T03:00"));
      const read = vi.fn(async (_metadata: unknown, projectId: string) => projectId === PROJECT
        ? sktc({ through: "2026-11-18T02", blockQuiet: "2026-11-17T10:30" })
        : { timezone: TZ, meters: [], cells: new Map(), referenceMs: null, hoursMeaning: "opening" as const });
      const delivery = { mode: "off" as const, send: vi.fn(async () => undefined) };
      const monitor = createEnergyTargetsMonitor({ metadataStore: metadata, env: {}, delivery, now: () => clock, readMeterAlertReadings: read });
      await monitor.runOnce();
      // Sites with no readings to judge are looked at again each hour (it costs nothing); this one is read once.
      const readsOf = () => read.mock.calls.filter(([, projectId]) => projectId === PROJECT).length;
      expect(readsOf()).toBe(1);
      expect(store.list(PROJECT, { status: "open", kind: "meter_offline" })).toHaveLength(2);
      // The next hourly tick with no new readings does not read them again.
      clock = new Date(sg("2026-11-18T04:00"));
      await monitor.runOnce();
      expect(readsOf()).toBe(1);
      expect(delivery.send).not.toHaveBeenCalled();

      const off = createEnergyTargetsMonitor({ metadataStore: metadata, env: { ENERGYIQ_METER_ALERTS_ENABLED: "false" }, delivery, now: () => new Date(sg("2026-11-18T09:00")), readMeterAlertReadings: read });
      const before = read.mock.calls.length;
      await off.runOnce();
      expect(read).toHaveBeenCalledTimes(before);
    });
  });
});

describe("Meter alerts: through the API", () => {
  const call = async (metadata: ReturnType<typeof createMetadataStore>, userId: string, method: string, segments: string[], body?: unknown) => {
    const stream = new PassThrough() as PassThrough & IncomingMessage;
    stream.method = method;
    stream.url = `/api/v1/energy/${segments.join("/")}`;
    stream.headers = body === undefined ? {} : { "content-type": "application/json" };
    stream.end(body === undefined ? undefined : JSON.stringify(body));
    const response = await handleEnergyApiRequest(stream, segments, { metadataStore: metadata, userId, workspaceId: WORKSPACE } as unknown as Required<ConfigApiContext>);
    return response as { status: number; body: { data?: Record<string, unknown>; error?: { message: string } } };
  };

  it("shows stopped meters in the bell only to the hardware people, and use alerts to everyone who reads the reports", async () => {
    await withMetadata(async (metadata, store) => {
      addTeam(metadata);
      const fan = (date: string, hour: number) => (date === "2026-11-17" && hour === 23 ? 0.3 : 0);
      evaluateMeterAlerts({ store, projectId: PROJECT, readings: sktc({ through: "2026-11-18T02", blockQuiet: "2026-11-17T10:30", fan }), patternAlerts: true, now: new Date() });
      const kinds = async (userId: string) => ((await call(metadata, userId, "GET", ["projects", PROJECT, "alerts"])).body.data!.meterAlerts as Array<{ kind: string }>).map((alert) => alert.kind).sort();
      expect(await kinds("tech")).toEqual(["meter_offline", "meter_offline", "never_used"]);
      expect(await kinds("admin")).toEqual(["meter_offline", "meter_offline", "never_used"]);
      expect(await kinds("viewer")).toEqual(["never_used"]);
      expect(await kinds("owner")).toEqual(["never_used"]);
      const key = (await call(metadata, "viewer", "GET", ["projects", PROJECT, "alerts"])).body.data!.meterAlerts as Array<{ readKey: string }>;
      expect((await call(metadata, "viewer", "POST", ["projects", PROJECT, "alerts", "read"], { key: key[0]!.readKey })).status).toBe(200);
    });
  });

  it("lets the right people change the unusual-use switch and the extra addresses for stopped meters", async () => {
    await withMetadata(async (metadata) => {
      addTeam(metadata);
      const path = ["projects", PROJECT, "meter-alerts", "settings"];
      expect((await call(metadata, "viewer", "GET", path)).body.data).toMatchObject({ patternAlerts: true, hardwareEmails: [], canEditPattern: false, canEditRecipients: false });
      expect((await call(metadata, "viewer", "PUT", path, { patternAlerts: false })).status).toBe(403);
      // The technician looks after the live connection, so sets the addresses but not the site's alert switch.
      expect((await call(metadata, "tech", "PUT", path, { patternAlerts: false })).status).toBe(403);
      const saved = await call(metadata, "tech", "PUT", path, { hardwareEmails: ["Gateway@Example.test", "noc@example.test"] });
      expect(saved.body.data).toMatchObject({ hardwareEmails: ["gateway@example.test", "noc@example.test"], canEditRecipients: true, maxHardwareEmails: 5 });
      expect(await call(metadata, "tech", "PUT", path, { hardwareEmails: ["one", "two"] })).toMatchObject({ status: 400, body: { error: { message: "ENERGYIQ_METER_ALERT_EMAILS_INVALID" } } });
      // The switch sits with the other site alerts: people allowed to change hours and rates (here, the admin).
      expect((await call(metadata, "admin", "PUT", path, { patternAlerts: false })).body.data).toMatchObject({ patternAlerts: false, canEditPattern: true, hardwareEmails: ["gateway@example.test", "noc@example.test"] });
      // Addresses stay with the people who may change them.
      expect((await call(metadata, "viewer", "GET", path)).body.data).toMatchObject({ patternAlerts: false, hardwareEmails: [] });
      // Nothing to change is refused, so it never rewrites who changed it last.
      const before = new MeterAlertStore(metadata.db).getSettings(PROJECT);
      expect(await call(metadata, "admin", "PUT", path, {})).toMatchObject({ status: 400, body: { error: { message: "ENERGYIQ_METER_ALERT_SETTINGS_INVALID" } } });
      expect(await call(metadata, "admin", "PUT", path, { somethingElse: true })).toMatchObject({ status: 400 });
      expect(new MeterAlertStore(metadata.db).getSettings(PROJECT)).toEqual(before);
    });
  });
});

describe("Meter alerts: emails that fail, first checks and housekeeping", () => {
  const ON = { ENERGYIQ_ALERT_EMAILS_ENABLED: "true" };
  const patternReadings = (count: number, spiking: number, spikeDate = "2026-11-18", through = "2026-11-19T02"): MeterAlertReadings => ({
    timezone: TZ, referenceMs: sg(`${through}:00`), hoursMeaning: "lights_on",
    meters: Array.from({ length: count }, (_, index) => ({ id: `m${index}`, name: `Meter ${index + 1}`, lastReadingAt: new Date(sg(`${through}:00`)).toISOString() })),
    cells: new Map(Array.from({ length: count }, (_, index) => [`m${index}`, hours("2026-10-20T00", through, (date, hour) =>
      [date, hour, index < spiking && date === spikeDate && (hour === 21 || hour === 22) ? 7 : 4, 60, 0, 0])])),
  });

  it("keeps an email that failed in the outbox and sends it at the next check, without holding up the others", async () => {
    await withMetadata(async (metadata, store) => {
      addTeam(metadata);
      const now = new Date(sg("2026-11-18T03:00"));
      // Checked before, so this is not the site's first check.
      store.recordCheck(PROJECT, null, new Date(sg("2026-11-17T03:00")));
      const fan = (date: string, hour: number) => (date === "2026-11-17" && hour === 23 ? 0.3 : 0);
      const read = vi.fn(async () => sktc({ through: "2026-11-18T02", blockQuiet: "2026-11-17T10:30", fan }));
      let calls = 0;
      const send = vi.fn<(message: { to: string[]; subject: string; text: string }) => Promise<void>>(async () => {
        calls += 1;
        if (calls === 1) throw new Error("421 SMTP service not available");
      });
      const first = await runMeterAlerts({ metadataStore: metadata, projectId: PROJECT, now, env: ON, send, read });
      // The first hardware email failed; the second hardware email and the operators' email still went.
      expect(send).toHaveBeenCalledTimes(3);
      expect(first.emailFailures).toBe(1);
      expect(first.emailed).toHaveLength(2);
      const failed = first.opened.find((alert) => alert.payload.since === isoAt("2026-11-05T21:00"))!.key;
      expect(first.emailed).not.toContain(failed);
      expect(store.getEmail(PROJECT, failed)).toMatchObject({ attempts: 1, lastError: "421 SMTP service not available" });
      expect(send.mock.calls.map(([message]) => message.to.includes("owner@example.test"))).toEqual([false, false, true]);

      // The next hourly check has no new readings, but the waiting email goes.
      const second = await runMeterAlerts({ metadataStore: metadata, projectId: PROJECT, now: new Date(sg("2026-11-18T04:00")), env: ON, send, read });
      expect(second).toMatchObject({ checked: false, emailed: [failed], emailFailures: 0 });
      expect(store.getEmail(PROJECT, failed)).toMatchObject({ attempts: 2, sentAt: new Date(sg("2026-11-18T04:00")).toISOString() });
      expect(read).toHaveBeenCalledTimes(1);
      await runMeterAlerts({ metadataStore: metadata, projectId: PROJECT, now: new Date(sg("2026-11-18T05:00")), env: ON, send, read });
      expect(send).toHaveBeenCalledTimes(4);

      // An email that could not go for two days is not news any more.
      store.enqueueEmail({ projectId: PROJECT, key: "meter-offline:old:20261114T1000", audience: "hardware", subject: "Old", text: "Old", now: new Date(sg("2026-11-15T03:00")) });
      await runMeterAlerts({ metadataStore: metadata, projectId: PROJECT, now: new Date(sg("2026-11-18T06:00")), env: ON, send, read });
      expect(send).toHaveBeenCalledTimes(4);
      expect(store.getEmail(PROJECT, "meter-offline:old:20261114T1000")?.sentAt).toBeUndefined();
    });
  });

  it("records what is already over at a site's first check without emailing it, and still raises what is going on", async () => {
    await withMetadata(async (metadata) => {
      addTeam(metadata);
      const send = vi.fn<(message: { to: string[]; subject: string; text: string }) => Promise<void>>(async () => undefined);
      const now = new Date(sg("2026-11-18T03:00"));
      // Block 264F's outage is already over; Pavilion 1 is still quiet.
      const read = async () => sktc({ through: "2026-11-18T02", blockQuiet: "2026-11-16T18:30", blockBack: "2026-11-17T07:00" });
      const run = await runMeterAlerts({ metadataStore: metadata, projectId: PROJECT, now, env: ON, send, read });
      expect(run.opened.map((alert) => [alert.payload.location ?? alert.payload.since, alert.payload.seeded ?? false])).toEqual([
        [isoAt("2026-11-05T21:00"), false],
        ["Block 264F", true],
      ]);
      expect(send.mock.calls.map(([message]) => message.subject)).toEqual([`${metadata.energyIq.getProject(PROJECT).name}: Pavilion 1 has stopped sending readings`]);
      // The block's outage is kept for the record but not shown as news.
      expect(bell(metadata, { hardware: true, operators: true }, now).meterAlerts.map((alert) => alert.details.since)).toEqual([isoAt("2026-11-05T21:00")]);
    });
  });

  it("records the day's unusual hours at a site's first check without emailing them, and emails them from then on", async () => {
    await withMetadata(async (metadata, store) => {
      addTeam(metadata);
      const send = vi.fn<(message: { to: string[]; subject: string; text: string }) => Promise<void>>(async () => undefined);
      const first = await runMeterAlerts({ metadataStore: metadata, projectId: PROJECT, now: new Date(sg("2026-11-19T03:00")), env: ON, send, read: async () => patternReadings(8, 7) });
      expect(first.opened.filter((alert) => alert.kind.startsWith("usage_pattern"))).toHaveLength(6);
      expect(send).not.toHaveBeenCalled();
      // The next day's unusual hours are news.
      const next = await runMeterAlerts({ metadataStore: metadata, projectId: PROJECT, now: new Date(sg("2026-11-20T03:00")), env: ON, send, read: async () => patternReadings(2, 1, "2026-11-19", "2026-11-20T02") });
      expect(next.opened.map((alert) => alert.kind)).toEqual(["usage_pattern"]);
      expect(send.mock.calls.map(([message]) => message.subject)).toEqual([`${metadata.energyIq.getProject(PROJECT).name}: unusual use on Meter 1`]);
      expect(store.list(PROJECT, { status: "open", kind: "usage_pattern_more" })).toEqual([]);
    });
  });

  it("closes a day's summary of further unusual use once the day is over or the alerts are switched off", async () => {
    await withMetadata((metadata, store) => {
      evaluateMeterAlerts({ store, projectId: PROJECT, readings: patternReadings(8, 7), patternAlerts: true, now: new Date(sg("2026-11-19T03:00")) });
      expect(store.list(PROJECT, { status: "open", kind: "usage_pattern_more" })).toHaveLength(1);
      // Later the same day it stays; switched off, it closes.
      evaluateMeterAlerts({ store, projectId: PROJECT, readings: patternReadings(8, 7), patternAlerts: true, now: new Date(sg("2026-11-19T15:00")) });
      expect(store.list(PROJECT, { status: "open", kind: "usage_pattern_more" })).toHaveLength(1);
      const off = evaluateMeterAlerts({ store, projectId: PROJECT, readings: patternReadings(8, 7), patternAlerts: false, now: new Date(sg("2026-11-19T16:00")) });
      expect(off.resolved.map((alert) => alert.kind)).toEqual(["usage_pattern_more"]);
      expect(bell(metadata, { hardware: false, operators: true }, new Date(sg("2026-11-19T16:00"))).meterAlerts.some((alert) => alert.kind === "usage_pattern_more")).toBe(false);
    });
    await withMetadata((metadata, store) => {
      evaluateMeterAlerts({ store, projectId: PROJECT, readings: patternReadings(8, 7), patternAlerts: true, now: new Date(sg("2026-11-19T03:00")) });
      // The next day, the old day's summary is over.
      const nextDay = evaluateMeterAlerts({ store, projectId: PROJECT, readings: patternReadings(8, 7), patternAlerts: true, now: new Date(sg("2026-11-20T03:00")) });
      expect(nextDay.resolved.map((alert) => [alert.kind, alert.payload.date])).toEqual([["usage_pattern_more", "2026-11-19"]]);
      expect(bell(metadata, { hardware: false, operators: true }, new Date(sg("2026-11-20T03:00"))).meterAlerts.filter((alert) => alert.kind === "usage_pattern_more")).toEqual([]);
    });
  });

  it("never lets unusual use only counted in a summary push real alerts off the bell", async () => {
    await withMetadata((metadata, store) => {
      const now = new Date(sg("2026-11-19T03:00"));
      store.open({ projectId: PROJECT, key: "never-used:fan:20261118T2300", kind: "never_used", audience: "operators", subject: "fan", payload: { meterName: "Pavilion DL & fan", start: isoAt("2026-11-18T23:00"), hours: 1, totalKwh: 0.3, ongoing: true }, now: new Date(sg("2026-11-19T00:00")) });
      for (let index = 0; index < 45; index += 1) {
        store.open({ projectId: PROJECT, key: `usage-pattern:m${index}:20261118T2100`, kind: "usage_pattern", audience: "operators", subject: `m${index}`, payload: { meterName: `Meter ${index}`, suppressed: true }, now });
      }
      expect(bell(metadata, { hardware: false, operators: true }, now).meterAlerts.map((alert) => alert.kind)).toEqual(["never_used"]);
    });
  });

  it("leaves every alert as it is when there are no readings to judge", async () => {
    await withMetadata(async (metadata, store) => {
      const now = new Date(sg("2026-11-18T03:00"));
      await runMeterAlerts({ metadataStore: metadata, projectId: PROJECT, now, env: {}, read: async () => sktc({ through: "2026-11-18T02", blockQuiet: "2026-11-17T10:30" }) });
      const checkedAt = store.lastCheck(PROJECT)!.checkedAt;
      const empty: MeterAlertReadings = { timezone: TZ, meters: [], cells: new Map(), referenceMs: null, hoursMeaning: "opening" };
      const run = await runMeterAlerts({ metadataStore: metadata, projectId: PROJECT, now: new Date(sg("2026-11-18T09:00")), env: {}, read: async () => empty });
      expect(run).toMatchObject({ checked: false, opened: [], resolved: [] });
      expect(store.list(PROJECT, { status: "open", kind: "meter_offline" })).toHaveLength(2);
      expect(store.lastCheck(PROJECT)!.checkedAt).toBe(checkedAt);
    });
  });
});
