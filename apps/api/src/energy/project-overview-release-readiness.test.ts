import { describe, expect, it } from "vitest";

import {
  operatingCalendarCoversOverviewLookback,
  resolveOverviewCalendarLookbackRequirement,
} from "./project-overview-release-readiness.js";

const anomalyRule = {
  revision_id: "comparison.daily_usage_above_baseline@1",
  rule_id: "comparison.daily_usage_above_baseline",
  version: 1,
  display_name: "Daily anomaly",
  description: "Daily anomaly",
  family: "comparison" as const,
  severity: "warning" as const,
  evaluation_key: "DAILY_USAGE_ABOVE_BASELINE",
  metric_revision_ids: ["energy.total_usage_kwh@1"],
  parameters: { maximum_lookback_days: 60 },
  requirement: "historical_baseline" as const,
  created_at: "2026-01-01T00:00:00.000Z",
};

describe("Project Overview release readiness", () => {
  it("derives Ngee Ann's Calendar requirement from the month-to-date period and pinned Rule", () => {
    expect(resolveOverviewCalendarLookbackRequirement({
      rendererKey: "ngee-ann-overview",
      overviewPeriodLocalFrom: "2026-06-01",
      anomalyRule,
    })).toEqual({
      requiredLocalFrom: "2026-04-02",
      ruleRevisionId: anomalyRule.revision_id,
      maximumLookbackDays: 60,
    });
  });

  it("accepts complete coverage, rejects a late Calendar, and leaves Preschool unchanged", () => {
    const calendar = (effectiveFrom: string) => ({
      version_id: "calendar-v1",
      project_id: "ngee-ann-polytechnic",
      timezone: "Asia/Singapore",
      entries: [{
        id: "project-hours",
        owner: { kind: "project" as const },
        effective_from: effectiveFrom,
        weekly: {
          monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [],
        },
      }],
      published_by: "admin",
      published_at: "2026-01-01T00:00:00.000Z",
    });
    expect(operatingCalendarCoversOverviewLookback({
      calendar: calendar("2026-04-02"),
      rootScopeId: "project",
      requiredLocalFrom: "2026-04-02",
      overviewPeriodLocalFrom: "2026-06-01",
    })).toBe(true);
    expect(operatingCalendarCoversOverviewLookback({
      calendar: calendar("2026-04-21"),
      rootScopeId: "project",
      requiredLocalFrom: "2026-04-02",
      overviewPeriodLocalFrom: "2026-06-01",
    })).toBe(false);
    expect(resolveOverviewCalendarLookbackRequirement({
      rendererKey: "preschool-overview",
      overviewPeriodLocalFrom: "2026-06-01",
      anomalyRule,
    })).toBeNull();
  });
});
