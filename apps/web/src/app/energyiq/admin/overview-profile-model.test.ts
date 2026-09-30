import { describe, expect, it } from "vitest";

import {
  presentAdminOverviewProfile,
  resolveAdminOverviewPreviewMode,
} from "./overview-profile-model";

describe("presentAdminOverviewProfile", () => {
  it("uses customer language for the registered multi-horizon contract", () => {
    expect(presentAdminOverviewProfile({
      rendererKey: "preschool-overview",
      rendererVersion: "1",
      contractVersion: "project-analysis-snapshot@1",
      currentAnalysisWindow: "current-overview-28d",
      source: "overview-definition",
      horizons: {
        latestStatus: "latest-complete-day",
        shortTermDays: 7,
        mainDays: 28,
      },
    })).toEqual({
      name: "Preschool portfolio overview",
      revisionLabel: "preschool-overview@1",
      latestStatusLabel: "Latest complete day",
      shortTermLabel: "Rolling 7 days",
      mainRangeLabel: "Rolling 28 complete days",
    });
  });

  it("never presents the generic layout preview as a registered customer Renderer", () => {
    const registered = {
      rendererKey: "ngee-ann-overview" as const,
      rendererVersion: "1" as const,
      contractVersion: "project-analysis-snapshot@1" as const,
      currentAnalysisWindow: "current-month-to-date" as const,
      source: "overview-definition" as const,
      horizons: {
        latestStatus: "latest-complete-day" as const,
        shortTermDays: 7 as const,
        mainDays: 28 as const,
      },
    };
    expect(resolveAdminOverviewPreviewMode(registered)).toBe("customer-renderer-handoff");
    expect(resolveAdminOverviewPreviewMode(null)).toBe("generic-layout-preview");
  });
});
