import readExcelFile, { type CellValue } from "read-excel-file/node";

const REQUIRED_COLUMNS = ["Device Name", "Time", "Active Energy"] as const;

export type EnergyExcelImportInspection = {
  sheetName: string;
  columns: string[];
  sourceLabels: Array<{ label: string; rowCount: number }>;
  rowCount: number;
  validRowCount: number;
  invalidRowCount: number;
  duplicateReadingCount: number;
  negativeReadingCount: number;
  coverageFrom?: string;
  coverageTo?: string;
  typicalIntervalMinutes?: number;
  readingKind: "cumulative" | "preschool_interval_usage_matrix";
  qualityStatus: "ready" | "needs_review";
  issues: string[];
};

export type EnergyExcelSourceRow = {
  sourceRowNumber: number;
  sourceLabel: string;
  sourceColumn?: string;
  entityCode?: string;
  /** Provider-normalized UTC event time. API adapters should prefer this over a local wall-clock timestamp. */
  eventTime?: string;
  localTimestamp?: string;
  localDate?: string;
  localHour?: number;
  activeEnergyKwh?: number;
  usageKwh?: number;
  validationError?: "missing_device_name" | "invalid_timestamp" | "invalid_active_energy" | "negative_active_energy"
    | "missing_entity_code" | "invalid_date" | "missing_meter_label" | "invalid_interval_usage" | "negative_interval_usage";
};

export type EnergyExcelWorkbook = {
  inspection: EnergyExcelImportInspection;
  rows: EnergyExcelSourceRow[];
};

export const inspectEnergyExcelWorkbook = async (
  content: Buffer,
): Promise<EnergyExcelImportInspection> => (await readEnergyExcelWorkbook(content)).inspection;

type EnergySheet = { sheet: string; data: (CellValue | null)[][] };

/** Reads an uploaded readings file. `.xlsx` is a zip (starts "PK"); anything else is read as CSV text. */
export const readEnergyExcelWorkbook = async (
  content: Buffer,
): Promise<EnergyExcelWorkbook> => readEnergySheets(isZip(content) ? await readExcelFile(content) : readCsvSheets(content));

const isZip = (content: Buffer): boolean => content.length >= 4 && content[0] === 0x50 && content[1] === 0x4b && content[2] === 0x03 && content[3] === 0x04;

/** Headers whose cells are wall-clock timestamps; CSV text is converted the way Excel dates arrive. */
const CSV_TIME_HEADERS = new Set(["time", "date"]);

const readCsvSheets = (content: Buffer): EnergySheet[] => {
  const text = content.toString("utf8").replace(/^\uFEFF/u, "");
  const rows = parseCsv(text);
  if (rows.length === 0) throw new Error("ENERGYIQ_EXCEL_EMPTY");
  const timeColumns = new Set(rows[0]!.map((header, index) => CSV_TIME_HEADERS.has(normaliseHeader(header)) ? index : -1).filter((index) => index >= 0));
  const data: EnergySheet["data"] = rows.map((row, rowIndex) => row.map((cell, columnIndex) => {
    if (rowIndex === 0 || !timeColumns.has(columnIndex)) return cell;
    // read-excel-file types Date cells as `typeof Date`, but at runtime (and here) they are Date instances.
    return (parseWallClock(cell) as unknown as CellValue | undefined) ?? cell;
  }));
  return [{ sheet: "CSV", data }];
};

/** RFC 4180 CSV with comma, semicolon or tab delimiters (detected from the header line). */
export const parseCsv = (text: string): string[][] => {
  const firstLine = text.slice(0, text.search(/\r?\n/u) === -1 ? text.length : text.search(/\r?\n/u));
  const delimiter = [",", ";", "\t"].map((candidate) => ({ candidate, count: firstLine.split(candidate).length }))
    .sort((a, b) => b.count - a.count)[0]!.candidate;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === "") quoted = true;
    else if (char === delimiter) { row.push(cell); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell); cell = "";
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell);
  if (row.some((value) => value.trim() !== "")) rows.push(row);
  return rows.map((values) => values.map((value) => value.trim()));
};

/**
 * Parses a site wall-clock timestamp into a Date whose UTC fields hold the wall-clock values,
 * matching how Excel dates are read. Accepts ISO (2026-09-01 00:15[:00]) and day-first
 * (01/09/2026 00:15) forms; an explicit offset or Z is honoured as an absolute instant.
 */
export const parseWallClock = (value: string): Date | undefined => {
  const text = value.trim();
  if (!text) return undefined;
  if (/(?:z|[+-]\d{2}:?\d{2})$/iu.test(text)) {
    const absolute = new Date(text);
    return Number.isFinite(absolute.getTime()) ? absolute : undefined;
  }
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/u.exec(text);
  const dayFirst = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/u.exec(text);
  const parts = iso
    ? [iso[1], iso[2], iso[3], iso[4], iso[5], iso[6]]
    : dayFirst
      ? [dayFirst[3], dayFirst[2], dayFirst[1], dayFirst[4], dayFirst[5], dayFirst[6]]
      : undefined;
  if (!parts) return undefined;
  const [year, month, day, hour, minute, second] = parts.map((part) => Number(part ?? 0)) as [number, number, number, number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return date.getUTCDate() === day ? date : undefined;
};

const readEnergySheets = (sheets: EnergySheet[]): EnergyExcelWorkbook => {
  const cumulativeSheet = sheets.find((candidate) => hasColumns(candidate.data[0], REQUIRED_COLUMNS));
  const intervalMatrixSheet = sheets.find((candidate) => hasColumns(candidate.data[0], INTERVAL_MATRIX_REQUIRED_COLUMNS));
  if (!cumulativeSheet && intervalMatrixSheet) return readIntervalMatrixSheet(intervalMatrixSheet);
  if (!cumulativeSheet) {
    const firstColumns = new Set((sheets[0]?.data[0] ?? []).map((cell) => normaliseHeader(displayCell(cell))));
    const missing = REQUIRED_COLUMNS.find((column) => !firstColumns.has(normaliseHeader(column))) ?? REQUIRED_COLUMNS[0];
    throw new Error(`ENERGYIQ_EXCEL_COLUMN_REQUIRED:${missing}`);
  }
  const sheet = cumulativeSheet;
  const rows = sheet.data;
  if (rows.length === 0) throw new Error("ENERGYIQ_EXCEL_EMPTY");
  const columns = rows[0]!.map(displayCell);
  const indexes = new Map(columns.map((column, index) => [normaliseHeader(column), index]));
  for (const required of REQUIRED_COLUMNS) {
    if (!indexes.has(normaliseHeader(required))) {
      throw new Error(`ENERGYIQ_EXCEL_COLUMN_REQUIRED:${required}`);
    }
  }

  const labelIndex = indexes.get(normaliseHeader("Device Name"))!;
  const timeIndex = indexes.get(normaliseHeader("Time"))!;
  const readingIndex = indexes.get(normaliseHeader("Active Energy"))!;
  const labelCounts = new Map<string, number>();
  const timestampsByLabel = new Map<string, number[]>();
  const readingKeys = new Set<string>();
  let rowCount = 0;
  let validRowCount = 0;
  let invalidRowCount = 0;
  let duplicateReadingCount = 0;
  let negativeReadingCount = 0;
  let coverageFrom: number | undefined;
  let coverageTo: number | undefined;
  const sourceRows: EnergyExcelSourceRow[] = [];

  for (const [rowIndex, row] of rows.slice(1).entries()) {
    if (row.every((cell) => cell === null || displayCell(cell) === "")) continue;
    rowCount += 1;
    const label = displayCell(row[labelIndex]).trim();
    const timestamp = timestampValue(row[timeIndex]);
    const reading = numberValue(row[readingIndex]);
    const validationError = !label
      ? "missing_device_name" as const
      : timestamp === undefined
        ? "invalid_timestamp" as const
        : reading === undefined
          ? "invalid_active_energy" as const
          : reading < 0
            ? "negative_active_energy" as const
            : undefined;
    sourceRows.push({
      sourceRowNumber: rowIndex + 2,
      sourceLabel: label,
      ...(timestamp === undefined ? {} : { localTimestamp: localTimestampValue(row[timeIndex]) }),
      ...(reading === undefined ? {} : { activeEnergyKwh: reading }),
      ...(validationError ? { validationError } : {}),
    });
    if (validationError) {
      invalidRowCount += 1;
      if (validationError === "negative_active_energy") negativeReadingCount += 1;
      continue;
    }
    if (timestamp === undefined || reading === undefined) continue;
    validRowCount += 1;
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
    timestampsByLabel.set(label, [...(timestampsByLabel.get(label) ?? []), timestamp]);
    const key = `${label}\u0000${timestamp}`;
    if (readingKeys.has(key)) duplicateReadingCount += 1;
    readingKeys.add(key);
    coverageFrom = coverageFrom === undefined ? timestamp : Math.min(coverageFrom, timestamp);
    coverageTo = coverageTo === undefined ? timestamp : Math.max(coverageTo, timestamp);
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
  const typicalIntervalMinutes = intervals.length > 0
    ? intervals[Math.floor(intervals.length / 2)]
    : undefined;
  const issues = [
    ...(invalidRowCount > 0 ? [`${invalidRowCount} row(s) have missing or invalid required values.`] : []),
    ...(duplicateReadingCount > 0 ? [`${duplicateReadingCount} duplicate device/time reading(s) require deterministic de-duplication.`] : []),
    ...(negativeReadingCount > 0 ? [`${negativeReadingCount} cumulative reading(s) are negative.`] : []),
    ...(typicalIntervalMinutes !== undefined && typicalIntervalMinutes !== 15
      ? [`Typical interval is ${typicalIntervalMinutes} minutes rather than 15 minutes.`]
      : []),
  ];

  return {
    inspection: {
      sheetName: sheet.sheet,
      columns,
      sourceLabels: [...labelCounts.entries()]
        .map(([label, count]) => ({ label, rowCount: count }))
        .sort((left, right) => left.label.localeCompare(right.label)),
      rowCount,
      validRowCount,
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
    rows: sourceRows,
  };
};

const INTERVAL_MATRIX_REQUIRED_COLUMNS = [
  "Preschool Number", "Date", "Month", "Year", "Power Meter",
] as const;

const readIntervalMatrixSheet = (sheet: {
  sheet: string;
  data: Array<Array<CellValue | null>>;
}): EnergyExcelWorkbook => {
  const rows = sheet.data;
  if (rows.length === 0) throw new Error("ENERGYIQ_EXCEL_EMPTY");
  const columns = rows[0]!.map(displayCell);
  const indexes = new Map(columns.map((column, index) => [normaliseHeader(column), index]));
  const entityIndex = indexes.get(normaliseHeader("Preschool Number"))!;
  const dateIndex = indexes.get(normaliseHeader("Date"))!;
  const monthIndex = indexes.get(normaliseHeader("Month"))!;
  const yearIndex = indexes.get(normaliseHeader("Year"))!;
  const meterIndex = indexes.get(normaliseHeader("Power Meter"))!;
  const hourlyColumns = Array.from({ length: 24 }, (_, hour) => {
    const name = `${hour.toString().padStart(2, "0")}00-${(hour + 1).toString().padStart(2, "0")}00`;
    const index = indexes.get(normaliseHeader(name));
    if (index === undefined) throw new Error(`ENERGYIQ_EXCEL_COLUMN_REQUIRED:${name}`);
    return { hour, name, index };
  });

  const sourceRows: EnergyExcelSourceRow[] = [];
  const labelCounts = new Map<string, number>();
  let invalidRowCount = 0;
  let negativeReadingCount = 0;
  let coverageFrom: string | undefined;
  let coverageTo: string | undefined;
  for (const [rowIndex, row] of rows.slice(1).entries()) {
    if (row.every((cell) => cell === null || displayCell(cell) === "")) continue;
    const entityCode = displayCell(row[entityIndex]).trim();
    const meterLabel = displayCell(row[meterIndex]).trim();
    const localDate = calendarDate(
      integerValue(row[yearIndex]),
      integerValue(row[monthIndex]),
      integerValue(row[dateIndex]),
    );
    const sourceLabel = `preschool-centre-${entityCode.toLocaleLowerCase()}:${meterLabel}`;
    for (const hourly of hourlyColumns) {
      const usage = numberValue(row[hourly.index]);
      const validationError = !entityCode
        ? "missing_entity_code" as const
        : !meterLabel
          ? "missing_meter_label" as const
          : !localDate
            ? "invalid_date" as const
            : usage === undefined
              ? "invalid_interval_usage" as const
              : usage < 0
                ? "negative_interval_usage" as const
                : undefined;
      sourceRows.push({
        sourceRowNumber: rowIndex + 2,
        sourceColumn: hourly.name,
        sourceLabel,
        entityCode,
        ...(localDate ? { localDate, localHour: hourly.hour } : {}),
        ...(usage === undefined ? {} : { usageKwh: usage }),
        ...(validationError ? { validationError } : {}),
      });
      if (validationError) {
        invalidRowCount += 1;
        if (validationError === "negative_interval_usage") negativeReadingCount += 1;
        continue;
      }
      labelCounts.set(sourceLabel, (labelCounts.get(sourceLabel) ?? 0) + 1);
      const from = `${localDate}T${hourly.hour.toString().padStart(2, "0")}:00:00.000Z`;
      const to = new Date(Date.parse(from) + 60 * 60_000).toISOString();
      coverageFrom = coverageFrom === undefined || from < coverageFrom ? from : coverageFrom;
      coverageTo = coverageTo === undefined || to > coverageTo ? to : coverageTo;
    }
  }
  const validRowCount = sourceRows.length - invalidRowCount;
  const issues = [
    ...(invalidRowCount > 0 ? [`${invalidRowCount} interval cell(s) have missing or invalid required values.`] : []),
    ...(negativeReadingCount > 0 ? [`${negativeReadingCount} interval usage value(s) are negative.`] : []),
  ];
  return {
    inspection: {
      sheetName: sheet.sheet,
      columns,
      sourceLabels: [...labelCounts.entries()]
        .map(([label, count]) => ({ label, rowCount: count }))
        .sort((left, right) => left.label.localeCompare(right.label)),
      rowCount: sourceRows.length,
      validRowCount,
      invalidRowCount,
      duplicateReadingCount: 0,
      negativeReadingCount,
      ...(coverageFrom ? { coverageFrom } : {}),
      ...(coverageTo ? { coverageTo } : {}),
      typicalIntervalMinutes: 60,
      readingKind: "preschool_interval_usage_matrix",
      qualityStatus: issues.length === 0 ? "ready" : "needs_review",
      issues,
    },
    rows: sourceRows,
  };
};

const normaliseHeader = (value: string): string => value.trim().replace(/\s+/g, " ").toLowerCase();

const hasColumns = (
  row: Array<CellValue | null> | undefined,
  required: readonly string[],
): boolean => {
  if (!row) return false;
  const actual = new Set(row.map((cell) => normaliseHeader(displayCell(cell))));
  return required.every((column) => actual.has(normaliseHeader(column)));
};

const integerValue = (value: CellValue | null | undefined): number | undefined => {
  const parsed = numberValue(value);
  return parsed !== undefined && Number.isInteger(parsed) ? parsed : undefined;
};

const calendarDate = (
  year: number | undefined,
  month: number | undefined,
  day: number | undefined,
): string | undefined => {
  if (year === undefined || month === undefined || day === undefined) return undefined;
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) {
    return undefined;
  }
  return candidate.toISOString().slice(0, 10);
};

const displayCell = (value: CellValue | null | undefined): string => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
};

const timestampValue = (value: CellValue | null | undefined): number | undefined => {
  if (value instanceof Date && Number.isFinite(value.getTime())) return snapNearMinute(value.getTime());
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? snapNearMinute(timestamp) : undefined;
};

const localTimestampValue = (value: CellValue | null | undefined): string => {
  const source = value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
  const date = new Date(snapNearMinute(source));
  if (Number.isFinite(date.getTime())) {
    return [
      date.getUTCFullYear().toString().padStart(4, "0"),
      (date.getUTCMonth() + 1).toString().padStart(2, "0"),
      date.getUTCDate().toString().padStart(2, "0"),
    ].join("-") + "T" + [
      date.getUTCHours().toString().padStart(2, "0"),
      date.getUTCMinutes().toString().padStart(2, "0"),
      date.getUTCSeconds().toString().padStart(2, "0"),
    ].join(":");
  }
  return String(value);
};

const snapNearMinute = (timestamp: number): number => {
  if (!Number.isFinite(timestamp)) return timestamp;
  const nearestMinute = Math.round(timestamp / 60_000) * 60_000;
  return Math.abs(nearestMinute - timestamp) <= 1_000 ? nearestMinute : timestamp;
};

const numberValue = (value: CellValue | null | undefined): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Number(value.trim().replace(/,(?=\d{3}(?:\D|$))/gu, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
};
