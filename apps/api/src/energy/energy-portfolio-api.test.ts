import { LocalDataGateway } from "@datafoundry/data-gateway";
import { createMetadataStore } from "@datafoundry/metadata";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createMailDelivery } from "../email/mail-delivery.js";
import type { ConfigApiContext } from "../routes/types.js";
import { ensureEnergyIqBootstrap } from "./energy-bootstrap.js";
import { handleEnergyApiRequest } from "./energy-api.js";
import { evaluateSiteChecks } from "./energy-portfolio.js";
import { deliverScheduledReport, latestReportPeriod } from "./energy-report-delivery.js";
import { readSiteAlerts } from "./energy-site-alerts.js";
import { createEnergyTargetsMonitor } from "./energy-targets-monitor.js";
import { materializeTestProjectSnapshot } from "./energy-test-materialization.js";

/**
 * The sample office (Ngee Ann, Singapore) with 1 kWh every 15 minutes across its four official meters from
 * 1 Sep to 9 Oct 2026, and one night (9 Oct, midnight to 6am) at double the usual load.
 */
const PROJECT = "ngee-ann-polytechnic";
const OFFICIAL = [
  ["mapping-lvl-6-total-office-light-8", "l6-total-light"],
  ["mapping-lvl-7-total-office-light-17", "l7-total-light"],
  ["mapping-lvl-6-total-office-load-9", "l6-total-load"],
  ["mapping-lvl-7-total-office-load-18", "l7-total-load"],
] as const;
const SHA = "b".repeat(64);

const facts = () => {
  const rows = [];
  const start = Date.parse("2026-08-31T16:00:00.000Z");
  const end = Date.parse("2026-10-09T16:00:00.000Z");
  const unusualFrom = Date.parse("2026-10-08T16:00:00.000Z");
  const unusualTo = Date.parse("2026-10-08T22:00:00.000Z");
  let row = 0;
  for (let at = start; at < end; at += 15 * 60_000) {
    const kwh = at >= unusualFrom && at < unusualTo ? 0.5 : 0.25;
    for (const [meterPointId, scopeId] of OFFICIAL) {
      row += 1;
      rows.push({
        workspaceId: "default", projectId: PROJECT, importBatchId: "portfolio-fixture", resource: "electricity" as const,
        meterPointId, scopeId, sourceLabel: meterPointId, category: "load", meterRole: "total",
        intervalStart: new Date(at).toISOString(), intervalEnd: new Date(at + 15 * 60_000).toISOString(), elapsedMinutes: 15,
        activeEnergyKwh: row, previousActiveEnergyKwh: row - 1, rawDeltaKwh: kwh, usageKwh: kwh, averageKw: kwh * 4,
        qualityStatus: "ok", localDate: new Date(at + 8 * 3_600_000).toISOString().slice(0, 10), localHour: new Date(at + 8 * 3_600_000).getUTCHours(),
        dayType: "weekday", sourceFile: "fixture.xlsx", sourceSha256: SHA, sourceReadingKind: "interval_usage" as const,
      });
    }
  }
  return rows;
};

const request = (method: string, url = "/", body?: unknown): IncomingMessage => {
  const stream = new PassThrough() as PassThrough & IncomingMessage;
  stream.method = method;
  stream.url = url;
  stream.headers = body === undefined ? {} : { "content-type": "application/json" };
  stream.end(body === undefined ? undefined : JSON.stringify(body));
  return stream;
};

describe("portfolio, budgets, overnight checks and scheduled reports", () => {
  const previousDuckDb = process.env.ENERGYIQ_DUCKDB_PATH;
  let root: string;
  let metadata: ReturnType<typeof createMetadataStore>;
  let context: Required<ConfigApiContext>;
  const call = (method: string, segments: string[], query = "", body?: unknown) =>
    handleEnergyApiRequest(request(method, `/api/v1/energy/${segments.join("/")}${query}`, body), segments, context);

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "energy-portfolio-"));
    process.env.ENERGYIQ_DUCKDB_PATH = join(root, "energy.duckdb");
    metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    ensureEnergyIqBootstrap(metadata);
    await materializeTestProjectSnapshot({
      metadataStore: metadata, databasePath: join(root, "energy.duckdb"), workspaceId: "default", projectId: PROJECT, timezone: "Asia/Singapore",
      batches: [{ importBatchId: "portfolio-fixture", sourceSha256: SHA, rawReadings: [], normalizedReadings: [], intervalFacts: facts(), qualityEvents: [] }],
    });
    context = { metadataStore: metadata, dataGateway: new LocalDataGateway(metadata), userId: "dev-user", workspaceId: "default" } as unknown as Required<ConfigApiContext>;
    metadata.users.createPasswordUser({ id: "facilities", email: "facilities@example.test", display_name: "Facilities Lead" });
    metadata.workspaceMemberships.upsertOwner({ workspace_id: "default", user_id: "facilities" });
  }, 120_000);

  afterEach(() => {
    metadata.close();
    if (previousDuckDb === undefined) delete process.env.ENERGYIQ_DUCKDB_PATH;
    else process.env.ENERGYIQ_DUCKDB_PATH = previousDuckDb;
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it("puts every site side by side with official kWh and Scope 2 carbon, as JSON, PDF and CSV", async () => {
    const response = await call("GET", ["portfolio"], "?from=2026-09-01&to=2026-09-30");
    expect(response.status).toBe(200);
    const portfolio = (response.body as { data: { sites: Array<Record<string, unknown>>; totals: Record<string, unknown> } }).data;
    const site = portfolio.sites.find((candidate) => candidate.projectId === PROJECT)!;
    // 30 days x 96 intervals x 1 kWh, the same total the Overview headline reads.
    expect(site).toMatchObject({ status: "ok", usageKwh: 2880, peakKw: 4, coveragePct: 100, dataStatus: "complete" });
    expect(site.carbonKg).toBeCloseTo(2880 * 0.402, 1);
    expect(site.carbonFactor).toMatchObject({ basis: "grid", grid: "SG", kgCo2ePerKwh: 0.402 });

    const pdf = await call("GET", ["portfolio", "pdf"], "?from=2026-09-01&to=2026-09-30");
    expect(pdf.headers).toMatchObject({ "Content-Type": "application/pdf" });
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe("%PDF-");

    const csv = await call("GET", ["portfolio", "carbon.csv"], "?from=2026-09-15&to=2026-10-09");
    const lines = (csv.body as Buffer).toString("utf8").replace(/^﻿/u, "").trim().split("\r\n");
    const ngeeAnn = lines.filter((line) => line.includes("2026-09-15") || line.includes("2026-10-01"));
    expect(ngeeAnn.some((line) => line.includes(",2026-09,2026-09-15,2026-09-30,1536.00,0.402,2024,") && line.includes(",0.617,100.0"))).toBe(true);
    expect(ngeeAnn.some((line) => line.includes(",2026-10,2026-10-01,2026-10-09,888.00,0.402,"))).toBe(true);

    expect((await call("GET", ["portfolio"], "?from=2026-09-30&to=2026-09-01")).status).toBe(400);
  }, 120_000);

  it("keeps a site's budget and carbon factor, judges the month, and flags an unusual night once", async () => {
    const saved = await call("PUT", ["projects", PROJECT, "targets"], "", {
      budget: { monthlyAmount: 100, currency: "SGD", monthlyKwh: 2000 },
      carbon: { kgCo2ePerKwh: 0.39, year: 2025, source: "Supplier letter" },
    });
    expect(saved.status).toBe(200);
    expect((saved.body as { data: Record<string, unknown> }).data).toMatchObject({
      budget: { monthlyAmount: 100, currency: "SGD", monthlyKwh: 2000 },
      carbon: { basis: "custom", kgCo2ePerKwh: 0.39 },
      gridCarbon: { kgCo2ePerKwh: 0.402 },
      overnight: { enabled: true, thresholdPct: 30 },
    });
    expect((await call("PUT", ["projects", PROJECT, "targets"], "", { carbon: { kgCo2ePerKwh: 402 } })).status).toBe(400);

    const now = new Date("2026-10-10T02:00:00.000Z");
    const user = metadata.users.getById({ user_id: "dev-user" });
    const targets = metadata.energyIq.targets.getTargets(PROJECT);
    const checks = await evaluateSiteChecks({ metadataStore: metadata, user, workspaceId: "default", projectId: PROJECT, budget: targets.budget!, overnight: targets.overnight, now });
    // 9 days x 96 kWh plus the 24 extra kWh of the unusual night; 22 typical days of 96 kWh still to come.
    expect(checks.budget).toMatchObject({ month: "2026-10", dataThrough: "2026-10-09", actualKwh: 888, budgetKwh: 2000, status: "at-risk" });
    expect(checks.budget!.forecastKwh).toBeGreaterThan(2000);
    expect(checks.overnight).toMatchObject({ night: "2026-10-09", nightKw: 8, usualKw: 4, abovePct: 100, extraKwh: 24 });

    const outbox = join(root, "outbox");
    const monitor = createEnergyTargetsMonitor({
      metadataStore: metadata,
      env: { AUTH_EMAIL_DELIVERY: "test", ENERGYIQ_MAIL_OUTBOX_DIR: outbox },
      fallbackReaderUserId: "dev-user",
      now: () => now,
    });
    await monitor.runOnce();
    await monitor.runOnce();
    const alerts = readSiteAlerts({ metadataStore: metadata, projectId: PROJECT, userId: "facilities", includeReports: true, includeSync: false, now: now.getTime() });
    expect(alerts.targets.map((alert) => alert.key).sort()).toEqual(["budget:2026-10:at-risk", "overnight:2026-10-09"]);
    // One email per alert to the people who run the site, however often the check runs.
    const emails = readdirSync(outbox).map((folder) => JSON.parse(readFileSync(join(outbox, folder, "message.json"), "utf8")) as { to: string[]; subject: string });
    expect(emails.map((email) => email.subject).sort()).toEqual([
      "Ngee Ann Polytechnic: heading over budget for October 2026",
      "Ngee Ann Polytechnic: unusual overnight use on Fri, 9 Oct",
    ].sort());
    expect(emails.every((email) => email.to.includes("facilities@example.test"))).toBe(true);
  }, 120_000);

  it("emails a scheduled PDF report once per period to team members who can read the sites", async () => {
    const created = await call("POST", ["report-schedules"], "", { name: "Monthly summary", frequency: "monthly", recipientUserIds: ["facilities"] });
    expect(created.status).toBe(201);
    const view = (created.body as { data: { schedules: Array<{ id: string; timezone: string; localHour: number }>; team: Array<{ userId: string }> } }).data;
    expect(view.schedules[0]).toMatchObject({ timezone: "Asia/Singapore", localHour: 8 });
    expect(view.team.some((member) => member.userId === "facilities")).toBe(true);
    expect((await call("POST", ["report-schedules"], "", { name: "x", frequency: "monthly", recipientUserIds: ["someone-else"] })).status).toBe(400);

    const schedule = metadata.energyIq.targets.getSchedule(view.schedules[0]!.id)!;
    const period = latestReportPeriod("monthly", "Asia/Singapore", new Date("2026-10-10T02:00:00.000Z"));
    expect(period).toMatchObject({ from: "2026-09-01", to: "2026-09-30", key: "month:2026-09", dueDate: "2026-10-01" });
    const outbox = join(root, "report-outbox");
    const outcome = await deliverScheduledReport({
      metadataStore: metadata, schedule, period,
      delivery: createMailDelivery({ AUTH_EMAIL_DELIVERY: "test", ENERGYIQ_MAIL_OUTBOX_DIR: outbox }),
      publicBaseUrl: "https://energy.example.test",
    });
    expect(outcome).toEqual({ status: "sent", recipientCount: 1 });
    const [folder] = readdirSync(outbox);
    const message = JSON.parse(readFileSync(join(outbox, folder!, "message.json"), "utf8")) as { to: string[]; subject: string; text: string; attachments: Array<{ filename: string }> };
    expect(message.to).toEqual(["facilities@example.test"]);
    expect(message.subject).toContain("Monthly summary");
    expect(message.subject).toContain("September 2026");
    expect(message.text).toContain("Open in EnergyX: https://energy.example.test/energyiq/portfolio");
    expect(message.attachments[0]!.filename).toMatch(/\.pdf$/u);
    expect(existsSync(join(outbox, folder!, message.attachments[0]!.filename))).toBe(true);
    expect(metadata.energyIq.targets.findDelivery(schedule.id, "month:2026-09")).toMatchObject({ status: "sent", recipientCount: 1 });

    expect((await call("DELETE", ["report-schedules", schedule.id])).status).toBe(200);
    expect(metadata.energyIq.targets.listSchedules("default")).toEqual([]);
  }, 120_000);
});
