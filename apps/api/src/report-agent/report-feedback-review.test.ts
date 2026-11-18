import { createMetadataStore } from "@datafoundry/metadata";
import type { AnalysisData, ScopeData, TrendSeries } from "@datafoundry/site-report";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PiReportModel } from "./pi-report-harness.js";
import { followUpSummary, followUpsDue, reviewFollowUpsAfterSiteReport, summaryFromReadings } from "./report-feedback-review.js";
import { ReportFeedbackStore } from "./report-feedback-store.js";

let root: string;
let metadata: ReturnType<typeof createMetadataStore>;
let store: ReportFeedbackStore;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "report-feedback-review-"));
  metadata = createMetadataStore({ database_path: join(root, "db.sqlite") });
  store = new ReportFeedbackStore(metadata.db);
});
afterEach(() => { metadata.close(); rmSync(root, { recursive: true, force: true }); });

const DATES = ["2026-11-11", "2026-11-12", "2026-11-13"];
const series = (id: string, kwh: number): TrendSeries => ({ id, expectedMinutesPerHour: 60, cells: DATES.flatMap(date => Array.from({ length: 24 }, (_, hour) => [date, hour, hour >= 19 || hour < 7 ? kwh : 0, 60, 0] as TrendSeries["cells"][number])) });
const scope = (): ScopeData => ({
  id: "project", name: "SKTC", dates: DATES, timezone: "Asia/Singapore", total: series("__scope__", 2), types: {},
  meters: [{ id: "m-lights", name: "Pavilion lights", location: "Pavilion", category: "light", official: true, series: series("m-lights", 2) }],
  usageKwh: 72, peakKw: 2, peakAt: null, cost: null, typeTotals: {}, coverage: 100,
});
const data = (): AnalysisData => ({
  projectId: "p", projectName: "SKTC", timezone: "Asia/Singapore", snapshotId: "s1",
  current: { project: scope(), spaces: [] }, previous: null, history: null, circuits: [], holidays: new Map(), openingHours: null, actions: [],
  notInUse: [{ id: "m-old", name: "Old store", reason: "Store closed" }],
});
const model: PiReportModel = { model: "test-model", baseUrl: "https://models.example.test/v1", apiKey: "key" };
const answer = (content: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }));

it("summarises each day's kWh, the points to check and the meters not in use", () => {
  const summary = followUpSummary(data(), null);
  expect(summary).toMatchObject({
    site: "SKTC", period: { from: "2026-11-11", to: "2026-11-13" },
    days: [{ date: "2026-11-11", kwh: 24 }, { date: "2026-11-12", kwh: 24 }, { date: "2026-11-13", kwh: 24 }],
    totalKwh: 72, checks: [], notInUse: [{ name: "Old store", reason: "Store closed" }],
    meters: [{ name: "Pavilion lights", group: "Pavilion", kwh: 72 }],
  });
  // With the energy review built from the same readings, its days and points to check are used.
  const reviewed = summaryFromReadings(data(), null, "2026-11-14T00:00:00Z") as { days: Array<{ date: string }>; checks: unknown[] };
  expect(reviewed.days.map(day => day.date)).toEqual(DATES);
  expect(Array.isArray(reviewed.checks)).toBe(true);
});

it("checks the follow-ups due after a weekly report and records the answers without closing anything", async () => {
  const due = store.addFollowUp("p", { text: "Lights off by 7:10", checkBy: "next_report", sourceFeedbackId: null, authorUserId: "u" }).followUp;
  const later = store.addFollowUp("p", { text: "Monthly bill check", checkBy: "next_month", sourceFeedbackId: null, authorUserId: "u" }).followUp;
  const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const sent = JSON.parse((JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> }).messages[1]!.content) as { follow_ups: Array<{ id: string }>; summary: { days: unknown[] } };
    expect(sent.follow_ups.map(item => item.id)).toEqual([due.id]);
    expect(sent.summary.days).toHaveLength(3);
    return answer({ results: [{ id: due.id, verdict: "ongoing", evidence: "Lights still used 2 kWh an hour until 7 am." }] });
  });
  const updated = await reviewFollowUpsAfterSiteReport({
    metadata, workspaceId: "w", projectId: "p", actorUserId: "u", cadence: "weekly", data: data(), reference: null, generatedAt: "2026-11-14T00:00:00Z",
    fetchImpl: fetchImpl as unknown as typeof fetch, resolveModel: () => model,
  });
  expect(updated).toBe(1);
  expect(store.getFollowUp("p", due.id)).toMatchObject({ status: "open", lastCheck: { verdict: "ongoing", evidence: "Lights still used 2 kWh an hour until 7 am." } });
  expect(store.getFollowUp("p", later.id)?.lastCheck).toBeUndefined();
  expect(metadata.energyIq.ai.listUsage("w", "2000-01-01T00:00:00Z")).toEqual([expect.objectContaining({ feature: "overview", status: "allowed" })]);
});

it("does nothing for daily or custom reports, or with no open follow-ups, and never throws", async () => {
  const fetchImpl = vi.fn(async () => answer({ results: [] }));
  const base = { metadata, workspaceId: "w", projectId: "p", actorUserId: "u", data: data(), reference: null, generatedAt: "2026-11-14T00:00:00Z", fetchImpl: fetchImpl as unknown as typeof fetch, resolveModel: () => model };
  expect(await reviewFollowUpsAfterSiteReport({ ...base, cadence: "monthly" })).toBe(0);
  store.addFollowUp("p", { text: "Lights off by 7:10", checkBy: "next_report", sourceFeedbackId: null, authorUserId: "u" });
  expect(await reviewFollowUpsAfterSiteReport({ ...base, cadence: "daily" })).toBe(0);
  expect(await reviewFollowUpsAfterSiteReport({ ...base, cadence: "custom" })).toBe(0);
  expect(fetchImpl).not.toHaveBeenCalled();
  const failing = vi.fn(async () => new Response("down", { status: 503 }));
  expect(await reviewFollowUpsAfterSiteReport({ ...base, cadence: "monthly", fetchImpl: failing as unknown as typeof fetch })).toBe(0);
});

it("checks month-long follow-ups on sites without a monthly report, and on sites with daily reports alone", () => {
  const at = "2026-11-18T00:00:00Z";
  const item = (id: string, checkBy: "next_report" | "next_month", createdAt: string, lastCheckAt?: string) => ({
    id, projectId: "p", authorUserId: "u", text: id, checkBy, status: "open" as const, createdAt, updatedAt: createdAt, sourceFeedbackId: null,
    ...(lastCheckAt ? { lastCheck: { at: lastCheckAt, verdict: "ongoing" as const, evidence: "" } } : {}),
  });
  const soon = item("soon", "next_report", "2026-11-15T00:00:00Z");
  const monthNew = item("month-new", "next_month", "2026-11-10T00:00:00Z");
  const monthOld = item("month-old", "next_month", "2026-10-15T00:00:00Z");
  const all = [soon, monthNew, monthOld];
  const ids = (list: Array<{ id: string }>) => list.map(entry => entry.id);
  expect(ids(followUpsDue(all, "monthly", "weekly-monthly", at))).toEqual(["soon", "month-new", "month-old"]);
  // Weekly with a monthly report too: next-month ones wait for it, unless they are about a month old already.
  expect(ids(followUpsDue(all, "weekly", "weekly-monthly", at))).toEqual(["soon", "month-old"]);
  // Weekly with no monthly report: the weekly report checks them all.
  expect(ids(followUpsDue(all, "weekly", "weekly", at))).toEqual(["soon", "month-new", "month-old"]);
  // Daily reports alone: about once a week each.
  expect(ids(followUpsDue([...all, item("checked", "next_report", "2026-11-01T00:00:00Z", "2026-11-16T00:00:00Z")], "daily", "daily", at))).toEqual(["soon", "month-old"]);
  expect(followUpsDue(all, "daily", "daily-weekly-monthly", at)).toEqual([]);
  expect(followUpsDue(all, "custom", "weekly", at)).toEqual([]);
});
