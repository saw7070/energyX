import { hostname } from "node:os";

import { logger as rootLogger, scrubText, type Logger } from "./logger.js";
import { metrics } from "./metrics.js";

/**
 * Messages to whoever runs the server, posted to a Slack or Microsoft Teams incoming webhook
 * (ENERGYX_OPS_ALERT_WEBHOOK_URL) as JSON with a `text` field. Sending never waits on the webhook: an alert is posted
 * in the background with a short timeout, and a failed post is logged and dropped, so a slow or broken webhook can
 * never hold up a background job or a request. Each alert has a key, and at most one alert per key goes out per
 * interval (ENERGYX_OPS_ALERT_MIN_INTERVAL_MINUTES, default 60), so a job failing every few minutes pages once an hour.
 */
export type OpsAlert = {
  /** Alerts with the same key are rate-limited together, e.g. `job-failed:tuya-sync`. */
  key: string;
  text: string;
  /** Overrides the default interval for this key; 0 sends every time. */
  minIntervalMs?: number;
};

export type OpsAlertResult = "queued" | "suppressed" | "disabled" | "dropped";

export type OpsAlerter = {
  readonly enabled: boolean;
  notify(alert: OpsAlert): OpsAlertResult;
  /** Wait, at most `timeoutMs`, for alerts already queued. Used before the process exits after a crash. */
  flush(timeoutMs: number): Promise<void>;
};

const DEFAULT_MIN_INTERVAL_MS = 60 * 60_000;
const DELIVERY_TIMEOUT_MS = 5_000;
/**
 * More alerts than this in flight means the webhook is not answering; further ones are dropped, not queued. High enough
 * for every job to fail at once (a network outage) without losing any.
 */
const MAX_IN_FLIGHT = 10;
const MAX_TEXT = 3_000;

const alertsTotal = metrics.counter("energyx_ops_alerts_total", "Operator alerts by result: sent, failed, suppressed (rate limit) or dropped.");

export const createOpsAlerter = (input: {
  webhookUrl?: string | undefined;
  minIntervalMs?: number;
  /** Who is speaking, so alerts from several servers can be told apart. Defaults to the host name. */
  source?: string;
  fetch?: typeof fetch;
  now?: () => number;
  log?: Logger;
}): OpsAlerter => {
  const log = (input.log ?? rootLogger).child({ component: "ops-alert" });
  const url = parseWebhookUrl(input.webhookUrl, log);
  const minIntervalMs = input.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const send = input.fetch ?? fetch;
  const now = input.now ?? Date.now;
  const source = input.source ?? hostname();
  const lastSent = new Map<string, number>();
  const inFlight = new Set<Promise<void>>();

  const deliver = async (key: string, text: string): Promise<void> => {
    try {
      const response = await send(url!, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      alertsTotal.inc({ result: "sent" });
      log.debug("sent", { key });
    } catch (error) {
      alertsTotal.inc({ result: "failed" });
      // Never log the webhook URL: its path is the credential.
      log.warn("delivery failed", { key, code: error instanceof Error ? error.message.slice(0, 160) : "unknown" });
    }
  };

  return {
    enabled: url !== undefined,
    notify(alert) {
      if (!url) return "disabled";
      const at = now();
      const previous = lastSent.get(alert.key);
      if (previous !== undefined && at - previous < (alert.minIntervalMs ?? minIntervalMs)) {
        alertsTotal.inc({ result: "suppressed" });
        return "suppressed";
      }
      if (inFlight.size >= MAX_IN_FLIGHT) {
        alertsTotal.inc({ result: "dropped" });
        log.warn("dropped: webhook not answering", { key: alert.key });
        return "dropped";
      }
      lastSent.set(alert.key, at);
      const text = scrubText(`EnergyX ${source}: ${alert.text}`).slice(0, MAX_TEXT);
      const delivery = deliver(alert.key, text).finally(() => { inFlight.delete(delivery); });
      inFlight.add(delivery);
      return "queued";
    },
    async flush(timeoutMs) {
      if (inFlight.size === 0) return;
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        Promise.allSettled([...inFlight]),
        new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); timer.unref(); }),
      ]);
      if (timer) clearTimeout(timer);
    },
  };
};

const parseWebhookUrl = (value: string | undefined, log: Logger): string | undefined => {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") return parsed.toString();
  } catch {
    // Reported below without echoing the value, which is a credential.
  }
  log.warn("ENERGYX_OPS_ALERT_WEBHOOK_URL is not an http(s) URL; operator alerts are off");
  return undefined;
};

export const opsAlerterFromEnv = (env: Record<string, string | undefined> = process.env): OpsAlerter => {
  const minutes = Number(env.ENERGYX_OPS_ALERT_MIN_INTERVAL_MINUTES);
  return createOpsAlerter({
    webhookUrl: env.ENERGYX_OPS_ALERT_WEBHOOK_URL,
    ...(env.ENERGYX_OPS_ALERT_MIN_INTERVAL_MINUTES?.trim() && Number.isFinite(minutes) && minutes >= 0
      ? { minIntervalMs: minutes * 60_000 }
      : {}),
  });
};

let processAlerter: OpsAlerter | undefined;

/** The process's alerter, built from the environment on first use (after the entry point has loaded `.env`). */
export const opsAlerts = (): OpsAlerter => (processAlerter ??= opsAlerterFromEnv());

/** Replace the process's alerter, e.g. after the environment changed or in a test. */
export const setOpsAlerter = (alerter: OpsAlerter | undefined): void => {
  processAlerter = alerter;
};
