import type { DatabaseSync } from "node:sqlite";
import nodemailer from "nodemailer";
import { readEnergyMeterDataHealth } from "@datafoundry/data-gateway";
import type { MetadataStore } from "@datafoundry/metadata";

import { loadPasswordAuthConfig } from "../auth/config.js";
import { withEnergyProjectPublicationReadLock } from "./energy-project-materialization.js";
import { resolveEnergyPublishedMeterPoints } from "./energy-query-context.js";
import { readSiteAlerts } from "./energy-site-alerts.js";
import { readLiveSiteReadings } from "./energy-live-readings.js";

/**
 * Alert emails: the same two site problems the bell shows, sent to the people who own the site's workspace, so a
 * facility team hears about them without opening EnergyX.
 * - meters that stopped sending readings (the Overview rule: half a day behind the rest of the site);
 * - a daily live update that did not finish;
 * - meters Tuya has reported offline for half an hour, from the 15-minute live check, so a fault is known within the
 *   hour rather than the next day.
 * Each problem is emailed once: a new set of stopped or offline meters, or a new failure, is a new email. Off unless
 * ENERGYIQ_ALERT_EMAILS_ENABLED=true and SMTP is configured.
 */
const CHECK_INTERVAL_MS = 15 * 60_000;
/** Mirrors STALE_METER_REPORTING_MS in energy-analysis.ts and the web's stoppedMeters(). */
const STOPPED_AFTER_MS = 12 * 60 * 60_000;

export type AlertEmail = { key: string; subject: string; text: string };
export type MeterHealthRow = { meterPointId: string; name: string; status: string; lastReadingAt?: string };

export const collectSiteAlertEmails = (input: {
  metadataStore: MetadataStore;
  projectId: string;
  meters: MeterHealthRow[];
  /** Meters offline right now, from the live check. */
  offline?: Array<{ meterPointId: string; name: string; since: string }>;
  publicBaseUrl: string;
}): AlertEmail[] => {
  const project = input.metadataStore.energyIq.getProject(input.projectId);
  const site = project.name;
  const link = (path: string) => input.publicBaseUrl
    ? `\n\nOpen in EnergyX: ${input.publicBaseUrl.replace(/\/$/u, "")}${path}?projectId=${encodeURIComponent(input.projectId)}`
    : "";
  const emails: AlertEmail[] = [];
  const offline = input.offline ?? [];
  if (offline.length > 0) {
    emails.push({
      key: `offline:${offline.map((meter) => `${meter.meterPointId}@${meter.since}`).sort().join(",")}`,
      subject: `${site}: ${offline.length === 1 ? `${offline[0]!.name} went offline` : `${offline.length} meters went offline`}`,
      text: [
        `${offline.length === 1 ? "This meter" : "These meters"} at ${site} went offline and ${offline.length === 1 ? "has" : "have"} not come back:`,
        "",
        ...offline.map((meter) => `- ${meter.name}: offline since ${formatTime(meter.since)}`),
        "",
        "Every hour offline counts against data availability. Worth checking straight away: whether the meter still has power, and whether its Wi-Fi or gateway is online.",
      ].join("\n") + link("/energyiq/project-configuration"),
    });
  }
  // A meter already reported offline above is not reported again as stopped.
  const stopped = stoppedMeters(input.meters).filter((meter) => !offline.some((item) => item.meterPointId === meter.meterPointId));
  if (stopped.length > 0) {
    const since = stopped[0]!.lastReadingAt!;
    emails.push({
      key: `meters:${stopped.map((meter) => meter.meterPointId).sort().join(",")}:${since}`,
      subject: `${site}: ${stopped.length === 1 ? "1 meter has" : `${stopped.length} meters have`} stopped sending readings`,
      text: [
        `${stopped.length === 1 ? "This meter" : "These meters"} at ${site} stopped sending readings while the rest of the site kept reporting:`,
        "",
        ...stopped.map((meter) => `- ${meter.name}: last reading ${formatTime(meter.lastReadingAt!)}`),
        "",
        "Their usage is missing from the figures until they report again. Worth checking: the breaker the meter sits on, whether it still has power, and whether its gateway is online.",
      ].join("\n") + link("/energyiq/project-configuration"),
    });
  }
  const sync = readSiteAlerts({
    metadataStore: input.metadataStore,
    projectId: input.projectId,
    userId: "",
    includeReports: false,
    includeSync: true,
  }).sync;
  if (sync) {
    const reason = sync.reason === "ip-blocked"
      ? "Tuya refused the server's IP address. Add the server's address to the Tuya project's IP allowlist."
      : sync.reason === "sign-in"
        ? "Tuya did not accept the account's key. Check the Access ID and Secret under Facility → Live connection."
        : "The cause is recorded in the server log. The next scheduled update will try again.";
    emails.push({
      key: sync.key,
      subject: `${site}: the daily data update did not finish`,
      text: `The daily update for ${site} failed at ${formatTime(sync.failedAt)}, so the latest day's readings are not in EnergyX yet.\n\n${reason}` + link("/energyiq/project-configuration"),
    });
  }
  return emails;
};

/** The meters that were sending and went quiet, furthest behind first. Same rule as the Overview notice. */
export const stoppedMeters = (meters: MeterHealthRow[]): MeterHealthRow[] => {
  const sending = meters.filter((meter) => meter.status === "usable" && meter.lastReadingAt);
  const newest = sending.reduce((latest, meter) => Math.max(latest, Date.parse(meter.lastReadingAt!)), 0);
  if (!newest) return [];
  return sending
    .filter((meter) => newest - Date.parse(meter.lastReadingAt!) >= STOPPED_AFTER_MS)
    .sort((left, right) => left.lastReadingAt!.localeCompare(right.lastReadingAt!));
};

/** The workspace's owners: the people who run the site, as opposed to everyone who can read its reports. */
export const alertRecipients = (metadataStore: MetadataStore, projectId: string): string[] => {
  const project = metadataStore.energyIq.getProject(projectId);
  return [...new Set(metadataStore.workspaceMemberships.listByWorkspace({ workspace_id: project.workspace_id })
    .filter((membership) => membership.role === "owner")
    .flatMap((membership) => {
      try {
        const user = metadataStore.users.getById({ user_id: membership.user_id });
        return user.email && !user.disabled_at ? [user.email.toLowerCase()] : [];
      } catch {
        return [];
      }
    }))].sort();
};

/** Send what has not been sent yet; returns the keys that went out. */
export const sendPendingAlertEmails = async (input: {
  metadataStore: MetadataStore;
  projectId: string;
  emails: AlertEmail[];
  recipients: string[];
  send: (message: { to: string[]; subject: string; text: string }) => Promise<void>;
  now?: number;
}): Promise<string[]> => {
  if (input.recipients.length === 0) return [];
  const db = input.metadataStore.db;
  ensureTable(db);
  const sent: string[] = [];
  for (const email of input.emails) {
    const already = db.prepare(`SELECT 1 FROM energyiq_alert_emails WHERE project_id = ? AND alert_key = ?`)
      .get(input.projectId, email.key);
    if (already) continue;
    await input.send({ to: input.recipients, subject: email.subject, text: email.text });
    db.prepare(`INSERT OR IGNORE INTO energyiq_alert_emails (project_id, alert_key, sent_at) VALUES (?, ?, ?)`)
      .run(input.projectId, email.key, new Date(input.now ?? Date.now()).toISOString());
    sent.push(email.key);
  }
  return sent;
};

export type EnergyAlertEmailer = { start(): void; stop(): void; runOnce(): Promise<void> };

/** Hourly: each published site with a live connection is checked and emailed about anything new. */
export const createEnergyAlertEmailer = (input: {
  metadataStore: MetadataStore;
  env?: NodeJS.ProcessEnv;
  readMeters?: (projectId: string) => Promise<MeterHealthRow[]>;
  send?: (message: { to: string[]; subject: string; text: string }) => Promise<void>;
}): EnergyAlertEmailer => {
  const env = input.env ?? process.env;
  const config = loadPasswordAuthConfig(env);
  const smtp = config.smtp;
  const send = input.send ?? (smtp?.host && smtp.from
    ? async (message: { to: string[]; subject: string; text: string }) => {
      await nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        ...(smtp.user ? { auth: { user: smtp.user, pass: smtp.password ?? "" } } : {}),
      }).sendMail({ from: smtp.from, to: message.to, subject: message.subject, text: message.text });
    }
    : undefined);
  const readMeters = input.readMeters ?? ((projectId: string) => readProjectMeterHealth(input.metadataStore, projectId));
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> | undefined;
  const runOnce = (): Promise<void> => {
    running ??= (async () => {
      try {
        if (!send) return;
        for (const projectId of alertProjectIds(input.metadataStore, env)) {
          try {
            const emails = collectSiteAlertEmails({
              metadataStore: input.metadataStore,
              projectId,
              meters: await readMeters(projectId),
              offline: readLiveSiteReadings({ metadataStore: input.metadataStore, projectId }).offline,
              publicBaseUrl: config.publicBaseUrl,
            });
            const sent = await sendPendingAlertEmails({
              metadataStore: input.metadataStore,
              projectId,
              emails,
              recipients: alertRecipients(input.metadataStore, projectId),
              send,
            });
            for (const key of sent) console.log(`[alert-email] sent project=${projectId} alert=${key.split(":")[0]}`);
          } catch (error) {
            console.error(`[alert-email] failed project=${projectId} code=${error instanceof Error ? error.message.slice(0, 160) : "unknown"}`);
          }
        }
      } finally {
        running = undefined;
      }
    })();
    return running;
  };
  return {
    start() {
      if (timer || env.ENERGYIQ_ALERT_EMAILS_ENABLED?.trim() !== "true") return;
      if (!send) {
        console.warn("[alert-email] disabled: SMTP is not configured");
        return;
      }
      timer = setInterval(() => void runOnce(), CHECK_INTERVAL_MS);
      timer.unref();
      void runOnce();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
    runOnce,
  };
};

const alertProjectIds = (metadataStore: MetadataStore, env: NodeJS.ProcessEnv): string[] => {
  const ids = new Set(metadataStore.energyIq.liveConnectors.listSyncEnabled().map((connection) => connection.project_id));
  const configured = env.ENERGYIQ_TUYA_CONNECTOR_PROJECT_ID?.trim();
  if (configured && env.ENERGYIQ_TUYA_SYNC_ENABLED?.trim() === "true") ids.add(configured);
  return [...ids].sort();
};

const readProjectMeterHealth = async (metadataStore: MetadataStore, projectId: string): Promise<MeterHealthRow[]> => {
  const project = metadataStore.energyIq.getProject(projectId);
  return withEnergyProjectPublicationReadLock({ metadataStore, workspaceId: project.workspace_id, projectId }, async () => {
    const snapshot = metadataStore.energyIq.findCurrentDataSnapshot(projectId);
    const hierarchyRevisionId = project.hierarchy_revision_id;
    if (!snapshot || !hierarchyRevisionId) return [];
    const meterPoints = resolveEnergyPublishedMeterPoints({ metadataStore, projectId, hierarchyRevisionId, resource: "electricity" });
    const health = await readEnergyMeterDataHealth({
      metadataStore,
      workspaceId: project.workspace_id,
      projectId,
      dataSnapshotId: snapshot.id,
      resource: "electricity",
      meterPoints,
    });
    const revision = metadataStore.energyIq.projectSetup.listHierarchyRevisions(projectId).find((candidate) => candidate.id === hierarchyRevisionId);
    const rows = revision ? (JSON.parse(revision.snapshot_json) as { meter_mapping?: { rows?: Array<{ id: string; display_name?: string; presentation?: { device_name?: string } }> } }).meter_mapping?.rows ?? [] : [];
    const names = new Map(rows.map((row) => [row.id, row.presentation?.device_name || row.display_name || row.id]));
    return health.map((meter) => ({
      meterPointId: meter.meterPointId,
      name: names.get(meter.meterPointId) ?? meter.sourceLabel,
      status: meter.status,
      ...(meter.coverageTo ?? meter.readingTo ? { lastReadingAt: meter.coverageTo ?? meter.readingTo } : {}),
    }));
  });
};

const formatTime = (iso: string): string =>
  new Date(iso).toLocaleString("en-SG", { timeZone: "Asia/Singapore", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

const ensureTable = (db: DatabaseSync): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS energyiq_alert_emails (
      project_id TEXT NOT NULL,
      alert_key TEXT NOT NULL,
      sent_at TEXT NOT NULL,
      PRIMARY KEY (project_id, alert_key)
    )
  `);
};
