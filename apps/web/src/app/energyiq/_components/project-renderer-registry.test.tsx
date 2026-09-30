import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ProjectRenderer,
  selectProjectRenderer,
} from "./project-renderer-registry";
import { ngeeAnnGoldenSnapshot } from "./ngee-ann-overview.test-fixture";
import { preschoolGoldenSnapshot } from "./preschool-overview.test-fixture";

const emptyPlan = {
  template_id: "project",
  target_kind: "project" as const,
  sections: [],
  module_count: 0,
};

describe("Project Renderer Registry", () => {
  it("selects the registered Ngee Ann, Preschool, Tuya, Energy Template and Admin Generic Preview renderers", () => {
    expect(selectProjectRenderer({ mode: "customer", rendererKey: "ngee-ann-overview" }))
      .toMatchObject({ status: "ready", key: "ngee-ann-overview", version: "1" });
    expect(selectProjectRenderer({ mode: "customer", rendererKey: "preschool-overview" }))
      .toMatchObject({ status: "ready", key: "preschool-overview", version: "1" });
    expect(selectProjectRenderer({ mode: "customer", rendererKey: "tuya-office-overview" }))
      .toMatchObject({ status: "ready", key: "tuya-office-overview", version: "1" });
    expect(selectProjectRenderer({ mode: "customer", rendererKey: "energy-template-overview" }))
      .toMatchObject({ status: "ready", key: "energy-template-overview", version: "1" });
    expect(selectProjectRenderer({ mode: "admin-preview" }))
      .toMatchObject({ status: "ready", key: "admin-generic-preview", version: "1" });
  });

  it("routes Tuya Office to the accepted customer Overview instead of the generic template", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    snapshot.context.projectId = "tuya-office";
    snapshot.context.projectName = "Tuya Office";
    snapshot.renderer.key = "tuya-office-overview";
    snapshot.projectRelease.projectId = "tuya-office";
    snapshot.projectRelease.renderer.key = "tuya-office-overview";
    snapshot.projectRelease.id = "tuya-office-template-current";
    snapshot.analysis.context.projectId = "tuya-office";
    snapshot.analysis.context.projectName = "Tuya Office";
    snapshot.dataSnapshot.id = "tuya-snapshot-a";
    snapshot.context.dataSnapshotId = "tuya-snapshot-a";
    snapshot.analysis.summary.usageKwh = 1234.5;
    snapshot.meterDataHealth = {
      summary: { total: 2, usable: 1, insufficientHistory: 1, noReadings: 0 },
      meters: [
        {
          meterPointId: "panel-a-total",
          sourceLabel: "Panel A Total",
          status: "usable",
          cumulativeReadingCount: 10,
          intervalFactCount: 9,
        },
        {
          meterPointId: "panel-b-total",
          sourceLabel: "Panel B Total",
          status: "insufficient_history",
          cumulativeReadingCount: 1,
          intervalFactCount: 0,
        },
      ],
    };
    const dailyScope = snapshot.analysis.dailyTotals?.scopes.find(
      (scope) => scope.scopeId === snapshot.analysis.context.scopeId,
    ) ?? snapshot.analysis.dailyTotals?.scopes[0];
    if (!dailyScope || dailyScope.rows.length < 3) throw new Error("Expected Tuya daily trend fixture");
    dailyScope.rows[1] = {
      ...dailyScope.rows[1]!,
      usageKwh: null,
      dataHealth: { ...dailyScope.rows[1]!.dataHealth, status: "unavailable" },
    };
    dailyScope.rows[2] = {
      ...dailyScope.rows[2]!,
      dataHealth: { ...dailyScope.rows[2]!.dataHealth, status: "partial" },
    };
    snapshot.analysis.hourlyProfile = snapshot.analysis.hourlyProfile.filter((point) => point.hour !== 3);
    if (snapshot.analysis.dailyUsageAnomalies?.status !== "available") {
      throw new Error("Expected governed anomaly fixture");
    }
    snapshot.analysis.dailyUsageAnomalies.evidencePins = {
      ...snapshot.analysis.dailyUsageAnomalies.evidencePins,
      projectReleaseId: snapshot.projectRelease.id,
      dataSnapshotId: snapshot.dataSnapshot.id,
      hierarchyRevisionId: snapshot.analysis.context.hierarchyRevisionId,
      meterMappingRevisionId: snapshot.analysis.context.meterMappingRevisionId,
      meterFormulaRevisionId: snapshot.analysis.context.meterFormulaRevisionId,
      metricVersion: snapshot.analysis.context.metricVersion,
      businessCalendarVersion: snapshot.analysis.context.businessCalendarVersion,
    };

    const markup = renderToStaticMarkup(
      <ProjectRenderer
        request={{ mode: "customer", rendererKey: "tuya-office-overview" }}
        state={{ status: "ready", snapshot, plan: emptyPlan }}
      />,
    );

    expect(markup).toContain('data-project-renderer="tuya-office-overview"');
    expect(markup).toContain('data-tuya-office-overview="true"');
    expect(markup).toContain("Key Findings");
    expect(markup).toContain("Overall performance");
    expect(markup).toContain("Energy composition");
    expect(markup).toContain("Operating pattern");
    expect(markup).toContain("Circuit attribution &amp; data health");
    expect(markup).toContain("Energy, safety &amp; anomaly review");
    expect(markup).toContain("Anomaly conclusions withheld");
    expect(markup).not.toContain("Energy data is not an electrical safety inspection");
    expect(markup).not.toContain("Governed daily anomaly triggered");
    expect(markup).not.toContain("against a governed baseline");
    expect(markup).toContain("Recommended actions");
    expect(markup).toContain("Recommended actions withheld");
    expect(markup).toContain("Governed AI interpretation");
    expect(markup).toContain('data-governed-ai-status="withheld"');
    expect(markup).not.toContain("Reading the exact saved Artifact");
    expect(markup).toContain("Configured meters");
    expect(markup).toContain("Usable");
    expect(markup).toContain('data-daily-trend-segment="true"');
    expect(markup.match(/data-daily-trend-segment=/g)).toHaveLength(2);
    expect(markup).toContain('data-daily-trend-status="unavailable"');
    expect(markup).toContain('data-daily-trend-status="partial"');
    expect(markup).toContain("5 complete · 1 partial · 1 unavailable");
    expect(markup).toContain('data-overview-metric="average-per-day" data-evidence-status="unavailable"');
    expect(markup).toContain("Complete-day average unavailable");
    expect(markup).not.toContain("Period comparison unavailable until every published day is complete");
    expect(markup).not.toContain("above the comparison period");
    expect(markup).not.toContain("below the comparison period");
    expect(markup).toContain('data-hour-status="unavailable"');
    expect(markup).not.toContain("DB1 and DB2 use their published total meters");
    expect(markup.match(/data-overview-section=/g)).toHaveLength(8);
    expect(markup.match(/tabindex="-1"/g)).toHaveLength(8);
    expect(markup).toContain('aria-labelledby="tuya-key-findings-heading"');
    expect(markup).toContain('data-snapshot-id="tuya-snapshot-a"');
    expect(markup).toContain("1,234.5 kWh");
    expect(markup).not.toContain("947.52");
    expect(markup).not.toContain("energy-snapshot-c404");
    expect(markup).not.toContain("No modules are enabled");

    snapshot.dataQuality.coveragePct = 94;
    const partialMarkup = renderToStaticMarkup(
      <ProjectRenderer
        request={{ mode: "customer", rendererKey: "tuya-office-overview" }}
        state={{ status: "ready", snapshot, plan: emptyPlan }}
      />,
    );
    expect(partialMarkup).toContain('data-tuya-coverage-policy="partial"');
    expect(partialMarkup).toContain("Partial data");
    expect(partialMarkup).toContain("94% coverage");
    expect(partialMarkup).not.toContain('data-finding-tone="energy"');
    expect(partialMarkup).toContain("Business findings withheld");
    expect(partialMarkup).toContain("Energy, safety &amp; anomaly review");
    expect(partialMarkup).toContain("Anomaly conclusions withheld");
    expect(partialMarkup).toContain("Recommended actions");
    expect(partialMarkup).toContain("Recommended actions withheld");
    expect(partialMarkup).toContain('data-governed-ai-status="withheld"');
    expect(partialMarkup).not.toContain("Governed daily anomaly triggered");

    snapshot.dataQuality.coveragePct = 100;
    for (const row of dailyScope.rows) {
      row.usageKwh ??= 0;
      row.dataHealth.status = "complete";
    }

    snapshot.dataSnapshot.id = "tuya-snapshot-b";
    snapshot.context.dataSnapshotId = "tuya-snapshot-b";
    snapshot.analysis.summary.usageKwh = 876.5;
    const refreshedMarkup = renderToStaticMarkup(
      <ProjectRenderer
        request={{ mode: "customer", rendererKey: "tuya-office-overview" }}
        state={{ status: "ready", snapshot, plan: emptyPlan }}
      />,
    );
    expect(refreshedMarkup).toContain('data-snapshot-id="tuya-snapshot-b"');
    expect(refreshedMarkup).toContain("876.5 kWh");
    expect(refreshedMarkup).not.toContain("tuya-snapshot-a");
    expect(refreshedMarkup).not.toContain("1,234.5 kWh");
    expect(refreshedMarkup).toContain("Energy data is not an electrical safety inspection");
    expect(refreshedMarkup).toContain("Governed daily anomaly evidence is unavailable");
    expect(refreshedMarkup).not.toContain("Anomaly conclusions withheld");
    expect(refreshedMarkup).not.toContain("Recommended actions withheld");
    expect(refreshedMarkup).toContain("Reading the exact saved Artifact");
    expect(refreshedMarkup).not.toContain("Governed daily anomaly triggered");
    expect(refreshedMarkup).toContain("Governed daily anomaly evidence is unavailable");
  });

  it("renders a concise configuration state for an unregistered customer Project", () => {
    const selection = selectProjectRenderer({ mode: "customer", rendererKey: null });
    expect(selection).toEqual({
      status: "configuration-required",
      title: "Project analysis is not configured",
      detail: "Ask an administrator to publish a Project Template Revision with a registered customer Renderer.",
    });

    const markup = renderToStaticMarkup(
      <ProjectRenderer
        request={{ mode: "customer", rendererKey: null }}
        state={{
          status: "loading",
          title: "This generic dashboard must not render",
          detail: "No published customer Renderer exists.",
        }}
      />,
    );
    expect(markup).toContain("Project analysis is not configured");
    expect(markup).not.toContain("This generic dashboard must not render");
  });

  it("routes the published Energy Template renderer through the shared system components", () => {
    const snapshot = ngeeAnnGoldenSnapshot();
    snapshot.renderer.key = "energy-template-overview";
    snapshot.projectRelease.renderer.key = "energy-template-overview";
    snapshot.meterDataHealth = {
      summary: { total: 2, usable: 1, insufficientHistory: 1, noReadings: 0 },
      meters: [
        { meterPointId: "power", sourceLabel: "DB1 Power", status: "usable", cumulativeReadingCount: 10, intervalFactCount: 9 },
        { meterPointId: "light", sourceLabel: "DB1 Light", status: "insufficient_history", cumulativeReadingCount: 1, intervalFactCount: 0 },
      ],
    };
    const plan = meterHealthPlan();

    const markup = renderToStaticMarkup(
      <ProjectRenderer
        request={{ mode: "customer", rendererKey: "energy-template-overview" }}
        state={{ status: "ready", snapshot, plan }}
      />,
    );

    expect(markup).toContain('data-project-renderer="energy-template-overview"');
    expect(markup).toContain("Configured Meter Points");
    expect(markup).toContain("DB1 Light");
    expect(markup).not.toContain("data-ngee-ann-overview");
    expect(markup).not.toContain("data-preschool-overview");
  });

  it("routes Ngee Ann and Preschool to independent Snapshot Renderers", () => {
    const state = {
      status: "ready" as const,
      snapshot: ngeeAnnGoldenSnapshot(),
      plan: emptyPlan,
    };

    const ngeeAnnMarkup = renderToStaticMarkup(
      <ProjectRenderer
        request={{ mode: "customer", rendererKey: "ngee-ann-overview" }}
        state={state}
      />,
    );
    const preschoolSnapshot = preschoolGoldenSnapshot();
    if (preschoolSnapshot.preschoolOperational?.status !== "available") {
      throw new Error("Expected operational Preschool fixture");
    }
    const exceptionCentre = preschoolSnapshot.preschoolOperational.spikes.standby.centres
      .find((centre) => centre.centreCode === "E");
    if (!exceptionCentre) throw new Error("Expected Centre E standby Spike fixture");
    exceptionCentre.worstSpike.localDate = "2026-05-27";
    exceptionCentre.worstSpike.dayType = "calendar_exception";
    const preschoolMarkup = renderToStaticMarkup(
      <ProjectRenderer
        request={{ mode: "customer", rendererKey: "preschool-overview" }}
        state={{ status: "ready", snapshot: preschoolSnapshot, plan: emptyPlan }}
        aiAnalystHref="/energyiq/ai?projectId=preschool-demo"
      />,
    );

    expect(ngeeAnnMarkup).toContain("data-ngee-ann-overview=\"true\"");
    expect(ngeeAnnMarkup).toContain("1531.1683");
    expect(ngeeAnnMarkup).not.toContain("No modules are enabled");
    expect(preschoolMarkup).toContain("data-preschool-overview=\"true\"");
    expect(preschoolMarkup).toContain("24,921.81 kWh");
    expect(preschoolMarkup).toContain("Centre A");
    expect(preschoolMarkup).toContain("Benchmark Analysis");
    expect(preschoolMarkup).not.toContain("P50 / P75 peer benchmark");
    expect(preschoolMarkup).toContain("Review first · action priority");
    expect(preschoolMarkup).toContain("12.90 kWh/m²/yr");
    expect(preschoolMarkup).toContain("22.9 kWh/person");
    expect(preschoolMarkup).toContain("data-benchmark-plot=\"eui-x-per-pax-y\"");
    expect(preschoolMarkup.match(/data-benchmark-centre=/g)).toHaveLength(30);
    expect(preschoolMarkup).toMatch(/data-benchmark-centre=\"A\"[^>]*data-marker-shape=\"circle\"/);
    expect(preschoolMarkup).toMatch(/data-benchmark-centre=\"B\"[^>]*data-marker-shape=\"triangle\"/);
    expect(preschoolMarkup).toMatch(/data-benchmark-centre=\"C\"[^>]*data-marker-shape=\"diamond\"/);
    expect(preschoolMarkup).toContain("Senior Care Center · circle");
    expect(preschoolMarkup).toContain("Active Aging Center · triangle");
    expect(preschoolMarkup).toContain("Preschool · diamond");
    expect(preschoolMarkup).toContain("data-benchmark-p75-axis=\"eui\"");
    expect(preschoolMarkup).toContain("data-benchmark-p75-axis=\"per-pax\"");
    expect(preschoolMarkup.match(/data-benchmark-priority-label=/g)).toHaveLength(3);
    expect(preschoolMarkup).toContain("Annualised EUI (kWh/m²/yr) →");
    expect(preschoolMarkup).toContain("↑ Energy per person (kWh/person/month)");
    expect(preschoolMarkup.match(/data-benchmark-distribution=/g)).toHaveLength(6);
    expect(preschoolMarkup.match(/data-distribution-centre=/g)).toHaveLength(60);
    expect(preschoolMarkup).toContain("data-shared-axis=\"eui\"");
    expect(preschoolMarkup).toContain("data-shared-axis=\"per-pax\"");
    expect(preschoolMarkup).toContain("Annualised EUI estimate");
    expect(preschoolMarkup).toContain("Energy per person");
    expect(preschoolMarkup).toContain("Observed Centres only. Bars show sample frequency; markers show each Centre. No fitted curve is used.");
    expect(preschoolMarkup).toContain("P50");
    expect(preschoolMarkup).toContain("P75");
    expect(preschoolMarkup).not.toMatch(/Std Dev|Mean \(μ\)/i);
    expect(preschoolMarkup).toContain("Standby Energy Wastage — Post Operating Hours");
    expect(preschoolMarkup).toContain('data-standby-kpis="five-decision-metrics"');
    expect(preschoolMarkup).toContain("3,103.78 kWh");
    expect(preschoolMarkup).toContain("S$846.40");
    expect(preschoolMarkup.match(/data-standby-appliance-segment=/g)).toHaveLength(9);
    expect(preschoolMarkup.match(/data-standby-appliance=/g)).toHaveLength(9);
    expect(preschoolMarkup.match(/data-standby-spike-event=/g)).toHaveLength(7);
    expect(preschoolMarkup.match(/data-review-priority-centre=/g)).toHaveLength(3);
    expect(preschoolMarkup).toContain("After-hours Review Priority");
    expect(preschoolMarkup).not.toContain("SOP Compliance Score");
    expect(preschoolMarkup).toContain("Operating Hours Analysis");
    expect(preschoolMarkup).toContain("21,818.03 kWh");
    expect(preschoolMarkup).toContain("S$5,949.78");
    expect(preschoolMarkup).toContain('data-operating-kpis="five-decision-metrics"');
    expect(preschoolMarkup.match(/data-operating-appliance-segment=/g)).toHaveLength(9);
    expect(preschoolMarkup.match(/data-operating-appliance=/g)).toHaveLength(9);
    expect(preschoolMarkup.match(/data-operating-spike-centre=/g)).toHaveLength(14);
    expect(preschoolMarkup.match(/data-operating-spike-event=/g)).toHaveLength(21);
    expect(preschoolMarkup).toContain("18 May · 14:00–15:00");
    expect(preschoolMarkup).toContain("observed leading contributor");
    expect(preschoolMarkup).not.toContain("Public Holiday");
    expect(preschoolMarkup).toContain("Overall metrics");
    expect(preschoolMarkup.match(/data-overall-summary-metric=/g)).toHaveLength(3);
    expect(preschoolMarkup).toContain("Energy &amp; cost by centre type");
    expect(preschoolMarkup).toContain("S$0.2727/kWh before GST");
    expect(preschoolMarkup).toContain("Key Findings");
    expect(preschoolMarkup).toContain("At a glance");
    expect(preschoolMarkup).toContain("AI energy analyst");
    expect(preschoolMarkup).toContain("Loading saved AI summary…");
    expect(preschoolMarkup).toContain("deterministic Overview is ready");
    expect(preschoolMarkup).toContain("Energy used after closing");
    expect(preschoolMarkup).toContain("L · E · N");
    expect(preschoolMarkup).toContain("High for both floor area and headcount");
    expect(preschoolMarkup).toContain("Unusual peaks during opening hours");
    expect(preschoolMarkup).toContain('data-decision-priority="after-hours"');
    expect(preschoolMarkup).toContain("12.5%");
    expect(preschoolMarkup).toContain("Centres compared");
    expect(preschoolMarkup).toContain("Limitation and evidence");
    expect(preschoolMarkup).not.toContain("What to do next");
    expect(preschoolMarkup).toContain("Centre detail");
    expect(preschoolMarkup).toContain("5,200.00 kWh");
    expect(preschoolMarkup).toContain("9 Appliances");
    expect(preschoolMarkup).toContain("Leading contributor");
    expect(preschoolMarkup).not.toContain("Leading circuit");
    expect(preschoolMarkup).toContain("published Circuit aliases");
    const afterHoursPriority = preschoolMarkup.indexOf('data-decision-priority="after-hours"');
    const efficiencyPriority = preschoolMarkup.indexOf('data-decision-priority="efficiency"');
    const operatingPriority = preschoolMarkup.indexOf('data-decision-priority="operating"');
    const aiSlot = preschoolMarkup.indexOf("AI energy analyst");
    expect(efficiencyPriority).toBeGreaterThan(-1);
    expect(aiSlot).toBeGreaterThan(-1);
    expect(aiSlot).toBeGreaterThan(operatingPriority);
    expect(afterHoursPriority).toBeGreaterThan(efficiencyPriority);
    expect(operatingPriority).toBeGreaterThan(afterHoursPriority);
    const decisionMarkup = preschoolMarkup.slice(efficiencyPriority, preschoolMarkup.indexOf("Monthly Energy Outlook"));
    expect(decisionMarkup).toContain("Evidence · View supporting evidence");
    expect(decisionMarkup).not.toContain("preschool-hour-slot-spike-v1");
    expect(preschoolMarkup).toContain("June 2026 planning baseline");
    expect(preschoolMarkup).toContain('data-planning-baseline="naive-weekly-average"');
    expect(preschoolMarkup).toContain("24,348 kWh");
    expect(preschoolMarkup).toContain("S$6,640");
    expect(preschoolMarkup).toContain("27.27¢/kWh before GST");
    expect(preschoolMarkup).toContain("View official SP tariff source");
    expect(preschoolMarkup).toContain("not an AI or validated statistical forecast");
    expect(preschoolMarkup).toContain("not a customer bill");
    expect(preschoolMarkup).toContain("Planning Baseline and Actual availability");
    expect(preschoolMarkup).toContain("compatible frozen Saved Plan is required");
    expect(preschoolMarkup).toContain("View all 30 Centres and normalised metrics");
    expect(preschoolMarkup).not.toMatch(/28,011|7,639|simulated actual/i);
    expect(preschoolMarkup).not.toContain("The current Snapshot does not contain the published May benchmark projection");
    expect(preschoolMarkup).not.toContain("No modules are enabled");
    expect(preschoolMarkup).not.toContain("data-ngee-ann-overview");
  });
});

function meterHealthPlan() {
  return {
    template_id: "project",
    target_kind: "project" as const,
    module_count: 1,
    sections: [{
      section_id: "data-status",
      title: "Meter data health",
      navigation_label: "Data status",
      modules: [{
        placement: {
          placement_id: "quality.data_coverage",
          component_revision_id: "quality.data_coverage@1",
          enabled: true,
          section_id: "data-status",
          layout: { span: 12 as const, height: "compact" as const },
          presentation: { visual_preset: "cards" as const, density: "compact" as const, tone: "quiet" as const, show_legend: false, limit: 3 },
        },
        component: {
          revision_id: "quality.data_coverage@1",
          component_id: "quality.data_coverage",
          version: 1,
          display_name: "Data quality and coverage",
          description: "Coverage and Meter Point evidence.",
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
          created_at: "2026-08-21T00:00:00.000Z",
        },
        readiness: { status: "ready" as const, label: "Published", detail: "Fixture" },
      }],
    }],
  };
}
