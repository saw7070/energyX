import { expect, it } from "vitest";
import type { EnergyScopeAnalysisDto } from "../../../lib/config-api";
import { explorerCsvFilename, explorerHourlyCsv } from "./explorer-export";

const analysis = {
  context: { from: "2026-10-01T00:00:00+08:00", scopeId: "Level 2 / Office" },
  explorerMeters: [
    { id: "ld58", name: "Office, main", kind: "physical" },
    { id: "ld58-balance", name: "Office balance", kind: "virtual" },
  ],
  explorerTrends: [
    { id: "__scope__", expectedMinutesPerHour: 60, cells: [["2026-10-01", 8, 12.5, 60, 0], ["2026-10-01", 9, null, 0, 1]] },
    { id: "__category__:aircon", expectedMinutesPerHour: 60, cells: [["2026-10-01", 8, 7, 60, 0]] },
    { id: "ld58", expectedMinutesPerHour: 60, cells: [["2026-10-01", 8, 12.5, 60, 0]] },
    { id: "ld58-balance", expectedMinutesPerHour: 120, cells: [["2026-10-01", 9, -3.25, 120, 0]] },
  ],
} as unknown as EnergyScopeAnalysisDto;

it("writes one row per hour and one column per series, leaving hours without readings empty", () => {
  expect(explorerHourlyCsv(analysis).split("\r\n")).toEqual([
    "Date,Hour,Total (kWh),Air conditioning total (kWh),\"Office, main (kWh)\",Office balance (virtual) (kWh)",
    "2026-10-01,08:00,12.5,7,12.5,",
    "2026-10-01,09:00,,,,-3.25",
    "",
  ]);
  expect(explorerCsvFilename(analysis, "Level 2 / Office")).toBe("level-2-office-hourly-2026-10-01-to-2026-10-01.csv");
});

it("keeps a name that looks like a formula as text, but negative numbers as numbers", () => {
  const formulaName = { ...analysis, explorerMeters: [{ id: "ld58", name: "=HYPERLINK(1)", kind: "physical" }] } as unknown as EnergyScopeAnalysisDto;
  expect(explorerHourlyCsv(formulaName).split("\r\n")[0]).toContain(`"'=HYPERLINK(1) (kWh)"`);
});
