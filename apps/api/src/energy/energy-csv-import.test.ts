import writeXlsxFile from "write-excel-file/node";
import { describe, expect, it } from "vitest";

import { inspectEnergyExcelWorkbook, parseCsv, parseWallClock, readEnergyExcelWorkbook } from "./energy-excel-import.js";

const csv = (text: string) => Buffer.from(text, "utf8");

describe("CSV readings import", () => {
  it("reads the same cumulative contract as Excel and keeps timestamps as site wall-clock time", async () => {
    const content = csv([
      "﻿Device Name,Time,Active Energy",
      "Main DB,2026-09-01 00:00,\"10,234.5\"",
      "Main DB,2026-09-01 00:15,10235.0",
      "\"Level 2, East\",01/09/2026 00:00,500",
      "",
    ].join("\r\n"));

    const workbook = await readEnergyExcelWorkbook(content);

    expect(workbook.inspection).toMatchObject({ readingKind: "cumulative", rowCount: 3, validRowCount: 3, typicalIntervalMinutes: 15 });
    expect(workbook.inspection.sourceLabels.map((label) => label.label)).toEqual(["Level 2, East", "Main DB"].sort());
    // Wall-clock values are preserved exactly, independent of the server's own timezone.
    expect(workbook.rows.map((row) => [row.sourceLabel, row.localTimestamp, row.activeEnergyKwh])).toEqual([
      ["Main DB", "2026-09-01T00:00:00", 10234.5],
      ["Main DB", "2026-09-01T00:15:00", 10235],
      ["Level 2, East", "2026-09-01T00:00:00", 500],
    ]);
  });

  it("produces the same inspection as the equivalent Excel workbook", async () => {
    const excel = await writeXlsxFile([
      [{ type: String, value: "Device Name" }, { type: String, value: "Time" }, { type: String, value: "Active Energy" }],
      [{ type: String, value: "Meter A" }, { type: Date, value: new Date("2026-05-01T00:00:00Z"), format: "yyyy-mm-dd hh:mm" }, { type: Number, value: 100 }],
      [{ type: String, value: "Meter A" }, { type: Date, value: new Date("2026-05-01T00:15:00Z"), format: "yyyy-mm-dd hh:mm" }, { type: Number, value: 100.4 }],
    ]).toBuffer();
    const fromCsv = await inspectEnergyExcelWorkbook(csv("Device Name,Time,Active Energy\nMeter A,2026-05-01 00:00,100\nMeter A,2026-05-01 00:15,100.4\n"));
    const fromExcel = await inspectEnergyExcelWorkbook(excel);
    expect({ ...fromCsv, sheetName: "x" }).toEqual({ ...fromExcel, sheetName: "x" });
  });

  it("accepts semicolon and tab separated files and reports missing columns", async () => {
    expect((await inspectEnergyExcelWorkbook(csv("Device Name;Time;Active Energy\nM;2026-05-01 00:00;1\n"))).validRowCount).toBe(1);
    expect((await inspectEnergyExcelWorkbook(csv("Device Name\tTime\tActive Energy\nM\t2026-05-01 00:00\t1\n"))).validRowCount).toBe(1);
    await expect(inspectEnergyExcelWorkbook(csv("Device Name,Time\nM,2026-05-01 00:00\n"))).rejects.toThrow("ENERGYIQ_EXCEL_COLUMN_REQUIRED:Active Energy");
  });

  it("flags unreadable timestamps instead of guessing", async () => {
    const inspection = await inspectEnergyExcelWorkbook(csv("Device Name,Time,Active Energy\nM,31/02/2026 00:00,1\nM,yesterday,2\n"));
    expect(inspection.invalidRowCount).toBe(2);
  });
});

describe("CSV helpers", () => {
  it("handles quoted delimiters, escaped quotes and CRLF", () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n1,2,3')).toEqual([["a", "b, c", 'say "hi"'], ["1", "2", "3"]]);
  });

  it("parses wall-clock and absolute timestamps", () => {
    expect(parseWallClock("2026-09-01 13:45")?.toISOString()).toBe("2026-09-01T13:45:00.000Z");
    expect(parseWallClock("01/09/2026")?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(parseWallClock("2026-09-01T05:45:00Z")?.toISOString()).toBe("2026-09-01T05:45:00.000Z");
    expect(parseWallClock("2026-13-01 00:00")).toBeUndefined();
  });
});
