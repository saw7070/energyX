import {
  prepareEnergyScopedDataSource,
  registerPreparedEnergyScopedDataSource,
  type LocalDataGateway,
} from "@datafoundry/data-gateway";
import type { MetadataStore } from "@datafoundry/metadata";

import {
  resolveEnergyPublishedMeterRoute,
  type EnergyQueryContext,
} from "./energy-query-context.js";
import {
  SCHOOL_HOLIDAY_CONTEXT_FACT_QUERY_ID,
  SCHOOL_HOLIDAY_MINIMUM_OFFICIAL_FACT_COVERAGE_PCT,
  type SchoolHolidayEnergyFact,
} from "./school-holiday-comparison.js";

type FactQuality = {
  expectedDayCount: number;
  completeDayCount: number;
  coveragePct: number;
};

type MaterializedFacts = {
  queryId: typeof SCHOOL_HOLIDAY_CONTEXT_FACT_QUERY_ID;
  comparisonWindowId: "school-holiday-comparison";
  period: { from: string; toExclusive: string };
  facts: SchoolHolidayEnergyFact[];
  excludedLocalDates: string[];
  limitations: string[];
  quality: FactQuality;
};

export type SchoolHolidayFactProjection = (MaterializedFacts & {
  status: "available";
}) | (MaterializedFacts & {
  status: "partial";
  reason: {
    code: "OFFICIAL_FACT_COVERAGE_BELOW_THRESHOLD";
    message: string;
  };
}) | {
  status: "unavailable";
  queryId: typeof SCHOOL_HOLIDAY_CONTEXT_FACT_QUERY_ID;
  comparisonWindowId: "school-holiday-comparison";
  period: { from: string; toExclusive: string };
  reason: {
    code: "FACT_QUERY_FAILED" | "FACT_ROWS_INVALID" | "OFFICIAL_FACT_COVERAGE_INCOMPLETE";
    message: string;
  };
  quality?: FactQuality;
  excludedLocalDates?: string[];
};

type FactCell = {
  localDate: string;
  localHour: number;
  usageKwh: number | null;
  acceptedElapsedMinutes: number;
  rejectedIntervalCount: number;
};

type MeterFactRow = {
  meterNodeId: string;
  levelId?: string;
  circuitId: string;
  accountingRole: SchoolHolidayEnergyFact["accountingRole"];
  cells: FactCell[];
};

export const loadSchoolHolidayFactProjection = async (input: {
  metadataStore: MetadataStore;
  dataGateway: LocalDataGateway;
  userId: string;
  context: EnergyQueryContext;
  localPeriod: { from: string; toExclusive: string };
  databasePath?: string;
}): Promise<SchoolHolidayFactProjection> => {
  try {
    const route = resolveEnergyPublishedMeterRoute({
      metadataStore: input.metadataStore,
      projectId: input.context.projectId,
      hierarchyRevisionId: input.context.hierarchyRevisionId,
      scopeId: input.context.scopeId,
      resource: input.context.resource,
      expectedMeterMappingRevisionId: input.context.meterMappingRevisionId,
    });
    const prepared = await prepareEnergyScopedDataSource({
      metadataStore: input.metadataStore,
      userId: input.userId,
      context: {
        workspaceId: input.context.workspaceId,
        projectId: input.context.projectId,
        scopeId: input.context.scopeId,
        meterAttachments: route.attachments,
        resource: input.context.resource,
        from: schoolHolidayLocalDateInstant(input.localPeriod.from, input.context.timezone),
        to: schoolHolidayLocalDateInstant(input.localPeriod.toExclusive, input.context.timezone),
        timezone: input.context.timezone,
        hierarchyRevisionId: input.context.hierarchyRevisionId,
        meterMappingRevisionId: input.context.meterMappingRevisionId,
        meterFormulaRevisionId: input.context.meterFormulaRevisionId,
        dataSnapshotId: input.context.dataSnapshotId,
        metricVersion: input.context.metricVersion,
      },
      ...(input.databasePath ? { databasePath: input.databasePath } : {}),
    });
    return await input.dataGateway.withEnergySnapshotReadSession({
      user_id: input.userId,
      workspace_id: input.context.workspaceId,
      datasource_id: prepared.sessionDatasourceId,
    }, async (factScope) => {
      const scoped = registerPreparedEnergyScopedDataSource({
        metadataStore: input.metadataStore,
        userId: input.userId,
        prepared,
        factScope,
      });
      const result = await input.dataGateway.runSqlReadonly({
        user_id: input.userId,
        workspace_id: input.context.workspaceId,
        datasource_id: scoped.datasourceId,
        sql: schoolHolidayFactSql(scoped.viewName),
        limit: Math.max(1, route.attachments.length),
      });
      return materializeSchoolHolidayFactProjection({
        rows: result.rows,
        officialMeterNodeIds: route.officialMeterPointIds ?? [],
        period: input.localPeriod,
        dataSnapshotId: input.context.dataSnapshotId,
      });
    });
  } catch {
    return unavailable(
      input.localPeriod,
      "FACT_QUERY_FAILED",
      "The Snapshot-bound School Holiday fact query did not complete.",
    );
  }
};

export const materializeSchoolHolidayFactProjection = (input: {
  rows: unknown[][];
  officialMeterNodeIds: string[];
  period: { from: string; toExclusive: string };
  dataSnapshotId: string;
}): SchoolHolidayFactProjection => {
  let rows: MeterFactRow[];
  try {
    rows = input.rows.map(parseMeterFactRow);
  } catch {
    return unavailable(input.period, "FACT_ROWS_INVALID", "School Holiday fact rows are invalid.");
  }

  const officialIds = new Set(input.officialMeterNodeIds);
  if (officialIds.size === 0
    || officialIds.size !== input.officialMeterNodeIds.length
    || new Set(rows.map(({ meterNodeId }) => meterNodeId)).size !== rows.length
    || rows.some(({ meterNodeId, accountingRole }) => (
      officialIds.has(meterNodeId) !== (accountingRole === "official_total")
    ))) {
    return unavailable(
      input.period,
      "FACT_ROWS_INVALID",
      "School Holiday fact accounting roles do not match the published official route.",
    );
  }

  const expectedDates = localDateRange(input.period.from, input.period.toExclusive);
  const rowsByMeter = new Map(rows.map((row) => [row.meterNodeId, row]));
  const completeDates = new Set(expectedDates.filter((localDate) => (
    input.officialMeterNodeIds.every((meterNodeId) => {
      const row = rowsByMeter.get(meterNodeId);
      return row ? completeDayCells(row.cells, localDate) !== null : false;
    })
  )));
  const excludedLocalDates = expectedDates.filter((localDate) => !completeDates.has(localDate));
  const quality = {
    expectedDayCount: expectedDates.length,
    completeDayCount: completeDates.size,
    coveragePct: expectedDates.length === 0 ? 0 : round(completeDates.size / expectedDates.length * 100),
  };
  if (completeDates.size === 0) {
    return unavailable(
      input.period,
      "OFFICIAL_FACT_COVERAGE_INCOMPLETE",
      "No comparison date has 24 complete hourly facts for every official Meter.",
      { quality, excludedLocalDates },
    );
  }

  const incompleteDriverDays: string[] = [];
  const facts = rows.flatMap((row) => [...completeDates].flatMap((localDate) => {
    const cells = completeDayCells(row.cells, localDate);
    if (!cells) {
      if (row.accountingRole === "driver_only") incompleteDriverDays.push(`${row.circuitId}:${localDate}`);
      return [];
    }
    return cells.map((cell): SchoolHolidayEnergyFact => ({
      localDate,
      kwh: round(cell.usageKwh!),
      accountingRole: row.accountingRole,
      ...(row.levelId ? { levelId: row.levelId } : {}),
      circuitId: row.circuitId,
      hour: cell.localHour,
      evidenceRef: [
        SCHOOL_HOLIDAY_CONTEXT_FACT_QUERY_ID,
        input.dataSnapshotId,
        row.meterNodeId,
        localDate,
        String(cell.localHour).padStart(2, "0"),
      ].join(":"),
    }));
  }));
  const materialized: MaterializedFacts = {
    queryId: SCHOOL_HOLIDAY_CONTEXT_FACT_QUERY_ID,
    comparisonWindowId: "school-holiday-comparison",
    period: input.period,
    facts,
    excludedLocalDates,
    limitations: incompleteDriverDays.length === 0
      ? []
      : [`incomplete_driver_day_pairs_excluded:${incompleteDriverDays.sort().join(",")}`],
    quality,
  };
  return quality.coveragePct >= SCHOOL_HOLIDAY_MINIMUM_OFFICIAL_FACT_COVERAGE_PCT
    ? { status: "available", ...materialized }
    : {
      status: "partial",
      ...materialized,
      reason: {
        code: "OFFICIAL_FACT_COVERAGE_BELOW_THRESHOLD",
        message: `Official School Holiday facts cover ${quality.completeDayCount} of ${quality.expectedDayCount} dates (${quality.coveragePct}%).`,
      },
    };
};

const parseMeterFactRow = (row: unknown[]): MeterFactRow => {
  const meterNodeId = requiredString(row[0]);
  const levelId = optionalString(row[1]);
  const circuitId = requiredString(row[2]);
  const accountingRole = requiredString(row[3]);
  if (accountingRole !== "official_total" && accountingRole !== "driver_only") {
    throw new Error("ENERGYIQ_SCHOOL_HOLIDAY_FACT_ROLE_INVALID");
  }
  const rawCells = JSON.parse(requiredString(row[4])) as unknown;
  if (!Array.isArray(rawCells)) throw new Error("ENERGYIQ_SCHOOL_HOLIDAY_FACT_CELLS_INVALID");
  const cells = rawCells.map((value): FactCell => {
    if (!isRecord(value)) throw new Error("ENERGYIQ_SCHOOL_HOLIDAY_FACT_CELL_INVALID");
    const localDate = value.local_date;
    const localHour = value.local_hour;
    const usageKwh = value.usage_kwh;
    const acceptedElapsedMinutes = value.accepted_elapsed_minutes;
    const rejectedIntervalCount = value.rejected_interval_count;
    if (typeof localDate !== "string"
      || !/^\d{4}-\d{2}-\d{2}$/u.test(localDate)
      || !Number.isInteger(localHour)
      || (localHour as number) < 0
      || (localHour as number) > 23
      || (usageKwh !== null && (typeof usageKwh !== "number" || !Number.isFinite(usageKwh) || usageKwh < 0))
      || typeof acceptedElapsedMinutes !== "number"
      || !Number.isFinite(acceptedElapsedMinutes)
      || !Number.isInteger(rejectedIntervalCount)
      || (rejectedIntervalCount as number) < 0) {
      throw new Error("ENERGYIQ_SCHOOL_HOLIDAY_FACT_CELL_INVALID");
    }
    return {
      localDate,
      localHour: localHour as number,
      usageKwh: usageKwh as number | null,
      acceptedElapsedMinutes,
      rejectedIntervalCount: rejectedIntervalCount as number,
    };
  });
  return {
    meterNodeId,
    ...(levelId ? { levelId } : {}),
    circuitId,
    accountingRole,
    cells,
  };
};

const schoolHolidayFactSql = (viewName: string): string => `
  SELECT
    meter_definitions.meter_node_id,
    meter_definitions.level_id,
    meter_definitions.meter_node_id AS circuit_id,
    meter_definitions.accounting_role,
    COALESCE(TO_JSON(LIST(STRUCT_PACK(
      local_date := cells.local_date,
      local_hour := cells.local_hour,
      usage_kwh := cells.usage_kwh,
      accepted_elapsed_minutes := cells.accepted_elapsed_minutes,
      rejected_interval_count := cells.rejected_interval_count
    ) ORDER BY cells.local_date, cells.local_hour) FILTER (
      WHERE cells.local_date IS NOT NULL
    )), '[]') AS cells_json
  FROM (
    SELECT
      meter_node_id,
      MAX(level_node_id) AS level_id,
      CASE WHEN BOOL_OR(official_aggregation_eligible)
        THEN 'official_total' ELSE 'driver_only' END AS accounting_role
    FROM ${quoteIdentifier(viewName)}
    GROUP BY meter_node_id
  ) meter_definitions
  LEFT JOIN (
    SELECT
      meter_node_id,
      STRFTIME(CAST(local_interval_start AS DATE), '%Y-%m-%d') AS local_date,
      local_hour,
      SUM(usage_kwh) FILTER (WHERE quality_status IN ('ok', 'gap')) AS usage_kwh,
      SUM(elapsed_minutes) FILTER (WHERE quality_status IN ('ok', 'gap')) AS accepted_elapsed_minutes,
      COUNT(*) FILTER (WHERE quality_status NOT IN ('ok', 'gap')) AS rejected_interval_count
    FROM ${quoteIdentifier(viewName)}
    GROUP BY meter_node_id, CAST(local_interval_start AS DATE), local_hour
  ) cells ON cells.meter_node_id = meter_definitions.meter_node_id
  GROUP BY meter_definitions.meter_node_id, meter_definitions.level_id, meter_definitions.accounting_role
  ORDER BY meter_definitions.meter_node_id
`;

const completeDayCells = (cells: FactCell[], localDate: string): FactCell[] | null => {
  const day = cells.filter((cell) => cell.localDate === localDate);
  return day.length === 24
    && new Set(day.map(({ localHour }) => localHour)).size === 24
    && day.every(({ usageKwh, acceptedElapsedMinutes, rejectedIntervalCount }) => (
      usageKwh !== null && acceptedElapsedMinutes === 60 && rejectedIntervalCount === 0
    ))
    ? day.sort((left, right) => left.localHour - right.localHour)
    : null;
};

const unavailable = (
  period: { from: string; toExclusive: string },
  code: Extract<SchoolHolidayFactProjection, { status: "unavailable" }>["reason"]["code"],
  message: string,
  detail?: { quality: FactQuality; excludedLocalDates: string[] },
): SchoolHolidayFactProjection => ({
  status: "unavailable",
  queryId: SCHOOL_HOLIDAY_CONTEXT_FACT_QUERY_ID,
  comparisonWindowId: "school-holiday-comparison",
  period,
  reason: { code, message },
  ...(detail ? { quality: detail.quality, excludedLocalDates: detail.excludedLocalDates } : {}),
});

const localDateRange = (from: string, toExclusive: string): string[] => {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(from)
    || !/^\d{4}-\d{2}-\d{2}$/u.test(toExclusive)
    || from >= toExclusive) return [];
  const values: string[] = [];
  for (let cursor = from; cursor < toExclusive; cursor = nextLocalDate(cursor)) values.push(cursor);
  return values;
};

const nextLocalDate = (value: string): string => new Date(
  Date.parse(`${value}T00:00:00.000Z`) + 86_400_000,
).toISOString().slice(0, 10);

export const schoolHolidayLocalDateInstant = (localDate: string, timezone: string): string => {
  const [year, month, day] = localDate.split("-").map(Number);
  if (!year || !month || !day) throw new Error("ENERGYIQ_SCHOOL_HOLIDAY_LOCAL_DATE_INVALID");
  const localAsUtc = Date.UTC(year, month - 1, day);
  let guess = localAsUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = zonedParts(new Date(guess), timezone);
    const zonedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    guess = localAsUtc - (zonedAsUtc - guess);
  }
  return new Date(guess).toISOString();
};

const zonedParts = (date: Date, timezone: string) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const numberPart = (type: Intl.DateTimeFormatPartTypes): number => Number(
    parts.find((part) => part.type === type)?.value ?? "0",
  );
  return {
    year: numberPart("year"),
    month: numberPart("month"),
    day: numberPart("day"),
    hour: numberPart("hour"),
    minute: numberPart("minute"),
    second: numberPart("second"),
  };
};

const requiredString = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim()) throw new Error("ENERGYIQ_SCHOOL_HOLIDAY_FACT_STRING_INVALID");
  return value;
};
const optionalString = (value: unknown): string | undefined => typeof value === "string" && value.trim()
  ? value
  : undefined;
const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);
const quoteIdentifier = (value: string): string => `"${value.replaceAll('"', '""')}"`;
const round = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;
