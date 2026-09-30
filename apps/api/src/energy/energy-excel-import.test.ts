import writeXlsxFile from "write-excel-file/node";
import { describe, expect, it } from "vitest";

import { inspectEnergyExcelWorkbook, readEnergyExcelWorkbook } from "./energy-excel-import.js";

describe("inspectEnergyExcelWorkbook", () => {
  it("detects cumulative meter labels, coverage and quality evidence", async () => {
    const workbook = await writeXlsxFile([
      [text("Device Name"), text("Time"), text("Active Energy")],
      [text("Lvl 6 Office Load 1"), date("2026-05-01T00:00:00Z"), number(100)],
      [text("Lvl 6 Office Load 1"), date("2026-05-01T00:15:00Z"), number(100.4)],
      [text("Lvl 6 Office Load 1"), date("2026-05-01T00:15:00Z"), number(100.4)],
      [text("Lvl 6 Total Office Load"), date("2026-05-01T00:00:00Z"), number(500)],
      [text(""), text("not-a-date"), text("bad")],
    ]).toBuffer();

    const inspection = await inspectEnergyExcelWorkbook(workbook);

    expect(inspection.sheetName).toBe("Sheet1");
    expect(inspection.readingKind).toBe("cumulative");
    expect(inspection.rowCount).toBe(5);
    expect(inspection.validRowCount).toBe(4);
    expect(inspection.invalidRowCount).toBe(1);
    expect(inspection.duplicateReadingCount).toBe(1);
    expect(inspection.typicalIntervalMinutes).toBe(15);
    expect(inspection.sourceLabels).toEqual([
      { label: "Lvl 6 Office Load 1", rowCount: 3 },
      { label: "Lvl 6 Total Office Load", rowCount: 1 },
    ]);
    expect(inspection.qualityStatus).toBe("needs_review");
  });

  it("rejects a workbook without the cumulative reading contract", async () => {
    const workbook = await writeXlsxFile([
      [text("Device Name"), text("Time")],
      [text("Meter 1"), date("2026-05-01T00:00:00Z")],
    ]).toBuffer();
    await expect(inspectEnergyExcelWorkbook(workbook)).rejects.toThrow(
      "ENERGYIQ_EXCEL_COLUMN_REQUIRED:Active Energy",
    );
  });

  it("recognises a project interval-usage matrix without pretending it is cumulative", async () => {
    const workbook = await intervalMatrixWorkbook([
      ["A", 1, 5, 2026, "Friday", "Aircon", "Aircon 1", ...hourlyUsage(0.1)],
      ["B", 1, 5, 2026, "Friday", "Lighting", "Kitchen Lighting", ...hourlyUsage(0.2)],
    ]);

    const parsed = await readEnergyExcelWorkbook(workbook);

    expect(parsed.inspection).toMatchObject({
      readingKind: "preschool_interval_usage_matrix",
      rowCount: 48,
      validRowCount: 48,
      invalidRowCount: 0,
      coverageFrom: "2026-05-01T00:00:00.000Z",
      coverageTo: "2026-05-02T00:00:00.000Z",
      sourceLabels: [
        { label: "preschool-centre-a:Aircon 1", rowCount: 24 },
        { label: "preschool-centre-b:Kitchen Lighting", rowCount: 24 },
      ],
    });
    expect(parsed.rows).toHaveLength(48);
    expect(parsed.rows[0]).toMatchObject({
      sourceRowNumber: 2,
      sourceColumn: "0000-0100",
      entityCode: "A",
      sourceLabel: "preschool-centre-a:Aircon 1",
      localDate: "2026-05-01",
      localHour: 0,
      usageKwh: 0.1,
    });
  });

  it("snaps Excel floating-point timestamps that are within one second of a minute", async () => {
    const workbook = await writeXlsxFile([
      [text("Device Name"), text("Time"), text("Active Energy")],
      [text("Meter 1"), date("2026-05-01T00:00:00Z"), number(100)],
      [text("Meter 1"), date("2026-05-01T00:14:59.999Z"), number(100.4)],
    ]).toBuffer();

    const parsed = await readEnergyExcelWorkbook(workbook);

    expect(parsed.inspection.typicalIntervalMinutes).toBe(15);
    expect(parsed.rows[1]?.localTimestamp).toBe("2026-05-01T00:15:00");
  });
});

const text = (value: string) => ({ type: String, value });
const number = (value: number) => ({ type: Number, value });
const date = (value: string) => ({ type: Date, value: new Date(value), format: "yyyy-mm-dd hh:mm" });

const hourlyUsage = (value: number) => Array.from({ length: 24 }, () => value);

const intervalMatrixWorkbook = async (dataRows: Array<Array<string | number>>) => writeXlsxFile([
  [
    text("Preschool Number"), text("Date"), text("Month"), text("Year"),
    text("Day of the Week"), text("Appliance"), text("Power Meter"),
    ...Array.from({ length: 24 }, (_, hour) => text(
      `${hour.toString().padStart(2, "0")}00-${(hour + 1).toString().padStart(2, "0")}00`,
    )),
  ],
  ...dataRows.map((row) => row.map((value) => typeof value === "number" ? number(value) : text(value))),
]).toBuffer();
