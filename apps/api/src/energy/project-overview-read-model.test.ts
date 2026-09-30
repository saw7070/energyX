import { describe, expect, it } from "vitest";

import type { ProjectAnalysisResolution } from "./project-analysis-resolver.js";
import {
  resolveProjectOverviewDailyUsageAnomalyDetail,
  toProjectOverviewReadModel,
} from "./project-overview-read-model.js";

describe("Project Overview Read Model", () => {
  it("keeps internal Preschool analysis-ready Evidence out of the customer Overview payload", () => {
    const authoritative = preschoolInternalEvidenceResolution();

    const publicReadModel = toProjectOverviewReadModel(authoritative);
    if (publicReadModel.status !== "ready") throw new Error("Expected a ready Overview");

    expect("analysisReady" in publicReadModel.snapshot.preschoolOperational!).toBe(false);
    expect(publicReadModel.snapshot).not.toHaveProperty("reportWindowAnalyses");
    expect(publicReadModel.snapshot.preschoolOperational).toMatchObject({
      status: "available",
      energy: { totalKwh: 1_234 },
    });
    expect(Buffer.byteLength(JSON.stringify(publicReadModel), "utf8")).toBeLessThan(20_000);

    expect(authoritative.snapshot.preschoolOperational).toHaveProperty("analysisReady");
    expect(authoritative.snapshot.reportWindowAnalyses).toHaveLength(1);
  });

  it("keeps decision values and triggered drill-down under a 1.8 MB public payload while omitted detail remains exactly retrievable", () => {
    const authoritative = realScaleNgeeAnnResolution();
    const authoritativeJson = JSON.stringify(authoritative);
    expect(Buffer.byteLength(authoritativeJson, "utf8")).toBeGreaterThan(3_000_000);

    const publicReadModel = toProjectOverviewReadModel(authoritative);
    if (publicReadModel.status !== "ready") throw new Error("Expected a ready Overview");

    expect(Buffer.byteLength(JSON.stringify(publicReadModel), "utf8")).toBeLessThanOrEqual(1_800_000);
    expect(publicReadModel.snapshot.analysis.summary).toMatchObject({
      usageKwh: 4_476.19,
      averageDailyUsageKwh: 235.59,
    });
    expect(publicReadModel.snapshot.analysis.offHours).toMatchObject({
      status: "available",
      sharePct: 50.4,
    });

    const publicBundle = publicReadModel.snapshot.analysis.dailyUsageAnomalies;
    const authoritativeBundle = authoritative.snapshot.analysis.dailyUsageAnomalies;
    if (publicBundle?.status !== "available" || authoritativeBundle?.status !== "available") {
      throw new Error("Expected available daily anomaly Evidence");
    }
    const publicRows = publicBundle.scopes.flatMap((scope) => scope.rows);
    const authoritativeRows = authoritativeBundle.scopes.flatMap((scope) => scope.rows);
    expect(publicRows.filter((row) => row.outcome === "triggered")).toHaveLength(4);
    expect(publicRows.filter((row) => row.outcome === "triggered").map((row) => row.detailSeries))
      .toEqual(authoritativeRows.filter((row) => row.outcome === "triggered").map((row) => row.detailSeries));
    expect(publicRows.filter((row) => row.outcome !== "triggered")
      .every((row) => row.detailSeries.length === 0)).toBe(true);

    const omitted = authoritativeRows.find((row) => row.outcome === "within_threshold");
    if (!omitted) throw new Error("Expected an omitted non-triggered row");
    const exactDetail = resolveProjectOverviewDailyUsageAnomalyDetail(authoritative, {
      expectedDataSnapshotId: authoritative.snapshot.dataSnapshot.id,
      expectedProjectReleaseId: authoritative.snapshot.projectRelease.id,
      bundleId: authoritativeBundle.bundleId,
      incidentId: omitted.incidentId,
    });
    expect(exactDetail).toMatchObject({
      contract: "energyiq-daily-usage-anomaly-detail@1",
      binding: {
        dataSnapshotId: authoritative.snapshot.dataSnapshot.id,
        projectReleaseId: authoritative.snapshot.projectRelease.id,
        bundleId: authoritativeBundle.bundleId,
        incidentId: omitted.incidentId,
      },
      evidencePins: authoritativeBundle.evidencePins,
    });
    expect(exactDetail.detailSeries).toEqual(omitted.detailSeries);
    expect(authoritative.snapshot.analysis.dailyUsageAnomalies).toEqual(authoritativeBundle);
  });

  it("fails closed with the existing conflict contract when the requested Snapshot has advanced", () => {
    const authoritative = realScaleNgeeAnnResolution();
    expect(() => resolveProjectOverviewDailyUsageAnomalyDetail(authoritative, {
      expectedDataSnapshotId: "energy-snapshot-stale",
      expectedProjectReleaseId: authoritative.snapshot.projectRelease.id,
      bundleId: "daily-usage-anomalies:stale",
      incidentId: "daily-usage-incident:0:2026-08-05",
    })).toThrow("ENERGYIQ_DATA_SNAPSHOT_MISMATCH");
  });
});

const preschoolInternalEvidenceResolution = (): Extract<ProjectAnalysisResolution, { status: "ready" }> => ({
  status: "ready",
  snapshot: {
    context: {
      workspaceId: "preschool-demo-org",
      projectId: "preschool-demo",
      scopeId: "project",
      dataSnapshotId: "preschool-snapshot",
      projectReleaseId: "preschool-demo-template-v2",
    },
    projectRelease: { id: "preschool-demo-template-v2" },
    renderer: { key: "preschool-overview", version: "1", contractVersion: "project-analysis-snapshot@1" },
    dataSnapshot: { id: "preschool-snapshot" },
    reportWindowAnalyses: [{
      windowId: "current-month-progress",
      period: { start: "2026-06-01", endExclusive: "2026-07-01" },
      status: "ready",
      analysis: { dailyTotals: "x".repeat(600_000) },
    }],
    preschoolOperational: {
      status: "available",
      energy: { totalKwh: 1_234 },
      analysisReady: {
        contract: { id: "preschool-operational-analysis-ready", version: "1" },
        eventCatalog: { events: ["x".repeat(4_000_000)] },
        recurrence: { rows: [] },
      },
    },
    analysis: {
      summary: { usageKwh: 1_234 },
    },
  },
} as unknown as Extract<ProjectAnalysisResolution, { status: "ready" }>);

const realScaleNgeeAnnResolution = (): Extract<ProjectAnalysisResolution, { status: "ready" }> => {
  const snapshotId = "energy-snapshot-fa2cb43ae24f8e8352eb24a0";
  const releaseId = "ngee-ann-polytechnic-template-v10";
  const evidencePins = {
    projectReleaseId: releaseId,
    dataSnapshotId: snapshotId,
    hierarchyRevisionId: "ngee-ann-hierarchy-v1",
    meterMappingRevisionId: "ngee-ann-mapping-v4",
    meterFormulaRevisionId: "ngee-ann-formula-v1",
    metricVersion: "energy.total_usage_kwh@1",
    businessCalendarVersion: "ngee-ann-calendar-v1",
    queryIds: ["time_slot_anomaly_v1"],
  };
  let globalRow = 0;
  const scopes = ["project", "level-7", "level-6"].map((scopeId, scopeIndex) => ({
    scopeId,
    scopeName: scopeId === "project" ? "Ngee Ann Polytechnic" : `Level ${8 - scopeIndex}`,
    scopeType: scopeId === "project" ? "project" : "level",
    rollingComparisons: [],
    rows: Array.from({ length: 19 }, (_, dayIndex) => {
      const rowIndex = globalRow++;
      const triggered = rowIndex < 4;
      const localDate = `2026-08-${String(dayIndex + 1).padStart(2, "0")}`;
      const incidentId = `daily-usage-incident:${scopeIndex}:${localDate}`;
      return {
        anomalyId: `daily-usage-above-baseline:${scopeId}:${localDate}`,
        incidentId,
        ruleRevisionId: "comparison.daily_usage_above_baseline@1",
        metricId: "energy.total_usage_kwh@1",
        queryId: "time_slot_anomaly_v1",
        localDate,
        from: `${localDate}T00:00:00.000+08:00`,
        to: `${localDate}T23:59:59.999+08:00`,
        dayType: "weekday",
        baselineDates: ["2026-07-01", "2026-07-08", "2026-07-15", "2026-07-22"],
        baselineSampleCount: 4,
        baselineSamples: [],
        actualKwh: triggered ? 280 : 220,
        baselineKwh: 200,
        impactKwh: triggered ? 80 : 20,
        relativePct: triggered ? 40 : 10,
        thresholds: {
          relativeThresholdPct: 20,
          absoluteImpactKwh: 50,
          minimumCoveragePct: 95,
          maximumQualityEventCount: 0,
        },
        coveragePct: 100,
        expectedMeterIntervalCount: 96,
        validIntervalCount: 96,
        qualityEventCount: 0,
        outcome: triggered ? "triggered" : "within_threshold",
        hourlyComparison: [],
        detailSeries: Array.from({ length: 24 }, (_, seriesIndex) => ({
          seriesId: `${incidentId}:series:${seriesIndex}`,
          relationship: seriesIndex === 0 ? "selected_scope" : "component_circuit",
          kind: seriesIndex === 0 ? "official_scope" : "component_circuit",
          scopeId: `${scopeId}:detail:${seriesIndex}`,
          scopeName: `${scopeId} detail ${seriesIndex + 1}`,
          ...(seriesIndex === 0 ? {} : {
            meterNodeId: `${scopeId}:meter:${seriesIndex}`,
            category: seriesIndex % 2 === 0 ? "light" : "load",
          }),
          includedInOfficialTotal: seriesIndex === 0,
          status: "available",
          selectedTotalKwh: 100 + seriesIndex,
          baselineTotalKwh: 90 + seriesIndex,
          impactKwh: 10,
          relativePct: 11.1111,
          coveragePct: 100,
          expectedMeterIntervalCount: 96,
          validIntervalCount: 96,
          qualityEventCount: 0,
          points: Array.from({ length: 24 }, (_, localHour) => ({
            localHour,
            selectedKwh: 5 + localHour / 10,
            baselineKwh: 4 + localHour / 10,
            impactKwh: 1,
          })),
        })),
      };
    }),
  }));
  return {
    status: "ready",
    snapshot: {
      context: {
        workspaceId: "default",
        projectId: "ngee-ann-polytechnic",
        scopeId: "project",
        dataSnapshotId: snapshotId,
        projectReleaseId: releaseId,
      },
      projectRelease: { id: releaseId },
      dataSnapshot: { id: snapshotId },
      analysis: {
        summary: { usageKwh: 4_476.19, averageDailyUsageKwh: 235.59 },
        offHours: { status: "available", sharePct: 50.4 },
        dailyUsageAnomalies: {
          status: "available",
          bundleId: `daily-usage-anomalies:${snapshotId}:${releaseId}`,
          metricId: "energy.total_usage_kwh@1",
          queryId: "time_slot_anomaly_v1",
          ruleRevisionId: "comparison.daily_usage_above_baseline@1",
          timezone: "Asia/Singapore",
          baselineCutoff: "2026-08-01",
          rule: {},
          evidencePins,
          scopes,
        },
      },
      fixedPublicPayload: "x".repeat(1_250_000),
    },
  } as unknown as Extract<
    ProjectAnalysisResolution,
    { status: "ready" }
  >;
};
