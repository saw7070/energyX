import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isIP } from "node:net";

import { createErrorResult, createSuccessResult } from "@datafoundry/contracts";

import { clientIpAddress } from "../client-ip.js";
import { backgroundJobs } from "./background-jobs.js";
import { logger as rootLogger, type Logger } from "./logger.js";
import { metrics as processMetrics, observeHttpRequest, startProcessMetrics, stopProcessMetrics, type MetricsRegistry } from "./metrics.js";
import { opsAlerts, type OpsAlerter } from "./ops-alerts.js";
import {
  backgroundJobsCheck,
  createReadinessProbe,
  freeDiskCheck,
  metadataDatabaseCheck,
  minFreeDiskMbFromEnv,
  storageWritableCheck,
  type ReadinessProbe,
  type ReadinessReport,
} from "./readiness.js";
import { resolveRequestId, runWithRequestContext, type RequestContext } from "./request-context.js";

/** Liveness, readiness and metrics answer before authentication; they are logged at debug so probes do not drown the log. */
const PROBE_PATHS = new Set(["/healthz", "/ready", "/metrics"]);
const MAX_LOGGED_PATH = 256;

const requestPath = (url: string | undefined): string => {
  try {
    // Only the path: query strings can hold reset or sign-in tokens.
    const pathname = new URL(url ?? "/", "http://localhost").pathname;
    return pathname.length > MAX_LOGGED_PATH ? `${pathname.slice(0, MAX_LOGGED_PATH)}…` : pathname;
  } catch {
    return "[unparseable]";
  }
};

/**
 * Serve one request inside its request context: take the caller's X-Request-Id when it is a short safe token or make
 * one, echo it on the response, and when the response ends write one access-log line and count it in /metrics.
 */
export const observeRequest = (
  request: IncomingMessage,
  response: ServerResponse,
  handle: () => Promise<void>,
  options: { log?: Logger; env?: Record<string, string | undefined> } = {},
): Promise<void> => {
  const log = (options.log ?? rootLogger).child({ component: "http" });
  const startedAt = performance.now();
  const context: RequestContext = { requestId: resolveRequestId(request.headers["x-request-id"]) };
  response.setHeader("X-Request-Id", context.requestId);
  const path = requestPath(request.url);
  let recorded = false;
  const record = (): void => {
    if (recorded) return;
    recorded = true;
    const durationMs = performance.now() - startedAt;
    observeHttpRequest(request.method, response.statusCode, durationMs);
    const ip = clientIpAddress(request, options.env);
    const fields = {
      request_id: context.requestId,
      method: request.method ?? "UNKNOWN",
      path,
      status: response.statusCode,
      duration_ms: Math.round(durationMs * 10) / 10,
      ...(context.userId ? { user_id: context.userId } : {}),
      ...(context.workspaceId ? { workspace_id: context.workspaceId } : {}),
      ...(ip ? { client_ip: ip } : {}),
      // The client went away before the response finished, e.g. a closed tab during a stream.
      ...(response.writableFinished ? {} : { aborted: true }),
    };
    if (PROBE_PATHS.has(path)) log.debug("request", fields);
    else log.info("request", fields);
  };
  response.once("finish", record);
  response.once("close", record);
  return runWithRequestContext(context, handle);
};

const isLoopback = (address: string | undefined): boolean => {
  if (!address) return false;
  const unwrapped = address.startsWith("::ffff:") && isIP(address.slice(7)) === 4 ? address.slice(7) : address;
  return unwrapped === "::1" || (isIP(unwrapped) === 4 && unwrapped.startsWith("127."));
};

const isLoopbackHost = (host: string | undefined): boolean => {
  const name = host?.trim().toLowerCase().replace(/:\d+$/u, "") ?? "";
  return name === "localhost" || name === "[::1]" || /^127(?:\.\d{1,3}){3}$/u.test(name);
};

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * Whether the caller may see operator detail (/metrics, /ready's detail): a direct connection from this host, or a
 * request carrying `Authorization: Bearer $ENERGYX_METRICS_TOKEN`. nginx and the web app also connect from loopback,
 * so a request only counts as local when it also names a loopback Host (nginx sends the site's name or its upstream's)
 * and carries no forwarding headers.
 */
export const isOperatorRequest = (
  request: Pick<IncomingMessage, "headers" | "socket">,
  env: Record<string, string | undefined> = process.env,
): boolean => {
  const token = env.ENERGYX_METRICS_TOKEN?.trim();
  const authorization = request.headers.authorization;
  if (token && typeof authorization === "string" && authorization.startsWith("Bearer ")) {
    if (timingSafeEqual(digest(authorization.slice("Bearer ".length).trim()), digest(token))) return true;
  }
  const proxied = request.headers["x-forwarded-for"] !== undefined
    || request.headers.forwarded !== undefined
    || request.headers["x-real-ip"] !== undefined;
  return !proxied && isLoopback(request.socket?.remoteAddress) && isLoopbackHost(request.headers.host);
};

const sendJson = (response: ServerResponse, status: number, body: unknown): void => {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
};

/** /ready is public through nginx: outside the operator's view it says only which checks pass, not why or by how much. */
const publicReport = (report: ReadinessReport, detailed: boolean) => ({
  status: report.status,
  checked_at: report.checked_at,
  checks: detailed
    ? report.checks
    : Object.fromEntries(Object.entries(report.checks).map(([name, check]) => [name, { status: check.status }])),
});

export type ServerObservability = {
  readiness: ReadinessProbe;
  /** Answer GET /healthz, /ready and /metrics. Returns false for every other request. */
  handleProbe(request: IncomingMessage, response: ServerResponse, pathname: string): Promise<boolean>;
  /** Alert the operator when a critical dependency is already failing as the server starts. */
  checkAtStartup(): Promise<ReadinessReport>;
  close(): void;
};

export const createServerObservability = (input: {
  /** Whether startup has finished, with its timings for /ready. */
  startup: () => { ready: boolean; startupMs: number; phases: Record<string, number> };
  readiness?: ReadinessProbe;
  metadataDb?: () => { prepare(sql: string): { get(): unknown } };
  storageRoot?: string;
  env?: Record<string, string | undefined>;
  metrics?: MetricsRegistry;
  alerts?: () => OpsAlerter;
  log?: Logger;
}): ServerObservability => {
  const env = input.env ?? process.env;
  const registry = input.metrics ?? processMetrics;
  const alerts = input.alerts ?? opsAlerts;
  const log = (input.log ?? rootLogger).child({ component: "readiness" });
  const readiness = input.readiness ?? createReadinessProbe({
    checks: [
      ...(input.metadataDb ? [metadataDatabaseCheck(input.metadataDb)] : []),
      ...(input.storageRoot ? [storageWritableCheck(input.storageRoot), freeDiskCheck(input.storageRoot, minFreeDiskMbFromEnv(env))] : []),
      backgroundJobsCheck(() => backgroundJobs.snapshot()),
    ],
  });
  startProcessMetrics();

  const handleProbe: ServerObservability["handleProbe"] = async (request, response, pathname) => {
    if (request.method !== "GET" && request.method !== "HEAD") return false;
    if (pathname === "/healthz") {
      sendJson(response, 200, createSuccessResult({ status: "ok" }));
      return true;
    }
    if (pathname === "/ready") {
      const startup = input.startup();
      if (!startup.ready) {
        sendJson(response, 503, createErrorResult("INTERNAL_ERROR", "Server is still starting."));
        return true;
      }
      const report = publicReport(await readiness.check(), isOperatorRequest(request, env));
      if (report.status === "not_ready") {
        sendJson(response, 503, createErrorResult("INTERNAL_ERROR", "A critical dependency is unavailable.", report));
      } else {
        sendJson(response, 200, createSuccessResult({ ...report, startup_ms: startup.startupMs, phases: startup.phases }));
      }
      return true;
    }
    if (pathname === "/metrics") {
      if (!isOperatorRequest(request, env)) {
        response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
        response.end("Forbidden\n");
        return true;
      }
      response.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8", "Cache-Control": "no-store" });
      response.end(request.method === "HEAD" ? undefined : registry.render());
      return true;
    }
    return false;
  };

  const checkAtStartup = async (): Promise<ReadinessReport> => {
    const report = await readiness.check();
    const failed = Object.entries(report.checks).filter(([, check]) => check.critical && check.status === "failed");
    if (failed.length > 0) {
      const summary = failed.map(([name, check]) => `${name} (${check.code ?? "failed"})`).join(", ");
      log.error("critical dependency unavailable at startup", { checks: Object.fromEntries(failed) });
      alerts().notify({ key: "startup-dependencies", text: `API started but is not ready: ${summary}. /ready answers 503 until this is fixed.` });
    }
    return report;
  };

  return { readiness, handleProbe, checkAtStartup, close: stopProcessMetrics };
};
