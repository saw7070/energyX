import { describe, expect, it } from "vitest";
import type { EnergyOperatingCalendarEntryDto } from "../../../lib/config-api";
import { dateRange, inEffect, upcomingDays, weeklySummary } from "./operating-hours-view";

const nineToSix = [{ from: "09:00", to: "18:00" }];
const weekly = { monday: nineToSix, tuesday: nineToSix, wednesday: nineToSix, thursday: nineToSix, friday: nineToSix, saturday: [], sunday: [] } as EnergyOperatingCalendarEntryDto["weekly"];

describe("weeklySummary", () => {
  it("summarises open days and weekly hours", () => {
    expect(weeklySummary(weekly)).toEqual({ hours: 45, openDays: 5, days: "Mon–Fri" });
    expect(weeklySummary({ ...weekly, wednesday: [], saturday: [{ from: "10:00", to: "14:00" }] }).days).toBe("Mon, Tue, Thu–Sat");
    expect(weeklySummary({ ...weekly, monday: [], tuesday: [], wednesday: [], thursday: [], friday: [] }).days).toBe("Closed all week");
  });
});

describe("inEffect", () => {
  it("shows the last day in effect rather than the exclusive end date", () => {
    expect(inEffect({ effective_from: "2026-07-01", effective_to: "2027-01-01" })).toBe("1 Jul – 31 Dec 2026");
    expect(inEffect({ effective_from: "2026-07-01" })).toBe("From 1 Jul 2026");
    expect(dateRange("2026-12-21", "2027-01-03")).toBe("21 Dec 2026 – 3 Jan 2027");
  });
});

describe("upcomingDays", () => {
  const entries = [{ id: "e", owner: { kind: "project" }, effective_from: "2026-07-01", weekly, exceptions: [
    { date: "2026-08-10", operating: [], label: "National Day (observed)", classification: "public_holiday" },
    { date: "2026-09-26", operating: [], label: "Office move", classification: "special_closure" },
    { date: "2026-09-27", operating: [], label: "Office move", classification: "special_closure" },
    { date: "2026-11-08", operating: [], label: "Deepavali", classification: "public_holiday" },
    { date: "2026-12-24", operating: [{ from: "09:00", to: "13:00" }], label: "Christmas Eve", classification: "special_operating_day" },
  ] }] as unknown as EnergyOperatingCalendarEntryDto[];

  it("lists the next special days from today, grouping consecutive days", () => {
    expect(upcomingDays(entries, "2026-09-22")).toEqual([
      { from: "2026-09-26", to: "2026-09-27", label: "Office move", closed: true, kind: "Planned closure" },
      { from: "2026-11-08", to: "2026-11-08", label: "Deepavali", closed: true, kind: "Public holiday" },
      { from: "2026-12-24", to: "2026-12-24", label: "Christmas Eve", closed: false, kind: "Special hours" },
    ]);
  });
});

describe("operating hours in other languages", () => {
  it("names weekdays and writes dates the way each language does", () => {
    expect(weeklySummary(weekly, "zh-Hans").days).toBe("周一至周五");
    expect(weeklySummary({ ...weekly, wednesday: [], saturday: [{ from: "10:00", to: "14:00" }] }, "zh-Hans").days).toBe("周一、周二、周四至周六");
    expect(weeklySummary({ ...weekly, monday: [], tuesday: [], wednesday: [], thursday: [], friday: [] }, "zh-Hans").days).toBe("整周关闭");
    expect(weeklySummary(weekly, "ms").days).toBe("Isn–Jum");
    expect(inEffect({ effective_from: "2026-07-01", effective_to: "2027-01-01" }, "zh-Hans")).toBe("2026年7月1日至12月31日");
    expect(inEffect({ effective_from: "2026-07-01" }, "zh-Hans")).toBe("自2026年7月1日起");
    expect(dateRange("2026-12-21", "2027-01-03", "zh-Hans")).toBe("2026年12月21日至2027年1月3日");
    expect(inEffect({ effective_from: "2026-07-01", effective_to: "2027-01-01" }, "ms")).toBe("1 Jul – 31 Dis 2026");
    expect(inEffect({ effective_from: "2026-07-01" }, "ms")).toBe("Mulai 1 Jul 2026");
  });
  it("labels upcoming special days in the reader's language but keeps their saved names", () => {
    const entries = [{ id: "e", owner: { kind: "project" }, effective_from: "2026-07-01", weekly, exceptions: [
      { date: "2026-09-26", operating: [], label: "Office move", classification: "special_closure" },
      { date: "2026-11-08", operating: [], classification: "public_holiday" },
    ] }] as unknown as EnergyOperatingCalendarEntryDto[];
    expect(upcomingDays(entries, "2026-09-22", 3, "zh-Hans").map(item => [item.label, item.kind])).toEqual([["Office move", "计划停业"], ["公共假期", "公共假期"]]);
    expect(upcomingDays(entries, "2026-09-22", 3, "ms").map(item => item.kind)).toEqual(["Penutupan terancang", "Cuti umum"]);
  });
});
