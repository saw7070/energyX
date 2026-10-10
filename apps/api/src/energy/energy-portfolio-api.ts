import type { IncomingMessage } from "node:http";
import { createSuccessResult } from "@datafoundry/contracts";
import { gridEmissionFactorFor, type EnergyIqReportScheduleInput, type MetadataStore, type UserRecord } from "@datafoundry/metadata";

import { loadPasswordAuthConfig } from "../auth/config.js";
import { createMailDelivery } from "../email/mail-delivery.js";
import type { ConfigApiContext, ConfigApiResponse } from "../routes/types.js";
import { can, resolveEnergyPermissions } from "./energy-permissions.js";
import { resolveEnergyProjectCapabilities } from "./energy-project-capabilities.js";
import { renderPortfolioPdf, portfolioPdfFileName } from "./energy-portfolio-pdf.js";
import {
  buildPortfolio,
  evaluateSiteChecks,
  parsePortfolioPeriod,
  portfolioProjectIds,
  readSiteFigures,
  shiftDate,
} from "./energy-portfolio.js";
import { deliverScheduledReport, latestReportPeriod } from "./energy-report-delivery.js";
import { workspaceTeam } from "./energy-recipients.js";

/**
 * Company-wide views and settings an energy manager uses:
 *   GET  portfolio?from&to                 every site side by side (JSON)
 *   GET  portfolio/pdf?from&to             the same as a PDF
 *   GET  portfolio/carbon.csv?from&to      monthly kWh and CO2e per site, for sustainability reporting
 *   GET  projects/:id/targets[?status=1]   a site's budget, carbon factor and overnight check (+ where it stands now)
 *   PUT  projects/:id/targets              change them (people allowed to change hours and rates)
 *   GET|POST report-schedules, PUT|DELETE report-schedules/:id, POST report-schedules/:id/send
 *                                          scheduled report emails (people allowed to manage the client's people)
 * Returns undefined for any other path.
 */
const NO_STORE = { "Cache-Control": "private, no-store" };
const MAX_CARBON_MONTHS = 24;

export const handlePortfolioApi = async (
  request: IncomingMessage,
  segments: string[],
  context: Required<ConfigApiContext>,
  user: UserRecord,
  helpers: { readJsonBody: (request: IncomingMessage) => Promise<unknown> },
): Promise<ConfigApiResponse | undefined> => {
  const method = request.method ?? "GET";
  const params = new URL(request.url ?? "/", "http://localhost").searchParams;
  const metadataStore = context.metadataStore;

  if (segments[0] === "portfolio" && method === "GET") {
    const period = parsePortfolioPeriod(params.get("from"), params.get("to"));
    if (segments.length === 1) {
      const portfolio = await buildPortfolio({ metadataStore, user, workspaceId: context.workspaceId, period });
      return { status: 200, headers: NO_STORE, body: createSuccessResult(portfolio) };
    }
    if (segments.length === 2 && segments[1] === "pdf") {
      const portfolio = await buildPortfolio({ metadataStore, user, workspaceId: context.workspaceId, period, budgetAsOf: shiftDate(period.to, 1) });
      const pdf = await renderPortfolioPdf(portfolio);
      return {
        status: 200,
        headers: { ...NO_STORE, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${portfolioPdfFileName(portfolio)}"` },
        body: pdf,
      };
    }
    if (segments.length === 2 && segments[1] === "carbon.csv") {
      return { status: 200, headers: { ...NO_STORE, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=\"energyx-carbon-scope2.csv\"" }, body: await carbonCsv(metadataStore, user, context.workspaceId, period) };
    }
  }

  if (segments[0] === "projects" && segments[2] === "targets" && segments.length === 3) {
    const projectId = decodeURIComponent(segments[1] ?? "");
    const project = metadataStore.energyIq.getProject(projectId);
    if (project.workspace_id !== context.workspaceId) throw new Error("ENERGYIQ_PROJECT_FORBIDDEN");
    const capabilities = resolveEnergyProjectCapabilities({ metadataStore, userId: user.id, workspaceId: context.workspaceId, projectId });
    if (!capabilities.readProjectInformation) throw new Error("ENERGYIQ_PROJECT_FORBIDDEN");
    const canEdit = can(resolveEnergyPermissions(metadataStore, user, context.workspaceId), "hours_rate", "write");
    if (method === "PUT") {
      if (!canEdit) throw new Error("ENERGYIQ_PROJECT_FORBIDDEN");
      const body = asRecord(await helpers.readJsonBody(request));
      metadataStore.energyIq.targets.setTargets(projectId, {
        ...(body.budget === null ? { budget: null } : isRecord(body.budget) ? { budget: body.budget as never } : {}),
        ...(body.carbon === null ? { carbon: null } : isRecord(body.carbon) ? { carbon: body.carbon as never } : {}),
        ...(isRecord(body.overnight) ? { overnight: body.overnight as never } : {}),
      }, user.id);
    } else if (method !== "GET") {
      return undefined;
    }
    const targets = metadataStore.energyIq.targets.getTargets(projectId);
    const gridFactor = gridEmissionFactorFor(project.region);
    let status: Awaited<ReturnType<typeof evaluateSiteChecks>> | undefined;
    if (method === "GET" && params.get("status") === "1" && capabilities.readReports && project.status === "published") {
      try {
        status = await evaluateSiteChecks({
          metadataStore, user, workspaceId: context.workspaceId, projectId,
          ...(targets.budget ? { budget: targets.budget } : {}),
          overnight: targets.overnight,
          now: new Date(),
        });
      } catch {
        status = undefined;
      }
    }
    return {
      status: 200,
      headers: NO_STORE,
      body: createSuccessResult({
        projectId,
        ...(targets.budget ? { budget: targets.budget } : {}),
        carbon: targets.carbon ?? gridFactor,
        gridCarbon: gridFactor,
        overnight: targets.overnight,
        currency: project.region?.country === "MY" ? "MYR" : "SGD",
        canEdit,
        ...(targets.updatedAt ? { updatedAt: targets.updatedAt } : {}),
        ...(status ? { status } : {}),
      }),
    };
  }

  if (segments[0] === "report-schedules") {
    const permissions = resolveEnergyPermissions(metadataStore, user, context.workspaceId);
    if (!can(permissions, "people", "write")) throw new Error("ENERGYIQ_REPORT_SCHEDULES_FORBIDDEN");
    const targets = metadataStore.energyIq.targets;
    const scheduleId = segments[1] ? decodeURIComponent(segments[1]) : undefined;
    const owned = (id: string) => {
      const schedule = targets.getSchedule(id);
      if (!schedule || schedule.workspaceId !== context.workspaceId) throw new Error("ENERGYIQ_REPORT_SCHEDULE_NOT_FOUND");
      return schedule;
    };
    if (segments.length === 1 && method === "GET") {
      return { status: 200, headers: NO_STORE, body: createSuccessResult(schedulesView(metadataStore, context.workspaceId)) };
    }
    if (segments.length === 1 && method === "POST") {
      const body = scheduleInput(metadataStore, context.workspaceId, asRecord(await helpers.readJsonBody(request)));
      targets.createSchedule(context.workspaceId, body, user.id);
      return { status: 201, headers: NO_STORE, body: createSuccessResult(schedulesView(metadataStore, context.workspaceId)) };
    }
    if (segments.length === 2 && scheduleId && method === "PUT") {
      owned(scheduleId);
      targets.updateSchedule(scheduleId, scheduleInput(metadataStore, context.workspaceId, asRecord(await helpers.readJsonBody(request)), true));
      return { status: 200, headers: NO_STORE, body: createSuccessResult(schedulesView(metadataStore, context.workspaceId)) };
    }
    if (segments.length === 2 && scheduleId && method === "DELETE") {
      owned(scheduleId);
      targets.deleteSchedule(scheduleId);
      return { status: 200, headers: NO_STORE, body: createSuccessResult(schedulesView(metadataStore, context.workspaceId)) };
    }
    if (segments.length === 3 && scheduleId && segments[2] === "send" && method === "POST") {
      const schedule = owned(scheduleId);
      const period = latestReportPeriod(schedule.frequency, schedule.timezone, new Date());
      const outcome = await deliverScheduledReport({
        metadataStore,
        schedule,
        period,
        delivery: createMailDelivery(),
        publicBaseUrl: loadPasswordAuthConfig(process.env).publicBaseUrl,
      });
      return { status: 200, headers: NO_STORE, body: createSuccessResult({ outcome, period, ...schedulesView(metadataStore, context.workspaceId) }) };
    }
  }
  return undefined;
};

const schedulesView = (metadataStore: MetadataStore, workspaceId: string) => {
  const targets = metadataStore.energyIq.targets;
  const team = workspaceTeam(metadataStore, workspaceId);
  const projects = metadataStore.energyIq.listProjectsByWorkspace(workspaceId).filter((project) => project.status === "published");
  return {
    schedules: targets.listSchedules(workspaceId).map((schedule) => {
      const last = targets.lastDelivery(schedule.id);
      return { ...schedule, ...(last ? { lastDelivery: last } : {}), nextPeriod: latestReportPeriod(schedule.frequency, schedule.timezone, new Date()) };
    }),
    team: team.map((member) => ({
      userId: member.user.id,
      email: member.email,
      ...(member.user.display_name ? { name: member.user.display_name } : {}),
      canReadReports: can(member.permissions, "reports", "read"),
    })).sort((left, right) => (left.name ?? left.email).localeCompare(right.name ?? right.email)),
    sites: projects.map((project) => ({ id: project.id, name: project.name })),
    defaultTimezone: projects[0]?.timezone ?? "Asia/Singapore",
    emailMode: createMailDelivery().mode,
  };
};

/** Recipients must be on this client's team and sites must belong to it; anything else is refused. */
const scheduleInput = (metadataStore: MetadataStore, workspaceId: string, body: Record<string, unknown>, partial = false): EnergyIqReportScheduleInput => {
  const team = new Set(workspaceTeam(metadataStore, workspaceId).map((member) => member.user.id));
  const sites = new Set(metadataStore.energyIq.listProjectsByWorkspace(workspaceId).map((project) => project.id));
  if (body.recipientUserIds !== undefined && (!Array.isArray(body.recipientUserIds) || body.recipientUserIds.some((id) => typeof id !== "string" || !team.has(id)))) {
    throw new Error("ENERGYIQ_REPORT_SCHEDULE_RECIPIENTS_INVALID");
  }
  if (body.projectIds !== undefined && (!Array.isArray(body.projectIds) || body.projectIds.some((id) => typeof id !== "string" || !sites.has(id)))) {
    throw new Error("ENERGYIQ_REPORT_SCHEDULE_PROJECTS_INVALID");
  }
  if (!partial && body.recipientUserIds === undefined) throw new Error("ENERGYIQ_REPORT_SCHEDULE_RECIPIENTS_REQUIRED");
  const defaultTimezone = metadataStore.energyIq.listProjectsByWorkspace(workspaceId)[0]?.timezone ?? "Asia/Singapore";
  return {
    name: body.name,
    frequency: body.frequency,
    recipientUserIds: body.recipientUserIds,
    ...(body.projectIds !== undefined ? { projectIds: body.projectIds } : {}),
    ...(body.localHour !== undefined ? { localHour: body.localHour } : {}),
    ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    ...(partial ? {} : { timezone: typeof body.timezone === "string" ? body.timezone : defaultTimezone }),
  };
};

/**
 * One row per site and month: official kWh, the emission factor applied and the resulting tonnes of CO2e. Months
 * are cut to the requested dates, so the first and last rows can be part months.
 */
const carbonCsv = async (metadataStore: MetadataStore, user: UserRecord, workspaceId: string, period: { from: string; to: string }): Promise<Buffer> => {
  const months: Array<{ from: string; to: string; month: string }> = [];
  for (let start = period.from; start <= period.to;) {
    const nextMonth = shiftDate(`${start.slice(0, 7)}-01`, 32).slice(0, 7);
    const end = shiftDate(`${nextMonth}-01`, -1);
    months.push({ from: start, to: end < period.to ? end : period.to, month: start.slice(0, 7) });
    start = `${nextMonth}-01`;
  }
  if (months.length > MAX_CARBON_MONTHS) throw new Error("ENERGYIQ_PORTFOLIO_PERIOD_TOO_LONG");
  const rows: Array<Array<string | number>> = [[
    "Site", "Country", "State", "Month", "From", "To", "Electricity (kWh)", "Emission factor (kg CO2e/kWh)",
    "Factor year", "Factor source", "Factor basis", "Scope 2 emissions (t CO2e)", "Readings coverage (%)",
  ]];
  for (const projectId of portfolioProjectIds({ metadataStore, user, workspaceId })) {
    const project = metadataStore.energyIq.getProject(projectId);
    const factor = metadataStore.energyIq.targets.getTargets(projectId).carbon ?? gridEmissionFactorFor(project.region);
    for (const month of months) {
      let kwh: number | undefined;
      let coverage: number | undefined;
      try {
        const { figures } = await readSiteFigures({ metadataStore, user, workspaceId, projectId, from: month.from, to: month.to });
        kwh = figures.headline.summary.usageKwh;
        coverage = figures.headline.dataHealth.coveragePct;
      } catch {
        kwh = undefined;
      }
      rows.push([
        project.name, project.region?.country ?? "", project.region?.state ?? "", month.month, month.from, month.to,
        kwh === undefined ? "" : kwh.toFixed(2),
        factor.kgCo2ePerKwh,
        factor.year,
        `${factor.source}${factor.provisional ? " (provisional)" : ""}`,
        factor.basis === "grid" ? "Location-based grid average" : "Entered by customer",
        kwh === undefined ? "" : ((kwh * factor.kgCo2ePerKwh) / 1000).toFixed(3),
        coverage === undefined ? "" : coverage.toFixed(1),
      ]);
    }
  }
  const cell = (value: string | number) => {
    const text = String(value);
    const safe = /^[=+\-@\t\r]/u.test(text) && typeof value === "string" ? `'${text}` : text;
    return /[",\r\n]/u.test(safe) ? `"${safe.replace(/"/gu, "\"\"")}"` : safe;
  };
  return Buffer.from(`﻿${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`, "utf8");
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const asRecord = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) throw new Error("ENERGYIQ_INVALID_BODY");
  return value;
};
