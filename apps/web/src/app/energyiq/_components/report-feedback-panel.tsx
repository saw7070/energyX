"use client";
/**
 * "Tell the AI about this report": under the report on the Overview, anyone who can read the reports tells the AI
 * what the report missed or got wrong. The AI answers, keeps what it learns as project memory, suggests setting
 * changes and writes follow-ups the next report checks.
 *
 * Nothing on the site changes from here without an admin: an admin applies or dismisses each suggested change,
 * approves memory written by others, and closes follow-ups. Everyone else sees what is waiting for an admin.
 */
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { EnergyReview } from "@datafoundry/site-report";
import { useEnergyIqAccess } from "./energyiq-access";
import { useEnergyIqLocale, useMessages } from "./energyiq-locale";
import { intlLocale, type EnergyIqLocale } from "./energyiq-messages";
import { useFriendlyError } from "./friendly-error";
import { reportFeedbackMessages } from "./report-feedback-messages";
import {
  FEEDBACK_MAX_LENGTH,
  reportContextOf,
  reportFeedbackApi,
  suggestionLabel,
  suggestionsOf,
  useReportFeedback,
  type FeedbackAbout,
  type FeedbackDto,
  type FollowUpDto,
  type FollowUpStatus,
  type MemoryDto,
  type ReportFeedbackController,
  type ReportFeedbackState,
  type SuggestionDto,
  type SuggestionKind,
} from "./report-feedback-model";
import type { SiteReport } from "./site-report-model";
import styles from "./report-feedback.module.css";

/** The panel's element id, so the report's "Tell the AI about this" can bring it into view. */
export const REPORT_FEEDBACK_ID = "report-feedback";

/** Asks the panel to come into view with the text box ready and the chip set, e.g. from a point to check. */
export type FeedbackFocusRequest = { about: FeedbackAbout; nonce: number };

type Props = {
  projectId: string;
  /** The feedback state when the page loads it itself (the Overview does, to know who may give feedback). */
  feedback?: ReportFeedbackController | undefined;
  /** The report on screen: its checks and headline figures go with the feedback. */
  review?: EnergyReview | null | undefined;
  report?: SiteReport | null | undefined;
  focusRequest?: FeedbackFocusRequest | null | undefined;
  /** Called after an admin applied a change, so the page reloads the report. */
  onSiteChanged?: (() => void) | undefined;
};

const KINDS: ReadonlySet<SuggestionKind> = new Set(["operating_hours", "meter_not_in_use", "meter_in_use", "meter_always_on", "light_count", "holiday", "electricity_rate", "dismiss_check"]);
const MEMORY_KINDS = new Set(["fact", "rule", "explanation"]);

const reducedMotion = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** "18 Nov 2026", or "2026年11月18日" in Chinese. */
const dateText = (value: string | undefined, locale: EnergyIqLocale) => {
  const time = value ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(time)) return "";
  return new Date(time).toLocaleDateString(locale === "en" ? "en-GB" : intlLocale(locale), { timeZone: "Asia/Singapore", day: "numeric", month: "short", year: "numeric" }).replace("Sept", "Sep");
};

export function ReportFeedbackPanel({ projectId, feedback, review, report, focusRequest, onSiteChanged }: Props) {
  const t = useMessages(reportFeedbackMessages);
  const { locale } = useEnergyIqLocale();
  const friendly = useFriendlyError();
  const { access } = useEnergyIqAccess();
  const own = useReportFeedback(feedback ? null : projectId);
  const controller = feedback ?? own;
  const { state } = controller;
  const ids = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [about, setAbout] = useState<FeedbackAbout | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sent, setSent] = useState<FeedbackDto | null>(null);
  // The same words sent again (after a failure) keep their request id, so the server never saves them twice.
  const [attempt, setAttempt] = useState<{ text: string; about: string; id: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  // Another project starts with an empty box.
  const [shownFor, setShownFor] = useState(projectId);
  if (shownFor !== projectId) {
    setShownFor(projectId);
    setText(""); setAbout(null); setSent(null); setNotice(null); setSendError(null); setAttempt(null);
  }
  // A point to check asked for feedback: the chip names that point...
  const [askedFor, setAskedFor] = useState<FeedbackFocusRequest | null | undefined>(null);
  if (askedFor !== focusRequest) {
    setAskedFor(focusRequest);
    if (focusRequest) setAbout(focusRequest.about);
  }
  // ...and the panel comes into view with the text box ready.
  useEffect(() => {
    if (!focusRequest) return;
    sectionRef.current?.scrollIntoView?.({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
    textRef.current?.focus({ preventScroll: true });
  }, [focusRequest]);

  if (controller.forbidden || (state && !state.canGive)) return null;

  const canManage = !!state?.canManage;
  const userId = access?.user?.id ?? null;
  const itemLabel = (action: string, item: string) => t("itemAction", { action, item });

  async function send(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value || sending) return;
    const aboutKey = JSON.stringify(about);
    const requestId = attempt && attempt.text === value && attempt.about === aboutKey ? attempt.id : crypto.randomUUID();
    setAttempt({ text: value, about: aboutKey, id: requestId });
    setSending(true); setSendError(null); setSent(null); setNotice(null);
    try {
      const reportContext = reportContextOf(review, report);
      const result = await reportFeedbackApi.send(projectId, { requestId, text: value, ...(about ? { about } : {}), ...(reportContext ? { reportContext } : {}) });
      controller.setState(result.state);
      setSent(result.feedback);
      setText(""); setAbout(null); setAttempt(null);
    } catch (reason) {
      setSendError(friendly(reason, t("sendFailed")));
    } finally {
      setSending(false);
    }
  }

  /** One change at a time; each answers with the new state. A failure reloads the state, which says what happened. */
  async function run<R extends { state: ReportFeedbackState }>(key: string, change: () => Promise<R>, fallback: string, done?: (result: R) => string | null) {
    if (busy) return;
    setBusy(key); setNotice(null);
    try {
      const result = await change();
      controller.setState(result.state);
      const message = done?.(result) ?? null;
      if (message) setNotice({ tone: "ok", text: message });
    } catch (reason) {
      setNotice({ tone: "error", text: friendly(reason, fallback) });
      controller.reload();
    } finally {
      setBusy(null);
    }
  }

  const apply = (suggestion: SuggestionDto) => run(`apply:${suggestion.id}`, () => reportFeedbackApi.applySuggestion(projectId, suggestion.id), t("applyFailed"), result => {
    // The site changed: read the state again and rebuild the report from the new settings.
    controller.reload();
    onSiteChanged?.();
    // The server's sentence is English; other readers see the change in their own words.
    return t("appliedNow", { applied: (locale === "en" && result.applied?.trim()) || suggestionLabel(suggestion, locale, t) });
  });
  const dismiss = (suggestion: SuggestionDto) => run(`dismiss:${suggestion.id}`, () => reportFeedbackApi.dismissSuggestion(projectId, suggestion.id), t("actionFailed"));
  const approve = (memory: MemoryDto) => run(`approve:${memory.id}`, () => reportFeedbackApi.approveMemory(projectId, memory.id), t("actionFailed"));
  const remove = (memory: MemoryDto) => run(`remove:${memory.id}`, () => reportFeedbackApi.removeMemory(projectId, memory.id), t("actionFailed"));
  const setStatus = (followUp: FollowUpDto, status: FollowUpStatus) => run(`status:${followUp.id}`, () => reportFeedbackApi.setFollowUpStatus(projectId, followUp.id, status), t("actionFailed"));
  const checkNow = () => run("review", () => reportFeedbackApi.reviewFollowUps(projectId), t("reviewFailed"), () => t("checked"));

  const suggestions = state ? suggestionsOf(state) : [];
  const memory = state ? state.memory.filter(item => item.status !== "removed") : [];
  const followUps = state?.followUps ?? [];
  const openFollowUps = followUps.filter(item => item.status === "open");
  const history = state?.feedback ?? [];
  const nothingYet = !!state && !history.length && !memory.length && !followUps.length && !suggestions.length;
  const sentPending = !!sent && !!state && sent.memoryIds.some(id => state.memory.find(item => item.id === id)?.status === "pending");

  const suggestionStatus = (suggestion: SuggestionDto) => {
    if (suggestion.status === "applied") return suggestion.appliedByName
      ? t("appliedBy", { name: suggestion.appliedByName, date: dateText(suggestion.appliedAt, locale) })
      : t("applied", { date: dateText(suggestion.appliedAt, locale) });
    if (suggestion.status === "dismissed") return t("dismissed");
    if (suggestion.status === "failed") return t("failedApply", { error: suggestion.error?.trim() || t("applyFailed") });
    return null;
  };

  return <section ref={sectionRef} id={REPORT_FEEDBACK_ID} className={styles.panel} aria-labelledby={`${ids}-title`}>
    <header className={styles.header}>
      <h2 id={`${ids}-title`}>{t("title")}</h2>
      <p>{t("intro")}</p>
    </header>
    {!state ? controller.loading || !controller.error
      ? <p role="status" className={styles.message}>{t("loading")}</p>
      : <div role="alert" className={styles.problem}>
        <p>{friendly(controller.error, t("loadFailed"))}</p>
        <button type="button" className={styles.secondary} onClick={controller.reload}>{t("tryAgain")}</button>
      </div>
      : <div className={styles.body}>
        <form className={styles.form} onSubmit={event => { void send(event); }}>
          <label htmlFor={`${ids}-text`}>{t("label")}</label>
          {about && <p className={styles.chip}>
            <span>{t("aboutChip", { title: about.title })}</span>
            <button type="button" aria-label={t("removeAbout", { title: about.title })} onClick={() => { setAbout(null); textRef.current?.focus(); }} disabled={sending}>×</button>
          </p>}
          <textarea ref={textRef} id={`${ids}-text`} value={text} onChange={event => setText(event.target.value)} maxLength={FEEDBACK_MAX_LENGTH} rows={3} disabled={sending} placeholder={t("placeholder")} />
          <div className={styles.formRow}>
            <span className={styles.count} aria-hidden="true">{text.length} / {FEEDBACK_MAX_LENGTH}</span>
            <button type="submit" className={styles.primary} disabled={sending || !text.trim()} aria-busy={sending || undefined}>{sending ? t("sending") : t("send")}</button>
          </div>
          {!state.aiAvailable && <p className={styles.note}>{t("aiOff")}</p>}
          {sendError && <p role="alert" className={styles.error}>{sendError}</p>}
        </form>
        {sent && <div role="status" className={styles.reply}>
          {sent.reply ? <><strong>{t("replyHeading")}</strong><p>{sent.reply}</p></> : <p>{t(state.aiAvailable ? "savedAiFailed" : "savedNoAi")}</p>}
          {sentPending && <p className={styles.note}>{t("pendingNote")}</p>}
        </div>}
        {notice && <p role={notice.tone === "error" ? "alert" : "status"} className={notice.tone === "error" ? styles.error : styles.done}>{notice.text}</p>}
        {nothingYet && <p className={styles.empty}>{t("empty")}</p>}

        {suggestions.length > 0 && <section className={styles.section} aria-labelledby={`${ids}-suggestions`}>
          <h3 id={`${ids}-suggestions`}>{t("suggestionsHeading")}</h3>
          <p className={styles.sectionIntro}>{t("suggestionsIntro")}</p>
          <ul className={styles.list}>{suggestions.map(suggestion => {
            const waiting = suggestion.status === "open" || suggestion.status === "failed";
            const status = suggestionStatus(suggestion);
            const label = suggestionLabel(suggestion, locale, t);
            return <li key={suggestion.id} className={styles.card} data-status={suggestion.status}>
              {KINDS.has(suggestion.kind) && <span className={styles.kind}>{t(`kind.${suggestion.kind}`)}</span>}
              <p className={styles.cardText}>{label}</p>
              {status && <p className={suggestion.status === "failed" ? styles.cardError : styles.meta}>{status}</p>}
              {waiting && (canManage
                ? <div className={styles.actions}>
                  <button type="button" className={styles.primary} disabled={!!busy} aria-label={itemLabel(t("apply"), label)} onClick={() => { void apply(suggestion); }}>{busy === `apply:${suggestion.id}` ? t("applying") : t("apply")}</button>
                  <button type="button" className={styles.secondary} disabled={!!busy} aria-label={itemLabel(t("dismiss"), label)} onClick={() => { void dismiss(suggestion); }}>{t("dismiss")}</button>
                </div>
                : <p className={styles.meta}>{t("adminCanApply")}</p>)}
            </li>;
          })}</ul>
        </section>}

        {(memory.length > 0 || state.dismissedChecks.length > 0) && <section className={styles.section} aria-labelledby={`${ids}-memory`}>
          <h3 id={`${ids}-memory`}>{t("memoryHeading")}</h3>
          <p className={styles.sectionIntro}>{t("memoryIntro")}</p>
          {memory.length > 0 && <ul className={styles.list}>{memory.map(item => {
            const pending = item.status === "pending";
            const mayRemove = canManage || (pending && !!userId && item.authorUserId === userId);
            return <li key={item.id} className={styles.card} data-status={item.status}>
              <p className={styles.cardText}>{item.text}</p>
              <p className={styles.meta}>
                {MEMORY_KINDS.has(item.kind) && <span className={styles.kind}>{t(`memory.${item.kind}`)}</span>}
                {pending && <span className={styles.pending}>{t("pending")}</span>}
                <span>{t("byOn", { name: item.authorName, date: dateText(item.createdAt, locale) })}</span>
              </p>
              {((pending && canManage) || mayRemove) && <div className={styles.actions}>
                {pending && canManage && <button type="button" className={styles.primary} disabled={!!busy} aria-label={itemLabel(t("approve"), item.text)} onClick={() => { void approve(item); }}>{t("approve")}</button>}
                {mayRemove && <button type="button" className={styles.secondary} disabled={!!busy} aria-label={itemLabel(t("remove"), item.text)} onClick={() => { void remove(item); }}>{t("remove")}</button>}
              </div>}
            </li>;
          })}</ul>}
          {state.dismissedChecks.length > 0 && <div className={styles.dismissed}>
            <h4>{t("dismissedHeading")}</h4>
            <ul>{state.dismissedChecks.map(item => <li key={item.key}>{item.reason ? t("dismissedItem", { title: item.title, reason: item.reason }) : item.title}</li>)}</ul>
          </div>}
        </section>}

        {followUps.length > 0 && <section className={styles.section} aria-labelledby={`${ids}-followups`}>
          <div className={styles.sectionHead}>
            <div>
              <h3 id={`${ids}-followups`}>{t("followUpsHeading")}</h3>
              <p className={styles.sectionIntro}>{t("followUpsIntro")}</p>
            </div>
            {canManage && state.aiAvailable && openFollowUps.length > 0 && <button type="button" className={styles.secondary} disabled={!!busy} aria-busy={busy === "review" || undefined} onClick={() => { void checkNow(); }}>{busy === "review" ? t("checking") : t("checkNow")}</button>}
          </div>
          <ul className={styles.list}>{followUps.map(item => <li key={item.id} className={styles.card} data-status={item.status}>
            <p className={styles.cardText}>{item.text}</p>
            <p className={styles.meta}>
              <span className={styles.status} data-status={item.status}>{t(`status.${item.status}`)}</span>
              {item.status === "open" && <span>{t(`checkBy.${item.checkBy}`)}</span>}
            </p>
            {item.lastCheck && <p className={styles.check} data-verdict={item.lastCheck.verdict}>
              <strong>{t("lastCheck", { date: dateText(item.lastCheck.at, locale), verdict: t(`verdict.${item.lastCheck.verdict}`) })}</strong>
              {item.lastCheck.evidence ? ` ${item.lastCheck.evidence}` : ""}
            </p>}
            {item.status === "open" && item.lastCheck?.verdict === "resolved" && <p className={styles.note}>{t("resolvedHint")}</p>}
            {item.note && <p className={styles.meta}>{t("note", { note: item.note })}</p>}
            {canManage && <div className={styles.actions}>
              {item.status === "open"
                ? <>
                  <button type="button" className={styles.primary} disabled={!!busy} aria-label={itemLabel(t("markDone"), item.text)} onClick={() => { void setStatus(item, "done"); }}>{t("markDone")}</button>
                  <button type="button" className={styles.secondary} disabled={!!busy} aria-label={itemLabel(t("drop"), item.text)} onClick={() => { void setStatus(item, "dropped"); }}>{t("drop")}</button>
                </>
                : <button type="button" className={styles.secondary} disabled={!!busy} aria-label={itemLabel(t("reopen"), item.text)} onClick={() => { void setStatus(item, "open"); }}>{t("reopen")}</button>}
            </div>}
          </li>)}</ul>
        </section>}

        {history.length > 0 && <details className={styles.history}>
          <summary>{t("historyHeading", { count: history.length })}</summary>
          <ul>{history.map(item => <li key={item.id}>
            <p className={styles.cardText}>{item.text}</p>
            <p className={styles.meta}>
              {item.about && <span className={styles.kind}>{t("aboutChip", { title: item.about.title })}</span>}
              <span>{t("byOn", { name: item.authorName, date: dateText(item.createdAt, locale) })}</span>
            </p>
            <p className={styles.historyReply}>{item.reply ?? t("historyNoReply")}</p>
          </li>)}</ul>
        </details>}
      </div>}
  </section>;
}
