import { defineBackgroundJob } from "../observability/background-jobs.js";
import { logger } from "../observability/logger.js";
import type { ConfigApiContext } from "../routes/types.js";
import { resolveEnergyTuyaProjectConnector } from "./energy-tuya-connector.js";
import { createEnergyTuyaDailyScheduler } from "./energy-tuya-scheduler.js";
import type { EnergyTuyaPostMaterialization } from "./energy-tuya-sync-runner.js";
import type { TuyaEnergySyncInput, TuyaReportLogArtifact } from "./tuya-openapi-client.js";

const HOUR_MS = 60 * 60_000;
const SINGAPORE_OFFSET_MS = 8 * HOUR_MS;
/** A newly connected site starts a week back: enough to show it working, small enough to fetch in a few passes. */
const FIRST_SYNC_LOOKBACK_MS = 7 * 24 * HOUR_MS;
/** The scheduler wakes hourly and on every sync pass (at most 20 minutes each); three quiet hours means it is stuck. */
const STALE_AFTER_MS = 3 * HOUR_MS;

const log = logger.child({ component: "live-sync" });

export type EnergyLiveConnectionScheduler = {
  start(): void;
  stop(): Promise<void>;
  /** Queue one Project now. Projects sync one at a time, so a site never waits on more than the queue ahead. */
  requestSync(projectId: string): "started" | "queued" | "already-running";
  isRunning(projectId: string): boolean;
  /** Queue every connection whose daily hour this is; the hourly timer calls it. Resolves when the queue drains. */
  runDue(): Promise<void>;
};

/**
 * Daily updates for Projects connected in the app. Each hour it queues the connections whose Singapore hour has come,
 * and works the queue one Project at a time through the same catch-up loop as the server-configured connector.
 */
export const createEnergyLiveConnectionScheduler = (input: {
  context: Required<ConfigApiContext>;
  syncTuyaEnergyReadings: (input: TuyaEnergySyncInput) => Promise<TuyaReportLogArtifact>;
  afterMaterialization: (projectId: string, workspaceId: string, actorUserId: string) => EnergyTuyaPostMaterialization;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}): EnergyLiveConnectionScheduler => {
  const now = input.now ?? Date.now;
  // Each connected site is a subject: one site's broken key keeps the job failing until that site syncs again.
  const job = defineBackgroundJob("live-sync", { staleAfterMs: STALE_AFTER_MS });
  const queue: string[] = [];
  let active: { projectId: string; stop: () => Promise<void> } | undefined;
  let draining: Promise<void> | undefined;
  let timer: NodeJS.Timeout | undefined;
  let stopped = true;

  const syncOne = async (projectId: string): Promise<void> => {
    const connection = input.context.metadataStore.energyIq.liveConnectors.find(projectId);
    if (!connection) return;
    const actorUserId = connection.updated_by;
    const scheduler = createEnergyTuyaDailyScheduler({
      enabled: true,
      localHour: connection.sync_local_hour,
      actorUserId,
      context: { ...input.context, workspaceId: connection.workspace_id, userId: actorUserId },
      resolveConnector: () => resolveEnergyTuyaProjectConnector({
        metadataStore: input.context.metadataStore,
        projectId,
        ...(input.env ? { env: input.env } : {}),
      }),
      syncTuyaEnergyReadings: input.syncTuyaEnergyReadings,
      afterMaterialization: input.afterMaterialization(projectId, connection.workspace_id, actorUserId),
      initialLookbackMs: FIRST_SYNC_LOOKBACK_MS,
      job,
      now,
    });
    active = { projectId, stop: () => scheduler.stop() };
    try {
      await scheduler.runIfDue();
    } finally {
      active = undefined;
    }
  };

  const drain = (): Promise<void> => {
    draining ??= (async () => {
      try {
        while (queue.length > 0) {
          const projectId = queue.shift()!;
          try {
            await syncOne(projectId);
          } catch (error) {
            log.error("failed", { project_id: projectId, code: error instanceof Error ? error.message : "unknown" });
            job.failed(error, projectId);
          }
        }
      } finally {
        draining = undefined;
      }
    })();
    return draining;
  };

  const requestSync: EnergyLiveConnectionScheduler["requestSync"] = (projectId) => {
    if (active?.projectId === projectId) return "already-running";
    if (queue.includes(projectId)) return "queued";
    queue.push(projectId);
    const started = !active && queue.length === 1;
    void drain();
    return started ? "started" : "queued";
  };

  const runDue = (): Promise<void> => {
    job.heartbeat();
    const hour = new Date(now() + SINGAPORE_OFFSET_MS).getUTCHours();
    for (const connection of input.context.metadataStore.energyIq.liveConnectors.listSyncEnabled()) {
      if (connection.sync_local_hour === hour) requestSync(connection.project_id);
    }
    return draining ?? Promise.resolve();
  };

  const scheduleNextHour = (): void => {
    if (stopped) return;
    const delay = Math.max(1_000, HOUR_MS - (now() % HOUR_MS) + 5_000);
    timer = setTimeout(() => {
      void runDue().finally(scheduleNextHour);
    }, delay);
    timer.unref();
  };

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      job.start();
      // Catch up after a restart: a connection that is current returns at once without fetching anything.
      for (const connection of input.context.metadataStore.energyIq.liveConnectors.listSyncEnabled()) {
        requestSync(connection.project_id);
      }
      scheduleNextHour();
    },
    async stop() {
      if (!stopped) job.stop();
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      queue.length = 0;
      await active?.stop();
      if (draining) await draining;
    },
    requestSync,
    isRunning: (projectId) => active?.projectId === projectId || queue.includes(projectId),
    runDue,
  };
};

let registered: EnergyLiveConnectionScheduler | undefined;

/** The running server's scheduler, so the admin "Fetch now" joins the same one-at-a-time queue. */
export const registerEnergyLiveConnectionScheduler = (scheduler: EnergyLiveConnectionScheduler | undefined): void => {
  registered = scheduler;
};

export const registeredEnergyLiveConnectionScheduler = (): EnergyLiveConnectionScheduler | undefined => registered;
