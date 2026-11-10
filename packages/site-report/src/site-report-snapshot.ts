/**
 * The saved inputs of a site report.
 *
 * When the server publishes a site report it keeps the English page it rendered AND the readings that page was built
 * from. With the readings in hand the web app can build the very same report again in the reader's own language,
 * months later, without asking the Energy engine for anything.
 *
 * JSON has no Map, so the calendar of closures travels as a list of pairs. Everything else is already plain data.
 */
import type { ProjectSpatialReference } from "@datafoundry/contracts";
import type { AnalysisData } from "./analysis-types.js";
import type { SiteReportStyle } from "./report-style.js";

export const SITE_REPORT_SNAPSHOT_VERSION = 1;
/** The file the server writes next to the rendered page, and the name the web app asks for. */
export const SITE_REPORT_SNAPSHOT_FILE = "site-report-input.json";

export type SiteReportCadence = "weekly" | "monthly";
/** How often a saved report is issued, or "custom" for one somebody asked for on their own dates. */
export type SiteReportSnapshotCadence = SiteReportCadence | "custom";

export type SiteReportSnapshot = {
  schemaVersion: typeof SITE_REPORT_SNAPSHOT_VERSION;
  projectId: string;
  /** How often this report is issued, so the Overview can show the right one. "custom": asked for on chosen dates. */
  cadence: SiteReportSnapshotCadence;
  /** Which kind of report the saved page is. Absent on reports saved before the choice existed: the full report. */
  style?: SiteReportStyle | undefined;
  /** The dates the report covers. `toExclusive` is the day after the last day included. */
  period: { from: string; toExclusive: string };
  /** When the page was written, which is separate from the dates it covers. */
  generatedAt: string;
  /** The language the saved page was written in. The readings below can be re-read in any language. */
  language: "en";
  reference: ProjectSpatialReference | null;
  /** True when the all-available history was left out because it was too large to keep; the report never reads it. */
  historyOmitted?: boolean;
  data: AnalysisData;
};

/** What the snapshot looks like on disk and over the wire: the same thing, with the closures list flattened. */
export type StoredSiteReportSnapshot = Omit<SiteReportSnapshot, "data"> & {
  data: Omit<AnalysisData, "holidays"> & { holidays: Array<[string, string]> };
};

export function serializeSiteReportSnapshot(snapshot: SiteReportSnapshot): StoredSiteReportSnapshot {
  return { ...snapshot, data: { ...snapshot.data, holidays: [...snapshot.data.holidays.entries()] } };
}

/**
 * Read a saved snapshot back. Anything that is not a snapshot of a version we understand is rejected rather than
 * half-read, so a reader never sees a report built from a shape we cannot vouch for.
 */
export function parseSiteReportSnapshot(value: unknown): SiteReportSnapshot {
  const stored = value as StoredSiteReportSnapshot | null;
  if (!stored || typeof stored !== "object" || stored.schemaVersion !== SITE_REPORT_SNAPSHOT_VERSION || !stored.data) throw new Error("SITE_REPORT_SNAPSHOT_INVALID");
  if (stored.cadence !== "weekly" && stored.cadence !== "monthly" && stored.cadence !== "custom") throw new Error("SITE_REPORT_SNAPSHOT_INVALID");
  const holidays = Array.isArray(stored.data.holidays) ? stored.data.holidays : [];
  return { ...stored, data: { ...stored.data, holidays: new Map(holidays) } };
}
