import { describe, expect, it } from "vitest";
import { presetPeriod, shiftDate, initialReportPeriod } from "./report-period";
const options = { calendarToday:"2026-09-12", defaultPeriod: {from:"2026-08-01",toExclusive:"2026-09-13"},availablePeriod:{from:"2025-11-07",toExclusive:"2026-09-12"} };
describe("report period presentation",()=>{
 it.each([
  ["current-month",{from:"2026-09-01",toExclusive:"2026-09-13"}],
  ["recent",{from:"2026-08-01",toExclusive:"2026-09-13"}],
  ["previous-month",{from:"2026-08-01",toExclusive:"2026-09-01"}],
  ["previous-week",{from:"2026-08-31",toExclusive:"2026-09-07"}],
  ["previous-day",{from:"2026-09-11",toExclusive:"2026-09-12"}],
  ["all",options.availablePeriod],
 ] as const)("resolves %s against the server's Singapore day",(preset,expected)=>expect(presetPeriod(preset,options)).toEqual(expected));
 it("handles January and a default starting in the current month",()=>{expect(presetPeriod("previous-month",{...options,calendarToday:"2026-01-12",defaultPeriod:{from:"2026-01-01",toExclusive:"2026-01-13"}})).toEqual({from:"2025-12-01",toExclusive:"2026-01-01"});});
 it("does not invent an all-data range",()=>expect(presetPeriod("all",{...options,availablePeriod:null})).toBeNull());
 it("converts inclusive end dates over leap days and years",()=>{expect(shiftDate("2024-02-29",1)).toBe("2024-03-01");expect(shiftDate("2026-12-31",1)).toBe("2027-01-01");expect(shiftDate("2026-09-13",-1)).toBe("2026-09-12");});
});

describe("historical project initial period", () => {
 it("starts a May-June project on available data without redefining This month", () => {
   const historical = {...options, availablePeriod: {from:"2026-05-01",toExclusive:"2026-07-01"}};
   expect(initialReportPeriod(historical)).toEqual({period:historical.defaultPeriod,preset:"recent"});
   expect(presetPeriod("current-month",historical)).toEqual({from:"2026-09-01",toExclusive:"2026-09-13"});
 });
 it("keeps the agreed recent window when it overlaps data", () => {
   expect(initialReportPeriod(options)).toEqual({period:options.defaultPeriod,preset:"recent"});
 });
 it("does not invent coverage when the project has no available range", () => {
   expect(initialReportPeriod({...options,availablePeriod:null})).toEqual({period:options.defaultPeriod,preset:"recent"});
 });
});
