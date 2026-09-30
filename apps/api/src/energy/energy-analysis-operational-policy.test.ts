import {
  ensureEnergyScopedDataSource,
  LocalDataGateway,
  type EnergyIntervalFactWrite,
} from "@datafoundry/data-gateway";
import {
  createMetadataStore,
  energyIqPublishedMeterRoutingRevisionId,
  type EnergyIqMeterMappingDraft,
  type EnergyIqRuleRevisionRecord,
} from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { executeEnergyScopeAnalysis } from "./energy-analysis.js";
import type { EnergyQueryContext } from "./energy-query-context.js";
import { materializeTestProjectSnapshot } from "./energy-test-materialization.js";

describe("EnergyScopeAnalysis operational policy", () => {
  it("uses complete Release-pinned Tariff and Calendar versions for cost and standby facts", async () => {
    const fixture = await createOperationalFixture();
    try {
      publishPolicyV1(fixture.metadata);
      const analysis = await executeEnergyScopeAnalysis({
        metadataStore: fixture.metadata,
        dataGateway: fixture.gateway,
        userId: "dev-user",
        context: policyContext("tariff-v1", "calendar-v1", fixture.dataSnapshotId),
        databasePath: fixture.databasePath,
        includeTimeBehaviour: false,
        ruleRevisions: [offHoursRule],
      });

      expect(analysis.summary).toMatchObject({
        usageKwh: 10,
        nonOperatingKwh: 7,
        nonOperatingSharePct: 70,
      });
      expect(analysis.cost).toEqual({
        status: "available",
        amount: 2.2,
        currency: "SGD",
        tariffScheduleVersion: "tariff-v1",
        allocations: [
          {
            from: "2026-06-30T16:00:00.000Z",
            to: "2026-07-01T00:00:00.000Z",
            ratePerKwh: 0.1,
            usageKwh: 4,
            cost: 0.4,
          },
          {
            from: "2026-07-01T00:00:00.000Z",
            to: "2026-07-01T16:00:00.000Z",
            ratePerKwh: 0.3,
            usageKwh: 6,
            cost: 1.8,
          },
        ],
      });
      expect(analysis.offHours).toEqual({
        status: "available",
        operatingKwh: 3,
        standbyKwh: 7,
        usageKwh: 7,
        sharePct: 70,
        timezone: "Asia/Singapore",
        businessCalendarVersion: "calendar-v1",
      });
      expect(analysis.circuits).toEqual([
        expect.objectContaining({ meterNodeId: "meter-1", nonOperatingKwh: 7 }),
      ]);
      expect(analysis.attention).toEqual([
        expect.objectContaining({
          code: "NON_OPERATING_SHARE",
          title: "70.0% of usage occurred outside operating hours",
        }),
      ]);
    } finally {
      fixture.close();
    }
  });

  it("does not expose a raw operating flag as a competing truth for Release-pinned Calendar results", async () => {
    const fixture = await createOperationalFixture();
    try {
      publishPolicyV1(fixture.metadata);
      const context = policyContext("tariff-v1", "calendar-v1", fixture.dataSnapshotId);
      const analysis = await executeEnergyScopeAnalysis({
        metadataStore: fixture.metadata,
        dataGateway: fixture.gateway,
        userId: "dev-user",
        context,
        databasePath: fixture.databasePath,
        includeTimeBehaviour: false,
        includeMeterOperationalBreakdown: false,
        ruleRevisions: [offHoursRule],
      });
      const scoped = await ensureEnergyScopedDataSource({
        metadataStore: fixture.metadata,
        userId: "dev-user",
        databasePath: fixture.databasePath,
        context: {
          workspaceId: context.workspaceId,
          projectId: context.projectId,
          scopeId: context.scopeId,
          meterAttachments: [{
            meterPointId: "meter-1",
            scopeId: "policy-circuit-1",
            officialAggregation: true,
          }],
          resource: context.resource,
          from: context.from,
          to: context.to,
          timezone: context.timezone,
          hierarchyRevisionId: context.hierarchyRevisionId,
          meterMappingRevisionId: context.meterMappingRevisionId,
          meterFormulaRevisionId: context.meterFormulaRevisionId,
          dataSnapshotId: context.dataSnapshotId,
          metricVersion: context.metricVersion,
        },
      });

      expect(analysis.offHours).toMatchObject({
        status: "available",
        operatingKwh: 3,
        standbyKwh: 7,
        businessCalendarVersion: "calendar-v1",
      });
      await expect(fixture.gateway.runSqlReadonly({
        user_id: "dev-user",
        workspace_id: context.workspaceId,
        datasource_id: scoped.datasourceId,
        sql: `
          SELECT
            SUM(CASE WHEN is_operating THEN usage_kwh ELSE 0 END) AS operating_kwh,
            SUM(CASE WHEN NOT is_operating THEN usage_kwh ELSE 0 END) AS standby_kwh
          FROM ${scoped.viewName}
        `,
      })).rejects.toThrow(/is_operating/i);
    } finally {
      fixture.close();
    }
  });

  it("omits the optional meter-level operating breakdown when the caller will not consume it", async () => {
    const fixture = await createOperationalFixture();
    try {
      publishPolicyV1(fixture.metadata);
      const runSqlReadonly = vi.spyOn(fixture.gateway, "runSqlReadonly");

      const analysis = await executeEnergyScopeAnalysis({
        metadataStore: fixture.metadata,
        dataGateway: fixture.gateway,
        userId: "dev-user",
        context: policyContext("tariff-v1", "calendar-v1", fixture.dataSnapshotId),
        databasePath: fixture.databasePath,
        includeTimeBehaviour: false,
        ruleRevisions: [offHoursRule],
        includeMeterOperationalBreakdown: false,
      });

      expect(runSqlReadonly.mock.calls.some(([request]) => (
        request.sql.includes("'meter' AS series_kind")
      ))).toBe(false);
      expect(analysis.summary).toMatchObject({
        usageKwh: 10,
        nonOperatingKwh: 7,
        nonOperatingSharePct: 70,
      });
      expect(analysis.offHours).toMatchObject({
        status: "available",
        operatingKwh: 3,
        standbyKwh: 7,
      });
      expect(analysis.circuits[0]).not.toHaveProperty("nonOperatingKwh");
      expect(analysis.attention).toContainEqual(expect.objectContaining({
        code: "NON_OPERATING_SHARE",
        evidence: "7 kWh occurred outside operating hours.",
      }));
      expect(analysis.provenance.queryIds).not.toContain("operational_policy_meter_intervals_v1");
    } finally {
      vi.restoreAllMocks();
      fixture.close();
    }
  });

  it("keeps Explorer scope policy facts without requiring the skipped meter breakdown", async () => {
    const fixture = await createOperationalFixture();
    try {
      publishPolicyV1(fixture.metadata);
      const analysis = await executeEnergyScopeAnalysis({
        metadataStore: fixture.metadata,
        dataGateway: fixture.gateway,
        userId: "dev-user",
        context: policyContext("tariff-v1", "calendar-v1", fixture.dataSnapshotId),
        databasePath: fixture.databasePath,
        ruleRevisions: [offHoursRule],
        profile: "explorer",
      });

      expect(analysis.offHours).toMatchObject({
        status: "available",
        operatingKwh: 3,
        standbyKwh: 7,
      });
      expect(analysis.circuits[0]).not.toHaveProperty("nonOperatingKwh");
      expect(analysis.provenance.queryIds).not.toContain("operational_policy_meter_intervals_v1");
    } finally {
      fixture.close();
    }
  });

  it("returns explicit unavailable policy results and suppresses legacy off-hours findings", async () => {
    const fixture = await createOperationalFixture();
    try {
      const analysis = await executeEnergyScopeAnalysis({
        metadataStore: fixture.metadata,
        dataGateway: fixture.gateway,
        userId: "dev-user",
        context: policyContext("missing-tariff", "missing-calendar", fixture.dataSnapshotId),
        databasePath: fixture.databasePath,
        includeTimeBehaviour: false,
        ruleRevisions: [offHoursRule],
      });

      expect(analysis.cost).toEqual({
        status: "unavailable",
        reason: {
          code: "TARIFF_VERSION_NOT_FOUND",
          message: "Tariff schedule missing-tariff is not published for this Project.",
        },
        tariffScheduleVersion: "missing-tariff",
      });
      expect(analysis.offHours).toEqual({
        status: "unavailable",
        reason: {
          code: "OPERATING_CALENDAR_VERSION_NOT_FOUND",
          message: "Operating calendar missing-calendar is not published for this Project.",
        },
        businessCalendarVersion: "missing-calendar",
      });
      expect(analysis.summary).not.toHaveProperty("nonOperatingKwh");
      expect(analysis.summary).not.toHaveProperty("nonOperatingSharePct");
      expect(analysis.circuits[0]).not.toHaveProperty("nonOperatingKwh");
      expect(analysis.attention.some((finding) => finding.code === "NON_OPERATING_SHARE")).toBe(false);
    } finally {
      fixture.close();
    }
  });

  it("fails explicitly when a valid meter policy series is missing", async () => {
    const fixture = await createOperationalFixture();
    try {
      publishPolicyV1(fixture.metadata);
      const runSqlReadonly = fixture.gateway.runSqlReadonly.bind(fixture.gateway);
      vi.spyOn(fixture.gateway, "runSqlReadonly").mockImplementation(async (input) => {
        const result = await runSqlReadonly(input);
        return input.sql.includes("'meter' AS series_kind")
          ? { ...result, rows: [], row_count: 0 }
          : result;
      });

      await expect(executeEnergyScopeAnalysis({
        metadataStore: fixture.metadata,
        dataGateway: fixture.gateway,
        userId: "dev-user",
        context: policyContext("tariff-v1", "calendar-v1", fixture.dataSnapshotId),
        databasePath: fixture.databasePath,
        includeTimeBehaviour: false,
        ruleRevisions: [],
      })).rejects.toThrow(
        "ENERGYIQ_OPERATIONAL_POLICY_METER_INTERVALS_INCOMPLETE:meter-1",
      );
    } finally {
      vi.restoreAllMocks();
      fixture.close();
    }
  });

  it("keeps a serialized historical result unchanged after Admin activates new versions", async () => {
    const fixture = await createOperationalFixture();
    try {
      publishPolicyV1(fixture.metadata);
      const historical = await executeEnergyScopeAnalysis({
        metadataStore: fixture.metadata,
        dataGateway: fixture.gateway,
        userId: "dev-user",
        context: policyContext("tariff-v1", "calendar-v1", fixture.dataSnapshotId),
        databasePath: fixture.databasePath,
        includeTimeBehaviour: false,
        ruleRevisions: [],
      });
      const serializedHistorical = JSON.stringify(historical);

      publishPolicyV2(fixture.metadata);
      const stillPinned = await executeEnergyScopeAnalysis({
        metadataStore: fixture.metadata,
        dataGateway: fixture.gateway,
        userId: "dev-user",
        context: policyContext("tariff-v1", "calendar-v1", fixture.dataSnapshotId),
        databasePath: fixture.databasePath,
        includeTimeBehaviour: false,
        ruleRevisions: [],
      });
      const latest = await executeEnergyScopeAnalysis({
        metadataStore: fixture.metadata,
        dataGateway: fixture.gateway,
        userId: "dev-user",
        context: policyContext("tariff-v2", "calendar-v2", fixture.dataSnapshotId),
        databasePath: fixture.databasePath,
        includeTimeBehaviour: false,
        ruleRevisions: [],
      });

      expect(JSON.stringify(stillPinned)).toBe(serializedHistorical);
      expect(latest.cost).toMatchObject({
        status: "available",
        amount: 5,
        tariffScheduleVersion: "tariff-v2",
      });
      expect(latest.offHours).toMatchObject({
        status: "available",
        operatingKwh: 10,
        standbyKwh: 0,
        businessCalendarVersion: "calendar-v2",
      });
      expect(JSON.stringify(latest)).not.toBe(serializedHistorical);
    } finally {
      fixture.close();
    }
  });
});

const POLICY_MAPPING: EnergyIqMeterMappingDraft = {
  schema_version: 2,
  source_kind: "excel",
  confirmed: true,
  rows: [{
    id: "meter-1",
    source_label: "Meter 1",
    scope_id: "policy-circuit-1",
    navigation_scope_id: "policy-circuit-1",
    display_name: "Meter 1",
    resource: "electricity",
    category: "overall",
    coverage: "whole",
    meter_role: "total",
    aggregation_usage: "official",
  }],
  official_aggregation_routes: [
    { scope_id: "policy-circuit-1", resource: "electricity", category: "overall", meter_point_ids: ["meter-1"] },
    { scope_id: "project", resource: "electricity", category: "overall", meter_point_ids: ["meter-1"] },
  ],
};

const createOperationalFixture = async () => {
  const root = mkdtempSync(join(tmpdir(), "energy-analysis-policy-"));
  const databasePath = join(root, "energy.duckdb");
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  const gateway = new LocalDataGateway(metadata);
  metadata.workspaces.upsert({
    id: "workspace-policy",
    owner_user_id: "dev-user",
    name: "Operational Policy Workspace",
    kind: "customer",
  });
  metadata.energyIq.projectSetup.bootstrapPublished({
    project: {
      id: "project-policy",
      workspace_id: "workspace-policy",
      name: "Operational Policy Project",
      timezone: "Asia/Singapore",
      hierarchy_revision_id: "hierarchy-v1",
      meter_formula_revision_id: "meter-formula-v1",
      data_snapshot_id: "snapshot-v1",
      metric_version: "metric-v1",
      business_calendar_version: "calendar-v1",
      tariff_schedule_version: "tariff-v1",
      root_scope_id: "project-policy-root",
    },
    document: {
      project: { name: "Operational Policy Project", timezone: "Asia/Singapore" },
      tier_structure_locked: true,
      tiers: [{ id: "policy-tier-circuit", ordinal: 1, alias: "Circuit" }],
      nodes: [{
        id: "policy-circuit-1",
        tier_definition_id: "policy-tier-circuit",
        name: "Meter 1",
        sort_order: 1,
        metadata_status: "confirmed",
      }],
      meter_mapping: POLICY_MAPPING,
    },
    published_by: "dev-user",
  });
  const intervals: EnergyIntervalFactWrite[] = [
    fact("2026-06-30T16:00:00.000Z", "2026-06-30T20:00:00.000Z", 4),
    fact("2026-07-01T00:00:00.000Z", "2026-07-01T04:00:00.000Z", 6),
  ];
  const snapshot = await materializeTestProjectSnapshot({
    metadataStore: metadata,
    databasePath,
    workspaceId: "workspace-policy",
    projectId: "project-policy",
    timezone: "Asia/Singapore",
    batches: [{
      importBatchId: "policy-fixture",
      sourceSha256: "policy-fixture-sha",
      rawReadings: [],
      normalizedReadings: [],
      intervalFacts: intervals,
      qualityEvents: [],
    }],
  });
  return {
    metadata,
    gateway,
    databasePath,
    dataSnapshotId: snapshot.id,
    close: () => {
      metadata.close();
      try {
        rmSync(root, { recursive: true, force: true });
      } catch (error) {
        if (
          process.platform !== "win32"
          || !(error instanceof Error)
          || !("code" in error)
          || (error.code !== "EPERM" && error.code !== "EBUSY")
        ) {
          throw error;
        }
      }
    },
  };
};

const fact = (
  intervalStart: string,
  intervalEnd: string,
  usageKwh: number,
): EnergyIntervalFactWrite => ({
  workspaceId: "workspace-policy",
  projectId: "project-policy",
  importBatchId: "policy-fixture",
  resource: "electricity",
  meterPointId: "meter-1",
  scopeId: "policy-circuit-1",
  parentNodeId: "project-policy-root",
  sourceLabel: "Meter 1",
  category: "overall",
  meterRole: "total",
  intervalStart,
  intervalEnd,
  elapsedMinutes: (Date.parse(intervalEnd) - Date.parse(intervalStart)) / 60_000,
  activeEnergyKwh: 1_000 + usageKwh,
  previousActiveEnergyKwh: 1_000,
  rawDeltaKwh: usageKwh,
  usageKwh,
  averageKw: usageKwh / ((Date.parse(intervalEnd) - Date.parse(intervalStart)) / 3_600_000),
  qualityStatus: "ok",
  localDate: "2026-07-01",
  localHour: new Date(intervalStart).getUTCHours() + 8,
  dayType: "weekday",
  isOperating: true,
  sourceFile: "policy-fixture.csv",
  sourceSha256: "policy-fixture-sha",
  sourceReadingKind: "interval_usage",
});

const policyContext = (
  tariffScheduleVersion: string,
  businessCalendarVersion: string,
  dataSnapshotId: string,
): EnergyQueryContext => ({
  userId: "dev-user",
  workspaceId: "workspace-policy",
  projectId: "project-policy",
  projectName: "Operational Policy Project",
  scopeId: "project-policy-root",
  scopeName: "Operational Policy Project",
  scopeType: "project",
  resource: "electricity",
  timezone: "Asia/Singapore",
  from: "2026-06-30T16:00:00.000Z",
  to: "2026-07-01T16:00:00.000Z",
  endExclusive: true,
  period: "Custom",
  hierarchyRevisionId: "hierarchy-v1",
  meterMappingRevisionId: energyIqPublishedMeterRoutingRevisionId(POLICY_MAPPING),
  meterFormulaRevisionId: "meter-formula-v1",
  dataSnapshotId,
  metricVersion: "metric-v1",
  businessCalendarVersion,
  tariffScheduleVersion,
  resolvedAt: "2026-08-04T00:00:00.000Z",
});

const publishPolicyV1 = (metadata: ReturnType<typeof createMetadataStore>): void => {
  metadata.energyIq.operationalPolicy.publishTariffSchedule({
    version_id: "tariff-v1",
    project_id: "project-policy",
    published_by: "dev-user",
    activate: true,
    entries: [
      {
        id: "tariff-v1-off-peak",
        owner: { kind: "project" },
        effective_from: "2026-06-30T16:00:00.000Z",
        effective_to: "2026-07-01T00:00:00.000Z",
        currency: "SGD",
        rate_per_kwh: 0.1,
      },
      {
        id: "tariff-v1-day",
        owner: { kind: "project" },
        effective_from: "2026-07-01T00:00:00.000Z",
        effective_to: "2026-07-01T16:00:00.000Z",
        currency: "SGD",
        rate_per_kwh: 0.3,
      },
    ],
  });
  metadata.energyIq.operationalPolicy.publishOperatingCalendar({
    version_id: "calendar-v1",
    project_id: "project-policy",
    published_by: "dev-user",
    activate: true,
    entries: [{
      id: "calendar-v1-hours",
      owner: { kind: "project" },
      effective_from: "2026-07-01",
      effective_to: "2026-07-02",
      weekly: allDays("08:00", "10:00"),
    }],
  });
};

const publishPolicyV2 = (metadata: ReturnType<typeof createMetadataStore>): void => {
  metadata.energyIq.operationalPolicy.publishTariffSchedule({
    version_id: "tariff-v2",
    project_id: "project-policy",
    published_by: "dev-user",
    activate: true,
    entries: [{
      id: "tariff-v2-flat",
      owner: { kind: "project" },
      effective_from: "2026-06-30T16:00:00.000Z",
      effective_to: "2026-07-01T16:00:00.000Z",
      currency: "SGD",
      rate_per_kwh: 0.5,
    }],
  });
  metadata.energyIq.operationalPolicy.publishOperatingCalendar({
    version_id: "calendar-v2",
    project_id: "project-policy",
    published_by: "dev-user",
    activate: true,
    entries: [{
      id: "calendar-v2-hours",
      owner: { kind: "project" },
      effective_from: "2026-07-01",
      effective_to: "2026-07-02",
      weekly: allDays("00:00", "24:00"),
    }],
  });
};

const allDays = (from: string, to: string) => ({
  monday: [{ from, to }],
  tuesday: [{ from, to }],
  wednesday: [{ from, to }],
  thursday: [{ from, to }],
  friday: [{ from, to }],
  saturday: [{ from, to }],
  sunday: [{ from, to }],
});

const offHoursRule: EnergyIqRuleRevisionRecord = {
  revision_id: "time.high_off_hours_share@policy-test",
  rule_id: "time.high_off_hours_share",
  version: 1,
  display_name: "High off-hours share",
  description: "Test rule",
  family: "time",
  severity: "warning",
  evaluation_key: "NON_OPERATING_SHARE",
  metric_revision_ids: [],
  parameters: { share_pct: 10 },
  requirement: "operating_hours",
  created_at: "2026-08-04T00:00:00.000Z",
};
