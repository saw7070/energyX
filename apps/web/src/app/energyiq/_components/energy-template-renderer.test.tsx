import { readFileSync } from "node:fs";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { EnergyScopeAnalysisDto } from "../../../lib/config-api";
import type { EnergyTemplateRenderPlan } from "./energy-template-render-plan";
import { EnergyTemplateRenderer } from "./energy-template-renderer";

describe("EnergyTemplateRenderer states", () => {
  it("does not invoke the legacy dashboard calculation model", () => {
    const source = readFileSync(new URL("./energy-template-renderer.tsx", import.meta.url), "utf8");
    expect(source).not.toContain("buildDecisionDashboardModel");
    expect(source).not.toMatch(/\.reduce\s*\(/);
  });

  it("renders a shared loading state without pretending analysis exists", () => {
    const markup = renderToStaticMarkup(
      <EnergyTemplateRenderer
        state={{
          status: "loading",
          title: "Resolving trusted facts",
          detail: "Project, Scope, period and snapshot are being resolved.",
        }}
      />,
    );

    expect(markup).toContain("role=\"status\"");
    expect(markup).toContain("Resolving trusted facts");
    expect(markup).not.toContain("kWh");
  });

  it("renders recoverable error and unsupported states with explicit meaning", () => {
    const errorMarkup = renderToStaticMarkup(
      <EnergyTemplateRenderer
        state={{ status: "error", title: "Analysis unavailable", detail: "The capability request failed." }}
        onRetry={() => undefined}
      />,
    );
    const unsupportedMarkup = renderToStaticMarkup(
      <EnergyTemplateRenderer
        state={{ status: "unsupported", title: "Water is not configured", detail: "Publish water capabilities first." }}
      />,
    );

    expect(errorMarkup).toContain("role=\"alert\"");
    expect(errorMarkup).toContain("Try again");
    expect(unsupportedMarkup).toContain("Water is not configured");
    expect(unsupportedMarkup).toContain("Unsupported");
  });

  it("keeps partial and stale advisories visible above ready modules", () => {
    const source = renderToStaticMarkup(
      <EnergyTemplateRenderer
        state={{
          status: "ready",
          analysis: analysisFixture(),
          plan: renderPlanFixture(),
          advisories: [
            { kind: "partial", title: "Partial coverage", detail: "Some intervals are unavailable." },
            { kind: "stale", title: "Data is stale", detail: "The latest scheduled sync has not completed." },
          ],
        }}
      />,
    );

    expect(source).toContain("Partial coverage");
    expect(source).toContain("Data is stale");
    expect(source).toContain("Analysis data advisories");
  });

  it("publishes the same rendered Section contract used by every Overview navigation", () => {
    const plan = renderPlanFixture();
    const markup = renderToStaticMarkup(
      <EnergyTemplateRenderer state={{ status: "ready", analysis: analysisFixture(), plan }} sectionIdPrefix="customer-overview" />,
    );
    for (const section of plan.sections) {
      const id = `customer-overview-${section.section_id}`;
      expect(markup).toContain(`id="${id}"`);
      expect(markup).toContain(`data-overview-navigation-label="${section.navigation_label}"`);
      expect(markup).toContain(`aria-labelledby="${id}-heading"`);
      expect(markup).toContain(`id="${id}-heading"`);
      expect(markup).toContain('tabindex="-1"');
    }
  });

  it("shows configured Meter Point health without treating one cumulative reading as usable", () => {
    const plan = renderPlanFixture();
    plan.sections[0]!.modules[0]!.component = {
      ...plan.sections[0]!.modules[0]!.component,
      revision_id: "quality.data_coverage@1",
      component_id: "quality.data_coverage",
      display_name: "Meter data health",
      view_key: "data_quality_summary_v1",
      family: "quality",
    };
    const markup = renderToStaticMarkup(
      <EnergyTemplateRenderer
        state={{
          status: "ready",
          analysis: analysisFixture(),
          plan,
          meterDataHealth: {
            summary: { total: 3, usable: 1, insufficientHistory: 1, noReadings: 1 },
            meters: [
              { meterPointId: "power", sourceLabel: "DB1 Power", status: "usable", cumulativeReadingCount: 2, intervalFactCount: 1 },
              { meterPointId: "light", sourceLabel: "DB1 Light", status: "insufficient_history", cumulativeReadingCount: 1, intervalFactCount: 0 },
              { meterPointId: "tv", sourceLabel: "Meeting Room TV", status: "no_readings", cumulativeReadingCount: 0, intervalFactCount: 0 },
            ],
          },
        }}
      />,
    );

    expect(markup).toContain("Configured Meter Points");
    expect(markup).toContain("DB1 Power");
    expect(markup).toContain("Usable");
    expect(markup).toContain("Needs another reading");
    expect(markup).toContain("No readings");
  });

  it("renders published recommended actions without recomputing the finding", () => {
    const analysis = analysisFixture();
    analysis.attention.push({
      code: "HIGH_OFF_HOURS",
      severity: "warning",
      title: "Off-hours consumption is elevated",
      evidence: "18.4% of selected-period energy was outside operating hours.",
      suggestedAction: "Review the top contributing circuits with the FM team.",
    });
    const plan = renderPlanFixture();
    plan.sections[0]!.modules[0]!.component = {
      ...plan.sections[0]!.modules[0]!.component,
      revision_id: "decision.recommended_actions@1",
      component_id: "decision.recommended_actions",
      display_name: "Recommended actions",
      view_key: "recommended_actions_v1",
      family: "decision",
    };
    plan.sections[0]!.modules[0]!.placement = {
      ...plan.sections[0]!.modules[0]!.placement,
      component_revision_id: "decision.recommended_actions@1",
      placement_id: "decision.recommended_actions",
      presentation: {
        ...plan.sections[0]!.modules[0]!.placement.presentation,
        visual_preset: "list",
        limit: 3,
      },
    };

    const markup = renderToStaticMarkup(<EnergyTemplateRenderer state={{ status: "ready", analysis, plan }} />);

    expect(markup).toContain("Off-hours consumption is elevated");
    expect(markup).toContain("Review the top contributing circuits with the FM team.");
  });

  it("renders release-pinned cost and an explicit operating-hours unavailable reason", () => {
    const analysis = analysisFixture();
    analysis.cost = {
      status: "available",
      amount: 27.27,
      currency: "SGD",
      tariffScheduleVersion: "tariff-v1",
      allocations: [],
    };
    const plan = renderPlanFixture();
    plan.sections[0]!.modules[0]!.component = {
      ...plan.sections[0]!.modules[0]!.component,
      revision_id: "consumption.overview@1",
      component_id: "consumption.overview",
      display_name: "Consumption overview",
      view_key: "consumption_overview_v1",
      family: "overview",
    };

    const costMarkup = renderToStaticMarkup(<EnergyTemplateRenderer state={{ status: "ready", analysis, plan }} />);

    plan.sections[0]!.modules[0]!.component = {
      ...plan.sections[0]!.modules[0]!.component,
      revision_id: "time.off_hours@1",
      component_id: "time.off_hours",
      display_name: "Off-hours analysis",
      view_key: "off_hours_analysis_v1",
      family: "time",
    };
    const offHoursMarkup = renderToStaticMarkup(<EnergyTemplateRenderer state={{ status: "ready", analysis, plan }} />);

    analysis.offHours = {
      status: "available",
      operatingKwh: 73,
      standbyKwh: 27,
      usageKwh: 27,
      sharePct: 27,
      timezone: "Asia/Singapore",
      businessCalendarVersion: "calendar-v1",
    };
    const operatingMarkup = renderToStaticMarkup(<EnergyTemplateRenderer state={{ status: "ready", analysis, plan }} />);

    expect(costMarkup).toContain("S$27.27");
    expect(costMarkup).toContain("Tariff tariff-v1");
    expect(offHoursMarkup).toContain("Published operating calendar was not found.");
    expect(operatingMarkup).toContain("Operating energy");
    expect(operatingMarkup).toContain("73.00 kWh");
    expect(operatingMarkup).toContain("Standby energy");
    expect(operatingMarkup).toContain("27.00 kWh");
    expect(operatingMarkup).toContain("Calendar calendar-v1");
    expect(operatingMarkup).toContain("Asia/Singapore project timezone");
  });

  it("renders rate-aware units for average daily use and peak interval-average power", () => {
    const analysis = analysisFixture();
    const plan = renderPlanFixture();
    plan.sections[0]!.modules[0]!.component = {
      ...plan.sections[0]!.modules[0]!.component,
      revision_id: "consumption.overview@1",
      component_id: "consumption.overview",
      display_name: "Consumption overview",
      view_key: "consumption_overview_v1",
      family: "overview",
    };

    const markup = renderToStaticMarkup(<EnergyTemplateRenderer state={{ status: "ready", analysis, plan }} />);

    expect(markup).toContain("Average daily use");
    expect(markup).toContain("10.00 kWh/day");
    expect(markup).toContain("Peak demand");
    expect(markup).toContain("8.00 kW");
  });
});

function analysisFixture(): EnergyScopeAnalysisDto {
  return {
    context: {
      userId: "admin",
      workspaceId: "workspace",
      projectId: "project",
      projectName: "Ngee Ann Polytechnic",
      scopeId: "project",
      scopeName: "Ngee Ann Polytechnic",
      scopeType: "project",
      resource: "electricity" as const,
      timezone: "Asia/Singapore",
      from: "2026-05-01T00:00:00.000Z",
      to: "2026-06-01T00:00:00.000Z",
      endExclusive: true as const,
      period: "Custom" as const,
      hierarchyRevisionId: "hierarchy-v1",
      meterFormulaRevisionId: "formula-v1",
      dataSnapshotId: "snapshot-v1",
      metricVersion: "metrics-v1",
      businessCalendarVersion: "calendar-v1",
      tariffScheduleVersion: "tariff-v1",
      resolvedAt: "2026-08-03T00:00:00.000Z",
    },
    summary: {
      usageKwh: 100,
      averageDailyUsageKwh: 10,
      peakKw: 8,
      peakAt: "2026-05-12T06:00:00.000Z",
      nonOperatingKwh: 12,
      nonOperatingSharePct: 12,
      validIntervalCount: 100,
      qualityEventCount: 1,
    },
    comparison: {
      from: "2026-04-01T00:00:00.000Z",
      to: "2026-05-01T00:00:00.000Z",
      usageKwh: 80,
      changeKwh: 20,
      changePct: 25,
    },
    hourlyProfile: [],
    categories: [],
    childScopes: [],
    circuits: [],
    topCircuits: [],
    virtualMeters: [],
    offHours: {
      status: "unavailable" as const,
      reason: {
        code: "OPERATING_CALENDAR_VERSION_NOT_FOUND" as const,
        message: "Published operating calendar was not found.",
      },
      businessCalendarVersion: "calendar-v1",
    },
    cost: {
      status: "unavailable" as const,
      reason: {
        code: "TARIFF_VERSION_NOT_FOUND" as const,
        message: "Published tariff was not found.",
      },
      tariffScheduleVersion: "tariff-v1",
    },
    dataHealth: {
      status: "partial" as const,
      coveragePct: 99,
      expectedMeterIntervalCount: 101,
      validIntervalCount: 100,
      qualityEventCount: 1,
      cumulativeDeltaMismatchCount: 0,
      averageKwMismatchCount: 0,
      invalidIntervalDurationCount: 0,
      lastSeenAt: "2026-05-31T15:45:00.000Z",
      importBatchIds: ["batch-1"],
    },
    units: {
      usage: "kWh" as const,
      demand: "kW" as const,
      intervalMinutes: 15,
      timezone: "Asia/Singapore",
    },
    attention: [],
    provenance: {
      dataSnapshotId: "snapshot-v1",
      hierarchyRevisionId: "hierarchy-v1",
      meterFormulaRevisionId: "formula-v1",
      metricVersion: "metrics-v1",
      ruleRevisionIds: [],
      aggregationRule: "component" as const,
      sourceView: "fixture",
      queryIds: [
        "scope_summary_v1",
        "hourly_profile_v1",
        "meter_breakdown_v1",
        "operational_policy_scope_intervals_v1",
        "operational_policy_meter_intervals_v1",
      ],
    },
  };
}

function renderPlanFixture(): EnergyTemplateRenderPlan {
  return {
    template_id: "project",
    target_kind: "project" as const,
    module_count: 1,
    sections: [{
      section_id: "data",
      title: "Data status",
      navigation_label: "Data status",
      modules: [{
        placement: {
          placement_id: "coverage",
          component_revision_id: "quality.data_coverage@1",
          enabled: true,
          section_id: "data",
          layout: { span: 12 as const, height: "compact" as const },
          presentation: { visual_preset: "cards" as const, density: "compact" as const, tone: "quiet" as const, show_legend: false, limit: 3 },
        },
        component: {
          revision_id: "quality.data_coverage@1",
          component_id: "quality.data_coverage",
          version: 1,
          display_name: "Data quality and coverage",
          description: "Coverage and provenance.",
          family: "quality" as const,
          view_key: "data_quality_summary_v1",
          target: "both" as const,
          metric_revision_ids: [],
          rule_revision_ids: [],
          query_ids: ["data_health_v1"],
          requirement: "always" as const,
          allowed_presentation: {
            layout: { spans: [12 as const], heights: ["compact" as const] },
            visuals: { presets: ["cards" as const], densities: ["compact" as const], tones: ["quiet" as const], legend: { configurable: false, default: false }, limit: { configurable: false, min: 3, max: 3, default: 3 } },
          },
          created_at: "2026-08-03T00:00:00.000Z",
        },
        readiness: { status: "ready" as const, label: "Published", detail: "Fixture" },
      }],
    }],
  };
}
