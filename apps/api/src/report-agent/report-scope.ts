import { shiftReportDate, validateReportPeriod, type ReportPeriod } from "./report-calendar.js";

/** The accepted artifact carries the same immutable scope as its library entry. */
export function stampReportScope(html: string, period: ReportPeriod, timezone: string, generatedAt: string): string {
  validateReportPeriod(period);
  const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
  const scope = `<section aria-label="System report scope" style="padding:12px 24px;background:#eef4ef;color:#203a2c;font:14px/1.5 system-ui;border-bottom:1px solid #cad9cf"><strong>Requested analysis period: ${period.from} – ${shiftReportDate(period.toExclusive, -1)}</strong> (${escape(timezone)})<br>Generated: ${escape(generatedAt)} · Actual reading coverage and missing data are documented separately below.</section>`;
  return /<body\b[^>]*>/i.test(html) ? html.replace(/<body\b[^>]*>/i, opening => opening + scope) : scope + html;
}
