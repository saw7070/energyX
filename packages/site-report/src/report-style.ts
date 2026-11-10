/**
 * Which kind of site report to write from the readings. Both are built from the same readings and the same model:
 * - "full": the full report the Overview shows, with every chart, table and circuit check;
 * - "management": a short, plain management review organised by group, for people who decide rather than operate.
 *
 * Anything saved before this choice existed, or any value we do not know, reads as the full report.
 */
export type SiteReportStyle = "full" | "management";
export const SITE_REPORT_STYLES: readonly SiteReportStyle[] = ["full", "management"];
export const DEFAULT_SITE_REPORT_STYLE: SiteReportStyle = "full";
/** A saved or requested style as one we know; the full report when it is missing or unknown. */
export const siteReportStyleOf = (value: unknown): SiteReportStyle => value === "management" ? "management" : DEFAULT_SITE_REPORT_STYLE;
