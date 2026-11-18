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
import { energyReviewCheckTitle, type EnergyReview } from "@datafoundry/site-report";
import { configApi, ConfigApiError } from "../../../lib/config-api";
import { intlLocale, type EnergyIqLocale, type Translate } from "./energyiq-messages";
import type { reportFeedbackMessages } from "./report-feedback-messages";
import type { SiteReport } from "./site-report-model";

/** What a piece of feedback is about: a point to check in the review, or a section of the report. */
export type FeedbackAbout = { kind: "check"; key: string; title: string } | { kind: "section"; id: string; title: string };

export type SuggestionKind =
  | "operating_hours"
  | "meter_not_in_use"
  | "meter_in_use"
  | "meter_always_on"
  | "meter_never_used"
  | "light_count"
  | "holiday"
  | "electricity_rate"
  | "dismiss_check";

/** Why a change could not be made, or ("not_live") why an applied change is not live yet: worded by the page. */
export type ApplyProblemCode =
  | "invalid" | "no_hours" | "hours_changed" | "no_hours_for_date" | "hours_not_saved" | "day_off_not_saved" | "no_rate"
  | "peak_pricing" | "rate_changed" | "rate_not_saved" | "meter_missing" | "meter_invalid" | "setup_conflict" | "failed" | "not_live";
export type ApplyProblemDetail = "overlap" | "outside_range" | "bad_time" | "admin_required" | "setup_invalid" | "data_not_ready" | "conflict" | "other";
export type SuggestionProblem = { code: ApplyProblemCode; detail?: ApplyProblemDetail; name?: string; date?: string };

export type SuggestionDto = {
  id: string;
  kind: SuggestionKind;
  /** One plain sentence describing the change, e.g. "Change lights-off to 7:10 am, every day". */
  label: string;
  payload: Record<string, unknown>;
  status: "open" | "applied" | "dismissed" | "failed";
  appliedAt?: string;
  appliedByName?: string;
  /** The problem in English; shown only when the page cannot word `problem`. */
  error?: string;
  /** On a failed suggestion, why; on an applied one, "not_live": saved but not live yet. */
  problem?: SuggestionProblem;
};

export type FeedbackDto = {
  id: string;
  text: string;
  about: FeedbackAbout | null;
  authorUserId: string;
  authorName: string;
  createdAt: string;
  /** `processing`: the AI is still reading it. `saved`: kept as a note without the AI (it was off or failed). */
  status: "processing" | "processed" | "saved" | "failed";
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
  /** When an admin wrote or approved it. */
  activatedAt?: string;
  sourceFeedbackId: string | null;
};

export type FollowUpVerdict = "resolved" | "ongoing" | "unclear";
/** `pending`: from someone who is not an admin; the reports and the AI ignore it until an admin approves it. */
export type FollowUpStatus = "pending" | "open" | "done" | "dropped";

export type FollowUpDto = {
  id: string;
  text: string;
  checkBy: "next_report" | "next_month";
  status: FollowUpStatus;
  createdAt: string;
  sourceFeedbackId: string | null;
  lastCheck?: { at: string; verdict: FollowUpVerdict; evidence: string };
  /** An admin's own note. */
  note?: string;
  /** When it was marked done or dropped. */
  closedAt?: string;
  /** "made_room": dropped to keep within the limit, not by a person. */
  closedReason?: "made_room";
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
  /** Exactly what the reports read now (the server's own reckoning); older servers leave it out. */
  reportInputs?: ReportFeedbackReadings;
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
  /** `live` false: the change is saved but not live yet (the suggestion's problem says why). */
  applySuggestion: (projectId: string, id: string) =>
    configApi.reportFeedbackRequest<{ state: ReportFeedbackState; applied: string; live?: boolean }>(projectId, `suggestions/${segment(id)}/apply`, post()),
  dismissSuggestion: (projectId: string, id: string) =>
    configApi.reportFeedbackRequest<{ state: ReportFeedbackState }>(projectId, `suggestions/${segment(id)}/dismiss`, post()),
  approveMemory: (projectId: string, id: string) =>
    configApi.reportFeedbackRequest<{ state: ReportFeedbackState }>(projectId, `memory/${segment(id)}/approve`, post()),
  approveFollowUp: (projectId: string, id: string) =>
    configApi.reportFeedbackRequest<{ state: ReportFeedbackState }>(projectId, `follow-ups/${segment(id)}/approve`, post()),
  removeMemory: (projectId: string, id: string) =>
    configApi.reportFeedbackRequest<{ state: ReportFeedbackState }>(projectId, `memory/${segment(id)}`, { method: "DELETE" }),
  setFollowUpStatus: (projectId: string, id: string, status: Exclude<FollowUpStatus, "pending">, note?: string) =>
    configApi.reportFeedbackRequest<{ state: ReportFeedbackState }>(projectId, `follow-ups/${segment(id)}/status`, post(note ? { status, note } : { status })),
  reviewFollowUps: (projectId: string) =>
    configApi.reportFeedbackRequest<{ state: ReportFeedbackState }>(projectId, "follow-ups/review", post()),
};

const clip = (text: string) => text.length > CONTEXT_MAX_TEXT ? text.slice(0, CONTEXT_MAX_TEXT) : text;

/**
 * The checks and headline figures of the report on screen, within the API's limits (40 checks, 20 figures, 300
 * characters each). The energy review gives both; the full report gives its key figures. Null when there is nothing.
 */
export function reportContextOf(review: EnergyReview | null | undefined, report: SiteReport | null | undefined): ReportContext | null {
  const checks = review?.checks ?? [];
  const figures = review
    ? [
      ...review.summary.figures.map(figure => `${figure.label}: ${figure.value}${figure.unit ? ` ${figure.unit}` : ""}`),
      ...review.summary.answers.map(row => `${row.question} ${row.answer}`),
    ]
    : report
      ? [...(report.headline ? [report.headline] : []), ...report.keyFigures.map(figure => `${figure.label}: ${figure.value}`)]
      : [];
  const context: ReportContext = {
    // Each check is named back to the report by its stable key ("stopped:<meterId>", "daytime"…).
    checks: checks.filter(check => check.key).map(check => ({ key: clip(check.key), title: clip(check.title) })).slice(0, CONTEXT_MAX_CHECKS),
    figures: figures.map(text => clip(text.trim())).filter(Boolean).slice(0, CONTEXT_MAX_FIGURES),
  };
  return context.checks.length || context.figures.length ? context : null;
}

/** What the reports read from feedback, in the shape of the report readings (AnalysisData). */
export type ReportFeedbackReadings = {
  feedbackMemory: Array<{ text: string; date: string }>;
  followUps: Array<{ text: string; status: Exclude<FollowUpStatus, "pending">; createdAt: string; lastCheck?: { at: string; verdict: FollowUpVerdict; evidence: string } }>;
  dismissedChecks: Array<{ key: string; title: string; reason: string }>;
};

/** The site's own calendar date for an instant (the reports date memory this way); UTC if the zone is unknown. */
const siteDate = (iso: string, timezone: string | undefined) => {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
};

/**
 * The feedback the report on screen should reflect now: active memory only, open follow-ups and those closed in the
 * last 31 days, and the dismissed checks. A saved report keeps what was known when it was written; laying this over
 * its readings shows an admin's change straight away. The server works this out exactly as the scheduled reports do
 * (`reportInputs`); for an older server the page works it out the same way, by activation and close dates.
 */
export function readingsFromFeedback(state: ReportFeedbackState, now = Date.now(), timezone?: string): ReportFeedbackReadings {
  if (state.reportInputs) return state.reportInputs;
  const monthAgo = now - 31 * 24 * 60 * 60_000;
  return {
    feedbackMemory: state.memory.filter(item => item.status === "active").map(item => ({ text: item.text, date: siteDate(item.activatedAt ?? item.createdAt, timezone) })),
    followUps: state.followUps.flatMap(item => {
      if (item.status === "pending") return [];
      if (item.status !== "open" && Date.parse(item.closedAt ?? item.lastCheck?.at ?? item.createdAt) < monthAgo) return [];
      return [{ text: item.text, status: item.status, createdAt: item.createdAt, ...(item.lastCheck ? { lastCheck: item.lastCheck } : {}) }];
    }),
    dismissedChecks: state.dismissedChecks.map(item => ({ key: item.key, title: item.title, reason: item.reason })),
  };
}

type FeedbackTranslate = Translate<Extract<keyof typeof reportFeedbackMessages.en, string>>;
const WEEK_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const textField = (value: unknown) => typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

/**
 * The hours in a suggestion, with days that share them side by side: "周一–周五 07:00–19:10；周六 关闭". A suggestion
 * names only the days it changes; the others keep their hours and are not listed.
 */
function hoursText(weekly: unknown, locale: EnergyIqLocale, t: FeedbackTranslate): string | null {
  if (!weekly || typeof weekly !== "object") return null;
  const present = WEEK_DAYS.flatMap((day, index) => day in (weekly as object) ? [{ index, ranges: (weekly as Record<string, unknown>)[day] }] : []);
  const valid = (ranges: unknown): ranges is Array<{ from: string; to: string }> => Array.isArray(ranges)
    && ranges.every(range => !!range && typeof range === "object" && TIME.test(String((range as { from?: unknown }).from)) && TIME.test(String((range as { to?: unknown }).to)));
  if (!present.length || !present.every(day => valid(day.ranges))) return null;
  const rangesOf = (ranges: Array<{ from: string; to: string }>) => ranges.length ? ranges.map(range => `${range.from}–${range.to}`).join(", ") : t("label.closed");
  const days = present.map(day => ({ index: day.index, text: rangesOf(day.ranges as Array<{ from: string; to: string }>) }));
  if (days.length === WEEK_DAYS.length && days.every(day => day.text === days[0]!.text)) return `${t("label.everyDay")} ${days[0]!.text}`;
  // Monday 1 January 2024 starts the week the day names are read from.
  const dayName = (index: number) => new Date(Date.UTC(2024, 0, 1 + index)).toLocaleDateString(intlLocale(locale), { weekday: "short", timeZone: "UTC" });
  const groups: Array<{ first: number; last: number; text: string }> = [];
  for (const day of days) {
    const previous = groups.at(-1);
    if (previous && previous.text === day.text && previous.last === day.index - 1) previous.last = day.index;
    else groups.push({ first: day.index, last: day.index, text: day.text });
  }
  return groups.map(group => `${group.first === group.last ? dayName(group.first) : `${dayName(group.first)}–${dayName(group.last)}`} ${group.text}`).join(t("label.separator"));
}

/** A day in a suggestion as people write it: "2026年12月25日", "25 Dis 2026". */
const dayText = (date: string, locale: EnergyIqLocale) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString(intlLocale(locale), { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });

/** The change in the reader's language, from its payload; null when the payload is not one this page can read. */
function localSuggestionLabel(suggestion: SuggestionDto, locale: EnergyIqLocale, t: FeedbackTranslate): string | null {
  const payload = suggestion.payload ?? {};
  const name = textField(payload.meterName);
  switch (suggestion.kind) {
    case "operating_hours": {
      const hours = hoursText(payload.weekly, locale, t);
      return hours ? t("label.hours", { hours }) : null;
    }
    case "meter_not_in_use": {
      const reason = textField(payload.reason);
      return name && reason ? t("label.meterNotInUse", { name, reason }) : null;
    }
    case "meter_in_use": return name ? t("label.meterInUse", { name }) : null;
    case "meter_always_on": return name && typeof payload.alwaysOn === "boolean" ? t(payload.alwaysOn ? "label.alwaysOn" : "label.notAlwaysOn", { name }) : null;
    case "meter_never_used": return name && typeof payload.neverUsed === "boolean" ? t(payload.neverUsed ? "label.neverUsed" : "label.notNeverUsed", { name }) : null;
    case "light_count": {
      const count = payload.count;
      return name && typeof count === "number" && Number.isInteger(count) && count > 0 ? t("label.lightCount", { name, count: count.toLocaleString(intlLocale(locale)) }) : null;
    }
    case "holiday": {
      const date = textField(payload.date);
      const label = textField(payload.label);
      if (!DAY.test(date) || !label) return null;
      return t(payload.classification === "special_closure" ? "label.closure" : "label.holiday", { date: dayText(date, locale), label });
    }
    case "electricity_rate": {
      const rate = payload.ratePerKwh;
      const from = textField(payload.effectiveFrom);
      const currency = textField(payload.currency);
      // The currency is part of the change: without it the sentence would hide which money the figure is in.
      if (typeof rate !== "number" || !(rate > 0) || !DAY.test(from) || !currency) return null;
      return t("label.rate", { currency, rate: rate.toLocaleString(intlLocale(locale), { maximumFractionDigits: 4 }), date: dayText(from, locale) });
    }
    case "dismiss_check": {
      // Named the way the report names the point, in the reader's language.
      const title = energyReviewCheckTitle(textField(payload.checkKey), name || null, locale);
      return title ? t("label.dismissCheck", { title }) : null;
    }
    default: return null;
  }
}

/**
 * The sentence a suggestion card shows. The server writes it in English from the payload (with the site's currency
 * and the "lights-off at 7:10 am" short form), so English readers see it as written; Chinese and Malay readers get the
 * same change written from the payload in their language, or the English sentence when the payload cannot be read.
 */
export function suggestionLabel(suggestion: SuggestionDto, locale: EnergyIqLocale, t: FeedbackTranslate): string {
  if (locale === "en") return suggestion.label;
  return localSuggestionLabel(suggestion, locale, t) ?? suggestion.label;
}

/** What went wrong with a change (or why an applied one is not live yet) in the reader's language, from its code. */
export function problemText(problem: SuggestionProblem | undefined, locale: EnergyIqLocale, t: FeedbackTranslate): string | null {
  if (!problem || !PROBLEM_CODES.has(problem.code)) return null;
  const name = textField(problem.name);
  const date = DAY.test(textField(problem.date)) ? dayText(textField(problem.date), locale) : "";
  if ((problem.code === "meter_missing" || problem.code === "meter_invalid") && !name) return null;
  if (problem.code === "no_hours_for_date" && !date) return null;
  const main = t(`problem.${problem.code}`, { name, date });
  const detail = problem.detail && PROBLEM_DETAILS.has(problem.detail) ? t(`problem.detail.${problem.detail}`) : "";
  return detail ? sentences([main, detail], locale) : main;
}

/** Sentences one after another: with a space, but none in Chinese. */
export const sentences = (parts: string[], locale: EnergyIqLocale) => parts.filter(Boolean).join(locale === "zh-Hans" ? "" : " ");
/** Why an applied change is not live yet, as the one sentence that says what to do. */
export const notLiveReason = (problem: SuggestionProblem | undefined, t: FeedbackTranslate): string =>
  t(`problem.detail.${problem?.detail && PROBLEM_DETAILS.has(problem.detail) ? problem.detail : "other"}`);
const PROBLEM_CODES: ReadonlySet<ApplyProblemCode> = new Set(["invalid", "no_hours", "hours_changed", "no_hours_for_date", "hours_not_saved", "day_off_not_saved", "no_rate", "peak_pricing", "rate_changed", "rate_not_saved", "meter_missing", "meter_invalid", "setup_conflict", "failed", "not_live"]);
const PROBLEM_DETAILS: ReadonlySet<ApplyProblemDetail> = new Set(["overlap", "outside_range", "bad_time", "admin_required", "setup_invalid", "data_not_ready", "conflict", "other"]);

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
