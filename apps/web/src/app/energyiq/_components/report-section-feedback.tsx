"use client";
/**
 * Feedback on one section of a site report, given where the reader is: each section has a "Give feedback" button, and
 * highlighting text in the report offers "Give feedback on this". Either opens a box under that section's heading.
 * It works the same in every style (the energy review, the full report, the management review), on the Overview and
 * in Reports. What is sent is the same feedback the panel under the report sends, tied to the section
 * (about = { kind: "section", id, title }) with any highlighted words quoted at the start, so the AI reads it, remembers
 * it and suggests changes in the same way; its reply shows in the box and in the panel below.
 */
// React itself, not only its hooks: tests compile JSX with the classic runtime, so the module needs it in scope.
import React from "react";
import type { EnergyReview, ManagementReview } from "@datafoundry/site-report";
import type { ReportSectionFeedback } from "@datafoundry/site-report/section-feedback";
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

/**
 * The section a node of the report is in, and its "Give feedback" button: the nearest section (or the masthead) that
 * has a button of its own. Null outside a report.
 */
export function feedbackSectionOf(node: Node | null): { host: Element; tools: HTMLElement } | null {
  let host = (node instanceof Element ? node : node?.parentElement ?? null)?.closest("section, header") ?? null;
  while (host) {
    const own = [...host.querySelectorAll<HTMLElement>("[data-feedback-section]")].find(button => button.closest("section, header") === host);
    if (own) return { host, tools: own };
    host = host.parentElement?.closest("section, header") ?? null;
  }
  return null;
}

/** The words sent: the highlighted part quoted first, then what the reader wrote. */
export const feedbackText = (text: string, quote?: string) => {
  const words = text.trim();
  if (!quote) return words;
  const quoted = `“${quote.length > QUOTE_MAX ? `${quote.slice(0, QUOTE_MAX - 1)}…` : quote}”\n`;
  return (quoted + words).slice(0, FEEDBACK_MAX_LENGTH);
};

/**
 * Wires section feedback into the report: `sectionFeedback` goes to the report document, `onPointerUp`/`onKeyUp` on
 * the element around it (to offer feedback on highlighted text), and `overlay` beside it. Pass the report on screen:
 * the energy review, the full report or the management review (the first given is the one shown); its checks and
 * figures go with the feedback. Nothing is offered when the reader may not give feedback.
 */
export function useSectionFeedback({ projectId, controller, review, report, management = null }: { projectId: string; controller: ReportFeedbackController; review: EnergyReview | null; report: SiteReport | null; management?: ManagementReview | null | undefined }) {
  const t = useMessages(sectionFeedbackMessages);
  const [open, setOpen] = React.useState<Open | null>(null);
  const [pick, setPick] = React.useState<(Open & { x: number; y: number }) | null>(null);
  const canGive = !!controller.state?.canGive;
  // Another project starts with nothing open.
  const [shownFor, setShownFor] = React.useState(projectId);
  if (shownFor !== projectId) { setShownFor(projectId); setOpen(null); setPick(null); }
  // The highlight button goes away once the highlight moves up or down (the page, or the pane the report is in,
  // scrolled) or is gone. A chart or the section bar scrolling sideways leaves it.
  React.useEffect(() => {
    if (!pick) return;
    const away = () => {
      const selection = window.getSelection();
      const top = selection && selection.rangeCount ? selection.getRangeAt(0).getBoundingClientRect().top : null;
      if (top == null || Math.abs(top - pick.y) > 2) setPick(null);
    };
    const check = () => { if (!window.getSelection()?.toString().trim()) setPick(null); };
    document.addEventListener("scroll", away, { capture: true, passive: true });
    document.addEventListener("selectionchange", check);
    return () => { document.removeEventListener("scroll", away, { capture: true }); document.removeEventListener("selectionchange", check); };
  }, [pick]);

  const shown = review ?? report ?? management;
  const sectionFeedback: ReportSectionFeedback | undefined = canGive && shown ? {
    label: t("button"),
    ariaLabel: title => t("buttonAria", { title }),
    open: section => setOpen(current => current?.id === section.id && !current.quote ? null : section),
    openId: open?.id ?? null,
    slot: id => open?.id === id ? <SectionFeedbackBox key={`${open.id}|${open.quote ?? ""}`} projectId={projectId} controller={controller} review={review} report={report} management={management} about={open} onClose={() => setOpen(null)} /> : null,
  } : undefined;

  /** After a highlight inside a section: offer feedback on it, by the highlight. */
  const offer = () => {
    if (!sectionFeedback) return;
    const selection = window.getSelection();
    const quote = selection?.toString().replace(/\s+/g, " ").trim() ?? "";
    if (!selection || !quote || selection.rangeCount === 0) { setPick(null); return; }
    const node = selection.getRangeAt(0).commonAncestorContainer;
    const found = feedbackSectionOf(node);
    // Not inside the report, or inside the feedback box itself.
    if (!found || (node instanceof Element ? node : node.parentElement)?.closest(`.${styles.box}`)) { setPick(null); return; }
    const { tools } = found;
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
function SectionFeedbackBox({ projectId, controller, review, report, management, about, onClose }: { projectId: string; controller: ReportFeedbackController; review: EnergyReview | null; report: SiteReport | null; management: ManagementReview | null; about: Open; onClose: () => void }) {
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
      const reportContext = reportContextOf(review, report, management);
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
