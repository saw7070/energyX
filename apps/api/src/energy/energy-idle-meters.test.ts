import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMetadataStore } from "@datafoundry/metadata";
import { describe, expect, it } from "vitest";
import { ensureEnergyIqBootstrap } from "./energy-bootstrap.js";
import { idleWhenQuietMeters, lightsOnHoursOn, readIdleWhenQuietMeters } from "./energy-idle-meters.js";
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
