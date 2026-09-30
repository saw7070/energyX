import { describe, expect, it } from "vitest";
import { reportTimeBasisFromContext } from "@datafoundry/contracts";

import type {
  EnergyProjectAnalysisSnapshotDto,
  EnergySavedAnalysisAiArtifactInputDto,
  EnergySavedAnalysisDetailDto,
  EnergySavedAnalysisSummaryDto,
} from "../../../lib/config-api";
import {
  buildOverviewChangeSummary,
  isCompatiblePreviousOverview,
  orderPreviousOverviewCandidates,
} from "./overview-change-summary";

describe("Overview change summary", () => {
  it("separates data changes from report-time basis changes", () => {
    const previous = savedDetail({ id: "saved-a", sequence: 1, snapshotId: "snapshot-a" });
    const current = snapshot({ snapshotId: "snapshot-b", releaseId: "release-a" });
    setReportTimeContext(previous.snapshot!, {
      policyRevision: "v1",
      windowId: "current-overview",
      from: "2026-05-01T00:00:00.000Z",
      toExclusive: "2026-05-29T00:00:00.000Z",
    });
    setReportTimeContext(current, {
      policyRevision: "v1",
      windowId: "current-overview",
      from: "2026-05-08T00:00:00.000Z",
      toExclusive: "2026-06-05T00:00:00.000Z",
    });

    const dataOnly = buildOverviewChangeSummary({ previous, current, currentAiArtifact: null });

    expect(dataOnly?.provenance).toMatchObject({
      dataSnapshotStatus: "changed",
      reportTimeBasisStatus: "same",
      attribution: "data",
    });

    const sameSnapshotPrevious = savedDetail({
      id: "saved-policy-a",
      sequence: 2,
      snapshotId: "snapshot-b",
      releaseId: "release-b",
    });
    setReportTimeContext(sameSnapshotPrevious.snapshot!, {
      policyRevision: "v1",
      windowId: "current-overview",
      from: "2026-05-08T00:00:00.000Z",
      toExclusive: "2026-06-05T00:00:00.000Z",
    });
    setReportTimeContext(current, {
      policyRevision: "v2",
      windowId: "current-month-progress",
      from: "2026-06-01T00:00:00.000Z",
      toExclusive: "2026-06-05T00:00:00.000Z",
    });

    const basisOnly = buildOverviewChangeSummary({
      previous: sameSnapshotPrevious,
      current,
      currentAiArtifact: null,
    });
    expect(basisOnly?.provenance).toMatchObject({
      dataSnapshotStatus: "same",
      reportTimeBasisStatus: "changed",
      attribution: "analysis-basis",
    });
    expect(basisOnly?.metrics).toEqual([]);
    expect(orderPreviousOverviewCandidates({ items: [sameSnapshotPrevious], current }))
      .toEqual([sameSnapshotPrevious]);

    const mixed = buildOverviewChangeSummary({ previous, current, currentAiArtifact: null });
    expect(mixed?.provenance).toMatchObject({
      dataSnapshotStatus: "changed",
      reportTimeBasisStatus: "changed",
      attribution: "mixed",
    });
    expect(mixed?.metrics).toEqual([]);
  });

  it("compares an immutable Template regeneration on the same Data Snapshot as analysis-basis change", () => {
    const previous = savedDetail({
      id: "saved-template-v6",
      sequence: 6,
      snapshotId: "snapshot-b",
      releaseId: "release-v6",
      rendererKey: "ngee-ann-overview",
    });
    const current = snapshot({
      snapshotId: "snapshot-b",
      releaseId: "release-v7",
      rendererKey: "ngee-ann-overview",
    });
    setReportTimeContext(previous.snapshot!, {
      policyRevision: "v1",
      windowId: "current-month-progress",
      from: "2026-06-01T00:00:00.000Z",
      toExclusive: "2026-06-17T00:00:00.000Z",
    });
    setReportTimeContext(current, {
      policyRevision: "v1",
      windowId: "current-month-progress",
      from: "2026-06-01T00:00:00.000Z",
      toExclusive: "2026-06-17T00:00:00.000Z",
    });

    expect(orderPreviousOverviewCandidates({ items: [previous], current }))
      .toEqual([previous]);
    expect(isCompatiblePreviousOverview(previous, current)).toBe(true);
    expect(buildOverviewChangeSummary({
      previous,
      current,
      currentAiArtifact: null,
    })?.provenance).toMatchObject({
      dataSnapshotStatus: "same",
      reportTimeBasisStatus: "same",
      projectReleaseStatus: "changed",
      attribution: "analysis-basis",
    });
  });

  it("marks legacy snapshots without Report Time provenance as unversioned", () => {
    const previous = savedDetail({ id: "saved-a", sequence: 1, snapshotId: "snapshot-a" });
    const current = snapshot({ snapshotId: "snapshot-b", releaseId: "release-b" });

    expect(buildOverviewChangeSummary({ previous, current, currentAiArtifact: null })?.provenance)
      .toMatchObject({ reportTimeBasisStatus: "unversioned", attribution: "unversioned" });
  });

  it("compares Ngee Ann @3 Key Findings with exact unit-generation provenance", () => {
    const previous = savedDetail({
      id: "ngee-a",
      sequence: 1,
      snapshotId: "snapshot-a",
      rendererKey: "ngee-ann-overview",
    });
    previous.aiArtifact = projectAiArtifact("snapshot-a", "release-a", "Retained operating insight");
    const current = snapshot({
      snapshotId: "snapshot-b",
      releaseId: "release-b",
      rendererKey: "ngee-ann-overview",
    });
    const currentAi = projectAiArtifact("snapshot-b", "release-b", "Retained operating insight");

    const result = buildOverviewChangeSummary({ previous, current, currentAiArtifact: currentAi });

    expect(result?.ai.generationBasisStatus).toBe("same");
    expect(result?.ai.keyFindingChanges).toEqual([
      expect.objectContaining({ state: "retained", currentTitle: "Retained operating insight" }),
    ]);

    const changedPrompt = projectAiArtifact("snapshot-b", "release-b", "Retained operating insight");
    if (changedPrompt.contract === "energyiq-saved-ai-result@3") {
      const units = changedPrompt.result.binding.generation.units;
      if (!units) throw new Error("TEST_UNIT_GENERATION_REQUIRED");
      units.keyFindings.investigatorPromptRevision = "executive-prompt-v-next";
    }
    expect(buildOverviewChangeSummary({
      previous,
      current,
      currentAiArtifact: changedPrompt,
    })?.ai.generationBasisStatus).toBe("changed");
  });

  it("treats a changed Report Time Context fingerprint as new data when generation contracts remain exact", () => {
    const previous = savedDetail({
      id: "ngee-report-time-a",
      sequence: 1,
      snapshotId: "snapshot-a",
      rendererKey: "ngee-ann-overview",
    });
    previous.aiArtifact = projectAiArtifact("snapshot-a", "release-a", "Previous finding");
    const current = snapshot({
      snapshotId: "snapshot-b",
      releaseId: "release-b",
      rendererKey: "ngee-ann-overview",
    });
    const currentAi = projectAiArtifact("snapshot-b", "release-b", "Current finding");

    for (const [artifact, fingerprint] of [
      [previous.aiArtifact, "report-time-fingerprint-a"],
      [currentAi, "report-time-fingerprint-b"],
    ] as const) {
      if (!artifact || artifact.contract !== "energyiq-saved-ai-result@3") {
        throw new Error("TEST_PROJECT_AI_ARTIFACT_REQUIRED");
      }
      artifact.result.binding.generation.reportTimeContextFingerprint = fingerprint;
      const units = artifact.result.binding.generation.units;
      if (!units) throw new Error("TEST_UNIT_GENERATION_REQUIRED");
      units.keyFindings.reportTimeContextFingerprint = fingerprint;
      for (const unit of Object.values(units.sections)) {
        unit.reportTimeContextFingerprint = fingerprint;
      }
      units.additionalInsights.reportTimeContextFingerprint = fingerprint;
    }

    expect(buildOverviewChangeSummary({
      previous,
      current,
      currentAiArtifact: currentAi,
    })?.ai.generationBasisStatus).toBe("same");
  });

  it("compares immutable A/B identities, decision metrics, and AI conclusions without inventing semantic matches", () => {
    const previous = savedDetail({
      id: "saved-a",
      sequence: 4,
      snapshotId: "snapshot-a",
      releaseId: "release-a",
      from: "2026-05-01T00:00:00.000Z",
      to: "2026-05-29T00:00:00.000Z",
      usageKwh: 1_000,
      averageDailyUsageKwh: 35.71,
      peakKw: 90,
      nonOperatingSharePct: 12,
      keyFindings: ["Closed-hours lighting is the first priority"],
    });
    const current = snapshot({
      snapshotId: "snapshot-b",
      releaseId: "release-b",
      from: "2026-05-08T00:00:00.000Z",
      to: "2026-06-05T00:00:00.000Z",
      usageKwh: 1_100,
      averageDailyUsageKwh: 39.29,
      peakKw: 81,
      nonOperatingSharePct: 10,
    });
    const currentAi = aiArtifact("snapshot-b", "release-b", [
      "G, M and J remain high after normalisation",
      "Closed-hours lighting remains the first priority",
    ]);

    const result = buildOverviewChangeSummary({ previous, current, currentAiArtifact: currentAi });

    expect(result.previous).toMatchObject({ analysisId: "saved-a", snapshotId: "snapshot-a", projectReleaseId: "release-a" });
    expect(result.current).toMatchObject({ snapshotId: "snapshot-b", projectReleaseId: "release-b" });
    expect(result.metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "usage", previousValue: 1_000, currentValue: 1_100, delta: 100, deltaPct: 10 }),
      expect.objectContaining({ id: "peak", previousValue: 90, currentValue: 81, delta: -9, deltaPct: -10 }),
      expect.objectContaining({ id: "closed-hours-share", previousValue: 12, currentValue: 10, delta: -2, unit: "%" }),
    ]));
    expect(result.ai.keyFindingsChanged).toBe(true);
    expect(result.ai.previousKeyFindings).toEqual(["Closed-hours lighting is the first priority"]);
    expect(result.ai.currentKeyFindings).toEqual([
      "G, M and J remain high after normalisation",
      "Closed-hours lighting remains the first priority",
    ]);
    expect(result.ai.keyFindingChanges).toEqual([
      expect.objectContaining({
        state: "new",
        currentTitle: "G, M and J remain high after normalisation",
      }),
      expect.objectContaining({
        state: "new",
        currentTitle: "Closed-hours lighting remains the first priority",
      }),
      expect.objectContaining({ state: "removed", previousTitle: "Closed-hours lighting is the first priority" }),
    ]);
  });

  it("classifies retained, updated, new, and removed Key Findings without matching unrelated conclusions", () => {
    const previous = savedDetail({
      id: "saved-a",
      sequence: 1,
      snapshotId: "snapshot-a",
      keyFindings: [
        "Closed-hours lighting remains the first priority",
        "Centre H has the highest per-person intensity",
        "Old planning assumption",
      ],
      keyFindingTexts: [
        "Lighting remains the largest supported closed-hours signal.",
        "Centre H ranks first per person under the current metadata.",
        "The old plan was based on May only.",
      ],
    });
    const current = snapshot({ snapshotId: "snapshot-b", releaseId: "release-b" });
    const currentAi = aiArtifact(
      "snapshot-b",
      "release-b",
      [
        "Closed-hours lighting remains the first priority",
        "Centre H has the highest per-person intensity",
        "Load mix is not represented in Centre priority flags",
      ],
      [
        "Lighting remains the largest supported closed-hours signal.",
        "Centre H still ranks first per person, but the headcount remains provisional.",
        "Load contributes most energy while Centre flags use normalised intensity.",
      ],
    );

    const result = buildOverviewChangeSummary({ previous, current, currentAiArtifact: currentAi });

    expect(result?.ai.generationBasisStatus).toBe("unversioned");
    expect(result?.ai.keyFindingChanges).toEqual([
      expect.objectContaining({
        state: "retained",
        previousTitle: "Closed-hours lighting remains the first priority",
        currentTitle: "Closed-hours lighting remains the first priority",
      }),
      expect.objectContaining({
        state: "updated",
        previousTitle: "Centre H has the highest per-person intensity",
        currentTitle: "Centre H has the highest per-person intensity",
      }),
      expect.objectContaining({ state: "new", currentTitle: "Load mix is not represented in Centre priority flags" }),
      expect.objectContaining({ state: "removed", previousTitle: "Old planning assumption" }),
    ]);
  });

  it("does not call similar conclusions an update when they come from different Sections", () => {
    const previous = savedDetail({
      id: "saved-a",
      sequence: 1,
      snapshotId: "snapshot-a",
      keyFindings: ["Centre L closed-hours spike needs review"],
      keyFindingTexts: ["The closed-hours event is the supported signal."],
    });
    const current = snapshot({ snapshotId: "snapshot-b", releaseId: "release-b" });
    const currentAi = aiArtifact(
      "snapshot-b",
      "release-b",
      ["Centre L operating-hours spike needs review"],
      ["The operating-hours event is the supported signal."],
    );
    setKeyFindingSection(previous.aiArtifact!, 0, "standby-wastage");
    setKeyFindingSection(currentAi, 0, "operating-behaviour");

    const result = buildOverviewChangeSummary({ previous, current, currentAiArtifact: currentAi });

    expect(result?.ai.keyFindingChanges).toEqual([
      expect.objectContaining({ state: "new", currentTitle: "Centre L operating-hours spike needs review" }),
      expect.objectContaining({ state: "removed", previousTitle: "Centre L closed-hours spike needs review" }),
    ]);
  });

  it("classifies Section interpretations and Additional Insights across the two exact Snapshots", () => {
    const previous = savedDetail({ id: "saved-a", sequence: 1, snapshotId: "snapshot-a" });
    const current = snapshot({ snapshotId: "snapshot-b", releaseId: "release-b" });
    const currentAi = aiArtifact("snapshot-b", "release-b", []);
    setSectionResult(previous.aiArtifact!, "centre-benchmark", "Previous benchmark summary");
    setSectionResult(currentAi, "centre-benchmark", "Updated benchmark summary");
    setSectionResult(previous.aiArtifact!, "standby-wastage", "Previous closed-hours summary");
    setAdditionalFindings(previous.aiArtifact!, [
      ["Load mix is missing from priority flags", "The load category dominates energy."],
      ["Old exploratory angle", "This angle did not persist."],
    ]);
    setAdditionalFindings(currentAi, [
      ["Load mix is missing from priority flags", "The load category dominates energy."],
      ["New controllability angle", "A different operational angle is now supported."],
    ]);

    const result = buildOverviewChangeSummary({ previous, current, currentAiArtifact: currentAi });

    expect(result?.ai.sectionChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({ sectionId: "centre-benchmark", state: "updated" }),
      expect.objectContaining({ sectionId: "standby-wastage", state: "removed" }),
    ]));
    expect(result?.ai.additionalFindingChanges).toEqual([
      expect.objectContaining({ state: "retained", currentTitle: "Load mix is missing from priority flags" }),
      expect.objectContaining({ state: "new", currentTitle: "New controllability angle" }),
      expect.objectContaining({ state: "removed", previousTitle: "Old exploratory angle" }),
    ]);
  });

  it("orders only earlier same-project/scope/resource snapshots and verifies renderer compatibility on detail", () => {
    const current = snapshot({ snapshotId: "snapshot-current", releaseId: "release-current" });
    const candidates: EnergySavedAnalysisSummaryDto[] = [
      summary({ id: "wrong-project", projectId: "other", sequence: 9, snapshotId: "snapshot-x" }),
      summary({ id: "current-copy", sequence: 8, snapshotId: "snapshot-current" }),
      summary({ id: "older", sequence: 3, snapshotId: "snapshot-a" }),
      summary({ id: "newer", sequence: 7, snapshotId: "snapshot-b" }),
    ];

    expect(orderPreviousOverviewCandidates({ items: candidates, current }).map(({ id }) => id)).toEqual(["newer", "older"]);
    expect(isCompatiblePreviousOverview(savedDetail({ id: "newer", sequence: 7, snapshotId: "snapshot-b" }), current)).toBe(true);
    expect(isCompatiblePreviousOverview(savedDetail({
      id: "wrong-renderer",
      sequence: 6,
      snapshotId: "snapshot-c",
      rendererKey: "ngee-ann-overview",
    }), current)).toBe(false);
  });

  it("orders across Saved series by globally comparable creation time instead of per-series sequence", () => {
    const current = snapshot({ snapshotId: "snapshot-current", releaseId: "release-current" });
    const olderHighSequence = summary({
      id: "older-high-sequence",
      sequence: 100,
      seriesId: "series-old",
      snapshotId: "snapshot-old",
      createdAt: "2026-08-10T00:00:00.000Z",
    });
    const newerLowSequence = summary({
      id: "newer-low-sequence",
      sequence: 1,
      seriesId: "series-new",
      snapshotId: "snapshot-new",
      createdAt: "2026-08-15T00:00:00.000Z",
    });

    expect(orderPreviousOverviewCandidates({
      items: [olderHighSequence, newerLowSequence],
      current,
    }).map(({ id }) => id)).toEqual(["newer-low-sequence", "older-high-sequence"]);
  });

  it("withholds misleading metric deltas when the window or deterministic metric basis differs", () => {
    const current = snapshot({ snapshotId: "snapshot-current", releaseId: "release-current" });
    const shorterWindow = savedDetail({
      id: "shorter",
      sequence: 1,
      snapshotId: "snapshot-short",
      from: "2026-05-29T00:00:00.000Z",
      to: "2026-06-05T00:00:00.000Z",
    });
    const differentMetricBasis = savedDetail({
      id: "different-metric",
      sequence: 2,
      snapshotId: "snapshot-metric",
      metricVersion: "energy-metrics-v2",
    });
    const futureWindow = savedDetail({
      id: "future",
      sequence: 3,
      snapshotId: "snapshot-future",
      from: "2026-05-15T00:00:00.000Z",
      to: "2026-06-12T00:00:00.000Z",
    });
    const sameCutoff = savedDetail({
      id: "same-cutoff",
      sequence: 4,
      snapshotId: "snapshot-ambiguous",
      lastSeenAt: "2026-06-05T00:00:00.000Z",
    });

    expect(isCompatiblePreviousOverview(shorterWindow, current)).toBe(false);
    expect(isCompatiblePreviousOverview(differentMetricBasis, current)).toBe(true);
    expect(isCompatiblePreviousOverview(futureWindow, current)).toBe(false);
    expect(isCompatiblePreviousOverview(sameCutoff, current)).toBe(false);
    expect(buildOverviewChangeSummary({
      previous: shorterWindow,
      current,
      currentAiArtifact: null,
    })).toBeNull();
    expect(buildOverviewChangeSummary({
      previous: differentMetricBasis,
      current,
      currentAiArtifact: null,
    })).toMatchObject({
      metrics: [],
      provenance: { deterministicBasisStatus: "changed", attribution: "unversioned" },
    });
  });

  it("does not reuse a stale current Artifact and detects same-title finding content changes", () => {
    const previous = savedDetail({
      id: "saved-a",
      sequence: 1,
      snapshotId: "snapshot-a",
      keyFindings: ["Same title"],
      keyFindingTexts: ["Previous explanation"],
    });
    const current = snapshot({ snapshotId: "snapshot-b", releaseId: "release-b" });
    const staleCurrentAi = aiArtifact("snapshot-other", "release-other", ["Same title"]);

    const stale = buildOverviewChangeSummary({ previous, current, currentAiArtifact: staleCurrentAi });
    expect(stale?.ai.currentStatus).toBe("not-available");
    expect(stale?.ai.keyFindingsChanged).toBeNull();

    const wrongWorkspace = aiArtifact("snapshot-b", "release-b", ["Same title"]);
    if (wrongWorkspace.contract === "energyiq-saved-ai-result@2") {
      wrongWorkspace.result.binding.workspaceId = "other-workspace";
    }
    expect(buildOverviewChangeSummary({
      previous,
      current,
      currentAiArtifact: wrongWorkspace,
    })?.ai.currentStatus).toBe("not-available");

    const currentAi = aiArtifact("snapshot-b", "release-b", ["Same title"], ["Current explanation"]);
    const changed = buildOverviewChangeSummary({ previous, current, currentAiArtifact: currentAi });
    expect(changed?.ai.keyFindingsChanged).toBe(true);

    setReportTimeContext(current, {
      policyRevision: "v2",
      windowId: "current-month-progress",
      from: "2026-06-01T00:00:00.000Z",
      toExclusive: "2026-06-05T00:00:00.000Z",
    });
    expect(buildOverviewChangeSummary({
      previous,
      current,
      currentAiArtifact: currentAi,
    })?.ai.currentStatus).toBe("not-available");
    currentAi.reportTimeBasis = reportTimeBasisFromContext(current.reportTimeContext!);
    const wrongTimeBasis = structuredClone(currentAi);
    if (!wrongTimeBasis.reportTimeBasis) throw new Error("TEST_REPORT_TIME_BASIS_REQUIRED");
    wrongTimeBasis.reportTimeBasis.policyRevision = "stale-policy";
    expect(buildOverviewChangeSummary({
      previous,
      current,
      currentAiArtifact: wrongTimeBasis,
    })?.ai.currentStatus).toBe("not-available");
  });

  it("separates conclusion changes from Evidence lineage and discloses legacy model-basis uncertainty", () => {
    const previous = savedDetail({
      id: "saved-legacy",
      sequence: 1,
      snapshotId: "snapshot-a",
      rendererKey: "ngee-ann-overview",
    });
    previous.aiArtifact = legacyAiArtifact("snapshot-a", "release-a", "Same recommendation", "evidence:a");
    const current = snapshot({
      snapshotId: "snapshot-b",
      releaseId: "release-b",
      rendererKey: "ngee-ann-overview",
    });
    const currentAi = legacyAiArtifact("snapshot-b", "release-b", "Same recommendation", "evidence:b");

    const result = buildOverviewChangeSummary({ previous, current, currentAiArtifact: currentAi });

    expect(result?.ai.generationBasisStatus).toBe("unversioned");
    expect(result?.ai.keyFindingsChanged).toBe(false);
    expect(result?.ai.keyFindingEvidenceChanged).toBe(true);

    const explanationChanged = legacyAiArtifact(
      "snapshot-b",
      "release-b",
      "Same recommendation",
      "evidence:b",
      "A different operational explanation",
    );
    expect(buildOverviewChangeSummary({
      previous,
      current,
      currentAiArtifact: explanationChanged,
    })?.ai.keyFindingsChanged).toBe(true);
  });
});

function snapshot(input: {
  snapshotId: string;
  releaseId: string;
  from?: string;
  to?: string;
  usageKwh?: number;
  averageDailyUsageKwh?: number;
  peakKw?: number;
  nonOperatingSharePct?: number;
  rendererKey?: "preschool-overview" | "ngee-ann-overview";
  metricVersion?: string;
  lastSeenAt?: string | null;
}): EnergyProjectAnalysisSnapshotDto {
  return {
    context: {
      projectId: "preschool-demo",
      scopeId: "project",
      resource: "electricity",
      from: input.from ?? "2026-05-08T00:00:00.000Z",
      to: input.to ?? "2026-06-05T00:00:00.000Z",
      timezone: "Asia/Singapore",
      userId: "admin",
      workspaceId: "preschool-demo-org",
      projectName: "Preschool Demo",
      scopeName: "All centres",
      scopeType: "project",
      endExclusive: true,
      period: "Custom",
      hierarchyRevisionId: "hierarchy-v1",
      meterMappingRevisionId: "mapping-v1",
      meterFormulaRevisionId: "formula-v1",
      metricVersion: input.metricVersion ?? "energy-metrics-v1",
      businessCalendarVersion: "calendar-v1",
      tariffScheduleVersion: "tariff-v1",
      resolvedAt: "2026-08-15T00:00:00.000Z",
      dataSnapshotId: input.snapshotId,
      primaryPeriod: {
        start: input.from ?? "2026-05-08T00:00:00.000Z",
        endExclusive: input.to ?? "2026-06-05T00:00:00.000Z",
      },
      projectReleaseId: input.releaseId,
    },
    renderer: { key: input.rendererKey ?? "preschool-overview", version: "1", contractVersion: "project-analysis-snapshot@1" },
    projectRelease: { id: input.releaseId },
    recipe: { id: "energy-scope-analysis", version: "1" },
    dataSnapshot: {
      id: input.snapshotId,
      importBatchIds: [],
      lastSeenAt: input.lastSeenAt === undefined ? "2026-06-05T00:00:00.000Z" : input.lastSeenAt,
    },
    analysis: {
      summary: {
        usageKwh: input.usageKwh ?? 1_000,
        averageDailyUsageKwh: input.averageDailyUsageKwh ?? 35.71,
        peakKw: input.peakKw ?? 90,
        nonOperatingSharePct: input.nonOperatingSharePct ?? 12,
      },
    },
  } as unknown as EnergyProjectAnalysisSnapshotDto;
}

function setReportTimeContext(
  value: EnergyProjectAnalysisSnapshotDto,
  input: {
    policyRevision: string;
    windowId: string;
    from: string;
    toExclusive: string;
  },
): void {
  value.reportTimeContext = {
    contractRevision: "energyiq-report-time-context@1",
    binding: {
      workspaceId: value.context.workspaceId,
      projectId: value.context.projectId,
      scopeId: value.context.scopeId,
      resource: value.context.resource,
      dataSnapshotId: value.dataSnapshot.id,
      projectReleaseId: value.projectRelease.id,
    },
    timezone: value.context.timezone,
    asOf: input.toExclusive,
    acceptedDataEndExclusive: input.toExclusive,
    dataThroughLocalDate: input.toExclusive.slice(0, 10),
    lastRefreshedAt: input.toExclusive,
    policyId: "project-overview-time",
    policyRevision: input.policyRevision,
    windows: [{
      windowId: input.windowId,
      role: "primary",
      label: input.windowId,
      strategy: input.windowId === "current-month-progress"
        ? { kind: "calendar_month_to_date" }
        : { kind: "rolling_complete_days", days: 28 },
      phase: input.windowId === "current-month-progress" ? "partial" : "complete",
      from: input.from,
      toExclusive: input.toExclusive,
      completeDayCount: Math.max(0, Math.round(
        (Date.parse(input.toExclusive) - Date.parse(input.from)) / 86_400_000,
      )),
      segments: [{ from: input.from, toExclusive: input.toExclusive }],
      comparisonCompatibilityKey: input.windowId,
    }],
  };
}

function savedDetail(input: {
  id: string;
  sequence: number;
  snapshotId: string;
  releaseId?: string;
  from?: string;
  to?: string;
  usageKwh?: number;
  averageDailyUsageKwh?: number;
  peakKw?: number;
  nonOperatingSharePct?: number;
  keyFindings?: string[];
  keyFindingTexts?: string[];
  rendererKey?: "preschool-overview" | "ngee-ann-overview";
  metricVersion?: string;
  lastSeenAt?: string | null;
}): EnergySavedAnalysisDetailDto {
  const frozen = snapshot({
    snapshotId: input.snapshotId,
    releaseId: input.releaseId ?? "release-a",
    from: input.from,
    to: input.to,
    usageKwh: input.usageKwh,
    averageDailyUsageKwh: input.averageDailyUsageKwh,
    peakKw: input.peakKw,
    nonOperatingSharePct: input.nonOperatingSharePct,
    rendererKey: input.rendererKey,
    metricVersion: input.metricVersion,
    lastSeenAt: input.lastSeenAt ?? "2026-06-04T00:00:00.000Z",
  });
  return {
    ...summary({ id: input.id, sequence: input.sequence, snapshotId: input.snapshotId }),
    snapshot: frozen,
    analysis: frozen.analysis,
    aiArtifact: aiArtifact(
      input.snapshotId,
      input.releaseId ?? "release-a",
      input.keyFindings ?? [],
      input.keyFindingTexts,
      input.from,
      input.to,
    ),
  } as unknown as EnergySavedAnalysisDetailDto;
}

function summary(input: {
  id: string;
  sequence: number;
  snapshotId: string;
  projectId?: string;
  seriesId?: string;
  createdAt?: string;
}): EnergySavedAnalysisSummaryDto {
  return {
    id: input.id,
    seriesId: input.seriesId ?? "series-1",
    sequence: input.sequence,
    projectId: input.projectId ?? "preschool-demo",
    scopeId: "project",
    scopeName: "All centres",
    resource: "electricity",
    title: `Overview ${input.sequence}`,
    templateRevisionId: "template-v1",
    dataSnapshotId: input.snapshotId,
    createdBy: "admin",
    createdAt: input.createdAt ?? `2026-08-${String(input.sequence).padStart(2, "0")}T00:00:00.000Z`,
  };
}

function aiArtifact(
  snapshotId: string,
  projectReleaseId: string,
  keyFindings: string[],
  keyFindingTexts?: string[],
  from = "2026-05-08T00:00:00.000Z",
  to = "2026-06-05T00:00:00.000Z",
): EnergySavedAnalysisAiArtifactInputDto {
  return {
    contract: "energyiq-saved-ai-result@2",
    rendererKey: "preschool-overview",
    snapshotId,
    projectReleaseId,
    result: {
      artifactKind: "preschool-overview-ai-read-model",
      status: "available",
      binding: {
        workspaceId: "preschool-demo-org",
        projectId: "preschool-demo",
        scopeId: "project",
        dataSnapshotId: snapshotId,
        projectReleaseId,
        analysisPeriod: { from, to },
        modelProfileId: "workspace-default",
        modelProfileRevision: 8,
      },
      sections: {
        "centre-benchmark": { status: "unavailable", reason: "Not generated." },
        "standby-wastage": { status: "unavailable", reason: "Not generated." },
        "operating-behaviour": { status: "unavailable", reason: "Not generated." },
        "planning-outlook": { status: "unavailable", reason: "Not generated." },
      },
      executive: {
        status: "available",
        artifactId: `executive-${snapshotId}`,
        result: {
          artifactKind: "executive-synthesis",
          status: "available",
          providerProfileId: "workspace-default",
          runId: `run-${snapshotId}`,
          contract: {
            id: "preschool-executive-synthesis",
            revision: "preschool-executive-synthesis-v4",
          },
          binding: {
            workspaceId: "preschool-demo-org",
            projectId: "preschool-demo",
            scopeId: "project",
            dataSnapshotId: snapshotId,
            projectReleaseId,
            analysisPeriod: { from, to },
            modelProfileId: "workspace-default",
            modelProfileRevision: 8,
          },
          sourceSectionArtifactIds: [],
          summary: { text: "Current summary", evidenceRefs: ["evidence:summary"] },
          findings: keyFindings.map((title, index) => ({
            id: `finding-${index}`,
            title,
            text: keyFindingTexts?.[index] ?? title,
            sectionIds: ["centre-benchmark"],
            evidenceRefs: [`evidence:${index}`],
          })),
        },
      },
    },
  };
}

function projectAiArtifact(
  snapshotId: string,
  projectReleaseId: string,
  findingTitle: string,
): EnergySavedAnalysisAiArtifactInputDto {
  const unitGeneration = {
    rendererVersion: "1",
    analysisPackId: "ngee-ann-section-pack",
    analysisPackRevision: "v1",
    outputContractRevision: "energyiq-project-section-interpretation-v1",
    validatorRevision: "energyiq-project-section-acceptance-v5",
    workflowRevision: "energyiq-project-section-discover-publish-v1",
    investigatorPromptRevision: "energyiq-project-section-discovery-v3",
    editorPromptRevision: "not-applicable-v1",
    methodSkillId: "none",
    methodSkillRevision: "not-applicable-v1",
    identityContractRevision: "ngee-ann-section-v6",
  };
  return {
    contract: "energyiq-saved-ai-result@3",
    rendererKey: "ngee-ann-overview",
    snapshotId,
    projectReleaseId,
    result: {
      contract: "energyiq-project-overview-ai-read-model@1",
      rendererKey: "ngee-ann-overview",
      binding: {
        workspaceId: "preschool-demo-org",
        projectId: "preschool-demo",
        scopeId: "project",
        dataSnapshotId: snapshotId,
        projectReleaseId,
        analysisPeriod: {
          from: "2026-05-08T00:00:00.000Z",
          to: "2026-06-05T00:00:00.000Z",
        },
        modelProfileId: "workspace-default",
        modelProfileRevision: 8,
        generation: {
          rendererVersion: "1",
          analysisPackId: "ngee-ann-analysis-pack",
          analysisPackRevision: "v1",
          outputContractRevision: "energyiq-project-overview-ai-v1",
          validatorRevision: "energyiq-project-overview-ai-v1",
          workflowRevision: "energyiq-project-overview-ai-v1",
          investigatorPromptRevision: "energyiq-project-overview-ai-v1",
          editorPromptRevision: "not-applicable-v1",
          methodSkillId: "none",
          methodSkillRevision: "not-applicable-v1",
          units: {
            keyFindings: { ...unitGeneration, identityContractRevision: "ngee-ann-executive-v4" },
            sections: { "time-behaviour": { ...unitGeneration } },
            additionalInsights: {
              ...unitGeneration,
              identityContractRevision: "ngee-ann-additional-insights-v4",
            },
          },
        },
      },
      keyFindings: {
        status: "available",
        artifactId: `executive:${snapshotId}`,
        result: {
          findings: [{
            id: "finding-1",
            title: findingTitle,
            text: findingTitle,
            sectionIds: ["time-behaviour"],
            evidenceRefs: ["evidence:time"],
          }],
        },
      },
      sections: {
        "time-behaviour": { status: "empty", artifactId: `section:${snapshotId}` },
      },
      additionalInsights: { status: "empty", artifactId: `additional:${snapshotId}` },
    },
  };
}

function legacyAiArtifact(
  snapshotId: string,
  projectReleaseId: string,
  title: string,
  evidenceRef: string,
  what = "Same operational explanation",
): EnergySavedAnalysisAiArtifactInputDto {
  return {
    contract: "energyiq-saved-ai-result@1",
    rendererKey: "ngee-ann-overview",
    snapshotId,
    projectReleaseId,
    result: {
      status: "available",
      providerProfileId: "workspace-default",
      runId: `run-${snapshotId}`,
      findings: [{ title, what, evidenceRefs: [evidenceRef], binding: { dataSnapshotId: snapshotId } }],
    },
  };
}

function setKeyFindingSection(
  artifact: EnergySavedAnalysisAiArtifactInputDto,
  index: number,
  sectionId: "centre-benchmark" | "standby-wastage" | "operating-behaviour" | "planning-outlook",
): void {
  if (artifact.contract !== "energyiq-saved-ai-result@2") throw new Error("sectioned artifact required");
  const executive = artifact.result.executive;
  if (executive.status !== "available" || !("findings" in executive.result)) {
    throw new Error("v4 executive finding required");
  }
  const finding = executive.result.findings[index];
  if (!finding) throw new Error("key finding required");
  finding.sectionIds = [sectionId];
}

function setSectionResult(
  artifact: EnergySavedAnalysisAiArtifactInputDto,
  sectionId: "centre-benchmark" | "standby-wastage" | "operating-behaviour" | "planning-outlook",
  summaryText: string,
): void {
  if (artifact.contract !== "energyiq-saved-ai-result@2") throw new Error("sectioned artifact required");
  const binding = artifact.result.binding;
  artifact.result.sections[sectionId] = {
    status: "available",
    artifactId: `${sectionId}-${artifact.snapshotId}`,
    result: {
      artifactKind: "section-interpretation",
      providerProfileId: binding.modelProfileId,
      runId: `run-${sectionId}-${artifact.snapshotId}`,
      contract: { id: "preschool-section-interpretation", revision: "preschool-section-interpretation-v4" },
      binding,
      sectionId,
      packRevision: "v2",
      capability: { revision: "scoped-read-only-v1", mode: "scoped-read-only", tools: [] },
      toolAudits: [],
      status: "available",
      summary: { text: summaryText, evidenceRefs: [`evidence:${sectionId}`] },
      insights: [],
      publication: {
        policyId: "preschool-section-publication",
        policyRevision: "v1",
        discoveredCount: 0,
        acceptedCount: 0,
        rejectedCount: 0,
        publishedCount: 0,
        suppressedCandidateIds: [],
      },
    },
  };
}

function setAdditionalFindings(
  artifact: EnergySavedAnalysisAiArtifactInputDto,
  findings: Array<[title: string, text: string]>,
): void {
  if (artifact.contract !== "energyiq-saved-ai-result@2") throw new Error("sectioned artifact required");
  (artifact.result as unknown as { additional: unknown }).additional = {
    status: "available",
    artifactId: `additional-${artifact.snapshotId}`,
    result: {
      artifactKind: "autonomous-insights",
      status: "available",
      providerProfileId: artifact.result.binding.modelProfileId,
      runId: `run-additional-${artifact.snapshotId}`,
      contract: { id: "energyiq-additional-ai-insights", revision: "additional-insights-output-v3" },
      binding: artifact.result.binding,
      methodExecution: {
        methodSetId: "method-set",
        methodSetRevision: "1",
        methodSetFingerprint: "method-set-fingerprint",
        loadedMethods: [],
      },
      capability: { revision: "v1", mode: "scoped-read-only", allowedTools: [], usedTools: [] },
      toolAudits: [],
      evidenceLineage: { contract: "additional-ai-insights-evidence@1", catalog: [] },
      publication: {
        policyId: "energyiq-additional-ai-insights",
        policyRevision: "v2",
        discoveredCount: findings.length,
        acceptedCount: findings.length,
        rejectedCount: 0,
        publishedCount: findings.length,
        sourceOrderCandidateIds: findings.map((_, index) => `candidate-${index}`),
        acceptedCandidateIds: findings.map((_, index) => `candidate-${index}`),
        rejectedCandidateIds: [],
        publishedCandidateIds: findings.map((_, index) => `candidate-${index}`),
        suppressedCandidateIds: [],
      },
      findings: findings.map(([title, text], index) => ({
        id: `additional-${index}`,
        title,
        text,
        epistemicStatus: "inferred",
        evidenceRefs: [`evidence:additional:${index}`],
      })),
    },
  };
}
