import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  EnergyProjectAnalysisResolutionDto,
  EnergyProjectOverviewMinimumDto,
} from "../../../lib/config-api";
import { resolveProgressiveCurrentOverview } from "./progressive-current-overview";

afterEach(() => vi.useRealTimers());

describe("progressive Current Overview coordinator", () => {
  it("rejects a minimum whose server-owned Project identity is invalid", async () => {
    const minimum = minimumFor("snapshot-foreign", "release-foreign");
    const identityError = new Error("ENERGYIQ_CURRENT_OVERVIEW_MINIMUM_IDENTITY_MISMATCH");
    const onMinimum = vi.fn();

    const resolving = resolveProgressiveCurrentOverview({
      loadMinimum: async () => minimum,
      loadInitial: async () => readyResolution("snapshot-current", "release-current"),
      loadExact: vi.fn(),
      validateMinimum: () => {
        throw identityError;
      },
      minimumMatchesResolution: matches,
      onMinimum,
      isCancelled: () => false,
    });

    await expect(resolving).rejects.toBe(identityError);
    expect(onMinimum).not.toHaveBeenCalled();
  });

  it("fails an accepted full report closed when a late minimum has invalid identity", async () => {
    vi.useFakeTimers();
    const minimumDeferred = deferred<EnergyProjectOverviewMinimumDto>();
    const minimum = minimumFor("snapshot-foreign", "release-foreign");
    const identityError = new Error("ENERGYIQ_CURRENT_OVERVIEW_MINIMUM_IDENTITY_MISMATCH");
    const full = readyResolution("snapshot-current", "release-current");
    const onMinimum = vi.fn();
    const onLateMinimumValidationError = vi.fn();
    const resolving = resolveProgressiveCurrentOverview({
      loadMinimum: () => minimumDeferred.promise,
      loadInitial: async () => full,
      loadExact: vi.fn(),
      validateMinimum: () => {
        throw identityError;
      },
      minimumMatchesResolution: matches,
      onMinimum,
      onLateMinimumValidationError,
      isCancelled: () => false,
    });
    await vi.advanceTimersByTimeAsync(2_001);
    await expect(resolving).resolves.toBe(full);

    minimumDeferred.resolve(minimum);
    await vi.waitFor(() => expect(onLateMinimumValidationError).toHaveBeenCalledWith(identityError));
    expect(onMinimum).not.toHaveBeenCalled();
  });

  it("corrects an accepted full report when a mismatched minimum arrives after the wait budget", async () => {
    vi.useFakeTimers();
    const minimumDeferred = deferred<EnergyProjectOverviewMinimumDto>();
    const raced = readyResolution("snapshot-raced", "release-raced");
    const exact = readyResolution("snapshot-exact", "release-exact");
    const minimum = minimumFor("snapshot-exact", "release-exact");
    const loadExact = vi.fn().mockResolvedValue(exact);
    const onLateResolution = vi.fn();
    const onMinimum = vi.fn();

    const resolving = resolveProgressiveCurrentOverview({
      loadMinimum: () => minimumDeferred.promise,
      loadInitial: async () => raced,
      loadExact,
      validateMinimum: () => undefined,
      minimumMatchesResolution: matches,
      onMinimum,
      onLateResolution,
      isCancelled: () => false,
    });
    await vi.advanceTimersByTimeAsync(2_001);
    await expect(resolving).resolves.toBe(raced);

    minimumDeferred.resolve(minimum);
    await vi.waitFor(() => expect(loadExact).toHaveBeenCalledWith(minimum));
    expect(onMinimum).toHaveBeenCalledWith(minimum);
    await vi.waitFor(() => expect(onLateResolution).toHaveBeenCalledWith(exact));
  });

  it("does not publish a late exact correction after the request is cancelled", async () => {
    vi.useFakeTimers();
    let cancelled = false;
    const minimumDeferred = deferred<EnergyProjectOverviewMinimumDto>();
    const exactDeferred = deferred<EnergyProjectAnalysisResolutionDto>();
    const minimum = minimumFor("snapshot-exact", "release-exact");
    const onLateResolution = vi.fn();
    const loadExact = vi.fn(() => exactDeferred.promise);
    const resolving = resolveProgressiveCurrentOverview({
      loadMinimum: () => minimumDeferred.promise,
      loadInitial: async () => readyResolution("snapshot-raced", "release-raced"),
      loadExact,
      validateMinimum: () => undefined,
      minimumMatchesResolution: matches,
      onMinimum: vi.fn(),
      onLateResolution,
      isCancelled: () => cancelled,
    });
    await vi.advanceTimersByTimeAsync(2_001);
    await resolving;
    minimumDeferred.resolve(minimum);
    await vi.waitFor(() => expect(loadExact).toHaveBeenCalledWith(minimum));

    cancelled = true;
    exactDeferred.resolve(readyResolution("snapshot-exact", "release-exact"));
    await Promise.resolve();
    await Promise.resolve();
    expect(onLateResolution).not.toHaveBeenCalled();
  });

  it("keeps an accepted full report when the optional minimum request fails late", async () => {
    vi.useFakeTimers();
    const minimumDeferred = deferred<EnergyProjectOverviewMinimumDto>();
    const onLateIdentityError = vi.fn();
    const full = readyResolution("snapshot-current", "release-current");
    const resolving = resolveProgressiveCurrentOverview({
      loadMinimum: () => minimumDeferred.promise,
      loadInitial: async () => full,
      loadExact: vi.fn(),
      validateMinimum: () => undefined,
      minimumMatchesResolution: matches,
      onMinimum: vi.fn(),
      onLateIdentityError,
      isCancelled: () => false,
    });
    await vi.advanceTimersByTimeAsync(2_001);
    await expect(resolving).resolves.toBe(full);

    minimumDeferred.reject(new Error("MINIMUM_TIMEOUT"));
    await Promise.resolve();
    await Promise.resolve();
    expect(onLateIdentityError).not.toHaveBeenCalled();
  });

  it("reports the trusted minimum when a late identity correction fails", async () => {
    vi.useFakeTimers();
    const minimumDeferred = deferred<EnergyProjectOverviewMinimumDto>();
    const minimum = minimumFor("snapshot-exact", "release-exact");
    const correctionError = new Error("EXACT_TIMEOUT");
    const onLateIdentityError = vi.fn();
    const resolving = resolveProgressiveCurrentOverview({
      loadMinimum: () => minimumDeferred.promise,
      loadInitial: async () => readyResolution("snapshot-raced", "release-raced"),
      loadExact: vi.fn().mockRejectedValue(correctionError),
      validateMinimum: () => undefined,
      minimumMatchesResolution: matches,
      onMinimum: vi.fn(),
      onLateIdentityError,
      isCancelled: () => false,
    });
    await vi.advanceTimersByTimeAsync(2_001);
    await resolving;

    minimumDeferred.resolve(minimum);
    await vi.waitFor(() => expect(onLateIdentityError)
      .toHaveBeenCalledWith(correctionError, minimum));
  });

  it("fails an accepted full report closed when the late identity matcher throws", async () => {
    vi.useFakeTimers();
    const minimumDeferred = deferred<EnergyProjectOverviewMinimumDto>();
    const minimum = minimumFor("snapshot-exact", "release-exact");
    const matcherError = new Error("MALFORMED_REPORT_TIME_CONTEXT");
    const onMinimum = vi.fn();
    const onLateIdentityError = vi.fn();
    const resolving = resolveProgressiveCurrentOverview({
      loadMinimum: () => minimumDeferred.promise,
      loadInitial: async () => readyResolution("snapshot-raced", "release-raced"),
      loadExact: vi.fn(),
      validateMinimum: () => undefined,
      minimumMatchesResolution: () => {
        throw matcherError;
      },
      onMinimum,
      onLateIdentityError,
      isCancelled: () => false,
    });
    await vi.advanceTimersByTimeAsync(2_001);
    await resolving;

    minimumDeferred.resolve(minimum);
    await vi.waitFor(() => expect(onLateIdentityError)
      .toHaveBeenCalledWith(matcherError, minimum));
    expect(onMinimum).toHaveBeenCalledWith(minimum);
  });

  it("commits a mismatched minimum before the exact correction settles", async () => {
    vi.useFakeTimers();
    const minimumDeferred = deferred<EnergyProjectOverviewMinimumDto>();
    const exactDeferred = deferred<EnergyProjectAnalysisResolutionDto>();
    const minimum = minimumFor("snapshot-exact", "release-exact");
    const onLateIdentityMismatch = vi.fn();
    const onLateResolution = vi.fn();
    const resolving = resolveProgressiveCurrentOverview({
      loadMinimum: () => minimumDeferred.promise,
      loadInitial: async () => readyResolution("snapshot-raced", "release-raced"),
      loadExact: vi.fn(() => exactDeferred.promise),
      validateMinimum: () => undefined,
      minimumMatchesResolution: matches,
      onMinimum: vi.fn(),
      onLateIdentityMismatch,
      onLateResolution,
      isCancelled: () => false,
    });
    await vi.advanceTimersByTimeAsync(2_001);
    await resolving;

    minimumDeferred.resolve(minimum);
    await vi.waitFor(() => expect(onLateIdentityMismatch).toHaveBeenCalledWith(minimum));
    expect(onLateResolution).not.toHaveBeenCalled();

    exactDeferred.resolve(readyResolution("snapshot-exact", "release-exact"));
    await vi.waitFor(() => expect(onLateResolution).toHaveBeenCalledOnce());
  });
});

const matches = (
  minimum: EnergyProjectOverviewMinimumDto,
  resolution: Extract<EnergyProjectAnalysisResolutionDto, { status: "ready" }>,
) => minimum.binding.currentPin.dataSnapshotId === resolution.snapshot.context.dataSnapshotId
  && minimum.binding.currentPin.projectReleaseId === resolution.snapshot.projectRelease.id;

const minimumFor = (
  dataSnapshotId: string,
  projectReleaseId: string,
): EnergyProjectOverviewMinimumDto => ({
  binding: {
    currentPin: { dataSnapshotId, projectReleaseId },
  },
} as EnergyProjectOverviewMinimumDto);

const readyResolution = (
  dataSnapshotId: string,
  projectReleaseId: string,
): EnergyProjectAnalysisResolutionDto => ({
  status: "ready",
  snapshot: {
    context: { dataSnapshotId },
    projectRelease: { id: projectReleaseId },
  },
} as unknown as EnergyProjectAnalysisResolutionDto);

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};
