"use client";
/**
 * A site report opened in Reports — one the schedule wrote or somebody created on their own dates — drawn on the page
 * from the readings saved with it, in the reader's language, the same way the Overview draws its report. Being on the
 * page (not in a sandboxed frame) is what lets the reader give feedback where they read: "Give feedback" on each
 * section, "Give feedback on this" on highlighted text, and "Tell the AI about this report" at the end, all sending the
 * same report feedback the Overview sends, with this report's own checks and figures.
 *
 * Every style reads this way: the full report, the management review and the energy review, daily, weekly, monthly or
 * custom. The report is shown as it was written; what people have told the AI since shapes the next reports. The saved
 * page itself (the download, and "Source") is untouched. When the readings cannot be read, the saved page is shown as
 * before (`fallback`).
 */
// React itself, not only its hooks: tests compile JSX with the classic runtime, so the module needs it in scope.
import React from "react";
import { buildEnergyReview, buildManagementReview, buildSiteReport, parseSiteReportSnapshot, siteReportStyleOf, writtenStyleOf, type EnergyReview, type ManagementReview, type SiteReport, type SiteReportSnapshot } from "@datafoundry/site-report";
import { ENERGY_REVIEW_CSS, EnergyReviewDocument } from "@datafoundry/site-report/energy-review-document";
import { MANAGEMENT_REVIEW_CSS, ManagementReviewDocument } from "@datafoundry/site-report/management-review-document";
import { REPORT_SECTION_FEEDBACK_CSS } from "@datafoundry/site-report/section-feedback";
import { SiteReportDocument } from "@datafoundry/site-report/site-report-document";
import { REPORT_CSS } from "@datafoundry/site-report/site-report-styles";
import { configApi } from "../../../lib/config-api";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import type { EnergyIqLocale } from "./energyiq-messages";
import { ReportFeedbackPanel, type FeedbackFocusRequest } from "./report-feedback-panel";
import { useReportFeedback } from "./report-feedback-model";
import { previewMessages } from "./report-library-messages";
import { useSectionFeedback } from "./report-section-feedback";
import styles from "./site-report-saved.module.css";

type Loaded = { key: string; snapshot: SiteReportSnapshot } | { key: string; failed: true };
/** The report in the style it was written: exactly one of the three is set. */
type Shown = { review: EnergyReview | null; report: SiteReport | null; management: ManagementReview | null };

/** A saved report, rebuilt from its readings in `locale` and in the style it was written. */
export function buildSavedSiteReport(snapshot: SiteReportSnapshot, locale: EnergyIqLocale): Shown {
  const { data, reference, generatedAt } = snapshot;
  // The style the page was written in (a one-day energy review is a management review; see writtenStyleOf).
  const written = writtenStyleOf(siteReportStyleOf(snapshot.style), data.current.project.dates.length);
  if (written === "review") return { review: buildEnergyReview(data, reference, generatedAt, locale), report: null, management: null };
  if (written === "management") return { review: null, report: null, management: buildManagementReview(data, reference, generatedAt, locale) };
  return { review: null, report: buildSiteReport(data, reference, generatedAt, locale), management: null };
}

export function SavedSiteReport({ projectId, reportId, fallback }: { projectId: string; reportId: string; fallback: React.ReactNode }) {
  const { locale } = useEnergyIqLocale();
  const t = useMessages(previewMessages);
  const key = `${projectId}|${reportId}`;
  const [loaded, setLoaded] = React.useState<Loaded | null>(null);
  React.useEffect(() => {
    const controller = new AbortController();
    configApi.reportLibraryRequest<{ snapshot: unknown }>(projectId, `snapshot/${encodeURIComponent(reportId)}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setLoaded({ key, snapshot: parseSiteReportSnapshot(result.snapshot) }); })
      .catch(() => { if (!controller.signal.aborted) setLoaded({ key, failed: true }); });
    return () => controller.abort();
  }, [projectId, reportId, key]);
  const current = loaded?.key === key ? loaded : null;
  const shown = React.useMemo<Shown | null>(() => {
    if (!current || "failed" in current) return null;
    try { return buildSavedSiteReport(current.snapshot, locale); } catch { return null; }
  }, [current, locale]);

  // What people told the AI: who may give feedback, and the panel at the end.
  const feedback = useReportFeedback(projectId);
  const [askAbout, setAskAbout] = React.useState<FeedbackFocusRequest | null>(null);
  const tellAbout = React.useCallback((check: { key: string; title: string }) =>
    setAskAbout(previous => ({ about: { kind: "check", key: check.key, title: check.title }, nonce: (previous?.nonce ?? 0) + 1 })), []);
  const section = useSectionFeedback({ projectId, controller: feedback, review: shown?.review ?? null, report: shown?.report ?? null, management: shown?.management ?? null });

  if (!current) return <p role="status" className={styles.message}>{t("loadingFile")}</p>;
  if (!shown) return <>{fallback}</>;
  const { review, report, management } = shown;
  return <div className={styles.saved} data-site-report-style={review ? "review" : management ? "management" : "full"}>
    <style>{review ? ENERGY_REVIEW_CSS : `${REPORT_CSS}${management ? MANAGEMENT_REVIEW_CSS : ""}${REPORT_SECTION_FEEDBACK_CSS}`}</style>
    <div onPointerUp={section.onPointerUp} onKeyUp={section.onKeyUp}>
      {review ? <EnergyReviewDocument review={review} onCheckFeedback={feedback.state?.canGive ? tellAbout : undefined} sectionFeedback={section.sectionFeedback} />
        : management ? <ManagementReviewDocument review={management} sectionFeedback={section.sectionFeedback} />
        : report && <SiteReportDocument report={report} sectionFeedback={section.sectionFeedback} />}
      {section.overlay}
    </div>
    <div className={styles.after}>
      <ReportFeedbackPanel projectId={projectId} feedback={feedback} review={review} report={report} management={management} focusRequest={askAbout} />
    </div>
  </div>;
}
