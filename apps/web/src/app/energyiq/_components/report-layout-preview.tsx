"use client";
/**
 * What each report layout looks like, before a site has readings of its own: the layout drawn from a made-up sample
 * site (sampleSiteAnalysisData) in the reader's language, in a large window over Create project. Loaded only when
 * someone opens a preview, so the report code never weighs on the rest of the app.
 */
// React itself, not only its hooks: tests compile JSX with the classic runtime, so the module needs it in scope.
import React from "react";
import { buildEnergyReview, buildManagementReview, buildSiteReport, sampleSiteAnalysisData, type EnergyReview, type ManagementReview, type SiteReport } from "@datafoundry/site-report";
import { ENERGY_REVIEW_CSS, EnergyReviewDocument } from "@datafoundry/site-report/energy-review-document";
import { MANAGEMENT_REVIEW_CSS, ManagementReviewDocument } from "@datafoundry/site-report/management-review-document";
import { SiteReportDocument } from "@datafoundry/site-report/site-report-document";
import { REPORT_CSS } from "@datafoundry/site-report/site-report-styles";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { EnergyIcon } from "./icons";
import { newSiteMessages } from "./new-site-messages";
import styles from "./new-site.module.css";

/** The site report layouts a site can choose (ReportSettings.siteReportStyle). */
export type ReportLayout = "review" | "full" | "management";

type Sample = { review: EnergyReview } | { management: ManagementReview } | { report: SiteReport };

/** One layout drawn from the sample site, exactly as a report in that layout is drawn on the Overview and in Reports. */
export function SampleReport({ layout, now }: { layout: ReportLayout; now?: Date }) {
  const { locale } = useEnergyIqLocale();
  const t = useMessages(newSiteMessages);
  const sample = React.useMemo<Sample | null>(() => {
    try {
      const at = now ?? new Date();
      const data = sampleSiteAnalysisData(at);
      const generatedAt = at.toISOString();
      if (layout === "review") return { review: buildEnergyReview(data, null, generatedAt, locale) };
      if (layout === "management") return { management: buildManagementReview(data, null, generatedAt, locale) };
      return { report: buildSiteReport(data, null, generatedAt, locale) };
    } catch { return null; }
  }, [layout, locale, now]);
  if (!sample) return <p role="alert" className={styles.problem}>{t("previewFailed")}</p>;
  return <div className={styles.sample} data-site-report-style={layout}>
    <style>{"review" in sample ? ENERGY_REVIEW_CSS : `${REPORT_CSS}${"management" in sample ? MANAGEMENT_REVIEW_CSS : ""}`}</style>
    {"review" in sample ? <EnergyReviewDocument review={sample.review} />
      : "management" in sample ? <ManagementReviewDocument review={sample.management} />
      : <SiteReportDocument report={sample.report} />}
  </div>;
}

/** The sample report in a large window, with a way to choose the layout straight from it. */
export default function ReportLayoutPreview({ layout, onChoose, onClose }: { layout: ReportLayout; onChoose: () => void; onClose: () => void }) {
  const t = useMessages(newSiteMessages);
  const dialog = React.useRef<HTMLDialogElement>(null);
  React.useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, []);
  const name = t(`layout.${layout}`);
  return <dialog ref={dialog} aria-label={t("previewTitle", { layout: name })} className={styles.previewDialog} onCancel={event => {
    // Esc closes the preview only: React passes the event up to Create project, which would close as well.
    event.preventDefault(); event.stopPropagation(); onClose();
  }}>
    <header className={styles.previewHead}>
      <div className={styles.dialogTitle}><h2>{t("previewTitle", { layout: name })}</h2><p>{t("previewNote")}</p></div>
      <button type="button" className={styles.dialogClose} aria-label={t("closePreview")} onClick={onClose}><EnergyIcon name="close" /></button>
    </header>
    <div className={styles.previewBody}><SampleReport layout={layout} /></div>
    <footer className={styles.dialogFoot}>
      <button type="button" className={styles.secondary} onClick={onClose}>{t("closePreview")}</button>
      <button type="button" className={styles.primary} onClick={onChoose}>{t("previewChoose")}</button>
    </footer>
  </dialog>;
}
