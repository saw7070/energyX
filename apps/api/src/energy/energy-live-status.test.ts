import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { readOfflineMeters, recordDeviceStatus } from "./energy-live-status.js";

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

  it("says nothing once the checks themselves stop, rather than repeat an old answer", () => {
    const db = new DatabaseSync(":memory:");
    recordDeviceStatus({ db, projectId: "site", checkedAt: T0, statuses: [{ meterPointId: "tv", online: false }] });
    recordDeviceStatus({ db, projectId: "site", checkedAt: T0 + 40 * MIN, statuses: [{ meterPointId: "tv", online: false }] });
    expect(readOfflineMeters({ db, projectId: "site", now: T0 + 41 * MIN })).toHaveLength(1);
    expect(readOfflineMeters({ db, projectId: "site", now: T0 + 40 * MIN + 46 * MIN })).toEqual([]);
  });
});
