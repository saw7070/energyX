/**
 * Checking follow-ups from report feedback against the latest readings: when an administrator asks ("Check
 * follow-ups now"), and with each scheduled site report, before it is saved, so the report shows its own check.
 *
 * The model is given a compact summary of the same readings the site report is built from (loadSiteReportData) and
 * of the energy review those readings give: each day's kWh, the points to check, and the meters not in use or quiet.
 * A "resolved" answer only records the check; the follow-up stays open until an administrator marks it done.
 */
import type { MetadataStore } from "@datafoundry/metadata";
import type { LocalDataGateway } from "@datafoundry/data-gateway";
import { readProjectSpatialReference, type ProjectSpatialReference } from "@datafoundry/contracts";
import { buildEnergyReview, type AnalysisData, type EnergyReview } from "@datafoundry/site-report";
import type { PiReportModel } from "./pi-report-harness.js";
import type { ReportFrequency } from "./report-calendar.js";
import { reviewFollowUps } from "./report-feedback-ai.js";
import { localDate, ReportFeedbackStore, type FollowUpRecord, type ReportFeedbackInputs } from "./report-feedback-store.js";
import { shiftDate } from "./report-feedback-site.js";

const round = (value: number) => Math.round(value * 10) / 10;
const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

/** Each day's kWh straight from the readings, for when the energy review cannot be built. */
function daysFromReadings(data: AnalysisData): Array<{ date: string; kwh: number }> {
  const totals = new Map<string, number>(data.current.project.dates.map(date => [date, 0]));
  for (const cell of data.current.project.total?.cells ?? []) totals.set(cell[0], (totals.get(cell[0]) ?? 0) + (cell[2] ?? 0) + (cell[5] ?? 0));
  return [...totals].map(([date, kwh]) => ({ date, kwh: round(kwh) }));
}

/** The compact description of the latest readings and report the model checks follow-ups against. */
export function followUpSummary(data: AnalysisData, review: EnergyReview | null): Record<string, unknown> {
  const dates = data.current.project.dates;
  return {
    site: data.projectName,
    period: { from: dates[0] ?? null, to: dates.at(-1) ?? null },
    days: review?.total ? review.total.days.map(day => ({ date: day.date, kwh: round(day.kwh), complete: day.complete })) : daysFromReadings(data),
    totalKwh: data.current.project.usageKwh === null ? null : round(data.current.project.usageKwh),
    previousPeriodKwh: data.previous?.project.usageKwh == null ? null : round(data.previous.project.usageKwh),
    checks: (review?.checks ?? []).map(check => ({ key: check.key, title: check.title, text: clip(check.text, 500) })),
    notInUse: (data.notInUse ?? []).map(meter => ({ name: meter.name, reason: meter.reason })),
    quietButIdle: data.idleWhenQuiet ?? [],
    alwaysOnByDesign: (data.alwaysOnByDesign ?? []).map(meter => meter.name),
    meters: data.current.project.meters.slice(0, 80).map(meter => {
      const kwh = (meter.series?.cells ?? []).reduce((sum, cell) => sum + (cell[2] ?? 0) + (cell[5] ?? 0), 0);
      return { name: meter.name, group: meter.location, kwh: round(kwh) };
    }),
  };
}

/** The summary with the energy review built from the same readings; a review that cannot be built is left out. */
export function summaryFromReadings(data: AnalysisData, reference: ProjectSpatialReference | null, generatedAt: string): Record<string, unknown> {
  let review: EnergyReview | null = null;
  try {
    review = buildEnergyReview(data, reference, generatedAt, "en");
  } catch (error) {
    console.warn(`[report-feedback] energy review not built for follow-ups: ${error instanceof Error ? error.message : "unknown"}`);
  }
  return followUpSummary(data, review);
}

/** Loads the last week (or month, when a follow-up waits for next month) of readings and summarises them. */
export async function loadFollowUpSummary(input: {
  metadata: MetadataStore;
  dataGateway: LocalDataGateway;
  workspaceId: string;
  projectId: string;
  actorUserId: string;
  followUps: Array<Pick<FollowUpRecord, "checkBy">>;
  now?: Date;
}): Promise<Record<string, unknown>> {
  const { loadSiteReportData } = await import("./site-report-data.js");
  const { findReportService } = await import("./report-service.js");
  const now = input.now ?? new Date();
  const project = input.metadata.energyIq.getProject(input.projectId);
  const today = localDate(now.toISOString(), project.timezone);
  const days = input.followUps.some(item => item.checkBy === "next_month") ? 30 : 7;
  const { data } = await loadSiteReportData({
    metadata: input.metadata, dataGateway: input.dataGateway, workspaceId: input.workspaceId, projectId: input.projectId,
    actorUserId: input.actorUserId, period: { from: shiftDate(today, -days), toExclusive: today }, includeHistory: false,
  });
  const notes = findReportService(input.metadata)?.store.settings(input.projectId)?.contextNotes ?? "";
  return summaryFromReadings(data, readProjectSpatialReference(notes, input.projectId)?.reference ?? null, now.toISOString());
}

export type ReviewModelOptions = {
  fetchImpl?: typeof fetch;
  resolveModel?: (metadata: MetadataStore, workspaceId: string) => PiReportModel;
};

/** Asks the model about the given open follow-ups and records each answer as the follow-up's last check. */
export async function recordFollowUpReview(input: {
  metadata: MetadataStore;
  workspaceId: string;
  projectId: string;
  userId: string;
  followUps: FollowUpRecord[];
  summary: Record<string, unknown>;
  now?: Date;
} & ReviewModelOptions): Promise<number> {
  if (!input.followUps.length) return 0;
  const results = await reviewFollowUps({
    followUps: input.followUps.map(item => ({ id: item.id, text: item.text, checkBy: item.checkBy, createdAt: item.createdAt, ...(item.lastCheck ? { lastCheck: item.lastCheck } : {}) })),
    summary: input.summary,
  }, {
    metadata: input.metadata, workspaceId: input.workspaceId, projectId: input.projectId, userId: input.userId,
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}), ...(input.resolveModel ? { resolveModel: input.resolveModel } : {}),
  });
  const store = new ReportFeedbackStore(input.metadata.db);
  const at = (input.now ?? new Date()).toISOString();
  let updated = 0;
  for (const result of results) {
    // Read again: someone may have closed it while the model was answering. The check is still worth keeping.
    const current = store.getFollowUp(input.projectId, result.id);
    if (!current) continue;
    store.saveFollowUp({ ...current, lastCheck: { at, verdict: result.verdict, evidence: result.evidence }, updatedAt: at });
    updated += 1;
  }
  return updated;
}

const DAY_MS = 86_400_000;
/** A "next month" follow-up this old is due at any report, for sites with no monthly report or that missed one. */
const MONTH_DUE_DAYS = 28;
/** On a site with daily reports only, a follow-up is checked again once this long has passed since its last check. */
const DAILY_RECHECK_DAYS = 6;

/**
 * The open follow-ups a scheduled report checks. A monthly report checks them all. A weekly report checks those
 * waiting for the next report, and "next month" ones once they are about a month old, or straight away when the site
 * has no monthly report. A daily report checks only on a site with daily reports alone, about once a week.
 */
export function followUpsDue(followUps: FollowUpRecord[], cadence: "daily" | "weekly" | "monthly" | "custom", frequency: ReportFrequency | undefined, generatedAt: string): FollowUpRecord[] {
  const at = Date.parse(generatedAt);
  const ageDays = (iso: string) => (at - Date.parse(iso)) / DAY_MS;
  const monthDue = (item: FollowUpRecord) => item.checkBy === "next_report" || ageDays(item.createdAt) >= MONTH_DUE_DAYS;
  if (cadence === "monthly") return followUps;
  if (cadence === "weekly") return followUps.filter(item => monthDue(item) || (!!frequency && !frequency.includes("monthly")));
  if (cadence === "daily" && frequency === "daily") return followUps.filter(item => monthDue(item) && (!item.lastCheck || ageDays(item.lastCheck.at) >= DAILY_RECHECK_DAYS));
  return [];
}

/** The follow-ups a report shows (open, and closed in the last 31 days), with their latest checks. */
export function followUpsForReport(metadata: MetadataStore, projectId: string, generatedAt: string): ReportFeedbackInputs["followUps"] {
  const project = metadata.energyIq.getProject(projectId);
  return new ReportFeedbackStore(metadata.db).reportInputs(projectId, new Date(generatedAt), project.timezone || "UTC").followUps;
}

/**
 * With a scheduled site report: checks the open follow-ups due (followUpsDue) against that report's own readings.
 * Returns how many were checked. Never throws.
 */
export async function reviewFollowUpsAfterSiteReport(input: {
  metadata: MetadataStore;
  workspaceId: string;
  projectId: string;
  actorUserId: string;
  cadence: "daily" | "weekly" | "monthly" | "custom";
  frequency?: ReportFrequency | undefined;
  data: AnalysisData;
  reference: ProjectSpatialReference | null;
  generatedAt: string;
} & ReviewModelOptions): Promise<number> {
  try {
    const store = new ReportFeedbackStore(input.metadata.db);
    if (!store.hasOpenFollowUps(input.projectId)) return 0;
    const followUps = followUpsDue(store.openFollowUps(input.projectId), input.cadence, input.frequency, input.generatedAt);
    if (!followUps.length) return 0;
    return await recordFollowUpReview({
      metadata: input.metadata, workspaceId: input.workspaceId, projectId: input.projectId, userId: input.actorUserId,
      followUps, summary: summaryFromReadings(input.data, input.reference, input.generatedAt),
      ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}), ...(input.resolveModel ? { resolveModel: input.resolveModel } : {}),
    });
  } catch (error) {
    console.warn(`[report-feedback] follow-ups not checked after site report project=${input.projectId} code=${error instanceof Error ? error.message : "unknown"}`);
    return 0;
  }
}
