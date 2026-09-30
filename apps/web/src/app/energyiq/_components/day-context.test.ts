import { describe, expect, it } from "vitest";
import type { EnergyOperatingCalendarRevisionDto } from "../../../lib/config-api";
import { dayContext, describeDay, schoolPhases, specialDays } from "./day-context";

const weekday = [{ from: "09:00", to: "18:00" }];
const revision = {
  entries: [{
    id: "hours", owner: { kind: "project" }, effective_from: "2026-07-01", effective_to: "2027-01-01",
    weekly: { monday: weekday, tuesday: weekday, wednesday: weekday, thursday: weekday, friday: weekday, saturday: [], sunday: [] },
    exceptions: [
      { date: "2026-08-10", operating: [], label: "National Day (observed)", classification: "public_holiday" },
      { date: "2026-08-12", operating: [], label: "Office shutdown", classification: "special_closure" },
      { date: "2026-08-15", operating: [{ from: "10:00", to: "14:00" }], label: "Open house", classification: "special_operating_day" },
    ],
  }],
  academic_periods: [
    { id: "t", from: "2026-06-29", to: "2026-08-17", phase: "teaching", label: "Semester 1 teaching" },
    { id: "e", from: "2026-08-17", to: "2026-08-31", phase: "study_exam", label: "Semester 1 exams" },
  ],
} as unknown as EnergyOperatingCalendarRevisionDto;

describe("dayContext", () => {
  it("names holidays, closures, special openings, weekends and school phases", () => {
    expect(dayContext(revision, "2026-08-11")).toMatchObject({ kind: "open", open: true, school: { phase: "teaching" } });
    expect(dayContext(revision, "2026-08-09")).toMatchObject({ kind: "weekend", open: false });
    expect(dayContext(revision, "2026-08-10")).toMatchObject({ kind: "public_holiday", open: false, name: "National Day (observed)" });
    expect(dayContext(revision, "2026-08-12")).toMatchObject({ kind: "special_closure", open: false, name: "Office shutdown" });
    expect(dayContext(revision, "2026-08-15")).toMatchObject({ kind: "special_operating_day", open: true, name: "Open house" });
    expect(dayContext(revision, "2026-08-18").school).toEqual({ phase: "study_exam", label: "Semester 1 exams" });
  });

  it("describes a day in plain words", () => {
    expect(describeDay(dayContext(revision, "2026-08-10"))).toBe("National Day (observed) (public holiday) · closed");
    expect(describeDay(dayContext(revision, "2026-08-10"), false)).toBe("Public holiday · closed");
    expect(describeDay(dayContext(revision, "2026-08-18"))).toBe("Normal open day · Study & exam weeks");
    expect(describeDay(dayContext(revision, "2026-08-09"))).toBe("Weekend");
  });
});

describe("specialDays", () => {
  const days = ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-15"].map(date => dayContext(revision, date));
  const averages = { openDayKwh: 100, closedDayKwh: 60 };

  it("explains whether a special day looked as expected", () => {
    const result = specialDays(days, new Map([["2026-08-10", 62], ["2026-08-12", 95], ["2026-08-15", 90]]), averages);
    expect(result.map(day => day.date)).toEqual(["2026-08-10", "2026-08-12", "2026-08-15"]);
    expect(result[0]).toMatchObject({ sharePct: 62, verdict: expect.stringContaining("as expected while the site was closed") });
    expect(result[1]!.verdict).toContain("left running");
    expect(result[2]!.verdict).toContain("as expected for a scheduled opening");
  });

  it("says so when a day has no complete readings", () => {
    expect(specialDays(days, new Map(), averages)[0]!.verdict).toBe("No complete readings for this day.");
  });
});

describe("schoolPhases", () => {
  it("groups consecutive days of the same phase", () => {
    const phases = schoolPhases(["2026-08-14", "2026-08-15", "2026-08-16", "2026-08-17", "2026-08-18"].map(date => dayContext(revision, date)));
    expect(phases.map(phase => [phase.phase, phase.from, phase.to])).toEqual([["teaching", "2026-08-14", "2026-08-16"], ["study_exam", "2026-08-17", "2026-08-18"]]);
  });
});
