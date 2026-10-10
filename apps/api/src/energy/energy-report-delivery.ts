import type { EnergyIqReportScheduleRecord, MetadataStore, UserRecord } from "@datafoundry/metadata";

import { loadPasswordAuthConfig } from "../auth/config.js";
import { createMailDelivery, type MailDelivery } from "../email/mail-delivery.js";
import { renderPortfolioPdf, portfolioPdfFileName } from "./energy-portfolio-pdf.js";
import { buildPortfolio, localDate, portfolioProjectIds, shiftDate, type Portfolio, type PortfolioPeriod } from "./energy-portfolio.js";
import { currencyMark } from "./energy-targets-monitor.js";

/**
 * Scheduled report emails: a PDF of the company's sites for last week (sent Monday) or last month (sent on the 1st),
 * at the hour the schedule asks for in its time zone. Each recipient only gets the sites they may read; recipients
 * who see the same sites share one PDF. A period is sent once; a failed send is tried again hourly, five times.
 */
const CHECK_INTERVAL_MS = 15 * 60_000;
const MAX_ATTEMPTS = 5;
const RETRY_AFTER_MS = 60 * 60_000;

export type ReportPeriod = PortfolioPeriod & { key: string; dueDate: string };

/** The most recent finished week (Monday to Sunday) or calendar month in the schedule's time zone. */
export const latestReportPeriod = (frequency: EnergyIqReportScheduleRecord["frequency"], timezone: string, now: Date): ReportPeriod => {
  const today = localDate(now, timezone);
  if (frequency === "weekly") {
    const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
    const monday = shiftDate(today, -((weekday + 6) % 7));
    const from = shiftDate(monday, -7);
    return { from, to: shiftDate(monday, -1), key: `week:${from}`, dueDate: monday };
  }
  const monthStart = `${today.slice(0, 7)}-01`;
  const to = shiftDate(monthStart, -1);
  return { from: `${to.slice(0, 7)}-01`, to, key: `month:${to.slice(0, 7)}`, dueDate: monthStart };
};

export const isReportDue = (schedule: EnergyIqReportScheduleRecord, period: ReportPeriod, now: Date): boolean => {
  const today = localDate(now, schedule.timezone);
  const hour = localHour(now, schedule.timezone);
  const due = today > period.dueDate || hour >= schedule.localHour;
  // A schedule made after this period's send time starts with the next period, not a surprise catch-up email.
  const createdDate = localDate(new Date(schedule.createdAt), schedule.timezone);
  const createdHour = localHour(new Date(schedule.createdAt), schedule.timezone);
  const existedAtDueTime = createdDate < period.dueDate || (createdDate === period.dueDate && createdHour < schedule.localHour);
  return due && existedAtDueTime;
};

export type ReportDeliveryOutcome = { status: "sent" | "failed" | "skipped"; recipientCount: number; error?: string };

/** Builds and emails one schedule's report for one period, and records the outcome. */
export const deliverScheduledReport = async (input: {
  metadataStore: MetadataStore;
  schedule: EnergyIqReportScheduleRecord;
  period: ReportPeriod;
  delivery: MailDelivery;
  publicBaseUrl: string;
  now?: Date;
}): Promise<ReportDeliveryOutcome> => {
  const now = input.now ?? new Date();
  const groups = recipientGroups(input.metadataStore, input.schedule);
  const recipientCount = groups.reduce((total, group) => total + group.emails.length, 0);
  if (recipientCount === 0) {
    input.metadataStore.energyIq.targets.recordDelivery({ scheduleId: input.schedule.id, periodKey: input.period.key, status: "skipped", recipientCount: 0, error: "No recipient can read any of the sites", now });
    return { status: "skipped", recipientCount: 0 };
  }
  if (input.delivery.mode === "off") {
    input.metadataStore.energyIq.targets.recordDelivery({ scheduleId: input.schedule.id, periodKey: input.period.key, status: "failed", recipientCount, error: "Email is not set up on the server", now });
    return { status: "failed", recipientCount, error: "ENERGYIQ_MAIL_NOT_CONFIGURED" };
  }
  try {
    for (const group of groups) {
      const portfolio = await buildPortfolio({
        metadataStore: input.metadataStore,
        user: group.reader,
        workspaceId: input.schedule.workspaceId,
        period: { from: input.period.from, to: input.period.to },
        projectIds: group.projectIds,
        budgetAsOf: shiftDate(input.period.to, 1),
        now,
      });
      const frequencyLabel = input.schedule.frequency === "weekly" ? "Weekly report" : "Monthly report";
      const pdf = await renderPortfolioPdf(portfolio, { title: input.schedule.name, frequencyLabel });
      await input.delivery.send({
        to: group.emails,
        subject: `${input.schedule.name}: ${portfolio.workspaceName}, ${periodLabel(input.period, input.schedule.frequency)}`,
        text: reportEmailText(portfolio, input.schedule, input.period, input.publicBaseUrl),
        attachments: [{ filename: portfolioPdfFileName(portfolio), content: pdf, contentType: "application/pdf" }],
      });
    }
    input.metadataStore.energyIq.targets.recordDelivery({ scheduleId: input.schedule.id, periodKey: input.period.key, status: "sent", recipientCount, now });
    return { status: "sent", recipientCount };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 200) : "unknown";
    input.metadataStore.energyIq.targets.recordDelivery({ scheduleId: input.schedule.id, periodKey: input.period.key, status: "failed", recipientCount, error: message, now });
    return { status: "failed", recipientCount, error: message };
  }
};

type RecipientGroup = { reader: UserRecord; emails: string[]; projectIds: string[] };

const recipientGroups = (metadataStore: MetadataStore, schedule: EnergyIqReportScheduleRecord): RecipientGroup[] => {
  const groups = new Map<string, RecipientGroup>();
  for (const userId of schedule.recipientUserIds) {
    let user: UserRecord;
    try {
      user = metadataStore.users.getById({ user_id: userId });
    } catch {
      continue;
    }
    if (!user.email || user.disabled_at) continue;
    let visible: string[];
    try {
      visible = portfolioProjectIds({ metadataStore, user, workspaceId: schedule.workspaceId });
    } catch {
      continue;
    }
    const projectIds = schedule.projectIds.length ? visible.filter((id) => schedule.projectIds.includes(id)) : visible;
    if (projectIds.length === 0) continue;
    const key = [...projectIds].sort().join(",");
    const group = groups.get(key) ?? { reader: user, emails: [], projectIds };
    group.emails.push(user.email.toLowerCase());
    groups.set(key, group);
  }
  return [...groups.values()];
};

export const reportEmailText = (portfolio: Portfolio, schedule: EnergyIqReportScheduleRecord, period: ReportPeriod, publicBaseUrl: string): string => {
  const totals = portfolio.totals;
  const cost = Object.entries(totals.costByCurrency).map(([currency, amount]) => `${currencyMark(currency)}${number(amount, 2)}`).join(" + ");
  const change = totals.previousUsageKwh > 0 ? ((totals.usageKwh - totals.previousUsageKwh) / totals.previousUsageKwh) * 100 : undefined;
  const lines = [
    `${schedule.name} for ${portfolio.workspaceName}, ${periodLabel(period, schedule.frequency)}.`,
    "",
    `Energy: ${number(totals.usageKwh, 0)} kWh${change === undefined ? "" : ` (${change >= 0 ? "+" : ""}${number(change, 0)}% on the previous ${schedule.frequency === "weekly" ? "week" : "period"})`}`,
    ...(cost ? [`Electricity cost: ${cost}`] : []),
    `Carbon emissions: ${number(totals.carbonKg / 1000, 1)} tCO2e (Scope 2, location-based)`,
    ...(totals.sitesOverBudget || totals.sitesAtRisk
      ? [`Budgets: ${totals.sitesOverBudget} site(s) over, ${totals.sitesAtRisk} heading over`]
      : []),
    "",
    "The attached PDF compares every site.",
    ...(publicBaseUrl ? ["", `Open in EnergyX: ${publicBaseUrl.replace(/\/$/u, "")}/energyiq/portfolio`] : []),
    "",
    "You receive this because a team administrator added you to this scheduled report.",
  ];
  return lines.join("\n");
};

export type EnergyReportDeliveryWorker = { start(): void; stop(): void; runOnce(): Promise<void> };

export const createEnergyReportDeliveryWorker = (input: {
  metadataStore: MetadataStore;
  env?: NodeJS.ProcessEnv;
  delivery?: MailDelivery;
  now?: () => Date;
}): EnergyReportDeliveryWorker => {
  const env = input.env ?? process.env;
  const now = input.now ?? (() => new Date());
  const delivery = input.delivery ?? createMailDelivery(env);
  const publicBaseUrl = loadPasswordAuthConfig(env).publicBaseUrl;
  let timer: NodeJS.Timeout | undefined;
  let kickoff: NodeJS.Timeout | undefined;
  let running: Promise<void> | undefined;
  const runOnce = (): Promise<void> => {
    running ??= (async () => {
      try {
        for (const schedule of input.metadataStore.energyIq.targets.listEnabledSchedules()) {
          const at = now();
          const period = latestReportPeriod(schedule.frequency, schedule.timezone, at);
          if (!isReportDue(schedule, period, at)) continue;
          const previous = input.metadataStore.energyIq.targets.findDelivery(schedule.id, period.key);
          if (previous && (previous.status !== "failed" || previous.attempts >= MAX_ATTEMPTS
            || at.getTime() - Date.parse(previous.updatedAt) < RETRY_AFTER_MS)) continue;
          const outcome = await deliverScheduledReport({ metadataStore: input.metadataStore, schedule, period, delivery, publicBaseUrl, now: at });
          console.log(`[report-email] ${outcome.status} schedule=${schedule.id} period=${period.key} recipients=${outcome.recipientCount}${outcome.error ? ` code=${outcome.error.slice(0, 120)}` : ""}`);
        }
      } catch (error) {
        console.error(`[report-email] failed code=${error instanceof Error ? error.message.slice(0, 160) : "unknown"}`);
      } finally {
        running = undefined;
      }
    })();
    return running;
  };
  return {
    start() {
      if (timer || env.ENERGYIQ_REPORT_EMAILS_ENABLED?.trim().toLowerCase() === "false") return;
      timer = setInterval(() => void runOnce(), CHECK_INTERVAL_MS);
      timer.unref();
      kickoff = setTimeout(() => void runOnce(), 90_000);
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

export const periodLabel = (period: PortfolioPeriod, frequency: EnergyIqReportScheduleRecord["frequency"]): string => {
  const day = (date: string, withYear: boolean) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-SG", { timeZone: "UTC", day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) });
  if (frequency === "monthly") return new Date(`${period.from}T00:00:00Z`).toLocaleDateString("en-SG", { timeZone: "UTC", month: "long", year: "numeric" });
  return `${day(period.from, false)} to ${day(period.to, true)}`;
};

const localHour = (date: Date, timezone: string): number =>
  Number(new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).format(date));
const number = (value: number, digits: number): string => new Intl.NumberFormat("en-SG", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
