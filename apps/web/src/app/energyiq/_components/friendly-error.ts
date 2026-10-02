import { useCallback } from "react";
import { useEnergyIqLocale } from "./energyiq-locale";
import { translatorFor, type EnergyIqLocale } from "./energyiq-messages";
import { friendlyErrorMessages } from "./friendly-error-messages";

/**
 * Turns whatever a failed request or action threw into a sentence a reader can act on.
 *
 * The API client throws `ConfigApiError(code, message, status)` whose message is usually a bare server code
 * ("ENERGYIQ_PROJECT_MOVE_STALE"); the browser throws "Failed to fetch" and friends. Screens that print
 * `reason.message` therefore show codes. These helpers map the common codes and failure families to plain wording,
 * pass already-human server sentences (sign-in messages, admin rules) through unchanged, and fall back to the
 * screen's own wording or a generic sentence for anything else that looks technical.
 *
 * Screens that already map codes themselves (smart import, live connection, AI models) read `error.message` directly
 * and are unaffected: nothing here changes the error objects.
 */

export type FriendlyErrorKey = Extract<keyof typeof friendlyErrorMessages.en, string>;

type ErrorParts = { text: string; code: string; status: number | undefined };

function errorParts(reason: unknown): ErrorParts {
  if (typeof reason === "string") return { text: reason.trim(), code: "", status: undefined };
  if (reason && typeof reason === "object") {
    const { message, code, status } = reason as { message?: unknown; code?: unknown; status?: unknown };
    return {
      text: typeof message === "string" ? message.trim() : "",
      code: typeof code === "string" ? code : "",
      status: typeof status === "number" ? status : undefined,
    };
  }
  return { text: "", code: "", status: undefined };
}

const HTTP_REASON = "OK|Bad Request|Unauthori[sz]ed|Forbidden|Not Found|Method Not Allowed|Conflict|Payload Too Large|Too Many Requests|Internal Server Error|Not Implemented|Bad Gateway|Service Unavailable|Gateway Timeout";

const TECHNICAL_PATTERNS: RegExp[] = [
  /^[A-Z][A-Z0-9_]+(?::[\s\S]*)?$/, // a bare server code, optionally with detail after a colon
  /\b(?:ENERGYIQ|REPORT|SECRET)_[A-Z0-9_]+/,
  /\b[A-Z][A-Z0-9]*_[A-Z0-9]+(?:_[A-Z0-9]+)*\b/, // a code inside a sentence ("Saved, but: TIER_ORDINAL_GAP")
  /Invalid JSON response/i,
  /Failed to fetch/i,
  /NetworkError/i,
  /Network request failed/i,
  /^Load failed$/i, // Safari's wording for a failed fetch
  /Unexpected (?:token|end of JSON)/i,
  /JSON at position/i,
  /Empty response body/i,
  /^Request failed\b.*\(\d{3}\)$/i,
  /status code \d{3}/i,
  new RegExp(`^(?:HTTP(?: error)?:?\\s*)?[1-5]\\d{2}(?:\\s*[-:]?\\s*(?:${HTTP_REASON}))?\\.?$`, "i"),
  new RegExp(`^(?:${HTTP_REASON})\\.?$`, "i"),
  /\bCSRF\b/i,
  /\btoken\b/i,
  /\b(?:ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN)\b/,
  /\b(?:TypeError|SyntaxError|ReferenceError|RangeError)\b/,
  /Cannot read propert|is not a function|is not defined|is not iterable/,
  /\bAbortError\b|operation was aborted|signal is aborted/i,
  /<\/?(?:html|body|head|!doctype)\b/i,
];

/** True for text that is a code, a raw HTTP / network failure or other wording meant for developers, not readers. */
export function isTechnicalMessage(text: string): boolean {
  const value = text.trim();
  return value.length > 0 && TECHNICAL_PATTERNS.some(pattern => pattern.test(value));
}

const RUNTIME_ERROR_NAMES = new Set(["TypeError", "SyntaxError", "ReferenceError", "RangeError", "AbortError"]);
const isTechnical = (reason: unknown, text: string) =>
  isTechnicalMessage(text) || (reason instanceof Error && RUNTIME_ERROR_NAMES.has(reason.name));

/** Ordered: the specific codes first, then the broad families they would otherwise fall into. */
const RULES: Array<[RegExp, FriendlyErrorKey]> = [
  [/\bCSRF\b/i, "sessionEnded"],
  [/\btoken\b[\s\S]*\b(?:invalid|expired)\b|\b(?:invalid|expired)\b[\s\S]*\btoken\b/i, "linkExpired"],
  [/REPORT_ALREADY_RUNNING/, "reportAlreadyRunning"],
  [/REPORT_MODEL_NOT_CONFIGURED/, "advisorNotSetUp"],
  [/FILE_TYPE_INVALID|UNSUPPORTED_FILE_TYPE/, "fileTypeUnsupported"],
  [/TOO_LARGE\b/, "fileTooLarge"],
  [/DATA_NOT_READY/, "dataNotReady"],
  [/\bENERGYIQ_(?:PROJECT_)?SETUP_INVALID\b|\b(?:TIER|NODE)_[A-Z_]+|\bLOCATION_WITHOUT_METER\b|\bSIBLING_NAME_DUPLICATE\b|\bMETER_[A-Z_]+|\bOFFICIAL_ROUTE[A-Z_]*|\bVIRTUAL_METER_[A-Z_]+|\bSOURCE_LABEL_DUPLICATE\b|\bDUPLICATE_ROUTE\b/, "setupIncomplete"],
  [/Failed to fetch|NetworkError|Network request failed|^Load failed$|Invalid JSON response|Empty response body|Unexpected (?:token|end of JSON)|JSON at position|\b(?:ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN)\b|\bNETWORK|\bOFFLINE\b|\bREQUEST_TIMEOUT\b|^TIMEOUT$|Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout/i, "network"],
  [/STALE|CONFLICT|_CHANGED\b|_CHANGED_RETRY\b/, "conflict"],
  [/FORBIDDEN|ADMIN_REQUIRED|ACCESS_DENIED/, "forbidden"],
  [/UNAUTHORI[SZ]ED|AUTHENTICATION_REQUIRED|SESSION_EXPIRED/, "sessionEnded"],
  [/\bRESOURCE_NOT_FOUND\b|\b(?:[A-Z]+_)?(?:REPORT|ACTION|FILE|TASK|PROJECT|WORKSPACE|ORGANISATION|USER|SESSION|ARTIFACT|SKILL|JOB|SUGGESTION)_NOT_FOUND\b/, "notFound"],
  [/RATE_LIMITED|QUEUE_FULL/, "busy"],
];

/** Codes that only name the HTTP outcome; the status then says more than the text does. */
const GENERIC_CODE = /^(?:INTERNAL_ERROR|BAD_REQUEST|NOT_FOUND|RESOURCE_NOT_FOUND|UNKNOWN_ERROR|ERROR)$/;

/** A domain code ("ENERGYIQ_LATEST_COMPLETE_DAY_NOT_FOUND") says more than the generic HTTP code or status around it. */
const isSpecificCode = (text: string) => /[A-Z][A-Z0-9]*_[A-Z0-9_]+/.test(text) && !GENERIC_CODE.test(text);

function statusKey(status: number, specific: boolean): FriendlyErrorKey | null {
  // A specific domain code under 404 / 500 ("no readings for that day") is not a missing page or a lost connection.
  if (status === 401) return "sessionEnded";
  if (status === 403) return "forbidden";
  if (status === 409 || status === 412) return "conflict";
  if (status === 413) return "fileTooLarge";
  if (status === 429) return "busy";
  if (status === 0 || status === 502 || status === 503 || status === 504) return "network";
  if (status === 404 && !specific) return "notFound";
  if (status >= 500 && !specific) return "network";
  return null;
}

/**
 * The message key for a failure, or null when there is nothing specific to say. Human sentences from the server
 * ("Invalid email or password.") are left alone (null), except "Authentication required.", which means the session ended.
 */
export function friendlyErrorKey(reason: unknown): FriendlyErrorKey | null {
  const { text, code, status } = errorParts(reason);
  if (text && !isTechnical(reason, text)) return /^Authentication required\.?$/i.test(text) ? "sessionEnded" : null;
  const fromText = text ? RULES.find(([pattern]) => pattern.test(text)) : undefined;
  if (fromText) return fromText[1];
  const specific = isSpecificCode(text);
  // The envelope code ("FORBIDDEN", "RESOURCE_NOT_FOUND") only speaks when the message names nothing more specific.
  const fromCode = code && !specific ? RULES.find(([pattern]) => pattern.test(code)) : undefined;
  if (fromCode) return fromCode[1];
  const statusFromText = /\((\d{3})\)$|\b(?:HTTP|status(?: code)?):?\s*(\d{3})\b|^(\d{3})\b/i.exec(text);
  const httpStatus = status ?? (statusFromText ? Number(statusFromText[1] ?? statusFromText[2] ?? statusFromText[3]) : undefined);
  const byStatus = httpStatus === undefined ? null : statusKey(httpStatus, specific);
  if (byStatus) return byStatus;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "network";
  return null;
}

/**
 * The sentence to show for a failure: the mapped wording when the failure is recognised; otherwise the screen's own
 * `fallback` (or a generic sentence) when the text is technical; otherwise the server's own human sentence.
 */
export function friendlyErrorMessage(reason: unknown, options: { locale?: EnergyIqLocale; fallback?: string } = {}): string {
  const t = translatorFor(friendlyErrorMessages, options.locale ?? "en");
  const key = friendlyErrorKey(reason);
  if (key) return t(key);
  const { text } = errorParts(reason);
  if (!text || isTechnical(reason, text)) return options.fallback ?? t("generic");
  return text;
}

/** `friendlyErrorMessage` in the reader's language: `const friendly = useFriendlyError(); setError(friendly(reason, t("saveFailed")))`. */
export function useFriendlyError(): (reason: unknown, fallback?: string) => string {
  const { locale } = useEnergyIqLocale();
  return useCallback((reason: unknown, fallback?: string) => friendlyErrorMessage(reason, { locale, fallback }), [locale]);
}
