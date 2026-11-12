import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMetadataStore } from "@datafoundry/metadata";
import { describe, expect, it } from "vitest";
import { ensureEnergyIqBootstrap } from "./energy-bootstrap.js";
import { idleThroughPeriodEnd, idleWhenQuietMeters, lightsOnHoursOn, quietMeters, readIdleWhenQuietMeters } from "./energy-idle-meters.js";
import { recordDeviceStatus } from "./energy-live-status.js";
import { TUYA_OFFICE_PROJECT_ID } from "./tuya-office-project.js";

// Made-up meters: a rarely used fan, a corridor lighting circuit and emergency lighting that must stay on.
const rows = [
  { id: "fan", category: "load" },
  { id: "corridor", category: "light" },
  { id: "emergency", category: "light", presentation: { always_on: "true" } },
];
const online = new Set(["fan", "corridor", "emergency"]);

describe("which quiet meters are idle rather than stopped", () => {
  it("lets a meter that can rightly use nothing be idle, but never one always on by design", () => {
    expect(idleWhenQuietMeters(online, rows, false)).toEqual(new Set(["fan", "corridor"]));
    // Only meters the live check finds online can be idle at all.
    expect(idleWhenQuietMeters(new Set(["corridor"]), rows, false)).toEqual(new Set(["corridor"]));
  });

  it("never lets lighting be idle on a site with lights-on hours: its lights should come on every night", () => {
    expect(idleWhenQuietMeters(online, rows, true)).toEqual(new Set(["fan"]));
  });

  it("reads lights-on hours only from a calendar entry in effect that day", () => {
    const entries = [
      { effective_from: "2026-01-01", effective_to: "2026-11-01" },
      { effective_from: "2026-11-01", effective_to: "2027-01-01", hours_meaning: "lights_on" },
    ];
    expect(lightsOnHoursOn(entries, "2026-10-31")).toBe(false);
    expect(lightsOnHoursOn(entries, "2026-11-11")).toBe(true);
    expect(lightsOnHoursOn(entries, "2027-01-01")).toBe(false);
    expect(lightsOnHoursOn([{ effective_from: "2026-01-01", hours_meaning: "lights_on" }], "2030-06-30")).toBe(true);
  });

  it("reads a project's meters and calendar, and says nothing without a recent live check", () => {
    const root = mkdtempSync(join(tmpdir(), "energy-idle-meters-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const project = metadata.energyIq.getProject(TUYA_OFFICE_PROJECT_ID);
      const revision = metadata.energyIq.projectSetup.listHierarchyRevisions(TUYA_OFFICE_PROJECT_ID).find((candidate) => candidate.id === project.hierarchy_revision_id)!;
      const mapping = (JSON.parse(revision.snapshot_json) as { meter_mapping: { rows: Array<{ id: string; category: string }> } }).meter_mapping.rows;
      const light = mapping.find((row) => row.category === "light")!.id, load = mapping.find((row) => row.category === "load")!.id;
      const now = Date.parse("2026-11-11T04:00:00.000Z");
      expect(readIdleWhenQuietMeters({ metadataStore: metadata, projectId: TUYA_OFFICE_PROJECT_ID, now })).toEqual(new Set());
      recordDeviceStatus({ db: metadata.db, projectId: TUYA_OFFICE_PROJECT_ID, checkedAt: now - 10 * 60_000, statuses: [{ meterPointId: light, online: true }, { meterPointId: load, online: true }] });
      // An office with opening hours: its lights can rightly be off for a long weekend.
      expect(readIdleWhenQuietMeters({ metadataStore: metadata, projectId: TUYA_OFFICE_PROJECT_ID, now })).toEqual(new Set([light, load]));
    } finally { metadata.close(); rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  });
});

describe("which meters a report on past dates may call idle", () => {
  // A made-up October report, made on 12 Nov. The site's newest reading is 12 Nov, 2 am.
  const octoberEnd = Date.parse("2026-10-31T16:00:00.000Z"); // 1 Nov, midnight in Singapore
  const newest = { meterPointId: "corridor", status: "usable", lastReadingAt: "2026-11-11T18:00:00.000Z" };

  it("keeps a meter that is quiet now, idle at the live check, and silent since before the dates ended", () => {
    const fan = { meterPointId: "fan", status: "usable", lastReadingAt: "2026-10-27T15:00:00.000Z", idleWhenQuiet: true };
    expect(idleThroughPeriodEnd([newest, fan], octoberEnd)).toEqual(["fan"]);
    // Its last reading in the last hour of the dates still counts as inside them.
    expect(idleThroughPeriodEnd([newest, { ...fan, lastReadingAt: "2026-10-31T16:00:00.000Z" }], octoberEnd)).toEqual(["fan"]);
  });

  it("leaves out a meter that stopped inside the dates and has sent readings since, even if it is quiet again now", () => {
    // Lost power on 28 Oct, back on 1 Nov, quiet (and online) since 3 Nov: the October stop was a real stop.
    const fan = { meterPointId: "fan", status: "usable", lastReadingAt: "2026-11-03T02:00:00.000Z", idleWhenQuiet: true };
    expect(quietMeters([newest, fan]).map((meter) => meter.meterPointId)).toEqual(["fan"]);
    expect(idleThroughPeriodEnd([newest, fan], octoberEnd)).toEqual([]);
  });

  it("leaves out a meter that is sending now, and one the live check does not find idle", () => {
    const sending = { meterPointId: "fan", status: "usable", lastReadingAt: "2026-11-11T17:00:00.000Z", idleWhenQuiet: true };
    expect(idleThroughPeriodEnd([newest, sending], octoberEnd)).toEqual([]);
    const offline = { meterPointId: "fan", status: "usable", lastReadingAt: "2026-10-27T15:00:00.000Z" };
    expect(idleThroughPeriodEnd([newest, offline], octoberEnd)).toEqual([]);
    // A meter that never sent a reading is not idle: there is nothing to say it was ever working.
    expect(idleThroughPeriodEnd([newest, { meterPointId: "fan", status: "no_readings", idleWhenQuiet: true }], octoberEnd)).toEqual([]);
  });
});
