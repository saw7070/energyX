import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { EnergySchoolHolidayComparisonDto } from "../../../lib/config-api";
import { NgeeAnnSchoolHolidayComparison } from "./ngee-ann-school-holiday-comparison";

describe("NgeeAnnSchoolHolidayComparison", () => {
  it("shows an honest reason when a newly enabled Holiday Release lacks complete facts", () => {
    const source = availableComparison();
    const markup = renderToStaticMarkup(<NgeeAnnSchoolHolidayComparison comparison={{
      status: "unavailable",
      contract: source.contract,
      identity: source.identity,
      reason: {
        code: "FACT_COVERAGE_INCOMPLETE",
        message: "Official facts cover only 91 of 120 required dates.",
      },
      quality: {
        expectedDayCount: 120,
        completeDayCount: 91,
        coveragePct: 75.8,
        excludedLocalDates: ["2026-03-17"],
      },
      limitations: ["The comparison is withheld until official coverage reaches the Release gate."],
    }} />);

    expect(markup).toContain("School Holiday Comparison unavailable");
    expect(markup).not.toContain("学校假期对比");
    expect(markup).toContain("91 of 120 required dates");
    expect(markup).toContain("Excluded dates · 17 Mar 2026");
    expect(markup).toContain("Limitation · The comparison is withheld until official coverage reaches the Release gate.");
    expect(markup).toContain("No anomaly or recommendation is published");
    expect(markup).not.toContain("0 kWh");
  });

  it("shows the complete 24-hour curve with every exact hour inspectable", () => {
    const markup = renderToStaticMarkup(
      <NgeeAnnSchoolHolidayComparison
        comparison={availableComparison()}
        projectExplorerHref="/energyiq/explorer?projectId=ngee-ann-polytechnic"
        aiAnalystHref="/energyiq/ai?projectId=ngee-ann-polytechnic&amp;scopeId=project&amp;period=Custom&amp;from=2026-06-01&amp;to=2026-06-16"
      />,
    );

    expect(markup.match(/data-hour="\d+"/gu)).toHaveLength(24);
    for (let hour = 0; hour < 24; hour += 1) {
      expect(markup).toContain(`data-hour="${hour}"`);
      expect(markup).toContain(`${String(hour).padStart(2, "0")}:00`);
    }
    expect(markup).toContain("Holiday 24.0 kWh");
    expect(markup).toContain("Teaching 25.0 kWh");
    expect(markup).toContain("24 hourly points");
    expect(markup).toContain("weekday context");
    expect(markup).toContain("Authoritative 120-day comparison window");
    expect(markup).toContain("17 Feb 2026–16 Jun 2026");
    expect(markup).toContain("Selected Holiday interval");
    expect(markup).toContain("14 Mar 2026–22 Mar 2026");
    expect(markup).not.toContain("Term break · exact comparison window");
    expect(markup).toContain("00:00–08:00 · Overnight");
    expect(markup).toContain("08:00–20:00 · Daytime");
    expect(markup).toContain('data-hour-band="overnight"');
    expect(markup).toContain('data-hour-band="daytime"');
  });

  it("keeps deterministic Key Points and both investigation actions visible without AI", () => {
    const markup = renderToStaticMarkup(
      <NgeeAnnSchoolHolidayComparison
        comparison={availableComparison()}
        projectExplorerHref="/energyiq/explorer?projectId=ngee-ann-polytechnic"
        aiAnalystHref="/energyiq/ai?projectId=ngee-ann-polytechnic"
      />,
    );

    for (const label of ["What changed", "Pattern", "So what", "Next check"]) {
      expect(markup).toContain(label);
    }
    expect(markup).toContain("View in Energy consumption");
    expect(markup).toContain("Ask the advisor about this comparison");
    expect(markup).toContain("/energyiq/explorer?projectId=ngee-ann-polytechnic");
    expect(markup).toContain("/energyiq/ai?projectId=ngee-ann-polytechnic");
    expect(markup).toContain("period=Custom");
    expect(markup).toContain("from=2026-02-17");
    expect(markup).toContain("to=2026-06-16");
    expect(markup).toContain("dataSnapshotId=snapshot-current");
    expect(markup).toContain("projectReleaseId=release-current");
  });

  it("uses a stored fifth artifact only as an explanation above server-calculated metrics", () => {
    const markup = renderToStaticMarkup(
      <NgeeAnnSchoolHolidayComparison
        comparison={availableComparison()}
        aiHeadline="Holiday weekdays use materially less energy than adjacent Teaching weekdays"
        aiInterpretation="Holiday weekday use is lower, while the evening gap merits an operating-schedule check."
      />,
    );

    expect(markup).toContain("AI interpretation");
    expect(markup).toContain("Holiday weekdays use materially less energy than adjacent Teaching weekdays");
    expect(markup).toContain("evening gap merits an operating-schedule check");
    expect(markup).toContain("all metrics below remain server-calculated");
    expect(markup).toContain("What changed");
    expect(markup).toContain("-18.2%");
  });

  it("keeps School Holiday anomalies separate from Teaching and Exam anomalies", () => {
    const markup = renderToStaticMarkup(
      <NgeeAnnSchoolHolidayComparison comparison={availableComparison()} />,
    );

    expect(markup).toContain("School Holiday anomalies · 1");
    expect(markup).toContain("Teaching / Exam anomalies · 1");
    expect(markup).toContain("snapshot-current");
    expect(markup).toContain("release-current");
  });

  it("shows exact coverage, exclusions and limitations instead of hiding evidence boundaries", () => {
    const comparison = availableComparison();
    comparison.quality = {
      expectedDayCount: 120,
      completeDayCount: 119,
      coveragePct: 99.2,
      excludedLocalDates: ["2026-03-17"],
    };
    comparison.limitations = ["The comparison is descriptive and does not prove causation."];

    const markup = renderToStaticMarkup(
      <NgeeAnnSchoolHolidayComparison comparison={comparison} />,
    );

    expect(markup).toContain("Coverage and caveats");
    expect(markup).toContain("119 of 120 dates");
    expect(markup).toContain("Excluded dates · 17 Mar 2026");
    expect(markup).toContain("Excluded academic phases · Study / Exam");
    expect(markup).toContain("Limitation · The comparison is descriptive and does not prove causation.");
    expect(markup).toContain("Report-time policy · ngee-ann-report-time@holiday-1");
    expect(markup).toContain("Comparison window · school-holiday-comparison");
  });
});

const availableComparison = (): Extract<EnergySchoolHolidayComparisonDto, { status: "available" }> => ({
  status: "available",
  contract: "energyiq-school-holiday-comparison@1",
  identity: {
    projectId: "ngee-ann-polytechnic",
    scopeId: "project",
    dataSnapshotId: "snapshot-current",
    projectReleaseId: "release-current",
    comparisonWindowId: "school-holiday-comparison",
    reportTimePolicyRevision: "ngee-ann-report-time@holiday-1",
    period: { from: "2026-02-17", toExclusive: "2026-06-17" },
    businessCalendarVersion: "sg-calendar-holiday-v1",
    ruleRevision: "comparison.school_holiday_context@1",
  },
  selectedHolidayInterval: {
    academicPhase: "term_break",
    from: "2026-03-14",
    toExclusive: "2026-03-23",
  },
  comparisons: [{
    dayContext: "weekday",
    weekPart: "weekday",
    isPublicHoliday: false,
    status: "available",
    actual: { academicPhase: "term_break", averageKwh: 409.1, sampleCount: 5 },
    baseline: { academicPhase: "teaching", averageKwh: 500, sampleCount: 10 },
    deltaKwh: -90.9,
    deltaPercent: -18.18,
    evidence: evidence(),
  }],
  hourlyProfile: {
    status: "available",
    dayContext: "weekday",
    actualSampleCount: 5,
    baselineSampleCount: 10,
    values: Array.from({ length: 24 }, (_, localHour) => ({
      localHour,
      actualAverageKwh: localHour + 1,
      baselineAverageKwh: localHour + 2,
      deltaKwh: -1,
    })),
  },
  anomalies: [
    {
      localDate: "2026-03-17",
      academicPhase: "term_break",
      schoolHolidayState: "school_holiday",
      dayContext: "weekday",
      actualKwh: 120,
      baselineKwh: 80,
      baselineSampleCount: 4,
      deltaKwh: 40,
      deltaPercent: 50,
      baselineDates: ["2026-03-16"],
      evidence: evidence(),
    },
    {
      localDate: "2026-05-04",
      academicPhase: "study_exam",
      schoolHolidayState: "non_school_holiday",
      dayContext: "weekday",
      actualKwh: 130,
      baselineKwh: 90,
      baselineSampleCount: 4,
      deltaKwh: 40,
      deltaPercent: 44.4,
      baselineDates: ["2026-05-03"],
      evidence: evidence(),
    },
  ],
  quality: { expectedDayCount: 120, completeDayCount: 120, coveragePct: 100, excludedLocalDates: [] },
  excludedAcademicPhases: ["study_exam"],
  limitations: [],
});

const evidence = () => ({
  dataSnapshotId: "snapshot-current",
  projectReleaseId: "release-current",
  comparisonWindowId: "school-holiday-comparison" as const,
  reportTimePolicyRevision: "ngee-ann-report-time@holiday-1",
  businessCalendarVersion: "sg-calendar-holiday-v1",
  ruleRevision: "comparison.school_holiday_context@1",
  metricId: "energy.total_usage_kwh@1" as const,
  queryIds: ["school_holiday_context_facts_v1"] as ["school_holiday_context_facts_v1"],
  period: { from: "2026-02-17", toExclusive: "2026-06-17" },
  actualRefs: ["fact:actual"],
  baselineRefs: ["fact:baseline"],
});
