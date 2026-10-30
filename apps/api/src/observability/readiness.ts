import { rm, statfs, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { BackgroundJobSnapshot } from "./background-jobs.js";

/**
 * Whether the API can do its work right now, for GET /ready. Each dependency is checked with a short timeout:
 * the metadata database answers a query, the storage root takes a write, the disk has room, and the background jobs
 * are waking on time. A critical failure makes the API not ready (503); a non-critical one (a stalled or failing job)
 * makes it degraded, which still serves traffic (200) but tells the operator something needs a look.
 */
export type ReadinessCheckStatus = "ok" | "degraded" | "failed";
export type ReadinessStatus = "ready" | "degraded" | "not_ready";

export type ReadinessCheckOutcome = {
  status: ReadinessCheckStatus;
  /** A short machine-readable reason when not ok. */
  code?: string;
  /** Operator detail (sizes, job timings). Shown only to loopback or token-holding callers. */
  detail?: Record<string, unknown>;
};

export type ReadinessCheckResult = ReadinessCheckOutcome & { critical: boolean; duration_ms: number };

export type ReadinessReport = {
  status: ReadinessStatus;
  checked_at: string;
  checks: Record<string, ReadinessCheckResult>;
};

export type ReadinessCheck = {
  name: string;
  /** A failed critical check makes the API not ready; any other failure only degrades it. */
  critical: boolean;
  run(): Promise<ReadinessCheckOutcome> | ReadinessCheckOutcome;
};

const DEFAULT_CHECK_TIMEOUT_MS = 2_000;
/** /ready is public through nginx; reuse a report this fresh rather than touching the disk on every call. */
const DEFAULT_CACHE_MS = 2_000;

const errorCode = (error: unknown): string | undefined => {
  const code = (error as { code?: unknown } | undefined)?.code;
  return typeof code === "string" ? code : undefined;
};

const runWithTimeout = async (check: ReadinessCheck, timeoutMs: number): Promise<ReadinessCheckOutcome> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => check.run()),
      new Promise<ReadinessCheckOutcome>((resolve) => {
        timer = setTimeout(() => resolve({ status: "failed", code: "TIMEOUT", detail: { timeout_ms: timeoutMs } }), timeoutMs);
        timer.unref();
      }),
    ]);
  } catch (error) {
    const code = errorCode(error);
    return { status: "failed", code: "CHECK_FAILED", ...(code ? { detail: { error: code } } : {}) };
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export const createReadinessProbe = (input: {
  checks: ReadinessCheck[];
  timeoutMs?: number;
  cacheMs?: number;
  now?: () => number;
}) => {
  const timeoutMs = input.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS;
  const cacheMs = input.cacheMs ?? DEFAULT_CACHE_MS;
  const now = input.now ?? Date.now;
  let cached: { at: number; report: Promise<ReadinessReport> } | undefined;

  const evaluate = async (): Promise<ReadinessReport> => {
    const results = await Promise.all(input.checks.map(async (check) => {
      const startedAt = performance.now();
      const outcome = await runWithTimeout(check, timeoutMs);
      return [check.name, { ...outcome, critical: check.critical, duration_ms: Math.round(performance.now() - startedAt) }] as const;
    }));
    const checks = Object.fromEntries(results);
    const values = Object.values(checks);
    const status: ReadinessStatus = values.some((check) => check.critical && check.status === "failed")
      ? "not_ready"
      : values.some((check) => check.status !== "ok") ? "degraded" : "ready";
    return { status, checked_at: new Date(now()).toISOString(), checks };
  };

  return {
    check(): Promise<ReadinessReport> {
      const at = now();
      if (!cached || at - cached.at >= cacheMs) cached = { at, report: evaluate() };
      return cached.report;
    },
  };
};

export type ReadinessProbe = ReturnType<typeof createReadinessProbe>;

/** The metadata database answers a query that reads its schema page. */
export const metadataDatabaseCheck = (db: () => { prepare(sql: string): { get(): unknown } }): ReadinessCheck => ({
  name: "metadata_db",
  critical: true,
  run() {
    try {
      db().prepare("SELECT count(*) AS tables FROM sqlite_schema").get();
      return { status: "ok" };
    } catch (error) {
      const code = errorCode(error);
      return { status: "failed", code: "METADATA_DB_UNAVAILABLE", ...(code ? { detail: { error: code } } : {}) };
    }
  },
});

/**
 * The storage root takes a small write. The root is not created here: a missing root usually means a volume that did
 * not mount, which must fail rather than quietly fill the system disk. The probe file is per process, so probes never
 * litter the directory.
 */
export const storageWritableCheck = (root: string): ReadinessCheck => ({
  name: "storage_writable",
  critical: true,
  async run() {
    const probe = join(root, `.ready-probe-${process.pid}`);
    try {
      await writeFile(probe, new Date().toISOString());
      await rm(probe, { force: true });
      return { status: "ok" };
    } catch (error) {
      const code = errorCode(error);
      return { status: "failed", code: "STORAGE_NOT_WRITABLE", ...(code ? { detail: { error: code } } : {}) };
    }
  },
});

/** The disk holding the storage root has at least `minFreeMb` free for the API's user. */
export const freeDiskCheck = (root: string, minFreeMb: number, statDisk: typeof statfs = statfs): ReadinessCheck => ({
  name: "disk_space",
  critical: true,
  async run() {
    try {
      const stats = await statDisk(root);
      const freeMb = Math.floor((Number(stats.bavail) * Number(stats.bsize)) / (1024 * 1024));
      const detail = { free_mb: freeMb, min_free_mb: minFreeMb };
      return freeMb >= minFreeMb ? { status: "ok", detail } : { status: "failed", code: "DISK_SPACE_LOW", detail };
    } catch (error) {
      const code = errorCode(error);
      return { status: "failed", code: "DISK_CHECK_FAILED", ...(code ? { detail: { error: code } } : {}) };
    }
  },
});

/** Every running background job has woken within its expected interval and its latest runs succeeded. */
export const backgroundJobsCheck = (snapshot: () => BackgroundJobSnapshot[], now: () => number = Date.now): ReadinessCheck => ({
  name: "background_jobs",
  critical: false,
  run() {
    const jobs = snapshot();
    const iso = (ms: number | undefined) => (ms === undefined ? null : new Date(ms).toISOString());
    const detail = Object.fromEntries(jobs.map((job) => [job.name, {
      status: job.status,
      last_activity_at: iso(job.lastActivityAt),
      last_success_at: iso(job.lastSuccessAt),
      last_failure_at: iso(job.lastFailureAt),
      stale_after_s: Math.round(job.staleAfterMs / 1000),
      idle_s: Math.max(0, Math.round((now() - job.lastActivityAt) / 1000)),
      ...(job.failing.length > 0 ? { failing: job.failing.slice(0, 10).map(({ subject, code }) => ({ subject, code })) } : {}),
    }]));
    if (jobs.some((job) => job.status === "stalled")) return { status: "degraded", code: "JOBS_STALLED", detail };
    if (jobs.some((job) => job.status === "failing")) return { status: "degraded", code: "JOBS_FAILING", detail };
    return { status: "ok", detail };
  },
});

export const minFreeDiskMbFromEnv = (env: Record<string, string | undefined> = process.env): number => {
  const parsed = Number(env.ENERGYX_MIN_FREE_DISK_MB);
  return env.ENERGYX_MIN_FREE_DISK_MB?.trim() && Number.isFinite(parsed) && parsed >= 0 ? parsed : 1024;
};
