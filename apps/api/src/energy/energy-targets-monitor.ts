import type { MetadataStore } from "@datafoundry/metadata";

import { loadPasswordAuthConfig } from "../auth/config.js";
import { createMailDelivery, type MailDelivery } from "../email/mail-delivery.js";
import { defineBackgroundJob } from "../observability/background-jobs.js";
import { logger } from "../observability/logger.js";
import { sendPendingAlertEmails, type AlertEmail } from "./energy-alert-emails.js";
import { evaluateSiteChecks, localDate, shiftDate, type OvernightFinding, type PeakDemandStatus, type PortfolioBudgetStatus } from "./energy-portfolio.js";
import { readerForWorkspace, siteAlertRecipients } from "./energy-recipients.js";

/**
 * Once a day per site, after the night's readings are in: is the month heading over budget, was last night's use
 * unusually high, and did demand reach the site's limit or set a new high? Each finding becomes an alert in the bell
 * (kept, so it is shown once per person) and, unless turned off, one email to the site's alert recipients.
 */
const CHECK_INTERVAL_MS = 60 * 60_000;
/** Late enough that the nightly update (02:00) and the morning's live readings are in. */
const CHECK_FROM_LOCAL_HOUR = 7;
/** An overnight finding about an older night (for example from a late file upload) is not news any more. */
const OVERNIGHT_NEWS_DAYS = 3;
const log = logger.child({ component: "target-alert" });

export type TargetAlert =
  | { kind: "budget"; key: string; status: "at-risk" | "over"; budget: PortfolioBudgetStatus }
  | { kind: "overnight"; key: string; finding: OvernightFinding }
  | { kind: "peak"; key: string; reason: "near" | "over" | "high"; peak: PeakDemandStatus };

export const targetAlertsFor = (checks: { budget?: PortfolioBudgetStatus; overnight?: OvernightFinding; peak?: PeakDemandStatus }, today: string): TargetAlert[] => {
  const alerts: TargetAlert[] = [];
  const peak = checks.peak;
  if (peak && (peak.limitStatus === "near" || peak.limitStatus === "over")) {
    // Once a month for each step: reaching the warning level, then going over.
    alerts.push({ kind: "peak", key: `peak:${peak.month}:${peak.limitStatus}`, reason: peak.limitStatus, peak });
  } else if (peak?.newHigh && peak.latestDay >= shiftDate(today, -OVERNIGHT_NEWS_DAYS)) {
    alerts.push({ kind: "peak", key: `peak:${peak.latestDay}:high`, reason: "high", peak });
  }
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
  if (alert.kind === "peak") return peakAlertEmail(site, alert, link);
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
  const job = defineBackgroundJob("target-alert", { staleAfterMs: 3 * CHECK_INTERVAL_MS });
  let timer: NodeJS.Timeout | undefined;
  let kickoff: NodeJS.Timeout | undefined;
  let running: Promise<void> | undefined;
  const runOnce = (): Promise<void> => {
    running ??= (async () => {
      job.heartbeat();
      const projects = input.metadataStore.workspaces.list()
        .filter((workspace) => workspace.kind === "customer" && !workspace.disabled_at)
        .flatMap((workspace) => input.metadataStore.energyIq.listProjectsByWorkspace(workspace.id))
        .filter((candidate) => candidate.status === "published");
      for (const project of projects) {
        const at = now();
        const local = localDate(at, project.timezone);
        const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: project.timezone, hour: "2-digit", hourCycle: "h23" }).format(at));
        if (checked.get(project.id) === local || hour < CHECK_FROM_LOCAL_HOUR) continue;
        let failed = false;
        try {
          const targets = input.metadataStore.energyIq.targets.getTargets(project.id);
          if (!targets.budget && !targets.overnight.enabled && !targets.peak.enabled) {
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
            peak: targets.peak,
            now: at,
          });
          const fresh = targetAlertsFor(checks, local).filter((alert) => input.metadataStore.energyIq.targets.recordAlert({
            projectId: project.id,
            key: alert.key,
            kind: alert.kind,
            payload: alert.kind === "budget" ? { ...alert.budget } : alert.kind === "peak" ? { ...alert.peak, reason: alert.reason } : { ...alert.finding },
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
          for (const key of sent) log.info("emailed", { project_id: project.id, alert: key.split(":")[0] });
        } catch (error) {
          failed = true;
          log.error("failed", { project_id: project.id, code: error instanceof Error ? error.message.slice(0, 160) : "unknown" });
          job.failed(error, project.id);
        } finally {
          // The early `continue`s above are finished checks too.
          if (!failed) job.succeeded(project.id);
        }
      }
    })().finally(() => {
      // Cleared here, not inside the pass: a pass with nothing to await finishes before `running` is
      // assigned, so clearing it inside would leave the finished pass in place and skip every later run.
      running = undefined;
    });
    return running;
  };
  return {
    start() {
      if (timer || env.ENERGYIQ_TARGETS_MONITOR_ENABLED?.trim().toLowerCase() === "false") return;
      job.start();
      timer = setInterval(() => void runOnce(), CHECK_INTERVAL_MS);
      timer.unref();
      kickoff = setTimeout(() => void runOnce(), 60_000);
      kickoff.unref();
    },
    stop() {
      if (timer) job.stop();
      if (timer) clearInterval(timer);
      if (kickoff) clearTimeout(kickoff);
      timer = undefined;
      kickoff = undefined;
    },
    runOnce,
  };
};

const peakAlertEmail = (site: string, alert: Extract<TargetAlert, { kind: "peak" }>, link: string): AlertEmail => {
  const peak = alert.peak;
  const when = new Date(peak.peakAt).toLocaleString("en-SG", { timeZone: "Asia/Singapore", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const hours = peak.peakHoursOnly ? " during the tariff's peak hours" : "";
  const charge = peak.demandCharge
    ? `At ${currencyMark(peak.demandCharge.currency)}${formatNumber(peak.demandCharge.perKwMonth, 2)} per kW a month, this month's maximum demand charge is about ${currencyMark(peak.demandCharge.currency)}${formatNumber(peak.demandCharge.amount, 0)}, before tax.`
    : "";
  const lines = alert.reason === "high"
    ? [
      `On ${formatDate(peak.latestDay)}, ${site} reached ${formatNumber(peak.latestDayPeakKw, 1)} kW${hours}, its highest half-hour demand in 30 days (before that: ${formatNumber(peak.previousPeakKw ?? 0, 1)} kW).`,
      "",
      "Maximum demand is billed on the single highest half-hour of the month, so one short spike sets the charge for the whole month. Worth checking what was running at the same time: air-conditioning starting together, pumps, chillers or equipment switched on at once.",
    ]
    : [
      `${site}'s highest half-hour demand this month is ${formatNumber(peak.peakKw, 1)} kW${hours}, set ${when}. That is ${formatNumber(peak.peakKw / (peak.limitKw ?? 1) * 100, 0)}% of its ${formatNumber(peak.limitKw ?? 0, 1)} kW limit${alert.reason === "over" ? ", over the limit" : ""}.`,
      "",
      alert.reason === "over"
        ? "Going over contracted capacity or a maximum-demand target can bring a higher charge or a penalty. Worth checking what was running then, and staggering large loads so they do not start together."
        : `This is the ${peak.warnPct}% warning. Staggering large loads (air-conditioning, pumps, chillers) so they do not start together keeps demand below the limit.`,
    ];
  return {
    key: alert.key,
    subject: alert.reason === "high"
      ? `${site}: highest demand in 30 days on ${formatDate(peak.latestDay)}`
      : alert.reason === "over" ? `${site}: demand went over its ${formatNumber(peak.limitKw ?? 0, 0)} kW limit` : `${site}: demand reached ${peak.warnPct}% of its limit`,
    text: [...lines, ...(charge ? ["", charge] : [])].join("\n") + link,
  };
};

export const currencyMark = (currency: string): string => (currency === "SGD" ? "S$" : currency === "MYR" ? "RM" : `${currency} `);
const formatNumber = (value: number, digits: number): string => new Intl.NumberFormat("en-SG", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
const formatDate = (date: string): string => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-SG", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
const formatMonth = (month: string): string => new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-SG", { timeZone: "UTC", month: "long", year: "numeric" });
