import { currentRequestContext } from "./request-context.js";

/**
 * The API's log. One line per event on stdout, which systemd hands to journald: in production a JSON object (time,
 * level, msg, then the event's fields) that a log shipper can parse; elsewhere a plain readable line. Anything that
 * could carry a credential is redacted before a line is written, so a careless call cannot leak one: fields named like
 * passwords, tokens, cookies or keys, request bodies and query strings, bearer tokens, JWTs, URL passwords and
 * webhook URLs inside any text.
 *
 * ENERGYX_LOG_LEVEL is the least severe level written: debug, info (default), warn, error or silent.
 * ENERGYX_LOG_FORMAT forces json or pretty; by default production is json and everything else pretty.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

export type Logger = {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  /** A logger that adds these fields to every line, such as the component writing it. */
  child(fields: LogFields): Logger;
  isLevelEnabled(level: LogLevel): boolean;
};

export type LoggerConfig = {
  level: LogLevel | "silent";
  format: "json" | "pretty";
  write: (line: string) => void;
  now?: () => Date;
};

const LEVELS: Record<LogLevel | "silent", number> = { debug: 20, info: 30, warn: 40, error: 50, silent: 100 };

const isLevel = (value: string): value is LogLevel | "silent" => Object.hasOwn(LEVELS, value);

export const loggerConfigFromEnv = (
  env: Record<string, string | undefined> = process.env,
  write: (line: string) => void = (line) => { process.stdout.write(`${line}\n`); },
): LoggerConfig => {
  const level = env.ENERGYX_LOG_LEVEL?.trim().toLowerCase() ?? "";
  const format = env.ENERGYX_LOG_FORMAT?.trim().toLowerCase();
  return {
    level: isLevel(level) ? level : "info",
    format: format === "json" || format === "pretty" ? format : env.NODE_ENV === "production" ? "json" : "pretty",
    write,
  };
};

const REDACTED = "[REDACTED]";
const MAX_DEPTH = 5;
const MAX_STRING = 4000;
const MAX_ITEMS = 50;

/** Field names whose values are never written, compared lower-case with separators removed. */
const SENSITIVE_KEY_PARTS = [
  "password", "passwd", "passphrase", "secret", "token", "authorization", "cookie", "apikey", "accesskey",
  "privatekey", "credential", "signature", "webhook",
];
/** Exact field names that hold request content or one-time codes rather than metadata about a request. */
const SENSITIVE_KEYS = new Set(["body", "rawbody", "requestbody", "query", "querystring", "search", "otp", "mfacode", "totp"]);

export const isSensitiveKey = (key: string): boolean => {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/gu, "");
  return SENSITIVE_KEYS.has(normalized) || SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
};

const TEXT_REDACTIONS: Array<[RegExp, string]> = [
  // Slack and Microsoft Teams incoming-webhook URLs carry their secret in the path.
  [/https:\/\/hooks\.slack\.com\/[^\s"'<>]+/giu, `https://hooks.slack.com/${REDACTED}`],
  [/https:\/\/[a-z0-9.-]*webhook\.office\.com\/[^\s"'<>]+/giu, `https://webhook.office.com/${REDACTED}`],
  // user:password@ in a URL.
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:"'<>]+:[^\s/@"'<>]+@/giu, `$1${REDACTED}@`],
  // Query strings, which may hold reset, sign-in or signed-URL tokens: keep the path, drop every value.
  [/\?[^\s"'<>#?]*=[^\s"'<>#]*/gu, `?${REDACTED}`],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gu, `Bearer ${REDACTED}`],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/gu, REDACTED],
  // key=value or key: value pairs written into text, including csrf_token=… and Authorization: Basic ….
  [/(password|passwd|secret|token|api[_-]?key|authorization|cookie)(\s*[=:]\s*)(?:(?:Basic|Bearer|Digest)\s+)?[^\s,;&"']+/giu, `$1$2${REDACTED}`],
];

/** Remove credentials from free text such as a message, an error message or a stack. */
export const scrubText = (text: string): string => {
  let scrubbed = text.length > MAX_STRING ? `${text.slice(0, MAX_STRING)}…` : text;
  for (const [pattern, replacement] of TEXT_REDACTIONS) scrubbed = scrubbed.replace(pattern, replacement);
  return scrubbed;
};

const serializeError = (error: Error, depth: number, seen: WeakSet<object>): Record<string, unknown> => {
  const serialized: Record<string, unknown> = { type: error.name, message: scrubText(error.message) };
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" || typeof code === "number") serialized.code = code;
  if (error.stack) serialized.stack = scrubText(error.stack);
  if (error.cause !== undefined && depth < MAX_DEPTH) serialized.cause = sanitize(error.cause, depth + 1, seen);
  return serialized;
};

/** A copy of a value that is safe to write: credentials redacted, size bounded, cycles cut. */
export const sanitize = (value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown => {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return scrubText(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") return undefined;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (Buffer.isBuffer(value) || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return `[binary ${(value as { byteLength: number }).byteLength} bytes]`;
  }
  if (seen.has(value)) return "[circular]";
  if (depth >= MAX_DEPTH) return "[truncated]";
  seen.add(value);
  try {
    if (value instanceof Error) return serializeError(value, depth, seen);
    if (Array.isArray(value)) {
      const items = value.slice(0, MAX_ITEMS).map((item) => sanitize(item, depth + 1, seen));
      return value.length > MAX_ITEMS ? [...items, `[${value.length - MAX_ITEMS} more]`] : items;
    }
    if (value instanceof Map) return sanitize(Object.fromEntries(value), depth, seen);
    if (value instanceof Set) return sanitize([...value], depth, seen);
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (isSensitiveKey(key)) {
        result[key] = REDACTED;
        continue;
      }
      const clean = sanitize(item, depth + 1, seen);
      if (clean !== undefined) result[key] = clean;
    }
    return result;
  } finally {
    seen.delete(value);
  }
};

const prettyValue = (value: unknown): string => {
  if (typeof value === "string") return /^[^\s"=]+$/u.test(value) ? value : JSON.stringify(value);
  return JSON.stringify(value);
};

const formatPretty = (record: Record<string, unknown>): string => {
  const { time, level, msg, component, err, ...fields } = record;
  const head = `${String(time)} ${String(level).toUpperCase().padEnd(5)} ${component ? `[${String(component)}] ` : ""}${String(msg)}`;
  const tail = Object.entries(fields).map(([key, value]) => `${key}=${prettyValue(value)}`).join(" ");
  const error = err && typeof err === "object" ? err as { type?: unknown; message?: unknown; stack?: unknown } : undefined;
  const errorText = error ? `\n  ${typeof error.stack === "string" ? error.stack : `${String(error.type)}: ${String(error.message)}`}` : "";
  return `${head}${tail ? ` ${tail}` : ""}${errorText}`;
};

export const createLogger = (config: LoggerConfig | (() => LoggerConfig), bindings: LogFields = {}): Logger => {
  const resolve = typeof config === "function" ? config : () => config;
  const enabled = (level: LogLevel) => LEVELS[level] >= LEVELS[resolve().level];
  const emit = (level: LogLevel, msg: string, fields?: LogFields): void => {
    const active = resolve();
    if (LEVELS[level] < LEVELS[active.level]) return;
    const requestId = currentRequestContext()?.requestId;
    const merged = sanitize({ ...(requestId ? { request_id: requestId } : {}), ...bindings, ...fields }) as LogFields;
    const record: LogFields = { time: (active.now?.() ?? new Date()).toISOString(), level, msg: scrubText(msg) };
    for (const [key, value] of Object.entries(merged)) if (!(key in record)) record[key] = value;
    let line: string;
    try {
      line = active.format === "json" ? JSON.stringify(record) : formatPretty(record);
    } catch {
      line = JSON.stringify({ time: record.time, level, msg: record.msg, log_error: "fields could not be serialized" });
    }
    try {
      active.write(line);
    } catch {
      // A closed stdout must never take a request or a background job down with it.
    }
  };
  return {
    debug: (msg, fields) => emit("debug", msg, fields),
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
    child: (fields) => createLogger(resolve, { ...bindings, ...fields }),
    isLevelEnabled: enabled,
  };
};

let rootConfig: LoggerConfig | undefined;

/**
 * Re-read the log settings. The root logger reads them on first use, which is after the entry point has loaded
 * `.env`; call this when the environment changes later, or with a custom writer in a test.
 */
export const configureLogger = (config: LoggerConfig = loggerConfigFromEnv()): void => {
  rootConfig = config;
};

/** The API's root logger. Use `logger.child({ component })` or a `component` field to say what is writing. */
export const logger: Logger = createLogger(() => (rootConfig ??= loggerConfigFromEnv()));
