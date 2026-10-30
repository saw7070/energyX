import { describe, expect, it, vi } from "vitest";

import { createBackgroundJobRegistry } from "./background-jobs.js";
import { createLogger } from "./logger.js";
import { createOpsAlerter, type OpsAlerter } from "./ops-alerts.js";

const HOUR = 60 * 60_000;
const WEBHOOK = "https://hooks.slack.com/services/T000/B000/secret-path";

const fakeWebhook = () => {
  const posted: Array<{ url: string; body: { text: string } }> = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    posted.push({ url: String(url), body: JSON.parse(String(init?.body)) as { text: string } });
    return new Response("ok", { status: 200 });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, posted };
};

const silentLog = (lines: string[] = []) => createLogger({ level: "debug", format: "json", write: (line) => lines.push(line) });

describe("operator alerts", () => {
  it("posts Slack/Teams-compatible JSON with a text field, saying which server is speaking", async () => {
    const webhook = fakeWebhook();
    const alerter = createOpsAlerter({ webhookUrl: WEBHOOK, fetch: webhook.fetch, source: "prod-1", log: silentLog() });
    expect(alerter.notify({ key: "k", text: "Background job tuya-sync failed." })).toBe("queued");
    await alerter.flush(1_000);
    expect(webhook.posted).toEqual([{ url: WEBHOOK, body: { text: "EnergyX prod-1: Background job tuya-sync failed." } }]);
  });

  it("sends at most one alert per key per interval, and keys do not hold each other back", async () => {
    let now = 0;
    const webhook = fakeWebhook();
    const alerter = createOpsAlerter({ webhookUrl: WEBHOOK, fetch: webhook.fetch, now: () => now, log: silentLog() });
    expect(alerter.notify({ key: "job-failed:a", text: "a1" })).toBe("queued");
    expect(alerter.notify({ key: "job-failed:a", text: "a2" })).toBe("suppressed");
    expect(alerter.notify({ key: "job-failed:b", text: "b1" })).toBe("queued");
    now = HOUR - 1;
    expect(alerter.notify({ key: "job-failed:a", text: "a3" })).toBe("suppressed");
    now = HOUR;
    expect(alerter.notify({ key: "job-failed:a", text: "a4" })).toBe("queued");
    expect(alerter.notify({ key: "job-recovered:a", text: "r", minIntervalMs: 0 })).toBe("queued");
    expect(alerter.notify({ key: "job-recovered:a", text: "r", minIntervalMs: 0 })).toBe("queued");
    await alerter.flush(1_000);
    expect(webhook.posted.map((post) => post.body.text.split(": ").at(-1))).toEqual(["a1", "b1", "a4", "r", "r"]);
  });

  it("never waits for the webhook, and drops alerts while it is not answering", async () => {
    const hung = vi.fn(() => new Promise<Response>(() => undefined));
    const alerter = createOpsAlerter({ webhookUrl: WEBHOOK, fetch: hung as unknown as typeof fetch, log: silentLog() });
    const results = Array.from({ length: 12 }, (_, index) => alerter.notify({ key: `k${index}`, text: "t" }));
    expect(results).toEqual([...Array<string>(10).fill("queued"), "dropped", "dropped"]);
    const startedAt = Date.now();
    await alerter.flush(50);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it("logs a failed delivery without the webhook URL, which is the credential", async () => {
    const lines: string[] = [];
    const failing = vi.fn(async () => new Response("no", { status: 500 }));
    const alerter = createOpsAlerter({ webhookUrl: WEBHOOK, fetch: failing as unknown as typeof fetch, log: silentLog(lines) });
    alerter.notify({ key: "k", text: "t" });
    await alerter.flush(1_000);
    expect(lines.join("\n")).toContain("delivery failed");
    expect(lines.join("\n")).not.toContain("secret-path");
  });

  it("is off without a webhook, or with one that is not an http(s) URL", () => {
    const lines: string[] = [];
    expect(createOpsAlerter({ log: silentLog() }).notify({ key: "k", text: "t" })).toBe("disabled");
    const invalid = createOpsAlerter({ webhookUrl: "ftp://user:pw@example.com/hook", log: silentLog(lines) });
    expect(invalid.enabled).toBe(false);
    expect(lines.join("\n")).toContain("operator alerts are off");
    expect(lines.join("\n")).not.toContain("pw@");
  });
});

describe("background job health", () => {
  const recordingAlerter = () => {
    const sent: string[] = [];
    let now = 0;
    const webhook = fakeWebhook();
    const alerter = createOpsAlerter({ webhookUrl: WEBHOOK, fetch: webhook.fetch, now: () => now, log: silentLog() });
    const spy: OpsAlerter = {
      enabled: true,
      notify: (alert) => {
        const result = alerter.notify(alert);
        if (result === "queued") sent.push(alert.text);
        return result;
      },
      flush: alerter.flush,
    };
    return { sent, alerts: () => spy, setNow: (value: number) => { now = value; } };
  };

  it("alerts once an hour while a job keeps failing, then once when it recovers", () => {
    let now = 0;
    const { sent, alerts, setNow } = recordingAlerter();
    const registry = createBackgroundJobRegistry({ now: () => now, alerts });
    const job = registry.define("tuya-sync", { staleAfterMs: 26 * HOUR });
    job.start();
    job.failed(new Error("ENERGYIQ_TUYA_API_ERROR:1114"), "project-a");
    now = 10 * 60_000; setNow(now);
    job.failed(new Error("ENERGYIQ_TUYA_API_ERROR:1114"), "project-a");
    now = HOUR; setNow(now);
    job.failed(new Error("ENERGYIQ_TUYA_API_ERROR:1114"), "project-a");
    job.succeeded("project-a");
    expect(sent).toEqual([
      "Background job tuya-sync failed (project-a): ENERGYIQ_TUYA_API_ERROR:1114. Details are in the API log under component tuya-sync.",
      "Background job tuya-sync failed (project-a): ENERGYIQ_TUYA_API_ERROR:1114. Details are in the API log under component tuya-sync.",
      "Background job tuya-sync recovered (project-a).",
    ]);
    expect(registry.snapshot()[0]).toMatchObject({ status: "ok", runs: 4, failures: 3 });
  });

  it("does not call another site's success a recovery", () => {
    const { sent, alerts } = recordingAlerter();
    const registry = createBackgroundJobRegistry({ now: () => 0, alerts });
    const job = registry.define("live-sync", { staleAfterMs: 3 * HOUR });
    job.start();
    job.failed(new Error("ENERGYIQ_TUYA_TOKEN_INVALID"), "project-a");
    job.succeeded("project-b");
    expect(registry.snapshot()[0]).toMatchObject({ status: "failing", failing: [{ subject: "project-a", code: "ENERGYIQ_TUYA_TOKEN_INVALID" }] });
    job.succeeded("project-a");
    expect(registry.snapshot()[0]!.status).toBe("ok");
    expect(sent.filter((text) => text.includes("recovered"))).toEqual(["Background job live-sync recovered (project-a)."]);
  });

  it("reports a job stalled when it has not woken within its interval, and only while it runs", () => {
    let now = 0;
    const registry = createBackgroundJobRegistry({ now: () => now, alerts: () => createOpsAlerter({}) });
    const job = registry.define("live-readings", { staleAfterMs: HOUR });
    expect(registry.snapshot()).toEqual([]);
    job.start();
    now = HOUR;
    expect(registry.snapshot()[0]!.status).toBe("ok");
    now = HOUR + 1;
    expect(registry.snapshot()[0]!.status).toBe("stalled");
    job.heartbeat();
    expect(registry.snapshot()[0]!.status).toBe("ok");
    job.stop();
    expect(registry.snapshot()).toEqual([]);
  });

  it("stops counting a failure that is never retried, without announcing a recovery", () => {
    let now = 0;
    const { sent, alerts } = recordingAlerter();
    const registry = createBackgroundJobRegistry({ now: () => now, alerts });
    const job = registry.define("report-agent", { staleAfterMs: 10 * 60_000, failureTtlMs: 2 * HOUR });
    job.start();
    job.failed(new Error("REPORT_AVAILABLE_PERIOD_UNAVAILABLE"), "schedule:deleted-project");
    now = 2 * HOUR + 1;
    job.heartbeat();
    expect(registry.snapshot()[0]!.status).toBe("ok");
    expect(sent.some((text) => text.includes("recovered"))).toBe(false);
  });

  it("exposes runs, failures, last success and state per job as metrics", () => {
    let now = 1_700_000_000_000;
    const registry = createBackgroundJobRegistry({ now: () => now, alerts: () => createOpsAlerter({}) });
    const job = registry.define("report-email", { staleAfterMs: HOUR });
    job.start();
    job.succeeded("schedule-1");
    now += 1_000;
    job.failed(new Error("SMTP down"), "schedule-2");
    const byName = Object.fromEntries(registry.metricFamilies().map((family) => [family.name, family.samples[0]?.value]));
    expect(byName).toEqual({
      energyx_job_runs_total: 2,
      energyx_job_failures_total: 1,
      energyx_job_last_success_timestamp_seconds: 1_700_000_000,
      energyx_job_last_run_timestamp_seconds: 1_700_000_001,
      energyx_job_failing: 1,
      energyx_job_stalled: 0,
    });
  });
});
