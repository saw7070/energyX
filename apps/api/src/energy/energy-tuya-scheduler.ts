import { defineBackgroundJob, type BackgroundJob } from "../observability/background-jobs.js";
import { logger } from "../observability/logger.js";
import type { ConfigApiContext } from "../routes/types.js";
import {
  createEnergyTuyaSyncRunner,
  resolveScheduledTuyaSyncWindow,
  sourceSyncErrorCode,
  sourceSyncErrorDetail,
  type EnergyTuyaPostMaterialization,
} from "./energy-tuya-sync-runner.js";
import type { TuyaEnergySyncInput, TuyaReportLogArtifact } from "./tuya-openapi-client.js";
import type { EnergyTuyaProjectConnector } from "./energy-tuya-connector.js";

const DAY_MS = 86_400_000;
const SINGAPORE_OFFSET_MS = 8 * 60 * 60_000;
/**
 * Longest span one catch-up run fetches. A sync holds its window in memory: on the hima node-b container, whose
 * cgroup allows 1.4 GiB, the ~26 hour window of a healthy nightly run has always fitted, while 98 hour and 48 hour
 * backlog windows were both OOM-killed about forty seconds in. Twenty-eight hours keeps a pass at the size with a
 * track record.
 */
const DEFAULT_MAX_WINDOW_MS = 28 * 60 * 60_000;
/**
 * A catch-up pass re-reads only the hours around the previous pass's end, not a whole day. The daily overlap would
 * drag each window's start back 24 hours, which would force any window that still moves forward to be at least two
 * days wide — the size that does not fit.
 */
const DEFAULT_CATCH_UP_OVERLAP_MS = 4 * 60 * 60_000;
/** How many capped runs one wake-up may chain to close a backlog. 40 × 1 new day covers a month-long gap. */
const DEFAULT_MAX_CATCH_UP_RUNS = 40;
/** A run that outlives this is abandoned, so it fails cleanly instead of holding the source lock open. */
const DEFAULT_RUN_DEADLINE_MS = 20 * 60_000;
/** The sync wakes once a day and on every catch-up pass; a day and two hours without either means its timer died. */
const STALE_AFTER_MS = 26 * 60 * 60_000;

const log = logger.child({ component: "tuya-sync" });

export type EnergyTuyaScheduler = {
  start(): void;
  stop(): Promise<void>;
  runIfDue(): Promise<"disabled" | "current" | "succeeded" | "failed">;
};

export const resolveNextSingaporeLocalHour = (nowMs: number, localHour: number): number => {
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0 || !Number.isInteger(localHour)
    || localHour < 0 || localHour > 23) {
    throw new Error("ENERGYIQ_TUYA_SYNC_SCHEDULE_INVALID");
  }
  const localNow = nowMs + SINGAPORE_OFFSET_MS;
  const localDayStart = Math.floor(localNow / DAY_MS) * DAY_MS;
  let nextLocal = localDayStart + localHour * 60 * 60_000;
  if (nextLocal <= localNow) nextLocal += DAY_MS;
  return nextLocal - SINGAPORE_OFFSET_MS;
};

export const createEnergyTuyaDailyScheduler = (input: {
  enabled: boolean;
  localHour: number;
  actorUserId: string;
  context: Required<ConfigApiContext>;
  resolveConnector?: () => EnergyTuyaProjectConnector | undefined;
  syncTuyaEnergyReadings: (input: TuyaEnergySyncInput) => Promise<TuyaReportLogArtifact>;
  afterMaterialization?: EnergyTuyaPostMaterialization;
  afterPublication?: () => Promise<void>;
  now?: () => number;
  maxWindowMs?: number;
  catchUpOverlapMs?: number;
  maxCatchUpRuns?: number;
  runDeadlineMs?: number;
  /** How far back a Project that has never synced starts; the start of the Singapore month otherwise. */
  initialLookbackMs?: number;
  /** Step aside while something else owns the Project's sync, e.g. an administrator took it over in the app. */
  skip?: () => boolean;
  /** Where runs are reported for /ready, /metrics and operator alerts. Default: the server-configured `tuya-sync`. */
  job?: BackgroundJob;
}): EnergyTuyaScheduler => {
  const now = input.now ?? Date.now;
  const job = input.job ?? defineBackgroundJob("tuya-sync", { staleAfterMs: STALE_AFTER_MS });
  let timer: NodeJS.Timeout | undefined;
  let stopped = true;
  /** Set by stop(): a run it aborts is a shutdown (a deploy restart), not a failure worth an alert. */
  let stopping = false;
  let inFlight: Promise<"disabled" | "current" | "succeeded" | "failed"> | undefined;
  let inFlightController: AbortController | undefined;

  const runIfDue = async (): Promise<"disabled" | "current" | "succeeded" | "failed"> => {
    if (!input.enabled) return "disabled";
    if (inFlight) return inFlight;
    job.heartbeat();
    if (input.skip?.()) return "disabled";
    const controller = new AbortController();
    inFlightController = controller;
    const maxWindowMs = input.maxWindowMs ?? DEFAULT_MAX_WINDOW_MS;
    const catchUpOverlapMs = input.catchUpOverlapMs ?? DEFAULT_CATCH_UP_OVERLAP_MS;
    const maxCatchUpRuns = input.maxCatchUpRuns ?? DEFAULT_MAX_CATCH_UP_RUNS;
    const runDeadlineMs = input.runDeadlineMs ?? DEFAULT_RUN_DEADLINE_MS;
    const action = (async () => {
      let projectId = "unresolved";
      let completed = 0;
      let afterPublicationError: unknown;
      try {
        const connector = input.resolveConnector?.();
        if (!connector) throw new Error("ENERGYIQ_TUYA_CONNECTOR_NOT_CONFIGURED");
        projectId = connector.projectId;
        // One capped run per pass, repeated until the watermark reaches the latest complete day. Each pass commits
        // its own Snapshot, so an interrupted catch-up keeps everything the earlier passes already fetched.
        while (completed < maxCatchUpRuns && !controller.signal.aborted) {
          const state = input.context.metadataStore.energyIq.sourceSync.findState({
            project_id: connector.projectId,
            source_kind: "tuya",
          });
          const watermark = state?.watermark_ms === undefined
            ? input.initialLookbackMs === undefined ? {} : { initialLookbackMs: input.initialLookbackMs }
            : { watermarkMs: state.watermark_ms };
          // A night that is up to date keeps the daily overlap: the same window shape that has always worked.
          // Only a backlog switches to the narrower catch-up pass, which is what has to fit in memory.
          const nightly = resolveScheduledTuyaSyncWindow({ nowMs: now(), ...watermark });
          const window = nightly && nightly.endTime - nightly.startTime > maxWindowMs
            ? resolveScheduledTuyaSyncWindow({
              nowMs: now(),
              maxWindowMs,
              overlapMs: catchUpOverlapMs,
              ...watermark,
            })
            : nightly;
          if (!window) {
            if (afterPublicationError === undefined) job.succeeded(connector.projectId);
            else job.failed(afterPublicationError, connector.projectId);
            return completed === 0 ? "current" as const : "succeeded" as const;
          }
          job.heartbeat();
          const deadline = setTimeout(() => controller.abort(), runDeadlineMs);
          if (typeof deadline.unref === "function") deadline.unref();
          let result;
          try {
            result = await createEnergyTuyaSyncRunner({
              context: input.context,
              syncTuyaEnergyReadings: input.syncTuyaEnergyReadings,
              ...(input.afterMaterialization
                ? { afterMaterialization: input.afterMaterialization }
                : {}),
              now,
            }).run({
              connector,
              actorUserId: input.actorUserId,
              trigger: "scheduled",
              window,
              signal: controller.signal,
            });
          } finally {
            clearTimeout(deadline);
          }
          completed += 1;
          if (!result.duplicate && input.afterPublication) {
            try {
              await input.afterPublication();
            } catch (error) {
              // The runner has already committed the Snapshot and sync watermark.
              // Report this separately so operators do not retry a successful fetch.
              afterPublicationError = new Error(`ENERGYIQ_TUYA_AFTER_PUBLICATION_FAILED:${sourceSyncErrorCode(error)}`);
              log.error("after-publication-failed", { project_id: connector.projectId, run_id: result.run.id, code: sourceSyncErrorCode(error) });
            }
          }
          log.info("succeeded", { project_id: connector.projectId, run_id: result.run.id, pass: completed });
        }
        if (afterPublicationError === undefined) job.succeeded(connector.projectId);
        else job.failed(afterPublicationError, connector.projectId);
        return "succeeded" as const;
      } catch (error) {
        log.error("failed", {
          project_id: projectId,
          passes: completed,
          code: sourceSyncErrorCode(error),
          detail: sourceSyncErrorDetail(error),
        });
        if (!stopping) job.failed(new Error(sourceSyncErrorCode(error)), projectId);
        return completed > 0 ? "succeeded" as const : "failed" as const;
      }
    })();
    inFlight = action;
    try {
      return await action;
    } finally {
      if (inFlight === action) inFlight = undefined;
      if (inFlightController === controller) inFlightController = undefined;
    }
  };

  const scheduleNext = (): void => {
    if (stopped || !input.enabled) return;
    const delay = Math.max(1_000, resolveNextSingaporeLocalHour(now(), input.localHour) - now());
    timer = setTimeout(() => {
      void runIfDue().finally(scheduleNext);
    }, delay);
    timer.unref();
  };

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      stopping = false;
      if (!input.enabled) return;
      job.start();
      void runIfDue();
      scheduleNext();
    },
    async stop() {
      if (!stopped && input.enabled) job.stop();
      stopped = true;
      stopping = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      inFlightController?.abort();
      if (inFlight) await inFlight;
    },
    runIfDue,
  };
};
