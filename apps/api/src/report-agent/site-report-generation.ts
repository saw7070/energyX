/**
 * Publishing the site's own energy report on a schedule.
 *
 * The Overview has always been able to show a full report, but it was drawn in the reader's browser and disappeared
 * when they closed the tab. This writes the same report on the server, on the schedule the site already uses, and
 * saves it so it shows up in Reports beside the advisor's reports and can be reopened at any time.
 *
 * Two things are saved together: the finished page, and the readings it was built from. The page is written in
 * English; the readings let the web app build the very same report again in the reader's own language.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { MetadataStore } from "@datafoundry/metadata";
import type { LocalDataGateway } from "@datafoundry/data-gateway";
import { readProjectSpatialReference } from "@datafoundry/contracts";
import {
  buildSiteReport,
  serializeSiteReportSnapshot,
  SITE_REPORT_SNAPSHOT_FILE,
  SITE_REPORT_SNAPSHOT_VERSION,
  type SiteReportCadence,
  type SiteReportSnapshot,
} from "@datafoundry/site-report";
import { renderSiteReportHtml } from "@datafoundry/site-report/site-report-document";
import { loadSiteReportData, type SiteReportPeriod } from "./site-report-data.js";
import type { ReportRun, ReportSettings, ReportStore } from "./report-store.js";

/**
 * What makes one site report unique. The scheduler wakes up every half minute; this key is what stops it publishing
 * the same week twice. It deliberately does NOT collide with the advisor's own key for the same period.
 */
export const siteReportScheduleKey = (projectId: string, cadence: SiteReportCadence, period: SiteReportPeriod): string =>
  `${projectId}:site-${cadence}:${period.from}:${period.toExclusive}`;

/** What a reader is told this report is, in the library and in the record. Plain words, no jargon. */
export const siteReportPrompt = (cadence: SiteReportCadence, period: SiteReportPeriod): string =>
  `${cadence === "weekly" ? "Weekly" : "Monthly"} site energy report for ${period.from} to ${period.toExclusive} (the end date is not included). Written by the server from the site's own meter readings.`;

/** Beyond this the saved readings are trimmed rather than refused; the report itself never reads the trimmed part. */
const MAX_SNAPSHOT_BYTES = 12 * 1024 * 1024;

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
};

export type PublishedSiteReport = { run: ReportRun; created: boolean; scheduleKey: string };

/**
 * Build one site report and save it. Returns the report already published for this period unchanged when there is
 * one, so a repeated schedule tick costs nothing and never produces a second copy.
 */
export async function publishSiteReport(input: PublishSiteReportInput): Promise<PublishedSiteReport> {
  const scheduleKey = siteReportScheduleKey(input.settings.projectId, input.cadence, input.period);
  const existing = input.store.findByScheduleKey(scheduleKey);
  if (existing) return { run: existing, created: false, scheduleKey };

  const generatedAt = input.generatedAt ?? new Date().toISOString();
  // All readings ever taken are not part of this report, and for a long-running site they dwarf everything else.
  const { data } = await (input.loadData ?? loadSiteReportData)({
    metadata: input.metadata,
    dataGateway: input.dataGateway,
    workspaceId: input.settings.workspaceId,
    projectId: input.settings.projectId,
    actorUserId: input.settings.actorUserId,
    period: input.period,
    includeHistory: false,
  });
  const reference = readProjectSpatialReference(input.settings.contextNotes ?? "", input.settings.projectId)?.reference ?? null;
  // English for now. The readings saved beside the page let the web app word the same report in any language.
  const html = renderSiteReportHtml(buildSiteReport(data, reference, generatedAt, "en"));

  const snapshot: SiteReportSnapshot = {
    schemaVersion: SITE_REPORT_SNAPSHOT_VERSION, projectId: input.settings.projectId, cadence: input.cadence,
    period: input.period, generatedAt, language: "en", reference, historyOmitted: true, data,
  };
  const id = randomUUID();
  const directory = join(input.root, id);
  try {
    mkdirSync(join(directory, "outputs"), { recursive: true, mode: 0o700 });
    writeFileSync(join(directory, "outputs", SITE_REPORT_SNAPSHOT_FILE), snapshotJson(snapshot));
    writeFileSync(join(directory, "accepted-output.txt"), html, { flag: "wx" });
    const saved = input.store.insertCompleted({
      settings: input.settings, period: input.period, reportingPeriod: input.period,
      prompt: siteReportPrompt(input.cadence, input.period), actorUserId: input.settings.actorUserId,
      scheduleKey, siteReport: { cadence: input.cadence }, id,
    });
    // Someone else published this period while we were building it; theirs is the one readers already have.
    if (!saved.created) rmSync(directory, { recursive: true, force: true });
    return { ...saved, scheduleKey };
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
