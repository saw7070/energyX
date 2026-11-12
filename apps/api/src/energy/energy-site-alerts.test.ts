import { createMetadataStore } from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ensureEnergyIqBootstrap } from "./energy-bootstrap.js";
import { markSiteAlertRead, readSiteAlerts } from "./energy-site-alerts.js";
import { TUYA_OFFICE_PROJECT_ID, TUYA_OFFICE_WORKSPACE_ID } from "./tuya-office-project.js";

const NOW = Date.parse("2026-10-02T06:00:00.000Z");
const run = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  workspaceId: TUYA_OFFICE_WORKSPACE_ID,
  status: "succeeded",
  kind: "report",
  scheduleKey: `${TUYA_OFFICE_PROJECT_ID}:site-weekly:2026-09-21:2026-09-28`,
  siteReport: { cadence: "weekly" },
  period: { from: "2026-09-21", toExclusive: "2026-09-28" },
  finishedAt: "2026-09-28T01:00:00.000Z",
  ...overrides,
});

describe("Site alerts", () => {
  it("lists recent automatic reports and a failed daily update, and forgets what a reader has opened", () => {
    withMetadata((metadata) => {
      const claim = metadata.energyIq.sourceSync.claim({
        id: "energy-source-sync-test",
        workspace_id: TUYA_OFFICE_WORKSPACE_ID,
        project_id: TUYA_OFFICE_PROJECT_ID,
        source_kind: "tuya",
        connector_fingerprint: "a".repeat(64),
        trigger: "scheduled",
        window_start_ms: Date.parse("2026-09-30T16:00:00.000Z"),
        window_end_ms: Date.parse("2026-10-01T18:00:00.000Z"),
        actor_user_id: "dev-user",
        started_at: "2026-10-01T18:00:00.000Z",
        stale_before: "2026-10-01T12:00:00.000Z",
      });
      metadata.energyIq.sourceSync.completeFailure({
        run_id: claim.run.id,
        error_code: "ENERGYIQ_TUYA_API_ERROR:1114:YOUR_IP",
        completed_at: "2026-10-01T18:00:05.000Z",
      });
      const reportRuns = [
        run("weekly-report"),
        run("weekly-by-advisor", { siteReport: undefined, scheduleKey: `${TUYA_OFFICE_PROJECT_ID}:weekly:2026-09-21:2026-09-28`, finishedAt: "2026-09-27T23:00:00.000Z" }),
        run("monthly-report", { siteReport: undefined, scheduleKey: `${TUYA_OFFICE_PROJECT_ID}:monthly:2026-09-01:2026-10-01`, period: { from: "2026-09-01", toExclusive: "2026-10-01" }, finishedAt: "2026-10-01T01:00:00.000Z" }),
        run("asked-by-hand", { scheduleKey: undefined }),
        run("old-report", { finishedAt: "2026-08-01T01:00:00.000Z" }),
        run("other-client", { workspaceId: "someone-else" }),
        run("failed-report", { status: "failed" }),
      ];
      const read = (includeSync: boolean) => readSiteAlerts({
        metadataStore: metadata,
        projectId: TUYA_OFFICE_PROJECT_ID,
        userId: "dev-user",
        includeReports: true,
        includeSync,
        reportRuns,
        now: NOW,
      });

      const alerts = read(true);
      expect(alerts.reports.map((report) => [report.reportId, report.cadence])).toEqual([["monthly-report", "monthly"], ["weekly-report", "weekly"]]);
      expect(alerts.sync).toEqual({ key: "sync:2026-10-01T18:00:05.000Z", failedAt: "2026-10-01T18:00:05.000Z", reason: "ip-blocked" });
      expect(read(false).sync).toBeUndefined();
      expect(alerts.readKeys).toEqual([]);

      markSiteAlertRead({ db: metadata.db, userId: "dev-user", projectId: TUYA_OFFICE_PROJECT_ID, key: "report:weekly-report" });
      markSiteAlertRead({ db: metadata.db, userId: "dev-user", projectId: TUYA_OFFICE_PROJECT_ID, key: "report:weekly-report" });
      expect(read(true).readKeys).toEqual(["report:weekly-report"]);
      expect(() => markSiteAlertRead({ db: metadata.db, userId: "dev-user", projectId: TUYA_OFFICE_PROJECT_ID, key: "anything goes" }))
        .toThrow("ENERGYIQ_ALERT_KEY_INVALID");
    });
  });

  it("says only the newest daily report is ready, so daily reports never push an unread monthly one off the bell", () => {
    withMetadata((metadata) => {
      const day = (date: string, next: string, finishedAt: string, by: "site" | "advisor" = "site") => run(`daily-${by}-${date}`, {
        scheduleKey: `${TUYA_OFFICE_PROJECT_ID}:${by === "site" ? "site-" : ""}daily:${date}:${next}`,
        siteReport: by === "site" ? { cadence: "daily" } : undefined, period: { from: date, toExclusive: next }, finishedAt,
      });
      const reportRuns = [
        run("monthly-report", { scheduleKey: `${TUYA_OFFICE_PROJECT_ID}:site-monthly:2026-09-01:2026-10-01`, siteReport: { cadence: "monthly" },
          period: { from: "2026-09-01", toExclusive: "2026-10-01" }, finishedAt: "2026-09-24T22:00:00.000Z" }),
        // A week of daily reports after it, from the site and the advisor alike.
        ...["2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01"].flatMap((date, index, dates) => {
          const next = dates[index + 1] ?? "2026-10-02";
          return [day(date, next, `${next}T00:00:00.000Z`), day(date, next, `${next}T00:05:00.000Z`, "advisor")];
        }),
      ];
      const alerts = readSiteAlerts({ metadataStore: metadata, projectId: TUYA_OFFICE_PROJECT_ID, userId: "dev-user", includeReports: true, includeSync: false, reportRuns, now: NOW });
      expect(alerts.reports.map((report) => [report.cadence, report.from])).toEqual([["daily", "2026-10-01"], ["monthly", "2026-09-01"]]);
    });
  });
});

const withMetadata = (run: (metadata: ReturnType<typeof createMetadataStore>) => void): void => {
  const root = mkdtempSync(join(tmpdir(), "energy-site-alerts-"));
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  try {
    ensureEnergyIqBootstrap(metadata);
    run(metadata);
  } finally {
    metadata.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};
