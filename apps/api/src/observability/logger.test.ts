import { describe, expect, it } from "vitest";

import { createLogger, loggerConfigFromEnv, scrubText, type LoggerConfig } from "./logger.js";
import { runWithRequestContext } from "./request-context.js";

const capture = (overrides: Partial<LoggerConfig> = {}) => {
  const lines: string[] = [];
  const log = createLogger({
    level: "debug",
    format: "json",
    write: (line) => lines.push(line),
    now: () => new Date("2026-10-30T01:02:03.004Z"),
    ...overrides,
  });
  return { log, lines, records: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>) };
};

describe("API logger", () => {
  it("writes one JSON object per line: time, level and msg first, then the fields", () => {
    const { log, lines } = capture();
    log.child({ component: "tuya-sync" }).info("succeeded", { project_id: "p1", pass: 2 });
    expect(lines).toEqual([
      '{"time":"2026-10-30T01:02:03.004Z","level":"info","msg":"succeeded","component":"tuya-sync","project_id":"p1","pass":2}',
    ]);
  });

  it("writes nothing below the configured level", () => {
    const { log, lines } = capture({ level: "warn" });
    log.debug("noise");
    log.info("noise");
    log.warn("kept");
    log.error("kept");
    expect(lines).toHaveLength(2);
    const silent = capture({ level: "silent" });
    silent.log.error("dropped");
    expect(silent.lines).toHaveLength(0);
  });

  it("redacts credential fields however deeply they are nested", () => {
    const { log, records } = capture();
    log.info("auth", {
      user_id: "u1",
      password: "hunter2",
      csrfToken: "abc",
      headers: { Authorization: "Bearer abcdefghijkl", cookie: "df_session=xyz", "x-request-id": "kept-id-1" },
      body: { email: "a@example.com" },
      query: "token=abc",
      nested: [{ api_key: "k", access_secret: "s", accessId: "kept" }],
      ENERGYX_OPS_ALERT_WEBHOOK_URL: "https://hooks.slack.com/services/T/B/C",
    });
    const record = records()[0]!;
    expect(record).toMatchObject({
      user_id: "u1",
      password: "[REDACTED]",
      csrfToken: "[REDACTED]",
      headers: { Authorization: "[REDACTED]", cookie: "[REDACTED]", "x-request-id": "kept-id-1" },
      body: "[REDACTED]",
      query: "[REDACTED]",
      nested: [{ api_key: "[REDACTED]", access_secret: "[REDACTED]", accessId: "kept" }],
      ENERGYX_OPS_ALERT_WEBHOOK_URL: "[REDACTED]",
    });
    expect(JSON.stringify(record)).not.toMatch(/hunter2|abcdefghijkl|xyz|a@example\.com|services\/T/u);
  });

  it("removes tokens from free text: query strings, bearer tokens, JWTs, URL passwords and webhook URLs", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.c2lnbmF0dXJlLXZhbHVl";
    const text = [
      "GET /api/v1/auth/reset?token=s3cret&next=/home done",
      "header Authorization: Bearer abcdefghijklmnop",
      `jwt ${jwt}`,
      "db postgres://admin:pa55word@db.internal:5432/x",
      "hook https://hooks.slack.com/services/T000/B000/XXXX failed",
      "teams https://contoso.webhook.office.com/webhookb2/abc/IncomingWebhook/def",
      "csrf_token=abc123 password: hunter2",
      "Why? Because.",
    ].join("\n");
    const scrubbed = scrubText(text);
    expect(scrubbed).toContain("/api/v1/auth/reset?[REDACTED] done");
    expect(scrubbed).toContain("Authorization: [REDACTED]");
    expect(scrubbed).toContain("postgres://[REDACTED]@db.internal:5432/x");
    expect(scrubbed).toContain("https://hooks.slack.com/[REDACTED] failed");
    expect(scrubbed).toContain("https://webhook.office.com/[REDACTED]");
    expect(scrubbed).toContain("Why? Because.");
    expect(scrubbed).not.toMatch(/s3cret|abcdefghijklmnop|pa55word|XXXX|IncomingWebhook|abc123|hunter2/u);
    expect(scrubbed).not.toContain(jwt);
  });

  it("writes errors as type, message and stack, scrubbed like any other text", () => {
    const { log, records } = capture();
    const error = Object.assign(new Error("fetch https://x.example/cb?code=secret-code failed"), { code: "ECONNRESET" });
    log.error("request failed", { err: error });
    const record = records()[0]!;
    expect(record.err).toMatchObject({ type: "Error", message: "fetch https://x.example/cb?[REDACTED] failed", code: "ECONNRESET" });
    expect(String((record.err as { stack: string }).stack)).not.toContain("secret-code");
  });

  it("tags every line written while serving a request with that request's ID", () => {
    const { log, records } = capture();
    runWithRequestContext({ requestId: "req-12345678" }, () => log.info("inside"));
    log.info("outside");
    expect(records().map((record) => record.request_id)).toEqual(["req-12345678", undefined]);
  });

  it("keeps the line's own time, level and msg even when a field uses those names", () => {
    const { log, records } = capture();
    log.warn("real", { msg: "fake", level: "debug", time: "never" });
    expect(records()[0]).toMatchObject({ time: "2026-10-30T01:02:03.004Z", level: "warn", msg: "real" });
  });

  it("writes a readable line outside production", () => {
    const { log, lines } = capture({ format: "pretty" });
    log.child({ component: "live-readings" }).warn("partial", { project_id: "p1", read: 3, note: "two words" });
    expect(lines[0]).toBe('2026-10-30T01:02:03.004Z WARN  [live-readings] partial project_id=p1 read=3 note="two words"');
  });

  it("reads its level and format from the environment", () => {
    expect(loggerConfigFromEnv({})).toMatchObject({ level: "info", format: "pretty" });
    expect(loggerConfigFromEnv({ NODE_ENV: "production" })).toMatchObject({ level: "info", format: "json" });
    expect(loggerConfigFromEnv({ ENERGYX_LOG_LEVEL: "DEBUG", ENERGYX_LOG_FORMAT: "json" })).toMatchObject({ level: "debug", format: "json" });
    expect(loggerConfigFromEnv({ ENERGYX_LOG_LEVEL: "verbose" })).toMatchObject({ level: "info" });
  });
});
