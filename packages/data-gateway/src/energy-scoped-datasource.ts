import {
  resolveEnergyIqSnapshotFactScope,
  type MetadataStore,
} from "@datafoundry/metadata";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type * as DuckDbModule from "duckdb";
import { getDuckDbDatabase } from "./duckdb-database-cache.js";
import {
  readEnergyFactProjectState,
} from "./energy-fact-writer.js";
import {
  assertEnergySnapshotReceipt,
  energySnapshotGuardSql,
  energySnapshotReceiptGuardSql,
  type EnergySnapshotGuardScope,
  type EnergySnapshotIdentityScope,
} from "./energy-snapshot-guard.js";

export type EnergyScopedDataSourceContext = {
  workspaceId: string;
  projectId: string;
  scopeId: string;
  /** Published Meter identities and their navigation attachment for this Scope. */
  meterAttachments: Array<{ meterPointId: string; scopeId: string; officialAggregation: boolean }>;
  /** Published, hierarchy-pinned business dimensions visible inside this authorized Scope. */
  scopeDimensions?: EnergyScopedScopeDimension[];
  resource: "electricity" | "water";
  from: string;
  to: string;
  timezone: string;
  hierarchyRevisionId: string;
  meterMappingRevisionId: string;
  meterFormulaRevisionId: string;
  dataSnapshotId: string;
  metricVersion: string;
};

export type EnergyScopedScopeDimension = {
  scopeId: string;
  parentScopeId?: string;
  scopeName: string;
  scopeType: string;
  tierDefinitionId?: string;
  centreCode?: string;
  facilityType?: string;
  areaSqm?: number;
  occupantCount?: number;
  metadataStatus: "provisional" | "confirmed";
  hierarchyRevisionId: string;
};

export type EnergyScopedDataSource = {
  datasourceId: string;
  revision: number;
  snapshotScope?: EnergySnapshotGuardScope;
  viewName: string;
  metadataViewName?: string;
  databasePath: string;
};

export type EnergyCsvExportEvidence = {
  rows: number; bytes: number; sha256: string;
  firstIntervalStart: string | null; actualLastIntervalEnd: string | null;
  meters: Array<{ meterPointId: string; rows: number; validRows: number; observedMinutes: number; validMinutes: number; firstStart: string | null; lastEnd: string | null }>;
};

/** Guard and COPY share a transaction so a publication cannot mix input versions. */
export const exportEnergyScopedCsv = async (source: EnergyScopedDataSource, targetPath: string, deviceNames?: Readonly<Record<string, string>>): Promise<EnergyCsvExportEvidence> => {
  if (!source.snapshotScope) throw new Error("ENERGYIQ_EXPORT_SNAPSHOT_REQUIRED");
  if (existsSync(targetPath)) throw new Error("ENERGYIQ_EXPORT_TARGET_EXISTS");
  const temporary = `${targetPath}.${createHash("sha256").update(String(Math.random())).digest("hex").slice(0, 12)}.partial`;
  const database = await getDuckDbDatabase(source.databasePath);
  const connection = database.connect();
  try {
    await duckDbRun(connection, "BEGIN TRANSACTION");
    await duckDbGet(connection, `SELECT ${snapshotGuardSql(source.snapshotScope)} AS valid`);
    const view = quoteIdentifier(source.viewName);
    const summary = await duckDbGet(connection, `SELECT count(*) AS rows, epoch_ms(min(interval_start)) AS first_ms, epoch_ms(max(interval_end)) AS last_ms FROM ${view}`);
    const meters = await duckDbAll(connection, `SELECT meter_node_id, count(*) AS rows, count(*) FILTER (WHERE quality_status='ok') AS valid_rows, sum(elapsed_minutes) AS observed_minutes, coalesce(sum(elapsed_minutes) FILTER (WHERE quality_status='ok'),0) AS valid_minutes, epoch_ms(min(interval_start)) AS first_ms, epoch_ms(max(interval_end)) AS last_ms FROM ${view} GROUP BY meter_node_id ORDER BY meter_node_id`);
    const labelCases = Object.entries(deviceNames ?? {}).map(([id,name]) => `WHEN ${sqlLiteral(id)} THEN ${sqlLiteral(name)}`).join(" ");
    const columns = deviceNames ? `* EXCLUDE(device_name), device_name AS source_device_name, ${labelCases ? `CASE meter_node_id ${labelCases} ELSE 'Device name needs confirmation' END` : "'Device name needs confirmation'"} AS device_name` : "*";
    await duckDbRun(connection, `COPY (SELECT ${columns} FROM ${view} ORDER BY meter_node_id, interval_start) TO ${sqlLiteral(temporary)} (HEADER, DELIMITER ',')`);
    await duckDbRun(connection, "COMMIT");
    if (existsSync(targetPath)) throw new Error("ENERGYIQ_EXPORT_TARGET_EXISTS");
    renameSync(temporary, targetPath);
    return {
      rows: Number(summary.rows), bytes: statSync(targetPath).size,
      sha256: createHash("sha256").update(readFileSync(targetPath)).digest("hex"),
      firstIntervalStart: isoFromEpochValue(summary.first_ms), actualLastIntervalEnd: isoFromEpochValue(summary.last_ms),
      meters: meters.map((row) => ({ meterPointId: String(row.meter_node_id), rows: Number(row.rows), validRows: Number(row.valid_rows), observedMinutes: Number(row.observed_minutes), validMinutes: Number(row.valid_minutes), firstStart: isoFromEpochValue(row.first_ms), lastEnd: isoFromEpochValue(row.last_ms) })),
    };
  } catch (error) {
    await duckDbRun(connection, "ROLLBACK").catch(() => undefined);
    rmSync(temporary, { force: true });
    throw error;
  } finally {
    await duckDbClose(connection).catch(ignoreAlreadyClosed);
  }
};
export type EnergyPreparedScopedDataSource = Omit<EnergyScopedDataSource, "revision"> & {
  context: EnergyScopedDataSourceContext;
  expectedSnapshotScope: EnergySnapshotIdentityScope;
  sessionDatasourceId: string;
};

export type EnergyFactCoverage = {
  from: string;
  to: string;
  intervalCount: number;
};

export type EnergyMeterDataHealthStatus = "no_readings" | "insufficient_history" | "usable";

export type EnergyMeterDataHealth = {
  meterPointId: string;
  sourceLabel: string;
  status: EnergyMeterDataHealthStatus;
  cumulativeReadingCount: number;
  intervalFactCount: number;
  readingFrom?: string;
  readingTo?: string;
  coverageFrom?: string;
  coverageTo?: string;
};

export type EnergyCurrentOverviewPeriodRead = {
  localFrom: string;
  localToExclusive: string;
  from: string;
  to: string;
  intervalMinutes: number;
  periodDays: number;
};

export type EnergyOverviewHeadlineRead = {
  usageKwh: number;
  peakKw: number;
  peakAt: string | null;
  previousUsageKwh: number;
  validIntervalCount: number;
  qualityEventCount: number;
  intervalMinutes: number;
  lastSeenAt: string | null;
  importBatchIds: string[];
  cumulativeDeltaMismatchCount: number;
  averageKwMismatchCount: number;
  invalidIntervalDurationCount: number;
  intervals: Array<{ start: string; end_exclusive: string; usage_kwh: number }>;
};

export const resolveEnergyFactStorePath = (
  workspaceId: string,
  configuredPath = process.env.ENERGYIQ_DUCKDB_PATH,
  storageRoot = process.env.STORAGE_ROOT_DIR,
): string => resolve(
  configuredPath
    ?? storageRoot
    ?? dirname(fileURLToPath(import.meta.url)),
  ...(configuredPath
    ? []
    : storageRoot
      ? ["energy", workspaceId, "energy.duckdb"]
      : ["../../..", "storage", "energy", workspaceId, "energy.duckdb"]),
);

export const readEnergyFactCoverage = async (input: {
  metadataStore: MetadataStore;
  workspaceId: string;
  projectId: string;
  dataSnapshotId: string;
  resource: "electricity" | "water";
  databasePath?: string;
}): Promise<EnergyFactCoverage | null> => readEnergyCoverage(input);

export const readEnergyAnalysisEligibleCoverage = async (input: {
  metadataStore: MetadataStore;
  workspaceId: string;
  projectId: string;
  dataSnapshotId: string;
  resource: "electricity" | "water";
  meterAttachments: ReadonlyArray<{ meterPointId: string }>;
  databasePath?: string;
}): Promise<EnergyFactCoverage | null> => readEnergyCoverage(input, "analysis-eligible");

const readEnergyCoverage = async (input: {
  metadataStore: MetadataStore;
  workspaceId: string;
  projectId: string;
  dataSnapshotId: string;
  resource: "electricity" | "water";
  meterAttachments?: ReadonlyArray<{ meterPointId: string }>;
  databasePath?: string;
}, eligibility: "all-facts" | "analysis-eligible" = "all-facts"): Promise<EnergyFactCoverage | null> => {
  const databasePath = input.databasePath
    ? input.databasePath === ":memory:" ? input.databasePath : resolve(input.databasePath)
    : resolveEnergyFactStorePath(input.workspaceId);
  if (databasePath !== ":memory:" && !existsSync(databasePath)) {
    throw new Error("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
  }
  const factScope = await resolveValidatedSnapshotFactScope({
    metadataStore: input.metadataStore,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    dataSnapshotId: input.dataSnapshotId,
    databasePath,
  });

  const database = await getDuckDbDatabase(databasePath);
  const connection = database.connect();
  try {
    const attachedMeterPointIds = [...new Set(
      (input.meterAttachments ?? []).map((attachment) => attachment.meterPointId),
    )];
    const row = await duckDbGet(connection, `
      WITH snapshot_guard AS MATERIALIZED (
        SELECT ${snapshotGuardSql(factScope)} AS snapshot_valid
      )
      SELECT
        epoch_ms(MIN(interval_start)) AS from_ms,
        epoch_ms(MAX(interval_end)) AS to_ms,
        COUNT(*) AS interval_count
      FROM snapshot_guard
      CROSS JOIN energy_interval_facts
      WHERE snapshot_guard.snapshot_valid
        AND workspace_id = ${sqlLiteral(input.workspaceId)}
        AND project_id = ${sqlLiteral(input.projectId)}
        AND resource = ${sqlLiteral(input.resource)}
        AND lower(source_sha256) IN (${factScope.sourceSha256.map(sqlLiteral).join(", ")})
        ${eligibility === "analysis-eligible"
          ? `AND quality_status = 'ok' AND ${meterPointFilter("energy_interval_facts", attachedMeterPointIds)}`
          : ""}
    `);
    const fromMs = numericValue(row.from_ms);
    const toMs = numericValue(row.to_ms);
    if (fromMs === null || toMs === null) return null;
    return {
      from: new Date(fromMs).toISOString(),
      to: new Date(toMs).toISOString(),
      intervalCount: numericValue(row.interval_count) ?? 0,
    };
  } finally {
    await duckDbClose(connection).catch(ignoreAlreadyClosed);
  }
};

export type EnergyMeterLastReading = {
  meterNodeId: string;
  lastReadingAt: string;
};

export type EnergyReportingCoverage = {
  /** The newest interval any Meter in this Project has reported. */
  latestReadingAt: string;
  /** Every Meter that has ever reported, with the last interval it sent. */
  meters: EnergyMeterLastReading[];
  /** Recent local days and what actually arrived on each. */
  days: Array<{
    localDate: string;
    usageKwh: number;
    observedIntervalCount: number;
  }>;
};

/**
 * What each Meter has actually sent, so a caller can tell a quiet day from a
 * Meter that stopped reporting partway through one.
 *
 * Deliberately outside the analysis window: the window ends on the last day
 * every Meter covered, which is exactly the day a reader needs to look past to
 * see that something went quiet. Returns observations only — which days count
 * as short, and which Meters count as stale, is the caller's rule.
 */
export const readEnergyReportingCoverage = async (input: {
  metadataStore: MetadataStore;
  workspaceId: string;
  projectId: string;
  dataSnapshotId: string;
  resource: "electricity" | "water";
  timezone: string;
  /** How many trailing local days to report. */
  dayCount: number;
  databasePath?: string;
}): Promise<EnergyReportingCoverage | null> => {
  if (!Number.isSafeInteger(input.dayCount) || input.dayCount <= 0) {
    throw new Error("ENERGYIQ_REPORTING_COVERAGE_DAY_COUNT_INVALID");
  }
  const databasePath = input.databasePath
    ? input.databasePath === ":memory:" ? input.databasePath : resolve(input.databasePath)
    : resolveEnergyFactStorePath(input.workspaceId);
  if (databasePath !== ":memory:" && !existsSync(databasePath)) {
    throw new Error("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
  }
  const factScope = await resolveValidatedSnapshotFactScope({
    metadataStore: input.metadataStore,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    dataSnapshotId: input.dataSnapshotId,
    databasePath,
  });

  const database = await getDuckDbDatabase(databasePath);
  const connection = database.connect();
  const scopeFilter = `
        AND workspace_id = ${sqlLiteral(input.workspaceId)}
        AND project_id = ${sqlLiteral(input.projectId)}
        AND resource = ${sqlLiteral(input.resource)}
        AND lower(source_sha256) IN (${factScope.sourceSha256.map(sqlLiteral).join(", ")})`;
  try {
    // Both reads share one transaction, so they see exactly the same facts. The first re-hashes every
    // fact row against the snapshot digest; the second then needs only the receipt check, saving a
    // second full re-hash (~0.6 s on a typical project) without weakening the guarantee.
    await duckDbRun(connection, "BEGIN TRANSACTION");
    const meterRows = await duckDbAll(connection, `
      WITH snapshot_guard AS MATERIALIZED (
        SELECT ${snapshotGuardSql(factScope)} AS snapshot_valid
      )
      SELECT
        meter_node_id,
        epoch_ms(MAX(interval_end)) AS last_reading_ms
      FROM snapshot_guard
      CROSS JOIN energy_interval_facts
      WHERE snapshot_guard.snapshot_valid
        AND meter_node_id IS NOT NULL${scopeFilter}
      GROUP BY meter_node_id
      ORDER BY last_reading_ms DESC, meter_node_id
    `);
    const meters = meterRows.flatMap((row) => {
      const lastReadingMs = numericValue(row.last_reading_ms);
      return typeof row.meter_node_id === "string" && lastReadingMs !== null
        ? [{
          meterNodeId: row.meter_node_id,
          lastReadingAt: new Date(lastReadingMs).toISOString(),
        }]
        : [];
    });
    if (meters.length === 0) return null;

    const dayRows = await duckDbAll(connection, `
      WITH snapshot_guard AS MATERIALIZED (
        SELECT ${energySnapshotReceiptGuardSql(factScope)} AS snapshot_valid
      )
      SELECT
        CAST(local_date AS VARCHAR) AS local_date,
        COUNT(*) AS observed_interval_count,
        SUM(usage_kwh) AS usage_kwh
      FROM snapshot_guard
      CROSS JOIN energy_interval_facts
      WHERE snapshot_guard.snapshot_valid${scopeFilter}
      GROUP BY local_date
      ORDER BY local_date DESC
      LIMIT ${input.dayCount}
    `);
    const days = dayRows.flatMap((row) => (
      typeof row.local_date === "string"
        ? [{
          localDate: row.local_date,
          usageKwh: numericValue(row.usage_kwh) ?? 0,
          observedIntervalCount: numericValue(row.observed_interval_count) ?? 0,
        }]
        : []
    )).reverse();

    return {
      latestReadingAt: meters[0]!.lastReadingAt,
      meters,
      days,
    };
  } finally {
    // Read-only: nothing to commit.
    await duckDbRun(connection, "ROLLBACK").catch(() => undefined);
    await duckDbClose(connection).catch(ignoreAlreadyClosed);
  }
};

/**
 * Report whether each configured Meter Point has enough current-snapshot
 * cumulative history to contribute interval facts. This is intentionally a
 * snapshot-scoped read: an old Import Batch must not make a removed source
 * appear healthy, and the latest batch alone must not hide retained history.
 */
export const readEnergyMeterDataHealth = async (input: {
  metadataStore: MetadataStore;
  workspaceId: string;
  projectId: string;
  dataSnapshotId: string;
  resource: "electricity" | "water";
  meterPoints: ReadonlyArray<{ meterPointId: string; sourceLabel: string }>;
  databasePath?: string;
}): Promise<EnergyMeterDataHealth[]> => {
  const databasePath = input.databasePath
    ? input.databasePath === ":memory:" ? input.databasePath : resolve(input.databasePath)
    : resolveEnergyFactStorePath(input.workspaceId);
  if (databasePath !== ":memory:" && !existsSync(databasePath)) {
    throw new Error("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
  }
  const factScope = await resolveValidatedSnapshotFactScope({
    metadataStore: input.metadataStore,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    dataSnapshotId: input.dataSnapshotId,
    databasePath,
  });
  const database = await getDuckDbDatabase(databasePath);
  const connection = database.connect();
  try {
    const rows = await duckDbAll(connection, `
      WITH snapshot_guard AS MATERIALIZED (
        SELECT ${snapshotGuardSql(factScope)} AS snapshot_valid
      ), readings AS (
        SELECT
          meter_node_id,
          COUNT(*) AS cumulative_reading_count,
          epoch_ms(MIN(event_time)) AS reading_from_ms,
          epoch_ms(MAX(event_time)) AS reading_to_ms
        FROM snapshot_guard
        CROSS JOIN normalized_meter_readings
        WHERE snapshot_guard.snapshot_valid
          AND workspace_id = ${sqlLiteral(input.workspaceId)}
          AND project_id = ${sqlLiteral(input.projectId)}
          AND resource = ${sqlLiteral(input.resource)}
          AND source_reading_kind IN ('cumulative_energy', 'cumulative_energy_event')
          AND lower(source_sha256) IN (${factScope.sourceSha256.map(sqlLiteral).join(", ")})
        GROUP BY meter_node_id
      ), facts AS (
        SELECT
          meter_node_id,
          COUNT(*) AS interval_fact_count,
          epoch_ms(MIN(interval_start)) AS coverage_from_ms,
          epoch_ms(MAX(interval_end)) AS coverage_to_ms
        FROM snapshot_guard
        CROSS JOIN energy_interval_facts
        WHERE snapshot_guard.snapshot_valid
          AND workspace_id = ${sqlLiteral(input.workspaceId)}
          AND project_id = ${sqlLiteral(input.projectId)}
          AND resource = ${sqlLiteral(input.resource)}
          AND source_reading_kind IN ('cumulative_energy', 'interval_usage')
          AND lower(source_sha256) IN (${factScope.sourceSha256.map(sqlLiteral).join(", ")})
        GROUP BY meter_node_id
      )
      SELECT
        COALESCE(readings.meter_node_id, facts.meter_node_id) AS meter_node_id,
        COALESCE(readings.cumulative_reading_count, 0) AS cumulative_reading_count,
        COALESCE(facts.interval_fact_count, 0) AS interval_fact_count,
        readings.reading_from_ms,
        readings.reading_to_ms,
        facts.coverage_from_ms,
        facts.coverage_to_ms
      FROM readings
      FULL OUTER JOIN facts USING (meter_node_id)
    `);
    const countsByMeterPoint = new Map(rows.map((row) => [String(row.meter_node_id), row]));
    return input.meterPoints.map((meterPoint) => {
      const row = countsByMeterPoint.get(meterPoint.meterPointId);
      const cumulativeReadingCount = numericValue(row?.cumulative_reading_count) ?? 0;
      const intervalFactCount = numericValue(row?.interval_fact_count) ?? 0;
      const readingFrom = isoFromEpochValue(row?.reading_from_ms);
      const readingTo = isoFromEpochValue(row?.reading_to_ms);
      const coverageFrom = isoFromEpochValue(row?.coverage_from_ms);
      const coverageTo = isoFromEpochValue(row?.coverage_to_ms);
      return {
        ...meterPoint,
        status: intervalFactCount > 0
          ? "usable" as const
          : cumulativeReadingCount > 0
            ? "insufficient_history" as const
            : "no_readings" as const,
        cumulativeReadingCount,
        intervalFactCount,
        ...(readingFrom ? { readingFrom } : {}),
        ...(readingTo ? { readingTo } : {}),
        ...(coverageFrom ? { coverageFrom } : {}),
        ...(coverageTo ? { coverageTo } : {}),
      };
    });
  } finally {
    await duckDbClose(connection).catch(ignoreAlreadyClosed);
  }
};

export type EnergyMeterIntervalCoverage = {
  meterPointId: string;
  startMs: number;
  endMs: number;
  /** 'ok' is a real reading; 'gap' is energy the meter counted while offline, spread as an estimate. */
  qualityStatus: string;
  usageKwh: number | null;
};

/**
 * Every interval each meter covers between two instants, for working out how much of a period it reported. Only the
 * snapshot's own sources count, as for {@link readEnergyMeterDataHealth}.
 */
export const readEnergyMeterIntervalCoverage = async (input: {
  metadataStore: MetadataStore;
  workspaceId: string;
  projectId: string;
  dataSnapshotId: string;
  resource: "electricity" | "water";
  meterPointIds: readonly string[];
  fromMs: number;
  toMs: number;
  databasePath?: string;
}): Promise<EnergyMeterIntervalCoverage[]> => {
  if (!input.meterPointIds.length || input.toMs <= input.fromMs) return [];
  const databasePath = input.databasePath
    ? input.databasePath === ":memory:" ? input.databasePath : resolve(input.databasePath)
    : resolveEnergyFactStorePath(input.workspaceId);
  if (databasePath !== ":memory:" && !existsSync(databasePath)) {
    throw new Error("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
  }
  const factScope = await resolveValidatedSnapshotFactScope({
    metadataStore: input.metadataStore,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    dataSnapshotId: input.dataSnapshotId,
    databasePath,
  });
  const database = await getDuckDbDatabase(databasePath);
  const connection = database.connect();
  try {
    const rows = await duckDbAll(connection, `
      WITH snapshot_guard AS MATERIALIZED (
        SELECT ${snapshotGuardSql(factScope)} AS snapshot_valid
      )
      SELECT meter_node_id, epoch_ms(interval_start) AS start_ms, epoch_ms(interval_end) AS end_ms, quality_status, usage_kwh
      FROM snapshot_guard
      CROSS JOIN energy_interval_facts
      WHERE snapshot_guard.snapshot_valid
        AND workspace_id = ${sqlLiteral(input.workspaceId)}
        AND project_id = ${sqlLiteral(input.projectId)}
        AND resource = ${sqlLiteral(input.resource)}
        AND source_reading_kind IN ('cumulative_energy', 'interval_usage')
        AND lower(source_sha256) IN (${factScope.sourceSha256.map(sqlLiteral).join(", ")})
        AND meter_node_id IN (${input.meterPointIds.map(sqlLiteral).join(", ")})
        AND interval_end > to_timestamp(${Math.trunc(input.fromMs)} / 1000.0)
        AND interval_start < to_timestamp(${Math.trunc(input.toMs)} / 1000.0)
      ORDER BY meter_node_id, interval_start
    `);
    return rows.map((row) => ({
      meterPointId: String(row.meter_node_id),
      startMs: numericValue(row.start_ms) ?? 0,
      endMs: numericValue(row.end_ms) ?? 0,
      qualityStatus: String(row.quality_status),
      usageKwh: numericValue(row.usage_kwh) ?? null,
    }));
  } finally {
    await duckDbClose(connection).catch(ignoreAlreadyClosed);
  }
};

export const readEnergyCurrentOverviewPeriod = async (input: {
  metadataStore: MetadataStore;
  workspaceId: string;
  projectId: string;
  dataSnapshotId: string;
  resource: "electricity" | "water";
  meterPointIds: readonly string[];
  timezone: string;
  periodBasis: "rolling_7_days" | "rolling_28_days" | "calendar_month_to_date";
  databasePath?: string;
}): Promise<EnergyCurrentOverviewPeriodRead | null> => {
  const databasePath = input.databasePath
    ? normalizeEnergyFactStorePath(input.databasePath)
    : resolveEnergyFactStorePath(input.workspaceId);
  if (databasePath !== ":memory:" && !existsSync(databasePath)) {
    throw new Error("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
  }
  const factScope = await resolveValidatedSnapshotFactScope({
    metadataStore: input.metadataStore,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    dataSnapshotId: input.dataSnapshotId,
    databasePath,
  });
  const database = await getDuckDbDatabase(databasePath);
  const connection = database.connect();
  try {
    const recent = energyCurrentOverviewPeriodFromRow(
      await duckDbGet(connection, energyCurrentOverviewPeriodSql(input, factScope, 14)),
    );
    if (recent) return recent;
    return energyCurrentOverviewPeriodFromRow(
      await duckDbGet(connection, energyCurrentOverviewPeriodSql(input, factScope)),
    );
  } finally {
    await duckDbClose(connection).catch(ignoreAlreadyClosed);
  }
};

const energyCurrentOverviewPeriodSql = (
  input: {
    workspaceId: string;
    projectId: string;
    resource: "electricity" | "water";
    meterPointIds: readonly string[];
    timezone: string;
    periodBasis: "rolling_7_days" | "rolling_28_days" | "calendar_month_to_date";
  },
  factScope: EnergySnapshotGuardScope,
  probeDays?: 14,
): string => {
  const rollingDays = input.periodBasis === "rolling_7_days" ? 7 : 28;
  const localFromExpression = input.periodBasis === "calendar_month_to_date"
    ? "DATE_TRUNC('month', local_date)"
    : `local_date - INTERVAL ${rollingDays - 1} DAY`;
  const periodDaysExpression = input.periodBasis === "calendar_month_to_date"
    ? "DATE_DIFF('day', DATE_TRUNC('month', local_date), local_date) + 1"
    : String(rollingDays);
  const latestFactDayCte = probeDays
    ? `, latest_fact_day AS MATERIALIZED (
        SELECT MAX(source.local_date) AS local_date
        FROM snapshot_guard
        CROSS JOIN energy_interval_facts source
        WHERE snapshot_guard.snapshot_valid
          AND source.workspace_id = ${sqlLiteral(input.workspaceId)}
          AND source.project_id = ${sqlLiteral(input.projectId)}
          AND source.resource = ${sqlLiteral(input.resource)}
          AND lower(source.source_sha256) IN (${factScope.sourceSha256.map(sqlLiteral).join(", ")})
          AND ${meterPointFilter("source", input.meterPointIds)}
      )`
    : "";
  const latestFactDayJoin = probeDays ? "CROSS JOIN latest_fact_day" : "";
  const recentFactPredicate = probeDays
    ? `AND source.local_date >= latest_fact_day.local_date - INTERVAL ${probeDays - 1} DAY`
    : "";
  return `
    WITH snapshot_guard AS MATERIALIZED (
      SELECT ${snapshotGuardSql(factScope)} AS snapshot_valid
    )${latestFactDayCte}, candidate_days AS (
      SELECT
        source.local_date,
        COUNT(*) FILTER (WHERE source.quality_status = 'ok') AS valid_interval_count,
        COUNT(*) FILTER (WHERE source.quality_status <> 'ok') AS quality_event_count,
        COALESCE(MEDIAN(source.elapsed_minutes) FILTER (
          WHERE source.quality_status = 'ok' AND source.elapsed_minutes > 0
        ), 15) AS interval_minutes,
        ${input.meterPointIds.length} * ROUND(1440 / COALESCE(MEDIAN(source.elapsed_minutes) FILTER (
          WHERE source.quality_status = 'ok' AND source.elapsed_minutes > 0
        ), 15)) AS expected_interval_count
      FROM snapshot_guard
      ${latestFactDayJoin}
      CROSS JOIN energy_interval_facts source
      WHERE snapshot_guard.snapshot_valid
        AND source.workspace_id = ${sqlLiteral(input.workspaceId)}
        AND source.project_id = ${sqlLiteral(input.projectId)}
        AND source.resource = ${sqlLiteral(input.resource)}
        AND lower(source.source_sha256) IN (${factScope.sourceSha256.map(sqlLiteral).join(", ")})
        AND ${meterPointFilter("source", input.meterPointIds)}
        ${recentFactPredicate}
      GROUP BY source.local_date
    )
    SELECT
      STRFTIME(${localFromExpression}, '%Y-%m-%d') AS local_from,
      STRFTIME(local_date + INTERVAL 1 DAY, '%Y-%m-%d') AS local_to_exclusive,
      EPOCH_MS(TIMEZONE(${sqlLiteral(input.timezone)}, CAST(${localFromExpression} AS TIMESTAMP))) AS from_ms,
      EPOCH_MS(TIMEZONE(${sqlLiteral(input.timezone)}, CAST(local_date + INTERVAL 1 DAY AS TIMESTAMP))) AS to_ms,
      interval_minutes,
      ${periodDaysExpression} AS period_days
    FROM candidate_days
    WHERE valid_interval_count = expected_interval_count
      AND quality_event_count = 0
    ORDER BY local_date DESC
    LIMIT 1
  `;
};

const energyCurrentOverviewPeriodFromRow = (
  row: Record<string, unknown>,
): EnergyCurrentOverviewPeriodRead | null => {
  const from = isoFromEpochValue(row.from_ms);
  const to = isoFromEpochValue(row.to_ms);
  if (!from || !to || typeof row.local_from !== "string" || typeof row.local_to_exclusive !== "string") {
    return null;
  }
  return {
    localFrom: row.local_from,
    localToExclusive: row.local_to_exclusive,
    from,
    to,
    intervalMinutes: numericValue(row.interval_minutes) ?? 15,
    periodDays: numericValue(row.period_days) ?? 0,
  };
};

export const readEnergyOverviewHeadline = async (input: {
  metadataStore: MetadataStore;
  workspaceId: string;
  projectId: string;
  dataSnapshotId: string;
  resource: "electricity" | "water";
  meterPointIds: readonly string[];
  from: string;
  to: string;
  databasePath?: string;
}): Promise<EnergyOverviewHeadlineRead> => {
  const databasePath = input.databasePath
    ? normalizeEnergyFactStorePath(input.databasePath)
    : resolveEnergyFactStorePath(input.workspaceId);
  if (databasePath !== ":memory:" && !existsSync(databasePath)) {
    throw new Error("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
  }
  const factScope = await resolveValidatedSnapshotFactScope({
    metadataStore: input.metadataStore,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    dataSnapshotId: input.dataSnapshotId,
    databasePath,
  });
  const periodDurationMs = Date.parse(input.to) - Date.parse(input.from);
  const previousFrom = new Date(Date.parse(input.from) - periodDurationMs).toISOString();
  const database = await getDuckDbDatabase(databasePath);
  const connection = database.connect();
  try {
    const row = await duckDbGet(connection, `
      WITH snapshot_guard AS MATERIALIZED (
        SELECT ${snapshotGuardSql(factScope)} AS snapshot_valid
      ), selected_facts AS MATERIALIZED (
        SELECT source.*
        FROM snapshot_guard
        CROSS JOIN energy_interval_facts source
        WHERE snapshot_guard.snapshot_valid
          AND source.workspace_id = ${sqlLiteral(input.workspaceId)}
          AND source.project_id = ${sqlLiteral(input.projectId)}
          AND source.resource = ${sqlLiteral(input.resource)}
          AND lower(source.source_sha256) IN (${factScope.sourceSha256.map(sqlLiteral).join(", ")})
          AND ${meterPointFilter("source", input.meterPointIds)}
          AND source.interval_start >= CAST(${sqlLiteral(previousFrom)} AS TIMESTAMPTZ)
          AND source.interval_start < CAST(${sqlLiteral(input.to)} AS TIMESTAMPTZ)
          AND source.interval_end <= CAST(${sqlLiteral(input.to)} AS TIMESTAMPTZ)
      ), current_facts AS MATERIALIZED (
        SELECT * FROM selected_facts
        WHERE interval_start >= CAST(${sqlLiteral(input.from)} AS TIMESTAMPTZ)
      ), current_interval_totals AS MATERIALIZED (
        SELECT
          interval_start,
          SUM(usage_kwh) FILTER (WHERE quality_status IN ('ok', 'gap')) AS usage_kwh,
          SUM(average_kw) FILTER (WHERE quality_status = 'ok') AS average_kw
        FROM current_facts
        GROUP BY interval_start
      ), scope_intervals AS MATERIALIZED (
        SELECT interval_start, interval_end, SUM(usage_kwh) AS usage_kwh
        FROM current_facts
        WHERE quality_status = 'ok'
        GROUP BY interval_start, interval_end
      )
      SELECT
        COALESCE((SELECT SUM(usage_kwh) FROM current_interval_totals), 0) AS usage_kwh,
        COALESCE((SELECT MAX(ROUND(average_kw, 9)) FROM current_interval_totals), 0) AS peak_kw,
        (SELECT EPOCH_MS(MIN(interval_start))
          FROM current_interval_totals
          WHERE ROUND(average_kw, 9) = (
            SELECT MAX(ROUND(average_kw, 9)) FROM current_interval_totals
          )) AS peak_at_ms,
        COALESCE((SELECT SUM(usage_kwh) FILTER (WHERE quality_status IN ('ok', 'gap'))
          FROM selected_facts WHERE interval_start < CAST(${sqlLiteral(input.from)} AS TIMESTAMPTZ)), 0)
          AS previous_usage_kwh,
        (SELECT COUNT(*) FILTER (WHERE quality_status = 'ok') FROM current_facts) AS valid_interval_count,
        (SELECT COUNT(*) FILTER (WHERE quality_status <> 'ok') FROM current_facts) AS quality_event_count,
        COALESCE((SELECT MEDIAN(elapsed_minutes) FILTER (
          WHERE quality_status = 'ok' AND elapsed_minutes > 0
        ) FROM current_facts), 15) AS interval_minutes,
        (SELECT EPOCH_MS(MAX(interval_end) FILTER (WHERE quality_status = 'ok')) FROM current_facts)
          AS last_seen_at_ms,
        COALESCE((SELECT STRING_AGG(DISTINCT COALESCE(import_batch_id, '<legacy>'), ',')
          FILTER (WHERE quality_status = 'ok') FROM current_facts), '') AS import_batch_ids,
        (SELECT COUNT(*) FILTER (
          WHERE source_reading_kind = 'cumulative_energy'
            AND quality_status = 'ok'
            AND ABS((active_energy_kwh - previous_active_energy_kwh) - raw_delta_kwh) > 0.000001
        ) FROM current_facts) AS cumulative_delta_mismatch_count,
        (SELECT COUNT(*) FILTER (
          WHERE quality_status = 'ok' AND elapsed_minutes > 0
            AND ABS(average_kw - usage_kwh * 60 / elapsed_minutes) > 0.000001
        ) FROM current_facts) AS average_kw_mismatch_count,
        (SELECT COUNT(*) FILTER (WHERE quality_status = 'ok' AND elapsed_minutes <> 15)
          FROM current_facts) AS invalid_interval_duration_count,
        COALESCE((SELECT TO_JSON(LIST(STRUCT_PACK(
          from_ms := EPOCH_MS(interval_start),
          to_ms := EPOCH_MS(interval_end),
          usage_kwh := usage_kwh
        ) ORDER BY interval_start, interval_end)) FROM scope_intervals), '[]') AS intervals_json
    `);
    return {
      usageKwh: numericValue(row.usage_kwh) ?? 0,
      peakKw: numericValue(row.peak_kw) ?? 0,
      peakAt: isoFromEpochValue(row.peak_at_ms),
      previousUsageKwh: numericValue(row.previous_usage_kwh) ?? 0,
      validIntervalCount: numericValue(row.valid_interval_count) ?? 0,
      qualityEventCount: numericValue(row.quality_event_count) ?? 0,
      intervalMinutes: numericValue(row.interval_minutes) ?? 15,
      lastSeenAt: isoFromEpochValue(row.last_seen_at_ms),
      importBatchIds: String(row.import_batch_ids ?? "").split(",").filter(Boolean).sort(),
      cumulativeDeltaMismatchCount: numericValue(row.cumulative_delta_mismatch_count) ?? 0,
      averageKwMismatchCount: numericValue(row.average_kw_mismatch_count) ?? 0,
      invalidIntervalDurationCount: numericValue(row.invalid_interval_duration_count) ?? 0,
      intervals: parseEnergyOverviewIntervals(row.intervals_json),
    };
  } finally {
    await duckDbClose(connection).catch(ignoreAlreadyClosed);
  }
};

/**
 * Materialize a run-safe, read-only EnergyIQ view and register only that view
 * with Data Gateway.  The table allowlist is the actual security boundary:
 * model-generated SQL cannot reach the workspace base tables.
 */
export const ensureEnergyScopedDataSource = async (input: {
  metadataStore: MetadataStore;
  userId: string;
  context: EnergyScopedDataSourceContext;
  databasePath?: string;
}): Promise<EnergyScopedDataSource> => {
  const prepared = await prepareEnergyScopedDataSource(input);
  const factScope = await resolveValidatedSnapshotFactScope({
    metadataStore: input.metadataStore,
    workspaceId: input.context.workspaceId,
    projectId: input.context.projectId,
    dataSnapshotId: input.context.dataSnapshotId,
    databasePath: prepared.databasePath,
  });
  return registerPreparedEnergyScopedDataSource({
    metadataStore: input.metadataStore,
    userId: input.userId,
    prepared,
    factScope,
  });
};

export const prepareEnergyScopedDataSource = async (input: {
  metadataStore: MetadataStore;
  userId: string;
  context: EnergyScopedDataSourceContext;
  databasePath?: string;
}): Promise<EnergyPreparedScopedDataSource> => {
  const databasePath = normalizeEnergyFactStorePath(
    input.databasePath ?? resolveEnergyFactStorePath(input.context.workspaceId),
  );
  if (databasePath !== ":memory:" && !existsSync(databasePath)) {
    throw new Error("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
  }
  const expectedSnapshotScope = resolveSnapshotIdentityScope({
    metadataStore: input.metadataStore,
    workspaceId: input.context.workspaceId,
    projectId: input.context.projectId,
    dataSnapshotId: input.context.dataSnapshotId,
  });

  const canonicalContext = {
    ...input.context,
    meterAttachments: [...(input.context.meterAttachments ?? [])]
      .sort((left, right) => left.meterPointId.localeCompare(right.meterPointId)),
    ...(input.context.scopeDimensions === undefined
      ? {}
      : {
          scopeDimensions: [...input.context.scopeDimensions]
            .sort((left, right) => left.scopeId.localeCompare(right.scopeId)),
        }),
  };
  const signature = createHash("sha256")
    .update(JSON.stringify(canonicalContext))
    .digest("hex")
    .slice(0, 20);
  const viewName = `energy_scope_${signature}`;
  const metadataViewName = input.context.scopeDimensions === undefined
    ? undefined
    : `${viewName}_metadata`;
  const datasourceId = `energy-scope-${signature}`;
  const sessionSignature = createHash("sha256")
    .update(JSON.stringify({ databasePath, expectedSnapshotScope }))
    .digest("hex")
    .slice(0, 20);
  const sessionDatasourceId = `energy-snapshot-session-${sessionSignature}`;
  try {
    await createScopedViews(
      databasePath,
      viewName,
      metadataViewName,
      input.context,
      expectedSnapshotScope,
    );
  } catch {
    throw new Error("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
  }
  const sessionConfig = {
    path: databasePath,
    mode: "readonly",
    defaultEnabled: false,
    queryPolicy: { maxRows: 1, timeoutMs: 10000 },
    introspection: { tableAllowlist: [] },
    energyQueryScope: expectedSnapshotScope,
  };
  const existingSession = input.metadataStore.dataSources.find({
    user_id: input.userId,
    datasource_id: sessionDatasourceId,
  });
  if (existingSession?.config_json !== JSON.stringify(sessionConfig)) {
    input.metadataStore.dataSources.create({
      user_id: input.userId,
      id: sessionDatasourceId,
      name: `EnergyIQ snapshot session · ${input.context.projectId}`,
      type: "duckdb",
      config: sessionConfig,
      description: "Server-resolved bootstrap for one trusted EnergyIQ Snapshot read session.",
    });
  }

  return {
    datasourceId,
    viewName,
    ...(metadataViewName ? { metadataViewName } : {}),
    databasePath,
    context: input.context,
    expectedSnapshotScope,
    sessionDatasourceId,
  };
};

export const registerPreparedEnergyScopedDataSource = (input: {
  metadataStore: MetadataStore;
  userId: string;
  prepared: EnergyPreparedScopedDataSource;
  factScope: EnergySnapshotGuardScope;
}): EnergyScopedDataSource => {
  assertEnergySnapshotReceipt(input.prepared.expectedSnapshotScope, input.factScope);
  const { context, databasePath, datasourceId, viewName, metadataViewName } = input.prepared;

  const config = {
    path: databasePath,
    mode: "readonly",
    defaultEnabled: false,
    queryPolicy: {
      maxRows: 1000,
      timeoutMs: 10000
    },
    samplePolicy: {
      allowSample: true,
      maxSampleRows: 100
    },
    introspection: {
      tableAllowlist: [viewName, ...(metadataViewName ? [metadataViewName] : [])]
    },
    energyQueryScope: {
      workspaceId: context.workspaceId,
      projectId: context.projectId,
      scopeId: context.scopeId,
      resource: context.resource,
      from: context.from,
      to: context.to,
      endExclusive: true,
      hierarchyRevisionId: context.hierarchyRevisionId,
      meterMappingRevisionId: context.meterMappingRevisionId,
      meterFormulaRevisionId: context.meterFormulaRevisionId,
      dataSnapshotId: context.dataSnapshotId,
      manifestFingerprint: input.factScope.manifestFingerprint,
      sourceSha256: input.factScope.sourceSha256,
      factWriterContractVersion: input.factScope.factWriterContractVersion,
      canonicalIntervalCount: input.factScope.canonicalIntervalCount,
      canonicalIntervalDigest: input.factScope.canonicalIntervalDigest,
      metricVersion: context.metricVersion
    }
  };
  const existing = input.metadataStore.dataSources.find({
    user_id: input.userId,
    datasource_id: datasourceId
  });
  const record = existing?.config_json === JSON.stringify(config)
    ? existing
    : input.metadataStore.dataSources.create({
        user_id: input.userId,
        id: datasourceId,
        name: `EnergyIQ trusted scope · ${context.projectId}`,
        type: "duckdb",
        config,
        description: "Server-resolved EnergyIQ project, hierarchy, resource, and time scope."
      });

  return {
    datasourceId,
    revision: record.revision,
    snapshotScope: input.factScope,
    viewName,
    ...(metadataViewName ? { metadataViewName } : {}),
    databasePath
  };
};

const createScopedViews = async (
  databasePath: string,
  viewName: string,
  metadataViewName: string | undefined,
  context: EnergyScopedDataSourceContext,
  factScope: Pick<EnergySnapshotIdentityScope, "sourceSha256">,
): Promise<void> => {
  const attachments = [...new Map((context.meterAttachments ?? []).map((attachment) => [
    attachment.meterPointId,
    attachment
  ])).values()];
  const meterPointIds = attachments.map((attachment) => attachment.meterPointId);
  const nodeFilter = meterPointIds.length > 0
    ? `meter_node_id IN (${meterPointIds.map(sqlLiteral).join(", ")})`
    : "FALSE";
  const navigationScope = attachments.length > 0
    ? `CASE meter_node_id ${attachments.map((attachment) =>
        `WHEN ${sqlLiteral(attachment.meterPointId)} THEN ${sqlLiteral(attachment.scopeId)}`).join(" ")} ELSE scope_id END`
    : "scope_id";
  const officialAggregation = attachments.length > 0
    ? `CASE meter_node_id ${attachments.map((attachment) =>
        `WHEN ${sqlLiteral(attachment.meterPointId)} THEN ${attachment.officialAggregation ? "TRUE" : "FALSE"}`).join(" ")} ELSE FALSE END`
    : "FALSE";
  const database = await getDuckDbDatabase(databasePath);
  const connection = database.connect();
  try {
    await duckDbRun(connection, `
      CREATE OR REPLACE VIEW ${quoteIdentifier(viewName)} AS
      SELECT
        project_id,
        resource,
        meter_node_id,
        ${navigationScope} AS scope_id,
        ${officialAggregation} AS official_aggregation_eligible,
        parent_node_id,
        level_node_id,
        device_name,
        appliance,
        circuit_name,
        category,
        meter_role,
        source_reading_kind,
        interval_start,
        interval_end,
        import_batch_id,
        timezone(${sqlLiteral(context.timezone)}, interval_start) AS local_interval_start,
        timezone(${sqlLiteral(context.timezone)}, interval_end) AS local_interval_end,
        local_date,
        local_hour,
        day_type,
        elapsed_minutes,
        active_energy_kwh,
        previous_active_energy_kwh,
        raw_delta_kwh,
        usage_kwh,
        average_kw,
        quality_status,
        source_file,
        source_sha256
      FROM energy_interval_facts
      WHERE workspace_id = ${sqlLiteral(context.workspaceId)}
        AND project_id = ${sqlLiteral(context.projectId)}
        AND resource = ${sqlLiteral(context.resource)}
        AND lower(source_sha256) IN (${factScope.sourceSha256.map(sqlLiteral).join(", ")})
        AND interval_start >= CAST(${sqlLiteral(context.from)} AS TIMESTAMPTZ)
        AND interval_start < CAST(${sqlLiteral(context.to)} AS TIMESTAMPTZ)
        AND interval_end <= CAST(${sqlLiteral(context.to)} AS TIMESTAMPTZ)
        AND ${nodeFilter}
    `);
    if (metadataViewName) {
      await duckDbRun(connection, scopeDimensionsViewSql(
        metadataViewName,
        context.scopeDimensions ?? [],
      ));
    }
  } finally {
    await duckDbClose(connection).catch(ignoreAlreadyClosed);
  }
};

const scopeDimensionsViewSql = (
  viewName: string,
  dimensions: EnergyScopedScopeDimension[],
): string => {
  const columns = [
    "scope_id",
    "parent_scope_id",
    "scope_name",
    "scope_type",
    "tier_definition_id",
    "centre_code",
    "facility_type",
    "area_sqm",
    "occupant_count",
    "metadata_status",
    "hierarchy_revision_id",
  ];
  const rows = dimensions.map((dimension) => `(
    ${sqlLiteral(dimension.scopeId)},
    ${sqlNullableLiteral(dimension.parentScopeId)},
    ${sqlLiteral(dimension.scopeName)},
    ${sqlLiteral(dimension.scopeType)},
    ${sqlNullableLiteral(dimension.tierDefinitionId)},
    ${sqlNullableLiteral(dimension.centreCode)},
    ${sqlNullableLiteral(dimension.facilityType)},
    ${sqlNullableNumber(dimension.areaSqm)},
    ${sqlNullableNumber(dimension.occupantCount)},
    ${sqlLiteral(dimension.metadataStatus)},
    ${sqlLiteral(dimension.hierarchyRevisionId)}
  )`).join(",\n");
  const values = rows || "(NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)";
  return `
    CREATE OR REPLACE VIEW ${quoteIdentifier(viewName)} AS
    SELECT
      CAST(scope_id AS VARCHAR) AS scope_id,
      CAST(parent_scope_id AS VARCHAR) AS parent_scope_id,
      CAST(scope_name AS VARCHAR) AS scope_name,
      CAST(scope_type AS VARCHAR) AS scope_type,
      CAST(tier_definition_id AS VARCHAR) AS tier_definition_id,
      CAST(centre_code AS VARCHAR) AS centre_code,
      CAST(facility_type AS VARCHAR) AS facility_type,
      CAST(area_sqm AS DOUBLE) AS area_sqm,
      CAST(occupant_count AS DOUBLE) AS occupant_count,
      CAST(metadata_status AS VARCHAR) AS metadata_status,
      CAST(hierarchy_revision_id AS VARCHAR) AS hierarchy_revision_id
    FROM (VALUES ${values}) AS dimensions(${columns.join(", ")})
    ${rows ? "" : "WHERE FALSE"}
  `;
};

export const assertEnergyCurrentSnapshotFacts = async (input: {
  metadataStore: MetadataStore;
  workspaceId: string;
  projectId: string;
  dataSnapshotId: string;
  databasePath?: string;
}): Promise<void> => {
  const databasePath = input.databasePath === ":memory:"
    ? input.databasePath
    : input.databasePath
      ? resolve(input.databasePath)
      : resolveEnergyFactStorePath(input.workspaceId);
  if (databasePath !== ":memory:" && !existsSync(databasePath)) {
    throw new Error("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
  }
  await resolveValidatedSnapshotFactScope({
    metadataStore: input.metadataStore,
    databasePath,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    dataSnapshotId: input.dataSnapshotId,
  });
};

const resolveValidatedSnapshotFactScope = async (input: {
  metadataStore: MetadataStore;
  workspaceId: string;
  projectId: string;
  dataSnapshotId: string;
  databasePath: string;
}): Promise<EnergySnapshotGuardScope> => {
  const expected = resolveSnapshotIdentityScope(input);
  const state = await readEnergyFactProjectState({ databasePath: input.databasePath, projectId: input.projectId });
  if (!state) throw new Error("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
  assertEnergySnapshotReceipt(expected, state);
  return state;
};

const resolveSnapshotIdentityScope = (input: {
  metadataStore: MetadataStore;
  workspaceId: string;
  projectId: string;
  dataSnapshotId: string;
}): EnergySnapshotIdentityScope => {
  const project = input.metadataStore.energyIq.getProject(input.projectId);
  if (project.workspace_id !== input.workspaceId || project.data_snapshot_id !== input.dataSnapshotId) {
    throw new Error(`ENERGYIQ_SNAPSHOT_STALE:${project.data_snapshot_id}`);
  }
  let snapshot;
  try {
    snapshot = input.metadataStore.energyIq.getDataSnapshot(input.dataSnapshotId);
  } catch {
    throw new Error("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
  }
  if (snapshot.workspace_id !== input.workspaceId || snapshot.project_id !== input.projectId) {
    throw new Error("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
  }
  let factScope: ReturnType<typeof resolveEnergyIqSnapshotFactScope>;
  try {
    factScope = resolveEnergyIqSnapshotFactScope(snapshot);
  } catch {
    throw new Error("ENERGYIQ_SNAPSHOT_FACTS_UNAVAILABLE");
  }
  return {
    ...factScope,
    factWriterContractVersion: factScope.factWriterContractVersion,
  };
};

const normalizeEnergyFactStorePath = (databasePath: string): string =>
  databasePath === ":memory:" ? databasePath : resolve(databasePath);

const snapshotGuardSql = (scope: EnergySnapshotGuardScope): string => energySnapshotGuardSql(scope);

const sqlLiteral = (value: string): string => `'${value.replaceAll("'", "''")}'`;
const meterPointFilter = (alias: string, meterPointIds: readonly string[]): string =>
  meterPointIds.length > 0
    ? `${alias}.meter_node_id IN (${meterPointIds.map(sqlLiteral).join(", ")})`
    : "FALSE";
const sqlNullableLiteral = (value: string | undefined): string =>
  value === undefined ? "NULL" : sqlLiteral(value);
const sqlNullableNumber = (value: number | undefined): string =>
  value === undefined ? "NULL" : String(value);
const quoteIdentifier = (value: string): string => `"${value.replaceAll('"', '""')}"`;

const duckDbRun = async (
  connection: DuckDbModule.Connection,
  sql: string
): Promise<void> =>
  await new Promise((resolvePromise, reject) => {
    connection.run(sql, (error) => error ? reject(error) : resolvePromise());
  });

const duckDbGet = async (
  connection: DuckDbModule.Connection,
  sql: string,
): Promise<Record<string, unknown>> => await new Promise((resolvePromise, reject) => {
  connection.all(sql, (error, rows) => error
    ? reject(error)
    : resolvePromise((rows[0] ?? {}) as Record<string, unknown>));
});

const duckDbAll = async (
  connection: DuckDbModule.Connection,
  sql: string,
): Promise<Array<Record<string, unknown>>> => await new Promise((resolvePromise, reject) => {
  connection.all(sql, (error, rows) => error
    ? reject(error)
    : resolvePromise(rows as Array<Record<string, unknown>>));
});

const duckDbClose = async (connection: DuckDbModule.Connection): Promise<void> =>
  await new Promise((resolvePromise, reject) => {
    connection.close((error) => error ? reject(error) : resolvePromise());
  });

const ignoreAlreadyClosed = (error: unknown): void => {
  if (error instanceof Error && error.message.includes("already closed")) {
    return;
  }
  throw error;
};

const numericValue = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
};

const isoFromEpochValue = (value: unknown): string | null => {
  const milliseconds = numericValue(value);
  return milliseconds === null ? null : new Date(milliseconds).toISOString();
};

const parseEnergyOverviewIntervals = (
  value: unknown,
): EnergyOverviewHeadlineRead["intervals"] => {
  const parsed = JSON.parse(typeof value === "string" ? value : "[]") as unknown;
  if (!Array.isArray(parsed)) throw new Error("ENERGYIQ_OPERATIONAL_POLICY_INTERVALS_INVALID");
  return parsed.map((item, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new Error(`ENERGYIQ_OPERATIONAL_POLICY_INTERVAL_INVALID:${index}`);
    }
    const record = item as Record<string, unknown>;
    const fromMs = numericValue(record.from_ms);
    const toMs = numericValue(record.to_ms);
    const usageKwh = numericValue(record.usage_kwh);
    if (fromMs === null || toMs === null || usageKwh === null) {
      throw new Error(`ENERGYIQ_OPERATIONAL_POLICY_INTERVAL_INVALID:${index}`);
    }
    return {
      start: new Date(fromMs).toISOString(),
      end_exclusive: new Date(toMs).toISOString(),
      usage_kwh: usageKwh,
    };
  });
};

/** Bounded interval evidence for a server-authorized scope; guard and read share one transaction. */
export async function readEnergyScopedActionIntervals(source: EnergyScopedDataSource): Promise<Array<{ meterId: string; startMs: number; endMs: number; kwh: number | null; quality: string }>> {
  if (!source.snapshotScope) throw new Error("ENERGYIQ_ACTION_SNAPSHOT_REQUIRED");
  const database = await getDuckDbDatabase(source.databasePath); const connection = database.connect();
  try {
    await duckDbRun(connection, "BEGIN TRANSACTION");
    await duckDbGet(connection, `SELECT ${snapshotGuardSql(source.snapshotScope)} AS valid`);
    const rows = await duckDbAll(connection, `SELECT meter_node_id,epoch_ms(interval_start) AS start_ms,epoch_ms(interval_end) AS end_ms,usage_kwh,quality_status FROM ${quoteIdentifier(source.viewName)} ORDER BY meter_node_id,interval_start LIMIT 40001`);
    if (rows.length > 40000) throw new Error("ENERGYIQ_ACTION_WINDOW_TOO_LARGE");
    await duckDbRun(connection, "COMMIT");
    return rows.map(row => ({ meterId: String(row.meter_node_id), startMs: Number(row.start_ms), endMs: Number(row.end_ms), kwh: row.usage_kwh === null ? null : Number(row.usage_kwh), quality: String(row.quality_status) }));
  } catch (error) { await duckDbRun(connection, "ROLLBACK").catch(() => undefined); throw error; }
  finally { connection.close(); }
}
