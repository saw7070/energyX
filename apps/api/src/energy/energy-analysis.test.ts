import {
  readEnergyFactProjectState,
  LocalDataGateway,
  type EnergyFactMaterializationBatchWrite,
  type EnergyIntervalFactWrite,
  type EnergyNormalizedReadingWrite
} from "@datafoundry/data-gateway";
import {
  createMetadataStore,
  resolveEnergyIqSnapshotFactScope,
  type EnergyIqMeterMappingRow,
  type EnergyIqRuleRevisionRecord,
  type EnergyIqVirtualMeter,
  type MetadataStore,
} from "@datafoundry/metadata";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildEnergyVirtualMeterTraces,
  evaluateEnergyAttention,
  executeEnergyScopeAnalysis,
  executeEnergyScopeAnalysisWithLatestAvailable,
  resolveEnergyCurrentOverviewPeriodBasis,
  resolveEnergyReportingHealth,
  selectEnergyLatestCompleteDay,
  selectEnergyCurrentOverviewPeriod,
  selectEnergyGoldenPeriod,
  selectEnergyLatestCompletePeriod,
  type EnergyScopeAnalysis,
} from "./energy-analysis.js";
import { ensureEnergyIqBootstrap, PRESCHOOL_WORKSPACE_ID } from "./energy-bootstrap.js";
import { resolveEnergyQueryContext } from "./energy-query-context.js";
import { NGEE_ANN_GOLDEN } from "./ngee-ann-golden.fixture.js";
import { materializePreschoolGoldenFixture, PRESCHOOL_GOLDEN } from "./preschool-golden.fixture.js";
import { materializeTestProjectSnapshot } from "./energy-test-materialization.js";

describe("Energy current Overview window contract", () => {
  it("keeps rolling 7 days, rolling 28 days and calendar month-to-date as distinct public contracts", () => {
    expect(resolveEnergyCurrentOverviewPeriodBasis("current-overview-7d")).toBe("rolling_7_days");
    expect(resolveEnergyCurrentOverviewPeriodBasis("current-overview-28d")).toBe("rolling_28_days");
    expect(resolveEnergyCurrentOverviewPeriodBasis("current-month-to-date")).toBe("calendar_month_to_date");
  });

  it("reads a Workspace fact store from STORAGE_ROOT_DIR when no single DuckDB path is configured", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-analysis-storage-root-"));
    const storageRoot = join(root, "shared-storage");
    const databasePath = join(storageRoot, "energy", NGEE_ANN_GOLDEN.workspaceId, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    const selectionScopes: Array<{ from: string; to: string }> = [];
    let forceNextSelectionMiss = false;
    let forcedSelectionMiss = false;
    const runSqlReadonly = gateway.runSqlReadonly.bind(gateway);
    gateway.runSqlReadonly = async (request) => {
      if (request.sql.includes("AS cutoff_local_date")) {
        const datasource = metadata.dataSources.get({
          user_id: request.user_id,
          datasource_id: request.datasource_id,
        });
        const scope = (JSON.parse(datasource.config_json) as {
          energyQueryScope?: { from?: unknown; to?: unknown };
        }).energyQueryScope;
        if (typeof scope?.from === "string" && typeof scope.to === "string") {
          selectionScopes.push({ from: scope.from, to: scope.to });
        }
        if (forceNextSelectionMiss && !forcedSelectionMiss) {
          forcedSelectionMiss = true;
          return {
            columns: [],
            rows: [],
            row_count: 0,
            audit_log_id: "forced-bounded-selection-miss",
            elapsed_ms: 0,
          };
        }
      }
      return runSqlReadonly(request);
    };
    const previousStorageRoot = process.env.STORAGE_ROOT_DIR;
    const previousDuckDbPath = process.env.ENERGYIQ_DUCKDB_PATH;
    try {
      mkdirSync(join(storageRoot, "energy", NGEE_ANN_GOLDEN.workspaceId), { recursive: true });
      process.env.STORAGE_ROOT_DIR = storageRoot;
      delete process.env.ENERGYIQ_DUCKDB_PATH;
      ensureEnergyIqBootstrap(metadata);
      await materializeNgeeAnnGoldenFixture(databasePath, metadata);
      const user = metadata.users.getById({ user_id: "dev-user" });
      const context = resolveEnergyQueryContext({
        metadataStore: metadata,
        user,
        workspaceId: NGEE_ANN_GOLDEN.workspaceId,
        request: {
          projectId: NGEE_ANN_GOLDEN.projectId,
          scopeId: "project",
          resource: "electricity",
          period: "Last 7 days",
        },
      });

      await expect(selectEnergyCurrentOverviewPeriod({
        metadataStore: metadata,
        dataGateway: gateway,
        userId: user.id,
        context,
        periodBasis: "calendar_month_to_date",
      })).resolves.toMatchObject({
        periodBasis: "calendar_month_to_date",
        cutoffLocalDate: "2026-06-16",
        period: {
          localFrom: "2026-06-01",
          localToExclusive: "2026-06-17",
        },
      });
      expect(selectionScopes).toHaveLength(1);
      expect(Date.parse(selectionScopes[0]!.to) - Date.parse(selectionScopes[0]!.from))
        .toBeLessThanOrEqual(15 * 86_400_000);

      forceNextSelectionMiss = true;
      await expect(selectEnergyCurrentOverviewPeriod({
        metadataStore: metadata,
        dataGateway: gateway,
        userId: user.id,
        context,
        periodBasis: "calendar_month_to_date",
      })).resolves.toMatchObject({ cutoffLocalDate: "2026-06-16" });
      expect(forcedSelectionMiss).toBe(true);
      expect(selectionScopes).toHaveLength(3);
      expect(Date.parse(selectionScopes[1]!.to) - Date.parse(selectionScopes[1]!.from))
        .toBeLessThanOrEqual(15 * 86_400_000);
      expect(Date.parse(selectionScopes[2]!.to) - Date.parse(selectionScopes[2]!.from))
        .toBeGreaterThan(15 * 86_400_000);
    } finally {
      if (previousStorageRoot === undefined) delete process.env.STORAGE_ROOT_DIR;
      else process.env.STORAGE_ROOT_DIR = previousStorageRoot;
      if (previousDuckDbPath === undefined) delete process.env.ENERGYIQ_DUCKDB_PATH;
      else process.env.ENERGYIQ_DUCKDB_PATH = previousDuckDbPath;
      metadata.close();
      removeTemporaryEnergyFixture(root);
    }
  }, 30_000);
});

describe("EnergyScopeAnalysis", () => {
  it("calculates reproducible Preschool portfolio and circuit drill-down facts", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-analysis-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      const preschoolSnapshot = await materializePreschoolGoldenFixture(databasePath, metadata);
      configurePreschoolOperationalPolicy(metadata);
      const user = metadata.users.getById({ user_id: "dev-user" });
      const context = resolveEnergyQueryContext({
        metadataStore: metadata,
        user,
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        request: {
          projectId: "preschool-demo",
          scopeId: "preschool-project",
          resource: "electricity",
          period: "Custom",
          from: "2026-05-01",
          to: "2026-05-31"
        }
      });
      const portfolio = await executeEnergyScopeAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        userId: "dev-user",
        context,
        databasePath
      });

      expect(portfolio.summary.usageKwh).toBe(PRESCHOOL_GOLDEN.period.usageKwh);
      expect(portfolio.summary.averageDailyUsageKwh).toBe(PRESCHOOL_GOLDEN.period.averageDailyUsageKwh);
      expect(portfolio.summary.nonOperatingSharePct).toBe(PRESCHOOL_GOLDEN.period.nonOperatingSharePct);
      expect(portfolio.cost).toMatchObject({
        status: "available",
        amount: 6230.453075,
        currency: "SGD",
        tariffScheduleVersion: "sg-tariff-v1",
      });
      expect(portfolio.offHours).toMatchObject({
        status: "available",
        standbyKwh: 3102.765631,
        businessCalendarVersion: "sg-preschool-calendar-v1",
      });
      expect(portfolio.hourlyProfile).toHaveLength(24);
      const portfolioTimeCells = portfolio.timeBehaviour?.scopes.find(
        (scope) => scope.scopeId === "preschool-project",
      )?.cells ?? [];
      expect(portfolioTimeCells).toHaveLength(31 * 24);
      expect(portfolioTimeCells.filter((cell) => cell.usageKwh !== null)).toHaveLength(24);
      expect(roundForGolden(portfolioTimeCells.reduce(
        (sum, cell) => sum + (cell.usageKwh ?? 0),
        0,
      ))).toBeCloseTo(portfolio.summary.usageKwh, 3);
      expect(portfolio.timeBehaviour?.dayProfiles.find((profile) => (
        profile.scopeId === "preschool-project" && profile.dayType === "weekday"
      ))).toMatchObject({ status: "available", sampleDayCount: 1 });
      expect(portfolio.timeBehaviour?.dayProfiles.find((profile) => (
        profile.scopeId === "preschool-project" && profile.dayType === "weekend"
      ))).toMatchObject({
        status: "unavailable",
        reason: { code: "COMPLETE_DAY_SAMPLE_UNAVAILABLE" },
      });
      expect(portfolio.dailyUsageAnomalies).toBeUndefined();
      expect(portfolio.provenance.queryIds).toContain("time_bucket_grid_v1");
      expect(portfolio.childScopes).toHaveLength(PRESCHOOL_GOLDEN.period.centreCount);
      expect(portfolio.circuits).toHaveLength(PRESCHOOL_GOLDEN.period.circuitCount);
      expect(portfolio.virtualMeterTraces).toBeUndefined();
      expect(portfolio.childScopes.every((child) => child.usageKwh > 0)).toBe(true);
      expect(portfolio.childScopes.reduce((sum, child) => sum + child.usageKwh, 0))
        .toBeCloseTo(portfolio.summary.usageKwh, 4);
      expect(portfolio.provenance).toMatchObject({
        dataSnapshotId: preschoolSnapshot.id,
        hierarchyRevisionId: "preschool-hierarchy-v4",
        meterFormulaRevisionId: "preschool-meter-formula-v2",
        aggregationRule: "component"
      });
      expect(portfolio.provenance.ruleRevisionIds).toContain("time.high_off_hours_share@1");
      expect(portfolio.attention.some((item) => item.code === "NON_OPERATING_SHARE")).toBe(true);

      const centreContext = resolveEnergyQueryContext({
        metadataStore: metadata,
        user,
        workspaceId: PRESCHOOL_WORKSPACE_ID,
        request: {
          projectId: "preschool-demo",
          scopeId: PRESCHOOL_GOLDEN.centreA.scopeId,
          resource: "electricity",
          period: "Custom",
          from: "2026-05-01",
          to: "2026-05-31"
        }
      });
      const centre = await executeEnergyScopeAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        userId: "dev-user",
        context: centreContext,
        databasePath
      });
      expect(centre.summary.usageKwh).toBe(PRESCHOOL_GOLDEN.centreA.usageKwh);
      expect(centre.circuits).toHaveLength(PRESCHOOL_GOLDEN.centreA.circuitCount);
      expect(centre.childScopes).toHaveLength(PRESCHOOL_GOLDEN.centreA.circuitCount);
    } finally {
      metadata.close();
      removeTemporaryEnergyFixture(root);
    }
  }, 60_000);

  it("returns the latest accepted cumulative register only for an eligible leaf Circuit", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-analysis-latest-reading-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    const availableMeterNodeId = "preschool-centre-a-aircon-1";
    const unavailableMeterNodeId = "preschool-centre-a-aircon-2";
    try {
      ensureEnergyIqBootstrap(metadata);
      await materializePreschoolGoldenFixture(databasePath, metadata, {
        transformIntervalFacts: (facts) => facts.filter(
          (fact) => fact.meterPointId !== availableMeterNodeId
            && fact.meterPointId !== unavailableMeterNodeId,
        ),
        normalizedReadings: [
          cumulativeReading(availableMeterNodeId, "Aircon 1", "2026-05-01T15:00:00.000Z", 1_001, 1),
          cumulativeReading(availableMeterNodeId, "Aircon 1", "2026-05-01T16:00:00.000Z", 1_005, 2),
          cumulativeReading(unavailableMeterNodeId, "Aircon 2", "2026-05-01T16:00:00.000Z", 2_001, 3),
        ],
      });
      const user = metadata.users.getById({ user_id: "dev-user" });
      const analyzeScope = async (scopeId: string) => await executeEnergyScopeAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        userId: "dev-user",
        context: resolveEnergyQueryContext({
          metadataStore: metadata,
          user,
          workspaceId: PRESCHOOL_WORKSPACE_ID,
          request: {
            projectId: PRESCHOOL_GOLDEN.projectId,
            scopeId,
            resource: "electricity",
            period: "Custom",
            from: PRESCHOOL_GOLDEN.period.localFrom,
            to: PRESCHOOL_GOLDEN.period.localToInclusive,
          },
        }),
        databasePath,
        ruleRevisions: [],
        includeTimeBehaviour: false,
        includeMeterOperationalBreakdown: false,
      });

      const project = await analyzeScope("preschool-project");
      expect(project.latestAcceptedReading).toEqual({
        status: "not_applicable",
        queryId: "latest_accepted_reading_v1",
        reason: {
          code: "LEAF_METER_REQUIRED",
          message: "Select a leaf Meter or Circuit to view its latest accepted cumulative reading.",
        },
      });
      expect(project.provenance.queryIds).not.toContain("latest_accepted_reading_v1");
      expect(project.calendarTotals).toMatchObject({
        metricId: "energy.total_usage_kwh@1",
        timezone: "Asia/Singapore",
        derivedFromQueryId: "daily_totals_v1",
      });
      const projectCalendarScope = project.calendarTotals?.scopes[0];
      expect(projectCalendarScope?.weeks).toHaveLength(5);
      expect(projectCalendarScope?.weeks.some((row) => row.isPartialCalendarPeriod)).toBe(true);
      expect(projectCalendarScope?.months).toHaveLength(1);
      expect(projectCalendarScope?.months[0]).toMatchObject({
        localFrom: "2026-05-01",
        localToInclusive: "2026-05-31",
        isPartialCalendarPeriod: false,
      });
      expect(projectCalendarScope?.months[0]?.usageKwh).toBeCloseTo(project.summary.usageKwh, 4);

      const centre = await analyzeScope(PRESCHOOL_GOLDEN.centreA.scopeId);
      expect(centre.latestAcceptedReading).toMatchObject({
        status: "not_applicable",
        reason: { code: "LEAF_METER_REQUIRED" },
      });

      const available = await analyzeScope(availableMeterNodeId);
      expect(available.latestAcceptedReading).toMatchObject({
        status: "available",
        recordedAt: "2026-05-01T16:00:00.000Z",
        meterNodeId: availableMeterNodeId,
        sourceFile: "preschool-golden-may-2026.fixture",
        sourceSha256: "preschool-golden-may-2026",
        sourceReadingKind: "cumulative_energy",
        queryId: "latest_accepted_reading_v1",
      });
      expect(available.latestAcceptedReading.status).toBe("available");
      if (available.latestAcceptedReading.status === "available") {
        expect(available.latestAcceptedReading.valueKwh).toBeGreaterThan(1_000);
      }
      expect(available.provenance.queryIds).toContain("latest_accepted_reading_v1");

      const unavailable = await analyzeScope(unavailableMeterNodeId);
      expect(unavailable.latestAcceptedReading).toEqual({
        status: "unavailable",
        queryId: "latest_accepted_reading_v1",
        reason: {
          code: "ACCEPTED_CUMULATIVE_READING_UNAVAILABLE",
          message: "No accepted cumulative register reading is available in the selected period.",
        },
      });

      const intervalUsage = await analyzeScope("preschool-centre-a-heater");
      expect(intervalUsage.latestAcceptedReading).toEqual({
        status: "not_applicable",
        queryId: "latest_accepted_reading_v1",
        reason: {
          code: "INTERVAL_USAGE_SOURCE",
          message: "This Meter is supplied as interval usage, so a cumulative register reading does not apply.",
        },
      });
    } finally {
      metadata.close();
      removeTemporaryEnergyFixture(root);
    }
  }, 30_000);

  it("fails daily usage anomalies closed without the release-pinned Calendar", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-analysis-anomaly-calendar-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      await materializeNgeeAnnGoldenFixture(databasePath, metadata);
      const user = metadata.users.getById({ user_id: "dev-user" });
      const context = resolveEnergyQueryContext({
        metadataStore: metadata,
        user,
        workspaceId: "default",
        request: {
          projectId: "ngee-ann-polytechnic",
          scopeId: "project",
          resource: "electricity",
          period: "Custom",
          from: NGEE_ANN_GOLDEN.selection.period.localFrom,
          to: "2026-06-16",
        },
      });
      const anomalyRule = metadata.energyIq.rules.listRevisions().find(
        (rule) => rule.evaluation_key === "DAILY_USAGE_ABOVE_BASELINE",
      );
      if (!anomalyRule) throw new Error("DAILY_USAGE_ABOVE_BASELINE_RULE_MISSING");

      const invalidRuleAnalysis = await executeEnergyScopeAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        userId: "dev-user",
        context,
        databasePath,
        projectReleaseId: "ngee-ann-test-release@1",
        ruleRevisions: [{
          ...anomalyRule,
          revision_id: "comparison.daily_usage_above_baseline@2",
          metric_revision_ids: ["energy.some_other_metric@1"],
          parameters: { ...anomalyRule.parameters, relative_threshold_pct: 21 },
        }],
        includeTimeBehaviour: false,
      });
      expect(invalidRuleAnalysis.dailyUsageAnomalies).toMatchObject({
        status: "unavailable",
        reason: { code: "DAILY_USAGE_ANOMALY_RULE_INVALID" },
      });
      expect(invalidRuleAnalysis.provenance.queryIds).not.toContain("time_slot_anomaly_v1");

      const analysis = await executeEnergyScopeAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        userId: "dev-user",
        context,
        databasePath,
        projectReleaseId: "ngee-ann-test-release@1",
        ruleRevisions: [anomalyRule],
        includeTimeBehaviour: false,
      });

      expect(analysis.dailyUsageAnomalies).toEqual({
        status: "unavailable",
        ruleRevisionId: "comparison.daily_usage_above_baseline@1",
        reason: {
          code: "BUSINESS_CALENDAR_VERSION_NOT_FOUND",
          message: "Business Calendar sg-calendar-v1 is not published for this Project.",
        },
      });
      expect(analysis.provenance.queryIds).not.toContain("time_slot_anomaly_v1");
    } finally {
      metadata.close();
      removeTemporaryEnergyFixture(root);
    }
  }, 30_000);

  it("evaluates Ngee Ann daily usage anomalies from one frozen comparable-day baseline", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-analysis-anomaly-golden-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      await materializeNgeeAnnGoldenFixture(databasePath, metadata, {
        includeAnomalyHistory: true,
      });
      metadata.energyIq.operationalPolicy.publishOperatingCalendar({
        version_id: "sg-calendar-v1",
        project_id: NGEE_ANN_GOLDEN.projectId,
        published_by: "dev-user",
        entries: [{
          id: "ngee-ann-anomaly-calendar",
          owner: { kind: "project" },
          effective_from: "2026-04-01",
          weekly: allDays("00:00", "24:00"),
          exceptions: [
            {
              date: "2026-05-31",
              operating: [],
              label: "Do not parse this label",
              classification: "public_holiday",
            },
            {
              date: "2026-06-01",
              operating: [],
              label: "Still not a semantic input",
              classification: "public_holiday",
            },
          ],
        }],
      });
      const user = metadata.users.getById({ user_id: "dev-user" });
      const context = resolveEnergyQueryContext({
        metadataStore: metadata,
        user,
        workspaceId: "default",
        request: {
          projectId: NGEE_ANN_GOLDEN.projectId,
          scopeId: "project",
          resource: "electricity",
          period: "Custom",
          from: NGEE_ANN_GOLDEN.selection.period.localFrom,
          to: "2026-06-16",
        },
      });
      const anomalyRule = metadata.energyIq.rules.listRevisions().find(
        (rule) => rule.evaluation_key === "DAILY_USAGE_ABOVE_BASELINE",
      );
      if (!anomalyRule) throw new Error("DAILY_USAGE_ABOVE_BASELINE_RULE_MISSING");
      const analysis = await executeEnergyScopeAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        userId: "dev-user",
        context,
        databasePath,
        projectReleaseId: "ngee-ann-test-release@1",
        ruleRevisions: [anomalyRule],
        includeTimeBehaviour: false,
      });

      expect(analysis.summary.usageKwh).toBe(NGEE_ANN_GOLDEN.period.usageKwh);
      expect(analysis.provenance.queryIds).toContain("time_slot_anomaly_v1");
      expect(analysis.dailyUsageAnomalies).toMatchObject({
        status: "available",
        bundleId: expect.stringContaining("daily-usage-anomalies:"),
        metricId: "energy.total_usage_kwh@1",
        queryId: "time_slot_anomaly_v1",
        ruleRevisionId: "comparison.daily_usage_above_baseline@1",
        baselineCutoff: "2026-06-10",
        rule: {
          relativeThresholdPct: 20,
          absoluteImpactKwh: 20,
          minimumCoveragePct: 95,
          minimumSampleCount: 4,
          maximumQualityEventCount: 0,
          maximumLookbackDays: 60,
          direction: "above",
        },
        evidencePins: {
          projectReleaseId: "ngee-ann-test-release@1",
          dataSnapshotId: analysis.context.dataSnapshotId,
          hierarchyRevisionId: analysis.context.hierarchyRevisionId,
          meterMappingRevisionId: analysis.context.meterMappingRevisionId,
          meterFormulaRevisionId: analysis.context.meterFormulaRevisionId,
          metricVersion: analysis.context.metricVersion,
          businessCalendarVersion: "sg-calendar-v1",
          queryIds: ["time_slot_anomaly_v1"],
        },
      });
      if (analysis.dailyUsageAnomalies?.status !== "available") {
        throw new Error("Expected available daily usage anomalies");
      }
      expect(analysis.dailyUsageAnomalies.scopes.map((scope) => scope.scopeId))
        .toEqual(["project", "level-6", "level-7"]);
      const projectHorizonEvidence = analysis.dailyUsageAnomalies.scopes.find(
        (scope) => scope.scopeId === "project",
      )?.rollingComparisons;
      expect(projectHorizonEvidence).toEqual([
        {
          horizon: "rolling_7d",
          cutoffLocalDate: "2026-06-16",
          current: {
            fromLocalDate: "2026-06-10",
            toLocalDate: "2026-06-16",
            totalKwh: 1531.1683,
            completeDayCount: 7,
          },
          baseline: {
            fromLocalDate: "2026-06-03",
            toLocalDate: "2026-06-09",
            totalKwh: 1211.6773,
            completeDayCount: 7,
          },
          status: "available",
          deltaKwh: 319.491,
          relativePct: 26.3677,
        },
        {
          horizon: "rolling_28d",
          cutoffLocalDate: "2026-06-16",
          current: {
            fromLocalDate: "2026-05-20",
            toLocalDate: "2026-06-16",
            totalKwh: 4904.8659,
            completeDayCount: 28,
          },
          baseline: {
            fromLocalDate: "2026-04-22",
            toLocalDate: "2026-05-19",
            totalKwh: 4831.5555,
            completeDayCount: 28,
          },
          status: "available",
          deltaKwh: 73.3104,
          relativePct: 1.5173,
        },
      ]);
      const expectationByScope = {
        project: {
          weekdayBaseline: 218.885,
          weekendBaseline: 63.3385,
          triggered: ["2026-06-11", "2026-06-13", "2026-06-14"],
        },
        "level-7": {
          weekdayBaseline: 138.8777,
          weekendBaseline: 26.6704,
          triggered: ["2026-06-11", "2026-06-12", "2026-06-13", "2026-06-14"],
        },
        "level-6": {
          weekdayBaseline: 80.0073,
          weekendBaseline: 36.6681,
          triggered: [],
        },
      } as const;
      for (const scope of analysis.dailyUsageAnomalies.scopes) {
        const expected = expectationByScope[scope.scopeId as keyof typeof expectationByScope];
        expect(expected).toBeDefined();
        expect(scope.rows.filter((row) => row.outcome === "triggered").map((row) => row.localDate))
          .toEqual(expected.triggered);
        for (const row of scope.rows) {
          expect(row.hourlyComparison).toHaveLength(24);
          expect(row.baselineDates).not.toContain("2026-05-31");
          expect(row.baselineDates).not.toContain("2026-06-01");
          if (row.dayType === "weekday") {
            expect(row.baselineDates).toEqual([
              "2026-06-04",
              "2026-06-05",
              "2026-06-08",
              "2026-06-09",
            ]);
            expect(row.baselineKwh).toBe(expected.weekdayBaseline);
          } else if (row.dayType === "weekend") {
            expect(row.baselineDates).toEqual([
              "2026-05-24",
              "2026-05-30",
              "2026-06-06",
              "2026-06-07",
            ]);
            expect(row.baselineKwh).toBe(expected.weekendBaseline);
          }
        }
      }
      const level7 = analysis.dailyUsageAnomalies.scopes.find(
        (scope) => scope.scopeId === "level-7",
      );
      const level7Selected = level7?.rows.find((row) => row.localDate === "2026-06-11");
      expect(level7Selected).toMatchObject({
        anomalyId: "daily-usage-above-baseline:level-7:2026-06-11",
        incidentId: expect.stringContaining(
          ":ngee-ann-test-release@1:sg-calendar-v1:comparison.daily_usage_above_baseline@1:level-7:2026-06-10:2026-06-11",
        ),
        ruleRevisionId: "comparison.daily_usage_above_baseline@1",
        metricId: "energy.total_usage_kwh@1",
        queryId: "time_slot_anomaly_v1",
        from: "2026-06-10T16:00:00.000Z",
        to: "2026-06-11T16:00:00.000Z",
        baselineSampleCount: 4,
        expectedMeterIntervalCount: 192,
        validIntervalCount: 192,
        qualityEventCount: 0,
        thresholds: {
          relativeThresholdPct: 20,
          absoluteImpactKwh: 20,
          minimumCoveragePct: 95,
          maximumQualityEventCount: 0,
        },
      });
      expect(level7Selected?.baselineSamples).toHaveLength(4);
      expect(level7Selected?.baselineSamples.every((sample) => (
        sample.eligible
        && sample.coveragePct === 100
        && sample.expectedMeterIntervalCount === 192
        && sample.validIntervalCount === 192
        && sample.qualityEventCount === 0
      ))).toBe(true);
      expect(level7Selected?.detailSeries[0]).toMatchObject({
        seriesId: "scope:level-7",
        relationship: "selected_scope",
        kind: "official_scope",
        includedInOfficialTotal: true,
        status: "available",
      });
      expect(level7Selected?.detailSeries.slice(1)).toHaveLength(7);
      expect(level7Selected?.detailSeries.slice(1).every((series) => (
        series.kind === "component_circuit"
        && series.includedInOfficialTotal === false
        && series.points.length === 24
      ))).toBe(true);
      expect(level7Selected?.detailSeries.every((series) => (
        series.points.every((point) => Object.hasOwn(point, "impactKwh"))
      ))).toBe(true);
      const projectSelected = analysis.dailyUsageAnomalies.scopes
        .find((scope) => scope.scopeId === "project")
        ?.rows.find((row) => row.localDate === "2026-06-11");
      expect(projectSelected?.detailSeries).toHaveLength(17);
      expect(projectSelected?.detailSeries.filter(
        (series) => series.relationship === "selected_scope",
      )).toHaveLength(1);
      expect(projectSelected?.detailSeries.filter(
        (series) => series.relationship === "immediate_level",
      )).toHaveLength(2);
      expect(projectSelected?.detailSeries.filter(
        (series) => series.relationship === "component_circuit",
      )).toHaveLength(14);

      const holidayContext = resolveEnergyQueryContext({
        metadataStore: metadata,
        user,
        workspaceId: "default",
        request: {
          projectId: NGEE_ANN_GOLDEN.projectId,
          scopeId: "project",
          resource: "electricity",
          period: "Custom",
          from: "2026-05-20",
          to: "2026-06-16",
        },
      });
      expect(metadata.energyIq.operationalPolicy.resolveOperatingCalendarExceptionDates({
        project_id: NGEE_ANN_GOLDEN.projectId,
        scope_id: "project",
        version_id: "sg-calendar-v1",
        period: { from: holidayContext.from, to: holidayContext.to },
      })?.exceptions).toEqual([
        { date: "2026-05-31", classification: "public_holiday" },
        { date: "2026-06-01", classification: "public_holiday" },
      ]);
      const holidayAnalysis = await executeEnergyScopeAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        userId: "dev-user",
        context: holidayContext,
        databasePath,
        includeTimeBehaviour: true,
      });
      expect(holidayAnalysis.timeBehaviour?.dayProfiles.find((profile) => (
        profile.scopeId === "project" && profile.dayType === "public_holiday"
      ))).toMatchObject({
        status: "available",
        sampleDayCount: 2,
        values: expect.any(Array),
      });
      expect(holidayAnalysis.componentHourlyProfiles?.scopes
        .find((scope) => scope.scopeId === "project")
        ?.profiles.find((profile) => profile.dayType === "public_holiday"))
        .toMatchObject({
          status: "available",
          sampleDayCount: 2,
          categories: expect.any(Array),
          circuits: expect.any(Array),
        });
      expect(holidayAnalysis.componentCategoryBreakdown?.scopes
        .find((scope) => scope.scopeId === "project")
        ?.rows.filter((row) => row.dayType === "public_holiday")
        .map((row) => row.localDate)).toEqual(["2026-05-31", "2026-06-01"]);
    } finally {
      metadata.close();
      removeTemporaryEnergyFixture(root);
    }
  }, 60_000);

  it("requires complete baseline days and rejects a partial-null official Day Type", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-analysis-anomaly-complete-baseline-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    const runSqlReadonly = gateway.runSqlReadonly.bind(gateway);
    let projectPartialBaselineValidIntervalCount: number | null = null;
    gateway.runSqlReadonly = async (request) => {
      const result = await runSqlReadonly(request);
      if (!request.sql.includes("series_definitions.series_id")) return result;
      const projectRow = result.rows.find((row) => row[0] === "scope:project");
      if (projectRow) {
        const cells = JSON.parse(String(projectRow[1])) as Array<Record<string, unknown>>;
        projectPartialBaselineValidIntervalCount = cells
          .filter((cell) => cell.local_date === "2026-06-04")
          .reduce((sum, cell) => sum + Number(cell.valid_interval_count), 0);
      }
      return result;
    };
    let removedBaselineInterval = false;
    try {
      ensureEnergyIqBootstrap(metadata);
      await materializeNgeeAnnGoldenFixture(databasePath, metadata, {
        includeAnomalyHistory: true,
        transformIntervalFacts: (facts) => facts.flatMap((fact) => {
          if (fact.localDate < "2026-06-10"
            && fact.dayType === "weekday"
            && !["2026-06-04", "2026-06-05", "2026-06-08", "2026-06-09"].includes(fact.localDate)) {
            return [];
          }
          if (!removedBaselineInterval
            && fact.meterPointId === "mapping-lvl-7-total-office-load-18"
            && fact.localDate === "2026-06-04"
            && fact.localHour === 0) {
            removedBaselineInterval = true;
            return [];
          }
          if (fact.meterPointId === "mapping-lvl-7-total-office-load-18"
            && fact.localDate === "2026-06-11"
            && fact.localHour === 0) {
            return [{ ...fact, dayType: null as unknown as string }];
          }
          return [fact];
        }),
      });
      metadata.energyIq.operationalPolicy.publishOperatingCalendar({
        version_id: "sg-calendar-v1",
        project_id: NGEE_ANN_GOLDEN.projectId,
        published_by: "dev-user",
        entries: [{
          id: "ngee-ann-anomaly-complete-baseline-calendar",
          owner: { kind: "project" },
          effective_from: "2026-04-01",
          weekly: allDays("00:00", "24:00"),
          exceptions: ["2026-05-31", "2026-06-01"]
            .map((date) => ({ date, operating: [], label: "Ignored" })),
        }],
      });
      const user = metadata.users.getById({ user_id: "dev-user" });
      const context = resolveEnergyQueryContext({
        metadataStore: metadata,
        user,
        workspaceId: "default",
        request: {
          projectId: NGEE_ANN_GOLDEN.projectId,
          scopeId: "project",
          resource: "electricity",
          period: "Custom",
          from: NGEE_ANN_GOLDEN.selection.period.localFrom,
          to: "2026-06-11",
        },
      });
      const anomalyRule = metadata.energyIq.rules.listRevisions().find(
        (rule) => rule.revision_id === "comparison.daily_usage_above_baseline@1",
      );
      if (!anomalyRule) throw new Error("DAILY_USAGE_ABOVE_BASELINE_RULE_MISSING");
      const analysis = await executeEnergyScopeAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        userId: "dev-user",
        context,
        databasePath,
        projectReleaseId: "ngee-ann-test-release@1",
        ruleRevisions: [anomalyRule],
        includeTimeBehaviour: false,
      });
      if (analysis.dailyUsageAnomalies?.status !== "available") {
        throw new Error("Expected available daily usage anomaly completeness checks");
      }
      const rows = (scopeId: string) => new Map(
        analysis.dailyUsageAnomalies?.status === "available"
          ? analysis.dailyUsageAnomalies.scopes.find((scope) => scope.scopeId === scopeId)
            ?.rows.map((row) => [row.localDate, row])
          : [],
      );
      expect(removedBaselineInterval).toBe(true);
      expect(projectPartialBaselineValidIntervalCount).toBe(383);
      expect(rows("project").get("2026-06-10")).toMatchObject({
        expectedMeterIntervalCount: 384,
        baselineDates: ["2026-06-05", "2026-06-08", "2026-06-09"],
        baselineSampleCount: 3,
        outcome: "suppressed",
        suppressionReason: { code: "BASELINE_SAMPLE_COUNT_INSUFFICIENT" },
      });
      for (const scopeId of ["project", "level-7"]) {
        expect(rows(scopeId).get("2026-06-11")).toMatchObject({
          dayType: null,
          outcome: "suppressed",
          suppressionReason: { code: "DAY_TYPE_CLASSIFICATION_UNAVAILABLE" },
        });
      }
    } finally {
      metadata.close();
      removeTemporaryEnergyFixture(root);
    }
  }, 30_000);

  it("applies Calendar exceptions only to the authoritative entry for each official Scope", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-analysis-anomaly-scope-calendar-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      await materializeNgeeAnnGoldenFixture(databasePath, metadata, {
        includeAnomalyHistory: true,
      });
      metadata.energyIq.operationalPolicy.publishOperatingCalendar({
        version_id: "sg-calendar-v1",
        project_id: NGEE_ANN_GOLDEN.projectId,
        published_by: "dev-user",
        entries: [
          {
            id: "ngee-ann-anomaly-project-calendar",
            owner: { kind: "project" },
            effective_from: "2026-04-01",
            weekly: allDays("00:00", "24:00"),
            exceptions: ["2026-05-31", "2026-06-01"]
              .map((date) => ({ date, operating: [], label: "Project only" })),
          },
          {
            id: "ngee-ann-anomaly-level-7-calendar",
            owner: { kind: "scope", scope_id: "level-7" },
            effective_from: "2026-04-01",
            weekly: allDays("00:00", "24:00"),
            exceptions: ["2026-05-31", "2026-06-01", "2026-06-12"]
              .map((date) => ({ date, operating: [], label: "Level 7 only" })),
          },
        ],
      });
      const user = metadata.users.getById({ user_id: "dev-user" });
      const context = resolveEnergyQueryContext({
        metadataStore: metadata,
        user,
        workspaceId: "default",
        request: {
          projectId: NGEE_ANN_GOLDEN.projectId,
          scopeId: "project",
          resource: "electricity",
          period: "Custom",
          from: NGEE_ANN_GOLDEN.selection.period.localFrom,
          to: "2026-06-12",
        },
      });
      const anomalyRule = metadata.energyIq.rules.listRevisions().find(
        (rule) => rule.revision_id === "comparison.daily_usage_above_baseline@1",
      );
      if (!anomalyRule) throw new Error("DAILY_USAGE_ABOVE_BASELINE_RULE_MISSING");
      const analysis = await executeEnergyScopeAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        userId: "dev-user",
        context,
        databasePath,
        projectReleaseId: "ngee-ann-test-release@1",
        ruleRevisions: [anomalyRule],
        includeTimeBehaviour: false,
      });
      if (analysis.dailyUsageAnomalies?.status !== "available") {
        throw new Error("Expected available Scope-specific Calendar anomalies");
      }
      const row = (scopeId: string) => analysis.dailyUsageAnomalies?.status === "available"
        ? analysis.dailyUsageAnomalies.scopes.find((scope) => scope.scopeId === scopeId)
          ?.rows.find((candidate) => candidate.localDate === "2026-06-12")
        : undefined;
      expect(row("level-7")).toMatchObject({
        outcome: "suppressed",
        suppressionReason: { code: "CALENDAR_EXCEPTION_DATE" },
      });
      for (const scopeId of ["project", "level-6"]) {
        expect(row(scopeId)?.suppressionReason?.code).not.toBe("CALENDAR_EXCEPTION_DATE");
      }
    } finally {
      metadata.close();
      removeTemporaryEnergyFixture(root);
    }
  }, 60_000);

  it("keeps the Overview analysis available when the optional anomaly fact query fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-analysis-anomaly-query-failure-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    const runSqlReadonly = gateway.runSqlReadonly.bind(gateway);
    gateway.runSqlReadonly = async (request) => {
      if (request.sql.includes("series_definitions.series_id")) {
        throw new Error("SQL_TIMEOUT");
      }
      return runSqlReadonly(request);
    };
    try {
      ensureEnergyIqBootstrap(metadata);
      await materializeNgeeAnnGoldenFixture(databasePath, metadata);
      metadata.energyIq.operationalPolicy.publishOperatingCalendar({
        version_id: "sg-calendar-v1",
        project_id: NGEE_ANN_GOLDEN.projectId,
        published_by: "dev-user",
        entries: [{
          id: "ngee-ann-anomaly-query-failure-calendar",
          owner: { kind: "project" },
          effective_from: "2026-04-01",
          weekly: allDays("00:00", "24:00"),
        }],
      });
      const user = metadata.users.getById({ user_id: "dev-user" });
      const context = resolveEnergyQueryContext({
        metadataStore: metadata,
        user,
        workspaceId: "default",
        request: {
          projectId: NGEE_ANN_GOLDEN.projectId,
          scopeId: "project",
          resource: "electricity",
          period: "Custom",
          from: NGEE_ANN_GOLDEN.selection.period.localFrom,
          to: "2026-06-16",
        },
      });
      const anomalyRule = metadata.energyIq.rules.listRevisions().find(
        (rule) => rule.revision_id === "comparison.daily_usage_above_baseline@1",
      );
      if (!anomalyRule) throw new Error("DAILY_USAGE_ABOVE_BASELINE_RULE_MISSING");
      const analysis = await executeEnergyScopeAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        userId: "dev-user",
        context,
        databasePath,
        projectReleaseId: "ngee-ann-test-release@1",
        ruleRevisions: [anomalyRule],
        includeTimeBehaviour: true,
      });
      expect(analysis.summary.usageKwh).toBe(NGEE_ANN_GOLDEN.period.usageKwh);
      expect(analysis.dailyTotals?.scopes).toHaveLength(3);
      expect(analysis.timeBehaviour?.scopes).toHaveLength(3);
      expect(analysis.dailyUsageAnomalies).toMatchObject({
        status: "unavailable",
        reason: { code: "DAILY_USAGE_ANOMALY_FACTS_UNAVAILABLE" },
      });
      expect(analysis.provenance.queryIds).not.toContain("time_slot_anomaly_v1");
    } finally {
      metadata.close();
      removeTemporaryEnergyFixture(root);
    }
  }, 30_000);

  it("suppresses daily anomaly claims when coverage, quality, baseline, Calendar, or Day Type gates fail", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-analysis-anomaly-gates-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    const runSqlReadonly = gateway.runSqlReadonly.bind(gateway);
    gateway.runSqlReadonly = async (request) => {
      const result = await runSqlReadonly(request);
      if (!request.sql.includes("series_definitions.series_id")) return result;
      return {
        ...result,
        rows: result.rows.map((row) => {
          if (row[0] !== "scope:project") return row;
          const cells = JSON.parse(String(row[1])) as Array<Record<string, unknown>>;
          const targetValidCountPerHour = 4 * 24 * 4 * 0.949999 / 24;
          for (const cell of cells) {
            if (cell.local_date === "2026-06-10") {
              cell.valid_interval_count = targetValidCountPerHour;
            }
          }
          return [row[0], JSON.stringify(cells), ...row.slice(2)];
        }),
      };
    };
    try {
      ensureEnergyIqBootstrap(metadata);
      await materializeNgeeAnnGoldenFixture(databasePath, metadata, {
        includeAnomalyHistory: true,
        transformIntervalFacts: (facts) => {
          return facts.flatMap((fact) => {
            if (fact.meterRole !== "total") return [fact];
            if (fact.localDate < "2026-06-10"
              && fact.dayType === "weekend"
              && !["2026-05-24", "2026-06-06", "2026-06-07"].includes(fact.localDate)) {
              return [];
            }
            if (fact.localDate === "2026-06-11" && fact.localHour === 0) {
              return [{ ...fact, qualityStatus: "rejected" }];
            }
            if (fact.localDate === "2026-06-15" && fact.localHour === 0) {
              return [{ ...fact, dayType: "weekend" }];
            }
            if (fact.localDate === "2026-06-16") {
              return [{ ...fact, dayType: "" }];
            }
            return [fact];
          });
        },
      });
      metadata.energyIq.operationalPolicy.publishOperatingCalendar({
        version_id: "sg-calendar-v1",
        project_id: NGEE_ANN_GOLDEN.projectId,
        published_by: "dev-user",
        entries: [{
          id: "ngee-ann-anomaly-calendar-gates",
          owner: { kind: "project" },
          effective_from: "2026-04-01",
          weekly: allDays("00:00", "24:00"),
          exceptions: ["2026-05-30", "2026-05-31", "2026-06-01", "2026-06-12"]
            .map((date) => ({ date, operating: [], label: "Ignored" })),
        }],
      });
      const user = metadata.users.getById({ user_id: "dev-user" });
      const context = resolveEnergyQueryContext({
        metadataStore: metadata,
        user,
        workspaceId: "default",
        request: {
          projectId: NGEE_ANN_GOLDEN.projectId,
          scopeId: "project",
          resource: "electricity",
          period: "Custom",
          from: NGEE_ANN_GOLDEN.selection.period.localFrom,
          to: "2026-06-16",
        },
      });
      const anomalyRule = metadata.energyIq.rules.listRevisions().find(
        (rule) => rule.evaluation_key === "DAILY_USAGE_ABOVE_BASELINE",
      );
      if (!anomalyRule) throw new Error("DAILY_USAGE_ABOVE_BASELINE_RULE_MISSING");
      const analysis = await executeEnergyScopeAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        userId: "dev-user",
        context,
        databasePath,
        projectReleaseId: "ngee-ann-test-release@1",
        ruleRevisions: [anomalyRule],
        includeTimeBehaviour: false,
      });
      if (analysis.dailyUsageAnomalies?.status !== "available") {
        throw new Error("Expected available daily usage anomaly gates");
      }
      const projectRows = new Map(
        analysis.dailyUsageAnomalies.scopes.find((scope) => scope.scopeId === "project")
          ?.rows.map((row) => [row.localDate, row]),
      );
      expect(projectRows.get("2026-06-10")).toMatchObject({
        outcome: "suppressed",
        coveragePct: 94.9999,
        suppressionReason: { code: "COVERAGE_BELOW_THRESHOLD" },
      });
      expect(projectRows.get("2026-06-11")).toMatchObject({
        outcome: "suppressed",
        suppressionReason: { code: "QUALITY_EVENT_PRESENT" },
      });
      expect(projectRows.get("2026-06-12")).toMatchObject({
        outcome: "suppressed",
        suppressionReason: { code: "CALENDAR_EXCEPTION_DATE" },
      });
      expect(projectRows.get("2026-06-13")).toMatchObject({
        outcome: "suppressed",
        baselineDates: ["2026-05-24", "2026-06-06", "2026-06-07"],
        suppressionReason: { code: "BASELINE_SAMPLE_COUNT_INSUFFICIENT" },
      });
      expect(projectRows.get("2026-06-15")).toMatchObject({
        outcome: "suppressed",
        suppressionReason: { code: "DAY_TYPE_CLASSIFICATION_UNAVAILABLE" },
      });
      expect(projectRows.get("2026-06-16")).toMatchObject({
        outcome: "suppressed",
        suppressionReason: { code: "DAY_TYPE_CLASSIFICATION_UNAVAILABLE" },
      });
      expect([...projectRows.values()].filter((row) => row.outcome === "triggered")).toEqual([]);
    } finally {
      metadata.close();
      removeTemporaryEnergyFixture(root);
    }
  }, 60_000);

  it("repeats the selected Ngee Ann golden period without contending with the live API DuckDB", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-analysis-ngee-ann-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    const runSqlReadonly = gateway.runSqlReadonly.bind(gateway);
    let activeReadonlyQueries = 0;
    let maximumReadonlyQueryConcurrency = 0;
    let readonlyQueryCount = 0;
    let snapshotReadSessionCount = 0;
    gateway.runSqlReadonly = async (request) => {
      readonlyQueryCount += 1;
      activeReadonlyQueries += 1;
      maximumReadonlyQueryConcurrency = Math.max(
        maximumReadonlyQueryConcurrency,
        activeReadonlyQueries,
      );
      try {
        return await runSqlReadonly(request);
      } finally {
        activeReadonlyQueries -= 1;
      }
    };
    const withEnergySnapshotReadSession = gateway.withEnergySnapshotReadSession.bind(gateway);
    gateway.withEnergySnapshotReadSession = async (request, execute) => {
      snapshotReadSessionCount += 1;
      return await withEnergySnapshotReadSession(request, execute);
    };
    try {
      ensureEnergyIqBootstrap(metadata);
      const ngeeAnnSnapshot = await materializeNgeeAnnGoldenFixture(databasePath, metadata);
      const authoritativeSourceSha256 = [
        "e4d788af0135281c8ba519f04fa3c44751206ce0812e15e434da6cb8fda44f70",
        "64502f6369dad96f3dc6cbc650b28b3f108bb655e7a95ca078b9aa616966413f",
        "0b1fb9613c596d3569f6be93046a43737366649b5f8a4d45fc8cdef073c30e5d",
        "3f41f94e229933a97ce8d02a0382d3a8192e3c26065bf0f48a04168ec90dd674",
      ].sort((left, right) => left.localeCompare(right));
      expect(resolveEnergyIqSnapshotFactScope(ngeeAnnSnapshot).sourceSha256)
        .toEqual(authoritativeSourceSha256);
      await expect(readEnergyFactProjectState({ databasePath, projectId: NGEE_ANN_GOLDEN.projectId }))
        .resolves.toMatchObject({
          dataSnapshotId: ngeeAnnSnapshot.id,
          sourceSha256: authoritativeSourceSha256,
        });
      const user = metadata.users.getById({ user_id: "dev-user" });
      const context = resolveEnergyQueryContext({
        metadataStore: metadata,
        user,
        workspaceId: "default",
        request: {
          projectId: "ngee-ann-polytechnic",
          scopeId: "project",
          resource: "electricity",
          period: "Custom",
          from: NGEE_ANN_GOLDEN.selection.period.localFrom,
          to: "2026-06-16"
        }
      });
      const selected = await selectEnergyGoldenPeriod({
        metadataStore: metadata,
        dataGateway: gateway,
        userId: "dev-user",
        context,
        databasePath,
        periodDays: NGEE_ANN_GOLDEN.selection.periodDays
      });
      expect(selected).toEqual(NGEE_ANN_GOLDEN.selection);
      const latestComplete = await selectEnergyLatestCompletePeriod({
        metadataStore: metadata,
        dataGateway: gateway,
        userId: "dev-user",
        context,
        databasePath,
      });
      expect(latestComplete).toMatchObject({
        periodDays: 7,
        intervalMinutes: NGEE_ANN_GOLDEN.selection.intervalMinutes,
        period: NGEE_ANN_GOLDEN.selection.period,
      });
      const latestCompleteDay = await selectEnergyLatestCompleteDay({
        metadataStore: metadata,
        dataGateway: gateway,
        userId: "dev-user",
        context,
        databasePath,
      });
      expect(latestCompleteDay).toMatchObject({
        periodDays: 1,
        intervalMinutes: NGEE_ANN_GOLDEN.selection.intervalMinutes,
        period: {
          localFrom: "2026-06-16",
          localToExclusive: "2026-06-17",
        },
      });
      const currentOverview = await selectEnergyCurrentOverviewPeriod({
        metadataStore: metadata,
        dataGateway: gateway,
        userId: "dev-user",
        context,
        databasePath,
        periodBasis: "calendar_month_to_date",
      });
      expect(currentOverview).toEqual({
        periodBasis: "calendar_month_to_date",
        periodDays: 16,
        cutoffLocalDate: "2026-06-16",
        intervalMinutes: NGEE_ANN_GOLDEN.selection.intervalMinutes,
        period: {
          localFrom: "2026-06-01",
          localToExclusive: "2026-06-17",
          from: "2026-05-31T16:00:00.000Z",
          to: "2026-06-16T16:00:00.000Z",
        },
      });

      const run = () => executeEnergyScopeAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        userId: "dev-user",
        context,
        databasePath
      });
      const queryCountBeforeMeasuredRun = readonlyQueryCount;
      const sessionCountBeforeMeasuredRun = snapshotReadSessionCount;
      const measuredRunStartedAt = performance.now();
      const analysis = await run();
      const measuredRunElapsedMs = performance.now() - measuredRunStartedAt;
      const measuredRunQueryCount = readonlyQueryCount - queryCountBeforeMeasuredRun;
      const measuredRunSessionCount = snapshotReadSessionCount - sessionCountBeforeMeasuredRun;
      const measuredPayloadBytes = Buffer.byteLength(JSON.stringify(analysis));
      const explorerQueryCountBefore = readonlyQueryCount;
      const explorerAnalysis = await executeEnergyScopeAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        userId: "dev-user",
        context,
        databasePath,
        profile: "explorer",
      });
      const explorerQueryCount = readonlyQueryCount - explorerQueryCountBefore;
      expect(explorerQueryCount).toBeLessThan(measuredRunQueryCount);
      expect(explorerAnalysis.dailyTotals?.scopes).toHaveLength(1);
      expect(explorerAnalysis.timeBehaviour).toBeUndefined();
      const trend = explorerAnalysis.explorerTrends?.find(series => series.id === "__scope__");
      expect(trend?.cells.length).toBeGreaterThan(0);
      expect(trend?.cells.reduce((sum, cell) => sum + (cell[2] ?? 0), 0)).toBeCloseTo(explorerAnalysis.summary.usageKwh, 4);
      // Per-type series cover exactly the official meters, so they add up to the scope total and match categories[].
      const typeSeries = explorerAnalysis.explorerTrends?.filter(series => series.id.startsWith("__category__:")) ?? [];
      expect(typeSeries.map(series => series.id.slice("__category__:".length)).sort()).toEqual(explorerAnalysis.categories.map(category => category.category).sort());
      const typeKwh = (series: (typeof typeSeries)[number]) => series.cells.reduce((sum, cell) => sum + (cell[2] ?? 0), 0);
      expect(typeSeries.reduce((sum, series) => sum + typeKwh(series), 0)).toBeCloseTo(explorerAnalysis.summary.usageKwh, 4);
      for (const category of explorerAnalysis.categories) expect(typeKwh(typeSeries.find(series => series.id === `__category__:${category.category}`)!)).toBeCloseTo(category.usageKwh, 3);

      expect(explorerAnalysis.dailyUsageAnomalies).toBeUndefined();
      expect(explorerAnalysis.peakBreakdown).toBeUndefined();
      const childDailyExplorerQueryCountBefore = readonlyQueryCount;
      const childDailyExplorer = await executeEnergyScopeAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        userId: "dev-user",
        context,
        databasePath,
        profile: "explorer",
        includeImmediateChildDailyTotals: true,
      });
      const childDailyExplorerQueryCount = readonlyQueryCount - childDailyExplorerQueryCountBefore;
      expect(childDailyExplorer.dailyTotals?.scopes).toHaveLength(3);
      expect(childDailyExplorerQueryCount).toBe(explorerQueryCount);
      expect(childDailyExplorer.timeBehaviour).toBeUndefined();
      if (process.env.ENERGYIQ_OVERVIEW_PERFORMANCE === "1") {
        console.info("ENERGYIQ_EXPLORER_PERFORMANCE", JSON.stringify({
          readonlyQueryCount: explorerQueryCount,
          payloadBytes: Buffer.byteLength(JSON.stringify(explorerAnalysis)),
        }));
      }
      const repeatedRunStartedAt = performance.now();
      const repeated = await run();
      const repeatedRunElapsedMs = performance.now() - repeatedRunStartedAt;
      if (process.env.ENERGYIQ_OVERVIEW_PERFORMANCE === "1") {
        console.info("ENERGYIQ_OVERVIEW_PERFORMANCE", JSON.stringify({
          analysisElapsedMs: Math.round(measuredRunElapsedMs),
          repeatedElapsedMs: Math.round(repeatedRunElapsedMs),
          readonlyQueryCount: measuredRunQueryCount,
          snapshotReadSessionCount: measuredRunSessionCount,
          payloadBytes: measuredPayloadBytes,
        }));
        expect(measuredRunElapsedMs).toBeLessThan(3_000);
        expect(repeatedRunElapsedMs).toBeLessThan(3_000);
      }

      const overlap = await executeEnergyScopeAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        userId: "dev-user",
        context: resolveEnergyQueryContext({
          metadataStore: metadata,
          user,
          workspaceId: "default",
          request: {
            projectId: "ngee-ann-polytechnic",
            scopeId: "project",
            resource: "electricity",
            period: "Custom",
            from: "2026-05-19",
            to: "2026-05-19",
          },
        }),
        databasePath,
      });
      expect(overlap.summary.usageKwh).toBe(2.468);

      const emptyWindow = await executeEnergyScopeAnalysisWithLatestAvailable({
        metadataStore: metadata,
        dataGateway: gateway,
        userId: "dev-user",
        context: resolveEnergyQueryContext({
          metadataStore: metadata,
          user,
          workspaceId: "default",
          request: {
            projectId: "ngee-ann-polytechnic",
            scopeId: "project",
            resource: "electricity",
            period: "Custom",
            from: "2026-07-01",
            to: "2026-07-07",
          },
        }),
        databasePath,
      });
      expect(emptyWindow.summary.validIntervalCount).toBe(0);
      expect(emptyWindow.summary.usageKwh).toBe(0);
      expect(emptyWindow.latestAvailablePeriod).toEqual({
        period: "Custom",
        from: NGEE_ANN_GOLDEN.selection.period.localFrom,
        to: "2026-06-16",
      });

      expect(repeated).toEqual(analysis);
      expect(maximumReadonlyQueryConcurrency).toBeLessThanOrEqual(3);
      expect(measuredRunQueryCount).toBe(10);
      expect(measuredRunSessionCount).toBe(1);
      expect(analysis.summary.usageKwh).toBe(NGEE_ANN_GOLDEN.period.usageKwh);
      expect(analysis.summary.peakKw).toBe(NGEE_ANN_GOLDEN.period.peakKw);
      expect(analysis.summary.peakAt).toBe(NGEE_ANN_GOLDEN.period.peakAt);
      expect(analysis.comparison).toMatchObject({
        usageKwh: NGEE_ANN_GOLDEN.period.previousUsageKwh,
        changeKwh: NGEE_ANN_GOLDEN.period.changeKwh,
        changePct: NGEE_ANN_GOLDEN.period.changePct
      });
      expect(analysis.childScopes).toMatchObject([
        {
          nodeId: "level-7",
          usageKwh: NGEE_ANN_GOLDEN.period.levelUsageKwh["level-7"],
          sharePct: NGEE_ANN_GOLDEN.period.levels["level-7"].sharePct,
          comparison: {
            usageKwh: NGEE_ANN_GOLDEN.period.levels["level-7"].previousUsageKwh,
            changeKwh: NGEE_ANN_GOLDEN.period.levels["level-7"].changeKwh,
            changePct: NGEE_ANN_GOLDEN.period.levels["level-7"].changePct,
          },
          dataHealth: NGEE_ANN_GOLDEN.period.levels["level-7"].dataHealth,
        },
        {
          nodeId: "level-6",
          usageKwh: NGEE_ANN_GOLDEN.period.levelUsageKwh["level-6"],
          sharePct: NGEE_ANN_GOLDEN.period.levels["level-6"].sharePct,
          comparison: {
            usageKwh: NGEE_ANN_GOLDEN.period.levels["level-6"].previousUsageKwh,
            changeKwh: NGEE_ANN_GOLDEN.period.levels["level-6"].changeKwh,
            changePct: NGEE_ANN_GOLDEN.period.levels["level-6"].changePct,
          },
          dataHealth: NGEE_ANN_GOLDEN.period.levels["level-6"].dataHealth,
        }
      ]);
      expect(analysis.circuits).toHaveLength(18);
      expect(analysis.categories).toMatchObject([
        {
          category: "load",
          usageKwh: NGEE_ANN_GOLDEN.period.categories.load.usageKwh,
          comparison: {
            usageKwh: NGEE_ANN_GOLDEN.period.categories.load.previousUsageKwh,
            changeKwh: NGEE_ANN_GOLDEN.period.categories.load.changeKwh,
            changePct: NGEE_ANN_GOLDEN.period.categories.load.changePct,
          },
          dataHealth: NGEE_ANN_GOLDEN.period.categories.load.dataHealth,
        },
        {
          category: "light",
          usageKwh: NGEE_ANN_GOLDEN.period.categories.light.usageKwh,
          comparison: {
            usageKwh: NGEE_ANN_GOLDEN.period.categories.light.previousUsageKwh,
            changeKwh: NGEE_ANN_GOLDEN.period.categories.light.changeKwh,
            changePct: NGEE_ANN_GOLDEN.period.categories.light.changePct,
          },
          dataHealth: NGEE_ANN_GOLDEN.period.categories.light.dataHealth,
        }
      ]);
      expect(roundForGolden(analysis.childScopes.reduce((sum, scope) => sum + scope.usageKwh, 0)))
        .toBe(NGEE_ANN_GOLDEN.period.usageKwh);
      expect(roundForGolden(analysis.categories.reduce((sum, category) => sum + category.usageKwh, 0)))
        .toBe(NGEE_ANN_GOLDEN.period.usageKwh);
      expect(analysis.topCircuits[0]).toMatchObject({
        meterNodeId: NGEE_ANN_GOLDEN.period.topCircuit.meterNodeId,
        scopeId: NGEE_ANN_GOLDEN.period.topCircuit.scopeId,
        parentScopeId: NGEE_ANN_GOLDEN.period.topCircuit.parentScopeId,
        includedInOfficialTotal: false,
        usageKwh: NGEE_ANN_GOLDEN.period.topCircuit.usageKwh,
        sharePct: NGEE_ANN_GOLDEN.period.topCircuit.sharePct,
        peakKw: NGEE_ANN_GOLDEN.period.topCircuit.peakKw,
        comparison: {
          usageKwh: NGEE_ANN_GOLDEN.period.topCircuit.previousUsageKwh,
          changeKwh: NGEE_ANN_GOLDEN.period.topCircuit.changeKwh,
          changePct: NGEE_ANN_GOLDEN.period.topCircuit.changePct,
        },
        dataHealth: NGEE_ANN_GOLDEN.period.topCircuit.dataHealth,
      });
      expect(analysis.topCircuits.slice(0, 5).map((meter) => ({
        meterNodeId: meter.meterNodeId,
        scopeId: meter.scopeId,
        parentScopeId: meter.parentScopeId,
        usageKwh: meter.usageKwh,
        sharePct: meter.sharePct,
        previousUsageKwh: meter.comparison.usageKwh,
        changeKwh: meter.comparison.changeKwh,
        changePct: meter.comparison.changePct,
        dataHealth: meter.dataHealth,
      }))).toEqual(NGEE_ANN_GOLDEN.period.topCircuits);
      expect(analysis.circuits.every(
        (meter) => meter.parentScopeId?.startsWith("level-") === true,
      )).toBe(true);
      expect(analysis.designatedTotals).toHaveLength(NGEE_ANN_GOLDEN.officialMeterNodeIds.length);
      expect(analysis.designatedTotals.every((meter) => meter.includedInOfficialTotal)).toBe(true);
      expect(analysis.topCircuits.every((meter) => !meter.includedInOfficialTotal)).toBe(true);
      const designatedMeterNodeIds = analysis.designatedTotals
        .map((meter) => meter.meterNodeId)
        .sort();
      const componentMeterNodeIds = analysis.topCircuits.map((meter) => meter.meterNodeId).sort();
      expect(designatedMeterNodeIds).toEqual([...NGEE_ANN_GOLDEN.officialMeterNodeIds].sort());
      expect(componentMeterNodeIds).toHaveLength(14);
      expect(componentMeterNodeIds.filter((meterNodeId) =>
        designatedMeterNodeIds.includes(meterNodeId)
      )).toEqual([]);
      expect(roundForGolden(
        analysis.designatedTotals.reduce((sum, meter) => sum + meter.usageKwh, 0),
      )).toBeCloseTo(NGEE_ANN_GOLDEN.period.usageKwh, 3);
      expect(analysis.componentReconciliation).toEqual({
        ...NGEE_ANN_GOLDEN.period.componentReconciliation,
        officialMeterNodeIds: designatedMeterNodeIds,
        componentMeterNodeIds,
      });
      expect(analysis.hourlyProfile).toEqual(
        expectedHourlyProfile(NGEE_ANN_GOLDEN.period.hourlyProfile, 28)
      );
      expect(analysis.dailyTotals).toEqual(expectedNgeeAnnDailyTotals());
      expect(analysis.componentCategoryBreakdown).toMatchObject({
        metricId: "energy.total_usage_kwh@1",
        queryId: "daily_component_categories_v1",
        accountingBasis: "published_component_circuits",
        grain: "day",
        timezone: NGEE_ANN_GOLDEN.timezone,
      });
      expect(analysis.componentCategoryBreakdown?.scopes).toHaveLength(3);
      const projectComponentBreakdown = analysis.componentCategoryBreakdown?.scopes.find(
        (scope) => scope.scopeId === "project",
      );
      expect(projectComponentBreakdown?.rows).toHaveLength(7);
      expect((projectComponentBreakdown?.period as unknown as { status?: string })?.status)
        .toBe("complete");
      expect(projectComponentBreakdown?.period.componentUsageKwh)
        .toBeCloseTo(NGEE_ANN_GOLDEN.period.componentReconciliation.componentUsageKwh, 3);
      expect(projectComponentBreakdown?.period.officialUsageKwh)
        .toBeCloseTo(NGEE_ANN_GOLDEN.period.usageKwh, 3);
      expect(projectComponentBreakdown?.period.categories.every(
        (category) => category.usageKwh !== null,
      )).toBe(true);
      expect(projectComponentBreakdown?.period.categories.reduce(
        (sum, category) => sum + (category.usageKwh as number),
        0,
      )).toBeCloseTo(projectComponentBreakdown?.period.componentUsageKwh ?? 0, 3);
      for (const row of projectComponentBreakdown?.rows ?? []) {
        expect(row.categories.reduce(
          (sum, category) => sum + (category.usageKwh ?? 0),
          0,
        )).toBeCloseTo(row.componentUsageKwh ?? 0, 3);
        expect(row.estimatedCost.status).toBe(analysis.cost.status);
      }
      expect(analysis.provenance.queryIds).toContain("daily_component_categories_v1");
      expect(analysis.timeBehaviour).toMatchObject({
        metricId: "energy.total_usage_kwh@1",
        grain: "hour",
        unit: "kWh",
        timezone: NGEE_ANN_GOLDEN.timezone,
        queryId: "time_bucket_grid_v1",
      });
      expect(analysis.timeBehaviour?.scopes).toHaveLength(3);
      expect(analysis.timeBehaviour?.scopes.every((scope) => scope.cells.length === 7 * 24))
        .toBe(true);
      const timeScope = (scopeId: string) => analysis.timeBehaviour?.scopes.find(
        (scope) => scope.scopeId === scopeId,
      );
      const projectCells = timeScope("project")?.cells ?? [];
      const level7Cells = timeScope("level-7")?.cells ?? [];
      const level6Cells = timeScope("level-6")?.cells ?? [];
      expect(roundForGolden(projectCells.reduce(
        (sum, cell) => sum + (cell.usageKwh ?? 0),
        0,
      ))).toBeCloseTo(NGEE_ANN_GOLDEN.period.usageKwh, 3);
      for (const dailyRow of analysis.dailyTotals?.scopes[0]?.rows ?? []) {
        expect(roundForGolden(projectCells.filter(
          (cell) => cell.localDate === dailyRow.localDate,
        ).reduce((sum, cell) => sum + (cell.usageKwh ?? 0), 0)))
          .toBeCloseTo(dailyRow.usageKwh ?? 0, 3);
      }
      for (const hourlyRow of analysis.hourlyProfile) {
        expect(roundForGolden(projectCells.filter(
          (cell) => cell.localHour === hourlyRow.hour,
        ).reduce((sum, cell) => sum + (cell.usageKwh ?? 0), 0)))
          .toBeCloseTo(hourlyRow.usageKwh, 3);
      }
      for (const [index, projectCell] of projectCells.entries()) {
        expect(projectCell.usageKwh).not.toBeNull();
        expect(projectCell.usageKwh ?? 0).toBeCloseTo(
          (level7Cells[index]?.usageKwh ?? 0) + (level6Cells[index]?.usageKwh ?? 0),
          3,
        );
      }
      const profile = (
        dayType: "weekday" | "weekend" | "public_holiday",
        scopeId = "project",
      ) => analysis.timeBehaviour?.dayProfiles.find((candidate) => (
        candidate.dayType === dayType && candidate.scopeId === scopeId
      ));
      expect(profile("weekday")).toMatchObject({
        status: "available",
        sampleDayCount: 5,
        values: expect.any(Array),
      });
      expect(profile("weekend")).toMatchObject({
        status: "available",
        sampleDayCount: 2,
        values: expect.any(Array),
      });
      expect(profile("public_holiday")).toMatchObject({
        status: "unavailable",
        reason: { code: "DAY_TYPE_CLASSIFICATION_UNAVAILABLE" },
      });
      expect(analysis.timeBehaviour?.dayProfiles.filter(
        (candidate) => candidate.status === "available",
      ).every((candidate) => candidate.values.length === 24)).toBe(true);
      const componentHourlyProfiles = analysis.componentHourlyProfiles;
      expect(componentHourlyProfiles).toMatchObject({
        queryId: "component_hourly_profiles_v1",
        accountingBasis: "published_component_circuits",
      });
      expect(componentHourlyProfiles?.scopes.map((scope) => scope.scopeId)).toEqual([
        "project",
        "level-7",
        "level-6",
      ]);
      const componentProfile = (scopeId: string, dayType: string) => (
        componentHourlyProfiles?.scopes.find((scope) => scope.scopeId === scopeId)
          ?.profiles.find((profile) => profile.dayType === dayType)
      );
      const projectWeekdayProfile = componentProfile("project", "weekday");
      const level7WeekdayProfile = componentProfile("level-7", "weekday");
      const level6WeekdayProfile = componentProfile("level-6", "weekday");
      expect(projectWeekdayProfile).toMatchObject({
        status: "available",
        sampleDayCount: 5,
        categories: [
          { category: "load", values: expect.any(Array) },
          { category: "light", values: expect.any(Array) },
        ],
      });
      expect(projectWeekdayProfile?.status).toBe("available");
      expect(level7WeekdayProfile?.status).toBe("available");
      expect(level6WeekdayProfile?.status).toBe("available");
      if (
        projectWeekdayProfile?.status !== "available"
        || level7WeekdayProfile?.status !== "available"
        || level6WeekdayProfile?.status !== "available"
      ) {
        throw new Error("NGEE_ANN_COMPONENT_HOURLY_GOLDEN_UNAVAILABLE");
      }
      expect(projectWeekdayProfile.categories.every(
        (category) => category.values.length === 24,
      )).toBe(true);
      expect(level7WeekdayProfile.circuits).toHaveLength(7);
      expect(level6WeekdayProfile.circuits).toHaveLength(7);
      expect(componentProfile("project", "public_holiday")).toMatchObject({
        status: "unavailable",
      });
      expect(analysis.provenance.queryIds).toContain("component_hourly_profiles_v1");
      expect(analysis.peakBreakdown).toEqual(expectedNgeeAnnPeakBreakdown());
      for (const scope of analysis.dailyTotals?.scopes ?? []) {
        const expectedUsageKwh = scope.scopeId === "project"
          ? NGEE_ANN_GOLDEN.period.usageKwh
          : NGEE_ANN_GOLDEN.period.levelUsageKwh[
            scope.scopeId as keyof typeof NGEE_ANN_GOLDEN.period.levelUsageKwh
          ];
        expect(roundForGolden(scope.rows.reduce(
          (sum, row) => sum + (row.usageKwh ?? 0),
          0,
        ))).toBeCloseTo(expectedUsageKwh, 3);
      }
      expect(analysis.offHours).toEqual({
        status: NGEE_ANN_GOLDEN.invariants.offHoursStatus,
        reason: {
          code: "OPERATING_CALENDAR_VERSION_NOT_FOUND",
          message: "Operating calendar sg-calendar-v1 is not published for this Project.",
        },
        businessCalendarVersion: "sg-calendar-v1",
      });
      expect(analysis.cost).toEqual({
        status: NGEE_ANN_GOLDEN.invariants.tariffStatus,
        reason: {
          code: "TARIFF_VERSION_NOT_FOUND",
          message: "Tariff schedule sg-tariff-v1 is not published for this Project.",
        },
        tariffScheduleVersion: "sg-tariff-v1",
      });
      expect(analysis.dataHealth).toMatchObject(NGEE_ANN_GOLDEN.period.dataHealth);
      expect(analysis.dataHealth).toMatchObject({
        cumulativeDeltaMismatchCount: NGEE_ANN_GOLDEN.invariants.cumulativeDeltaMismatchCount,
        averageKwMismatchCount: NGEE_ANN_GOLDEN.invariants.averageKwMismatchCount,
        invalidIntervalDurationCount: NGEE_ANN_GOLDEN.invariants.invalidIntervalDurationCount
      });
      expect(roundForGolden(analysis.circuits.reduce((sum, meter) => sum + meter.usageKwh, 0)))
        .toBe(NGEE_ANN_GOLDEN.invariants.allMeterApiCircuitUsageKwh);
      expect(analysis.summary.usageKwh).not.toBe(NGEE_ANN_GOLDEN.invariants.allMeterApiCircuitUsageKwh);
      expect(analysis.units).toEqual({
        usage: NGEE_ANN_GOLDEN.invariants.usageUnit,
        demand: NGEE_ANN_GOLDEN.invariants.demandUnit,
        intervalMinutes: NGEE_ANN_GOLDEN.selection.intervalMinutes,
        timezone: NGEE_ANN_GOLDEN.timezone
      });
      expect(analysis.virtualMeters).toContainEqual(expect.objectContaining(NGEE_ANN_GOLDEN.virtualMeter));
      expect(analysis.virtualMeterTraces).toMatchObject([NGEE_ANN_GOLDEN.virtualMeterTrace]);
      expect(analysis.virtualMeterTraces?.flatMap((trace) => trace.terms)
        .every((term) => (
          term.dataHealth.status === "complete"
          || term.dataHealth.status === "partial"
          || term.dataHealth.status === "unavailable"
        ))).toBe(true);
      expect(analysis.provenance).toMatchObject({
        dataSnapshotId: ngeeAnnSnapshot.id,
        hierarchyRevisionId: context.hierarchyRevisionId,
        meterMappingRevisionId: context.meterMappingRevisionId,
        meterFormulaRevisionId: context.meterFormulaRevisionId,
        aggregationRule: "designated_total"
      });
      expect(analysis.provenance.queryIds).toContain("previous_meter_usage_v1");
      expect(analysis.provenance.queryIds).toContain("time_bucket_grid_v1");

      const dayContext = resolveEnergyQueryContext({
        metadataStore: metadata,
        user,
        workspaceId: "default",
        request: {
          projectId: "ngee-ann-polytechnic",
          scopeId: "project",
          resource: "electricity",
          period: "Custom",
          from: NGEE_ANN_GOLDEN.selection.day.localDate,
          to: NGEE_ANN_GOLDEN.selection.day.localDate
        }
      });
      const day = await executeEnergyScopeAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        userId: "dev-user",
        context: dayContext,
        databasePath
      });
      expect(day.summary).toMatchObject({
        usageKwh: NGEE_ANN_GOLDEN.day.usageKwh,
        peakKw: NGEE_ANN_GOLDEN.day.peakKw,
        peakAt: NGEE_ANN_GOLDEN.day.peakAt,
        validIntervalCount: NGEE_ANN_GOLDEN.day.validIntervalCount,
        qualityEventCount: NGEE_ANN_GOLDEN.day.qualityEventCount
      });
      expect(day.dataHealth.expectedMeterIntervalCount)
        .toBe(NGEE_ANN_GOLDEN.day.expectedMeterIntervalCount);
      expect(day.hourlyProfile).toEqual(
        expectedHourlyProfile(NGEE_ANN_GOLDEN.day.hourlyProfile, 4)
      );
      expect(day.dailyTotals?.scopes).toHaveLength(3);
      expect(day.dailyTotals?.scopes.every((scope) => (
        scope.rows.length === 1
        && scope.rows[0]?.localDate === NGEE_ANN_GOLDEN.selection.day.localDate
      ))).toBe(true);
      expect(day.timeBehaviour).toMatchObject({
        metricId: "energy.total_usage_kwh@1",
        grain: "hour",
        unit: "kWh",
        timezone: NGEE_ANN_GOLDEN.timezone,
        queryId: "time_bucket_grid_v1",
      });
      expect(day.timeBehaviour?.scopes).toHaveLength(3);
      const projectHours = day.timeBehaviour?.scopes.find(
        (scope) => scope.scopeId === "project",
      )?.cells;
      expect(projectHours).toHaveLength(24);
      expect(projectHours?.[0]).toEqual({
        localDate: NGEE_ANN_GOLDEN.selection.day.localDate,
        localHour: 0,
        from: "2026-06-15T16:00:00.000Z",
        to: "2026-06-15T17:00:00.000Z",
        usageKwh: 5.3565,
        dataHealth: {
          status: "complete",
          coveragePct: 100,
          expectedMeterIntervalCount: 16,
          validIntervalCount: 16,
          qualityEventCount: 0,
        },
      });
      expect(roundForGolden(projectHours?.reduce(
        (sum, cell) => sum + (cell.usageKwh ?? 0),
        0,
      ) ?? 0)).toBeCloseTo(NGEE_ANN_GOLDEN.day.usageKwh, 3);
      const projectProfile = (dayType: "weekday" | "weekend" | "public_holiday") => (
        day.timeBehaviour?.dayProfiles.find((profile) => (
          profile.dayType === dayType && profile.scopeId === "project"
        ))
      );
      expect(projectProfile("weekday")).toMatchObject({
        status: "available",
        sampleDayCount: 1,
        values: expect.any(Array),
      });
      expect(projectProfile("weekend")).toMatchObject({
        status: "unavailable",
        reason: { code: "COMPLETE_DAY_SAMPLE_UNAVAILABLE" },
      });
      expect(projectProfile("public_holiday")).toMatchObject({
        status: "unavailable",
        reason: { code: "DAY_TYPE_CLASSIFICATION_UNAVAILABLE" },
      });

      const analyzeScope = async (scopeId: string) => {
        const scopeContext = resolveEnergyQueryContext({
          metadataStore: metadata,
          user,
          workspaceId: "default",
          request: {
            projectId: "ngee-ann-polytechnic",
            scopeId,
            resource: "electricity",
            period: "Custom",
            from: NGEE_ANN_GOLDEN.selection.period.localFrom,
            to: "2026-06-16"
          }
        });
        return await executeEnergyScopeAnalysis({
          metadataStore: metadata,
          dataGateway: gateway,
          userId: "dev-user",
          context: scopeContext,
          databasePath
        });
      };
      for (const [scopeId, expected] of Object.entries(NGEE_ANN_GOLDEN.period.levels)) {
        const level = await analyzeScope(scopeId);
        expect(level.summary).toMatchObject({
          usageKwh: expected.usageKwh,
          peakKw: expected.peakKw,
          peakAt: expected.peakAt
        });
        expect(level.comparison).toMatchObject({
          usageKwh: expected.previousUsageKwh,
          changeKwh: expected.changeKwh,
          changePct: expected.changePct
        });
        expect(level.dataHealth).toMatchObject({
          status: "complete",
          coveragePct: 100,
          expectedMeterIntervalCount: 1344,
          validIntervalCount: 1344,
          qualityEventCount: 0
        });
      }
      const topCircuit = await analyzeScope(NGEE_ANN_GOLDEN.period.topCircuit.scopeId);
      expect(topCircuit.summary).toMatchObject({
        usageKwh: NGEE_ANN_GOLDEN.period.topCircuit.usageKwh,
        peakKw: NGEE_ANN_GOLDEN.period.topCircuit.peakKw
      });
      expect(topCircuit.comparison).toMatchObject({
        usageKwh: NGEE_ANN_GOLDEN.period.topCircuit.previousUsageKwh,
        changeKwh: NGEE_ANN_GOLDEN.period.topCircuit.changeKwh,
        changePct: NGEE_ANN_GOLDEN.period.topCircuit.changePct
      });
      expect(topCircuit.provenance.aggregationRule).toBe("component");

      const currentRootUsage = buildCurrentRootUsage();
      const rawLevel6Usage = allocateLevel6Usage(currentRootUsage);
      const rawLevel7Usage = currentRootUsage.map((usage, index) => usage - rawLevel6Usage[index]!);
      expect(dailyUsageOracle(currentRootUsage)).toEqual(dailyUsageGolden("project"));
      expect(dailyUsageOracle(rawLevel7Usage)).toEqual(dailyUsageGolden("level-7"));
      expect(dailyUsageOracle(rawLevel6Usage)).toEqual(dailyUsageGolden("level-6"));
      expect(hourlyUsagePeakOracle(currentRootUsage, [0, 1, 2, 3, 4, 5, 6])).toEqual(
        NGEE_ANN_GOLDEN.period.hourlyProfile.map(([hour, usageKwh, , peakKw]) => ({
          hour,
          usageKwh: roundForOracle(usageKwh),
          peakKw: roundForOracle(peakKw),
        })),
      );
      expect(hourlyUsagePeakOracle(currentRootUsage, [6])).toEqual(
        NGEE_ANN_GOLDEN.day.hourlyProfile.map(([hour, usageKwh, , peakKw]) => ({
          hour,
          usageKwh: roundForOracle(usageKwh),
          peakKw: roundForOracle(peakKw),
        })),
      );
      expect(roundForOracle(currentRootUsage.reduce((sum, usage) => sum + usage, 0)))
        .toBe(NGEE_ANN_GOLDEN.invariants.officialUsageKwh);
      expect(roundForOracle(Math.max(...currentRootUsage) * 4)).toBe(20.673108);
      const level6Total = rawLevel6Usage.reduce((sum, usage) => sum + usage, 0);
      const level7Total = rawLevel7Usage.reduce((sum, usage) => sum + usage, 0);
      const rawUsageByScope = new Map([
        ["l6-total-light", level6Total * totalCircuitGolden("l6-total-light").rawUsageKwh / 476.983827],
        ["l6-total-load", level6Total * totalCircuitGolden("l6-total-load").rawUsageKwh / 476.983827],
        ["l7-total-light", level7Total * totalCircuitGolden("l7-total-light").rawUsageKwh / 1054.184497],
        ["l7-total-load", level7Total * totalCircuitGolden("l7-total-load").rawUsageKwh / 1054.184497],
      ]);
      const rawUsage = (scopeId: string): number => rawUsageByScope.get(scopeId) ?? 0;
      expect(roundForOracle(rawUsage("l6-total-light") + rawUsage("l6-total-load")))
        .toBe(476.983827);
      expect(roundForOracle(rawUsage("l7-total-light") + rawUsage("l7-total-load")))
        .toBe(1054.184497);
      expect(roundForOracle(rawUsage("l6-total-light") + rawUsage("l7-total-light")))
        .toBe(291.744387);
      expect(roundForOracle(rawUsage("l6-total-load") + rawUsage("l7-total-load")))
        .toBe(1239.423937);
      expect(roundForOracle([...rawUsageByScope.values()].reduce((sum, usage) => sum + usage, 0)))
        .toBe(NGEE_ANN_GOLDEN.invariants.officialUsageKwh);
      expect(roundForOracle(
        NGEE_ANN_GOLDEN.invariants.officialUsageKwh
          + NGEE_ANN_GOLDEN.invariants.componentUsageKwh
      )).toBe(NGEE_ANN_GOLDEN.invariants.allMeterRawUsageKwh);
      for (const golden of NGEE_ANN_GOLDEN.period.totalCircuits) {
        expect(Math.round((rawUsageByScope.get(golden.scopeId) ?? 0) * 1_000_000) / 1_000_000)
          .toBe(golden.rawUsageKwh);
        const totalCircuit = await analyzeScope(golden.scopeId);
        expect(totalCircuit.summary.usageKwh).toBe(golden.apiUsageKwh);
        expect(totalCircuit.circuits.map((meter) => meter.meterNodeId)).toEqual([
          golden.meterNodeId
        ]);
        expect(totalCircuit.provenance).toMatchObject({
          meterMappingRevisionId: context.meterMappingRevisionId,
          meterFormulaRevisionId: context.meterFormulaRevisionId,
          aggregationRule: "designated_total"
        });
      }
    } finally {
      metadata.close();
      removeTemporaryEnergyFixture(root);
    }
  }, 45_000);

  it("preserves the date spine and reports partial and unavailable daily totals", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-analysis-daily-health-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    try {
      ensureEnergyIqBootstrap(metadata);
      await materializeNgeeAnnGoldenFixture(databasePath, metadata, {
        transformIntervalFacts: (facts) => facts
          .filter((fact) => (
            fact.localDate !== "2026-06-12"
            && !(fact.localDate === "2026-06-13"
              && fact.meterPointId === "mapping-lvl-6-total-office-light-8")
          ))
          .map((fact) => (
            fact.intervalStart === "2026-06-15T01:00:00.000Z"
              && fact.meterPointId === "mapping-lvl-7-total-office-load-18"
              ? { ...fact, qualityStatus: "rejected" }
              : fact
          )),
      });
      const user = metadata.users.getById({ user_id: "dev-user" });
      const context = resolveEnergyQueryContext({
        metadataStore: metadata,
        user,
        workspaceId: NGEE_ANN_GOLDEN.workspaceId,
        request: {
          projectId: NGEE_ANN_GOLDEN.projectId,
          scopeId: "project",
          resource: "electricity",
          period: "Custom",
          from: NGEE_ANN_GOLDEN.selection.period.localFrom,
          to: "2026-06-16",
        },
      });

      const analysis = await executeEnergyScopeAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        userId: "dev-user",
        context,
        databasePath,
      });
      const scope = (scopeId: string) => analysis.dailyTotals?.scopes.find(
        (candidate) => candidate.scopeId === scopeId,
      );
      const row = (scopeId: string, localDate: string) => scope(scopeId)?.rows.find(
        (candidate) => candidate.localDate === localDate,
      );

      expect(scope("project")?.rows).toHaveLength(7);
      expect(row("project", "2026-06-12")).toEqual({
        localDate: "2026-06-12",
        from: "2026-06-11T16:00:00.000Z",
        to: "2026-06-12T16:00:00.000Z",
        usageKwh: null,
        dataHealth: {
          status: "unavailable",
          coveragePct: 0,
          expectedMeterIntervalCount: 384,
          validIntervalCount: 0,
          qualityEventCount: 0,
          aggregateStatus: "unavailable",
          aggregateCoveragePct: 0,
          aggregateEligibleIntervalCount: 0,
          cadenceGapEventCount: 0,
        },
      });
      expect(row("project", "2026-06-13")).toMatchObject({
        usageKwh: expect.any(Number),
        dataHealth: {
          status: "partial",
          coveragePct: 75,
          expectedMeterIntervalCount: 384,
          validIntervalCount: 288,
          qualityEventCount: 0,
        },
      });
      expect(row("level-7", "2026-06-13")?.dataHealth).toEqual({
        status: "complete",
        coveragePct: 100,
        expectedMeterIntervalCount: 192,
        validIntervalCount: 192,
        qualityEventCount: 0,
      });
      expect(row("level-6", "2026-06-13")).toMatchObject({
        usageKwh: expect.any(Number),
        dataHealth: {
          status: "partial",
          coveragePct: 50,
          expectedMeterIntervalCount: 192,
          validIntervalCount: 96,
          qualityEventCount: 0,
        },
      });
      const cell = (scopeId: string, localDate: string, localHour: number) => (
        analysis.timeBehaviour?.scopes.find((candidate) => candidate.scopeId === scopeId)
          ?.cells.find((candidate) => (
            candidate.localDate === localDate && candidate.localHour === localHour
          ))
      );
      expect(cell("project", "2026-06-12", 8)).toEqual({
        localDate: "2026-06-12",
        localHour: 8,
        from: "2026-06-12T00:00:00.000Z",
        to: "2026-06-12T01:00:00.000Z",
        usageKwh: null,
        dataHealth: {
          status: "unavailable",
          coveragePct: 0,
          expectedMeterIntervalCount: 16,
          validIntervalCount: 0,
          qualityEventCount: 0,
        },
      });
      expect(cell("project", "2026-06-13", 8)?.dataHealth).toEqual({
        status: "partial",
        coveragePct: 75,
        expectedMeterIntervalCount: 16,
        validIntervalCount: 12,
        qualityEventCount: 0,
      });
      expect(cell("level-7", "2026-06-13", 8)?.dataHealth).toEqual({
        status: "complete",
        coveragePct: 100,
        expectedMeterIntervalCount: 8,
        validIntervalCount: 8,
        qualityEventCount: 0,
      });
      expect(cell("level-6", "2026-06-13", 8)?.dataHealth).toEqual({
        status: "partial",
        coveragePct: 50,
        expectedMeterIntervalCount: 8,
        validIntervalCount: 4,
        qualityEventCount: 0,
      });
      expect(cell("project", "2026-06-15", 9)).toMatchObject({
        usageKwh: expect.any(Number),
        dataHealth: {
          status: "partial",
          coveragePct: 93.75,
          expectedMeterIntervalCount: 16,
          validIntervalCount: 15,
          qualityEventCount: 1,
        },
      });
      const dayProfile = (dayType: "weekday" | "weekend", scopeId: string) => (
        analysis.timeBehaviour?.dayProfiles.find((candidate) => (
          candidate.dayType === dayType && candidate.scopeId === scopeId
        ))
      );
      expect(dayProfile("weekday", "project")).toMatchObject({
        status: "available",
        sampleDayCount: 3,
      });
      expect(dayProfile("weekday", "level-6")).toMatchObject({
        status: "available",
        sampleDayCount: 4,
      });
      expect(dayProfile("weekend", "project")).toMatchObject({
        status: "available",
        sampleDayCount: 1,
      });
      expect(dayProfile("weekend", "level-7")).toMatchObject({
        status: "available",
        sampleDayCount: 2,
      });
      expect(dayProfile("weekend", "level-6")).toMatchObject({
        status: "available",
        sampleDayCount: 1,
      });
    } finally {
      metadata.close();
      removeTemporaryEnergyFixture(root);
    }
  }, 30_000);

  it("includes a cumulative cadence-gap delta in aggregate totals without promoting it to a peak", async () => {
    const root = mkdtempSync(join(tmpdir(), "energy-analysis-cadence-gap-"));
    const databasePath = join(root, "energy.duckdb");
    const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
    const gateway = new LocalDataGateway(metadata);
    let gapUsageKwh: number | undefined;
    let gapLocalDate: string | undefined;
    try {
      ensureEnergyIqBootstrap(metadata);
      await materializeNgeeAnnGoldenFixture(databasePath, metadata, {
        transformIntervalFacts: (facts) => facts.map((fact) => {
          if (gapUsageKwh !== undefined
            || fact.meterPointId !== "mapping-lvl-7-total-office-load-18"
            || fact.intervalStart === NGEE_ANN_GOLDEN.period.peakAt
            || fact.intervalStart < "2026-06-10T00:00:00.000Z") return fact;
          gapUsageKwh = fact.usageKwh;
          gapLocalDate = fact.localDate;
          return {
            ...fact,
            intervalEnd: new Date(Date.parse(fact.intervalStart) + 30 * 60_000).toISOString(),
            elapsedMinutes: 30,
            averageKw: 9_999,
            qualityStatus: "gap",
          };
        }),
      });
      expect(gapUsageKwh).toBeTypeOf("number");
      expect(gapLocalDate).toBeTypeOf("string");

      const user = metadata.users.getById({ user_id: "dev-user" });
      const context = resolveEnergyQueryContext({
        metadataStore: metadata,
        user,
        workspaceId: NGEE_ANN_GOLDEN.workspaceId,
        request: {
          projectId: NGEE_ANN_GOLDEN.projectId,
          scopeId: "project",
          resource: "electricity",
          period: "Custom",
          from: NGEE_ANN_GOLDEN.selection.period.localFrom,
          to: "2026-06-16",
        },
      });
      const analysis = await executeEnergyScopeAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        userId: "dev-user",
        context,
        databasePath,
        includeTimeBehaviour: true,
      });

      expect(analysis.summary.usageKwh).toBe(NGEE_ANN_GOLDEN.period.usageKwh);
      expect(analysis.summary.peakKw).toBe(NGEE_ANN_GOLDEN.period.peakKw);
      expect(analysis.summary.peakKw).toBeLessThan(9_999);
      expect(analysis.designatedTotals.reduce((sum, meter) => sum + meter.usageKwh, 0))
        .toBeCloseTo(NGEE_ANN_GOLDEN.period.usageKwh, 3);
      expect(analysis.dailyTotals?.scopes.find((scope) => scope.scopeId === "project")
        ?.rows.reduce((sum, row) => sum + (row.usageKwh ?? 0), 0) ?? 0)
        .toBeCloseTo(NGEE_ANN_GOLDEN.period.usageKwh, 3);
      expect(analysis.dailyTotals?.scopes.find((scope) => scope.scopeId === "project")
        ?.rows.find((row) => row.localDate === gapLocalDate)?.dataHealth).toMatchObject({
          status: "partial",
          qualityEventCount: 1,
        });
      expect(Math.max(...(analysis.hourlyProfile ?? []).map((row) => row.peakKw))).toBeLessThan(9_999);

      const fullWeekContext = resolveEnergyQueryContext({
        metadataStore: metadata,
        user,
        workspaceId: NGEE_ANN_GOLDEN.workspaceId,
        request: {
          projectId: NGEE_ANN_GOLDEN.projectId,
          scopeId: "project",
          resource: "electricity",
          period: "Custom",
          from: "2026-06-08",
          to: "2026-06-14",
        },
      });
      const fullWeek = await executeEnergyScopeAnalysis({
        metadataStore: metadata,
        dataGateway: gateway,
        userId: "dev-user",
        context: fullWeekContext,
        databasePath,
      });
      expect(fullWeek.calendarTotals?.scopes[0]?.weeks.find((week) => (
        week.localFrom === "2026-06-08"
      ))).toMatchObject({
        localToInclusive: "2026-06-14",
        isPartialCalendarPeriod: false,
        usageKwh: expect.any(Number),
        dataHealth: {
          status: "complete",
          qualityEventCount: 1,
        },
      });
    } finally {
      metadata.close();
      removeTemporaryEnergyFixture(root);
    }
  }, 30_000);

  it("fails Day Profile closed per Scope when accepted fact Day Type conflicts", async () => {
    const analysis = await analyzeNgeeAnnFixture((facts) => facts.map((fact) => (
      fact.intervalStart === "2026-06-10T00:00:00.000Z"
        && fact.meterPointId === "mapping-lvl-7-total-office-load-18"
        ? { ...fact, dayType: "weekend" }
        : fact
    )));
    const profile = (dayType: "weekday" | "weekend", scopeId: string) => (
      analysis.timeBehaviour?.dayProfiles.find((candidate) => (
        candidate.dayType === dayType && candidate.scopeId === scopeId
      ))
    );

    for (const scopeId of ["project", "level-7"]) {
      expect(profile("weekday", scopeId)).toMatchObject({
        status: "unavailable",
        reason: { code: "DAY_TYPE_CLASSIFICATION_UNAVAILABLE" },
      });
      expect(profile("weekend", scopeId)).toMatchObject({
        status: "unavailable",
        reason: { code: "DAY_TYPE_CLASSIFICATION_UNAVAILABLE" },
      });
    }
    expect(profile("weekday", "level-6")).toMatchObject({
      status: "available",
      sampleDayCount: 5,
    });
    expect(profile("weekend", "level-6")).toMatchObject({
      status: "available",
      sampleDayCount: 2,
    });
    const componentProfile = (dayType: "weekday" | "weekend", scopeId: string) => (
      analysis.componentHourlyProfiles?.scopes.find((scope) => scope.scopeId === scopeId)
        ?.profiles.find((candidate) => candidate.dayType === dayType)
    );
    expect(componentProfile("weekday", "project")).toMatchObject({
      status: "available",
      sampleDayCount: 5,
    });
    expect(analysis.timeBehaviour?.scopes.find((scope) => scope.scopeId === "project")
      ?.cells.find((cell) => cell.localDate === "2026-06-10" && cell.localHour === 8)
      ?.dataHealth.status).toBe("complete");
  }, 30_000);

  it("withholds component Category period totals when one daily Category row is partial", async () => {
    const analysis = await analyzeNgeeAnnFixture((facts) => facts.filter((fact) => !(
      fact.meterPointId === "mapping-lvl-7-office-load-1-l1p1-l3p6-13"
      && fact.intervalStart === "2026-06-11T16:00:00.000Z"
    )));
    const project = analysis.componentCategoryBreakdown?.scopes.find(
      (scope) => scope.scopeId === "project",
    );

    expect(project?.rows.find((row) => row.localDate === "2026-06-12")).toMatchObject({
      componentUsageKwh: null,
      dataHealth: { status: "partial" },
    });
    expect(project?.period).toMatchObject({
      status: "partial",
      officialUsageKwh: null,
      componentUsageKwh: null,
      gapKwh: null,
      ratioPct: null,
      categories: expect.arrayContaining([
        expect.objectContaining({ usageKwh: null, sharePct: null }),
      ]),
    });
    const componentProfile = (scopeId: string, dayType: string) => (
      analysis.componentHourlyProfiles?.scopes.find((scope) => scope.scopeId === scopeId)
        ?.profiles.find((profile) => profile.dayType === dayType)
    );
    expect(componentProfile("project", "weekday")).toMatchObject({
      status: "available",
      sampleDayCount: 4,
    });
    expect(componentProfile("level-7", "weekday")).toMatchObject({
      status: "available",
      sampleDayCount: 4,
    });
    expect(componentProfile("level-6", "weekday")).toMatchObject({
      status: "available",
      sampleDayCount: 5,
    });
  }, 30_000);

  it("fails component hourly Profiles closed per Scope when component Day Type conflicts", async () => {
    const analysis = await analyzeNgeeAnnFixture((facts) => facts.map((fact) => (
      fact.intervalStart === "2026-06-10T00:00:00.000Z"
        && fact.meterPointId === "mapping-lvl-7-office-load-1-l1p1-l3p6-13"
        ? { ...fact, dayType: "weekend" }
        : fact
    )));
    const profile = (dayType: "weekday" | "weekend", scopeId: string) => (
      analysis.componentHourlyProfiles?.scopes.find((scope) => scope.scopeId === scopeId)
        ?.profiles.find((candidate) => candidate.dayType === dayType)
    );

    for (const scopeId of ["project", "level-7"]) {
      expect(profile("weekday", scopeId)).toMatchObject({
        status: "unavailable",
        reason: { code: "DAY_TYPE_CLASSIFICATION_UNAVAILABLE" },
      });
      expect(profile("weekend", scopeId)).toMatchObject({
        status: "unavailable",
        reason: { code: "DAY_TYPE_CLASSIFICATION_UNAVAILABLE" },
      });
    }
    expect(profile("weekday", "level-6")).toMatchObject({
      status: "available",
      sampleDayCount: 5,
    });
  }, 30_000);

  it("excludes non-published standalone and total meter rows from component Category accounting", async () => {
    const fakeRows: unknown[][] = [
      ["unpublished-standalone", "level-7", "Standalone", "Standalone", "load", "standalone", 9_999, 100, 672, 0],
      ["unpublished-parent-total", "level-7", "Parent total", "Parent total", "load", "total", 8_888, 90, 672, 0],
      ["unpublished-other-meter", "l7-load-1", "Other meter", "Other meter", "light", "component", 7_777, 80, 672, 0],
    ];
    const analysis = await analyzeNgeeAnnFixture((facts) => facts, undefined, fakeRows);
    const project = analysis.componentCategoryBreakdown?.scopes.find(
      (scope) => scope.scopeId === "project",
    );

    expect(project?.period.status).toBe("complete");
    expect(project?.period.componentUsageKwh)
      .toBeCloseTo(NGEE_ANN_GOLDEN.period.componentReconciliation.componentUsageKwh, 3);
    expect(analysis.componentReconciliation.componentMeterNodeIds).not.toEqual(
      expect.arrayContaining(fakeRows.map((row) => row[0])),
    );
  }, 30_000);

  it("fails the component Category Projection closed when a published component route has no facts", async () => {
    const analysis = await analyzeNgeeAnnFixture((facts) => facts.filter((fact) => (
      fact.meterPointId !== "mapping-lvl-7-office-load-1-l1p1-l3p6-13"
    )));

    expect(analysis.componentCategoryBreakdown).toBeUndefined();
    expect(analysis.provenance.queryIds).not.toContain("daily_component_categories_v1");
  }, 30_000);

  it("withholds official component reconciliation when an official daily row is partial", async () => {
    const analysis = await analyzeNgeeAnnFixture((facts) => facts.filter((fact) => !(
      fact.meterPointId === "mapping-lvl-7-total-office-load-18"
      && fact.intervalStart === "2026-06-11T16:00:00.000Z"
    )));
    const project = analysis.componentCategoryBreakdown?.scopes.find(
      (scope) => scope.scopeId === "project",
    );

    expect(project?.rows.find((row) => row.localDate === "2026-06-12")).toMatchObject({
      officialUsageKwh: null,
      estimatedCost: { status: "unavailable" },
      dataHealth: { status: "partial" },
    });
    expect(project?.period).toMatchObject({
      status: "partial",
      officialUsageKwh: null,
      componentUsageKwh: null,
      gapKwh: null,
      ratioPct: null,
      categories: expect.arrayContaining([
        expect.objectContaining({ usageKwh: null, sharePct: null }),
      ]),
    });
  }, 30_000);

  it.each([
    {
      name: "missing",
      expectedCode: "PEAK_INTERVAL_FACTS_UNAVAILABLE",
      transform: (facts: EnergyIntervalFactWrite[]) => alterProjectPeakOfficialFact(
        facts,
        "missing",
      ),
    },
    {
      name: "duplicate",
      expectedCode: "PEAK_INTERVAL_FACTS_AMBIGUOUS",
      transform: (facts: EnergyIntervalFactWrite[]) => alterProjectPeakOfficialFact(
        facts,
        "duplicate",
      ),
    },
    {
      name: "rejected",
      expectedCode: "PEAK_INTERVAL_FACTS_REJECTED",
      transform: (facts: EnergyIntervalFactWrite[]) => alterProjectPeakOfficialFact(
        facts,
        "rejected",
      ),
    },
  ] as const)("fails the Peak Breakdown closed for a $name Project official input", async ({
    expectedCode,
    transform,
  }) => {
    const analysis = await analyzeNgeeAnnFixture(
      transform,
      expectedCode === "PEAK_INTERVAL_FACTS_AMBIGUOUS"
        ? "mapping-lvl-6-total-office-light-8"
        : undefined,
    );

    expect(analysis.summary.peakAt).toBe(NGEE_ANN_GOLDEN.period.peakAt);
    expect(analysis.peakBreakdown).toEqual({
      status: "unavailable",
      reason: expect.objectContaining({ code: expectedCode }),
    });
  }, 30_000);

  it("keeps Peak Breakdown available with a partial-period caveat when Peak inputs are complete", async () => {
    const analysis = await analyzeNgeeAnnFixture((facts) => facts.filter((fact) => !(
      fact.meterPointId === "mapping-lvl-6-total-office-light-8"
      && fact.intervalStart === "2026-06-11T16:00:00.000Z"
    )));

    expect(analysis.dataHealth.status).toBe("partial");
    expect(analysis.peakBreakdown).toMatchObject({
      status: "available",
      periodStatus: "partial",
      coveragePct: analysis.dataHealth.coveragePct,
      peak: {
        from: NGEE_ANN_GOLDEN.period.peakAt,
        dataHealth: { status: "complete" },
      },
    });
  }, 30_000);

  it("keeps Peak Breakdown available and isolates missing or duplicate component evidence", async () => {
    const missingMeterNodeId = "mapping-lvl-7-office-load-1-l1p1-l3p6-13";
    const duplicateMeterNodeId = "mapping-lvl-6-office-load-3-l1p13-l3p18-5";
    const analysis = await analyzeNgeeAnnFixture((facts) => facts.flatMap((fact) => {
      if (fact.intervalStart !== NGEE_ANN_GOLDEN.period.peakAt) return [fact];
      if (fact.meterPointId === missingMeterNodeId) return [];
      return [fact];
    }), duplicateMeterNodeId);
    const circuits = analysis.peakBreakdown?.status === "available"
      ? analysis.peakBreakdown.levels.flatMap((level) => level.circuits)
      : [];

    expect(analysis.peakBreakdown?.status).toBe("available");
    expect(circuits.find((circuit) => circuit.meterNodeId === missingMeterNodeId)).toMatchObject({
      averageKw: null,
      sharePct: null,
      dataHealth: {
        status: "unavailable",
        coveragePct: 0,
        expectedMeterIntervalCount: 1,
        validIntervalCount: 0,
        qualityEventCount: 0,
      },
    });
    expect(circuits.find((circuit) => circuit.meterNodeId === duplicateMeterNodeId)).toMatchObject({
      averageKw: null,
      sharePct: null,
      dataHealth: {
        status: "unavailable",
        coveragePct: 0,
        expectedMeterIntervalCount: 1,
        validIntervalCount: 0,
        qualityEventCount: 0,
      },
    });
  }, 30_000);

  it("evaluates only supplied rule revisions and takes thresholds from the registry", () => {
    const attention = evaluateEnergyAttention({
      summary: {
        usageKwh: 100,
        averageDailyUsageKwh: 100,
        peakKw: 5,
        nonOperatingKwh: 50,
        nonOperatingSharePct: 50,
        validIntervalCount: 96,
        qualityEventCount: 0,
      },
      childScopes: [
        attentionChildScope("a", "A", 30, 3),
        attentionChildScope("b", "B", 10, 1),
        attentionChildScope("c", "C", 10, 1),
      ],
      circuits: [],
      ruleRevisions: [ruleRevision({
        revision_id: "comparison.people_intensity_outlier@7",
        evaluation_key: "PEOPLE_NORMALISED_OUTLIER",
        parameters: { minimum_peers: 3, median_ratio: 2.5 },
      })],
    });

    expect(attention.map((item) => item.code)).toEqual(["PEOPLE_NORMALISED_OUTLIER"]);
    expect(attention[0]?.evidence).toContain("3.00 kWh/person");
  });
});

describe("Energy virtual meter traces", () => {
  it("returns a partial trace with null result instead of a partial sum when one input is missing", () => {
    const load1 = virtualTraceMappingRow("load-1", "Load 1");
    const load2 = virtualTraceMappingRow("load-2", "Load 2");
    const [trace] = buildEnergyVirtualMeterTraces({
      virtualMeters: [virtualTraceFormula([
        { mapping_row_id: load1.id, coefficient: 1 },
        { mapping_row_id: load2.id, coefficient: 1 },
      ])],
      mappingRows: [load1, load2],
      includedScopeIds: new Set(["level-6"]),
      resource: "electricity",
      circuits: [virtualTraceCircuit(load1, 11.5379)],
    });

    expect(trace).toMatchObject({
      status: "partial",
      usageKwh: null,
      includedInOfficialTotal: false,
      missingTermMeterNodeIds: [load2.id],
      terms: [
        {
          meterNodeId: load1.id,
          name: load1.display_name,
          coefficient: 1,
          inputUsageKwh: 11.5379,
          contributionKwh: 11.5379,
          dataHealth: {
            status: "complete",
            ...virtualTraceDataHealth,
          },
        },
        {
          meterNodeId: load2.id,
          name: load2.display_name,
          coefficient: 1,
          inputUsageKwh: null,
          contributionKwh: null,
          dataHealth: {
            status: "unavailable",
            coveragePct: 0,
            expectedMeterIntervalCount: 0,
            validIntervalCount: 0,
            qualityEventCount: 0,
          },
        },
      ],
    });
  });

  it("marks an available term partial when its accepted intervals are incomplete", () => {
    const load = virtualTraceMappingRow("load-1", "Load 1");
    const incompleteCircuit = {
      ...virtualTraceCircuit(load, 11.5379),
      dataHealth: {
        coveragePct: 50,
        expectedMeterIntervalCount: 672,
        validIntervalCount: 336,
        qualityEventCount: 0,
      },
    };
    const [trace] = buildEnergyVirtualMeterTraces({
      virtualMeters: [virtualTraceFormula([{ mapping_row_id: load.id, coefficient: 1 }])],
      mappingRows: [load],
      includedScopeIds: new Set(["level-6"]),
      resource: "electricity",
      circuits: [incompleteCircuit],
    });

    expect(trace?.terms[0]?.dataHealth).toEqual({
      status: "partial",
      coveragePct: 50,
      expectedMeterIntervalCount: 672,
      validIntervalCount: 336,
      qualityEventCount: 0,
    });
  });

  it("preserves a negative coefficient as a negative contribution", () => {
    const load1 = virtualTraceMappingRow("load-1", "Load 1");
    const load2 = virtualTraceMappingRow("load-2", "Load 2");
    const [trace] = buildEnergyVirtualMeterTraces({
      virtualMeters: [virtualTraceFormula([
        { mapping_row_id: load2.id, coefficient: 1 },
        { mapping_row_id: load1.id, coefficient: -1 },
      ])],
      mappingRows: [load1, load2],
      includedScopeIds: new Set(["level-6"]),
      resource: "electricity",
      circuits: [
        virtualTraceCircuit(load1, 11.5379),
        virtualTraceCircuit(load2, 37.4839),
      ],
    });

    expect(trace).toMatchObject({
      status: "available",
      usageKwh: 25.946,
      includedInOfficialTotal: false,
      missingTermMeterNodeIds: [],
      terms: [
        {
          meterNodeId: load2.id,
          coefficient: 1,
          inputUsageKwh: 37.4839,
          contributionKwh: 37.4839,
        },
        {
          meterNodeId: load1.id,
          coefficient: -1,
          inputUsageKwh: 11.5379,
          contributionKwh: -11.5379,
        },
      ],
    });
  });
});

const virtualTraceDataHealth = {
  coveragePct: 100,
  expectedMeterIntervalCount: 672,
  validIntervalCount: 672,
  qualityEventCount: 0,
} as const;

const virtualTraceMappingRow = (
  id: string,
  displayName: string,
): EnergyIqMeterMappingRow => ({
  id,
  source_label: displayName,
  scope_id: id,
  navigation_scope_id: id,
  display_name: displayName,
  resource: "electricity",
  category: "load",
  coverage: "partial",
  meter_role: "component",
  aggregation_usage: "excluded",
});

const virtualTraceFormula = (
  terms: EnergyIqVirtualMeter["terms"],
): EnergyIqVirtualMeter => ({
  id: "derived-load",
  display_name: "Derived load",
  scope_id: "level-6",
  resource: "electricity",
  category: "load",
  terms,
});

const virtualTraceCircuit = (
  meter: EnergyIqMeterMappingRow,
  usageKwh: number,
): EnergyScopeAnalysis["circuits"][number] => ({
  meterNodeId: meter.id,
  scopeId: meter.navigation_scope_id ?? meter.scope_id,
  parentScopeId: "level-6",
  name: meter.display_name,
  appliance: meter.display_name,
  category: meter.category,
  meterRole: meter.meter_role,
  includedInOfficialTotal: false,
  usageKwh,
  sharePct: 0,
  comparison: { usageKwh: 0, changeKwh: usageKwh, changePct: null },
  dataHealth: virtualTraceDataHealth,
  peakKw: 1,
  qualityEventCount: 0,
});

const attentionChildScope = (
  nodeId: string,
  name: string,
  usageKwh: number,
  kwhPerPerson: number,
): EnergyScopeAnalysis["childScopes"][number] => ({
  nodeId,
  name,
  nodeType: "room",
  usageKwh,
  sharePct: usageKwh,
  comparison: { usageKwh, changeKwh: 0, changePct: 0 },
  dataHealth: {
    coveragePct: 100,
    expectedMeterIntervalCount: 96,
    validIntervalCount: 96,
    qualityEventCount: 0,
  },
  occupantCount: 10,
  kwhPerPerson,
});

const ruleRevision = (override: Partial<EnergyIqRuleRevisionRecord>): EnergyIqRuleRevisionRecord => ({
  revision_id: "rule@1",
  rule_id: "rule",
  version: 1,
  display_name: "Rule",
  description: "Rule",
  family: "comparison",
  severity: "warning",
  evaluation_key: "RULE",
  metric_revision_ids: [],
  parameters: {},
  requirement: "always",
  created_at: "2026-08-02T00:00:00.000Z",
  ...override,
});

const configurePreschoolOperationalPolicy = (
  metadata: ReturnType<typeof createMetadataStore>,
): void => {
  metadata.energyIq.operationalPolicy.publishTariffSchedule({
    version_id: "sg-tariff-v1",
    project_id: PRESCHOOL_GOLDEN.projectId,
    published_by: "dev-user",
    entries: [{
      id: "sg-tariff-v1-flat",
      owner: { kind: "project" },
      effective_from: "2026-04-30T16:00:00.000Z",
      effective_to: "2026-05-31T16:00:00.000Z",
      currency: "SGD",
      rate_per_kwh: 0.25,
    }],
  });
  metadata.energyIq.operationalPolicy.publishOperatingCalendar({
    version_id: "sg-preschool-calendar-v1",
    project_id: PRESCHOOL_GOLDEN.projectId,
    published_by: "dev-user",
    entries: [{
      id: "sg-preschool-calendar-v1-hours",
      owner: { kind: "project" },
      effective_from: "2026-05-01",
      effective_to: "2026-06-01",
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
};

type GoldenMeter = {
  id: string;
  scopeId: string;
  parentNodeId: string;
  name: string;
  category: "light" | "load";
  meterRole: "total" | "component";
  importBatchId: string;
  usage: number[];
};

const analyzeNgeeAnnFixture = async (
  transformIntervalFacts: (facts: EnergyIntervalFactWrite[]) => EnergyIntervalFactWrite[],
  duplicatePeakQueryMeterNodeId?: string,
  extraMeterBreakdownRows: unknown[][] = [],
): Promise<EnergyScopeAnalysis> => {
  const root = mkdtempSync(join(tmpdir(), "energy-analysis-peak-health-"));
  const databasePath = join(root, "energy.duckdb");
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  const gateway = new LocalDataGateway(metadata);
  const runSqlReadonly = gateway.runSqlReadonly.bind(gateway);
  gateway.runSqlReadonly = async (request) => {
    const result = await runSqlReadonly(request);
    if (extraMeterBreakdownRows.length > 0
      && request.sql.includes("MAX(device_name) AS device_name")) {
      return { ...result, rows: [...result.rows, ...extraMeterBreakdownRows] };
    }
    if (!duplicatePeakQueryMeterNodeId
      || !request.sql.includes("AS interval_start_ms")) return result;
    const duplicate = result.rows.find((row) => row[0] === duplicatePeakQueryMeterNodeId);
    return duplicate ? { ...result, rows: [...result.rows, [...duplicate]] } : result;
  };
  try {
    ensureEnergyIqBootstrap(metadata);
    await materializeNgeeAnnGoldenFixture(databasePath, metadata, { transformIntervalFacts });
    const user = metadata.users.getById({ user_id: "dev-user" });
    const context = resolveEnergyQueryContext({
      metadataStore: metadata,
      user,
      workspaceId: NGEE_ANN_GOLDEN.workspaceId,
      request: {
        projectId: NGEE_ANN_GOLDEN.projectId,
        scopeId: "project",
        resource: "electricity",
        period: "Custom",
        from: NGEE_ANN_GOLDEN.selection.period.localFrom,
        to: "2026-06-16",
      },
    });
    return await executeEnergyScopeAnalysis({
      metadataStore: metadata,
      dataGateway: gateway,
      userId: "dev-user",
      context,
      databasePath,
    });
  } finally {
    metadata.close();
    removeTemporaryEnergyFixture(root);
  }
};

const alterProjectPeakOfficialFact = (
  facts: EnergyIntervalFactWrite[],
  mode: "missing" | "duplicate" | "rejected",
): EnergyIntervalFactWrite[] => facts.flatMap((fact) => {
  if (fact.intervalStart !== NGEE_ANN_GOLDEN.period.peakAt) return [fact];
  if (fact.meterPointId === "mapping-lvl-6-total-office-light-8") {
    if (mode === "missing") return [];
    if (mode === "duplicate") return [fact];
    return [{ ...fact, qualityStatus: "rejected" }];
  }
  if (mode !== "duplicate" && fact.meterPointId === "mapping-lvl-6-total-office-load-9") {
    return [{
      ...fact,
      activeEnergyKwh: fact.previousActiveEnergyKwh + 25,
      rawDeltaKwh: 25,
      usageKwh: 25,
      averageKw: 100,
    }];
  }
  return [fact];
});

const materializeNgeeAnnGoldenFixture = async (
  databasePath: string,
  metadataStore: MetadataStore,
  options: {
    transformIntervalFacts?: (facts: EnergyIntervalFactWrite[]) => EnergyIntervalFactWrite[];
    includeAnomalyHistory?: boolean;
  } = {},
) => {
  const currentRootUsage = buildCurrentRootUsage();
  const currentLevel6Usage = allocateLevel6Usage(currentRootUsage);
  const currentLevel7Usage = currentRootUsage.map((usage, index) => usage - currentLevel6Usage[index]!);
  const previousLevel6Usage = options.includeAnomalyHistory
    ? dailyIntervalUsage([83.686217, 80.0073, 80.0073, 36.6681, 36.6681, 80.0073, 80.0073])
    : constantUsage(477.051617, 7 * 24 * 4);
  const previousLevel7Usage = options.includeAnomalyHistory
    ? dailyIntervalUsage([125.774051, 138.8777, 138.8777, 26.6704, 26.6704, 138.8777, 138.8777])
    : constantUsage(734.625651, 7 * 24 * 4);
  const currentFrom = Date.parse(NGEE_ANN_GOLDEN.selection.period.from);
  const previousFrom = currentFrom - 7 * 86_400_000;
  const overlapSentinelFrom = Date.parse(options.includeAnomalyHistory
    ? "2026-04-20T16:00:00.000Z"
    : "2026-05-18T16:00:00.000Z");
  const level7BatchId = NGEE_ANN_GOLDEN.period.dataHealth.importBatchIds[0];
  const level6BatchId = NGEE_ANN_GOLDEN.period.dataHealth.importBatchIds[1];
  const earlierLevel6BatchId = "ngee-ann-l6-apr-may-fixture";
  const earlierLevel7BatchId = "ngee-ann-l7-apr-may-fixture";
  const level6LightShare = totalCircuitGolden("l6-total-light").rawUsageKwh / 476.983827;
  const level7LightShare = totalCircuitGolden("l7-total-light").rawUsageKwh / 1054.184497;
  const currentLevel6ByCategory = splitLevelUsageAtSourcePeak(
    currentLevel6Usage,
    level6LightShare,
    3.094124,
  );
  const currentLevel7ByCategory = splitLevelUsageAtSourcePeak(
    currentLevel7Usage,
    level7LightShare,
    3.778204,
  );
  const meters: GoldenMeter[] = [
    officialMeter({
      id: "mapping-lvl-6-total-office-light-8",
      scopeId: "level-6",
      name: "Lvl 6 Total Office Light",
      category: "light",
      importBatchId: level6BatchId,
      previous: previousLevel6Usage.map((usage) => usage * level6LightShare),
      current: currentLevel6ByCategory.light
    }),
    officialMeter({
      id: "mapping-lvl-6-total-office-load-9",
      scopeId: "level-6",
      name: "Lvl 6 Total Office Load",
      category: "load",
      importBatchId: level6BatchId,
      previous: previousLevel6Usage.map((usage) => usage * (1 - level6LightShare)),
      current: currentLevel6ByCategory.load
    }),
    officialMeter({
      id: "mapping-lvl-7-total-office-light-17",
      scopeId: "level-7",
      name: "Total Office Light",
      category: "light",
      importBatchId: level7BatchId,
      previous: previousLevel7Usage.map((usage) => usage * level7LightShare),
      current: currentLevel7ByCategory.light
    }),
    officialMeter({
      id: "mapping-lvl-7-total-office-load-18",
      scopeId: "level-7",
      name: "Total Office Load",
      category: "load",
      importBatchId: level7BatchId,
      previous: previousLevel7Usage.map((usage) => usage * (1 - level7LightShare)),
      current: currentLevel7ByCategory.load
    }),
    ...circuitMeters(level6BatchId, level7BatchId)
  ];

  const writes: EnergyFactMaterializationBatchWrite[] = [];
  for (const importBatchId of [level7BatchId, level6BatchId]) {
    const sourceSha256 = fixtureSha(importBatchId);
    const batchMeters = meters.filter((meter) => meter.importBatchId === importBatchId);
    const intervalFacts = batchMeters.flatMap((meter) => meter.usage.map((usage, index) => {
      const intervalStartMs = meter.usage.length === 14 * 24 * 4
        ? previousFrom + index * 15 * 60_000
        : currentFrom + index * 15 * 60_000;
      return factFor(meter, usage, index, intervalStartMs);
    }));
    if (options.includeAnomalyHistory) {
      const currentWindowMissingDates = [
        "2026-05-20",
        "2026-05-21",
        "2026-05-22",
        "2026-05-23",
        "2026-05-25",
        "2026-05-26",
        "2026-05-27",
        "2026-05-28",
        "2026-05-29",
        "2026-06-02",
      ];
      const priorWindowDates = Array.from({ length: 28 }, (_, index) => new Date(
        Date.parse("2026-04-22T00:00:00.000Z") + index * 86_400_000,
      ).toISOString().slice(0, 10));
      const currentMissingProjectDailyUsage = (
        4904.8659
        - 1531.1683
        - 1211.6773
        - 63.3385 * 3
        - 218.885
      ) / currentWindowMissingDates.length;
      const priorProjectDailyUsage = 4831.5555 / priorWindowDates.length;
      const extraOfficialDailyUsage = new Map<string, { "level-7": number; "level-6": number }>([
        ["2026-05-24", { "level-7": 26.6704, "level-6": 36.6681 }],
        ["2026-05-30", { "level-7": 26.6704, "level-6": 36.6681 }],
        ["2026-05-31", { "level-7": 26.6704, "level-6": 36.6681 }],
        ["2026-06-01", { "level-7": 138.8777, "level-6": 80.0073 }],
        ...currentWindowMissingDates.map((localDate) => [localDate, {
          "level-7": currentMissingProjectDailyUsage - 80.0073,
          "level-6": 80.0073,
        }] as const),
        ...priorWindowDates.map((localDate) => [localDate, {
          "level-7": priorProjectDailyUsage - 80.0073,
          "level-6": 80.0073,
        }] as const),
      ]);
      const componentBaselineDates = [
        "2026-05-24",
        "2026-05-30",
        "2026-05-31",
        "2026-06-01",
        "2026-06-04",
        "2026-06-05",
        "2026-06-06",
        "2026-06-07",
        "2026-06-08",
        "2026-06-09",
      ];
      for (const meter of batchMeters) {
        if (meter.meterRole === "total") {
          const lightShare = meter.scopeId === "level-7" ? level7LightShare : level6LightShare;
          const categoryShare = meter.category === "light" ? lightShare : 1 - lightShare;
          for (const [localDate, levelUsage] of extraOfficialDailyUsage) {
            intervalFacts.push(...factsForLocalDate(
              meter,
              localDate,
              levelUsage[meter.scopeId as "level-7" | "level-6"] * categoryShare,
            ));
          }
          for (const fact of intervalFacts) {
            if (fact.meterPointId === meter.id
              && fact.localDate === "2026-06-03"
              && fact.localHour === 0) {
              fact.dayType = "weekend";
            }
          }
          continue;
        }
        const currentUsage = meter.usage.slice(-7 * 24 * 4);
        const componentDailyUsage = currentUsage.reduce((sum, usage) => sum + usage, 0) / 7;
        const existingDates = new Set(intervalFacts
          .filter((fact) => fact.meterPointId === meter.id)
          .map((fact) => fact.localDate));
        for (const localDate of componentBaselineDates) {
          if (!existingDates.has(localDate)) {
            intervalFacts.push(...factsForLocalDate(meter, localDate, componentDailyUsage));
          }
        }
      }
    }
    const sentinelMeter = batchMeters.find((meter) => meter.meterRole === "total");
    if (!sentinelMeter) throw new Error(`NGEE_ANN_GOLDEN_SENTINEL_METER_MISSING:${importBatchId}`);
    intervalFacts.push(factFor(sentinelMeter, 1.234, 0, overlapSentinelFrom));
    const transformedIntervalFacts = options.transformIntervalFacts?.(intervalFacts) ?? intervalFacts;
    const normalizedReadings = batchMeters.map((meter): EnergyNormalizedReadingWrite => ({
      workspaceId: NGEE_ANN_GOLDEN.workspaceId,
      projectId: NGEE_ANN_GOLDEN.projectId,
      importBatchId,
      resource: "electricity",
      meterPointId: meter.id,
      scopeId: meter.scopeId,
      parentNodeId: meter.parentNodeId,
      sourceLabel: meter.name,
      category: meter.category,
      meterRole: meter.meterRole,
      eventTime: new Date(currentFrom + 7 * 86_400_000).toISOString(),
      activeEnergyKwh: 1000 + meter.usage.reduce((sum, usage) => sum + usage, 0),
      sourceFile: fixtureSourceFile(importBatchId),
      sourceSha256,
      sourceRowNumber: 1,
      sourceReadingKind: "interval_usage",
    }));
    writes.push({
      importBatchId,
      sourceSha256,
      rawReadings: [],
      normalizedReadings,
      intervalFacts: transformedIntervalFacts,
      qualityEvents: []
    });
  }
  for (const [earlierBatchId, laterBatchId] of [
    [earlierLevel6BatchId, level6BatchId],
    [earlierLevel7BatchId, level7BatchId],
  ] as const) {
    const sentinelMeter = meters.find((meter) => meter.importBatchId === laterBatchId && meter.meterRole === "total");
    if (!sentinelMeter) throw new Error(`NGEE_ANN_GOLDEN_SENTINEL_METER_MISSING:${earlierBatchId}`);
    const earlierMeter = { ...sentinelMeter, importBatchId: earlierBatchId };
    writes.push({
      importBatchId: earlierBatchId,
      sourceSha256: fixtureSha(earlierBatchId),
      rawReadings: [],
      normalizedReadings: [],
      intervalFacts: [factFor(earlierMeter, 999, 0, overlapSentinelFrom)],
      qualityEvents: [],
    });
  }
  return materializeTestProjectSnapshot({
    metadataStore,
    databasePath,
    workspaceId: NGEE_ANN_GOLDEN.workspaceId,
    projectId: NGEE_ANN_GOLDEN.projectId,
    timezone: NGEE_ANN_GOLDEN.timezone,
    batches: writes,
  });
};

const officialMeter = (input: {
  id: string;
  scopeId: string;
  name: string;
  category: "light" | "load";
  importBatchId: string;
  previous: number[];
  current: number[];
}): GoldenMeter => ({
  ...input,
  parentNodeId: input.scopeId,
  meterRole: "total",
  usage: [...input.previous, ...input.current]
});

const circuitMeters = (level6BatchId: string, level7BatchId: string): GoldenMeter[] => [
  circuitMeter("mapping-lvl-6-office-light-left-external-1", "l6-light-left", "Lvl 6 Office Light-Left: External", "light", "component", 40.287062, level6BatchId),
  circuitMeter("mapping-lvl-6-office-light-right-internal-2", "l6-light-right", "Lvl 6 Office Light-Right: Internal", "light", "component", 70.68732, level6BatchId),
  circuitMeter("mapping-lvl-6-office-load-1-l1p1-l3p6-3", "l6-load-1", "Lvl 6 Office Load 1: L1P1-L3P6", "load", "component", 11.537893, level6BatchId),
  circuitMeter("mapping-lvl-6-office-load-2-l1p7-l3p12-4", "l6-load-2", "Lvl 6 Office Load 2: L1P7-L3P12", "load", "component", 37.483874, level6BatchId),
  circuitMeter("mapping-lvl-6-office-load-3-l1p13-l3p18-5", "l6-load-3", "Lvl 6 Office Load 3: L1P13-L3P18", "load", "component", 13.52915, level6BatchId),
  circuitMeter("mapping-lvl-6-office-load-4-l1p19-l3p24-6", "l6-load-4", "Lvl 6 Office Load 4: L1P19-L3P24", "load", "component", 255.153879, level6BatchId),
  circuitMeter("mapping-lvl-6-office-load-5-l1p25-l3p29-fan-isol-1-2-7", "l6-load-5", "Lvl 6 Office Load 5: L1P25-L3P29 Fan Isol 1/2", "load", "component", 42.335467, level6BatchId),
  circuitMeter("mapping-lvl-7-front-row-office-light-11", "l7-front-light", "Front Row Office Light", "light", "component", 107.019997, level7BatchId),
  circuitMeter("mapping-lvl-7-middle-row-office-light-12", "l7-middle-light", "Middle Row Office Light", "light", "component", 20.767825, level7BatchId),
  circuitMeter("mapping-lvl-7-back-row-office-light-10", "l7-back-light", "Back Row Office Light", "light", "component", 48.904264, level7BatchId),
  circuitMeter("mapping-lvl-7-office-load-1-l1p1-l3p6-13", "l7-load-1", "Office Load 1", "load", "component", 28.122014, level7BatchId),
  circuitMeter("mapping-lvl-7-office-load-2-l1p7-l3p15-14", "l7-load-2", "Office Load 2", "load", "component", 66.168234, level7BatchId),
  circuitMeter("mapping-lvl-7-office-load-3-l1p16-l3p21-15", "l7-load-3", "Office Load 3", "load", "component", 337.902316, level7BatchId),
  circuitMeter(
    "mapping-lvl-7-office-load-4-l1p22-l3p25-fan-isol1-2-16",
    "l7-load-4",
    "Office Load 4 Fan ISOL 1/2",
    "load",
    "component",
    439.097185,
    level7BatchId,
    3.530652,
    247.9813,
    3.7734
  )
];

const circuitMeter = (
  id: string,
  scopeId: string,
  name: string,
  category: "light" | "load",
  meterRole: "total" | "component",
  totalUsageKwh: number,
  importBatchId: string,
  peakKw = Math.max((totalUsageKwh / (7 * 24)) * 1.5, 0.2),
  previousUsageKwh?: number,
  previousPeakKw?: number
): GoldenMeter => {
  const baseCurrentUsage = [
    peakKw * 0.25,
    ...constantUsage(totalUsageKwh - peakKw * 0.25, 7 * 24 * 4 - 1)
  ];
  const currentUsage = pinComponentSourcePeak(
    baseCurrentUsage,
    SOURCE_PEAK_COMPONENT_KW_BY_METER_ID[id],
  );
  const previousUsage = previousUsageKwh === undefined
    ? []
    : [
        (previousPeakKw ?? peakKw) * 0.25,
        ...constantUsage(
          previousUsageKwh - (previousPeakKw ?? peakKw) * 0.25,
          7 * 24 * 4 - 1
        )
      ];
  return {
    id,
    scopeId,
    parentNodeId: scopeId.startsWith("l7-") ? "level-7" : "level-6",
    name,
    category,
    meterRole,
    importBatchId,
    usage: [...previousUsage, ...currentUsage]
  };
};

const SOURCE_PEAK_COMPONENT_KW_BY_METER_ID: Readonly<Record<string, number>> = {
  "mapping-lvl-7-front-row-office-light-11": 1.950620,
  "mapping-lvl-7-middle-row-office-light-12": 0.300360,
  "mapping-lvl-7-back-row-office-light-10": 1.439916,
  "mapping-lvl-7-office-load-1-l1p1-l3p6-13": 0.180420,
  "mapping-lvl-7-office-load-2-l1p7-l3p15-14": 1.374620,
  "mapping-lvl-7-office-load-3-l1p16-l3p21-15": 3.242088,
  "mapping-lvl-7-office-load-4-l1p22-l3p25-fan-isol1-2-16": 3.392240,
  "mapping-lvl-6-office-light-left-external-1": 1.483860,
  "mapping-lvl-6-office-light-right-internal-2": 1.582272,
  "mapping-lvl-6-office-load-1-l1p1-l3p6-3": 0.501772,
  "mapping-lvl-6-office-load-2-l1p7-l3p12-4": 0.429500,
  "mapping-lvl-6-office-load-3-l1p13-l3p18-5": 0.402808,
  "mapping-lvl-6-office-load-4-l1p19-l3p24-6": 3.474700,
  "mapping-lvl-6-office-load-5-l1p25-l3p29-fan-isol-1-2-7": 0.573484,
};

const sourcePeakIntervalIndex = (): number => intervalIndex(1, 14, 0);

const splitLevelUsageAtSourcePeak = (
  levelUsage: number[],
  lightShare: number,
  sourcePeakLightKw: number,
): { light: number[]; load: number[] } => {
  const peakIndex = sourcePeakIntervalIndex();
  const light = levelUsage.map((usage) => usage * lightShare);
  const sourcePeakLightUsage = sourcePeakLightKw * 0.25;
  const adjustment = sourcePeakLightUsage - light[peakIndex]!;
  const adjustableLightUsage = light.reduce(
    (sum, usage, index) => index === peakIndex ? sum : sum + usage,
    0,
  );
  const scale = (adjustableLightUsage - adjustment) / adjustableLightUsage;
  if (scale < 0) throw new Error("NGEE_ANN_SOURCE_PEAK_CATEGORY_SPLIT_INFEASIBLE");
  const adjustedLight = light.map((usage, index) => index === peakIndex
    ? sourcePeakLightUsage
    : usage * scale);
  const lightCorrection = light.reduce((sum, usage) => sum + usage, 0)
    - adjustedLight.reduce((sum, usage) => sum + usage, 0);
  adjustedLight[0] = adjustedLight[0]! + lightCorrection;
  const load = levelUsage.map((usage, index) => usage - adjustedLight[index]!);
  if (load.some((usage) => usage < 0)) {
    throw new Error("NGEE_ANN_SOURCE_PEAK_CATEGORY_SPLIT_INFEASIBLE");
  }
  return { light: adjustedLight, load };
};

const pinComponentSourcePeak = (usage: number[], sourcePeakKw?: number): number[] => {
  if (sourcePeakKw === undefined) return usage;
  const peakIndex = sourcePeakIntervalIndex();
  const protectedPeakIndex = 0;
  const sourcePeakUsage = sourcePeakKw * 0.25;
  const adjustment = sourcePeakUsage - usage[peakIndex]!;
  const adjustableUsage = usage.reduce(
    (sum, value, index) => index === peakIndex || index === protectedPeakIndex ? sum : sum + value,
    0,
  );
  const scale = (adjustableUsage - adjustment) / adjustableUsage;
  if (scale < 0) throw new Error("NGEE_ANN_SOURCE_PEAK_COMPONENT_INFEASIBLE");
  const adjusted = usage.map((value, index) => index === peakIndex
    ? sourcePeakUsage
    : index === protectedPeakIndex
      ? value
      : value * scale);
  const correction = usage.reduce((sum, value) => sum + value, 0)
    - adjusted.reduce((sum, value) => sum + value, 0);
  adjusted[1] = adjusted[1]! + correction;
  return adjusted;
};

const buildCurrentRootUsage = (): number[] => {
  const values = new Array<number>(7 * 24 * 4).fill(0);
  const remainingHourlyUsage = new Array<number>(24).fill(0);
  const fixedPeakUsage = Array.from({ length: 6 }, () => new Array<number>(24).fill(0));
  for (const [hour, weeklyUsage, , weeklyPeakKw] of NGEE_ANN_GOLDEN.period.hourlyProfile) {
    const dayProfile = NGEE_ANN_GOLDEN.day.hourlyProfile[hour];
    if (!dayProfile) throw new Error(`NGEE_ANN_GOLDEN_DAY_HOUR_MISSING:${hour}`);
    const [, dayUsage, , dayPeakKw] = dayProfile;
    const dayPeakQuarter = hour === 15 ? 1 : 0;
    const dayOtherUsage = (dayUsage - dayPeakKw * 0.25) / 3;
    for (let quarter = 0; quarter < 4; quarter += 1) {
      values[intervalIndex(6, hour, quarter)] = quarter === dayPeakQuarter
        ? dayPeakKw * 0.25
        : dayOtherUsage;
    }
    const weeklyPeakDay = hour === 10 ? 0 : 1;
    remainingHourlyUsage[hour] = weeklyUsage - dayUsage;
    fixedPeakUsage[weeklyPeakDay]![hour] = weeklyPeakKw * 0.25;
  }

  const projectDailyGolden = dailyUsageGolden("project").slice(0, 6);
  const remainingProjectUsage = remainingHourlyUsage.reduce((sum, usage) => sum + usage, 0);
  const projectDailyMargins = scaleMarginsToTotal(projectDailyGolden, remainingProjectUsage);
  const fixedDailyUsage = fixedPeakUsage.map((row) => row.reduce((sum, usage) => sum + usage, 0));
  const fixedHourlyUsage = remainingHourlyUsage.map((_, hour) => fixedPeakUsage.reduce(
    (sum, row) => sum + row[hour]!,
    0,
  ));
  const residualDailyMargins = projectDailyMargins.map((target, day) => target - fixedDailyUsage[day]!);
  const residualHourlyMargins = remainingHourlyUsage.map(
    (target, hour) => target - fixedHourlyUsage[hour]!,
  );
  const residualCapacities = fixedPeakUsage.map((row) => row.map((fixedUsage, hour) => {
    const weeklyProfile = NGEE_ANN_GOLDEN.period.hourlyProfile[hour];
    if (!weeklyProfile) throw new Error(`NGEE_ANN_GOLDEN_WEEKLY_HOUR_MISSING:${hour}`);
    const peakUsage = weeklyProfile[3] * 0.25;
    return fixedUsage > 0 ? peakUsage * 3 : peakUsage * 4;
  }));
  if (residualDailyMargins.some((margin) => margin < 0)
    || residualHourlyMargins.some((margin) => margin < 0)) {
    throw new Error("NGEE_ANN_PROJECT_DAILY_HOURLY_MARGINS_INFEASIBLE");
  }
  const residualCells = allocateByMargins(
    residualDailyMargins,
    residualHourlyMargins,
    residualCapacities,
  );

  for (let day = 0; day < 6; day += 1) {
    for (const [hour, , , weeklyPeakKw] of NGEE_ANN_GOLDEN.period.hourlyProfile) {
      const peakUsage = weeklyPeakKw * 0.25;
      const fixedUsage = fixedPeakUsage[day]![hour]!;
      const cellUsage = fixedUsage + residualCells[day]![hour]!;
      const fixedQuarter = hour === 10 ? 2 : 0;
      for (let quarter = 0; quarter < 4; quarter += 1) {
        const quarterUsage = fixedUsage > 0
          ? quarter === fixedQuarter
            ? fixedUsage
            : (cellUsage - fixedUsage) / 3
          : cellUsage / 4;
        if (quarterUsage > peakUsage + 1e-9) {
          throw new Error(`NGEE_ANN_PROJECT_HOURLY_PEAK_INFEASIBLE:${day}:${hour}`);
        }
        values[intervalIndex(day, hour, quarter)] = quarterUsage;
      }
    }
  }
  return values;
};

const allocateLevel6Usage = (rootUsage: number[]): number[] => {
  const target = 476.983827;
  const dailyTargets = scaleMarginsToTotal(dailyUsageGolden("level-6"), target);
  const projectPeakIndex = intervalIndex(1, 14, 0);
  const level6PeakIndex = intervalIndex(0, 10, 2);
  const lower = rootUsage.map((usage) => Math.max(0, usage - 12.063679 * 0.25));
  const upper = rootUsage.map((usage) => Math.min(usage, 9.205119 * 0.25));
  lower[projectPeakIndex] = upper[projectPeakIndex] = 8.609428 * 0.25;
  lower[level6PeakIndex] = upper[level6PeakIndex] = 9.20512 * 0.25;
  const result = new Array<number>(rootUsage.length).fill(0);
  for (let day = 0; day < 7; day += 1) {
    const start = intervalIndex(day, 0, 0);
    const end = start + 24 * 4;
    const lowerTotal = lower.slice(start, end).reduce((sum, usage) => sum + usage, 0);
    const headroom = upper.slice(start, end).reduce(
      (sum, usage, offset) => sum + usage - lower[start + offset]!,
      0,
    );
    const fraction = (dailyTargets[day]! - lowerTotal) / headroom;
    if (fraction < 0 || fraction > 1) {
      throw new Error(`NGEE_ANN_LEVEL_DAILY_ALLOCATION_INVALID:${day}`);
    }
    for (let index = start; index < end; index += 1) {
      result[index] = lower[index]! + (upper[index]! - lower[index]!) * fraction;
    }
    const correction = dailyTargets[day]! - result.slice(start, end).reduce(
      (sum, usage) => sum + usage,
      0,
    );
    const correctionIndex = result.findIndex((usage, index) => index >= start
      && index < end
      && index !== projectPeakIndex
      && index !== level6PeakIndex
      && usage + correction >= lower[index]! - 1e-12
      && usage + correction <= upper[index]! + 1e-12);
    if (correctionIndex < 0) {
      throw new Error(`NGEE_ANN_LEVEL_DAILY_ALLOCATION_CORRECTION_FAILED:${day}`);
    }
    result[correctionIndex] = result[correctionIndex]! + correction;
  }
  return result;
};

const dailyUsageGolden = (scopeId: "project" | "level-7" | "level-6"): readonly number[] => {
  const scope = NGEE_ANN_GOLDEN.period.dailyTotals.scopes.find(
    (candidate) => candidate.scopeId === scopeId,
  );
  if (!scope) throw new Error(`NGEE_ANN_DAILY_GOLDEN_SCOPE_MISSING:${scopeId}`);
  return scope.usageKwh;
};

const dailyUsageOracle = (usage: number[]): number[] => Array.from(
  { length: 7 },
  (_, day) => roundForGolden(usage.slice(
    intervalIndex(day, 0, 0),
    intervalIndex(day + 1, 0, 0),
  ).reduce((sum, value) => sum + value, 0)),
);

const hourlyUsagePeakOracle = (
  usage: number[],
  days: number[],
): Array<{ hour: number; usageKwh: number; peakKw: number }> => Array.from(
  { length: 24 },
  (_, hour) => {
    const intervals = days.flatMap((day) => usage.slice(
      intervalIndex(day, hour, 0),
      intervalIndex(day, hour + 1, 0),
    ));
    return {
      hour,
      usageKwh: roundForOracle(intervals.reduce((sum, value) => sum + value, 0)),
      peakKw: roundForOracle(Math.max(...intervals) * 4),
    };
  },
);

const scaleMarginsToTotal = (margins: readonly number[], target: number): number[] => {
  const current = margins.reduce((sum, margin) => sum + margin, 0);
  if (current <= 0 || target <= 0) throw new Error("NGEE_ANN_MARGIN_TOTAL_INVALID");
  return margins.map((margin) => margin * target / current);
};

const allocateByMargins = (
  rowMargins: number[],
  columnMargins: number[],
  capacities: number[][],
): number[][] => {
  const rowTotal = rowMargins.reduce((sum, margin) => sum + margin, 0);
  const columnTotal = columnMargins.reduce((sum, margin) => sum + margin, 0);
  if (Math.abs(rowTotal - columnTotal) > 1e-9) {
    throw new Error("NGEE_ANN_RAS_MARGIN_TOTAL_MISMATCH");
  }
  if (capacities.length !== rowMargins.length
    || capacities.some((row) => row.length !== columnMargins.length)) {
    throw new Error("NGEE_ANN_RAS_CAPACITY_SHAPE_INVALID");
  }
  const cells = capacities.map((row) => row.map(() => 1));
  for (let iteration = 0; iteration < 10_000; iteration += 1) {
    for (let row = 0; row < rowMargins.length; row += 1) {
      cells[row] = projectToCappedMargin(cells[row]!, capacities[row]!, rowMargins[row]!);
    }
    for (let column = 0; column < columnMargins.length; column += 1) {
      const projected = projectToCappedMargin(
        cells.map((row) => row[column]!),
        capacities.map((row) => row[column]!),
        columnMargins[column]!,
      );
      for (let row = 0; row < cells.length; row += 1) {
        cells[row]![column] = projected[row]!;
      }
    }
    const maximumError = Math.max(
      ...rowMargins.map((target, row) => Math.abs(
        cells[row]!.reduce((sum, value) => sum + value, 0) - target,
      )),
      ...columnMargins.map((target, column) => Math.abs(
        cells.reduce((sum, row) => sum + row[column]!, 0) - target,
      )),
    );
    if (maximumError < 1e-10) return cells;
  }
  throw new Error("NGEE_ANN_RAS_DID_NOT_CONVERGE");
};

const projectToCappedMargin = (
  values: number[],
  capacities: number[],
  target: number,
): number[] => {
  const capacity = capacities.reduce((sum, value) => sum + value, 0);
  if (target < -1e-9 || target > capacity + 1e-9) {
    throw new Error("NGEE_ANN_RAS_MARGIN_CAPACITY_INFEASIBLE");
  }
  if (target <= 0) return values.map(() => 0);
  let lowerScale = 0;
  let upperScale = 1;
  const projectedTotal = (scale: number) => values.reduce(
    (sum, value, index) => sum + Math.min(capacities[index]!, value * scale),
    0,
  );
  while (projectedTotal(upperScale) < target) upperScale *= 2;
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const scale = (lowerScale + upperScale) / 2;
    if (projectedTotal(scale) < target) lowerScale = scale;
    else upperScale = scale;
  }
  return values.map((value, index) => Math.min(capacities[index]!, value * upperScale));
};

const factFor = (
  meter: GoldenMeter,
  usage: number,
  index: number,
  intervalStartMs: number
): EnergyIntervalFactWrite => {
  const previousActiveEnergyKwh = 1000 + meter.usage.slice(0, index).reduce((sum, value) => sum + value, 0);
  const local = new Date(intervalStartMs + 8 * 60 * 60_000);
  return {
    workspaceId: NGEE_ANN_GOLDEN.workspaceId,
    projectId: NGEE_ANN_GOLDEN.projectId,
    importBatchId: meter.importBatchId,
    resource: "electricity",
    meterPointId: meter.id,
    scopeId: meter.scopeId,
    parentNodeId: meter.parentNodeId,
    sourceLabel: meter.name,
    category: meter.category,
    meterRole: meter.meterRole,
    intervalStart: new Date(intervalStartMs).toISOString(),
    intervalEnd: new Date(intervalStartMs + 15 * 60_000).toISOString(),
    elapsedMinutes: 15,
    activeEnergyKwh: previousActiveEnergyKwh + usage,
    previousActiveEnergyKwh,
    rawDeltaKwh: usage,
    usageKwh: usage,
    averageKw: usage * 4,
    qualityStatus: "ok",
    localDate: local.toISOString().slice(0, 10),
    localHour: local.getUTCHours(),
    dayType: [0, 6].includes(local.getUTCDay()) ? "weekend" : "weekday",
    sourceFile: fixtureSourceFile(meter.importBatchId),
    sourceSha256: fixtureSha(meter.importBatchId),
    sourceReadingKind: "interval_usage",
  };
};

const fixtureSha = (importBatchId: string): string => {
  if (importBatchId === "ngee-ann-l6-apr-may-fixture") {
    return "e4d788af0135281c8ba519f04fa3c44751206ce0812e15e434da6cb8fda44f70";
  }
  if (importBatchId === "ngee-ann-l7-apr-may-fixture") {
    return "0b1fb9613c596d3569f6be93046a43737366649b5f8a4d45fc8cdef073c30e5d";
  }
  if (importBatchId === NGEE_ANN_GOLDEN.period.dataHealth.importBatchIds[0]) {
    return "3f41f94e229933a97ce8d02a0382d3a8192e3c26065bf0f48a04168ec90dd674";
  }
  if (importBatchId === NGEE_ANN_GOLDEN.period.dataHealth.importBatchIds[1]) {
    return "64502f6369dad96f3dc6cbc650b28b3f108bb655e7a95ca078b9aa616966413f";
  }
  throw new Error(`NGEE_ANN_GOLDEN_IMPORT_BATCH_UNKNOWN:${importBatchId}`);
};

const fixtureSourceFile = (importBatchId: string): string => {
  if (importBatchId === "ngee-ann-l6-apr-may-fixture") {
    return "Ngee Ann Poly Level 6 (21 April - 20 May).xlsx";
  }
  if (importBatchId === "ngee-ann-l7-apr-may-fixture") {
    return "Ngee Ann Poly Level 7 (21 April - 20 May).xlsx";
  }
  if (importBatchId === NGEE_ANN_GOLDEN.period.dataHealth.importBatchIds[0]) {
    return "Ngee Ann Poly Level 7 (19 May - 17 June).xlsx";
  }
  if (importBatchId === NGEE_ANN_GOLDEN.period.dataHealth.importBatchIds[1]) {
    return "Ngee Ann Poly Level 6 (19 May - 17 June).xlsx";
  }
  throw new Error(`NGEE_ANN_GOLDEN_IMPORT_BATCH_UNKNOWN:${importBatchId}`);
};

const constantUsage = (total: number, count: number): number[] =>
  new Array<number>(count).fill(total / count);

const allDays = (from: string, to: string) => ({
  monday: [{ from, to }],
  tuesday: [{ from, to }],
  wednesday: [{ from, to }],
  thursday: [{ from, to }],
  friday: [{ from, to }],
  saturday: [{ from, to }],
  sunday: [{ from, to }],
});

const dailyIntervalUsage = (dailyTotals: readonly number[]): number[] =>
  dailyTotals.flatMap((total) => constantUsage(total, 24 * 4));

const factsForLocalDate = (
  meter: GoldenMeter,
  localDate: string,
  dailyUsageKwh: number,
): EnergyIntervalFactWrite[] => {
  const localStartMs = Date.parse(`${localDate}T00:00:00.000Z`);
  const utcStartMs = localStartMs - 8 * 60 * 60_000;
  return Array.from({ length: 24 * 4 }, (_, index) => factFor(
    meter,
    dailyUsageKwh / (24 * 4),
    0,
    utcStartMs + index * 15 * 60_000,
  ));
};

const totalCircuitGolden = (
  scopeId: typeof NGEE_ANN_GOLDEN.period.totalCircuits[number]["scopeId"],
) => {
  const golden = NGEE_ANN_GOLDEN.period.totalCircuits.find((candidate) => candidate.scopeId === scopeId);
  if (!golden) throw new Error(`NGEE_ANN_TOTAL_CIRCUIT_GOLDEN_MISSING:${scopeId}`);
  return golden;
};

const intervalIndex = (day: number, hour: number, quarter: number): number =>
  day * 24 * 4 + hour * 4 + quarter;

const expectedHourlyProfile = (
  profile: readonly (readonly [number, number, number, number])[],
  observationCount: number
) => profile.map(([hour, usageKwh, averageKw, peakKw]) => ({
  hour,
  usageKwh: roundForGolden(usageKwh),
  averageKw: roundForGolden(averageKw),
  peakKw: roundForGolden(peakKw),
  observationCount
}));

const expectedNgeeAnnDailyTotals = (): NonNullable<EnergyScopeAnalysis["dailyTotals"]> => ({
  metricId: "energy.total_usage_kwh@1",
  grain: "day",
  timezone: NGEE_ANN_GOLDEN.timezone,
  scopes: NGEE_ANN_GOLDEN.period.dailyTotals.scopes.map((scope) => ({
    scopeId: scope.scopeId,
    scopeName: scope.scopeName,
    scopeType: scope.scopeType,
    rows: NGEE_ANN_GOLDEN.period.dailyTotals.dateSpine.map((date, index) => ({
      ...date,
      usageKwh: scope.usageKwh[index] ?? null,
      dataHealth: scope.dataHealth,
    })),
  })),
});

const expectedNgeeAnnPeakBreakdown = (): NonNullable<EnergyScopeAnalysis["peakBreakdown"]> => ({
  ...NGEE_ANN_GOLDEN.period.peakBreakdown,
  peak: {
    ...NGEE_ANN_GOLDEN.period.peakBreakdown.peak,
    dataHealth: {
      status: "complete",
      coveragePct: 100,
      expectedMeterIntervalCount: 4,
      validIntervalCount: 4,
      qualityEventCount: 0,
    },
  },
  levels: NGEE_ANN_GOLDEN.period.peakBreakdown.levels.map((level) => ({
    ...level,
    dataHealth: {
      status: "complete",
      coveragePct: 100,
      expectedMeterIntervalCount: 2,
      validIntervalCount: 2,
      qualityEventCount: 0,
    },
    circuits: level.circuits.map((circuit) => ({
      ...circuit,
      includedInOfficialTotal: false as const,
      dataHealth: {
        status: "complete" as const,
        coveragePct: 100,
        expectedMeterIntervalCount: 1,
        validIntervalCount: 1,
        qualityEventCount: 0,
      },
    })),
  })),
});

const cumulativeReading = (
  meterPointId: string,
  sourceLabel: string,
  eventTime: string,
  activeEnergyKwh: number,
  sourceRowNumber: number,
): EnergyNormalizedReadingWrite => ({
  workspaceId: PRESCHOOL_GOLDEN.workspaceId,
  projectId: PRESCHOOL_GOLDEN.projectId,
  importBatchId: "preschool-golden-may-2026",
  resource: "electricity",
  meterPointId,
  scopeId: meterPointId,
  parentNodeId: PRESCHOOL_GOLDEN.centreA.scopeId,
  sourceLabel,
  category: "aircon",
  meterRole: "component",
  eventTime,
  activeEnergyKwh,
  sourceFile: "preschool-golden-may-2026.fixture",
  sourceSha256: "preschool-golden-may-2026",
  sourceRowNumber,
  sourceReadingKind: "cumulative_energy",
});

const roundForGolden = (value: number): number => Math.round((value + Number.EPSILON) * 10_000) / 10_000;
const roundForOracle = (value: number): number => Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;

const removeTemporaryEnergyFixture = (root: string): void => {
  try {
    rmSync(root, { recursive: true, force: true });
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

describe("resolveEnergyReportingHealth", () => {
  const coverage = (overrides: Partial<Parameters<typeof resolveEnergyReportingHealth>[0]> = {}) => ({
    latestReadingAt: "2026-09-24T00:45:00.000Z",
    meters: [
      { meterNodeId: "panel-a-total", lastReadingAt: "2026-09-24T00:45:00.000Z" },
      // One interval behind: Meters report on their own clocks, so this is normal.
      { meterNodeId: "panel-a-meter-04", lastReadingAt: "2026-09-23T23:45:00.000Z" },
      { meterNodeId: "panel-a-lighting", lastReadingAt: "2026-09-23T13:15:00.000Z" },
      { meterNodeId: "panel-b-meter-05", lastReadingAt: "2026-09-23T08:45:00.000Z" },
    ],
    days: [
      { localDate: "2026-09-21", usageKwh: 153.45, observedIntervalCount: 1632 },
      { localDate: "2026-09-22", usageKwh: 157.8, observedIntervalCount: 1632 },
      { localDate: "2026-09-23", usageKwh: 136.46, observedIntervalCount: 1556 },
    ],
    ...overrides,
  });

  it("names a Meter silent past half a day and leaves an ordinary evening alone", () => {
    const health = resolveEnergyReportingHealth(coverage());

    // Sixteen hours behind: the site went on reporting through the night without it.
    expect(health.stoppedMeters).toEqual([
      { meterNodeId: "panel-b-meter-05", lastReadingAt: "2026-09-23T08:45:00.000Z" },
    ]);
  });

  it("names a Meter once its silence outlasts a night, without needing a new rule", () => {
    // The same site a day on: the healthy Meters have gone on reporting, and the
    // two that stopped have not moved, so both are now well past half a day.
    const health = resolveEnergyReportingHealth(coverage({
      latestReadingAt: "2026-09-25T00:45:00.000Z",
      meters: [
        { meterNodeId: "panel-a-total", lastReadingAt: "2026-09-25T00:45:00.000Z" },
        { meterNodeId: "panel-a-meter-04", lastReadingAt: "2026-09-24T23:45:00.000Z" },
        { meterNodeId: "panel-a-lighting", lastReadingAt: "2026-09-23T13:15:00.000Z" },
        { meterNodeId: "panel-b-meter-05", lastReadingAt: "2026-09-23T08:45:00.000Z" },
      ],
    }));

    expect(health.stoppedMeters.map(meter => meter.meterNodeId))
      .toEqual(["panel-b-meter-05", "panel-a-lighting"]);
  });

  it("marks a day short against the fullest day the Project actually reached", () => {
    const health = resolveEnergyReportingHealth(coverage());

    expect(health.shortDays).toEqual([{
      localDate: "2026-09-23",
      usageKwh: 136.46,
      observedIntervalCount: 1556,
      expectedIntervalCount: 1632,
    }]);
    expect(health.latestReadingAt).toBe("2026-09-24T00:45:00.000Z");
  });

  it("calls no day short when every day received the same readings", () => {
    const health = resolveEnergyReportingHealth(coverage({
      days: [
        { localDate: "2026-09-22", usageKwh: 157.8, observedIntervalCount: 1632 },
        { localDate: "2026-09-23", usageKwh: 150.1, observedIntervalCount: 1632 },
      ],
    }));

    expect(health.shortDays).toEqual([]);
  });

  it("reports no stopped Meter when the site has simply had a quiet evening", () => {
    const health = resolveEnergyReportingHealth(coverage({
      meters: [
        { meterNodeId: "panel-a-total", lastReadingAt: "2026-09-24T00:45:00.000Z" },
        // Switched off at the end of the working day: quiet for hours, nothing wrong.
        { meterNodeId: "panel-b-total", lastReadingAt: "2026-09-23T16:30:00.000Z" },
      ],
    }));

    expect(health.stoppedMeters).toEqual([]);
  });
});
