import { mkdtempSync, rmSync } from "node:fs";
import { createServer, get as httpGet, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createBackgroundJobRegistry } from "./background-jobs.js";
import { createServerObservability, isOperatorRequest, observeRequest } from "./http.js";
import { configureLogger, logger, loggerConfigFromEnv } from "./logger.js";
import { createOpsAlerter } from "./ops-alerts.js";
import {
  backgroundJobsCheck,
  createReadinessProbe,
  freeDiskCheck,
  metadataDatabaseCheck,
  storageWritableCheck,
  type ReadinessCheck,
} from "./readiness.js";
import { currentRequestContext, setRequestActor } from "./request-context.js";

const servers: Server[] = [];
let root: string;
let logLines: Array<Record<string, unknown>>;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "energyx-observability-"));
  logLines = [];
  configureLogger({ level: "debug", format: "json", write: (line) => logLines.push(JSON.parse(line) as Record<string, unknown>) });
});

afterEach(async () => {
  configureLogger(loggerConfigFromEnv());
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  rmSync(root, { recursive: true, force: true });
});

const healthyDb = () => ({ prepare: () => ({ get: () => ({ tables: 1 }) }) });

/** A server shaped like the API's: probes first, then the app, all inside observeRequest. */
const serve = async (input: { checks?: ReadinessCheck[]; env?: Record<string, string | undefined>; timeoutMs?: number } = {}) => {
  const observability = createServerObservability({
    startup: () => ({ ready: true, startupMs: 12, phases: { metadata_store: 3 } }),
    readiness: createReadinessProbe({ checks: input.checks ?? [], cacheMs: 0, ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}) }),
    env: input.env ?? {},
    alerts: () => createOpsAlerter({}),
  });
  const server = createServer((request, response) => observeRequest(request, response, async () => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (await observability.handleProbe(request, response, pathname)) return;
    if (pathname === "/api/v1/whoami") {
      setRequestActor("user-1", "workspace-1");
      logger.info("inside the request", { component: "test" });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ requestId: currentRequestContext()?.requestId }));
      return;
    }
    response.writeHead(404);
    response.end();
  }, { env: input.env ?? {} }));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, observability };
};

const accessLines = () => logLines.filter((line) => line.component === "http" && line.msg === "request");

describe("request IDs and the access log", () => {
  it("keeps a safe X-Request-Id, echoes it, and makes it available to code logging during the request", async () => {
    const { base } = await serve();
    const response = await fetch(`${base}/api/v1/whoami?token=should-not-be-logged`, { headers: { "X-Request-Id": "nginx-0123456789abcdef" } });
    expect(response.headers.get("x-request-id")).toBe("nginx-0123456789abcdef");
    expect(await response.json()).toEqual({ requestId: "nginx-0123456789abcdef" });
    expect(logLines.find((line) => line.msg === "inside the request")).toMatchObject({ request_id: "nginx-0123456789abcdef" });
  });

  it("replaces a missing or unsafe X-Request-Id with a new one", async () => {
    const { base } = await serve();
    for (const sent of [undefined, "short", "has spaces in it", "x".repeat(65), "evil\"quote1234"]) {
      const response = await fetch(`${base}/api/v1/whoami`, sent === undefined ? {} : { headers: { "X-Request-Id": sent } });
      const echoed = response.headers.get("x-request-id");
      expect(echoed).toMatch(/^[0-9a-f-]{36}$/u);
      expect((await response.json()).requestId).toBe(echoed);
    }
  });

  it("writes one access line per request: method, path without query, status, duration, user, workspace and request ID", async () => {
    const { base } = await serve();
    await (await fetch(`${base}/api/v1/whoami?token=should-not-be-logged`, { headers: { "X-Request-Id": "req-abcdefgh" } })).text();
    await (await fetch(`${base}/api/v1/missing`, { method: "POST", body: "{\"password\":\"x\"}" })).text();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const lines = accessLines();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      level: "info",
      request_id: "req-abcdefgh",
      method: "GET",
      path: "/api/v1/whoami",
      status: 200,
      user_id: "user-1",
      workspace_id: "workspace-1",
      client_ip: "127.0.0.1",
    });
    expect(typeof lines[0]!.duration_ms).toBe("number");
    expect(lines[1]).toMatchObject({ method: "POST", path: "/api/v1/missing", status: 404 });
    expect(lines[1]).not.toHaveProperty("user_id");
    expect(JSON.stringify(logLines)).not.toMatch(/should-not-be-logged|password/u);
  });

  it("logs probe requests at debug so health checks do not drown the log", async () => {
    const { base } = await serve();
    await (await fetch(`${base}/healthz`)).text();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(accessLines()).toEqual([expect.objectContaining({ path: "/healthz", level: "debug", status: 200 })]);
  });
});

describe("/healthz and /ready", () => {
  const healthyChecks = () => [
    metadataDatabaseCheck(healthyDb),
    storageWritableCheck(root),
    freeDiskCheck(root, 1),
  ];

  it("keeps /healthz as plain liveness", async () => {
    const { base } = await serve({ checks: [metadataDatabaseCheck(() => { throw new Error("closed"); })] });
    const response = await fetch(`${base}/healthz`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { status: "ok" } });
  });

  it("is ready when the database answers, storage takes a write and the disk has room", async () => {
    const { base } = await serve({ checks: healthyChecks() });
    const response = await fetch(`${base}/ready`);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      status: "ready",
      startup_ms: 12,
      checks: { metadata_db: { status: "ok" }, storage_writable: { status: "ok" }, disk_space: { status: "ok", detail: { min_free_mb: 1 } } },
    });
  });

  it("is not ready (503) when the metadata database does not answer", async () => {
    const closed = () => ({ prepare: () => { throw Object.assign(new Error("database is not open"), { code: "ERR_INVALID_STATE" }); } });
    const { base } = await serve({ checks: [metadataDatabaseCheck(closed), storageWritableCheck(root), freeDiskCheck(root, 1)] });
    const response = await fetch(`${base}/ready`);
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error.details).toMatchObject({ status: "not_ready", checks: { metadata_db: { status: "failed", code: "METADATA_DB_UNAVAILABLE" }, storage_writable: { status: "ok" } } });
  });

  it("is not ready (503) when the storage root cannot be written", async () => {
    const missing = join(root, "not-mounted");
    const { base } = await serve({ checks: [metadataDatabaseCheck(healthyDb), storageWritableCheck(missing)] });
    const response = await fetch(`${base}/ready`);
    expect(response.status).toBe(503);
    expect((await response.json()).error.details.checks.storage_writable).toMatchObject({ status: "failed", code: "STORAGE_NOT_WRITABLE", detail: { error: "ENOENT" } });
  });

  it("is not ready (503) when free disk is below the minimum", async () => {
    const statDisk = (async () => ({ bavail: 100, bsize: 1024 * 1024 })) as unknown as Parameters<typeof freeDiskCheck>[2];
    const { base } = await serve({ checks: [metadataDatabaseCheck(healthyDb), freeDiskCheck(root, 1024, statDisk)] });
    const response = await fetch(`${base}/ready`);
    expect(response.status).toBe(503);
    expect((await response.json()).error.details.checks.disk_space).toMatchObject({ status: "failed", code: "DISK_SPACE_LOW", detail: { free_mb: 100, min_free_mb: 1024 } });
  });

  it("fails a check that does not answer within its timeout", async () => {
    const hung: ReadinessCheck = { name: "metadata_db", critical: true, run: () => new Promise(() => undefined) };
    const { base } = await serve({ checks: [hung], timeoutMs: 100 });
    const response = await fetch(`${base}/ready`);
    expect(response.status).toBe(503);
    expect((await response.json()).error.details.checks.metadata_db).toMatchObject({ status: "failed", code: "TIMEOUT" });
  });

  it("stays up but reports degraded (200) when a background job has stalled", async () => {
    let now = 0;
    const registry = createBackgroundJobRegistry({ now: () => now, alerts: () => createOpsAlerter({}) });
    const job = registry.define("live-readings", { staleAfterMs: 60 * 60_000 });
    job.start();
    now = 2 * 60 * 60_000;
    const { base } = await serve({ checks: [...healthyChecks(), backgroundJobsCheck(() => registry.snapshot(), () => now)] });
    const response = await fetch(`${base}/ready`);
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({
      status: "degraded",
      checks: { background_jobs: { status: "degraded", code: "JOBS_STALLED", detail: { "live-readings": { status: "stalled", idle_s: 7200 } } } },
    });
  });

  it("shows proxied callers which checks pass, but not why or by how much", async () => {
    const { base } = await serve({ checks: healthyChecks() });
    const response = await fetch(`${base}/ready`, { headers: { "X-Forwarded-For": "203.0.113.9" } });
    expect(response.status).toBe(200);
    expect((await response.json()).data.checks).toEqual({ metadata_db: { status: "ok" }, storage_writable: { status: "ok" }, disk_space: { status: "ok" } });
  });

  it("alerts the operator when a critical dependency is down at startup", async () => {
    const sent: string[] = [];
    const observability = createServerObservability({
      startup: () => ({ ready: true, startupMs: 0, phases: {} }),
      readiness: createReadinessProbe({ checks: [metadataDatabaseCheck(healthyDb), storageWritableCheck(join(root, "missing"))], cacheMs: 0 }),
      alerts: () => ({ enabled: true, notify: (alert) => { sent.push(alert.text); return "queued"; }, flush: async () => undefined }),
    });
    await observability.checkAtStartup();
    observability.close();
    expect(sent).toEqual(["API started but is not ready: storage_writable (STORAGE_NOT_WRITABLE). /ready answers 503 until this is fixed."]);
  });
});

describe("/metrics and operator-only detail", () => {
  it("serves Prometheus text (requests, latency, process) to callers on this host", async () => {
    const { base } = await serve();
    await (await fetch(`${base}/api/v1/whoami`)).text();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const response = await fetch(`${base}/metrics`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain; version=0.0.4");
    const text = await response.text();
    expect(text).toContain("# TYPE energyx_http_requests_total counter");
    expect(text).toMatch(/^energyx_http_requests_total\{method="GET",status_class="2xx"\} \d+$/mu);
    expect(text).toContain("# TYPE energyx_http_request_duration_seconds histogram");
    expect(text).toMatch(/^energyx_http_request_duration_seconds_bucket\{le="\+Inf",method="GET"\} \d+$/mu);
    expect(text).toMatch(/^energyx_http_request_duration_seconds_count\{method="GET"\} \d+$/mu);
    expect(text).toMatch(/^process_resident_memory_bytes \d+$/mu);
    expect(text).toMatch(/^process_uptime_seconds \d+$/mu);
    expect(text).toContain("# TYPE energyx_job_last_success_timestamp_seconds gauge");
    // Every line is a comment or `name{labels} value`.
    for (const line of text.trimEnd().split("\n")) expect(line).toMatch(/^(# (HELP|TYPE) \w+ .+|\w+(\{[^}]*\})? \S+)$/u);
  });

  it("refuses requests that came through a proxy unless they carry the metrics token", async () => {
    const env = { ENERGYX_METRICS_TOKEN: "metrics-token-123" };
    const { base } = await serve({ env });
    const proxied = { "X-Forwarded-For": "203.0.113.9" };
    expect((await fetch(`${base}/metrics`, { headers: proxied })).status).toBe(403);
    expect((await fetch(`${base}/metrics`, { headers: { ...proxied, Authorization: "Bearer wrong-token" } })).status).toBe(403);
    expect((await fetch(`${base}/metrics`, { headers: { ...proxied, Authorization: "Bearer metrics-token-123" } })).status).toBe(200);
  });

  it("treats only a direct loopback connection, or the token, as the operator", () => {
    const request = (remoteAddress: string, headers: Record<string, string> = { host: "127.0.0.1:8787" }) =>
      ({ headers, socket: { remoteAddress } }) as unknown as Parameters<typeof isOperatorRequest>[0];
    expect(isOperatorRequest(request("127.0.0.1"), {})).toBe(true);
    expect(isOperatorRequest(request("::1", { host: "localhost:8787" }), {})).toBe(true);
    expect(isOperatorRequest(request("::ffff:127.0.0.1", { host: "[::1]:8787" }), {})).toBe(true);
    expect(isOperatorRequest(request("10.0.0.5"), {})).toBe(false);
    expect(isOperatorRequest(request("127.0.0.1", { host: "127.0.0.1:8787", "x-real-ip": "203.0.113.9" }), {})).toBe(false);
    // nginx connects from loopback too, but names the public site (proxy_set_header Host $host) or its upstream.
    expect(isOperatorRequest(request("127.0.0.1", { host: "energyx.example.com" }), {})).toBe(false);
    expect(isOperatorRequest(request("127.0.0.1", { host: "datafoundry_api" }), {})).toBe(false);
    expect(isOperatorRequest(request("203.0.113.9", { authorization: "Bearer t0ken-value" }), { ENERGYX_METRICS_TOKEN: "t0ken-value" })).toBe(true);
    expect(isOperatorRequest(request("203.0.113.9", { authorization: "Bearer t0ken-value" }), {})).toBe(false);
  });

  it("does not show /ready's detail to a request nginx passed through without forwarding headers", async () => {
    const { base } = await serve({ checks: [metadataDatabaseCheck(healthyDb), freeDiskCheck(root, 1)] });
    // fetch() will not send a custom Host header, so ask the way nginx does.
    const body = await new Promise<string>((resolve, reject) => {
      httpGet(`${base}/ready`, { headers: { Host: "energyx.example.com" } }, (response) => {
        let text = "";
        response.on("data", (chunk) => { text += String(chunk); });
        response.on("end", () => resolve(text));
      }).on("error", reject);
    });
    expect(JSON.parse(body).data.checks).toEqual({ metadata_db: { status: "ok" }, disk_space: { status: "ok" } });
  });
});
