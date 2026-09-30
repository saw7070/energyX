import {
  LocalDataGateway,
  type EnergyIntervalFactWrite,
} from "@datafoundry/data-gateway";
import {
  createMetadataStore,
  energyIqPublishedMeterRoutingRevisionId,
  type EnergyIqMeterMappingDraft,
} from "@datafoundry/metadata";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { describe, expect, it, vi } from "vitest";

import type { EnergyQueryContext } from "./energy-query-context.js";
import { materializeTestProjectSnapshot } from "./energy-test-materialization.js";
import {
  loadSchoolHolidayFactProjection,
  materializeSchoolHolidayFactProjection,
} from "./school-holiday-fact-projection.js";

describe("materializeSchoolHolidayFactProjection", () => {
  it("keeps official totals separate from overlapping driver facts", () => {
    const result = materializeSchoolHolidayFactProjection({
      rows: [
        row("official-a", "level-6", "official_total", 10),
        row("component-a", "level-6", "driver_only", 8),
      ],
      officialMeterNodeIds: ["official-a"],
      period: { from: "2026-06-15", toExclusive: "2026-06-16" },
      dataSnapshotId: "snapshot-a",
    });

    expect(result.status).toBe("available");
    if (result.status !== "available") throw new Error("Expected available facts");
    expect(result.facts.filter(({ accountingRole }) => accountingRole === "official_total")).toHaveLength(24);
    expect(result.facts.filter(({ accountingRole }) => accountingRole === "driver_only")).toHaveLength(24);
    expect(result.facts[0]?.evidenceRef).toContain("snapshot-a");
  });

  it("returns partial rather than publishing a 120-day comparison from one complete day", () => {
    const result = materializeSchoolHolidayFactProjection({
      rows: [row("official-a", "level-6", "official_total", 10)],
      officialMeterNodeIds: ["official-a"],
      period: { from: "2026-02-17", toExclusive: "2026-06-17" },
      dataSnapshotId: "snapshot-a",
    });

    expect(result).toMatchObject({
      status: "partial",
      quality: {
        expectedDayCount: 120,
        completeDayCount: 1,
        coveragePct: expect.closeTo(0.833333, 5),
      },
    });
  });

  it("rejects an accounting role that disagrees with the published official route", () => {
    expect(materializeSchoolHolidayFactProjection({
      rows: [row("official-a", "level-6", "driver_only", 10)],
      officialMeterNodeIds: ["official-a"],
      period: { from: "2026-06-15", toExclusive: "2026-06-16" },
      dataSnapshotId: "snapshot-a",
    })).toMatchObject({
      status: "unavailable",
      reason: { code: "FACT_ROWS_INVALID" },
    });
  });

  it("loads one real 120-day DuckDB projection with one bounded SQL request", async () => {
    const fixture = await createSqlFixture();
    try {
      const runSqlReadonly = vi.spyOn(fixture.gateway, "runSqlReadonly");
      const startedAt = performance.now();
      const result = await loadSchoolHolidayFactProjection({
        metadataStore: fixture.metadata,
        dataGateway: fixture.gateway,
        userId: "dev-user",
        context: fixture.context,
        localPeriod: { from: "2026-02-17", toExclusive: "2026-06-17" },
        databasePath: fixture.databasePath,
      });
      const elapsedMs = performance.now() - startedAt;

      expect(result).toMatchObject({
        status: "available",
        quality: {
          expectedDayCount: 120,
          completeDayCount: 120,
          coveragePct: 100,
        },
      });
      expect(runSqlReadonly).toHaveBeenCalledTimes(1);
      expect(runSqlReadonly.mock.calls[0]?.[0]).not.toHaveProperty("timeout_ms");
      expect(elapsedMs).toBeLessThan(5_000);
    } finally {
      vi.restoreAllMocks();
      fixture.close();
    }
  });
});

const HOLIDAY_MAPPING: EnergyIqMeterMappingDraft = {
  schema_version: 2,
  source_kind: "excel",
  confirmed: true,
  rows: [{
    id: "holiday-meter-1",
    source_label: "Holiday Meter 1",
    scope_id: "holiday-circuit-1",
    navigation_scope_id: "holiday-circuit-1",
    display_name: "Holiday Meter 1",
    resource: "electricity",
    category: "overall",
    coverage: "whole",
    meter_role: "total",
    aggregation_usage: "official",
  }],
  official_aggregation_routes: [
    {
      scope_id: "holiday-circuit-1",
      resource: "electricity",
      category: "overall",
      meter_point_ids: ["holiday-meter-1"],
    },
    {
      scope_id: "project",
      resource: "electricity",
      category: "overall",
      meter_point_ids: ["holiday-meter-1"],
    },
  ],
};

const createSqlFixture = async () => {
  const root = mkdtempSync(join(tmpdir(), "school-holiday-fact-sql-"));
  const databasePath = join(root, "energy.duckdb");
  const metadata = createMetadataStore({ database_path: join(root, "metadata.sqlite") });
  const gateway = new LocalDataGateway(metadata);
  metadata.workspaces.upsert({
    id: "holiday-workspace",
    owner_user_id: "dev-user",
    name: "Holiday SQL Workspace",
    kind: "customer",
  });
  metadata.energyIq.projectSetup.bootstrapPublished({
    project: {
      id: "holiday-project",
      workspace_id: "holiday-workspace",
      name: "Holiday SQL Project",
      timezone: "Asia/Singapore",
      hierarchy_revision_id: "holiday-hierarchy-v1",
      meter_formula_revision_id: "holiday-formula-v1",
      data_snapshot_id: "holiday-snapshot-placeholder",
      metric_version: "holiday-metric-v1",
      business_calendar_version: "holiday-calendar-v1",
      tariff_schedule_version: "holiday-tariff-v1",
      root_scope_id: "holiday-project-root",
    },
    document: {
      project: { name: "Holiday SQL Project", timezone: "Asia/Singapore" },
      tier_structure_locked: true,
      tiers: [{ id: "holiday-tier-circuit", ordinal: 1, alias: "Circuit" }],
      nodes: [{
        id: "holiday-circuit-1",
        tier_definition_id: "holiday-tier-circuit",
        name: "Holiday Meter 1",
        sort_order: 1,
        metadata_status: "confirmed",
      }],
      meter_mapping: HOLIDAY_MAPPING,
    },
    published_by: "dev-user",
  });
  const snapshot = await materializeTestProjectSnapshot({
    metadataStore: metadata,
    databasePath,
    workspaceId: "holiday-workspace",
    projectId: "holiday-project",
    timezone: "Asia/Singapore",
    batches: [{
      importBatchId: "holiday-120-day-fixture",
      sourceSha256: "holiday-120-day-fixture-sha",
      rawReadings: [],
      normalizedReadings: [],
      intervalFacts: holidayIntervalFacts(),
      qualityEvents: [],
    }],
  });
  const context: EnergyQueryContext = {
    userId: "dev-user",
    workspaceId: "holiday-workspace",
    projectId: "holiday-project",
    projectName: "Holiday SQL Project",
    scopeId: "holiday-project-root",
    scopeName: "Holiday SQL Project",
    scopeType: "project",
    resource: "electricity",
    timezone: "Asia/Singapore",
    from: "2026-02-16T16:00:00.000Z",
    to: "2026-06-16T16:00:00.000Z",
    endExclusive: true,
    period: "Custom",
    hierarchyRevisionId: "holiday-hierarchy-v1",
    meterMappingRevisionId: energyIqPublishedMeterRoutingRevisionId(HOLIDAY_MAPPING),
    meterFormulaRevisionId: "holiday-formula-v1",
    dataSnapshotId: snapshot.id,
    metricVersion: "holiday-metric-v1",
    businessCalendarVersion: "holiday-calendar-v1",
    tariffScheduleVersion: "holiday-tariff-v1",
    resolvedAt: "2026-06-17T00:00:00.000Z",
  };
  return {
    metadata,
    gateway,
    databasePath,
    context,
    close: () => {
      metadata.close();
      try {
        rmSync(root, { recursive: true, force: true });
      } catch (error) {
        if (process.platform !== "win32"
          || !(error instanceof Error)
          || !("code" in error)
          || (error.code !== "EPERM" && error.code !== "EBUSY")) throw error;
      }
    },
  };
};

const holidayIntervalFacts = (): EnergyIntervalFactWrite[] => {
  const rows: EnergyIntervalFactWrite[] = [];
  const from = Date.parse("2026-02-16T16:00:00.000Z");
  for (let offset = 0; offset < 120 * 24; offset += 1) {
    const intervalStart = new Date(from + offset * 3_600_000);
    const intervalEnd = new Date(intervalStart.getTime() + 3_600_000);
    const local = new Date(intervalStart.getTime() + 8 * 3_600_000);
    const localDate = local.toISOString().slice(0, 10);
    const localHour = local.getUTCHours();
    rows.push({
      workspaceId: "holiday-workspace",
      projectId: "holiday-project",
      importBatchId: "holiday-120-day-fixture",
      resource: "electricity",
      meterPointId: "holiday-meter-1",
      scopeId: "holiday-circuit-1",
      parentNodeId: "holiday-project-root",
      sourceLabel: "Holiday Meter 1",
      category: "overall",
      meterRole: "total",
      intervalStart: intervalStart.toISOString(),
      intervalEnd: intervalEnd.toISOString(),
      elapsedMinutes: 60,
      activeEnergyKwh: offset + 1,
      previousActiveEnergyKwh: offset,
      rawDeltaKwh: 1,
      usageKwh: 1,
      averageKw: 1,
      qualityStatus: "ok",
      localDate,
      localHour,
      dayType: localHour % 2 === 0 ? "weekday" : "weekend",
      isOperating: true,
      sourceFile: "holiday-120-day-fixture.csv",
      sourceSha256: "holiday-120-day-fixture-sha",
      sourceReadingKind: "interval_usage",
    });
  }
  return rows;
};

const row = (
  meterNodeId: string,
  levelId: string,
  role: "official_total" | "driver_only",
  hourlyKwh: number,
): unknown[] => [
  meterNodeId,
  levelId,
  meterNodeId,
  role,
  JSON.stringify(Array.from({ length: 24 }, (_, localHour) => ({
    local_date: "2026-06-15",
    local_hour: localHour,
    usage_kwh: hourlyKwh,
    accepted_elapsed_minutes: 60,
    rejected_interval_count: 0,
  }))),
];
