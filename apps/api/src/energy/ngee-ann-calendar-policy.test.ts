import { describe, expect, it } from "vitest";

import {
  NGEE_ANN_AY2026_ACADEMIC_PERIODS,
  NGEE_ANN_ACADEMIC_CALENDAR_SOURCE_URL,
  SINGAPORE_2026_PUBLIC_HOLIDAYS,
  SINGAPORE_2026_PUBLIC_HOLIDAY_SOURCE_URL,
} from "./ngee-ann-calendar-policy.js";

describe("Ngee Ann official Calendar policy", () => {
  it("covers every day of 2026 with non-overlapping Academic Phases", () => {
    expect(NGEE_ANN_AY2026_ACADEMIC_PERIODS[0]?.from).toBe("2026-01-01");
    expect(NGEE_ANN_AY2026_ACADEMIC_PERIODS.at(-1)?.to).toBe("2027-01-04");
    for (let index = 1; index < NGEE_ANN_AY2026_ACADEMIC_PERIODS.length; index += 1) {
      expect(NGEE_ANN_AY2026_ACADEMIC_PERIODS[index]?.from)
        .toBe(NGEE_ANN_AY2026_ACADEMIC_PERIODS[index - 1]?.to);
    }
    expect(NGEE_ANN_AY2026_ACADEMIC_PERIODS.every((period) => (
      period.source.url === NGEE_ANN_ACADEMIC_CALENDAR_SOURCE_URL
    ))).toBe(true);
  });

  it("preserves Teaching, Break, Study/Exam and Vacation as distinct phases", () => {
    expect(NGEE_ANN_AY2026_ACADEMIC_PERIODS).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: "2026-04-20", to: "2026-06-15", phase: "teaching" }),
      expect.objectContaining({ from: "2026-06-15", to: "2026-06-29", phase: "term_break" }),
      expect.objectContaining({ from: "2026-06-29", to: "2026-08-17", phase: "teaching" }),
      expect.objectContaining({ from: "2026-08-17", to: "2026-08-31", phase: "study_exam" }),
      expect.objectContaining({ from: "2026-08-31", to: "2026-10-19", phase: "vacation" }),
    ]));
  });

  it("includes gazetted and observed Singapore public holidays relevant to the uploaded data", () => {
    expect(SINGAPORE_2026_PUBLIC_HOLIDAYS).toEqual(expect.arrayContaining([
      expect.objectContaining({ date: "2026-05-01", label: "Labour Day" }),
      expect.objectContaining({ date: "2026-05-27", label: "Hari Raya Haji" }),
      expect.objectContaining({ date: "2026-05-31", label: "Vesak Day" }),
      expect.objectContaining({ date: "2026-06-01", label: "Vesak Day observed" }),
      expect.objectContaining({ date: "2026-08-09", label: "National Day" }),
      expect.objectContaining({ date: "2026-08-10", label: "National Day observed" }),
    ]));
    expect(SINGAPORE_2026_PUBLIC_HOLIDAYS.every((holiday) => (
      holiday.classification === "public_holiday"
      && holiday.sourceUrl === SINGAPORE_2026_PUBLIC_HOLIDAY_SOURCE_URL
    ))).toBe(true);
  });
});
