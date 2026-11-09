import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { readOfflineMeters, readOfflineSince, recordDeviceStatus } from "./energy-live-status.js";

const MIN = 60_000;
const T0 = Date.parse("2026-10-03T06:00:00.000Z");

describe("live device status", () => {
  it("raises an offline meter only after half an hour, keeps when it went offline and clears it when it is back", () => {
    const db = new DatabaseSync(":memory:");
    const poll = (at: number, online: boolean) => recordDeviceStatus({ db, projectId: "site", checkedAt: at, statuses: [{ meterPointId: "tv", online }, { meterPointId: "light", online: true }] });
    poll(T0, true);
    poll(T0 + 15 * MIN, false);
    // One missed check is not an outage yet.
    expect(readOfflineMeters({ db, projectId: "site", now: T0 + 16 * MIN })).toEqual([]);
    poll(T0 + 30 * MIN, false);
    expect(readOfflineMeters({ db, projectId: "site", now: T0 + 31 * MIN })).toEqual([]);
    poll(T0 + 45 * MIN, false);
    expect(readOfflineMeters({ db, projectId: "site", now: T0 + 46 * MIN })).toEqual([{ meterPointId: "tv", offlineSince: new Date(T0 + 15 * MIN).toISOString() }]);
    poll(T0 + 60 * MIN, true);
    expect(readOfflineMeters({ db, projectId: "site", now: T0 + 61 * MIN })).toEqual([]);
  });

  it("counts a meter that turns off with its lights as offline only after 16 hours", () => {
    const db = new DatabaseSync(":memory:");
    const HOUR = 60 * MIN;
    const poll = (at: number) => recordDeviceStatus({ db, projectId: "site", checkedAt: at, statuses: [{ meterPointId: "linkway", online: false }, { meterPointId: "tv", online: false }] });
    poll(T0);
    poll(T0 + 13 * HOUR);
    const offWithLights = new Set(["linkway"]);
    // A day with the lights off: the TV is a fault, the linkway meter is not.
    expect(readOfflineMeters({ db, projectId: "site", now: T0 + 13 * HOUR, offWithLights }).map((meter) => meter.meterPointId)).toEqual(["tv"]);
    expect(readOfflineSince({ db, projectId: "site", now: T0 + 13 * HOUR })).toEqual(new Map([
      ["linkway", new Date(T0).toISOString()],
      ["tv", new Date(T0).toISOString()],
    ]));
    // Still off after the night as well: now it is a fault too.
    poll(T0 + 16 * HOUR);
    expect(readOfflineMeters({ db, projectId: "site", now: T0 + 16 * HOUR, offWithLights }).map((meter) => meter.meterPointId)).toEqual(["linkway", "tv"]);
  });

  it("says nothing once the checks themselves stop, rather than repeat an old answer", () => {
    const db = new DatabaseSync(":memory:");
    recordDeviceStatus({ db, projectId: "site", checkedAt: T0, statuses: [{ meterPointId: "tv", online: false }] });
    recordDeviceStatus({ db, projectId: "site", checkedAt: T0 + 40 * MIN, statuses: [{ meterPointId: "tv", online: false }] });
    expect(readOfflineMeters({ db, projectId: "site", now: T0 + 41 * MIN })).toHaveLength(1);
    expect(readOfflineMeters({ db, projectId: "site", now: T0 + 40 * MIN + 46 * MIN })).toEqual([]);
  });
});
