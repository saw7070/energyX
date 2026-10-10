import type { DatabaseSync } from "node:sqlite";
import type { MetadataStore } from "@datafoundry/metadata";

/**
 * What the notification bell tells a site's readers besides action results: automatic reports that are ready, budget
 * and overnight-use alerts, and, for administrators, a daily live update that did not finish. Stopped meters come from the meter-health read the
 * pages already make. Each alert has a key; a reader who opens or dismisses it does not see that key again.
 */
export type SiteAlertReport = {
  key: string;
  reportId: string;
  cadence: "daily" | "weekly" | "monthly" | "other";
  from: string;
  toExclusive: string;
  finishedAt: string;
};

export type SiteAlertSync = {
  key: string;
  failedAt: string;
  reason: "ip-blocked" | "sign-in" | "other";
};

/** A budget heading over (or gone over), or a night of unusual use, raised by the daily site check. */
export type SiteAlertTarget = {
  key: string;
  kind: "budget" | "overnight";
  createdAt: string;
  details: Record<string, unknown>;
};

export type SiteAlerts = {
  reports: SiteAlertReport[];
  targets: SiteAlertTarget[];
  sync?: SiteAlertSync;
  readKeys: string[];
};

/** Only recent reports are news; older ones live in Reports. */
const REPORT_NEWS_MS = 14 * 24 * 60 * 60_000;
const KEY_PATTERN = /^(?:meters|report|sync|offline|budget|overnight):[\w:.,@\-]{1,400}$/u;

type ReportRunLike = {
  id: string;
  workspaceId: string;
  status: string;
  kind: string;
  scheduleKey?: string;
  siteReport?: { cadence: string };
  reportingPeriod?: { from: string; toExclusive: string };
  period: { from: string; toExclusive: string };
  finishedAt?: string;
};

export const readSiteAlerts = (input: {
  metadataStore: MetadataStore;
  projectId: string;
  userId: string;
  includeReports: boolean;
  includeSync: boolean;
  reportRuns?: ReportRunLike[];
  now?: number;
}): SiteAlerts => {
  const now = input.now ?? Date.now();
  const project = input.metadataStore.energyIq.getProject(input.projectId);
  const reports = input.includeReports
    ? (input.reportRuns ?? [])
      .filter((run) => run.workspaceId === project.workspace_id && run.status === "succeeded" && run.kind === "report"
        && Boolean(run.scheduleKey) && Boolean(run.finishedAt) && now - Date.parse(run.finishedAt!) <= REPORT_NEWS_MS)
      .sort((left, right) => right.finishedAt!.localeCompare(left.finishedAt!))
      // The advisor and the server can each write a report for the same week; one alert says it is ready.
      .filter((run, index, runs) => runs.findIndex((other) => samePeriod(other, run)) === index)
      .slice(0, 5)
      .map((run): SiteAlertReport => {
        const period = run.reportingPeriod ?? run.period;
        return {
          key: `report:${run.id}`,
          reportId: run.id,
          cadence: cadenceOf(run),
          from: period.from,
          toExclusive: period.toExclusive,
          finishedAt: run.finishedAt!,
        };
      })
    : [];
  let sync: SiteAlertSync | undefined;
  if (input.includeSync) {
    const state = input.metadataStore.energyIq.sourceSync.findState({ project_id: input.projectId, source_kind: "tuya" });
    if (state?.last_failure_at && (!state.last_success_at || state.last_failure_at > state.last_success_at)) {
      sync = { key: `sync:${state.last_failure_at}`, failedAt: state.last_failure_at, reason: syncReason(state.last_error_code) };
    }
  }
  const targets = input.includeReports
    ? input.metadataStore.energyIq.targets.listRecentAlerts(input.projectId, new Date(now - REPORT_NEWS_MS).toISOString(), 5)
      .map((alert): SiteAlertTarget => ({ key: alert.key, kind: alert.kind, createdAt: alert.createdAt, details: alert.payload }))
    : [];
  return { reports, targets, ...(sync ? { sync } : {}), readKeys: readKeys(input.metadataStore.db, input.userId, input.projectId) };
};

export const markSiteAlertRead = (input: { db: DatabaseSync; userId: string; projectId: string; key: unknown; now?: number }): void => {
  if (typeof input.key !== "string" || !KEY_PATTERN.test(input.key)) throw new Error("ENERGYIQ_ALERT_KEY_INVALID");
  ensureTable(input.db);
  input.db.prepare(`
    INSERT OR IGNORE INTO energyiq_notification_reads (user_id, project_id, notice_key, read_at) VALUES (?, ?, ?, ?)
  `).run(input.userId, input.projectId, input.key, new Date(input.now ?? Date.now()).toISOString());
};

const readKeys = (db: DatabaseSync, userId: string, projectId: string): string[] => {
  ensureTable(db);
  return (db.prepare(`
    SELECT notice_key FROM energyiq_notification_reads WHERE user_id = ? AND project_id = ? ORDER BY read_at DESC LIMIT 200
  `).all(userId, projectId) as Array<{ notice_key: string }>).map((row) => row.notice_key);
};

const ensureTable = (db: DatabaseSync): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS energyiq_notification_reads (
      user_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      notice_key TEXT NOT NULL,
      read_at TEXT NOT NULL,
      PRIMARY KEY (user_id, project_id, notice_key)
    )
  `);
};

const samePeriod = (left: ReportRunLike, right: ReportRunLike): boolean => {
  const a = left.reportingPeriod ?? left.period;
  const b = right.reportingPeriod ?? right.period;
  return cadenceOf(left) === cadenceOf(right) && a.from === b.from && a.toExclusive === b.toExclusive;
};

const cadenceOf = (run: ReportRunLike): SiteAlertReport["cadence"] => {
  const cadence = run.siteReport?.cadence ?? /:(?:site-)?(daily|weekly|monthly):/u.exec(run.scheduleKey ?? "")?.[1];
  return cadence === "daily" || cadence === "weekly" || cadence === "monthly" ? cadence : "other";
};

const syncReason = (code: string | undefined): SiteAlertSync["reason"] => {
  if (!code) return "other";
  if (/:1114\b|YOUR_IP/u.test(code)) return "ip-blocked";
  if (/:1004\b|:1010\b|:1011\b|SIGN|TOKEN|ACCESS_ID|ACCESS_SECRET|CREDENTIALS/u.test(code)) return "sign-in";
  return "other";
};
