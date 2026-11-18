import { readEnergyFactProjectOldestReading, resolveEnergyFactStorePath } from "@datafoundry/data-gateway";
import { resolveEnergyIqSnapshotFactScope, type EnergyIqProjectRecord, type EnergyIqProjectSetupDocument } from "@datafoundry/metadata";

import { defineBackgroundJob } from "../observability/background-jobs.js";
import { logger } from "../observability/logger.js";
import type { ConfigApiContext } from "../routes/types.js";
import { publishEnergyProjectManifestAtomically } from "./energy-project-materialization.js";
import { readingRetentionCutoff } from "./energy-reading-retention-cutoff.js";
import { resolveNextSingaporeLocalHour } from "./energy-tuya-scheduler.js";
import type { EnergyTuyaPostMaterialization } from "./energy-tuya-sync-runner.js";
import { resolveProjectOverviewProfile } from "./project-analysis-resolver.js";

export { readingRetentionCutoff, resolveReadingRetainFrom } from "./energy-reading-retention-cutoff.js";

/** After the 02:00 daily update, the 02:15 backup and the 03:30 offsite copy, in Singapore time. */
const RUN_LOCAL_HOUR = 4;
const RUN_LOCAL_MINUTE = 30;
/** Once shortly after start, so a limit set before a restart does not wait a day. */
const STARTUP_DELAY_MS = 5 * 60_000;
const MINUTE_MS = 60_000;

const log = logger.child({ component: "reading-retention" });

export type EnergyReadingRetentionRun = {
  trimmed: string[];
  current: string[];
  failed: Array<{ projectId: string; code: string }>;
};

export type EnergyReadingRetentionJob = {
  start(): void;
  stop(): Promise<void>;
  /** Trims every site of every client that keeps readings for a limited time. */
  runOnce(): Promise<EnergyReadingRetentionRun>;
};

/**
 * The nightly clean-up for clients that keep meter readings for a limited time (Team → Keep meter readings for).
 * Clients without a limit are never touched. A site with readings older than its client's limit is republished from
 * its current files and published setup; the publication itself removes the old readings in one transaction, so the
 * dashboards, the data guard and the published Snapshot stay consistent. Live sites are also trimmed by their own
 * daily update, so this mainly reaches sites whose data comes from uploaded files.
 */
export const createEnergyReadingRetentionJob = (input: {
  context: Required<ConfigApiContext>;
  /** Publishes as this person when whoever set the limit can no longer be used. */
  fallbackActorUserId: string;
  afterMaterialization: (projectId: string, workspaceId: string, actorUserId: string) => EnergyTuyaPostMaterialization;
  now?: () => number;
}): EnergyReadingRetentionJob => {
  const now = input.now ?? Date.now;
  const metadataStore = input.context.metadataStore;
  const job = defineBackgroundJob("reading-retention", { staleAfterMs: 26 * 60 * MINUTE_MS });
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<EnergyReadingRetentionRun> | undefined;
  let stopped = true;

  const isActiveWorkspace = (workspaceId: string): boolean => {
    try {
      return !metadataStore.workspaces.get({ id: workspaceId }).disabled_at;
    } catch {
      return false;
    }
  };

  const actorFor = (userId: string): string => {
    try {
      const user = metadataStore.users.getById({ user_id: userId });
      return user.disabled_at ? input.fallbackActorUserId : user.id;
    } catch {
      return input.fallbackActorUserId;
    }
  };

  const republish = async (project: EnergyIqProjectRecord, actorUserId: string, nowMs: number): Promise<void> => {
    const snapshot = metadataStore.energyIq.findCurrentDataSnapshot(project.id);
    if (!snapshot) return;
    const scope = resolveEnergyIqSnapshotFactScope(snapshot);
    const sources = new Set(scope.sourceSha256.map((sha) => sha.toLocaleLowerCase()));
    const batches = metadataStore.energyIq.listImportBatches(project.id)
      .filter((batch) => sources.has(batch.source_sha256.toLocaleLowerCase()));
    const requested = batches.at(-1);
    if (!requested) throw new Error("ENERGYIQ_READING_RETENTION_SOURCES_UNAVAILABLE");
    const revision = metadataStore.energyIq.projectSetup.listHierarchyRevisions(project.id)
      .find((candidate) => candidate.id === project.hierarchy_revision_id);
    if (!revision) throw new Error("ENERGYIQ_READING_RETENTION_PUBLISHED_SETUP_REQUIRED");
    const context = { ...input.context, workspaceId: project.workspace_id, userId: actorUserId };
    await publishEnergyProjectManifestAtomically({
      materialization: {
        context,
        userId: actorUserId,
        projectId: project.id,
        requestedBatchId: requested.id,
        sourceManifestSha256: scope.sourceSha256,
        publishedSetupPin: {
          hierarchyRevisionId: revision.id,
          hierarchySequence: revision.sequence,
          document: JSON.parse(revision.snapshot_json) as EnergyIqProjectSetupDocument,
        },
        forceRepublish: true,
        nowMs,
      },
      ...(!resolveProjectOverviewProfile(metadataStore, project.id) ? { readingsOnly: true } : {}),
      publishProjection: async (candidate, beforePublish) => {
        const publication = await input.afterMaterialization(project.id, project.workspace_id, actorUserId)(candidate, beforePublish);
        if (!publication?.projectionRef?.trim()) throw new Error("ENERGYIQ_OVERVIEW_PROJECTION_NOT_READY");
        return publication;
      },
    });
  };

  const runOnce = (): Promise<EnergyReadingRetentionRun> => {
    if (running) return running;
    const current = (async () => {
      const result: EnergyReadingRetentionRun = { trimmed: [], current: [], failed: [] };
      job.heartbeat();
      const nowMs = now();
      for (const limit of metadataStore.energyIq.readingRetention.list()) {
        if (!isActiveWorkspace(limit.workspace_id)) continue;
        const actorUserId = actorFor(limit.updated_by);
        for (const project of metadataStore.energyIq.listProjectsByWorkspace(limit.workspace_id)) {
          if (!metadataStore.energyIq.findCurrentDataSnapshot(project.id)) continue;
          const cutoff = readingRetentionCutoff(limit.months, project.timezone, nowMs);
          try {
            const oldest = await readEnergyFactProjectOldestReading({
              databasePath: resolveEnergyFactStorePath(project.workspace_id),
              projectId: project.id,
            });
            if (!oldest || oldest >= cutoff) {
              result.current.push(project.id);
              job.succeeded(project.id);
              continue;
            }
            await republish(project, actorUserId, nowMs);
            result.trimmed.push(project.id);
            job.succeeded(project.id);
            log.info("trimmed", { project_id: project.id, workspace_id: project.workspace_id, months: limit.months, kept_from: cutoff });
          } catch (error) {
            const code = error instanceof Error ? error.message.slice(0, 200) : "unknown";
            result.failed.push({ projectId: project.id, code });
            job.failed(error, project.id);
            log.error("failed", { project_id: project.id, workspace_id: project.workspace_id, code });
          }
        }
      }
      return result;
    })();
    // Cleared once settled, never before: a run with nothing to do can finish before this line is reached.
    running = current;
    const clear = () => {
      if (running === current) running = undefined;
    };
    current.then(clear, clear);
    return current;
  };

  const nextRunDelay = (): number => {
    const at = now();
    const offset = RUN_LOCAL_MINUTE * MINUTE_MS;
    return Math.max(1_000, resolveNextSingaporeLocalHour(at - offset, RUN_LOCAL_HOUR) + offset - at);
  };

  const schedule = (delayMs: number): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      void runOnce().catch(() => undefined).finally(() => schedule(nextRunDelay()));
    }, delayMs);
    timer.unref();
  };

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      job.start();
      schedule(Math.min(STARTUP_DELAY_MS, nextRunDelay()));
    },
    async stop() {
      if (!stopped) job.stop();
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      if (running) await running.catch(() => undefined);
    },
    runOnce,
  };
};
