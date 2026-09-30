import {
  ENERGY_FACT_WRITER_CONTRACT_VERSION,
  probeEnergyFactProjectStateForMaterialization,
  resetEnergyFactProjectMaterialization,
  resolveEnergyFactStorePath,
  writeEnergyFactProjectMaterialization,
  type EnergyFactMaterializationBatchWrite,
} from "@datafoundry/data-gateway";
import {
  activeEnergyIqImportBatches,
  createEnergyIqSourceManifest,
  fingerprintEnergyIqMeterMapping,
  fingerprintEnergyIqMeterMappingExcludingDisplayNames,
  resolveEnergyIqMaterializationBlockingReasons,
  resolveEnergyIqSnapshotFactScope,
  type MetadataStore,
  type EnergyIqDataSnapshotRecord,
  type EnergyIqHierarchyRevisionRecord,
  type EnergyIqImportBatchRecord,
  type EnergyIqMeterMappingDraft,
  type EnergyIqProjectSetupDocument,
  type EnergyIqSnapshotFactScope,
} from "@datafoundry/metadata";

import type { ConfigApiContext } from "../routes/types.js";
import {
  buildEnergyExcelMaterialization,
  buildEnergyTuyaMaterialization,
  isEnergyImportMaterializationCurrent,
  type EnergyImportMaterializationSummary,
} from "./energy-import-materializer.js";
import {
  restoreProjectOverviewProjectionPointer,
  type ProjectOverviewPointerPublication,
} from "./project-analysis-result-cache.js";

const projectMaterializationTails = new Map<string, Promise<void>>();

export const withEnergyProjectMaterializationLock = async <T>(
  workspaceId: string,
  projectId: string,
  action: () => Promise<T>,
): Promise<T> => {
  const key = `${workspaceId}\u0000${projectId}`;
  const predecessor = projectMaterializationTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const current = predecessor.catch(() => undefined).then(() => released);
  projectMaterializationTails.set(key, current);
  await predecessor.catch(() => undefined);
  try {
    return await action();
  } finally {
    release();
    if (projectMaterializationTails.get(key) === current) {
      projectMaterializationTails.delete(key);
    }
  }
};

export const withEnergyProjectPublicationReadLock = async <T>(input: {
  metadataStore: MetadataStore;
  workspaceId: string;
  projectId: string;
}, action: () => Promise<T> | T): Promise<T> => withEnergyProjectMaterializationLock(
  input.workspaceId,
  input.projectId,
  async () => {
    if (input.metadataStore.energyIq.findProjectDataPublication(input.projectId)) {
      throw new Error("ENERGYIQ_PROJECT_DATA_PUBLICATION_RECOVERY_REQUIRED");
    }
    return action();
  },
);

export type EnergyProjectManifestMaterialization = {
  batch: EnergyIqImportBatchRecord;
  snapshot: EnergyIqDataSnapshotRecord;
  document: EnergyIqProjectSetupDocument;
  duplicate: boolean;
  timings?: EnergyProjectManifestMaterializationTimings;
};

export type EnergyProjectManifestMaterializationTimings = {
  parseNormalizeByBatch: Array<{ batchId: string; durationMs: number }>;
  sourceWriteByBatch: Array<{
    importBatchId: string;
    deleteExistingMs: number;
    historicalMappingMs: number;
    rawWriteMs: number;
    normalizedWriteMs: number;
    intervalWriteMs: number;
    qualityWriteMs: number;
    totalMs: number;
  }>;
  sourceWriteMs: number;
  canonicalRebuildMs: number;
  integrityAndCheckpointMs: number;
  totalMs: number;
};

export type EnergyProjectManifestMaterializationInput = {
  context: Required<ConfigApiContext>;
  userId: string;
  projectId: string;
  requestedBatchId: string;
  databasePath?: string;
  sourceManifestSha256?: readonly string[];
  appendSourceSha256?: string;
  expectedCurrentDataSnapshotId?: string;
  expectedProjectHierarchyRevisionId?: string;
  publishedSetupPin?: {
    hierarchyRevisionId: string;
    hierarchySequence: number;
    document: EnergyIqProjectSetupDocument;
  };
};

export const materializeEnergyProjectManifest = async (
  input: EnergyProjectManifestMaterializationInput,
): Promise<EnergyProjectManifestMaterialization> => {
  const initialProject = input.context.metadataStore.energyIq.getProject(input.projectId);
  return withEnergyProjectMaterializationLock(
    initialProject.workspace_id,
    input.projectId,
    async () => {
      await recoverInterruptedEnergyProjectPublicationWithinLock(input);
      return materializeEnergyProjectManifestWithinLock(input);
    },
  );
};

export const publishEnergyProjectManifestAtomically = async (input: {
  materialization: EnergyProjectManifestMaterializationInput;
  readingsOnly?: boolean;
  publishProjection: (
    materialized: EnergyProjectManifestMaterialization,
    beforePublish: (publication: ProjectOverviewPointerPublication) => Promise<void>,
  ) => Promise<{ projectionRef: string }>;
}): Promise<EnergyProjectManifestMaterialization> => {
  const initialProject = input.materialization.context.metadataStore.energyIq
    .getProject(input.materialization.projectId);
  return withEnergyProjectMaterializationLock(
    initialProject.workspace_id,
    input.materialization.projectId,
    async () => {
      await recoverInterruptedEnergyProjectPublicationWithinLock(input.materialization);
      const projectBefore = input.materialization.context.metadataStore.energyIq
        .getProject(input.materialization.projectId);
      const previousSnapshot = input.materialization.context.metadataStore.energyIq
        .findCurrentDataSnapshot(input.materialization.projectId);
      const previousPublishedSetupPin = previousSnapshot
        ? resolveSnapshotPublishedSetupPin(input.materialization.context, previousSnapshot)
        : undefined;
      input.materialization.context.metadataStore.energyIq.beginProjectDataPublication({
        project_id: input.materialization.projectId,
        expected_previous_snapshot_id: projectBefore.data_snapshot_id,
      });
      let materialized: EnergyProjectManifestMaterialization | undefined;
      try {
        materialized = await materializeEnergyProjectManifestWithinLock(input.materialization);
        input.materialization.context.metadataStore.energyIq.markProjectDataPublicationCandidate({
          project_id: input.materialization.projectId,
          expected_previous_snapshot_id: projectBefore.data_snapshot_id,
          candidate_snapshot_id: materialized.snapshot.id,
        });
        if (input.readingsOnly) {
          input.materialization.context.metadataStore.energyIq.completeProjectReadingsPublication({
            project_id: input.materialization.projectId,
            expected_previous_snapshot_id: projectBefore.data_snapshot_id,
            candidate_snapshot_id: materialized.snapshot.id,
          });
          return materialized;
        }
        const projection = await input.publishProjection(materialized, async (publication) => {
          input.materialization.context.metadataStore.energyIq.markProjectOverviewPublicationCandidate({
            project_id: input.materialization.projectId,
            expected_previous_snapshot_id: projectBefore.data_snapshot_id,
            candidate_snapshot_id: materialized!.snapshot.id,
            overview_persistent_directory: publication.persistentDirectory,
            overview_pointer_key: publication.pointerKey,
            previous_overview_projection_key: publication.previousProjectionKey,
            candidate_overview_projection_key: publication.candidateProjectionKey,
          });
        });
        if (!projection?.projectionRef?.trim()) {
          throw new Error("ENERGYIQ_OVERVIEW_PROJECTION_NOT_READY");
        }
        const journal = input.materialization.context.metadataStore.energyIq
          .findProjectDataPublication(input.materialization.projectId);
        if (!journal?.candidate_overview_projection_key) {
          if (materialized.duplicate
            && materialized.snapshot.id === projectBefore.data_snapshot_id) {
            input.materialization.context.metadataStore.energyIq.abortProjectDataPublication({
              project_id: input.materialization.projectId,
              expected_current_snapshot_id: projectBefore.data_snapshot_id,
              previous_snapshot_id: projectBefore.data_snapshot_id,
            });
            return materialized;
          }
          throw new Error("ENERGYIQ_OVERVIEW_PROJECTION_PUBLICATION_RECEIPT_REQUIRED");
        }
        input.materialization.context.metadataStore.energyIq.completeProjectDataPublication({
          project_id: input.materialization.projectId,
          expected_previous_snapshot_id: projectBefore.data_snapshot_id,
          candidate_snapshot_id: materialized.snapshot.id,
          candidate_overview_projection_key: journal.candidate_overview_projection_key,
        });
        return materialized;
      } catch (error) {
        try {
          await recoverInterruptedEnergyProjectPublicationWithinLock(input.materialization, {
            previousDataSnapshotId: projectBefore.data_snapshot_id,
            ...(materialized ? { failedDataSnapshotId: materialized.snapshot.id } : {}),
            ...(previousSnapshot ? { previousSnapshot } : {}),
            ...(previousPublishedSetupPin ? { previousPublishedSetupPin } : {}),
          });
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            "ENERGYIQ_ATOMIC_PUBLICATION_ROLLBACK_FAILED",
          );
        }
        throw error;
      }
    },
  );
};

export const recoverInterruptedEnergyProjectPublication = async (
  input: EnergyProjectManifestMaterializationInput,
): Promise<void> => {
  const project = input.context.metadataStore.energyIq.getProject(input.projectId);
  await withEnergyProjectMaterializationLock(project.workspace_id, input.projectId, async () => {
    await recoverInterruptedEnergyProjectPublicationWithinLock(input);
  });
};

/**
 * Roll back every publication a restart interrupted, across all workspaces.
 *
 * An interrupted publication leaves its journal open, and from then on every read for that project refuses with
 * ENERGYIQ_PROJECT_DATA_PUBLICATION_RECOVERY_REQUIRED until some materialization rolls it back. A release that
 * restarts the API mid-publication would otherwise strand that site until the next sync — which never arrives when
 * the source sync is switched off or failing. Recovering at boot bounds the outage to one restart.
 *
 * Each project is recovered on its own: one that cannot be rolled back is reported and does not stop the others.
 */
export const recoverStrandedEnergyProjectPublications = async (input: {
  context: Required<ConfigApiContext>;
  userId: string;
  /** Tests point this at their own fact store; production resolves it from the workspace. */
  resolveDatabasePath?: (workspaceId: string) => string | undefined;
}): Promise<{ recovered: string[]; failed: Array<{ projectId: string; message: string }> }> => {
  const metadata = input.context.metadataStore;
  const recovered: string[] = [];
  const failed: Array<{ projectId: string; message: string }> = [];
  for (const workspace of metadata.workspaces.list()) {
    for (const project of metadata.energyIq.listProjectsByWorkspace(workspace.id)) {
      if (!metadata.energyIq.findProjectDataPublication(project.id)) continue;
      try {
        const databasePath = input.resolveDatabasePath?.(workspace.id);
        await recoverInterruptedEnergyProjectPublication({
          context: input.context,
          userId: input.userId,
          projectId: project.id,
          requestedBatchId: "__recovery_only__",
          ...(databasePath ? { databasePath } : {}),
        });
        recovered.push(project.id);
      } catch (error) {
        failed.push({
          projectId: project.id,
          message: error instanceof Error ? error.message : "ENERGYIQ_PROJECT_DATA_PUBLICATION_RECOVERY_FAILED",
        });
      }
    }
  }
  return { recovered, failed };
};

export const withRecoveredEnergyProjectPublicationLock = async <T>(input: {
  context: Required<ConfigApiContext>;
  userId: string;
  projectId: string;
  databasePath?: string;
}, action: () => Promise<T> | T): Promise<T> => {
  const project = input.context.metadataStore.energyIq.getProject(input.projectId);
  return withEnergyProjectMaterializationLock(project.workspace_id, input.projectId, async () => {
    await recoverInterruptedEnergyProjectPublicationWithinLock({
      context: input.context,
      userId: input.userId,
      projectId: input.projectId,
      requestedBatchId: "__recovery_only__",
      ...(input.databasePath ? { databasePath: input.databasePath } : {}),
    });
    return action();
  });
};

const recoverInterruptedEnergyProjectPublicationWithinLock = async (
  input: EnergyProjectManifestMaterializationInput,
  known?: {
    previousDataSnapshotId: string;
    failedDataSnapshotId?: string;
    previousSnapshot?: EnergyIqDataSnapshotRecord;
    previousPublishedSetupPin?: NonNullable<EnergyProjectManifestMaterializationInput["publishedSetupPin"]>;
  },
): Promise<void> => {
  const journal = input.context.metadataStore.energyIq.findProjectDataPublication(input.projectId);
  if (!journal) return;
  if (journal.overview_persistent_directory
    && journal.overview_pointer_key
    && journal.candidate_overview_projection_key) {
    await restoreProjectOverviewProjectionPointer({
      persistentDirectory: journal.overview_persistent_directory,
      pointerKey: journal.overview_pointer_key,
      expectedCurrentProjectionKey: journal.candidate_overview_projection_key,
      targetProjectionKey: journal.previous_overview_projection_key ?? null,
    });
  } else if (journal.overview_persistent_directory
    || journal.overview_pointer_key
    || journal.previous_overview_projection_key
    || journal.candidate_overview_projection_key) {
    throw new Error("ENERGYIQ_PROJECT_DATA_PUBLICATION_JOURNAL_INVALID");
  }
  const project = input.context.metadataStore.energyIq.getProject(input.projectId);
  const databasePath = input.databasePath ?? resolveEnergyFactStorePath(project.workspace_id);
  const factState = await probeEnergyFactProjectStateForMaterialization({
    databasePath,
    projectId: input.projectId,
  });
  const previousDataSnapshotId = known?.previousDataSnapshotId ?? journal.previous_snapshot_id;
  const failedDataSnapshotId = known?.failedDataSnapshotId
    ?? journal.candidate_snapshot_id
    ?? (project.data_snapshot_id !== previousDataSnapshotId ? project.data_snapshot_id : undefined)
    ?? (factState?.dataSnapshotId !== previousDataSnapshotId ? factState?.dataSnapshotId : undefined);
  if (!failedDataSnapshotId) {
    input.context.metadataStore.energyIq.abortProjectDataPublication({
      project_id: input.projectId,
      expected_current_snapshot_id: previousDataSnapshotId,
      previous_snapshot_id: previousDataSnapshotId,
    });
    return;
  }
  let previousSnapshot = known?.previousSnapshot;
  if (!previousSnapshot && previousDataSnapshotId !== "unavailable") {
    try {
      const candidate = input.context.metadataStore.energyIq.getDataSnapshot(previousDataSnapshotId);
      if (candidate.project_id === input.projectId) previousSnapshot = candidate;
    } catch (error) {
      if (!(error instanceof Error)
        || error.message !== `ENERGYIQ_DATA_SNAPSHOT_NOT_FOUND:${previousDataSnapshotId}`) throw error;
    }
  }
  const previousPublishedSetupPin = known?.previousPublishedSetupPin
    ?? (previousSnapshot ? resolveSnapshotPublishedSetupPin(input.context, previousSnapshot) : undefined);
  await restoreEnergyProjectMaterializationWithinLock({
    input,
    failedDataSnapshotId,
    previousDataSnapshotId,
    ...(previousSnapshot ? { previousSnapshot } : {}),
    ...(previousPublishedSetupPin ? { previousPublishedSetupPin } : {}),
  });
};

const materializeEnergyProjectManifestWithinLock = async (
  input: EnergyProjectManifestMaterializationInput,
): Promise<EnergyProjectManifestMaterialization> => {
      const totalStartedAt = performance.now();
      const project = input.context.metadataStore.energyIq.getProject(input.projectId);
      if (input.expectedCurrentDataSnapshotId
        && project.data_snapshot_id !== input.expectedCurrentDataSnapshotId) {
        throw new Error(`ENERGYIQ_SNAPSHOT_STALE:${project.data_snapshot_id}`);
      }
      const expectedProjectHierarchyRevisionId = input.expectedProjectHierarchyRevisionId
        ?? input.publishedSetupPin?.hierarchyRevisionId;
      if (expectedProjectHierarchyRevisionId
        && project.hierarchy_revision_id !== expectedProjectHierarchyRevisionId) {
        throw new Error("ENERGYIQ_PUBLISHED_SETUP_PIN_MISMATCH");
      }
      const draft = input.publishedSetupPin ? undefined : input.context.metadataStore.energyIq.projectSetup.getDraft({
        project_id: input.projectId,
        user_id: input.userId,
      });
      const registeredBatches = input.context.metadataStore.energyIq.listImportBatches(input.projectId);
      const baseDocument = input.publishedSetupPin?.document ?? draft!.document;
      if (input.sourceManifestSha256 && input.appendSourceSha256) {
        throw new Error("ENERGYIQ_SOURCE_MANIFEST_MODE_CONFLICT");
      }
      const currentSnapshot = input.context.metadataStore.energyIq.findCurrentDataSnapshot(input.projectId);
      const appendedSourceManifest = input.appendSourceSha256
        ? [
          ...(currentSnapshot
            ? resolveEnergyIqSnapshotFactScope(currentSnapshot).sourceSha256
            : baseDocument.source_manifest?.source_sha256 ?? []),
          input.appendSourceSha256,
        ].map(normalizeSha).filter((value, index, values) => values.indexOf(value) === index).sort()
        : undefined;
      const sourceManifestSha256 = appendedSourceManifest ?? input.sourceManifestSha256;
      const document = sourceManifestSha256
        ? {
          ...baseDocument,
          source_manifest: createEnergyIqSourceManifest(sourceManifestSha256, true),
        }
        : baseDocument;
      const sourceManifest = document.source_manifest;
      if (!sourceManifest) {
        throw new Error("ENERGYIQ_IMPORT_MATERIALIZATION_NOT_READY:SOURCE_MANIFEST_REQUIRED");
      }
      const sourceSet = new Set(sourceManifest.source_sha256.map(normalizeSha));
      const batches = activeEnergyIqImportBatches(registeredBatches, document)
        .sort((left, right) => left.source_sha256.localeCompare(right.source_sha256));
      if (batches.length !== sourceSet.size) {
        throw new Error("ENERGYIQ_SOURCE_MANIFEST_MISMATCH");
      }
      const blockingReasons = resolveEnergyIqMaterializationBlockingReasons({
        batches,
        document,
      });
      if (blockingReasons.length > 0) {
        throw new Error(`ENERGYIQ_IMPORT_MATERIALIZATION_NOT_READY:${blockingReasons.join(",")}`);
      }
      const requestedBatch = batches.find((batch) => batch.id === input.requestedBatchId);
      if (!requestedBatch) throw new Error("ENERGYIQ_IMPORT_BATCH_NOT_PINNED");

      const databasePath = input.databasePath ?? resolveEnergyFactStorePath(project.workspace_id);
      const factState = await probeEnergyFactProjectStateForMaterialization({
        databasePath,
        projectId: input.projectId,
      });
      const factStateAheadOfMetadata = factState?.dataSnapshotId !== undefined
        && factState.dataSnapshotId !== project.data_snapshot_id;
      if (factState && !currentSnapshot && !factStateAheadOfMetadata) {
        throw new Error(`ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE:${project.data_snapshot_id}`);
      }
      // Built only when a batch's fingerprint misses, which on a healthy
      // project is never: parsing every published revision is wasted work the
      // rest of the time.
      let mappingsByFingerprint: Map<string, EnergyIqMeterMappingDraft> | undefined;
      const resolveMappingByFingerprint = (fingerprint: string): EnergyIqMeterMappingDraft | undefined => {
        mappingsByFingerprint ??= new Map(input.context.metadataStore.energyIq.projectSetup
          .listHierarchyRevisions(input.projectId)
          .flatMap((revision) => {
            let mapping: EnergyIqMeterMappingDraft | undefined;
            try {
              mapping = (JSON.parse(revision.snapshot_json) as EnergyIqProjectSetupDocument).meter_mapping;
            } catch {
              return [];
            }
            return mapping ? [[fingerprintEnergyIqMeterMapping(mapping), mapping] as const] : [];
          }));
        return mappingsByFingerprint.get(fingerprint);
      };
      const allBatchesCurrent = batches.every((batch) => isEnergyImportMaterializationCurrent({
        batch,
        document,
        timezone: document.project.timezone,
        resolveMappingByFingerprint,
      }));
      if (factState && currentSnapshot && allBatchesCurrent) {
        let expectedScope: EnergyIqSnapshotFactScope;
        try {
          expectedScope = resolveEnergyIqSnapshotFactScope(currentSnapshot);
        } catch {
          throw new Error(`ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE:${currentSnapshot.id}`);
        }
        if (isEnergyProjectFactStateCurrent({
          factState,
          snapshotScope: expectedScope,
          workspaceId: project.workspace_id,
          projectId: input.projectId,
          currentSourceManifestSha256: sourceManifest.source_sha256,
        })) {
          return {
            batch: requestedBatch,
            snapshot: currentSnapshot,
            document,
            duplicate: true,
          };
        }
      }

      const materializations = await Promise.all(batches.map(async (batch) => {
        const parseNormalizeStartedAt = performance.now();
        const canPreserveExisting = factState?.factWriterContractVersion === ENERGY_FACT_WRITER_CONTRACT_VERSION
          && factState.sourceSha256.some((source) => normalizeSha(source) === normalizeSha(batch.source_sha256))
          && isEnergyImportMaterializationCurrent({
            batch,
            document,
            timezone: document.project.timezone,
            resolveMappingByFingerprint,
          });
        const existingSummary = canPreserveExisting ? parseStoredMaterializationSummary(batch) : undefined;
        if (existingSummary && existingSummary.rawRowCount > 0) {
          const write: EnergyFactMaterializationBatchWrite = {
            importBatchId: batch.id,
            sourceSha256: batch.source_sha256,
            preserveExisting: true,
            rawReadings: [],
            normalizedReadings: [],
            intervalFacts: [],
            qualityEvents: [],
          };
          return {
            batch,
            result: { write, summary: existingSummary },
            parseNormalizeMs: elapsedMs(parseNormalizeStartedAt),
          };
        }
        if (!batch.file_asset_ref_id) {
          throw new Error(`ENERGYIQ_IMPORT_BATCH_INVALID:${batch.id}`);
        }
        const original = input.context.fileAssetService.readRef({
          user_id: batch.created_by,
          workspace_id: batch.workspace_id,
          id: batch.file_asset_ref_id,
        });
        return {
          batch,
          result: await (batch.source_kind === "tuya"
            ? buildEnergyTuyaMaterialization
            : buildEnergyExcelMaterialization)({
            content: original.body,
            batch,
            document,
            mappingRevision: input.publishedSetupPin?.hierarchySequence ?? draft!.revision,
            timezone: document.project.timezone,
          }),
          parseNormalizeMs: elapsedMs(parseNormalizeStartedAt),
        };
      }));
      const metadataMaterializations = materializations.map(({ batch, result }) => ({
        batch_id: batch.id,
        summary: result.summary,
      }));
      const prepared = input.context.metadataStore.energyIq.prepareProjectManifestMaterialization({
        project_id: input.projectId,
        materializations: metadataMaterializations,
        source_manifest_sha256: sourceManifest.source_sha256,
      });
      if (factStateAheadOfMetadata && factState) {
        if (factState.dataSnapshotId !== prepared.expected_snapshot_id) {
          throw new Error(`ENERGYIQ_SNAPSHOT_STALE:${factState.dataSnapshotId}`);
        }
        if (!isEnergyProjectFactStateCurrent({
          factState,
          snapshotScope: prepared.fact_scope,
          workspaceId: project.workspace_id,
          projectId: input.projectId,
          currentSourceManifestSha256: sourceManifest.source_sha256,
        })) {
          throw new Error(`ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE:${factState.dataSnapshotId}`);
        }
      }
      const persisted = await writeEnergyFactProjectMaterialization({
        databasePath,
        projectId: input.projectId,
        timezone: document.project.timezone,
        expectedPreviousDataSnapshotId: prepared.expected_previous_snapshot_id,
        snapshotFactScope: prepared.fact_scope,
        batches: materializations.map(({ result }) => result.write),
      });
      const existingAudit = input.context.metadataStore.db.prepare("SELECT audit_json FROM energyiq_data_snapshots WHERE id = ? AND project_id = ?").get(prepared.expected_snapshot_id, input.projectId);
      const setupPin = existingAudit
        ? (JSON.parse(String(existingAudit.audit_json)) as {setupPin?: unknown}).setupPin
        : {hierarchyRevisionId: input.publishedSetupPin?.hierarchyRevisionId ?? project.hierarchy_revision_id,
          hierarchySequence: input.publishedSetupPin?.hierarchySequence ?? draft!.revision, document};
      const completed = input.context.metadataStore.energyIq.completeProjectManifestMaterialization({
        project_id: input.projectId,
        materializations: metadataMaterializations,
        project_audit: {...persisted.projectAudit, ...(setupPin ? {setupPin} : {})},
        source_manifest_sha256: sourceManifest.source_sha256,
        expected_snapshot_id: prepared.expected_snapshot_id,
        expected_previous_snapshot_id: prepared.expected_previous_snapshot_id,
      });
      const completedBatch = completed.batches.find((batch) => batch.id === input.requestedBatchId);
      if (!completedBatch) throw new Error(`ENERGYIQ_IMPORT_BATCH_NOT_FOUND:${input.requestedBatchId}`);
      return {
        batch: completedBatch,
        snapshot: completed.snapshot,
        document,
        duplicate: false,
        timings: {
          parseNormalizeByBatch: materializations.map(({ batch, parseNormalizeMs }) => ({
            batchId: batch.id,
            durationMs: parseNormalizeMs,
          })),
          ...persisted.timings,
          totalMs: elapsedMs(totalStartedAt),
        },
      };
};

const restoreEnergyProjectMaterializationWithinLock = async (input: {
  input: EnergyProjectManifestMaterializationInput;
  failedDataSnapshotId: string;
  previousDataSnapshotId: string;
  previousSnapshot?: EnergyIqDataSnapshotRecord;
  previousPublishedSetupPin?: NonNullable<EnergyProjectManifestMaterializationInput["publishedSetupPin"]>;
}): Promise<void> => {
  if (input.previousSnapshot) {
    const previousScope = resolveEnergyIqSnapshotFactScope(input.previousSnapshot);
    const previousBatch = input.input.context.metadataStore.energyIq.listImportBatches(input.input.projectId)
      .find((batch) => previousScope.sourceSha256.includes(batch.source_sha256));
    if (!previousBatch || !input.previousPublishedSetupPin) {
      throw new Error("ENERGYIQ_ATOMIC_ROLLBACK_UNAVAILABLE");
    }
    const {
      appendSourceSha256: _appendSourceSha256,
      expectedProjectHierarchyRevisionId: _expectedProjectHierarchyRevisionId,
      ...baseInput
    } = input.input;
    const project = input.input.context.metadataStore.energyIq.getProject(input.input.projectId);
    const databasePath = input.input.databasePath ?? resolveEnergyFactStorePath(project.workspace_id);
    const currentFactState = await probeEnergyFactProjectStateForMaterialization({
      databasePath,
      projectId: input.input.projectId,
    });
    if (project.data_snapshot_id === input.previousDataSnapshotId) {
      if (currentFactState?.dataSnapshotId === input.previousDataSnapshotId) {
        input.input.context.metadataStore.energyIq.abortProjectDataPublication({
          project_id: input.input.projectId,
          expected_current_snapshot_id: input.failedDataSnapshotId,
          previous_snapshot_id: input.previousDataSnapshotId,
        });
        return;
      }
      if (currentFactState?.dataSnapshotId === input.failedDataSnapshotId) {
        await resetEnergyFactProjectMaterialization({
          databasePath,
          projectId: input.input.projectId,
          expectedDataSnapshotId: input.failedDataSnapshotId,
        });
      } else if (currentFactState) {
        throw new Error(`ENERGYIQ_SNAPSHOT_STALE:${currentFactState.dataSnapshotId}`);
      }
    }
    const restored = await materializeEnergyProjectManifestWithinLock({
      ...baseInput,
      requestedBatchId: previousBatch.id,
      sourceManifestSha256: previousScope.sourceSha256,
      expectedCurrentDataSnapshotId: project.data_snapshot_id,
      ...(input.input.publishedSetupPin
        ? { expectedProjectHierarchyRevisionId: input.input.publishedSetupPin.hierarchyRevisionId }
        : {}),
      publishedSetupPin: input.previousPublishedSetupPin,
    });
    if (restored.snapshot.id !== input.previousSnapshot.id) {
      throw new Error("ENERGYIQ_ATOMIC_ROLLBACK_IDENTITY_MISMATCH");
    }
    input.input.context.metadataStore.energyIq.abortProjectDataPublication({
      project_id: input.input.projectId,
      expected_current_snapshot_id: input.failedDataSnapshotId,
      previous_snapshot_id: input.previousDataSnapshotId,
    });
    return;
  }
  const workspaceId = input.input.context.metadataStore.energyIq.getProject(input.input.projectId).workspace_id;
  const databasePath = input.input.databasePath ?? resolveEnergyFactStorePath(workspaceId);
  const currentFactState = await probeEnergyFactProjectStateForMaterialization({
    databasePath,
    projectId: input.input.projectId,
  });
  if (currentFactState?.dataSnapshotId === input.failedDataSnapshotId) {
    await resetEnergyFactProjectMaterialization({
      databasePath,
      projectId: input.input.projectId,
      expectedDataSnapshotId: input.failedDataSnapshotId,
    });
  } else if (currentFactState) {
    throw new Error(`ENERGYIQ_SNAPSHOT_STALE:${currentFactState.dataSnapshotId}`);
  }
  input.input.context.metadataStore.energyIq.abortProjectDataPublication({
    project_id: input.input.projectId,
    expected_current_snapshot_id: input.failedDataSnapshotId,
    previous_snapshot_id: input.previousDataSnapshotId,
  });
};

/**
 * The mapping a snapshot's rows were built under, named by its fingerprint.
 *
 * Batches materialized under mappings that differ only in their display labels
 * keep their rows rather than being re-derived, so one snapshot can span
 * several fingerprints. Any of those mappings reproduces the same rows, and the
 * most recently published one is the pin, because that is the one the project
 * is published on.
 */
export const resolveSnapshotMappingFingerprint = (input: {
  fingerprints: ReadonlySet<string>;
  timezone: string;
  revisions: readonly EnergyIqHierarchyRevisionRecord[];
}): string => {
  const [only] = [...input.fingerprints];
  if (input.fingerprints.size === 1) return only!;
  const candidates = input.revisions.flatMap((revision) => {
    let document: EnergyIqProjectSetupDocument;
    try {
      document = JSON.parse(revision.snapshot_json) as EnergyIqProjectSetupDocument;
    } catch {
      return [];
    }
    const mapping = document.meter_mapping;
    if (!mapping || document.project.timezone !== input.timezone) return [];
    const fingerprint = fingerprintEnergyIqMeterMapping(mapping);
    return input.fingerprints.has(fingerprint)
      ? [{
        revision,
        fingerprint,
        labelFree: fingerprintEnergyIqMeterMappingExcludingDisplayNames(mapping),
      }]
      : [];
  });
  // Every fingerprint has to name a published mapping, and they all have to
  // describe the same readings, or the snapshot spans a real mapping change and
  // no single pin can reproduce it.
  if (new Set(candidates.map((candidate) => candidate.fingerprint)).size !== input.fingerprints.size
    || new Set(candidates.map((candidate) => candidate.labelFree)).size !== 1) {
    throw new Error("ENERGYIQ_ATOMIC_ROLLBACK_SETUP_INVALID");
  }
  return candidates
    .reduce((best, candidate) => (candidate.revision.sequence > best.revision.sequence ? candidate : best))
    .fingerprint;
};

const resolveSnapshotPublishedSetupPin = (
  context: Required<ConfigApiContext>,
  snapshot: EnergyIqDataSnapshotRecord,
): NonNullable<EnergyProjectManifestMaterializationInput["publishedSetupPin"]> => {
  const manifest = JSON.parse(snapshot.manifest_json) as {
    batches?: Array<{
      sourceSha256?: unknown;
      materialization?: { mappingFingerprint?: unknown; timezone?: unknown };
    }>;
  };
  const snapshotBatches = manifest.batches ?? [];
  const first = snapshotBatches[0]?.materialization;
  if (!first || typeof first.mappingFingerprint !== "string" || typeof first.timezone !== "string"
    || snapshotBatches.some((batch) => typeof batch.materialization?.mappingFingerprint !== "string"
      || batch.materialization?.timezone !== first.timezone
      || typeof batch.sourceSha256 !== "string")) {
    throw new Error("ENERGYIQ_ATOMIC_ROLLBACK_SETUP_INVALID");
  }
  const publishedRevisions = context.metadataStore.energyIq.projectSetup
    .listHierarchyRevisions(snapshot.project_id);
  const mappingFingerprint = resolveSnapshotMappingFingerprint({
    fingerprints: new Set(snapshotBatches
      .map((batch) => String(batch.materialization?.mappingFingerprint))),
    timezone: first.timezone,
    revisions: publishedRevisions,
  });
  const sourceSet = new Set(snapshotBatches.map((batch) => String(batch.sourceSha256).toLocaleLowerCase()));
  const materializedBatches = context.metadataStore.energyIq.listImportBatches(snapshot.project_id)
    .filter((batch) => sourceSet.has(batch.source_sha256.toLocaleLowerCase()));
  const mappingRevisions = new Set(materializedBatches.map((batch) => {
    const summary = JSON.parse(batch.materialization_json ?? "{}") as { mappingRevision?: unknown };
    return Number.isSafeInteger(summary.mappingRevision) ? Number(summary.mappingRevision) : null;
  }));
  if (materializedBatches.length !== sourceSet.size) {
    throw new Error("ENERGYIQ_ATOMIC_ROLLBACK_SETUP_INVALID");
  }
  const matchingRevisions = publishedRevisions
    .filter((candidate) => {
      const document = JSON.parse(candidate.snapshot_json) as EnergyIqProjectSetupDocument;
      return document.meter_mapping
        && document.project.timezone === first.timezone
        && fingerprintEnergyIqMeterMapping(document.meter_mapping) === mappingFingerprint;
    });
  const revision = matchingRevisions.length === 1
    ? matchingRevisions[0]
    : mappingRevisions.size === 1 && !mappingRevisions.has(null)
      ? matchingRevisions.find((candidate) => candidate.sequence === [...mappingRevisions][0])
      : undefined;
  if (!revision) {
    // A staged source can predate the first published hierarchy. Retain its exact
    // server-written configuration in the immutable snapshot audit for rollback.
    const pin = (JSON.parse(snapshot.audit_json) as {setupPin?: EnergyProjectManifestMaterializationInput["publishedSetupPin"]}).setupPin;
    if (pin?.document.meter_mapping && typeof pin.hierarchyRevisionId === "string"
      && Number.isSafeInteger(pin.hierarchySequence)
      && pin.document.project.timezone === first.timezone
      && fingerprintEnergyIqMeterMapping(pin.document.meter_mapping) === mappingFingerprint) return pin;
    throw new Error("ENERGYIQ_ATOMIC_ROLLBACK_SETUP_UNAVAILABLE");
  }
  const document = JSON.parse(revision.snapshot_json) as EnergyIqProjectSetupDocument;
  if (!document.meter_mapping
    || document.project.timezone !== first.timezone
    || fingerprintEnergyIqMeterMapping(document.meter_mapping) !== mappingFingerprint) {
    throw new Error("ENERGYIQ_ATOMIC_ROLLBACK_SETUP_MISMATCH");
  }
  return { hierarchyRevisionId: revision.id, hierarchySequence: revision.sequence, document };
};

const sameFactScope = (
  actual: {
    workspaceId: string;
    projectId: string;
    dataSnapshotId: string;
    manifestFingerprint: string;
    sourceSha256: string[];
  },
  expected: {
    workspaceId: string;
    projectId: string;
    dataSnapshotId: string;
    manifestFingerprint: string;
    sourceSha256: string[];
  },
): boolean => actual.workspaceId === expected.workspaceId
  && actual.projectId === expected.projectId
  && actual.dataSnapshotId === expected.dataSnapshotId
  && actual.manifestFingerprint === expected.manifestFingerprint
  && actual.sourceSha256.length === expected.sourceSha256.length
  && actual.sourceSha256.every((value, index) => normalizeSha(value) === normalizeSha(expected.sourceSha256[index] ?? ""));

export const isEnergyProjectFactStateCurrent = (input: {
  factState: {
    workspaceId: string;
    projectId: string;
    dataSnapshotId: string;
    manifestFingerprint: string;
    sourceSha256: string[];
    factWriterContractVersion: string;
  };
  snapshotScope: {
    workspaceId: string;
    projectId: string;
    dataSnapshotId: string;
    manifestFingerprint: string;
    sourceSha256: string[];
  };
  workspaceId: string;
  projectId: string;
  currentSourceManifestSha256: readonly string[];
}): boolean => input.snapshotScope.workspaceId === input.workspaceId
  && input.snapshotScope.projectId === input.projectId
  && input.factState.factWriterContractVersion === ENERGY_FACT_WRITER_CONTRACT_VERSION
  && sameFactScope(input.factState, input.snapshotScope)
  && sameSourceSet(input.snapshotScope.sourceSha256, input.currentSourceManifestSha256);

const sameSourceSet = (left: readonly string[], right: readonly string[]): boolean => {
  const normalizedLeft = [...new Set(left.map(normalizeSha))].sort((a, b) => a.localeCompare(b));
  const normalizedRight = [...new Set(right.map(normalizeSha))].sort((a, b) => a.localeCompare(b));
  return normalizedLeft.length === normalizedRight.length
    && normalizedLeft.every((value, index) => value === normalizedRight[index]);
};

const normalizeSha = (value: string): string => value.trim().toLocaleLowerCase();

const parseStoredMaterializationSummary = (
  batch: EnergyIqImportBatchRecord,
): EnergyImportMaterializationSummary | undefined => {
  if (!batch.materialization_json) return undefined;
  try {
    const value = JSON.parse(batch.materialization_json) as EnergyImportMaterializationSummary;
    return typeof value.rawRowCount === "number" ? value : undefined;
  } catch {
    return undefined;
  }
};

const elapsedMs = (startedAt: number): number => Math.round((performance.now() - startedAt) * 1_000) / 1_000;
