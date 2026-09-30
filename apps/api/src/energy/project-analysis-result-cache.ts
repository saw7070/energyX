import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { isDeepStrictEqual } from "node:util";

export type ProjectAnalysisResultCache<T> = {
  resolve: (
    key: string,
    compute: () => Promise<T>,
    options?: { bypass?: boolean; persistentDirectory?: string },
  ) => Promise<T>;
  materializeCurrent: (input: {
    pointerKey: string;
    projectionKey: string;
    identity: ProjectOverviewProjectionIdentity;
    persistentDirectory: string;
    compute: () => Promise<T>;
    validate: (value: T, identity: ProjectOverviewProjectionIdentity) => boolean;
    equivalent?: (left: T, right: T) => boolean;
    validateBeforePublish?: () => Promise<boolean>;
    beforePublish?: (publication: {
      previousProjectionKey: string | null;
      candidateProjectionKey: string;
    }) => Promise<void>;
    forceRecompute?: boolean;
  }) => Promise<{ value: T; changed: boolean }>;
  restoreCurrent: (input: {
    pointerKey: string;
    persistentDirectory: string;
    expectedCurrentProjectionKey: string | null;
    targetProjectionKey: string | null;
  }) => Promise<void>;
  reconcileCurrent: (input: {
    pointerKey: string;
    persistentDirectory: string;
    matches: (value: T, identity: ProjectOverviewProjectionIdentity) => boolean;
    validateBeforePublish?: (
      value: T,
      identity: ProjectOverviewProjectionIdentity,
    ) => Promise<boolean>;
  }) => Promise<(MaterializedProjectOverviewProjection<T> & { changed: boolean }) | undefined>;
  readCurrent: (input: {
    pointerKey: string;
    persistentDirectory: string;
    expectedProjectionKey?: string;
    validate: (value: T, identity: ProjectOverviewProjectionIdentity) => boolean;
  }) => Promise<MaterializedProjectOverviewProjection<T> | undefined>;
};

export type ProjectAnalysisCacheIdentity = {
  resolverRevision: string;
  userId: string;
  workspaceId: string;
  projectId: string;
  scopeId: string;
  resource: string;
  analysisWindow: string | null;
  period: string;
  timezone: string;
  from: string;
  to: string;
  dataSnapshotId: string;
  projectReleaseId: string;
  reportTimePolicyRevisionId: string;
  hierarchyRevisionId: string;
  meterMappingRevisionId: string;
  meterFormulaRevisionId: string;
  metricVersion: string;
  businessCalendarVersion: string;
  tariffScheduleVersion: string;
  rendererKey: string;
  rendererVersion: string;
  rendererContractVersion: string;
  recipeId: string;
  recipeVersion: string;
  metricRevisionIds: readonly string[];
  ruleRevisionIds: readonly string[];
  databasePath: string | null;
};

export type ProjectOverviewProjectionIdentity = Omit<ProjectAnalysisCacheIdentity, "userId"> & {
  overviewDefinitionRevisionId: string;
};

export type MaterializedProjectOverviewProjection<T> = {
  projectionKey: string;
  identity: ProjectOverviewProjectionIdentity;
  value: T;
};

export type ProjectOverviewPointerPublication = {
  persistentDirectory: string;
  pointerKey: string;
  previousProjectionKey: string | null;
  candidateProjectionKey: string;
};

export const restoreProjectOverviewProjectionPointer = async (input: {
  persistentDirectory: string;
  pointerKey: string;
  expectedCurrentProjectionKey: string | null;
  targetProjectionKey: string | null;
}): Promise<void> => {
  requireMaterializedProjectionPath(input.persistentDirectory);
  requireMaterializedProjectionKey(input.pointerKey);
  if (input.targetProjectionKey) {
    const target = await readMaterializedProjection<unknown>({
      directory: input.persistentDirectory,
      projectionKey: input.targetProjectionKey,
    });
    if (!target) throw new Error("ENERGYIQ_OVERVIEW_PROJECTION_ROLLBACK_TARGET_UNAVAILABLE");
  }
  await restoreCurrentMaterializedProjectionPointer({
    directory: input.persistentDirectory,
    pointerKey: input.pointerKey,
    expectedCurrentProjectionKey: input.expectedCurrentProjectionKey,
    targetProjectionKey: input.targetProjectionKey,
  });
};

export const canonicalizeProjectAnalysisRevisionSet = (
  values: readonly string[],
): string[] => [...values].sort((left, right) => left.localeCompare(right));

export const createProjectAnalysisCacheKey = (
  identity: ProjectAnalysisCacheIdentity,
): string => JSON.stringify({
  contract: "project-analysis-result-cache@3",
  resolverRevision: identity.resolverRevision,
  userId: identity.userId,
  workspaceId: identity.workspaceId,
  projectId: identity.projectId,
  scopeId: identity.scopeId,
  resource: identity.resource,
  analysisWindow: identity.analysisWindow,
  period: identity.period,
  timezone: identity.timezone,
  from: identity.from,
  to: identity.to,
  dataSnapshotId: identity.dataSnapshotId,
  projectReleaseId: identity.projectReleaseId,
  reportTimePolicyRevisionId: identity.reportTimePolicyRevisionId,
  hierarchyRevisionId: identity.hierarchyRevisionId,
  meterMappingRevisionId: identity.meterMappingRevisionId,
  meterFormulaRevisionId: identity.meterFormulaRevisionId,
  metricVersion: identity.metricVersion,
  businessCalendarVersion: identity.businessCalendarVersion,
  tariffScheduleVersion: identity.tariffScheduleVersion,
  rendererKey: identity.rendererKey,
  rendererVersion: identity.rendererVersion,
  rendererContractVersion: identity.rendererContractVersion,
  recipeId: identity.recipeId,
  recipeVersion: identity.recipeVersion,
  metricRevisionIds: canonicalizeProjectAnalysisRevisionSet(identity.metricRevisionIds),
  ruleRevisionIds: canonicalizeProjectAnalysisRevisionSet(identity.ruleRevisionIds),
  databasePath: identity.databasePath,
});

export const createProjectOverviewProjectionKey = (
  identity: ProjectOverviewProjectionIdentity,
): string => JSON.stringify({
  contract: "project-overview-projection-identity@1",
  resolverRevision: identity.resolverRevision,
  workspaceId: identity.workspaceId,
  projectId: identity.projectId,
  scopeId: identity.scopeId,
  resource: identity.resource,
  analysisWindow: identity.analysisWindow,
  period: identity.period,
  timezone: identity.timezone,
  from: identity.from,
  to: identity.to,
  dataSnapshotId: identity.dataSnapshotId,
  projectReleaseId: identity.projectReleaseId,
  reportTimePolicyRevisionId: identity.reportTimePolicyRevisionId,
  hierarchyRevisionId: identity.hierarchyRevisionId,
  meterMappingRevisionId: identity.meterMappingRevisionId,
  meterFormulaRevisionId: identity.meterFormulaRevisionId,
  metricVersion: identity.metricVersion,
  businessCalendarVersion: identity.businessCalendarVersion,
  tariffScheduleVersion: identity.tariffScheduleVersion,
  overviewDefinitionRevisionId: identity.overviewDefinitionRevisionId,
  rendererKey: identity.rendererKey,
  rendererVersion: identity.rendererVersion,
  rendererContractVersion: identity.rendererContractVersion,
  recipeId: identity.recipeId,
  recipeVersion: identity.recipeVersion,
  metricRevisionIds: canonicalizeProjectAnalysisRevisionSet(identity.metricRevisionIds),
  ruleRevisionIds: canonicalizeProjectAnalysisRevisionSet(identity.ruleRevisionIds),
  databasePath: identity.databasePath,
});

export const createProjectOverviewProjectionRef = (
  projectionKey: string,
): string => `sha256:${createHash("sha256").update(projectionKey).digest("hex")}`;

export const createProjectAnalysisResultCache = <T>(input: {
  capacity: number;
  ttlMs: number;
  now?: () => number;
  persistentCapacity?: number;
}): ProjectAnalysisResultCache<T> => {
  const results = new Map<string, { value: T; expiresAt: number }>();
  const inFlight = new Map<string, { generation: number; promise: Promise<T> }>();
  const materializationInFlight = new Map<string, {
    forceRecompute: boolean;
    promise: Promise<{ value: T; changed: boolean }>;
  }>();
  const generations = new Map<string, number>();
  const now = input.now ?? Date.now;
  const capacity = Math.max(1, Math.floor(input.capacity));
  const persistentCapacity = Math.max(
    capacity,
    Math.floor(input.persistentCapacity ?? capacity * 4),
  );

  const retain = (key: string, value: T, expiresAt: number): T => {
    const protectedValue = deepFreeze(value);
    const currentTime = now();
    for (const [resultKey, result] of results) {
      if (result.expiresAt <= currentTime) results.delete(resultKey);
    }
    results.delete(key);
    while (results.size >= capacity) {
      const leastRecentlyUsedKey = results.keys().next().value;
      if (leastRecentlyUsedKey === undefined) break;
      results.delete(leastRecentlyUsedKey);
    }
    results.set(key, { value: protectedValue, expiresAt });
    return protectedValue;
  };

  return {
    async resolve(key, compute, options = {}) {
      if (options.persistentDirectory && !isAbsolute(options.persistentDirectory)) {
        throw new Error("Project analysis persistent cache directory must be absolute.");
      }
      let generation = generations.get(key) ?? 0;
      if (options.bypass) {
        generation += 1;
        generations.set(key, generation);
        results.delete(key);
      } else {
        const cached = results.get(key);
        if (cached && cached.expiresAt > now()) {
          results.delete(key);
          results.set(key, cached);
          return cached.value;
        }
        if (cached) results.delete(key);
      }
      const current = inFlight.get(key);
      if (current?.generation === generation) return current.promise;

      const pending = (async () => {
        if (!options.bypass && options.persistentDirectory) {
          const restored = await readPersistentResult<T>({
            directory: options.persistentDirectory,
            key,
            now: now(),
          });
          if (restored) {
            if ((generations.get(key) ?? 0) !== generation) {
              return deepFreeze(restored.value);
            }
            return retain(key, restored.value, restored.expiresAt);
          }
        }

        const value = await compute();
        if ((generations.get(key) ?? 0) !== generation) return value;
        const expiresAt = now() + input.ttlMs;
        const protectedValue = retain(key, value, expiresAt);
        if (options.persistentDirectory) {
          await writePersistentResult({
            directory: options.persistentDirectory,
            key,
            value: protectedValue,
            expiresAt,
            capacity: persistentCapacity,
          });
        }
        return protectedValue;
      })().finally(() => {
        if (inFlight.get(key)?.promise === pending) inFlight.delete(key);
      });
      inFlight.set(key, { generation, promise: pending });
      return pending;
    },
    async materializeCurrent(materialization) {
      requireMaterializedProjectionPath(materialization.persistentDirectory);
      requireMaterializedProjectionKey(materialization.pointerKey);
      if (materialization.projectionKey !== createProjectOverviewProjectionKey(materialization.identity)) {
        throw new Error("ENERGYIQ_OVERVIEW_PROJECTION_IDENTITY_MISMATCH");
      }
      const materializationKey = JSON.stringify({
        persistentDirectory: materialization.persistentDirectory,
        pointerKey: materialization.pointerKey,
        projectionKey: materialization.projectionKey,
      });
      while (true) {
        const existingWork = materializationInFlight.get(materializationKey);
        if (!existingWork) break;
        if (existingWork.forceRecompute === (materialization.forceRecompute === true)) {
          return existingWork.promise;
        }
        await existingWork.promise.catch(() => undefined);
      }

      const pending = withCurrentOverviewMaterializationLock({
        directory: materialization.persistentDirectory,
        pointerKey: materialization.pointerKey,
      }, async () => {
        const currentPointer = await readCurrentMaterializedProjectionPointer({
          directory: materialization.persistentDirectory,
          pointerKey: materialization.pointerKey,
        });
        const current = currentPointer
          ? await readMaterializedProjection<T>({
            directory: materialization.persistentDirectory,
            projectionKey: currentPointer.projectionKey,
          })
          : undefined;
        const expectedCurrentProjectionKey = currentPointer?.projectionKey ?? null;
        if (!materialization.forceRecompute
          && currentPointer?.projectionKey === materialization.projectionKey
          && (!current || !materialization.validate(current.value, current.identity))) {
          throw new Error("ENERGYIQ_OVERVIEW_PROJECTION_REPAIR_REQUIRES_FORCE");
        }
        if (!materialization.forceRecompute
          && current?.projectionKey === materialization.projectionKey
          && materialization.validate(current.value, current.identity)) {
          return {
            value: retain(materialization.projectionKey, current.value, Number.POSITIVE_INFINITY),
            changed: false,
          };
        }
        const existing = await readMaterializedProjection<T>({
          directory: materialization.persistentDirectory,
          projectionKey: materialization.projectionKey,
        });
        const existingIsValid = existing !== undefined
          && materialization.validate(existing.value, existing.identity);
        const value = materialization.forceRecompute || !existingIsValid
          ? await materialization.compute()
          : existing.value;
        if (!materialization.validate(value, materialization.identity)) {
          throw new Error("ENERGYIQ_OVERVIEW_PROJECTION_VALIDATION_FAILED");
        }
        if (materialization.forceRecompute && existingIsValid
          && !(materialization.equivalent ?? isDeepStrictEqual)(existing.value, value)) {
          throw new Error("ENERGYIQ_OVERVIEW_PROJECTION_NONDETERMINISTIC");
        }
        if (!existingIsValid) {
          await writeMaterializedProjection({
            directory: materialization.persistentDirectory,
            projectionKey: materialization.projectionKey,
            identity: materialization.identity,
            value,
          });
        }
        const persisted = await readMaterializedProjection<T>({
          directory: materialization.persistentDirectory,
          projectionKey: materialization.projectionKey,
        });
        if (!persisted || !materialization.validate(persisted.value, persisted.identity)) {
          throw new Error("ENERGYIQ_OVERVIEW_PROJECTION_PERSISTENCE_INVALID");
        }
        await publishCurrentMaterializedProjectionPointer({
          directory: materialization.persistentDirectory,
          pointerKey: materialization.pointerKey,
          projectionKey: materialization.projectionKey,
          expectedCurrentProjectionKey,
          ...(materialization.validateBeforePublish
            ? { validateBeforePublish: materialization.validateBeforePublish }
            : {}),
          ...(materialization.beforePublish
            ? { beforePublish: materialization.beforePublish }
            : {}),
        });
        return {
          value: retain(materialization.projectionKey, persisted.value, Number.POSITIVE_INFINITY),
          changed: current?.projectionKey !== materialization.projectionKey || !existingIsValid,
        };
      }).finally(() => {
        if (materializationInFlight.get(materializationKey)?.promise === pending) {
          materializationInFlight.delete(materializationKey);
        }
      });
      materializationInFlight.set(materializationKey, {
        forceRecompute: materialization.forceRecompute === true,
        promise: pending,
      });
      return pending;
    },
    async restoreCurrent(restoration) {
      await restoreProjectOverviewProjectionPointer(restoration);
    },
    async reconcileCurrent(reconciliation) {
      requireMaterializedProjectionPath(reconciliation.persistentDirectory);
      requireMaterializedProjectionKey(reconciliation.pointerKey);
      return withCurrentOverviewMaterializationLock({
        directory: reconciliation.persistentDirectory,
        pointerKey: reconciliation.pointerKey,
      }, async () => {
        const currentPointer = await readCurrentMaterializedProjectionPointer({
          directory: reconciliation.persistentDirectory,
          pointerKey: reconciliation.pointerKey,
        });
        const current = currentPointer
          ? await readMaterializedProjection<T>({
            directory: reconciliation.persistentDirectory,
            projectionKey: currentPointer.projectionKey,
          })
          : undefined;
        if (current && reconciliation.matches(current.value, current.identity)) {
          return {
            ...current,
            value: retain(current.projectionKey, current.value, Number.POSITIVE_INFINITY),
            changed: false,
          };
        }
        const candidates = (await readAllMaterializedProjections<T>(
          reconciliation.persistentDirectory,
        )).filter((candidate) => reconciliation.matches(candidate.value, candidate.identity));
        if (candidates.length !== 1) return undefined;
        const candidate = candidates[0]!;
        await publishCurrentMaterializedProjectionPointer({
          directory: reconciliation.persistentDirectory,
          pointerKey: reconciliation.pointerKey,
          projectionKey: candidate.projectionKey,
          expectedCurrentProjectionKey: currentPointer?.projectionKey ?? null,
          ...(reconciliation.validateBeforePublish ? {
            validateBeforePublish: () => reconciliation.validateBeforePublish!(
              candidate.value,
              candidate.identity,
            ),
          } : {}),
        });
        return {
          ...candidate,
          value: retain(candidate.projectionKey, candidate.value, Number.POSITIVE_INFINITY),
          changed: currentPointer?.projectionKey !== candidate.projectionKey,
        };
      });
    },
    async readCurrent(read) {
      requireMaterializedProjectionPath(read.persistentDirectory);
      requireMaterializedProjectionKey(read.pointerKey);
      const current = await readCurrentMaterializedProjection<T>({
        directory: read.persistentDirectory,
        pointerKey: read.pointerKey,
      });
      if (!current
        || (read.expectedProjectionKey && current.projectionKey !== read.expectedProjectionKey)
        || !read.validate(current.value, current.identity)) return undefined;
      return {
        projectionKey: current.projectionKey,
        identity: current.identity,
        value: retain(current.projectionKey, current.value, Number.POSITIVE_INFINITY),
      };
    },
  };
};

const PERSISTENT_CACHE_CONTRACT = "project-analysis-persistent-cache@1";
const MATERIALIZED_PROJECTION_CONTRACT = "project-overview-materialized-projection@2";
const MATERIALIZED_POINTER_CONTRACT = "project-overview-current-pointer@1";
const MATERIALIZED_FILE_LOCK_CONTRACT = "project-overview-file-lock@2";
const MATERIALIZED_POINTER_LOCK_CONTRACT = "project-overview-pointer-lock@1";
const MATERIALIZED_RECOVERY_LOCK_CONTRACT = "project-overview-recovery-lock@1";
const PREWARM_OUTCOME_SIDECAR_CONTRACT = "energyiq-analysis-context-prewarm-outcome-sidecar@1";
const MATERIALIZED_FILE_LOCK_STALE_MS = 30_000;

const persistentResultPath = (directory: string, key: string): string => join(
  directory,
  `${createHash("sha256").update(key).digest("hex")}.json`,
);

const materializedProjectionPath = (directory: string, projectionKey: string): string => join(
  directory,
  `managed-${createHash("sha256").update(projectionKey).digest("hex")}.json`,
);

const materializedPointerPath = (directory: string, pointerKey: string): string => join(
  directory,
  `current-${createHash("sha256").update(pointerKey).digest("hex")}.json`,
);

const prewarmOutcomeSidecarPath = (directory: string, pointerKey: string): string => join(
  directory,
  `prewarm-${createHash("sha256").update(pointerKey).digest("hex")}.json`,
);
const prewarmOutcomeWrites = new Map<string, Promise<void>>();

export const writeProjectAnalysisPrewarmOutcomeSidecar = async <T>(input: {
  directory: string;
  pointerKey: string;
  value: T;
}): Promise<void> => {
  requireMaterializedProjectionPath(input.directory);
  requireMaterializedProjectionKey(input.pointerKey);
  const target = prewarmOutcomeSidecarPath(input.directory, input.pointerKey);
  const previous = prewarmOutcomeWrites.get(target) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(() => atomicWriteJson({
    directory: input.directory,
    target,
    value: {
      contract: PREWARM_OUTCOME_SIDECAR_CONTRACT,
      pointerKey: input.pointerKey,
      value: input.value,
    },
  }));
  prewarmOutcomeWrites.set(target, next);
  try {
    await next;
  } finally {
    if (prewarmOutcomeWrites.get(target) === next) prewarmOutcomeWrites.delete(target);
  }
};

export const readProjectAnalysisPrewarmOutcomeSidecar = async <T>(input: {
  directory: string;
  pointerKey: string;
  validate: (value: unknown) => value is T;
}): Promise<T | undefined> => {
  requireMaterializedProjectionPath(input.directory);
  requireMaterializedProjectionKey(input.pointerKey);
  try {
    const parsed = JSON.parse(await readFile(
      prewarmOutcomeSidecarPath(input.directory, input.pointerKey),
      "utf8",
    )) as unknown;
    if (!isRecord(parsed)
      || parsed.contract !== PREWARM_OUTCOME_SIDECAR_CONTRACT
      || parsed.pointerKey !== input.pointerKey
      || !("value" in parsed)
      || !input.validate(parsed.value)) return undefined;
    return parsed.value;
  } catch {
    return undefined;
  }
};

const readPersistentResult = async <T>(input: {
  directory: string;
  key: string;
  now: number;
}): Promise<{ value: T; expiresAt: number } | undefined> => {
  try {
    const parsed = JSON.parse(await readFile(
      persistentResultPath(input.directory, input.key),
      "utf8",
    )) as unknown;
    if (!isRecord(parsed)
      || parsed.contract !== PERSISTENT_CACHE_CONTRACT
      || parsed.key !== input.key
      || typeof parsed.expiresAt !== "number"
      || parsed.expiresAt <= input.now
      || !("value" in parsed)) return undefined;
    return { value: parsed.value as T, expiresAt: parsed.expiresAt };
  } catch {
    return undefined;
  }
};

const writePersistentResult = async <T>(input: {
  directory: string;
  key: string;
  value: T;
  expiresAt: number;
  capacity: number;
}): Promise<void> => {
  const target = persistentResultPath(input.directory, input.key);
  const temporary = join(input.directory, `.${randomUUID()}.tmp`);
  try {
    await mkdir(input.directory, { recursive: true });
    await writeFile(temporary, JSON.stringify({
      contract: PERSISTENT_CACHE_CONTRACT,
      key: input.key,
      expiresAt: input.expiresAt,
      value: input.value,
    }), { encoding: "utf8", mode: 0o600 });
    await rename(temporary, target);
    await prunePersistentResults(input.directory, input.capacity);
  } catch {
    await unlink(temporary).catch(() => undefined);
  }
};

const prunePersistentResults = async (directory: string, capacity: number): Promise<void> => {
  try {
    const entries = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /^[a-f0-9]{64}\.json$/u.test(entry.name));
    if (entries.length <= capacity) return;
    const candidates = await Promise.all(entries.map(async (entry) => ({
      path: join(directory, entry.name),
      mtimeMs: (await stat(join(directory, entry.name))).mtimeMs,
    })));
    candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
    await Promise.all(candidates.slice(capacity).map((entry) => (
      unlink(entry.path).catch(() => undefined)
    )));
  } catch {
    // Persistence is an optimization. A cache cleanup failure must not suppress trusted facts.
  }
};

const readCurrentMaterializedProjection = async <T>(input: {
  directory: string;
  pointerKey: string;
}): Promise<MaterializedProjectOverviewProjection<T> | undefined> => {
  const pointer = await readCurrentMaterializedProjectionPointer(input);
  if (!pointer) return undefined;
  return readMaterializedProjection<T>({
    directory: input.directory,
    projectionKey: pointer.projectionKey,
  });
};

const readCurrentMaterializedProjectionPointer = async (input: {
  directory: string;
  pointerKey: string;
}): Promise<{ projectionKey: string } | undefined> => {
  try {
    const pointer = JSON.parse(await readFile(
      materializedPointerPath(input.directory, input.pointerKey),
      "utf8",
    )) as unknown;
    if (!isRecord(pointer)
      || pointer.contract !== MATERIALIZED_POINTER_CONTRACT
      || pointer.pointerKey !== input.pointerKey
      || typeof pointer.projectionKey !== "string"
      || pointer.projectionKey.length === 0) return undefined;
    return { projectionKey: pointer.projectionKey };
  } catch {
    return undefined;
  }
};

const readMaterializedProjection = async <T>(input: {
  directory: string;
  projectionKey: string;
}): Promise<MaterializedProjectOverviewProjection<T> | undefined> => {
  const projection = await readMaterializedProjectionFile<T>(
    materializedProjectionPath(input.directory, input.projectionKey),
  );
  return projection?.projectionKey === input.projectionKey ? projection : undefined;
};

const readAllMaterializedProjections = async <T>(
  directory: string,
): Promise<Array<MaterializedProjectOverviewProjection<T>>> => {
  try {
    const entries = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /^managed-[a-f0-9]{64}\.json$/u.test(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name));
    const projections = await Promise.all(entries.map((entry) => (
      readMaterializedProjectionFile<T>(join(directory, entry.name))
    )));
    return projections.filter((projection): projection is MaterializedProjectOverviewProjection<T> => (
      projection !== undefined
    ));
  } catch {
    return [];
  }
};

const readMaterializedProjectionFile = async <T>(
  path: string,
): Promise<MaterializedProjectOverviewProjection<T> | undefined> => {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!isRecord(parsed)
      || parsed.contract !== MATERIALIZED_PROJECTION_CONTRACT
      || typeof parsed.projectionKey !== "string"
      || materializedProjectionPath(dirname(path), parsed.projectionKey) !== path
      || !isProjectOverviewProjectionIdentity(parsed.identity)
      || createProjectOverviewProjectionKey(parsed.identity) !== parsed.projectionKey
      || typeof parsed.valueSha256 !== "string"
      || !/^[a-f0-9]{64}$/u.test(parsed.valueSha256)
      || !("value" in parsed)) return undefined;
    if (sha256Json(parsed.value) !== parsed.valueSha256) return undefined;
    return {
      projectionKey: parsed.projectionKey,
      identity: parsed.identity,
      value: parsed.value as T,
    };
  } catch {
    return undefined;
  }
};

const writeMaterializedProjection = async <T>(input: {
  directory: string;
  projectionKey: string;
  identity: ProjectOverviewProjectionIdentity;
  value: T;
}): Promise<void> => atomicWriteJson({
  directory: input.directory,
  target: materializedProjectionPath(input.directory, input.projectionKey),
  value: {
    contract: MATERIALIZED_PROJECTION_CONTRACT,
    projectionKey: input.projectionKey,
    identity: input.identity,
    valueSha256: sha256Json(input.value),
    value: input.value,
  },
});

const writeCurrentMaterializedProjectionPointer = async (input: {
  directory: string;
  pointerKey: string;
  projectionKey: string;
}): Promise<void> => atomicWriteJson({
  directory: input.directory,
  target: materializedPointerPath(input.directory, input.pointerKey),
  value: {
    contract: MATERIALIZED_POINTER_CONTRACT,
    pointerKey: input.pointerKey,
    projectionKey: input.projectionKey,
  },
});

const publishCurrentMaterializedProjectionPointer = async (input: {
  directory: string;
  pointerKey: string;
  projectionKey: string;
  expectedCurrentProjectionKey: string | null;
  validateBeforePublish?: () => Promise<boolean>;
  beforePublish?: (publication: {
    previousProjectionKey: string | null;
    candidateProjectionKey: string;
  }) => Promise<void>;
}): Promise<void> => withMaterializedPointerLock(input, async () => {
  const current = await readCurrentMaterializedProjectionPointer({
    directory: input.directory,
    pointerKey: input.pointerKey,
  });
  if (input.validateBeforePublish && !await input.validateBeforePublish()) {
    throw new Error("ENERGYIQ_OVERVIEW_PROJECTION_STALE");
  }
  if ((current?.projectionKey ?? null) !== input.expectedCurrentProjectionKey
    && current?.projectionKey !== input.projectionKey) {
    throw new Error("ENERGYIQ_OVERVIEW_PROJECTION_POINTER_CHANGED");
  }
  await input.beforePublish?.({
    previousProjectionKey: current?.projectionKey ?? null,
    candidateProjectionKey: input.projectionKey,
  });
  await writeCurrentMaterializedProjectionPointer(input);
});

const restoreCurrentMaterializedProjectionPointer = async (input: {
  directory: string;
  pointerKey: string;
  expectedCurrentProjectionKey: string | null;
  targetProjectionKey: string | null;
}): Promise<void> => withMaterializedPointerLock(input, async () => {
  const current = await readCurrentMaterializedProjectionPointer(input);
  const currentProjectionKey = current?.projectionKey ?? null;
  if (currentProjectionKey !== input.expectedCurrentProjectionKey
    && currentProjectionKey !== input.targetProjectionKey) {
    throw new Error("ENERGYIQ_OVERVIEW_PROJECTION_POINTER_CHANGED");
  }
  if (input.targetProjectionKey) {
    await writeCurrentMaterializedProjectionPointer({
      ...input,
      projectionKey: input.targetProjectionKey,
    });
    return;
  }
  await unlink(materializedPointerPath(input.directory, input.pointerKey)).catch((error: unknown) => {
    if (!isRecord(error) || error.code !== "ENOENT") throw error;
  });
});

const withMaterializedPointerLock = async <T>(
  input: { directory: string; pointerKey: string },
  operation: () => Promise<T>,
): Promise<T> => withMaterializedFileLock({
  directory: input.directory,
  lockPath: `${materializedPointerPath(input.directory, input.pointerKey)}.lock`,
  attempts: 500,
  busyError: "ENERGYIQ_OVERVIEW_PROJECTION_POINTER_BUSY",
}, operation);

const withCurrentOverviewMaterializationLock = async <T>(
  input: { directory: string; pointerKey: string },
  operation: () => Promise<T>,
): Promise<T> => withMaterializedFileLock({
  directory: input.directory,
  lockPath: `${materializedPointerPath(input.directory, input.pointerKey)}.materialization.lock`,
  attempts: 12_000,
  busyError: "ENERGYIQ_OVERVIEW_PROJECTION_MATERIALIZATION_BUSY",
}, operation);

const withMaterializedFileLock = async <T>(
  input: { directory: string; lockPath: string; attempts: number; busyError: string },
  operation: () => Promise<T>,
): Promise<T> => {
  await mkdir(input.directory, { recursive: true });
  let lock: MaterializedFileLockOwner | undefined;
  for (let attempt = 0; attempt < input.attempts; attempt += 1) {
    lock = await tryAcquireMaterializedFileLock(input.directory, input.lockPath);
    if (lock) break;
    const recoveryState = await inspectMaterializedLockForRecovery(
      input.lockPath,
      MATERIALIZED_POINTER_LOCK_CONTRACT,
    );
    if (recoveryState.status === "missing") continue;
    if (recoveryState.status === "stale"
      && await recoverStaleMaterializedLock(input.directory, input.lockPath)) continue;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  if (!lock) throw new Error(input.busyError);
  try {
    return await operation();
  } finally {
    await releaseMaterializedFileLock(input.directory, lock);
  }
};

type MaterializedFileLockOwner = {
  lockPath: string;
  claimPath: string;
  token: string;
};

type MaterializedFileLockMetadata = {
  contract: typeof MATERIALIZED_FILE_LOCK_CONTRACT;
  token: string;
  pid: number;
  createdAt: string;
};

const tryAcquireMaterializedFileLock = async (
  directory: string,
  lockPath: string,
): Promise<MaterializedFileLockOwner | undefined> => {
  const token = randomUUID();
  const claimPath = `${lockPath}.claim-${token}`;
  const metadata: MaterializedFileLockMetadata = {
    contract: MATERIALIZED_FILE_LOCK_CONTRACT,
    token,
    pid: process.pid,
    createdAt: new Date().toISOString(),
  };
  let claim: Awaited<ReturnType<typeof open>> | undefined;
  let linked = false;
  try {
    claim = await open(claimPath, "wx", 0o600);
    await claim.writeFile(JSON.stringify(metadata), { encoding: "utf8" });
    await claim.sync();
    await claim.close();
    claim = undefined;
    try {
      await link(claimPath, lockPath);
      linked = true;
    } catch (error) {
      if (isNodeError(error) && error.code === "EEXIST") return undefined;
      throw error;
    }
    await syncMaterializedDirectory(directory);
    return { lockPath, claimPath, token };
  } catch (error) {
    if (linked) {
      await releaseMaterializedFileLock(directory, { lockPath, claimPath, token })
        .catch(() => undefined);
    }
    throw error;
  } finally {
    await claim?.close().catch(() => undefined);
    await unlink(claimPath).catch(() => undefined);
  }
};

const releaseMaterializedFileLock = async (
  directory: string,
  owner: MaterializedFileLockOwner,
): Promise<void> => {
  let serialized: string;
  try {
    serialized = await readFile(owner.lockPath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch {
    return;
  }
  if (!isCurrentMaterializedFileLock(parsed) || parsed.token !== owner.token) return;
  try {
    await unlink(owner.lockPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    throw error;
  }
  await unlink(owner.claimPath).catch(() => undefined);
  await syncMaterializedDirectory(directory);
};

const recoverStaleMaterializedLock = async (
  directory: string,
  lockPath: string,
): Promise<boolean> => {
  const recoveryLockPath = `${lockPath}.recovery`;
  let recoveryLock: MaterializedFileLockOwner | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    recoveryLock = await tryAcquireMaterializedFileLock(directory, recoveryLockPath);
    if (recoveryLock) break;
    if (attempt > 0 || !await recoverStaleRecoveryLock(recoveryLockPath)) return false;
  }
  if (!recoveryLock) return false;
  try {
    return await recoverStaleMaterializedLockPath(
      lockPath,
      MATERIALIZED_POINTER_LOCK_CONTRACT,
    );
  } finally {
    await releaseMaterializedFileLock(directory, recoveryLock);
  }
};

const recoverStaleRecoveryLock = async (recoveryLockPath: string): Promise<boolean> => {
  return recoverStaleMaterializedLockPath(
    recoveryLockPath,
    MATERIALIZED_RECOVERY_LOCK_CONTRACT,
  );
};

const recoverStaleMaterializedLockPath = async (
  lockPath: string,
  legacyContract: typeof MATERIALIZED_POINTER_LOCK_CONTRACT
    | typeof MATERIALIZED_RECOVERY_LOCK_CONTRACT,
): Promise<boolean> => {
  const recoveryState = await inspectMaterializedLockForRecovery(lockPath, legacyContract);
  if (recoveryState.status === "missing") return true;
  if (recoveryState.status === "held") return false;
  const orphanedPath = `${lockPath}.orphaned-${randomUUID()}`;
  try {
    await rename(lockPath, orphanedPath);
    await unlink(orphanedPath).catch(() => undefined);
    if (isCurrentMaterializedFileLock(recoveryState.owner)) {
      await unlink(`${lockPath}.claim-${recoveryState.owner.token}`).catch(() => undefined);
    }
    return true;
  } catch (error) {
    return isNodeError(error) && error.code === "ENOENT";
  }
};

type MaterializedLockRecoveryState =
  | { status: "missing" }
  | { status: "held" }
  | {
      status: "stale";
      owner?: { contract: string; pid: number; createdAt: string; token?: string };
    };

const inspectMaterializedLockForRecovery = async (
  lockPath: string,
  legacyContract: typeof MATERIALIZED_POINTER_LOCK_CONTRACT
    | typeof MATERIALIZED_RECOVERY_LOCK_CONTRACT,
): Promise<MaterializedLockRecoveryState> => {
  let lockStat: Awaited<ReturnType<typeof stat>>;
  try {
    lockStat = await stat(lockPath);
  } catch (error) {
    return isNodeError(error) && error.code === "ENOENT"
      ? { status: "missing" }
      : { status: "held" };
  }
  if (Date.now() - lockStat.mtimeMs <= MATERIALIZED_FILE_LOCK_STALE_MS) {
    return { status: "held" };
  }
  let serialized: string;
  try {
    serialized = await readFile(lockPath, "utf8");
  } catch (error) {
    return isNodeError(error) && error.code === "ENOENT"
      ? { status: "missing" }
      : { status: "held" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized) as unknown;
  } catch {
    return { status: "stale" };
  }
  const owner = materializedFileLockOwnerMetadata(parsed, legacyContract);
  if (!owner) return { status: "stale" };
  const createdAt = Date.parse(owner.createdAt);
  if (!Number.isFinite(createdAt)
    || Date.now() - Math.max(createdAt, lockStat.mtimeMs) <= MATERIALIZED_FILE_LOCK_STALE_MS) {
    return { status: "held" };
  }
  try {
    process.kill(owner.pid, 0);
    return { status: "held" };
  } catch (error) {
    return isNodeError(error) && error.code === "ESRCH"
      ? { status: "stale", owner }
      : { status: "held" };
  }
};

const materializedFileLockOwnerMetadata = (
  value: unknown,
  legacyContract: typeof MATERIALIZED_POINTER_LOCK_CONTRACT
    | typeof MATERIALIZED_RECOVERY_LOCK_CONTRACT,
): { contract: string; pid: number; createdAt: string; token?: string } | undefined => {
  if (!isRecord(value)
    || (value.contract !== MATERIALIZED_FILE_LOCK_CONTRACT && value.contract !== legacyContract)
    || typeof value.pid !== "number"
    || !Number.isSafeInteger(value.pid)
    || value.pid <= 0
    || typeof value.createdAt !== "string"
    || (value.contract === MATERIALIZED_FILE_LOCK_CONTRACT
      && (typeof value.token !== "string" || !/^[a-f0-9-]{36}$/u.test(value.token)))) {
    return undefined;
  }
  return value as { contract: string; pid: number; createdAt: string; token?: string };
};

const isCurrentMaterializedFileLock = (
  value: unknown,
): value is MaterializedFileLockMetadata => materializedFileLockOwnerMetadata(
  value,
  MATERIALIZED_POINTER_LOCK_CONTRACT,
)?.contract === MATERIALIZED_FILE_LOCK_CONTRACT;

const syncMaterializedDirectory = async (directory: string): Promise<void> => {
  if (process.platform === "win32") return;
  const directoryHandle = await open(directory, "r");
  try {
    await directoryHandle.sync();
  } finally {
    await directoryHandle.close();
  }
};

const sha256Json = (value: unknown): string => createHash("sha256")
  .update(JSON.stringify(value))
  .digest("hex");

const atomicWriteJson = async (input: {
  directory: string;
  target: string;
  value: unknown;
}): Promise<void> => {
  const temporary = join(input.directory, `.${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    await mkdir(input.directory, { recursive: true });
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(JSON.stringify(input.value), { encoding: "utf8" });
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, input.target);
    // Linux is the production Release Host and supports directory fsync. NTFS
    // rejects fsync on directory handles with EPERM, while the file itself was
    // already synced before the atomic rename above.
    if (process.platform !== "win32") {
      const directoryHandle = await open(input.directory, "r");
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    }
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
};

const isNodeError = (error: unknown): error is NodeJS.ErrnoException => (
  error instanceof Error && "code" in error
);

const requireMaterializedProjectionPath = (directory: string): void => {
  if (!isAbsolute(directory)) {
    throw new Error("Project analysis persistent cache directory must be absolute.");
  }
};

const requireMaterializedProjectionKey = (value: string): void => {
  if (value.length === 0 || value.trim() !== value) {
    throw new Error("ENERGYIQ_OVERVIEW_PROJECTION_KEY_INVALID");
  }
};

const isProjectOverviewProjectionIdentity = (
  value: unknown,
): value is ProjectOverviewProjectionIdentity => {
  if (!isRecord(value)) return false;
  const requiredStrings: Array<keyof ProjectOverviewProjectionIdentity> = [
    "resolverRevision",
    "workspaceId",
    "projectId",
    "scopeId",
    "resource",
    "period",
    "timezone",
    "from",
    "to",
    "dataSnapshotId",
    "projectReleaseId",
    "reportTimePolicyRevisionId",
    "hierarchyRevisionId",
    "meterMappingRevisionId",
    "meterFormulaRevisionId",
    "metricVersion",
    "businessCalendarVersion",
    "tariffScheduleVersion",
    "overviewDefinitionRevisionId",
    "rendererKey",
    "rendererVersion",
    "rendererContractVersion",
    "recipeId",
    "recipeVersion",
  ];
  if (!requiredStrings.every((key) => (
    typeof value[key] === "string"
    && (value[key] as string).length > 0
    && (value[key] as string).trim() === value[key]
  ))) return false;
  if (value.analysisWindow !== null
    && (typeof value.analysisWindow !== "string" || value.analysisWindow.length === 0)) return false;
  if (value.databasePath !== null
    && (typeof value.databasePath !== "string" || value.databasePath.length === 0)) return false;
  return Array.isArray(value.metricRevisionIds)
    && value.metricRevisionIds.every(isNonEmptyString)
    && Array.isArray(value.ruleRevisionIds)
    && value.ruleRevisionIds.every(isNonEmptyString);
};

const isNonEmptyString = (value: unknown): value is string => (
  typeof value === "string" && value.length > 0 && value.trim() === value
);

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

const deepFreeze = <T>(value: T): T => {
  if (value === null || typeof value !== "object") return value;
  const seen = new WeakSet<object>();
  const visit = (candidate: object): void => {
    if (seen.has(candidate)) return;
    seen.add(candidate);
    for (const property of Reflect.ownKeys(candidate)) {
      const nested = (candidate as Record<PropertyKey, unknown>)[property];
      if (nested !== null && typeof nested === "object") visit(nested);
    }
    Object.freeze(candidate);
  };
  visit(value);
  return value;
};
