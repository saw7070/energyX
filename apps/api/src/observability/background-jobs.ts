import { logger, scrubText } from "./logger.js";
import { metrics, type MetricFamily } from "./metrics.js";
import { opsAlerts, type OpsAlerter } from "./ops-alerts.js";

/**
 * What the API's timers are doing: each background job (the Tuya sync, the live poller, the alert and report emails,
 * the report agent) reports when it wakes, and when a run succeeds or fails. That feeds /ready (a job that has not
 * woken for too long is stalled), /metrics, and the operator alerts.
 *
 * A job that works through many sites reports each site as a subject, so one broken site keeps the job failing until
 * that same site succeeds; another site succeeding is not a recovery. A subject that stops being retried (a project
 * deleted or switched off) stops counting after `failureTtlMs` without anyone being told it recovered.
 */
export type BackgroundJobOptions = {
  /** Longer than this without waking or finishing a run is a stall. Allow for the job's interval plus a slow run. */
  staleAfterMs: number;
  /** How long an unrepeated failure keeps the job failing. Default 48 hours, past a daily job's next attempt. */
  failureTtlMs?: number;
};

export type BackgroundJob = {
  readonly name: string;
  /** The scheduler is running: watch the job from now on. Jobs that are switched off are never started. */
  start(): void;
  stop(): void;
  /** The job woke up, whether or not it found anything to do. */
  heartbeat(): void;
  succeeded(subject?: string): void;
  failed(error: unknown, subject?: string): void;
};

export type BackgroundJobStatus = "ok" | "failing" | "stalled";

export type BackgroundJobSnapshot = {
  name: string;
  status: BackgroundJobStatus;
  runs: number;
  failures: number;
  staleAfterMs: number;
  lastActivityAt: number;
  lastRunAt?: number;
  lastSuccessAt?: number;
  lastFailureAt?: number;
  failing: Array<{ subject: string; code: string; at: number }>;
};

const DEFAULT_FAILURE_TTL_MS = 48 * 60 * 60_000;
const NO_SUBJECT = "";

type JobState = {
  name: string;
  options: BackgroundJobOptions;
  active: boolean;
  startedAt: number;
  lastHeartbeatAt?: number;
  lastRunAt?: number;
  lastSuccessAt?: number;
  lastFailureAt?: number;
  runs: number;
  failures: number;
  failing: Map<string, { code: string; at: number }>;
  /** A failure alert went out for the current failing spell, so its end is worth announcing. */
  alerted: boolean;
};

/** A short, credential-free description of a failure, matching what the job's own log line reports. */
export const jobFailureCode = (error: unknown): string => {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return scrubText(message.split("\n", 1)[0]?.trim().slice(0, 160) || "unknown");
};

export const createBackgroundJobRegistry = (input: {
  now?: () => number;
  alerts?: () => OpsAlerter;
} = {}) => {
  const now = input.now ?? Date.now;
  const alerts = input.alerts ?? opsAlerts;
  const log = logger.child({ component: "background-jobs" });
  const jobs = new Map<string, JobState>();

  const expire = (state: JobState, at: number): void => {
    const ttl = state.options.failureTtlMs ?? DEFAULT_FAILURE_TTL_MS;
    for (const [subject, failure] of state.failing) {
      if (at - failure.at > ttl) state.failing.delete(subject);
    }
    if (state.failing.size === 0) state.alerted = false;
  };

  const describeSubject = (subject: string) => (subject === NO_SUBJECT ? "" : ` (${subject})`);

  const define = (name: string, options: BackgroundJobOptions): BackgroundJob => {
    let state = jobs.get(name);
    if (state) state.options = options;
    else {
      state = { name, options, active: false, startedAt: now(), runs: 0, failures: 0, failing: new Map(), alerted: false };
      jobs.set(name, state);
    }
    const job = state;
    return {
      name,
      start() {
        if (job.active) return;
        job.active = true;
        job.startedAt = now();
      },
      stop() {
        job.active = false;
      },
      heartbeat() {
        job.lastHeartbeatAt = now();
      },
      succeeded(subject = NO_SUBJECT) {
        const at = now();
        job.runs += 1;
        job.lastRunAt = at;
        job.lastSuccessAt = at;
        const wasFailing = job.failing.delete(subject);
        if (!wasFailing || job.failing.size > 0) return;
        if (job.alerted) {
          alerts().notify({ key: `job-recovered:${name}`, text: `Background job ${name} recovered${describeSubject(subject)}.`, minIntervalMs: 0 });
        }
        job.alerted = false;
        log.info("recovered", { job: name, ...(subject ? { subject } : {}) });
      },
      failed(error, subject = NO_SUBJECT) {
        const at = now();
        const code = jobFailureCode(error);
        job.runs += 1;
        job.failures += 1;
        job.lastRunAt = at;
        job.lastFailureAt = at;
        expire(job, at);
        job.failing.set(subject, { code, at });
        const others = job.failing.size - 1;
        const result = alerts().notify({
          key: `job-failed:${name}`,
          text: `Background job ${name} failed${describeSubject(subject)}: ${code}.${others > 0 ? ` ${others} other failing.` : ""}`
            + ` Details are in the API log under component ${name}.`,
        });
        if (result === "queued") job.alerted = true;
      },
    };
  };

  const snapshot = (): BackgroundJobSnapshot[] => {
    const at = now();
    return [...jobs.values()].filter((job) => job.active).map((job) => {
      expire(job, at);
      const lastActivityAt = Math.max(job.startedAt, job.lastHeartbeatAt ?? 0, job.lastRunAt ?? 0);
      const stalled = at - lastActivityAt > job.options.staleAfterMs;
      return {
        name: job.name,
        status: stalled ? "stalled" : job.failing.size > 0 ? "failing" : "ok",
        runs: job.runs,
        failures: job.failures,
        staleAfterMs: job.options.staleAfterMs,
        lastActivityAt,
        ...(job.lastRunAt !== undefined ? { lastRunAt: job.lastRunAt } : {}),
        ...(job.lastSuccessAt !== undefined ? { lastSuccessAt: job.lastSuccessAt } : {}),
        ...(job.lastFailureAt !== undefined ? { lastFailureAt: job.lastFailureAt } : {}),
        failing: [...job.failing].map(([subject, failure]) => ({ subject, ...failure })),
      };
    });
  };

  const metricFamilies = (): MetricFamily[] => {
    const jobsNow = snapshot();
    const seconds = (ms: number | undefined) => (ms === undefined ? 0 : Math.round(ms / 1000));
    const family = (name: string, help: string, type: MetricFamily["type"], value: (job: BackgroundJobSnapshot) => number): MetricFamily => ({
      name, help, type, samples: jobsNow.map((job) => ({ labels: { job: job.name }, value: value(job) })),
    });
    return [
      family("energyx_job_runs_total", "Background job runs (per site for jobs that work site by site).", "counter", (job) => job.runs),
      family("energyx_job_failures_total", "Background job runs that failed.", "counter", (job) => job.failures),
      family("energyx_job_last_success_timestamp_seconds", "When the job last succeeded, in seconds since the Unix epoch; 0 if never.", "gauge", (job) => seconds(job.lastSuccessAt)),
      family("energyx_job_last_run_timestamp_seconds", "When the job last finished a run, in seconds since the Unix epoch; 0 if never.", "gauge", (job) => seconds(job.lastRunAt)),
      family("energyx_job_failing", "1 while the job's latest run (for any site) failed.", "gauge", (job) => (job.failing.length > 0 ? 1 : 0)),
      family("energyx_job_stalled", "1 when the job has not woken within its expected interval.", "gauge", (job) => (job.status === "stalled" ? 1 : 0)),
    ];
  };

  return { define, snapshot, metricFamilies };
};

export type BackgroundJobRegistry = ReturnType<typeof createBackgroundJobRegistry>;

/** The API process's jobs. */
export const backgroundJobs = createBackgroundJobRegistry();
metrics.collect(() => backgroundJobs.metricFamilies());

export const defineBackgroundJob = (name: string, options: BackgroundJobOptions): BackgroundJob =>
  backgroundJobs.define(name, options);
