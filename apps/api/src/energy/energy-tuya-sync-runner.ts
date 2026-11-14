import { createHash, randomUUID } from "node:crypto";
import type {
  EnergyIqDataSnapshotRecord,
  EnergyIqImportBatchRecord,
  EnergyIqSourceSyncRunRecord,
  EnergyIqSourceSyncTrigger,
} from "@datafoundry/metadata";
import { resolveEnergyIqSnapshotFactScope } from "@datafoundry/metadata";

import type { ConfigApiContext } from "../routes/types.js";
import { inspectEnergyTuyaArtifact } from "./energy-tuya-import.js";
import {
  publishEnergyProjectManifestAtomically,
  type EnergyProjectManifestMaterialization,
} from "./energy-project-materialization.js";
import type { ProjectOverviewPointerPublication } from "./project-analysis-result-cache.js";
import { resolveProjectOverviewProfile } from "./project-analysis-resolver.js";
import {
  type TuyaEnergySyncInput,
  type TuyaReportLogArtifact,
} from "./tuya-openapi-client.js";
import type { EnergyTuyaProjectConnector } from "./energy-tuya-connector.js";

const DAY_MS = 86_400_000;
const SINGAPORE_OFFSET_MS = 8 * 60 * 60_000;
const DEFAULT_OVERLAP_MS = DAY_MS;
const DEFAULT_STALE_RUN_MS = 6 * 60 * 60_000;
const MAX_SCHEDULED_INTERRUPTIONS = 2;

export type EnergyTuyaSyncWindow = {
  startTime: number;
  endTime: number;
};

/**
 * The server's resident memory (MB) at the end of each step of one sync pass, the most it reached during each step,
 * and the most during the whole pass, so the nightly log shows which step is heavy: a step can end low after a burst.
 * The steps are fetching from Tuya, writing the facts, and the Overview projection (only for a site that has one).
 * Absent when the pass was an exact repeat and did no work.
 */
export type EnergyTuyaSyncPassMemory = {
  peakRssMb: number;
  fetchedRssMb: number;
  fetchPeakRssMb: number;
  factsRssMb?: number;
  factsPeakRssMb?: number;
  overviewRssMb?: number;
  overviewPeakRssMb?: number;
};

export type EnergyTuyaSyncResult = {
  run: EnergyIqSourceSyncRunRecord;
  batch: EnergyIqImportBatchRecord;
  snapshot: EnergyIqDataSnapshotRecord;
  activeSourceSha256: string[];
  duplicate: boolean;
  materializationDuplicate: boolean;
  memory?: EnergyTuyaSyncPassMemory;
};

/**
 * One sync pass at a time across the whole server. The server-configured site and the sites connected in the app have
 * their own schedulers, and both start at the same hour: two full rebuilds and Overview projections at once took the
 * API past its container memory limit and got it killed mid-sync. Every pass, scheduled or manual, waits here for the
 * one before it, first come first served; a pass that fails still lets the next one go. With a `signal`, a pass whose
 * deadline passed while it waited does not start, and one abandoned at its deadline lets the next go even if it never
 * settles, so one stuck request cannot hold every other site's sync behind it.
 */
let syncPassQueue: Promise<void> = Promise.resolve();
export const runOneSyncPassAtATime = <T>(pass: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
  const turn = syncPassQueue;
  const result = turn.then(async (): Promise<T> => {
    if (signal?.aborted) throw new Error("ENERGYIQ_TUYA_REQUEST_ABORTED");
    return await pass();
  });
  const settledOrAbandoned: Promise<unknown> = signal ? Promise.race([result, abortedOnce(signal)]) : result;
  syncPassQueue = turn.then(() => settledOrAbandoned).then(() => undefined, () => undefined);
  return result;
};

const abortedOnce = (signal: AbortSignal): Promise<void> => new Promise((resolve) => {
  if (signal.aborted) resolve();
  else signal.addEventListener("abort", () => resolve(), { once: true });
});

const rssMb = (): number => Math.round(process.memoryUsage.rss() / 1_048_576);

/**
 * Samples resident memory while a pass runs. `mark` ends a step: memory now, and the most it reached since the step
 * began (the previous mark); the next step starts there. `stop` gives the most for the whole pass.
 */
const trackPassMemory = () => {
  let peak = rssMb();
  let stepPeak = peak;
  const sample = (): number => {
    const now = rssMb();
    peak = Math.max(peak, now);
    stepPeak = Math.max(stepPeak, now);
    return now;
  };
  const sampler = setInterval(sample, 250);
  if (typeof sampler.unref === "function") sampler.unref();
  const mark = (): { rssMb: number; peakRssMb: number } => {
    const now = sample();
    const step = { rssMb: now, peakRssMb: stepPeak };
    stepPeak = now;
    return step;
  };
  return { mark, stop: (): number => { clearInterval(sampler); sample(); return peak; } };
};

export type EnergyTuyaPostMaterialization = (
  materialized: EnergyProjectManifestMaterialization,
  beforePublish: (publication: ProjectOverviewPointerPublication) => Promise<void>,
) => Promise<{ projectionRef: string } | undefined>;

type EnergyTuyaSyncRunnerDependencies = {
  context: Required<ConfigApiContext>;
  syncTuyaEnergyReadings: (input: TuyaEnergySyncInput) => Promise<TuyaReportLogArtifact>;
  afterMaterialization?: EnergyTuyaPostMaterialization;
  now?: () => number;
  id?: () => string;
};

export const resolveLatestCompleteSingaporeDayEnd = (nowMs: number): number => {
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0) throw new Error("ENERGYIQ_SOURCE_SYNC_NOW_INVALID");
  return Math.floor((nowMs + SINGAPORE_OFFSET_MS) / DAY_MS) * DAY_MS - SINGAPORE_OFFSET_MS;
};

/** How long Tuya keeps device report logs. ENERGYX_TUYA_LOG_RETENTION_DAYS overrides it for accounts that keep more. */
export const tuyaLogRetentionMs = (env: Record<string, string | undefined> = process.env): number => {
  const days = Number(env.ENERGYX_TUYA_LOG_RETENTION_DAYS ?? "7");
  return (Number.isFinite(days) && days >= 1 && days <= 365 ? days : 7) * DAY_MS;
};

/**
 * The oldest start worth asking Tuya for now: the start of the Singapore day a retention period back, the same reach
 * a site's first sync has always used.
 */
export const oldestRetainedTuyaReadingMs = (nowMs: number, env?: Record<string, string | undefined>): number =>
  resolveLatestCompleteSingaporeDayEnd(nowMs) - tuyaLogRetentionMs(env);

export const resolveScheduledTuyaSyncWindow = (input: {
  nowMs: number;
  watermarkMs?: number;
  initialLookbackMs?: number;
  overlapMs?: number;
  /**
   * Longest span a single run may fetch. A window grows by a day for every night the watermark does not move, so an
   * uncapped backlog produces runs that take longer than the maintenance window that interrupts them, which leaves
   * the watermark where it was and makes the next window wider again. Capping keeps each run short; the caller
   * repeats until the backlog is closed.
   */
  maxWindowMs?: number;
  /**
   * The oldest moment the provider still holds readings for. Tuya keeps report logs for about 7 days, and asking for
   * an older start fails or returns nothing, so after an outage longer than that a catch-up that restarted from the
   * watermark would keep asking for deleted days and never reach the readings that still exist. The window starts no
   * earlier than this; the days before it are gone either way.
   */
  earliestStartMs?: number;
}): EnergyTuyaSyncWindow | undefined => {
  const completeDayEnd = resolveLatestCompleteSingaporeDayEnd(input.nowMs);
  // Fetch post-midnight cumulative readings to close the previous day's buckets.
  // This is an acquisition watermark, not the report's complete-day cutoff.
  const endTime = completeDayEnd + 2 * 60 * 60_000;
  if (input.nowMs < endTime) return undefined;
  if (input.watermarkMs !== undefined && input.watermarkMs >= endTime) return undefined;
  const requestedStartTime = input.watermarkMs === undefined
    ? input.initialLookbackMs === undefined
      ? resolveSingaporeCalendarMonthStart(completeDayEnd)
      : completeDayEnd - input.initialLookbackMs
    : resolveLatestCompleteSingaporeDayEnd(input.watermarkMs) - (input.overlapMs ?? DEFAULT_OVERLAP_MS);
  const startTime = input.earliestStartMs !== undefined && requestedStartTime < input.earliestStartMs
    ? input.earliestStartMs
    : requestedStartTime;
  if (!Number.isSafeInteger(startTime) || startTime <= 0 || endTime <= startTime) {
    throw new Error("ENERGYIQ_SOURCE_SYNC_WINDOW_INVALID");
  }
  if (input.maxWindowMs !== undefined) {
    if (!Number.isSafeInteger(input.maxWindowMs) || input.maxWindowMs <= 0) {
      throw new Error("ENERGYIQ_SOURCE_SYNC_WINDOW_INVALID");
    }
    // Each pass re-reads the previous complete day to close its buckets, so a cap at or below that overlap would
    // hand back the same window for ever. Keep at least one whole new day in every capped pass.
    const overlapMs = input.watermarkMs === undefined || startTime !== requestedStartTime ? 0 : input.overlapMs ?? DEFAULT_OVERLAP_MS;
    const cappedWindowMs = Math.max(input.maxWindowMs, overlapMs + DAY_MS);
    if (endTime - startTime > cappedWindowMs) return { startTime, endTime: startTime + cappedWindowMs };
  }
  return { startTime, endTime };
};

const resolveSingaporeCalendarMonthStart = (completeDayEndMs: number): number => {
  const localLastCompleteDay = new Date(completeDayEndMs - 1 + SINGAPORE_OFFSET_MS);
  return Date.UTC(
    localLastCompleteDay.getUTCFullYear(),
    localLastCompleteDay.getUTCMonth(),
    1,
  ) - SINGAPORE_OFFSET_MS;
};

type EnergyTuyaSyncRunInput = {
  connector: EnergyTuyaProjectConnector;
  actorUserId: string;
  trigger: EnergyIqSourceSyncTrigger;
  window: EnergyTuyaSyncWindow;
  signal?: AbortSignal;
};

export const createEnergyTuyaSyncRunner = (dependencies: EnergyTuyaSyncRunnerDependencies) => ({
  run: (input: EnergyTuyaSyncRunInput): Promise<EnergyTuyaSyncResult> =>
    runOneSyncPassAtATime(() => runSyncPass(dependencies, input), input.signal),
});

const runSyncPass = async (
  dependencies: EnergyTuyaSyncRunnerDependencies,
  input: EnergyTuyaSyncRunInput,
): Promise<EnergyTuyaSyncResult> => {
    const now = dependencies.now ?? Date.now;
    const createId = dependencies.id ?? randomUUID;
    const project = dependencies.context.metadataStore.energyIq.getProject(input.connector.projectId);
    if (project.workspace_id !== input.connector.workspaceId) {
      throw new Error("ENERGYIQ_TUYA_WORKSPACE_MISMATCH");
    }
    if (project.hierarchy_revision_id !== input.connector.hierarchyRevisionId) {
      throw new Error("ENERGYIQ_TUYA_CONNECTOR_REVISION_MISMATCH");
    }
    const startedAtMs = now();
    // A scheduled run retries once after the process died mid-sync (start-up fails the cut-off run). If the retry dies
    // too, stop there rather than crash-looping the server all night; a manual "Sync now" or tomorrow's run still goes.
    if (input.trigger === "scheduled" && dependencies.context.metadataStore.energyIq.sourceSync.countInterruptedSince({
      project_id: input.connector.projectId,
      source_kind: "tuya",
      since: new Date(startedAtMs - DEFAULT_STALE_RUN_MS).toISOString(),
    }) >= MAX_SCHEDULED_INTERRUPTIONS) {
      throw new Error("ENERGYIQ_SOURCE_SYNC_RECENTLY_INTERRUPTED");
    }
    const claim = dependencies.context.metadataStore.energyIq.sourceSync.claim({
      id: `energy-source-sync-${createId()}`,
      workspace_id: project.workspace_id,
      project_id: input.connector.projectId,
      source_kind: "tuya",
      connector_fingerprint: input.connector.connectorFingerprint,
      trigger: input.trigger,
      window_start_ms: input.window.startTime,
      window_end_ms: input.window.endTime,
      actor_user_id: input.actorUserId,
      started_at: new Date(startedAtMs).toISOString(),
      stale_before: new Date(startedAtMs - DEFAULT_STALE_RUN_MS).toISOString(),
    });
    if (claim.reused) return readCompletedResult(dependencies.context, claim.run);

    const memory = trackPassMemory();
    let facts: { rssMb: number; peakRssMb: number } | undefined;
    let overview: { rssMb: number; peakRssMb: number } | undefined;
    try {
      const artifact = await dependencies.syncTuyaEnergyReadings({
        startTime: input.window.startTime,
        endTime: input.window.endTime,
        devices: [...input.connector.devices],
        ...(input.connector.credentials ? { credentials: input.connector.credentials } : {}),
        ...(input.signal ? { signal: input.signal } : {}),
      });
      const fetched = memory.mark();
      assertArtifactWindow(artifact, input.window);
      const batch = persistTuyaImportArtifact({
        context: dependencies.context,
        actorUserId: input.actorUserId,
        projectId: project.id,
        workspaceId: project.workspace_id,
        artifact,
        createId,
      });
      const materialization = {
        context: dependencies.context,
        userId: input.actorUserId,
        projectId: project.id,
        requestedBatchId: batch.id,
        appendSourceSha256: batch.source_sha256,
        publishedSetupPin: {
          hierarchyRevisionId: input.connector.hierarchyRevisionId,
          hierarchySequence: input.connector.hierarchySequence,
          document: input.connector.publishedDocument,
        },
      } as const;
      const materialized = await publishEnergyProjectManifestAtomically({
        materialization,
        // A site connected in the app without an Overview profile publishes readings only, as an uploaded file does.
        ...(input.connector.managedBy === "app"
          && !resolveProjectOverviewProfile(dependencies.context.metadataStore, project.id)
          ? { readingsOnly: true }
          : {}),
        publishProjection: async (candidate, beforePublish) => {
          facts = memory.mark();
          const publication = await dependencies.afterMaterialization?.(candidate, beforePublish);
          overview = memory.mark();
          if (!publication?.projectionRef?.trim()) {
            throw new Error("ENERGYIQ_OVERVIEW_PROJECTION_NOT_READY");
          }
          return publication;
        },
      });
      // A readings-only site has no Overview step: its facts are written once the publication returns.
      facts ??= memory.mark();
      const activeSourceSha256 = resolveEnergyIqSnapshotFactScope(materialized.snapshot).sourceSha256;
      const run = dependencies.context.metadataStore.energyIq.sourceSync.completeSuccess({
        run_id: claim.run.id,
        import_batch_id: materialized.batch.id,
        data_snapshot_id: materialized.snapshot.id,
        active_source_sha256: activeSourceSha256,
        completed_at: new Date(now()).toISOString(),
      });
      return {
        run,
        batch: materialized.batch,
        snapshot: materialized.snapshot,
        activeSourceSha256,
        duplicate: false,
        materializationDuplicate: materialized.duplicate,
        memory: {
          peakRssMb: memory.stop(),
          fetchedRssMb: fetched.rssMb,
          fetchPeakRssMb: fetched.peakRssMb,
          factsRssMb: facts.rssMb,
          factsPeakRssMb: facts.peakRssMb,
          ...(overview ? { overviewRssMb: overview.rssMb, overviewPeakRssMb: overview.peakRssMb } : {}),
        },
      };
    } catch (error) {
      dependencies.context.metadataStore.energyIq.sourceSync.completeFailure({
        run_id: claim.run.id,
        error_code: sourceSyncErrorCode(error),
        completed_at: new Date(now()).toISOString(),
      });
      throw error;
    } finally {
      memory.stop();
    }
};

export const persistTuyaImportArtifact = (input: {
  context: Required<ConfigApiContext>;
  actorUserId: string;
  projectId: string;
  workspaceId: string;
  artifact: TuyaReportLogArtifact;
  createId?: () => string;
}): EnergyIqImportBatchRecord => {
  const content = Buffer.from(`${JSON.stringify(input.artifact)}\n`, "utf8");
  const sourceSha256 = createHash("sha256").update(content).digest("hex");
  const existing = input.context.metadataStore.energyIq.findImportBatchBySha({
    project_id: input.projectId,
    source_sha256: sourceSha256,
  });
  if (existing) return existing;
  const inspection = inspectEnergyTuyaArtifact(content);
  const filename = `tuya-report-logs-${input.artifact.request.startTime}-${input.artifact.request.endTime}.json`;
  const fileRef = input.context.fileAssetService.createRef({
    user_id: input.actorUserId,
    workspace_id: input.workspaceId,
    filename,
    content,
    declared_mime_type: "application/json",
    source: "artifact",
    metadata: {
      purpose: "energyiq_import",
      projectId: input.projectId,
      provider: "tuya",
      region: input.artifact.region,
    },
  });
  return input.context.metadataStore.energyIq.createImportBatch({
    id: `energy-import-${(input.createId ?? randomUUID)()}`,
    workspace_id: input.workspaceId,
    project_id: input.projectId,
    source_kind: "tuya",
    source_sha256: sourceSha256,
    filename,
    file_asset_ref_id: fileRef.ref.id,
    status: "inspected",
    inspection,
    created_by: input.actorUserId,
  });
};

const readCompletedResult = (
  context: Required<ConfigApiContext>,
  run: EnergyIqSourceSyncRunRecord,
): EnergyTuyaSyncResult => {
  if (!run.import_batch_id || !run.data_snapshot_id) {
    throw new Error(`ENERGYIQ_SOURCE_SYNC_RUN_INVALID:${run.id}`);
  }
  const snapshot = context.metadataStore.energyIq.getDataSnapshot(run.data_snapshot_id);
  const activeSourceSha256 = resolveEnergyIqSnapshotFactScope(snapshot).sourceSha256;
  return {
    run,
    batch: context.metadataStore.energyIq.getImportBatch(run.import_batch_id),
    snapshot,
    activeSourceSha256,
    duplicate: true,
    materializationDuplicate: true,
  };
};

const assertArtifactWindow = (artifact: TuyaReportLogArtifact, window: EnergyTuyaSyncWindow): void => {
  if (artifact.request.startTime !== window.startTime || artifact.request.endTime !== window.endTime) {
    throw new Error("ENERGYIQ_TUYA_ARTIFACT_WINDOW_MISMATCH");
  }
};

export const sourceSyncErrorCode = (error: unknown): string => {
  const message = error instanceof Error ? error.message : "";
  const candidate = message.split(/\s/u, 1)[0]?.toLocaleUpperCase() ?? "";
  // A provider code can carry its own explanation ("…API_ERROR:1114:your_ip(1.2.3.4)_don't…"); keep the code and the
  // words up to the first character outside the code alphabet, so the stored code still says why without the rest.
  const code = /^(?:ENERGYIQ_|SOURCE_SYNC_)[A-Z0-9_:-]{1,150}/u.exec(candidate)?.[0].replace(/[:_-]+$/u, "");
  return code && code.length > "ENERGYIQ_".length ? code : "ENERGYIQ_SOURCE_SYNC_FAILED";
};

/**
 * The failure as an operator needs to read it in the server log: error type, message and underlying cause (a refused
 * connection, a timeout), printable and short. Credentials never appear in these messages; the request signature
 * travels in headers, not in errors.
 */
export const sourceSyncErrorDetail = (error: unknown): string => {
  const describe = (value: unknown): string => {
    if (!(value instanceof Error)) return typeof value === "string" ? value : "";
    const cause = (value as Error & { cause?: unknown }).cause;
    const causeCode = cause && typeof cause === "object" && "code" in cause ? String((cause as { code: unknown }).code) : "";
    const causeText = cause ? describe(cause) : "";
    return [`${value.name}: ${value.message}`, causeCode, causeText].filter(Boolean).join(" <- ");
  };
  return describe(error).replace(/[^\x20-\x7e]+/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 300) || "unknown";
};
