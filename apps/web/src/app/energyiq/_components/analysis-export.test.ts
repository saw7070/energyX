import { expect, it } from "vitest";
import type { AnalysisData } from "./analysis-data";
import { analysisCsvFilename, analysisHourlyCsv } from "./analysis-export";

const series = (cells: Array<[string, number, number | null]>) => ({ id: "s", expectedMinutesPerHour: 60, cells: cells.map(([d, h, k]) => [d, h, k, 60, 0] as [string, number, number | null, number, number]) });

it("writes the whole site, its uses, each space and each meter for the dates on screen", () => {
  const data = {
    projectName: "SMRT Bishan Admin",
    current: {
      project: {
        dates: ["2026-10-01"],
        total: series([["2026-09-30", 23, 9], ["2026-10-01", 8, 12]]),
        types: { aircon: series([["2026-10-01", 8, 7]]) },
        meters: [{ id: "ahu", name: "AHU 8B", location: "Level 2", series: series([["2026-10-01", 8, 7]]) }],
      },
      spaces: [{ name: "Level 2", total: series([["2026-10-01", 8, 12]]) }],
    },
  } as unknown as AnalysisData;

  expect(analysisHourlyCsv(data).split("\r\n")).toEqual([
    "Date,Hour,Whole site (kWh),Whole site · Air-con / Ventilation (kWh),Level 2 (kWh),AHU 8B · Level 2 (kWh)",
    "2026-10-01,08:00,12,7,12,7",
    "",
  ]);
  expect(analysisCsvFilename(data)).toBe("smrt-bishan-admin-hourly-2026-10-01-to-2026-10-01.csv");
});
