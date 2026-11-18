/**
 * Publishing the site's own energy report on a schedule, or on dates somebody chose.
 *
 * The Overview has always been able to show a full report, but it was drawn in the reader's browser and disappeared
 * when they closed the tab. This writes the same report on the server, on the schedule the site already uses, and
 * saves it so it shows up in Reports beside the advisor's reports and can be reopened at any time.
 *
 * Two things are saved together: the finished page, and the readings it was built from. The page is written in
 * English; the readings let the web app build the very same report again in the reader's own language.
 *
 * The page is written in the style the site chose: the full report (the default, as before), the management review (a
 * short plain report organised by group) or the energy review (answers to the questions the site asked at
 * installation). All come from the same readings and the same model. A one-day report in the energy review style is
 * written as the management review (writtenStyleOf).
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { MetadataStore } from "@datafoundry/metadata";
import type { LocalDataGateway } from "@datafoundry/data-gateway";
import { readProjectSpatialReference, type ProjectSpatialReference } from "@datafoundry/contracts";
import {
  serializeSiteReportSnapshot,
  siteReportStyleOf,
  SITE_REPORT_SNAPSHOT_FILE,
  SITE_REPORT_SNAPSHOT_VERSION,
  type SiteReportCadence,
  type SiteReportSnapshot,
  type SiteReportStyle,
} from "@datafoundry/site-report";
import { renderStyledSiteReportHtml } from "@datafoundry/site-report/management-review-document";
import { writtenStyleOf } from "@datafoundry/site-report";
import { loadSiteReportData, type SiteReportPeriod } from "./site-report-data.js";
import type { ReportRun, ReportSettings, ReportStore } from "./report-store.js";
import { validateReportPeriod, type ReportFrequency } from "./report-calendar.js";

/**
 * What makes one site report unique. The scheduler wakes up every half minute; this key is what stops it publishing
 * the same week twice. It deliberately does NOT collide with the advisor's own key for the same period.
 */
export const siteReportScheduleKey = (projectId: string, cadence: SiteReportCadence, period: SiteReportPeriod): string =>
  `${projectId}:site-${cadence}:${period.from}:${period.toExclusive}`;

/** What a reader is told this report is, in the library and in the record. Plain words, no jargon. */
export const siteReportPrompt = (cadence: SiteReportCadence | "custom", period: SiteReportPeriod, style: SiteReportStyle = "full"): string =>
  `${cadence === "daily" ? "Daily" : cadence === "weekly" ? "Weekly" : cadence === "monthly" ? "Monthly" : "Custom"} site ${style === "management" ? "management review" : style === "review" ? "energy review" : "energy report"} for ${period.from} to ${period.toExclusive} (the end date is not included). Written by the server from the site's own meter readings.`;

/** Beyond this the saved readings are trimmed rather than refused; the report itself never reads the trimmed part. */
const MAX_SNAPSHOT_BYTES = 12 * 1024 * 1024;
/** The longest stretch somebody can ask a custom site report for. */
export const MAX_CUSTOM_SITE_REPORT_DAYS = 93;

export type PublishSiteReportInput = {
  metadata: MetadataStore;
  dataGateway: LocalDataGateway;
  store: ReportStore;
  /** Where run folders live, the same root the advisor's reports use. */
  root: string;
  settings: ReportSettings;
  cadence: SiteReportCadence;
  period: SiteReportPeriod;
  generatedAt?: string;
  loadData?: typeof loadSiteReportData;
  /**
   * Before a scheduled report is saved: check the open follow-ups from report feedback against its readings. It may
   * answer with the follow-ups as the report should show them, with the new checks. It is given a short time
   * (followUpReviewTimeoutMs); past that, or if it fails, the report is saved as it is and the check finishes alone.
   */
  reviewFollowUps?: (input: FollowUpReviewAfterReport) => Promise<unknown>;
  followUpReviewTimeoutMs?: number;
};

export type FollowUpReviewAfterReport = {
  metadata: MetadataStore;
  workspaceId: string;
  projectId: string;
  actorUserId: string;
  cadence: SiteReportCadence | "custom";
  /** The site's report schedule, so a site without monthly (or weekly) reports still has its follow-ups checked. */
  frequency: ReportFrequency;
  data: SiteReportSnapshot["data"];
  reference: ProjectSpatialReference | null;
  generatedAt: string;
};

/** How long a scheduled report waits for the follow-up check before it is saved without the new verdicts. */
export const FOLLOW_UP_REVIEW_TIMEOUT_MS = 20_000;

/** Loaded on first use, so publishing a report never loads the AI modules it does not need. */
const reviewFollowUpsForReport = async (input: FollowUpReviewAfterReport): Promise<unknown> => {
  const { followUpsForReport, reviewFollowUpsAfterSiteReport } = await import("./report-feedback-review.js");
  const checked = await reviewFollowUpsAfterSiteReport(input);
  return checked > 0 ? followUpsForReport(input.metadata, input.projectId, input.generatedAt) : undefined;
};

/**
 * Checks the report's follow-ups before it is saved and, when the check answers in time, shows its verdicts in the
 * report. Only a report that already lists follow-ups takes them (so a reader who may not see them never does), and
 * the report never fails or waits long because of it.
 */
async function withFollowUpChecks(input: Omit<PublishSiteReportInput, "cadence"> & { cadence: SiteReportCadence | "custom"; actorUserId: string }, data: SiteReportSnapshot["data"], reference: ProjectSpatialReference | null, generatedAt: string): Promise<SiteReportSnapshot["data"]> {
  const due = input.cadence === "weekly" || input.cadence === "monthly" || (input.cadence === "daily" && input.settings.frequency === "daily");
  if (!due) return data;
  const failed = (error: unknown) => {
    console.warn(`[site-report] follow-up check failed project=${input.settings.projectId} code=${error instanceof Error ? error.message : "unknown"}`);
    return undefined;
  };
  let check: Promise<unknown>;
  try {
    check = Promise.resolve((input.reviewFollowUps ?? reviewFollowUpsForReport)({
      metadata: input.metadata, workspaceId: input.settings.workspaceId, projectId: input.settings.projectId, actorUserId: input.actorUserId,
      cadence: input.cadence, frequency: input.settings.frequency, data, reference, generatedAt,
    })).catch(failed);
  } catch (error) {
    failed(error);
    return data;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), input.followUpReviewTimeoutMs ?? FOLLOW_UP_REVIEW_TIMEOUT_MS); });
  const followUps = await Promise.race([check, timeout]);
  clearTimeout(timer);
  return Array.isArray(followUps) && data.followUps?.length ? { ...data, followUps: followUps as NonNullable<SiteReportSnapshot["data"]["followUps"]> } : data;
}

export type PublishedSiteReport = { run: ReportRun; created: boolean; scheduleKey: string };

/**
 * Build one site report and save it, in the style the site's settings choose. Returns the report already published
 * for this period unchanged when there is one, so a repeated schedule tick costs nothing and never produces a second
 * copy.
 */
export async function publishSiteReport(input: PublishSiteReportInput): Promise<PublishedSiteReport> {
  const scheduleKey = siteReportScheduleKey(input.settings.projectId, input.cadence, input.period);
  const existing = input.store.findByScheduleKey(scheduleKey);
  if (existing) return { run: existing, created: false, scheduleKey };
  const saved = await writeSiteReport({ ...input, style: siteReportStyleOf(input.settings.siteReportStyle), actorUserId: input.settings.actorUserId, scheduleKey });
  return { ...saved, scheduleKey };
}

export type PublishCustomSiteReportInput = Omit<PublishSiteReportInput, "cadence"> & {
  /** The person asking: the report reads only what they may read, and is saved as theirs. */
  actorUserId: string;
  style: SiteReportStyle;
};

/**
 * A site report on dates somebody chose, written now in the style they chose. It is saved as a custom report in the
 * library; asking twice saves two, like asking the advisor twice.
 */
export async function publishCustomSiteReport(input: PublishCustomSiteReportInput): Promise<{ run: ReportRun; created: boolean }> {
  validateReportPeriod(input.period);
  const days = (Date.parse(`${input.period.toExclusive}T00:00:00Z`) - Date.parse(`${input.period.from}T00:00:00Z`)) / 86_400_000;
  if (!Number.isInteger(days) || days < 1) throw new Error("REPORT_PERIOD_INVALID");
  if (days > MAX_CUSTOM_SITE_REPORT_DAYS) throw new Error("SITE_REPORT_PERIOD_TOO_LONG");
  return writeSiteReport({ ...input, cadence: "custom", scheduleKey: undefined });
}

async function writeSiteReport(input: Omit<PublishSiteReportInput, "cadence"> & { cadence: SiteReportCadence | "custom"; style: SiteReportStyle; actorUserId: string; scheduleKey: string | undefined }): Promise<{ run: ReportRun; created: boolean }> {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  // All readings ever taken are not part of this report, and for a long-running site they dwarf everything else.
  const { data: loaded } = await (input.loadData ?? loadSiteReportData)({
    metadata: input.metadata,
    dataGateway: input.dataGateway,
    workspaceId: input.settings.workspaceId,
    projectId: input.settings.projectId,
    actorUserId: input.actorUserId,
    period: input.period,
    includeHistory: false,
  });
  const reference = readProjectSpatialReference(input.settings.contextNotes ?? "", input.settings.projectId)?.reference ?? null;
  const data = await withFollowUpChecks(input, loaded, reference, generatedAt);
  // English for now. The readings saved beside the page let the web app word the same report in any language.
  const html = renderStyledSiteReportHtml(input.style, data, reference, generatedAt, "en");
  // What the page actually is: a one-day report in the energy review style is the management review.
  const written = writtenStyleOf(input.style, data.current.project.dates.length);

  const snapshot: SiteReportSnapshot = {
    schemaVersion: SITE_REPORT_SNAPSHOT_VERSION, projectId: input.settings.projectId, cadence: input.cadence,
    period: input.period, generatedAt, language: "en", reference, historyOmitted: true, data,
    // The full report needs no mark, so reports saved before the choice existed and the full report read the same.
    ...(written !== "full" ? { style: written } : {}),
  };
  const siteReport: NonNullable<ReportRun["siteReport"]> = {
    ...(input.cadence === "custom" ? {} : { cadence: input.cadence }),
    ...(written !== "full" ? { style: written } : {}),
  };
  const id = randomUUID();
  const directory = join(input.root, id);
  try {
    mkdirSync(join(directory, "outputs"), { recursive: true, mode: 0o700 });
    writeFileSync(join(directory, "outputs", SITE_REPORT_SNAPSHOT_FILE), snapshotJson(snapshot));
    writeFileSync(join(directory, "accepted-output.txt"), html, { flag: "wx" });
    const saved = input.store.insertCompleted({
      settings: input.settings, period: input.period, reportingPeriod: input.period,
      prompt: siteReportPrompt(input.cadence, input.period, written), actorUserId: input.actorUserId,
      ...(input.scheduleKey ? { scheduleKey: input.scheduleKey } : { custom: true }), siteReport, id,
    });
    // Someone else published this period while we were building it; theirs is the one readers already have.
    if (!saved.created) rmSync(directory, { recursive: true, force: true });
    return saved;
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Keep the saved readings to a size a reader's browser can actually fetch. A report too large to save is reported as
 * a failure rather than quietly saved half-complete; the next period tries again.
 */
function snapshotJson(snapshot: SiteReportSnapshot): string {
  const json = JSON.stringify(serializeSiteReportSnapshot(snapshot));
  if (Buffer.byteLength(json) > MAX_SNAPSHOT_BYTES) throw new Error("SITE_REPORT_SNAPSHOT_TOO_LARGE");
  return json;
}
