import { logger, type Logger } from "./logger.js";
import { currentRequestContext } from "./request-context.js";
import { jobFailureCode } from "./background-jobs.js";
import { opsAlerts, type OpsAlerter } from "./ops-alerts.js";

/**
 * Where unexpected errors go besides the log. The default reporter does nothing; this is the seam for an error tracker
 * such as Sentry or an OpenTelemetry exporter. To add one, initialise its SDK in src/index.ts after `.env` is loaded and
 * call `setErrorReporter({ capture: (error, context) => Sentry.captureException(error, { extra: context }),
 * flush: (ms) => Sentry.flush(ms).then(() => undefined) })`. Request failures (HTTP 500) and process crashes are passed
 * here with the request ID when there is one, so the tracker's events and the API log can be matched.
 */
export type ErrorReporter = {
  capture(error: unknown, context: Record<string, unknown>): void;
  flush(timeoutMs: number): Promise<void>;
};

const noopReporter: ErrorReporter = { capture: () => undefined, flush: async () => undefined };
let reporter: ErrorReporter = noopReporter;

export const setErrorReporter = (next: ErrorReporter | undefined): void => {
  reporter = next ?? noopReporter;
};

/** Log an unexpected error with the current request's ID and hand it to the error reporter. */
export const reportError = (error: unknown, msg: string, fields: Record<string, unknown> = {}, log: Logger = logger): void => {
  log.error(msg, { ...fields, err: error });
  try {
    const requestId = currentRequestContext()?.requestId;
    reporter.capture(error, { ...fields, ...(requestId ? { request_id: requestId } : {}) });
  } catch {
    // A broken reporter must not turn one failure into two.
  }
};

type UnhandledRejectionMode = "throw" | "strict" | "warn" | "none" | "warn-with-error-code";

/** The --unhandled-rejections mode Node runs with; Node's default is throw. */
export const unhandledRejectionMode = (
  execArgv: readonly string[] = process.execArgv,
  nodeOptions: string | undefined = process.env.NODE_OPTIONS,
): UnhandledRejectionMode => {
  const flags = [...execArgv, ...(nodeOptions?.split(/\s+/u) ?? [])];
  for (let index = flags.length - 1; index >= 0; index -= 1) {
    const match = /^--unhandled-rejections=(throw|strict|warn|none|warn-with-error-code)$/u.exec(flags[index] ?? "");
    if (match) return match[1] as UnhandledRejectionMode;
  }
  return "throw";
};

export type ProcessLike = Pick<NodeJS.Process, "on" | "off" | "exit"> & { exitCode?: number | string | null | undefined };

/**
 * Log and alert on errors nothing else caught, without changing what Node would do with them. An uncaught exception,
 * and an unhandled rejection under Node's default `throw` mode, still end the process with exit code 1 (systemd's
 * Restart= then brings it back); the exit only waits, at most `flushTimeoutMs`, for the alert and reporter to send. Under
 * `--unhandled-rejections=warn` or `none` a rejection is logged and the process carries on, as it would have.
 */
export const installProcessErrorHandlers = (input: {
  process?: ProcessLike;
  log?: Logger;
  alerts?: () => OpsAlerter;
  mode?: UnhandledRejectionMode;
  flushTimeoutMs?: number;
} = {}): (() => void) => {
  const target = input.process ?? process;
  const log = (input.log ?? logger).child({ component: "process" });
  const alerts = input.alerts ?? opsAlerts;
  const mode = input.mode ?? unhandledRejectionMode();
  const flushTimeoutMs = input.flushTimeoutMs ?? 2_000;
  let exiting = false;

  const crash = (error: unknown, origin: string): void => {
    if (exiting) {
      // A second failure while flushing: stop waiting.
      target.exit(1);
      return;
    }
    exiting = true;
    log.error("process crashed; exiting", { origin, fatal: true, err: error });
    try { reporter.capture(error, { origin, fatal: true }); } catch { /* reporter is best effort */ }
    alerts().notify({ key: `crash:${origin}`, text: `API process crashed (${origin}): ${jobFailureCode(error)}. It exits with code 1 for systemd to restart.`, minIntervalMs: 0 });
    void Promise.allSettled([alerts().flush(flushTimeoutMs), reporter.flush(flushTimeoutMs)])
      .finally(() => target.exit(1));
  };

  const onUncaughtException = (error: Error, origin: string): void => crash(error, origin === "unhandledRejection" ? "unhandledRejection" : "uncaughtException");
  const onUnhandledRejection = (reason: unknown): void => {
    if (mode === "throw") {
      crash(reason, "unhandledRejection");
      return;
    }
    // strict raises the rejection as an uncaught exception first, so it reaches crash() through that handler instead.
    if (mode === "strict") return;
    if (mode === "warn-with-error-code") target.exitCode = 1;
    log.error("unhandled promise rejection", { err: reason });
    try { reporter.capture(reason, { origin: "unhandledRejection" }); } catch { /* reporter is best effort */ }
    alerts().notify({ key: "unhandled-rejection", text: `Unhandled promise rejection in the API: ${jobFailureCode(reason)}.`, minIntervalMs: 15 * 60_000 });
  };

  target.on("uncaughtException", onUncaughtException);
  target.on("unhandledRejection", onUnhandledRejection);
  return () => {
    target.off("uncaughtException", onUncaughtException);
    target.off("unhandledRejection", onUnhandledRejection);
  };
};
