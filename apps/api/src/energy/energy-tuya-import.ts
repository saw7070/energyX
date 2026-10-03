import {
  TUYA_REPORT_LOG_ARTIFACT_VERSION,
  type TuyaReportLogArtifact,
} from "./tuya-openapi-client.js";
import type { EnergyExcelWorkbook, EnergyExcelSourceRow } from "./energy-excel-import.js";

export const inspectEnergyTuyaArtifact = (content: Buffer) => readEnergyTuyaArtifact(content).inspection;

export const readEnergyTuyaArtifact = (content: Buffer): EnergyExcelWorkbook => {
  const artifact = parseArtifact(content);
  const rows: EnergyExcelSourceRow[] = [];
  const labelCounts = new Map<string, number>();
  const timestampsByLabel = new Map<string, number[]>();
  const readingKeys = new Set<string>();
  const issues: string[] = [];
  let duplicateReadingCount = 0;
  let negativeReadingCount = 0;
  let sourceRowNumber = 1;
  let coverageFrom: number | undefined;
  let coverageTo: number | undefined;

  for (const device of artifact.devices) {
    const scale = device.properties.totalForwardEnergy.scale;
    // Older artifacts never recorded a code other than the single-phase one.
    const energyCode = device.properties.totalForwardEnergy.code || "total_forward_energy";
    const energyLogs = device.logs.filter((log) => log.code === energyCode);
    labelCounts.set(device.sourceLabel, 0);
    if (energyLogs.length === 0) issues.push(`${device.sourceLabel} has no cumulative energy readings in the requested window.`);
    for (const log of energyLogs) {
      sourceRowNumber += 1;
      const rawValue = numericValue(log.value);
      const activeEnergyKwh = rawValue === undefined ? undefined : rawValue / (10 ** scale);
      const eventTime = safeIsoTimestamp(log.eventTime);
      const validationError = eventTime === undefined
        ? "invalid_timestamp" as const
        : activeEnergyKwh === undefined
          ? "invalid_active_energy" as const
          : activeEnergyKwh < 0
            ? "negative_active_energy" as const
            : undefined;
      rows.push({
        sourceRowNumber,
        sourceLabel: device.sourceLabel,
        ...(eventTime ? { eventTime } : {}),
        ...(activeEnergyKwh === undefined ? {} : { activeEnergyKwh }),
        ...(validationError ? { validationError } : {}),
      });
      if (validationError) {
        if (validationError === "negative_active_energy") negativeReadingCount += 1;
        continue;
      }
      if (!eventTime || activeEnergyKwh === undefined) continue;
      const timestamp = Date.parse(eventTime);
      labelCounts.set(device.sourceLabel, (labelCounts.get(device.sourceLabel) ?? 0) + 1);
      timestampsByLabel.set(device.sourceLabel, [...(timestampsByLabel.get(device.sourceLabel) ?? []), timestamp]);
      const key = `${device.sourceLabel}\u0000${eventTime}`;
      if (readingKeys.has(key)) duplicateReadingCount += 1;
      readingKeys.add(key);
      coverageFrom = coverageFrom === undefined ? timestamp : Math.min(coverageFrom, timestamp);
      coverageTo = coverageTo === undefined ? timestamp : Math.max(coverageTo, timestamp);
    }
  }

  const intervals: number[] = [];
  for (const timestamps of timestampsByLabel.values()) {
    const sorted = [...new Set(timestamps)].sort((left, right) => left - right);
    for (let index = 1; index < sorted.length; index += 1) {
      const minutes = (sorted[index]! - sorted[index - 1]!) / 60_000;
      if (minutes > 0 && Number.isFinite(minutes)) intervals.push(minutes);
    }
  }
  intervals.sort((left, right) => left - right);
  const typicalIntervalMinutes = intervals.length > 0 ? intervals[Math.floor(intervals.length / 2)] : undefined;
  const invalidRowCount = rows.filter((row) => row.validationError).length;
  if (invalidRowCount > 0) issues.push(`${invalidRowCount} Tuya cumulative reading(s) are invalid.`);
  if (duplicateReadingCount > 0) issues.push(`${duplicateReadingCount} duplicate device/time reading(s) require deterministic de-duplication.`);
  if (negativeReadingCount > 0) issues.push(`${negativeReadingCount} cumulative reading(s) are negative.`);

  return {
    inspection: {
      sheetName: "Tuya report-logs",
      columns: ["Device Name", "Device ID", "Code", "Event Time", "Raw Value", "Scale", "Active Energy (kWh)"],
      sourceLabels: [...labelCounts.entries()]
        .map(([label, rowCount]) => ({ label, rowCount }))
        .sort((left, right) => left.label.localeCompare(right.label)),
      rowCount: rows.length,
      validRowCount: rows.length - invalidRowCount,
      invalidRowCount,
      duplicateReadingCount,
      negativeReadingCount,
      ...(coverageFrom === undefined ? {} : { coverageFrom: new Date(coverageFrom).toISOString() }),
      ...(coverageTo === undefined ? {} : { coverageTo: new Date(coverageTo).toISOString() }),
      ...(typicalIntervalMinutes === undefined ? {} : { typicalIntervalMinutes }),
      readingKind: "cumulative",
      qualityStatus: issues.length === 0 ? "ready" : "needs_review",
      issues,
    },
    rows,
  };
};

const parseArtifact = (content: Buffer): TuyaReportLogArtifact => {
  let value: unknown;
  try {
    value = JSON.parse(content.toString("utf8")) as unknown;
  } catch {
    throw new Error("ENERGYIQ_TUYA_ARTIFACT_INVALID");
  }
  if (!isRecord(value)
    || value.schemaVersion !== TUYA_REPORT_LOG_ARTIFACT_VERSION
    || value.provider !== "tuya"
    || !Array.isArray(value.devices)) {
    throw new Error("ENERGYIQ_TUYA_ARTIFACT_INVALID");
  }
  return value as TuyaReportLogArtifact;
};

const numericValue = (value: unknown): number | undefined => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
};

const safeIsoTimestamp = (value: number): string | undefined => {
  if (!Number.isSafeInteger(value) || value <= 0) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? undefined : date.toISOString();
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
