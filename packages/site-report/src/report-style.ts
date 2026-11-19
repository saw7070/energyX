/**
 * Which kind of site report to write from the readings. All are built from the same readings and the same model:
 * - "full": the full report the Overview shows, with every chart, table and circuit check;
 * - "management": a short, plain management review organised by group, for people who decide rather than operate;
 * - "review": the energy review: key findings first, then each topic with its charts, costs, carbon and next steps (the
 *   style of the first SKTC review). A site set to it also sees it as the full report on its Overview.
 *
 * Anything saved before this choice existed, or any value we do not know, reads as the full report.
 */
export type SiteReportStyle = "full" | "management" | "review";
export const SITE_REPORT_STYLES: readonly SiteReportStyle[] = ["full", "management", "review"];
export const DEFAULT_SITE_REPORT_STYLE: SiteReportStyle = "full";
/** A saved or requested style as one we know; the full report when it is missing or unknown. */
export const siteReportStyleOf = (value: unknown): SiteReportStyle => value === "management" || value === "review" ? value : DEFAULT_SITE_REPORT_STYLE;
/**
 * The style a report is actually written in. A one-day report has no days to compare or project from, so a site set to
 * the energy review gets the management review for its daily reports.
 */
export const writtenStyleOf = (style: SiteReportStyle, dayCount: number): SiteReportStyle => style === "review" && dayCount <= 1 ? "management" : style;
