import type { EnergyIqCalendarDateContextResolution } from "@datafoundry/metadata";
import { describe, expect, it } from "vitest";

import {
  buildSchoolHolidayComparison,
  schoolHolidayComparisonHasRequiredShape,
  type SchoolHolidayEnergyFact,
} from "./school-holiday-comparison.js";

describe("buildSchoolHolidayComparison", () => {
  it("compares one complete Holiday interval with adjacent Teaching cohorts and exact identity", () => {
    const result = buildSchoolHolidayComparison(fixture());

    expect(result).toMatchObject({
      status: "available",
      contract: "energyiq-school-holiday-comparison@1",
      identity: {
        dataSnapshotId: "snapshot-ngee-august",
        projectReleaseId: "ngee-template-v10",
        businessCalendarVersion: "ngee-calendar-ay2026-v1",
        ruleRevision: "comparison.school_holiday_context@1",
      },
      selectedHolidayInterval: {
        academicPhase: "term_break",
        from: "2026-06-01",
        toExclusive: "2026-06-08",
      },
    });
    if (result.status !== "available") throw new Error("Expected available Holiday comparison");
    expect(result.comparisons).toEqual(expect.arrayContaining([
      expect.objectContaining({
        dayContext: "weekday",
        status: "available",
        actual: { academicPhase: "term_break", averageKwh: 75, sampleCount: 4 },
        baseline: { academicPhase: "teaching", averageKwh: 100, sampleCount: 4 },
        deltaKwh: -25,
        deltaPercent: -25,
      }),
      expect.objectContaining({
        dayContext: "weekend",
        status: "available",
        actual: expect.objectContaining({ averageKwh: 40, sampleCount: 2 }),
        baseline: expect.objectContaining({ averageKwh: 60, sampleCount: 2 }),
      }),
      expect.objectContaining({ dayContext: "public_holiday", status: "available" }),
    ]));
    expect(result.excludedAcademicPhases).toContain("study_exam");
    expect(result.anomalies).toEqual([
      expect.objectContaining({
        localDate: "2026-06-03",
        academicPhase: "term_break",
        schoolHolidayState: "school_holiday",
        baselineDates: ["2026-06-02", "2026-06-04", "2026-06-05"],
      }),
    ]);
    const weekday = result.comparisons.find(({ dayContext }) => dayContext === "weekday");
    if (!weekday || weekday.status !== "available") throw new Error("Expected weekday cohort");
    expect(weekday.evidence).toMatchObject({
      dataSnapshotId: "snapshot-ngee-august",
      projectReleaseId: "ngee-template-v10",
      comparisonWindowId: "school-holiday-comparison",
      reportTimePolicyRevision: "ngee-ann-report-time@2",
      metricId: "energy.total_usage_kwh@1",
      queryIds: ["school_holiday_context_facts_v1"],
    });
  });

  it("fails this module closed for truncated Academic Period or partial Calendar coverage", () => {
    const truncated = fixture();
    truncated.identity.period = { from: "2026-06-03", toExclusive: "2026-06-09" };
    truncated.facts = truncated.facts.filter(({ localDate }) => localDate >= "2026-06-03");
    if (truncated.calendarContexts.status !== "available") throw new Error("Expected Calendar");
    truncated.calendarContexts.dates = truncated.calendarContexts.dates
      .filter(({ local_date }) => local_date >= "2026-06-03");
    expect(buildSchoolHolidayComparison(truncated)).toMatchObject({
      status: "unavailable",
      reason: { code: "SCHOOL_HOLIDAY_INTERVAL_UNAVAILABLE" },
    });

    const partial = fixture();
    if (partial.calendarContexts.status !== "available") throw new Error("Expected Calendar");
    partial.calendarContexts.dates = partial.calendarContexts.dates
      .filter(({ local_date }) => local_date !== "2026-06-03");
    expect(buildSchoolHolidayComparison(partial)).toMatchObject({
      status: "unavailable",
      reason: { code: "CALENDAR_CONTEXT_COVERAGE_INCOMPLETE" },
    });
  });

  it("projects all 24 local hours without dropping the 20:00-24:00 band", () => {
    const input = fixture();
    input.facts = input.facts.flatMap((fact) => Array.from({ length: 24 }, (_, hour) => ({
      ...fact,
      hour,
      kwh: hourlyCohortFactKwh(fact.localDate),
      evidenceRef: `${fact.evidenceRef}:${String(hour).padStart(2, "0")}`,
    })));

    const result = buildSchoolHolidayComparison(input);

    expect(result.status).toBe("available");
    if (result.status !== "available") throw new Error("Expected available Holiday comparison");
    expect(result.hourlyProfile).toMatchObject({
      status: "available",
      dayContext: "weekday",
      actualSampleCount: 4,
      baselineSampleCount: 4,
      values: expect.arrayContaining([
        expect.objectContaining({
          localHour: 0,
          actualAverageKwh: 2,
          baselineAverageKwh: 4,
        }),
        expect.objectContaining({ localHour: 19 }),
        expect.objectContaining({ localHour: 20 }),
        expect.objectContaining({ localHour: 23 }),
      ]),
    });
    if (result.hourlyProfile.status !== "available") throw new Error("Expected available hourly profile");
    expect(result.hourlyProfile.values).toHaveLength(24);
  });

  it("rejects deep Holiday payload corruption instead of trusting top-level arrays", () => {
    const input = fixture();
    input.facts = input.facts.flatMap((fact) => Array.from({ length: 24 }, (_, hour) => ({
      ...fact,
      hour,
      kwh: fact.kwh / 24,
      evidenceRef: `${fact.evidenceRef}:${String(hour).padStart(2, "0")}`,
    })));
    const valid = buildSchoolHolidayComparison(input);
    expect(schoolHolidayComparisonHasRequiredShape(valid)).toBe(true);

    const corruptions: Array<[string, (value: Record<string, any>) => void]> = [
      ["null comparisons", (value) => { value.comparisons = [null]; }],
      ["illegal comparison status", (value) => { value.comparisons[0].status = "stale"; }],
      ["malformed quality", (value) => { value.quality.coveragePct = null; }],
      ["zero expected dates", (value) => { value.quality.expectedDayCount = 0; value.quality.completeDayCount = 0; }],
      ["impossible quality count", (value) => { value.quality.completeDayCount = value.quality.expectedDayCount + 1; }],
      ["impossible quality percentage", (value) => { value.quality.coveragePct = 101; }],
      ["sub-gate available coverage", (value) => {
        value.quality.completeDayCount = value.quality.expectedDayCount - 1;
        value.quality.excludedLocalDates = ["2026-05-25"];
        value.quality.coveragePct = 93.333333;
      }],
      ["null quality dates", (value) => { value.quality.excludedLocalDates = [null]; }],
      ["duplicate excluded dates", (value) => { value.quality.excludedLocalDates = ["2026-05-25", "2026-05-25"]; }],
      ["comparison period outside identity", (value) => { value.selectedHolidayInterval.from = "2026-05-24"; }],
      ["duplicate cohort", (value) => { value.comparisons[1] = structuredClone(value.comparisons[0]); }],
      ["cohort phase mismatch", (value) => { value.comparisons[0].actual.academicPhase = "vacation"; }],
      ["arithmetic mismatch", (value) => { value.comparisons[0].deltaKwh += 1; }],
      ["malformed comparison evidence", (value) => { value.comparisons[0].evidence.queryIds = [null]; }],
      ["mismatched comparison evidence identity", (value) => { value.comparisons[0].evidence.dataSnapshotId = "other-snapshot"; }],
      ["null anomalies", (value) => { value.anomalies = [null]; }],
      ["malformed anomaly evidence", (value) => { value.anomalies[0].evidence.actualRefs = null; }],
      ["empty anomaly evidence", (value) => { value.anomalies[0].evidence.actualRefs = []; }],
      ["anomaly arithmetic mismatch", (value) => { value.anomalies[0].deltaPercent = 999; }],
      ["anomaly baseline sample mismatch", (value) => { value.anomalies[0].baselineSampleCount = 99; }],
      ["duplicate anomaly date", (value) => { value.anomalies.push(structuredClone(value.anomalies[0])); }],
      ["duplicate excluded phase", (value) => { value.excludedAcademicPhases = ["study_exam", "study_exam"]; }],
      ["selected excluded phase", (value) => { value.excludedAcademicPhases = ["term_break"]; }],
      ["teaching excluded phase", (value) => { value.excludedAcademicPhases = ["teaching"]; }],
      ["null hourly point", (value) => { value.hourlyProfile.values = [null]; }],
      ["out-of-range hourly point", (value) => { value.hourlyProfile.values[23].localHour = 24; }],
      ["null limitations", (value) => { value.limitations = [null]; }],
    ];
    for (const [label, corrupt] of corruptions) {
      const malformed = structuredClone(valid) as Record<string, any>;
      corrupt(malformed);
      expect(schoolHolidayComparisonHasRequiredShape(malformed), label).toBe(false);
    }

    const unavailable = fixture();
    if (unavailable.calendarContexts.status !== "available") throw new Error("Expected Calendar");
    unavailable.calendarContexts.dates = unavailable.calendarContexts.dates.slice(1);
    const validUnavailable = buildSchoolHolidayComparison(unavailable);
    expect(schoolHolidayComparisonHasRequiredShape(validUnavailable)).toBe(true);
    expect(schoolHolidayComparisonHasRequiredShape({ ...validUnavailable, status: "stale" })).toBe(false);
    expect(schoolHolidayComparisonHasRequiredShape({ ...validUnavailable, reason: null })).toBe(false);
  });
});

const fixture = (): Parameters<typeof buildSchoolHolidayComparison>[0] => {
  const dates = localDates("2026-05-25", "2026-06-09");
  return {
    facts: dates.flatMap(dailyFacts),
    calendarContexts: {
      status: "available",
      timezone: "Asia/Singapore",
      business_calendar_version: "ngee-calendar-ay2026-v1",
      dates: dates.map(calendarContext),
    },
    identity: {
      projectId: "ngee-ann-polytechnic",
      scopeId: "project",
      dataSnapshotId: "snapshot-ngee-august",
      projectReleaseId: "ngee-template-v10",
      comparisonWindowId: "school-holiday-comparison",
      reportTimePolicyRevision: "ngee-ann-report-time@2",
      period: { from: "2026-05-25", toExclusive: "2026-06-09" },
      businessCalendarVersion: "ngee-calendar-ay2026-v1",
      ruleRevision: "comparison.school_holiday_context@1",
    },
    comparisonPolicy: {
      anomalyRelativeThresholdPct: 50,
      anomalyAbsoluteThresholdKwh: 20,
      minimumCohortSampleCount: 1,
      minimumAnomalyBaselineSamples: 2,
    },
  };
};

type AvailableDate = Extract<EnergyIqCalendarDateContextResolution, { status: "available" }>["dates"][number];

const calendarContext = (localDate: string): AvailableDate => {
  const isWeekend = ["2026-05-30", "2026-05-31", "2026-06-06", "2026-06-07"].includes(localDate);
  const isPublicHoliday = localDate === "2026-05-27" || localDate === "2026-06-01";
  const phase = localDate >= "2026-06-01" && localDate < "2026-06-08"
    ? "term_break"
    : localDate === "2026-06-08" ? "study_exam" : "teaching";
  return {
    local_date: localDate,
    week_part: isWeekend ? "weekend" : "weekday",
    is_public_holiday: isPublicHoliday,
    academic_phase: phase,
    school_holiday_state: phase === "term_break" ? "school_holiday" : "non_school_holiday",
    academic_period_id: `academic:${phase}`,
    academic_period_from: phase === "term_break" ? "2026-06-01" : phase === "study_exam" ? "2026-06-08" : "2026-05-25",
    academic_period_to_exclusive: phase === "term_break" ? "2026-06-08" : phase === "study_exam" ? "2026-06-09" : "2026-06-01",
    academic_source: { label: "Ngee Ann Polytechnic AY2026/27 Academic Calendar" },
  };
};

const dailyFacts = (localDate: string): SchoolHolidayEnergyFact[] => {
  const total = localDate === "2026-06-03" ? 120
    : localDate === "2026-06-01" ? 50
      : localDate === "2026-05-27" ? 70
        : ["2026-06-06", "2026-06-07"].includes(localDate) ? 40
          : ["2026-05-30", "2026-05-31"].includes(localDate) ? 60
            : localDate >= "2026-06-01" && localDate < "2026-06-08" ? 60
              : localDate === "2026-06-08" ? 90 : 100;
  return ["circuit-a", "circuit-b"].map((circuitId, index) => ({
    localDate,
    kwh: localDate === "2026-06-03" ? (index === 0 ? 90 : 30) : total / 2,
    accountingRole: "official_total",
    levelId: "level-6",
    circuitId,
    evidenceRef: `reading:${localDate}:${circuitId}`,
  }));
};

const hourlyCohortFactKwh = (localDate: string): number => {
  const context = calendarContext(localDate);
  const isHolidayPhase = context.academic_phase === "term_break" || context.academic_phase === "vacation";
  if (context.is_public_holiday) return isHolidayPhase ? 100 : 200;
  if (context.week_part === "weekend") return isHolidayPhase ? 10 : 20;
  return isHolidayPhase ? 1 : 2;
};

const localDates = (from: string, toExclusive: string): string[] => {
  const dates: string[] = [];
  for (let cursor = from; cursor < toExclusive; cursor = new Date(Date.parse(`${cursor}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) {
    dates.push(cursor);
  }
  return dates;
};
