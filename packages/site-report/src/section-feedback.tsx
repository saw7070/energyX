/**
 * Feedback on one section of a site report, on the live page only. Every report style (the full report, the
 * management review, the energy review) can take the same `ReportSectionFeedback` from the page: each section then
 * shows a "Give feedback" button, and a place under its heading where the page puts its own feedback box.
 *
 * Without it, as in a saved or downloaded copy, nothing here renders, so the standalone HTML stays script-free and
 * exactly as before. The section's id and name ride on the button (data-feedback-section / data-feedback-title), so a
 * page can find which section a text selection is in.
 */
import { createContext, useContext, type ReactNode } from "react";

/**
 * What the page supplies: the wording, what to do when a section's button is pressed, and what to show under the
 * section's heading. `id` is the section's stable id ("summary", "estimate", "q-total"…), `title` how the report names
 * it ("2 A 30-day month: estimated use and bill").
 */
export type ReportSectionFeedback = {
  label: string;
  ariaLabel: (title: string) => string;
  open: (section: { id: string; title: string }) => void;
  /** The section whose box is open, so its button says so. */
  openId?: string | null | undefined;
  /** What the page shows under the heading of section `id`: its feedback box when open, else nothing. */
  slot?: ((id: string) => ReactNode) | undefined;
};

/** The feedback the page gave, and each section's name as the report shows it. Null on a saved copy. */
export const SectionFeedbackContext = createContext<{ feedback: ReportSectionFeedback; titleOf: (id: string) => string } | null>(null);

const COMMENT_ICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg>;

/** The section's "Give feedback" button. `className` is the report's own ("er-fb" in the energy review, "rp-fb" here). */
export function SectionFeedbackButton({ id, className }: { id: string; className: string }) {
  const context = useContext(SectionFeedbackContext);
  if (!context) return null;
  const title = context.titleOf(id);
  return <button type="button" className={className} data-feedback-section={id} data-feedback-title={title} aria-expanded={context.feedback.openId === id}
    aria-label={context.feedback.ariaLabel(title)} onClick={() => context.feedback.open({ id, title })}>{COMMENT_ICON}{context.feedback.label}</button>;
}

/** Under a section's heading: the page's feedback box for that section when it is open. */
export function SectionFeedbackSlot({ id }: { id: string }) {
  const context = useContext(SectionFeedbackContext);
  return <>{context?.feedback.slot?.(id) ?? null}</>;
}

/**
 * The button's look in the full report and the management review (both `.eiq-report`). Only the live page adds these
 * rules, beside REPORT_CSS; the saved and downloaded files never include them, so those files are unchanged. The button
 * sits at the right of each section's heading line, and at the foot of the masthead for the headline and key figures.
 */
export const REPORT_SECTION_FEEDBACK_CSS = `
.eiq-report .sec-head:has(>.rp-fb){flex-wrap:wrap;row-gap:8px}
.eiq-report .rp-fb{margin-left:auto;align-self:center;display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border:1px solid var(--line);border-radius:999px;background:#fff;color:var(--steel);font:inherit;font-size:13px;font-weight:600;line-height:1.35;white-space:nowrap;cursor:pointer;opacity:.6;transition:opacity .15s,background .15s,border-color .15s}
.eiq-report .rp-fb svg{width:15px;height:15px;flex:none}
.eiq-report section:hover .rp-fb,.eiq-report .masthead:hover>.rp-fb,.eiq-report .rp-fb:focus-visible,.eiq-report .rp-fb[aria-expanded="true"]{opacity:1}
.eiq-report .rp-fb:hover{background:var(--fog);border-color:#CFCAC0}
.eiq-report .rp-fb:focus-visible{outline:2px solid var(--steel);outline-offset:2px}
.eiq-report .masthead>.rp-fb{display:flex;width:max-content;margin:22px 0 0 auto}
@media (hover:none){.eiq-report .rp-fb{opacity:1}}
@media (prefers-reduced-motion:reduce){.eiq-report .rp-fb{transition:none}}
@media print{.eiq-report .rp-fb{display:none!important}}
`;
