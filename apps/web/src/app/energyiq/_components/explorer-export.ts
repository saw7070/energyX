import type { EnergyScopeAnalysisDto } from "../../../lib/config-api";
import { translatorFor } from "./energyiq-messages";
import { measurementMessages } from "./facility-messages";

const measurement = translatorFor(measurementMessages, "en");
type CategoryKey = keyof typeof measurementMessages.en;
const CATEGORIES = new Set<string>(Object.keys(measurementMessages.en));

/**
 * The hourly energy behind Explorer's charts as a CSV that opens in Excel: one row per local hour, one column per
 * series (the space's official total, its energy types, then each meter and virtual meter). An empty cell is an hour
 * without a usable reading, never zero.
 */
export function explorerHourlyCsv(analysis: EnergyScopeAnalysisDto): string {
  const meterNames = new Map((analysis.explorerMeters ?? []).map((meter) => [meter.id, meter.kind === "virtual" ? `${meter.name} (virtual)` : meter.name]));
  const heading = (id: string) => id === "__scope__"
    ? "Total (kWh)"
    : id.startsWith("__category__:")
      ? `${measurement(categoryKey(id.slice("__category__:".length)))} total (kWh)`
      : `${meterNames.get(id) ?? id} (kWh)`;
  return hourlyCsv((analysis.explorerTrends ?? []).map((item) => ({ heading: heading(item.id), cells: item.cells })));
}

/** One row per local hour across every column's hours; a column without a value for that hour stays empty. */
export function hourlyCsv(columns: Array<{ heading: string; cells: ReadonlyArray<readonly [string, number, number | null, ...unknown[]]> }>): string {
  const values = columns.map((column) => new Map(column.cells.map(([date, hour, kwh]) => [`${date} ${hour}`, kwh])));
  const hours = [...new Set(columns.flatMap((column) => column.cells.map(([date, hour]) => `${date}\u0000${String(hour).padStart(2, "0")}`)))].sort();
  const rows = [
    ["Date", "Hour", ...columns.map((column) => column.heading)],
    ...hours.map((key) => {
      const [date, hour] = key.split("\u0000") as [string, string];
      return [date, `${hour}:00`, ...values.map((byHour) => {
        const kwh = byHour.get(`${date} ${Number(hour)}`);
        return kwh == null ? "" : String(Math.round(kwh * 10_000) / 10_000);
      })];
    }),
  ];
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/** File name from a place and the dates of the hours in it: "office-hourly-2026-09-18-to-2026-10-01.csv". */
export function hourlyCsvFilename(place: string, dates: string[]): string {
  const slug = place.trim().toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-|-$/gu, "") || "site";
  const sorted = [...dates].sort();
  return sorted.length ? `${slug}-hourly-${sorted[0]}-to-${sorted.at(-1)}.csv` : `${slug}-hourly.csv`;
}

export function explorerCsvFilename(analysis: EnergyScopeAnalysisDto, scopeName: string): string {
  return hourlyCsvFilename(scopeName, (analysis.explorerTrends ?? []).flatMap((series) => series.cells.map(([date]) => date)));
}

/** Save text as a file in the browser. A byte-order mark makes Excel read the names as UTF-8. */
export function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob(["﻿", text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

const categoryKey = (category: string) => (CATEGORIES.has(category) ? category : "other") as CategoryKey;

/** Quote text that needs it; a name starting like a formula is prefixed so Excel shows it as text. Numbers stay numbers. */
const csvCell = (value: string): string => {
  const formula = /^[=+\-@]/u.test(value) && !/^-?\d+(?:\.\d+)?$/u.test(value);
  return /[",\r\n]/u.test(value) || formula ? `"${(formula ? `'${value}` : value).replaceAll('"', '""')}"` : value;
};
