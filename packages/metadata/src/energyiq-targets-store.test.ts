import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMetadataStore, type MetadataStore } from "./index.js";

describe("EnergyIQ targets store", () => {
  let root: string;
  let metadata: MetadataStore;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "energyiq-targets-"));
    metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  });
  afterEach(() => {
    metadata.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("keeps a site's budget, carbon factor and overnight check, changing only what is given", () => {
    const targets = metadata.energyIq.targets;
    expect(targets.getTargets("site-a")).toEqual({ projectId: "site-a", overnight: { enabled: true, thresholdPct: 30 } });
    targets.setTargets("site-a", { budget: { monthlyAmount: 12000.456, currency: "SGD", monthlyKwh: 40000 } }, "user-1");
    targets.setTargets("site-a", { carbon: { kgCo2ePerKwh: 0.39, year: 2025, source: "Supplier" } }, "user-1");
    const saved = targets.setTargets("site-a", { overnight: { thresholdPct: 50 } }, "user-2");
    expect(saved).toMatchObject({
      budget: { monthlyAmount: 12000.46, currency: "SGD", monthlyKwh: 40000 },
      carbon: { basis: "custom", kgCo2ePerKwh: 0.39, year: 2025, source: "Supplier" },
      overnight: { enabled: true, thresholdPct: 50 },
      updatedBy: "user-2",
    });
    expect(targets.listProjectIdsWithBudget()).toEqual(["site-a"]);
    const cleared = targets.setTargets("site-a", { budget: null, carbon: null }, "user-1");
    expect(cleared.budget).toBeUndefined();
    expect(cleared.carbon).toBeUndefined();
    expect(() => targets.setTargets("site-a", { budget: { monthlyAmount: -1, currency: "SGD" } }, "user-1")).toThrow("ENERGYIQ_BUDGET_AMOUNT_INVALID");
    expect(() => targets.setTargets("site-a", { overnight: { thresholdPct: 5 } }, "user-1")).toThrow("ENERGYIQ_OVERNIGHT_THRESHOLD_INVALID");
  });

  it("records each alert once and lists recent ones newest first", () => {
    const targets = metadata.energyIq.targets;
    expect(targets.recordAlert({ projectId: "site-a", key: "budget:2026-10:at-risk", kind: "budget", payload: { forecast: 13000 }, now: new Date("2026-10-05T00:00:00Z") })).toBe(true);
    expect(targets.recordAlert({ projectId: "site-a", key: "budget:2026-10:at-risk", kind: "budget", payload: {}, now: new Date("2026-10-06T00:00:00Z") })).toBe(false);
    targets.recordAlert({ projectId: "site-a", key: "overnight:2026-10-06", kind: "overnight", payload: { nightKw: 4 }, now: new Date("2026-10-07T00:00:00Z") });
    expect(targets.listRecentAlerts("site-a", "2026-10-01T00:00:00Z").map((alert) => alert.key)).toEqual(["overnight:2026-10-06", "budget:2026-10:at-risk"]);
    expect(targets.listRecentAlerts("site-a", "2026-10-06T00:00:00Z")).toHaveLength(1);
  });

  it("saves report schedules and records one delivery per period", () => {
    const targets = metadata.energyIq.targets;
    const schedule = targets.createSchedule("workspace-1", { name: " Monthly summary ", frequency: "monthly", recipientUserIds: ["u1", "u1", "u2"] }, "u1");
    expect(schedule).toMatchObject({ name: "Monthly summary", frequency: "monthly", projectIds: [], recipientUserIds: ["u1", "u2"], localHour: 8, timezone: "Asia/Singapore", enabled: true });
    expect(targets.updateSchedule(schedule.id, { name: undefined, frequency: undefined, recipientUserIds: undefined, enabled: false }).enabled).toBe(false);
    expect(targets.listEnabledSchedules()).toEqual([]);
    expect(() => targets.createSchedule("workspace-1", { name: "x", frequency: "daily", recipientUserIds: ["u1"] }, "u1")).toThrow("ENERGYIQ_REPORT_SCHEDULE_FREQUENCY_INVALID");
    expect(() => targets.createSchedule("workspace-1", { name: "x", frequency: "weekly", recipientUserIds: [] }, "u1")).toThrow("ENERGYIQ_REPORT_SCHEDULE_RECIPIENTS_REQUIRED");
    targets.recordDelivery({ scheduleId: schedule.id, periodKey: "2026-09", status: "failed", recipientCount: 2, error: "SMTP down" });
    const delivered = targets.recordDelivery({ scheduleId: schedule.id, periodKey: "2026-09", status: "sent", recipientCount: 2 });
    expect(delivered).toMatchObject({ status: "sent", attempts: 2, recipientCount: 2 });
    expect(delivered.lastError).toBeUndefined();
    expect(targets.deleteSchedule(schedule.id)).toBe(true);
    expect(targets.findDelivery(schedule.id, "2026-09")).toBeUndefined();
  });
});
