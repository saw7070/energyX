import type { MetadataStore } from "@datafoundry/metadata";

import { loadPasswordAuthConfig } from "../auth/config.js";
import { createMailDelivery, type MailDelivery } from "../email/mail-delivery.js";
import { sendPendingAlertEmails, type AlertEmail } from "./energy-alert-emails.js";
import { evaluateSiteChecks, localDate, shiftDate, type OvernightFinding, type PortfolioBudgetStatus } from "./energy-portfolio.js";
import { readerForWorkspace, siteAlertRecipients } from "./energy-recipients.js";

/**
 * Once a day per site, after the night's readings are in: is the month heading over budget, and was last night's use
 * unusually high? Each finding becomes an alert in the bell (kept, so it is shown once per person) and, unless turned
 * off, one email to the people who run the site.
 */
const CHECK_INTERVAL_MS = 60 * 60_000;
/** Late enough that the nightly update (02:00) and the morning's live readings are in. */
const CHECK_FROM_LOCAL_HOUR = 7;
/** An overnight finding about an older night (for example from a late file upload) is not news any more. */
const OVERNIGHT_NEWS_DAYS = 3;

export type TargetAlert =
  | { kind: "budget"; key: string; status: "at-risk" | "over"; budget: PortfolioBudgetStatus }
  | { kind: "overnight"; key: string; finding: OvernightFinding };

export const targetAlertsFor = (checks: { budget?: PortfolioBudgetStatus; overnight?: OvernightFinding }, today: string): TargetAlert[] => {
  const alerts: TargetAlert[] = [];
  const budget = checks.budget;
  if (budget && (budget.status === "at-risk" || budget.status === "over")) {
    alerts.push({ kind: "budget", key: `budget:${budget.month}:${budget.status}`, status: budget.status, budget });
  }
  if (checks.overnight && checks.overnight.night >= shiftDate(today, -OVERNIGHT_NEWS_DAYS)) {
    alerts.push({ kind: "overnight", key: `overnight:${checks.overnight.night}`, finding: checks.overnight });
  }
  return alerts;
};

export const targetAlertEmail = (site: string, alert: TargetAlert, publicBaseUrl: string, projectId: string): AlertEmail => {
  const link = publicBaseUrl
    ? `\n\nOpen in EnergyX: ${publicBaseUrl.replace(/\/$/u, "")}/energyiq/portfolio?projectId=${encodeURIComponent(projectId)}`
    : "";
  if (alert.kind === "overnight") {
    const finding = alert.finding;
    return {
      key: alert.key,
      subject: `${site}: unusual overnight use on ${formatDate(finding.night)}`,
      text: [
        `Between midnight and 6am on ${formatDate(finding.night)}, ${site} drew ${formatNumber(finding.nightKw, 1)} kW on average, ${finding.abovePct}% above its usual ${formatNumber(finding.usualKw, 1)} kW over the previous ${finding.nightsCompared} nights.`,
        "",
        `That is about ${formatNumber(finding.extraKwh, 0)} kWh more than a normal night. Worth checking for equipment left running: air-conditioning, lighting, pumps or process loads on a timer that did not switch off.`,
      ].join("\n") + link,
    };
  }
  const budget = alert.budget;
  const mark = currencyMark(budget.currency);
  const money = budget.forecastCost !== undefined && budget.actualCost !== undefined;
  const month = formatMonth(budget.month);
  const lines = alert.status === "over"
    ? [money
      ? `${site} has spent ${mark}${formatNumber(budget.actualCost!, 0)} on electricity in ${month}, above its budget of ${mark}${formatNumber(budget.budgetAmount, 0)}.`
      : `${site} has used ${formatNumber(budget.actualKwh, 0)} kWh in ${month}, above its budget of ${formatNumber(budget.budgetKwh ?? 0, 0)} kWh.`]
    : [money
      ? `${site} is on course to spend about ${mark}${formatNumber(budget.forecastCost!, 0)} on electricity in ${month}, above its budget of ${mark}${formatNumber(budget.budgetAmount, 0)}. So far: ${mark}${formatNumber(budget.actualCost!, 0)}.`
      : `${site} is on course to use about ${formatNumber(budget.forecastKwh, 0)} kWh in ${month}, above its budget of ${formatNumber(budget.budgetKwh ?? 0, 0)} kWh. So far: ${formatNumber(budget.actualKwh, 0)} kWh.`];
  return {
    key: alert.key,
    subject: alert.status === "over" ? `${site}: over budget for ${month}` : `${site}: heading over budget for ${month}`,
    text: [...lines, "", "The forecast adds a typical day, based on the last four weeks, for each day left in the month."].join("\n") + link,
  };
};

export type EnergyTargetsMonitor = { start(): void; stop(): void; runOnce(): Promise<void> };

export const createEnergyTargetsMonitor = (input: {
  metadataStore: MetadataStore;
  env?: NodeJS.ProcessEnv;
  delivery?: MailDelivery;
  fallbackReaderUserId?: string;
  now?: () => Date;
}): EnergyTargetsMonitor => {
  const env = input.env ?? process.env;
  const now = input.now ?? (() => new Date());
  const delivery = input.delivery ?? createMailDelivery(env);
  const emailsOn = env.ENERGYIQ_TARGET_ALERT_EMAILS?.trim().toLowerCase() !== "false";
  const publicBaseUrl = loadPasswordAuthConfig(env).publicBaseUrl;
  /** The local day each site was last checked, so the hourly tick does the work once a day. */
  const checked = new Map<string, string>();
  let timer: NodeJS.Timeout | undefined;
  let kickoff: NodeJS.Timeout | undefined;
  let running: Promise<void> | undefined;
  const runOnce = (): Promise<void> => {
    running ??= (async () => {
      try {
        const projects = input.metadataStore.workspaces.list()
          .filter((workspace) => workspace.kind === "customer" && !workspace.disabled_at)
          .flatMap((workspace) => input.metadataStore.energyIq.listProjectsByWorkspace(workspace.id))
          .filter((candidate) => candidate.status === "published");
        for (const project of projects) {
          const at = now();
          const local = localDate(at, project.timezone);
          const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: project.timezone, hour: "2-digit", hourCycle: "h23" }).format(at));
          if (checked.get(project.id) === local || hour < CHECK_FROM_LOCAL_HOUR) continue;
          try {
            const targets = input.metadataStore.energyIq.targets.getTargets(project.id);
            if (!targets.budget && !targets.overnight.enabled) {
              checked.set(project.id, local);
              continue;
            }
            const reader = readerForWorkspace(input.metadataStore, project.workspace_id, input.fallbackReaderUserId);
            if (!reader) {
              checked.set(project.id, local);
              continue;
            }
            const checks = await evaluateSiteChecks({
              metadataStore: input.metadataStore,
              user: reader,
              workspaceId: project.workspace_id,
              projectId: project.id,
              ...(targets.budget ? { budget: targets.budget } : {}),
              overnight: targets.overnight,
              now: at,
            });
            const fresh = targetAlertsFor(checks, local).filter((alert) => input.metadataStore.energyIq.targets.recordAlert({
              projectId: project.id,
              key: alert.key,
              kind: alert.kind,
              payload: alert.kind === "budget" ? { ...alert.budget } : { ...alert.finding },
              now: at,
            }));
            checked.set(project.id, local);
            if (fresh.length === 0 || !emailsOn || delivery.mode === "off") continue;
            const sent = await sendPendingAlertEmails({
              metadataStore: input.metadataStore,
              projectId: project.id,
              emails: fresh.map((alert) => targetAlertEmail(project.name, alert, publicBaseUrl, project.id)),
              recipients: siteAlertRecipients(input.metadataStore, project.id),
              send: delivery.send,
            });
            for (const key of sent) console.log(`[target-alert] emailed project=${project.id} alert=${key.split(":")[0]}`);
          } catch (error) {
            console.error(`[target-alert] failed project=${project.id} code=${error instanceof Error ? error.message.slice(0, 160) : "unknown"}`);
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
      if (timer || env.ENERGYIQ_TARGETS_MONITOR_ENABLED?.trim().toLowerCase() === "false") return;
      timer = setInterval(() => void runOnce(), CHECK_INTERVAL_MS);
      timer.unref();
      kickoff = setTimeout(() => void runOnce(), 60_000);
      kickoff.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      if (kickoff) clearTimeout(kickoff);
      timer = undefined;
      kickoff = undefined;
    },
    runOnce,
  };
};

export const currencyMark = (currency: string): string => (currency === "SGD" ? "S$" : currency === "MYR" ? "RM" : `${currency} `);
const formatNumber = (value: number, digits: number): string => new Intl.NumberFormat("en-SG", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
const formatDate = (date: string): string => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-SG", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
const formatMonth = (month: string): string => new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-SG", { timeZone: "UTC", month: "long", year: "numeric" });
