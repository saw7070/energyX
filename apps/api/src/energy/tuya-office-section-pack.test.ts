import { describe, expect, it } from "vitest";

import {
  createOverviewAiArtifactIdentity,
  createTuyaOfficeOverviewAiSectionArtifactIdentity,
} from "./overview-ai-artifact.js";
import type { ProjectAnalysisSnapshot } from "./project-analysis-resolver.js";
import {
  buildTuyaOfficeSectionPrompt,
  materializeTuyaOfficeSectionResult,
} from "./tuya-office-section-interpreter.js";
import {
  assembleTuyaOfficeSectionPacks,
  TUYA_OFFICE_SECTION_IDS,
} from "./tuya-office-section-pack.js";
import { tuyaOfficeAiSurfaceFixture } from "./tuya-office-ai-surface.test-fixture.js";

describe("assembleTuyaOfficeSectionPacks", () => {
  it("projects three Tuya Office decision domains from the exact current Snapshot", () => {
    const packs = assembleTuyaOfficeSectionPacks(snapshot("snapshot-a", 1_240, 18.5));

    expect(Object.keys(packs)).toEqual(TUYA_OFFICE_SECTION_IDS);
    expect(JSON.stringify(packs)).not.toMatch(
      /centre-benchmark|standby-wastage|planning-outlook|trend-and-demand|circuit-concentration/u,
    );
    expect(Object.values(packs).every((pack) => (
      pack.binding.projectId === "tuya-office"
      && pack.binding.dataSnapshotId === "snapshot-a"
      && pack.binding.projectReleaseId === "tuya-release-a"
      && pack.capabilities.tools.length === 0
    ))).toBe(true);
    expect(packs["data-readiness"].facts.meterDataHealth?.summary).toMatchObject({
      total: 20,
      usable: 19,
      insufficientHistory: 1,
    });
    expect(packs["consumption-and-demand"].facts.summary).toMatchObject({
      usageKwh: 1_240,
      peakKw: 18.5,
    });
    expect(packs["meter-contribution-and-operations"].facts.circuits).toHaveLength(3);
    expect(packs["data-readiness"].reportTime).toEqual({
      timezone: "Asia/Singapore",
      policyId: "tuya-office-report-time",
      policyRevision: "2",
      window: {
        windowId: "current-overview",
        role: "primary",
        label: "Current overview",
        phase: "partial",
        from: "2026-07-31T16:00:00.000Z",
        toExclusive: "2026-08-21T16:00:00.000Z",
        fromLocalDate: "2026-08-01",
        toExclusiveLocalDate: "2026-08-22",
        inclusiveToLocalDate: "2026-08-21",
        displayLabel: "1 Aug 2026–21 Aug 2026",
      },
    });
  });

  it("rebuilds all facts from Snapshot B without retaining Snapshot A values", () => {
    const packA = assembleTuyaOfficeSectionPacks(snapshot("snapshot-a", 1_240, 18.5));
    const packB = assembleTuyaOfficeSectionPacks(snapshot("snapshot-b", 1_510, 22.1));

    expect(packB["consumption-and-demand"].binding.dataSnapshotId).toBe("snapshot-b");
    expect(packB["consumption-and-demand"].facts.summary).toMatchObject({
      usageKwh: 1_510,
      peakKw: 22.1,
    });
    expect(JSON.stringify(packB)).not.toContain("snapshot-a");
    expect(packA["consumption-and-demand"].facts.summary.usageKwh).toBe(1_240);
  });

  it("fails closed for another Project sharing the generic Renderer", () => {
    const source = snapshot("snapshot-other", 1_240, 18.5);
    source.context = { ...source.context, projectId: "another-generic-project" };

    expect(() => assembleTuyaOfficeSectionPacks(source))
      .toThrow("ENERGYIQ_TUYA_OFFICE_SECTION_PACK_PROJECT_REQUIRED");
  });

  it("keeps unavailable evidence explicit instead of inventing an operational result", () => {
    const source = snapshot("snapshot-limited", 1_240, 18.5);
    source.analysis.offHours = {
      status: "unavailable",
      reason: {
        code: "OPERATING_CALENDAR_VERSION_MISSING",
        message: "Operating calendar is unavailable.",
      },
    };
    source.analysis.peakBreakdown = {
      status: "unavailable",
      reason: {
        code: "PEAK_INTERVAL_FACTS_UNAVAILABLE",
        message: "Peak interval evidence is unavailable.",
      },
    };

    const packs = assembleTuyaOfficeSectionPacks(source);

    expect(packs["meter-contribution-and-operations"].missingEvidence)
      .toContain("Operating-hours classification is unavailable.");
    expect(packs["consumption-and-demand"].missingEvidence)
      .toContain("Peak-interval contributor evidence is unavailable.");
  });

  it("withholds a period-divided daily average when the Snapshot has partial coverage", () => {
    const source = snapshot("snapshot-partial", 504.8524, 7.3027);
    source.dataQuality = {
      ...source.dataQuality,
      status: "partial",
      coveragePct: 49,
      validIntervalCount: 3_480,
    };
    source.analysis.summary.averageDailyUsageKwh = 24.0406;

    const pack = assembleTuyaOfficeSectionPacks(source)["consumption-and-demand"];

    expect(pack.facts.summary).not.toHaveProperty("averageDailyUsageKwh");
    expect(pack.facts.summary.averageDailyUsage).toEqual({
      status: "unavailable",
      reason: "PARTIAL_PERIOD_COVERAGE",
      coveragePct: 49,
    });
  });

  it("keeps readiness and operations numbers inside their real typed Pack boundaries", () => {
    const packs = assembleTuyaOfficeSectionPacks(snapshot("snapshot-a", 1_240, 18.5));
    const baseIdentity = createOverviewAiArtifactIdentity({
      workspaceId: "tuya-office",
      projectId: "tuya-office",
      scopeId: "tuya-office-project",
      dataSnapshotId: "snapshot-a",
      projectReleaseId: "tuya-release-a",
      analysisPeriodFrom: "2026-07-31T16:00:00.000Z",
      analysisPeriodTo: "2026-08-21T16:00:00.000Z",
      rendererKey: "tuya-office-overview",
      rendererVersion: "1",
      modelProfileId: "workspace-default-model-profile",
      modelProfileRevision: 8,
      reportTimeIdentity: {
        reportTimePolicyId: "tuya-office-report-time",
        reportTimePolicyRevision: "2",
        reportTimeContextFingerprint: "sha256:tuya-office-current-overview",
      },
    });
    const readiness = packs["data-readiness"];
    const operations = packs["meter-contribution-and-operations"];

    expect(buildTuyaOfficeSectionPrompt(readiness)).toContain('"insufficientHistory":1');
    expect(buildTuyaOfficeSectionPrompt(operations)).toContain('"ratioPct":95.97');

    const readinessResult = materializeTuyaOfficeSectionResult({
      answer: JSON.stringify({
        sectionId: "data-readiness",
        status: "available",
        summary: {
          text: "Of 20 published Meters, 19 are usable and 1 has insufficient history.",
          evidenceRefs: ["evidence:snapshot-a:meters"],
          claimRefs: [
            "fact:meterDataHealth.summary.total",
            "fact:meterDataHealth.summary.usable",
            "fact:meterDataHealth.summary.insufficientHistory",
          ],
        },
        candidates: [],
      }),
      pack: readiness,
      identity: createTuyaOfficeOverviewAiSectionArtifactIdentity({
        baseIdentity,
        targetId: "data-readiness",
        unit: tuyaOfficeAiSurfaceFixture().sections.find(({ id }) => id === "data-readiness")!,
      }),
      runId: "run:tuya:readiness",
    });
    const operationsResult = materializeTuyaOfficeSectionResult({
      answer: JSON.stringify({
        sectionId: "meter-contribution-and-operations",
        status: "available",
        summary: {
          text: "Component Meters represent 1190 kWh, or 95.97% of the official 1240 kWh total; standby is 200 kWh (16.13%).",
          evidenceRefs: ["evidence:snapshot-a:meters"],
          claimRefs: [
            "fact:componentReconciliation.componentUsageKwh",
            "fact:componentReconciliation.ratioPct",
            "fact:componentReconciliation.officialUsageKwh",
            "fact:offHours.standbyKwh",
            "fact:offHours.sharePct",
          ],
        },
        candidates: [],
      }),
      pack: operations,
      identity: createTuyaOfficeOverviewAiSectionArtifactIdentity({
        baseIdentity,
        targetId: "meter-contribution-and-operations",
        unit: tuyaOfficeAiSurfaceFixture().sections.find(({ id }) => id === "meter-contribution-and-operations")!,
      }),
      runId: "run:tuya:operations",
    });

    expect(readinessResult).toMatchObject({ status: "available", sectionId: "data-readiness" });
    expect(operationsResult).toMatchObject({
      status: "available",
      sectionId: "meter-contribution-and-operations",
    });
  });
});

const snapshot = (
  dataSnapshotId: string,
  usageKwh: number,
  peakKw: number,
): ProjectAnalysisSnapshot => ({
  context: {
    workspaceId: "tuya-office",
    projectId: "tuya-office",
    scopeId: "tuya-office-project",
    primaryPeriod: {
      start: "2026-07-31T16:00:00.000Z",
      endExclusive: "2026-08-21T16:00:00.000Z",
    },
    timezone: "Asia/Singapore",
  } as ProjectAnalysisSnapshot["context"],
  projectRelease: { id: "tuya-release-a" } as ProjectAnalysisSnapshot["projectRelease"],
  recipe: { id: "energy-scope-analysis", version: "1" },
  renderer: {
    key: "tuya-office-overview",
    version: "1",
    contractVersion: "project-analysis-snapshot@1",
  },
  dataQuality: {
    status: "complete",
    coveragePct: 100,
    expectedMeterIntervalCount: 2_016,
    validIntervalCount: 2_016,
    qualityEventCount: 0,
    cumulativeDeltaMismatchCount: 0,
    averageKwMismatchCount: 0,
    invalidIntervalDurationCount: 0,
    importBatchIds: ["tuya-batch-a"],
  },
  meterDataHealth: {
    summary: { total: 20, usable: 19, insufficientHistory: 1, noReadings: 0 },
    meters: [],
  },
  evidence: [
    {
      id: `evidence:${dataSnapshotId}:summary`,
      metricId: "energy.total_usage_kwh@1",
      queryIds: ["scope_summary_v1"],
    },
    {
      id: `evidence:${dataSnapshotId}:meters`,
      metricId: "energy.total_usage_kwh@1",
      queryIds: ["meter_breakdown_v1"],
    },
  ],
  findings: [],
  dataSnapshot: {
    id: dataSnapshotId,
    importBatchIds: ["tuya-batch-a"],
    lastSeenAt: "2026-08-21T15:45:00.000Z",
    sourceCoverage: { fromLocalDate: "2026-08-01", throughLocalDate: "2026-08-21" },
  },
  reportTimeContext: {
    contractRevision: "energyiq-report-time-context@1",
    binding: {
      workspaceId: "tuya-office",
      projectId: "tuya-office",
      scopeId: "tuya-office-project",
      resource: "electricity",
      dataSnapshotId,
      projectReleaseId: "tuya-release-a",
    },
    timezone: "Asia/Singapore",
    asOf: "2026-08-21T16:00:00.000Z",
    acceptedDataEndExclusive: "2026-08-21T16:00:00.000Z",
    dataThroughLocalDate: "2026-08-21",
    lastRefreshedAt: "2026-08-21T16:00:00.000Z",
    policyId: "tuya-office-report-time",
    policyRevision: "2",
    windows: [{
      windowId: "current-overview",
      role: "primary",
      label: "Current overview",
      strategy: { kind: "calendar_month_to_date" },
      phase: "partial",
      from: "2026-07-31T16:00:00.000Z",
      toExclusive: "2026-08-21T16:00:00.000Z",
      completeDayCount: 21,
      segments: [{
        from: "2026-07-31T16:00:00.000Z",
        toExclusive: "2026-08-21T16:00:00.000Z",
      }],
      comparisonCompatibilityKey: "current-overview",
    }],
  },
  metadata: {
    status: "missing",
    hierarchyRevisionId: "tuya-hierarchy-v1",
    timezone: "Asia/Singapore",
    period: {
      start: "2026-07-31T16:00:00.000Z",
      endExclusive: "2026-08-21T16:00:00.000Z",
    },
  } as ProjectAnalysisSnapshot["metadata"],
  analysis: {
    context: {} as never,
    latestAcceptedReading: {
      status: "not_applicable",
      queryId: "latest_accepted_reading_v1",
      reason: { code: "INTERVAL_USAGE_SOURCE", message: "Interval source" },
    },
    summary: {
      usageKwh,
      averageDailyUsageKwh: usageKwh / 21,
      peakKw,
      peakAt: "2026-08-14T07:30:00.000Z",
      validIntervalCount: 2_016,
      qualityEventCount: 0,
    },
    hourlyProfile: [],
    dailyTotals: {
      metricId: "energy.total_usage_kwh@1",
      grain: "day",
      timezone: "Asia/Singapore",
      scopes: [],
    },
    timeBehaviour: {
      metricId: "energy.total_usage_kwh@1",
      grain: "hour",
      unit: "kWh",
      timezone: "Asia/Singapore",
      queryId: "time_bucket_grid_v1",
      scopes: [],
      dayProfiles: [],
    },
    componentHourlyProfiles: {
      metricId: "energy.total_usage_kwh@1",
      queryId: "component_hourly_profiles_v1",
      accountingBasis: "published_component_circuits",
      grain: "hour",
      unit: "kWh",
      timezone: "Asia/Singapore",
      scopes: [],
    },
    comparison: {
      from: "2026-07-10T16:00:00.000Z",
      to: "2026-07-31T16:00:00.000Z",
      usageKwh: usageKwh - 100,
      changeKwh: 100,
      changePct: 8.77,
    },
    categories: [],
    childScopes: [],
    circuits: Array.from({ length: 3 }, (_, index) => circuit(index)),
    topCircuits: [circuit(0)],
    designatedTotals: [],
    componentReconciliation: {
      officialUsageKwh: usageKwh,
      componentUsageKwh: usageKwh - 50,
      gapKwh: 50,
      ratioPct: 95.97,
      officialMeterNodeIds: ["panel-a-total", "panel-b-total"],
      componentMeterNodeIds: ["panel-c-meter-01"],
    },
    virtualMeters: [],
    virtualMeterTraces: [],
    offHours: {
      status: "available",
      operatingKwh: usageKwh - 200,
      standbyKwh: 200,
      usageKwh,
      sharePct: 16.13,
      timezone: "Asia/Singapore",
      businessCalendarVersion: "tuya-calendar-v1",
    },
    cost: {
      status: "available",
      amount: usageKwh * 0.3,
      currency: "SGD",
      tariffScheduleVersion: "tuya-tariff-v1",
      allocations: [],
    },
    dataHealth: {
      status: "complete",
      coveragePct: 100,
      expectedMeterIntervalCount: 2_016,
      validIntervalCount: 2_016,
      qualityEventCount: 0,
      cumulativeDeltaMismatchCount: 0,
      averageKwMismatchCount: 0,
      invalidIntervalDurationCount: 0,
      importBatchIds: ["tuya-batch-a"],
    },
    units: { usage: "kWh", demand: "kW", intervalMinutes: 15, timezone: "Asia/Singapore" },
    attention: [],
    provenance: {
      dataSnapshotId,
      hierarchyRevisionId: "tuya-hierarchy-v1",
      meterMappingRevisionId: "tuya-mapping-v1",
      meterFormulaRevisionId: "tuya-formula-v1",
      metricVersion: "tuya-metrics-v1",
      ruleRevisionIds: [],
      aggregationRule: "designated_total",
      sourceView: "facts",
      queryIds: ["scope_summary_v1", "meter_breakdown_v1"],
    },
    metadata: {} as never,
  },
});

const circuit = (index: number) => ({
  meterNodeId: `panel-meter-${index + 1}`,
  scopeId: `tuya-office-db${index + 1}`,
  name: `Panel Meter ${index + 1}`,
  appliance: "Load",
  category: "load",
  meterRole: "component",
  includedInOfficialTotal: false,
  usageKwh: 100 + index,
  sharePct: 8,
  comparison: { usageKwh: 90, changeKwh: 10 + index, changePct: 10 },
  dataHealth: {
    coveragePct: 100,
    expectedMeterIntervalCount: 1,
    validIntervalCount: 1,
    qualityEventCount: 0,
  },
  peakKw: 3,
  qualityEventCount: 0,
});
