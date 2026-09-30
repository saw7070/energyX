import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createProjectAnalysisCacheKey,
  createProjectAnalysisResultCache,
  createProjectOverviewProjectionKey,
  type ProjectAnalysisCacheIdentity,
  type ProjectOverviewProjectionIdentity,
} from "./project-analysis-result-cache.js";

describe("ProjectAnalysisResultCache", () => {
  it("materializes one immutable projection and atomically advances its current pointer", async () => {
    const persistentDirectory = mkdtempSync(join(tmpdir(), "project-overview-materialized-"));
    const cache = createProjectAnalysisResultCache<{ snapshot: { id: string } }>({
      capacity: 2,
      ttlMs: 1,
    });
    const identity = managedIdentity();
    const projectionKey = createProjectOverviewProjectionKey(identity);
    const compute = vi.fn(async () => ({ snapshot: { id: "snapshot-a" } }));
    try {
      await expect(cache.materializeCurrent({
        pointerKey: "workspace-a/project-a/current-overview",
        projectionKey,
        identity,
        persistentDirectory,
        compute,
        validate: (value) => value.snapshot.id === identity.dataSnapshotId,
      })).resolves.toMatchObject({
        changed: true,
        value: { snapshot: { id: "snapshot-a" } },
      });

      await expect(cache.materializeCurrent({
        pointerKey: "workspace-a/project-a/current-overview",
        projectionKey,
        identity,
        persistentDirectory,
        compute,
        validate: (value) => value.snapshot.id === identity.dataSnapshotId,
      })).resolves.toMatchObject({ changed: false });
      expect(compute).toHaveBeenCalledOnce();

      const restarted = createProjectAnalysisResultCache<{ snapshot: { id: string } }>({
        capacity: 2,
        ttlMs: 1,
      });
      await expect(restarted.readCurrent({
        pointerKey: "workspace-a/project-a/current-overview",
        persistentDirectory,
        validate: (value, restoredIdentity) => (
          value.snapshot.id === restoredIdentity.dataSnapshotId
        ),
      })).resolves.toMatchObject({
        projectionKey,
        identity,
        value: { snapshot: { id: "snapshot-a" } },
      });
    } finally {
      rmSync(persistentDirectory, { recursive: true, force: true });
    }
  });

  it("restores the exact previous pointer after a candidate pointer was already published", async () => {
    const persistentDirectory = mkdtempSync(join(tmpdir(), "project-overview-pointer-rollback-"));
    const pointerKey = "workspace-a/project-a/current-overview";
    const cache = createProjectAnalysisResultCache<{ snapshot: { id: string } }>({
      capacity: 2,
      ttlMs: 1,
    });
    const previousIdentity = managedIdentity();
    const candidateIdentity = { ...previousIdentity, dataSnapshotId: "snapshot-b" };
    const previousProjectionKey = createProjectOverviewProjectionKey(previousIdentity);
    const candidateProjectionKey = createProjectOverviewProjectionKey(candidateIdentity);
    let observedPublication: {
      previousProjectionKey: string | null;
      candidateProjectionKey: string;
    } | undefined;
    try {
      await cache.materializeCurrent({
        pointerKey,
        projectionKey: previousProjectionKey,
        identity: previousIdentity,
        persistentDirectory,
        compute: async () => ({ snapshot: { id: "snapshot-a" } }),
        validate: (value, identity) => value.snapshot.id === identity.dataSnapshotId,
      });
      await cache.materializeCurrent({
        pointerKey,
        projectionKey: candidateProjectionKey,
        identity: candidateIdentity,
        persistentDirectory,
        compute: async () => ({ snapshot: { id: "snapshot-b" } }),
        validate: (value, identity) => value.snapshot.id === identity.dataSnapshotId,
        beforePublish: async (publication) => {
          observedPublication = publication;
        },
      });
      expect(observedPublication).toEqual({
        previousProjectionKey,
        candidateProjectionKey,
      });
      await expect(cache.readCurrent({
        pointerKey,
        persistentDirectory,
        validate: (value, identity) => value.snapshot.id === identity.dataSnapshotId,
      })).resolves.toMatchObject({ projectionKey: candidateProjectionKey });

      const restarted = createProjectAnalysisResultCache<{ snapshot: { id: string } }>({
        capacity: 2,
        ttlMs: 1,
      });
      await restarted.restoreCurrent({
        pointerKey,
        persistentDirectory,
        expectedCurrentProjectionKey: candidateProjectionKey,
        targetProjectionKey: previousProjectionKey,
      });
      await expect(restarted.readCurrent({
        pointerKey,
        persistentDirectory,
        validate: (value, identity) => value.snapshot.id === identity.dataSnapshotId,
      })).resolves.toMatchObject({
        projectionKey: previousProjectionKey,
        identity: { dataSnapshotId: "snapshot-a" },
      });
    } finally {
      rmSync(persistentDirectory, { recursive: true, force: true });
    }
  });

  it("keeps first publication absent when recovery runs before its candidate pointer write", async () => {
    const persistentDirectory = mkdtempSync(join(tmpdir(), "project-overview-first-pointer-rollback-"));
    const pointerKey = "workspace-a/project-a/current-overview";
    const cache = createProjectAnalysisResultCache<{ snapshot: { id: string } }>({
      capacity: 2,
      ttlMs: 1,
    });
    const candidateProjectionKey = createProjectOverviewProjectionKey(managedIdentity());
    try {
      await expect(cache.restoreCurrent({
        pointerKey,
        persistentDirectory,
        expectedCurrentProjectionKey: candidateProjectionKey,
        targetProjectionKey: null,
      })).resolves.toBeUndefined();
      await expect(cache.readCurrent({
        pointerKey,
        persistentDirectory,
        validate: () => true,
      })).resolves.toBeUndefined();
    } finally {
      rmSync(persistentDirectory, { recursive: true, force: true });
    }
  });

  it("keeps the prior current projection when the next materialization fails validation", async () => {
    const persistentDirectory = mkdtempSync(join(tmpdir(), "project-overview-materialized-fail-"));
    const cache = createProjectAnalysisResultCache<{ snapshot: { id: string } }>({
      capacity: 2,
      ttlMs: 1,
    });
    const previousIdentity = managedIdentity();
    const nextIdentity = { ...previousIdentity, dataSnapshotId: "snapshot-b" };
    try {
      await cache.materializeCurrent({
        pointerKey: "workspace-a/project-a/current-overview",
        projectionKey: createProjectOverviewProjectionKey(previousIdentity),
        identity: previousIdentity,
        persistentDirectory,
        compute: async () => ({ snapshot: { id: "snapshot-a" } }),
        validate: (value, identity) => value.snapshot.id === identity.dataSnapshotId,
      });

      await expect(cache.materializeCurrent({
        pointerKey: "workspace-a/project-a/current-overview",
        projectionKey: createProjectOverviewProjectionKey(nextIdentity),
        identity: nextIdentity,
        persistentDirectory,
        compute: async () => ({ snapshot: { id: "wrong-snapshot" } }),
        validate: (value, identity) => value.snapshot.id === identity.dataSnapshotId,
      })).rejects.toThrow("ENERGYIQ_OVERVIEW_PROJECTION_VALIDATION_FAILED");

      await expect(cache.readCurrent({
        pointerKey: "workspace-a/project-a/current-overview",
        persistentDirectory,
        validate: (value, identity) => value.snapshot.id === identity.dataSnapshotId,
      })).resolves.toMatchObject({
        identity: { dataSnapshotId: "snapshot-a" },
        value: { snapshot: { id: "snapshot-a" } },
      });
    } finally {
      rmSync(persistentDirectory, { recursive: true, force: true });
    }
  });

  it("keeps the prior current projection when a candidate becomes stale before publication", async () => {
    const persistentDirectory = mkdtempSync(join(tmpdir(), "project-overview-materialized-stale-"));
    const cache = createProjectAnalysisResultCache<{ snapshot: { id: string } }>({
      capacity: 2,
      ttlMs: 1,
    });
    const previousIdentity = managedIdentity();
    const nextIdentity = { ...previousIdentity, dataSnapshotId: "snapshot-b" };
    try {
      await cache.materializeCurrent({
        pointerKey: "workspace-a/project-a/current-overview",
        projectionKey: createProjectOverviewProjectionKey(previousIdentity),
        identity: previousIdentity,
        persistentDirectory,
        compute: async () => ({ snapshot: { id: "snapshot-a" } }),
        validate: (value, identity) => value.snapshot.id === identity.dataSnapshotId,
      });

      await expect(cache.materializeCurrent({
        pointerKey: "workspace-a/project-a/current-overview",
        projectionKey: createProjectOverviewProjectionKey(nextIdentity),
        identity: nextIdentity,
        persistentDirectory,
        compute: async () => ({ snapshot: { id: "snapshot-b" } }),
        validate: (value, identity) => value.snapshot.id === identity.dataSnapshotId,
        validateBeforePublish: async () => false,
      })).rejects.toThrow("ENERGYIQ_OVERVIEW_PROJECTION_STALE");

      await expect(cache.readCurrent({
        pointerKey: "workspace-a/project-a/current-overview",
        persistentDirectory,
        validate: (value, identity) => value.snapshot.id === identity.dataSnapshotId,
      })).resolves.toMatchObject({
        identity: { dataSnapshotId: "snapshot-a" },
        value: { snapshot: { id: "snapshot-a" } },
      });
    } finally {
      rmSync(persistentDirectory, { recursive: true, force: true });
    }
  });

  it("explicitly recomputes one identity without publishing nondeterministic replacement bytes", async () => {
    const persistentDirectory = mkdtempSync(join(tmpdir(), "project-overview-recompute-"));
    const cache = createProjectAnalysisResultCache<{ snapshot: { id: string }; total: number }>({
      capacity: 2,
      ttlMs: 1,
    });
    const identity = managedIdentity();
    const projectionKey = createProjectOverviewProjectionKey(identity);
    const compute = vi.fn(async () => ({ snapshot: { id: "snapshot-a" }, total: 42 }));
    try {
      await cache.materializeCurrent({
        pointerKey: "workspace-a/project-a/current-overview",
        projectionKey,
        identity,
        persistentDirectory,
        compute,
        validate: (value) => value.snapshot.id === identity.dataSnapshotId,
      });

      await expect(cache.materializeCurrent({
        pointerKey: "workspace-a/project-a/current-overview",
        projectionKey,
        identity,
        persistentDirectory,
        forceRecompute: true,
        compute,
        validate: (value) => value.snapshot.id === identity.dataSnapshotId,
      })).resolves.toMatchObject({ changed: false, value: { total: 42 } });
      expect(compute).toHaveBeenCalledTimes(2);

      await expect(cache.materializeCurrent({
        pointerKey: "workspace-a/project-a/current-overview",
        projectionKey,
        identity,
        persistentDirectory,
        forceRecompute: true,
        compute: async () => ({ snapshot: { id: "snapshot-a" }, total: 43 }),
        validate: (value) => value.snapshot.id === identity.dataSnapshotId,
      })).rejects.toThrow("ENERGYIQ_OVERVIEW_PROJECTION_NONDETERMINISTIC");
      await expect(cache.readCurrent({
        pointerKey: "workspace-a/project-a/current-overview",
        persistentDirectory,
        validate: (value) => value.snapshot.id === identity.dataSnapshotId,
      })).resolves.toMatchObject({ value: { total: 42 } });
    } finally {
      rmSync(persistentDirectory, { recursive: true, force: true });
    }
  });

  it("fails a corrupt same-identity automatic materialization closed until explicit recompute", async () => {
    const persistentDirectory = mkdtempSync(join(tmpdir(), "project-overview-repair-"));
    const cache = createProjectAnalysisResultCache<{ snapshot: { id: string } }>({
      capacity: 2,
      ttlMs: 1,
    });
    const identity = managedIdentity();
    const projectionKey = createProjectOverviewProjectionKey(identity);
    const pointerKey = "workspace-a/project-a/current-overview";
    const projectionPath = join(
      persistentDirectory,
      `managed-${createHash("sha256").update(projectionKey).digest("hex")}.json`,
    );
    const pointerPath = join(
      persistentDirectory,
      `current-${createHash("sha256").update(pointerKey).digest("hex")}.json`,
    );
    try {
      await cache.materializeCurrent({
        pointerKey,
        projectionKey,
        identity,
        persistentDirectory,
        compute: async () => ({ snapshot: { id: "snapshot-a" } }),
        validate: (value) => value.snapshot.id === identity.dataSnapshotId,
      });
      writeFileSync(projectionPath, "{corrupt", "utf8");
      const corruptProjection = readFileSync(projectionPath, "utf8");
      const currentPointer = readFileSync(pointerPath, "utf8");
      const automaticCompute = vi.fn(async () => ({ snapshot: { id: "snapshot-a" } }));

      await expect(cache.materializeCurrent({
        pointerKey,
        projectionKey,
        identity,
        persistentDirectory,
        compute: automaticCompute,
        validate: (value) => value.snapshot.id === identity.dataSnapshotId,
      })).rejects.toThrow("ENERGYIQ_OVERVIEW_PROJECTION_REPAIR_REQUIRES_FORCE");
      expect(automaticCompute).not.toHaveBeenCalled();
      expect(readFileSync(projectionPath, "utf8")).toBe(corruptProjection);
      expect(readFileSync(pointerPath, "utf8")).toBe(currentPointer);

      await expect(cache.materializeCurrent({
        pointerKey,
        projectionKey,
        identity,
        persistentDirectory,
        forceRecompute: true,
        compute: async () => ({ snapshot: { id: "snapshot-a" } }),
        validate: (value) => value.snapshot.id === identity.dataSnapshotId,
      })).resolves.toMatchObject({ changed: true });
      await expect(cache.readCurrent({
        pointerKey,
        persistentDirectory,
        validate: (value) => value.snapshot.id === identity.dataSnapshotId,
      })).resolves.toMatchObject({ value: { snapshot: { id: "snapshot-a" } } });
    } finally {
      rmSync(persistentDirectory, { recursive: true, force: true });
    }
  });

  it("rejects a structurally valid projection whose persisted payload bytes were changed", async () => {
    const persistentDirectory = mkdtempSync(join(tmpdir(), "project-overview-integrity-"));
    const cache = createProjectAnalysisResultCache<{ snapshot: { id: string }; total: number }>({
      capacity: 2,
      ttlMs: 1,
    });
    const identity = managedIdentity();
    const projectionKey = createProjectOverviewProjectionKey(identity);
    const pointerKey = "workspace-a/project-a/current-overview";
    const projectionPath = join(
      persistentDirectory,
      `managed-${createHash("sha256").update(projectionKey).digest("hex")}.json`,
    );
    try {
      await cache.materializeCurrent({
        pointerKey,
        projectionKey,
        identity,
        persistentDirectory,
        compute: async () => ({ snapshot: { id: "snapshot-a" }, total: 42 }),
        validate: (value) => value.snapshot.id === identity.dataSnapshotId,
      });
      const stored = JSON.parse(readFileSync(projectionPath, "utf8")) as {
        value: { total: number };
      };
      stored.value.total = 43;
      writeFileSync(projectionPath, JSON.stringify(stored), "utf8");

      await expect(cache.readCurrent({
        pointerKey,
        persistentDirectory,
        validate: (value) => value.snapshot.id === identity.dataSnapshotId,
      })).resolves.toBeUndefined();
    } finally {
      rmSync(persistentDirectory, { recursive: true, force: true });
    }
  });

  it("recovers a stale pointer lock left by a dead materializer", async () => {
    const persistentDirectory = mkdtempSync(join(tmpdir(), "project-overview-stale-lock-"));
    const cache = createProjectAnalysisResultCache<{ snapshot: { id: string } }>({
      capacity: 2,
      ttlMs: 1,
    });
    const identity = managedIdentity();
    const pointerKey = "workspace-a/project-a/current-overview";
    const lockPath = join(
      persistentDirectory,
      `current-${createHash("sha256").update(pointerKey).digest("hex")}.json.lock`,
    );
    try {
      writeFileSync(lockPath, JSON.stringify({
        contract: "project-overview-pointer-lock@1",
        pid: 2_147_483_647,
        createdAt: "2000-01-01T00:00:00.000Z",
      }), "utf8");
      utimesSync(lockPath, new Date("2000-01-01T00:00:00.000Z"), new Date("2000-01-01T00:00:00.000Z"));

      await expect(cache.materializeCurrent({
        pointerKey,
        projectionKey: createProjectOverviewProjectionKey(identity),
        identity,
        persistentDirectory,
        compute: async () => ({ snapshot: { id: "snapshot-a" } }),
        validate: (value) => value.snapshot.id === identity.dataSnapshotId,
      })).resolves.toMatchObject({ changed: true });
    } finally {
      rmSync(persistentDirectory, { recursive: true, force: true });
    }
  });

  it("recovers a stale malformed pointer lock left before owner metadata was durable", async () => {
    const persistentDirectory = mkdtempSync(join(tmpdir(), "project-overview-malformed-lock-"));
    const cache = createProjectAnalysisResultCache<{ snapshot: { id: string } }>({
      capacity: 2,
      ttlMs: 1,
    });
    const identity = managedIdentity();
    const pointerKey = "workspace-a/project-a/current-overview";
    const lockPath = join(
      persistentDirectory,
      `current-${createHash("sha256").update(pointerKey).digest("hex")}.json.lock`,
    );
    try {
      writeFileSync(lockPath, "{", "utf8");
      utimesSync(lockPath, new Date("2000-01-01T00:00:00.000Z"), new Date("2000-01-01T00:00:00.000Z"));

      await expect(cache.materializeCurrent({
        pointerKey,
        projectionKey: createProjectOverviewProjectionKey(identity),
        identity,
        persistentDirectory,
        compute: async () => ({ snapshot: { id: "snapshot-a" } }),
        validate: (value) => value.snapshot.id === identity.dataSnapshotId,
      })).resolves.toMatchObject({ changed: true });
    } finally {
      rmSync(persistentDirectory, { recursive: true, force: true });
    }
  });

  it("recovers a stale recovery lock left by a dead lock reclaimer", async () => {
    const persistentDirectory = mkdtempSync(join(tmpdir(), "project-overview-stale-recovery-lock-"));
    const cache = createProjectAnalysisResultCache<{ snapshot: { id: string } }>({
      capacity: 2,
      ttlMs: 1,
    });
    const identity = managedIdentity();
    const pointerKey = "workspace-a/project-a/current-overview";
    const lockPath = join(
      persistentDirectory,
      `current-${createHash("sha256").update(pointerKey).digest("hex")}.json.lock`,
    );
    try {
      writeFileSync(lockPath, "{", "utf8");
      writeFileSync(`${lockPath}.recovery`, "{", "utf8");
      const stale = new Date("2000-01-01T00:00:00.000Z");
      utimesSync(lockPath, stale, stale);
      utimesSync(`${lockPath}.recovery`, stale, stale);

      await expect(cache.materializeCurrent({
        pointerKey,
        projectionKey: createProjectOverviewProjectionKey(identity),
        identity,
        persistentDirectory,
        compute: async () => ({ snapshot: { id: "snapshot-a" } }),
        validate: (value) => value.snapshot.id === identity.dataSnapshotId,
      })).resolves.toMatchObject({ changed: true });
    } finally {
      rmSync(persistentDirectory, { recursive: true, force: true });
    }
  }, 10_000);

  it("never exposes incomplete live-owner metadata as a reclaimable materialization lock", async () => {
    const persistentDirectory = mkdtempSync(join(tmpdir(), "project-overview-live-owner-lock-"));
    const realNow = Date.now();
    const firstMetadataWriteStarted = vi.fn();
    let releaseFirstMetadata!: () => void;
    let releaseFirstCompute!: () => void;
    let releaseSecondCompute!: () => void;
    const firstMetadataGate = new Promise<void>((resolve) => {
      releaseFirstMetadata = resolve;
    });
    const firstComputeGate = new Promise<void>((resolve) => {
      releaseFirstCompute = resolve;
    });
    const secondComputeGate = new Promise<void>((resolve) => {
      releaseSecondCompute = resolve;
    });
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    let delayNextExclusiveMetadataWrite = true;
    vi.resetModules();
    vi.doMock("node:fs/promises", () => ({
      ...actualFs,
      open: async (
        path: Parameters<typeof actualFs.open>[0],
        flags: Parameters<typeof actualFs.open>[1],
        mode?: Parameters<typeof actualFs.open>[2],
      ) => {
        const handle = await actualFs.open(path, flags, mode);
        if (flags === "wx" && delayNextExclusiveMetadataWrite) {
          delayNextExclusiveMetadataWrite = false;
          const writeFile = handle.writeFile.bind(handle);
          Object.defineProperty(handle, "writeFile", {
            configurable: true,
            value: async (data: string, options: { encoding: BufferEncoding }) => {
              firstMetadataWriteStarted();
              await firstMetadataGate;
              return writeFile(data, options);
            },
          });
        }
        return handle;
      },
    }));
    const isolatedModule = await import("./project-analysis-result-cache.js");
    const firstCache = isolatedModule.createProjectAnalysisResultCache<{
      snapshot: { id: string };
    }>({ capacity: 2, ttlMs: 1 });
    const secondCache = isolatedModule.createProjectAnalysisResultCache<{
      snapshot: { id: string };
    }>({ capacity: 2, ttlMs: 1 });
    const identity = managedIdentity();
    const projectionKey = isolatedModule.createProjectOverviewProjectionKey(identity);
    let active = 0;
    let maximumActive = 0;
    const firstCompute = vi.fn(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await firstComputeGate;
      active -= 1;
      return { snapshot: { id: identity.dataSnapshotId } };
    });
    const secondCompute = vi.fn(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await secondComputeGate;
      active -= 1;
      return { snapshot: { id: identity.dataSnapshotId } };
    });
    const common = {
      pointerKey: "workspace-a/project-a/current-overview",
      projectionKey,
      identity,
      persistentDirectory,
      validate: (value: { snapshot: { id: string } }) => value.snapshot.id === identity.dataSnapshotId,
    };
    try {
      const first = firstCache.materializeCurrent({ ...common, compute: firstCompute });
      await vi.waitFor(() => expect(firstMetadataWriteStarted).toHaveBeenCalledOnce());
      vi.spyOn(Date, "now").mockReturnValue(realNow + 60_000);
      const second = secondCache.materializeCurrent({ ...common, compute: secondCompute });
      await vi.waitFor(() => expect(secondCompute).toHaveBeenCalledOnce());

      releaseFirstMetadata();
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      const firstStartedBeforeSuccessorReleased = firstCompute.mock.calls.length;
      releaseFirstCompute();
      releaseSecondCompute();

      await expect(Promise.all([first, second])).resolves.toHaveLength(2);
      expect(firstStartedBeforeSuccessorReleased).toBe(0);
      expect(maximumActive).toBe(1);
    } finally {
      releaseFirstMetadata();
      releaseFirstCompute();
      releaseSecondCompute();
      vi.restoreAllMocks();
      vi.doUnmock("node:fs/promises");
      vi.resetModules();
      rmSync(persistentDirectory, { recursive: true, force: true });
    }
  }, 10_000);

  it("waits behind a live 45-second owner without creating recovery locks", async () => {
    const persistentDirectory = mkdtempSync(join(tmpdir(), "project-overview-live-owner-wait-"));
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const recoveryLockLinks: string[] = [];
    vi.resetModules();
    vi.doMock("node:fs/promises", () => ({
      ...actualFs,
      link: async (...args: Parameters<typeof actualFs.link>) => {
        if (String(args[1]).endsWith(".recovery")) recoveryLockLinks.push(String(args[1]));
        return actualFs.link(...args);
      },
    }));
    const isolatedModule = await import("./project-analysis-result-cache.js");
    const firstCache = isolatedModule.createProjectAnalysisResultCache<{
      snapshot: { id: string };
    }>({ capacity: 2, ttlMs: 1 });
    const secondCache = isolatedModule.createProjectAnalysisResultCache<{
      snapshot: { id: string };
    }>({ capacity: 2, ttlMs: 1 });
    const identity = managedIdentity();
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstCompute = vi.fn(async () => {
      await firstGate;
      return { snapshot: { id: identity.dataSnapshotId } };
    });
    const secondCompute = vi.fn(async () => ({ snapshot: { id: identity.dataSnapshotId } }));
    const common = {
      pointerKey: "workspace-a/project-a/current-overview",
      projectionKey: isolatedModule.createProjectOverviewProjectionKey(identity),
      identity,
      persistentDirectory,
      validate: (value: { snapshot: { id: string } }) => value.snapshot.id === identity.dataSnapshotId,
    };
    try {
      const first = firstCache.materializeCurrent({ ...common, compute: firstCompute });
      await vi.waitFor(() => expect(firstCompute).toHaveBeenCalledOnce());
      const realNow = Date.now();
      vi.spyOn(Date, "now").mockReturnValue(realNow + 45_000);
      const second = secondCache.materializeCurrent({ ...common, compute: secondCompute });

      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      expect(secondCompute).not.toHaveBeenCalled();
      expect(recoveryLockLinks).toEqual([]);
      releaseFirst();

      await expect(Promise.all([first, second])).resolves.toHaveLength(2);
      expect(secondCompute).not.toHaveBeenCalled();
    } finally {
      releaseFirst();
      vi.restoreAllMocks();
      vi.doUnmock("node:fs/promises");
      vi.resetModules();
      rmSync(persistentDirectory, { recursive: true, force: true });
    }
  }, 10_000);

  it("does not delete a successor materialization lock when an old owner releases", async () => {
    const persistentDirectory = mkdtempSync(join(tmpdir(), "project-overview-successor-lock-"));
    const cache = createProjectAnalysisResultCache<{ snapshot: { id: string } }>({
      capacity: 2,
      ttlMs: 1,
    });
    const identity = managedIdentity();
    const pointerKey = "workspace-a/project-a/current-overview";
    const successorToken = "11111111-1111-4111-8111-111111111111";
    const lockPath = join(
      persistentDirectory,
      `current-${createHash("sha256").update(pointerKey).digest("hex")}.json.materialization.lock`,
    );
    let releaseCompute!: () => void;
    const computeGate = new Promise<void>((resolve) => {
      releaseCompute = resolve;
    });
    const compute = vi.fn(async () => {
      await computeGate;
      return { snapshot: { id: identity.dataSnapshotId } };
    });
    try {
      const materialization = cache.materializeCurrent({
        pointerKey,
        projectionKey: createProjectOverviewProjectionKey(identity),
        identity,
        persistentDirectory,
        compute,
        validate: (value) => value.snapshot.id === identity.dataSnapshotId,
      });
      await vi.waitFor(() => expect(compute).toHaveBeenCalledOnce());
      expect(JSON.parse(readFileSync(lockPath, "utf8"))).toMatchObject({
        contract: "project-overview-file-lock@2",
        token: expect.stringMatching(/^[a-f0-9-]{36}$/u),
        pid: process.pid,
      });
      renameSync(lockPath, `${lockPath}.old-owner`);
      writeFileSync(lockPath, JSON.stringify({
        contract: "project-overview-file-lock@2",
        token: successorToken,
        pid: process.pid,
        createdAt: new Date().toISOString(),
      }), "utf8");
      releaseCompute();

      await expect(materialization).resolves.toMatchObject({ changed: true });
      expect(JSON.parse(readFileSync(lockPath, "utf8"))).toMatchObject({
        token: successorToken,
      });
    } finally {
      releaseCompute();
      rmSync(persistentDirectory, { recursive: true, force: true });
    }
  });

  it("serializes competing identities so an older publication cannot overwrite the newer identity", async () => {
    const persistentDirectory = mkdtempSync(join(tmpdir(), "project-overview-materialized-fenced-"));
    const cache = createProjectAnalysisResultCache<{ snapshot: { id: string } }>({
      capacity: 3,
      ttlMs: 1,
    });
    const initialIdentity = managedIdentity();
    const olderIdentity = { ...initialIdentity, dataSnapshotId: "snapshot-b" };
    const newerIdentity = { ...initialIdentity, dataSnapshotId: "snapshot-c" };
    let releaseOlderValidation!: () => void;
    let olderValidationStarted!: () => void;
    const olderValidationGate = new Promise<void>((resolve) => {
      releaseOlderValidation = resolve;
    });
    const olderValidationObserved = new Promise<void>((resolve) => {
      olderValidationStarted = resolve;
    });
    let authoritativeSnapshotId = olderIdentity.dataSnapshotId;
    try {
      await cache.materializeCurrent({
        pointerKey: "workspace-a/project-a/current-overview",
        projectionKey: createProjectOverviewProjectionKey(initialIdentity),
        identity: initialIdentity,
        persistentDirectory,
        compute: async () => ({ snapshot: { id: initialIdentity.dataSnapshotId } }),
        validate: (value, identity) => value.snapshot.id === identity.dataSnapshotId,
      });

      const older = cache.materializeCurrent({
        pointerKey: "workspace-a/project-a/current-overview",
        projectionKey: createProjectOverviewProjectionKey(olderIdentity),
        identity: olderIdentity,
        persistentDirectory,
        compute: async () => ({ snapshot: { id: olderIdentity.dataSnapshotId } }),
        validate: (value, identity) => value.snapshot.id === identity.dataSnapshotId,
        validateBeforePublish: async () => {
          olderValidationStarted();
          await olderValidationGate;
          return authoritativeSnapshotId === olderIdentity.dataSnapshotId;
        },
      });
      await olderValidationObserved;
      authoritativeSnapshotId = newerIdentity.dataSnapshotId;
      const newer = cache.materializeCurrent({
        pointerKey: "workspace-a/project-a/current-overview",
        projectionKey: createProjectOverviewProjectionKey(newerIdentity),
        identity: newerIdentity,
        persistentDirectory,
        compute: async () => ({ snapshot: { id: newerIdentity.dataSnapshotId } }),
        validate: (value, identity) => value.snapshot.id === identity.dataSnapshotId,
        validateBeforePublish: async () => authoritativeSnapshotId === newerIdentity.dataSnapshotId,
      });
      releaseOlderValidation();

      await expect(older).rejects.toThrow("ENERGYIQ_OVERVIEW_PROJECTION_STALE");
      await expect(newer).resolves.toMatchObject({ changed: true });
      await expect(cache.readCurrent({
        pointerKey: "workspace-a/project-a/current-overview",
        persistentDirectory,
        expectedProjectionKey: createProjectOverviewProjectionKey(newerIdentity),
        validate: (value, identity) => value.snapshot.id === identity.dataSnapshotId,
      })).resolves.toMatchObject({
        identity: { dataSnapshotId: newerIdentity.dataSnapshotId },
        value: { snapshot: { id: newerIdentity.dataSnapshotId } },
      });
    } finally {
      rmSync(persistentDirectory, { recursive: true, force: true });
    }
  });

  it("fails closed when the current pointer does not match the caller's full expected identity", async () => {
    const persistentDirectory = mkdtempSync(join(tmpdir(), "project-overview-materialized-exact-"));
    const cache = createProjectAnalysisResultCache<{ snapshot: { id: string } }>({
      capacity: 2,
      ttlMs: 1,
    });
    const identity = managedIdentity();
    try {
      await cache.materializeCurrent({
        pointerKey: "workspace-a/project-a/current-overview",
        projectionKey: createProjectOverviewProjectionKey(identity),
        identity,
        persistentDirectory,
        compute: async () => ({ snapshot: { id: identity.dataSnapshotId } }),
        validate: (value, exactIdentity) => value.snapshot.id === exactIdentity.dataSnapshotId,
      });
      const differentDefinition = {
        ...identity,
        overviewDefinitionRevisionId: "template-v2:fingerprint-v2",
      };

      await expect(cache.readCurrent({
        pointerKey: "workspace-a/project-a/current-overview",
        persistentDirectory,
        expectedProjectionKey: createProjectOverviewProjectionKey(differentDefinition),
        validate: (value, exactIdentity) => value.snapshot.id === exactIdentity.dataSnapshotId,
      })).resolves.toBeUndefined();
    } finally {
      rmSync(persistentDirectory, { recursive: true, force: true });
    }
  });

  it("coalesces concurrent materialization for the same immutable identity", async () => {
    const persistentDirectory = mkdtempSync(join(tmpdir(), "project-overview-materialized-concurrent-"));
    const cache = createProjectAnalysisResultCache<{ snapshot: { id: string } }>({
      capacity: 2,
      ttlMs: 1,
    });
    const identity = managedIdentity();
    const projectionKey = createProjectOverviewProjectionKey(identity);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const compute = vi.fn(async () => {
      await gate;
      return { snapshot: { id: "snapshot-a" } };
    });
    const input = {
      pointerKey: "workspace-a/project-a/current-overview",
      projectionKey,
      identity,
      persistentDirectory,
      compute,
      validate: (value: { snapshot: { id: string } }) => value.snapshot.id === identity.dataSnapshotId,
    };
    try {
      const first = cache.materializeCurrent(input);
      const concurrent = cache.materializeCurrent(input);
      await vi.waitFor(() => expect(compute).toHaveBeenCalledOnce());
      release();
      await expect(Promise.all([first, concurrent])).resolves.toEqual([
        { value: { snapshot: { id: "snapshot-a" } }, changed: true },
        { value: { snapshot: { id: "snapshot-a" } }, changed: true },
      ]);
    } finally {
      rmSync(persistentDirectory, { recursive: true, force: true });
    }
  });

  it("serializes an explicit recompute behind automatic work for the same immutable identity", async () => {
    const persistentDirectory = mkdtempSync(join(tmpdir(), "project-overview-force-serialized-"));
    const cache = createProjectAnalysisResultCache<{ snapshot: { id: string }; total: number }>({
      capacity: 2,
      ttlMs: 1,
    });
    const identity = managedIdentity();
    const projectionKey = createProjectOverviewProjectionKey(identity);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let active = 0;
    let maximumActive = 0;
    const compute = vi.fn(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      if (compute.mock.calls.length === 1) await gate;
      active -= 1;
      return { snapshot: { id: "snapshot-a" }, total: 42 };
    });
    const common = {
      pointerKey: "workspace-a/project-a/current-overview",
      projectionKey,
      identity,
      persistentDirectory,
      compute,
      validate: (value: { snapshot: { id: string } }) => value.snapshot.id === identity.dataSnapshotId,
    };
    try {
      const automatic = cache.materializeCurrent(common);
      await vi.waitFor(() => expect(compute).toHaveBeenCalledOnce());
      const forced = cache.materializeCurrent({ ...common, forceRecompute: true });
      release();

      await expect(Promise.all([automatic, forced])).resolves.toHaveLength(2);
      expect(compute).toHaveBeenCalledTimes(2);
      expect(maximumActive).toBe(1);
    } finally {
      rmSync(persistentDirectory, { recursive: true, force: true });
    }
  });

  it("lets automatic materialization reread current after an in-flight forced recompute fails", async () => {
    const persistentDirectory = mkdtempSync(join(tmpdir(), "project-overview-force-first-"));
    const cache = createProjectAnalysisResultCache<{ snapshot: { id: string }; total: number }>({
      capacity: 2,
      ttlMs: 1,
    });
    const identity = managedIdentity();
    const projectionKey = createProjectOverviewProjectionKey(identity);
    const pointerKey = "workspace-a/project-a/current-overview";
    let releaseForce!: () => void;
    const forceGate = new Promise<void>((resolve) => {
      releaseForce = resolve;
    });
    const forcedCompute = vi.fn(async () => {
      await forceGate;
      return { snapshot: { id: identity.dataSnapshotId }, total: 43 };
    });
    const automaticCompute = vi.fn(async () => ({
      snapshot: { id: identity.dataSnapshotId },
      total: 42,
    }));
    const common = {
      pointerKey,
      projectionKey,
      identity,
      persistentDirectory,
      validate: (value: { snapshot: { id: string } }) => value.snapshot.id === identity.dataSnapshotId,
    };
    try {
      await cache.materializeCurrent({
        ...common,
        compute: async () => ({ snapshot: { id: identity.dataSnapshotId }, total: 42 }),
      });
      const forced = cache.materializeCurrent({
        ...common,
        forceRecompute: true,
        compute: forcedCompute,
      });
      await vi.waitFor(() => expect(forcedCompute).toHaveBeenCalledOnce());
      const automatic = cache.materializeCurrent({ ...common, compute: automaticCompute });
      const forcedAssertion = expect(forced)
        .rejects.toThrow("ENERGYIQ_OVERVIEW_PROJECTION_NONDETERMINISTIC");
      const automaticAssertion = expect(automatic).resolves.toMatchObject({
        changed: false,
        value: { total: 42 },
      });
      releaseForce();

      await Promise.all([forcedAssertion, automaticAssertion]);
      expect(automaticCompute).not.toHaveBeenCalled();
    } finally {
      releaseForce();
      rmSync(persistentDirectory, { recursive: true, force: true });
    }
  });

  it("serializes the same immutable identity across independent cache instances", async () => {
    const persistentDirectory = mkdtempSync(join(tmpdir(), "project-overview-cross-process-"));
    const firstCache = createProjectAnalysisResultCache<{ snapshot: { id: string } }>({
      capacity: 2,
      ttlMs: 1,
    });
    const secondCache = createProjectAnalysisResultCache<{ snapshot: { id: string } }>({
      capacity: 2,
      ttlMs: 1,
    });
    const identity = managedIdentity();
    const projectionKey = createProjectOverviewProjectionKey(identity);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const firstCompute = vi.fn(async () => {
      await gate;
      return { snapshot: { id: identity.dataSnapshotId } };
    });
    const secondCompute = vi.fn(async () => ({ snapshot: { id: identity.dataSnapshotId } }));
    const common = {
      pointerKey: "workspace-a/project-a/current-overview",
      projectionKey,
      identity,
      persistentDirectory,
      validate: (value: { snapshot: { id: string } }) => value.snapshot.id === identity.dataSnapshotId,
    };
    try {
      const first = firstCache.materializeCurrent({ ...common, compute: firstCompute });
      await vi.waitFor(() => expect(firstCompute).toHaveBeenCalledOnce());
      const second = secondCache.materializeCurrent({ ...common, compute: secondCompute });
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      expect(secondCompute).not.toHaveBeenCalled();
      release();

      await expect(Promise.all([first, second])).resolves.toEqual([
        { value: { snapshot: { id: identity.dataSnapshotId } }, changed: true },
        { value: { snapshot: { id: identity.dataSnapshotId } }, changed: false },
      ]);
      expect(secondCompute).not.toHaveBeenCalled();
    } finally {
      release();
      rmSync(persistentDirectory, { recursive: true, force: true });
    }
  });

  it("serializes different immutable identities for one current pointer across independent caches", async () => {
    const persistentDirectory = mkdtempSync(join(tmpdir(), "project-overview-pointer-serialized-"));
    const firstCache = createProjectAnalysisResultCache<{ snapshot: { id: string } }>({
      capacity: 2,
      ttlMs: 1,
    });
    const secondCache = createProjectAnalysisResultCache<{ snapshot: { id: string } }>({
      capacity: 2,
      ttlMs: 1,
    });
    const firstIdentity = managedIdentity();
    const secondIdentity = { ...firstIdentity, dataSnapshotId: "snapshot-b" };
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    let active = 0;
    let maximumActive = 0;
    const firstCompute = vi.fn(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await firstGate;
      active -= 1;
      return { snapshot: { id: firstIdentity.dataSnapshotId } };
    });
    const secondCompute = vi.fn(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await secondGate;
      active -= 1;
      return { snapshot: { id: secondIdentity.dataSnapshotId } };
    });
    const pointerKey = "workspace-a/project-a/current-overview";
    try {
      const first = firstCache.materializeCurrent({
        pointerKey,
        projectionKey: createProjectOverviewProjectionKey(firstIdentity),
        identity: firstIdentity,
        persistentDirectory,
        compute: firstCompute,
        validate: (value, identity) => value.snapshot.id === identity.dataSnapshotId,
      });
      await vi.waitFor(() => expect(firstCompute).toHaveBeenCalledOnce());
      const second = secondCache.materializeCurrent({
        pointerKey,
        projectionKey: createProjectOverviewProjectionKey(secondIdentity),
        identity: secondIdentity,
        persistentDirectory,
        compute: secondCompute,
        validate: (value, identity) => value.snapshot.id === identity.dataSnapshotId,
      });
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      const secondStartedBeforeRelease = secondCompute.mock.calls.length;
      releaseFirst();
      await vi.waitFor(() => expect(secondCompute).toHaveBeenCalledOnce());
      releaseSecond();

      await expect(Promise.all([first, second])).resolves.toHaveLength(2);
      expect(secondStartedBeforeRelease).toBe(0);
      expect(maximumActive).toBe(1);
    } finally {
      releaseFirst();
      releaseSecond();
      rmSync(persistentDirectory, { recursive: true, force: true });
    }
  });

  it("fails an independent-cache forced recompute closed when the immutable bytes differ", async () => {
    const persistentDirectory = mkdtempSync(join(tmpdir(), "project-overview-cross-process-force-"));
    const firstCache = createProjectAnalysisResultCache<{ snapshot: { id: string }; total: number }>({
      capacity: 2,
      ttlMs: 1,
    });
    const secondCache = createProjectAnalysisResultCache<{ snapshot: { id: string }; total: number }>({
      capacity: 2,
      ttlMs: 1,
    });
    const identity = managedIdentity();
    const projectionKey = createProjectOverviewProjectionKey(identity);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let active = 0;
    let maximumActive = 0;
    const firstCompute = vi.fn(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await gate;
      active -= 1;
      return { snapshot: { id: identity.dataSnapshotId }, total: 42 };
    });
    const secondCompute = vi.fn(async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      active -= 1;
      return { snapshot: { id: identity.dataSnapshotId }, total: 43 };
    });
    const common = {
      pointerKey: "workspace-a/project-a/current-overview",
      projectionKey,
      identity,
      persistentDirectory,
      forceRecompute: true,
      validate: (value: { snapshot: { id: string } }) => value.snapshot.id === identity.dataSnapshotId,
    };
    try {
      const first = firstCache.materializeCurrent({ ...common, compute: firstCompute });
      await vi.waitFor(() => expect(firstCompute).toHaveBeenCalledOnce());
      const second = secondCache.materializeCurrent({ ...common, compute: secondCompute });
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      expect(secondCompute).not.toHaveBeenCalled();
      release();

      await expect(first).resolves.toMatchObject({ changed: true });
      await expect(second).rejects.toThrow("ENERGYIQ_OVERVIEW_PROJECTION_NONDETERMINISTIC");
      expect(maximumActive).toBe(1);
    } finally {
      release();
      rmSync(persistentDirectory, { recursive: true, force: true });
    }
  });

  it("never lets expiring read-through entries prune durable Managed Overview files", async () => {
    const persistentDirectory = mkdtempSync(join(tmpdir(), "project-overview-materialized-prune-"));
    const cache = createProjectAnalysisResultCache<{ snapshot: { id: string } }>({
      capacity: 1,
      persistentCapacity: 1,
      ttlMs: 120_000,
    });
    const identity = managedIdentity();
    try {
      await cache.materializeCurrent({
        pointerKey: "workspace-a/project-a/current-overview",
        projectionKey: createProjectOverviewProjectionKey(identity),
        identity,
        persistentDirectory,
        compute: async () => ({ snapshot: { id: "snapshot-a" } }),
        validate: (value, exactIdentity) => value.snapshot.id === exactIdentity.dataSnapshotId,
      });
      await cache.resolve("read-through-a", async () => ({ snapshot: { id: "temporary-a" } }), {
        persistentDirectory,
      });
      await cache.resolve("read-through-b", async () => ({ snapshot: { id: "temporary-b" } }), {
        persistentDirectory,
      });

      const restarted = createProjectAnalysisResultCache<{ snapshot: { id: string } }>({
        capacity: 1,
        persistentCapacity: 1,
        ttlMs: 120_000,
      });
      await expect(restarted.readCurrent({
        pointerKey: "workspace-a/project-a/current-overview",
        persistentDirectory,
        validate: (value, exactIdentity) => value.snapshot.id === exactIdentity.dataSnapshotId,
      })).resolves.toMatchObject({
        identity: { dataSnapshotId: "snapshot-a" },
        value: { snapshot: { id: "snapshot-a" } },
      });
    } finally {
      rmSync(persistentDirectory, { recursive: true, force: true });
    }
  });

  it("shares same-key in-flight work and reuses its successful result", async () => {
    const cache = createProjectAnalysisResultCache<string>({
      capacity: 6,
      ttlMs: 120_000,
    });
    let executions = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const compute = async () => {
      executions += 1;
      await gate;
      return "ready-result";
    };

    const first = cache.resolve("same-authorized-identity", compute);
    const concurrent = cache.resolve("same-authorized-identity", compute);
    expect(executions).toBe(1);

    release();
    await expect(Promise.all([first, concurrent])).resolves.toEqual([
      "ready-result",
      "ready-result",
    ]);
    await expect(cache.resolve("same-authorized-identity", compute))
      .resolves.toBe("ready-result");
    expect(executions).toBe(1);
  });

  it("restores an exact immutable result after an API-process restart and replaces it on bypass", async () => {
    const persistentDirectory = mkdtempSync(join(tmpdir(), "project-analysis-persistent-cache-"));
    let executions = 0;
    const compute = async () => ({
      status: "ready" as const,
      snapshot: { revision: ++executions },
    });
    try {
      const firstProcess = createProjectAnalysisResultCache<Awaited<ReturnType<typeof compute>>>({
        capacity: 6,
        ttlMs: 120_000,
      });
      await expect(firstProcess.resolve("exact-snapshot-release-period", compute, {
        persistentDirectory,
      })).resolves.toEqual({ status: "ready", snapshot: { revision: 1 } });

      const restartedProcess = createProjectAnalysisResultCache<Awaited<ReturnType<typeof compute>>>({
        capacity: 6,
        ttlMs: 120_000,
      });
      await expect(restartedProcess.resolve("exact-snapshot-release-period", compute, {
        persistentDirectory,
      })).resolves.toEqual({ status: "ready", snapshot: { revision: 1 } });
      expect(executions).toBe(1);

      await expect(restartedProcess.resolve("exact-snapshot-release-period", compute, {
        bypass: true,
        persistentDirectory,
      })).resolves.toEqual({ status: "ready", snapshot: { revision: 2 } });

      const afterRefreshRestart = createProjectAnalysisResultCache<Awaited<ReturnType<typeof compute>>>({
        capacity: 6,
        ttlMs: 120_000,
      });
      await expect(afterRefreshRestart.resolve("exact-snapshot-release-period", compute, {
        persistentDirectory,
      })).resolves.toEqual({ status: "ready", snapshot: { revision: 2 } });
      expect(executions).toBe(2);
    } finally {
      rmSync(persistentDirectory, { recursive: true, force: true });
    }
  });

  it("treats an expired persisted result as a miss after restart", async () => {
    const persistentDirectory = mkdtempSync(join(tmpdir(), "project-analysis-expired-cache-"));
    let currentTime = 1_000;
    let executions = 0;
    const compute = async () => `result-${++executions}`;
    try {
      const firstProcess = createProjectAnalysisResultCache<string>({
        capacity: 2,
        ttlMs: 120_000,
        now: () => currentTime,
      });
      await expect(firstProcess.resolve("expiring-persisted-identity", compute, {
        persistentDirectory,
      })).resolves.toBe("result-1");

      currentTime += 120_001;
      const restartedProcess = createProjectAnalysisResultCache<string>({
        capacity: 2,
        ttlMs: 120_000,
        now: () => currentTime,
      });
      await expect(restartedProcess.resolve("expiring-persisted-identity", compute, {
        persistentDirectory,
      })).resolves.toBe("result-2");
      expect(executions).toBe(2);
    } finally {
      rmSync(persistentDirectory, { recursive: true, force: true });
    }
  });

  it("does not retain rejected work", async () => {
    const cache = createProjectAnalysisResultCache<string>({
      capacity: 6,
      ttlMs: 120_000,
    });
    let executions = 0;

    await expect(cache.resolve("failing-identity", async () => {
      executions += 1;
      throw new Error("resolver failed");
    })).rejects.toThrow("resolver failed");

    await expect(cache.resolve("failing-identity", async () => {
      executions += 1;
      return "recovered";
    })).resolves.toBe("recovered");
    expect(executions).toBe(2);
  });

  it("evicts the least-recently-used success when capacity is reached", async () => {
    const cache = createProjectAnalysisResultCache<string>({
      capacity: 2,
      ttlMs: 120_000,
    });
    const executions = new Map<string, number>();
    const compute = (key: string) => async () => {
      executions.set(key, (executions.get(key) ?? 0) + 1);
      return `${key}-result`;
    };

    await cache.resolve("a", compute("a"));
    await cache.resolve("b", compute("b"));
    await cache.resolve("a", compute("a"));
    await cache.resolve("c", compute("c"));
    await cache.resolve("b", compute("b"));

    expect(executions.get("a")).toBe(1);
    expect(executions.get("b")).toBe(2);
    expect(executions.get("c")).toBe(1);
  });

  it("recomputes a successful result after its short TTL expires", async () => {
    let currentTime = 1_000;
    const cache = createProjectAnalysisResultCache<string>({
      capacity: 6,
      ttlMs: 120_000,
      now: () => currentTime,
    });
    let executions = 0;
    const compute = async () => {
      executions += 1;
      return `result-${executions}`;
    };

    await expect(cache.resolve("expiring-identity", compute)).resolves.toBe("result-1");
    currentTime += 119_999;
    await expect(cache.resolve("expiring-identity", compute)).resolves.toBe("result-1");
    currentTime += 1;
    await expect(cache.resolve("expiring-identity", compute)).resolves.toBe("result-2");
    expect(executions).toBe(2);
  });

  it("starts a fresh generation on bypass and never lets the old in-flight result refill the cache", async () => {
    const cache = createProjectAnalysisResultCache<string>({
      capacity: 6,
      ttlMs: 120_000,
    });
    let executions = 0;
    let releaseOld!: () => void;
    let releaseRefresh!: () => void;
    const oldGate = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    const old = cache.resolve("same-identity", async () => {
      executions += 1;
      await oldGate;
      return "old-result";
    });
    const refresh = cache.resolve("same-identity", async () => {
      executions += 1;
      await refreshGate;
      return "refreshed-result";
    }, { bypass: true });
    expect(executions).toBe(2);

    releaseOld();
    await expect(old).resolves.toBe("old-result");
    const afterOldCompleted = cache.resolve("same-identity", async () => {
      executions += 1;
      return "unexpected-third-result";
    });
    releaseRefresh();
    await expect(Promise.all([refresh, afterOldCompleted])).resolves.toEqual([
      "refreshed-result",
      "refreshed-result",
    ]);
    await expect(cache.resolve("same-identity", async () => "unexpected-fourth-result"))
      .resolves.toBe("refreshed-result");
    expect(executions).toBe(2);
  });

  it("protects a retained success from nested mutation poisoning", async () => {
    const cache = createProjectAnalysisResultCache<{ snapshot: { usageKwh: number } }>({
      capacity: 6,
      ttlMs: 120_000,
    });
    const retained = await cache.resolve("immutable-identity", async () => ({
      snapshot: { usageKwh: 42 },
    }));

    expect(Object.isFrozen(retained)).toBe(true);
    expect(Object.isFrozen(retained.snapshot)).toBe(true);
    expect(() => {
      retained.snapshot.usageKwh = 99;
    }).toThrow(TypeError);
    await expect(cache.resolve("immutable-identity", async () => ({
      snapshot: { usageKwh: 0 },
    }))).resolves.toEqual({ snapshot: { usageKwh: 42 } });
  });
});

describe("ProjectAnalysisCacheIdentity", () => {
  const identity: ProjectAnalysisCacheIdentity = {
    resolverRevision: "project-analysis-resolver@1",
    userId: "user-a",
    workspaceId: "workspace-a",
    projectId: "project-a",
    scopeId: "project",
    resource: "electricity",
    analysisWindow: "current-overview-28d",
    period: "Custom",
    timezone: "Asia/Singapore",
    from: "2026-05-20T00:00:00.000Z",
    to: "2026-06-17T00:00:00.000Z",
    dataSnapshotId: "snapshot-a",
    projectReleaseId: "release-a",
    reportTimePolicyRevisionId: "project-report-time@1",
    hierarchyRevisionId: "hierarchy-a",
    meterMappingRevisionId: "mapping-a",
    meterFormulaRevisionId: "formula-a",
    metricVersion: "metric-a",
    businessCalendarVersion: "calendar-a",
    tariffScheduleVersion: "tariff-a",
    rendererKey: "ngee-ann-overview",
    rendererVersion: "1",
    rendererContractVersion: "project-analysis-snapshot@1",
    recipeId: "energy-scope-analysis",
    recipeVersion: "1",
    metricRevisionIds: ["metric-r1"],
    ruleRevisionIds: ["rule-r1"],
    databasePath: "D:/facts/workspace-a.duckdb",
  };
  const changedIdentities: Array<[string, ProjectAnalysisCacheIdentity]> = [
    ["resolver revision", { ...identity, resolverRevision: "project-analysis-resolver@2" }],
    ["user", { ...identity, userId: "user-b" }],
    ["Workspace", { ...identity, workspaceId: "workspace-b" }],
    ["Project", { ...identity, projectId: "project-b" }],
    ["Scope", { ...identity, scopeId: "level-7" }],
    ["Resource", { ...identity, resource: "water" }],
    ["analysis window", { ...identity, analysisWindow: "latest-complete-7d" }],
    ["Period", { ...identity, period: "Previous month" }],
    ["timezone", { ...identity, timezone: "Asia/Tokyo" }],
    ["window start", { ...identity, from: "2026-05-19T00:00:00.000Z" }],
    ["window end", { ...identity, to: "2026-06-18T00:00:00.000Z" }],
    ["Snapshot", { ...identity, dataSnapshotId: "snapshot-b" }],
    ["Project Release", { ...identity, projectReleaseId: "release-b" }],
    ["Report-time policy revision", { ...identity, reportTimePolicyRevisionId: "project-report-time@2" }],
    ["Hierarchy", { ...identity, hierarchyRevisionId: "hierarchy-b" }],
    ["Meter Mapping", { ...identity, meterMappingRevisionId: "mapping-b" }],
    ["Meter Formula", { ...identity, meterFormulaRevisionId: "formula-b" }],
    ["Metric version", { ...identity, metricVersion: "metric-b" }],
    ["Calendar", { ...identity, businessCalendarVersion: "calendar-b" }],
    ["Tariff", { ...identity, tariffScheduleVersion: "tariff-b" }],
    ["Renderer", { ...identity, rendererKey: "preschool-overview" }],
    ["Renderer version", { ...identity, rendererVersion: "2" }],
    ["Renderer contract", { ...identity, rendererContractVersion: "project-analysis-snapshot@2" }],
    ["Recipe", { ...identity, recipeId: "energy-scope-analysis-v2" }],
    ["Recipe version", { ...identity, recipeVersion: "2" }],
    ["Metric revisions", { ...identity, metricRevisionIds: ["metric-r2"] }],
    ["Rule revisions", { ...identity, ruleRevisionIds: ["rule-r2"] }],
    ["fact store", { ...identity, databasePath: "D:/facts/workspace-b.duckdb" }],
  ];

  it.each(changedIdentities)("changes when the authoritative %s identity changes", (_name, changed) => {
    expect(createProjectAnalysisCacheKey(changed))
      .not.toBe(createProjectAnalysisCacheKey(identity));
  });

  it("does not reuse a warm analysis when the pinned Report-time policy revision changes", async () => {
    const cache = createProjectAnalysisResultCache<{ policyRevision: string }>({
      capacity: 2,
      ttlMs: 60_000,
    });
    const compute = vi.fn(async (policyRevision: string) => ({ policyRevision }));
    const firstKey = createProjectAnalysisCacheKey(identity);
    const secondIdentity = { ...identity, reportTimePolicyRevisionId: "project-report-time@2" };
    const secondKey = createProjectAnalysisCacheKey(secondIdentity);

    await expect(cache.resolve(firstKey, () => compute("project-report-time@1")))
      .resolves.toEqual({ policyRevision: "project-report-time@1" });
    await expect(cache.resolve(secondKey, () => compute("project-report-time@2")))
      .resolves.toEqual({ policyRevision: "project-report-time@2" });
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("builds one actor-free Managed Overview identity for all authorized readers", () => {
    const managed = managedIdentity();
    expect(createProjectOverviewProjectionKey(managed)).toBe(
      createProjectOverviewProjectionKey({ ...managed }),
    );
    expect(createProjectOverviewProjectionKey({
      ...managed,
      overviewDefinitionRevisionId: "overview-definition-b",
    })).not.toBe(createProjectOverviewProjectionKey(managed));
    expect(createProjectOverviewProjectionKey({
      ...managed,
      tariffScheduleVersion: "tariff-b",
    })).not.toBe(createProjectOverviewProjectionKey(managed));
  });
});

const managedIdentity = (): ProjectOverviewProjectionIdentity => ({
  resolverRevision: "project-analysis-resolver@1",
  workspaceId: "workspace-a",
  projectId: "project-a",
  scopeId: "project",
  resource: "electricity",
  analysisWindow: "current-project-overview",
  period: "Custom",
  timezone: "Asia/Singapore",
  from: "2026-06-01T00:00:00.000Z",
  to: "2026-07-01T00:00:00.000Z",
  dataSnapshotId: "snapshot-a",
  projectReleaseId: "release-a",
  reportTimePolicyRevisionId: "report-time-a",
  hierarchyRevisionId: "hierarchy-a",
  meterMappingRevisionId: "mapping-a",
  meterFormulaRevisionId: "formula-a",
  metricVersion: "metric-a",
  businessCalendarVersion: "calendar-a",
  tariffScheduleVersion: "tariff-a",
  overviewDefinitionRevisionId: "overview-definition-a",
  rendererKey: "preschool-overview",
  rendererVersion: "1",
  rendererContractVersion: "project-analysis-snapshot@1",
  recipeId: "energy-scope-analysis",
  recipeVersion: "1",
  metricRevisionIds: ["metric-r1"],
  ruleRevisionIds: ["rule-r1"],
  databasePath: "D:/facts/workspace-a.duckdb",
});
