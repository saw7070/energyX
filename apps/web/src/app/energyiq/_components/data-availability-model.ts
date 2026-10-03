import type { EnergyDataAvailabilityDto, EnergyProjectSetupDocumentDto } from "../../../lib/config-api";

/** The periods to choose from: the last 30 complete days, then each of the last six whole months. */
export type AvailabilityPeriod = { id: string; from?: string; to?: string };

export function availabilityPeriods(today: string): AvailabilityPeriod[] {
  const [year, month] = today.split("-").map(Number) as [number, number];
  const months = Array.from({ length: 6 }, (_, index) => {
    const start = new Date(Date.UTC(year, month - 2 - index, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
    const from = start.toISOString().slice(0, 10), to = end.toISOString().slice(0, 10);
    return { id: from.slice(0, 7), from, to };
  });
  return [{ id: "last30" }, ...months];
}

/** Mark a meter not in use with the reason someone gave, or in use again. Nothing that decides readings changes. */
export function applyMeterNotInUse(document: EnergyProjectSetupDocumentDto, meterId: string, reason: string | null): EnergyProjectSetupDocumentDto {
  const mapping = document.meter_mapping;
  if (!mapping) return document;
  const note = reason?.trim().replace(/\s+/g, " ").slice(0, 160) ?? "";
  return {
    ...document,
    meter_mapping: {
      ...mapping,
      rows: mapping.rows.map(row => {
        if (row.id !== meterId) return row;
        const { not_in_use: _previous, ...rest } = row.presentation ?? {};
        const presentation = note ? { ...rest, not_in_use: note } : rest;
        const { presentation: _old, ...withoutPresentation } = row;
        return Object.keys(presentation).length ? { ...withoutPresentation, presentation } : withoutPresentation;
      }),
    },
  };
}

/** An ISO instant as the site's own date and time, "2026-09-03 14:00", for the spreadsheet. */
export const siteDateTime = (iso: string, timezone: string): string => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(iso)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
};

const cell = (value: string | number | null | undefined): string => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export type AvailabilityCsvLabels = {
  title: string;
  meterColumns: [string, string, string, string, string, string, string, string, string, string, string];
  outageTitle: string;
  outageColumns: [string, string, string, string, string, string];
  status: (status: EnergyDataAvailabilityDto["meters"][number]["status"]) => string;
  outageKind: (outage: EnergyDataAvailabilityDto["outages"][number]) => string;
  check: (check: EnergyDataAvailabilityDto["meters"][number]["checks"][number]) => string;
};

/** The availability report as a CSV that opens in Excel: one row per meter, then one row per outage. */
export function availabilityCsv(data: EnergyDataAvailabilityDto, siteName: string, labels: AvailabilityCsvLabels): string {
  const lines = [
    [labels.title, siteName, `${data.from} – ${data.to}`, data.timezone].map(cell).join(","),
    labels.meterColumns.map(cell).join(","),
    ...data.meters.map(meter => [
      meter.name, meter.location ?? "", meter.availabilityPct, data.targetPct, meter.realHours, meter.estimatedHours, meter.estimatedKwh,
      meter.longestOutageHours, meter.lastReadingAt ? siteDateTime(meter.lastReadingAt, data.timezone) : "", labels.status(meter.status),
      [meter.notInUse ?? "", ...meter.checks.map(labels.check)].filter(Boolean).join("; "),
    ].map(cell).join(",")),
    "",
    cell(labels.outageTitle),
    labels.outageColumns.map(cell).join(","),
    ...data.outages.map(outage => [
      outage.name, siteDateTime(outage.from, data.timezone), outage.ongoing ? "" : siteDateTime(outage.to, data.timezone), outage.hours,
      labels.outageKind(outage), outage.kind === "estimated" ? outage.estimatedKwh : "",
    ].map(cell).join(",")),
  ];
  // Excel reads a byte-order mark as "this file is UTF-8", so names in Chinese survive.
  return "﻿" + lines.join("\r\n") + "\r\n";
}
