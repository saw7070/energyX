import {
  ENERGY_FACT_WRITER_CONTRACT_VERSION,
  type EnergyFactMaterializationBatchWrite,
  type EnergyIntervalFactWrite,
  type EnergyNormalizedReadingWrite,
  type EnergyQualityEventWrite,
  type EnergyRawReadingWrite,
} from "@datafoundry/data-gateway";
import type {
  EnergyIqImportBatchRecord,
  EnergyIqMeterMappingDraft,
  EnergyIqProjectSetupDocument,
} from "@datafoundry/metadata";
import {
  fingerprintEnergyIqMeterMapping,
  fingerprintEnergyIqMeterMappingExcludingDisplayNames,
} from "@datafoundry/metadata";

import { readEnergyExcelWorkbook, type EnergyExcelWorkbook } from "./energy-excel-import.js";
import { readEnergyTuyaArtifact } from "./energy-tuya-import.js";

const zonedPartsFormatters = new Map<string, Intl.DateTimeFormat>();
const weekdayFormatters = new Map<string, Intl.DateTimeFormat>();

export type EnergyImportMaterializationSummary = {
  rawRowCount: number;
  normalizedReadingCount: number;
  intervalFactCount: number;
  totalUsageKwh: number;
  qualityCounts: Record<string, number>;
  mappingRevision: number;
  mappingFingerprint: string;
  /**
   * The mapping identity without its display labels. Batches materialized
   * before this field existed carry only `mappingFingerprint`, so a reader that
   * needs this identity for them resolves it from the revision that fingerprint
   * names.
   */
  mappingFingerprintExcludingDisplayNames?: string;
  timezone: string;
  materializerContractVersion: typeof ENERGY_EXCEL_MATERIALIZER_CONTRACT_VERSION
    | typeof ENERGY_EXCEL_INTERVAL_MATRIX_MATERIALIZER_CONTRACT_VERSION
    | typeof ENERGY_TUYA_MATERIALIZER_CONTRACT_VERSION;
  factWriterContractVersion: typeof ENERGY_FACT_WRITER_CONTRACT_VERSION;
  sourceSheetName: string;
  sourceRowCount: number;
  sourceLabels: string[];
  sourceCoverageFrom?: string;
  sourceCoverageTo?: string;
};

export const ENERGY_EXCEL_MATERIALIZER_CONTRACT_VERSION = "energy-excel-cumulative-v2" as const;
export const ENERGY_EXCEL_HISTORICAL_MATERIALIZER_CONTRACT_VERSIONS = [
  "energy-excel-cumulative-v1",
] as const;
export const ENERGY_EXCEL_INTERVAL_MATRIX_MATERIALIZER_CONTRACT_VERSION = "energy-excel-preschool-interval-matrix-v1" as const;
export const ENERGY_TUYA_MATERIALIZER_CONTRACT_VERSION = "energy-tuya-event-resampled-15m-v2" as const;

/**
 * Materializers that key a reading to a meter by `source_label`, so the meter's
 * display name cannot change a row they produce. The interval matrix is absent
 * deliberately: it finds a meter's column in the spreadsheet by display name.
 */
const LABEL_INDEPENDENT_MATERIALIZER_CONTRACT_VERSIONS: ReadonlySet<string> = new Set([
  ENERGY_EXCEL_MATERIALIZER_CONTRACT_VERSION,
  ENERGY_TUYA_MATERIALIZER_CONTRACT_VERSION,
]);

export const isEnergyImportMaterializationCurrent = (input: {
  batch: EnergyIqImportBatchRecord;
  document: EnergyIqProjectSetupDocument;
  timezone: string;
  /**
   * Returns the mapping a past `mappingFingerprint` was taken from, letting a
   * batch stamped before {@link EnergyImportMaterializationSummary.mappingFingerprintExcludingDisplayNames}
   * existed still prove it differs from the current mapping in labels alone.
   */
  resolveMappingByFingerprint?: (fingerprint: string) => EnergyIqMeterMappingDraft | undefined;
}): boolean => {
  const mapping = input.document.meter_mapping;
  if (input.batch.status !== "materialized" || !mapping?.confirmed || !input.batch.materialization_json) {
    return false;
  }
  let summary: unknown;
  try {
    summary = JSON.parse(input.batch.materialization_json) as unknown;
  } catch {
    return false;
  }
  if (!isRecord(summary)) return false;
  if (summary.timezone !== input.timezone
    || summary.factWriterContractVersion !== ENERGY_FACT_WRITER_CONTRACT_VERSION
    || (summary.materializerContractVersion !== ENERGY_EXCEL_MATERIALIZER_CONTRACT_VERSION
      && summary.materializerContractVersion !== ENERGY_EXCEL_INTERVAL_MATRIX_MATERIALIZER_CONTRACT_VERSION
      && summary.materializerContractVersion !== ENERGY_TUYA_MATERIALIZER_CONTRACT_VERSION)) {
    return false;
  }
  if (summary.mappingFingerprint === fingerprintEnergyIqMeterMapping(mapping)) return true;
  // Renaming a meter moves the mapping fingerprint without moving a single row.
  // Keeping the rows costs one more comparison; re-deriving them costs a
  // re-parse of every batch the project has ever imported.
  if (typeof summary.materializerContractVersion !== "string"
    || !LABEL_INDEPENDENT_MATERIALIZER_CONTRACT_VERSIONS.has(summary.materializerContractVersion)) {
    return false;
  }
  const expected = fingerprintEnergyIqMeterMappingExcludingDisplayNames(mapping);
  if (summary.mappingFingerprintExcludingDisplayNames === expected) return true;
  if (typeof summary.mappingFingerprint !== "string") return false;
  const materializedUnder = input.resolveMappingByFingerprint?.(summary.mappingFingerprint);
  return materializedUnder !== undefined
    && fingerprintEnergyIqMeterMappingExcludingDisplayNames(materializedUnder) === expected;
};

export const buildEnergyExcelMaterialization = async (input: {
  content: Buffer;
  batch: EnergyIqImportBatchRecord;
  document: EnergyIqProjectSetupDocument;
  mappingRevision: number;
  timezone: string;
}): Promise<{
  write: EnergyFactMaterializationBatchWrite;
  summary: EnergyImportMaterializationSummary;
}> => {
  const workbook = await readEnergyExcelWorkbook(input.content);
  if (workbook.inspection.readingKind === "preschool_interval_usage_matrix") {
    return buildIntervalMatrixMaterialization({ ...input, workbook });
  }
  return buildCumulativeEnergyMaterialization({
    ...input,
    workbook,
    materializerContractVersion: ENERGY_EXCEL_MATERIALIZER_CONTRACT_VERSION,
  });
};

export const buildEnergyTuyaMaterialization = async (input: {
  content: Buffer;
  batch: EnergyIqImportBatchRecord;
  document: EnergyIqProjectSetupDocument;
  mappingRevision: number;
  timezone: string;
}): Promise<{
  write: EnergyFactMaterializationBatchWrite;
  summary: EnergyImportMaterializationSummary;
}> => buildCumulativeEnergyMaterialization({
  ...input,
  workbook: readEnergyTuyaArtifact(input.content),
  materializerContractVersion: ENERGY_TUYA_MATERIALIZER_CONTRACT_VERSION,
});

const buildCumulativeEnergyMaterialization = (input: {
  batch: EnergyIqImportBatchRecord;
  document: EnergyIqProjectSetupDocument;
  mappingRevision: number;
  timezone: string;
  workbook: EnergyExcelWorkbook;
  materializerContractVersion: typeof ENERGY_EXCEL_MATERIALIZER_CONTRACT_VERSION
    | typeof ENERGY_TUYA_MATERIALIZER_CONTRACT_VERSION;
}): {
  write: EnergyFactMaterializationBatchWrite;
  summary: EnergyImportMaterializationSummary;
} => {
  const mapping = input.document.meter_mapping;
  if (!mapping?.confirmed) throw new Error("ENERGYIQ_METER_MAPPING_NOT_CONFIRMED");
  const mappingByLabel = new Map(mapping.rows.map((row) => [row.source_label, row]));
  const nodesById = new Map(input.document.nodes.map((node) => [node.id, node]));
  const workbook = input.workbook;
  const qualityEvents: EnergyQualityEventWrite[] = [];
  const conflictRows = new Set<number>();
  const deduplicated = new Map<string, EnergyNormalizedReadingWrite>();
  const candidateBySourceRow = new Map<number, EnergyNormalizedReadingWrite>();
  const isTuyaEventSource = input.materializerContractVersion === ENERGY_TUYA_MATERIALIZER_CONTRACT_VERSION;
  const normalizedReadingKind: EnergyNormalizedReadingWrite["sourceReadingKind"] = isTuyaEventSource
    ? "cumulative_energy_event"
    : "cumulative_energy";

  for (const row of workbook.rows) {
    const mapped = mappingByLabel.get(row.sourceLabel);
    if (row.validationError) {
      qualityEvents.push(qualityEvent(input.batch, {
        sourceLabel: row.sourceLabel,
        code: row.validationError,
        severity: "error",
        details: { sourceRowNumber: row.sourceRowNumber },
      }, normalizedReadingKind));
      continue;
    }
    if (!mapped) {
      qualityEvents.push(qualityEvent(input.batch, {
        sourceLabel: row.sourceLabel,
        code: "unmapped_source_label",
        severity: "error",
        details: { sourceRowNumber: row.sourceRowNumber },
      }, normalizedReadingKind));
      continue;
    }
    if ((!row.eventTime && !row.localTimestamp) || row.activeEnergyKwh === undefined) continue;
    const eventTime = row.eventTime ?? localTimestampToUtc(row.localTimestamp!, input.timezone);
    const candidate: EnergyNormalizedReadingWrite = {
      workspaceId: input.batch.workspace_id,
      projectId: input.batch.project_id,
      importBatchId: input.batch.id,
      resource: mapped.resource,
      meterPointId: mapped.id,
      scopeId: mapped.scope_id,
      ...(nodesById.get(mapped.scope_id)?.parent_id
        ? { parentNodeId: nodesById.get(mapped.scope_id)!.parent_id }
        : {}),
      sourceLabel: row.sourceLabel,
      category: mapped.category,
      meterRole: mapped.meter_role,
      eventTime,
      activeEnergyKwh: row.activeEnergyKwh,
      sourceFile: input.batch.filename,
      sourceSha256: input.batch.source_sha256,
      sourceRowNumber: row.sourceRowNumber,
      sourceReadingKind: normalizedReadingKind,
    };
    candidateBySourceRow.set(row.sourceRowNumber, candidate);
    const key = `${mapped.id}\u0000${eventTime}`;
    const existing = deduplicated.get(key);
    if (existing) {
      const conflict = existing.activeEnergyKwh !== candidate.activeEnergyKwh;
      if (conflict) {
        conflictRows.add(existing.sourceRowNumber);
        conflictRows.add(candidate.sourceRowNumber);
      }
      qualityEvents.push(qualityEvent(input.batch, {
        meterPointId: mapped.id,
        sourceLabel: row.sourceLabel,
        eventTime,
        code: conflict ? "duplicate_reading_conflict" : "duplicate_reading",
        severity: conflict ? "error" : "warning",
        details: {
          keptSourceRowNumber: candidate.sourceRowNumber,
          replacedSourceRowNumber: existing.sourceRowNumber,
        },
      }, normalizedReadingKind));
    }
    deduplicated.set(key, candidate);
  }

  const normalizedReadings = [...deduplicated.values()].sort(
    (left, right) => left.meterPointId.localeCompare(right.meterPointId)
      || left.eventTime.localeCompare(right.eventTime),
  );
  const readingsByMeter = new Map<string, EnergyNormalizedReadingWrite[]>();
  for (const reading of normalizedReadings) {
    const meterReadings = readingsByMeter.get(reading.meterPointId);
    if (meterReadings) {
      meterReadings.push(reading);
    } else {
      readingsByMeter.set(reading.meterPointId, [reading]);
    }
  }
  const intervalFacts = isTuyaEventSource
    ? buildTuyaAlignedIntervalFacts({
      batch: input.batch,
      readingsByMeter,
      qualityEvents,
      timezone: input.timezone,
    })
    : buildPreservedCumulativeIntervalFacts({
      batch: input.batch,
      readingsByMeter,
      qualityEvents,
      timezone: input.timezone,
      typicalIntervalMinutes: workbook.inspection.typicalIntervalMinutes ?? 15,
    });

  const rawReadings: EnergyRawReadingWrite[] = workbook.rows.map((row) => {
    const mapped = mappingByLabel.get(row.sourceLabel);
    const candidate = candidateBySourceRow.get(row.sourceRowNumber);
    return {
      workspaceId: input.batch.workspace_id,
      projectId: input.batch.project_id,
      importBatchId: input.batch.id,
      resource: mapped?.resource ?? "electricity",
      sourceLabel: row.sourceLabel,
      ...(mapped ? { meterPointId: mapped.id, scopeId: mapped.scope_id } : {}),
      ...(candidate ? { eventTime: candidate.eventTime } : {}),
      ...(row.activeEnergyKwh === undefined ? {} : { activeEnergyKwh: row.activeEnergyKwh }),
      sourceFile: input.batch.filename,
      sourceSha256: input.batch.source_sha256,
      sourceRowNumber: row.sourceRowNumber,
      isValid: !row.validationError && Boolean(mapped),
      ...((row.validationError ?? (!mapped ? "unmapped_source_label" : undefined))
        ? { validationError: row.validationError ?? "unmapped_source_label" }
        : {}),
      isOverlapConflict: conflictRows.has(row.sourceRowNumber),
    };
  });
  const qualityCounts = countQuality([
    ...intervalFacts.filter((fact) => fact.qualityStatus === "ok").map(() => "ok"),
    ...qualityEvents.map((event) => event.code),
  ]);
  const summary: EnergyImportMaterializationSummary = {
    rawRowCount: rawReadings.length,
    normalizedReadingCount: normalizedReadings.length,
    intervalFactCount: intervalFacts.length,
    totalUsageKwh: round(intervalFacts.reduce((sum, fact) => sum + (fact.usageKwh ?? 0), 0)),
    qualityCounts,
    mappingRevision: input.mappingRevision,
    mappingFingerprint: fingerprintEnergyIqMeterMapping(mapping),
    mappingFingerprintExcludingDisplayNames: fingerprintEnergyIqMeterMappingExcludingDisplayNames(mapping),
    timezone: input.timezone,
    materializerContractVersion: input.materializerContractVersion,
    factWriterContractVersion: ENERGY_FACT_WRITER_CONTRACT_VERSION,
    sourceSheetName: workbook.inspection.sheetName,
    sourceRowCount: workbook.inspection.rowCount,
    sourceLabels: workbook.inspection.sourceLabels.map((source) => source.label),
    ...(workbook.inspection.coverageFrom ? { sourceCoverageFrom: workbook.inspection.coverageFrom } : {}),
    ...(workbook.inspection.coverageTo ? { sourceCoverageTo: workbook.inspection.coverageTo } : {}),
  };
  return {
    write: {
      importBatchId: input.batch.id,
      sourceSha256: input.batch.source_sha256,
      rawReadings,
      normalizedReadings,
      intervalFacts,
      qualityEvents,
    },
    summary,
  };
};

const TUYA_CANONICAL_INTERVAL_MINUTES = 15;

const buildTuyaAlignedIntervalFacts = (input: {
  batch: EnergyIqImportBatchRecord;
  readingsByMeter: Map<string, EnergyNormalizedReadingWrite[]>;
  qualityEvents: EnergyQualityEventWrite[];
  timezone: string;
}): EnergyIntervalFactWrite[] => {
  const intervalFacts: EnergyIntervalFactWrite[] = [];
  const intervalMs = TUYA_CANONICAL_INTERVAL_MINUTES * 60_000;
  for (const readings of input.readingsByMeter.values()) {
    readings.sort((left, right) => left.eventTime.localeCompare(right.eventTime));
    const first = readings[0];
    const last = readings.at(-1);
    if (!first || !last) continue;
    input.qualityEvents.push(qualityEvent(input.batch, {
      meterPointId: first.meterPointId,
      sourceLabel: first.sourceLabel,
      eventTime: first.eventTime,
      code: "boundary",
      severity: "warning",
      details: { reason: "No earlier Tuya cumulative event exists inside this Import Batch." },
    }, "cumulative_energy_event"));

    let negativePairCount = 0;
    for (let index = 1; index < readings.length; index += 1) {
      const previous = readings[index - 1]!;
      const current = readings[index]!;
      const rawDeltaKwh = current.activeEnergyKwh - previous.activeEnergyKwh;
      if (rawDeltaKwh >= 0) continue;
      negativePairCount += 1;
      input.qualityEvents.push(qualityEvent(input.batch, {
        meterPointId: current.meterPointId,
        sourceLabel: current.sourceLabel,
        eventTime: current.eventTime,
        code: "negative_delta",
        severity: "error",
        details: {
          intervalStart: previous.eventTime,
          intervalEnd: current.eventTime,
          rawDeltaKwh,
        },
      }, "cumulative_energy_event"));
    }

    const firstTimestamp = Date.parse(first.eventTime);
    const lastTimestamp = Date.parse(last.eventTime);
    const firstAlignedStart = Math.ceil(firstTimestamp / intervalMs) * intervalMs;
    let emittedIntervalCount = 0;
    for (let intervalStart = firstAlignedStart; intervalStart + intervalMs <= lastTimestamp; intervalStart += intervalMs) {
      const intervalEnd = intervalStart + intervalMs;
      if (hasNegativeDeltaInRange(readings, intervalStart, intervalEnd)) continue;
      const previousActiveEnergyKwh = interpolateCumulativeReading(readings, intervalStart);
      const activeEnergyKwh = interpolateCumulativeReading(readings, intervalEnd);
      if (previousActiveEnergyKwh === undefined || activeEnergyKwh === undefined) continue;
      const rawDeltaKwh = activeEnergyKwh - previousActiveEnergyKwh;
      if (rawDeltaKwh < -1e-9) continue;
      const usageKwh = Math.max(0, rawDeltaKwh);
      const intervalStartIso = new Date(intervalStart).toISOString();
      const local = localParts(intervalStartIso, input.timezone);
      intervalFacts.push({
        workspaceId: first.workspaceId,
        projectId: first.projectId,
        importBatchId: first.importBatchId,
        resource: first.resource,
        meterPointId: first.meterPointId,
        scopeId: first.scopeId,
        ...(first.parentNodeId ? { parentNodeId: first.parentNodeId } : {}),
        sourceLabel: first.sourceLabel,
        category: first.category,
        meterRole: first.meterRole,
        intervalStart: intervalStartIso,
        intervalEnd: new Date(intervalEnd).toISOString(),
        elapsedMinutes: TUYA_CANONICAL_INTERVAL_MINUTES,
        activeEnergyKwh,
        previousActiveEnergyKwh,
        rawDeltaKwh: usageKwh,
        usageKwh,
        averageKw: usageKwh * (60 / TUYA_CANONICAL_INTERVAL_MINUTES),
        qualityStatus: "ok",
        localDate: local.date,
        localHour: local.hour,
        dayType: local.dayType,
        sourceFile: first.sourceFile,
        sourceSha256: first.sourceSha256,
        sourceReadingKind: "interval_usage",
      });
      emittedIntervalCount += 1;
    }
    input.qualityEvents.push(qualityEvent(input.batch, {
      meterPointId: first.meterPointId,
      sourceLabel: first.sourceLabel,
      eventTime: last.eventTime,
      code: "tuya_event_readings_resampled",
      severity: "warning",
      details: {
        method: "piecewise_linear_cumulative_interpolation",
        targetIntervalMinutes: TUYA_CANONICAL_INTERVAL_MINUTES,
        sourceReadingCount: readings.length,
        emittedIntervalCount,
        negativePairCount,
        sourceCoverageFrom: first.eventTime,
        sourceCoverageTo: last.eventTime,
        partialBoundaryIntervalsExcluded: true,
      },
    }, "cumulative_energy_event"));
  }
  return intervalFacts;
};

const buildPreservedCumulativeIntervalFacts = (input: {
  batch: EnergyIqImportBatchRecord;
  readingsByMeter: Map<string, EnergyNormalizedReadingWrite[]>;
  qualityEvents: EnergyQualityEventWrite[];
  timezone: string;
  typicalIntervalMinutes: number;
}): EnergyIntervalFactWrite[] => {
  const intervalFacts: EnergyIntervalFactWrite[] = [];
  const intervalToleranceMinutes = Math.max(0.1, input.typicalIntervalMinutes * 0.01);
  for (const readings of input.readingsByMeter.values()) {
    readings.sort((left, right) => left.eventTime.localeCompare(right.eventTime));
    const first = readings[0];
    if (first) {
      input.qualityEvents.push(qualityEvent(input.batch, {
        meterPointId: first.meterPointId,
        sourceLabel: first.sourceLabel,
        eventTime: first.eventTime,
        code: "boundary",
        severity: "warning",
        details: { reason: "No previous cumulative reading exists inside this Import Batch." },
      }));
    }
    for (let index = 1; index < readings.length; index += 1) {
      const previous = readings[index - 1]!;
      const current = readings[index]!;
      const elapsedMinutes = (Date.parse(current.eventTime) - Date.parse(previous.eventTime)) / 60_000;
      const rawDeltaKwh = current.activeEnergyKwh - previous.activeEnergyKwh;
      const qualityStatus = rawDeltaKwh < 0
        ? "negative_delta"
        : elapsedMinutes > input.typicalIntervalMinutes + intervalToleranceMinutes
          ? "gap"
          : elapsedMinutes < input.typicalIntervalMinutes - intervalToleranceMinutes
            ? "irregular_interval"
            : "ok";
      const aggregateEligible = qualityStatus === "ok" || qualityStatus === "gap";
      const usageKwh = aggregateEligible ? rawDeltaKwh : undefined;
      const local = localParts(previous.eventTime, input.timezone);
      intervalFacts.push({
        workspaceId: current.workspaceId,
        projectId: current.projectId,
        importBatchId: current.importBatchId,
        resource: current.resource,
        meterPointId: current.meterPointId,
        scopeId: current.scopeId,
        ...(current.parentNodeId ? { parentNodeId: current.parentNodeId } : {}),
        sourceLabel: current.sourceLabel,
        category: current.category,
        meterRole: current.meterRole,
        intervalStart: previous.eventTime,
        intervalEnd: current.eventTime,
        elapsedMinutes,
        activeEnergyKwh: current.activeEnergyKwh,
        previousActiveEnergyKwh: previous.activeEnergyKwh,
        rawDeltaKwh,
        ...(usageKwh === undefined ? {} : {
          usageKwh,
          averageKw: usageKwh / (elapsedMinutes / 60),
        }),
        qualityStatus,
        localDate: local.date,
        localHour: local.hour,
        dayType: local.dayType,
        sourceFile: current.sourceFile,
        sourceSha256: current.sourceSha256,
        sourceReadingKind: "cumulative_energy",
      });
      if (qualityStatus !== "ok") {
        input.qualityEvents.push(qualityEvent(input.batch, {
          meterPointId: current.meterPointId,
          sourceLabel: current.sourceLabel,
          eventTime: current.eventTime,
          code: qualityStatus,
          severity: qualityStatus === "negative_delta" ? "error" : "warning",
          details: { elapsedMinutes, rawDeltaKwh },
        }));
      }
    }
  }
  return intervalFacts;
};

const interpolateCumulativeReading = (
  readings: EnergyNormalizedReadingWrite[],
  timestamp: number,
): number | undefined => {
  const rightIndex = lowerBoundReadingIndex(readings, timestamp);
  const right = readings[rightIndex];
  if (!right) return undefined;
  const rightTimestamp = Date.parse(right.eventTime);
  if (rightTimestamp === timestamp) return right.activeEnergyKwh;
  const left = readings[rightIndex - 1];
  if (!left) return undefined;
  const leftTimestamp = Date.parse(left.eventTime);
  const elapsed = rightTimestamp - leftTimestamp;
  if (elapsed <= 0) return undefined;
  const fraction = (timestamp - leftTimestamp) / elapsed;
  return left.activeEnergyKwh + ((right.activeEnergyKwh - left.activeEnergyKwh) * fraction);
};

const hasNegativeDeltaInRange = (
  readings: EnergyNormalizedReadingWrite[],
  intervalStart: number,
  intervalEnd: number,
): boolean => {
  let rightIndex = Math.max(1, lowerBoundReadingIndex(readings, intervalStart));
  while (rightIndex < readings.length) {
    const left = readings[rightIndex - 1]!;
    const right = readings[rightIndex]!;
    const leftTimestamp = Date.parse(left.eventTime);
    const rightTimestamp = Date.parse(right.eventTime);
    if (leftTimestamp >= intervalEnd) break;
    if (rightTimestamp > intervalStart && right.activeEnergyKwh < left.activeEnergyKwh) return true;
    rightIndex += 1;
  }
  return false;
};

const lowerBoundReadingIndex = (readings: EnergyNormalizedReadingWrite[], timestamp: number): number => {
  let low = 0;
  let high = readings.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (Date.parse(readings[middle]!.eventTime) < timestamp) low = middle + 1;
    else high = middle;
  }
  return low;
};

const buildIntervalMatrixMaterialization = (input: {
  batch: EnergyIqImportBatchRecord;
  document: EnergyIqProjectSetupDocument;
  mappingRevision: number;
  timezone: string;
  workbook: EnergyExcelWorkbook;
}): {
  write: EnergyFactMaterializationBatchWrite;
  summary: EnergyImportMaterializationSummary;
} => {
  const mapping = input.document.meter_mapping!;
  const nodesById = new Map(input.document.nodes.map((node) => [node.id, node]));
  const mappingByEntityMeter = new Map<string, typeof mapping.rows[number]>();
  for (const row of mapping.rows) {
    const scopeNode = nodesById.get(row.scope_id);
    const parent = scopeNode?.parent_id ? nodesById.get(scopeNode.parent_id) : undefined;
    const centreCode = parent && isRecord(parent.metadata) && typeof parent.metadata.centreCode === "string"
      ? parent.metadata.centreCode
      : undefined;
    if (centreCode) mappingByEntityMeter.set(matrixKey(centreCode, row.display_name), row);
  }
  const rawReadings: EnergyRawReadingWrite[] = [];
  const intervalFacts: EnergyIntervalFactWrite[] = [];
  const qualityEvents: EnergyQualityEventWrite[] = [];
  for (const row of input.workbook.rows) {
    const mapped = row.entityCode
      ? mappingByEntityMeter.get(matrixKey(row.entityCode, meterLabelFromSource(row.sourceLabel)))
      : undefined;
    const validationError = row.validationError ?? (!mapped ? "unmapped_source_label" : undefined);
    const localStart = row.localDate !== undefined && row.localHour !== undefined
      ? `${row.localDate}T${row.localHour.toString().padStart(2, "0")}:00:00`
      : undefined;
    const intervalStart = localStart ? localTimestampToUtc(localStart, input.timezone) : undefined;
    rawReadings.push({
      workspaceId: input.batch.workspace_id,
      projectId: input.batch.project_id,
      importBatchId: input.batch.id,
      resource: mapped?.resource ?? "electricity",
      sourceLabel: row.sourceLabel,
      ...(mapped ? { meterPointId: mapped.id, scopeId: mapped.scope_id } : {}),
      ...(intervalStart ? { eventTime: intervalStart } : {}),
      ...(row.usageKwh === undefined ? {} : { activeEnergyKwh: row.usageKwh }),
      sourceFile: input.batch.filename,
      sourceSha256: input.batch.source_sha256,
      sourceRowNumber: row.sourceRowNumber,
      isValid: validationError === undefined,
      ...(validationError ? { validationError } : {}),
      isOverlapConflict: false,
    });
    if (validationError || !mapped || !intervalStart || row.usageKwh === undefined
      || row.localDate === undefined || row.localHour === undefined) {
      qualityEvents.push(qualityEvent(input.batch, {
        ...(mapped ? { meterPointId: mapped.id } : {}),
        sourceLabel: row.sourceLabel,
        ...(intervalStart ? { eventTime: intervalStart } : {}),
        code: validationError ?? "invalid_interval_usage",
        severity: "error",
        details: { sourceRowNumber: row.sourceRowNumber, sourceColumn: row.sourceColumn },
      }, "interval_usage"));
      continue;
    }
    const parentNodeId = nodesById.get(mapped.scope_id)?.parent_id;
    intervalFacts.push({
      workspaceId: input.batch.workspace_id,
      projectId: input.batch.project_id,
      importBatchId: input.batch.id,
      resource: mapped.resource,
      meterPointId: mapped.id,
      scopeId: mapped.scope_id,
      ...(parentNodeId ? { parentNodeId } : {}),
      sourceLabel: mapped.display_name,
      category: mapped.category,
      meterRole: mapped.meter_role,
      intervalStart,
      intervalEnd: new Date(Date.parse(intervalStart) + 60 * 60_000).toISOString(),
      elapsedMinutes: 60,
      activeEnergyKwh: row.usageKwh,
      previousActiveEnergyKwh: 0,
      rawDeltaKwh: row.usageKwh,
      usageKwh: row.usageKwh,
      averageKw: row.usageKwh,
      qualityStatus: "ok",
      localDate: row.localDate,
      localHour: row.localHour,
      dayType: dayTypeForLocalDate(row.localDate),
      sourceFile: input.batch.filename,
      sourceSha256: input.batch.source_sha256,
      sourceReadingKind: "interval_usage",
    });
  }
  const summary: EnergyImportMaterializationSummary = {
    rawRowCount: rawReadings.length,
    normalizedReadingCount: 0,
    intervalFactCount: intervalFacts.length,
    totalUsageKwh: round(intervalFacts.reduce((sum, fact) => sum + (fact.usageKwh ?? 0), 0)),
    qualityCounts: countQuality([
      ...intervalFacts.map(() => "ok"),
      ...qualityEvents.map((event) => event.code),
    ]),
    mappingRevision: input.mappingRevision,
    mappingFingerprint: fingerprintEnergyIqMeterMapping(mapping),
    timezone: input.timezone,
    materializerContractVersion: ENERGY_EXCEL_INTERVAL_MATRIX_MATERIALIZER_CONTRACT_VERSION,
    factWriterContractVersion: ENERGY_FACT_WRITER_CONTRACT_VERSION,
    sourceSheetName: input.workbook.inspection.sheetName,
    sourceRowCount: input.workbook.inspection.rowCount,
    sourceLabels: input.workbook.inspection.sourceLabels.map((source) => source.label),
    ...(input.workbook.inspection.coverageFrom ? { sourceCoverageFrom: input.workbook.inspection.coverageFrom } : {}),
    ...(input.workbook.inspection.coverageTo ? { sourceCoverageTo: input.workbook.inspection.coverageTo } : {}),
  };
  return {
    write: {
      importBatchId: input.batch.id,
      sourceSha256: input.batch.source_sha256,
      rawReadings,
      normalizedReadings: [],
      intervalFacts,
      qualityEvents,
    },
    summary,
  };
};

const qualityEvent = (
  batch: EnergyIqImportBatchRecord,
  event: Omit<EnergyQualityEventWrite, "workspaceId" | "projectId" | "importBatchId" | "sourceReadingKind">,
  sourceReadingKind: EnergyQualityEventWrite["sourceReadingKind"] = "cumulative_energy",
): EnergyQualityEventWrite => ({
  workspaceId: batch.workspace_id,
  projectId: batch.project_id,
  importBatchId: batch.id,
  sourceReadingKind,
  ...event,
});

const matrixKey = (entityCode: string, meterLabel: string): string =>
  `${entityCode.trim().toLocaleLowerCase()}\u0000${meterLabel.trim().replace(/\s+/g, " ").toLocaleLowerCase()}`;

const meterLabelFromSource = (sourceLabel: string): string => {
  const separator = sourceLabel.indexOf(":");
  return separator >= 0 ? sourceLabel.slice(separator + 1) : sourceLabel;
};

const dayTypeForLocalDate = (localDate: string): string => {
  const day = new Date(`${localDate}T00:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6 ? "weekend" : "weekday";
};

const localTimestampToUtc = (value: string, timezone: string): string => {
  const explicit = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
  if (explicit) {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) throw new Error(`ENERGYIQ_TIMESTAMP_INVALID:${value}`);
    return new Date(timestamp).toISOString();
  }
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) throw new Error(`ENERGYIQ_TIMESTAMP_INVALID:${value}`);
  const parts = match.slice(1).map(Number);
  const localAsUtc = Date.UTC(parts[0]!, parts[1]! - 1, parts[2]!, parts[3]!, parts[4]!, parts[5] ?? 0);
  let guess = localAsUtc;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const zoned = zonedParts(new Date(guess), timezone);
    const zonedAsUtc = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, zoned.second);
    const next = localAsUtc - (zonedAsUtc - guess);
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess).toISOString();
};

const localParts = (timestamp: string, timezone: string): { date: string; hour: number; dayType: string } => {
  const date = new Date(timestamp);
  const parts = zonedParts(date, timezone);
  const weekday = formatterFor(weekdayFormatters, timezone, {
    timeZone: timezone,
    weekday: "short",
  }).format(date);
  return {
    date: `${parts.year.toString().padStart(4, "0")}-${parts.month.toString().padStart(2, "0")}-${parts.day.toString().padStart(2, "0")}`,
    hour: parts.hour,
    dayType: weekday === "Sat" || weekday === "Sun" ? "weekend" : "weekday",
  };
};

const zonedParts = (date: Date, timezone: string) => {
  const formatter = formatterFor(zonedPartsFormatters, timezone, {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const values = new Map(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(values.get("year")),
    month: Number(values.get("month")),
    day: Number(values.get("day")),
    hour: Number(values.get("hour")),
    minute: Number(values.get("minute")),
    second: Number(values.get("second")),
  };
};

const formatterFor = (
  cache: Map<string, Intl.DateTimeFormat>,
  timezone: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat => {
  const cached = cache.get(timezone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-CA", options);
  cache.set(timezone, formatter);
  return formatter;
};

const countQuality = (codes: string[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const code of codes) counts[code] = (counts[code] ?? 0) + 1;
  return counts;
};

const round = (value: number): number => Math.round(value * 1_000_000) / 1_000_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
