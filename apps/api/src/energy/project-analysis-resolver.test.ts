import {
  LocalDataGateway,
  type EnergyFactMaterializationBatchWrite,
  type EnergyIntervalFactWrite,
} from "@datafoundry/data-gateway";
import { createMetadataStore } from "@datafoundry/metadata";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { ConfigApiContext } from "../routes/types.js";
import { handleEnergyApiRequest } from "./energy-api.js";
import {
  ensureEnergyIqBootstrap,
  NGEE_ANN_WORKSPACE_ID,
  PRESCHOOL_WORKSPACE_ID,
} from "./energy-bootstrap.js";
import { materializeTestProjectSnapshot } from "./energy-test-materialization.js";
import { buildNgeeAnnDecisionPriorities } from "./ngee-ann-decision-priorities.js";
import { NGEE_ANN_GOLDEN } from "./ngee-ann-golden.fixture.js";
import {
  materializePreschoolGoldenFixture,
  PRESCHOOL_GOLDEN,
} from "./preschool-golden.fixture.js";
import {
  materializeCurrentProjectOverviewProjection,
  materializeCurrentProjectOverviewProjectionIfReady,
  managedProjectionPayloadHasRequiredShape,
  prewarmPublishedProjectOverviewProjections,
  projectRendererIncludesMeterDataHealth,
  readCurrentProjectOverviewProjection,
  resolveProjectAnalysis,
} from "./project-analysis-resolver.js";
import { createProjectOverviewProjectionKey } from "./project-analysis-result-cache.js";
import { projectOverviewMinimumFromMaterializedProjection } from "./project-overview-minimum.js";
import { resolveEnergyPublishedMeterRoute } from "./energy-query-context.js";
import { resolveNgeeAnnSectionManifestForRelease } from "./ngee-ann-section-manifest.js";
import { resolveReportTimeContext } from "./report-time-context.js";
import {
  SCHOOL_HOLIDAY_COMPARISON_RULE_REVISION,
  schoolHolidayComparisonHasRequiredShape,
  schoolHolidayComparisonMatchesReportTimeContext,
  schoolHolidayComparisonUnavailable,
} from "./school-holiday-comparison.js";

describe("ProjectAnalysisResolver", () => {
  it("includes Meter Data Health for the generic and dedicated Tuya renderers only", () => {
    expect(projectRendererIncludesMeterDataHealth("energy-template-overview")).toBe(true);
    expect(projectRendererIncludesMeterDataHealth("tuya-office-overview")).toBe(true);
    expect(projectRendererIncludesMeterDataHealth("ngee-ann-overview")).toBe(false);
    expect(projectRendererIncludesMeterDataHealth("preschool-overview")).toBe(false);
  });

  it("rejects a Project outside the user's Workspace Membership before resolving its Scope", async () => {
    const root = mkdtempSync(join(tmpdir(), "project-analysis-resolver-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      metadata.users.upsertDevUser({
        id: "preschool-fm",
        email: "preschool.fm@example.com",
        display_name: "Preschool FM",
        dev_token: "preschool-fm-token",
      });
      metadata.workspaceMemberships.upsert({
        workspace_id: "preschool-demo-org",
        user_id: "preschool-fm",
        role: "member",
      });

      await expect(resolveProjectAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        user: metadata.users.getById({ user_id: "preschool-fm" }),
        workspaceId: "default",
        request: {
          projectId: "ngee-ann-polytechnic",
          scopeId: "project",
          resource: "electricity",
          period: "Yesterday",
        },
      })).rejects.toThrow("ENERGYIQ_WORKSPACE_FORBIDDEN");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("rejects a Scope that does not belong to the trusted Project", async () => {
    const root = mkdtempSync(join(tmpdir(), "project-analysis-resolver-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      await expect(resolveProjectAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        user: metadata.users.getById({ user_id: "dev-user" }),
        workspaceId: "default",
        request: {
          projectId: "ngee-ann-polytechnic",
          scopeId: "preschool-project",
          resource: "electricity",
          period: "Yesterday",
        },
      })).rejects.toThrow("ENERGYIQ_SCOPE_FORBIDDEN");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it.each([
    {
      period: "Previous week",
      from: "2026-07-26T16:00:00.000Z",
      to: "2026-08-02T16:00:00.000Z",
    },
    {
      period: "Previous month",
      from: "2026-06-30T16:00:00.000Z",
      to: "2026-07-31T16:00:00.000Z",
    },
  ] as const)("returns configuration-required for an unregistered customer Project with $period", async ({ period, from, to }) => {
    const root = mkdtempSync(join(tmpdir(), "project-analysis-resolver-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      metadata.energyIq.upsertProject({
        id: "customer-without-renderer",
        workspace_id: "default",
        name: "Customer Without Renderer",
        status: "published",
        root_scope_id: "customer-without-renderer-root",
      });
      metadata.energyIq.upsertProjectNode({
        id: "customer-without-renderer-root",
        project_id: "customer-without-renderer",
        name: "Customer Without Renderer",
        node_type: "project",
      });

      const result = await resolveProjectAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        user: metadata.users.getById({ user_id: "dev-user" }),
        workspaceId: "default",
        request: {
          projectId: "customer-without-renderer",
          scopeId: "project",
          resource: "electricity",
          period,
        },
        now: new Date("2026-08-03T16:30:00.000Z"),
      });

      expect(result).toMatchObject({
        status: "configuration-required",
        projectId: "customer-without-renderer",
        title: "Project analysis is not configured",
        context: {
          period,
          timezone: "Asia/Singapore",
          from,
          to,
          endExclusive: true,
        },
      });
      expect(result).not.toHaveProperty("snapshot");
    } finally {
      metadata.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("anchors the latest complete day to historical Snapshot facts instead of wall-clock time", async () => {
    const root = mkdtempSync(join(tmpdir(), "project-analysis-latest-day-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      await materializeNgeeAnnLatestPeriodFixture(databasePath, metadata);
      const result = await resolveProjectAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        user: metadata.users.getById({ user_id: "dev-user" }),
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        request: {
          projectId: NGEE_ANN_GOLDEN.projectId,
          scopeId: "project",
          resource: "electricity",
          analysisWindow: "latest-complete-day",
        },
        databasePath,
        now: new Date("2026-08-05T00:00:00.000Z"),
      });

      expect(result.status).toBe("ready");
      if (result.status !== "ready") throw new Error("Expected latest complete Project day");
      expect(result.snapshot.context).toMatchObject({
        period: "Custom",
        from: "2026-06-15T16:00:00.000Z",
        to: "2026-06-16T16:00:00.000Z",
        primaryPeriod: {
          start: "2026-06-15T16:00:00.000Z",
          endExclusive: "2026-06-16T16:00:00.000Z",
        },
      });
      expect(result.snapshot.analysis.summary.validIntervalCount).toBeGreaterThan(0);
      expect(result.snapshot.analysis.dailyTotals?.scopes[0]?.rows).toMatchObject([
        { localDate: "2026-06-16", dataHealth: { status: "complete" } },
      ]);
    } finally {
      metadata.close();
      removeTemporaryFixture(root);
    }
  }, 30_000);

  it("publishes the exact Holiday Release and rejects a persisted comparison outside its Report-Time window", () => {
    const root = mkdtempSync(join(tmpdir(), "project-analysis-holiday-release-"));
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    try {
      ensureEnergyIqBootstrap(metadata);
      const release = publishHolidayNgeeRelease(metadata);
      const definition = metadata.energyIq.overviewDefinitions.get(release.revision_id)!;
      const policy = metadata.energyIq.reportTimePolicies.get(
        NGEE_ANN_GOLDEN.projectId,
        definition.time_policy_revision_id,
      )!;
      expect(release).toMatchObject({
        business_calendar_version: "sg-calendar-holiday-v2",
        selected_rule_revision_ids: expect.arrayContaining([
          SCHOOL_HOLIDAY_COMPARISON_RULE_REVISION,
        ]),
      });
      expect(resolveNgeeAnnSectionManifestForRelease(metadata, release.revision_id))
        .toMatchObject({ enabledSectionIds: expect.arrayContaining(["school-holiday-comparison"]) });
      const reportTimeContext = resolveReportTimeContext({
        binding: {
          workspaceId: NGEE_ANN_WORKSPACE_ID,
          projectId: NGEE_ANN_GOLDEN.projectId,
          scopeId: "project",
          resource: "electricity",
          dataSnapshotId: "snapshot-current",
          projectReleaseId: release.revision_id,
        },
        timezone: "Asia/Singapore",
        asOf: "2026-06-18T00:15:00.000Z",
        acceptedDataEndExclusive: "2026-06-17T16:00:00.000Z",
        lastRefreshedAt: "2026-06-18T00:05:00.000Z",
        policy: policy.policy,
      });
      const window = reportTimeContext.windows.find(
        ({ windowId }) => windowId === "school-holiday-comparison",
      )!;
      const comparison = schoolHolidayComparisonUnavailable({
        identity: {
          projectId: NGEE_ANN_GOLDEN.projectId,
          scopeId: "project",
          dataSnapshotId: "snapshot-current",
          projectReleaseId: release.revision_id,
          comparisonWindowId: "school-holiday-comparison",
          reportTimePolicyRevision: definition.time_policy_revision_id,
          period: {
            from: localDateForFixtureInstant(window.from, reportTimeContext.timezone),
            toExclusive: localDateForFixtureInstant(window.toExclusive, reportTimeContext.timezone),
          },
          businessCalendarVersion: release.business_calendar_version,
          ruleRevision: SCHOOL_HOLIDAY_COMPARISON_RULE_REVISION,
        },
        code: "FACT_COVERAGE_INCOMPLETE",
        message: "Official facts do not cover the full comparison period.",
      });
      expect(schoolHolidayComparisonHasRequiredShape(comparison)).toBe(true);
      expect(schoolHolidayComparisonMatchesReportTimeContext(comparison, reportTimeContext)).toBe(true);

      const mismatchedPeriod = structuredClone(comparison);
      mismatchedPeriod.identity.period.from = shiftFixtureLocalDate(
        comparison.identity.period.from,
        1,
      );
      expect(schoolHolidayComparisonMatchesReportTimeContext(
        mismatchedPeriod,
        reportTimeContext,
      )).toBe(false);

      const invalidPeriod = structuredClone(comparison);
      invalidPeriod.identity.period.toExclusive = invalidPeriod.identity.period.from;
      expect(schoolHolidayComparisonHasRequiredShape(invalidPeriod)).toBe(false);
    } finally {
      metadata.close();
      removeTemporaryFixture(root);
    }
  });

  it("pins the latest complete Project day to one calendar-month-to-date Ngee Ann range across Scopes", async () => {
    const root = mkdtempSync(join(tmpdir(), "project-analysis-latest-period-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      await materializeNgeeAnnLatestPeriodFixture(databasePath, metadata);
      metadata.energyIq.operationalPolicy.publishOperatingCalendar({
        version_id: "sg-calendar-v1",
        project_id: NGEE_ANN_GOLDEN.projectId,
        published_by: "dev-user",
        entries: [{
          id: "ngee-ann-resolver-calendar",
          owner: { kind: "project" },
          effective_from: "2020-01-01",
          weekly: {
            monday: [{ from: "00:00", to: "24:00" }],
            tuesday: [{ from: "00:00", to: "24:00" }],
            wednesday: [{ from: "00:00", to: "24:00" }],
            thursday: [{ from: "00:00", to: "24:00" }],
            friday: [{ from: "00:00", to: "24:00" }],
            saturday: [{ from: "00:00", to: "24:00" }],
            sunday: [{ from: "00:00", to: "24:00" }],
          },
        }],
      });
      const user = metadata.users.getById({ user_id: "dev-user" });
      const currentProjectResult = await resolveProjectAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        user,
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        request: {
          projectId: NGEE_ANN_GOLDEN.projectId,
          scopeId: "project",
          resource: "electricity",
          analysisWindow: "current-project-overview",
        },
        databasePath,
        now: new Date("2026-08-05T00:00:00.000Z"),
      });
      expect(currentProjectResult.status).toBe("ready");
      if (currentProjectResult.status !== "ready") throw new Error("Expected current Project analysis");
      expect(currentProjectResult.snapshot.context).toMatchObject({
        period: "Custom",
        from: "2026-05-31T16:00:00.000Z",
        to: NGEE_ANN_GOLDEN.selection.period.to,
      });
      expect(currentProjectResult.snapshot.dataSnapshot.sourceCoverage).toEqual({
        fromLocalDate: "2026-06-03",
        throughLocalDate: "2026-06-16",
      });
      expect(currentProjectResult.snapshot.reportTimeContext).toMatchObject({
        contractRevision: "energyiq-report-time-context@1",
        binding: {
          workspaceId: NGEE_ANN_WORKSPACE_ID,
          projectId: NGEE_ANN_GOLDEN.projectId,
          scopeId: "project",
          resource: "electricity",
          dataSnapshotId: currentProjectResult.snapshot.dataSnapshot.id,
          projectReleaseId: currentProjectResult.snapshot.projectRelease.id,
        },
        timezone: "Asia/Singapore",
        asOf: "2026-08-05T00:00:00.000Z",
        acceptedDataEndExclusive: NGEE_ANN_GOLDEN.selection.period.to,
        dataThroughLocalDate: "2026-06-16",
        lastRefreshedAt: "2026-08-05T00:00:00.000Z",
        policyId: "ngee-ann-report-time",
        policyRevision: "2",
      });
      const minimum = projectOverviewMinimumFromMaterializedProjection({
        metadataStore: metadata,
        resolution: currentProjectResult,
      });
      const minimumMetrics = new Map(
        minimum.headline.metrics.map((metric) => [metric.id, metric.value]),
      );
      expect(minimum.binding.currentPin).toMatchObject({
        dataSnapshotId: currentProjectResult.snapshot.context.dataSnapshotId,
        projectReleaseId: currentProjectResult.snapshot.projectRelease.id,
      });
      expect(currentProjectResult.snapshot.sectionManifest).toMatchObject({
        projectReleaseId: currentProjectResult.snapshot.projectRelease.id,
        enabledSectionIds: [
          "trend-and-demand",
          "time-behaviour",
          "circuit-concentration",
          "decision-priorities",
          "school-holiday-comparison",
        ],
      });
      expect(currentProjectResult.snapshot.schoolHolidayComparison).toMatchObject({
        status: "unavailable",
        identity: {
          projectReleaseId: currentProjectResult.snapshot.projectRelease.id,
          comparisonWindowId: "school-holiday-comparison",
          reportTimePolicyRevision: "ngee-ann-report-time@2",
          businessCalendarVersion: "sg-calendar-holiday-v2",
          ruleRevision: SCHOOL_HOLIDAY_COMPARISON_RULE_REVISION,
        },
      });
      expect(minimum.sectionManifest).toEqual(currentProjectResult.snapshot.sectionManifest);
      expect(minimumMetrics.get("energy"))
        .toBe(currentProjectResult.snapshot.analysis.summary.usageKwh);
      expect(minimumMetrics.get("dailyAverage"))
        .toBe(currentProjectResult.snapshot.analysis.summary.averageDailyUsageKwh);
      expect(minimumMetrics.get("peak"))
        .toBe(currentProjectResult.snapshot.analysis.summary.peakKw);
      expect(minimumMetrics.get("comparison"))
        .toBe(currentProjectResult.snapshot.analysis.comparison.changePct);
      expect(minimum.headline.dataQuality).toMatchObject({
        coveragePct: currentProjectResult.snapshot.analysis.dataHealth.coveragePct,
        expectedMeterIntervalCount:
          currentProjectResult.snapshot.analysis.dataHealth.expectedMeterIntervalCount,
        validIntervalCount: currentProjectResult.snapshot.analysis.dataHealth.validIntervalCount,
        qualityEventCount: currentProjectResult.snapshot.analysis.dataHealth.qualityEventCount,
      });
      if (currentProjectResult.snapshot.analysis.cost.status === "available") {
        expect(minimumMetrics.get("cost"))
          .toBe(currentProjectResult.snapshot.analysis.cost.amount);
      }
      expect(currentProjectResult.snapshot.reportTimeContext?.windows).toEqual(expect.arrayContaining([
        expect.objectContaining({
          windowId: "current-month-progress",
          label: "Current month to date",
          phase: "partial",
          from: "2026-05-31T16:00:00.000Z",
          toExclusive: NGEE_ANN_GOLDEN.selection.period.to,
        }),
        expect.objectContaining({
          windowId: "recent-operations",
          label: "Recent 28 complete days",
          completeDayCount: 28,
        }),
        expect.objectContaining({
          windowId: "next-month-outlook",
          phase: "forecast",
          from: "2026-06-30T16:00:00.000Z",
          toExclusive: "2026-07-31T16:00:00.000Z",
        }),
      ]));
      expect(currentProjectResult.snapshot.reportWindowAnalyses).toEqual(expect.arrayContaining([
        expect.objectContaining({
          windowId: "current-month-progress",
          period: {
            start: "2026-05-31T16:00:00.000Z",
            endExclusive: NGEE_ANN_GOLDEN.selection.period.to,
          },
          status: "ready",
        }),
        expect.objectContaining({
          windowId: "recent-operations",
          period: {
            start: "2026-05-19T16:00:00.000Z",
            endExclusive: NGEE_ANN_GOLDEN.selection.period.to,
          },
          status: "ready",
          analysis: expect.objectContaining({
            dailyTotals: expect.objectContaining({
              scopes: expect.arrayContaining([
                expect.objectContaining({
                  scopeId: "project",
                  rows: expect.arrayContaining([
                    expect.objectContaining({ localDate: "2026-05-20" }),
                    expect.objectContaining({ localDate: "2026-06-16" }),
                  ]),
                }),
              ]),
            }),
          }),
        }),
        expect.objectContaining({
          windowId: "day-type-reference",
          period: {
            start: "2026-02-18T16:00:00.000Z",
            endExclusive: "2026-05-19T16:00:00.000Z",
          },
          status: "ready",
          analysis: expect.objectContaining({
            timeBehaviour: expect.objectContaining({
              scopes: expect.arrayContaining([
                expect.objectContaining({ scopeId: "project", cells: [] }),
              ]),
              dayProfiles: expect.any(Array),
            }),
          }),
        }),
      ]));
      expect(currentProjectResult.snapshot.reportWindowSegmentSummaries).toEqual([
        {
          windowId: "completed-month-trend",
          status: "ready",
          segments: [
            expect.objectContaining({
              period: {
                start: "2026-02-28T16:00:00.000Z",
                endExclusive: "2026-03-31T16:00:00.000Z",
              },
              dataStatus: "unavailable",
              expectedDayCount: 31,
              completeDayCount: 0,
              summary: null,
            }),
            expect.objectContaining({
              period: {
                start: "2026-03-31T16:00:00.000Z",
                endExclusive: "2026-04-30T16:00:00.000Z",
              },
              dataStatus: "unavailable",
              expectedDayCount: 30,
              completeDayCount: 0,
              summary: null,
            }),
            expect.objectContaining({
              period: {
                start: "2026-04-30T16:00:00.000Z",
                endExclusive: "2026-05-31T16:00:00.000Z",
              },
              dataStatus: "unavailable",
              expectedDayCount: 31,
              completeDayCount: 0,
              summary: null,
            }),
          ],
        },
        {
          windowId: "same-progress-comparison",
          status: "ready",
          segments: [
            expect.objectContaining({
              period: {
                start: "2026-02-28T16:00:00.000Z",
                endExclusive: "2026-03-16T16:00:00.000Z",
              },
              dataStatus: "unavailable",
              expectedDayCount: 16,
              summary: null,
            }),
            expect.objectContaining({
              period: {
                start: "2026-03-31T16:00:00.000Z",
                endExclusive: "2026-04-16T16:00:00.000Z",
              },
              dataStatus: "unavailable",
              expectedDayCount: 16,
              summary: null,
            }),
            expect.objectContaining({
              period: {
                start: "2026-04-30T16:00:00.000Z",
                endExclusive: "2026-05-16T16:00:00.000Z",
              },
              dataStatus: "unavailable",
              expectedDayCount: 16,
              summary: null,
            }),
          ],
        },
      ]);
      expect(JSON.stringify(currentProjectResult.snapshot.reportWindowSegmentSummaries).length)
        .toBeLessThan(8_000);
      expect(currentProjectResult.snapshot.reportWindowSegmentSummaries
        ?.flatMap((window) => window.segments)
        .every((segment) => (
          segment.evidence.dataSnapshotId === currentProjectResult.snapshot.dataSnapshot.id
          && segment.evidence.queryId === "daily_totals_v1"
        )))
        .toBe(true);
      const recentOperations = currentProjectResult.snapshot.reportWindowAnalyses
        ?.find((window) => window.windowId === "recent-operations");
      expect(recentOperations?.analysis.summary).toEqual(
        expect.objectContaining({ usageKwh: expect.any(Number) }),
      );
      expect(recentOperations?.analysis.offHours).toEqual(
        expect.objectContaining({ status: "available" }),
      );
      expect(recentOperations?.analysis.timeBehaviour).toEqual(expect.objectContaining({
        queryId: "time_bucket_grid_v1",
        scopes: expect.arrayContaining([
          expect.objectContaining({
            scopeId: "project",
            cells: expect.arrayContaining([
              expect.objectContaining({ localDate: "2026-05-20", localHour: 0 }),
              expect.objectContaining({ localDate: "2026-06-16", localHour: 23 }),
            ]),
          }),
        ]),
        dayProfiles: expect.arrayContaining([
          expect.objectContaining({ scopeId: "project", dayType: "weekday" }),
        ]),
      }));
      expect(recentOperations?.analysis.composition).toEqual(expect.objectContaining({
        provenance: expect.objectContaining({
          dataSnapshotId: currentProjectResult.snapshot.dataSnapshot.id,
        }),
        categories: expect.arrayContaining([
          expect.objectContaining({ category: "load" }),
          expect.objectContaining({ category: "light" }),
        ]),
        circuits: expect.arrayContaining([
          expect.objectContaining({ includedInOfficialTotal: false }),
        ]),
        componentReconciliation: expect.objectContaining({
          componentMeterNodeIds: expect.any(Array),
        }),
      }));
      expect(JSON.stringify(currentProjectResult.snapshot.reportWindowAnalyses).length)
        .toBeLessThan(600_000);
      expect(currentProjectResult.snapshot.analysis.summary.validIntervalCount).toBeGreaterThan(0);
      expect(currentProjectResult.snapshot.projectRelease.ruleRevisionIds)
        .toContain("comparison.daily_usage_above_baseline@1");
      expect(currentProjectResult.snapshot.analysis.dailyUsageAnomalies).toBeDefined();
      const immutableNgeeProjection = structuredClone(currentProjectResult) as {
        snapshot: Record<string, any>;
      };
      delete immutableNgeeProjection.snapshot.decisionLifecycle;
      delete immutableNgeeProjection.snapshot.preschoolPlanningLifecycle;
      const virtualMeterTermStatuses = immutableNgeeProjection.snapshot.analysis.virtualMeterTraces
        ?.flatMap((trace: { terms: Array<{ dataHealth: { status: unknown } }> }) => (
          trace.terms.map((term) => term.dataHealth.status)
        )) ?? [];
      expect(virtualMeterTermStatuses.length).toBeGreaterThan(0);
      expect(virtualMeterTermStatuses.every((status: unknown) => (
        status === "complete" || status === "partial" || status === "unavailable"
      ))).toBe(true);
      expect(managedProjectionPayloadHasRequiredShape(immutableNgeeProjection)).toBe(true);
      const virtualTermCorruptions: Array<{
        label: string;
        mutate: (term: Record<string, any>) => void;
      }> = [
        {
          label: "missing status",
          mutate: (term) => { delete term.dataHealth.status; },
        },
        {
          label: "illegal status",
          mutate: (term) => { term.dataHealth.status = "stale"; },
        },
        {
          label: "missing data health",
          mutate: (term) => { term.dataHealth = null; },
        },
        {
          label: "half-shaped data health",
          mutate: (term) => { term.dataHealth = { status: "partial", coveragePct: 50 }; },
        },
      ];
      for (const corruption of virtualTermCorruptions) {
        const malformed = structuredClone(immutableNgeeProjection);
        const term = malformed.snapshot.analysis.virtualMeterTraces?.[0]?.terms?.[0];
        if (!term) throw new Error("Expected a real Ngee Ann Virtual Meter term");
        corruption.mutate(term);
        expect(managedProjectionPayloadHasRequiredShape(malformed), corruption.label).toBe(false);
      }
      for (const field of ["rollingComparisons", "hourlyComparison", "detailSeries"] as const) {
        const malformed = structuredClone(immutableNgeeProjection);
        const anomalyScope = malformed.snapshot.analysis.dailyUsageAnomalies.scopes[0];
        if (field === "rollingComparisons") {
          anomalyScope.rollingComparisons = [null];
        } else {
          anomalyScope.rows[0][field] = [null];
        }
        expect(managedProjectionPayloadHasRequiredShape(malformed), field).toBe(false);
      }
      const decisionPriorityCorruptions: Array<{
        label: string;
        mutate: (item: Record<string, any>) => void;
      }> = [
        {
          label: "decision evidence period",
          mutate: (item) => { delete item.evidence.period.from; },
        },
        {
          label: "decision evidence occurrence",
          mutate: (item) => { delete item.evidence.occurrence.scopeId; },
        },
        {
          label: "decision energy impact",
          mutate: (item) => { delete item.impact.energy.deltaKwh; },
        },
        {
          label: "decision cost impact",
          mutate: (item) => { delete item.impact.cost.reason.code; },
        },
        {
          label: "decision action target",
          mutate: (item) => { delete item.action.targetRef.id; },
        },
        {
          label: "decision action verification metric",
          mutate: (item) => { delete item.action.verificationMetricRef.label; },
        },
      ];
      const decisionSource = structuredClone(
        immutableNgeeProjection.snapshot.analysis.dailyUsageAnomalies,
      );
      const decisionScope = decisionSource.scopes.find((scope: Record<string, any>) => (
        scope.scopeId === "project"
      ));
      const decisionRow = decisionScope?.rows?.[0];
      if (!decisionScope || !decisionRow) {
        throw new Error("Expected real Ngee Ann anomaly Evidence for Decision Priority validation");
      }
      Object.assign(decisionRow, {
        outcome: "triggered",
        actualKwh: 150,
        baselineKwh: 100,
        impactKwh: 50,
        relativePct: 50,
        coveragePct: 100,
        validIntervalCount: decisionRow.expectedMeterIntervalCount,
        qualityEventCount: 0,
      });
      delete decisionRow.suppressionReason;
      decisionScope.rows = [decisionRow];
      decisionSource.scopes = [decisionScope];
      immutableNgeeProjection.snapshot.decisionPriorities = buildNgeeAnnDecisionPriorities({
        selectedScopeId: "project",
        primaryPeriod: immutableNgeeProjection.snapshot.context.primaryPeriod,
        expectedEvidencePins: decisionSource.evidencePins,
        dailyUsageAnomalies: decisionSource,
      });
      expect(immutableNgeeProjection.snapshot.decisionPriorities.items).toHaveLength(1);
      expect(managedProjectionPayloadHasRequiredShape(immutableNgeeProjection)).toBe(true);
      for (const corruption of decisionPriorityCorruptions) {
        const malformed = structuredClone(immutableNgeeProjection);
        const item = malformed.snapshot.decisionPriorities?.items?.[0];
        if (!item) throw new Error("Expected one real Ngee Ann Decision Priority consumer fixture");
        corruption.mutate(item);
        expect(managedProjectionPayloadHasRequiredShape(malformed), corruption.label).toBe(false);
      }
      const historicalAnomalyQueryCount = metadata.db.prepare(`
        SELECT COUNT(*) AS count
        FROM sql_audit_logs
        WHERE user_id = ?
          AND sql_text LIKE '%series_definitions.series_id%'
          AND sql_text LIKE '%day_type_count%'
      `).get(user.id) as { count: number };
      expect(historicalAnomalyQueryCount.count).toBe(1);
      expect(currentProjectResult.snapshot.analysis.dataHealth.status).toBe("partial");
      expect(currentProjectResult.snapshot.analysis.dailyTotals?.scopes[0]?.rows).toHaveLength(16);
      expect(currentProjectResult.snapshot.analysis.dailyTotals?.scopes[0]?.rows[0]).toMatchObject({
        localDate: "2026-06-01",
        usageKwh: null,
        dataHealth: { status: "unavailable" },
      });

      const currentLevelResult = await resolveProjectAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        user,
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        request: {
          projectId: NGEE_ANN_GOLDEN.projectId,
          scopeId: "level-7",
          resource: "electricity",
          analysisWindow: "current-month-to-date",
        },
        databasePath,
        now: new Date("2026-08-05T00:00:00.000Z"),
      });
      expect(currentLevelResult.status).toBe("ready");
      if (currentLevelResult.status !== "ready") throw new Error("Expected current Level analysis");
      expect(currentLevelResult.snapshot.context).toMatchObject({
        period: "Custom",
        from: currentProjectResult.snapshot.context.from,
        to: currentProjectResult.snapshot.context.to,
        dataSnapshotId: currentProjectResult.snapshot.context.dataSnapshotId,
      });

      const pinnedLevelResult = await resolveProjectAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        user,
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        request: {
          projectId: NGEE_ANN_GOLDEN.projectId,
          scopeId: "level-7",
          resource: "electricity",
          analysisWindow: "current-month-to-date",
          from: "2026-06-01",
          to: "2026-06-16",
          expectedDataSnapshotId: currentProjectResult.snapshot.context.dataSnapshotId,
          expectedProjectReleaseId: currentProjectResult.snapshot.projectRelease.id,
        },
        databasePath,
        now: new Date("2026-08-06T00:00:00.000Z"),
      });
      expect(pinnedLevelResult.status).toBe("ready");
      if (pinnedLevelResult.status !== "ready") throw new Error("Expected pinned Level analysis");
      expect(pinnedLevelResult.snapshot.context).toMatchObject({
        period: "Custom",
        from: currentProjectResult.snapshot.context.from,
        to: currentProjectResult.snapshot.context.to,
        dataSnapshotId: currentProjectResult.snapshot.context.dataSnapshotId,
      });
      expect(pinnedLevelResult.snapshot.projectRelease.id)
        .toBe(currentProjectResult.snapshot.projectRelease.id);

      await expect(resolveProjectAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        user,
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        request: {
          projectId: NGEE_ANN_GOLDEN.projectId,
          scopeId: "level-7",
          resource: "electricity",
          analysisWindow: "current-month-to-date",
          from: "2026-06-01",
          to: "2026-06-16",
          expectedDataSnapshotId: "stale-snapshot",
          expectedProjectReleaseId: currentProjectResult.snapshot.projectRelease.id,
        },
        databasePath,
      })).rejects.toThrow("ENERGYIQ_DATA_SNAPSHOT_MISMATCH");

      await expect(resolveProjectAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        user,
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        request: {
          projectId: NGEE_ANN_GOLDEN.projectId,
          scopeId: "level-7",
          resource: "electricity",
          analysisWindow: "current-month-to-date",
          from: "2026-06-01",
          to: "2026-06-16",
          expectedDataSnapshotId: currentProjectResult.snapshot.context.dataSnapshotId,
          expectedProjectReleaseId: "stale-release",
        },
        databasePath,
      })).rejects.toThrow("ENERGYIQ_PROJECT_RELEASE_MISMATCH");

      await expect(resolveProjectAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        user,
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        request: {
          projectId: NGEE_ANN_GOLDEN.projectId,
          scopeId: "level-7",
          resource: "electricity",
          analysisWindow: "current-month-to-date",
          expectedDataSnapshotId: currentProjectResult.snapshot.context.dataSnapshotId,
        },
        databasePath,
      })).rejects.toThrow("ENERGYIQ_CURRENT_OVERVIEW_PIN_INCOMPLETE");

      await expect(resolveProjectAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        user,
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        request: {
          projectId: NGEE_ANN_GOLDEN.projectId,
          scopeId: "level-7",
          resource: "electricity",
          analysisWindow: "current-month-to-date",
          from: "2026-05-21",
          to: "2026-06-15",
          expectedDataSnapshotId: currentProjectResult.snapshot.context.dataSnapshotId,
          expectedProjectReleaseId: currentProjectResult.snapshot.projectRelease.id,
        },
        databasePath,
      })).rejects.toThrow("ENERGYIQ_CURRENT_OVERVIEW_WINDOW_MISMATCH");
      const resolve = (
        scopeId: string,
        from: string,
        to: string,
        factsPath = databasePath,
        dataGateway = gateway,
      ) =>
        resolveProjectAnalysis({
          metadataStore: metadata,
          dataGateway,
          user,
          workspaceId: NGEE_ANN_WORKSPACE_ID,
          request: {
            projectId: NGEE_ANN_GOLDEN.projectId,
            scopeId,
            resource: "electricity",
            period: "Custom",
            from,
            to,
          },
          databasePath: factsPath,
          // Alternate gateways below deliberately inject child-query failures. They must
          // exercise the resolver instead of restoring the healthy persisted projection.
          bypassCache: dataGateway !== gateway,
        });

      const projectResult = await resolve("project", "2026-08-01", "2026-08-07");
      expect(projectResult.status).toBe("ready");
      if (projectResult.status !== "ready") throw new Error("Expected ready Project analysis");
      expect(projectResult.snapshot.analysis.summary.validIntervalCount).toBe(0);
      expect(projectResult.snapshot.latestAvailablePeriod).toEqual({
        period: "Custom",
        from: NGEE_ANN_GOLDEN.selection.period.localFrom,
        to: "2026-06-16",
      });

      const levelResult = await resolve("level-6", "2026-08-01", "2026-08-07");
      expect(levelResult.status).toBe("ready");
      if (levelResult.status !== "ready") throw new Error("Expected ready Level analysis");
      expect(levelResult.snapshot.analysis.summary.validIntervalCount).toBe(0);
      expect(levelResult.snapshot.latestAvailablePeriod).toEqual(
        projectResult.snapshot.latestAvailablePeriod,
      );

      const multiWindowLevelResult = await resolve("level-7", "2026-08-01", "2026-08-07");
      expect(multiWindowLevelResult.status).toBe("ready");
      if (multiWindowLevelResult.status !== "ready") {
        throw new Error("Expected ready multi-window Level analysis");
      }
      expect(multiWindowLevelResult.snapshot.latestAvailablePeriod).toEqual(
        projectResult.snapshot.latestAvailablePeriod,
      );

      const qualityEventResult = await resolve("l7-front-light", "2026-08-01", "2026-08-07");
      expect(qualityEventResult.status).toBe("ready");
      if (qualityEventResult.status !== "ready") throw new Error("Expected quality-event analysis");
      expect(qualityEventResult.snapshot.latestAvailablePeriod).toEqual({
        period: "Custom",
        from: "2026-06-03",
        to: "2026-06-09",
      });

      const compensatingIntervalsResult = await resolve(
        "l6-light-left",
        "2026-08-01",
        "2026-08-07",
      );
      expect(compensatingIntervalsResult.status).toBe("ready");
      if (compensatingIntervalsResult.status !== "ready") {
        throw new Error("Expected compensating-interval analysis");
      }
      expect(compensatingIntervalsResult.snapshot).not.toHaveProperty("latestAvailablePeriod");
      const compensatingSelectedPeriod = await resolve(
        "l6-light-left",
        "2026-06-10",
        "2026-06-16",
      );
      expect(compensatingSelectedPeriod.status).toBe("ready");
      if (compensatingSelectedPeriod.status !== "ready") {
        throw new Error("Expected selected compensating-interval analysis");
      }
      expect(compensatingSelectedPeriod.snapshot.analysis.dataHealth).toMatchObject({
        validIntervalCount: 7 * 24 * 4,
        expectedMeterIntervalCount: 7 * 24 * 4,
        qualityEventCount: 0,
      });

      const noCandidateResult = await resolve("l6-light-right", "2026-08-01", "2026-08-07");
      expect(noCandidateResult.status).toBe("ready");
      if (noCandidateResult.status !== "ready") throw new Error("Expected ready Circuit analysis");
      expect(noCandidateResult.snapshot.analysis.summary.validIntervalCount).toBe(0);
      expect(noCandidateResult.snapshot).not.toHaveProperty("latestAvailablePeriod");

      const healthyResult = await resolve(
        "project",
        NGEE_ANN_GOLDEN.selection.period.localFrom,
        "2026-06-16",
      );
      expect(healthyResult.status).toBe("ready");
      if (healthyResult.status !== "ready") throw new Error("Expected healthy Project analysis");
      expect(healthyResult.snapshot.analysis.summary.validIntervalCount).toBeGreaterThan(0);
      expect(healthyResult.snapshot.analysis.timeBehaviour).toBeDefined();
      expect(healthyResult.snapshot.analysis.provenance.queryIds).toContain("time_bucket_grid_v1");
      expect(healthyResult.snapshot.analysis.dailyUsageAnomalies?.status).toBe("available");
      expect(healthyResult.snapshot.decisionPriorities).toEqual({
        status: "partial",
        limitation: {
          code: "SOME_CANDIDATE_DATES_SUPPRESSED",
          message: "Some candidate dates were suppressed, so the absence of a priority is not a complete no-exception conclusion.",
        },
        evidencePins: healthyResult.snapshot.analysis.dailyUsageAnomalies?.status === "available"
          ? healthyResult.snapshot.analysis.dailyUsageAnomalies.evidencePins
          : undefined,
        items: [],
      });
      expect(healthyResult.snapshot).not.toHaveProperty("latestAvailablePeriod");

      const anomalyFailingGateway = new LocalDataGateway(metadata);
      const runSqlReadonly = anomalyFailingGateway.runSqlReadonly.bind(anomalyFailingGateway);
      anomalyFailingGateway.runSqlReadonly = async (request) => {
        if (request.sql.includes("series_definitions.series_id")) {
          throw new Error("OPTIONAL_ANOMALY_QUERY_FAILED");
        }
        return runSqlReadonly(request);
      };
      const anomalyUnavailableResult = await resolve(
        "project",
        NGEE_ANN_GOLDEN.selection.period.localFrom,
        "2026-06-16",
        databasePath,
        anomalyFailingGateway,
      );
      expect(anomalyUnavailableResult.status).toBe("ready");
      if (anomalyUnavailableResult.status !== "ready") {
        throw new Error("Expected child-local anomaly failure");
      }
      expect(anomalyUnavailableResult.snapshot.analysis.summary)
        .toMatchObject({
          usageKwh: healthyResult.snapshot.analysis.summary.usageKwh,
          validIntervalCount: healthyResult.snapshot.analysis.summary.validIntervalCount,
          qualityEventCount: healthyResult.snapshot.analysis.summary.qualityEventCount,
        });
      expect(anomalyUnavailableResult.snapshot.analysis.dailyUsageAnomalies).toMatchObject({
        status: "unavailable",
        reason: { code: "DAILY_USAGE_ANOMALY_FACTS_UNAVAILABLE" },
      });
      expect(anomalyUnavailableResult.snapshot.decisionPriorities).toMatchObject({
        status: "unavailable",
        limitation: { code: "DAILY_USAGE_ANOMALIES_UNAVAILABLE" },
        items: [],
      });

      for (const message of [
        "ENERGYIQ_SNAPSHOT_STALE:concurrent-snapshot",
        "ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE",
        "ENERGYIQ_LATEST_COMPLETE_PERIOD_UNKNOWN",
      ]) {
        const failingGateway = new LocalDataGateway(metadata);
        const runSqlReadonly = failingGateway.runSqlReadonly.bind(failingGateway);
        failingGateway.runSqlReadonly = async (request) => {
          if (request.sql.includes("complete_day_count")) throw new Error(message);
          return runSqlReadonly(request);
        };
        await expect(resolve(
          "project",
          "2026-08-01",
          "2026-08-07",
          databasePath,
          failingGateway,
        )).rejects.toThrow(message);
      }

      await expect(resolve(
        "project",
        "2026-08-01",
        "2026-08-07",
        join(root, "missing-energy.duckdb"),
      )).rejects.toThrow("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
    } finally {
      metadata.close();
      removeTemporaryFixture(root);
    }
  }, 120_000);

  it("reuses a fully pinned Ngee Ann current Overview without repeating Period or fact SQL", async () => {
    const root = mkdtempSync(join(tmpdir(), "project-analysis-pinned-cache-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      await materializeNgeeAnnLatestPeriodFixture(databasePath, metadata);
      const user = metadata.users.getById({ user_id: "dev-user" });
      const runSqlReadonly = vi.spyOn(gateway, "runSqlReadonly");
      const current = await resolveProjectAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        user,
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        request: {
          projectId: NGEE_ANN_GOLDEN.projectId,
          scopeId: "project",
          resource: "electricity",
          analysisWindow: "current-month-to-date",
        },
        databasePath,
        now: new Date("2026-08-06T00:00:00.000Z"),
      });
      expect(current.status).toBe("ready");
      if (current.status !== "ready") throw new Error("Expected current Ngee Ann analysis");
      const pinnedInput = {
        metadataStore: metadata,
        dataGateway: gateway,
        user,
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        request: {
          projectId: NGEE_ANN_GOLDEN.projectId,
          scopeId: "level-6",
          resource: "electricity" as const,
          analysisWindow: "current-month-to-date" as const,
          from: "2026-06-01",
          to: "2026-06-16",
          expectedDataSnapshotId: current.snapshot.context.dataSnapshotId,
          expectedProjectReleaseId: current.snapshot.projectRelease.id,
        },
        databasePath,
        now: new Date("2026-08-06T00:00:00.000Z"),
      };
      const baselineSqlCount = runSqlReadonly.mock.calls.length;

      const coldStartedAt = performance.now();
      const cold = await resolveProjectAnalysis(pinnedInput);
      const coldDurationMs = performance.now() - coldStartedAt;
      const coldSqlCount = runSqlReadonly.mock.calls.length;
      expect(cold).toMatchObject({ status: "ready" });
      expect(coldSqlCount).toBeGreaterThan(baselineSqlCount);

      const hitStartedAt = performance.now();
      const hit = await resolveProjectAnalysis(pinnedInput);
      const hitDurationMs = performance.now() - hitStartedAt;
      expect(hit).toEqual(cold);
      expect(runSqlReadonly).toHaveBeenCalledTimes(coldSqlCount);
      expect(hitDurationMs).toBeLessThan(coldDurationMs / 5);

      const refreshStartedAt = performance.now();
      const refreshed = await resolveProjectAnalysis({ ...pinnedInput, bypassCache: true });
      const refreshDurationMs = performance.now() - refreshStartedAt;
      expect(refreshed).toMatchObject({ status: "ready" });
      expect(runSqlReadonly.mock.calls.length).toBeGreaterThan(coldSqlCount);
      expect(refreshDurationMs).toBeGreaterThan(hitDurationMs * 5);

      await expect(resolveProjectAnalysis({
        ...pinnedInput,
        request: {
          ...pinnedInput.request,
          from: "2026-05-21",
          to: "2026-06-15",
        },
      })).rejects.toThrow("ENERGYIQ_CURRENT_OVERVIEW_WINDOW_MISMATCH");
    } finally {
      vi.restoreAllMocks();
      metadata.close();
      removeTemporaryFixture(root);
    }
  }, 30_000);

  it("materializes and reads a Ngee Ann Overview when the anomaly query is unavailable", async () => {
    const root = mkdtempSync(join(tmpdir(), "project-analysis-degraded-managed-overview-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      await materializeNgeeAnnLatestPeriodFixture(databasePath, metadata);
      metadata.energyIq.operationalPolicy.publishOperatingCalendar({
        version_id: "sg-calendar-v1",
        project_id: NGEE_ANN_GOLDEN.projectId,
        published_by: "dev-user",
        entries: [{
          id: "ngee-ann-degraded-managed-overview-calendar",
          owner: { kind: "project" },
          effective_from: "2020-01-01",
          weekly: {
            monday: [{ from: "00:00", to: "24:00" }],
            tuesday: [{ from: "00:00", to: "24:00" }],
            wednesday: [{ from: "00:00", to: "24:00" }],
            thursday: [{ from: "00:00", to: "24:00" }],
            friday: [{ from: "00:00", to: "24:00" }],
            saturday: [{ from: "00:00", to: "24:00" }],
            sunday: [{ from: "00:00", to: "24:00" }],
          },
        }],
      });
      const runSqlReadonly = gateway.runSqlReadonly.bind(gateway);
      let sqlCount = 0;
      gateway.runSqlReadonly = async (request) => {
        sqlCount += 1;
        if (request.sql.includes("series_definitions.series_id")) {
          throw new Error("OPTIONAL_ANOMALY_QUERY_FAILED");
        }
        return runSqlReadonly(request);
      };
      let pointerPublication: {
        persistentDirectory: string;
        pointerKey: string;
        previousProjectionKey: string | null;
        candidateProjectionKey: string;
      } | undefined;

      const materialized = await materializeCurrentProjectOverviewProjection({
        metadataStore: metadata,
        dataGateway: gateway,
        user: metadata.users.getById({ user_id: "dev-user" }),
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        projectId: NGEE_ANN_GOLDEN.projectId,
        databasePath,
        now: new Date("2026-08-05T00:00:00.000Z"),
        beforePublish: async (publication) => {
          pointerPublication = publication;
        },
      });
      expect(pointerPublication).toMatchObject({
        persistentDirectory: join(root, "project-analysis-cache"),
        previousProjectionKey: null,
        candidateProjectionKey: createProjectOverviewProjectionKey(
          materialized.contextPackage.identity,
        ),
      });
      expect(materialized.resolution.snapshot.analysis.dailyUsageAnomalies).toMatchObject({
        status: "unavailable",
        reason: { code: "DAILY_USAGE_ANOMALY_FACTS_UNAVAILABLE" },
      });
      expect(materialized.resolution.snapshot.decisionPriorities).toMatchObject({
        status: "unavailable",
        limitation: { code: "DAILY_USAGE_ANOMALIES_UNAVAILABLE" },
      });
      expect(materialized.resolution.snapshot.analysis.provenance.queryIds)
        .not.toContain("time_slot_anomaly_v1");
      expect(materialized.resolution.snapshot.decisionPriorities?.evidencePins).toEqual({
        projectReleaseId: materialized.contextPackage.identity.projectReleaseId,
        dataSnapshotId: materialized.resolution.snapshot.analysis.provenance.dataSnapshotId,
        hierarchyRevisionId: materialized.resolution.snapshot.analysis.provenance.hierarchyRevisionId,
        meterMappingRevisionId: materialized.resolution.snapshot.analysis.provenance.meterMappingRevisionId,
        meterFormulaRevisionId: materialized.resolution.snapshot.analysis.provenance.meterFormulaRevisionId,
        metricVersion: materialized.resolution.snapshot.analysis.provenance.metricVersion,
        businessCalendarVersion: materialized.contextPackage.identity.businessCalendarVersion,
        queryIds: ["time_slot_anomaly_v1"],
      });
      const materializationSqlCount = sqlCount;

      const restored = await readCurrentProjectOverviewProjection({
        metadataStore: metadata,
        dataGateway: gateway,
        user: metadata.users.getById({ user_id: "dev-user" }),
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        projectId: NGEE_ANN_GOLDEN.projectId,
        databasePath,
      });
      expect(restored.resolution.snapshot.analysis.dailyUsageAnomalies?.status).toBe("unavailable");
      expect(restored.resolution.snapshot.decisionPriorities).toEqual(
        materialized.resolution.snapshot.decisionPriorities,
      );
      expect(sqlCount).toBe(materializationSqlCount);
    } finally {
      metadata.close();
      removeTemporaryFixture(root);
    }
  }, 120_000);

  it("keeps the previous complete Ngee Ann projection current when Holiday facts fail or violate the official route", async () => {
    const root = mkdtempSync(join(tmpdir(), "project-analysis-holiday-publication-gate-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      await materializeNgeeAnnLatestPeriodFixture(databasePath, metadata, {
        includeHolidayHistory: true,
      });
      const user = metadata.users.getById({ user_id: "dev-user" });
      const initial = await materializeCurrentProjectOverviewProjection({
        metadataStore: metadata,
        dataGateway: gateway,
        user,
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        projectId: NGEE_ANN_GOLDEN.projectId,
        databasePath,
        now: new Date("2026-08-05T00:00:00.000Z"),
      });
      expect(initial.resolution.snapshot.schoolHolidayComparison?.status).toBe("available");

      const runSqlReadonly = gateway.runSqlReadonly.bind(gateway);
      gateway.runSqlReadonly = async (request) => {
        if (request.sql.includes("accepted_elapsed_minutes := cells.accepted_elapsed_minutes")) {
          throw new Error("INJECTED_HOLIDAY_FACT_QUERY_FAILURE");
        }
        return runSqlReadonly(request);
      };
      await expect(materializeCurrentProjectOverviewProjectionIfReady({
        metadataStore: metadata,
        dataGateway: gateway,
        user,
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        projectId: NGEE_ANN_GOLDEN.projectId,
        databasePath,
        now: new Date("2026-08-05T00:00:00.000Z"),
        forceRecompute: true,
      })).resolves.toBeUndefined();

      const restored = await readCurrentProjectOverviewProjection({
        metadataStore: metadata,
        dataGateway: gateway,
        user,
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        projectId: NGEE_ANN_GOLDEN.projectId,
        databasePath,
      });
      expect(restored.resolution.snapshot.schoolHolidayComparison).toEqual(
        initial.resolution.snapshot.schoolHolidayComparison,
      );

      gateway.runSqlReadonly = async (request) => {
        const result = await runSqlReadonly(request);
        if (!request.sql.includes("accepted_elapsed_minutes := cells.accepted_elapsed_minutes")) {
          return result;
        }
        return {
          ...result,
          rows: result.rows.map((row) => [row[0], row[1], row[2], "driver_only", row[4]]),
        };
      };
      await expect(materializeCurrentProjectOverviewProjectionIfReady({
        metadataStore: metadata,
        dataGateway: gateway,
        user,
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        projectId: NGEE_ANN_GOLDEN.projectId,
        databasePath,
        now: new Date("2026-08-05T00:00:00.000Z"),
        forceRecompute: true,
      })).resolves.toBeUndefined();

      const afterInvalidRows = await readCurrentProjectOverviewProjection({
        metadataStore: metadata,
        dataGateway: gateway,
        user,
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        projectId: NGEE_ANN_GOLDEN.projectId,
        databasePath,
      });
      expect(afterInvalidRows.resolution.snapshot.schoolHolidayComparison).toEqual(
        initial.resolution.snapshot.schoolHolidayComparison,
      );
    } finally {
      metadata.close();
      removeTemporaryFixture(root);
    }
  }, 120_000);

  it("republishes the Ngee Ann current pointer from its valid immutable projection", async () => {
    const root = mkdtempSync(join(tmpdir(), "project-analysis-ngee-current-recovery-"));
    const databasePath = join(root, "energy.duckdb");
    const cacheDirectory = join(root, "project-analysis-cache");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      await materializeNgeeAnnLatestPeriodFixture(databasePath, metadata);
      const user = metadata.users.getById({ user_id: "dev-user" });
      const initial = await materializeCurrentProjectOverviewProjection({
        metadataStore: metadata,
        dataGateway: gateway,
        user,
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        projectId: NGEE_ANN_GOLDEN.projectId,
        databasePath,
        now: new Date("2026-08-05T00:00:00.000Z"),
      });
      const pointerKey = JSON.stringify({
        contract: "project-current-overview-pointer@1",
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        projectId: NGEE_ANN_GOLDEN.projectId,
      });
      const pointerPath = join(
        cacheDirectory,
        `current-${createHash("sha256").update(pointerKey).digest("hex")}.json`,
      );
      expect(existsSync(pointerPath)).toBe(true);
      const managedPaths = readdirSync(cacheDirectory)
        .filter((name) => name.startsWith("managed-") && name.endsWith(".json"));
      expect(managedPaths).toHaveLength(1);
      const managedPath = join(cacheDirectory, managedPaths[0]!);
      const immutableBefore = readFileSync(managedPath);
      for (const siblingId of ["preschool-demo", "tuya-office"]) {
        const sibling = metadata.energyIq.getProject(siblingId);
        metadata.energyIq.upsertProject({ ...sibling, status: "archived" });
      }

      rmSync(pointerPath);
      await expect(readCurrentProjectOverviewProjection({
        metadataStore: metadata,
        dataGateway: gateway,
        user,
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        projectId: NGEE_ANN_GOLDEN.projectId,
        databasePath,
      })).rejects.toThrow("ENERGYIQ_OVERVIEW_PROJECTION_NOT_MATERIALIZED");

      const wrongManaged = JSON.parse(immutableBefore.toString("utf8")) as {
        contract: string;
        projectionKey: string;
        identity: typeof initial.contextPackage.identity;
        valueSha256: string;
        value: typeof initial.resolution;
      };
      wrongManaged.identity.scopeId = "ngee-wrong-scope";
      wrongManaged.value.snapshot.context.scopeId = "ngee-wrong-scope";
      wrongManaged.value.snapshot.analysis.context.scopeId = "ngee-wrong-scope";
      if (wrongManaged.value.snapshot.reportTimeContext) {
        wrongManaged.value.snapshot.reportTimeContext.binding.scopeId = "ngee-wrong-scope";
      }
      wrongManaged.projectionKey = createProjectOverviewProjectionKey(wrongManaged.identity);
      wrongManaged.valueSha256 = createHash("sha256")
        .update(JSON.stringify(wrongManaged.value))
        .digest("hex");
      const wrongManagedPath = join(
        cacheDirectory,
        `managed-${createHash("sha256").update(wrongManaged.projectionKey).digest("hex")}.json`,
      );
      rmSync(managedPath);
      writeFileSync(wrongManagedPath, JSON.stringify(wrongManaged));
      await expect(prewarmPublishedProjectOverviewProjections({
        metadataStore: metadata,
        dataGateway: gateway,
        user,
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        databasePath,
      })).resolves.toEqual([{
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        projectId: NGEE_ANN_GOLDEN.projectId,
        status: "not_ready",
      }]);
      expect(existsSync(pointerPath)).toBe(false);
      rmSync(wrongManagedPath);
      writeFileSync(managedPath, immutableBefore);

      const modelRequestCountBefore = metadata.db.prepare(
        "SELECT COUNT(*) AS value FROM model_request_snapshots",
      ).get();
      const metadataChangesBefore = metadata.db.prepare("SELECT total_changes() AS value").get() as {
        value: number;
      };
      const runSqlReadonly = vi.spyOn(gateway, "runSqlReadonly");
      const outcomes = await prewarmPublishedProjectOverviewProjections({
        metadataStore: metadata,
        dataGateway: gateway,
        user,
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        databasePath,
      });

      expect(outcomes).toEqual([{
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        projectId: NGEE_ANN_GOLDEN.projectId,
        status: "materialized",
        changed: true,
        dataSnapshotId: initial.contextPackage.identity.dataSnapshotId,
        projectReleaseId: initial.contextPackage.identity.projectReleaseId,
      }]);
      expect(existsSync(pointerPath)).toBe(true);
      expect(readFileSync(managedPath)).toEqual(immutableBefore);
      expect(metadata.db.prepare(
        "SELECT COUNT(*) AS value FROM model_request_snapshots",
      ).get()).toEqual(modelRequestCountBefore);
      expect(metadata.db.prepare("SELECT total_changes() AS value").get()).toEqual(metadataChangesBefore);
      expect(runSqlReadonly).not.toHaveBeenCalled();

      await expect(prewarmPublishedProjectOverviewProjections({
        metadataStore: metadata,
        dataGateway: gateway,
        user,
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        databasePath,
      })).resolves.toEqual([{
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        projectId: NGEE_ANN_GOLDEN.projectId,
        status: "unchanged",
        changed: false,
        dataSnapshotId: initial.contextPackage.identity.dataSnapshotId,
        projectReleaseId: initial.contextPackage.identity.projectReleaseId,
      }]);
      expect(runSqlReadonly).not.toHaveBeenCalled();

      const restored = await readCurrentProjectOverviewProjection({
        metadataStore: metadata,
        dataGateway: gateway,
        user,
        workspaceId: NGEE_ANN_WORKSPACE_ID,
        projectId: NGEE_ANN_GOLDEN.projectId,
        databasePath,
      });
      expect(restored.contextPackage.identity).toMatchObject({
        dataSnapshotId: initial.contextPackage.identity.dataSnapshotId,
        projectReleaseId: initial.contextPackage.identity.projectReleaseId,
      });
      expect(runSqlReadonly).not.toHaveBeenCalled();

      const providerExecute = vi.fn();
      const apiContext = {
        metadataStore: metadata,
        dataGateway: gateway,
        overviewAiWorkflow: { execute: providerExecute },
        userId: user.id,
        workspaceId: NGEE_ANN_WORKSPACE_ID,
      } as unknown as Required<ConfigApiContext>;
      const changesBeforeGet = (metadata.db.prepare("SELECT total_changes() AS value").get() as {
        value: number;
      }).value;
      const previousDuckDbPath = process.env.ENERGYIQ_DUCKDB_PATH;
      process.env.ENERGYIQ_DUCKDB_PATH = databasePath;
      const [fullResponse, minimumResponse] = await Promise.all([
        handleEnergyApiRequest(
          getRequest(`/api/v1/energy/projects/${NGEE_ANN_GOLDEN.projectId}/overview-projection`),
          ["projects", NGEE_ANN_GOLDEN.projectId, "overview-projection"],
          apiContext,
        ),
        handleEnergyApiRequest(
          getRequest(`/api/v1/energy/projects/${NGEE_ANN_GOLDEN.projectId}/overview-minimum`),
          ["projects", NGEE_ANN_GOLDEN.projectId, "overview-minimum"],
          apiContext,
        ),
      ]).finally(() => {
        if (previousDuckDbPath === undefined) delete process.env.ENERGYIQ_DUCKDB_PATH;
        else process.env.ENERGYIQ_DUCKDB_PATH = previousDuckDbPath;
      });
      expect(fullResponse).toMatchObject({
        status: 200,
        body: { success: true, data: {
          status: "ready",
          overviewContext: { identity: {
            workspaceId: NGEE_ANN_WORKSPACE_ID,
            projectId: NGEE_ANN_GOLDEN.projectId,
            scopeId: "project",
            analysisWindow: "current-project-overview",
            dataSnapshotId: initial.contextPackage.identity.dataSnapshotId,
            projectReleaseId: initial.contextPackage.identity.projectReleaseId,
          } },
        } },
      });
      expect(minimumResponse).toMatchObject({
        status: 200,
        body: { success: true, data: {
          status: "ready",
          binding: { currentPin: {
            dataSnapshotId: initial.contextPackage.identity.dataSnapshotId,
            projectReleaseId: initial.contextPackage.identity.projectReleaseId,
          } },
        } },
      });
      expect(runSqlReadonly).not.toHaveBeenCalled();
      expect(providerExecute).not.toHaveBeenCalled();
      expect((metadata.db.prepare("SELECT total_changes() AS value").get() as {
        value: number;
      }).value).toBe(changesBeforeGet);
    } finally {
      vi.restoreAllMocks();
      metadata.close();
      removeTemporaryFixture(root);
    }
  }, 120_000);

  it("resolves the canonical Preschool June Demo Report Edition with May comparison and no rolling primary fallback", async () => {
    const root = mkdtempSync(join(tmpdir(), "project-analysis-preschool-current-window-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      metadata.energyIq.operationalPolicy.publishOperatingCalendar({
        version_id: "preschool-calendar-may-june-demo-v1",
        project_id: PRESCHOOL_GOLDEN.projectId,
        published_by: "dev-user",
        activate: true,
        entries: [{
          id: "preschool-demo-hours",
          owner: { kind: "project" },
          effective_from: "2026-05-01",
          effective_to: "2026-08-01",
          weekly: {
            monday: [{ from: "08:00", to: "18:00" }],
            tuesday: [{ from: "08:00", to: "18:00" }],
            wednesday: [{ from: "08:00", to: "18:00" }],
            thursday: [{ from: "08:00", to: "18:00" }],
            friday: [{ from: "08:00", to: "18:00" }],
            saturday: [],
            sunday: [],
          },
        }],
      });
      metadata.energyIq.operationalPolicy.publishTariffSchedule({
        version_id: "preschool-tariff-may-july-demo-v1",
        project_id: PRESCHOOL_GOLDEN.projectId,
        published_by: "dev-user",
        activate: true,
        entries: [{
          id: "preschool-demo-tariff",
          owner: { kind: "project" },
          effective_from: "2026-04-30T16:00:00.000Z",
          effective_to: "2026-07-31T16:00:00.000Z",
          currency: "SGD",
          rate_per_kwh: 0.2972,
          rate_basis: "tax_inclusive",
          tax: { name: "GST", rate_pct: 9 },
        }],
      });
      const draft = metadata.energyIq.projectSetup.getDraft({
        project_id: PRESCHOOL_GOLDEN.projectId,
        user_id: "dev-user",
      });
      metadata.energyIq.projectSetup.publishDraft({
        project_id: PRESCHOOL_GOLDEN.projectId,
        expected_revision: draft.revision,
        user_id: "dev-user",
      });
      ensureEnergyIqBootstrap(metadata);
      await materializePreschoolGoldenFixture(databasePath, metadata, {
        transformIntervalFacts: (facts) => facts.flatMap((fact) => (
          Array.from({ length: 61 }, (_, dayOffset) => {
            const localDate = shiftFixtureLocalDate(fact.localDate, dayOffset);
            return {
            ...fact,
              intervalStart: shiftFixtureIsoDate(fact.intervalStart, dayOffset),
              intervalEnd: shiftFixtureIsoDate(fact.intervalEnd, dayOffset),
              localDate,
              dayType: dayTypeForFixtureDate(localDate),
            };
          })
        )),
      });

      const allAvailable = await resolveProjectAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        user: metadata.users.getById({ user_id: "dev-user" }),
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        request: {
          projectId: PRESCHOOL_GOLDEN.projectId,
          scopeId: "project",
          resource: "electricity",
          period: "Custom",
          from: "2026-05-01",
          to: "2026-06-30",
        },
        databasePath,
        now: new Date("2026-08-05T00:00:00.000Z"),
      });
      expect(allAvailable.status).toBe("ready");
      if (allAvailable.status !== "ready") throw new Error("Expected all-available Preschool analysis");
      expect(allAvailable.snapshot.context).toMatchObject({
        from: "2026-04-30T16:00:00.000Z",
        to: "2026-06-30T16:00:00.000Z",
      });
      expect(allAvailable.snapshot).not.toHaveProperty("preschoolBenchmark");

      const current = await resolveProjectAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        user: metadata.users.getById({ user_id: "dev-user" }),
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        request: {
          projectId: PRESCHOOL_GOLDEN.projectId,
          scopeId: "project",
          resource: "electricity",
          analysisWindow: "current-project-overview",
        },
        databasePath,
        now: new Date("2026-08-05T00:00:00.000Z"),
      });
      expect(current.status).toBe("ready");
      if (current.status !== "ready") throw new Error("Expected current Preschool analysis");

      const pinned = await resolveProjectAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        user: metadata.users.getById({ user_id: "dev-user" }),
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        request: {
          projectId: PRESCHOOL_GOLDEN.projectId,
          scopeId: "project",
          resource: "electricity",
          analysisWindow: "current-month-to-date",
          from: "2026-06-01",
          to: "2026-06-30",
          expectedDataSnapshotId: current.snapshot.context.dataSnapshotId,
          expectedProjectReleaseId: current.snapshot.projectRelease.id,
        },
        databasePath,
        now: new Date("2026-08-05T00:00:00.000Z"),
      });

      expect(pinned.status).toBe("ready");
      if (pinned.status !== "ready") throw new Error("Expected pinned Preschool analysis");
      expect(pinned.snapshot.context).toMatchObject({
        from: "2026-05-31T16:00:00.000Z",
        to: "2026-06-30T16:00:00.000Z",
        dataSnapshotId: current.snapshot.context.dataSnapshotId,
        projectReleaseId: current.snapshot.projectRelease.id,
      });
      expect(pinned.snapshot.reportTimeContext).toMatchObject({
        policyId: "preschool-report-time",
        policyRevision: "2",
        dataThroughLocalDate: "2026-06-30",
      });
      expect(pinned.snapshot.reportTimeContext?.windows).toEqual(expect.arrayContaining([
        expect.objectContaining({
          windowId: "current-overview",
          label: "Current calendar month Report Edition",
          phase: "complete",
          from: "2026-05-31T16:00:00.000Z",
          toExclusive: "2026-06-30T16:00:00.000Z",
          completeDayCount: 30,
        }),
        expect.objectContaining({
          windowId: "previous-month-comparison",
          label: "Previous complete calendar month",
          phase: "complete",
          from: "2026-04-30T16:00:00.000Z",
          toExclusive: "2026-05-31T16:00:00.000Z",
          completeDayCount: 31,
          segments: [{
            from: "2026-04-30T16:00:00.000Z",
            toExclusive: "2026-05-31T16:00:00.000Z",
          }],
        }),
        expect.objectContaining({
          windowId: "recent-operations",
          label: "Recent 28 complete days (diagnostic)",
          phase: "complete",
          completeDayCount: 28,
        }),
        expect.objectContaining({
          windowId: "next-month-outlook",
          label: "Next complete calendar month",
          phase: "forecast",
          from: "2026-06-30T16:00:00.000Z",
          toExclusive: "2026-07-31T16:00:00.000Z",
        }),
      ]));
      expect(pinned.snapshot.reportTimeContext?.windows.find(({ windowId }) => windowId === "current-overview")?.strategy)
        .toEqual({ kind: "calendar_month_to_date" });
      expect(pinned.snapshot.reportTimeContext?.windows.find(({ windowId }) => windowId === "day-type-reference"))
        .toEqual(expect.objectContaining({
          phase: "complete",
          from: "2026-05-05T16:00:00.000Z",
          toExclusive: "2026-06-02T16:00:00.000Z",
          completeDayCount: 28,
        }));
      expect(pinned.snapshot.dataQuality.status).toBe("complete");
      expect(pinned.snapshot.analysis.summary.usageKwh).toBeGreaterThan(0);
      expect(pinned.snapshot.preschoolDecisionSignals).toMatchObject({ status: "available" });
      expect(pinned.snapshot.preschoolBenchmark).toMatchObject({ status: "provisional", sampleSize: 30 });
      expect(pinned.snapshot.preschoolAppliances).toMatchObject({ status: "available" });
      expect(pinned.snapshot.preschoolOperational).toMatchObject({
        status: "available",
        coverage: { status: "complete", completeLocalDayCount: 30 },
        planningOutlook: { status: "provisional" },
      });
      expect(pinned.snapshot.reportWindowSegmentSummaries).toEqual([
        {
          windowId: "previous-month-comparison",
          status: "ready",
          segments: [expect.objectContaining({
            period: {
              start: "2026-04-30T16:00:00.000Z",
              endExclusive: "2026-05-31T16:00:00.000Z",
            },
            dataStatus: "complete",
            expectedDayCount: 31,
            completeDayCount: 31,
            summary: expect.objectContaining({ usageKwh: expect.any(Number) }),
            evidence: {
              dataSnapshotId: pinned.snapshot.dataSnapshot.id,
              queryId: "daily_totals_v1",
            },
          })],
        },
      ]);
    } finally {
      metadata.close();
      removeTemporaryFixture(root);
    }
  }, 180_000);

  it("uses the Release-pinned Tariff allocations for every Preschool cost across a cross-month Overview", async () => {
    const root = mkdtempSync(join(tmpdir(), "project-analysis-preschool-cross-month-tariff-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      metadata.energyIq.operationalPolicy.publishTariffSchedule({
        version_id: "preschool-tariff-cross-month-v2",
        project_id: PRESCHOOL_GOLDEN.projectId,
        published_by: "dev-user",
        activate: true,
        entries: [
          {
            id: "preschool-june-rate",
            owner: { kind: "project" },
            effective_from: "2026-06-09T16:00:00.000Z",
            effective_to: "2026-06-30T16:00:00.000Z",
            currency: "SGD",
            rate_per_kwh: 0.25,
            rate_basis: "tax_exclusive",
            tax: { name: "GST", rate_pct: 9 },
          },
          {
            id: "preschool-july-rate",
            owner: { kind: "project" },
            effective_from: "2026-06-30T16:00:00.000Z",
            effective_to: "2026-07-07T16:00:00.000Z",
            currency: "SGD",
            rate_per_kwh: 0.3,
            rate_basis: "tax_exclusive",
            tax: { name: "GST", rate_pct: 9 },
          },
          {
            id: "preschool-forecast-rate",
            owner: { kind: "project" },
            effective_from: "2026-07-07T16:00:00.000Z",
            effective_to: "2026-08-31T16:00:00.000Z",
            currency: "SGD",
            rate_per_kwh: 0.35,
            rate_basis: "tax_exclusive",
            tax: { name: "GST", rate_pct: 9 },
          },
        ],
      });
      metadata.energyIq.operationalPolicy.publishOperatingCalendar({
        version_id: "preschool-calendar-cross-month-v2",
        project_id: PRESCHOOL_GOLDEN.projectId,
        published_by: "dev-user",
        activate: true,
        entries: [{
          id: "preschool-cross-month-hours",
          owner: { kind: "project" },
          effective_from: "2026-06-10",
          effective_to: "2026-07-08",
          weekly: {
            monday: [{ from: "08:00", to: "24:00" }],
            tuesday: [{ from: "08:00", to: "24:00" }],
            wednesday: [{ from: "08:00", to: "24:00" }],
            thursday: [{ from: "08:00", to: "24:00" }],
            friday: [{ from: "08:00", to: "24:00" }],
            saturday: [{ from: "08:00", to: "24:00" }],
            sunday: [{ from: "08:00", to: "24:00" }],
          },
        }],
      });
      const draft = metadata.energyIq.projectSetup.getDraft({
        project_id: PRESCHOOL_GOLDEN.projectId,
        user_id: "dev-user",
      });
      const publishedRelease = metadata.energyIq.projectSetup.publishDraft({
        project_id: PRESCHOOL_GOLDEN.projectId,
        expected_revision: draft.revision,
        user_id: "dev-user",
      });
      await materializePreschoolGoldenFixture(databasePath, metadata, {
        transformIntervalFacts: (facts) => facts.flatMap((fact) => (
          Array.from({ length: 37 }, (_, dayIndex) => {
            const shiftDays = 31 + dayIndex;
            const localDate = shiftFixtureLocalDate(fact.localDate, shiftDays);
            return {
              ...fact,
              intervalStart: shiftFixtureIsoDate(fact.intervalStart, shiftDays),
              intervalEnd: shiftFixtureIsoDate(fact.intervalEnd, shiftDays),
              localDate,
              dayType: dayTypeForFixtureDate(localDate),
            };
          })
        )),
      });

      const result = await resolveProjectAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        user: metadata.users.getById({ user_id: "dev-user" }),
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        request: {
          projectId: PRESCHOOL_GOLDEN.projectId,
          scopeId: "project",
          resource: "electricity",
          period: "Custom",
          from: "2026-06-10",
          to: "2026-07-07",
        },
        databasePath,
      });

      expect(result.status).toBe("ready");
      if (result.status !== "ready") throw new Error("Expected ready cross-month Preschool analysis");
      expect(result.snapshot.projectRelease).toMatchObject({
        id: publishedRelease.template_revision_id,
        tariffScheduleVersion: "preschool-tariff-cross-month-v2",
      });
      expect(result.snapshot.analysis.cost).toMatchObject({
        status: "available",
        currency: "SGD",
        tariffScheduleVersion: "preschool-tariff-cross-month-v2",
        allocations: [
          expect.objectContaining({ ratePerKwh: 0.25 }),
          expect.objectContaining({ ratePerKwh: 0.3 }),
        ],
      });
      if (result.snapshot.preschoolOperational?.status !== "available") {
        throw new Error(JSON.stringify(result.snapshot.preschoolOperational));
      }
      const immutablePreschoolProjection = structuredClone(result) as {
        snapshot: Record<string, any>;
      };
      delete immutablePreschoolProjection.snapshot.decisionLifecycle;
      delete immutablePreschoolProjection.snapshot.preschoolPlanningLifecycle;
      expect(managedProjectionPayloadHasRequiredShape(immutablePreschoolProjection)).toBe(true);
      const malformedSourceWeek = structuredClone(immutablePreschoolProjection);
      malformedSourceWeek.snapshot.preschoolOperational.planningOutlook.sourceWeeks = [null];
      expect(managedProjectionPayloadHasRequiredShape(malformedSourceWeek)).toBe(false);
      expect(result.snapshot.preschoolOperational).toMatchObject({
        status: "available",
        contract: { version: "5" },
        tariffCost: {
          status: "available",
          currency: "SGD",
          tariffScheduleVersion: "preschool-tariff-cross-month-v2",
          allocations: result.snapshot.analysis.cost.status === "available"
            ? result.snapshot.analysis.cost.allocations
            : [],
        },
      });
      const projection = result.snapshot.preschoolOperational as typeof result.snapshot.preschoolOperational & {
        tariffCost: {
          status: "available";
          total: { amount: number };
          standby: { amount: number };
          operating: { amount: number };
        };
      };
      expect(projection).not.toHaveProperty("tariffReference");
      expect(projection.tariffCost.standby.amount + projection.tariffCost.operating.amount)
        .toBeCloseTo(projection.tariffCost.total.amount, 5);
      if (result.snapshot.analysis.cost.status !== "available") {
        throw new Error("Expected available Project cost");
      }
      expect(projection.tariffCost.total.amount)
        .toBeCloseTo(result.snapshot.analysis.cost.amount, 5);
      expect(projection.planningOutlook).toMatchObject({
        status: "provisional",
        targetPeriod: {
          start: "2026-07-01",
          endExclusive: "2026-08-01",
        },
        tariffCost: {
          status: "available",
          currency: "SGD",
          tariffScheduleVersion: "preschool-tariff-cross-month-v2",
          allocations: [
            expect.objectContaining({ ratePerKwh: 0.3 }),
            expect.objectContaining({ ratePerKwh: 0.35 }),
          ],
        },
      });
    } finally {
      metadata.close();
      removeTemporaryFixture(root);
    }
  }, 60_000);

  it("advances the Preschool target month from the latest complete Snapshot day while the Overview stays pinned to May", async () => {
    const root = mkdtempSync(join(tmpdir(), "project-analysis-preschool-target-month-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      await materializePreschoolGoldenFixture(databasePath, metadata, {
        transformIntervalFacts: (facts) => [
          ...facts,
          ...facts.map((fact) => ({
            ...fact,
            intervalStart: shiftFixtureIsoDate(fact.intervalStart, 60),
            intervalEnd: shiftFixtureIsoDate(fact.intervalEnd, 60),
            localDate: "2026-06-30",
            dayType: "weekday" as const,
          })),
        ],
      });

      const result = await resolveProjectAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        user: metadata.users.getById({ user_id: "dev-user" }),
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        request: {
          projectId: PRESCHOOL_GOLDEN.projectId,
          scopeId: "project",
          resource: "electricity",
          period: "Custom",
          from: "2026-05-01",
          to: "2026-05-31",
        },
        databasePath,
      });

      expect(result.status).toBe("ready");
      if (result.status !== "ready") throw new Error("Expected ready Preschool analysis");
      expect(result.snapshot.context).toMatchObject({
        from: "2026-04-30T16:00:00.000Z",
        to: "2026-05-31T16:00:00.000Z",
        latestCompleteLocalDay: "2026-06-30",
        monthlyOutlookTargetPeriod: {
          start: "2026-07-01",
          endExclusive: "2026-08-01",
          timezone: "Asia/Singapore",
          targetDayCount: 31,
        },
      });
    } finally {
      metadata.close();
      removeTemporaryFixture(root);
    }
  }, 30_000);

  it("returns a versioned Preschool Snapshot from one trusted Resolver Interface", async () => {
    const root = mkdtempSync(join(tmpdir(), "project-analysis-resolver-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      const preschoolSnapshot = await materializePreschoolGoldenFixture(databasePath, metadata);
      const runSqlReadonly = vi.spyOn(gateway, "runSqlReadonly");
      const result = await resolveProjectAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        user: metadata.users.getById({ user_id: "dev-user" }),
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        request: {
          projectId: "preschool-demo",
          scopeId: "project",
          resource: "electricity",
          period: "Custom",
          from: "2026-05-01",
          to: "2026-05-31",
        },
        databasePath,
      });

      expect(result.status).toBe("ready");
      if (result.status !== "ready") throw new Error("Expected ready analysis");
      expect(result.snapshot).toMatchObject({
        context: {
          workspaceId: PRESCHOOL_WORKSPACE_ID,
          projectId: "preschool-demo",
          scopeId: "preschool-project",
          from: "2026-04-30T16:00:00.000Z",
          to: "2026-05-31T16:00:00.000Z",
          projectReleaseId: "legacy-profile:preschool-demo:2",
          primaryPeriod: {
            start: "2026-04-30T16:00:00.000Z",
            endExclusive: "2026-05-31T16:00:00.000Z",
          },
        },
        projectRelease: {
          id: "legacy-profile:preschool-demo:2",
          source: "legacy-profile",
          templateRevisionId: null,
          reportTimePolicyRevisionId: "preschool-report-time@2",
        },
        recipe: { id: "energy-scope-analysis", version: "1" },
        renderer: {
          key: "preschool-overview",
          version: "1",
          contractVersion: "project-analysis-snapshot@1",
        },
        dataQuality: { status: "partial", coveragePct: 3.2258 },
        dataSnapshot: {
          id: preschoolSnapshot.id,
        },
        analysis: {
          summary: { usageKwh: PRESCHOOL_GOLDEN.period.usageKwh },
        },
      });
      expect(result.snapshot.evidence.length).toBeGreaterThan(0);
      expect(result.snapshot.evidence.every((item) => (
        item.id.length > 0
        && item.metricId.length > 0
        && item.queryIds.length > 0
        && item.queryIds.every((queryId) => result.snapshot.analysis.provenance.queryIds.includes(queryId))
        && !Object.hasOwn(item, "queryReceiptId")
      ))).toBe(true);
      expect(new Set(result.snapshot.evidence.map((item) => item.id)).size)
        .toBe(result.snapshot.evidence.length);
      expect(result.snapshot.findings).toEqual(result.snapshot.analysis.attention);
      expect(result.snapshot).not.toHaveProperty("decisionPriorities");
      const completeProjectDays = result.snapshot.analysis.dailyTotals?.scopes
        .find((scope) => scope.scopeId === "preschool-project")?.rows
        .filter((row) => row.dataHealth.status === "complete") ?? [];
      expect(completeProjectDays.length).toBeLessThan(28);
      expect(result.snapshot).not.toHaveProperty("preschoolBenchmark");
      expect(result.snapshot.preschoolDecisionSignals).toMatchObject({
        contract: { id: "preschool-decision-signals", version: "1" },
        context: {
          projectReleaseId: "legacy-profile:preschool-demo:2",
          dataSnapshotId: preschoolSnapshot.id,
        },
        status: "withheld",
        reason: { code: "SNAPSHOT_INCOMPLETE" },
        items: [],
      });
      expect(result.snapshot.preschoolOperational).toMatchObject({
        status: "unavailable",
        reason: { code: "PRESCHOOL_OPERATING_CALENDAR_UNAVAILABLE" },
        evidence: {
          projectReleaseId: "legacy-profile:preschool-demo:2",
          dataSnapshotId: preschoolSnapshot.id,
        },
      });
      expect(result.snapshot.analysis.timeBehaviour).toBeUndefined();
      expect(result.snapshot.analysis.provenance.queryIds).not.toContain("time_bucket_grid_v1");
      expect(result.snapshot.analysis.provenance.queryIds)
        .not.toContain("operational_policy_meter_intervals_v1");
      expect(runSqlReadonly).toHaveBeenCalledTimes(15);
      expect(result.snapshot.metadata).toMatchObject({
        hierarchyRevisionId: "preschool-hierarchy-v4",
        timezone: "Asia/Singapore",
        selectedScope: {
          scopeId: "preschool-project",
          scopeName: "Preschool Portfolio",
          status: "missing",
          normalisations: {
            eui: {
              status: "missing",
              value: null,
            },
            perPax: {
              status: "missing",
              value: null,
            },
          },
        },
      });
      expect(result.snapshot.metadata.comparisonScopes).toHaveLength(30);
      expect(result.snapshot.metadata.comparisonScopes[0]).toMatchObject({
        scopeId: PRESCHOOL_GOLDEN.centreA.scopeId,
        scopeName: "Centre A",
        usageKwh: PRESCHOOL_GOLDEN.centreA.usageKwh,
        status: "provisional",
        area: { status: "provisional", value: 743, unit: "m2" },
        headcount: { status: "provisional", value: 58, unit: "people" },
        normalisations: {
          eui: { status: "provisional", unit: "kWh/m2" },
          perPax: { status: "provisional", unit: "kWh/person" },
        },
      });
      expect(result.snapshot.metadata.comparisonScopes[0]?.normalisations.eui.value)
        .toBeCloseTo(PRESCHOOL_GOLDEN.centreA.usageKwh / 743, 8);
      expect(result.snapshot.metadata.comparisonScopes[0]?.normalisations.perPax.value)
        .toBeCloseTo(PRESCHOOL_GOLDEN.centreA.usageKwh / 58, 8);
      expect(result.snapshot.analysis.childScopes[0]).toMatchObject({
        nodeId: PRESCHOOL_GOLDEN.centreA.scopeId,
        areaSqm: 743,
        occupantCount: 58,
        kwhPerSqm: PRESCHOOL_GOLDEN.centreA.usageKwh / 743,
        kwhPerPerson: PRESCHOOL_GOLDEN.centreA.usageKwh / 58,
        metadata: {
          status: "provisional",
          normalisations: {
            eui: { status: "provisional" },
            perPax: { status: "provisional" },
          },
        },
      });
      expect(result.snapshot.metadata.evidence[0]).toMatchObject({
        scopeId: PRESCHOOL_GOLDEN.centreA.scopeId,
        dimension: "area",
        value: 743,
        status: "provisional",
        hierarchyRevisionId: "preschool-hierarchy-v4",
      });
      expect(result.snapshot.analysis.metadata).toEqual(result.snapshot.metadata);

      const selectedCentreResult = await resolveProjectAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        user: metadata.users.getById({ user_id: "dev-user" }),
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        request: {
          projectId: "preschool-demo",
          scopeId: PRESCHOOL_GOLDEN.centreA.scopeId,
          resource: "electricity",
          period: "Custom",
          from: "2026-05-01",
          to: "2026-05-31",
        },
        databasePath,
      });
      expect(selectedCentreResult.status).toBe("ready");
      if (selectedCentreResult.status !== "ready") throw new Error("Expected Centre analysis");
      expect(selectedCentreResult.snapshot.metadata.selectedScope).toMatchObject({
        scopeId: PRESCHOOL_GOLDEN.centreA.scopeId,
        scopeName: "Centre A",
        usageKwh: PRESCHOOL_GOLDEN.centreA.usageKwh,
        status: "provisional",
        area: { value: 743, status: "provisional" },
        headcount: { value: 58, status: "provisional" },
        normalisations: {
          eui: { status: "provisional" },
          perPax: { status: "provisional" },
        },
      });
      expect(selectedCentreResult.snapshot.analysis.summary).toMatchObject({
        areaSqm: 743,
        occupantCount: 58,
        kwhPerSqm: PRESCHOOL_GOLDEN.centreA.usageKwh / 743,
        kwhPerPerson: PRESCHOOL_GOLDEN.centreA.usageKwh / 58,
      });

      const project = metadata.energyIq.getProject("preschool-demo");
      const publishedRevision = metadata.energyIq.templates.publishProjectRevisionWithinTransaction({
        project_id: "preschool-demo",
        tier_definition_ids: metadata.energyIq.listTierDefinitions("preschool-demo")
          .map((tier) => tier.id),
        hierarchy_revision_id: project.hierarchy_revision_id,
        meter_mapping_revision_id: resolveEnergyPublishedMeterRoute({ metadataStore: metadata, projectId: project.id, hierarchyRevisionId: project.hierarchy_revision_id, scopeId: project.root_scope_id, resource: "electricity" }).meterMappingRevisionId,
        published_by: "dev-user",
        published_at: "2026-08-04T00:00:00.000Z",
      });
      metadata.energyIq.upsertProject({
        ...project,
        hierarchy_revision_id: "unpublished-hierarchy-drift",
        meter_formula_revision_id: "unpublished-meter-formula-drift",
        metric_version: "unpublished-metric-drift",
        business_calendar_version: "unpublished-calendar-drift",
        tariff_schedule_version: "unpublished-tariff-drift",
      });
      const releasedResult = await resolveProjectAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        user: metadata.users.getById({ user_id: "dev-user" }),
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        request: {
          projectId: "preschool-demo",
          scopeId: "project",
          resource: "electricity",
          period: "Custom",
          from: "2026-05-01",
          to: "2026-05-31",
        },
        databasePath,
      });
      expect(releasedResult.status).toBe("ready");
      if (releasedResult.status !== "ready") throw new Error("Expected released analysis");
      expect(releasedResult.snapshot.projectRelease).toMatchObject({
        id: publishedRevision.revision_id,
        source: "template-revision",
        templateRevisionId: publishedRevision.revision_id,
        hierarchyRevisionId: publishedRevision.hierarchy_revision_id,
        metricRevisionIds: publishedRevision.selected_metric_revision_ids,
        ruleRevisionIds: publishedRevision.selected_rule_revision_ids,
      });
      expect(releasedResult.snapshot.context).toMatchObject({
        projectReleaseId: publishedRevision.revision_id,
        hierarchyRevisionId: publishedRevision.hierarchy_revision_id,
        meterFormulaRevisionId: publishedRevision.meter_formula_revision_id,
        metricVersion: `metric-revisions:${[...publishedRevision.selected_metric_revision_ids]
          .sort((left, right) => left.localeCompare(right))
          .join(",") || "none"}`,
        businessCalendarVersion: publishedRevision.business_calendar_version,
        tariffScheduleVersion: publishedRevision.tariff_schedule_version,
        primaryPeriod: {
          start: "2026-04-30T16:00:00.000Z",
          endExclusive: "2026-05-31T16:00:00.000Z",
        },
      });
      expect(releasedResult.snapshot.analysis.provenance).toMatchObject({
        hierarchyRevisionId: publishedRevision.hierarchy_revision_id,
        meterFormulaRevisionId: publishedRevision.meter_formula_revision_id,
        metricVersion: `metric-revisions:${[...publishedRevision.selected_metric_revision_ids]
          .sort((left, right) => left.localeCompare(right))
          .join(",") || "none"}`,
      });
      expect(releasedResult.snapshot.analysis.cost).toMatchObject({
        tariffScheduleVersion: publishedRevision.tariff_schedule_version,
      });
      expect(releasedResult.snapshot.evidence).toEqual(result.snapshot.evidence);

      const anotherPeriodResult = await resolveProjectAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        user: metadata.users.getById({ user_id: "dev-user" }),
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        request: {
          projectId: "preschool-demo",
          scopeId: "project",
          resource: "electricity",
          period: "Custom",
          from: "2026-05-01",
          to: "2026-05-02",
        },
        databasePath,
      });
      expect(anotherPeriodResult.status).toBe("ready");
      if (anotherPeriodResult.status !== "ready") throw new Error("Expected another period");
      expect(anotherPeriodResult.snapshot.evidence.map((item) => item.id))
        .not.toEqual(releasedResult.snapshot.evidence.map((item) => item.id));
    } finally {
      metadata.close();
      removeTemporaryFixture(root);
    }
  }, 30_000);
});

const materializeNgeeAnnLatestPeriodFixture = async (
  databasePath: string,
  metadataStore: ReturnType<typeof createMetadataStore>,
  options: { includeHolidayHistory?: boolean } = {},
) => {
  const importBatchId = "ngee-ann-latest-period-contract-fixture";
  const sourceSha256 = "f".repeat(64);
  const sourceFile = `${importBatchId}.xlsx`;
  const latestPeriodFromMs = Date.parse("2026-06-02T16:00:00.000Z");
  const holidayPeriodFromMs = Date.parse("2026-02-16T16:00:00.000Z");
  const meters = [
    {
      id: "mapping-lvl-6-total-office-light-8",
      scopeId: "level-6",
      sourceLabel: "Lvl 6 Total Office Light",
      category: "light" as const,
      meterRole: "total" as const,
      parentNodeId: "level-6",
      pattern: "latest-seven" as const,
    },
    {
      id: "mapping-lvl-6-total-office-load-9",
      scopeId: "level-6",
      sourceLabel: "Lvl 6 Total Office Load",
      category: "load" as const,
      meterRole: "total" as const,
      parentNodeId: "level-6",
      pattern: "latest-seven" as const,
    },
    {
      id: "mapping-lvl-7-total-office-light-17",
      scopeId: "level-7",
      sourceLabel: "Lvl 7 Total Office Light",
      category: "light" as const,
      meterRole: "total" as const,
      parentNodeId: "level-7",
      pattern: "complete-fourteen" as const,
    },
    {
      id: "mapping-lvl-7-total-office-load-18",
      scopeId: "level-7",
      sourceLabel: "Lvl 7 Total Office Load",
      category: "load" as const,
      meterRole: "total" as const,
      parentNodeId: "level-7",
      pattern: "complete-fourteen" as const,
    },
    {
      id: "mapping-lvl-7-front-row-office-light-11",
      scopeId: "l7-front-light",
      sourceLabel: "Lvl 7 Front Row Office Light",
      category: "light" as const,
      meterRole: "component" as const,
      parentNodeId: "level-7",
      pattern: "quality-event" as const,
    },
    {
      id: "mapping-lvl-6-office-light-left-external-1",
      scopeId: "l6-light-left",
      sourceLabel: "Lvl 6 Office Light-Left: External",
      category: "light" as const,
      meterRole: "component" as const,
      parentNodeId: "level-6",
      pattern: "compensating-intervals" as const,
    },
  ];
  const intervalFacts: EnergyIntervalFactWrite[] = meters.flatMap((meter) => {
    const includeHolidayHistory = options.includeHolidayHistory === true
      && meter.meterRole === "total";
    const localFromMs = includeHolidayHistory ? holidayPeriodFromMs : latestPeriodFromMs;
    const firstIntervalIndex = includeHolidayHistory ? 0 : meter.pattern === "latest-seven"
      || meter.pattern === "compensating-intervals"
      ? 7 * 24 * 4
      : 0;
    const intervalCount = includeHolidayHistory ? 120 * 24 * 4 : meter.pattern === "latest-seven"
      || meter.pattern === "compensating-intervals"
      ? 7 * 24 * 4
      : 14 * 24 * 4;
    const intervalIndexes = Array.from(
      { length: intervalCount },
      (_, index) => firstIntervalIndex + index,
    );
    if (meter.pattern === "compensating-intervals") {
      intervalIndexes.shift();
      intervalIndexes.push(firstIntervalIndex + 24 * 4 + 0.5);
    }
    return intervalIndexes.map((intervalIndex, index) => {
      const intervalStartMs = localFromMs + intervalIndex * 15 * 60_000;
      const local = new Date(intervalStartMs + 8 * 60 * 60_000);
      const qualityStatus = meter.pattern === "quality-event" && intervalIndex === 7 * 24 * 4
        ? "negative_delta"
        : "ok";
      return {
        workspaceId: NGEE_ANN_GOLDEN.workspaceId,
        projectId: NGEE_ANN_GOLDEN.projectId,
        importBatchId,
        resource: "electricity",
        meterPointId: meter.id,
        scopeId: meter.scopeId,
        parentNodeId: meter.parentNodeId,
        sourceLabel: meter.sourceLabel,
        category: meter.category,
        meterRole: meter.meterRole,
        intervalStart: new Date(intervalStartMs).toISOString(),
        intervalEnd: new Date(intervalStartMs + 15 * 60_000).toISOString(),
        elapsedMinutes: 15,
        activeEnergyKwh: 1_000 + (index + 1) * 0.25,
        previousActiveEnergyKwh: 1_000 + index * 0.25,
        rawDeltaKwh: 0.25,
        ...(qualityStatus === "ok" ? { usageKwh: 0.25, averageKw: 1 } : {}),
        qualityStatus,
        localDate: local.toISOString().slice(0, 10),
        localHour: local.getUTCHours(),
        dayType: [0, 6].includes(local.getUTCDay()) ? "weekend" : "weekday",
        sourceFile,
        sourceSha256,
        sourceReadingKind: "interval_usage",
      } satisfies EnergyIntervalFactWrite;
    });
  });
  const batches: EnergyFactMaterializationBatchWrite[] = [{
    importBatchId,
    sourceSha256,
    rawReadings: [],
    normalizedReadings: [],
    intervalFacts,
    qualityEvents: [],
  }];
  metadataStore.energyIq.createImportBatch({
    id: importBatchId,
    workspace_id: NGEE_ANN_GOLDEN.workspaceId,
    project_id: NGEE_ANN_GOLDEN.projectId,
    source_kind: "excel",
    source_sha256: sourceSha256,
    filename: sourceFile,
    status: "inspected",
    inspection: {
      sourceLabels: meters.map((meter) => ({ label: meter.sourceLabel, rowCount: 1 })),
      coverageFrom: "2026-06-03T00:00:00.000Z",
      coverageTo: "2026-06-16T23:45:00.000Z",
    },
    created_by: "dev-user",
  });
  return materializeTestProjectSnapshot({
    metadataStore,
    databasePath,
    workspaceId: NGEE_ANN_GOLDEN.workspaceId,
    projectId: NGEE_ANN_GOLDEN.projectId,
    timezone: NGEE_ANN_GOLDEN.timezone,
    batches,
  });
};

const publishHolidayNgeeRelease = (
  metadata: ReturnType<typeof createMetadataStore>,
) => {
  const release = metadata.energyIq.templates.getLatestProjectRevision(NGEE_ANN_GOLDEN.projectId);
  if (!release) throw new Error("Expected production-bootstrap Ngee Ann Holiday Release");
  return release;
};

const shiftFixtureIsoDate = (value: string, days: number): string => {
  const shifted = new Date(value);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString();
};

const shiftFixtureLocalDate = (value: string, days: number): string => {
  const shifted = new Date(`${value}T00:00:00.000Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
};

const localDateForFixtureInstant = (value: string, timezone: string): string => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => (
    parts.find((item) => item.type === type)?.value ?? ""
  );
  return `${part("year")}-${part("month")}-${part("day")}`;
};

const dayTypeForFixtureDate = (value: string): "weekday" | "weekend" => {
  const day = new Date(`${value}T00:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6 ? "weekend" : "weekday";
};

const getRequest = (url: string): IncomingMessage => {
  const request = new PassThrough() as PassThrough & IncomingMessage;
  request.method = "GET";
  request.url = url;
  request.headers = {};
  request.end();
  return request;
};

const removeTemporaryFixture = (root: string): void => {
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    if (
      process.platform === "win32"
      && error instanceof Error
      && "code" in error
      && (error.code === "EPERM" || error.code === "EBUSY")
    ) {
      return;
    }
    throw error;
  }
};
