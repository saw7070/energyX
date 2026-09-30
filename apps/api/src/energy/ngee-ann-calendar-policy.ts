import type { EnergyIqAcademicCalendarPeriod } from "@datafoundry/metadata";

export const NGEE_ANN_ACADEMIC_CALENDAR_SOURCE_URL =
  "https://www.np.edu.sg/admissions-enrolment/academic-matters/academic-calendar" as const;

export const SINGAPORE_2026_PUBLIC_HOLIDAY_SOURCE_URL =
  "https://www.mom.gov.sg/newsroom/press-releases/2025/0616-public-holidays-for-2026" as const;

const academicSource = {
  label: "Ngee Ann Polytechnic Academic Calendar AY2025/26 and AY2026/27",
  url: NGEE_ANN_ACADEMIC_CALENDAR_SOURCE_URL,
} as const;

export const NGEE_ANN_AY2026_ACADEMIC_PERIODS = [
  period("ay2025-sem2-break", "2026-01-01", "2026-01-05", "term_break", "October 2025 Semester 2 Break"),
  period("ay2025-sem2-teaching-2", "2026-01-05", "2026-02-16", "teaching", "October 2025 Semester 2 Teaching Weeks"),
  period("ay2025-sem2-study-exam", "2026-02-16", "2026-03-02", "study_exam", "October 2025 Semester 2 Study & Examination Weeks"),
  period("ay2025-sem2-vacation", "2026-03-02", "2026-04-20", "vacation", "October 2025 Semester 2 Vacation"),
  period("ay2026-sem1-teaching-1", "2026-04-20", "2026-06-15", "teaching", "April 2026 Semester 1 Teaching Weeks"),
  period("ay2026-sem1-break", "2026-06-15", "2026-06-29", "term_break", "April 2026 Semester 1 Break"),
  period("ay2026-sem1-teaching-2", "2026-06-29", "2026-08-17", "teaching", "April 2026 Semester 1 Teaching Weeks"),
  period("ay2026-sem1-study-exam", "2026-08-17", "2026-08-31", "study_exam", "April 2026 Semester 1 Study & Examination Weeks"),
  period("ay2026-sem1-vacation", "2026-08-31", "2026-10-19", "vacation", "April 2026 Semester 1 Vacation"),
  period("ay2026-sem2-teaching-1", "2026-10-19", "2026-12-21", "teaching", "October 2026 Semester 2 Teaching Weeks"),
  period("ay2026-sem2-break", "2026-12-21", "2027-01-04", "term_break", "October 2026 Semester 2 Break"),
] satisfies EnergyIqAcademicCalendarPeriod[];

export type SingaporePublicHolidayPolicyDate = {
  date: string;
  label: string;
  classification: "public_holiday";
  sourceUrl: typeof SINGAPORE_2026_PUBLIC_HOLIDAY_SOURCE_URL;
};

export const SINGAPORE_2026_PUBLIC_HOLIDAYS: SingaporePublicHolidayPolicyDate[] = [
  holiday("2026-01-01", "New Year's Day"),
  holiday("2026-02-17", "Chinese New Year"),
  holiday("2026-02-18", "Chinese New Year"),
  holiday("2026-03-21", "Hari Raya Puasa"),
  holiday("2026-04-03", "Good Friday"),
  holiday("2026-05-01", "Labour Day"),
  holiday("2026-05-27", "Hari Raya Haji"),
  holiday("2026-05-31", "Vesak Day"),
  holiday("2026-06-01", "Vesak Day observed"),
  holiday("2026-08-09", "National Day"),
  holiday("2026-08-10", "National Day observed"),
  holiday("2026-11-08", "Deepavali"),
  holiday("2026-11-09", "Deepavali observed"),
  holiday("2026-12-25", "Christmas Day"),
];

function period(
  id: string,
  from: string,
  to: string,
  phase: EnergyIqAcademicCalendarPeriod["phase"],
  label: string,
): EnergyIqAcademicCalendarPeriod {
  return { id, from, to, phase, label, source: academicSource };
}

function holiday(date: string, label: string): SingaporePublicHolidayPolicyDate {
  return {
    date,
    label,
    classification: "public_holiday",
    sourceUrl: SINGAPORE_2026_PUBLIC_HOLIDAY_SOURCE_URL,
  };
}
