"use client";
/**
 * Feedback on one section of the energy review, given where the reader is: each section has a "Give feedback"
 * button, and highlighting text in the review offers "Give feedback on this". Either opens a box under that section's
 * heading. What is sent is the same feedback the panel under the report sends, tied to the section
 * (about = { kind: "section", id, title }) with any highlighted words quoted at the start, so the AI reads it, remembers
 * it and suggests changes in the same way; its reply shows in the box and in the panel below.
 */
// React itself, not only its hooks: tests compile JSX with the classic runtime, so the module needs it in scope.
import React from "react";
import type { EnergyReview } from "@datafoundry/site-report";
import type { ReviewSectionFeedback } from "@datafoundry/site-report/energy-review-document";
import { ConfigApiError } from "../../../lib/config-api";
import { useMessages } from "./energyiq-locale";
import { useFriendlyError } from "./friendly-error";
import { reportFeedbackMessages } from "./report-feedback-messages";
import { FEEDBACK_MAX_LENGTH, reportContextOf, reportFeedbackApi, type FeedbackDto, type ReportFeedbackController } from "./report-feedback-model";
import { REPORT_FEEDBACK_ID } from "./report-feedback-panel";
import { sectionFeedbackMessages } from "./report-section-feedback-messages";
import type { SiteReport } from "./site-report-model";
import styles from "./report-section-feedback.module.css";

type Open = { id: string; title: string; quote?: string | undefined };
/** The highlighted words, at most this long, so the feedback still fits. */
const QUOTE_MAX = 400;
const ICON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg>;

/** The words sent: the highlighted part quoted first, then what the reader wrote. */
export const feedbackText = (text: string, quote?: string) => {
  const words = text.trim();
  if (!quote) return words;
  const quoted = `“${quote.length > QUOTE_MAX ? `${quote.slice(0, QUOTE_MAX - 1)}…` : quote}”\n`;
  return (quoted + words).slice(0, FEEDBACK_MAX_LENGTH);
};

/**
 * Wires section feedback into the review: `sectionFeedback` goes to the review document, `onPointerUp`/`onKeyUp` on
 * the element around it (to offer feedback on highlighted text), and `overlay` anywhere on the page. Nothing is
 * offered when the reader may not give feedback.
 */
export function useSectionFeedback({ projectId, controller, review, report }: { projectId: string; controller: ReportFeedbackController; review: EnergyReview | null; report: SiteReport | null }) {
  const t = useMessages(sectionFeedbackMessages);
  const [open, setOpen] = React.useState<Open | null>(null);
  const [pick, setPick] = React.useState<(Open & { x: number; y: number }) | null>(null);
  const canGive = !!controller.state?.canGive;
  // Another project starts with nothing open.
  const [shownFor, setShownFor] = React.useState(projectId);
  if (shownFor !== projectId) { setShownFor(projectId); setOpen(null); setPick(null); }
  // The highlight button goes away once the page scrolls or the highlight is gone.
  React.useEffect(() => {
    if (!pick) return;
    const away = () => setPick(null);
    const check = () => { if (!window.getSelection()?.toString().trim()) setPick(null); };
    // The page scrolling, not a chart or the section bar inside it scrolling sideways.
    window.addEventListener("scroll", away);
    document.addEventListener("selectionchange", check);
    return () => { window.removeEventListener("scroll", away); document.removeEventListener("selectionchange", check); };
  }, [pick]);

  const sectionFeedback: ReviewSectionFeedback | undefined = canGive && review ? {
    label: t("button"),
    ariaLabel: title => t("buttonAria", { title }),
    open: section => setOpen(current => current?.id === section.id && !current.quote ? null : section),
    openId: open?.id ?? null,
    slot: id => open?.id === id ? <SectionFeedbackBox key={`${open.id}|${open.quote ?? ""}`} projectId={projectId} controller={controller} review={review} report={report} about={open} onClose={() => setOpen(null)} /> : null,
  } : undefined;

  /** After a highlight inside a section: offer feedback on it, by the highlight. */
  const offer = () => {
    if (!sectionFeedback) return;
    const selection = window.getSelection();
    const quote = selection?.toString().replace(/\s+/g, " ").trim() ?? "";
    if (!selection || !quote || selection.rangeCount === 0) { setPick(null); return; }
    const node = selection.getRangeAt(0).commonAncestorContainer;
    const section = (node instanceof Element ? node : node.parentElement)?.closest("section.er-sec");
    const tools = section?.querySelector<HTMLElement>(":scope > [data-feedback-section]");
    // Not inside the review, or inside the feedback box itself.
    if (!section || !tools || (node instanceof Element ? node : node.parentElement)?.closest(`.${styles.box}`)) { setPick(null); return; }
    const box = selection.getRangeAt(0).getBoundingClientRect();
    setPick({ id: tools.dataset.feedbackSection!, title: tools.dataset.feedbackTitle ?? "", quote, x: box.left + box.width / 2, y: box.top });
  };
  const choose = () => { if (!pick) return; setOpen({ id: pick.id, title: pick.title, quote: pick.quote }); setPick(null); window.getSelection()?.removeAllRanges(); };
  // Opens on press: a full click would first clear the highlight, and with it this button.
  const overlay = pick ? <button type="button" className={styles.pick} style={{ left: pick.x, top: pick.y }}
    onPointerDown={event => { event.preventDefault(); choose(); }} onMouseDown={event => event.preventDefault()} onClick={choose}>{ICON}{t("onThis")}</button> : null;
  return { sectionFeedback, overlay, onPointerUp: (event: React.PointerEvent) => { if (!(event.target as Element).closest?.(`.${styles.pick}`)) window.setTimeout(offer, 0); }, onKeyUp: (event: React.KeyboardEvent) => { if (event.shiftKey || event.key.startsWith("Arrow")) offer(); } };
}

/** The box under a section's heading: what the reader highlighted, their words, and the AI's answer once sent. */
function SectionFeedbackBox({ projectId, controller, review, report, about, onClose }: { projectId: string; controller: ReportFeedbackController; review: EnergyReview | null; report: SiteReport | null; about: Open; onClose: () => void }) {
  const t = useMessages(sectionFeedbackMessages);
  const tp = useMessages(reportFeedbackMessages);
  const friendly = useFriendlyError();
  const ids = React.useId();
  const textRef = React.useRef<HTMLTextAreaElement>(null);
  const boxRef = React.useRef<HTMLDivElement>(null);
  const [text, setText] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState<FeedbackDto | null>(null);
  // The same words sent again (after a failure) keep their request id, so the server never saves them twice.
  const [attempt, setAttempt] = React.useState<{ text: string; id: string } | null>(null);
  React.useEffect(() => {
    boxRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    textRef.current?.focus({ preventScroll: true });
  }, []);
  const state = controller.state;
  const room = FEEDBACK_MAX_LENGTH - (about.quote ? Math.min(about.quote.length, QUOTE_MAX) + 3 : 0);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const value = feedbackText(text, about.quote);
    if (!text.trim() || sending) return;
    const requestId = attempt && attempt.text === value ? attempt.id : crypto.randomUUID();
    setAttempt({ text: value, id: requestId });
    setSending(true); setError(null);
    try {
      const reportContext = reportContextOf(review, report);
      const result = await reportFeedbackApi.send(projectId, { requestId, text: value, about: { kind: "section", id: about.id, title: about.title }, ...(reportContext ? { reportContext } : {}) });
      controller.setState(result.state);
      setSent(result.feedback);
      setText(""); setAttempt(null);
    } catch (reason) {
      const code = reason instanceof ConfigApiError ? reason.message : "";
      if (code === "REPORT_FEEDBACK_STILL_PROCESSING") { setError(tp("stillProcessing")); controller.reload(); }
      else if (code === "REPORT_FEEDBACK_RATE_LIMITED") setError(tp("rateLimited"));
      else if (code === "REPORT_FEEDBACK_FULL") setError(tp("full"));
      else setError(friendly(reason, tp("sendFailed")));
    } finally {
      setSending(false);
    }
  }
  // Same answer as the panel below: the AI's reply, or that it was kept as a note, and whether an admin must approve it.
  const pending = !!sent && !!state && sent.memoryIds.some(id => state.memory.find(item => item.id === id)?.status === "pending");
  return <div ref={boxRef} className={styles.box} role="group" aria-labelledby={`${ids}-head`}>
    <p id={`${ids}-head`} className={styles.head}><span>{t("heading", { title: about.title })}</span>
      <button type="button" className={styles.x} aria-label={t("close")} onClick={onClose}>×</button></p>
    {about.quote && <blockquote className={styles.quote}><small>{t("quoted")}</small>{about.quote.length > QUOTE_MAX ? `${about.quote.slice(0, QUOTE_MAX - 1)}…` : about.quote}</blockquote>}
    {sent ? <div role="status" className={styles.reply}>
      {sent.reply ? <><strong>{tp("replyHeading")}</strong><p>{sent.reply}</p></>
        : <p>{sent.status === "processed" ? tp("replyDefault") : tp(state?.aiAvailable ? "savedAiFailed" : "savedNoAi")}</p>}
      {pending && <p className={styles.note}>{tp("pendingNote")}</p>}
      <div className={styles.row}><a className={styles.seeAll} href={`#${REPORT_FEEDBACK_ID}`}>{t("seeAll")}</a><button type="button" className={styles.cancel} onClick={onClose}>{t("close")}</button></div>
    </div>
    : <form onSubmit={event => { void send(event); }}>
      <textarea ref={textRef} id={`${ids}-text`} aria-label={tp("label")} value={text} onChange={event => setText(event.target.value)} maxLength={room} rows={3} disabled={sending} placeholder={t("placeholder")} />
      <div className={styles.row}>
        <span className={styles.count} aria-hidden="true">{text.length} / {room}</span>
        <button type="button" className={styles.cancel} onClick={onClose} disabled={sending}>{t("cancel")}</button>
        <button type="submit" className={styles.send} disabled={sending || !text.trim()} aria-busy={sending || undefined}>{sending ? tp("sending") : tp("send")}</button>
      </div>
      {state && !state.aiAvailable && <p className={styles.note}>{tp("aiOff")}</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </form>}
  </div>;
}
