import { describe, expect, it } from "vitest";

import {
  NGEE_ANN_HOLIDAY_CALENDAR_VERSION,
  NGEE_ANN_CORE_SECTION_IDS,
  ngeeAnnHolidayCalendarHasRequiredContract,
  resolveNgeeAnnSectionManifest,
} from "./ngee-ann-section-manifest.js";
import { SINGAPORE_2026_PUBLIC_HOLIDAYS } from "./ngee-ann-calendar-policy.js";

describe("Ngee Ann Release-derived Section manifest", () => {
  it("keeps a historical four-Section Release normal when Holiday was not pinned", () => {
    expect(resolveNgeeAnnSectionManifest({
      projectRelease: release(),
      overviewDefinition: definition(),
      reportTimePolicy: policy(),
    })).toEqual({
      contract: "energyiq-ngee-ann-section-manifest@1",
      projectReleaseId: "ngee-release-v1",
      enabledSectionIds: [...NGEE_ANN_CORE_SECTION_IDS],
      disabledCapabilities: [{
        sectionId: "school-holiday-comparison",
        reason: "SCHOOL_HOLIDAY_OVERVIEW_SECTION_NOT_PINNED",
      }],
    });
  });

  it("enables Holiday only from the exact Calendar, Rule, Section and 120-day window strategy", () => {
    expect(resolveNgeeAnnSectionManifest({
      projectRelease: release(),
      overviewDefinition: definitionWithHoliday(),
      reportTimePolicy: policy(),
    })).toMatchObject({
      enabledSectionIds: [
        ...NGEE_ANN_CORE_SECTION_IDS,
        "school-holiday-comparison",
      ],
      disabledCapabilities: [],
    });
  });

  it("rejects a non-canonical Calendar pin even when every other Holiday pin is present", () => {
    expect(resolveNgeeAnnSectionManifest({
      projectRelease: release("ngee-academic-calendar-v1"),
      overviewDefinition: definitionWithHoliday(),
      reportTimePolicy: policy(),
    })).toMatchObject({
      enabledSectionIds: [...NGEE_ANN_CORE_SECTION_IDS],
      disabledCapabilities: [{
        sectionId: "school-holiday-comparison",
        reason: "SCHOOL_HOLIDAY_CALENDAR_CONTRACT_INVALID",
      }],
    });
  });

  it("requires every published Singapore Holiday exception to keep its public-holiday classification", () => {
    const calendar = holidayCalendar();
    expect(ngeeAnnHolidayCalendarHasRequiredContract(calendar)).toBe(true);

    const missing = structuredClone(calendar);
    missing.entries[0]!.exceptions = missing.entries[0]!.exceptions
      .filter(({ date }) => date !== "2026-06-01");
    expect(ngeeAnnHolidayCalendarHasRequiredContract(missing)).toBe(false);

    const reclassified = structuredClone(calendar);
    reclassified.entries[0]!.exceptions.find(({ date }) => date === "2026-06-01")!.classification = "special_closure";
    expect(ngeeAnnHolidayCalendarHasRequiredContract(reclassified)).toBe(false);
  });

  it("requires the managed Holiday Calendar to preserve the Ngee Ann 08:00-18:00 weekday boundary", () => {
    const calendar = holidayCalendar();
    expect(ngeeAnnHolidayCalendarHasRequiredContract(calendar)).toBe(true);

    const alwaysOpen = structuredClone(calendar);
    alwaysOpen.entries[0]!.weekly.monday = [{ from: "00:00", to: "24:00" }];
    expect(ngeeAnnHolidayCalendarHasRequiredContract(alwaysOpen)).toBe(false);

    const openWeekend = structuredClone(calendar);
    openWeekend.entries[0]!.weekly.sunday = [{ from: "08:00", to: "18:00" }];
    expect(ngeeAnnHolidayCalendarHasRequiredContract(openWeekend)).toBe(false);
  });

  it.each([
    ["119 days", { kind: "rolling_complete_days", days: 119 }],
    ["wrong strategy", { kind: "month_to_date" }],
  ])("rejects a matching window id with %s", (_label, strategy) => {
    expect(resolveNgeeAnnSectionManifest({
      projectRelease: release(),
      overviewDefinition: definitionWithHoliday(),
      reportTimePolicy: policy(strategy),
    })).toMatchObject({
      enabledSectionIds: [...NGEE_ANN_CORE_SECTION_IDS],
      disabledCapabilities: [{
        sectionId: "school-holiday-comparison",
        reason: "SCHOOL_HOLIDAY_COMPARISON_WINDOW_STRATEGY_INVALID",
      }],
    });
  });
});

const release = (businessCalendarVersion: string = NGEE_ANN_HOLIDAY_CALENDAR_VERSION) => ({
  revision_id: "ngee-release-v1",
  project_id: "ngee-ann-polytechnic",
  business_calendar_version: businessCalendarVersion,
  selected_rule_revision_ids: ["comparison.school_holiday_context@1"],
});

const holidayCalendar = () => ({
  version_id: NGEE_ANN_HOLIDAY_CALENDAR_VERSION,
  academic_periods: [{
    id: "ay2026-sem1-break",
    from: "2026-06-15",
    to: "2026-06-29",
    phase: "term_break" as const,
    source: { label: "Ngee Ann Academic Calendar" },
  }],
  entries: [{
    weekly: {
      monday: [{ from: "08:00", to: "18:00" }],
      tuesday: [{ from: "08:00", to: "18:00" }],
      wednesday: [{ from: "08:00", to: "18:00" }],
      thursday: [{ from: "08:00", to: "18:00" }],
      friday: [{ from: "08:00", to: "18:00" }],
      saturday: [] as Array<{ from: string; to: string }>,
      sunday: [] as Array<{ from: string; to: string }>,
    },
    exceptions: SINGAPORE_2026_PUBLIC_HOLIDAYS.map(({ date, label, classification }) => ({
      date,
      label,
      classification: classification as "public_holiday" | "special_closure",
    })),
  }],
});

type TestSection = {
  key: string;
  title: string;
  managementQuestion: string;
  primaryWindowId: string;
  supportingWindowIds: string[];
  blocks: Array<{
    key: string;
    capabilityRevisionId: string;
    windowId: string;
    emphasis: string;
  }>;
};

const definition = (sections: TestSection[] = []) => ({
  template_revision_id: "ngee-release-v1",
  renderer_key: "ngee-ann-overview" as const,
  time_policy_revision_id: "ngee-ann-report-time@2",
  definition: {
    contractRevision: "energyiq-overview-definition@1" as const,
    timePolicyRevisionId: "ngee-ann-report-time@2",
    sections,
  },
});

const definitionWithHoliday = () => definition([{
  key: "school-holiday-comparison",
  title: "School Holiday comparison",
  managementQuestion: "How does holiday use compare with teaching periods?",
  primaryWindowId: "school-holiday-comparison",
  supportingWindowIds: [],
  blocks: [{
    key: "school-holiday-comparison",
    capabilityRevisionId: "overview.consumption@1",
    windowId: "school-holiday-comparison",
    emphasis: "primary",
  }],
}]);

const policy = (strategy: Record<string, unknown> = {
  kind: "rolling_complete_days",
  days: 120,
}) => ({
  revision_id: "ngee-ann-report-time@2",
  policy: {
    policyId: "ngee-ann-report-time",
    revision: "2",
    windows: [{
      windowId: "school-holiday-comparison",
      role: "comparison",
      label: "School Holiday comparison",
      strategy,
    }],
  },
});
