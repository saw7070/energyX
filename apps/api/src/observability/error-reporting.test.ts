import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  installProcessErrorHandlers,
  reportError,
  setErrorReporter,
  unhandledRejectionMode,
  type ProcessLike,
} from "./error-reporting.js";
import { createLogger } from "./logger.js";
import type { OpsAlert, OpsAlerter } from "./ops-alerts.js";
import { runWithRequestContext } from "./request-context.js";

afterEach(() => setErrorReporter(undefined));

const harness = (mode: ReturnType<typeof unhandledRejectionMode>) => {
  const exit = vi.fn();
  const emitter = Object.assign(new EventEmitter(), { exit });
  const lines: Array<Record<string, unknown>> = [];
  const alerts: OpsAlert[] = [];
  const alerter: OpsAlerter = { enabled: true, notify: (alert) => { alerts.push(alert); return "queued"; }, flush: vi.fn(async () => undefined) };
  const uninstall = installProcessErrorHandlers({
    process: emitter as unknown as ProcessLike,
    log: createLogger({ level: "debug", format: "json", write: (line) => lines.push(JSON.parse(line) as Record<string, unknown>) }),
    alerts: () => alerter,
    mode,
    flushTimeoutMs: 50,
  });
  return { emitter, exit, lines, alerts, alerter, uninstall };
};

describe("process error handling", () => {
  it("logs and alerts an uncaught exception, waits for the alert, then still exits with code 1", async () => {
    const { emitter, exit, lines, alerts, alerter, uninstall } = harness("throw");
    emitter.emit("uncaughtException", new Error("boom token=abc123"), "uncaughtException");
    expect(exit).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(alerter.flush).toHaveBeenCalledWith(50);
    expect(lines[0]).toMatchObject({ level: "error", component: "process", fatal: true, origin: "uncaughtException", err: { message: "boom token=[REDACTED]" } });
    expect(alerts[0]!.text).toContain("API process crashed (uncaughtException)");
    expect(alerts[0]!.text).not.toContain("abc123");
    uninstall();
  });

  it("keeps Node's default: an unhandled rejection ends the process", async () => {
    const { emitter, exit, alerts, uninstall } = harness("throw");
    emitter.emit("unhandledRejection", new Error("ENERGYIQ_LOST_PROMISE"), Promise.resolve());
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(alerts[0]!.text).toContain("API process crashed (unhandledRejection): ENERGYIQ_LOST_PROMISE");
    uninstall();
  });

  it("only logs and alerts an unhandled rejection when Node was told to warn", async () => {
    const { emitter, exit, lines, alerts, uninstall } = harness("warn");
    emitter.emit("unhandledRejection", "plain reason", Promise.resolve());
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(exit).not.toHaveBeenCalled();
    expect(lines[0]).toMatchObject({ level: "error", msg: "unhandled promise rejection" });
    expect(alerts).toEqual([expect.objectContaining({ key: "unhandled-rejection" })]);
    uninstall();
    expect(emitter.listenerCount("unhandledRejection")).toBe(0);
  });

  it("reads the --unhandled-rejections mode from the command line or NODE_OPTIONS", () => {
    expect(unhandledRejectionMode([], undefined)).toBe("throw");
    expect(unhandledRejectionMode(["--unhandled-rejections=warn"], undefined)).toBe("warn");
    expect(unhandledRejectionMode([], "--max-old-space-size=2048 --unhandled-rejections=strict")).toBe("strict");
  });

  it("hands request failures to the error reporter with the request ID", () => {
    const capture = vi.fn();
    setErrorReporter({ capture, flush: async () => undefined });
    const lines: string[] = [];
    const log = createLogger({ level: "info", format: "json", write: (line) => lines.push(line) });
    const error = new Error("UNEXPECTED_FAILURE");
    runWithRequestContext({ requestId: "req-12345678" }, () => reportError(error, "request failed", { component: "http" }, log));
    expect(capture).toHaveBeenCalledWith(error, { component: "http", request_id: "req-12345678" });
    expect(JSON.parse(lines[0]!)).toMatchObject({ msg: "request failed", request_id: "req-12345678", err: { message: "UNEXPECTED_FAILURE" } });
  });
});
