import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMetadataStore, migrateEnergyIqTargetsPeakDemand, type MetadataStore } from "./index.js";

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
    expect(targets.getTargets("site-a")).toEqual({ projectId: "site-a", overnight: { enabled: true, thresholdPct: 30 }, peak: { enabled: true, warnPct: 90 } });
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

  it("keeps a site's peak demand limit and its own alert list, and refuses nonsense", () => {
    const targets = metadata.energyIq.targets;
    const saved = targets.setTargets("site-a", { peak: { limitKw: 120.04, warnPct: 95 }, alertEmails: [" Ops@Client.com", "ops@client.com", "fm@client.com"] }, "user-1");
    expect(saved.peak).toEqual({ enabled: true, limitKw: 120, warnPct: 95 });
    expect(saved.alertEmails).toEqual(["fm@client.com", "ops@client.com"]);
    // Changing one part keeps the rest; null removes the limit and returns alerts to the default people.
    expect(targets.setTargets("site-a", { peak: { enabled: false } }, "user-1").peak).toEqual({ enabled: false, limitKw: 120, warnPct: 95 });
    const cleared = targets.setTargets("site-a", { peak: { limitKw: null }, alertEmails: null }, "user-1");
    expect(cleared.peak).toEqual({ enabled: false, warnPct: 95 });
    expect(cleared.alertEmails).toBeUndefined();
    expect(() => targets.setTargets("site-a", { peak: { limitKw: -5 } }, "user-1")).toThrow("ENERGYIQ_PEAK_LIMIT_INVALID");
    expect(() => targets.setTargets("site-a", { peak: { warnPct: 30 } }, "user-1")).toThrow("ENERGYIQ_PEAK_WARN_PCT_INVALID");
    expect(() => targets.setTargets("site-a", { alertEmails: ["not an email"] }, "user-1")).toThrow("ENERGYIQ_ALERT_EMAILS_INVALID");
    expect(targets.recordAlert({ projectId: "site-a", key: "peak:2026-10:near", kind: "peak", payload: { peakKw: 110 } })).toBe(true);
  });

  it("upgrades an older database: adds the new columns and lets alerts be of kind peak, keeping old alerts", () => {
    const db = metadata.db;
    db.exec(`
      DROP TABLE energyiq_project_targets;
      DROP TABLE energyiq_target_alerts;
      CREATE TABLE energyiq_project_targets (project_id TEXT PRIMARY KEY, budget_json TEXT, carbon_json TEXT, overnight_json TEXT, updated_by TEXT, updated_at TEXT NOT NULL);
      CREATE TABLE energyiq_target_alerts (project_id TEXT NOT NULL, alert_key TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('budget', 'overnight')), payload_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (project_id, alert_key));
      INSERT INTO energyiq_target_alerts VALUES ('site-a', 'budget:2026-10:over', 'budget', '{}', '2026-10-05T00:00:00.000Z');
    `);
    migrateEnergyIqTargetsPeakDemand(db);
    migrateEnergyIqTargetsPeakDemand(db);
    const targets = metadata.energyIq.targets;
    expect(targets.setTargets("site-a", { peak: { limitKw: 80 } }, "user-1").peak.limitKw).toBe(80);
    expect(targets.recordAlert({ projectId: "site-a", key: "peak:2026-10:over", kind: "peak", payload: {} })).toBe(true);
    expect(targets.listRecentAlerts("site-a", "2026-01-01T00:00:00.000Z").map((alert) => alert.key)).toContain("budget:2026-10:over");
  });

  it("keeps the changes recorded for proof of savings, newest change first", () => {
    const targets = metadata.energyIq.targets;
    const now = new Date("2026-11-10T00:00:00.000Z");
    targets.createSavingsCheck("site-a", { name: " Timer moved ", changeDate: "2026-10-01" }, "user-1", now);
    const led = targets.createSavingsCheck("site-a", { name: "LED fittings", changeDate: "2026-11-01", meterIds: ["m1", "m2", "m1"], note: "264E" }, "user-1", now);
    expect(led).toMatchObject({ name: "LED fittings", changeDate: "2026-11-01", meterIds: ["m1", "m2"], note: "264E", createdBy: "user-1" });
    expect(targets.listSavingsChecks("site-a").map((check) => check.name)).toEqual(["LED fittings", "Timer moved"]);
    expect(() => targets.createSavingsCheck("site-a", { name: "x", changeDate: "2026-11-11" }, "user-1", now)).toThrow("ENERGYIQ_SAVINGS_CHECK_DATE_INVALID");
    expect(() => targets.createSavingsCheck("site-a", { name: "x", changeDate: "1 Nov" }, "user-1", now)).toThrow("ENERGYIQ_SAVINGS_CHECK_DATE_INVALID");
    expect(() => targets.createSavingsCheck("site-a", { name: " ", changeDate: "2026-11-01" }, "user-1", now)).toThrow("ENERGYIQ_SAVINGS_CHECK_NAME_REQUIRED");
    expect(targets.deleteSavingsCheck(led.id)).toBe(true);
    expect(targets.listSavingsChecks("site-a")).toHaveLength(1);
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
