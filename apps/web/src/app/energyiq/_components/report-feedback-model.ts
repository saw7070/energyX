/**
 * Feedback on the Overview's report: the page's copy of the API's shapes and the calls that read and change them.
 *
 * People tell the AI about anything in the report ("the lights go off at 7:10, not 6:45"). The AI keeps what it learns
 * as project memory, suggests setting changes an admin applies with one click, and writes follow-ups the next report
 * checks. Nothing on the site changes until an admin clicks Apply.
 *
 * The shapes match the API (`/api/v1/energy/report-feedback/:projectId`) field for field. They are kept here, next to
 * the panel, rather than with the shared API types.
 */
import { useCallback, useEffect, useState } from "react";
import type { EnergyReview } from "@datafoundry/site-report";
import { configApi, ConfigApiError } from "../../../lib/config-api";
import type { SiteReport } from "./site-report-model";

/** What a piece of feedback is about: a point to check in the review, or a section of the report. */
export type FeedbackAbout = { kind: "check"; key: string; title: string } | { kind: "section"; id: string; title: string };

export type SuggestionKind =
  | "operating_hours"
  | "meter_not_in_use"
  | "meter_in_use"
  | "meter_always_on"
  | "light_count"
  | "holiday"
  | "electricity_rate"
  | "dismiss_check";

export type SuggestionDto = {
  id: string;
  kind: SuggestionKind;
  /** One plain sentence describing the change, e.g. "Change lights-off to 7:10 am, every day". */
  label: string;
  payload: Record<string, unknown>;
  status: "open" | "applied" | "dismissed" | "failed";
  appliedAt?: string;
  appliedByName?: string;
  error?: string;
};

export type FeedbackDto = {
  id: string;
  text: string;
  about: FeedbackAbout | null;
  authorUserId: string;
  authorName: string;
  createdAt: string;
  /** `saved`: kept as a note without the AI (it was off or failed). */
  status: "processed" | "saved" | "failed";
  reply: string | null;
  memoryIds: string[];
  followUpIds: string[];
  suggestions: SuggestionDto[];
};

export type MemoryDto = {
  id: string;
  text: string;
  kind: "fact" | "rule" | "explanation";
  /** `pending`: written by someone who is not an admin; reports and the advisor ignore it until an admin approves. */
  status: "active" | "pending" | "removed";
  authorUserId: string;
  authorName: string;
  createdAt: string;
  sourceFeedbackId: string | null;
};

export type FollowUpVerdict = "resolved" | "ongoing" | "unclear";
export type FollowUpStatus = "open" | "done" | "dropped";

export type FollowUpDto = {
  id: string;
  text: string;
  checkBy: "next_report" | "next_month";
  status: FollowUpStatus;
  createdAt: string;
  sourceFeedbackId: string | null;
  lastCheck?: { at: string; verdict: FollowUpVerdict; evidence: string };
  note?: string;
};

export type DismissedCheckDto = { key: string; title: string; reason: string; createdAt: string };

export type ReportFeedbackState = {
  canGive: boolean;
  canManage: boolean;
  aiAvailable: boolean;
  /** Newest first, at most 30. */
  feedback: FeedbackDto[];
  /** Active and pending, newest first. */
  memory: MemoryDto[];
  /** Open first, then the most recently closed. */
  followUps: FollowUpDto[];
  dismissedChecks: DismissedCheckDto[];
};

/** What the report on screen says, so the AI reads the feedback against it. */
export type ReportContext = { checks: Array<{ key: string; title: string }>; figures: string[] };

export type SendFeedbackBody = { requestId: string; text: string; about?: FeedbackAbout; reportContext?: ReportContext };

export const FEEDBACK_MAX_LENGTH = 2000;
const CONTEXT_MAX_CHECKS = 40;
const CONTEXT_MAX_FIGURES = 20;
const CONTEXT_MAX_TEXT = 300;

const segment = (id: string) => encodeURIComponent(id);
const post = (body?: unknown): RequestInit => ({ method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

/** The calls behind the panel. Every change answers with the whole new state. */
export const reportFeedbackApi = {
  state: (projectId: string, signal?: AbortSignal) =>
    configApi.reportFeedbackRequest<ReportFeedbackState>(projectId, "", signal ? { signal } : undefined),
  send: (projectId: string, body: SendFeedbackBody) =>
    configApi.reportFeedbackRequest<{ feedback: FeedbackDto; state: ReportFeedbackState }>(projectId, "", post(body)),
  applySuggestion: (projectId: string, id: string) =>
    configApi.reportFeedbackRequest<{ state: ReportFeedbackState; applied: string }>(projectId, `suggestions/${segment(id)}/apply`, post()),
  dismissSuggestion: (projectId: string, id: string) =>
    configApi.reportFeedbackRequest<{ state: ReportFeedbackState }>(projectId, `suggestions/${segment(id)}/dismiss`, post()),
  approveMemory: (projectId: string, id: string) =>
    configApi.reportFeedbackRequest<{ state: ReportFeedbackState }>(projectId, `memory/${segment(id)}/approve`, post()),
  removeMemory: (projectId: string, id: string) =>
    configApi.reportFeedbackRequest<{ state: ReportFeedbackState }>(projectId, `memory/${segment(id)}`, { method: "DELETE" }),
  setFollowUpStatus: (projectId: string, id: string, status: FollowUpStatus, note?: string) =>
    configApi.reportFeedbackRequest<{ state: ReportFeedbackState }>(projectId, `follow-ups/${segment(id)}/status`, post(note ? { status, note } : { status })),
  reviewFollowUps: (projectId: string) =>
    configApi.reportFeedbackRequest<{ state: ReportFeedbackState }>(projectId, "follow-ups/review", post()),
};

const clip = (text: string) => text.length > CONTEXT_MAX_TEXT ? text.slice(0, CONTEXT_MAX_TEXT) : text;

/** A point to check as the review lists it; `key` is the stable key the review gives each one. */
type CheckLike = { title: string; text: string; key?: string };

/**
 * The checks and headline figures of the report on screen, within the API's limits (40 checks, 20 figures, 300
 * characters each). The energy review gives both; the full report gives its key figures. Null when there is nothing.
 */
export function reportContextOf(review: EnergyReview | null | undefined, report: SiteReport | null | undefined): ReportContext | null {
  const checks: ReadonlyArray<CheckLike> = review?.checks ?? [];
  const figures = review
    ? [
      ...review.summary.figures.map(figure => `${figure.label}: ${figure.value}${figure.unit ? ` ${figure.unit}` : ""}`),
      ...review.summary.answers.map(row => `${row.question} ${row.answer}`),
    ]
    : report
      ? [...(report.headline ? [report.headline] : []), ...report.keyFigures.map(figure => `${figure.label}: ${figure.value}`)]
      : [];
  const context: ReportContext = {
    // Only checks that carry a key can be named back to the report.
    checks: checks.flatMap(check => check.key ? [{ key: clip(check.key), title: clip(check.title) }] : []).slice(0, CONTEXT_MAX_CHECKS),
    figures: figures.map(text => clip(text.trim())).filter(Boolean).slice(0, CONTEXT_MAX_FIGURES),
  };
  return context.checks.length || context.figures.length ? context : null;
}

/** What the reports read from feedback, in the shape of the report readings (AnalysisData). */
export type ReportFeedbackReadings = {
  feedbackMemory: Array<{ text: string; date: string }>;
  followUps: Array<{ text: string; status: FollowUpStatus; createdAt: string; lastCheck?: { at: string; verdict: FollowUpVerdict; evidence: string } }>;
  dismissedChecks: Array<{ key: string; title: string; reason: string }>;
};

/**
 * The feedback the report on screen should reflect now: active memory only, open follow-ups and those closed in the
 * last 31 days, and the dismissed checks. A saved report keeps what was known when it was written; laying this over
 * its readings shows an admin's change straight away.
 */
export function readingsFromFeedback(state: ReportFeedbackState, now = Date.now()): ReportFeedbackReadings {
  const monthAgo = now - 31 * 24 * 60 * 60_000;
  return {
    feedbackMemory: state.memory.filter(item => item.status === "active").map(item => ({ text: item.text, date: item.createdAt.slice(0, 10) })),
    followUps: state.followUps
      .filter(item => item.status === "open" || Date.parse(item.lastCheck?.at ?? item.createdAt) >= monthAgo)
      .map(item => ({ text: item.text, status: item.status, createdAt: item.createdAt, ...(item.lastCheck ? { lastCheck: item.lastCheck } : {}) })),
    dismissedChecks: state.dismissedChecks.map(item => ({ key: item.key, title: item.title, reason: item.reason })),
  };
}

/** Every suggestion with the feedback it came from: open and failed first, then the most recently closed. */
export function suggestionsOf(state: ReportFeedbackState, closedLimit = 6): Array<SuggestionDto & { feedbackId: string }> {
  const all = state.feedback.flatMap(item => item.suggestions.map(suggestion => ({ ...suggestion, feedbackId: item.id })));
  const waiting = all.filter(item => item.status === "open" || item.status === "failed");
  const closed = all.filter(item => item.status === "applied" || item.status === "dismissed").slice(0, closedLimit);
  return [...waiting, ...closed];
}

export type ReportFeedbackController = {
  state: ReportFeedbackState | null;
  /** The failure of the last load, kept so its wording follows the reader's language. */
  error: unknown;
  loading: boolean;
  /** No feedback panel for this reader: the API refused (no access to the reports). */
  forbidden: boolean;
  reload: () => void;
  setState: (state: ReportFeedbackState) => void;
};

/** Loads the feedback state for a project; pass null to load nothing. A reload keeps the last state on screen. */
export function useReportFeedback(projectId: string | null): ReportFeedbackController {
  const [loaded, setLoaded] = useState<{ projectId: string; state: ReportFeedbackState } | null>(null);
  const [failure, setFailure] = useState<{ projectId: string; reason: unknown } | null>(null);
  const [version, setVersion] = useState(0);
  // Which request last answered: the one asked for now is pending until it does.
  const request = projectId ? `${version}:${projectId}` : null;
  const [answered, setAnswered] = useState<string | null>(null);
  useEffect(() => {
    if (!projectId || !request) return;
    const controller = new AbortController();
    reportFeedbackApi.state(projectId, controller.signal)
      .then(state => { if (!controller.signal.aborted) { setLoaded({ projectId, state }); setFailure(null); } })
      .catch(reason => { if (!controller.signal.aborted) setFailure({ projectId, reason }); })
      .finally(() => { if (!controller.signal.aborted) setAnswered(request); });
    return () => controller.abort();
  }, [projectId, request]);
  const pending = !!request && answered !== request;
  const reload = useCallback(() => setVersion(value => value + 1), []);
  const setState = useCallback((state: ReportFeedbackState) => { if (projectId) setLoaded({ projectId, state }); }, [projectId]);
  const state = loaded && loaded.projectId === projectId ? loaded.state : null;
  const error = failure && failure.projectId === projectId ? failure.reason : null;
  return {
    state,
    error,
    // Before the first answer, and while trying again after a failure.
    loading: !!projectId && !state && (pending || !error),
    forbidden: error instanceof ConfigApiError && error.status === 403,
    reload,
    setState,
  };
}
